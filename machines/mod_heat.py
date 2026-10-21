"""The heat module: temperatures, heat flow and changes of state (melting, freezing, boiling, evaporation, dew), with salt on ice, plates and
bowls, a desk lamp, a hot plate, thermometers, pots and cups of water, spoons, rods and meltable dabs, and the scene's time-lapse.

items.py imports this file (machines/mod_<name>.py) after the catalog files and calls register_all(globals()); web/sim/modules/heat.js is its
exact JavaScript port (the same documents, number for number). The engine side is tooling/src/sim/modules/heat.ts (the process kind "heat")
with the physics in tooling/src/sim/heat.ts and the numbers (materials' conductivity, heat capacity, emissivity, absorptivity; water, ice,
salt water, moist air) in tooling/src/sim/heat-data.ts, each with its source.

Also: friction's work and impacts warm what rubs or strikes (a sanding block, a dropped weight: honest, small sizes); a lit candle (the everyday
candle's `lit`) burns 0.1 g of wax a minute, heats what is over it by its plume and goes out under a jar when its oxygen runs low; light the
optics module traces (lenses, mirrors, clear glass) heats what absorbs it (a magnifying glass scorches paper); hot and cold liquid that flow's
pitchers pour mixes heat for heat; oil, honey and alcohol warm by their own heat capacity; a bowl can hold water or dry sand; a ball-and-ring and
a bimetal strip show solids expanding.

Heat is ON in a scene that holds a heat item (salt pile, plate, bowl, lamp, thermometer, hot plate, pot, cup of water, spoon, dab, puddle) or
sets a room temperature or time-lapse other than the standard ones; then every moving thing has a temperature (ice cubes melt, a steel or
wooden rod conducts along its length, water in a fluids container has one) through this module's build hook. A scene with none of that builds
the very document it did before (no "heat" record: the engine runs no heat at all).

Sources:
  [CRC] CRC Handbook of Chemistry and Physics, 97th ed.: ice 333.55 kJ/kg; NaCl solubility 35.9 g/100 g at 25 °C; salt water's freezing points.
  [USDA] USDA FoodData Central: table salt 1 tsp (4.93 mL) = 6 g, so a loose pile is about 1.22 g/mL.
  [FDA] U.S. FDA / USDA: home freezers at −18 °C (0 °F).
  [INC] Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, 6th ed., Tables A.1/A.3 (conductivities), A.11/A.12 (emissivity, absorptivity).
  [IES] IES Lighting Handbook: a 60 W incandescent lamp gives about 80 % of its power as light and infrared (7.5 % light, 73 % infrared); [DOE]
        an LED lamp gives about 35 % (its light; its heat goes to its heat sink).
  [ASHRAE] ASHRAE Handbook — HVAC Applications, ch. 6: Carrier's evaporation equation (used to check the engine's evaporation).
  Table salt's angle of repose 32-35° (33° used); a coarse (kosher) salt pile about 1.0 g/mL and dissolving about 3 times slower (provisional).
  Sizes: a dinner plate 27 cm (10.5 in), stoneware about 5 mm; a cereal bowl 15 cm × 6.5 cm; a desk lamp's shade 13 cm; a lab hot plate's top
  18 × 18 cm; a glass lab thermometer 30 cm × 7 mm, 15 g; a teaspoon 15 cm (stainless 25 g, aluminium 9 g); a wooden spoon 25-30 cm.
  [NIST-CANDLE] Hamins, Bundy & Dillon, J. Fire Prot. Eng. 15, 265 (2005): a candle about 80 W, 0.1 g of wax a minute (heat-data.ts CANDLE).
  [CRC] linear expansion: brass 19e-6/K, steel 12e-6/K (heat-data.ts EXPANSION); Timoshenko, J. Opt. Soc. Am. 11, 233 (1925): a bimetal's bend.
  A ball-and-ring set: a 25.4 mm (1 in) brass ball and a steel ring it just passes cold (a 0.05 mm clearance: provisional); a 1 L glass jar about
  10 cm across, 13 cm tall, 400 g (provisional); a hand sanding block of pine 8 × 2.5 × 5 cm (50 g) with sandpaper under it.
"""
import math

from crmath import cos, sin  # noqa: F401  (the same bits as web/sim's port on any machine)

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "MATERIALS", "add_look", "LOOK_FILL", "LOOK_SHADE", "D2R", "register_goal_kind",
          "register_build_hook", "TYPES", "polygon_problem", "CATEGORIES", "props_of", "register_common_prop", "COMMON_PROPS")

MODULE = "heat"
CAT = "Heat & temperature"


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CAT not in CATEGORIES:
        CATEGORIES.append(CAT)
    _looks()
    _materials()
    _extend()
    _salt()
    _dishes()
    _lamp()
    _thermometer()
    _hot_plate()
    _vessels()
    _spoon()
    _meltable()
    _puddle()
    _sander()
    _jar()
    _ball_ring()
    _bimetal()
    register_build_hook(heat_hook)
    for kind, fn in GOALS:
        register_goal_kind(kind, fn)


# ---------------------------------------------------------------- looks and materials
def _looks():
    add_look("salt", fill="#f4f4f0", shade="#cfcfc8", roughness=0.9, metalness=0.0, clearcoat=0.0)
    add_look("glazed", fill="#f2f0ea", shade="#cdc9bf", roughness=0.18, metalness=0.0, clearcoat=0.9)
    add_look("melamine", fill="#f0eee8", shade="#c9c5bb", roughness=0.3, metalness=0.0, clearcoat=0.5)
    add_look("paperboard", fill="#f3efe6", shade="#cbc4b5", roughness=0.8, metalness=0.0, clearcoat=0.0)
    add_look("stainless", fill="#c3c8cc", shade="#8c9297", roughness=0.18, metalness=1.0, clearcoat=0.0)
    add_look("enamel", fill="#2b2d30", shade="#16171a", roughness=0.35, metalness=0.2, clearcoat=0.3)
    add_look("chocolate", fill="#5a3420", shade="#3c2214", roughness=0.4, metalness=0.0, clearcoat=0.3)
    add_look("butter", fill="#f3dc7e", shade="#d6bd5c", roughness=0.45, metalness=0.0, clearcoat=0.2)
    add_look("thermometer glass", fill="#e8f0f2", shade="#b9c9cc", roughness=0.05, metalness=0.0, clearcoat=1.0, transmission=0.85, ior=1.5, thickness=0.004)
    add_look("jar glass", fill="#e6f1f2", shade="#b6c8cb", roughness=0.04, metalness=0.0, clearcoat=1.0, transmission=0.9, ior=1.5, thickness=0.003)


def _mat(key, **kw):
    kw.setdefault("rolling", 0.0)
    kw.setdefault("side", 0.0)
    if key not in MATERIALS:
        MATERIALS[key] = kw


def _materials():
    _mat("table salt", density=1217.0, bounce=0.05, friction=0.6, rolling=0.1, look="salt",
         source="A loose pile of table salt: 6 g a level teaspoon (4.93 mL) [USDA], about 1.22 g/mL; NaCl crystals 2.165 g/cm³ [CRC]. Barely bounces (provisional).")
    _mat("stainless steel", density=8000.0, bounce=0.9, friction=0.4, rolling=0.001, side=0.1, look="stainless",
         source="Stainless steel AISI 304: 8000 kg/m³ [INC Table A.1]; it conducts heat about 4 times worse than plain steel (16 W/(m·K) against 60).")
    _mat("copper", density=8933.0, bounce=0.8, friction=0.4, rolling=0.001, look="copper",
         source="Copper 8933 kg/m³, the best ordinary conductor of heat: 401 W/(m·K) [INC Table A.1]. Bounce provisional.")
    _mat("melamine", density=1500.0, bounce=0.6, friction=0.4, rolling=0.01, look="melamine",
         source="Melamine resin (plastic plates and bowls) about 1500 kg/m³; a poor conductor, 0.3-0.4 W/(m·K) (provisional).")
    _mat("paperboard", density=700.0, bounce=0.2, friction=0.5, rolling=0.02, look="paperboard",
         source="Paper plates and cups: paperboard about 700 kg/m³; a poor conductor (0.05-0.1 W/(m·K)) [INC Table A.3]. Bounce provisional.")
    _mat("vacuum flask", density=2000.0, bounce=0.5, friction=0.4, rolling=0.005, look="stainless",
         source="A vacuum flask's double wall (stainless steel round a vacuum), as one wall: its weight is set by the item; its heat flow by the "
                "engine's effective conductivity (a 0.5 L flask keeps 95 °C water above 75 °C for 6 h).")
    _mat("chocolate", density=1300.0, bounce=0.1, friction=0.6, rolling=0.05, look="chocolate",
         source="Milk chocolate about 1.3 g/cm³; melts at about 34 °C (cocoa butter form V) taking about 45 kJ/kg for the bar (Beckett, Industrial Chocolate Manufacture and Use).")
    _mat("butter", density=911.0, bounce=0.05, friction=0.8, rolling=0.1, look="butter",
         source="Butter 911 kg/m³; melts between 32 and 35 °C (its milk fat), about 70 kJ/kg (provisional).")
    _mat("puddle water", density=998.0, bounce=0.05, friction=0.1, rolling=0.0, look="water",
         source="Water 998 kg/m³ at 20 °C; a puddle about 1.5 mm deep (it spreads until surface tension holds it).")
    _mat("dry sand", density=1600.0, bounce=0.02, friction=0.6, rolling=0.2, look="sand" if "sand" in LOOK_FILL else "salt",
         source="Dry sand poured loose: about 1600 kg/m³ (quartz 2650 with about 40 % pores); c 830 J/(kg·K) [CRC], k 0.27 W/(m·K) [INC Table A.3].")


# ---------------------------------------------------------------- small helpers (web/sim/modules/heat.js does the same, step for step)
def _r5(v):
    return round(v, 5)


def _have(key, fallback):
    """Another module's material when it is loaded (the granular, fluids, mechanics or circuits module's), else one of the catalog's own."""
    return key if key in MATERIALS else fallback


def _look(key, fallback):
    return key if key in LOOK_FILL else fallback


def _r6(v):
    return round(v, 6)


def _child(c, part, parent, body, at, material, look, words, color=None):
    """A solid welded to another solid of this item, `at` in the parent's own frame (an unturned parent: the item's frame from its at)."""
    s = {"kind": c.kind, "id": f"{c.item['id']}/{part}", "words": words, "item": c.item["id"], "look": look, "body": body, "material": material,
         "at": {"x": _r5(at[0]), "y": _r5(at[1])}, "parent": parent, "placeholder": {"fill": color or LOOK_FILL[look]},
         "render": {"kind": "procedural", "shade": LOOK_SHADE[look]}, "depth": 2}
    if color:
        s["color"] = color
    c.sb.solids.append(s)
    return s["id"]


def _poly_body(pts, depth):
    pts = [(_r5(x), _r5(y)) for x, y in pts]
    problem = polygon_problem(pts)
    if problem:
        raise ValueError(f"polygon {problem}")
    return {"kind": "polygon", "points": [{"x": x, "y": y} for x, y in pts], "depth": _r5(depth)}


def _poly_area(pts):
    n = len(pts)
    a = 0.0
    for k in range(n):
        a += pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1]
    return abs(a) / 2


COLORS = {"white": "#f2f0ea", "blue": "#3f6fc2", "red": "#c8443a", "green": "#4f9a5a", "yellow": "#e8c13a", "black": "#2a2a2a", "grey": "#9aa0a6",
          "orange": "#e8823a", "pink": "#e58fae", "brown": "#7a5236"}
COLOR_NAMES = list(COLORS)


def _heat_on(sb):
    """Whether this scene runs heat: a heat item (it made a "heat" record), a lit candle, or a room temperature or time-lapse other than the standard."""
    return (any(p.get("kind") == "heat" for p in sb.processes) or sb.settings["room_temp"] != 20.0 or sb.settings["time_lapse"] != 1.0
            or any(isinstance(i, dict) and i.get("type") == "candle" and (i.get("props") or {}).get("lit") is True for i in sb.scene_items.values()))


# ---------------------------------------------------------------- existing items that take part
ROD_TYPES = ("steel-rod", "wooden-rod")
FLOW_TEMP_TYPES = ("pitcher", "tap")
# a candle's flame [NIST-CANDLE] (heat-data.ts CANDLE): its heat, its wax burned a second, its light (1 cd: 12.6 lm) and radiation (20 % of 80 W)
CANDLE_W = 80.0
CANDLE_BURN = 1.66667e-06
CANDLE_LM = 12.6
CANDLE_IR = 16.0
FLAME_UP = 0.0125     # m: the flame's middle over its wick (a flame 2.5 cm tall)
# fluids containers (type -> nothing more: their liquid record says where) and flow's own sources
FLOW_SOURCES = ("pitcher", "tap", "leaky-bottle", "hose")


def _extend():
    t = TYPES.get("ice-cube")
    if t is not None and not any(p.key == "start_temp_c" for p in t.props):
        t.props.append(Prop("start_temp_c", "Start temperature", -18.0, -30.0, 0.0, 1.0, "°C",
                            "How cold it starts (a home freezer is −18 °C); it melts when the scene has heat (a time-lapse, a lamp, a plate, salt...)"))
        t.readouts.extend([Readout("temp", "Temperature", "°C", 1, "Its ice (at 0 °C, or colder in salt water, while it melts)"),
                           Readout("melted", "Melted", "", 2, "The share of its ice that has melted (1 = all of it)"),
                           Readout("puddle_g", "Puddle", "g", 1, "Melt water that has run off into a puddle")])
    for key in ROD_TYPES:
        r = TYPES.get(key)
        if r is not None and not any(ro.key == "temp0" for ro in r.readouts):
            r.readouts.extend([Readout("temp0", "Temperature at the left end", "°C", 1), Readout("temp7", "Temperature at the right end", "°C", 1)])
    s = TYPES.get("steel-rod")
    if s is not None:
        for m in ("copper", "stainless steel", "glass"):
            if m not in s.materials:
                s.materials.append(m)
    _candle_wide()
    # flow's pitchers and taps say how warm their liquid is
    for key in FLOW_TEMP_TYPES:
        t = TYPES.get(key)
        if t is not None and not any(p.key == "temp_c" for p in t.props):
            t.props.append(Prop("temp_c", "Liquid temperature", 20.0, 0.0, 100.0, 1.0, "°C",
                                "How warm its liquid is (when the scene has heat: a thermometer, a time-lapse...): hot and cold water poured together mix to one temperature"))


def _top(solid):
    """The highest point of a solid's own outline (its frame), m."""
    b = solid["body"]
    if b["kind"] == "polygon":
        return max(q["y"] for q in b["points"])
    if b["kind"] == "ball":
        return b["radius"]
    return b["height"] / 2


def _layer_liquids(rec, item):
    """A fluids container's liquid as heat takes it: (water kg, salt kg, [[words, kg]] of its other liquids, kg/m³ of it all)."""
    water = salt = other_kg = vol = 0.0
    others = []
    for lay in rec.get("layers") or []:
        words = lay.get("words", "")
        kg = lay["height"] * rec["area"] * lay["density"]
        vol += lay["height"] * rec["area"]
        if "water" in words:
            water += kg
            if words == "salt water":
                # its salt: the layer's density over pure water's, from the fluids module's salt share (salt_pct of the salt water)
                pct = props_of(item).get("salt_pct", 0.0)
                salt += kg * pct / 100.0
            elif words == "sea water":
                salt += kg * 0.035
        else:
            others.append([words, round(kg, 7)])
            other_kg += kg
    rho = (water + other_kg) / vol if vol > 0 else 998.2
    return water, salt, others, rho


# a thermometer or spoon through a lid: the lid has a hole where it crosses it (an insulated-cup lid's thermometer hole)
PROBE_TYPES = ("thermometer", "spoon")
LID_GAP = 0.0015   # m of clearance either side of what goes through (provisional: a snug thermometer hole)
LID_MIN = 0.002    # m: a piece of lid narrower than this is left out


def _lid_holes(sb):
    """A thermometer (or spoon) standing in a lidded cup or pan goes through its lid: the lid's slab is cut where each one crosses it into pieces
    welded to the vessel as the lid was (the first keeps the lid's id, the others are <item>/lid-2, -3 ...), and the water record's `cover`
    lists them. So the lid never shoves the cup out from under a thermometer, nor holds the thermometer's bulb up out of the water."""
    by = {s["id"]: s for s in sb.solids}
    probes = [s for s in sb.solids if (sb.scene_items.get(s.get("item")) or {}).get("type") in PROBE_TYPES and s["body"]["kind"] == "slab"]
    if not probes:
        return
    lids = [s for s in sb.solids if s["id"] == f"{s.get('item')}/lid" and s.get("parent") in by and (sb.scene_items.get(s.get("item")) or {}).get("type") in ("drink-cup", "saucepan")]
    for lid in lids:
        fl = by[lid["parent"]]
        fx, fy, fa = fl["at"]["x"], fl["at"]["y"], fl.get("angle", 0.0)
        fc, fs = cos(fa), sin(fa)
        lx, ly = lid["at"]["x"], lid["at"]["y"]
        w, h = lid["body"]["width"], lid["body"]["height"]
        y0, y1 = ly - h / 2, ly + h / 2
        gaps = []
        for pr in probes:
            if pr["item"] == lid["item"]:
                continue
            x, y, a = pr["at"]["x"], pr["at"]["y"], pr.get("angle", 0.0)
            if "parent" in pr:
                q = by[pr["parent"]]
                qa = q.get("angle", 0.0)
                x, y = q["at"]["x"] + x * cos(qa) - y * sin(qa), q["at"]["y"] + x * sin(qa) + y * cos(qa)
                a += qa
            c, n = cos(a), sin(a)
            hw, hh = pr["body"]["width"] / 2, pr["body"]["height"] / 2
            pts = []
            for px, py in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)):
                dx, dy = x + px * c - py * n - fx, y + px * n + py * c - fy
                pts.append((dx * fc + dy * fs, -dx * fs + dy * fc))
            # (where its outline, in the floor's frame, is within the lid's band: its corners there and its sides' crossings of the band's edges)
            us = [u for u, v in pts if y0 <= v <= y1]
            for i in range(4):
                (ua, va), (ub, vb) = pts[i], pts[(i + 1) % 4]
                for e in (y0, y1):
                    if (va - e) * (vb - e) < 0:
                        us.append(ua + (ub - ua) * (e - va) / (vb - va))
            if not us or max(us) < lx - w / 2 or min(us) > lx + w / 2:
                continue
            gaps.append((min(us) - LID_GAP, max(us) + LID_GAP))
        if not gaps:
            continue
        gaps.sort()
        pieces, at = [], lx - w / 2
        for g0, g1 in gaps:
            if g0 - at >= LID_MIN:
                pieces.append((at, g0))
            at = max(at, g1)
        if lx + w / 2 - at >= LID_MIN:
            pieces.append((at, lx + w / 2))
        k = sb.solids.index(lid)
        made = []
        for i, (a0, a1) in enumerate(pieces):
            s = dict(lid)
            if i > 0:
                s["id"] = f"{lid['item']}/lid-{i + 1}"
            s["body"] = dict(lid["body"], width=_r6(a1 - a0))
            s["at"] = {"x": _r6((a0 + a1) / 2), "y": ly}
            made.append(s)
        sb.solids[k:k + 1] = made
        for rec in sb.processes:
            if rec.get("kind") == "heat" and rec.get("role") == "water" and rec.get("item") == lid["item"] and "cover" in rec:
                rec["cover"] = [s["id"] for s in made]


def _candle_wide():
    """The everyday candle can be lit: `lit` and `lit_at` as catalog-wide props of the candle alone (COMMON_PROPS: listed on it, never built unless
    an item sets them, so a candle that does not builds as before), its readouts, tags and words."""
    cnd = TYPES.get("candle")
    if cnd is None:
        return
    if not any(p.key == "lit" for p, _ in COMMON_PROPS):
        is_candle = lambda t: t.key == "candle"   # noqa: E731
        register_common_prop(Prop("lit", "Lit", False, kind="bool",
                                  help="Light its wick (the scene then has heat): an 80 W flame that burns 0.1 g of wax a minute, warms what is over it and goes out in a closed jar"),
                             is_candle)
        register_common_prop(Prop("lit_at", "Lit at", 0.0, 0.0, 20.0, 0.1, "s", "When its flame is lit (run seconds)"), is_candle)
    if not any(r.key == "flame" for r in cnd.readouts):
        cnd.readouts.extend([Readout("flame", "Flame", "", 0, "1 while it burns, 0 once it is out"), Readout("burned_g", "Wax burned", "g", 2),
                             Readout("temp", "Wax", "°C", 1, "Its wax (the flame's heat rises away from it)")])
        cnd.tags.extend([t for t in ("flame", "lit candle", "burning", "combustion", "fire", "candle under a jar") if t not in cnd.tags])
        cnd.description += (" Lit (heat): an 80 W flame 2.5 cm tall that burns 0.1 g of wax a minute (the candle gets lighter), heats what is over it "
                            "by its rising plume, gives light, and goes out under a closed jar (candle-jar) when the oxygen falls to about 16 %.")


def register_catalog_wide(g):
    """Only what this module adds to another catalog's types for every scene: the candle's (web/sim/modules/heat.js's register_catalog_wide, which
    a parity harness uses to give the everyday port what the whole server has)."""
    globals().update({k: g[k] for k in NEEDED if k in g})
    _candle_wide()
    register_build_hook(heat_hook)


def heat_hook(sb, scene):
    """After every item is built: with heat on, the ice cubes' start temperatures, the rods' cells, the fluids module's liquids, lit candles'
    flames, flow's pitchers and taps (their liquid mixes heat for heat where it lands) and a granular sand tray's sand."""
    if not _heat_on(sb):
        return
    _lid_holes(sb)
    items = [i for i in scene.get("items", []) if isinstance(i, dict) and i.get("type") in TYPES]
    for item in items:
        t = item["type"]
        if t == "ice-cube":
            P = props_of(item)
            sb.processes.append({"kind": "heat", "id": f"{item['id']}/heat", "item": item["id"], "role": "body", "solid": f"{item['id']}/block",
                                 "start": float(P["start_temp_c"])})
        elif t in ROD_TYPES:
            P = props_of(item)
            sb.processes.append({"kind": "heat", "id": f"{item['id']}/heat", "item": item["id"], "role": "body", "solid": f"{item['id']}/rod",
                                 "cells": max(4, min(32, int(round(P["length"] / 0.01)))), "profile": True})
    # lit candles: a flame on the wick, and its light for the optics module's tracer when the scene has something of optics' (a screen, a light
    # meter, a lens, the sun...: it then gathers solids' "light"; else heat's own estimate carries the flame's radiation)
    optics_on = any(isinstance(i, dict) and getattr(TYPES.get(i.get("type")), "module", None) == "optics" for i in scene.get("items", []))
    for item in items:
        if item["type"] != "candle":
            continue
        P = props_of(item)
        if not P.get("lit"):
            continue
        body = next((s for s in sb.solids if s.get("item") == item["id"] and s["id"].endswith("/body")), None)
        if body is None:
            continue
        top = round(_top(body), 5)
        sb.processes.append({"kind": "heat", "id": f"{item['id']}/flame", "item": item["id"], "role": "flame", "solid": body["id"],
                             "at": {"x": 0.0, "y": top}, "power": CANDLE_W, "burn": CANDLE_BURN, "from": float(P.get("lit_at", 0.0))})
        if optics_on:
            body["light"] = {"id": f"{item['id']}/flame-light", "item": item["id"], "solid": body["id"], "kind": "lamp", "x": 0.0,
                             "y": round(top + FLAME_UP, 5), "dir": 1.570796, "spread": 3.1, "out": 3.1, "round": True, "size": 0.012, "blur": 0.0,
                             "rays": 64, "light": "incandescent", "lumens": CANDLE_LM, "infrared": CANDLE_IR,
                             "drive": {"item": item["id"], "key": "flame", "scale": 1.0}}
    # flow's pitchers: their liquid at their temp_c (the room's when not set), its mass following what flow says is left in them (left_ml);
    # its taps: water that arrives at theirs
    room = float(sb.settings["room_temp"])
    pours = [p for p in sb.processes if p.get("kind") in ("flow-pour", "flow-tap")]
    for rec in pours:
        iid = rec.get("item")
        item = sb.scene_items.get(iid)
        if item is None:
            continue
        given = item.get("props") or {}
        T = float(props_of(item)["temp_c"]) if "temp_c" in given else room
        if rec["kind"] == "flow-tap":
            sb.processes.append({"kind": "heat", "id": f"{iid}/tap-heat", "item": iid, "role": "tap", "key": "flowed_ml", "start": T})
            continue
        box = rec["inside"]
        liq = rec["liquid"]
        rho = liq["density"]
        L = heat_liquid(liq["words"])
        fluids = [] if L is None or L["water"] else [[liq["words"], round(rec["volume"] * rho, 7)]]
        water = round(rec["volume"] * rho, 7) if not fluids else 0.0
        salt = 0.0
        if liq["words"].startswith("salt water"):
            pct = props_of(item).get("salt_pct", 0.0)
            salt = round(water * pct / 100.0, 7)
            water = round(water - salt, 7)
        elif liq["words"] == "sea water":
            salt = round(water * 0.035, 7)
            water = round(water - salt, 7)
        rec2 = {"kind": "heat", "id": f"{iid}/water-heat", "item": iid, "role": "water", "solid": rec["solid"],
                "x0": min(q["x"] for q in box), "x1": max(q["x"] for q in box), "y0": min(q["y"] for q in box), "y1": max(q["y"] for q in box),
                "depth": rec["depth"], "round": True, "liquid": water, "salt": salt, "start": T, "wall": rec.get("wall", 0.003), "keep": True,
                "density": rho, "follow": {"item": iid, "key": "left_ml"}}
        if fluids:
            rec2["fluids"] = fluids
        sb.processes.append(rec2)
    # the liquids of the fluids module's containers: water (salt water, sea water) for heat at the item's water_temp_c, other liquids by their own
    # heat capacity; where flow pours, their liquid grows by what it brings (received_ml), even into an empty one
    flowing = bool(pours) or any(isinstance(i, dict) and i.get("type") in FLOW_SOURCES for i in scene.get("items", []))
    for rec in [p for p in sb.processes if p.get("kind") == "liquid"]:
        iid = rec.get("item")
        item = sb.scene_items.get(iid)
        layers = rec.get("layers") or []
        if item is None or (not layers and not flowing):
            continue
        water, salt, others, rho = _layer_liquids(rec, item)
        if water <= 0 and not others and not flowing:
            continue
        P = props_of(item)
        floor = f"{iid}/floor"
        walls = [s["id"] for s in sb.solids if s.get("item") == iid and s["id"] != floor and s["kind"] == "static"]
        mat = next((s["material"] for s in sb.solids if s["id"] == floor), "glass")
        wall = round(float(P.get("wall", 0.003)), 6)
        sb.processes.append({"kind": "heat", "id": f"{iid}/vessel-heat", "item": iid, "role": "body", "solid": floor, "with": walls})
        wrec = {"kind": "heat", "id": f"{iid}/water-heat", "item": iid, "role": "water", "solid": floor, "frame": "world",
                "x0": rec["x0"], "x1": rec["x1"], "y0": rec["floor"], "y1": rec["rim"], "area": rec["area"],
                "liquid": round(water - salt, 7), "salt": round(salt, 7), "start": float(P.get("water_temp_c", 20.0)),
                "wall": wall, "wallMaterial": mat}
        if others:
            wrec["fluids"] = others
            wrec["density"] = round(rho, 4)
        if flowing:
            wrec["follow"] = {"item": iid, "key": "received_ml", "add": True}
        sb.processes.append(wrec)
    # a granular sand tray's sand: one body with the tray (the sand's heat capacity, 830 J/(kg·K) [CRC], and its absorptivity)
    for item in items:
        if item["type"] != "sand-tray":
            continue
        P = props_of(item)
        g = item["id"]
        sid = f"{g}/sand"
        if not any(s["id"] == sid for s in sb.solids):
            continue
        kg = P["length"] * min(P["sand_depth"], P["wall"]) * max(0.0, P["width"] - 0.024) * 1600.0
        sb.processes.append({"kind": "heat", "id": f"{g}/sand-heat", "item": g, "role": "body", "solid": sid, "material": "dry sand",
                             "extra": [["dry sand", round(kg, 6)]]})
    # each heat record carries its item's name when it has one, for the run's events ("Salted ice cube melted completely")
    for rec in sb.processes:
        if rec.get("kind") != "heat":
            continue
        it = sb.scene_items.get(rec.get("item"))
        nm = it.get("name") if isinstance(it, dict) else None
        if isinstance(nm, str) and nm:
            rec["name"] = nm


# the liquids heat knows by their words (tooling/src/sim/heat-data.ts HEAT_LIQUIDS: the engine's own numbers; here only which are water)
HEAT_LIQUID_WATER = {"water": True, "salt water": True, "sea water": True, "vegetable oil": False, "honey": False, "corn syrup": False,
                     "dish soap": False, "rubbing alcohol": False}


def heat_liquid(words):
    """{"water": bool} for a liquid heat knows by its words ("salt water (10 % salt)" is salt water), else None."""
    base = words[:words.index(" (")] if " (" in words else words
    w = HEAT_LIQUID_WATER.get(base)
    return None if w is None else {"water": w}


# ---------------------------------------------------------------- salt
SALT_BULK = {"table": 1217.0, "coarse": 1000.0}      # kg/m³ loose: 6 g a teaspoon [USDA]; coarse (kosher) about 1 g/mL (provisional)
SALT_RATE = {"table": 0.1, "coarse": 0.03}          # 1/s: how fast it dissolves toward saturation in the water it touches (coarse grains about 3× slower)
TAN_REPOSE = 0.649408                               # tan 33°: table salt's angle of repose (32-35°)


def cone_radius(volume):
    """The radius of a cone of salt at its angle of repose holding this volume: (π/3)·tan 33°·r³ = V, by Newton's method (60 fixed steps)."""
    k = 3.0 * volume / (math.pi * TAN_REPOSE)
    r = 0.01
    for _ in range(60):
        r = (2.0 * r + k / (r * r)) / 3.0
    return r


def _salt():
    def build(c, P):
        m = P["mass_g"] / 1000.0
        r = cone_radius(m / SALT_BULK[P["grain"]])
        h = r * TAN_REPOSE
        pts = [(-r, 0.0), (r, 0.0), (0.0, h)]
        depth = 2.0 * r
        dens = round(m / (_poly_area([(_r5(x), _r5(y)) for x, y in pts]) * _r5(depth)), 4)
        sid = c.poly("pile", pts, _r5(depth), 0.0, 0.0, material=c.mat(base="table salt", density=dens), look="salt", words="a pile of table salt")
        c.process("heat", "salt", role="salt", solid=sid, mass=round(m, 7), rate=SALT_RATE[P["grain"]])
    register(ItemType("salt-pile", "Salt pile", CAT, build, material="table salt", materials=["table salt"], module=MODULE,
                      props=[Prop("mass_g", "Salt", 3.0, 0.2, 30.0, 0.1, "g", "How much salt (a level teaspoon is 6 g)"),
                             Prop("grain", "Grain", "table", kind="choice", choices=["table", "coarse"], help="table: fine grains; coarse: kosher or rock salt, dissolves about 3 times slower")],
                      readouts=[Readout("salt_g", "Salt left", "g", 2, "What has not dissolved yet")],
                      tags=["salt", "table salt", "sodium chloride", "rock salt", "de-icer", "sprinkle", "melt ice"],
                      description="A little cone of table salt. Put it ON an ice cube (resting on its top): it dissolves into the melt water and makes salt water, "
                                  "which melts ice below 0 °C, so the cube melts sooner. More salt keeps the water saltier for longer. On a dry table nothing happens.",
                      source="A cone at salt's angle of repose (33°) of loose salt 1.22 g/mL (6 g a teaspoon [USDA]): 1 g is 2.1 cm across, 6 g 3.8 cm. Salt water "
                             "freezes at −3 °C at 5 %, −6.6 °C at 10 %, −21.1 °C at 23.3 % (the coldest) [CRC]; salt dissolves to 35.9 g per 100 g of water [CRC].",
                      anchor="the middle of its base", facts="3 g of table salt, 2.7 cm across",
                      edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- plates and bowls
DISH_THICK = {"ceramic": 0.005, "glass": 0.005, "melamine": 0.003, "aluminium": 0.001, "foam": 0.002, "paperboard": 0.0012}
DISH_MATS = ["ceramic", "glass", "melamine", "aluminium", "foam", "paperboard"]
FOOT_GAP = 0.004   # m: a plate or bowl stands on its foot ring, its well about 4 mm above the table (still air under it, not wood)
DISH_LOOK = {"ceramic": "glazed", "glass": "glass", "melamine": "melamine", "aluminium": "aluminium", "foam": "foam", "paperboard": "paperboard"}


def _dish_material(c, P, mass, volume):
    """The dish's own material with the density that gives it its real weight (a round dish, against the side view's slabs)."""
    return c.mat(base=P["material"], density=round(mass / volume, 4))


def _dishes():
    def build_plate(c, P):
        D, mat = P["diameter"], P["material"]
        t = DISH_THICK[mat]
        well = 0.62 * D
        rise = 0.02 * D / 0.27
        color = COLORS[P["color"]] if mat not in ("aluminium", "glass") else None
        look = DISH_LOOK[mat]
        # a real plate's weight: a disc of its diameter and thickness (the side view's base and rims are slabs as deep as the plate)
        mass = MATERIALS[mat]["density"] * math.pi * (D / 2) * (D / 2) * t
        rim = [(well / 2, 0.0), (D / 2, rise), (D / 2, rise + t), (well / 2, t)]
        vol = well * t * well + 2.0 * _poly_area([(_r5(x), _r5(y)) for x, y in rim]) * _r5(D)
        m = _dish_material(c, P, mass, vol)
        kw = {"color": color, "fill": color} if color else {}
        base = c.slab("base", well, t, _r5(well), 0.0, t / 2, material=m, look=look, words="a dinner plate", **kw)
        for side, nm in ((1, "rim-right"), (-1, "rim-left")):
            pts = [(side * x, y) for x, y in rim]
            if side < 0:
                pts = [pts[1], pts[0], pts[3], pts[2]]
            _child(c, nm, base, _poly_body(pts, D), (0.0, -t / 2), m, look, "the rim of a dinner plate", color)
        c.process("heat", "heat", role="body", solid=base, cells=max(4, min(32, int(round(well / 0.01)))), retain=0.002, standoff=FOOT_GAP)
    register(ItemType("plate", "Plate", CAT, build_plate, material="ceramic", materials=DISH_MATS, module=MODULE,
                      props=[Prop("diameter", "Diameter", 0.27, 0.15, 0.32, 0.005, "m", "A dinner plate is 27 cm (10.5 in), a side plate 20 cm"),
                             Prop("color", "Colour", "white", kind="choice", choices=COLOR_NAMES, help="The glaze or paint (not for aluminium or glass)")],
                      readouts=[Readout("temp", "Temperature", "°C", 1, "Its mean"), Readout("temp_min", "Coldest spot", "°C", 1, "Under an ice cube, say")],
                      tags=["plate", "dish", "dinner plate", "saucer", "ceramic", "china", "tray", "under the ice"],
                      description="A dinner plate with a low rim. Put an ice cube in its middle: melt water stays on it as a puddle. What it is made of matters: "
                                  "an aluminium plate feeds heat to the cube far faster than ceramic, and foam hardly at all.",
                      source="A 27 cm (10.5 in) dinner plate: a flat well 62 % of its width, a rim 2 cm high; stoneware 5 mm (about 0.66 kg), melamine 3 mm, glass 5 mm, "
                             "an aluminium pie plate 1 mm, foam 2 mm (about 5 g), paper 1.2 mm. Heat flows along it cell by cell (1 cm each).",
                      anchor="the middle of its base, where it stands", facts="27 cm stoneware dinner plate",
                      edit=[{"kind": "rotate"}]))

    def build_bowl(c, P):
        D, H, mat = P["diameter"], P["height"], P["material"]
        t = DISH_THICK[mat]
        b = 0.55 * D
        color = COLORS[P["color"]] if mat not in ("aluminium", "glass") else None
        look = DISH_LOOK[mat]
        slant = math.sqrt((D / 2 - b / 2) * (D / 2 - b / 2) + H * H)
        mass = MATERIALS[mat]["density"] * t * (math.pi * (b / 2) * (b / 2) + math.pi * (b / 2 + D / 2) * slant)
        wall = [(b / 2 - t, 0.0), (b / 2, 0.0), (D / 2, H), (D / 2 - t, H)]
        vol = b * t * b + 2.0 * _poly_area([(_r5(x), _r5(y)) for x, y in wall]) * _r5(D)
        m = _dish_material(c, P, mass, vol)
        kw = {"color": color, "fill": color} if color else {}
        base = c.slab("base", b, t, _r5(b), 0.0, t / 2, material=m, look=look, words="a bowl", **kw)
        for side, nm in ((1, "wall-right"), (-1, "wall-left")):
            pts = [(side * x, y) for x, y in wall]
            if side < 0:
                pts = [pts[1], pts[0], pts[3], pts[2]]
            _child(c, nm, base, _poly_body(pts, D), (0.0, -t / 2), m, look, "the side of a bowl", color)
        c.process("heat", "heat", role="body", solid=base, cells=max(4, min(32, int(round(b / 0.01)))), retain=0.005, standoff=FOOT_GAP)
        _contents(c, P, b, D, H, t)
    register(ItemType("bowl", "Bowl", CAT, build_bowl, material="ceramic", materials=DISH_MATS, module=MODULE,
                      props=[Prop("diameter", "Diameter", 0.15, 0.1, 0.3, 0.005, "m", "Across the rim"), Prop("height", "Height", 0.065, 0.04, 0.12, 0.005, "m"),
                             Prop("color", "Colour", "white", kind="choice", choices=COLOR_NAMES, help="The glaze or paint (not for aluminium or glass)"),
                             Prop("contents", "Holds", "nothing", kind="choice", choices=["nothing", "water", "sand"],
                                  help="water, or dry sand (sand warms about 5 times faster than water under the same lamp: c 830 against 4184 J/(kg·K))"),
                             Prop("contents_g", "How much", 200.0, 10.0, 1000.0, 10.0, "g", "Of the water or sand"),
                             Prop("contents_temp_c", "Its temperature", 20.0, 0.0, 90.0, 1.0, "°C", "Where the water or sand starts")],
                      readouts=[Readout("temp", "Temperature", "°C", 1, "Its mean"), Readout("temp_min", "Coldest spot", "°C", 1)],
                      tags=["bowl", "dish", "cereal bowl", "soup bowl", "ceramic", "basin"],
                      description="A cereal bowl. An ice cube in it sits in its own melt water (the bowl holds about 5 mm of it round the cube), so salt on the "
                                  "cube stays in contact longer than on a flat plate.",
                      source="A 15 cm × 6.5 cm stoneware cereal bowl, 5 mm thick, about 0.38 kg; the floor 55 % of its width.",
                      anchor="the middle of its base, where it stands", facts="15 cm stoneware bowl",
                      edit=[{"kind": "rotate"}]))


def _contents(c, P, b, D, H, t):
    """A bowl's water (a water record over its floor) or dry sand (a slab of it lying on its floor: its own body), when it holds some."""
    what = P["contents"]
    kg = P["contents_g"] / 1000.0
    # (where flow's pitchers or taps pour, it catches liquid: its water then follows what flow says it has received, mixing heat for heat)
    flowing = any(isinstance(i, dict) and i.get("type") in FLOW_SOURCES for i in c.sb.scene_items.values())
    if what == "water" or (flowing and what == "nothing"):
        extra = {"follow": {"item": c.item["id"], "key": "liquid_ml", "add": True}} if flowing else {}
        c.process("heat", "water", role="water", solid=c.sid("base"), x0=_r6(-(b / 2 - t)), x1=_r6(b / 2 - t), y0=_r6(t / 2), y1=_r6(t / 2 + H),
                  depth=_r6((b + D) / 2), round=True, liquid=round(kg, 7) if what == "water" else 0.0, start=float(P["contents_temp_c"]), lid=False,
                  salt=0.0, wall=t, wallMaterial=P["material"], **extra)
    elif what == "sand":
        w = b - 2 * t - 0.002
        hs = kg / (1600.0 * w * b)
        c.slab("sand", w, hs, _r5(b), 0.0, t + hs / 2 + 0.0005, material=c.mat(base="dry sand", density=round(kg / (_r5(w) * _r5(hs) * _r5(b)), 4), overrides={}),
               look=_look("sand", "salt"), words="dry sand in the bowl")
        c.process("heat", "sand-heat", role="body", solid=c.sid("sand"), start=float(P["contents_temp_c"]))


# ---------------------------------------------------------------- the desk lamp
BULBS = {"incandescent": 0.80, "halogen": 0.80, "led": 0.35}   # light and infrared out of the bulb per watt drawn [IES], [DOE]
SHADE = 0.7                                                     # the share the shade sends into the beam (provisional)


def lamp_geometry(P, item, scene_items):
    """The lamp's head pivot (item frame), the beam's direction (a unit vector, item frame) and the bulb (item frame). The beam points at
    its target item when it has one, else along `aim` (degrees from +x, counter-clockwise)."""
    hx, hy = 0.12, P["head_height"]
    target = scene_items.get(P.get("target")) if isinstance(P.get("target"), str) and P.get("target") != item["id"] else None
    ux = uy = None
    if target is not None:
        dx = float(target.get("x", 0.0)) - (float(item.get("x", 0.0)) + hx)
        dy = float(target.get("y", 0.0)) - (float(item.get("y", 0.0)) + hy)
        d = math.sqrt(dx * dx + dy * dy)
        if d > 1e-6:
            ux, uy = dx / d, dy / d
    if ux is None:
        a = P["aim"] * D2R
        ux, uy = cos(a), sin(a)
    return (hx, hy), (ux, uy), (hx + 0.03 * ux, hy + 0.03 * uy)


def _lamp():
    def build(c, P):
        (hx, hy), (ux, uy), (bx, by) = lamp_geometry(P, c.item, c.sb.scene_items)
        base = c.slab("base", 0.15, 0.025, 0.15, 0.0, 0.0125, material=c.mat(base="steel", overrides={}), look="enamel", words="a desk lamp's weighted base")
        # the arm: a 1.2 cm bar from the base's top to the head
        ax, ay = -0.02, 0.025
        dx, dy = hx - ax, hy - ay
        L = math.sqrt(dx * dx + dy * dy)
        nx, ny = -dy / L * 0.006, dx / L * 0.006
        arm = [(ax - nx, ay - ny), (hx - nx, hy - ny), (hx + nx, hy + ny), (ax + nx, ay + ny)]
        c.poly("arm", arm, 0.012, material=c.mat(base="steel", overrides={}), look="enamel", words="a desk lamp's arm", kind="static")
        # the shade: a cone along the beam, 6 cm across at its back and 13 cm at its mouth, 11 cm long
        px, py = -uy, ux
        b0x, b0y = hx - 0.02 * ux, hy - 0.02 * uy
        m0x, m0y = hx + 0.09 * ux, hy + 0.09 * uy
        shade = [(b0x - 0.03 * px, b0y - 0.03 * py), (m0x - 0.065 * px, m0y - 0.065 * py), (m0x + 0.065 * px, m0y + 0.065 * py), (b0x + 0.03 * px, b0y + 0.03 * py)]
        c.poly("shade", shade, 0.13, material=c.mat(base="steel", overrides={}), look="enamel", words="a desk lamp's shade", kind="static")
        on = P["on"]
        c.process("heat", "light", role="lamp", solid=base, at={"x": _r5(bx), "y": _r5(by - 0.0125)}, dir={"x": _r6(ux), "y": _r6(uy)},
                  spread=_r6(P["beam_angle"] / 2 * D2R), power=round(P["power_w"] * BULBS[P["bulb"]] * SHADE, 4),
                  **({"from": float(P["on_at"])} if on else {"from": 1e9}))
    register(ItemType("lamp", "Desk lamp", CAT, build, dynamic=False, module=MODULE,
                      props=[Prop("bulb", "Bulb", "incandescent", kind="choice", choices=list(BULBS),
                                  help="incandescent (old-style, hot) or halogen: about 80 % of its power comes out as light and heat; LED: about 35 %, almost no heat"),
                             Prop("power_w", "Power", 60.0, 1.0, 150.0, 1.0, "W", "What the bulb draws (an LED filament bulb 2-8 W, an old-style bulb 25-150 W)"),
                             Prop("on", "On", True, kind="bool"),
                             Prop("on_at", "Turns on at", 0.0, 0.0, 20.0, 0.1, "s", "When it switches on (run seconds)"),
                             Prop("aim", "Aim", -60.0, -180.0, 180.0, 1.0, "°", "Which way the beam points (0 right, −90 straight down); its target wins"),
                             Prop("beam_angle", "Beam angle", 100.0, 40.0, 140.0, 1.0, "°", "How wide the beam spreads (full cone)"),
                             Prop("head_height", "Head height", 0.4, 0.2, 0.6, 0.01, "m", "How high the shade is above the base")],
                      links=[Link("target", "Shines on", help="Aim the beam at this item (its middle)")],
                      readouts=[Readout("on", "On", "", 0)],
                      tags=["lamp", "desk lamp", "light", "bulb", "heat lamp", "incandescent", "led", "halogen", "torch", "spotlight", "sun lamp"],
                      description="A desk lamp on a heavy base whose shade shines a cone of light and warmth. What its beam reaches warms (an ice cube melts sooner), "
                                  "more the nearer it is (1/distance²). Link it to a target and it points at it. An LED bulb gives light but almost no heat.",
                      source="A 60 W incandescent bulb gives about 48 W of light and infrared (7.5 % light, 73 % infrared [IES]); the shade sends about 70 % of it into "
                             "a 100° cone: about 15 W per steradian, 240 W/m² at 25 cm (sunlight is about 1000 W/m²). An LED lamp about 35 % [DOE].",
                      anchor="the middle of its base, where it stands", facts="60 W incandescent, shade 40 cm up",
                      edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- thermometers
THERMOMETERS = {
    # style: (sensor heat capacity J/K, bulb area m², bulb size m, inside resistance K/W): about 8 s in water and 60 s in air for the glass one,
    # 3 s and 30 s for the digital probe (typical response times of lab thermometers; the inside resistance is the bulb's glass and liquid)
    "glass": (0.16, 2e-4, 0.006, 43.7),
    "digital": (0.066, 1.5e-4, 0.0035, 37.0),
}


def _thermometer():
    def build(c, P):
        style = P["style"]
        cap, area, size, res = THERMOMETERS[style]
        if style == "glass":
            # a 30 cm × 7 mm glass stem; its bulb (the anchor) at the bottom
            sid = c.slab("stem", 0.007, 0.3, 0.007, 0.0, 0.144, material=c.mat(base="glass", density=round(0.015 / (0.007 * 0.3 * 0.007), 4)), look="thermometer glass",
                         words="a glass thermometer")
            at = {"x": 0.0, "y": -0.144}
        else:
            # a 12 cm stainless probe with its tip (the anchor) at the bottom, and its 5 × 8 cm display head on top
            sid = c.slab("probe", 0.0035, 0.12, 0.0035, 0.0, 0.06, material=c.mat(base="stainless steel", density=round(0.03 / (0.0035 * 0.12 * 0.0035), 4)),
                         look="stainless", words="a digital thermometer's probe")
            _child(c, "display", sid, {"kind": "slab", "width": 0.05, "height": 0.08, "depth": 0.02}, (0.0, 0.1), c.mat(base="ABS plastic", density=round(0.06 / (0.05 * 0.08 * 0.02), 4)),
                   "plastic", "a digital thermometer's display", "#e8e8e4")
            at = {"x": 0.0, "y": -0.06}
        c.process("heat", "bulb", role="sensor", solid=sid, at=at, capacity=cap, area=area, size=size, resistance=res,
                  absorptivity=0.5 if style == "glass" else 0.3)
    register(ItemType("thermometer", "Thermometer", CAT, build, module=MODULE,
                      props=[Prop("style", "Kind", "glass", kind="choice", choices=list(THERMOMETERS),
                                  help="glass: a lab thermometer, a red column (−10 to 110 °C); digital: a probe with a display (0.1 °C)"),
                             Prop("units", "Shows", "C", kind="choice", choices=["C", "F"], help="Degrees Celsius or Fahrenheit (the reading is kept in °C)")],
                      readouts=[Readout("reading", "Reads", "°C", 1, "The temperature of what its bulb (tip) is in or touches, else the air's"),
                                Readout("in_water", "Bulb in water", "", 0, "Whether its bulb (tip) is in water now", words={0: "no", 1: "yes"})],
                      tags=["thermometer", "temperature", "probe", "measure", "degrees", "celsius", "fahrenheit", "instrument", "lab"],
                      description="Reads the temperature of what its bulb (the bottom end) is in or touches: water in a cup, a plate, else the air. It takes a "
                                  "while to settle: about 8 s in water and a minute in air for the glass one (3 s and 30 s for the digital probe). In a lamp's beam or "
                                  "the sun it reads high. Tick Fixed to stand it upright in a cup.",
                      source="A 30 cm × 7 mm glass lab thermometer, 15 g, alcohol column; a stainless digital probe 12 cm × 3.5 mm. Response times from typical specs "
                             "(provisional): the bulb's heat capacity and inside resistance give them.",
                      anchor="its bulb (the bottom end)", facts="glass lab thermometer, −10 to 110 °C",
                      edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- the hot plate
def _hot_plate():
    def build(c, P):
        c.slab("body", 0.2, 0.08, 0.2, 0.0, 0.04, material=c.mat(base="steel", overrides={}), look="enamel", words="a hot plate's body", kind="static")
        top = c.slab("top", 0.18, 0.006, 0.18, 0.0, 0.083, material=c.mat(base="aluminium", overrides={}), look="aluminium", words="a hot plate's top", kind="static")
        on = P["on"]
        c.process("heat", "heater", role="heater", solid=top, power=float(P["power_w"]), setpoint=float(P["setpoint_c"]),
                  **({"from": float(P["on_at"])} if on else {"from": 1e9}))
    register(ItemType("hot-plate", "Hot plate", CAT, build, dynamic=False, module=MODULE,
                      props=[Prop("power_w", "Power", 600.0, 100.0, 1500.0, 10.0, "W", "How fast it heats"),
                             Prop("setpoint_c", "Set to", 250.0, 20.0, 550.0, 5.0, "°C", "Its thermostat keeps the top within 5 °C of this; it glows dull red above about 500 °C"),
                             Prop("on", "On", True, kind="bool"), Prop("on_at", "Turns on at", 0.0, 0.0, 20.0, 0.1, "s", "When it switches on (run seconds)")],
                      readouts=[Readout("temp", "Top", "°C", 0), Readout("power", "Heating", "W", 0)],
                      tags=["hot plate", "stove", "hob", "burner", "cooker", "heater", "boil", "lab", "heat"],
                      description="An electric hot plate with an aluminium top 18 cm square. What stands on it (a pot, a beaker, a block) is heated through the touch; "
                                  "its thermostat holds the top near its setting. 600 W brings 1 L of water to the boil in about 10 minutes.",
                      source="A lab hot plate: 18 × 18 cm aluminium top 6 mm, 100-1500 W, thermostat ±5 °C; it glows dull red above about 500 °C (Draper point 525 °C).",
                      anchor="the middle of its base, where it stands", facts="600 W, set to 250 °C",
                      edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- pots and cups of water
CUPS = {
    # style: (inner diameter at the top, at the bottom, inner height, wall (physics), wall (heat), material, look, weight kg, words)
    "foam": (0.085, 0.055, 0.105, 0.0025, 0.0025, "foam", "foam", 0.004, "a foam cup"),
    "paper": (0.085, 0.055, 0.105, 0.002, 0.0006, "paperboard", "paperboard", 0.012, "a paper cup"),
    "plastic": (0.085, 0.055, 0.105, 0.002, 0.0006, "polypropylene", "plastic", 0.01, "a plastic cup"),
    "glass": (0.07, 0.065, 0.11, 0.003, 0.003, "glass", "glass", 0.25, "a drinking glass"),
    "steel": (0.07, 0.065, 0.11, 0.002, 0.0008, "stainless steel", "stainless", 0.15, "a steel tumbler"),
    "mug": (0.073, 0.073, 0.088, 0.0043, 0.0043, "ceramic", "glazed", 0.33, "a ceramic mug"),
    "flask": (0.06, 0.06, 0.18, 0.004, 0.01, "vacuum flask", "stainless", 0.35, "a vacuum flask"),
}


def _water_record(c, part, solid, inner_top, inner_bottom, t, H, water_kg, P, wall, wall_mat):
    """The water in a vessel whose floor (`solid`, t thick) has its middle t/2 above the item's anchor: its inside in the floor's own frame."""
    c.process("heat", part, role="water", solid=solid, x0=_r6(-inner_top / 2), x1=_r6(inner_top / 2), y0=_r6(t / 2), y1=_r6(t / 2 + H),
              depth=_r6((inner_top + inner_bottom) / 2), round=True, liquid=round(water_kg, 7), start=float(P["water_temp_c"]),
              lid=bool(P["lid"]), salt=round(P.get("salt_g", 0.0) / 1000.0, 7), wall=wall, wallMaterial=wall_mat,
              **({"cover": [c.sid("lid")]} if P["lid"] else {}))


HANDLES = {"pot": (0.12, 0.012, 0.02), "mug": (0.025, 0.06, 0.012)}   # width (out from the wall), height, front to back


def _vessel(c, P, inner_top, inner_bottom, H, t, mat, look, mass, words, color=None, handle=None):
    """A round vessel in side view: a floor and two walls (tapered when its top is wider), welded; a handle; its lid when P['lid']. Returns the floor's id."""
    floor_w = _r5(inner_bottom + 2 * t)
    walls = []
    for side, nm in ((-1, "wall-left"), (1, "wall-right")):
        # a wall from the floor's edge up to the rim: a parallelogram whose inner face runs from (b/2, 0) to (top/2, t + H)
        x0 = side * inner_bottom / 2
        x1 = side * inner_top / 2
        pts = [(x0, 0.0), (x0 + side * t, 0.0), (x1 + side * t, t + H), (x1, t + H)]
        if side < 0:
            pts = [pts[1], pts[0], pts[3], pts[2]]
        walls.append((nm, [(_r5(x), _r5(y)) for x, y in pts]))
    depth = _r5(inner_top + 2 * t)
    vol = floor_w * t * floor_w
    for _, pts in walls:
        vol += _poly_area(pts) * depth
    hw = hh = hd = 0.0
    if handle is not None:
        hw, hh, hd = HANDLES[handle]
        vol += hw * hh * hd
    lid = _r5(inner_top + 2 * t + 0.004)
    if P["lid"]:
        vol += lid * 0.004 * lid
    m = c.mat(base=mat, density=round(mass / vol, 4))
    kw = {"color": color, "fill": color} if color else {}
    floor = c.slab("floor", floor_w, t, floor_w, 0.0, t / 2, material=m, look=look, words=words, **kw)
    for nm, pts in walls:
        _child(c, nm, floor, _poly_body(pts, depth), (0.0, -t / 2), m, look, words, color)
    if handle is not None:
        y = H - 0.01 if handle == "pot" else t + H / 2
        _child(c, "handle", floor, {"kind": "slab", "width": hw, "height": hh, "depth": hd}, (inner_top / 2 + t + hw / 2, y - t / 2), m, look, words, color)
    if P["lid"]:
        _child(c, "lid", floor, {"kind": "slab", "width": lid, "height": 0.004, "depth": lid}, (0.0, t + H + 0.002 - t / 2), m, look, f"the lid of {words}", color)
    return floor


def _vessels():
    def build_pot(c, P):
        D, H = P["diameter"], P["height"]
        t = 0.003
        floor = _vessel(c, P, D, D, H, t, "stainless steel", "stainless", 0.9 * (D / 0.18) * (D / 0.18), "a saucepan", handle="pot")
        cap = math.pi * (D / 2) * (D / 2) * (H - 0.005)
        water = min(P["water_ml"] / 1e6, cap) * 998.2
        _water_record(c, "water", floor, D, D, t, H, water, P, 0.001, "stainless steel")
    register(ItemType("saucepan", "Saucepan of water", CAT, build_pot, module=MODULE, material="stainless steel", materials=["stainless steel"],
                      props=[Prop("diameter", "Diameter", 0.18, 0.12, 0.3, 0.005, "m", "Inside"), Prop("height", "Height", 0.1, 0.06, 0.18, 0.005, "m"),
                             Prop("water_ml", "Water", 1000.0, 0.0, 3000.0, 10.0, "mL", "Up to what fits"),
                             Prop("water_temp_c", "Water temperature", 20.0, 0.0, 100.0, 1.0, "°C"),
                             Prop("salt_g", "Salt in it", 0.0, 0.0, 200.0, 1.0, "g", "Salt water boils a little hotter and freezes colder"),
                             Prop("lid", "Lid on", False, kind="bool", help="A lid keeps the steam in: no water boils away, less heat is lost")],
                      readouts=[Readout("water_temp", "Water", "°C", 1), Readout("water_g", "Water left", "g", 0), Readout("boiling", "Boiling", "", 0),
                                Readout("temp", "Pan", "°C", 0)],
                      tags=["pot", "pan", "saucepan", "boil", "boiling", "water", "cook", "kettle", "steam", "stove"],
                      description="A stainless steel saucepan of water. Stand it on a hot plate: the water warms, boils at 100 °C (the thermometer stops rising while "
                                  "it boils) and boils away; with the lid on, no water is lost. Off the heat it cools, mostly by evaporating from its surface.",
                      source="An 18 cm stainless saucepan about 0.9 kg, a 3 mm base; water 998.2 kg/m³, 4184 J/(kg·K), boils at 100 °C taking 2257 kJ/kg [CRC].",
                      anchor="the middle of its base, where it stands", facts="18 cm saucepan, 1 L of water at 20 °C",
                      edit=[{"kind": "rotate"}]))

    def build_cup(c, P):
        top, bottom, H, t, t_heat, mat, look, mass, words = CUPS[P["style"]]
        color = COLORS[P["color"]] if P["style"] in ("plastic", "mug", "paper") else None
        floor = _vessel(c, P, top, bottom, H, t, mat, look, mass, words, color, handle="mug" if P["style"] == "mug" else None)
        cap = math.pi * (top + bottom) / 4 * (top + bottom) / 4 * (H - 0.003)
        water = min(P["water_ml"] / 1e6, cap) * 998.2
        _water_record(c, "water", floor, top, bottom, t, H, water, P, t_heat, mat)
    register(ItemType("drink-cup", "Cup of water", CAT, build_cup, module=MODULE,
                      props=[Prop("style", "Cup", "foam", kind="choice", choices=list(CUPS),
                                  help="foam (insulated), paper, plastic, glass, steel tumbler, ceramic mug, or a vacuum flask (the best insulator)"),
                             Prop("water_ml", "Water", 200.0, 0.0, 500.0, 5.0, "mL", "Up to what fits"),
                             Prop("water_temp_c", "Water temperature", 80.0, 0.0, 100.0, 1.0, "°C", "Hot tea or cocoa is about 70-80 °C"),
                             Prop("lid", "Lid on", False, kind="bool", help="A lid stops evaporation, which takes a third to a half of an open hot drink's heat (a thermometer or spoon goes through it)"),
                             Prop("color", "Colour", "white", kind="choice", choices=COLOR_NAMES, help="Paper, plastic and mug cups")],
                      readouts=[Readout("water_temp", "Water", "°C", 1), Readout("water_g", "Water", "g", 0), Readout("temp", "Cup", "°C", 1)],
                      tags=["cup", "mug", "insulated cup", "foam cup", "styrofoam", "thermos", "vacuum flask", "tumbler", "hot chocolate", "cocoa", "tea", "coffee",
                            "glass of water", "cold drink", "ice water"],
                      description="A cup of water at a temperature you choose. Hot water cools (cold water warms) through the cup's wall and from its surface: a foam "
                                  "cup with a lid keeps it hot longest after a vacuum flask; an open paper or plastic cup cools fastest; a shiny steel tumbler gets hot "
                                  "to touch but radiates little; an open cup loses a third to a half of its heat by evaporation, which a lid stops. Put a "
                                  "thermometer in it (bulb in the water; it goes through the lid) to read it; drop an ice cube in and it melts and chills the water.",
                      source="Cup sizes: 12 oz foam or paper cup 8.5 cm across the top, 5.5 cm at the base, 10.5 cm tall; walls: foam 2.5 mm (k 0.033), paper 0.6 mm, "
                             "steel 0.8 mm, glass 3 mm, mug 4.3 mm; a vacuum flask as an effective wall [INC Table A.3]. Evaporation by the heat and mass transfer "
                             "analogy, which agrees with Carrier's equation [ASHRAE].",
                      anchor="the middle of its base, where it stands", facts="foam cup, 200 mL at 80 °C",
                      edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- spoons, rods and meltables
SPOONS = {
    # material: (thickness, width (front to back), its look)
    "stainless steel": (0.002, 0.012, "stainless"),
    "aluminium": (0.002, 0.012, "aluminium"),
    "copper": (0.002, 0.012, "copper"),
    "polypropylene": (0.003, 0.012, "plastic"),
    "varnished hardwood": (0.006, 0.02, "wood"),
}


def _spoon():
    def build(c, P):
        mat = P["material"]
        th, w, look = SPOONS[mat]
        L = P["length"]
        sid = c.slab("spoon", L, th, w, 0.0, 0.0, material=c.mat(base=mat, overrides={}), look=look, words="a spoon")
        c.process("heat", "heat", role="body", solid=sid, cells=max(4, min(32, int(round(L / 0.01)))), profile=True)
    register(ItemType("spoon", "Spoon", CAT, build, module=MODULE, material="stainless steel", materials=list(SPOONS),
                      props=[Prop("length", "Length", 0.15, 0.1, 0.35, 0.005, "m", "A teaspoon is 15 cm, a wooden spoon 25-30 cm")],
                      readouts=[Readout("temp0", "Bowl end", "°C", 1, "Its left end (the bowl)"), Readout("temp7", "Handle end", "°C", 1, "Its right end (the handle)"),
                                Readout("temp", "Mean", "°C", 1)],
                      tags=["spoon", "teaspoon", "wooden spoon", "metal spoon", "plastic spoon", "conductor", "insulator", "utensil", "stir"],
                      description="A spoon (its bowl at its left end). Stand its bowl end in hot water and heat creeps along it: a metal spoon's handle gets "
                                  "warm (copper and aluminium fast, stainless steel slowly), a plastic or wooden one hardly at all. Heat flows along it cell by cell.",
                      source="A teaspoon 15 cm: stainless steel 25 g (k 16 W/(m·K)), aluminium 9 g (237), copper (401), plastic 3-5 g (0.22); a wooden spoon 25-30 cm "
                             "(0.16) [INC Tables A.1, A.3].",
                      anchor="its middle", facts="15 cm stainless teaspoon",
                      edit=[{"kind": "length", "prop": "length"}, {"kind": "rotate"}]))


def _meltable():
    def build(c, P):
        sid = c.slab("piece", P["width"], P["height"], P["depth"], 0.0, 0.0, material=c.mat(base=P["material"], overrides={}),
                     look=MATERIALS[P["material"]]["look"], words=f"a piece of {P['material']}")
        c.process("heat", "heat", role="body", solid=sid, start=float(P["start_temp_c"]))
    register(ItemType("meltable", "Meltable piece (butter, chocolate or wax)", CAT, build, module=MODULE, material="butter", materials=["butter", "chocolate", "wax"],
                      props=[Prop("width", "Width", 0.02, 0.005, 0.1, 0.001, "m"), Prop("height", "Height", 0.01, 0.002, 0.05, 0.001, "m"),
                             Prop("depth", "Front to back", 0.02, 0.005, 0.1, 0.001, "m"),
                             Prop("start_temp_c", "Start temperature", 20.0, -20.0, 60.0, 1.0, "°C", "Butter from the fridge is 4 °C")],
                      readouts=[Readout("temp", "Temperature", "°C", 1), Readout("melted", "Melted", "", 2)],
                      tags=["butter", "chocolate", "wax", "crayon", "melt", "dab", "pat", "conduction race", "sun"],
                      description="A small piece of butter (melts at 32-35 °C), chocolate (34 °C) or candle wax (58 °C). Warm it past that and it melts (it shrinks to a "
                                  "puddle): put dabs along a spoon or a rod to see how far the heat has crept, or chocolate in a lamp's beam or the sun.",
                      source="Butter melts between 32 and 35 °C (its milk fat), about 70 kJ/kg; milk chocolate about 34 °C, 45 kJ/kg; paraffin wax 58 °C, 200 kJ/kg "
                             "(provisional; heat-data.ts).",
                      anchor="its centre", facts="a 2 × 1 × 2 cm pat of butter",
                      edit=[{"kind": "size", "w": "width", "h": "height"}, {"kind": "rotate"}]))


def _puddle():
    def build(c, P):
        v = P["water_ml"] / 1e6
        d = math.sqrt(4.0 * v / (math.pi * 0.0015))
        sid = c.slab("water", d, 0.0015, _r5(d), 0.0, 0.00075, material=c.mat(base="puddle water", density=round(v * 998.0 / (_r5(d) * 0.0015 * _r5(d)), 4)),
                     look="water", words="a puddle of water")
        c.process("heat", "heat", role="body", solid=sid, start=float(P["water_temp_c"]), pool=True)
    register(ItemType("puddle", "Puddle of water", CAT, build, module=MODULE, material="puddle water", materials=["puddle water"],
                      props=[Prop("water_ml", "Water", 50.0, 5.0, 1000.0, 5.0, "mL"), Prop("water_temp_c", "Water temperature", 20.0, 0.0, 60.0, 1.0, "°C")],
                      readouts=[Readout("liquid_g", "Water left", "g", 1), Readout("temp", "Temperature", "°C", 1)],
                      tags=["puddle", "spill", "water", "evaporate", "evaporation", "dry", "wet", "rain"],
                      description="A puddle of water about 1.5 mm deep. It slowly evaporates (faster when warm, in the sun or a lamp's beam, or in a fan's wind) "
                                  "and thins, its edge staying put, until it is a film that draws in and dries; in a freezing room it freezes. At 22 °C it dries in about 12 h "
                                  "whatever its size (sooner under a lamp): use a time-lapse.",
                      source="A puddle spreads to about 1.5 mm; 50 mL is 21 cm across. In still air at 22 °C, 50 % humidity, water evaporates about 1.4 g an "
                             "hour from 80 cm² (Carrier's equation [ASHRAE]).",
                      anchor="the middle of its base", facts="50 mL puddle, 21 cm across",
                      edit=[]))


# ---------------------------------------------------------------- rubbing: a hand sanding block
SANDER = (0.08, 0.025, 0.05)      # m: a pine block 8 × 2.5 × 5 cm (100 cm³: 50 g at 500 kg/m³), sandpaper 1 mm under it


def _sander():
    def build(c, P):
        w, h, d = SANDER
        block = c.slab("block", w, h, d, 0.0, 0.001 + h / 2, material=c.mat(base=_have("pine", "varnished hardwood"), density=round(0.05 / (w * h * d), 4), overrides={}),
                       look="wood", words="a wooden sanding block")
        _child(c, "paper", block, {"kind": "slab", "width": w, "height": 0.001, "depth": d}, (0.0, -h / 2 - 0.0005),
               c.mat(base=_have("sandpaper", "varnished hardwood"), overrides={}), _look("sandpaper", "wood"), "the sandpaper under the block")
        t0 = float(P["rub_at"])
        c.process("heat", "rub", role="drive", solid=block, speed=round(P["speed"], 4), stroke=round(P["stroke"], 4), press=round(P["press_n"], 4),
                  **{"from": t0}, until=round(t0 + P["rub_s"], 4))
    register(ItemType("sanding-block", "Sanding block", CAT, build, module=MODULE, material=_have("pine", "varnished hardwood"), materials=[_have("pine", "varnished hardwood")],
                      props=[Prop("press_n", "Pressed with", 5.0, 0.5, 30.0, 0.5, "N", "How hard the hand presses it down (its own weight is 0.5 N more)"),
                             Prop("speed", "Rubbing speed", 0.5, 0.05, 1.5, 0.05, "m/s", "How fast it is pushed back and forth"),
                             Prop("stroke", "Stroke", 0.1, 0.02, 0.3, 0.01, "m", "How far each push goes before it comes back"),
                             Prop("rub_s", "Rubs for", 10.0, 0.5, 30.0, 0.5, "s"),
                             Prop("rub_at", "Starts at", 0.5, 0.0, 20.0, 0.1, "s", "When the rubbing starts (run seconds)")],
                      readouts=[Readout("temp", "Temperature", "°C", 2, "The block's (a lumped mean: its rubbed face gets warmer than this)"),
                                Readout("work_j", "Friction's work", "J", 1, "Heat it has taken in from rubbing (half the friction's work: the rest warms what it rubs)")],
                      tags=["sanding block", "sandpaper", "rubbing", "friction", "rub", "sand", "friction makes heat", "warms by rubbing", "hands rubbing"],
                      description="A small pine block with sandpaper under it that a hand rubs back and forth along what it stands on (a board, the table), "
                                  "pressing down. Friction's work turns to heat in the block and the surface (half each): honest, small sizes, +0.1 °C for 10 s "
                                  "at 5 N and 0.5 m/s (its rubbed face gets much warmer than its mean). A thermometer touching it reads it.",
                      source="Friction's work μ·N·v·t from the engine's own contact impulses: sandpaper on wood μ about 0.6; 5 N, 0.5 m/s for 10 s give about 16 J, "
                             "8 J into a 56 g block (pine 1380 J/(kg·K) [INC Table A.3]): about +0.1 °C.",
                      anchor="the middle of its base (the sandpaper's underside)", facts="pine 8 × 2.5 × 5 cm, 50 g, pressed with 5 N",
                      edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- a jar over a candle
JAR_T = 0.003    # m: its glass


def jar_size(volume_ml):
    """A jar's inside: diameter and height (m) for its volume, standing 1.3 times as tall as it is wide (a 1 L jar: 9.9 × 12.9 cm)."""
    k = 4.0 * (volume_ml / 1e6) / (1.3 * math.pi)
    D = 0.1
    for _ in range(60):
        # (the cube root by Newton's method, 60 fixed steps: the same bits as web/sim's port on any machine)
        D = (2.0 * D + k / (D * D)) / 3.0
    return D, 1.3 * D


def _jar():
    def build(c, P):
        D, H = jar_size(P["volume_ml"])
        t = JAR_T
        # its weight: a real round jar's glass (π·D·H + π·D²/4)·t at 2500 kg/m³; the side view's slabs are as deep as the jar
        mass = 2500.0 * t * (math.pi * D * H + math.pi * D * D / 4)
        vol = (D + 2 * t) * t * (D + 2 * t) + 2 * t * H * (D + 2 * t)
        m = c.mat(base="glass", density=round(mass / vol, 4), overrides={})
        top = c.slab("top", D + 2 * t, t, _r5(D + 2 * t), 0.0, H + t / 2, material=m, look="jar glass", words="an upside-down glass jar")
        for side, nm in ((-1, "wall-left"), (1, "wall-right")):
            _child(c, nm, top, {"kind": "slab", "width": t, "height": _r5(H), "depth": _r5(D + 2 * t)}, (side * (D / 2 + t / 2), -H / 2 - t / 2), m, "jar glass",
                   "the glass wall of the jar")
        c.process("heat", "air", role="jar", solid=top, x0=_r6(-D / 2), x1=_r6(D / 2), y0=_r6(-t / 2 - H), y1=_r6(-t / 2), volume=round(math.pi * D * D / 4 * H, 9))
    register(ItemType("candle-jar", "Jar over a candle", CAT, build, module=MODULE, material="glass", materials=["glass"],
                      props=[Prop("volume_ml", "Holds", 1000.0, 250.0, 4000.0, 50.0, "mL", "A bigger jar holds more air: a candle under it burns longer")],
                      readouts=[Readout("o2_pct", "Oxygen inside", "%", 1, "Air is 20.9 % oxygen; a candle flame goes out near 16 %")],
                      tags=["jar", "glass jar", "candle under a jar", "oxygen", "air", "combustion", "snuffer", "bell jar", "candle goes out"],
                      description="A glass jar stood mouth-down on the table (its anchor is the middle of its mouth): put it over a short lit candle "
                                  "(candle height 0.08 m or so, centred under it) and the flame uses up the oxygen in the trapped air and goes out at about "
                                  "16 %: a 1 L jar in about 10-15 s, a 2 L jar twice as long; the same candle in the open keeps burning.",
                      source="Paraffin takes 3.45 g of oxygen a gram and a candle burns 0.1 g a minute [NIST-CANDLE]: 4.3 mL of oxygen a second from air at "
                             "20.95 % (NOAA); candle flames go out near 16 % (provisional). A 1 L jar 10 cm across, 13 cm tall, 3 mm glass, about 0.4 kg.",
                      anchor="the middle of its mouth (its rim on the table)", facts="1 L glass jar, mouth down",
                      edit=[]))


# ---------------------------------------------------------------- solids expand: the ball and ring, the bimetal strip
# linear expansion [CRC] (tooling/src/sim/heat-data.ts EXPANSION): brass 19e-6/K, steel 12e-6/K; Young's moduli brass 100 GPa, steel 200 GPa
ALPHA = {"brass": 1.9e-05, "steel": 1.2e-05}
YOUNG = {"brass": 1.0e11, "steel": 2.0e11}
RING_OUT = 0.045    # m: the ring's outside diameter
RING_T = 0.006      # m: its thickness
STRIP_T = 0.0006    # m: each layer of a bimetal strip


def _ball_ring():
    def build(c, P):
        hole = P["hole_mm"] / 1000.0
        ball = P["ball_mm"] / 1000.0
        H = P["ring_height"]
        steel = c.mat(base="steel", overrides={})
        c.slab("base", 0.14, 0.012, 0.1, 0.0, 0.006, material=steel, look="steel", words="the stand's base", kind="static")
        c.slab("post", 0.01, H, 0.01, -0.06, 0.012 + H / 2, material=steel, look="steel", words="the stand's post", kind="static")
        jaw = (RING_OUT - hole) / 2
        c.slab("arm", 0.06 - RING_OUT / 2 - 0.005, 0.006, 0.008, -0.06 + (0.06 - RING_OUT / 2 + 0.005) / 2, 0.012 + H, material=steel, look="steel",
               words="the stand's arm", kind="static")
        for side, nm in ((-1, "ring-left"), (1, "ring-right")):
            c.slab(nm, _r5(jaw), RING_T, RING_OUT, side * (hole / 2 + jaw / 2), 0.012 + H, material=steel, look="steel", words="a steel ring", kind="static")
        y0 = 0.012 + H + RING_T / 2 + P["drop"] + ball / 2
        c.ball("ball", ball / 2, 0.0, y0, material=c.mat(base=_have("brass", "steel"), overrides={}), look=_look("brass", "steel"), words="a brass ball")
        c.process("heat", "ball-heat", role="body", solid=c.sid("ball"), start=float(P["ball_temp_c"]), expand=ALPHA["brass"], size=_r6(ball), ref=20.0)
        c.process("heat", "ring-heat", role="body", solid=c.sid("ring-left"), **{"with": [c.sid("ring-right")]}, start=float(P["ring_temp_c"]),
                  expand=ALPHA["steel"], size=_r6(hole), ref=20.0)
        c.process("heat", "fit", role="ring", ball=c.sid("ball"), jaws=[c.sid("ring-left"), c.sid("ring-right")])
    register(ItemType("ball-and-ring", "Ball and ring", CAT, build, module=MODULE, material=_have("brass", "steel"), materials=[_have("brass", "steel")],
                      props=[Prop("ball_temp_c", "Ball's temperature", 20.0, -20.0, 600.0, 5.0, "°C", "Heated in a flame it is 300-500 °C"),
                             Prop("ring_temp_c", "Ring's temperature", 20.0, -20.0, 600.0, 5.0, "°C"),
                             Prop("ball_mm", "Ball", 25.4, 10.0, 50.0, 0.01, "mm", "Its diameter at 20 °C"),
                             Prop("hole_mm", "Ring's hole", 25.45, 10.0, 50.0, 0.01, "mm", "The hole's diameter at 20 °C: the ball just passes when both are cold"),
                             Prop("drop", "Dropped from", 0.04, 0.0, 0.2, 0.005, "m", "How far above the ring the hand lets it go"),
                             Prop("ring_height", "Ring height", 0.2, 0.08, 0.4, 0.01, "m")],
                      readouts=[Readout("ball_mm", "Ball", "mm", 3, "Its diameter now (it grows 0.48 µm a °C)"), Readout("hole_mm", "Hole", "mm", 3),
                                Readout("fits", "Fits", "", 0, "1 while the ball is smaller than the hole"), Readout("through", "Went through", "", 0),
                                Readout("temp", "Ball's temperature", "°C", 0)],
                      tags=["ball and ring", "expansion", "thermal expansion", "expand", "metal expands", "heat makes things bigger", "gravesande", "particles move apart"],
                      description="The classic ball-and-ring: a brass ball dropped onto a steel ring it just passes when cold. Heated (ball_temp_c 300) it is "
                                  "0.13 mm bigger and sits on the ring until it cools (or heat the ring too: it passes again). The fit is decided by their true "
                                  "sizes, 1 + α·ΔT each (brass 19e-6/K, steel 12e-6/K).",
                      source="Linear expansion brass 19e-6/K, steel 12e-6/K [CRC]: a 25.4 mm ball at 300 °C is 25.535 mm, past a 25.45 mm hole (a 0.05 mm "
                             "clearance: provisional; real sets vary).",
                      anchor="the middle of the stand's base", facts="25.4 mm brass ball, 25.45 mm steel ring", edit=[]))


def _bimetal():
    def build(c, P):
        L = P["length"]
        H = P["height"]
        top, bottom = ("brass", "steel") if P["layers"] == "brass on steel" else ("steel", "brass")
        steel = c.mat(base="steel", overrides={})
        c.slab("base", 0.1, 0.012, 0.08, 0.0, 0.006, material=steel, look="steel", words="the stand's base", kind="static")
        c.slab("post", 0.012, H, 0.012, -0.03, 0.012 + H / 2, material=steel, look="steel", words="the stand's post", kind="static")
        c.slab("clamp", 0.03, 0.02, 0.02, -0.015, 0.012 + H, material=steel, look="steel", words="the clamp", kind="static")
        y = 0.012 + H
        c.slab("strip-top", L, STRIP_T, 0.01, L / 2, y + STRIP_T / 2, material=c.mat(base=_have(top, "steel"), overrides={}), look=_look(top, "steel"),
               words=f"a bimetal strip's {top}", kind="static")
        c.slab("strip-bottom", L, STRIP_T, 0.01, L / 2, y - STRIP_T / 2, material=c.mat(base=_have(bottom, "steel"), overrides={}), look=_look(bottom, "steel"),
               words=f"a bimetal strip's {bottom}", kind="static")
        c.process("heat", "heat", role="body", solid=c.sid("strip-top"), **{"with": [c.sid("strip-bottom")]}, start=float(P["start_temp_c"]),
                  bend={"a1": ALPHA[bottom], "a2": ALPHA[top], "e1": YOUNG[bottom], "e2": YOUNG[top], "t1": STRIP_T, "t2": STRIP_T, "length": _r5(L), "ref": 20.0})
    register(ItemType("bimetal-strip", "Bimetal strip", CAT, build, dynamic=False, module=MODULE, material=_have("brass", "steel"), materials=[_have("brass", "steel")],
                      props=[Prop("layers", "Layers", "brass on steel", kind="choice", choices=["brass on steel", "steel on brass"],
                                  help="Brass expands more than steel: heated, the strip curls toward the steel side (down with brass on top)"),
                             Prop("length", "Length", 0.1, 0.04, 0.2, 0.005, "m"), Prop("height", "Height", 0.12, 0.05, 0.3, 0.005, "m", "Its clamp's height"),
                             Prop("start_temp_c", "Start temperature", 20.0, -20.0, 400.0, 5.0, "°C", "It is straight at 20 °C")],
                      readouts=[Readout("bend_mm", "Tip moves", "mm", 1, "Down with brass on top (toward the steel), as it heats"),
                                Readout("bend_deg", "Bent by", "°", 1), Readout("temp", "Temperature", "°C", 0)],
                      tags=["bimetal", "bimetallic strip", "thermostat", "expansion", "metal expands", "bends when heated", "fire alarm"],
                      description="A strip of brass bonded to steel, clamped at its left end. Heat it (a candle flame under it, a hot plate, a lamp, or start "
                                  "it hot) and it curls toward the steel, because brass expands more: about 4 mm at the tip of a 10 cm strip for 100 °C. "
                                  "A thermostat's or fire alarm's switch.",
                      source="Timoshenko 1925: κ = 6 (α2 − α1) ΔT (1 + m)² / (h (3 (1 + m)² + (1 + mn)(m² + 1/(mn)))); brass 19e-6/K, 100 GPa; steel 12e-6/K, "
                             "200 GPa [CRC]; two 0.6 mm layers, 1 cm wide.", anchor="the middle of the stand's base", facts="10 cm brass-steel strip", edit=[]))


# ---------------------------------------------------------------- goal kinds (web/sim/modules/heat.js has the same, number for number)
def _lapse(ctx):
    s = ctx.doc.get("settings") or {}
    v = s.get("timeLapse")
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 1.0


def _clock_text(s):
    """Lesson time for a label: 45 s, 12 min, 1 h 30 min."""
    if s < 60:
        return f"{round(s)} s"
    m = int(round(s / 60.0))
    if m < 60:
        return f"{m} min"
    return f"{m // 60} h" if m % 60 == 0 else f"{m // 60} h {m % 60} min"


def _lesson_s(ctx, g, s_key, min_key):
    """A goal's lesson time, s: its minutes field (by_min, at_min: what the AI writes) × 60, else its seconds field (before_s, at_s), else None."""
    m = ctx.num(g.get(min_key))
    if m is not None:
        return m * 60.0
    return ctx.num(g.get(s_key))


def _when_label(by):
    return "" if by is None else f" within {_clock_text(by)}"


def _melt_time(ctx, iid):
    """The run's time (s) its ice first counts as melted (99.5 %), or None."""
    return ctx.first_time(iid, "melted", lambda v: v >= 0.995)


def _end(ctx, iid, key):
    v = ctx.state(iid, key)
    return v[-1] if v else None


def goal_melts(ctx, g):
    """{kind: "melts", item, by_min? | before_s?}: the item (an ice cube, butter, chocolate, wax) melts completely (99.5 % of it), within before_s of
    lesson time (the run's time × the time-lapse) if given."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "melted") is None:
        return None
    by = _lesson_s(ctx, g, "before_s", "by_min")
    lapse = _lapse(ctx)
    t = _melt_time(ctx, iid)
    lesson = None if t is None else round(t * lapse, 1)
    ok = lesson is not None and (by is None or lesson <= by)
    return {"label": g.get("label") or f"{ctx.name(iid)} melts{_when_label(by)}", "ok": ok, "kind": "melts", "item": iid, "t": lesson,
            "melted": round(_end(ctx, iid, "melted"), 3)}


def goal_melts_first(ctx, g):
    """{kind: "melts_first", a, b}: a melts completely before b; when neither finishes, a has melted more by the end (by 2 % points)."""
    a, b = g.get("a"), g.get("b")
    if not ctx.known(a) or not ctx.known(b) or ctx.state(a, "melted") is None or ctx.state(b, "melted") is None:
        return None
    ta, tb = _melt_time(ctx, a), _melt_time(ctx, b)
    fa, fb = _end(ctx, a, "melted"), _end(ctx, b, "melted")
    if ta is not None:
        ok = tb is None or ta < tb
    elif tb is not None:
        ok = False
    else:
        ok = fa >= fb + 0.02
    lapse = _lapse(ctx)
    return {"label": g.get("label") or f"{ctx.name(a)} melts before {ctx.name(b)}", "ok": ok, "kind": "melts_first", "a": a, "b": b,
            "t_a": None if ta is None else round(ta * lapse, 1), "t_b": None if tb is None else round(tb * lapse, 1),
            "melted_a": round(fa, 3), "melted_b": round(fb, 3)}


def goal_melt_fraction(ctx, g):
    """{kind: "melt_fraction", item, at_least?, at_most?, at_min? | at_s?}: the share of it melted at at_min (at_s) of lesson time (default the end) is within the bounds."""
    iid = g.get("item")
    v = ctx.state(iid, "melted") if ctx.known(iid) else None
    if v is None:
        return None
    lo, hi, at = ctx.num(g.get("at_least")), ctx.num(g.get("at_most")), _lesson_s(ctx, g, "at_s", "at_min")
    if lo is None and hi is None:
        return None
    lapse = _lapse(ctx)
    k = len(v) - 1
    if at is not None:
        k = 0
        for i, t in enumerate(ctx.times):
            if t * lapse <= at + 1e-9:
                k = i
    f = v[k]
    ok = (lo is None or f >= lo) and (hi is None or f <= hi)
    bound = " and ".join(([f"at least {round(lo * 100)} %"] if lo is not None else []) + ([f"at most {round(hi * 100)} %"] if hi is not None else []))
    when = "" if at is None else f" after {_clock_text(at)}"
    return {"label": g.get("label") or f"{ctx.name(iid)} is {bound} melted{when}", "ok": ok, "kind": "melt_fraction", "item": iid, "melted": round(f, 3)}


TEMP_KEYS = ("reading", "water_temp", "liquid_temp", "sand:temp", "temp")


def _temp_key(ctx, iid):
    for k in TEMP_KEYS:
        if ctx.state(iid, k) is not None:
            return k
    return None


def goal_reaches(ctx, g):
    """{kind: "reaches", item, at_least_c?, at_most_c?, by_min? | before_s?}: the item's temperature (a thermometer's reading, a cup's or pot's water, else
    the item's own) reaches at least at_least_c (or falls to at most at_most_c), within before_s of lesson time if given."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    key = _temp_key(ctx, iid)
    lo, hi = ctx.num(g.get("at_least_c")), ctx.num(g.get("at_most_c"))
    if key is None or (lo is None and hi is None):
        return None
    by = _lesson_s(ctx, g, "before_s", "by_min")
    test = (lambda v: v >= lo) if lo is not None else (lambda v: v <= hi)
    t = ctx.first_time(iid, key, test)
    lapse = _lapse(ctx)
    lesson = None if t is None else round(t * lapse, 1)
    # (a thermometer put in water whose bulb has left it when it gets there reads something else, a hot plate or the air: not met, and said)
    left = False
    wet = ctx.state(iid, "in_water") if key == "reading" else None
    if t is not None and wet and wet[0] is not None and wet[0] >= 1:
        v = ctx.state(iid, key)
        k = next(i for i, x in enumerate(v) if x is not None and test(x))
        left = k < len(wet) and wet[k] is not None and wet[k] < 1
    ok = lesson is not None and (by is None or lesson <= by) and not left
    what = f"at least {lo:g} °C" if lo is not None else f"{hi:g} °C or less"
    verb = "reaches" if lo is not None else "cools to"
    out = {"label": g.get("label") or f"{ctx.name(iid)} {verb} {what}{_when_label(by)}", "ok": ok, "kind": "reaches", "item": iid, "t": lesson,
           "end_c": round(_end(ctx, iid, key), 2)}
    if left:
        out["left_water"] = True
    return out


def goal_warmer(ctx, g):
    """{kind: "warmer", a, b, at_min? | at_s?}: a is warmer than b by at least 0.5 °C at at_min (at_s) of lesson time (default the end)."""
    a, b = g.get("a"), g.get("b")
    if not ctx.known(a) or not ctx.known(b):
        return None
    ka, kb = _temp_key(ctx, a), _temp_key(ctx, b)
    if ka is None or kb is None:
        return None
    va, vb = ctx.state(a, ka), ctx.state(b, kb)
    at = _lesson_s(ctx, g, "at_s", "at_min")
    k = len(va) - 1
    if at is not None:
        lapse = _lapse(ctx)
        k = 0
        for i, t in enumerate(ctx.times):
            if t * lapse <= at + 1e-9:
                k = i
    ok = va[k] >= vb[k] + 0.5
    when = "" if at is None else f" after {_clock_text(at)}"
    return {"label": g.get("label") or f"{ctx.name(a)} is warmer than {ctx.name(b)}{when}", "ok": ok, "kind": "warmer", "a": a, "b": b,
            "a_c": round(va[k], 2), "b_c": round(vb[k], 2)}


def goal_boils(ctx, g):
    """{kind: "boils", item, by_min? | before_s?}: the water in it boils, within before_s of lesson time if given."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "boiling") is None:
        return None
    by = _lesson_s(ctx, g, "before_s", "by_min")
    t = ctx.first_time(iid, "boiling", lambda v: v >= 1)
    lesson = None if t is None else round(t * _lapse(ctx), 1)
    return {"label": g.get("label") or f"the water in {ctx.name(iid)} boils{_when_label(by)}", "ok": lesson is not None and (by is None or lesson <= by),
            "kind": "boils", "item": iid, "t": lesson}


def goal_freezes(ctx, g):
    """{kind: "freezes", item, by_min? | before_s?}: the water in it (a cup's, a pot's, a puddle) is all ice, within before_s of lesson time if given."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    ice = ctx.state(iid, "ice_g")
    water = ctx.state(iid, "water_g") if ctx.state(iid, "water_g") is not None else ctx.state(iid, "liquid_g")
    if ice is None or water is None:
        return None
    t = None
    for tt, i, w in zip(ctx.times, ice, water):
        if i > 0 and w <= 0:
            t = tt
            break
    by = _lesson_s(ctx, g, "before_s", "by_min")
    lesson = None if t is None else round(t * _lapse(ctx), 1)
    return {"label": g.get("label") or f"{ctx.name(iid)} freezes{_when_label(by)}", "ok": lesson is not None and (by is None or lesson <= by),
            "kind": "freezes", "item": iid, "t": lesson}


def goal_dries(ctx, g):
    """{kind: "dries", item, by_min? | before_s?}: a puddle (or the puddle a melted cube left, or the water in a cup or pan) evaporates or boils away (under
    0.05 g left), within before_s of lesson time if given."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    if ctx.items[iid]["type"] == "puddle":
        key = "liquid_g"
    elif ctx.state(iid, "water_g") is not None:
        key = "water_g"
    else:
        key = "puddle_g"
    v = ctx.state(iid, key)
    if v is None:
        return None
    by = _lesson_s(ctx, g, "before_s", "by_min")
    seen = False
    t = None
    for tt, x in zip(ctx.times, v):
        if x > 0.05:
            seen = True
        elif seen:
            t = tt
            break
    lesson = None if t is None else round(t * _lapse(ctx), 1)
    return {"label": g.get("label") or f"{ctx.name(iid)} dries up{_when_label(by)}", "ok": lesson is not None and (by is None or lesson <= by),
            "kind": "dries", "item": iid, "t": lesson, "left_g": round(v[-1], 2)}


def goal_dew(ctx, g):
    """{kind: "dew", item}: water condenses on the item (a cold can or glass sweats): at least 0.05 g of dew stands on it at some moment."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    v = ctx.state(iid, "wet_g")
    most = max(v) if v else 0.0
    return {"label": g.get("label") or f"water condenses on {ctx.name(iid)}", "ok": most >= 0.05, "kind": "dew", "item": iid, "most_g": round(most, 3)}


def _first_after(ctx, iid, key, test, after=None):
    """The run's time (s) a reading first passes a test (after time `after`, if given), or None."""
    v = ctx.state(iid, key)
    if not v:
        return None
    for t, x in zip(ctx.times, v):
        if (after is None or t > after) and test(x):
            return t
    return None


def goal_burns_out(ctx, g):
    """{kind: "burns_out", item, by_min? | before_s?}: the candle's flame goes out (a jar's oxygen used up, its wax gone), within before_s of lesson
    time if given."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "flame") is None:
        return None
    lit = ctx.first_time(iid, "flame", lambda v: v >= 1)
    out = None if lit is None else _first_after(ctx, iid, "flame", lambda v: v < 1, lit)
    by = _lesson_s(ctx, g, "before_s", "by_min")
    lesson = None if out is None else round(out * _lapse(ctx), 1)
    return {"label": g.get("label") or f"{ctx.name(iid)} goes out{_when_label(by)}", "ok": lesson is not None and (by is None or lesson <= by),
            "kind": "burns_out", "item": iid, "t": lesson, "burned_g": round(_end(ctx, iid, "burned_g") or 0.0, 3)}


def goal_scorches(ctx, g):
    """{kind: "scorches", item, by_min? | before_s?}: concentrated light (a magnifying glass's focus) makes the item's hottest spot pass its scorch
    point (paper 233 °C), within before_s of lesson time if given."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    t = ctx.first_time(iid, "scorched", lambda v: v >= 1)
    v = ctx.state(iid, "spot_temp")
    most = max(v) if v else None
    by = _lesson_s(ctx, g, "before_s", "by_min")
    lesson = None if t is None else round(t * _lapse(ctx), 1)
    return {"label": g.get("label") or f"{ctx.name(iid)} scorches{_when_label(by)}", "ok": lesson is not None and (by is None or lesson <= by),
            "kind": "scorches", "item": iid, "t": lesson, "hottest_c": None if most is None else round(most, 1)}


def goal_passes_through(ctx, g):
    """{kind: "passes_through", item, passes?}: a ball-and-ring's ball goes through its ring by the end (passes false: it stays stuck on it)."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "through") is None:
        return None
    want = g.get("passes")
    want = True if not isinstance(want, bool) else want
    went = (_end(ctx, iid, "through") or 0.0) >= 1
    nm = ctx.name(iid)
    return {"label": g.get("label") or (f"the ball of {nm} passes through the ring" if want else f"the ball of {nm} stays stuck on the ring"),
            "ok": went == want, "kind": "passes_through", "item": iid, "through": went,
            "ball_mm": round(_end(ctx, iid, "ball_mm") or 0.0, 3), "hole_mm": round(_end(ctx, iid, "hole_mm") or 0.0, 3)}


def goal_bends(ctx, g):
    """{kind: "bends", item, at_least_mm?}: a bimetal strip's tip moves at least at_least_mm (default 1 mm) as it heats."""
    iid = g.get("item")
    v = ctx.state(iid, "bend_mm") if ctx.known(iid) else None
    if not v:
        return None
    lo = ctx.num(g.get("at_least_mm"))
    lo = 1.0 if lo is None else lo
    most = max(abs(x) for x in v)
    return {"label": g.get("label") or f"{ctx.name(iid)} bends at least {lo:g} mm", "ok": most >= lo, "kind": "bends", "item": iid, "most_mm": round(most, 2)}


# (a temperature rise, "warms_by", is the matter module's goal kind: it reads heat's temp, reading and water_temp)


GOALS = (("melts", goal_melts), ("melts_first", goal_melts_first), ("melt_fraction", goal_melt_fraction), ("reaches", goal_reaches),
         ("warmer", goal_warmer), ("boils", goal_boils), ("freezes", goal_freezes), ("dries", goal_dries), ("dew", goal_dew),
         ("burns_out", goal_burns_out), ("scorches", goal_scorches), ("passes_through", goal_passes_through), ("bends", goal_bends))
