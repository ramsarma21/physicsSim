
s = scene(); s.pg_live = False; s.pg_ramp_angle = 10; s.pg_live = True
resimulate(s)
b = bpy.data.objects['ball']; r = 0.03
pts = []
for f in range(s.frame_start, s.frame_end + 1):
    s.frame_set(f); p = b.matrix_world.translation; pts.append((f, p.x, p.z - r))
s.frame_set(s.frame_start)
hit = next(i for i in range(1, len(pts)) if pts[i][2] > pts[i-1][2] + 1e-4)
fl = next(i for i in range(hit + 2, len(pts)) if pts[i][2] > pts[i-1][2] + 1e-4 and pts[i-1][2] < 0.02)
apex = max(pts[hit:fl], key=lambda q: q[2])
print(f'angle 10: bounce off ramp at x={pts[hit][1]:.2f}, peak {apex[2]:.2f} m, first floor landing at x={pts[fl-1][1]:.2f} m')
shot('ang_10')

