
m = {"__file__": "/Users/ramsarma/Downloads/science-map-share/blender-playground/control/machine.py"}; exec(open(m["__file__"]).read(), m); m["register"](); m["sync"](scene())
win, area, region = view()
sp = area.spaces.active; sp.show_region_ui = True; sp.shading.type = "MATERIAL"; sp.shading.use_scene_world = True
sp.region_3d.view_perspective = "CAMERA"; sp.region_3d.view_camera_zoom = 0; sp.region_3d.view_camera_offset = (0.0, 0.0)
with bpy.context.temp_override(window=win, area=area, region=region): bpy.ops.view3d.view_center_camera()
m["_paths"](scene())
print("file", bpy.data.filepath, "frames", scene().frame_start, scene().frame_end)

