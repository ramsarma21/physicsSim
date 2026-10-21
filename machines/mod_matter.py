"""The matter module: the particle model of solids, liquids and gases; dissolving and solutions; mixtures and how to separate them; mass
conserved on a scale through melting, dissolving, breaking and reactions; a gas-making reaction in an open or closed bottle; gases have
mass; density blocks.

items.py imports this file (machines/mod_<name>.py) after the catalog files and calls register_all(globals()); web/sim/modules/matter.js is
its exact JavaScript port (the same documents, number for number). The engine side is tooling/src/sim/modules/matter.ts (one process kind,
"matter", by role) with the physics in tooling/src/sim/matter/*.ts: a deterministic particle system (particles.ts: the molecules of the
model and real grains), the particle box (box.ts), dissolving (dissolve.ts, glass.ts), grains, sieves and magnets (grains.ts), real values
(substances.ts). web/models/mod-matter.js draws them; web/CONTRACT.md "Matter" says what is real and what is a model.

Items: particle-box, syringe, balloon-bath (the particle model, Boyle, Charles); dissolving-glass (salt, sugar, sand, chalk in water:
solubility and rate); zip-bag, chocolate-bar (mass conserved on a scale); reaction-bottle (baking soda and vinegar, open, capped or with
a balloon); pumped-ball (air has mass); mixture-dish, sieve (separating mixtures: a magnet, a sieve); filter-funnel, evaporating-dish
(separating by filtering and evaporating: sand stays on the paper, the salt comes back as crystals); density-cube, equal-mass-block.

Hidden masses (what a scale must weigh but no solid shows: salt in the water, the gas still in a bottle, the air in a ball, melt water in a
bag) ride on a hidden "ballast" solid welded into the item, which the engine resizes as the mass changes, so a kitchen scale that weighs
the items resting on it (measure's) reads them.

Sources:
  [CRC] CRC Handbook of Chemistry and Physics, 97th ed.: solubilities, densities, molar masses, melting and boiling points.
  [NIST-WB] NIST Chemistry WebBook: molar masses (NaHCO3 84.007, CH3COOH 60.052, CO2 44.010 g/mol).
  [CODATA18] R = 8.314462618 J/(mol·K).
  [USDA] 1 tsp table salt 6 g, granulated sugar 4.2 g; a sugar cube 2.2 g, 1.6 cm.
  [VINEGAR] U.S. FDA 21 CFR 133 standard of identity: table vinegar at least 4 % acetic acid (typically 5 %), 1.005 g/mL.
  [BD] BD 60 mL Luer-Lok syringe: about 26.7 mm inside, 60 mL at 107 mm.
  [FIFA] FIFA Quality: a size-5 ball 68-70 cm round (Ø 22 cm, 5.58 L), 410-450 g, 0.6-1.1 bar.
  [ISO-AIR] Air 1.204 kg/m³ at 20 °C and 1 atm; ρ = P/(R_air·T), R_air = 287.05 J/(kg·K).
  [WHATMAN] Cytiva, Whatman qualitative filter papers datasheet: Grade 1, particle retention 11 µm, Herzberg flow 150 s, 87 g/m².
  [CARMAN] Carman, Trans. Inst. Chem. Eng. 15, 150 (1937): a bed of grains' permeability k = d²ε³/(180(1 − ε)²) (Kozeny-Carman).
  [R&S] Robinson & Stokes, Electrolyte Solutions, 2nd ed. (1959), Appendix 8.10: NaCl solutions' water activity (0.753 saturated).
  Density cubes: the classic 1 inch (2.54 cm, 16.39 cm³) set (aluminium 2.70, brass 8.50, copper 8.96, steel 7.85, zinc 7.14, oak 0.75,
  pine 0.50, acrylic 1.18, nylon 1.15, PVC 1.38, polypropylene 0.90, HDPE 0.95 g/cm³) [CRC; Engineering ToolBox].
"""
import math

from crmath import cr_pow  # (x ** (1/3) correctly rounded: the same bits as web/sim's port)

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "MATERIALS", "add_look", "LOOK_FILL", "LOOK_SHADE", "register_goal_kind", "register_warning_hook",
          "TYPES", "CATEGORIES", "props_of")

MODULE = "matter"
CAT = "Matter"


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CAT not in CATEGORIES:
        CATEGORIES.append(CAT)
    _looks()
    _materials()
    _model_types()
    _solution_types()
    _conservation_types()
    _mixture_types()
    _separating_types()
    _density_types()
    _chemistry_types()
    _atom_types()
    _goals()
    register_warning_hook(_matter_warnings)


# ---------------------------------------------------------------- looks and materials
def _looks():
    add_look("box acrylic", fill="#dfe9ef", shade="#a9bccb", roughness=0.05, metalness=0.0, clearcoat=1.0, transmission=0.9, ior=1.49, thickness=0.006)
    add_look("chocolate bar", fill="#5a3422", shade="#3d2216", roughness=0.35, metalness=0.0, clearcoat=0.3)
    add_look("bag film", fill="#eef4f8", shade="#c8d4dc", roughness=0.15, metalness=0.0, clearcoat=0.8, transmission=0.85, ior=1.5, thickness=0.0005)
    add_look("glass water", fill="#c4dff0", shade="#8fbcd8", roughness=0.05, metalness=0.0, clearcoat=1.0, transmission=0.85, ior=1.333, thickness=0.05)
    add_look("hot plate", fill="#e9e7e2", shade="#b9b6ae", roughness=0.45, metalness=0.1, clearcoat=0.3)
    add_look("pet bottle", fill="#d7ecf2", shade="#9cc3cf", roughness=0.08, metalness=0.0, clearcoat=1.0, transmission=0.85, ior=1.57, thickness=0.0004)
    add_look("cube brass", fill="#c9a447", shade="#9a7a2c", roughness=0.3, metalness=1.0, clearcoat=0.0)
    add_look("cube zinc", fill="#b9bfc4", shade="#8d9399", roughness=0.4, metalness=1.0, clearcoat=0.0)
    add_look("cube copper", fill="#c46a3c", shade="#8a4423", roughness=0.3, metalness=1.0, clearcoat=0.0)
    add_look("cube pvc", fill="#e9ecef", shade="#b9bec4", roughness=0.35, metalness=0.0, clearcoat=0.3)
    add_look("cube hdpe", fill="#f4f1e8", shade="#cfc9b8", roughness=0.45, metalness=0.0, clearcoat=0.1)
    add_look("cube nylon", fill="#efe9dc", shade="#c8bfac", roughness=0.4, metalness=0.0, clearcoat=0.2)


def _mat(key, **kw):
    kw.setdefault("rolling", 0.0)
    kw.setdefault("side", 0.0)
    if key not in MATERIALS:
        MATERIALS[key] = kw


def _materials():
    _mat("box acrylic", density=1180.0, bounce=0.6, friction=0.5, rolling=0.01, look="box acrylic",
         source="Acrylic (PMMA) 1180 kg/m³ [CRC]; bounce and friction provisional.")
    _mat("glass", density=2500.0, bounce=0.92, friction=0.4, rolling=0.001, side=0.1, look="glass",
         source="Soda-lime glass 2500 kg/m³; glass on glass, kinetic friction about 0.4 (Engineering ToolBox). Hard, so a high bounce: provisional.")
    _mat("chocolate bar", density=1300.0, bounce=0.1, friction=0.6, rolling=0.05, look="chocolate bar",
         source="Dark chocolate about 1.3 g/cm³ (approximate; a bar's mass is set by its own prop). It snaps rather than bounces.")
    _mat("bag film", density=920.0, bounce=0.2, friction=0.5, rolling=0.02, look="bag film",
         source="LDPE film 910-940 kg/m³; a sandwich bag 16 × 15 cm weighs about 2 g (its own prop sets the mass).")
    # (its look is this module's own "glass water", as web/sim/modules/matter.js has it: the module needs no other module's look)
    _mat("liquid water", density=998.2, bounce=0.0, friction=0.0, rolling=0.0, look="glass water",
         source="Liquid water 998.2 kg/m³ at 20 °C [IAPWS-95]; inside a glass, welded to it: it only adds its weight.")
    _mat("ballast", density=1000.0, bounce=0.0, friction=0.0, rolling=0.0, look="steel",
         source="A hidden carrier of a mass no solid shows (dissolved salt, gas still in a bottle, air in a ball, melt water in a bag): its density is set per item.")
    _mat("hot plate", density=2000.0, bounce=0.3, friction=0.5, rolling=0.01, look="hot plate",
         source="A lab hot plate's enamelled steel case (fixed in place).")
    # (the density set's materials are the module's own, so another module's "copper" or "pine" never changes a cube's density)
    for key, rho, look, src in DENSITY_MATERIALS:
        _mat(f"density set {key}", density=rho, bounce=0.5, friction=0.45, rolling=0.005, look=look, source=src)


# the density-cube set: (material key, density kg/m³, look, source)
DENSITY_MATERIALS = [
    ("aluminium", 2700.0, "aluminium", "Aluminium 2.70 g/cm³ [CRC]."),
    ("brass", 8500.0, "cube brass", "Brass (cartridge, 70/30) 8.50 g/cm³ [CRC]."),
    ("copper", 8960.0, "cube copper", "Copper 8.96 g/cm³ [CRC]."),
    ("steel", 7850.0, "steel", "Carbon steel 7.85 g/cm³ [CRC]."),
    ("zinc", 7140.0, "cube zinc", "Zinc 7.14 g/cm³ [CRC]."),
    ("oak", 750.0, "wood", "Red oak, dry, about 0.75 g/cm³ (Wood Handbook FPL-GTR-190, Table 5-3a)."),
    ("pine", 400.0, "light wood", "Pine 0.35-0.46 g/cm³ at 12 % moisture (Wood Handbook, FPL-GTR-190, 2010, Table 5-3a)."),
    ("acrylic", 1180.0, "box acrylic", "Acrylic (PMMA) 1.18 g/cm³ [CRC]."),
    ("nylon", 1150.0, "cube nylon", "Nylon 6/6 1.14-1.15 g/cm³ (Engineering ToolBox)."),
    ("PVC", 1380.0, "cube pvc", "Rigid PVC 1.38 g/cm³ (Engineering ToolBox)."),
    ("polypropylene", 905.0, "plastic", "Polypropylene 0.90-0.91 g/cm³ (Engineering ToolBox)."),
    ("polyethylene", 950.0, "cube hdpe", "High-density polyethylene 0.94-0.97 g/cm³ [CRC]."),
]
DENSITY_KEYS = [m[0] for m in DENSITY_MATERIALS]


# ---------------------------------------------------------------- real values the builders use (the engine has the same in substances.ts)
# substance -> (name, molar mass kg/mol, melts °C or None, boils °C (or sublimes), colour, source)
SUBSTANCES = {
    "water": ("water", 0.018015, "#3a7bd5"),
    "wax": ("paraffin wax", 0.352, "#e8d9a8"),
    "iron": ("iron", 0.055845, "#8a8f96"),
    "gallium": ("gallium", 0.069723, "#b8c2cc"),
    "carbon dioxide": ("carbon dioxide", 0.04401, "#d9e6ee"),
    "air": ("air", 0.028965, "#8fb7d9"),
    "nitrogen": ("nitrogen", 0.028014, "#7fa6d6"),
    "helium": ("helium", 0.0040026, "#f2c84b"),
    "bromine": ("bromine", 0.159808, "#a5401c"),
}
SUBSTANCE_KEYS = list(SUBSTANCES)
# the densest each gets (its solid's or its liquid's density, kg/m³, as substances.ts): no box packs its sample tighter [CRC]
DENSEST = {"water": 998.0, "wax": 900.0, "iron": 7874.0, "gallium": 6095.0, "carbon dioxide": 1562.0, "air": 1000.0, "nitrogen": 1026.0,
           "helium": 190.0, "bromine": 4050.0}
SYRINGE_AREA = math.pi * 0.0267 * 0.0267 / 4      # m²: a 60 mL syringe's plunger [BD]
PUSH_SAID = 200.0   # N: a plunger held harder than this is said (about what one hand pushes: a modelling choice; matter.ts PUSH_SAID)
SECOND_KEYS = ["none", "air", "bromine", "helium", "nitrogen", "carbon dioxide"]
R_GAS = 8.314462618
R_AIR = 287.05
ATM = 101325.0
KELVIN = 273.15

# solutes the glass knows: key -> (crystal density kg/m³, grains: {choice: (grain diameter m, porous factor)}, source)
SOLUTES = {
    "salt": (2165.0, {"table": (0.0003, 1.0), "coarse": (0.0025, 1.0), "powder": (0.00005, 1.0)},
             "Salt (NaCl): 2.165 g/cm³; dissolves 35.65 g per 100 g of water at 0 °C, 35.89 at 20 °C, 39.07 at 100 °C [CRC]; table grains about 0.3 mm, coarse 2-3 mm [USDA]."),
    "sugar": (1587.0, {"granulated": (0.0005, 1.0), "coarse": (0.001, 1.0), "powder": (0.00005, 1.0), "cube": (0.0198, 7.0)},
              "Sugar (sucrose): 1.587 g/cm³; dissolves 179 g per 100 g of water at 0 °C, 204 at 20 °C, 487 at 100 °C [CRC]; granulated grains about 0.5 mm; "
              "a cube 2.2 g, 1.6 cm (drawn as a 1.98 cm sphere of its volume; it is two-thirds air, so water soaks in: its surface counts 7 times, which "
              "gives the few minutes a cube takes in still room-temperature water: approximate)."),
    "sand": (2650.0, {"fine": (0.0002, 1.0), "coarse": (0.001, 1.0)}, "Quartz sand 2.65 g/cm³: does not dissolve [CRC]."),
    "chalk": (2710.0, {"powder": (0.000005, 1.0)}, "Chalk (calcium carbonate) 2.71 g/cm³: 0.0013 g per 100 mL, so it does not dissolve; its powder clouds the water and settles slowly [CRC]."),
}
SOLUTE_KEYS = list(SOLUTES)
GRAIN_KEYS = ["table", "granulated", "coarse", "powder", "cube", "fine"]
# solubility (g per 100 g of water) at 0, 10, ... 100 °C [CRC]
SOLUBILITY = {
    "salt": [35.65, 35.72, 35.89, 36.09, 36.37, 36.69, 37.04, 37.46, 37.93, 38.47, 39.07],
    "sugar": [179.2, 190.5, 203.9, 219.5, 238.1, 260.4, 287.3, 320.5, 362.1, 415.7, 487.2],
}


def solubility(solute, temp):
    """Grams that dissolve in 100 g of water at temp °C (0 for sand and chalk), linear between the 10 °C rows."""
    rows = SOLUBILITY.get(solute)
    if rows is None:
        return 0.0
    t = min(100.0, max(0.0, temp))
    k = 0
    while k < 9 and t >= 10 * (k + 1):
        k += 1
    u = (t - 10 * k) / 10
    return rows[k] + (rows[k + 1] - rows[k]) * u


def water_density(temp):
    """Liquid water's density at temp °C, kg/m³ (CRC table rows, linear between them)."""
    rows = [(0.0, 999.84), (4.0, 999.97), (10.0, 999.7), (20.0, 998.21), (25.0, 997.05), (30.0, 995.65), (40.0, 992.22), (50.0, 988.04),
            (60.0, 983.2), (70.0, 977.76), (80.0, 971.79), (90.0, 965.31), (100.0, 958.35)]
    t = min(100.0, max(0.0, temp))
    for (t0, d0), (t1, d1) in zip(rows, rows[1:]):
        if t <= t1:
            return d0 + (d1 - d0) * (t - t0) / (t1 - t0)
    return rows[-1][1]


def air_density(temp, gauge=0.0):
    """Air at temp °C and `gauge` Pa above 1 atm, kg/m³ (ideal gas, R_air = 287.05 J/(kg·K))."""
    return (ATM + gauge) / (R_AIR * (temp + KELVIN))


# ---------------------------------------------------------------- helpers (the port does the same, step for step)
def _upright(c):
    """A fixed setup stands upright whatever the item's angle (its contents are level): its solids are placed unturned."""
    c.ca, c.sa, c.a = 1.0, 0.0, 0.0


def _weld(c, part, parent, w, h, d, lx, ly, material, look, words, hidden=False, color=None):
    """A slab welded to another solid of this item: lx, ly in the parent's frame."""
    body = {"kind": "slab", "width": round(w, 5), "height": round(h, 5), "depth": round(d, 5)}
    s = {"kind": c.kind, "id": f"{c.item['id']}/{part}", "words": words, "item": c.item["id"], "look": look, "body": body, "material": material,
         "at": {"x": round(lx, 5), "y": round(ly, 5)}, "parent": parent, "placeholder": {"fill": color or LOOK_FILL[look]},
         "render": {"kind": "procedural", "shade": LOOK_SHADE[look]}, "depth": 2}
    if hidden:
        s["hidden_3d"] = True
    if color:
        s["color"] = color
    c.sb.solids.append(s)
    return s["id"]


BALLAST_R = 0.001
BAG_FULL = 1.0      # kg: the most melt water a bag's ballast carries (tooling/src/sim/modules/matter.ts BAG_FULL)


def _ballast(c, parent, mass, lx, ly):
    """The hidden carrier of a mass no solid shows (see the docstring): a 4 mm ball welded inside `parent` at (lx, ly) in its frame, whose
    density gives `mass` kg, the most it will carry (the engine shrinks it as that mass changes: a round fixture stays sound however small).
    Returns its solid id."""
    v = 4 / 3 * math.pi * BALLAST_R * BALLAST_R * BALLAST_R
    m = c.mat(base="ballast", density=round(max(mass, 1e-9) / v, 6), overrides={})
    s = {"kind": c.kind, "id": f"{c.item['id']}/ballast", "words": "a hidden mass carrier", "item": c.item["id"], "look": "steel",
         "body": {"kind": "ball", "radius": BALLAST_R}, "material": m, "at": {"x": round(lx, 5), "y": round(ly, 5)}, "parent": parent,
         "placeholder": {"fill": LOOK_FILL["steel"]}, "render": {"kind": "procedural", "shade": LOOK_SHADE["steel"]}, "depth": 4, "hidden_3d": True}
    c.sb.solids.append(s)
    return s["id"]


def _r(v, n=6):
    return round(v, n)


# ---------------------------------------------------------------- the particle model: particle-box, syringe, balloon-bath
def _particle_radius(width, height, count, least=0.0015):
    """The model particles' radius: about a sixth of the room each has, `least` (1.5 mm) to 6 mm."""
    return round(min(0.006, max(least, 0.17 * math.sqrt(width * height / count))), 5)


def build_particle_box(c, P):
    _upright(c)
    W, H = P["width"], P["height"]
    t, base_h, cell = 0.006, 0.035, 0.04
    c.slab("base", W + 0.06, base_h, 0.12, 0.0, base_h / 2, kind="static", material=c.mat(base="hot plate", overrides={}), look="hot plate",
           words="a lab hot plate under the box")
    m = c.mat(base="box acrylic", overrides={})
    y0 = base_h + t
    c.slab("floor", W + 2 * t, t, cell, 0.0, base_h + t / 2, kind="static", material=m, look="box acrylic", words="the box's clear floor")
    c.slab("left", t, H, cell, -W / 2 - t / 2, y0 + H / 2, kind="static", material=m, look="box acrylic", words="the box's clear wall")
    c.slab("right", t, H, cell, W / 2 + t / 2, y0 + H / 2, kind="static", material=m, look="box acrylic", words="the box's clear wall")
    if not P["piston"]:
        c.slab("lid", W + 2 * t, t, cell, 0.0, y0 + H + t / 2, kind="static", material=m, look="box acrylic", words="the box's clear lid")
    count = int(P["particles"])
    radius = _particle_radius(W, H, count)
    second = P["second"] if P["divider"] and P["second"] != "none" else None
    ox, oy = c.world(0.0, y0)
    T0 = P["temp_c"]
    c.process("matter", "model", role="box", origin={"x": round(ox, 5), "y": round(oy, 5)}, width=round(W, 5), height=round(H, 5),
              substance=P["substance"], second=second, count=count, radius=radius, mass=_r(_box_sample(P)), volume=_r(P["volume_ml"] / 1e6, 9),
              start=round(T0, 4), heater=round(P["heater_w"], 4), heatFrom=round(P["heat_from_s"], 4), piston=bool(P["piston"]),
              pistonAt=round(P["piston_start"], 4), load=round(P["load_kg"], 5), area=_r(P["piston_area_cm2"] / 1e4, 8), outside=ATM,
              divider=bool(P["divider"]), openAt=round(P["open_at_s"], 4), drive=None, seed=_seed(c.item["id"]))
    P["particle_mm"] = round(radius * 2000, 2)


def _box_sample(P):
    """The box's real sample, kg: sample_g, but never packed tighter than the substance's solid or liquid (1000 g of carbon dioxide does not
    fit in 1 mL: at most 1.56 g does, as dry ice); _matter_warnings says so."""
    return min(P["sample_g"] / 1000, P["volume_ml"] / 1e6 * DENSEST.get(P["substance"], 1000.0))


def _seed(text):
    """A seed from an item's id (the same in the port: a 31-bit FNV-1a of its UTF-16 code units)."""
    h = 2166136261
    for ch in text:
        for unit in _utf16(ch):
            h = ((h ^ unit) * 16777619) % 4294967296
    return h % 2147483647


def _utf16(ch):
    o = ord(ch)
    if o < 0x10000:
        return [o]
    o -= 0x10000
    return [0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)]


def _box_readouts():
    return [Readout("temp_c", "Temperature", "°C", 1, "The sample's temperature (its heat over its specific and latent heats)"),
            Readout("solid_pct", "Solid", "%", 0), Readout("liquid_pct", "Liquid", "%", 0), Readout("gas_pct", "Gas", "%", 0),
            Readout("pressure_kpa", "Pressure", "kPa", 1, "The real sample's gas pressure nRT/V in the real volume (the particles' hits are the picture of it); a piston resting on the solid or liquid: its load"),
            Readout("volume_ml", "Volume", "mL", 0, "The real volume the box stands for (it follows a piston)"),
            Readout("speed_ms", "Molecules' mean speed", "m/s", 0, "The real mean speed √(8RT/πM); the model's particles move 1/1250 of it"),
            Readout("heat_kj", "Heat put in", "kJ", 3), Readout("mixed_pct", "Mixed", "%", 0, "With a divider: 0 unmixed, 100 evenly mixed. A MODEL clock: "
                                                                                        "the particles mix in a few run seconds whatever the time-lapse; real gases take "
                                                                                        "about L²/2D (a 20 cm box about 30 minutes, D ≈ 0.1 cm²/s)")]


def _model_types():
    register(ItemType("particle-box", "Particle model box", CAT, build_particle_box, dynamic=False, material="box acrylic", materials=["box acrylic"],
                      props=[Prop("substance", "Substance", "water", kind="choice", choices=SUBSTANCE_KEYS,
                                  help="Water melts at 0 °C and boils at 100 °C; wax 58/370; iron 1538/2862; gallium 29.8 (melts in a hand); carbon dioxide (dry ice) turns straight to gas at −78.5 °C"),
                             Prop("temp_c", "Start temperature", 20.0, -270.0, 3000.0, 1.0, "°C"),
                             Prop("heater_w", "Heater", 0.0, -2000.0, 20000.0, 1.0, "W", "The hot plate's power into the sample (negative: a cooler); it cuts out 250 °C past the boiling point"),
                             Prop("heat_from_s", "Heater on at", 0.5, 0.0, 20.0, 0.1, "s"),
                             Prop("sample_g", "Sample", 1.0, 0.001, 1000.0, 0.01, "g", "The real sample's mass: with the heater's power it sets how fast it warms"),
                             Prop("particles", "Particles", 60, 8, 160, 1, "", "Model particles drawn (each stands for very many molecules)", kind="int"),
                             Prop("width", "Width", 0.2, 0.08, 0.5, 0.01, "m"), Prop("height", "Height", 0.2, 0.08, 0.5, 0.01, "m"),
                             Prop("volume_ml", "Real volume", 1000.0, 1.0, 100000.0, 1.0, "mL", "The real container the box stands for (gas pressure = nRT/V)"),
                             Prop("piston", "Piston", False, kind="bool", help="A lid free to slide: the gas holds up its load"),
                             Prop("piston_start", "Piston starts at", 0.6, 0.2, 1.0, 0.05, "× height"),
                             Prop("load_kg", "Load on the piston", 0.0, 0.0, 50.0, 0.1, "kg"),
                             Prop("piston_area_cm2", "Piston area", 7.07, 0.5, 500.0, 0.01, "cm²", "The real piston's area (3 cm across: 7.07 cm²)"),
                             Prop("divider", "Divider", False, kind="bool", help="A wall down the middle, lifted at `open at`: one colour (or gas) each side mixes"),
                             Prop("second", "Other side", "none", kind="choice", choices=SECOND_KEYS, help="With a divider: another gas on the right (none: the same substance in a second colour)"),
                             Prop("open_at_s", "Divider lifts at", 1.0, 0.0, 20.0, 0.1, "s")],
                      tags=["particles", "molecules", "atoms", "particle model", "kinetic", "states of matter", "solid", "liquid", "gas", "melting", "boiling",
                            "evaporation", "temperature", "pressure", "diffusion", "heating curve", "piston", "Boyle", "Charles"],
                      description="A clear box on a hot plate showing a substance as particles (a MODEL: drawn huge and slowed down). Solid: bonded, vibrating; "
                                  "liquid: sliding at the bottom; gas: flying, filling the box, pressing on the walls. Heat it and it melts and boils with the real "
                                  "plateaus; real readouts beside it: temperature, pressure, volume, molecular speed.",
                      source="Melting/boiling points, specific and latent heats and molar masses [CRC; NIST-WB]; molecular speeds √(3RT/M) [CODATA18 R]; the "
                             "model's particle sizes and speeds are scaled (web/CONTRACT.md Matter).",
                      anchor="the middle of the hot plate's bottom, where it stands", facts="1 g of water at 20 °C, 60 particles, 1 L",
                      readouts=_box_readouts(), module=MODULE))

    def build_syringe(c, P):
        _upright(c)
        d, scale = 0.0267, 0.1072          # [BD]: 26.7 mm inside, 60 mL at 107.2 mm
        t, foot = 0.0015, 0.012
        H = scale * 1.05
        m = c.mat(base="polypropylene", overrides={})
        c.slab("foot", 0.06, foot, 0.06, 0.0, foot / 2, kind="static", material=m, look="plastic", words="the syringe's stand")
        c.slab("tip", d + 2 * t, 0.006, 0.03, 0.0, foot + 0.003, kind="static", material=m, look="plastic", words="the sealed tip cap")
        y0 = foot + 0.006
        c.slab("left", t, H, 0.03, -d / 2 - t / 2, y0 + H / 2, kind="static", material=m, look="plastic", words="the syringe's barrel")
        c.slab("right", t, H, 0.03, d / 2 + t / 2, y0 + H / 2, kind="static", material=m, look="plastic", words="the syringe's barrel")
        h0 = scale * P["start_ml"] / 60.0
        h1 = scale * P["push_to_ml"] / 60.0
        count = int(P["particles"])
        radius = _particle_radius(d, h0, count, 0.001)
        ox, oy = c.world(0.0, y0)
        T0 = P["temp_c"]
        vol = P["start_ml"] / 1e6
        c.process("matter", "model", role="box", origin={"x": round(ox, 5), "y": round(oy, 5)}, width=d, height=round(H, 5), substance="air",
                  second=None, count=count, radius=radius, mass=_r(air_density(T0) * vol, 9), volume=_r(vol, 9), start=round(T0, 4), heater=0.0,
                  heatFrom=0.0, piston=True, pistonAt=round(h0 / H, 6), load=0.0, area=_r(math.pi * d * d / 4, 8), outside=ATM, divider=False,
                  openAt=0.0, drive={"from": round(P["push_from_s"], 4), "until": round(P["push_from_s"] + P["push_s"], 4), "to": round(h1 / H, 6)},
                  seed=_seed(c.item["id"]))

    register(ItemType("syringe", "Sealed syringe (air)", CAT, build_syringe, dynamic=False, material="polypropylene", materials=["polypropylene"],
                      props=[Prop("start_ml", "Air at the start", 60.0, 5.0, 60.0, 0.5, "mL"),
                             Prop("push_to_ml", "Plunger pushed to", 30.0, 5.0, 60.0, 0.5, "mL", "Less than at the start: pushed in; more: pulled out"),
                             Prop("push_from_s", "Push starts at", 1.0, 0.0, 20.0, 0.1, "s"), Prop("push_s", "Push takes", 2.0, 0.1, 15.0, 0.1, "s"),
                             Prop("temp_c", "Temperature", 20.0, -50.0, 150.0, 1.0, "°C"),
                             Prop("particles", "Particles", 60, 8, 100, 1, "", "Model air particles drawn", kind="int")],
                      tags=["syringe", "plunger", "air", "gas", "pressure", "volume", "Boyle", "squeeze", "compress", "particles"],
                      description="A 60 mL plastic syringe with its tip sealed, standing upright, its air drawn as particles (a model). Push the plunger in and the "
                                  "same air has less room: the particles hit the walls more often and the gauge's pressure rises (Boyle: 60 → 30 mL doubles it, 101 → 203 kPa; "
                                  "the reading is the real air's p = 60 mL × 101.3 kPa ÷ V). Holding it in takes a push: 57 N at 30 mL, 284 N at 10 mL, 624 N at 5 mL "
                                  "(more than a hand gives). The air stays at its temperature (a slow push).",
                      source="[BD] 60 mL syringe 26.7 mm inside, 107 mm to the 60 mL mark; air 1.204 kg/m³ at 20 °C [ISO-AIR]; Boyle's law pV = constant at fixed T.",
                      anchor="the middle of its stand's bottom", facts="60 mL of air pushed to 30 mL",
                      readouts=[Readout("volume_ml", "Volume", "mL", 1), Readout("pressure_kpa", "Pressure", "kPa", 1), Readout("temp_c", "Temperature", "°C", 1),
                                Readout("force_n", "Push on the plunger", "N", 0, "What holds the plunger where it is: (inside − outside pressure) × its 5.6 cm²; negative: a pull")],
                      module=MODULE))

    def build_balloon_bath(c, P):
        _upright(c)
        D, H, t = P["bowl_d"], 0.18, 0.004
        m = c.mat(base="glass", overrides={})
        c.slab("floor", D + 2 * t, t, D + 2 * t, 0.0, t / 2, kind="static", material=m, look="glass", words="the bowl's glass bottom")
        c.slab("left", t, H, D, -D / 2 - t / 2, t + H / 2, kind="static", material=m, look="glass", words="the bowl's glass side")
        c.slab("right", t, H, D, D / 2 + t / 2, t + H / 2, kind="static", material=m, look="glass", words="the bowl's glass side")
        c.process("matter", "balloon", role="balloon", start=round(P["air_temp_c"], 4), bath=round(P["water_temp_c"], 4), volume=_r(P["balloon_l"] / 1000, 9),
                  tau=round(P["settle_s"], 4), dipAt=round(P["dip_at_s"], 4))

    register(ItemType("balloon-bath", "Balloon in a water bath", CAT, build_balloon_bath, dynamic=False, material="glass", materials=["glass"],
                      props=[Prop("balloon_l", "Balloon at the start", 1.0, 0.1, 5.0, 0.01, "L"),
                             Prop("air_temp_c", "Air temperature", 20.0, -20.0, 60.0, 0.5, "°C", "The balloon's air before it goes in"),
                             Prop("water_temp_c", "Water temperature", 60.0, 0.0, 100.0, 0.5, "°C", "Ice water 0 °C, hot tap water 60 °C"),
                             Prop("dip_at_s", "Dipped in at", 0.5, 0.0, 20.0, 0.1, "s"),
                             Prop("settle_s", "Warms in about", 20.0, 1.0, 600.0, 1.0, "s", "The time for the air inside to come to the water's temperature (a rubber skin: about 20 s)"),
                             Prop("bowl_d", "Bowl", 0.24, 0.15, 0.4, 0.01, "m")],
                      tags=["balloon", "Charles", "gas", "heat", "cold", "volume", "temperature", "expand", "shrink", "hot water", "ice water"],
                      description="A glass bowl of water at a set temperature with a balloon held down in it by a wire frame: the air inside warms or cools to the "
                                  "water and its volume follows its kelvin temperature (Charles: 1.00 L at 20 °C → 1.136 L in 60 °C water, 0.932 L in ice water).",
                      source="Charles's law V ∝ T (kelvin) at constant pressure; the rubber's own pressure is left out (a big soft balloon: approximate).",
                      anchor="the middle of the bowl's bottom", facts="a 1 L balloon into 60 °C water",
                      readouts=[Readout("temp_c", "Air inside", "°C", 1), Readout("volume_l", "Balloon", "L", 3), Readout("diameter_cm", "Across", "cm", 1)],
                      module=MODULE))


# ---------------------------------------------------------------- solutions: dissolving-glass
GLASS_D, GLASS_T, GLASS_B, GLASS_H = 0.07, 0.0025, 0.006, 0.1


def build_glass(c, P):
    R, t, b, Hg = GLASS_D / 2, GLASS_T, GLASS_B, GLASS_H
    g = c.mat(base="glass", overrides={})
    base = c.slab("base", GLASS_D + 2 * t, b, round(math.pi * (R + t) / 2, 5), 0.0, b / 2, material=g, look="glass", words="the glass's thick bottom")
    # the walls as two slabs whose depth (πR) gives the real cylinder wall's volume (2πR·t·H)
    _weld(c, "wall-left", base, t, Hg, math.pi * R, -R - t / 2, b / 2 + Hg / 2, g, "glass", "the glass's wall")
    _weld(c, "wall-right", base, t, Hg, math.pi * R, R + t / 2, b / 2 + Hg / 2, g, "glass", "the glass's wall")
    temp = P["water_temp_c"]
    rho = water_density(temp)
    depth = min(Hg - 0.005, P["water_ml"] / 1e6 / (math.pi * R * R))
    water_ml = depth * math.pi * R * R * 1e6
    wm = c.mat(base="liquid water", density=round(rho, 4), overrides={})
    if depth > 0.001:
        # (the water: a slab as wide as the glass whose depth πD/4 gives the cylinder's volume; welded, hidden: the model draws the water)
        _weld(c, "water", base, GLASS_D - 0.0005, depth, math.pi * GLASS_D / 4, 0.0, b / 2 + depth / 2, wm, "glass water", "the water in the glass", hidden=True)
    solute = P["solute"]
    crystal, grains, _src = SOLUTES[solute]
    grain_key = P["grain"] if P["grain"] in grains else list(grains)[0]
    grain, porous = grains[grain_key]
    mass = P["solute_g"] / 1000
    start_in = P["start_in"]
    weighed = mass if start_in != "spoon" else 0.0
    ballast = _ballast(c, base, mass, 0.0, 0.0)     # (built carrying all of it; the engine resizes it to what is weighed)
    if start_in == "dish":
        pm = c.mat(base="cardboard", overrides={})
        _weld(c, "dish", base, 0.04, 0.025, 0.04, R + t + 0.028, -b / 2 + 0.0125, pm, "cardboard", "a little paper cup of it beside the glass")
    specks = 1 if grain_key == "cube" else int(P["specks"])
    c.process("matter", "glass", role="glass", solid=base, ballast=ballast, weighed=_r(weighed, 9), radius=R, depth=round(depth, 5), height=Hg,
              floor=round(b / 2, 5), temp=round(temp, 4), solute=solute, crystal=crystal, mass=_r(mass, 9), grain=grain, porous=porous,
              specks=specks, startIn=start_in, pourAt=round(P["pour_at_s"], 4), stir=round(P["stir"], 4), stirFrom=round(P["stir_from_s"], 4),
              stirUntil=round(P["stir_until_s"], 4), solubility=round(solubility(solute, temp), 6), seed=_seed(c.item["id"]))
    P["water_ml"] = round(water_ml, 1)
    P["saturates_at_g"] = round(solubility(solute, temp) * water_ml * rho / 1e6 * 10, 2)   # (g per 100 g of water × the water's mass / 100 g)


def _solution_types():
    register(ItemType("dissolving-glass", "Glass of water (dissolving)", CAT, build_glass, material="glass", materials=["glass"],
                      props=[Prop("water_ml", "Water", 200.0, 10.0, 360.0, 1.0, "mL"),
                             Prop("water_temp_c", "Water temperature", 20.0, 0.0, 100.0, 0.5, "°C", "Cold tap 10 °C, room 20 °C, hot tap 60 °C, just boiled 100 °C"),
                             Prop("solute", "Put in", "salt", kind="choice", choices=SOLUTE_KEYS, help="Salt and sugar dissolve; sand and chalk do not"),
                             Prop("grain", "Grains", "table", kind="choice", choices=GRAIN_KEYS,
                                  help="Salt: table 0.3 mm, coarse 2.5 mm, powder; sugar: granulated 0.5 mm, coarse 1 mm, powder, cube (one 2.2 g cube); sand: fine, coarse; chalk: powder"),
                             Prop("solute_g", "Amount", 6.0, 0.1, 100.0, 0.1, "g", "1 tsp of salt 6 g, of sugar 4.2 g; a sugar cube 2.2 g [USDA]"),
                             Prop("specks", "Specks drawn", 40, 8, 120, 1, "", "Each speck is a pinch of real grains", kind="int"),
                             Prop("start_in", "Starts", "spoon", kind="choice", choices=["spoon", "dish", "glass"],
                                  help="spoon: poured from a spoon held above (weighed once in); dish: in a paper cup beside the glass (weighed all along); glass: already on the bottom"),
                             Prop("pour_at_s", "Poured at", 0.5, 0.0, 20.0, 0.1, "s"),
                             Prop("stir", "Stirring", 0.0, 0.0, 5.0, 0.1, "turns/s", "A spoon going round (0: still water)"),
                             Prop("stir_from_s", "Stir from", 1.0, 0.0, 20.0, 0.1, "s"), Prop("stir_until_s", "Stir until", 20.0, 0.0, 20.0, 0.1, "s")],
                      tags=["glass", "water", "dissolve", "dissolving", "solution", "salt", "sugar", "sand", "chalk", "stir", "spoon", "saturated", "solubility",
                            "sugar cube", "hot water", "cold water", "mixture"],
                      description="A drinking glass of water (7 cm across) with salt, sugar, sand or chalk poured in. Salt and sugar dissolve, faster in hot water, "
                                  "when stirred, and as smaller grains; past saturation the rest stays on the bottom; sand and chalk never dissolve. Moving: stand it "
                                  "on a kitchen scale and the reading stays the same as it dissolves.",
                      source=SOLUTES["salt"][2] + " " + SOLUTES["sugar"][2] + " Rates: Noyes-Whitney with the Ranz-Marshall and Churchill mass-transfer "
                             "correlations (tooling/src/sim/matter/dissolve.ts).",
                      anchor="the middle of its base, where it stands", facts="200 mL of water at 20 °C, 6 g of table salt from a spoon",
                      readouts=[Readout("dissolved_g", "Dissolved", "g", 2), Readout("left_g", "Not dissolved", "g", 2), Readout("dissolved_pct", "Dissolved", "%", 0),
                                Readout("strength_pct", "Strength", "% by mass", 2), Readout("saturated", "Saturated", "", 0, "1 when the water holds all it can"),
                                Readout("clock_s", "Time since poured", "s", 0, "Lesson seconds (time-lapse included)"), Readout("weighed_g", "Weighed with the glass", "g", 2)],
                      module=MODULE))


# ---------------------------------------------------------------- mass conserved: zip-bag, chocolate-bar, reaction-bottle, pumped-ball
def _conservation_types():
    def build_bag(c, P):
        W, D, t = 0.16, 0.15, 0.002
        hw = P["puff"]
        film = c.mat(base="bag film", density=round(P["bag_g"] / 1000 / (W * t * D + 2 * t * hw * D), 4), overrides={})
        floor = c.slab("floor", W, t, D, 0.0, t / 2, material=film, look="bag film", words="the bag's bottom film")
        _weld(c, "side-left", floor, t, hw, D, -W / 2 + t / 2, t / 2 + hw / 2, film, "bag film", "the bag's side", hidden=True)
        _weld(c, "side-right", floor, t, hw, D, W / 2 - t / 2, t / 2 + hw / 2, film, "bag film", "the bag's side", hidden=True)
        ballast = _ballast(c, floor, BAG_FULL, 0.0, 0.0)     # (built carrying the most melt water it holds; the engine resizes it)
        c.process("matter", "bag", role="bag", solid=floor, ballast=ballast, inside={"x0": round(-W / 2 + t, 5), "x1": round(W / 2 - t, 5),
                  "y0": round(t / 2 - 0.005, 5), "y1": round(t / 2 + hw + 0.02, 5)}, sealed=bool(P["sealed"]))

    register(ItemType("zip-bag", "Zip bag", CAT, build_bag, material="bag film", materials=["bag film"],
                      props=[Prop("sealed", "Sealed", True, kind="bool", help="A sealed bag keeps everything: what melts stays in it as water"),
                             Prop("bag_g", "Bag", 2.0, 0.5, 20.0, 0.1, "g"), Prop("puff", "Puffed up", 0.04, 0.02, 0.12, 0.005, "m", "How tall it stands round what is in it")],
                      tags=["bag", "zip bag", "sandwich bag", "sealed", "closed", "container", "melt", "conservation", "mass"],
                      description="A clear sealed sandwich bag (16 × 15 cm, 2 g) lying flat: put things in it (an ice cube, salt, water) and stand it on a kitchen "
                                  "scale. What melts or dissolves inside stays in the bag, so the scale reads the same before and after.",
                      source="A sandwich bag 16 × 15 cm of LDPE film weighs about 2 g.",
                      anchor="the middle of its bottom", facts="a sealed 2 g bag",
                      readouts=[Readout("water_g", "Water in the bag", "g", 2, "What melted (or left the things in it) is held as water"),
                                Readout("contents_g", "Everything in it", "g", 2)], module=MODULE))

    def build_bar(c, P):
        n = int(P["pieces"])
        L, h, D = 0.156, 0.0085, 0.078
        w = L / n
        mass = P["mass_g"] / 1000
        m = c.mat(base="chocolate bar", density=round(mass / (L * h * D), 4), overrides={})
        sids = []
        for k in range(n):
            x = -L / 2 + w * (k + 0.5)
            sids.append(c.slab(f"piece{k + 1}", w, h, D, x, h / 2, material=m, look="chocolate bar", words="a square of the chocolate bar", **_paint(P["color"])))
        c.process("matter", "bar", role="bar", pieces=sids, snapAt=round(P["snap_at_s"], 4), apart=round(P["apart_ms"], 4))

    register(ItemType("chocolate-bar", "Chocolate bar", CAT, build_bar, material="chocolate bar", materials=["chocolate bar"],
                      props=[Prop("mass_g", "Mass", 100.0, 10.0, 500.0, 1.0, "g"), Prop("pieces", "Pieces", 5, 2, 10, 1, "", "Squares along it", kind="int"),
                             Prop("snap_at_s", "Snapped at", 1.0, 0.0, 20.0, 0.1, "s", "When it is broken into its pieces"),
                             Prop("apart_ms", "Pieces pushed apart at", 0.15, 0.0, 1.0, 0.01, "m/s"), Prop("color", "Colour", "#5a3422", kind="choice",
                                                                                                         choices=["#5a3422", "#7b4a2d", "#f1e5c9"], help="Dark, milk or white chocolate")],
                      tags=["chocolate", "bar", "break", "snap", "pieces", "conservation", "mass", "scale"],
                      description="A 100 g chocolate bar (15.6 × 7.8 cm) in squares that are snapped apart at a set time: on a kitchen scale it reads the same "
                                  "whole or in pieces.",
                      source="A 100 g dark chocolate bar is about 15.6 × 7.8 × 0.85 cm; its density about 1.3 g/cm³ (the mass prop sets it).",
                      anchor="the middle of its bottom", facts="100 g in 5 squares snapped at 1 s",
                      readouts=[Readout("pieces_apart", "Pieces apart", "", 0)], module=MODULE))

    def build_bottle(c, P):
        D, t, b, H = 0.065, 0.0004, 0.004, 0.2
        R = D / 2
        pet = c.mat(base="PET", overrides={})
        base = c.slab("base", D, b, round(math.pi * R / 2, 5), 0.0, b / 2, material=pet, look="pet bottle", words="the bottle's bottom")
        _weld(c, "wall-left", base, t, H, math.pi * R, -R + t / 2, b / 2 + H / 2, pet, "pet bottle", "the bottle's side")
        _weld(c, "wall-right", base, t, H, math.pi * R, R - t / 2, b / 2 + H / 2, pet, "pet bottle", "the bottle's side")
        vin_ml = P["vinegar_ml"]
        depth = min(H * 0.9, vin_ml / 1e6 / (math.pi * (R - t) * (R - t)))
        vm = c.mat(base="liquid water", density=1005.0, overrides={})
        _weld(c, "vinegar", base, D - 2 * t - 0.0005, depth, math.pi * (D - 2 * t) / 4, 0.0, b / 2 + depth / 2, vm, "glass water", "the vinegar in it", hidden=True)
        soda = P["soda_g"] / 1000
        ballast = _ballast(c, base, soda, 0.0, 0.0)
        acid = vin_ml * 1.005 * P["acid_pct"] / 100 / 60.052          # mol of acetic acid [VINEGAR, NIST-WB]
        base_mol = soda * 1000 / 84.007                                   # mol of sodium bicarbonate [NIST-WB]
        co2 = min(acid, base_mol)
        headspace = 0.5e-3 - vin_ml / 1e6
        c.process("matter", "reaction", role="reaction", solid=base, ballast=ballast, soda=_r(soda, 9), co2=_r(co2 * 0.04401, 9), mixAt=round(P["mix_at_s"], 4),
                  tau=round(P["react_s"], 4), closure=P["closure"], headspace=_r(max(headspace, 2e-5), 9), temp=20.0, liquid=_r(vin_ml / 1e6, 9))
        P["co2_g"] = round(co2 * 44.01, 3)
        P["co2_l"] = round(co2 * R_GAS * (20 + KELVIN) / ATM * 1000, 3)

    register(ItemType("reaction-bottle", "Fizz bottle (baking soda + vinegar)", CAT, build_bottle, material="PET", materials=["PET"],
                      props=[Prop("vinegar_ml", "Vinegar", 100.0, 20.0, 400.0, 1.0, "mL"), Prop("acid_pct", "Vinegar's acid", 5.0, 1.0, 10.0, 0.1, "%",
                                                                                                   "Table vinegar is 4-5 % acetic acid [VINEGAR]"),
                             Prop("soda_g", "Baking soda", 5.0, 0.2, 30.0, 0.1, "g", "Hangs in a paper sachet in the neck until it drops in"),
                             Prop("closure", "Closure", "open", kind="choice", choices=["open", "cap", "balloon"],
                                  help="open: the gas escapes (the scale goes down); cap: it stays in (the scale stays; the vinegar dissolves some of it, Henry's law; past 900 kPa the cap pops off and the gas escapes); balloon: the balloon fills (the scale reads a little less: the balloon's air buoys it)"),
                             Prop("mix_at_s", "Soda drops in at", 1.0, 0.0, 20.0, 0.1, "s"),
                             Prop("react_s", "Fizz lasts about", 6.0, 0.5, 120.0, 0.5, "s", "The reaction's time constant (most of the gas in about three times it)")],
                      tags=["reaction", "chemical change", "baking soda", "vinegar", "fizz", "bubbles", "gas", "carbon dioxide", "CO2", "bottle", "balloon",
                            "sealed", "open", "conservation", "mass", "new substance"],
                      description="A 500 mL clear plastic bottle of vinegar with baking soda that drops in: it fizzes and makes carbon dioxide. Open, the gas escapes "
                                  "and a kitchen scale under it goes down (5 g of soda: −2.6 g); capped, nothing escapes and the scale stays (the vinegar dissolves part of "
                                  "the gas, Henry's law; past 900 kPa the cap pops off and the gas escapes); with a balloon on the neck the balloon fills (1.36 L) "
                                  "and the scale reads 1.6 g less because the air the balloon pushes aside buoys it.",
                      source="NaHCO3 + CH3COOH → CH3COONa + H2O + CO2 (84.007 + 60.052 → 44.010 g/mol of CO2) [NIST-WB]; vinegar 5 % acid, 1.005 g/mL [VINEGAR]; "
                             "the gas at 20 °C, 1 atm: 24.06 L/mol; the fizz's time is a modelling choice.",
                      anchor="the middle of its bottom", facts="100 mL of 5 % vinegar, 5 g of baking soda, open",
                      readouts=[Readout("co2_g", "Gas made", "g", 3), Readout("escaped_g", "Gas escaped", "g", 3), Readout("balloon_ml", "Balloon", "mL", 0),
                                Readout("pressure_kpa", "Pressure inside", "kPa", 1), Readout("fizz", "Fizzing", "", 2),
                                Readout("co2_dissolved_g", "Gas dissolved in the vinegar", "g", 3, "Under a cap or a balloon (Henry's law: 1.69 g per litre per atm at 20 °C)"),
                                Readout("popped", "Cap popped", "", 0, "1 once the pressure passed 900 kPa and the cap came off")], module=MODULE))

    def build_ball(c, P):
        R = P["diameter"] / 2
        V = 4 / 3 * math.pi * R * R * R
        shell = P["shell_g"] / 1000
        sm = c.mat(base="synthetic leather (soccer)", density=round(shell / V, 4), overrides={})
        ball = c.ball("ball", R, material=sm, words="a soccer ball", **{"pattern": "soccer"})
        T = 20.0
        air0 = air_density(T, P["start_bar"] * 1e5) * V
        air1 = air_density(T, P["end_bar"] * 1e5) * V
        ballast = _ballast(c, ball, max(air0, air1), 0.0, 0.0)
        c.process("matter", "air", role="ball", solid=ball, ballast=ballast, start=_r(air0, 9), end=_r(air1, 9), startBar=round(P["start_bar"], 4),
                  endBar=round(P["end_bar"], 4), pumpAt=round(P["pump_at_s"], 4), pumpFor=round(P["pump_s"], 4))
        P["air_start_g"] = round(air0 * 1000, 2)
        P["air_end_g"] = round(air1 * 1000, 2)

    register(ItemType("pumped-ball", "Ball being pumped up", CAT, build_ball, material="synthetic leather (soccer)", materials=["synthetic leather (soccer)"],
                      props=[Prop("diameter", "Diameter", 0.22, 0.1, 0.3, 0.005, "m", "A size-5 soccer ball 22 cm [FIFA]"),
                             Prop("shell_g", "Ball (empty)", 430.0, 50.0, 1000.0, 1.0, "g"),
                             Prop("start_bar", "Pressure at the start", 0.0, 0.0, 2.0, 0.05, "bar", "Above the air outside (gauge): 0 = flat"),
                             Prop("end_bar", "Pumped to", 0.8, 0.0, 2.0, 0.05, "bar", "A match ball 0.6-1.1 bar [FIFA]"),
                             Prop("pump_at_s", "Pumping starts", 1.0, 0.0, 20.0, 0.1, "s"), Prop("pump_s", "Pumping takes", 3.0, 0.1, 20.0, 0.1, "s")],
                      tags=["ball", "pump", "air", "gas", "mass", "weigh", "soccer", "pressure", "air has mass"],
                      description="A soccer ball pumped up on a kitchen scale: the air pushed into it has mass, so the reading rises (0 → 0.8 bar: +5.4 g); its outside "
                                  "size, and so its buoyancy, stay the same.",
                      source="Size-5 ball Ø 22 cm (5.58 L), 410-450 g [FIFA]; air 1.204 kg/m³ at 20 °C, ρ = P/(287.05 T) [ISO-AIR].",
                      anchor="its centre", facts="430 g ball from 0 to 0.8 bar",
                      readouts=[Readout("air_g", "Air inside", "g", 2), Readout("gauge_bar", "Pressure (gauge)", "bar", 2)], module=MODULE))


def _paint(color):
    return {"color": color} if color else {}


# ---------------------------------------------------------------- mixtures: mixture-dish, sieve
GRAINS = {
    "sand": (0.002, 2650.0, "#d9b97c"), "gravel": (0.007, 2650.0, "#8d8a83"), "iron-filings": (0.0015, 7870.0, "#3d3f42"),
    "salt": (0.0015, 2165.0, "#f4f4f2"), "pepper": (0.0015, 1100.0, "#2b2622"), "rice": (0.003, 1450.0, "#f3eee0"),
    "beans": (0.011, 1300.0, "#7a2e24"), "paper-clips": (0.008, 7850.0, "#c7ccd1"),
}
MIXTURES = {
    "sand + iron filings": ("sand", "iron-filings"), "sand + gravel": ("sand", "gravel"), "salt + pepper": ("salt", "pepper"),
    "rice + beans": ("rice", "beans"), "sand + paper clips": ("sand", "paper-clips"), "sand + salt": ("sand", "salt"),
}
MIXTURE_KEYS = list(MIXTURES)


def _magnet_record(c):
    """The linked magnet item's id, with what its field needs: remanence (T) by its material and its size (m), or None (not linked)."""
    mid = c.link("magnet")
    if mid is None or c.sb.scene_items[mid].get("type") not in TYPES:
        return None
    mp = props_of(c.sb.scene_items[mid])
    material = str(mp.get("material", "ceramic"))
    br = 1.3 if "neodym" in material else 1.25 if "alnico" in material else 0.39
    length = float(mp.get("length", 0.15)) if isinstance(mp.get("length", 0.15), (int, float)) else 0.15
    width = float(mp.get("width", 0.019)) if isinstance(mp.get("width", 0.019), (int, float)) else 0.019
    depth = float(mp.get("depth", 0.0095)) if isinstance(mp.get("depth", 0.0095), (int, float)) else 0.0095
    return {"item": mid, "br": br, "length": round(length, 5), "area": _r(width * depth, 9), "inset": round(width / 4, 5)}


def _mixture_props(default_mix, default_a, default_b):
    return [Prop("mixture", "Mixture", default_mix, kind="choice", choices=MIXTURE_KEYS),
            Prop("amount_a_g", "First part", default_a, 1.0, 500.0, 1.0, "g", "Of the mixture's first part (sand, salt, rice)"),
            Prop("amount_b_g", "Second part", default_b, 1.0, 500.0, 1.0, "g", "Of its second part (iron filings, gravel, pepper, beans, paper clips)"),
            Prop("grains", "Grains drawn", 150, 30, 300, 1, "", "Grains in the slice the model follows (a slice through the whole mixture)", kind="int")]


def _mixture_types():
    def build_dish(c, P):
        W, H, t = P["width"], 0.035, 0.004
        g = c.mat(base="glass", overrides={})
        floor = c.slab("floor", W + 2 * t, t, W + 2 * t, 0.0, t / 2, material=g, look="glass", words="the dish's glass bottom")
        _weld(c, "wall-left", floor, t, H, W, -W / 2 - t / 2, t / 2 + H / 2, g, "glass", "the dish's side")
        _weld(c, "wall-right", floor, t, H, W, W / 2 + t / 2, t / 2 + H / 2, g, "glass", "the dish's side")
        a, b = MIXTURES[P["mixture"]]
        total = (P["amount_a_g"] + P["amount_b_g"]) / 1000
        ballast = _ballast(c, floor, total, 0.0, 0.0)
        wand = None
        if P["wand"]:
            # a magnet wand: a 1.6 cm plastic rod with an N42 neodymium magnet (Ø 12.7 × 25 mm) in its tip, swept across the dish with its tip
            # wand_height above the dish's floor, then lifted out (it carries the iron with it)
            wand = {"from": round(P["wand_from_s"], 4), "until": round(P["wand_from_s"] + P["wand_s"], 4), "height": round(P["wand_height"], 5),
                    "lift": round(H + 0.03, 5), "br": 1.3, "length": 0.025, "radius": 0.00635, "rod": 0.008}
        c.process("matter", "grains", role="grains", solid=floor, ballast=ballast, origin={"x": 0.0, "y": round(t / 2, 5)}, width=round(W, 5),
                  wall=H, components=[{"key": a, "mass": round(P["amount_a_g"], 4)}, {"key": b, "mass": round(P["amount_b_g"], 4)}],
                  grains=int(P["grains"]), magnet=_magnet_record(c), wand=wand, aperture=0.0, wire=0.0, sieveHeight=0.0, sieveWidth=0.0, shake=0.0,
                  shakeHz=0.0, shakeFrom=0.0, shakeUntil=0.0, pour=False, seed=_seed(c.item["id"]))

    register(ItemType("mixture-dish", "Dish of a mixture", CAT, build_dish, material="glass", materials=["glass"],
                      props=[*_mixture_props("sand + iron filings", 50.0, 20.0), Prop("width", "Width", 0.12, 0.06, 0.3, 0.005, "m"),
                             Prop("wand", "Magnet wand", True, kind="bool", help="A neodymium magnet wand swept across just above the mixture, then lifted out"),
                             Prop("wand_height", "Wand tip height", 0.015, 0.008, 0.08, 0.001, "m", "Its tip above the dish's floor while it sweeps (the mixture is about 1 cm deep)"),
                             Prop("wand_from_s", "Sweep starts", 0.5, 0.0, 20.0, 0.1, "s"), Prop("wand_s", "Sweep takes", 2.5, 0.5, 15.0, 0.1, "s")],
                      links=[Link("magnet", "Magnet", types=["bar-magnet", "horseshoe-magnet", "disc-magnet", "ring-magnet"],
                                  help="A magnet held over the dish (magnetism's bar magnet): it pulls the iron out, never the sand")],
                      tags=["mixture", "separate", "separating", "sand", "iron filings", "magnet", "salt", "pepper", "rice", "beans", "gravel", "dish", "petri dish"],
                      description="A shallow glass dish of a mixture (sand and iron filings, salt and pepper, rice and beans...). Its magnet wand sweeps across just "
                                  "above it and lifts out: the iron filings (or steel paper clips) cling to it, the sand stays: separating a mixture by a property. "
                                  "(Or link a magnet item held over it.)",
                      source="Grain sizes and densities: matter/grains.ts (sand 2.65, iron 7.87 g/cm³ [CRC]); a soft iron grain is pulled with F = V·M·∇B, M = χ_eff·B/μ0 "
                             "up to its saturation (1.71 MA/m) (Jiles, Introduction to Magnetism and Magnetic Materials).",
                      anchor="the middle of its bottom", facts="50 g of sand and 20 g of iron filings, a magnet wand",
                      readouts=[Readout("a_left_pct", "First part still in the dish", "%", 0), Readout("b_left_pct", "Second part still in the dish", "%", 0),
                                Readout("a_out_g", "First part taken out", "g", 1), Readout("b_out_g", "Second part taken out", "g", 1),
                                Readout("weighed_g", "Weighed in the dish", "g", 1)], module=MODULE))

    def build_sieve(c, P):
        _upright(c)
        W, H, t = 0.2, 0.035, 0.004
        g = c.mat(base="steel", overrides={})
        c.slab("tray", W + 2 * t, t, 0.2, 0.0, t / 2, kind="static", material=g, look="steel", words="the catch tray's bottom")
        c.slab("tray-left", t, H, 0.2, -W / 2 - t / 2, t + H / 2, kind="static", material=g, look="steel", words="the tray's side")
        c.slab("tray-right", t, H, 0.2, W / 2 + t / 2, t + H / 2, kind="static", material=g, look="steel", words="the tray's side")
        hs = P["sieve_height"]
        a, b = MIXTURES[P["mixture"]]
        c.process("matter", "grains", role="grains", solid=f"{c.item['id']}/tray", ballast=None, origin={"x": 0.0, "y": round(t, 5)}, width=round(W, 5),
                  wall=H, components=[{"key": a, "mass": round(P["amount_a_g"], 4)}, {"key": b, "mass": round(P["amount_b_g"], 4)}],
                  grains=int(P["grains"]), magnet=None, aperture=_r(P["aperture_mm"] / 1000, 7), wire=0.0008, sieveHeight=round(hs, 5),
                  sieveWidth=0.16, shake=_r(P["shake_mm"] / 1000, 7), shakeHz=round(P["shake_hz"], 4), shakeFrom=round(P["shake_from_s"], 4),
                  shakeUntil=round(P["shake_until_s"], 4), pour=False, seed=_seed(c.item["id"]))

    register(ItemType("sieve", "Sieve over a tray", CAT, build_sieve, dynamic=False, material="steel", materials=["steel"],
                      props=[*_mixture_props("sand + gravel", 60.0, 60.0),
                             Prop("aperture_mm", "Mesh holes", 4.0, 0.5, 12.0, 0.1, "mm", "Grains smaller than this fall through"),
                             Prop("sieve_height", "Sieve height", 0.1, 0.05, 0.3, 0.005, "m", "Above the tray's bottom"),
                             Prop("shake_mm", "Shaking", 10.0, 0.0, 30.0, 0.5, "mm", "How far the sieve is shaken side to side"),
                             Prop("shake_hz", "Shakes a second", 4.0, 0.0, 10.0, 0.1, "Hz"),
                             Prop("shake_from_s", "Shake from", 0.5, 0.0, 20.0, 0.1, "s"), Prop("shake_until_s", "Shake until", 6.0, 0.0, 20.0, 0.1, "s")],
                      tags=["sieve", "strainer", "mesh", "separate", "separating", "sand", "gravel", "pebbles", "rice", "beans", "mixture", "size"],
                      description="A kitchen sieve held over a catch tray with a mixture in it: shaken, the grains smaller than its mesh holes fall through and the "
                                  "bigger ones stay (sand through, gravel kept): separating a mixture by size.",
                      source="A grain passes a mesh only if it is smaller than the holes (2-D slice, matter/grains.ts); kitchen sieves 1-4 mm, garden riddles 6-12 mm.",
                      anchor="the middle of the tray's bottom", facts="60 g sand + 60 g gravel, 4 mm mesh, shaken 4 times a second",
                      readouts=[Readout("a_passed_pct", "First part through", "%", 0), Readout("b_passed_pct", "Second part through", "%", 0),
                                Readout("a_passed_g", "First part in the tray", "g", 1), Readout("b_passed_g", "Second part in the tray", "g", 1)], module=MODULE))


# ---------------------------------------------------------------- separating by filtering and evaporating: filter-funnel, evaporating-dish
FILTER_PAPERS = ["filter paper", "coffee filter", "none"]
FILTER_SOLIDS = ["sand", "chalk", "none"]
DISSOLVED_KEYS = ["salt", "sugar", "none"]
DISH_R, DISH_H, DISH_G = 0.045, 0.035, 0.11     # a 90 mm borosilicate glass evaporating dish, 3.5 cm deep (about 130 mL), about 110 g


def _dish_capacity_ml():
    """The dish's volume to its rim, mL (a spherical bowl: its sphere's radius from the rim's radius and the depth)."""
    rs = (DISH_R * DISH_R + DISH_H * DISH_H) / (2 * DISH_H)
    return math.pi * DISH_H * DISH_H * (3 * rs - DISH_H) / 3 * 1e6


def _separating_types():
    def build_filter(c, P):
        _upright(c)
        D = P["funnel_mm"] / 1000
        g = c.mat(base="glass", overrides={})
        st = c.mat(base="steel", overrides={})
        # the catch beaker (250 mL, 7 cm across, 9.5 cm tall) under the funnel, on the table
        bw, bh, bt = 0.07, 0.095, 0.002
        c.slab("beaker", bw, bt * 2, round(math.pi * bw / 4, 5), 0.0, bt, material=g, look="glass", words="the beaker's bottom")
        c.slab("beaker-left", bt, bh, round(math.pi * bw / 4, 5), -bw / 2 + bt / 2, bh / 2, material=g, look="glass", words="the beaker's side")
        c.slab("beaker-right", bt, bh, round(math.pi * bw / 4, 5), bw / 2 - bt / 2, bh / 2, material=g, look="glass", words="the beaker's side")
        # the ring stand: a foot beside the beaker, its rod, and the funnel in its ring
        c.slab("foot", 0.16, 0.012, 0.11, -0.12, 0.006, material=st, look="steel", words="the ring stand's foot")
        rod_h = 0.3
        c.slab("rod", 0.01, rod_h, 0.01, -0.17, 0.012 + rod_h / 2, material=st, look="steel", words="the ring stand's rod")
        apex = 0.135
        rim = apex + (D / 2) / 0.5773502691896257
        c.poly("funnel", [(0.0, round(apex, 5)), (round(D / 2, 5), round(rim, 5)), (round(-D / 2, 5), round(rim, 5))], round(D * 0.6, 5), material=g, look="glass",
               words="the glass funnel lined with filter paper")
        c.slab("stem", 0.007, 0.06, 0.007, 0.0, apex - 0.03 + 0.002, material=g, look="glass", words="the funnel's stem")
        temp = P["water_temp_c"]
        water_ml = P["water_ml"]
        solid = P["solid"]
        solid_g = P["solid_g"] if solid != "none" else 0.0
        dissolved = P["dissolved"]
        want = P["dissolved_g"] if dissolved != "none" else 0.0
        most = solubility(dissolved, temp) * water_ml * water_density(temp) / 1000 / 100 if dissolved != "none" else 0.0
        dis = min(want, most)
        c.process("matter", "filter", role="filter", funnel=round(D, 5), paper=P["paper"], water=_r(water_ml / 1e6, 9), temp=round(temp, 4), undissolved=solid,
                  undissolvedMass=_r(solid_g / 1000, 9), dissolved=dissolved, dissolvedMass=_r(dis / 1000, 9), crystals=_r((want - dis) / 1000, 9),
                  pourAt=round(P["pour_at_s"], 4), pourFor=round(P["pour_s"], 4), rinse=_r(P["rinse_ml"] / 1e6, 9))
        P["dissolves_g"] = round(dis, 3)

    register(ItemType("filter-funnel", "Filter funnel", CAT, build_filter, dynamic=False, material="glass", materials=["glass"],
                      props=[Prop("water_ml", "Water", 100.0, 10.0, 250.0, 1.0, "mL", "The mixture's water, poured in from a cup"),
                             Prop("water_temp_c", "Water temperature", 20.0, 0.0, 100.0, 0.5, "°C", "Warm water runs through a little faster (it is less viscous)"),
                             Prop("solid", "Undissolved", "sand", kind="choice", choices=FILTER_SOLIDS, help="What does not dissolve: the paper keeps it (sand 0.25 mm; chalk's fine flocs)"),
                             Prop("solid_g", "Of it", 10.0, 0.0, 60.0, 0.1, "g"),
                             Prop("dissolved", "Dissolved", "salt", kind="choice", choices=DISSOLVED_KEYS, help="What is dissolved in the water: it runs through the paper with the water"),
                             Prop("dissolved_g", "Of it", 5.0, 0.0, 100.0, 0.1, "g", "Past what the water holds (35.9 g salt per 100 g at 20 °C) the rest stays as crystals on the paper"),
                             Prop("paper", "Paper", "filter paper", kind="choice", choices=FILTER_PAPERS,
                                  help="filter paper: keeps grains over 11 µm; coffee filter: faster, keeps grains over about 20 µm (chalk gets through); none: everything runs through"),
                             Prop("funnel_mm", "Funnel", 75.0, 50.0, 150.0, 1.0, "mm", "Across its rim (a lab funnel 75 mm: it holds about 34 mL above the paper)"),
                             Prop("pour_at_s", "Poured at", 0.5, 0.0, 20.0, 0.1, "s"),
                             Prop("pour_s", "Pouring takes", 3.0, 0.2, 20.0, 0.1, "s", "Run seconds to pour the cup (the pourer waits whenever the funnel is full)"),
                             Prop("rinse_ml", "Rinse", 10.0, 0.0, 50.0, 1.0, "mL", "Clean water poured through once it has drained: it carries the salt the wet paper held")],
                      tags=["filter", "filtering", "filtration", "funnel", "filter paper", "coffee filter", "separate", "separating", "mixture", "sand", "salt water",
                            "chalk", "muddy water", "dissolve", "solution", "filtrate", "residue"],
                      description="A glass funnel lined with filter paper in a ring stand over a beaker; a cup of a mixture (sand in salt water, chalk in water) is "
                                  "poured in. The water and what is dissolved in it run through into the beaker (the filtrate, still salty); the sand stays on the "
                                  "paper (the residue): separating a mixture by grain size. It takes minutes: use time_lapse.",
                      source="Darcy flow through the paper and the cake: Whatman Grade 1 R = 1.47e9 1/m from its Herzberg flow time [WHATMAN]; the cake by Kozeny-Carman "
                             "[CARMAN]; a 60° funnel drains exponentially (tooling/src/sim/matter/separate.ts); water's viscosity [CRC].",
                      anchor="the middle of the beaker's bottom", facts="10 g of sand and 5 g of salt in 100 mL of water through filter paper, a 10 mL rinse",
                      readouts=[Readout("poured_ml", "Poured in", "mL", 1), Readout("in_funnel_ml", "In the funnel", "mL", 1),
                                Readout("filtrate_ml", "Through (filtrate)", "mL", 1), Readout("filtrate_pct", "Of the water through", "%", 0),
                                Readout("salt_through_g", "Dissolved through", "g", 2), Readout("salt_through_pct", "Of the dissolved through", "%", 0),
                                Readout("kept_g", "Kept on the paper", "g", 2), Readout("kept_pct", "Of the undissolved kept", "%", 0),
                                Readout("through_g", "Undissolved through", "g", 2), Readout("clear", "Filtrate clear", "", 0, "1 when no solid came through"),
                                Readout("flow_ml_min", "Dripping", "mL/min", 1), Readout("held_ml", "Held by the wet paper", "mL", 1),
                                Readout("level_mm", "Liquid in the funnel", "mm", 0), Readout("clock_s", "Time since poured", "s", 0, "Lesson seconds (time-lapse included)")],
                      module=MODULE))

    def build_dish(c, P):
        heat = P["heat"]
        parent = None
        y0 = 0.0
        if heat == "hot plate":
            pw, ph, pd = 0.17, 0.06, 0.17
            hp = c.mat(base="hot plate", density=round(2.0 / (pw * ph * pd), 4), overrides={})
            parent = c.slab("plate", pw, ph, pd, 0.0, ph / 2, material=hp, look="hot plate", words="a lab hot plate under the dish")
            y0 = ph
        # the glass dish: a foot ring and its sides as slabs (their volume gives its 110 g); the water and salt ride on its ballast
        fw, fh, wt = 0.05, 0.006, 0.004
        vol = fw * fh * fw + 2 * (wt * DISH_H * math.pi * DISH_R)
        pm = c.mat(base="glass", density=round(DISH_G / vol, 4), overrides={})
        # (every welded part hangs on the item's root, the hot plate when there is one: welds one level deep, as the builder's helpers expect)
        if parent is None:
            base = c.slab("base", fw, fh, fw, 0.0, fh / 2, material=pm, look="glass", words="the evaporating dish's foot")
            root, bx, by = base, 0.0, 0.0
        else:
            by = y0 - 0.03 + fh / 2
            base = _weld(c, "base", parent, fw, fh, fw, 0.0, by, pm, "glass", "the evaporating dish's foot")
            root, bx = parent, 0.0
        _weld(c, "wall-left", root, wt, DISH_H, math.pi * DISH_R, -DISH_R + wt / 2, by + fh / 2 + DISH_H / 2, pm, "glass", "the dish's side")
        _weld(c, "wall-right", root, wt, DISH_H, math.pi * DISH_R, DISH_R - wt / 2, by + fh / 2 + DISH_H / 2, pm, "glass", "the dish's side")
        temp = P["water_temp_c"]
        water_ml = min(P["water_ml"], round(_dish_capacity_ml() * 0.9, 1))
        water = water_ml * water_density(temp) / 1e6
        solute = P["solute"]
        mass = P["solute_g"] / 1000
        ballast = _ballast(c, root, water + mass, bx, by)
        c.process("matter", "dish", role="evaporate", solid=base, ballast=ballast, rim=DISH_R, depth=DISH_H, dish=DISH_G, water=_r(water, 9),
                  start=round(temp, 4), solute=solute, mass=_r(mass, 9), heat=heat, power=round(P["heater_w"], 4), humidity=round(P["humidity_pct"] / 100, 4),
                  heatFrom=round(P["heat_from_s"], 4))
        P["water_ml"] = round(water_ml, 1)
        P["saturates_at_g"] = round(solubility(solute, temp) * water * 1000 / 100, 2)

    register(ItemType("evaporating-dish", "Evaporating dish", CAT, build_dish, material="glass", materials=["glass"],
                      props=[Prop("water_ml", "Water", 50.0, 5.0, 120.0, 1.0, "mL", "Salt water in a 9 cm glass dish (it holds about 120 mL)"),
                             Prop("solute", "Dissolved", "salt", kind="choice", choices=["salt", "sugar"]),
                             Prop("solute_g", "Of it", 5.0, 0.0, 60.0, 0.1, "g", "When the water has gone, it is all left as crystals"),
                             Prop("water_temp_c", "Water at the start", 20.0, 0.0, 100.0, 0.5, "°C"),
                             Prop("heat", "Heated by", "hot plate", kind="choice", choices=["hot plate", "sun", "room"],
                                  help="hot plate: boils dry in minutes; sun: a sunny windowsill, about 3 days for 50 mL; room: still indoor air, about 11 days"),
                             Prop("heater_w", "Hot plate", 300.0, 0.0, 1000.0, 10.0, "W", "Its power (about half of it reaches the dish)"),
                             Prop("heat_from_s", "Heated from", 1.0, 0.0, 20.0, 0.1, "s", "Run seconds: the hot plate is switched on (or the dish set out) then, so a scale has settled first"),
                             Prop("humidity_pct", "Room's humidity", 50.0, 5.0, 95.0, 1.0, "%", "Drier air takes the water faster")],
                      tags=["evaporate", "evaporation", "evaporating dish", "salt water", "crystals", "crystallize", "dry", "boil", "boil dry", "separate",
                            "separating", "solution", "get the salt back", "hot plate", "sun", "windowsill", "dissolve", "mixture"],
                      description="A clear borosilicate glass evaporating dish (9 cm) of salt (or sugar) water, on a hot plate, on a sunny windowsill or in a room. The "
                                  "water evaporates (boils, on a hot plate) and the salt stays: crystals appear once the water is saturated (26.4 % salt) and at "
                                  "the end all of it is left as crystals. On a kitchen scale the reading falls by the water's mass only. Use time_lapse.",
                      source="Heat balance with the heat module's air laws (natural convection, radiation, Chilton-Colburn evaporation; tooling/src/sim/heat-data.ts); "
                             "the salt's water activity [R&S]; boiling point 100 °C + 0.512·i·b [CRC]; solubility [CRC]; about half a hot plate's power reaches "
                             "the dish and a sunny windowsill gives about 700 W/m² (provisional).",
                      anchor="the middle of its bottom (the hot plate's, when heated by one)", facts="5 g of salt in 50 mL of water on a 300 W hot plate",
                      readouts=[Readout("water_g", "Water", "g", 2), Readout("temp_c", "Temperature", "°C", 1), Readout("dissolved_g", "Dissolved", "g", 2),
                                Readout("crystals_g", "Crystals", "g", 2), Readout("strength_pct", "Strength", "% by mass", 1),
                                Readout("saturated", "Saturated", "", 0, "1 while crystals stand in the water"), Readout("dry", "Dry", "", 0),
                                Readout("boiling", "Boiling", "", 0), Readout("evaporated_g", "Water gone", "g", 2),
                                Readout("loss_g_min", "Losing", "g/min", 2), Readout("weighed_g", "Water and salt", "g", 2),
                                Readout("level_mm", "Liquid's depth", "mm", 1), Readout("clock_s", "Time", "s", 0, "Lesson seconds (time-lapse included)")],
                      module=MODULE))


# ---------------------------------------------------------------- density blocks
def _cube_look(key):
    for k, _rho, look, _src in DENSITY_MATERIALS:
        if k == key:
            return look
    return "steel"


def _density_types():
    def density_of(key):
        for k, rho, _look, _src in DENSITY_MATERIALS:
            if k == key:
                return rho
        return 2700.0

    def build_cube(c, P):
        s = P["size"]
        key = P["made_of"]
        rho = density_of(key)
        c.slab("block", s, s, s, 0.0, 0.0, material=c.mat(base=f"density set {key}", overrides={}), look=_cube_look(key), words=f"a {key} cube")
        c.process("matter", "block", role="block", mass=_r(rho * s * s * s, 9), volume=_r(s * s * s, 12), density=rho)
        P["mass_g"] = round(rho * s * s * s * 1000, 2)

    register(ItemType("density-cube", "Density cube", CAT, build_cube,
                      props=[Prop("made_of", "Made of", "aluminium", kind="choice", choices=DENSITY_KEYS, help="The density set's twelve materials"),
                             Prop("size", "Size", 0.0254, 0.005, 0.2, 0.0005, "m", "The classic set's cubes are 1 inch (2.54 cm, 16.39 cm³)")],
                      tags=["cube", "density", "same size", "mass", "heavier", "material", "metal", "wood", "plastic", "float", "sink", "aluminium", "copper",
                            "brass", "steel", "zinc", "oak", "pine", "acrylic", "nylon", "PVC", "polypropylene"],
                      description="A 1 inch cube of one material from the classic density set: the same size in aluminium, brass, copper, steel, zinc, oak, pine, "
                                  "acrylic, nylon, PVC, polypropylene or polyethylene, so they weigh very differently (pine 6.6 g, copper 147 g); the ones less "
                                  "dense than water (wood, polypropylene, polyethylene) float.",
                      source="Densities (g/cm³): aluminium 2.70, brass 8.50, copper 8.96, steel 7.85, zinc 7.14, oak 0.75, pine 0.40, acrylic 1.18, nylon 1.15, "
                             "PVC 1.38, polypropylene 0.905, HDPE 0.95 [CRC; Wood Handbook; Engineering ToolBox].",
                      anchor="its centre", facts="a 2.54 cm aluminium cube, 44.3 g",
                      readouts=[Readout("mass_g", "Mass", "g", 1), Readout("volume_cm3", "Volume", "cm³", 2), Readout("density_gcm3", "Density", "g/cm³", 2)],
                      module=MODULE))

    def build_equal(c, P):
        key = P["made_of"]
        rho = density_of(key)
        m = P["mass_g"] / 1000
        s = cr_pow(m / rho, 1 / 3)
        c.slab("block", s, s, s, 0.0, 0.0, material=c.mat(base=f"density set {key}", overrides={}), look=_cube_look(key), words=f"a {key} block")
        c.process("matter", "block", role="block", mass=_r(m, 9), volume=_r(m / rho, 12), density=rho)
        P["size"] = round(s, 5)

    register(ItemType("equal-mass-block", "Equal-mass block", CAT, build_equal,
                      props=[Prop("made_of", "Made of", "aluminium", kind="choice", choices=DENSITY_KEYS),
                             Prop("mass_g", "Mass", 100.0, 1.0, 5000.0, 1.0, "g", "Every block of the set has this mass: its size follows its density")],
                      tags=["block", "density", "same mass", "size", "volume", "material", "equal mass"],
                      description="A cube whose MASS is set (100 g) and whose size follows its material's density: 100 g of copper is a 2.2 cm cube, of aluminium "
                                  "3.3 cm, of pine 6.3 cm. The equal-mass set shows that density, not size, decides how heavy a thing is for its size.",
                      source="Side = (mass / density)^(1/3); densities as the density cube's [CRC].",
                      anchor="its centre", facts="100 g of aluminium: a 3.33 cm cube",
                      readouts=[Readout("mass_g", "Mass", "g", 1), Readout("volume_cm3", "Volume", "cm³", 2), Readout("density_gcm3", "Density", "g/cm³", 2)],
                      module=MODULE))


# ---------------------------------------------------------------- chemical changes: cold-pack, hand-warmer, indicator-cup, reaction-cup, steel-wool
# Each is a moving item a kitchen scale weighs (what it gains or loses rides on its ballast) with a temperature the heat module's world
# holds when the heat module is loaded (a body, or a beaker's water: a thermometer touching it or standing in it reads it); the matter
# engine (tooling/src/sim/matter/chem.ts) does the chemistry and puts its heat into that world (or into its own small lumped model when
# heat is not loaded). Sources (besides the docstring's):
#   [CRC-H] CRC Handbook, "Enthalpy of solution of electrolytes" (ΔsolH at infinite dilution, 25 °C: NH4NO3 +25.69, NH4Cl +14.78,
#           CaCl2 −81.3 kJ/mol) and "Standard thermodynamic properties of chemical substances" (ΔfH°, kJ/mol: Fe2O3 −824.2, CaCO3 −1207.6,
#           CaCl2 −795.4, NaHCO3 −950.8, Na2CO3 −1130.7, Ca2+ −542.8, Cl− −167.2, Na+ −240.1, HCO3− −692.0, CO3^2− −677.1, CO2(aq) −413.8,
#           CO2(g) −393.5, H2O(l) −285.8, CH3COOH(aq) −485.8, CH3COO− −486.0, OH− −230.0); urea +15.1 kJ/mol [NIST-WB].
#   [IUPAC13] standard atomic weights: H 1.008, C 12.011, N 14.007, O 15.999, Na 22.990, Cl 35.45, Fe 55.845.
#   [PENNISTON] Penniston et al., J. Endourol. 22 (2008) 567: lemon juice 48 g/L of citric acid.
#   Heat capacities [NIST-WB]: NH4NO3 139.3, urea 93.1, NH4Cl 84.1, CaCl2 72.9 J/(mol·K); iron 449 J/(kg·K) [CRC]; water 4184 J/(kg·K).
#   Hand warmers (HotHands-type, safety data sheets): iron powder about 55 % of the fill, water about 20 %, the rest vermiculite, activated
#   carbon and salt; 13 × 9.5 cm; 5-10 hours. Steel wool's rusting time is a modelling choice (stated on the prop).
PACK_CHEMICALS = {
    # key: (words, molar mass kg/mol, ΔsolH J/mol (+: it takes heat in, the pack cools), solid's heat capacity J/(kg·K))
    "ammonium nitrate": ("ammonium nitrate (NH4NO3)", 0.080043, 25690.0, 1740.0),
    "urea": ("urea (CO(NH2)2)", 0.060056, 15100.0, 1550.0),
    "ammonium chloride": ("ammonium chloride (NH4Cl)", 0.053491, 14780.0, 1572.0),
    "calcium chloride": ("calcium chloride (CaCl2): a hot pack", 0.110984, -81300.0, 657.0),
}
PACK_KEYS = list(PACK_CHEMICALS)
C_WATER = 4184.0
C_IRON = 449.0
C_FILM = 2300.0         # polyethylene film J/(kg·K) [Engineering ToolBox]
FE_M = 0.055845
FE_HEAT = 412100.0      # J per mol of iron rusting: 4Fe + 3O2 → 2Fe2O3, ΔH = 2 × −824.2 kJ [CRC-H]
O2_PER_FE = 0.75 * 0.031998   # kg of oxygen taken from the air per mol of iron
WARMER_MAX_W = 20.0     # the most a hand warmer's breathable film lets oxygen in for, W (real warmers peak about 60-70 °C: a modelling bound)
SOAKS = {"vinegar": (0.5, 0.5), "salt water": (1.0, 0.5), "water": (3.0, 0.5), "dry": (60.0, 0.0)}   # (days for 63 % of what can rust, g of liquid held per g)
SOAK_KEYS = list(SOAKS)
RUST_SHARE = 0.5        # the share of fine steel wool's iron that rusts before its coat of rust slows it right down (a modelling choice)
ADDITIONS = {
    # key: (words, unit, density g/mL (a liquid) or 0 (a powder), acetic mol, citric mol, bicarbonate mol, carbonate mol, sodium mol: per mL or g)
    "vinegar": ("vinegar", "mL", 1.005, 0.05 * 1.005 / 60.052, 0.0, 0.0, 0.0, 0.0),
    "lemon juice": ("lemon juice", "mL", 1.03, 0.0, 0.048 / 192.12, 0.0, 0.0, 0.0),
    "baking soda": ("baking soda (NaHCO3)", "g", 0.0, 0.0, 0.0, 1 / 84.007, 0.0, 1 / 84.007),
    "washing soda": ("washing soda (Na2CO3)", "g", 0.0, 0.0, 0.0, 0.0, 1 / 105.988, 2 / 105.988),
    "none": ("nothing", "", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
}
ADDITION_KEYS = list(ADDITIONS)
BAND_NAMES = ["red", "pink", "purple", "blue", "blue-green", "green", "yellow"]     # red cabbage's colours by pH (matter/chem.ts BANDS)
BEAKER_R, BEAKER_T, BEAKER_B, BEAKER_H, BEAKER_G = 0.033, 0.002, 0.004, 0.095, 0.1   # a 250 mL glass beaker: 6.6 cm inside, 9.5 cm, about 100 g


def _heat_on():
    """Whether the heat module is loaded (its thermometer is in the catalog): then these items join its world."""
    return "thermometer" in TYPES and TYPES["thermometer"].module == "heat"


def _pack(c, P, L, D, t, mass, words):
    """A pouch lying flat (L long, D front to back, t thick) of `mass` kg: its one solid, and its heat body when heat is on (or None)."""
    m = c.mat(base="pouch", density=round(mass / (L * t * D), 4), overrides={})
    sid = c.slab("pouch", L, t, D, 0.0, t / 2, material=m, look="pouch", words=words)
    hid = c.process("heat", "body", role="body", solid=sid, cells=1) if _heat_on() else None
    return sid, hid


def _beaker(c, P, water_ml, extra_kg, words):
    """A 250 mL glass beaker standing on its anchor with water_ml of water (its mass on a hidden welded slab) and `extra_kg` riding on its
    ballast; its water joins the heat module's world when it is loaded. Returns (base, ballast, heat water record or None, depth, water kg)."""
    R, t, b, H = BEAKER_R, BEAKER_T, BEAKER_B, BEAKER_H
    vol = (2 * R + 2 * t) * b * (math.pi * (R + t) / 2) + 2 * t * H * math.pi * R
    g = c.mat(base="glass", density=round(BEAKER_G / vol, 4), overrides={})
    base = c.slab("base", 2 * R + 2 * t, b, round(math.pi * (R + t) / 2, 5), 0.0, b / 2, material=g, look="glass", words=words)
    _weld(c, "wall-left", base, t, H, math.pi * R, -R - t / 2, b / 2 + H / 2, g, "glass", "the beaker's wall")
    _weld(c, "wall-right", base, t, H, math.pi * R, R + t / 2, b / 2 + H / 2, g, "glass", "the beaker's wall")
    temp = P["water_temp_c"]
    rho = water_density(temp)
    depth = min(H - 0.01, water_ml / 1e6 / (math.pi * R * R))
    water = depth * math.pi * R * R * rho
    wm = c.mat(base="liquid water", density=round(rho, 4), overrides={})
    _weld(c, "water", base, 2 * R - 0.0005, depth, math.pi * 2 * R / 4, 0.0, b / 2 + depth / 2, wm, "glass water", "the liquid in the beaker", hidden=True)
    ballast = _ballast(c, base, max(extra_kg, 1e-6), 0.0, 0.0)
    hid = None
    if _heat_on():
        hid = c.process("heat", "liquid", role="water", solid=base, x0=round(-R, 6), x1=round(R, 6), y0=round(b / 2, 6), y1=round(b / 2 + H, 6),
                        depth=round(2 * R, 6), round=True, liquid=round(water, 7), start=float(temp), lid=False, wall=t, wallMaterial="glass")
    return base, ballast, hid, depth, water


def _chem_looks():
    add_look("pouch", fill="#f3f6f8", shade="#c7d0d6", roughness=0.4, metalness=0.0, clearcoat=0.3)
    add_look("steel wool", fill="#a7abb0", shade="#7d8287", roughness=0.55, metalness=0.8, clearcoat=0.0)
    add_look("atom plastic", fill="#f2f2f2", shade="#bdbdbd", roughness=0.3, metalness=0.0, clearcoat=0.6)
    _mat("pouch", density=1000.0, bounce=0.05, friction=0.6, rolling=0.05, look="pouch",
         source="A filled plastic pouch (a cold pack, a hand warmer): soft, it hardly bounces; its density is set by what is in it.")
    _mat("steel wool", density=80.0, bounce=0.05, friction=0.7, rolling=0.05, look="steel wool",
         source="A pad of fine steel wool: about 5 g in 90 cm³ (its density is set by its mass and what it soaked up); springy, it hardly bounces.")
    _mat("model plastic", density=1050.0, bounce=0.5, friction=0.4, rolling=0.01, look="atom plastic",
         source="A molecular model kit's polystyrene balls, 1.05 g/cm³ (approximate: kit balls vary).")


def _chemistry_types():
    _chem_looks()

    def build_cold(c, P):
        key = P["chemical"]
        words, M, dh, cp = PACK_CHEMICALS[key]
        L, D = 0.15, 0.12
        salt = P["salt_g"] / 1000
        water = P["water_ml"] / 1000 * 0.9982
        film = 2 * L * D * 0.09 + 0.001       # two faces of 90 g/m² polyethylene film and the 1 g inner water bag
        t = max(0.008, (water / 998.2 + salt / 1700) / (L * D) * 1.5)
        sid, hid = _pack(c, P, L, D, round(t, 5), water + salt + film, "an instant cold pack" if dh > 0 else "an instant hot pack")
        C = water * C_WATER + salt * cp + film * C_FILM
        c.process("matter", "pack", role="pack", solid=sid, heat=hid, chemical=key, molar=M, dh=dh, salt=_r(salt, 9), water=_r(water, 9),
                  capacity=_r(C, 6), at=round(P["squeeze_at_s"], 4), tau=round(P["dissolve_s"], 4), area=_r(2 * (L * D + L * t + t * D), 8))
        P["change_c"] = round(-salt / M * dh / C, 1)
        P["thickness"] = round(t, 4)

    register(ItemType("cold-pack", "Instant cold pack", CAT, build_cold, material="pouch", materials=["pouch"],
                      props=[Prop("chemical", "Chemical", "ammonium nitrate", kind="choice", choices=PACK_KEYS,
                                  help="Ammonium nitrate (most cold packs), urea or ammonium chloride take heat in as they dissolve; calcium chloride gives heat out (a hot pack)"),
                             Prop("salt_g", "Chemical", 30.0, 1.0, 150.0, 1.0, "g", "How much of it is in the pack"),
                             Prop("water_ml", "Water bag", 100.0, 20.0, 300.0, 1.0, "mL", "The inner bag of water it dissolves in"),
                             Prop("squeeze_at_s", "Squeezed at", 1.2, 0.0, 20.0, 0.1, "s", "When the inner water bag is burst and the pack shaken (run seconds)"),
                             Prop("dissolve_s", "Dissolves in about", 30.0, 2.0, 600.0, 1.0, "s", "Lesson seconds for most of it to dissolve once shaken (about 30 s shaken, minutes left still)")],
                      tags=["cold pack", "ice pack", "instant cold pack", "hot pack", "endothermic", "exothermic", "chemical reaction", "dissolve",
                            "ammonium nitrate", "urea", "calcium chloride", "temperature", "heat", "energy", "first aid", "MS-PS1-6"],
                      description="A 15 × 12 cm instant cold pack lying flat: squeezed at a set time, its inner bag of water bursts and the ammonium nitrate dissolves, "
                                  "taking heat in, so the pack goes cold (30 g in 100 mL: from 20 °C to about 2 °C) and slowly warms back to the room. "
                                  "Calcium chloride instead gives heat out (a hot pack: 30 g in 100 mL to about 65 °C). A thermometer lying on it reads it; on a "
                                  "kitchen scale its mass never changes.",
                      source="ΔsolH: NH4NO3 +25.69, NH4Cl +14.78, CaCl2 −81.3 kJ/mol [CRC-H]; urea +15.1 kJ/mol [NIST-WB]; solubilities [CRC]; heat capacities "
                             "[NIST-WB]; its heat goes into the heat module's world (convection, radiation, what it touches).",
                      anchor="the middle of its bottom", facts="30 g of ammonium nitrate, a 100 mL water bag, squeezed at 1.2 s",
                      readouts=[Readout("temp_c", "Temperature", "°C", 1), Readout("dissolved_pct", "Dissolved", "%", 0), Readout("dissolved_g", "Dissolved", "g", 1),
                                Readout("heat_kj", "Heat given out", "kJ", 2, "+: given out to its surroundings (a hot pack); −: taken in (a cold pack)"),
                                Readout("burst", "Water bag burst", "", 0)], module=MODULE))

    def build_warmer(c, P):
        L, D = 0.13, 0.095
        iron = P["iron_g"] / 1000
        fill = iron / 0.55
        water, rest = fill * 0.2, fill * 0.25
        fabric = 2 * L * D * 0.12
        t = max(0.004, min(0.012, fill / 600 / (L * D)))
        sid, hid = _pack(c, P, L, D, round(t, 5), fill + fabric, "a hand warmer")
        if hid is not None:
            c.process("heat", "warmth", role="heater", solid=sid, power=0.0, setpoint=1500.0)   # (its rusting's steady heat: matter/chem.ts sets its power)
        n = iron / FE_M
        full = n * O2_PER_FE
        ballast = _ballast(c, sid, full, 0.0, 0.0)
        C = iron * C_IRON + water * C_WATER + rest * 800.0 + fabric * 1920.0
        lasts = P["lasts_h"] * 3600
        c.process("matter", "warmer", role="warmer", solid=sid, heat=hid, ballast=ballast, iron=_r(iron, 9), full=_r(full, 9), capacity=_r(C, 6),
                  at=round(P["open_at_s"], 4), lasts=round(lasts, 4), area=_r(2 * (L * D + L * t + t * D), 8))
        P["power_w"] = round(min(WARMER_MAX_W, n * FE_HEAT / lasts), 2)
        P["oxygen_g"] = round(full * 1000, 2)

    register(ItemType("hand-warmer", "Hand warmer", CAT, build_warmer, material="pouch", materials=["pouch"],
                      props=[Prop("iron_g", "Iron powder", 20.0, 2.0, 60.0, 0.5, "g", "About 55 % of the fill; the rest is water, salt, carbon and vermiculite"),
                             Prop("lasts_h", "Lasts", 5.0, 0.5, 24.0, 0.5, "h", "How long its iron lasts (its air holes let oxygen in this fast): shorter is hotter"),
                             Prop("open_at_s", "Opened at", 1.2, 0.0, 20.0, 0.1, "s", "When its wrapper is torn open and air gets in (run seconds)")],
                      tags=["hand warmer", "heat pack", "exothermic", "chemical reaction", "rust", "iron", "oxidation", "oxygen", "temperature", "heat",
                            "energy", "winter", "MS-PS1-6"],
                      description="A 13 × 9.5 cm disposable hand warmer lying flat: opened, air gets in and its iron powder rusts (4Fe + 3O2 → 2Fe2O3), giving out heat "
                                  "for hours: on a table it warms from 20 °C to about 40 °C over 10-15 minutes. Its rust is made of the air's oxygen, so on a "
                                  "kitchen scale it slowly gets heavier (20 g of iron: +8.6 g over its life). Use time_lapse (60 for minutes, 3600 for hours).",
                      source="ΔfH Fe2O3 −824.2 kJ/mol: 412 kJ per mol of iron [CRC-H]; hand warmer fill and lifetime from makers' safety data sheets; its heat goes "
                             "into the heat module's world.",
                      anchor="the middle of its bottom", facts="20 g of iron powder, lasts 5 h, opened at 1.2 s",
                      readouts=[Readout("temp_c", "Temperature", "°C", 1), Readout("iron_left_pct", "Iron left", "%", 0),
                                Readout("oxygen_g", "Oxygen taken in", "g", 2, "From the air: what the scale gains"), Readout("power_w", "Heating", "W", 2),
                                Readout("heat_kj", "Heat given out", "kJ", 1)], module=MODULE))

    def build_wool(c, P):
        L, t, D = 0.07, 0.025, 0.05
        wool = P["wool_g"] / 1000
        days, held = SOAKS[P["soaked"]]
        liquid = wool * held
        m = c.mat(base="steel wool", density=round((wool + liquid) / (L * t * D), 4), overrides={})
        sid = c.slab("pad", L, t, D, 0.0, t / 2, material=m, look="steel wool", words="a pad of steel wool")
        hid = c.process("heat", "body", role="body", solid=sid, cells=1) if _heat_on() else None
        if hid is not None:
            c.process("heat", "warmth", role="heater", solid=sid, power=0.0, setpoint=1500.0)
        n = wool / FE_M
        full = RUST_SHARE * n * O2_PER_FE
        ballast = _ballast(c, sid, full, 0.0, 0.0)
        c.process("matter", "rust", role="rust", solid=sid, heat=hid, ballast=ballast, iron=_r(wool, 9), full=_r(full, 9), share=RUST_SHARE,
                  capacity=_r(wool * C_IRON + liquid * C_WATER, 6), rustTau=round(days * 86400, 4), at=round(P["from_s"], 4),
                  area=_r(2 * (L * D + L * t + t * D), 8))
        P["gain_g"] = round(full * 1000, 3)

    register(ItemType("steel-wool", "Steel wool pad", CAT, build_wool, material="steel wool", materials=["steel wool"],
                      props=[Prop("wool_g", "Steel wool", 5.0, 0.5, 50.0, 0.5, "g"),
                             Prop("soaked", "Soaked in", "vinegar", kind="choice", choices=SOAK_KEYS,
                                  help="Vinegar strips its oil and it rusts within a day; salt water about a day; water a few days; dry, weeks (approximate: a modelling choice)"),
                             Prop("from_s", "Set out at", 1.2, 0.0, 20.0, 0.1, "s", "When it starts to rust (run seconds: after a scale has settled)")],
                      tags=["steel wool", "rust", "rusting", "iron", "oxidation", "oxygen", "chemical change", "chemical reaction", "mass", "heavier",
                            "conservation", "new substance", "colour change"],
                      description="A 5 g pad of fine steel wool soaked in vinegar: over days it rusts, turning orange-brown, and because its rust is made of the "
                                  "air's oxygen a kitchen scale under it reads more (half of 5 g rusting: +1.07 g). Rusting gives out a little heat (it starts a few "
                                  "°C warm). Use time_lapse (86400: a run second is a day).",
                      source="4Fe + 3O2 → 2Fe2O3 (0.43 g of oxygen per g of iron; 412 kJ per mol of iron [CRC-H]); how fast it rusts and how much can rust are "
                             "modelling choices (fine wool soaked in vinegar rusts visibly in hours).",
                      anchor="the middle of its bottom", facts="5 g of steel wool soaked in vinegar",
                      readouts=[Readout("rust_pct", "Rusted", "%", 1, "Of its iron"), Readout("gained_g", "Mass gained", "g", 3, "The oxygen its rust took from the air"),
                                Readout("oxygen_ml", "Oxygen used", "mL", 0, "From the air, at 20 °C and 1 atm"), Readout("temp_c", "Temperature", "°C", 1)],
                      module=MODULE))

    def addition_record(key, amount, at):
        words, unit, rho, acetic, citric, hco3, co3, na = ADDITIONS[key]
        kg = (amount * rho if rho > 0 else amount) / 1000
        return {"what": key, "at": round(at, 4), "acetic": _r(acetic * amount, 10), "citric": _r(citric * amount, 10), "hco3": _r(hco3 * amount, 10),
                "co3": _r(co3 * amount, 10), "na": _r(na * amount, 10), "ml": round(amount if rho > 0 else 0.0, 4), "kg": _r(kg, 9)}

    def build_indicator(c, P):
        steps = []
        if P["add"] != "none":
            steps.append(addition_record(P["add"], P["amount"], P["add_at_s"]))
        if P["then_add"] != "none":
            steps.append(addition_record(P["then_add"], P["then_amount"], P["then_at_s"]))
        extra = 0.0
        for s in steps:
            extra += s["kg"]
        base, ballast, hid, depth, water = _beaker(c, P, P["water_ml"], extra, "a beaker of red cabbage juice")
        for k, s in enumerate(steps):
            _weld(c, f"cup{k + 1}", base, 0.03, 0.03, 0.03, BEAKER_R + BEAKER_T + 0.02 + 0.035 * k, 0.015 - BEAKER_B / 2, c.mat(base="cardboard", overrides={}),
                  "cardboard", f"a little cup of {ADDITIONS[s['what']][0]}")
        c.process("matter", "indicator", role="indicator", solid=base, heat=hid, ballast=ballast, water=_r(water, 9), start=round(P["water_temp_c"], 4), extra=_r(extra, 9), steps=steps,
                  fizz=round(P["fizz_s"], 4), capacity=_r(BEAKER_G * 750.0, 6), area=_r(2 * math.pi * BEAKER_R * BEAKER_H, 8))

    register(ItemType("indicator-cup", "Red cabbage indicator", CAT, build_indicator, material="glass", materials=["glass"],
                      props=[Prop("water_ml", "Red cabbage juice", 100.0, 20.0, 200.0, 1.0, "mL", "Purple: neutral (pH 7)"),
                             Prop("water_temp_c", "Juice temperature", 20.0, 0.0, 80.0, 0.5, "°C"),
                             Prop("add", "Add", "vinegar", kind="choice", choices=ADDITION_KEYS, help="Vinegar and lemon juice are acids (red, pink); baking soda and washing soda are bases (blue, green)"),
                             Prop("amount", "Of it", 10.0, 0.1, 100.0, 0.1, "mL or g", "mL of a liquid, g of a powder"),
                             Prop("add_at_s", "Added at", 1.2, 0.0, 20.0, 0.1, "s"),
                             Prop("then_add", "Then add", "none", kind="choice", choices=ADDITION_KEYS, help="A second addition: baking soda after vinegar fizzes and turns it back"),
                             Prop("then_amount", "Of it", 5.0, 0.1, 100.0, 0.1, "mL or g"),
                             Prop("then_at_s", "Then at", 4.0, 0.0, 20.0, 0.1, "s"),
                             Prop("fizz_s", "Fizz lasts about", 3.0, 0.5, 60.0, 0.5, "s", "Lesson seconds for the carbon dioxide made to bubble out")],
                      tags=["indicator", "red cabbage", "acid", "base", "pH", "vinegar", "lemon juice", "baking soda", "washing soda", "colour change",
                            "color change", "chemical change", "chemical reaction", "neutralize", "fizz", "beaker"],
                      description="A 250 mL glass beaker of purple red cabbage juice; a little cup of vinegar, lemon juice, baking soda or washing soda is poured in at a "
                                  "set time and the juice changes colour with its pH: red and pink for acids, purple neutral, blue and green for bases (10 mL of "
                                  "vinegar: pH 2.9, red; 2 g of baking soda: pH 8.3, blue). Baking soda after vinegar fizzes (carbon dioxide) and turns it back.",
                      source="pH from the charge balance with Ka (acetic 1.75e-5; carbonic 4.45e-7, 4.69e-11; citric 7.44e-4, 1.73e-5, 4.02e-7) [CRC]; vinegar 5 % "
                             "[VINEGAR]; lemon juice 48 g/L citric acid [PENNISTON]; red cabbage's colours by pH (approximate, as widely published); heat by ΔfH "
                             "[CRC-H]; ideal solution (no activities: within about 0.2 pH).",
                      anchor="the middle of its base, where it stands", facts="100 mL of red cabbage juice, 10 mL of vinegar at 1.2 s",
                      readouts=[Readout("ph", "pH", "", 2), Readout("color_band", "Colour", "", 0, "0 red, 1 pink, 2 purple, 3 blue, 4 blue-green, 5 green, 6 yellow"),
                                Readout("co2_g", "Gas made", "g", 3), Readout("escaped_g", "Gas escaped", "g", 3), Readout("fizz", "Fizzing", "", 2),
                                Readout("temp_c", "Temperature", "°C", 1),
                                Readout("left_g", "Powder not dissolved", "g", 2, "Past what the juice holds (baking soda 9.6 g, washing soda 21.5 g per 100 g at 20 °C) it stays on the bottom")],
                      module=MODULE))

    def build_precip(c, P):
        cacl2 = P["cacl2_g"] / 1000
        soda = P["soda_g"] / 1000
        base, ballast, hid, depth, water = _beaker(c, P, P["water_ml"], cacl2 + soda, "a beaker of baking soda solution")
        _weld(c, "cup1", base, 0.03, 0.03, 0.03, BEAKER_R + BEAKER_T + 0.02, 0.015 - BEAKER_B / 2, c.mat(base="cardboard", overrides={}), "cardboard",
              "a little cup of calcium chloride")
        c.process("matter", "precip", role="precip", solid=base, heat=hid, ballast=ballast, water=_r(water, 9), start=round(P["water_temp_c"], 4), cacl2=_r(cacl2 / 0.110984, 10),
                  hco3=_r(soda / 0.084007, 10), extra=_r(cacl2 + soda, 9), depth=round(depth, 5), at=round(P["mix_at_s"], 4), react=round(P["react_s"], 4),
                  fizz=round(P["fizz_s"], 4), capacity=_r(BEAKER_G * 750.0, 6), area=_r(2 * math.pi * BEAKER_R * BEAKER_H, 8))
        p = min(cacl2 / 0.110984, soda / 0.084007 / 2)
        P["chalk_g"] = round(p * 100.087, 2)
        P["co2_g"] = round(p * 44.01, 2)

    register(ItemType("reaction-cup", "Precipitate beaker (calcium chloride + baking soda)", CAT, build_precip, material="glass", materials=["glass"],
                      props=[Prop("water_ml", "Water", 100.0, 20.0, 200.0, 1.0, "mL"), Prop("water_temp_c", "Water temperature", 20.0, 0.0, 80.0, 0.5, "°C"),
                             Prop("soda_g", "Baking soda in it", 5.0, 0.1, 20.0, 0.1, "g", "Dissolved in the water from the start"),
                             Prop("cacl2_g", "Calcium chloride", 5.0, 0.1, 30.0, 0.1, "g", "Road salt: poured in from a little cup"),
                             Prop("mix_at_s", "Poured in at", 1.2, 0.0, 20.0, 0.1, "s"),
                             Prop("react_s", "Reacts in about", 2.0, 0.2, 60.0, 0.1, "s", "Lesson seconds for most of the white solid to form"),
                             Prop("fizz_s", "Fizz lasts about", 3.0, 0.5, 60.0, 0.5, "s", "Lesson seconds for the carbon dioxide made to bubble out")],
                      tags=["precipitate", "chemical change", "chemical reaction", "new substance", "calcium chloride", "baking soda", "cloudy", "chalk",
                            "calcium carbonate", "fizz", "bubbles", "gas", "warm", "exothermic", "beaker", "signs of a reaction"],
                      description="A 250 mL glass beaker of clear baking soda solution; calcium chloride poured in at a set time warms it as it dissolves and reacts: "
                                  "a cloudy white solid forms (calcium carbonate, chalk) and carbon dioxide bubbles off, so a kitchen scale under it reads less "
                                  "(5 g + 5 g: 2.98 g of chalk, 1.31 g of gas). The white solid slowly settles to the bottom. Three signs of a chemical change at once.",
                      source="CaCl2 + 2NaHCO3 → CaCO3 + 2NaCl + H2O + CO2 [CRC-H for the heats]; CO2 dissolves to 1.69 g/L before it bubbles [CRC]; the chalk's "
                             "fine grains (about 10 µm) settle by Stokes' law; how cloudy is a modelling choice (about 1 g/L is milky).",
                      anchor="the middle of its base, where it stands", facts="5 g of baking soda in 100 mL, 5 g of calcium chloride at 1.2 s",
                      readouts=[Readout("solid_g", "White solid made", "g", 2), Readout("cloudy", "Cloudy", "", 2, "0 clear, 1 milky"),
                                Readout("settled_g", "Settled on the bottom", "g", 2), Readout("co2_g", "Gas made", "g", 3), Readout("escaped_g", "Gas escaped", "g", 3),
                                Readout("fizz", "Fizzing", "", 2), Readout("temp_c", "Temperature", "°C", 1)], module=MODULE))


# ---------------------------------------------------------------- models of molecules and crystals: molecule, crystal
# element: (CPK colour, covalent radius Å [CORDERO], van der Waals radius Å [BONDI], ionic radius Å [SHANNON] or 0, atomic weight [IUPAC13], name)
ELEMENTS = {
    "H": ("#f2f2f2", 0.31, 1.2, 0.0, 1.008, "hydrogen"),
    "C": ("#2d2d2d", 0.76, 1.7, 0.0, 12.011, "carbon"),
    "N": ("#3a5fd9", 0.71, 1.55, 0.0, 14.007, "nitrogen"),
    "O": ("#e0312b", 0.66, 1.52, 0.0, 15.999, "oxygen"),
    "Na": ("#9b5fd4", 1.66, 2.27, 1.02, 22.99, "sodium"),
    "Cl": ("#3fbf4f", 1.02, 1.75, 1.81, 35.45, "chlorine"),
}
# molecule: (formula, name, atoms [(element, x, y, z) Å: x right, y up, z toward you], bonds [(i, j, order)], bond angle ° or None, bond length Å)
# [CCCBDB]: H2O O–H 0.9572 Å, 104.52° (the H's below); CO2 C=O 1.16 Å; CH4 C–H 1.087 Å, 109.47° (one H up); NH3 N–H 1.012 Å, 106.67°.
MOLECULES = {
    "water": ("H₂O", "water", [("O", 0.0, 0.0, 0.0), ("H", -0.75695, -0.58588, 0.0), ("H", 0.75695, -0.58588, 0.0)], [(0, 1, 1), (0, 2, 1)], 104.52, 0.9572),
    "carbon dioxide": ("CO₂", "carbon dioxide", [("C", 0.0, 0.0, 0.0), ("O", -1.16, 0.0, 0.0), ("O", 1.16, 0.0, 0.0)], [(0, 1, 2), (0, 2, 2)], 180.0, 1.16),
    "methane": ("CH₄", "methane", [("C", 0.0, 0.0, 0.0), ("H", 0.0, 1.087, 0.0), ("H", 1.02483, -0.36233, 0.0), ("H", -0.51242, -0.36233, 0.88753),
                                     ("H", -0.51242, -0.36233, -0.88753)], [(0, 1, 1), (0, 2, 1), (0, 3, 1), (0, 4, 1)], 109.47, 1.087),
    "ammonia": ("NH₃", "ammonia", [("N", 0.0, 0.0, 0.0), ("H", 0.93735, -0.38148, 0.0), ("H", -0.46867, -0.38148, 0.81177), ("H", -0.46867, -0.38148, -0.81177)],
                [(0, 1, 1), (0, 2, 1), (0, 3, 1)], 106.67, 1.012),
    "oxygen": ("O₂", "oxygen", [("O", -0.60375, 0.0, 0.0), ("O", 0.60375, 0.0, 0.0)], [(0, 1, 2)], None, 1.2075),
    "nitrogen": ("N₂", "nitrogen", [("N", -0.54885, 0.0, 0.0), ("N", 0.54885, 0.0, 0.0)], [(0, 1, 3)], None, 1.0977),
    "hydrogen": ("H₂", "hydrogen", [("H", -0.3707, 0.0, 0.0), ("H", 0.3707, 0.0, 0.0)], [(0, 1, 1)], None, 0.7414),
}
MOLECULE_KEYS = list(MOLECULES)
LATTICES = {"salt": ("NaCl", "a salt (sodium chloride) crystal"), "diamond": ("C", "a diamond crystal (carbon)"), "ice": ("H₂O", "ice (frozen water)")}
LATTICE_KEYS = list(LATTICES)
STYLES = ["ball-and-stick", "space-filling"]
SQRT3 = 1.7320508075688772


def _atom_radius(el, style, crystal):
    """A ball's radius, Å: ball-and-stick 0.6 × the covalent radius (0.5 × the ionic one for ions); space-filling the van der Waals radius in a
    molecule, the covalent (ionic) radius in a crystal (where the atoms touch)."""
    _col, cov, vdw, ion, _w, _n = ELEMENTS[el]
    if style == "space-filling":
        return (ion if ion > 0 else cov) if crystal else vdw
    return 0.5 * ion if ion > 0 else 0.6 * cov


def _crystal_atoms(lattice, n):
    """A crystal's atoms [(element, x, y, z) Å], bonds [(i, j, order)] (order 0: a hydrogen bond) and each atom's column key (atoms with one key
    stand one behind another: one ball of the physics outline). Salt: (2n+1)³ ions 2.82 Å apart; diamond: n×n×n cubic cells (a = 3.5668 Å);
    ice: one puckered layer of 2n rows × n hexagons (O–O 2.76 Å, O–H 1.00 Å, ice rules)."""
    atoms, bonds, keys = [], [], []
    if lattice == "salt":
        s = 2.82
        m = 2 * n + 1
        index = {}
        for i in range(m):
            for j in range(m):
                for k in range(m):
                    index[(i, j, k)] = len(atoms)
                    atoms.append(("Na" if (i + j + k) % 2 == 0 else "Cl", (i - n) * s, (j - n) * s, (k - n) * s))
                    keys.append(i * m + j)
        for (i, j, k), a in index.items():
            for di, dj, dk in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
                b = index.get((i + di, j + dj, k + dk))
                if b is not None:
                    bonds.append((a, b, 1))
    elif lattice == "diamond":
        q4 = 3.5668 / 4
        basis = [(0, 0, 0), (0, 2, 2), (2, 0, 2), (2, 2, 0), (1, 1, 1), (1, 3, 3), (3, 1, 3), (3, 3, 1)]
        index = {}
        for cx in range(n):
            for cy in range(n):
                for cz in range(n):
                    for bx, by, bz in basis:
                        q = (4 * cx + bx, 4 * cy + by, 4 * cz + bz)
                        index[q] = len(atoms)
                        atoms.append(("C", (q[0] - 2 * n) * q4, (q[1] - 2 * n) * q4, (q[2] - 2 * n) * q4))
                        keys.append(q[0] * (4 * n + 4) + q[1])
        for (x, y, z), a in index.items():
            if (x + y + z) % 4 == 0:      # (the first sublattice: its four bonds go to the other's atoms at ±(1, 1, 1) quarter steps)
                for dx, dy, dz in ((1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1)):
                    b = index.get((x + dx, y + dy, z + dz))
                    if b is not None:
                        bonds.append((a, b, 1))
    else:
        d = math.sqrt(2.76 * 2.76 - 0.92 * 0.92)
        oh = 1.0
        rows, cols = 2 * n, n
        site = {}
        for j in range(rows):
            for i in range(cols):
                x = SQRT3 * d * (i + 0.5 * (j % 2))
                site[("A", i, j)] = (x, 1.5 * d * j, 0.46)
                site[("B", i, j)] = (x, 1.5 * d * j + d, -0.46)
        cx = SQRT3 * d * (cols - 0.5) / 2
        cy = (1.5 * d * (rows - 1) + d) / 2
        index = {}
        for key, (x, y, z) in site.items():
            index[key] = len(atoms)
            atoms.append(("O", x - cx, y - cy, z))
            keys.append(len(keys))

        def h_toward(a, p, q):
            # an H on the bond from O at p toward q, 1.00 Å from p; it bonds to a, and by a hydrogen bond to q's O when q is in the layer
            dx, dy, dz = q[0] - p[0], q[1] - p[1], q[2] - p[2]
            ln = math.sqrt(dx * dx + dy * dy + dz * dz)
            h = len(atoms)
            atoms.append(("H", p[0] + dx * oh / ln - cx, p[1] + dy * oh / ln - cy, p[2] + dz * oh / ln))
            keys.append(len(keys))
            bonds.append((a, h, 1))
            return h

        for j in range(rows):
            for i in range(cols):
                A, B = ("A", i, j), ("B", i, j)
                pa, pb = site[A], site[B]
                h = h_toward(index[A], pa, pb)
                bonds.append((h, index[B], 0))
                # (the A site's other H points up, out of the layer, to the layer above: it stands right in front of its O)
                atoms.append(("H", pa[0] - cx, pa[1] - cy, pa[2] + oh))
                keys.append(keys[index[A]])
                bonds.append((index[A], len(atoms) - 1, 1))
                for di in ((0, -1) if j % 2 == 0 else (0, 1)):
                    up = (SQRT3 * d * (i + di + 0.5 * ((j + 1) % 2)), 1.5 * d * (j + 1), 0.46)
                    h2 = h_toward(index[B], pb, up)
                    other = index.get(("A", i + di, j + 1))
                    if other is not None:
                        bonds.append((h2, other, 0))
    return atoms, bonds, keys


def _model_layout(atoms, style, crystal, scale):
    """Every atom of a model in the item's frame (m): [(element, x, y, z, radius)], resting on its anchor (the lowest ball's bottom at y = 0) and
    centred across."""
    rad = [_atom_radius(a[0], style, crystal) * scale for a in atoms]
    lo = min(a[2] * scale - r for a, r in zip(atoms, rad))
    x0 = min(a[1] * scale - r for a, r in zip(atoms, rad))
    x1 = max(a[1] * scale + r for a, r in zip(atoms, rad))
    xm = (x0 + x1) / 2
    return [(a[0], a[1] * scale - xm, a[2] * scale - lo, a[3] * scale, r) for a, r in zip(atoms, rad)]


def _build_atoms(c, P, layout, keys, bonds, readings, words):
    """The model's balls: one per column of atoms (the first atom of each, as big as the biggest in it), the first the root and the rest
    welded to it; the model plastic's density makes the balls' mass that of every ball of the model. The view draws every atom and bond."""
    first = {}
    for k, key in enumerate(keys):
        if key not in first:
            first[key] = k
    big = {}
    for k, key in enumerate(keys):
        big[key] = max(big.get(key, 0.0), layout[k][4])
    whole = 0.0
    for a in layout:
        whole += a[4] * a[4] * a[4]
    shown = 0.0
    for key, k in first.items():
        shown += big[key] * big[key] * big[key]
    m = c.mat(base="model plastic", density=round(1050.0 * whole / shown, 4), overrides={})
    root = None
    rx = ry = 0.0
    for key, k in first.items():
        el, x, y, z, r = layout[k]
        color = ELEMENTS[el][0]
        name = f"a{k + 1}"
        if root is None:
            root = c.ball(name, round(big[key], 5), round(x, 5), round(y, 5), material=m, look="atom plastic", words=f"{words}: a {ELEMENTS[el][5]} atom",
                          fill=color, color=color)
            rx, ry = round(x, 5), round(y, 5)
        else:
            s = {"kind": c.kind, "id": f"{c.item['id']}/{name}", "words": f"{words}: a {ELEMENTS[el][5]} atom", "item": c.item["id"], "look": "atom plastic",
                 "body": {"kind": "ball", "radius": round(big[key], 5)}, "material": m, "at": {"x": round(round(x, 5) - rx, 5), "y": round(round(y, 5) - ry, 5)},
                 "parent": root, "placeholder": {"fill": color}, "render": {"kind": "procedural", "shade": LOOK_SHADE["atom plastic"]}, "depth": 4, "color": color}
            c.sb.solids.append(s)
    c.process("matter", "atoms", role="atoms", readings=readings, atoms=len(layout), bonds=len([b for b in bonds if b[2] > 0]))
    return root


def _atom_types():
    def build_molecule(c, P):
        formula, name, atoms, bonds, angle, length = MOLECULES[P["molecule"]]
        layout = _model_layout(atoms, P["style"], False, P["scale_cm"] / 100)
        mass = 0.0
        for a in atoms:
            mass += ELEMENTS[a[0]][4]
        readings = {"atoms": len(atoms), "bonds": len(bonds), "mass_u": round(mass, 3), "bond_length_pm": round(length * 100, 2)}
        if angle is not None:
            readings["bond_angle_deg"] = angle
        _build_atoms(c, P, layout, list(range(len(atoms))), bonds, readings, f"a model of a {name} molecule")
        P["formula"] = formula

    register(ItemType("molecule", "Molecule model", CAT, build_molecule, material="model plastic", materials=["model plastic"],
                      props=[Prop("molecule", "Molecule", "water", kind="choice", choices=MOLECULE_KEYS,
                                  help="Water (bent, 104.5°), carbon dioxide (straight), methane (a tetrahedron), ammonia (a pyramid), oxygen, nitrogen, hydrogen"),
                             Prop("style", "Style", "ball-and-stick", kind="choice", choices=STYLES, help="Balls and sticks, or space-filling (each atom as big as it really reaches)"),
                             Prop("scale_cm", "Model scale", 2.5, 0.5, 10.0, 0.1, "cm per Å", "How big the model is drawn: an ångström is 10⁻¹⁰ m"),
                             Prop("labels", "Label", True, kind="bool", help="Its formula and name over it")],
                      tags=["molecule", "atom", "atoms", "model", "ball and stick", "space filling", "water", "H2O", "carbon dioxide", "CO2", "methane", "CH4",
                            "ammonia", "NH3", "oxygen", "O2", "nitrogen", "N2", "hydrogen", "bond", "particle", "MS-PS1-1"],
                      description="A ball-and-stick (or space-filling) model of one molecule in the model kit's colours (hydrogen white, carbon black, nitrogen blue, "
                                  "oxygen red), its atoms as far apart and at the angles the real molecule's are (water bent at 104.5°, carbon dioxide straight, "
                                  "methane a tetrahedron), scaled up: 2.5 cm for every ångström (10⁻¹⁰ m). A model: it rests on a table like a model kit's.",
                      source="Bond lengths and angles [CCCBDB]; ball sizes from covalent radii [CORDERO] and van der Waals radii [BONDI]; colours CPK; atomic "
                             "weights [IUPAC13].",
                      anchor="the bottom of its lowest atom, where it rests", facts="a ball-and-stick water molecule, 2.5 cm per Å",
                      readouts=[Readout("atoms", "Atoms", "", 0), Readout("bonds", "Bonds", "", 0), Readout("mass_u", "Molecular mass", "u", 2),
                                Readout("bond_length_pm", "Bond length", "pm", 1), Readout("bond_angle_deg", "Bond angle", "°", 1)], module=MODULE))

    def build_crystal(c, P):
        lattice = P["lattice"]
        formula, words = LATTICES[lattice]
        n = int(P["cells"])
        atoms, bonds, keys = _crystal_atoms(lattice, n)
        layout = _model_layout(atoms, P["style"], True, P["scale_cm"] / 100)
        counts = {}
        for a in atoms:
            counts[a[0]] = counts.get(a[0], 0) + 1
        readings = {"atoms": len(atoms), "cells": n}
        for el, key in (("Na", "sodium"), ("Cl", "chloride"), ("C", "carbon"), ("O", "oxygen"), ("H", "hydrogen")):
            if el in counts:
                readings[key] = counts[el]
        _build_atoms(c, P, layout, keys, bonds, readings, f"a model of {words}")
        P["formula"] = formula

    register(ItemType("crystal", "Crystal model", CAT, build_crystal, material="model plastic", materials=["model plastic"],
                      props=[Prop("lattice", "Crystal", "salt", kind="choice", choices=LATTICE_KEYS,
                                  help="Salt: sodium and chloride ions in a cube pattern; diamond: every carbon bonded to four; ice: water molecules in open hexagons"),
                             Prop("cells", "Size", 2, 1, 4, 1, "cells", "How many repeats of the pattern along each side", kind="int"),
                             Prop("style", "Style", "ball-and-stick", kind="choice", choices=STYLES),
                             Prop("scale_cm", "Model scale", 1.2, 0.3, 5.0, 0.1, "cm per Å"),
                             Prop("labels", "Label", True, kind="bool", help="Its formula and name over it")],
                      tags=["crystal", "lattice", "salt", "sodium chloride", "NaCl", "ions", "diamond", "carbon", "ice", "hexagonal", "atoms", "model",
                            "structure", "repeating pattern", "MS-PS1-1"],
                      description="A model of a crystal: a salt crystal's sodium (purple) and chloride (green) ions in a repeating cube pattern, a diamond's carbon "
                                  "atoms each bonded to four, or ice's water molecules held in open hexagons by hydrogen bonds (why ice floats). Scaled up 1.2 cm per "
                                  "ångström; the cells prop sets how many repeats.",
                      source="NaCl a = 5.640 Å, ionic radii Na+ 1.02, Cl− 1.81 Å [CRC; SHANNON]; diamond a = 3.5668 Å [CRC]; ice Ih O–O 2.76 Å, O–H 1.00 Å "
                             "(Petrenko & Whitworth, Physics of Ice, 1999).",
                      anchor="the bottom of its lowest atom, where it rests", facts="a salt crystal 5 ions along each edge (125 ions)",
                      readouts=[Readout("atoms", "Atoms", "", 0), Readout("cells", "Repeats", "", 0), Readout("sodium", "Sodium ions", "", 0),
                                Readout("chloride", "Chloride ions", "", 0), Readout("carbon", "Carbon atoms", "", 0), Readout("oxygen", "Oxygen atoms", "", 0),
                                Readout("hydrogen", "Hydrogen atoms", "", 0)], module=MODULE))


# ---------------------------------------------------------------- goal kinds (web/sim/modules/matter.js reports the same, number for number)
def _trim(v):
    t = f"{v:.2f}".rstrip("0").rstrip(".")
    return t


def _settled(times, values, t0, t1):
    """The mean of a reading over the frames from t0 to t1 (s), or None when none falls there."""
    total, n = 0.0, 0
    for t, v in zip(times, values):
        if t0 <= t <= t1 and v is not None:
            total += v
            n += 1
    return total / n if n else None


def _scale_change(ctx, g):
    """A kitchen scale's reading at rest after the release and at the end, g: (start, end) or None. At rest: the mean over 0.5-0.6 s
    after the release (the scale has settled: its reading closes in with a time of about 0.05 s), and over the last 0.3 s of the run."""
    v = ctx.state(g.get("scale"), "grams")
    if v is None or not ctx.times:
        return None
    rel = float(ctx.scene.get("release", 0.5)) if isinstance(ctx.scene.get("release", 0.5), (int, float)) else 0.5
    end = ctx.times[-1]
    a = _settled(ctx.times, v, rel + 0.5, rel + 0.6)
    b = _settled(ctx.times, v, end - 0.3, end)
    if a is None or b is None:
        return None
    return a, b


def goal_mass_same(ctx, g):
    """{kind: "mass_same", scale, tol_g?}: the kitchen scale reads the same (within tol_g, default 1 g) at rest after the release and at the end."""
    if not ctx.known(g.get("scale")):
        return None
    tol = ctx.num(g.get("tol_g"))
    tol = 1.0 if tol is None else tol
    ab = _scale_change(ctx, g)
    ok = ab is not None and abs(ab[1] - ab[0]) <= tol
    out = {"label": g.get("label") or f"{ctx.name(g['scale'])} reads the same before and after", "ok": ok, "kind": "mass_same", "scale": g["scale"]}
    if ab is not None:
        out["start_g"], out["end_g"] = round(ab[0], 2), round(ab[1], 2)
    return out


def goal_mass_changes(ctx, g):
    """{kind: "mass_changes", scale, by_g, tol_g?}: the scale's reading at the end differs from its reading at rest after the release by by_g
    (negative: it went down) within tol_g (default 0.2 g or a tenth of by_g, whichever is more)."""
    if not ctx.known(g.get("scale")):
        return None
    by = ctx.num(g.get("by_g"))
    if by is None:
        return None
    tol = ctx.num(g.get("tol_g"))
    tol = max(0.2, abs(by) / 10) if tol is None else tol
    ab = _scale_change(ctx, g)
    ok = ab is not None and abs((ab[1] - ab[0]) - by) <= tol
    sign = "+" if by >= 0 else "−"
    out = {"label": g.get("label") or f"{ctx.name(g['scale'])} changes by {sign}{_trim(abs(by))} g", "ok": ok, "kind": "mass_changes", "scale": g["scale"]}
    if ab is not None:
        out["change_g"] = round(ab[1] - ab[0], 2)
    return out


def _dissolved_at(ctx, iid):
    """When item iid's crystals were all dissolved (left under 1 % of what was put in, or under 5 mg), s, or None."""
    left = ctx.state(iid, "left_g")
    gone = ctx.state(iid, "dissolved_g")
    if left is None or gone is None:
        return None
    for t, a, b in zip(ctx.times, left, gone):
        if a is not None and b is not None and b > 0 and a <= max(0.005, 0.01 * (a + b)):
            return t
    return None


def goal_dissolves(ctx, g):
    """{kind: "dissolves", item, before_s?}: everything put into the glass dissolves (by before_s if given)."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "left_g") is None:
        return None
    by = ctx.num(g.get("before_s"))
    t = _dissolved_at(ctx, iid)
    when = "" if by is None else f" by {_trim(by)} s"
    return {"label": g.get("label") or f"what is in {ctx.name(iid)} dissolves{when}", "ok": t is not None and (by is None or t <= by), "kind": "dissolves",
            "item": iid, "t": None if t is None else round(t, 3)}


def goal_dissolves_first(ctx, g):
    """{kind: "dissolves_first", a, b}: glass a's crystals are all dissolved before glass b's (b never: a must; neither: a has the larger share
    dissolved at the end)."""
    a, b = g.get("a"), g.get("b")
    if not ctx.known(a) or not ctx.known(b) or ctx.state(a, "dissolved_pct") is None or ctx.state(b, "dissolved_pct") is None:
        return None
    ta, tb = _dissolved_at(ctx, a), _dissolved_at(ctx, b)
    if ta is not None:
        ok = tb is None or ta < tb
    elif tb is not None:
        ok = False
    else:
        ok = ctx.state(a, "dissolved_pct")[-1] > ctx.state(b, "dissolved_pct")[-1]
    return {"label": g.get("label") or f"{ctx.name(a)} dissolves before {ctx.name(b)}", "ok": ok, "kind": "dissolves_first", "a": a, "b": b,
            "ta": None if ta is None else round(ta, 3), "tb": None if tb is None else round(tb, 3)}


STATES = ["solid", "liquid", "gas", "melting", "boiling"]


def goal_state(ctx, g):
    """{kind: "state", item, is}: at the end the particle box's sample is `is`: solid, liquid or gas (all of it), melting (part solid, part
    liquid) or boiling (part liquid, part gas)."""
    iid, want = g.get("item"), g.get("is")
    if not ctx.known(iid) or want not in STATES or ctx.state(iid, "solid_pct") is None:
        return None
    s, l, v = ctx.state(iid, "solid_pct")[-1], ctx.state(iid, "liquid_pct")[-1], ctx.state(iid, "gas_pct")[-1]
    now = "solid" if s >= 99.5 else "liquid" if l >= 99.5 else "gas" if v >= 99.5 else "melting" if s > 0 and l > 0 else "boiling" if l > 0 and v > 0 else "mixed"
    return {"label": g.get("label") or f"{ctx.name(iid)} ends {want}", "ok": now == want, "kind": "state", "item": iid, "now": now}


def goal_separates(ctx, g):
    """{kind: "separates", item}: the mixture is separated: in a sieve the first part (the smaller grains) is at least 95 % through and the
    second at most 5 %; in a dish with a magnet the second part (the iron) is at least 90 % out and the first at most 5 %; in a filter funnel
    at least 95 % of the undissolved solid is kept on the paper and at least 80 % of the water has run through."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    kp, fp = ctx.state(iid, "kept_pct"), ctx.state(iid, "filtrate_pct")
    if kp is not None and fp is not None:
        ok = kp[-1] >= 95 and fp[-1] >= 80
        return {"label": g.get("label") or f"{ctx.name(iid)} separates its mixture", "ok": ok, "kind": "separates", "item": iid,
                "a_pct": round(kp[-1], 1), "b_pct": round(fp[-1], 1)}
    ap, bp = ctx.state(iid, "a_passed_pct"), ctx.state(iid, "b_passed_pct")
    if ap is not None and bp is not None:
        ok = ap[-1] >= 95 and bp[-1] <= 5
        return {"label": g.get("label") or f"{ctx.name(iid)} separates its mixture", "ok": ok, "kind": "separates", "item": iid,
                "a_pct": round(ap[-1], 1), "b_pct": round(bp[-1], 1)}
    al, bl = ctx.state(iid, "a_left_pct"), ctx.state(iid, "b_left_pct")
    if al is None or bl is None:
        return None
    ok = 100 - bl[-1] >= 90 and 100 - al[-1] <= 5
    return {"label": g.get("label") or f"{ctx.name(iid)} separates its mixture", "ok": ok, "kind": "separates", "item": iid,
            "a_pct": round(100 - al[-1], 1), "b_pct": round(100 - bl[-1], 1)}


def goal_mixes(ctx, g):
    """{kind: "mixes", item, at_least?}: the particle box's two sides end mixed at least `at_least` % (default 80). The box mixes on a model
    clock (a few run seconds whatever the time-lapse; real gases take about L²/2D: a 20 cm box half an hour)."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "mixed_pct") is None:
        return None
    least = ctx.num(g.get("at_least"))
    least = 80.0 if least is None else least
    v = ctx.state(iid, "mixed_pct")[-1]
    return {"label": g.get("label") or f"{ctx.name(iid)} mixes", "ok": v >= least, "kind": "mixes", "item": iid, "mixed_pct": round(v, 1)}


def goal_saturates(ctx, g):
    """{kind: "saturates", item}: at the end the glass's water holds all it can and crystals are left on the bottom."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "saturated") is None:
        return None
    v = ctx.state(iid, "saturated")[-1]
    left = ctx.state(iid, "left_g")[-1]
    return {"label": g.get("label") or f"{ctx.name(iid)} ends saturated with some left over", "ok": v >= 0.5, "kind": "saturates", "item": iid,
            "left_g": round(left, 2)}


def _end_mean(ctx, iid, key, span=0.5):
    """A reading's mean over the run's last `span` seconds (a gauge on a few particles flickers), or None."""
    v = ctx.state(iid, key)
    if v is None or not ctx.times:
        return None
    end = ctx.times[-1]
    return _settled(ctx.times, v, end - span, end)


def goal_pressure(ctx, g):
    """{kind: "pressure", item, kpa, tol_kpa?}: the particle box's or syringe's gauge reads kpa (within tol_kpa, default 10 % of it) at the end
    (its mean over the last second); the reading is the real sample's nRT/V."""
    iid = g.get("item")
    want = ctx.num(g.get("kpa"))
    if not ctx.known(iid) or want is None or ctx.state(iid, "pressure_kpa") is None:
        return None
    tol = ctx.num(g.get("tol_kpa"))
    tol = abs(want) * 0.1 if tol is None else tol
    v = _end_mean(ctx, iid, "pressure_kpa", 1.0)
    return {"label": g.get("label") or f"{ctx.name(iid)} reads {_trim(want)} kPa", "ok": v is not None and abs(v - want) <= tol, "kind": "pressure",
            "item": iid, "kpa": None if v is None else round(v, 1)}


def goal_volume(ctx, g):
    """{kind: "volume", item, ml, tol_ml?}: the gas's volume (a particle box's or syringe's volume_ml, a balloon's volume_l × 1000) is ml
    (within tol_ml, default 5 % of it) at the end."""
    iid = g.get("item")
    want = ctx.num(g.get("ml"))
    if not ctx.known(iid) or want is None:
        return None
    if ctx.state(iid, "volume_ml") is not None:
        v = _end_mean(ctx, iid, "volume_ml")
    elif ctx.state(iid, "volume_l") is not None:
        v = ctx.state(iid, "volume_l")[-1] * 1000
    else:
        return None
    tol = ctx.num(g.get("tol_ml"))
    tol = abs(want) * 0.05 if tol is None else tol
    return {"label": g.get("label") or f"{ctx.name(iid)} ends at {_trim(want)} mL", "ok": v is not None and abs(v - want) <= tol, "kind": "volume",
            "item": iid, "ml": None if v is None else round(v, 1)}


def goal_crystallizes(ctx, g):
    """{kind: "crystallizes", item, g?, tol_g?}: at the end the evaporating dish holds g grams of crystals (default: all that was dissolved in it)
    within tol_g (default 2 % of it, at least 0.05 g)."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    cr, dis = ctx.state(iid, "crystals_g"), ctx.state(iid, "dissolved_g")
    if cr is None or dis is None:
        return None
    want = ctx.num(g.get("g"))
    want = cr[-1] + dis[-1] if want is None else want
    tol = ctx.num(g.get("tol_g"))
    tol = max(0.05, abs(want) * 0.02) if tol is None else tol
    return {"label": g.get("label") or f"{ctx.name(iid)} leaves {_trim(want)} g of crystals", "ok": abs(cr[-1] - want) <= tol, "kind": "crystallizes",
            "item": iid, "crystals_g": round(cr[-1], 2)}


TEMP_KEYS = ("temp_c", "reading", "water_temp", "temp")   # an item's temperature: this module's, a thermometer's, a cup's water, a heat body's
COLOR_WORDS = {"violet": "purple", "magenta": "pink", "teal": "blue-green", "turquoise": "blue-green", "cloudy": "white", "milky": "white",
               "rust": "brown", "rusty": "brown", "orange": "brown", "orange-brown": "brown"}


def _temps(ctx, iid):
    """An item's temperature readings (°C, the frames that have one), by the first of TEMP_KEYS it has, or None."""
    for key in TEMP_KEYS:
        v = ctx.state(iid, key)
        if v is not None:
            vals = [x for x in v if x is not None]
            if vals:
                return vals
    return None


def goal_warms_by(ctx, g):
    """{kind: "warms_by", item, at_least_c}: the item's temperature (its temp_c; a thermometer's reading; a cup's water) rises at least at_least_c
    above where it starts (its highest reading against its first)."""
    iid = g.get("item")
    least = ctx.num(g.get("at_least_c"))
    if not ctx.known(iid) or least is None:
        return None
    v = _temps(ctx, iid)
    if v is None:
        return None
    rise = max(v) - v[0]
    return {"label": g.get("label") or f"{ctx.name(iid)} warms by at least {_trim(least)} °C", "ok": rise >= least, "kind": "warms_by", "item": iid,
            "change_c": round(rise, 2)}


def goal_cools_by(ctx, g):
    """{kind: "cools_by", item, at_least_c}: the item's temperature falls at least at_least_c below where it starts (its lowest against its first)."""
    iid = g.get("item")
    least = ctx.num(g.get("at_least_c"))
    if not ctx.known(iid) or least is None:
        return None
    v = _temps(ctx, iid)
    if v is None:
        return None
    drop = v[0] - min(v)
    return {"label": g.get("label") or f"{ctx.name(iid)} cools by at least {_trim(least)} °C", "ok": drop >= least, "kind": "cools_by", "item": iid,
            "change_c": round(drop, 2)}


def goal_color_changes(ctx, g):
    """{kind: "color_changes", item, to?}: the item's colour changes: an indicator's colour is at some moment another than at the start (to: and
    the end's colour is that one: red, pink, purple, blue, blue-green, green or yellow; vinegar then baking soda: red, then purple again); a
    precipitate beaker goes from clear (cloudy under 0.1) to cloudy white (0.5 or more at some moment; to: white); steel wool rusts orange-brown
    (5 % or more of it at the end; to: brown)."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    to = g.get("to")
    want = None
    if isinstance(to, str) and to.strip():
        w = to.strip().lower()
        want = COLOR_WORDS.get(w, w)
    band, cloudy, rust = ctx.state(iid, "color_band"), ctx.state(iid, "cloudy"), ctx.state(iid, "rust_pct")
    label = g.get("label") or f"{ctx.name(iid)} changes colour" + (f" to {want}" if want else "")
    if band is not None:
        v = [x for x in band if x is not None]
        if not v:
            return None
        a, b = min(6, max(0, int(v[0]))), min(6, max(0, int(v[-1])))
        changed = any(int(x) != int(v[0]) for x in v)
        now = BAND_NAMES[b]
        return {"label": label, "ok": changed and (want is None or want == now), "kind": "color_changes", "item": iid, "was": BAND_NAMES[a], "now": now}
    if cloudy is not None:
        v = [x for x in cloudy if x is not None]
        if not v:
            return None
        turned = v[0] < 0.1 and max(v) >= 0.5
        return {"label": label, "ok": turned and (want is None or want == "white"), "kind": "color_changes", "item": iid, "was": "clear" if v[0] < 0.1 else "cloudy",
                "now": "cloudy white" if max(v) >= 0.5 else "clear"}
    if rust is not None:
        v = [x for x in rust if x is not None]
        if not v:
            return None
        return {"label": label, "ok": v[-1] >= 5 and (want is None or want == "brown"), "kind": "color_changes", "item": iid, "was": "grey",
                "now": "orange-brown" if v[-1] >= 5 else "grey"}
    return None


HOLD_PHASES = {"melting": "melting", "melts": "melting", "melt": "melting", "boiling": "boiling", "boils": "boiling", "boil": "boiling"}


def _phase_frames(ctx, iid, phase):
    """(per frame: whether item iid is `phase`, per frame: its temperature °C) or None when it has no such readings. A particle box: melting =
    solid and liquid both there, boiling = liquid and gas both there; heat's ice cube or meltable: melting = 0 < melted < 1 (its temp); a
    saucepan, kettle or evaporating dish: boiling = its boiling reading (its water_temp or temp_c)."""
    s, l, v = ctx.state(iid, "solid_pct"), ctx.state(iid, "liquid_pct"), ctx.state(iid, "gas_pct")
    if s is not None and l is not None and v is not None:
        a, b = (s, l) if phase == "melting" else (l, v)
        return [x is not None and y is not None and x > 0 and y > 0 for x, y in zip(a, b)], ctx.state(iid, "temp_c")
    if phase == "melting" and ctx.state(iid, "melted") is not None:
        return [x is not None and 0 < x < 1 for x in ctx.state(iid, "melted")], ctx.state(iid, "temp")
    if phase == "boiling" and ctx.state(iid, "boiling") is not None:
        temps = ctx.state(iid, "water_temp") if ctx.state(iid, "water_temp") is not None else ctx.state(iid, "temp_c")
        return [x is not None and x >= 0.5 for x in ctx.state(iid, "boiling")], temps
    return None


def goal_holds_at(ctx, g):
    """{kind: "holds_at", item, temp_c, while: melting | boiling, tol_c?}: a heating curve's plateau: while the item melts (or boils) its
    temperature stays at temp_c within tol_c (default 0.5 °C), and it does melt (boil) for at least two frames. A particle box's sample,
    heat's ice cube or meltable, a saucepan's, kettle's or evaporating dish's water."""
    iid = g.get("item")
    phase = HOLD_PHASES.get(str(g.get("while") or "").strip().lower())
    want = ctx.num(g.get("temp_c"))
    if not ctx.known(iid) or phase is None or want is None:
        return None
    pf = _phase_frames(ctx, iid, phase)
    if pf is None or pf[1] is None:
        return None
    tol = ctx.num(g.get("tol_c"))
    tol = 0.5 if tol is None else abs(tol)
    ts = [(t, x) for t, on, x in zip(ctx.times, pf[0], pf[1]) if on and x is not None]
    verb = "melts" if phase == "melting" else "boils"
    out = {"label": g.get("label") or f"{ctx.name(iid)} stays at {_trim(want)} °C while it {verb}", "ok": False, "kind": "holds_at", "item": iid, "while": phase}
    if ts:
        lo, hi = min(x for _, x in ts), max(x for _, x in ts)
        out["ok"] = len(ts) >= 2 and abs(lo - want) <= tol and abs(hi - want) <= tol
        out["from_s"], out["until_s"], out["low_c"], out["high_c"] = round(ts[0][0], 3), round(ts[-1][0], 3), round(lo, 2), round(hi, 2)
    return out


def _matter_warnings(scene, doc):
    """Before the run (items.py WARNING_HOOKS): a particle box packed tighter than its substance can be (it is given what fits), a syringe
    pushed in so far that holding it takes more than a hand gives, an evaporating dish in a vacuum (refused: the engine leaves it as it is)."""
    air = (doc.get("settings") or {}).get("air", True) is not False
    out = []
    for it in scene.get("items", []):
        if not isinstance(it, dict) or it.get("type") not in ("particle-box", "syringe", "evaporating-dish") or it.get("type") not in TYPES:
            continue
        P = props_of(it)
        name = it.get("name") or it.get("id")
        if it["type"] == "particle-box" and P["sample_g"] / 1000 > _box_sample(P):
            out.append({"items": [it["id"]], "text": f"{name}: {_trim(P['sample_g'])} g of {P['substance']} cannot fit in {_trim(P['volume_ml'])} mL (no "
                                                    f"tighter than its solid or liquid): it holds {_trim(_box_sample(P) * 1000)} g"})
        if it["type"] == "syringe" and P["push_to_ml"] > 0:
            force = (ATM * P["start_ml"] / P["push_to_ml"] - (ATM if air else 0.0)) * SYRINGE_AREA
            if abs(force) > PUSH_SAID:
                out.append({"items": [it["id"]], "text": f"{name}: holding its plunger at {_trim(P['push_to_ml'])} mL takes about {_trim(round(abs(force)))} N "
                                                        f"(the weight of {_trim(round(abs(force) / 9.81))} kg): more than one hand pushes"})
        if it["type"] == "evaporating-dish" and not air:
            out.append({"items": [it["id"]], "text": f"{name} needs air: in a vacuum its water would boil at room temperature and freeze, which this model "
                                                    f"does not show, so nothing evaporates (turn the air on)"})
    return out


def _goals():
    register_goal_kind("mass_same", goal_mass_same)
    register_goal_kind("mass_changes", goal_mass_changes)
    register_goal_kind("dissolves", goal_dissolves)
    register_goal_kind("dissolves_first", goal_dissolves_first)
    register_goal_kind("state", goal_state)
    register_goal_kind("separates", goal_separates)
    register_goal_kind("mixes", goal_mixes)
    register_goal_kind("saturates", goal_saturates)
    register_goal_kind("pressure", goal_pressure)
    register_goal_kind("volume", goal_volume)
    register_goal_kind("crystallizes", goal_crystallizes)
    register_goal_kind("warms_by", goal_warms_by)
    register_goal_kind("cools_by", goal_cools_by)
    register_goal_kind("color_changes", goal_color_changes)
    register_goal_kind("holds_at", goal_holds_at)
