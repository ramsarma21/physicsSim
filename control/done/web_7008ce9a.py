import bpy, os
m = {'__file__': os.path.join(CTRL, 'machine.py')}
exec(open(os.path.join(CTRL, 'machine.py')).read(), m)
s = bpy.context.scene
if hasattr(s, 'mg_live'):
    m['sync'](s)
    m['rebuild'](s)
    print('rebuilt from the web app')
