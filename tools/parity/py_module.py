"""Any physics module on the Python side for tools/parity/module.mjs: stdin {module, scenes: [scene (cleaned here by web/server.py clean(), as a request is)], tracks?: [track | null]} -> stdout
{results: [{doc, resolved, warnings, summary?} | {error}], types: [the module's catalog entries], categories}. machines/items.py loads every
machines/mod_<name>.py itself (PLAYGROUND_MODULES as the JS side has it)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(PG, "machines"))
sys.path.insert(0, os.path.join(PG, "web"))
import server  # noqa: E402  (its clean(), as a request meets it; it imports machines/items.py)
import items  # noqa: E402


def with_statics(track):
    """The server's slimmed track leaves still static parts out after the first frame: the summary reads them where they stood."""
    fr = track["frames"]
    if len(fr) < 2:
        return track
    last = dict(fr[-1], placements={**fr[0]["placements"], **fr[-1]["placements"]})
    return dict(track, frames=fr[:-1] + [last])


req = json.load(sys.stdin)
name = req["module"]
tracks = req.get("tracks") or []
results = []
for k, scene in enumerate(req["scenes"]):
    out = {}
    try:
        scene = server.clean(scene)
        doc, resolved = items.build(scene)
        out.update(doc=doc, resolved=resolved, warnings=items.overlaps(scene, doc))
        if k < len(tracks) and tracks[k]:
            out["summary"] = items.summarize(scene, doc, with_statics(tracks[k]))
    except server.BadScene as e:
        out["error"] = str(e)
    except (ValueError, ArithmeticError) as e:
        out["error"] = str(e)
    except Exception as e:  # (a 500 on the server: never alike)
        out["error500"] = f"{type(e).__name__}: {e}"
    results.append(out)
types = [items.TYPES[k].schema() for k in items.TYPES if getattr(items.TYPES[k], "module", None) == name]
json.dump({"results": results, "types": types, "categories": items.CATEGORIES, "errors": getattr(items, "MODULE_ERRORS", {})}, sys.stdout)
