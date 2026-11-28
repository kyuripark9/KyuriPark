"""Remakes Work's stage tiles: each one's still and 6-second loop (README.md here).

    python3 tools/tile-stage/make.py typelab clack light-life nbcu editorial   (or: all)
    python3 tools/tile-stage/make.py nbcu --out /some/folder   (somewhere else, to compare)

Writes stage.jpg (1440 x 2000) and stage.mp4 (720 x 1000, 6 s, 30 fps, H.264, silent) into
the project's image folder; Editorial Collection, its wide tile's two halves
(editorial-stage-left.jpg, -right.jpg) and one loop for both (editorial-stage.mp4, 1440 x 1000).
Needs Google Chrome, the node in ~/Documents/Portfolio/Ai projects/TypeLab/.tools (or NODE),
TypeLab's tools/browser/cdp.mjs, and an ffmpeg with libx264 (FFMPEG, or
`python3 -m pip install --user imageio-ffmpeg`). The frames go in a temporary folder, deleted
after each tile (about 100 MB at a time).
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
NODE = os.environ.get("NODE", os.path.expanduser(
    "~/Documents/Portfolio/Ai projects/TypeLab/.tools/node/bin/node"))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = int(os.environ.get("CDP_PORT", "9391"))
N = 180  # frames in a loop: 6 s at 30 fps

# start: the loop's first frame, and the still (the moment that shows the work best);
# crossfade: frames past N captured to fade into the first ones (Clack's print sinking back)
TILES = {
    "typelab": dict(capture=True, device="laptop", glow="255,246,232", start=84,
                    out="assets/images/typelab/stage"),
    "clack": dict(capture=True, device="laptop", glow="60,95,210", start=90, crossfade=24,
                  out="assets/images/clack/stage"),
    "light-life": dict(capture=True, device="phone", glow="235,225,215", start=90,
                       out="assets/images/light-life/stage"),
    "nbcu": dict(print="nbcu", start=0, out="assets/images/nbcuniversal/stage"),
    "editorial": dict(print="editorial", start=0, halves=True,
                      out="assets/images/pieces/editorial-stage"),
}


def find_ffmpeg():
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        pass
    if shutil.which("ffmpeg"):
        return shutil.which("ffmpeg")
    sys.exit("Needs ffmpeg with libx264: python3 -m pip install --user imageio-ffmpeg, "
             "or set FFMPEG to one.")


def start_chrome(work):
    proc = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
         f"--user-data-dir={os.path.join(work, 'chrome')}", "--no-first-run",
         "--no-default-browser-check", "--hide-scrollbars", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
            return proc
        except OSError:
            time.sleep(0.5)
    proc.kill()
    sys.exit(f"Chrome didn't come up on port {PORT}.")


def node(*args):
    subprocess.run([NODE, *args], check=True, env={**os.environ, "CDP_PORT": str(PORT)})


def make(name, t, work, ff, out_dir):
    print(f"{name}: ", end="", flush=True)
    tmp = os.path.join(work, name)
    frames, staged, still = (os.path.join(tmp, d) for d in ("frames", "staged", "still"))
    start, xf = t["start"], t.get("crossfade", 0)
    assert start >= xf, "the still can't be one of the crossfaded frames"
    if t.get("capture"):
        print("capturing, ", end="", flush=True)
        node(os.path.join(HERE, "capture.mjs"), name, frames)
        print("staging, ", end="", flush=True)
        node(os.path.join(HERE, "render.mjs"), "screen", frames, staged, "1", t["glow"], t["device"])
        node(os.path.join(HERE, "render.mjs"), "screen", frames, still, "2", t["glow"], t["device"],
             str(start))
    else:
        print("staging, ", end="", flush=True)
        node(os.path.join(HERE, "render.mjs"), "print", t["print"], staged, "1")
        node(os.path.join(HERE, "render.mjs"), "print", t["print"], still, "2", str(start))

    # the loop: its first frames faded in from the frames captured past its end, then begun at
    # `start`, so it opens on the still
    def frame(i):
        return os.path.join(staged, f"{i:04d}.jpg")
    seq = os.path.join(tmp, "seq")
    os.makedirs(seq)
    for i in range(xf):
        a = i / xf
        blended = os.path.join(tmp, f"blend-{i:04d}.jpg")
        subprocess.run([ff, "-loglevel", "error", "-y", "-i", frame(i), "-i", frame(N + i),
                        "-filter_complex", f"[0][1]blend=all_expr='A*{a}+B*(1-{a})'",
                        "-frames:v", "1", "-q:v", "2", blended], check=True)
    for j in range(N):
        i = (j + start) % N
        src = os.path.join(tmp, f"blend-{i:04d}.jpg") if i < xf else frame(i)
        os.symlink(src, os.path.join(seq, f"{j:04d}.jpg"))
    print("encoding", flush=True)
    base = (os.path.join(out_dir, f"{name}-{os.path.basename(t['out'])}") if out_dir
            else os.path.join(ROOT, t["out"]))
    subprocess.run([ff, "-loglevel", "error", "-y", "-framerate", "30",
                    "-i", os.path.join(seq, "%04d.jpg"), "-c:v", "libx264", "-preset", "slow",
                    "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
                    base + ".mp4"], check=True)
    png = os.path.join(still, f"{start:04d}.png")
    if t.get("halves"):
        for side, x in (("left", 0), ("right", 1440)):
            subprocess.run([ff, "-loglevel", "error", "-y", "-i", png, "-vf",
                            f"crop=1440:2000:{x}:0", "-q:v", "3", f"{base}-{side}.jpg"], check=True)
    else:
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "88", png,
                        "--out", base + ".jpg"], check=True, capture_output=True)
    shutil.rmtree(tmp)


def main():
    args = sys.argv[1:]
    out_dir = None
    if "--out" in args:
        k = args.index("--out")
        out_dir = os.path.abspath(args[k + 1])
        os.makedirs(out_dir, exist_ok=True)
        del args[k:k + 2]
    names = list(TILES) if args == ["all"] else args
    unknown = [n for n in names if n not in TILES]
    if not names or unknown:
        sys.exit(f"Which tiles? {', '.join(TILES)}, or all." + (f" (Not: {', '.join(unknown)}.)" if unknown else ""))
    ff = find_ffmpeg()
    work = tempfile.mkdtemp(prefix="tile-stage-")
    chrome = start_chrome(work)
    try:
        for name in names:
            make(name, TILES[name], work, ff, out_dir)
    finally:
        chrome.kill()
        chrome.wait()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
