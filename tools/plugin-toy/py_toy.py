"""The toy module on the Python side (tools/plugin-toy/test.mjs runs it): stdin {scene, track?} -> stdout {doc, resolved, types, summary?, warnings}.
items.py with the toy module registered by hand (it is never in the catalog)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(PG, "machines"))
sys.path.insert(0, HERE)
import items  # noqa: E402
import mod_toy  # noqa: E402

mod_toy.register_all(vars(items))


def with_statics(track):
    fr = track["frames"]
    if len(fr) < 2:
        return track
    last = dict(fr[-1], placements={**fr[0]["placements"], **fr[-1]["placements"]})
    return dict(track, frames=fr[:-1] + [last])


req = json.load(sys.stdin)
scene = req["scene"]
out = {}
try:
    doc, resolved = items.build(scene)
    out.update(doc=doc, resolved=resolved, warnings=items.overlaps(scene, doc))
    if req.get("track"):
        out["summary"] = items.summarize(scene, doc, with_statics(req["track"]))
except ValueError as e:
    out["error"] = str(e)
out["types"] = [items.TYPES[k].schema() for k in ("toy-heater", "toy-cube")]
json.dump(out, sys.stdout)
