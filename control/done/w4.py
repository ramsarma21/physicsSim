
win, area, region = view(); ui = next(r for r in area.regions if r.type == "UI")
try: ui.active_panel_category = "Playground"
except Exception as e: print("err", e)
print("tab", ui.active_panel_category)

