#!/usr/bin/env python3
"""Build Kyuri Park's portfolio into dist/.

    python3 build.py           build once
    python3 build.py serve     build, serve at http://localhost:8000, rebuild on refresh

Content lives in content/*.json and page structure in templates/*.html.
Standard library only (Python 3.8+), so there is nothing to install.
"""

import argparse
import hashlib
import html
import io
import json
import os
import re
import shutil
import socket
import struct
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
CONTENT_DIR = os.path.join(ROOT, "content")
TEMPLATE_DIR = os.path.join(ROOT, "templates")
ASSET_DIR = os.path.join(ROOT, "assets")
DIST_DIR = os.path.join(ROOT, "dist")

# Size of the gray placeholder for each kind of slot, used until a real file exists.
PLACEHOLDER_SIZES = {
    "cover": (1500, 2000),     # 3:4, home cards and Work tiles
    "wide": (2400, 1350),      # 16:9, hero and full-width images and videos
    "pair": (1200, 1500),      # 4:5, each image in a two-image row
    "portrait": (1200, 1500),  # 4:5, the About portrait
    "piece": (1200, 1500),     # 4:5, the images of an item with no page of its own
    "archive": (1200, 1500),   # 4:5, an Archive image whose size can't be read
}
# The gray boxes that stand in for Archive images until the files exist, in turn: 4:5, 1:1,
# 3:2, 3:4, 16:9, 2:3, 5:4, 3:5. Real images keep their own shape.
ARCHIVE_BOXES = ((1200, 1500), (1500, 1500), (1500, 1000), (1200, 1600),
                 (1600, 900), (1000, 1500), (1500, 1200), (900, 1500))
PIECE_FOLDER = "assets/images/pieces"
ARCHIVE_FOLDER = "assets/images/archive"
ARCHIVE_COLUMNS = (2, 3, 4)  # Archive's columns on phones, from 768px, from 1200px (as in style.css)
# How wide an Archive image shows in its column, so the browser can take the smaller copy
# (001-small.jpg next to 001.jpg) when there is one.
ARCHIVE_SIZES = "(min-width: 1200px) 25vw, (min-width: 768px) 33vw, 50vw"
SMALL_SUFFIX = "-small"
COVER_VIDEO_EXTS = (".mp4", ".webm")
OG_IMAGE_EXTS = (".jpg", ".jpeg", ".png")
MAX_ONE_LINER_WORDS = 8
MIN_FEATURED, MAX_FEATURED = 3, 5  # how many projects Home should show
CATEGORIES = ("digital", "brand", "physical")  # Work's filters, in toggle order after All
LOADING_ATTRS = {"lazy": 'loading="lazy"', "eager": "", "high": 'fetchpriority="high"'}
# Old addresses that now live elsewhere: /contact/ was a menu item and is now a section of About.
# Each becomes <old>/index.html, which sends the visitor on (build_redirects).
REDIRECTS = {"contact": ("/about/#contact", "Contact")}

PLACEHOLDER_RE = re.compile(r"\[PLACEHOLDER[^\]]*\]")
LINK_RE = re.compile(r"\[([^\]]+)\]\(((?:https?://|mailto:|/)[^)\s]*)\)")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NUMBER_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


class BuildError(Exception):
    """A problem in the content or templates, explained in plain words."""


# ---------------------------------------------------------------------------
# Small helpers

def esc(text):
    return html.escape(str(text), quote=True)


def exists(rel):
    return os.path.isfile(os.path.join(ROOT, rel))


def url_for(rel):
    return "/" + quote(rel)


def media_path(src, folder):
    """'cover.webp' means <folder>/cover.webp. Anything with a slash is from the site root."""
    src = str(src)
    return src.lstrip("/") if "/" in src else f"{folder}/{src}"


def placeholder_rel(rel):
    """Where the gray stand-in for a missing file goes: cover.webp -> cover.placeholder.svg."""
    return os.path.splitext(rel)[0] + ".placeholder.svg"


def archive_first_screen(n):
    """The Archive images to load right away: the top one in each column. Columns fill from top
    to bottom, so for 2 columns that's the 1st and the one halfway down the list, and so on, for
    each column count. By count, so close but not exact (columns balance by height)."""
    return {c * -(-n // cols) for cols in ARCHIVE_COLUMNS for c in range(cols)} & set(range(n))


def need(obj, key, where):
    if not isinstance(obj, dict) or obj.get(key) in (None, ""):
        raise BuildError(f'{where}: "{key}" is missing.')
    return obj[key]


def link(href, label_html, cls="", rel="noopener"):
    """An <a> tag. href and label_html must already be escaped.
    External links and PDFs open in a new tab and say so to screen readers."""
    attrs = f' class="{cls}"' if cls else ""
    is_pdf = href.lower().endswith(".pdf")
    if is_pdf or href.startswith(("http://", "https://")):
        note = "PDF, opens in a new tab" if is_pdf else "opens in a new tab"
        return (f'<a{attrs} href="{href}" target="_blank" rel="{rel}">{label_html}'
                f'<span class="visually-hidden"> ({note})</span></a>')
    return f'<a{attrs} href="{href}">{label_html}</a>'


def inline(text):
    """Escape text, turn [label](url) into links, and highlight [PLACEHOLDER] notes."""
    out = esc(text)
    out = LINK_RE.sub(lambda m: link(m.group(2), m.group(1)), out)
    return PLACEHOLDER_RE.sub(lambda m: f'<mark class="placeholder">{m.group(0)}</mark>', out)


def figure(kind, inner, caption):
    cap = f'<figcaption class="caption">{inline(caption)}</figcaption>' if caption else ""
    return f'<figure class="media {kind}">{inner}{cap}</figure>'


def embed_url(url):
    """Turn a YouTube or Vimeo page URL into its embeddable player URL."""
    m = re.search(r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([\w-]{11})", url)
    if m:
        return f"https://www.youtube-nocookie.com/embed/{m.group(1)}"
    m = re.search(r"vimeo\.com/(?:video/)?(\d+)", url)
    if m:
        return f"https://player.vimeo.com/video/{m.group(1)}?dnt=1"
    return url


def file_version(rel):
    """Short content hash, appended to CSS/JS URLs so browsers pick up changes."""
    try:
        with open(os.path.join(ROOT, rel), "rb") as f:
            return hashlib.md5(f.read()).hexdigest()[:8]
    except FileNotFoundError:
        return "0"


def placeholder_svg(width, height, title, label):
    """A soft gray block with the project name, and the file it's waiting for underneath."""
    size = round(min(min(width, height) / 18, width * 1.5 / max(len(title), 1)))  # long names shrink
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        '<rect width="100%" height="100%" fill="#e6e5df"/>\n'
        '<g font-family="-apple-system, \'Helvetica Neue\', Arial, sans-serif" text-anchor="middle">\n'
        f'<text x="50%" y="50%" font-size="{size}" font-weight="500" fill="#62615d">'
        f'{esc(title)}</text>\n'
        f'<text x="50%" y="50%" dy="{round(size * 1.4)}" font-size="{round(size * 0.45)}" '
        f'fill="#8a8984">{esc(label)}</text>\n'
        '</g>\n</svg>\n'
    )


def render(name, **values):
    """Fill {{ key }} slots in templates/<name>. Values are inserted as-is (already HTML)."""
    with open(os.path.join(TEMPLATE_DIR, name), encoding="utf-8") as f:
        text = f.read()

    def fill(m):
        key = m.group(1)
        if key not in values:
            raise BuildError(f"templates/{name}: nothing to put in {{{{ {key} }}}}.")
        return str(values[key])

    return re.sub(r"\{\{\s*(\w+)\s*\}\}", fill, text)


def load_json(name):
    try:
        with open(os.path.join(CONTENT_DIR, name), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise BuildError(f"content/{name} is missing.")
    except json.JSONDecodeError as e:
        raise BuildError(
            f"content/{name}, line {e.lineno}, column {e.colno}: {e.msg}. "
            "Look for a missing comma or quote near there.")


# ---------------------------------------------------------------------------
# Reading image and video dimensions (so <img> gets width/height and the page
# doesn't shift while loading). Handles PNG, JPEG, GIF, WebP, AVIF, SVG, MP4.

_size_cache = {}


def media_size(rel):
    path = os.path.join(ROOT, rel)
    st = os.stat(path)
    key = (rel, st.st_mtime_ns, st.st_size)
    if key not in _size_cache:
        try:
            with open(path, "rb") as f:
                _size_cache[key] = _read_size(f, rel)
        except (OSError, struct.error, IndexError, ValueError):
            _size_cache[key] = None
    return _size_cache[key]


def _read_size(f, rel):
    head = f.read(32)
    if head.startswith(b"\x89PNG"):
        return struct.unpack(">II", head[16:24])
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return struct.unpack("<HH", head[6:10])
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return _webp_size(f)
    if head[:2] == b"\xff\xd8":
        return _jpeg_size(f)
    if head[4:8] == b"ftyp":
        if head[8:12] in (b"avif", b"avis", b"mif1"):
            return _avif_size(f)
        return _mp4_size(f)
    if rel.lower().endswith(".svg"):
        return _svg_size(f)
    return None


def _webp_size(f):
    f.seek(12)
    chunk = f.read(30)
    kind, data = chunk[:4], chunk[8:]
    if kind == b"VP8 ":
        w, h = struct.unpack("<HH", data[6:10])
        return w & 0x3FFF, h & 0x3FFF
    if kind == b"VP8L":
        bits = int.from_bytes(data[1:5], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if kind == b"VP8X":
        return int.from_bytes(data[4:7], "little") + 1, int.from_bytes(data[7:10], "little") + 1
    return None


def _jpeg_size(f):
    f.seek(2)
    while True:
        byte = f.read(1)
        while byte and byte != b"\xff":
            byte = f.read(1)
        while byte == b"\xff":
            byte = f.read(1)
        if not byte:
            return None
        marker = byte[0]
        if marker == 0x01 or 0xD0 <= marker <= 0xD8:
            continue
        length = struct.unpack(">H", f.read(2))[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            f.read(1)
            h, w = struct.unpack(">HH", f.read(4))
            return w, h
        f.seek(length - 2, 1)


def _boxes(f, start, end):
    """Yield (type, payload_start, box_end) for ISO-BMFF boxes (AVIF, MP4)."""
    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        size, kind = struct.unpack(">I4s", f.read(8))
        payload = pos + 8
        if size == 1:
            size = struct.unpack(">Q", f.read(8))[0]
            payload += 8
        elif size == 0:
            size = end - pos
        if size < 8:
            return
        yield kind, payload, pos + size
        pos += size


def _find_boxes(f, start, end, path):
    for kind, payload, stop in _boxes(f, start, end):
        if kind == path[0]:
            if len(path) == 1:
                yield payload
            else:
                skip = 4 if kind == b"meta" else 0  # "meta" carries a version/flags header
                yield from _find_boxes(f, payload + skip, stop, path[1:])


def _avif_size(f):
    end = os.fstat(f.fileno()).st_size
    sizes = []
    for payload in _find_boxes(f, 0, end, [b"meta", b"iprp", b"ipco", b"ispe"]):
        f.seek(payload + 4)
        sizes.append(struct.unpack(">II", f.read(8)))
    return max(sizes, key=lambda s: s[0] * s[1]) if sizes else None


def _mp4_size(f):
    end = os.fstat(f.fileno()).st_size
    for payload in _find_boxes(f, 0, end, [b"moov", b"trak", b"tkhd"]):
        f.seek(payload)
        version = f.read(1)[0]
        f.seek(payload + (88 if version == 1 else 76))
        w, h = struct.unpack(">II", f.read(8))
        if w and h:
            return w >> 16, h >> 16
    return None


def _svg_size(f):
    f.seek(0)
    tag = re.search(r"<svg\b[^>]*>", f.read(4096).decode("utf-8", "ignore"))
    if not tag:
        return None
    tag = tag.group(0)
    w = re.search(r'\swidth="([\d.]+)(?:px)?"', tag)
    h = re.search(r'\sheight="([\d.]+)(?:px)?"', tag)
    if w and h:
        return round(float(w.group(1))), round(float(h.group(1)))
    vb = re.search(r'viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)"', tag)
    if vb:
        return round(float(vb.group(1))), round(float(vb.group(2)))
    return None


# ---------------------------------------------------------------------------
# Content checks

def validate(site, items):
    """Stop on content problems that would break the site; return softer warnings."""
    for key in ("name", "role", "title", "description", "email", "linkedin", "github",
                "resume", "copyright", "about"):
        need(site, key, "content/site.json")
    if not isinstance(items, list) or not items:
        raise BuildError("content/projects.json should be a list of items: [ {...}, {...} ].")

    warnings, seen = [], set()
    allowed = ", ".join(f'"{c}"' for c in CATEGORIES)
    for i, p in enumerate(items, 1):
        where = f"content/projects.json (item {i})"
        category = need(p, "category", where)
        if (not isinstance(category, list) or not category
                or any(c not in CATEGORIES for c in category)):
            raise BuildError(f'{where}: "category" should list one or more of {allowed}, '
                             'like ["digital", "brand"].')
        if not isinstance(p.get("featured", False), bool):
            raise BuildError(f'{where}: "featured" should be true or false.')
        order = p.get("order")
        if isinstance(order, bool) or not isinstance(order, (int, float)):
            raise BuildError(f'{where}: "order" should be a number (lower numbers show first).')
        roles = p.get("roles", [])
        if not isinstance(roles, list) or not all(isinstance(r, str) for r in roles):
            raise BuildError(f'{where}: "roles" should be a list, like ["Art Direction"].')
        if p.get("todo"):
            warnings.append(f'{where}: {p["todo"]}.')
        if "slug" not in p:  # no page of its own: its tile opens the lightbox
            need(p, "title", where)
            if p.get("featured"):
                raise BuildError(f'{where}: "featured" needs a "slug", because a Home card '
                                 "opens the project's page.")
            images = need(p, "images", where)
            if not isinstance(images, list) or not images:
                raise BuildError(f'{where}: "images" should list one or more files, '
                                 'like ["poster.webp"].')
            continue
        slug = need(p, "slug", where)
        if not SLUG_RE.match(str(slug)):
            raise BuildError(f'{where}: slug "{slug}" should use only lowercase letters, '
                             'numbers, and hyphens, like "light-life".')
        if slug in seen:
            raise BuildError(f'{where}: slug "{slug}" is used twice.')
        seen.add(slug)
        where = f"content/projects.json ({slug})"
        need(p, "title", where)
        need(need(p, "cover", where), "src", where)
        words = len(PLACEHOLDER_RE.sub("", need(p, "oneLiner", where)).split())
        if words > MAX_ONE_LINER_WORDS:
            warnings.append(f"{slug}: the one-liner is {words} words "
                            f"(aim for {MAX_ONE_LINER_WORDS} or fewer).")
        for key in ("type", "year"):
            if not p.get(key):
                warnings.append(f'{slug}: "{key}" is empty, so the Work list shows a gap there.')

    if not seen:
        raise BuildError('content/projects.json needs at least one project with a "slug".')
    featured = sum(bool(p.get("featured")) for p in items)
    if not featured:
        raise BuildError('content/projects.json needs at least one item with "featured": true, '
                         "or Home has no cards.")
    if not MIN_FEATURED <= featured <= MAX_FEATURED:
        warnings.append(f"{featured} projects are featured on Home "
                        f"(aim for {MIN_FEATURED} to {MAX_FEATURED}).")

    if not exists(site["resume"]):
        warnings.append(f"{site['resume']} not found, so the Resume link won't work yet.")
    if not site.get("siteUrl"):
        warnings.append('"siteUrl" in content/site.json is empty. Set it once the site has '
                        "an address, so link previews show the right image.")
    return warnings


def validate_archive(images):
    """Stop on problems in content/archive.json that would break the page."""
    if not isinstance(images, list):
        raise BuildError("content/archive.json should be a list of images: [ {...}, {...} ].")
    ids, names = set(), {}
    for i, image in enumerate(images, 1):
        where = f"content/archive.json (item {i})"
        number = need(image, "id", where)
        src = need(image, "src", where)
        if isinstance(number, bool) or not isinstance(number, (str, int)):
            raise BuildError(f'{where}: "id" should be a number in quotes, like "009".')
        if not isinstance(src, str):
            raise BuildError(f'{where}: "src" should be a file name in quotes, like "009.jpg".')
        if str(number) in ids:
            raise BuildError(f'{where}: id "{number}" is used twice.')
        ids.add(str(number))
        # Two entries can't share a file name, even with different endings (001.jpg and
        # 001.webp): they'd show the same image, or share one gray stand-in.
        name = os.path.splitext(media_path(src, ARCHIVE_FOLDER))[0].lower()
        if name in names:
            j = names[name]
            raise BuildError(f'{where}: "src" "{src}" has the same name as item {j}\'s '
                             f'("{images[j - 1]["src"]}"). Give each image its own name.')
        names[name] = i


# ---------------------------------------------------------------------------
# The build

class Builder:
    def __init__(self, site, items, archive):
        self.site = site
        self.items = items             # everything on Work, in "order"
        self.projects = [p for p in items if "slug" in p]  # the ones with their own page
        self.featured = [p for p in self.projects if p.get("featured")]  # the ones on Home
        self.archive = archive         # the images on Archive, in the file's order
        self.written = set()           # dist-relative paths this build produced
        self.missing_media = set()     # files the content mentions that don't exist yet
        self.placeholder_counts = {}   # page -> number of [PLACEHOLDER] notes left
        self.warnings = []

    # Output -----------------------------------------------------------------

    def write(self, rel, text):
        self.written.add(rel)
        path = os.path.join(DIST_DIR, rel)
        data = text.encode("utf-8")
        try:
            with open(path, "rb") as f:
                if f.read() == data:
                    return
        except FileNotFoundError:
            os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)

    def copy_assets(self):
        """Copy assets/ into dist/assets/, skipping files that haven't changed."""
        for dirpath, dirnames, filenames in os.walk(ASSET_DIR):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for name in filenames:
                if name.startswith("."):
                    continue
                src = os.path.join(dirpath, name)
                rel = os.path.relpath(src, ROOT).replace(os.sep, "/")
                dst = os.path.join(DIST_DIR, rel)
                self.written.add(rel)
                s = os.stat(src)
                try:
                    d = os.stat(dst)
                    if d.st_size == s.st_size and int(d.st_mtime) == int(s.st_mtime):
                        continue
                except FileNotFoundError:
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)

    def remove_stale(self):
        """Delete anything in dist/ this build didn't produce (removed pages, old placeholders)."""
        for dirpath, _, filenames in os.walk(DIST_DIR, topdown=False):
            for name in filenames:
                path = os.path.join(dirpath, name)
                if os.path.relpath(path, DIST_DIR).replace(os.sep, "/") not in self.written:
                    os.remove(path)
            if dirpath != DIST_DIR and not os.listdir(dirpath):
                os.rmdir(dirpath)

    def page(self, rel, label, path, title, description, content, main_class,
             current=None, image=(None, None), noindex=False, footer=True):
        """footer=False leaves the contact footer off (Home). The body's data-page says which kind
        of page it is (home, work, project, archive, about, 404), for page-specific CSS."""
        s = self.site
        out = render(
            "base.html",
            page_name=current or label,
            page_title=esc(title),
            description=esc(description),
            head_meta=self.head_meta(path, title, description, image, noindex),
            css_version=file_version("assets/css/style.css"),
            js_version=file_version("assets/js/main.js"),
            site_name=esc(s["name"]),
            nav_work={"work": ' aria-current="page"', "project": ' aria-current="true"'}.get(current, ""),
            nav_archive=' aria-current="page"' if current == "archive" else "",
            nav_about=' aria-current="page"' if current == "about" else "",
            main_class=main_class,
            content=content,
            footer=render("footer.html", contact_links=self.contact_links("      "),
                          copyright=esc(s["copyright"])) if footer else "",
        )
        self.write(rel, out)
        self.placeholder_counts[label] = len(PLACEHOLDER_RE.findall(content))

    def head_meta(self, path, title, description, image, noindex):
        base = (self.site.get("siteUrl") or "").rstrip("/")
        tags = []
        if noindex:
            tags.append('<meta name="robots" content="noindex">')
        elif base:
            tags.append(f'<link rel="canonical" href="{esc(base + path)}">')
        tags += [
            '<meta property="og:type" content="website">',
            f'<meta property="og:site_name" content="{esc(self.site["name"])}">',
            f'<meta property="og:title" content="{esc(title)}">',
            f'<meta property="og:description" content="{esc(description)}">',
        ]
        if base:
            tags.append(f'<meta property="og:url" content="{esc(base + path)}">')
        rel, alt = image
        if rel and exists(rel):
            tags.append(f'<meta property="og:image" content="{esc(base + url_for(rel))}">')
            size = media_size(rel)
            if size:
                tags.append(f'<meta property="og:image:width" content="{size[0]}">')
                tags.append(f'<meta property="og:image:height" content="{size[1]}">')
            if alt:
                tags.append(f'<meta property="og:image:alt" content="{esc(alt)}">')
        tags.append('<meta name="twitter:card" content="summary_large_image">')
        return "\n  ".join(tags)

    def og_image(self, project=None):
        """A project's cover if it's a JPG/PNG (what link previews accept), else the site image."""
        if project:
            cover = project["cover"]
            rel = media_path(cover["src"], f"assets/images/{project['slug']}")
            if exists(rel) and rel.lower().endswith(OG_IMAGE_EXTS):
                return rel, cover.get("alt")
        og = self.site.get("ogImage") or {}
        return og.get("src"), og.get("alt")

    def contact_links(self, indent):
        """The email, LinkedIn, GitHub, and resume links from content/site.json, for both the
        footer and About's Contact section, so changing one there changes both."""
        s = self.site
        rel = "noopener noreferrer"
        items = [
            link(esc("mailto:" + s["email"]), esc(s["email"])),
            link(esc(s["linkedin"]), "LinkedIn", rel=rel),
            link(esc(s["github"]), "GitHub", rel=rel),
            link(url_for(s["resume"]), "Resume", rel=rel),
        ]
        return "\n".join(f"{indent}<li>{item}</li>" for item in items)

    # Media ------------------------------------------------------------------

    def placeholder(self, rel, slot, title, box=None):
        """Write a labeled gray SVG in place of a missing file, the size of its slot unless
        box gives another. Returns (url, (w, h))."""
        width, height = box or PLACEHOLDER_SIZES[slot]
        ph_rel = placeholder_rel(rel)
        self.write(ph_rel, placeholder_svg(width, height, title, os.path.basename(rel)))
        self.missing_media.add(rel)
        return url_for(ph_rel), (width, height)

    @staticmethod
    def srcset(rel, size, sizes):
        """srcset and sizes for a smaller copy next to the file (001-small.jpg for 001.jpg),
        or "" if there isn't one."""
        stem, ext = os.path.splitext(rel)
        small = stem + SMALL_SUFFIX + ext
        small_size = exists(small) and media_size(small)
        if not small_size:
            return ""
        return (f'srcset="{url_for(small)} {small_size[0]}w, {url_for(rel)} {size[0]}w" '
                f'sizes="{sizes}"')

    def img(self, rel, alt, slot, title, loading="lazy", decorative=False, box=None, sizes=None):
        """decorative=True is for a repeat of an image already described elsewhere (alt="").
        box is the placeholder's (width, height), if not the slot's. sizes (how wide the image
        shows) lets the browser take a smaller copy of the file, if there is one."""
        if not alt and not decorative:
            self.warnings.append(f"{rel} has no alt text.")
        srcset = ""
        if exists(rel):
            size = media_size(rel)
            if size and sizes:
                srcset = self.srcset(rel, size, sizes)
            if not size:
                self.warnings.append(f"Couldn't read the size of {rel}, so the page may "
                                     "shift slightly while it loads.")
                size = PLACEHOLDER_SIZES[slot]
            src = url_for(rel)
        else:
            src, size = self.placeholder(rel, slot, title, box)
        attrs = [f'src="{src}"', srcset, f'alt="{esc(alt or "")}"', f'width="{size[0]}"',
                 f'height="{size[1]}"', LOADING_ATTRS[loading], 'decoding="async"']
        return f"<img {' '.join(a for a in attrs if a)}>"

    def video(self, b, folder, title, loading, where):
        alt = b.get("alt") or ""
        if not alt:
            self.warnings.append(f"{where}: a video block has no alt text.")
        if b.get("embed"):
            return (f'<div class="embed"><iframe src="{esc(embed_url(b["embed"]))}" '
                    f'title="{esc(alt or "Video")}" loading="lazy" '
                    'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>')
        rel = media_path(need(b, "src", where), folder)
        if not exists(rel):
            return self.img(rel, f"{alt} (placeholder)", "wide", title, loading)
        w, h = media_size(rel) or PLACEHOLDER_SIZES["wide"]
        attrs = [f'src="{url_for(rel)}"', f'width="{w}"', f'height="{h}"',
                 f'aria-label="{esc(alt)}"', "playsinline", "controls", 'preload="metadata"']
        if b.get("poster"):
            poster = media_path(b["poster"], folder)
            if exists(poster):
                attrs.append(f'poster="{url_for(poster)}"')
        if b.get("loop"):
            # main.js autoplays these while on screen (unless reduced motion is on)
            attrs += ["muted", "loop", "data-loop"]
        return f"<video {' '.join(attrs)}></video>"

    # Project blocks ---------------------------------------------------------

    def block(self, b, p, folder, hero=False):
        kind = b.get("type")
        where = f"content/projects.json ({p['slug']})"
        loading = "high" if hero else "lazy"
        if kind == "text":
            return self.text_block(b)
        if kind == "image":
            rel = media_path(need(b, "src", where), folder)
            return figure("media-full", self.img(rel, b.get("alt"), "wide", p["title"], loading),
                          b.get("caption"))
        if kind == "imagePair":
            images = b.get("images")
            if not isinstance(images, list) or len(images) != 2:
                raise BuildError(f'{where}: an "imagePair" block needs exactly two entries in "images".')
            imgs = "".join(
                self.img(media_path(need(i, "src", where), folder), i.get("alt"), "pair",
                         p["title"], loading)
                for i in images)
            return figure("media-pair", f'<div class="pair">{imgs}</div>', b.get("caption"))
        if kind == "video":
            return figure("media-full", self.video(b, folder, p["title"], loading, where),
                          b.get("caption"))
        if kind == "impact":
            return self.impact_block(b, where)
        raise BuildError(f'{where}: unknown block type "{kind}". '
                         'Use text, image, imagePair, video, or impact.')

    def impact_block(self, b, where):
        """Large numbers that count up on screen. Only real numbers are shown: an item whose
        value isn't a plain number (empty, [PLACEHOLDER], "TBD") is left out, and so is the
        whole block when nothing is left."""
        items = []
        for item in b.get("items") or []:
            raw = str(item.get("value", "")).replace(",", "").strip()
            if not NUMBER_RE.match(raw):
                self.warnings.append(f'{where}: impact value "{item.get("value", "")}" is not a '
                                     "number yet, so it is left out.")
                continue
            decimals = len(raw.partition(".")[2])
            prefix, suffix = str(item.get("prefix", "")), str(item.get("suffix", ""))
            shown = esc(f"{prefix}{float(raw):,.{decimals}f}{suffix}")
            items.append(
                '<div class="impact-item">'
                f'<dt class="impact-label">{inline(need(item, "label", where))}</dt>'
                f'<dd class="impact-value"><span class="visually-hidden">{shown}</span>'
                f'<span class="impact-count" aria-hidden="true" data-value="{raw}" '
                f'data-decimals="{decimals}" data-prefix="{esc(prefix)}" data-suffix="{esc(suffix)}">'
                f'{shown}</span></dd></div>')
        return f'<dl class="impact">{"".join(items)}</dl>' if items else ""

    def text_block(self, b):
        body = b.get("body") or []
        if isinstance(body, str):
            body = [body]
        paras = "".join(f"<p>{inline(t)}</p>" for t in body)
        heading = b.get("heading")
        if b.get("variant") == "note":
            h = f'<h3 class="note-heading">{inline(heading)}</h3>' if heading else ""
            return f'<aside class="text-block is-note"><div class="text-body">{h}{paras}</div></aside>'
        h = f'<h2 class="section-heading">{inline(heading)}</h2>' if heading else ""
        return f'<div class="text-block">{h}<div class="text-body">{paras}</div></div>'

    def sections(self, blocks, p, folder):
        """Group blocks into sections: each text block with a heading starts a new one."""
        groups = []
        for b in blocks:
            starts = b.get("type") == "text" and b.get("heading") and b.get("variant") != "note"
            rendered = self.block(b, p, folder)
            if not rendered:  # an impact block with no real numbers
                continue
            if starts or not groups:
                groups.append((bool(starts), []))
            groups[-1][1].append(rendered)
        out = []
        for headed, items in groups:
            tag = "section" if headed else "div"
            body = "\n          ".join(items)
            out.append(f'        <{tag} class="project-section">\n          {body}\n        </{tag}>')
        return "\n".join(out)

    def meta_rows(self, p):
        """Role · Year · Type · Tools · Link. Empty fields are left out."""
        meta = p.get("meta") or {}
        rows = []
        for label, value in (("Role", p.get("roles")), ("Year", p.get("year")),
                             ("Type", p.get("type")), ("Tools", meta.get("tools"))):
            if isinstance(value, list):
                value = ", ".join(value)
            if value:
                rows.append((label, inline(value)))
        lk = meta.get("link")
        if lk and lk.get("url"):
            rows.append(("Link", link(esc(lk["url"]), esc(lk.get("label") or lk["url"]))))
        return "\n".join(f"          <div><dt>{k}</dt><dd>{v}</dd></div>" for k, v in rows)

    # Pages ------------------------------------------------------------------

    def cover(self, p):
        """Path of a project's cover image, and of its hover video if one sits next to it."""
        rel = media_path(p["cover"]["src"], f"assets/images/{p['slug']}")
        stem = os.path.splitext(rel)[0]
        video = next((stem + ext for ext in COVER_VIDEO_EXTS if exists(stem + ext)), None)
        return rel, video

    def card_caption(self, p):
        """'TypeLab' on the left, 'Font design playground' on the right: on each home card,
        and under the middle one."""
        return (f'<span class="card-title">{inline(p["title"])}</span> '
                f'<span class="card-text">{inline(p["oneLiner"])}</span>')

    def home_card(self, p, index, total):
        rel, _ = self.cover(p)
        if exists(rel):
            # All eager: the stage clips the cards, so lazy ones would only load once on screen.
            img = self.img(rel, p["cover"].get("alt"), "cover", p["title"],
                           "high" if index == 0 else "eager")
        else:
            img = ""  # a plain gray card until the cover exists; no label on Home
            self.missing_media.add(rel)
        # Where the card sits before track.js runs: first card in the middle, the rest
        # around it as on a loop (with five: 0, 1, 2, -2, -1).
        offset = index if index <= total / 2 else index - total
        return (f'          <li class="track-item" style="--d: {offset}">\n'
                f'            <a class="track-card" href="/work/{p["slug"]}/">\n'
                f'              <span class="track-media">{img}</span>\n'
                f'              <span class="card-caption">{self.card_caption(p)}</span>\n'
                f'            </a>\n'
                f'          </li>')

    def build_home(self):
        """The project loop: the featured projects, in "order"."""
        cards = "\n".join(self.home_card(p, i, len(self.featured))
                          for i, p in enumerate(self.featured))
        s = self.site
        content = render("home.html", cards=cards, caption=self.card_caption(self.featured[0]),
                         intro_line=esc(f"{s['name']} — {s['role']}"),
                         track_version=file_version("assets/js/track.js"))
        self.page("index.html", "home", "/", self.site["title"], self.site["description"],
                  content, "page-home", image=self.og_image(), footer=False)

    def tile_image(self, rel, slot, title, loading="lazy", alt=None, sizes=None):
        """A tile's image, or nothing (a plain gray block) until the file exists. On Work the
        tile's caption already names it, so with no alt given the image is decorative (alt="")."""
        if exists(rel):
            return self.img(rel, alt, slot, title, loading, decorative=alt is None, sizes=sizes)
        self.missing_media.add(rel)
        return ""

    def work_card(self, p, index):
        """'TypeLab' on one line under a 3:4 image, for one item; main.js filters the tiles on
        data-categories. A project's tile links to its page, and if the cover has a video next
        to it, main.js plays it while the tile is hovered. An item with no page opens the
        lightbox, which shows its 'Type · Year' from a hidden span in the tile."""
        loading = "eager" if index < 3 else "lazy"
        if "slug" in p:
            rel, video = self.cover(p)
            img = self.tile_image(rel, "cover", p["title"], loading)
            data = f' data-video="{url_for(video)}"' if video else ""
            tag, attrs = "a", f'href="/work/{p["slug"]}/"'
            meta, extra = "", ""
        else:
            rel = media_path(p["images"][0], PIECE_FOLDER)
            img = self.tile_image(rel, "piece", p["title"], loading)
            data = ""
            tag, attrs = "button", 'type="button" data-item aria-haspopup="dialog"'
            meta = f'<span hidden data-lightbox-meta>{self.piece_meta(p)}</span>'
            extra = f'            {self.piece_images(p)}\n'
        return (f'          <li data-categories="{" ".join(p["category"])}">\n'
                f'            <{tag} class="work-card" {attrs}>\n'
                f'              <span class="work-caption">'
                f'<span class="work-name" data-lightbox-name>{inline(p["title"])}</span>'
                f'{meta}</span>\n'
                f'              <span class="work-media"{data}>{img}</span>\n'
                f'            </{tag}>\n'
                f'{extra}'
                f'          </li>')

    @staticmethod
    def work_count(n):
        """'05' on screen, ', 5 projects' for screen readers."""
        return (f'<span class="work-count" aria-hidden="true">{n:02d}</span>'
                f'<span class="visually-hidden">, {n} project{"" if n == 1 else "s"}</span>')

    def work_tab(self, name):
        """One filter on Work's toggle, with how many items it shows: an item with two
        categories counts under both, and once under All. "[ All 11 ]", bracketed as
        About's "[ Scroll down ]" is (style.css shows the brackets on the filter showing only);
        screen readers skip them."""
        n = sum(name == "all" or name in p["category"] for p in self.items)
        return (f'      <button class="work-tab" type="button" data-filter="{name}" '
                f'aria-pressed="{str(name == "all").lower()}">'
                f'<span class="work-bracket" aria-hidden="true">[ </span>{name.capitalize()}'
                f'{self.work_count(n)}<span class="work-bracket" aria-hidden="true"> ]</span>'
                f'</button>')

    def piece_meta(self, item):
        """'Type · Year', leaving out what's empty."""
        return " · ".join(inline(item[k]) for k in ("type", "year") if item.get(k))

    def piece_images(self, item):
        """The images of an item with no page, waiting in a <template> until main.js copies
        them into the lightbox. The first is also its thumbnail."""
        title, alt = item["title"], item.get("alt")
        rels = [media_path(src, PIECE_FOLDER) for src in item["images"]]
        large = "".join(
            self.img(rel, f"{alt} ({n} of {len(rels)})" if alt and len(rels) > 1 else alt,
                     "piece", title, "eager" if n == 1 else "lazy")
            for n, rel in enumerate(rels, 1))
        return f"<template>{large}</template>"

    def build_work(self):
        """One grid of tiles under the All / Digital / Brand / Physical toggle (main.js
        shows one filter at a time). Without JavaScript, there's no toggle and it shows them all."""
        s = self.site
        tabs = "\n".join(self.work_tab(name) for name in ("all", *CATEGORIES))
        cards = "\n".join(self.work_card(p, i) for i, p in enumerate(self.items))
        lightbox = render("lightbox.html") if len(self.items) > len(self.projects) else ""
        content = render("work.html", tabs=render("work-tabs.html", tabs=tabs), cards=cards,
                         lightbox=lightbox)
        self.page("work/index.html", "work", "/work/", f"Work — {s['name']}", s["description"],
                  content, "wrap page-work", current="work", image=self.og_image())

    def archive_tile(self, item, box, loading):
        """An image on Archive with nothing under it, linking to the image itself; its number
        names the link for screen readers only. main.js opens the lightbox instead, with a copy
        of the image and the caption and date from the text under the tile, which it hides;
        without JavaScript, the link opens the image and the caption and date show under it.
        Until the file exists, the tile is a plain gray block and a <template> holds the
        labeled gray image the lightbox shows in its place, both in the shape of box."""
        number = esc(item["id"])
        rel = media_path(item["src"], ARCHIVE_FOLDER)
        alt, title = item.get("alt") or "", f"Archive {item['id']}"
        thumb = self.tile_image(rel, "archive", title, loading, alt=alt, sizes=ARCHIVE_SIZES)
        if thumb:
            href, shape, large = url_for(rel), "", ""
        else:
            href = url_for(placeholder_rel(rel))
            shape = f' style="aspect-ratio: {box[0]} / {box[1]}"'
            large = (f'          <template>'
                     f'{self.img(rel, alt, "archive", title, "eager", decorative=True, box=box)}'
                     f'</template>\n')
        if item.get("caption"):
            name = f'<span class="archive-name" data-lightbox-name>{inline(item["caption"])}</span>'
        else:  # names the lightbox for screen readers, with nothing on screen
            name = (f'<span class="archive-name visually-hidden" data-lightbox-name>'
                    f'Image {number}</span>')
        return (f'        <li class="archive-item">\n'
                f'          <a class="archive-tile" href="{href}" data-item aria-haspopup="dialog">\n'
                f'            <span class="archive-media"{shape}>{thumb}</span>\n'
                f'            <span class="visually-hidden">Image {number}</span>\n'
                f'          </a>\n'
                f'          <p class="archive-text">{name} <span class="archive-date" '
                f'data-lightbox-meta>{inline(item.get("date") or "")}</span></p>\n'
                f'{large}'
                f'        </li>')

    def build_archive(self):
        """Every image in content/archive.json, in the file's order. Each opens the lightbox."""
        s = self.site
        first = archive_first_screen(len(self.archive))
        tiles = "\n".join(self.archive_tile(item, ARCHIVE_BOXES[i % len(ARCHIVE_BOXES)],
                                            "eager" if i in first else "lazy")
                          for i, item in enumerate(self.archive))
        lightbox = render("lightbox.html") if self.archive else ""
        content = render("archive.html", tiles=tiles, lightbox=lightbox)
        self.page("archive/index.html", "archive", "/archive/", f"Archive — {s['name']}",
                  s["description"], content, "wrap page-archive", current="archive",
                  image=self.og_image())

    def build_project(self, p, prev_p, next_p):
        folder = f"assets/images/{p['slug']}"
        statement = p.get("statement")
        content = render(
            "project.html",
            title=inline(p["title"]),
            meta=self.meta_rows(p),
            statement=(f'<p class="project-statement">{inline(statement)}</p>'
                       if statement else ""),
            hero=("        " + self.block(p["hero"], p, folder, hero=True)) if p.get("hero") else "",
            blocks=self.sections(p.get("blocks") or [], p, folder),
            prev_url=f"/work/{prev_p['slug']}/",
            prev_title=inline(prev_p["title"]),
            next_url=f"/work/{next_p['slug']}/",
            next_title=inline(next_p["title"]),
        )
        s = self.site
        self.page(f"work/{p['slug']}/index.html", p["slug"], f"/work/{p['slug']}/",
                  f"{p['title']} — {s['name']}",
                  f"{p['oneLiner']}. A project by {s['name']}, {s['role']}.",
                  content, "page-project", current="project", image=self.og_image(p))

    def about_hero(self, about):
        """About's first screen: the headline alone in the middle of the window, and a
        '[ Scroll down ]' link at its foot to the portrait and text under it. Each string in
        "headline" is one line from 768px (on phones they run on as one sentence); a plain
        string is one line that wraps. No headline, no first screen."""
        lines = about.get("headline") or []
        if isinstance(lines, str):
            lines = [lines]
        if not isinstance(lines, list) or not all(isinstance(t, str) for t in lines):
            raise BuildError('content/site.json (about): "headline" should be a sentence, or a '
                             'list of its lines, like ["FIRST LINE", "SECOND LINE"].')
        lines = [t.strip() for t in lines if t.strip()]
        if not lines:
            return ""
        spans = " ".join(f'<span class="about-headline-line">{inline(t)}</span>' for t in lines)
        return ('    <div class="about-hero">\n'
                f'      <p class="about-headline">{spans}</p>\n'
                '      <a class="about-scroll" href="#intro"><span aria-hidden="true">[ </span>'
                'Scroll down<span aria-hidden="true"> ]</span></a>\n'
                '    </div>\n')

    def build_about(self):
        s = self.site
        about = s["about"]
        portrait = need(about, "portrait", "content/site.json (about)")
        img = self.img(media_path(need(portrait, "src", "content/site.json (about.portrait)"),
                                  "assets/images/about"),
                       portrait.get("alt"), "portrait", s["name"], "high")
        paragraphs = []
        for text in about.get("paragraphs") or []:
            paragraphs.append(f"        <p>{inline(text)}</p>")
        experience = []
        for row in about.get("experience") or []:
            experience.append(
                '        <li>'
                f'<span class="experience-company">{inline(row.get("company", ""))}</span>'
                f'<span class="experience-role">{inline(row.get("role", ""))}</span>'
                f'<span class="experience-dates">{inline(row.get("dates", ""))}</span>'
                '</li>')
        content = render("about.html", hero=self.about_hero(about),
                         portrait="        " + img,
                         paragraphs="\n".join(paragraphs), experience="\n".join(experience),
                         contact_links=self.contact_links("        "))
        self.page("about/index.html", "about", "/about/", f"About — {s['name']}",
                  s["description"], content, "wrap page-about", current="about",
                  image=self.og_image())

    def build_404(self):
        s = self.site
        self.page("404.html", "404", "/404.html", f"Page not found — {s['name']}",
                  s["description"], render("404.html"), "wrap page-not-found", noindex=True)

    def build_redirects(self):
        """Old addresses (REDIRECTS): a page that sends the visitor on at once, by meta refresh
        and by script (either works alone), with a plain link if both are off."""
        for old, (target, title) in REDIRECTS.items():
            self.write(f"{old}/index.html", render(
                "redirect.html", page_title=esc(f"{title} — {self.site['name']}"),
                target=esc(target), target_js=json.dumps(target), title=esc(title)))

    def report(self, seconds):
        pages = sum(1 for w in self.written
                    if w.endswith(".html") and w[:-len("/index.html")] not in REDIRECTS)
        print(f"Built {pages} pages into dist/ in {seconds:.2f}s")
        left = ", ".join(f"{k} {v}" for k, v in self.placeholder_counts.items() if v)
        if left:
            print(f"  [PLACEHOLDER] notes left: {left}")
        if self.missing_media:
            print(f"  {len(self.missing_media)} images/videos not added yet (gray placeholders shown)")
        for w in dict.fromkeys(self.warnings):
            print(f"  Note: {w}")


def build(local_url=None):
    start = time.time()
    site = load_json("site.json")
    items = load_json("projects.json")
    archive = load_json("archive.json")
    if local_url and not site.get("siteUrl"):
        site["siteUrl"] = local_url  # local preview: full links point at this server

    warnings = validate(site, items)
    validate_archive(archive)
    items.sort(key=lambda p: p["order"])  # stable: items with the same number keep the file's order
    builder = Builder(site, items, archive)
    builder.warnings += warnings
    os.makedirs(DIST_DIR, exist_ok=True)
    builder.copy_assets()
    builder.build_home()
    builder.build_work()
    builder.build_archive()
    projects = builder.projects
    for i, p in enumerate(projects):  # Previous / Next loop around the ends
        builder.build_project(p, projects[i - 1], projects[(i + 1) % len(projects)])
    builder.build_about()
    builder.build_404()
    builder.build_redirects()
    builder.remove_stale()
    builder.report(time.time() - start)


# ---------------------------------------------------------------------------
# Local server

def source_signature():
    sig = []
    for top in (CONTENT_DIR, TEMPLATE_DIR, ASSET_DIR):
        for dirpath, _, filenames in os.walk(top):
            for name in filenames:
                path = os.path.join(dirpath, name)
                try:
                    st = os.stat(path)
                except FileNotFoundError:
                    continue
                sig.append((path, st.st_mtime_ns, st.st_size))
    return sorted(sig)


def port_in_use(port):
    """True if another server answers on this port. Checks IPv6 too, because a browser
    may send "localhost" to ::1 and reach that server instead of this one."""
    for host in ("127.0.0.1", "::1"):
        try:
            with socket.create_connection((host, port), timeout=0.2):
                return True
        except OSError:
            pass
    return False


def serve(port):
    sys.stdout.reconfigure(line_buffering=True)  # print build reports right away, even when logged
    lock = threading.Lock()
    state = {"signature": None, "error": None, "url": None}

    def refresh():
        signature = source_signature()
        with lock:
            if signature == state["signature"]:
                return
            state["signature"] = signature
            try:
                build(state["url"])
                state["error"] = None
            except Exception as e:  # show the problem in the browser instead of stopping
                state["error"] = str(e) if isinstance(e, BuildError) else f"{type(e).__name__}: {e}"
                print(f"Build failed: {state['error']}", file=sys.stderr)

    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {
            **SimpleHTTPRequestHandler.extensions_map,
            ".avif": "image/avif", ".webp": "image/webp", ".svg": "image/svg+xml",
            ".woff2": "font/woff2", ".mp4": "video/mp4", ".webm": "video/webm",
            ".js": "text/javascript", ".pdf": "application/pdf",
        }

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=DIST_DIR, **kwargs)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path.endswith(("/", ".html")):
                refresh()
                if state["error"]:
                    return self.send_build_error()
            super().do_GET()

        def send_head(self):
            # Safari only plays video when the server supports byte ranges.
            rng = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range", "").strip())
            path = self.translate_path(self.path)
            if not rng or not os.path.isfile(path):
                return super().send_head()
            size = os.path.getsize(path)
            first, last = rng.groups()
            if first:
                start, end = int(first), min(int(last) if last else size - 1, size - 1)
            else:
                start, end = max(0, size - int(last or 0)), size - 1
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return None
            with open(path, "rb") as f:
                f.seek(start)
                data = f.read(end - start + 1)
            self.send_response(206)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return io.BytesIO(data)

        def send_error(self, code, message=None, explain=None):
            page = os.path.join(DIST_DIR, "404.html")
            if code != 404 or not os.path.isfile(page):
                return super().send_error(code, message, explain)
            with open(page, "rb") as f:
                body = f.read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def send_build_error(self):
            body = (
                "<!doctype html><meta charset='utf-8'><title>Build error</title>"
                "<body style='font:16px/1.5 system-ui;margin:48px;max-width:720px'>"
                "<h1 style='font-size:20px'>The site couldn't build</h1>"
                f"<pre style='white-space:pre-wrap;font:inherit'>{esc(state['error'])}</pre>"
                "<p>Fix it, save, and refresh this page.</p>"
            ).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            self.send_header("Accept-Ranges", "bytes")
            super().end_headers()

        def log_message(self, *args):
            pass

    httpd = None
    for candidate in range(port, port + 20):
        if port_in_use(candidate):
            continue
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", candidate), Handler)
            break
        except OSError:
            continue
    if httpd is None:
        sys.exit(f"Ports {port}-{port + 19} are busy. Try: python3 build.py serve --port 9000")
    state["url"] = f"http://localhost:{httpd.server_port}"
    refresh()
    print(f"\nServing at {state['url']}")
    print("Edit content/, templates/, or assets/, then refresh the browser. Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


def main():
    parser = argparse.ArgumentParser(description="Build the portfolio into dist/.")
    parser.add_argument("command", nargs="?", choices=["build", "serve"], default="build")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.command == "serve":
        serve(args.port)
        return
    try:
        build()
    except BuildError as e:
        sys.exit(f"Build failed: {e}")


if __name__ == "__main__":
    main()
