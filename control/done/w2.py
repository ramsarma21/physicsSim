
exec(open("/Users/ramsarma/Downloads/science-map-share/blender-playground/control/playground.py").read(), globals())
register()
win, area, region = view()
sp = area.spaces.active; sp.show_region_ui = True; sp.shading.type = "MATERIAL"; sp.shading.use_scene_world = True
sp.region_3d.view_perspective = "CAMERA"; sp.region_3d.view_camera_zoom = 0; sp.region_3d.view_camera_offset = (0.0, 0.0)
with bpy.context.temp_override(window=win, area=area, region=region): bpy.ops.view3d.view_center_camera()
s = scene(); sync_from_scene(s)
s.pg_live = False; s.pg_ramp_angle = -25; s.pg_live = True
resimulate(s)
ui = next(r for r in area.regions if r.type == "UI"); ui.active_panel_category = "Playground"
print("tab", ui.active_panel_category, "angle", s.pg_ramp_angle)

