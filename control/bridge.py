# Playground bridge: lets Claude drive this Blender window.
# Every .py file dropped into control/inbox/ runs inside Blender (helpers below are in scope);
# its printed output goes to control/done/<name>.log. Nothing here touches the edullm repo.
import bpy
import glob
import io
import json
import os
import shutil
import sys
import traceback

CTRL = os.path.dirname(os.path.abspath(__file__))
INBOX, DONE = os.path.join(CTRL, "inbox"), os.path.join(CTRL, "done")
SHOTS = os.path.join(os.path.dirname(CTRL), "shots")


def view():
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    return win, area, region


def scene():
    return bpy.context.window_manager.windows[0].scene


def setup_view():
    """Camera view, the Sim tab open in the sidebar, at the first frame."""
    win, area, region = view()
    space = area.spaces.active
    space.show_region_ui = True
    for r in area.regions:
        if r.type == "UI":
            try:
                r.active_panel_category = "Sim"
            except Exception:
                pass
    with bpy.context.temp_override(window=win, area=area, region=region):
        space.region_3d.view_perspective = "CAMERA"
        try:
            bpy.ops.view3d.view_center_camera()
        except Exception:
            pass
    scene().frame_set(scene().frame_start)


def fields():
    return json.loads(scene().get("sim_fields", "[]"))


def values():
    """Prints every editable value."""
    for f in fields():
        key = f"{f['section']}: {f['label']}"
        print(f"{key} = {scene()[key]}")


def set_value(part_of_name, value):
    """Sets the editable value whose name contains part_of_name (e.g. 'restitution')."""
    hits = [f"{f['section']}: {f['label']}" for f in fields() if part_of_name.lower() in f"{f['section']}: {f['label']}".lower()]
    if len(hits) != 1:
        raise ValueError(f"'{part_of_name}' matches {hits}")
    scene()[hits[0]] = float(value)
    print(f"{hits[0]} = {value}")


def drop_height(meters):
    """Puts the ball (and the hand holding it) so the ball's bottom starts this high above the floor."""
    s = scene()
    s.frame_set(s.frame_start)
    ball = bpy.data.objects["ball"]
    r = float(ball.get("sim_radius_m", 0.03))
    for name in ("ball", "hand"):
        obj = bpy.data.objects.get(name)
        if obj is not None:
            if obj.animation_data:
                obj.animation_data_clear()
            obj.location.z = meters + r
    print(f"drop height {meters} m (ball centre at {meters + r:.3f} m)")


def simulate():
    """Runs the engine on the shot as it stands (the Sim tab's Simulate button)."""
    s = scene()
    s.frame_set(s.frame_start)
    win, area, region = view()
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.sim.simulate()
    s.frame_set(s.frame_start)
    print(f"simulated: frames {s.frame_start}-{s.frame_end}")


def play():
    win, area, region = view()
    with bpy.context.temp_override(window=win, area=area, region=region):
        if not bpy.context.screen.is_animation_playing:
            bpy.ops.screen.animation_play()
    print("playing")


def stop():
    win, area, region = view()
    with bpy.context.temp_override(window=win, area=area, region=region):
        if bpy.context.screen.is_animation_playing:
            bpy.ops.screen.animation_cancel(restore_frame=True)
    print("stopped")


def frame(n):
    scene().frame_set(int(n))


def shot(name):
    """Screenshot of this Blender window into shots/<name>.png."""
    os.makedirs(SHOTS, exist_ok=True)
    path = os.path.join(SHOTS, f"{name}.png")
    win, area, region = view()
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.screen.screenshot(filepath=path)
    print(path)


def ball_track():
    """The ball's height above the floor at each tenth of a second (from the simulated keys)."""
    s = scene()
    ball = bpy.data.objects["ball"]
    r = float(ball.get("sim_radius_m", 0.03))
    out = []
    for f in range(s.frame_start, s.frame_end + 1, max(1, s.render.fps // 10)):
        s.frame_set(f)
        out.append((round((f - s.frame_start) / s.render.fps, 2), round(ball.matrix_world.translation.z - r, 3)))
    s.frame_set(s.frame_start)
    print(out)


G = {k: v for k, v in globals().items() if not k.startswith("_")}


def poll():
    for path in sorted(glob.glob(os.path.join(INBOX, "*.py"))):
        name = os.path.basename(path)
        buf, old = io.StringIO(), sys.stdout
        sys.stdout = buf
        try:
            exec(open(path).read(), dict(G))
        except Exception:
            traceback.print_exc(file=buf)
        finally:
            sys.stdout = old
        with open(os.path.join(DONE, name + ".log"), "w") as f:
            f.write(buf.getvalue())
        shutil.move(path, os.path.join(DONE, name))
    return 0.4


def first():
    try:
        setup_view()
    except Exception:
        traceback.print_exc()
    return None


os.makedirs(INBOX, exist_ok=True)
os.makedirs(DONE, exist_ok=True)
bpy.app.timers.register(first, first_interval=1.5)
bpy.app.timers.register(poll, first_interval=2.0, persistent=True)
print("playground bridge ready:", INBOX)


# Playground panel: loaded on start and after every file open, so the sliders are always there.
def _load_playground(*_):
    try:
        g = {}
        exec(open(os.path.join(CTRL, "playground.py")).read(), g)
        g["register"]()
        s = bpy.context.scene
        if bpy.data.objects.get("ramp") is not None:
            g["sync_from_scene"](s)
        if bpy.data.objects.get("seesaw") is not None:
            m = {"__file__": os.path.join(CTRL, "machine.py")}
            exec(open(os.path.join(CTRL, "machine.py")).read(), m)
            m["register"]()
            m["sync"](s)
    except Exception:
        traceback.print_exc()
    return None


bpy.app.timers.register(_load_playground, first_interval=2.5)
bpy.app.handlers.load_post.append(lambda *_: bpy.app.timers.register(_load_playground, first_interval=1.0))
