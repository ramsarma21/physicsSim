"""Local physics sandbox: scenes of catalog items, simulated by the playground engine, viewed in 3D.

usage: python3 web/server.py [port]        then open http://localhost:8790
Playground copy only; binds 127.0.0.1, nothing leaves this machine.

API
  GET  /api/catalog                      item types (props, defaults, edit handles, a preview of each), categories, materials
                                         (?reload=1 re-reads machines/items.py and the catalog_*.py files first)
  GET  /api/scenarios                    [{id, name, builtin, items}]          GET /api/scenarios/<id>   one scene
  POST /api/scenarios {scene}            saves it (by its name) -> {id, name}
  POST /api/simulate  {scene}            -> {cached, key, doc, track (with impacts), summary, warnings, resolved, ms}; gzip when the
                                         client accepts it; the track lists each static solid that never moves only in frames[0]
  POST /api/layout    {scene}            -> {doc, resolved, warnings}: where everything starts, no physics (for dragging)
  POST /api/dev/snapshot {name, png}     development aid: saves a view's canvas as web/dev/shots/<name>.png
A scene the builder can't use (a number that isn't one, a choice that isn't offered, too many items...) answers 400 {error: why};
numbers outside their catalog range are clamped. The engine runs in two long-lived node workers (research/poc/worker.ts) that restart
when anything under tooling/src/sim/ or the engine's math in tools/ (ENGINE_MATH) changes; a client that hangs up while its run waits or
runs frees the worker for the next request.
"""
import base64
import copy
import hashlib
import json
import math
import os
import queue
import re
import select
import socket
import subprocess
import sys
import tempfile
import threading
import time
import zlib
from collections import OrderedDict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(PG, "machines"))
import items  # noqa: E402

SCENES = os.path.join(PG, "scenes")
WORKER = os.path.join(PG, "research", "poc", "worker.ts")
SIM = os.path.join(PG, "tooling", "src", "sim")
# the engine's math in node: the worker loads tools/engine-math-node.mjs, which gives the engine these files' functions (the bundle's)
ENGINE_MATH = [os.path.join(PG, "tools", f) for f in ("fdlibm.ts", "fdlibm-inject.ts", "crpow.ts", "crpow-big.ts", "crpow-tables.ts",
                                                       "engine-math-transform.ts", "engine-math-node.mjs")]
OUT = os.path.join(HERE, "out")
BUILTIN = os.path.join(HERE, "scenarios")
SAVED = os.path.join(HERE, "saved")
for d in (OUT, SAVED):
    os.makedirs(d, exist_ok=True)

WORKERS = 2               # engine runs at once
RUN_TIMEOUT = 120         # s: a run that takes longer is killed
CACHE_BYTES = 300 << 20   # budget for cached (gzipped) responses; the oldest go first
MAX_BODY = 8 << 20        # bytes of request
MAX_ITEMS = 200


def key_of(obj):
    return hashlib.sha1(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:12]


# ---------------------------------------------------------------- what a scene may hold
class BadScene(ValueError):
    """A request the builder can't use: the message says why (HTTP 400)."""


def _short(v):
    r = repr(v)
    return r if len(r) <= 30 else r[:27] + "..."


def _num(v, what, default=None, lo=None, hi=None):
    """v as a finite float clamped to [lo, hi]; None -> default (or an error if there is none); anything else unusable -> BadScene."""
    if v is None:
        if default is None:
            raise BadScene(f"{what} is missing")
        return float(default)
    if isinstance(v, (bool, list, dict)):
        raise BadScene(f"{what} must be a number, not {_short(v)}")
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise BadScene(f"{what} must be a number, not {_short(v)}") from None
    if not math.isfinite(x):
        raise BadScene(f"{what} must be a finite number, not {_short(v)}")
    if lo is not None:
        x = max(lo, x)
    if hi is not None:
        x = min(hi, x)
    return x


def _bool(v, what):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and v in (0, 1):
        return bool(v)
    if isinstance(v, str) and v.strip().lower() in ("true", "false", "yes", "no", "1", "0"):
        return v.strip().lower() in ("true", "yes", "1")
    raise BadScene(f"{what} must be true or false, not {_short(v)}")


_specs = {}


def prop_specs(type_key):
    """{prop key: spec} for an item type, as the catalog lists them (the material props included)."""
    if type_key not in _specs:
        _specs[type_key] = {p["key"]: p for p in items.TYPES[type_key].schema()["props"]}
    return _specs[type_key]


def _prop(v, spec, what):
    kind = spec["kind"]
    if kind == "bool":
        return _bool(v, what)
    if kind == "choice":
        if isinstance(v, str) and v in spec["choices"]:
            return v
        raise BadScene(f"{what} must be one of {', '.join(spec['choices'])}, not {_short(v)}")
    x = _num(v, what, lo=spec.get("min"), hi=spec.get("max"))
    return int(round(x)) if kind == "int" else x


def _item(i, n, seen):
    if not isinstance(i, dict):
        raise BadScene(f"item {n + 1} is not an object")
    t = i.get("type")
    if not isinstance(t, str) or t not in items.TYPES:
        return None                                  # an unknown type is left out, as before
    iid = i.get("id")
    if not isinstance(iid, str) or not 0 < len(iid) <= 80 or "/" in iid:
        raise BadScene(f"item {n + 1} ({t}) needs an id of 1 to 80 characters without '/'")
    if iid in seen:
        raise BadScene(f"two items are called {iid!r}")
    seen.add(iid)
    out = dict(i)
    for k, hi in (("x", 1000.0), ("y", 1000.0), ("angle", 1e5)):
        out[k] = _num(i.get(k), f"{iid}: {k}", 0.0, -hi, hi)
    for k in ("held", "fixed"):
        if i.get(k) is not None:
            out[k] = _bool(i[k], f"{iid}: {k}")
    if i.get("name") is not None:
        out["name"] = str(i["name"])[:80]
    props = i.get("props")
    if props is not None and not isinstance(props, dict):
        raise BadScene(f"{iid}: props must be an object")
    specs, clean_props = prop_specs(t), {}
    for k, v in (props or {}).items():
        if v is None:
            continue
        if k in specs:
            clean_props[k] = _prop(v, specs[k], f"{iid}: {specs[k]['label']}")
        elif isinstance(v, (bool, int, float, str)) and (not isinstance(v, float) or math.isfinite(v)) and len(str(v)) <= 64:
            clean_props[k] = v                       # an optional prop the type reads but doesn't list (a ball's colour)
    out["props"] = clean_props
    return out


def clean(scene):
    """A scene as the builder takes it: known item types only, every number a finite float and every prop inside its catalog range.
    Raises BadScene, with a short reason, for anything that can't be made usable."""
    if scene is None:
        scene = {}
    if not isinstance(scene, dict):
        raise BadScene("scene must be an object")
    s = copy.deepcopy(scene)
    s.setdefault("version", 2)
    s["seconds"] = _num(s.get("seconds"), "seconds", 4.5, 0.5, 20.0)
    s["release"] = _num(s.get("release"), "release", 0.5, 0.0, 20.0)
    stage = s.get("stage")
    if stage is not None and not isinstance(stage, dict):
        raise BadScene("stage must be an object {x0, x1, y0, y1}")
    base = {"x0": -0.56, "x1": 3.19, "y0": -0.16, "y1": 2.34}
    s["stage"] = {k: _num((stage or {}).get(k), f"stage.{k}", v, -1000.0, 1000.0) for k, v in base.items()}
    if s["stage"]["x1"] - s["stage"]["x0"] < 0.01 or s["stage"]["y1"] - s["stage"]["y0"] < 0.01:
        raise BadScene("stage needs x1 > x0 and y1 > y0")
    if s.get("name") is not None:
        s["name"] = str(s["name"])[:80]
    if s.get("id") is not None:
        s["id"] = str(s["id"])[:80]
    raw = s.get("items")
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raise BadScene("items must be a list")
    if len(raw) > MAX_ITEMS:
        raise BadScene(f"too many items ({len(raw)}; at most {MAX_ITEMS})")
    seen = set()
    s["items"] = [i for i in (_item(i, n, seen) for n, i in enumerate(raw)) if i is not None]
    goals = s.get("goals")
    if goals is not None:
        if not isinstance(goals, list) or not all(isinstance(g, dict) for g in goals):
            raise BadScene("goals must be a list of objects")
        for g in goals:
            for k in ("item", "container"):
                if not isinstance(g.get(k), str):
                    g[k] = None
            if g.get("label") is not None:
                g["label"] = str(g["label"])[:200]
    return s


# ---------------------------------------------------------------- the engine: long-lived node workers
class Abandoned(Exception):
    """The client hung up before its run finished."""


def engine_stamp():
    """The newest mtime of the engine's sources, its math (ENGINE_MATH) and the worker itself: a worker started under an older one runs stale code."""
    m = 0.0
    for folder, _, files in os.walk(SIM):
        for f in files:
            if f.endswith(".ts"):
                try:
                    m = max(m, os.stat(os.path.join(folder, f)).st_mtime)
                except OSError:
                    pass                             # an editor swapped the file just now
    for f in ENGINE_MATH:
        try:
            m = max(m, os.stat(f).st_mtime)
        except OSError:
            pass
    return max(m, os.stat(WORKER).st_mtime)


class Worker:
    """One `node worker.ts`: a JSON request per line in, one `id<TAB>ms<TAB>track JSON` (or `id<TAB>error<TAB>message`) line out."""

    def __init__(self):
        self.stamp = engine_stamp()                  # read before the start, so an edit during the start restarts it
        self.err = tempfile.TemporaryFile()
        self.proc = subprocess.Popen(["node", "--no-warnings", WORKER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err, cwd=PG)
        self.lines = queue.Queue()
        self.n = 0
        threading.Thread(target=self._read, args=(self.proc, self.lines), daemon=True).start()

    @staticmethod
    def _read(proc, lines):
        try:
            for line in proc.stdout:
                lines.put(line)
        except (OSError, ValueError):
            pass
        finally:
            lines.put(None)
            proc.stdout.close()

    def stale(self):
        return self.proc.poll() is not None or self.stamp != engine_stamp()

    def kill(self):
        try:
            self.proc.kill()
            self.proc.wait()
        except OSError:
            pass
        for f in (self.proc.stdin, self.err):
            try:
                f.close()
            except OSError:
                pass

    def crash(self):
        try:
            self.err.seek(0)
            tail = [ln for ln in self.err.read().decode(errors="replace").strip().splitlines() if ln.strip()]
        except (OSError, ValueError):
            tail = []
        return "engine stopped: " + (tail[-1] if tail else "no reason given")

    def run(self, doc, rate, gone):
        """The slimmed track JSON (bytes) for a scene document. Raises Abandoned if gone() turns true while waiting."""
        self.n += 1
        try:
            self.proc.stdin.write((json.dumps({"id": self.n, "doc": doc, "rate": rate}) + "\n").encode())
            self.proc.stdin.flush()
        except OSError:
            raise RuntimeError(self.crash()) from None
        deadline = time.monotonic() + RUN_TIMEOUT
        while True:
            try:
                line = self.lines.get(timeout=0.05)
            except queue.Empty:
                if gone():
                    raise Abandoned()
                if time.monotonic() > deadline:
                    raise TimeoutError(f"the engine took more than {RUN_TIMEOUT} s")
                continue
            if line is None:
                raise RuntimeError(self.crash())
            ident, what, raw = line.split(b"\t", 2)
            if int(ident) != self.n:
                continue
            if what == b"error":
                raise RuntimeError(json.loads(raw))
            return raw.rstrip(b"\n")


class Pool:
    """WORKERS workers, started on demand. When more runs wait than there are workers the newest goes first (the app only shows
    the newest); a waiting run whose client hung up drops out, and a worker whose run was abandoned, crashed or timed out is replaced."""

    def __init__(self, size):
        self.size, self.made, self.idle, self.waiting = size, 0, [], []
        self.cv = threading.Condition()

    def prewarm(self):
        with self.cv:
            while self.made < self.size:
                self.made += 1
                self.idle.append(Worker())

    def acquire(self, gone):
        me = object()
        with self.cv:
            self.waiting.append(me)
            try:
                while not (self.waiting[-1] is me and (self.idle or self.made < self.size)):
                    if gone():
                        raise Abandoned()
                    self.cv.wait(0.1)
                w = self.idle.pop() if self.idle else None
                if w is None:
                    self.made += 1
            finally:
                self.waiting.remove(me)
                self.cv.notify_all()
        try:
            if w is None or w.stale():
                if w is not None:
                    w.kill()
                w = Worker()
        except BaseException:
            with self.cv:
                self.made -= 1
                self.cv.notify_all()
            raise
        return w

    def release(self, w, dead):
        if dead or w.n >= 200:                       # also a fresh process now and then, so memory can't creep
            w.kill()
            try:
                w = Worker()                         # boots in the background while the next request is parsed
            except OSError:
                with self.cv:
                    self.made -= 1
                    self.cv.notify_all()
                raise
        with self.cv:
            self.idle.append(w)
            self.cv.notify_all()


POOL = Pool(WORKERS)


def run_track(doc, rate, gone):
    """The engine's slimmed track (JSON bytes) for a scene document, sampled at `rate` Hz."""
    w = POOL.acquire(gone)
    dead = True
    try:
        raw = w.run(doc, rate, gone)
        dead = False
        return raw
    finally:
        POOL.release(w, dead)


def client_gone(sock):
    """A callable: has the client of this connection hung up? (readable with nothing to read means it closed)"""
    def gone():
        try:
            readable, _, _ = select.select([sock], [], [], 0)
            return bool(readable) and sock.recv(1, socket.MSG_PEEK) == b""
        except (OSError, ValueError):
            return True
    return gone


# ---------------------------------------------------------------- results, cached as gzipped bytes
def gzip_bytes(data):
    c = zlib.compressobj(1, zlib.DEFLATED, 31)
    return c.compress(data) + c.flush()


_cache = OrderedDict()       # key -> [gz of the first answer ("cached":false), gz of the same with "cached":true or None]
_cache_bytes = 0
_cache_lock = threading.Lock()
MISS, HIT = b'{"cached":false,', b'{"cached":true,'


def _evict():
    global _cache_bytes
    while _cache_bytes > CACHE_BYTES and len(_cache) > 1:
        _, e = _cache.popitem(last=False)
        _cache_bytes -= len(e[0]) + len(e[1] or b"")


def cache_put(k, gz):
    global _cache_bytes
    with _cache_lock:
        if k in _cache:
            _cache_bytes -= len(_cache[k][0]) + len(_cache[k][1] or b"")
        _cache[k] = [gz, None]
        _cache_bytes += len(gz)
        _evict()


def cache_get(k):
    """The gzipped answer for a scene run before, marked "cached":true (made on the first hit, then kept), or None."""
    global _cache_bytes
    with _cache_lock:
        e = _cache.get(k)
        if e is None:
            return None
        _cache.move_to_end(k)
        if e[1] is not None:
            return e[1]
    hit = gzip_bytes(zlib.decompress(e[0], 31).replace(MISS, HIT, 1))
    with _cache_lock:
        if e[1] is None and _cache.get(k) is e:
            e[1] = hit
            _cache_bytes += len(hit)
            _evict()
    return hit


def reload_cache_clear():
    global _cache_bytes
    with _cache_lock:
        _cache.clear()
        _cache_bytes = 0


def with_statics(track):
    """summarize() looks at every solid in the first and last frame and at the dynamic ones in all; the track lists static solids
    that never move only in frame 0, so the last frame gets them back."""
    fr = track["frames"]
    if len(fr) < 2:
        return track
    last = dict(fr[-1], placements={**fr[0]["placements"], **fr[-1]["placements"]})
    return dict(track, frames=fr[:-1] + [last])


def simulate(scene, gone=lambda: False):
    """The gzipped JSON answer for a scene (see the API list above); runs the engine unless this scene was run before."""
    s = clean(scene)
    k = key_of({kk: v for kk, v in s.items() if kk not in ("name", "id")})
    hit = cache_get(k)
    if hit is not None:
        return hit
    t0 = time.time()
    try:
        doc, resolved = items.build(s)
    except (ValueError, ArithmeticError) as e:
        raise BadScene(f"can't build this scene: {e}") from None
    raw = run_track(doc, 120, gone)
    track = json.loads(raw)
    meta = {"cached": False, "key": k, "doc": doc, "summary": items.summarize(s, doc, with_statics(track)), "warnings": items.overlaps(s, doc),
            "resolved": resolved, "ms": int((time.time() - t0) * 1000)}
    body = json.dumps(meta, separators=(",", ":")).encode()
    assert body.startswith(MISS)
    gz = gzip_bytes(body[:-1] + b',"track":' + raw + b"}")
    cache_put(k, gz)
    return gz


def layout(scene):
    s = clean(scene)
    try:
        doc, resolved = items.build(s)
    except (ValueError, ArithmeticError) as e:
        raise BadScene(f"can't build this scene: {e}") from None
    return {"doc": doc, "resolved": resolved, "warnings": items.overlaps(s, doc)}


_catalog = None


def reload_items():
    """Picks up edits to machines/items.py and the machines/catalog_*.py files without a restart (GET /api/catalog?reload=1)."""
    import importlib
    global _catalog
    for mod in items.CATALOG_MODULES:
        if mod in sys.modules:
            importlib.reload(sys.modules[mod])
    importlib.reload(items)
    _catalog = None
    _specs.clear()
    reload_cache_clear()


def catalog():
    global _catalog
    if _catalog is None:
        _catalog = items.catalog()
    return _catalog


def scenarios():
    out = []
    for folder, builtin in ((BUILTIN, True), (SAVED, False)):
        for f in sorted(os.listdir(folder)):
            if f.endswith(".json"):
                try:
                    s = json.load(open(os.path.join(folder, f)))
                except Exception:
                    continue
                out.append({"id": f[:-5], "name": s.get("name", f[:-5]), "builtin": builtin, "items": len(s.get("items", []))})
    order = {"rube-goldberg": 0, "empty": 1}
    out.sort(key=lambda s: (not s["builtin"], order.get(s["id"], 9), s["name"].lower()))
    return out


def scenario(sid):
    for folder in (BUILTIN, SAVED):
        p = os.path.join(folder, os.path.basename(sid) + ".json")
        if os.path.exists(p):
            return json.load(open(p))
    raise FileNotFoundError(f"no scenario {sid}")


def save_scenario(scene):
    s = clean(scene)
    name = re.sub(r"[^\w\- ']", "", s.get("name") or "").strip()[:60] or time.strftime("Scene %H%M%S")
    sid = re.sub(r"\s+", "-", name.lower())
    if os.path.exists(os.path.join(BUILTIN, sid + ".json")):
        sid += "-mine"
    s["name"], s["id"] = name, sid
    json.dump(s, open(os.path.join(SAVED, sid + ".json"), "w"), indent=1)
    return {"id": sid, "name": name}


# ---------------------------------------------------------------- AI steps: POST /api/ai/<observe|plan|refine|edit|imagine>
# Body {payload, client?: {requestId}} (at most 12 MB) -> the answer of `node ai/cli.mjs` for that step: {ok: true, result, model, ms, usage, ...}
# or {ok: false, error, code, retryable} with the status it names (400 bad input, 403 not this app, 413 too large, 415 not JSON, 429 busy,
# 502 the models failed, 504 out of time). Each request runs in its own process, which loads the key itself (`source ~/.config/truefoundry/env`):
# it never passes through this server, its logs or its answers. A client that hangs up cancels its step (the process is stopped, so the gateway
# call is dropped), or leaves the queue if it was still waiting.
# The queue (ai/DESIGN.md §13): at most AI_SLOT_COUNT steps run at once and at most AI_STEP_SLOTS[step] of each step (so long plans and picture
# looks cannot take every slot from quick edits and checks); the rest wait first come, first served among the requests whose step has room,
# for up to AI_QUEUE_WAIT s. A request that cannot wait (AI_QUEUE_MAX already waiting) or waited that long gets 429 busy with Retry-After and
# {busy: true, position, retryAfterMs} (an estimate from the step's recent durations). GET /api/ai/progress?id=<requestId> says where a step
# is: waiting (position in the queue, eta_ms), running (the model, its attempt, and how many tokens it has thought and written so far: the
# CLI's progress lines), done; GET /api/ai/progress alone says how many run and wait, in all and per step. Numbers and model names only.
# Only this app may call these routes: a JSON body (so another site's page needs a CORS preflight, which this server never grants), a Host of
# this server (no DNS rebinding) and, when the browser sends one, an Origin of this server.
AI_STEPS = ("observe", "plan", "refine", "edit", "imagine")   # imagine: a concept picture from words (ai/DESIGN.md §15)
AI_MAX_BODY = 12 << 20
AI_MARGIN = 15            # s on top of the step's budgetMs in ai/models.json
AI_CMD = ["zsh", "-c", "source ~/.config/truefoundry/env && exec node ai/cli.mjs"]
# Sized to the gateway: the benchmark ran up to 24 Opus calls at once through it without a 429 (ai/research/benchmark.md §13); one build has at
# most one step in flight, so 12 slots serve 12 builds at once. Size them to the expected audience before a demo (env AI_SLOTS, AI_STEP_SLOTS).
AI_SLOT_COUNT = max(1, int(os.environ.get("AI_SLOTS") or 12))   # AI steps running at once, in all
AI_STEP_SLOTS = {"observe": 4, "plan": 6, "refine": 8, "edit": 8, "imagine": 4}   # ... and of each step (a step's cap never exceeds the total)
for _k, _v in (kv.split("=", 1) for kv in (os.environ.get("AI_STEP_SLOTS") or "").split(",") if "=" in kv):
    if _k.strip() in AI_STEP_SLOTS and _v.strip().isdigit():
        AI_STEP_SLOTS[_k.strip()] = max(1, int(_v))
AI_QUEUE_WAIT = float(os.environ.get("AI_QUEUE_WAIT") or 90)   # s a step may wait for a free slot
AI_QUEUE_MAX = max(1, int(os.environ.get("AI_QUEUE_MAX") or 48))   # steps that may wait at once; one more is told "busy" at once
AI_TYPICAL_S = {"observe": 30.0, "plan": 30.0, "refine": 15.0, "edit": 6.0, "imagine": 25.0}   # a step's usual duration until some have been measured
AI_RID = re.compile(r"^[\w.:-]{1,80}$")


class AiSlots:
    """At most n AI steps at once, and at most per_step[step] of each step; the others wait first come, first served among those whose step
    has room. acquire(step, ...) -> (True, None) with a slot held (release(step, seconds) it), or (False, {position, retryAfterMs}) when the
    wait ran out, the queue is full, or the client left while it waited."""

    def __init__(self, n, per_step=None, queue_max=48):
        self.n, self.per_step, self.queue_max = n, dict(per_step or {}), queue_max
        self.busy, self.busy_by, self.queue, self.cv = 0, {}, [], threading.Condition()
        self.typical = dict(AI_TYPICAL_S)

    def _cap(self, step):
        return min(self.n, self.per_step.get(step, self.n))

    def _eligible(self, step):
        return self.busy < self.n and self.busy_by.get(step, 0) < self._cap(step)

    def _take(self, step):
        self.busy += 1
        self.busy_by[step] = self.busy_by.get(step, 0) + 1

    def _position(self, ticket):
        return self.queue.index(ticket) + 1 if ticket in self.queue else len(self.queue) + 1

    def eta_ms(self, step, position):
        """About how long until a step at this place in the queue starts: the waits ahead of it share the step's slots."""
        with self.cv:
            return self._eta(step, position)

    def _eta(self, step, position):
        ahead = [t for t in self.queue[: max(0, position - 1)] if t[1] == step]
        rounds = (len(ahead) + 1) / max(1, self._cap(step))
        return int(min(120000, max(1000, rounds * self.typical.get(step, 20.0) * 1000)))

    def acquire(self, step, wait, gone=lambda: False, on_wait=None):
        """-> (True, None) with a slot held, or (False, {position, retryAfterMs}) refused."""
        ticket = (object(), step)
        with self.cv:
            if not self.queue and self._eligible(step):
                self._take(step)
                return True, None
            if len(self.queue) >= self.queue_max:
                pos = len(self.queue) + 1
                return False, {"position": pos, "retryAfterMs": self._eta(step, pos)}
            self.queue.append(ticket)
            deadline = time.monotonic() + wait
            try:
                while True:
                    # first come, first served among the waiting steps that could run now (a step at its own cap does not block the others)
                    first = next((t for t in self.queue if self._eligible(t[1])), None)
                    if first is ticket:
                        self.queue.remove(ticket)
                        self._take(step)
                        self.cv.notify_all()
                        return True, None
                    pos = self._position(ticket)
                    if on_wait:
                        on_wait(pos, self._eta(step, pos))
                    left = deadline - time.monotonic()
                    if left <= 0 or gone():
                        return False, {"position": pos, "retryAfterMs": self._eta(step, pos)}
                    self.cv.wait(min(left, 0.25))
            finally:
                if ticket in self.queue:
                    self.queue.remove(ticket)
                    self.cv.notify_all()

    def release(self, step, seconds=None):
        with self.cv:
            self.busy = max(0, self.busy - 1)
            self.busy_by[step] = max(0, self.busy_by.get(step, 0) - 1)
            if seconds is not None and seconds > 0:
                self.typical[step] = 0.8 * self.typical.get(step, seconds) + 0.2 * min(600.0, seconds)
            self.cv.notify_all()

    def state(self):
        with self.cv:
            steps = {k: {"running": self.busy_by.get(k, 0), "waiting": sum(1 for t in self.queue if t[1] == k), "slots": self._cap(k)} for k in AI_STEPS}
            return {"running": self.busy, "waiting": len(self.queue), "slots": self.n, "queue_max": self.queue_max, "steps": steps}


AI_SLOTS = AiSlots(AI_SLOT_COUNT, AI_STEP_SLOTS, AI_QUEUE_MAX)
_ai_progress = OrderedDict()   # requestId -> {state, step, position?, model?, attempt?, repair?, phase?, tokens?, ms?, started, updated}
_ai_progress_lock = threading.Lock()


def ai_progress(rid, **kw):
    if not rid:
        return
    now = time.time()
    with _ai_progress_lock:
        e = _ai_progress.get(rid) or {"started": now}
        e.update(kw)
        e["updated"] = now
        _ai_progress[rid] = e
        _ai_progress.move_to_end(rid)
        while len(_ai_progress) > 300:
            _ai_progress.popitem(last=False)


def ai_progress_of(rid):
    with _ai_progress_lock:
        e = _ai_progress.get(rid)
        if e is None:
            return None
        out = {k: v for k, v in e.items() if k not in ("started", "updated")}
        out["elapsed_ms"] = int((time.time() - e["started"]) * 1000)
        out["age_ms"] = int((time.time() - e["updated"]) * 1000)
        return out


def ai_answer(code, error, status, retryable=False, **extra):
    return status, json.dumps({"ok": False, "error": error, "code": code, "retryable": retryable, **extra}).encode()


def ai_caller_problem(handler):
    """Why a request to /api/ai/* does not come from this app (403/415), or None. The server only listens on this machine, but a web page in
    any browser tab could still send it a simple cross-site request (or rebind a hostname to 127.0.0.1) and spend the AI key: the body must be
    JSON (a cross-site JSON post needs a preflight, which this server never grants), the Host must be this server, and an Origin, when the
    browser sends one, must be this server too."""
    port = handler.server.server_address[1]
    hosts = {f"{h}:{port}" for h in ("localhost", "127.0.0.1", "[::1]")} | ({"localhost", "127.0.0.1", "[::1]"} if port == 80 else set())
    host = (handler.headers.get("Host") or "").strip().lower()
    if host not in hosts:
        return 403, "this AI route only answers this app (the Host is not this server)"
    origin = (handler.headers.get("Origin") or "").strip().lower()
    if origin and origin not in {f"http://{h}" for h in hosts}:
        return 403, "this AI route only answers this app (another site's page asked)"
    ctype = (handler.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if ctype != "application/json":
        return 415, "the body must be JSON (Content-Type: application/json)"
    return None


def ai_budget(step):
    """Seconds a step may take: its budgetMs in ai/models.json (re-read every time, so a new routing applies at once) plus a margin. An edit
    that turns out to ask for a different scene goes on to plan it (ai/DESIGN.md §13.8), so an edit may also take a plan's budget."""
    try:
        with open(os.path.join(PG, "ai", "models.json")) as f:
            m = json.load(f)
        of = lambda k: float((m.get("steps") or {}).get(k, {}).get("budgetMs") or (m.get("defaults") or {}).get("budgetMs") or 300000) / 1000
        return of(step) + (of("plan") if step == "edit" else 0) + AI_MARGIN
    except (OSError, ValueError, AttributeError, TypeError):
        return (600.0 if step == "edit" else 300.0) + AI_MARGIN


def ai_stop(proc):
    """Stop a step's process (SIGTERM first: the step aborts its gateway call and exits), and reap it."""
    for sig, wait in ((15, 3), (9, 2)):
        try:
            os.killpg(proc.pid, sig)
        except (ProcessLookupError, PermissionError, OSError):
            pass
        try:
            proc.wait(wait)
            return
        except subprocess.TimeoutExpired:
            continue


def run_ai(step, body, gone, rid=None):
    """(HTTP status, answer bytes) of one AI step, or (None, None) when the client hung up first. rid: the client's requestId, under which
    the step's progress lines (stderr "AIPROGRESS {...}": numbers and the model's name) are kept for GET /api/ai/progress."""
    try:
        proc = subprocess.Popen(AI_CMD, cwd=PG, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
                                env={**os.environ, "AI_PROGRESS": "1"})
    except OSError:
        return ai_answer("config", "the AI step could not be started on this machine", 500)
    got = {}

    def errs():
        try:
            for line in proc.stderr:
                if not line.startswith(b"AIPROGRESS "):
                    continue
                try:
                    p = json.loads(line[11:])
                except ValueError:
                    continue
                if isinstance(p, dict):
                    ai_progress(rid, state="running", **{k: p[k] for k in ("model", "attempt", "repair", "phase", "tokens", "ms")
                                                         if isinstance(p.get(k), (int, float, str, bool))})
        except (OSError, ValueError):
            pass

    def talk():
        try:
            try:
                proc.stdin.write(body)
                proc.stdin.close()
            except (BrokenPipeError, OSError):
                pass                                 # it stopped reading (it answers on stdout all the same)
            got["out"] = proc.stdout.read()
            proc.wait()
        except (OSError, ValueError) as e:
            got["err"] = e
    threading.Thread(target=errs, daemon=True).start()
    t = threading.Thread(target=talk, daemon=True)
    t.start()
    deadline = time.monotonic() + ai_budget(step)
    while t.is_alive():
        t.join(0.2)
        if not t.is_alive():
            break
        if gone():
            ai_stop(proc)
            return None, None
        if time.monotonic() > deadline:
            ai_stop(proc)
            return ai_answer("timeout", "the AI step took too long", 504, True)
    out = (got.get("out") or b"").strip()
    try:
        ans = json.loads(out.decode("utf-8")) if out else None
    except (UnicodeDecodeError, ValueError):
        ans = None
    if not isinstance(ans, dict) or not isinstance(ans.get("ok"), bool):
        return ai_answer("internal", f"the AI step failed (exit {proc.returncode})", 502, True)
    status = 200 if ans["ok"] else ans.get("status")
    if not isinstance(status, int) or not (200 <= status <= 599) or (not ans["ok"] and status < 400):
        status = 502
    return status, out


def accepts_gzip(header):
    for part in (header or "").lower().split(","):
        name, _, q = part.strip().partition(";")
        if name.strip() in ("gzip", "x-gzip", "*"):
            return not re.fullmatch(r"\s*q\s*=\s*0(\.0*)?\s*", q)
    return False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send(self, body, code=200, gz=False, headers=None):
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            if gz:
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Vary", "Accept-Encoding")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass                                     # the client left

    def _json(self, obj, code=200):
        self._send(json.dumps(obj).encode(), code)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise BadScene(f"request too large ({n >> 20} MB; at most {MAX_BODY >> 20} MB)")
        try:
            b = json.loads(self.rfile.read(n) or b"{}") if n else {}
        except ValueError:
            raise BadScene("the request body isn't valid JSON") from None
        if not isinstance(b, dict):
            raise BadScene("the request body must be a JSON object")
        return b

    def translate_path(self, path):
        u = unquote(urlparse(path).path)
        if u.startswith("/sprites/"):
            return os.path.join(SCENES, "rube", "sprites", os.path.basename(u))
        return super().translate_path(path)

    def do_GET(self):
        u = urlparse(self.path).path
        try:
            if u == "/api/catalog":
                if "reload" in (urlparse(self.path).query or ""):
                    reload_items()
                return self._json(catalog())
            if u == "/api/scenarios":
                return self._json(scenarios())
            if u.startswith("/api/scenarios/"):
                return self._json(scenario(u.rsplit("/", 1)[-1]))
            if u == "/api/ai/progress":
                rid = next((v for k, v in parse_qsl(urlparse(self.path).query) if k == "id"), None)
                if rid is None:
                    return self._json({"ok": True, **AI_SLOTS.state()})
                p = ai_progress_of(rid) if AI_RID.match(rid) else None
                if p is None:
                    return self._json({"ok": False, "error": "no such AI request (or it finished long ago)"}, 404)
                return self._json({"ok": True, "id": rid, **p})
        except FileNotFoundError as e:
            return self._json({"error": str(e)}, 404)
        except Exception as e:
            return self._json({"error": str(e)}, 500)
        return super().do_GET()

    def _ai_reply(self, answer, retry_after_s=None):
        status, body = answer
        self._send(body, status, headers={"Retry-After": str(retry_after_s or 5)} if status == 429 else None)

    def _ai(self, step):
        """POST /api/ai/<step> (see run_ai and AiSlots)."""
        try:
            if step not in AI_STEPS:
                return self._ai_reply(ai_answer("bad_input", f"no AI step {step[:40]!r} (one of {', '.join(AI_STEPS)})", 404))
            bad = ai_caller_problem(self)
            if bad:
                self.close_connection = True       # its body is not read
                return self._ai_reply(ai_answer("forbidden" if bad[0] == 403 else "bad_input", bad[1], bad[0]))
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                n = -1
            if n < 0:
                return self._ai_reply(ai_answer("bad_input", "the request needs a Content-Length", 400))
            if n > AI_MAX_BODY:
                self.close_connection = True       # its body is not read
                return self._ai_reply(ai_answer("too_large", f"the request is too large ({n / 1048576:.1f} MB; at most {AI_MAX_BODY >> 20} MB): downscale the pictures", 413))
            try:
                b = json.loads(self.rfile.read(n) or b"null") if n else None
            except ValueError:
                b = "bad"
            if not isinstance(b, dict) or not isinstance(b.get("payload"), dict):
                return self._ai_reply(ai_answer("bad_input", "the body must be JSON {payload: {...}, client?: {requestId}}", 400))
            req = {"step": step, "payload": b["payload"]}
            rid = (b.get("client") or {}).get("requestId") if isinstance(b.get("client"), dict) else None
            if isinstance(rid, str):
                req["client"] = {"requestId": rid[:80]}
            rid = rid[:80] if isinstance(rid, str) and AI_RID.match(rid[:80]) else None
            gone = client_gone(self.connection)
            ai_progress(rid, state="waiting", step=step)
            ok, refused = AI_SLOTS.acquire(step, AI_QUEUE_WAIT, gone, lambda n, eta: ai_progress(rid, state="waiting", position=n, eta_ms=eta))
            if not ok:
                ai_progress(rid, state="done", ok=False, code="busy")
                if gone():
                    return
                ms = int(refused["retryAfterMs"])
                return self._ai_reply(ai_answer("busy", "the AI is busy: other builds are using every AI slot; this request was not started (try again in a moment)", 429, True,
                                                busy=True, position=refused["position"], retryAfterMs=ms, retryAfter=max(1, -(-ms // 1000))), max(1, -(-ms // 1000)))
            ai_progress(rid, state="running", position=0, eta_ms=0)
            t0 = time.monotonic()
            try:
                status, out = run_ai(step, json.dumps(req).encode(), gone, rid)
            finally:
                AI_SLOTS.release(step, time.monotonic() - t0)
                ai_progress(rid, state="done")
            if status is not None:
                self._send(out, status)
        except Exception:
            self._ai_reply(ai_answer("internal", "the AI step failed on the server", 500, True))

    def do_POST(self):
        u = urlparse(self.path).path
        if u.startswith("/api/ai/"):
            return self._ai(u[len("/api/ai/"):])
        try:
            b = self._body()
            if u == "/api/simulate":
                gz = simulate(b.get("scene", {}), client_gone(self.connection))
                if accepts_gzip(self.headers.get("Accept-Encoding")):
                    return self._send(gz, gz=True)
                return self._send(zlib.decompress(gz, 31))
            if u == "/api/layout":
                return self._json(layout(b.get("scene", {})))
            if u == "/api/scenarios":
                return self._json(save_scenario(b.get("scene", {})))
            if u == "/api/dev/snapshot":
                name = re.sub(r"[^\w\-]", "", b.get("name", "shot"))[:60] or "shot"
                os.makedirs(os.path.join(HERE, "dev", "shots"), exist_ok=True)
                path = os.path.join(HERE, "dev", "shots", name + ".png")
                open(path, "wb").write(base64.b64decode(b["png"].split(",", 1)[-1]))
                return self._json({"saved": path})
        except Abandoned:
            return                                   # nobody is listening any more
        except BadScene as e:
            return self._json({"error": str(e)}, 400)
        except Exception as e:
            return self._json({"error": str(e)}, 500)
        self._json({"error": "not found"}, 404)


class Server(ThreadingHTTPServer):
    request_queue_size = 64                          # a burst of edits shouldn't overflow the listen backlog


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    srv = Server(("127.0.0.1", port), Handler)
    POOL.prewarm()
    print(f"Physics sandbox: http://localhost:{port}", flush=True)
    srv.serve_forever()
