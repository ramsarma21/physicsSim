"""The space module on the Python side (tools/space/test.mjs runs it): stdin {scenes: [{scene, track?}], types?: [keys]} -> stdout
{results: [{doc, resolved, warnings, summary?} | {error}], types: [schema]}. machines/items.py loads machines/mod_space.py itself
(PLAYGROUND_MODULES may narrow the modules it loads)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(PG, "machines"))
os.chdir(os.path.join(PG, "machines"))
import items  # noqa: E402


def with_statics(track):
    fr = track["frames"]
    if len(fr) < 2:
        return track
    last = dict(fr[-1], placements={**fr[0]["placements"], **fr[-1]["placements"]})
    return dict(track, frames=fr[:-1] + [last])


req = json.load(sys.stdin)
results = []
for r in req["scenes"]:
    scene = r["scene"]
    out = {}
    try:
        doc, resolved = items.build(scene)
        out.update(doc=doc, resolved=resolved, warnings=items.overlaps(scene, doc))
        if r.get("track"):
            out["summary"] = items.summarize(scene, doc, with_statics(r["track"]))
    except ValueError as e:
        out["error"] = str(e)
    results.append(out)
types = [items.TYPES[k].schema() for k in req.get("types", []) if k in items.TYPES]
json.dump({"results": results, "types": types}, sys.stdout)
