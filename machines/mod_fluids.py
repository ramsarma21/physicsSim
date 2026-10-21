"""The liquids module: water and other liquids standing in fixed containers, and what floats, sinks and sails in them.

items.py imports this file (machines/mod_<name>.py) after the catalog files and calls register_all(globals()); web/sim/modules/fluids.js is
its exact JavaScript port (the same documents, number for number). The engine side is tooling/src/sim/modules/fluids.ts (the processes
"liquid", "hull" and "sail") with the physics in tooling/src/sim/fluids.ts: buoyancy at the displaced volume's centroid, the level from the
liquid's conserved volume (things put in raise it; more than fits spills over the rim), form, viscous and sphere drag, added mass, wave
damping, and hollow hulls that float on their envelope until water comes over the rim.

Items: water-tank (aquarium, tub or trough), graduated-cylinder, beaker, measuring-jug, density-column (fixed containers of liquid);
sailboat, clay-boat, foil-boat (things that float); penny, grape, cork, plastic-bead, pebble (things to float or sink); breeze (a steady wind);
soap-drop (lowers the surface tension where it spreads: sinks a paper clip the surface held, pushes a boat), capillary-tube (water climbs a
thin tube, higher the thinner), paper-strip (water climbs paper). The magnetism module's paper clips, laid gently on water, are held up by
its surface tension (SURFACE_TYPES).
Every existing moving item floats or sinks by its own density (its mass over its outer volume).

Sources (every liquid's numbers are at 20 °C):
  [IAPWS-95] Wagner & Pruss, J. Phys. Chem. Ref. Data 31, 387 (2002): water 998.2 kg/m³, 1.002 mPa·s.
  [CRC] CRC Handbook of Chemistry and Physics, "Concentrative properties of aqueous solutions: sodium chloride" (density and viscosity
        by mass %).
  [SHARQAWY] Sharqawy, Lienhard & Zubair, Desalination and Water Treatment 16, 354 (2010): sea water 35 g/kg, 1024.8 kg/m³, 1.08 mPa·s.
  [NOUREDDINI] Noureddini, Teoh & Clements, JAOCS 69, 1189 (1992): soybean oil about 920 kg/m³, about 0.06 Pa·s at 20 °C.
  [YANNIOTIS] Yanniotis, Skaltsi & Karaburnioti, J. Food Eng. 72, 372 (2006): honey 2-20 Pa·s at 20 °C by its water (10 used).
  [USMINT] U.S. Mint: the cent since 1982 is 2.500 g, 19.05 mm across, 1.52 mm thick.
  [RGR] Rain gutter regatta (BSA): a 10 ft (3.05 m) vinyl gutter lane, boats about 7 in (18 cm).
  [HOE] Hoerner, Fluid-Dynamic Drag (1965): a flat plate square to the flow C_d 1.17; [ORTIZ] Ortiz, Rival & Wood, Energies 8, 2438
        (2015): a square flat plate at 45° to the flow has a normal-force coefficient of about 1.13, so its push along the wind is about
        0.8 of ½ρv²·A (provisional).
  [IAPWS-ST] IAPWS Revised Release on the Surface Tension of Ordinary Water Substance (2014): 72.74 mN/m at 20 °C.
  [WEISSENBORN] Weissenborn & Pugh, J. Colloid Interface Sci. 184, 550 (1996): NaCl raises water's surface tension by about 1.64 mN/m per mol/kg.
  [ADAMSON] Adamson & Gast, Physical Chemistry of Surfaces, 6th ed. (1997): Jurin's law h = 2γ·cosθ/(ρ·g·r), clean glass and water θ ≈ 0;
        a body held by the surface: at most γ·sinθ per metre of contact line; a 2D meniscus pushed down d: d = 2·l_c·sin(φ/2), l_c = √(γ/(ρg)).
  [WASHBURN] Washburn, Phys. Rev. 17, 273 (1921): a liquid wicking into paper climbs h² = D·t (D ∝ γ·cosθ/μ), slowing as gravity holds it.
  [JENSEN] Jensen, J. Fluid Mech. 293, 349 (1995): a drop of surfactant spreads over clean water as x ∝ t^(3/4).
  Provisional (approximate, said so in the source texts): corn syrup, dish soap, rubbing alcohol viscosities; grape density; the surface
  tensions of oil, syrup, honey, soap and alcohol; contact angles; the papers' wicking; the soap's spreading speed.
  Milk and chocolate milk (2026-10-20; machines/mod_flow.py's docstring has their sources): whole milk 1030.5 kg/m³ and 2.1 mPa·s at 20 °C,
  chocolate milk about 1065 kg/m³ and 8 mPa·s as it pours (provisional), both opaque; surface tensions 47 and 46 mN/m (approximate).
"""
import math

from crmath import cos, sin, cube, sq  # noqa: F401  (the same bits as web/sim's port on any machine)

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "MATERIALS", "add_look", "LOOK_FILL", "LOOK_SHADE", "D2R",
          "register_goal_kind", "TYPES", "polygon_problem", "CATEGORIES", "register_build_hook", "props_of")

MODULE = "fluids"


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if "Liquids" not in CATEGORIES:
        CATEGORIES.append("Liquids")
    _looks()
    _materials()
    _containers()
    _floaters()
    _things()
    _air()
    _surface()
    _goals()
    register_build_hook(_displacement)


# ---------------------------------------------------------------- liquids
# name -> (density kg/m³, viscosity Pa·s, look, source). Salt water's density and viscosity follow its salt (SALT below).
LIQUIDS = {
    "water": (998.2, 0.001002, "water", "Water at 20 °C: 998.2 kg/m³, 1.002 mPa·s [IAPWS-95]."),
    "salt water": (None, None, "water", "Salt water (sodium chloride) at 20 °C: density and viscosity by its salt [CRC]."),
    "sea water": (1024.8, 0.00108, "sea water", "Sea water, 35 g of salt a kilogram, 20 °C: 1024.8 kg/m³, 1.08 mPa·s [SHARQAWY]."),
    "vegetable oil": (920.0, 0.06, "oil", "Soybean or canola oil at 20 °C: about 920 kg/m³, about 0.06 Pa·s [NOUREDDINI] (approximate)."),
    "corn syrup": (1380.0, 2.5, "syrup", "Light corn syrup: about 1380 kg/m³; about 2.5 Pa·s at 20 °C (approximate: brands differ)."),
    "honey": (1420.0, 10.0, "honey", "Honey: about 1420 kg/m³; 2-20 Pa·s at 20 °C by its water, 10 used [YANNIOTIS] (approximate)."),
    "dish soap": (1050.0, 0.5, "soap", "Liquid dish soap: about 1050 kg/m³, about 0.5 Pa·s (manufacturers' data; approximate)."),
    "rubbing alcohol": (880.0, 0.0025, "alcohol", "Rubbing alcohol (70 % isopropyl): about 880 kg/m³, about 2.5 mPa·s (approximate)."),
    "milk": (1030.5, 0.0021, "milk", "Whole milk at 20 °C: 1030.5 kg/m³ [MILK-RHO], 2.1 mPa·s [MILK-MU]; white and opaque (its fat droplets and casein scatter light)."),
    "chocolate milk": (1065.0, 0.008, "chocolate milk", "Chocolate milk at 20 °C: about 1065 kg/m³ (provisional); about 8 mPa·s as it pours (it thins "
                                                        "as it flows [DRINKS-RHEO]); brown and opaque."),
}
LIQUID_NAMES = list(LIQUIDS)
# NaCl in water at 20 °C [CRC]: mass % -> (density kg/m³, viscosity mPa·s); between the rows, a straight line
SALT = [(0.0, 998.2, 1.002), (1.0, 1005.3, 1.020), (2.0, 1012.5, 1.036), (4.0, 1026.8, 1.070), (6.0, 1041.3, 1.108), (8.0, 1055.9, 1.149),
        (10.0, 1070.7, 1.193), (12.0, 1085.7, 1.244), (14.0, 1100.9, 1.300), (16.0, 1116.2, 1.361), (20.0, 1147.8, 1.503),
        (24.0, 1180.2, 1.686), (26.0, 1197.2, 1.800)]
SALT_MAX = 26.0


def salt_water(pct):
    """(density kg/m³, viscosity Pa·s) of salt water with pct mass % of salt at 20 °C [CRC], linear between the table's rows."""
    p = min(SALT_MAX, max(0.0, pct))
    for (p0, d0, m0), (p1, d1, m1) in zip(SALT, SALT[1:]):
        if p <= p1:
            u = (p - p0) / (p1 - p0)
            return round(d0 + (d1 - d0) * u, 3), round((m0 + (m1 - m0) * u) / 1000, 7)
    return SALT[-1][1], SALT[-1][2] / 1000


def liquid_of(name, pct=0.0):
    """(words, density, viscosity) of a liquid choice."""
    if name == "salt water":
        d, v = salt_water(pct)
        return f"salt water ({_num_text(pct)} % salt)", d, v
    d, v, _, _ = LIQUIDS[name]
    return name, d, v


def _num_text(v):
    """A number as a short text: 10, 12.5 (no trailing zeros), as web/sim's port writes it."""
    r = round(v, 2)
    return str(int(r)) if r == int(r) else f"{r:g}"


def _layer(name, height, pct=0.0):
    words, d, v = liquid_of(name, pct)
    return {"words": words, "density": d, "viscosity": v, "height": round(max(0.0, height), 6)}


# ---------------------------------------------------------------- looks and materials
def _looks():
    # the liquids (the 3D view draws them from the container's resolved props; these are their catalog looks for the cards)
    add_look("water", fill="#9cc9ea", shade="#5f9cc9", roughness=0.05, metalness=0.0, clearcoat=1.0, transmission=0.85, ior=1.333, thickness=0.05)
    add_look("sea water", fill="#8cc5c9", shade="#4f9a9f", roughness=0.05, metalness=0.0, clearcoat=1.0, transmission=0.8, ior=1.34, thickness=0.05)
    add_look("oil", fill="#e3b53b", shade="#b78a1c", roughness=0.05, metalness=0.0, clearcoat=1.0, transmission=0.7, ior=1.47, thickness=0.05)
    add_look("syrup", fill="#ecd08a", shade="#c4a35a", roughness=0.05, metalness=0.0, clearcoat=1.0, transmission=0.75, ior=1.49, thickness=0.05)
    add_look("honey", fill="#d08a12", shade="#9c6208", roughness=0.08, metalness=0.0, clearcoat=1.0, transmission=0.55, ior=1.5, thickness=0.05)
    add_look("soap", fill="#4fb05a", shade="#2f7f3a", roughness=0.08, metalness=0.0, clearcoat=1.0, transmission=0.6, ior=1.4, thickness=0.05)
    add_look("alcohol", fill="#e8eef2", shade="#b9c4cc", roughness=0.05, metalness=0.0, clearcoat=1.0, transmission=0.9, ior=1.38, thickness=0.05)
    add_look("milk", fill="#f6f4ee", shade="#d9d4c8", roughness=0.25, metalness=0.0, clearcoat=0.6)
    add_look("chocolate milk", fill="#7a4e33", shade="#563622", roughness=0.25, metalness=0.0, clearcoat=0.6)
    add_look("tub plastic", fill="#4f8fd8", shade="#2f6bb0", roughness=0.45, metalness=0.0, clearcoat=0.2)
    add_look("vinyl", fill="#eef0ec", shade="#c4c8c0", roughness=0.4, metalness=0.0, clearcoat=0.2)
    add_look("sail", fill="#f6f3ea", shade="#cfc9b8", roughness=0.85, metalness=0.0, clearcoat=0.0)
    add_look("hull paint", fill="#d2483a", shade="#a2302a", roughness=0.35, metalness=0.0, clearcoat=0.6)
    add_look("foil", fill="#d6dade", shade="#9aa1a8", roughness=0.25, metalness=1.0, clearcoat=0.0)
    add_look("copper", fill="#b8693a", shade="#8a4a26", roughness=0.35, metalness=1.0, clearcoat=0.0)
    add_look("grape", fill="#6a3d7a", shade="#4a2656", roughness=0.3, metalness=0.0, clearcoat=0.5)
    add_look("stone", fill="#8d8a84", shade="#66625c", roughness=0.85, metalness=0.0, clearcoat=0.0)
    add_look("bead", fill="#e2445c", shade="#b02a40", roughness=0.25, metalness=0.0, clearcoat=0.6)


def _mat(key, **kw):
    kw.setdefault("rolling", 0.0)
    kw.setdefault("side", 0.0)
    if key not in MATERIALS:
        MATERIALS[key] = kw


def _materials():
    _mat("pine", density=400.0, bounce=0.6, friction=0.45, rolling=0.004, look="hull paint",
         source="Pine 350-460 kg/m³ at 12 % moisture (Wood Handbook, FPL-GTR-190, 2010, Table 5-3a); a toy hull is about 400. Bounce and friction as other woods (provisional).")
    _mat("vinyl", density=1400.0, bounce=0.5, friction=0.45, rolling=0.01, look="vinyl",
         source="Rigid PVC (vinyl) 1300-1450 kg/m³; a rain gutter's wall is about 2-3 mm. Bounce and friction provisional.")
    _mat("sail cloth", density=1000.0, bounce=0.2, friction=0.6, rolling=0.0, look="sail",
         source="Paper 80 g/m², polyethylene film 46 g/m² (50 µm), cloth 120 g/m²: a sail's own weight is set by its material.")
    _mat("aluminium foil", density=2700.0, bounce=0.1, friction=0.4, rolling=0.0, look="foil",
         source="Aluminium 2700 kg/m³; household foil 0.016 mm thick (heavy duty 0.024 mm). Crumples rather than bounces: e 0.1 provisional.")
    _mat("copper-plated zinc", density=7140.0, bounce=0.5, friction=0.3, rolling=0.002, look="copper",
         source="The U.S. cent since 1982: 97.5 % zinc, 2.5 % copper plating, 2.500 g, 19.05 mm, 1.52 mm thick [USMINT]. Bounce and friction as other coins (provisional).")
    _mat("grape", density=1060.0, bounce=0.3, friction=0.6, rolling=0.05, look="grape",
         source="A grape is a little denser than water, about 1.06 g/cm³ (approximate): it sinks in water and floats on syrup.")
    _mat("polyethylene", density=950.0, bounce=0.6, friction=0.3, rolling=0.01, look="bead",
         source="High-density polyethylene 940-970 kg/m³: a bead of it floats on water and sinks in oil.")
    _mat("granite", density=2650.0, bounce=0.5, friction=0.6, rolling=0.02, look="stone",
         source="Granite 2630-2750 kg/m³ (Engineering ToolBox); a river pebble. Bounce provisional.")
    _mat("paper strip", density=600.0, bounce=0.1, friction=0.6, rolling=0.0, look="paper",
         source="Paper towel, filter paper and office paper 300-800 kg/m³ (a strip that hangs in a liquid: its weight does not matter; approximate).")


# ---------------------------------------------------------------- small geometry helpers (the port does the same, step for step)
def _area(pts):
    n = len(pts)
    return abs(sum(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1] for k in range(n))) / 2


def _r5(pts):
    return [(round(x, 5), round(y, 5)) for x, y in pts]


def _upright(c):
    """A fixed container stands upright whatever the item's angle (its liquid is level): its solids are placed unturned."""
    c.ca, c.sa, c.a = 1.0, 0.0, 0.0


def _child(c, part, parent, body, at, material, look, words, color=None, angle=0.0):
    """A solid welded to another solid of this item: `at` (and `angle`, rad) in the parent's own frame."""
    s = {"kind": c.kind, "id": f"{c.item['id']}/{part}", "words": words, "item": c.item["id"], "look": look, "body": body, "material": material,
         "at": {"x": round(at[0], 5), "y": round(at[1], 5)}, "parent": parent, "placeholder": {"fill": color or LOOK_FILL[look]},
         "render": {"kind": "procedural", "shade": LOOK_SHADE[look]}, "depth": 2}
    if abs(angle) > 1e-12:
        s["angle"] = round(angle, 6)
    if color:
        s["color"] = color
    c.sb.solids.append(s)
    return s["id"]


def _poly_body(pts, depth):
    pts = _r5(pts)
    problem = polygon_problem(pts)
    if problem:
        raise ValueError(f"polygon {problem}")
    return {"kind": "polygon", "points": [{"x": x, "y": y} for x, y in pts], "depth": round(depth, 5)}


COLORS = {"blue": "#3f7fd0", "white": "#eef0ec", "grey": "#9aa0a6", "green": "#4fa35a", "red": "#c8443a", "yellow": "#e8c13a", "orange": "#e8823a",
          "black": "#2a2a2a", "clear": None}
COLOR_NAMES = list(COLORS)

CONTAINER_READOUTS = None  # (set in _containers: Readout is items.py's)


def _liquid_props(default_liquid="water"):
    return [Prop("liquid", "Liquid", default_liquid, kind="choice", choices=LIQUID_NAMES, help="What is in it (each at 20 °C)"),
            Prop("salt_pct", "Salt", 10.0, 0.0, SALT_MAX, 0.5, "%", "Salt water only: grams of salt in 100 g of the salt water (26 % is as salty as water gets)"),
            Prop("water_temp_c", "Liquid temperature", 20.0, 0.0, 100.0, 1.0, "°C", "For a heat module; the liquid's density and thickness are taken at 20 °C")]


def _readouts():
    return [Readout("level_mm", "Level", "mm", 1, "How high the surface stands above the inside of the floor"),
            Readout("volume_ml", "Reads", "mL", 1, "What a scale on the wall reads: the liquid and whatever is under its surface"),
            Readout("spilled_ml", "Spilled", "mL", 1, "Liquid that went over the rim")]


def _liquid_record(c, x0, x1, floor, rim, area, layers):
    """The container's liquid for the engine (doc.processes): world coordinates (the container is fixed and upright)."""
    c.process("liquid", "liquid", x0=round(c.ox + x0, 6), x1=round(c.ox + x1, 6), floor=round(c.oy + floor, 6), rim=round(c.oy + rim, 6),
              area=round(area, 8), layers=layers)


# ---------------------------------------------------------------- containers
TANK_STYLES = {
    # inner length, wall height, front-to-back, wall thickness, material, look, how full (of the inside's height), colour
    "aquarium": (0.5, 0.30, 0.25, 0.006, "glass", "glass", 0.7, "clear"),
    "tub": (0.6, 0.18, 0.40, 0.004, "polypropylene", "tub plastic", 0.7, "blue"),
    "trough": (3.05, 0.10, 0.12, 0.003, "vinyl", "vinyl", 0.85, "white"),   # (a regatta's gutter is filled near its brim: the boats ride above it)
}


def _containers():
    def build_tank(c, P):
        _upright(c)
        given = c.item.get("props") or {}
        style = P["style"]
        L0, H0, D0, t, mat, look, full, col0 = TANK_STYLES[style]
        for k, v in (("length", L0), ("height", H0), ("depth", D0), ("color", col0)):
            if k not in given:
                P[k] = v
        L, H, D = P["length"], P["height"], P["depth"]
        if "fill" not in given:
            P["fill"] = round(full * (H - t), 4)
        fill = min(P["fill"], H - t)
        color = COLORS.get(P.get("color")) if style != "aquarium" else None
        m = c.mat(base=mat, overrides={})
        kw = dict(kind="static", material=m, look=look)
        if color:
            kw.update(color=color, fill=color)
        # (stood in the air, its floor is held by stands the view draws: a raised lane over another)
        c.slab("floor", L + 2 * t, t, D, 0.0, t / 2, words=f"the {style}'s floor", stand="post", **kw)
        c.slab("wall-left", t, H - t, D, -L / 2 - t / 2, t + (H - t) / 2, words=f"the {style}'s end wall", **kw)
        c.slab("wall-right", t, H - t, D, L / 2 + t / 2, t + (H - t) / 2, words=f"the {style}'s end wall", **kw)
        _liquid_record(c, -L / 2, L / 2, t, H, L * (D - 2 * t), [_layer(P["liquid"], fill, P["salt_pct"])] if fill > 0 else [])
        P["wall"] = t

    register(ItemType("water-tank", "Water tank", "Liquids", build_tank, dynamic=False, material="glass", materials=["glass"],
                      props=[Prop("style", "Kind", "aquarium", kind="choice", choices=list(TANK_STYLES),
                                  help="aquarium: glass, see-through (how deep things float); tub: a plastic storage tub; trough: a long rain-gutter lane for boat races"),
                             Prop("length", "Length (inside)", 0.5, 0.15, 3.05, 0.01, "m", "Along the table; follows the kind until you set it", auto=("style",)),
                             Prop("height", "Wall height", 0.3, 0.05, 0.6, 0.005, "m", "Follows the kind until you set it", auto=("style",)),
                             Prop("depth", "Front to back", 0.25, 0.08, 0.6, 0.01, "m", "Follows the kind until you set it", auto=("style",)),
                             Prop("fill", "Liquid depth", 0.2058, 0.0, 0.6, 0.005, "m", "How deep the liquid stands with nothing in it (7/10 of the inside's height, a trough 85/100, until you set it)",
                                  auto=("style", "height")),
                             *_liquid_props(),
                             Prop("color", "Colour", "clear", kind="choice", choices=COLOR_NAMES, help="The tub's or trough's plastic (an aquarium is glass); follows the kind until you set it",
                                  auto=("style",))],
                      tags=["water", "aquarium", "tank", "tub", "trough", "rain gutter", "pool", "basin", "sink", "float", "sink or float", "boat race", "lane",
                            "liquid", "salt water", "oil", "pond", "bath"],
                      description="A container of liquid fixed on the table: a glass aquarium (see how deep things float), a plastic tub, or a long trough "
                                  "(a rain-gutter lane for boat races). Things put in float or sink by their density, and the level rises by what they push under.",
                      source="Aquarium glass 6 mm, tub polypropylene 4 mm, trough vinyl 3 mm [RGR]. Water 998.2 kg/m³ [IAPWS-95]; salt water by its salt [CRC].",
                      anchor="the middle of its base, where it stands", facts="50 × 30 cm glass aquarium, 25 cm deep, water 20.5 cm",
                      edit=[{"kind": "length", "prop": "length"}, {"kind": "top", "prop": "fill"}], readouts=_readouts(), module=MODULE))

    # --- graduated cylinder, beaker, measuring jug: round glass (or plastic) vessels read in mL
    # inner diameter, its top mark's height over its inside bottom, its rim's height over the table, glass, a mark's mL (its glass bottom stands on a 12 mm foot)
    CYLINDERS = {"100 mL": (0.0285, 0.157, 0.212, 0.0015, 1.0), "250 mL": (0.037, 0.2325, 0.282, 0.0018, 2.0), "1000 mL": (0.065, 0.3014, 0.382, 0.0025, 10.0)}
    BEAKERS = {"250 mL": (0.067, 0.095, 0.0016), "600 mL": (0.087, 0.125, 0.0018), "1000 mL": (0.102, 0.145, 0.002)}

    def build_round(c, P, inner_d, wall_h, t, foot_w, look, mat, noun, default_ml, foot_h=None):
        _upright(c)
        fh = t if foot_h is None else foot_h   # its base: a cylinder's stands on a thick foot, its glass bottom on top of that
        r = inner_d / 2
        area = math.pi * r * r
        cap = area * (wall_h - fh)
        given = c.item.get("props") or {}
        if "fill_ml" not in given:
            P["fill_ml"] = round(default_ml, 1)
        fill_ml = min(P["fill_ml"], cap * 1e6)
        m = c.mat(base=mat, overrides={})
        c.slab("floor", max(foot_w, inner_d + 2 * t), fh, max(foot_w, inner_d + 2 * t), 0.0, fh / 2, kind="static", material=m, look=look, words=f"the {noun}'s foot")
        c.slab("wall-left", t, wall_h - fh, inner_d + 2 * t, -r - t / 2, fh + (wall_h - fh) / 2, kind="static", material=m, look=look, words=f"the {noun}'s wall")
        c.slab("wall-right", t, wall_h - fh, inner_d + 2 * t, r + t / 2, fh + (wall_h - fh) / 2, kind="static", material=m, look=look, words=f"the {noun}'s wall")
        _liquid_record(c, -r, r, fh, wall_h, area, [_layer(P["liquid"], fill_ml / 1e6 / area, P["salt_pct"])] if fill_ml > 0 else [])
        P["capacity_ml"] = round(cap * 1e6, 1)

    def build_cylinder(c, P):
        d, scale_h, wall_h, t, mark = CYLINDERS[P["size"]]
        build_round(c, P, d, wall_h, t, d * 2.6, "glass", "glass", "cylinder", 0.6 * float(P["size"].split()[0]), foot_h=0.012)
        P["mark_ml"] = mark
        P["scale_ml"] = float(P["size"].split()[0])

    register(ItemType("graduated-cylinder", "Graduated cylinder", "Liquids", build_cylinder, dynamic=False, material="glass", materials=["glass"],
                      props=[Prop("size", "Size", "100 mL", kind="choice", choices=list(CYLINDERS), help="100 mL (1 mL marks), 250 mL (2 mL), 1000 mL (10 mL)"),
                             Prop("fill_ml", "Amount", 60.0, 0.0, 1300.0, 0.5, "mL", "How much liquid is in it (6/10 of its scale until you set it)", auto=("size",)),
                             *_liquid_props()],
                      tags=["measuring cylinder", "graduated cylinder", "volume", "displacement", "mL", "millilitre", "lab", "measure", "water", "glass"],
                      description="A tall glass measuring cylinder with millilitre marks, fixed upright. Drop something in and the reading rises by its volume "
                                  "(what is under the surface): measure a stone's volume by displacement.",
                      source="Class B cylinders: 100 mL is 28.5 mm inside with its 100 mL mark 157 mm up; 250 mL 37 mm; 1000 mL 65 mm (ISO 4788 sizes, approximate).",
                      anchor="the middle of its foot, where it stands", facts="100 mL, 1 mL marks, 60 mL of water",
                      readouts=_readouts(), module=MODULE))

    def build_beaker(c, P):
        d, h, t = BEAKERS[P["size"]]
        build_round(c, P, d, h, t, d + 2 * t, "glass", "glass", "beaker", 0.5 * float(P["size"].split()[0]))
        P["mark_ml"] = 50.0 if P["size"] != "250 mL" else 25.0

    register(ItemType("beaker", "Beaker", "Liquids", build_beaker, dynamic=False, material="glass", materials=["glass"],
                      props=[Prop("size", "Size", "600 mL", kind="choice", choices=list(BEAKERS)),
                             Prop("fill_ml", "Amount", 300.0, 0.0, 1300.0, 1.0, "mL", "How much liquid is in it (half its size until you set it)", auto=("size",)),
                             *_liquid_props()],
                      tags=["beaker", "glass", "lab", "water", "liquid", "volume", "mL", "jar"],
                      description="A glass lab beaker with a spout and rough mL marks, fixed upright: hold water to float or sink things in.",
                      source="Griffin low-form beakers: 250 mL 70 × 95 mm, 600 mL 90 × 125 mm, 1000 mL 105 × 145 mm (approximate).",
                      anchor="the middle of its base, where it stands", facts="600 mL beaker, 300 mL of water", readouts=_readouts(), module=MODULE))

    def build_jug(c, P):
        build_round(c, P, 0.105, 0.155, 0.003, 0.111, "plastic", "polypropylene", "jug", 500.0)
        P["mark_ml"] = 50.0

    register(ItemType("measuring-jug", "Measuring jug", "Liquids", build_jug, dynamic=False, material="polypropylene", materials=["polypropylene"],
                      props=[Prop("fill_ml", "Amount", 500.0, 0.0, 1300.0, 5.0, "mL", "How much liquid is in it"),
                             *_liquid_props()],
                      tags=["measuring cup", "measuring jug", "jug", "kitchen", "water", "volume", "mL", "litre", "pitcher"],
                      description="A 1 litre plastic kitchen measuring jug with 50 mL marks, fixed upright: the level rises as things go in.",
                      source="A 1 L kitchen jug is about 105 mm across inside; 1 L stands about 115 mm deep (approximate).",
                      anchor="the middle of its base, where it stands", facts="1 L jug, 500 mL of water", readouts=_readouts(), module=MODULE))

    # --- density column: a tall glass jar of liquids that do not mix, the densest at the bottom
    COLUMNS = {
        "6 layers": ["honey", "corn syrup", "dish soap", "water", "vegetable oil", "rubbing alcohol"],
        "3 layers": ["corn syrup", "water", "vegetable oil"],
        "water and oil": ["water", "vegetable oil"],
        "honey, water, oil": ["honey", "water", "vegetable oil"],
    }

    def build_column(c, P):
        _upright(c)
        inner, H, t = 0.06, 0.32, 0.003
        r = inner / 2
        area = math.pi * r * r
        names = sorted(COLUMNS[P["layers"]], key=lambda n: -LIQUIDS[n][0])
        h = P["layer_ml"] / 1e6 / area
        room = (H - t) / len(names)
        h = min(h, room)
        m = c.mat(base="glass", overrides={})
        c.slab("floor", inner + 2 * t, t, inner + 2 * t, 0.0, t / 2, kind="static", material=m, look="glass", words="the jar's base")
        c.slab("wall-left", t, H - t, inner + 2 * t, -r - t / 2, t + (H - t) / 2, kind="static", material=m, look="glass", words="the jar's wall")
        c.slab("wall-right", t, H - t, inner + 2 * t, r + t / 2, t + (H - t) / 2, kind="static", material=m, look="glass", words="the jar's wall")
        _liquid_record(c, -r, r, t, H, area, [_layer(n, h) for n in names])
        P["order"] = ", ".join(names)

    register(ItemType("density-column", "Density column", "Liquids", build_column, dynamic=False, material="glass", materials=["glass"],
                      props=[Prop("layers", "Liquids", "6 layers", kind="choice", choices=list(COLUMNS),
                                  help="6 layers: honey, corn syrup, dish soap, water, vegetable oil, rubbing alcohol (densest at the bottom)"),
                             Prop("layer_ml", "Each layer", 100.0, 10.0, 200.0, 5.0, "mL")],
                      tags=["density", "layers", "rainbow", "honey", "syrup", "oil", "sink or float", "jar", "column", "tower"],
                      description="A tall glass jar of liquids stacked by density, the heaviest at the bottom (honey, syrup, soap, water, oil, alcohol). "
                                  "Drop things in: each stops at the layer whose density brackets its own.",
                      source="Densities at 20 °C: honey 1420, corn syrup 1380, dish soap 1050, water 998, oil 920, rubbing alcohol 880 kg/m³ "
                             "(approximate except water). The layers are drawn as not mixing (real water and alcohol do mix if poured fast).",
                      anchor="the middle of its base, where it stands", facts="6 cm × 32 cm jar, 6 layers of 100 mL", readouts=_readouts()[:2], module=MODULE))


# ---------------------------------------------------------------- floating things
SAILS = {"none": 0.0, "tiny": 48.0, "small": 120.0, "big": 320.0}   # cm² (6 × 8, 10 × 12, 16 × 20 cm: height 1.25 × width)
SAIL_STUFF = {"paper": 0.080, "plastic": 0.046, "cloth": 0.120}                    # kg/m²
SAIL_TRIM = 45.0          # degrees between the sail and the boat's line (let out halfway: the camera sees it, the wind fills it)
SAIL_PUSH = 0.8           # push along the wind / (½ρv²·A) for a square plate at 45° [ORTIZ] (a plate square to the wind: 1.17 [HOE])
AIR_SIDE_DRAG = 1.05      # the engine's flat-side drag coefficient (tooling/src/sim/physics.ts BOX_DRAG)
SAIL_THICK = 0.001        # the sail's slab in the side view (m)


def _boat_readouts(hull=True):
    out = [Readout("submerged", "Under water", "", 3, "Fraction of it under the surface (0 to 1)"),
           Readout("afloat", "Floats", "", 0, "1 while the liquid holds it up"),
           Readout("draft_mm", "Draft", "mm", 1, "How deep its lowest point is under the surface"),
           Readout("buoyancy_n", "Buoyancy", "N", 3, "The liquid's upward push")]
    if hull:
        out += [Readout("water_ml", "Water inside", "mL", 1, "Water that has come in over its rim"), Readout("flooded", "Flooded", "", 0, "1 once it has filled with water"),
                Readout("freeboard_mm", "Freeboard", "mm", 1, "Its rim above the surface")]
    return out


def _floaters():
    # --- toy sailboat
    def build_sailboat(c, P):
        L = P["hull_length"]
        H = round(0.15 * L, 5)
        B = round(0.3 * L, 5)
        # a long flat bottom (0.78 L at the waterline: a long waterplane keeps the bow up under a big sail), a raked bow, a rounded stern
        hull = [(-0.45 * L, 0.0), (0.33 * L, 0.0), (0.5 * L, H), (-0.5 * L, H), (-0.5 * L, 0.5 * H), (-0.48 * L, 0.18 * H)]
        hull = _r5(hull)
        hull_rho = P["hull_mass"] / (_area(hull) * B)
        color = COLORS.get(P.get("color")) or "#c8443a"
        root = c.poly("hull", hull, B, material=c.mat(base="pine", density=round(hull_rho, 4)), look="hull paint", words="a toy sailboat's hull",
                      color=color, fill=color)
        keel = _r5([(-0.08 * L, -0.07 * L), (0.0, -0.07 * L), (0.06 * L, 0.0), (-0.1 * L, 0.0)])
        _child(c, "keel", root, _poly_body(keel, 0.003), (0.0, 0.0), c.mat(base="ABS plastic", overrides={}), "plastic", "the boat's keel fin", color="#2a2a2a")
        sail = P["sail"]
        given = c.item.get("props") or {}
        # its area: the preset's, or the item's own sail_area_cm2 when it sets one (no sail at all with "none")
        if sail == "none":
            area_cm2 = 0.0
        elif "sail_area_cm2" in given:
            area_cm2 = P["sail_area_cm2"]
        else:
            area_cm2 = SAILS[sail]
        P["sail_area_cm2"] = area_cm2
        mx = round(0.05 * L, 5)
        if area_cm2 and area_cm2 > 0:
            A = area_cm2 / 1e4
            w = math.sqrt(A / 1.25)
            h = 1.25 * w
            mast_h = h + 0.027
            _child(c, "mast", root, {"kind": "slab", "width": 0.004, "height": round(mast_h, 5), "depth": 0.004}, (mx, H + mast_h / 2),
                   c.mat(base="varnished hardwood", overrides={}), "wood", "the boat's mast")
            # the engine's side drag on the sail slab, ½ρ·1.05·(height × depth)·v², is the push of the real sail set at 45° (0.8·½ρv²·A)
            depth = w * SAIL_PUSH / AIR_SIDE_DRAG
            mass = SAIL_STUFF[P["sail_material"]] * A
            sail_color = COLORS.get(P.get("sail_color")) or "#f6f3ea"
            _child(c, "sail", root, {"kind": "slab", "width": SAIL_THICK, "height": round(h, 5), "depth": round(depth, 5)}, (mx - 0.0025, H + 0.012 + h / 2),
                   c.mat(base="sail cloth", density=round(mass / (SAIL_THICK * h * depth), 4)), "sail", "the boat's sail", color=sail_color)
            P["sail_width"] = round(w, 4)
            P["sail_height"] = round(h, 4)
            P["sail_middle"] = round(H + 0.012 + h / 2, 4)   # its middle's height over the boat's anchor: where a fan's axis should be
            c.process("sail", "sail-push", solid=f"{c.item['id']}/sail", area=round(A, 6), push=SAIL_PUSH)
        else:
            mast_h = 0.0
            P["sail_width"] = 0.0
            P["sail_height"] = 0.0
            P["sail_middle"] = 0.0
        P["mast_height"] = round(mast_h, 4)
        P["beam"] = B

    register(ItemType("sailboat", "Toy sailboat", "Liquids", build_sailboat, material="pine", materials=["pine"],
                      props=[Prop("hull_length", "Hull length", 0.2, 0.12, 0.4, 0.005, "m"),
                             Prop("hull_mass", "Hull weight", 0.08, 0.02, 0.4, 0.005, "kg", "The hull alone (mast, sail and keel add a few grams)"),
                             Prop("sail", "Sail", "small", kind="choice", choices=list(SAILS),
                                  help="tiny 48 cm² (6 × 8 cm), small 120 cm² (10 × 12), big 320 cm² (16 × 20); none: no mast or sail"),
                             Prop("sail_area_cm2", "Sail area", 120.0, 20.0, 600.0, 5.0, "cm²", "Follows the sail's size until you set it (height 1.25 × width)", auto=("sail",)),
                             Prop("sail_material", "Sail made of", "paper", kind="choice", choices=list(SAIL_STUFF)),
                             Prop("color", "Hull colour", "red", kind="choice", choices=COLOR_NAMES[:-1]),
                             Prop("sail_color", "Sail colour", "white", kind="choice", choices=COLOR_NAMES[:-1])],
                      tags=["boat", "sailboat", "sail", "toy boat", "regatta", "ship", "yacht", "float", "wind", "fan", "raft"],
                      description="A toy sailboat: a pine hull with a keel fin, a dowel mast and a square sail let out at 45°. Put it in water (a trough or tub) and "
                                  "a fan behind it, at the sail's height: the wind on the sail pushes it along; a bigger sail or a nearer, faster fan pushes harder.",
                      source="Rain-gutter regatta hulls are about 18 cm [RGR]. The sail is set 45° to the boat's line: its push along the wind is 0.8 of ½ρv²·A [ORTIZ] "
                             "(1.17 square to the wind [HOE]); its side force is taken by the keel (out of the picture's plane).",
                      anchor="the middle of the hull's flat bottom (its keel hangs below)", facts="20 cm pine hull, 80 g, 120 cm² paper sail",
                      edit=[{"kind": "length", "prop": "hull_length"}], readouts=_boat_readouts(hull=False) + [Readout("air_ms", "Wind at the sail", "m/s", 2),
                                                                                                             Readout("push_n", "Sail push", "N", 3)], module=MODULE))

    # --- an open boat of modelling clay (the same clay as the clay ball) and one of aluminium foil
    def open_boat(c, P, L, D, H, flare, t_solid, mass, base, look, noun, color=None):
        """An open tray-shaped boat: a floor and two end walls (sloping out by `flare` per unit of height) welded, the envelope a hull."""
        Lb = L - 2 * flare * H
        slope = math.sqrt(1 + flare * flare)
        tw = t_solid * slope
        v_floor = Lb * t_solid * D
        v_wall = tw * H * D
        rho = mass / (v_floor + 2 * v_wall)
        m = c.mat(base=base, density=round(rho, 4))
        root = c.slab("floor", Lb, t_solid, D, 0.0, t_solid / 2, material=m, look=look, words=f"the {noun}'s bottom", **({"color": color, "fill": color} if color else {}))
        left = [(-Lb / 2, -t_solid / 2), (-Lb / 2 + tw, -t_solid / 2), (-L / 2 + tw, H - t_solid / 2), (-L / 2, H - t_solid / 2)]
        right = [(Lb / 2 - tw, -t_solid / 2), (Lb / 2, -t_solid / 2), (L / 2, H - t_solid / 2), (L / 2 - tw, H - t_solid / 2)]
        _child(c, "wall-left", root, _poly_body(left, D), (0.0, 0.0), m, look, f"the {noun}'s end", color=color)
        _child(c, "wall-right", root, _poly_body(right, D), (0.0, 0.0), m, look, f"the {noun}'s end", color=color)
        env = _r5([(-Lb / 2, -t_solid / 2), (Lb / 2, -t_solid / 2), (L / 2, H - t_solid / 2), (-L / 2, H - t_solid / 2)])
        # (flooded, it displaces only its own material: the real clay's or foil's volume, not its drawn slabs')
        c.process("hull", "hull", solid=root, points=[{"x": x, "y": y} for x, y in env], rim=[2, 3], depth=round(D, 5),
                  material_ml=round(mass / MATERIALS[base]["density"] * 1e6, 4))
        P["inside_ml"] = round(_area(env) * D * 1e6, 1)

    CLAY_RHO = 1570.0   # the catalog's modelling clay (machines/items.py "modeling clay")
    CLAY_WALL = 0.004

    def build_clay_boat(c, P):
        # proportions L : D : H = 1 : 0.64 : 0.4, ends sloping out 0.5 per unit of height, 4 mm of clay all round (floor, ends, sides):
        # its shell area is 1.5964 L², so L = √(V / (t · 1.5964)) for the clay's volume V = m / ρ
        V = P["mass"] / CLAY_RHO
        k = 0.6 * 0.64 + 2 * 0.4 * math.sqrt(1.25) * 0.64 + 2 * 0.8 * 0.4
        L = math.sqrt(V / (CLAY_WALL * k))
        open_boat(c, P, L, 0.64 * L, 0.4 * L, 0.5, CLAY_WALL, P["mass"], "modeling clay", "clay", "clay boat")
        P["length"] = round(L, 4)

    register(ItemType("clay-boat", "Clay boat", "Liquids", build_clay_boat, material="modeling clay", materials=["modeling clay"],
                      props=[Prop("mass", "Clay", 0.05, 0.02, 0.2, 0.005, "kg", "How much clay; the boat is shaped from it with 4 mm walls (bigger with more clay)")],
                      tags=["clay boat", "plasticine", "boat", "float", "sink", "shape", "hull", "modelling clay", "playdough"],
                      description="Modelling clay shaped into an open boat with 4 mm walls. A ball of the same clay sinks; the boat floats, because its hollow "
                                  "hull pushes aside more water than it weighs. If water comes over its rim it floods and sinks.",
                      source="Modelling clay 1570 kg/m³ (the catalog's clay ball). Shell area 1.596 L² for a boat L long, 0.64 L wide, 0.4 L high.",
                      anchor="the middle of its bottom", facts="50 g of clay: 7 cm long, holds 72 mL", readouts=_boat_readouts(), module=MODULE))

    FOIL_T = 0.000016   # household aluminium foil, m

    def build_foil_boat(c, P):
        L, D, H = P["length"], P["width"], P["height"]
        sheet = L * D + 2 * H * D + 2 * H * L
        mass = 2700.0 * FOIL_T * sheet * 1.1      # 10 % more foil in the folded corners
        open_boat(c, P, L, D, H, 0.0, 0.001, mass, "aluminium foil", "foil", "foil boat")
        P["mass"] = round(mass, 6)

    register(ItemType("foil-boat", "Foil boat", "Liquids", build_foil_boat, material="aluminium foil", materials=["aluminium foil"],
                      props=[Prop("length", "Length", 0.07, 0.03, 0.2, 0.005, "m"), Prop("width", "Front to back", 0.07, 0.03, 0.2, 0.005, "m"),
                             Prop("height", "Side height", 0.015, 0.005, 0.05, 0.001, "m")],
                      tags=["foil boat", "aluminium foil", "tin foil", "pennies", "boat", "cargo", "float", "barge", "design challenge"],
                      description="A little tray folded from kitchen foil (about half a gram): it floats, and holds pennies until the water comes over its sides. "
                                  "A 7 × 7 × 1.5 cm one can hold about 29 pennies if they are spread evenly.",
                      source="Household foil 0.016 mm of aluminium (2700 kg/m³): a 10 × 10 cm sheet weighs 0.43 g. Capacity (ρV − m)/2.5 g per penny [USMINT].",
                      anchor="the middle of its bottom", facts="7 × 7 × 1.5 cm, 0.4 g, holds 73.5 mL", readouts=_boat_readouts(), module=MODULE))


def _things():
    def build_penny(c, P):
        n = int(P["count"])
        c.slab("coin", 0.01905, round(0.00152 * n, 5), 0.01905, material=c.mat(density=round(0.0025 / (0.01905 * 0.00152 * 0.01905), 4)), look="copper",
               words="a penny" if n == 1 else f"a stack of {n} pennies")
        P["mass"] = round(0.0025 * n, 4)

    register(ItemType("penny", "Penny", "Liquids", build_penny, material="copper-plated zinc", materials=["copper-plated zinc"],
                      props=[Prop("count", "Pennies", 1, 1, 100, 1, "", "How many in the stack (one solid stack: a boat's cargo)", kind="int")],
                      tags=["penny", "cent", "coin", "cargo", "weight", "money", "copper", "stack of pennies"],
                      description="A U.S. penny lying flat, or a neat stack of them (count): 2.5 g each. Load a foil or clay boat with stacks of pennies until it sinks.",
                      source="2.500 g, 19.05 mm across, 1.52 mm thick [USMINT].", anchor="its centre", facts="19 mm · 2.5 g each",
                      edit=[{"kind": "rotate"}], module=MODULE))

    def build_grape(c, P):
        r = P["diameter"] / 2
        c.ball("grape", r, material=c.mat(), look="grape", words="a grape")

    register(ItemType("grape", "Grape", "Liquids", build_grape, material="grape", materials=["grape"],
                      props=[Prop("diameter", "Diameter", 0.02, 0.01, 0.03, 0.001, "m")],
                      tags=["grape", "fruit", "density", "sink", "float", "berry"],
                      description="A grape, a little denser than water: it sinks in water and floats on syrup or very salty water.",
                      source="About 1.06 g/cm³ (approximate); a table grape is about 2 cm.", anchor="its centre", facts="2 cm · 4.4 g",
                      edit=[{"kind": "radius", "prop": "diameter"}], module=MODULE))

    def build_cork(c, P):
        r = 0.012
        L = 0.044
        rho = MATERIALS["cork"]["density"]
        c.ball("cork", r, material=c.mat(density=round(rho * 3 * L / (4 * r), 4)), inertia=0.5, shape="cylinder", length=L, look="cork", words="a wine cork")

    register(ItemType("cork", "Cork", "Liquids", build_cork, material="cork", materials=["cork"],
                      props=[], tags=["cork", "stopper", "wine cork", "float", "light", "bobber"],
                      description="A wine cork lying on its side: very light, it floats high on any liquid.",
                      source="A wine cork is 24 mm across and 44 mm long; cork is about 200 kg/m³.", anchor="its centre", facts="24 × 44 mm · 4 g",
                      module=MODULE))

    def build_bead(c, P):
        c.ball("bead", 0.004, material=c.mat(), look="bead", words="a plastic bead")

    register(ItemType("plastic-bead", "Plastic bead", "Liquids", build_bead, material="polyethylene", materials=["polyethylene"],
                      props=[], tags=["bead", "plastic", "pony bead", "density", "float", "sink"],
                      description="A small polyethylene bead (8 mm): it floats on water but sinks in oil, so in a density column it rests where the oil meets the water.",
                      source="High-density polyethylene 950 kg/m³.", anchor="its centre", facts="8 mm · 0.25 g", module=MODULE))

    def build_pebble(c, P):
        w, h = P["width"], P["height"]
        pts = [(-0.5 * w, -0.18 * h), (-0.34 * w, -0.5 * h), (0.3 * w, -0.5 * h), (0.5 * w, -0.12 * h), (0.42 * w, 0.32 * h), (0.12 * w, 0.5 * h),
               (-0.3 * w, 0.46 * h), (-0.48 * w, 0.2 * h)]
        c.poly("stone", _r5(pts), round(0.8 * w, 5), material=c.mat(), look="stone", words="a pebble")

    register(ItemType("pebble", "Pebble", "Liquids", build_pebble, material="granite", materials=["granite", "brick"],
                      props=[Prop("width", "Width", 0.04, 0.01, 0.15, 0.001, "m"), Prop("height", "Height", 0.026, 0.006, 0.1, 0.001, "m")],
                      tags=["rock", "stone", "pebble", "sink", "displacement", "volume", "heavy"],
                      description="A smooth river pebble of granite: it sinks, and the water it pushes aside measures its volume.",
                      source="Granite 2650 kg/m³; front to back 0.8 × its width.", anchor="its centre", facts="4 × 2.6 cm · 68 g",
                      edit=[{"kind": "size", "w": "width", "h": "height"}, {"kind": "rotate"}], module=MODULE))


def _air():
    def build_breeze(c, P):
        _upright(c)
        right = P["direction"] == "to the right"
        steel = c.mat(base="steel", overrides={})
        c.slab("base", 0.12, 0.012, 0.12, 0.0, 0.006, kind="static", material=steel, look="steel", words="the wind sock's stand")
        c.slab("pole", 0.01, 0.5, 0.01, 0.0, 0.262, kind="static", material=steel, look="steel", words="the wind sock's pole")
        x, y = c.world(0.0, 0.0)
        c.sb.animated.append({
            "kind": "animated", "id": f"{c.item['id']}/wind", "words": "a steady breeze", "sprite": "breeze", "item": c.item["id"],
            "vector": [{"id": "wind", "tag": "rect", "attrs": {"x": 0, "y": 0, "width": 0.01, "height": 0.01, "fill": "none"}}],
            "at": {"x": round(x, 5), "y": round(y, 5)}, "keys": [{"t": 0.0, "angle": 0.0}],
            # a stream 20 m across: within ±2 m of its axis its speed is within 3 % of the setting, for 124 m downwind (the engine's jet model)
            "airflow": {"from": P["on_at"], "at": {"x": 0.0, "y": 0.8}, "direction": 0.0 if right else round(math.pi, 6), "diameter": 20.0, "speed": P["speed"],
                        "source": "A steady wind: the engine's round jet made 20 m across, so it is even over the whole table."},
            "depth": 3})

    register(ItemType("breeze", "Breeze", "Air", build_breeze, dynamic=False, material="steel", materials=["steel"],
                      props=[Prop("speed", "Wind speed", 3.0, 0.0, 15.0, 0.5, "m/s", "A light breeze is 2-3 m/s, a strong one 10 m/s"),
                             Prop("direction", "Blows", "to the right", kind="choice", choices=["to the right", "to the left"]),
                             Prop("on_at", "Starts at", 0.0, 0.0, 10.0, 0.1, "s")],
                      tags=["wind", "breeze", "weather", "outdoor", "gust", "wind sock", "air"],
                      description="A steady wind across the whole scene, from where its wind sock stands: it pushes sails, light balls and anything light "
                                  "downwind (nothing behind the sock). Put it at the scene's upwind edge.",
                      source="Beaufort scale: a light breeze 1.6-3.3 m/s, a gentle breeze 3.4-5.4 m/s.", anchor="the middle of its stand's foot",
                      facts="3 m/s to the right", module=MODULE))


# ---------------------------------------------------------------- surface tension: the paper clip, a drop of soap, capillary tubes, paper strips
# Each liquid's surface tension (N/m) and the largest contact angle it makes on ordinary solids ("wets": soap, oil and alcohol wet nearly
# everything), at 20 °C. In a scene with something the surface holds or that climbs (a surface, soap, capillary or wick record) the build adds
# them to its liquids' layers as `tension` and `wets` (the engine takes water's for a layer without them: what another module pours in).
TENSION = {
    "water": (0.0728, 180.0),            # [IAPWS-ST] 72.74 mN/m
    "sea water": (0.0738, 180.0),        # about 1.4 % over pure water (35 g/kg of salts; approximate)
    "vegetable oil": (0.032, 15.0),      # soybean or canola oil 31-33 mN/m (approximate); oil wets steel
    "corn syrup": (0.075, 180.0),        # glucose syrups 70-80 mN/m (approximate)
    "honey": (0.055, 90.0),              # 50-60 mN/m (approximate)
    "dish soap": (0.030, 25.0),          # 25-35 mN/m (approximate)
    "rubbing alcohol": (0.025, 10.0),    # 70 % isopropanol in water, about 24-26 mN/m (approximate)
    "milk": (0.047, 90.0),               # whole milk 45-50 mN/m at 20 °C (its proteins and fat at the surface; approximate)
    "chocolate milk": (0.046, 90.0),     # about as milk's (approximate)
}
SOAPY = (0.030, 25.0)        # water with dish soap on it, above its critical micelle concentration: 25-35 mN/m; it wets steel (provisional)
SOAP_SPREAD = 0.12           # m at 1 s: the soap film's edge runs out as SOAP_SPREAD·t^(3/4) [JENSEN] (the magnitude provisional)
CLIP_WIRE = 0.097            # m of 0.9 mm wire in a Gem No. 1 paper clip (33 × 8 mm; approximate): the magnetism module's paper-clip, 0.45 g
CLIP_THETA = 80.0            # degrees: water on a paper clip's lightly oiled steel wire, 70-90° (provisional)
# types whose parts the surface can hold up when laid gently -> (the parts' names start with, contact line per part (m: both sides of its wire),
# contact angle with water (degrees)); in a scene with a liquid the build adds a {kind: "surface"} record for each such part
SURFACE_TYPES = {"paper-clip": ("clip", round(2 * CLIP_WIRE, 5), CLIP_THETA)}
GLASS_THETA = 0.0            # clean glass and water [ADAMSON]
# paper -> (Washburn coefficient D for water at 20 °C (m²/s: h² = D·t), the highest it climbs (m), its thickness (m)) [WASHBURN] (classroom
# measurements, approximate: filter paper about 1 cm in 10 s and 4 cm in 2.5 min; paper towel faster; office paper is sized and barely wicks)
PAPERS = {"filter paper": (1.1e-5, 0.25, 0.00018), "paper towel": (4.0e-5, 0.15, 0.0003), "printer paper": (3.0e-7, 0.04, 0.0001)}


def tension_of(words):
    """(surface tension N/m, the largest contact angle it allows, degrees) of a liquid layer by its words (salt water by its salt [WEISSENBORN])."""
    if words.startswith("salt water ("):
        pct = float(words[len("salt water ("):words.index(" %")])
        p = min(SALT_MAX, max(0.0, pct))
        molal = p / (100.0 - p) * 1000.0 / 58.44
        return round(0.0728 + 0.00164 * molal, 5), 180.0
    return TENSION.get(words, TENSION["water"])


def _surface():
    def build_soap(c, P):
        _upright(c)
        glass = c.mat(base="glass", overrides={})
        c.slab("dropper", 0.008, 0.08, 0.008, 0.0, 0.04, kind="static", material=glass, look="glass", words="a dropper of dish soap", ghost=True)
        x, y = c.world(0.0, 0.0)
        c.process("soap", "soap", x=round(x, 5), y=round(y, 5), at=P["at_s"], tension=SOAPY[0], wets=SOAPY[1], spread=SOAP_SPREAD)

    register(ItemType("soap-drop", "Drop of soap", "Liquids", build_soap, dynamic=False, material="glass", materials=["glass"],
                      props=[Prop("at_s", "Drops at", 1.0, 0.0, 20.0, 0.1, "s", "When the drop of dish soap falls from the dropper")],
                      tags=["soap", "dish soap", "detergent", "surface tension", "soap boat", "pepper and soap", "dropper", "surfactant", "marangoni"],
                      description="A dropper held over the water lets fall one drop of dish soap: where it lands the surface tension drops from 73 to about "
                                  "30 mN/m and the soap spreads out fast. A paper clip the surface held sinks; a light boat with the soap behind it is pulled "
                                  "forward by the clean water's stronger surface (a soap-powered boat).",
                      source="Soapy water 25-35 mN/m (approximate); it spreads as 0.12·t^(3/4) m [JENSEN] (provisional). The pull on a boat is the "
                             "difference in surface tension times its width at the water line.",
                      anchor="the dropper's tip (the drop falls straight down from it)", facts="one drop at 1 s",
                      readouts=[Readout("spread_cm", "Soap spread", "cm", 1, "How far the soap film has run out from where it landed"),
                                Readout("landed", "Landed", "", 0, "1 once the drop is on the water")], module=MODULE))

    def build_capillary(c, P):
        _upright(c)
        r = P["bore_mm"] / 2000
        L = P["length"]
        out = round(2 * r + 0.002, 5)
        c.slab("tube", out, L, out, 0.0, L / 2, kind="static", material=c.mat(base="glass", overrides={}), look="glass", words="a thin glass tube", ghost=True)
        x, y = c.world(0.0, 0.0)
        c.process("capillary", "rise", x=round(x, 5), bottom=round(y, 5), top=round(y + L, 5), r=round(r, 7), theta=GLASS_THETA)
        P["jurin_mm"] = round(2 * 0.0728 / (998.2 * 9.81 * r) * 1000, 1)

    register(ItemType("capillary-tube", "Capillary tube", "Liquids", build_capillary, dynamic=False, material="glass", materials=["glass"],
                      props=[Prop("bore_mm", "Inside width", 1.0, 0.3, 4.0, 0.1, "mm", "The thinner the tube, the higher water climbs it"),
                             Prop("length", "Length", 0.15, 0.05, 0.4, 0.005, "m")],
                      tags=["capillary", "capillary action", "thin tube", "straw", "adhesion", "cohesion", "surface tension", "meniscus", "glass tube"],
                      description="A thin glass tube held upright with its lower end in a liquid: water climbs inside it above the outside surface, "
                                  "higher the thinner the tube (Jurin's law: about 30 mm in a 1 mm tube, 7 mm in a 4 mm one). Hold it in the air (a stand "
                                  "holds it) with its bottom end 1-3 cm under the surface.",
                      source="Jurin's law h = 2γ·cosθ/(ρ·g·r) [ADAMSON]: water in clean glass (θ 0) climbs 29.7 mm in a 1 mm bore; it climbs at the "
                             "Washburn rate, viscosity against the pull, never faster than √(2γ/(ρr)).",
                      anchor="its bottom end", facts="1 mm bore, 15 cm long", readouts=[Readout("rise_mm", "Rise", "mm", 1, "How far the liquid inside stands above the outside surface")],
                      module=MODULE))

    def build_strip(c, P):
        _upright(c)
        L, w = P["length"], P["width"]
        D, hmax, thick = PAPERS[P["paper"]]
        c.slab("strip", w, L, thick, 0.0, L / 2, kind="static", material=c.mat(base="paper strip", overrides={}), look="paper", words=f"a strip of {P['paper']}", ghost=True)
        x, y = c.world(0.0, 0.0)
        c.process("wick", "wick", x=round(x, 5), bottom=round(y, 5), top=round(y + L, 5), D=D, hmax=hmax)

    register(ItemType("paper-strip", "Paper strip", "Liquids", build_strip, dynamic=False, material="paper strip", materials=["paper strip"],
                      props=[Prop("paper", "Paper", "paper towel", kind="choice", choices=list(PAPERS),
                                  help="paper towel climbs fastest; filter paper (chromatography) steadily; printer paper is sized and barely wicks"),
                             Prop("length", "Length", 0.15, 0.05, 0.3, 0.005, "m"), Prop("width", "Width", 0.02, 0.005, 0.06, 0.001, "m")],
                      tags=["paper towel", "filter paper", "wick", "capillary action", "chromatography", "walking water", "paper strip", "absorb"],
                      description="A strip of paper hung with its lower end in a liquid: the liquid climbs up it through the paper's fibres (capillary "
                                  "action), fast at first and slower as it rises. Hold it in the air (a clip holds it) with its bottom end under the surface.",
                      source="Lucas-Washburn h² = D·t [WASHBURN]: paper towel about 4 × 10⁻⁵, filter paper 1.1 × 10⁻⁵, printer paper 3 × 10⁻⁷ m²/s for "
                             "water (approximate), D going as γ·cosθ/μ for other liquids (syrup and honey creep).",
                      anchor="its bottom end", facts="paper towel, 2 × 15 cm", readouts=[Readout("wet_mm", "Wet to", "mm", 1, "How far above the surface the liquid has climbed")],
                      module=MODULE))


# ---------------------------------------------------------------- goals (web/sim/modules/fluids.js reports the same, number for number)
def _goals():
    def last(ctx, iid, key):
        v = ctx.state(iid, key)
        return v[-1] if v else None

    def floats(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        a = last(ctx, g["item"], "afloat")
        sub = last(ctx, g["item"], "submerged")
        return {"label": g.get("label") or f"{ctx.name(g['item'])} floats", "ok": a == 1, "kind": "floats", "item": g["item"],
                "submerged": None if sub is None else round(sub, 3)}

    def sinks(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        s = last(ctx, g["item"], "sunk")
        sub = last(ctx, g["item"], "submerged")
        return {"label": g.get("label") or f"{ctx.name(g['item'])} sinks to the bottom", "ok": s == 1, "kind": "sinks", "item": g["item"],
                "submerged": None if sub is None else round(sub, 3)}

    def level(ctx, g):
        if not ctx.known(g.get("container")):
            return None
        lo, hi = ctx.num(g.get("at_least_ml")), ctx.num(g.get("at_most_ml"))
        v = last(ctx, g["container"], "volume_ml")
        ok = v is not None and (lo is None or v >= lo - 1e-9) and (hi is None or v <= hi + 1e-9)
        bounds = (f" at least {_num_text(lo)} mL" if lo is not None else "") + (f" at most {_num_text(hi)} mL" if hi is not None else "")
        return {"label": g.get("label") or f"{ctx.name(g['container'])} reads{bounds or ' a level'}", "ok": ok, "kind": "level", "container": g["container"],
                "ml": None if v is None else round(v, 1)}

    def floats_then_sinks(ctx, g):
        # it floats first and only then sinks, and rests on the bottom at the end (by by_s when given): a cup a tap fills until it goes under,
        # a boat loaded until it floods; never met by a thing that sank from the start
        if not ctx.known(g.get("item")):
            return None
        by = ctx.num(g.get("by_s"))
        a = ctx.state(g["item"], "afloat") or []
        s = ctx.state(g["item"], "sunk") or []
        t_float = t_sink = None
        for t, x, y in zip(ctx.times, a, s):
            if t_float is None:
                if x == 1:
                    t_float = t
            elif t_sink is None and y == 1:
                t_sink = t
        ok = t_float is not None and t_sink is not None and bool(s) and s[-1] == 1 and (by is None or t_sink <= by + 1e-9)
        fl = last(ctx, g["item"], "flooded")
        name = ctx.name(g["item"])
        return {"label": g.get("label") or (f"{name} floats, then fills and sinks" + (f" by {_num_text(by)} s" if by is not None else "")), "ok": ok,
                "kind": "floats_then_sinks", "item": g["item"], "floated_s": None if t_float is None else round(t_float, 3),
                "sank_s": None if t_sink is None else round(t_sink, 3), "flooded": None if fl is None else fl == 1}

    register_goal_kind("floats", floats)
    register_goal_kind("sinks", sinks)
    register_goal_kind("level", level)
    def rise_of(ctx, iid):
        v = last(ctx, iid, "rise_mm")
        return v if v is not None else last(ctx, iid, "wet_mm")

    def climbs(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        lo, hi = ctx.num(g.get("at_least_mm")), ctx.num(g.get("at_most_mm"))
        v = rise_of(ctx, g["item"])
        ok = v is not None and v > 0.05 and (lo is None or v >= lo - 1e-9) and (hi is None or v <= hi + 1e-9)
        bounds = (f" at least {_num_text(lo)} mm" if lo is not None else "") + (f" at most {_num_text(hi)} mm" if hi is not None else "")
        return {"label": g.get("label") or f"the liquid climbs {ctx.name(g['item'])}{bounds}", "ok": ok, "kind": "climbs", "item": g["item"],
                "mm": None if v is None else round(v, 1)}

    def climbs_higher(ctx, g):
        if not ctx.known(g.get("a")) or not ctx.known(g.get("b")):
            return None
        a, b = rise_of(ctx, g["a"]), rise_of(ctx, g["b"])
        ok = a is not None and b is not None and a > b + 0.05
        return {"label": g.get("label") or f"the liquid climbs {ctx.name(g['a'])} higher than {ctx.name(g['b'])}", "ok": ok, "kind": "climbs_higher",
                "a": g["a"], "b": g["b"], "a_mm": None if a is None else round(a, 1), "b_mm": None if b is None else round(b, 1)}

    register_goal_kind("floats_then_sinks", floats_then_sinks)
    register_goal_kind("climbs", climbs)
    register_goal_kind("climbs_higher", climbs_higher)


# ---------------------------------------------------------------- true volumes of catalog items whose outline × depth is not their volume
# A catalog item's solids are its side outline × its depth, with densities that put its real weight where it is: right for its motion, but for a
# few items not their outer volume (an egg's overlapping pieces, a mug's or a cone's hollow that fills with water). In a scene with a liquid the
# build adds {kind: "displace", item, volume_ml} for them: the engine scales what such an item pushes aside to its real volume (mass ÷ density).
TRUE_DENSITY = {
    "egg": (1080.0, None, "A fresh hen's egg: specific gravity 1.065-1.100 (Hamilton, Poultry Sci. 61, 2022, 1982); 1.08 used."),
    "coffee-mug": (2400.0, None, "A mug is open: under water it fills, so only its stoneware (2300-2400 kg/m³) displaces."),
    "soda-can": (1040.0, "full", "A full can of sugary soda: about 1.04 kg/L with its can, so it sinks (a diet one, about 0.997, floats)."),
    "soda-can-side": (1040.0, "full", "A full can of sugary soda: about 1.04 kg/L with its can."),
    "water-bottle": (1005.0, "full", "A full bottle is water and a little PET (1380 kg/m³): about 1.005 kg/L, it barely sinks."),
    "water-bottle-side": (1005.0, "full", "A full bottle is water and a little PET: about 1.005 kg/L."),
    "traffic-cone": (1400.0, None, "A traffic cone is open underneath: it fills, so only its PVC (1300-1450 kg/m³) displaces."),
    "lego-brick": (1050.0, None, "A LEGO brick is open underneath: it fills with water and sinks slowly (ABS 1040-1060 kg/m³)."),
    "paper-clip": (7850.0, None, "A paper clip is steel wire: its outline in the side view is a slab, its volume the wire's."),
}
SURFACE_KINDS = ("surface", "soap", "capillary", "wick")


def _body_volume(b):
    """A doc body's volume as the engine reckons its mass (part.ts volume): a ball's sphere or shell, a slab's (tapered) box, a polygon's prism."""
    if b["kind"] == "ball":
        r = b["radius"]
        w = b.get("wall")
        return (4 / 3) * math.pi * (cube(r) - cube(max(0.0, r - (w if w is not None else r))))
    if b["kind"] == "slab":
        t = b.get("taper", 1)
        return ((1 + t) / 2) * b["width"] * b["height"] * b["depth"]
    pts = [(p["x"], p["y"]) for p in b["points"]]
    return _area(pts) * b["depth"]


# ---------------------------------------------------------------- open vessels of the catalog float as hollow hulls
# A mug or a bowl put in a liquid floats on its whole outer volume up to its rim (its hollow is air), less the liquid that is in it: what another
# module pours in (the flow module's tap or pitcher: its weight is in the body's mass) and what comes in over its rim; full (its outside's
# volume less its material), it floods and sinks if its material is denser than the liquid, as a clay or foil boat does. In a scene with a liquid
# the build adds {kind: "hull", ..., vessel: true} for them (tooling/src/sim/modules/fluids.ts). The catalog's cup, plastic cup, jar, bucket and
# box are fixed in place: they never float.
# type -> (its floor's part, its walls' parts, round: its horizontal section a circle (a frustum's volume), else a box of the floor's depth)
VESSELS = {
    "coffee-mug": ("body", ("wall-left", "wall-right"), True),
    "bowl": ("base", ("wall-left", "wall-right"), True),
}


def _body_points(b):
    """A doc body's outline in its own frame: a polygon's points, a slab's corners (a tapered slab narrower at its bottom)."""
    if b["kind"] == "polygon":
        return [(p["x"], p["y"]) for p in b["points"]]
    t = b.get("taper", 1)
    w, h = b["width"], b["height"]
    return [(-w / 2 * t, -h / 2), (w / 2 * t, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]


def _convex(pts):
    """The convex hull of points, counter-clockwise from the lowest-leftmost, without points on its edges (Andrew's monotone chain)."""
    P = sorted(set(pts))
    if len(P) < 3:
        return P
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for q in P:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], q) <= 0:
            lower.pop()
        lower.append(q)
    for q in reversed(P):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], q) <= 0:
            upper.pop()
        upper.append(q)
    return lower[:-1] + upper[:-1]


def _strictly_convex(pts):
    n = len(pts)
    for i in range(n):
        a, b, c = pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 0:
            return False
    return n >= 3


def vessel_hull(sb, iid, itype, material):
    """The hull record of an open vessel of the catalog (VESSELS) built in sb, or None: its envelope (the convex outline of its floor and walls in its
    floor's frame, rounded to 0.01 mm), its rim (the two top corners), its front-to-back size (round: the depth that makes the outline's area a
    frustum's volume, π(D² + Db + b²)/(6(D + b)) for a top D and a bottom b wide) and its material's real volume (its mass over its material's
    density: flooded, only that displaces)."""
    spec = VESSELS.get(itype)
    if spec is None:
        return None
    root_part, walls, rnd = spec
    have = {s["id"]: s for s in sb.solids if s["item"] == iid}
    root = have.get(f"{iid}/{root_part}")
    if root is None or root["kind"] != "dynamic":
        return None
    pts = list(_body_points(root["body"]))
    for w in walls:
        s = have.get(f"{iid}/{w}")
        if s is None or s["kind"] != "dynamic" or s.get("parent") != root["id"]:
            return None
        a = s.get("angle", 0.0)
        ca, sa = cos(a), sin(a)
        ax, ay = s["at"]["x"], s["at"]["y"]
        pts += [(ax + x * ca - y * sa, ay + x * sa + y * ca) for x, y in _body_points(s["body"])]
    env = _convex([(round(x, 5) + 0.0, round(y, 5) + 0.0) for x, y in pts])
    while len(env) >= 3 and not _strictly_convex(env):
        # (rounding left a point on an edge: drop the first one that does not turn)
        n = len(env)
        for i in range(n):
            a, b, c = env[i], env[(i + 1) % n], env[(i + 2) % n]
            if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 0:
                k = (i + 1) % n
                env = env[:k] + env[k + 1:]
                break
    if len(env) < 3 or len(env) > 8:
        return None
    top = max(y for _, y in env)
    rim = [i for i, (_, y) in enumerate(env) if y >= top - 1e-6]
    if len(rim) < 2:
        rim = sorted(range(len(env)), key=lambda i: (-env[i][1], i))[:2]
    rim = sorted(rim, key=lambda i: env[i][0])
    i, j = rim[-1], rim[0]
    low = min(y for _, y in env)
    bottom = [x for x, y in env if y <= low + 1e-6]
    D = abs(env[i][0] - env[j][0])
    b = max(bottom) - min(bottom) if len(bottom) > 1 else 0.0
    depth = math.pi * (D * D + D * b + b * b) / (6 * (D + b)) if rnd else root["body"]["depth"]
    mass = 0.0
    out_mass = 0.0
    out = []
    shell = {root["id"]} | {f"{iid}/{w}" for w in walls}
    for s in sb.solids:
        if s["item"] == iid and s["kind"] == "dynamic":
            m = sb.materials[s["material"]]["density"] * _body_volume(s["body"])
            mass += m
            if s["id"] not in shell and s["body"]["kind"] != "ball":
                # (a part outside the envelope, a mug's handle: it displaces its own material's volume too while the vessel floats)
                out.append(s["id"])
                out_mass += m
    rho = MATERIALS[material]["density"] if material in MATERIALS else None
    if not (depth > 0) or not (mass > 0) or not rho:
        return None
    rec = {"kind": "hull", "id": f"{iid}/hull", "item": iid, "solid": root["id"], "points": [{"x": x, "y": y} for x, y in env], "rim": [i, j],
           "depth": round(depth, 5), "material_ml": round(mass / rho * 1e6, 4)}
    if out and out_mass > 0:
        rec.update(extra=out, extra_ml=round(out_mass / rho * 1e6, 4))
    rec["vessel"] = True
    return rec


def _displacement(sb, scene):
    if not any(p["kind"] == "liquid" for p in sb.processes):
        return
    # (the parts the surface can hold up when laid gently: a paper clip's)
    for item in scene.get("items", []):
        spec = SURFACE_TYPES.get(item.get("type")) if isinstance(item, dict) else None
        if spec is None:
            continue
        head, contact, theta = spec
        for s in sb.solids:
            if s["item"] == item["id"] and s["kind"] == "dynamic" and s["id"].startswith(f"{item['id']}/{head}"):
                part = s["id"][len(item["id"]) + 1:]
                sb.processes.append({"kind": "surface", "id": f"{item['id']}/surface-{part}", "item": item["id"], "solid": s["id"], "contact_m": contact,
                                     "theta": theta})
    # (something the surface holds or that climbs: every liquid's surface tension, for the engine)
    if any(p["kind"] in SURFACE_KINDS for p in sb.processes):
        for p in sb.processes:
            if p["kind"] == "liquid":
                for layer in p["layers"]:
                    g, wets = tension_of(layer["words"])
                    layer["tension"] = g
                    layer["wets"] = wets
    # a fan raised to a sail's height (a boat lane's) stands on a post the view draws when nothing holds it up (render only: `stand`)
    for s in sb.solids:
        if s["id"].endswith("/base") and (sb.scene_items.get(s["item"]) or {}).get("type") == "fan":
            s.setdefault("stand", "post")
    for item in scene.get("items", []):
        if not isinstance(item, dict):
            continue
        if item.get("type") in VESSELS:
            # (an open vessel floats as a hollow hull: its record replaces the displace one)
            P = props_of(item)
            rec = vessel_hull(sb, item["id"], item["type"], P.get("material") or TYPES[item["type"]].material)
            if rec is not None:
                sb.processes.append(rec)
                continue
        if item.get("type") not in TRUE_DENSITY:
            continue
        rho, need, _src = TRUE_DENSITY[item["type"]]
        if need is not None and not props_of(item).get(need):
            continue
        mass = 0.0
        for s in sb.solids:
            if s["item"] == item["id"] and s["kind"] == "dynamic":
                mass += sb.materials[s["material"]]["density"] * _body_volume(s["body"])
        if mass > 0:
            sb.processes.append({"kind": "displace", "id": f"{item['id']}/displace", "item": item["id"], "volume_ml": round(mass / rho * 1e6, 4)})
