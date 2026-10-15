
import bpy
setup_view()
win, area, region = view()
for r in area.regions:
    if r.type == "UI":
        r.active_panel_category = "Machine"
stop()
frame(70)
print(shot("machine-v2b"))

