"""The staging module: how a scene is filmed for a lesson video. Render only: nothing here changes a body, a contact or a track.

  settings.camera  {x0, x1, y, pitch?, hfov?}: a FIXED side camera. It stands d = (x1 - x0) / 2 / tan(hfov / 2) in front of the machine plane
                   (z = d), at the height y + d tan(pitch), looking at ((x0 + x1) / 2, y, 0), +y up, a lens of horizontal field `hfov` degrees:
                   the machine plane spans x0 .. x1 m across the picture's width at the height y m (the picture's centre line; exactly at
                   pitch 0, 1 / cos(pitch) of it when tilted). Every run that sets the same camera is filmed from the same place, whatever
                   is in it: two lanes run apart line up pixel for pixel (a 10 m track, a "1 block vs 3 blocks" pair stacked top and bottom).
                   The defaults are the Wide shot's own lens and tilt (26 mm, tan(pitch) = 0.12). The document carries it as doc.view.camera
                   (web/view3d.js: the Wide shot on the canvas and the export's "wide" and "fixed" cameras).
  start_gate       (a common prop of balls, vehicles and blocks) a held item waits behind a STARTING GATE instead of on the pull pin: a bar
                   on a post behind the track whose stop touches the item's front and lifts away at the release (web/start-gate.js). The
                   engine's hold is exact (the item is still until the release), so the gate only shows what holds it. doc.view.gates lists
                   the items that set it.

The build hook writes doc.view (machines/items.py build: a module's build hook may set sb.view) only for a scene that sets one of these, so
every other scene builds the very document it did before. web/sim/modules/staging.js is its port, line for line.
"""
import math

NEEDED = ("register_build_hook", "register_common_prop", "Prop", "TYPES")

# The wide shot's own lens and tilt (web/view3d.js HFOV_26MM = 2 atan(18/26), WIDE_PITCH = 0.12 = tan(pitch)): a fixed camera that gives
# only x0, x1 and y looks like the Wide shot.
CAMERA_DEFAULTS = {"y": 0.3, "pitch": 6.843, "hfov": 69.39}
CAMERA_LIMITS = {"x0": (-1000.0, 1000.0), "x1": (-1000.0, 1000.0), "y": (-10.0, 100.0), "pitch": (-20.0, 80.0), "hfov": (5.0, 120.0)}
CAMERA_KEYS = ("x0", "x1", "y", "pitch", "hfov")
CAMERA_RANGE_TEXT = {"x0": "-1000 to 1000", "x1": "-1000 to 1000", "y": "-10 to 100", "pitch": "-20 to 80", "hfov": "5 to 120"}
SPAN = (0.1, 300.0)          # m: the narrowest and the widest x1 - x0
GATE_CATEGORIES = ("Balls", "Wheels & vehicles", "Blocks & shapes")


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    register_common_prop(Prop("start_gate", "Starting gate", False, kind="bool",
                              help="While it is held: a starting gate holds it (a bar that lifts away at the release) instead of the pull pin"),
                         lambda t: bool(t.dynamic) and t.category in GATE_CATEGORIES)
    register_build_hook(_staging)


def camera_of(raw):
    """settings.camera checked: {x0, x1, y, pitch, hfov} as floats (the defaults where it says nothing); ValueError for one the view cannot use."""
    if not isinstance(raw, dict):
        raise ValueError("settings.camera must be an object {x0, x1, y, pitch, hfov}")
    for k in raw:
        if k not in CAMERA_KEYS:
            raise ValueError(f"settings.camera has no {str(k)[:20]!r} (it takes x0, x1, y, pitch, hfov)")
    out = {}
    for k in CAMERA_KEYS:
        v = raw.get(k)
        if v is None:
            if k in ("x0", "x1"):
                raise ValueError("settings.camera needs x0 and x1 (m: what the picture spans, left to right)")
            out[k] = CAMERA_DEFAULTS[k]
            continue
        lo, hi = CAMERA_LIMITS[k]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
            raise ValueError(f"settings.camera.{k} must be a number from {CAMERA_RANGE_TEXT[k]}")
        out[k] = float(v)
    if not SPAN[0] <= out["x1"] - out["x0"] <= SPAN[1]:
        raise ValueError("settings.camera needs x1 - x0 from 0.1 to 300 m")
    return out


def _staging(sb, scene):
    """doc.view for a scene that sets a fixed camera or starting gates (sb.view: machines/items.py build writes it); nothing otherwise."""
    view = {}
    st = scene.get("settings")
    if isinstance(st, dict) and st.get("camera") is not None:
        view["camera"] = camera_of(st["camera"])
    gates = []
    for item in scene.get("items", []):
        if isinstance(item, dict) and item.get("type") in TYPES and isinstance(item.get("props"), dict) and item["props"].get("start_gate") is True:
            gates.append(item["id"])
    if gates:
        view["gates"] = gates
    if view:
        sb.view = view
