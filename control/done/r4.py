
exec(open("/Users/ramsarma/Downloads/science-map-share/blender-playground/control/playground.py").read(), globals())
register()
s = scene(); resimulate(s)
win, area, region = view()
ui = next(r for r in area.regions if r.type == "UI")
try:
    ui.active_panel_category = "Playground"; print("tab set")
except Exception as e:
    print("tab err:", e)
print("tab:", ui.active_panel_category)

