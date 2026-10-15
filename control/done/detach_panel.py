
import bpy, os
m = {"__file__": os.path.join(CTRL, "machine.py")}
exec(open(os.path.join(CTRL, "machine.py")).read(), m)
m["register"]()
s = bpy.context.scene
m["sync"](s)
print("attached:", s.mg_ramp2_attached, "| top:", round(s.mg_ramp2_top_x, 4), round(s.mg_ramp2_top_y, 4), "| gap:", round(s.mg_ramp2_dx, 4), round(s.mg_ramp2_dy, 4), "| drop", round(s.mg_drop_height, 3))
print("params_from attached:", m["params_from"](s)["ramp2_attached"])
for a in bpy.context.window_manager.windows[0].screen.areas: a.tag_redraw()

