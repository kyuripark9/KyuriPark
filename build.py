#!/usr/bin/env python3
"""Build Kyuri Park's portfolio into dist/.

    python3 build.py           build once
    python3 build.py serve     build, serve at http://localhost:8000, rebuild on refresh
    python3 build.py images    make a smaller copy of each large image, for phones (macOS)

Content lives in content/*.json and page structure in templates/*.html.
Standard library only (Python 3.8+), so there is nothing to install.
"""

import argparse
import hashlib
import html
import io
import json
import math
import os
import re
import shutil
import socket
import struct
import subprocess
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
    "cover": (1440, 2000),     # 18:25, Work's tiles (--tile-ratio in style.css; README's size
                               # since 2026-11-13, here since 2026-11-14; 4:3, --thumb-ratio,
                               # before, which Home's cards keep, cropping it)
    "wide": (2400, 1350),      # 16:9, hero and full-width images and videos
    "pair": (1200, 1500),      # 4:5, each image in a two-image row
    "piece": (1440, 2000),     # 18:25, the images of an item with no page of its own, as a
                               # cover (4:3 until 2026-11-14)
    "archive": (1200, 1500),   # 4:5, an Archive image whose size can't be read
    "opening": (1200, 1600),   # 3:4, the print under the opening's sheet (cropped to the window)
}
# The gray boxes that stand in for Archive images in the lightbox until the files exist, in
# turn: 4:5, 1:1, 3:2, 3:4, 16:9, 2:3, 5:4, 3:5. Real images keep their own shape there. (On the
# page every tile is one shape since 2026-11-13, --tile-ratio in style.css.)
ARCHIVE_BOXES = ((1200, 1500), (1500, 1500), (1500, 1000), (1200, 1600),
                 (1600, 900), (1000, 1500), (1500, 1200), (900, 1500))
PIECE_FOLDER = "assets/images/pieces"
HEADER_LOGO = "assets/logo/logo-small.svg"  # the header's logo, inline (header_logo)
FOOTER_LOGO = "assets/logo/logo.svg"  # the footer's, large, with more lines (footer_logo)
ARCHIVE_FOLDER = "assets/images/archive"
ARCHIVE_COLUMNS = (2, 3, 3)  # Archive's columns on phones, from 768px, from 1200px (as in style.css)
# How wide an Archive image shows in its column, so the browser can take the smaller copy
# (001-small.jpg next to 001.jpg) when there is one. Edge to edge since 2026-11-13, so a third
# of the window from 768px, half on phones.
ARCHIVE_SIZES = "(min-width: 768px) 33vw, 50vw"
AXIS_LETTERS = "ABCDEFGH"  # a grid's columns, as an architect's axes are lettered
# The same for the other images (since 2026-11-09; only Archive's before), as style.css lays
# them out: the track's middle card (on Home, and Work's slider: from 768px, 62% of the
# window's height and up across, half of it down from 1200px, at 4:3, so about 67vh to 85vh
# wide, the larger taken; the page's width on phones), Work's tiles (1, 2, then 3 columns),
# images edge to edge or the page's width, and the two in a two-image row. Work's tiles run edge
# to edge since 2026-11-13: a third of the window from 768px, half on phones.
HOME_SIZES = "(min-width: 768px) 85vh, 100vw"
WORK_SIZES = "(min-width: 768px) 33vw, 50vw"
LEAD_SIZES = "(min-width: 768px) 67vw, 100vw"  # Work's tile two columns wide (WORK_LEAD)
WIDE_SIZES = "100vw"
PAIR_SIZES = "(min-width: 768px) 50vw, 100vw"
SMALL_SUFFIX = "-small"
# `python3 build.py images` makes the smaller copies: 1200px wide (enough for a phone at 3x and
# half a laptop's screen at 2x), or for Archive 800px on the long side, as its README part says;
# only for an image at least SMALL_WORTH times that, or the copy saves too little.
SMALL_WIDTH = 1200
ARCHIVE_SMALL_SIDE = 800
SMALL_WORTH = 1.25
SMALL_SOURCE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".avif")
COVER_VIDEO_EXTS = (".mp4", ".webm")
OG_IMAGE_EXTS = (".jpg", ".jpeg", ".png")
MAX_ONE_LINER_WORDS = 3
MIN_FEATURED, MAX_FEATURED = 3, 5  # how many projects Home should show
CATEGORIES = ("digital", "brand", "physical")  # Work's filters, in toggle order after All
# Whether Work shows its filters. Off since 2026-11-09: with a short list, All / Digital / Brand /
# Physical read as three careers, not one product designer's work. True brings them back as they
# were ("category" still sorts every item, so nothing else needs to change).
WORK_FILTERS = False
# What the site opens on. False (since 2026-11-12, the user's ask: the projects first, plainly,
# with Home's wheel hard to bring to a finish): Work's grid at /, with the opening over it
# (intro.js), and /work/ sends visitors on to /. True (2026-11-10 to 11-12, laid out from the
# user's own sketch): Home, at /: the intro sentence, the featured projects on a wheel
# (track.js), and the middle one's name; the grid at /work/. Home's code and styles stay, so
# True brings it back as it was.
HOME_TRACK = False
# Whether Work offers a second view of the same items (since 2026-11-10): two icons, grid and
# slider, at the right of the line over the grid, where the filters were (work_views). The
# slider is Home's track (track.js) with every item on Work, one at a time. The grid shows
# first; the browser remembers a visitor's pick (localStorage, main.js). False: the grid alone.
# Off since Home came back (HOME_TRACK), later the same day: Home's wheel is that slider now.
WORK_VIEWS = False
# Whether Work offers a ring (since 2026-11-12, the user's ask, after sarahsarazen.com/#projects):
# RING and GRID, as words at the right of the line over the grid (ring_views), and with RING the
# same items as objects on an oval ring that turns slowly (ring.js): each item's own object image
# ("object" in content/projects.json, a cutout on a clear background) or, until it has one, a
# shape (templates/ring.html). From 768px: on a phone the ring would be too small, so phones get
# the grid. The browser remembers a visitor's pick, as with WORK_VIEWS. False: the grid alone.
# Not together with WORK_VIEWS (one second view at a time).
# Off since 2026-11-13 (the user's ask: Work laid out as gougoucore.com's Work, a sentence over
# the grid and the grid edge to edge, with no switch). True brings the ring and its switch back,
# the switch on its line under the sentence.
WORK_RING = False
# Which shows to a visitor who hasn't picked: the ring (True, since 2026-11-12, the user's ask, the
# same evening), or the grid (False). Phones, and browsers without JavaScript, get the grid.
RING_FIRST = True
# The ring's places at the least: with fewer items they go around more than once (8 items: twice),
# each coming again on the far side, as on sarahsarazen.com's.
RING_MIN_SLOTS = 16
RING_SHAPES = 8  # the stand-in shapes in templates/ring.html, #ring-shape-1 to -8
# Drawing sheets (a mock since 2026-11-22, the user's ask: a visual identity from their own story,
# the architect they wanted to be as a kid, in About's Q&A): a project's page drawn as an
# architect's drawing sheet. Its facts become a title block, cells in 1px lines in Work's columns:
# Role, Team, and its timeline as a line of events ("milestones": a year and a note each; see
# sheet_meta for the Scale cell and the logo's stamp, there until 2026-11-26). Each section's
# heading is a detail callout: a circle split by a line, the section's number over the sheet's.
# Previous / Next show the sheets' numbers. On Light Life alone first (the mock), on every project
# page since the same day (the user liked it). True: every project page; or a tuple of slugs, like
# ("light-life",); False or (): none, the facts as a row as before.
SHEET_PROJECTS = True
# The footer's logo with its key (since 2026-11-22, the user's ask: the logo's story, as on a
# drawing sheet's stamp), from 768px; on phones the logo alone (the words wouldn't fit beside
# each other at its size). False: the logo alone everywhere.
FOOTER_KEY = True
# Work's and Archive's grids with an architect's axis bubbles over them (axes; Work's since
# 2026-11-22, the user's ask, with the drawing sheets; Archive's the same day, the drawing system
# taken across the site): a circle over the middle of each column, A, B (and C from 768px), a
# center line down from it to the grid's top line. False: none (since 2026-11-25, the user's
# ask: on Work they named nothing, the columns mean nothing, and the user couldn't read them).
GRID_AXES = False
# Work's tile two columns wide (since 2026-11-26, the user's pick, to close the last row: with 5
# items it was a hole; a tile leading on to the Archive was tried there the same morning, the bare
# paper with words, then nine of its images, and dropped, unfinished, then dated): the item marked
# "wide": true in content/projects.json. Editorial Collection, the last, since later that day (the
# user's ask: the big box for the item that holds many works, its title saying so), so from 768px
# NBCUniversal and it are the second row, and on phones it's the last row to itself. Before that,
# the same day, Light Life: first, then second after TypeLab (on phones the row under TypeLab and
# Clack, numbered in that order). It can stand anywhere: the grid fills a hole the wide tile
# leaves with a later tile (dense), work_layout finds where each tile stands at 3 across and at 2,
# and from that its number as seen (counting down the page at both widths) and the lines. Its
# image is a project's "coverWide" if given, else its cover, cropped wider; an item with no page
# shows its first two images side by side (WIDE_PAIR). False: every tile one column.
WORK_LEAD = True
# The wide tile of an item with no page (WORK_LEAD): its first two images side by side, each the
# shape of one tile, so it looks like more than one work (since 2026-11-26, Editorial Collection's
# two posters, the user's ask that it feel like a place holding many works). False: its first
# image alone, cropped wider.
WIDE_PAIR = True
# Archive drawn as a plan (since 2026-11-22, the user's ask: the drawing system and their story
# in one page): content/site.json's "scales" are its columns, named axis bubbles A, B, C, D
# (Object, Page, Screen, Space); each image in archive.json says its "scale" and stands in that
# column, numbered down it, A01, A02... (archive_plan). (Places down the side, Korea,
# Philadelphia, Chicago, Anywhere, for an hour that day: the user found them unneeded.)
# False, or no "scales" in site.json: the plain gallery, every image in the file's order.
ARCHIVE_PLAN = True
# Archive as a binder of tracing-paper sheets, a sheet a scale, punched down its edge, its
# images loose on it, the sheets laid one over another as the page scrolls (since 2026-11-23,
# the user's ask: Archive with more of who they are and a story; archive_binder). Over
# ARCHIVE_PLAN when both are on.
ARCHIVE_BINDER = True
# Archive as one drawing that tells one story (since 2026-11-24, the user's ask, from an
# architecture student's sheet on their Pinterest, "Across the Arid Landscape": a masterplan's
# sequence drawn down one axis, fragments of images collaged along it, numbered stations I to IX
# called out at the side, the photos grouped by brackets, a scale bar and a legend at the foot):
# one axis down the page, the scales in order along it, A Object to D Space, every image a
# station on it, numbered I, II, III in the story's order, its words at the side on a dashed
# leader; each scale's name, field and line at the left in a bracket; the axis solid for what
# the user studied and worked in, dashed for Space, the architect they wanted to be, with where
# their life came near it marked on it and "I never became one." where it ends; under it a scale
# bar of the four scales and the legend (archive_sequence). Over ARCHIVE_BINDER and ARCHIVE_PLAN
# when on. False: the binder.
ARCHIVE_SEQUENCE = True
# How wide a station's image shows: up to about a third of the window from 1200px (the axis's
# side, at Space's width), most of it on phones.
SEQUENCE_SIZES = "(min-width: 1200px) 32vw, (min-width: 768px) 64vw, 90vw"
# Archive as one map (since 2026-11-24, the user's ask: Archive shows their work and who they
# are in images more than words, as one map rather than a list, after an architecture
# student's narrative sheet; that evening closer together, more joined, and in time's order,
# after the masterplan sequence on their moodboard; that night free, their interests across
# fields and their eye, not sorted into A B C D): every image on one sheet, oldest first, big
# and small, left and right as on a pinboard, overlapping a little, and one dashed thread
# through them in that order, pin to pin, each pin with its number, 01, 02 (and its date when
# it has one); no other words (captions are in the lightbox). Drawn twice, from 768px and on
# phones (archive_map, map_layout). (That afternoon the scales fanned over "How people
# actually live"; that evening each scale had a lane at the right, Space's dashed.) Over
# ARCHIVE_SEQUENCE, ARCHIVE_BINDER and ARCHIVE_PLAN when on. False: the sequence.
ARCHIVE_MAP = True
# The map's order (since 2026-11-25, the user's ask: "group the same field and the same project
# together"): by field, in site.json's "scales" order (Object, Page, Screen, Space), and within a
# field each project's images side by side (an image's "project" in archive.json; one without is
# a project of its own), a field's projects oldest first; a wider gap between fields, and still
# no lanes or names on the map (the user turned those down on 2026-11-24). False: time's order.
ARCHIVE_MAP_GROUPS = True
# The map as a board of groups (since 2026-11-25, the user's ask with a moodboard page: "group
# them more clearly and cleanly, like this"): a group a field, each a tight collage under its
# title (the scale's name, its field beside it), in two columns from 768px and one on phones;
# a project's images in a row of their own, circled loosely by a 1px line with the project's
# name and year on it; no thread or numbers. Needs ARCHIVE_MAP_GROUPS. False: the groups'
# map above (bands, a thread through them, numbers).
ARCHIVE_MAP_BOARD = True
# How wide a map's image shows: up to about a third of the window from 768px (the biggest),
# two thirds on phones.
MAP_SIZES = "(min-width: 768px) 34vw, 66vw"
# Archive as one grid with no gaps (since 2026-11-26, the user's asks, after the expressive
# layouts were hard to make both theirs and good-looking: a clean grid, the drawing system in its
# details; then "with no gaps, like gougoucore.com/13/", its Lab): every image, by field and
# project, edge to edge right under the header, Work's columns, solid black 1px lines between
# them (construction lines and + marks for an hour, then, at the user's ask, as gougoucore's),
# nothing under the images (the lightbox has the captions); every cell Work's tiles' height
# (ARCHIVE_ROW_RATIOS), and where the last row wouldn't be full, a landscape image spans two
# columns (archive_grid, flow_rows). Over every layout above when on. (The same morning, for an
# hour, a section a field under its name, a bar with a number and the project under each image.)
# False: the board.
ARCHIVE_GRID = True
ARCHIVE_GRID_COLS = (2, 3)  # on phones, from 768px (as in style.css: Work's)
# The shapes a row of Archive's grid can take, a cell's width over its height, each row taking
# the one that crops its images least. One since later on 2026-11-26 (the user's ask: every cell
# one height): Work's tiles' 18:25, so the two pages share one rhythm (18:25 to 5:4 crop about
# as much, a quarter of each image on average). For an hour before, three, tall as Work's, square
# or low (18 / 25, 1, 5 / 4), as gougoucore.com's Lab's rows are tall or low.
ARCHIVE_ROW_RATIOS = (18 / 25,)
WIDE_MIN_PX = 1200  # an image narrower than this is a poor pick to span two columns (blurred)
# About's scales (since 2026-11-22, the user's ask: About carrying the drawing system and their
# story): under the paragraph, site.json's "scales" as a title block, a cell each, A to D, its
# bubble and name, the field it comes from and a line of the user's own account, and a link to
# its column on Archive (about_scales). False: none.
ABOUT_SCALES = True
# About's scales drawn as orbits round what they share, over (beside, from 1200px) their cells
# (since 2026-11-23, the user's moodboard; build.py's orbits). Needs ABOUT_SCALES.
ABOUT_ORBITS = True
# ...drawn in 3D, as a globe that turns (since 2026-11-24, the user's ask, from an orbit diagram
# turning in 3D on their Pinterest), and, the same day, the whole section, the user as a designer
# in one simple picture: the scales as orbits tilted each its own way round what their work is
# about, the cells kept for screen readers (build.py's globe, assets/js/globe.js). False: the
# orbits flat, still, beside the cells. Needs ABOUT_ORBITS.
ABOUT_GLOBE = True
# The globe's key as paragraphs (since 2026-11-25 evening, the user's ask: cleaner, without the
# boxes): each group's heading, then its lines as one paragraph, no words or works beside them
# (globe_key). False: a box ruled in ink lines, a cell a word, its work at its right.
GLOBE_KEY_PROSE = True
# The globe and its key held in the window while the page scrolls on (since 2026-11-26, the
# user's go-ahead: nothing happened as the page scrolled, and the globe was gone before its
# key's last part was read; the key's parts spread out beside a held globe left too much empty
# paper, the user's ask the same day): from 1200px the section a window's height under the
# header, the globe sized to fit, stuck there while the page scrolls a further 120% of the
# window, over which the key's parts light their parts of the drawing in turn, a third each
# (globe.js read(), style.css .is-scrolly). False: side by side, scrolling as one. (Off since
# later that day, the user's ask: About's parts laid over one another instead, ABOUT_SHEETS.)
GLOBE_SCROLL = False
# About's parts as a binder's sheets, as Archive's are (since 2026-11-26, the user's ask: rather
# the sections stacking up as the page scrolls): the paragraph, the globe and the Q&A each
# stays as the page scrolls on, under the header or, if taller than the window, where its foot
# meets the window's foot, and the next is laid over it on tracing paper, the one under showing
# through, soft (main.js sets --sheet-top; style.css .about-sheets). From 1200px the globe's
# sheet is a window tall, the globe as big as fits. False: they scroll by one after another.
ABOUT_SHEETS = True
# About's identity sheet (since 2026-11-25 night, the user's ask, from a moodboard poster: a
# collage on tracing paper, prints under the sheet, construction lines and + marks in ink over
# them, numbered parts in a mono, big type): the site's own identity drawn on one sheet after
# the Q&A, from site.json's "identity": the logo with its construction and key, the website's
# pages as prints the ink traces, the type, the paper and ink, and the drawing's parts
# (about_identity). False: none. (Off since the same night, the user's ask: it read as a design
# system; ABOUT_POSTER in its place.)
ABOUT_IDENTITY = False
# About's Q&A as a poster (since 2026-11-25 night, the user's ask, after the same moodboard
# poster: its visual language, the Q&A for its words, all of it on one screen): after the Q&A,
# a sheet one screen tall, the six questions laid out on tracing paper as that poster's parts
# are, from site.json's "qaPoster" (about_poster, Poster). False: none. (Off since the same
# night, the user's ask: it said again what the Q&A over it says; QA_LOGO in its place.)
ABOUT_POSTER = False
# Behind About's Q&A, the logo, huge, soft and faint, as if under the tracing paper the page is
# (since 2026-11-25 night, the user's ask, in place of the Q&A poster, whose under-the-paper
# logo it keeps; about_qa). False: none.
QA_LOGO = True
# The opening's words take on the tracing paper as ink does (since 2026-11-24 night, the user's
# ask, from a photocopied sheet of heavy type and a typewriter's mono printed over a photo): one
# SVG filter, #intro-ink, on the words (style.css, "Home intro"), in CSS pixels at the opening's
# 12 to 14px: how far the paper's fibers pull the letters' edges (fiber, the noise's fineness;
# ragged, how far, in px); how much the ink pools (pool, a blur, and spread, where the blurred
# ink's edge is cut: lower, heavier strokes and more of the narrowest gaps filled); how unevenly
# it takes (blotch, the blotches' size as a noise's fineness, across and down; faint, how much
# lighter the lightest is; specks, how many specks where none took, as the level of a noise
# (about 0.2 to 0.8) under which none did: 0 for none); how far it bleeds into the
# paper round each letter (bleed, a blur, and bleed_ink, how strong); and how soft the whole
# print is (soft). The noise is fixed to the words, so a letter's texture holds as it's typed.
# (That night at first heavier: ragged 1.6, pool 0.7, spread 0.12, faint 0.3, specks 0.28; the
# user found it too much and untidy, too bold, round and full of holes.)
# (Until 2026-11-25 faint 0.25 and specks 0.2: the user asked for one even black, the gray in
# the blotches and specks mixed with the black looking awkward; then ragged 1.2, pool 0.5 and
# soft 0.3, until the user asked for the letters less rounded, the same day.)
INTRO_INK = {"fiber": 0.75, "ragged": 0.8, "pool": 0.3, "spread": 0.22,
             "blotch": "0.045 0.09", "faint": 0, "specks": 0,
             "bleed": 1.6, "bleed_ink": 0.4, "soft": 0.25}
LOADING_ATTRS = {"lazy": 'loading="lazy"', "eager": "", "high": 'fetchpriority="high"'}
# Old addresses that now live elsewhere: /contact/ was a menu item and is now About's Contact
# label, with the footer's links under it.
# Each becomes <old>/index.html, which sends the visitor on (build_redirects).
REDIRECTS = {"contact": ("/about/#contact", "Contact")}
if not HOME_TRACK:
    REDIRECTS["work"] = ("/", "Work")  # Work is the first page (HOME_TRACK)

PLACEHOLDER_RE = re.compile(r"\[PLACEHOLDER[^\]]*\]")
LINK_RE = re.compile(r"\[([^\]]+)\]\(((?:https?://|mailto:|/)[^)\s]*)\)")
EMPHASIS_RE = re.compile(r"\*([^*]+)\*")  # *words* in Work's sentence, in the accent face
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NUMBER_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
YEAR_RE = re.compile(r"\b(?:19|20)\d\d\b")


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


def small_copy(rel):
    """The smaller copy next to an image, if there is one: 001-small.jpg for 001.jpg, and for
    001.webp either 001-small.webp or 001-small.jpg (the Mac's sips, which `python3 build.py
    images` uses, reads WebP and AVIF but can't write them)."""
    stem, ext = os.path.splitext(rel)
    for candidate in dict.fromkeys((ext, ".jpg")):
        if exists(stem + SMALL_SUFFIX + candidate):
            return stem + SMALL_SUFFIX + candidate
    return None


def small_target(rel, size):
    """How `python3 build.py images` sizes an image's smaller copy, as sips arguments, or None if
    the image is small enough already."""
    if rel.startswith(ARCHIVE_FOLDER + "/"):
        if max(size) > ARCHIVE_SMALL_SIDE * SMALL_WORTH:
            return ["-Z", str(ARCHIVE_SMALL_SIDE)]
        return None
    return ["--resampleWidth", str(SMALL_WIDTH)] if size[0] > SMALL_WIDTH * SMALL_WORTH else None


def archive_first_screen(n):
    """The Archive images to load right away: the first row, for the most columns there are
    (rows fill from left to right since 2026-11-13; until then columns filled from top to
    bottom, so it was the top one in each column)."""
    return set(range(min(n, max(ARCHIVE_COLUMNS))))


def need(obj, key, where):
    if not isinstance(obj, dict) or obj.get(key) in (None, ""):
        raise BuildError(f'{where}: "{key}" is missing.')
    return obj[key]


def link(href, label_html, cls="", rel="noopener"):
    """An <a> tag. href and label_html must already be escaped.
    External links and PDFs open in a new tab and say so to screen readers. CSS ends them in a
    ↗ hung on their last word (.link-end), which keeps on one line with it, so the arrow never
    wraps alone. A label with markup in it is kept whole, so no tag is split."""
    attrs = f' class="{cls}"' if cls else ""
    is_pdf = href.lower().endswith(".pdf")
    if is_pdf or href.startswith(("http://", "https://")):
        note = "PDF, opens in a new tab" if is_pdf else "opens in a new tab"
        label_html = label_html.strip()
        head, space, tail = ("", "", label_html) if "<" in label_html else label_html.rpartition(" ")
        return (f'<a{attrs} href="{href}" target="_blank" rel="{rel}">{head}{space}'
                f'<span class="link-end">{tail}</span>'
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


def archive_link(item, hidden=False):
    """An Archive image's "link" ({"label", "url"}, optional; since 2026-11-25, the user's ask:
    the full project's PDF for work that's on Archive as images alone), after its date in the
    lightbox, where it's never cut short. hidden: in text only the lightbox shows (the map's),
    so out of the page's Tab order; main.js puts it back in once it's in the lightbox."""
    if not item.get("link"):
        return ""
    a = link(esc(item["link"]["url"]), esc(item["link"].get("label") or "See full project"))
    return a.replace("<a ", '<a tabindex="-1" ', 1) if hidden else a


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


def placeholder_svg(width, height, title, label, dark=False):
    """A soft gray block with the project name, and the file it's waiting for underneath. A shade
    under the tracing paper (since 2026-11-23, style.css's --color-fill); neutral grays on the
    white page from 2026-11-14, warm, #e6e5df, for the off-white page before. dark=True (the
    opening's picture, since 2026-11-24) is a deep gray, so that it shows through the sheet as
    a picture would."""
    size = round(min(min(width, height) / 18, width * 1.5 / max(len(title), 1)))  # long names shrink
    fill, ink, note = ("#4a4945", "#a8a7a1", "#8a8984") if dark else ("#e2e1db", "#5e5d59", "#86857f")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        f'<rect width="100%" height="100%" fill="{fill}"/>\n'
        '<g font-family="-apple-system, \'Helvetica Neue\', Arial, sans-serif" text-anchor="middle">\n'
        f'<text x="50%" y="50%" font-size="{size}" font-weight="500" fill="{ink}">'
        f'{esc(title)}</text>\n'
        f'<text x="50%" y="50%" dy="{round(size * 1.4)}" font-size="{round(size * 0.45)}" '
        f'fill="{note}">{esc(label)}</text>\n'
        '</g>\n</svg>\n'
    )


def intro_ink(ink=INTRO_INK):
    """The opening's ink filter, #intro-ink (INTRO_INK has its numbers), in an SVG of its own
    with nothing to see, for style.css's url("#intro-ink"). In order: the letters' edges pulled
    ragged by a fine noise; the ink pooled, a blur cut back to a crisp edge further out, so the
    strokes come out heavier and the narrowest gaps fill; then, if faint or specks is on, taken
    unevenly, faint in blotches and missing in specks, two noises multiplied into it (both off
    since 2026-11-25: one even black); a soft bleed of it under the letters; and the whole a
    touch soft."""
    pool_slope = 4  # how sharply the pooled ink's edge is cut: full ink a quarter further in
    n = lambda v: f"{v:.4g}"
    uneven = ""
    printed = "inked"
    if ink["faint"] or ink["specks"]:
        faint = ink["faint"]
        # Where the blotches' noise (about 0.2 to 0.8) is 0.35 or less, the ink is faint less
        # strong; at 0.6 or more, full; between, in proportion.
        blotch_slope = faint / 0.25
        blotch_at = 1 - faint - blotch_slope * 0.35
        # Where the specks' noise (about 0.2 to 0.8) is under specks, no ink took; full ink
        # 0.1 over that.
        speck_at = ink["specks"]
        uneven = (
            f'<feTurbulence type="fractalNoise" baseFrequency="{ink["blotch"]}" numOctaves="2"'
            ' seed="3" result="blotchNoise"/>'
            '<feColorMatrix in="blotchNoise" type="matrix"'
            f' values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 {n(blotch_slope)} 0 0 0 {n(blotch_at)}"'
            ' result="blotch"/>'
            '<feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="11"'
            ' result="speckNoise"/>'
            '<feColorMatrix in="speckNoise" type="matrix"'
            f' values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 10 0 0 0 {n(-10 * speck_at)}"'
            ' result="speck"/>'
            '<feComposite in="blotch" in2="speck" operator="in" result="took"/>'
            '<feComposite in="inked" in2="took" operator="in" result="printed"/>')
        printed = "printed"
    return (
        '      <svg class="intro-ink-defs" aria-hidden="true" focusable="false">'
        '<filter id="intro-ink" x="-4%" y="-20%" width="108%" height="140%"'
        ' color-interpolation-filters="sRGB">'
        f'<feTurbulence type="fractalNoise" baseFrequency="{n(ink["fiber"])}" numOctaves="2"'
        ' seed="7" result="fiber"/>'
        f'<feDisplacementMap in="SourceGraphic" in2="fiber" scale="{n(ink["ragged"])}"'
        ' xChannelSelector="R" yChannelSelector="G" result="ragged"/>'
        f'<feGaussianBlur in="ragged" stdDeviation="{n(ink["pool"])}" result="pooled"/>'
        '<feComponentTransfer in="pooled" result="inked">'
        f'<feFuncA type="linear" slope="{pool_slope}" intercept="{n(-pool_slope * ink["spread"])}"/>'
        '</feComponentTransfer>'
        f'{uneven}'
        f'<feGaussianBlur in="{printed}" stdDeviation="{n(ink["bleed"])}" result="wide"/>'
        '<feComponentTransfer in="wide" result="bleed">'
        f'<feFuncA type="linear" slope="{n(ink["bleed_ink"])}"/>'
        '</feComponentTransfer>'
        f'<feMerge result="wet"><feMergeNode in="bleed"/><feMergeNode in="{printed}"/></feMerge>'
        f'<feGaussianBlur in="wet" stdDeviation="{n(ink["soft"])}"/>'
        '</filter></svg>\n')


def num(v):
    """A number for an SVG attribute: one decimal at most, no trailing zero."""
    return f"{v:.1f}".rstrip("0").rstrip(".")


def wrap(text, chars):
    """Words in lines of at most chars characters (a mono's lines: every letter one width)."""
    lines, line = [], ""
    for word in text.split():
        if line and len(line) + 1 + len(word) > chars:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}" if line else word
    return lines + [line] if line else lines


class Poster:
    """About's Q&A as a poster (ABOUT_POSTER): one SVG, drawn in its own units (w x h) and
    shown as big as one screen allows, so every piece keeps its place at any size. Two layers:
    under the paper (deep: soft, faint, as a print seen through tracing paper) and over it
    (ink). The text is in the site's faces: IBM Plex Mono, whose every letter is 0.6 of its
    size across, so its lines are wrapped here, and Source Serif Display. Ids carry the
    poster's key, so the wide and tall posters can share a page."""
    MONO = 0.6

    def __init__(self, key, w, h):
        self.key, self.w, self.h = key, w, h
        self.deep, self.ink, self.defs = [], [], []

    def id(self, name):
        return f"qp-{self.key}-{name}"

    def put(self, svg, deep=False):
        (self.deep if deep else self.ink).append(svg)

    def mono(self, x, y, text, size, width=None, anchor="start", lead=1.4, cls="", caps=True,
             deep=False):
        """Mono text from its first baseline at y, wrapped to width; the last baseline."""
        t = text.upper() if caps else text
        lines = wrap(t, max(int(width / (self.MONO * size)), 1)) if width else [t]
        step = size * lead
        spans = "".join(f'<tspan x="{num(x)}" dy="{num(step) if i else 0}">{esc(line)}</tspan>'
                        for i, line in enumerate(lines))
        end = f' text-anchor="{anchor}"' if anchor != "start" else ""
        self.put(f'<text class="qp-mono{" " + cls if cls else ""}" x="{num(x)}" y="{num(y)}" '
                 f'font-size="{num(size)}"{end}>{spans}</text>', deep)
        return y + step * (len(lines) - 1)

    def serif(self, x, y, text, size, italic=False, anchor="start", cls="", deep=False):
        end = f' text-anchor="{anchor}"' if anchor != "start" else ""
        kind = " is-italic" if italic else ""
        self.put(f'<text class="qp-serif{kind}{" " + cls if cls else ""}" x="{num(x)}" '
                 f'y="{num(y)}" font-size="{num(size)}"{end}>{esc(text)}</text>', deep)

    def path(self, d, cls="qp-line", deep=False):
        self.put(f'<path class="{cls}" d="{d}"/>', deep)

    def rect(self, x, y, w, h, cls, rx=0, deep=False):
        r = f' rx="{num(rx)}"' if rx else ""
        self.put(f'<rect class="{cls}" x="{num(x)}" y="{num(y)}" width="{num(w)}" '
                 f'height="{num(h)}"{r}/>', deep)

    def cross(self, x, y, arm, cls="qp-line"):
        self.path(f"M{num(x - arm)} {num(y)}H{num(x + arm)}M{num(x)} {num(y - arm)}V{num(y + arm)}",
                  cls)

    def checker(self, x, y, s):
        """A small square, two of its quarters filled, as a print's registration patch."""
        h = s / 2
        self.rect(x, y, s, s, "qp-line")
        self.rect(x, y, h, h, "qp-fill")
        self.rect(x + h, y + h, h, h, "qp-fill")

    def head(self, x, y, w, no, question, size):
        """A question's heading: a filled square, its number (01°), the question, a line
        under them all; the line's y."""
        s = size * 0.62
        self.rect(x, y - s, s, s, "qp-fill")
        at = x + s + size * 0.55
        self.mono(at, y, f"{no:02d}°", size)
        at += self.MONO * size * 4.5
        last = self.mono(at, y, question, size, width=x + w - at)
        rule = last + size * 0.65
        self.path(f"M{num(x)} {num(rule)}H{num(x + w)}")
        return rule

    def frame(self, x, y, w, h, label=None, size=11, arm=9):
        """A frame drawn on the sheet: its lines run past its corners, a + at each; its label,
        [1], in its middle."""
        self.path(f"M{num(x - arm)} {num(y)}H{num(x + w + arm)}M{num(x - arm)} {num(y + h)}"
                  f"H{num(x + w + arm)}M{num(x)} {num(y - arm)}V{num(y + h + arm)}"
                  f"M{num(x + w)} {num(y - arm)}V{num(y + h + arm)}")
        if label:
            self.mono(x + w / 2, y + h / 2 + size * 0.35, label, size, anchor="middle")

    def rows(self, x, y, w, items, size, h, gap, stack=False):
        """Rows in rounded outlines, a name at the left and its value at the right (stacked:
        the value under the name); the y under the last."""
        for name, value in items:
            self.rect(x, y, w, h, "qp-line", rx=min(h * 0.22, 8))
            if stack:
                self.mono(x + size * 0.8, y + h / 2 - size * 0.25, name, size)
                self.mono(x + size * 0.8, y + h / 2 + size * 1.05, value, size, cls="is-quiet")
            else:
                base = y + h / 2 + size * 0.36
                self.mono(x + size * 0.8, base, name, size)
                self.mono(x + w - size * 0.8, base, value, size, anchor="end", cls="is-quiet")
            y += h + gap
        return y - gap

    def pills(self, cx, y, words, size, gap):
        """Words standing up the page in pills, one over the next on a line, a ring at its
        end; the y at the ring's foot."""
        pw, pad = size * 1.9, size * 0.9
        for i, word in enumerate(words):
            ph = len(word) * self.MONO * size + 2 * pad
            if i:
                self.path(f"M{num(cx)} {num(y - gap)}V{num(y)}")
            self.rect(cx - pw / 2, y, pw, ph, "qp-pill", rx=pw / 2)
            self.put(f'<text class="qp-mono" font-size="{num(size)}" text-anchor="middle" '
                     f'dy="0.36em" transform="translate({num(cx)} {num(y + ph / 2)}) rotate(90)">'
                     f'{esc(word.upper())}</text>')
            y += ph + gap
        r = size * 0.6
        self.path(f"M{num(cx)} {num(y - gap)}V{num(y)}")
        self.put(f'<circle class="qp-line" cx="{num(cx)}" cy="{num(y + r)}" r="{num(r)}"/>'
                 f'<circle class="qp-fill" cx="{num(cx)}" cy="{num(y + r)}" r="{num(r * 0.4)}"/>')
        return y + 2 * r

    def ring(self, cx, cy, r, text, size):
        """Words round a ring, twice, a dot after each, a ring inside, and an X across all."""
        rid = self.id("ring")
        words = esc(" · ".join([text.upper()] * 2) + " · ")
        self.defs.append(f'<path id="{rid}" d="M{num(cx - r)} {num(cy)}a{num(r)} {num(r)} 0 1 1 '
                         f'{num(2 * r)} 0a{num(r)} {num(r)} 0 1 1 {num(-2 * r)} 0"/>')
        self.put(f'<text class="qp-mono" font-size="{num(size)}"><textPath href="#{rid}" '
                 f'textLength="{num(2 * math.pi * r)}" lengthAdjust="spacing">{words}</textPath>'
                 '</text>')
        inner = r - size * 0.55
        self.put(f'<circle class="qp-line" cx="{num(cx)}" cy="{num(cy)}" r="{num(inner)}"/>')
        d = (r + size * 2.2) * math.cos(math.radians(45))
        self.path(f"M{num(cx - d)} {num(cy - d)}L{num(cx + d)} {num(cy + d)}"
                  f"M{num(cx + d)} {num(cy - d)}L{num(cx - d)} {num(cy + d)}")

    def image(self, x, y, w, h, href):
        """An image printed on the sheet in grays, multiplied in, in a frame."""
        gray = self.id("gray")
        if not any(gray in d for d in self.defs):
            self.defs.append(f'<filter id="{gray}"><feColorMatrix type="saturate" values="0"/>'
                             '</filter>')
        self.put(f'<image class="qp-print" href="{esc(href)}" x="{num(x)}" y="{num(y)}" '
                 f'width="{num(w)}" height="{num(h)}" preserveAspectRatio="xMidYMid slice" '
                 f'filter="url(#{gray})"/>')
        self.frame(x, y, w, h, arm=7)

    def net(self, cx, y, names, middle, size, spread):
        """Fields as boxes in a row, each joined to one middle under them by a dashed line;
        the middle's name under it. The y under it."""
        h = size * 2.1
        node = y + h + size * 3.6
        n = len(names)
        for i, name in enumerate(names):
            bx = cx + (i - (n - 1) / 2) * spread
            bw = len(name) * self.MONO * size + size * 1.6
            self.rect(bx - bw / 2, y, bw, h, "qp-line")
            self.mono(bx, y + h / 2 + size * 0.36, name, size, anchor="middle")
            self.path(f"M{num(bx)} {num(y + h)}L{num(cx)} {num(node - 7)}", "qp-line qp-dash")
        self.put(f'<circle class="qp-line" cx="{num(cx)}" cy="{num(node)}" r="7"/>')
        self.cross(cx, node, 12)
        return self.mono(cx, node + size * 2.4, middle, size, anchor="middle")

    def dims(self, x, y, w, years, size, widths, notes=True):
        """Years along a dimension line, spaced by the time between them: at each a slash and
        a short upright, the year over the line, its note under it, wrapped to its width."""
        ys = [int(a) for a, _ in years]
        span = max(ys[-1] - ys[0], 1)
        self.path(f"M{num(x)} {num(y)}H{num(x + w)}")
        for i, ((year, note), width) in enumerate(zip(years, widths)):
            at = x + (int(year) - ys[0]) / span * w
            self.path(f"M{num(at - 5)} {num(y + 5)}L{num(at + 5)} {num(y - 5)}"
                      f"M{num(at)} {num(y - 9)}V{num(y + 9)}")
            last = i == len(years) - 1
            anchor, tx = ("end", at - 4) if last else ("start", at + 4)
            self.mono(tx, y - 9, year, size, anchor=anchor)
            if notes:
                self.mono(tx, y + size * 2, note, size, width=width, anchor=anchor,
                          cls="is-quiet")

    def logo(self, x, y, w, parts, cls, deep=False):
        (x0, y0, lw, lh), shapes = parts
        self.put(f'<svg class="{cls}" x="{num(x)}" y="{num(y)}" width="{num(w)}" '
                 f'height="{num(w * lh / lw)}" viewBox="{num(x0)} {num(y0)} {num(lw)} {num(lh)}">'
                 f'{shapes}</svg>', deep)

    def sheet(self, cols, rows, inset=10, inner=34):
        """A drawing sheet's border: a thin outer line, a heavy inner one, and between them
        its zones, numbered across (1, 2, 3) and lettered down (A, B, C), as a drawing's
        are, so a part can be found by its place."""
        w, h = self.w, self.h
        self.rect(inset, inset, w - 2 * inset, h - 2 * inset, "qp-line")
        self.rect(inner, inner, w - 2 * inner, h - 2 * inner, "qp-line qp-heavy")
        band = inner - inset
        mid = inset + band / 2 + 4
        size = band * 0.42
        across, down = (w - 2 * inner) / cols, (h - 2 * inner) / rows
        for i in range(cols):
            x = inner + i * across
            if i:
                self.path(f"M{num(x)} {num(inset)}V{num(inner)}M{num(x)} {num(h - inner)}"
                          f"V{num(h - inset)}")
            for y in (mid, h - inset - band / 2 + 4):
                self.mono(x + across / 2, y, str(i + 1), size, anchor="middle", cls="is-quiet")
        for i in range(rows):
            y = inner + i * down
            if i:
                self.path(f"M{num(inset)} {num(y)}H{num(inner)}M{num(w - inner)} {num(y)}"
                          f"H{num(w - inset)}")
            for x in (inset + band / 2, w - inset - band / 2):
                self.mono(x, y + down / 2 + 4, "ABCDEFGH"[i], size, anchor="middle",
                          cls="is-quiet")

    def title_block(self, x, y, w, h, cells, size):
        """The sheet's title block: a row of cells under a heavy line, each a small label
        over its value (cells: (width, label, value, kind), kind "big" for a value in the
        display face, or a callable drawing into the cell)."""
        self.path(f"M{num(x)} {num(y)}H{num(x + w)}", "qp-line qp-heavy")
        at = x
        for i, (cw, label, value, kind) in enumerate(cells):
            if i:
                self.path(f"M{num(at)} {num(y)}V{num(y + h)}")
            if label:
                self.mono(at + size, y + size * 1.7, label, size * 0.8, cls="is-quiet")
            if callable(kind):
                kind(at, y, cw, h)
            elif kind == "big":
                self.serif(at + size * 0.9, y + h - size * 1.1, value, h * 0.56)
            elif value:
                self.mono(at + size, y + h - size * 1.2, value, size)
            at += cw

    def bubble(self, x, y, r, label, size):
        self.put(f'<circle class="qp-line qp-paper" cx="{num(x)}" cy="{num(y)}" r="{num(r)}"/>')
        self.mono(x, y + size * 0.36, label, size, anchor="middle")

    def grid(self, xs, labels, top, foot, r, size, dims=None, dim_y=None):
        """Column lines, dash and dot, each from its bubble at the top down the sheet, and
        under the bubbles a chain of dimensions between them (dims: the x of each stop),
        each length in the drawing's units."""
        for x, label in zip(xs, labels):
            self.path(f"M{num(x)} {num(top + r)}V{num(foot)}", "qp-line qp-center")
            self.bubble(x, top, r, label, size)
        if dims and dim_y:
            self.path(f"M{num(dims[0])} {num(dim_y)}H{num(dims[-1])}")
            for x in dims:
                self.path(f"M{num(x - 5)} {num(dim_y + 5)}L{num(x + 5)} {num(dim_y - 5)}"
                          f"M{num(x)} {num(dim_y - 9)}V{num(dim_y + 9)}")
            for a, b in zip(dims, dims[1:]):
                self.mono((a + b) / 2, dim_y - 7, str(round(b - a)), size * 0.8, anchor="middle")

    def dtitle(self, x, y, w, no, text, size, sheet="000"):
        """A drawing's title, as an architect titles one: a circle, its number over the
        sheet's, its middle line running on under the title, heavy, a thin line under that;
        the title over the line, wrapped (its last line just over it). y is the line's."""
        r = size * 1.4
        cx = x + r
        self.put(f'<circle class="qp-line qp-paper" cx="{num(cx)}" cy="{num(y)}" r="{num(r)}"/>')
        self.path(f"M{num(cx - r)} {num(y)}H{num(x + w)}", "qp-line qp-heavy")
        self.path(f"M{num(cx + r)} {num(y + 4)}H{num(x + w)}")
        self.mono(cx, y - r * 0.24, f"{no:02d}", size * 0.78, anchor="middle")
        self.mono(cx, y + r * 0.66, sheet, size * 0.78, anchor="middle")
        tx = cx + r + size * 0.6
        t = text.upper()
        lines = wrap(t, max(int((x + w - tx) / (self.MONO * size)), 1))
        first = y - size * 0.55 - (len(lines) - 1) * size * 1.3
        self.mono(tx, first, " ".join(lines), size, width=x + w - tx, lead=1.3)
        return y + r

    def table(self, x, y, w, fractions, header, rows, size, h):
        """A schedule, as a drawing's door or room schedule: a header row between heavy lines,
        then a row a line, columns ruled; the y under it."""
        xs = [x]
        for f in fractions:
            xs.append(xs[-1] + f * w)
        n = len(rows) + 1
        self.path(f"M{num(x)} {num(y)}H{num(x + w)}M{num(x)} {num(y + h)}H{num(x + w)}",
                  "qp-line qp-heavy")
        for i in range(2, n + 1):
            self.path(f"M{num(x)} {num(y + i * h)}H{num(x + w)}")
        for cx in xs:
            self.path(f"M{num(cx)} {num(y)}V{num(y + n * h)}")
        for i, cells in enumerate([header] + rows):
            for j, cell in enumerate(cells):
                mid = y + i * h + h / 2
                if isinstance(cell, (list, tuple)):
                    self.mono(xs[j] + size * 0.6, mid - size * 0.2, cell[0], size)
                    self.mono(xs[j] + size * 0.6, mid + size * 1.1, cell[1], size,
                              cls="is-quiet")
                else:
                    self.mono(xs[j] + size * 0.6, mid + size * 0.36, cell, size,
                              cls="is-quiet" if i == 0 else "")
        return y + n * h

    def levels(self, x0, x1, base, items, unit, size, note_x, width):
        """Levels, as a drawing's section marks its floors: a line, dash and dot, a level a
        year, each its height above the first by the years between (unit a year), a mark
        on it (▽) with the year, and its note over the line, wrapped up from it."""
        first = int(items[0][0])
        for year, note in items:
            y = base - (int(year) - first) * unit
            self.path(f"M{num(x0)} {num(y)}H{num(x1)}", "qp-line qp-center")
            t = x0 + 10
            self.put(f'<path class="qp-fill" d="M{num(t - 7)} {num(y - 11)}H{num(t + 7)}'
                     f'L{num(t)} {num(y)}Z"/>')
            self.mono(t + 12, y - 4, year, size)
            lines = wrap(note.upper(), max(int(width / (self.MONO * size)), 1))
            self.mono(note_x, y - 5 - (len(lines) - 1) * size * 1.3, note, size, width=width,
                      lead=1.3, cls="is-quiet")

    def walls(self, x, y, w, h, t):
        """A room in section: its walls t thick, cut, so hatched between two lines."""
        hid = self.id("hatch")
        if not any(hid in d for d in self.defs):
            self.defs.append(f'<pattern id="{hid}" width="7" height="7" patternUnits='
                             '"userSpaceOnUse" patternTransform="rotate(45)">'
                             '<path class="qp-hatch" d="M0 0V7"/></pattern>')
        self.put(f'<path fill="url(#{hid})" fill-rule="evenodd" d="M{num(x)} {num(y)}h{num(w)}'
                 f'v{num(h)}h{num(-w)}ZM{num(x + t)} {num(y + t)}v{num(h - 2 * t)}'
                 f'h{num(w - 2 * t)}v{num(-(h - 2 * t))}Z"/>')
        self.rect(x, y, w, h, "qp-line")
        self.rect(x + t, y + t, w - 2 * t, h - 2 * t, "qp-line")

    def north(self, x, y, r, size):
        """A north arrow: a circle, an arrow through it, half filled, N over it."""
        self.put(f'<circle class="qp-line" cx="{num(x)}" cy="{num(y)}" r="{num(r)}"/>'
                 f'<path class="qp-fill" d="M{num(x)} {num(y - r * 1.25)}L{num(x + r * 0.45)} '
                 f'{num(y + r * 0.7)}L{num(x)} {num(y + r * 0.35)}Z"/>'
                 f'<path class="qp-line" d="M{num(x)} {num(y - r * 1.25)}L{num(x - r * 0.45)} '
                 f'{num(y + r * 0.7)}L{num(x)} {num(y + r * 0.35)}"/>')
        self.mono(x + r + size * 0.5, y + size * 0.36, "N", size)

    def svg(self, cls):
        soft = self.id("soft")
        return (f'<svg class="qp-svg {cls}" viewBox="0 0 {self.w} {self.h}" aria-hidden="true" '
                f'focusable="false"><defs><filter id="{soft}" x="0" y="0" width="{self.w}" '
                f'height="{self.h}" filterUnits="userSpaceOnUse"><feGaussianBlur '
                f'stdDeviation="3"/></filter>{"".join(self.defs)}</defs>'
                f'<g class="qp-deep" filter="url(#{soft})">{"".join(self.deep)}</g>'
                f'<g class="qp-ink">{"".join(self.ink)}</g></svg>')


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
                "resume", "about"):
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
        if not isinstance(p.get("wide", False), bool):
            raise BuildError(f'{where}: "wide" should be true or false.')
        order = p.get("order")
        if isinstance(order, bool) or not isinstance(order, (int, float)):
            raise BuildError(f'{where}: "order" should be a number (lower numbers show first).')
        if p.get("todo"):
            warnings.append(f'{where}: {p["todo"]}.')
        if "slug" not in p:  # no page of its own: its tile opens the lightbox
            need(p, "title", where)
            if p.get("featured") and HOME_TRACK:
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
        roles = p.get("roles", [])
        if not isinstance(roles, list) or not all(isinstance(r, str) for r in roles):
            raise BuildError(f'{where}: "roles" should be a list, like ["Art direction"].')
        for key in ("team", "timeline"):
            value = p.get(key)
            if value is not None and not isinstance(value, str) and not (
                    isinstance(value, list) and all(isinstance(v, str) for v in value)):
                raise BuildError(f'{where}: "{key}" should be text, like "2 designers, 3 engineers", '
                                 'or a list of it.')
        # A project's page shows Role, Team, and Timeline (since 2026-11-09): a "year" left over
        # from before shows nowhere, so say so.
        if "year" in p:
            warnings.append(f'{slug}: "year" isn\'t shown on the project page any more; put it in '
                            '"timeline", like "8 weeks, 2026".')
        meta = p.get("meta") or {}
        if not isinstance(meta, dict):
            raise BuildError(f'{where}: "meta" should be like {{ "link": null }}.')
        site_link = meta.get("link")
        if site_link is not None and not (
                isinstance(site_link, dict) and isinstance(site_link.get("url"), str)
                and site_link["url"].startswith(("http://", "https://"))
                and isinstance(site_link.get("label") or "", str)):
            raise BuildError(f'{where}: "meta.link" should be like {{ "label": "typelab.ink", '
                             '"url": "https://typelab.ink" }, the address in full (from '
                             'https://), or null to hide it.')
        # Facts the project page no longer shows: say so, so none go missing quietly. (Tools
        # went on 2026-11-05; Service, which replaced it, on 2026-11-06, back to Role.)
        for old, there in (("meta.tools", "tools" in meta), ("meta.service", "service" in meta)):
            if there:
                warnings.append(f'{slug}: "{old}" isn\'t shown on the project page; put it in '
                                '"roles".')

    if not seen:
        raise BuildError('content/projects.json needs at least one project with a "slug".')
    # Only Home's track shows "featured" (HOME_TRACK); Work's grid shows everything, in "order".
    featured = sum(bool(p.get("featured")) for p in items)
    if HOME_TRACK and not featured:
        raise BuildError('content/projects.json needs at least one item with "featured": true, '
                         "or Home has no cards.")
    if HOME_TRACK and not MIN_FEATURED <= featured <= MAX_FEATURED:
        warnings.append(f"{featured} projects are featured on Home "
                        f"(aim for {MIN_FEATURED} to {MAX_FEATURED}).")

    if not exists(site["resume"]):
        warnings.append(f"{site['resume']} not found, so the Resume link won't work yet.")
    if not site.get("siteUrl"):
        warnings.append('"siteUrl" in content/site.json is empty. Netlify fills it in when it '
                        "builds the site; for any other host, set it to the site's address, so "
                        "link previews show the image and the sitemap is made.")
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
        if not isinstance(image.get("project", ""), str):
            raise BuildError(f'{where}: "project" should be a name in quotes, like "Palette".')
        extra = image.get("link")
        if extra is not None and not (
                isinstance(extra, dict) and isinstance(extra.get("url"), str)
                and extra["url"].startswith(("https://", "http://", "/"))
                and isinstance(extra.get("label", ""), str)):
            raise BuildError(f'{where}: "link" should be {{ "label": "See full project", '
                             f'"url": "https://..." }}.')


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
        self.needs_small = set()       # large images shown without a smaller copy next to them
        self.warnings = []
        self.logo = None               # the header's logo, once read (header_logo)
        self.big_logo = None           # the footer's, once read (footer_logo)
        self.sheet = None              # the page's sheet number while a drawing sheet is built
        self.section_no = 0            # its sections so far, for their callouts

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
            # The display face's italic (Kalnia until 2026-11-23) only where Work's sentence
            # leans on words (*...*), the first screen of /, so it doesn't swap in late once the
            # opening is skipped; and on About, whose first words are set in it, at the top.
            accent_preload=('  <link rel="preload" '
                           'href="/assets/fonts/source-serif-display-300-italic.woff2"'
                           ' as="font" type="font/woff2" crossorigin>\n'
                           if ('<p class="work-statement">' in content
                               or '<p class="about-statement">' in content)
                           and "<em>" in content else ""),
            logo=self.header_logo(),
            work_count=self.menu_count(len(self.items), "project"),
            archive_count=self.menu_count(len(self.archive), "image"),
            # The résumé at the header's right end, where Contact was until 2026-11-13 (the
            # user's ask, as gougoucore's header has it): the PDF in a new tab, with its arrow,
            # as in the footer. Contact is the footer (#contact) on every page.
            resume_link=link(url_for(s["resume"]), "Resume", rel="noopener noreferrer"),
            work_url="/work/" if HOME_TRACK else "/",
            nav_work={"work": ' aria-current="page"', "project": ' aria-current="true"'}.get(current, ""),
            nav_archive=' aria-current="page"' if current == "archive" else "",
            nav_about=' aria-current="page"' if current == "about" else "",
            main_class=main_class,
            content=content,
            footer=self.footer() if footer else "",
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

    # The header (since 2026-11-13, after gougoucore.com's): Work and Archive with their counts at
    # the left, the logo in the middle, linking home, About and the résumé at the right (Contact
    # in the résumé's place until late on 2026-11-13). (From
    # 2026-11-10 to 2026-11-12 the name was at the left and LinkedIn, GitHub, and email icons at
    # the right, from the user's sketch; the footer has those links.)

    def header_logo(self):
        """The logo (assets/logo/logo-small.svg, made in another session on 2026-11-13: two
        sunbursts, side by side since the same day, their rays wedges since 2026-11-14), inline
        so it takes the header's color (read_logo). Until the file exists, the name stands in its
        place. Read once per build."""
        if self.logo is None:
            svg = self.read_logo(HEADER_LOGO, "site-logo")
            if svg is None:
                self.warnings.append(f"{HEADER_LOGO} is missing, so the header shows the name "
                                     "in its place.")
                self.logo = f'<span class="identity-name">{esc(self.site["name"])}</span>'
            else:
                self.logo = f'{svg}<span class="visually-hidden">{esc(self.site["name"])}</span>'
        return self.logo

    def footer_logo(self):
        """The logo, large, at the footer's right (since 2026-11-13, after gougoucore.com's
        footer, whose right end is its header's logo, large): assets/logo/logo.svg, the cut with
        more rays, made for large sizes, inline as the header's is (read_logo).
        It repeats the header's, so screen readers skip it. Left out while the file is missing.
        From 768px its suns are called out (logo_key, FOOTER_KEY) since 2026-11-22.
        Read once per build."""
        if self.big_logo is None:
            parts = self.logo_parts(FOOTER_LOGO)
            if parts is None:
                self.warnings.append(f"{FOOTER_LOGO} is missing, so the footer has no logo.")
                self.big_logo = ""
            else:
                (x0, y0, w, h), shapes = parts
                key = self.logo_key(parts[0], dot=4.0) if FOOTER_KEY else ""
                self.big_logo = (f'<svg class="footer-logo{" has-key" if key else ""}" '
                                 f'viewBox="{x0:g} {y0:g} {w:g} {h:g}" aria-hidden="true" '
                                 f'focusable="false">{shapes}{key}</svg>')
        return self.big_logo

    def read_logo(self, rel, cls):
        """A logo file's shapes as an inline <svg class="cls">, in the text color, or None if the
        file is missing. Since 2026-11-14 the logo's rays are filled wedges (thick at the sun,
        out to a hairline, as Kalnia's strokes run out), drawn as they are, so they grow with the
        logo; a file drawn in lines (stroke) instead, as the logo was until then, gets lines
        1px wide at any size."""
        if not exists(rel):
            return None
        with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
            svg = f.read()
        box = re.search(r'viewBox="([^"]+)"', svg)
        tags = re.findall(r'<path\b[^>]*>', svg)
        ds = [re.search(r'\bd="([^"]+)"', t) for t in tags]
        if not box or not tags or not all(ds):
            raise BuildError(f"{rel}: expected an <svg viewBox=\"…\"> with <path d=\"…\"> shapes.")
        shapes = "".join(f'<path d="{d.group(1)}"/>' for d in ds)
        paint = ('fill="none" stroke="currentColor" stroke-width="1"' if any("stroke=" in t for t in tags)
                 else 'fill="currentColor"')
        return (f'<svg class="{cls}" viewBox="{box.group(1)}" {paint} aria-hidden="true" '
                f'focusable="false">{shapes}</svg>')

    @staticmethod
    def menu_count(n, noun):
        """'(8)' after a header link, small and low (aria-hidden), and ', 8 projects' for screen
        readers."""
        return (f'<span class="menu-count" aria-hidden="true">({n})</span>'
                f'<span class="visually-hidden">, {n} {noun}{"" if n == 1 else "s"}</span>')

    # The footer (since 2026-11-13, after gougoucore.com's): a line over it, from the window's
    # left edge to its right; the header's links one under another at the left, the email,
    # LinkedIn, GitHub, and the résumé in a column beside them (the résumé under About in the
    # first column for a few hours on 2026-11-13; the copyright under them until late that day),
    # and the logo, large, at the right. (Until 2026-11-13 the email, LinkedIn, GitHub, and
    # Resume in a line under a rule, the copyright at the right.)

    def footer(self):
        s = self.site
        copyright = (s.get("copyright") or "").strip()  # empty or left out: none (off since 2026-11-13)
        return render(
            "footer.html",
            menu_links=self.menu_links("        "),
            contact_links=self.contact_links("          "),
            copyright=f'        <p class="copyright">{esc(copyright)}</p>' if copyright else "",
            logo=("    " + self.footer_logo()) if self.footer_logo() else "",
        )

    def menu_links(self, indent):
        """The footer's first column: the header's Work, Archive, and About, with their counts,
        as gougoucore's footer repeats its header's links. (The résumé stood under About, where
        the header has Contact, for a few hours on 2026-11-13; it's in the contact column now.)"""
        items = [
            f'<a href="{"/work/" if HOME_TRACK else "/"}">Work'
            f'{self.menu_count(len(self.items), "project")}</a>',
            f'<a href="/archive/">Archive{self.menu_count(len(self.archive), "image")}</a>',
            '<a href="/about/">About</a>',
        ]
        return "\n".join(f"{indent}<li>{item}</li>" for item in items)

    def contact_links(self, indent):
        """The email, LinkedIn, GitHub, and résumé links from content/site.json, for the
        footer's second column (the résumé moved here from the first late on 2026-11-13, the
        user's ask; until 2026-11-06 About's Contact section listed them too, one under
        another)."""
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
        self.write(ph_rel, placeholder_svg(width, height, title, os.path.basename(rel),
                                           dark=slot == "opening"))
        self.missing_media.add(rel)
        return url_for(ph_rel), (width, height)

    @staticmethod
    def srcset(rel, size, sizes):
        """srcset and sizes for a smaller copy next to the file (001-small.jpg for 001.jpg; see
        small_copy), or "" if there isn't one."""
        small = small_copy(rel)
        small_size = small and media_size(small)
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
                if not srcset and small_target(rel, size):
                    self.needs_small.add(rel)
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
            return figure("media-full", self.img(rel, b.get("alt"), "wide", p["title"], loading,
                                                 sizes=WIDE_SIZES),
                          b.get("caption"))
        if kind == "imagePair":
            images = b.get("images")
            if not isinstance(images, list) or len(images) != 2:
                raise BuildError(f'{where}: an "imagePair" block needs exactly two entries in "images".')
            imgs = "".join(
                self.img(media_path(need(i, "src", where), folder), i.get("alt"), "pair",
                         p["title"], loading, sizes=PAIR_SIZES)
                for i in images)
            return figure("media-pair", f'<div class="pair">{imgs}</div>', b.get("caption"))
        if kind == "video":
            return figure("media-full", self.video(b, folder, p["title"], loading, where),
                          b.get("caption"))
        if kind == "impact":
            return self.impact_block(b, where)
        if kind == "prototype":
            return figure("media-full", self.prototype(b, where), b.get("caption"))
        raise BuildError(f'{where}: unknown block type "{kind}". '
                         'Use text, image, imagePair, video, impact, or prototype.')

    def prototype(self, b, where):
        """A working prototype: a folder in assets/prototypes/ with its own index.html, shown in
        a phone-sized frame on a gray stage (the page scales itself to the frame), and a link
        to open it alone, which fills the screen on a phone. Added 2026-11-08 for Light Life."""
        folder = need(b, "src", where).strip("/")
        if not exists(f"{folder}/index.html"):
            raise BuildError(f'{where}: a "prototype" block needs {folder}/index.html.')
        url = url_for(folder) + "/"
        title = esc(b.get("title") or "Prototype")
        return (f'<div class="prototype"><iframe src="{url}" title="{title}" loading="lazy">'
                '</iframe></div>'
                f'<p class="prototype-open"><a class="text-link" href="{url}" target="_blank" '
                'rel="noopener">Open in a new <span class="link-end">tab</span>'
                '<span class="visually-hidden"> (opens in a new tab)</span></a></p>')

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
        if heading and self.sheet:  # a drawing sheet's detail callout (SHEET_PROJECTS)
            self.section_no += 1
            h = (f'<h2 class="section-heading">{self.callout(self.section_no, self.sheet)}'
                 f'<span class="section-name">{inline(heading)}</span></h2>')
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
        """Role · Team · Timeline, under the statement and the Visit link: what a recruiter reads
        a project's page for (since 2026-11-09). Empty fields are left out. (Role · Year · Type ·
        Tools · Link until 2026-11-05, then Year · Type · Service · Link; on 2026-11-06 Link moved
        to "Visit …" (see visit_link), then Role · Year · Type, and Type gave way to Category,
        the project's Work filters, until 2026-11-09.)"""
        rows = []
        for label, value in (("Role", p.get("roles")), ("Team", p.get("team")),
                             ("Timeline", p.get("timeline"))):
            if isinstance(value, list):
                value = ", ".join(value)
            if value:
                rows.append((label, inline(value)))
        return "\n".join(f"          <div><dt>{k}</dt><dd>{v}</dd></div>" for k, v in rows)

    # The drawing system (since 2026-11-22; style.css's Drawing system, README's) -------------

    @staticmethod
    def axes(indent, names=None):
        """Axis bubbles over a grid (GRID_AXES): one per column, A, B, C (CSS shows as many as
        the grid has columns), for the eye only. With names (Archive's plan, whose columns mean
        something), one per name, each name beside its bubble, all of them on phones too, and
        there whatever GRID_AXES says: the plan can't be read without them."""
        if names:
            spans = "".join(f'<span>{AXIS_LETTERS[i]}<i class="axes-name">{inline(n)}</i></span>'
                            for i, n in enumerate(names))
            return (f'{indent}<div class="axes is-named" style="--cols: {len(names)}" '
                    f'aria-hidden="true">{spans}</div>\n')
        if not GRID_AXES:
            return ""
        return (f'{indent}<div class="axes" aria-hidden="true">'
                '<span>A</span><span>B</span><span>C</span></div>\n')

    @staticmethod
    def callout(top, bottom):
        """A detail callout: a circle split by a line, top over it, bottom under it, for the eye
        only (the words around it say what it marks)."""
        return (f'<span class="callout" aria-hidden="true"><span>{top}</span>'
                f'<span>{bottom}</span></span>')

    def sheet_meta(self, p):
        """A drawing sheet's title block (SHEET_PROJECTS): Role, Team, and the timeline, what a
        recruiter reads it for, as meta_rows has them. The labels in the label style, the values
        in the text face at the body size, as written (style.css), so the two read apart; Role and
        Team one to a line (sheet_list), the timeline a line of events (timeline). Every cell
        shows, a dash standing in for a missing value, so the block's lines stay whole.
        (2026-11-22 to 2026-11-26 also Scale, like "Object → Screen", and Sheet, the sheet's
        number beside the logo as a stamp, its suns called out DIGITAL, EVERYDAY LIFE, WHERE THEY
        MEET. The user's ask, 2026-11-26, after asking why the block didn't read: Scale and
        Sheet were words a visitor had to decode, and the stamp, the biggest, darkest thing in
        it, drew the eye from the facts. "scale" in content/projects.json is no longer shown.)"""
        cells = (("role", "Role", self.sheet_list(p.get("roles"))),
                 ("team", "Team", self.sheet_list(p.get("team"), people=True)),
                 ("time", "Timeline", self.timeline(p)))
        return "\n".join(f'          <div class="sheet-{c}"><dt>{k}</dt><dd>{v}</dd></div>'
                         for c, k, v in cells)

    @staticmethod
    def sheet_list(value, people=False):
        """A title block's value: a list one to a line, a string as it is, a dash for nothing.
        With people, "Kyuri Park, CDO" shows the name, then the title after its last comma in
        --color-subtle, the comma there for screen readers alone, so a team doesn't run name,
        title, name, title on one line of commas (as it did until 2026-11-26)."""
        if not value:
            return "—"
        if not isinstance(value, list):
            return inline(value)

        def item(v):
            name, comma, title = v.rpartition(", ") if people else ("", "", v)
            if not (comma and name):
                return inline(v)
            return (f'{inline(name)}<span class="visually-hidden">,</span> '
                    f'<span class="sheet-sub">{inline(title)}</span>')
        return '<ul class="sheet-list">' + "".join(f"<li>{item(v)}</li>" for v in value) + "</ul>"

    def timeline(self, p):
        """The timeline as a line of events (since 2026-11-26): a dot at each milestone, oldest
        first, a column each, the year over the line and the note under it, all starting at their
        dots, the line from the first dot to the last; upright in a narrow cell (style.css). A
        note's "what · where" ("Lamp · business competition win, Temple University") shows the
        what, then the where under it, in --color-subtle, from a capital. Fewer than two
        milestones: the timeline's words. (2026-11-22 to 2026-11-26 a dimension line: a slash
        at each mark, spaced by the years between, the notes between the marks and the last one
        ending at its mark; it read as lengths of time, not as events, and its words started on
        both sides of their marks.)"""
        ms = p.get("milestones") or []
        if len(ms) < 2:
            return inline(p.get("timeline") or "—")

        def note(text):
            what, dot, where = text.partition(" · ")
            sub = (f'<span class="sheet-sub">{inline(where[:1].upper() + where[1:])}</span>'
                   if dot else "")
            return f'<span class="timeline-what">{inline(what)}</span>{sub}'
        items = "".join(f'<li><span class="timeline-year">{m["year"]}</span>'
                        f'{note(m.get("note", ""))}</li>' for m in ms)
        return f'<ol class="timeline" style="--events: {len(ms)}">{items}</ol>'

    def logo_parts(self, rel):
        """A logo file as (x, y, width, height) of its viewBox and its shapes, painted as
        read_logo paints them, or None while the file is missing."""
        svg = self.read_logo(rel, "")
        if svg is None:
            return None
        box = tuple(float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split())
        paint = re.search(r'viewBox="[^"]+" (.*?) aria-hidden', svg).group(1)
        shapes = re.search(r">(.*)</svg>$", svg, re.S).group(1)
        return box, f"<g {paint}>{shapes}</g>"

    @staticmethod
    def logo_key(box, dot=5.0):
        """The logo's two suns called out, as an architect calls out parts of a drawing (since
        2026-11-22, the user's ask: the logo's story): each sun by a leader, a dot at its middle,
        a line out between two rays (25° from upright) and a shoulder under its word, DIGITAL
        over the left sun and EVERYDAY LIFE over the right, and from the place their rays
        cross, straight down, WHERE THEY MEET (Work's sentence: "where digital meets everyday
        life"). In the logo's own units, outside its box: it reaches 80/208 of its height over
        it and 74/208 under it (style.css's .footer-logo.has-key makes room). The words take the
        svg's font size, so the
        page sets it for 12px. Assumes the logo's two suns side by side, each as tall as the
        file."""
        x0, y0, w, h = box
        k = h / 208                     # the logo's units as drawn (208 tall)
        r = h / 2
        lx, rx, mx, cy = x0 + r, x0 + w - r, x0 + w / 2, y0 + r
        shoulder, foot = y0 - 50 * k, y0 + h + 42 * k
        lean = (cy - shoulder) * math.tan(math.radians(25))

        def f(v):
            return f"{v:.1f}"
        lines = (f'<path d="M{f(lx)} {f(cy)}L{f(lx - lean)} {f(shoulder)}H{f(x0)}'
                 f'M{f(rx)} {f(cy)}L{f(rx + lean)} {f(shoulder)}H{f(x0 + w)}'
                 f'M{f(mx)} {f(cy)}V{f(foot)}" fill="none" stroke="currentColor" '
                 'stroke-width="1" vector-effect="non-scaling-stroke"/>')
        dots = "".join(f'<circle cx="{f(x)}" cy="{f(cy)}" r="{f(dot * k)}"/>' for x in (lx, rx, mx))
        words = (f'<text x="{f(x0)}" y="{f(shoulder - 10 * k)}">DIGITAL</text>'
                 f'<text x="{f(x0 + w)}" y="{f(shoulder - 10 * k)}" text-anchor="end">'
                 'EVERYDAY LIFE</text>'
                 f'<text x="{f(mx)}" y="{f(foot + 10 * k)}" dy="0.72em" text-anchor="middle">'
                 'WHERE THEY MEET</text>')
        return f'<g class="logo-key" fill="currentColor">{lines}{dots}{words}</g>'

    # Pages ------------------------------------------------------------------

    def cover(self, p):
        """Path of a project's cover image, and of its hover video if one sits next to it."""
        rel = media_path(p["cover"]["src"], f"assets/images/{p['slug']}")
        stem = os.path.splitext(rel)[0]
        video = next((stem + ext for ext in COVER_VIDEO_EXTS if exists(stem + ext)), None)
        return rel, video

    def card_caption(self, p):
        """'TypeLab' on the left, 'Font design tool · 2026' on the right: on each track card
        (Home's, or Work's slider), and under the middle one. What the project is and when, so a
        recruiter can tell the projects apart without opening them (since 2026-11-09; the
        one-liner was there before, and is now only the page's description for search engines
        and link previews). An item with no page shows its 'Type · Year' (piece_meta); the
        lightbox reads both halves when the card opens it."""
        tag = self.card_tag(p) if "slug" in p else self.piece_meta(p)
        return (f'<span class="card-title" data-lightbox-name>{inline(p["title"])}</span> '
                f'<span class="card-text" data-lightbox-meta>{tag}</span>')

    def card_tag(self, p):
        """'Type · Year', as an item with no page shows in the lightbox (piece_meta). The year
        is the last one in "timeline" ("8 weeks, 2026" gives 2026); what's empty is left out.
        "· 2026" keeps to the type's last word, so on a phone, where it can take two lines, it
        wraps as "FONT DESIGN / TOOL · 2026", never leaving the dot at a line's end."""
        timeline = p.get("timeline") or ""
        if isinstance(timeline, list):
            timeline = " ".join(timeline)
        years = YEAR_RE.findall(PLACEHOLDER_RE.sub("", timeline))
        parts = [inline(p["type"])] if p.get("type") else []
        return "&nbsp;·&nbsp;".join(parts + years[-1:])

    def home_card(self, p, index, total, loading=None):
        """One card on the track: Home's (HOME_TRACK) or Work's slider (WORK_VIEWS). A project's
        card links to its page; an item with no page is a button that opens the lightbox, its
        images waiting in a <template>, as its grid tile does (main.js)."""
        if "slug" in p:
            rel, _ = self.cover(p)
            slot, alt = "cover", p["cover"].get("alt")
        else:
            rel, slot, alt = media_path(p["images"][0], PIECE_FOLDER), "piece", p.get("alt")
        if exists(rel):
            # Home: all eager, as the stage clips the cards, so lazy ones would only load once
            # on screen. Work's slider passes "lazy", so while the grid shows, the hidden
            # slider loads nothing; track.js makes them eager once it shows.
            img = self.img(rel, alt, slot, p["title"],
                           loading or ("high" if index == 0 else "eager"), sizes=HOME_SIZES)
        else:
            img = ""  # a plain gray card until the cover exists; no label on Home
            self.missing_media.add(rel)
        if "slug" in p:
            tag, attrs, extra = "a", f'href="/work/{p["slug"]}/"', ""
        else:
            tag, attrs = "button", 'type="button" data-item aria-haspopup="dialog"'
            extra = f'            {self.piece_images(p)}\n'
        # Where the card sits before track.js runs: first card in the middle, the rest
        # around it as on a loop (with five: 0, 1, 2, -2, -1).
        offset = index if index <= total / 2 else index - total
        return (f'          <li class="track-item" style="--d: {offset}">\n'
                f'            <{tag} class="track-card" {attrs}>\n'
                f'              <span class="track-media">{img}</span>\n'
                f'              <span class="card-caption">{self.card_caption(p)}</span>\n'
                f'            </{tag}>\n'
                f'{extra}'
                f'          </li>')

    def track(self, items, loading=None):
        """The track's markup (templates/track.html): a card per item, in "order", and under
        the middle card's caption, on phones, a dot for each, the middle one's dark (style.css,
        "Home: project track"). And the count, "01 / 05", the middle card's number first, which
        Home shows in the window's bottom right from 1200px (style.css, "Home, as the user drew
        it"); track.js changes the number as the cards turn."""
        n = len(items)
        cards = "\n".join(self.home_card(p, i, n, loading) for i, p in enumerate(items))
        dots = "".join('<span class="is-current"></span>' if i == 0 else "<span></span>"
                       for i in range(n))
        count = f'<span class="track-count-at">01</span> / {n:02d}'
        return render("track.html", cards=cards, caption=self.card_caption(items[0]), dots=dots,
                      count=count)

    def home_intro(self):
        """Home's opening (assets/js/intro.js). Since 2026-11-24 (the user's asks, from their
        moodboard: a portrait seen through frosted paper, a card with a soft gray picture under
        it and small type on it, their own blurred portrait): a sheet of tracing paper covers
        the window from the start, smooth and milky with a fine grain, and their portrait
        ("openingImage" in content/site.json) comes up under it as a print with the paper's
        margin round it, only soft grays; the sentence that says who this is is typed on the
        sheet, a letter at a time (intro.js splits the lines into letters): the name, and under
        it the line that finishes the sentence ("opening", "Designs where digital meets everyday
        life", the name being its subject; the role without it).
        Then the portrait sinks back under the paper and the page is that paper. (Earlier that
        day: the portrait first and an A4 sheet sliding up over it; then the paper cloudy, the
        name on a center line drawn out to the window's edges; the logo's two suns drawn as
        orbits on a sheet of vellum over the work from 2026-11-23; a black screen with the name,
        then the line, from 2026-11-10; About's first sentence, made of dots, from 2026-11-09.)"""
        s = self.site
        photo_rel = s.get("openingImage") or "assets/images/opening.jpg"
        photo = self.img(photo_rel, "", "opening", "Opening", loading="high", decorative=True)
        line = s.get("opening") or s["role"]
        return ('    <div class="intro" aria-hidden="true">\n'
                f'{intro_ink()}'
                f'      <div class="intro-photo">{photo}</div>\n'
                '      <div class="intro-sheet">\n'
                '        <div class="intro-text">\n'
                f'          <p class="intro-line intro-name">{esc(s["name"])}</p>\n'
                f'          <p class="intro-line intro-role">{esc(line)}</p>\n'
                '        </div>\n'
                '      </div>\n'
                '    </div>\n')

    def build_home(self):
        """Home, as the user drew it (2026-11-10): the sentence that says who this is (its h1,
        "lead" in content/site.json's "home"), and the featured projects, in "order", on the
        track, with the middle one's name."""
        lead = need(need(self.site, "home", "content/site.json"), "lead", "content/site.json (home)")
        content = render("home.html", lead=inline(lead), track=self.track(self.featured),
                         intro=self.home_intro(),
                         intro_version=file_version("assets/js/intro.js"),
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

    @staticmethod
    def is_lead(p):
        """Whether an item is Work's tile two columns wide (WORK_LEAD, "wide" in projects.json)."""
        return WORK_LEAD and p.get("wide") is True

    @classmethod
    def work_layout(cls, items, cols):
        """Where Work's tiles stand with `cols` across, as the browser places them: each in the
        first cells it fits, so a later tile fills a hole the wide tile left (grid-auto-flow:
        dense on .has-lead in style.css). For each item: its number as seen, row by row, and
        whether it ends a row (no line at its right); and how many empty cells close the last
        row (the grid's ::after)."""
        taken, cells = set(), []
        for p in items:
            span = 2 if cls.is_lead(p) else 1
            cell = 0
            while cell % cols + span > cols or any(c in taken for c in range(cell, cell + span)):
                cell += 1
            taken.update(range(cell, cell + span))
            cells.append((cell, span))
        numbers = [0] * len(items)
        for n, i in enumerate(sorted(range(len(items)), key=lambda i: cells[i][0]), 1):
            numbers[i] = n
        ends = [(cell + span) % cols == 0 for cell, span in cells]
        last_row = max(taken, default=0) // cols * cols
        rest = sum(1 for c in range(last_row, last_row + cols) if c not in taken)
        return numbers, ends, rest

    def work_card(self, p, index, place=None):
        """One item's tile: its image filling the cell, and under it a bar, '001' at the left
        and 'TypeLab' at the right on one line, after gougoucore.com's Work (since 2026-11-25
        evening, the user's ask: its words shown cleanly, as gougoucore's are; so from
        2026-11-13 to 2026-11-24 too). The number is for the eye only: screen readers get the
        title. (2026-11-24 to 2026-11-25: a card of tracing paper ruled as a spec sheet over
        the image's foot, the number and a mark, an arrow for a page or a plus for the
        lightbox, over the title, from the user's moodboard; its title alone from 2026-11-07,
        and a project's one-liner, or an item's type, after it before.) A project's one-liner
        is on Home; an item's type is in the lightbox. main.js
        filters the tiles on data-categories. A
        project's tile links to its page, and if the cover has a video next to it, main.js
        plays it while the tile is hovered. An item with no page opens the lightbox, which shows
        its 'Type · Year' from a hidden span in the tile, and the bar the number of its images
        after its name, as the header's ARCHIVE (17). On a grid with a wide tile (WORK_LEAD),
        `place` is its number and whether it ends a row, from 768px and on phones (work_layout):
        a tile whose number differs between them has both."""
        loading = "eager" if index < 3 else "lazy"
        lead = self.is_lead(p)
        sizes = LEAD_SIZES if lead else WORK_SIZES
        if "slug" in p:
            rel, video = self.cover(p)
            if lead and (p.get("coverWide") or {}).get("src"):
                rel = media_path(p["coverWide"]["src"], f"assets/images/{p['slug']}")
            img = self.tile_image(rel, "cover", p["title"], loading, sizes=sizes)
            data = f' data-video="{url_for(video)}"' if video else ""
            tag, attrs = "a", f'href="/work/{p["slug"]}/"'
            meta, extra = "", ""
        else:
            rels = [media_path(src, PIECE_FOLDER) for src in p["images"]]
            if lead and WIDE_PAIR and len(rels) > 1:
                img = "".join(
                    f'<span>{self.tile_image(rel, "piece", p["title"], loading, sizes=WORK_SIZES)}'
                    '</span>' for rel in rels[:2])
                data = ' data-pair'
            else:
                img = self.tile_image(rels[0], "piece", p["title"], loading, sizes=sizes)
                data = ""
            tag, attrs = "button", 'type="button" data-item aria-haspopup="dialog"'
            meta = f'<span hidden data-lightbox-meta>{self.piece_meta(p)}</span>'
            extra = f'            {self.piece_images(p)}\n'
        number, classes = f"{index + 1:03d}", ["is-lead"] if lead else []
        if place:
            (desktop, phone), ends = place
            if desktop != phone:
                number = (f'<span class="number-desktop">{desktop:03d}</span>'
                          f'<span class="number-phone">{phone:03d}</span>')
            classes += [name for name, end in zip(("row-end-desktop", "row-end-phone"), ends)
                        if end]
        cls = f' class="{" ".join(classes)}"' if classes else ""
        count = ""
        if "slug" not in p and len(p["images"]) > 1:
            n = len(p["images"])
            count = (f'<span class="menu-count" aria-hidden="true">({n})</span>'
                     f'<span class="visually-hidden">, {n} images</span>')
        return (f'          <li{cls} data-categories="{" ".join(p["category"])}">\n'
                f'            <{tag} class="work-card" {attrs}>\n'
                f'              <span class="work-caption">'
                f'<span class="work-number" aria-hidden="true">{number}</span>'
                f'<span class="work-name"><span data-lightbox-name>{inline(p["title"])}</span>'
                f'{count}</span>'
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
        About's "[ Scroll down ]" was until 2026-11-06 (style.css shows the brackets on the
        filter showing only); screen readers skip them."""
        n = sum(name == "all" or name in p["category"] for p in self.items)
        return (f'      <button class="work-tab" type="button" data-filter="{name}" '
                f'aria-pressed="{str(name == "all").lower()}">'
                f'<span class="work-bracket" aria-hidden="true">[ </span>{name.capitalize()}'
                f'{self.work_count(n)}<span class="work-bracket" aria-hidden="true"> ]</span>'
                f'</button>')

    # Work's two views as icons, 22 x 16, in sharp-cornered blocks as the site's images are: the
    # grid's three columns of tiles in two rows, and the slider's middle card with its
    # neighbors, smaller, at its sides, or over and under it where it runs down (from 1200px;
    # style.css shows the one that fits).
    # Each is its shape, then any lighter part: the slider's neighbors, grayed as the slider's are.
    VIEW_ICONS = {
        "grid": ("M0 0h10v7H0zM12 0h10v7H12zM0 9h10v7H0zM12 9h10v7H12z",),
        "across": ("M4 3h14v10H4z", "M0 5h2v6H0zM20 5h2v6h-2z"),
        "down": ("M5 4h12v8H5z", "M8 0h6v2H8zM8 14h6v2H8z"),
    }

    def work_views(self):
        """The two views (WORK_VIEWS), as icons (VIEW_ICONS; the words '[ GRID ]  SLIDER'
        until later on 2026-11-10), the one showing in the text color. Screen readers get
        each one's name. main.js switches between them and remembers the pick; the script
        after them applies a remembered slider before the page shows, so the grid doesn't
        flash first. Without JavaScript there's no switch, and the grid shows."""
        def icon(name, cls=""):
            shape, *neighbors = self.VIEW_ICONS[name]
            paths = f'<path d="{shape}"/>' + "".join(
                f'<path d="{d}" opacity="0.4"/>' for d in neighbors)
            return (f'<svg{cls} viewBox="0 0 22 16" width="22" height="16" fill="currentColor" '
                    f'aria-hidden="true" focusable="false">{paths}</svg>')

        def button(view, label, icons):
            return (f'      <button class="work-view" type="button" data-view="{view}" '
                    f'aria-pressed="{str(view == "grid").lower()}" aria-label="{label}">'
                    f'{icons}</button>')

        slider = icon("across", ' class="view-icon-across"') + icon("down", ' class="view-icon-down"')

        return ('    <div class="work-views" role="group" aria-label="View">\n'
                f'{button("grid", "Grid", icon("grid"))}\n{button("slider", "Slider", slider)}\n'
                '    </div>\n'
                '    <script>try{if(localStorage.getItem("work-view")==="slider"){'
                'document.documentElement.classList.add("view-slider");'
                'document.querySelectorAll(".work-views [data-view]").forEach((b)=>'
                'b.setAttribute("aria-pressed",String(b.dataset.view==="slider")))}}'
                'catch(e){}</script>\n')

    def ring_views(self):
        """RING and GRID (WORK_RING), as words in the filters' label style, the one showing
        bracketed and in the text color ("[ RING ]  GRID"), at the right of the line over the
        grid. main.js switches between them and remembers the pick; the script after them
        shows the ring before the page does, unless the visitor picked the grid (or with
        RING_FIRST off, only if they picked the ring), so the other doesn't flash first.
        Without JavaScript, or on a phone, there's no switch, and the grid shows."""
        first = "ring" if RING_FIRST else "grid"

        def button(view, label):
            return (f'      <button class="work-view" type="button" data-view="{view}" '
                    f'aria-pressed="{str(view == first).lower()}">'
                    f'<span class="work-bracket" aria-hidden="true">[ </span>{label}'
                    f'<span class="work-bracket" aria-hidden="true"> ]</span></button>')

        return ('    <div class="work-views is-words" role="group" aria-label="View">\n'
                f'{button("ring", "Ring")}\n{button("grid", "Grid")}\n'
                '    </div>\n'
                '    <script>(()=>{let v="";try{v=localStorage.getItem("work-view")}catch(e){}'
                f'if(v!=="ring"&&v!=="grid")v="{first}";'
                'document.documentElement.classList.toggle("view-ring",v==="ring");'
                'document.querySelectorAll(".work-views [data-view]").forEach((b)=>'
                'b.setAttribute("aria-pressed",String(b.dataset.view===v)))})()</script>\n')

    def ring_item(self, p, slot):
        """One place on the ring (WORK_RING): the item's object, a link to its page or, for an
        item with no page, a button that opens the lightbox with its images, as its grid tile
        does. The object is the item's own image ("object": a cutout, PNG or WebP with a clear
        background, in the project's image folder, or for an item with no page in pieces/) or,
        until that exists, one of templates/ring.html's shapes, picked by the item's place in
        "order". Its name and 'Type · Year' are hidden: screen readers read them as the object's
        name, the lightbox copies them, and ring.js shows them in the ring's middle. A place
        past the first time around (RING_MIN_SLOTS) is a copy for the eye only: hidden from
        screen readers and the keyboard, and on an item with no page, its click goes to the
        first one's (ring.js)."""
        n = len(self.items)
        i, copy = slot % n, slot >= n
        folder = f"assets/images/{p['slug']}" if "slug" in p else PIECE_FOLDER
        rel = media_path(p["object"], folder) if p.get("object") else None
        if rel and exists(rel):
            media = f'<img src="{url_for(rel)}" alt="" loading="lazy" draggable="false">'
        else:
            if rel:
                self.missing_media.add(rel)
            media = (f'<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
                     f'<use href="#ring-shape-{i % RING_SHAPES + 1}"/></svg>')
        tag = self.card_tag(p) if "slug" in p else self.piece_meta(p)
        name = (f'<span class="visually-hidden"><span data-lightbox-name>{inline(p["title"])}'
                f'</span> <span data-lightbox-meta>{tag}</span></span>')
        hidden = ' tabindex="-1"' if copy else ""
        item_attrs = ' aria-hidden="true"' if copy else ""
        if "slug" in p:
            el, attrs, extra = "a", f'href="/work/{p["slug"]}/" draggable="false"{hidden}', ""
        else:
            el = "button"
            attrs = 'type="button"' + (hidden if copy else ' data-item aria-haspopup="dialog"')
            extra = "" if copy else f'            {self.piece_images(p)}\n'
        return (f'          <li class="ring-item" data-index="{i}"{item_attrs}>\n'
                f'            <{el} class="ring-object" {attrs}>'
                f'<span class="ring-media">{media}</span>{name}</{el}>\n'
                f'{extra}'
                f'          </li>')

    def ring(self):
        """The ring's markup (templates/ring.html): the items in "order", around as many times
        as RING_MIN_SLOTS asks, and in its middle the name and 'Type · Year' of the object in
        front (ring.js changes them as the ring turns, or to the object under the mouse)."""
        n = len(self.items)
        slots = n * max(1, -(-RING_MIN_SLOTS // n))
        objects = "\n".join(self.ring_item(self.items[s % n], s) for s in range(slots))
        first = self.items[0]
        tag = self.card_tag(first) if "slug" in first else self.piece_meta(first)
        return render("ring.html", objects=objects, title=inline(first["title"]), meta=tag)

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

    def work_statement(self):
        """The sentence over Work's grid (since 2026-11-13, after gougoucore.com's Work, whose
        sentence says who made the work and how): "statement" in content/site.json's "work",
        in the display style, across the page. None there, no sentence. Words in *asterisks* are
        set in the accent face, Kalnia (since 2026-11-14: "I'm Kyuri, a designer")."""
        text = (self.site.get("work") or {}).get("statement")
        if not text:
            return ""
        text = EMPHASIS_RE.sub(r"<em>\1</em>", inline(text))
        return f'      <p class="work-statement">{text}</p>\n'

    def build_work(self):
        """The sentence (work_statement), then one grid of tiles, edge to edge (since
        2026-11-13, after gougoucore.com's Work), under the All / Digital / Brand / Physical
        toggle when WORK_FILTERS is on (main.js shows one filter at a time). Without JavaScript,
        there's no toggle and it shows them all. With HOME_TRACK off (since 2026-11-10) it's the
        site's first page, at /, under Home's opening. With WORK_VIEWS on, the same items on the
        track too, the slider, under the GRID / SLIDER switch (work_views). The sentence and the
        switches sit inside the header's gutters (.wrap, with no --page-max on .work-head since
        2026-11-15, the sentence filling it); the grid runs from the window's edge to edge,
        so main has no .wrap here."""
        s = self.site
        tabs = "\n".join(self.work_tab(name) for name in ("all", *CATEGORIES))
        has_lead = any(self.is_lead(p) for p in self.items)
        places, grid_class = [None] * len(self.items), ""
        if has_lead:
            (desktop, desktop_ends, desktop_rest), (phone, phone_ends, phone_rest) = (
                self.work_layout(self.items, cols) for cols in (3, 2))
            places = [((d, ph), (de, pe)) for d, ph, de, pe
                      in zip(desktop, phone, desktop_ends, phone_ends)]
            grid_class = f" has-lead rest-desktop-{desktop_rest} rest-phone-{phone_rest}"
        cards = "\n".join(self.work_card(p, i, places[i]) for i, p in enumerate(self.items))
        lightbox = render("lightbox.html") if len(self.items) > len(self.projects) else ""
        opening = "" if HOME_TRACK else (
            f'{self.home_intro()}    <script src="/assets/js/intro.js'
            f'?v={file_version("assets/js/intro.js")}"></script>\n')
        views = slider = ring = ""
        if WORK_VIEWS:
            views = self.work_views()
            slider = (f'{self.track(self.items, "lazy")}    <script src="/assets/js/track.js'
                      f'?v={file_version("assets/js/track.js")}" defer></script>\n')
        elif WORK_RING:
            views = self.ring_views()
            ring = (f'{self.ring()}    <script src="/assets/js/ring.js'
                    f'?v={file_version("assets/js/ring.js")}" defer></script>\n')
        head = (self.work_statement()
                + (render("work-tabs.html", tabs=tabs) if WORK_FILTERS else "") + views)
        if head:
            head = f'    <div class="work-head wrap">\n{head}    </div>\n'
        content = render("work.html", cards=cards, lightbox=lightbox, opening=opening,
                         head=head, slider=slider, ring=ring, axes=self.axes("      "),
                         grid_class=grid_class)
        rel, path, title = (("work/index.html", "/work/", f"Work — {s['name']}") if HOME_TRACK
                            else ("index.html", "/", s["title"]))
        self.page(rel, "work", path, title, s["description"], content, "page-work",
                  current="work", image=self.og_image())
        # The slider repeats the grid's items, so its notes aren't counted twice in the report.
        self.placeholder_counts["work"] -= len(PLACEHOLDER_RE.findall(slider + ring))

    def archive_tile(self, item, box, loading, ref="", tag=""):
        """An image on Archive with nothing under it, linking to the image itself; its number
        names the link for screen readers only. Every tile is one shape (--tile-ratio, since
        2026-11-13, after gougoucore.com's Lab), the image cropped to fill it; the lightbox
        shows it whole. main.js opens the lightbox instead, with a copy of the image and the
        caption and date from the text under the tile, which it hides; without JavaScript, the
        link opens the image and the caption and date show under it. Until the file exists, the
        tile is a plain gray block and a <template> holds the labeled gray image the lightbox
        shows in its place, in the shape of box."""
        number = esc(item["id"])
        rel = media_path(item["src"], ARCHIVE_FOLDER)
        meta = " · ".join(x for x in (ref, inline(item.get("date") or ""), archive_link(item)) if x)
        alt, title = item.get("alt") or "", f"Archive {item['id']}"
        thumb = self.tile_image(rel, "archive", title, loading, alt=alt, sizes=ARCHIVE_SIZES)
        if thumb:
            href, large = url_for(rel), ""
        else:
            href = url_for(placeholder_rel(rel))
            large = (f'          <template>'
                     f'{self.img(rel, alt, "archive", title, "eager", decorative=True, box=box)}'
                     f'</template>\n')
        if item.get("caption"):
            name = f'<span class="archive-name" data-lightbox-name>{inline(item["caption"])}</span>'
        else:  # names the lightbox for screen readers, with nothing on screen
            name = (f'<span class="archive-name visually-hidden" data-lightbox-name>'
                    f'Image {number}</span>')
        return (f'        <li class="archive-item">\n'
                + (f'          {tag}\n' if tag else '') +
                f'          <a class="archive-tile" href="{href}" data-item aria-haspopup="dialog">\n'
                f'            <span class="archive-media">{thumb}</span>\n'
                f'            <span class="visually-hidden">Image {number}</span>\n'
                f'          </a>\n'
                f'          <p class="archive-text">{name} <span class="archive-date" '
                f'data-lightbox-meta>{meta}</span></p>\n'
                f'{large}'
                f'        </li>')

    def scales(self):
        """content/site.json's "scales": the sizes of thing the user's work comes in, in order,
        each {"name", "field", "note"}; Archive's columns and About's title block."""
        rows = self.site.get("scales") or []
        for i, row in enumerate(rows):
            need(row, "name", f"content/site.json: scales[{i}]")
        return rows

    @staticmethod
    def about_name(scale):
        """A scale's name on About's globe and its key: its "aboutName" if it has one, else its
        name (since 2026-11-25, the user's ask: the words on About to be ones that say who they
        are, Object, Branding, Digital, Space, while Archive keeps Page and Screen)."""
        return scale.get("aboutName") or scale["name"]

    @staticmethod
    def scale_id(scale):
        return re.sub(r"[^a-z0-9]+", "-", scale["name"].lower()).strip("-")

    def archive_plan(self):
        """Archive as an architect's plan (ARCHIVE_PLAN, since 2026-11-22): the scales across
        (site.json's "scales"), named axis bubbles A, B, C, D over their columns, and each image
        in its scale's column, one under another in the file's order, numbered down it, A01,
        A02, in a tag in its corner, as an architect numbers a set's sheets by discipline. A
        column with none stays white with its letter alone. In the lightbox an image's caption
        line starts with its number and scale: "A01 · Object". Each column is a target,
        /archive/#object (About's scales link them). Returns None when there are no scales."""
        scales = self.scales()
        if not scales:
            return None
        keys = [x["name"].lower() for x in scales]
        cols = {}
        for item in self.archive:
            sc = (item.get("scale") or "").lower()
            if sc not in keys:
                raise BuildError(f'content/archive.json: {item.get("id")}: "scale" must be one '
                                 f'of {", ".join(x["name"] for x in scales)}.')
            cols.setdefault(keys.index(sc), []).append(item)
        bays, n = [], 0
        for c, scale in enumerate(scales):
            letter, name = AXIS_LETTERS[c], inline(scale["name"])
            items = cols.get(c, [])
            head = (f'        <section class="plan-bay{"" if items else " is-empty"}" '
                    f'id="{self.scale_id(scale)}" aria-label="{esc(scale["name"])}">')
            if not items:
                bays.append(f'{head}<p class="plan-ref" aria-hidden="true">{letter}</p>'
                            '</section>')
                continue
            tiles = []
            for k, item in enumerate(items, 1):
                ref = f"{letter}{k:02d}"
                tiles.append(self.archive_tile(
                    item, ARCHIVE_BOXES[n % len(ARCHIVE_BOXES)], "eager" if k == 1 else "lazy",
                    f"{ref} · {name}", f'<p class="plan-ref" aria-hidden="true">{ref}</p>'))
                n += 1
            bays.append(f'{head}\n          <ul class="plan-items">\n' + "\n".join(tiles)
                        + '\n          </ul>\n        </section>')
        return (f'    <div class="plan" style="--cols: {len(scales)}">\n'
                + self.axes("      ", [x["name"] for x in scales])
                + '      <div class="plan-bays">\n' + "\n".join(bays) + '\n      </div>\n'
                '    </div>\n')

    def story(self, scale, cls):
        """A scale's "touches" as a short list, in order, the first an open mark (where it
        began), the rest solid, each its place and what it was, then its "unreached" in the
        display face's italic: Space's story (the user's ask, 2026-11-23: show who they are,
        honestly), as on About's orbits. Nothing without touches."""
        touches = scale.get("touches") or []
        if not touches:
            return ""
        rows = "".join(
            f'<li><span class="{cls}-at">{inline(t["at"])}</span> '
            f'<span class="{cls}-what">{inline(t.get("what") or "")}</span></li>'
            for t in touches)
        note = (f'<p class="{cls}-note">{inline(scale["unreached"])}</p>'
                if scale.get("unreached") else "")
        return f'<ol class="{cls}">{rows}</ol>{note}'

    def archive_binder(self):
        """Archive as a binder of tracing-paper sheets (ARCHIVE_BINDER, since 2026-11-23, the
        user's ask: Archive with more of who they are and a story, after their moodboards: a
        journal's punched pages, a vellum book, layered tracing sheets, a loose grid of objects
        with small labels). One sheet a scale (site.json's "scales", smallest first: A Object,
        B Page, C Screen, D Space), each punched for a binder down its left edge: at its left
        its bubble and name, the field it comes from, the user's own line about it, and for a
        scale with "touches" its story (story); at its right its images, loose on a faint
        drawing grid, each in its own size, its number and scale under it (A01 · Object), as a
        set's sheets are numbered by discipline. With JavaScript each sheet stays as the next
        one is laid over it, and each is tracing paper, so the one under shows through, soft
        (main.js sets where each stops, style.css draws them). A scale with no images yet
        says so in its sheet. Each sheet is a target, /archive/#object (About's scales link
        them). Returns None when there are no scales."""
        scales = self.scales()
        if not scales:
            return None
        keys = [x["name"].lower() for x in scales]
        cols = {}
        for item in self.archive:
            sc = (item.get("scale") or "").lower()
            if sc not in keys:
                raise BuildError(f'content/archive.json: {item.get("id")}: "scale" must be one '
                                 f'of {", ".join(x["name"] for x in scales)}.')
            cols.setdefault(keys.index(sc), []).append(item)
        last = AXIS_LETTERS[len(scales) - 1]
        sheets, n = [], 0
        for c, scale in enumerate(scales):
            letter, name = AXIS_LETTERS[c], inline(scale["name"])
            items = cols.get(c, [])
            tiles = []
            for k, item in enumerate(items, 1):
                tiles.append(self.archive_tile(
                    item, ARCHIVE_BOXES[n % len(ARCHIVE_BOXES)],
                    "eager" if c == 0 and k <= 2 else "lazy", f"{letter}{k:02d} · {name}"))
                n += 1
            field = (f'          <p class="sheet-field">{inline(scale["field"])}</p>\n'
                     if scale.get("field") else "")
            note = (f'          <p class="sheet-note">{inline(scale["note"])}</p>\n'
                    if scale.get("note") else "")
            story = self.story(scale, "sheet-story")
            count = f'{len(items):02d} piece{"" if len(items) == 1 else "s"}'
            body = ('        <ul class="sheet-items">\n' + "\n".join(tiles)
                    + '\n        </ul>\n') if items else (
                    '        <p class="sheet-empty">Nothing filed here yet.</p>\n')
            sheets.append(
                f'      <section class="sheet{" is-unreached" if scale.get("unreached") else ""}" '
                f'id="{self.scale_id(scale)}" aria-labelledby="sheet-{letter.lower()}">\n'
                '        <div class="sheet-head">\n'
                f'          <h2 class="sheet-name" id="sheet-{letter.lower()}">'
                f'<span class="bubble" aria-hidden="true">{letter}</span>{name}</h2>\n'
                f'          <p class="sheet-number">Sheet {letter} / {last} · {count}</p>\n'
                f'{field}{note}'
                + (f'          {story}\n' if story else "") +
                '        </div>\n'
                f'{body}'
                '      </section>')
        return ('    <div class="binder">\n' + "\n".join(sheets) + '\n    </div>\n')

    @staticmethod
    def roman(n):
        """1 to 3999 in Roman numerals, as a sequence's stations are numbered: 4 is IV."""
        out = ""
        for value, letters in ((1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"),
                               (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"),
                               (5, "V"), (4, "IV"), (1, "I")):
            while n >= value:
                out, n = out + letters, n - value
        return out

    def archive_station(self, item, box, loading, numeral, name, side):
        """One image as a station on Archive's axis (archive_sequence): the image in its own
        shape (--r, from the file, or the gray box's until it exists), on the axis's left or
        right (side), linking to itself as Archive's tiles do (the lightbox opens it); beside it
        its number in a filled bubble, its scale and date in the label style, and its caption
        in the text's italic, as a sheet's stations are called out. The lightbox's caption line
        starts with its number: "III · Page · 2025-08"."""
        number = esc(item["id"])
        rel = media_path(item["src"], ARCHIVE_FOLDER)
        alt, title = item.get("alt") or "", f"Archive {item['id']}"
        thumb = self.tile_image(rel, "archive", title, loading, alt=alt, sizes=SEQUENCE_SIZES)
        w, h = (media_size(rel) if thumb else None) or box
        if thumb:
            href, large = url_for(rel), ""
        else:
            href = url_for(placeholder_rel(rel))
            large = (f'          <template>'
                     f'{self.img(rel, alt, "archive", title, "eager", decorative=True, box=box)}'
                     f'</template>\n')
        if item.get("caption"):
            caption = (f'<span class="seq-caption" data-lightbox-name>'
                       f'{inline(item["caption"])}</span>')
        else:  # names the lightbox for screen readers, with nothing on screen
            caption = (f'<span class="seq-caption visually-hidden" data-lightbox-name>'
                       f'Image {number}</span>')
        meta = " · ".join(x for x in (name, inline(item.get("date") or ""), archive_link(item))
                          if x)
        return (f'          <li class="seq-station is-{side}" style="--r: {w} / {h}">\n'
                f'            <a class="seq-figure" href="{href}" data-item aria-haspopup="dialog">\n'
                f'              <span class="archive-media">{thumb}</span>\n'
                f'              <span class="visually-hidden">Image {number}</span>\n'
                f'            </a>\n'
                f'            <p class="seq-label"><span class="seq-no" aria-hidden="true">'
                f'{numeral}</span><span class="seq-meta" data-lightbox-meta>'
                f'<span class="seq-ref">{numeral} · </span>{meta}</span>{caption}</p>\n'
                f'{large}'
                f'          </li>')

    def archive_sequence(self):
        """Archive as one drawing that tells one story (ARCHIVE_SEQUENCE, since 2026-11-24, the
        user's ask, after an architecture student's masterplan sequence on their Pinterest: one
        axis, fragments of images along it, numbered stations, brackets, a scale bar). One axis
        down the page (the window's middle from 1200px, near its left edge under that), and
        along it the scales in order (site.json's "scales", smallest first), each a stretch of
        it: at the left its bubble and name, its count, the field it comes from and the user's
        own line, in a bracket as long as its stretch (from 1200px the words stay in view while
        it scrolls by); on the axis its images, in the file's order, each a station
        (archive_station), numbered I, II, III down the whole axis, left and right of it in
        turn, each scale's a little wider than the one before, as the things get bigger. A
        scale with "unreached" (Space, the architect the user wanted to be) is drawn dashed,
        and its "touches" are marked on it before its images, the first an open mark where it
        began, each after it a short solid stretch, its place and what it was beside it; where
        the axis ends, its "unreached" in the display face's italic, "I never became one.". At
        the foot, a scale bar of the scales, each longer than the one before, the last dashed,
        and the legend (scalesDrawing's "legend": solid, dashed). Each stretch is a target,
        /archive/#object (About's scales link them). Returns None when there are no scales."""
        scales = self.scales()
        if not scales:
            return None
        cols = self.archive_by_scale(scales)
        groups, n = [], 0
        for c, scale in enumerate(scales):
            letter, name = AXIS_LETTERS[c], inline(scale["name"])
            items = cols.get(c, [])
            stations = []
            for item in items:
                n += 1
                stations.append(self.archive_station(
                    item, ARCHIVE_BOXES[(n - 1) % len(ARCHIVE_BOXES)],
                    "eager" if n <= 2 else "lazy", self.roman(n), name,
                    "left" if n % 2 else "right"))
            count = f'{len(items):02d} piece{"" if len(items) == 1 else "s"}'
            field = (f'          <p class="seq-field">{inline(scale["field"])}</p>\n'
                     if scale.get("field") else "")
            note = (f'          <p class="seq-note">{inline(scale["note"])}</p>\n'
                    if scale.get("note") else "")
            touches = ""
            if scale.get("touches"):
                rows = "\n".join(
                    f'          <li><span class="seq-at">{inline(t["at"])}</span>'
                    f'<span class="seq-what">{inline(t.get("what") or "")}</span></li>'
                    for t in scale["touches"])
                touches = f'        <ol class="seq-touches">\n{rows}\n        </ol>\n'
            body = ('        <ol class="seq-stations">\n' + "\n".join(stations)
                    + '\n        </ol>\n') if stations else ""
            end = (f'        <p class="seq-end">{inline(scale["unreached"])}</p>\n'
                   if scale.get("unreached") else "")
            unreached = " is-unreached" if scale.get("unreached") else ""
            groups.append(
                f'      <section class="seq-group{unreached}" id="{self.scale_id(scale)}" '
                f'style="--k: {c}" aria-labelledby="seq-{letter.lower()}">\n'
                '        <span class="seq-bracket" aria-hidden="true"></span>\n'
                '        <div class="seq-head">\n'
                f'          <h2 class="seq-name" id="seq-{letter.lower()}">'
                f'<span class="bubble" aria-hidden="true">{letter}</span>{name}</h2>\n'
                f'          <p class="seq-count">{count}</p>\n'
                f'{field}{note}'
                '        </div>\n'
                f'{touches}{body}{end}'
                '      </section>')
        bar = "".join(
            f'<li class="{"is-unreached" if x.get("unreached") else ""}" '
            f'style="--u: {i + 2}">{inline(x["name"])}</li>'
            for i, x in enumerate(scales))
        legend = (self.site.get("scalesDrawing") or {}).get("legend") or []
        legend = "".join(f'<li class="is-{kind}">{inline(words)}</li>'
                         for kind, words in zip(("solid", "dashed"), legend))
        key = ('      <div class="seq-key" aria-hidden="true">\n'
               f'        <ol class="scale-bar">{bar}</ol>\n'
               + (f'        <ul class="seq-legend">{legend}</ul>\n' if legend else "") +
               '      </div>\n')
        return ('    <div class="sequence">\n' + "\n".join(groups) + '\n' + key + '    </div>\n')

    def archive_by_scale(self, scales):
        """content/archive.json's items gathered by their "scale" (one of site.json's "scales",
        by name), in the file's order: {scale's index: [items]}."""
        keys = [x["name"].lower() for x in scales]
        cols = {}
        for item in self.archive:
            sc = (item.get("scale") or "").lower()
            if sc not in keys:
                raise BuildError(f'content/archive.json: {item.get("id")}: "scale" must be one '
                                 f'of {", ".join(x["name"] for x in scales)}.')
            cols.setdefault(keys.index(sc), []).append(item)
        return cols

    # The map's drawing (map_layout), in percent of the sheet's width, from 768px ("wide") and
    # on phones ("tall"). No grid and no columns (since 2026-11-24 night, the user's ask: their
    # interests and their eye, freely, not sorted into A B C D): image after image, a width
    # from "sizes" and its middle at the next of "spots" across the sheet, in turn, so big and
    # small, left and right, mix as on a pinboard; each starts "step" (the next of them) of
    # the way down the one before (a little on a wide sheet, so they sit side by side, more on
    # a phone's) and, if it would cover more than MAP_OVERLAP of any image
    # already down (of the smaller one), lower, so every one shows; one very tall is kept
    # narrower, no more than MAP_TALLEST times its width tall. Room over the first and under
    # the last: top, foot.
    MAP_SHAPES = {
        "wide": {"sizes": (30, 22, 18, 26, 21, 32, 17, 24),
                 "spots": (19, 54, 86, 35, 80, 17, 52, 84),
                 "step": (0.1, 0.22, 0.05, 0.18, 0.12, 0.04, 0.2, 0.08), "top": 4, "foot": 4,
                 "near": 0.04, "gap": 11},
        "tall": {"sizes": (62, 44, 50, 40, 66, 46, 42, 56),
                 "spots": (24, 82, 30, 80, 22, 84, 28, 80),
                 "step": (0.42, 0.55, 0.36, 0.6, 0.45, 0.4, 0.52, 0.46), "top": 5, "foot": 6,
                 "near": 0.3, "gap": 22},
    }
    MAP_OVERLAP, MAP_TALLEST = 0.14, 1.3

    @classmethod
    def map_layout(cls, ratios, shape, groups=None):
        """Where a map's images go (archive_map). ratios: each image's shape, width / height,
        in the map's order. groups (ARCHIVE_MAP_GROUPS): each image's (field, project); a new
        field starts "gap" under everything above it, back at the first of "spots" and
        "sizes", and the next image of the same project only "near" of the way down the one
        before, so it sits beside it. Returns {"ratio": the sheet's "width / height", "pieces": per image
        (x, y, w), its top left corner and width, "pins": per image (x, y, side), where the
        thread meets it: the top corner facing the image before ("left" or "right")}; x and w
        in percent of the sheet's width, y of its height."""
        s = cls.MAP_SHAPES[shape]
        rects = []

        def covered(a, b):  # how much of the smaller of two rects the other covers
            ox = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
            oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
            if ox <= 0 or oy <= 0:
                return 0
            return ox * oy / min(a[2] * a[3], b[2] * b[3])

        k = -1  # the image's place in its field (in the map, without groups)
        for i, r in enumerate(ratios):
            here, before = (groups[i], groups[i - 1]) if groups and i else (None, None)
            new_field = bool(here) and here[0] != before[0]
            k = 0 if new_field else k + 1
            size = s["sizes"][k % len(s["sizes"])]
            w = min(size, size * cls.MAP_TALLEST * r)
            h = w / r
            x = max(0.0, min(s["spots"][k % len(s["spots"])] - w / 2, 100 - w))
            y = s["top"]
            if new_field:
                y = max(ry + rh for _, ry, _, rh in rects) + s["gap"]
            elif rects:
                step = s["near"] if here and here == before else s["step"][k % len(s["step"])]
                y = rects[-1][1] + step * rects[-1][3]
            while any(covered((x, y, w, h), q) > cls.MAP_OVERLAP for q in rects):
                y += 0.5
            rects.append((x, y, w, h))
        tall_ = max((y + h for _, y, _, h in rects), default=s["top"]) + s["foot"]

        def py(y):
            return round(y / tall_ * 100, 2)

        pins = []
        for i, (x, y, w, _) in enumerate(rects):
            before = rects[i - 1] if i else None
            right = bool(before) and before[0] + before[2] / 2 > x + w / 2
            pins.append((round(x + w, 2) if right else round(x, 2), py(y),
                         "right" if right else "left"))
        return {
            "ratio": f"100 / {tall_:.2f}",
            "pieces": [(round(x, 2), py(y), round(w, 2)) for x, y, w, _ in rects],
            "pins": pins,
        }

    def archive_in_time(self):
        """content/archive.json's items in time's order, oldest first: by "date" as written
        (2019, 2019-05: so the year first), those without one after them in the file's
        order."""
        return [it for _, it in sorted(
            enumerate(self.archive),
            key=lambda p: (0, str(p[1]["date"]), p[0]) if p[1].get("date") else (1, "", p[0]))]

    # The board's drawing (board_layout), in percent of the sheet's width: from 768px ("wide")
    # two columns, "width" wide, starting at "cols", the second "drop" lower; on phones ("tall")
    # one. A group's title takes "title" over its images, and the next group in a column
    # starts "gap" under the one before.
    BOARD_SHAPES = {
        "wide": {"cols": (0, 53), "width": 47, "drop": (0, 7), "title": 7, "gap": 9, "foot": 3},
        "tall": {"cols": (0,), "width": 100, "drop": (0,), "title": 17, "gap": 14, "foot": 4},
    }
    # A row of a group, by how many images are in it: their widths, in percent of the group's
    # width, where their middles go, and how far down each starts, in heights of the row's
    # first; every other row mirrored, so rows don't line up. A project's images take a row of
    # their own (three at most to a row), circled by its loop; the others go two to a row, a
    # row starting BOARD_RISE of its shortest image's height up into the one before, as a
    # collage. No image covers another (since 2026-11-25, the user's ask, once they were in
    # their own colors and an overlap hid a poster's name): a row's images are pushed apart
    # sideways to BOARD_GAP between them, and one comes lower until it's BOARD_GAP clear of
    # every image already down (they overlapped up to 16% of the smaller one before).
    # A loop is an ellipse round its images' box, BOARD_LOOP (wider, taller) times its half
    # width and height plus BOARD_PAD, so their corners just cross it, as a pencil loop does,
    # and it's drawn under them; nothing else comes within BOARD_CLEAR of it (all in percent of
    # the group's width).
    BOARD_ROWS = {
        1: ((46,), (32,), (0,)),
        2: ((50, 42), (28, 73), (0, 0.1)),
        3: ((34, 28, 32), (18, 51, 83), (0, 0.14, 0.05)),
    }
    BOARD_GAP, BOARD_RISE = 2.5, 0.1
    BOARD_LOOP, BOARD_PAD, BOARD_CLEAR = (1.08, 1.16), 3, 4
    # A group's lead (an image with "lead": true in archive.json, one a scale; since
    # 2026-11-25, the user's ask: a way in, big against the others) comes first in its group,
    # with its project first, at the group's left, BOARD_LEAD (its widest, its tallest) of the
    # group's width; when the room beside it is BOARD_BESIDE wide or more, the next images of
    # its project (or, with none, the next loose ones) stack there as long as they fit by its
    # side, and the rest go in rows under it.
    BOARD_LEAD, BOARD_BESIDE = (82, 90), 22
    BOARD_TURNS = (-3, 2.5, -2, 3.5)  # each loop's slant, in degrees, in turn

    @classmethod
    def board_lead(cls, ratios):
        """A group's lead and the images by its side (board_group): ratios, its unit's, the
        lead's first. Returns their rects (x, y, w, h), in percent of the group's width."""
        widest, tallest = cls.BOARD_LEAD
        w = min(widest, tallest * ratios[0])
        h = w / ratios[0]
        rects, x = [(0.0, 0.0, w, h)], w + cls.BOARD_GAP
        room, y = 100 - x, 0.0
        if room >= cls.BOARD_BESIDE:
            for r in ratios[1:]:
                bw = min(room, room * cls.MAP_TALLEST * r)
                if y + bw / r > h + cls.BOARD_GAP:
                    break
                rects.append((x, y, bw, bw / r))
                y += bw / r + cls.BOARD_GAP
        return rects

    @classmethod
    def board_group(cls, units, lead=False):
        """One group's images in rows (board_layout). units: (project or None, [ratios]) in
        order; lead: the first unit's first image is the group's lead (board_lead). Returns
        the images' rects (x, y, w, h) and per unit with a project (project, first, end, (cx,
        cy, rx, ry)), the rects that are its and its loop, all in percent of the group's
        width."""
        rects, spans, before, row = [], [], [], 0
        floor = 0.0  # the lowest a loop above reaches, plus BOARD_CLEAR

        def near(a, b):  # less than BOARD_GAP apart both ways: overlapping, or nearly
            ox = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]) + cls.BOARD_GAP
            oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]) + cls.BOARD_GAP
            return ox > 1e-6 and oy > 1e-6

        def loop(part):
            bx, by = min(r[0] for r in part), min(r[1] for r in part)
            bw = max(r[0] + r[2] for r in part) - bx
            bh = max(r[1] + r[3] for r in part) - by
            cx = bx + bw / 2
            rx = min(bw / 2 * cls.BOARD_LOOP[0] + cls.BOARD_PAD, cx + 2, 102 - cx)
            return cx, by + bh / 2, rx, bh / 2 * cls.BOARD_LOOP[1] + cls.BOARD_PAD

        for u, (project, ratios) in enumerate(units):
            first = len(rects)
            size = 3 if project else 2
            j = 0
            if lead and u == 0 and ratios:  # the lead and those by its side, at the top
                line = cls.board_lead(ratios)
                rects += line
                before, row, j = line, row + 1, 1
                ratios = ratios[len(line):]
            for j, chunk in enumerate((ratios[i:i + size] for i in range(0, len(ratios), size)),
                                      start=j):
                widths, spots, drops = cls.BOARD_ROWS[len(chunk)]
                if row % 2:
                    spots = [100 - s for s in spots]
                if not rects:
                    top = 0.0
                elif j:  # the unit's next row: a little up into the one before, as a collage
                    top = (max(y + h for _, y, _, h in before)
                           - cls.BOARD_RISE * min(h for *_, h in before))
                else:  # a unit's first row: under all above, loops included
                    top = max(floor, max(y + h for _, y, _, h in rects) + cls.BOARD_CLEAR)
                sizes = [(w, w / r) for w, r in
                         ((min(widths[i], widths[i] * cls.MAP_TALLEST * r), r)
                          for i, r in enumerate(chunk))]
                # across: each at its spot, then, from the left, pushed apart to BOARD_GAP
                # between them, the row kept on the sheet (its widths add up to less than it)
                xs = [max(0.0, min(spots[i] - w / 2, 100 - w)) for i, (w, _) in enumerate(sizes)]
                by_x = sorted(range(len(xs)), key=xs.__getitem__)
                for lo, hi in zip(by_x, by_x[1:]):
                    xs[hi] = max(xs[hi], xs[lo] + sizes[lo][0] + cls.BOARD_GAP)
                spill = max(x + w for x, (w, _) in zip(xs, sizes)) - 100
                xs = [max(0.0, x - max(0.0, spill)) for x in xs]
                line = []
                for i, (w, h) in enumerate(sizes):
                    x = xs[i]
                    y = top + drops[i] * (line[0][3] if line else h)
                    while any(near((x, y, w, h), q) for q in rects + line):
                        y += 0.5
                    line.append((x, y, w, h))
                rects += line
                before, row = line, row + 1
            if project:
                # its loop clear of all above: the unit moves down if its loop would reach up
                cx, cy, rx, ry = loop(rects[first:])
                above = max((y + h for _, y, _, h in rects[:first]), default=None)
                if above is not None:
                    shift = max(0.0, max(above, floor) + cls.BOARD_CLEAR - (cy - ry))
                    rects[first:] = [(x, y + shift, w, h) for x, y, w, h in rects[first:]]
                    cy += shift
                spans.append((project, first, len(rects), (cx, cy, rx, ry)))
                floor = cy + ry + cls.BOARD_CLEAR
        return rects, spans

    @classmethod
    def board_layout(cls, groups, shape):
        """Where the board's parts go (archive_board). groups: (field, units, lead) in order,
        units and lead as board_group takes them. Returns {"ratio": the sheet's "width / height", "pieces":
        per image (x, y, w), "titles": per group (x, y), its top left corner, "loops": per
        project (cx, cy, rx, ry, turn), "tags": per project (x, y), where its name sits on its
        loop}; x, w, cx and rx in percent of the sheet's width, y, cy and ry of its height."""
        s = cls.BOARD_SHAPES[shape]
        bottoms = list(s["drop"])
        started = [False] * len(s["cols"])
        rects, titles, loops = [], [], []
        for n, (_, units, lead) in enumerate(groups):
            rel, spans = cls.board_group(units, lead)
            c = n if n < len(bottoms) else min(range(len(bottoms)), key=bottoms.__getitem__)
            x0, k = s["cols"][c], s["width"] / 100
            top = bottoms[c] + (s["gap"] if started[c] else 0)
            started[c] = True
            titles.append((x0, top))
            y0 = top + s["title"]
            mine = [(x0 + x * k, y0 + y * k, w * k, h * k) for x, y, w, h in rel]
            ends = [y + h for _, y, _, h in mine]
            for *_, (cx, cy, rx, ry) in spans:
                loops.append((x0 + cx * k, y0 + cy * k, rx * k, ry * k))
                ends.append(y0 + (cy + ry) * k)
            rects += mine
            bottoms[c] = max(ends) if ends else y0
        tall_ = max(bottoms) + s["foot"]

        def py(y):
            return round(y / tall_ * 100, 2)

        return {
            "ratio": f"100 / {tall_:.2f}",
            "pieces": [(round(x, 2), py(y), round(w, 2)) for x, y, w, _ in rects],
            "titles": [(round(x, 2), py(y)) for x, y in titles],
            "loops": [(round(cx, 2), py(cy), round(rx, 2), py(ry),
                       cls.BOARD_TURNS[i % len(cls.BOARD_TURNS)])
                      for i, (cx, cy, rx, ry) in enumerate(loops)],
            "tags": [(round(cx + rx * 0.5, 2), py(cy - ry * 0.87)) for cx, cy, rx, ry in loops],
        }

    def archive_board(self):
        """Archive as a board of groups (ARCHIVE_MAP_BOARD, since 2026-11-25, the user's ask,
        from a moodboard page: the same field and the same project together, clearly and
        cleanly). A group a field (an image's "scale"), in site.json's "scales" order, each a
        section headed by the scale's name, its field beside it, over a tight collage of its
        images (board_layout): each project's images in a row of their own, circled by one
        loose 1px loop with the project's name and year on it, the others two to a row. Each
        image opens the lightbox with its caption, date and link, as on the map."""
        pairs = self.archive_in_groups(leads_first=True)
        items = [item for item, _ in pairs]
        boxes, groups = [], []
        for n, (item, (field, _)) in enumerate(pairs):
            box = ARCHIVE_BOXES[n % len(ARCHIVE_BOXES)]
            rel = media_path(item["src"], ARCHIVE_FOLDER)
            real = os.path.exists(os.path.join(ROOT, rel)) and media_size(rel)
            boxes.append((box, real or box))
            project = item.get("project") or None
            if not groups or groups[-1][0] != field:
                groups.append((field, []))
            units = groups[-1][1]
            if units and units[-1][0] == project:
                units[-1][1].append(n)
            else:
                units.append((project, [n]))
        ratios = [w / h for _, (w, h) in boxes]
        shaped = [(f, [(p, [ratios[n] for n in idx]) for p, idx in units],
                   bool(items[units[0][1][0]].get("lead"))) for f, units in groups]
        wide, tall = self.board_layout(shaped, "wide"), self.board_layout(shaped, "tall")
        scales = {str(sc.get("name", "")).lower(): sc for sc in self.site.get("scales") or []}

        def loops(lay):
            return "".join(
                f'<ellipse cx="{cx}%" cy="{cy}%" rx="{rx}%" ry="{ry}%" '
                f'style="transform: rotate({turn}deg)"/>' for cx, cy, rx, ry, turn in lay["loops"])

        sections, loop_no = [], 0
        for g, (field, units) in enumerate(groups):
            scale = scales.get(field) or {}
            label = f"map-group-{g + 1}"
            (x, y), (tx, ty) = wide["titles"][g], tall["titles"][g]
            title = ""
            if scale.get("name"):
                kind = (f' <span class="map-title-field">{esc(scale["field"])}</span>'
                        if scale.get("field") else "")
                title = (f'      <h2 class="map-title" id="{label}" style="--x: {x}%; --y: {y}%; '
                         f'--tx: {tx}%; --ty: {ty}%"><span class="map-title-name">'
                         f'{esc(scale["name"])}</span>{kind}</h2>\n')
            pieces, tags = [], []
            for project, idx in units:
                for n in idx:
                    pieces.append(self.board_piece(items[n], n, boxes[n], wide, tall))
                if project:
                    years = sorted({str(items[n].get("date") or "")[:4] for n in idx} - {""})
                    when = (f" · {years[0]}" + (f"–{years[-1]}" if len(years) > 1 else "")
                            if years else "")
                    (lx, ly), (tlx, tly) = wide["tags"][loop_no], tall["tags"][loop_no]
                    tags.append(f'      <p class="map-tag" style="--x: {lx}%; --y: {ly}%; '
                                f'--tx: {tlx}%; --ty: {tly}%" aria-hidden="true">'
                                f'{esc(project)}{when}</p>\n')
                    loop_no += 1
            sections.append(
                f'      <section class="map-group"'
                + (f' aria-labelledby="{label}"' if title else "") + '>\n'
                + title + '      <ol class="map-pieces">\n' + "\n".join(pieces)
                + '\n      </ol>\n' + "".join(tags) + '      </section>\n')
        return ('    <div class="atlas">\n'
                f'      <div class="map is-board" style="--ratio: {wide["ratio"]}; '
                f'--tall-ratio: {tall["ratio"]}">\n'
                '        <svg class="map-loops" aria-hidden="true" focusable="false">'
                f'<g class="is-wide">{loops(wide)}</g><g class="is-tall">{loops(tall)}</g>'
                '</svg>\n' + "".join(sections) + '      </div>\n    </div>\n')

    def board_piece(self, item, n, boxes, wide, tall):
        """One image on the board (archive_board): as on the map, without its pin."""
        box, (w, h) = boxes
        number = esc(item["id"])
        rel = media_path(item["src"], ARCHIVE_FOLDER)
        alt, title = item.get("alt") or "", f"Archive {item['id']}"
        thumb = self.tile_image(rel, "archive", title, "eager" if n < 3 else "lazy",
                                alt=alt, sizes=MAP_SIZES)
        if thumb:
            href, large = url_for(rel), ""
        else:
            href = url_for(placeholder_rel(rel))
            large = (f'          <template>'
                     f'{self.img(rel, alt, "archive", title, "eager", decorative=True, box=box)}'
                     f'</template>\n')
        date = inline(item.get("date") or "")
        meta = " · ".join(x for x in (date, archive_link(item, hidden=True)) if x)
        caption = inline(item.get("caption") or "") or f"Image {number}"
        (x, y, wd), (tx, ty, tw) = wide["pieces"][n], tall["pieces"][n]
        return (f'        <li class="map-piece">\n'
                f'          <a class="map-fig" href="{href}" style="--r: {w} / {h}; --x: {x}%; '
                f'--y: {y}%; --w: {wd}%; --tx: {tx}%; --ty: {ty}%; --tw: {tw}%" data-item '
                f'aria-haspopup="dialog">\n'
                f'            <span class="archive-media">{thumb}</span>\n'
                f'            <span class="visually-hidden">Image {number}</span>\n'
                f'          </a>\n'
                f'          <p class="visually-hidden"><span data-lightbox-name>{caption}</span> '
                f'<span data-lightbox-meta>{meta}</span></p>\n'
                f'{large}'
                f'        </li>')

    def archive_in_groups(self, leads_first=False):
        """content/archive.json's items by field and project (ARCHIVE_MAP_GROUPS), with each
        one's (field, project) for map_layout: fields in site.json's "scales" order (an
        unknown or missing "scale" after them); in a field, its projects by their oldest
        date, those with none after them in the file's order; in a project, oldest first.
        leads_first (the board's): in a field, the project with its lead (an image with
        "lead": true) first, and in it the lead first."""
        order = [str(s.get("name", "")).lower() for s in self.site.get("scales") or []]

        def when(p):  # (index, item) -> its place in time, the lead before all if leads_first
            first = 0 if leads_first and p[1].get("lead") else 1
            if p[1].get("date"):
                return (first, 0, str(p[1]["date"]), p[0])
            return (first, 1, "", p[0])

        groups = {}
        for p in enumerate(self.archive):
            field = str(p[1].get("scale") or "").lower()
            project = p[1].get("project") or f'#{p[1]["id"]}'
            groups.setdefault((field, project), []).append(p)
        keys = sorted(groups, key=lambda g: (
            order.index(g[0]) if g[0] in order else len(order), min(map(when, groups[g]))))
        out = []
        for g in keys:
            out += [(it, g) for _, it in sorted(groups[g], key=when)]
        return out

    @staticmethod
    def flow_rows(sizes, leads, cols):
        """How Archive's images run with `cols` across (ARCHIVE_GRID): in order, left to right
        and down with no gaps, as few spanning two columns as close the last row (none
        starting in the last column), and each row as tall as suits its images, one of
        ARCHIVE_ROW_RATIOS (a cell's width over its height), the one that crops them least.
        Of the ways that close the rows, the one that crops least over all, a wide image
        narrower than WIDE_MIN_PX counting against it and one with "lead" in archive.json
        for it. sizes: each image's (width, height). Returns, for each image, whether it's
        wide, whether it ends a row and its row's ratio; and the empty cells closing the last
        row when no way works."""
        from itertools import combinations
        n, need = len(sizes), (-len(sizes)) % cols

        def loss(ratio, cell):  # the share of the image cropped away in a cell of that shape
            return 1 - min(ratio, cell) / max(ratio, cell)

        def lay(wide):
            col, rows, row = 0, [], []
            for i in range(n):
                span = 2 if i in wide else 1
                if col + span > cols:
                    return None
                row.append(i)
                col = (col + span) % cols
                if col == 0:
                    rows.append(row)
                    row = []
            if row:
                rows.append(row)
            total, shapes = 0.0, {}
            for row in rows:
                cost, cell = min(
                    (sum(loss(sizes[i][0] / sizes[i][1], c * (2 if i in wide else 1))
                         for i in row), c) for c in ARCHIVE_ROW_RATIOS)
                total += cost
                shapes.update((i, cell) for i in row)
            for i in wide:
                total += max(0, WIDE_MIN_PX - sizes[i][0]) / WIDE_MIN_PX - 0.3 * leads[i]
            return total, shapes, col

        best = None
        for wide in combinations(range(n), need):
            laid = lay(set(wide))
            if laid and laid[2] == 0 and (best is None or laid[0] < best[0]):
                best = (laid[0], set(wide), laid[1])
        wide, shapes = (best[1], best[2]) if best else (set(), lay(set())[1])
        flags, ends, col = [], [], 0
        for i in range(n):
            col = (col + (2 if i in wide else 1)) % cols
            flags.append(i in wide)
            ends.append(col == 0)
        return flags, ends, [shapes[i] for i in range(n)], 0 if best else (-n) % cols

    def archive_grid(self):
        """Archive as one grid with no gaps (ARCHIVE_GRID, since 2026-11-26, the user's asks: a
        clean grid, then "with no gaps, like gougoucore.com/13/", its Lab): every image, by
        field and project as on the board (archive_in_groups), from the window's edge to its
        edge right under the header, 2 across on phones and 3 from 768px, Work's construction
        lines between them and + marks where they cross, nothing under them (captions are in
        the lightbox). Each fills its cell; a row is as tall as suits its images, and where the
        last row wouldn't be full, one spans two columns (flow_rows)."""
        items = [item for item, _ in self.archive_in_groups(leads_first=True)]
        sizes = []
        for item in items:
            rel = media_path(item["src"], ARCHIVE_FOLDER)
            sizes.append(os.path.exists(os.path.join(ROOT, rel)) and media_size(rel)
                         or ARCHIVE_BOXES[0])
        leads = [bool(item.get("lead")) for item in items]
        (p_wide, p_ends, p_cell, p_rest), (d_wide, d_ends, d_cell, d_rest) = (
            self.flow_rows(sizes, leads, cols) for cols in ARCHIVE_GRID_COLS)
        cells = [self.grid_cell(item, n + 1, (p_wide[n], d_wide[n]), (p_ends[n], d_ends[n]),
                                (p_cell[n], d_cell[n]),
                                "eager" if n < ARCHIVE_GRID_COLS[-1] else "lazy")
                 for n, item in enumerate(items)]
        rest = "".join(f" rest-{name}-{k}" for name, k in (("phone", p_rest),
                                                           ("desktop", d_rest)) if k)
        return (f'    <ol class="archive-grid is-flow{rest}">\n' + "\n".join(cells)
                + '\n    </ol>\n')

    def grid_cell(self, item, number, wide, ends, cell, loading):
        """One image on Archive's grid (archive_grid): a link opening the lightbox, as on the
        board, the image filling its cell, cropped round its "focus" in archive.json (a CSS
        position, "90% 50%") when its subject is off its middle. wide, ends and cell: whether
        it spans two columns, whether it ends a row, and its row's shape (--row), on phones
        and from 768px."""
        rel = media_path(item["src"], ARCHIVE_FOLDER)
        alt, title = item.get("alt") or "", f"Archive {item['id']}"
        sizes = (f"(min-width: 768px) {67 if wide[1] else 33}vw, {100 if wide[0] else 50}vw")
        thumb = self.tile_image(rel, "archive", title, loading, alt=alt, sizes=sizes)
        large = ""
        if thumb:
            href = url_for(rel)
        else:
            href = url_for(placeholder_rel(rel))
            box = ARCHIVE_BOXES[(number - 1) % len(ARCHIVE_BOXES)]
            large = (f'          <template>'
                     f'{self.img(rel, alt, "archive", title, "eager", decorative=True, box=box)}'
                     f'</template>\n')
        caption = inline(item.get("caption") or "")
        name_cls = "archive-name" if caption else "archive-name visually-hidden"
        caption = caption or f"Image {esc(item['id'])}"  # names the lightbox for screen readers
        meta = " · ".join(x for x in (inline(item.get("date") or ""), archive_link(item)) if x)
        classes = [name for name, on in (("is-wide-phone", wide[0]), ("is-wide-desktop", wide[1]),
                                         ("row-end-phone", ends[0]), ("row-end-desktop", ends[1]))
                   if on]
        cls = f' class="{" ".join(classes)}"' if classes else ""
        style = f"--row-phone: {cell[0]:.4g}; --row-desktop: {cell[1]:.4g}"
        if item.get("focus"):
            style += f'; --focus: {esc(item["focus"])}'
        return (f'      <li{cls} style="{style}">\n'
                f'        <a class="archive-tile" href="{href}" data-item aria-haspopup="dialog">\n'
                f'          <span class="archive-media">{thumb}</span>\n'
                f'          <span class="visually-hidden">Image {number:03d}</span>\n'
                f'        </a>\n'
                f'        <p class="archive-text"><span class="{name_cls}" data-lightbox-name>'
                f'{caption}</span> <span class="archive-date" data-lightbox-meta>{meta}</span></p>\n'
                f'{large}'
                f'      </li>')

    def archive_map(self):
        """Archive as one map (ARCHIVE_MAP, since 2026-11-24, the user's asks: images rather
        than words, one map rather than a list; that evening closer together, more joined and
        in time's order; that night free, their interests across fields and their eye, not
        sorted into scales). Every image in archive.json on one sheet, in its own shape (from
        the file, or the gray box's until it exists), oldest first (archive_in_time), big and
        small, left and right, overlapping a little (map_layout), and one dashed thread through
        them in that order, pin to pin, a small square where it meets each at a top corner and
        its number beside it, 01, 02, with its date when it has one. Its caption is the
        lightbox's, with its date ("Image 003" until it has one). Drawn twice, from 768px
        wide and on phones tall; the CSS takes one. With ARCHIVE_MAP_GROUPS (since
        2026-11-25) not in time's order but by field and project (archive_in_groups): an
        image's "scale" and "project" set its place, and the thread runs through the groups;
        without it, an image's "scale" isn't used here."""
        if ARCHIVE_MAP_GROUPS:
            items, groups = map(list, zip(*self.archive_in_groups())) if self.archive else ([], [])
        else:
            items, groups = self.archive_in_time(), None
        boxes = []
        for n, item in enumerate(items):
            box = ARCHIVE_BOXES[n % len(ARCHIVE_BOXES)]
            rel = media_path(item["src"], ARCHIVE_FOLDER)
            real = os.path.exists(os.path.join(ROOT, rel)) and media_size(rel)
            boxes.append((box, real or box))
        ratios = [w / h for _, (w, h) in boxes]
        wide, tall = self.map_layout(ratios, "wide", groups), self.map_layout(ratios, "tall", groups)

        def lines(lay):
            pins = lay["pins"]
            out = [f'<line x1="{a[0]}%" y1="{a[1]}%" x2="{b[0]}%" y2="{b[1]}%"/>'
                   for a, b in zip(pins, pins[1:])]
            out += [f'<rect x="{x}%" y="{y}%" width="5" height="5" '
                    f'transform="translate(-2.5 -2.5)"/>' for x, y, _ in pins]
            return "".join(out)

        pieces = []
        for n, item in enumerate(items):
            box, (w, h) = boxes[n]
            number, index = esc(item["id"]), f"{n + 1:02d}"
            rel = media_path(item["src"], ARCHIVE_FOLDER)
            alt, title = item.get("alt") or "", f"Archive {item['id']}"
            thumb = self.tile_image(rel, "archive", title, "eager" if n < 3 else "lazy",
                                    alt=alt, sizes=MAP_SIZES)
            if thumb:
                href, large = url_for(rel), ""
            else:
                href = url_for(placeholder_rel(rel))
                large = (f'          <template>'
                         f'{self.img(rel, alt, "archive", title, "eager", decorative=True, box=box)}'
                         f'</template>\n')
            date = inline(item.get("date") or "")
            meta = " · ".join(x for x in (date, archive_link(item, hidden=True)) if x)
            caption = inline(item.get("caption") or "") or f"Image {number}"
            (x, y, wd), (tx, ty, tw) = wide["pieces"][n], tall["pieces"][n]
            (px, py_, side), (tpx, tpy, tside) = wide["pins"][n], tall["pins"][n]
            when = f' <span class="map-when">{date}</span>' if date else ""
            pieces.append(
                f'        <li class="map-piece">\n'
                f'          <a class="map-fig" href="{href}" style="--r: {w} / {h}; --x: {x}%; '
                f'--y: {y}%; --w: {wd}%; --tx: {tx}%; --ty: {ty}%; --tw: {tw}%" data-item '
                f'aria-haspopup="dialog">\n'
                f'            <span class="archive-media">{thumb}</span>\n'
                f'            <span class="visually-hidden">Image {number}</span>\n'
                f'          </a>\n'
                f'          <span class="map-pin is-{side} is-t{tside}" style="--x: {px}%; '
                f'--y: {py_}%; --tx: {tpx}%; --ty: {tpy}%" aria-hidden="true">{index}{when}</span>\n'
                f'          <p class="visually-hidden"><span data-lightbox-name>{caption}</span> '
                f'<span data-lightbox-meta>{meta}</span></p>\n'
                f'{large}'
                f'        </li>')
        return ('    <div class="atlas">\n'
                f'      <div class="map" style="--ratio: {wide["ratio"]}; '
                f'--tall-ratio: {tall["ratio"]}">\n'
                '        <svg class="map-lines" aria-hidden="true" focusable="false">'
                f'<g class="is-wide">{lines(wide)}</g><g class="is-tall">{lines(tall)}</g>'
                '</svg>\n'
                '        <ol class="map-pieces">\n' + "\n".join(pieces) + '\n        </ol>\n'
                '      </div>\n'
                '    </div>\n')

    def build_archive(self):
        """Every image in content/archive.json, in the file's order, left to right and down, edge
        to edge (since 2026-11-13, after gougoucore.com's Lab), so main has no .wrap here. Each
        opens the lightbox."""
        s = self.site
        lightbox = render("lightbox.html") if self.archive else ""
        plan = (self.archive_grid() if ARCHIVE_GRID
                else self.archive_board() if ARCHIVE_MAP and ARCHIVE_MAP_GROUPS and ARCHIVE_MAP_BOARD
                else self.archive_map() if ARCHIVE_MAP
                else self.archive_sequence() if ARCHIVE_SEQUENCE
                else self.archive_binder() if ARCHIVE_BINDER
                else self.archive_plan() if ARCHIVE_PLAN else None)
        if plan is not None:
            text = (s.get("archive") or {}).get("statement")
            head = ""
            if text:  # in Work's sentence's style and place, sized to fill its two lines
                text = EMPHASIS_RE.sub(r"<em>\1</em>", inline(text))
                head = (f'    <div class="work-head wrap">\n'
                        f'      <p class="work-statement">{text}</p>\n    </div>\n')
            content = render("archive-plan.html", head=head, plan=plan, lightbox=lightbox)
        else:
            first = archive_first_screen(len(self.archive))
            tiles = "\n".join(self.archive_tile(item, ARCHIVE_BOXES[i % len(ARCHIVE_BOXES)],
                                                "eager" if i in first else "lazy")
                              for i, item in enumerate(self.archive))
            content = render("archive.html", tiles=tiles, lightbox=lightbox,
                             axes=self.axes("    "))
        self.page("archive/index.html", "archive", "/archive/", f"Archive — {s['name']}",
                  s["description"], content, "page-archive", current="archive",
                  image=self.og_image())

    def visit_link(self, p):
        """A project with its own site (meta.link) asks you in, in the body text under its
        statement: "Visit typelab.ink", with the new-tab arrow (since 2026-11-05). The only place
        it shows: until 2026-11-06 the metadata row listed it too, as "Link", and twice read as
        a repeat."""
        lk = (p.get("meta") or {}).get("link")
        if not (lk and lk.get("url")):
            return ""
        url, label = esc(lk["url"]), esc(lk.get("label") or lk["url"])
        return f'<p class="project-visit">{link(url, "Visit " + label, cls="text-link")}</p>'

    def build_project(self, p, prev_p, next_p):
        folder = f"assets/images/{p['slug']}"
        statement = p.get("statement")
        sheet = SHEET_PROJECTS is True or p["slug"] in (SHEET_PROJECTS or ())

        def no(q):  # a sheet's number, its Work number: " · 004" after Previous / Next
            return f" · {self.items.index(q) + 1:03d}" if sheet else ""

        self.sheet = f"{self.items.index(p) + 1:03d}" if sheet else None
        self.section_no = 0
        blocks = self.sections(p.get("blocks") or [], p, folder)
        meta = self.sheet_meta(p) if sheet else self.meta_rows(p)
        self.sheet = None
        content = render(
            "project.html",
            title=inline(p["title"]),
            meta=meta,
            statement=(f'<p class="project-statement">{inline(statement)}</p>'
                       if statement else ""),
            visit=self.visit_link(p),
            hero=("        " + self.block(p["hero"], p, folder, hero=True)) if p.get("hero") else "",
            blocks=blocks,
            prev_url=f"/work/{prev_p['slug']}/",
            prev_title=inline(prev_p["title"]),
            prev_no=no(prev_p),
            next_url=f"/work/{next_p['slug']}/",
            next_title=inline(next_p["title"]),
            next_no=no(next_p),
        )
        s = self.site
        self.page(f"work/{p['slug']}/index.html", p["slug"], f"/work/{p['slug']}/",
                  f"{p['title']} — {s['name']}",
                  f"{p['oneLiner']}. A project by {s['name']}, {s['role']}.",
                  content, "page-project is-sheet" if sheet else "page-project",
                  current="project", image=self.og_image(p))

    def about_statement(self, about):
        """About's text as one paragraph across the page, in the display style, as Work's
        sentence is (since 2026-11-13, after gougoucore.com/3/, whose About is one paragraph in
        capitals that opens with who she is in its display face): the first sentence
        ("headline") in the accent face, Kalnia, then the paragraphs running on after it in Inter
        Display. "headline" may be one string or a list of lines; the lines run on as one
        sentence, and it gets a full stop if it has none. Words in *asterisks* in the paragraphs
        are set in it too, as on Work. A headline with *asterisks* sets only those words in it,
        the rest in Inter Display (since 2026-11-14: the whole sentence in Kalnia ran heavy, two
        lines and more of it). No headline, and it starts with the paragraphs.
        (From 2026-11-12 the sentence and paragraphs sat apart, in the name style, beside an
        About label; from 2026-11-06 the sentence in the display style over the text; before
        that the sentence alone in the middle of the window.)"""
        lines = about.get("headline") or []
        if isinstance(lines, str):
            lines = [lines]
        if not isinstance(lines, list) or not all(isinstance(t, str) for t in lines):
            raise BuildError('content/site.json (about): "headline" should be a sentence, or a '
                             'list of its lines, like ["FIRST LINE", "SECOND LINE"].')
        headline = " ".join(t.strip() for t in lines if t.strip())
        if headline and headline[-1] not in ".!?":
            headline += "."
        if EMPHASIS_RE.search(headline):
            parts = [EMPHASIS_RE.sub(r"<em>\1</em>", inline(headline))]
        else:
            parts = [f"<em>{inline(headline)}</em>"] if headline else []
        parts += [EMPHASIS_RE.sub(r"<em>\1</em>", inline(t.strip()))
                  for t in about.get("paragraphs") or [] if t.strip()]
        if not parts:
            return ""
        return f'      <p class="about-statement">{" ".join(parts)}</p>'

    def about_qa(self, about):
        """About's Q&A, under the paragraph, in the row Experience had (since 2026-11-14, the
        user's ask: a few questions that make a visitor curious, the answers from the user's
        own account of themselves): "qa" in content/site.json's "about", a list of
        {"q": "A question?", "a": "Its answer."}, where "a" may be a list of lines (each its own
        paragraph). Each question opens its answer when clicked (<details>, so it works without
        JavaScript and from the keyboard), and closes the one that was open (since 2026-11-14,
        the user's ask: one answer at a time; the details share a name, so the browser does
        it). [label](/work/slug/) in an answer links a project. An item with "open": true
        starts open (since 2026-11-26, the user's go-ahead: with every answer shut, the section
        was six lines alike, the user's story behind clicks; the first, the architect they
        wanted to be, open since).
        No "qa", no row."""
        items = about.get("qa") or []
        if not isinstance(items, list) or not all(
                isinstance(i, dict) and isinstance(i.get("q"), str)
                and isinstance(i.get("a"), (str, list)) for i in items):
            raise BuildError('content/site.json (about): "qa" should be a list like '
                             '[{"q": "A question?", "a": "Its answer."}]; "a" may be a list of '
                             'lines.')
        rows = []
        for item in items:
            lines = item["a"] if isinstance(item["a"], list) else [item["a"]]
            answer = "".join(f"<p>{inline(t.strip())}</p>" for t in lines if t.strip())
            opened = " open" if item.get("open") is True else ""
            rows.append(
                f'        <details class="qa-item" name="qa"{opened}>\n'
                f'          <summary class="qa-q">{inline(item["q"].strip())}</summary>\n'
                f'          <div class="qa-a">{answer}</div>\n'
                '        </details>')
        if not rows:
            return ""
        deep = self.read_logo(FOOTER_LOGO, "qa-deep-logo") if QA_LOGO else None
        under = f'      <div class="qa-deep" aria-hidden="true">{deep}</div>\n' if deep else ""
        return (f'\n    <section class="about-list{" has-logo" if under else ""}" '
                'aria-labelledby="qa-heading">\n' + under +
                # Its label a detail callout since 2026-11-22 (the drawing system): Q over A.
                f'      <h2 id="qa-heading" class="about-label">{self.callout("Q", "A")}'
                '<span class="visually-hidden">Q&amp;A</span></h2>\n'
                '      <div class="qa">\n' + "\n".join(rows) + '\n      </div>\n'
                '    </section>\n')

    # About's scales as orbits (ABOUT_ORBITS, since 2026-11-23): the drawing's box, its middle,
    # the orbits' tilt, and for each scale, smallest first, its orbit's half-axes and where on it
    # its dot sits (degrees round the orbit from its right end, clockwise on screen). Spaced so
    # no two words meet, down to a 343px-wide drawing. A scale's "touches" sit along the top of
    # its orbit, from ORBIT_TOUCHES' first angle to its last, in order.
    ORBIT_BOX = (600, 370)
    ORBIT_MID = (300, 178)
    ORBIT_TILT = -9
    ORBIT_PATHS = ((78, 30, 212), (140, 55, 322), (204, 81, 148), (270, 108, 56))
    ORBIT_TOUCHES = (216, 334)

    def orbits(self, scales):
        """The scales as orbits round what they share (ABOUT_ORBITS, since 2026-11-23, the
        user's moodboard: an orbit diagram, a journal page's ellipses): one ellipse each, in
        1px lines, smallest in, tilted as an orbit seen at a slant; a dot on each, its axis
        bubble and name beside it (A OBJECT), a dotted line from the middle out to it; the
        middle a small circle and cross, and straight down from it, past the orbits,
        "center" from content/site.json's "scalesDrawing" (the user's own line: "How people
        actually live"), its "title" in the corner and its "legend" in the other: solid for the
        scales the user studied or worked in, dashed for one they only wanted.
        A scale with "unreached" (Space, architecture, the architect the user wanted to be as a
        kid: "I never became one.") is dashed, its dot open, those words beside it in the
        display face's italic, as a note in a journal; its "touches" ({"at", "what"}, in order)
        are where the user's life came near it anyway (the user's ask, 2026-11-23: show who
        they are, honestly): the first, where it began, an open mark, the rest a stretch of the
        orbit drawn solid, each with its words over it. Hovering a scale's cell in the list
        draws its orbit alone (style.css). For the eye only: the list beside it says the same
        in words."""
        if ABOUT_GLOBE:
            return self.globe(scales)
        drawing = self.site.get("scalesDrawing") or {}
        w, h = self.ORBIT_BOX
        mx, my = self.ORBIT_MID
        tilt = math.radians(self.ORBIT_TILT)
        if not scales or len(scales) > len(self.ORBIT_PATHS):
            return ""
        paths = self.ORBIT_PATHS[-len(scales):]

        def f(v):
            return f"{v:.1f}"

        def at(rx, ry, deg):
            a = math.radians(deg)
            x, y = rx * math.cos(a), ry * math.sin(a)
            return (mx + x * math.cos(tilt) - y * math.sin(tilt),
                    my + x * math.sin(tilt) + y * math.cos(tilt))

        def outward(rx, ry, deg):
            """The way out of the orbit at deg, as a unit step on screen."""
            a = math.radians(deg)
            nx, ny = math.cos(a) / rx, math.sin(a) / ry
            n = math.hypot(nx, ny)
            nx, ny = nx / n, ny / n
            return (nx * math.cos(tilt) - ny * math.sin(tilt),
                    nx * math.sin(tilt) + ny * math.cos(tilt))

        def pos(x, y):
            return f"left: {f(100 * x / w)}%; top: {f(100 * y / h)}%"

        shapes, words = [], []
        for i, (scale, (rx, ry, deg)) in enumerate(zip(scales, paths)):
            n = i + 1
            x, y = at(rx, ry, deg)
            unreached = scale.get("unreached")
            extra = []
            touches = scale.get("touches") or []
            lo, hi = self.ORBIT_TOUCHES
            for k, touch in enumerate(touches):
                need(touch, "at", f"content/site.json: scales[{i}].touches[{k}]")
                t = lo + (hi - lo) * k / max(len(touches) - 1, 1)
                tx, ty = at(rx, ry, t)
                if k == 0:
                    extra.append(f'<circle class="orbit-start" cx="{f(tx)}" cy="{f(ty)}" r="3.5"/>')
                else:
                    pts = [at(rx, ry, t + d) for d in range(-9, 10, 3)]
                    d = "M" + "L".join(f"{f(px)} {f(py)}" for px, py in pts)
                    extra.append(f'<path class="orbit-touch" d="{d}"/>')
                ox, oy = outward(rx, ry, t)
                side = ("is-top" if oy < -0.35 else "is-left" if ox < 0 else "is-right")
                what = (f'<span class="orbit-touch-what">{inline(touch["what"])}</span>'
                        if touch.get("what") else "")
                words.append(
                    f'<span class="orbit-touch-label {side}" data-orbit="{n}" '
                    f'style="{pos(tx + ox * 12, ty + oy * 12)}">'
                    f'<span class="orbit-touch-at">{inline(touch["at"])}</span>{what}</span>')
            shapes.append(
                f'<g class="orbit{" is-dashed" if unreached else ""}" data-orbit="{n}">'
                f'<ellipse cx="{mx}" cy="{my}" rx="{rx}" ry="{ry}" '
                f'transform="rotate({self.ORBIT_TILT} {mx} {my})"/>'
                f'<path class="orbit-ray" d="M{mx} {my}L{f(x)} {f(y)}"/>'
                f'{"".join(extra)}'
                f'<circle class="orbit-dot" cx="{f(x)}" cy="{f(y)}" r="4"/></g>')
            side = "is-left" if x < mx else "is-right"
            words.append(
                f'<span class="orbit-label {side}" data-orbit="{n}" style="{pos(x, y)}">'
                f'<span class="bubble">{AXIS_LETTERS[i]}</span>'
                f'<span class="orbit-name">{inline(scale["name"])}</span></span>')
            if unreached:
                words.append(f'<span class="orbit-note {side}" data-orbit="{n}" '
                             f'style="{pos(x, y)}">{inline(unreached)}</span>')
        foot = my + self.ORBIT_PATHS[-1][1] + 34
        middle = (f'<g class="orbit-middle"><circle cx="{mx}" cy="{my}" r="7"/>'
                  f'<path d="M{mx - 12} {my}h24M{mx} {my - 12}v24"/>'
                  f'<path class="orbit-ray" d="M{mx} {my + 12}V{f(foot)}"/></g>')
        title, key, center = self.orbits_words(scales, h, foot)
        return ('      <div class="orbits" aria-hidden="true">\n'
                f'{title}{key}'
                f'        <div class="orbits-figure" style="aspect-ratio: {w} / {h}">'
                f'<svg viewBox="0 0 {w} {h}" focusable="false">{"".join(shapes)}{middle}</svg>'
                f'{"".join(words)}{center}</div>\n'
                '      </div>\n')

    def orbits_words(self, scales, h, foot):
        """The orbits' drawing's title, its legend, and the words under its middle, from
        content/site.json's "scalesDrawing" (see orbits); foot is where the line down from the
        middle ends, in a drawing h high."""
        drawing = self.site.get("scalesDrawing") or {}
        center = (f'<span class="orbit-center" style="top: {100 * (foot + 8) / h:.1f}%">'
                  f'{inline(drawing["center"])}</span>') if drawing.get("center") else ""
        title = (f'        <span class="orbits-title">{inline(drawing["title"])}</span>\n'
                 if drawing.get("title") else "")
        legend = drawing.get("legend") or []
        key = ""
        if len(legend) == 2 and any(s.get("unreached") for s in scales):
            key = ('        <span class="orbits-legend">'
                   f'<span class="is-solid">{inline(legend[0])}</span>'
                   f'<span class="is-dashed">{inline(legend[1])}</span></span>\n')
        return title, key, center

    # About's scales as a globe that turns (ABOUT_GLOBE, since 2026-11-24): the drawing's box and
    # the globe's middle and radius in it. Where each orbit lies in 3D, where each thing sits on
    # it, and how the globe turns are in assets/js/globe.js, which draws them; it has room for
    # four orbits.
    # Bigger since 2026-11-25 (the user's ask): the globe 500 of the box's 640 across, where
    # it was 420 of 680.
    GLOBE_BOX = (640, 610)
    GLOBE_MID = (320, 284)
    GLOBE_R = 250

    def globe(self, scales):
        """The user as a designer, drawn as a globe that turns (ABOUT_GLOBE, since 2026-11-24,
        the user's ask, from an orbit diagram turning in 3D on their Pinterest; then, the same
        day: the drawing and its words one picture, simple, showing who they are as a designer
        rather than where they studied or worked): under it what their work is about ("How
        people actually live", "scalesDrawing" in content/site.json), and round its middle the
        scales they design at, an orbit each, smallest in, its dot with its name (OBJECT) in
        the label style, no bubble or box (the user's ask, the same day, after the example: easy
        to read and tidy), a dotted line out to it from the middle. Space, what they wanted to be as a
        kid, round the globe itself, its dot open (dashed until 2026-11-25, when the user asked
        for the example's shape: its great circles black lines). Object and Page lie on the
        globe's equator, Screen and Space tilt across it opposite ways (since 2026-11-25 each
        along a diagonal, as the example's two; globe.js says how). On it besides, the user's work
        going across the scales, a way each (globe_ways, since 2026-11-24 night: the drawing
        showed a taxonomy, not the user; their work going across the scales shows that they
        connect fields; and all of it heading one way, the user's ask the same night): Light
        Life from Object's dot to Screen's, the Clayco rebrand from Page's to Space's, each an
        arrow and its name, and, dashed, where they're going, Next, from Screen's to Space's.
        Since 2026-11-25 (the user's ask: those words didn't say who they are) the same drawing
        in the user's seven words: LIVING by the middle, OBJECT, BRANDING (Page's "aboutName"),
        DIGITAL (Screen's), SPACE, and the ways EXPERIENCE (Light Life) and AI (Clayco), each by
        its "word"; the way ahead unnamed. Nothing else: all the work, the places
        and the touches were on it for a few hours the same day, and made it hard to read.
        Over it, as a drawing's title, who it is: the user's name and role.
        Beside it (under it on narrow screens) its key (globe_key), what it means: the fields
        they come from, how they've connected them, and where they're going, each by the
        part of the drawing that draws it (the user's asks, the same day: the picture was good
        but said nothing; a visitor comes to About to learn who they are; then, that night,
        to feel their range, that they connect fields, and that they use AI in the process). A part of the key under the pointer, or clicked, lights its part of the
        drawing, and a name on the globe its line in the key (globe.js).
        Written here: the still parts (the globe's rim with a tick at each quarter, dotted
        axes through the middle, the middle's circle and cross, the line down to its words),
        each orbit's parts, empty, the names, and the key. assets/js/globe.js places and turns
        it all.
        The drawing is drawn only with JavaScript (style.css); the key is words, and is what
        shows without it."""
        w, h = self.GLOBE_BOX
        mx, my = self.GLOBE_MID
        r = self.GLOBE_R
        if not scales or len(scales) > 4:
            return ""
        backs, fronts, words = [], [], []
        for i, scale in enumerate(scales):
            n = i + 1
            unreached = scale.get("unreached")
            dashed = " is-dashed" if unreached else ""
            backs.append(f'<g class="orbit{dashed}" data-orbit="{n}">'
                         '<path class="orbit-line is-back"/></g>')
            fronts.append(f'<g class="orbit{dashed}" data-orbit="{n}"><path class="orbit-line"/>'
                          '<path class="orbit-ray"/><circle class="orbit-dot" r="5.5"/></g>')
            # On the globe the name alone, in the label style, as the example's are (the
            # user's ask, the same day: easy to read and tidy).
            words.append(f'<span class="orbit-label{dashed}" data-orbit="{n}">'
                         f'{inline(self.about_name(scale))}</span>')
        # Each work's way from one scale to another (globe_ways): its far part under the
        # globe's lines with the orbits' far halves, its near part over the orbits, with its
        # head and a dot for each year between, and its name in the label style. data-way is
        # its number, data-from and data-to its scales' orbits, data-stops where its years
        # fall along it.
        for way in self.globe_ways(scales):
            k = way["n"]
            nxt = " is-next" if way["next"] else ""  # where they're going: dashed
            times = " ".join(f"{t:.3f}" for t in way["times"])
            backs.append(f'<g class="globe-path{nxt}" data-way="{k}">'
                         '<path class="globe-path-line is-back"/></g>')
            stops = "".join('<circle class="globe-path-stop" r="2.5"/>' for _ in way["times"])
            fronts.append(f'<g class="globe-path{nxt}" data-way="{k}" data-from="{way["from"]}" '
                          f'data-to="{way["to"]}" data-stops="{times}">'
                          '<path class="globe-path-line"/>'
                          f'<path class="globe-path-head"/>{stops}</g>')
            if way["label"]:  # the way ahead has none since 2026-11-25 (was NEXT)
                words.append(f'<span class="orbit-label globe-path-label{nxt}" data-way="{k}" '
                             f'data-lit="{way["lit"]}">{inline(way["label"])}</span>')
        # What all of it goes round, by the middle ("middle" under "scalesDrawing": Living,
        # since 2026-11-25, the user's word), over and right of its cross; it lights the fields'
        # point of view (globe_key's "view").
        drawing = self.site.get("scalesDrawing") or {}
        if drawing.get("middle"):
            words.append(f'<span class="orbit-label is-middle" data-lit="view" '
                         f'style="left: {100 * mx / w:.2f}%; top: {100 * my / h:.2f}%">'
                         f'{inline(drawing["middle"])}</span>')
        foot = my + r + 30
        out = 24  # how far the axes run past the rim
        # The middle's circle and cross as the diagram's (since 2026-11-25, the user's ask: its
        # shape): the circle 0.036 of the globe across, the cross's arms 0.107 out to the sides
        # and 0.13 up and down, as far as the outer ring's far and near sides (7, 12 and 12
        # before).
        dot, arm, stem = round(r * 0.036), round(r * 0.107), round(r * 0.13)
        rim = (f'<circle class="globe-rim" cx="{mx}" cy="{my}" r="{r}"/>'
               f'<path class="globe-rim" d="M{mx} {my - r - 7}v14M{mx} {my + r - 7}v14'
               f'M{mx - r - 7} {my}h14M{mx + r - 7} {my}h14"/>'
               f'<path class="globe-axis" d="M{mx - r - out} {my}H{mx + r + out}'
               f'M{mx} {my - r - out}V{my - stem}"/>')
        middle = (f'<g class="orbit-middle"><circle cx="{mx}" cy="{my}" r="{dot}"/>'
                  f'<path d="M{mx - arm} {my}h{2 * arm}M{mx} {my - stem}v{2 * stem}"/>'
                  f'<path class="orbit-ray" d="M{mx} {my + stem}V{foot}"/></g>')
        _, _, center = self.orbits_words(scales, h, foot)  # no legend: the key says it
        site = self.site
        who = ", ".join(inline(site[k]) for k in ("name", "role") if site.get(k))
        title = f'        <h2 id="scales-heading" class="orbits-title">{who}</h2>\n'
        scrolly = " is-scrolly" if GLOBE_SCROLL else ""
        return (f'      <div class="orbits is-globe{scrolly}">\n'
                f'{title}'
                f'        <div class="orbits-figure is-globe" '
                f'style="aspect-ratio: {w} / {h}; --globe-w: {w}; --globe-h: {h}" '
                f'data-globe="{mx} {my} {r}" aria-hidden="true">'
                f'<svg viewBox="0 0 {w} {h}" focusable="false">'
                f'<g class="globe-back">{"".join(backs)}</g>'
                '<path class="globe-lines"/>'
                f'{rim}<g class="globe-front">{"".join(fronts)}</g>{middle}</svg>'
                f'{"".join(words)}{center}</div>\n'
                f'{self.globe_key(scales)}'
                '      </div>\n')

    def globe_ways(self, scales):
        """The user's work going across the scales, drawn on the globe, a way each (since
        2026-11-24 night: Light Life alone first, the user's go-ahead after a look at why
        About didn't show who they are, the globe drawing a taxonomy and the proof of
        "different scales, same subject" hidden in the Q&A; then, the user's ask the same
        night, for a visitor to feel that they connect fields: the Clayco rebrand too; then,
        the user's ask the same night, the many fields not scattered and where they're going
        clear: every way heads for Space, the dashed orbit, and the way ahead, dashed, from
        Screen to Space: digital meeting real spaces). Since 2026-11-25 each is named by the
        user's word for it (EXPERIENCE, Object to Digital; AI, Branding to Space; the way
        ahead, Digital to Space, unnamed; it was NEXT, and the first two LIGHT LIFE and
        CLAYCO). From "ways" under "scalesDrawing" in content/site.json, each with its
        "word", the scale it begins at ("from") and the one it goes to ("to"), by either of
        its names (Page or Branding), "next" on the way ahead, and, if it's to show its years
        on the way, "stops" (each "at" and "what"). One whose scales aren't on the globe is
        left out. A list of {"n": its number, from 1, "from", "to": its orbits' numbers,
        "times": where each stop between the first and last falls along it, 0 to 1, by its
        year, "label", "lit": what it lights (globe.js, data-focus: "w" and its number, and
        its two orbits), "item": its entry, "next": whether it's the way ahead}."""
        by_name = {}
        for i, sc in enumerate(scales):
            for name in (sc["name"], self.about_name(sc)):
                by_name[str(name).lower()] = i + 1
        ways = []
        for item in (self.site.get("scalesDrawing") or {}).get("ways") or []:
            ends = [by_name.get(str(item.get(k) or "").lower()) for k in ("from", "to")]
            if None in ends or ends[0] == ends[1]:
                continue
            a, b = ends
            stops = item.get("stops") or []
            years = []
            for stop in stops:
                m = re.search(r"\d{4}", str(stop.get("at") or ""))
                years.append(int(m.group()) if m else None)
            if len(stops) > 2 and None not in years and years[-1] > years[0]:
                times = [(y - years[0]) / (years[-1] - years[0]) for y in years[1:-1]]
            else:
                times = [i / (len(stops) - 1) for i in range(1, len(stops) - 1)]
            n = len(ways) + 1
            ways.append({"n": n, "from": a, "to": b, "times": times,
                         "label": item.get("word") or "", "lit": f"w{n} {a} {b}",
                         "item": item, "next": bool(item.get("next"))})
        return ways

    def globe_key(self, scales):
        """What the globe means, beside it (under it on narrow screens): each of its words
        said in plain words, in four groups, each headed by the question a visitor comes with
        (since 2026-11-25, the user's ask: the key, Fields, Connecting fields and Direction,
        each by a mark drawn as its part of the drawing is, was hard to understand: two sets
        of words to match up (BRANDING, Graphic design), a legend's labels to decode, a word,
        a line and a gray line to put together, and LIVING not in it at all). From "key"
        under "scalesDrawing" in content/site.json, a list of groups, each its "label" (At the
        center until the user's ask the same day, then How I see the world; What I
        design, How I connect them, Where I'm going), in the display face as
        typed, then its "rows": a line a word ("word", as on the globe, in the label style),
        the user's own line for it ("text", from their Q&A and paragraph), and, quieter, the
        work that shows it ("works": names, each a link to its page if it's a project with one:
        Light Life, TypeLab, Clack, NBCUniversal; Clayco has none) or a line of its own
        ("under"), after the line in the page, at the word's right in the box (style.css; since
        2026-11-25 evening, the user's ask: the key ruled as a shop's spec box, as Work's cards
        are; under the line before). Since later that evening (GLOBE_KEY_PROSE, the user's ask:
        cleaner, without the boxes) a group's lines are one paragraph, a sentence each, with
        no word or works beside them; a work named in a line can be a link in its text. (Space's line was "Architecture, what I wanted to be as a kid.
        I never became one." until the user's ask the same day; now where they're going.)
        data-lit names the parts of the drawing each lights (globe.js): the word's own part
        (the middle's word, "view"; a scale, its orbit's number; a way, "w", its number and
        its two orbits), and, on a line with "next", the way ahead too; a group lights all its
        lines'. A word not on the globe lights nothing. No "key", no key."""
        drawing = self.site.get("scalesDrawing") or {}
        groups = drawing.get("key") or []
        if not isinstance(groups, list) or not groups:
            return ""
        ways = self.globe_ways(scales)
        lits = {}
        if drawing.get("middle"):
            lits[str(drawing["middle"]).lower()] = ["view"]
        for i, sc in enumerate(scales):
            for name in (sc["name"], self.about_name(sc)):
                lits[str(name).lower()] = [str(i + 1)]
        for way in ways:
            if way["label"]:
                lits[str(way["label"]).lower()] = way["lit"].split()
        ahead = next((way for way in ways if way["next"]), None)
        pages = {str(p.get("title") or "").lower(): f"/work/{p['slug']}/" for p in self.projects}

        def work(name):
            href = pages.get(str(name).lower())
            return f'<a href="{esc(href)}">{inline(name)}</a>' if href else inline(name)

        parts = []
        for g, group in enumerate(groups):
            rows, group_lit = [], []
            for r, entry in enumerate(group.get("rows") or []):
                need(entry, "word", f"content/site.json: scalesDrawing.key[{g}].rows[{r}]")
                word = str(entry["word"])
                lit = list(lits.get(word.lower(), []))
                if entry.get("next") and ahead:
                    lit += ahead["lit"].split()
                lit = list(dict.fromkeys(lit))
                group_lit += lit
                at = f' data-lit="{" ".join(lit)}"' if lit else ""
                text = inline(entry.get("text") or "")
                if GLOBE_KEY_PROSE:
                    # A line a sentence in its group's paragraph, lighting its word's part; its
                    # first word held to the next, so no "I" is left alone at a line's end.
                    text = re.sub(r"^(\S{1,2}) ", "\\1&nbsp;", text)
                    rows.append(f'<span class="globe-key-line"{at}>{text}</span>')
                    continue
                below = " \u00b7 ".join(work(w) for w in entry.get("works") or [])
                if entry.get("under"):
                    below = inline(entry["under"])
                below = f'<span class="globe-key-under">{below}</span>' if below else ""
                rows.append(f'<li class="globe-key-line"{at}>'
                            f'<span class="globe-key-tag">{inline(word)}</span>'
                            f'<span class="globe-key-row">{text}</span>{below}</li>')
            group_lit = list(dict.fromkeys(group_lit))
            at = f' data-lit="{" ".join(group_lit)}"' if group_lit else ""
            label = (f'<h3 class="globe-key-label">{inline(group["label"])}</h3>'
                     if group.get("label") else "")
            body = (f'<p class="globe-key-text">{" ".join(rows)}</p>' if GLOBE_KEY_PROSE
                    else f'<ul class="globe-key-rows">{"".join(rows)}</ul>')
            parts.append(f'          <div class="globe-key-part"{at}>{label}{body}</div>\n')
        kind = "is-prose" if GLOBE_KEY_PROSE else "is-box"
        return (f'        <div class="globe-key {kind}">\n' + "".join(parts)
                + '        </div>\n')

    def about_scales(self):
        """About's scales (ABOUT_SCALES, since 2026-11-22): site.json's "scales" as a title
        block under the paragraph, a cell each in the window-wide lines: its axis bubble and name
        (A Object, as over Archive's columns), the field it comes from ("field", the paragraph's
        Industrial, Graphic, and UX, and the architecture the user wanted as a kid), a line of
        their own account ("note", from the Q&A), and, when Archive is a plan and has images of
        that scale, a link to its column, "Archive (2)". None, no block."""
        scales = self.scales() if ABOUT_SCALES else []
        if not scales:
            return ""
        globe = ABOUT_ORBITS and ABOUT_GLOBE
        cells = []
        for c, scale in enumerate(scales):
            count = sum(1 for it in self.archive
                        if (it.get("scale") or "").lower() == scale["name"].lower())
            more = ""
            if ARCHIVE_PLAN and not ARCHIVE_MAP and count:  # the map has no columns
                more = (f'\n          <a class="scale-link" href="/archive/#{self.scale_id(scale)}">'
                        f'Archive ({count})</a>')
            field = (f'\n          <h3 class="scale-field">{inline(scale["field"])}</h3>'
                     if scale.get("field") else "")
            note = (f'\n          <p class="scale-note">{inline(scale["note"])}</p>'
                    if scale.get("note") else "")
            cells.append(
                f'        <li class="scale" data-orbit="{c + 1}">\n'
                f'          <p class="scale-name"><span class="bubble" aria-hidden="true">'
                f'{AXIS_LETTERS[c]}</span>{inline(scale["name"])}</p>{field}{note}{more}\n'
                '        </li>')
        drawing = self.orbits(scales) if ABOUT_ORBITS else ""
        kind = " has-orbits has-globe" if globe and drawing else " has-orbits" if drawing else ""
        if globe and drawing:
            # The globe's title is the heading, and its key says in words what the cells did
            # (globe_key), so there are no cells.
            return (f'    <section class="scales{kind}" aria-labelledby="scales-heading">\n'
                    f'{drawing}    </section>\n')
        return (f'    <section class="scales{kind}" '
                'aria-labelledby="scales-heading">\n'
                '      <h2 id="scales-heading" class="visually-hidden">Scales</h2>\n'
                f'{drawing}'
                f'      <ol class="scales-list" style="--cols: {len(scales)}">\n'
                + "\n".join(cells) + '\n      </ol>\n    </section>\n')

    # About's identity sheet (ABOUT_IDENTITY, since 2026-11-25) ------------------------------

    # The colors on the sheet, in order: the name each goes by, and its token in style.css,
    # whose value the sheet prints (read from there, so it says what the site uses).
    BRAND_COLORS = (("Paper", "--color-bg"), ("Ink", "--color-text"), ("Gray", "--color-subtle"),
                    ("Tracing paper", "--vellum"), ("Construction line", "--color-trace"))
    # The faces, as Type in style.css has them: the name, its cuts, what it sets, its family
    # (a class: is-display, is-text, is-mono).
    BRAND_FACES = (("Source Serif 4 Display", "300, italic", "Titles and sentences", "display"),
                   ("Source Serif 4 Text", "400, 500", "What's read", "text"),
                   ("IBM Plex Mono", "400", "What names, numbers, and leads somewhere", "mono"))
    # How wide a print of the website shows on the sheet.
    BRAND_PRINT_SIZES = "(min-width: 1200px) 36vw, (min-width: 768px) 60vw, 100vw"

    def css_tokens(self):
        """style.css's first :root block as {token: value}, read once."""
        if getattr(self, "_css_tokens", None) is None:
            with open(os.path.join(ASSET_DIR, "css", "style.css"), encoding="utf-8") as f:
                css = re.sub(r"/\*.*?\*/", "", f.read(), flags=re.S)
            root = re.search(r":root\s*\{(.*?)\n\}", css, re.S)
            self._css_tokens = {k: " ".join(v.split()) for k, v in
                                re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", root.group(1) if root else "")}
        return self._css_tokens

    def brand_color(self, token):
        """A color token's value as the sheet prints it: a hex in capitals, or a see-through
        one as what it is at how much ("Paper at 72%"), the tracing paper with its blur."""
        t = self.css_tokens()
        value = t.get(token, "")
        if re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            return value.upper()
        m = re.fullmatch(r"rgb\((\d+) (\d+) (\d+) / ([\d.]+)\)", value)
        if not m:
            return value
        hexed = "#{:02X}{:02X}{:02X}".format(*(int(v) for v in m.groups()[:3]))
        named = {t.get("--color-bg", "").upper(): "Paper", t.get("--color-text", "").upper(): "Ink"}
        said = f"{named.get(hexed, hexed)} at {round(float(m.group(4)) * 100)}%"
        if token == "--vellum" and t.get("--vellum-blur"):
            said += f", blur {t['--vellum-blur']}"
        return said

    def brand_logo(self):
        """The logo drawn as a part on a drawing (about_identity): assets/logo/logo.svg, the
        footer's cut, in ink over its construction in construction lines (the center line
        through both suns and one down each, each sun's rim and hollow, and hatched, the lens
        where their rims cross), called out as logo_key calls it out (DIGITAL, EVERYDAY LIFE,
        WHERE THEY MEET) and measured (the suns' middles apart, the rim's radius, the hollow's),
        in the logo's own units. The words are HTML over the drawing, placed in percent of it,
        so they stay 12px at any size. Assumes the logo as assets/logo has it since 2026-11-15:
        two suns side by side, each 100 to its rays' tips, its hollow 50."""
        parts = self.logo_parts(FOOTER_LOGO)
        if parts is None:
            return ""
        (x0, y0, w, h), shapes = parts
        k = h / 208                      # the logo's units as drawn (208 tall)
        rim, hollow = 100 * k, 50 * k
        cy = y0 + h / 2
        lx, rx = x0 + h / 2, x0 + w - h / 2
        mx = (lx + rx) / 2
        lens = math.sqrt(max(rim * rim - (mx - lx) ** 2, 0))  # half the lens, up and down
        bx, by, bw, bh = x0 - 64 * k, y0 - 104 * k, w + 128 * k, h + 196 * k
        edge_l, edge_r = bx + 8 * k, bx + bw - 8 * k
        dim_y = y0 - 30 * k              # the dimension over the suns
        shoulder = y0 - 78 * k           # the key's words' line
        lean = (cy - shoulder) * math.tan(math.radians(25))
        foot = y0 + h + 58 * k
        diag = math.cos(math.radians(45))
        turn = (rim + 26 * k) * diag     # where the radii's leaders turn level, across and down
        low = cy + turn

        def f(v):
            return f"{v:.1f}"

        def tag(x, y, text, at):
            return (f'<span class="brand-tag" data-at="{at}" style="left: {(x - bx) / bw * 100:.2f}%; '
                    f'top: {(y - by) / bh * 100:.2f}%">{text}</span>')

        def units(v):
            return f"{v / k:g}"

        construction = (
            f'<path class="brand-centerline" d="M{f(edge_l)} {f(cy)}H{f(edge_r)}'
            f'M{f(lx)} {f(dim_y - 12 * k)}V{f(y0 + h + 16 * k)}'
            f'M{f(rx)} {f(dim_y - 12 * k)}V{f(y0 + h + 16 * k)}"/>'
            + "".join(f'<circle cx="{f(x)}" cy="{f(cy)}" r="{f(r)}"/>'
                      for x in (lx, rx) for r in (rim, hollow)))
        lens_d = (f'M{f(mx)} {f(cy - lens)}A{f(rim)} {f(rim)} 0 0 1 {f(mx)} {f(cy + lens)}'
                  f'A{f(rim)} {f(rim)} 0 0 1 {f(mx)} {f(cy - lens)}Z')
        s = 4 * k                        # a slash's reach, at each end of the dimension
        ink = (f'M{f(lx)} {f(dim_y)}H{f(rx)}'
               f'M{f(lx - s)} {f(dim_y + s)}L{f(lx + s)} {f(dim_y - s)}'
               f'M{f(rx - s)} {f(dim_y + s)}L{f(rx + s)} {f(dim_y - s)}'
               f'M{f(lx)} {f(cy)}L{f(lx - lean)} {f(shoulder)}H{f(edge_l)}'
               f'M{f(rx)} {f(cy)}L{f(rx + lean)} {f(shoulder)}H{f(edge_r)}'
               f'M{f(mx)} {f(cy)}V{f(foot)}'
               f'M{f(rx)} {f(cy)}L{f(rx + turn)} {f(low)}H{f(edge_r)}'
               f'M{f(lx)} {f(cy)}L{f(lx - turn)} {f(low)}H{f(edge_l)}')
        dots = "".join(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r * k)}"/>' for x, y, r in (
            (lx, cy, 4), (rx, cy, 4), (mx, cy, 4),
            (rx + rim * diag, cy + rim * diag, 2.5), (lx - hollow * diag, cy + hollow * diag, 2.5)))
        svg = (f'<svg viewBox="{f(bx)} {f(by)} {f(bw)} {f(bh)}" aria-hidden="true" focusable="false">'
               '<defs><pattern id="brand-hatch" width="5" height="5" patternUnits="userSpaceOnUse" '
               'patternTransform="rotate(45)"><path d="M0 0V5"/></pattern></defs>'
               f'<g class="brand-construction">{construction}</g>'
               f'<path class="brand-lens" d="{lens_d}"/>'
               f'{shapes}'
               f'<path class="brand-lines" d="{ink}"/>'
               f'<g class="brand-dots">{dots}</g></svg>')
        tags = "".join((
            tag(mx, dim_y - 7 * k, units(rx - lx), "bc"),
            tag(edge_l, shoulder - 7 * k, "Digital", "bl"),
            tag(edge_r, shoulder - 7 * k, "Everyday life", "br"),
            tag(mx, foot + 7 * k, "Where they meet", "tc"),
            tag(edge_r, low - 7 * k, f"R {units(rim)}", "br"),
            tag(edge_l, low - 7 * k, f"R {units(hollow)}", "bl")))
        return (f'        <div class="brand-drawing" style="aspect-ratio: {f(bw)} / {f(bh)}">'
                f'{svg}{tags}</div>\n')

    @staticmethod
    def brand_ring(words, d=176):
        """Words round a ring, twice, a dot after each, with an X across its middle (the user's
        moodboard poster's ringed seal), d px across, its words 11px (style.css)."""
        c = d / 2
        r = c - 12                       # the words' line; they stand outside it
        text = esc(" · ".join([words.upper()] * 2) + " · ")
        x = (r - 6) * math.cos(math.radians(45))
        return (f'<svg class="brand-ring" viewBox="0 0 {d} {d}" width="{d}" height="{d}" '
                'aria-hidden="true" focusable="false">'
                f'<path id="brand-ring-line" d="M{c - r:.1f} {c}a{r:.1f} {r:.1f} 0 1 1 {2 * r:.1f} 0'
                f'a{r:.1f} {r:.1f} 0 1 1 {-2 * r:.1f} 0" fill="none"/>'
                f'<circle cx="{c}" cy="{c}" r="{r - 6:.1f}"/>'
                f'<path d="M{c - x:.1f} {c - x:.1f}L{c + x:.1f} {c + x:.1f}'
                f'M{c + x:.1f} {c - x:.1f}L{c - x:.1f} {c + x:.1f}"/>'
                f'<text><textPath href="#brand-ring-line" textLength="{2 * math.pi * r:.1f}" '
                f'lengthAdjust="spacing">{text}</textPath></text></svg>')

    def brand_prints(self, pages):
        """The website's pages as prints on the sheet, each a link to its page, its name and
        address over it, the parts its "traces" name boxed on it in ink and numbered ([1]), and
        those listed under it by number, name, and note."""
        prints = []
        n = 0
        for i, page in enumerate(pages):
            where = f"content/site.json: identity.pages[{i}]"
            name, href = need(page, "name", where), need(page, "href", where)
            rel = media_path(need(page, "src", where), "assets/images/about")
            img = self.img(rel, "", "wide", name, decorative=True, sizes=self.BRAND_PRINT_SIZES)
            traces, legend = [], []
            for t in page.get("traces") or []:
                n += 1
                box = t.get("box")
                if not (isinstance(box, list) and len(box) == 4
                        and all(isinstance(v, (int, float)) for v in box)):
                    raise BuildError(f'{where}: a trace\'s "box" should be [left, top, width, '
                                     'height], in percent of the print, like [0, 0, 100, 6.4].')
                x, y, w, h = box
                traces.append(f'<span class="brand-trace" style="left: {x:g}%; top: {y:g}%; '
                              f'width: {w:g}%; height: {h:g}%"><span class="brand-trace-no">'
                              f'[{n}]</span></span>')
                note = (f' <span class="brand-legend-note">{inline(t["note"])}</span>'
                        if t.get("note") else "")
                legend.append(f'<li><span class="brand-legend-no">[{n}]</span> '
                              f'{inline(need(t, "name", where))}{note}</li>')
            legend = f'<ol class="brand-legend">{"".join(legend)}</ol>' if legend else ""
            prints.append(
                f'          <li class="brand-print is-{i + 1}"><a href="{esc(href)}">'
                f'<span class="brand-print-name">{inline(name)} '
                f'<span class="brand-print-path">{esc(href)}</span></span>'
                f'<span class="brand-print-sheet">{img}'
                f'<span class="brand-print-traces" aria-hidden="true">{"".join(traces)}</span>'
                f'</span></a>{legend}</li>')
        return '        <ul class="brand-prints">\n' + "\n".join(prints) + '\n        </ul>\n'

    def about_identity(self):
        """The site's identity on one sheet (ABOUT_IDENTITY, since 2026-11-25 night, the user's
        ask: their logo, website, and identity, on tracing paper as a poster on their moodboard
        is: a collage printed under the sheet, construction lines and registration marks over
        it in ink, numbered parts in a mono, big type), after the Q&A. Under the sheet, as a
        print seen through it, the logo, huge and soft. Over it, a strip (the sheet's title,
        "Identity", what's on it, and its number: sheet 000, the set's cover, of as many as
        Work has), then five parts, each headed by a detail callout (its number over the
        sheet's, as a project's sections are): 01 the logo drawn with its construction, key,
        and measures (brand_logo); 02 the website, its "pages" as prints that link to them,
        the ink tracing their parts (brand_prints); 03 the type, the name set big in the
        display face, the three faces each in itself, and beside them a ring of site.json's
        "identity" "ring" words in the mono (brand_ring); 04 the paper and ink, each color's swatch,
        name, and value (from style.css); 05 the drawing's parts, each drawn as the site draws
        it, and the "drawing" note. Its lines are construction lines with a + where they
        cross, as Work's grid's are. No "identity", no sheet."""
        ident = self.site.get("identity") if ABOUT_IDENTITY else None
        if not ident:
            return ""
        pages = ident.get("pages") or []
        if not isinstance(pages, list):
            raise BuildError('content/site.json (identity): "pages" should be a list like '
                             '[{"src": "site-work.jpg", "name": "Work", "href": "/"}].')
        sheet = "000"

        def cell(cls, no, label, body):
            return (f'      <div class="brand-cell brand-{cls}">\n'
                    f'        <h3 class="brand-label">{self.callout(f"{no:02d}", sheet)}'
                    f'<span>{label}</span></h3>\n{body}      </div>\n')

        def note(text):
            return f'        <p class="brand-note">{inline(text)}</p>\n' if text else ""

        ring = self.brand_ring(ident["ring"]) if ident.get("ring") else ""
        logo = self.brand_logo()
        logo_cell = cell("logo", 1, "Logo", logo + note(ident.get("logoNote")))
        site_cell = cell("site", 2, "Website", self.brand_prints(pages)) if pages else ""

        first, _, rest = self.site["name"].partition(" ")
        faces = "\n".join(
            f'          <div class="brand-face is-{cls}"><dt>{esc(name)}</dt>'
            f'<dd>{esc(cuts)} · {esc(use)}</dd></div>'
            for name, cuts, use, cls in self.BRAND_FACES)
        type_cell = cell("type", 3, "Type", (
            f'        <p class="brand-specimen" aria-hidden="true"><em>{esc(first)}</em>'
            f'{" " + esc(rest) if rest else ""}</p>\n'
            f'        <dl class="brand-faces">\n{faces}\n        </dl>\n'
            '        <p class="brand-alphabet" aria-hidden="true">'
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz 0123456789</p>\n'
            + (f'        {ring}\n' if ring else "")))

        colors = "\n".join(
            f'          <li class="brand-color"><span class="brand-chip is-{token[2:]}" '
            f'aria-hidden="true"></span><span class="brand-color-name">{esc(name)}</span>'
            f'<span class="brand-color-value">{esc(self.brand_color(token))}</span></li>'
            for name, token in self.BRAND_COLORS)
        color_cell = cell("paper", 4, "Paper and ink",
                          f'        <ul class="brand-colors">\n{colors}\n        </ul>\n')

        drawn = (
            ("Registration mark", '<span class="brand-part-mark"></span>'),
            ("Axis bubble", '<span class="bubble">A</span>'),
            ("Detail callout", self.callout("01", sheet)),
            ("Dimension line", '<svg viewBox="0 0 96 24" width="96" height="24"><path '
                               'd="M4 12H92M4 4V20M92 4V20M0 16L8 8M88 16L96 8"/></svg>'),
            ("Orbit", '<svg viewBox="0 0 96 40" width="96" height="40"><ellipse cx="48" cy="20" '
                      'rx="45" ry="14" transform="rotate(-9 48 20)"/><circle class="is-dot" '
                      'cx="90" cy="12.5" r="3"/><circle cx="48" cy="20" r="4"/></svg>'),
            ("Binder holes", '<span class="brand-part-holes"></span>'))
        parts = "\n".join(
            f'          <li class="brand-part"><span class="brand-part-art" aria-hidden="true">'
            f'{art}</span><span class="brand-part-name">{name}</span></li>' for name, art in drawn)
        parts_cell = cell("parts", 5, "Drawing",
                          f'        <ul class="brand-part-list">\n{parts}\n        </ul>\n'
                          + note(ident.get("drawingNote")))

        # Under the paper: the logo, and the two things its suns stand for, huge and soft.
        deep = (self.read_logo(FOOTER_LOGO, "brand-deep-logo") or "") + (
            '<span class="brand-deep-word is-1">Digital</span>'
            '<span class="brand-deep-word is-2">Everyday life</span>')
        title = inline(ident.get("title") or "Identity")
        return (
            '    <section class="brand" aria-labelledby="brand-heading">\n'
            f'      <div class="brand-deep" aria-hidden="true">{deep}</div>\n'
            '      <div class="brand-strip">\n'
            f'        <h2 id="brand-heading" class="brand-title">{title}</h2>\n'
            '        <p class="brand-contents">Logo, website, type, paper and ink, drawing</p>\n'
            f'        <p class="brand-sheet-no">Sheet {sheet} / {len(self.items):03d}</p>\n'
            '      </div>\n'
            f'{logo_cell}{site_cell}{type_cell}{color_cell}{parts_cell}'
            '    </section>\n')

    # About's Q&A as a poster (ABOUT_POSTER, since 2026-11-25 night) --------------------------

    def about_poster(self):
        """The Q&A as a poster on tracing paper (ABOUT_POSTER; the user's ask, after a poster
        on their moodboard: its visual language, the Q&A's words, all on one screen), after
        the Q&A and ending on the footer's line: one sheet, as tall as the screen under the
        header, the poster drawn as big as fits on it. Wide (16:10) where the screen is wider
        than tall, tall (9:16) where it isn't (poster_wide, poster_tall). Each question its
        heading (■ 01° and the question, from "qa"), its answer in the poster's parts, the
        words from site.json's "qaPoster" (the user's own answers, cut down): 01 the
        architect they wanted to be, big in the display face, the times life came near it in
        rows, "I never became one."; 02 Chicago, its two buildings as empty frames, [1] and
        [2], and the answer's first words round a ring; 03 the fields as boxes joined to how
        people actually live; 04 AI, over a gray block under the paper, TypeLab and Clack as
        prints; 05 Light Life, big, a print of the lamps, its years on a dimension line, its
        last line; 06 what's next, under a black bar, big in the mono, "anywhere" and "I love
        exploring" standing in pills on the middle line. Under the paper the logo, huge.
        The poster repeats the Q&A, so screen readers skip it."""
        poster = self.site.get("qaPoster") if ABOUT_POSTER else None
        if not poster:
            return ""
        qs = [i.get("q", "") for i in self.site["about"].get("qa") or []]
        if len(qs) < 6:
            raise BuildError('content/site.json: the Q&A poster ("qaPoster") draws the six '
                             'questions in "about" "qa"; it has fewer.')
        logo, small = self.logo_parts(FOOTER_LOGO), self.logo_parts(HEADER_LOGO)
        if logo is None or small is None:
            return ""
        return ('    <section id="qa-poster" class="qp" aria-label="The Q&amp;A as a poster">\n'
                f'      {self.poster_wide(poster, qs, logo, small)}\n'
                f'      {self.poster_tall(poster, qs, logo, small)}\n'
                '    </section>\n')

    def poster_src(self, rel):
        rel = rel.lstrip("/")
        if not exists(rel):
            self.warnings.append(f"{rel} (the Q&A poster) is missing.")
        return url_for(rel)

    def poster_title_block(self, p, x, y, w, h, small, size):
        """The poster's title block: the logo and the name, the drawing, the page, who drew
        it, its scale (none: N.T.S.), the year, a north arrow, and the sheet's number big."""
        def mark(at, top, cw, ch):
            p.logo(at + size, top + (ch - ch * 0.56) / 2, ch * 0.56 * 512 / 313, small,
                   "qp-logo")
            p.serif(at + size * 2 + ch * 0.92, top + ch - size * 1.1, self.site["name"],
                    ch * 0.5)

        def arrow(at, top, cw, ch):
            p.north(at + cw / 2 - size, top + ch / 2 + 2, ch * 0.24, size)
        unit = (w - 0.26 * w - 0.12 * w) / 6
        p.title_block(x, y, w, h, (
            (0.26 * w, None, None, mark),
            (unit, "Drawing", "Q&A", None),
            (unit, "Page", "About", None),
            (unit, "Drawn by", "K. Park", None),
            (unit, "Scale", "N.T.S.", None),
            (unit, "Date", "2026", None),
            (unit, None, None, arrow),
            (0.12 * w, "Sheet", "000", "big")), size)

    def poster_wide(self, P, qs, logo, small):
        """The poster 1600 x 1000 as a drawing sheet: its border and zones, a title block at
        its foot, three column lines with their bubbles and dimensions; the architect and
        the fields between the edge and line 1, Chicago between 1 and 2, the pills on 2, what's
        next, Light Life, and AI from 3 to the edge, Light Life's years as levels from 2."""
        p = Poster("wide", 1600, 1000)
        T, L = 13, 14               # the small text, the titles
        kid, chi, fld, ai, ll, nx = (P["kid"], P["chicago"], P["fields"], P["ai"],
                                     P["lightLife"], P["next"])

        # Under the paper: the logo huge, the fields' last words.
        p.logo(150, -10, 940, logo, "qp-deep-logo", deep=True)
        p.mono(452, 530, fld["under"], 30, cls="qp-deep-word", deep=True)

        # The sheet: border and zones, the title block, the column lines.
        p.sheet(8, 5)
        self.poster_title_block(p, 34, 896, 1532, 70, small, 14)
        p.grid((470, 790, 1000), ("1", "2", "3"), 62, 896, 14, 14,
               dims=(34, 470, 790, 1000, 1566), dim_y=98)
        for x, y, a in ((470, 520, 12), (790, 830, 16)):
            p.cross(x, y, a)
        p.checker(436, 790, 12)
        p.checker(964, 122, 12)

        # 01, the architect.
        x, w = 56, 394
        y = p.dtitle(x, 148, w, 1, qs[0], L)
        p.mono(x, y + 16, kid["text"], T, width=w)
        p.serif(x - 4, 306, kid["word"], 84)
        p.mono(x, 328, kid["caption"], T, cls="is-quiet")
        y = p.table(x, 340, w, (0.1, 0.42, 0.48), ("No.", "Where", "What"),
                    [[f"{i + 1:02d}", a, b] for i, (a, b) in enumerate(kid["rows"])], T, 24)
        p.serif(x, y + 44, kid["end"], 28, italic=True)

        # 03, the fields.
        y = p.dtitle(x, 586, w, 3, qs[2], L)
        p.mono(x, y + 16, fld["text"], T, width=w)
        p.net(x + w / 2, 700, fld["names"], fld["middle"], T, 132)

        # 02, Chicago: its buildings as details, the first words round a ring.
        bx, bw = 486, 290
        y = p.dtitle(bx, 148, bw, 2, qs[1], L)
        p.mono(bx, y + 16, chi["text"], T, width=bw)
        (n1, w1), (n2, w2) = chi["places"][:2]
        p.frame(bx + 14, 256, 150, 112, "[1]")
        p.dtitle(bx + 14, 410, 168, 1, n1, 12, sheet="02")
        p.mono(bx + 52, 432, w1, 12, cls="is-quiet")
        p.frame(676, 280, 132, 96, "[2]")
        p.dtitle(676, 420, 156, 2, n2, 12, sheet="02")
        p.mono(714, 442, w2, 12, cls="is-quiet")
        p.ring(630, 650, 84, chi["ring"], 13)

        # On line 2: where.
        p.pills(790, 480, nx["pills"], 14, 14)
        p.serif(828, 424, "?", 236)

        # 06, what's next.
        rx, rw = 1016, 540
        p.dtitle(rx, 148, rw, 6, qs[5], L)
        p.mono(rx, 204, nx["title"][0], 28)
        p.mono(rx, 238, nx["title"][1], 28)
        p.mono(rx, 270, nx["text"], T, width=rw)

        # 05, Light Life: its years as levels, a section's floors, from line 2.
        p.dtitle(rx, 352, rw, 5, qs[4], L)
        p.serif(rx - 3, 420, ll["title"], 60)
        p.image(1388, 372, 168, 100, self.poster_src(ll["image"]))
        p.mono(1556, 492, ll["line"], 11, anchor="end", cls="is-quiet")
        p.levels(806, 1360, 594, ll["years"], 40, 12, 896, 470)
        p.serif(806, 632, ll["quote"][0], 22, italic=True)
        p.serif(806, 658, ll["quote"][1], 22, italic=True)

        # 04, AI: a room in section, its walls hatched.
        p.walls(1004, 674, 556, 214, 10)
        p.dtitle(rx + 6, 714, rw - 28, 4, qs[3], L)
        p.serif(rx + 6, 766, ai["title"][0], 30)
        p.serif(rx + 6, 798, ai["title"][1], 30)
        p.mono(rx + 6, 822, ai["text"], 11, width=316)
        for i, (name, src) in enumerate(ai["works"][:2]):
            ix = 1352 + i * 102
            p.image(ix, 742, 88, 100, self.poster_src(src))
            p.mono(ix, 864, f"[{name}]", 11)
        return p.svg("is-wide")

    def poster_tall(self, P, qs, logo, small):
        """The poster 900 x 1600, for a screen taller than wide, as the wide one is drawn,
        in two columns round column line 2: the architect and the fields down the left,
        what's next, Chicago, Light Life and AI down the right; fewer words."""
        p = Poster("tall", 900, 1600)
        T, L = 19, 19
        kid, chi, fld, ai, ll, nx = (P["kid"], P["chicago"], P["fields"], P["ai"],
                                     P["lightLife"], P["next"])
        p.logo(-90, 400, 1080, logo, "qp-deep-logo", deep=True)
        p.mono(50, 1060, fld["under"], 26, cls="qp-deep-word", deep=True)

        p.sheet(4, 8)
        self.poster_title_block_tall(p, 34, 1466, 832, 100, small, 17)
        p.grid((450,), ("2",), 64, 1466, 18, 19, dims=(34, 450, 866), dim_y=108)
        for x, y, a in ((450, 770, 14), (866, 560, 12), (34, 1000, 12)):
            p.cross(x, y, a)
        p.checker(404, 1080, 16)

        # Left: 01, 03, the ring.
        x, w = 52, 380
        y = p.dtitle(x, 176, w, 1, qs[0], L)
        p.mono(x, y + 24, kid["text"], T, width=w)
        p.serif(x - 4, 420, kid["word"], 80)
        p.mono(x, 450, kid["caption"], 16, cls="is-quiet")
        y = p.table(x, 466, w, (0.14, 0.86), ("No.", "Where, what"),
                    [[f"{i + 1:02d}", (a, b)] for i, (a, b) in enumerate(kid["rows"])], 16, 50)
        p.serif(x, y + 48, kid["end"], 32, italic=True)

        y = p.dtitle(x, 860, w, 3, qs[2], L)
        p.net(x + w / 2, y + 26, fld["names"], fld["middle"], 17, 128)
        p.ring(214, 1250, 100, chi["ring"], 18)

        # Right: 06, 02, 05, 04.
        rx, rw = 472, 394
        y = p.dtitle(rx, 176, rw, 6, qs[5], L)
        p.mono(rx, y + 30, nx["title"][0], 23)
        p.mono(rx, y + 62, nx["title"][1], 23)
        p.mono(rx, y + 98, nx["text"], T, width=rw)

        y = p.dtitle(rx, 490, rw, 2, qs[1], L)
        p.mono(rx, y + 24, chi["text"], T, width=rw)
        (n1, w1), (n2, w2) = chi["places"][:2]
        p.frame(rx + 10, 640, 160, 104, "[1]", size=16)
        p.frame(rx + 210, 660, 170, 84, "[2]", size=16)
        p.mono(rx + 10, 776, n1, 16)
        p.mono(rx + 210, 776, n2, 16)

        p.pills(450, 812, nx["pills"], 19, 16)

        y = p.dtitle(rx, 870, rw, 5, qs[4], L)
        p.serif(rx - 3, y + 74, ll["title"], 62)
        p.image(rx, y + 96, rw, 130, self.poster_src(ll["image"]))
        p.levels(rx, 866, 1262, [(y_, "") for y_, _ in ll["years"]], 32, 16, rx + 120, 200)
        p.serif(rx, 1290, ll["quote"][0], 21, italic=True)
        p.serif(rx, 1314, ll["quote"][1], 21, italic=True)

        p.walls(462, 1328, 404, 130, 9)
        p.dtitle(rx + 4, 1368, rw - 24, 4, qs[3], 17)
        p.serif(rx + 4, 1412, ai["title"][0], 27)
        p.serif(rx + 4, 1441, ai["title"][1], 27)
        return p.svg("is-tall")

    def poster_title_block_tall(self, p, x, y, w, h, small, size):
        """The tall poster's title block: two rows, the logo and the name over the drawing,
        who drew it, the scale and the year, the sheet's number big at the right."""
        half = h / 2
        p.path(f"M{num(x)} {num(y)}H{num(x + w)}", "qp-line qp-heavy")
        p.path(f"M{num(x)} {num(y + half)}H{num(x + w * 0.8)}")
        p.path(f"M{num(x + w * 0.8)} {num(y)}V{num(y + h)}")
        p.logo(x + size, y + 10, 52, small, "qp-logo")
        p.serif(x + size + 66, y + half - 12, self.site["name"], 30)
        p.north(x + w * 0.8 - 46, y + half / 2 + 2, 12, 14)
        cells = (("Drawing", "Q&A"), ("Drawn by", "K. Park"), ("Scale", "N.T.S."),
                 ("Date", "2026"))
        cw = w * 0.8 / len(cells)
        for i, (label, value) in enumerate(cells):
            cx = x + i * cw
            if i:
                p.path(f"M{num(cx)} {num(y + half)}V{num(y + h)}")
            p.mono(cx + 12, y + half + 18, label, 13, cls="is-quiet")
            p.mono(cx + 12, y + h - 10, value, size)
        p.mono(x + w * 0.8 + 14, y + 22, "Sheet", 13, cls="is-quiet")
        p.serif(x + w * 0.8 + 12, y + h - 16, "000", 50)

    def build_about(self):
        s = self.site
        about = s["about"]
        # Experience, under the paragraph, only while "experience" in content/site.json lists
        # jobs: taken out late on 2026-11-13 (the user's ask: the header's RESUME has them, and
        # About tells more of the story instead); put the list back to show it again. A job:
        # its role, then 'Company · Dates' under it (since 2026-11-12; role, company, and dates
        # a column each before), leaving out what's empty. The dot keeps to the company's last
        # word, so a wrapped line never starts with it.
        jobs = []
        for row in about.get("experience") or []:
            detail = "&nbsp;· ".join(inline(row[k]) for k in ("company", "dates") if row.get(k))
            jobs.append(
                '        <li>'
                f'<span class="experience-role">{inline(row.get("role", ""))}</span> '
                f'<span class="experience-detail">{detail}</span>'
                '</li>')
        experience = ""
        if jobs:
            experience = (
                '\n    <section class="about-list" aria-labelledby="experience-heading">\n'
                '      <h2 id="experience-heading" class="about-label">Experience</h2>\n'
                '      <ul class="experience">\n' + "\n".join(jobs) + '\n      </ul>\n'
                '    </section>\n')
        scales = self.about_scales()
        if 'class="orbits-figure is-globe"' in scales:
            scales += (f'    <script src="/assets/js/globe.js'
                       f'?v={file_version("assets/js/globe.js")}" defer></script>\n')
        content = render("about.html", statement=self.about_statement(about),
                         scales=scales, experience=experience,
                         qa=self.about_qa(about), identity=self.about_identity(),
                         poster=self.about_poster())
        if ABOUT_SHEETS:
            content = f'    <div class="about-sheets">\n{content}    </div>\n'
        self.page("about/index.html", "about", "/about/", f"About — {s['name']}",
                  s["description"], content, "page-about", current="about",
                  image=self.og_image())

    def build_404(self):
        s = self.site
        # Over its sentence a detail callout (since 2026-11-22, the drawing system): an
        # unknown detail on sheet 404, the sheet that isn't there.
        self.page("404.html", "404", "/404.html", f"Page not found — {s['name']}",
                  s["description"], render("404.html", mark=self.callout("?", "404")),
                  "wrap page-not-found", noindex=True)

    def build_redirects(self):
        """Old addresses (REDIRECTS): a page that sends the visitor on at once, by meta refresh
        and by script (either works alone), with a plain link if both are off."""
        for old, (target, title) in REDIRECTS.items():
            self.write(f"{old}/index.html", render(
                "redirect.html", page_title=esc(f"{title} — {self.site['name']}"),
                target=esc(target), target_js=json.dumps(target), title=esc(title)))

    def build_crawl_files(self):
        """robots.txt, letting search engines in, and once the site's address is known
        (siteUrl), sitemap.xml, listing the pages in full: Home, Work, each project, Archive,
        About. Not the 404 or the old addresses that send visitors on. (Since 2026-11-09.)"""
        base = (self.site.get("siteUrl") or "").rstrip("/")
        robots = ["User-agent: *", "Allow: /"]
        if base:
            paths = ["/", *(["/work/"] if HOME_TRACK else []),
                     *(f"/work/{p['slug']}/" for p in self.projects),
                     "/archive/", "/about/"]
            urls = "".join(f"  <url><loc>{esc(base + path)}</loc></url>\n" for path in paths)
            self.write("sitemap.xml",
                       '<?xml version="1.0" encoding="UTF-8"?>\n'
                       '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                       f"{urls}</urlset>\n")
            robots.append(f"Sitemap: {base}/sitemap.xml")
        self.write("robots.txt", "\n".join(robots) + "\n")

    def report(self, seconds):
        pages = sum(1 for w in self.written
                    if w.endswith(".html") and w[:-len("/index.html")] not in REDIRECTS)
        print(f"Built {pages} pages into dist/ in {seconds:.2f}s")
        left = ", ".join(f"{k} {v}" for k, v in self.placeholder_counts.items() if v)
        if left:
            print(f"  [PLACEHOLDER] notes left: {left}")
        if self.missing_media:
            print(f"  {len(self.missing_media)} images/videos not added yet (gray placeholders shown)")
        if self.needs_small:
            print(f"  {len(self.needs_small)} large images have no smaller copy for phones yet: "
                  "run python3 build.py images")
        for w in dict.fromkeys(self.warnings):
            print(f"  Note: {w}")


def build(local_url=None):
    start = time.time()
    site = load_json("site.json")
    items = load_json("projects.json")
    archive = load_json("archive.json")
    if local_url and not site.get("siteUrl"):
        site["siteUrl"] = local_url  # local preview: full links point at this server
    elif not site.get("siteUrl") and os.environ.get("NETLIFY") == "true" and os.environ.get("URL"):
        # On Netlify, the site's main address (its own domain, once it has one), so link
        # previews and the sitemap work from the first deploy. (Since 2026-11-09.)
        site["siteUrl"] = os.environ["URL"]

    warnings = validate(site, items)
    validate_archive(archive)
    items.sort(key=lambda p: p["order"])  # stable: items with the same number keep the file's order
    builder = Builder(site, items, archive)
    builder.warnings += warnings
    os.makedirs(DIST_DIR, exist_ok=True)
    builder.copy_assets()
    if HOME_TRACK:  # otherwise Work's grid is the first page (build_work)
        builder.build_home()
    builder.build_work()
    builder.build_archive()
    projects = builder.projects
    for i, p in enumerate(projects):  # Previous / Next loop around the ends
        builder.build_project(p, projects[i - 1], projects[(i + 1) % len(projects)])
    builder.build_about()
    builder.build_404()
    builder.build_redirects()
    builder.build_crawl_files()
    builder.remove_stale()
    builder.report(time.time() - start)


# ---------------------------------------------------------------------------
# Smaller copies of images (python3 build.py images)

def make_small_copies():
    """A smaller copy next to each large image in assets/images/ that has none yet (sizes in
    small_target), with -small before its ending: cover-small.jpg next to cover.webp. Pages then
    take the copy where it's enough (phones, mostly) and the full image where it isn't. Uses
    sips, which comes with macOS; a WebP or AVIF image's copy is a JPG, since sips can't write
    those. The copies are files like any other: keep them in the folder and push them. Nothing in
    assets/images/ itself (og.png, the link preview, stays whole). (Since 2026-11-09.)"""
    if not shutil.which("sips"):
        sys.exit("This needs sips, which comes with macOS. On another computer, save the smaller "
                 "copies by hand (see README, Swap in real images and videos).")
    top = os.path.join(ASSET_DIR, "images")
    made, failed = 0, 0
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        if dirpath == top:
            continue
        for name in sorted(filenames):
            stem, ext = os.path.splitext(name)
            if (name.startswith(".") or stem.endswith(SMALL_SUFFIX)
                    or ext.lower() not in SMALL_SOURCE_EXTS):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), ROOT).replace(os.sep, "/")
            size = media_size(rel)
            args = size and small_target(rel, size)
            if not args or small_copy(rel):
                continue
            out_ext = ext if ext.lower() in (".jpg", ".jpeg", ".png") else ".jpg"
            out = os.path.splitext(rel)[0] + SMALL_SUFFIX + out_ext
            fmt = [] if out_ext.lower() == ".png" else ["-s", "format", "jpeg",
                                                         "-s", "formatOptions", "82"]
            result = subprocess.run(["sips", *args, *fmt, os.path.join(ROOT, rel),
                                     "--out", os.path.join(ROOT, out)],
                                    capture_output=True, text=True)
            if result.returncode or not exists(out):
                failed += 1
                print(f"  Couldn't make {out}: {(result.stderr or result.stdout).strip()}")
                continue
            made += 1
            print(f"  {out}")
    print(f"Made {made} smaller {'copy' if made == 1 else 'copies'}"
          + (f", {failed} failed" if failed else "") + ".")


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
    parser.add_argument("command", nargs="?", choices=["build", "serve", "images"], default="build")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.command == "serve":
        serve(args.port)
        return
    if args.command == "images":
        make_small_copies()
        return
    try:
        build()
    except BuildError as e:
        sys.exit(f"Build failed: {e}")


if __name__ == "__main__":
    main()
