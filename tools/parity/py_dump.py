"""The Python side of the parity harness: reads JSON-lines requests on stdin, answers one JSON line each on stdout.

It imports machines/items.py exactly as web/server.py does (sys.path gets machines/, then `import server` imports items) and answers with
server.py's own clean(), items.build(), items.overlaps(), items.summarize() and server.with_statics(). It never starts the server's
HTTP loop or its engine workers: importing server.py only defines them.

usage: python3 tools/parity/py_dump.py [--mode core|server|everyday] < requests.jsonl > answers.jsonl
  --mode server  (default) everything items.py imports, as the running server has it (catalog_items.py, catalog_everyday.py,
                 catalog_mechanisms.py: their materials, looks and measured pairs, which core items can meet too)
  --mode core    machines/items.py alone: the three catalog modules are replaced by empty stand-ins before the import, so the core types
                 build from items.py's own tables only, plus the measured pairs catalog_items.py defines among items.py's own six materials
                 (steel meets steel and both woods there; the core table, wall, plank, seesaw and box offer steel). That is what
                 web/sim/items.js is until the catalog files are ported
  --mode everyday  the whole server, as --mode server, but catalog_everyday.py is wrapped so that the materials, measured pairs, looks and
                 categories are copied just before it registers ("before": what a JavaScript port of catalog_everyday.py starts from: items.py
                 and catalog_items.py) and just after it ("after": what that port must have made); op "tables" with "at": "before" | "after"
                 answers from those copies. (core.mjs --mode everyday loads the "before" tables into web/sim and registers
                 web/sim/catalog-everyday.js on them.)
  --snapshot NAME  (with --mode server) catalog module NAME is wrapped like catalog_everyday.py is in --mode everyday: op "tables" with "at": "before" | "after"
                 answers with the tables just before and just after its register_all (tools/parity/mechanisms.mjs uses --snapshot catalog_mechanisms)
request = {"id": str, "op": op, ...} (a line without "op" is taken as a scene: op "layout"); numbers the JSON cannot carry are {"@@float": "nan" | "inf" | "-inf"}
  op "clean"    scene                -> {"ok": cleaned scene} | {"error": BadScene message} | {"error500": message}
  op "layout"   scene [, track]      -> {"doc", "resolved", "warnings"[, "summary" when a track is given]} | errors as above
                (what /api/layout answers; /api/simulate's summary, with server.with_statics(track))
  op "raw"      scene [, probe]      -> items.build() on the scene as given (no clean) {"doc", "resolved", "warnings"} | {"exc", "message"}
                probe = {item id: [[method, [args], {kwargs}], ...]}: what the test type "probe" (registered here) builds with c.<method>(*args, **kwargs);
                a kwargs value {"$mat": {...}} is replaced by c.mat(**...), {"$pyint": n} by the int n
  op "catalog"                       -> items.catalog()
  op "module-types"                  -> {catalog module name: [the type keys it registered]} (tools/parity/mechanisms.mjs checks a port registers exactly these)
  op "tables" [, at]                 -> MATERIALS (with which keys are ints), MEASURED pairs, LOOKS, TYPES keys, CATEGORIES
                (mode everyday: at "before" or "after" catalog_everyday.py's register_all instead of at the end)
  op "version"                       -> python and platform versions
"""
import importlib.machinery
import importlib.util
import json
import math
import os
import platform
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(os.path.dirname(HERE))
MODE = "server"
if "--mode" in sys.argv:
    MODE = sys.argv[sys.argv.index("--mode") + 1]
if MODE == "core":
    # (items.py alone: no physics module either, whose types are built on the catalog's materials; machines/mod_*.py, PLAYGROUND_MODULES)
    os.environ["PLAYGROUND_MODULES"] = ""
    for _name in ("catalog_items", "catalog_everyday", "catalog_mechanisms"):
        _m = types.ModuleType(_name)
        _m.__spec__ = importlib.machinery.ModuleSpec(_name, None)
        _m.register_all = lambda g: None
        sys.modules[_name] = _m
SNAPSHOTS = {}


def _snapshot(g):
    """The tables items.py holds right now (copies): what op "tables" answers about."""
    import copy
    mats = {}
    for k, v in g["MATERIALS"].items():
        d = dict(v)
        d["_ints"] = sorted(kk for kk, vv in v.items() if isinstance(vv, int) and not isinstance(vv, bool))
        mats[k] = d
    return copy.deepcopy({"materials": mats, "measured": [[sorted(k), v] for k, v in g["MEASURED"].items()], "looks": g["LOOKS"], "types": list(g["TYPES"]),
                          "categories": list(g["CATEGORIES"])})


if MODE == "everyday":
    sys.path.insert(0, os.path.join(PG, "machines"))
    _spec = importlib.util.spec_from_file_location("catalog_everyday_real", os.path.join(PG, "machines", "catalog_everyday.py"))
    _real = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_real)
    _wrapper = types.ModuleType("catalog_everyday")
    _wrapper.__spec__ = importlib.machinery.ModuleSpec("catalog_everyday", None)
    _wrapper.real = _real

    def _register_all(g):
        SNAPSHOTS["before"] = _snapshot(g)
        _real.register_all(g)
        SNAPSHOTS["after"] = _snapshot(g)
    _wrapper.register_all = _register_all
    sys.modules["catalog_everyday"] = _wrapper
if "--snapshot" in sys.argv:    # --snapshot catalog_mechanisms: the same wrapper for any catalog module (--mode everyday does it for catalog_everyday), used with --mode server
    _snap = sys.argv[sys.argv.index("--snapshot") + 1]
    sys.path.insert(0, os.path.join(PG, "machines"))
    _snap_spec = importlib.util.spec_from_file_location(_snap + "_real", os.path.join(PG, "machines", _snap + ".py"))
    _snap_real = importlib.util.module_from_spec(_snap_spec)
    _snap_spec.loader.exec_module(_snap_real)
    _snap_wrapper = types.ModuleType(_snap)
    _snap_wrapper.__spec__ = importlib.machinery.ModuleSpec(_snap, None)
    _snap_wrapper.real = _snap_real

    def _snap_register_all(g):
        SNAPSHOTS["before"] = _snapshot(g)      # what a port of this module starts from: items.py and every catalog module that registers before it
        _snap_real.register_all(g)
        SNAPSHOTS["after"] = _snapshot(g)       # what the port must have made
    _snap_wrapper.register_all = _snap_register_all
    sys.modules[_snap] = _snap_wrapper
sys.path.insert(0, os.path.join(PG, "web"))
import server  # noqa: E402  (puts machines/ on sys.path and imports items, as the server does)
import items  # noqa: E402


def core_pairs_from_catalog_items():
    """In core mode: catalog_items.py's own _materials() and _pairs() run against a scratch copy of the materials (so nothing of the catalog
    gets into items.py), and the pairs of two materials items.py itself defines are kept: what the server knows about core items that meet
    steel. Reading the real file keeps this in step with it."""
    spec = importlib.util.spec_from_file_location("catalog_items_real", os.path.join(PG, "machines", "catalog_items.py"))
    real = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(real)
    kept = []
    real.MATERIALS = {k: dict(v) for k, v in items.MATERIALS.items()}
    real.measured = lambda a, b, **kw: kept.append((a, b, kw))
    real._materials()
    real._pairs()
    for a, b, kw in kept:
        if a in items.MATERIALS and b in items.MATERIALS:
            items.measured(a, b, **kw)
    return len([1 for a, b, _ in kept if a in items.MATERIALS and b in items.MATERIALS])


if MODE == "core":
    core_pairs_from_catalog_items()

PROBE = {}


def build_probe(c, P):
    for op in PROBE.get(c.item["id"], []):
        name, args, kw = op[0], op[1], (op[2] if len(op) > 2 else {})
        kw = {k: _resolve(c, v) for k, v in kw.items()}
        getattr(c, name)(*args, **kw)


def _resolve(c, v):
    if isinstance(v, dict) and set(v) == {"$mat"}:
        return c.mat(**{k: _resolve(c, x) for k, x in v["$mat"].items()})
    if isinstance(v, dict) and set(v) == {"$pyint"}:
        return int(v["$pyint"])
    return v


items.register(items.ItemType("probe", "Probe", "Scenery", build_probe, material="varnished hardwood", materials=items.WOOD_PLANKS + ["steel"], dynamic=True))


def revive(v):
    if isinstance(v, dict):
        if set(v) == {"@@float"}:
            return {"nan": float("nan"), "inf": float("inf"), "-inf": float("-inf")}[v["@@float"]]
        return {k: revive(x) for k, x in v.items()}
    if isinstance(v, list):
        return [revive(x) for x in v]
    return v


def floatify(v):
    """Every JSON number as a float: a JavaScript number has no int/float split, so builders called with whole numbers
    (c.poly points, a density of 700) must behave here as they do there. {"$pyint": n} stays an int."""
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return float(v)
    if isinstance(v, dict):
        return v if set(v) == {"$pyint"} else {k: floatify(x) for k, x in v.items()}
    if isinstance(v, list):
        return [floatify(x) for x in v]
    return v


def dumps(v):
    return json.dumps(v, allow_nan=True, ensure_ascii=False)


def handle(req):
    if "op" not in req:     # a bare scene on a line (as the usage line says): what /api/layout answers, plus a summary if it carries a "track"
        req = {"id": req.get("id"), "op": "layout", "scene": req.get("scene", req), "track": req.get("track")}
    op = req["op"]
    if op == "version":
        return {"python": sys.version, "platform": platform.platform(), "mode": MODE}
    if op == "catalog":
        return items.catalog()
    if op == "module-types":    # which catalog file registered which types (a type's builder says which module it was defined in), in registration order
        return {m: [k for k, t in items.TYPES.items() if (getattr(t.build_fn, "__module__", None) or "").removesuffix("_real") == m] for m in items.CATALOG_MODULES}
    if op == "tables":
        if req.get("at") is not None:
            return SNAPSHOTS[req["at"]]
        mats = {}
        for k, v in items.MATERIALS.items():
            d = dict(v)
            d["_ints"] = sorted(kk for kk, vv in v.items() if isinstance(vv, int) and not isinstance(vv, bool))
            mats[k] = d
        return {"materials": mats, "measured": [[sorted(k), v] for k, v in items.MEASURED.items()], "looks": items.LOOKS, "types": list(items.TYPES),
                "categories": list(items.CATEGORIES)}
    scene = revive(req.get("scene"))
    if op == "clean":
        try:
            return {"ok": server.clean(scene)}
        except server.BadScene as e:
            return {"error": str(e)}
        except Exception as e:  # noqa: BLE001
            return {"error500": f"{type(e).__name__}: {e}"}
    if op == "layout":
        try:
            s = server.clean(scene)
            try:
                doc, resolved = items.build(s)
            except (ValueError, ArithmeticError) as e:
                raise server.BadScene(f"can't build this scene: {e}") from None
            out = {"doc": doc, "resolved": resolved, "warnings": items.overlaps(s, doc)}
            if req.get("track") is not None:
                out["summary"] = items.summarize(s, doc, server.with_statics(req["track"]))
            return out
        except server.BadScene as e:
            return {"error": str(e)}
        except Exception as e:  # noqa: BLE001
            return {"error500": f"{type(e).__name__}: {e}"}
    if op == "raw":
        scene = floatify(scene)
        PROBE.clear()
        PROBE.update(floatify(req.get("probe") or {}))
        try:
            doc, resolved = items.build(scene)
            return {"doc": doc, "resolved": resolved, "warnings": items.overlaps(scene, doc)}
        except Exception as e:  # noqa: BLE001
            return {"exc": type(e).__name__, "message": str(e)}
    raise ValueError(f"unknown op {op}")


def main():
    out = sys.stdout
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            res = handle(req)
        except Exception as e:  # noqa: BLE001
            res = {"harness_error": f"{type(e).__name__}: {e}"}
        out.write(dumps({"id": req.get("id"), "res": res}) + "\n")
    out.flush()


if __name__ == "__main__":
    main()
