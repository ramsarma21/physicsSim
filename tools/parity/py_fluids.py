"""The fluids module on the Python side for tools/parity/fluids.mjs: stdin {scenes: [scene], tracks?: [track | null]} -> stdout
{results: [{doc, resolved, warnings, summary?} | {error}], types: the module's catalog entries, categories, errors}. items.py loads
machines/mod_fluids.py itself (PLAYGROUND_MODULES, when set, names the modules it loads)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(PG, "machines"))
import items  # noqa: E402


def with_statics(track):
    """The track as the server's summary sees it: the static solids (kept only in the first frame) also in the last."""
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
types = [items.TYPES[k].schema() for k in items.TYPES if items.TYPES[k].module == "fluids"]
json.dump({"results": results, "types": types, "categories": items.CATEGORIES, "errors": items.MODULE_ERRORS}, sys.stdout)
