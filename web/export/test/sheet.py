# A contact sheet for direct-e2e.mjs: one row per shot (its header line, its frames taken from the MP4, then today's Wide at its middle
# moment). python3 -I sheet.py <spec.json> with {rows: [{head, files: [jpg...], wide: jpg}], out}. Needs Pillow.
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

spec = json.load(open(sys.argv[1]))
rows = spec["rows"]
TW = 384
first = next((f for r in rows for f in r["files"]), None)
w0, h0 = Image.open(first).size if first else (1280, 720)
TH = round(TW * h0 / w0)
CAP = 30
GAP = 6
cols = max(len(r["files"]) for r in rows) + 1
sheet = Image.new("RGB", (GAP + cols * (TW + GAP), GAP + len(rows) * (TH + CAP + GAP)), (11, 12, 15))
d = ImageDraw.Draw(sheet)
font = None
for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"]:
    if os.path.exists(p):
        try:
            font = ImageFont.truetype(p, 15)
            break
        except Exception:
            pass
font = font or ImageFont.load_default()
for r, row in enumerate(rows):
    y = GAP + r * (TH + CAP + GAP)
    d.text((8, y + 7), row["head"][:200], fill=(232, 232, 232), font=font)
    for k, f in enumerate(row["files"]):
        sheet.paste(Image.open(f).convert("RGB").resize((TW, TH), Image.LANCZOS), (GAP + k * (TW + GAP), y + CAP))
    if row.get("wide") and os.path.exists(row["wide"]):
        x = GAP + (cols - 1) * (TW + GAP)
        sheet.paste(Image.open(row["wide"]).convert("RGB").resize((TW, TH), Image.LANCZOS), (x, y + CAP))
        d.rectangle([x, y + CAP, x + 96, y + CAP + 22], fill=(0, 0, 0))
        d.text((x + 5, y + CAP + 3), "today's Wide", fill=(255, 255, 255), font=font)
sheet.save(spec["out"], quality=88)
