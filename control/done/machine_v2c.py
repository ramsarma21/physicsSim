
import bpy, os, time
m = {"__file__": os.path.join(CTRL, "machine.py")}
exec(open(os.path.join(CTRL, "machine.py")).read(), m)
s = bpy.context.scene
t0 = time.time()
m["rebuild"](s)
print("rebuilt in", round(time.time() - t0, 1), "s;", s.get("mg_last"), "| frames", s.frame_start, s.frame_end, "| to floor", s.mg_ramp2_to_floor, "box", round(s.mg_box_x, 3), round(s.mg_box_wall, 3))
print([o.name for o in bpy.data.objects][:40])

