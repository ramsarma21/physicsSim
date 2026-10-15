
import bpy, os
m = {"__file__": os.path.join(CTRL, "machine.py")}
exec(open(os.path.join(CTRL, "machine.py")).read(), m)
m["register"]()
s = bpy.context.scene
m["sync"](s)
print("ball1_y", round(s.mg_ball1_y, 3))

