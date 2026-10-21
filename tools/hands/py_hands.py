"""The hands module's Python side for tools/hands/test.mjs: stdin {scenes?: [scene], types?: [keys], all_types?: bool} -> stdout
{modules, module_errors, results: [{doc, resolved, warnings} | {error}], types: [catalog entries]} (items.py with every module, as the server
loads it; PLAYGROUND_MODULES narrows it as usual). Each scene is cleaned as web/server.py cleans a request first."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(PG, "machines"))
sys.path.insert(0, os.path.join(PG, "web"))
import items  # noqa: E402
import server  # noqa: E402

req = json.load(sys.stdin)
out = {"modules": list(items.MODULES), "module_errors": items.MODULE_ERRORS, "results": []}
for scene in req.get("scenes") or []:
    try:
        s = server.clean(scene)
        doc, resolved = items.build(s)
        out["results"].append({"doc": doc, "resolved": resolved, "warnings": items.overlaps(s, doc)})
    except (ValueError, server.BadScene) as e:
        out["results"].append({"error": str(e)})
keys = list(items.TYPES) if req.get("all_types") else (req.get("types") or [])
out["types"] = [items.TYPES[k].schema() for k in keys]
out["keys"] = keys
json.dump(out, sys.stdout)
