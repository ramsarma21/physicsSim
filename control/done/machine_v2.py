
import bpy, os, time
for name in ("MG_PT_panel", "MG_OT_rebuild", "MG_OT_play"):
    cls = getattr(bpy.types, name, None)
    if cls is not None:
        bpy.utils.unregister_class(cls)
m = {"__file__": os.path.join(CTRL, "machine.py")}
exec(open(os.path.join(CTRL, "machine.py")).read(), m)
m["register"]()
s = bpy.context.scene
m["sync"](s)
t0 = time.time()
m["rebuild"](s)
print("rebuilt in", round(time.time() - t0, 1), "s;", s.get("mg_last"), "| frames", s.frame_start, s.frame_end, "| ramp2_to_floor", s.mg_ramp2_to_floor, "box", round(s.mg_box_x, 3), round(s.mg_box_wall, 3))
print("objects:", len(bpy.data.objects), [o.name for o in bpy.data.objects if o.name.startswith(("ball", "box", "domino7", "seesaw"))])

