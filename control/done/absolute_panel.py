
import bpy, os
m = {"__file__": os.path.join(CTRL, "machine.py")}
exec(open(os.path.join(CTRL, "machine.py")).read(), m)
m["register"]()
s = bpy.context.scene
m["sync"](s)
print({k: getattr(s, k) for k in ("mg_ball1_attached", "mg_ramp2_attached", "mg_seesaw_attached")})
print("ball1", round(s.mg_ball1_x, 3), round(s.mg_ball1_y, 3), "drop", round(s.mg_drop_height, 3), "seesaw_x", round(s.mg_seesaw_x, 4), "gap", round(s.mg_seesaw_gap, 4))
p = m["params_from"](s); import json
d, P = m["_rube"]().build(p)
print("resolved ball1", round(P["ball1_y"], 3), "seesaw_x", round(P["seesaw_x"], 4))
for a in bpy.context.window_manager.windows[0].screen.areas: a.tag_redraw()

