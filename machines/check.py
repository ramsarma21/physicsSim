"""Runs the Rube Goldberg scene and reports each link of the chain; --sweep runs the starter's robustness sweep.

usage: python3 check.py [params.json | -] [--quiet]   (prints a JSON summary on the last line)
       python3 check.py --sweep [params.json]        the starter's robustness: ball 2 lands in the box from 15 nudged starts, ball 1 held 7 mm lower
                                                       to 7 mm higher (1 mm apart); prints each and {"landed", "of", "ok"}, exit 1 under 13
       python3 check.py --grid [params.json]         the fine grid: 143 starts, ball 1 held 5 mm left to 5 mm right by 6 mm lower to 6 mm higher
The engine runs in node workers (research/poc/worker.ts, the server's own: one JSON request a line, the engine's modules loaded once), at 120
frames a second as the server asks, so a sweep's runs share a few processes instead of starting node for each. (It ran tooling/sim.ts, which
needed the packages that left with the edullm link.)
"""
import json
import math
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rube  # noqa: E402

WORKER = os.path.join(PG, "research", "poc", "worker.ts")
RATE = 120


class _Engine:
    """One long-lived `node worker.ts`: run(doc) -> track (the server's slim track: placements to 1e-5, a still static solid only in frame 0)."""

    def __init__(self):
        self.p = subprocess.Popen(["node", "--no-warnings", WORKER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                  text=True, bufsize=1, cwd=PG)
        self.n = 0
        self.lock = threading.Lock()

    def run(self, doc):
        with self.lock:
            self.n += 1
            self.p.stdin.write(json.dumps({"id": self.n, "doc": doc, "rate": RATE}) + "\n")
            self.p.stdin.flush()
            line = self.p.stdout.readline()
        if not line:
            raise RuntimeError("the engine worker stopped")
        rid, ms, body = line.rstrip("\n").split("\t", 2)
        if ms == "error":
            raise RuntimeError(f"the engine refused the scene: {json.loads(body)}")
        track = json.loads(body)
        # (a static solid that never moves is listed only in frames[0]: every frame gets it, as web/server.py's with_statics does)
        first = track["frames"][0]["placements"]
        for f in track["frames"][1:]:
            for sid, p in first.items():
                f["placements"].setdefault(sid, p)
        return track

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=10)
        except Exception:
            self.p.kill()


_pool, _pool_lock = [], threading.Lock()


def _engine():
    """A worker not in use (a new one when all are busy)."""
    with _pool_lock:
        for e in _pool:
            if not e.lock.locked():
                return e
        e = _Engine()
        _pool.append(e)
        return e


def run(params, keep=None):
    """The scene rube.py builds from these params, run by the engine -> (doc, P, track). keep: also write the document there."""
    doc, P = rube.build(params)
    if keep:
        json.dump(doc, open(keep, "w"), indent="\t")
    return doc, P, _engine().run(doc)


def summarize(doc, P, track):
    fr = track["frames"]
    T = [f["t"] for f in fr]
    pos = lambda pid: [f["placements"][pid] for f in fr]
    b1, b2, saw = pos("ball1"), pos("ball2"), pos("seesaw")
    doms = [pid for pid in fr[0]["placements"] if pid.startswith("domino")]
    r = 0.03

    def near_part(pts, pid, tol=0.006):
        """First time the ball is within tol of touching the given static slab."""
        part = next(s for s in doc["solids"] if s["id"] == pid)
        a = part.get("angle", 0.0); cx, cy = part["at"]["x"], part["at"]["y"]
        hw, hh = part["body"]["width"] / 2, part["body"]["height"] / 2
        for t, p in zip(T, pts):
            dx, dy = p["x"] - cx, p["y"] - cy
            lx = dx * math.cos(-a) - dy * math.sin(-a); ly = dx * math.sin(-a) + dy * math.cos(-a)
            qx, qy = max(-hw, min(hw, lx)), max(-hh, min(hh, ly))
            if math.hypot(lx - qx, ly - qy) <= r + tol:
                return round(t, 2)
        return None

    fallen = {}
    for d in doms:
        for t, p in zip(T, pos(d)):
            if abs(p["angle"]) > 1.0:
                fallen[d] = round(t, 2); break
    saw0 = saw[0]["angle"]
    saw_turn = max(abs(p["angle"] - saw0) for p in saw)
    t_saw = next((round(t, 2) for t, p in zip(T, saw) if abs(p["angle"] - saw0) > 0.05), None)
    b2y0 = b2[0]["y"]
    peak = max(b2, key=lambda p: p["y"])
    bx, by, bw, bt = P["box_x"], P["box_y"], P["box_width"], 0.012
    end = b2[-1]
    in_box = (bx - bw / 2 + bt) <= end["x"] <= (bx + bw / 2 - bt) and by <= end["y"] - r + 0.01 <= by + P["box_wall"]
    s = {
        "ball1_hits_ramp1": near_part(b1, "ramp1"), "ball1_hits_ramp2": near_part(b1, "ramp2"),
        "ball1_reaches_x": round(max(p["x"] for p in b1), 3),
        "dominoes_fallen": f"{len(fallen)}/{len(doms)}", "domino_times": [fallen.get(d) for d in sorted(doms, key=lambda k: int(k[6:]))],
        "seesaw_moves_at": t_saw, "seesaw_turn_deg": round(math.degrees(saw_turn), 1),
        "ball2_rises_m": round(peak["y"] - b2y0, 3), "ball2_peak_xy": [round(peak["x"], 3), round(peak["y"], 3)],
        "ball2_end_xy": [round(end["x"], 3), round(end["y"], 3)], "ball2_in_box": in_box,
    }
    return s


NUDGES = [(0.0, k / 1000) for k in range(-7, 8)]                                                     # (x, y) of ball 1's start, m: 15 heights
GRID = [(i / 1000, k / 1000) for i in range(-5, 6) for k in range(-6, 7)]                            # 143: 11 across by 13 heights


def sweep(params=None, nudges=NUDGES, workers=6):
    """The starter's robustness: ball 2 lands in the box from each nudged start of ball 1 -> [(nudge, summary)]. Ball 1 is held at
    (ball1_x, ball1_y), or drop_height above ramp 1 at drop_x when attached: the nudge moves whichever holds it."""
    base = dict(rube.DEFAULTS, **(params or {}))

    def one(n):
        dx, dy = n
        if base.get("ball1_attached"):
            q = dict(params or {}, drop_x=base["drop_x"] + dx, drop_height=base["drop_height"] + dy)
        else:
            q = dict(params or {}, ball1_x=base["ball1_x"] + dx, ball1_y=base["ball1_y"] + dy)
        return n, summarize(*run(q))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(one, nudges))


if __name__ == "__main__":
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    params = json.load(open(argv[0])) if argv and argv[0] != "-" else {}
    try:
        if "--sweep" in sys.argv or "--grid" in sys.argv:
            grid = "--grid" in sys.argv
            rows = sweep(params, GRID if grid else NUDGES)
            landed = sum(1 for _, s in rows if s["ball2_in_box"])
            if not grid:
                for (dx, dy), s in rows:
                    print(f"ball 1 held {dy * 1000:+.0f} mm: {'lands' if s['ball2_in_box'] else 'misses'}  ball 2 rises {s['ball2_rises_m']} m, "
                          f"ends at {s['ball2_end_xy']}; dominoes {s['dominoes_fallen']}")
            need = 13 if not grid else 0
            print(json.dumps({"landed": landed, "of": len(rows), "ok": landed >= need}))
            sys.exit(0 if landed >= need else 1)
        doc, P, track = run(params)
        print(json.dumps(summarize(doc, P, track)))
    finally:
        for e in _pool:
            e.close()
