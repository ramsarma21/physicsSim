"""The fracture module's checks on the Python side (tools/fracture/test.mjs runs it): stdin {cases: [{scene, track?}], types?: [keys]} ->
stdout {out: [{doc, resolved, warnings, summary?} | {error}], types?: [schema]}. machines/items.py with every module, as the server has it."""
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
res = []
for case in req.get("cases", []):
    scene = case["scene"]
    o = {}
    try:
        doc, resolved = items.build(scene)
        o.update(doc=doc, resolved=resolved, warnings=items.overlaps(scene, doc))
        if case.get("track"):
            o["summary"] = items.summarize(scene, doc, with_statics(case["track"]))
    except ValueError as e:
        o["error"] = str(e)
    res.append(o)
out = {"out": res, "errors": items.MODULE_ERRORS}
if req.get("types"):
    out["types"] = [items.TYPES[k].schema() for k in req["types"]]
json.dump(out, sys.stdout)
