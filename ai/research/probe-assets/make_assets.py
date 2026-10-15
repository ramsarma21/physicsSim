"""Builds the fixed test images used by ai/research/probe.mjs.

Run once (deterministic): python3 ai/research/probe-assets/make_assets.py
Each image has a known answer so the probe can tell a model that really sees
the picture from one that guesses:
  shapes-a-1536.jpg  3 red circles + 2 blue squares   (5 shapes)
  shapes-b-1536.jpg  4 green triangles                (4 shapes)
  shapes-c-1536.jpg  6 purple circles                 (6 shapes)
  shapes-d-1536.jpg  2 orange rectangles              (2 shapes)
  shapes-a-512.jpg   shapes-a downscaled (sweep)
  scene-1536.jpg     a real 3D render of the app (7 dominoes, 2 balls)
  heavy-1536.jpg     photo-like noisy texture (~1 MB) for payload-size tests
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
W, H = 1536, 1024
BG = (244, 241, 234)


def canvas():
    return Image.new('RGB', (W, H), BG)


def save(img, name, q=85):
    img.save(os.path.join(HERE, name), 'JPEG', quality=q, optimize=True)


def circle(d, cx, cy, r, fill):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=(40, 40, 40), width=4)


def main():
    a = canvas(); d = ImageDraw.Draw(a)
    for cx, cy, r in [(250, 330, 110), (640, 700, 140), (1250, 300, 90)]:
        circle(d, cx, cy, r, (210, 40, 40))
    for x, y, s in [(900, 520, 220), (180, 680, 170)]:
        d.rectangle([x, y, x + s, y + s], fill=(40, 90, 210), outline=(40, 40, 40), width=4)
    save(a, 'shapes-a-1536.jpg')
    a.resize((512, 341), Image.LANCZOS).save(os.path.join(HERE, 'shapes-a-512.jpg'), 'JPEG', quality=85)

    b = canvas(); d = ImageDraw.Draw(b)
    for cx, cy, s in [(260, 300, 200), (700, 760, 240), (1100, 280, 180), (1300, 760, 200)]:
        d.polygon([(cx, cy - s // 2), (cx - s // 2, cy + s // 2), (cx + s // 2, cy + s // 2)],
                  fill=(40, 160, 70), outline=(40, 40, 40), width=4)
    save(b, 'shapes-b-1536.jpg')

    c = canvas(); d = ImageDraw.Draw(c)
    for cx, cy in [(200, 250), (600, 220), (1050, 300), (350, 750), (800, 650), (1300, 780)]:
        circle(d, cx, cy, 95, (130, 60, 170))
    save(c, 'shapes-c-1536.jpg')

    dd = canvas(); d = ImageDraw.Draw(dd)
    d.rectangle([150, 200, 700, 480], fill=(240, 140, 30), outline=(40, 40, 40), width=4)
    d.rectangle([850, 560, 1400, 860], fill=(240, 140, 30), outline=(40, 40, 40), width=4)
    save(dd, 'shapes-d-1536.jpg')

    src = os.path.join(ROOT, 'research', 'framing-shots', 'fr-before-rube-goldberg-1920x1080.png')
    s = Image.open(src).convert('RGB').resize((1536, 864), Image.LANCZOS)
    save(s, 'scene-1536.jpg')

    rnd = random.Random(7)
    hv = Image.effect_noise((1536, 1536), 90).convert('RGB')
    tint = Image.new('RGB', hv.size, (rnd.randint(90, 160), rnd.randint(90, 160), rnd.randint(90, 160)))
    hv = Image.blend(hv, tint, 0.35).filter(ImageFilter.GaussianBlur(0.6))
    save(hv, 'heavy-1536.jpg', q=90)

    for n in sorted(os.listdir(HERE)):
        if n.endswith('.jpg'):
            p = os.path.join(HERE, n)
            print(n, Image.open(p).size, os.path.getsize(p), 'bytes')


if __name__ == '__main__':
    main()
