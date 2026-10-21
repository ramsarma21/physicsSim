"""py_dump.py with only the named catalog modules real: the Python side of tools/parity/catalog.mjs.

usage: python3 -I tools/parity/py_dump_cat.py [--real catalog_items[,catalog_everyday,...]] < requests.jsonl > answers.jsonl

machines/items.py imports its catalog modules at its end (CATALOG_MODULES). Here every one NOT named by --real is replaced by an empty stand-in
before the import (the same trick as py_dump.py --mode core), so Python holds exactly what a web/sim that ported only the named modules holds: items.py
plus those catalog files, their materials, looks, measured pairs and types, and nothing the others define. (--real defaults to catalog_items.)
Everything else is py_dump.py's own, run unchanged (mode "server", i.e. no further stubbing): the same ops (clean, layout, raw, catalog, tables,
version) and the same answers. Nothing here starts the server's HTTP loop or touches the running server.
"""
import importlib.machinery
import os
import runpy
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ALL = ("catalog_items", "catalog_everyday", "catalog_mechanisms")

argv = sys.argv[1:]
real = ["catalog_items"]
if "--real" in argv:
    i = argv.index("--real")
    real = [m for m in argv[i + 1].split(",") if m]
    del argv[i:i + 2]
unknown = [m for m in real if m not in ALL]
if unknown:
    sys.exit(f"py_dump_cat.py: unknown catalog module {unknown} (there are {', '.join(ALL)})")
for name in ALL:
    if name not in real:
        stub = types.ModuleType(name)
        stub.__spec__ = importlib.machinery.ModuleSpec(name, None)
        stub.register_all = lambda g: None
        sys.modules[name] = stub

# (the catalog ports only: no physics module (machines/mod_*.py, PLAYGROUND_MODULES), whose types are built on materials the stubbed catalogs define)
os.environ["PLAYGROUND_MODULES"] = ""
sys.argv = [os.path.join(HERE, "py_dump.py"), "--mode", "server", *argv]
runpy.run_path(sys.argv[0], run_name="__main__")
