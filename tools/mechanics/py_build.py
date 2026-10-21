"""machines/items.py's side of tools/mechanics/test.mjs: {scenes: [scene], types: [key], summarize?: [{scene, track}]} on stdin ->
{builds: [{doc, resolved, warnings} | {error}], types: [catalog entry without preview], summaries: [summary]} on stdout."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "machines"))
os.chdir(os.path.join(HERE, "..", "..", "machines"))
import items  # noqa: E402

req = json.load(sys.stdin)
out = {"builds": [], "types": [], "summaries": []}
for scene in req.get("scenes", []):
    try:
        doc, resolved = items.build(scene)
        out["builds"].append({"doc": doc, "resolved": resolved, "warnings": items.overlaps(scene, doc)})
    except Exception as e:  # noqa: BLE001
        out["builds"].append({"error": f"{type(e).__name__}: {e}"})
if req.get("types"):
    cat = items.catalog()
    by = {t["key"]: t for t in cat["types"]}
    for k in req["types"]:
        t = dict(by[k])
        t.pop("preview", None)
        out["types"].append(t)
    out["common"] = [t for t in cat["types"] if t["key"] == "toy-car"][0]["props"][-5:]
for s in req.get("summarize", []):
    out["summaries"].append(items.summarize(s["scene"], s["doc"], s["track"]))
json.dump(out, sys.stdout)
