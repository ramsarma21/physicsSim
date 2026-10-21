"""The granular module: sand, gravel, pebbles, soil and flour. Piles that stand at their angle of repose, sandcastles (damp sand stands in
walls; dry sand slumps into a cone), a tray of sand or flour that balls dropped into make craters in, a funnel that pours (or clogs), an
hourglass that keeps time, and a stream table where running water carves a channel down a sand slope and builds a delta where it meets
standing water.

items.py imports this file (machines/mod_<name>.py) after the catalog files and calls register_all(globals()); web/sim/modules/granular.js is
its exact JavaScript port (the same documents, number for number). The engine side is tooling/src/sim/modules/granular.ts (the processes
"sand-region", "sand-vessel" and "sand-water") with the physics in tooling/src/sim/granular.ts (a 2.5-D continuum of columns: avalanches with
Coulomb friction and the μ(I) rheology, Culmann's cohesive limit for damp sand, Beverloo's discharge, falling parcels, bodies held and braked
by the sand with Terzaghi-Vesić bearing and Katsuragi-Durian drag, running water routed downhill moving grains by Wong & Parker's bed load).

Items: sand-pile (a heap or a castle of any grain), sand-tray (a box of sand or flour: craters, a long-jump pit), sand-funnel (a funnel of
grains on a ring stand: piles, pouring rate, clogging), hourglass (a sand timer), stream-table (erosion and deposition). The grains: fine
sand, sand, coarse sand, gravel, pebbles, soil, flour; dry, damp or soaked.

Sources (the engine file's header has them all; the catalog's numbers are its):
  [WENTWORTH22] Wentworth, J. Geol. 30, 377 (1922): sand 0.0625-2 mm (fine 0.125-0.25, medium 0.25-0.5, coarse 0.5-1), gravel/pebbles 4-64 mm.
  [CRC] quartz 2650 kg/m³. [FREEZE79] Freeze & Cherry, Groundwater (1979) Table 2.4: porosity sand 0.25-0.50, gravel 0.25-0.40.
  [ETB-REPOSE] Engineering ToolBox, Angle of Repose: sand dry 34°, wet 45°, water filled 15-30°; earth 30-45°; wheat flour 45°.
  [ETB-BULK] Engineering ToolBox, dry bulk densities: sand ≈ 1600 kg/m³, gravel 1500-1700, wheat flour 593, topsoil 1100-1400.
  [BEVERLOO61] Beverloo, Leniger & van de Velde, Chem. Eng. Sci. 15, 260 (1961): W = 0.58·ρ_b·√g·(D − 1.4d)^{5/2}.
  [ZURIGUEL05] Zuriguel et al., Phys. Rev. E 71, 051303 (2005): an outlet under about 5 grains jams.
  [UEHARA03] Uehara et al., Phys. Rev. Lett. 90, 194301 (2003): crater sizes of balls dropped into sand.
  [WP06] Wong & Parker, J. Hydraul. Eng. 132, 1159 (2006): bed load. [FISCHENICH01] grass-covered soil takes 15-170 Pa of running water.
  [EMRIVER] Classroom stream tables (Emriver Em2, LRRD 2012): 0.5-2 L/min of water on a 3-10 % sand slope; channels form in minutes.
  [HOURGLASS] A 1-minute sand timer: about 60-70 g of fine sand through a 3 mm neck (Beverloo: 1.1 g/s).
  The kitchen grains (2026-10-20; tooling/src/sim/granular.ts's header has them in full): granulated sugar 0.5 mm [SANTOS17], sucrose 1587 kg/m³
  [CRC], 800 kg/m³ poured [ETB-BULK], 35°; table salt 0.4 mm, 2165 kg/m³ [CRC], 1200 kg/m³ [SALT-SPEC], 32°; long-grain rice 6.6 × 2 × 1.6 mm
  (an equal-volume 2.8 mm), 1450 kg/m³ [USDA], 770 kg/m³ [ETB-BULK], 32° (the angles provisional within [ETB-REPOSE]'s 30-45°).
  Containers (2026-10-20): a jar, a cup, a beaker, a bucket, a mug, a bowl or a box that grains are poured or heaped into holds them (the build
  hook _holders names each in the scene near a sand region; the engine makes its inside the bed's floor and its walls a ring all round). A
  pitcher, jug or cup of the flow module with contents "grains" pours its grains when tipped (the build hook _pours: its "sand-pour" record
  and the landing region under its lip).
"""
from crmath import cos, sin  # noqa: F401  (the same bits as web/sim's port on any machine)

NEEDED = ("register", "ItemType", "Prop", "Readout", "MATERIALS", "add_look", "LOOK_FILL", "LOOK_SHADE", "D2R", "register_goal_kind",
          "TYPES", "CATEGORIES", "props_of", "register_build_hook")

MODULE = "granular"
CATEGORY = "Sand & soil"

# ---------------------------------------------------------------- the grains (tooling/src/sim/granular.ts GRAINS: the same numbers)
# name -> (median grain m, grain density kg/m³, porosity, repose deg dry, its tan, repose deg soaked, its tan, look)
GRAINS = {
    "sand": (0.0004, 2650.0, 0.40, 34.0, 0.674509, 25.0, 0.466308, "sand"),
    "fine sand": (0.00018, 2650.0, 0.42, 32.0, 0.624869, 22.0, 0.404026, "fine sand"),
    "coarse sand": (0.001, 2650.0, 0.38, 35.0, 0.700208, 28.0, 0.531709, "coarse sand"),
    "gravel": (0.006, 2650.0, 0.38, 38.0, 0.781286, 34.0, 0.674509, "gravel"),
    "pebbles": (0.02, 2650.0, 0.38, 40.0, 0.839100, 38.0, 0.781286, "pebbles"),
    "soil": (0.00005, 2600.0, 0.50, 35.0, 0.700208, 20.0, 0.363970, "soil"),
    "flour": (0.00005, 1450.0, 0.59, 45.0, 1.0, 45.0, 1.0, "flour"),
    # the kitchen grains (2026-10-20): granulated sugar, table salt, long-grain rice
    "sugar": (0.0005, 1587.0, 0.4959, 35.0, 0.700208, 25.0, 0.466308, "sugar"),
    "salt": (0.0004, 2165.0, 0.4457, 32.0, 0.624869, 25.0, 0.466308, "salt"),
    "rice": (0.0028, 1450.0, 0.469, 32.0, 0.624869, 28.0, 0.531709, "rice"),
}
GRAIN_NAMES = list(GRAINS)
WETNESS = ["dry", "damp", "soaked"]
RHO_WATER = 998.2
DAMP_WATER = 0.08
# render-only tints (coloured sand in a timer, a red heap and a blue heap); natural = the grain's own colour
TINTS = {"natural": None, "red": "#c8443a", "blue": "#3f7fd0", "green": "#4fa35a", "yellow": "#e8c13a", "purple": "#8a5cc0", "white": "#f2f0ea",
         "black": "#2c2a28", "pink": "#e889a8", "orange": "#e8823a"}
TINT_NAMES = list(TINTS)
PLANTS = {"none": None, "lower half": (0.5, 1.0), "upper half": (0.0, 0.5), "all": (0.0, 1.0)}
# Pa a grass cover's roots and stems add to what running water must exert to move the grains under it (grass-lined banks take 15-170 Pa
# [FISCHENICH01]: the lowest used)
PLANT_TAU = 15.0


def bulk(grain, wet):
    """kg/m³ of a packed bed of these grains (with its water when damp or soaked): tooling/src/sim/granular.ts bulkDensity."""
    d, rho, por = GRAINS[grain][0], GRAINS[grain][1], GRAINS[grain][2]
    water = RHO_WATER * min(DAMP_WATER, por) if wet == "damp" else (RHO_WATER * por if wet == "soaked" else 0.0)
    return rho * (1 - por) + water


def tan_low(grain, wet):
    """tan of the lowest slope the grains may end at (soaked if they are, else dry): how far a heap may spread."""
    return GRAINS[grain][6] if wet == "soaked" else GRAINS[grain][4]


def cbrt(a):
    """a^(1/3) by Newton's method from a fixed start, + − × ÷ only (the same bits in the JavaScript port), for a > 0."""
    if not a > 0:
        return 0.0
    x = 1.0
    while x * x * x > a:
        x = x / 2
    while x * x * x < a:
        x = x * 2
    for _ in range(60):
        x = (2 * x + a / (x * x)) / 3
    return x


def _r(v, n=6):
    return round(v, n)


def _upright(c):
    c.ca, c.sa, c.a = 1.0, 0.0, 0.0


def _ghost(c, part, w, h, depth, lx=0.0, ly=0.0, look="sand", words=None, **extra):
    """A display-only slab (collides with nothing): what the view draws the item's sand on, and what picks it."""
    return c.slab(part, w, h, depth, lx, ly, kind="static", material=c.mat(base="hollow plastic", overrides={}), look=look, words=words, ghost=True,
                  stand="self", **extra)


def _cell(reach, lo=0.003, hi=0.02):
    """A bed's column size for a region `reach` wide either side: about 36 columns across, 3 mm to 2 cm."""
    return _r(min(hi, max(lo, reach / 18)), 4)


def _region(c, part, x0, x1, z0, z1, base, top, cell, grain, wet, role, deposit, walls=None, exclude=None):
    fields = dict(x0=_r(x0), x1=_r(x1), z0=_r(z0), z1=_r(z1), base=_r(base), top=_r(top), cell=cell, grain=grain, wet=wet, role=role, deposit=deposit)
    if walls:
        fields["walls"] = walls
    if exclude:
        fields["exclude"] = exclude
    return c.process("sand-region", part, **fields)


# ---------------------------------------------------------------- looks
def _looks():
    add_look("sand", fill="#d9b97c", shade="#a88a52", roughness=0.95, metalness=0.0, clearcoat=0.0, grain=True)
    add_look("fine sand", fill="#e6d3a3", shade="#b9a473", roughness=0.95, metalness=0.0, clearcoat=0.0, grain=True)
    add_look("coarse sand", fill="#c8a26a", shade="#97774a", roughness=0.95, metalness=0.0, clearcoat=0.0, grain=True)
    add_look("gravel", fill="#9b948a", shade="#6f6961", roughness=0.9, metalness=0.0, clearcoat=0.0, grain=True)
    add_look("pebbles", fill="#8a8178", shade="#625b53", roughness=0.85, metalness=0.0, clearcoat=0.0, grain=True)
    add_look("soil", fill="#6e5136", shade="#4b3622", roughness=0.95, metalness=0.0, clearcoat=0.0, grain=True)
    add_look("flour", fill="#f3eee2", shade="#cfc8b6", roughness=0.98, metalness=0.0, clearcoat=0.0)
    add_look("sugar", fill="#f7f5ee", shade="#d6d1c3", roughness=0.55, metalness=0.0, clearcoat=0.3, grain=True)
    add_look("salt", fill="#f4f4f2", shade="#d2d2cf", roughness=0.6, metalness=0.0, clearcoat=0.2, grain=True)
    add_look("rice", fill="#f1ebdc", shade="#cfc6b0", roughness=0.7, metalness=0.0, clearcoat=0.1, grain=True)
    add_look("timer glass", fill="#e6f0f4", shade="#b9c8cf", roughness=0.05, metalness=0.0, clearcoat=1.0, transmission=0.92, ior=1.5, thickness=0.002)
    add_look("stream tray", fill="#4f8fd8", shade="#2f6bb0", roughness=0.4, metalness=0.0, clearcoat=0.2)


# grains that running water dissolves (2026-10-20): not offered where water runs over the bed (a stream table)
SOLUBLE = ("sugar", "salt")


def _grain_props(default="sand", wet="dry", water=False):
    return [Prop("grain", "Grains", default, kind="choice", choices=[g for g in GRAIN_NAMES if not (water and g in SOLUBLE)],
                 help="sand 0.4 mm; fine sand 0.18 mm; coarse sand 1 mm; gravel 6 mm; pebbles 2 cm; soil (silt loam); flour (a powder); "
                      + ("rice (long grains); not sugar or salt: running water dissolves them" if water else "sugar 0.5 mm; salt 0.4 mm; rice (long grains)")),
            Prop("wetness", "Wetness", wet, kind="choice", choices=WETNESS,
                 help="dry: flows and heaps at its angle of repose; damp: sticks (a sandcastle stands); soaked: slumps flat (its pores full of water)")]


def _tint():
    return Prop("sand_color", "Sand colour", "natural", kind="choice", choices=TINT_NAMES, help="Coloured sand (only how it looks; the catalog-wide colour paints the item)")


# ---------------------------------------------------------------- sand pile: a heap or a castle
def build_pile(c, P):
    _upright(c)
    grain, wet, shape = P["grain"], P["wetness"], P["shape"]
    x, y = c.ox, c.oy
    rho = bulk(grain, wet)
    t_dry, t_low = GRAINS[grain][4], tan_low(grain, wet)
    if shape == "castle":
        r, H = P["width"] / 2, P["height"]
        vol = 3.141592653589793 * r * r * H
        spread = cbrt(3 * vol / (3.141592653589793 * t_low))
        reach = max(r, spread) * 1.4 + 0.03
        deposit = {"shape": "castle", "x": _r(x), "z": 0.0, "radius": _r(r), "height": _r(H)}
        top = y + H * 1.3 + 0.05
        gw, gh = 2 * r, H
        P["sand_kg"] = _r(vol * rho, 4)
    else:
        vol = P["sand_kg"] / rho
        R = cbrt(3 * vol / (3.141592653589793 * t_dry))
        spread = cbrt(3 * vol / (3.141592653589793 * t_low))
        reach = spread * 1.4 + 0.03
        deposit = {"shape": "cone", "x": _r(x), "z": 0.0, "mass": _r(P["sand_kg"])}
        top = y + R * t_dry * 1.6 + 0.05
        gw, gh = 2 * R, max(0.002, R * t_dry)
    _ghost(c, "sand", gw, gh, gw, 0.0, gh / 2, look=GRAINS[grain][7], words=f"a {'sandcastle' if shape == 'castle' else 'heap'} of {wet} {grain}")
    _region(c, "sand", x - reach, x + reach, -reach, reach, y - 0.05, top, _cell(reach), grain, wet, "pile", deposit)


# ---------------------------------------------------------------- sand tray: a box of sand or flour
def build_tray(c, P):
    _upright(c)
    L, W, wall, depth = P["length"], P["width"], P["wall"], P["sand_depth"]
    t = 0.012
    x, y = c.ox, c.oy
    m = c.mat(base="varnished hardwood", overrides={})
    kw = dict(kind="static", material=m, look="wood")
    c.slab("floor", L + 2 * t, t, W, 0.0, t / 2, words="the sand tray's floor", **kw)
    c.slab("wall-left", t, wall, W, -L / 2 - t / 2, t + wall / 2, words="the sand tray's end wall", **kw)
    c.slab("wall-right", t, wall, W, L / 2 + t / 2, t + wall / 2, words="the sand tray's end wall", **kw)
    grain, wet = P["grain"], P["wetness"]
    fill = min(depth, wall)
    _ghost(c, "sand", L, max(0.002, fill), W - 2 * t, 0.0, t + max(0.002, fill) / 2, look=GRAINS[grain][7], words=f"the tray's {grain}")
    z = W / 2 - t
    walls = [{"x0": _r(x - L / 2 - t), "x1": _r(x + L / 2 + t), "z0": _r(z), "z1": _r(W / 2 + 0.02), "top": _r(y + t + wall)},
             {"x0": _r(x - L / 2 - t), "x1": _r(x + L / 2 + t), "z0": _r(-W / 2 - 0.02), "z1": _r(-z), "top": _r(y + t + wall)}]
    _region(c, "sand", x - L / 2, x + L / 2, -z, z, y - 0.02, y + t + wall + 0.02, _r(min(0.008, max(0.003, max(L, W) / 120)), 4), grain, wet, "tray",
            {"shape": "layer", "depth": _r(fill)}, walls=walls)


# ---------------------------------------------------------------- funnel of sand on a ring stand
def build_funnel(c, P):
    _upright(c)
    x, y = c.ox, c.oy
    grain, wet = P["grain"], P["wetness"]
    R = P["funnel_cm"] / 200
    r_out = P["outlet_mm"] / 2000
    if r_out > R * 0.8:
        r_out = R * 0.8
    spout = y + P["height"]
    tw = 1.732051          # tan 60°: a kitchen funnel's wall
    rim = spout + (R - r_out) * tw
    gid = _ghost(c, "funnel", 2 * R, rim - spout, 2 * R, 0.0, P["height"] + (rim - spout) / 2, look="plastic", words="a funnel")
    # (its ring stand's foot, beside the heap: what it stands on, for the editor and the AI's placing; the funnel's model draws the stand)
    fid = _ghost(c, "foot", 0.14, 0.012, 0.1, -(R + 0.06), 0.006, look="steel", words="the ring stand's foot")
    rho = bulk(grain, wet)
    vol = P["sand_kg"] / rho
    spread = cbrt(3 * vol / (3.141592653589793 * tan_low(grain, wet)))
    reach = spread * 1.4 + 0.04
    _region(c, "landing", x - reach, x + reach, -reach, reach, y - 0.05, spout - 0.004, _cell(reach), grain, wet, "landing", {"shape": "none"},
            exclude=[gid, fid])
    c.process("sand-vessel", "funnel", cx=_r(x), base=_r(spout), shape="cone", R=_r(R), rOut=_r(r_out), wall=60.0, top=_r(rim),
              cell=_r(max(0.0015, R / 12), 5), grain=grain, wet=wet, mass=_r(P["sand_kg"]), role="funnel",
              outlet={"diameter": _r(2 * r_out), "delay": _r(P["delay"])})


# ---------------------------------------------------------------- hourglass (sand timer)
def build_hourglass(c, P):
    _upright(c)
    x, y = c.ox, c.oy
    R = P["bulb_cm"] / 200
    neck = P["neck_mm"] / 1000
    plate = 0.012
    bulb_h = 2.2 * R
    y_neck = y + plate + bulb_h
    top_y = y_neck + bulb_h
    m = c.mat(base="varnished hardwood", overrides={})
    w = 2 * R + 0.03
    c.slab("base", w, plate, w, 0.0, plate / 2, kind="static", material=m, look="wood", words="the timer's wooden base")
    c.slab("cap", w, plate, w, 0.0, top_y - y + plate / 2, kind="static", material=m, look="wood", words="the timer's wooden top")
    _ghost(c, "glass", 2 * R, top_y - y - plate, 2 * R, 0.0, plate + (top_y - y - plate) / 2, look="timer glass", words="the timer's glass bulbs")
    grain = P["grain"]
    cell = _r(max(0.0012, R / 10), 5)
    c.process("sand-vessel", "top", cx=_r(x), base=_r(y_neck), shape="cone", R=_r(R), rOut=_r(neck / 2), wall=55.0, top=_r(top_y - 0.002),
              cell=cell, grain=grain, wet="dry", mass=_r(P["sand_kg"]), role="hourglass-top",
              outlet={"diameter": _r(neck), "delay": _r(P["delay"])})
    c.process("sand-vessel", "bottom", cx=_r(x), base=_r(y + plate), shape="bowl", R=_r(R), rOut=0.0, wall=0.0, top=_r(y_neck - 0.002),
              cell=cell, grain=grain, wet="dry", mass=0.0, role="hourglass-bottom", outlet=None)


# ---------------------------------------------------------------- stream table
def build_stream(c, P):
    _upright(c)
    x, y = c.ox, c.oy
    L, W, tilt = P["length"], P["width"], P["tilt_deg"]
    t = 0.006
    wall = 0.1
    a = tilt * D2R
    ca, sa = cos(a), sin(a)
    tn = sa / ca
    # the floor: its top's middle at the anchor, falling to the right at `tilt`; the end walls stand upright on it
    m = c.mat(base="polypropylene", overrides={})
    kw = dict(kind="static", material=m, look="stream tray")
    c.slab("floor", L + 2 * t, t, W, -sa * t / 2, -ca * t / 2, langle=-tilt, words="the stream table's tray", stand="self", **kw)
    xl, xr = x - L / 2 * ca, x + L / 2 * ca            # the inside's ends
    yl, yr = y + L / 2 * sa, y - L / 2 * sa            # the floor's top there
    c.slab("wall-high", t, wall + 0.02, W, -L / 2 * ca - t / 2, L / 2 * sa + wall / 2, words="the stream table's high end", stand="self", **kw)
    c.slab("wall-low", t, wall + 0.02, W, L / 2 * ca + t / 2, -L / 2 * sa + wall / 2, words="the stream table's low end", stand="self", **kw)
    grain, wet = P["grain"], P["wetness"]
    share = P["sand_share"]
    toe = xl + share * (xr - xl)
    depth = P["sand_depth"]
    _ghost(c, "sand", share * (xr - xl), depth, W - 2 * t, -L / 2 * ca + share * (xr - xl) / 2, L / 2 * sa - share * (xr - xl) * tn / 2 + depth / 2,
           look=GRAINS[grain][7], words=f"the stream table's {grain}")
    z = W / 2 - t
    top = yl + wall + 0.02
    walls = [{"x0": _r(xl - t), "x1": _r(xr + t), "z0": _r(z), "z1": _r(W / 2 + 0.02), "top": _r(top)},
             {"x0": _r(xl - t), "x1": _r(xr + t), "z0": _r(-W / 2 - 0.02), "z1": _r(-z), "top": _r(top)}]
    rid = _region(c, "sand", xl, xr, -z, z, yr - 0.02, top, 0.012, grain, wet, "stream",
                  {"shape": "slope", "from": _r(xl), "toe": _r(toe), "depth": _r(depth)}, walls=walls)
    span = PLANTS[P["plants"]]
    plants = None
    if span is not None:
        # (the slope's foot too, where the lower part runs: the sand's toe falls at its angle of repose, about 1.5 sand depths long)
        end = toe + 1.5 * depth
        plants = [{"x0": _r(xl + span[0] * (end - xl)), "x1": _r(xl + span[1] * (end - xl)), "tau": PLANT_TAU}]
    c.process("sand-water", "water", region=rid, sources=[{"x": _r(xl + 0.04), "z": 0.0, "rate": _r(P["flow_lpm"] / 60000, 9)}],
              drainX=_r(xr - 0.03), lake=_r(yr + P["lake_cm"] / 100), plants=plants)


# ---------------------------------------------------------------- the catalog
def _types():
    register(ItemType("sand-pile", "Sand pile", CATEGORY, build_pile, dynamic=False, module=MODULE,
                      props=[Prop("shape", "Shape", "heap", kind="choice", choices=["heap", "castle"],
                                  help="heap: a cone at the angle of repose; castle: a packed round tower (damp sand stands, dry sand slumps)"),
                             Prop("sand_kg", "Amount", 1.0, 0.01, 20.0, 0.01, "kg", "A heap's weight of grains (a castle's follows its size)"),
                             Prop("width", "Castle width", 0.08, 0.02, 0.5, 0.005, "m", "A castle's diameter"),
                             Prop("height", "Castle height", 0.12, 0.01, 0.6, 0.005, "m", "A castle's height"),
                             *_grain_props(), _tint()],
                      tags=["sand", "pile", "heap", "mound", "sandcastle", "castle", "gravel", "soil", "dirt", "flour", "angle of repose", "landslide",
                            "dune", "beach", "pile of sugar", "heap of sugar", "pile of rice", "heap of rice", "pile of salt", "heap of salt"],
                      description="A heap of sand, gravel, soil, flour, sugar, salt or rice on whatever it rests on, or a packed sandcastle. Dry grains stand at their "
                                  "angle of repose (sand 34°, gravel 38°, flour 45°, sugar 35°, salt and rice 32°) and slide down when piled steeper; damp sand sticks and stands in "
                                  "walls; soaked sand slumps. Balls and blocks sink into it and are slowed by it. A heap wider than the shelf or plank it is on spills off its edge.",
                      source="Grains [WENTWORTH22] [CRC] [FREEZE79]; angles of repose [ETB-REPOSE]; bulk densities [ETB-BULK]; damp cohesion about "
                             "1 kPa (capillary bridges: a free damp tower stands to about 23 cm, provisional).",
                      anchor="the middle of its base, on what it rests on", facts="1 kg of dry sand: a cone about 13 cm wide, 4.5 cm tall at 34°",
                      readouts=[Readout("height_mm", "Height", "mm", 0, "Its top over where it lies"),
                                Readout("width_mm", "Width", "mm", 0, "Its footprint, as a disc"),
                                Readout("angle_deg", "Slope", "°", 1, "Its sides' slope: atan(height ÷ footprint radius)"),
                                Readout("mass_g", "Mass", "g", 0, "The grains in its place (on what it stands on)"),
                                Readout("spilled_g", "Spilled", "g", 0, "Grains that ran off the edge of what it stands on (a heap wider than its shelf or plank)")]))
    register(ItemType("sand-tray", "Sand tray", CATEGORY, build_tray, dynamic=False, module=MODULE,
                      props=[Prop("length", "Length", 0.5, 0.15, 3.0, 0.01, "m"), Prop("width", "Front to back", 0.35, 0.1, 1.0, 0.01, "m"),
                             Prop("wall", "Wall height", 0.08, 0.02, 0.3, 0.005, "m"),
                             Prop("sand_depth", "Sand depth", 0.05, 0.005, 0.3, 0.005, "m", "How deep it is filled (up to its walls)"),
                             *_grain_props("sand"), _tint()],
                      tags=["sandbox", "sand pit", "crater", "impact", "meteor", "flour", "long jump", "tray", "box of sand", "moon craters"],
                      description="A wooden tray filled level with sand, flour or soil. Drop a ball into it: it makes a crater (bigger from higher, "
                                  "and for heavier balls) and is buried; roll something into it: it ploughs in and stops.",
                      source="Craters: Uehara et al. 2003 [UEHARA03] (checked in research/rw-validate-granular.ts); grains as the sand pile.",
                      anchor="the middle of its floor's underside, where it stands", facts="50 × 35 cm, 5 cm of sand: about 14 kg",
                      readouts=[Readout("crater_mm", "Crater", "mm", 0, "Rim to rim across the deepest crater"),
                                Readout("crater_depth_mm", "Crater depth", "mm", 0, "Below where the sand stood"),
                                Readout("sand_mm", "Sand depth", "mm", 0, "Its mean depth")]))
    register(ItemType("sand-funnel", "Funnel of sand", CATEGORY, build_funnel, dynamic=False, module=MODULE,
                      props=[Prop("sand_kg", "Grains in it", 0.3, 0.0, 5.0, 0.01, "kg"),
                             Prop("outlet_mm", "Spout", 10.0, 2.0, 60.0, 0.5, "mm", "The hole's width: grains jam in a hole under about 5 grains wide"),
                             Prop("funnel_cm", "Funnel width", 12.0, 5.0, 40.0, 0.5, "cm", "Across its top"),
                             Prop("height", "Spout height", 0.2, 0.03, 1.5, 0.01, "m", "Its spout over its base"),
                             Prop("delay", "Opens after", 0.0, 0.0, 20.0, 0.1, "s", "Seconds after the release that its spout opens"),
                             *_grain_props("sand"), _tint()],
                      tags=["funnel", "pour", "pouring", "sand", "pile", "heap", "angle of repose", "clog", "jam", "flow rate", "gravel", "flour", "pour sugar", "pour salt", "pour rice", "sugar pile", "rice pile", "salt pile"],
                      description="A funnel of grains on a ring stand. At the release its spout opens and the grains pour out at a steady rate "
                                  "(Beverloo: it does not slow as the funnel empties) and heap up below at their angle of repose. Too narrow a spout "
                                  "for the grains (gravel, or sticky flour or damp sand) and it clogs. Over a jar, glass, cup, bowl or box the grains stay inside it and heap up within its walls.",
                      source="Discharge [BEVERLOO61] (25 g/s of sand through 1 cm); jamming [ZURIGUEL05]; cohesive arching (Jenike 1964).",
                      anchor="under its spout, on what its stand's foot stands on (the foot is beside the heap)",
                      facts="1 cm spout: about 25 g of sand a second",
                      readouts=[Readout("left_g", "Left", "g", 0), Readout("poured_g", "Poured", "g", 0),
                                Readout("flow_gs", "Flow", "g/s", 1), Readout("clogged", "Clogged", "", 0, "1 while its grains jam", words={0: "no", 1: "yes"}),
                                Readout("heap_mm", "Heap height", "mm", 0, "The heap it has poured: its top over where it lies"),
                                Readout("heap_deg", "Heap slope", "°", 1, "The poured heap's sides: atan(height ÷ footprint radius); in a jar or glass it fills, "
                                        "the cone's slope from its top down to the wall"),
                                Readout("heap_g", "Heap", "g", 0, "The grains in the heap under it"),
                                Readout("outside_g", "Outside", "g", 0, "Grains that landed outside the jar, glass, cup or box it pours into")]))
    register(ItemType("hourglass", "Hourglass (sand timer)", CATEGORY, build_hourglass, dynamic=False, module=MODULE,
                      props=[Prop("sand_kg", "Sand", 0.066, 0.001, 2.0, 0.001, "kg", "66 g of fine sand through a 3 mm neck: one minute"),
                             Prop("neck_mm", "Neck", 3.0, 0.8, 12.0, 0.1, "mm", "Wider: it runs out sooner"),
                             Prop("bulb_cm", "Bulb width", 5.0, 2.0, 15.0, 0.5, "cm"),
                             Prop("grain", "Grains", "fine sand", kind="choice", choices=GRAIN_NAMES, help="Finer grains run a little faster through the same neck"),
                             Prop("delay", "Starts after", 0.0, 0.0, 20.0, 0.1, "s", "Seconds after the release that it starts running"), _tint()],
                      tags=["hourglass", "sand timer", "egg timer", "timer", "clock", "time", "minute", "measure time"],
                      description="A sand timer: grains run from the top bulb through the neck at a steady rate (whatever the height of sand above) "
                                  "and heap up in the bottom bulb. It reads how long it has run (lesson seconds, with the scene's time-lapse). A neck narrower than about 5 grains jams: nothing runs and its clock stops.",
                      source="Beverloo's discharge through the neck [BEVERLOO61]: 1.1 g/s of fine sand through 3 mm [HOURGLASS].",
                      anchor="the middle of its base", facts="66 g, 3 mm neck: 60 s",
                      readouts=[Readout("top_g", "Top", "g", 1), Readout("bottom_g", "Bottom", "g", 1), Readout("flow_gs", "Flow", "g/s", 2),
                                Readout("run_s", "Ran", "s", 1, "Lesson seconds since it started (frozen when it runs out)"),
                                Readout("empty", "Empty", "", 0, "1 once the top bulb has run out", words={0: "no", 1: "yes"}),
                                Readout("clogged", "Jammed", "", 0, "1 while its grains block the neck (too narrow for them: its clock stops)", words={0: "no", 1: "yes"})]))
    register(ItemType("stream-table", "Stream table", CATEGORY, build_stream, dynamic=False, module=MODULE,
                      props=[Prop("tilt_deg", "Slope", 6.0, 0.0, 25.0, 0.5, "°", "How much the tray is tipped (books under its high end)"),
                             Prop("flow_lpm", "Water flow", 1.0, 0.0, 6.0, 0.1, "L/min", "The hose's flow, from the release"),
                             Prop("sand_depth", "Sand depth", 0.05, 0.01, 0.12, 0.005, "m"),
                             Prop("sand_share", "Sand covers", 0.6, 0.2, 0.9, 0.05, "", "The share of the tray's length the sand fills, from the high end"),
                             Prop("lake_cm", "Pool depth", 2.0, 0.0, 6.0, 0.5, "cm", "Standing water at the low end (the outlet's lip)"),
                             Prop("plants", "Plants", "none", kind="choice", choices=list(PLANTS), help="Grass on part of the sand slope: its roots hold the sand"),
                             Prop("length", "Length", 0.9, 0.4, 2.5, 0.05, "m"), Prop("width", "Front to back", 0.4, 0.15, 1.0, 0.01, "m"),
                             *_grain_props("sand", "damp", water=True)],
                      tags=["stream table", "erosion", "deposition", "river", "delta", "weathering", "landform", "water", "sand", "canyon", "flood",
                            "runoff", "plants hold soil"],
                      description="A tipped tray of damp sand with a hose at its high end and a pool at its low end. The water carves a channel down "
                                  "the slope, carries the sand and drops it where it slows in the pool: a delta. Steeper, more water or finer grains: "
                                  "more erosion; gravel and plant roots resist it. Set the scene's time-lapse (e.g. 15) to see minutes in seconds.",
                      source="Running water [CHOW59] moving grains by Wong & Parker's bed load [WP06], Shields' threshold (Soulsby & Whitehouse "
                             "1997); classroom stream tables [EMRIVER]; grass [FISCHENICH01].",
                      anchor="the middle of its tray's floor", facts="1 L/min on 6°: a channel and a delta in about 5 minutes",
                      readouts=[Readout("eroded_g", "Eroded", "g", 0, "Sand the water has carried away from where it lay"),
                                Readout("delta_cm", "Delta", "cm", 1, "How far the dropped sand reaches past the sand's toe"),
                                Readout("channel_mm", "Channel", "mm", 0, "The deepest cut"), Readout("water_lpm", "Water", "L/min", 1)]))


# ---------------------------------------------------------------- goal kinds (web/sim/modules/granular.js: the same, number for number)
def _last(ctx, iid, key):
    v = ctx.state(iid, key)
    return v[-1] if v else None


def _first(ctx, iid, key):
    v = ctx.state(iid, key)
    return v[0] if v else None


def _fmt(v, n=1):
    t = f"{v:.{n}f}"
    return t.rstrip("0").rstrip(".") if "." in t else t


def _heap_keys(ctx, iid):
    """A heap's height and slope readings: a sand pile's, or the heap a funnel poured (heap_mm, heap_deg)."""
    return ("heap_mm", "heap_deg") if not ctx.state(iid, "height_mm") and ctx.state(iid, "heap_mm") else ("height_mm", "angle_deg")


def _heap_total(ctx, iid):
    """A heap's grains in all (g): what a funnel or a cup poured, or a laid heap's own (on its support or in its container, and what spilled)."""
    p = _last(ctx, iid, "poured_g")
    if p is not None:
        return p
    m = _last(ctx, iid, "mass_g")
    if m is None:
        return None
    sp = _last(ctx, iid, "spilled_g")
    return m + (0.0 if sp is None else sp)


IN_SHARE = 0.9   # the share of a heap's grains that must end inside the container a piles goal names (`in`)


def _goals():
    def piles(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        # (in: the container it must heap up inside: a label that says "piles up inside the jar" is checked there, never by the heap's height
        # alone, which a heap on the table beside an empty jar met (2026-10-21))
        cin = g.get("in")
        if cin is not None and not ctx.known(cin):
            return None
        lo, hi = ctx.num(g.get("min_deg")), ctx.num(g.get("max_deg"))
        kh, ka = _heap_keys(ctx, g["item"])
        h, a = _last(ctx, g["item"], kh), _last(ctx, g["item"], ka)
        ok = h is not None and h >= 5 and a is not None and (lo is None or a >= lo) and (hi is None or a <= hi)
        span = (f" at {_fmt(lo, 0)}°" if lo is not None and hi is None else "") + (f" between {_fmt(lo, 0)}° and {_fmt(hi, 0)}°" if lo is not None and hi is not None else "") + \
            (f" no steeper than {_fmt(hi, 0)}°" if hi is not None and lo is None else "")
        out = {"label": g.get("label") or f"{ctx.name(g['item'])} stands as a heap{f' inside {ctx.name(cin)}' if cin is not None else ''}{span}", "ok": ok,
               "kind": "piles", "item": g["item"], "deg": None if a is None else round(a, 1), "mm": None if h is None else round(h, 1)}
        if cin is not None:
            # (the grains inside it at the end: its grains_g, 0 when no bed reaches it; at least 90 % of the heap's own)
            inside = _last(ctx, cin, "grains_g")
            inside = 0.0 if inside is None else inside
            total = _heap_total(ctx, g["item"])
            out["ok"] = ok and total is not None and total > 0 and inside >= IN_SHARE * total
            out["in"] = cin
            out["in_g"] = round(inside, 1)
            out["of_g"] = None if total is None else round(total, 1)
        return out

    def stands(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        kh = _heap_keys(ctx, g["item"])[0]
        h0, h1 = _first(ctx, g["item"], kh), _last(ctx, g["item"], kh)
        ok = h0 is not None and h1 is not None and h0 > 0 and h1 >= 0.9 * h0
        return {"label": g.get("label") or f"{ctx.name(g['item'])} stays standing", "ok": ok, "kind": "stands", "item": g["item"],
                "share": None if not h0 or h1 is None else round(h1 / h0, 3)}

    def collapses(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        kh = _heap_keys(ctx, g["item"])[0]
        h0, h1 = _first(ctx, g["item"], kh), _last(ctx, g["item"], kh)
        ok = h0 is not None and h1 is not None and h0 > 0 and h1 < 0.7 * h0
        return {"label": g.get("label") or f"{ctx.name(g['item'])} collapses", "ok": ok, "kind": "collapses", "item": g["item"],
                "share": None if not h0 or h1 is None else round(h1 / h0, 3)}

    def steeper(ctx, g):
        if not (ctx.known(g.get("a")) and ctx.known(g.get("b"))):
            return None
        a, b = _last(ctx, g["a"], _heap_keys(ctx, g["a"])[1]), _last(ctx, g["b"], _heap_keys(ctx, g["b"])[1])
        ok = a is not None and b is not None and a >= b + 1
        return {"label": g.get("label") or f"{ctx.name(g['a'])} stands steeper than {ctx.name(g['b'])}", "ok": ok, "kind": "steeper", "a": g["a"],
                "b": g["b"], "deg": [None if a is None else round(a, 1), None if b is None else round(b, 1)]}

    def crater(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        least = ctx.num(g.get("min_mm"))
        least = 10.0 if least is None else least
        d = _last(ctx, g["item"], "crater_mm")
        return {"label": g.get("label") or f"a crater at least {_fmt(least, 0)} mm wide forms in {ctx.name(g['item'])}", "ok": d is not None and d >= least,
                "kind": "crater", "item": g["item"], "mm": None if d is None else round(d, 1)}

    def crater_bigger(ctx, g):
        if not (ctx.known(g.get("a")) and ctx.known(g.get("b"))):
            return None
        a, b = _last(ctx, g["a"], "crater_mm"), _last(ctx, g["b"], "crater_mm")
        # (clearly wider, as a ruler would tell: by 2 mm and 5 %; two equal drops never pass on a grid cell's difference)
        ok = a is not None and b is not None and a >= b + max(2.0, 0.05 * b)
        return {"label": g.get("label") or f"the crater in {ctx.name(g['a'])} is wider than in {ctx.name(g['b'])}", "ok": ok, "kind": "crater_bigger",
                "a": g["a"], "b": g["b"], "mm": [None if a is None else round(a, 1), None if b is None else round(b, 1)]}

    def _empty_at(ctx, iid):
        """When a funnel or an hourglass runs empty (s of the run), or None."""
        t = ctx.first_time(iid, "empty", lambda v: v >= 1)
        if t is not None:
            return t
        left = ctx.state(iid, "left_g")
        if left and left[0] > 0:
            return ctx.first_time(iid, "left_g", lambda v: v <= 0.005 * left[0])
        return None

    def empties(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        by, after = ctx.num(g.get("before_s")), ctx.num(g.get("after_s"))
        t = _empty_at(ctx, g["item"])
        ok = t is not None and (by is None or t <= by) and (after is None or t >= after)
        when = (f" by {_fmt(by, 2)} s" if by is not None else "") + (f" after {_fmt(after, 2)} s" if after is not None else "")
        return {"label": g.get("label") or f"{ctx.name(g['item'])} runs out of sand{when}", "ok": ok, "kind": "sand_runs_out", "item": g["item"],
                "t": None if t is None else round(t, 3)}

    def empties_first(ctx, g):
        if not (ctx.known(g.get("a")) and ctx.known(g.get("b"))):
            return None
        ta, tb = _empty_at(ctx, g["a"]), _empty_at(ctx, g["b"])
        # (clearly first: by 2 % of the other's time and at least 0.05 s of the run)
        ok = ta is not None and (tb is None or ta <= tb - max(0.05, 0.02 * tb))
        return {"label": g.get("label") or f"{ctx.name(g['a'])} runs out of sand before {ctx.name(g['b'])}", "ok": ok, "kind": "runs_out_first", "a": g["a"],
                "b": g["b"], "t": [None if ta is None else round(ta, 3), None if tb is None else round(tb, 3)]}

    def timer(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        want = ctx.num(g.get("seconds"))
        if want is None:
            return None
        # (tol_s: seconds; tol: seconds too, but under 1 it is a share of `seconds` (0.1 = 10 %), as a person says "within 10 %"; default 5 %)
        tol = ctx.num(g.get("tol_s"))
        if tol is None:
            tol = ctx.num(g.get("tol"))
            if tol is not None and 0 < tol < 1:
                tol = tol * want
        tol = 0.05 * want if tol is None else abs(tol)
        e = _last(ctx, g["item"], "empty")
        s = _last(ctx, g["item"], "run_s")
        j = _last(ctx, g["item"], "clogged")
        ok = e == 1 and s is not None and abs(s - want) <= tol + 1e-9
        return {"label": g.get("label") or f"{ctx.name(g['item'])} runs out at {_fmt(want, 1)} s (± {_fmt(tol, 1)} s)", "ok": ok, "kind": "timer",
                "item": g["item"], "s": None if s is None else round(s, 2), "want": round(want, 3), "tol": round(tol, 3), "empty": e == 1, "jammed": j == 1}

    def clogs(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        # (a funnel's spout or an hourglass's neck: both read `clogged` while their grains jam)
        t = ctx.first_time(g["item"], "clogged", lambda v: v >= 1)
        return {"label": g.get("label") or f"{ctx.name(g['item'])} clogs", "ok": t is not None, "kind": "clogs", "item": g["item"],
                "t": None if t is None else round(t, 3)}

    def erodes(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        least = ctx.num(g.get("min_g"))
        least = 20.0 if least is None else least
        v = _last(ctx, g["item"], "eroded_g")
        return {"label": g.get("label") or f"the water erodes at least {_fmt(least, 0)} g of sand in {ctx.name(g['item'])}", "ok": v is not None and v >= least,
                "kind": "erodes", "item": g["item"], "g": None if v is None else round(v, 1)}

    def erodes_more(ctx, g):
        if not (ctx.known(g.get("a")) and ctx.known(g.get("b"))):
            return None
        a, b = _last(ctx, g["a"], "eroded_g"), _last(ctx, g["b"], "eroded_g")
        # (clearly more, as weighing the washed-off sand would tell: by 10 g and 5 %; two equal tables never pass on noise)
        ok = a is not None and b is not None and a >= b + max(10.0, 0.05 * b)
        return {"label": g.get("label") or f"the water erodes more sand in {ctx.name(g['a'])} than in {ctx.name(g['b'])}", "ok": ok, "kind": "erodes_more",
                "a": g["a"], "b": g["b"], "g": [None if a is None else round(a, 1), None if b is None else round(b, 1)]}

    def delta(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        least = ctx.num(g.get("min_cm"))
        least = 1.0 if least is None else least
        v = _last(ctx, g["item"], "delta_cm")
        return {"label": g.get("label") or f"a delta reaches at least {_fmt(least, 1)} cm into {ctx.name(g['item'])}'s pool", "ok": v is not None and v >= least,
                "kind": "delta", "item": g["item"], "cm": None if v is None else round(v, 1)}

    for kind, fn in (("piles", piles), ("stands", stands), ("collapses", collapses), ("steeper", steeper), ("crater", crater),
                     ("crater_bigger", crater_bigger), ("sand_runs_out", empties), ("runs_out_first", empties_first), ("timer", timer), ("clogs", clogs),
                     ("erodes", erodes), ("erodes_more", erodes_more), ("delta", delta)):
        register_goal_kind(kind, fn)


# ---------------------------------------------------------------- containers hold grains; a pitcher of grains pours them (2026-10-20)
# type -> (its floor's part, its left walls' parts, its right walls' parts, round): what holds grains poured or heaped into it. The engine works out
# its inside from these solids' outlines at the start (tooling/src/sim/granular.ts holderOf): only the walls of its body (a jar's, not its shoulder
# and neck), whose front-to-back size is its depth.
HOLDERS = {
    "glass-jar": ("floor", ("left",), ("right",), True),
    "cup": ("floor", ("left",), ("right",), True),
    "plastic-cup": ("floor", ("left",), ("right",), True),
    "bucket": ("floor", ("left",), ("right",), True),
    "basket": ("floor", ("left",), ("right",), False),
    "box": ("floor", ("left",), ("right",), False),
    "beaker": ("floor", ("wall-left",), ("wall-right",), True),
    "graduated-cylinder": ("floor", ("wall-left",), ("wall-right",), True),
    "measuring-jug": ("floor", ("wall-left",), ("wall-right",), True),
    "coffee-mug": ("body", ("wall-left",), ("wall-right",), True),
    "bowl": ("base", ("wall-left",), ("wall-right",), True),
}
HOLDER_NEAR = 0.6      # m: a container whose floor's middle is this near a region (in x) is named for it (the engine checks exactly)


def _pours(sb, scene):
    """A pitcher, jug or cup of the flow module that holds grains (its flow-pour record says contents "grains": the flow module tips it and
    pours no liquid): the engine's record of its grains, which pour over its lip once tipped past their angle of repose, and the landing
    region under its lip that they fall onto (a funnel's, as its: it reads the heap they make, heap_mm, heap_deg, heap_g)."""
    del scene
    for rec in list(sb.processes):
        if rec.get("kind") != "flow-pour" or rec.get("contents") != "grains" or rec.get("grain") not in GRAINS:
            continue
        root = next((s for s in sb.solids if s["id"] == rec["solid"]), None)
        if root is None:
            continue
        iid, grain = rec["item"], rec["grain"]
        lx, ly = root["at"]["x"], root["at"]["y"]
        side = -1.0 if rec["tilt"] > 0 else 1.0      # (pouring to the right tips it clockwise: a negative tilt)
        ins = rec["inside"]
        h = ins[3]["y"] - ins[0]["y"]
        vol = rec.get("grains", 0.0)
        spread = cbrt(3 * vol / (3.141592653589793 * tan_low(grain, "dry")))
        reach = max(0.12, spread * 1.4 + 0.04)
        x = lx + side * 0.03
        # (its floor may be anything under its lip, where the grains leave (a funnel's: 4 mm under its spout); its own solids are left out. Under
        # its body, as it was, a cup held low, its body down beside a bowl's or a mug's rim or past the table's top, had the container's inside or
        # the table over the region's top: a wall, and the grains fell through it. Its base is where it was: 1 m under the cup's body.)
        under = ly - h - rec["wall"] - 0.004
        top = ly - 0.004
        own = [s["id"] for s in sb.solids if s["item"] == iid]
        sb.processes.append({"kind": "sand-region", "id": f"{iid}/landing", "item": iid, "x0": _r(x - reach), "x1": _r(x + reach), "z0": _r(-reach),
                             "z1": _r(reach), "base": _r(under - 1.0), "top": _r(top), "cell": _cell(reach), "grain": grain, "wet": "dry", "role": "landing",
                             "deposit": {"shape": "none"}, "exclude": own})
        pour = {"kind": "sand-pour", "id": f"{iid}/grains", "item": iid, "solid": rec["solid"], "inside": rec["inside"], "depth": rec["depth"],
                "wall": rec["wall"], "grain": grain, "wet": "dry", "volume": vol}
        if "grains_asked" in rec:
            pour["asked"] = rec["grains_asked"]
        sb.processes.append(pour)


def _holders(sb, scene):
    """Every container of the scene that grains could be poured or heaped into (HOLDERS, not one held to be let go), named in each heap's and
    each pour's landing region near it: the engine keeps those grains inside it (round or square walls all round, front and back too)."""
    regions = [p for p in sb.processes if p.get("kind") == "sand-region" and p.get("role") in ("pile", "landing")]
    if not regions:
        return
    have = {s["id"]: s for s in sb.solids}
    found = []
    for it in scene.get("items", []):
        if not isinstance(it, dict) or it.get("held") or it.get("type") not in HOLDERS:
            continue
        iid = it["id"]
        fl, left, right, rnd = HOLDERS[it["type"]]
        fid = f"{iid}/{fl}"
        ls = [f"{iid}/{p}" for p in left if f"{iid}/{p}" in have]
        rs = [f"{iid}/{p}" for p in right if f"{iid}/{p}" in have]
        if fid not in have or not ls or not rs:
            continue
        depth = have[ls[0]]["body"].get("depth")
        if not isinstance(depth, (int, float)) or not depth > 0:
            continue
        found.append((have[fid]["at"]["x"], {"item": iid, "floor": fid, "left": ls, "right": rs, "round": rnd, "depth": depth}))
    for r in regions:
        near = [h for x, h in found if r["x0"] - HOLDER_NEAR <= x <= r["x1"] + HOLDER_NEAR]
        if near:
            r["holders"] = near


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CATEGORY not in CATEGORIES:
        CATEGORIES.append(CATEGORY)
    _looks()
    _types()
    _goals()
    register_build_hook(_pours)
    register_build_hook(_holders)
