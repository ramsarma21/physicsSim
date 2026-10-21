"""Phase 2 of the catalog: springs, ropes, pulleys, wheels and vehicles, motors and belts.

items.py calls register_all(globals()) once at import time, after catalog_items.py, so everything here is built from
items.py's own framework (ItemType, Prop, MATERIALS, Ctx.slab/ball) plus c.joint(...) (web/CONTRACT.md, "Phase 2").

A spring is the engine's Hooke spring between two anchors (built with the stiffness and damping its props say: the engine holds any), a rope a rope
joint (a chain's collides), a pulley a rope over two wheels that only pulls, its ends jamming at the wheels (minLengthA/B), a hinge a revolute pin (with a
motor, limits and friction if it has them), a wheel a sprung axle (frequency 0 = rigid). Parts that are held
square by guide rails (a launcher's plate, a bumper's plate) slide between them with a few mm to spare.
Every number says where it comes from; a guess says "provisional". A fixed item (the "Fixed" tick) just stands: no joints.
A car, truck, cart or skateboard body is a few convex polygons welded together (a car: a lower body and a cab, at about 1:19 with real wheels, overhangs and a low roof;
a flatbed: a 35 mm frame-and-deck slab, the cab on it and two blocks of the cab's lower front either side of the front wheel, open underneath; a wagon: a thin plank bed
over the wheels; a skateboard: a deck, two kicktails and two trucks), so its side outline, centre of mass and weight (the body_mass prop, split by area x depth) are
those of the real shape; web/models/vehicles*.js draw them. A pinball flipper is a 24 mm tall bat of 40 g on a 12 mm pivot post.
"""
import math

from crmath import cos, cr_pow, cube, sin, sq  # powers correctly rounded, sin/cos at multiples of 30 degrees from web/sim's table (crmath.py): the same bits as web/sim on any machine

FLIPPER_MASS = 0.04     # kg: a pinball flipper bat with its shaft (about 40 g; provisional)
MOTOR_BACK = 0.066      # m: how far behind a motor spinner's paddle its gear motor reaches (a 6 mm coupling, a 22 mm gearbox, a 32 mm can and its 6 mm end cap)
SCREW_EYE = 0.003       # m: how far below a hanger's underside the ring of its brass screw eye is centred (the rope or spring is made fast there)
NEEDED = ("register", "ItemType", "Prop", "MATERIALS", "add_look", "LOOK_FILL", "LOOK_SHADE", "D2R", "CATEGORIES")
G = 9.81


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    for cat in ("Springs & ropes", "Wheels & vehicles", "Motors & belts"):
        if cat not in CATEGORIES:
            CATEGORIES.append(cat)
    _looks()
    _materials()
    _springs()
    _ropes()
    _pulleys()
    _vehicles()
    _wheels()
    _motors()


# ---------------------------------------------------------------- helpers
def _has(*names):
    """The materials of these names that exist (another builder's materials may be missing)."""
    return [n for n in names if n in MATERIALS]


def _wood(c):
    return c.mat(base="varnished hardwood", overrides={})


def _weight_material():
    return "steel weight" if "steel weight" in MATERIALS else "steel"


def _steel(c):
    return c.mat(base="steel", overrides={})


def _hanger(c, width=0.08, y=0.006, steel=False):
    """A small static bracket whose underside is the item's origin: what a spring or rope hangs from (a wooden block; `steel`: a steel beam)."""
    if steel:
        return c.slab("hanger", width, 0.012, 0.04, 0, y, kind="static", words="a steel beam", look="steel", material=_steel(c))
    return c.slab("hanger", width, 0.012, 0.04, 0, y, kind="static", words="a small wooden hanger", look="wood", material=_wood(c))


def _joint(c, kind, part, **fields):
    """A fixed (static) item has nothing to join."""
    if c.kind == "dynamic":
        c.joint(kind, part, **fields)


SPRING_STEEL = 7850.0       # kg/m³: spring steel (music wire, ASTM A228)
SPRING_SHEAR = 79.3e9       # Pa: its shear modulus G
SPRING_STRESS = 1.0e9       # Pa: the most shear stress a coil spring takes without a set when pressed or stretched as far as it ever goes: 45 % of its tensile
                            # strength (Shigley's Mechanical Engineering Design, table 10-6, music wire, set not removed), S_ut = A/d^m = 2.2 GPa for 1 mm
                            # music wire (A 2211 MPa·mm^0.145, table 10-4); a spring sized for its item's farthest deflection is sized to that


def _spring_mass(k, travel):
    """kg: how much steel a coil spring of stiffness k (N/m) needs to take `travel` (m) of deflection without a set (SPRING_STRESS). Taken that far it
    stores ½k·travel², and the twisted wire of a helical spring holds at most τ²/(4G) of energy per cubic metre (a round wire in torsion; the curvature of
    the coils and the dead end turns only add steel), so m = ρ·4G·(½k·travel²)/τ²: 2.5 g a joule (a documented estimate, after Shigley's Mechanical
    Engineering Design, ch. 10). The default launcher's two 400 N/m springs, which can be pressed 11.6 cm, weigh 6.7 g each; one of 2500 N/m for 45 cm, 0.63 kg: it
    stores 250 J, which no thin wire could. The engine moves the spring's fundamental-mode share of it with what the spring pushes (Rayleigh's third for a light
    spring) and half its weight, so a light plate on a strong spring is no longer thrown as if the spring weighed nothing (a 5000 N/m launcher pressed 45 cm
    threw a ping-pong ball at about 200 m/s). A spring is sized for the most its item can ever deflect it, whatever the item is set to (_spring_cap)."""
    return SPRING_STEEL * 4 * SPRING_SHEAR * (0.5 * k * travel * travel) / (SPRING_STRESS * SPRING_STRESS)


def _spring(c, part, a, b, anchor_a, anchor_b, rest, k, damping, compress_only=False, radius=0.012, coils=None, travel=0.0, **extra):
    """A spring joint of stiffness k. travel (m): the most the item can ever deflect it, at any setting of its props but the spring's own (stiffness, length):
    to its closed coils, or the farthest it is stretched; its mass (`mass`, kg) is the steel that takes that (_spring_mass)."""
    fields = dict(a=a, b=b, anchorA=anchor_a, anchorB=anchor_b, rest=round(rest, 5), stiffness=round(k, 5), damping=round(damping, 5),
                  coils=coils or max(5, min(24, int(rest / 0.01))), coilRadius=radius, **extra)
    if compress_only:
        fields["compressOnly"] = True
    ms = round(_spring_mass(k, travel), 6)
    if ms > 0:
        fields["mass"] = ms
    _joint(c, "spring", part, **fields)


def _child(c, part, parent, w, h, d, dx, dy, material, words, look, langle=0.0):
    """A slab welded to another part of this item: dx, dy are in the parent's frame (as build_seesaw's lip)."""
    s = {"kind": c.kind, "id": f"{c.item['id']}/{part}", "words": words, "item": c.item["id"], "look": look,
         "body": {"kind": "slab", "width": round(w, 5), "height": round(h, 5), "depth": d}, "material": material,
         "at": {"x": round(dx, 5), "y": round(dy, 5)}, "parent": parent,
         "placeholder": {"fill": LOOK_FILL.get(look, "#c8955a")}, "render": {"kind": "procedural", "shade": LOOK_SHADE.get(look, "#8a6a45")}, "depth": 2}
    if langle:
        s["angle"] = round(langle * D2R, 6)
    c.sb.solids.append(s)
    return s["id"]


def _area(pts):
    """The area of a polygon [(x, y), ...] (shoelace)."""
    return abs(sum(pts[k][0] * pts[(k + 1) % len(pts)][1] - pts[(k + 1) % len(pts)][0] * pts[k][1] for k in range(len(pts)))) / 2


def _centroid_x(pts):
    """The x of a polygon's centroid (shoelace)."""
    a = cx = 0.0
    for k in range(len(pts)):
        x0, y0 = pts[k]
        x1, y1 = pts[(k + 1) % len(pts)]
        w = x0 * y1 - x1 * y0
        a += w
        cx += (x0 + x1) * w
    return cx / (3 * a) if a else 0.0


def _child_poly(c, part, parent, pts, depth, material, words, look=None, **extra):
    """A convex polygon welded to another part of this item. Its points are given in the PARENT's frame (the polygon's own origin is the parent's),
    so a car's greenhouse or a skateboard's kicktail is simply drawn where it sits on the body."""
    sid = c.poly(part, pts, depth, material=material, look=look, words=words, **extra)
    s = c.sb.solids[-1]
    s["parent"] = f"{c.item['id']}/{parent}" if "/" not in parent else parent
    s["at"] = {"x": 0.0, "y": 0.0}
    s.pop("angle", None)
    return sid


def _cube(mass, material):
    return cr_pow(mass / MATERIALS[material]["density"], 1 / 3)


def _gap(A, B):
    """How far apart two convex outlines (counter-clockwise [(x, y), ...]) are along the side normal that best separates them, m (negative: they overlap).
    Never more than their true distance."""
    best = -math.inf
    for P, Q in ((A, B), (B, A)):
        for i in range(len(P)):
            (x1, y1), (x2, y2) = P[i], P[(i + 1) % len(P)]
            m = math.hypot(x2 - x1, y2 - y1)
            nx, ny = (y2 - y1) / m, (x1 - x2) / m
            best = max(best, min((x - x1) * nx + (y - y1) * ny for x, y in Q))
    return best


def _gate_stop(L, th, arm, reach, solid, a):
    """How far (degrees, up to a > 0) a spring gate (build_gate) opens toward its post before its spring is closed solid or the plank comes within 3 mm of the post:
    turned from hanging straight in steps that can't jump past either (each no more than the smaller margin over the farthest point's distance from the hinge)."""
    post = [(reach, -arm - 0.03), (reach + 0.02, -arm - 0.03), (reach + 0.02, -arm + 0.03), (reach, -arm + 0.03)]
    ex, ey = th / 2 + 0.0026, -arm                    # the spring's eye, from the hinge
    R = math.hypot(L, th / 2)

    def margin(t):
        ct, st = cos(t), sin(t)
        gate = [(u * ct - v * st, u * st + v * ct) for u, v in ((-th / 2, -L), (th / 2, -L), (th / 2, 0.0), (-th / 2, 0.0))]
        return min(_gap(gate, post) - 0.003, math.hypot(ex * ct - ey * st - reach, ex * st + ey * ct + arm) - solid)
    t, end = 0.0, a * D2R
    for _ in range(400):
        g = margin(t)
        if g <= 2e-5:
            return t / D2R
        t += g / R
        if t >= end:
            return a
    return t / D2R


def _swing_stop(L, r, hook, w, a):
    """How far (radians, up to a >= 0) a bob of radius r, its centre L from the rope's tie `hook` under the middle of a hanger w wide (12 mm tall, its underside
    at the origin), swings from hanging straight before it comes within 3 mm of the hanger (turned in steps that can't jump past it, as _gate_stop)."""
    def margin(t):
        x, y = L * sin(t), -L * cos(t) - hook
        return math.hypot(max(-w / 2 - x, 0.0, x - w / 2), max(-y, 0.0, y - 0.012)) - r - 0.003
    t = 0.0
    for _ in range(400):
        g = margin(t)
        if g <= 2e-5:
            return t
        t += g / L
        if t >= a:
            return a
    return t


def _bisect(f, lo, hi, n=80):
    """The x in [lo, hi] where the increasing function f crosses 0."""
    for _ in range(n):
        mid = (lo + hi) / 2
        if f(mid) < 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


SPRING_SHARE = 0.3       # the most a spring's moving steel (a third of it, Rayleigh's) may be of what it throws (_spring_cap)
LIGHT_BALL = 0.0027       # kg: the lightest ball a plate throws (a ping-pong ball, 2.7 g)
HANG_RATED = 0.2          # kg: the weight a hanging spring's steel is sized for (the item's own default weight)


def _spring_cap(P, moved, n, fk, travel):
    """The stiffness a part's springs are built with: the stiffness prop, at most where the springs' own steel (n springs of fk × the prop each, every one
    sized for `travel`, _spring_mass) is still light against what they throw: a third of it (Rayleigh's share, which moves with the part) at most
    SPRING_SHARE of the part (`moved`, kg) and a light ball (LIGHT_BALL). There a lumped spring mass is true to a real spring: a launcher's throw is within
    2.5 % of a 400-node coil, its period within 0.6 % (research/rw-validate-p4.ts `mass`). Past it the spring's steel outweighs what it throws, and a real
    one throws slower than any lumped mass gives (its coil's release wave limits the throw to x0·√(k/mₛ): a 5000 N/m launcher on 50 cm springs, its 2.55 kg of
    steel against a 9 g plate, throws a ping-pong ball at 20 m/s, not 34). The engine follows any stiffness in its sub-steps (engine batch 2). A prop past the
    cap is built at the cap, which is written into P (so `resolved` shows what was built).
    -> the stiffness to build with."""
    per = n * _spring_mass(fk, travel) / 3
    if per <= 0:
        return P["stiffness"]
    k_max = math.floor(SPRING_SHARE * (moved + LIGHT_BALL) / per * 1000) / 1000
    k = min(P["stiffness"], k_max)
    if k < P["stiffness"]:
        P["stiffness"] = k
    return k


JAM_GAP = 0.002         # m: how far under its wheel's rim the end of a pulley's run stops (the rope's end jams in the pulley there; 2 mm, so the body's 1 mm contact
                        # skin stays clear of the wheel's solid disc and the round wheel never turns it over)
PIN_FRICTION = 0.3      # a steel pin turning in steel (a hinge's knuckles, a bolt through steel straps), dry: Coulomb friction 0.3 (provisional), its torque μ·r·load


def _jam_run(wx, R, x0, x1):
    """How short (m) a pulley's run may get when its body's flat top, from x0 to x1 across the run, is hauled straight up under a wheel centred at (wx, 0) (the
    item's frame: the axle's height is 0) with its rim R: its anchor is on that top, under the ground point at the axle's height, and the top stops JAM_GAP
    under the rim where it comes nearest it (the doc pulley's minLengthA/minLengthB: the engine's rope end jams there, whatever hauls it)."""
    hx = abs(wx - min(max(wx, x0), x1))
    return math.sqrt(max(0.0, sq(R + JAM_GAP) - hx * hx))


# ---------------------------------------------------------------- looks and materials
def _looks():
    add_look("tyre", fill="#2b2d31", shade="#1a1b1e", roughness=0.9, metalness=0.0, clearcoat=0.0)
    add_look("urethane", fill="#f2a900", shade="#c28500", roughness=0.35, metalness=0.0, clearcoat=0.4)
    add_look("trampoline", fill="#17181c", shade="#0e0f12", roughness=0.9, metalness=0.0, clearcoat=0.0)
    add_look("belt", fill="#4a4d52", shade="#34363a", roughness=0.9, metalness=0.0, clearcoat=0.0)


def _mat(key, **kw):
    kw.setdefault("rolling", 0.0)
    kw.setdefault("side", 0.0)
    MATERIALS[key] = kw


def _materials():
    # (density kg/m³, bounce = restitution against a rigid surface, Coulomb friction, rolling resistance, side spring-back)
    _mat("tyre rubber", density=1100, bounce=0.5, friction=0.8, rolling=0.012, look="tyre",
         source="Rubber about 1100 kg/m³; rubber on dry wood or concrete grips with a friction of 0.6-0.9; car tyres on a hard road roll with a "
                "resistance of 0.010-0.015 (handbook values). Bounce provisional.")
    _mat("bicycle tyre", density=1100, bounce=0.5, friction=0.8, rolling=0.005, look="tyre",
         source="Bicycle tyres on a smooth hard surface roll with a resistance of about 0.004-0.008 (road-tyre test values); friction and bounce provisional.")
    _mat("urethane", density=1200, bounce=0.6, friction=0.6, rolling=0.01, look="urethane",
         source="Polyurethane skateboard wheels, about 1200 kg/m³ (provisional); hard wheels on smooth wood or concrete roll with about 0.01 (provisional).")
    _mat("trampoline mat", density=400, bounce=0.4, friction=0.5, rolling=0.03, look="trampoline",
         source="A woven polypropylene mat; it gives under a ball, so the contact itself is dead and the springs do the bouncing. All values provisional.")
    _mat("conveyor belt", density=1200, bounce=0.5, friction=0.6, rolling=0.015, look="belt",
         source="PVC or rubber belting grips light packages with a friction of 0.3-0.6 (belt-maker values); a ball sinks in a little, so the rolling "
                "resistance is provisional.")


# ---------------------------------------------------------------- springs
def _sprung_plate(c, P, pad):
    """A plate on two springs over a base, held square by two guide rails: a launcher's (held compressed) or a pad's (resting). Either plate is bolted to its springs,
    which pull as well as push: a plate they throw up is pulled back down (on push-only springs a pad's plate flew up off its rails with the ball that hit it).
    The pad's plate is thin and light: a plate heavier than the ball takes the ball's bounce away."""
    W, rest, d, damp, th = P["width"], P["rest_length"], P["depth"], P["damping"], 0.004 if pad else 0.008
    cr = max(0.004, min(0.012, d / 2 - 0.0033))        # the coil's radius (picture only): 12 mm, narrower on a plate less than ~31 mm deep so it stays on its seat
    xs = max(W / 2 - 0.025, cr + 0.003)                # the springs stand 25 mm in from the plate's ends, but never closer to the middle than a coil and a 3 mm gap (a plate under ~76 mm wide)
    # held compressed at most until the coils close (the turns _spring draws, 2 mm wire, side by side plus the two seats), and a launcher never below 3 cm;
    # a pad's plate starts settled on its springs, or on its closed coils when they are too soft to hold it up
    solid = max(5, min(24, int(rest / 0.01))) * 0.002 + 0.004
    # its springs, each with the steel it needs (_spring_mass) for the most it is ever pressed: a pad's to its closed coils (a heavy ball can), a launcher's as far
    # as it can be held pressed (whatever it is held at: then it swings as far each way); the stiffness asked for while that steel is light against the plate (_spring_cap)
    travel = rest - solid if pad else rest - max(0.03, solid)
    mp = MATERIALS[P["material"]]["density"] * W * th * d
    k = _spring_cap(P, mp, 2, 0.5, travel)
    # (a pad's plate settles under its own weight and half of each spring's own weight, which it holds up)
    ms = round(_spring_mass(k / 2, travel), 6)
    comp = min((mp + ms) * G / k, rest - solid) if pad else min(P["compression"], rest - max(0.03, solid))
    wood, steel = _wood(c), _steel(c)
    c.slab("base", W + 0.05, 0.02, d, 0, -0.01, kind="static", words="the base block", look="wood", material=wood)
    c.slab("plate", W, th, d, 0, rest - comp + th / 2, words="a springy bounce pad plate" if pad else "the launcher's plate")
    # the guide rails stand 5 cm over the plate's rest height, or more: let go, the plate overshoots its rest height by up to as far as it was pressed down, and its clips
    # (the plate's thickness and 3 mm) stay on the rails with 2 cm to spare
    gh = rest + max(0.05, comp + th + 0.02)
    for n, sx in enumerate((-1, 1)):
        x = sx * xs
        _spring(c, f"spring{n + 1}", "base", "plate", (x, 0.01), (x, -th / 2), rest, k / 2, damp / 2, radius=cr, travel=travel)
        c.slab(f"guide{n + 1}", 0.006, gh, 0.02, sx * (W / 2 + 0.007), gh / 2, kind="static", words="a steel guide rail", look="steel", material=steel)


def _springs():
    # --- hanging spring
    def build_hanging(c, P):
        k, rest, m, damp = P["stiffness"], P["rest_length"], P["weight"], P["damping"]
        s = _cube(m, P["material"])
        _hanger(c)
        # the spring's top hooks on the ring of the hanger's brass screw eye (SCREW_EYE under the underside), so the rest length, the stretch and the period are measured from there;
        # a lab spring is close wound: a turn every ~4 mm (80 turns at most: the view draws a single coil at 288 triangles a turn, so the spring stays under 23k and the item,
        # hanger and weight with it, under 30k)
        coils = max(24, min(80, round(rest / 0.004)))
        # let go, the weight bounces as far above the point m·g/k below the rest length as it starts below it: stretched more than rest + 2·m·g/k less the spring's closed
        # length, it would be thrown up through its own closed coils (the view's wire is 0.08 of the 12 mm coil radius: two wire radii a turn, and 4 mm for the two end hooks),
        # so it is stretched at most that far (a real spring stops at coil bind)
        solid = coils * 2 * min(0.0035, max(0.0007, 0.08 * 0.012)) + 0.004
        # the spring's steel (_spring_mass): a lab spring rated for the item's own 0.2 kg weight (HANG_RATED), from its closed coils to as far as that weight
        # bounces it, whatever weight hangs on it (a heavier one stretches it past what its steel was sized for, as a real one would take a set; the engine keeps
        # it linear). The weight holds half of its steel's weight (the hanger the rest), and swings with its fundamental mode's share (the engine's)
        ms = round(_spring_mass(k, max(0.0, rest + 2 * HANG_RATED * G / k - solid)), 6)
        stretch = max(0.0, min(P["start_stretch"], rest + (2 * m + ms) * G / k - solid))
        c.slab("weight", s, s, s, 0, -(rest + stretch) - s / 2 - SCREW_EYE, words="a weight on a spring")
        _spring(c, "spring", "hanger", "weight", (0, -0.006 - SCREW_EYE), (0, s / 2), rest, k, damp, coils=coils, travel=max(0.0, rest + 2 * HANG_RATED * G / k - solid))
    wm = _weight_material()
    register(ItemType("hanging-spring", "Hanging spring", "Springs & ropes", build_hanging, material=wm, materials=_has(wm, "steel", "aluminium", "brick", "varnished hardwood"),
                      props=[Prop("stiffness", "Stiffness", 20.0, 1.0, 500.0, 0.5, "N/m", "How hard it pulls per metre stretched"),
                             Prop("rest_length", "Rest length", 0.3, 0.05, 1.0, 0.01, "m", "Its length with nothing hanging on it"),
                             Prop("weight", "Weight", 0.2, 0.05, 5.0, 0.01, "kg"),
                             Prop("damping", "Damping", 0.05, 0.0, 10.0, 0.01, "N·s/m", "Friction that slows the bouncing"),
                             Prop("start_stretch", "Start stretch", 0.2, 0.0, 1.0, 0.01, "m", "How far the spring is stretched when it lets go (at most until it would close its coils on the way back up); it then bounces about the point m·g/k below its rest length")],
                      tags=["hooke", "oscillate", "bounce", "bouncing weight", "coil", "slinky", "elastic", "mass on a spring", "harmonic", "vibrate"],
                      description="A weight on a coil spring, stretched and let go: it bounces up and down with a period 2π√(m/k).",
                      source="Hooke's law F = −kx; period 2π√(m/k) (textbook). A teaching-lab coil spring is about 10-50 N/m (provisional); the spring's own steel (as much as it needs to take the bounce of a 0.2 kg weight: a few grams) swings with about a third of its weight (Rayleigh; exactly, the fundamental of a uniform spring), a period a fraction of a percent longer.",
                      anchor="the top of the spring", facts="20 N/m · 0.2 kg · period 0.63 s"))

    # --- spring launcher
    register(ItemType("spring-launcher", "Spring launcher", "Springs & ropes", lambda c, P: _sprung_plate(c, P, False), material="varnished hardwood",
                      materials=_has("varnished hardwood", "aluminium", "steel", "solid rubber"),
                      props=[Prop("stiffness", "Stiffness", 800.0, 50.0, 5000.0, 10.0, "N/m", "Both springs together"),
                             Prop("rest_length", "Spring length", 0.15, 0.05, 0.5, 0.005, "m", "Uncompressed"),
                             Prop("compression", "Held compressed by", 0.06, 0.0, 0.45, 0.005, "m", "How far the plate is pressed down until the scene's release (at most until the coils close)"),
                             Prop("width", "Plate width", 0.16, 0.06, 0.6, 0.005, "m"), Prop("depth", "Front to back", 0.10, 0.02, 0.6, 0.01, "m", "Only for the 3D look and the weight"),
                             Prop("damping", "Damping", 0.5, 0.0, 20.0, 0.1, "N·s/m")],
                      tags=["catapult", "fling", "throw", "launch", "springboard", "plunger", "pop up", "ejector", "kick"],
                      description="A plate held down on two compressed springs. At the scene's release it springs up and flings what sits on it; tilt the item to aim.",
                      source="Stored energy ½kx² = ½(m + mₛ/3)v², a third of the springs' own steel (mₛ, as much as they need to be pressed as far as the launcher goes) moving with the plate (Rayleigh); a stiffness whose steel would outweigh the plate is built lower (there a real spring's own weight holds the throw back more than that). With 800 N/m pressed 6 cm the plate and a 60 g ball leave at about 4 m/s (textbook energy balance; the values are provisional).",
                      anchor="the middle of its base's top", facts="800 N/m · pressed 6 cm · 0.09 kg plate", edit=[{"kind": "length", "prop": "width"}, {"kind": "rotate"}]))

    # --- bounce pad
    register(ItemType("bounce-pad", "Bounce pad", "Springs & ropes", lambda c, P: _sprung_plate(c, P, True), material="solid rubber",
                      materials=_has("solid rubber", "varnished hardwood", "aluminium", "steel"),
                      props=[Prop("stiffness", "Stiffness", 1000.0, 50.0, 10000.0, 10.0, "N/m", "Both springs together"),
                             Prop("rest_length", "Spring length", 0.08, 0.03, 0.4, 0.005, "m"),
                             Prop("width", "Plate width", 0.2, 0.06, 0.8, 0.005, "m"), Prop("depth", "Front to back", 0.10, 0.02, 0.6, 0.01, "m", "Only for the 3D look and the weight"),
                             Prop("damping", "Damping", 0.5, 0.0, 20.0, 0.1, "N·s/m")],
                      tags=["trampoline", "spring board", "kicker", "bouncer", "cushion", "pad", "springy", "pogo", "rebound"],
                      description="A thin rubber plate bolted on two springs over a base: things landing on it sink in a little and are pushed back up.",
                      source="Hooke's law springs bolted under the plate (they hold it down as well as push it up); stiffness, damping and the plate are provisional.",
                      anchor="the middle of its base's top", facts="1000 N/m · thin rubber plate 20 cm", edit=[{"kind": "length", "prop": "width"}, {"kind": "rotate"}]))

    # --- trampoline: a mat held by pre-stretched springs in its own plane
    def build_trampoline(c, P):
        W, h, m, d, damp = P["width"], P["height"], P["mat_mass"], P["depth"], P["damping"]
        L0, t = 0.15, 0.004
        # each spring gets twice the stiffness prop (each spring is sized for its stretch with the mat pressed down half its height, or until they slope at 45°: the rest length is a quarter short of L0
        # whatever the stiffness; _spring_cap keeps their steel light against the mat and a light ball)
        travel = math.hypot(L0, min(h / 2, L0)) - (L0 - L0 / 4)
        K = _spring_cap(P, m, 2, 2.0, travel)
        ks = 2 * K
        rest = L0 - (K * L0 / 2) / ks
        # where the mat hangs: its weight is carried by the vertical pull of the two sloped springs
        # (and half of each spring's own weight, which it holds up, _spring_mass)
        ms = round(_spring_mass(ks, math.hypot(L0, min(h / 2, L0)) - rest), 6)
        sag = _bisect(lambda s: 2 * ks * (math.hypot(L0, s) - rest) * s / math.hypot(L0, s) - (m + ms) * G, 0.0, 1.0)
        sag = min(sag, h - t / 2 - 0.001)          # a heavy mat on soft springs would sag to the floor: it starts just over it
        steel = _steel(c)
        xl = W / 2 + L0 + 0.02
        rows = max(2, min(12, round(d / 0.06)))    # a real mat is held by a spring every 5-8 cm along each end (at most 12 are drawn: a 2 m mat has one every 17 cm): the view draws this many coils across the depth
        c.slab("mat", W, t, d, 0, h - sag, material=c.mat(density=m / (W * t * d)), words="a trampoline mat")
        # each end is a steel U-frame of the mat's depth (two uprights and a rail at spring height, standing on the floor): open floor between the two
        for n, sx in enumerate((-1, 1)):
            c.slab(f"leg{n + 1}", 0.04, h + 0.02, d, sx * xl, (h + 0.02) / 2, kind="static", words="an end frame of the trampoline", look="steel", material=steel)
            # a trampoline spring is a close-wound extension spring: about 3 mm of wire a turn (some 37 turns over its 11 cm), 24 mm across
            _spring(c, f"spring{n + 1}", "mat", f"leg{n + 1}", (sx * W / 2, 0), (-sx * 0.02, h - (h + 0.02) / 2), rest, ks, damp, coils=max(20, round(rest / 0.003)),
                    travel=math.hypot(L0, min(h / 2, L0)) - rest, render={"rows": rows})
    register(ItemType("trampoline", "Trampoline", "Springs & ropes", build_trampoline, material="trampoline mat", materials=["trampoline mat"],
                      props=[Prop("width", "Mat width", 0.8, 0.3, 2.0, 0.01, "m"), Prop("height", "Height of the mat", 0.35, 0.15, 1.5, 0.01, "m"),
                             Prop("stiffness", "Stiffness", 300.0, 50.0, 3000.0, 10.0, "N/m", "How hard the mat pushes back per metre it is pressed down"),
                             Prop("mat_mass", "Mat weight", 0.05, 0.03, 5.0, 0.01, "kg", "A mat heavier than the ball takes its bounce away: a light one bounces a ball well"), Prop("depth", "Front to back", 0.6, 0.05, 2.0, 0.05, "m", "Only for the 3D look and the weight"),
                             Prop("damping", "Spring damping", 5.0, 0.0, 12.0, 0.5, "N·s/m", "Along each spring: the mat's up-and-down motion feels only a small share of it")],
                      tags=["bounce", "jump", "springs", "mat", "bouncy castle", "rebound", "gymnastics", "elastic", "stretch"],
                      description="A mat held between two frames by pre-stretched springs, like a real trampoline's: press it down and the sloped springs push it back up.",
                      source="A stretched spring of tension T over a span L gives a restoring force of about 2T/L per metre of dip (the same geometry as a plucked string); the mat and spring values are provisional.",
                      anchor="the floor under the middle", facts="80 cm mat · 0.35 m up · 300 N/m", edit=[{"kind": "length", "prop": "width"}, {"kind": "top", "prop": "height"}]))

    # --- spring bumper
    def build_bumper(c, P):
        H, d, rest, damp = P["height"], P["depth"], P["rest_length"], P["damping"]
        # the plate is 3 cm thick, thicker on a tall plate, so that turned on its corner it is always taller (by 2.5 mm at least) than it is between the shelf and the keeper
        t = max(0.03, math.sqrt(sq(H + 0.0025) - H * H))
        # pressed in at most until the coils close (the springs' turns, as _spring draws them, 2 mm wire, side by side plus the two seats), and pulled out no further than that
        # either (let go, it springs back in as far as it was pulled out); the shelf runs on under the plate as far out as it goes, and 4 cm more
        coils = max(5, min(24, int(rest / 0.01)))
        solid = coils * 0.002 + 0.004
        room = rest - solid
        # its springs (a quarter of its height above and below its middle), each sized for that room: the stiffness asked for while their steel is light against the
        # plate and a light ball (_spring_cap)
        mp = MATERIALS[P["material"]]["density"] * t * H * d
        k = _spring_cap(P, mp, 2, 0.5, room)
        push = max(-room, min(P["pushed_in"], room))
        wood = _wood(c)
        # the plate travels out at most until its face is as far out as it starts (pulled out, or swinging back out from pressed in), and a stop at the end of the keeper
        # and of the shelf catches it there (2 mm past that): a hit that drives it in hard cannot throw it out from under the keeper
        kl = rest + abs(push) + t + 0.008
        end = kl + 0.04
        # the keeper's clearance over the plate's top: 4 mm, less on a plate whose corner-to-corner span is not that much taller than the plate (it could turn over under it)
        gap = min(0.004, math.sqrt(H * H + t * t) - H - 0.001)
        # everything stands on the floor at the origin: the 10 mm shelf on it (so the plate never touches what the bumper stands on), the plate on the shelf, the wall
        # up to the keeper rail's top
        wall_h = H + 0.0205 + gap
        c.slab("wall", 0.03, wall_h, d, -0.015, wall_h / 2, kind="static", words="the wall the bumper is mounted on", look="wood", material=wood)
        # a greased steel runner on the shelf: the plate slides on it freely, as a real bumper's plate is carried by its springs (any drag at its foot rocks a tall plate over)
        slick = c.mat(base="varnished hardwood", overrides={"friction": 0.0})
        c.slab("shelf", end, 0.01, d, end / 2, 0.005, kind="static", words="the shelf the plate slides on", look="wood", material=slick)
        # the keeper: a rail from the wall over the plate's top, `gap` clear of it, as far out as the plate goes. Two point springs alone cannot hold a plate square, as
        # bolted coil springs do: pressed hard, the plate would buckle up and turn over; between the shelf and the keeper it rocks a few degrees at most and slides
        c.slab("keeper", kl, 0.01, d, kl / 2, H + 0.0155 + gap, kind="static", words="the rail over the plate that keeps it square", look="wood", material=slick)
        # the end stops: a block under the keeper's end, down to 4 mm below the plate's top, and a steel strip across the shelf's top, both 6 mm wide
        c.slab("catch", 0.006, gap + 0.004, d, kl - 0.003, H + 0.0085 + gap / 2, kind="static", words="the stop at the end of the keeper", look="wood", material=wood)
        c.slab("lip", 0.006, 0.006, d, kl - 0.003, 0.013, kind="static", words="the stop at the end of the shelf", look="steel", material=_steel(c))
        c.slab("plate", t, H, d, rest - push + t / 2, 0.01 + H / 2 + 0.0005, words="a spring-mounted bumper plate")
        # the coil's radius (picture only): 12 mm, narrower on a plate less than ~31 mm deep so it stays on its seat, or less than ~6 cm tall so the two coils (half the
        # plate's height apart) stand 6 mm apart and their seats stay on the plate
        cr = max(0.004, min(0.012, d / 2 - 0.0033, H / 4 - 0.003))
        steel = _steel(c)
        for n, fy in enumerate((0.25, 0.75)):
            _spring(c, f"spring{n + 1}", "wall", "plate", (0.015, 0.01 + fy * H - wall_h / 2), (-t / 2, fy * H - (H / 2 + 0.0005)), rest, k / 2, damp / 2, radius=cr, travel=room)
            # inside each coil a steel guide pin from the wall, 1 mm shorter than the closed coil: hit hard, the plate lands on the pins before the coils close (a real spring stops at coil bind)
            rr = round(0.5 * cr, 5)
            c.slab(f"pin{n + 1}", solid - 0.001, 2 * rr, 2 * rr, (solid - 0.001) / 2, 0.01 + fy * H, kind="static", words="a steel guide pin inside the spring", look="steel", material=steel)
    register(ItemType("spring-bumper", "Spring bumper", "Springs & ropes", build_bumper, material="varnished hardwood", materials=_has("varnished hardwood", "aluminium", "steel", "solid rubber"),
                      props=[Prop("height", "Plate height", 0.12, 0.04, 0.5, 0.005, "m"), Prop("rest_length", "Spring length", 0.1, 0.03, 0.5, 0.005, "m"),
                             Prop("stiffness", "Stiffness", 300.0, 20.0, 5000.0, 10.0, "N/m", "Both springs together"),
                             Prop("pushed_in", "Pushed in at the start", 0.0, -0.1, 0.1, 0.005, "m", "Positive presses the plate toward the wall, negative pulls it out (either way at most as far as the coils can close); it springs back at the scene's release"),
                             Prop("depth", "Front to back", 0.10, 0.02, 0.6, 0.01, "m", "Only for the 3D look and the weight"), Prop("damping", "Damping", 1.0, 0.0, 30.0, 0.1, "N·s/m")],
                      tags=["buffer", "shock absorber", "cushion", "wall", "spring plate", "pinball", "kicker", "stop", "recoil", "dampen"],
                      description="A plate on two springs mounted on a wall (the plate faces right and slides between a shelf and a rail over it; a guide pin inside each spring stops it before the coils close). A ball that hits it pushes it back and gets pushed out again.",
                      source="Hooke's law springs; the plate slides on a greased runner, so the springs alone set how it rings. Stiffness and size are provisional.",
                      anchor="the floor under the wall's face", facts="300 N/m · 12 cm plate", edit=[{"kind": "top", "prop": "height"}, {"kind": "rotate"}]))

    # --- spring-hinged gate
    def build_gate(c, P):
        L, th, d, a, damp, reach = P["length"], P["thickness"], P["depth"], P["start_angle"], P["damping"], P["spring_reach"]
        arm = 0.7 * L          # the spring pulls at 70 % of the way down the gate
        # its spring: the stiffness asked for (the engine follows any; the eye is ex across and 0.2 L down from the plank's middle). Its steel swings with the gate
        # as the fundamental mode of a spring with a fixed end does (the engine), true at any weight of steel for the swing
        ex, m = th / 2 + 0.0026, MATERIALS[P["material"]]["density"] * th * L * d
        k = P["stiffness"]
        # the spring runs from the eye screw in the plank's right face to the post's left face, `reach` from the gate's middle line: it is at its rest length while the gate hangs
        # straight, so it pulls the gate back to hanging straight (not to one side), however thick the gate
        rest = reach - th / 2 - 0.0026
        solid = max(5, min(24, int(rest / 0.01))) * 0.002 + 0.004
        # opened toward the post, the gate stops where its spring's coils close or the plank meets the post (a real gate can be swung no further): a start angle past that starts there
        if a > 0:
            a = _gate_stop(L, th, arm, reach, solid, a)
        # let go, it swings to and fro as far as its energy (the spring's and the plank's weight's, from hanging straight) carries it. Toward the post the energy rises up to
        # that stop, or to where the pressed spring goes over centre and would fling the gate on up into its hanger; away from the post up to 85 degrees (the hanger beyond).
        # So it starts low enough on that hill on either side to turn back short of both tops
        def energy(t):
            x, y = ex * cos(t) + arm * sin(t), ex * sin(t) - arm * cos(t)
            return 0.5 * k * sq(math.hypot(x - reach, y + arm) - rest) + m * G * (L / 2) * (1 - cos(t))

        def hill(sd, end):
            """How far (degrees, up to end) the gate turns to side sd from hanging straight while its energy still rises (in 0.5 degree steps), and the energy there."""
            u, e = 0.0, 0.0
            while u < end:
                v = min(end, u + 0.5)
                ev = energy(sd * v * D2R)
                if ev <= e:
                    break
                u, e = v, ev
            return u, e
        tops = {1.0: hill(1.0, _gate_stop(L, th, arm, reach, solid, 80.0)), -1.0: hill(-1.0, 85.0)}
        cap = min(tops[1.0][1], tops[-1.0][1])
        side = 1.0 if a > 0 else -1.0
        if abs(a) > tops[side][0] or energy(a * D2R) > cap:
            a = side * _bisect(lambda u: energy(side * u * D2R) - cap, 0.0, min(abs(a), tops[side][0]))
        ar = a * D2R
        P["start_angle"] = round(a, 3)      # (what was built: the inspector and the swing handle show the gate where it is)
        # the gate turns on a hinge at the middle of its top end (the origin), so its top corners swing up to th/2 above it: the hanger's underside stands 3 mm over that
        # (6 mm at least, for the hinge's knuckle) at any angle and thickness; the hinge's web runs down to the pin
        drop = max(0.006, th / 2 + 0.003)
        _hanger(c, y=drop + 0.006)
        c.slab("post", 0.02, 0.06, d, reach + 0.01, -arm, kind="static", words="a post the spring is fixed to", look="wood", material=_wood(c))
        c.slab("gate", th, L, d, (L / 2) * sin(ar), -(L / 2) * cos(ar), langle=a, words="a gate on a spring hinge", pivot={"x": 0.0, "y": round(L / 2, 5)})
        # (it is pressed to its closed coils toward the post, and stretched swinging away from it, to 85 degrees at most)
        x85, y85 = ex * cos(-85 * D2R) + arm * sin(-85 * D2R), ex * sin(-85 * D2R) - arm * cos(-85 * D2R)
        travel = max(rest - solid, abs(math.hypot(x85 - reach, y85 + arm) - rest))
        _spring(c, "spring", "gate", "post", (th / 2 + 0.0026, L / 2 - arm), (-0.01, 0.0), rest, k, damp, travel=travel)        # on the eye screw in the plank's right face
        # the hinge's friction: its 3.8 mm steel pin (web/models/mechanisms-springs.js) turns in the knuckles under the gate's weight, μ·r·m·g (the spring is at its
        # rest length while the gate hangs). The gate's pivot (named, as every hinged part's is) is frictionless in the engine, so the friction is a pin joint at the
        # same point, drawn by the gate's own hinge (render.hinge "none")
        _joint(c, "pin", "hinge", a=None, b="gate", anchorA=(0.0, 0.0), anchorB=(0.0, round(L / 2, 5)), friction=round(PIN_FRICTION * 0.0019 * m * G, 6),
               render={"hinge": "none"})
    register(ItemType("spring-gate", "Spring gate", "Springs & ropes", build_gate, material="varnished hardwood", materials=_has("varnished hardwood", "aluminium", "steel"),
                      props=[Prop("length", "Length", 0.4, 0.1, 1.5, 0.01, "m"), Prop("thickness", "Thickness", 0.02, 0.005, 0.1, 0.001, "m"),
                             Prop("depth", "Width (front to back)", 0.12, 0.02, 1.0, 0.01, "m"),
                             Prop("start_angle", "Start angle", 40.0, -80.0, 80.0, 1.0, "°", "From hanging straight down; positive swings it to the right, as far as its spring and post let it, negative to the left, only as far as it then swings back short of the post"),
                             Prop("stiffness", "Spring stiffness", 40.0, 2.0, 1000.0, 1.0, "N/m", "A spring from the gate, 70 % of the way down, to a post on its right"),
                             Prop("spring_reach", "Spring length", 0.4, 0.2, 1.0, 0.01, "m", "How far the post stands from the gate when it hangs straight: keep it more than the gate swings"),
                             Prop("damping", "Damping", 0.3, 0.0, 10.0, 0.05, "N·s/m")],
                      tags=["door", "saloon door", "flap", "self closing", "swing door", "hinge", "spring hinge", "return", "paddle"], anchor="the hinge, at the top",
                      description="A gate hung from a hinge, with a spring that pulls it back to hanging straight: it swings open when hit and comes back.",
                      source="A spring across a hinge acts like a torsion spring k·a² (a the arm to the spring); the hinge's steel pin turns with Coulomb friction 0.3 under the gate's weight. The spring, the friction and the gate are provisional.",
                      facts="40 cm gate · 40 N/m spring", edit=[{"kind": "swing", "prop": "start_angle", "length": "length"}]))

    # --- spring catapult
    def build_catapult(c, P):
        L, a, k = P["arm_length"], P["cocked_angle"] * D2R, P["stiffness"]
        t, d = 0.02, 0.05
        # the post is at least tall enough for the cocked arm: the long end's lowest corner (0.7 L out from the pivot, under the arm) stays 4 mm over the base's top
        # (a long arm cocked steeply gets a taller post rather than starting inside the base or the table)
        H0 = max(P["post_height"], 0.7 * L * sin(a) + (t / 2) * cos(a) + 0.004)
        wood = _wood(c)
        short = 0.3 * L
        ca, sa = cos(a), sin(a)
        # the spring: a close-wound tension spring from the eye under the short end (s along the arm from the pivot, e under its middle line) straight down to the base,
        # a turn every 3.2 mm at its rest length (18 turns at least, 68 at most: the view draws a single coil at 288 triangles a turn, so the item stays under 30k)
        s_eye, e_eye = short - 0.02, t / 2 + 0.0006
        rest0 = max(0.02, 0.3 * (H0 + s_eye * sa))
        coils = max(18, min(68, round(rest0 / 0.0032)))
        # the arm ends its swing on the stop at most 50 degrees past level (a steeper end would carry its short end, and the spring, into the post), and never where the eye,
        # allowing for the arm's overshoot of its limit (3 degrees at most), comes nearer the base than the spring's closed length (its turns of wire, at most 0.96 mm in
        # radius, side by side, its hooks) and 2 mm: a long arm on a short post stops sooner (a larger sweep stops there)
        need = coils * 2 * 0.00096 + 0.004

        def eye_y(u):
            return H0 + s_eye * sin(u) - e_eye * cos(u)
        lowest = -50 * D2R if eye_y(-53 * D2R) >= need else _bisect(lambda u: eye_y(u) - need, -53 * D2R, a) + 3 * D2R
        sweep = min(P["sweep"], P["cocked_angle"] - lowest / D2R)
        P["sweep"] = round(sweep, 3)        # (what was built: the inspector shows where the arm stops)
        # the base reaches under the spring's foot (under the cocked eye) with 3 cm to spare
        tip_x = s_eye * ca
        right = max(0.17, tip_x + 0.03)
        # the spring is still stretched (by 5 mm at least) when the arm lies on its stop, so it holds the arm down there: a spring shorter than its rest length
        # there pushed a long arm on a short post back up off its stop, and it bobbed for seconds
        th = (P["cocked_angle"] - sweep) * D2R
        rest = min(rest0, math.hypot(s_eye * cos(th) + e_eye * sin(th) - tip_x, eye_y(th)) - 0.005)
        c.slab("base", 0.17 + right, 0.02, 0.1, (right - 0.17) / 2, -0.01, kind="static", words="the catapult's base", look="wood", material=wood)
        # the post's two cheeks are rounded over the pivot pin (a 9 mm lug: web/models/mechanisms-springs.js), so the post stands that much over the pivot
        c.slab("post", 0.03, H0 + 0.009, 0.06, 0.0, (H0 + 0.009) / 2, kind="static", words="the post the arm turns on", look="wood", material=wood)
        # the arm: its +x end is the short end (up when cocked), the long end (left) carries the ball
        arm = c.slab("arm", L, t, d, -0.2 * L * ca, H0 - 0.2 * L * sa, langle=P["cocked_angle"], words="the catapult's throwing arm")
        _child(c, "lip", arm, 0.008, 0.03, d, -L / 2 + 0.004, t / 2 + 0.015, c.mat(), "a small lip that holds the ball", "wood")
        # where the arm comes to rest: it overshoots its limit and settles about 1.7 degrees short of it (the engine's angular slop)
        th_rest = th + 1.7 * D2R
        # the spring's foot is under the cocked eye, its top leans in to where the eye lands (the end of the swing and the 3 degrees the arm overshoots it). Its coil is 12 mm
        # in radius, narrower (5 mm at least) where the eye, cocked or landing, stands close to the post, and the stop on the post's face (26 mm out from it, 10 mm at least)
        # ends 3.5 mm short of the coil's middle less its radius, wherever the eye is
        ex = s_eye * cos(th - 3 * D2R) + e_eye * sin(th - 3 * D2R)
        cr = max(0.005, min(0.012, tip_x - 0.0285, ex - 0.0285))
        # the stop: a wooden block on the post's right face; two bodies come to rest a contact skin (about 2.6 mm between these two) apart, so its top is 2.4 mm under the
        # arm's underside at the resting angle, and the picture's rubber cap stands up to the arm (web/models/mechanisms-springs.js); the joint's limit is reached first

        def y_top(x):
            return H0 - (t / 2) * cos(th_rest) + ((x - (t / 2) * sin(th_rest)) / cos(th_rest)) * sin(th_rest) - 0.0024
        x0, x1, bh = 0.015, min(0.041, max(0.025, min(tip_x, ex) - cr - 0.0035)), 0.024
        # (its rubber cap makes it a dead stop: the arm lands on it and stays, where a bare wooden block let a strong spring's arm chatter on it)
        c.poly("stop", [(x0, y_top(x0) - bh), (x1, y_top(x1) - bh), (x1, y_top(x1)), (x0, y_top(x0))], 0.044, kind="static", look="wood",
               material=c.mat(base="varnished hardwood", overrides={"bounce": 0.1}), words="the stop the arm comes to rest on")
        # released, nothing holds the arm up but its spring (the engine holds every part still until the release): a spring too weak for the load lets the long end
        # fall onto the base or the table, or past the table's edge. The hinge's other limit (the engine wants one) is where the arm's underside meets the floor of the
        # post's slot (web/models/mechanisms-springs.js cuts the slot as deep as the arm needs, cocked and landed, and 2 mm more): a stop that is always drawn. (It was
        # also 3 degrees past where the long end reached the tabletop under the base, which held the arm in mid-air beside the table when the base stood at its edge;
        # on a table the base or the tabletop stops the arm before the slot does)
        slot = min(0.6 * H0, max(0.024, max(0.015 * abs(math.tan(e * D2R)) + (t / 2) / cos(e * D2R) + 0.002
                                            for e in (P["cocked_angle"], P["cocked_angle"] - min(P["sweep"], P["cocked_angle"] + 50) - 3))))
        deep = 0.015 * math.tan(a) + (t / 2) / ca - slot
        top = a if deep >= 0 else _bisect(lambda u: 0.015 * math.tan(u) + (t / 2) / cos(u) - slot, a, 89 * D2R)
        # the pivot's friction: an 8 mm steel bolt turning in the steel straps on the arm (web/models/mechanisms-springs.js), μ·r times the load it carries with the
        # arm cocked (the spring's pull and the arm's weight). It settles an arm that the spring holds up off its stop (a weak spring, a long arm) where it stops
        # (a 0.8 m arm on a 20 N/m spring with a baseball: still within 5 s), and takes about 2 % off the throw's speed (a 300 N/m arm: a golf ball at 4.94 m/s
        # rather than 5.02 without it)
        m_arm = MATERIALS[P["material"]]["density"] * L * t * d
        load = m_arm * G + k * (math.hypot(e_eye * sa, eye_y(a)) - rest)
        _joint(c, "pin", "hinge", a="post", b="arm", anchorA=(0, H0 / 2 - 0.0045), anchorB=(0.2 * L, 0), limits={"lower": round(-sweep * D2R, 5), "upper": round(top - a, 5)},
               friction=round(PIN_FRICTION * 0.004 * load, 6))
        # the spring's damping: its own losses (a close-wound steel spring and its hooks), 2 % of critical for the bare arm swinging about its pin on the spring and
        # its own weight (ζ = c·s² / (2√(κ·I)), κ = k·s² + m·g·r the turning stiffness, s the eye's lever, r = 0.2 L how far the arm's middle is from the pin, I the
        # arm's about the pin; provisional). (A fifth of critical stood in for the pin's friction too, before the engine's pins had any: it took a sixth off the
        # throw's speed)
        I_pin = m_arm * (L * L + t * t) / 12 + m_arm * sq(0.2 * L)
        damp = 2 * 0.02 * math.sqrt((k * s_eye * s_eye + m_arm * G * 0.2 * L) * I_pin) / (s_eye * s_eye)
        # (its steel: for the stretch with the arm cocked as far as the item lets it, 60°, whatever it is cocked to)
        a60 = 60 * D2R
        _spring(c, "spring", "arm", "base", (L / 2 - 0.02, -t / 2 - 0.0006), (tip_x - (right - 0.17) / 2, 0.01), rest, k, damp, coils=coils, radius=round(cr, 5),
                travel=max(0.0, math.hypot(s_eye * cos(a60) + e_eye * sin(a60) - tip_x, eye_y(a60)) - rest))
    register(ItemType("spring-catapult", "Spring catapult", "Springs & ropes", build_catapult, material="varnished hardwood", materials=_has("varnished hardwood", "aluminium"),
                      props=[Prop("arm_length", "Arm length", 0.4, 0.3, 1.2, 0.01, "m", "The ball sits on the long end, on the left; the spring pulls the short end down"),
                             Prop("cocked_angle", "Cocked angle", 25.0, 5.0, 60.0, 1.0, "°", "How far the long end is held below level until the release"),
                             Prop("sweep", "Swing before the stop", 70.0, 20.0, 110.0, 1.0, "°", "Where the arm hits its stop and lets the ball fly: about 70° flings it up and to the right at 45°. The stop is at most 50° past level, and higher where a long arm's short end would come down on the base, so a longer swing ends there"),
                             Prop("stiffness", "Spring stiffness", 300.0, 20.0, 3000.0, 10.0, "N/m"), Prop("post_height", "Post height", 0.15, 0.08, 0.6, 0.005, "m", "The pivot's height; a long arm cocked steeply gets a taller post, so its end stays clear of the base")],
                      tags=["launcher", "trebuchet", "fling", "throw", "lever", "arm", "siege", "sling", "hinge", "spring loaded"],
                      description="A hinged arm pulled down by a spring and held cocked until the scene's release. Put a ball on the long end (left): it is flung to the right.",
                      source="A lever with a stretched spring; the arm stops at a limit and the ball keeps going (textbook energy balance). Its pivot bolt turns with Coulomb friction 0.3 under the load it carries. Spring, friction and sizes are provisional.",
                      anchor="the floor under its post", facts="40 cm arm · 300 N/m", edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- ropes
def _bob(c, P, hanger_width, wrecking=False):
    """A bob hung by a rope from a fixed point (the hanger's underside is the item's origin; the rope is tied through the screw eye a few mm below it, a wrecking ball's chain hangs on a clevis pin a little lower).
    The rope is made fast at the bob's lifting eye, on the line through the ball's centre, and the bob starts turned to lie along the rope: it swings
    rigidly with it, as a real one does, and the eye the 3D view draws follows the rope. The rope is shorter than the length by the ball's radius and the eye's height."""
    L, a = P["length"], P["start_angle"] * D2R
    rho = MATERIALS[P["material"]]["density"]
    r = P["bob_diameter"] / 2 if "bob_diameter" in P else cr_pow(3 * P["bob_mass"] / (4 * math.pi * rho), 1 / 3)
    if wrecking:
        # a forged eye (web/models/mechanisms-ropes.js): its size follows the ball; the chain's wire is sized to pass through it, and its top link hangs on a pin in a clevis
        k = min(2.2, max(0.67, r / 0.045))
        e = 0.0099 * k
        wire = min(0.012, max(0.004, 0.006 * k))
        hook = wire + 0.0036
        # the view draws the chain's links alternately face-on and edge-on: a face-on link stands 1.775 wire diameters either side of the chain's line (web/view3d.js chainLinkGeometry)
        side = 1.775 * wire
    else:
        # the bob's screw eye follows the ball up to a 20 cm ball (a 38 mm eye; a heavy ball on a toy-sized eye looked wrong), and is no smaller than a 1.75 cm ball's
        k = min(4.0, max(0.35, r / 0.025))
        e = 0.0047 * k
        hook = SCREW_EYE        # the rope is tied through the hanger's brass screw eye (web/models/mechanisms-parts.js screwEye), whose ring is this far below the underside
        side = 0.0015           # the rope's radius (3 mm rope)
    L = max(L, r + e + hook + 0.02)
    if L > P["length"]:
        P["length"] = round(L, 5)       # (what was built: a big bob on a short rope hangs lower)
    # pulled up past the side, a big bob on a short rope would start inside the hanger it hangs from: it starts where it meets it, 3 mm short
    a = math.copysign(_swing_stop(L, r, hook, hanger_width, abs(a)), a)
    # the taut rope runs straight from its tie, `hook` under the middle of the hanger's underside: pulled up to about level, it would run through the hanger's lower corner,
    # so it starts where it passes that corner with 0.5 mm to spare (a rope's radius from its line, a chain's face-on link's half width): just past level for the rope,
    # just short of it for a chain
    a_max = math.pi / 2 + math.acos(min(1.0, (side + 0.0005) / math.hypot(hook, hanger_width / 2))) - math.atan2(hanger_width / 2, hook)
    a = math.copysign(min(abs(a), a_max), a)
    P["start_angle"] = round(a / D2R, 3)    # (what was built: the inspector and the swing handle show the bob where it is)
    _hanger(c, hanger_width, steel=wrecking)
    if "bob_diameter" in P:
        # a bob of the chosen material, solid, as a ball of that size and material weighs (a 5 cm steel bob 0.51 kg, a wooden one 46 g). A typed weight is kept
        # exactly, as a ball's is (it does not follow the size): a bob lighter than solid is a hollow shell of the material, its wall as thick as that weight makes it
        # (it swings and rolls as a shell does; the material's density is trimmed by the rounding of the wall to the micrometre, so the weight is exact), and one
        # heavier than solid is weighted inside (denser than its material, as a lead-filled bob is). (A clamped weight showed the typed number in the inspector.)
        vol = (4 / 3) * math.pi * cube(r)
        solid = rho * vol
        m = P["bob_mass"] if "bob_mass" in (c.item.get("props") or {}) else solid
        wall, mat = None, None
        if m < solid:
            wall = max(1e-6, round(r - cr_pow(cube(r) - 3 * m / (4 * math.pi * rho), 1 / 3), 6))
            x = m / (vol - (4 / 3) * math.pi * cube(r - wall))
            mat = c.mat(density=round(x, 6) if x >= 1 else float(f"{x:.6g}"))
        elif m > solid:
            mat = c.mat(density=round(m / vol, 6))
        P["bob_mass"] = m
        c.ball("bob", r, L * sin(a), -L * cos(a) - hook, material=mat, wall=wall, words="a heavy bob on a rope")
    else:
        c.ball("bob", r, L * sin(a), -L * cos(a) - hook, words="a heavy steel ball on a chain")
    bob = c.sb.solids[-1]
    bob["angle"] = round(bob.get("angle", 0.0) + a, 6)
    bob["eye"] = round(e, 5)
    # (a wrecking ball's chain collides while it is taut: what it swings into stops against its links, not only against the ball)
    look = {"thickness": round(0.004 * k, 5), "collide": True, "render": {"style": "chain"}} if wrecking else {"thickness": 0.003}
    _joint(c, "rope", "rope", a="hanger", b="bob", anchorA=(0, -0.006 - hook), anchorB=(0, r + e), length=round(L - r - e, 5), **look)


def _ropes():
    # --- rope pendulum
    def build_rope_pendulum(c, P):
        _bob(c, P, 0.08)
    bob0 = MATERIALS["steel"]["density"] * ((4 / 3) * math.pi * cube(0.025))       # kg: the default bob, a solid 5 cm steel ball (0.514 kg)
    register(ItemType("rope-pendulum", "Rope pendulum", "Springs & ropes", build_rope_pendulum, material="steel", materials=_has("steel", "solid rubber", "varnished hardwood", "dark wood", "aluminium", "modeling clay"),
                      props=[Prop("length", "Rope length", 0.5, 0.1, 2.0, 0.01, "m", "From the fixed point to the middle of the bob"),
                             Prop("bob_diameter", "Bob diameter", 0.05, 0.01, 0.3, 0.001, "m"),
                             Prop("bob_mass", "Bob weight", bob0, 1e-4, 112.0, 1e-4, "kg", "Follows the size and the material (a solid ball) until you type a weight. "
                                  "A typed weight is kept: a lighter bob is a hollow shell of the material, a heavier one is weighted inside",
                                  auto=("bob_diameter", "material"), slider_max=10.0),
                             Prop("start_angle", "Start angle", 30.0, -90.0, 90.0, 1.0, "°", "From straight down; negative pulls the bob to the left. At most level with the fixed point: the rope stays taut and clear of the hanger")],
                      tags=["string", "bob", "clock", "swing", "oscillate", "weight on a string", "plumb", "period", "metronome"],
                      description="A bob on a rope from a fixed point. Pull it aside and let go: it swings with a period 2π√(L/g).",
                      source="Period 2π√(L/g) for small swings (textbook); a rope that stays taut can pull but never push.",
                      anchor="the fixed point, at the top", facts="50 cm · 5 cm steel bob, 0.51 kg · period about 1.4 s", edit=[{"kind": "swing", "prop": "start_angle", "length": "length"}, {"kind": "rotate"}]))

    # --- wrecking ball
    def build_wrecking(c, P):
        _bob(c, P, 0.2, wrecking=True)
    register(ItemType("wrecking-ball", "Wrecking ball", "Springs & ropes", build_wrecking, material="steel", materials=["steel"],
                      props=[Prop("length", "Chain length", 1.0, 0.2, 3.0, 0.01, "m", "From the crane's hook to the middle of the ball"),
                             Prop("bob_mass", "Ball weight", 3.0, 0.2, 30.0, 0.1, "kg", "A solid steel ball of this weight"),
                             Prop("start_angle", "Pulled back by", -60.0, -90.0, 90.0, 1.0, "°", "From straight down; negative pulls it to the left, so it swings right. At most until the taut chain would touch the beam, just short of level")],
                      tags=["demolition", "crane", "chain", "heavy ball", "smash", "knock down", "hammer", "pendulum", "swing", "destroy"],
                      description="A heavy steel ball on a chain, pulled back and let go: it swings through the bottom of its arc at its fastest and knocks into what stands there.",
                      source="Speed at the bottom √(2gL(1 − cos θ)) (energy balance). Real crane balls weigh from half a tonne up (provisional); this is a table-top model in solid steel, 7850 kg/m³.",
                      anchor="the crane's hook, at the top", facts="3 kg · 1 m chain · 3 m/s at the bottom", edit=[{"kind": "swing", "prop": "start_angle", "length": "length"}, {"kind": "rotate"}]))

    # --- swing: a seat on two parallel ropes (it stays level and moves like a pendulum bob)
    def build_swing(c, P):
        L, w, a, th, d = P["rope_length"], P["seat_width"], P["start_angle"] * D2R, 0.02, P["depth"]
        wood = _wood(c)
        c.slab("bar", w + 0.04, 0.012, 0.04, 0, 0.006, kind="static", words="the bar the swing hangs from", look="wood", material=wood)
        c.slab("seat", w, th, d, L * sin(a), -L * cos(a) - th / 2 - SCREW_EYE, words="a swing seat")
        for n, sx in enumerate((-1, 1)):
            x = sx * (w / 2 - 0.02)
            _joint(c, "rope", f"rope{n + 1}", a="bar", b="seat", anchorA=(x, -0.006 - SCREW_EYE), anchorB=(x, th / 2), length=round(L, 5))        # tied through the bar's screw eye
    register(ItemType("swing", "Swing", "Springs & ropes", build_swing, material="varnished hardwood", materials=_has("varnished hardwood", "dark wood", "aluminium"),
                      props=[Prop("rope_length", "Rope length", 0.6, 0.2, 2.0, 0.01, "m"), Prop("seat_width", "Seat width", 0.3, 0.1, 0.8, 0.01, "m"),
                             Prop("depth", "Front to back", 0.12, 0.02, 0.6, 0.01, "m", "Only for the 3D look and the weight"),
                             Prop("start_angle", "Start angle", -30.0, -80.0, 80.0, 1.0, "°", "How far the ropes are pulled from straight down; negative pulls the seat to the left")],
                      tags=["playground", "seat", "hammock", "ropes", "pendulum", "child", "rocking", "oscillate", "hang"],
                      description="A seat on two parallel ropes from a bar. The ropes stay parallel, so the seat stays level and swings like a pendulum as long as the ropes are.",
                      source="Two equal parallel ropes make a parallelogram: the seat moves like a point mass on a rope as long as them, period 2π√(L/g) (textbook).",
                      anchor="the middle of the bar, at the top", facts="60 cm ropes · 30 cm seat · period about 1.6 s", edit=[{"kind": "swing", "prop": "start_angle", "length": "rope_length"}]))

    # --- hanging chain
    def build_chain(c, P):
        S, Lc, n, th = P["span"], max(P["chain_length"], P["span"] * 1.02), int(P["links"]), P["thickness"]
        # a catenary y = a (cosh(x/a) − cosh(S/2a)) with arc length Lc between two supports S apart; its points one link of arc apart are the pins
        u = _bisect(lambda x: math.sinh(x) / x - Lc / S, 1e-6, 60.0)
        a = S / (2 * u)
        pts = []
        for i in range(n + 1):
            s = -Lc / 2 + i * Lc / n
            x = a * math.asinh(s / a)
            pts.append((x, a * (math.cosh(x / a) - math.cosh(u))))
        steel = _steel(c)
        # the clevis blocks: 30 mm, or as big as a link is wide (3.4 wire diameters, the wire 0.29 of the thickness: web/models/mechanisms-ropes.js) and 6 mm more on each side,
        # but no bigger than the end bar is long (so the second bar starts clear of the block)
        bw = max(0.03, min(round(3.4 * 0.29 * th + 0.012, 4), round(math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), 4)))
        for nm, x in (("post-left", -S / 2), ("post-right", S / 2)):
            c.slab(nm, bw, bw, max(0.04, bw), x, 0.0, kind="static", words="a steel clevis block the chain is hung from", look="steel", material=steel)
        links = []
        for i in range(n):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            ln = math.hypot(x1 - x0, y1 - y0)
            links.append(ln)
            c.slab(f"link{i + 1}", ln, th, max(0.02, th), (x0 + x1) / 2, (y0 + y1) / 2, langle=math.degrees(math.atan2(y1 - y0, x1 - x0)), words="a link of a chain")
        for i in range(n + 1):
            a_part, a_pt = ("post-left", (0.0, 0.0)) if i == 0 else (f"link{i}", (links[i - 1] / 2, 0.0))
            b_part, b_pt = ("post-right", (0.0, 0.0)) if i == n else (f"link{i + 1}", (-links[i] / 2, 0.0))
            _joint(c, "pin", f"pin{i + 1}", a=a_part, b=b_part, anchorA=a_pt, anchorB=b_pt, render={"hinge": "none"})        # the links are drawn interlocked: no bolts at the joints
    register(ItemType("hanging-chain", "Hanging chain", "Springs & ropes", build_chain, material="steel", materials=_has("steel", "aluminium", "varnished hardwood"),
                      props=[Prop("span", "Distance between the posts", 0.6, 0.1, 2.0, 0.01, "m"), Prop("chain_length", "Chain length", 0.8, 0.1, 3.0, 0.01, "m", "Longer than the span, or it is pulled straight"),
                             Prop("links", "Links", 14, 4, 30, 1, "", "How many bars it is made of", kind="int"), Prop("thickness", "Link thickness", 0.01, 0.003, 0.05, 0.001, "m")],
                      tags=["catenary", "rope", "cable", "necklace", "sag", "bridge", "string of links", "suspended", "power line", "curve"],
                      description="Links pinned end to end between two fixed posts. It starts on its natural curve, a catenary, and hangs there.",
                      source="A chain hung from two points takes the catenary y = a cosh(x/a), a curve worked out by Huygens, Leibniz and Johann Bernoulli in 1691 (Galileo had thought it a parabola).",
                      anchor="the middle between the posts, at their height", facts="14 links · 80 cm of chain between posts 60 cm apart", edit=[{"kind": "length", "prop": "span"}]))


# ---------------------------------------------------------------- pulleys
def _rig(c, d, wr, **extra):
    """A bar over the two wheels at (-d/2, 0) and (d/2, 0), whose rope runs over both."""
    c.slab("bar", d + 0.06, 0.012, 0.04, 0, wr + 0.012, kind="static", words="the bar the pulley wheels hang from", look="wood", material=_wood(c), **extra)


def _pulleys():
    # --- Atwood machine
    def build_atwood(c, P):
        m1, m2, drop = P["left_mass"], P["right_mass"], P["drop"]
        s1, s2 = _cube(m1, P["material"]), _cube(m2, P["material"])
        d = max(0.1, (s1 + s2) / 2 + 0.05)
        # one wheel spans both runs, as on a real Atwood machine: its radius is half the weights' spacing, so both strings hang straight down to the weights (the bar over it,
        # at wr + 0.012, leaves the view room to draw it that big). The bar is then more than 4 cm over the rope's ends, where the view would not look for what holds the
        # pulley up: it is told to stand the bar on a retort stand (a wall bracket above 1.3 m, as the view does by itself)
        wr = round(d / 2, 4)
        _rig(c, d, wr, stand="wall" if c.world(0, wr + 0.006)[1] > 1.3 else "post")
        # the wheel itself is solid: what falls or rolls onto it bangs into it. The view draws it from the joint (its rim d/2 - 0.5 mm from the axle), so this disc of
        # the same size is left out of the picture
        R = d / 2 - 0.0005
        c.ball("wheel", R, 0.0, 0.0, kind="static", material=_steel(c), look="steel", words="the pulley wheel", hidden_3d=True)
        # the lighter weight hauled right up to the wheel jams square under it, its top JAM_GAP under the rim where it comes nearest it: there its rope's end stops
        # in the pulley (the joint's minLengthA/minLengthB), so the heavier one, which hauls it, stops with it and hangs on the rope (the rope pulls, never pushes,
        # and holds whatever the two weigh). One hung higher than that starts there
        runs = [round(_jam_run(0.0, R, sx * d / 2 - s / 2, sx * d / 2 + s / 2), 5) for sx, s in ((-1, s1), (1, s2))]
        c.slab("left", s1, s1, s1, -d / 2, -max(drop, runs[0]) - s1 / 2, words="the left weight")
        c.slab("right", s2, s2, s2, d / 2, -max(drop, runs[1]) - s2 / 2, words="the right weight")
        # (web/view3d.js draws it |groundB - groundA| / 2 in radius, less the rope's radius and 0.5 mm, under the rope's top run)
        _joint(c, "pulley", "rope", a="left", b="right", groundA=(-d / 2, 0), groundB=(d / 2, 0), anchorA=(0, s1 / 2), anchorB=(0, s2 / 2), ratio=1.0, wheelRadius=round(wr, 4),
               minLengthA=runs[0], minLengthB=runs[1], render={"wheel": "single"})
    wm = _weight_material()
    register(ItemType("atwood-machine", "Atwood machine", "Springs & ropes", build_atwood, material=wm, materials=_has(wm, "steel", "aluminium", "brick"),
                      props=[Prop("left_mass", "Left weight", 0.3, 0.05, 3.0, 0.01, "kg"), Prop("right_mass", "Right weight", 0.2, 0.05, 3.0, 0.01, "kg"),
                             Prop("drop", "Rope below the pulley", 0.45, 0.1, 2.0, 0.01, "m", "From the pulley to the top of each weight at the start")],
                      tags=["pulley", "rope", "two weights", "balance", "acceleration", "atwood", "newton second law", "lab", "hoist", "counterweight"],
                      description="Two weights on a rope over a pulley: the heavier falls and lifts the lighter, with an acceleration g(m₁ − m₂)/(m₁ + m₂).",
                      source="George Atwood, A Treatise on the Rectilinear Motion and Rotation of Bodies (1784): a = g(m₁ − m₂)/(m₁ + m₂) for a weightless rope and pulley. Weights use the conventional density 8000 kg/m³ (OIML R 111).",
                      anchor="the middle of the pulley wheel's axle", facts="0.3 kg and 0.2 kg · a = 1.96 m/s²", edit=[]))

    # --- pulley lift: a falling weight lifts a pail
    LIFT_T, LIFT_ARCH = 0.003, 7            # the pail's 3 mm sheet and wire; the bail's arch is this many straight pieces
    LIFT_GAP = 0.0025                       # m: between two pieces of the pail that are not welded to each other (see build_lift)

    def lift_parts(Wc, Hc):
        """The pail's pieces in its floor's frame (origin = the floor's middle): the floor, the two walls (slabs seen from the side: the pail is round, as deep as it is wide), and the
        bail, a semicircle of 3 mm wire through the two ears at the rim, cut into LIFT_ARCH convex pieces (each [outer start, inner start, inner end, outer end], counter-clockwise).
        Each piece stops LIFT_GAP / 2 short of its neighbour (measured on the inner edge) and its end pieces stand LIFT_GAP over the walls' tops: the pieces are each welded to
        the pail's root, not to one another, and the engine then let welded pieces that were not joined directly collide, so pieces that touched pushed each other apart every
        step and the pail flew to bits (a weld group is now one rigid body; web/models/mechanisms-pulleys.js draws the wire whole over the gaps)."""
        t = LIFT_T
        cy = t / 2 + Hc                       # the rim's height: the arch's centre
        ro, ri = Wc / 2, Wc / 2 - t
        trim, end = LIFT_GAP / 2 / ri, math.asin(LIFT_GAP / ri)
        pieces = []
        for k in range(LIFT_ARCH):
            a0 = math.pi * (1 - k / LIFT_ARCH) - (trim if k else end)
            a1 = math.pi * (1 - (k + 1) / LIFT_ARCH) + (trim if k < LIFT_ARCH - 1 else end)
            quad = [(ro * cos(a0), cy + ro * sin(a0)), (ri * cos(a0), cy + ri * sin(a0)),
                    (ri * cos(a1), cy + ri * sin(a1)), (ro * cos(a1), cy + ro * sin(a1))]
            pieces.append([(round(x, 5), round(y, 5)) for x, y in quad])
        vol = Wc * t * Wc + 2 * t * Hc * Wc + sum(_area(q) * t for q in pieces)
        return pieces, vol

    def build_lift(c, P):
        m, drop, Wc, Hc, t = P["weight"], P["drop"], P["cup_width"], P["cup_height"], LIFT_T
        sw = _cube(m, P["material"])
        gap = Wc / 2 + sw / 2 + 0.04
        dd = 2 * gap
        wr = min(0.03, gap - 0.004)
        _rig(c, dd, wr)
        # the two wheels are solid: what falls or rolls onto one bangs into it. The view draws each wheel from the joint (wr in radius, inboard of its rope run by its
        # 4 mm smaller rope radius), so these discs of that size are left out of the picture
        R, wx = wr - 0.0005, gap - wr + 0.004
        for n, sx in enumerate((-1, 1)):
            c.ball(f"wheel{n + 1}", R, sx * wx, 0.0, kind="static", material=_steel(c), look="steel", words="a pulley wheel", hidden_3d=True)
        alu = "aluminium" if "aluminium" in MATERIALS else "steel"
        # the pail weighs what the old square cup did at the default size (0.17 kg of thin aluminium): the aluminium's density is set so that its round shape does, and a bigger
        # pail then weighs more with its area. A thin spun pail lands dead (its floor flexes and rings, as a drink can's does: e 0.27), where solid aluminium (0.85) let a pail
        # that fell onto the table bounce a hand high and topple: bounce 0.3, provisional
        pieces, _ = lift_parts(Wc, Hc)
        _, vol0 = lift_parts(0.08, 0.07)
        old0 = 0.04 * (0.08 * t + 2 * t * 0.07 + 2 * t * 0.10 + 0.08 * 0.004)
        cup = c.mat(base=alu, density=round(MATERIALS[alu]["density"] * old0 / vol0, 2), overrides={"bounce": 0.3})
        # what is hauled right up to its wheel (the lighter side) jams there, JAM_GAP under the rim where it comes nearest it: the weight by its flat top, the pail by its
        # bail's round wire (its crown, where the rope is tied, is then (ro + R + JAM_GAP) from the wheel's axle across their two centres, less ro). There each run's
        # rope end stops in its pulley (the joint's minLengthA/minLengthB), so the side that hauls it stops with it and hangs on the rope
        ro = Wc / 2
        runs = (round(_jam_run(-wx, R, -gap - sw / 2, -gap + sw / 2), 5), round(math.sqrt(sq(ro + R + JAM_GAP) - sq(gap - wx)) - ro, 5))
        c.slab("weight", sw, sw, sw, -gap, -drop - sw / 2, words="the falling weight")
        # the pail hangs by its bail from the rope, which is made fast at the top of the arch, `drop` below the pulley. Its pieces are welded to its heaviest part, which
        # carries the rope: the floor, or a wall of a pail taller than 4/3 of its width (the engine's welds once gave under a load hung from a light part far from its
        # middle; a weld group is now one rigid body, so this only says which part the rope is tied to)
        fy = -drop - t / 2 - Hc - Wc / 2
        xw, yw = Wc / 2 - t / 2, t / 2 + Hc / 2          # the walls' middles in the floor's frame
        crown_y = t / 2 + Hc + Wc / 2                    # the rope's tie, in the floor's frame
        if Wc >= 0.75 * Hc:
            root, ox, oy = "floor", 0.0, 0.0             # (where the floor's middle is in the root's frame)
            c.slab("floor", Wc, t, Wc, gap, fy, material=cup, look=alu, words="the floor of a pail")
        else:
            root, ox, oy = "wall1", xw, -yw
            c.slab("wall1", t, Hc, Wc, gap - xw, fy + yw, material=cup, look=alu, words="a wall of the pail")
        rid = f"{c.item['id']}/{root}"
        if root != "floor":
            _child(c, "floor", rid, Wc, t, Wc, ox, oy, cup, "the floor of a pail", alu)
        for n, sx in enumerate((-1, 1)):
            if f"wall{n + 1}" != root:
                _child(c, f"wall{n + 1}", rid, t, Hc, Wc, ox + sx * xw, oy + yw, cup, "a wall of the pail", alu)
        for n, q in enumerate(pieces):
            # (each piece's own origin is the floor's middle, as its points are, wherever the root is: web/models/mechanisms-pulleys.js draws it about that origin)
            _child_poly(c, f"bail{n + 1}", root, q, t, cup, "a piece of the pail's wire bail", alu)
            c.sb.solids[-1]["at"] = {"x": round(ox, 5), "y": round(oy, 5)}
        _joint(c, "pulley", "rope", a="weight", b=root, groundA=(-gap, 0), groundB=(gap, 0), anchorA=(0, sw / 2), anchorB=(ox, oy + crown_y), ratio=1.0, wheelRadius=round(wr, 4),
               minLengthA=runs[0], minLengthB=runs[1])
    register(ItemType("pulley-lift", "Pulley lift", "Springs & ropes", build_lift, material=wm, materials=_has(wm, "steel", "aluminium", "brick"),
                      props=[Prop("weight", "Falling weight", 0.3, 0.05, 3.0, 0.01, "kg"), Prop("cup_width", "Pail width", 0.08, 0.04, 0.3, 0.005, "m", "Across the pail; it is round, so it is as deep as it is wide"),
                             Prop("cup_height", "Pail height", 0.07, 0.03, 0.3, 0.005, "m"),
                             Prop("drop", "Rope below the pulley", 0.5, 0.2, 2.0, 0.01, "m", "From the pulley to the top of the weight at the start")],
                      tags=["hoist", "crane", "elevator", "lift", "winch", "counterweight", "bucket", "well", "pulley", "raise"],
                      description="A heavy weight on one side of a pulley, a light aluminium pail on the other: the weight falls and the pail rises, carrying what is in it.",
                      source="A weightless rope over an ideal pulley (as for an Atwood machine); the pail is round, of 3 mm aluminium, 2700 kg/m³ (weighed like the thin cup it replaces), with a wire bail.",
                      anchor="the middle of the pulley, between its two wheels", facts="0.3 kg weight lifts a 0.17 kg pail", edit=[]))


# ---------------------------------------------------------------- vehicles
# A vehicle's body is built from convex polygons (true side outlines), welded: `hull` returns them as a list of part specs
#   {"part", "pts": [(x, y), ...] in the chassis frame (origin = the body's middle) or None for the plain slab Lc x hh, "depth", "share", "base", "words"}
# the first is the chassis; "share" (a fraction of the body weight) and "base" (a material) give a part its own material (a skateboard's aluminium trucks),
# every other part shares one density, chosen so the whole body weighs exactly `body_mass` (the volume is split by area x depth).
# A motor car typed past its toy sizes grows to a ride-on toy car (12 V, about 1.1 m, 15-25 kg, 20-25 cm wheels, 1-2.5 m/s, two motors: approximate):
# its length to 1.2 m, wheels to 0.2 m, body to 30 kg and push to 150 N, the sliders still stopping at the toy's own most (0.5 m, 6.4 cm, 1.8 kg, 50 N)
BIG_CAR = {"length": 1.2, "wheel_diameter": 0.2, "body_mass": 30.0, "push": 150.0,
           "_help": {"length": "type up to 1.2 m: a ride-on toy car", "wheel_diameter": "type up to 0.2 m (a ride-on toy's)",
                     "body_mass": "type up to 30 kg (a ride-on toy car is 15-25 kg)", "push": "type up to 150 N (a ride-on toy's two motors)"}}


def _vehicle(key, name, *, L, h, d, mass, r, wheel_mass, axle, clear, hz, wheel_mat, wheel_mats, body_mat, body_look, hull, wheel_w, tuck, drive=None,
             tags, description, source, facts, big=None):
    """A body on two sprung (or rigid, hz = 0) wheels. Its anchor is the ground under the middle, where the wheels touch.
    The wheels' 3D track is the body's depth less `tuck` each side plus `wheel_w` (x the wheel radius) each side (web/models/vehicles.js reads the same numbers).
    `big` {prop key: most}: a typed value may go up to that (a ride-on toy's size, weight and push), the slider still stops at the toy's own most."""
    def build(c, P):
        Lc, r_, m, hz_ = P["length"], P["wheel_diameter"] / 2, P["body_mass"], P["suspension"]
        hz_ = 0.0 if hz_ <= 0 else max(hz_, 2.0)
        s = Lc / L
        sag = G / sq(2 * math.pi * hz_) if hz_ else 0.0        # how far the body settles on its springs
        lift = max(clear * r_, sag + 0.008)                        # the body's underside clears the ground, and its top the wheels, by more than that
        hh, dd, ax = max(h * s, 2 * r_ + sag + 0.004 - lift, 0.01), d * s, axle * s
        yc = lift + hh / 2
        parts = hull(Lc=Lc, hh=hh, dd=dd, r=r_, ax=ax, yc=yc, s=s, lift=lift, sag=sag)
        yc = parts[0].get("yc", yc)                                # a hull may stand its chassis somewhere else (a cart's thin deck above the wheels)
        vol = lambda p: (Lc * hh if p["pts"] is None else _area(p["pts"])) * p["depth"]      # noqa: E731
        fixed = sum(p["share"] * m for p in parts if p.get("share"))
        dens = (m - fixed) / sum(vol(p) for p in parts if not p.get("share"))
        body = c.mat(base=body_mat, density=round(dens, 3), overrides={})
        chassis = None
        for p in parts:
            material, look = body, p.get("look") or body_look
            if p.get("share"):
                material, look = c.mat(base=p["base"], density=round(p["share"] * m / vol(p), 3), overrides={}), p.get("look")
            words = p.get("words") or f"a {name.lower()}'s body"
            if chassis is None:
                chassis = (c.slab("chassis", Lc, hh, p["depth"], 0, yc, material=material, look=look, words=words) if p["pts"] is None
                           else c.poly("chassis", p["pts"], p["depth"], 0, yc, material=material, look=look, words=words))
            else:
                _child_poly(c, p["part"], chassis, p["pts"], p["depth"], material, words, look)
        # where the body's weight rests: the engine gives each wheel an equal share of it, so a body whose centre of mass is off the axles' middle (a cab-over truck's cab)
        # would sit nose-down. Each wheel's frequency is that of the load it really carries (k = share x m x (2 pi hz)^2 on both axles, so both sag by the same g/(2 pi hz)^2:
        # the body sits level) and its damping ratio is scaled with it, so the real ratio stays the same.
        moment = mass_sum = 0.0
        for p in parts:
            v = vol(p)
            mp = p["share"] * m if p.get("share") else dens * v
            moment += mp * (0.0 if p["pts"] is None else _centroid_x(p["pts"]))
            mass_sum += mp
        xcom = moment / mass_sum if mass_sum else 0.0
        wmass = wheel_mass * cube(r_ / r)
        wheel_density = round(wmass / ((4 / 3) * math.pi * cube(r_)), 3)
        wmat = c.mat(density=wheel_density)
        motor = None
        if drive:
            motor = {"speed": round(-P["speed"] / r_, 4), "torque": round(P["push"] * r_ / 2, 5)}
        track = round(dd - 0.002 if tuck is None else dd - 2 * tuck + 2 * wheel_w * r_, 5)   # front to back across both wheels and the axle: only the 3D look (tuck None: the tyres' outer faces 1 mm inside the body's sides)
        for part, sx in (("front", 1), ("rear", -1)):
            c.ball(part, r_, sx * ax, r_, material=wmat, inertia=0.5, shape="cylinder", length=round(dd + 0.02, 4), depth3d=track, words=f"a {name.lower()}'s wheel")
            share = min(0.85, max(0.15, (ax + sx * xcom) / (2 * ax)))         # the fraction of the body's weight on this axle
            k_ = math.sqrt(2 * share) if hz_ else 1.0
            f = dict(chassis="chassis", wheel=part, anchor=(sx * ax, r_ - yc), axis={"x": 0.0, "y": 1.0}, frequency=round(hz_ * k_, 4), damping=round(0.7 * k_, 4))
            if motor:
                f["motor"] = motor
            _joint(c, "wheel", f"axle-{part}", **f)
    big = big or {}

    def most(k, toy, help_=""):
        """(max, slider_max, help): the toy's own most, or the big one for a typed value with the slider still at the toy's."""
        if k not in big:
            return toy, None, help_
        return big[k], toy, (help_ + "; " if help_ else "") + big["_help"][k]
    lm, ls, lh = most("length", round(L * 2.5, 3))
    wm, ws, wh = most("wheel_diameter", round(4 * r, 3))
    mm, ms, mh = most("body_mass", round(mass * 6, 3), "The body with its cabin, without the wheels")
    props = [Prop("length", "Body length", L, round(L / 2, 3), lm, 0.005, "m", lh, slider_max=ls), Prop("wheel_diameter", "Wheel diameter", 2 * r, round(r, 3), wm, 0.002, "m", wh, slider_max=ws),
             Prop("body_mass", "Body weight", mass, round(mass / 5, 4), mm, 0.005, "kg", mh, slider_max=ms), Prop("suspension", "Suspension", hz, 0.0, 20.0, 0.5, "Hz", "How fast the body bounces on its springs (2 or more); 0 is rigid axles")]
    if drive:
        pm, ps, ph = most("push", 50.0, "The most force the wheels give; it spins its wheels if the ground can't hold it")
        props += [Prop("speed", "Top speed", drive[0], 0.1, 10.0, 0.1, "m/s", "The speed the wheels drive up to"), Prop("push", "Push", drive[1], 0.1, pm, 0.1, "N", ph, slider_max=ps)]
    register(ItemType(key, name, "Wheels & vehicles", build, material=wheel_mat, materials=wheel_mats, props=props, tags=tags, description=description, source=source,
                      anchor="the ground under its middle, where the wheels touch", facts=facts, edit=[{"kind": "length", "prop": "length"}, {"kind": "rotate"}]))


def _hull_slab(Lc, hh, dd, **_):
    return [{"part": "chassis", "pts": None, "depth": dd}]


def _hull_cab(low, cab):
    """A body of two convex pieces: a lower body (points as fractions u = x / length, v = y / height of the body's box, -0.5 .. 0.5) and a cab
    standing on its flat top (v = 0.5), with `cab` = (points as fractions of the length, height as a fraction of the body's height, depth as a fraction of its depth)."""
    cab_pts, ch, cd = cab

    def hull(Lc, hh, dd, **_):
        lower = [(round(u * Lc, 5), round(v * hh, 5)) for u, v in low]
        upper = [(round(u * Lc, 5), round((0.5 + w * ch) * hh, 5)) for u, w in cab_pts]
        return [{"part": "chassis", "pts": lower, "depth": dd}, {"part": "cabin", "pts": upper, "depth": round(cd * dd, 5), "words": "a cabin"}]
    return hull


def _hull_deck(thick, gap=0.002):
    """A wagon's bed: one plank deck `thick` metres thick whose underside rides `gap` over the wheels' tops (rigid axles need no more): nothing is under it
    but the axle-trees, which are drawn inside the wheels' side-view discs (as a skateboard's hangers are). The chassis stands where the deck is (`yc`)."""
    def hull(Lc, dd, r, **_):
        y0 = 2 * r + gap
        t = thick
        return [{"part": "chassis", "pts": [(-Lc / 2, -t / 2), (Lc / 2, -t / 2), (Lc / 2, t / 2), (-Lc / 2, t / 2)], "depth": dd, "yc": y0 + t / 2, "words": "the wagon's bed"}]
    return hull


def _hull_flatbed(slab, cab, gap=0.0035):
    """A cab-over flatbed: a frame-and-deck slab `slab` metres thick (its top where a solid body's top would be), the cab on it, and two welded blocks for the cab's
    lower front, one ahead of the front wheel and one behind it, each stopping `gap` short of the wheel (a welded part collides with the wheels) and reaching down to
    the old body's underside: the front wheel stands in an arch between them. Everything else under the deck is open, so a ball can roll under it."""
    cab_pts, ch, cd = cab

    def hull(Lc, hh, dd, r, ax, lift, s, sag, **_):
        t = slab * s
        top = max(lift + hh, 2 * r + sag + 0.016)                    # the cab (a welded part: it collides with the wheels) rides 12 mm over the loaded wheels' tops, for the nose to dive on a slope
        yc = top - t / 2
        out = [{"part": "chassis", "pts": [(-Lc / 2, -t / 2), (Lc / 2, -t / 2), (Lc / 2, t / 2), (-Lc / 2, t / 2)], "depth": dd, "yc": yc, "words": "the frame and deck"},
               {"part": "cabin", "pts": [(round(u * Lc, 5), round(t / 2 + w * ch * hh, 5)) for u, w in cab_pts], "depth": round(cd * dd, 5), "words": "a cabin"}]
        back = min(u for u, _ in cab_pts) * Lc
        # the skirt ends about at hub height once the body has settled: the apron and the step reach down to 0.8 r over the table at rest (0.8 r + sag at the start), never lower than the old
        # body's underside (lift) and never closer than 12 mm to the deck's underside; their bottoms in the chassis frame
        bottom = max(lift, min(0.8 * r + sag, top - t - 0.012)) - yc
        for part, x0, x1, words in (("apron", ax + r + gap, Lc / 2, "the lower front of the cab"), ("step", back, ax - r - gap, "the lower back of the cab")):
            if x1 - x0 > 0.006 and (-t / 2 - bottom) > 0.006:
                pts = [(x0, bottom), (x1 - 0.006, bottom), (x1, bottom + 0.006), (x1, -t / 2), (x0, -t / 2)] if part == "apron" else [(x0, bottom), (x1, bottom), (x1, -t / 2), (x0, -t / 2)]
                out.append({"part": part, "pts": [(round(a, 5), round(b, 5)) for a, b in pts], "depth": dd, "words": words})
        return out
    return hull


def _hull_board(kick_deg, kick_len, flat):
    """A skateboard: a flat middle (a polygon), a kicktail at each end (a parallelogram rising at kick_deg over kick_len x the board's length), and an
    aluminium truck over each axle: a trapezoid from the deck down to just over the wheels (baseplate and bushings; the hanger and axle below it are drawn inside the wheels' outlines), a fifth of the body weight each."""
    tan = math.tan(math.radians(kick_deg))

    def hull(Lc, hh, dd, r, ax, yc, s, **_):
        a, Lk, t = flat * Lc, kick_len * Lc, hh
        mid = [(-a, -t / 2), (a, -t / 2), (a, t / 2), (-a, t / 2)]
        xe = a + Lk
        out = [{"part": "chassis", "pts": [(round(x, 5), round(y, 5)) for x, y in mid], "depth": dd, "words": "the deck"}]
        for sx, name in ((1, "nose"), (-1, "tail")):
            k = [(a, -t / 2), (xe, -t / 2 + Lk * tan), (xe, t / 2 + Lk * tan), (a, t / 2)]
            k = [(round(sx * x, 5), round(y, 5)) for x, y in k]
            out.append({"part": name, "pts": k if sx > 0 else k[::-1], "depth": dd, "words": f"the deck's {name}"})
        hw = 0.0475 * min(1.0, s)
        bottom = 2 * r + 0.0035 - yc                             # the solid truck stops 3.5 mm over the wheels' tops (a welded part collides with them); the hanger below is only drawn
        for sx, name in ((1, "truck1"), (-1, "truck2")):
            x = sx * ax
            tr = [(x - 0.02 * min(1.0, s), bottom), (x + 0.02 * min(1.0, s), bottom), (x + hw, -t / 2), (x - hw, -t / 2)]
            out.append({"part": name, "pts": [(round(px, 5), round(py, 5)) for px, py in tr], "depth": 0.136 * min(1.0, 0.5 + s / 2), "share": 0.18, "base": "aluminium" if "aluminium" in MATERIALS else "steel",
                        "words": "a skateboard truck"})
        return out
    return hull


def _vehicles():
    tyre, urethane = "tyre rubber", "urethane"
    dark = "dark wood" if "dark wood" in MATERIALS else "varnished hardwood"
    plastic_wheels = _has("tyre rubber", "bicycle tyre", "solid rubber", "hollow plastic", "varnished hardwood")
    # a die-cast hatchback at about 1:19 (a 3.8 m car is 20 cm): 34 mm wheels, a wheelbase of 126 mm with a short overhang at each end, 12 mm of ground clearance, a belt line
    # 48 mm up and a roof 74 mm up; the hood and the tail slope away from a bubble cabin. The body's side outline is two convex polygons (a lower body and a cabin).
    hatch = _hull_cab([(-0.45, -0.5), (0.45, -0.5), (0.5, -0.34), (0.5, 0.10), (0.22, 0.5), (-0.30, 0.5), (-0.5, 0.30), (-0.5, -0.34)],
                      ([(-0.29, 0.0), (0.20, 0.0), (0.075, 1.0), (-0.19, 1.0)], 0.72, 0.9))
    # a low sports coupe: a longer, lower hood, a fastback cab; 32 mm wheels, a roof 60 mm up (length / height 3.3)
    coupe = _hull_cab([(-0.47, -0.5), (0.47, -0.5), (0.5, -0.25), (0.5, 0.05), (0.15, 0.5), (-0.36, 0.5), (-0.5, 0.25), (-0.5, -0.30)],
                      ([(-0.36, 0.0), (0.12, 0.0), (-0.03, 1.0), (-0.18, 1.0)], 0.62, 0.9))     # the fastback starts where the body's flat top ends (-0.36)
    _vehicle("toy-car", "Toy car", L=0.2, h=0.036, d=0.08, mass=0.3, r=0.017, wheel_mass=0.011, axle=0.063, clear=0.5, hz=8.0, wheel_mat=tyre, wheel_mats=plastic_wheels,
             body_mat="hollow plastic", body_look="plastic", hull=hatch, wheel_w=0.53, tuck=None,
             tags=["car", "vehicle", "roller", "model car", "toy", "drive", "ramp", "wheels", "suspension", "matchbox", "hot wheels"],
             description="A toy car: a body on two sprung wheels. Put it on a ramp and it rolls down; the wheels turn and the body bobs on its springs.",
             source="Sprung wheels: a body of mass m on springs of frequency f sags g/(2πf)². A 20 cm die-cast toy at about 1:19 (34 mm wheels, 126 mm wheelbase); sizes, weights and the 0.012 rolling resistance of rubber tyres are provisional.",
             facts="20 cm · 0.3 kg body · 3.4 cm wheels")
    _vehicle("motor-car", "Motor car", L=0.2, h=0.03, d=0.08, mass=0.3, r=0.016, wheel_mass=0.0091, axle=0.064, clear=0.5, hz=8.0, wheel_mat=tyre, wheel_mats=plastic_wheels,
             body_mat="hollow plastic", body_look="plastic", hull=coupe, wheel_w=0.53, tuck=None, drive=(1.5, 2.0),
             tags=["car", "motor", "electric", "drive", "powered", "rc", "engine", "robot", "vehicle", "self propelled", "wheel motor"],
             description="A toy sports car with motors on both axles. It speeds up to its top speed (to the right when level) and pushes with up to its set force.",
             source="Motors drive each wheel toward a set turning speed within a torque limit (wheel torque = push × radius / 2); the car's size and weight are provisional (a 20 cm, 6 cm tall coupe on 32 mm wheels). It can't push harder than the ground's grip, friction × its weight. "
                    "Typed, it grows to a ride-on toy car (a 12 V one: about 1.1 m, 15-25 kg, 20-25 cm wheels, 1-2.5 m/s; approximate).",
             facts="1.5 m/s top speed · pushes 2 N · 3.2 cm wheels", big=BIG_CAR)
    # a wooden wagon: a thin plank bed (12 mm) 2 mm over the wheels' tops, on axle-trees; the wheels stand outside the bed (8 mm clear of its sides, a hub's length)
    _vehicle("cart", "Cart", L=0.22, h=0.012, d=0.08, mass=0.2, r=0.025, wheel_mass=0.03, axle=0.075, clear=0.5, hz=0.0, wheel_mat=dark, wheel_mats=_has("dark wood", "varnished hardwood", "steel", "tyre rubber"),
             body_mat="varnished hardwood", body_look="wood", hull=_hull_deck(0.012, 0.002), wheel_w=0.3, tuck=-0.008,
             tags=["trolley", "wagon", "dynamics cart", "lab cart", "wheeled", "track", "carry", "flatbed", "load", "wheelbarrow"],
             description="A flat wooden cart on two rigid axles: it rolls freely and carries what is put on it.",
             source="A teaching-lab dynamics cart is a few hundred grams and about 20 cm long (provisional); wooden wheels on wood roll with about 0.004 (provisional).",
             facts="22 cm · 0.2 kg bed · 5 cm wheels")
    _vehicle("skateboard", "Skateboard", L=0.8, h=0.015, d=0.2, mass=2.5, r=0.027, wheel_mass=0.34, axle=0.19, clear=2.9, hz=0.0, wheel_mat=urethane, wheel_mats=_has("urethane", "tyre rubber"),
             body_mat="varnished hardwood", body_look="wood", hull=_hull_board(17.0, 0.2, 0.3), wheel_w=1.18, tuck=0.032,
             tags=["board", "skate", "deck", "trucks", "ride", "street", "park", "wheels", "longboard", "roll"],
             description="A skateboard deck on two trucks with hard urethane wheels. It rolls a long way on a smooth floor.",
             source="A deck is about 20 cm wide and 80 cm long, 7-ply maple about 12 mm thick plus its grip tape and raised concave rails (15 mm in all), with kicktails of about 17° at each end; the wheels are 52-54 mm and a complete board weighs about 3 kg (typical sizes). Weights split between deck, trucks and wheels (a fifth of the 2.5 kg body in each aluminium truck), and the rolling resistance, are provisional.",
             facts="80 cm deck · 5.4 cm wheels · about 3 kg")
    cabover = _hull_flatbed(0.035, ([(0.18, 0.0), (0.5, 0.0), (0.485, 0.86), (0.45, 1.0), (0.24, 1.0), (0.185, 0.9)], 1.2, 1.0))     # the cab's face is flush with the nose (x = L/2): one flat front from the bumper to the roof
    _vehicle("truck", "Truck", L=0.5, h=0.08, d=0.2, mass=2.0, r=0.05, wheel_mass=0.35, axle=0.17, clear=0.6, hz=4.0, wheel_mat=tyre, wheel_mats=plastic_wheels,
             body_mat="hollow plastic", body_look="plastic", hull=cabover, wheel_w=0.56, tuck=None,
             tags=["lorry", "pickup", "van", "heavy", "vehicle", "toy truck", "big", "wheels", "suspension", "dump"],
             description="A big heavy toy truck with a cab and soft springs. It takes a lot more to stop than a toy car.",
             source="A 50 cm, 2 kg toy truck (provisional): a 35 mm frame-and-deck slab with the cab on it, open underneath between the axles; rubber tyres with a rolling resistance of 0.012 (handbook range 0.010-0.015).",
             facts="50 cm · 2 kg body · 10 cm wheels")


# ---------------------------------------------------------------- wheels
def _wheels():
    # --- a rolling disc
    def build_wheel(c, P):
        r, t = P["diameter"] / 2, P["thickness"]
        rho = MATERIALS[P["material"]]["density"]
        c.ball("wheel", r, material=c.mat(density=round(rho * 3 * t / (4 * r), 4)), inertia=0.5, shape="cylinder", length=t, depth3d=t, words="a solid wheel")
    register(ItemType("wheel", "Wheel", "Wheels & vehicles", build_wheel, material="varnished hardwood", materials=_has("varnished hardwood", "steel", "solid rubber", "aluminium", "dark wood", "concrete"),
                      props=[Prop("diameter", "Diameter", 0.2, 0.03, 1.0, 0.005, "m"), Prop("thickness", "Thickness", 0.03, 0.005, 0.3, 0.005, "m", "Front to back: only the 3D look and the weight")],
                      tags=["disc", "roller", "tyre", "cylinder", "rolling", "spin", "round", "gear", "flywheel", "hoop"],
                      description="A solid disc that rolls: its inertia is ½mr², so down a slope it gains speed at ⅔ of g sin θ (a ball does 5⁄7).",
                      source="A solid disc: moment of inertia ½mr²; rolling down a slope a = g sin θ / (1 + ½) (textbook). Wood about 700 kg/m³.",
                      anchor="its centre", facts="20 cm · 3 cm thick · ½mr² inertia", edit=[{"kind": "radius", "prop": "diameter"}]))

    # --- a bicycle wheel: most of the mass in the rim
    def build_bike(c, P):
        r, t = P["diameter"] / 2, 0.03
        c.ball("wheel", r, material=c.mat(density=round(P["mass"] / ((4 / 3) * math.pi * cube(r)), 4)), inertia=P["inertia"], shape="cylinder", length=t, depth3d=0.1, words="a bicycle wheel")   # 3D: a 3 cm tyre on a 10 cm hub
    register(ItemType("bicycle-wheel", "Bicycle wheel", "Wheels & vehicles", build_bike, material="bicycle tyre", materials=_has("bicycle tyre", "tyre rubber"),
                      props=[Prop("diameter", "Diameter", 0.68, 0.3, 0.9, 0.01, "m"), Prop("mass", "Weight", 1.3, 0.3, 4.0, 0.05, "kg", "Rim, spokes, tyre and tube"),
                             Prop("inertia", "Inertia", 0.85, 0.5, 1.0, 0.01, "of m·r²", "1 is a hoop with all the mass at the rim, ½ a solid disc")],
                      tags=["bike", "cycle", "hoop", "rim", "spokes", "tyre", "rolling", "flywheel", "gyroscope", "road bike"],
                      description="A bicycle wheel: nearly all its mass is in the rim and tyre, so its inertia is close to a hoop's (mr²) and it rolls down a slope slower than a disc.",
                      source="A road wheel is 622 mm rim plus a 25-28 mm tyre, about 0.68 m across (ISO 5775); wheel, tyre and tube weigh about 1.3 kg and the inertia is about 0.85 mr² (both provisional).",
                      anchor="its centre", facts="68 cm · 1.3 kg · 0.85 mr² inertia", edit=[{"kind": "radius", "prop": "diameter"}]))


# ---------------------------------------------------------------- motors and belts
def _motors():
    # --- motor spinner
    def build_spinner(c, P):
        L, d = P["length"], P["depth"]
        # the paddle is keyed on the shaft of a gear motor that stands behind it: the shaft is a static hub (6 mm, always inside the 2 cm paddle, so nothing else
        # can reach it) that carries the driven hinge, and the view stands the hub on a retort stand behind the paddle (a bracket from the wall when it is over
        # 1.3 m up). web/models/mechanisms.js draws the shaft's nut on the paddle's front, the motor behind it and the stand's arm into the motor's back: the
        # hub is drawn as deep as that (MOTOR_BACK behind the paddle's back face, as much again in front, where only the nut is)
        if c.kind == "dynamic":
            high = c.world(0, -0.006)[1] > 1.3
            c.ball("hub", 0.006, 0, 0, kind="static", material=_steel(c), look="steel", words="the motor's shaft", depth3d=round(d + 2 * MOTOR_BACK, 5),
                   stand="wall" if high else "post")
            # (the paddle also names its pivot on the hub, as every hinged part does, so a run's summary says how far it turned; the driven hinge is the pin joint,
            # and neither is drawn as a generic hinge: the model draws the motor)
            hub = c.sb.solids[-1]["id"]
            c.slab("paddle", L, 0.02, d, 0, 0, words="a motor-driven paddle", pivot={"x": 0.0, "y": 0.0}, parent=hub)
            c.sb.solids[-1]["at"] = {"x": 0.0, "y": 0.0}        # (a part with a parent stands in its parent's frame)
            c.sb.solids[-1].pop("angle", None)
            _joint(c, "pin", "hinge", a="hub", b="paddle", anchorA=(0, 0), anchorB=(0, 0), motor={"speed": round(P["rpm"] * math.tau / 60, 5), "torque": P["torque"]},
                   render={"hinge": "none"})
        else:
            # fixed, it is a plank held up on a stand of its own
            c.slab("paddle", L, 0.02, d, 0, 0, words="a paddle", stand="wall" if c.world(0, -0.01)[1] > 1.3 else "post")
    register(ItemType("motor-spinner", "Motor spinner", "Motors & belts", build_spinner, material="varnished hardwood", materials=_has("varnished hardwood", "aluminium", "steel"),
                      props=[Prop("length", "Paddle length", 0.4, 0.1, 1.5, 0.01, "m"), Prop("depth", "Front to back", 0.1, 0.02, 0.6, 0.01, "m", "Only for the 3D look and the weight"),
                             Prop("rpm", "Speed", 60.0, -300.0, 300.0, 1.0, "turns/min", "Positive turns it counter-clockwise"),
                             Prop("torque", "Motor strength", 2.0, 0.05, 50.0, 0.05, "N·m", "The most turning force; a stuck paddle stalls")],
                      tags=["propeller", "rotor", "arm", "sweeper", "paddle wheel", "windmill", "turntable", "fan blade", "rotate", "motor"],
                      description="A paddle on the shaft of a gear motor (on a stand behind it): it turns at a steady speed and sweeps anything in its way, unless it is too strong to turn.",
                      source="A motor holds its turning speed up to its torque limit, then slows (stalls). Sizes and strengths are provisional.",
                      anchor="the motor's shaft, at the paddle's middle", facts="40 cm paddle · 60 turns/min", edit=[{"kind": "length", "prop": "length"}, {"kind": "rotate"}]))

    # --- conveyor belt
    def build_belt(c, P):
        L, t, d = P["length"], 0.04, P["depth"]
        c.slab("belt", L - t, t, d, 0, -t / 2, kind="static", words="a conveyor belt", look="belt", material=c.mat(), surfaceSpeed=P["speed"], legs=bool(P["legs"]))
        steel = c.mat(base="steel", overrides={})
        for n, sx in enumerate((-1, 1)):
            c.ball(f"roller{n + 1}", t / 2, sx * (L - t) / 2, -t / 2, kind="static", material=steel, shape="cylinder", length=d, look="steel", words="a belt roller")
    register(ItemType("conveyor-belt", "Conveyor belt", "Motors & belts", build_belt, dynamic=False, material="conveyor belt", materials=_has("conveyor belt", "rubber mat", "carpet"),
                      props=[Prop("length", "Length", 1.0, 0.2, 3.0, 0.01, "m"), Prop("depth", "Width (front to back)", 0.3, 0.05, 1.0, 0.01, "m", "Only for the 3D look and the weight"),
                             Prop("speed", "Belt speed", 1.0, -5.0, 5.0, 0.05, "m/s", "How fast the top runs to the right; negative runs it to the left (turn the item to tilt it)"),
                             Prop("legs", "Legs under it (3D)", True, kind="bool")],
                      tags=["belt", "treadmill", "luggage", "assembly line", "transport", "carry", "factory", "moving floor", "airport", "rollers"],
                      description="A belt whose top runs along it at a set speed: things on it are carried along, a block at the belt's speed and a ball a good deal slower to begin with.",
                      source="Package conveyors run at 0.2-2 m/s (typical); a block rides at the belt's speed, a rolling ball only reaches 2/7 of it before rolling resistance speeds it on (a solid ball dropped on a moving surface; textbook).",
                      anchor="the middle of its top surface", facts="1 m · runs 1 m/s to the right", edit=[{"kind": "length", "prop": "length"}, {"kind": "rotate"}]))

    # --- pinball flipper
    def build_flipper(c, P):
        L, t, a0, sw = P["length"], 0.022, P["rest_angle"], P["sweep"]
        a = a0 * D2R
        piv = 0.014
        steel = c.mat(base="steel", overrides={})
        # the pivot is a 12 mm shoulder bolt through the bat's round hub: it must stay inside the hub's round end (11 mm), so a 6 mm radius post
        c.ball("post", 0.006, 0.0, 0.0, kind="static", material=steel, shape="cylinder", look="steel", depth3d=0.044, words="the post the flipper turns on")
        mid = L / 2 - piv
        # a tapered bat: a round hub at the pivot narrowing to a small rounded tip (an octagon). A real bat stands about 24 mm tall on the playfield (the ball is 27 mm):
        # a plastic bat and its shaft weigh about 40 g, so the plastic is given the density that makes it so
        h, tip = t / 2, 0.136 * t
        bat = [(-L / 2 + 0.0085, -h), (L / 2 - 0.008, -0.255 * t), (L / 2, -tip), (L / 2, tip), (L / 2 - 0.008, 0.255 * t), (-L / 2 + 0.0085, h), (-L / 2, 0.27 * t), (-L / 2, -0.27 * t)]
        depth = 0.024
        rho = round(FLIPPER_MASS / (_area(bat) * depth), 1)
        c.poly("flipper", bat, depth, mid * cos(a), mid * sin(a), langle=a0, words="a pinball flipper", material=c.mat(density=rho))
        sgn = 1 if sw >= 0 else -1
        _joint(c, "pin", "hinge", a="post", b="flipper", anchorA=(0, 0), anchorB=(-L / 2 + piv, 0), render={"hinge": "none"},      # the flipper's own pivot is drawn, and its coil is under the playfield
               motor={"speed": round(sgn * P["speed"] * D2R, 4), "torque": P["torque"]}, limits={"lower": round(min(0.0, sw * D2R), 5), "upper": round(max(0.0, sw * D2R), 5)})
    register(ItemType("pinball-flipper", "Pinball flipper", "Motors & belts", build_flipper, material="solid rubber", materials=_has("solid rubber", "varnished hardwood", "aluminium", "steel"),
                      props=[Prop("length", "Length", 0.078, 0.04, 0.6, 0.002, "m"), Prop("rest_angle", "Rest angle", -30.0, -180.0, 180.0, 1.0, "°", "Which way it points when down: 0 is to the right, −30 a little below"),
                             Prop("sweep", "Flip", 60.0, -150.0, 150.0, 1.0, "°", "How far it turns at the release before its stop; negative turns it clockwise (for a flipper on the left)"),
                             Prop("speed", "Flip speed", 1200.0, 100.0, 3000.0, 50.0, "°/s"), Prop("torque", "Motor strength", 0.5, 0.05, 20.0, 0.05, "N·m")],
                      tags=["arcade", "paddle", "kicker", "bat", "flip", "hit", "pinball machine", "strike", "hinge", "motor"],
                      description="A flipper on a motorized hinge with a stop: at the scene's release it flips up through its set angle at its set speed and hits whatever rests on it.",
                      source="A hinge driven by a motor to a set speed within a torque limit, stopped at a limit (revolute joint with motor and limits). A standard pinball flipper bat is 3 in (76-80 mm) long (flippers.be; makers' standard bats are 80 mm). Speed and strength are provisional.",
                      anchor="the hinge, at the flipper's base", facts="7.8 cm · flips 60° at 1200°/s", edit=[{"kind": "rotate"}]))
