# Playground panel: sliders for the ramp-bounce scene that re-run the physics as you drag.
# Lives in the playground folder only; the edullm repo is never touched.
import bpy
import math
from bpy.props import BoolProperty, FloatProperty

_pending = {"t": None}


def _ball_radius():
    ball = bpy.data.objects.get("ball")
    return float(ball.get("sim_radius_m", 0.03)) if ball else 0.03


def _apply(scene):
    """Moves the parts to the sliders' values at the first frame."""
    scene.frame_set(scene.frame_start)
    ramp = bpy.data.objects.get("ramp")
    if ramp is not None:
        ramp.rotation_euler.y = math.radians(scene.pg_ramp_angle)
        ramp.location.z = scene.pg_ramp_height
        ramp.location.x = scene.pg_ramp_x
    r = _ball_radius()
    for name in ("ball", "hand"):
        obj = bpy.data.objects.get(name)
        if obj is not None:
            if obj.animation_data:
                obj.animation_data_clear()
            obj.location.z = scene.pg_drop_height + r
            obj.location.x = scene.pg_drop_x


def _path(scene):
    """Shows the ball's flight as a dotted motion path."""
    ball = bpy.data.objects.get("ball")
    if ball is None:
        return
    win = bpy.context.window_manager.windows[0]
    area = next((a for a in win.screen.areas if a.type == "VIEW_3D"), None)
    if area is None:
        return
    region = next(r for r in area.regions if r.type == "WINDOW")
    viz = ball.animation_visualization.motion_path
    viz.type = "RANGE"
    viz.frame_start, viz.frame_end = scene.frame_start, scene.frame_end
    viz.frame_step = 1
    viz.show_frame_numbers = False
    viz.show_keyframe_highlight = False
    viz.show_keyframe_numbers = False
    for o in bpy.data.objects:
        o.select_set(o is ball)
    with bpy.context.temp_override(window=win, area=area, region=region, active_object=ball, object=ball, selected_objects=[ball], selected_editable_objects=[ball]):
        try:
            bpy.ops.object.paths_clear(only_selected=True)
        except Exception:
            pass
        if scene.pg_show_path:
            bpy.ops.object.paths_calculate(display_type="RANGE", range="SCENE")
    if ball.motion_path:
        ball.motion_path.color = (0.85, 0.1, 0.1)
        ball.motion_path.use_custom_color = True
        ball.motion_path.line_thickness = 2


def resimulate(scene=None):
    scene = scene or bpy.context.scene
    _apply(scene)
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.sim.simulate()
    scene.frame_set(scene.frame_start)
    _path(scene)
    for a in win.screen.areas:
        a.tag_redraw()


def _run():
    _pending["t"] = None
    try:
        resimulate()
    except Exception as e:
        print("playground resimulate failed:", e)
    return None


def _changed(self, context):
    if not context.scene.pg_live:
        return
    if _pending["t"] is None:
        _pending["t"] = True
        bpy.app.timers.register(_run, first_interval=0.35)


class PG_OT_resimulate(bpy.types.Operator):
    bl_idname = "pg.resimulate"
    bl_label = "Simulate with these settings"

    def execute(self, context):
        resimulate(context.scene)
        return {"FINISHED"}


class PG_OT_play(bpy.types.Operator):
    bl_idname = "pg.play"
    bl_label = "Play from start"

    def execute(self, context):
        context.scene.frame_set(context.scene.frame_start)
        if not context.screen.is_animation_playing:
            bpy.ops.screen.animation_play()
        return {"FINISHED"}


class PG_PT_panel(bpy.types.Panel):
    bl_label = "Ramp playground"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Playground"

    def draw(self, context):
        s = context.scene
        col = self.layout.column(align=True)
        col.label(text="Ramp")
        col.prop(s, "pg_ramp_angle")
        col.prop(s, "pg_ramp_height")
        col.prop(s, "pg_ramp_x")
        col.separator()
        col.label(text="Ball")
        col.prop(s, "pg_drop_height")
        col.prop(s, "pg_drop_x")
        col.separator()
        col.prop(s, "pg_live")
        col.prop(s, "pg_show_path")
        self.layout.operator("pg.resimulate", icon="PHYSICS")
        self.layout.operator("pg.play", icon="PLAY")
        self.layout.label(text="Bounciness and friction: Sim tab")


PROPS = {
    "pg_ramp_angle": FloatProperty(name="Angle (°)", description="Positive tilts the ramp down to the right", default=20.0, min=-75.0, max=75.0, step=100, precision=1, update=_changed),
    "pg_ramp_height": FloatProperty(name="Height (m)", default=0.45, min=0.05, max=1.6, step=1, precision=2, update=_changed),
    "pg_ramp_x": FloatProperty(name="Left/right (m)", default=0.05, min=-0.6, max=2.5, step=1, precision=2, update=_changed),
    "pg_drop_height": FloatProperty(name="Drop height (m)", default=1.0, min=0.1, max=2.0, step=1, precision=2, update=_changed),
    "pg_drop_x": FloatProperty(name="Drop left/right (m)", default=0.0, min=-0.6, max=2.5, step=1, precision=2, update=_changed),
    "pg_live": BoolProperty(name="Re-simulate as I drag", default=True),
    "pg_show_path": BoolProperty(name="Show the ball's path", default=True, update=_changed),
}
CLASSES = (PG_OT_resimulate, PG_OT_play, PG_PT_panel)


def register():
    for name, prop in PROPS.items():
        setattr(bpy.types.Scene, name, prop)
    for cls in CLASSES:
        try:
            bpy.utils.register_class(cls)
        except ValueError:
            pass


def sync_from_scene(scene):
    """Reads the sliders' starting values from the parts as built."""
    ramp = bpy.data.objects.get("ramp")
    live = scene.pg_live
    scene.pg_live = False
    if ramp is not None:
        scene.pg_ramp_angle = math.degrees(ramp.rotation_euler.y)
        scene.pg_ramp_height = ramp.location.z
        scene.pg_ramp_x = ramp.location.x
    scene.frame_set(scene.frame_start)
    ball = bpy.data.objects.get("ball")
    if ball is not None:
        scene.pg_drop_height = ball.matrix_world.translation.z - _ball_radius()
        scene.pg_drop_x = ball.matrix_world.translation.x
    scene.pg_live = live
