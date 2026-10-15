"""Quick outline drawing of a track: python3 strip.py [params.json|-] out.png [t1 t2 ...]"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check  # noqa: E402


def draw(doc, track, times, out, scale=260):
    x0, x1, y0, y1 = -0.6, 3.2, -0.05, 1.7
    W, H = int((x1 - x0) * scale), int((y1 - y0) * scale)
    solids = {s["id"]: s for s in doc["solids"]}
    frames = track["frames"]
    tiles = []
    for t in times:
        f = min(frames, key=lambda fr: abs(fr["t"] - t))
        im = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(im)
        P = lambda x, y: ((x - x0) * scale, H - (y - y0) * scale)
        for pid, pl in f["placements"].items():
            s = solids.get(pid)
            if s is None:
                continue
            col = s["placeholder"]["fill"]
            if s["body"]["kind"] == "ball":
                rr = s["body"]["radius"]; cx, cy = P(pl["x"], pl["y"])
                d.ellipse([cx - rr * scale, cy - rr * scale, cx + rr * scale, cy + rr * scale], fill=col, outline="black")
            else:
                hw, hh, a = s["body"]["width"] / 2, s["body"]["height"] / 2, pl["angle"]
                pts = [(pl["x"] + u * math.cos(a) - v * math.sin(a), pl["y"] + u * math.sin(a) + v * math.cos(a)) for u, v in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]
                d.polygon([P(*p) for p in pts], fill=col, outline="black")
        d.text((8, 6), f"t = {f['t']:.2f} s", fill="black")
        tiles.append(im)
    cols = 2
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (W * cols, H * rows), "white")
    for i, im in enumerate(tiles):
        sheet.paste(im, ((i % cols) * W, (i // cols) * H))
    sheet.save(out)


if __name__ == "__main__":
    params = json.load(open(sys.argv[1])) if sys.argv[1] != "-" else {}
    doc, P, track = check.run(params)
    times = [float(t) for t in sys.argv[3:]] or [0.0, 0.6, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0]
    draw(doc, track, times, sys.argv[2])
    print(json.dumps(check.summarize(doc, P, track)))
