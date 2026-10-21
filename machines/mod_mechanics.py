"""The mechanics module (engine4): the catalog-wide basics every force-and-motion lesson needs, and the G3-8 machines the catalog lacked.

Catalog-wide props (COMMON_PROPS: every type lists them; an item that sets none builds exactly as before):
  color        a paint for the item (render only): its solids' `color` (a vehicle's body, not its tyres)
  glow         a soft glow round it, to point it out (render only: its solids' `glow`)
  start_speed  m/s it is already moving at the release, along start_dir (degrees from its heading, counter-clockwise); start_spin "roll" turns
               a round body or a vehicle's wheels as rolling along the floor (ω = −v/r), "none" leaves them still
  (the build hook `_common` below reads them after every item is built: a `start` process record per moving body)
  arrows       force arrows on it (render; the run records its forces): "none", "all" (every kind), "net", "all+net", or kinds joined by "," or
               "+" (gravity, support, push, friction, tension, spring, air, buoyancy, magnetic, applied, net); arrow_scale m of arrow per N (0: auto)
  show_energy  energy bars over it: its kinetic, potential and spring energy and what has turned to heat and sound (an `energy-bars` board
               linked to it draws the same, larger)
  (the build hook `_shows` adds a `forces` record for an item with arrows, or one a net_force goal is about, and an `energy` record for one
  with show_energy, one an energy-bars board shows, or one an energy goal is about)
Items (each says where its numbers come from; "provisional" where a value is a reasoned guess):
  floor         a long ground slab, 0.5 to 60 m (a 10 m race), of a chosen surface
  ramp          a plank resting on a stack of N wooden blocks (5 cm each): "1 block vs 3 blocks"; its foot feathered onto the floor
  clay-lump     a lump of modelling clay that sticks to the first moving thing it touches (velcro-like: a perfectly inelastic hit that holds)
  screw-jack    a screw lifting a load as its handle turns: an inclined plane wrapped round a rod (ideal MA 2π·handle / pitch, less its thread friction)
  (and the lab gear's sensors: a puller's and an edge pulley's `newtons`, the pull in their cord or string; a dynamics cart's speed and accel)
The engine side is tooling/src/sim/mechanics.ts (its records: role start, force, gear, spool, slider, sticky, arc, loop, balloon, meter), the port is
web/sim/modules/mechanics.js (line for line, number for number), the 3D models web/models/mod-mechanics.js.
"""
import math
import re

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "register_goal_kind", "register_build_hook", "register_common_prop", "MATERIALS",
          "props_of", "cos", "sin", "TYPES", "add_look", "measured", "CATEGORIES", "D2R", "LOOK_FILL", "LOOK_SHADE")

# ---------------------------------------------------------------- catalog-wide props
# Named paints (sRGB hex): the lessons' "red car, blue truck, green truck" (spec engine4/mechanics.md section 1). Render only.
PAINTS = {"red": "#d62828", "blue": "#1f5fbf", "green": "#2e9e44", "yellow": "#f2c230", "orange": "#f07f1a", "purple": "#7b3fb0",
          "pink": "#ec6fa5", "white": "#f4f4f0", "black": "#222222", "gray": "#8a8f96", "brown": "#7a4a26"}
COLOR_CHOICES = ["none"] + list(PAINTS)
# the parts of an item a paint leaves alone: wheels and tyres, a pulley's or a hanger's hardware, see-through and hidden helpers
UNPAINTED = ("front", "rear", "wheel", "tyre", "tire", "hub", "axle", "spring", "hanger", "cord", "rope", "pin", "lip")
START_MAX = 30.0      # m/s: the fastest start (a hard-kicked ball is 20-30 m/s)
# force arrows: the kinds the engine records (tooling/src/sim/mechanics.ts FORCE_KINDS, in its order; net is the sum of the others)
FORCE_KINDS = ("gravity", "support", "push", "friction", "tension", "spring", "air", "buoyancy", "magnetic", "applied", "net")
# (an open choice: any of these, or kinds joined by "+" (the AI's checks take any join of their words: ai/schemas.mjs, web/ai/solver.js))
ARROW_CHOICES = ["none", "all", "net", "all+net"] + list(FORCE_KINDS[:-1]) + ["gravity+support", "gravity+support+friction", "tension+net", "gravity+air+net",
                                                                              "gravity+buoyancy"]
ENERGY_GOALS = ("energy_kept", "energy_to_heat")

BLOCK = (0.10, 0.05, 0.05)   # m: the catalog's wooden block (10 x 5 x 5 cm, 4 x 2 x 2 in), lying flat: 5 cm of rise each
PLANK_T = 0.018              # m: a ramp's plank, 18 mm pine board (provisional: a common shelving board thickness)
OVERHANG = 0.03              # m: how far a ramp's plank reaches past the edge of the top block it rests on
LIP = (0.006, 0.015)         # m: a ramp's stop at its top end, 6 mm thick and 15 mm tall (a car waits against it)
CLAY_DENSITY = 1570          # kg/m³: Van Aken plasticine (Eckerson et al. 2008), as items.py's modelling clay
# a lump of clay pressed onto something, seen from the side: a flat underside and a dome (points for a lump 1 wide and 1 tall, counter-clockwise,
# its origin the middle of its box; the dome's points at 30°, 70°, 110°, 150° of a half-ellipse, written out so both languages use the same bits)
CLAY_SHAPE = ((-0.5, -0.5), (0.5, -0.5), (0.4330127, 0.0), (0.17101007, 0.43969262), (-0.17101007, 0.43969262), (-0.4330127, 0.0))


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    for cat in ("Machines & motion",):
        if cat not in CATEGORIES:
            CATEGORIES.append(cat)
    _materials()
    _catalog_wide()
    _floor()
    _ramp()
    _clay()
    _cart()
    _puller()
    _pusher()
    _edge_pulley()
    _falling()
    _coaster()
    _gears()
    _wheel_axle()
    _tackle()
    _lever()
    _balloon()
    _screw_jack()
    _energy_board()
    # (an egg's breaks / survives are the fracture module's goals, which read any item's `broken` reading; clay and velcro's sticks is the
    # magnetism module's: they touch to the end. These names are this module's own: no other module's goal is replaced.)
    for kind, fn in (("balanced", goal_balanced), ("loops", goal_loops), ("gear_speed", goal_gear_speed), ("rises", goal_rises),
                     ("recoils", goal_recoils), ("accelerates", goal_accelerates), ("pulls_with", goal_pulls_with), ("net_force", goal_net_force),
                     ("energy_kept", goal_energy_kept), ("energy_to_heat", goal_energy_to_heat)):
        register_goal_kind(kind, fn)


def register_catalog_wide(g):
    """Only what this module adds to every type: the catalog-wide props and the build hooks that read them (web/sim/modules/mechanics.js's
    register_catalog_wide, which a parity harness uses to give the core port what the whole server has)."""
    globals().update({k: g[k] for k in NEEDED})
    _catalog_wide()


def _catalog_wide():
    """The catalog-wide props (COMMON_PROPS) and the build hooks that read them: paint, glow and starts (`_common`), the cords of pullers and
    edge pulleys (`_links`), an egg's shell (`_fragile`)."""
    dynamic = lambda t: bool(t.dynamic)          # noqa: E731
    register_common_prop(Prop("color", "Colour", "none", kind="choice", choices=COLOR_CHOICES, open=True,
                              help="Paints it (only the look): a car's or truck's body, not its tyres"))
    register_common_prop(Prop("glow", "Glow", False, kind="bool", help="A soft glow round it, to point it out (only the look)"))
    register_common_prop(Prop("start_speed", "Start speed", 0.0, 0.0, START_MAX, 0.01, "m/s",
                              "Already moving this fast when the scene lets go (a kick, a launch, a car already rolling)"), dynamic)
    register_common_prop(Prop("start_dir", "Start direction", 0.0, -180.0, 180.0, 1.0, "°",
                              "Degrees from the way it faces (its +x turned by its angle), counter-clockwise: 0 forward, 180 back, 90 up"), dynamic)
    register_common_prop(Prop("start_spin", "Start spin", "roll", kind="choice", choices=["roll", "none"],
                              help="roll: a ball, a wheel or a car's wheels start turning as if rolling along the floor"), dynamic)
    register_common_prop(Prop("arrows", "Force arrows", "none", kind="choice", choices=ARROW_CHOICES, open=True,
                              help="Arrows for the forces on it as it moves (only the look; the run records them): all, net, all+net, or kinds "
                                   "joined by + (gravity+support+friction): gravity, support, push, friction, tension, spring, air, buoyancy, magnetic, applied"), dynamic)
    register_common_prop(Prop("arrow_scale", "Arrow length", 0.0, 0.0, 1.0, 0.005, "m/N",
                              "Metres of arrow per newton; 0: chosen so the scene's biggest force is a clear arrow (about its thing's size, 15-50 cm)"), dynamic)
    register_common_prop(Prop("show_energy", "Energy bars", False, kind="bool",
                              help="Bars over it of its kinetic, potential and spring energy, and what has turned to heat and sound, as it moves"), dynamic)
    register_common_prop(Prop("fragile", "Breaks", False, kind="bool",
                              help="It cracks if it lands hard: a peak force over about 35 N (an egg cracks dropped about 7 cm or more onto a table, not 80 cm onto foam)"),
                         lambda t: t.key == "egg")
    register_build_hook(_common)
    register_build_hook(_links)
    register_build_hook(_fragile)
    register_build_hook(_shows)


# ---------------------------------------------------------------- materials
def _mat(key, **kw):
    kw.setdefault("rolling", 0.0)
    kw.setdefault("side", 0.0)
    MATERIALS[key] = kw


def _materials():
    add_look("cart blue", fill="#2f6db5", shade="#1f4c80", roughness=0.35, metalness=0.0, clearcoat=0.5)
    add_look("office paper", fill="#f6f4ee", shade="#d8d4c8", roughness=0.85, metalness=0.0, clearcoat=0.0)
    add_look("feather", fill="#8a6a4a", shade="#5e4630", roughness=0.9, metalness=0.0, clearcoat=0.0)
    add_look("nylon canopy", fill="#e8543a", shade="#b53a24", roughness=0.6, metalness=0.0, clearcoat=0.1)
    add_look("velcro", fill="#2a2a2a", shade="#151515", roughness=1.0, metalness=0.0, clearcoat=0.0)
    add_look("felt", fill="#3d6e4e", shade="#2b4f38", roughness=0.95, metalness=0.0, clearcoat=0.0)
    add_look("sandpaper", fill="#b98a55", shade="#8c6438", roughness=1.0, metalness=0.0, clearcoat=0.0)
    add_look("grass", fill="#4f8a3a", shade="#3a6a2a", roughness=1.0, metalness=0.0, clearcoat=0.0)
    add_look("modelling clay", fill="#c0573e", shade="#8f3d2a", roughness=0.7, metalness=0.0, clearcoat=0.0)
    # (density kg/m³, bounce = restitution against a rigid surface, Coulomb friction, rolling resistance; Serway & Jewett table 5.1 and the
    # Engineering ToolBox friction tables for the dry-contact ranges; a toy car's rolling resistance on each is what its rubber tyres meet)
    _mat("felt", density=300, bounce=0.3, friction=0.6, rolling=0.03, look="felt",
         source="Wool felt about 300 kg/m³; wood on felt friction about 0.5-0.7 (felt pads); a tyre sinks into it: rolling resistance 0.03 provisional.")
    _mat("sandpaper", density=1500, bounce=0.5, friction=0.9, rolling=0.02, look="sandpaper",
         source="Abrasive paper on a backing, about 1500 kg/m³; wood on 80-120 grit sandpaper friction 0.6-1.0 (spec mechanics.md, provisional); "
                "a tyre rolls on its grit with about 0.02 (provisional).")
    _mat("grass", density=400, bounce=0.4, friction=0.35, rolling=0.07, look="grass",
         source="Mown turf: a ball rolls with a resistance of 0.05-0.1 on it (spec mechanics.md; golf-green stimp tests give 0.05-0.08); friction 0.35 "
                "(spec mechanics.md); bulk density provisional.")
    # a dynamics cart's parts and bumpers (the PASCO-style lab cart: spec mechanics.md [PASCO]); its bumpers meet each other as measured() says below
    _mat("cart plastic", density=1050, bounce=0.6, friction=0.35, rolling=0.003, look="cart blue",
         source="ABS plastic about 1050 kg/m³; a lab cart's low-friction wheels roll with 0.002-0.005 ([PASCO] carts; provisional 0.003); "
                "bounce of a plain plastic end provisional.")
    _mat("spring bumper", density=7850, bounce=0.9, friction=0.4, rolling=0.001, look="steel",
         source="A spring-steel leaf bumper: carts bounce off it with e about 0.9 (lab collision carts; provisional).")
    _mat("magnet bumper", density=7500, bounce=0.95, friction=0.3, rolling=0.001, look="steel",
         source="Repelling magnet bumpers: the carts never touch and part with e about 0.95 (lab magnetic collision carts; provisional).")
    _mat("velcro", density=400, bounce=0.0, friction=1.0, rolling=0.01, look="velcro",
         source="Hook-and-loop pads: they hold on contact (the module welds them: a perfectly inelastic collision).")
    _mat("office paper", density=800, bounce=0.3, friction=0.4, rolling=0.02, look="office paper",
         source="Office paper 80 g/m², about 0.1 mm thick: 800 kg/m³ (ISO 536 grammage; caliper about 0.1 mm); bounce provisional.")
    _mat("feather", density=50, bounce=0.1, friction=0.5, rolling=0.05, look="feather",
         source="A feather's vane is mostly air: its mass over its outline's volume (provisional).")
    _mat("nylon canopy", density=60, bounce=0.1, friction=0.5, rolling=0.05, look="nylon canopy",
         source="A light plastic or ripstop canopy: its mass spread over its shape's volume (provisional).")
    _mat("modelling clay", density=CLAY_DENSITY, bounce=0.054, friction=0.9, rolling=0.3, look="modelling clay",
         source="Van Aken plasticine 1570 kg/m³ (Eckerson et al. 2008); it barely bounces (as items.py's modeling clay) and grips.")
    measured("spring bumper", "spring bumper", friction=0.4, restitution=0.9, rollingResistance=0.001,
             source="Two lab carts' spring bumpers: e about 0.9 (provisional).")
    measured("magnet bumper", "magnet bumper", friction=0.3, restitution=0.95, rollingResistance=0.001,
             source="Two lab carts' repelling magnets: e about 0.95 (provisional).")
    for other in ("cart plastic", "spring bumper", "magnet bumper"):
        measured("velcro", other, friction=1.0, restitution=0.0, rollingResistance=0.01, source="Velcro meets anything dead (and then holds).")
    measured("velcro", "velcro", friction=1.0, restitution=0.0, rollingResistance=0.01, source="Velcro on velcro: dead, and it holds.")


# ---------------------------------------------------------------- the catalog-wide props, applied after every item is built
def _paint(v):
    """A colour prop's hex, or None (none, or not a colour)."""
    if not isinstance(v, str):
        return None
    k = v.strip().lower()
    if k in PAINTS:
        return PAINTS[k]
    if len(k) == 7 and k[0] == "#" and all(ch in "0123456789abcdef" for ch in k[1:]):
        return k
    return None


def _num(v, d):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else d


def _common(sb, scene):
    """The catalog-wide props of each item that sets any (COMMON_PROPS): its paint and glow on its solids, and the `start` records of its
    moving bodies. An item that sets none is left exactly as its builder made it."""
    for item in scene.get("items", []):
        if not isinstance(item, dict) or item.get("type") not in TYPES:
            continue
        props = item.get("props") or {}
        if not any(k in props for k in ("color", "glow", "start_speed")):
            continue
        iid = item["id"]
        mine = [s for s in sb.solids if s.get("item") == iid]
        if "color" in props:
            hexv = _paint(props["color"])
            common_color = not any(p.key == "color" for p in TYPES[item["type"]].props)   # (its colour is this module's prop, not one of its own)
            for s in mine:
                part = s["id"].split("/", 1)[1] if "/" in s["id"] else s["id"]
                if s.get("hidden_3d") or any(part.startswith(w) for w in UNPAINTED):
                    continue
                if s.get("color") == props["color"]:
                    # (a ball's builder copies its colour prop as it is: any other text is kept, as before. The 3D ball reads only a #rrggbb, so
                    # a named paint becomes the paint's hex and "none" leaves the ball its own colours, as on every other type: "blue" or "none"
                    # drew it grey)
                    if common_color and isinstance(props["color"], str):
                        k = props["color"].strip().lower()
                        if k == "none":
                            del s["color"]
                        elif k in PAINTS:
                            s["color"] = PAINTS[k]
                    continue
                if hexv is not None:
                    s["color"] = hexv
        if props.get("glow") is True:
            for s in mine:
                s["glow"] = True
        v = min(START_MAX, max(0.0, _num(props.get("start_speed"), 0.0)))
        if v > 0 and TYPES[item["type"]].dynamic and not item.get("fixed"):
            heading = _num(item.get("angle"), 0.0) * D2R
            a = heading + min(180.0, max(-180.0, _num(props.get("start_dir"), 0.0))) * D2R
            vx, vy = round(v * cos(a), 6), round(v * sin(a), 6)
            # a round body (a ball, a wheel) rolling along the floor turns at -v/r, the floor's way: its speed along its heading over its radius
            along = v * cos(a - heading)
            roll = props.get("start_spin", "roll") != "none"
            # (weld groups move as one: a start goes on each group's root, the solids without a parent; a vehicle's wheels are their own bodies)
            for s in mine:
                if s["kind"] != "dynamic" or ("parent" in s and "pivot" not in s):
                    continue
                rec = {"kind": "mechanics", "id": f"{s['id']}#start", "item": iid, "role": "start", "solid": s["id"], "vx": vx, "vy": vy}
                if roll and s["body"]["kind"] == "ball" and s["body"]["radius"] > 0:     # (a ball too small to have a radius in the doc does not spin)
                    rec["w"] = round(-along / s["body"]["radius"], 6)
                sb.processes.append(rec)


def _arrow_kinds(v):
    """The kinds an `arrows` prop asks for (FORCE_KINDS order): "all" every kind but net, "none" nothing, else the kinds named (joined by "," "+" or spaces)."""
    if not isinstance(v, str):
        return []
    words = set(re.split(r"[,+\s]+", v.strip().lower()))
    if "all" in words:
        words.update(FORCE_KINDS[:-1])
    return [k for k in FORCE_KINDS if k in words]


def _shows(sb, scene):
    """Force arrows' and energy bars' records: `forces` {item, solids, show, scale} for an item with arrows (or one a net_force goal is about),
    `energy` {item, solids} for one with show_energy, one an energy-bars board shows (its `watch`), or one an energy goal is about. Only those
    items get records: a scene that asks for none builds as before."""
    # (a scene's goals or items that are not a list, null or NaN in a hand-made scene, are none)
    items = [i for i in (scene.get("items") if isinstance(scene.get("items"), list) else []) if isinstance(i, dict) and isinstance(i.get("id"), str) and i.get("type") in TYPES]
    ids = {i["id"] for i in items}
    goals = [g for g in (scene.get("goals") if isinstance(scene.get("goals"), list) else []) if isinstance(g, dict)]
    netted = {g.get("item") for g in goals if g.get("kind") == "net_force"}
    energised = {g.get("item") for g in goals if g.get("kind") in ENERGY_GOALS}
    for b in items:
        if b["type"] == "energy-bars":
            w = props_of(b).get("watch")
            if isinstance(w, str) and w in ids and w != b["id"]:
                energised.add(w)
    for item in items:
        iid = item["id"]
        props = item.get("props") or {}
        mine = [x["id"] for x in sb.solids if x.get("item") == iid and x["kind"] == "dynamic"][:64]
        if not mine:
            continue
        show = _arrow_kinds(props.get("arrows"))
        if show or iid in netted:
            sb.processes.append({"kind": "mechanics", "id": f"{iid}#forces", "item": iid, "role": "forces", "solids": mine, "show": show,
                                 "scale": _r(min(1.0, max(0.0, _num(props.get("arrow_scale"), 0.0))), 5)})
        if props.get("show_energy") is True or iid in energised:
            sb.processes.append({"kind": "mechanics", "id": f"{iid}#energy", "item": iid, "role": "energy", "solids": mine,
                                 "bars": props.get("show_energy") is True})


# ---------------------------------------------------------------- floor
def _floor():
    def build_floor(c, P):
        L, t = P["length"], P["thickness"]
        # (a floor raised above the room's, a second lane over the first, stands on legs: only drawn)
        c.slab("floor", L, t, P["depth"], 0, -t / 2, kind="static", words=f"a long {P['material']} floor", **({"legs": True} if c.oy > 0.02 else {}))
    register(ItemType("floor", "Floor", "Scenery", build_floor, dynamic=False, material="varnished hardwood",
                      materials=_has("varnished hardwood", "concrete", "carpet", "rubber mat", "grass", "ice", "felt"), module="mechanics",
                      props=[Prop("length", "Length", 12.0, 0.5, 60.0, 0.1, "m", "Left to right: long enough for a 10 m race"),
                             Prop("thickness", "Thickness", 0.05, 0.02, 0.3, 0.005, "m"),
                             Prop("depth", "Width (front to back)", 1.2, 0.2, 4.0, 0.05, "m", "Only for the 3D look")],
                      tags=["ground", "floor", "gym", "hallway", "lane", "track", "road", "pavement", "long", "race", "playground", "court"],
                      anchor="the middle of its top surface",
                      description="A long floor (up to 60 m) of wood, concrete, carpet, rubber, grass or ice: room for races and long rolls.",
                      source="Surfaces as the catalog's materials (gym floor = varnished hardwood); grass: rolling resistance 0.05-0.1 (spec mechanics.md).",
                      facts="12 m · fixed", edit=[{"kind": "length", "prop": "length", "y": "surface"}]))


def _has(*names):
    return [n for n in names if n in MATERIALS]


# ---------------------------------------------------------------- ramp on blocks
def ramp_geometry(blocks, length, rises):
    """The ramp's shape in its own frame (its anchor at the foot tip, on the floor): the plank's outline, the blocks' centres and the lip,
    and its rise and slope. The plank's top face runs from the foot tip (0, 0) up to its top end; its underside rests on the floor (the foot is
    feathered: cut along the floor) and on the top block's edge, OVERHANG short of its end; sin θ = s solves (L − t·cos θ/s − e)·s = H (the
    underside's length from the floor to the block's edge, times s, is the stack's height H = blocks × 5 cm). rises: "left" (the high end on
    the left, a car rolls to the right) or "right"."""
    t, e, bh = PLANK_T, OVERHANG, BLOCK[1]
    n = max(0, int(blocks))
    # the stack fits under the plank (its slope at most 0.8, 53°): blocks beyond are left out
    while n > 0 and n * bh > 0.8 * (length - e - t):
        n -= 1
    H = n * bh
    out = {"blocks": n, "rise": H}
    sx = -1.0 if rises != "right" else 1.0
    if n == 0:
        # a board lying flat on the floor, with a 6 cm bevel at its foot
        out.update(s=0.0, c=1.0, plank=None, flat=True, stack=[], lip=None)
        return out
    s = H / (length - e)
    for _ in range(6):
        s = (H + t * math.sqrt(1 - s * s)) / (length - e)
    c = math.sqrt(1 - s * s)
    L = length
    # top face from the foot tip F = (0, 0) along u = (−c, s); the underside t below it; the foot cut along the floor at x = −t/s
    T = (-L * c, L * s)
    Tb = (-L * c - t * s, L * s - t * c)
    B0 = (-t / s, 0.0)
    pts = [(0.0, 0.0), T, Tb, B0]
    # the underside meets the top block's edge (L_b − e) along it from B0: the stack's near face is there
    Lb = L - t * c / s
    xs = B0[0] - (Lb - e) * c
    stack = [(xs - BLOCK[0] / 2, bh / 2 + k * bh) for k in range(n)]
    # the lip: a 6 x 15 mm stop standing on the top face at its top end
    lt, lh = LIP
    ux, uy = -c, s
    nx, ny = s, c                                 # the top face's outward normal (up and to the high end's side)
    base = (T[0] - lt * ux, T[1] - lt * uy)
    lip = [(T[0], T[1]), base, (base[0] + lh * nx, base[1] + lh * ny), (T[0] + lh * nx, T[1] + lh * ny)]
    if sx > 0:
        pts = [(-x, y) for x, y in pts][::-1]
        stack = [(-x, y) for x, y in stack]
        lip = [(-x, y) for x, y in lip][::-1]
    out.update(s=s, c=c, plank=pts, flat=False, stack=stack, lip=lip)
    return out


def _ramp():
    def build_ramp(c, P):
        g = ramp_geometry(P["blocks"], P["length"], P["rises"])
        d = P["depth"]
        wood = c.mat(base="varnished hardwood", overrides={})
        if g["flat"]:
            sx = -1.0 if P["rises"] != "right" else 1.0
            L = P["length"]
            c.slab("plank", L, PLANK_T, d, sx * (L / 2 + 0.06), PLANK_T / 2, kind="static", words="a flat board on the floor")
            bevel = [(0.0, 0.0), (sx * 0.06, PLANK_T), (sx * 0.06, 0.0)]
            c.poly("foot", bevel if sx < 0 else bevel[::-1], d, kind="static", words="the board's bevelled foot")
        else:
            c.poly("plank", g["plank"], d, kind="static", words=f"a ramp: a plank on {g['blocks']} wooden block{'s' if g['blocks'] != 1 else ''}")
            for k, (x, y) in enumerate(g["stack"]):
                c.slab(f"block{k + 1}", BLOCK[0], BLOCK[1], min(0.3, max(BLOCK[2], d * 0.6)), x, y, kind="static", material=wood, look="wood",
                       words="a wooden block under the ramp")
            if P["lip"]:
                c.poly("lip", g["lip"], d, kind="static", material=wood, look="wood", words="a small stop at the top of the ramp")
        # what was built: the blocks that fit, the rise (m) and the slope (degrees), for the inspector and the AI
        P["blocks_used"] = g["blocks"]
        P["rise"] = round(g["rise"], 5)
        P["slope"] = round(math.degrees(math.atan2(g["s"], g["c"])), 2)
    register(ItemType("ramp", "Ramp on blocks", "Surfaces & ramps", build_ramp, dynamic=False, material="varnished hardwood",
                      materials=_has("varnished hardwood", "carpet", "felt", "sandpaper", "rubber mat", "ice"), module="mechanics",
                      props=[Prop("blocks", "Blocks under it", 1, 0, 8, 1, "", "Wooden blocks stacked under its high end, 5 cm each: 1 block vs 3 blocks", kind="int"),
                             Prop("length", "Length", 1.0, 0.4, 2.0, 0.01, "m", "The plank's length"),
                             Prop("depth", "Width (front to back)", 0.12, 0.08, 0.4, 0.01, "m", "Only for the 3D look"),
                             Prop("rises", "High end", "left", kind="choice", choices=["left", "right"], help="left: things roll down to the right"),
                             Prop("lip", "Stop at the top", True, kind="bool", help="A small stop a car can wait against at the top")],
                      readouts=[],
                      tags=["ramp", "incline", "slope", "blocks", "fair test", "car ramp", "inclined plane", "height", "plank", "board", "hill"],
                      anchor="the floor at the ramp's foot (its low end)",
                      description="A plank resting on a stack of wooden blocks (5 cm each) at its high end, its foot feathered onto the floor: "
                                  "more blocks, a steeper ramp. A car let go at the top rolls down and off onto the floor.",
                      source="The catalog's wooden block, 10 x 5 x 5 cm, lies flat under the plank (5 cm of rise each); an 18 mm pine plank (provisional). "
                             "sin θ = rise / (plank under the stack): 1 block under a 1 m plank is 3.0°, 3 blocks 8.9°.",
                      facts="1 m plank · 1 block (5 cm)", edit=[{"kind": "length", "prop": "length"}]))


# ---------------------------------------------------------------- clay that sticks
def _clay_fill():
    """The share of its box a lump of clay fills (CLAY_SHAPE's area: the box is 1 x 1)."""
    n = len(CLAY_SHAPE)
    return sum(CLAY_SHAPE[k][0] * CLAY_SHAPE[(k + 1) % n][1] - CLAY_SHAPE[(k + 1) % n][0] * CLAY_SHAPE[k][1] for k in range(n)) / 2


def _clay():
    def build_clay(c, P):
        m = P["mass"]
        w = P["width"]
        # a lump pressed flat on what it sits on (CLAY_SHAPE), as deep as it is wide: its volume m / ρ = fill × w × h × w sets its height
        h = round(min(max(m / CLAY_DENSITY / (_clay_fill() * w * w), 0.004), w), 5)
        pts = [(round(x * w, 5), round(y * h, 5)) for x, y in CLAY_SHAPE]
        n = len(pts)
        area = sum(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1] for k in range(n)) / 2
        dens = round(m / (area * w), 3)
        sid = c.poly("clay", pts, w, material=c.mat(density=dens), words="a lump of modelling clay")
        if P["sticky"]:
            c.process("mechanics", "stick", role="sticky", solid=sid, to="all" if P["sticks_to"] == "anything" else "moving")
        P["height"] = h
    register(ItemType("clay-lump", "Lump of clay", "Blocks & shapes", build_clay, material="modelling clay", materials=["modelling clay"], module="mechanics",
                      props=[Prop("mass", "Weight", 0.06, 0.005, 1.0, 0.005, "kg", "60 g: a small handful"),
                             Prop("width", "Width", 0.05, 0.015, 0.15, 0.001, "m"),
                             Prop("sticky", "Sticks", True, kind="bool", help="It sticks to the first thing it touches (and stays stuck)"),
                             Prop("sticks_to", "Sticks to", "moving things", kind="choice", choices=["moving things", "anything"],
                                  help="moving things: a car or a cart it touches, not the floor; anything: walls and floors too")],
                      tags=["clay", "plasticine", "play-doh", "sticky", "stick", "glue", "velcro", "load", "weight", "inelastic"],
                      anchor="its middle",
                      description="A lump of modelling clay. Pressed onto a car or a cart it rides along stuck to it (it adds its weight); thrown at a cart "
                                  "it sticks: a perfectly inelastic hit, both moving on together.",
                      source="Plasticine 1570 kg/m³ (Eckerson et al. 2008); a stuck lump is welded to what it touched (tooling/src/sim/mechanics.ts `sticky`).",
                      facts="60 g · sticks", edit=[]))


# ---------------------------------------------------------------- helpers
def _child(c, part, parent, w, h, d, dx, dy, material, words, look):
    """A slab welded to another part of this item: dx, dy in the parent's frame (catalog_mechanisms.py's _child)."""
    s = {"kind": c.kind, "id": f"{c.item['id']}/{part}", "words": words, "item": c.item["id"], "look": look,
         "body": {"kind": "slab", "width": round(w, 5), "height": round(h, 5), "depth": d}, "material": material,
         "at": {"x": round(dx, 5), "y": round(dy, 5)}, "parent": parent,
         "placeholder": {"fill": LOOK_FILL.get(look, "#c8955a")}, "render": {"kind": "procedural", "shade": LOOK_SHADE.get(look, "#8a6a45")}, "depth": 2}
    c.sb.solids.append(s)
    return s["id"]


def _r(v, n=5):
    return round(v, n)


# ---------------------------------------------------------------- dynamics cart (plunger, bumpers, added masses)
CART = dict(L=0.17, H=0.035, clear=0.006, r=0.0125, ax=0.055, depth=0.08, mass=0.25, wheels=0.016)   # [PASCO] class cart: 0.25 kg, 17 x 8 cm; light wheels (8 g a side)
PLUNGER = dict(k=400.0, click=0.008, stroke=0.026, rod=0.006, len=0.05)   # spring N/m (provisional), 8 mm a click, 2.6 cm of travel, a 6 mm rod 5 cm long
BUMPERS = {"plain": None, "spring": "spring bumper", "magnet": "magnet bumper", "velcro": "velcro", "clay": "modelling clay"}
STEEL = 7850


def _cart():
    def build_cart(c, P):
        L, H, cl, r, ax, d = CART["L"], CART["H"], CART["clear"], CART["r"], CART["ax"], CART["depth"]
        clicks = int(P["plunger"])
        rod_m = STEEL * PLUNGER["len"] * PLUNGER["rod"] * PLUNGER["rod"] if clicks > 0 else 0.0
        body_m = CART["mass"] - CART["wheels"] - rod_m     # (the whole cart weighs 0.25 kg, its plunger rod and wheels included)
        yc = cl + H / 2
        # the body's ABS and steel axles and plunger works: its density makes it weigh what a class cart's body does
        chassis = c.slab("chassis", L, H, d, 0.0, yc, material=c.mat(base="cart plastic", density=_r(body_m / (L * H * d), 3), overrides={}),
                         look="cart blue", words="a lab dynamics cart's body")
        wmat = c.mat(base="cart plastic", density=_r(CART["wheels"] / 2 / ((4 / 3) * math.pi * r * r * r), 3), overrides={})
        for part, sx in (("front", 1.0), ("rear", -1.0)):
            c.ball(part, r, sx * ax, r, material=wmat, inertia=0.5, shape="cylinder", length=0.01, depth3d=0.012, words="a lab cart's wheel")
            c.joint("wheel", f"axle-{part}", chassis="chassis", wheel=part, anchor=(sx * ax, r - yc), axis={"x": 0.0, "y": 1.0}, frequency=0.0, damping=0.0)
        top = H / 2
        load = P["load"]
        if load >= 0.001:
            # steel bars on its deck: 13 x 4 cm, as thick as their weight makes them (a 250 g bar is 6 mm); under 82 g a 2 mm plate, its density made
            # up to weigh exactly that (a bar a hair thick would be a body of no size: the solver's numbers broke down on one); under a gram, none
            hb = load / (STEEL * 0.13 * 0.04)
            mat = c.mat(base="steel", overrides={})
            if hb < 0.002:
                hb = 0.002
                mat = c.mat(base="steel", density=_r(load / (0.13 * hb * 0.04), 3), overrides={})
            _child(c, "load", chassis, 0.13, hb, 0.04, 0.0, top + hb / 2, mat, f"{load:g} kg of steel bars on the cart", "steel")
        # bumpers at both ends (a plain cart's ends are its body's)
        bm = BUMPERS.get(P["bumper"])
        if bm is not None and bm in MATERIALS:
            bt = 0.006
            mat = c.mat(base=bm, density=_r(0.01 / (bt * 0.025 * 0.05), 3), overrides={})
            for part, sx in (("bumper-front", 1.0), ("bumper-back", -1.0)):
                sid = _child(c, part, chassis, bt, 0.025, 0.05, sx * (L / 2 + bt / 2), 0.0, mat, f"a {P['bumper']} bumper", MATERIALS[bm]["look"])
                if P["bumper"] in ("velcro", "clay"):
                    c.process("mechanics", f"{part}-stick", role="sticky", solid=sid, to="moving")
        if clicks > 0:
            # the plunger: a steel rod in a channel along the body, out of its front end, pushed in `clicks` notches and held there; let go, its
            # spring drives it out to its stop, pushing off whatever it touches (internal forces: the cart and what it pushes share equal and opposite
            # impulses, MS-PS2-1)
            pk, click, stroke, rod, rl = PLUNGER["k"], PLUNGER["click"], PLUNGER["stroke"], PLUNGER["rod"], PLUNGER["len"]
            comp = clicks * click
            out_x = L / 2 + stroke                        # its tip fully out (cart frame), at the deck's middle height
            tip = out_x - comp
            # (its channel runs along the body's upper half, clear of the wheels' tops: a rod at the wheels' height would rub them)
            sid = c.slab("plunger", rl, rod, rod, tip - rl / 2, yc + 0.008, material=c.mat(base="steel", overrides={}), look="steel", words="the cart's spring plunger")
            c.process("mechanics", "plunger-rail", role="slider", a=chassis, b=sid, anchorA={"x": 0.0, "y": 0.0}, anchorB={"x": 0.0, "y": 0.0},
                      axis={"x": 1.0, "y": 0.0}, lower=_r(-(stroke - comp)), upper=_r(comp), friction=0.05)
            # the spring from a seat in the channel (x = L/2 − rod − stroke) to the rod's back end: at rest when the rod is all the way out
            back = L / 2 - rl
            rest = _r(out_x - rl - (back - stroke))
            c.joint("spring", "plunger-spring", a="chassis", b="plunger", anchorA=(_r(back - stroke), 0.008), anchorB=(_r(-rl / 2), 0.0), rest=rest,
                    stiffness=pk, damping=0.0, compressOnly=True, coils=10, coilRadius=0.004)
        # its smart-cart sensor: speed along its track (+ forward) and acceleration, each over the last 0.1 s
        c.process("mechanics", "sensor", role="meter", reads="motion", solid=chassis, key="speed")
        P["total_mass"] = round(CART["mass"] + load + (0.0 if bm is None else 0.02), 4)
    register(ItemType("dynamics-cart", "Dynamics cart", "Machines & motion", build_cart, material="cart plastic", materials=["cart plastic"], module="mechanics",
                      props=[Prop("load", "Added mass", 0.0, 0.0, 2.0, 0.05, "kg", "Steel bars on its deck (0.25 kg each in a lab set)"),
                             Prop("plunger", "Plunger clicks", 0, 0, 3, 1, "", "Its spring plunger pushed in 1-3 notches: let go, it pushes off what it touches", kind="int"),
                             Prop("bumper", "Bumpers", "plain", kind="choice", choices=list(BUMPERS),
                                  help="spring and magnet bounce (e 0.9, 0.95); velcro and clay stick (a perfectly inelastic hit)")],
                      readouts=[Readout("speed", "Speed", "m/s", 3, "Its speed along its track, + forward (the way it faces): a smart cart's wheel encoder, over 0.1 s"),
                                Readout("accel", "Acceleration", "m/s²", 2, "How fast its speed changes, + forward: over the last 0.1 s")],
                      tags=["cart", "dynamics cart", "lab cart", "trolley", "collision", "momentum", "plunger", "newton", "F = ma", "velcro", "bumper", "track"],
                      anchor="the ground under its middle, where the wheels touch",
                      description="A lab dynamics cart (0.25 kg, 17 cm) on low-friction wheels: add steel bars, set its bumpers (spring, magnet, velcro, clay), "
                                  "cock its spring plunger to push two carts apart. For F = ma, momentum and collisions.",
                      source="[PASCO]-style class cart: 0.25 kg, 17 x 8 cm, wheels rolling with 0.002-0.005; plunger spring 400 N/m, 8 mm a click (provisional).",
                      facts="0.25 kg · 17 cm · low friction", edit=[]))


# ---------------------------------------------------------------- puller (a motor winch) and pusher (a driven paddle)
DRUM = 0.015      # m: a winch drum's radius (where its cord winds)
PULL_TOP = 2.0    # m/s: how fast a force-mode winch reels in at most (it pulls with its set force below that)


def _puller():
    def build_puller(c, P):
        h = P["height"]
        side = -1.0 if P["faces"] == "left" else 1.0
        wood = c.mat(base="varnished hardwood", overrides={})
        c.slab("base", 0.14, 0.03, 0.12, 0.0, 0.015, kind="static", material=c.mat(base="steel", overrides={}), look="steel", words="the winch's heavy base")
        c.slab("post", 0.03, max(0.01, h - 0.03), 0.04, -side * 0.035, 0.03 + max(0.01, h - 0.03) / 2, kind="static", material=wood, look="wood",
               words="the winch's post")
        # the drum turns on its axle at the post's top, driven by a geared motor held at its set force (torque F·r) up to PULL_TOP, or at its set speed
        mode = P["mode"]
        sp = P["speed"] if mode == "speed" else PULL_TOP
        tq = (100.0 if mode == "speed" else P["force"]) * DRUM
        # (force mode: a light drum, a 10 g hollow spool, so it adds little inertia to what it pulls; speed mode: the gearbox behind it held at its
        # speed, which the solver holds best as a heavy drum, 2 kg: a 10 g one fought the cord within each step and flung what it reeled in 45 % fast)
        dm = 0.01 if mode == "force" else 2.0
        c.ball("drum", DRUM, 0.0, h, material=c.mat(base="steel", density=_r(dm / ((4 / 3) * math.pi * DRUM * DRUM * DRUM), 3), overrides={}), look="steel",
               words="the winch's drum", shape="cylinder", length=0.04, depth3d=0.04, pivot={"x": 0.0, "y": 0.0},
               motor={"speed": _r(side * sp / DRUM, 4), "torque": _r(tq, 5)})
        P["pull"] = round(P["force"], 4) if mode == "force" else None
    register(ItemType("puller", "Winch puller", "Machines & motion", build_puller, dynamic=True, module="mechanics",
                      props=[Prop("mode", "Pulls", "force", kind="choice", choices=["force", "speed"], help="force: a steady pull of its set force; speed: reels in at its set speed"),
                             Prop("force", "Force", 5.0, 0.1, 100.0, 0.1, "N", "The steady pull on its cord (force mode)"),
                             Prop("speed", "Speed", 0.2, 0.01, 2.0, 0.01, "m/s", "How fast it reels in (speed mode)"),
                             Prop("height", "Drum height", 0.05, 0.03, 1.0, 0.005, "m", "Its cord leaves the drum's top this high: set it to the pulled thing's middle"),
                             Prop("faces", "Pulls toward", "left", kind="choice", choices=["left", "right"],
                                  help="Which side its cord leaves on (it reels the linked thing toward itself)")],
                      links=[Link("pulls", "Pulls", help="The thing its cord is tied to (a cart, a block, a sled)")],
                      readouts=[Readout("newtons", "Pull", "N", 2, "The pull in its cord now: a force meter in the cord (over the last 0.1 s)")],
                      tags=["puller", "winch", "force meter", "newton meter", "pull", "force", "rope", "tug of war", "constant force", "motor", "applied force", "net force"],
                      anchor="the middle of its base, on the floor",
                      description="A motor winch on a stand: its cord, tied to the linked thing, pulls with a steady force (newtons) or reels it in at a set "
                                  "speed. Two pullers on one cart: a tug-of-war (balanced when their forces are equal).",
                      source="A geared motor held at torque F·r on a 15 mm drum: the cord's tension is F while the load moves slower than 2 m/s.",
                      facts="5 N steady pull", edit=[]))


PUSH_ROD_KG = 0.135648     # kg: the pusher's rod, whatever its length (what its first 12 cm, 12 mm square steel bar weighed)
PUSH_PADDLE_KG = 0.06336   # kg: its paddle, whatever its size (the 6 cm pad's: 12 mm x 6 cm x 8 cm of 1100 kg/m³ rubber): its size is its reach, not its weight


def _pusher():
    def build_pusher(c, P):
        stroke = P["stroke"]
        h = P["height"]
        # The housing is the actuator's body: as long as the rod's travel and 2 cm more (at least 10 cm), its rod 5 mm over its middle, so a raised
        # rod is mounted in it (the housing stands on a wooden block under it), never over it. The rod slides in the housing's bore on the
        # drive's rail, which is the housing's: the two never touch (the rod in the housing's solid fought the rail, and its friction took a
        # different share of each push: a sprung toy car pushed with 5 N left at 0.93 m/s, with 5.25 N at 0.49 m/s).
        Lh = max(0.1, stroke + 0.02)
        yh = max(0.025, h - 0.005)
        housing = c.slab("housing", Lh, 0.05, 0.08, -Lh / 2, yh, kind="static", material=c.mat(base="cart plastic", overrides={}), look="cart blue",
                         words="the pusher's housing")
        if yh - 0.025 > 0.001:
            c.slab("riser", Lh, yh - 0.025, 0.08, -Lh / 2, (yh - 0.025) / 2, kind="static", material=c.mat(base="varnished hardwood", overrides={}), look="wood",
                   words="the wooden block the pusher stands on")
        # the rod spans the housing and reaches 2 cm out of its front, to the paddle; the rod and the paddle weigh what they do whatever the
        # stroke and the paddle's size (PUSH_ROD_KG, PUSH_PADDLE_KG): only the force and the time say how hard it pushes
        L = Lh + 0.02
        rod = c.slab("rod", L, 0.012, 0.012, 0.02 - L / 2, h, material=c.mat(base="steel", density=_r(PUSH_ROD_KG / (L * 0.012 * 0.012), 3), overrides={}),
                     look="steel", words="the pusher's rod")
        c.slab("paddle", 0.012, P["paddle"], 0.08, 0.026, h, material=c.mat(base="rubber mat", density=_r(PUSH_PADDLE_KG / (0.012 * P["paddle"] * 0.08), 3), overrides={}),
               look="rubber mat", words="the pusher's flat paddle")
        s = c.sb.solids[-1]
        s["parent"] = rod
        s["at"] = {"x": _r(0.006 + L / 2), "y": 0.0}
        s.pop("angle", None)
        t0 = P["delay"]
        # (the rail: from the rod's middle where it starts, along the housing, in the housing's own frame)
        rail = dict(role="slider", a=housing, b=rod, anchorA={"x": 0.01, "y": _r(h - yh)}, anchorB={"x": 0.0, "y": 0.0}, axis={"x": 1.0, "y": 0.0},
                    lower=0.0, upper=_r(stroke))
        if P["mode"] == "force":
            c.process("mechanics", "drive", **rail, speed=10.0, force=_r(P["force"], 4), friction=50.0, **({"from": t0} if t0 > 0 else {}),
                      until=_r(P["push_time"] + t0, 4))
        else:
            c.process("mechanics", "drive", **rail, speed=_r(P["speed"], 4), force=200.0, friction=50.0, **({"from": t0} if t0 > 0 else {}))
    register(ItemType("pusher", "Pusher", "Machines & motion", build_pusher, dynamic=True, module="mechanics",
                      props=[Prop("mode", "Pushes", "force", kind="choice", choices=["force", "speed"],
                                  help="force: pushes with its set force for its push time; speed: moves its paddle at a set speed for its stroke"),
                             Prop("force", "Force", 5.0, 0.1, 50.0, 0.1, "N", "The push (force mode)"),
                             Prop("push_time", "Push time", 0.2, 0.02, 5.0, 0.01, "s", "How long it pushes (force mode)"),
                             Prop("speed", "Speed", 0.5, 0.05, 3.0, 0.01, "m/s", "The paddle's speed (speed mode)"),
                             Prop("stroke", "Stroke", 0.15, 0.03, 0.5, 0.005, "m", "How far its paddle can go"),
                             Prop("height", "Height", 0.03, 0.015, 0.5, 0.005, "m", "The rod's height: set it to the pushed thing's middle (a raised housing stands on a wooden block)"),
                             Prop("paddle", "Paddle height", 0.06, 0.02, 0.3, 0.005, "m", "How tall its paddle is (its reach; it weighs 63 g whatever its size)"),
                             Prop("delay", "Starts after", 0.0, 0.0, 10.0, 0.05, "s", "Seconds after the scene lets go")],
                      tags=["pusher", "push", "force", "piston", "plunger", "applied force", "kick", "shove", "paddle", "net force", "harder push"],
                      anchor="the floor under its housing's front end (its paddle's face starts 3.2 cm ahead of it)",
                      description="A driven paddle on a rod from a fixed housing: it pushes what is in front of it (to its right; turn it to push another "
                                  "way) with a set force for a set time, or moves at a set speed: a harder push, a bigger change in motion.",
                      source="A linear actuator held at its set force (or speed) along its stroke; no people needed. Its rod (136 g) and paddle (63 g), "
                             "whatever their sizes, move with what it pushes: a push of F for t gives a thing of mass m that slides about "
                             "F·t / (m + 0.2 kg) (provisional weights).", facts="5 N for 0.2 s", edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- edge pulley: a cart pulled by a hanging mass (F = ma)
EDGE_R = 0.025    # m: the pulley wheel's radius (a lab "super pulley" is about 5 cm across)


def _edge_pulley():
    def build_edge(c, P):
        m = P["hanging_mass"]
        side = 1.0 if P["mass_side"] == "right" else -1.0
        c.slab("clamp", 0.03, 0.06, 0.05, -side * 0.02, -0.03, kind="static", material=c.mat(base="steel", overrides={}), look="steel", words="the pulley's clamp")
        c.ball("wheel", EDGE_R, 0.0, 0.0, kind="static", material=c.mat(base="cart plastic", overrides={}), look="cart blue", words="the pulley wheel",
               shape="cylinder", length=0.012, depth3d=0.012)
        # the hanging mass: a 25 x 25 mm brass bar as tall as its weight makes it (8400 kg/m³: 50 g is 9.5 mm; at least 12 mm, at most 25 cm, its density
        # then made up to weigh exactly m), its string tied to its top, hung `drop` below the wheel's axle on the wheel's outer side
        hb = min(_r(max(0.012, m / (8400 * 0.025 * 0.025)), 5), 0.25)
        c.slab("mass", 0.025, hb, 0.025, side * EDGE_R, -P["drop"] - hb / 2, material=c.mat(base="steel", density=_r(m / (0.025 * hb * 0.025), 3), overrides={}),
               look="steel", words=f"a {m * 1000:g} g hanging mass")
        P["mass_height"] = hb
    register(ItemType("edge-pulley", "Edge pulley", "Machines & motion", build_edge, dynamic=True, module="mechanics",
                      props=[Prop("hanging_mass", "Hanging mass", 0.05, 0.005, 2.0, 0.005, "kg", "Hangs on the string over the pulley and pulls the cart"),
                             Prop("drop", "String below the pulley", 0.15, 0.02, 1.5, 0.005, "m", "From the wheel's axle down to the mass's top at the start"),
                             Prop("mass_side", "Mass hangs on", "right", kind="choice", choices=["right", "left"], help="The table's edge side: the cart is on the other side")],
                      links=[Link("pulls", "Pulls", help="The cart (or block) its string is tied to")],
                      readouts=[Readout("newtons", "String pull", "N", 3, "The pull in the string (a force sensor where it is tied to the cart), over the last 0.1 s: "
                                        "less than the hanging weight while it falls, T = m·(g − a)")],
                      tags=["pulley", "edge pulley", "force sensor", "hanging mass", "F = ma", "newton second law", "modified atwood", "cart", "string", "acceleration", "lab"],
                      anchor="the pulley wheel's axle (clamp it at the table's edge, its top level with the cart's string)",
                      description="A pulley clamped at the table's edge: a string from the linked cart runs over it to a hanging mass, which falls and pulls the "
                                  "cart: a = m·g/(M + m) (Newton's second law).",
                      source="An ideal light pulley (a lab low-friction pulley): a = m g / (M + m) for a frictionless cart [SERWAY].", facts="50 g pulls the cart",
                      edit=[]))


# ---------------------------------------------------------------- things that fall through the air: coffee filters, a parachute, paper, a feather
FILTER = dict(mass=0.0011, top=0.13, bottom=0.06, h=0.045)   # a #4 basket filter: 1.1 g, about 13 cm across its mouth falling (spec mechanics.md)


def _falling():
    def build_filters(c, P):
        n = int(P["count"])
        w, b, h = FILTER["top"], FILTER["bottom"], FILTER["h"]
        hh = h + 0.002 * (n - 1)                       # nested filters stack a little taller
        pts = [(-b / 2, -hh / 2), (b / 2, -hh / 2), (w / 2, hh / 2), (-w / 2, hh / 2)]
        area = (w + b) / 2 * hh
        m = FILTER["mass"] * n
        sid = c.poly("filter", pts, w, material=c.mat(base="office paper", density=_r(m / (area * w), 4), overrides={}), look="office paper",
                     words=f"{n} nested paper coffee filter{'s' if n > 1 else ''}")
        # (a thin paper basket: the air in it falls with it; only its paper (800 kg/m³) displaces air, so the engine's lift on the whole shape is taken back)
        c.process("mechanics", "shell", role="unbuoy", solid=sid, volume=_r(area * w - m / 800.0, 7))
        P["mass"] = round(m, 6)
    register(ItemType("coffee-filters", "Coffee filters", "Machines & motion", build_filters, material="office paper", materials=["office paper"], module="mechanics",
                      props=[Prop("count", "How many nested", 1, 1, 8, 1, "", "Nested basket filters fall as one, faster with more (speed ∝ √n)", kind="int")],
                      tags=["coffee filter", "terminal velocity", "air resistance", "drag", "falling", "paper", "parachute", "slow fall"],
                      anchor="its middle",
                      description="Basket coffee filters (1.1 g each), nested: dropped mouth up they reach terminal speed within a few tens of cm, about "
                                  "1 m/s for one; n nested fall √n times faster (the classic air-resistance lab).",
                      source="A #4 basket filter 1.1 g, about 13 cm across falling (spec mechanics.md); v_t = sqrt(2mg / (ρ C_d A)) with the engine's flat-plate drag "
                             "(C_d 1.05 on width x depth) [HOE].", facts="1.1 g each · about 1 m/s", edit=[]))

    def build_parachute(c, P):
        D, m, L = P["canopy"], P["load_mass"], P["lines"]
        # the canopy: a shallow dome seen from the side (a filled convex lens: its drag is the engine's flat plate on its width x depth, C_d 1.05 on D²,
        # a round canopy's C_d 1.3-1.4 on πD²/4 [KNACKE]: within 5 %)
        dome = 0.18 * D
        k = 0.12 * D
        pts = [(-D / 2, 0.0), (-D / 2 + k, -0.004), (D / 2 - k, -0.004), (D / 2, 0.0), (D / 2 - k, dome * 0.75), (0.0, dome), (-D / 2 + k, dome * 0.75)]
        pts = [(round(x, 5), round(y, 5)) for x, y in pts]
        cm = P["canopy_mass"]
        area = abs(sum(pts[i][0] * pts[(i + 1) % 7][1] - pts[(i + 1) % 7][0] * pts[i][1] for i in range(7))) / 2
        sid = c.poly("canopy", pts, D, 0.0, L, material=c.mat(base="nylon canopy", density=_r(cm / (area * D), 4), overrides={}), look="nylon canopy",
                     words="a parachute canopy")
        # (a thin canopy: the air under it moves with it; only its plastic (about 1000 kg/m³) displaces air)
        c.process("mechanics", "shell", role="unbuoy", solid=sid, volume=_r(area * D - cm / 1000.0, 7))
        s = 0.03
        c.slab("load", s, s, s, 0.0, 0.0, material=c.mat(base="steel", density=_r(m / (s * s * s), 3), overrides={}), look="steel", words=f"a {m * 1000:g} g load")
        for part, sx in (("line-left", -1.0), ("line-right", 1.0)):
            c.joint("rope", part, a="canopy", b="load", anchorA=(_r(sx * D / 2), 0.0), anchorB=(_r(sx * s / 2), _r(s / 2)), length=_r(math.hypot(D / 2 - s / 2, L - s / 2) + 0.002),
                    thickness=0.001)
    register(ItemType("parachute", "Parachute", "Machines & motion", build_parachute, material="nylon canopy", materials=["nylon canopy"], module="mechanics",
                      props=[Prop("canopy", "Canopy width", 0.4, 0.15, 1.2, 0.01, "m"), Prop("load_mass", "Load", 0.05, 0.005, 1.0, 0.005, "kg"),
                             Prop("canopy_mass", "Canopy weight", 0.004, 0.001, 0.05, 0.001, "kg"), Prop("lines", "Lines", 0.35, 0.1, 1.0, 0.01, "m", "From the canopy's rim down to the load")],
                      tags=["parachute", "air resistance", "drag", "terminal velocity", "egg drop", "slow fall", "canopy"],
                      anchor="the load's middle",
                      description="A plastic canopy on two lines over a load: it falls at a steady terminal speed, v = √(2mg/(ρ·C_d·A)) (50 g under a 30 cm "
                                  "canopy: about 3 m/s); a bigger canopy, a slower fall.",
                      source="Canopy C_d 1.3-1.4 on its area [KNACKE]; the engine's flat-plate drag C_d 1.05 on width x depth matches it to 5 %.",
                      facts="40 cm canopy · 50 g", edit=[]))

    def build_sheet(c, P):
        w, d = (0.297, 0.21) if P["held"] == "long side" else (0.21, 0.297)
        t = 0.001                                          # (1 mm in the engine: Box2D's skin is 1 mm; its density keeps its 5 g)
        c.slab("sheet", w, t, d, material=c.mat(base="office paper", density=_r(P["mass"] / (w * t * d), 3), overrides={}), look="office paper", words="a flat sheet of paper")
    register(ItemType("paper-sheet", "Sheet of paper", "Machines & motion", build_sheet, material="office paper", materials=["office paper"], module="mechanics",
                      props=[Prop("mass", "Weight", 0.005, 0.001, 0.05, 0.0005, "kg", "An A4 sheet of 80 g/m² paper weighs 5.0 g"),
                             Prop("held", "Falls with its", "long side", kind="choice", choices=["long side", "short side"], help="Which side we see")],
                      tags=["paper", "sheet", "A4", "air resistance", "falling", "flat", "crumpled", "drag"],
                      anchor="its middle",
                      description="A flat A4 sheet of office paper (5 g): flat it drifts down slowly (about 1 m/s); crumpled (the paper ball) it falls fast.",
                      source="A4 is 210 x 297 mm (ISO 216); 80 g/m² → 5.0 g.", facts="A4 · 5 g", edit=[]))

    def build_ball(c, P):
        D = P["diameter"]
        r = D / 2
        c.ball("ball", r, material=c.mat(base="office paper", density=_r(P["mass"] / ((4 / 3) * math.pi * r * r * r), 4), overrides={}), look="office paper",
               words="a crumpled ball of paper")
    register(ItemType("paper-ball", "Crumpled paper ball", "Machines & motion", build_ball, material="office paper", materials=["office paper"], module="mechanics",
                      props=[Prop("diameter", "Diameter", 0.06, 0.02, 0.15, 0.001, "m"), Prop("mass", "Weight", 0.005, 0.001, 0.05, 0.0005, "kg")],
                      tags=["paper", "crumpled", "ball", "air resistance", "falling", "drag"], anchor="its middle",
                      description="The same 5 g sheet crumpled into a ball about 6 cm across: it falls nearly as fast as a stone over a metre.",
                      source="An A4 sheet (5.0 g) crumpled: about 6 cm across (spec mechanics.md).", facts="6 cm · 5 g", edit=[]))

    def build_feather(c, P):
        kind = P["kind"]
        L, w, m = (0.25, 0.04, 0.03) if kind == "falcon" else (0.15, 0.04, 0.001)
        t = 0.004
        c.slab("feather", L, t, w, material=c.mat(base="feather", density=_r(m / (L * t * w), 3), overrides={}), look="feather", words=f"a {kind} feather")
        P["mass"] = m
    register(ItemType("feather", "Feather", "Machines & motion", build_feather, material="feather", materials=["feather"], module="mechanics",
                      props=[Prop("kind", "Feather", "falcon", kind="choice", choices=["falcon", "craft"],
                                  help="falcon: the 30 g feather of Apollo 15's hammer-and-feather drop; craft: a 1 g craft feather")],
                      tags=["feather", "hammer and feather", "apollo", "vacuum", "air resistance", "falling", "moon", "galileo"],
                      anchor="its middle",
                      description="A feather: in air it drifts down slowly; in a vacuum (the scene's air off) it falls with a hammer, as on the Moon in 1971.",
                      source="[APOLLO15]: a 1.32 kg hammer and a 0.03 kg falcon feather, dropped together on the Moon, landed together.",
                      facts="30 g falcon feather", edit=[]))


# ---------------------------------------------------------------- links: what a module item does to another item, once both are built
# where a cord or a string is tied on a pulled thing of these types (its part), not on its first moving solid: a parachute's load, as a string is
# tied to the payload (its canopy, 1 g at the least, hauled by a 0.9 kg hanging mass against a fixed cup's wall, was 900 times lighter than what
# pulled it: the solver fought itself and the run broke down, air or vacuum alike; the load is 5 g or more, and hangs the canopy from its lines)
TIE_PART = {"parachute": "load"}


def _root_solid(sb, iid, itype=None):
    """An item's first moving solid that no weld holds (its body's root), or None; for a type in TIE_PART, that part when it has one."""
    part = TIE_PART.get(itype)
    if part is not None:
        s = next((x for x in sb.solids if x["id"] == f"{iid}/{part}" and x["kind"] == "dynamic"), None)
        if s is not None:
            return s
    for s in sb.solids:
        if s.get("item") == iid and s["kind"] == "dynamic" and not ("parent" in s and "pivot" not in s):
            return s
    return None


def _world_of(sb, s):
    """A solid's world pose at the start: (x, y, angle); a welded child's from its parent's."""
    x, y, a = s["at"]["x"], s["at"]["y"], s.get("angle", 0.0)
    if "parent" in s:
        q = next((p for p in sb.solids if p["id"] == s["parent"]), None)
        if q is not None:
            qx, qy, qa = _world_of(sb, q)
            x, y, a = qx + x * cos(qa) - y * sin(qa), qy + x * sin(qa) + y * cos(qa), a + qa
    return x, y, a


def _half_extent(s):
    """Half a solid's width and height in its own frame (a ball: its radius twice)."""
    b = s["body"]
    if b["kind"] == "ball":
        return b["radius"], b["radius"]
    if b["kind"] == "slab":
        return b["width"] / 2, b["height"] / 2
    xs = [p["x"] for p in b["points"]]
    ys = [p["y"] for p in b["points"]]
    return (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2


def _tie_point(sb, target, towards):
    """Where a cord from the world point `towards` is tied on the target solid: its end facing that point, at its middle's height, in its own frame."""
    x, y, a = _world_of(sb, target)
    hx, hy = _half_extent(target)
    dx = towards[0] - x
    dy = towards[1] - y
    lx = dx * cos(-a) - dy * sin(-a)
    ly = dx * sin(-a) + dy * cos(-a)
    if target["body"]["kind"] == "ball":
        return (_r((hx if lx >= 0 else -hx) * 0.98), 0.0)
    return (_r(hx if lx >= 0 else -hx), _r(min(hy, max(-hy, ly))))


def _links(sb, scene):
    """The cords of pullers and edge pulleys, tied to what they pull (their `pulls` link): a spool record (a winch's cord wound on its drum) or a
    doc pulley joint (the string over the edge pulley to its hanging mass). A link that names nothing of the scene leaves the cord off."""
    items = {i["id"]: i for i in scene.get("items", []) if isinstance(i, dict) and isinstance(i.get("id"), str)}
    for item in scene.get("items", []):
        if not isinstance(item, dict) or item.get("type") not in ("puller", "edge-pulley"):
            continue
        iid = item["id"]
        P = props_of(item)
        other = P.get("pulls")
        if not isinstance(other, str) or other == iid or other not in items or items[other].get("type") not in TYPES:
            continue
        target = _root_solid(sb, other, items[other].get("type"))
        if target is None:
            continue
        if item["type"] == "puller":
            drum = next((s for s in sb.solids if s["id"] == f"{iid}/drum"), None)
            if drum is None:
                continue
            side = -1.0 if P["faces"] == "left" else 1.0
            top = (drum["at"]["x"] + side * 0.0, drum["at"]["y"] + DRUM)
            tie = _tie_point(sb, target, top)
            # the cord leaves over the drum's top toward the pulled thing (sense: the drum turning its motor's way winds it in)
            sb.processes.append({"kind": "mechanics", "id": f"{iid}/cord", "item": iid, "role": "spool", "drum": drum["id"], "b": target["id"],
                                 "center": {"x": 0.0, "y": 0.0}, "radius": DRUM, "sense": 1 if side > 0 else -1, "anchorB": {"x": tie[0], "y": tie[1]},
                                 "minLength": 0.02})
            # (its force meter: the cord's pull)
            sb.processes.append({"kind": "mechanics", "id": f"{iid}/meter", "item": iid, "role": "meter", "reads": "rope", "a": drum["id"], "b": target["id"],
                                 "key": "newtons"})
        else:
            wheel = next((s for s in sb.solids if s["id"] == f"{iid}/wheel"), None)
            mass = next((s for s in sb.solids if s["id"] == f"{iid}/mass"), None)
            if wheel is None or mass is None:
                continue
            side = 1.0 if P["mass_side"] == "right" else -1.0
            wx, wy = wheel["at"]["x"], wheel["at"]["y"]
            top = (wx, wy + EDGE_R)
            tie = _tie_point(sb, target, top)
            sb.joints.append({"kind": "pulley", "id": f"{iid}/string", "item": iid, "a": target["id"], "b": mass["id"],
                              "groundA": {"x": _r(wx), "y": _r(wy + EDGE_R)}, "groundB": {"x": _r(wx + side * EDGE_R), "y": _r(wy)},
                              "anchorA": {"x": tie[0], "y": tie[1]}, "anchorB": {"x": 0.0, "y": _r(mass["body"]["height"] / 2)},
                              "ratio": 1.0, "wheelRadius": EDGE_R, "render": {"draw": "none"}})
            # (its force sensor: the string's pull, where it is tied to the cart)
            sb.processes.append({"kind": "mechanics", "id": f"{iid}/meter", "item": iid, "role": "meter", "reads": "rope", "a": target["id"], "b": mass["id"],
                                 "key": "newtons"})


# ---------------------------------------------------------------- curved track: a roller coaster / marble run of true arcs (KE <-> PE)
TRACK_T = 0.02     # m: the track's thickness under its riding surface
ARC_STEP = 12.0    # degrees: an arc is built of convex pieces this long (each piece's riding face is a chord; the engine rides the true arc)
SLOPE = 40.0       # degrees: the drop's steepest (a ball rolls down it without slipping on steel: μ 0.4 > (2/7)·tan 40° = 0.24)
START_TILT = 2.0   # degrees: the start platform's tilt toward the drop


def _arc_pieces(c, name, cx, cy, R, a0, a1, side, material, look, d, loop=None):
    """The pieces of a true arc of the track (centre (cx, cy), radius R, from angle a0 to a1 degrees counter-clockwise): ring sectors TRACK_T thick
    on the solid side of the riding face (outside the circle for side "in", a valley or a loop; inside for "out", a hump), and the engine's arc record
    for each (a round body rides the true circle). loop: (loop record id, the angle where the loop begins) for a loop's pieces."""
    n = max(1, int(math.ceil(abs(a1 - a0) / ARC_STEP - 1e-9)))
    made = []
    for k in range(n):
        p0 = a0 + (a1 - a0) * k / n
        p1 = a0 + (a1 - a0) * (k + 1) / n
        lo, hi = min(p0, p1), max(p0, p1)
        r_in, r_out = (R, R + TRACK_T) if side == "in" else (R - TRACK_T, R)
        pt = lambda r, a: (cx + r * cos(a * D2R), cy + r * sin(a * D2R))     # noqa: E731
        pts = [(round(x, 5), round(y, 5)) for x, y in (pt(r_in, lo), pt(r_out, lo), pt(r_out, hi), pt(r_in, hi))]
        sid = c.poly(f"{name}{k + 1}", _ccw(pts), d, kind="static", material=material, look=look, words="a curved piece of track")
        rec = {"role": "arc", "solid": sid, "center": {"x": 0.0, "y": 0.0}, "radius": _r(R), "side": side,
               "from": _r(lo * D2R, 6), "to": _r(hi * D2R, 6)}
        if loop is not None:
            rec["loop"] = {"id": loop[0], "p0": _r((lo - loop[1]) * D2R, 6), "p1": _r((hi - loop[1]) * D2R, 6)}
        made.append(rec)
    return made


def _ccw(pts):
    """A convex quad's points counter-clockwise (reversed when they wind the other way)."""
    a = sum(pts[k][0] * pts[(k + 1) % len(pts)][1] - pts[(k + 1) % len(pts)][0] * pts[k][1] for k in range(len(pts)))
    return pts if a > 0 else pts[::-1]


def _flat_piece(c, name, x0, x1, y, material, look, d):
    """A straight level piece of track from x0 to x1, its riding face at height y."""
    c.slab(name, x1 - x0, TRACK_T, d, (x0 + x1) / 2, y - TRACK_T / 2, kind="static", material=material, look=look, words="a straight piece of track")


def _slope_piece(c, name, p, q, material, look, d):
    """A straight sloped piece of track from point p down to point q (its riding face), TRACK_T thick below it."""
    dx, dy = q[0] - p[0], q[1] - p[1]
    L = math.hypot(dx, dy)
    nx, ny = dy / L, -dx / L               # the face's normal, pointing down (into the track) for a face going left to right
    if ny > 0:
        nx, ny = -nx, -ny
    pts = [p, q, (q[0] + nx * TRACK_T, q[1] + ny * TRACK_T), (p[0] + nx * TRACK_T, p[1] + ny * TRACK_T)]
    pts = [(round(x, 5), round(y, 5)) for x, y in pts]
    c.poly(name, _ccw(pts), d, kind="static", material=material, look=look, words="a sloped piece of track")


def coaster_profile(layout, h, size, run):
    """The track's riding face, left to right from its start platform (x = 0 at its stop, height h), as segments: ("flat", x0, x1, y),
    ("slope", p, q), ("arc", cx, cy, R, a0, a1, side, loop). Also the start point (where a ball waits) and the end."""
    a = SLOPE
    sa, ca = sin(a * D2R), cos(a * D2R)
    ta = sa / ca
    base = TRACK_T
    Rc = 0.08                                                            # the lip's convex arc at the top of the drop
    Rv = min(0.3, max(0.08, 0.6 * (h - base)))                           # the drop's concave bottom
    segs = []
    # the start: a platform tilted START_TILT down toward the drop (a ball left on it rolls off at the release), from its stop at x = 0
    x1 = 0.08
    sg, cg = sin(START_TILT * D2R), cos(START_TILT * D2R)
    y1 = h - x1 * sg / cg
    segs.append(("slope", (0.0, h), (x1, y1)))
    # down: a convex lip, a straight slope, a concave bottom at the floor's height
    cx1, cy1 = x1 - Rc * sg, y1 - Rc * cg
    segs.append(("arc", cx1, cy1, Rc, 90.0 - START_TILT, 90.0 - a, "out", None))
    E1 = (cx1 + Rc * sa, cy1 + Rc * ca)
    S2y = base + Rv - Rv * ca
    S2x = E1[0] + (E1[1] - S2y) / ta
    xb = S2x + Rv * sa
    segs.append(("slope", E1, (S2x, S2y)))
    segs.append(("arc", xb, base + Rv, Rv, 270.0 - a, 270.0, "in", None))
    end = xb
    if layout == "valley":
        # up the other side, as it came down: a concave bottom, a slope, a convex lip, a platform at the start's height
        segs.append(("arc", xb, base + Rv, Rv, 270.0, 270.0 + a, "in", None))
        S3 = (xb + Rv * sa, S2y)
        E3x = S3[0] + (E1[1] - S2y) / ta
        segs.append(("slope", S3, (E3x, E1[1])))
        x4 = E3x + Rc * sa
        segs.append(("arc", x4, h - Rc, Rc, 90.0 + a, 90.0, "out", None))
        segs.append(("flat", x4, x4 + 0.08, h))
        end = x4 + 0.08
    elif layout == "hill":
        b = 30.0
        Hh = min(size, 0.9 * (h - base))
        Rf = Hh / (2 * (1 - cos(b * D2R)))
        sb_ = sin(b * D2R)
        xh = xb + 0.1
        segs.append(("flat", xb, xh, base))
        segs.append(("arc", xh, base + Rf, Rf, 270.0, 270.0 + b, "in", None))
        xt = xh + 2 * Rf * sb_
        segs.append(("arc", xt, base + Hh - Rf, Rf, 90.0 + b, 90.0 - b, "out", None))
        xe = xt + 2 * Rf * sb_
        segs.append(("arc", xe, base + Rf, Rf, 270.0 - b, 270.0, "in", None))
        segs.append(("flat", xe, xe + run, base))
        end = xe + run
    elif layout == "loop":
        RL = size
        xl = xb + 0.15
        segs.append(("flat", xb, xl, base))
        segs.append(("arc", xl, base + RL, RL, -90.0, 270.0, "in", "loop"))
        segs.append(("flat", xl, xl + run, base))
        end = xl + run
    else:
        segs.append(("flat", xb, xb + run, base))
        end = xb + run
    return {"segs": segs, "start": (0.04, h - 0.04 * sg / cg), "end": end, "bottom": (xb, base), "base": base}


def _coaster():
    def build_coaster(c, P):
        layout, h, size, run, d = P["layout"], P["height"], P["size"], P["run"], P["depth"]
        g = coaster_profile(layout, h, size, run)
        mat = c.mat()
        look = MATERIALS[P["material"]]["look"]
        k = 0
        recs = []
        for seg in g["segs"]:
            k += 1
            if seg[0] == "flat":
                _flat_piece(c, f"flat{k}", seg[1], seg[2], seg[3], mat, look, d)
            elif seg[0] == "slope":
                _slope_piece(c, f"slope{k}", seg[1], seg[2], mat, look, d)
            else:
                _, cx, cy, R, a0, a1, side, lp = seg
                loop = (c.sid("loop"), -90.0) if lp else None
                recs += [dict(r, center={"x": _r(cx), "y": _r(cy)}) for r in _arc_pieces(c, f"arc{k}-", cx, cy, R, a0, a1, side, mat, look, d, loop)]
        # the stop at the start: a ball or a car waits against it until the release
        c.slab("stop", 0.01, 0.02, d, -0.005, h + 0.01, kind="static", material=mat, look=look, words="the stop at the track's start")
        for r in recs:
            c.process("mechanics", f"{r['solid'].split('/', 1)[1]}#arc", **r)
        if layout == "loop":
            RL = size
            xl = g["bottom"][0] + 0.15
            wx, wy = c.world(xl, g["base"] + RL)
            c.process("mechanics", "loop", role="loop", center={"x": _r(wx), "y": _r(wy)}, radius=_r(RL), entry=_r(-90.0 * D2R + c.a, 6), sense=1)
        P["start_height"] = round(h, 5)
        P["length_used"] = round(g["end"], 5)
        # a solid ball (rolling without slipping) needs to start 2.7 (R − r) above the loop's bottom (more for the energy rolling loses) [SERWAY]
        if layout == "loop":
            P["least_height_marble"] = round(TRACK_T + 2.7 * (size - 0.008), 4)
    register(ItemType("coaster-track", "Roller-coaster track", "Surfaces & ramps", build_coaster, dynamic=False, material="steel",
                      materials=_has("steel", "varnished hardwood", "hollow plastic"), module="mechanics",
                      props=[Prop("layout", "Shape", "loop", kind="choice", choices=["curved ramp", "valley", "hill", "loop"],
                                  help="curved ramp: a drop onto a flat run; valley: a U (a half-pipe); hill: a drop, then a hump; loop: a drop, then a loop-the-loop"),
                             Prop("height", "Start height", 0.6, 0.15, 2.0, 0.01, "m", "Its start platform's height above the floor"),
                             Prop("size", "Loop / hill size", 0.15, 0.04, 0.6, 0.005, "m", "The loop's radius, or the hill's height"),
                             Prop("run", "Run-out", 0.6, 0.1, 3.0, 0.01, "m", "The flat track after it"),
                             Prop("depth", "Channel width", 0.05, 0.02, 0.2, 0.005, "m", "Only for the 3D look")],
                      tags=["roller coaster", "coaster", "loop", "loop the loop", "track", "marble run", "half pipe", "valley", "hill", "energy", "potential energy",
                            "kinetic energy", "curved ramp", "curve"],
                      anchor="the floor under its start (the track runs to the right)",
                      description="A curved track of true arcs (no bumps at its joints): a drop from its start platform, then a flat run, a valley (U), a hill or a "
                                  "loop-the-loop. Potential energy turns into motion and back; a ball needs a start 2.7 times the loop's radius high to go round.",
                      source="A solid ball rolling without slipping needs h ≥ 2.7 (R − r) to loop (energy: m g h = ½ m v² (1 + 2/5), v² ≥ g (R − r) at the top) "
                             "[SERWAY]; the engine rides the true arcs (tooling/src/sim/mechanics.ts ArcTouch).", facts="60 cm drop · 15 cm loop", edit=[]))


# ---------------------------------------------------------------- gears: a train of meshed spur gears on a board
def _gears():
    def build_gears(c, P):
        m = P["module"] / 1000
        teeth = [int(P["teeth_a"]), int(P["teeth_b"])] + ([int(P["teeth_c"])] if int(P["teeth_c"]) > 0 else [])
        radii = [m * n / 2 for n in teeth]
        xs = [0.0]
        for k in range(1, len(radii)):
            xs.append(xs[-1] + radii[k - 1] + radii[k])
        x_mid = (xs[0] + xs[-1]) / 2
        ids = []
        for k, (n, r, x) in enumerate(zip(teeth, radii, xs)):
            name = "abc"[k]
            dens = _r(P["gear_mass"] / ((4 / 3) * math.pi * r * r * r), 3)
            gid = c.ball(f"gear-{name}", r, x - x_mid, 0.0, material=c.mat(base="hollow plastic", density=dens, overrides={}),
                         look="plastic", words=f"a {n}-tooth gear", shape="cylinder", length=0.01, depth3d=0.012, pivot={"x": 0.0, "y": 0.0}, inertia=0.5,
                         **({"motor": {"speed": _r(P["rpm"] * 2 * math.pi / 60 * (1 if P["turns"] == "counter-clockwise" else -1), 5),
                                       "torque": _r(P["torque"], 5)}} if k == 0 and P["rpm"] > 0 else {}))
            ids.append(gid)
        for k in range(1, len(ids)):
            c.process("mechanics", f"mesh-{'abc'[k - 1]}{'abc'[k]}", role="gear", a=ids[k - 1], b=ids[k], na=teeth[k - 1], nb=teeth[k])
        last = len(teeth) - 1
        ratio = teeth[0] / teeth[last]
        P["ratio"] = round(ratio, 5)
        P["last_rpm"] = round(P["rpm"] * ratio, 4)
        P["last_turns"] = ("same way" if last % 2 == 0 else "the other way")
    register(ItemType("gear-train", "Gear train", "Machines & motion", build_gears, dynamic=True, module="mechanics",
                      props=[Prop("teeth_a", "Driver teeth", 12, 6, 80, 1, "", "The gear the motor turns", kind="int"),
                             Prop("teeth_b", "Second gear teeth", 36, 6, 80, 1, "", kind="int"),
                             Prop("teeth_c", "Third gear teeth", 0, 0, 80, 1, "", "0: no third gear", kind="int"),
                             Prop("module", "Tooth size", 4.0, 0.5, 8.0, 0.1, "mm", "The gears' module: a gear's pitch diameter is its teeth × this (4 mm: a 12-tooth gear is 4.8 cm across)"),
                             Prop("rpm", "Motor speed", 30.0, 0.0, 300.0, 1.0, "rpm", "The driver's turning speed; 0: no motor"),
                             Prop("turns", "Motor turns", "counter-clockwise", kind="choice", choices=["counter-clockwise", "clockwise"]),
                             Prop("torque", "Motor torque", 0.5, 0.01, 10.0, 0.01, "N·m", "The most the motor gives"),
                             Prop("gear_mass", "Gear weight", 0.02, 0.002, 1.0, 0.001, "kg", "Each gear's own weight")],
                      tags=["gear", "gears", "gear train", "cog", "speed ratio", "torque", "simple machine", "mesh", "transmission", "rpm", "teeth"],
                      anchor="the middle between its first and last gear's axles",
                      description="Two or three meshed spur gears on axles: the motor turns the driver; each gear turns the next the other way, its speed times "
                                  "(driver teeth ÷ its teeth): a 12-tooth gear turns a 36-tooth one 3 times slower (and 3 times as hard).",
                      source="Meshed gears: n_a ω_a = −n_b ω_b (the pitch circles roll on each other); torque goes the other way round [SERWAY].",
                      facts="12 : 36 teeth · 30 rpm", edit=[]))


# ---------------------------------------------------------------- wheel and axle (a windlass): MA = R / r
def _wheel_axle():
    def build_wa(c, P):
        R, r, ml, me, drop = P["wheel_radius"], P["axle_radius"], P["load"], P["effort"], P["drop"]
        # the wheel and its axle are one turning body (a thin wooden wheel; the axle's own weight is small), pinned to a fixed hub the view stands on a post
        hub = c.ball("hub", 0.006, 0.0, 0.0, kind="static", material=c.mat(base="steel", overrides={}), look="steel", words="the axle's fixed hub",
                     shape="cylinder", length=0.04, depth3d=0.06, stand="post")
        wm = P["wheel_mass"]
        wheel = c.ball("wheel", R, 0.0, 0.0, material=c.mat(base="varnished hardwood", density=_r(wm / ((4 / 3) * math.pi * R * R * R), 3), overrides={}),
                       look="wood", words="the big wheel", shape="cylinder", length=0.02, depth3d=0.02, pivot={"x": 0.0, "y": 0.0}, parent=hub, inertia=0.5)
        c.sb.solids[-1]["at"] = {"x": 0.0, "y": 0.0}           # (a part with a parent stands in its parent's frame: on the hub's centre)
        sz = 0.04
        tall = {}
        for part, m, x in (("effort-mass", me, R), ("load-mass", ml, -r)):
            hb = min(0.3, max(0.012, m / (STEEL * sz * sz)))
            tall[part] = hb
            c.slab(part, sz, hb, sz, x, -drop - hb / 2, material=c.mat(base="steel", density=_r(m / (sz * hb * sz), 3), overrides={}), look="steel",
                   words="the effort weight" if part == "effort-mass" else "the load")
        # the effort's rope comes off the wheel's right side (it unwinds as the effort falls, the wheel turning clockwise); the load's rope off the axle's
        # left side, winding up as the wheel turns clockwise: the load rises R / r times slower than the effort falls, held by R / r times less weight
        c.process("mechanics", "effort-rope", role="spool", drum=wheel, b=c.sid("effort-mass"), center={"x": 0.0, "y": 0.0}, radius=_r(R), sense=1,
                  anchorB={"x": 0.0, "y": _r(tall["effort-mass"] / 2)}, minLength=0.03)
        c.process("mechanics", "load-rope", role="spool", drum=wheel, b=c.sid("load-mass"), center={"x": 0.0, "y": 0.0}, radius=_r(r), sense=-1,
                  anchorB={"x": 0.0, "y": _r(tall["load-mass"] / 2)}, minLength=0.03)
        P["advantage"] = round(R / r, 4)
        P["balance_effort"] = round(ml * r / R, 5)
    register(ItemType("wheel-and-axle", "Wheel and axle", "Machines & motion", build_wa, dynamic=True, module="mechanics",
                      props=[Prop("wheel_radius", "Wheel radius", 0.15, 0.04, 0.4, 0.005, "m"), Prop("axle_radius", "Axle radius", 0.03, 0.01, 0.1, 0.002, "m"),
                             Prop("load", "Load", 1.0, 0.05, 10.0, 0.05, "kg", "Hangs from a rope wound on the axle"),
                             Prop("effort", "Effort weight", 0.25, 0.01, 10.0, 0.01, "kg", "Hangs from a rope wound on the wheel"),
                             Prop("drop", "Ropes below the axle", 0.4, 0.1, 1.5, 0.01, "m"),
                             Prop("wheel_mass", "Wheel weight", 0.2, 0.01, 3.0, 0.01, "kg")],
                      tags=["wheel and axle", "windlass", "winch", "simple machine", "mechanical advantage", "crank", "well", "lift", "torque"],
                      anchor="the wheel's axle",
                      description="A big wheel fixed to a thin axle: an effort weight on a rope round the wheel lifts a heavier load on a rope round the axle. "
                                  "Mechanical advantage R/r: a 15 cm wheel on a 3 cm axle lifts 1 kg with 0.2 kg (just over that to move it).",
                      source="Balance of torques: m_effort·R = m_load·r [SERWAY]; ropes wound on the wheel and the axle (tooling/src/sim/mechanics.ts SpoolRope).",
                      facts="MA 5 · 1 kg load", edit=[]))


# ---------------------------------------------------------------- block and tackle: MA = the strands holding the load
def _tackle():
    def build_tackle(c, P):
        n, ml, me, drop = int(P["strands"]), P["load"], P["effort"], P["drop"]
        steel = c.mat(base="steel", overrides={})
        c.slab("top-block", 0.06, 0.05, 0.04, 0.0, 0.0, kind="static", material=steel, look="steel", words="the fixed upper pulley block", stand="wall")
        # the moving block and the load hang from it as one body (the block's own weight counts with the load)
        bh = 0.05
        lw = 0.05
        lh = min(0.3, max(0.012, ml / (STEEL * lw * lw)))
        c.slab("load", lw, lh, lw, 0.0, -drop - bh - lh / 2, material=c.mat(base="steel", density=_r(ml / (lw * lh * lw), 3), overrides={}), look="steel", words="the load")
        _child(c, "moving-block", c.sid("load"), 0.05, bh, 0.04, 0.0, lh / 2 + bh / 2, c.mat(base="steel", density=_r(0.05 / (0.05 * bh * 0.04), 3), overrides={}),
               "the moving pulley block", "steel")
        ew = 0.03
        eh = min(0.3, max(0.012, me / (STEEL * ew * ew)))
        ex = 0.06
        c.slab("effort-mass", ew, eh, ew, ex, -drop - eh / 2, material=c.mat(base="steel", density=_r(me / (ew * eh * ew), 3), overrides={}), look="steel",
               words="the effort weight")
        # the rope: the effort's free end and n strands holding the moving block: length_effort + n × length_load stays the same (the rope pulls only)
        c.joint("pulley", "rope", a="effort-mass", b="load", groundA=(ex, -0.025), groundB=(0.0, -0.025), anchorA=(0.0, _r(eh / 2)),
                anchorB=(0.0, _r(lh / 2 + bh)), ratio=float(n), render={"draw": "none", "strands": n})
        P["advantage"] = n
        P["balance_effort"] = round((ml + 0.05) / n, 5)
    register(ItemType("block-and-tackle", "Block and tackle", "Machines & motion", build_tackle, dynamic=True, module="mechanics",
                      props=[Prop("strands", "Strands", 2, 2, 4, 1, "", "The rope's strands holding the moving block: its mechanical advantage", kind="int"),
                             Prop("load", "Load", 1.0, 0.05, 10.0, 0.05, "kg"), Prop("effort", "Effort weight", 0.6, 0.01, 10.0, 0.01, "kg"),
                             Prop("drop", "Rope below the top block", 0.5, 0.15, 1.5, 0.01, "m")],
                      tags=["pulley", "pulleys", "block and tackle", "mechanical advantage", "simple machine", "hoist", "crane", "lift", "strands"],
                      anchor="the fixed top block's middle",
                      description="A fixed pulley block above, a moving block below carrying the load: with n rope strands holding it, an effort of 1/n of the "
                                  "load (and the block) holds it up, and the effort moves n times as far as the load rises.",
                      source="Ideal (light, frictionless) sheaves: effort = load / n, distance × n [SERWAY]; the moving block weighs 50 g (provisional).",
                      facts="MA 2 · 1 kg", edit=[]))


# ---------------------------------------------------------------- levers: first, second and third class, weights in balance
def _lever():
    def build_lever(c, P):
        cls = P["class"]
        L = P["length"]
        dl, de = P["load_at"], P["effort_at"]
        ml, me = P["load"], P["effort"]
        wood = c.mat(base="varnished hardwood", overrides={})
        steel = c.mat(base="steel", overrides={})
        th = 0.006
        # the beam: a wooden stick 6 mm thick (a metre stick lying flat), as wide front to back as its weight makes it at 700 kg/m³ (0.12 kg on a metre:
        # 2.9 cm); the fulcrum (a pin on a stand) at the item's anchor; the beam's left end at the fulcrum for classes 2 and 3
        bd = _r(min(0.1, max(0.005, P["beam_mass"] / (700.0 * L * th))), 5)
        fx = 0.0
        bx = 0.0 if cls == "1" else L / 2 - 0.02
        c.slab("beam", L, th, bd, bx, 0.0, material=c.mat(base="varnished hardwood", density=_r(P["beam_mass"] / (L * th * bd), 3), overrides={}),
               look="wood", words="a lever's beam")
        c.slab("fulcrum", 0.03, 0.2, 0.06, fx, -0.11 - th / 2, kind="static", material=wood, look="wood", words="the lever's fulcrum stand")
        # (the pin's friction: a 3 mm steel pin in the beam's hole, μ 0.25 steel on wood (provisional), torque μ·N·r with N the weight it carries:
        # about 3 mN·m for 0.87 kg, so a gram or so off the balance still holds, as a real classroom lever does)
        c.joint("pin", "fulcrum-pin", a=None, b="beam", anchorA=(fx, 0.0), anchorB=(_r(fx - bx), 0.0),
                limits={"lower": -0.35, "upper": 0.35}, damping=0.02, friction=_r(PIN_MU * (P["load"] + P["effort"] + P["beam_mass"]) * 9.81 * PIN_R, 6))
        # where the load and the effort act along the beam (m from the fulcrum, + to the right); class 1: the load on the left, the effort on the right;
        # class 2: the load between the fulcrum and the effort (at the far end); class 3: the effort between the fulcrum and the load
        if cls == "1":
            xl, xe, up = -dl, de, False
        elif cls == "2":
            xl, xe, up = dl, de, True
        else:
            xl, xe, up = dl, de, True
        hang = 0.25
        ls = 0.04
        lh = min(0.3, max(0.012, ml / (STEEL * ls * ls)))
        c.slab("load-mass", ls, lh, ls, xl, -hang - lh / 2, material=c.mat(base="steel", density=_r(ml / (ls * lh * ls), 3), overrides={}), look="steel", words="the load")
        c.joint("rope", "load-cord", a="beam", b="load-mass", anchorA=(_r(xl - bx), _r(-th / 2)), anchorB=(0.0, _r(lh / 2)), length=_r(hang - th / 2), thickness=0.002)
        es = 0.03
        eh = min(0.3, max(0.012, me / (STEEL * es * es)))
        if not up:
            c.slab("effort-mass", es, eh, es, xe, -hang - eh / 2, material=c.mat(base="steel", density=_r(me / (es * eh * es), 3), overrides={}), look="steel",
                   words="the effort weight")
            c.joint("rope", "effort-cord", a="beam", b="effort-mass", anchorA=(_r(xe - bx), _r(-th / 2)), anchorB=(0.0, _r(eh / 2)), length=_r(hang - th / 2), thickness=0.002)
        else:
            # the effort pulls up: a cord from the beam up over a pulley on an arm above, down to the effort weight hanging beside it
            top = 0.35
            c.ball("pulley", 0.02, xe + 0.02, top, kind="static", material=steel, look="steel", words="the pulley over the lever", shape="cylinder", length=0.01,
                   depth3d=0.012, stand="post")
            c.slab("effort-mass", es, eh, es, xe + 0.04, top - 0.2 - eh / 2, material=c.mat(base="steel", density=_r(me / (es * eh * es), 3), overrides={}),
                   look="steel", words="the effort weight")
            c.joint("pulley", "effort-cord", a="beam", b="effort-mass", groundA=(xe, top), groundB=(xe + 0.04, top), anchorA=(_r(xe - bx), _r(th / 2)),
                    anchorB=(0.0, _r(eh / 2)), ratio=1.0, render={"draw": "none"})
        # the turning effects (kg·m) about the fulcrum: the load's, and the beam's own weight's (classes 2 and 3: its middle is off the fulcrum);
        # the effort weight that balances them
        # (in air: the beam's weight less the air it displaces; the steel weights' own lift, 0.015 %, cancels between load and effort)
        beam_turn = 0.0 if cls == "1" else (P["beam_mass"] - 1.2 * L * th * bd) * bx
        P["load_turn"] = round(ml * abs(xl), 5)
        P["beam_turn"] = round(beam_turn, 5)
        P["effort_turn"] = round(me * abs(xe), 5)
        P["balanced_by"] = round((ml * abs(xl) + beam_turn) / max(1e-9, abs(xe)), 5)
    register(ItemType("lever-kit", "Lever", "Machines & motion", build_lever, dynamic=True, module="mechanics",
                      props=[Prop("class", "Class", "1", kind="choice", choices=["1", "2", "3"],
                                  help="1: the fulcrum between load and effort (a seesaw); 2: the load between (a wheelbarrow); 3: the effort between (tweezers)"),
                             Prop("length", "Beam length", 1.0, 0.3, 2.0, 0.01, "m"),
                             Prop("load", "Load", 0.5, 0.01, 10.0, 0.01, "kg"), Prop("load_at", "Load from the fulcrum", 0.2, 0.02, 1.0, 0.005, "m"),
                             Prop("effort", "Effort weight", 0.25, 0.01, 10.0, 0.01, "kg"), Prop("effort_at", "Effort from the fulcrum", 0.4, 0.02, 1.0, 0.005, "m"),
                             Prop("beam_mass", "Beam weight", 0.12, 0.01, 2.0, 0.005, "kg", "A metre stick weighs about 0.12 kg (classes 2 and 3 lift it too)")],
                      tags=["lever", "fulcrum", "simple machine", "first class lever", "second class lever", "third class lever", "balance", "torque",
                            "seesaw", "effort", "load", "mechanical advantage", "moment"],
                      anchor="the fulcrum's pin",
                      description="A beam on a fulcrum with a hanging load and an effort (a weight hanging, or pulling up over a pulley): balanced when "
                                  "load × its distance = effort × its distance. Classes 1, 2 and 3.",
                      source="The law of the lever: m_load·d_load = m_effort·d_effort [SERWAY]; the beam swings on a lightly damped pin, ±20°.",
                      facts="class 1 · 0.5 kg at 20 cm", edit=[]))


# ---------------------------------------------------------------- balloon rocket on a string (action and reaction)
def _balloon():
    def build_balloon(c, P):
        L, D = P["string"], P["diameter"]
        wood = c.mat(base="varnished hardwood", overrides={})
        for part, x in (("post-start", -0.1), ("post-end", L + 0.05)):
            c.slab(part, 0.03, 1.0, 0.03, x, 0.5, kind="static", material=wood, look="wood", words="a post holding the string")
        # the straw and tape riding the string with the balloon's rubber: 5 g; the balloon itself (its air, its size, its jet) is the module's
        straw = c.slab("straw", 0.1, 0.008, 0.008, 0.0, 1.0, material=c.mat(base="hollow plastic", density=_r(P["rubber"] / (0.1 * 0.008 * 0.008), 2), overrides={}),
                       look="plastic", words="a drinking straw on the string")
        a = c.a
        c.process("mechanics", "string", role="slider", a=None, b=straw, anchorA=dict(zip("xy", (_r(v) for v in c.world(0.0, 1.0)))), anchorB={"x": 0.0, "y": 0.0},
                  axis={"x": _r(cos(a), 6), "y": _r(sin(a), 6)}, lower=-0.05, upper=_r(L - 0.15), friction=_r(P["friction"], 4))
        c.process("mechanics", "jet", role="balloon", solid=straw, diameter=_r(D), rest=0.06, pressure=_r(P["pressure"], 2), nozzle=_r(P["nozzle"]),
                  direction=_r(math.pi, 6), at={"x": 0.0, "y": _r(-D / 2 - 0.004)}, cd=0.47)
    register(ItemType("balloon-rocket", "Balloon rocket", "Machines & motion", build_balloon, dynamic=True, module="mechanics",
                      props=[Prop("string", "String length", 4.0, 0.5, 15.0, 0.1, "m"), Prop("diameter", "Balloon size", 0.25, 0.12, 0.4, 0.005, "m", "Blown up"),
                             Prop("pressure", "Pressure inside", 3000.0, 1000.0, 6000.0, 50.0, "Pa", "Over the room's: a party balloon's is about 2-4 kPa"),
                             Prop("nozzle", "Neck", 0.01, 0.004, 0.02, 0.0005, "m", "The open neck's bore: wider, a stronger, shorter push"),
                             Prop("friction", "String friction", 0.015, 0.0, 0.2, 0.001, "N", "The straw rubbing on the string"),
                             Prop("rubber", "Rubber and straw", 0.005, 0.002, 0.03, 0.0005, "kg")],
                      readouts=[Readout("volume", "Air left", "m³", 4), Readout("thrust", "Jet push", "N", 3)],
                      tags=["balloon rocket", "rocket", "action reaction", "newton third law", "thrust", "jet", "balloon", "string", "straw"],
                      anchor="the floor under the string's start (its left end); the string runs 1 m up, to the right, the balloon waiting at its start",
                      description="A blown-up balloon taped to a straw on a taut string: let go, its air rushes out of the neck backward and pushes it forward "
                                  "(Newton's third law) until it is empty, then it coasts.",
                      source="Jet thrust 2·C_c·Δp·A (Bernoulli, contraction 0.62) while the latex holds its pressure (Merritt & Weinhaus, Am. J. Phys. 46, 976 (1978)); "
                             "drag of a sphere (C_d 0.47) on its size now (tooling/src/sim/mechanics.ts).", facts="4 m string · 25 cm balloon", edit=[]))



# ---------------------------------------------------------------- screw jack: an inclined plane wrapped round a rod
# A screw jack's handle turns its screw in a nut in the base: each turn lifts the cap one pitch p while the effort at the handle's end goes round
# 2π·L, so the ideal mechanical advantage is 2π·L / p (a 20 cm handle on a 5 mm thread: 251). Thread friction takes most of the work: a square or
# Acme thread with μ ≈ 0.1-0.2 is about 20-40 % efficient [SHIGLEY] (Shigley's Mechanical Engineering Design, power screws: e = tan λ / tan(λ + φ)),
# which is also why it holds its load when let go (self-locking below 50 %). The cap is driven along its screw at turns × p up to the force
# efficiency × effort × 2π·L / p (a planck prismatic drive, `slider`); a heavier load than that stays where it is.
JACK = dict(bottom=0.14, top=0.07, base=0.12, gap=0.001, cap=0.09, cap_h=0.02, screw=0.024, screw_h=0.13, bar=0.012, foot=0.18)


def _screw_jack():
    def build_jack(c, P):
        J = JACK
        p = P["pitch"] / 1000.0
        L, F, n, eta, ml, lift = P["handle"], P["effort"], P["turns"], P["efficiency"], P["load"], P["lift"]
        steel = c.mat(base="steel", overrides={})
        c.poly("housing", [(-J["bottom"] / 2, 0.0), (J["bottom"] / 2, 0.0), (J["top"] / 2, J["base"]), (-J["top"] / 2, J["base"])], J["bottom"], kind="static",
               material=steel, look="steel", words="the screw jack's cast-iron base (its nut inside)")
        yc = J["base"] + J["gap"] + J["cap_h"] / 2
        cap = c.slab("cap", J["cap"], J["cap_h"], J["cap"], 0.0, yc, material=steel, look="steel", words="the screw jack's lifting cap")
        # its screw, running down into the base's nut, and the tommy bar through its head: welded to the cap, touching nothing (ghosts)
        for part, w, h, d, dy, words in (("screw", J["screw"], J["screw_h"], J["screw"], -J["cap_h"] / 2 - J["screw_h"] / 2, "the jack's threaded screw"),
                                         ("bar", 2 * L, J["bar"], J["bar"], J["cap_h"] / 2 - J["bar"] / 2 - 0.004, "the jack's handle (a tommy bar)")):
            _child(c, part, cap, w, h, d, 0.0, dy, steel, words, "steel")
            c.sb.solids[-1]["ghost"] = True
        # the load: a steel block 18 x 18 cm as tall as its weight makes it (at least 1 cm, then its density made up to weigh exactly that)
        if ml > 0:
            fw = J["foot"]
            hl = min(0.8, max(0.01, _r(ml / (STEEL * fw * fw), 5)))
            c.slab("load", fw, hl, fw, 0.0, yc + J["cap_h"] / 2 + 0.001 + hl / 2, material=c.mat(base="steel", density=_r(ml / (fw * hl * fw), 3), overrides={}),
                   look="steel", words=f"a {ml:g} kg steel load")
        ma = 2 * math.pi * L / p
        force = eta * F * ma
        # (along the jack's own up, at turns × pitch while the effort can lift what rides on it; it never runs back down: the stroke's foot, then the screw
        # holding what it carries when it is not turning, as a self-locking thread does)
        c.process("mechanics", "screw", role="slider", a=None, b=cap, anchorA=dict(zip("xy", (_r(v) for v in c.world(0.0, yc)))), anchorB={"x": 0.0, "y": 0.0},
                  axis={"x": _r(0.0 - sin(c.a), 6), "y": _r(cos(c.a), 6)}, lower=0.0, upper=_r(lift), speed=_r(n * p, 6), force=_r(force, 3), friction=_r(force, 3))
        c.process("mechanics", "lift", role="meter", reads="rise", solid=cap, key="lift")
        moving = STEEL * (J["cap"] * J["cap_h"] * J["cap"] + J["screw"] * J["screw_h"] * J["screw"] + 2 * L * J["bar"] * J["bar"])
        P["advantage"] = round(ma, 3)
        P["lift_force"] = round(force, 3)
        P["moving_mass"] = round(moving, 4)
        P["lifts"] = force > (ml + moving) * 9.81
    register(ItemType("screw-jack", "Screw jack", "Machines & motion", build_jack, dynamic=True, module="mechanics",
                      props=[Prop("load", "Load", 20.0, 0.0, 300.0, 0.5, "kg", "A steel load on its cap"),
                             Prop("effort", "Push on the handle", 10.0, 0.5, 200.0, 0.5, "N", "The push at the handle's end as it is turned"),
                             Prop("handle", "Handle length", 0.2, 0.05, 0.5, 0.01, "m", "From the screw to where it is pushed: a longer handle, more force"),
                             Prop("pitch", "Thread pitch", 5.0, 1.0, 12.0, 0.5, "mm", "How far one turn lifts it: a finer thread lifts more, more slowly"),
                             Prop("turns", "Turns a second", 1.0, 0.1, 4.0, 0.1, "turns/s", "How fast the handle goes round"),
                             Prop("efficiency", "Efficiency", 0.3, 0.1, 0.9, 0.01, "", "The share of the work that lifts (thread friction takes the rest: 0.2-0.4 for most jacks)"),
                             Prop("lift", "Stroke", 0.05, 0.01, 0.3, 0.005, "m", "How far the cap can rise")],
                      readouts=[Readout("lift", "Lifted", "m", 4, "How far its cap (and the load on it) has risen")],
                      tags=["screw", "screw jack", "car jack", "jack", "simple machine", "inclined plane", "thread", "pitch", "lift", "mechanical advantage",
                            "lever", "wedge"],
                      anchor="the middle of its base, on the floor",
                      description="A screw jack: turning its handle drives a screw up through the nut in its base, lifting a heavy load on its cap a pitch a "
                                  "turn. A 10 N push on a 20 cm handle with a 5 mm thread lifts about 75 kg (ideal advantage 2π·L / pitch = 251, about 30 % "
                                  "efficient), but only 5 mm a turn: force traded for distance.",
                      source="Power screws [SHIGLEY]: ideal advantage 2π·L/p, efficiency tan λ / tan(λ + φ), 0.2-0.4 for square and Acme threads (μ 0.1-0.2), "
                             "self-locking under 0.5.", facts="MA 251 · 30 % · 5 mm a turn", edit=[]))


# ---------------------------------------------------------------- fragile things (an egg)
# N/m and N: an egg's point-impact stiffness and the static force that cracks it (25-50 N [EGG]). PROVISIONAL calibration (spec mechanics.md):
# the plate-to-plate static stiffness of a shell (100-150 N/mm [EGG]) overstates a point strike; 1.5e4 N/m puts the crack height onto a rigid
# floor at about 7 cm (commonly reported: a few cm to about 10 cm)
EGG = dict(k=1.5e4, force=35.0)
PIN_MU, PIN_R = 0.25, 0.0015   # a lever's pivot: steel pin on wood (friction, provisional) and the pin's radius (m)
# soft surfaces: their crush stiffness E·A/t over a 2 x 2 cm patch, E in Pa (open-cell foam 30-100 kPa; a pillow far softer; a sponge; a rubber mat 1-5 MPa)
SOFT = {"foam": 5e4, "sponge": 1e5, "pillow": 1e4, "rubber mat": 2e6, "carpet": 5e5, "trampoline mat": 2e5, "felt": 3e5}


def _fragile(sb, scene):
    for item in scene.get("items", []):
        if not isinstance(item, dict) or item.get("type") != "egg" or (item.get("props") or {}).get("fragile") is not True:
            continue
        root = next((s for s in sb.solids if s["id"] == f"{item['id']}/egg"), None)
        if root is None:
            continue
        sb.processes.append({"kind": "mechanics", "id": f"{item['id']}/shell", "item": item["id"], "role": "fragile", "solid": root["id"],
                             "stiffness": EGG["k"], "force": EGG["force"], "soft": dict(SOFT)})


# ---------------------------------------------------------------- goal kinds (web/sim/modules/mechanics.js has the same, number for number)
# ---------------------------------------------------------------- energy bars: a board showing a moving thing's energy as the run plays
def _energy_board():
    def build_board(c, P):
        w, h = P["width"], P["height"]
        # a display only: a static ghost (it touches nothing), its own stand drawn by the model
        c.slab("board", w, h, 0.02, 0.0, h / 2, kind="static", material=c.mat(base="hollow plastic", overrides={}), look="office paper",
               words="a white board of energy bars on a stand", ghost=True, stand="self")
    register(ItemType("energy-bars", "Energy bars", "Machines & motion", build_board, dynamic=False, module="mechanics",
                      props=[Prop("width", "Width", 0.6, 0.3, 2.0, 0.05, "m"), Prop("height", "Height", 0.5, 0.25, 1.5, 0.05, "m"),
                             Prop("zero", "Height from", "lowest", kind="choice", choices=["lowest", "floor"],
                                  help="lowest: potential energy counted from the lowest point it reaches in the run (a swing's bottom); floor: from the floor")],
                      links=[Link("watch", "Shows", help="The moving thing whose energy it shows (a pendulum's bob, a ball on a track, a car on a ramp)")],
                      tags=["energy", "energy bars", "kinetic energy", "potential energy", "conservation of energy", "energy transfer", "heat",
                            "bar chart", "pendulum", "roller coaster"],
                      anchor="the middle of its bottom edge",
                      description="A board standing behind the scene with bars of the linked moving thing's energy as the run plays: kinetic (½mv²), "
                                  "potential (mgh), spring (½kx²) and what has turned to heat and sound, their total the start's: energy changes "
                                  "form, the total stays. Drawn only.",
                      source="From the engine's bookkeeping (tooling/src/sim/mechanics.ts `energy`: start + added = kinetic + potential + spring + heat).",
                      facts="KE · PE · heat"))


def _pl(ctx, k, sid):
    """A solid's placement at frame k (a static one is listed only in the first frame)."""
    p = ctx.frames[k]["placements"].get(sid)
    return p if p is not None else ctx.frames[0]["placements"].get(sid)


def _main(ctx, iid, part=None):
    """The solid a goal about item iid follows: its part `part` when it has one, else its first moving solid that no weld holds (its main body)."""
    if isinstance(part, str) and part:
        s = next((x for x in ctx.doc["solids"] if x["id"] == f"{iid}/{part}"), None)
        if s is not None:
            return s
    return next((x for x in ctx.doc["solids"] if x["item"] == iid and x["kind"] == "dynamic" and not ("parent" in x and "pivot" not in x)), None)


def _label(g, text):
    return g.get("label") or text


def goal_balanced(ctx, g):
    """{kind: "balanced", item, part?, max_deg?, max_m?}: its main moving part (a lever's beam, a tug-of-war's cart, a wheel and axle's wheel, a
    block and tackle's load) moves less than max_m (1 cm) and turns less than max_deg (2°) all through the run: the forces on it balance."""
    if not ctx.known(g.get("item")):
        return None
    s = _main(ctx, g["item"], g.get("part"))
    if s is None or _pl(ctx, 0, s["id"]) is None:
        return None
    max_deg = ctx.num(g.get("max_deg"))
    max_deg = 2.0 if max_deg is None else max_deg
    max_m = ctx.num(g.get("max_m"))
    max_m = 0.01 if max_m is None else max_m
    p0 = _pl(ctx, 0, s["id"])
    moved = turned = 0.0
    for k in range(len(ctx.frames)):
        p = _pl(ctx, k, s["id"])
        moved = max(moved, math.hypot(p["x"] - p0["x"], p["y"] - p0["y"]))
        turned = max(turned, abs(p["angle"] - p0["angle"]))
    deg = turned * 180 / math.pi
    return {"label": _label(g, f"{ctx.name(g['item'])} stays balanced"), "ok": moved <= max_m and deg <= max_deg, "kind": "balanced", "item": g["item"],
            "moved_m": round(moved, 4), "turned_deg": round(deg, 2)}


def goal_loops(ctx, g):
    """{kind: "loops", item, track}: the item (a ball, a car) goes all the way round the coaster track's loop, on the track all through its top half
    (never 20 % of the loop's radius inside the track there: a ball that leaves the track and drops back onto it lower down has fallen off)."""
    if not (ctx.known(g.get("item")) and ctx.known(g.get("track"))):
        return None
    loop = next((p for p in ctx.doc.get("processes", []) if p.get("kind") == "mechanics" and p.get("role") == "loop" and p.get("item") == g["track"]), None)
    s = _main(ctx, g["item"])
    if loop is None or s is None:
        return None
    cx, cy, R, entry, sense = loop["center"]["x"], loop["center"]["y"], loop["radius"], loop["entry"], loop["sense"]
    r = s["body"]["radius"] if s["body"]["kind"] == "ball" else 0.0
    prog = last = None
    best = 0.0
    fell = False
    for k in range(len(ctx.frames)):
        p = _pl(ctx, k, s["id"])
        dx, dy = p["x"] - cx, p["y"] - cy
        d = math.hypot(dx, dy)
        if prog is None and d > 1.6 * R + 0.2:
            continue
        a = sense * (math.atan2(dy, dx) - entry)
        while a > math.pi:
            a -= 2 * math.pi
        while a <= -math.pi:
            a += 2 * math.pi
        if prog is None:
            prog = a if (a <= 0 or d <= R) else a + 2 * math.pi
        else:
            da = a - last
            while da > math.pi:
                da -= 2 * math.pi
            while da <= -math.pi:
                da += 2 * math.pi
            prog += da
        last = a
        if prog >= 0.0:
            # (a frame past the full turn counts as the full turn: a fast ball covers 0.2 rad between frames)
            best = max(best, min(prog, 2 * math.pi))
            if 0.5 * math.pi <= prog <= 1.5 * math.pi and d < 0.8 * (R - r):
                fell = True
    ok = best >= 2 * math.pi - 0.2 and not fell
    return {"label": _label(g, f"{ctx.name(g['item'])} goes round the loop"), "ok": ok, "kind": "loops", "item": g["item"], "track": g["track"],
            "round_deg": round(best * 180 / math.pi, 1), "fell_off": fell}


def _turn_part(ctx, iid):
    """The part a turning goal follows by default: a gear train's last gear, else the item's main body."""
    for part in ("gear-c", "gear-b", "wheel", "drum"):
        if any(x["id"] == f"{iid}/{part}" for x in ctx.doc["solids"]):
            return part
    return None


def goal_gear_speed(ctx, g):
    """{kind: "gear_speed", item, part?, rpm?, tol?, direction?}: its part (a gear train's last gear by default) turns, over the second half of the run,
    at rpm (within tol, 10 %) and/or the given way round ("clockwise" or "counter-clockwise")."""
    if not ctx.known(g.get("item")):
        return None
    s = _main(ctx, g["item"], g.get("part") or _turn_part(ctx, g["item"]))
    n = len(ctx.frames)
    if s is None or n < 3:
        return None
    k0 = n // 2
    dt = ctx.times[n - 1] - ctx.times[k0]
    if dt <= 0:
        return None
    rpm = (_pl(ctx, n - 1, s["id"])["angle"] - _pl(ctx, k0, s["id"])["angle"]) / dt * 60 / (2 * math.pi)
    target = ctx.num(g.get("rpm"))
    tol = ctx.num(g.get("tol"))
    tol = 0.1 if tol is None else tol
    way = g.get("direction") if g.get("direction") in ("clockwise", "counter-clockwise") else None
    ok = abs(rpm) > 0.5
    if target is not None:
        ok = ok and abs(abs(rpm) - abs(target)) <= tol * abs(target)
    if way == "clockwise":
        ok = ok and rpm < 0
    elif way == "counter-clockwise":
        ok = ok and rpm > 0
    what = f" at {f'{target:.1f}'.rstrip('0').rstrip('.')} rpm" if target is not None else ""
    return {"label": _label(g, f"{ctx.name(g['item'])} turns{what}{' ' + way if way else ''}"), "ok": ok, "kind": "gear_speed", "item": g["item"],
            "rpm": round(rpm, 2)}


def goal_rises(ctx, g):
    """{kind: "rises", item, part?, min_m?}: its load (a wheel and axle's, a block and tackle's, a lever's, a screw jack's; or the given part) ends at least
    min_m (5 cm; a screw jack's 1 cm, as it lifts a pitch a turn) higher than it started."""
    if not ctx.known(g.get("item")):
        return None
    part = g.get("part")
    if not part:
        part = next((q for q in ("load", "load-mass") if any(x["id"] == f"{g['item']}/{q}" for x in ctx.doc["solids"])), None)
    s = _main(ctx, g["item"], part)
    if s is None:
        return None
    least = ctx.num(g.get("min_m"))
    least = (0.01 if ctx.items[g["item"]].get("type") == "screw-jack" else 0.05) if least is None else least
    rise = _pl(ctx, len(ctx.frames) - 1, s["id"])["y"] - _pl(ctx, 0, s["id"])["y"]
    return {"label": _label(g, f"{ctx.name(g['item'])} lifts its load {ctx.short_m(least)}"), "ok": rise >= least, "kind": "rises", "item": g["item"],
            "rise_m": round(rise, 4)}


def goal_pulls_with(ctx, g):
    """{kind: "pulls_with", item, newtons, tol?}: a force meter's steady reading (a puller's cord, an edge pulley's string: their `newtons`) is newtons
    within tol (5 %, at least 0.05 N): the median of its readings from 0.2 s after the release to the end, leaving out the frames where it reads under
    a tenth of its highest (a slack cord) — what a student reads off the meter while it pulls."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    want = ctx.num(g.get("newtons"))
    vals = ctx.state(iid, "newtons")
    if want is None or not vals:
        return None
    rel = ctx.doc.get("release", {}).get("at", 0.5)
    xs = [v for k, v in enumerate(vals) if k < len(ctx.times) and ctx.times[k] >= rel + 0.2]
    top = max(xs, default=0.0)
    xs = sorted(v for v in xs if v >= 0.1 * top and v > 0)
    got = None if not xs else (xs[len(xs) // 2] if len(xs) % 2 == 1 else (xs[len(xs) // 2 - 1] + xs[len(xs) // 2]) / 2)
    tol = ctx.num(g.get("tol"))
    tol = max(0.05, 0.05 * abs(want)) if tol is None else tol
    shown = f"{want:.2f}".rstrip("0").rstrip(".")
    return {"label": _label(g, f"{ctx.name(iid)} pulls with {shown} N"), "ok": got is not None and abs(got - want) <= tol + 1e-9, "kind": "pulls_with",
            "item": iid, "newtons_read": None if got is None else round(got, 4)}


def _speed_x(ctx, sid, t1, t2):
    """The mean x velocity of a solid between the frames nearest t1 and t2, m/s."""
    k1 = min(range(len(ctx.times)), key=lambda i: abs(ctx.times[i] - t1))
    k2 = min(range(len(ctx.times)), key=lambda i: abs(ctx.times[i] - t2))
    dt = ctx.times[k2] - ctx.times[k1]
    return 0.0 if dt <= 0 else (_pl(ctx, k2, sid)["x"] - _pl(ctx, k1, sid)["x"]) / dt


def goal_recoils(ctx, g):
    """{kind: "recoils", a, b, ratio?, tol?}: just after the push (their mean x speeds 0.15-0.35 s after the release) the two (carts) move off in
    opposite directions, each at 2 cm/s or more; with ratio, a's speed over b's then is ratio within tol (10 %): equal and opposite pushes,
    speeds in the inverse ratio of the masses. (What they meet later, a wall or a track's end, does not count; both must start at rest: an item
    given a start speed fails it.)"""
    if not (ctx.known(g.get("a")) and ctx.known(g.get("b"))):
        return None
    A, B = _main(ctx, g["a"]), _main(ctx, g["b"])
    if A is None or B is None:
        return None
    rel = ctx.doc.get("release", {}).get("at", 0.5)
    va, vb = _speed_x(ctx, A["id"], rel + 0.15, rel + 0.35), _speed_x(ctx, B["id"], rel + 0.15, rel + 0.35)
    # (a push apart starts from rest: neither is given a start speed, or the speeds say nothing about the push)
    rest = not any(p.get("kind") == "mechanics" and p.get("role") == "start" and p.get("item") in (g["a"], g["b"]) for p in ctx.doc.get("processes", []))
    ok = rest and va * vb < 0 and abs(va) >= 0.02 and abs(vb) >= 0.02
    ratio = abs(va) / abs(vb) if abs(vb) > 1e-9 else None
    want = ctx.num(g.get("ratio"))
    tol = ctx.num(g.get("tol"))
    tol = 0.1 if tol is None else tol
    if want is not None:
        ok = ok and ratio is not None and abs(ratio - want) <= tol * want
    return {"label": _label(g, f"{ctx.name(g['a'])} and {ctx.name(g['b'])} push apart"), "ok": ok, "kind": "recoils", "a": g["a"], "b": g["b"],
            "speed_a": round(va, 4), "speed_b": round(vb, 4), "ratio": None if ratio is None else round(ratio, 3), "from_rest": rest}


def goal_accelerates(ctx, g):
    """{kind: "accelerates", item, accel, tol?}: its main body speeds up at accel m/s² (a goal's "a" names an item in plans) (within tol, 10 %): x(t) fitted as v0·τ + ½·a·τ² along its motion, from
    the release until it has stopped speeding up, struck something or 1.5 s have passed (F = ma)."""
    if not ctx.known(g.get("item")):
        return None
    s = _main(ctx, g["item"])
    want = ctx.num(g.get("accel"))
    if s is None or want is None:
        return None
    rel = ctx.doc.get("release", {}).get("at", 0.5)
    mine = {x["id"] for x in ctx.doc["solids"] if x["item"] == g["item"]}
    hit = min((h["t"] for h in ctx.track.get("impacts", []) if (h["a"] in mine) != (h["b"] in mine) and h["t"] > rel + 0.05), default=None)
    end = rel + 1.5 if hit is None else min(rel + 1.5, hit - 0.02)
    ks = [k for k in range(len(ctx.times)) if rel + 0.02 <= ctx.times[k] <= end]
    if len(ks) < 4:
        return None
    p0 = _pl(ctx, ks[0], s["id"])
    pe = _pl(ctx, ks[-1], s["id"])
    L = math.hypot(pe["x"] - p0["x"], pe["y"] - p0["y"])
    ux, uy = ((pe["x"] - p0["x"]) / L, (pe["y"] - p0["y"]) / L) if L > 0 else (1.0, 0.0)
    # least squares of d = v0·τ + (a/2)·τ² (through the first point)
    s11 = s12 = s22 = r1 = r2 = 0.0
    for k in ks:
        p = _pl(ctx, k, s["id"])
        tau = ctx.times[k] - ctx.times[ks[0]]
        dd = (p["x"] - p0["x"]) * ux + (p["y"] - p0["y"]) * uy
        f1, f2 = tau, 0.5 * tau * tau
        s11 += f1 * f1
        s12 += f1 * f2
        s22 += f2 * f2
        r1 += f1 * dd
        r2 += f2 * dd
    det = s11 * s22 - s12 * s12
    a = 0.0 if det == 0 else (s11 * r2 - s12 * r1) / det
    tol = ctx.num(g.get("tol"))
    tol = 0.1 if tol is None else tol
    shown = f"{want:.2f}".rstrip("0").rstrip(".")
    return {"label": _label(g, f"{ctx.name(g['item'])} speeds up at {shown} m/s²"), "ok": abs(a - want) <= tol * abs(want), "kind": "accelerates",
            "item": g["item"], "a_mps2": round(a, 4)}



def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    return None if n == 0 else (xs[n // 2] if n % 2 == 1 else (xs[n // 2 - 1] + xs[n // 2]) / 2)


def _fmt_n(v):
    t = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if t in ("", "-0") else t


def goal_net_force(ctx, g):
    """{kind: "net_force", item, at_most_n?, at_least_n?}: the net force on it (the sum of every push and pull on it from outside: its force
    arrows' net), the median of its size from 0.1 s after the release to the end, is at most at_most_n (with neither given: 2 % of its weight +
    0.01 N, its forces balance) and at least at_least_n."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    xs, ys, gy = ctx.state(iid, "f_net_x"), ctx.state(iid, "f_net_y"), ctx.state(iid, "f_gravity_y") or []
    if not xs or not ys:
        return None
    rel = ctx.doc.get("release", {}).get("at", 0.5)
    ks = [k for k in range(min(len(xs), len(ys), len(ctx.times))) if ctx.times[k] >= rel + 0.1]
    net = _median([math.hypot(xs[k], ys[k]) for k in ks])
    if net is None:
        return None
    weight = _median([abs(gy[k]) for k in ks if k < len(gy)]) or 0.0
    hi, lo = ctx.num(g.get("at_most_n")), ctx.num(g.get("at_least_n"))
    balanced = hi is None and lo is None
    if balanced:
        hi = 0.02 * weight + 0.01
    ok = (hi is None or net <= hi + 1e-9) and (lo is None or net >= lo - 1e-9)
    if balanced:
        text = f"the forces on {ctx.name(iid)} balance"
    elif lo is None:
        text = f"the net force on {ctx.name(iid)} is at most {_fmt_n(hi)} N"
    elif hi is None:
        text = f"the net force on {ctx.name(iid)} is at least {_fmt_n(lo)} N"
    else:
        text = f"the net force on {ctx.name(iid)} is {_fmt_n(lo)} to {_fmt_n(hi)} N"
    return {"label": _label(g, text), "ok": ok, "kind": "net_force", "item": iid, "net_n": round(net, 4), "weight_n": round(weight, 4)}


def _energy_spent(ctx, iid):
    """What an item's energy bars say at the end: (the share of the energy it had to spend that has turned to heat and sound, the heat J,
    the energy it had to spend J), or None. To spend: its start total and what was put in, less its potential energy at the lowest it went."""
    ke, pe, se = ctx.state(iid, "e_kinetic"), ctx.state(iid, "e_potential"), ctx.state(iid, "e_spring")
    heat, added = ctx.state(iid, "e_heat"), ctx.state(iid, "e_added")
    if not (ke and pe and se and heat and added):
        return None
    total = ke[-1] + pe[-1] + se[-1] + heat[-1]
    spend = total - min(pe)
    if not spend > 1e-9:
        return None
    return heat[-1] / spend, heat[-1], spend


def goal_energy_kept(ctx, g):
    """{kind: "energy_kept", item, tol?}: by the end at most tol (5 %) of the energy it had to spend (its start's kinetic, potential above the
    lowest it went, and spring energy, and anything put in) has turned to heat and sound: its energy only changed form (a pendulum in a vacuum,
    a ball on a smooth track)."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    e = _energy_spent(ctx, iid)
    if e is None:
        return None
    tol = ctx.num(g.get("tol"))
    tol = 0.05 if tol is None else tol
    return {"label": _label(g, f"{ctx.name(iid)} keeps its energy"), "ok": e[0] <= tol + 1e-12, "kind": "energy_kept", "item": iid,
            "lost_pct": round(100 * e[0], 3), "heat_j": round(e[1], 5)}


def goal_energy_to_heat(ctx, g):
    """{kind: "energy_to_heat", item, at_least_pct?}: by the end at least at_least_pct (10 %) of the energy it had to spend has turned to heat and
    sound (friction, bumps, the air: a ball rolling to a stop on carpet, a bounce that dies away)."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    e = _energy_spent(ctx, iid)
    if e is None:
        return None
    want = ctx.num(g.get("at_least_pct"))
    want = 10.0 if want is None else want
    return {"label": _label(g, f"{ctx.name(iid)}'s energy turns to heat and sound"), "ok": 100 * e[0] >= want - 1e-9, "kind": "energy_to_heat",
            "item": iid, "lost_pct": round(100 * e[0], 3), "heat_j": round(e[1], 5)}
