
import bpy
print("frame", scene().frame_current, "playing", bpy.context.screen.is_animation_playing if bpy.context.screen else None)
win, area, region = view()
print("win screen playing", win.screen.is_animation_playing)

