"""The sandbox's hand: a child's left hand and a short sleeved forearm, built procedurally in Blender and exported to web/models/hand.glb.

Run (Blender 5.1, headless; the output is the same file every time):
    "/Applications/Blender.app/Contents/MacOS/Blender" -b --factory-startup -P tools/hands/build_hand.py -- [--out web/models/hand.glb]
        [--proof DIR]      also render the contact sheet (rest pose and test poses, turntable views) into DIR
        [--preview DIR]    only build the skin and render quick views of it into DIR (for shaping)
        [--voxel M]        the sampling grid of the shape (default 0.0006 m)

How it is made (web/CONTRACT.md "Hands"):
  1. the shape is a signed distance field written here (metres, the hand frame below): tapered phalanges with oval sections, soft pads under
     each phalanx and a fuller fingertip pulp, slight knuckle bumps, a palm that is an arched slab with a thenar pad at the thumb, a hypothenar
     pad on the little finger's side and a ridge of pads under the finger roots, webs between the fingers, a thumb set at its real angle, a
     wrist and a short forearm that tapers to the wrist;
  2. it is sampled on a grid and turned into a surface (surface nets), remeshed into even quads (QuadriFlow, fixed seed), and every vertex is put
     back on the exact surface and evened out along it; its normals are the field's own;
  3. the nails are their own small meshes on each fingertip, the sleeve a soft knit cuff and sleeve of its own;
  4. the armature follows the rig contract below; the skin is weighted with Blender's automatic (bone heat) weights, then checked: a vertex on
     one finger keeps no weight of another finger's bones, the nails and the sleeve are held rigidly;
  5. glTF binary (+Y up), materials `skin`, `nail`, `sleeve`; the joints' rest frames are then written as the contract wants them.

The rig contract: one LEFT hand, metres, palm facing -Y (down), fingers along +X, thumb toward +Z, wrist joint at the origin. Bones: forearm
(the root: at the wrist, running along -X to the elbow's side) > wrist > palm > thumb_1 thumb_2 thumb_3, index_1..3, middle_1..3, ring_1..3,
pinky_1..3 (each chain from the palm). Every joint's local frame: X along its bone (forearm, wrist and palm: the hand's own axes), Y the back
of the hand (for the thumb its nail's side), Z = X x Y (the thumb's side for the fingers). A finger bone flexes by a NEGATIVE rotation about its
local Z (toward the palm) and spreads about its local Y (negative: toward the thumb). Rest pose: a relaxed flat hand, fingers slightly apart.
The right hand is the left mirrored (scale z = -1) in three.js. Size: a 9-year-old's hand, 14.5 cm from the wrist crease to the middle
fingertip, 6.5 cm across the palm.
"""
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

T0 = time.time()


def log(*a):
    print(f"[hand {time.time() - T0:6.1f}s]", *a, flush=True)


# ------------------------------------------------------------------------------------------------ arguments
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.abspath(arg("--out", os.path.join(ROOT, "web", "models", "hand.glb")))
PROOF = arg("--proof")
PREVIEW = arg("--preview")
VOXEL = float(arg("--voxel", "0.0006"))

# ------------------------------------------------------------------------------------------------ the hand's measures (m, the hand frame H)
# H: x toward the fingers, y the back of the hand (the palm faces -y), z the thumb's side; the wrist joint at the origin. Blender's frame is
# B = (x, -z, y) (z up: the hand lies palm down), which the glTF exporter (+Y up) turns back into H.
D2R = math.pi / 180


def unit(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


def dir_xz(phi_deg, tilt_deg=0.0):
    """A direction phi degrees from +x toward +z (the thumb's side), tilted tilt degrees toward +y (negative: toward the palm)."""
    p, t = phi_deg * D2R, tilt_deg * D2R
    return np.array([math.cos(t) * math.cos(p), math.sin(t), math.cos(t) * math.sin(p)])


# The four fingers: knuckle (MCP joint) at (x, 0, z), spread (degrees toward the thumb), the three segments' lengths (the last to the fingertip's
# end), half-widths at the knuckle, the middle joint (PIP), the end joint (DIP) and the tip; height / width of the section. The fingertips are
# staggered as a child's are: the middle finger longest (14.4 cm from the wrist), then the ring (13.7), the index (13.3) and the little finger
# (12.0), each finger a little apart from the next all the way to its tip.
FINGERS = {
    "index": dict(mcp=(0.0665, 0.0, 0.0211), spread=3.5, L=(0.0322, 0.0196, 0.0146), w=(0.0081, 0.0075, 0.0069, 0.0062), ky=0.87),
    "middle": dict(mcp=(0.0695, 0.0, 0.0050), spread=0.0, L=(0.0365, 0.0230, 0.0153), w=(0.0084, 0.0078, 0.0071, 0.0064), ky=0.87),
    "ring": dict(mcp=(0.0665, 0.0, -0.0118), spread=-3.0, L=(0.0342, 0.0216, 0.0146), w=(0.0079, 0.0073, 0.0067, 0.0060), ky=0.87),
    "pinky": dict(mcp=(0.0605, 0.0, -0.0264), spread=-7.0, L=(0.0285, 0.0172, 0.0138), w=(0.0070, 0.0064, 0.0059, 0.0053), ky=0.87),
}
FINGER_NAMES = ["index", "middle", "ring", "pinky"]
# The thumb: its base joint (CMC, at the trapezium: near the wrist, on the palm's side), then each bone's direction (degrees from +x toward +z,
# tilt toward the palm) and length; half-widths at the CMC, MCP, IP and tip; height / width; its nail's side (degrees from the back of the hand
# toward the thumb's side: the thumb is turned so its nail faces mostly sideways). A child's thumb: its two phalanges 4.55 cm, its tip at rest
# level with the middle of the index's first bone, its metacarpal a little in front of the palm (the ball of the thumb under it), so it stands
# across from the fingers rather than lying in the palm's plane.
THUMB = dict(cmc=(0.0105, -0.0075, 0.0160), dirs=((40.0, -5.0), (24.0, -1.0), (16.0, 1.0)), L=(0.0320, 0.0245, 0.0210),
             w=(0.0091, 0.0084, 0.0079, 0.0073), ky=0.82, nail_deg=60.0)


def finger_points(name):
    F = FINGERS[name]
    d = dir_xz(F["spread"])
    p0 = np.array(F["mcp"], dtype=float)
    pts = [p0]
    for L in F["L"]:
        pts.append(pts[-1] + d * L)
    return pts, d  # MCP, PIP, DIP, tip end


def thumb_points():
    pts = [np.array(THUMB["cmc"], dtype=float)]
    dirs = []
    for (phi, tilt), L in zip(THUMB["dirs"], THUMB["L"]):
        d = dir_xz(phi, tilt)
        dirs.append(d)
        pts.append(pts[-1] + d * L)
    return pts, dirs  # CMC, MCP, IP, tip end


def thumb_up(d):
    """The thumb's 'back' (its nail's side) for a bone along d: the back of the hand turned nail_deg toward the thumb's side, made square to d."""
    a = THUMB["nail_deg"] * D2R
    n = np.array([0.0, math.cos(a), math.sin(a)])
    n = n - d * np.dot(n, d)
    return n / np.linalg.norm(n)


# ------------------------------------------------------------------------------------------------ distance field primitives (numpy, N x 3)
def smin(a, b, k):
    """Smooth union (polynomial, radius k)."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smin3(a, b, k):
    """Smooth union, cubic (a wider, gentler blend than smin's for the same bulge); k may vary from point to point."""
    k = np.maximum(k, 1e-9)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * h * k / 6.0


def smax(a, b, k):
    return -smin(-a, -b, k)


def frame_coords(P, origin, e, n):
    """P in the frame (e along, n up, e x n across) at origin: (u, v, w)."""
    q = P - origin
    s = np.cross(e, n)
    return q @ e, q @ n, q @ s


def sd_round_cone_uvw(u, v, w, L, ra, rb, kya=1.0, kyb=1.0):
    """A tapered capsule along u from 0 (radius ra) to L (radius rb), its section an oval (height / width ky, from kya to kyb along it)."""
    t = np.clip(u / L, 0.0, 1.0)
    ky = kya + (kyb - kya) * t
    rho = np.sqrt(w * w + (v / ky) ** 2)
    b = (ra - rb) / L
    a = math.sqrt(max(1.0 - b * b, 1e-9))
    k = -b * rho + a * u
    d_mid = a * rho + b * u - ra
    d_a = np.sqrt(rho * rho + u * u) - ra
    d_b = np.sqrt(rho * rho + (u - L) ** 2) - rb
    return np.where(k < 0.0, d_a, np.where(k > a * L, d_b, d_mid))


def sd_round_cone(P, A, B, ra, rb, up, kya=1.0, kyb=1.0):
    A = np.asarray(A, dtype=float)
    B = np.asarray(B, dtype=float)
    L = float(np.linalg.norm(B - A))
    e = (B - A) / L
    n = np.asarray(up, dtype=float)
    n = n - e * np.dot(n, e)
    n = n / np.linalg.norm(n)
    u, v, w = frame_coords(P, A, e, n)
    return sd_round_cone_uvw(u, v, w, L, ra, rb, kya, kyb)


def sd_ellipsoid(P, C, axes, radii):
    """An ellipsoid at C with semi-axes radii along the (orthonormal) axes (3 x 3, rows)."""
    q = (P - np.asarray(C, dtype=float)) @ np.asarray(axes, dtype=float).T
    r = np.asarray(radii, dtype=float)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-12)


def sd_polygon(px, pz, V):
    """Signed distance in the plane to a closed polygon V (n x 2, (x, z)); negative inside."""
    V = np.asarray(V, dtype=float)
    n = len(V)
    d = (px - V[0, 0]) ** 2 + (pz - V[0, 1]) ** 2
    s = np.ones_like(px)
    j = n - 1
    for i in range(n):
        ex, ez = V[j, 0] - V[i, 0], V[j, 1] - V[i, 1]
        wx, wz = px - V[i, 0], pz - V[i, 1]
        t = np.clip((wx * ex + wz * ez) / (ex * ex + ez * ez), 0.0, 1.0)
        bx, bz = wx - ex * t, wz - ez * t
        d = np.minimum(d, bx * bx + bz * bz)
        c1 = pz >= V[i, 1]
        c2 = pz < V[j, 1]
        c3 = ex * wz > ez * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
        j = i
    return s * np.sqrt(d)


# ------------------------------------------------------------------------------------------------ the hand's field
# The palm's outline seen from the back of the hand (x, z), counter-clockwise from the heel on the little finger's side: the heel, the little
# finger's side, the knuckles' arc (just past the knuckles: the fingers grow out of it), the index side, back to the heel. Its slab is thicker at
# the heel, its back domed across and arched with its front (the metacarpal arch).
PALM_OUTLINE = [(0.004, -0.0222), (0.030, -0.0289), (0.050, -0.0316), (0.0600, -0.0320), (0.0660, -0.0250), (0.0715, -0.0116),
                (0.0745, 0.0048), (0.0715, 0.0211), (0.0660, 0.0281), (0.0500, 0.0286), (0.0300, 0.0256), (0.0040, 0.0206)]


def palm_core(P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    arch = 3.2 * z * z  # (the sides drop: the back domed, the front hollowed)
    u = np.clip(x / 0.07, 0.0, 1.0)
    top = 0.0090 - arch - 0.0008 * u
    bot = -0.0102 - arch + 0.0014 * u
    yc = 0.5 * (top + bot)
    th = 0.5 * (top - bot)
    d2 = sd_polygon(x, z, PALM_OUTLINE)
    dy = np.abs(y - yc) - th
    r = th * 0.92
    qa = d2 + r
    qb = dy + r
    return np.sqrt(np.maximum(qa, 0) ** 2 + np.maximum(qb, 0) ** 2) + np.minimum(np.maximum(qa, qb), 0.0) - r


def finger_field(P, name):
    F = FINGERS[name]
    pts, d = finger_points(name)
    up = np.array([0.0, 1.0, 0.0])
    w = F["w"]
    ky = F["ky"]
    f = None
    for k in range(3):
        A, B = pts[k], pts[k + 1]
        ra, rb = w[k], w[k + 1]
        if k == 2:
            B = B - d * w[3]  # (the tip's round end reaches the fingertip)
        seg = sd_round_cone(P, A, B, ra, rb, up, ky, ky)
        f = seg if f is None else smin(f, seg, 0.0022)
    # the pads under each phalanx (soft, a little fuller toward the palm) and the fingertip's pulp
    s = np.cross(d, up)
    axes = np.array([d, up, s])
    for k in range(3):
        A, B = pts[k], pts[k + 1]
        L = F["L"][k]
        wm = 0.5 * (w[k] + w[k + 1])
        if k < 2:
            C = A + d * (0.56 * L) - up * (0.34 * wm * ky)
            pad = sd_ellipsoid(P, C, axes, (0.40 * L, 0.62 * wm * ky, 0.82 * wm))
            f = smin(f, pad, 0.0040)
        else:
            C = A + d * (0.58 * L) - up * (0.28 * wm * ky)
            pad = sd_ellipsoid(P, C, axes, (0.44 * L, 0.70 * wm * ky, 0.92 * wm))
            f = smin(f, pad, 0.0036)
    # a slight knuckle bump on the back of the middle joint (soft: a child's, no lump that shades dark when the finger bends)
    C = pts[1] + up * (0.56 * w[1] * ky)
    bump = sd_ellipsoid(P, C, axes, (0.0040, 0.0015, 0.50 * w[1]))
    f = smin(f, bump, 0.0030)
    return f


def thumb_field(P):
    pts, dirs = thumb_points()
    w = THUMB["w"]
    ky = THUMB["ky"]
    f = None
    for k in range(3):
        A, B = pts[k], pts[k + 1]
        d = dirs[k]
        if k == 2:
            B = B - d * w[3]
        seg = sd_round_cone(P, A, B, w[k], w[k + 1], thumb_up(d), ky, ky)
        f = seg if f is None else smin(f, seg, 0.003)
    # the pads of the two phalanges (the pulp fuller), on the side away from the nail
    for k in (1, 2):
        A, B = pts[k], pts[k + 1]
        d = dirs[k]
        n = thumb_up(d)
        s = np.cross(d, n)
        L = THUMB["L"][k]
        wm = 0.5 * (w[k] + w[k + 1])
        C = A + d * ((0.5 if k == 1 else 0.58) * L) - n * (0.33 * wm * ky)
        pad = sd_ellipsoid(P, C, np.array([d, n, s]), ((0.36 if k == 1 else 0.42) * L, 0.66 * wm * ky, 0.88 * wm))
        f = smin(f, pad, 0.0028)
    return f


def hand_sdf(P):
    """The skin's signed distance (m) at points P (N x 3, frame H)."""
    P = np.asarray(P, dtype=float)
    palm = palm_core(P)
    up = np.array([0.0, 1.0, 0.0])
    # the thenar pad: the ball of the thumb, along its metacarpal on the palm's side (full and rounded, so the thumb grows out of a clear base and
    # stands across from the fingers)
    tp, td = thumb_points()
    d1 = td[0]
    a1 = unit([d1[0], 0.0, d1[2]])
    a3 = up
    a2 = np.cross(a3, a1)
    C = tp[0] + d1 * 0.0135 + np.array([0.0, -0.0056, -0.0036])
    thenar = sd_ellipsoid(P, C, np.array([a1, a3, a2]), (0.0222, 0.0100, 0.0134))
    palm = smin(palm, thenar, 0.0080)
    # the hypothenar pad: the little finger's side of the palm
    hyp = sd_ellipsoid(P, (0.0290, -0.0068, -0.0225), np.eye(3), (0.0250, 0.0080, 0.0092))
    palm = smin(palm, hyp, 0.0065)
    # the pads under the finger roots, across the palm (one soft ridge)
    pads = None
    for name in FINGER_NAMES:
        m = np.array(FINGERS[name]["mcp"])
        e = sd_ellipsoid(P, m + np.array([-0.0050, -0.0068, 0.0]), np.eye(3), (0.0090, 0.0048, 0.0085))
        pads = e if pads is None else smin(pads, e, 0.006)
    palm = smin(palm, pads, 0.006)
    # the web between the thumb and the index: a soft fold from the index's root out to the thumb's knuckle
    wa = np.array([0.046, -0.0015, 0.0225])
    wb = tp[1] + td[1] * 0.006
    we = unit(wb - wa)
    wn = unit(np.cross(we, np.cross(up, we)))
    thumb_web = sd_round_cone(P, wa, wb + np.array([0.0, 0.0015, 0.0]), 0.0058, 0.0050, wn, 0.62, 0.62)
    # the knuckles on the back of the hand (soft: a child's, a gentle row, never lumps)
    for name in FINGER_NAMES:
        m = np.array(FINGERS[name]["mcp"])
        kn = sd_ellipsoid(P, m + np.array([-0.0010, 0.0040, 0.0]), np.eye(3), (0.0054, 0.0026, 0.0054))
        palm = smin(palm, kn, 0.0045)
    # the wrist and the short forearm (tapering to the wrist), cut square just inside the sleeve
    arm = sd_round_cone(P, (-0.068, -0.0008, -0.0010), (0.006, -0.0010, -0.0005), 0.0262, 0.0228, up, 0.74, 0.62)
    arm = smax(arm, -(P[:, 0] + 0.0705), 0.002)
    body = smin(palm, arm, 0.013)
    # the fingers (a touch of blending between them: no crease in the webs), grown out of the palm (the blend is the webs)
    fingers = None
    # (neighbouring fingers blend wider at their roots, where they nearly touch, than along them: a soft cleft, never a slit)
    kroot = 0.0025 + 0.0040 * (1.0 - smoothstep(0.068, 0.084, P[:, 0]))
    for name in FINGER_NAMES:
        f = finger_field(P, name)
        fingers = f if fingers is None else smin3(fingers, f, kroot)
    # the webs between the fingers: a thin soft fold between neighbours' first bones, its free edge a third of the way along them
    for a, b in zip(FINGER_NAMES[:-1], FINGER_NAMES[1:]):
        pa, da = finger_points(a)
        pb, db = finger_points(b)
        A = pa[0] + da * (0.20 * FINGERS[a]["L"][0]) + np.array([0.0, -0.0004, 0.0])
        B = pb[0] + db * (0.20 * FINGERS[b]["L"][0]) + np.array([0.0, -0.0004, 0.0])
        web = sd_round_cone(P, A, B, 0.0036, 0.0036, up, 0.78, 0.78)
        fingers = smin3(fingers, web, 0.0068)
    hand = smin(body, fingers, 0.0062)
    # the thumb, and the web between it and the index
    hand = smin3(hand, smin3(thumb_field(P), thumb_web, 0.0120), 0.0140)
    return hand


def sdf_grad(P, h=2.5e-5):
    P = np.asarray(P, dtype=float)
    g = np.zeros_like(P)
    for i in range(3):
        o = np.zeros(3)
        o[i] = h
        g[:, i] = (hand_sdf(P + o) - hand_sdf(P - o)) / (2 * h)
    return g


# ------------------------------------------------------------------------------------------------ field -> surface
BOUNDS = ((-0.0740, 0.1500), (-0.0300, 0.0240), (-0.0430, 0.0630))


def sample_grid(h):
    xs = np.arange(BOUNDS[0][0], BOUNDS[0][1] + h, h)
    ys = np.arange(BOUNDS[1][0], BOUNDS[1][1] + h, h)
    zs = np.arange(BOUNDS[2][0], BOUNDS[2][1] + h, h)
    F = np.empty((len(xs), len(ys), len(zs)), dtype=np.float32)
    Y, Z = np.meshgrid(ys, zs, indexing="ij")
    step = max(1, 400000 // Y.size)
    for i0 in range(0, len(xs), step):
        sl = xs[i0:i0 + step]
        P = np.empty((len(sl), Y.size, 3))
        P[:, :, 0] = sl[:, None]
        P[:, :, 1] = Y.ravel()[None, :]
        P[:, :, 2] = Z.ravel()[None, :]
        F[i0:i0 + len(sl)] = hand_sdf(P.reshape(-1, 3)).reshape(len(sl), len(ys), len(zs))
    return F, np.array([xs[0], ys[0], zs[0]]), h


def surface_nets(F, origin, h):
    """Quads on the zero level of F: one vertex per cell the surface crosses (the mean of its edges' crossings), one quad per crossed edge."""
    N = np.array(F.shape)
    cshape = tuple(N - 1)
    edges = []  # per axis: (the crossed edges' start indices, whether their far end is the inside)
    cells, pts = [], []
    for ax in range(3):
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[ax] = slice(0, -1)
        sl1[ax] = slice(1, None)
        f0 = F[tuple(sl0)]
        f1 = F[tuple(sl1)]
        cross = (f0 < 0) != (f1 < 0)
        idx = np.argwhere(cross)
        a = f0[cross].astype(np.float64)
        b = f1[cross].astype(np.float64)
        p = idx.astype(np.float64)
        p[:, ax] += a / (a - b)
        edges.append((idx, b < 0))
        o1, o2 = [o for o in range(3) if o != ax]
        for d1 in (0, 1):
            for d2 in (0, 1):
                c = idx.copy()
                c[:, o1] -= d1
                c[:, o2] -= d2
                ok = (c[:, o1] >= 0) & (c[:, o1] <= N[o1] - 2) & (c[:, o2] >= 0) & (c[:, o2] <= N[o2] - 2)
                cells.append(np.ravel_multi_index(tuple(c[ok].T), cshape))
                pts.append(p[ok])
    cells = np.concatenate(cells)
    pts = np.concatenate(pts)
    uniq, inv = np.unique(cells, return_inverse=True)
    sums = np.zeros((len(uniq), 3))
    np.add.at(sums, inv, pts)
    verts = origin + sums / np.bincount(inv, minlength=len(uniq))[:, None] * h
    quads = []
    for ax, (idx, far_in) in enumerate(edges):
        o1, o2 = [o for o in range(3) if o != ax]
        keep = (idx[:, o1] >= 1) & (idx[:, o1] <= N[o1] - 2) & (idx[:, o2] >= 1) & (idx[:, o2] <= N[o2] - 2)
        idx = idx[keep]
        far_in = far_in[keep]

        def cell(d1, d2):
            c = idx.copy()
            c[:, o1] -= 1 - d1
            c[:, o2] -= 1 - d2
            return np.searchsorted(uniq, np.ravel_multi_index(tuple(c.T), cshape))

        # ordered so the quad faces +axis (x: y then z; y: z then x; z: x then y); reversed where the far end is the inside
        if ax == 1:
            q = np.stack([cell(0, 0), cell(0, 1), cell(1, 1), cell(1, 0)], axis=1)
        else:
            q = np.stack([cell(0, 0), cell(1, 0), cell(1, 1), cell(0, 1)], axis=1)
        q[far_in] = q[far_in][:, ::-1]
        quads.append(q)
    return verts, np.concatenate(quads, axis=0)


def h2b(P):
    P = np.asarray(P, dtype=float)
    return np.stack([P[:, 0], -P[:, 2], P[:, 1]], axis=1)


def b2h(B):
    B = np.asarray(B, dtype=float)
    return np.stack([B[:, 0], B[:, 2], -B[:, 1]], axis=1)


def deselect_all():
    bpy.context.view_layer.update()
    for o in bpy.context.scene.objects:
        if o is not None:
            o.select_set(False)


def mesh_object(name, verts_b, faces, collection=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts_b], [], [tuple(int(i) for i in f) for f in faces])
    me.validate(clean_customdata=False)
    me.update()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def mesh_arrays(ob):
    me = ob.data
    V = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", V)
    V = V.reshape(-1, 3)
    faces = [tuple(p.vertices) for p in me.polygons]
    return V, faces


def set_mesh_coords(ob, Vb):
    ob.data.vertices.foreach_set("co", np.asarray(Vb, dtype=np.float64).ravel())
    ob.data.update()


def project(P, iters=6):
    """Points put on the field's zero level (Newton steps along its gradient)."""
    P = np.array(P, dtype=float)
    for _ in range(iters):
        d = hand_sdf(P)
        g = sdf_grad(P)
        gg = np.maximum((g * g).sum(1), 1e-12)
        P -= (d / gg)[:, None] * g
    return P


def neighbours(n, faces):
    nb = [set() for _ in range(n)]
    for f in faces:
        m = len(f)
        for i in range(m):
            a, b = f[i], f[(i + 1) % m]
            nb[a].add(b)
            nb[b].add(a)
    return [np.array(sorted(s), dtype=np.int64) for s in nb]


def relax(P, faces, rounds=4, lam=0.5):
    """Even the vertices out along the surface (tangential Laplacian steps, back on the surface after each)."""
    nb = neighbours(len(P), faces)
    P = np.array(P, dtype=float)
    for _ in range(rounds):
        mean = np.array([P[n].mean(0) if len(n) else P[i] for i, n in enumerate(nb)])
        g = sdf_grad(P)
        g /= np.maximum(np.linalg.norm(g, axis=1), 1e-12)[:, None]
        dv = mean - P
        dv -= (dv * g).sum(1)[:, None] * g
        P = project(P + lam * dv, iters=4)
    return P


def build_skin(target_faces=3300):
    log(f"sampling the field (voxel {VOXEL * 1000:.2f} mm)")
    F, origin, h = sample_grid(VOXEL)
    # (outside everywhere on the grid's faces: the surface is closed)
    assert min(F[0].min(), F[-1].min(), F[:, 0].min(), F[:, -1].min(), F[:, :, 0].min(), F[:, :, -1].min()) > 0, "the hand leaves the grid"
    log(f"grid {F.shape}, surface nets")
    V, Q = surface_nets(F, origin, h)
    # one smoothing step (surface nets can put two vertices almost on top of each other, which QuadriFlow takes for a degenerate edge)
    E = np.concatenate([Q[:, [0, 1]], Q[:, [1, 2]], Q[:, [2, 3]], Q[:, [3, 0]]])
    acc = np.zeros_like(V)
    np.add.at(acc, E[:, 0], V[E[:, 1]])
    np.add.at(acc, E[:, 1], V[E[:, 0]])
    deg = np.bincount(E.ravel(), minlength=len(V))[:, None]
    V = V + 0.5 * (acc / deg - V)
    log(f"surface nets: {len(V)} vertices, {len(Q)} quads; remeshing")
    # (QuadriFlow takes edges under 1e-4 in every axis for degenerate ones: it remeshes the surface drawn 1000 times larger)
    ob = mesh_object("skin_dense", h2b(V) * 1000.0, Q)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    r = bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=False, use_preserve_sharp=False, use_preserve_boundary=False,
                                         preserve_attributes=False, smooth_normals=False, mode="FACES", target_faces=target_faces, seed=7)
    log(f"quadriflow {r}: {len(ob.data.polygons)} faces")
    if "FINISHED" not in r:
        raise RuntimeError("QuadriFlow did not remesh the skin")
    Vb, faces = mesh_arrays(ob)
    P = project(b2h(Vb / 1000.0))
    P = relax(P, faces, rounds=5)
    set_mesh_coords(ob, h2b(P))
    ob.name = "skin"
    ob.data.name = "skin"
    return ob


# ------------------------------------------------------------------------------------------------ the rig
BONES = ["forearm", "wrist", "palm", "thumb_1", "thumb_2", "thumb_3"] + [f"{f}_{k}" for f in FINGER_NAMES for k in (1, 2, 3)]
DIGITS = ["thumb"] + FINGER_NAMES
EX = np.array([1.0, 0.0, 0.0])
EY = np.array([0.0, 1.0, 0.0])
TIP_IN = 0.0018  # (an end bone stops this short of its fingertip, inside the skin)


def rig_bones():
    """Every bone: name -> (head, tail, parent, X, Y) in H. The joint's rest frame is (X, Y, X x Y) at its head (the contract's frames)."""
    R = {
        "forearm": (np.zeros(3), np.array([-0.060, 0.0, 0.0]), None, EX, EY),
        "wrist": (np.zeros(3), np.array([0.014, 0.0, 0.0]), "forearm", EX, EY),
        "palm": (np.array([0.014, 0.0, 0.0]), np.array([0.066, 0.0, 0.0]), "wrist", EX, EY),
    }
    tp, td = thumb_points()
    for k in range(3):
        tail = tp[k + 1] if k < 2 else tp[3] - td[2] * TIP_IN
        R[f"thumb_{k + 1}"] = (tp[k], tail, "palm" if k == 0 else f"thumb_{k}", td[k], thumb_up(td[k]))
    for name in FINGER_NAMES:
        pts, d = finger_points(name)
        for k in range(3):
            tail = pts[k + 1] if k < 2 else pts[3] - d * TIP_IN
            R[f"{name}_{k + 1}"] = (pts[k], tail, "palm" if k == 0 else f"{name}_{k}", d, EY)
    return R


def joint_frame(name, R=None):
    """The joint's rest frame in H (= glTF) as a 4 x 4 matrix (numpy)."""
    R = R or rig_bones()
    head, tail, parent, X, Y = R[name]
    X = unit(X)
    Y = unit(np.asarray(Y) - X * np.dot(Y, X))
    Z = np.cross(X, Y)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = X, Y, Z, head
    return M


def v3b(p):
    return Vector(h2b(np.asarray(p, dtype=float)[None])[0])


def build_armature(name="hand"):
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    deselect_all()
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    R = rig_bones()
    for bn in BONES:
        head, tail, parent, X, Y = R[bn]
        eb = data.edit_bones.new(bn)
        eb.head = v3b(head)
        eb.tail = v3b(tail)
        eb.align_roll(v3b(Y))  # (Blender's bone: y along it, z toward the back of the hand: its x is the contract's z, the flexion axis)
        if parent:
            eb.parent = data.edit_bones[parent]
        eb.use_deform = True
        eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(False)
    return arm


# ------------------------------------------------------------------------------------------------ weights
def digit_chain(dg):
    if dg == "thumb":
        return thumb_points()[0]
    return finger_points(dg)[0]


def seg_dist(P, A, B):
    AB = B - A
    t = np.clip(((P - A) @ AB) / np.dot(AB, AB), 0.0, 1.0)
    return np.linalg.norm(P - (A + t[:, None] * AB), axis=1), t


def chain_dist(P, pts):
    best = np.full(len(P), np.inf)
    where = np.zeros(len(P))
    for k in range(len(pts) - 1):
        d, t = seg_dist(P, pts[k], pts[k + 1])
        better = d < best
        best = np.where(better, d, best)
        where = np.where(better, k + t, where)
    return best, where  # distance, and where along the chain (0 at its first joint, 1 at the next, ...)


def skin_weights(skin, arm, scale=10.0):
    """Blender's automatic (bone heat) weights, computed on a copy drawn `scale` times larger (the heat solver fails on very small meshes)."""
    sk = skin.copy()
    sk.data = skin.data.copy()
    ar = arm.copy()
    ar.data = arm.data.copy()
    for o in (sk, ar):
        bpy.context.scene.collection.objects.link(o)
    sk.data.transform(Matrix.Scale(scale, 4))
    ar.data.transform(Matrix.Scale(scale, 4))
    deselect_all()
    sk.select_set(True)
    ar.select_set(True)
    bpy.context.view_layer.objects.active = ar
    r = bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    log(f"automatic weights {r}")
    n = len(sk.data.vertices)
    W = np.zeros((n, len(BONES)))
    gi = {g.index: BONES.index(g.name) for g in sk.vertex_groups if g.name in BONES}
    for v in sk.data.vertices:
        for g in v.groups:
            if g.group in gi:
                W[v.index, gi[g.group]] = g.weight
    bpy.data.objects.remove(sk, do_unlink=True)
    bpy.data.objects.remove(ar, do_unlink=True)
    return W


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def clean_weights(P, faces, W, rounds=10):
    """The automatic weights, checked. Each digit's bones fade out (smoothly, so nothing tears) where another digit is nearer: fully on its
    own digit, partly in a web, never on another finger (past the web of the finger a vertex is on, another digit's bones have no weight at
    all); the forearm's bone fades out over the wrist and every other bone up the forearm (the skin at the cuff moves with the forearm, as
    the sleeve does); then smoothing rounds over the surface, more in the web between the thumb and the index (the fading kept), tiny
    weights dropped, at most 4 bones a vertex, normalised. Returns the weights and the check's numbers."""
    W = np.array(W, dtype=float)
    bi = {b: i for i, b in enumerate(BONES)}
    n = len(P)
    cd = [chain_dist(P, digit_chain(dg)) for dg in DIGITS]
    D = np.stack([c[0] for c in cd], axis=1)
    where = np.stack([c[1] for c in cd], axis=1)
    near = np.argmin(D, axis=1)
    Dn = D[np.arange(n), near]
    wn = where[np.arange(n), near]
    # how far past its web a vertex on a digit is (0 in the web .. 1 on the finger proper); for the thumb, past its knuckle
    past = np.where(near == 0, smoothstep(1.15, 1.45, wn), smoothstep(0.30, 0.55, wn))
    fac = np.ones_like(W)
    for k, dg in enumerate(DIGITS):
        r = D[:, k] / np.maximum(Dn, 1e-9)
        f = 1.0 - smoothstep(1.05, 1.35, r)
        f = np.where(near == k, 1.0, f * (1.0 - past))
        for j in (1, 2, 3):
            fac[:, bi[f"{dg}_{j}"]] = f
    fac[:, bi["forearm"]] = 1.0 - smoothstep(0.015, 0.035, P[:, 0])
    # (and every other bone fades out up the forearm: the skin at the cuff moves with the forearm alone, as the sleeve does)
    up_arm = smoothstep(-0.024, -0.012, P[:, 0])
    for b in BONES:
        if b != "forearm":
            fac[:, bi[b]] *= up_arm
    on_finger = past >= 1.0 - 1e-9

    def stray(Wm):
        m = 0.0
        for k, dg in enumerate(DIGITS):
            cols = [bi[f"{dg}_{j}"] for j in (1, 2, 3)]
            sel = on_finger & (near != k)
            if sel.any():
                m = max(m, float(Wm[sel][:, cols].sum(1).max()))
        return m

    before = stray(W / np.maximum(W.sum(1, keepdims=True), 1e-12))
    nb = neighbours(n, faces)
    W *= fac
    for _ in range(rounds):
        mean = np.array([W[q].mean(0) if len(q) else W[i] for i, q in enumerate(nb)])
        W = (0.5 * W + 0.5 * mean) * fac
        W /= np.maximum(W.sum(1, keepdims=True), 1e-12)
    # the web between the thumb and the index stretches most (the thumb swings across the palm): its weights eased out wider there
    web = (D[:, 0] < 0.024) & (D[:, 1] < 0.024) & (P[:, 0] < 0.075)
    for _ in range(3 * rounds):
        mean = np.array([W[q].mean(0) if len(q) else W[i] for i, q in enumerate(nb)])
        W[web] = ((0.5 * W + 0.5 * mean) * fac)[web]
        W /= np.maximum(W.sum(1, keepdims=True), 1e-12)
    W[W < 0.01] = 0.0
    idx = np.argsort(-W, axis=1)
    for c in range(4, W.shape[1]):
        W[np.arange(n), idx[:, c]] = 0.0
    lost = W.sum(1) <= 1e-9
    W[lost, bi["palm"]] = 1.0
    W /= W.sum(1, keepdims=True)
    info = dict(stray_before=round(before, 4), stray_after=round(stray(W), 6), on_finger_vertices=int(on_finger.sum()), empty=int(lost.sum()),
                max_influences=int((W > 0).sum(1).max()),
                bones_with_vertices={b: int((W[:, i] > 0.5).sum()) for i, b in enumerate(BONES)})
    return W, info


# ------------------------------------------------------------------------------------------------ nails
def digit_tip(dg):
    """The end segment of a digit: its joint (DIP or IP), direction, the back's direction, length to the fingertip, half-width at the tip, ky."""
    if dg == "thumb":
        pts, dirs = thumb_points()
        d = dirs[2]
        return pts[2], d, thumb_up(d), THUMB["L"][2], THUMB["w"][3], THUMB["ky"]
    F = FINGERS[dg]
    pts, d = finger_points(dg)
    return pts[2], d, EY, F["L"][2], F["w"][3], F["ky"]


def build_nail(dg, n_grid=7):
    """A short rounded nail on the digit's end segment: a soft shell lying on the skin, raised 0.3 mm in its middle, its rim sunk under it."""
    D, d, n, L3, wt, ky = digit_tip(dg)
    s = np.cross(d, n)
    u0, u1 = 0.30 * L3, L3 - 0.40 * wt
    hu, uc = 0.5 * (u1 - u0), 0.5 * (u0 + u1)
    hw = (0.76 if dg == "thumb" else 0.74) * wt
    g = np.linspace(-1.0, 1.0, n_grid)
    A, Bm = np.meshgrid(g, g, indexing="ij")
    a, b = A.ravel(), Bm.ravel()
    # the square grid onto a rounded outline (a superellipse), radially
    th = np.arctan2(b, a)
    rq = np.maximum(np.abs(a), np.abs(b))
    e = 2.8
    rse = (np.abs(np.cos(th)) ** e + np.abs(np.sin(th)) ** e) ** (-1.0 / e)
    rsq = 1.0 / np.maximum(np.abs(np.cos(th)), np.abs(np.sin(th)))
    k = np.where(rq > 0, rse / rsq, 1.0)
    pa, pb = a * k, b * k
    r = rq  # (0 in the middle .. 1 on the rim)
    Q = D + np.outer(uc + hu * pa, d) + np.outer(hw * pb, s) + n * (wt * ky * 1.6)
    S = project(Q, iters=10)
    g3 = sdf_grad(S)
    g3 /= np.linalg.norm(g3, axis=1)[:, None]
    tau = -0.00018 + 0.00050 * np.sqrt(np.maximum(0.0, 1.0 - r ** 4))
    V = S + g3 * tau[:, None]
    faces = []
    for i in range(n_grid - 1):
        for j in range(n_grid - 1):
            q = [i * n_grid + j, (i + 1) * n_grid + j, (i + 1) * n_grid + j + 1, i * n_grid + j + 1]
            faces.append(q)
    faces = np.array(faces)
    # (facing out of the finger)
    f0 = faces[len(faces) // 2]
    nrm = np.cross(V[f0[1]] - V[f0[0]], V[f0[2]] - V[f0[0]])
    if np.dot(nrm, n) < 0:
        faces = faces[:, ::-1]
    return V, faces


# ------------------------------------------------------------------------------------------------ the sleeve
SLEEVE_OPEN = -0.0285  # the cuff's edge (m from the wrist joint, along -x)
SLEEVE_END = -0.0775   # where this piece of the sleeve ends, open (7.75 cm up the forearm): the view carries the sleeve on from here
SLEEVE_RING = 28


def skin_radius(C, E):
    """The skin's distance from axis points C along directions E (N x 3 each): bisection on the field."""
    lo = np.full(len(C), 0.004)
    hi = np.full(len(C), 0.045)
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        inside = hand_sdf(C + E * mid[:, None]) < 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    return 0.5 * (lo + hi)


SLEEVE_GAP_END = 0.0047  # the sleeve's clearance over the skin where its body runs on up the arm


def sleeve_profile():
    """The sleeve's section along the arm, from its inner wall (inside the cuff) round the cuff's rolled edge and back along its outside to
    where its body runs on up the arm: [(x, clearance over the skin)]."""
    prof = [(-0.0368, 0.0012), (-0.0335, 0.0012)]
    cx, cr = SLEEVE_OPEN - 0.0011, 0.0011
    for a in (-90, -45, 0, 45, 90):  # the rolled edge of the cuff
        t = a * D2R
        prof.append((cx + cr * math.cos(t), 0.0023 + cr * math.sin(t)))
    prof += [(-0.0335, 0.0034), (-0.0390, 0.0037), (-0.0440, 0.0035), (-0.0466, 0.0030), (-0.0488, 0.0038), (-0.0560, 0.0042),
             (-0.0640, 0.0045), (-0.0700, SLEEVE_GAP_END)]
    return prof


def build_sleeve():
    """A soft knit cuff and the start of the sleeve round the forearm, a little clear of the skin everywhere; from 7 cm up the forearm its
    section stays the same to its open end (SLEEVE_END), so the view carries the sleeve on up the arm out of the picture (web/hands.js) with no
    seam: -> (vertices, faces, the end ring [(y, z)], one a vertex round it, in order)."""
    R0, R1 = np.array([-0.068, -0.0008, -0.0010]), np.array([0.006, -0.0010, -0.0005])

    def axis_at(x):
        t = (x - R0[0]) / (R1[0] - R0[0])
        return R0 + (R1 - R0) * t

    th = np.arange(SLEEVE_RING) * (2 * math.pi / SLEEVE_RING)
    E = np.stack([np.zeros_like(th), np.cos(th), np.sin(th)], axis=1)
    rings = []
    for x, gap in sleeve_profile():
        C = np.repeat(axis_at(x)[None], SLEEVE_RING, axis=0)
        C[:, 0] = x
        rho = skin_radius(C, E)
        rings.append(C + E * (rho + gap)[:, None])
    # the body: the section at 7 cm carried straight on to the open end (a tube along -x)
    xe = -0.0700
    end = rings[-1].copy()
    for x in (-0.0735, SLEEVE_END):
        R = end.copy()
        R[:, 0] = x
        rings.append(R)
    V = np.concatenate(rings)
    faces = []
    nr = len(rings)
    for i in range(nr - 1):
        for j in range(SLEEVE_RING):
            j2 = (j + 1) % SLEEVE_RING
            faces.append([i * SLEEVE_RING + j, i * SLEEVE_RING + j2, (i + 1) * SLEEVE_RING + j2, (i + 1) * SLEEVE_RING + j])
    # (outward: a quad on the cuff's outside faces away from the arm)
    probe = faces[(6) * SLEEVE_RING]
    nrm = np.cross(V[probe[1]] - V[probe[0]], V[probe[2]] - V[probe[0]])
    ctr = V[probe].mean(0) - axis_at(V[probe].mean(0)[0])
    ctr[0] = 0
    if np.dot(nrm, ctr) < 0:
        faces = [f[::-1] for f in faces]
    ring = [(round(float(p[1]), 5), round(float(p[2]), 5)) for p in end]
    assert abs(xe - rings[nr - 3][0, 0]) < 1e-9
    return V, faces, ring


# ------------------------------------------------------------------------------------------------ materials
MATERIALS = {
    # name: (sRGB colour, roughness): plain metal-rough PBR, one-sided (the view grades and may restyle them by name)
    "skin": ("#c69273", 0.58),
    "nail": ("#dcae9c", 0.30),
    "sleeve": ("#7187a5", 0.88),
}


def make_materials():
    out = {}
    for name, (hex_rgb, rough) in MATERIALS.items():
        m = bpy.data.materials.get(name) or look_material(name, hex_rgb, rough)
        m.name = name
        m.use_backface_culling = True  # (glTF: not double-sided)
        out[name] = m
    return out


# ------------------------------------------------------------------------------------------------ the whole hand
def part_object(name, V_h, faces, material, groups):
    """A mesh object from H vertices, one material, vertex groups {bone: weights (N)}."""
    ob = mesh_object(name, h2b(V_h), faces)
    ob.data.materials.append(material)
    for bn, w in groups.items():
        g = ob.vertex_groups.new(name=bn)
        for i in np.nonzero(w > 0)[0]:
            g.add([int(i)], float(w[i]), "REPLACE")
    return ob


def rig_extras(P, W):
    """What the view needs to fit the hand to things (metres, each in its bone's rest frame: x along, y its back, z = x cross y): every bone's
    length and the skin's reach round it at its head, middle and end (half-width across z, back above +y, front below -y), measured from the
    skin vertices it carries most; on each end bone the fingertip's end and the pad's middle; and the hand's own measures."""
    R = rig_bones()
    out = {}
    for i, bn in enumerate(BONES):
        if bn in ("forearm", "wrist"):
            continue
        M = joint_frame(bn, R)
        q = (np.linalg.inv(M) @ np.c_[P, np.ones(len(P))].T).T[:, :3]
        head, tail = R[bn][0], R[bn][1]
        L = float(np.linalg.norm(tail - head)) + (TIP_IN if bn.endswith("_3") else 0.0)
        own = W[:, i] >= 0.5
        e = {"length": round(L, 5)}
        if bn != "palm":
            sec = []
            for u in (0.0, 0.5, 1.0):
                sel = own & (np.abs(q[:, 0] - u * L) < 0.18 * L + 0.0015)
                if bn.endswith("_3") and u == 1.0:
                    sel = own & (q[:, 0] > L - 0.004)
                if not sel.any():
                    sec.append(None)
                    continue
                sec.append([round(float(np.abs(q[sel, 2]).max()), 5), round(float(q[sel, 1].max()), 5), round(float(-q[sel, 1].min()), 5)])
            e["section"] = sec  # [half-width, back, front] at the head, the middle and the end
        if bn.endswith("_3"):
            tipsel = own
            k = int(np.argmax(np.where(tipsel, q[:, 0], -1)))
            e["tip"] = [round(float(v), 5) for v in q[k]]
            near = own & (q[:, 0] > 0.55 * L) & (q[:, 0] < 0.85 * L)
            if near.any():
                j = np.where(near)[0][int(np.argmin(q[near, 1]))]
                e["pad"] = [round(float(v), 5) for v in q[j]]
        if bn == "palm":
            sel = (P[:, 0] > 0.02) & (P[:, 0] < 0.06) & (np.abs(P[:, 2]) < 0.02)
            e["back"] = round(float(P[sel, 1].max()), 5)
            e["front"] = round(float(-P[sel, 1].min()), 5)
        out[bn] = e
    # the hand's measures: from the wrist joint to the middle fingertip; across the palm just short of the knuckles
    across = (P[:, 0] > 0.058) & (P[:, 0] < 0.066) & (P[:, 2] < 0.036)
    out["hand"] = {"side": "left", "units": "m", "hand_length": round(float(P[:, 0].max()), 4),
                   "palm_width": round(float(P[across, 2].max() - P[across, 2].min()), 4),
                   "sleeve": {"cuff_x": SLEEVE_OPEN, "end_x": SLEEVE_END},
                   "pose": "bone.quaternion = rest x Euler(twist, -spread, -flex, 'YZX'): flex toward the palm, spread toward the thumb"}
    return out


def weights_like_skin(Q, P, W, k=4):
    """Weights for points lying on the skin (a nail): those of the skin under them (the k nearest skin vertices, by inverse distance), so a
    nail moves exactly as the skin it sits on."""
    out = np.zeros((len(Q), W.shape[1]))
    for i, q in enumerate(Q):
        d = np.linalg.norm(P - q, axis=1)
        nn = np.argsort(d)[:k]
        w = 1.0 / np.maximum(d[nn], 1e-6)
        out[i] = (W[nn] * w[:, None]).sum(0) / w.sum()
    idx = np.argsort(-out, axis=1)
    for c in range(4, out.shape[1]):
        out[np.arange(len(out)), idx[:, c]] = 0.0
    out[out < 0.01] = 0.0
    out /= out.sum(1, keepdims=True)
    return {b: out[:, j] for j, b in enumerate(BONES) if out[:, j].any()}


def trim_inside_sleeve(P, faces, W, x_cut=-0.0420):
    """The skin hidden inside the sleeve goes (every face whose vertices all lie beyond x_cut)."""
    keepf = [f for f in faces if max(P[list(f), 0]) > x_cut]
    used = sorted({i for f in keepf for i in f})
    remap = {o: n for n, o in enumerate(used)}
    return P[used], [[remap[i] for i in f] for f in keepf], W[used]


def build_hand():
    M = make_materials()
    skin = build_skin()
    arm = build_armature()
    Vb, faces = mesh_arrays(skin)
    P = b2h(Vb)
    W0 = skin_weights(skin, arm)
    W, info = clean_weights(P, faces, W0)
    log(f"weights checked: {info}")
    extras = rig_extras(P, W)
    P, faces, W = trim_inside_sleeve(P, faces, W)
    bpy.data.objects.remove(skin, do_unlink=True)
    parts = [part_object("skin", P, faces, M["skin"], {b: W[:, i] for i, b in enumerate(BONES)})]
    normals = [sdf_normals(P)]
    for dg in DIGITS:
        Vn, Fn = build_nail(dg)
        parts.append(part_object(f"nail_{dg}", Vn, Fn, M["nail"], weights_like_skin(Vn, P, W)))
        normals.append(None)
    Vs, Fs, end_ring = build_sleeve()
    ring = np.abs(Vs[:, 0] + 0.0700) < 1e-4
    # (the open end's section, a vertex round it in order: the view carries the sleeve on from it up the arm, web/hands.js)
    extras["hand"]["sleeve"].update({"end_section_x": -0.0700, "half_width": round(float(np.abs(Vs[ring, 2] - Vs[ring, 2].mean()).max()), 4),
                                     "back": round(float(Vs[ring, 1].max()), 4), "front": round(float(-Vs[ring, 1].min()), 4),
                                     "open": True, "ring": [list(p) for p in end_ring]})
    parts.append(part_object("sleeve", Vs, Fs, M["sleeve"], {"forearm": np.ones(len(Vs))}))
    normals.append(None)
    # one mesh, three materials (glTF: one primitive each), smooth; the skin's normals the field's own
    deselect_all()
    for o in parts:
        o.select_set(True)
        for poly in o.data.polygons:
            poly.use_smooth = True
    counts = [len(o.data.vertices) for o in parts]  # (the joined mesh keeps the active object's, the skin's, vertices first)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    hand = bpy.context.view_layer.objects.active
    hand.name = "hand_mesh"
    hand.data.name = "hand_mesh"
    me = hand.data
    vn = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("normal", vn)
    vn = vn.reshape(-1, 3)
    o = 0
    for c, nrm in zip(counts, normals):
        if nrm is not None:
            vn[o:o + c] = h2b(nrm)
        o += c
    me.normals_split_custom_set_from_vertices([tuple(v) for v in vn])
    hand.parent = arm
    mod = hand.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mod.use_deform_preserve_volume = False  # (linear blend skinning, as three.js draws it)
    return hand, arm, info, extras


def sdf_normals(P):
    g = sdf_grad(P)
    return g / np.linalg.norm(g, axis=1)[:, None]


# ------------------------------------------------------------------------------------------------ glTF: export, the joints' frames, the check
def export_glb(hand, arm, path):
    deselect_all()
    hand.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    os.makedirs(os.path.dirname(path), exist_ok=True)
    r = bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False, export_texcoords=False,
        export_normals=True, export_tangents=False, export_materials="EXPORT", export_vertex_color="NONE", export_attributes=False,
        export_cameras=False, export_lights=False, export_extras=False, export_skins=True, export_influence_nb=4,
        export_all_influences=False, export_def_bones=True, export_leaf_bone=False, export_animations=False, export_morph=False,
        export_rest_position_armature=True, export_armature_object_remove=False, export_hierarchy_flatten_bones=False,
        export_draco_mesh_compression_enable=False, export_copyright="")
    log(f"glTF export {r}")


def read_glb(path):
    import json
    import struct
    b = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<III", b, 0)
    assert magic == 0x46546C67 and ver == 2
    off = 12
    J = BIN = None
    while off < length:
        n, t = struct.unpack_from("<II", b, off)
        off += 8
        if t == 0x4E4F534A:
            J = json.loads(b[off:off + n].decode("utf-8"))
        elif t == 0x004E4942:
            BIN = bytearray(b[off:off + n])
        off += n
    return J, BIN


def write_glb(path, J, BIN):
    import json
    import struct
    js = json.dumps(J, separators=(",", ":"), sort_keys=False).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    BIN = bytes(BIN) + b"\0" * ((4 - len(BIN) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(BIN)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(BIN), 0x004E4942) + BIN)


def node_local(n):
    if "matrix" in n:
        return np.array(n["matrix"], dtype=float).reshape(4, 4).T
    t = n.get("translation", [0, 0, 0])
    q = n.get("rotation", [0, 0, 0, 1])
    sc = n.get("scale", [1, 1, 1])
    from mathutils import Quaternion
    R = np.array(Quaternion((q[3], q[0], q[1], q[2])).to_matrix())
    M = np.eye(4)
    M[:3, :3] = R * np.array(sc)[None, :]
    M[:3, 3] = t
    return M


def node_worlds(J):
    nodes = J["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    memo = {}

    def world(i):
        if i not in memo:
            p = parent.get(i)
            memo[i] = (world(p) if p is not None else np.eye(4)) @ node_local(nodes[i])
        return memo[i]
    return [world(i) for i in range(len(nodes))], parent


def reframe_glb(path, extras=None):
    """Write every joint's rest frame as the contract wants it (x along the bone, y the back of the hand, z = x cross y; Blender's bones have
    y along them) and the inverse bind matrices to match: the skin's rest shape is unchanged. `extras`: {bone: {...}, "hand": {...}} written as
    the nodes' extras (three.js: each bone's userData, the root's for "hand")."""
    import struct
    from mathutils import Matrix as Mx
    J, BIN = read_glb(path)
    nodes = J["nodes"]
    worlds, parent = node_worlds(J)
    skin = J["skins"][0]
    joints = skin["joints"]
    names = [nodes[j]["name"] for j in joints]
    assert sorted(names) == sorted(BONES), names
    R = rig_bones()
    F = {bn: joint_frame(bn, R) for bn in BONES}
    mesh_nodes = [i for i, n in enumerate(nodes) if n.get("skin") == 0]
    Gm = worlds[mesh_nodes[0]]
    jset = set(joints)
    for j in joints:
        n = nodes[j]
        p = parent.get(j)
        Pw = F[nodes[p]["name"]] if p in jset else (worlds[p] if p is not None else np.eye(4))
        L = np.linalg.inv(Pw) @ F[n["name"]]
        loc, rot, sca = Mx([list(r) for r in L]).decompose()
        for k in ("matrix", "scale"):
            n.pop(k, None)
        n["translation"] = [round(float(v), 7) for v in loc]
        n["rotation"] = [round(float(v), 7) for v in (rot.x, rot.y, rot.z, rot.w)]
        if all(abs(v) < 5e-8 for v in n["translation"]):
            n.pop("translation")
        if abs(n["rotation"][3]) > 1 - 1e-12 and all(abs(v) < 5e-8 for v in n["rotation"][:3]):
            n.pop("rotation")
    # the inverse bind matrices, from the rounded frames as a reader computes them
    worlds2, _ = node_worlds(J)
    acc = J["accessors"][skin["inverseBindMatrices"]]
    bv = J["bufferViews"][acc["bufferView"]]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    for k, j in enumerate(joints):
        ibm = np.linalg.inv(worlds2[j]) @ Gm
        struct.pack_into("<16f", BIN, off + 64 * k, *[float(v) for v in ibm.T.ravel()])
    if extras:
        for i, n in enumerate(nodes):
            if n.get("name") in extras and (i in jset or n.get("name") == "hand"):
                n["extras"] = extras[n["name"]]
    J["asset"]["generator"] = "tools/hands/build_hand.py (Blender glTF I/O, joint frames per web/CONTRACT.md Hands)"
    write_glb(path, J, BIN)


def glb_report(path):
    """What the file holds: bones, materials, triangles, vertices, size, and checks of the contract."""
    import struct
    J, BIN = read_glb(path)
    nodes = J["nodes"]
    worlds, parent = node_worlds(J)
    skin = J["skins"][0]
    joints = skin["joints"]
    tris = 0
    verts = 0
    prims = []
    for m in J["meshes"]:
        for pr in m["primitives"]:
            ia = J["accessors"][pr["indices"]]
            tris += ia["count"] // 3
            pa = J["accessors"][pr["attributes"]["POSITION"]]
            verts += pa["count"]
            prims.append((J["materials"][pr["material"]]["name"], ia["count"] // 3, pa["count"], pa["min"], pa["max"],
                          sorted(pr["attributes"].keys())))
    acc = J["accessors"][skin["inverseBindMatrices"]]
    bv = J["bufferViews"][acc["bufferView"]]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    mesh_nodes = [i for i, n in enumerate(nodes) if n.get("skin") == 0]
    Gm = worlds[mesh_nodes[0]]
    err = 0.0
    frame_err = 0.0
    F = {bn: joint_frame(bn) for bn in BONES}
    for k, j in enumerate(joints):
        ibm = np.array(struct.unpack_from("<16f", BIN, off + 64 * k)).reshape(4, 4).T
        err = max(err, float(np.abs(worlds[j] @ ibm - Gm).max()))
        frame_err = max(frame_err, float(np.abs(worlds[j] - F[nodes[j]["name"]]).max()))
    hier = {nodes[j]["name"]: (nodes[parent[j]]["name"] if parent.get(j) in set(joints) else None) for j in joints}
    return dict(bones=[nodes[j]["name"] for j in joints], hierarchy=hier, materials=[m["name"] for m in J["materials"]], triangles=tris,
                vertices=verts, primitives=prims, bytes=os.path.getsize(path), bind_error=err, frame_error=frame_err,
                extensions=J.get("extensionsUsed", []))


# ------------------------------------------------------------------------------------------------ preview renders
def look_material(name, hex_rgb, rough=0.55):
    """A plain Principled material (the glTF exporter writes its colour and roughness; metallic 0, default specular: no extensions)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    c = srgb_hex(hex_rgb)
    b.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    m.diffuse_color = (c[0], c[1], c[2], 1.0)
    return m


def srgb_hex(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def setup_render(res=(640, 480)):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "None"
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.60, 0.64, 0.68, 1.0)
    bg.inputs[1].default_value = 0.45
    cam = bpy.data.objects.get("cam")
    if not cam:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
    cam.data.lens = 85
    cam.data.clip_start = 0.01
    sc.camera = cam
    # the lights ride with the camera (every view lit alike): a soft key above and to the left, a fill from the right, a rim from behind
    for nm, loc, energy, size in (("key", (-0.30, 0.34, 0.18), 7.0, 0.30), ("fill", (0.40, -0.10, 0.10), 2.6, 0.50),
                                  ("rim", (0.10, 0.25, -0.75), 1.6, 0.25)):
        o = bpy.data.objects.get(nm)
        if not o:
            L = bpy.data.lights.new(nm, "AREA")
            L.energy = energy
            L.size = size
            o = bpy.data.objects.new(nm, L)
            sc.collection.objects.link(o)
        o["cam_offset"] = loc
    return cam


def aim(cam, direction, target=(0.042, 0.0, 0.0), dist=0.56, up=(0.0, 0.0, 1.0)):
    """The camera dist from target along direction, looking at it (image up toward `up`); the lights placed round it."""
    t = Vector(target)
    eye = t + Vector(direction).normalized() * dist
    f = (t - eye).normalized()
    right = f.cross(Vector(up)).normalized()
    upv = right.cross(f)
    R = Matrix((right, upv, -f)).transposed()
    cam.location = eye
    cam.rotation_euler = R.to_euler()
    for nm in ("key", "fill", "rim"):
        o = bpy.data.objects[nm]
        off = Vector(o["cam_offset"])
        # (camera space: x right, y up, -z ahead)
        p = eye + R @ Vector((off.x, off.y, -dist * 0.5 + off.z))
        o.location = p
        o.rotation_euler = (t - p).to_track_quat("-Z", "Y").to_euler()


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# views in Blender's frame (the hand lies palm down, fingers +x, thumb toward -y): name, direction from the hand to the camera
VIEWS = {
    "back": ((0.0, -0.08, 1.0), (0.0, 1.0, 0.0)),
    "palm": ((0.0, 0.08, -1.0), (0.0, -1.0, 0.0)),
    "thumb": ((0.05, -1.0, 0.18), (0.0, 0.0, 1.0)),
    "pinky": ((-0.05, 1.0, 0.15), (0.0, 0.0, 1.0)),
    "three_q": ((0.85, -0.75, 0.75), (0.0, 0.0, 1.0)),
    "front": ((1.0, -0.15, 0.25), (0.0, 0.0, 1.0)),
}


def preview(ob, outdir):
    os.makedirs(outdir, exist_ok=True)
    cam = setup_render((800, 600))
    ob.data.materials.clear()
    ob.data.materials.append(look_material("skin_look", "#c69273", 0.55))
    for p in ob.data.polygons:
        p.use_smooth = True
    for name, (direction, up) in VIEWS.items():
        aim(cam, direction, target=(0.052, 0.0, 0.0), dist=0.36, up=up)
        render_to(os.path.join(outdir, f"{name}.png"))
    log("preview written to", outdir)


# ------------------------------------------------------------------------------------------------ the proof: poses, turntables, weights
# Test poses in the contract's terms: bone -> (flex, spread, twist) degrees, applied in the bone's rest frame as Ry(-spread) Rz(-flex) Rx(twist)
# (flex toward the palm, spread toward the thumb, twist about the bone). Not the view's poses: only to see the mesh bend.
def fingers_all(m, p, d, spread=(0, 0, 0, 0)):
    return {f"{f}_{k}": ((m, p, d)[k - 1], spread[i] if k == 1 else 0.0, 0.0) for i, f in enumerate(FINGER_NAMES) for k in (1, 2, 3)}


def pose_set(base, **over):
    P = dict(base)
    for k, v in over.items():
        P[k] = v
    return P


def rot_c(flex, spread, twist):
    """The contract's pose rotation (numpy 3 x 3): Ry(-spread) Rz(-flex) Rx(twist), degrees."""
    def R(ax, a):
        c, s_ = math.cos(a * D2R), math.sin(a * D2R)
        if ax == "x":
            return np.array([[1, 0, 0], [0, c, -s_], [0, s_, c]])
        if ax == "y":
            return np.array([[c, 0, s_], [0, 1, 0], [-s_, 0, c]])
        return np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]])
    return R("y", -spread) @ R("z", -flex) @ R("x", twist)


def fk(pose):
    """Every bone's world frame (H, 4 x 4) for a pose: world = parent world x rest local x the pose's rotation (the glTF joints' way)."""
    R = rig_bones()
    M = {b: joint_frame(b, R) for b in BONES}
    out = {}
    for b in BONES:  # (parents come first)
        par = R[b][2]
        L = M[b] if par is None else np.linalg.inv(M[par]) @ M[b]
        Q = np.eye(4)
        Q[:3, :3] = rot_c(*pose.get(b, (0.0, 0.0, 0.0)))
        out[b] = (out[par] if par else np.eye(4)) @ L @ Q
    return out


def pad_point(Wf, dg, k=3, at=None, side=-1.0):
    """A point on a digit's bone surface (its pad: side -1, its back: +1) at fraction `at` along bone k, and that side's normal."""
    if dg == "thumb":
        pts, dirs = thumb_points()
        w, ky = THUMB["w"], THUMB["ky"]
    else:
        pts, _ = finger_points(dg)
        w, ky = FINGERS[dg]["w"], FINGERS[dg]["ky"]
    L = float(np.linalg.norm(pts[k] - pts[k - 1]))
    at = (1.0 - 0.6 * w[3] / L) if at is None else at
    r = w[k - 1] + (w[k] - w[k - 1]) * at
    M = Wf[f"{dg}_{k}"]
    q = M @ np.array([at * L, side * r * ky * 1.02, 0.0, 1.0])
    return q[:3], M[:3, 1] * side


def solve_pose(pose, free, residual, iters=40):
    """A test pose's free angles (bone, index) adjusted (Levenberg-Marquardt, numeric Jacobian) so residual(fk) is small, staying near the start
    (the thumb's base twist held closest: turned far, its web creases against the index's knuckle)."""
    P = {b: list(v) for b, v in pose.items()}
    x0 = np.array([P[b][i] for b, i in free], dtype=float)
    x = x0.copy()
    stiff = np.array([20.0 if (b, i) == ("thumb_1", 2) else 60.0 for b, i in free])

    def res(x):
        for (b, i), v in zip(free, x):
            P[b][i] = v
        Wf = fk({b: tuple(v) for b, v in P.items()})
        return np.concatenate([residual(Wf), (x - x0) / stiff])

    lam = 1e-2
    r = res(x)
    for _ in range(iters):
        J = np.zeros((len(r), len(x)))
        for j in range(len(x)):
            dx = np.zeros_like(x)
            dx[j] = 0.25
            J[:, j] = (res(x + dx) - r) / 0.25
        step = np.linalg.solve(J.T @ J + lam * np.eye(len(x)), -J.T @ r)
        r2 = res(x + step)
        if (r2 ** 2).sum() < (r ** 2).sum():
            x, r, lam = x + step, r2, lam * 0.5
        else:
            lam *= 4.0
    res(x)
    return {b: tuple(round(float(a), 2) for a in v) for b, v in P.items()}


def touch(a, b, scale=0.001):
    """Residual: pad a on surface b (both (point, normal)), the normals opposed."""
    return np.concatenate([(a[0] - b[0]) / scale, [(np.dot(a[1], b[1]) + 1.0) * 2.0]])


CURL = fingers_all(84, 100, 58, spread=(-2, 0, 2, 5))


def test_poses():
    P = {"rest": {}}
    P["relaxed"] = pose_set({**{f"{f}_1": (10 + 4 * i, 0, 0) for i, f in enumerate(FINGER_NAMES)},
                             **{f"{f}_2": (16 + 5 * i, 0, 0) for i, f in enumerate(FINGER_NAMES)},
                             **{f"{f}_3": (8 + 3 * i, 0, 0) for i, f in enumerate(FINGER_NAMES)}},
                            thumb_1=(8, 0, 0), thumb_2=(10, 0, 0), thumb_3=(8, 0, 0))
    thumb_free = [("thumb_1", 0), ("thumb_1", 1), ("thumb_1", 2), ("thumb_2", 0), ("thumb_3", 0)]
    # point: the index straight, the others curled, the thumb's pad on the middle finger's middle bone
    pt = pose_set(CURL, index_1=(4, 0, 0), index_2=(4, 0, 0), index_3=(2, 0, 0), thumb_1=(36, -10, 30), thumb_2=(30, 0, 0), thumb_3=(20, 0, 0))
    P["point"] = solve_pose(pt, thumb_free, lambda Wf: touch(pad_point(Wf, "thumb"), pad_point(Wf, "middle", 2, 0.45, side=1.0)))
    # fist: every finger curled, the thumb across the index's and the middle finger's middle bones
    fi = pose_set(CURL, thumb_1=(40, -10, 30), thumb_2=(34, 0, 0), thumb_3=(22, 0, 0))
    P["fist"] = solve_pose(fi, thumb_free, lambda Wf: touch(pad_point(Wf, "thumb", 3, 0.55), pad_point(Wf, "index", 2, 0.5, side=1.0)))
    P["flat press"] = pose_set(fingers_all(-6, 0, -4, spread=(1, 0, -1, -2)), thumb_1=(-6, 6, 0), thumb_2=(-4, 0, 0), thumb_3=(-2, 0, 0))
    # pinch: the thumb's and the index's pads meet
    pi = pose_set(fingers_all(40, 62, 34, spread=(0, 0, 2, 5)), index_1=(36, 2, 0), index_2=(44, 0, 0), index_3=(20, 0, 0),
                  thumb_1=(30, -12, 30), thumb_2=(16, 0, 0), thumb_3=(12, 0, 0))
    P["pinch"] = solve_pose(pi, thumb_free + [("index_1", 0), ("index_2", 0)],
                            lambda Wf: touch(pad_point(Wf, "thumb"), pad_point(Wf, "index")))
    P["cup"] = pose_set(fingers_all(22, 30, 16, spread=(-2, 0, 1, 3)), thumb_1=(22, -6, 16), thumb_2=(10, 0, 0), thumb_3=(6, 0, 0))
    # the wrist: bent back 70 degrees (a flat hand pushing, its fingers up) and bent down 55 (a relaxed hand hanging)
    P["push"] = pose_set(fingers_all(-4, 2, 0, spread=(2, 0, -2, -4)), wrist=(-70, 0, 0), thumb_1=(-4, 8, 0), thumb_2=(0, 0, 0),
                         thumb_3=(0, 0, 0))
    P["wrist down"] = pose_set(P["relaxed"], wrist=(55, 0, 0))
    return P


def pose_centre(pose):
    """Where a posed hand is (Blender's frame): the middle of its palm, knuckles and fingers."""
    Wf = fk(pose)
    pts = [Wf[b][:3, 3] for b in ("palm", "index_2", "middle_2", "pinky_2", "thumb_2", "middle_3")]
    c = np.mean(pts, axis=0)
    return tuple(h2b(c[None])[0])


def pose_reach(pose):
    """How far the posed hand (joints, fingertips and the cuff) reaches from pose_centre: a camera distance that frames it."""
    Wf = fk(pose)
    pts = [Wf[b][:3, 3] for b in BONES] + [(Wf[f"{dg}_3"] @ np.array([digit_tip(dg)[3], 0, 0, 1.0]))[:3] for dg in DIGITS]
    pts.append(np.array([SLEEVE_OPEN, 0.0, 0.0]))
    c = b2h(np.array([pose_centre(pose)]))[0]
    return float(max(np.linalg.norm(p - c) for p in pts))


# the contract's bone frame (x along, y back, z) in Blender's bone frame (y along, z back, x): v_contract = P v_blender
P_CB = Matrix(((0, 1, 0), (0, 0, 1), (1, 0, 0)))


def contract_rotation(flex, spread, twist):
    return (Matrix.Rotation(-spread * D2R, 3, "Y") @ Matrix.Rotation(-flex * D2R, 3, "Z") @ Matrix.Rotation(twist * D2R, 3, "X"))


def apply_test_pose(arm, pose):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        f, s_, t = pose.get(pb.name, (0.0, 0.0, 0.0))
        Rb = P_CB.transposed() @ contract_rotation(f, s_, t) @ P_CB
        pb.rotation_quaternion = Rb.to_quaternion()
    bpy.context.view_layer.update()


def label(text, cam, res):
    """A small dark caption in the picture's top left corner (a text object riding with the camera)."""
    ob = bpy.data.objects.get("caption")
    if not ob:
        cu = bpy.data.curves.new("caption", "FONT")
        ob = bpy.data.objects.new("caption", cu)
        bpy.context.scene.collection.objects.link(ob)
        m = bpy.data.materials.new("caption")
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type != "OUTPUT_MATERIAL":
                nt.nodes.remove(n)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs[0].default_value = (0.02, 0.02, 0.025, 1)
        nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs[0])
        cu.materials.append(m)
        ob.parent = cam
    ob.data.body = text
    z = 0.1
    hw = z * 18.0 / cam.data.lens
    hh = hw * res[1] / res[0]
    ob.data.size = hh * 0.11
    ob.location = (-hw * 0.95, hh * 0.80, -z)
    ob.rotation_euler = (0, 0, 0)


def save_sheet(tiles, cols, path, tw, th):
    rows = (len(tiles) + cols - 1) // cols
    S = np.ones((rows * th, cols * tw, 4), dtype=np.float32)
    for i, t in enumerate(tiles):
        im = bpy.data.images.load(t)
        a = np.array(im.pixels[:], dtype=np.float32).reshape(th, tw, 4)
        r, c = i // cols, i % cols
        # (Blender's pixels run bottom-up: the first row of tiles goes at the top)
        S[(rows - 1 - r) * th:(rows - r) * th, c * tw:(c + 1) * tw] = a
        bpy.data.images.remove(im)
    img = bpy.data.images.new("sheet", cols * tw, rows * th, alpha=True)
    img.pixels.foreach_set(S.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


TURN = [(f"{a} deg", (math.cos(a * D2R), math.sin(a * D2R), 0.42), (0, 0, 1)) for a in (-120, -60, 0, 60, 120, 180)]


def proof(hand, arm, outdir):
    os.makedirs(outdir, exist_ok=True)
    tiles_dir = os.path.join(outdir, "tiles")
    os.makedirs(tiles_dir, exist_ok=True)
    tw, th = 400, 300
    cam = setup_render((tw, th))
    bpy.context.scene.eevee.taa_render_samples = 32
    views = TURN + [("palm", (0.0, 0.08, -1.0), (0.0, -1.0, 0.0))]
    tiles = []
    TEST_POSES = test_poses()
    log('test poses ' + str({k: v.get('thumb_1') for k, v in TEST_POSES.items()}))
    for pname, pose in TEST_POSES.items():
        apply_test_pose(arm, pose)
        tgt = pose_centre(pose)
        dist = float(np.clip(5.0 * pose_reach(pose), 0.40, 0.62))
        for vname, direction, up in views:
            aim(cam, direction, target=tgt, dist=dist, up=up)
            label(f"{pname} / {vname}", cam, (tw, th))
            f = os.path.join(tiles_dir, f"{pname.replace(' ', '_')}_{vname.replace(' ', '')}.png")
            render_to(f)
            tiles.append(f)
    save_sheet(tiles, len(views), os.path.join(outdir, "contact_sheet.png"), tw, th)
    # close-ups: the rest pose and the test poses from the three-quarter view, larger
    hw, hh = 800, 600
    setup_render((hw, hh))
    big = []
    for pname in TEST_POSES:
        apply_test_pose(arm, TEST_POSES[pname])
        aim(cam, (0.80, -0.70, 0.62), target=pose_centre(TEST_POSES[pname]), dist=float(np.clip(4.6 * pose_reach(TEST_POSES[pname]), 0.38, 0.6)))
        label(pname, cam, (hw, hh))
        f = os.path.join(tiles_dir, f"close_{pname.replace(' ', '_')}.png")
        render_to(f)
        big.append(f)
    save_sheet(big, 3, os.path.join(outdir, "close_ups.png"), hw, hh)
    # the poses and Blender's own deformation of every vertex under them (H, metres): what a glTF reader must reproduce
    import json
    dump = {"poses": TEST_POSES, "vertices": {}}
    for pname in ("rest", "pinch", "fist", "push"):
        apply_test_pose(arm, TEST_POSES[pname])
        dg = bpy.context.evaluated_depsgraph_get()
        ev = hand.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", co)
        ev.to_mesh_clear()
        dump["vertices"][pname] = [round(float(v), 7) for v in b2h(co.reshape(-1, 3)).ravel()]
    with open(os.path.join(outdir, "blender_poses.json"), "w") as f:
        json.dump(dump, f)
    # the weights: each vertex in its strongest bone's colour (back and palm), rest pose and fist
    weights_view(hand, arm, outdir, tiles_dir, TEST_POSES)
    apply_test_pose(arm, {})
    log("proof written to", outdir)


BONE_COLOURS = {"forearm": "#8a8a8a", "wrist": "#b0a060", "palm": "#e8d8b0", "thumb_1": "#c03030", "thumb_2": "#e06050", "thumb_3": "#ffa090",
                "index_1": "#2050c0", "index_2": "#5080e0", "index_3": "#a0c0ff", "middle_1": "#20a040", "middle_2": "#50d070",
                "middle_3": "#b0f0b0", "ring_1": "#a030b0", "ring_2": "#d060e0", "ring_3": "#f0b0ff", "pinky_1": "#c08000",
                "pinky_2": "#e8b030", "pinky_3": "#ffe090"}


def weights_view(hand, arm, outdir, tiles_dir, TEST_POSES):
    me = hand.data
    names = {g.index: g.name for g in hand.vertex_groups}
    col = np.zeros((len(me.vertices), 4), dtype=np.float32)
    for v in me.vertices:
        acc = np.zeros(3)
        for g in v.groups:
            c = srgb_hex(BONE_COLOURS[names[g.group]])
            acc += np.array(c) * g.weight
        col[v.index, :3] = acc
        col[v.index, 3] = 1
    attr = me.color_attributes.get("bones") or me.color_attributes.new("bones", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", col.ravel())
    m = bpy.data.materials.get("weights_view") or bpy.data.materials.new("weights_view")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "bones"
    nt.links.new(at.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.7
    keep = [s.material for s in hand.material_slots]
    for s in hand.material_slots:
        s.material = m
    tw, th = 400, 300
    cam = setup_render((tw, th))
    tiles = []
    for pname in ("rest", "fist", "pinch"):
        apply_test_pose(arm, TEST_POSES[pname])
        for vname, direction, up in (("back", (0.0, -0.08, 1.0), (0.0, 1.0, 0.0)), ("palm", (0.0, 0.08, -1.0), (0.0, -1.0, 0.0)),
                                     ("thumb side", (0.3, -1.0, 0.35), (0, 0, 1)), ("little finger side", (0.2, 1.0, 0.35), (0, 0, 1))):
            aim(cam, direction, target=(0.040, 0.0, 0.0), dist=0.50, up=up)
            label(f"weights: {pname} / {vname}", cam, (tw, th))
            f = os.path.join(tiles_dir, f"weights_{pname}_{vname.replace(' ', '_')}.png")
            render_to(f)
            tiles.append(f)
    save_sheet(tiles, 4, os.path.join(outdir, "weights.png"), tw, th)
    for s, mat in zip(hand.material_slots, keep):
        s.material = mat
    me.color_attributes.remove(me.color_attributes["bones"])


# ------------------------------------------------------------------------------------------------ main
def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def main():
    clear_scene()
    if PREVIEW:
        skin = build_skin()
        preview(skin, PREVIEW)
        return
    hand, arm, info, extras = build_hand()
    export_glb(hand, arm, OUT)
    reframe_glb(OUT, extras)
    rep = glb_report(OUT)
    rep["weights"] = info
    rep["measures"] = extras["hand"]
    import json
    log("REPORT " + json.dumps({k: v for k, v in rep.items() if k != "primitives"}))
    for pr in rep["primitives"]:
        log("primitive", pr)
    if PROOF:
        proof(hand, arm, PROOF)


main()
