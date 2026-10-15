
import bpy
win, area, region = view()
for r in area.regions:
    if r.type == "UI":
        try:
            r.active_panel_category = "Machine"
        except Exception as e:
            print("tab:", e)
frame(80)
print(shot("machine-v2"))

