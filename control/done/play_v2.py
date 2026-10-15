
import bpy
s = scene()
s.sync_mode = "FRAME_DROP"
win, area, region = view()
for r in area.regions:
    if r.type == "UI":
        r.active_panel_category = "Machine"
stop()
frame(s.frame_start)
play()
print("playing", s.frame_start, "-", s.frame_end, "at", s.render.fps, "fps")

