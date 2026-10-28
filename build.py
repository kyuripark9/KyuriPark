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
    "cover": (1600, 1200),     # 4:3, the home grid ratio
    "wide": (2400, 1350),      # 16:9, hero and full-width images and videos
    "pair": (1200, 1500),      # 4:5, each image in a two-image row
    "portrait": (1200, 1500),  # 4:5, the About portrait
}
COVER_VIDEO_EXTS = (".mp4", ".webm")
OG_IMAGE_EXTS = (".jpg", ".jpeg", ".png")
MAX_ONE_LINER_WORDS = 8
LOADING_ATTRS = {"lazy": 'loading="lazy"', "eager": "", "high": 'fetchpriority="high"'}

PLACEHOLDER_RE = re.compile(r"\[PLACEHOLDER[^\]]*\]")
LINK_RE = re.compile(r"\[([^\]]+)\]\(((?:https?://|mailto:|/)[^)\s]*)\)")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


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


def need(obj, key, where):
    if not isinstance(obj, dict) or obj.get(key) in (None, ""):
        raise BuildError(f'{where}: "{key}" is missing.')
    return obj[key]


def link(href, label_html, cls=""):
    """An <a> tag. href and label_html must already be escaped.
    External links and PDFs open in a new tab and say so to screen readers."""
    attrs = f' class="{cls}"' if cls else ""
    is_pdf = href.lower().endswith(".pdf")
    if is_pdf or href.startswith(("http://", "https://")):
        note = "PDF, opens in a new tab" if is_pdf else "opens in a new tab"
        return (f'<a{attrs} href="{href}" target="_blank" rel="noopener">{label_html}'
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
    size = round(width / 32)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        '<rect width="100%" height="100%" fill="#ececea"/>\n'
        '<g font-family="-apple-system, \'Helvetica Neue\', Arial, sans-serif" '
        'fill="#6b6b69" text-anchor="middle">\n'
        f'<text x="50%" y="50%" font-size="{size}">{esc(title)}</text>\n'
        f'<text x="50%" y="50%" dy="{round(size * 1.6)}" font-size="{round(size * 0.55)}">'
        f'{esc(label)}</text>\n'
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

def validate(site, projects):
    """Stop on content problems that would break the site; return softer warnings."""
    for key in ("name", "role", "title", "description", "email", "linkedin", "github",
                "resume", "copyright", "about"):
        need(site, key, "content/site.json")
    if not isinstance(projects, list) or not projects:
        raise BuildError("content/projects.json should be a list of projects: [ {...}, {...} ].")

    warnings, seen = [], set()
    for i, p in enumerate(projects, 1):
        where = f"content/projects.json (project {i})"
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
    if not exists(site["resume"]):
        warnings.append(f"{site['resume']} not found, so the Resume link won't work yet.")
    if not site.get("siteUrl"):
        warnings.append('"siteUrl" in content/site.json is empty. Set it once the site has '
                        "an address, so link previews show the right image.")
    return warnings


# ---------------------------------------------------------------------------
# The build

class Builder:
    def __init__(self, site, projects):
        self.site = site
        self.projects = projects
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
             current=None, image=(None, None), noindex=False):
        s = self.site
        out = render(
            "base.html",
            page_title=esc(title),
            description=esc(description),
            head_meta=self.head_meta(path, title, description, image, noindex),
            css_version=file_version("assets/css/style.css"),
            js_version=file_version("assets/js/main.js"),
            site_name=esc(s["name"]),
            site_role=esc(s["role"]),
            nav_work={"home": ' aria-current="page"', "project": ' aria-current="true"'}.get(current, ""),
            nav_about=' aria-current="page"' if current == "about" else "",
            main_class=main_class,
            content=content,
            contact_links=self.contact_links("      "),
            copyright=esc(s["copyright"]),
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
        s = self.site
        items = [
            link(esc("mailto:" + s["email"]), esc(s["email"])),
            link(esc(s["linkedin"]), "LinkedIn"),
            link(esc(s["github"]), "GitHub"),
            link(url_for(s["resume"]), "Resume"),
        ]
        return "\n".join(f"{indent}<li>{item}</li>" for item in items)

    # Media ------------------------------------------------------------------

    def placeholder(self, rel, slot, title):
        """Write a labeled gray SVG in place of a missing file. Returns (url, (w, h))."""
        width, height = PLACEHOLDER_SIZES[slot]
        ph_rel = os.path.splitext(rel)[0] + ".placeholder.svg"
        self.write(ph_rel, placeholder_svg(width, height, title, os.path.basename(rel)))
        self.missing_media.add(rel)
        return url_for(ph_rel), (width, height)

    def img(self, rel, alt, slot, title, loading="lazy"):
        if not alt:
            self.warnings.append(f"{rel} has no alt text.")
        if exists(rel):
            size = media_size(rel)
            if not size:
                self.warnings.append(f"Couldn't read the size of {rel}, so the page may "
                                     "shift slightly while it loads.")
                size = PLACEHOLDER_SIZES[slot]
            src = url_for(rel)
        else:
            src, size = self.placeholder(rel, slot, title)
        attrs = [f'src="{src}"', f'alt="{esc(alt or "")}"', f'width="{size[0]}"',
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
        raise BuildError(f'{where}: unknown block type "{kind}". Use text, image, imagePair, or video.')

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
            if starts or not groups:
                groups.append((bool(starts), []))
            groups[-1][1].append(self.block(b, p, folder))
        out = []
        for headed, items in groups:
            tag = "section" if headed else "div"
            body = "\n          ".join(items)
            out.append(f'        <{tag} class="project-section">\n          {body}\n        </{tag}>')
        return "\n".join(out)

    def meta_rows(self, meta):
        rows = []
        for key, label in (("role", "Role"), ("timeline", "Timeline"), ("tools", "Tools")):
            value = meta.get(key)
            if isinstance(value, list):
                value = ", ".join(value)
            if value:
                rows.append((label, inline(value)))
        lk = meta.get("link")
        if lk and lk.get("url"):
            rows.append(("Link", link(esc(lk["url"]), esc(lk.get("label") or lk["url"]))))
        return "\n".join(f"          <div><dt>{k}</dt><dd>{v}</dd></div>" for k, v in rows)

    # Pages ------------------------------------------------------------------

    def card(self, p, index):
        folder = f"assets/images/{p['slug']}"
        cover = media_path(p["cover"]["src"], folder)
        img = self.img(cover, p["cover"].get("alt"), "cover", p["title"],
                       "eager" if index < 2 else "lazy")
        video = next((os.path.splitext(cover)[0] + ext for ext in COVER_VIDEO_EXTS
                      if exists(os.path.splitext(cover)[0] + ext)), None)
        data = f' data-video="{url_for(video)}"' if video else ""
        return (f'      <li>\n'
                f'        <a class="card" href="/work/{p["slug"]}/"{data}>\n'
                f'          <div class="card-media">{img}</div>\n'
                f'          <h2 class="card-title">{inline(p["title"])}</h2>\n'
                f'          <p class="card-text">{inline(p["oneLiner"])}</p>\n'
                f'        </a>\n'
                f'      </li>')

    def build_home(self):
        cards = "\n".join(self.card(p, i) for i, p in enumerate(self.projects))
        self.page("index.html", "home", "/", self.site["title"], self.site["description"],
                  render("home.html", cards=cards), "page-home", current="home",
                  image=self.og_image())

    def build_project(self, p, next_p):
        folder = f"assets/images/{p['slug']}"
        content = render(
            "project.html",
            title=inline(p["title"]),
            meta=self.meta_rows(p.get("meta") or {}),
            hero=("        " + self.block(p["hero"], p, folder, hero=True)) if p.get("hero") else "",
            blocks=self.sections(p.get("blocks") or [], p, folder),
            next_url=f"/work/{next_p['slug']}/",
            next_title=inline(next_p["title"]),
        )
        s = self.site
        self.page(f"work/{p['slug']}/index.html", p["slug"], f"/work/{p['slug']}/",
                  f"{p['title']} — {s['name']}",
                  f"{p['oneLiner']}. A project by {s['name']}, {s['role']}.",
                  content, "page-project", current="project", image=self.og_image(p))

    def build_about(self):
        s = self.site
        about = s["about"]
        portrait = need(about, "portrait", "content/site.json (about)")
        img = self.img(media_path(need(portrait, "src", "content/site.json (about.portrait)"),
                                  "assets/images/about"),
                       portrait.get("alt"), "portrait", s["name"], "high")
        paragraphs = []
        for i, text in enumerate(about.get("paragraphs") or []):
            cls = ' class="lead"' if i == 0 else ""
            paragraphs.append(f"        <p{cls}>{inline(text)}</p>")
        experience = []
        for row in about.get("experience") or []:
            experience.append(
                '        <li>'
                f'<span class="experience-company">{inline(row.get("company", ""))}</span>'
                f'<span class="experience-role">{inline(row.get("role", ""))}</span>'
                f'<span class="experience-dates">{inline(row.get("dates", ""))}</span>'
                '</li>')
        content = render("about.html", portrait="        " + img,
                         paragraphs="\n".join(paragraphs), experience="\n".join(experience),
                         contact_links=self.contact_links("        "))
        self.page("about/index.html", "about", "/about/", f"About — {s['name']}",
                  s["description"], content, "page-about", current="about",
                  image=self.og_image())

    def build_404(self):
        s = self.site
        self.page("404.html", "404", "/404.html", f"Page not found — {s['name']}",
                  s["description"], render("404.html"), "page-not-found", noindex=True)

    def report(self, seconds):
        pages = sum(1 for w in self.written if w.endswith(".html"))
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
    projects = load_json("projects.json")
    if local_url and not site.get("siteUrl"):
        site["siteUrl"] = local_url  # local preview: full links point at this server

    builder = Builder(site, projects)
    builder.warnings += validate(site, projects)
    os.makedirs(DIST_DIR, exist_ok=True)
    builder.copy_assets()
    builder.build_home()
    for i, p in enumerate(projects):
        builder.build_project(p, projects[(i + 1) % len(projects)])
    builder.build_about()
    builder.build_404()
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
