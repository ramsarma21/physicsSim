"""Tests of the measure module's catalog (machines/mod_measure.py): python3 machines/test_measure.py
Every type builds at its defaults, at its numbers' ends and at each choice; display parts are ghosts (static, drawn, never touched, left out of
overlaps); the brass masses weigh their nominal grams; a spring scale's stiffness is its range over 10 cm; the materials' real densities; the
goal kinds (reads, crosses, faster, farther, stops_between) judged through items.summarize on hand-made tracks with known answers. (The engine's
side, the JS port and the AI: research/rw-validate-measure.ts, ai/test/measure.test.mjs and tools/parity.)"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("PLAYGROUND_MODULES", "measure")
import items  # noqa: E402
import mod_measure as M  # noqa: E402

FAILS = []
N = [0]


def check(cond, what):
    N[0] += 1
    if not cond:
        FAILS.append(what)
        print("FAIL", what)


STAGE = {"x0": -1.0, "x1": 12.0, "y0": -0.2, "y1": 2.4}


def scene(items_, **kw):
    return {"version": 2, "id": "t", "stage": STAGE, "seconds": 5, "release": 0.5, "items": items_, **kw}


TYPES = sorted(k for k, t in items.TYPES.items() if getattr(t, "module", None) == "measure")
check(len(TYPES) == 18, f"18 measure types (got {len(TYPES)}: {TYPES})")


# ---- every type at its defaults, its numbers' ends and each choice
def builds(key, props, what):
    try:
        doc, _ = items.build(scene([{"id": "a", "type": key, "x": 1.0, "y": 1.0, "props": props}]))
    except Exception as e:  # noqa: BLE001
        check(False, f"{key} {what}: raised {type(e).__name__}: {e}")
        return None
    mine = [s for s in doc["solids"] if s["item"] == "a"]
    procs = [p for p in doc.get("processes") or [] if p.get("item") == "a"]
    check(mine or procs, f"{key} {what}: builds solids or a process")
    for s in mine:
        if s.get("ghost") is True:
            # (the pan balance's beam, pointer, gravity bob and pan hangers move: ghosts so they pass in front of the post and what is dropped
            # into a pan passes the beam over it)
            moving = key == "pan-balance" and s["id"] in ("a/beam", "a/pointer", "a/bob", "a/hanger-left", "a/hanger-right")
            check(s["kind"] == "static" or moving, f"{key} {what}: its ghost {s['id']} is static")
    return doc


for key in TYPES:
    t = items.TYPES[key]
    check(t.category == M.CAT, f"{key} is in the {M.CAT} category")
    check(isinstance(t.description, str) and len(t.description) > 20, f"{key} has a description")
    builds(key, {}, "at its defaults")
    for p in t.props:
        if p.kind in ("number", "int"):
            for v in (p.lo, p.hi):
                if v is not None:
                    builds(key, {p.key: v}, f"{p.key} = {v}")
        elif p.kind == "choice":
            for v in p.choices:
                builds(key, {p.key: v}, f"{p.key} = {v!r}")
        elif p.kind == "bool":
            for v in (True, False):
                builds(key, {p.key: v}, f"{p.key} = {v}")

# ---- materials: real densities, cited
check(items.MATERIALS["asphalt"]["density"] == 2360 and "[ASPHALT]" in items.MATERIALS["asphalt"]["source"], "asphalt 2360 kg/m³, cited")
check(items.MATERIALS["brass"]["density"] == 8400 and "[OIML-R111]" in items.MATERIALS["brass"]["source"], "brass 8400 kg/m³ (OIML R111), cited")

# ---- brass masses weigh their nominal grams
for size in M.GRAM_SIZES:
    doc, res = items.build(scene([{"id": "g", "type": "gram-mass", "x": 1.0, "y": 0.0, "props": {"grams": size}}]))
    s = next(s for s in doc["solids"] if s["item"] == "g")
    b = s["body"]
    mat = doc["materials"][s["material"]]
    kg = mat["density"] * b["width"] * b["height"] * b["depth"]
    want = float(size.split()[0]) * (1.0 if size.endswith("kg") else 0.001)
    check(abs(kg - want) <= want * 1e-5, f"the {size} brass mass weighs {want} kg (got {kg:.6g})")

# ---- a spring scale's spring: full scale over 10 cm, damped at 0.3 of critical
for rng in M.SCALE_RANGES:
    doc, _ = items.build(scene([{"id": "s", "type": "spring-scale", "x": 1.0, "y": 1.8, "props": {"range": rng}}]))
    j = next(j for j in doc["joints"] if j.get("kind") == "spring")
    k = float(rng.split()[0]) / 0.10
    check(abs(j["stiffness"] - k) < 1e-9, f"{rng} scale: {k} N/m (got {j['stiffness']})")
    m = 0.5 * float(rng.split()[0]) / M.G + 0.012
    check(abs(j["damping"] / (2 * math.sqrt(k * m)) - 0.3) < 1e-4, f"{rng} scale: damping ratio 0.3")

# ---- overlaps leave ghosts out; a solid stopwatch on the table is not a ghost
blk = {"id": "blk", "type": "wooden-block", "x": 1.0, "y": 1.0, "props": {}}
sc = scene([blk, {"id": "sw", "type": "stopwatch", "x": 1.0, "y": 1.0, "props": {}}])
doc, _ = items.build(sc)
check(not any("sw" in w["items"] and (" overlap" in w["text"] or " inside " in w["text"]) for w in items.overlaps(sc, doc)), "a stopwatch's face over a block is not an overlap (a ghost)")
sc = scene([blk, {"id": "sw", "type": "stopwatch", "x": 1.0, "y": 1.0, "props": {"on_table": True}}])
doc, _ = items.build(sc)
check(any(s["item"] == "sw" and s.get("ghost") is not True for s in doc["solids"]), "a stopwatch on the table is a solid thing")


# ---- the goal kinds on hand-made tracks: two blocks on 10 m lanes, red at 10/3 m/s, blue at 2.5 m/s from the release (0.5 s)
def race(goals, red_v=10 / 3, blue_v=2.5):
    sc = scene([
        {"id": "top", "type": "lane", "x": 0.0, "y": 0.82, "props": {}},
        {"id": "bottom", "type": "lane", "x": 0.0, "y": 0.02, "props": {}},
        {"id": "red", "type": "wooden-block", "x": -0.05, "y": 0.82, "name": "Red", "props": {}},     # (its front at 0 m: a 10 cm block)
        {"id": "blue", "type": "wooden-block", "x": -0.05, "y": 0.02, "name": "Blue", "props": {}},
        {"id": "sw-red", "type": "stopwatch", "x": 10.0, "y": 1.4, "props": {"watch": "red", "finish_line": "top"}},
        {"id": "sw-blue", "type": "stopwatch", "x": 10.0, "y": 0.6, "props": {"watch": "blue", "finish_line": "bottom"}},
    ], goals=goals)
    doc, _ = items.build(sc)
    dyn = {s["id"]: s for s in doc["solids"] if s["kind"] == "dynamic"}
    T = [round(k / 100, 2) for k in range(501)]
    v = {"red": red_v, "blue": blue_v}
    frames = [{"t": t, "placements": {sid: {"x": s["at"]["x"] + v[s["item"]] * max(0.0, t - 0.5), "y": s["at"]["y"], "angle": 0.0} for sid, s in dyn.items()}}
              for t in T]
    stop = {"red": 0.5 + 10 / red_v, "blue": 0.5 + 10 / blue_v}
    state = {f"sw-{c}": {"seconds": [round(min(max(0.0, t - 0.5), stop[c] - 0.5), 5) for t in T]} for c in ("red", "blue")}
    return items.summarize(sc, doc, {"frames": frames, "state": state})["goals"]


g = race([
    {"kind": "reads", "item": "sw-red", "seconds": 3},
    {"kind": "reads", "item": "sw-blue", "seconds": 3},
    {"kind": "reads", "item": "sw-blue", "seconds": 4, "tol": 0.001},
    {"kind": "crosses", "item": "red", "line": "top", "before_s": 3.6},
    {"kind": "crosses", "item": "blue", "line": "bottom", "before_s": 3.6},
    {"kind": "crosses", "item": "blue", "x": 6.0},
    {"kind": "faster", "a": "red", "b": "blue"},
    {"kind": "faster", "a": "blue", "b": "red", "line": "top"},
    {"kind": "farther", "a": "red", "b": "blue"},
    {"kind": "farther", "a": "blue", "b": "red"},
    {"kind": "stops_between", "item": "blue", "x0": 11, "x1": 11.5},
    {"kind": "stops_between", "item": "red", "x0": 0, "x1": 10},
    {"kind": "reads", "item": "nobody", "seconds": 3},
])
check([x["ok"] for x in g] == [True, False, True, True, False, True, True, False, True, False, True, False], f"goal results {[x['ok'] for x in g]}")
check(len(g) == 12, "a goal naming no item is left out")
check(abs(g[3]["t"] - 3.5) < 1e-3 and abs(g[4]["t"] - 4.5) < 1e-3 and abs(g[5]["t"] - 2.9) < 1e-3, f"crossing times 3.5 / 4.5 / 2.9 s (got {g[3]['t']}, {g[4]['t']}, {g[5]['t']})")
check(g[0]["got"] == 3.0 and g[0]["key"] == "seconds", "a stopwatch reads its seconds")
check(abs(g[10]["x"] - (-0.05 + 2.5 * 4.5)) < 1e-6, f"blue's middle ends at 11.2 m (got {g[10]['x']})")
check(g[6]["label"] == "Red is faster than Blue" and g[8]["label"] == "Red goes farther than Blue", "labels name the racers")

# ---- links that name nothing are the layout's warnings (and only those); a stopwatch with nothing to watch but a clock's rules is a clock
sc = scene([{"id": "lane", "type": "lane", "x": 0.0, "y": 0.02, "props": {}}, {"id": "car", "type": "wooden-block", "x": -0.05, "y": 0.02, "props": {}},
            {"id": "sw", "type": "stopwatch", "x": 10.0, "y": 1.0, "name": "Red stopwatch", "props": {"watch": "no-such-car", "finish_line": "car"}},
            {"id": "sw2", "type": "stopwatch", "x": 10.0, "y": 1.0, "props": {"watch": "sw2", "stop": "at"}},
            {"id": "sw3", "type": "stopwatch", "x": 10.0, "y": 1.0, "props": {}},
            {"id": "sw4", "type": "stopwatch", "x": 10.0, "y": 1.0, "props": {"stop": "never"}},
            {"id": "ok", "type": "stopwatch", "x": 10.0, "y": 1.0, "props": {"watch": "car", "finish_line": "lane"}},
            {"id": "tr", "type": "motion-trail", "x": 0.0, "y": 2.0, "props": {}}])
doc, _ = items.build(sc)
W = [w for w in items.overlaps(sc, doc) if not (" overlap" in w["text"] or " inside " in w["text"])]
texts = [w["text"] for w in W]
check(any(w["items"] == ["sw"] and 'watch link names "no-such-car", which is no item of this scene, so it times nothing' in w["text"] for w in W), f"a watch naming no item is warned ({texts})")
check(any(w["items"] == ["sw"] and "finish line link names a wooden block: it takes a start line, a finish line or a lane" in w["text"] for w in W), f"a finish line of the wrong kind is warned ({texts})")
check(any(w["items"] == ["sw2"] and "names itself, so it runs as a plain clock" in w["text"] for w in W), "a watch naming itself is warned (a clock)")
check(any(w["items"] == ["sw3"] and "has no watch link" in w["text"] for w in W), "a stopwatch that needs a watch and has none is warned")
check(not any(w["items"] in (["sw4"], ["ok"]) for w in W), "a plain clock and a well-linked stopwatch are not warned")
check(any(w["items"] == ["tr"] for w in W), "a trail with nothing linked is warned")
check(len(W) == 5, f"5 link warnings (got {len(W)})")
recs = {p["id"]: p for p in doc["processes"]}
check(recs["lane/marks"] == {"kind": "measure-mark", "id": "lane/marks", "item": "lane", "zero": 0.0, "start": 0.0, "finish": 10.0}, f"a lane's marks record ({recs.get('lane/marks')})")
check(any(s["id"] == "lane/stop" for s in doc["solids"]), "a lane has a foam bumper at its far end")
sc = scene([{"id": "lane", "type": "lane", "x": 0.0, "y": 0.02, "props": {"margin": 0.05}}])
doc, _ = items.build(sc)
check(not any(s["id"] == "lane/stop" for s in doc["solids"]), "no bumper on a lane with under 10 cm of floor past its end")

# ---- a spring scale's hook bottoms out 5 mm past full scale; a balance's pans are listed for what they hold
for rng in ("2.5 N", "50 N"):
    doc, _ = items.build(scene([{"id": "nm", "type": "spring-scale", "x": 1.0, "y": 1.0, "props": {"range": rng}}]))
    rec = next(p for p in doc["processes"] if p["kind"] == "measure-spring")
    r = float(rng.split()[0])
    check(rec["range"] == r and abs(rec["stop"] - round(0.02 + (r + 0.012 * 9.81) / (r / 0.1) + 0.005, 5)) < 1e-12, f"{rng} scale: its stop {rec['stop']} m")
    check(next(s for s in doc["solids"] if s["id"] == "nm/case").get("stand") == "self", f"{rng} scale: its stand is its own (a retort stand drawn)")
doc, _ = items.build(scene([{"id": "b", "type": "pan-balance", "x": 1.0, "y": 0.0, "props": {}}]))
rec = next(p for p in doc["processes"] if p["kind"] == "measure-balance")
check(rec["left"] == ["b/pan-left", "b/lip-left-l", "b/lip-left-r"] and rec["right"] == ["b/pan-right", "b/lip-right-l", "b/lip-right-r"], "the balance's pans in its record")
bob = next(s for s in doc["solids"] if s["id"] == "b/bob")
b = bob["body"]
dens = doc["materials"][bob["material"]]["density"] if isinstance(bob["material"], str) else bob["material"]["density"]
check(abs(dens * b["width"] * b["height"] * b["depth"] - M.BOB_KG) < 1e-6, f"its gravity bob weighs BOB_KG ({dens})")
pans = [s for s in doc["solids"] if s["id"] in ("b/pan-left", "b/pan-right")]
hang = {s["id"]: s for s in doc["solids"] if s["id"] in ("b/hanger-left", "b/hanger-right")}
check(len(pans) == 2 and all(abs(hang[s["parent"]]["at"]["y"] + s["at"]["y"] - (0.25 - 0.12 - 0.002)) < 1e-9 for s in pans), "its pans hang 12 cm under the beam")

# ---- a board reads each linked thing's main reading, with its unit
doc, res = items.build(scene([{"id": "ks", "type": "kitchen-scale", "x": 1.0, "y": 0.0, "props": {}}, {"id": "sw", "type": "stopwatch", "x": 2.0, "y": 1.0, "props": {"stop": "never"}},
                              {"id": "gb", "type": "graph-board", "x": 2.0, "y": 0.0, "props": {"plot": "reading", "watch": "ks", "watch2": "sw"}}]))
check(res["gb"]["reads"] == {"ks": {"key": "grams", "unit": "g", "label": "Reads", "digits": 0}, "sw": {"key": "seconds", "unit": "s", "label": "Time", "digits": 2}}, f"board reads ({res['gb']['reads']})")

print(f"{N[0] - len(FAILS)} of {N[0]} checks pass" + ("" if FAILS else ": ALL PASS"))
sys.exit(1 if FAILS else 0)
