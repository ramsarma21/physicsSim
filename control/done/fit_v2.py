
import bpy
win, area, region = view()
with bpy.context.temp_override(window=win, area=area, region=region):
    bpy.ops.view3d.view_center_camera()
frame(100)
print(shot("machine-v2c"))

