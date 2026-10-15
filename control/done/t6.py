
win, area, region = view()
print("frame", scene().frame_current, "playing", win.screen.is_animation_playing)
sh = area.spaces.active.shading
print("shading", sh.type, "scene_world", sh.use_scene_world, "world", scene().world.name if scene().world else None)
for a in win.screen.areas: a.tag_redraw()

