"""The fracture module: things that break when a force passes a real threshold, and the padding that saves them.

Items: raw-egg (cracks, then smashes into shell pieces and a spill), drinking-glass (shatters), ceramic-plate (breaks into sherds), cushion
(foam pad, packing foam, bubble wrap, cotton balls, pillow stuffing, crumpled paper, a folded towel, carpet: padding that absorbs an
impact), egg-drop-box (the egg-drop challenge: an egg in a padded box, with a parachute), snap-bridge (spaghetti, craft sticks, chalk or a
chocolate bar across two supports: it bends and snaps under load), block-tower (a stack of wooden blocks, loose or glued with sticky tack,
tape, a glue stick or white glue) and window-pane (a sheet of window glass in a wooden frame, or loose, that shatters when hit hard). The engine's side is tooling/src/sim/modules/fracture.ts (the physics: tooling/src/sim/fracture.ts); the
exact JavaScript port of this file, with the AI's plug-ins, is web/sim/modules/fracture.js.

A breakable thing is one solid while whole; its pieces are solids of its own built inside it from the start, which the engine keeps parked
(resized to nothing, following it, touching nothing) until it breaks: then they replace it, each with its share of the mass (the masses add up
to the whole's), moving as that part of it moved. Any solid whose material is padding (CUSHIONS) squashes when a breakable hits it, and so
does another module's soft thing (the softbody module's inflated, foam and clay balls by their own laws, a trampoline's sprung mat, or any
solid a module gives a `contact_law`: see soft_table).

Sources (cited where used):
[EGG-F] Quasi-static compression of hen eggs between flat plates: rupture force 34.9 N on the long axis, 36.4 N on the short axis (Hisex
        Brown; Nedomová, Trnka, Buchar et al., Acta Univ. Agric. Silvic. Mendelianae Brun., Mendel University in Brno); reviews give a mean of
        32.4 N (30-40 N). An egg breaks at 35 N here (its `strength`).
[EGG-V] Trnka, Nedomová, Buchar et al.: high-speed films of hen eggs dropped 50-1500 mm onto a rigid floor (figshare 703897, 703895): at a
        1.0 m/s impact the shell cracks partly without spilling; at 4 m/s it breaks. So an egg's contact stiffness on a rigid floor is
        k = F²/(m v²) = 35² / (0.057 x 1.0²) = 21 500 N/m: it cracks from 1.0 m/s (a 5 cm drop) and smashes from twice its strength.
[EGG-M] USDA large egg: at least 56.7 g (57 g); the shell is about 9-12 % of an egg's mass (USDA Egg-Grading Manual): 11 % here.
[GLASS] Pilkington ATS-129 and NGA FM05-12: annealed soda-lime float glass, mean modulus of rupture 41 MPa (fully tempered 165 MPa);
        2500 kg/m³. [NITE] NITE (Japan) Accident Information Special News No. 33: tempered glass tableware dropped from 70 cm onto tiles over
        concrete broke none bottom-first. A drinking glass's contact stiffness on a hard floor (1.5 MN/m) and its breaking force (1840 N:
        a 3.0 m/s, 46 cm, bottom-first drop) are calibrations that agree with those (a tempered glass, about 4 x stronger, would survive
        6 m/s): provisional, not measured.
[PORC] Porcelain and stoneware bend at 40-110 MPa (anorthite porcelainised stoneware about 100 MPa, Acta Phys. Pol. A 127 (2015); lab
        porcelain 27-39 MPa; feldspar porcelain 112 MPa). A dinner plate's stiffness (2 MN/m) and breaking force (2470 N: a flat 2.6 m/s,
        35 cm drop onto a hard floor) are calibrations: provisional.
[PASTA] Dried thread-like pasta: bending stress at breaking about 36 MPa, elastic modulus about 4.1 GPa (Food Science (China) 33(23):83,
        2012; spaghetti 2.2-5.0 GPa, J. Emerging Investigators 2022); Barilla n.5 spaghetti 1.75 mm; dry pasta 1450 kg/m³.
[WOOD]  Wood Handbook FPL-GTR-190 (2010) Table 5-3a: paper birch, modulus of rupture 85 MPa, E 11.0 GPa; craft sticks are birch,
        114 x 10 x 2 mm, about 600 kg/m³.
[GYPSUM] Set gypsum bends at 1.7-22 MPa (wallboard, ASTM C473: 1.7 MPa; extruded gypsum at least 4.8 MPa; cast plaster about 22 MPa):
        school chalk (a porous calcium sulfate / carbonate stick, 10 mm) is taken as 3 MPa, E 2 GPa, 1400 kg/m³: provisional.
[CHOC]  Milk chocolate: three-point bend fracture stress about 2.5 MPa and E 0.4 GPa (provisional; measured in J. Mater. Sci. 2023,
        doi 10.1007/s10853-023-08324-7); 1270 kg/m³.
[PU]    Flexible polyurethane foam 25-35 kg/m³: compression load deflection at 40 % = 2-8 kPa (DIN EN ISO 3386-1; US 12458150, US 8541479):
        4 kPa; densification from about 80 % (Gibson & Ashby, Cellular Solids, 2nd ed. 1997, ch. 5).
[EPS]   Expanded polystyrene EPS 100: 100 kPa at 10 % (EN 13163 class CS(10)100), about 17 kg/m³; densification from about 75 %.
[AIR]   Bubble wrap: trapped air, Boyle's law σ = φ·p0·ε/(1 − ε), bubbles covering φ ≈ 0.55 of the film, p0 = 101.3 kPa (bursting left
        out); about 9 kg/m³.
[VANWYK] van Wyk, J. Textile Inst. 37 (1946) T285: fibre assemblies σ = s0·((1 − ε)⁻³ − 1). s0 calibrated: polyester fiberfill 230 Pa
        (a 5 kg head on about 300 cm² sinks about halfway into a pillow), cotton balls 150 Pa, crumpled paper 1 kPa, a folded terry towel 3
        kPa, carpet pile 6.6 kPa (a 70 kg step on about 150 cm² presses the pile about halfway): provisional.
[RUBBER] A rubber mat: E about 3 MPa (soft rubber 1-5 MPa): provisional.
[CHUTE] Knacke, Parachute Recovery Systems Design Manual (1992), table 5-1: a flat circular canopy's drag coefficient 0.75-0.80 on its
        nominal area (0.8); a plastic bag canopy about 30 g/m² (provisional).
[BOX]   A corrugated box's board weighs about 0.45 kg/m² (catalog_items.py "cardboard"); its crush stiffness under an egg-drop box,
        50 kN/m, is provisional.
[PVA]   White (PVA) wood glue: ASTM D905 block shear about 25 MPa on maple (Franklin International, Titebond); a glued face pulled apart
        is limited by the wood's tension across the grain, 3-5 MPa (Wood Handbook table 5-3a): 3 MPa in tension, 6 MPa in shear.
[TAPE]  Masking tape (3M 2090): peel adhesion 2.7 N/cm (25 oz/in) (3M data sheet): two strips across a joint w wide hold 2 x 270 N/m x w.
[TACK]  Reusable putty adhesive: about 10 kPa; a glue stick on wood: about 0.2 MPa (both provisional).
[HAMILTON] Hamilton, Poultry Sci. 61 (1982) 2022: a fresh hen's egg's specific gravity 1.065-1.100 (1.08 used, as the fluids module's egg): it
        sinks in fresh water and floats in salt water of about 11-12 % salt (1.08 kg/L, CRC).
[EDGE]  Brittle against brittle (a glass dropped on a glass, a rim on a rim): the contact is a hard edge or a rim, not a flat landing, so the
        stress concentrates (Hertzian contact; glass-on-glass contact is the classic cause of breakage on bottling lines): such a hit breaks it
        at half the force a flat landing on a hard floor does (0.5: a calibration, provisional).
[PLATE] A pane held round its edge, hit at its middle, as a simply supported round plate of radius a (half its smaller side): stiffness
        k = 16π·D·(1 + ν)/((3 + ν)·a²), D = E·t³/(12·(1 − ν²)); breaking load P = 2π·t²·σ/(3·[(1 + ν)·ln(a/r0) + 1]) under a load over a
        radius r0 = 5 mm (a ball's contact) (Timoshenko & Woinowsky-Krieger, Theory of Plates and Shells, 2nd ed. (1959) §19; Roark's
        Formulas for Stress and Strain, table 11.2 case 16). Soda-lime glass E 72 GPa, ν 0.22 (Pilkington); σ = 41 MPa x 2: glass's strength
        under a load lasting milliseconds is about twice its 60 s modulus of rupture (static fatigue, n = 16: (60 s / 1 ms)^(1/16) = 2.0;
        ASTM E1300's load-duration factors). A 60 cm square, 3 mm pane: 36 kN/m, 258 N (a 145 g baseball at about 3.6 m/s; provisional).
[SOFT]  Other modules' soft things, in series like padding (tooling/src/sim/fracture.ts laws 5-8): an inflated ball F = Δp·π(2·R_eff·x − x²)
        [CROSS: Cross, Am. J. Phys. 67, 222 (1999)], a foam ball F = (4/3)·E*·√R_eff·x^1.5 [Johnson, Contact Mechanics (1985) §4.2], clay
        F = p·π(2·R_eff·x − x²) with p = 3·σ_y [Tabor 1951], R_eff = R·r/(R + r) the two curved surfaces' (Hertz); a trampoline's mat F = k·x
        (its springs' stiffness per metre of dip: the mat is a light membrane, so what lands on it is slowed by its own mass).
"""
import math

NEEDED = ("register", "ItemType", "Prop", "Readout", "register_goal_kind", "register_build_hook", "MATERIALS", "add_look", "CATEGORIES",
          "LOOK_FILL", "TYPES", "GOAL_KINDS", "props_of")

CAT = "Breaking & padding"
MODULE = "fracture"
SQ2 = math.sqrt(2.0)
C45 = math.sqrt(0.5)                        # cos 45° = sin 45° (a square root: the same bits in JavaScript)
OUT8 = 2.0 / math.sqrt(2.0 + SQ2)           # 1 / cos 22.5°: an 8-sided outline round a curve touches it at its sides' middles

# Padding: material -> compression law [law, p1, p2, p3] (tooling/src/sim/fracture.ts stress()): 1 cellular foam [σ_ref, ε_ref, ε_D],
# 2 trapped air [φ·p0], 3 fibres [s0], 4 solid rubber [E, ε_max].
CUSHIONS = {
    "foam": [1, 4000.0, 0.4, 0.8],                  # [PU]
    "packing foam": [1, 100000.0, 0.1, 0.75],       # [EPS]
    "bubble wrap": [2, 55700.0, 0.0, 0.0],          # [AIR]
    "cotton balls": [3, 150.0, 0.0, 0.0],           # [VANWYK]
    "pillow stuffing": [3, 230.0, 0.0, 0.0],        # [VANWYK]
    "crumpled paper": [3, 1000.0, 0.0, 0.0],        # [VANWYK]
    "folded towel": [3, 3000.0, 0.0, 0.0],          # [VANWYK]
    "carpet": [3, 6600.0, 0.0, 0.0],                # [VANWYK]
    "rubber mat": [4, 3000000.0, 0.5, 0.0],         # [RUBBER]
}
PADS = ["foam", "packing foam", "bubble wrap", "cotton balls", "pillow stuffing", "crumpled paper", "folded towel", "carpet"]
BOX_PADS = ["none", "foam", "bubble wrap", "cotton balls", "crumpled paper", "pillow stuffing", "packing foam"]

EGG_L, EGG_W, EGG_M = 0.057, 0.044, 0.057       # [EGG-M]
EGG_K = 21500.0                                  # N/m [EGG-V]
EGG_LIMIT = 35.0                                 # N [EGG-F]
SHELL_SHARE = 0.11                               # [EGG-M]
GLASS_K, GLASS_LIMIT, GLASS_M = 1500000.0, 1840.0, 0.25     # [GLASS] [NITE]
PLATE_K, PLATE_LIMIT, PLATE_M = 2000000.0, 2470.0, 0.45     # [PORC]
BOX_K = 50000.0                                  # N/m [BOX]
BOARD = 0.45                                     # kg/m² [BOX]
CHUTE_CD, CHUTE_AREAL = 0.8, 0.03                # [CHUTE]
EDGE = 0.5                                       # [EDGE] the share of its breaking force at which a hard brittle-on-brittle hit breaks it
# What a breakable's real volume is (kg/m³ of its whole outside): its outline x depth is not (an egg's 8-sided prism holds 1.6 x its volume),
# so in a scene with a liquid the build adds the fluids module's {kind: "displace", item, volume_ml} for it (its pieces' outlines count too).
TRUE_DENSITY = {"raw-egg": 1080.0,               # [HAMILTON]
                "drinking-glass": 2500.0,        # [GLASS]: open, it fills with water and sinks (like the fluids module's mug)
                "ceramic-plate": 2400.0}         # [PORC]: stoneware 2300-2400 kg/m³
# Window glass [PLATE]
PANE_E, PANE_NU, PANE_SIGMA, PANE_R0 = 72000000000.0, 0.22, 82000000.0, 0.005

# Beams: made of -> (section, width (m, front to back), height (m), bending strength (Pa), E (Pa), density, material)
BEAMS = {
    "spaghetti": ("round", 0.00175, 0.00175, 36000000.0, 4100000000.0, "dry pasta"),       # [PASTA]
    "craft sticks": ("rect", 0.01, 0.002, 85000000.0, 11000000000.0, "birch"),             # [WOOD]
    "chalk": ("round", 0.01, 0.01, 3000000.0, 2000000000.0, "chalk"),                      # [GYPSUM]
    "chocolate bar": ("rect", 0.035, 0.008, 2500000.0, 400000000.0, "milk chocolate"),     # [CHOC]
}
BEAM_REST = 0.02             # m a beam rests on each support
BEAM_PIECES = 6
BLOCK_GAP = 0.001          # m between a tower's blocks as built (see build_tower)
# A piece's density in the document while it is parked inside the whole thing (kg/m³: it weighs next to nothing, so whatever adds up the
# document's moving solids, the AI's weights among them, counts the thing once); its real mass is in its record (`masses`) and the engine gives
# it that mass when it lets it go.
PARKED = 0.001

# Glue: name -> (tension, shear) strength, Pa ("tape" by its block's depth: 540 / d)
GLUES = {"sticky tack": (10000.0, 10000.0), "glue stick": (200000.0, 200000.0), "white glue": (3000000.0, 6000000.0)}   # [TACK] [PVA]
GLUE_NAMES = ["none", "sticky tack", "tape", "glue stick", "white glue"]


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CAT not in CATEGORIES:
        CATEGORIES.append(CAT)
    _looks()
    _materials()
    _egg()
    _glass()
    _plate()
    _cushion()
    _box()
    _bridge()
    _tower()
    _pane()
    register_build_hook(soft_table)
    for kind, fn in (("breaks", goal_breaks_any), ("survives", goal_survives_any), ("breaks_first", goal_breaks_first),
                     ("knocked_down", goal_knocked_down)):
        register_goal_kind(kind, fn)


def _r5(v):
    return round(v, 5)


def _ln(x):
    """ln x (x > 0) from + − × ÷ and square roots only, so JavaScript's port gets the same bits (math.log's last bit is the platform's):
    x is brought within 0.9-1.1 by square roots (each halves its log), then 2·atanh((x − 1)/(x + 1)) by its series."""
    if not x > 0:
        return 0.0
    k = 0
    while (x > 1.1 or x < 0.9) and k < 64:
        x = math.sqrt(x)
        k += 1
    z = (x - 1) / (x + 1)
    z2 = z * z
    total = 0.0
    term = z
    for n in range(1, 26, 2):
        total += term / n
        term *= z2
    out = 2 * total
    for _ in range(k):
        out *= 2
    return out


def _given(c):
    return c.item.get("props") or {}


def _name(c):
    return c.item.get("name") or TYPES[c.item["type"]].name


def _mat(name, **kw):
    MATERIALS.setdefault(name, {"rolling": 0.0, "side": 0.0, **kw})


def _looks():
    for key, kw in (("packing foam", dict(fill="#f4f4ee", shade="#d6d6cc", roughness=0.9, metalness=0.0, clearcoat=0.0)),
                    ("bubble wrap", dict(fill="#dfeef2", shade="#aac4cc", roughness=0.15, metalness=0.0, clearcoat=0.6, transmission=0.6)),
                    ("cotton", dict(fill="#fbfbf7", shade="#e2e2da", roughness=1.0, metalness=0.0, clearcoat=0.0)),
                    ("fiberfill", dict(fill="#f6f6f2", shade="#dcdcd4", roughness=1.0, metalness=0.0, clearcoat=0.0)),
                    ("crumpled paper", dict(fill="#ece8dc", shade="#c9c3b2", roughness=0.95, metalness=0.0, clearcoat=0.0)),
                    ("towel", dict(fill="#7fb3d5", shade="#5a8fb2", roughness=1.0, metalness=0.0, clearcoat=0.0)),
                    ("egg yolk", dict(fill="#f2b632", shade="#d9951a", roughness=0.25, metalness=0.0, clearcoat=0.8)),
                    ("pasta", dict(fill="#f0d68a", shade="#cfae5c", roughness=0.55, metalness=0.0, clearcoat=0.1)),
                    ("chalk", dict(fill="#f7f6f0", shade="#d8d6cc", roughness=1.0, metalness=0.0, clearcoat=0.0)),
                    ("chocolate", dict(fill="#6b4226", shade="#4a2b17", roughness=0.45, metalness=0.0, clearcoat=0.2)),
                    ("birch", dict(fill="#e8d3a8", shade="#c9b07f", roughness=0.7, metalness=0.0, clearcoat=0.0)),
                    ("ceramic", dict(fill="#f5f3ee", shade="#d3cfc5", roughness=0.2, metalness=0.0, clearcoat=0.8))):
        if key not in LOOK_FILL:
            add_look(key, **kw)


def _materials():
    _mat("packing foam", density=17, bounce=0.3, friction=0.6, look="packing foam",
         source="Expanded polystyrene EPS 100, about 17 kg/m³, 100 kPa at 10 % (EN 13163 CS(10)100). Bounce and friction provisional.")
    _mat("bubble wrap", density=9, bounce=0.5, friction=0.5, look="bubble wrap",
         source="Polyethylene film with 10 mm air bubbles, about 9 kg/m³ in bulk; trapped air squashes by Boyle's law. Bounce and friction provisional.")
    _mat("cotton balls", density=40, bounce=0.05, friction=0.8, look="cotton",
         source="Loose cotton wool about 40 kg/m³; fibres squash by van Wyk's law (J. Textile Inst. 37, 1946): provisional.")
    _mat("pillow stuffing", density=20, bounce=0.1, friction=0.8, look="fiberfill",
         source="Polyester fiberfill about 20 kg/m³ in a pillow; fibres squash by van Wyk's law: provisional.")
    _mat("crumpled paper", density=30, bounce=0.2, friction=0.6, look="crumpled paper",
         source="Loosely crumpled newspaper about 30 kg/m³: provisional.")
    _mat("folded towel", density=150, bounce=0.05, friction=0.9, look="towel",
         source="A folded cotton terry towel about 150 kg/m³: provisional.")
    _mat("egg insides", density=1035, bounce=0.0, friction=1.0, look="egg yolk",
         source="Egg white and yolk about 1.03-1.04 kg/L; a spill does not bounce or slide.")
    _mat("dry pasta", density=1450, bounce=0.3, friction=0.4, look="pasta",
         source="Dry durum-wheat pasta about 1450 kg/m³ [PASTA]. Bounce and friction provisional.")
    _mat("chalk", density=1400, bounce=0.2, friction=0.5, look="chalk",
         source="School chalk (calcium sulfate / carbonate) about 1400 kg/m³: provisional.")
    _mat("milk chocolate", density=1270, bounce=0.1, friction=0.5, look="chocolate",
         source="Milk chocolate about 1270 kg/m³: provisional.")
    _mat("birch", density=600, bounce=0.6, friction=0.4, look="birch",
         source="Paper birch about 600 kg/m³ at 12 % moisture (Wood Handbook FPL-GTR-190 table 5-3a).")


def _area(pts):
    """A polygon's area (the shoelace sum in order; web/sim the same)."""
    a = 0.0
    n = len(pts)
    for k in range(n):
        x1, y1 = pts[k]
        x2, y2 = pts[(k + 1) % n]
        a += x1 * y2 - x2 * y1
    return a / 2


def _clip(pts, a, b, c):
    """The part of a convex polygon where a·x + b·y <= c (Sutherland-Hodgman), its points rounded to 5 decimals as c.poly keeps them."""
    out = []
    n = len(pts)
    for k in range(n):
        x1, y1 = pts[k]
        x2, y2 = pts[(k + 1) % n]
        d1 = a * x1 + b * y1 - c
        d2 = a * x2 + b * y2 - c
        if d1 <= 0:
            out.append((x1, y1))
        if (d1 <= 0) != (d2 <= 0):
            u = d1 / (d1 - d2)
            out.append((x1 + u * (x2 - x1), y1 + u * (y2 - y1)))
    clean = []
    for x, y in out:
        p = (_r5(x), _r5(y))
        if not clean or clean[-1] != p:
            clean.append(p)
    if len(clean) > 1 and clean[0] == clean[-1]:
        clean.pop()
    return clean


def _rounded(pts):
    return [(_r5(x), _r5(y)) for x, y in pts]


def _egg_points(L, W):
    """A hen's egg seen side on, blunt end left: 8 points round the curve x = L/2·cos t, y = W/2·sin t·(1 − 0.08·cos t), pushed out so its
    sides touch the curve (the model draws the curve itself)."""
    a = L / 2 * OUT8
    b = W / 2 * OUT8
    s = C45
    return _rounded([(a, 0.0), (s * a, s * b * (1 - 0.08 * s)), (0.0, b), (-(s * a), s * b * (1 + 0.08 * s)), (-a, 0.0),
                     (-(s * a), -(s * b * (1 + 0.08 * s))), (0.0, -b), (s * a, -(s * b * (1 - 0.08 * s)))])


def _readouts_brittle(what):
    return [Readout("broken", "Broken", "", 0, f"0 whole, 1 cracked, 2 in pieces ({what})", words={0: "whole", 1: "cracked", 2: "in pieces"}),
            Readout("peak_force", "Biggest force", "N", 1, "The largest force it has felt: an impact's peak, or a steady load"),
            Readout("share", "Of its breaking force", "×", 2, "The biggest force over the force that breaks it (1 or more: it broke)"),
            Readout("impact_speed", "Hardest hit", "m/s", 2, "The speed of its hardest impact")]


# ---------------------------------------------------------------- raw egg
def _egg():
    register(ItemType("raw-egg", "Raw egg", CAT, build_raw_egg, module=MODULE,
                      props=[Prop("length", "Length", EGG_L, 0.03, 0.1, 0.001, "m"), Prop("width", "Width", EGG_W, 0.02, 0.08, 0.001, "m"),
                             Prop("mass", "Weight", EGG_M, 0.01, 0.3, 0.001, "kg", "Follows the size until you type a weight", auto=("length", "width")),
                             Prop("strength", "Breaks at", EGG_LIMIT, 5.0, 200.0, 1.0, "N", "The force that cracks its shell: hen eggs 30-40 N")],
                      readouts=_readouts_brittle("an egg cracks, then smashes when hit twice as hard"),
                      tags=["egg", "raw egg", "fragile", "breakable", "egg drop", "crack", "shell"], anchor="its centre",
                      description="A raw hen's egg that breaks: it cracks when a force on it passes its breaking force (35 N: dropped about 5 cm onto a "
                                  "hard floor) and smashes into shell pieces and a spill when hit twice as hard. Padding under it (a cushion, a pillow) "
                                  "lets it fall much farther.",
                      source="35 N quasi-static breaking force (Mendel University); cracks at a 1.0 m/s impact on a rigid floor (Trnka et al.).",
                      facts="57 g · cracks at 35 N (a 5 cm drop on a hard floor)", edit=[{"kind": "rotate"}]))


def build_raw_egg(c, P):
    given = _given(c)
    L, W = P["length"], P["width"]
    if "mass" not in given:
        P["mass"] = EGG_M * (L * W * W) / (EGG_L * EGG_W * EGG_W)
    m = P["mass"]
    pts = _egg_points(L, W)
    depth = _r5(W)
    a = _area(pts)
    left = pts[2:7]
    right = [pts[6], pts[7], pts[0], pts[1], pts[2]]
    h = 0.004
    spill = _rounded([(-0.4 * L, -h), (0.4 * L, -h), (0.4 * L, h), (-0.4 * L, h)])
    al, ar = _area(left), _area(right)
    masses = [round(SHELL_SHARE * m * al / (al + ar), 6), round(SHELL_SHARE * m * ar / (al + ar), 6), round((1 - SHELL_SHARE) * m, 6)]
    sid = c.poly("egg", pts, depth, material=c.mat(base="eggshell", density=round(m / (a * depth), 6), overrides={}), look="eggshell", words="a raw hen's egg")
    s1 = c.poly("shell-1", left, depth, material=c.mat(base="eggshell", density=PARKED, overrides={}), look="eggshell", words="a broken piece of eggshell", kind="dynamic")
    s2 = c.poly("shell-2", right, depth, material=c.mat(base="eggshell", density=PARKED, overrides={}), look="eggshell", words="a broken piece of eggshell", kind="dynamic")
    sp = c.poly("spill", spill, depth, material=c.mat(base="egg insides", density=PARKED, overrides={}), look="egg yolk", words="a spilled raw egg", kind="dynamic")
    c.process("fracture-brittle", "break", solid=sid, mode="free", name=_name(c), noun="shell", verb="smashes", mass=round(m, 6),
              limit=float(P["strength"]), k=EGG_K, radius=_r5(W / 2), area=0.0, smash=2.0, scatter=0.15, pieces=[s1, s2, sp], masses=masses, puddle=sp)


# ---------------------------------------------------------------- drinking glass
def _glass():
    register(ItemType("drinking-glass", "Drinking glass", CAT, build_glass, module=MODULE,
                      props=[Prop("diameter", "Width at the rim", 0.075, 0.04, 0.15, 0.001, "m"), Prop("height", "Height", 0.1, 0.05, 0.25, 0.001, "m"),
                             Prop("mass", "Weight", GLASS_M, 0.02, 2.0, 0.005, "kg", "Follows the size until you type a weight", auto=("diameter", "height")),
                             Prop("strength", "Breaks at", GLASS_LIMIT, 100.0, 20000.0, 10.0, "N",
                                  "The impact force that shatters it: an annealed tumbler about 1840 N (a 46 cm drop bottom-first onto a hard floor)")],
                      readouts=_readouts_brittle("a glass shatters at once"),
                      tags=["glass", "tumbler", "cup", "fragile", "breakable", "shatter", "glassware"], anchor="the middle of its bottom",
                      description="An annealed glass tumbler that shatters into shards when an impact's force passes its breaking force: dropped bottom-first "
                                  "onto a hard floor from above about 46 cm; a carpet or a cushion saves it from higher.",
                      source="Annealed soda-lime glass, modulus of rupture 41 MPa (Pilkington ATS-129); breaking force a calibration (see machines/mod_fracture.py).",
                      facts="250 g · shatters from about a 46 cm drop onto a hard floor"))


def _glass_outline(d, h):
    bw = 0.84 * d
    return _rounded([(-(bw / 2), 0.0), (bw / 2, 0.0), (d / 2, h), (-(d / 2), h)])


def build_glass(c, P):
    given = _given(c)
    d, h = P["diameter"], P["height"]
    if "mass" not in given:
        P["mass"] = GLASS_M * (d * h + d * d / 4) / (0.075 * 0.1 + 0.075 * 0.075 / 4)
    m = P["mass"]
    pts = _glass_outline(d, h)
    depth = _r5(d)
    rho = round(m / (_area(pts) * depth), 6)
    mat = c.mat(base="glass", density=rho, overrides={})
    sid = c.poly("glass", pts, depth, material=mat, look="glass", words="a drinking glass")
    low = _clip(pts, 0.0, 1.0, 0.2 * h)
    up = _clip(pts, 0.0, -1.0, -(0.2 * h))
    cuts = [low, _clip(_clip(up, 1.0, 0.0, 0.0), 0.0, 1.0, 0.6 * h), _clip(_clip(up, -1.0, 0.0, 0.0), 0.0, 1.0, 0.6 * h),
            _clip(_clip(up, 1.0, 0.0, 0.0), 0.0, -1.0, -(0.6 * h)), _clip(_clip(up, -1.0, 0.0, 0.0), 0.0, -1.0, -(0.6 * h))]
    parked = c.mat(base="glass", density=PARKED, overrides={})
    pieces = [c.poly(f"shard-{k + 1}", q, depth, material=parked, look="glass", words="a shard of broken glass", kind="dynamic") for k, q in enumerate(cuts)]
    whole = _area(pts)
    masses = [round(m * _area(q) / whole, 6) for q in cuts]
    bw = 0.84 * d
    c.process("fracture-brittle", "break", solid=sid, mode="free", name=_name(c), noun="glass", verb="shatters", mass=round(m, 6),
              limit=float(P["strength"]), k=GLASS_K, radius=0.0, area=round(math.pi * (bw / 2) * (bw / 2), 6), smash=1.0, scatter=0.25,
              pieces=pieces, masses=masses, puddle=None, edge=EDGE)


# ---------------------------------------------------------------- ceramic plate
def _plate():
    register(ItemType("ceramic-plate", "Ceramic plate", CAT, build_plate, module=MODULE,
                      props=[Prop("diameter", "Diameter", 0.26, 0.1, 0.4, 0.005, "m"), Prop("height", "Height", 0.025, 0.01, 0.06, 0.001, "m"),
                             Prop("mass", "Weight", PLATE_M, 0.05, 3.0, 0.01, "kg", "Follows the size until you type a weight", auto=("diameter",)),
                             Prop("strength", "Breaks at", PLATE_LIMIT, 100.0, 20000.0, 10.0, "N",
                                  "The impact force that breaks it: a stoneware dinner plate about 2470 N (a 35 cm flat drop onto a hard floor)")],
                      readouts=_readouts_brittle("a plate breaks into sherds at once"),
                      tags=["plate", "dish", "dinner plate", "ceramic", "porcelain", "fragile", "breakable"], anchor="the middle of its bottom",
                      description="A stoneware dinner plate that breaks into four sherds when an impact's force passes its breaking force: dropped flat onto "
                                  "a hard floor from above about 35 cm.",
                      source="Porcelain and stoneware bend at 40-110 MPa; breaking force a calibration (see machines/mod_fracture.py).",
                      facts="450 g · breaks from about a 35 cm drop onto a hard floor"))


def build_plate(c, P):
    given = _given(c)
    d, h = P["diameter"], P["height"]
    if "mass" not in given:
        P["mass"] = PLATE_M * (d * d) / (0.26 * 0.26)
    m = P["mass"]
    R = d / 2
    f = 0.36 * R
    pts = _rounded([(-f, 0.0), (f, 0.0), (R, 0.7 * h), (0.94 * R, h), (-(0.94 * R), h), (-R, 0.7 * h)])
    depth = _r5(d)
    mat = c.mat(base="ceramic", density=round(m / (_area(pts) * depth), 6), overrides={})
    sid = c.poly("plate", pts, depth, material=mat, look="ceramic", words="a ceramic dinner plate")
    cuts = [_clip(pts, 1.0, 0.0, -(0.5 * R)), _clip(_clip(pts, -1.0, 0.0, 0.5 * R), 1.0, 0.0, 0.0),
            _clip(_clip(pts, -1.0, 0.0, 0.0), 1.0, 0.0, 0.5 * R), _clip(pts, -1.0, 0.0, -(0.5 * R))]
    parked = c.mat(base="ceramic", density=PARKED, overrides={})
    pieces = [c.poly(f"sherd-{k + 1}", q, depth, material=parked, look="ceramic", words="a broken piece of a plate", kind="dynamic") for k, q in enumerate(cuts)]
    whole = _area(pts)
    masses = [round(m * _area(q) / whole, 6) for q in cuts]
    c.process("fracture-brittle", "break", solid=sid, mode="free", name=_name(c), noun="plate", verb="breaks", mass=round(m, 6),
              limit=float(P["strength"]), k=PLATE_K, radius=0.0, area=round(math.pi * f * f, 6), smash=1.0, scatter=0.2, pieces=pieces, masses=masses, puddle=None,
              edge=EDGE)


# ---------------------------------------------------------------- padding
def _cushion():
    register(ItemType("cushion", "Cushion pad", CAT, build_cushion, module=MODULE, material="foam", materials=list(PADS),
                      props=[Prop("width", "Width", 0.3, 0.03, 2.0, 0.01, "m"), Prop("thickness", "Padding layer", 0.05, 0.005, 0.5, 0.005, "m", "How thick the pad is"),
                             Prop("depth", "Front to back", 0.3, 0.03, 2.0, 0.01, "m")],
                      readouts=[Readout("squash", "Squashed", "m", 3, "How far a breakable thing that hit it squashed it (springing back after)")],
                      tags=["cushion", "padding", "pad", "foam", "pillow", "bubble wrap", "cotton", "landing pad", "soft", "mat", "egg drop"],
                      anchor="the middle of its bottom",
                      description="A pad of padding: foam, packing foam, bubble wrap, cotton balls, pillow stuffing, crumpled paper, a folded towel or carpet. "
                                  "A breakable thing that lands on it squashes it and feels a much smaller force than on a hard floor; thicker and softer "
                                  "padding saves it from higher. (Any pillow, foam block, sponge, carpet or rubber mat pads the same way.)",
                      source="Compression laws: flexible PU foam 4 kPa at 40 % (DIN EN ISO 3386-1); EPS 100 kPa at 10 % (EN 13163); bubble wrap by Boyle's law; "
                             "fibres by van Wyk's law.",
                      facts="30 × 30 cm · 5 cm of soft foam", edit=[{"kind": "top", "prop": "thickness"}]))


def build_cushion(c, P):
    t = P["thickness"]
    c.slab("pad", P["width"], t, P["depth"], 0.0, t / 2, words=f"a pad of {P['material']}")


# ---------------------------------------------------------------- egg-drop box
def _box():
    register(ItemType("egg-drop-box", "Egg-drop box", CAT, build_box, module=MODULE,
                      props=[Prop("size", "Box size", 0.15, 0.08, 0.4, 0.005, "m", "Each side of the cardboard cube"),
                             Prop("padding", "Padding", "cotton balls", kind="choice", choices=list(BOX_PADS), help="What fills the box around the egg"),
                             Prop("padding_thickness", "Padding round the egg", 0.03, 0.0, 0.15, 0.005, "m", "How thick it is all round the egg (no more than the box has room for)"),
                             Prop("parachute", "Parachute", 0.0, 0.0, 1.5, 0.05, "m", "The canopy's width (0: none); it slows the fall in air"),
                             Prop("strength", "Egg breaks at", EGG_LIMIT, 5.0, 200.0, 1.0, "N", "The force that cracks the egg inside")],
                      readouts=_readouts_brittle("the egg inside: 1 cracked, 2 smashed"),
                      tags=["egg drop", "egg drop challenge", "capsule", "container", "padding", "parachute", "box", "engineering", "design"],
                      anchor="the middle of its bottom",
                      description="The egg-drop challenge: a raw egg inside a cardboard box, padded all round, with a parachute if you like. When the box "
                                  "lands, the egg is pressed by its padding (softer and thicker padding: less force) or only by its share of the box's "
                                  "slowing on a soft landing; it cracks at 35 N. A parachute slows the fall.",
                      source="Egg 35 N, 21.5 kN/m (as the raw egg); padding laws as the cushion's; parachute drag coefficient 0.8 (Knacke 1992).",
                      facts="15 cm box · cotton balls 3 cm thick"))


def build_box(c, P):
    s = P["size"]
    room = (s - 0.006 - EGG_L) / 2
    t = max(0.0, min(P["padding_thickness"], room))
    P["padding_thickness"] = _r5(t)
    pad = P["padding"] if P["padding"] in CUSHIONS else None
    t = P["padding_thickness"] if pad is not None else 0.0
    egg_v = math.pi / 6 * EGG_L * EGG_W * EGG_W
    pad_v = max(0.0, (EGG_L + 2 * t) * (EGG_W + 2 * t) * (EGG_W + 2 * t) - egg_v) if pad is not None else 0.0
    pad_m = MATERIALS[pad]["density"] * pad_v if pad is not None else 0.0
    D = P["parachute"]
    chute_area = math.pi * D * D / 4
    chute_m = CHUTE_AREAL * chute_area + 0.002 if D > 0 else 0.0
    box_m = BOARD * 6 * s * s + pad_m + chute_m
    sid = c.slab("box", s, s, s, 0.0, s / 2, material=c.mat(base="cardboard", density=round(box_m / (s * s * s), 6), overrides={}), look="cardboard",
                 words="a closed cardboard box")
    pts = _egg_points(EGG_L, EGG_W)
    depth = _r5(EGG_W)
    egg = c.poly("egg", pts, depth, material=c.mat(base="eggshell", density=round(EGG_M / (_area(pts) * depth), 6), overrides={}), look="eggshell",
                 words="a raw egg padded inside the box")
    e = c.sb.solids[-1]
    e["at"] = {"x": 0.0, "y": 0.0}
    e.pop("angle", None)
    e["parent"] = sid
    c.process("fracture-brittle", "break", solid=egg, mode="boxed", name=_name(c), noun="egg", verb="smashes", mass=EGG_M, limit=float(P["strength"]),
              k=EGG_K, radius=_r5(EGG_W / 2), area=round(math.pi * (EGG_L / 2) * (EGG_W / 2), 6), smash=2.0, scatter=0.0, pieces=[], puddle=None, box=sid, boxk=BOX_K, boxarea=_r5(s * s),
              pad=(list(CUSHIONS[pad]) if pad is not None else None), padt=_r5(t))
    if D > 0:
        c.process("fracture-chute", "chute", solid=sid, area=round(chute_area, 6), cd=CHUTE_CD, lift=_r5(s / 2 + 0.6 * D))


# ---------------------------------------------------------------- snapping bridges
def _bridge():
    register(ItemType("snap-bridge", "Snapping bridge", CAT, build_bridge, module=MODULE,
                      props=[Prop("made_of", "Made of", "spaghetti", kind="choice", choices=list(BEAMS), help="What the beam across the gap is"),
                             Prop("strands", "Strands", 5, 1, 60, 1, "", "How many pieces of what it is made of lie side by side: strands of spaghetti, craft sticks, "
                                  "sticks of chalk or chocolate bars (1: one bar or one stick; more: stronger)", kind="int"),
                             Prop("span", "Span length", 0.2, 0.03, 0.6, 0.005, "m", "The gap between the supports it spans (wider: weaker)"),
                             Prop("support_height", "Support height", 0.1, 0.02, 0.5, 0.005, "m")],
                      readouts=[Readout("broken", "Broken", "", 0, "0 whole, 2 snapped", words={0: "whole", 1: "cracked", 2: "snapped"}),
                                Readout("load", "Load on it", "N", 2, "What presses down on it besides its supports"),
                                Readout("share", "Of its strength", "×", 2, "The biggest bending over the bending that snaps it (1: it snaps)"),
                                Readout("sag", "Sag", "m", 4, "How far its middle sags under the load")],
                      tags=["bridge", "spaghetti bridge", "beam", "snap", "break", "load", "strength", "chalk", "craft sticks", "popsicle sticks",
                            "chocolate", "engineering"],
                      anchor="the middle of the floor under the gap",
                      description="A beam of spaghetti, craft sticks, chalk or a chocolate bar across the gap between two supports. Put weights on it: it "
                                  "bends, and snaps where the bending passes its strength (5 strands of spaghetti over a 20 cm gap hold about 175 g in the middle). "
                                  "More strands hold more; a wider gap holds less.",
                      source="Bending strength: dry pasta 36 MPa, E 4.1 GPa; birch 85 MPa, 11 GPa (Wood Handbook); chalk 3 MPa; milk chocolate 2.5 MPa.",
                      facts="5 strands of spaghetti over a 20 cm gap"))


def _beam_section(made_of, n):
    """(height, depth, mass per metre, E·I, strength M_c) of n strands side by side."""
    kind, b, h, sigma, E, mat = BEAMS[made_of]
    if kind == "round":
        I = math.pi * b * b * b * b / 64
        Z = math.pi * b * b * b / 32
        A = math.pi * b * b / 4
    else:
        I = b * h * h * h / 12
        Z = b * h * h / 6
        A = b * h
    rho = MATERIALS[mat]["density"]
    return h, n * b, rho * A * n, E * I * n, sigma * Z * n


def build_bridge(c, P):
    made = P["made_of"] if P["made_of"] in BEAMS else "spaghetti"
    n = int(P["strands"])
    span, H = P["span"], P["support_height"]
    h, w, per_m, EI, Mc = _beam_section(made, n)
    L = span + 2 * BEAM_REST
    hp = max(h, 0.003)
    dp = max(w, 0.01)
    rho = round(per_m * L / (L * hp * dp), 6)
    mat = BEAMS[made][5]
    wood = c.mat(base="varnished hardwood", overrides={})
    sx = span / 2 + 0.025
    sd = max(0.12, dp)
    c.slab("support-left", 0.05, H, sd, -sx, H / 2, kind="static", material=wood, look="wood", words="a wooden support block")
    c.slab("support-right", 0.05, H, sd, sx, H / 2, kind="static", material=wood, look="wood", words="a wooden support block")
    m = c.mat(base=mat, density=rho, overrides={})
    look = MATERIALS[mat]["look"]
    # (whole, the beam is held as its supports hold it: a fixed solid, so a light strand under a heavy load stays put; its pieces move)
    beam = c.slab("beam", L, hp, dp, 0.0, H + hp / 2, kind="static", material=m, look=look, words=f"a beam of {made}")
    pieces = []
    # (its pieces carry the beam's real weight in the document: the whole beam is a fixed solid, so they are what counts it once; parked, they
    # are resized to nothing and follow it)
    parked = c.mat(base=mat, density=rho, overrides={})
    for i in range(BEAM_PIECES):
        dx = -(L / 2) + L / (2 * BEAM_PIECES) + i * L / BEAM_PIECES
        pid = c.slab(f"piece-{i + 1}", L / BEAM_PIECES, hp, dp, dx, H + hp / 2, material=parked, look=look, words=f"a broken piece of {made}", kind="dynamic")
        pieces.append([pid, _r5(dx), round(per_m * L / BEAM_PIECES, 6)])
    rest = span / 2 + BEAM_REST / 2
    c.process("fracture-beam", "snap", solid=beam, name=_name(c), noun=made, pieces=pieces, length=_r5(L), ei=float(f"{EI:.6g}"),
              mc=float(f"{Mc:.6g}"), per_m=float(f"{per_m:.6g}"), supports=[_r5(-rest), _r5(rest)], three=(made == "spaghetti"))


# ---------------------------------------------------------------- towers of blocks, loose or glued
def _tower():
    register(ItemType("block-tower", "Block tower", CAT, build_tower, module=MODULE,
                      props=[Prop("blocks", "Blocks", 6, 1, 20, 1, "", kind="int"), Prop("block_width", "Block width", 0.1, 0.02, 0.4, 0.005, "m"),
                             Prop("block_height", "Block height", 0.05, 0.01, 0.3, 0.005, "m"),
                             Prop("block_depth", "Block front to back", 0.05, 0.01, 0.3, 0.005, "m"),
                             Prop("glue", "Held together with", "none", kind="choice", choices=list(GLUE_NAMES),
                                  help="none: loose blocks; tape, glue or sticky tack join each block to the next until the joint's strength is passed")],
                      readouts=[Readout("broken", "Came apart", "", 0, "1 once a glued joint has let go, or a block has fallen off (dropped or tipped)", words={0: "no", 1: "yes"}),
                                Readout("blocks_fallen", "Blocks fallen", "", 0, "How many blocks have dropped more than half a block below where they "
                                        "were stacked, or tipped past 35° (a block that only slides along stays counted as standing)"),
                                Readout("top_height", "Height now", "m", 3, "How high its highest block's top is above its base now"),
                                Readout("share", "Of the glue's strength", "×", 2, "The most any joint has been pulled, over what it holds")],
                      tags=["tower", "blocks", "stack", "glued", "tape", "structure", "knock down", "engineering"], anchor="the middle of its base",
                      description="A tower of wooden blocks stacked one on another, loose or held together with sticky tack, tape, a glue stick or white glue. "
                                  "Loose blocks fall off when hit hard (a block that only slides along still stands); glued ones move as one until a joint's "
                                  "strength is passed (white glue: hardly ever). It reports how many blocks fell and how tall it stands now.",
                      source="Masking tape 2.7 N/cm peel (3M 2090); white glue 3 MPa across a wooden face (Wood Handbook); tack and glue stick provisional.",
                      facts="6 wooden blocks, 10 × 5 × 5 cm", edit=[{"kind": "top", "prop": "block_height"}]))


def build_tower(c, P):
    n = int(P["blocks"])
    w, h, d = P["block_width"], P["block_height"], P["block_depth"]
    wood = c.mat(base="varnished hardwood", overrides={})
    # (each block 1 mm over the one under it: rigid blocks placed exactly touching sit inside each other's contact skin and jitter apart in the
    # engine (a 10-block stack falls in 6 s); 1 mm apart they settle at once and stand)
    ids = [c.slab(f"block{i + 1}", w, h, d, 0.0, h / 2 + BLOCK_GAP + i * (h + BLOCK_GAP), material=wood, look="wood", words="a wooden block") for i in range(n)]
    glue = P["glue"] if P["glue"] in GLUE_NAMES else "none"
    if n >= 2:
        # (loose blocks too: the process says when the tower comes apart, two neighbours no longer stacked)
        sigma, tau = (0.0, 0.0) if glue == "none" else (540.0 / d, 540.0 / d) if glue == "tape" else GLUES[glue]
        c.process("fracture-glue", "glue", name=_name(c), glue=glue, blocks=ids, w=_r5(w), d=_r5(d), h=_r5(h), sigma=round(sigma, 3), tau=round(tau, 3))


# ---------------------------------------------------------------- a window pane
PANE_CUTS = [0.0, 0.21, 0.4, 0.62, 0.81, 1.0]      # where its shards part, up its height


def _pane():
    # (a fixed thing, as a window is: its loose sheet's solids are made moving by their builder)
    register(ItemType("window-pane", "Window pane", CAT, build_pane, dynamic=False, module=MODULE, material="glass", materials=["glass"],
                      props=[Prop("height", "Height", 0.6, 0.1, 1.5, 0.01, "m"),
                             Prop("width", "Front to back", 0.6, 0.1, 1.5, 0.01, "m", "Its width across the window (the side view sees its edge)"),
                             Prop("thickness", "Glass", 0.003, 0.002, 0.012, 0.001, "m", "How thick the glass is: 3 mm in a house window, 4-6 mm in big ones"),
                             Prop("mount", "Held", "frame", kind="choice", choices=["frame", "loose"],
                                  help="frame: fixed upright in a wooden window frame standing where it is placed; loose: a free sheet of glass (lay it flat "
                                       "or lean it)"),
                             Prop("strength", "Breaks at", 258.0, 20.0, 20000.0, 1.0, "N", "The force of a hit at its middle that shatters it: follows its "
                                  "size and glass until you type one", auto=("height", "width", "thickness"))],
                      readouts=_readouts_brittle("a pane shatters at once"),
                      tags=["window", "window pane", "pane", "glass sheet", "sheet of glass", "glass", "broken window", "fragile", "breakable",
                            "shatter", "baseball", "throw"],
                      anchor="the middle of its bottom",
                      description="A pane of window glass (3 mm) in a wooden frame, or loose. A ball thrown hard at it shatters it into shards that fall; "
                                  "a gentle toss bounces off. Thicker glass, or a smaller pane, takes a harder hit; a soft ball (a playground ball) "
                                  "hits it more gently than a hard one (a baseball).",
                      source="Plate bending (Timoshenko; Roark table 11.2): stiffness 16π·D·(1+ν)/((3+ν)·a²) and the load that breaks it "
                             "2π·t²·σ/(3·[(1+ν)·ln(a/r0)+1]); soda-lime glass E 72 GPa, 41 MPa x 2 for a millisecond hit (see machines/mod_fracture.py).",
                      facts="60 × 60 cm · 3 mm glass · shatters at 258 N (a baseball at about 4 m/s)", edit=[{"kind": "top", "prop": "height"}]))


def pane_numbers(H, W, t):
    """(stiffness N/m, breaking force N) of a pane held round its edge, hit at its middle [PLATE]."""
    a = min(H, W) / 2
    D = PANE_E * t * t * t / (12 * (1 - PANE_NU * PANE_NU))
    k = 16 * math.pi * D * (1 + PANE_NU) / ((3 + PANE_NU) * a * a)
    P = 2 * math.pi * t * t * PANE_SIGMA / (3 * ((1 + PANE_NU) * _ln(a / PANE_R0) + 1))
    return k, P


def build_pane(c, P):
    given = _given(c)
    H, W, t = P["height"], P["width"], P["thickness"]
    k, limit = pane_numbers(H, W, t)
    if "strength" not in given:
        P["strength"] = round(limit, 1)
    framed = P["mount"] != "loose"
    sill = 0.04 if framed else 0.0
    rho = MATERIALS["glass"]["density"]
    m = rho * H * W * t
    glass = c.mat(base="glass", overrides={})
    # (an outline round the item's anchor, as its shards' are: the engine parks them on the pane's own frame)
    whole = _rounded([(-(t / 2), sill), (t / 2, sill), (t / 2, sill + H), (-(t / 2), sill + H)])
    sid = c.poly("pane", whole, _r5(W), material=glass, look="glass", words="a pane of window glass", kind="static" if framed else "dynamic")
    if framed:
        wood = c.mat(base="varnished hardwood", overrides={})
        c.slab("frame-bottom", 0.06, sill, W + 0.08, 0.0, sill / 2, kind="static", material=wood, look="wood", words="the window frame's sill")
        c.slab("frame-top", 0.06, 0.04, W + 0.08, 0.0, sill + H + 0.02, kind="static", material=wood, look="wood", words="the window frame's top")
    # (framed, the pane is fixed, so its shards carry its weight in the document and count it once; loose, the moving whole counts it)
    parked = c.mat(base="glass", density=rho if framed else PARKED, overrides={})
    pieces = []
    masses = []
    for i in range(len(PANE_CUTS) - 1):
        y0 = sill + PANE_CUTS[i] * H
        y1 = sill + PANE_CUTS[i + 1] * H
        q = _rounded([(-(t / 2), y0), (t / 2, y0), (t / 2, y1), (-(t / 2), y1)])
        pieces.append(c.poly(f"shard-{i + 1}", q, _r5(W), material=parked, look="glass", words="a shard of window glass", kind="dynamic"))
        masses.append(round(m * (PANE_CUTS[i + 1] - PANE_CUTS[i]), 6))
    c.process("fracture-brittle", "break", solid=sid, mode="free", name=_name(c), noun="pane", verb="shatters", mass=round(m, 6),
              limit=float(P["strength"]), k=round(k, 1), radius=0.0, area=round(t * W, 6), smash=1.0, scatter=0.3, pieces=pieces, masses=masses,
              puddle=None, edge=EDGE)


# ---------------------------------------------------------------- the padding table, and what other modules' things need from this one
def _body_laws(sb):
    """[(solid id, law)]: other modules' soft things that a breakable meets through their own force law (tooling/src/sim/fracture.ts laws
    5-8, [SOFT]): the softbody module's balls (its `ball` records: inflated, foam and clay), a trampoline's mat (its springs' stiffness per
    metre of dip, its travel 9/10 of its height), and any solid a process record gives a `contact_law` ({solid, contact_law: [5-8, ...]}: the
    plug-in point for a module's own soft thing)."""
    out = []
    for p in sb.processes:
        sid = p.get("solid")
        if not isinstance(sid, str):
            continue
        law = p.get("contact_law")
        if isinstance(law, list) and law and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in law) and 5 <= law[0] <= 8:
            out.append((sid, [float(v) for v in law]))
            continue
        if p.get("kind") != "softbody" or p.get("role") != "ball":
            continue
        R, hard = p.get("R", 0.0), p.get("hard", 0.0)
        if p.get("law") == "pressure":
            out.append((sid, [5.0, float(p.get("gauge", 0.0)), float(R), float(p.get("wall", 0.0)), float(hard)]))
        elif p.get("law") == "hertz":
            nu = float(p.get("nu", 0.3))
            out.append((sid, [6.0, round(float(p.get("E", 0.0)) / (1 - nu * nu), 3), float(R), float(hard)]))
        elif p.get("law") == "clay":
            flow = float(p.get("flow", 0.0))
            ratio = round(float(p.get("kc", 0.0)) / (2 * math.pi * R * flow), 4) if R > 0 and flow > 0 else 50.0
            out.append((sid, [7.0, flow, float(R), ratio, float(hard)]))
    for s in sb.solids:
        it = sb.scene_items.get(s["item"]) or {}
        if it.get("type") == "trampoline" and s["id"] == f"{s['item']}/mat":
            P = props_of(it)
            out.append((s["id"], [8.0, float(P["stiffness"]), _r5(0.9 * P["height"])]))
    return out


def soft_table(sb, scene):
    """When the scene has a breakable thing: every padding solid of it with its compression law, and other modules' soft things with theirs,
    for the engine (fracture-soft). A parachute learns the vacuum jars it may fall in (the air module's: their insides and the item whose
    pressure reading it reads). In a scene with a liquid, a breakable whose outline x depth is not its volume gets its true volume (the
    fluids module's `displace` record: a raw egg sinks in fresh water)."""
    _claim_goals()
    procs = sb.processes
    if any(p.get("kind") in ("fracture-brittle", "fracture-beam") for p in procs):
        soft = {}
        for s in sb.solids:
            base = sb.base_of(s["material"])
            if base in CUSHIONS:
                soft[s["id"]] = list(CUSHIONS[base])
        for sid, law in _body_laws(sb):
            if sid not in soft:
                soft[sid] = law
        procs.append({"kind": "fracture-soft", "id": "~fracture/soft", "soft": soft})
    jars = [{"item": p["item"], "x0": p["x0"], "x1": p["x1"], "y0": p["y0"], "y1": p["y1"]} for p in procs if p.get("kind") == "air" and p.get("role") == "jar"]
    if jars:
        for p in procs:
            if p.get("kind") == "fracture-chute":
                p["jars"] = [dict(j) for j in jars]
    if any(p.get("kind") == "liquid" for p in procs):
        for p in list(procs):
            if p.get("kind") != "fracture-brittle" or p.get("mode") != "free":
                continue
            item = sb.scene_items.get(p["item"]) or {}
            rho = TRUE_DENSITY.get(item.get("type"))
            if rho is None:
                continue
            whole = parts = 0.0
            for s in sb.solids:
                if s["item"] == p["item"] and s["kind"] == "dynamic":
                    v = _volume(s["body"])
                    parts += v
                    if s["id"] == p["solid"]:
                        whole = v
            if whole > 0:
                # (the engine scales every one of its moving solids' outlines by volume_ml over all of them: the whole one displaces its real volume)
                procs.append({"kind": "displace", "id": f"{p['item']}/displace", "item": p["item"], "volume_ml": round(p["mass"] / rho * parts / whole * 1e6, 4)})


def _volume(b):
    """A doc body's volume as the engine reckons it (part.ts): a slab's box, a polygon's prism (this module builds only those)."""
    if b["kind"] == "slab":
        return b["width"] * b["height"] * b["depth"]
    if b["kind"] == "polygon":
        return abs(_area([(q["x"], q["y"]) for q in b["points"]])) * b["depth"]
    return 0.0


# ---------------------------------------------------------------- goals
def _trim(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def goal_breaks(ctx, g):
    """{kind: "breaks", item, before_s?}: it breaks (cracks, shatters, snaps, a glued joint lets go), by before_s if given."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "broken") is None:
        return None
    by = ctx.num(g.get("before_s"))
    t = ctx.first_time(iid, "broken", lambda v: v >= 0.5)
    when = "" if by is None else f" by {_trim(by)} s"
    return {"label": g.get("label") or f"{ctx.name(iid)} breaks{when}", "ok": t is not None and (by is None or t <= by), "kind": "breaks",
            "item": iid, "t": None if t is None else round(t, 3)}


_PREV = {}


def goal_breaks_any(ctx, g):
    """"breaks" for an item of any module: every item with a `broken` reading (this module's breakables, the mechanics module's fragile egg,
    the softbody module's snapping beams) by it; any other item by the "breaks" another module registered (_claim_goals)."""
    iid = g.get("item")
    if ctx.known(iid) and ctx.state(iid, "broken") is not None:
        return goal_breaks(ctx, g)
    return _PREV["breaks"](ctx, g) if "breaks" in _PREV else None


def goal_survives_any(ctx, g):
    """"survives" for an item of any module, as goal_breaks_any."""
    iid = g.get("item")
    if ctx.known(iid) and ctx.state(iid, "broken") is not None:
        return goal_survives(ctx, g)
    return _PREV["survives"](ctx, g) if "survives" in _PREV else None


_MINE = {"breaks": goal_breaks_any, "survives": goal_survives_any}


def _claim_goals():
    """Other modules call their goals "breaks" and "survives" too (mechanics' fragile egg, softbody's beams) and load after this one: the first
    build hands theirs on and answers for both (a `broken` reading, 0 whole and 1 or more broken, is what every one of them keeps)."""
    for kind, fn in _MINE.items():
        cur = GOAL_KINDS.get(kind)
        if cur is fn:
            continue
        if cur is not None:
            _PREV[kind] = cur
        GOAL_KINDS[kind] = fn


def goal_survives(ctx, g):
    """{kind: "survives", item}: it never breaks in the run."""
    iid = g.get("item")
    st = ctx.state(iid, "broken") if ctx.known(iid) else None
    if st is None:
        return None
    t = ctx.first_time(iid, "broken", lambda v: v >= 0.5)
    sh = ctx.state(iid, "share") or []
    most = max([v for v in sh if v is not None], default=0.0)
    return {"label": g.get("label") or f"{ctx.name(iid)} survives", "ok": t is None, "kind": "survives", "item": iid,
            "share": round(most, 2), "t": None if t is None else round(t, 3)}


def goal_breaks_first(ctx, g):
    """{kind: "breaks_first", item, other}: item breaks, and before other does (or other never does)."""
    a, b = g.get("item"), g.get("other")
    if not (ctx.known(a) and ctx.known(b)) or ctx.state(a, "broken") is None or ctx.state(b, "broken") is None:
        return None
    ta = ctx.first_time(a, "broken", lambda v: v >= 0.5)
    tb = ctx.first_time(b, "broken", lambda v: v >= 0.5)
    return {"label": g.get("label") or f"{ctx.name(a)} breaks before {ctx.name(b)}", "ok": ta is not None and (tb is None or ta < tb),
            "kind": "breaks_first", "item": a, "other": b, "t": None if ta is None else round(ta, 3), "other_t": None if tb is None else round(tb, 3)}


def goal_knocked_down(ctx, g):
    """{kind: "knocked_down", item, at_least_blocks?}: a block tower is knocked down: with at_least_blocks, that many of its blocks have
    fallen (dropped or tipped off); without, half its blocks or more have fallen, or it stands less than half as tall as it was built. A block
    that only slides along still stands."""
    iid = g.get("item")
    hs = ctx.state(iid, "top_height") if ctx.known(iid) else None
    if hs is None:
        return None
    first = next((v for v in hs if v is not None), None)
    if first is None:
        return None
    n = ctx.num(g.get("at_least_blocks"))
    if n is not None:
        t = ctx.first_time(iid, "blocks_fallen", lambda v: v >= n)
        label = f"{ctx.name(iid)} is knocked down ({_trim(n)} or more blocks fall)"
    else:
        half = (len(ctx.solids(iid, True)) + 1) // 2
        ta = ctx.first_time(iid, "top_height", lambda v: v < 0.5 * first)
        tb = ctx.first_time(iid, "blocks_fallen", lambda v: v >= half) if half > 0 else None
        t = ta if tb is None else tb if ta is None else min(ta, tb)
        label = f"{ctx.name(iid)} is knocked down"
    fallen = ctx.state(iid, "blocks_fallen") or []
    most = max([v for v in fallen if v is not None], default=0.0)
    return {"label": g.get("label") or label, "ok": t is not None, "kind": "knocked_down", "item": iid, "fallen": int(most),
            "t": None if t is None else round(t, 3)}
