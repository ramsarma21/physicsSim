
exec(open("/Users/ramsarma/Downloads/science-map-share/blender-playground/control/playground.py").read(), globals())
register()
import sys; sys.modules["pg_mod"] = type(sys)("pg_mod")
print("file:", bpy.data.filepath)
win, area, region = view()
sp = area.spaces.active; sp.show_region_ui = True
sp.shading.type = "MATERIAL"; sp.shading.use_scene_world = True
sp.region_3d.view_perspective = "CAMERA"; sp.region_3d.view_camera_zoom = 0; sp.region_3d.view_camera_offset = (0.0, 0.0)
with bpy.context.temp_override(window=win, area=area, region=region):
    bpy.ops.view3d.view_center_camera()
s = scene(); sync_from_scene(s)
print("sliders:", round(s.pg_ramp_angle,1), round(s.pg_ramp_height,2), round(s.pg_ramp_x,2), round(s.pg_drop_height,2), round(s.pg_drop_x,2))
resimulate(s)
ui = next(r for r in area.regions if r.type == "UI")
try:
    ui.active_panel_category = "Playground"
except Exception as e: print("tab:", e)
print("tab:", ui.active_panel_category, "path:", bool(bpy.data.objects["ball"].motion_path))

