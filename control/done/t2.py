
win, area, region = view()
space = area.spaces.active
space.shading.type = "MATERIAL"
r3d = space.region_3d
r3d.view_perspective = "CAMERA"
r3d.view_camera_zoom = 0
r3d.view_camera_offset = (0.0, 0.0)
with bpy.context.temp_override(window=win, area=area, region=region):
    bpy.ops.view3d.view_center_camera()
ui = next(r for r in area.regions if r.type == "UI")
print("tab before:", ui.active_panel_category)
try:
    ui.active_panel_category = "Sim"
except Exception as e:
    print("tab err", e)
ui.tag_redraw(); area.tag_redraw()
print("tab after:", ui.active_panel_category)
frame(1)

