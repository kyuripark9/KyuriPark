#!/usr/bin/env python3
"""TypeLab's page figures, drawn as drawing sheets in the portfolio's system (2026-11-26; README,
Block types, "Row"), from real things: the user's own Illustrator file and sheet (Fonts ai/), a
moodboard of real typefaces on this Mac, typelab.ink's own screens (capture.mjs, in screens/), and the
LinkedIn slides' screenshots of My designs and Export (~/Documents/Portfolio/Ai projects/TypeLab/
ad/linkedin/source/img/). Lays them out here (figures.css, figures.js) and saves each figure at
twice its size as a JPEG in assets/images/typelab/, with its -small copy. Needs Google Chrome and
macOS's sips and qlmanage.

    python3 tools/typelab-figures/make.py            # all five
    python3 tools/typelab-figures/make.py fig2       # one
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.expanduser("~/Documents/Portfolio/Ai projects/TypeLab/ad/linkedin/source")
OUT = os.path.join(ROOT, "assets/images/typelab")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
NAMES = {"fig1": "problem", "fig2": "idea", "fig3": "library", "fig4": "export", "fig5": "built", "fig6": "redraw"}
SMALL_WIDTH = 1200  # build.py's

def head(text, dim=""):
    dim = f'<span class="dim">· {dim}</span>' if dim else ""
    return f'<div class="head"><i class="sq"></i><span>{text}</span>{dim}</div>'


# 01: the problem, from real things: the user's own Illustrator file (a capture of the g of
# Before/16.ai at 734%, its 65 points selected; capture by hand, see README) beside the whole sheet
# it's on, and a moodboard of real typefaces from this Mac, printed specimens with the user's notes.
SHEET = os.path.expanduser("~/Documents/Portfolio/Ai projects/TypeLab/Fonts ai/Before/16.ai")
G_ON_SHEET = (502, 750, 530, 712)   # the g's bounds on the sheet, in points (1032 x 1120)


def hand(d):
    return f'<path d="{d}" fill="none" stroke="#161616" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'


def xmark(x, y, s=34):
    return hand(f"M{x} {y} Q{x + s * .55} {y + s * .4} {x + s} {y + s * 1.02}") + \
           hand(f"M{x + s * 1.02} {y + s * .02} Q{x + s * .45} {y + s * .5} {x + 2} {y + s * .98}")


def loop(cx, cy, rx, ry):
    return hand(f"M{cx - rx * .2} {cy - ry} C{cx + rx * 1.1} {cy - ry * 1.05} {cx + rx * 1.05} {cy + ry} {cx} {cy + ry * 1.02} "
                f"C{cx - rx * 1.1} {cy + ry} {cx - rx * 1.08} {cy - ry * .9} {cx + rx * .15} {cy - ry * 1.12}")


def arrow(x1, y1, x2, y2, bend=30):
    mx, my = (x1 + x2) / 2 + bend, (y1 + y2) / 2 - bend
    import math
    ang = math.atan2(y2 - my, x2 - mx)
    h1 = (x2 - 11 * math.cos(ang - .45), y2 - 11 * math.sin(ang - .45))
    h2 = (x2 - 11 * math.cos(ang + .45), y2 - 11 * math.sin(ang + .45))
    return hand(f"M{x1} {y1} Q{mx} {my} {x2} {y2}") + hand(f"M{h1[0]:.1f} {h1[1]:.1f} L{x2} {y2} L{h2[0]:.1f} {h2[1]:.1f}")


CARDS = [  # #, typeface (CSS), weight, word, size, x, y, w, h, the user's note and where it goes
    (1, "Helvetica Neue", 700, "Brand", 66, 0, 0, 290, 176, "Too stiff", (150, 196)),
    (2, "Didot", 400, "Serif?", 72, 330, 22, 300, 206, "Close, not quite", (420, 248)),
    (3, "Impact", 400, "BOLD", 70, 690, 0, 274, 160, "Too loud", (744, 180)),
    (4, "Snell Roundhand", 400, "Script", 70, 40, 250, 262, 168, "Too formal", (110, 438)),
    (5, "Copperplate", 400, "WIDE", 60, 352, 294, 330, 136, "Almost?", (720, 344)),
    (6, "Baskerville", 400, "Classic", 64, 728, 226, 252, 186, "Seen it before", (790, 432)),
]
ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789"
cards = "".join(
    f'<div class="card" data-marks style="left:{x}px;top:{y}px;width:{w}px;height:{h}px">'
    f'<span class="cno">#{n:02d}</span>'
    f'<span class="spec" style="font-family:\'{fam}\';font-weight:{wt};font-size:{size}px">{word}</span>'
    f'<span class="abc" style="font-family:\'{fam}\';font-weight:{wt}">{ABC}</span>'
    f'<span class="fname">{fam}{" Bold" if wt == 700 else ""}</span></div>'
    for n, fam, wt, word, size, x, y, w, h, _, _ in CARDS)
notes = "".join(f'<span class="mnote" style="left:{nx}px;top:{ny}px">{note}</span>'
                for *_, note, (nx, ny) in CARDS)
marks = (xmark(236, 10) + xmark(918, 8) + xmark(254, 262) + xmark(930, 236)
         + loop(520, 112, 58, 40)          # Serif?: the f and the ?
         + loop(452, 362, 50, 34)          # WIDE: the W
         + "".join(arrow(nx + 22, ny - 4, nx + 8, y + h - 8, -12)
                   for _, _, _, _, _, x, y, w, h, _, (nx, ny) in CARDS if nx < x + w and nx + 40 > x)
         + arrow(714, 354, 686, 360, 6))
fig1 = f"""
<section class="fig" id="fig1">
  {head("01° Draw every idea by hand", "days for each one")}
  <div class="band f1a">
    <figure class="shot frame" data-frame id="ai"><img src="ui/illustrator.png" alt=""></figure>
    <div class="side">
      <figure class="print frame" data-frame id="sheet"><img src="sheet/16.ai.png" alt=""></figure>
      <span class="tag">Before/16.ai · one sheet, 127 characters</span>
    </div>
  </div>
  {head("02° Collect fonts that exist", "never the one in my head")}
  <div class="band board">{cards}{notes}<svg class="hand" viewBox="0 0 1008 470">{marks}</svg></div>
  <span class="bub" data-on="ai" data-x="51.2" data-y="37.6" data-side="at" data-bx="22" data-by="26" data-note="65 points,&#10;placed by hand">1</span>
  <span class="bub" data-on="sheet" data-x="{(G_ON_SHEET[0] + G_ON_SHEET[2]) / 2 / 1032 * 100:.1f}" data-y="{(1120 - (G_ON_SHEET[1] + G_ON_SHEET[3]) / 2) / 1120 * 100:.1f}" data-side="top" data-gap="40" data-box="{(G_ON_SHEET[2] - G_ON_SHEET[0]) / 1032 * 100:.2f},{(G_ON_SHEET[1] - G_ON_SHEET[3]) / 1120 * 100:.2f}">1</span>
</section>"""

# 02: the real UI (capture.mjs's screens of typelab.ink: Didone, "Galaxy", four controls stacked),
# a row a step: its label, the preview with the step before faintly under it (tracing paper), and
# the control as TypeLab shows it; one callout on the control and one on the part it changed. The
# last step, how the strokes end, too small to read at the preview's size, has its detail
# magnified under the control, before and after (the screens are 3x, so it stays sharp).
UI = json.load(open(os.path.join(HERE, "screens/steps.json"), encoding="utf-8"))
WORD = (236, 130, 484, 150)        # the preview's crop: x, y, w, h in the screen's CSS pixels
CTL_W = 308
GHOST = (2, 3)
MARKS = {  # where each step's callouts point: on the preview (a letter's box, then x, y in it, 0-1)
    1: ("l", 0.50, 0.55, "top"), 2: ("l", 0.62, 0.10, "top"), 3: ("x", 0.55, 0.02, "top"), 4: ("a", 0.29, 0.23, "top")}
DETAIL = (50, 38, 2.8)              # the magnified detail: w, h in CSS pixels round the mark, and how much bigger


def crop(n, x, y, w, h, extra="", zoom=1):
    return (f'<img src="ui/step{n}.png" alt="" style="width:{UI["W"] * zoom}px;left:{-x * zoom}px;top:{-y * zoom}px"{extra}>')


rows, callouts = [], []
for st in UI["steps"][1:]:
    n = st["n"]
    wx, wy, ww, wh = WORD
    # the step before, faintly over it, where the letters stay in place (a slant, a height)
    ghost = crop(n - 1, wx, wy, ww, wh, ' class="ghost"') if n in GHOST else ""
    word = f'<div class="ui frame" data-frame id="w{n}" style="width:{ww}px;height:{wh}px">{crop(n, wx, wy, ww, wh)}{ghost}</div>'
    g = next(g for g in st["glyphs"] if g["c"] == MARKS[n][0])
    mx, my = g["x"] + g["w"] * MARKS[n][1], g["y"] + g["h"] * MARKS[n][2]
    px, py = (mx - wx) / ww * 100, (my - wy) / wh * 100
    detail = ""
    if st.get("tiles"):
        ts = st["tiles"]
        x0, x1 = min(t["x"] for t in ts), max(t["x"] + t["w"] for t in ts)
        cx, cy, cw, ch = st["panel"]["x"] + 8, ts[0]["y"] - 8, CTL_W, ts[0]["h"] + 16
        t = ts[st["pick"]]
        kx, ky = t["x"] + t["w"] / 2, t["y"] + t["h"] / 2
        dw, dh, z = DETAIL
        frames = "".join(
            f'<div class="zoom"><div class="ui frame" style="width:{dw * z}px;height:{dh * z}px">'
            f'{crop(k, mx - dw / 2, my - dh / 2, dw, dh, zoom=z)}</div><span>{html.escape(str(name))}</span></div>'
            for k, name in ((f"{n}-before", st["from"]), (n, st["to"])))
        detail = f'<div class="zooms">{frames}</div>'
        box = f' data-box="{dw / ww * 100:.2f},{dh / wh * 100:.2f}"'
    else:
        c = st["ctl"]
        cx, cy, cw, ch = st["panel"]["x"] + 8, c["y"] - 34, CTL_W, 80
        kx, ky = c["x"] + c["w"] * (st["to"] / 100), c["y"] + c["h"] / 2
        box = ""
    ctl = f'<div class="ui frame" data-frame id="c{n}" style="width:{cw}px;height:{ch}px">{crop(n, cx, cy, cw, ch)}</div>'
    side = "top" if st.get("tiles") else "right"
    bub = (f'<span class="bub" data-on="w{n}" data-x="{px:.1f}" data-y="{py:.1f}" data-side="{MARKS[n][3]}" data-gap="16"{box}>{n}</span>'
           f'<span class="bub" data-on="c{n}" data-x="{(kx - cx) / cw * 100:.1f}" data-y="{(ky - cy) / ch * 100:.1f}" data-side="{side}" data-gap="{16 if st.get("tiles") else 22}">{n}</span>')
    change = f'{st["from"]} → {st["to"]}'
    rows.append(f'''<div class="srow2">
      <div class="lab"><span class="no">{n:02d}°</span><span class="nm">{html.escape(st["control"])}</span>
        <span class="chg">{html.escape(change)}</span><span class="ttl">{html.escape(st["title"])}</span></div>
      {word}<div class="ctlcol">{ctl}{detail}</div></div>''')
    callouts.append(bub)
fig2 = f"""
<section class="fig" id="fig2">
  {head("Start from Didone", "every step redraws all 127 characters")}
  <div class="band f2b">{"".join(rows)}</div>
  {"".join(callouts)}
</section>"""


# The grid's Points screen (the user's ask: its construction grid, its points and Only R in sight):
# capture.mjs's screen of the R, the same size as the grid's other screens, three callouts on it.
RD = json.load(open(os.path.join(HERE, "screens/redraw.json"), encoding="utf-8"))


def at(x, y, tx, ty, n):  # a callout at (x, y) with its leader to (tx, ty), in the screen's CSS pixels
    return (f'<span class="bub" data-on="rd" data-x="{tx / RD["W"] * 100:.2f}" data-y="{ty / RD["H"] * 100:.2f}" '
            f'data-side="at" data-bx="{x / RD["W"] * 100:.2f}" data-by="{y / RD["H"] * 100:.2f}">{n}</span>')


pt = min(RD["points"], key=lambda q: (q["x"] - 262) ** 2 + (q["y"] - 443) ** 2)
o, gs = RD["only"], RD["grid"]
fig6 = f"""
<section class="fig flush" id="fig6" style="width:{RD['W']}px">
  <div class="shot" id="rd" style="width:{RD['W']}px;height:{RD['H']}px"><img src="ui/redraw.png" alt=""></div>
  {at(200, 385, pt['x'], pt['y'], 1)}{at(o['x'] + o['w'] + 56, o['y'] + o['h'] / 2, o['x'] + o['w'] + 9, o['y'] + o['h'] / 2, 2)}{at(gs['x'] - 48, gs['y'] + gs['h'] / 2, gs['x'] - 10, gs['y'] + gs['h'] / 2, 3)}
</section>"""


def bubs(spec):
    return "".join(f'<span class="bub" data-on="{on}" data-x="{x}" data-y="{y}" data-side="{side}" '
                   f'data-gap="{gap}">{n}</span>' for n, (on, x, y, side, gap) in enumerate(spec, 1))


fig3 = f"""
<section class="fig" id="fig3">
  <div class="band f3"><figure class="print frame" data-frame id="lib"><img src="img/library.png" alt=""></figure></div>
  {bubs([("lib", 25.7, 19.5, "top", 34), ("lib", 46.8, 38.9, "top", 34), ("lib", 64.3, 12.7, "top", 34)])}
</section>"""

fig4 = f"""
<section class="fig" id="fig4">
  <div class="band f4">
    <figure class="print frame" data-frame id="dlg"><img src="img/export.png" alt=""></figure>
    <figure class="print frame" data-frame id="fb"><img src="img/fontbook.png" alt=""></figure>
  </div>
  {bubs([("dlg", 10.5, 44, "left", 40), ("dlg", 98, 19.3, "right", 44), ("dlg", 98, 33.5, "right", 44),
         ("fb", 85, 86, "bottom", 36)])}
</section>"""

ROUNDS = [149, 19, 9, 2, 8, 1, 7, 4, 0, 1, 4, 1]
TOP = 150
grid = "".join(f'<div class="grid" style="bottom:{v / TOP * 100:.2f}%"><span class="axis">{v}</span></div>'
               for v in (0, 50, 100, 150))
bars = "".join(f'<div class="bar{" zero" if v == 0 else ""}"><span class="v">{v}</span>'
               f'<i style="height:{v / TOP * 100:.2f}%"></i></div>' for v in ROUNDS)
xl = "".join(f'<span class="k">{i:02d}</span>' for i in range(1, len(ROUNDS) + 1))
fig5 = f"""
<section class="fig" id="fig5">
  <div class="band"><figure class="chart frame f5" data-frame>
    <div class="chead"><span>Broken designs found</span><span>By test round · 5,000 random mixes each</span></div>
    <div class="plot">{grid}<div class="bars">{bars}</div></div>
    <div class="xl">{xl}</div>
  </figure></div>
  <p class="note">…then I still checked every letter by eye</p>
</section>"""

page = f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="figures.css"><script src="figures.js" defer></script></head>
<body>{fig1}{fig2}{fig3}{fig4}{fig5}{fig6}</body></html>"""


def chrome(*args):
    return subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                           "--allow-file-access-from-files", "--virtual-time-budget=6000", *args],
                          capture_output=True, text=True).stdout


work = tempfile.mkdtemp()
shutil.copytree(os.path.join(SRC, "img"), os.path.join(work, "img"))
shutil.copytree(os.path.join(HERE, "screens"), os.path.join(work, "ui"))
os.makedirs(os.path.join(work, "sheet"))
subprocess.run(["qlmanage", "-t", "-s", "1400", "-o", os.path.join(work, "sheet"), SHEET], capture_output=True)
shutil.copy(os.path.join(HERE, "figures.js"), work)
css = open(os.path.join(HERE, "figures.css"), encoding="utf-8").read()
css = css.replace("FONTS/", "file://" + os.path.join(ROOT, "assets/fonts") + "/")
open(os.path.join(work, "figures.css"), "w", encoding="utf-8").write(css)
open(os.path.join(work, "figures.html"), "w", encoding="utf-8").write(page)
url = "file://" + os.path.join(work, "figures.html")

for fig in sys.argv[1:] or NAMES:
    dom = chrome("--window-size=1080,1400", "--dump-dom", f"{url}#{fig}")
    h = int(re.search(r'data-h="(\d+)"', dom).group(1))
    png = os.path.join(work, f"{fig}.png")
    chrome("--force-device-scale-factor=2", f"--window-size={RD['W'] if fig == 'fig6' else 1080},{h}", f"--screenshot={png}",
           f"{url}#{fig}")
    jpg = os.path.join(OUT, f"{NAMES[fig]}.jpg")
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "90", png, "--out", jpg],
                   capture_output=True, check=True)
    subprocess.run(["sips", "--resampleWidth", str(SMALL_WIDTH), "-s", "format", "jpeg",
                    "-s", "formatOptions", "85", jpg, "--out", jpg[:-4] + "-small.jpg"],
                   capture_output=True, check=True)
    print(f"{NAMES[fig]}.jpg  1080 x {h} (x2)")
print("Work files:", work)
