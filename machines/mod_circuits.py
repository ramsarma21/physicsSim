"""The circuits module: DC circuits of batteries, wires, bulbs, LEDs, switches, buzzers, motors, testers, meters, solar panels and hand
generators (web/CONTRACT.md "Circuits"). Every circuit item's builder lists its electrical parts and terminals; a build hook then gathers them
and every wire into ONE engine process, {kind: "circuit", ...} (tooling/src/sim/modules/circuits.ts), which solves the network every 480 Hz
step (nodal analysis: tooling/src/sim/circuit-solver.ts) and couples it to the mechanics (motors turn their shafts, a press switch is closed by
what rests on it, a tester conducts through what touches both its probes, a wire comes off when pulled too far). web/sim/modules/circuits.js
is the exact port (the same document, number for number).

Terminals: every part has two, a FIRST (on its right: a battery's +, an LED's anode, a bulb's or a switch's a) and a SECOND (on its left: −,
cathode, b). A wire's ends name an item (links `a` and `b`) and which of its terminals ("+" = the first, "-" = the second).
A circuit can stand on the table (each part on its own little base board) or be clipped to an upright circuit board facing the camera
(`mount` "board": the part is fixed where it is put, drawn on the board behind it), which is how a circuit reads best from the side.

Sources (keys as in the engine4 spec): [ENR] Energizer E91 (AA) and 522 (9 V) data sheets: alkaline AA 1.5 V nominal, about 1.58 V fresh on
open circuit, internal resistance about 0.15-0.3 Ω fresh, the voltage under a light load falling to about 1.3 V at half its capacity and 1.1 V
near its end; 9 V about 1.5-2 Ω. [AWG] ASTM B258 / standard wire tables: 22 AWG copper 0.0530 Ω/m at 20 °C. [CRC] CRC Handbook of Chemistry
and Physics, resistivities at 20 °C: copper 1.68e-8, aluminium 2.65e-8, brass about 6.4e-8, carbon steel about 1.4e-7, cupronickel 75/25 about
3.8e-7 Ω·m; graphite (a pencil's lead, with its clay) about 1e-5 Ω·m; glass 1e10-1e14, rubber 1e13, dry wood 1e14-1e16 Ω·m. [IES] IES
Lighting Handbook: an incandescent lamp's current ∝ V^0.55-0.6, light ∝ V^3.4. [LED] typical 5 mm LED data sheets (Kingbright WP7113 series):
forward voltage at 20 mA red about 2.0 V, yellow 2.1, green (GaP) 2.2, blue and white about 3.2 V; 30 mA the most continuous current.
[MAB] Mabuchi FA-130RA: at 3 V about 9100 rpm and 0.2 A with no load, about 2.2 A stalled. Everything marked provisional is a judgement.
"""
import math

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "register_goal_kind", "register_build_hook", "MATERIALS", "add_look", "props_of",
          "TYPES", "CATEGORIES", "cos", "sin", "Ctx")

CAT = "Electricity"
BASE_H = 0.012              # m: a part's base board (12 mm plywood)
POST_W, POST_H = 0.008, 0.01    # m: a brass screw terminal on a base board
WIRE_OHM_M = 0.0530         # Ω/m: 22 AWG copper [AWG]
SWITCH_OHM = 0.01           # Ω: a closed switch's contacts (provisional)
WIRE_COLORS = ["red", "black", "blue", "yellow", "green", "white"]
# a cell's open-circuit voltage against its charge (percent, V): an alkaline cell [ENR]; between the points, straight lines
CELL_CURVE = [(0.0, 0.9), (10.0, 1.1), (50.0, 1.3), (100.0, 1.58)]
# battery kinds: cells inside, internal resistance (Ω, fresh, the whole battery), body (width, height, depth per battery, m), mass (kg)
BATTERY_KINDS = {
    "AA": dict(cells=1, r=0.2, w=0.0505, h=0.0145, d=0.0145, mass=0.023),          # [ENR] E91: 50.5 x 14.5 mm, 23 g, about 0.15-0.3 Ω
    "D": dict(cells=1, r=0.1, w=0.0615, h=0.0342, d=0.0342, mass=0.14),            # [ENR] E95: 61.5 x 34.2 mm, about 140 g, about 0.1 Ω
    "9V": dict(cells=6, r=1.7, w=0.0265, h=0.0485, d=0.0175, mass=0.045),          # [ENR] 522: 48.5 x 26.5 x 17.5 mm, 45 g, about 1.5-2 Ω
    "lantern 6V": dict(cells=4, r=0.3, w=0.067, h=0.115, d=0.067, mass=0.6),       # a 4R25 lantern battery: 67 x 67 x 115 mm (provisional r)
}
# bulb ratings (V, A): the classroom MES/E10 bulb 2.5 V 0.3 A, a #222 torch bulb 2.25 V 0.25 A, a 3.8 V 0.3 A and a #47-type 6 V 0.06 A
BULB_RATINGS = {"2.5V 0.3A": (2.5, 0.3), "2.25V 0.25A": (2.25, 0.25), "3.8V 0.3A": (3.8, 0.3), "6V 0.06A": (6.0, 0.06)}
# LED colours: forward voltage at 20 mA, its slope resistance (Ω, provisional) and the colour it glows [LED]
LED_COLORS = {"red": (2.0, 10.0, "#ff2a1a"), "yellow": (2.1, 10.0, "#ffc81a"), "green": (2.2, 10.0, "#2aff3a"), "blue": (3.2, 15.0, "#2a6aff"),
              "white": (3.2, 15.0, "#f4f6ff")}
LED_I_RATED, LED_I_MAX = 0.02, 0.03     # A [LED]
# motors: k (V·s/rad at the shaft), R (Ω), gearbox efficiency, friction torque at the shaft (N·m), can size (length, diameter, m)
MOTORS = {
    # [MAB] FA-130: R = 3 V / 2.2 A; k from 9100 rpm at 3 V less the no-load 0.2 A's drop; friction = k x 0.2 A
    "hobby": dict(k=round((3 - 0.2 * (3 / 2.2)) / (9100 * 2 * math.pi / 60), 7), r=round(3 / 2.2, 4), eff=1.0,
                  fric=round(0.2 * (3 - 0.2 * (3 / 2.2)) / (9100 * 2 * math.pi / 60), 7), can=(0.038, 0.02)),
    # a solar motor (Mabuchi RF-300 class): turns from about 25 mA; about 1900 rpm with no load at 2 V (provisional)
    "solar": dict(k=0.0085, r=12.0, eff=1.0, fric=0.00021, can=(0.026, 0.024)),
    # a 48:1 "TT" gear motor (the yellow robot-car motor): about 100 rpm at 3 V with no load, about 1 kg·cm stalled (provisional), k at the output
    "geared": dict(k=0.26, r=2.5, eff=0.6, fric=0.004, can=(0.07, 0.022)),
}
# what a tester's probes conduct through: resistivity (Ω·m) by material [CRC]; a material not listed is an insulator (the engine's 1e14 Ω·m)
RESISTIVITY = {
    "copper": 1.68e-8, "brass": 6.4e-8, "aluminium": 2.65e-8, "aluminium can": 2.65e-8, "glass & aluminium": 2.65e-8, "steel": 1.43e-7,
    "steel weight": 1.43e-7, "cupronickel": 3.8e-7, "graphite": 1e-5,
    "fruit": 20.0,          # a fruit's juicy flesh, about 0.05 S/m (provisional): a battery's current through it is milliamps at most
    "ice": 1e6, "glass": 1e12, "glass marble": 1e12, "solid rubber": 1e13, "rubber mat": 1e13, "tyre rubber": 1e13, "vinyl rubber": 1e13,
    "varnished hardwood": 1e14, "domino wood": 1e14, "dark wood": 1e14, "hollow plastic": 1e15, "ABS plastic": 1e15, "polypropylene": 1e15,
    "modeling clay": 1e10,  # oil-based plasticine: an insulator (provisional)
}
TYPES_OF = ("battery", "bulb", "led", "switch", "buzzer", "motor", "resistor", "dimmer", "tester", "meter", "solar-panel", "hand-generator",
            "electromagnet", "coil", "straight-wire", "wind-turbine", "generator")
# what drives current round a loop (a wire end whose terminal is not said is joined + of a source to + of a load: SOURCES, _gather); the energy
# module's wind turbine and small generator are sources too (machines/mod_energy.py puts their parts and terminals in this module's store)
SOURCES = ("battery", "solar-panel", "hand-generator", "wind-turbine", "generator")
# a battery car (a motor that drives "wheels"): the cars it may ride on (their rear wheel, chassis and rear axle joint), and each motor's own weight
CARS = ("toy-car", "cart", "truck", "dynamics-cart")
MOTOR_MASS = {"hobby": 0.018, "solar": 0.022, "geared": 0.03}      # kg: FA-130 18 g [MAB], RF-300 about 22 g, a TT gear motor about 30 g (provisional)
# Electromagnetism. [ASTM] ASTM B258 / NEC ch. 9 table 8 enamelled copper at 20 °C: 24 AWG 0.511 mm 84.2 mΩ/m, 28 AWG 0.321 mm 212.9 mΩ/m;
# 14 AWG bare 1.628 mm 8.28 mΩ/m. [CHIKAZUMI] low-carbon steel (a nail): saturation µ0·M_s ≈ 2.0 T (M_s 1.6 MA/m), initial χ ≈ 1000 (the
# magnetism module's numbers for its own nail electromagnet, so a nail is the same iron in both). A school centre-zero galvanometer: about
# 0.5 mA full scale, about 50 Ω, a needle that swings and settles in about half a second (provisional, typical demonstration meters).
AWG24_D, AWG24_OHM = 0.000511, 0.0842
AWG28_D, AWG28_OHM = 0.000321, 0.2129
AWG14_D, AWG14_OHM = 0.001628, 0.00828
NAIL_MS, NAIL_CHI = 1.6e6, 1000.0
GALVO_FS, GALVO_OHM = 0.0005, 50.0
COIL_TUBE = 0.002           # m: the cardboard tube the coil is wound on (its wall)
# A solar panel's cells' electric efficiency per band of the optics module's 8 (7 visible colours, the near infrared), for that module's own
# "electric" figure: the mini panel's 5.9 % in sunlight (0.2 A at about 1.6 V from its 9 x 6 cm in 1000 W/m², typical mini-panel data),
# shared out by silicon's response per band (tooling/src/sim/modules/circuits.ts SI_RESPONSE: crystalline silicon's quantum efficiency [GREEN]
# Green M.A., Solar Cells, 1982; its infrared as sunlight's, ASTM G173). The current itself the engine works out band by band.
PV_EFF = (0.0399, 0.0532, 0.0606, 0.0662, 0.0713, 0.0759, 0.0868, 0.0553)


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CAT not in CATEGORIES:
        CATEGORIES.append(CAT)
    _materials()
    _types()
    register_build_hook(_mount_on_cars)       # (before _gather: a battery car's motor rides on its car, its terminals there)
    register_build_hook(_gather)
    # (stays_dark and glows_brighter, not "dark" and "brighter": the optics module's light-meter goals have those names)
    for kind, fn in (("lights", goal_lights), ("stays_dark", goal_dark), ("glows_brighter", goal_brighter), ("buzzes", goal_buzzes), ("spins", goal_spins),
                     ("current", goal_current), ("conducts", goal_conducts), ("deflects", goal_deflects), ("induces", goal_induces)):
        register_goal_kind(kind, fn)


def _module_on(type_key, module):
    """Whether another module is loaded (its type is in the catalog): checked at build time, when every module has registered."""
    t = TYPES.get(type_key)
    return t is not None and t.module == module


def _lit_scene(c):
    """Whether the scene has light the optics module traces: one of its items (a flashlight, a lamp, the sun, a mirror...) or the heat
    module's desk lamp (whose light the optics module adds)."""
    if not _module_on("flashlight", "optics"):
        return False
    for it in c.sb.scene_items.values():
        t = TYPES.get(it.get("type"))
        if t is not None and (t.module == "optics" or (it.get("type") == "lamp" and t.module == "heat")):
            return True
    return False


def _materials():
    if "copper" not in MATERIALS:
        add_look("copper", fill="#c8743c", shade="#8f4f24", roughness=0.3, metalness=1.0, clearcoat=0.0)
        MATERIALS["copper"] = dict(density=8960, bounce=0.6, friction=0.4, rolling=0.002, side=0.0, look="copper",
                                   source="Copper 8960 kg/m³; resistivity 1.68e-8 Ω·m at 20 °C (CRC).")
    if "brass" not in MATERIALS:
        add_look("brass", fill="#c9a640", shade="#8d7226", roughness=0.3, metalness=1.0, clearcoat=0.0)
        MATERIALS["brass"] = dict(density=8500, bounce=0.6, friction=0.4, rolling=0.002, side=0.0, look="brass",
                                  source="Brass 8400-8700 kg/m³; resistivity about 6.4e-8 Ω·m (CRC).")
    if "graphite" not in MATERIALS:
        add_look("graphite", fill="#3b3d40", shade="#1f2022", roughness=0.45, metalness=0.3, clearcoat=0.0)
        MATERIALS["graphite"] = dict(density=2000, bounce=0.3, friction=0.2, rolling=0.01, side=0.0, look="graphite",
                                     source="A pencil's lead: graphite and clay, about 2000 kg/m³ (provisional); resistivity about 1e-5 Ω·m (CRC, graphite).")
    if "circuit plastic" not in MATERIALS:
        add_look("circuit plastic", fill="#2b2d31", shade="#151618", roughness=0.4, metalness=0.0, clearcoat=0.3)
        MATERIALS["circuit plastic"] = dict(density=1100, bounce=0.5, friction=0.4, rolling=0.01, side=0.0, look="circuit plastic",
                                            source="ABS and polycarbonate cases, 1050-1200 kg/m³ (provisional).")


# ---------------------------------------------------------------- helpers
def _num(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def _store(sb):
    """The circuit gathered so far on this scene builder (parts, terminals, wires, boards), made on first use."""
    st = getattr(sb, "circuit", None)
    if st is None:
        st = {"parts": [], "terminals": {}, "wires": [], "boards": []}
        sb.circuit = st
    return st


def _name(c):
    return c.item.get("name") or TYPES[c.item["type"]].name


def _on_board(c, P):
    return P.get("mount") == "board"


def _kind(c, P):
    """A part on the board is fixed where it is put; on the table it is free (unless the item is ticked Fixed)."""
    return "static" if _on_board(c, P) else None


def _weld(c, parent, lx, ly, plx=0.0, ply=0.0):
    """The solid just added stands welded to `parent` (a solid id at item-local (plx, ply)): its `at` in the parent's frame."""
    s = c.sb.solids[-1]
    s["parent"] = parent
    s["at"] = {"x": round(lx - plx, 5), "y": round(ly - ply, 5)}
    s.pop("angle", None)
    return s["id"]


def _terminal(c, name, solid, x, y):
    """Terminal "<item>/<name>" at (x, y) in solid's own frame (its wire clips there)."""
    _store(c.sb)["terminals"][f"{c.item['id']}/{name}"] = {"solid": solid, "at": {"x": round(x, 5), "y": round(y, 5)}}


def _part(c, kind, role=None, **fields):
    """A circuit part of this item, between its terminals "+" (first) and "-" (second) unless a and b are given."""
    iid = c.item["id"]
    p = {"kind": kind, "id": f"{iid}/{role or kind}", "item": iid, "name": _name(c), "a": f"{iid}/+", "b": f"{iid}/-"}
    if role:
        p["role"] = role
    p.update(fields)
    _store(c.sb)["parts"].append(p)
    return p


def _base(c, P, w, d, kind=None):
    """A part's base board (on the table: its anchor at the board's middle) and its two brass terminals; returns the base solid's id.
    kind: "static" for a part clamped to the table (a motor's stand)."""
    kind = kind or _kind(c, P)
    wood = c.mat(base="varnished hardwood", overrides={})
    base = c.slab("base", w, BASE_H, d, 0.0, 0.0, material=wood, look="wood", words="a small wooden base board", kind=kind)
    brass = c.mat(base="brass", overrides={})
    for name, sx in (("+", 1), ("-", -1)):
        x = sx * (w / 2 - 0.009)
        c.slab("post_plus" if sx > 0 else "post_minus", POST_W, POST_H, 0.008, x, BASE_H / 2 + POST_H / 2, material=brass, look="brass",
               words="a brass terminal", kind=kind)
        _weld(c, base, x, BASE_H / 2 + POST_H / 2)
        _terminal(c, name, base, x, BASE_H / 2 + POST_H)
    return base


def _mount_prop():
    return Prop("mount", "Stands on", "table", kind="choice", choices=["table", "board"],
                help="table: on its own base board, free to be knocked; board: clipped to a circuit board (fixed where it is put), drawn on the board behind it")


def _cell_volts(pct):
    """An alkaline cell's open-circuit voltage at this charge (%), on CELL_CURVE [ENR]."""
    pct = max(0.0, min(100.0, pct))
    for (p0, v0), (p1, v1) in zip(CELL_CURVE, CELL_CURVE[1:]):
        if pct <= p1:
            return v0 + (v1 - v0) * (pct - p0) / (p1 - p0)
    return CELL_CURVE[-1][1]


# ---------------------------------------------------------------- the types
def _types():
    common = dict(module="circuits", material=None)

    # --- battery
    def build_battery(c, P):
        kind = BATTERY_KINDS[P["kind"]]
        n = int(P["cells"]) if P["kind"] in ("AA", "D") else 1
        w, h, d = kind["w"], kind["h"], kind["d"]
        plastic = c.mat(base="circuit plastic", density=round(kind["mass"] / (w * h * d), 2), overrides={})
        # a holder of n cells side by side, front to back (an AA or D holder), or the battery itself (9 V, lantern)
        depth = round(d * n + (0.004 if n > 1 or P["kind"] in ("AA", "D") else 0.0), 5)
        hold_h = h + (0.003 if P["kind"] in ("AA", "D") else 0.0)
        body = c.slab("body", w + (0.008 if P["kind"] in ("AA", "D") else 0.0), hold_h, depth, 0.0, 0.0, material=plastic, look="circuit plastic",
                      words="a battery", kind=_kind(c, P))
        brass = c.mat(base="brass", overrides={})
        top = hold_h / 2
        tx = (w / 2 - 0.006) if P["kind"] in ("AA", "D") else (0.006 if P["kind"] == "9V" else w / 2 - 0.012)
        for name, sx in (("+", 1), ("-", -1)):
            c.slab("post_plus" if sx > 0 else "post_minus", 0.006, 0.006, 0.006, sx * tx, top + 0.003, material=brass, look="brass",
                   words="a battery terminal", kind=_kind(c, P))
            _weld(c, body, sx * tx, top + 0.003)
            _terminal(c, name, body, sx * tx, top + 0.006)
        pct = P["charge_pct"]
        cells = kind["cells"] * n
        emf = round(_cell_volts(pct) * cells, 5)
        r = round(kind["r"] * n * (2 - pct / 100), 5)        # internal resistance: doubles toward empty [ENR] (approximate)
        _part(c, "battery", emf=emf, r=r)
    register(ItemType("battery", "Battery", CAT, build_battery, **common,
                      props=[Prop("kind", "Kind", "AA", kind="choice", choices=list(BATTERY_KINDS), help="AA or D cells in a holder; a 9 V battery; a 6 V lantern battery"),
                             Prop("cells", "Cells in the holder", 2, 1, 6, 1, "", "AA or D cells in series (2 x AA = 3 V)", kind="int"),
                             Prop("charge_pct", "Charge", 100.0, 0.0, 100.0, 1.0, "%", "A fresh battery is 100 %; a run-down one gives less voltage and has more resistance inside"),
                             _mount_prop()],
                      readouts=[Readout("voltage", "Voltage at its terminals", "V", 2), Readout("current", "Current out of +", "A", 3)],
                      tags=["cell", "AA", "power", "electricity", "battery pack", "9 volt", "D cell", "energy", "source", "holder"],
                      description="Alkaline cells in a holder (2 x AA = 3 V). Its + terminal is on the right, − on the left; wires join them to the rest of a circuit.",
                      source="Alkaline AA: 1.58 V fresh on open circuit, about 0.2 Ω inside, falling to about 1.3 V at half charge and 1.1 V near empty; 9 V about 1.7 Ω (Energizer E91 and 522 data sheets).",
                      anchor="the middle of the holder", facts="2 x AA · 3.2 V fresh · 0.4 Ω inside"))

    # --- wire
    def build_wire(c, P):
        # (no solid: a wire is drawn between its two terminals; the build hook joins it to them; an end whose terminal the item does not say
        # is joined as current flows round a loop: see _gather)
        raw = c.item.get("props") or {}
        _store(c.sb)["wires"].append({"item": c.item["id"], "name": _name(c), "a": c.link("a"), "a_end": P["a_end"], "b": c.link("b"), "b_end": P["b_end"],
                                      "a_auto": "a_end" not in raw, "b_auto": "b_end" not in raw,
                                      "length": _num(raw.get("length")), "color": P["color"], "P": P})
    register(ItemType("wire", "Wire", CAT, build_wire, dynamic=False, **common,
                      props=[Prop("a_end", "End a on terminal", "+", kind="choice", choices=["+", "-"], help="+ is a part's first terminal (a battery's +, an LED's long leg, a bulb's right screw); - its second. Not set: joined as current flows (a battery's + to a part's +, a part's − on to the next part's + or the battery's −)"),
                             Prop("b_end", "End b on terminal", "-", kind="choice", choices=["+", "-"], help="Which terminal of the second item (not set: as current flows from end a's)"),
                             Prop("length", "Length", 0.3, 0.05, 3.0, 0.01, "m", "Automatic: a little longer than the gap between its ends at the start. Pulled farther apart than this, it comes off", auto=True),
                             Prop("color", "Colour", "red", kind="choice", choices=WIRE_COLORS)],
                      links=[Link("a", "End a clips to", types=list(TYPES_OF), help="The part its end a is clipped to"),
                             Link("b", "End b clips to", types=list(TYPES_OF), help="The part its end b is clipped to")],
                      readouts=[Readout("current", "Current", "A", 3), Readout("off", "Pulled off", "", 0)],
                      tags=["lead", "cable", "connector", "crocodile clip", "alligator", "conductor", "connect", "circuit", "copper", "jumper"],
                      description="A copper lead with crocodile clips. Clip end a and end b to two terminals (+ or −) of two parts; an end clipped to nothing leaves the circuit open.",
                      source="22 AWG copper hookup wire: 0.053 Ω per metre at 20 °C (ASTM B258 wire tables).",
                      anchor="(it has no place of its own: it runs between its two ends)", facts="22 AWG copper · 0.053 Ω/m"))

    # --- bulb
    def build_bulb(c, P):
        v, i = BULB_RATINGS[P["rating"]]
        board = _on_board(c, P)
        glass = c.mat(base="glass", overrides={}) if "glass" in MATERIALS else c.mat(base="steel", overrides={})
        brass = c.mat(base="brass", overrides={})
        # (every part is welded straight to the item's root, the base board or, on the board, the holder: one level of welds)
        if board:
            holder = c.slab("holder", 0.024, 0.016, 0.024, 0.0, 0.0, material=c.mat(base="circuit plastic", overrides={}), look="circuit plastic",
                            words="a bulb holder", kind="static")
            hy = 0.0
            root = holder
            for name, sx in (("+", 1), ("-", -1)):
                _terminal(c, name, holder, sx * 0.012, 0.0)
        else:
            root = _base(c, P, 0.06, 0.045)
            hy = BASE_H / 2 + 0.008
            holder = c.slab("holder", 0.024, 0.016, 0.024, 0.0, hy, material=c.mat(base="circuit plastic", overrides={}), look="circuit plastic",
                            words="a bulb holder")
            _weld(c, root, 0.0, hy)
        # an E10 (MES) bulb: a brass screw cap and an 11 mm glass globe on it
        cy = hy + 0.008 + 0.005
        c.slab("cap", 0.009, 0.01, 0.009, 0.0, cy, material=brass, look="brass", words="a bulb's screw cap", kind=_kind(c, P))
        _weld(c, root, 0.0, cy)
        gy = cy + 0.005 + 0.0055
        c.ball("glass", 0.0055, 0.0, gy, material=glass, look="glass", words="a small light bulb", kind=_kind(c, P))
        _weld(c, root, 0.0, gy)
        _terminal(c, "glow", root, 0.0, gy)      # (where its light comes from: a solar panel's lamp)
        _part(c, "bulb", v_rated=v, i_rated=i)
    register(ItemType("bulb", "Bulb", CAT, build_bulb, **common,
                      props=[Prop("rating", "Rating", "2.5V 0.3A", kind="choice", choices=list(BULB_RATINGS), help="The voltage it is made for and the current it then takes"), _mount_prop()],
                      readouts=[Readout("light", "Brightness", "x full", 2, "Its light against its light at its rated voltage"), Readout("current", "Current", "A", 3),
                                Readout("voltage", "Voltage across it", "V", 2), Readout("temp_c", "Filament", "°C", 0), Readout("broken", "Burnt out", "", 0)],
                      tags=["lamp", "light bulb", "torch bulb", "MES", "filament", "glow", "light", "incandescent", "circuit", "brightness"],
                      description="A small torch bulb (2.5 V 0.3 A) in a holder with two screw terminals. It glows when current flows through it: brighter with more voltage, dull orange on too little, and it burns out on far too much.",
                      source="A tungsten filament: its resistance rises about 13 times from cold to its 2500 K glow, so it is not a fixed resistor; light ∝ V^3.4 (IES Lighting Handbook); it heats and cools in a few hundredths of a second.",
                      anchor="the middle of its base board", facts="2.5 V 0.3 A · 8.3 Ω hot, 0.6 Ω cold"))

    # --- LED
    def build_led(c, P):
        vf, rs, glow = LED_COLORS[P["color"]]
        board = _on_board(c, P)
        if board:
            holder = c.slab("holder", 0.014, 0.008, 0.014, 0.0, 0.0, material=c.mat(base="circuit plastic", overrides={}), look="circuit plastic", words="an LED holder", kind="static")
            hy = 0.0
            root = holder
            for name, sx in (("+", 1), ("-", -1)):
                _terminal(c, name, holder, sx * 0.007, 0.0)
        else:
            root = _base(c, P, 0.05, 0.04)
            hy = BASE_H / 2 + 0.004
            holder = c.slab("holder", 0.014, 0.008, 0.014, 0.0, hy, material=c.mat(base="circuit plastic", overrides={}), look="circuit plastic", words="an LED holder")
            _weld(c, root, 0.0, hy)
        # a 5 mm LED: an epoxy body 5 mm across and 8.6 mm tall with a domed top
        ly = hy + 0.004 + 0.003
        c.slab("body", 0.005, 0.006, 0.005, 0.0, ly, material=c.mat(base="hollow plastic", overrides={}), look="plastic", words="a light-emitting diode",
               kind=_kind(c, P), color=glow)
        _weld(c, root, 0.0, ly)
        c.ball("dome", 0.0025, 0.0, ly + 0.003, material=c.mat(base="hollow plastic", overrides={}), look="plastic", words="an LED's domed top", kind=_kind(c, P), color=glow)
        _weld(c, root, 0.0, ly + 0.003)
        _terminal(c, "glow", root, 0.0, ly + 0.003)
        _part(c, "led", vf=vf, i_rated=LED_I_RATED, rs=rs, i_max=LED_I_MAX)
    register(ItemType("led", "LED", CAT, build_led, **common,
                      props=[Prop("color", "Colour", "red", kind="choice", choices=list(LED_COLORS)), _mount_prop()],
                      readouts=[Readout("light", "Brightness", "x full", 2, "Its light against its light at 20 mA"), Readout("current", "Current", "A", 4),
                                Readout("voltage", "Voltage across it", "V", 2), Readout("broken", "Burnt out", "", 0)],
                      tags=["light emitting diode", "diode", "indicator", "lamp", "glow", "light", "polarity", "one way", "circuit", "resistor"],
                      description="A 5 mm LED. Current goes through it only one way, from its + (anode, long leg) to its − (cathode); it needs a resistor in series, or over 30 mA burns it out.",
                      source="Typical 5 mm LED data sheets (Kingbright WP7113): 2.0 V (red) to 3.2 V (blue, white) at 20 mA, 30 mA the most continuous current; light ∝ current.",
                      anchor="the middle of its base board", facts="red · 2.0 V at 20 mA · 30 mA most"))

    # --- switch
    def build_switch(c, P):
        board = _on_board(c, P)
        style = P["style"]
        plastic = c.mat(base="circuit plastic", overrides={})
        if board:
            body = c.slab("body", 0.05, 0.012, 0.03, 0.0, 0.0, material=plastic, look="circuit plastic", words="a switch", kind="static")
            for name, sx in (("+", 1), ("-", -1)):
                _terminal(c, name, body, sx * 0.025, 0.0)
            top, parent, py0 = 0.006, body, 0.0
        else:
            parent = _base(c, P, 0.07, 0.04)
            top, py0 = BASE_H / 2, 0.0
        if style == "push":
            # a doorbell push: its button stands 6 mm above its body; what rests on it presses it
            c.slab("housing", 0.024, 0.01, 0.024, 0.0, top + 0.005, material=plastic, look="circuit plastic", words="a push switch", kind=_kind(c, P))
            _weld(c, parent, 0.0, top + 0.005, 0.0, py0)
            button = c.slab("button", 0.018, 0.006, 0.018, 0.0, top + 0.013, material=c.mat(base="solid rubber", overrides={}), look="rubber",
                            words="a push button", kind=_kind(c, P), color="#d02020")
            _weld(c, parent, 0.0, top + 0.013, 0.0, py0)
            flips = [t for t in (P["press_from"], P["press_to"]) if t > 0]
            _part(c, "switch", closed=False, r=SWITCH_OHM, flips=flips if P["press_from"] > 0 else [], press={"solid": button, "force": P["force"]})
            return
        if style == "knife":
            # a knife switch: a hinge block, a contact clip, the brass blade between them (drawn up when open, down when closed)
            c.slab("hinge", 0.01, 0.012, 0.016, -0.02, top + 0.006, material=c.mat(base="brass", overrides={}), look="brass", words="a knife switch's hinge", kind=_kind(c, P))
            _weld(c, parent, -0.02, top + 0.006, 0.0, py0)
            c.slab("clip", 0.008, 0.012, 0.016, 0.022, top + 0.006, material=c.mat(base="brass", overrides={}), look="brass", words="a knife switch's clip", kind=_kind(c, P))
            _weld(c, parent, 0.022, top + 0.006, 0.0, py0)
        else:
            c.slab("toggle", 0.024, 0.012, 0.02, 0.0, top + 0.006, material=plastic, look="circuit plastic", words="a toggle switch", kind=_kind(c, P))
            _weld(c, parent, 0.0, top + 0.006, 0.0, py0)
        flips = [t for t in (P["flip_at"], P["flip_back_at"]) if t > 0]
        _part(c, "switch", closed=bool(P["closed"]), r=SWITCH_OHM, flips=flips)
    register(ItemType("switch", "Switch", CAT, build_switch, **common,
                      props=[Prop("style", "Kind", "knife", kind="choice", choices=["knife", "toggle", "push"], help="push: closed only while it is pressed (by its time window, or by something resting on it)"),
                             Prop("closed", "Closed at the start", False, kind="bool"),
                             Prop("flip_at", "Switched at", 1.0, 0.0, 20.0, 0.05, "s", "When it is switched over (closed if it was open); 0: never"),
                             Prop("flip_back_at", "Switched back at", 0.0, 0.0, 20.0, 0.05, "s", "When it is switched back; 0: never"),
                             Prop("press_from", "Pressed from", 0.0, 0.0, 20.0, 0.05, "s", "Push switch: pressed by a finger from this moment; 0: only by what rests on it"),
                             Prop("press_to", "Pressed until", 0.0, 0.0, 20.0, 0.05, "s", "Push switch: let go at this moment"),
                             Prop("force", "Press force", 1.0, 0.05, 20.0, 0.05, "N", "Push switch: what rests on its button must weigh at least this (1 N: about 100 g)"),
                             _mount_prop()],
                      readouts=[Readout("closed", "Closed", "", 0), Readout("current", "Current", "A", 3)],
                      tags=["knife switch", "toggle", "push button", "doorbell", "on off", "open", "closed", "break", "control", "circuit"],
                      description="A switch: closed, it lets current through; open, it breaks the loop. A knife switch is switched over at its set time (1 s by default); a push switch is closed only while pressed.",
                      source="A closed switch's contacts are about 0.01 Ω (provisional); an open one passes no current at all.",
                      anchor="the middle of its base board", facts="knife switch · closes at 1 s"))

    # --- buzzer
    def build_buzzer(c, P):
        board = _on_board(c, P)
        if board:
            body = c.slab("body", 0.012, 0.0095, 0.012, 0.0, 0.0, material=c.mat(base="circuit plastic", overrides={}), look="circuit plastic", words="a buzzer", kind="static")
            for name, sx in (("+", 1), ("-", -1)):
                _terminal(c, name, body, sx * 0.006, 0.0)
        else:
            base = _base(c, P, 0.05, 0.04)
            c.slab("body", 0.012, 0.0095, 0.012, 0.0, BASE_H / 2 + 0.00475, material=c.mat(base="circuit plastic", overrides={}), look="circuit plastic", words="a buzzer")
            _weld(c, base, 0.0, BASE_H / 2 + 0.00475)
        v = P["volts"]
        # an active buzzer takes about 25 mA at its rated voltage, through its own driver (a forward drop of about 0.7 V: it is silent and takes
        # nothing the wrong way round), and sounds from about two thirds of its rated voltage (provisional, from 3 V buzzers sounding from about 2 V)
        _part(c, "buzzer", r=round((v - 0.7) / 0.025, 4), v_min=round(v * 2 / 3, 4), v_rated=v, pitch=P["pitch"])
    register(ItemType("buzzer", "Buzzer", CAT, build_buzzer, **common,
                      props=[Prop("volts", "Rated voltage", 3.0, 1.5, 24.0, 0.5, "V"), Prop("pitch", "Tone", 2700.0, 400.0, 5000.0, 50.0, "Hz"), _mount_prop()],
                      readouts=[Readout("sound", "Loudness", "x full", 2), Readout("pitch", "Tone", "Hz", 0), Readout("current", "Current", "A", 3)],
                      tags=["beeper", "piezo", "alarm", "sound", "noise", "doorbell", "tone", "electricity to sound", "circuit", "buzz"],
                      description="An active buzzer: it beeps (2.7 kHz) while current goes through it from its + to its −. It sounds from about 2 V on a 3 V buzzer; the wrong way round it is silent.",
                      source="Typical active buzzers: 3-12 V, 15-30 mA, 2.3-4 kHz, about 85 dB at 10 cm (makers' data sheets; provisional).",
                      anchor="the middle of its base board", facts="3 V · 25 mA · 2.7 kHz"))

    # --- motor
    def build_motor(c, P):
        m = MOTORS[P["kind"]]
        drives = P["drives"]
        if drives == "wheels":
            car = c.link("car")
            if car is not None:
                # a battery car: the motor rides on the car its link names, driving its rear wheel forward (to the car's +x: the wheel turns
                # clockwise for current in at +); its gearbox and terminals are put on the car's chassis once every item is built (_mount_on_cars)
                _store(c.sb).setdefault("cars", []).append({"motor": c.item["id"], "car": car, "kind": P["kind"]})
                _part(c, "motor", k=m["k"], r=m["r"], efficiency=m["eff"], friction=m["fric"], sense=-1)
                return
            drives = "none"         # (on no car: a motor on its stand, turning nothing)
        size = P["size"]
        board = _on_board(c, P)
        steel = c.mat(base="steel", overrides={})
        L, D = m["can"]
        # the shaft's height above the base: the attachment must clear the base board and its terminals
        reach = size / 2 if drives in ("paddle", "disc", "propeller") else D / 2
        # (a propeller's disc turns across the motor's axis, clear of the base board's top by 4 mm, its plane left of the + terminal; a turning
        # paddle or disc clears the terminals by 12 mm)
        prop = drives in ("propeller", "none")
        cx = -0.012 if prop else 0.0
        sy = 0.0 if board else round(BASE_H / 2 + max(D / 2, reach) + 0.004, 5) if prop else round(BASE_H / 2 + POST_H + max(D / 2, reach) + 0.012, 5)
        if not board:
            # a motor clamped to the table on its base board (a turning attachment's stand is drawn behind it, out of its way: nothing solid
            # may stand in the plane it sweeps); a propeller motor lies on a steel bracket
            base = _base(c, P, 0.08, 0.05, kind="static")
            if drives in ("propeller", "none"):
                c.slab("bracket", 0.004, sy - D / 2 - BASE_H / 2, 0.03, cx - 0.004, BASE_H / 2 + (sy - D / 2 - BASE_H / 2) / 2, kind="static", material=steel, look="steel",
                       words="a motor bracket")
                _weld(c, base, cx - 0.004, BASE_H / 2 + (sy - D / 2 - BASE_H / 2) / 2)
        if drives in ("propeller", "none"):
            # the can lies along x; the propeller on its right end turns in the y-z plane (not a body: its air pushes)
            can = c.slab("can", L, D, D, cx, sy, kind="static", material=steel, look="steel", words="a small electric motor")
            if drives == "none":
                _part(c, "motor", k=m["k"], r=m["r"], efficiency=m["eff"], friction=m["fric"],
                      fan={"inertia": 5e-08, "drag": 0.0, "solid": can, "at": {"x": round(L / 2, 5), "y": 0.0}, "direction": 0.0, "diameter": 0.002, "pitch": 0.0})
                return
            pm = round(0.004 * (size / 0.1) * (size / 0.1), 6)          # kg: a thin plastic propeller, about 4 g at 10 cm (provisional)
            inertia = round(pm * size * size / 40 + 5e-8, 10)            # kg·m²: a two-blade propeller (provisional) and the motor's rotor
            drag = round(0.01 * 1.2 * size * size * size * size * size / (4 * math.pi * math.pi), 12)   # τ = C_Q·ρ·n²·D⁵, C_Q 0.01 (provisional)
            _part(c, "motor", k=m["k"], r=m["r"], efficiency=m["eff"], friction=m["fric"],
                  fan={"inertia": inertia, "drag": drag, "solid": can, "at": {"x": round(L / 2 + 0.006, 5), "y": 0.0}, "direction": 0.0,
                       "diameter": round(0.7 * size, 5), "pitch": round(0.45 * size, 5)})
            return
        # the shaft points at the camera: the can stands behind the attachment, the attachment turns on the shaft (a body)
        hub = c.ball("can", 0.006, 0.0, sy, kind="static", material=steel, look="steel", words="a small electric motor's shaft",
                     depth3d=round(L + 0.03, 5), shape="cylinder")
        # (a fixed motor, the Fixed tick, keeps its attachment fixed too: then it cannot turn)
        wood = c.mat(base="varnished hardwood", overrides={})
        if drives == "paddle":
            rotor = c.slab("rotor", size, 0.015, 0.012, 0.0, sy, material=wood, look="wood", words="a paddle on a motor's shaft", pivot={"x": 0.0, "y": 0.0}, parent=hub)
        elif drives == "disc":
            # (a 4 mm plastic disc: a ball body weighs as a sphere, so its density is scaled to a disc's mass, as the catalog's wheel does)
            rotor = c.ball("rotor", size / 2, 0.0, sy, material=c.mat(base="hollow plastic", density=round(950 * 3 * 0.004 / (4 * (size / 2)), 4), overrides={}), look="plastic",
                           words="a disc on a motor's shaft",
                           pivot={"x": 0.0, "y": 0.0}, parent=hub, shape="cylinder", length=0.004, depth3d=0.004, inertia=0.5)
        else:
            rotor = None
        if rotor is not None:
            s = c.sb.solids[-1]
            s["at"] = {"x": 0.0, "y": 0.0}
            s.pop("angle", None)
            # the shaft's bearing: a pin from the can to the attachment with the motor's own friction (its pivot names the hinge)
            c.joint("pin", "shaft", a="can", b="rotor", anchorA=(0, 0), anchorB=(0, 0), friction=m["fric"], render={"hinge": "none"})
        _part(c, "motor", k=m["k"], r=m["r"], efficiency=m["eff"], friction=m["fric"], **({"rotor": rotor, "stator": hub} if rotor else {}))
    register(ItemType("motor", "Electric motor", CAT, build_motor, **common,
                      props=[Prop("kind", "Motor", "hobby", kind="choice", choices=list(MOTORS), help="hobby: a fast toy motor (FA-130: about 9000 rpm on 3 V); solar: turns on very little current; geared: a slow, strong 48:1 gear motor (about 100 rpm on 3 V)"),
                             Prop("drives", "On its shaft", "propeller", kind="choice", choices=["propeller", "paddle", "disc", "none", "wheels"], help="propeller: a fan that blows to the right; paddle and disc turn facing you; wheels: it rides on the car its `car` link names and drives its rear wheels forward (a battery car: use the geared motor)"),
                             Prop("size", "Attachment size", 0.1, 0.03, 0.4, 0.01, "m", "The propeller's or disc's diameter, the paddle's length"),
                             _mount_prop()],
                      links=[Link("car", "Drives the wheels of", types=list(CARS), help="With On its shaft: wheels, the toy car, cart or truck it rides on and drives")],
                      readouts=[Readout("rpm", "Speed", "rpm", 0), Readout("current", "Current", "A", 3), Readout("voltage", "Voltage across it", "V", 2), Readout("air", "Air speed", "m/s", 2)],
                      tags=["dc motor", "electric motor", "fan", "propeller", "spin", "rotor", "toy motor", "electricity to motion", "circuit", "turn"],
                      description="A small DC motor on a stand. Current through it from its + to its − turns its shaft counter-clockwise (swap its wires and it turns the other way); with a propeller it blows air to the right.",
                      source="A DC motor: torque = k·I and back-EMF = k·ω, so it speeds up until its back-EMF nearly cancels the battery's voltage. Hobby motor: Mabuchi FA-130 (9100 rpm and 0.2 A at 3 V with no load, 2.2 A stalled).",
                      anchor="the middle of its base board", facts="FA-130 · 9100 rpm on 3 V · 10 cm propeller"))

    # --- resistor
    def build_resistor(c, P):
        board = _on_board(c, P)
        if board:
            body = c.slab("body", 0.016, 0.006, 0.006, 0.0, 0.0, material=c.mat(base="circuit plastic", overrides={}), look="circuit plastic", words="a resistor", kind="static")
            for name, sx in (("+", 1), ("-", -1)):
                _terminal(c, name, body, sx * 0.012, 0.0)
        else:
            base = _base(c, P, 0.06, 0.03)
            c.slab("body", 0.016, 0.006, 0.006, 0.0, BASE_H / 2 + 0.006, material=c.mat(base="circuit plastic", overrides={}), look="circuit plastic", words="a resistor")
            _weld(c, base, 0.0, BASE_H / 2 + 0.006)
        _part(c, "resistor", r=P["ohms"])
    register(ItemType("resistor", "Resistor", CAT, build_resistor, **common,
                      props=[Prop("ohms", "Resistance", 100.0, 1.0, 100000.0, 1.0, "Ω", "Its resistance (the colour bands show it)", slider_max=1000.0), _mount_prop()],
                      readouts=[Readout("current", "Current", "A", 4), Readout("voltage", "Voltage across it", "V", 2)],
                      tags=["ohm", "resistance", "carbon film", "limit", "current limiting", "colour bands", "ohms law", "circuit", "component", "load"],
                      description="A fixed resistor: it lets through current in proportion to the voltage across it (Ohm's law, I = V / R). Put one in series with an LED to keep its current safe.",
                      source="Ohm's law; a ¼ W carbon-film resistor (tolerance ±5 %).",
                      anchor="the middle of its base board", facts="100 Ω"))

    # --- dimmer (a rheostat with a knob)
    def build_dimmer(c, P):
        board = _on_board(c, P)
        if board:
            body = c.slab("body", 0.03, 0.02, 0.02, 0.0, 0.0, material=c.mat(base="circuit plastic", overrides={}), look="circuit plastic", words="a dimmer", kind="static")
            for name, sx in (("+", 1), ("-", -1)):
                _terminal(c, name, body, sx * 0.015, 0.0)
        else:
            base = _base(c, P, 0.07, 0.045)
            c.slab("body", 0.03, 0.016, 0.03, 0.0, BASE_H / 2 + 0.008, material=c.mat(base="circuit plastic", overrides={}), look="circuit plastic", words="a dimmer")
            _weld(c, base, 0.0, BASE_H / 2 + 0.008)
        top = P["max_ohms"]
        r0 = round(0.5 + top * P["knob"], 5)            # the wiper's own 0.5 Ω at the low end (provisional)
        r1 = round(0.5 + top * P["knob_to"], 5)
        fields = {"r": r0}
        if P["turn_seconds"] > 0 and abs(r1 - r0) > 1e-9:
            fields["turn"] = {"r": r1, "from": P["turn_at"], "to": round(P["turn_at"] + P["turn_seconds"], 5)}
        _part(c, "resistor", **fields)
    register(ItemType("dimmer", "Dimmer", CAT, build_dimmer, **common,
                      props=[Prop("max_ohms", "Most resistance", 50.0, 1.0, 10000.0, 1.0, "Ω", slider_max=500.0),
                             Prop("knob", "Knob at the start", 0.0, 0.0, 1.0, 0.01, "", "0: least resistance (brightest), 1: most"),
                             Prop("knob_to", "Knob turned to", 0.0, 0.0, 1.0, 0.01, "", "Where the knob is turned to"),
                             Prop("turn_at", "Turned from", 1.0, 0.0, 20.0, 0.1, "s"), Prop("turn_seconds", "Turned over", 2.0, 0.0, 20.0, 0.1, "s", "0: not turned"), _mount_prop()],
                      readouts=[Readout("ohms", "Resistance now", "Ω", 1), Readout("current", "Current", "A", 3), Readout("voltage", "Voltage across it", "V", 2)],
                      tags=["rheostat", "potentiometer", "variable resistor", "knob", "dim", "brightness", "control", "slider", "circuit", "resistance"],
                      description="A variable resistor (rheostat) with a knob: turned up, more resistance and less current (a bulb dims); it can be turned during the run.",
                      source="A wire-wound rheostat, 0.5-50 Ω (provisional); Ohm's law.",
                      anchor="the middle of its base board", facts="0-50 Ω knob"))

    # --- tester
    def build_tester(c, P):
        gap = P["gap"]
        board = _on_board(c, P)
        cu = c.mat(base="copper", overrides={})
        plate = 0.035
        if board:
            # (on the board the probes are two copper plates side by side, fixed, a test object laid across them)
            base = c.slab("base", 2 * plate + gap + 0.01, BASE_H, 0.05, 0.0, 0.0, material=c.mat(base="varnished hardwood", overrides={}), look="wood",
                          words="a tester's board", kind="static")
        else:
            wood = c.mat(base="varnished hardwood", overrides={})
            base = c.slab("base", 2 * plate + gap + 0.01, BASE_H, 0.05, 0.0, 0.0, material=wood, look="wood", words="a tester's board")
        y = BASE_H / 2 + 0.0015
        ids = []
        for name, sx in (("+", 1), ("-", -1)):
            x = sx * (gap / 2 + plate / 2)
            sid = c.slab("probe_plus" if sx > 0 else "probe_minus", plate, 0.003, 0.03, x, y, material=cu, look="copper", words="a copper probe plate", kind=_kind(c, P))
            _weld(c, base, x, y)
            _terminal(c, name, base, sx * (gap / 2 + plate - 0.004), y + 0.0015)
            ids.append(sid)
        _part(c, "probe", contacts=[ids[0], ids[1]], gap=gap)
    register(ItemType("tester", "Conductor tester", CAT, build_tester, **common,
                      props=[Prop("gap", "Gap between the probes", 0.015, 0.005, 0.06, 0.001, "m", "A test object laid across the gap touches both probes"), _mount_prop()],
                      readouts=[Readout("conducts", "Conducts", "", 0), Readout("current", "Current through the test object", "A", 4)],
                      tags=["conductor", "insulator", "continuity", "test", "probe", "metal", "material", "conductivity", "circuit tester", "clips"],
                      description="Two copper probe plates with a gap between them. Wire it in a loop with a battery and a bulb, and lay a test object across the gap: a metal one (a coin, a steel ball) closes the circuit and the bulb lights; plastic, wood, rubber or glass do not.",
                      source="The object closes the gap with R = ρ·L/A of its material (CRC resistivities: copper 1.7e-8, steel 1.4e-7, graphite 1e-5, glass 1e12, rubber 1e13, dry wood 1e14 Ω·m).",
                      anchor="the middle of its board", facts="probes 1.5 cm apart"))

    # --- meter
    def build_meter(c, P):
        if P["mode"] == "galvanometer":
            # a centre-zero galvanometer: a wooden box with a big dial facing you, its two terminals on the front at the bottom
            w, h, d = 0.11, 0.09, 0.05
            body = c.slab("body", w, h, d, 0.0, 0.0, material=c.mat(base="varnished hardwood", density=round(0.35 / (w * h * d), 1), overrides={}),
                          look="wood", words="a centre-zero galvanometer", kind=_kind(c, P))
            for name, sx in (("+", 1), ("-", -1)):
                _terminal(c, name, body, sx * 0.035, -h / 2 + 0.012)
            _part(c, "meter", mode="galvanometer", r=GALVO_OHM, fs=GALVO_FS)
            return
        body = c.slab("body", 0.075, 0.15, 0.035, 0.0, 0.0, material=c.mat(base="circuit plastic", density=round(0.3 / (0.075 * 0.15 * 0.035), 1), overrides={}),
                      look="circuit plastic", words="a multimeter", kind=_kind(c, P), color="#f2c230")
        for name, sx in (("+", 1), ("-", -1)):
            _terminal(c, name, body, sx * 0.022, -0.06)
        if P["mode"] == "volts":
            _part(c, "meter", mode="volts", r=1e7)        # a digital meter's 10 MΩ input (typical)
        else:
            _part(c, "meter", mode="amps", r=0.1)         # its 10 A range's shunt and leads, about 0.1 Ω (typical)
    register(ItemType("meter", "Multimeter", CAT, build_meter, **common,
                      props=[Prop("mode", "Measures", "volts", kind="choice", choices=["volts", "amps", "galvanometer"],
                                  help="volts: clip it across a part (it takes almost nothing); amps: put it in the loop, in series; galvanometer: a centre-zero needle meter for tiny currents (0.5 mA full scale either way), in series: it flicks when a magnet moves in a coil"),
                             _mount_prop()],
                      readouts=[Readout("reading", "Reading", "", 3, "Volts across it, or amps through it"), Readout("current", "Current through it", "A", 4),
                                Readout("needle", "Needle", "x full scale", 2, "A galvanometer's needle: −1 full left, 0 the middle, +1 full right (it swings and settles; it stops at ±1.2)")],
                      tags=["voltmeter", "ammeter", "multimeter", "measure", "volts", "amps", "current", "voltage", "reading", "instrument", "galvanometer"],
                      description="A digital multimeter standing up, its display facing you. As a voltmeter, clip its + and − across a part; as an ammeter, wire it into the loop. Its reading shows on its display. As a galvanometer it is a centre-zero needle meter for tiny currents (a coil and a magnet).",
                      source="A digital multimeter: 10 MΩ across its volts input; about 0.1 Ω on its amps range (typical). A school galvanometer: centre zero, about 0.5 mA full scale, about 50 Ω (provisional).",
                      anchor="its middle", facts="volts · 10 MΩ input"))

    # --- solar panel
    def build_solar(c, P):
        board = _on_board(c, P)
        w, d = 0.09, 0.06
        tilt = P["tilt"]
        plastic = c.mat(base="circuit plastic", overrides={})
        # (in a scene with lamps, flashlights or the optics module's sun, its face takes the light the optics module traces: a light-taking
        # "panel" body, its cells' electric efficiency per band; the engine turns that light into current, band by band: SI_RESPONSE)
        lit = {"optics": {"role": "panel", "faces": [1], "eff": list(PV_EFF), "color": "#1d3b8f"}} if _lit_scene(c) else {}
        if board:
            panel = c.slab("panel", w, 0.006, d, 0.0, 0.0, langle=tilt, material=plastic, look="circuit plastic", words="a solar panel", kind="static", color="#1d3b8f", **lit)
            for name, sx in (("+", 1), ("-", -1)):
                _terminal(c, name, panel, sx * w / 2, 0.0)
        else:
            base = _base(c, P, 0.1, 0.07)
            hy = BASE_H / 2 + 0.03
            c.slab("post", 0.008, 0.03, 0.02, 0.0, BASE_H / 2 + 0.015, material=plastic, look="circuit plastic", words="a solar panel's stand")
            _weld(c, base, 0.0, BASE_H / 2 + 0.015)
            panel = c.slab("panel", w, 0.006, d, 0.0, hy, langle=tilt, material=plastic, look="circuit plastic", words="a solar panel", color="#1d3b8f", **lit)
            s = c.sb.solids[-1]
            s["parent"] = base
            s["at"] = {"x": 0.0, "y": round(hy, 5)}
            if abs(tilt) > 1e-12:
                s["angle"] = round(tilt * math.pi / 180, 6)
            else:
                s.pop("angle", None)
        # a mini panel of 4 cells in series: 0.2 A in full sun (1000 W/m²) into a short, about 2 V with nothing on it (knee 0.45 V a cell)
        _part(c, "solar", isc=0.2, v_knee=1.8, g_d=0.9, rsh=100.0, rs=0.5,
              face={"solid": panel, "at": {"x": 0.0, "y": 0.003}, "normal": {"x": 0.0, "y": 1.0}, "width": w},
              sun={"irradiance": P["sun"], "angle": round(P["sun_angle"] * math.pi / 180, 6)})
    register(ItemType("solar-panel", "Solar panel", CAT, build_solar, **common,
                      props=[Prop("tilt", "Tilt", 0.0, -80.0, 80.0, 1.0, "°", "Its face's tilt: 0 faces straight up"),
                             Prop("sun", "Sunshine on it", 1000.0, 0.0, 1100.0, 10.0, "W/m²", "1000: full sun outdoors; 0: indoors, lit only by lamps and bulbs"),
                             Prop("sun_angle", "Sun's angle", 0.0, -80.0, 80.0, 1.0, "°", "From straight overhead; positive: the sun is to the right"),
                             _mount_prop()],
                      readouts=[Readout("irradiance", "Light on it", "W/m²", 0), Readout("current", "Current", "A", 3), Readout("voltage", "Voltage", "V", 2),
                                Readout("power", "Power", "W", 3)],
                      tags=["solar cell", "photovoltaic", "PV", "sunlight", "light to electricity", "renewable", "energy", "panel", "sun", "lamp"],
                      description="A mini solar panel (4 cells: about 2 V, 0.2 A in full sun). The light on its face makes the current: full sun, a lamp close by, or less when something shades it.",
                      source="A silicon cell's current is proportional to the light on it; about 0.45-0.5 V a cell at its knee; 15 % efficient (typical mini-panel data).",
                      anchor="the middle of its base board", facts="2 V · 0.2 A in full sun"))

    # --- hand generator
    def build_generator(c, P):
        board = _on_board(c, P)
        plastic = c.mat(base="circuit plastic", overrides={})
        if board:
            body = c.slab("body", 0.06, 0.05, 0.04, 0.0, 0.0, material=plastic, look="circuit plastic", words="a hand generator", kind="static", color="#2a7bd0")
            for name, sx in (("+", 1), ("-", -1)):
                _terminal(c, name, body, sx * 0.03, -0.02)
        else:
            base = _base(c, P, 0.08, 0.05)
            c.slab("body", 0.06, 0.05, 0.04, 0.0, BASE_H / 2 + 0.025, material=plastic, look="circuit plastic", words="a hand generator", color="#2a7bd0")
            _weld(c, base, 0.0, BASE_H / 2 + 0.025)
        to = P["stop_at"]
        # a classroom hand generator: about 6 V on open circuit at 2 turns a second (k = 6 / 4π V·s/rad at the crank), 6 Ω inside (provisional)
        _part(c, "generator", k=round(6 / (4 * math.pi), 6), r=6.0, speed=round(P["rpm"] * 2 * math.pi / 60, 6), **{"from": P["start_at"]},
              **({"to": to} if to > 0 else {}))
    register(ItemType("hand-generator", "Hand generator", CAT, build_generator, **common,
                      props=[Prop("rpm", "Cranking speed", 80.0, 0.0, 300.0, 5.0, "turns/min", "How fast the handle is turned (positive: counter-clockwise)"),
                             Prop("start_at", "Turned from", 0.5, 0.0, 20.0, 0.1, "s"), Prop("stop_at", "Stopped at", 0.0, 0.0, 20.0, 0.1, "s", "0: kept turning"), _mount_prop()],
                      readouts=[Readout("rpm", "Cranking speed", "rpm", 0), Readout("voltage", "Voltage", "V", 2), Readout("current", "Current", "A", 3)],
                      tags=["dynamo", "crank", "generator", "hand crank", "motion to electricity", "energy", "magnet", "coil", "power", "turn"],
                      description="A hand-cranked generator: turning its handle makes a voltage (about 6 V at 2 turns a second) that drives current round a circuit; faster turning, more voltage.",
                      source="A generator's EMF is proportional to its speed (Faraday's law); a classroom hand generator gives about 6 V at 2 turns a second (provisional).",
                      anchor="the middle of its base board", facts="4 V at 80 turns/min"))

    # --- electromagnet: an iron nail wound with enamelled wire, its two leads wired into a circuit (a switch, a meter, more cells)
    def build_electromagnet(c, P):
        L, dia = P["length"], P["diameter"]
        n = int(P["turns"])
        r = dia / 2
        p = min(0.004, L / 6)
        # (the nail as the magnetism module's own electromagnet makes it: held point down in a clamp, turned with the item's angle; its
        # winding over all but its last 5 mm each end; the item's (x, y) is the middle of the nail)
        vol_round = math.pi * r * r * (L - p) + math.pi * r * r * p / 3
        vol_poly = (2 * r * (L - p) + r * p) * dia
        steel = "low-carbon steel" if "low-carbon steel" in MATERIALS else "steel"
        mat = c.mat(base=steel, overrides={}, density=round(7850.0 * vol_round / vol_poly, 3))
        pts = [(-L / 2, -r), (L / 2 - p, -r), (L / 2, 0.0), (L / 2 - p, r), (-L / 2, r)]
        held = {"stand": "post"} if c.kind == "static" else {}
        sid = c.poly("core", pts, dia, langle=-90.0, material=mat, look="steel", words="an iron nail wound with copper wire", **held)
        # its two leads leave the winding by the nail's head: + on the right, − on the left (the core's frame: x along the nail, head at −x)
        _terminal(c, "+", sid, -L / 2 + 0.004, r + 0.0005)
        _terminal(c, "-", sid, -L / 2 + 0.004, -r - 0.0005)
        # the winding's resistance: n turns of 24 AWG round the shank [ASTM]
        _part(c, "coil", r=round(n * math.pi * (dia + AWG24_D) * AWG24_OHM, 6), turns=n)
        if _module_on("compass", "magnetism"):
            # the nail is the magnetism module's soft iron, its winding's current the circuit's current through it (+ to −: the point a north pole)
            c.process("magnetism", "core", role="soft", solid=sid, x=0.0, y=0.0, w=round(L, 6), h=round(dia, 6), d=round(dia, 6),
                      volume=float(f"{vol_round:.6g}"), ms=NAIL_MS, chi=NAIL_CHI,
                      coil={"turns": n, "length": round(L - 0.01, 6), "reading": {"item": c.item["id"], "key": "current"}})
    register(ItemType("electromagnet", "Electromagnet (wired)", CAT, build_electromagnet, dynamic=False, **common,
                      props=[Prop("turns", "Turns of wire", 50, 5, 500, 5, "", kind="int", help="More turns, a stronger magnet for the same current (until the nail's iron is full)"),
                             Prop("length", "Nail length", 0.051, 0.03, 0.15, 0.001, "m"), Prop("diameter", "Nail diameter", 0.0029, 0.0015, 0.006, 0.0001, "m")],
                      readouts=[Readout("current", "Current through its coil", "A", 3, "+ to − is positive: then its point is a north pole"),
                                Readout("voltage", "Voltage across it", "V", 3), Readout("magnetized", "Magnetized", "%", 1, "How strongly its nail is magnetized, % of the most iron takes"),
                                Readout("pull_mN", "Magnetic pull", "mN", 2)],
                      tags=["electromagnet", "coil", "nail", "wire", "turns", "magnet", "current", "switch", "solenoid", "iron core", "circuit"],
                      description="An iron nail wound with turns of enamelled copper wire, held point down in a clamp, with two leads to wire into a circuit (a battery, a switch, an ammeter). "
                                  "Current through its coil makes the nail a magnet that picks up paper clips: more current or more turns, stronger, until the iron is fully magnetized; "
                                  "no current, it lets them go. Current in at + makes its point a north pole; swap the leads to swap the poles.",
                      source="24 AWG enamelled copper 84.2 mΩ/m (ASTM B258): 50 turns on a 2.9 mm nail are about 0.045 Ω, so on AA cells the current is several amps; the coil's field n·I in a low-carbon-steel core, magnetized up to 2.0 T (Chikazumi).",
                      anchor="the middle of the nail", facts="50 turns · 0.045 Ω · iron core", edit=[{"kind": "rotate"}]))

    # --- coil: turns of enamelled wire on a cardboard tube (no core): a magnet moved in or out of it makes a voltage (induction)
    def build_coil(c, P):
        n = int(P["turns"])
        D, Lc = P["diameter"], P["length"]
        layer = n * AWG28_D * AWG28_D / Lc * 1.15          # m: the winding's thickness, n turns of 28 AWG wound 15 % loose (provisional)
        t = round(COIL_TUBE + max(0.0005, layer), 5)
        rm = D / 2 + COIL_TUBE + layer / 2                  # m: the mean turn's radius
        off = round(D / 2 + t / 2, 5)
        cu = c.mat(base="copper", overrides={})
        held = {"stand": "post"} if c.kind == "static" else {}
        other = {"stand": "none"} if c.kind == "static" else {}     # (one clamp holds the coil: its + wall's; the view draws its tube whole)
        deep = round(D + 2 * t, 5)
        # its two walls in the picture (the tube's cut through its axis), the bore between them clear for a magnet to pass through
        if P["axis"] == "vertical":
            a = c.slab("wall_plus", t, Lc, deep, off, 0.0, material=cu, look="copper", words="a coil of copper wire", **held)
            c.slab("wall_minus", t, Lc, deep, -off, 0.0, material=cu, look="copper", words="a coil of copper wire", **other)
            _weld(c, a, -off, 0.0, off, 0.0)
            _terminal(c, "+", a, t / 2, Lc / 2 - 0.004)
            _terminal(c, "-", c.sb.solids[-1]["id"], -t / 2, Lc / 2 - 0.004)
            center, axis = {"x": -off, "y": 0.0}, round(math.pi / 2, 6)
        else:
            a = c.slab("wall_plus", Lc, t, deep, 0.0, off, material=cu, look="copper", words="a coil of copper wire", **held)
            c.slab("wall_minus", Lc, t, deep, 0.0, -off, material=cu, look="copper", words="a coil of copper wire", **other)
            _weld(c, a, 0.0, -off, 0.0, off)
            _terminal(c, "+", a, Lc / 2 - 0.004, t / 2)
            _terminal(c, "-", c.sb.solids[-1]["id"], Lc / 2 - 0.004, -t / 2)
            center, axis = {"x": 0.0, "y": -off}, 0.0
        # its winding's resistance [ASTM]; its turns linked by what a magnet's field puts through them (the engine: EMF = dλ/dt, λ = n·Φ)
        _part(c, "coil", r=round(n * 2 * math.pi * rm * AWG28_OHM, 6), turns=n,
              induce={"solid": a, "at": center, "axis": axis, "radius": round(rm, 6), "length": Lc})
    register(ItemType("coil", "Coil of wire", CAT, build_coil, dynamic=False, **common,
                      props=[Prop("turns", "Turns of wire", 200, 10, 2000, 10, "", kind="int", help="More turns, more voltage when a magnet moves through it (and more resistance)"),
                             Prop("axis", "Its axis", "vertical", kind="choice", choices=["vertical", "horizontal"], help="vertical: drop a magnet through it from above; horizontal: push a magnet into it from the side"),
                             Prop("diameter", "Inside diameter", 0.04, 0.015, 0.1, 0.001, "m", "The bore a magnet goes through"),
                             Prop("length", "Length", 0.06, 0.02, 0.2, 0.005, "m")],
                      readouts=[Readout("emf_mv", "Induced voltage", "mV", 2, "What the magnet's moving field makes across its ends now (Faraday's law)"),
                                Readout("current", "Current through it", "A", 4, "+ to − is positive"), Readout("voltage", "Voltage at its ends", "V", 3),
                                Readout("flux_uwb", "Magnetic flux through it", "µWb", 2, "Through one turn, the coil's average")],
                      tags=["coil", "solenoid", "induction", "electromagnetic induction", "faraday", "generator", "magnet through a coil", "turns", "galvanometer", "wire"],
                      description="A coil of enamelled copper wire on a cardboard tube (200 turns, 4 cm bore), held in a clamp, with two leads. Move a magnet in or out of it, or drop one "
                                  "through it, and a voltage is induced while the magnet moves (none while it is still): a galvanometer wired to it flicks one way as the magnet goes in "
                                  "and the other way as it comes out. Faster, a stronger magnet or more turns: more voltage.",
                      source="Faraday's law of induction: EMF = −N·dΦ/dt (the magnet's own field through each turn, worked out exactly from its poles). 28 AWG enamelled copper 212.9 mΩ/m (ASTM B258): 200 turns about 6 Ω.",
                      anchor="the middle of its bore", facts="200 turns · 4 cm bore · 6 Ω", edit=[{"kind": "rotate"}]))

    # --- straight wire: a bare copper wire stretched straight, for Oersted's experiment (a compass by a wire carrying current swings)
    def build_straight(c, P):
        L = P["length"]
        held = {"stand": "post"} if c.kind == "static" else {}
        wood = c.mat(base="varnished hardwood", overrides={})
        if P["runs"] == "over":
            # two insulated clamps at its ends, in the picture; the wire between them `in_front` m in front of the picture's plane (as a wire
            # laid over a compass lying flat runs just above its needle): a needle behind it is turned up or down by its field
            z = P["in_front"]
            a = c.slab("clamp_plus", 0.016, 0.016, 0.03, L / 2, 0.0, material=wood, look="wood", words="an insulated clamp", **held)
            c.slab("clamp_minus", 0.016, 0.016, 0.03, -L / 2, 0.0, material=wood, look="wood", words="an insulated clamp", **held)
            _weld(c, a, -L / 2, 0.0, L / 2, 0.0)
            _terminal(c, "+", a, 0.0, 0.008)
            _terminal(c, "-", c.sb.solids[-1]["id"], 0.0, 0.008)
            field = {"solid": a, "from": {"x": 0.0, "y": 0.0, "z": z}, "to": {"x": round(-L, 5), "y": 0.0, "z": z}}
        else:
            # straight through the picture, front to back (its cut a dot at the item's (x, y)): compasses round it point round it
            a = c.ball("wire", round(AWG14_D / 2, 6), 0.0, 0.0, material=c.mat(base="copper", overrides={}), look="copper", words="a straight copper wire",
                       shape="cylinder", length=L, depth3d=L, **held)
            _terminal(c, "+", a, 0.0, 0.0)
            _terminal(c, "-", a, 0.0, 0.0)
            st = _store(c.sb)["terminals"]
            st[f"{c.item['id']}/+"]["z"] = round(L / 2, 5)
            st[f"{c.item['id']}/-"]["z"] = round(-L / 2, 5)
            field = {"solid": a, "from": {"x": 0.0, "y": 0.0, "z": round(L / 2, 5)}, "to": {"x": 0.0, "y": 0.0, "z": round(-L / 2, 5)}}
        _part(c, "conductor", r=round(AWG14_OHM * L, 6), field=field)
    register(ItemType("straight-wire", "Straight wire", CAT, build_straight, dynamic=False, **common,
                      props=[Prop("runs", "Runs", "over", kind="choice", choices=["over", "through"],
                                  help="over: left to right, just in front of what is behind it (a compass behind it is like one under a wire); through: straight through the picture, front to back"),
                             Prop("length", "Length", 0.3, 0.1, 1.0, 0.01, "m"),
                             Prop("in_front", "In front of the picture", 0.012, 0.004, 0.06, 0.001, "m", "over: how far in front of the needle it runs (nearer, a stronger field there)")],
                      readouts=[Readout("current", "Current", "A", 3, "+ to − is positive"), Readout("field_ut", "Its field 1 cm away", "µT", 1, "μ0·I/(2π·1 cm); Earth's is about 20 µT")],
                      tags=["oersted", "straight wire", "current-carrying wire", "magnetic field of a wire", "compass", "electromagnetism", "right-hand rule", "conductor", "copper", "field"],
                      description="A bare copper wire stretched straight between two insulated clamps, with a terminal at each end. Current through it makes a magnetic field round it "
                                  "(Oersted): a compass needle behind it swings across the wire when the current flows, the other way when the current is reversed, back when it stops. "
                                  "Its field 1 cm away is 20 µT per amp (Earth's is about 20 µT), so it takes amps: a battery straight across it (briefly) or through a few ohms.",
                      source="A long straight wire's field B = μ0·I/(2π·r) (Biot-Savart, here for its true length): 2 A gives 40 µT at 1 cm. 14 AWG bare copper 8.28 mΩ/m (ASTM B258).",
                      anchor="the middle of the wire", facts="30 cm · 14 AWG copper · 20 µT/A at 1 cm"))

    # --- circuit board (lesson art: the circuit clipped flat on an upright board facing the camera)
    def build_board(c, P):
        _store(c.sb)["boards"].append({"item": c.item["id"], "x": round(c.item.get("x", 0.0), 5), "y": round(c.item.get("y", 0.0), 5),
                                       "width": P["width"], "height": P["height"]})
    register(ItemType("circuit-board", "Circuit board", CAT, build_board, dynamic=False, **common,
                      props=[Prop("width", "Width", 0.6, 0.2, 2.0, 0.01, "m"), Prop("height", "Height", 0.4, 0.15, 1.5, 0.01, "m")],
                      tags=["pegboard", "breadboard", "board", "display", "panel", "mount", "circuit board", "lesson", "backdrop", "upright"],
                      description="An upright pegboard behind the circuit, facing you, so a circuit reads at a glance: put parts on it with Stands on: board (they stay where they are put) and wire them in a loop.",
                      source="Lesson art: drawn behind the parts; nothing touches it.",
                      anchor="its middle", facts="60 x 40 cm"))


# ---------------------------------------------------------------- a battery car's motor on its car (a build hook, before _gather)
def _mount_on_cars(sb, scene):
    """A motor that drives "wheels" (a battery car): its gearbox welded to its car's chassis over the rear axle (it rides with the car and touches
    nothing), its two terminals on the gearbox's top, its part driving the car's rear wheel against the chassis through the rear axle's joint (the
    engine drives that joint's own motor along the motor's torque-speed line: tooling/src/sim/modules/circuits.ts). Run once every item is built,
    so the car's solids and joints are there whatever the order of the items."""
    st = getattr(sb, "circuit", None)
    if st is None or not st.get("cars"):
        return
    by = {s["id"]: s for s in sb.solids}
    joints = {j["id"]: j for j in sb.joints}
    for rec in st["cars"]:
        mid, car = rec["motor"], rec["car"]
        chassis, wheel, axle = by.get(f"{car}/chassis"), by.get(f"{car}/rear"), joints.get(f"{car}/axle-rear")
        part = next((p for p in st["parts"] if p["id"] == f"{mid}/motor"), None)
        if chassis is None or wheel is None or axle is None or axle.get("kind") != "wheel" or part is None:
            continue
        item = sb.scene_items[mid]
        c = Ctx(sb, item, props_of(item))
        L, D = MOTORS[rec["kind"]]["can"]
        depth = 0.027
        # (its output shaft on the rear axle, its body forward of it under the deck: in the chassis's own frame)
        ax, ay = axle["anchor"]["x"], axle["anchor"]["y"]
        mass = MOTOR_MASS[rec["kind"]]
        plastic = c.mat(base="circuit plastic", density=round(mass / (L * D * depth), 3), overrides={})
        gid = c.slab("gearbox", L, D, depth, 0.0, 0.0, material=plastic, kind=chassis["kind"], look="circuit plastic", words="a battery car's motor and gearbox",
                     ghost=True, color="#f2c230" if rec["kind"] == "geared" else "#9aa3ab")
        s = sb.solids[-1]
        s["parent"] = chassis["id"]
        s["at"] = {"x": round(ax + L / 2 - 0.012, 5), "y": round(ay, 5)}
        s.pop("angle", None)
        for name, sx in (("+", 1), ("-", -1)):
            _terminal(c, name, gid, sx * (L / 2 - 0.006), D / 2)
        part.update({"rotor": wheel["id"], "stator": chassis["id"], "wheel": axle["id"]})


# ---------------------------------------------------------------- gathering the circuit (a build hook)
def _terminal_world(sb, name, terminals):
    t = terminals.get(name)
    if t is None:
        return None
    s = next((x for x in sb.solids if x["id"] == t["solid"]), None)
    if s is None:
        return None
    x, y, a = s["at"]["x"], s["at"]["y"], s.get("angle", 0.0)
    if "parent" in s:
        q = next((x2 for x2 in sb.solids if x2["id"] == s["parent"]), None)
        if q is not None:
            qa = q.get("angle", 0.0)
            x, y = q["at"]["x"] + x * cos(qa) - y * sin(qa), q["at"]["y"] + x * sin(qa) + y * cos(qa)
            a += qa
    return (x + t["at"]["x"] * cos(a) - t["at"]["y"] * sin(a), y + t["at"]["x"] * sin(a) + t["at"]["y"] * cos(a))


def _flow(sb, iid, end):
    """Which way current goes at a terminal round a loop: "out" of a source's + and a part's −, "in" at a part's + and a source's −."""
    return "out" if (end == "+") == ((sb.scene_items.get(iid) or {}).get("type") in SOURCES) else "in"


def _volts_meter(sb, iid):
    it = sb.scene_items.get(iid) or {}
    return it.get("type") == "meter" and props_of(it)["mode"] == "volts"


def _ends(sb, st):
    """Each wire's two ends' terminals ("+", "-" or None: on nothing). An end whose terminal the wire's item does not set is joined as current
    flows round a loop: to the end its other end's terminal leads on to ("out" to "in": a battery's + to a part's +, a part's − to the next
    part's + or the battery's −; a voltmeter across a part as the part's own); with neither set, end a on its item's terminal with fewer wires
    (its + when even). The chosen terminals are written back into the wire's props (the inspector shows them)."""
    terminals = st["terminals"]

    def has(iid, e):
        return iid is not None and f"{iid}/{e}" in terminals

    uses = {}
    rows = []
    for w in st["wires"]:
        row = []
        for side in ("a", "b"):
            iid = w[side]
            if not (has(iid, "+") or has(iid, "-")):
                row.append(None)
            elif w[side + "_auto"]:
                row.append("?")
            else:
                e = w[side + "_end"]
                row.append(e if has(iid, e) else None)
                if has(iid, e):
                    uses[f"{iid}/{e}"] = uses.get(f"{iid}/{e}", 0) + 1
        rows.append(row)
    for w, row in zip(st["wires"], rows):
        for k, side in enumerate(("a", "b")):
            if row[k] != "?":
                continue
            iid = w[side]
            other, oid = row[1 - k], w["b" if side == "a" else "a"]
            if other in ("+", "-"):
                same = _volts_meter(sb, iid) or _volts_meter(sb, oid)
                want = _flow(sb, oid, other) if same else ("in" if _flow(sb, oid, other) == "out" else "out")
                e = "+" if _flow(sb, iid, "+") == want else "-"
            else:
                n_plus, n_minus = uses.get(f"{iid}/+", 0), uses.get(f"{iid}/-", 0)
                e = w[side + "_end"] if n_plus == n_minus else ("+" if n_plus < n_minus else "-")
            if not has(iid, e):
                e = "-" if e == "+" else "+"
            row[k] = e
            uses[f"{iid}/{e}"] = uses.get(f"{iid}/{e}", 0) + 1
            w["P"][side + "_end"] = e
    return rows


def _gather(sb, scene):
    st = getattr(sb, "circuit", None)
    if st is None or (not st["parts"] and not st["boards"]):
        return
    parts = [dict(p) for p in st["parts"]]
    terminals = st["terminals"]
    rows = _ends(sb, st)
    for w, row in zip(st["wires"], rows):
        ends = []
        for k, side in enumerate(("a", "b")):
            iid = w[side]
            ends.append(f"{iid}/{row[k]}" if row[k] is not None else None)
        length = w["length"]
        if length is None:
            # automatic: a little longer than the gap between its ends at the start (a third more, and 5 cm), to the next centimetre
            pa = _terminal_world(sb, ends[0], terminals) if ends[0] else None
            pb = _terminal_world(sb, ends[1], terminals) if ends[1] else None
            gap = math.sqrt((pb[0] - pa[0]) * (pb[0] - pa[0]) + (pb[1] - pa[1]) * (pb[1] - pa[1])) if pa and pb else 0.25
            length = max(0.1, math.ceil(round((gap * 1.3 + 0.05) * 100, 6)) / 100)
        length = round(length, 5)
        w["P"]["length"] = length          # (the built length: what the inspector shows for the automatic prop)
        # an end on no terminal: the wire joins its own loose end (a node of its own), so its other end is open
        a = ends[0] or f"{w['item']}/loose-a"
        b = ends[1] or f"{w['item']}/loose-b"
        p = {"kind": "wire", "id": f"{w['item']}/wire", "item": w["item"], "name": w["name"], "a": a, "b": b, "r": round(WIRE_OHM_M * length, 6),
             "length": length, "color": w["color"]}
        parts.append(p)
    # what a tester's probes conduct through, by the scene's material names (an item's own material is "<base> [hash]" when it changes its
    # bounce or friction: it conducts as its base does)
    rho = {}
    for inst in sb.instances.values():
        if inst["base"] in RESISTIVITY:
            rho[inst["name"]] = RESISTIVITY[inst["base"]]
    names = []          # (pairs, not an object: an item's id may look like a number, and a JavaScript object would reorder those keys)
    for it in scene.get("items", []):
        if isinstance(it, dict) and isinstance(it.get("id"), str) and it.get("type") in TYPES:
            names.append([it["id"], it.get("name") or TYPES[it["type"]].name])
    rec = {"kind": "circuit", "id": "circuit", "parts": parts, "terminals": terminals, "resistivity": {k: rho[k] for k in sorted(rho)}, "names": names}
    if st["boards"]:
        rec["boards"] = st["boards"]
    sb.processes.append(rec)


# ---------------------------------------------------------------- goal kinds (web/sim/modules/circuits.js has the same, number for number)
LIT = 0.1           # what a goal counts as lit: a tenth of the part's full light (a bulb glows dull orange) — over the last 0.5 s of the run
END_S = 0.5


def _end_values(ctx, iid, key):
    """The reading over the run's last 0.5 s (the frames from t_end − 0.5 s), or None."""
    v = ctx.state(iid, key)
    if v is None or not ctx.times:
        return None
    t_end = ctx.times[-1]
    out = [x for t, x in zip(ctx.times, v) if t >= t_end - END_S and x is not None]
    return out or None


HOLD_S = 0.03       # a state counts once it has lasted this long (the engine's events the same: tooling/src/sim/circuits.ts EVENT_HOLD)


def _first_lasting(ctx, iid, key, test):
    """The first frame's time from which test(reading) holds for HOLD_S (every frame up to that long after it; to the run's end if it ends
    sooner), or None."""
    v = ctx.state(iid, key)
    if v is None:
        return None
    n = min(len(v), len(ctx.times))
    for k in range(n):
        t0 = ctx.times[k]
        ok = True
        j = k
        while j < n and ctx.times[j] - t0 < HOLD_S:
            if v[j] is None or not test(v[j]):
                ok = False
                break
            j += 1
        if ok:
            return t0
    return None


def _trim(v):
    t = f"{v:.2f}"
    return t.rstrip("0").rstrip(".") if "." in t else t


def goal_lights(ctx, g):
    """{kind: "lights", item, at_least?, before_s?}: a bulb or LED lights: at least at_least (default 0.1) of its full light over the run's last
    0.5 s; with before_s, it first reaches that by before_s."""
    if not ctx.known(g.get("item")):
        return None
    least = ctx.num(g.get("at_least"))
    least = LIT if least is None else least
    by = ctx.num(g.get("before_s"))
    end = _end_values(ctx, g["item"], "light")
    t = ctx.first_time(g["item"], "light", lambda x: x >= least)
    if by is not None:
        ok = t is not None and t <= by
    else:
        ok = end is not None and min(end) >= least
    when = "" if by is None else f" by {_trim(by)} s"
    return {"label": g.get("label") or f"{ctx.name(g['item'])} lights{when}", "ok": ok, "kind": "lights", "item": g["item"],
            "t": None if t is None else round(t, 3), "light": None if end is None else round(end[-1], 4)}


def goal_dark(ctx, g):
    """{kind: "stays_dark", item}: a bulb or LED never lights (its light stays under 0.1 of full all run)."""
    if not ctx.known(g.get("item")):
        return None
    v = ctx.state(g["item"], "light")
    top = max((x for x in v if x is not None), default=0.0) if v is not None else None
    return {"label": g.get("label") or f"{ctx.name(g['item'])} stays dark", "ok": top is not None and top < LIT, "kind": "stays_dark", "item": g["item"],
            "light": None if top is None else round(top, 4)}


def goal_brighter(ctx, g):
    """{kind: "glows_brighter", a, b}: bulb or LED a ends brighter than b (the mean over the last 0.5 s, by at least 5 %)."""
    if not (ctx.known(g.get("a")) and ctx.known(g.get("b"))):
        return None
    ea, eb = _end_values(ctx, g["a"], "light"), _end_values(ctx, g["b"], "light")
    ma = sum(ea) / len(ea) if ea else None
    mb = sum(eb) / len(eb) if eb else None
    ok = ma is not None and mb is not None and ma > mb * 1.05 and ma >= LIT
    return {"label": g.get("label") or f"{ctx.name(g['a'])} is brighter than {ctx.name(g['b'])}", "ok": ok, "kind": "glows_brighter", "a": g["a"], "b": g["b"],
            "light_a": None if ma is None else round(ma, 4), "light_b": None if mb is None else round(mb, 4)}


def goal_buzzes(ctx, g):
    """{kind: "buzzes", item, before_s?}: a buzzer sounds (at some moment; by before_s if given)."""
    if not ctx.known(g.get("item")):
        return None
    by = ctx.num(g.get("before_s"))
    t = _first_lasting(ctx, g["item"], "sound", lambda x: x > 0)
    when = "" if by is None else f" by {_trim(by)} s"
    return {"label": g.get("label") or f"{ctx.name(g['item'])} sounds{when}", "ok": t is not None and (by is None or t <= by), "kind": "buzzes",
            "item": g["item"], "t": None if t is None else round(t, 3)}


def goal_spins(ctx, g):
    """{kind: "spins", item, at_least_rpm?}: a motor (or hand generator) turns at least at_least_rpm (default 30) over the run's last 0.5 s, either way."""
    if not ctx.known(g.get("item")):
        return None
    least = ctx.num(g.get("at_least_rpm"))
    least = 30.0 if least is None else least
    end = _end_values(ctx, g["item"], "rpm")
    ok = end is not None and min(abs(x) for x in end) >= least
    return {"label": g.get("label") or f"{ctx.name(g['item'])} turns", "ok": ok, "kind": "spins", "item": g["item"],
            "rpm": None if end is None else round(end[-1], 1)}


def goal_current(ctx, g):
    """{kind: "current", item, at_least_a?, at_most_a?}: a part's current (A, its size) over the run's last 0.5 s stays within the bounds."""
    if not ctx.known(g.get("item")):
        return None
    lo, hi = ctx.num(g.get("at_least_a")), ctx.num(g.get("at_most_a"))
    end = _end_values(ctx, g["item"], "current")
    ok = end is not None and all((lo is None or abs(x) >= lo) and (hi is None or abs(x) <= hi) for x in end)
    if lo is not None and hi is not None:
        what = f" between {_trim(lo)} and {_trim(hi)} A"
    elif lo is not None:
        what = f" at least {_trim(lo)} A"
    elif hi is not None:
        what = f" at most {_trim(hi)} A"
    else:
        what = ""
    if ok and lo is None and hi is None:
        ok = max(abs(x) for x in end) > 1e-4         # (no bounds: any current at all)
    return {"label": g.get("label") or f"{ctx.name(g['item'])} carries a current{what}", "ok": ok, "kind": "current", "item": g["item"],
            "current": None if end is None else round(end[-1], 5)}


def goal_conducts(ctx, g):
    """{kind: "conducts", item}: current flows through a tester's probes (something laid across them conducts) at the run's end."""
    if not ctx.known(g.get("item")):
        return None
    end = _end_values(ctx, g["item"], "conducts")
    ok = end is not None and end[-1] >= 1
    return {"label": g.get("label") or f"{ctx.name(g['item'])} conducts", "ok": ok, "kind": "conducts", "item": g["item"]}


def _wrap180(d):
    """An angle in degrees wrapped to (−180, 180]."""
    x = d % 360.0
    return x - 360.0 if x > 180.0 else x


def _north_deg(doc):
    """Which way the Earth's field points in the picture (degrees counter-clockwise from +x: where a compass's needle settles with nothing else
    near), from the magnetism module's first Earth record (the one its field uses), or None without one."""
    for r in doc.get("processes") or []:
        if r.get("kind") == "magnetism" and r.get("role") == "earth":
            x, y = float(r.get("x", 0.0)), float(r.get("y", 0.0))
            if x == 0.0 and y == 0.0:
                return None
            if y == 0.0:
                return 0.0 if x > 0 else 180.0
            if x == 0.0:
                return 90.0 if y > 0 else 270.0
            return round(math.atan2(y, x) * 180 / math.pi % 360.0, 6)
    return None


def goal_deflects(ctx, g):
    """{kind: "deflects", compass, at_least_deg?, at_s?}: a compass's needle ends turned at least at_least_deg (default 15°) away from north,
    where the Earth's field alone points it (without the Earth's field: from where it pointed at the start); the least swing over the run's last
    0.5 s, or with at_s at the first frame from that moment: Oersted's wire, an electromagnet switched on, a magnet brought near."""
    cid = g.get("compass")
    if not ctx.known(cid):
        return None
    least = ctx.num(g.get("at_least_deg"))
    least = 15.0 if least is None else least
    at = ctx.num(g.get("at_s"))
    v = ctx.state(cid, "heading_deg")
    seq = [(t, x) for t, x in zip(ctx.times, v or []) if x is not None]
    swing = None
    most = None
    if seq:
        north = _north_deg(ctx.doc)
        h0 = seq[0][1] if north is None else north
        most = max(abs(_wrap180(x - h0)) for _, x in seq)
        if at is not None:
            later = [x for t, x in seq if t >= at - 1e-9]
            swing = abs(_wrap180(later[0] - h0)) if later else None
        else:
            t_end = seq[-1][0]
            swing = min(abs(_wrap180(x - h0)) for t, x in seq if t >= t_end - END_S)
    ok = swing is not None and swing >= least
    when = "" if at is None else f" at {_trim(at)} s"
    return {"label": g.get("label") or f"{ctx.name(cid)}'s needle swings at least {_trim(least)}°{when}", "ok": ok, "kind": "deflects", "compass": cid,
            "deg": None if swing is None else round(swing, 2), "most_deg": None if most is None else round(most, 2)}


def goal_induces(ctx, g):
    """{kind: "induces", coil, at_least_mv?, before_s?}: a voltage of at least at_least_mv (default 1 mV, either way) is induced in a coil at
    some moment (by before_s if given): a magnet moved in or out of it."""
    cid = g.get("coil")
    if not ctx.known(cid):
        return None
    least = ctx.num(g.get("at_least_mv"))
    least = 1.0 if least is None else least
    by = ctx.num(g.get("before_s"))
    v = ctx.state(cid, "emf_mv")
    peak = None
    t_first = None
    for t, x in zip(ctx.times, v or []):
        if x is None:
            continue
        if peak is None or abs(x) > peak:
            peak = abs(x)
        if t_first is None and abs(x) >= least:
            t_first = t
    ok = t_first is not None and (by is None or t_first <= by)
    when = "" if by is None else f" by {_trim(by)} s"
    return {"label": g.get("label") or f"{ctx.name(cid)} makes at least {_trim(least)} mV{when}", "ok": ok, "kind": "induces", "coil": cid,
            "t": None if t_first is None else round(t_first, 3), "peak_mv": None if peak is None else round(peak, 3)}
