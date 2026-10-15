
win, area, region = view()
ui = next(r for r in area.regions if r.type == "UI"); print("tab:", ui.active_panel_category, "sidebar:", area.spaces.active.show_region_ui)
values()
for o in bpy.data.objects:
    if "sim_kind" in o or o.type == "EMPTY": print("part", o.name, "|", o.get("sim_words", ""), "|", o.get("sim_material", ""))
frame(1); play()
for a in win.screen.areas: a.tag_redraw()

