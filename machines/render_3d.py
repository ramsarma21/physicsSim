# Renders the Rube Goldberg machine as realistic 3D footage from the engine's own motion (playground copy only).
# Nothing is simulated in Blender: every moving part is keyed from a dense engine track at its true time.
# blender -b --factory-startup --python render_3d.py -- <scene.json> <track240.json> <out_dir> <EEVEE|CYCLES> <frames: all | 1,40,80> [wide|follow]
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
scene_path, track_path, out_dir, engine, frame_list = args[:5]
shot = args[5] if len(args) > 5 else "wide"
os.makedirs(out_dir, exist_ok=True)
FPS = 30
SKIN = 0.001       # Box2D keeps bodies ~1 mm apart; render meshes are grown by this to hide the gap

doc = json.load(open(scene_path))
track = json.load(open(track_path))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = "METRIC"
sc.render.fps = FPS
sc.frame_start = 1
sc.frame_end = 1 + int(round(doc["seconds"] * FPS))


def lin(hex_color):
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def principled(name, base, rough, ior=1.5, coat=0.0, coat_rough=0.05):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["IOR"].default_value = ior
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = coat_rough
    return m, nt, b


def wood(name, dark, light, grain_scale=(3.0, 90.0, 90.0)):
    """Varnished wood: object-space grain (it moves with the part), a clear coat for the varnish."""
    m, nt, b = principled(name, light, 0.5, coat=1.0, coat_rough=0.12)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = grain_scale
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.0
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Distortion"].default_value = 0.6
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (*light, 1)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m


def bumped(name, base, rough, ior, bump=0.08, coat=0.0):
    m, nt, b = principled(name, base, rough, ior=ior, coat=coat, coat_rough=0.05)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 400.0
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = 0.0002
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m


def box(name, w, d, h, bevel):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.name = name
    o.scale = (w + 2 * SKIN, d, h + 2 * SKIN)
    bpy.ops.object.transform_apply(scale=True)
    mod = o.modifiers.new("bevel", "BEVEL")
    mod.width = bevel
    mod.segments = 3
    mod.limit_method = "ANGLE"
    bpy.ops.object.shade_smooth_by_angle()
    return o


def sphere(name, r):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r + SKIN * 0.5, segments=96, ring_count=48)
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.shade_smooth()
    return o


def cylinder(name, r, depth, loc, rot=(0, 0, 0), mat=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=32)
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.shade_smooth()
    if mat:
        o.data.materials.append(mat)
    return o


M = {
    "wood": wood("ramp wood", (0.30, 0.17, 0.08), (0.52, 0.32, 0.16)),
    "table": wood("table wood", (0.16, 0.075, 0.03), (0.30, 0.16, 0.075), grain_scale=(1.0, 30.0, 30.0)),
    "domino": wood("domino wood", (0.42, 0.26, 0.12), (0.62, 0.42, 0.22), grain_scale=(40.0, 4.0, 40.0)),
    "solid rubber": bumped("rubber", lin("#d22"), 0.42, 1.52),
    "hollow plastic": bumped("plastic", lin("#f2c230"), 0.22, 1.49, bump=0.02, coat=0.4),
    "modeling clay": bumped("clay", lin("#5a9b4a"), 0.65, 1.5, bump=0.3),
    "cord": principled("cord", (0.05, 0.05, 0.05), 0.7)[0],
}
acr, acr_nt, acr_b = principled("acrylic", (0.95, 0.97, 0.98), 0.02, ior=1.49)
acr_b.inputs["Transmission Weight"].default_value = 1.0
acr.use_raytrace_refraction = True
acr.surface_render_method = "BLENDED"
acr_b.inputs["Alpha"].default_value = 0.18
M["acrylic"] = acr
# Render depth (front-to-back) per part: the side-view physics does not depend on it, so parts get real-life widths.
VIS_DEPTH = {"ramp1": 0.12, "ramp2": 0.12, "fulcrum": 0.06, "box-floor": 0.12, "box-left": 0.12, "box-right": 0.12, "wall-left": 0.4, "wall-right": 0.4}
for k in ("solid rubber", "hollow plastic", "modeling clay"):
    M[k].diffuse_color = (*M[k].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value[:3], 1)

objs = {}
for s in doc["solids"]:
    if s["id"].startswith("wall") and s["kind"] == "static":
        continue      # the scene's safety walls: nothing reaches them, and a real tabletop machine has none
    body = s["body"]
    if body["kind"] == "ball":
        o = sphere(s["id"], body["radius"])
        o.data.materials.append(M[s["material"]])
    else:
        d = VIS_DEPTH.get(s["id"], body["depth"])
        if s["id"] == "floor":
            d = 1.6
        o = box(s["id"], body["width"], d, body["height"], bevel=min(0.0015, body["height"] / 4, body["width"] / 4))
        mat = M["table"] if s["id"] == "floor" else M["acrylic"] if s["id"].startswith("wall") else M["domino"] if s["id"].startswith("domino") else M["wood"]
        o.data.materials.append(mat)
    o.location = (s["at"]["x"], 0, s["at"]["y"])
    o.rotation_euler = (0, -s.get("angle", 0.0), 0)
    o.cycles.motion_steps = 3
    objs[s["id"]] = o

# Parented parts (the seesaw's lip) are keyed in the world from the track like every other dynamic part.
# Render-only scenery, outside the motion slice (moving parts stay within y = +-0.06 m):
# legs under each ramp, cords for the box, a pull-pin start in place of the drawn hand, a wall behind.
def legs(id_):
    s = next(p for p in doc["solids"] if p["id"] == id_)
    x, y, a = s["at"]["x"], s["at"]["y"], s.get("angle", 0.0)
    hw = s["body"]["width"] / 2 - 0.04
    for sx in (-1, 1):
        ex = x + sx * hw * math.cos(a)
        ey = y + sx * hw * math.sin(a) - s["body"]["height"] / 2
        if ey < 0.03:
            continue
        for py in (-0.045, 0.045):
            cylinder(f"{id_} leg", 0.008, ey, (ex, py, ey / 2), mat=M["wood"])


legs("ramp1")
legs("ramp2")
for a in doc["animated"]:
    if a["id"].startswith("box-cord"):
        x, y = a["at"]["x"], a["at"]["y"]
        for py in (-0.05, 0.05):
            cylinder(a["id"], 0.0012, 3.0, (x, py, y + 1.5), mat=M["cord"])

ball1 = next(s for s in doc["solids"] if s["id"] == "ball1")
r1 = ball1["body"]["radius"]
bx, by = ball1["at"]["x"], ball1["at"]["y"]
pin = cylinder("pull pin", 0.004, 0.16, (bx, 0.02, by - r1 - 0.004), rot=(math.pi / 2, 0, 0), mat=M["wood"])
post_h = by - r1 - 0.004 + 0.03
cylinder("pin post", 0.012, post_h, (bx, 0.09, post_h / 2), mat=M["wood"])
t_rel = doc["release"]["at"]
for t, yy in ((0.0, 0.02), (t_rel - 0.01, 0.02), (t_rel + 0.06, 0.13)):
    pin.location.y = yy
    pin.keyframe_insert("location", frame=1 + t * FPS)

bpy.ops.mesh.primitive_plane_add(size=1)
wall = bpy.context.active_object
wall.name = "room wall"
wall.scale = (9, 4, 1)
wall.rotation_euler = (math.pi / 2, 0, 0)
wall.location = (1.3, 0.8, 1.9)
wall.data.materials.append(principled("paint", (0.62, 0.60, 0.56), 0.85)[0])

# Keys: every engine sample at its true time, linear between samples (so motion blur samples real motion).
dyn = [s["id"] for s in doc["solids"] if s["kind"] == "dynamic"]
for f in track["frames"]:
    frame = 1 + f["t"] * FPS
    for id_ in dyn:
        p = f["placements"][id_]
        o = objs[id_]
        o.location = (p["x"], 0, p["y"])
        o.rotation_euler = (0, -p["angle"], 0)
        o.keyframe_insert("location", frame=frame)
        o.keyframe_insert("rotation_euler", frame=frame)
for o in [objs[i] for i in dyn] + [pin]:
    act = o.animation_data.action
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for cb in strip.channelbags:
                for fc in cb.fcurves:
                    for kp in fc.keyframe_points:
                        kp.interpolation = "LINEAR"

# Light: the bundled interior HDRI plus a window-sized soft key light.
world = bpy.data.worlds.new("world")
sc.world = world
wn = world.node_tree.nodes
env = wn.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(os.path.join(bpy.utils.system_resource("DATAFILES"), "studiolights", "world", "interior.exr"))
world.node_tree.links.new(env.outputs["Color"], wn["Background"].inputs["Color"])
wn["Background"].inputs["Strength"].default_value = 0.5
ld = bpy.data.lights.new("window", "AREA")
ld.shape = "RECTANGLE"
ld.size, ld.size_y = 2.0, 1.4
ld.energy = 260
ld.color = (1.0, 0.97, 0.92)
lo = bpy.data.objects.new("window", ld)
sc.collection.objects.link(lo)
lo.location = (-0.6, -2.2, 2.4)
lo.rotation_euler = (math.radians(50), 0, math.radians(-25))

# Camera: a phone on a tripod (26 mm full-frame equivalent; f/1.6 on a 1/1.56" sensor ~ f/6.4 full frame).
cd = bpy.data.cameras.new("phone")
cd.sensor_width = 36
cd.sensor_fit = "HORIZONTAL"
cd.lens = 26
cd.clip_start = 0.01
cd.dof.use_dof = True
cd.dof.aperture_fstop = 6.4
cam = bpy.data.objects.new("phone", cd)
sc.collection.objects.link(cam)
sc.camera = cam


def aim(loc, target):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def bounds():
    """Everything the camera must see: the parts (dynamic ones over the whole run) and both balls' paths."""
    xs, ys = [], []
    for s_ in doc["solids"]:
        if s_["id"].startswith("wall") and s_["kind"] == "static":
            continue
        b_ = s_["body"]
        ext = b_["radius"] if b_["kind"] == "ball" else 0.5 * math.hypot(b_["width"], b_["height"])
        pts = [f["placements"][s_["id"]] for f in track["frames"][::4]] if s_["kind"] == "dynamic" else [s_["at"]]
        for q in pts:
            xs += [q["x"] - ext, q["x"] + ext]
            ys += [q["y"] - ext, q["y"] + ext]
    floor = next(s_ for s_ in doc["solids"] if s_["id"] == "floor")
    xs += [floor["at"]["x"] - floor["body"]["width"] / 2 + 0.25, floor["at"]["x"] + floor["body"]["width"] / 2 - 0.25]
    return min(xs), max(xs), max(-0.05, min(ys)), max(ys)


if shot == "follow":
    # A handheld-style follow: ball 1, then the domino wave front, then ball 2 once the seesaw turns.
    cd.lens = 35
    f0 = track["frames"][0]["placements"]
    doms = sorted([s_ for s_ in doc["solids"] if s_["id"].startswith("domino")], key=lambda s_: s_["at"]["x"])
    def focus_at(t):
        f = min(track["frames"], key=lambda q: abs(q["t"] - t))["placements"]
        b1, b2 = f["ball1"], f["ball2"]
        if abs(f["seesaw"]["angle"] - f0["seesaw"]["angle"]) > 0.02:
            return (b2["x"] - 0.1, max(0.22, b2["y"]))
        tilted = [d for d in doms if abs(f[d["id"]]["angle"] - f0[d["id"]]["angle"]) > 0.05]
        if tilted:
            return (tilted[-1]["at"]["x"] + 0.1, 0.15)
        return (b1["x"], max(0.12, b1["y"]))
    prev = None
    for k in range(sc.frame_start, sc.frame_end + 1):
        t = (k - 1) / FPS
        fx, fz = focus_at(t)
        if prev is not None:
            fx, fz = prev[0] + 0.12 * (fx - prev[0]), prev[1] + 0.12 * (fz - prev[1])   # smoothed like a hand-held pan
        prev = (fx, fz)
        aim((fx, -1.15, fz + 0.18), (fx, 0.0, fz))
        cam.keyframe_insert("location", frame=k)
        cam.keyframe_insert("rotation_euler", frame=k)
    cd.dof.focus_distance = 1.16
else:
    # A phone on a tripod, far enough back that the whole machine and both balls' paths fit with a margin.
    x0, x1, y0, y1 = bounds()
    half_h = math.atan(18 / cd.lens)                      # horizontal half-angle (36 mm sensor)
    half_v = math.atan(math.tan(half_h) * 9 / 16)
    cx, cz = (x0 + x1) / 2, (y0 + y1) / 2
    dist = max((x1 - x0) / 2 * 1.06 / math.tan(half_h), (y1 - y0) / 2 * 1.12 / math.tan(half_v), 1.2)
    aim((cx, -dist, cz + 0.12 * dist), (cx, 0.0, cz))
    cd.dof.focus_distance = math.hypot(dist, 0.12 * dist)

r = sc.render
r.resolution_x, r.resolution_y, r.resolution_percentage = 1920, 1080, 100
r.use_motion_blur = True
r.motion_blur_shutter = 0.5          # 180 degrees: 1/60 s at 30 fps
r.motion_blur_position = "CENTER"
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"
sc.view_settings.exposure = -0.2
r.image_settings.file_format = "PNG"

if engine == "CYCLES":
    r.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = dev.type == "METAL"
    sc.cycles.device = "GPU"
    sc.cycles.samples = 192
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
else:
    r.engine = "BLENDER_EEVEE"
    e = sc.eevee
    e.taa_render_samples = 64
    e.use_raytracing = True
    e.ray_tracing_method = "SCREEN"
    e.use_shadows = True
    e.shadow_ray_count = 2
    e.shadow_step_count = 8
    e.motion_blur_steps = 8
    e.use_fast_gi = True

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"machine-{shot}.blend"))
frames = range(sc.frame_start, sc.frame_end + 1) if frame_list == "all" else [int(x) for x in frame_list.split(",")]
t0 = time.time()
for k in frames:
    sc.frame_set(k)
    r.filepath = os.path.join(out_dir, f"{shot}-{k:04d}.png")
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED {k} ({time.time() - t0:.0f} s)", flush=True)
