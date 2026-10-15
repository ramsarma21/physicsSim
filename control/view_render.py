# Opens a rendered machine scene (renders/<shot>/machine-<shot>.blend) for watching: the camera's view
# filling the window, lit as the render is (EEVEE), playing in real time on a loop. Playground copy only.
# Blender <file.blend> --python control/view_render.py
import bpy


def _setup():
    win = bpy.context.window_manager.windows[0]
    areas = [a for a in win.screen.areas if a.type == "VIEW_3D"]
    if not areas:
        return 0.5
    area = max(areas, key=lambda a: a.width * a.height)
    region = next(r for r in area.regions if r.type == "WINDOW")
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.screen.screen_full_area(use_hide_panels=True)
    # the full-area screen is a new screen: find its viewport again
    win = bpy.context.window_manager.windows[0]
    area = max((a for a in win.screen.areas if a.type == "VIEW_3D"), key=lambda a: a.width * a.height)
    region = next(r for r in area.regions if r.type == "WINDOW")
    space = area.spaces.active
    space.region_3d.view_perspective = "CAMERA"
    space.shading.type = "RENDERED"
    space.overlay.show_overlays = False
    space.show_gizmo = False
    space.show_region_header = False
    space.show_region_toolbar = False
    space.show_region_ui = False
    sc = bpy.context.scene
    sc.sync_mode = "FRAME_DROP"
    sc.frame_set(sc.frame_start)
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.view3d.view_center_camera()
        bpy.ops.screen.animation_play()
    print("view_render: playing", sc.frame_start, "-", sc.frame_end, flush=True)
    return None


bpy.app.timers.register(_setup, first_interval=2.0)
