"""The air module: air has weight and pressure, and moving air pushes. Balloons that fill and pop, a model hot-air balloon, an incense stick's
smoke showing the air's currents, a cup anemometer, a wind tunnel, paper airplanes and gliders, kites, a vacuum jar, a card under an upside-down glass of
water, a suction cup holding a weight and a soda can crushed by the air when its steam condenses.

items.py imports this file (machines/mod_<name>.py) after the catalog files and calls register_all(globals()); web/sim/modules/air.js is its
exact JavaScript port (the same documents, number for number). The engine side is tooling/src/sim/modules/air.ts (the process kind "air")
with the physics in tooling/src/sim/air.ts. Wind comes from the catalog's fans and the liquids module's breeze (the engine's air streams).

Sources:
  [CODATA] R = 8.314462618 J/(mol·K); [ISO 2533] 1 atm = 101325 Pa; [USSA76] dry air 28.9644 g/mol; [IUPAC] helium 4.0026 g/mol.
  [MW78] Merritt & Weinhaus, "The pressure curve for a rubber balloon", Am. J. Phys. 46, 976 (1978): a thin Mooney-Rivlin sphere,
         Δp ∝ (1/λ − 1/λ⁷)(1 + λ²/k), k ≈ 10.
  [CRC] CRC Handbook of Chemistry and Physics: natural rubber 920-930 kg/m³, aluminium E 69 GPa, ν 0.33.
  [BUCK] Buck, J. Appl. Meteor. 20, 1527 (1981): water's vapour pressure (2.34 kPa at 20 °C, 101.3 kPa at 100 °C).
  [WT34] Windenburg & Trilling, Trans. ASME 56, 819 (1934): a thin cylinder buckles under p = 2.42E(t/D)^2.5/((1−ν²)^0.75 (L/D − 0.45(t/D)^0.5)).
  [MTT] Morton, Taylor & Turner, Proc. R. Soc. A 234, 1 (1956): plumes over heat sources.
  [HOE] Hoerner, Fluid-Dynamic Drag (1965) and Fluid-Dynamic Lift (1985): flat plates; [TM04] Torres & Mueller, AIAA J. 42, 865 (2004):
        low-aspect-ratio wings; [ANDERSON] Anderson, Fundamentals of Aerodynamics: Helmbold's lift slope.
  [INC] Incropera & DeWitt, Fundamentals of Heat and Mass Transfer: free convection 2-25 W/(m²·K), air's c_p 1007 J/(kg·K).
  Sizes: an 11-inch latex balloon 28 cm, about 3 g; an A4 sheet of 80 g/m² paper 4.99 g; a 355 mL aluminium can 66 × 122 mm, 14.9 g
  (Ball Corp.), its wall 0.097 mm; craft tissue paper 17 g/m²; a dry-cleaning bag 12 µm of polyethylene (11 g/m²).
  Provisional calibrations are said so where they are used (balloon pressure 3 kPa at its rated size; bursting at 1.3 × its rated
  diameter; the heat gun's share that goes into the envelope; the envelope's loss coefficient; a suction cup's working vacuum; the card's
  water seal; the can's cooling time).
"""
import math

from crmath import cos, sin, cube  # noqa: F401  (the same bits as web/sim's port on any machine)

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "MATERIALS", "add_look", "LOOK_FILL", "LOOK_SHADE", "D2R",
          "register_goal_kind", "register_build_hook", "TYPES", "CATEGORIES", "props_of")

MODULE = "air"
CAT = "Air"

# ---------------------------------------------------------------- the physics constants (tooling/src/sim/air.ts has the same, with sources)
GAS_R = 8.314462618
ATM = 101325.0
KELVIN = 273.15
MOLAR = {"air": 0.0289644, "helium": 0.0040026}
RUBBER_K, RUBBER_FULL, RUBBER_P, RUBBER_BURST = 10.0, 6.0, 3000.0, 7.8
# gas seeping out through latex, per second of the scene's (time-lapsed) time: helium halves in about 10 hours, air in about a week
# (party-balloon makers: an 11-inch helium balloon floats 12-20 hours; provisional)
LEAK = {"air": 1.15e-6, "helium": 1.925e-5}
BALLOON_RUBBER = 0.003      # kg, an 11-inch (28 cm) latex balloon; others by their rubber's area (diameter²)
NECK = 0.004                # m, the radius of a balloon's open neck


def rubber_shape(l):
    if l <= 1:
        return 0.0
    l2 = l * l
    l4 = l2 * l2
    l7 = l4 * l2 * l
    return (1 / l - 1 / l7) * (1 + l2 / RUBBER_K)


FULL_SHAPE = rubber_shape(RUBBER_FULL)


def skin_pressure(l):
    """A balloon's over-pressure (Pa) at stretch l [MW78], 3 kPa at its rated size (provisional)."""
    return RUBBER_P * rubber_shape(l) / FULL_SHAPE


def sphere_volume(r):
    return (4 / 3) * math.pi * r * r * r


def balloon_radius(n, T, pout, r0, cap):
    """Where n mol at T fill a balloon of slack radius r0 against pout: (pout + Δp)·V = nRT by 64 halvings (tooling/src/sim/air.ts balloonRadius)."""
    want = n * GAS_R * T

    def f(r):
        return (pout + skin_pressure(r / r0)) * sphere_volume(r) - want
    lo = 0.5 * r0
    hi = cap
    if f(lo) >= 0:
        return lo
    if f(hi) <= 0:
        return hi
    for _ in range(64):
        mid = (lo + hi) / 2
        if f(mid) < 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CAT not in CATEGORIES:
        CATEGORIES.append(CAT)
    _looks()
    _materials()
    _balloons()
    _hot_air()
    _smoke()
    _anemometer()
    _tunnel()
    _jar()
    _pressure()
    _flyers()
    _goals()
    register_build_hook(_hook)


# ---------------------------------------------------------------- looks and materials
COLORS = {"red": "#d62828", "blue": "#1f5fbf", "yellow": "#f2c230", "green": "#2e9e44", "orange": "#f07f1a", "purple": "#7b3fb0",
          "pink": "#ec6fa5", "white": "#f4f4f0", "silver": "#c9ced3", "black": "#222222"}
COLOR_NAMES = list(COLORS)


def _looks():
    add_look("latex", fill="#d62828", shade="#9c1c1c", roughness=0.28, metalness=0.0, clearcoat=0.9)
    add_look("tissue", fill="#f3e2c0", shade="#cdb78f", roughness=0.85, metalness=0.0, clearcoat=0.0, transmission=0.25)
    add_look("ripstop", fill="#e04a3a", shade="#a83226", roughness=0.6, metalness=0.0, clearcoat=0.1)
    add_look("folded paper", fill="#f6f5f0", shade="#cfccc2", roughness=0.9, metalness=0.0, clearcoat=0.0)
    add_look("balsa", fill="#e9d7ae", shade="#c3ad7f", roughness=0.8, metalness=0.0, clearcoat=0.0, grain=True)
    add_look("cup vinyl", fill="#dfe7ea", shade="#a9b6bb", roughness=0.3, metalness=0.0, clearcoat=0.6, transmission=0.5)
    add_look("can paint", fill="#c8202a", shade="#8f141c", roughness=0.3, metalness=0.6, clearcoat=0.8)
    add_look("index card", fill="#fbfbf6", shade="#d6d6cc", roughness=0.85, metalness=0.0, clearcoat=0.0)


def _mat(key, **kw):
    kw.setdefault("rolling", 0.0)
    kw.setdefault("side", 0.0)
    if key not in MATERIALS:
        MATERIALS[key] = kw


def _materials():
    _mat("balloon latex", density=920.0, bounce=0.5, friction=0.6, rolling=0.05, look="latex",
         source="Natural rubber latex 920-930 kg/m³ [CRC]; an 11-inch party balloon's rubber about 3 g (provisional). Its weight and the gas in it are set by the air module.")
    _mat("envelope tissue", density=500.0, bounce=0.1, friction=0.5, look="tissue",
         source="Craft tissue paper 17 g/m² (with 15 % for its glued seams) or a 12 µm polyethylene bag 11 g/m²: the envelope's weight is set from its area.")
    _mat("kite (spars and ripstop)", density=500.0, bounce=0.2, friction=0.5, look="ripstop",
         source="Ripstop nylon about 40 g/m² and two 4-6 mm spars about 10 g/m: a 70 cm diamond kite weighs about 25 g (provisional).")
    _mat("folded paper", density=800.0, bounce=0.15, friction=0.45, look="folded paper",
         source="Copy paper 80 g/m², about 0.1 mm (800 kg/m³); an A4 sheet 4.99 g. The plane's weight is set from its sheet.")
    _mat("balsa", density=160.0, bounce=0.2, friction=0.45, look="balsa",
         source="Balsa 100-200 kg/m³ (Wood Handbook, FPL-GTR-190); a hand-launched glider about 8 g with its nose weight.")
    _mat("suction cup vinyl", density=1300.0, bounce=0.1, friction=1.0, rolling=0.05, look="cup vinyl",
         source="Soft PVC 1200-1400 kg/m³; a 5 cm suction cup weighs about 5 g.")
    _mat("can aluminium", density=2700.0, bounce=0.2, friction=0.4, rolling=0.002, look="can paint",
         source="A 355 mL aluminium can: 14.9 g empty, its wall 0.097 mm (3004 alloy, E 69 GPa); with 15 mL of water in it, 30 g.")
    _mat("index card", density=700.0, bounce=0.2, friction=0.5, look="index card",
         source="Index card stock about 0.19 mm, 2 g for a 10 × 10 cm piece (provisional); cardboard and a plastic lid heavier.")


# ---------------------------------------------------------------- small helpers (the port does the same, step for step)
def _r5(v):
    return round(v, 5)


def _upright(c):
    """A stand stays upright whatever the item's angle: its solids are placed unturned."""
    c.ca, c.sa, c.a = 1.0, 0.0, 0.0


def _child(c, part, parent, body, at, material, look, words, color=None):
    """A solid welded to another solid of this item: `at` in the parent's own frame."""
    s = {"kind": c.kind, "id": f"{c.item['id']}/{part}", "words": words, "item": c.item["id"], "look": look, "body": body, "material": material,
         "at": {"x": _r5(at[0]), "y": _r5(at[1])}, "parent": parent, "placeholder": {"fill": color or LOOK_FILL[look]},
         "render": {"kind": "procedural", "shade": LOOK_SHADE[look]}, "depth": 2}
    if color:
        s["color"] = color
    c.sb.solids.append(s)
    return s["id"]


def _name(c):
    return c.item.get("name") or TYPES[c.item["type"]].name


def _wp(c, lx, ly):
    x, y = c.world(lx, ly)
    return {"x": round(x, 6) + 0.0, "y": round(y, 6) + 0.0}


# ---------------------------------------------------------------- balloons
def _balloons():
    def build(c, P):
        D = P["size"]
        r0 = D / 2 / RUBBER_FULL
        gas = P["gas"]
        T = c.settings["room_temp"] + KELVIN
        # (drawn as it was filled, at the room's pressure, even in no air: the engine swells and bursts it within 0.3 s of the release)
        pout = ATM
        n = ATM * (P["fill_l"] / 1000) / (GAS_R * 293.15)
        r = _r5(balloon_radius(n, T, pout, r0, r0 * RUBBER_BURST))
        rubber = BALLOON_RUBBER * (D / 0.28) * (D / 0.28)
        # its rubber thins as it stretches (its volume kept): the wall is what its weight spreads over now
        wall = round(max(1e-6, rubber / (920.0 * 4 * math.pi * r * r)), 7)
        color = COLORS[P["color"]]
        what = f"a {P['color']} party balloon of {'helium' if gas == 'helium' else 'air'}"
        sid = c.ball("balloon", r, 0.0, 0.0, wall=wall, look="latex", color=color, words=what)
        rec = {"role": "balloon", "solid": sid, "name": _name(c), "r0": round(r0, 7), "rdoc": r, "rubber": round(rubber, 7), "moles": round(n, 9),
               "molar": MOLAR[gas], "neck": NECK, "tied": bool(P["tied"]), "prick": P["prick_at"], "leak": LEAK[gas]}
        if P["pump_lps"] > 0:
            # a hand pump under its neck, its nozzle in the neck: the balloon grows from it (it stays tied to the nozzle)
            steel = c.mat(base="ABS plastic", overrides={})
            c.slab("nozzle", 0.012, 0.03, 0.012, 0.0, -r - 0.015, kind="static", material=steel, look="plastic", words="the pump's nozzle")
            c.slab("pump", 0.05, 0.28, 0.05, 0.0, -r - 0.03 - 0.14, kind="static", material=steel, look="plastic", words="a hand pump's barrel")
            c.slab("foot", 0.16, 0.02, 0.08, 0.0, -r - 0.31 - 0.01, kind="static", material=steel, look="plastic", words="the pump's foot")
            rec.update(pump=round(P["pump_lps"] / 1000 * ATM / (GAS_R * 293.15), 9), nozzle=_wp(c, 0.0, -r), up={"x": round(-c.sa, 6) + 0.0, "y": round(c.ca, 6) + 0.0})
        elif P["string_m"] > 0:
            L = P["string_m"]
            wg = P["weight_g"]
            if wg > 0:
                dens = wg / 1000 / (0.03 * 0.025 * 0.03)
                c.slab("weight", 0.03, 0.025, 0.03, 0.0, -r - L - 0.0125, material=c.mat(base="ABS plastic", density=round(dens, 3), overrides={}),
                       look="plastic", words="a balloon weight")
            else:
                c.slab("weight", 0.02, 0.025, 0.02, 0.0, -r - L - 0.0125, kind="static", material=c.mat(base="steel", overrides={}), look="steel",
                       words="a hook the string is tied to")
            c.joint("rope", "string", a="balloon", b="weight", anchorA=(0.0, -r), anchorB=(0.0, 0.0125), length=_r5(L), thickness=0.001)
        c.process("air", "air", **rec)

    register(ItemType("party-balloon", "Party balloon", CAT, build, material="balloon latex", materials=["balloon latex"], module=MODULE,
                      props=[Prop("gas", "Filled with", "air", kind="choice", choices=["air", "helium"], help="Blown up with air it sinks slowly; helium is so light it floats up"),
                             Prop("fill_l", "Gas in it", 8.0, 0.0, 40.0, 0.5, "L", "Litres of gas put in (measured at 20 °C and 1 atm). A 28 cm balloon holds 11.5 L at its rated size and pops past about 25 L"),
                             Prop("size", "Rated size", 0.28, 0.12, 0.45, 0.01, "m", "Its diameter blown up as its maker means (an 11-inch balloon is 28 cm); it pops at about 1.3 times that"),
                             Prop("tied", "Tied", True, kind="bool", help="Untied, the air rushes out of its neck and it shoots off the other way (a balloon rocket)"),
                             Prop("pump_lps", "Pump", 0.0, 0.0, 2.0, 0.05, "L/s", "A hand pump in its neck adds this much air every second: it grows until it pops"),
                             Prop("prick_at", "Pricked at", -1.0, -1.0, 20.0, 0.1, "s", "A pin pricks it then (at the release if that is later) and it pops (-1: never)"),
                             Prop("string_m", "String", 0.0, 0.0, 2.0, 0.05, "m", "A string from its neck down to a weight (0: no string)"),
                             Prop("weight_g", "Weight on the string", 20.0, 0.0, 500.0, 1.0, "g", "The weight the string is tied to (0: tied to a fixed hook)"),
                             Prop("color", "Colour", "red", kind="choice", choices=COLOR_NAMES)],
                      readouts=[Readout("diameter_cm", "Diameter", "cm", 1), Readout("pressure_kpa", "Pressure inside", "kPa", 2, "Above the air's outside it"),
                                Readout("volume_l", "Volume", "L", 2), Readout("lift_g", "Net lift", "g", 1, "The air's push up minus its weight (+: it rises)"),
                                Readout("thrust_n", "Jet thrust", "N", 3, "An untied balloon's push from its jet"), Readout("popped", "Popped", "", 0, words={0: "no", 1: "yes"}),
                                Readout("gas_c", "Gas inside", "°C", 1, "It warms or cools toward the air round it (over a hot plate, by ice): warmer gas, a bigger balloon")],
                      tags=["balloon", "party balloon", "helium", "inflate", "deflate", "pop", "burst", "air has mass", "rocket", "air pressure", "latex"],
                      description="A latex party balloon. The gas inside (air or helium) fills it until its pressure (the room's + the rubber's) matches the gas law "
                                  "PV = nRT: more gas, a warmer room or less air outside (a vacuum jar) make it bigger, and past 1.3 times its rated size it pops. "
                                  "Air in it is heavier than the air it pushes aside, so it sinks slowly; helium floats it up (on a string it pulls up on its weight). "
                                  "Untied, its jet sends it flying the way its neck does not point; on a pump it grows until it pops; pricked, it pops. "
                                  "Its gas warms or cools toward the air round it (over a hot plate it swells a little, by ice it shrinks); it pops on a surface "
                                  "over about 150 °C. In no air, or over-filled, it swells and bursts as soon as it is let go.",
                      source="Ideal gas law with the room's pressure 101.325 kPa; rubber after Merritt & Weinhaus (1978), 3 kPa at its rated size (provisional); "
                             "air 1.2 kg/m³, helium 0.166 kg/m³ at 20 °C.",
                      anchor="its middle", facts="11-inch latex · 8 L of air · 25 cm · 3 g of rubber"))


# ---------------------------------------------------------------- a model hot-air balloon
ENVELOPES = {"tissue paper": 0.017 * 1.15, "plastic bag": 0.011}    # kg/m²
STRIPES = ["red and yellow", "blue and white", "green and white", "rainbow"]


def _hot_air():
    def build(c, P):
        _upright(c)
        D = P["size"]
        R = D / 2
        a = 0.18 * D                     # the mouth's radius (a model's mouth about a third of its width)
        below = math.sqrt(R * R - a * a)  # the mouth under the envelope's middle
        ring_y = 0.30
        env_y = ring_y + below
        wood = c.mat(base="varnished hardwood", overrides={})
        steel = c.mat(base="steel", overrides={})
        c.slab("base", 0.36, 0.02, 0.24, 0.0, 0.01, kind="static", material=wood, look="wood", words="the launch stand's base")
        for side, part in ((-1, "post-left"), (1, "post-right")):
            c.slab(part, 0.008, ring_y - 0.003 - 0.02, 0.008, side * (a + 0.004), 0.02 + (ring_y - 0.003 - 0.02) / 2, kind="static", material=steel,
                   look="steel", words="a wire post of the launch stand")
        c.slab("gun", 0.07, 0.20, 0.09, 0.0, 0.12, kind="static", material=c.mat(base="ABS plastic", overrides={}), look="plastic", words="a heat gun standing on its end")
        c.slab("gun-nozzle", 0.04, 0.04, 0.04, 0.0, 0.24, kind="static", material=steel, look="steel", words="the heat gun's nozzle")
        gsm = ENVELOPES[P["envelope"]]
        area = 4 * math.pi * R * R
        m_env = area * gsm
        wall = 0.00004
        shell = (4 / 3) * math.pi * (cube(R) - cube(R - wall))
        env = c.ball("envelope", R, 0.0, env_y, wall=wall, material=c.mat(base="envelope tissue", density=round(m_env / shell, 3), overrides={}),
                     look="tissue", words=f"a {P['envelope']} hot-air balloon")
        ring_m = 0.003 + P["payload_g"] / 1000
        w = 2 * a + 0.02
        _child(c, "ring", env, {"kind": "slab", "width": _r5(w), "height": 0.006, "depth": _r5(w)}, (0.0, -below),
               c.mat(base="steel", density=round(ring_m / (w * 0.006 * w), 3), overrides={}), "steel", "the wire ring round its mouth")
        if P["tether_m"] > 0:
            c.joint("rope", "tether", a="ring", b="base", anchorA=(0.0, 0.0), anchorB=(0.0, 0.01), length=_r5(ring_y - 0.02 + P["tether_m"]), thickness=0.001)
        inner = R - wall
        c.process("air", "air", role="hotair", solid=env, ring=c.sid("ring"), name=_name(c), volume=round((4 / 3) * math.pi * cube(inner), 7), area=round(area, 6),
                  U=3.5, power=P["heater_w"], heater=_wp(c, 0.0, 0.26), reach=0.6, mouth=_r5(a), until=P["heater_off_s"], eta=0.6, start=P["start_c"],
                  dry=round(m_env + ring_m, 7))

    register(ItemType("hot-air-balloon", "Model hot-air balloon", CAT, build, dynamic=True, material="envelope tissue", materials=["envelope tissue"], module=MODULE,
                      props=[Prop("size", "Envelope", 0.9, 0.4, 1.6, 0.05, "m", "Its diameter: a bigger one holds more hot air for its paper"),
                             Prop("envelope", "Made of", "tissue paper", kind="choice", choices=list(ENVELOPES), help="Tissue paper 17 g/m² (with glued seams) or a thin plastic bag 11 g/m²"),
                             Prop("heater_w", "Heat gun", 1500.0, 0.0, 2000.0, 50.0, "W", "The heat gun under its mouth (about 60 % of its heat goes in while the mouth is close)"),
                             Prop("heater_off_s", "Heat gun off at", 20.0, 0.0, 20.0, 0.1, "s"),
                             Prop("start_c", "Air inside at the start", 65.0, -20.0, 120.0, 1.0, "°C", "Already warmed by the heat gun before the run starts"),
                             Prop("payload_g", "Payload", 0.0, 0.0, 100.0, 1.0, "g", "Extra weight hung from its ring"),
                             Prop("tether_m", "Tether", 0.0, 0.0, 3.0, 0.05, "m", "A thread from its ring to the stand: how far it can rise (0: free)"),
                             Prop("color", "Stripes", "red and yellow", kind="choice", choices=STRIPES)],
                      readouts=[Readout("inside_c", "Air inside", "°C", 1), Readout("lift_n", "Hot air's lift", "N", 3, "(ρ_room − ρ_inside)·g·V"),
                                Readout("net_g", "Net lift", "g", 1, "Hot air's lift minus the envelope, ring and payload (+: it rises)"),
                                Readout("heating_w", "Heating", "W", 0), Readout("height_m", "Height", "m", 2, "Its mouth above where it started")],
                      tags=["hot air balloon", "hot air rises", "convection", "density", "warm air", "sky lantern", "heat", "buoyancy", "charles law"],
                      description="A tissue-paper (or plastic-bag) hot-air balloon on a launch stand over a heat gun. Hot air is lighter than the room's air "
                                  "(ρ ∝ 1/T at the same pressure), so once the air inside is hot enough its lift beats the envelope's weight and it rises; "
                                  "away from the heat gun it cools through its skin and sinks back. Bigger, lighter or hotter rises faster.",
                      source="Ideal gas at constant pressure: ρ_inside = 1.2 kg/m³ × T_room/T_inside; heat loss U·A·ΔT, U 3.5 W/(m²·K) (free convection and "
                             "radiation through a thin skin, provisional); the heat gun's share 60 % within 60 cm (provisional).",
                      anchor="the middle of the launch stand's base", facts="0.9 m tissue envelope · 50 g · rises above about 58 °C inside"))


# ---------------------------------------------------------------- smoke
SMOKE = {"light": (6.0, 4.0), "normal": (10.0, 4.8), "thick": (12.0, 5.3)}   # puffs a second, how long each lasts (s)


def _smoke():
    def build(c, P):
        _upright(c)
        wood = c.mat(base="varnished hardwood", overrides={})
        c.slab("holder", 0.10, 0.012, 0.025, 0.0, 0.006, kind="static", material=wood, look="wood", words="an incense holder")
        c.slab("stick", 0.0025, 0.22, 0.0025, 0.0, 0.012 + 0.11, kind="static", material=wood, look="wood", words="a burning incense stick")
        rate, life = SMOKE[P["amount"]]
        c.process("air", "air", role="smoke", name=_name(c), tip=_wp(c, 0.0, 0.232), rate=rate, life=life, count=min(48, int(round(rate * life))), lit=P["lit_at"], power=1.5)

    register(ItemType("incense-stick", "Incense stick (smoke)", CAT, build, dynamic=False, material="varnished hardwood", materials=["varnished hardwood"], module=MODULE,
                      props=[Prop("amount", "Smoke", "normal", kind="choice", choices=list(SMOKE)), Prop("lit_at", "Lit at", 0.0, 0.0, 10.0, 0.1, "s")],
                      readouts=[Readout("drift_m", "Smoke drifts", "m", 2, "How far its smoke has gone sideways on average (+: to the right)"),
                                Readout("rise_m", "Smoke rises", "m", 2, "How high above the tip its smoke is on average")],
                      tags=["smoke", "incense", "convection", "air current", "wind", "draft", "see the air", "plume", "rising air"],
                      description="A burning incense stick whose smoke shows how the air moves: it rises in its own warm plume, is carried off by a fan's "
                                  "stream or a breeze, rises faster over hot things (a hot plate, a lamp, a hot drink, a heat gun) and sinks over cold ones "
                                  "(ice). No air, no smoke.",
                      source="Plumes after Morton, Taylor & Turner (1956): a 1.5 W stick rises about 0.2 m/s 10 cm up; mixing as a random walk "
                             "(eddy diffusivity 0.0005 + 0.01·|wind| m²/s, provisional).",
                      anchor="the middle of its holder's bottom", facts="10 puffs a second, each lasting 4.8 s"))


# ---------------------------------------------------------------- anemometer
def _anemometer():
    def build(c, P):
        _upright(c)
        H = P["height"]
        steel = c.mat(base="steel", overrides={})
        c.slab("base", 0.12, 0.015, 0.12, 0.0, 0.0075, kind="static", material=steel, look="steel", words="the wind meter's foot")
        c.slab("pole", 0.012, H, 0.012, 0.0, 0.015 + H / 2, kind="static", material=steel, look="steel", words="the wind meter's pole")
        c.slab("head", 0.03, 0.03, 0.03, 0.0, 0.015 + H + 0.015, kind="static", material=c.mat(base="ABS plastic", overrides={}), look="plastic",
               words="a cup anemometer's hub")
        c.process("air", "air", role="anemometer", name=_name(c), at=_wp(c, 0.0, 0.015 + H + 0.03), arm=0.06)

    register(ItemType("anemometer", "Wind meter (anemometer)", CAT, build, dynamic=False, material="steel", materials=["steel"], module=MODULE,
                      props=[Prop("height", "Cups at", 0.4, 0.1, 1.5, 0.01, "m", "How high its cups are above its foot")],
                      readouts=[Readout("wind_ms", "Wind", "m/s", 2), Readout("turns", "Cup turns", "", 1)],
                      tags=["wind", "wind speed", "anemometer", "measure wind", "weather", "breeze", "fan speed"],
                      description="A cup anemometer on a pole: it reads the air's speed at its cups (a fan's stream, a breeze) and its cups spin with it.",
                      source="Cups turn at about a third of the wind's speed (Robinson's cup factor 2-3).", anchor="the middle of its foot",
                      facts="reads m/s at its cups"))


# ---------------------------------------------------------------- wind tunnel
def _tunnel():
    def build(c, P):
        _upright(c)
        L, H, D = P["length"], P["height"], 0.3
        s = 1.0 if P["blows"] == "to the right" else -1.0
        c.slab("floor", L, 0.012, D, 0.0, -0.006, kind="static", material=c.mat(base="varnished hardwood", overrides={}), look="wood",
               words="the wind tunnel's floor")
        c.slab("roof", L, 0.006, D, 0.0, H + 0.003, kind="static", material=c.mat(base="glass", overrides={}), look="glass", words="the wind tunnel's clear top")
        c.slab("fan-box", 0.12, H + 0.018, D, -s * (L / 2 + 0.06), H / 2, kind="static", material=c.mat(base="ABS plastic", overrides={}), look="plastic",
               words="the wind tunnel's fan box")
        x, y = c.world(-s * L / 2, H / 2)
        c.sb.animated.append({
            "kind": "animated", "id": f"{c.item['id']}/wind", "words": "the wind tunnel's stream", "sprite": "breeze", "item": c.item["id"],
            "vector": [{"id": "wind", "tag": "rect", "attrs": {"x": 0, "y": 0, "width": 0.01, "height": 0.01, "fill": "none"}}],
            "at": {"x": round(x, 5), "y": round(y, 5)}, "keys": [{"t": 0.0, "angle": 0.0}],
            # the engine's round jet made twice the tunnel's height across: inside the tunnel its speed is within 16 % of the setting at the walls and
            # holds for 12 tunnel heights (Rajaratnam's core), so the duct's air is nearly even
            "airflow": {"from": P["on_at"], "at": {"x": 0.0, "y": 0.0}, "direction": 0.0 if s > 0 else round(math.pi, 6), "diameter": _r5(2 * H), "speed": P["speed"],
                        "source": "A wind tunnel's fan and straightener: the engine's round jet, 2 × the duct's height across (even within 16 % across it)."},
            "depth": 3})

    register(ItemType("wind-tunnel", "Wind tunnel", CAT, build, dynamic=False, material="glass", materials=["glass"], module=MODULE,
                      props=[Prop("length", "Length", 1.2, 0.5, 2.5, 0.05, "m"), Prop("height", "Inside height", 0.3, 0.15, 0.6, 0.01, "m"),
                             Prop("speed", "Wind speed", 5.0, 0.0, 15.0, 0.5, "m/s"), Prop("blows", "Blows", "to the right", kind="choice", choices=["to the right", "to the left"]),
                             Prop("on_at", "Fan on at", 0.0, 0.0, 10.0, 0.1, "s")],
                      tags=["wind tunnel", "wind", "air flow", "drag", "lift", "test", "fan", "aerodynamics", "streamline"],
                      description="A clear-topped wind tunnel with a fan at its upwind end: an even stream of air through it at `speed`. Put things inside it to "
                                  "test them in a steady wind: a wind meter reads it, smoke shows it, a kite or a paper airplane on its floor meets it, light things "
                                  "blow along.",
                      source="Rajaratnam, Turbulent Jets (1976): a round jet keeps its speed for 6.2 diameters; made 2 × the duct's height across.",
                      anchor="the middle of its floor's top", facts="1.2 m × 30 cm · 5 m/s"))


# ---------------------------------------------------------------- vacuum jar
def _jar():
    def build(c, P):
        _upright(c)
        W, H = P["width"], P["height"]
        steel = c.mat(base="steel", overrides={})
        glass = c.mat(base="glass", overrides={})
        c.slab("plate", W + 0.08, 0.02, W + 0.08, 0.0, 0.01, kind="static", material=steel, look="steel", words="the vacuum pump's plate")
        for side, part in ((-1, "glass-left"), (1, "glass-right")):
            c.slab(part, 0.004, H, W, side * (W / 2 + 0.002), 0.02 + H / 2, kind="static", material=glass, look="glass", words="the bell jar's glass")
        c.slab("glass-top", W + 0.008, 0.004, W, 0.0, 0.02 + H + 0.002, kind="static", material=glass, look="glass", words="the bell jar's glass top")
        x0, y0 = c.world(-W / 2, 0.02)
        x1, y1 = c.world(W / 2, 0.02 + H)
        c.process("air", "air", role="jar", name=_name(c), x0=round(x0, 6), x1=round(x1, 6), y0=round(y0, 6), y1=round(y1, 6), pump_at=P["pump_at"], tau=P["pump_s"],
                  low=round(P["lowest_kpa"] * 1000, 3), vent=P["vent_at"])

    register(ItemType("vacuum-jar", "Vacuum jar", CAT, build, dynamic=False, material="glass", materials=["glass"], module=MODULE,
                      props=[Prop("width", "Inside width", 0.3, 0.15, 0.6, 0.01, "m"), Prop("height", "Inside height", 0.35, 0.15, 0.8, 0.01, "m"),
                             Prop("pump_at", "Pump starts", 0.5, 0.0, 20.0, 0.1, "s"),
                             Prop("pump_s", "Pumping time", 2.0, 0.2, 20.0, 0.1, "s", "The pressure falls by 63 % every this many seconds"),
                             Prop("lowest_kpa", "Lowest pressure", 2.0, 0.1, 90.0, 0.1, "kPa", "What the pump can get down to (the room is 101.3)"),
                             Prop("vent_at", "Air let back in at", -1.0, -1.0, 20.0, 0.1, "s", "-1: never")],
                      readouts=[Readout("pressure_kpa", "Pressure inside", "kPa", 2)],
                      tags=["vacuum", "bell jar", "air pressure", "pump", "low pressure", "no air", "vacuum chamber"],
                      description="A glass bell jar on a vacuum pump's plate. From `pump_at` the pump takes the air out: the pressure inside falls toward its "
                                  "lowest. Things inside feel it: a balloon swells and pops, a card falls off an upside-down glass of water, a suction cup lets go.",
                      source="A pumped-down volume: P = P_low + (P_room − P_low)·e^(−t/τ), τ = volume ÷ pump speed (a classroom pump: seconds; "
                             "2 kPa lowest, provisional).", anchor="the middle of its plate's bottom", facts="30 × 35 cm inside · pumps from 0.5 s"))

    def build_tube(c, P):
        _upright(c)
        W, H = P["width"], P["length"]
        steel = c.mat(base="steel", overrides={})
        glass = c.mat(base="glass", overrides={})
        c.slab("base", W + 0.1, 0.03, W + 0.1, 0.0, 0.015, kind="static", material=steel, look="steel", words="the tube's base, its valve to the pump")
        for side, part in ((-1, "wall-left"), (1, "wall-right")):
            c.slab(part, 0.005, H, W, side * (W / 2 + 0.0025), 0.03 + H / 2, kind="static", material=glass, look="glass", words="the clear tube's wall")
        c.slab("cap", W + 0.01, 0.01, W, 0.0, 0.03 + H + 0.005, kind="static", material=steel, look="steel", words="the tube's top cap")
        x0, y0 = c.world(-W / 2, 0.03)
        x1, y1 = c.world(W / 2, 0.03 + H)
        # (not pumped: the control, its air the room's; its pump's lowest is the room's own pressure, so nothing changes)
        low = round(P["lowest_kpa"] * 1000, 3) if P["pumped"] else ATM
        c.process("air", "air", role="jar", name=_name(c), x0=round(x0, 6), x1=round(x1, 6), y0=round(y0, 6), y1=round(y1, 6), pump_at=P["pump_at"],
                  tau=P["pump_s"], low=low, vent=P["vent_at"])

    register(ItemType("vacuum-tube", "Vacuum tube (coin and feather)", CAT, build_tube, dynamic=False, material="glass", materials=["glass"], module=MODULE,
                      props=[Prop("length", "Tube height", 1.5, 0.5, 2.0, 0.05, "m"), Prop("width", "Inside width", 0.3, 0.06, 0.5, 0.01, "m"),
                             Prop("pumped", "Air pumped out", True, kind="bool", help="Off: the control, the tube keeps the room's air"),
                             Prop("pump_at", "Pump starts", 0.0, 0.0, 20.0, 0.1, "s"),
                             Prop("pump_s", "Pumping time", 0.4, 0.1, 10.0, 0.1, "s", "The pressure falls by 63 % every this many seconds"),
                             Prop("lowest_kpa", "Lowest pressure", 0.1, 0.01, 90.0, 0.01, "kPa", "What the pump gets down to (the room is 101.3; 0.1 kPa: a feather falls like a coin)"),
                             Prop("vent_at", "Air let back in at", -1.0, -1.0, 20.0, 0.1, "s", "-1: never")],
                      readouts=[Readout("pressure_kpa", "Pressure inside", "kPa", 2)],
                      tags=["vacuum tube", "coin and feather", "guinea and feather", "feather and coin", "free fall", "falling", "air resistance", "vacuum",
                            "galileo", "drag", "fall together"],
                      description="A tall clear tube on a vacuum pump's base: its pump takes the air out of it from `pump_at`. Inside it the air's drag and "
                                  "buoyancy fall with the pressure, so a feather and a coin let go together at its top (held, released after the pump is done) "
                                  "fall together in the pumped tube; with its air (pumped false) the feather drifts down far behind the coin. Only the "
                                  "inside of the tube is a vacuum: the room keeps its air.",
                      source="A pumped-down volume: P = P_low + (P_room − P_low)·e^(−t/τ) (a classroom 'guinea and feather' tube pumps down in seconds: "
                             "0.1 kPa lowest, provisional); drag and buoyancy ∝ the air's density, ∝ its pressure at the room's temperature.",
                      anchor="the middle of its base's bottom", facts="1.5 m × 30 cm inside · pumped down from 0 s"))


# ---------------------------------------------------------------- air pressure: a card under a glass of water, a suction cup, a steam can
CARDS = {"index card": 0.002, "playing card": 0.0018, "cardboard": 0.006, "plastic lid": 0.004}      # kg for the card under the glass
SURFACES = {"glass": 35000.0, "glazed tile": 30000.0, "painted wall": 10000.0, "wood": 0.0}           # Pa: a push-on suction cup's working vacuum


def _pressure():
    def build_card(c, P):
        _upright(c)
        Dg, Hg, S = P["diameter"], P["height"], P["stand_height"]
        wood = c.mat(base="varnished hardwood", overrides={})
        steel = c.mat(base="steel", overrides={})
        glass = c.mat(base="glass", overrides={})
        mouth = 0.02 + S
        c.slab("base", 0.22, 0.02, 0.16, 0.0, 0.01, kind="static", material=wood, look="wood", words="a stand's base")
        c.slab("post", 0.016, S + Hg + 0.02, 0.016, -0.09, 0.02 + (S + Hg + 0.02) / 2, kind="static", material=steel, look="steel", words="the stand's post")
        c.slab("clamp", 0.09 - Dg / 2 + 0.01, 0.015, 0.02, -0.09 + (0.09 - Dg / 2 + 0.01) / 2, mouth + Hg - 0.02, kind="static", material=steel, look="steel",
               words="a clamp holding the glass")
        for side, part in ((-1, "glass-left"), (1, "glass-right")):
            c.slab(part, 0.003, Hg, Dg, side * (Dg / 2 - 0.0015), mouth + Hg / 2, kind="static", material=glass, look="glass", words="an upside-down drinking glass")
        top = c.slab("glass-top", Dg, 0.006, Dg, 0.0, mouth + Hg - 0.003, kind="static", material=glass, look="glass", words="the glass's bottom, upside down")
        w = Dg + 0.02
        m = CARDS[P["card"]]
        card = c.slab("card", w, 0.0015, w, 0.0, mouth - 0.00125, material=c.mat(base="index card", density=round(m / (w * 0.0015 * w), 3), overrides={}),
                      look="index card", words=f"a {P['card']} over the glass's mouth")
        inner = Dg - 0.006
        area = math.pi * inner * inner / 4
        col = (Hg - 0.006) * P["water"]
        c.process("air", "air", role="card", solid=card, glass=top, name=_name(c), area=round(area, 8), water_h=round(col, 6),
                  air_v=round(max(1e-7, (Hg - 0.006 - col) * area), 9), seal=0.002, water=P["water"], axis={"x": 0.0, "y": 1.0},
                  at=_wp(c, 0.0, mouth - 0.00125), mouth_down=True)

    register(ItemType("card-glass", "Upside-down glass of water and card", CAT, build_card, dynamic=True, material="glass", materials=["glass"], module=MODULE,
                      props=[Prop("water", "Water", 0.8, 0.0, 1.0, 0.05, "", "How full the glass is (1 = full, 0 = empty)"),
                             Prop("diameter", "Glass width", 0.07, 0.05, 0.10, 0.005, "m"), Prop("height", "Glass height", 0.12, 0.08, 0.16, 0.005, "m"),
                             Prop("card", "Card", "index card", kind="choice", choices=list(CARDS)),
                             Prop("stand_height", "Glass's mouth above the base", 0.3, 0.1, 0.6, 0.01, "m")],
                      readouts=[Readout("holding", "Card held up", "", 0, words={0: "no", 1: "yes"}), Readout("push_n", "Air's push on the card", "N", 1),
                                Readout("inside_kpa", "Trapped air", "kPa", 2), Readout("outside_kpa", "Air outside", "kPa", 2), Readout("water", "Water left", "", 2)],
                      tags=["air pressure", "card trick", "upside down glass", "water", "atmospheric pressure", "vacuum", "glass of water"],
                      description="A glass of water held upside down by a clamp with a card over its mouth. The air pushes up on the card far harder than the "
                                  "water weighs (about 390 N on a 7 cm mouth), so the card stays: the trapped air stretches only a fraction of a millimetre. "
                                  "With no water (no seal), or with the air gone (a vacuum, a vacuum jar pumped down), the card falls and the water pours out.",
                      source="P_room·A against ρ·g·h·A + the card's weight; the trapped air expands as P·V = const; the water bridges about a 2 mm gap "
                             "(about water's capillary length, provisional).", anchor="the middle of the stand's base", facts="7 cm glass · 80 % full · index card"))

    def build_cup(c, P):
        _upright(c)
        D, H = P["diameter"], P["height"]
        wood = c.mat(base="varnished hardwood", overrides={})
        steel = c.mat(base="steel", overrides={})
        surf = P["surface"]
        panel_mat = c.mat(base="glass", overrides={}) if surf in ("glass", "glazed tile") else wood
        look = {"glass": "glass", "glazed tile": "ceramic", "painted wall": "paperboard", "wood": "wood"}[surf]
        c.slab("base", 0.30, 0.02, 0.20, 0.0, 0.01, kind="static", material=wood, look="wood", words="a stand's base")
        c.slab("post", 0.025, H, 0.025, -0.12, 0.02 + H / 2, kind="static", material=steel, look="steel", words="the stand's post")
        yp = 0.02 + H
        panel = c.slab("panel", 0.30, 0.008, 0.20, 0.0, yp + 0.004, kind="static", material=panel_mat, look=look, words=f"a sheet of {surf}")
        pts = [(-0.1 * D, -0.38 * D), (0.1 * D, -0.38 * D), (0.3 * D, -0.25 * D), (0.5 * D, -0.03 * D), (0.5 * D, 0.0), (-0.5 * D, 0.0), (-0.5 * D, -0.03 * D),
               (-0.3 * D, -0.25 * D)]
        cup_m = 0.005 * (D / 0.05) * (D / 0.05)
        area_side = 0.0
        for k in range(len(pts)):
            x1, y1 = pts[k]
            x2, y2 = pts[(k + 1) % len(pts)]
            area_side += x1 * y2 - x2 * y1
        area_side = abs(area_side) / 2
        cup = c.poly("cup", pts, _r5(D), 0.05, yp, material=c.mat(base="suction cup vinyl", density=round(cup_m / (area_side * D), 3), overrides={}),
                     look="cup vinyl", words="a suction cup pressed on the sheet")
        load = P["load_kg"] + 0.05
        w = 0.06 if load <= 2 else 0.06 + 0.012 * (load - 2)
        h = load / (7850.0 * w * w)
        knob = yp - 0.38 * D
        # the weight hangs from its hook on a 12 cm string: one rigid body with the cup (the string held taut by the weight; drawn by the cup's model), so
        # what the cup's hold feels is the weight's own pull (a rope's start-up jolt through a 5 g cup is no pull a real cup feels)
        _child(c, "weight", cup, {"kind": "slab", "width": _r5(w), "height": _r5(h), "depth": _r5(w)}, (0.0, -0.38 * D - 0.12 - h / 2),
               c.mat(base="steel", density=7850.0, overrides={}), "steel", "a weight on a hanger")
        del knob
        c.process("air", "air", role="cup", solid=cup, plate=panel, name=_name(c), area=round(math.pi * D * D / 4, 8), dp=SURFACES[surf], axis={"x": 0.0, "y": 1.0},
                  at=_wp(c, 0.05, yp))

    register(ItemType("suction-cup", "Suction cup holding a weight", CAT, build_cup, dynamic=True, material="suction cup vinyl", materials=["suction cup vinyl"], module=MODULE,
                      props=[Prop("diameter", "Cup diameter", 0.05, 0.02, 0.10, 0.005, "m"),
                             Prop("surface", "Stuck to", "glass", kind="choice", choices=list(SURFACES), help="Smooth glass and tile seal well; paint leaks; wood is too rough to stick"),
                             Prop("load_kg", "Weight hung on it", 1.0, 0.0, 10.0, 0.1, "kg"), Prop("height", "Sheet height", 0.6, 0.25, 1.2, 0.01, "m")],
                      readouts=[Readout("holding", "Holding", "", 0, words={0: "no", 1: "yes"}), Readout("hold_n", "Most it can hold", "N", 1, "The air's push on it: the vacuum under it × its area"),
                                Readout("pull_n", "Pull on it", "N", 1)],
                      tags=["suction cup", "air pressure", "vacuum", "sticks", "hook", "atmospheric pressure", "weight"],
                      description="A suction cup pressed onto the underside of a sheet (glass, tile, painted board or wood) with a weight hanging from it. It "
                                  "is held up by the air's push on it (the room's pressure over the partial vacuum under it): a 5 cm cup on glass holds "
                                  "about 69 N (7 kg). Heavier, it lets go; on wood it never sticks; in a vacuum jar it falls.",
                      source="Holding force Δp·A, Δp the working vacuum of a push-on cup: glass 35 kPa, glazed tile 30, painted wall 10, wood 0 "
                             "(pull tests hold 30-60 % of 1 atm × area: provisional).", anchor="the middle of the stand's base", facts="5 cm cup on glass · holds about 7 kg"))

    def build_can(c, P):
        _upright(c)
        gap = P["gap"]
        steel = c.mat(base="steel", overrides={})
        glass = c.mat(base="glass", overrides={})
        c.slab("stove", 0.20, 0.06, 0.20, 0.0, 0.03, kind="static", material=steel, look="steel", words="a camping stove, burning")
        Hc, Dc = 0.122, 0.066
        mass = 0.0149 + 0.015
        can = c.slab("can", Dc, Hc, Dc, 0.0, 0.06 + Hc / 2, material=c.mat(base="can aluminium", density=round(mass / (Dc * Hc * Dc), 3), overrides={}),
                     look="can paint", words="a soda can with a little water in it")
        c.slab("bowl", 0.26, 0.01, 0.2, gap, 0.005, kind="static", material=glass, look="glass", words="a glass dish of cold water")
        for side, part in ((-1, "bowl-left"), (1, "bowl-right")):
            c.slab(part, 0.006, 0.09, 0.2, gap + side * 0.127, 0.01 + 0.045, kind="static", material=glass, look="glass", words="the dish's side")
        water = 0.01 + 0.06
        top = 0.06 + Hc / 2
        c.process("air", "air", role="can", solid=can, name=_name(c), dip=P["dip_at"], boil_s=P["boil_s"], boiled=P["boil_s"] > 0, bath=P["bath_c"],
                  lift=_wp(c, 0.0, top + 0.16), over=_wp(c, gap, top + 0.16), dunk=_wp(c, gap, water - 0.03 + Hc / 2), water_y=round(c.world(0.0, water)[1], 6),
                  dish={"x0": round(c.world(gap - 0.124, 0.0)[0], 6), "x1": round(c.world(gap + 0.124, 0.0)[0], 6)}, height=Hc, diameter=Dc, length=0.115, wall=0.000097, E_gpa=69.0, nu=0.33)

    register(ItemType("steam-can", "Can crushed by air pressure", CAT, build_can, dynamic=True, material="can aluminium", materials=["can aluminium"], module=MODULE,
                      props=[Prop("boil_s", "Boiled for", 30.0, 0.0, 120.0, 1.0, "s", "How long its little water boiled on the stove: the steam pushes the air out (0: not heated)"),
                             Prop("bath_c", "Dish water", 2.0, 0.0, 90.0, 1.0, "°C"), Prop("dip_at", "Dunked at", 1.0, 0.2, 10.0, 0.1, "s"),
                             Prop("gap", "Dish from the stove", 0.35, 0.25, 0.6, 0.01, "m")],
                      readouts=[Readout("crushed", "Crushed", "", 2, "The share of its volume pushed in"), Readout("inside_kpa", "Pressure inside", "kPa", 1),
                                Readout("temp_c", "Inside", "°C", 1), Readout("steaming", "Steaming", "", 0, words={0: "no", 1: "yes"})],
                      tags=["can crush", "air pressure", "steam", "condensation", "implosion", "atmospheric pressure", "vacuum", "soda can"],
                      description="A soda can with a little water boiled in it on a camping stove: its steam pushes the air out. At `dip_at` tongs turn it "
                                  "mouth-down into a dish of cold water: the steam condenses, the pressure inside falls to a few kPa, and the room's air "
                                  "(101 kPa) crushes it with a bang. Not boiled, nothing happens.",
                      source="Water's vapour pressure (Buck); the air left after boiling e^(−t/8 s), at least 3 % (provisional); the wall buckles at 8.7 kPa "
                             "below the room (Windenburg & Trilling, 0.097 mm aluminium); cooling under water τ 0.15 s (provisional).",
                      anchor="the middle of the stove's foot", facts="355 mL can · boiled 30 s · dunked at 1 s into 2 °C water"))


# ---------------------------------------------------------------- things that fly: paper airplanes, gliders, kites
# design -> its wing and tail, each (where its aerodynamic centre is from the plane's balance point (m, + toward the nose), chord m, share of
# the wing area, aspect ratio), its span and wing area, its sheet's area (its weight at paper_gsm) or its own weight, its skin friction, its
# outline (the keel seen from the side, facing right) and thickness. The wing sits so the plane's neutral point is behind its balance point by
# a static margin of 15 % (paper) to 40 % (balsa) of its mean chord: stable, as a well-folded plane is; up-bent tail flaps trim it to fly at
# a higher angle (slower), and paper clips on the nose move its balance point forward (steadier, faster).
DESIGNS = {
    "dart": {"span": 0.13, "S": 0.0164, "sheet": 0.06237, "mass": None, "cd0": 0.03, "depth": 0.006,
             "wing": (0.0113, 0.16, 0.75, 1.03), "tail": (-0.11, 0.048, 0.25, 1.03),
             "outline": [(0.132, 0.0015), (-0.148, 0.004), (-0.148, -0.006), (0.0, -0.022)]},
    "glider": {"span": 0.22, "S": 0.028, "sheet": 0.06237, "mass": None, "cd0": 0.03, "depth": 0.006,
               "wing": (0.0138, 0.15, 0.78, 1.73), "tail": (-0.12, 0.05, 0.22, 1.73),
               "outline": [(0.13, 0.0015), (-0.15, 0.004), (-0.15, -0.006), (0.02, -0.018)]},
    "balsa glider": {"span": 0.30, "S": 0.0192, "sheet": None, "mass": 0.008, "cd0": 0.02, "depth": 0.004,
                     "wing": (0.01155, 0.05, 0.78, 6.0), "tail": (-0.17, 0.035, 0.22, 3.4),
                     "outline": [(0.12, 0.002), (-0.16, 0.004), (-0.16, -0.004), (0.10, -0.008)]},
}


def _centroid_x(pts):
    """The x of a polygon's centroid (its balance point along its length)."""
    a = 0.0
    cx = 0.0
    n = len(pts)
    for k in range(n):
        x1, y1 = pts[k]
        x2, y2 = pts[(k + 1) % n]
        cr = x1 * y2 - x2 * y1
        a += cr
        cx += (x1 + x2) * cr
    return cx / (3 * a)


PAPER = ["white", "yellow", "pink", "blue", "green"]


def _flyers():
    def build_plane(c, P):
        d = DESIGNS[P["design"]]
        face = 1.0 if P["facing"] == "right" else -1.0
        a = P["launch_angle"] * D2R
        # thrown nose first at launch_angle above the level, toward its facing: its body turned so (the item's own angle is not used)
        c.a = face * a
        c.ca, c.sa = cos(c.a), sin(c.a)
        pts = [(face * x, y) for x, y in d["outline"]]
        if face < 0:
            pts = [pts[0]] + list(reversed(pts[1:]))
        mass = d["mass"] if d["mass"] is not None else d["sheet"] * P["paper_gsm"] / 1000
        area = 0.0
        for k in range(len(pts)):
            x1, y1 = pts[k]
            x2, y2 = pts[(k + 1) % len(pts)]
            area += x1 * y2 - x2 * y1
        area = abs(area) / 2
        base = "balsa" if P["design"] == "balsa glider" else "folded paper"
        look = "balsa" if base == "balsa" else "folded paper"
        color = None if base == "balsa" else COLORS[P["color"]]
        extra = {"color": color} if color else {}
        sid = c.poly("plane", pts, d["depth"], 0.0, 0.0, material=c.mat(base=base, density=round(mass / (area * d["depth"]), 3), overrides={}), look=look,
                     words=f"a {P['design']}", **extra)
        parts = [sid]
        clips = int(P["nose_clips"])
        if clips > 0:
            parts.append(_child(c, "clips", sid, {"kind": "slab", "width": 0.03, "height": 0.004, "depth": 0.008}, (face * 0.105, -0.004),
                                c.mat(base="steel", density=round(clips * 0.0005 / (0.03 * 0.004 * 0.008), 3), overrides={}), "steel", f"{clips} paper clip{'s' if clips > 1 else ''} on its nose"))
        surfaces = []
        cx = _centroid_x(d["outline"])
        for key, inc in (("wing", 0.0), ("tail", -P["elevator"] * D2R)):
            ac, chord, share, AR = d[key]
            lx = cx + ac + 0.25 * chord          # its leading edge, a quarter chord ahead of its aerodynamic centre
            ang = inc if face > 0 else math.pi - inc
            surfaces.append({"lx": round(face * lx, 6) + 0.0, "ly": 0.003, "ang": round(ang, 6) + 0.0, "c": chord, "S": round(d["S"] * share, 6), "AR": AR, "cd0": d["cd0"]})
        v = P["launch_speed"]
        c.process("air", "air", role="glider", solid=sid, parts=parts, name=_name(c), surfaces=surfaces,
                  launch={"x": round(face * v * cos(a), 6) + 0.0, "y": round(v * sin(a), 6) + 0.0})

    register(ItemType("paper-airplane", "Paper airplane", CAT, build_plane, material="folded paper", materials=["folded paper"], module=MODULE,
                      props=[Prop("design", "Design", "dart", kind="choice", choices=list(DESIGNS), help="A narrow dart, a broad-winged paper glider, or a balsa glider"),
                             Prop("launch_speed", "Thrown at", 5.0, 0.0, 15.0, 0.1, "m/s"),
                             Prop("launch_angle", "Thrown up at", 5.0, -30.0, 60.0, 0.5, "°", "Its nose and its throw this far above the level"),
                             Prop("elevator", "Tail flaps up", 5.0, -15.0, 15.0, 0.5, "°", "Bent up, its nose rises and it flies slower; down, it dives"),
                             Prop("nose_clips", "Paper clips on the nose", 0, 0, 4, 1, "", "Each 0.5 g: more weight in front makes it steadier and faster", kind="int"),
                             Prop("paper_gsm", "Paper", 80.0, 60.0, 160.0, 5.0, "g/m²", "A4 copy paper is 80 g/m² (a 5 g plane)"),
                             Prop("facing", "Flies to the", "right", kind="choice", choices=["right", "left"]),
                             Prop("color", "Paper colour", "white", kind="choice", choices=PAPER)],
                      readouts=[Readout("distance_m", "Distance", "m", 2, "How far along the floor from where it was thrown to where it landed"),
                                Readout("speed_ms", "Speed", "m/s", 2), Readout("height_m", "Height", "m", 2, "Above where it was thrown from"),
                                Readout("flying", "Flying", "", 0, words={0: "no", 1: "yes"}), Readout("aoa_deg", "Wing's angle to the air", "°", 1)],
                      tags=["paper airplane", "paper plane", "glider", "lift", "drag", "flight", "wings", "balsa glider", "aerodynamics", "dart"],
                      description="A folded paper airplane (or a balsa glider) thrown at the release: its wings' lift holds it up while drag slows it, so it "
                                  "glides down and lands some metres away. Throwing faster or a little higher, a glider's broad wings, a little up-bent tail "
                                  "or a paper clip on the nose (steadier) change how far it goes. It needs air: in a vacuum it falls like a stone.",
                      source="Flat-plate wings: Helmbold's lift slope, crossflow (Polhamus), stall (Torres & Mueller 2004), centre of pressure 25 % → 50 % "
                             "of the chord (Hoerner); skin friction 0.03 (paper). A 5 g A4 dart glides at about 4-5 m/s.",
                      anchor="its balance point (where it is thrown from)", facts="A4 dart · 5 g · thrown at 5 m/s"))

    def build_kite(c, P):
        _upright(c)
        Lk = P["size"]
        W = 0.85 * Lk
        line = P["line_m"]
        right = P["toward"] == "right"
        c.slab("stake", 0.012, 0.06, 0.012, 0.0, 0.03, kind="static", material=c.mat(base="varnished hardwood", overrides={}), look="wood",
               words="a stake the kite's line is tied to")
        # the kite starts on its line at 50° above the level downwind, its nose upwind and 30° above the wind's line
        elev = 50 * D2R
        bx = (1.0 if right else -1.0) * line * cos(elev)
        by = 0.06 + line * sin(elev)
        th = (180 - 30) * D2R if right else 30 * D2R
        xb = Lk / 2 - P["bridle"] * Lk
        ox = bx - xb * cos(th)
        oy = by - xb * sin(th)
        S = 0.5 * Lk * W
        m = S * 0.04 + (Lk + W) * 0.010
        pts = [(-Lk / 2, -0.004), (Lk / 2, -0.004), (Lk / 2, 0.004), (-Lk / 2, 0.004)]
        kite = c.poly("kite", pts, 0.008, ox, oy, th / D2R, material=c.mat(base="kite (spars and ripstop)", density=round(m / (Lk * 0.008 * 0.008), 3), overrides={}),
                      look="ripstop", color=COLORS[P["color"]], words="a diamond kite")
        c.joint("rope", "line", a="kite", b="stake", anchorA=(_r5(xb), 0.0), anchorB=(0.0, 0.03), length=_r5(line), thickness=0.001)
        c.process("air", "air", role="kite", solid=kite, name=_name(c), surface={"lx": _r5(Lk / 2), "ly": 0.0, "ang": 0.0, "c": _r5(Lk), "S": round(S, 6),
                  "AR": round(W * W / S, 6), "cd0": 0.02}, tail={"lx": _r5(-Lk / 2), "ly": 0.0, "area": round(P["tail_m"] * 0.03, 6), "cd": 0.1},
                  stake=_wp(c, 0.0, 0.06), line=line)

    register(ItemType("kite", "Kite", CAT, build_kite, dynamic=True, material="kite (spars and ripstop)", materials=["kite (spars and ripstop)"], module=MODULE,
                      props=[Prop("size", "Height", 0.7, 0.4, 1.2, 0.05, "m", "A diamond kite this tall, 85 % as wide"),
                             Prop("line_m", "Line", 1.5, 0.5, 4.0, 0.05, "m"), Prop("tail_m", "Tail", 1.0, 0.0, 3.0, 0.1, "m", "A 3 cm ribbon: its drag keeps the kite pointing into the wind"),
                             Prop("bridle", "Line tied at", 0.3, 0.15, 0.5, 0.01, "", "Where along its spine the line pulls, from its nose (a share of its height)"),
                             Prop("toward", "Flies to the", "right", kind="choice", choices=["right", "left"], help="Downwind: the wind must blow that way"),
                             Prop("color", "Colour", "red", kind="choice", choices=COLOR_NAMES)],
                      readouts=[Readout("height_m", "Height", "m", 2, "Above its stake"), Readout("line_angle_deg", "Line's angle", "°", 0),
                                Readout("pull_n", "Pull on the line", "N", 2), Readout("wind_ms", "Wind at the kite", "m/s", 2), Readout("flying", "Flying", "", 0, words={0: "no", 1: "yes"})],
                      tags=["kite", "wind", "lift", "drag", "flying", "tail", "string", "breeze", "aerodynamics"],
                      description="A diamond kite on a line tied to a stake. Wind on its face lifts it and pushes it downwind; its line holds it, so it climbs until "
                                  "lift, drag, its weight and the line's pull balance; its tail keeps it steady. It needs wind blowing toward `toward` (a breeze, "
                                  "or a big fan): no wind, it falls.",
                      source="Low-aspect-ratio flat plate (Polhamus's normal force with Helmbold's slope; crossflow 1.2, Hoerner); centre of pressure 25 % → "
                             "50 % of its height; tail ribbon C_d 0.1 on its area (provisional); a 70 cm kite about 25 g.",
                      anchor="the foot of its stake", facts="70 cm diamond · 1.5 m line · 1 m tail"))


# ---------------------------------------------------------------- goals (web/sim/modules/air.js reports the same, number for number)
def _when(by):
    return "" if by is None else f" by {f'{by:.2f}'.rstrip('0').rstrip('.')} s"


def _last(ctx, iid, key):
    v = ctx.state(iid, key)
    return v[-1] if v else None


def _goals():
    def pops(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        by = ctx.num(g.get("before_s"))
        t = ctx.first_time(g["item"], "popped", lambda v: v >= 1)
        happened = t is not None and (by is None or t <= by)
        if g.get("expect") is False:
            return {"label": g.get("label") or f"{ctx.name(g['item'])} does not pop{_when(by)}", "ok": not happened, "kind": "pops", "item": g["item"],
                    "t": None if t is None else round(t, 3)}
        return {"label": g.get("label") or f"{ctx.name(g['item'])} pops{_when(by)}", "ok": happened, "kind": "pops",
                "item": g["item"], "t": None if t is None else round(t, 3)}

    def rises(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        least = ctx.num(g.get("at_least_m"))
        least = 0.2 if least is None else least
        sids = [s["id"] for s in ctx.solids(g["item"], dynamic=True)]
        best = 0.0
        if sids:
            y0 = sum(ctx.frames[0]["placements"][i]["y"] for i in sids) / len(sids)
            for f in ctx.frames:
                y = sum(f["placements"][i]["y"] for i in sids) / len(sids)
                if y - y0 > best:
                    best = y - y0
        up = bool(sids) and best >= least
        if g.get("expect") is False:
            return {"label": g.get("label") or f"{ctx.name(g['item'])} does not rise {ctx.short_m(least)}", "ok": not up, "kind": "lifts_off",
                    "item": g["item"], "rose_m": round(best, 4)}
        return {"label": g.get("label") or f"{ctx.name(g['item'])} rises at least {ctx.short_m(least)}", "ok": up, "kind": "lifts_off",
                "item": g["item"], "rose_m": round(best, 4)}

    def crushes(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        by = ctx.num(g.get("before_s"))
        t = ctx.first_time(g["item"], "crushed", lambda v: v >= 0.05)
        happened = t is not None and (by is None or t <= by)
        if g.get("expect") is False:
            return {"label": g.get("label") or f"{ctx.name(g['item'])} is not crushed{_when(by)}", "ok": not happened, "kind": "crushes",
                    "item": g["item"], "t": None if t is None else round(t, 3)}
        return {"label": g.get("label") or f"{ctx.name(g['item'])} is crushed{_when(by)}", "ok": happened, "kind": "crushes",
                "item": g["item"], "t": None if t is None else round(t, 3)}

    def holds(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        v = _last(ctx, g["item"], "holding")
        return {"label": g.get("label") or f"{ctx.name(g['item'])} holds to the end", "ok": v == 1, "kind": "stays_held", "item": g["item"]}

    def lets_go(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        by = ctx.num(g.get("before_s"))
        t = ctx.first_time(g["item"], "holding", lambda v: v < 0.5)
        return {"label": g.get("label") or f"{ctx.name(g['item'])} lets go{_when(by)}", "ok": t is not None and (by is None or t <= by), "kind": "lets_go",
                "item": g["item"], "t": None if t is None else round(t, 3)}

    def glides(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        least = ctx.num(g.get("at_least_m"))
        least = 1.0 if least is None else least
        v = _last(ctx, g["item"], "distance_m")
        return {"label": g.get("label") or f"{ctx.name(g['item'])} flies at least {ctx.short_m(least)}", "ok": v is not None and v >= least, "kind": "glides",
                "item": g["item"], "distance_m": None if v is None else round(v, 3)}

    def kite_flies(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        least = ctx.num(g.get("at_least_m"))
        least = 0.5 if least is None else least
        v = ctx.state(g["item"], "height_m")
        low = None
        if v:
            tail = v[int(len(v) * 0.7):] or v[-1:]
            low = min(tail)
        up = low is not None and low >= least
        if g.get("expect") is False:
            return {"label": g.get("label") or f"{ctx.name(g['item'])} does not stay up {ctx.short_m(least)} above its stake", "ok": not up,
                    "kind": "kite_flies", "item": g["item"], "low_m": None if low is None else round(low, 3)}
        return {"label": g.get("label") or f"{ctx.name(g['item'])} stays up at least {ctx.short_m(least)} above its stake", "ok": up,
                "kind": "kite_flies", "item": g["item"], "low_m": None if low is None else round(low, 3)}

    def wind_reads(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        lo, hi = ctx.num(g.get("at_least")), ctx.num(g.get("at_most"))
        v = _last(ctx, g["item"], "wind_ms")
        ok = v is not None and (lo is None or v >= lo - 1e-9) and (hi is None or v <= hi + 1e-9)
        bounds = (f" at least {_num_text(lo)} m/s" if lo is not None else "") + (f" at most {_num_text(hi)} m/s" if hi is not None else "")
        return {"label": g.get("label") or f"{ctx.name(g['item'])} reads{bounds or ' a wind'}", "ok": ok, "kind": "wind_reads", "item": g["item"],
                "wind_ms": None if v is None else round(v, 2)}

    def smoke_drifts(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        way = g.get("toward") if g.get("toward") in ("left", "right", "up", "down") else "up"
        dx = _last(ctx, g["item"], "drift_m")
        dy = _last(ctx, g["item"], "rise_m")
        ok = False
        if dx is not None and dy is not None:
            ok = (way == "right" and dx >= 0.05) or (way == "left" and dx <= -0.05) or (way == "up" and dy >= 0.1 and abs(dx) < dy) or (way == "down" and dy <= -0.03)
        return {"label": g.get("label") or f"{ctx.name(g['item'])}'s smoke drifts {way}", "ok": ok, "kind": "smoke_drifts", "item": g["item"], "toward": way,
                "drift_m": None if dx is None else round(dx, 3), "rise_m": None if dy is None else round(dy, 3)}

    def glides_farther(ctx, g):
        a, b = g.get("a"), g.get("b")
        if not (ctx.known(a) and ctx.known(b)):
            return None
        by = ctx.num(g.get("by_m"))
        margin = 0.05 if by is None else max(0.0, by)
        da, db = _last(ctx, a, "distance_m"), _last(ctx, b, "distance_m")
        # (b must have landed, its distance final; a may still be flying, already farther)
        ok = da is not None and db is not None and _last(ctx, b, "flying") == 0 and da >= db + margin
        more = "" if by is None else f" by at least {ctx.short_m(margin)}"
        return {"label": g.get("label") or f"{ctx.name(a)} flies farther than {ctx.name(b)}{more}", "ok": ok, "kind": "glides_farther", "a": a, "b": b,
                "item": a, "distance_a": None if da is None else round(da, 3), "distance_b": None if db is None else round(db, 3)}

    def rises_faster(ctx, g):
        a, b = g.get("a"), g.get("b")
        if not (ctx.known(a) and ctx.known(b)):
            return None
        ra, rb = _rise(ctx, a), _rise(ctx, b)
        ok = ra is not None and rb is not None and ra >= rb + max(RISE_MARGIN, 0.2 * abs(rb))
        return {"label": g.get("label") or f"{ctx.name(a)} rises faster than {ctx.name(b)}", "ok": ok, "kind": "rises_faster", "a": a, "b": b, "item": a,
                "rise_a": None if ra is None else round(ra, 3), "rise_b": None if rb is None else round(rb, 3)}

    def jets(ctx, g):
        iid = g.get("item")
        if not ctx.known(iid):
            return None
        way = g.get("toward") if g.get("toward") in ("left", "right", "up", "down") else None
        least = ctx.num(g.get("at_least_m"))
        least = 0.5 if least is None else least
        untied = any(p.get("kind") == "air" and p.get("role") == "balloon" and p.get("item") == iid and p.get("tied") is False for p in ctx.doc.get("processes", []))
        th = ctx.state(iid, "thrust_n") or []
        push = max(th) if th else 0.0
        best = _travel(ctx, iid, way)
        ok = untied and push > 0 and best is not None and best >= least
        where = f" {way}" if way else " sideways"
        label = f"{ctx.name(iid)} jets{where} at least {ctx.short_m(least)} on its own air"
        if g.get("expect") is False:
            ok = not ok
            label = f"{ctx.name(iid)} does not jet{where} {ctx.short_m(least)}"
        return {"label": g.get("label") or label, "ok": ok, "kind": "jets", "item": iid,
                "toward": way, "untied": untied, "travel_m": None if best is None else round(best, 3), "thrust_n": round(push, 4)}

    def swells(ctx, g):
        return _size_goal(ctx, g, True)

    def shrinks(ctx, g):
        return _size_goal(ctx, g, False)

    for kind, fn in (("pops", pops), ("lifts_off", rises), ("crushes", crushes), ("stays_held", holds), ("lets_go", lets_go), ("glides", glides),
                     ("kite_flies", kite_flies), ("wind_reads", wind_reads), ("smoke_drifts", smoke_drifts), ("glides_farther", glides_farther),
                     ("rises_faster", rises_faster), ("jets", jets), ("swells", swells), ("shrinks", shrinks)):
        register_goal_kind(kind, fn)


# how much more one thing must rise than another to rise faster over the same run: 5 cm and 20 % more (two identical incense sticks' smoke,
# averaged over the run's second half, differs by up to about 3 cm, 8 %: its particles' random walk)
RISE_MARGIN = 0.05


def _mean(v):
    # (added in order, as the JS port does: Python 3.12's sum() of floats is compensated)
    t = 0.0
    for y in v:
        t += y
    return t / len(v)


def _rise(ctx, iid):
    """How high it got: an incense stick's smoke's mean rise over the second half of the run; else its moving parts' rise at the end (m)."""
    v = ctx.state(iid, "rise_m")
    if v:
        tail = v[len(v) // 2:] or v[-1:]
        return _mean(tail)
    sids = [s["id"] for s in ctx.solids(iid, dynamic=True)]
    if not sids or not ctx.frames:
        return None
    y0 = _mean([ctx.frames[0]["placements"][i]["y"] for i in sids])
    y1 = _mean([ctx.frames[-1]["placements"][i]["y"] for i in sids])
    return y1 - y0


def _travel(ctx, iid, way):
    """The farthest its first moving part got from where it started, along `way` (left, right, up, down) or sideways either way (m)."""
    sids = [s["id"] for s in ctx.solids(iid, dynamic=True)]
    if not sids or not ctx.frames:
        return None
    sid = sids[0]
    p0 = ctx.frames[0]["placements"][sid]
    best = 0.0
    for f in ctx.frames:
        q = f["placements"].get(sid)
        if q is None:
            continue
        dx, dy = q["x"] - p0["x"], q["y"] - p0["y"]
        d = dx if way == "right" else -dx if way == "left" else dy if way == "up" else -dy if way == "down" else abs(dx)
        if d > best:
            best = d
    return best


def _size_goal(ctx, g, grow):
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    x = ctx.num(g.get("at_least_x"))
    x = 1.05 if x is None or x <= 1 else x
    measure = "diameter" if g.get("measure") == "diameter" else "volume"
    key = "volume_l" if measure == "volume" and ctx.state(iid, "volume_l") else "diameter_cm"
    v = ctx.state(iid, key) or []
    gone = ctx.state(iid, "popped") or []
    # (its size until it popped, if it did: a balloon that swelled and then burst did swell)
    vals = [y for k, y in enumerate(v) if not (k < len(gone) and gone[k] >= 1) and y > 0]
    ratio = vals[-1] / vals[0] if len(vals) >= 1 and vals[0] > 0 else None
    ok = ratio is not None and (ratio >= x - 1e-9 if grow else ratio <= 1 / x + 1e-9)
    what = "its volume" if key == "volume_l" else "its width"
    if grow:
        label = f"{ctx.name(iid)} swells to at least {_num_text(x)}× {what}"
    else:
        label = f"{ctx.name(iid)} shrinks to {_num_text(100 / x)} % of {what} or less"
    return {"label": g.get("label") or label, "ok": ok, "kind": "swells" if grow else "shrinks", "item": iid, "measure": key,
            "from": None if not vals else round(vals[0], 4), "to": None if not vals else round(vals[-1], 4), "ratio": None if ratio is None else round(ratio, 4)}


def _num_text(v):
    t = f"{v:.2f}".rstrip("0").rstrip(".")
    return t


# ---------------------------------------------------------------- the build hook: jars round things, heat guns under smoke
# worlds whose air is next to none (the Moon none; Mars 0.6 kPa, 1.6 % of Earth's air's density: NASA Mars fact sheet), by their gravity preset
AIRLESS = {"moon": 1.62, "mars": 3.71}


def _airless(raw):
    """A scene that names an airless world by its gravity alone (gravity "moon" or "mars", or their m/s²) and says nothing of its air."""
    if not isinstance(raw, dict) or raw.get("air") is not None:
        return False
    gv = raw.get("gravity")
    if isinstance(gv, str):
        return gv.strip().lower() in AIRLESS
    return isinstance(gv, (int, float)) and not isinstance(gv, bool) and float(gv) in AIRLESS.values()


def _solid_at(sb, sid):
    return next((s for s in sb.solids if s["id"] == sid), None)


def _bell_box(sb, iid):
    """The inside of the waves module's bell jar `iid` (world m: between its glass sides, over its plate, under its top), or None."""
    left, right, top, plate = (_solid_at(sb, f"{iid}/{p}") for p in ("glass-left", "glass-right", "glass-top", "plate"))
    if None in (left, right, top, plate):
        return None
    return {"x0": round(left["at"]["x"] + left["body"]["width"] / 2, 6), "x1": round(right["at"]["x"] - right["body"]["width"] / 2, 6),
            "y0": round(plate["at"]["y"] + plate["body"]["height"] / 2, 6), "y1": round(top["at"]["y"] - top["body"]["height"] / 2, 6)}


def _hook(sb, scene):
    recs = [p for p in sb.processes if p.get("kind") == "air"]
    if not recs:
        return
    if _airless(scene.get("settings")):
        # (the Moon or Mars named by its gravity alone: no air there, so no buoyancy, drag or wind, and a balloon bursts)
        sb.settings["air"] = False
    # the waves module's bell jar is a jar too: its own straight-line pump-down, as an air jar record (balloons, cards and cups in it feel it)
    for p in [q for q in sb.processes if q.get("kind") == "sound" and q.get("role") == "source" and isinstance(q.get("jar"), dict)]:
        box = _bell_box(sb, p.get("item"))
        if box is None:
            continue
        j = p["jar"]
        it = sb.scene_items.get(p["item"]) or {}
        rec = {"kind": "air", "id": f"{p['item']}/air-jar", "item": p["item"], "role": "jar", "name": it.get("name") or TYPES["bell-jar"].name, **box,
               "linear": {"from": j.get("from", 100.0), "to": j.get("to", 100.0), "t0": j.get("t0", 0.0), "t1": j.get("t1", 0.0)}}
        sb.processes.append(rec)
        recs.append(rec)
    jars = [{"item": p["item"], "x0": p["x0"], "x1": p["x1"], "y0": p["y0"], "y1": p["y1"]} for p in recs if p.get("role") == "jar"]
    if jars:
        for p in recs:
            if p.get("role") in ("balloon", "card", "cup"):
                p["jars"] = [dict(j) for j in jars]
        # a sound source inside one of this module's jars is heard less as it is pumped down (the waves module's own jar law: what reaches the
        # room ∝ the air's pressure, through 20 dB of glass, 55 dB through the plate); the jar's e^(−t/τ) taken as a straight line over 3τ (95 %)
        own = [p for p in recs if p.get("role") == "jar" and "linear" not in p]
        for q in sb.processes:
            if q.get("kind") != "sound" or q.get("role") != "source" or "jar" in q:
                continue
            s = _solid_at(sb, q.get("solid"))
            if s is None or "parent" in s:
                continue
            x = s["at"]["x"] + (q.get("at") or {}).get("x", 0.0)
            y = s["at"]["y"] + (q.get("at") or {}).get("y", 0.0)
            j = next((p for p in own if p["x0"] <= x <= p["x1"] and p["y0"] <= y <= p["y1"]), None)
            if j is None:
                continue
            q["jar"] = {"from": 100.0, "to": round(100 * j["low"] / ATM, 6), "t0": round(j["pump_at"], 6), "t1": round(j["pump_at"] + 3 * j["tau"], 6),
                        "glass": 20.0, "base": 55.0}
    guns = [{"x": p["heater"]["x"], "y": p["heater"]["y"], "w": 1.5, "half": 0.025} for p in recs if p.get("role") == "hotair" and p.get("power", 0) > 0]
    if guns:
        for p in recs:
            if p.get("role") == "smoke":
                p["heaters"] = [dict(h) for h in guns]
    planes = [p for p in recs if p.get("role") == "glider"]
    if len(planes) >= 2:
        # (paper planes pass through each other: in this side view, planes thrown side by side share one flight path)
        for p in planes:
            p["pass"] = [x for q in planes if q is not p for x in q["parts"]]
