
stop()
path = "/Users/ramsarma/Downloads/science-map-share/blender-playground/scenes/three-balls.blend"
def _open():
    bpy.ops.wm.open_mainfile(filepath=path)
    return None
bpy.app.timers.register(_open, first_interval=0.3)
print("opening", path)

