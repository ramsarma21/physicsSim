"""Searches the machine's layout for versions whose chain works in the engine, link by link.

usage: python3 search.py <stage> [n]   stage: dominoes | box
  dominoes: ramp 2 and the domino row, scored on ball 1 setting the row off from its first domino
            (not hopping over it), every domino falling in order and the seesaw's strike speed.
  box:      for the best layout, where ball 2 comes down, and a box placed there checked in the engine.
"""
import itertools
import json
import math
import os
import random
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import check  # noqa: E402
import rube  # noqa: E402

OUT = os.path.join(os.path.dirname(HERE), "research", "tmp")
WALL = float(os.environ.get("BOX_WALL", "0.2"))   # box wall height, m: deep enough that a hollow ball bouncing in stays in


def metrics(params):
    return analyze(*check.run(params))


def analyze(doc, P, track):
    s = check.summarize(doc, P, track)
    fr = track["frames"]
    T = [f["t"] for f in fr]
    saw = [f["placements"]["seesaw"]["angle"] for f in fr]
    w = [abs(saw[k + 1] - saw[k]) / (T[k + 1] - T[k]) for k in range(len(fr) - 1) if T[k + 1] > T[k]]
    s["saw_w_max"] = round(max(w), 2)
    times = s["domino_times"]
    s["in_order"] = all(t is not None for t in times) and all(b >= a - 0.02 for a, b in zip(times, times[1:]))
    first = [f["placements"]["ball1"]["x"] for f in fr]
    s["ball1_past_first"] = round(max(first) - P["domino_x"], 3)
    s["b2"] = [(round(f["t"], 4), round(f["placements"]["ball2"]["x"], 4), round(f["placements"]["ball2"]["y"], 4)) for f in fr]
    # where the box may not hang: the last domino's fall and the seesaw's swing, as (x from, x to, up to y)
    solid = {d["id"]: d for d in doc["solids"]}
    last = solid[f"domino{int(P['dominoes'])}"]
    lx, lh, lt = last["at"]["x"], last["body"]["height"], last["body"]["width"]
    saw = solid["seesaw"]
    L = saw["body"]["width"]
    sx = saw["at"]["x"]
    s["keepout"] = [(lx - lt, lx + lh + 0.04, lh + 0.04), (sx - L / 2 - 0.02, sx + L / 2 + 0.02, L * math.sin(math.radians(P["seesaw_tilt"])) + 0.08)]
    return P, s


def score(s):
    if not s["in_order"] or s["seesaw_turn_deg"] < 10 or s["ball2_peak_xy"][0] > 3.0:
        return -1
    hop = max(0.0, s["ball1_past_first"] - 0.06)     # ball 1 should stop near the first domino, not plough the row
    return s["ball2_rises_m"] - 2 * hop


def ramp2_end_x(p):
    P = dict(rube.DEFAULTS, **p)
    a1, a2 = math.radians(P["ramp1_angle"]), math.radians(P["ramp2_angle"])
    e1 = (P["ramp1_top_x"] + P["ramp1_length"] * math.cos(a1), P["ramp1_top_y"] + P["ramp1_length"] * math.sin(a1))
    t2 = (e1[0] + P["ramp2_dx"], e1[1] + P["ramp2_dy"])
    return t2[0] + t2[1] / math.sin(-a2) * math.cos(a2)


def stage_dominoes(n):
    rng = random.Random(int(sys.argv[3]) if len(sys.argv) > 3 else 7)
    space = {
        "ramp1_top_y": (0.4, 0.95), "ramp2_angle": (-20, -7), "ramp2_dy": (-0.15, -0.04), "ramp2_dx": (0.02, 0.15),
        "run": (0.08, 0.5), "domino_height": (0.05, 0.11), "domino_growth": (1.15, 1.4), "domino_spacing": (0.45, 0.7),
        "seesaw_gap": (0.02, 0.1), "seesaw_tilt": (8, 16), "seesaw_length": (0.5, 0.8), "seesaw_pivot": (-0.15, 0.05),
    }
    trials = []
    while len(trials) < n:
        t = {k: round(rng.uniform(*v), 3) for k, v in space.items()}
        t["ramp2_attached"] = 1      # the search places ramp 2 by its gap from ramp 1's end
        t["domino_x"] = round(ramp2_end_x(t) + t.pop("run"), 3)
        if t["domino_x"] < 2.4:
            trials.append(t)

    def one(p):
        try:
            P, s = metrics(p)
            return p, s, score(s)
        except Exception as e:  # a layout that cannot be built (overlaps the wall, etc.)
            return p, {"error": str(e)}, -9

    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(one, trials))
    res.sort(key=lambda r: -r[2])
    json.dump([{"params": p, "score": sc, **{k: v for k, v in s.items() if k != "b2"}} for p, s, sc in res], open(os.path.join(OUT, "search-dominoes.json"), "w"), indent=1)
    for p, s, sc in res[:12]:
        print(round(sc, 3), json.dumps(p), {k: s.get(k) for k in ("ball1_past_first", "dominoes_fallen", "in_order", "saw_w_max", "ball2_rises_m", "ball2_peak_xy")})


def place_box(P, s, width=0.2, wall=0.1):
    """Where a box of this size catches ball 2 coming down, clear of its way up; None if nowhere."""
    b2 = s["b2"]
    r, bt = 0.03, 0.012
    k_peak = max(range(len(b2)), key=lambda k: b2[k][2])
    _, px, py = b2[k_peak]
    best = None
    for by in [round(0.05 + 0.01 * i, 3) for i in range(60)]:
        rim = by + wall
        if rim + r > py - 0.01:
            break
        # the descent crosses the rim height here
        down = [(x, y) for _, x, y in b2[k_peak:] if y <= rim + r]
        if not down:
            continue
        cx = down[0][0]
        # the way up must stay clear of the box (over its walls by a ball radius) and the box clear of the seesaw
        up = [(x, y) for _, x, y in b2[:k_peak + 1]]
        bx = cx
        lo, hi = bx - width / 2 - r, bx + width / 2 + r
        if any(lo <= x <= hi and y <= rim + r for x, y in up[3:]):
            continue
        if by < 0.05 or bx + width / 2 > 3.07 or bx - width / 2 < -0.45:
            continue
        cand = {"box_x": round(bx, 3), "box_y": by, "box_width": width}
        if best is None or by > best["box_y"]:
            best = cand
    return best


def stage_box():
    rows = json.load(open(os.path.join(OUT, "search-dominoes.json")))
    for row in rows[:6]:
        p = row["params"]
        P, s = metrics(p)
        for width in (0.2, 0.26):
            box = place_box(P, s, width)
            if box is None:
                print("no box for", p, width)
                continue
            q = dict(p, **box)
            P2, s2 = metrics(q)
            # robustness: nudge the drop and the box
            ok = 0
            nudges = list(itertools.product((-0.004, 0, 0.004), (-0.02, 0, 0.02)))
            for dx, bdx in nudges:
                _, s3 = metrics(dict(q, drop_x=P2["drop_x"] + dx, box_x=box["box_x"] + bdx))
                ok += bool(s3["ball2_in_box"])
            print(json.dumps(q), "in box:", s2["ball2_in_box"], f"robust {ok}/{len(nudges)}", {k: s2.get(k) for k in ("ball2_rises_m", "ball2_end_xy", "saw_w_max")})


if __name__ == "__main__" and (len(sys.argv) < 2 or sys.argv[1] in ("dominoes", "box")):
    stage = sys.argv[1] if len(sys.argv) > 1 else "dominoes"
    if stage == "dominoes":
        stage_dominoes(int(sys.argv[2]) if len(sys.argv) > 2 else 160)
    else:
        stage_box()


def clear(box, keepout):
    bx, by, bw = box["box_x"], box["box_y"], box["box_width"]
    return all(bx + bw / 2 < x0 or bx - bw / 2 > x1 or by - 0.012 > ytop for x0, x1, ytop in keepout)


def caught(b2, box, wall=0.1):
    """Whether this ball-2 path comes down inside the box without touching it on the way up (geometry only)."""
    r, bt = 0.03, 0.012
    bx, by, bw = box["box_x"], box["box_y"], box["box_width"]
    rim = by + wall
    k_peak = max(range(len(b2)), key=lambda k: b2[k][2])
    if b2[k_peak][2] < rim + r + 0.01:
        return False
    lo, hi = bx - bw / 2 - r, bx + bw / 2 + r
    if any(lo <= x <= hi and y <= rim + r for _, x, y in b2[3:k_peak + 1]):
        return False
    down = [x for _, x, y in b2[k_peak:] if y <= rim + r]
    return bool(down) and bx - bw / 2 + bt + r * 0.6 <= down[0] <= bx + bw / 2 - bt - r * 0.6


def stage_robust(top=10):
    rows = [r for r in json.load(open(os.path.join(OUT, "search-dominoes.json"))) if r["score"] > 0][:top]
    rows = [r for r in rows if "error" not in r]
    nudges = [(dx, dh) for dx in (-0.006, -0.003, 0, 0.003, 0.006) for dh in (-0.01, 0, 0.01)]
    jobs = [(i, dict(r["params"], drop_x=round(rube.DEFAULTS["drop_x"] + dx, 4), drop_height=round(rube.DEFAULTS["drop_height"] + dh, 4))) for i, r in enumerate(rows) for dx, dh in nudges]
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda j: (j[0], metrics(j[1])[1]), jobs))
    out = []
    for i, r in enumerate(rows):
        runs = [s for k, s in res if k == i]
        chain = sum(s["in_order"] and s["ball1_past_first"] < 0.12 for s in runs)
        best = (0, None)
        for width in (0.2, 0.3, 0.4, 0.45):
            for by in [round(0.05 + 0.02 * j, 3) for j in range(30)]:
                for bx in [round(1.2 + 0.01 * j, 3) for j in range(190)]:
                    if bx + width / 2 > 3.07:
                        break
                    box = {"box_x": bx, "box_y": by, "box_width": width}
                    if not clear(box, runs[0]["keepout"]):
                        continue
                    n = sum(caught(s["b2"], box, WALL) for s in runs)
                    # prefer more catches, then a narrower box, then a higher one
                    key = (n, -width, by)
                    if best[1] is None or key > best[0]:
                        best = (key, box)
        out.append((best[0][0], chain, r["params"], dict(best[1] or {}, box_wall=WALL)))
        print(f"layout {i}: chain ok {chain}/{len(runs)}, box catches {best[0][0]}/{len(runs)} at {best[1]}")
    out.sort(key=lambda o: (-o[0], -o[1]))
    json.dump([{"catches": c, "chain": ch, "params": dict(p, **b)} for c, ch, p, b in out], open(os.path.join(OUT, "search-robust.json"), "w"), indent=1)


def stage_verify():
    rows = json.load(open(os.path.join(OUT, "search-robust.json")))[:3]
    nudges = [(dx, dh) for dx in (-0.006, -0.003, 0, 0.003, 0.006) for dh in (-0.01, 0, 0.01)]
    for r in rows:
        p = r["params"]
        jobs = [dict(p, drop_x=round(rube.DEFAULTS["drop_x"] + dx, 4), drop_height=round(rube.DEFAULTS["drop_height"] + dh, 4)) for dx, dh in nudges]
        jobs += [dict(p, box_x=round(p["box_x"] + d, 3)) for d in (-0.03, -0.015, 0.015, 0.03)]
        with ThreadPoolExecutor(8) as ex:
            res = list(ex.map(lambda q: metrics(q)[1], jobs))
        base = metrics(p)[1]
        print(json.dumps(p))
        print(f"  default in box: {base['ball2_in_box']}; nudged starts in box {sum(s['ball2_in_box'] for s in res[:15])}/15; box moved ±1.5/3 cm {sum(s['ball2_in_box'] for s in res[15:])}/4")


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] in ("robust", "verify"):
    stage_robust() if sys.argv[1] == "robust" else stage_verify()


def swept(doc, track):
    """Every moving solid's bounding box at every frame, except ball 2: where a hung box may not be."""
    import numpy as np
    shapes = {d["id"]: d for d in doc["solids"] if d["kind"] == "dynamic" and d["id"] != "ball2"}
    rows = []
    for f in track["frames"]:
        for pid, d in shapes.items():
            p = f["placements"][pid]
            if d["body"]["kind"] == "ball":
                r = d["body"]["radius"]
                rows.append((p["x"] - r, p["x"] + r, p["y"] - r, p["y"] + r))
                continue
            hw, hh = d["body"]["width"] / 2, d["body"]["height"] / 2
            if "parent" in d:      # the lip: placed in its parent's frame
                q = f["placements"][d["parent"]]
                c, s_ = math.cos(q["angle"]), math.sin(q["angle"])
                ox, oy = d["at"]["x"], d["at"]["y"]
                cx, cy, a = q["x"] + ox * c - oy * s_, q["y"] + ox * s_ + oy * c, q["angle"]
            else:
                cx, cy, a = p["x"], p["y"], p["angle"]
            ex = abs(hw * math.cos(a)) + abs(hh * math.sin(a))
            ey = abs(hw * math.sin(a)) + abs(hh * math.cos(a))
            rows.append((cx - ex, cx + ex, cy - ey, cy + ey))
    return np.array(rows)


def free(box, wall, occ, margin=0.01):
    bx, by, bw = box["box_x"], box["box_y"], box["box_width"]
    x0, x1, y0, y1 = bx - bw / 2 - margin, bx + bw / 2 + margin, by - 0.012 - margin, by + wall + margin
    hit = (occ[:, 0] < x1) & (occ[:, 1] > x0) & (occ[:, 2] < y1) & (occ[:, 3] > y0)
    return not hit.any()


def best_box(runs, occs, wall):
    best = (None, None)
    for width in (0.2, 0.3, 0.4):
        for by in [round(0.05 + 0.02 * j, 3) for j in range(35)]:
            for bx in [round(1.0 + 0.01 * j, 3) for j in range(210)]:
                if bx + width / 2 > 3.07:
                    break
                box = {"box_x": bx, "box_y": by, "box_width": width}
                n = sum(caught(s["b2"], box, wall) for s in runs)
                if n == 0 or (best[0] is not None and (n, -width) < best[0][:2]):
                    continue
                if not all(free(box, wall, o) for o in occs):
                    continue
                key = (n, -width, by)
                if best[0] is None or key > best[0]:
                    best = (key, box)
    return best


def stage_seesaw(base_rank=1, n=60):
    rows = [r for r in json.load(open(os.path.join(OUT, "search-dominoes.json"))) if r["score"] > 0 and "error" not in r]
    base = {k: v for k, v in rows[base_rank]["params"].items() if not k.startswith("seesaw")}
    rng = random.Random(11)
    space = {"seesaw_gap": (0.02, 0.12), "seesaw_tilt": (8, 22), "seesaw_length": (0.45, 0.85), "seesaw_pivot": (-0.2, 0.05)}
    trials = [{}] + [{k: round(rng.uniform(*v), 3) for k, v in space.items()} for _ in range(n)]
    trials[0] = {k: v for k, v in rows[base_rank]["params"].items() if k.startswith("seesaw")}
    nudges = [(-0.006, 0), (0.006, 0), (0, -0.01), (0, 0.01), (0, 0), (0.003, 0.005)]

    def run(job):
        t, (dx, dh) = job
        doc, P, track = check.run(dict(base, **t, drop_x=dx, drop_height=round(0.06 + dh, 4)))
        _, s = analyze(doc, P, track)
        return s, swept(doc, track)

    jobs = [(t, nd) for t in trials for nd in nudges]
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(run, jobs))
    out = []
    for i, t in enumerate(trials):
        rs = res[i * len(nudges):(i + 1) * len(nudges)]
        runs, occs = [r[0] for r in rs], [r[1] for r in rs]
        chain = sum(s["in_order"] for s in runs)
        key, box = best_box(runs, occs, WALL)
        catches = key[0] if key else 0
        out.append({"catches": catches, "chain": chain, "params": dict(base, **t, **(box or {}), box_wall=WALL)})
        if catches >= 4:
            print(catches, chain, json.dumps(t), box)
    out.sort(key=lambda o: (-o["catches"], -o["chain"]))
    json.dump(out, open(os.path.join(OUT, "search-robust.json"), "w"), indent=1)
    print("best:", out[:3])


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "seesaw":
    stage_seesaw(int(sys.argv[2]) if len(sys.argv) > 2 else 1, int(sys.argv[3]) if len(sys.argv) > 3 else 60)
