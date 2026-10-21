"""The waves module on the Python side, for tools/parity/waves.mjs: stdin {scenes: [{scene, track?}], types?: bool} -> stdout
{results: [{doc, resolved, warnings, summary?} | {error}], types?: [the module's catalog entries]} (machines/items.py with every module)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(PG, "machines"))
import items  # noqa: E402


def with_statics(track):
    """The server's slim track keeps a static solid only in frames[0]; summarize reads the last frame's placements."""
    fr = track["frames"]
    if len(fr) < 2:
        return track
    last = dict(fr[-1], placements={**fr[0]["placements"], **fr[-1]["placements"]})
    return dict(track, frames=fr[:-1] + [last])


req = json.load(sys.stdin)
out = {"results": []}
for case in req.get("scenes", []):
    scene = case["scene"]
    r = {}
    try:
        doc, resolved = items.build(scene)
        r.update(doc=doc, resolved=resolved, warnings=items.overlaps(scene, doc))
        if case.get("track"):
            r["summary"] = items.summarize(scene, doc, with_statics(case["track"]))
    except ValueError as e:
        r["error"] = str(e)
    out["results"].append(r)
if req.get("types"):
    out["types"] = [t.schema() for t in items.TYPES.values() if t.module == "waves"]
out["module_errors"] = getattr(items, "MODULE_ERRORS", {})
json.dump(out, sys.stdout)
