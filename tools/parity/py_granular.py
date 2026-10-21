"""The granular module on the Python side for tools/parity/granular.mjs: stdin {scenes: [scene], tracks?: [track | null]} -> stdout
[{doc, resolved, warnings, summary?} | {error}] and the module's catalog entries. items.py loads machines/mod_granular.py itself (or, while it is
still machines/wip_granular.py, it is registered here by hand)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(PG, "machines"))
import items  # noqa: E402

if "mod_granular" not in items.MODULES:
    import wip_granular  # noqa: E402
    wip_granular.register_all(vars(items))


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
types = [items.TYPES[k].schema() for k in items.TYPES if items.TYPES[k].module == "granular"]
json.dump({"results": results, "types": types, "categories": items.CATEGORIES}, sys.stdout)
