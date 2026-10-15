"""Guard for machines/catalog_everyday.py: every everyday object, alone on the table, built with items.build and run through
research/poc/dense_track.ts (120 Hz), as machines/test_rg.py and test_catalog.py do.
usage: python3 machines/test_everyday.py [type-key ...]      (prints a pass/fail table and PASS or FAIL; exits 1 on failure)

Per type
  schema    description, source, tags, facts, anchor filled; props have ranges holding their defaults; edit handles are kinds the editor
            implements and name props the type has; its category exists; the preview builds with solids; no other module's type was replaced,
  weight    what is built weighs the stated weight, ±1% (both states of a can or bottle), and the facts line says that weight,
  runs      no NaN, no speed above 30 m/s, nothing dynamic sinks more than 2 cm into the table,
  stands    dropped 2 cm onto the table, it stays the way up it was (within 3°; an egg, which settles tilted 8.85° as a real one does, within 25°) and stays within 5 cm of where it landed,
  rests     and then it lies still: from 1 s to 4 s after the start it moves less than 0.5 mm along the table and turns less than 0.005 rad (a welded compound whose pieces push
            on each other through their contact skin creeps and turns for ever: the rubber duck did, at 3 mm/s),
  rolls     (the round bodies) released on a 5° slope it rolls without slipping with the acceleration (g (sin 5° - Crr cos 5°) - air drag / m) / (1 + k) ±15%,
            k its inertia over m r², Crr the rolling resistance of its contact with the table, and goes at least 0.5 m,
  shape     (the bowling pin) its outline is the USBC diameter-by-height table to within 0.8 mm in radius, its centre of gravity is within the USBC window (142.9-150.8 mm above the foot) and it topples
            at about ten degrees; (the egg) its outline is the true egg curve to within 0.6 mm, its centre of gravity and moment of inertia are the real egg's, it rests only on its sides
            (8.85 degrees off level, pointed end down) and nowhere else; (the mug) its handle keeps a hand-sized grip (36 mm out from the wall at the default size) as the mug is
            stretched, scaled by the smaller of the two stretches,
  drops     (the egg) stood on its blunt end, on its point, level or tilted, released 0.5 mm or 3 cm above the table, it topples and ends lying on a side, 8.85 degrees off level, still;
            rounder eggs (57 mm long, 49, 50 and 57 wide) dropped 3 cm at 45 to 135 degrees end, still, within 3 degrees of one of their true rests (on a side, or stood on the blunt end);
            eggs asked to be wider than long (57 mm long and 1.1, 1.14, 1.22 and 1.26 times as wide, 114 x 130 mm, 200 x 220 mm), which are built as wide as long, set down 0.5 mm
            above the table at 0 to 300 degrees (on the point at 270) and run 40 s, end still within 3 degrees of a true rest of the egg as built;
            small round eggs just past the switch to balls (11.4 to 20 mm long, width over length 0.815 to 0.83) dropped 3 cm at 8 angles, and eggs asked to be thinner than
            0.55 of their length and the slider corners, stood on either end or tilted 45 degrees 0.5 mm and 3 cm up, never go faster than 3 m/s, keep their solids within
            0.5 mm of one another and end still (30 mm and longer, within 3 degrees of a true rest),
  shapes    (the egg) at every shape the sliders make (width over length 0.4 to 1.3, the slider corners, round eggs of other sizes) it rests only where the true curve does,
            its outline, centre of gravity and moment of inertia are the true curve's, and no two of its solids that overlap can collide (welded, or joined by a hidden pin); asked
            to be wider than long, it is built (and resolves) as wide as it is long, and asked to be narrower than 0.55 of its length, as 0.55 of it; every length and width step
            of the sliders builds,
  extremes  every corner of the size sliders (each number at its min and max) builds: no outline side under the engine's 0.5 mm,
  catches   (the open containers) an orange dropped above one ends up inside it; (the coffee mug, which is a cup you can move) a 25 mm steel ball dropped into it stays in it.
Documents are written to scenes/.test-everyday-* and removed, as the other tests do.
"""
import concurrent.futures as cf
import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import items  # noqa: E402
import catalog_everyday as ev  # noqa: E402

STAGE = {"x0": -0.55908203125, "x1": 3.19091796875, "y0": -0.15625, "y1": 2.34375}
X0 = 1.3
TABLE_X0, TABLE_X1 = X0 - 3.7 / 2, X0 + 3.7 / 2
G = 9.81
SLOPE = math.radians(-5.0)         # the table turned 5° clockwise: it runs down to the right
EDIT_KINDS = {"length", "radius", "top", "size", "boxWidth", "rotate", "swing", "tiltEnd", "armEnd"}
ITEM = "thing"
# the types of the silhouettes group (web/models/everyday-b*.js): their size sliders must build at every corner
SILHOUETTES = {"water-bottle", "water-bottle-side", "coffee-mug", "rubber-duck", "sneaker", "egg", "bowling-pin", "traffic-cone", "stapler", "pencil", "plastic-cup", "glass-jar"}
# the everyday-shapes group's own polygon outlines (web/models/everyday-a*.js draws them): a size slider corner that the engine refuses fails the test
OWN_OUTLINES = {"pillow", "chopstick", "soda-can", "candle"}     # (the standing can's neck and the candle's taper are polygons now, not slabs)
# the shortest outline side these types may have at any slider corner, mm (the engine's own limit is 0.5): a size slider that makes a thinner side fails the test
MIN_SIDE_MM = {"chopstick": 0.6, "candle": 0.6, "soda-can": 0.55}
EXTREME_WARNINGS = []
# how far a dropped item may turn and still count as "stays the way up it was": 3 degrees, except the egg, whose centre of gravity is toward its blunt end, so (as a real egg does) it
# settles with its axis tilted 8.85 degrees, pointed end down (the true curve's normal through the centroid of its volume), and never rests level
TURN_LIMIT = {"egg": 25.0}


def table(angle_deg=0.0):
    return {"id": "table", "type": "table", "name": "Table", "x": X0, "y": 0.0, "angle": angle_deg, "props": {"width": 3.7, "thickness": 0.15}}


def scene_of(item_list, name, seconds=3.0, angle_deg=0.0):
    return {"version": 2, "id": name, "name": name, "seconds": seconds, "release": 0.5, "stage": STAGE, "items": [table(angle_deg)] + item_list, "goals": []}


# ---------------------------------------------------------------- geometry of a built item
def outline(b):
    """The corners of a slab (with its taper) or a polygon body, in the solid's own frame."""
    if b["kind"] == "polygon":
        return [(p["x"], p["y"]) for p in b["points"]]
    hw, hh, t = b["width"] / 2, b["height"] / 2, b.get("taper")
    return [(-hw * t, -hh), (hw * t, -hh), (hw, hh), (-hw, hh)] if t is not None else [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]


def extent_low(s, pose):
    """Lowest point of a solid at a pose (x, y, angle)."""
    x, y, a = pose
    b = s["body"]
    if b["kind"] == "ball":
        return y - b["radius"]
    return min(y + px * math.sin(a) + py * math.cos(a) for px, py in outline(b))


def extent_high(s, pose):
    x, y, a = pose
    b = s["body"]
    if b["kind"] == "ball":
        return y + b["radius"]
    return max(y + px * math.sin(a) + py * math.cos(a) for px, py in outline(b))


def alone(key, props=None):
    doc, _ = items.build({"stage": STAGE, "items": [{"id": ITEM, "type": key, "x": 0.0, "y": 0.0, "props": props or {}}]})
    return doc


def mass_of(s, doc):
    b = s["body"]
    d = doc["materials"][s["material"]]["density"]
    if b["kind"] == "ball":
        r, w = b["radius"], b.get("wall")
        return d * (4 / 3) * math.pi * (r ** 3 - (max(0.0, r - w) ** 3 if w is not None else 0.0))
    if b["kind"] == "polygon":
        pts = [(p["x"], p["y"]) for p in b["points"]]
        area = abs(sum(pts[k][0] * pts[(k + 1) % len(pts)][1] - pts[(k + 1) % len(pts)][0] * pts[k][1] for k in range(len(pts)))) / 2
        return d * area * b["depth"]
    return d * (1 + b.get("taper", 1)) / 2 * b["width"] * b["height"] * b["depth"]


def dynamic_solids(doc):
    return [s for s in doc["solids"] if s["kind"] == "dynamic" and s["item"] == ITEM]


def is_roller(key):
    """A round body that rolls (a can on its side, a roll): every solid it has is a ball (the egg's blunt end is a ball welded to polygons: it rocks, it does not roll)."""
    sol = dynamic_solids(alone(key))
    return bool(sol) and all(s["body"]["kind"] == "ball" for s in sol)


# ---------------------------------------------------------------- running a scene
_serial = [0]


def simulate(doc):
    _serial[0] += 1
    stem = f".test-everyday-{os.getpid()}-{_serial[0]}"
    path = os.path.join(PG, "scenes", stem + ".json")
    out = os.path.join(PG, "research", "tmp", stem + "-out.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(doc, open(path, "w"))
    try:
        r = subprocess.run(["node", "--no-warnings", os.path.join(PG, "research", "poc", "dense_track.ts"), path, "120", out], capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            raise RuntimeError(((r.stderr or r.stdout).strip().splitlines() or ["engine failed"])[-1][:200])
        return json.load(open(out))
    finally:
        for f in (path, out):
            if os.path.exists(f):
                os.remove(f)


def run(job):
    name, scene = job
    res = {"name": name, "scene": scene}
    try:
        res["doc"], _ = items.build(scene)
        res["track"] = simulate(res["doc"])
    except Exception as e:  # noqa: BLE001 (any failure is a failed row, not a crash)
        res["error"] = f"{type(e).__name__}: {e}"[:200]
    return res


def series(res, sid):
    return [(f["t"], f["placements"][sid]) for f in res["track"]["frames"]]


def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


# ---------------------------------------------------------------- the scenes
def flat_scene(key, props=None):
    """The item 2 cm above the table (a fixed one standing on it, with an orange to drop in if it is a container), run for 4 s."""
    props = props or {}
    doc = alone(key, props)
    world = items._world_poses(doc)
    low = min(extent_low(s, world[s["id"]]) for s in doc["solids"])
    high = max(extent_high(s, world[s["id"]]) for s in doc["solids"])
    static = any(s["kind"] == "static" for s in doc["solids"])
    y = round(-low + (0.0 if static else 0.02), 5)
    extra = []
    if static:
        r = items.TYPES["orange"].defaults()["diameter"] / 2
        extra.append({"id": "probe", "type": "orange", "x": X0, "y": round(y + high + 0.08 + r, 5)})
    return scene_of([{"id": ITEM, "type": key, "x": X0, "y": y, "angle": 0.0, "props": props}] + extra, key, seconds=4.0)


PROBES = {"coffee-mug": "steel-ball"}      # the movable cups: the ball dropped into each


def probe_scene(key, props=None):
    """A movable cup resting on the table (a hair above it) with a ball dropped from 6 cm above its rim down its axis."""
    props = props or {}
    doc = alone(key, props)
    world = items._world_poses(doc)
    low = min(extent_low(s, world[s["id"]]) for s in doc["solids"])
    high = max(extent_high(s, world[s["id"]]) for s in doc["solids"])
    y = round(-low + 0.0005, 5)
    pk = PROBES[key]
    r = items.TYPES[pk].defaults()["diameter"] / 2
    return scene_of([{"id": ITEM, "type": key, "x": X0, "y": y, "angle": 0.0, "props": props},
                     {"id": "probe", "type": pk, "x": X0, "y": round(y + high + 0.06 + r, 5)}], key + "-probe")


def ramp_scene(key, props=None):
    """The round body on the 5° slope, 1.3 m up it from the table's anchor, resting on the surface."""
    props = props or {}
    doc = alone(key, props)
    r = dynamic_solids(doc)[0]["body"]["radius"]
    tx, ty, nx, ny = math.cos(SLOPE), math.sin(SLOPE), -math.sin(SLOPE), math.cos(SLOPE)
    s, h = -1.3, r + 0.001
    pos = {"x": round(X0 + s * tx + h * nx, 5), "y": round(s * ty + h * ny, 5)}
    return scene_of([{"id": ITEM, "type": key, **pos, "angle": 0.0, "props": props}], key + "-ramp", angle_deg=math.degrees(SLOPE))


# ---------------------------------------------------------------- checks
def finite_speed_sink(res, tilted=False):
    doc, frames = res["doc"], res["track"]["frames"]
    ts = [f["t"] for f in frames]
    nan = any(not all(math.isfinite(v) for v in (p["x"], p["y"], p["angle"])) for f in frames for p in f["placements"].values())
    vmax, sink = 0.0, 0.0
    tx, ty, nx, ny = math.cos(SLOPE), math.sin(SLOPE), -math.sin(SLOPE), math.cos(SLOPE)
    for s in [s for s in doc["solids"] if s["kind"] == "dynamic"]:
        sid, j = s["id"], 0
        for i, a in enumerate(frames):         # speed over at least 8 ms: frames at an impact are a step or two apart
            j = max(j, i + 1)
            while j < len(frames) and ts[j] - ts[i] < 0.008:
                j += 1
            if j >= len(frames):
                break
            pa, pb = a["placements"][sid], frames[j]["placements"][sid]
            vmax = max(vmax, math.hypot(pb["x"] - pa["x"], pb["y"] - pa["y"]) / (ts[j] - ts[i]))
        for f in frames:
            p = f["placements"][sid]
            if tilted:
                sink = max(sink, s["body"]["radius"] - ((p["x"] - X0) * nx + p["y"] * ny))
            elif TABLE_X0 <= p["x"] <= TABLE_X1:
                sink = max(sink, -extent_low(s, (p["x"], p["y"], p["angle"])))
    vmax = max([vmax] + [h["speed"] for h in res["track"].get("impacts", [])])
    return {"finite": (not nan, "NaN in the track"), "speed": (vmax <= 30, f"{vmax:.1f} m/s"), "sink": (sink <= 0.02, f"sank {sink * 1000:.1f} mm")}


def weight_checks(key):
    out = {}
    if not ev.STATED[key]:          # a fixed container weighs nothing in the engine
        return out
    for props, kg in ev.STATED[key]:
        doc = alone(key, props)
        got = sum(mass_of(s, doc) for s in dynamic_solids(doc))
        out[f"weight {props or 'default'}"] = (abs(got - kg) <= 0.01 * kg, f"{got * 1000:.2f} g vs {kg * 1000:.2f} g")
    facts = items.TYPES[key].facts
    kg = ev.STATED[key][0][1]
    out["facts"] = (ev._kg(kg) in facts, f"“{facts}” should say {ev._kg(kg)}")
    return out


def end_poses(res):
    """Each of the item's dynamic solids' pose (x, y, angle) at the end of the run."""
    end = res["track"]["frames"][-1]["placements"]
    return {s["id"]: (end[s["id"]]["x"], end[s["id"]]["y"], end[s["id"]]["angle"]) for s in dynamic_solids(res["doc"])}


def stands_check(res):
    s = dynamic_solids(res["doc"])[0]
    pts = series(res, s["id"])
    p0, p1 = pts[0][1], pts[-1][1]
    turn = math.degrees(abs(wrap(p1["angle"] - p0["angle"])))
    drift = abs(p1["x"] - p0["x"])
    poses = end_poses(res)
    low = min(extent_low(x, poses[x["id"]]) for x in dynamic_solids(res["doc"]))      # (the lowest of all its solids)
    ok = turn <= TURN_LIMIT.get(s.get("itemType"), 3.0) and drift <= 0.05 and abs(low) <= 0.005
    return ok, f"turned {turn:.1f}°, moved {drift * 100:.1f} cm, rests {low * 1000:+.1f} mm from the table"


def rests_check(res):
    """From 1 s to the end (4 s) the item's main solid moves less than 0.5 mm along the table and turns less than 0.005 rad."""
    main = next(x for x in dynamic_solids(res["doc"]) if "parent" not in x)
    pts = series(res, main["id"])
    a = min(pts, key=lambda q: abs(q[0] - 1.0))[1]
    b = pts[-1][1]
    dx, da = (b["x"] - a["x"]) * 1000, wrap(b["angle"] - a["angle"])
    return abs(dx) < 0.5 and abs(da) < 0.005, f"from 1 s to {pts[-1][0]:.1f} s it moved {dx:+.2f} mm and turned {da:+.4f} rad"


def rolls_check(res):
    s = dynamic_solids(res["doc"])[0]
    b = s["body"]
    r = b["radius"]
    q = max(0.0, r - b.get("wall", r)) / r                    # a shell's inertia (2/5)(1 - q^5)/(1 - q^3), q inner over outer radius
    k = b.get("inertia", 2 / 5 * (1 + q + q ** 2 + q ** 3 + q ** 4) / (1 + q + q ** 2) if b.get("wall") is not None else 2 / 5)
    tab = next(x for x in res["doc"]["solids"] if x["kind"] == "static")
    crr = next(c["rollingResistance"] for c in res["doc"]["contacts"] if sorted(c["between"]) == sorted([s["material"], tab["material"]]))
    tx, ty = math.cos(SLOPE), math.sin(SLOPE)
    pts = series(res, s["id"])

    def pos(t):       # distance down the slope (m) and the angle turned (rad, clockwise positive) at the nearest frame to t
        _, p = min(pts, key=lambda q: abs(q[0] - t))
        return (p["x"] - X0) * tx + p["y"] * ty, -p["angle"]
    v = lambda t: (pos(t + 0.05)[0] - pos(t - 0.05)[0]) / 0.1
    a_got = (v(2.0) - v(1.0)) / 1.0
    th = -SLOPE
    # the engine's air drag, ½ρ·Cd·A·v², at the mean speed of that second: a cylinder (Cd 1.1) meets its broadside diameter × length, a sphere (0.47) its disc
    v_mean = (v(2.0) + v(1.0)) / 2
    cd_area = 1.1 * 2 * r * s["length"] if s.get("shape") == "cylinder" and "length" in s else 0.47 * math.pi * r ** 2
    drag = 0.5 * 1.2 * cd_area * v_mean ** 2 / mass_of(s, res["doc"])
    a_want = (G * (math.sin(th) - crr * math.cos(th)) - drag) / (1 + k)
    (s1, w1), (s2, w2) = pos(1.0), pos(2.0)
    slip = abs((w2 - w1) * r - (s2 - s1)) / max(abs(s2 - s1), 1e-9)
    far = abs(pos(2.9)[0] - pos(0.5)[0])
    ok = abs(a_got - a_want) <= 0.15 * a_want and slip <= 0.10 and far >= 0.5
    return ok, f"a {a_got:.3f} vs {a_want:.3f} m/s² (k {k:.3f}, Crr {crr}, drag {drag:.3f}), slip {slip * 100:.1f}%, went {far:.2f} m"


def catches_check(res):
    end = res["track"]["frames"][-1]["placements"]
    P = items.props_of({"type": res["scene"]["items"][1]["type"]})
    cont = res["scene"]["items"][1]
    p = end["probe/ball"]
    w, t, wall = P["width"], P["thickness"], P["wall"]
    ok = abs(p["x"] - X0) <= w / 2 - t and cont["y"] < p["y"] < cont["y"] + wall
    return ok, f"orange ends at x {p['x'] - X0:+.3f}, {p['y'] - cont['y']:.3f} m above the floor"


def probe_check(res):
    """The ball ends up inside the cup: between its walls and above its floor (in the cup's own frame at the end), and the cup still stands."""
    end = res["track"]["frames"][-1]["placements"]
    doc = res["doc"]
    main = next(x for x in doc["solids"] if x["item"] == ITEM and x["kind"] == "dynamic" and "parent" not in x)
    pm = end[main["id"]]
    pb = end["probe/ball"]
    dx, dy = pb["x"] - pm["x"], pb["y"] - pm["y"]
    c, sn = math.cos(-pm["angle"]), math.sin(-pm["angle"])
    lx, ly = dx * c - dy * sn, dx * sn + dy * c            # the ball in the cup's frame
    pts = [p for x in doc["solids"] if x["item"] == ITEM for p in outline(x["body"])]
    top = max(y for _, y in pts)
    ok = abs(lx) < 0.0367 and ly < top - 0.003 and ly > min(y for _, y in pts) and abs(math.degrees(wrap(pm["angle"]))) < 3.0
    return ok, f"ball ends at x {lx * 1000:+.0f} mm, y {ly * 1000:+.0f} mm in the cup (rim {top * 1000:+.0f} mm), cup turned {math.degrees(wrap(pm['angle'])):.1f}°"


def schema_check(t):
    d = t.schema()
    bad = [f for f in ("description", "source", "facts", "anchor") if not d.get(f)]
    bad += ["tags"] if not d["tags"] else []
    keys = {p["key"] for p in d["props"]}
    for p in d["props"]:
        if p["kind"] in ("number", "int") and (p.get("min") is None or p.get("max") is None or not p["min"] <= p["default"] <= p["max"]):
            bad.append(f"range of {p['key']}")
    for e in d["edit"]:
        if e["kind"] not in EDIT_KINDS:
            bad.append(f"handle {e['kind']}")
        bad += [f"handle prop {e[k]}" for k in ("prop", "w", "h", "length") if k in e and e[k] not in keys]
    if d["category"] not in items.CATEGORIES:
        bad.append("category")
    try:
        if not items.preview(t.key).get("solids"):
            bad.append("preview")
    except Exception as e:  # noqa: BLE001
        bad.append(f"preview ({type(e).__name__}: {e})")
    return (not bad), ("missing: " + ", ".join(bad)) if bad else ""


def extremes_check(key):
    """Every corner of the type's size sliders (each number at its minimum and its maximum, each tick box both ways) builds: the engine refuses an outline with a side under
    0.5 mm, and a small enough pencil, mug or duck made one."""
    import itertools
    d = items.TYPES[key].schema()
    axes = []
    for p in d["props"]:
        if p["kind"] == "bool":
            axes.append((p["key"], [True, False]))
        elif p["kind"] in ("number", "int") and p["key"] not in ("bounce", "friction", "rolling", "side", "mass"):
            axes.append((p["key"], [p["min"], p["max"]]))
    bad = []
    for combo in itertools.product(*[v for _, v in axes]):
        props = {k: v for (k, _), v in zip(axes, combo)}
        try:
            doc = alone(key, props)
            side = min((math.dist(q[k], q[(k + 1) % len(q)]) * 1000 for s in doc["solids"] if s["item"] == ITEM and s["body"]["kind"] == "polygon"
                        for q in [[(p["x"], p["y"]) for p in s["body"]["points"]]] for k in range(len(q))), default=None)
            if key in MIN_SIDE_MM and side is not None and side < MIN_SIDE_MM[key]:
                bad.append((props, f"an outline side of {side:.3f} mm, under the {MIN_SIDE_MM[key]} mm this type keeps"))
        except Exception as e:  # noqa: BLE001
            bad.append((props, f"{type(e).__name__}: {e}"[:120]))
    n = 1
    for _, v in axes:
        n *= len(v)
    return (not bad), (f"{len(bad)} of {n} corners refused, first {bad[0][0]}: {bad[0][1]}" if bad else f"{n} corners")


# ---------------------------------------------------------------- shape checks (the silhouettes group's own numbers)
USBC_PIN = [(0.0, 2.031), (0.75, 2.828), (2.25, 3.906), (3.375, 4.510), (4.5, 4.766), (5.875, 4.563), (7.25, 3.703), (8.625, 2.472), (9.375, 1.965), (10.0, 1.797),
            (10.875, 1.870), (11.75, 2.094), (12.625, 2.406), (13.5, 2.547)]   # (inches above the foot, diameter in inches): USBC Equipment Specifications, "Bowling Pin Dimensions"


def _polys(doc, prefix=None):
    out = []
    for s_ in dynamic_solids(doc):
        if prefix is not None and not s_["id"].split("/")[1].startswith(prefix):
            continue
        out.append([(p["x"], p["y"]) for p in s_["body"]["points"]])
    return out


def _chord_width(poly, y):
    """Width of a convex polygon at height y (0 when it does not reach it)."""
    xs = []
    for i in range(len(poly)):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
        if (y0 - y) * (y1 - y) > 0 or y0 == y1:
            continue
        xs.append(x0 + (x1 - x0) * (y - y0) / (y1 - y0))
    return (max(xs) - min(xs)) if len(xs) >= 2 else 0.0


def pin_shape_checks():
    doc = alone("bowling-pin")
    polys = _polys(doc)
    low = min(y for p in polys for _, y in p)
    # the outline against the USBC table: its width at each station (a convex piece's chord; the union of the pieces' chords is the pin's width there)
    worst = 0.0
    for h_in, d_in in USBC_PIN[1:]:
        y = low + h_in * 0.0254
        w = max(_chord_width(p, y) for p in polys)
        worst = max(worst, abs(w - d_in * 0.0254) / 2)         # (in radius)
    # the centre of gravity (area x density of every piece) and the foot
    mx = my = mt = 0.0
    for s_, p in zip(dynamic_solids(doc), polys):
        n = len(p)
        a2 = sum(p[k][0] * p[(k + 1) % n][1] - p[(k + 1) % n][0] * p[k][1] for k in range(n))
        cy = sum((p[k][1] + p[(k + 1) % n][1]) * (p[k][0] * p[(k + 1) % n][1] - p[(k + 1) % n][0] * p[k][1]) for k in range(n)) / (3 * a2)
        m = mass_of(s_, doc)
        my += m * cy
        mt += m
    cg = (my / mt - low) * 1000
    foot = max(x for p in polys for x, y in p if abs(y - low) < 1e-6) * 1000
    topple = math.degrees(math.atan2(foot, cg))
    return {"shape: USBC table": (worst <= 0.0008, f"radius miss at the table's stations at most {worst * 1000:.2f} mm"),
            "shape: centre of gravity": (142.9 <= cg <= 150.8, f"{cg:.1f} mm above the foot (USBC 142.9 to 150.8)"),
            "shape: topple angle": (9.0 <= topple <= 11.0, f"{topple:.1f} degrees on a {2 * foot:.1f} mm foot")}


EGG_REST = 8.849          # degrees: a real egg's rest, off level, pointed end down (the true curve's normal through the centroid of its volume, 1.80 mm toward the blunt end)


def _egg_world(doc, s_):
    """A polygon solid's corners in the egg's own frame (the item alone at the origin, unturned), m."""
    px, py, pa = items._world_poses(doc)[s_["id"]]
    return [(px + p["x"] * math.cos(pa) - p["y"] * math.sin(pa), py + p["x"] * math.sin(pa) + p["y"] * math.cos(pa)) for p in s_["body"]["points"]]


def egg_outline(doc):
    """The egg's pieces in its own frame, mm: the polygons, and the ball as the circle it stands for (the engine's polygon skin reaches 1 mm out; the ball is made that much bigger)."""
    sol = dynamic_solids(doc)
    ball = next(s_ for s_ in sol if s_["body"]["kind"] == "ball")
    bx, by_, _ = items._world_poses(doc)[ball["id"]]
    polys = [[(x * 1000, y * 1000) for x, y in _egg_world(doc, s_)] for s_ in sol if s_["body"]["kind"] == "polygon"]
    return polys, (bx * 1000, by_ * 1000, ball["body"]["radius"] * 1000 - ev.EGG_SKIN)


def egg_mass_props(doc):
    """(kg, centre of gravity x mm, moment of inertia about it per kg mm^2) of the egg as built, from its solids' densities as the engine weighs them."""
    parts = []
    world = items._world_poses(doc)
    for s_ in dynamic_solids(doc):
        m = mass_of(s_, doc)
        if s_["body"]["kind"] == "ball":
            r = s_["body"]["radius"]
            parts.append((m, world[s_["id"]][0], world[s_["id"]][1], s_["body"].get("inertia", 0.4) * r * r))
        else:
            pts = _egg_world(doc, s_)
            _, cx, j = ev._plane(pts)
            _, cy, _ = ev._plane([(y, x) for x, y in reversed(pts)])      # (mirrored about x = y: its centroid x is this one's centroid y)
            parts.append((m, cx, cy, j))
    M = sum(p[0] for p in parts)
    G = sum(m * cx for m, cx, _, _ in parts) / M
    Gy = sum(m * cy for m, _, cy, _ in parts) / M
    return M, G * 1000, sum(m * (j + (cx - G) ** 2 + (cy - Gy) ** 2) for m, cx, cy, j in parts) / M * 1e6


def egg_shape_checks():
    import numpy as np
    L0, B0, w0 = 57.0, 44.0, 4.5
    prof = lambda x: (B0 / 2) * math.sqrt(max(0.0, (L0 * L0 - 4 * x * x) / (L0 * L0 + 8 * w0 * x + 4 * w0 * w0)))
    doc = alone("egg")
    polys, (cx, cy, R) = egg_outline(doc)
    th = np.linspace(0, math.pi, 1500)
    xs = -L0 / 2 * np.cos(th)
    ys = np.array([prof(x) for x in xs])
    curve = np.vstack([np.stack([xs, ys], 1), np.stack([xs, -ys], 1)])

    def sd_poly(poly, P):        # signed distance from points P to a convex counter-clockwise polygon (negative inside)
        poly = np.asarray(poly)
        d, outside = np.full(len(P), np.inf), np.full(len(P), -np.inf)
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            ab = b - a
            L = math.hypot(*ab)
            outside = np.maximum(outside, (P - a) @ (np.array([ab[1], -ab[0]]) / L))
            t = np.clip(((P - a) @ ab) / (L * L), 0, 1)
            d = np.minimum(d, np.hypot(*(P - (a + t[:, None] * ab)).T))
        return np.where(outside > 0, d, outside)
    sd = np.min([sd_poly(p, curve) for p in polys] + [np.hypot(curve[:, 0] - cx, curve[:, 1] - cy) - R], axis=0)
    worst = float(np.abs(sd).max())
    # weight, centre of gravity and moment of inertia: the real egg's (a solid of revolution of the curve: centroid 1.796 mm toward the blunt end, 259.5 mm^2 per kg about it)
    M, G, I = egg_mass_props(doc)
    # rest: the support function of the outline about the centre of gravity (the height of the centre of gravity above the table for each way down) has its minima only at the
    # two sides' rests, 8.85 degrees off level: not on either end and not level
    U = np.radians(np.arange(0, 360, 0.05))
    dirs = np.stack([np.cos(U), np.sin(U)], 1)
    Gv = np.array([G, 0.0])
    V = np.array([q for p in polys for q in p])
    rho = np.maximum(((V - Gv) @ dirs.T).max(0), R + (np.array([cx, cy]) - Gv) @ dirs.T)
    n = len(rho)
    mins = [math.degrees(U[i]) for i in range(n) if rho[i] < rho[i - 1] and rho[i] <= rho[(i + 1) % n]]
    tilts = [abs(abs(90 - (m % 180)) - 0.0) for m in mins]                    # (a rest's tilt off level: its way down is 90 +- tilt or 270 +- tilt)
    tilts = [min(abs(m - 270 - EGG_REST), abs(m - 90 + EGG_REST)) for m in mins]
    ok_rest = len(mins) == 2 and all(t <= 0.5 for t in tilts)
    out = {"shape: egg curve": (worst <= 0.6, f"outline (a ball and {len(polys)} pieces) within {worst:.2f} mm of the true egg curve"),
           "shape: egg weight": (abs(G - ev.EGG_CG) <= 0.05 and abs(I - sum(ev.EGG_I)) <= 0.01 * sum(ev.EGG_I),
                                 f"centre of gravity {G:.3f} mm from the middle (the real egg's {ev.EGG_CG}), moment of inertia {I:.1f} mm^2 per kg (the real egg's {sum(ev.EGG_I):.1f})"),
           "shape: egg rest": (ok_rest, f"rests at {', '.join(f'{m:.1f}' for m in mins)} degrees of way down (two, on its sides, {EGG_REST} degrees off level, wanted)")}
    out.update(egg_grid_checks())
    return out


# the egg's shapes the grid checks: width over length 0.4 to 1.3 at the 57 mm length (past 1 it is built as wide as long), the slider corners, and round eggs of other sizes
EGG_GRID = ([(0.057, round(0.057 * r, 5)) for r in [0.4 + 0.05 * i for i in range(19)]] + [(0.0114, 0.0088), (0.0114, 0.22), (0.285, 0.0088), (0.285, 0.22)]
            + [(0.0114, 0.00969), (0.02, 0.022), (0.04, 0.044), (0.114, 0.1), (0.285, 0.25), (0.057, 0.0467), (0.057, 0.0499), (0.057, 0.0679)]
            + [(L, L) for L in (0.0114, 0.02, 0.0285, 0.04, 0.08, 0.114, 0.16, 0.2, 0.22)])


def egg_width(L, B):
    """The width the egg is built with: at most its length (no egg is wider than it is long), at least 0.55 of it (past the most elongated birds' eggs)."""
    return max(min(B, L), ev.EGG_MIN_WIDTH * L)


def egg_support(L, B):
    """(model, true): the egg's support functions (the height of its centre of gravity above the table, mm, for each way down, every 0.05 degrees) as the engine has it (a
    polygon's 1 mm of skin, a ball at its radius, about the built centre of gravity) and of the true curve scaled to L x B (about its volume's centroid; B at most L, as the egg
    is built); and the model's outline offset (what its support stands past the drawn curve: the skin, or a ball egg's EGG_GROW)."""
    import numpy as np
    U = np.radians(np.arange(0, 360, 0.05))
    D = np.stack([np.cos(U), np.sin(U)], 1)
    doc = alone("egg", {"length": L, "width": B})
    world = items._world_poses(doc)
    sol = dynamic_solids(doc)
    parts, polys, balls = [], [], []
    for s_ in sol:
        px, py, pa = world[s_["id"]]
        m, b = mass_of(s_, doc), s_["body"]
        if b["kind"] == "ball":
            balls.append((px * 1000, py * 1000, b["radius"] * 1000))
            parts.append((m, px, py))
        else:
            pts = [(px + p["x"] * math.cos(pa) - p["y"] * math.sin(pa), py + p["x"] * math.sin(pa) + p["y"] * math.cos(pa)) for p in b["points"]]
            polys.append([(x * 1000, y * 1000) for x, y in pts])
            a2 = cxs = cys = 0.0
            for k in range(len(pts)):
                (x0, y0), (x1, y1) = pts[k], pts[(k + 1) % len(pts)]
                w = x0 * y1 - x1 * y0
                a2 += w
                cxs += (x0 + x1) * w
                cys += (y0 + y1) * w
            parts.append((m, cxs / (3 * a2), cys / (3 * a2)))
    M = sum(p[0] for p in parts)
    Gm = np.array([sum(p[0] * p[1] for p in parts) / M * 1000, sum(p[0] * p[2] for p in parts) / M * 1000])
    h = np.full(len(U), -1e9)
    for p in polys:
        h = np.maximum(h, ((np.array(p) - Gm) @ D.T).max(0) + 1.0)
    for cx, cy, R in balls:
        h = np.maximum(h, R + (np.array([cx, cy]) - Gm) @ D.T)
    sx, sy = L / 0.057, egg_width(L, B) / 0.044
    th = np.linspace(0, 2 * math.pi, 20000, endpoint=False)
    xs = -28.5 * np.cos(th)
    C = np.stack([xs * sx, np.array([ev._egg_prof(x) for x in xs]) * sy * np.sign(np.sin(th))], 1)
    ht = ((C - np.array([ev.EGG_CG * sx, 0.0])) @ D.T).max(0)
    off = ev.EGG_GROW if all(s_["body"]["kind"] == "ball" for s_ in sol if not s_["id"].endswith("/egg")) else 1.0      # (an egg made of balls; else polygons with their skin)
    return h, ht, off, Gm, doc


def egg_grid_checks():
    """The egg rests only where an egg of its shape does, at every shape the size sliders make: over EGG_GRID, every minimum of the model's support function is within 1.5 degrees
    of one of the true curve's (or the true curve is level to within 0.02 mm (x the size past 1) between them: an egg just about to stand on its point, whose side rests are microns
    deep); its outline is the true curve's within 0.7 mm (x the size past 1) up to twice the 57 x 44 mm size (beyond, the hen's egg's few pieces scale with it); its centre of
    gravity the real one's within 0.05 mm, its moment of inertia within 1.5 %; and no two of its solids that overlap can collide (a weld or a hidden pin joins them)."""
    import numpy as np
    bad_rest, bad_outline, bad_cg, bad_join = [], [], [], []
    worst_dev = worst_i = 0.0
    for L, B in EGG_GRID:
        h, ht, off, Gm, doc = egg_support(L, B)
        B = egg_width(L, B)
        n = len(h)
        mins = [i for i in range(n) if h[i] < h[i - 1] and h[i] <= h[(i + 1) % n]]
        tmins = [i for i in range(n) if ht[i] < ht[i - 1] and ht[i] <= ht[(i + 1) % n]]
        s = max(1.0, min(L / 0.057, B / 0.044))
        for i in mins:
            j = min(tmins, key=lambda q: abs((i - q + n // 2) % n - n // 2))
            if abs((i - j + n // 2) % n - n // 2) * 0.05 <= 1.5:
                continue
            lo, hi = sorted((i, j))
            seg = ht[lo:hi + 1] if hi - lo < n // 2 else np.concatenate([ht[hi:], ht[:lo + 1]])
            if float(seg.max() - ht[j]) > 0.02 * s:
                bad_rest.append(f"{L * 1000:g}x{B * 1000:g} at {i * 0.05:.1f} (true {', '.join(f'{q * 0.05:.1f}' for q in tmins)})")
        dev = float(np.abs(h - off - ht).max())
        if max(L / 0.057, B / 0.044) <= 2.0:
            worst_dev = max(worst_dev, dev / s)
            if dev > 0.7 * s:
                bad_outline.append(f"{L * 1000:g}x{B * 1000:g} {dev:.2f} mm")
        if abs(Gm[0] - ev.EGG_CG * L / 0.057) > 0.05 * max(1.0, L / 0.057) or abs(Gm[1]) > 0.1 * s:
            bad_cg.append(f"{L * 1000:g}x{B * 1000:g} ({Gm[0]:.3f}, {Gm[1]:.3f})")
        Ie = (B / 0.044) ** 2 * ev.EGG_I[0] + (L / 0.057) ** 2 * ev.EGG_I[1]       # the real egg's, scaled (mm^2 per kg)
        worst_i = max(worst_i, abs(egg_mass_props(doc)[2] / Ie - 1))
        # every two of its solids that overlap (a ball's surface, a polygon's 1 mm of skin) are joined: parent and child, or a pin
        sol = {s_["id"]: s_ for s_ in dynamic_solids(doc)}
        world = items._world_poses(doc)
        joined = {frozenset((s_["id"], s_["parent"])) for s_ in sol.values() if s_.get("parent")}
        joined |= {frozenset((j["a"], j["b"])) for j in doc.get("joints", []) if j["kind"] == "pin"}
        ids = list(sol)
        for x in range(len(ids)):
            for y in range(x + 1, len(ids)):
                p_, q_ = sol[ids[x]], sol[ids[y]]
                if frozenset((ids[x], ids[y])) in joined:
                    continue
                if p_["body"]["kind"] == "ball" and q_["body"]["kind"] == "ball":
                    (x0, y0, _), (x1, y1, _) = world[ids[x]], world[ids[y]]
                    if math.hypot(x1 - x0, y1 - y0) < p_["body"]["radius"] + q_["body"]["radius"]:
                        bad_join.append(f"{L * 1000:g}x{B * 1000:g} {ids[x]}-{ids[y]}")
                elif p_["body"]["kind"] == "ball" or q_["body"]["kind"] == "ball":
                    ball, poly = (p_, q_) if p_["body"]["kind"] == "ball" else (q_, p_)
                    bx, by, _ = world[ball["id"]]
                    px, py, pa = world[poly["id"]]
                    pts = [(px + v["x"] * math.cos(pa) - v["y"] * math.sin(pa), py + v["x"] * math.sin(pa) + v["y"] * math.cos(pa)) for v in poly["body"]["points"]]
                    d = min(math.hypot(bx - (ax_ + (cx_ - ax_) * t), by - (ay_ + (cy_ - ay_) * t))
                            for (ax_, ay_), (cx_, cy_) in zip(pts, pts[1:] + pts[:1])
                            for t in [max(0.0, min(1.0, ((bx - ax_) * (cx_ - ax_) + (by - ay_) * (cy_ - ay_)) / ((cx_ - ax_) ** 2 + (cy_ - ay_) ** 2)))])
                    inside = all((cx_ - ax_) * (by - ay_) - (cy_ - ay_) * (bx - ax_) > 0 for (ax_, ay_), (cx_, cy_) in zip(pts, pts[1:] + pts[:1]))
                    if inside or d < ball["body"]["radius"] + 0.0005:
                        bad_join.append(f"{L * 1000:g}x{B * 1000:g} {ids[x]}-{ids[y]}")
    return {"shape: egg rests, every shape": (not bad_rest, f"{len(EGG_GRID)} shapes, rests where the true curve's are" + (f"; NOT at {'; '.join(bad_rest[:4])}" if bad_rest else "")),
            "shape: egg curve, every shape": (not bad_outline, f"outline within {worst_dev:.2f} mm (x size) of the true curve" + (f"; {'; '.join(bad_outline[:4])}" if bad_outline else "")),
            "shape: egg centre of gravity, every shape": (not bad_cg, "the real egg's" if not bad_cg else f"off at {'; '.join(bad_cg[:4])}"),
            "shape: egg moment of inertia, every shape": (worst_i <= 0.015, f"the real egg's within {worst_i * 100:.1f} %"),
            "shape: egg solids joined": (not bad_join, "no two overlapping solids can collide" if not bad_join else f"would collide: {'; '.join(bad_join[:4])}"),
            "shape: egg at most as wide as long": egg_wide_check(),
            "shape: egg at least 0.55 as wide as long": egg_thin_check(),
            "shape: egg builds, every slider step": egg_build_grid_check()}


# eggs asked to be wider than long: 57 mm long and 1.0 to 1.3 times as wide, round eggs of other sizes, and the slider corner 11.4 x 220 mm
EGG_WIDE = [(0.057, round(0.057 * r, 5)) for r in (1.02, 1.08, 1.1, 1.14, 1.2, 1.22, 1.26, 1.3)] + [(0.0285, 0.0325), (0.114, 0.13), (0.2, 0.22), (0.0114, 0.22)]


def egg_wide_check():
    """No egg is wider than it is long: asked to be, it is built exactly as the egg as wide as it is long (the same solids and joints), and the item resolves to that width."""
    bad = []
    for L, B in EGG_WIDE:
        docs = []
        for w in (B, L):
            doc, res = items.build({"stage": STAGE, "items": [{"id": ITEM, "type": "egg", "x": 0.0, "y": 0.0, "props": {"length": L, "width": w}}]})
            docs.append((json.dumps([s_ for s_ in doc["solids"] if s_["item"] == ITEM], sort_keys=True), json.dumps(doc.get("joints"), sort_keys=True), res[ITEM]["width"]))
        if docs[0] != docs[1] or docs[0][2] != L:
            bad.append(f"{L * 1000:g}x{B * 1000:g} (resolved width {docs[0][2] * 1000:g} mm)")
    return (not bad, f"{len(EGG_WIDE)} shapes wider than long are built and resolved as wide as long" if not bad else f"NOT at {'; '.join(bad[:4])}")


# eggs asked to be narrower than 0.55 of their length: the width slider's minimum at the default length and at the longest, and some between
EGG_THIN = [(0.057, 0.0088), (0.057, 0.0114), (0.057, 0.0285), (0.057, 0.031), (0.1, 0.015), (0.285, 0.0088), (0.285, 0.15), (0.04, 0.0215)]


def egg_thin_check():
    """No bird's egg is much more than 1.6 times as long as wide: asked to be narrower than 0.55 of its length, an egg is built exactly as the egg 0.55 as wide as it is long,
    and the item resolves to that width."""
    bad = []
    for L, B in EGG_THIN:
        docs = []
        for w in (B, ev.EGG_MIN_WIDTH * L):
            doc, res = items.build({"stage": STAGE, "items": [{"id": ITEM, "type": "egg", "x": 0.0, "y": 0.0, "props": {"length": L, "width": w}}]})
            docs.append((json.dumps([s_ for s_ in doc["solids"] if s_["item"] == ITEM], sort_keys=True), json.dumps(doc.get("joints"), sort_keys=True), res[ITEM]["width"]))
        if docs[0] != docs[1] or docs[0][2] != ev.EGG_MIN_WIDTH * L:
            bad.append(f"{L * 1000:g}x{B * 1000:g} (resolved width {docs[0][2] * 1000:g} mm)")
    return (not bad, f"{len(EGG_THIN)} shapes narrower than 0.55 of their length are built and resolved 0.55 as wide as long" if not bad else f"NOT at {'; '.join(bad[:4])}")


def _egg_builds(L):
    """[(width, why)] of the widths at this length, every slider step (from the slider's minimum, and on whole steps), that fail to build."""
    t = items.TYPES["egg"]
    pw = next(p for p in t.props if p.key == "width")
    ws = {round(pw.lo + pw.step * j, 6) for j in range(int((pw.hi - pw.lo) / pw.step) + 1)} | {round(pw.step * j, 6) for j in range(int(pw.lo / pw.step), int(pw.hi / pw.step) + 1)}
    out = []
    for w in sorted(v for v in ws | {pw.hi} if pw.lo <= v <= pw.hi and ev.EGG_MIN_WIDTH * L <= v <= L):
        try:
            items.build({"stage": STAGE, "items": [{"id": ITEM, "type": "egg", "x": 0.0, "y": 0.0, "props": {"length": L, "width": w}}]})
        except Exception as e:  # noqa: BLE001
            out.append((w, f"{type(e).__name__}: {e}"[:120]))
    return out


def egg_build_grid_check():
    """Every size the sliders make builds (every length step from the slider's minimum and on whole steps, by every width step that is not clamped): 25.4 x 14 and
    28.5 x 21.38 mm once failed (a corner turned clockwise by the rounding), taking the whole scene down with them."""
    pl = next(p for p in items.TYPES["egg"].props if p.key == "length")
    Ls = sorted({round(pl.lo + pl.step * i, 6) for i in range(int((pl.hi - pl.lo) / pl.step) + 1)} | {round(pl.step * i, 6) for i in range(int(pl.lo / pl.step) + 1, int(pl.hi / pl.step) + 1)} | {pl.hi})
    with cf.ProcessPoolExecutor(max_workers=min(8, os.cpu_count() or 4)) as ex:
        fails = [(L, w, why) for L, out in zip(Ls, ex.map(_egg_builds, Ls, chunksize=8)) for w, why in out]
    return (not fails, f"{len(Ls)} lengths by every width step between 0.55 of the length and the length build" if not fails
            else f"{len(fails)} fail: " + "; ".join(f"{L * 1000:g}x{w * 1000:g} {why}" for L, w, why in fails[:3]))


def egg_drop_scene(angle, h):
    """The egg turned `angle` degrees (90: stood on its blunt end, 270: on its point), its lowest point h above the table, run for 5 s."""
    doc = alone("egg")
    world = items._world_poses(doc)
    a = math.radians(angle)
    low = 1e9
    for s_ in doc["solids"]:
        px, py, pa = world[s_["id"]]
        if s_["body"]["kind"] == "ball":
            low = min(low, px * math.sin(a) + py * math.cos(a) - s_["body"]["radius"])
        else:
            for p in s_["body"]["points"]:
                qx, qy = px + p["x"] * math.cos(pa) - p["y"] * math.sin(pa), py + p["x"] * math.sin(pa) + p["y"] * math.cos(pa)
                low = min(low, qx * math.sin(a) + qy * math.cos(a))
    return scene_of([{"id": ITEM, "type": "egg", "x": X0, "y": round(-low + h, 5), "angle": angle, "props": {}}], f"egg-drop-{angle}", seconds=5.0)


EGG_DROPS = [(a, h) for a in (90, 80, 100, 270, 260, 280, 0, 180, 45, 135) for h in (0.0005, 0.03)]
# rounder eggs (57 mm long, 49, 50 and 57 wide: their blunt ends can stand) dropped 3 cm at 45, 75 and 80 degrees, run for 15 s: each ends still at one of its true rests
EGG_ROUND_DROPS = [(w, a) for w in (0.049, 0.05, 0.057) for a in (45, 75, 80, 100, 135)]


def egg_round_drop_scene(width, angle, length=0.057, h=0.03, seconds=15.0):
    """The egg (length x width) turned `angle` degrees, its lowest point h above the table."""
    props = {"length": length, "width": width}
    doc = alone("egg", props)
    world = items._world_poses(doc)
    a = math.radians(angle)
    low = 1e9
    for s_ in dynamic_solids(doc):
        px, py, pa = world[s_["id"]]
        if s_["body"]["kind"] == "ball":
            low = min(low, px * math.sin(a) + py * math.cos(a) - s_["body"]["radius"])
        else:
            for p in s_["body"]["points"]:
                qx, qy = px + p["x"] * math.cos(pa) - p["y"] * math.sin(pa), py + p["x"] * math.sin(pa) + p["y"] * math.cos(pa)
                low = min(low, qx * math.sin(a) + qy * math.cos(a))
    return scene_of([{"id": ITEM, "type": "egg", "x": X0, "y": round(-low + h, 5), "angle": angle, "props": props}], f"egg-round-{length}-{width}-{angle}", seconds=seconds)


# eggs asked to be wider than long (built as wide as long: 57 x 57 mm, 114 x 114 and 200 x 200), set down 0.5 mm above the table and run 40 s (on the point at 270)
EGG_WIDE_DROPS = [(L, w, a) for L, w in ((0.057, 0.0627), (0.057, 0.065), (0.057, 0.0695), (0.057, 0.0718), (0.114, 0.13), (0.2, 0.22))
                  for a in (0, 15, 30, 150, 180, 200, 270, 300)]


def egg_round_drop_check(res, width, length=0.057):
    """It ends within 3 degrees of one of the true curve's rests (the egg as built), still over its last second."""
    _, ht, _, _, _ = egg_support(length, width)
    n = len(ht)
    tmins = [i * 0.05 for i in range(n) if ht[i] < ht[i - 1] and ht[i] <= ht[(i + 1) % n]]
    s_ = dynamic_solids(res["doc"])[0]
    pts = series(res, s_["id"])
    end = pts[-1][1]
    a1 = min(pts, key=lambda q: abs(q[0] - (pts[-1][0] - 1.0)))[1]
    way = (-90.0 - math.degrees(end["angle"])) % 360          # the way down, in the egg's own frame
    off = min(abs((way - t + 180) % 360 - 180) for t in tmins)
    still = abs(end["x"] - a1["x"]) < 0.0005 and abs(end["angle"] - a1["angle"]) < 0.005
    return off <= 3 and still, f"ends lying {way:.1f} degrees of way down ({off:.1f} from a true rest: {', '.join(f'{t:.1f}' for t in tmins)}), {'still' if still else 'still moving'}"


def egg_drop_check(res):
    """It ends lying on a side, 8.85 degrees off level (pointed end down), and still over its last second."""
    s_ = dynamic_solids(res["doc"])[0]
    pts = series(res, s_["id"])
    end = pts[-1][1]
    a1 = min(pts, key=lambda q: abs(q[0] - (pts[-1][0] - 1.0)))[1]
    ang = math.degrees(end["angle"]) % 360
    off = min(abs(wrap(math.radians(ang - (360 - EGG_REST)))), abs(wrap(math.radians(ang - (180 + EGG_REST)))))
    still = abs(end["x"] - a1["x"]) < 0.0005 and abs(end["angle"] - a1["angle"]) < 0.005
    return math.degrees(off) <= 3 and still, f"ends at {ang:.1f} degrees ({math.degrees(off):.1f} from a rest), {'still' if still else 'still moving'}"


# small round eggs just past the switch to balls (width over 0.815 of the length; their balls all but coincide there), dropped 3 cm at 8 angles: nothing flies apart
# (welded to a 1 mm carrier of 0.4 % of the weight, 14 x 11.5 mm left the table at 55 to 157 m/s); run 10 s (stood on its point, one rocks on its blunt end for 8 s)
EGG_SMALL_DROPS = [(L, w, a) for L, w in ([(L, round(L * r, 5)) for L in (0.0114, 0.0124, 0.0134, 0.014, 0.015, 0.0164, 0.0174, 0.0184, 0.02) for r in (0.816, 0.82, 0.825, 0.83)]
                                          + [(0.014, 0.0115), (0.0134, 0.011), (0.0114, 0.0093)])
                   for a in (0, 45, 90, 135, 180, 225, 270, 315)]
# eggs asked to be thinner than 0.55 of their length (built 0.55 as wide as long) and the size sliders' corners, stood on the blunt end (90), on the point (270) and tilted
# 45 degrees, 0.5 mm and 3 cm above the table, run 10 s
EGG_THIN_DROPS = [(L, w, a, h) for L, w in ((0.057, 0.0088), (0.057, 0.0114), (0.1, 0.015), (0.285, 0.0088), (0.285, 0.22), (0.0114, 0.0088), (0.0114, 0.22), (0.057, 0.03135))
                  for a in (45, 90, 270) for h in (0.0005, 0.03)]


def egg_true_rests(L, B):
    """The ways down (degrees, in the egg's frame) where the true curve, scaled to L x B as the egg is built, rests: the minima of its support function about its centroid."""
    import numpy as np
    sx, sy = L / 0.057, egg_width(L, B) / 0.044
    U = np.radians(np.arange(0, 360, 0.05))
    th = np.linspace(0, 2 * math.pi, 4000, endpoint=False)
    xs = -28.5 * np.cos(th)
    C = np.stack([xs * sx, np.array([ev._egg_prof(x) for x in xs]) * sy * np.sign(np.sin(th))], 1) - np.array([ev.EGG_CG * sx, 0.0])
    ht = np.max(C @ np.stack([np.cos(U), np.sin(U)]), 0)
    n = len(ht)
    return [i * 0.05 for i in range(n) if ht[i] < ht[i - 1] and ht[i] <= ht[(i + 1) % n]]


def egg_sane_check(res, length, width, rest):
    """No solid of it goes faster than 3 m/s (dropped 3 cm, an egg lands at under 1 m/s), its solids keep their places within 0.5 mm of one another (the welds hold), it ends
    still and, if `rest`, within 3 degrees of a true rest. (Under about 30 mm long the engine's contact margin, half a millimetre, props an egg up a few degrees short of a
    shallow rest, so there only the first three are asked.)"""
    sol = dynamic_solids(res["doc"])
    ids = [s_["id"] for s_ in sol]
    frames = res["track"]["frames"]
    gaps = lambda P: [math.hypot(P[i]["x"] - P[j]["x"], P[i]["y"] - P[j]["y"]) for i in ids for j in ids if i < j]
    vmax, stretch, d0 = 0.0, 0.0, gaps(frames[0]["placements"])
    for f0, f1 in zip(frames, frames[1:]):
        dt = f1["t"] - f0["t"]
        for i in ids:
            a, b = f0["placements"][i], f1["placements"][i]
            vmax = max(vmax, math.hypot(b["x"] - a["x"], b["y"] - a["y"]) / dt)
        stretch = max([stretch] + [abs(p - q) for p, q in zip(gaps(f1["placements"]), d0)])
    pts = series(res, ids[0])
    end = pts[-1][1]
    a1 = min(pts, key=lambda q: abs(q[0] - (pts[-1][0] - 1.0)))[1]
    still = abs(end["x"] - a1["x"]) < 0.0005 and abs(end["angle"] - a1["angle"]) < 0.005
    way = (-90.0 - math.degrees(end["angle"])) % 360
    tmins = egg_true_rests(length, width)
    off = min(abs((way - t + 180) % 360 - 180) for t in tmins)
    ok = vmax <= 3.0 and stretch <= 0.0005 and still and (off <= 3 or not rest)
    return ok, (f"fastest {vmax:.2f} m/s, its solids within {stretch * 1000:.2f} mm, {'still' if still else 'still moving'}, ends {way:.1f} degrees of way down"
                + (f" ({off:.1f} from a true rest)" if rest else ""))


def mug_shape_checks():
    out = {}
    for props, sx, sy in (({}, 1.0, 1.0), ({"diameter": 0.12, "height": 0.07}, 0.12 / 0.082, 0.07 / 0.095), ({"diameter": 0.06, "height": 0.2}, 0.06 / 0.082, 0.2 / 0.095)):
        doc = alone("coffee-mug", props)
        u = min(sx, sy)
        reach = max(x for p in _polys(doc, "handle") for x, _ in p) - 0.041 * sx
        out[f"shape: mug handle {props or 'default'}"] = (abs(reach - 0.036 * u) <= 0.0002, f"{reach * 1000:.1f} mm out from the wall, a hand-sized {36 * u:.1f} mm expected")
    return out


SHAPE_CHECKS = {"bowling-pin": pin_shape_checks, "egg": egg_shape_checks, "coffee-mug": mug_shape_checks}


# ---------------------------------------------------------------- main
def main(argv):
    keys = argv or list(ev.KEYS)
    rows = {k: {} for k in keys}
    for k in keys:
        rows[k]["schema"] = schema_check(items.TYPES[k])
        rows[k]["clash"] = (k not in ev.CLASHES, "replaced another module's type")
        rows[k].update(weight_checks(k))
        if k in SHAPE_CHECKS:
            rows[k].update(SHAPE_CHECKS[k]())
        ok, note = extremes_check(k)
        if ok or k in SILHOUETTES or k in OWN_OUTLINES:
            rows[k]["extremes"] = (ok, note)
        else:
            EXTREME_WARNINGS.append((k, note))      # another group's type: reported, not failed (its catalog entry is not ours to change here)
    jobs = []
    for k in keys:
        jobs.append((k, flat_scene(k)))
        if k == "egg":
            jobs += [(f"egg|drop {ang} {h * 1000:g}mm", egg_drop_scene(ang, h)) for ang, h in EGG_DROPS]
            jobs += [(f"egg|rounddrop {w} {ang}", egg_round_drop_scene(w, ang)) for w, ang in EGG_ROUND_DROPS]
            jobs += [(f"egg|widedrop {L} {w} {ang}", egg_round_drop_scene(w, ang, L, 0.0005, 40.0)) for L, w, ang in EGG_WIDE_DROPS]
            jobs += [(f"egg|smalldrop {L} {w} {ang}", egg_round_drop_scene(w, ang, L, 0.03, 10.0)) for L, w, ang in EGG_SMALL_DROPS]
            jobs += [(f"egg|thindrop {L} {w} {ang} {h}", egg_round_drop_scene(w, ang, L, h, 10.0)) for L, w, ang, h in EGG_THIN_DROPS]
        if is_roller(k):
            jobs.append((k + "|ramp", ramp_scene(k)))
        if k in PROBES:
            jobs.append((k + "|probe", probe_scene(k)))
        for props, _ in ev.STATED[k][1:]:           # the other states (an empty can)
            jobs.append((f"{k}|{json.dumps(props, sort_keys=True)}", flat_scene(k, props)))
            if is_roller(k):
                jobs.append((f"{k}|{json.dumps(props, sort_keys=True)}|ramp", ramp_scene(k, props)))
    with cf.ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 4)) as ex:
        results = list(ex.map(run, jobs))
    for res in results:
        k, *rest = res["name"].split("|")
        label = " ".join(rest)
        checks = rows[k]
        ramp = "ramp" in rest
        probe = "probe" in rest
        if "error" in res:
            checks[f"runs {label}"] = (False, res["error"])
            continue
        if rest and rest[0].startswith("drop"):
            checks[label] = egg_drop_check(res)
            continue
        if rest and rest[0].startswith("rounddrop"):
            _, w, ang = rest[0].split()
            checks[f"round drop {float(w) * 1000:g} mm wide from {ang} deg"] = egg_round_drop_check(res, float(w))
            continue
        if rest and rest[0].startswith("widedrop"):
            _, L, w, ang = rest[0].split()
            checks[f"wide drop {float(L) * 1000:g} x {float(w) * 1000:g} mm from {ang} deg"] = egg_round_drop_check(res, float(w), float(L))
            continue
        if rest and rest[0].startswith("smalldrop"):
            _, L, w, ang = rest[0].split()
            checks[f"small drop {float(L) * 1000:g} x {float(w) * 1000:g} mm from {ang} deg"] = egg_sane_check(res, float(L), float(w), False)
            continue
        if rest and rest[0].startswith("thindrop"):
            _, L, w, ang, h = rest[0].split()
            checks[f"thin drop {float(L) * 1000:g} x {float(w) * 1000:g} mm from {ang} deg {float(h) * 1000:g} mm up"] = egg_sane_check(res, float(L), float(w), float(L) >= 0.03)
            continue
        for name, c in finite_speed_sink(res, tilted=ramp).items():
            if name == "speed" or not c[0]:
                checks[f"{name} {label}".strip()] = c
            else:
                checks.setdefault(name, c)
        if probe:
            checks["catches"] = probe_check(res)
        elif ramp:
            checks[f"rolls {label}".strip()] = rolls_check(res)
        elif items.TYPES[k].dynamic:
            checks[f"stands {label}".strip()] = stands_check(res)
            checks[f"rests {label}".strip()] = rests_check(res)
        else:
            checks["catches"] = catches_check(res)
    w = max(len(k) for k in keys)
    failed = []
    for k in keys:
        bad = [n for n, (ok, _) in rows[k].items() if not ok]
        if bad:
            failed.append(k)
        shown = [f"{n}: {note}" for n, (ok, note) in rows[k].items() if n.startswith(("rolls", "catches")) or not ok]
        print(f"{'FAIL' if bad else 'pass'}  {k:<{w}}  " + " | ".join(shown) + (f"   <- {', '.join(bad)}" if bad else ""))
    for k, note in EXTREME_WARNINGS:
        print(f"warn  {k:<{w}}  extremes (not this group's type): {note}")
    print(f"\n{'PASS' if not failed else 'FAIL'}: {len(keys) - len(failed)} of {len(keys)} types" + (f"; FAILED: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
