"""Guard: the starter scenario (web/scenarios/rube-goldberg.json, built from items) must run exactly like rube.py's tuned machine.
usage: python3 machines/test_rg.py      (prints PASS or the first difference; exits 1 on failure)"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); PG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import items, rube  # noqa: E402

scene = json.load(open(os.path.join(PG, "web", "scenarios", "rube-goldberg.json")))
new, _ = items.build(scene)
old, _ = rube.build({})
tracks = {}
for name, d in (("new", new), ("old", old)):
    path = os.path.join(PG, "scenes", f".test-rg-{name}-{os.getpid()}.json")
    out = os.path.join(PG, "research", "tmp", f"test-rg-{name}-{os.getpid()}.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(d, open(path, "w"))
    subprocess.run(["node", "--no-warnings", os.path.join(PG, "research", "poc", "dense_track.ts"), path, "120", out], check=True, capture_output=True)
    os.remove(path)
    tracks[name] = json.load(open(out))
    os.remove(out)
idmap = {o["id"]: n["id"] for o, n in zip(old["solids"], new["solids"])}
if len(old["solids"]) != len(new["solids"]):
    print("FAIL: solid count", len(old["solids"]), len(new["solids"])); sys.exit(1)
worst = 0.0
for fa, fb in zip(tracks["old"]["frames"], tracks["new"]["frames"]):
    for oid, nid in idmap.items():
        pa, pb = fa["placements"][oid], fb["placements"][nid]
        worst = max(worst, abs(pa["x"] - pb["x"]), abs(pa["y"] - pb["y"]), abs(pa["angle"] - pb["angle"]))
summary = items.summarize(scene, new, tracks["new"])
ok = worst == 0.0 and all(g["ok"] for g in summary["goals"])
print(("PASS" if ok else "FAIL"), f"worst placement difference {worst}", summary["goals"])
sys.exit(0 if ok else 1)
