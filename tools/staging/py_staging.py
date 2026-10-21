"""The staging module's Python side for tools/staging/test.mjs: stdin {scene?, types?: [keys]} -> stdout {doc, resolved, warnings} or {error},
and {types: [catalog entries]} (items.py with every module, as the server loads it; PLAYGROUND_MODULES narrows it as usual)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(PG, "machines"))
import items  # noqa: E402

req = json.load(sys.stdin)
out = {"modules": list(items.MODULES), "module_errors": items.MODULE_ERRORS}
if req.get("scene") is not None:
    try:
        doc, resolved = items.build(req["scene"])
        out.update(doc=doc, resolved=resolved, warnings=items.overlaps(req["scene"], doc))
    except ValueError as e:
        out["error"] = str(e)
if req.get("types"):
    out["types"] = [items.TYPES[k].schema() for k in req["types"]]
json.dump(out, sys.stdout)
