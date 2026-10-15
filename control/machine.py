# Machine panel: sliders for the Rube Goldberg scene. Each change rewrites the playground's scene document
# from machines/rube.py, rebuilds the shot and re-runs the physics. Playground copy only.
import bpy
import json
import math
import os
import subprocess
import sys
import time

from bpy.props import BoolProperty, EnumProperty, FloatProperty, IntProperty

PG = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if "__file__" in globals() else os.path.expanduser("~/Downloads/science-map-share/blender-playground")
MACH = os.path.join(PG, "machines")
DOC = os.path.join(PG, "scenes", "rube-goldberg.json")
PARAMS = os.path.join(PG, "scenes", "rube-params.json")
_pending = {"t": None}

# (property, rube.py parameter, label, default, min, max, step) — step in Blender's hundredths
FIELDS = [
    ("mg_ball1_x", "ball1_x", "Held at left/right (m)", 0.0, -0.45, 3.0, 1),
    ("mg_ball1_y", "ball1_y", "Held at height (m)", 0.749, 0.05, 2.0, 1),
    ("mg_drop_height", "drop_height", "Height above ramp 1 (m)", 0.06, 0.0, 1.0, 1),
    ("mg_drop_x", "drop_x", "Position along ramp 1 (m)", 0.0, -0.4, 1.2, 1),
    ("mg_ramp1_top_x", "ramp1_top_x", "Top end left/right (m)", -0.12, -0.45, 2.0, 1),
    ("mg_ramp1_top_y", "ramp1_top_y", "Top end height (m)", 0.688, 0.1, 1.4, 1),
    ("mg_ramp1_angle", "ramp1_angle", "Angle (°)", -14.0, -45.0, 10.0, 50),
    ("mg_ramp1_length", "ramp1_length", "Length (m)", 0.62, 0.3, 1.0, 1),
    ("mg_ramp2_top_x", "ramp2_top_x", "Top end left/right (m)", 0.5256, -0.4, 2.2, 1),
    ("mg_ramp2_top_y", "ramp2_top_y", "Top end height (m)", 0.436, 0.05, 1.2, 1),
    ("mg_ramp2_dx", "ramp2_dx", "Gap from ramp 1's end: right (m)", 0.044, -0.1, 0.5, 1),
    ("mg_ramp2_dy", "ramp2_dy", "Gap from ramp 1's end: down (m)", -0.102, -0.5, 0.05, 1),
    ("mg_ramp2_angle", "ramp2_angle", "Angle (°)", -19.757, -60.0, -5.0, 50),
    ("mg_ramp2_length", "ramp2_length", "Length (m, if not to floor)", 1.25, 0.5, 2.5, 1),
    ("mg_domino_x", "domino_x", "First domino at (m)", 1.822, 1.0, 2.5, 1),
    ("mg_domino_height", "domino_height", "First domino height (m)", 0.098, 0.03, 0.15, 1),
    ("mg_domino_growth", "domino_growth", "Each domino bigger by (×)", 1.193, 1.0, 1.7, 1),
    ("mg_domino_spacing", "domino_spacing", "Spacing (domino heights)", 0.568, 0.3, 1.0, 1),
    ("mg_seesaw_x", "seesaw_x", "Pivot left/right (m)", 2.7137, 0.4, 3.1, 1),
    ("mg_seesaw_gap", "seesaw_gap", "Gap after last domino (m)", 0.078, -0.1, 0.4, 1),
    ("mg_seesaw_tilt", "seesaw_tilt", "Tilt (°)", 12.452, 3.0, 25.0, 50),
    ("mg_seesaw_length", "seesaw_length", "Length (m)", 0.598, 0.3, 0.9, 1),
    ("mg_seesaw_pivot", "seesaw_pivot", "Pivot off centre (m, − = ball arm longer)", -0.046, -0.25, 0.15, 1),
    ("mg_box_x", "box_x", "Box left/right (m)", 2.735, 1.0, 3.0, 1),
    ("mg_box_y", "box_y", "Box height (m)", 0.19, 0.05, 1.0, 1),
    ("mg_box_width", "box_width", "Box width (m)", 0.26, 0.1, 0.5, 1),
    ("mg_box_wall", "box_wall", "Box depth (m)", 0.13, 0.04, 0.3, 1),
]

# switches that tie an object to its neighbour: (rube.py parameter, label, sliders when on, sliders when off)
ATTACH = {
    "mg_ball1_attached": ("ball1_attached", "Held above ramp 1", ["mg_drop_height", "mg_drop_x"], ["mg_ball1_x", "mg_ball1_y"]),
    "mg_ramp2_attached": ("ramp2_attached", "Attached to ramp 1's end", ["mg_ramp2_dx", "mg_ramp2_dy"], ["mg_ramp2_top_x", "mg_ramp2_top_y"]),
    "mg_seesaw_attached": ("seesaw_attached", "Right after the last domino", ["mg_seesaw_gap"], ["mg_seesaw_x"]),
}


def params_from(scene):
    p = {key: round(float(getattr(scene, prop)), 4) for prop, key, *_ in FIELDS}
    p["ball_type"] = scene.mg_ball_type
    p["dominoes"] = int(scene.mg_dominoes)
    p["ramp2_to_floor"] = int(scene.mg_ramp2_to_floor)
    for prop, (key, *_r) in ATTACH.items():
        p[key] = int(getattr(scene, prop))
    return p


def _rube():
    import importlib
    if MACH not in sys.path:
        sys.path.insert(0, MACH)
    import rube
    return importlib.reload(rube)


def _attach_cb(prop):
    """Switching an object between attached and free leaves it exactly where it is."""
    def cb(self, context):
        s = context.scene
        if s.get("_mg_syncing"):
            return
        key, _label, on_props, off_props = ATTACH[prop]
        now = bool(getattr(s, prop))
        before = dict(params_from(s), **{key: int(not now)})     # resolved where it stood before the switch
        _doc, P = _rube().build(before)
        names = {pr: k for pr, k, *_x in FIELDS}
        live = s.mg_live
        s.mg_live = False
        for pr in (on_props if now else off_props):
            setattr(s, pr, float(P[names[pr]]))
        s.mg_live = live
        _changed(self, context)
    return cb


def _paths(scene):
    win = bpy.context.window_manager.windows[0]
    area = next((a for a in win.screen.areas if a.type == "VIEW_3D"), None)
    if area is None:
        return
    region = next(r for r in area.regions if r.type == "WINDOW")
    balls = [bpy.data.objects.get(n) for n in ("ball1", "ball2")]
    balls = [b for b in balls if b is not None]
    for b in balls:
        viz = b.animation_visualization.motion_path
        viz.type = "RANGE"; viz.frame_start, viz.frame_end, viz.frame_step = scene.frame_start, scene.frame_end, 1
        viz.show_frame_numbers = False; viz.show_keyframe_highlight = False
    for o in bpy.data.objects:
        o.select_set(o in balls)
    if not balls:
        return
    with bpy.context.temp_override(window=win, area=area, region=region, active_object=balls[0], object=balls[0], selected_objects=balls, selected_editable_objects=balls):
        try:
            bpy.ops.object.paths_clear(only_selected=True)
        except Exception:
            pass
        if scene.mg_show_paths:
            bpy.ops.object.paths_calculate(display_type="RANGE", range="SCENE")
    for b, col in zip(balls, ((0.85, 0.1, 0.1), (0.9, 0.7, 0.05))):
        if b.motion_path:
            b.motion_path.use_custom_color = True; b.motion_path.color = col; b.motion_path.line_thickness = 2


def rebuild(scene=None):
    scene = scene or bpy.context.scene
    t0 = time.time()
    json.dump(params_from(scene), open(PARAMS, "w"), indent=1)
    subprocess.run([sys.executable if os.path.basename(sys.executable).startswith("python") else "python3", os.path.join(MACH, "rube.py"), PARAMS, DOC], check=True, capture_output=True)
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.sim.rebuild()
    scene = bpy.context.scene
    scene.frame_set(scene.frame_start)
    _paths(scene)
    scene["mg_last"] = f"simulated in {time.time() - t0:.1f} s"
    for a in win.screen.areas:
        a.tag_redraw()


def _run():
    _pending["t"] = None
    try:
        rebuild()
    except Exception as e:
        print("machine rebuild failed:", e)
        bpy.context.scene["mg_last"] = f"failed: {e}"
    return None


def _changed(self, context):
    if not context.scene.mg_live:
        return
    if _pending["t"] is None:
        _pending["t"] = True
        bpy.app.timers.register(_run, first_interval=0.6)


class MG_OT_rebuild(bpy.types.Operator):
    bl_idname = "mg.rebuild"
    bl_label = "Simulate the machine"

    def execute(self, context):
        rebuild(context.scene)
        return {"FINISHED"}


class MG_OT_play(bpy.types.Operator):
    bl_idname = "mg.play"
    bl_label = "Play from start"

    def execute(self, context):
        context.scene.frame_set(context.scene.frame_start)
        if not context.screen.is_animation_playing:
            bpy.ops.screen.animation_play()
        return {"FINISHED"}


class MG_PT_panel(bpy.types.Panel):
    bl_label = "Rube Goldberg machine"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Machine"

    def draw(self, context):
        s = context.scene
        lay = self.layout
        lay.prop(s, "mg_ball_type")
        groups = [("Ball 1", 0, 4, "mg_ball1_attached"), ("Ramp 1", 4, 8, None), ("Ramp 2", 8, 14, "mg_ramp2_attached"),
                  ("Dominoes", 14, 18, None), ("Seesaw", 18, 23, "mg_seesaw_attached"), ("Box", 23, 27, None)]
        for title, a, b, switch in groups:
            box = lay.box(); box.label(text=title)
            hide = set()
            if switch:
                box.prop(s, switch)
                _k, _l, on_props, off_props = ATTACH[switch]
                hide = set(off_props if getattr(s, switch) else on_props)
            col = box.column(align=True)
            for prop, *_ in FIELDS[a:b]:
                if prop not in hide:
                    col.prop(s, prop)
            if title == "Dominoes":
                col.prop(s, "mg_dominoes")
            if title == "Ramp 2":
                col.prop(s, "mg_ramp2_to_floor")
        lay.prop(s, "mg_live")
        lay.prop(s, "mg_show_paths")
        lay.operator("mg.rebuild", icon="PHYSICS")
        lay.operator("mg.play", icon="PLAY")
        lay.label(text=str(s.get("mg_last", "")))
        lay.label(text="Bounciness, friction, side spring-back: Sim tab")


def register():
    for prop, key, label, default, lo, hi, step in FIELDS:
        setattr(bpy.types.Scene, prop, FloatProperty(name=label, default=default, min=lo, max=hi, step=step, precision=2, update=_changed))
    bpy.types.Scene.mg_ball_type = EnumProperty(name="Ball 1", items=[("rubber", "Solid rubber", ""), ("plastic", "Hollow plastic", ""), ("clay", "Modelling clay", "")], default="rubber", update=_changed)
    bpy.types.Scene.mg_dominoes = IntProperty(name="Number of dominoes", default=7, min=2, max=10, update=_changed)
    bpy.types.Scene.mg_ramp2_to_floor = BoolProperty(name="Ramp 2 runs down to the floor", default=True, update=_changed)
    for prop, (_key, label, _on, _off) in ATTACH.items():
        setattr(bpy.types.Scene, prop, BoolProperty(name=label, default=False, update=_attach_cb(prop)))
    bpy.types.Scene.mg_live = BoolProperty(name="Re-simulate when I change a value", default=True)
    bpy.types.Scene.mg_show_paths = BoolProperty(name="Show the balls' paths", default=True, update=_changed)
    for cls in (MG_OT_rebuild, MG_OT_play, MG_PT_panel):
        old = getattr(bpy.types, cls.__name__, None)     # a panel loaded earlier keeps its old drawing: replace it
        if old is not None:
            try:
                bpy.utils.unregister_class(old)
            except RuntimeError:
                pass
        bpy.utils.register_class(cls)


def sync(scene):
    """Sliders from the last params written (or the generator's defaults)."""
    p = {}
    if os.path.exists(PARAMS):
        p = json.load(open(PARAMS))
    live = scene.mg_live
    scene.mg_live = False
    scene["_mg_syncing"] = True
    # values saved before objects could stand on their own were attached; their free positions follow from them
    for _prop, (key, *_r) in ATTACH.items():
        p.setdefault(key, 1)
    _doc, P = _rube().build(dict(p))
    for _prop, key, *_r in FIELDS:
        p.setdefault(key, P[key])
    for prop, (key, *_r) in ATTACH.items():
        setattr(scene, prop, bool(p[key]))
    for prop, key, *_ in FIELDS:
        if key in p:
            setattr(scene, prop, p[key])
    if "ball_type" in p:
        scene.mg_ball_type = p["ball_type"]
    if "dominoes" in p:
        scene.mg_dominoes = int(p["dominoes"])
    if "ramp2_to_floor" in p:
        scene.mg_ramp2_to_floor = bool(p["ramp2_to_floor"])
    del scene["_mg_syncing"]
    scene.mg_live = live
