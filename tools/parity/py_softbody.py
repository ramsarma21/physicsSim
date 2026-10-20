"""The softbody module on the Python side for tools/parity/softbody.mjs: stdin {scenes: [scene], tracks?: [track | null]} -> stdout
[{doc, resolved, warnings, summary?} | {error}], the module's catalog entries and the vehicles' entries (they carry its common props).
items.py loads machines/mod_softbody.py itself."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(PG, "machines"))
import items  # noqa: E402



def with_statics(track):
    fr = track["frames"]
    if len(fr) < 2:
        return track
    last = dict(fr[-1], placements={**fr[0]["placements"], **fr[-1]["placements"]})
    return dict(track, frames=fr[:-1] + [last])


req = json.load(sys.stdin)
tracks = req.get("tracks") or []
results = []
for k, scene in enumerate(req["scenes"]):
    out = {}
    try:
        doc, resolved = items.build(scene)
        out.update(doc=doc, resolved=resolved, warnings=items.overlaps(scene, doc))
        if k < len(tracks) and tracks[k]:
            out["summary"] = items.summarize(scene, doc, with_statics(tracks[k]))
    except (ValueError, ArithmeticError) as e:
        out["error"] = str(e)
    results.append(out)
types = [items.TYPES[k].schema() for k in items.TYPES if items.TYPES[k].module == "softbody" or k in ("toy-car", "cart", "truck")]
json.dump({"results": results, "types": types, "categories": items.CATEGORIES}, sys.stdout)
