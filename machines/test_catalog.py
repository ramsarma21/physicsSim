"""Guard for the whole catalog: every item type, and every built-in scenario, is built and run through the engine.
usage: python3 machines/test_catalog.py [type-key ...]      (prints a pass/fail table; exits 1 if anything fails)

Each type gets the table plus that item: balls held with their bottoms 1 m above it, other dynamic things 2 cm above it,
swinging things hung high, fixed things standing on it with a probe ball dropped where the type has a job to do.
Per run it checks
  schema   (types outside items.py) the type's description, source, tags, facts and anchor are filled; props have ranges (defaults inside them);
           edit handles are only the kinds the editor implements and name props the type has,
  runs     it builds, the engine runs it, no NaN, no speed above 30 m/s, nothing dynamic sinks over 2 cm into the table,
  weight   a ball (or anything with a weight prop) weighs what the type says, ±1%,
  rebound  a ball's first rebound from 1 m is within ±20% of e²·1 m, e being the contact's restitution against the table.
           e²·1 m is the vacuum answer. The engine also has air drag (a 2.7 g ping-pong ball loses a fifth of its rebound to it,
           a beach ball a third), so the check uses the same fall with the engine's drag: the same number for a heavy ball,
  behaves  one check per type that has a job (a cup catches, a pendulum keeps its period, a fan blows, ...).
Every web/scenarios/*.json is run too (generic checks; the four catalog scenarios also check their own point).
Runs go through research/poc/dense_track.ts at 120 Hz, in parallel; documents are written to scenes/.test-cat-* and removed,
as machines/test_rg.py does for its two.
"""
import concurrent.futures as cf
import glob
import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import items  # noqa: E402

STAGE = {"x0": -0.55908203125, "x1": 3.19091796875, "y0": -0.15625, "y1": 2.34375}
TABLE = {"id": "table", "type": "table", "name": "Table", "x": 1.3, "y": 0.0, "props": {"width": 3.7, "thickness": 0.15}}
X0 = 1.3
TABLE_X0, TABLE_X1 = X0 - 3.7 / 2, X0 + 3.7 / 2
G, AIR, CD = 9.81, 1.2, 0.47            # the engine's gravity, air density and sphere drag
FIRST = "ball"                          # the item id of the thing under test
CORE = {"table", "wall", "plank", "superball", "plastic-ball", "clay-ball", "domino", "domino-row", "seesaw", "box"}   # items.py's own: not held to the schema check
REAL_REBOUND = {"steel-ball": (0.30, 0.40)}   # a measured rebound from 1 m (m), against the real world and not only the contact's own e: Physics Factbook, a steel ball bearing from 92 cm onto concrete rebounds 32.8 cm
EDIT_KINDS = {"length", "radius", "top", "size", "boxWidth", "rotate", "swing", "tiltEnd", "armEnd"}


def scene_of(items_, name="test", seconds=4.5):
    return {"version": 2, "id": name, "name": name, "seconds": seconds, "release": 0.5, "stage": STAGE, "items": [TABLE] + list(items_), "goals": []}


# ---------------------------------------------------------------- geometry of a built item
def corners(s, pose):
    x, y, a = pose
    b = s["body"]
    if b["kind"] == "polygon":      # a polygon body: its own outline
        pts = [(p["x"], p["y"]) for p in b["points"]]
    else:
        hw, hh, t = b["width"] / 2, b["height"] / 2, b.get("taper")
        pts = [(-hw * t, -hh), (hw * t, -hh), (hw, hh), (-hw, hh)] if t is not None else [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    c, n = math.cos(a), math.sin(a)
    return [(x + px * c - py * n, y + px * n + py * c) for px, py in pts]


def extent(s, pose):
    """(lowest, highest) point of a solid at a pose."""
    if s["body"]["kind"] == "ball":
        return pose[1] - s["body"]["radius"], pose[1] + s["body"]["radius"]
    ys = [p[1] for p in corners(s, pose)]
    return min(ys), max(ys)


def alone(key, props=None):
    doc, _ = items.build({"stage": STAGE, "items": [{"id": "p", "type": key, "x": 0.0, "y": 0.0, "props": props or {}}]})
    return doc


# per-type test settings
PROPS = {"lever": {"pivot_offset": 0.1}}        # an unbalanced lever, so it has something to do
PROBES = {   # key: (probe ball type, dx from the item, height above the item's top)
    "steel-beam": ("tennis-ball", 0.0, 0.3), "ice-sheet": ("tennis-ball", 0.0, 0.3), "glass-sheet": ("glass-marble", 0.0, 0.3),
    "rubber-mat": ("tennis-ball", 0.0, 0.3), "carpet-strip": ("tennis-ball", 0.0, 0.3), "concrete-slab": ("tennis-ball", 0.0, 0.3),
    "peg": ("golf-ball", 0.004, 0.3), "bumper": ("tennis-ball", 0.0, 0.3), "funnel": ("glass-marble", 0.05, 0.1),
    "staircase": ("golf-ball", -0.2, 0.2), "cup": ("golf-ball", 0.0, 0.3), "bucket": ("tennis-ball", 0.0, 0.3),
    "basket": ("tennis-ball", 0.0, 0.3), "peg-board": ("glass-marble", 0.013, 0.1),   # not dead centre: it would balance on a peg
    "fan": ("ping-pong-ball", 0.4, 0.0),
}


def is_ball_type(t):
    P = t.defaults()
    return t.category == "Balls" and "diameter" in P and "mass" in P


def placed(key):
    """The test item: where it goes on the table, and what else goes with it."""
    t = items.TYPES[key]
    props = dict(PROPS.get(key, {}))
    P = dict(t.defaults(), **props)
    item = {"id": FIRST, "type": key, "x": X0, "y": 0.0, "angle": 0.0, "props": props}
    extra = []
    if is_ball_type(t):
        item.update(y=1.0 + P["diameter"] / 2, held=True)
    elif key in ("pendulum", "hinged-gate"):
        item["y"] = 1.0
    else:
        doc = alone(key, props)
        world = items._world_poses(doc)
        ext = [extent(s, world[s["id"]]) for s in doc["solids"]]
        # its lowest point on the table (2 cm above it if nothing in it is fixed, so it lands)
        item["y"] = round(-min(e[0] for e in ext) + (0.0 if any(s["kind"] == "static" for s in doc["solids"]) else 0.02), 4)
        if key in PROBES:
            ball, dx, up = PROBES[key]
            r = items.TYPES[ball].defaults()["diameter"] / 2
            extra.append({"id": "probe", "type": ball, "x": round(X0 + dx, 4), "y": round(item["y"] + max(e[1] for e in ext) + up + r, 4), "held": True})
    return item, extra


# ---------------------------------------------------------------- running one scene
_serial = [0]


def simulate(doc):
    """The engine's track for a document, sampled at 120 Hz (the document goes into scenes/ and is removed after)."""
    _serial[0] += 1
    stem = f".test-cat-{os.getpid()}-{_serial[0]}"
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
        doc, _ = items.build(scene)
        res["doc"] = doc
        res["track"] = simulate(doc)
        res["summary"] = items.summarize(scene, doc, res["track"])
    except Exception as e:  # noqa: BLE001 (any failure is a failed row, not a crash)
        res["error"] = f"{type(e).__name__}: {e}"[:200]
    return res


# ---------------------------------------------------------------- checks
def series(res, sid):
    return [(f["t"], f["placements"][sid]) for f in res["track"]["frames"]]


def schema_check(t):
    """The catalog entry itself: -> (ok, note)"""
    d = t.schema()
    bad = [f for f in ("description", "source", "facts", "anchor") if not d.get(f)]
    bad += ["tags"] if not d["tags"] else []
    keys = {p["key"] for p in d["props"]}
    for p in d["props"]:
        if p["kind"] in ("number", "int"):
            if p.get("min") is None or p.get("max") is None or not p["min"] <= p["default"] <= p["max"]:
                bad.append(f"range of {p['key']}")
    for e in d["edit"]:
        if e["kind"] not in EDIT_KINDS:
            bad.append(f"handle {e['kind']}")
        for k in ("prop", "w", "h", "length"):
            if k in e and e[k] not in keys:
                bad.append(f"handle prop {e[k]}")
    if d["category"] not in items.CATEGORIES:
        bad.append("category")
    return not bad, "missing: " + ", ".join(bad) if bad else ""


def generic(res):
    """NaN, speed and sinking over every solid: -> {check: (ok, note)}"""
    doc, track = res["doc"], res["track"]
    frames = track["frames"]
    ts = [f["t"] for f in frames]
    nan = any(not all(math.isfinite(v) for v in (p["x"], p["y"], p["angle"])) for f in frames for p in f["placements"].values())
    vmax, sink = 0.0, 0.0
    for s in doc["solids"]:
        if s["kind"] != "dynamic":
            continue
        sid, j = s["id"], 0
        for i, a in enumerate(frames):         # speed over at least 8 ms: the frames at an impact are a step or two apart
            j = max(j, i + 1)
            while j < len(frames) and ts[j] - ts[i] < 0.008:
                j += 1
            if j >= len(frames):
                break
            pa, pb = a["placements"][sid], frames[j]["placements"][sid]
            vmax = max(vmax, math.hypot(pb["x"] - pa["x"], pb["y"] - pa["y"]) / (ts[j] - ts[i]))
        for f in frames:
            p = f["placements"][sid]
            if TABLE_X0 <= p["x"] <= TABLE_X1:      # past the table's edge it is meant to fall
                sink = max(sink, -extent(s, (p["x"], p["y"], p["angle"]))[0])
    vmax = max([vmax] + [h["speed"] for h in track.get("impacts", [])])
    return {"finite": (not nan, "NaN in the track"), "speed": (vmax <= 30, f"{vmax:.1f} m/s"), "sink": (sink <= 0.02, f"sank {sink * 1000:.1f} mm")}


def mass_of(doc, sid):
    s = next(s for s in doc["solids"] if s["id"] == sid)
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


def expected_mass(key, P):
    """What the type says its heaviest part weighs: a mass prop, or (the log) density x cylinder; None if it says nothing."""
    if "mass" in P:
        return P["mass"]
    if "bob_mass" in P:
        return P["bob_mass"]
    if key == "wooden-log":
        return items.MATERIALS[P["material"]]["density"] * math.pi * (P["diameter"] / 2) ** 2 * P["length"]
    return None


def weight_check(res, key):
    exp = expected_mass(key, dict(items.TYPES[key].defaults(), **PROPS.get(key, {})))
    if exp is None:
        return None
    solids = [s for s in res["doc"]["solids"] if s["item"] == FIRST and s["kind"] == "dynamic"]
    by_id = {s["id"]: s for s in solids}

    def root(s):       # the solid a piece is welded to (a parent without a pivot), followed up to the piece that is not welded to another
        while s.get("parent") in by_id and not s.get("pivot"):
            s = by_id[s["parent"]]
        return s["id"]
    group = {}
    for s in solids:   # a compound item (a mug, a cone, a sneaker) is several welded pieces: it weighs their sum
        group[root(s)] = group.get(root(s), 0.0) + mass_of(res["doc"], s["id"])
    one = max(mass_of(res["doc"], s["id"]) for s in solids)      # a part that is the weight (a pendulum's bob, welded to its rod) ...
    got = min((max(group.values()), one), key=lambda m: abs(m - exp))    # ... or the whole welded object
    return abs(got - exp) <= 0.01 * exp, f"{got * 1000:.1f} g vs {exp * 1000:.1f} g"


def drag_rebound(m, r, e, h=1.0, dt=2e-4):
    """First rebound height of a ball dropped from h, with the engine's quadratic air drag (e on the way back up)."""
    k = 0.5 * AIR * CD * math.pi * r * r / m
    y, v = h, 0.0
    while y > 0:
        v += (-G - k * abs(v) * v) * dt
        y += v * dt
    v, top = -e * v, 0.0
    while v > 0:
        v += (-G - k * abs(v) * v) * dt
        top += v * dt
    return top


def contact_e(doc, mat_a, mat_b):
    for c in doc["contacts"]:
        if sorted(c["between"]) == sorted([mat_a, mat_b]):
            return c["restitution"]
    raise KeyError((mat_a, mat_b))


def first_rebound(res, sid):
    """Height (m) the ball's bottom rises after its first landing, or None if it never came back up."""
    s = next(s for s in res["doc"]["solids"] if s["id"] == sid)
    ts, ys = zip(*[(t, p["y"] - s["body"]["radius"]) for t, p in series(res, sid)])
    i = next((k for k in range(1, len(ys) - 1) if ts[k] > 0.5 and ys[k] <= ys[k - 1] and ys[k] < ys[k + 1] and ys[k] < ys[0] - 0.05), None)
    if i is None:
        return None
    j = i + 1
    while j + 1 < len(ys) and ys[j + 1] >= ys[j] - 1e-9:
        j += 1
    return ys[j] - max(ys[i], 0.0)      # the table is at 0: a landing that sank a few mm is not a longer rebound


def rebound_check(res, sid):
    doc = res["doc"]
    s = next(s for s in doc["solids"] if s["id"] == sid)
    e = contact_e(doc, s["material"], doc["solids"][0]["material"])
    exp = drag_rebound(mass_of(doc, sid), s["body"]["radius"], e)
    got = first_rebound(res, sid)
    ok = got is not None and abs(got - exp) <= max(0.2 * exp, 0.004)
    return ok, f"e {e:.3f}: {'none' if got is None else f'{got * 100:.1f} cm'} vs {exp * 100:.1f} cm (vacuum e² {e * e * 100:.1f})"


def cradle_check(res, iid):
    c = next(i for i in res["scene"]["items"] if i["id"] == iid)
    P = dict(items.TYPES["newtons-cradle"].defaults(), **c.get("props", {}))
    n = int(P["count"])
    last = series(res, f"{iid}/bob{n}")
    out = max(p["x"] - last[0][1]["x"] for _, p in last)
    amp = P["length"] * math.sin(math.radians(abs(P["start_angle"])))
    return out >= 0.5 * amp, f"last ball swings out {out * 100:.1f} cm (first pulled back {amp * 100:.1f} cm)"


def behaviour(key, res):
    """The one thing this type is for -> (ok, note), or None."""
    doc, scene = res["doc"], res["scene"]
    end = res["track"]["frames"][-1]["placements"]
    if key in ("cup", "bucket", "basket"):
        poses = {sid: (p["x"], p["y"]) for sid, p in end.items()}
        ok = items.inside(scene, doc, poses, "probe", FIRST)
        return ok, "probe ball ends inside" if ok else f"probe ends at {poses['probe/ball'][0]:.2f}, {poses['probe/ball'][1]:.2f}"
    if key == "funnel":
        y = end["probe/ball"]["y"]
        return y < 0.1, f"marble ends at y {y:.2f}, below the outlet"
    if key == "peg-board":
        y = end["probe/ball"]["y"]
        return y < 0.03, f"marble falls through, ends at y {y:.3f}"
    if key == "bumper":
        r = first_rebound(res, "probe/ball")
        return r is not None and r > 0.1, f"probe rebounds {r or 0:.2f} m from 0.3 m"
    if key == "fan":
        dx = end["probe/ball"]["x"] - series(res, "probe/ball")[0][1]["x"]
        return dx > 0.1, f"ping-pong ball blown {dx:+.2f} m"
    if key == "pendulum":
        ang = [(t, math.atan2(p["x"] - X0, -(p["y"] - 1.0))) for t, p in series(res, f"{FIRST}/bob")]
        cross = [t for (t, a), (_, a2) in zip(ang, ang[1:]) if t > 0.5 and a > 0 >= a2]   # downward zero crossings
        if len(cross) < 2:
            return False, "does not swing"
        T = (cross[-1] - cross[0]) / (len(cross) - 1)
        P = items.TYPES[key].defaults()
        a0 = math.radians(P["start_angle"])
        want = 2 * math.pi * math.sqrt(P["length"] / G) * (1 + a0 * a0 / 16 + 11 * a0 ** 4 / 3072)
        return abs(T - want) <= 0.04 * want, f"period {T:.3f} s vs {want:.3f} s (large-angle formula)"
    if key == "hinged-gate":
        ang = [math.degrees(p["angle"]) for _, p in series(res, f"{FIRST}/gate")]
        return min(ang) < -20 and max(ang) <= 41, f"swings {min(ang):.0f}° to {max(ang):.0f}° from 40°"
    if key == "lever":
        turn = max(abs(math.degrees(p["angle"])) for _, p in series(res, f"{FIRST}/plank"))
        return turn > 5, f"unbalanced plank turns {turn:.0f}°"
    if key == "newtons-cradle":
        return cradle_check(res, FIRST)
    if key in ("wooden-block", "brick", "foam-block", "cardboard-box", "steel-weight-1kg", "steel-weight-5kg", "ice-cube", "wedge"):
        part = "wedge" if key == "wedge" else "weight" if key.startswith("steel") else "block"
        a = abs(end[f"{FIRST}/{part}"]["angle"])
        return a < math.radians(3) or abs(a - math.pi) < math.radians(3), f"settles upright (turned {math.degrees(a):.1f}°)"
    return None


def scenario_checks(sid, res):
    out = {}
    doc = res["doc"]
    first, end = res["track"]["frames"][0]["placements"], res["track"]["frames"][-1]["placements"]
    if sid == "ball-drop":
        for it in res["scene"]["items"]:
            if it["type"] != "table":
                out[f"rebound {it['id']}"] = rebound_check(res, f"{it['id']}/ball")
    elif sid == "newtons-cradle":
        out["last ball swings out"] = cradle_check(res, "cradle")
    elif sid == "plinko":
        poses = {k: (p["x"], p["y"]) for k, p in end.items()}
        cups = [i["id"] for i in res["scene"]["items"] if i["type"] == "cup" and items.inside(res["scene"], doc, poses, "ball", i["id"])]
        out["ball ends in a cup"] = (bool(cups), f"ball ends in {', '.join(cups) or 'no cup'}")
    elif sid == "pendulum-dominoes":
        dom = [s["id"] for s in doc["solids"] if s["item"] == "dominoes"]
        fallen = sum(1 for d in dom if abs(end[d]["angle"] - first[d]["angle"]) > 1.0)
        out["all dominoes fall"] = (fallen == len(dom), f"{fallen} of {len(dom)} fall")
    return out


# ---------------------------------------------------------------- main
def main(argv):
    keys = [k for k in (argv or items.TYPES) if k != "table"]
    # (a module's type that builds no solid, a circuit's wire or its upright board, is only drawn: nothing to drop, weigh or run alone)
    drawn = [k for k in keys if not is_ball_type(items.TYPES[k]) and not alone(k, {})["solids"]]
    for k in drawn:
        print(f"skip  {k}  (draws only: it builds no solid)")
    keys = [k for k in keys if k not in drawn]
    jobs = []
    for k in keys:
        item, extra = placed(k)
        jobs.append((k, scene_of([item] + extra, k)))
    if not argv:
        for f in sorted(glob.glob(os.path.join(PG, "web", "scenarios", "*.json"))):
            sc = json.load(open(f))
            jobs.append(("scenario:" + sc["id"], sc))
    for k in keys:      # a ball's rebound is its own run: alone, 1 m up, 3 s
        t = items.TYPES[k]
        if is_ball_type(t):
            jobs.append((k + ":rebound", scene_of([{"id": FIRST, "type": k, "x": X0, "y": 1.0 + t.defaults()["diameter"] / 2, "held": True}], k + "-rebound", 3.0)))
    with cf.ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 4)) as ex:
        results = list(ex.map(run, jobs))
    rows = []
    for res in results:
        name = res["name"]
        checks = {}
        if name in items.TYPES and name not in CORE:
            checks["schema"] = schema_check(items.TYPES[name])
        if "error" in res:
            checks["runs"] = (False, res["error"])
        else:
            checks.update(generic(res))
            if name.startswith("scenario:"):
                checks.update(scenario_checks(name[9:], res))
            elif name.endswith(":rebound"):
                checks["rebound"] = rebound_check(res, f"{FIRST}/ball")
                if name[:-8] in REAL_REBOUND:
                    lo, hi = REAL_REBOUND[name[:-8]]
                    h = first_rebound(res, f"{FIRST}/ball")
                    checks["rebound real"] = (h is not None and lo <= h <= hi, f"{'none' if h is None else f'{h * 100:.1f} cm'} from 1 m, real {lo * 100:.0f}-{hi * 100:.0f} cm")
                w = weight_check(res, name[:-8])
                if w:
                    checks["weight"] = w
            else:
                for label, c in (("weight", weight_check(res, name) if not is_ball_type(items.TYPES[name]) else None), ("behaves", behaviour(name, res))):
                    if c:
                        checks[label] = c
        rows.append((name, [k for k, (ok, _) in checks.items() if not ok], checks))
    w = max(len(r[0]) for r in rows)
    for name, bad, checks in rows:
        shown = [f"{k}: {note}" for k, (ok, note) in checks.items() if note and (k in ("behaves", "weight", "rebound") or k.startswith(("rebound ", "last", "all ", "ball ")) or k in bad)]
        speed = checks.get("speed", (True, ""))[1]
        print(f"{'FAIL' if bad else 'pass'}  {name:<{w}}  {speed:>9}  " + " | ".join(shown) + (f"   <- {', '.join(bad)}" if bad else ""))
    failed = [r[0] for r in rows if r[1]]
    print(f"\n{len(rows) - len(failed)} of {len(rows)} pass" + (f"; FAILED: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
