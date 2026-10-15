
stop()
path = "/Users/ramsarma/Downloads/science-map-share/blender-playground/scenes/ramp-bounce.blend"
bpy.app.timers.register(lambda: (bpy.ops.wm.open_mainfile(filepath=path), None)[1], first_interval=0.3)
print("opening", path)

