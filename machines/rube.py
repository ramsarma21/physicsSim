"""Writes the Rube Goldberg scene document from a handful of numbers (playground copy only).

usage: python3 rube.py [params.json] [out.json]
Chain: a hand drops ball 1 onto ramp 1 -> it bounces/rolls onto ramp 2 -> rolls along the floor into a
row of dominoes -> the last domino falls on a seesaw's raised end -> the seesaw flings ball 2 into a box.
Units: meters, degrees in params (radians in the document). Floor surface is y = 0.
"""
import hashlib
import json
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCENES = os.path.join(os.path.dirname(HERE), "scenes")

DEFAULTS = {
    "ball_type": "rubber",          # rubber | plastic | clay  (ball 1)
    "ball1_attached": 0,            # 1: ball 1 is held drop_height above ramp 1 at drop_x; 0: it is held at (ball1_x, ball1_y)
    "drop_x": 0.0, "drop_height": 0.06,   # ball 1's start, height above ramp 1's surface below it
    "ball1_x": None, "ball1_y": None,     # filled in below from the attached default
    "ramp1_angle": -14.0, "ramp1_top_x": -0.12, "ramp1_top_y": 0.688, "ramp1_length": 0.62,
    "ramp2_angle": -19.757, "ramp2_length": 1.25,
    "ramp2_attached": 0,            # 1: ramp 2's top end hangs off ramp 1's low end by (ramp2_dx, ramp2_dy); 0: it stands at (ramp2_top_x, ramp2_top_y)
    "ramp2_dx": 0.044, "ramp2_dy": -0.102,
    "ramp2_top_x": None, "ramp2_top_y": None,   # filled in below: where the attached default puts it, so both give the same machine
    "ramp2_to_floor": 1,            # 1: ramp 2 runs right down to the floor (its length follows), so ball 1 rolls off it, not flies
    "dominoes": 7, "domino_x": 1.822, "domino_height": 0.098, "domino_growth": 1.193, "domino_spacing": 0.568,  # spacing in domino heights
    "seesaw_attached": 0,           # 1: the seesaw stands seesaw_gap after the last domino; 0: its pivot stands at seesaw_x
    "seesaw_gap": 0.078, "seesaw_x": None, "seesaw_tilt": 12.452, "seesaw_length": 0.598, "seesaw_pivot": -0.046,
    "box_x": 2.735, "box_y": 0.19, "box_width": 0.26, "box_wall": 0.13,
    "seconds": 4.5,
}

def ramp1_end(P):
    a = math.radians(P["ramp1_angle"])
    return (P["ramp1_top_x"] + P["ramp1_length"] * math.cos(a), P["ramp1_top_y"] + P["ramp1_length"] * math.sin(a))


R_BALL = 0.03


def ramp1_surface(P, x):
    """Height of ramp 1's top surface at x (on its line)."""
    return P["ramp1_top_y"] + (x - P["ramp1_top_x"]) * math.tan(math.radians(P["ramp1_angle"]))


def held_above_ramp1(P):
    """Ball 1's centre when held drop_height above ramp 1 at drop_x."""
    a1 = math.radians(P["ramp1_angle"])
    return P["drop_x"], ramp1_surface(P, P["drop_x"]) + R_BALL / math.cos(a1) + P["drop_height"]


def domino_row(P):
    """[(x, height, thickness)] of each domino, first to last."""
    xs, h, row = P["domino_x"], P["domino_height"], []
    for i in range(int(P["dominoes"])):
        dt = h / 6
        if i:
            xs += P["domino_spacing"] * row[-1][1]
        row.append((xs, h, dt))
        h *= P["domino_growth"]
    return row


def seesaw_left_arm(P):
    return (P["seesaw_length"] / 2 + P["seesaw_pivot"]) * math.cos(math.radians(P["seesaw_tilt"]))


def seesaw_after_row(P):
    """The pivot's x when the seesaw stands seesaw_gap after the last domino."""
    last_x, _, dt = domino_row(P)[-1]
    return last_x + dt / 2 + P["seesaw_gap"] + seesaw_left_arm(P)


_e1 = ramp1_end(DEFAULTS)
DEFAULTS["ramp2_top_x"], DEFAULTS["ramp2_top_y"] = _e1[0] + DEFAULTS["ramp2_dx"], _e1[1] + DEFAULTS["ramp2_dy"]
DEFAULTS["ball1_x"], DEFAULTS["ball1_y"] = held_above_ramp1(DEFAULTS)
DEFAULTS["seesaw_x"] = seesaw_after_row(DEFAULTS)

BALLS = {
    "rubber": dict(words="a red solid rubber ball", material="solid rubber", fill="#d22", sprite="rubber"),
    "plastic": dict(words="a smooth yellow hollow plastic ball with no holes", material="hollow plastic", fill="#f2c230", sprite="plastic", wall=0.0006),
    "clay": dict(words="a green ball of modeling clay", material="modeling clay", fill="#5a9b4a", sprite="clay"),
}

CORD = 2.6   # m, long enough to leave the top of the picture

DOMINO = "domino wood"   # short: the Blender add-on keys each tunable "<pair>: <label>", at most 63 characters
WOOD = {"fill": "#c8955a", "shade": "#a8743f"}
LIGHT_WOOD = {"fill": "#d7a86e", "shade": "#b07a42"}


def slab(id_, words, w, h, x, y, kind="static", angle=0.0, depth=0.3, look=WOOD, layer=1, **extra):
    p = {"kind": kind, "id": id_, "words": words, "body": {"kind": "slab", "width": round(w, 5), "height": round(h, 5), "depth": depth},
         "material": "varnished hardwood", "at": {"x": round(x, 5), "y": round(y, 5)}, "placeholder": {"fill": look["fill"]},
         "render": {"kind": "procedural", "shade": look["shade"]}, "depth": layer}
    if angle:
        p["angle"] = round(angle, 6)
    p.update(extra)
    return p


def build(params):
    P = dict(DEFAULTS, **(params or {}))
    src_three = json.load(open(os.path.join(SCENES, "three-balls.json")))
    src_drop = json.load(open(os.path.join(SCENES, "ball-drop.json")))
    r = 0.03
    solids = []
    # floor and walls
    solids.append(slab("floor", "a varnished hardwood floor", 3.7, 0.15, 1.3, -0.075, depth=2, layer=0))
    solids.append(slab("wall-left", "a varnished hardwood wall on the left", 0.05, 1.4, -0.52, 0.7, layer=0))
    solids.append(slab("wall-right", "a varnished hardwood wall on the right", 0.05, 1.4, 3.12, 0.7, layer=0))
    # ramps, each placed by its top (left) end
    def ramp(id_, words, tx, ty, ang, length):
        a = math.radians(ang)
        ux, uy = math.cos(a), math.sin(a)
        nx, ny = -uy, ux                              # the surface normal (up)
        cx, cy = tx + ux * length / 2 - nx * 0.011, ty + uy * length / 2 - ny * 0.011   # (tx, ty) is the top surface's left end
        solids.append(slab(id_, words, length, 0.022, cx, cy, angle=a, look=LIGHT_WOOD))
        return (tx + ux * length, ty + uy * length)
    e1 = ramp("ramp1", "a tilted varnished hardwood plank (ramp 1)", P["ramp1_top_x"], P["ramp1_top_y"], P["ramp1_angle"], P["ramp1_length"])
    if P.get("ramp2_attached"):
        t2 = (e1[0] + P["ramp2_dx"], e1[1] + P["ramp2_dy"])
    else:
        t2 = (P["ramp2_top_x"], P["ramp2_top_y"])
    P["ramp2_top_x"], P["ramp2_top_y"] = t2
    P["ramp2_dx"], P["ramp2_dy"] = t2[0] - e1[0], t2[1] - e1[1]
    if P["ramp2_to_floor"]:
        P["ramp2_length"] = round(t2[1] / math.sin(-math.radians(P["ramp2_angle"])), 4)
    e2 = ramp("ramp2", "a tilted varnished hardwood plank (ramp 2)", t2[0], t2[1], P["ramp2_angle"], P["ramp2_length"])
    P["ramp2_end_x"] = round(e2[0], 4)
    # dominoes, each growing by domino_growth (a domino can topple one about 1.5 times its size)
    dom = domino_row(P)
    for i, (xs, h, dt) in enumerate(dom):
        dd = h / 2
        solids.append(slab(f"domino{i + 1}", "a wooden domino block", dt, h, xs, h / 2, kind="dynamic", depth=dd, look=LIGHT_WOOD, layer=2, material=DOMINO))
    last_x, _, dt = dom[-1]
    # seesaw: plank hinged to the world at its pivot, right end down resting on the floor, a lip at the right end
    L, th = P["seesaw_length"], 0.012
    tilt = math.radians(P["seesaw_tilt"])
    off = P["seesaw_pivot"]                      # pivot offset from the plank's centre, along the plank (m)
    right = L / 2 - off                           # pivot to the right end
    cy = right * math.sin(tilt) + (th / 2) * math.cos(tilt)
    left = L / 2 + off                            # pivot to the left end
    cx = seesaw_after_row(P) if P.get("seesaw_attached") else P["seesaw_x"]
    P["seesaw_x"], P["seesaw_gap"] = cx, cx - left * math.cos(tilt) - (last_x + dt / 2)
    plank_center = (cx - off * math.cos(tilt), cy + off * math.sin(tilt))   # plank centre in the world (plank turned by -tilt)
    solids.append(slab("fulcrum", "a wooden fulcrum block", 0.026, cy - th / 2 - 0.004, cx, (cy - th / 2 - 0.004) / 2, layer=1))
    solids.append(slab("seesaw", "a thin varnished hardwood seesaw plank", L, th, plank_center[0], plank_center[1], kind="dynamic", angle=-tilt, depth=0.04, layer=2,
                       pivot={"x": round(off, 5), "y": 0.0}))
    solids.append(slab("seesaw-lip", "a small wooden lip at the seesaw's end", 0.008, 0.026, L / 2 - 0.004, th / 2 + 0.013, kind="dynamic", depth=0.04, layer=2, parent="seesaw"))
    # ball 2 on the plank against the lip (world position from the tilted plank)
    lx, ly = L / 2 - 0.008 - r - 0.001, th / 2 + r + 0.0005
    b2x = plank_center[0] + lx * math.cos(-tilt) - ly * math.sin(-tilt)
    b2y = plank_center[1] + lx * math.sin(-tilt) + ly * math.cos(-tilt)
    p2 = BALLS["plastic"]
    solids.append({"kind": "dynamic", "id": "ball2", "words": p2["words"], "body": {"kind": "ball", "radius": r, "wall": p2["wall"]}, "material": p2["material"],
                   "at": {"x": round(b2x, 5), "y": round(b2y, 5)}, "placeholder": {"fill": p2["fill"]}, "render": {"kind": "rigid"}, "sprite": "plastic", "depth": 3})
    # the box on a post
    bw, bwall, bt = P["box_width"], P["box_wall"], 0.012
    bx, by = P["box_x"], P["box_y"]              # by = the box floor's top surface
    solids.append(slab("box-floor", "the box's wooden floor", bw, bt, bx, by - bt / 2, look=WOOD, layer=1))
    solids.append(slab("box-left", "the box's left wall", bt, bwall, bx - bw / 2 + bt / 2, by + bwall / 2, look=WOOD, layer=1))
    solids.append(slab("box-right", "the box's right wall", bt, bwall, bx + bw / 2 - bt / 2, by + bwall / 2, look=WOOD, layer=1))
    # the box hangs on two cords: drawn only (animated parts collide with nothing), running up out of the picture
    cords = []
    for side, cx_ in (("l", bx - bw / 2 + bt / 2), ("r", bx + bw / 2 - bt / 2)):
        cords.append({"kind": "animated", "id": f"box-cord-{side}", "words": "a thin cord holding the box", "sprite": "cord",
                      "vector": [{"id": "cord", "tag": "rect", "attrs": {"x": -0.0015, "y": 0, "width": 0.003, "height": CORD, "fill": "#555"}}],
                      "at": {"x": round(cx_, 5), "y": round(by + bwall, 5)}, "keys": [], "depth": 0})
    # ball 1, held by the hand
    b1 = BALLS[P["ball_type"]]
    a1 = math.radians(P["ramp1_angle"])
    bx1, drop_y = held_above_ramp1(P) if P.get("ball1_attached") else (P["ball1_x"], P["ball1_y"])
    P["ball1_x"], P["ball1_y"] = bx1, drop_y
    P["drop_x"], P["drop_height"] = bx1, drop_y - ramp1_surface(P, bx1) - r / math.cos(a1)
    ball1 = {"kind": "dynamic", "id": "ball1", "words": b1["words"], "body": {"kind": "ball", "radius": r}, "material": b1["material"],
             "at": {"x": round(bx1, 5), "y": round(drop_y, 5)}, "placeholder": {"fill": b1["fill"]}, "render": {"kind": "rigid"}, "sprite": b1["sprite"], "depth": 4}
    if "wall" in b1:
        ball1["body"]["wall"] = b1["wall"]
    solids.append(ball1)
    hand = json.loads(json.dumps(src_drop["organic"][0]))
    hand["at"] = {"x": round(bx1, 5), "y": round(drop_y, 5)}
    hand["depth"] = 5

    materials = dict(src_three["materials"])
    materials[DOMINO] = {"density": 700, "source": "Hardwood, as the table; its own material so domino-on-domino contact can differ from domino-on-table."}
    contacts = [dict(c) for c in src_three["contacts"]]
    for c in contacts:
        pair = set(c["between"])
        if pair == {"solid rubber", "varnished hardwood"}:
            # A superball grips, winds up and springs back sideways: e_x 0.49 (no incoming spin, 54 deg) to
            # 0.76 (with backspin), and acts during the bounce as if friction were at least 0.9.
            c["tangentRestitution"], c["grip"] = 0.55, 0.9
            c["source"] += " Sideways restitution e_x 0.49-0.76 and bounce grip >= 0.9: Cross, Am. J. Phys. 70, 482 and 1093 (2002); Garwin, Am. J. Phys. 37, 88 (1969)."
        elif pair == {"hollow plastic", "varnished hardwood"}:
            # 0.69 came from bounce heights, which already include air drag; the engine adds drag itself, so the
            # impact restitution that gives the measured 43.6 cm from 92 cm is about 0.75.
            c["restitution"], c["tangentRestitution"] = 0.75, 0.15
            c["source"] += " Restitution 0.75 is that bounce with the engine's own air drag taken out. Sideways restitution 0.15 provisional (thin shells keep little sideways spring)."
    for c in [c for c in contacts if "varnished hardwood" in c["between"] and set(c["between"]) != {"varnished hardwood"}]:
        other = c["between"][0] if c["between"][1] == "varnished hardwood" else c["between"][1]
        contacts.append({**c, "between": [other, DOMINO]})
    contacts.append({"between": [DOMINO, DOMINO], "friction": 0.1, "restitution": 0.3, "rollingResistance": 0.0,
                     "source": "Calibrated: with these the engine's wave along 51.6 x 25.5 x 7.9 mm dominoes at gap/H 0.53 runs 1.49 sqrt(gH), Larham's measured 1.50 (Demonic dominoes, arXiv:1302.3311, Table 1)."})
    contacts.append({"between": [DOMINO, "varnished hardwood"], "friction": 0.4, "restitution": 0.3, "rollingResistance": 0.0,
                     "source": "Provisional: dry wood on wood friction 0.25-0.5 (Engineering ToolBox); keeps dominoes from sliding on the table."})
    contacts.append({"between": ["varnished hardwood", "varnished hardwood"], "friction": 0.4, "restitution": 0.3, "rollingResistance": 0.0,
                     "source": "Provisional: dry wood on wood friction 0.25-0.5 (Engineering ToolBox, Friction and Friction Coefficients); restitution provisional."})
    for m in ("solid rubber", "hollow plastic", "modeling clay"):
        contacts.append({"between": [m, "hollow plastic"] if m != "hollow plastic" else ["hollow plastic", "hollow plastic"],
                         "friction": 0.4, "restitution": 0.6 if m != "modeling clay" else 0.05, "rollingResistance": 0.0, "source": "Provisional (ball on ball)."})

    # contact values changed by hand (the web app's Materials section): {"a|b": {"restitution": .., ...}}
    for key, vals in (P.get("contacts") or {}).items():
        pair = set(key.split("|"))
        for c in contacts:
            if set(c["between"]) == pair:
                for k in ("friction", "restitution", "rollingResistance", "tangentRestitution", "grip"):
                    if k in vals:
                        c[k] = float(vals[k])

    # sprites: copy the ones used beside the document
    rdir = os.path.join(SCENES, "rube", "sprites")
    os.makedirs(rdir, exist_ok=True)
    sprites = {}
    for key, rec, base in [(k, src_three["sprites"][k], "three-balls") for k in ("rubber", "plastic", "clay")] + \
                           [(k, src_drop["sprites"][k], "ball-drop") for k in ("hand-holding", "hand-opening", "hand-open")]:
        srcf = os.path.join(SCENES, rec["file"])
        dst = os.path.join(rdir, os.path.basename(rec["file"]))
        if not os.path.exists(dst):
            shutil.copyfile(srcf, dst)
        rec = dict(rec)
        rec["file"] = f"rube/sprites/{os.path.basename(rec['file'])}"
        rec["sha256"] = hashlib.sha256(open(dst, "rb").read()).hexdigest()
        sprites[key] = rec

    cord_png = os.path.join(rdir, "cord.png")
    k = 0.0006
    if not os.path.exists(cord_png):
        from PIL import Image
        Image.new("RGBA", (5, int(CORD / k)), (85, 85, 85, 255)).save(cord_png)
    import struct
    cw, ch = struct.unpack(">II", open(cord_png, "rb").read()[16:24])   # the PNG header's size: no imaging library needed (Blender's Python has none)
    sprites["cord"] = {"file": "rube/sprites/cord.png", "sha256": hashlib.sha256(open(cord_png, "rb").read()).hexdigest(), "width": cw, "height": ch,
                       "kx": CORD / ch * cw / cw * (0.003 / (cw * (CORD / ch))) if False else 0.003 / cw, "ky": CORD / ch, "ox": -0.0015, "oy": CORD}
    ppm = 1536 / 3.75
    doc = {"version": 1, "id": "rube-goldberg",
           "camera": {"canvas": {"width": 1536, "height": 1024}, "origin": {"x": 0, "y": 0}, "pixel": {"x": round(0.56 * ppm), "y": 960}, "pixelsPerMeter": round(ppm, 3)},
           "materials": materials, "contacts": contacts, "solids": solids, "animated": cords, "organic": [hand],
           "release": {"parts": ["ball1"], "at": 0.5, "holder": {"id": "hand", "from": "holding", "via": [{"pose": "opening", "seconds": 0.08}], "to": "open"}},
           "seconds": P["seconds"], "sprites": sprites}
    return doc, P


NAMES = {"floor": "the table", "wall-left": "the left wall", "wall-right": "the right wall", "ramp1": "ramp 1", "ramp2": "ramp 2",
         "fulcrum": "the seesaw", "seesaw": "the seesaw", "seesaw-lip": "the seesaw", "ball1": "ball 1", "ball2": "ball 2",
         "box-floor": "the box", "box-left": "the box", "box-right": "the box"}


def _name(pid):
    return NAMES.get(pid, "the dominoes" if pid.startswith("domino") else pid)


def _world(doc):
    """Each solid's world pose at the start (a part fixed to a parent is placed in the parent's frame)."""
    by = {s_["id"]: s_ for s_ in doc["solids"]}
    out = {}
    for s_ in doc["solids"]:
        x, y, a = s_["at"]["x"], s_["at"]["y"], s_.get("angle", 0.0)
        if "parent" in s_:
            q = by[s_["parent"]]
            qa = q.get("angle", 0.0)
            x, y = q["at"]["x"] + x * math.cos(qa) - y * math.sin(qa), q["at"]["y"] + x * math.sin(qa) + y * math.cos(qa)
            a += qa
        out[s_["id"]] = (x, y, a)
    return out


def _corners(s_, pose):
    x, y, a = pose
    hw, hh = s_["body"]["width"] / 2, s_["body"]["height"] / 2
    c, n = math.cos(a), math.sin(a)
    return [(x + px * c - py * n, y + px * n + py * c) for px, py in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]


def _overlap_depth(sa, pa, sb, pb):
    """How deep two solids interpenetrate at the start, m (0 if apart)."""
    ka, kb = sa["body"]["kind"], sb["body"]["kind"]
    if ka == "ball" and kb == "ball":
        return max(0.0, sa["body"]["radius"] + sb["body"]["radius"] - math.hypot(pa[0] - pb[0], pa[1] - pb[1]))
    if ka == "ball" or kb == "ball":
        (sc, pc), (sr, pr) = ((sa, pa), (sb, pb)) if ka == "ball" else ((sb, pb), (sa, pa))
        dx, dy = pc[0] - pr[0], pc[1] - pr[1]
        c, n = math.cos(-pr[2]), math.sin(-pr[2])
        lx, ly = dx * c - dy * n, dx * n + dy * c
        hw, hh = sr["body"]["width"] / 2, sr["body"]["height"] / 2
        qx, qy = max(-hw, min(hw, lx)), max(-hh, min(hh, ly))
        inside = abs(lx) <= hw and abs(ly) <= hh
        d = math.hypot(lx - qx, ly - qy)
        return sc["body"]["radius"] + (min(hw - abs(lx), hh - abs(ly)) if inside else -d) if inside or d < sc["body"]["radius"] else 0.0
    A, B = _corners(sa, pa), _corners(sb, pb)
    depth = float("inf")
    for poly in (A, B):
        for i in range(4):
            (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % 4]
            ax, ay = -(y2 - y1), x2 - x1
            m = math.hypot(ax, ay)
            ax, ay = ax / m, ay / m
            pA = [px * ax + py * ay for px, py in A]
            pB = [px * ax + py * ay for px, py in B]
            o = min(max(pA), max(pB)) - max(min(pA), min(pB))
            if o <= 0:
                return 0.0
            depth = min(depth, o)
    return depth


def overlaps(doc, P=None, tol=0.003):
    """Plain-language warnings for parts that start inside one another (deeper than tol)."""
    world = _world(doc)
    solids = doc["solids"]
    to_floor = (P or {}).get("ramp2_to_floor", 1)
    seen, out = set(), []
    for i, a in enumerate(solids):
        for b in solids[i + 1:]:
            na, nb = _name(a["id"]), _name(b["id"])
            if na == nb:
                continue
            pair = frozenset((a["id"], b["id"]))
            if pair == frozenset(("ramp2", "floor")) and to_floor:
                continue
            if pair == frozenset(("ramp1", "floor")) or pair == frozenset(("fulcrum", "floor")) or {a["id"], b["id"]} <= {"floor", "wall-left", "wall-right"}:
                continue
            if _overlap_depth(a, world[a["id"]], b, world[b["id"]]) > tol:
                key = frozenset((na, nb))
                if key in seen:
                    continue
                seen.add(key)
                if b["kind"] == "dynamic" and a["kind"] != "dynamic":
                    na, nb = nb, na
                moving = a["kind"] == "dynamic" or b["kind"] == "dynamic"
                many = na == "the dominoes"
                subject = na[0].upper() + na[1:]
                if moving:
                    out.append(f"{subject} start{'' if many else 's'} inside {nb}: {'they' if many else 'it'}'ll be shoved out at the start")
                else:
                    out.append(f"{subject} and {nb} overlap")
    return out


if __name__ == "__main__":
    params = json.load(open(sys.argv[1])) if len(sys.argv) > 1 and sys.argv[1] != "-" else {}
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SCENES, "rube-goldberg.json")
    doc, _ = build(params)
    json.dump(doc, open(out, "w"), indent="\t", ensure_ascii=False)
    print(out)
