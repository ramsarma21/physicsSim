"""Dense (240 Hz) trace of the hand-offs for one layout: last domino -> seesaw -> ball 2.

usage: python3 trace.py params.json   (or '-' for the defaults)
"""
import json, math, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); PG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rube


def dense(params, rate=240):
    doc, P = rube.build(params)
    d = tempfile.mkdtemp(dir=os.path.join(PG, "research", "tmp"))
    path = os.path.join(PG, "scenes", f".trace-{os.path.basename(d)}.json")
    json.dump(doc, open(path, "w"))
    out = os.path.join(d, "dense.json")
    subprocess.run(["node", "--no-warnings", os.path.join(PG, "research", "poc", "dense_track.ts"), path, str(rate), out], check=True, capture_output=True)
    os.remove(path)
    track = json.load(open(out))
    import shutil
    shutil.rmtree(d, ignore_errors=True)
    return doc, P, track


def handoffs(doc, P, tr):
    fr = tr["frames"]; T = [f["t"] for f in fr]
    get = lambda pid: [f["placements"][pid] for f in fr]
    saw, b2 = get("seesaw"), get("ball2")
    last = get(f"domino{int(P['dominoes'])}")
    w = [(saw[k + 1]["angle"] - saw[k]["angle"]) / (T[k + 1] - T[k]) for k in range(len(fr) - 1)]
    k0 = next(k for k in range(len(w)) if T[k] > doc["release"]["at"] + 0.3 and abs(w[k]) > 1.0)
    lw_rate = lambda k: (last[k + 1]["angle"] - last[k]["angle"]) / (T[k + 1] - T[k])
    prev = get(f"domino{int(P['dominoes']) - 1}")
    k_last = next(k for k in range(len(fr)) if abs(last[k]["angle"]) > 0.02)
    kmax = max(range(k0, min(len(w), k0 + 120)), key=lambda k: abs(w[k]))
    v = lambda k: ((b2[k + 1]["x"] - b2[k]["x"]) / (T[k + 1] - T[k]), (b2[k + 1]["y"] - b2[k]["y"]) / (T[k + 1] - T[k]))
    kpk = max(range(k0, len(fr)), key=lambda k: b2[k]["y"])
    # launch: the step of ball 2's largest speed after the strike, before its peak
    kl = max(range(k0, kpk), key=lambda k: math.hypot(*v(k))) if kpk > k0 else k0
    lw = [(round(T[k], 3), round(math.degrees(last[k]["angle"]), 1)) for k in range(k0 - 2, k0 + 1)]
    return {"last_starts_t": round(T[k_last], 3), "prev_deg_then": round(math.degrees(prev[k_last]["angle"]), 1), "last_w_at_strike": round(lw_rate(k0 - 1), 2),
            "strike_t": round(T[k0], 3), "last_domino_deg_at_strike": lw[-1][1], "saw_w_peak": round(w[kmax], 2), "saw_w_peak_t": round(T[kmax], 3),
            "b2_launch_t": round(T[kl], 3), "b2_launch_v": [round(c, 2) for c in v(kl)], "b2_peak": [round(b2[kpk]["x"], 3), round(b2[kpk]["y"], 3)],
            "saw_angle_at_launch": round(math.degrees(saw[kl]["angle"]), 1)}


if __name__ == "__main__":
    p = json.load(open(sys.argv[1])) if len(sys.argv) > 1 and sys.argv[1] != "-" else {}
    print(json.dumps(handoffs(*dense(p))))
