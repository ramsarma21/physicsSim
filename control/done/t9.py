
print("file:", bpy.data.filepath); print("doc:", scene().get("sim_document_path"))
setup_view()
win, area, region = view()
sh = area.spaces.active.shading; sh.type = "MATERIAL"; sh.use_scene_world = True
r3d = area.spaces.active.region_3d; r3d.view_camera_zoom = 0; r3d.view_camera_offset = (0.0, 0.0)
with bpy.context.temp_override(window=win, area=area, region=region):
    bpy.ops.view3d.view_center_camera()
ui = next(r for r in area.regions if r.type == "UI"); ui.active_panel_category = "Sim"
values()
for o in bpy.data.objects: print("part", o.name, o.get("sim_words", ""))
frame(1); play()

