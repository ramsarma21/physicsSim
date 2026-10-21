"""Magnetism and static electricity (the physics module "magnetism"): permanent magnets (bar, horseshoe, disc, a stack of ring magnets on
a dowel, a magnet on a cart), soft iron and steel that magnets pull (paper clips, nails, washers, a steel can, the catalog's steel balls and
weights), things they do not pull (a plastic clip, aluminium foil, copper wire, a brass key, a wooden bead; coins, aluminium cans, glass,
wood), a compass, sheets to put between, and static electricity (a rubbed balloon, scraps of paper, a charged rod, a pith ball).

items.py imports this file (machines/mod_<name>.py, in name order) and calls register_all(globals()); web/sim/modules/magnetism.js is its
exact port (the same numbers, number for number). Each magnetic or charged part becomes one record of the engine's process kind "magnetism"
(tooling/src/sim/modules/magnetism.ts; the physics is tooling/src/sim/magnetism.ts):
  {role: "magnet", solid, faces: [{x, y, z?, angle, width, depth, sigma}]}   a permanent magnet: its pole faces, σ = B_r/µ0 (A/m, + north)
  {role: "soft", solid, x, y, w, h, d, volume, ms, chi, round?}             soft iron/steel: the block its magnetization fills, its steel's
                                                                            volume, saturation M_s (A/m) and initial susceptibility
  {role: "earth", x, y}                                                     the Earth's field in the machine plane (T)
  {role: "charge", solid, x, y, q, radius, capacitance, conductor?, grounded?}   a charge (C) at a point of the solid
  {role: "polar", solid, x, y, w, h, d, volume, epsr, round?}               a neutral thing the field polarizes (epsr 0: a conductor)
A build hook (_magnetize) gives every other part of a magnetic material a "soft" record when the scene has a magnet, and every metal part
a "polar" record when it has a charge, so the catalog's steel balls and weights are pulled by a magnet and a soda can rolls toward a
charged balloon, while a scene without magnets or charges is built exactly as before (no records at all).

Sources (cited by key in the comments; full list in web/CONTRACT.md "Magnetism"):
[ARN] Arnold Magnetic Technologies grade sheets: ceramic 8 (Y30) B_r 0.385-0.40 T, 4.9 g/cm³; alnico 5 B_r 1.25 T, 7.3 g/cm³.
[KJ] K&J Magnetics: NdFeB N42 B_r 1.28-1.32 T, 7.5 g/cm³; disc D82 (1/2" × 1/8").
[FUR] Furlani E.P., Permanent Magnet and Electromechanical Devices, Academic Press 2001 (the charge model; soft iron).
[AHARONI] Aharoni A., J. Appl. Phys. 83, 3432 (1998): demagnetizing factors of rectangular prisms.
[CHIKAZUMI] Chikazumi S., Physics of Ferromagnetism, 2nd ed., OUP 1997, table 7.1 / app.: saturation of iron 2.15 T (1.71 MA/m),
            nickel 0.61 T (0.485 MA/m); low-carbon steel ≈ 2.0 T.
[WMM] NOAA/BGS World Magnetic Model 2020: the horizontal component of Earth's field ≈ 20 µT over the contiguous US.
[TRIBO] Diaz & Felix-Navarro, J. Electrostatics 62, 277 (2004): hair, wool positive; latex rubber, PVC negative; glass on silk positive.
[AIR-BD] air breaks down at ≈ 3 MV/m at 1 atm, so a charged surface holds at most σ = ε0·E ≈ 27 µC/m².
[CODATA18] µ0 = 1.25663706212e-6 T·m/A, ε0 = 8.8541878128e-12 F/m.
[ASM-CI] ASM Handbook vol. 1 (1990), "Gray iron": saturation induction of grey irons 1.3-1.6 T, maximum permeability a few hundred.
[CRC-EPS] CRC Handbook of Chemistry and Physics, 97th ed., permittivity tables: polyethylene 2.3, polypropylene 2.2, polystyrene 2.55, PVC
          3.2, PMMA 3.0, PET 3.2, nylon 3.8, natural rubber 2.7, paraffin wax 2.25, soda-lime glass 6-7, NaCl 5.9, calcite 8.0, quartz 4.5;
          dry wool and leather 3-4.
[TORG] Torgovnikov G.I., Dielectric Properties of Wood and Wood-Based Materials, Springer 1993: dry cell-wall substance ε ≈ 4-5 at 1.5 g/cm³.
[WATER] Malmberg C.G., Maryott A.A., J. Res. NBS 56, 1 (1956): water 80.1 at 20 °C.
[ICE] Petrenko V.F., Whitworth R.W., Physics of Ice, OUP 1999: the static permittivity of ice near 0 °C is about 90-100.
[JACKSON] Jackson J.D., Classical Electrodynamics, 3rd ed., Wiley 1999, §4.4: a dielectric sphere in a uniform field (a spherical shell by the
          same boundary conditions: thin, α = ε0·V_shell·(ε−1)(2ε+1)/(3ε)).
[SIHVOLA] Sihvola A., Electromagnetic Mixing Formulas and Applications, IEE 1999: a mixture's permittivity (and permeability) along thin
          fibres or sheets is its parts' volume-weighted mean (the Wiener upper bound).
"""
import math

from crmath import cube, sq

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "register_goal_kind", "register_build_hook", "MATERIALS", "add_look", "LOOK_FILL",
          "LOOK_SHADE", "CATEGORIES", "TYPES", "props_of", "cos", "sin", "D2R")

MU0 = 1.25663706212e-6          # T·m/A [CODATA18]
EPS0 = 8.8541878128e-12         # F/m [CODATA18]
CATEGORY = "Magnets & static"
STEEL = 7850.0                  # kg/m³: low-carbon steel

# Permanent magnet grades: B_r (T), density (kg/m³), the share of B_r the magnetization works at in a magnet of a classroom's shape, the look.
# Ceramic and NdFeB recoil along a nearly straight line (µ_r ≈ 1.05-1.1), so they work at B_r; alnico 5, easily demagnetized, works at
# ≈ 1.07 T in a bar of length/width ≈ 5 (its demagnetization curve at a permeance coefficient of 5 [ARN]): 0.86 B_r.
GRADES = {
    "ceramic": dict(br=0.39, density=4900.0, eff=1.0, look="magnet paint", words="ceramic (ferrite)",
                    source="Ceramic 8 (Y30) ferrite: B_r 0.385-0.40 T, 4.9 g/cm³ [ARN]."),
    "alnico": dict(br=1.25, density=7300.0, eff=0.86, look="magnet paint", words="alnico",
                   source="Alnico 5: B_r 1.25 T, 7.3 g/cm³; a bar works at about 1.07 T (permeance coefficient 5) [ARN]."),
    "neodymium": dict(br=1.30, density=7500.0, eff=1.0, look="nickel plate", words="neodymium (NdFeB)",
                      source="NdFeB N42: B_r 1.28-1.32 T, 7.5 g/cm³, nickel plated [KJ]."),
}
GRADE_KEYS = ["ceramic", "alnico", "neodymium"]

# Soft magnetic materials (by catalog material): saturation magnetization M_s (A/m) and initial relative susceptibility. Small parts' pull is
# set by their shape (demagnetization) far more than by χ once χ is over ~100 [AHARONI]; saturation caps it [CHIKAZUMI].
SOFT = {
    "steel": dict(ms=1.6e6, chi=1000.0),            # carbon steel (balls, rods): µ0·M_s ≈ 2.0 T
    "steel weight": dict(ms=1.4e6, chi=300.0),      # cast iron/steel weights: µ0·M_s ≈ 1.75 T
    "low-carbon steel": dict(ms=1.6e6, chi=1000.0),  # clips, nails, washers: wire and sheet steel ≈ 2.0 T
    "tinplate steel": dict(ms=1.6e6, chi=1000.0),   # a food can: tin-plated low-carbon steel sheet
    "nickel": dict(ms=4.85e5, chi=100.0),           # nickel 0.61 T [CHIKAZUMI]
    # the other modules' steels and irons (a magnet pulls them too; looked up when the scene is built, whichever module made them):
    "density set steel": dict(ms=1.6e6, chi=1000.0),  # the matter module's steel cube of the density set: low-carbon steel
    "cast iron": dict(ms=1.27e6, chi=300.0),        # grey cast iron: B_s ≈ 1.6 T, µ_r a few hundred [ASM-CI]
    "spring bumper": dict(ms=1.6e6, chi=300.0),     # a lab cart's steel coil-spring bumper: spring steel, harder (lower χ) than mild steel
    # fine steel wool (the matter module's pad: 5 g of wire in 90 cm³): its block is mostly air, so its saturation and susceptibility are its
    # wire's times the wire's share of the block, density ÷ `solid` (a dilute mixture of thin fibres [SIHVOLA])
    "steel wool": dict(ms=1.6e6, chi=300.0, solid=7850.0),
}
# (not here: "stainless steel", the heat module's spoons, tumblers and pans: austenitic 18/8 steel is not ferromagnetic [FUR] (a 400-series one
# would be); "magnet bumper", the mechanics module's repelling cart bumpers: permanent magnets whose poles that module does not set)
# Metals: conductors, fully polarized by an electric field (an aluminium can rolls toward a charged balloon), the other modules' metals too.
CONDUCTORS = ("steel", "steel weight", "low-carbon steel", "tinplate steel", "nickel", "aluminium", "aluminium can", "aluminium foil",
              "glass & aluminium", "cupronickel", "copper", "brass",
              "density set steel", "cast iron", "spring bumper", "steel wool", "stainless steel", "copper-plated zinc", "density set aluminium",
              "density set brass", "density set copper", "density set zinc", "can aluminium", "spacecraft aluminium", "magnet bumper", "graphite")

# Light things that are not metal (under LIGHT_KG, none of its sizes over LIGHT_M, free to move) are polarized by a charge as dielectrics:
# p = α·E with α = ε0·V·(ε_r − 1)/(1 + N(ε_r − 1)) (tooling/src/sim/magnetism.ts), so a charged balloon or rod pulls a ping-pong ball, a
# feather, a scrap of another module's paper, a drop of water. ε_r of the solid stuff and that stuff's own density (kg/m³): a material lighter
# than it (a crumpled paper ball, a feather, foam, cotton wool) is that much air, ε = 1 + (ε_s − 1)·ρ/ρ_s (the parallel mixing rule, the one for
# fibres and thin sheets along the field [SIHVOLA]). Low-frequency values (a field held for seconds) [CRC-EPS] [TORG] [WATER] [ICE].
CELLULOSE = (4.5, 1500.0)        # dry cell-wall substance of wood and paper [TORG]: copy paper at 800 kg/m³ comes to ε 2.9, pine 1.9, balsa 1.4
KERATIN = (3.5, 1300.0)          # feather, wool felt, leather (dry) [CRC-EPS]
WATERY = (80.0, 998.0)           # liquid water at 20 °C 80.1 [WATER]; fruit, grapes and egg are mostly water
DIELECTRIC = {
    "paper": CELLULOSE, "office paper": CELLULOSE, "folded paper": CELLULOSE, "paper strip": CELLULOSE, "crumpled paper": CELLULOSE,
    "tissue paper": CELLULOSE, "envelope tissue": CELLULOSE, "index card": CELLULOSE, "card": CELLULOSE, "cardboard": CELLULOSE,
    "paperboard": CELLULOSE, "cotton balls": CELLULOSE, "folded towel": CELLULOSE, "varnished hardwood": CELLULOSE, "dark wood": CELLULOSE,
    "pine": CELLULOSE, "birch": CELLULOSE, "balsa": CELLULOSE, "domino wood": CELLULOSE, "density set oak": CELLULOSE, "density set pine": CELLULOSE,
    "feather": KERATIN, "felt": KERATIN, "felt (tennis)": KERATIN, "leather (basketball)": KERATIN,
    "polyethylene": (2.3, 950.0), "density set polyethylene": (2.3, 950.0), "bag film": (2.3, 920.0), "bubble wrap": (2.3, 920.0),
    "polypropylene": (2.2, 905.0), "density set polypropylene": (2.2, 905.0), "hollow plastic": (2.3, 950.0),
    "ABS plastic": (2.9, 1050.0), "ABS housing": (2.9, 1050.0), "model plastic": (2.9, 1050.0), "cart plastic": (2.9, 1050.0),
    "acrylic": (3.0, 1190.0), "density set acrylic": (3.0, 1180.0), "box acrylic": (3.0, 1180.0),
    "PET": (3.2, 1380.0), "pillow stuffing": (3.2, 1380.0), "sail cloth": (3.2, 1380.0), "nylon canopy": (3.8, 1150.0),
    "density set nylon": (3.8, 1150.0), "velcro": (3.8, 1150.0),
    "PVC (beach ball)": (3.2, 1380.0), "density set PVC": (3.2, 1380.0), "exercise PVC": (3.2, 1380.0), "vinyl": (3.2, 1400.0),
    "suction cup vinyl": (3.2, 1300.0), "vinyl rubber": (3.2, 1150.0),
    "celluloid": (3.5, 1370.0),
    "foam": (2.55, 1050.0), "packing foam": (2.55, 1050.0), "polyurethane foam": (3.5, 1200.0), "urethane": (3.5, 1200.0),
    "latex": (2.7, 950.0), "balloon latex": (2.7, 920.0), "solid rubber": (2.7, 906.0), "rubber band": (2.7, 1100.0),
    "playground rubber": (3.0, 1100.0), "rubber mat": (3.0, 1100.0),
    "glass": (6.5, 2500.0), "glass marble": (6.5, 2518.0), "mirror glass": (6.5, 2500.0), "optical glass": (6.5, 2510.0),
    "wax": (2.25, 900.0), "cork": (1.7, 200.0),
    "liquid water": WATERY, "puddle water": WATERY, "egg insides": WATERY, "grape": WATERY, "fruit": WATERY,
    "ice": (90.0, 917.0),
    "table salt": (5.9, 2165.0), "chalk": (8.0, 2710.0), "eggshell": (8.0, 2710.0), "dry sand": (4.5, 2650.0), "rice": (3.5, 1450.0),
    "dry pasta": (3.5, 1450.0), "modeling clay": (4.0, 1570.0), "modelling clay": (4.0, 1570.0), "soft clay": (4.0, 1570.0),
}
EPS_OTHER = 3.0                  # any other solid that is not metal: most dry solids have ε_r 2-6 [CRC-EPS]
LIGHT_KG = 0.05
LIGHT_M = 0.3
# A part of iron or steel that is held still, in a scene whose magnets and coils are all held still too (nothing can come nearer), gets its
# soft record only where one of them could reach it: where the field of the strongest it could be (a magnet's dipole moment, a coil's core at
# saturation) is over REACH_T at the part's nearest, so far-off fixed steel (a steel post across the room) costs the run nothing. 2 µT is a
# tenth of the Earth's field: a 15 cm neodymium bar reaches 1.4 m, a ceramic one 0.95 m, a 12.7 mm neodymium disc 0.37 m. Anything that can
# move, or near a magnet that can, keeps its record wherever it starts (a magnet cart may roll up to it).
REACH_T = 2e-6
# A part that starts where no magnet's or coil's strongest field reaches GRID_T is solved as a row even when it is sheet metal (`grid: false`:
# a sheet's grid is for a pole that faces it, its shielding; a steel bucket across the room needs none, and its grid's hundreds of pieces cost
# the run tens of seconds). 1 mT: a 15 cm neodymium bar's reach is 18 cm, a ceramic one's 12 cm.
GRID_T = 1e-3

# ---------------------------------------------------------------- static electricity
# A rubbed balloon (latex on hair or wool [TRIBO]): 10 nC a stroke, at most 10 strokes' worth, on a 40 cm² patch: 100 nC there is 25 µC/m²,
# just under what air holds before it sparks [AIR-BD]. The patch's charge is put at the depth a/√2 under its middle (a = the patch's
# radius): that point charge has the patch's field at its face (σ/2ε0) and its whole charge far off.
STROKE_C = 1e-8
STROKES_MAX = 10
PATCH_AREA = 0.004              # m²


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CATEGORY not in CATEGORIES:
        CATEGORIES.append(CATEGORY)
    _looks()
    _materials()
    _magnets()
    _iron()
    _others()
    _compass()
    _static()
    register_build_hook(_magnetize)
    for kind, fn in (("attracts", goal_attracts), ("repels", goal_repels), ("sticks", goal_sticks), ("lifts", goal_lifts),
                     ("points", goal_points), ("holds", goal_holds), ("levitates", goal_levitates), ("not_attracted", goal_not_attracted)):
        register_goal_kind(kind, fn)


def _look(key, **kw):
    # Only a name nobody has made yet: the catalogs and the modules before this one keep their own looks (catalog_everyday's
    # paper rolls stay their colour), so loading this module never changes an existing scene.
    if key not in LOOK_FILL:
        add_look(key, **kw)


def _looks():
    _look("magnet paint", fill="#c8302a", shade="#8e2018", roughness=0.35, metalness=0.0, clearcoat=0.5)
    _look("nickel plate", fill="#c9ccd1", shade="#8d9096", roughness=0.18, metalness=1.0, clearcoat=0.0)
    _look("zinc plate", fill="#c3c7cc", shade="#878b90", roughness=0.3, metalness=1.0, clearcoat=0.0)
    _look("brass", fill="#c9a640", shade="#8f7426", roughness=0.28, metalness=1.0, clearcoat=0.0)
    _look("copper", fill="#c46a3c", shade="#8a4423", roughness=0.3, metalness=1.0, clearcoat=0.0)
    _look("foil", fill="#d9dcdf", shade="#9ea2a6", roughness=0.35, metalness=1.0, clearcoat=0.0)
    _look("latex", fill="#d62f3a", shade="#9a1f27", roughness=0.3, metalness=0.0, clearcoat=0.8)
    _look("paper", fill="#f4f1ea", shade="#c9c4b8", roughness=0.85, metalness=0.0, clearcoat=0.0)


def _mat(key, **kw):
    # As _look: copper, brass and aluminium foil may already come from another module (circuits, heat, fluids); theirs is kept.
    kw.setdefault("rolling", 0.0)
    kw.setdefault("side", 0.0)
    if key not in MATERIALS:
        MATERIALS[key] = kw


def _materials():
    for k in GRADE_KEYS:
        gr = GRADES[k]
        _mat(f"{k} magnet", density=gr["density"], bounce=0.4, friction=0.45, rolling=0.002, look=gr["look"],
             source=gr["source"] + " Friction and bounce provisional.")
    _mat("low-carbon steel", density=STEEL, bounce=0.6, friction=0.4, rolling=0.002, look="zinc plate",
         source="Low-carbon steel wire and sheet, 7850 kg/m³; µ0·M_s ≈ 2.0 T [CHIKAZUMI]. Bounce provisional.")
    _mat("tinplate steel", density=STEEL, bounce=0.3, friction=0.35, rolling=0.003, look="steel",
         source="Tin-plated low-carbon steel sheet (a food can), 7850 kg/m³. Bounce provisional.")
    _mat("nickel", density=8900.0, bounce=0.6, friction=0.4, rolling=0.002, look="steel", source="Nickel 8900 kg/m³; µ0·M_s 0.61 T [CHIKAZUMI].")
    _mat("brass", density=8500.0, bounce=0.6, friction=0.35, rolling=0.002, look="brass", source="Brass 8400-8730 kg/m³ (CRC Handbook); not magnetic.")
    _mat("copper", density=8960.0, bounce=0.5, friction=0.35, rolling=0.002, look="copper", source="Copper 8960 kg/m³ (CRC Handbook); not magnetic.")
    _mat("aluminium foil", density=2700.0, bounce=0.2, friction=0.5, rolling=0.02, look="foil",
         source="Aluminium 2700 kg/m³; a crumpled ball is mostly air (its density is set by its weight). Not magnetic.")
    _mat("latex", density=950.0, bounce=0.6, friction=0.6, rolling=0.02, look="latex",
         source="Natural latex rubber 920-960 kg/m³; a party balloon's wall stretched to about 0.02 mm. Bounce provisional.")
    _mat("paper", density=800.0, bounce=0.1, friction=0.5, rolling=0.02, look="paper",
         source="Copy paper 80 g/m² at 0.1 mm (800 kg/m³); a scrap's body is its outline, its weight its paper's.")


def _r(x, n=5):
    return round(x, n)


def _face(x, y, angle, width, depth, sigma, z=None):
    f = {"x": _r(x), "y": _r(y), "angle": angle, "width": _r(width), "depth": _r(depth), "sigma": round(sigma, 1)}
    if z is not None:
        f["z"] = _r(z)
    return f


def _sigma(grade, flip):
    """A grade's pole strength σ = M (A/m, the face's magnetic charge per m²), north positive; flipped: negative."""
    gr = GRADES[grade]
    s = gr["br"] * gr["eff"] / MU0
    return -s if flip else s


def _child_slab(c, part, parent, w, h, depth, lx, ly, material, words, look, kind=None):
    """A slab welded to another part of this item: lx, ly in the parent's frame."""
    s = {"kind": kind or c.kind, "id": f"{c.item['id']}/{part}", "words": words, "item": c.item["id"], "look": look,
         "body": {"kind": "slab", "width": _r(w), "height": _r(h), "depth": depth}, "material": material,
         "at": {"x": _r(lx), "y": _r(ly)}, "parent": parent,
         "placeholder": {"fill": LOOK_FILL.get(look, "#888")}, "render": {"kind": "procedural", "shade": LOOK_SHADE.get(look, "#555")}, "depth": 2}
    c.sb.solids.append(s)
    return s["id"]


def _magnet_props(default_grade, length=None):
    return [Prop("material", "Material", default_grade, kind="choice", choices=GRADE_KEYS,
                 help="ceramic (ferrite, B_r 0.39 T), alnico (1.25 T) or neodymium (1.3 T): at the same size a neodymium magnet pulls about 11 times harder than a ceramic one")]


def _show_props():
    return [Prop("flip", "North on the other side", False, kind="bool", help="Swaps its north and south poles"),
            Prop("show_field", "Show field lines", False, kind="bool", help="Draw its magnetic field lines (a drawing only)")]


# ---------------------------------------------------------------- permanent magnets
def _held(c):
    """A part held in mid-air (a fixed magnet, the electromagnet, a rod): the view draws a retort stand behind it (doc solid `stand`)."""
    return {"stand": "post"} if c.kind == "static" else {}


def build_bar(c, P):
    L, W, D = P["length"], P["width"], P["depth"]
    grade = P["material"]
    mat = c.mat(base=f"{grade} magnet", overrides={})
    sid = c.slab("magnet", L, W, D, material=mat, look=GRADES[grade]["look"], words=f"a {GRADES[grade]['words']} bar magnet", **_held(c))
    s = _sigma(grade, P["flip"])
    c.process("magnetism", "field", role="magnet", solid=sid,
              faces=[_face(L / 2, 0.0, 0.0, W, D, s), _face(-L / 2, 0.0, math.pi, W, D, -s)])


ARM_SEAM = 0.0003    # m


def build_horseshoe(c, P):
    H, Wd, a, D = P["height"], P["width"], P["arm"], P["depth"]
    a = min(a, Wd / 2 - 0.004, H - 0.004)
    grade = P["material"]
    mat = c.mat(base=f"{grade} magnet", overrides={})
    look = GRADES[grade]["look"]
    words = f"a {GRADES[grade]['words']} horseshoe magnet"
    # opening downward: the bend across the top, the two arms down to the poles at the bottom; the item's (x, y) is the middle of its outline
    by = H / 2 - a / 2
    root = c.slab("bend", Wd, a, D, 0.0, by, material=mat, look=look, words=words)
    arm_h = H - a
    # (the arms stop 0.3 mm under the bend, welded to it: a held horseshoe's stand stands behind its left arm, which the view draws only for a
    # part with nothing touching it from above or below)
    for part, sx in (("left", -1), ("right", 1)):
        _child_slab(c, part, root, a, arm_h - ARM_SEAM, D, sx * (Wd / 2 - a / 2), -a / 2 - ARM_SEAM - (arm_h - ARM_SEAM) / 2, mat, words, look)
        if part == "left":
            c.sb.solids[-1].update(_held(c))
    # the poles: the arms' tips, in the bend's frame. Magnetized along the U: out of the left tip (north), into the right (south)
    s = _sigma(grade, P["flip"])
    tip = -a / 2 - arm_h
    c.process("magnetism", "field", role="magnet", solid=root,
              faces=[_face(-(Wd / 2 - a / 2), tip, -math.pi / 2, a, D, s), _face(Wd / 2 - a / 2, tip, -math.pi / 2, a, D, -s)])


def build_disc(c, P):
    d, t = P["diameter"], P["thickness"]
    grade = P["material"]
    # a disc lying flat (its round faces up and down): its body is its side outline d × t, d deep; its mass is the disc's
    mass = GRADES[grade]["density"] * math.pi / 4 * d * d * t
    mat = c.mat(base=f"{grade} magnet", overrides={}, density=round(mass / (d * t * d), 3))
    sid = c.slab("magnet", d, t, d, material=mat, look=GRADES[grade]["look"], words=f"a {GRADES[grade]['words']} disc magnet", **_held(c))
    s = _sigma(grade, P["flip"])
    # its round pole faces as squares of the same area (side d·√π/2), so its pole strength σ·area is the disc's
    side = d * 0.886226925452758
    c.process("magnetism", "field", role="magnet", solid=sid,
              faces=[_face(0.0, t / 2, math.pi / 2, side, side, s), _face(0.0, -t / 2, -math.pi / 2, side, side, -s)])


RING_GAP = 0.0025     # m: the clearance between a ring's hole and the dowel's body on each side (the engine's contact skins take 1 mm each)
RING_OFF = 0.0006    # m


def build_rings(c, P):
    n, OD, ID, t, Hd = int(P["count"]), P["outer"], P["hole"], P["thickness"], P["height"]
    ID = min(ID, OD - 0.006)
    grade = P["material"]
    look = GRADES[grade]["look"]
    words = f"a {GRADES[grade]['words']} ring magnet"
    wood = c.mat(base="varnished hardwood", overrides={})
    # a wooden base 8 × 1.5 × 8 cm on the table (the item's (x, y) is the middle of its bottom) and an upright dowel through the rings
    c.slab("base", 0.08, 0.015, 0.08, 0.0, 0.0075, kind="static", material=wood, look="wood", words="a wooden base")
    # (at least 3 mm: a hole near its 5 mm least leaves less than the two clearances, and a dowel 0 m wide would be a line with no sides)
    dw = max(0.003, ID - 2 * RING_GAP)
    c.slab("dowel", dw, Hd, dw, 0.0, 0.015 + Hd / 2, kind="static", material=wood, look="light wood", words="a wooden dowel")
    # each ring: two halves (its sides of the hole, as the side view cuts it), welded; the mass is the ring's
    mass = GRADES[grade]["density"] * math.pi / 4 * (OD * OD - ID * ID) * t
    half = (OD - ID) / 2
    mat = c.mat(base=f"{grade} magnet", overrides={}, density=round(mass / (2 * half * t * OD), 3))
    s0 = _sigma(grade, False) * math.pi / 4      # the faces' σ over a square annulus of the same outer size (area 4/π of the ring's)
    R, rr = OD / 2, ID / 2
    # with like faces together the rings start near where they float: each gap where two coaxial dipoles' push, 3µ0·m²/(2π·z⁴) [FUR],
    # carries the rings above it (m = M·V the ring's moment): the rest of the way they bob and settle. Each starts RING_OFF to one side of
    # the dowel's middle or the other, as a hand drops them on. Unlike faces: stacked touching (they snap together).
    m_ring = GRADES[grade]["br"] * GRADES[grade]["eff"] / MU0 * math.pi / 4 * (OD * OD - ID * ID) * t
    gravity = c.settings["gravity"]
    y = 0.015 - 0.002
    for i in range(n):
        gap = 0.002
        if P["alternate"] and i > 0 and gravity > 0:
            z = math.sqrt(math.sqrt(3 * MU0 * m_ring * m_ring / (2 * math.pi * (n - i) * mass * gravity)))
            gap = max(0.002, z - t)
        y = y + gap + t / 2 if i > 0 else y + 0.002 + t / 2
        up = (i % 2 == 0) or not P["alternate"]
        if P["flip"]:
            up = not up
        off = RING_OFF if i % 2 == 0 else -RING_OFF
        left = c.slab(f"ring{i + 1}", half, t, OD, -(R + rr) / 2 + off, y, material=mat, look=look, words=words)
        _child_slab(c, f"ring{i + 1}-r", left, half, t, OD, R + rr, 0.0, mat, words, look)
        y = y + t / 2
        s = s0 if up else -s0
        faces = []
        for side, sy in ((1, t / 2), (-1, -t / 2)):
            ang = math.pi / 2 if side > 0 else -math.pi / 2
            sg = s * side
            faces += [_face(0.0, sy, ang, half, OD, sg), _face(R + rr, sy, ang, half, OD, sg),
                      _face((R + rr) / 2, sy, ang, ID, half, sg, z=(R + rr) / 2), _face((R + rr) / 2, sy, ang, ID, half, sg, z=-(R + rr) / 2)]
        c.process("magnetism", f"field{i + 1}", role="magnet", solid=left, faces=faces, level=True, center={"x": _r((R + rr) / 2), "y": 0.0})


def build_magnet_cart(c, P):
    cart = TYPES["cart"]
    Pc = cart.defaults()
    for k in ("length", "wheel_diameter", "body_mass"):
        Pc[k] = P[k]
    # (the cart's own builder, with the cart's own props: its wheels take their material from them)
    mine = c.P
    c.P = Pc
    cart.build_fn(c, Pc)
    c.P = mine
    chassis = next(s for s in c.sb.solids if s["id"] == f"{c.item['id']}/chassis")
    b = chassis["body"]
    top = b["height"] / 2 if b["kind"] == "slab" else max(p["y"] for p in b["points"])
    grade = P["material"]
    L, W, D = P["magnet_length"], 0.019, 0.0095
    mat = c.mat(base=f"{grade} magnet", overrides={})
    sx = 1 if P["magnet_end"] == "front" else -1
    x = sx * (P["length"] / 2 - L / 2)
    sid = _child_slab(c, "magnet", chassis["id"], L, W, D, x, top + W / 2, mat, f"a {GRADES[grade]['words']} bar magnet", GRADES[grade]["look"])
    s = _sigma(grade, P["flip"])
    c.process("magnetism", "field", role="magnet", solid=sid,
              faces=[_face(L / 2, 0.0, 0.0, W, D, s), _face(-L / 2, 0.0, math.pi, W, D, -s)])


def _magnets():
    bar = [Prop("length", "Length", 0.15, 0.03, 0.2, 0.005, "m"),
           Prop("width", "Width", 0.019, 0.005, 0.03, 0.001, "m", "Its size up and down in the picture"),
           Prop("depth", "Depth", 0.0095, 0.005, 0.03, 0.0005, "m", "Its size front to back")]
    register(ItemType("bar-magnet", "Bar magnet", CATEGORY, build_bar, module="magnetism",
                      props=_magnet_props("ceramic") + bar + _show_props(),
                      readouts=[Readout("pull_mN", "Magnetic pull", "mN", 2, "The magnetic force on it now"),
                                Readout("heading_deg", "North end points", "°", 0, "Which way its north pole points, counter-clockwise from the right")],
                      tags=["magnet", "bar magnet", "poles", "north", "south", "attract", "repel", "ferrite", "ceramic", "alnico", "neodymium", "classroom magnet"],
                      description="A classroom bar magnet, north pole (red, N) on the right unless flipped. Like poles push apart, unlike poles pull "
                                  "together, and it pulls iron and steel (clips, nails, steel balls) but not aluminium, copper, brass, plastic, wood or glass. "
                                  "The pull falls off steeply with distance: a ceramic bar lifts a paper clip from 1-2 cm, a neodymium one from several cm.",
                      source="Pole faces with σ = B_r/µ0 (the charge model [FUR]); grades [ARN] [KJ]. A ceramic 152 × 19 × 9.5 mm bar weighs 134 g.",
                      anchor="its centre", facts="ceramic · 15 cm · 134 g · N on the right", edit=[{"kind": "length", "prop": "length"}, {"kind": "rotate"}]))
    register(ItemType("horseshoe-magnet", "Horseshoe magnet", CATEGORY, build_horseshoe, module="magnetism",
                      props=_magnet_props("alnico") + [Prop("height", "Height", 0.07, 0.03, 0.15, 0.005, "m"), Prop("width", "Width", 0.06, 0.03, 0.12, 0.005, "m"),
                                                       Prop("arm", "Arm thickness", 0.018, 0.006, 0.04, 0.001, "m"), Prop("depth", "Depth", 0.01, 0.005, 0.03, 0.001, "m")] + _show_props(),
                      readouts=[Readout("pull_mN", "Magnetic pull", "mN", 2)],
                      tags=["magnet", "horseshoe", "u magnet", "u-shaped", "poles", "alnico", "attract"],
                      description="A U-shaped magnet with its two poles side by side at the ends of its arms (opening downward; turn it to aim). "
                                  "Both poles pull iron, and the field is strongest in the gap between them.",
                      source="Alnico horseshoe 7 × 6 cm, magnetized along the U: its pole faces at the tips [ARN] [FUR].",
                      anchor="its centre", facts="alnico · 7 cm · poles at the bottom", edit=[{"kind": "rotate"}]))
    register(ItemType("disc-magnet", "Disc magnet", CATEGORY, build_disc, module="magnetism",
                      props=_magnet_props("neodymium") + [Prop("diameter", "Diameter", 0.0127, 0.005, 0.05, 0.0005, "m"), Prop("thickness", "Thickness", 0.0032, 0.001, 0.02, 0.0005, "m")] + _show_props(),
                      readouts=[Readout("pull_mN", "Magnetic pull", "mN", 2)],
                      tags=["magnet", "disc", "button magnet", "neodymium", "rare earth", "fridge magnet", "round magnet", "strong magnet"],
                      description="A small round magnet lying flat, its poles on its round faces (north up unless flipped). A neodymium one is very strong for its size.",
                      source="NdFeB N42 disc 12.7 × 3.2 mm (K&J D82) [KJ]; its faces as squares of the same area.",
                      anchor="its centre", facts="N42 · 12.7 × 3.2 mm · 3 g · N up", edit=[{"kind": "rotate"}]))
    register(ItemType("ring-magnets", "Ring magnets on a dowel", CATEGORY, build_rings, module="magnetism",
                      props=_magnet_props("ceramic") + [Prop("count", "Rings", 3, 1, 6, 1, "", kind="int"),
                                                        Prop("alternate", "Like faces together", True, kind="bool", help="Every other ring turned over, so neighbours push apart and float"),
                                                        Prop("outer", "Outer diameter", 0.025, 0.015, 0.06, 0.001, "m"), Prop("hole", "Hole", 0.009, 0.005, 0.02, 0.0005, "m"),
                                                        Prop("thickness", "Thickness", 0.005, 0.003, 0.02, 0.0005, "m"), Prop("height", "Dowel height", 0.15, 0.06, 0.4, 0.01, "m")] + _show_props(),
                      readouts=[Readout("pull_mN", "Magnetic push", "mN", 2)],
                      tags=["magnet", "ring magnet", "levitate", "levitating", "floating magnets", "magnetic tower", "dowel", "repel", "stack"],
                      description="Ring magnets threaded on an upright wooden dowel on a base. With like faces together each ring floats above the one "
                                  "below it, where the push up equals the weight above (the bottom gap is the smallest); with unlike faces they snap together.",
                      source="Ceramic rings Ø 25 mm, 9 mm hole, 5 mm thick (10.5 g) [ARN]; faces poled on the flat sides.",
                      anchor="the middle of the base's bottom (on the table)", facts="3 ceramic rings · Ø 25 mm · float apart"))
    cart_props = [Prop("magnet_end", "Magnet at", "front", kind="choice", choices=["front", "back"], help="Which end of the cart the bar magnet sits at"),
                  Prop("magnet_length", "Magnet length", 0.1, 0.03, 0.15, 0.005, "m"),
                  Prop("length", "Cart length", 0.22, 0.11, 0.55, 0.005, "m"), Prop("wheel_diameter", "Wheel diameter", 0.05, 0.025, 0.1, 0.002, "m"),
                  Prop("body_mass", "Cart weight", 0.2, 0.04, 1.2, 0.005, "kg")]
    register(ItemType("magnet-cart", "Magnet cart", CATEGORY, build_magnet_cart, module="magnetism",
                      props=_magnet_props("ceramic") + cart_props + _show_props(),
                      readouts=[Readout("pull_mN", "Magnetic push or pull", "mN", 2)],
                      tags=["magnet car", "magnet cart", "magnetic car", "push without touching", "repel", "attract", "cart", "trolley"],
                      description="A wooden cart with a bar magnet on its deck at the front (north pole forward unless flipped). Two magnet carts with "
                                  "like poles facing push each other apart without touching; with unlike poles they roll together.",
                      source="The catalog's cart with a ceramic bar magnet [ARN] on its deck.",
                      anchor="the ground under its middle, where the wheels touch", facts="cart + 10 cm ceramic magnet", edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- soft iron and steel
def _soft(c, part, sid, w, h, d, volume, material="low-carbon steel", round_=False, x=0.0, y=0.0):
    m = SOFT[material]
    rec = dict(role="soft", solid=sid, x=_r(x), y=_r(y), w=_r(w), h=_r(h), d=_r(d), volume=float(f"{volume:.6g}"), ms=m["ms"], chi=m["chi"])
    if round_:
        rec["round"] = True
    c.process("magnetism", part, **rec)


# Magnetically a clip is its wire: its loops lie side by side, so it is magnetized as a bundle of 0.9 mm wire 33 mm long and two wires
# across (its block 33 × 0.9 × 1.9 mm holds its 0.057 cm³ of steel), not as a solid 8 mm plate (a wire across a field is demagnetized by
# 1/2, a plate by nearly 1 [AHARONI]).
CLIP_WIRE = 0.0009
CLIP_BUNDLE = 0.0019
COLOURS = {"silver": None, "red": "#c0392b", "blue": "#2e6fc4", "green": "#2f9a4c", "yellow": "#e2b52a", "black": "#2a2a2a"}


def build_clips(c, P):
    n, sp = int(P["count"]), P["spacing"]
    colour = COLOURS.get(P["color"])
    # a Gem no. 1 clip, 33 × 8 mm of 0.9 mm steel wire, 0.45 g, lying flat (its 8 mm across the picture's depth); its body is 1 mm thick
    L, T, Wd, m = 0.033, 0.001, 0.008, 0.00045
    mat = c.mat(base="low-carbon steel", overrides={}, density=round(m / (L * T * Wd), 3))
    x0 = -(n - 1) * sp / 2
    extra = {} if colour is None else {"color": colour}
    for i in range(n):
        sid = c.slab(f"clip{i + 1}", L, T, Wd, x0 + i * sp, 0.0, material=mat, look="zinc plate", words="a steel paper clip", **extra)
        _soft(c, f"iron{i + 1}", sid, L, CLIP_WIRE, CLIP_BUNDLE, m / STEEL)


def build_nail(c, P):
    L, dia = P["length"], P["diameter"]
    r = dia / 2
    p = min(0.004, L / 6)          # the point
    head_d, head_t = round(dia * 2.2, 5), 0.001
    # a common nail lying on its side: its shank and point one polygon (round shank of steel; the polygon is square in section, so its
    # density is set to give the round nail's weight), its head welded at the left end
    vol_round = math.pi * r * r * (L - p) + math.pi * r * r * p / 3
    vol_poly = (2 * r * (L - p) + r * p) * dia
    mat = c.mat(base="low-carbon steel", overrides={}, density=round(STEEL * vol_round / vol_poly, 3))
    pts = [(-L / 2, -r), (L / 2 - p, -r), (L / 2, 0.0), (L / 2 - p, r), (-L / 2, r)]
    sid = c.poly("shank", pts, dia, material=mat, look="steel", words="an iron nail")
    head_mass = STEEL * math.pi / 4 * head_d * head_d * head_t
    hmat = c.mat(base="low-carbon steel", overrides={}, density=round(head_mass / (head_t * head_d * head_d), 3))
    _child_slab(c, "head", sid, head_t, head_d, head_d, -L / 2 - head_t / 2, 0.0, hmat, "the nail's head", "steel")
    _soft(c, "iron", sid, L, dia, dia, vol_round)


def build_washer(c, P):
    od, t = P["diameter"], P["thickness"]
    hole = od * 0.525
    vol = math.pi / 4 * (od * od - hole * hole) * t
    mat = c.mat(base="low-carbon steel", overrides={}, density=round(STEEL * vol / (od * t * od), 3))
    sid = c.slab("washer", od, t, od, material=mat, look="zinc plate", words="a steel washer")
    _soft(c, "iron", sid, od, t, od, vol)


def build_can(c, P):
    D, H, m = P["diameter"], P["height"], P["mass"]
    mat = c.mat(base="tinplate steel", overrides={}, density=round(m / (D * H * D), 3))
    sid = c.slab("can", D, H, D, material=mat, look="steel", words="an empty steel food can")
    # a closed steel shell shields as a solid block would until its steel saturates: magnetized as the whole block, at most M_s × its
    # steel's share of the block [FUR]
    box = D * H * D
    steel = m / STEEL
    c.process("magnetism", "iron", role="soft", solid=sid, x=0.0, y=0.0, w=_r(D), h=_r(H), d=_r(D), volume=float(f"{box:.6g}"),
              ms=round(SOFT["tinplate steel"]["ms"] * steel / box, 1), chi=SOFT["tinplate steel"]["chi"])


def build_can_side(c, P):
    D, H = P["diameter"], P["height"]
    steel = P["material"] == "steel"
    # an empty can lying on its side: a cylinder along the picture's depth that rolls; its side wall carries most of its weight (a hoop) and its
    # ends the rest: I = (m_side + m_ends/2)·r², about 0.85·m·r² [aluminium soda can 15 g, steel food can 50 g]
    m = P["mass"]
    r = D / 2
    base = "tinplate steel" if steel else "aluminium can"
    mat = c.mat(base=base, overrides={}, density=round(m / (4 / 3 * math.pi * cube(r)), 4))
    sid = c.ball("can", r, material=mat, look="steel" if steel else "aluminium", inertia=0.85, shape="cylinder", length=_r(H), depth3d=_r(H),
                 words="an empty steel can on its side" if steel else "an empty aluminium can on its side")
    if steel:
        side = D * 0.886226925452758
        box = side * side * H
        c.process("magnetism", "iron", role="soft", solid=sid, x=0.0, y=0.0, w=_r(side), h=_r(side), d=_r(H), volume=float(f"{box:.6g}"),
                  ms=round(SOFT["tinplate steel"]["ms"] * (m / STEEL) / box, 1), chi=SOFT["tinplate steel"]["chi"], round=True)


# An electromagnet you make: enamelled 24 AWG copper wire (0.511 mm, 84.2 mΩ/m: ASTM B258 / NEC ch. 9 table 8) wound on a nail, on AA
# cells (1.5 V each, about 0.2 Ω inside under a few amps: Energizer E91 datasheet, 0.15 Ω at 1 kHz fresh), 30 cm of leads.
AWG24_D, AWG24_OHM = 0.000511, 0.0842
AA_V, AA_OHM, LEADS = 1.5, 0.2, 0.3


def coil_amps(turns, cells, dia):
    """The coil's current (A): the cells' voltage over the wire's resistance and theirs."""
    wire = turns * math.pi * (dia + AWG24_D) + LEADS
    return cells * AA_V / (wire * AWG24_OHM + cells * AA_OHM)


def build_electromagnet(c, P):
    L, dia = P["length"], P["diameter"]
    n, cells = int(P["turns"]), int(P["cells"])
    r = dia / 2
    p = min(0.004, L / 6)
    # an iron nail held point down in a clamp (turn it with the item's angle), its coil wound over all but its last 5 mm each end, wired to a
    # holder of AA cells (drawn on the table beside it); the item's (x, y) is the middle of the nail
    vol_round = math.pi * r * r * (L - p) + math.pi * r * r * p / 3
    vol_poly = (2 * r * (L - p) + r * p) * dia
    mat = c.mat(base="low-carbon steel", overrides={}, density=round(STEEL * vol_round / vol_poly, 3))
    pts = [(-L / 2, -r), (L / 2 - p, -r), (L / 2, 0.0), (L / 2 - p, r), (-L / 2, r)]
    sid = c.poly("core", pts, dia, langle=-90.0, material=mat, look="steel", words="an iron nail wrapped with copper wire", **_held(c))
    # (its head is drawn by the core's model: held in a stand, the core is one part with nothing welded to it)
    amps = coil_amps(n, cells, dia) if P["on"] else 0.0
    if P["flip"]:
        amps = -amps
    current = [{"t": round(P["on_at"], 4), "amps": round(amps, 4)}]
    c.process("magnetism", "core", role="soft", solid=sid, x=0.0, y=0.0, w=_r(L), h=_r(dia), d=_r(dia), volume=float(f"{vol_round:.6g}"),
              ms=SOFT["low-carbon steel"]["ms"], chi=SOFT["low-carbon steel"]["chi"],
              coil={"turns": n, "length": _r(L - 0.01), "current": current})


def _iron():
    soft_read = [Readout("magnetized", "Magnetized", "%", 1, "How strongly a magnet's field has magnetized it, % of its steel's most"),
                 Readout("pull_mN", "Magnetic pull", "mN", 2, "The magnetic force on it now")]
    register(ItemType("paper-clip", "Paper clips", CATEGORY, build_clips, module="magnetism",
                      props=[Prop("count", "Clips", 1, 1, 30, 1, "", kind="int"), Prop("spacing", "Spacing", 0.04, 0.034, 0.3, 0.001, "m", "Between the clips' middles, in a row"),
                             Prop("color", "Colour", "silver", kind="choice", choices=list(COLOURS), help="A coated clip is still steel inside")],
                      readouts=soft_read,
                      tags=["paper clip", "paperclip", "clip", "steel", "iron", "magnetic", "attracted", "pick up", "chain"],
                      description="Steel paper clips (33 mm, 0.45 g) lying flat in a row. A magnet pulls them whichever pole is near; a clip on a magnet "
                                  "becomes a magnet itself and holds the next one (a chain).",
                      source="Gem no. 1 clip: 0.9 mm low-carbon steel wire, 0.45 g; soft iron, magnetized by the field [FUR] [AHARONI].",
                      anchor="the middle of the row, at the clips' middle", facts="steel · 33 mm · 0.45 g each"))
    register(ItemType("iron-nail", "Iron nail", CATEGORY, build_nail, module="magnetism",
                      props=[Prop("length", "Length", 0.051, 0.02, 0.15, 0.001, "m"), Prop("diameter", "Shank diameter", 0.0029, 0.0015, 0.006, 0.0001, "m")],
                      readouts=soft_read,
                      tags=["nail", "iron", "steel", "magnetic", "attracted", "core"],
                      description="A common steel nail (51 mm, 3 g) lying on its side. A magnet pulls it and turns it to lie along the field.",
                      source="2 in. common nail: 51 mm × 2.9 mm shank, about 3 g; low-carbon steel [FUR].",
                      anchor="the middle of its shank", facts="steel · 51 mm · 3 g"))
    register(ItemType("steel-washer", "Steel washer", CATEGORY, build_washer, module="magnetism",
                      props=[Prop("diameter", "Diameter", 0.016, 0.008, 0.05, 0.0005, "m"), Prop("thickness", "Thickness", 0.0016, 0.0008, 0.005, 0.0001, "m")],
                      readouts=soft_read,
                      tags=["washer", "steel", "metal", "magnetic", "ring"],
                      description="A flat zinc-plated steel washer (M8: 16 mm, 1.8 g) lying flat. Magnetic.",
                      source="DIN 125 M8 washer: 16 mm, 8.4 mm hole, 1.6 mm thick, 1.8 g.", anchor="its centre", facts="steel · 16 mm · 1.8 g"))
    register(ItemType("steel-can", "Steel can", CATEGORY, build_can, module="magnetism",
                      props=[Prop("diameter", "Diameter", 0.075, 0.05, 0.12, 0.001, "m"), Prop("height", "Height", 0.11, 0.05, 0.2, 0.001, "m"),
                             Prop("mass", "Weight", 0.05, 0.02, 0.2, 0.001, "kg", "Empty")],
                      readouts=soft_read,
                      tags=["tin can", "steel can", "food can", "can", "metal", "magnetic", "recycling"],
                      description="An empty tin-plated steel food can standing up (7.5 × 11 cm, 50 g). A magnet pulls it; an aluminium soda can it does not.",
                      source="A 15 oz food can: tin-plated low-carbon steel, Ø 75 × 110 mm, about 50 g empty [FUR].",
                      anchor="its centre", facts="steel · Ø 7.5 × 11 cm · 50 g", edit=[{"kind": "rotate"}]))
    register(ItemType("battery-electromagnet", "Electromagnet (nail and battery)", CATEGORY, build_electromagnet, dynamic=False, module="magnetism",
                      props=[Prop("turns", "Turns of wire", 50, 5, 300, 5, "", kind="int", help="More turns, a stronger magnet (until the nail's iron is full)"),
                             Prop("cells", "AA batteries", 2, 1, 4, 1, "", kind="int", help="1.5 V each, in series: more batteries, more current"),
                             Prop("on", "Switched on", True, kind="bool"), Prop("on_at", "Switch on at", 0.0, 0.0, 10.0, 0.1, "s"),
                             Prop("flip", "Current the other way", False, kind="bool", help="Swaps its north and south ends (clips are pulled either way)"),
                             Prop("length", "Nail length", 0.051, 0.03, 0.15, 0.001, "m"), Prop("diameter", "Nail diameter", 0.0029, 0.0015, 0.006, 0.0001, "m"),
                             Prop("show_field", "Show field lines", False, kind="bool", help="Draw its magnetic field lines (a drawing only)")],
                      readouts=[Readout("amps", "Current", "A", 2, "Through its coil"), Readout("magnetized", "Magnetized", "%", 1, "How strongly its nail is magnetized, % of the most iron takes"),
                                Readout("pull_mN", "Magnetic pull", "mN", 2)],
                      tags=["electromagnet", "coil", "nail", "battery", "wire", "turns", "magnet", "current", "switch"],
                      description="An iron nail wrapped with turns of copper wire on AA batteries, held point down in a clamp. Switched on, current in the coil makes "
                                  "the nail a magnet: it picks up paper clips. More turns or more batteries make it stronger, until the nail's iron is fully "
                                  "magnetized; switched off it lets them go. It has its own AA batteries (switch it with on and on_at): the circuits module has no coil to wire one into a circuit.",
                      source="24 AWG wire 84.2 mΩ/m; AA 1.5 V, about 0.2 Ω; coil field n·I in a nail core magnetized up to M_s (2.0 T) [AHARONI] [CHIKAZUMI].",
                      anchor="the middle of the nail", facts="50 turns · 2 AA · ≈ 6 A", edit=[{"kind": "rotate"}]))
    register(ItemType("can-on-side", "Empty can on its side", CATEGORY, build_can_side, module="magnetism",
                      props=[Prop("material", "Can", "aluminium", kind="choice", choices=["aluminium", "steel"],
                                  help="An aluminium soda can (15 g) is not magnetic; a steel food can (50 g) is"),
                             Prop("diameter", "Diameter", 0.0662, 0.04, 0.12, 0.001, "m"), Prop("height", "Length", 0.1224, 0.05, 0.2, 0.001, "m"),
                             Prop("mass", "Weight", 0.015, 0.005, 0.2, 0.001, "kg", "Empty: soda can 15 g, food can 50 g")],
                      readouts=soft_read,
                      tags=["can", "soda can", "empty can", "rolling can", "aluminium can", "steel can", "tin can", "static", "roll"],
                      description="An empty can lying on its side, free to roll. A charged balloon held near an aluminium one rolls it toward the balloon "
                                  "(the metal is polarized); a magnet pulls only a steel one.",
                      source="A 12 oz soda can, Ø 66 × 122 mm, 15 g empty, aluminium (not magnetic) [FUR].",
                      anchor="its centre (its axis)", facts="aluminium · 15 g · rolls"))


# ---------------------------------------------------------------- things a magnet does not pull
def build_plastic_clip(c, P):
    L, T, Wd, m = 0.033, 0.0012, 0.008, 0.0003
    mat = c.mat(base="polypropylene", overrides={}, density=round(m / (L * T * Wd), 3))
    c.slab("clip", L, T, Wd, material=mat, look="plastic", words="a plastic paper clip", color=COLOURS.get(P["color"]) or "#2e6fc4")


def build_foil(c, P):
    d, m = P["diameter"], P["mass"]
    r = d / 2
    mat = c.mat(base="aluminium foil", overrides={}, density=round(m / (4 / 3 * math.pi * cube(r)), 3))
    c.ball("ball", r, material=mat, look="foil", words="a crumpled aluminium foil ball")


def build_copper(c, P):
    mat = c.mat(base="copper", overrides={}, density=round(0.002 / (0.02 * 0.008 * 0.008), 3))
    c.slab("coil", 0.02, 0.008, 0.008, material=mat, look="copper", words="a little coil of copper wire")


def build_key(c, P):
    mat = c.mat(base="brass", overrides={}, density=round(0.006 / (0.05 * 0.002 * 0.022), 3))
    c.slab("key", 0.05, 0.002, 0.022, material=mat, look="brass", words="a brass key")


def build_bead(c, P):
    c.ball("bead", P["diameter"] / 2, material=c.mat(base="varnished hardwood", overrides={}), look="wood", words="a wooden bead")


def build_sheet(c, P):
    kind = P["material"]
    real, body_t, base, look = SHEETS[kind]
    w = P["width"]
    # standing on its edge in a clip stand (fixed: it does not fall over); a body at least 1 mm thick, the weight its real sheet's
    mat = c.mat(base=base, overrides={}, density=round(MATERIALS[base]["density"] * real / body_t, 3))
    sid = c.slab("sheet", body_t, w, w, 0.0, w / 2, material=mat, look=look, words=f"a sheet of {kind}")
    if kind == "steel":
        _soft(c, "iron", sid, body_t, w, w, real * w * w)


SHEETS = {      # material: (real thickness m, body thickness m, catalog material, look)
    "paper": (0.0001, 0.001, "paper", "paper"),
    "cardboard": (0.002, 0.002, "cardboard", "cardboard"),
    "plastic": (0.002, 0.002, "ABS plastic", "plastic"),
    "glass": (0.003, 0.003, "glass", "glass"),
    "aluminium": (0.001, 0.001, "aluminium", "aluminium"),
    "steel": (0.0005, 0.001, "low-carbon steel", "steel"),
}


def build_clip_thread(c, P):
    th = P["thread"]
    L, T, Wd, m = 0.033, 0.001, 0.008, 0.00045
    # a lump of putty on the table holds a cotton thread; the clip stands on its end at the thread's other end, its length up
    c.slab("anchor", 0.02, 0.006, 0.02, 0.0, 0.003, kind="static", material=c.mat(base="modeling clay", overrides={}), look="clay", words="a lump of putty")
    mat = c.mat(base="low-carbon steel", overrides={}, density=round(m / (L * T * Wd), 3))
    sid = c.slab("clip", L, T, Wd, 0.0, 0.006 + th + L / 2, langle=90.0, material=mat, look="zinc plate", words="a steel paper clip on a thread")
    c.joint("rope", "thread", a=None, b="clip", anchorA=(0.0, 0.006), anchorB=(-L / 2, 0.0), length=_r(th), thickness=0.0005)
    _soft(c, "iron", sid, L, CLIP_WIRE, CLIP_BUNDLE, m / STEEL)


def _others():
    register(ItemType("plastic-clip", "Plastic clip", CATEGORY, build_plastic_clip, module="magnetism",
                      props=[Prop("color", "Colour", "blue", kind="choice", choices=[k for k in COLOURS if k != "silver"])],
                      tags=["plastic clip", "plastic", "not magnetic", "non-magnetic", "test object"],
                      description="An all-plastic paper clip (0.3 g). Not magnetic: a magnet does not pull it at all.",
                      source="Polypropylene clip, 33 mm, about 0.3 g.", anchor="its centre", facts="plastic · 0.3 g · not magnetic"))
    register(ItemType("foil-ball", "Foil ball", CATEGORY, build_foil, module="magnetism",
                      props=[Prop("diameter", "Diameter", 0.02, 0.008, 0.06, 0.001, "m"), Prop("mass", "Weight", 0.001, 0.0002, 0.01, 0.0001, "kg")],
                      tags=["aluminium foil", "aluminum foil", "tin foil", "foil ball", "metal", "not magnetic", "conductor"],
                      description="A crumpled ball of aluminium kitchen foil (2 cm, 1 g). A metal, but not magnetic; it conducts, so a charged balloon pulls it.",
                      source="Kitchen foil 16 µm: a 15 × 15 cm sheet weighs about 1 g. Aluminium is not ferromagnetic [FUR].",
                      anchor="its centre", facts="aluminium · 1 g · not magnetic"))
    register(ItemType("copper-wire", "Copper wire coil", CATEGORY, build_copper, module="magnetism",
                      tags=["copper", "wire", "metal", "not magnetic", "conductor"],
                      description="A little coil of bare copper wire (2 g). A metal, but a magnet does not pull it.",
                      source="Copper 8960 kg/m³ (CRC Handbook); diamagnetic, χ ≈ −1e-5: no pull you could see.", anchor="its centre", facts="copper · 2 g · not magnetic"))
    register(ItemType("brass-key", "Brass key", CATEGORY, build_key, module="magnetism",
                      tags=["key", "brass", "metal", "not magnetic"],
                      description="A brass house key lying flat (5 cm, 6 g). Brass (copper and zinc) is not magnetic.",
                      source="A brass key blank is about 6 g. Brass is not ferromagnetic [FUR].", anchor="its centre", facts="brass · 6 g · not magnetic"))
    register(ItemType("wooden-bead", "Wooden bead", CATEGORY, build_bead, module="magnetism",
                      props=[Prop("diameter", "Diameter", 0.016, 0.006, 0.04, 0.001, "m")],
                      tags=["bead", "wood", "not magnetic", "test object"],
                      description="A round wooden bead (16 mm, 1.5 g). Not magnetic.", source="Beech bead 16 mm, 700 kg/m³: 1.5 g.",
                      anchor="its centre", facts="wood · 1.5 g · not magnetic"))
    register(ItemType("barrier-sheet", "Sheet (barrier)", CATEGORY, build_sheet, dynamic=False, module="magnetism",
                      props=[Prop("material", "Material", "cardboard", kind="choice", choices=list(SHEETS),
                                  help="Paper, cardboard, plastic, glass and aluminium let a magnet's pull straight through; a steel sheet (0.5 mm) takes the field into itself and blocks most of a ceramic magnet's pull (and is itself pulled); a strong neodymium magnet saturates it and pulls through about half"),
                             Prop("width", "Size", 0.1, 0.04, 0.3, 0.005, "m")],
                      readouts=[Readout("magnetized", "Magnetized", "%", 1)],
                      tags=["sheet", "barrier", "paper", "cardboard", "through", "shield", "between", "screen", "plate"],
                      description="A square sheet standing upright in a clip stand, to put between a magnet and what it pulls. The pull passes through "
                                  "paper, cardboard, plastic, glass and aluminium unchanged; a steel sheet blocks most of it (a ceramic magnet's: 88 % at 8 mm).",
                      source="Non-magnetic materials have µ_r = 1 to within 1e-5: the field passes as through air [FUR].",
                      anchor="the middle of its bottom edge (on the table)", facts="10 × 10 cm · cardboard", edit=[{"kind": "rotate"}]))
    register(ItemType("clip-on-thread", "Clip on a thread", CATEGORY, build_clip_thread, module="magnetism",
                      props=[Prop("thread", "Thread length", 0.1, 0.02, 0.4, 0.005, "m")],
                      readouts=[Readout("pull_mN", "Magnetic pull", "mN", 2)],
                      tags=["thread", "string", "floating clip", "paper clip", "hover", "tethered", "without touching"],
                      description="A steel paper clip tied by a thread to a lump of putty on the table, standing up at the thread's end. Hold a magnet "
                                  "(fixed) just above it and the clip floats in the air on its taut thread without touching the magnet; with no magnet it flops over.",
                      source="Gem no. 1 clip, 0.45 g [FUR]; a cotton thread.", anchor="the putty's bottom middle (on the table)", facts="10 cm thread"))


# ---------------------------------------------------------------- compass and the Earth's field
EARTH_T = 2e-5      # T: the horizontal component of Earth's field over the contiguous US [WMM]


def build_compass(c, P):
    D = P["size"]
    L = 0.8 * D
    w = 0.1 * L
    t = 0.0005
    # a compass standing face-on to the camera (a real one lies flat and turns level: here its needle turns in the machine plane), its
    # needle a magnetized steel diamond on a pivot at the item's (x, y), in a case on a small foot. Fluid-filled: the needle's swing dies
    # away in about half a second (damping c = 4·I/s, I its moment of inertia)
    c.slab("foot", round(0.6 * D, 5), 0.008, round(0.6 * D, 5), 0.0, -D / 2 - 0.004, kind="static", material=c.mat(base="ABS plastic", overrides={}),
           look="plastic", words="the compass's foot", color="#2b2b2b")
    m_n = STEEL * L * w / 2 * t
    inertia = m_n * (L * L + w * w) / 24
    north = 1 if P["north"] == "right" else -1
    # (the needle always turns on its pivot, a held compass's too: only the case's foot is fixed. It starts pointing north, along the Earth's
    # field: to the left when north is to the left)
    sid = c.poly("needle", [(L / 2, 0.0), (0.0, w / 2), (-L / 2, 0.0), (0.0, -w / 2)], t, langle=0.0 if north > 0 else 180.0,
                 material=c.mat(base="low-carbon steel", overrides={}), kind="dynamic", look="steel", words="a compass needle", pivot={"x": 0.0, "y": 0.0},
                 damping=float(f"{4 * inertia:.4g}"))
    # magnetized along its length (hardened steel at a 10:1 needle's working point, M ≈ 0.5 MA/m: provisional): the charge of each half's
    # slanted sides, M × its middle's cross-section, centred a quarter of the way along; faces half its width wide. `needle`: the engine
    # never leaves it balancing exactly against the field (a magnet flipped level with it), as no real needle stays
    M = 5e5
    q = M * w * t
    s = q / (w / 2 * t)
    c.process("magnetism", "field", role="magnet", solid=sid,
              faces=[_face(L / 4, 0.0, 0.0, w / 2, t, s), _face(-L / 4, 0.0, math.pi, w / 2, t, -s)], needle=True)
    if P["earth"]:
        c.process("magnetism", "earth", role="earth", x=north * EARTH_T, y=0.0)


def _compass():
    register(ItemType("compass", "Compass", CATEGORY, build_compass, module="magnetism",
                      props=[Prop("size", "Size", 0.05, 0.03, 0.12, 0.005, "m", "The case's diameter"),
                             Prop("earth", "Earth's field", True, kind="bool", help="The Earth's own field (20 µT, level) turns the needle north when no magnet is near"),
                             Prop("north", "North is", "right", kind="choice", choices=["right", "left"], help="Which way north is in the picture")],
                      readouts=[Readout("heading_deg", "Needle points", "°", 0, "Which way the needle's north (red) end points, counter-clockwise from the right")],
                      tags=["compass", "needle", "north", "direction", "navigation", "field", "earth's field"],
                      description="A compass standing face-on (its needle turns in the picture's plane). Its red end points north (to the right) "
                                  "unless a magnet is near: then it lines up with the magnet's field, its red end toward the magnet's south pole.",
                      source="A magnetized steel needle (4 cm) on a pivot in a fluid-filled case; Earth's horizontal field 20 µT [WMM]. A real compass lies flat.",
                      anchor="the needle's pivot (the case's centre)", facts="Ø 5 cm · red end north"))


# ---------------------------------------------------------------- static electricity
def _patch(rubbed, side, r):
    """A rubbed patch's charge (C, negative: latex takes electrons from hair or wool [TRIBO]), and where its point charge sits (x, y) in the
    balloon's frame, and its core radius (m)."""
    strokes = min(STROKES_MAX, max(0, int(rubbed)))
    q = -strokes * STROKE_C
    a = math.sqrt(PATCH_AREA / math.pi)
    depth = a / math.sqrt(2)
    ux, uy = SIDES[side]
    d = max(0.0, r - depth)
    return q, (ux * d, uy * d), depth


DIAG = 0.7071067811865476      # cos 45°
SIDES = {"bottom": (0.0, -1.0), "top": (0.0, 1.0), "left": (-1.0, 0.0), "right": (1.0, 0.0), "lower right": (DIAG, -DIAG), "lower left": (-DIAG, -DIAG)}
BALLOON_COLOURS = {"red": "#d62f3a", "blue": "#2f62d6", "yellow": "#f2c230", "green": "#2fa54a", "pink": "#ec6fa8", "orange": "#f08a24",
                   "purple": "#8a4fc8", "white": "#f2f2f2"}


def build_balloon(c, P):
    D = P["diameter"]
    r = D / 2
    wall = 0.00002
    # 3.5 g of latex for a 25 cm balloon (scaling with its skin's area) and its air's 3 % over-pressure (0.3 g at 25 cm): the engine counts the
    # air inside as neither weight nor lift, so the balloon weighs what its skin and that extra air do
    mass = 0.0035 * (D / 0.25) * (D / 0.25) + 0.03 * 1.2 * 4 / 3 * math.pi * cube(r)
    shell = 4 / 3 * math.pi * (cube(r) - cube(r - wall))
    mat = c.mat(base="latex", overrides={}, density=round(mass / shell, 3))
    sid = c.ball("balloon", r, material=mat, look="latex", words="a party balloon", wall=wall, color=BALLOON_COLOURS[P["color"]])
    q, (px, py), core = _patch(P["rubbed"], P["rubbed_side"], r)
    if q != 0:
        c.process("magnetism", "charge", role="charge", solid=sid, x=_r(px), y=_r(py), q=q, radius=_r(core),
                  capacitance=float(f"{4 * math.pi * EPS0 * r:.6g}"))
    if P["on_thread"]:
        th = P["thread"]
        c.slab("hook", 0.03, 0.01, 0.03, 0.0, r + th + 0.005, kind="static", material=c.mat(base="varnished hardwood", overrides={}),
               look="wood", words="a hook")
        c.joint("rope", "thread", a=None, b="balloon", anchorA=(0.0, r + th), anchorB=(0.0, r), length=_r(th), thickness=0.0005)


def build_paper_bits(c, P):
    n, size = int(P["count"]), P["size"]
    gsm, thick = PAPERS[P["paper"]]
    m = gsm * size * size
    mat = c.mat(base="paper", overrides={}, density=round(m / (size * 0.001 * size), 3))
    sp = size + 0.004
    x0 = -(n - 1) * sp / 2
    for i in range(n):
        sid = c.slab(f"bit{i + 1}", size, 0.001, size, x0 + i * sp, 0.0, material=mat, look="paper", words="a scrap of paper")
        # damp paper conducts enough to be fully polarized within a demo's seconds: a conductor of the scrap's real thickness
        c.process("magnetism", f"polar{i + 1}", role="polar", solid=sid, x=0.0, y=0.0, w=_r(size), h=thick, d=_r(size),
                  volume=float(f"{size * size * thick:.6g}"), epsr=0.0)


PAPERS = {"printer paper": (0.08, 0.0001), "tissue paper": (0.017, 0.00004)}     # kg/m² and real thickness (m)


def build_rod(c, P):
    L, d = P["length"], P["diameter"]
    plastic = P["material"] == "plastic"
    base = "ABS plastic" if plastic else "glass"
    sid = c.slab("rod", L, d, d, material=c.mat(base=base, overrides={}), look="plastic" if plastic else "glass",
                 words="a plastic rod" if plastic else "a glass rod", **({"color": "#2b2b2b"} if plastic else {}), **_held(c))
    # rubbed along its right half: plastic with wool goes negative, glass with silk positive [TRIBO]; 7 nC a stroke over the half's 70 cm²
    # (10 µC/m² at 10 strokes, well under air's 27 [AIR-BD]), as two point charges on its axis
    strokes = min(STROKES_MAX, max(0, int(P["rubbed"])))
    q = strokes * 7e-9 * (-1 if plastic else 1)
    if q != 0:
        for k, x in ((1, L / 8), (2, 3 * L / 8)):
            c.process("magnetism", f"charge{k}", role="charge", solid=sid, x=_r(x), y=0.0, q=q / 2, radius=_r(d / 2),
                      capacitance=float(f"{4 * math.pi * EPS0 * L / 4:.6g}"))


def build_pith(c, P):
    th, d = P["thread"], P["diameter"]
    r = d / 2
    c.slab("hook", 0.03, 0.01, 0.03, 0.0, r + th + 0.005, kind="static", material=c.mat(base="varnished hardwood", overrides={}), look="wood",
           words="a stand's arm")
    mat = c.mat(base="foam", overrides={}, density=round(0.00004 / (4 / 3 * math.pi * cube(r)), 3))
    sid = c.ball("ball", r, material=mat, look="foil", words="a pith ball coated with foil")
    c.joint("rope", "thread", a=None, b="ball", anchorA=(0.0, r + th), anchorB=(0.0, r), length=_r(th), thickness=0.0003)
    cap = float(f"{4 * math.pi * EPS0 * r:.6g}")
    c.process("magnetism", "charge", role="charge", solid=sid, x=0.0, y=0.0, q=round(P["charge_nC"] * 1e-9, 12), radius=_r(r), capacitance=cap,
              conductor=True)
    side = r * 1.6119919540164696
    c.process("magnetism", "polar", role="polar", solid=sid, x=0.0, y=0.0, w=_r(side), h=_r(side), d=_r(side),
              volume=float(f"{4 / 3 * math.pi * cube(r):.6g}"), epsr=0.0, round=True)


def _static():
    register(ItemType("balloon", "Balloon", CATEGORY, build_balloon, module="magnetism",
                      props=[Prop("diameter", "Diameter", 0.25, 0.15, 0.4, 0.01, "m"),
                             Prop("color", "Colour", "red", kind="choice", choices=list(BALLOON_COLOURS)),
                             Prop("rubbed", "Rubbed (strokes)", 0, 0, 20, 1, "", kind="int",
                                  help="Strokes on hair or a wool sweater: each puts 10 nC of negative charge on it, up to 10 strokes (100 nC, as much as its rubbed patch holds)"),
                             Prop("rubbed_side", "Rubbed side", "bottom", kind="choice", choices=list(SIDES),
                                  help="Where the charge sits (it stays where it was rubbed)"),
                             Prop("on_thread", "Hung on a thread", True, kind="bool", help="Hangs from a hook by a thread; off: it floats down on its own"),
                             Prop("thread", "Thread length", 0.5, 0.05, 1.5, 0.01, "m")],
                      readouts=[Readout("charge_uC", "Charge", "µC", 3), Readout("pull_mN", "Electric pull", "mN", 3)],
                      tags=["balloon", "static", "static electricity", "rub", "charge", "hair", "wool", "attract", "repel", "party balloon"],
                      description="An air-filled party balloon (25 cm, about 4 g with its extra air), hung on a thread from a hook. Rub it (strokes) and it "
                                  "takes a negative charge on the rubbed side: it pulls scraps of paper and light metal things toward it, and two rubbed "
                                  "balloons push each other apart.",
                      source="Latex 3.5 g; charge 10 nC a stroke up to 100 nC on a 40 cm² patch (25 µC/m², near air's limit [AIR-BD]); latex goes negative on hair [TRIBO].",
                      anchor="its centre", facts="25 cm · 3.8 g · rubbed: −10 nC a stroke"))
    register(ItemType("paper-bits", "Paper scraps", CATEGORY, build_paper_bits, module="magnetism",
                      props=[Prop("count", "Scraps", 8, 1, 20, 1, "", kind="int"), Prop("size", "Size", 0.006, 0.003, 0.012, 0.0005, "m"),
                             Prop("paper", "Paper", "tissue paper", kind="choice", choices=list(PAPERS), help="Tissue paper (17 g/m²) is about 5 times lighter than printer paper (80 g/m²)")],
                      readouts=[Readout("pull_mN", "Electric pull", "mN", 4)],
                      tags=["paper", "bits of paper", "paper scraps", "confetti", "static", "attract", "light objects"],
                      description="Small square scraps of paper lying in a row on the table. Neutral, but a charged balloon or rod held about a centimetre "
                                  "above them polarizes them: they stand up and jump to it.",
                      source="Tissue 17 g/m², copy paper 80 g/m²; damp paper conducts, so a scrap polarizes as a conducting flake would.",
                      anchor="the middle of the row, at the scraps' middle", facts="8 scraps · 6 mm · tissue"))
    register(ItemType("charged-rod", "Charged rod", CATEGORY, build_rod, dynamic=False, module="magnetism",
                      props=[Prop("material", "Rod", "plastic", kind="choice", choices=["plastic", "glass"],
                                  help="A plastic rod rubbed with wool goes negative; a glass rod rubbed with silk positive"),
                             Prop("rubbed", "Rubbed (strokes)", 10, 0, 20, 1, "", kind="int", help="7 nC a stroke on its rubbed (right) half, up to 10 strokes"),
                             Prop("length", "Length", 0.3, 0.1, 0.6, 0.01, "m"), Prop("diameter", "Diameter", 0.015, 0.006, 0.03, 0.001, "m")],
                      readouts=[Readout("charge_uC", "Charge", "µC", 3)],
                      tags=["rod", "charged rod", "glass rod", "plastic rod", "static", "electrostatics", "rubbed"],
                      description="A rod held in a clamp (it does not fall), rubbed along its right half: plastic with wool (negative) or glass with silk (positive).",
                      source="Up to 70 nC on the rubbed half (10 µC/m²) [TRIBO] [AIR-BD].", anchor="its centre", facts="plastic · −70 nC", edit=[{"kind": "rotate"}]))
    register(ItemType("pith-ball", "Pith ball", CATEGORY, build_pith, module="magnetism",
                      props=[Prop("thread", "Thread length", 0.25, 0.05, 0.6, 0.01, "m"), Prop("diameter", "Diameter", 0.012, 0.006, 0.03, 0.001, "m"),
                             Prop("charge_nC", "Starting charge", 0.0, -50.0, 50.0, 1.0, "nC")],
                      readouts=[Readout("charge_uC", "Charge", "µC", 4), Readout("pull_mN", "Electric pull", "mN", 4)],
                      tags=["pith ball", "electroscope", "foil ball", "static", "charge", "conductor", "thread"],
                      description="A tiny foil-coated pith ball (0.04 g) hanging on a silk thread. A charged thing pulls it; once it touches, it takes some of "
                                  "the charge and is pushed away (like charges repel).",
                      source="A pith-ball electroscope: a 12 mm foam ball coated with foil (a conductor), 0.04 g.", anchor="the ball's centre", facts="0.04 g · conductor"))


# ---------------------------------------------------------------- existing parts of magnetic or conducting materials (the build hook)
def _bbox(body):
    if body["kind"] == "ball":
        return None
    if body["kind"] == "slab":
        return 0.0, 0.0, body["width"], body["height"], body["width"] * body["height"] * body["depth"]
    xs = [p["x"] for p in body["points"]]
    ys = [p["y"] for p in body["points"]]
    pts = body["points"]
    area = 0.0
    for k in range(len(pts)):
        p, q = pts[k], pts[(k + 1) % len(pts)]
        area += p["x"] * q["y"] - q["x"] * p["y"]
    return (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, max(xs) - min(xs), max(ys) - min(ys), area / 2 * body["depth"]


def _world_of(sb, s):
    """A solid's origin in the world (m): a welded part's `at` is in its parent's frame (a guess good enough to say what is near what)."""
    x, y = s["at"]["x"], s["at"]["y"]
    p, hops = s.get("parent"), 0
    while p is not None and hops < 8:
        par = next((t for t in sb.solids if t["id"] == p), None)
        if par is None:
            break
        a = par.get("angle", 0.0)
        cs, sn = cos(a), sin(a)
        x, y = par["at"]["x"] + x * cs - y * sn, par["at"]["y"] + x * sn + y * cs
        p, hops = par.get("parent"), hops + 1
    return x, y


def _sources(sb, recs):
    """The scene's magnets and coils as [(x, y, half size, the most dipole moment it can have, held still)]: a magnet's from its faces'
    charges, a coil's core's at its iron's saturation."""
    out = []
    for r in recs:
        s = next((t for t in sb.solids if t["id"] == r.get("solid")), None)
        if s is None:
            continue
        x, y = _world_of(sb, s)
        if r["role"] == "magnet":
            mx = my = half = 0.0
            for f in r["faces"]:
                q = f["sigma"] * f["width"] * f["depth"]
                mx += q * f["x"]
                my += q * f["y"]
                half = max(half, math.sqrt(f["x"] * f["x"] + f["y"] * f["y"]) + f["width"] / 2)
            out.append((x, y, half, math.sqrt(mx * mx + my * my), s["kind"] != "dynamic"))
        elif r["role"] == "soft" and r.get("coil"):
            ax, ay = abs(r["x"]) + r["w"] / 2, abs(r["y"]) + r["h"] / 2
            out.append((x, y, math.sqrt(ax * ax + ay * ay), r["ms"] * r["volume"], s["kind"] != "dynamic"))
    return out


def _reached(sources, x, y, half, tesla=REACH_T):
    """Whether a magnet or coil of `sources` could pull a part whose middle is (x, y) and whose half size is `half` (m): its strongest dipole's
    field, µ0·m/(2π r³), is over `tesla` at the part's nearest (or they overlap)."""
    for sx, sy, sh, m, _held in sources:
        dx, dy = x - sx, y - sy
        gap = math.sqrt(dx * dx + dy * dy) - half - sh
        if gap <= 0 or MU0 * m > 2 * math.pi * tesla * gap * gap * gap:
            return True
    return False


def _dielectric_eps(base, density, hollow):
    """A light non-metal part's ε_r for its polar record: its stuff's, thinned by the air in it (DIELECTRIC); a hollow ball's (a ping-pong ball,
    a balloon) as the solid ball of its shell's volume that is polarized as the thin shell is, α = ε0·V·(ε−1)(2ε+1)/(3ε) [JACKSON §4.4]."""
    eps_s, rho_s = DIELECTRIC.get(base, (EPS_OTHER, None))
    eps = eps_s if rho_s is None else 1 + (eps_s - 1) * min(1.0, density / rho_s)
    if hollow:
        a = min(2.7, (eps - 1) * (2 * eps + 1) / (3 * eps))
        eps = (3 + 2 * a) / (3 - a)
    return round(eps, 4)


def _magnetize(sb, scene):
    """After every item is built: when the scene has a magnet (or a coil), every part of a magnetic material of an item without records of its
    own, within the reach of a magnet or coil (REACH_T), becomes soft iron; when it has a charge, every such metal part a conductor the field
    polarizes, and every light part of anything else (under LIGHT_KG, none of its sizes over LIGHT_M, free to move) a dielectric (DIELECTRIC).
    A scene with neither gets nothing (built exactly as before)."""
    recs = [p for p in sb.processes if p["kind"] == "magnetism"]
    if not recs:
        return
    magnets = any(r["role"] == "magnet" or (r["role"] == "soft" and r.get("coil")) for r in recs)
    charges = any(r["role"] == "charge" for r in recs)
    sources = _sources(sb, recs) if magnets else []
    # (an item that has records of its own says itself which of its parts are magnetic: a nail's head is part of its core's circuit)
    taken = {r.get("item") for r in recs}
    for s in sb.solids:
        if s["item"] in taken:
            continue
        base = sb.base_of(s["material"])
        body = s["body"]
        soft = magnets and base in SOFT
        polar = charges and base in CONDUCTORS
        dielectric = charges and not polar and s["kind"] == "dynamic" and not base.endswith(" magnet")
        if not soft and not polar and not dielectric:
            continue
        if body["kind"] == "ball" and s.get("shape") == "cylinder" and s.get("length"):
            # a cylinder lying along the picture's depth (a can on its side, a roller): a square of its section's area, its length deep
            r, L = body["radius"], s["length"]
            side = r * 1.7724538509055159       # √π
            geo = dict(x=0.0, y=0.0, w=_r(side), h=_r(side), d=_r(L))
            steel, box, rnd = math.pi * r * r * L, side * side * L, False
        elif body["kind"] == "ball":
            r = body["radius"]
            outer = 4 / 3 * math.pi * cube(r)
            inner = 4 / 3 * math.pi * cube(r - body["wall"]) if body.get("wall") else 0.0
            side = r * 1.6119919540164696     # a cube of the ball's volume
            geo = dict(x=0.0, y=0.0, w=_r(side), h=_r(side), d=_r(side))
            steel, box, rnd = outer - inner, outer, True
        else:
            cx, cy, w, h, vol = _bbox(body)
            geo = dict(x=_r(cx), y=_r(cy), w=_r(w), h=_r(h), d=_r(body["depth"]))
            steel, box, rnd = vol, w * h * body["depth"], False
        if not (geo["w"] > 0 and geo["h"] > 0 and geo["d"] > 0 and box > 0):
            # (a part thinner than the records' 0.01 mm, or of no area: too small to matter to a field, and a record of it would be refused)
            continue
        if soft or dielectric:
            wx, wy = _world_of(sb, s)
            half = math.sqrt(geo["w"] * geo["w"] + geo["h"] * geo["h"]) / 2
        still = s["kind"] != "dynamic" and all(src[4] for src in sources)
        if soft and (not still or _reached(sources, wx, wy, half)):
            m = SOFT[base]
            # (a hollow ball shields as a solid one until its shell saturates: magnetized as the whole ball, at most M_s × its shell's share;
            # steel wool as its wire's share of the pad)
            fill = min(1.0, sb.materials[s["material"]]["density"] / m["solid"]) if "solid" in m else 1.0
            rec = {"kind": "magnetism", "id": f"{s['id']}/iron", "item": s["item"], "role": "soft", "solid": s["id"], **geo,
                   "volume": float(f"{box:.6g}"), "ms": round(m["ms"] * min(1.0, steel / box) * fill, 1),
                   "chi": m["chi"] if fill == 1.0 else round(max(1.0, m["chi"] * fill), 3)}
            if rnd:
                rec["round"] = True
            if not _reached(sources, wx, wy, half, GRID_T):
                rec["grid"] = False
            sb.processes.append(rec)
        if polar:
            rec = {"kind": "magnetism", "id": f"{s['id']}/polar", "item": s["item"], "role": "polar", "solid": s["id"], **geo,
                   "volume": float(f"{box:.6g}"), "epsr": 0.0}
            if rnd:
                rec["round"] = True
            sb.processes.append(rec)
        elif dielectric:
            density = sb.materials[s["material"]]["density"]
            if density * steel > LIGHT_KG or max(geo["w"], geo["h"], geo["d"]) > LIGHT_M:
                continue
            hollow = body["kind"] == "ball" and bool(body.get("wall")) and s.get("shape") != "cylinder"
            rec = {"kind": "magnetism", "id": f"{s['id']}/polar", "item": s["item"], "role": "polar", "solid": s["id"], **geo,
                   "volume": float(f"{steel:.6g}"), "epsr": _dielectric_eps(base, density, hollow)}
            if rnd:
                rec["round"] = True
            sb.processes.append(rec)


# ---------------------------------------------------------------- goal kinds (web/sim/modules/magnetism.js reports the same, number for number)
TOUCH = 0.003       # m: two things whose outlines end this close touch (the engine's contact skins keep 1.5-2 mm between resting solids)


def _outline(s, pose):
    """A solid's outline in the world at a placement: ("circle", x, y, r) or ("poly", [(x, y)...]) counter-clockwise."""
    b = s["body"]
    x, y, a = pose["x"], pose["y"], pose.get("angle", 0.0)
    if b["kind"] == "ball":
        return ("circle", x, y, b["radius"])
    if b["kind"] == "slab":
        hw, hh = b["width"] / 2, b["height"] / 2
        hb = hw * b.get("taper", 1.0)
        pts = [(-hb, -hh), (hb, -hh), (hw, hh), (-hw, hh)]
    else:
        pts = [(p["x"], p["y"]) for p in b["points"]]
    c, n = cos(a), sin(a)
    return ("poly", [(x + px * c - py * n, y + px * n + py * c) for px, py in pts])


def _near_on_poly(poly, x, y):
    best, inside = None, True
    for i in range(len(poly)):
        (px, py), (qx, qy) = poly[i], poly[(i + 1) % len(poly)]
        ex, ey = qx - px, qy - py
        if ex * (y - py) - ey * (x - px) < 0:
            inside = False
        l2 = ex * ex + ey * ey
        u = max(0.0, min(1.0, ((x - px) * ex + (y - py) * ey) / l2)) if l2 > 0 else 0.0
        cx, cy = px + u * ex, py + u * ey
        d = math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
        if best is None or d < best:
            best = d
    return best, inside


def _gap(oa, ob):
    """The nearest distance between two outlines (0 when they overlap)."""
    if oa[0] == "circle" and ob[0] == "circle":
        dx, dy = ob[1] - oa[1], ob[2] - oa[2]
        return max(0.0, math.sqrt(dx * dx + dy * dy) - oa[3] - ob[3])
    if oa[0] == "circle" or ob[0] == "circle":
        circ, poly = (oa, ob[1]) if oa[0] == "circle" else (ob, oa[1])
        d, inside = _near_on_poly(poly, circ[1], circ[2])
        return 0.0 if inside else max(0.0, d - circ[3])
    best, hit = None, False
    for P_, Q in ((oa[1], ob[1]), (ob[1], oa[1])):
        for (x, y) in P_:
            d, inside = _near_on_poly(Q, x, y)
            if inside:
                hit = True
            if best is None or d < best:
                best = d
    return 0.0 if hit else best


def _pose_at(ctx, sid, k):
    p = ctx.frames[k]["placements"].get(sid)
    if p is None:
        p = ctx.frames[0]["placements"].get(sid)
    if p is None:
        s = next(x for x in ctx.doc["solids"] if x["id"] == sid)
        p = {"x": s["at"]["x"], "y": s["at"]["y"], "angle": s.get("angle", 0.0)}
    return p


def _item_gap(ctx, a, b, k):
    """The nearest distance between any solid of item a and any of item b at frame k."""
    best = None
    for sa in ctx.solids(a):
        oa = _outline(sa, _pose_at(ctx, sa["id"], k))
        for sb_ in ctx.solids(b):
            g = _gap(oa, _outline(sb_, _pose_at(ctx, sb_["id"], k)))
            if best is None or g < best:
                best = g
    return best


def _cm(m):
    return round(m * 100, 2)


def goal_attracts(ctx, g):
    """{kind: "attracts", source, item}: the item starts apart from the source (more than 3 mm: one that starts touching was not pulled to it)
    and ends touching it (within 3 mm), or 1 cm or more nearer to it than it started."""
    a, b = g.get("source"), g.get("item")
    if not ctx.known(a) or not ctx.known(b) or a == b:
        return None
    g0, g1 = _item_gap(ctx, a, b, 0), _item_gap(ctx, a, b, len(ctx.frames) - 1)
    if g0 is None or g1 is None:
        return None
    ok = g0 > TOUCH and (g1 <= TOUCH or g0 - g1 >= 0.01)
    return {"label": g.get("label") or f"{ctx.name(a)} pulls {ctx.name(b)} to it", "ok": ok, "kind": "attracts", "source": a, "item": b,
            "gap_cm": [_cm(g0), _cm(g1)]}


def goal_repels(ctx, g):
    """{kind: "repels", a, b, min_m?}: their gap grows by at least min_m (default 1 cm) at its widest (two hung balloons swing apart and back)."""
    a, b = g.get("a"), g.get("b")
    if not ctx.known(a) or not ctx.known(b) or a == b:
        return None
    least = ctx.num(g.get("min_m"))
    least = 0.01 if least is None else least
    gaps = [_item_gap(ctx, a, b, k) for k in range(len(ctx.frames))]
    if any(x is None for x in gaps):
        return None
    widest = max(gaps)
    return {"label": g.get("label") or f"{ctx.name(a)} and {ctx.name(b)} push apart", "ok": widest - gaps[0] >= least, "kind": "repels", "a": a, "b": b,
            "gap_cm": [_cm(gaps[0]), _cm(gaps[-1])], "widest_cm": _cm(widest)}


def goal_sticks(ctx, g):
    """{kind: "sticks", item, to}: the item touches `to` (within 3 mm) through the last half second of the run."""
    a, b = g.get("item"), g.get("to")
    if not ctx.known(a) or not ctx.known(b) or a == b:
        return None
    n = len(ctx.frames)
    t_end = ctx.times[-1]
    ks = [k for k in range(n) if ctx.times[k] >= t_end - 0.5]
    gaps = [_item_gap(ctx, b, a, k) for k in ks]
    if not gaps or any(x is None for x in gaps):
        return None
    return {"label": g.get("label") or f"{ctx.name(a)} sticks to {ctx.name(b)}", "ok": all(x <= TOUCH for x in gaps), "kind": "sticks", "item": a, "to": b,
            "gap_cm": _cm(gaps[-1])}


def _mid_y(ctx, item, k):
    sids = [s["id"] for s in ctx.solids(item, True)]
    if not sids:
        return None
    return sum(_pose_at(ctx, i, k)["y"] for i in sids) / len(sids)


def goal_lifts(ctx, g):
    """{kind: "lifts", source, item, min_m?}: the item rises at least min_m (default 5 mm) and ends nearer the source than it started."""
    a, b = g.get("source"), g.get("item")
    if not ctx.known(a) or not ctx.known(b) or a == b:
        return None
    least = ctx.num(g.get("min_m"))
    least = 0.005 if least is None else least
    y0, y1 = _mid_y(ctx, b, 0), _mid_y(ctx, b, len(ctx.frames) - 1)
    g0, g1 = _item_gap(ctx, a, b, 0), _item_gap(ctx, a, b, len(ctx.frames) - 1)
    if y0 is None or g0 is None or g1 is None:
        return None
    rise = y1 - y0
    return {"label": g.get("label") or f"{ctx.name(a)} lifts {ctx.name(b)}", "ok": rise >= least and g1 < g0, "kind": "lifts", "source": a, "item": b,
            "rise_cm": _cm(rise)}


def _wrap(deg):
    d = math.fmod(deg, 360.0)
    if d > 180:
        d -= 360
    if d < -180:
        d += 360
    return d


def goal_points(ctx, g):
    """{kind: "points", compass, toward?: item, angle_deg?, tol_deg?}: the compass's needle (its north end) ends pointing at the item's middle
    (or along angle_deg, counter-clockwise from the right), within tol_deg (default 15)."""
    cid = g.get("compass")
    if not ctx.known(cid):
        return None
    head = ctx.state(cid, "heading_deg")
    if head is None:
        return None
    tol = ctx.num(g.get("tol_deg"))
    tol = 15.0 if tol is None else tol
    k = len(ctx.frames) - 1
    want = ctx.num(g.get("angle_deg"))
    toward = g.get("toward")
    if want is None and ctx.known(toward):
        needle = next((s for s in ctx.solids(cid, True)), None)
        sol = ctx.solids(toward)
        if needle is None or not sol:
            return None
        p = _pose_at(ctx, needle["id"], k)
        tx = sum(_pose_at(ctx, s["id"], k)["x"] for s in sol) / len(sol)
        ty = sum(_pose_at(ctx, s["id"], k)["y"] for s in sol) / len(sol)
        want = math.atan2(ty - p["y"], tx - p["x"]) * 180 / math.pi
    if want is None:
        return None
    off = abs(_wrap(head[-1] - want))
    what = ctx.name(toward) if ctx.known(toward) and ctx.num(g.get("angle_deg")) is None else f"{round(want)}°"
    return {"label": g.get("label") or f"{ctx.name(cid)} points at {what}", "ok": off <= tol, "kind": "points", "compass": cid,
            "heading_deg": round(head[-1], 1), "off_deg": round(off, 1)}


def goal_holds(ctx, g):
    """{kind: "holds", magnet, count, items?}: at least `count` pieces (solids of soft-iron items: clips, nails, washers...; or of `items`) end
    hanging from the magnet: touching it or a piece that does, and touching nothing else (not resting on the table)."""
    mid = g.get("magnet")
    if not ctx.known(mid):
        return None
    want = ctx.num(g.get("count"))
    want = 1 if want is None else want
    k = len(ctx.frames) - 1
    pool = g.get("items") if isinstance(g.get("items"), list) else None
    soft = {p["item"] for p in ctx.doc.get("processes", []) if p.get("kind") == "magnetism" and p.get("role") == "soft"}
    cands = [s for s in ctx.doc["solids"] if s["kind"] == "dynamic" and s["item"] != mid
             and ((s["item"] in pool) if pool is not None else (s["item"] in soft))]
    ids = {s["id"] for s in cands}
    outl = {s["id"]: _outline(s, _pose_at(ctx, s["id"], k)) for s in cands}
    mag = [_outline(s, _pose_at(ctx, s["id"], k)) for s in ctx.solids(mid)]
    rest = [_outline(s, _pose_at(ctx, s["id"], k)) for s in ctx.doc["solids"] if s["item"] != mid and s["id"] not in ids]
    free = [s for s in cands if all(_gap(outl[s["id"]], o) > TOUCH for o in rest)]
    held, frontier = set(), [s["id"] for s in free if any(_gap(outl[s["id"]], o) <= TOUCH for o in mag)]
    while frontier:
        sid = frontier.pop(0)
        if sid in held:
            continue
        held.add(sid)
        for s in free:
            if s["id"] not in held and _gap(outl[s["id"]], outl[sid]) <= TOUCH:
                frontier.append(s["id"])
    n = len(held)
    return {"label": g.get("label") or f"{ctx.name(mid)} holds {int(want) if want == int(want) else want} or more", "ok": n >= want, "kind": "holds",
            "magnet": mid, "held": n}


def _lowest(o):
    return o[2] - o[3] if o[0] == "circle" else min(p[1] for p in o[1])


def goal_levitates(ctx, g):
    """{kind: "levitates", item, count?, min_m?}: ring magnets on a dowel: at least `count` of the rings (default all but the bottom one) end
    floating, a gap of at least min_m (default 2 mm) under each to the ring or base below it. Anything else (a clip on a thread under a magnet):
    it ends in the air, its lowest point at least min_m (default 1 cm) above the table, touching nothing of another item."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    least = ctx.num(g.get("min_m"))
    k = len(ctx.frames) - 1
    rings = [s for s in ctx.solids(iid, True) if s.get("part", "").startswith("ring") and "-" not in s.get("part", "")]
    base = next((s for s in ctx.solids(iid) if s.get("part") == "base"), None)
    if not rings or base is None:
        mine = ctx.solids(iid, True)
        if not mine:
            return None
        least = 0.01 if least is None else least
        top = next((s for s in ctx.doc["solids"] if s.get("itemType") == "table" and s.get("part") == "top" and s["body"].get("kind") == "slab"), None)
        floor = 0.0 if top is None else _pose_at(ctx, top["id"], 0)["y"] + top["body"]["height"] / 2
        outl = [_outline(s, _pose_at(ctx, s["id"], k)) for s in mine]
        low = min(_lowest(o) for o in outl) - floor
        others = [s for s in ctx.doc["solids"] if s["item"] != iid]
        free = all(_gap(o, _outline(s, _pose_at(ctx, s["id"], k))) > TOUCH for o in outl for s in others)
        return {"label": g.get("label") or f"{ctx.name(iid)} floats in the air", "ok": low >= least and free, "kind": "levitates", "item": iid,
                "height_cm": _cm(low), "touching": not free}
    least = 0.002 if least is None else least
    want = ctx.num(g.get("count"))
    want = len(rings) - 1 if want is None else want
    ys = sorted(_pose_at(ctx, s["id"], k)["y"] for s in rings)
    h = rings[0]["body"]["height"]
    floor = _pose_at(ctx, base["id"], k)["y"] + base["body"]["height"] / 2
    gaps = []
    below = floor
    for y in ys:
        gaps.append(y - h / 2 - below)
        below = y + h / 2
    floating = sum(1 for x in gaps if x >= least)
    return {"label": g.get("label") or f"{ctx.name(iid)}: {int(want) if want == int(want) else want} float", "ok": floating >= want, "kind": "levitates",
            "item": iid, "floating": floating, "gaps_mm": [round(x * 1000, 1) for x in gaps]}


def goal_not_attracted(ctx, g):
    """{kind: "not_attracted", source, item, max_m?}: the item is NOT pulled to the source: all through the run it never comes more than max_m
    (default 3 mm: settling on the table, a nudge) nearer to it than it started (the plastic clip, the brass key, the unrubbed balloon's
    scraps of a "which things does it pull?" lesson)."""
    a, b = g.get("source"), g.get("item")
    if not ctx.known(a) or not ctx.known(b) or a == b:
        return None
    most = ctx.num(g.get("max_m"))
    most = TOUCH if most is None else most
    gaps = [_item_gap(ctx, a, b, k) for k in range(len(ctx.frames))]
    if any(x is None for x in gaps):
        return None
    nearer = gaps[0] - min(gaps)
    return {"label": g.get("label") or f"{ctx.name(b)} is not pulled to {ctx.name(a)}", "ok": nearer <= most, "kind": "not_attracted", "source": a,
            "item": b, "gap_cm": [_cm(gaps[0]), _cm(gaps[-1])], "nearer_cm": _cm(nearer)}
