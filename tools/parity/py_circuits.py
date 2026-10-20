"""The circuits module on the Python side for tools/parity/circuits.mjs: stdin {cases: [{scene, track?}], types: [keys]} -> stdout {results:
[{doc, resolved, warnings, summary?} | {error}], types: [schema], previews: {key: preview}}. machines/items.py loads machines/mod_circuits.py
itself (with every other module)."""
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
results = []
for case in req["cases"]:
    scene = case["scene"]
    out = {}
    try:
        doc, resolved = items.build(scene)
        out.update(doc=doc, resolved=resolved, warnings=items.overlaps(scene, doc))
        if case.get("track"):
            out["summary"] = items.summarize(scene, doc, with_statics(case["track"]))
    except ValueError as e:
        out["error"] = str(e)
    except Exception as e:    # (any other failure, a division by zero in the overlap check: reported, never the whole run lost; web/sim built it)
        out["error"] = f"{type(e).__name__}: {e}"
        out["crash"] = True
    results.append(out)
keys = [k for k in req.get("types", []) if k in items.TYPES]
json.dump({"results": results, "types": [items.TYPES[k].schema() for k in keys], "previews": {k: items.preview(k) for k in keys},
           "errors": getattr(items, "MODULE_ERRORS", {})}, sys.stdout)
