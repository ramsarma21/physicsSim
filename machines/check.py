"""Runs the Rube Goldberg scene and reports each link of the chain.

usage: python3 check.py [params.json | -] [--quiet]   (prints a JSON summary on the last line)
"""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rube  # noqa: E402


def run(params, keep=None):
    doc, P = rube.build(params)
    tmp = tempfile.mkdtemp(dir=os.path.join(PG, "research", "tmp"))
    path = keep or os.path.join(PG, "scenes", f".check-{os.path.basename(tmp)}.json")
    json.dump(doc, open(path, "w"), indent="\t")
    subprocess.run(["node", "--no-warnings", os.path.join(PG, "tooling", "sim.ts"), path, tmp, "track"], check=True, capture_output=True)
    track = json.load(open(os.path.join(tmp, "track.json")))
    shutil.rmtree(tmp, ignore_errors=True)
    if keep is None:
        os.remove(path)
    return doc, P, track


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


if __name__ == "__main__":
    params = json.load(open(sys.argv[1])) if len(sys.argv) > 1 and sys.argv[1] != "-" else {}
    doc, P, track = run(params)
    print(json.dumps(summarize(doc, P, track)))
