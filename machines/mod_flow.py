"""The flow module: liquids that MOVE. Pour from a pitcher, a jug or a cup; a tap's stream; jets from holes in a bottle (lower holes squirt
faster, because the pressure grows with depth); hoses and siphons between containers; a waterwheel turned by a stream; honey and
syrup that creep where water rushes; food colouring that mixes (blue and yellow make green).

items.py imports this file (machines/mod_<name>.py) after the catalog files and calls register_all(globals()); web/sim/modules/flow.js is its
exact JavaScript port (the same documents, number for number). The engine side is tooling/src/sim/modules/flow.ts with the physics in
tooling/src/sim/flow.ts: free liquid is particles (a position-based fluid: splashing, streams, puddles, two-way pushes on solids), still
liquid stands in containers (basins: level whatever the tilt, poured out over the rim as a weir, through holes as an orifice, through hoses
by Bernoulli with losses). Every catalog cup, mug, jar, bucket, bowl and box catches liquid once the scene has something that pours
(a build hook adds their "flow-basin" records; a scene without any flow item gets nothing, so it builds exactly as before). The fluids
module's containers (water tanks, beakers, cylinders, measuring jugs) take poured liquid and feed hoses through that module's interface.

Sources (every liquid's numbers are at 20 °C; the same table as machines/mod_fluids.py so the same liquid joins the same layer):
  [IAPWS-95] Wagner & Pruss, J. Phys. Chem. Ref. Data 31, 387 (2002): water 998.2 kg/m³, 1.002 mPa·s.
  [CRC] CRC Handbook of Chemistry and Physics, "Concentrative properties of aqueous solutions: sodium chloride".
  [SHARQAWY] Sharqawy, Lienhard & Zubair, Desalination and Water Treatment 16, 354 (2010): sea water 1024.8 kg/m³, 1.08 mPa·s.
  [NOUREDDINI] Noureddini, Teoh & Clements, JAOCS 69, 1189 (1992): soybean oil about 920 kg/m³, about 0.06 Pa·s.
  [YANNIOTIS] Yanniotis, Skaltsi & Karaburnioti, J. Food Eng. 72, 372 (2006): honey 2-20 Pa·s by its water (10 used).
  [WHITE] F. M. White, Fluid Mechanics, 7th ed. (2011): orifice C_d 0.61, C_v 0.97; hose entrance loss 0.5; Poiseuille / Blasius friction.
  [EPA-WS] U.S. EPA WaterSense: a kitchen faucet flows at most 2.2 gal/min (139 mL/s) at 60 psi; bathroom faucets 1.5 gal/min (95 mL/s).
  [PET] A 2 L PET soda bottle is about 105 mm across outside (102 mm inside) and its straight body about 23 cm tall.
  Provisional (approximate, said so in the source texts): corn syrup, dish soap, rubbing alcohol viscosities; the dyes' strengths (a few
  drops of food colouring in a glass); a spout's or a rim's pouring width.
"""
import math

from crmath import cos, sin  # noqa: F401  (the same bits as web/sim's port on any machine)

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "MATERIALS", "add_look", "LOOKS", "LOOK_FILL", "LOOK_SHADE", "D2R",
          "register_goal_kind", "register_build_hook", "TYPES", "polygon_problem", "CATEGORIES")

MODULE = "flow"
CATEGORY = "Pouring & flowing"


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CATEGORY not in CATEGORIES:
        CATEGORIES.append(CATEGORY)
    _looks()
    _pourers()
    _tap()
    _bottle()
    _hose()
    _wheel()
    _goals()
    register_build_hook(_basins)


# ---------------------------------------------------------------- liquids (machines/mod_fluids.py's table, the same words and numbers)
LIQUIDS = {
    "water": (998.2, 0.001002, "Water at 20 °C: 998.2 kg/m³, 1.002 mPa·s [IAPWS-95]."),
    "salt water": (None, None, "Salt water (sodium chloride) at 20 °C: density and viscosity by its salt [CRC]."),
    "sea water": (1024.8, 0.00108, "Sea water, 35 g of salt a kilogram: 1024.8 kg/m³, 1.08 mPa·s [SHARQAWY]."),
    "vegetable oil": (920.0, 0.06, "Soybean or canola oil: about 920 kg/m³, about 0.06 Pa·s [NOUREDDINI] (approximate)."),
    "honey": (1420.0, 10.0, "Honey: about 1420 kg/m³; 2-20 Pa·s by its water, 10 used [YANNIOTIS] (approximate)."),
    "corn syrup": (1380.0, 2.5, "Light corn syrup: about 1380 kg/m³, about 2.5 Pa·s (approximate: brands differ)."),
    "dish soap": (1050.0, 0.5, "Liquid dish soap: about 1050 kg/m³, about 0.5 Pa·s (manufacturers' data; approximate)."),
    "rubbing alcohol": (880.0, 0.0025, "Rubbing alcohol (70 % isopropyl): about 880 kg/m³, about 2.5 mPa·s (approximate)."),
}
LIQUID_NAMES = list(LIQUIDS)
SALT = [(0.0, 998.2, 1.002), (1.0, 1005.3, 1.020), (2.0, 1012.5, 1.036), (4.0, 1026.8, 1.070), (6.0, 1041.3, 1.108), (8.0, 1055.9, 1.149),
        (10.0, 1070.7, 1.193), (12.0, 1085.7, 1.244), (14.0, 1100.9, 1.300), (16.0, 1116.2, 1.361), (20.0, 1147.8, 1.503),
        (24.0, 1180.2, 1.686), (26.0, 1197.2, 1.800)]
SALT_MAX = 26.0


def _num_text(v):
    """A number as a short text: 10, 12.5 (no trailing zeros), as web/sim's port writes it."""
    r = round(v, 2)
    return str(int(r)) if r == int(r) else f"{r:g}"


def salt_water(pct):
    p = min(SALT_MAX, max(0.0, pct))
    for (p0, d0, m0), (p1, d1, m1) in zip(SALT, SALT[1:]):
        if p <= p1:
            u = (p - p0) / (p1 - p0)
            return round(d0 + (d1 - d0) * u, 3), round((m0 + (m1 - m0) * u) / 1000, 7)
    return SALT[-1][1], SALT[-1][2] / 1000


def liquid_of(P):
    """{words, density, viscosity} of an item's liquid choice (its salt for salt water)."""
    name = P["liquid"]
    if name == "salt water":
        d, v = salt_water(P["salt_pct"])
        return {"words": f"salt water ({_num_text(P['salt_pct'])} % salt)", "density": d, "viscosity": v}
    d, v, _ = LIQUIDS[name]
    return {"words": name, "density": d, "viscosity": v}


# Food colouring, as absorbance per centimetre of light path (red, green, blue): what shows through is exp(−a·path). A few drops in a glass
# (provisional strengths). Mixed by volume: blue and yellow make green, red and blue purple, red and yellow orange.
DYES = {"none": [0.0, 0.0, 0.0], "red": [0.0, 0.5, 0.25], "orange": [0.0, 0.18, 0.5], "yellow": [0.0, 0.02, 0.5], "green": [0.45, 0.02, 0.4],
        "blue": [0.5, 0.08, 0.005], "purple": [0.2, 0.5, 0.05]}
DYE_NAMES = list(DYES)
# The named colours a mixture is told by (goal "mixes_to"): each dye's colour seen through 5 cm of water, as shares of its brightness
# (r, g, b over their sum); "clear" when every channel shows 85 % or more, "brown" when none shows 40 %.
COLOR_REF = {"red": (0.7275, 0.0605, 0.212), "orange": (0.6688, 0.2753, 0.0558), "yellow": (0.5001, 0.4582, 0.0418),
             "green": (0.0909, 0.7903, 0.1187), "blue": (0.0468, 0.3872, 0.5659), "purple": (0.2959, 0.0669, 0.6372)}
COLOR_NAMES = ["clear", "brown"] + list(COLOR_REF)


def color_name(r, g, b):
    """The name of a transmitted colour (each 0…1)."""
    if min(r, g, b) >= 0.85:
        return "clear"
    if max(r, g, b) < 0.4:
        return "brown"
    s = r + g + b
    if not s > 0:
        return "brown"
    best, name = None, "clear"
    for k, (cr, cg, cb) in COLOR_REF.items():
        dr, dg, db = r / s - cr, g / s - cg, b / s - cb
        d = dr * dr + dg * dg + db * db
        if best is None or d < best:
            best, name = d, k
    return name


def _liquid_props(default="water"):
    return [Prop("liquid", "Liquid", default, kind="choice", choices=LIQUID_NAMES,
                 help="What is in it (each at 20 °C): honey and syrup pour slowly, water and alcohol fast"),
            Prop("salt_pct", "Salt", 10.0, 0.0, SALT_MAX, 0.5, "%", "Salt water only: grams of salt in 100 g of it"),
            Prop("dye", "Food colouring", "none", kind="choice", choices=DYE_NAMES,
                 help="A few drops of food colouring: liquids of two colours mix (blue and yellow make green)")]


def _looks():
    for key, kw in (("flow chrome", dict(fill="#d8dde2", shade="#8f979e", roughness=0.12, metalness=1.0, clearcoat=0.6)),
                    ("flow tubing", dict(fill="#e6f0f2", shade="#a9bcc0", roughness=0.25, metalness=0.0, clearcoat=0.8, transmission=0.6,
                                         ior=1.45, thickness=0.004)),
                    ("flow paddle", dict(fill="#e2b04a", shade="#a87e28", roughness=0.4, metalness=0.0, clearcoat=0.4))):
        if key not in LOOKS:
            add_look(key, **kw)


def _r5(pts):
    return [(round(x, 5), round(y, 5)) for x, y in pts]


def _child(c, part, parent, body, at, material, look, words, angle=0.0, **extra):
    """A solid welded to another solid of this item: `at` (and `angle`, rad) in the parent's own frame."""
    s = {"kind": c.kind, "id": f"{c.item['id']}/{part}", "words": words, "item": c.item["id"], "look": look, "body": body, "material": material,
         "at": {"x": round(at[0], 5), "y": round(at[1], 5)}, "parent": parent, "placeholder": {"fill": LOOK_FILL[look]},
         "render": {"kind": "procedural", "shade": LOOK_SHADE[look]}, "depth": 2}
    if abs(angle) > 1e-12:
        s["angle"] = round(angle, 6)
    s.update(extra)
    c.sb.solids.append(s)
    return s["id"]


def _slab(w, h, d):
    return {"kind": "slab", "width": round(w, 5), "height": round(h, 5), "depth": round(d, 5)}


def _box(x0, y0, x1, y1):
    """A box as the inside's four corners (bottom-left, bottom-right, top-right, top-left), each {x, y}."""
    return [{"x": round(x, 5), "y": round(y, 5)} for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]


def _pour_readouts():
    return [Readout("left_ml", "Left in it", "mL", 1), Readout("poured_ml", "Poured out", "mL", 1),
            Readout("flow_ml_s", "Pouring", "mL/s", 1, "How fast it pours now"), Readout("tilt_deg", "Tipped", "°", 0),
            Readout("lands_x", "Stream lands at", "m", 3, "Where along the table its stream comes down (x)")]


# ---------------------------------------------------------------- pitchers, jugs and cups that a hand tips to pour
# inner width (round: its diameter), inner height, wall, spout width, material, look, default mL, words, handle
VESSELS = {
    "pitcher": (0.10, 0.17, 0.003, 0.035, "glass", "glass", 750.0, "a glass pitcher", True),
    "jug": (0.13, 0.22, 0.0025, 0.04, "polypropylene", "plastic", 1500.0, "a plastic jug", True),
    "measuring cup": (0.095, 0.12, 0.0025, 0.025, "polypropylene", "plastic", 400.0, "a plastic measuring cup", True),
    "cup": (0.07, 0.095, 0.002, 0.03, "PET", "plastic", 200.0, "a plastic cup", False),
}


def _pourers():
    def build_pitcher(c, P):
        w, h, t, lip, mat, look, ml0, words, handle = VESSELS[P["vessel"]]
        given = c.item.get("props") or {}
        if "fill_ml" not in given:
            P["fill_ml"] = ml0
        D = math.pi / 4 * w
        cap = w * h * D * 1e6
        fill = min(P["fill_ml"], 0.97 * cap)
        side = 1.0 if P["pour_to"] == "right" else -1.0
        m = c.mat(base=mat, overrides={})
        # the root is the pour lip at the item's anchor (the hand turns the whole pitcher about it); the rest welded to it
        root = c.slab("lip", 0.01, t, lip, 0.0, 0.0, kind="static", material=m, look=look, words=f"{words}'s spout")
        _child(c, "floor", root, _slab(w + 2 * t, t, w + 2 * t), (-side * w / 2, -h - t / 2), m, look, f"{words}'s bottom")
        _child(c, "wall-spout", root, _slab(t, h, w + 2 * t), (side * t / 2, -h / 2), m, look, f"{words}'s wall")
        _child(c, "wall-back", root, _slab(t, h, w + 2 * t), (-side * (w + t / 2), -h / 2), m, look, f"{words}'s wall")
        if handle:
            _child(c, "handle", root, _slab(0.012, 0.6 * h, 0.014), (-side * (w + t + 0.03), -0.45 * h), m, look, f"{words}'s handle")
        inside = _box(-w, -h, 0.0, 0.0) if side > 0 else _box(0.0, -h, w, 0.0)
        # (more than fits: filled to the brim, and the record keeps what was asked, so the run says "only 355 mL fits in it")
        asked = {"asked": round(P["fill_ml"], 1)} if P["fill_ml"] > 0.97 * cap + 1e-9 else {}
        c.process("flow-pour", "pour", solid=root, inside=inside, depth=round(D, 6), lip=lip, wall=t, liquid=liquid_of(P), dye=list(DYES[P["dye"]]),
                  volume=round(fill / 1e6, 9), tilt=round(-side * P["tilt"] * D2R, 6), at=P["pour_at"], turn=P["tip_s"],
                  back=P["back_at"] if P["back_at"] > 0 else None, **asked)
        P["capacity_ml"] = round(cap, 1)
        P["inner_width"] = w
        P["inner_height"] = h

    register(ItemType("pitcher", "Pitcher", CATEGORY, build_pitcher, dynamic=False, material="glass", materials=["glass"],
                      props=[Prop("vessel", "Kind", "pitcher", kind="choice", choices=list(VESSELS),
                                  help="pitcher: a 1.3 L glass pitcher; jug: a 2.9 L plastic jug; measuring cup: 0.85 L; cup: a 0.37 L plastic cup"),
                             Prop("fill_ml", "Liquid in it", 750.0, 0.0, 2900.0, 5.0, "mL", "How much it holds at the start (follows the kind until you set it)",
                                  auto=("vessel",)),
                             *_liquid_props(),
                             Prop("pour_to", "Pours to the", "right", kind="choice", choices=["right", "left"], help="The side its spout faces and it tips toward"),
                             Prop("pour_at", "Starts tipping at", 1.0, 0.0, 20.0, 0.1, "s"),
                             Prop("tilt", "Tips to", 110.0, 10.0, 170.0, 1.0, "°", "How far the hand tips it from upright (about 90° or more empties it)"),
                             Prop("tip_s", "Tipping takes", 1.5, 0.1, 10.0, 0.1, "s"),
                             Prop("back_at", "Tips back at", 0.0, 0.0, 30.0, 0.1, "s", "When the hand stands it up again (0: never)")],
                      links=[], readouts=_pour_readouts(),
                      tags=["pitcher", "jug", "pour", "pouring", "cup", "glass", "water", "milk", "fill", "measuring cup", "honey", "syrup", "kettle", "cup of water", "glass of water", "cup of oil", "cup of milk", "cup of juice", "pour water", "pour oil", "pour milk", "pour juice", "pour honey", "pour syrup", "vegetable oil", "coloured water", "colored water", "paint water", "food colouring", "food coloring", "water runs down", "spill"],
                      description="A pitcher, jug or cup of liquid that a hand tips to pour, from the moment you set and as far as you set. Its item position is "
                                  "its pour lip, where the stream starts: put the lip above the container to fill (a few cm to its side the stream lands a "
                                  "little further). The level inside stays flat as it tips; it pours over the lip like water over a weir, so honey pours far "
                                  "slower than water.",
                      source="Pouring over a lip: a sharp-crested weir, q = 0.62·⅔·√(2g)·H^1.5 per metre of lip, and a viscous film's g·H³/(3ν) for thick "
                             "liquids (Henderson 1966; Nusselt 1916). A glass pitcher 10 cm across, 17 cm deep inside; spout widths approximate.",
                      anchor="its pour lip (the spout's top edge): the stream starts there", facts="1.3 L glass pitcher, 750 mL of water, tips at 1 s",
                      module=MODULE))


# ---------------------------------------------------------------- a tap
NOZZLES = {"aerator": 0.022, "plain": 0.012}


def _tap():
    def build_tap(c, P):
        reach = 0.16
        m = c.mat(base="steel", overrides={})
        kw = dict(kind="static", material=m, look="flow chrome")
        c.slab("outlet", 0.026, 0.03, 0.026, 0.0, 0.017, words="the tap's outlet", **kw)
        c.slab("spout", reach, 0.022, 0.024, -reach / 2, 0.043, words="the tap's spout", **kw)
        c.slab("plate", 0.012, 0.07, 0.07, -reach - 0.006, 0.043, words="the tap's wall plate", **kw)
        c.slab("handle", 0.05, 0.012, 0.016, -reach + 0.03, 0.068, words="the tap's lever", **kw)
        c.process("flow-tap", "flow", at={"x": round(c.ox, 5), "y": round(c.oy, 5)}, angle=round(c.a - math.pi / 2, 6), d=NOZZLES[P["nozzle"]],
                  q=round(P["flow_ml_s"] / 1e6, 9), on=P["on_at"], off=P["off_at"] if P["off_at"] > 0 else None, liquid=liquid_of(P),
                  dye=list(DYES[P["dye"]]))

    register(ItemType("tap", "Tap", CATEGORY, build_tap, dynamic=False, material="steel", materials=["steel"],
                      props=[Prop("flow_ml_s", "Flow", 100.0, 5.0, 250.0, 5.0, "mL/s", "A kitchen tap full on is about 140 mL/s; a trickle 10-20 mL/s"),
                             Prop("on_at", "Turns on at", 0.5, 0.0, 20.0, 0.1, "s"),
                             Prop("off_at", "Turns off at", 0.0, 0.0, 30.0, 0.1, "s", "0: it stays on"),
                             Prop("nozzle", "Nozzle", "aerator", kind="choice", choices=list(NOZZLES), help="aerator 22 mm (a soft round stream); plain 12 mm (faster, thinner)"),
                             *_liquid_props()],
                      readouts=[Readout("flowed_ml", "Run so far", "mL", 0), Readout("flow_ml_s", "Flow", "mL/s", 0),
                                Readout("lands_x", "Stream lands at", "m", 3, "Where along the table its stream comes down (x)")],
                      tags=["tap", "faucet", "sink", "water", "stream", "running water", "fill", "spigot", "kitchen", "turn on the tap", "tap water", "faucet water", "water runs", "fills the sink", "overflow"],
                      description="A chrome wall tap whose water falls straight down from its outlet, at the flow you set, between the times you set. Its "
                                  "item position is the outlet's mouth: put it above a cup, a bucket or a waterwheel.",
                      source="A kitchen faucet flows at most 139 mL/s (2.2 gal/min) [EPA-WS]. The stream leaves at the flow over the nozzle's area and speeds up as it falls.",
                      anchor="the mouth of its outlet, where the water leaves", facts="100 mL/s from 0.5 s, aerator nozzle", module=MODULE))


# ---------------------------------------------------------------- a bottle with holes in its side
BOTTLE_W = 0.102     # a 2 L soda bottle's inside [PET]
BOTTLE_H = 0.23      # its straight body
BOTTLE_T = 0.002


def _bottle():
    def build_bottle(c, P):
        c.ca, c.sa, c.a = 1.0, 0.0, 0.0     # (it stands upright)
        w, H, t = BOTTLE_W, BOTTLE_H, BOTTLE_T
        stand = P["stand_cm"] / 100
        pet = c.mat(base="PET", overrides={})
        wood = c.mat(base="varnished hardwood", overrides={})
        if stand > 0:
            c.slab("stand", 0.14, stand, 0.14, 0.0, stand / 2, kind="static", material=wood, look="wood", words="a wooden block the bottle stands on")
        floor = c.slab("floor", w + 2 * t, t, w + 2 * t, 0.0, stand + t / 2, kind="static", material=pet, look="glass", words="the bottle's bottom")
        c.slab("wall-left", t, H, w + 2 * t, -w / 2 - t / 2, stand + t + H / 2, kind="static", material=pet, look="glass", words="the bottle's side")
        c.slab("wall-right", t, H, w + 2 * t, w / 2 + t / 2, stand + t + H / 2, kind="static", material=pet, look="glass", words="the bottle's side")
        top = stand + t + H
        c.poly("shoulder-left", _r5([(-w / 2 - t, top), (-w / 2, top), (-0.0105, top + 0.06), (-0.0125, top + 0.06)]), w + 2 * t, kind="static",
               material=pet, look="glass", words="the bottle's shoulder")
        c.poly("shoulder-right", _r5([(w / 2, top), (w / 2 + t, top), (0.0125, top + 0.06), (0.0105, top + 0.06)]), w + 2 * t, kind="static",
               material=pet, look="glass", words="the bottle's shoulder")
        if P["cap"]:
            c.slab("cap", 0.03, 0.014, 0.03, 0.0, top + 0.067, kind="static", material=c.mat(base="ABS plastic", overrides={}), look="plastic",
                   words="the bottle's cap", color="#d23a2c")
        side = 1.0 if P["facing"] == "right" else -1.0
        holes = []
        dropped = 0
        for k in range(int(P["holes"])):
            hy = P["lowest_cm"] / 100 + k * P["spacing_cm"] / 100
            if hy > H - 0.005:
                dropped = int(P["holes"]) - k     # (above its 23 cm body: the run says how many it could not have)
                break
            holes.append({"x": round(side * w / 2, 5), "y": round(t / 2 + hy, 5), "angle": 0.0 if side > 0 else round(math.pi, 6),
                          "d": round(P["hole_mm"] / 1000, 5)})
        fill = min(P["fill_cm"] / 100, H - 0.002)
        D = math.pi / 4 * w
        layers = [{"liquid": liquid_of(P), "dye": list(DYES[P["dye"]]), "volume": round(fill * w * D, 9)}] if fill > 0 else []
        c.process("flow-vessel", "vessel", solid=floor, inside=_box(-w / 2, t / 2, w / 2, t / 2 + H), depth=round(D, 6), wall=t, lip=0.02,
                  layers=layers, holes=holes, cap=bool(P["cap"]), full=bool(P["kept_full"]), open=P["open_at"], ground=round(c.oy, 5),
                  **({"dropped": dropped} if dropped else {}))
        P["hole_heights_cm"] = ", ".join(_num_text(round((h["y"] - t / 2) * 100, 2)) for h in holes)

    register(ItemType("leaky-bottle", "Bottle with holes", CATEGORY, build_bottle, dynamic=False, material="PET", materials=["PET"],
                      props=[Prop("holes", "Holes", 3, 1, 4, 1, "", "Holes in a line up its side", kind="int"),
                             Prop("lowest_cm", "Lowest hole", 3.0, 1.0, 20.0, 0.5, "cm", "Height of the lowest hole over the bottle's inside bottom"),
                             Prop("spacing_cm", "Between holes", 5.0, 1.0, 10.0, 0.5, "cm"),
                             Prop("hole_mm", "Hole size", 4.0, 1.5, 8.0, 0.5, "mm", "A nail hole is 2-4 mm"),
                             Prop("facing", "Holes face", "right", kind="choice", choices=["right", "left"]),
                             Prop("fill_cm", "Water depth", 20.0, 0.0, 22.5, 0.5, "cm", "How deep the liquid stands at the start"),
                             Prop("kept_full", "Kept full", False, kind="bool", help="A hose keeps it topped up: the jets stay as strong (the classic pressure demo)"),
                             Prop("cap", "Cap on", False, kind="bool", help="With the cap on, no air gets in, so nothing comes out"),
                             Prop("open_at", "Holes open at", 0.5, 0.0, 20.0, 0.1, "s", "When the tape over the holes comes off"),
                             Prop("stand_cm", "Stands on a block", 15.0, 0.0, 40.0, 1.0, "cm", "How high the block it stands on is (0: on the table)"),
                             *_liquid_props()],
                      readouts=[Readout("left_ml", "Left in it", "mL", 0), Readout("level_mm", "Water depth", "mm", 1),
                                Readout("flow_ml_s", "Flowing out", "mL/s", 1), Readout("poured_ml", "Run out", "mL", 0),
                                Readout("jet1_ms", "Jet speed, hole 1 (lowest)", "m/s", 2), Readout("jet2_ms", "Jet speed, hole 2", "m/s", 2),
                                Readout("jet3_ms", "Jet speed, hole 3", "m/s", 2), Readout("jet4_ms", "Jet speed, hole 4", "m/s", 2),
                                Readout("reach1_m", "Reach, hole 1", "m", 3, "How far out from the hole its jet lands, at the level the bottle stands on"),
                                Readout("reach2_m", "Reach, hole 2", "m", 3), Readout("reach3_m", "Reach, hole 3", "m", 3), Readout("reach4_m", "Reach, hole 4", "m", 3)],
                      tags=["bottle", "holes", "leaky bottle", "pressure", "water pressure", "depth", "jets", "squirt", "spurt", "Torricelli", "soda bottle"],
                      description="A 2 L soda bottle of water with holes up one side, standing on a block. When the tape comes off, water spurts from every hole "
                                  "below the surface; the lower the hole, the deeper it is and the harder the water is pushed out, so the lowest jet is fastest "
                                  "and lands farthest. As the level falls the jets weaken (unless it is kept full).",
                      source="Jet speed C_v·√(2gΔh), flow C_d·a·√(2gΔh) with C_d 0.61, C_v 0.97 for a sharp-edged hole [WHITE]; thick liquids add Sampson's "
                             "viscous drop (1891). A 2 L bottle is 10.2 cm inside [PET].",
                      anchor="the middle of the bottom of the block it stands on (on the table)", facts="2 L bottle, 3 holes 4 mm at 3, 8, 13 cm, water 20 cm",
                      module=MODULE))


# ---------------------------------------------------------------- a hose (a siphon)
CONTAINERS = ["water-tank", "graduated-cylinder", "beaker", "measuring-jug", "density-column", "pitcher", "leaky-bottle", "cup", "plastic-cup",
              "glass-jar", "coffee-mug", "bucket", "box", "bowl"]


def _hose():
    def build_hose(c, P):
        tube = c.mat(base="PET", overrides={})
        c.slab("end", 0.03, 0.012, 0.012, 0.0, 0.0, kind="static", material=tube, look="flow tubing", words="the hose's free end", ghost=True)
        src = c.link("from")
        if src is None:
            return
        dst = c.link("to")
        c.process("flow-hose", "flow", **{"from": src}, to=dst, out={"x": round(c.ox, 5), "y": round(c.oy, 5)}, d=round(P["diameter_mm"] / 1000, 5),
                  length=P["length_m"] if P["length_m"] > 0 else None, inlet=round(P["inlet_cm"] / 100, 5), open=P["open_at"])

    register(ItemType("hose", "Hose (siphon)", CATEGORY, build_hose, dynamic=False, material="PET", materials=["PET"],
                      props=[Prop("diameter_mm", "Inside width", 10.0, 3.0, 25.0, 0.5, "mm", "Aquarium tubing is 4-6 mm; a garden hose 13-19 mm"),
                             Prop("length_m", "Length", 0.0, 0.0, 5.0, 0.05, "m", "0: as long as the path it is laid along"),
                             Prop("inlet_cm", "Inlet height", 1.5, 0.5, 30.0, 0.5, "cm", "How high its end sits over the source container's bottom"),
                             Prop("open_at", "Starts at", 0.5, 0.0, 20.0, 0.1, "s", "When the siphon is started (its clip opened)")],
                      links=[Link("from", "From", types=CONTAINERS, help="The container it draws from (its end sits inside, near the bottom)"),
                             Link("to", "To", types=CONTAINERS, help="The container its other end goes into (none: water leaves its free end, at this item's position)")],
                      readouts=[Readout("moved_ml", "Moved", "mL", 0), Readout("flow_ml_s", "Flow", "mL/s", 1),
                                Readout("lands_x", "Stream lands at", "m", 3, "Where water from its free end comes down (x)")],
                      tags=["hose", "siphon", "tube", "pipe", "drain", "transfer", "aquarium", "garden hose"],
                      description="A filled hose from one container over its rim to another (a siphon): liquid flows while the source's surface stands above "
                                  "the other end (above the other container's surface, or its free end), faster the bigger the height difference and the "
                                  "wider the hose, and stops when the two surfaces are level. Link `from` (and `to`); without `to` it pours out of its free "
                                  "end at the item's position.",
                      source="Bernoulli with the hose's losses: g·Δh = ½v²(1 + 0.5 + f·L/d), f = 64/Re (laminar) or 0.3164·Re^−¼ (Blasius) [WHITE].",
                      anchor="its free end (where the water comes out when it goes into no container)", facts="10 mm hose, starts at 0.5 s",
                      module=MODULE))


# ---------------------------------------------------------------- a waterwheel
def _wheel():
    def build_wheel(c, P):
        R = P["diameter"] / 2
        r = 0.02
        n = int(P["paddles"])
        D = P["paddle_depth"]
        plastic = c.mat(base="ABS plastic", overrides={})
        extra = {"damping": P["axle_friction"]} if P["axle_friction"] > 0 else {}
        # (the type is a fixed machine, so the catalog-wide start speed and spin are not its props; its hub and paddles turn, unless it is fixed)
        kind = "static" if c.item.get("fixed") else "dynamic"
        hub = c.ball("hub", r, 0.0, 0.0, material=plastic, kind=kind, look="plastic", words="the waterwheel's hub", inertia=0.5, shape="cylinder",
                     length=round(D, 5), pivot={"x": 0.0, "y": 0.0}, **extra)
        L = R - r + 0.002
        for k in range(n):
            a = 2 * math.pi * k / n
            mid = r - 0.002 + L / 2
            _child(c, f"paddle-{k + 1}", hub, _slab(L, 0.003, D), (mid * cos(a), mid * sin(a)), plastic, "flow paddle", "a waterwheel paddle", angle=a,
                   kind=kind)
        c.slab("stand", 0.012, 0.012, 0.012, 0.0, 0.0, kind="static", material=c.mat(base="steel", overrides={}), look="steel", words="the axle's bracket",
               ghost=True)
        c.process("flow-wheel", "wheel", solid=hub)

    register(ItemType("waterwheel", "Waterwheel", CATEGORY, build_wheel, dynamic=False, material="ABS plastic", materials=["ABS plastic"],
                      props=[Prop("diameter", "Diameter", 0.24, 0.1, 0.6, 0.01, "m"),
                             Prop("paddles", "Paddles", 8, 4, 16, 1, "", kind="int"),
                             Prop("paddle_depth", "Paddle width", 0.06, 0.02, 0.2, 0.005, "m", "Front to back"),
                             Prop("axle_friction", "Axle friction", 0.0005, 0.0, 0.05, 0.0005, "N·m·s", "How hard its axle drags (a load it lifts)")],
                      readouts=[Readout("rpm", "Turning", "rpm", 0), Readout("turns", "Turns", "", 1)],
                      tags=["waterwheel", "water wheel", "mill", "turbine", "paddle wheel", "energy", "work", "flow"],
                      description="A plastic waterwheel on a fixed axle at its item position (a bracket holds it). A stream falling on its paddles pushes them "
                                  "round: put a tap, a pitcher's spout or a hose's end above one side of it. A faster, bigger stream turns it faster.",
                      source="A jet's push on a paddle is the momentum it brings, ρ·Q·(v − u) for a paddle moving at u (the particles' own momentum, given back).",
                      anchor="its axle (it turns about it)", facts="24 cm, 8 paddles 6 cm wide", module=MODULE))


# ---------------------------------------------------------------- catalog containers catch liquid (when the scene pours)
# type -> (floor part, left wall parts, right wall parts, round)
BASIN_PARTS = {
    "cup": ("floor", ["left"], ["right"], True),
    "plastic-cup": ("floor", ["left"], ["right"], True),
    "glass-jar": ("floor", ["left"], ["right"], True),
    "coffee-mug": ("body", ["wall-left"], ["wall-right"], True),
    "bucket": ("floor", ["left"], ["right"], True),
    "box": ("floor", ["left"], ["right"], False),
    "bowl": ("base", ["wall-left"], ["wall-right"], True),
}
SOURCES = ("pitcher", "tap", "leaky-bottle", "hose")


def _basins(sb, scene):
    items = [i for i in scene.get("items", []) if isinstance(i, dict)]
    if not any(i.get("type") in SOURCES for i in items):
        return
    have = {s["id"]: s for s in sb.solids}
    for it in items:
        spec = BASIN_PARTS.get(it.get("type"))
        if spec is None:
            continue
        iid = it["id"]
        floor, left, right, rnd = spec
        fid = f"{iid}/{floor}"
        if fid not in have:
            continue
        ls = [f"{iid}/{p}" for p in left if f"{iid}/{p}" in have]
        rs = [f"{iid}/{p}" for p in right if f"{iid}/{p}" in have]
        if not ls or not rs:
            continue
        depth = have[fid]["body"].get("depth", 0.1)
        sb.processes.append({"kind": "flow-basin", "id": f"{iid}/basin", "item": iid, "floor": fid, "left": ls, "right": rs, "round": rnd,
                             "depth": round(depth, 5)})


# ---------------------------------------------------------------- goals (web/sim/modules/flow.js reports the same, number for number)
HOLD_S = 0.5     # s a wheel must keep a speed up for it to count (a one-frame spike as it jams is no turning)


def _goals():
    def last(ctx, iid, key):
        v = ctx.state(iid, key)
        return v[-1] if v else None

    def first_key(ctx, iid, keys):
        for k in keys:
            if ctx.state(iid, k) is not None:
                return k
        return None

    def when_text(by):
        return "" if by is None else f" by {_num_text(by)} s"

    def fills(ctx, g):
        if not ctx.known(g.get("container")):
            return None
        want = ctx.num(g.get("at_least_ml"))
        want = 100.0 if want is None else want
        by = ctx.num(g.get("before_s"))
        key = first_key(ctx, g["container"], ("liquid_ml", "volume_ml", "left_ml"))
        t = None if key is None else ctx.first_time(g["container"], key, lambda v: v >= want - 1e-9)
        v = None if key is None else last(ctx, g["container"], key)
        return {"label": g.get("label") or f"{ctx.name(g['container'])} fills to at least {_num_text(want)} mL{when_text(by)}",
                "ok": t is not None and (by is None or t <= by), "kind": "fills", "container": g["container"],
                "ml": None if v is None else round(v, 1), "t": None if t is None else round(t, 3)}

    def empties(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        by = ctx.num(g.get("before_s"))
        v = ctx.state(g["item"], "left_ml")
        t = None
        if v:
            lim = max(1.0, 0.01 * v[0])
            t = ctx.first_time(g["item"], "left_ml", lambda x: x <= lim)
        return {"label": g.get("label") or f"{ctx.name(g['item'])} empties{when_text(by)}", "ok": t is not None and (by is None or t <= by),
                "kind": "empties", "item": g["item"], "t": None if t is None else round(t, 3)}

    def half_time(ctx, iid):
        v = ctx.state(iid, "left_ml")
        if not v or not v[0] > 0:
            return None
        half = 0.5 * v[0]
        return ctx.first_time(iid, "left_ml", lambda x: x <= half)

    def poured(ctx, iid):
        k = first_key(ctx, iid, ("poured_ml", "flowed_ml", "moved_ml"))
        return None if k is None else last(ctx, iid, k)

    def pours_faster(ctx, g):
        a, b = g.get("a"), g.get("b")
        if not ctx.known(a) or not ctx.known(b) or a == b:
            return None
        ta, tb = half_time(ctx, a), half_time(ctx, b)
        pa, pb = poured(ctx, a), poured(ctx, b)
        if ta is not None or tb is not None:
            ok = ta is not None and (tb is None or ta < tb)
        else:
            ok = pa is not None and pb is not None and pa > pb + 1e-9
        return {"label": g.get("label") or f"{ctx.name(a)} pours faster than {ctx.name(b)}", "ok": ok, "kind": "pours_faster", "a": a, "b": b,
                "a_ml": None if pa is None else round(pa, 1), "b_ml": None if pb is None else round(pb, 1)}

    def clearly(a, b):
        """a beats b by a clear difference: 1 cm (or 1 rpm, 1 mL…) and 5 % of b, as the granular module's comparisons (a jet's landing spot
        wanders a few millimetres with the stream's break-up; a wheel's speed flickers as each paddle takes the stream)."""
        return a is not None and a > (0.0 if b is None else b) + max(0.01, 0.05 * (0.0 if b is None else abs(b)))

    def reach_of(ctx, iid, hole):
        v = [x for x in (ctx.state(iid, f"reach{hole}_m") or []) if x is not None]
        return max(v) if v else None

    def jet_farthest(ctx, g):
        iid = g.get("item")
        if not ctx.known(iid):
            return None
        hole = ctx.num(g.get("hole"))
        hole = 1 if hole is None else int(hole)
        reach = {}
        for k in range(1, 5):
            r = reach_of(ctx, iid, k)
            if r is not None:
                reach[k] = r
        mine = reach.get(hole)
        ok = mine is not None and mine > 0 and all(clearly(mine, r) for k, r in reach.items() if k != hole)
        return {"label": g.get("label") or f"the jet from hole {hole} of {ctx.name(iid)} lands farthest", "ok": ok, "kind": "jet_farthest", "item": iid,
                "hole": hole, "reach_m": None if mine is None else round(mine, 3)}

    def reaches_farther(ctx, g):
        a, b = g.get("a"), g.get("b")
        if not ctx.known(a) or not ctx.known(b) or a == b:
            return None
        hole = ctx.num(g.get("hole"))
        hole = 1 if hole is None else int(hole)
        ra, rb = reach_of(ctx, a, hole), reach_of(ctx, b, hole)
        return {"label": g.get("label") or f"the jet from {ctx.name(a)} lands farther out than the one from {ctx.name(b)}",
                "ok": ra is not None and ra > 0 and clearly(ra, rb), "kind": "reaches_farther", "a": a, "b": b, "hole": hole,
                "a_m": None if ra is None else round(ra, 3), "b_m": None if rb is None else round(rb, 3)}

    def held_rpm(ctx, iid):
        """The fastest a wheel KEEPS turning for half a second (the lowest rpm over its best 0.5 s): a one-frame spike, a knock as it jams,
        never counts. None when it has no rpm reading."""
        v = ctx.state(iid, "rpm")
        if not v:
            return None
        ts = ctx.times
        n = min(len(v), len(ts))
        best = 0.0
        i0 = 0
        for k in range(n):
            while ts[k] - ts[i0] > HOLD_S + 1e-9:
                i0 += 1
            if ts[k] - ts[0] < HOLD_S - 1e-9:
                continue
            m = None
            for i in range(i0, k + 1):
                x = 0.0 if v[i] is None else v[i]
                m = x if m is None or x < m else m
            if m is not None and m > best:
                best = m
        return best

    def held_from(ctx, iid, want):
        """When a wheel first turns at want rpm or more and keeps it up for half a second (the start of that half second), or None."""
        v = ctx.state(iid, "rpm")
        if not v:
            return None
        ts = ctx.times
        n = min(len(v), len(ts))
        start = None
        for k in range(n):
            x = 0.0 if v[k] is None else v[k]
            if x >= want:
                if start is None:
                    start = k
                if ts[k] - ts[start] >= HOLD_S - 1e-9:
                    return ts[start]
            else:
                start = None
        return None

    def turns(ctx, g):
        iid = g.get("item")
        if not ctx.known(iid):
            return None
        want = ctx.num(g.get("at_least_rpm"))
        want = 10.0 if want is None else want
        by = ctx.num(g.get("before_s"))
        t = held_from(ctx, iid, want)
        v = [x for x in (ctx.state(iid, "rpm") or []) if x is not None]
        h = held_rpm(ctx, iid)
        return {"label": g.get("label") or f"{ctx.name(iid)} turns at {_num_text(want)} rpm or more{when_text(by)}", "ok": t is not None and (by is None or t <= by),
                "kind": "turns", "item": iid, "max_rpm": None if not v else round(max(v), 1), "held_rpm": None if h is None else round(h, 1),
                "t": None if t is None else round(t, 3)}

    def turns_faster(ctx, g):
        a, b = g.get("a"), g.get("b")
        if not ctx.known(a) or not ctx.known(b) or a == b:
            return None
        ha, hb = held_rpm(ctx, a), held_rpm(ctx, b)
        return {"label": g.get("label") or f"{ctx.name(a)} turns faster than {ctx.name(b)}", "ok": ha is not None and ha > 0 and clearly_rpm(ha, hb),
                "kind": "turns_faster", "a": a, "b": b, "a_rpm": None if ha is None else round(ha, 1), "b_rpm": None if hb is None else round(hb, 1)}

    def clearly_rpm(a, b):
        """A wheel turns clearly faster: 2 rpm and 10 % more, held for half a second each."""
        b0 = 0.0 if b is None else b
        return a > b0 + max(2.0, 0.1 * b0)

    def gained(ctx, cid):
        """A container's reading of what it holds and the volume it held at the start: (key, list, start) or None."""
        key = first_key(ctx, cid, ("liquid_ml", "volume_ml", "left_ml"))
        if key is None:
            return None
        v = ctx.state(cid, key)
        v0 = next((x for x in v if x is not None), 0.0)
        return key, v, v0

    def fills_faster(ctx, g):
        a, b = g.get("a"), g.get("b")
        if not ctx.known(a) or not ctx.known(b) or a == b:
            return None
        A, B = gained(ctx, a), gained(ctx, b)
        want = ctx.num(g.get("ml"))
        ends = [max([x for x in X[1] if x is not None] or [0.0]) - X[2] for X in (A, B) if X is not None]
        if want is None:
            want = 0.5 * min(ends) if len(ends) == 2 and min(ends) > 1.0 else 50.0
        ta = None if A is None else ctx.first_time(a, A[0], lambda v: v - A[2] >= want - 1e-9)
        tb = None if B is None else ctx.first_time(b, B[0], lambda v: v - B[2] >= want - 1e-9)
        ok = ta is not None and (tb is None or ta < tb - max(0.1, 0.05 * tb))
        return {"label": g.get("label") or f"{ctx.name(a)} fills faster than {ctx.name(b)}", "ok": ok, "kind": "fills_faster", "a": a, "b": b,
                "ml": round(want, 1), "a_s": None if ta is None else round(ta, 3), "b_s": None if tb is None else round(tb, 3)}

    def overflows(ctx, g):
        cid = g.get("container")
        if not ctx.known(cid):
            return None
        by = ctx.num(g.get("before_s"))
        key = first_key(ctx, cid, ("overflow_ml", "spilled_ml"))
        t = None if key is None else ctx.first_time(cid, key, lambda v: v > 0.5)
        v = None if key is None else last(ctx, cid, key)
        return {"label": g.get("label") or f"{ctx.name(cid)} overflows{when_text(by)}", "ok": t is not None and (by is None or t <= by),
                "kind": "overflows", "container": cid, "ml": None if v is None else round(v, 1), "t": None if t is None else round(t, 3)}

    def mixes_to(ctx, g):
        cid = g.get("container")
        if not ctx.known(cid):
            return None
        want = g.get("color") if isinstance(g.get("color"), str) else "green"
        r, gg, b = last(ctx, cid, "tint_r"), last(ctx, cid, "tint_g"), last(ctx, cid, "tint_b")
        got = None if r is None or gg is None or b is None else color_name(r, gg, b)
        return {"label": g.get("label") or f"the liquid in {ctx.name(cid)} ends {want}", "ok": got == want, "kind": "mixes_to", "container": cid, "color": got}

    def delivers(ctx, g):
        iid = g.get("item")
        if not ctx.known(iid):
            return None
        want = ctx.num(g.get("at_least_ml"))
        want = 100.0 if want is None else want
        v = poured(ctx, iid)
        return {"label": g.get("label") or f"{ctx.name(iid)} delivers at least {_num_text(want)} mL", "ok": v is not None and v >= want - 1e-9,
                "kind": "delivers", "item": iid, "ml": None if v is None else round(v, 1)}

    register_goal_kind("fills", fills)
    register_goal_kind("empties", empties)
    register_goal_kind("pours_faster", pours_faster)
    register_goal_kind("jet_farthest", jet_farthest)
    register_goal_kind("turns", turns)
    register_goal_kind("mixes_to", mixes_to)
    register_goal_kind("delivers", delivers)
    register_goal_kind("reaches_farther", reaches_farther)
    register_goal_kind("turns_faster", turns_faster)
    register_goal_kind("fills_faster", fills_faster)
    register_goal_kind("overflows", overflows)
