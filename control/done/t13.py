
win, area, region = view()
ui = next(r for r in area.regions if r.type == "UI")
try:
    ui.active_panel_category = "Sim"; print("set ok")
except Exception as e:
    print("err", e)
    with bpy.context.temp_override(window=win, area=area, region=ui):
        try:
            ui.active_panel_category = "Sim"; print("set ok in override")
        except Exception as e2: print("err2", e2)
ui.tag_redraw(); print("tab now:", ui.active_panel_category)

