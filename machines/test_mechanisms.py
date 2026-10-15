"""Guard for the Phase 2 catalog (machines/catalog_mechanisms.py): springs, ropes, pulleys, wheels, motors, belts.
usage: python3 machines/test_mechanisms.py [type-key ... | scenario:<id> | shapes ...]      (prints a pass/fail table; exits 1 if anything fails)

Every new item type is built alone on the table with items.build and run through research/poc/dense_track.ts at 120 Hz, as
machines/test_rg.py does; then again with the probes it needs (a ball to fling, a ramp to roll down); so is every new scenario
(web/scenarios/*.json). Per run
  alone    built by itself: it builds, the engine runs it, no NaN, no speed above 40 m/s, nothing dynamic sinks over 2 cm into the table,
           and the engine has no complaint (a spring too stiff for its steps)
  behaves  the same with the probes, and one check against textbook physics or the one thing the item is for:
           the spring weight bounces with period 2π√(m/k); pendulum, swing and wrecking ball swing as theory says; the Atwood weights accelerate
           at g(m1-m2)/(m1+m2), the heavier one down; cars roll down a ramp at about g sin θ and a motor car drives right; a disc and a hoop roll
           down a ramp at g sin θ/(1 + k); the conveyor carries a block at the belt's speed; the spinner turns at its set speed; the launcher,
           catapult and flipper fling a ball, the pad and trampoline bounce one back up, the bumper rings at 2π√(m/k); a chain hangs on its catenary.
Documents are written to scenes/.test-mech-* and removed after, as machines/test_catalog.py does.
"""
import concurrent.futures as cf
import itertools
import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import items  # noqa: E402

CATEGORIES = ("Springs & ropes", "Wheels & vehicles", "Motors & belts")
NEW_SCENARIOS = ("car-ramp-dominoes", "trampoline", "atwood", "conveyor-delivery", "wrecking-ball", "spring-launch")
STAGE = {"x0": -0.55908203125, "x1": 3.19091796875, "y0": -0.15625, "y1": 2.34375}
TABLE = {"id": "table", "type": "table", "name": "Table", "x": 1.3, "y": 0.0, "props": {"width": 3.7, "thickness": 0.15}}
X0 = 1.3
TABLE_X0, TABLE_X1 = X0 - 3.7 / 2, X0 + 3.7 / 2
G = 9.81
FLIPPER_MASS_KG = 0.04
FIRST = "m"                    # the id of the item under test
MAX_SPEED = 40.0               # m/s
MAX_SINK = 0.02                # m


def scene_of(its, name, seconds=4.0, release=0.5):
    return {"version": 2, "id": name, "name": name, "seconds": seconds, "release": release, "stage": STAGE, "items": [TABLE] + list(its), "goals": []}


# ---------------------------------------------------------------- geometry
def corners(b):
    """The corner points (x, y) of a slab or polygon body, in its own frame."""
    if b["kind"] == "polygon":
        return [(p["x"], p["y"]) for p in b["points"]]
    hw, hh = b["width"] / 2, b["height"] / 2
    return [(px, py) for px in (-hw, hw) for py in (-hh, hh)]


def extent_x(s, pose):
    """(leftmost, rightmost) point of a solid at a pose."""
    x, y, a = pose
    b = s["body"]
    if b["kind"] == "ball":
        return x - b["radius"], x + b["radius"]
    c, n = math.cos(a), math.sin(a)
    xs = [x + px * c - py * n for px, py in corners(b)]
    return min(xs), max(xs)


def extent_low(s, pose):
    x, y, a = pose
    b = s["body"]
    if b["kind"] == "ball":
        return y - b["radius"]
    c, n = math.cos(a), math.sin(a)
    return min(y + px * n + py * c for px, py in corners(b))


def item_of(key, **kw):
    d = {"id": FIRST, "type": key, "x": X0, "y": 0.0, "angle": 0.0, "props": {}}
    d.update(kw)
    return d


def ramp(angle_deg, length=1.5, x=X0):
    """A plank sloping down to the right at angle_deg, its lower end just on the table; -> (item, top-surface point at s metres along it)."""
    th = 0.022
    a = math.radians(-angle_deg)
    cy = (length / 2) * math.sin(angle_deg * math.pi / 180) + (th / 2) * math.cos(a)
    item = {"id": "ramp", "type": "plank", "x": x, "y": round(cy, 5), "angle": -angle_deg, "props": {"length": length, "thickness": th}}

    def top(s):
        return (x + s * math.cos(a) - (th / 2) * math.sin(a), cy + s * math.sin(a) + (th / 2) * math.cos(a))
    return item, top


# ---------------------------------------------------------------- running one scene
_serial = itertools.count(1)


def simulate(doc):
    """The engine's track for a document, sampled at 120 Hz (the document goes into scenes/ and is removed after)."""
    stem = f".test-mech-{os.getpid()}-{next(_serial)}"
    path = os.path.join(PG, "scenes", stem + ".json")
    out = os.path.join(PG, "research", "tmp", stem + "-out.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(doc, open(path, "w"))
    try:
        r = subprocess.run(["node", "--no-warnings", os.path.join(PG, "research", "poc", "dense_track.ts"), path, "120", out], capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            raise RuntimeError(((r.stderr or r.stdout).strip().splitlines() or ["engine failed"])[-1][:200])
        return json.load(open(out)), r.stderr.strip()
    finally:
        for f in (path, out):
            if os.path.exists(f):
                os.remove(f)


def run(job):
    name, sc = job
    res = {"name": name, "scene": sc}
    try:
        doc, _ = items.build(sc)
        res["doc"] = doc
        res["track"], res["warn"] = simulate(doc)
    except Exception as e:  # noqa: BLE001 (any failure is a failed row, not a crash)
        res["error"] = f"{type(e).__name__}: {e}"[:200]
    return res


def series(res, sid):
    return [(f["t"], f["placements"][sid]) for f in res["track"]["frames"]]


def xy(res, sid):
    return [(t, p["x"], p["y"]) for t, p in series(res, sid)]


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
            lo, hi = extent_x(s, (p["x"], p["y"], p["angle"]))
            if TABLE_X0 <= lo and hi <= TABLE_X1:      # past the table's edge it is meant to fall
                sink = max(sink, -extent_low(s, (p["x"], p["y"], p["angle"])))
    vmax = max([vmax] + [h["speed"] for h in track.get("impacts", [])])
    checks = {"finite": (not nan, "NaN in the track"), "speed": (vmax <= MAX_SPEED, f"{vmax:.1f} m/s"),
              "sink": (sink <= MAX_SINK, f"sank {sink * 1000:.1f} mm")}
    if res.get("warn"):
        checks["warnings"] = (False, res["warn"].splitlines()[0][:120])
    return checks


def crossings(vals, ts, level=0.0, up=True):
    """Times where vals crosses level (upwards or downwards), linearly interpolated."""
    out = []
    for k in range(1, len(vals)):
        a, b = vals[k - 1] - level, vals[k] - level
        if (a < 0 <= b) if up else (a > 0 >= b):
            out.append(ts[k - 1] + (ts[k] - ts[k - 1]) * (-a / (b - a)))
    return out


def period_of(vals, ts, level, t_from=0.0):
    pairs = [(t, v) for t, v in zip(ts, vals) if t >= t_from]
    cr = crossings([v for _, v in pairs], [t for t, _ in pairs], level)
    return (cr[-1] - cr[0]) / (len(cr) - 1) if len(cr) >= 3 else None


def fit_accel(ts, xs, t0, t1):
    """Least-squares a in x = x0 + v0 t + ½ a t² over t0 <= t <= t1."""
    pts = [(t - t0, x) for t, x in zip(ts, xs) if t0 <= t <= t1]
    S = [sum(t ** p for t, _ in pts) for p in range(5)]
    B = [sum(x * t ** p for t, x in pts) for p in range(3)]
    M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]]

    def det(m):
        return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))
    M2 = [[M[i][0], M[i][1], B[i]] for i in range(3)]
    return 2 * det(M2) / det(M)


def within(got, want, tol):
    return abs(got - want) <= tol * abs(want)


# ---------------------------------------------------------------- one test case per type: (items, seconds, check)
def P_of(key, props=None):
    return dict(items.TYPES[key].defaults(), **(props or {}))


def case_hanging_spring():
    its = [item_of("hanging-spring", y=1.2)]

    def check(res):
        P = P_of("hanging-spring")
        ys = [p["y"] for _, p in series(res, f"{FIRST}/weight")]
        ts = [t for t, _ in series(res, f"{FIRST}/weight")]
        mid = sum(ys) / len(ys)
        T = period_of(ys, ts, mid, 0.5)
        zeta = P["damping"] / (2 * math.sqrt(P["stiffness"] * P["weight"]))
        want = 2 * math.pi * math.sqrt(P["weight"] / P["stiffness"]) / math.sqrt(1 - zeta * zeta)
        return T is not None and within(T, want, 0.02), f"period {T and round(T, 3)} s vs 2π√(m/k) = {want:.3f} s"
    return its, 4.0, check


def case_pendulum_like(key, props=None):
    props = props or {}
    its = [item_of(key, y=1.3, props=props)]

    def check(res):
        P = P_of(key, props)
        sid = f"{FIRST}/bob"
        ser = series(res, sid)
        L, a0 = P["length"], math.radians(abs(P["start_angle"]))
        ang = [math.atan2(p["x"] - X0, -(p["y"] - 1.3)) for _, p in ser]
        ts = [t for t, _ in ser]
        T = period_of(ang, ts, 0.0, 0.5)
        want = 2 * math.pi * math.sqrt(L / G) * (1 + a0 * a0 / 16 + 11 * a0 ** 4 / 3072)
        vmax = max(math.hypot(b["x"] - a["x"], b["y"] - a["y"]) / (tb - ta) for (ta, a), (tb, b) in zip(ser, ser[1:]) if tb > 0.5 and tb - ta > 0.004)
        vwant = math.sqrt(2 * G * L * (1 - math.cos(a0)))
        ok = T is not None and within(T, want, 0.03) and within(vmax, vwant, 0.1)
        return ok, f"period {T and round(T, 3)} s vs {want:.3f} s; fastest {vmax:.2f} m/s vs √(2gL(1−cosθ)) = {vwant:.2f}"
    return its, 6.0, check


def case_swing():
    its = [item_of("swing", y=1.3)]

    def check(res):
        P = P_of("swing")
        ser = series(res, f"{FIRST}/seat")
        L, a0 = P["rope_length"], math.radians(abs(P["start_angle"]))
        ang = [math.atan2(p["x"] - X0, -(p["y"] - 1.3)) for _, p in ser]
        T = period_of(ang, [t for t, _ in ser], 0.0, 0.5)
        want = 2 * math.pi * math.sqrt(L / G) * (1 + a0 * a0 / 16)
        tilt = max(abs(p["angle"]) for _, p in ser)
        return T is not None and within(T, want, 0.03) and tilt < math.radians(5), f"period {T and round(T, 3)} s vs {want:.3f} s; seat tilts at most {math.degrees(tilt):.1f}°"
    return its, 7.0, check


def case_chain():
    its = [item_of("hanging-chain", y=0.9)]

    def check(res):
        P = P_of("hanging-chain")
        S, Lc, n = P["span"], max(P["chain_length"], P["span"] * 1.02), int(P["links"])
        lo, hi = 1e-6, 60.0
        for _ in range(80):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if math.sinh(mid) / mid < Lc / S else (lo, mid)
        u = (lo + hi) / 2
        sag = (S / (2 * u)) * (math.cosh(u) - 1)
        end = res["track"]["frames"][-1]["placements"]
        ys = [end[f"{FIRST}/link{i + 1}"]["y"] for i in range(n)]
        got = 0.9 - min(ys)
        ends = (end[f"{FIRST}/link1"]["x"], end[f"{FIRST}/link{n}"]["x"])
        return within(got, sag, 0.1) and ends[0] < X0 < ends[1], f"lowest link {got * 100:.1f} cm below the posts vs catenary sag {sag * 100:.1f} cm"
    return its, 4.0, check


def case_atwood(key="atwood-machine", y=0.8):
    its = [item_of(key, y=y)]

    def check(res):
        P = P_of(key)
        m1, m2 = P["left_mass"], P["right_mass"]
        left, right = xy(res, f"{FIRST}/left"), xy(res, f"{FIRST}/right")
        ts = [t for t, _, _ in left]
        a_l = -fit_accel(ts, [y_ for _, _, y_ in left], 0.55, 0.85)
        a_r = fit_accel(ts, [y_ for _, _, y_ in right], 0.55, 0.85)
        want = G * (m1 - m2) / (m1 + m2)
        ok = within(a_l, want, 0.03) and within(a_r, want, 0.03)
        return ok, f"heavier ({m1} kg) falls at {a_l:.3f} m/s², lighter rises at {a_r:.3f}; g(m1−m2)/(m1+m2) = {want:.3f}"
    return its, 1.5, check


def lift_pail(doc):
    """The pulley lift's pail: (its parts' ids, its total mass, the rope's joint)."""
    rope = next(j for j in doc["joints"] if j["id"] == f"{FIRST}/rope")
    parts = [s["id"] for s in doc["solids"] if s["kind"] == "dynamic" and s["id"] != f"{FIRST}/weight"]
    return parts, sum(items_mass(doc, sid) for sid in parts), rope


def lift_crown(res, frame=-1):
    """Where the pail's rope is tied (the bail's crown), world (x, y), at a frame of the track."""
    rope = lift_pail(res["doc"])[2]
    p = res["track"]["frames"][frame]["placements"][rope["b"]]
    a = rope["anchorB"]
    return p["x"] + a["x"] * math.cos(p["angle"]) - a["y"] * math.sin(p["angle"]), p["y"] + a["x"] * math.sin(p["angle"]) + a["y"] * math.cos(p["angle"])


def case_pulley_lift():
    its = [item_of("pulley-lift", y=1.2)]      # (high enough that the pail reaches its wheel before the weight reaches the table)

    def check(res):
        doc = res["doc"]
        w, c0 = xy(res, f"{FIRST}/weight"), xy(res, f"{FIRST}/floor")
        fell, rose = w[0][2] - min(y for _, _, y in w), max(y for _, _, y in c0) - c0[0][2]
        # the pail rises as an Atwood machine's lighter weight does, a = g(m - mc)/(m + mc), and ends jammed square under its wheel: its rope's tie under the wheel's
        # axle (the ground point) and above where it started, the pail not turned or moved aside
        m, (_, mc, rope) = P_of("pulley-lift")["weight"], lift_pail(doc)
        ts = [t for t, _, _ in c0]
        a = fit_accel(ts, [y for _, _, y in c0], 0.55, 0.75)
        want = G * (m - mc) / (m + mc)
        cx, cy = lift_crown(res)
        tilt = max(abs(math.degrees(p["angle"])) for _, p in series(res, rope["b"]))
        drift = abs(c0[-1][1] - c0[0][1])
        ok = fell > 0.15 and within(rose, fell, 0.1) and within(a, want, 0.03) and rope["groundB"]["y"] - 0.06 < cy < rope["groundB"]["y"] - 0.004 and tilt < 3 and drift < 0.005
        return ok, (f"weight falls {fell * 100:.0f} cm, the {mc * 1000:.0f} g pail rises {rose * 100:.0f} cm at {a:.3f} m/s² (g(m−mc)/(m+mc) = {want:.3f}), its rope's tie "
                    f"ends {(rope['groundB']['y'] - cy) * 1000:.0f} mm under the wheel's axle, turned at most {tilt:.1f}°, {drift * 1000:.1f} mm aside")
    return its, 2.0, check


# the Atwood machine at 60:1, either way round, a short and a long drop: the light weight is hauled up fast and jams square under the wheel, never inside its rim
ATWOOD_JAMS = [(3.0, 0.05, 0.45, 1.2), (0.05, 3.0, 2.0, 4.6)]


def case_atwood_jam(m1, m2, drop, y):
    its = [item_of("atwood-machine", y=y, props={"left_mass": m1, "right_mass": m2, "drop": drop})]

    def check(res):
        doc = res["doc"]
        light = f"{FIRST}/{'right' if m1 > m2 else 'left'}"
        s = next(s_ for s_ in doc["solids"] if s_["id"] == light)["body"]["width"]
        rope = next(j for j in doc["joints"] if j["kind"] == "pulley")
        cx, gy = (rope["groundA"]["x"] + rope["groundB"]["x"]) / 2, rope["groundA"]["y"]
        rim = abs(rope["groundB"]["x"] - rope["groundA"]["x"]) / 2 - 0.0005          # the drawn wheel's rim
        inside, tilt = -1.0, 0.0
        for _, p in series(res, light):
            tilt = max(tilt, abs(math.degrees(p["angle"])))
            for lx in (-s / 2, s / 2):
                X = p["x"] + lx * math.cos(p["angle"]) - (s / 2) * math.sin(p["angle"])
                Y = p["y"] + lx * math.sin(p["angle"]) + (s / 2) * math.cos(p["angle"])
                inside = max(inside, rim - math.hypot(X - cx, Y - gy))
        top = gy - (series(res, light)[-1][1]["y"] + s / 2)
        return inside < 0 and tilt < 1 and 0.004 < top < 0.06, f"the light weight ends {top * 1000:.0f} mm under the axle, turned at most {tilt:.1f}°, {-inside * 1000:.1f} mm clear of the wheel's rim at its nearest"
    return its, 3.0, check


# the pulley lift at the corners of its sliders (the pail's width and height, the falling weight): a light pail is hauled up and jams under its wheel, a heavy one falls
# onto the table or jams the weight under its wheel; nothing flies apart (a narrow, tall pail once left at 1100 m/s), the pail never turns over and ends upright
LIFT_GRID = [(w, h, m) for w in (0.04, 0.08, 0.3) for h in (0.03, 0.15, 0.3) for m in (0.05, 0.3, 3.0)]


def case_lift_grid(w, h, m):
    its = [item_of("pulley-lift", y=1.2, props={"cup_width": w, "cup_height": h, "weight": m})]

    def check(res):
        rope = lift_pail(res["doc"])[2]
        ang = [math.degrees(p["angle"]) for _, p in series(res, rope["b"])]
        cx, cy = lift_crown(res)
        ok = max(abs(a) for a in ang) < 30 and abs(ang[-1]) < 8 and cy < rope["groundB"]["y"] - 0.004
        return ok, f"pail turned at most {max(abs(a) for a in ang):.1f}°, ends at {ang[-1]:.1f}°, its rope's tie {(rope['groundB']['y'] - cy) * 1000:.0f} mm under the wheel's axle"
    return its, 3.0, check


def case_launcher():
    key = "spring-launcher"
    P = P_of(key)
    rest, comp, th = P["rest_length"], P["compression"], 0.008
    r = items.TYPES["golf-ball"].defaults()["diameter"] / 2
    its = [item_of(key, y=0.02), {"id": "ball", "type": "golf-ball", "x": X0, "y": round(0.02 + rest - comp + th + r + 0.0005, 5)}]

    def check(res):
        b = xy(res, "ball/ball")
        top = max(y for _, _, y in b) - b[0][2]
        # energy: ½ k x² into a plate and a ball, less what the weights gain going up the spring's stroke
        mp = items.MATERIALS[P["material"]]["density"] * P["width"] * th * P["depth"]
        mb = items.TYPES["golf-ball"].defaults()["mass"]
        v2 = 2 * (0.5 * P["stiffness"] * comp ** 2 - (mp + mb) * G * comp) / (mp + mb)
        want = v2 / (2 * G)
        # the spring's energy is a ceiling (a launcher that rose 131 cm of a 102 cm budget was a bug: resting contacts were bounced every step)
        return 0.5 * want < top < 1.05 * want and top > 0.3, f"ball rises {top * 100:.0f} cm (energy balance, no drag: about {want * 100:.0f} cm)"
    return its, 2.5, check


def first_bounce(b, y0):
    """How far a ball rises after its first landing: b is [(t, x, y)], y0 where it started; -> (rise, y at the landing)."""
    ys, ts = [y for _, _, y in b], [t for t, _, _ in b]
    i = next((k for k in range(1, len(ys) - 1) if ts[k] > 0.55 and ys[k] <= ys[k - 1] and ys[k] < ys[k + 1] and ys[k] < y0 - 0.1), None)
    if i is None:
        return 0.0, y0
    # follow the rise to its peak: a ball resting on a thin, light mat chatters by a fraction of a millimetre while it still sits in the contact,
    # so the peak is where the ball has fallen 3 mm below the highest point it has reached since
    j = best = i + 1
    while j + 1 < len(ys) and ys[j + 1] >= ys[best] - 0.003:
        j += 1
        if ys[j] > ys[best]:
            best = j
    return ys[best] - ys[i], ys[i]


def case_pad():
    key = "bounce-pad"
    r = items.TYPES["tennis-ball"].defaults()["diameter"] / 2
    its = [item_of(key, y=0.02), {"id": "ball", "type": "tennis-ball", "x": X0, "y": round(0.02 + 0.08 + 0.004 + 0.3 + r, 5), "held": True}]

    def check(res):
        up, _ = first_bounce(xy(res, "ball/ball"), its[1]["y"])
        return up > 0.12, f"tennis ball dropped 30 cm bounces {up * 100:.0f} cm (on a plain wood floor it would: about 16)"
    return its, 3.0, check


def case_trampoline():
    key = "trampoline"
    r = items.TYPES["tennis-ball"].defaults()["diameter"] / 2
    its = [item_of(key), {"id": "ball", "type": "tennis-ball", "x": X0, "y": round(0.35 + 0.4 + r, 5), "held": True}]

    def check(res):
        up, _ = first_bounce(xy(res, "ball/ball"), its[1]["y"])
        mat = [y for _, _, y in xy(res, f"{FIRST}/mat")]
        return up > 0.08 and (max(mat) - min(mat)) > 0.005, f"tennis ball dropped 40 cm bounces {up * 100:.0f} cm; the mat moves {(max(mat) - min(mat)) * 1000:.0f} mm"
    return its, 3.5, check


def case_bumper():
    key = "spring-bumper"
    props = {"pushed_in": 0.04, "damping": 0.0}
    its = [item_of(key, props=props)]

    def check(res):
        P = P_of(key, props)
        pl = xy(res, f"{FIRST}/plate")
        ts, xs = [t for t, _, _ in pl], [x for _, x, _ in pl]
        T = period_of(xs, ts, X0 + P["rest_length"] + 0.015, 0.5)       # about the plate's position at the spring's rest length
        mass = items.MATERIALS[P["material"]]["density"] * 0.03 * P["height"] * P["depth"]
        want = 2 * math.pi * math.sqrt(mass / P["stiffness"])
        return T is not None and within(T, want, 0.05), f"plate rings with period {T and round(T, 3)} s vs 2π√(m/k) = {want:.3f} s"
    return its, 3.0, check


def case_gate():
    its = [item_of("spring-gate", y=1.0)]

    def check(res):
        ang = [math.degrees(p["angle"]) for _, p in series(res, f"{FIRST}/gate")]
        ts = [t for t, _ in series(res, f"{FIRST}/gate")]
        T = period_of(ang, ts, 0.0, 0.5)
        return min(ang) < -15 and max(ang) < 41 and T is not None, f"swings {min(ang):.0f}° to {max(ang):.0f}° from 40°, period {T and round(T, 2)} s"
    return its, 4.0, check


def case_catapult():
    key = "spring-catapult"
    P = P_of(key)
    L, a, H0 = P["arm_length"], math.radians(P["cocked_angle"]), P["post_height"]
    r = items.TYPES["golf-ball"].defaults()["diameter"] / 2
    # the ball sits on the arm's long end (left), against its lip: arm frame (−L/2 + 0.008 + r, 0.01 + r)
    ax, ay = -0.2 * L * math.cos(a), H0 - 0.2 * L * math.sin(a)
    lx, ly = -L / 2 + 0.008 + r + 0.001, 0.01 + r + 0.0005
    bx, by = ax + lx * math.cos(a) - ly * math.sin(a), ay + lx * math.sin(a) + ly * math.cos(a)
    its = [item_of(key, y=0.02), {"id": "ball", "type": "golf-ball", "x": round(X0 + bx, 5), "y": round(0.02 + by, 5)}]

    def check(res):
        b = xy(res, "ball/ball")
        dx = max(x for _, x, _ in b) - b[0][1]
        dy = max(y for _, _, y in b) - b[0][2]
        return dx > 0.3 and dy > 0.1, f"ball flung {dx * 100:.0f} cm to the right and {dy * 100:.0f} cm up"
    return its, 1.5, check


def case_vehicle(key, down=True):
    ang = 10.0
    rp, top = ramp(ang)
    P = P_of(key)
    px, py = top(-0.5)
    its = [rp, item_of(key, x=round(px, 5), y=round(py, 5), angle=-ang)]

    def check(res):
        c = xy(res, f"{FIRST}/chassis")
        d = math.hypot(c[-1][1] - c[0][1], c[-1][2] - c[0][2])
        ts = [t for t, _, _ in c]
        s = [(x - c[0][1]) * math.cos(math.radians(ang)) - (y - c[0][2]) * math.sin(math.radians(ang)) for _, x, y in c]
        a = fit_accel(ts, s, 0.9, 1.5)
        # all the weight: body (and its cabin) plus two wheels, each wheel's spin adding m/2 to what the slope accelerates
        doc = res["doc"]
        mass = lambda sid: items_mass(doc, sid)   # noqa: E731
        total = sum(mass(s_["id"]) for s_ in doc["solids"] if s_["item"] == FIRST)
        spin = 0.5 * (mass(f"{FIRST}/front") + mass(f"{FIRST}/rear"))
        rr = items.MATERIALS[P["material"]]["rolling"]          # what the wheels' rolling resistance takes off the pull of the slope
        want = G * (math.sin(math.radians(ang)) - rr * math.cos(math.radians(ang))) * total / (total + spin)
        ok = c[-1][1] > c[0][1] + 0.3 and within(a, want, 0.06)
        return ok, f"rolls {d * 100:.0f} cm down a 10° ramp, accelerating at {a:.2f} m/s² vs g(sin θ − C cos θ)·M/(M+Σmr²/2r²) = {want:.2f}"
    return its, 2.5, check


def items_mass(doc, sid):
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


def case_motor_car():
    key = "motor-car"
    its = [item_of(key)]

    def check(res):
        c = xy(res, f"{FIRST}/chassis")
        P = P_of(key)
        v = (c[-1][1] - c[-12][1]) / (c[-1][0] - c[-12][0])
        return c[-1][1] > c[0][1] + 0.5 and within(v, P["speed"], 0.05), f"drives {(c[-1][1] - c[0][1]) * 100:.0f} cm to the right, at {v:.2f} m/s (top speed {P['speed']})"
    return its, 1.7, check


def case_disc(key):
    ang = 10.0
    rp, top = ramp(ang)
    P = P_of(key)
    r = P["diameter"] / 2
    px, py = top(-0.5)
    nx, ny = math.sin(math.radians(ang)), math.cos(math.radians(ang))
    its = [rp, item_of(key, x=round(px + nx * (r + 0.001), 5), y=round(py + ny * (r + 0.001), 5))]
    k = P["inertia"] if "inertia" in P else 0.5

    def check(res):
        w = xy(res, f"{FIRST}/wheel")
        ts = [t for t, _, _ in w]
        s = [(x - w[0][1]) * math.cos(math.radians(ang)) - (y - w[0][2]) * math.sin(math.radians(ang)) for _, x, y in w]
        a = fit_accel(ts, s, 0.7, 1.3)
        want = G * math.sin(math.radians(ang)) / (1 + k)
        return 0.85 * want <= a <= 1.02 * want, f"rolls down a 10° ramp at {a:.2f} m/s² vs g sin θ/(1 + {k}) = {want:.2f}"
    return its, 2.0, check


def case_spinner():
    its = [item_of("motor-spinner", y=0.6)]

    def check(res):
        P = P_of("motor-spinner")
        ser = series(res, f"{FIRST}/paddle")
        a = [p["angle"] for _, p in ser]
        i, j = next(k for k, (t, _) in enumerate(ser) if t >= 1.0), next(k for k, (t, _) in enumerate(ser) if t >= 3.0)
        w = (a[j] - a[i]) / (ser[j][0] - ser[i][0])
        want = P["rpm"] * 2 * math.pi / 60
        return within(w, want, 0.01), f"turns at {w:.3f} rad/s vs {want:.3f} (the {P['rpm']:g} turns/min set)"
    return its, 3.5, check


def case_conveyor():
    key = "conveyor-belt"
    its = [item_of(key, y=0.04), {"id": "block", "type": "wooden-block", "x": round(X0 - 0.45, 5), "y": 0.045 + 0.026}]

    def check(res):
        P = P_of(key)
        b = xy(res, "block/block")
        i = next(k for k, (t, _, _) in enumerate(b) if t >= 0.95)
        v = (b[i + 12][1] - b[i][1]) / (b[i + 12][0] - b[i][0])
        return within(v, P["speed"], 0.05) and b[-1][1] > b[0][1] + 0.5, f"block rides at {v:.2f} m/s vs belt {P['speed']} m/s, carried {(b[-1][1] - b[0][1]) * 100:.0f} cm"
    return its, 2.0, check


def case_flipper():
    key = "pinball-flipper"
    P = P_of(key)
    r = items.TYPES["steel-ball"].defaults()["diameter"] / 2
    a = math.radians(P["rest_angle"])
    u, n = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
    s = 0.045      # along the bat from the hinge (the bat is 78 mm long, its tip 64 mm out)
    # the bat tapers (a polygon): the ball rests on its top edge, read from the built item
    doc, _ = items.build({"stage": STAGE, "items": [dict(item_of(key), y=0.4)]})
    bat = sorted((p["x"], p["y"]) for p in next(o for o in doc["solids"] if o["id"] == f"{FIRST}/flipper")["body"]["points"] if p["y"] > 0)
    xl = s - (P["length"] / 2 - 0.014)                          # along the bat from its middle (the hinge is 14 mm in from its end)
    hy = next(y0 + (y1 - y0) * (xl - x0) / (x1 - x0) for (x0, y0), (x1, y1) in zip(bat, bat[1:]) if x0 <= xl <= x1)
    its = [item_of(key, y=0.4), {"id": "ball", "type": "steel-ball", "x": round(X0 + s * u[0] + (hy + r + 0.0005) * n[0], 5), "y": round(0.4 + s * u[1] + (hy + r + 0.0005) * n[1], 5)}]

    def check(res):
        fl = [math.degrees(p["angle"]) for _, p in series(res, f"{FIRST}/flipper")]
        b = xy(res, "ball/ball")
        turned = max(fl) - fl[0]
        up = max(y for _, _, y in b) - b[0][2]
        return abs(turned - P["sweep"]) < 4 and up > 0.1, f"flipper turns {turned:.0f}° of {P['sweep']:g}; the steel ball is thrown {up * 100:.0f} cm up"
    return its, 2.0, check


HANGING = {"hanging-spring": 1.2, "spring-gate": 1.0, "rope-pendulum": 1.3, "wrecking-ball": 1.3, "swing": 1.3, "hanging-chain": 0.9,
           "atwood-machine": 0.8, "pulley-lift": 0.9, "motor-spinner": 0.6, "pinball-flipper": 0.4}     # items that hang or turn in the air: where their origin goes


def alone(key):
    """The item by itself on the table: hung where it hangs, else its lowest point on the table (2 cm above it if nothing in it is fixed)."""
    item = item_of(key)
    if key in HANGING:
        item["y"] = HANGING[key]
    else:
        doc, _ = items.build({"stage": STAGE, "items": [dict(item, y=0.0)]})
        world = items._world_poses(doc)
        low = min(extent_low(s_, world[s_["id"]]) for s_ in doc["solids"])
        item["y"] = round(-low + (0.0 if any(s_["kind"] == "static" for s_ in doc["solids"]) else 0.02), 5)
    return [item]


CASES = {
    "hanging-spring": case_hanging_spring, "spring-launcher": case_launcher, "bounce-pad": case_pad, "trampoline": case_trampoline,
    "spring-bumper": case_bumper, "spring-gate": case_gate, "spring-catapult": case_catapult,
    "rope-pendulum": lambda: case_pendulum_like("rope-pendulum"), "wrecking-ball": lambda: case_pendulum_like("wrecking-ball"),
    "swing": case_swing, "hanging-chain": case_chain, "atwood-machine": case_atwood, "pulley-lift": case_pulley_lift,
    "toy-car": lambda: case_vehicle("toy-car"), "motor-car": case_motor_car, "cart": lambda: case_vehicle("cart"),
    "skateboard": lambda: case_vehicle("skateboard"), "truck": lambda: case_vehicle("truck"),
    "wheel": lambda: case_disc("wheel"), "bicycle-wheel": lambda: case_disc("bicycle-wheel"),
    "motor-spinner": case_spinner, "conveyor-belt": case_conveyor, "pinball-flipper": case_flipper,
}


def schema_check(t):
    """The catalog entry: description, source, tags, facts, anchor filled; props have ranges (defaults inside); only the editor's handle kinds."""
    kinds = {"length", "radius", "top", "size", "boxWidth", "rotate", "swing", "tiltEnd", "armEnd"}
    d = t.schema()
    bad = [f for f in ("description", "source", "facts", "anchor") if not d.get(f)]
    bad += ["tags"] if len(d["tags"]) < 5 else []
    keys = {p["key"] for p in d["props"]}
    for p in d["props"]:
        if p["kind"] in ("number", "int") and (p.get("min") is None or p.get("max") is None or not p["min"] <= p["default"] <= p["max"]):
            bad.append(f"range of {p['key']}")
    for e in d["edit"]:
        if e["kind"] not in kinds:
            bad.append(f"handle {e['kind']}")
        bad += [f"handle prop {e[k]}" for k in ("prop", "w", "h", "length") if k in e and e[k] not in keys]
    if d["category"] not in items.CATEGORIES:
        bad.append("category")
    return not bad, "missing: " + ", ".join(bad) if bad else ""


# ---------------------------------------------------------------- scenarios
def scenario_check(sid, res):
    doc, scene = res["doc"], res["scene"]
    first, end = res["track"]["frames"][0]["placements"], res["track"]["frames"][-1]["placements"]
    summary = items.summarize(scene, doc, res["track"])
    out = {"start": (not items.overlaps(scene, doc), "; ".join(w["text"] for w in items.overlaps(scene, doc)))}
    if scene.get("goals"):
        out["goal"] = (all(g["ok"] for g in summary["goals"]), "; ".join(f"{g['label']}: {'yes' if g['ok'] else 'no'}" for g in summary["goals"]))
    if sid == "car-ramp-dominoes":
        dom = [s["id"] for s in doc["solids"] if s["item"] == "dominoes"]
        fallen = sum(1 for d in dom if abs(end[d]["angle"] - first[d]["angle"]) > 1.0)
        out["all dominoes fall"] = (fallen == len(dom), f"{fallen} of {len(dom)} fall")
    elif sid == "trampoline":
        for it in scene["items"]:
            if it["type"].endswith("ball"):
                b = [(f["t"], 0.0, f["placements"][f"{it['id']}/ball"]["y"]) for f in res["track"]["frames"]]
                up, _ = first_bounce(b, b[0][2])
                out[f"{it['id']} bounces"] = (up > 0.1, f"bounces {up * 100:.0f} cm after its first landing")
    elif sid == "atwood":
        m = next(s for s in doc["solids"] if s["id"].endswith("/left"))
        d = first[m["id"]]["y"] - min(f["placements"][m["id"]]["y"] for f in res["track"]["frames"])
        out["heavier weight falls"] = (d > 0.2, f"falls {d * 100:.0f} cm")
    elif sid == "wrecking-ball":
        bricks = [s["id"] for s in doc["solids"] if s["item"].startswith("brick")]
        moved = sum(1 for b in bricks if math.hypot(end[b]["x"] - first[b]["x"], end[b]["y"] - first[b]["y"]) > 0.1)
        out["blocks knocked over"] = (moved >= len(bricks) // 2, f"{moved} of {len(bricks)} bricks moved over 10 cm")
    elif sid == "conveyor-delivery":
        ok = all(g["ok"] for g in summary["goals"]) if summary["goals"] else False
        out["delivered"] = (ok, "every ball ends in the box" if ok else "a ball missed the box")
    elif sid == "spring-launch":
        pass
    return out


def shape_rows():
    """The vehicles' true side outlines (web/models/vehicles*.js draw these): a die-cast car's proportions, a wagon's thin bed over the wheels, a flatbed's open frame, a flipper's height and weight."""
    rows = []

    def solids(key, **props):
        doc, _ = items.build({"stage": STAGE, "items": [dict(item_of(key, y=0.0), props=props)]})
        by = {s["id"].split("/")[1]: s for s in doc["solids"]}
        return doc, by

    def y_range(s, parent=None):
        """World y range (item at angle 0): a polygon's points are around its own origin (a welded part's in its parent's frame)."""
        oy = (parent or s)["at"]["y"]
        b = s["body"]
        if b["kind"] == "ball":
            return oy - b["radius"], oy + b["radius"]
        ys = [p["y"] for p in b["points"]] if b["kind"] == "polygon" else [-b["height"] / 2, b["height"] / 2]
        return oy + min(ys), oy + max(ys)

    def add(name, ok, note):
        rows.append((name, ok, note))

    doc, by = solids("toy-car")
    lo, hi = y_range(by["chassis"])
    roof = y_range(by["cabin"], by["chassis"])[1]
    r = by["front"]["body"]["radius"]
    add("toy-car", abs(roof / 0.2 - 0.37) < 0.02 and abs(2 * r - 0.034) < 1e-6 and abs(lo - 0.012) < 0.001 and abs(by["front"]["depth3d"] - (by["chassis"]["body"]["depth"] - 0.002)) < 1e-6,
        f"roof {roof * 1000:.0f} mm on a 200 mm car (length/height {0.2 / roof:.1f}), wheels {2 * r * 1000:.0f} mm, {lo * 1000:.0f} mm clear, tyres 1 mm inside the body's sides")
    doc, by = solids("motor-car")
    roof = y_range(by["cabin"], by["chassis"])[1]
    add("motor-car", 0.28 < roof / 0.2 < 0.32 and abs(by["front"]["body"]["radius"] - 0.016) < 1e-6, f"a low coupe: roof {roof * 1000:.0f} mm (length/height {0.2 / roof:.1f}), 32 mm wheels")
    doc, by = solids("cart")
    lo, hi = y_range(by["chassis"])
    add("cart", abs(hi - lo - 0.012) < 1e-6 and abs(lo - (2 * by["front"]["body"]["radius"] + 0.002)) < 1e-6, f"a {1000 * (hi - lo):.0f} mm bed {1000 * (lo - 2 * by['front']['body']['radius']):.0f} mm over the wheels' tops, open underneath")
    doc, by = solids("truck")
    lo, hi = y_range(by["chassis"])
    alo = y_range(by["apron"], by["chassis"])[0]
    gap = 2 * by["front"]["body"]["radius"] - lo
    rt = by["front"]["body"]["radius"]
    sag_t = 9.81 / (2 * 3.141592653589793 * 4.0) ** 2                      # the body's settling on its 4 Hz springs
    add("truck", abs(hi - lo - 0.035) < 1e-6 and {"cabin", "apron", "step"} <= set(by) and abs(alo - (0.8 * rt + sag_t)) < 1e-3,
        f"a {1000 * (hi - lo):.0f} mm frame-and-deck slab, a cab on it, apron and step round the front wheel (down to {alo * 1000:.0f} mm at the start, {(alo - sag_t) * 1000:.0f} mm once settled: 0.8 wheel radii), open under the deck between the axles")
    doc, by = solids("skateboard")
    lo, hi = y_range(by["chassis"])
    add("skateboard", abs(hi - lo - 0.015) < 1e-6, f"a {1000 * (hi - lo):.0f} mm deck (with its raised rails), kicktails and two trucks")
    doc, by = solids("pinball-flipper")
    f = by["flipper"]
    mass = items_mass(doc, f["id"])
    add("pinball-flipper", abs(f["body"]["depth"] - 0.024) < 1e-9 and abs(mass - FLIPPER_MASS_KG) < 0.002 and by["post"]["body"]["radius"] <= 0.006 + 1e-9,
        f"a bat {f['body']['depth'] * 1000:.0f} mm tall weighing {mass * 1000:.0f} g, on a {by['post']['body']['radius'] * 1000:.0f} mm radius post (inside its round end)")
    return rows


def main(argv):
    keys = [k for k in argv if not k.startswith("scenario:") and k != "shapes"] or ([] if any(a.startswith("scenario:") or a == "shapes" for a in argv) else [k for k, t in items.TYPES.items() if t.category in CATEGORIES])
    jobs, checks_of = [], {}
    for k in keys:
        its, seconds, check = CASES[k]()
        jobs.append((k, scene_of(its, k, seconds)))
        jobs.append((k + "~alone", scene_of(alone(k), k + "-alone", 3.0)))
        checks_of[k] = check
    if "atwood-machine" in keys:
        for m1, m2, drop, y in ATWOOD_JAMS:
            name = f"atwood-machine@{m1:g}:{m2:g}kg,{drop:g}m"
            its, seconds, check = case_atwood_jam(m1, m2, drop, y)
            jobs.append((name, scene_of(its, name, seconds)))
            checks_of[name] = check
    if "pulley-lift" in keys:
        for w, h, m in LIFT_GRID:
            name = f"pulley-lift@{w:g}x{h:g}m,{m:g}kg"
            its, seconds, check = case_lift_grid(w, h, m)
            jobs.append((name, scene_of(its, name, seconds)))
            checks_of[name] = check
    wanted = [a[9:] for a in argv if a.startswith("scenario:")] or ([] if argv else list(NEW_SCENARIOS))
    if "shapes" in argv and not any(a.startswith("scenario:") for a in argv) and len(argv) == 1:
        wanted = []
    for sid in wanted:
        path = os.path.join(PG, "web", "scenarios", sid + ".json")
        if os.path.exists(path):
            jobs.append(("scenario:" + sid, json.load(open(path))))
        else:
            jobs.append(("scenario:" + sid, None))
    todo = [j for j in jobs if j[1] is not None]
    with cf.ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 4)) as ex:
        results = {r["name"]: r for r in ex.map(run, todo)}
    rows = []
    for name, sc in jobs:
        if name.endswith("~alone"):
            continue
        checks = {}
        if sc is None:
            checks["exists"] = (False, "web/scenarios file is missing")
        else:
            res = results[name]
            if name in items.TYPES:
                checks["schema"] = schema_check(items.TYPES[name])
                lone = results[name + "~alone"]
                if "error" in lone:
                    checks["alone"] = (False, lone["error"])
                else:
                    bad_alone = [f"{k}: {n}" for k, (ok, n) in generic(lone).items() if not ok]
                    checks["alone"] = (not bad_alone, "; ".join(bad_alone))
            if "error" in res:
                checks["runs"] = (False, res["error"])
            else:
                checks.update(generic(res))
                try:
                    if name.startswith("scenario:"):
                        checks.update(scenario_check(name[9:], res))
                    else:
                        checks["behaves"] = checks_of[name](res)
                except Exception as e:  # noqa: BLE001
                    checks["behaves"] = (False, f"{type(e).__name__}: {e}"[:160])
        rows.append((name, [k for k, (ok, _) in checks.items() if not ok], checks))
    w = max([len(r[0]) for r in rows] + [18])
    for name, bad, checks in rows:
        shown = [f"{k}: {note}" for k, (ok, note) in checks.items() if note and (k not in ("finite", "sink", "schema", "speed", "exists", "alone", "start") or k in bad)]
        speed = checks.get("speed", (True, ""))[1]
        print(f"{'FAIL' if bad else 'pass'}  {name:<{w}}  {speed:>9}  " + " | ".join(shown) + (f"   <- {', '.join(bad)}" if bad else ""))
    failed = [r[0] for r in rows if r[1]]
    if not argv or "shapes" in argv:
        for name, ok, note in shape_rows():
            print(f"{'pass' if ok else 'FAIL'}  shape:{name:<{w - 6}}  {'':>9}  {note}")
            if not ok:
                failed.append("shape:" + name)
    print(f"\n{len(rows) - len([f for f in failed if not f.startswith('shape:')])} of {len(rows)} pass" + (f"; FAILED: {', '.join(failed)}" if failed else ""))
    print("PASS" if not failed else "FAIL")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
