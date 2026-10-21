"""The energy module (2026-10-20): devices that turn one form of energy into another (NGSS 4-PS3-4, "design a device that converts energy"):
a paper windmill (pinwheel) and a model wind turbine turned by the wind the engine blows (a fan's round jet, the liquids module's breeze), a
spool on their shaft and on the flow module's waterwheel that winds a thread to lift a cup of pennies, a small generator on any of those
turning shafts (EMF k*w, and a torque k*I that holds the shaft back as its current flows) that lights an LED with the circuits module's
parts, and (machines/mod_circuits.py, its motor's `drives: wheels`) a motor that drives a car's wheels: a battery car.

items.py imports this file after the catalog files and the modules before it in name order (circuits, flow) and calls register_all(globals());
web/sim/modules/energy.js is its exact port (the same documents, number for number). The engine side: tooling/src/sim/energy.ts (blade-element
momentum: every blade element meets the air where it is) and tooling/src/sim/modules/energy.ts (the process kind "energy": roles rotor, pass);
a spool is the mechanics module's spool record (tooling/src/sim/mechanics.ts SpoolRope) and a generator a part of the circuits module's one
circuit record (tooling/src/sim/circuits.ts, "generator" with a rotor). A scene with none of these items builds exactly as before.

How a rotor is built: its blades turn about a shaft along the wind (the rotor faces the wind, so from the front the picture shows it edge-on,
or turned toward the viewer by `yaw`). The engine's bodies turn about the picture's own axis only, so the turning is carried by a stand-in:
a hidden body (`hub`, touching nothing) hinged at the spool's place, whose spin is the rotor's about its shaft and whose rotational inertia is
the blades', hub's and shaft's; the wind's torque twists it (the energy record), the spool's thread winds on it (mechanics), the generator's
current holds it back (circuits). The 3D view turns the drawn blades by the rotor's `angle` reading.

Sources:
  [JWEA] Pinwheel type wind turbines in a wind tunnel (Wind Engineering 27, 2003; J. Japan Wind Energy Assoc. 27-1): a conventional
         four-blade pinwheel C_p,max 0.17 at tip speed ratio 2; a high-speed one 0.22 at 3.5 (no-load ratio 3-6); a high-torque one
         C_Q,max 0.24 at 0.32. The default pinwheel's blade elements (solidity 0.3, sails at 18 deg at the tips twisting to 33 deg at the
         hub) give 0.172 at 1.95 (research/rw-validate-energy.ts).
  [VERNIER] Vernier/KidWind "Wind Turbine Generator / Motor, specifications for using as a generator" (generator_data.pdf): open circuit
         2.13 V at 720 rpm, 4.25 V at 1440, 6.54 at 2450, 9.81 at 3630; with 100 ohm 1.59 V at 720 rpm and 3.14 V at 1440 (internal
         resistance about 38 ohm from those rows); KidWind generator KW-GEN3 (1.25 in, 2 mm shaft, 0-10 V, 0-0.3 A, rated 5.9 V at
         2000 rpm no load: k = 0.0282 V*s/rad); "the generator shaft has to be spinning at around 700 rpm to produce the roughly 1.75 V a
         red LED needs".
  [KIDWIND] KidWind MINI Wind Turbine manual: about 3 ft in front of a 14-18 in box fan on high its LED lights; typical output 1-4 V.
  [MAB] Mabuchi FA-130RA (the circuits module's hobby motor): 9100 rpm and 0.2 A at 3 V with no load, 2.2 A stalled; as a generator
         k = 2.86 mV*s/rad, 1.36 ohm.
  [PENNY] A US cent weighs 2.5 g (US Mint); a 3 oz paper cup about 3 g.
  Provisional (judgements, said so in the texts): the sheets' areal densities (copy paper 80 g/m2, card 200, a plastic sheet 140; corrugated
  plastic 650, poster board 300, balsa 320), a straw on a skewer's friction (mu 0.3 at 1.5 mm), the generators' friction (KidWind 0.2 mN*m,
  FA-130 its no-load 0.57 mN*m) and rotor inertia, a shaft bushing's (mu 0.15 at 1 mm).
"""
import math

from crmath import cos, sin

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "register_goal_kind", "register_build_hook", "register_common_prop", "MATERIALS",
          "add_look", "props_of", "TYPES", "CATEGORIES", "Ctx", "D2R")

MODULE = "energy"
CAT = "Energy devices"
PENNY_G = 2.5                   # g: a US cent [PENNY]
CUP_G = 3.0                     # g: a 3 oz paper cup [PENNY]
CUP_W, CUP_H, CUP_D = 0.05, 0.06, 0.05      # m: the load's cup (its body: a box as wide and tall as the cup)
SPOOL_GAP = 0.02                # m: the cup's handle stops this far under the spool (the thread is wound up)
# a pinwheel: its sails as blade elements (solidity, the sails' twist toward the middle, skin friction)
PIN_SOLIDITY = 0.3
PIN_TWIST = 15.0                # deg more at the hub than at the tips
PIN_HUB = 0.012                 # m: the sails start this far from the axle (the bead and pin at the middle)
CD0 = 0.02                      # a thin sheet's skin friction (both faces), laminar at Re about 2e4 (1.328/sqrt(Re) a face)
PAPERS = {"copy paper": 0.080, "card": 0.200, "plastic sheet": 0.140}           # kg/m2 (provisional)
BLADE_SHEETS = {"corrugated plastic": 0.650, "cardboard": 0.300, "balsa": 0.320}  # kg/m2 (provisional)
DOWEL = 0.020                   # kg/m: a 6 mm wooden dowel holding each turbine blade
STRAW_MU, STRAW_R = 0.3, 0.0015     # a plastic straw turning on a 3 mm wooden skewer (provisional)
SHAFT_MU, SHAFT_R = 0.15, 0.001     # a 2 mm steel shaft in a plastic bushing (provisional)
TURBINE_HUB = 0.03              # m: a crimping hub's blades start this far from the shaft
# generators: k (V*s/rad), R (ohm), friction (N*m), rotor inertia (kg*m2), can (length, diameter, m) [VERNIER] [MAB]
_FA130_K = round((3 - 0.2 * (3 / 2.2)) / (9100 * 2 * math.pi / 60), 7)
GENERATORS = {
    "KidWind generator": dict(k=round(5.9 / (2000 * 2 * math.pi / 60), 6), r=38.0, fric=0.0002, J=5e-07, can=(0.045, 0.032)),
    "hobby motor": dict(k=_FA130_K, r=round(3 / 2.2, 4), fric=round(0.2 * _FA130_K, 7), J=3e-08, can=(0.038, 0.02)),
}
# the turning shafts a generator may sit on: the part that turns, and where its axle is in its item's frame (geometry below)
SHAFT_TYPES = ("waterwheel", "pinwheel", "wind-turbine", "wheel-and-axle")


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CAT not in CATEGORIES:
        CATEGORIES.append(CAT)
    _looks()
    _pinwheel()
    _turbine()
    _generator()
    # (a spool on the flow module's waterwheel: props every waterwheel lists, built by the hook only for one that sets a load)
    register_common_prop(Prop("load_g", "Load on its axle", 0.0, 0.0, 2000.0, 1.0, "g",
                              "A cup of pennies on a thread wound on its axle (a US cent is 2.5 g); 0: no thread", slider_max=500.0),
                         lambda t: t.key == "waterwheel")
    register_common_prop(Prop("axle_mm", "Spool across", 12.0, 2.0, 40.0, 0.5, "mm", "Where the thread winds: a thinner spool lifts a heavier load, more slowly"),
                         lambda t: t.key == "waterwheel")
    register_common_prop(Prop("winds", "Thread winds as it turns", "auto", kind="choice", choices=["auto", "clockwise", "counter-clockwise"],
                              help="auto: the way the stream above it turns it (falling on its right, clockwise)"),
                         lambda t: t.key == "waterwheel")
    register_build_hook(_wheel_spools)
    for kind, fn in (("generates", goal_generates), ("generates_more", goal_generates_more), ("lifts_higher", goal_lifts_higher)):
        register_goal_kind(kind, fn)


def _looks():
    if "turbine plastic" not in MATERIALS:
        add_look("turbine plastic", fill="#e8e9ec", shade="#a9adb5", roughness=0.45, metalness=0.0, clearcoat=0.2)
        MATERIALS["turbine plastic"] = dict(density=1100, bounce=0.5, friction=0.4, rolling=0.01, side=0.0, look="turbine plastic",
                                            source="ABS and polypropylene parts, 900-1200 kg/m3 (provisional).")


# ---------------------------------------------------------------- helpers
def _r(v, d=5):
    return round(v, d)


def _side(P):
    """+1 when the wind comes from the left (the rotor faces left, its shaft pointing downwind to +x), -1 from the right."""
    return 1.0 if P["facing"] == "left" else -1.0


def _rotor_inertia(B, r0, R, c0, c1, sheet, dowel=0.0):
    """B flat blades of areal density `sheet` (kg/m2), chord c0 at r0 tapering to c1 at R, each on a dowel of `dowel` kg/m from r0 to R:
    their moment of inertia about the shaft, the integral of sheet*c(r)*r^2 dr + dowel*r^2 dr, and their mass."""
    slope = (c1 - c0) / (R - r0)
    a = c0 - slope * r0
    r3 = R * R * R - r0 * r0 * r0
    r4 = R * R * R * R - r0 * r0 * r0 * r0
    J = B * (sheet * (a * r3 / 3 + slope * r4 / 4) + dowel * r3 / 3)
    m = B * (sheet * (a * (R - r0) + slope * (R * R - r0 * r0) / 2) + dowel * (R - r0))
    return J, m


def _stand_in(c, x, y, J, m, kind):
    """The rotor's stand-in: a hidden body hinged at (x, y) (its own middle) that touches nothing, whose rotational inertia J (kg*m2) and mass m (kg)
    are the rotor's: a ball of radius sqrt(2J/m) with inertia 1/2 m r^2."""
    m = max(m, 1e-5)
    rs = max(0.005, math.sqrt(2 * J / m))
    rs = _r(rs)
    dens = m / (4 / 3 * math.pi * rs * rs * rs)
    mat = c.mat(base="turbine plastic", density=float(f"{dens:.6g}"), overrides={})
    return c.ball("hub", rs, x, y, material=mat, kind=kind, look="turbine plastic", words="the rotor's shaft", inertia=0.5, pivot={"x": 0.0, "y": 0.0},
                  ghost=True, hidden_3d=True)


def _bearing(c, x, y, friction, wound=None):
    """The shaft's bearing: a pin from the world to the stand-in at its middle with Coulomb friction (N*m): it holds the shaft until the torque
    on it passes that (its own hinge, the stand-in's pivot, turns freely). `wound` (rad): with a cup on its spool, how far it can turn the winding
    way before the cup reaches the spool: there it stops (the thread is all wound up; the spool's own jam is 2 mm further)."""
    extra = {} if wound is None else {"limits": {"lower": -10000.0, "upper": _r(wound, 4)}}
    c.joint("pin", "bearing", a=None, b="hub", anchorA=(x, y), anchorB=(0, 0), friction=_r(friction, 7), **extra, render={"hinge": "none"})


def _winding(free, r_spool):
    """How far a spool of radius r_spool turns to wind `free` metres of thread up to the cup's stop (SPOOL_GAP, and 2 mm before it), rad."""
    return max(0.0, (free - SPOOL_GAP - 0.002) / r_spool)


def _cup(c, sx, sy, r_spool, sense, load_g, drum, others, z=0.0):
    """A paper cup of pennies (`load_g` grams in all) on a thread wound on `drum` (a solid turning about its own middle at item-local (sx, sy)), the
    thread leaving the spool on the side that winds it up as the drum turns `sense` (+1 counter-clockwise): it rests on the table under the spool
    (or hangs, when nothing is under it) and passes through its own machine (`others`: those solids' contacts with it are left out)."""
    kg = load_g / 1000
    x = sx + sense * r_spool
    mat = c.mat(base="cardboard", density=_r(kg / (CUP_W * CUP_H * CUP_D), 3), overrides={})
    cup = c.slab("load", CUP_W, CUP_H, CUP_D, x, CUP_H / 2, material=mat, kind="dynamic", look="cardboard", words=f"a paper cup of pennies ({_trim(load_g)} g)")
    c.process("mechanics", "thread", role="spool", drum=drum, b=cup, center={"x": 0.0, "y": 0.0}, radius=_r(r_spool, 6), sense=int(sense),
              anchorB={"x": 0.0, "y": _r(CUP_H / 2)}, minLength=SPOOL_GAP, **({"z": _r(z, 4)} if abs(z) > 1e-9 else {}))
    c.process("mechanics", "thread-pull", role="meter", reads="rope", a=drum, b=cup, key="pull_n")
    c.process("mechanics", "lift", role="meter", reads="rise", solid=cup, key="lift_m")
    c.process("energy", "load-pass", role="pass", solid=cup, through=list(others))
    return cup


def _axis(c, s):
    """The rotor's shaft, pointing downwind, in the picture (rad): along +x for a wind from the left, turned with the item."""
    return _r((0.0 if s > 0 else math.pi) + c.a, 6)


def _trim(v):
    t = f"{v:.2f}"
    return t.rstrip("0").rstrip(".") if "." in t else t


# ---------------------------------------------------------------- the paper windmill (pinwheel)
def _head(P, down, up):
    """A rotor's head turned `yaw` about its post toward the viewer: the spool `down` m downwind of the post and the rotor `up` m upwind, as the
    picture's plane sees them (x, item-local), and how far behind it the spool then is (z, m: the thread hangs there)."""
    s = _side(P)
    a = P["yaw"] * D2R
    ca, sa = cos(a), sin(a)
    return s, s * down * ca, -s * up * ca, -down * sa


def pinwheel_geometry(P):
    """Item-local places: the spool / stand-in (x, y) at the straw's downwind end, the rotor's middle (x, y), the spool's z (behind the picture's
    plane when the windmill is turned toward you), and side (see _side)."""
    s, sx, rx, sz = _head(P, 0.08, 0.04)
    H = P["height"]
    return {"spool": (sx, H), "rotor": (rx, H), "spool_z": sz, "side": s}


def _pinwheel():
    def build(c, P):
        s = _side(P)
        H, D, B = P["height"], P["diameter"], int(P["blades"])
        R = D / 2
        kind = "static" if c.item.get("fixed") else "dynamic"
        wood = c.mat(base="varnished hardwood", overrides={})
        # a wooden stand: a foot board and a post, the straw axle through the post's top, the pinwheel on its upwind end, the thread on its downwind end
        foot = c.slab("foot", 0.10, 0.012, 0.08, 0.0, 0.006, kind="static", material=wood, look="wood", words="the windmill's foot board")
        post = c.slab("post", 0.02, H - 0.002, 0.02, 0.0, 0.012 + (H - 0.002) / 2 - 0.005, kind="static", material=wood, look="wood",
                      words="the windmill's post")
        geo = pinwheel_geometry(P)
        (sx, sy), (rx, ry) = geo["spool"], geo["rotor"]
        c0, c1 = PIN_SOLIDITY * 2 * math.pi * PIN_HUB / B, PIN_SOLIDITY * 2 * math.pi * R / B
        sheet = PAPERS[P["paper"]]
        J, m = _rotor_inertia(B, PIN_HUB, R, c0, c1, sheet)
        # + the straw (6 mm, 13 cm: about 0.5 g) and the bead and pin at the sails' middle (1 g), on the shaft
        J += 0.0005 * 0.003 * 0.003 + 0.001 * 0.005 * 0.005 / 2
        m += 0.0015
        hub = _stand_in(c, sx, sy, J, m, kind)
        load = P["load_g"]
        r_spool = P["axle_mm"] / 2000
        # the straw on its skewer: friction mu * r * the weight it carries (the sails, the straw and the cup's pull), on this world's gravity
        _bearing(c, sx, sy, STRAW_MU * STRAW_R * (m + load / 1000) * c.settings["gravity"], _winding(sy - CUP_H, r_spool) if load > 0 else None)
        span = R - PIN_HUB
        pitch = P["pitch"]
        c.process("energy", "rotor", role="rotor", solid=hub, at=_world(c, rx, ry), axis=_axis(c, s), yaw=_r(P["yaw"] * D2R, 6),
                  rotor={"blades": B, "r0": PIN_HUB, "R": _r(R), "chord": [_r(c0, 6), _r(c1, 6)],
                         "pitch": [_r(min(80.0, pitch + PIN_TWIST) * D2R, 6), _r(pitch * D2R, 6)], "ar": _r(span / ((c0 + c1) / 2), 4), "cd0": CD0,
                         "stations": 8})
        if load > 0:
            _cup(c, sx, sy, r_spool, 1.0, load, hub, [foot, post], geo["spool_z"])
        P["rotor_g"] = _r(m * 1000, 2)
        P["pennies"] = max(0, int((load - CUP_G) / PENNY_G)) if load > 0 else 0
    register(ItemType("pinwheel", "Paper windmill", CAT, build, dynamic=False, module=MODULE,
                      props=[Prop("diameter", "Across its sails", 0.2, 0.1, 0.4, 0.01, "m"),
                             Prop("blades", "Sails", 4, 2, 8, 1, "", "How many sails (cut from one square: more sails, narrower ones)", kind="int"),
                             Prop("pitch", "Sail angle", 18.0, 5.0, 45.0, 1.0, "°", "How far the sails' tips are turned from the windmill's face (they twist 15° more toward the middle)"),
                             Prop("paper", "Made of", "copy paper", kind="choice", choices=list(PAPERS)),
                             Prop("height", "Axle height", 0.3, 0.12, 0.6, 0.01, "m", "The straw axle's height above its foot"),
                             Prop("facing", "Wind from", "left", kind="choice", choices=["left", "right"], help="The side its sails face: the wind must blow from there"),
                             Prop("yaw", "Turned toward you", 0.0, 0.0, 60.0, 1.0, "°", "0: square into the wind (the most power); more shows its face but catches less wind (about cos³ of the angle in power)"),
                             Prop("load_g", "Load on the thread", 0.0, 0.0, 500.0, 1.0, "g", "A paper cup of pennies on a thread tied to the straw (a US cent is 2.5 g, the cup 3 g); 0: no thread"),
                             Prop("axle_mm", "Straw across", 6.0, 2.0, 30.0, 0.5, "mm", "Where the thread winds: a thinner axle lifts a heavier load, more slowly (a skewer 3 mm, a straw 6 mm, a cotton reel 25 mm)")],
                      readouts=[Readout("rpm", "Turning", "rpm", 0), Readout("wind_ms", "Wind on it", "m/s", 2), Readout("tsr", "Tip speed ÷ wind", "", 2),
                                Readout("power_mw", "Power from the wind", "mW", 1), Readout("lift_m", "Load lifted", "m", 3), Readout("pull_n", "Thread pulls", "N", 3)],
                      tags=["pinwheel", "windmill", "paper windmill", "wind", "windmill winch", "lift", "energy", "wind energy", "sails", "turns"],
                      description="A paper windmill (a pinwheel) on a straw axle through a wooden post, its sails facing the wind: a fan's or a breeze's "
                                  "wind turns it, and a thread tied to the straw can wind up a paper cup of pennies (the windmill-winch challenge).",
                      source="Blade-element momentum theory with flat-plate sails; a four-sail pinwheel peaks at about 0.17 of the wind's power at a tip "
                             "speed 2 times the wind's (wind-tunnel tests of pinwheel rotors, Wind Engineering 27, 2003).",
                      anchor="the middle of its foot's bottom", facts="20 cm · 4 sails · lifts about 60 g in a 4 m/s wind on a 6 mm straw"))


def _world(c, lx, ly):
    x, y = c.world(lx, ly)
    return {"x": _r(x), "y": _r(y)}


# ---------------------------------------------------------------- the model wind turbine
def turbine_geometry(P):
    """Item-local places: the spool / stand-in (x, y) at the shaft's back end, the rotor's middle (x, y), the nacelle's middle (as built: not
    turned), the spool's z, and side."""
    s, sx, rx, sz = _head(P, 0.11, 0.07)
    H = P["height"]
    return {"spool": (sx, H), "rotor": (rx, H), "nacelle": (s * 0.02, H), "spool_z": sz, "side": s}


def _turbine():
    def build(c, P):
        s = _side(P)
        H, B, L, w = P["height"], int(P["blades"]), P["blade_length"], P["blade_width"]
        kind = "static" if c.item.get("fixed") else "dynamic"
        wood = c.mat(base="varnished hardwood", overrides={})
        alu = c.mat(base="aluminium", overrides={}) if "aluminium" in MATERIALS else c.mat(base="steel", overrides={})
        plastic = c.mat(base="turbine plastic", overrides={})
        # a round wooden base with two brass terminals (the generator's leads come down the tower), an aluminium tower, a nacelle with the generator
        base = c.slab("base", 0.16, 0.02, 0.16, 0.0, 0.01, kind="static", material=wood, look="wood", words="the turbine's base")
        brass = c.mat(base="brass", overrides={}) if "brass" in MATERIALS else c.mat(base="steel", overrides={})
        posts = []
        for name, sx_ in (("+", 1), ("-", -1)):
            posts.append(c.slab("post_plus" if sx_ > 0 else "post_minus", 0.008, 0.01, 0.008, sx_ * 0.06, 0.025, kind="static", material=brass,
                                look="brass" if "brass" in MATERIALS else "steel", words="a brass terminal"))
        tower = c.slab("tower", 0.02, H - 0.0425, 0.02, 0.0, 0.02 + (H - 0.0425) / 2, kind="static", material=alu,
                       look="aluminium" if "aluminium" in MATERIALS else "steel", words="the turbine's tower")
        geo = turbine_geometry(P)
        (sx, sy), (rx, ry), (nx, ny) = geo["spool"], geo["rotor"], geo["nacelle"]
        nacelle = c.slab("nacelle", 0.12, 0.045, 0.045, nx, ny, kind="static", material=plastic, look="turbine plastic", words="the turbine's nacelle")
        R = TURBINE_HUB + L
        sheet = BLADE_SHEETS[P["blade_material"]]
        J, m = _rotor_inertia(B, TURBINE_HUB, R, w, w, sheet, DOWEL)
        # + the crimping hub (30 g, 5 cm across) and the shaft and spool (5 g at 3 mm)
        J += 0.03 * 0.025 * 0.025 / 2 + 0.005 * 0.003 * 0.003 / 2
        m += 0.035
        gen = GENERATORS.get(P["generator"])
        if gen is not None:
            J += gen["J"]
        hub = _stand_in(c, sx, sy, J, m, kind)
        load = P["load_g"]
        g = c.settings["gravity"]
        fric = SHAFT_MU * SHAFT_R * (m + load / 1000) * g + (gen["fric"] if gen is not None else 0.0)
        _bearing(c, sx, sy, fric, _winding(sy - CUP_H, P["axle_mm"] / 2000) if load > 0 else None)
        pitch = P["pitch"] * D2R
        c.process("energy", "rotor", role="rotor", solid=hub, at=_world(c, rx, ry), axis=_axis(c, s), yaw=_r(P["yaw"] * D2R, 6),
                  rotor={"blades": B, "r0": TURBINE_HUB, "R": _r(R), "chord": [_r(w), _r(w)], "pitch": [_r(pitch, 6), _r(pitch, 6)], "ar": _r(L / w, 4),
                         "cd0": CD0, "stations": 8})
        if gen is not None:
            st = _circuit(c.sb)
            iid = c.item["id"]
            for name, post in (("+", posts[0]), ("-", posts[1])):
                st["terminals"][f"{iid}/{name}"] = {"solid": post, "at": {"x": 0.0, "y": 0.005}}
            st["parts"].append({"kind": "generator", "id": f"{iid}/generator", "item": iid, "name": c.item.get("name") or TYPES[c.item["type"]].name,
                                "a": f"{iid}/+", "b": f"{iid}/-", "role": "generator", "k": gen["k"], "r": gen["r"], "rotor": hub})
        if load > 0:
            _cup(c, sx, sy, P["axle_mm"] / 2000, 1.0, load, hub, [base, tower, nacelle] + posts, geo["spool_z"])
        P["rotor_g"] = _r(m * 1000, 1)
        P["diameter"] = _r(2 * R, 4)
        P["pennies"] = max(0, int((load - CUP_G) / PENNY_G)) if load > 0 else 0
    register(ItemType("wind-turbine", "Model wind turbine", CAT, build, dynamic=False, module=MODULE,
                      props=[Prop("blades", "Blades", 3, 2, 12, 1, "", "On a crimping hub (12 holes)", kind="int"),
                             Prop("blade_length", "Blade length", 0.15, 0.05, 0.3, 0.005, "m"),
                             Prop("blade_width", "Blade width", 0.06, 0.02, 0.12, 0.005, "m"),
                             Prop("pitch", "Blade pitch", 20.0, 0.0, 60.0, 1.0, "°", "How far each blade is turned from the rotor's face: 10-30° turns best; 0 and 90 do not turn it"),
                             Prop("blade_material", "Blades made of", "corrugated plastic", kind="choice", choices=list(BLADE_SHEETS)),
                             Prop("height", "Hub height", 0.45, 0.2, 1.2, 0.01, "m", "Its shaft's height above the base's bottom"),
                             Prop("facing", "Wind from", "left", kind="choice", choices=["left", "right"], help="The side its rotor faces: the wind must blow from there"),
                             Prop("yaw", "Turned toward you", 0.0, 0.0, 60.0, 1.0, "°", "0: square into the wind (the most power); more shows its face but catches less wind"),
                             Prop("generator", "In its nacelle", "KidWind generator", kind="choice", choices=list(GENERATORS) + ["none"],
                                  help="The generator its shaft turns (its leads are the base's + and − terminals): the KidWind generator gives about 2 V at 700 rpm, a hobby motor a tenth of that"),
                             Prop("load_g", "Load on its spool", 0.0, 0.0, 2000.0, 1.0, "g", "A cup of pennies on a thread wound on a spool on its shaft (a weightlifter); 0: none", slider_max=500.0),
                             Prop("axle_mm", "Spool across", 6.0, 2.0, 40.0, 0.5, "mm")],
                      readouts=[Readout("rpm", "Turning", "rpm", 0), Readout("wind_ms", "Wind on it", "m/s", 2), Readout("tsr", "Tip speed ÷ wind", "", 2),
                                Readout("power_mw", "Power from the wind", "mW", 1), Readout("cp", "Share of the wind's power", "", 3),
                                Readout("generator_voltage", "Generator voltage", "V", 2), Readout("generator_current", "Generator current", "A", 4),
                                Readout("lift_m", "Load lifted", "m", 3)],
                      tags=["wind turbine", "turbine", "wind power", "generator", "kidwind", "blades", "renewable", "electricity", "wind energy", "led"],
                      description="A classroom wind turbine: blades on a hub, a nacelle with a small generator on an aluminium tower, its leads on the base's "
                                  "+ and − terminals. In front of a fan (or in a breeze) it turns, and its generator can light an LED wired to it; a spool on "
                                  "its shaft can lift a cup of pennies.",
                      source="Blade-element momentum theory with flat blades (Hansen, Aerodynamics of Wind Turbines, 2015); the KidWind generator's 2.1 V at "
                             "720 rpm and 38 Ω inside (Vernier's generator data).",
                      anchor="the middle of its base's bottom", facts="3 blades × 15 cm at 20° · KidWind generator · about 2 V in a 5 m/s fan"))


def _circuit(sb):
    """The circuits module's store on this scene builder (machines/mod_circuits.py _store: the same shape, made on first use), so the generator's
    part and terminals join the scene's one circuit record and wires can clip to them."""
    st = getattr(sb, "circuit", None)
    if st is None:
        st = {"parts": [], "terminals": {}, "wires": [], "boards": []}
        sb.circuit = st
    return st


# ---------------------------------------------------------------- a small generator on another item's turning shaft
def shaft_place(item):
    """A shaft item's turning part and its axle's place in the world (x, y), from the item itself (its type's geometry), or None."""
    t = item.get("type")
    if t not in SHAFT_TYPES or t not in TYPES:
        return None
    P = props_of(item)
    if t == "pinwheel":
        lx, ly = pinwheel_geometry(P)["spool"]
    elif t == "wind-turbine":
        lx, ly = turbine_geometry(P)["spool"]
    else:
        lx, ly = 0.0, 0.0
    a = item.get("angle", 0.0) * D2R
    ca, sa = cos(a), sin(a)
    x0, y0 = item.get("x", 0.0), item.get("y", 0.0)
    part = "wheel" if t == "wheel-and-axle" else "hub"
    return part, (x0 + lx * ca - ly * sa, y0 + lx * sa + ly * ca)


def _generator():
    def build(c, P):
        gen = GENERATORS[P["kind"]]
        L, D = gen["can"]
        # (it touches nothing: it may sit behind a waterwheel's axle as well as on the table beside it)
        plastic = c.mat(base="circuit plastic", overrides={}) if "circuit plastic" in MATERIALS else c.mat(base="turbine plastic", overrides={})
        base = c.slab("base", 0.07, 0.012, 0.05, 0.0, 0.006, kind="static", material=c.mat(base="varnished hardwood", overrides={}), look="wood",
                      words="the generator's base board", ghost=True)
        c.slab("can", L, D, D, 0.0, 0.012 + D / 2, kind="static", material=plastic, look="steel", words="a small generator", ghost=True)
        st = _circuit(c.sb)
        iid = c.item["id"]
        for name, sx in (("+", 1), ("-", -1)):
            st["terminals"][f"{iid}/{name}"] = {"solid": base, "at": {"x": _r(sx * 0.026), "y": 0.006}}
        part = {"kind": "generator", "id": f"{iid}/generator", "item": iid, "name": c.item.get("name") or TYPES[c.item["type"]].name, "a": f"{iid}/+",
                "b": f"{iid}/-", "k": gen["k"], "r": gen["r"]}
        shaft = c.link("shaft")
        place = shaft_place(c.sb.scene_items[shaft]) if shaft else None
        ratio = P["ratio"]
        if place is None:
            # (on no shaft: it never turns)
            part.update({"speed": 0.0, "from": 0.0})
            P["coupled"] = "none"
        else:
            sid, (wx, wy) = f"{shaft}/{place[0]}", place[1]
            # its own rotor, ratio² times its inertia at the shaft, welded to the shaft's turning part (on its axle, coaxial), and its friction,
            # ratio times its own, a pin from the world to it at the axle
            Jr = gen["J"] * ratio * ratio
            rr = _r(max(0.01, math.sqrt(2 * Jr / 0.02)))
            dens = (2 * Jr / (rr * rr)) / (4 / 3 * math.pi * rr * rr * rr)
            c.sb.solids.append({"kind": "dynamic", "id": f"{iid}/rotor", "words": "the generator's rotor", "body": {"kind": "ball", "radius": rr, "inertia": 0.5},
                                "material": c.mat(base="turbine plastic", density=float(f"{dens:.6g}"), overrides={}), "at": {"x": 0.0, "y": 0.0},
                                "item": iid, "look": "turbine plastic", "parent": sid, "ghost": True, "hidden_3d": True,
                                "placeholder": {"fill": "#888"}, "render": {"kind": "procedural", "shade": "#555"}, "depth": 4})
            c.sb.joints.append({"kind": "pin", "id": f"{iid}/drag", "item": iid, "a": None, "b": f"{iid}/rotor", "anchorA": {"x": _r(wx), "y": _r(wy)},
                                "anchorB": {"x": 0.0, "y": 0.0}, "friction": _r(gen["fric"] * ratio, 7), "render": {"hinge": "none"}})
            part.update({"rotor": f"{iid}/rotor", "ratio": ratio, "sense": -1 if P["leads"] == "swapped" else 1})
            P["coupled"] = sid
            # (where the view draws its belt: in front of a waterwheel's paddles, else 5 cm in front of the picture's plane)
            shaft_item = c.sb.scene_items[shaft]
            P["belt_z"] = _r(props_of(shaft_item)["paddle_depth"] / 2 + 0.045, 4) if shaft_item.get("type") == "waterwheel" else 0.05
        st["parts"].append(part)
    register(ItemType("generator", "Small generator", CAT, build, dynamic=False, module=MODULE,
                      props=[Prop("kind", "Generator", "KidWind generator", kind="choice", choices=list(GENERATORS),
                                  help="KidWind generator: about 2.1 V at 720 rpm, 38 Ω inside; hobby motor (FA-130) used as a generator: about a tenth of that"),
                             Prop("ratio", "Step-up", 1.0, 1.0, 20.0, 0.5, "×", "How many turns it makes for each turn of the shaft (a belt from a big pulley on the shaft to its small one); 1: on the shaft itself"),
                             Prop("leads", "Leads", "normal", kind="choice", choices=["normal", "swapped"],
                                  help="normal: + is positive while its shaft turns counter-clockwise (as you look at it); swapped: while it turns clockwise")],
                      links=[Link("shaft", "On the shaft of", types=list(SHAFT_TYPES), help="The turning shaft that drives it: a waterwheel, a windmill, a wind turbine, a wheel and axle")],
                      readouts=[Readout("rpm", "Turning", "rpm", 0), Readout("voltage", "Voltage", "V", 2), Readout("current", "Current out of +", "A", 4)],
                      tags=["generator", "dynamo", "motor as generator", "kidwind", "electricity", "waterwheel generator", "hydro", "energy", "volts", "led"],
                      description="A small DC generator (the KidWind turbine generator, or a hobby motor) on a little base with + and − terminals. Link it to a "
                                  "turning shaft (a waterwheel, a windmill, a wheel and axle): its voltage grows with how fast it turns, and the current it gives "
                                  "holds the shaft back.",
                      source="A DC generator: EMF = k·ω, and the current I it drives makes a torque k·I against its turning (Faraday's and Lenz's laws); the "
                             "KidWind generator's 2.13 V at 720 rpm and 38 Ω inside (Vernier's generator data).",
                      anchor="the middle of its base's bottom", facts="KidWind generator · 2.1 V at 720 rpm"))


# ---------------------------------------------------------------- the waterwheel's spool (a build hook: the flow module's type, these common props)
POURERS = ("tap", "pitcher", "hose", "leaky-bottle")


def _wheel_spools(sb, scene):
    for item in scene.get("items", []):
        if not isinstance(item, dict) or item.get("type") != "waterwheel" or "waterwheel" not in TYPES:
            continue
        own = item.get("props") or {}
        load = own.get("load_g")
        if isinstance(load, bool) or not isinstance(load, (int, float)) or not load > 0:
            continue
        load = min(2000.0, float(load))
        P = props_of(item)
        mm = own.get("axle_mm", 12.0)
        mm = 12.0 if isinstance(mm, bool) or not isinstance(mm, (int, float)) else min(40.0, max(2.0, float(mm)))
        iid = item["id"]
        hub = f"{iid}/hub"
        if not any(s["id"] == hub for s in sb.solids):
            continue
        c = Ctx(sb, item, P)
        winds = own.get("winds", "auto")
        if winds == "clockwise":
            sense = -1.0
        elif winds == "counter-clockwise":
            sense = 1.0
        else:
            # the nearest pourer above it within its diameter: water falling on its right turns it clockwise
            x0, y0, best, sense = item.get("x", 0.0), item.get("y", 0.0), None, 1.0
            for o in scene.get("items", []):
                if not isinstance(o, dict) or o.get("type") not in POURERS:
                    continue
                dx = o.get("x", 0.0) - x0
                if o.get("y", 0.0) > y0 and abs(dx) <= P["diameter"] and (best is None or abs(dx) < best):
                    best, sense = abs(dx), (-1.0 if dx > 0 else 1.0)
        r = mm / 2000
        # the spool: a wooden drum on its axle in front of the wheel (it turns with the hub), and the cup hanging from it below the wheel
        kind = "static" if item.get("fixed") else "dynamic"
        spool = c.ball("spool", _r(r), 0.0, 0.0, material=c.mat(base="varnished hardwood", density=_r(0.003 / (4 / 3 * math.pi * r * r * r), 3), overrides={}),
                       kind=kind, look="wood", words="a spool on the waterwheel's axle", parent=hub, ghost=True, shape="cylinder", length=0.02)
        sb.solids[-1]["at"] = {"x": 0.0, "y": 0.0}
        others = [s["id"] for s in sb.solids if s["item"] == iid and s["id"] != spool]
        kg = load / 1000
        # (straight under the axle in the world, upright, whatever the item's angle: x across, `drop` down, in its own turned frame)
        dx, dy = sense * r, -(P["diameter"] / 2 + 0.03 + CUP_H / 2)
        lx, ly = dx * c.ca + dy * c.sa, -dx * c.sa + dy * c.ca
        mat = c.mat(base="cardboard", density=_r(kg / (CUP_W * CUP_H * CUP_D), 3), overrides={})
        cup = c.slab("load", CUP_W, CUP_H, CUP_D, lx, ly, -item.get("angle", 0.0), material=mat, kind="dynamic", look="cardboard",
                     words=f"a paper cup of pennies ({_trim(load)} g)")
        c.process("mechanics", "thread", role="spool", drum=spool, b=cup, center={"x": 0.0, "y": 0.0}, radius=_r(r, 6), sense=int(sense),
                  anchorB={"x": 0.0, "y": _r(CUP_H / 2)}, minLength=SPOOL_GAP, z=_r(P["paddle_depth"] / 2 + 0.02, 4))
        # (the spool stops where the cup reaches it: a pin from the world at the axle, limited to the winding the thread allows)
        wound = _r(_winding(-dy - CUP_H / 2, r), 4)
        sb.joints.append({"kind": "pin", "id": f"{iid}/spool-stop", "item": iid, "a": None, "b": spool,
                          "anchorA": {"x": _r(item.get("x", 0.0)), "y": _r(item.get("y", 0.0))}, "anchorB": {"x": 0.0, "y": 0.0},
                          "limits": {"lower": -10000.0, "upper": wound} if sense > 0 else {"lower": -wound, "upper": 10000.0}, "render": {"hinge": "none"}})
        c.process("mechanics", "thread-pull", role="meter", reads="rope", a=spool, b=cup, key="pull_n")
        c.process("mechanics", "lift", role="meter", reads="rise", solid=cup, key="lift_m")
        c.process("energy", "load-pass", role="pass", solid=cup, through=others)


# ---------------------------------------------------------------- goal kinds (web/sim/modules/energy.js has the same, number for number)
END_S = 0.5


def _end_values(ctx, iid, key):
    v = ctx.state(iid, key)
    if v is None or not ctx.times:
        return None
    t_end = ctx.times[-1]
    out = [x for t, x in zip(ctx.times, v) if t >= t_end - END_S and x is not None]
    return out or None


def _volts_of(ctx, iid):
    """A generator's voltage over the run's last 0.5 s (a wind turbine's own generator, or a small generator), or None."""
    it = ctx.items.get(iid) or {}
    key = "generator_voltage" if it.get("type") == "wind-turbine" else "voltage"
    return _end_values(ctx, iid, key), key


def _power_of(ctx, iid):
    """A generator's electrical power over the run's last 0.5 s (mW: its voltage times the current out of its +), or None."""
    it = ctx.items.get(iid) or {}
    pre = "generator_" if it.get("type") == "wind-turbine" else ""
    v, i = _end_values(ctx, iid, f"{pre}voltage"), _end_values(ctx, iid, f"{pre}current")
    if not v or not i:
        return None
    n = min(len(v), len(i))
    return [v[k] * i[k] * 1000 for k in range(n)]


def goal_generates(ctx, g):
    """{kind: "generates", item, at_least_v?, at_least_mw?}: a generator (a wind turbine's, a small generator) gives at least at_least_v volts
    (default 1 V; its size, either way round) all through the run's last 0.5 s, and with at_least_mw at least that much electrical power."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    least = ctx.num(g.get("at_least_v"))
    mw = ctx.num(g.get("at_least_mw"))
    least = 1.0 if least is None and mw is None else least
    v, _key = _volts_of(ctx, iid)
    p = _power_of(ctx, iid)
    ok = v is not None
    if ok and least is not None:
        ok = min(abs(x) for x in v) >= least
    if ok and mw is not None:
        ok = p is not None and min(p) >= mw
    what = []
    if least is not None:
        what.append(f"at least {_trim(least)} V")
    if mw is not None:
        what.append(f"{_trim(mw)} mW")
    return {"label": g.get("label") or f"{ctx.name(iid)} makes {' and '.join(what)}", "ok": ok, "kind": "generates", "item": iid,
            "volts": None if v is None else round(v[-1], 4), "mw": None if p is None else round(p[-1], 3)}


def goal_generates_more(ctx, g):
    """{kind: "generates_more", a, b}: generator a's electrical power over the run's last 0.5 s (its mean) is more than b's, by at least 10 % and
    0.1 mW (a fair test of blade designs: the same fan, the same load)."""
    if not (ctx.known(g.get("a")) and ctx.known(g.get("b"))):
        return None
    pa, pb = _power_of(ctx, g["a"]), _power_of(ctx, g["b"])
    ma = sum(pa) / len(pa) if pa else None
    mb = sum(pb) / len(pb) if pb else None
    ok = ma is not None and mb is not None and ma >= mb * 1.1 and ma >= mb + 0.1
    return {"label": g.get("label") or f"{ctx.name(g['a'])} makes more power than {ctx.name(g['b'])}", "ok": ok, "kind": "generates_more", "a": g["a"],
            "b": g["b"], "mw_a": None if ma is None else round(ma, 3), "mw_b": None if mb is None else round(mb, 3)}


def _rise(ctx, iid):
    """How far an item's load (its part `load`) ends above where it started, m, or None."""
    sid = f"{iid}/load"
    if not any(s["id"] == sid for s in ctx.doc["solids"]):
        return None
    p0 = ctx.frames[0]["placements"].get(sid)
    p1 = ctx.frames[-1]["placements"].get(sid) or p0
    return None if p0 is None or p1 is None else p1["y"] - p0["y"]


def goal_lifts_higher(ctx, g):
    """{kind: "lifts_higher", a, b}: machine a's load (a windmill's, a turbine's, a waterwheel's cup) ends higher above where it started than b's,
    by at least 2 cm and 10 % (a fair test: more sails, a thinner axle, a stronger wind)."""
    if not (ctx.known(g.get("a")) and ctx.known(g.get("b"))):
        return None
    ra, rb = _rise(ctx, g["a"]), _rise(ctx, g["b"])
    ok = ra is not None and rb is not None and ra >= rb + 0.02 and ra >= rb * 1.1
    return {"label": g.get("label") or f"{ctx.name(g['a'])} lifts its load higher than {ctx.name(g['b'])}", "ok": ok, "kind": "lifts_higher",
            "a": g["a"], "b": g["b"], "rise_a": None if ra is None else round(ra, 4), "rise_b": None if rb is None else round(rb, 4)}
