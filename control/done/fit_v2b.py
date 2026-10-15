
import bpy
win, area, region = view()
rv = area.spaces.active.region_3d
print("zoom before", rv.view_camera_zoom, tuple(rv.view_camera_offset))
rv.view_camera_offset = (0.0, 0.0)
rv.view_camera_zoom = 2.0
frame(100)
area.tag_redraw()

