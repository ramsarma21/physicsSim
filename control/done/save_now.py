
import bpy
p = bpy.data.filepath
bpy.ops.wm.save_mainfile()
print("saved", p, "dirty:", bpy.data.is_dirty)

