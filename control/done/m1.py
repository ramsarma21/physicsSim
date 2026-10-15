
stop()
bpy.app.timers.register(lambda: (bpy.ops.wm.open_mainfile(filepath="/Users/ramsarma/Downloads/science-map-share/blender-playground/scenes/rube-goldberg.blend"), None)[1], first_interval=0.3)
print("opening machine")

