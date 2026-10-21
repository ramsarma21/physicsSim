"""Scenes made of catalog items, turned into the engine's scene document (playground copy only).

scene = {"version": 2, "name": str, "seconds": float, "release": float (s, when held items let go),
         "stage": {"x0", "x1", "y0", "y1"} (m, the scene's edges), "items": [item, ...], "goals": [goal, ...]}
item  = {"id": str, "type": catalog key, "x": m, "y": m, "angle": degrees counter-clockwise,
         "props": {key: value} (only what differs from the type's defaults), "held": bool, "fixed": bool, "name": str}
goal  = {"kind": "in", "item": item id, "container": item id, "label": str}

Every item type says what its (x, y) is (its anchor, usually its centre) and builds its solids in its own
frame; build() places them in the world. Item types live in TYPES: the core ones here, the rest of the
catalog in catalog_items.py, catalog_everyday.py and catalog_mechanisms.py (imported at the end).
"""
import hashlib
import json
import math
import os
import struct

from crmath import cos, cube, sin  # x ** 3 correctly rounded, and sin/cos with web/sim's table at multiples of 30 degrees: the same bits as web/sim on any machine

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.dirname(HERE)
SCENES = os.path.join(PG, "scenes")
SPRITES = os.path.join(SCENES, "rube", "sprites")
D2R = math.pi / 180
CORD = 2.6

# ---------------------------------------------------------------- materials
# bounce: restitution against a perfectly rigid surface; two materials meet with bounce_a * bounce_b
# unless the pair was measured (MEASURED). friction: Coulomb; two meet with sqrt(f_a * f_b).
# rolling: rolling-resistance coefficient (the larger of the two applies). side: sideways spring-back
# (Garwin e_x) of a gripping, springy surface; grip: the friction that limits it during a bounce.
MATERIALS = {
    "varnished hardwood": dict(density=700, bounce=0.93, friction=0.45, rolling=0.0, side=0.0, look="wood",
                               source="Density: hardwood 600-800 kg/m³. Bounce chosen so a superball on it gives Cross's measured 0.86."),
    "domino wood": dict(density=700, bounce=0.93, friction=0.4, rolling=0.0, side=0.0, look="light wood",
                        source="Hardwood; domino-on-domino values calibrated to Larham's measured wave speed."),
    "solid rubber": dict(density=906, bounce=0.925, friction=0.52, rolling=0.012, side=0.55, grip=0.9, look="rubber",
                         source="102.5 g, 60 mm superball (Cross, Am. J. Phys. 70, 482 and 1093, 2002); e 0.86 on a wood floor."),
    "hollow plastic": dict(density=950, bounce=0.806, friction=0.33, rolling=0.02, side=0.15, look="plastic",
                           source="Polyethylene 910-960 kg/m³; e from a 92 cm drop rebounding 43.6 cm with drag removed (Physics Factbook)."),
    "modeling clay": dict(density=1570, bounce=0.054, friction=0.9, rolling=0.3, side=0.0, yieldStrength=120000, look="clay",
                          source="Van Aken plasticine 1570 kg/m³ (Eckerson et al. 2008); flow stress 0.08-0.175 MPa (Sofuoglu & Rasty 2000)."),
    "steel": dict(density=7850, bounce=0.95, friction=0.4, rolling=0.001, side=0.1, look="steel",
                  source="Carbon steel 7850 kg/m³; hard steel-on-steel restitution about 0.9-0.95 at low speed."),
}

# Measured (or deliberately calibrated) pairs: these override the mixing rule.
MEASURED = {}


def measured(a, b, **kw):
    MEASURED[frozenset((a, b))] = kw


measured("solid rubber", "varnished hardwood", friction=0.52, restitution=0.86, rollingResistance=0.012, tangentRestitution=0.55, grip=0.9,
         source="Restitution 0.86 and friction 0.52: Cross, Am. J. Phys. 70, 482 (2002); sideways e_x 0.49-0.76 (Cross 2002; Garwin 1969). Rolling resistance provisional.")
measured("hollow plastic", "varnished hardwood", friction=0.33, restitution=0.75, rollingResistance=0.02, tangentRestitution=0.15,
         source="A hollow hard plastic ball dropped 92 cm rebounded 43.6 cm (Physics Factbook), e 0.75 with drag removed. Friction: polyethylene on wood (Murase 1984).")
measured("modeling clay", "varnished hardwood", friction=0.9, restitution=0.05, rollingResistance=0.3, source="Provisional: clay barely bounces.")
measured("varnished hardwood", "varnished hardwood", friction=0.4, restitution=0.3, rollingResistance=0.0,
         source="Dry wood on wood friction 0.25-0.5 (Engineering ToolBox); restitution provisional.")
measured("domino wood", "domino wood", friction=0.1, restitution=0.3, rollingResistance=0.0,
         source="Calibrated: the domino wave runs 1.49 sqrt(gH), Larham's measured 1.50 (arXiv:1302.3311).")
measured("domino wood", "varnished hardwood", friction=0.4, restitution=0.3, rollingResistance=0.0, source="Dry wood on wood (Engineering ToolBox).")
for _ball in ("solid rubber", "hollow plastic", "modeling clay"):
    MEASURED[frozenset((_ball, "domino wood"))] = dict(MEASURED[frozenset((_ball, "varnished hardwood"))])
measured("solid rubber", "hollow plastic", friction=0.4, restitution=0.6, rollingResistance=0.0, source="Provisional (ball on ball).")
measured("hollow plastic", "hollow plastic", friction=0.4, restitution=0.6, rollingResistance=0.0, source="Provisional (ball on ball).")
measured("modeling clay", "hollow plastic", friction=0.4, restitution=0.05, rollingResistance=0.0, source="Provisional (ball on ball).")

MATERIAL_KEYS = ("bounce", "friction", "rolling", "side")


def material_of(base, overrides=None):
    """A material's values with an item's own changes."""
    m = dict(MATERIALS[base])
    for k, v in (overrides or {}).items():
        if v is not None:
            m[k] = float(v)
    return m


def contact(a, b):
    """How two material instances (dicts with "base") meet."""
    pa, pb = a["props"], b["props"]
    key = frozenset((a["base"], b["base"]))
    if key in MEASURED:
        base_a, base_b = MATERIALS[a["base"]], MATERIALS[b["base"]]
        c = dict(MEASURED[key])
        # an item's own bounce or friction scales the measured pair by how far it moved from its material's
        rb = (pa["bounce"] / base_a["bounce"] if base_a["bounce"] else 1) * (pb["bounce"] / base_b["bounce"] if base_b["bounce"] else 1)
        rf = math.sqrt((pa["friction"] / base_a["friction"] if base_a["friction"] else 1) * (pb["friction"] / base_b["friction"] if base_b["friction"] else 1))
        if abs(rb - 1) > 1e-9:
            c["restitution"] = min(1.0, c["restitution"] * rb)
        if abs(rf - 1) > 1e-9:
            c["friction"] = c["friction"] * rf
            if "grip" in c:
                c["grip"] = c["grip"] * rf
        if pa["rolling"] != base_a["rolling"] or pb["rolling"] != base_b["rolling"]:
            c["rollingResistance"] = max(pa["rolling"], pb["rolling"])
        if pa["side"] != base_a["side"] or pb["side"] != base_b["side"]:
            c["tangentRestitution"] = max(pa["side"], pb["side"])
        return c
    side = max(pa["side"], pb["side"]) if min(pa["bounce"], pb["bounce"]) >= 0.5 else 0.0
    c = {"friction": round(math.sqrt(pa["friction"] * pb["friction"]), 4), "restitution": round(pa["bounce"] * pb["bounce"], 4),
         "rollingResistance": max(pa["rolling"], pb["rolling"]),
         "source": "Mixed from each material's own values (bounce a x bounce b, friction sqrt(a x b)); provisional."}
    if side > 0:
        c["tangentRestitution"] = side
        c["grip"] = max(pa.get("grip", pa["friction"]), pb.get("grip", pb["friction"]))
    return c


# ---------------------------------------------------------------- item types
class Prop:
    """One setting an item shows on the left: a number (with range), an int, a yes/no, or a choice."""

    def __init__(self, key, label, default, lo=None, hi=None, step=None, unit="", help="", kind="number", choices=None, auto=False, slider_max=None,
                 open=False):
        self.key, self.label, self.default, self.lo, self.hi, self.step = key, label, default, lo, hi, step
        self.unit, self.help, self.kind, self.choices, self.auto, self.slider_max = unit, help, kind, choices, auto, slider_max
        self.open = open   # a choice that also takes any other text of up to 64 characters (a colour's "#rrggbb", as a ball's colour always could)

    def json(self):
        d = {"key": self.key, "label": self.label, "default": self.default, "kind": self.kind, "unit": self.unit, "help": self.help}
        if self.auto:      # the default is for the default size: the built item's value (resolved) follows other props until this is set;
            d["auto"] = list(self.auto) if isinstance(self.auto, (list, tuple)) else True   # auto lists the keys it follows (true = every prop that is not auto itself)
        if self.kind in ("number", "int"):
            d.update(min=self.lo, max=self.hi, step=self.step)
            if self.slider_max is not None:     # the slider's own top (min..max is what a typed value may be; the slider needs a handy range)
                d["slider_max"] = self.slider_max
        if self.choices:
            d["choices"] = self.choices
        if self.open:
            d["open"] = True
        return d


class Link:
    """A link from an item to another item of the scene (a stopwatch's watched car, a wire's ends, a lamp's switch): the other item's id,
    stored in the item's props under `key` like any prop (a string; an unlinked one has none). `types`: the catalog keys it may name (empty:
    any). The builder reads it with c.link(key): the id when it names an item of the scene (of one of those types), else None. Listed in the
    type's catalog entry as `links` (only types that have some), never in `props`, so a scene's checks (web/server.py clean) keep it as an
    optional prop of up to 64 characters, as they keep a ball's colour."""

    def __init__(self, key, label, types=(), help=""):
        self.key, self.label, self.types, self.help = key, label, list(types), help

    def json(self):
        return {"key": self.key, "label": self.label, "kind": "link", "types": list(self.types), "help": self.help}


class Readout:
    """A reading the run makes of an item (a module's process sets it: tooling/src/sim/plugins.ts ctx.set(item, key, value)): what the
    track's state[item][key] means, for the inspector, the view's labels and the AI. digits: decimals to show. words: what a state code
    means, {0: "whole", 1: "cracked", 2: "in pieces"} (whole numbers only): the inspector and the edit step's digest show the word, never
    "Broken 1"; listed in the entry as {"0": "whole", ...}, in number order (web/sim/items.js Readout the same)."""

    def __init__(self, key, label, unit="", digits=1, help="", words=None):
        self.key, self.label, self.unit, self.digits, self.help = key, label, unit, digits, help
        self.words = readout_words(words, key)

    def json(self):
        d = {"key": self.key, "label": self.label, "unit": self.unit, "digits": self.digits, "help": self.help}
        if self.words:
            d["words"] = self.words
        return d


def readout_words(words, key="?"):
    """A readout's value words: {code (a whole number): word} -> {"<code>": word} in number order, or None."""
    if not words:
        return None
    out = []
    for k, w in dict(words).items():
        if isinstance(k, bool) or not isinstance(k, (int, float)) or k != int(k) or not isinstance(w, str) or not w:
            raise ValueError(f"readout {key}: words need whole-number codes and words ({k!r}: {w!r})")
        out.append((int(k), w))
    return {str(k): w for k, w in sorted(out)}


# Props every matching type lists in its catalog entry, given by a module (the mechanics module's colour, start speed, glow): (Prop, applies)
# with applies(ItemType) -> bool. Each is listed in the entry's `props` (marked "common": true) and its default in the entry's `defaults`, but
# never in ItemType.defaults(), so an item that does not set one builds and resolves exactly as before; the module's build hook reads what an
# item sets (web/server.py clean() keeps such props as it keeps a ball's colour). web/sim/items.js COMMON_PROPS is the same list.
COMMON_PROPS = []


def register_common_prop(prop, applies=None):
    COMMON_PROPS.append((prop, applies or (lambda t: True)))
    return prop


class ItemType:
    """A catalog entry. build(ctx, P) adds its solids in its own frame (its anchor at the origin)."""

    def __init__(self, key, name, category, build, props=(), tags=(), description="", source="", dynamic=True, material=None,
                 materials=(), anchor="its centre", edit=(), facts="", hidden_3d=False, color=None, links=(), readouts=(), module=None):
        self.key, self.name, self.category, self.build_fn = key, name, category, build
        self.props, self.tags, self.description, self.source = list(props), list(tags), description, source
        self.dynamic, self.material, self.materials, self.anchor = dynamic, material, list(materials), anchor
        self.edit, self.facts, self.hidden_3d, self.color = list(edit), facts, hidden_3d, color
        self.links, self.readouts, self.module = list(links), list(readouts), module

    def auto_keys(self):
        """Every `auto` prop of this type and the props each follows: what a built value of an auto prop depends on."""
        keys = set()
        for p in self.props:
            if p.auto:
                keys.add(p.key)
                keys.update(p.auto if isinstance(p.auto, (list, tuple)) else (q.key for q in self.props if not q.auto))
        return keys

    def defaults(self):
        d = {p.key: p.default for p in self.props}
        if self.material:
            d["material"] = self.material
            m = MATERIALS[self.material]
            for k in MATERIAL_KEYS:
                d[k] = m[k]
        return d

    def schema(self):
        props = [p.json() for p in self.props]
        if self.material:
            props.append(Prop("material", "Material", self.material, kind="choice", choices=self.materials or [self.material]).json())
            m = MATERIALS[self.material]
            props += [Prop("bounce", "Bounciness", m["bounce"], 0, 1, 0.01, "", "Against a perfectly hard surface").json(),
                      Prop("friction", "Friction", m["friction"], 0, 2, 0.01).json(),
                      Prop("rolling", "Rolling resistance", m["rolling"], 0, 0.5, 0.001).json(),
                      Prop("side", "Side spring-back", m["side"], 0, 1, 0.01, "", "How a grippy, springy ball kicks back sideways").json()]
        autos = {p.key for p in self.props if p.auto}
        # (a module's common props this type takes (COMMON_PROPS), after its own: listed and defaulted here only, never built by default)
        own = {q["key"] for q in props}
        common = [p for p, ok in COMMON_PROPS if p.key not in own and ok(self)]
        props += [dict(p.json(), common=True) for p in common]
        # (an auto prop has no default of its own: its value at any other size is built, so a value the item sets is always kept)
        defaults = {k: v for k, v in self.defaults().items() if k not in autos}
        for p in common:
            defaults[p.key] = p.default
        d = {"key": self.key, "name": self.name, "category": self.category, "tags": self.tags, "description": self.description,
             "source": self.source, "dynamic": self.dynamic, "anchor": self.anchor, "edit": self.edit, "props": props,
             "defaults": defaults, "facts": self.facts}
        # (a module's types: their links to other items, their readings, and their module; nothing for the others, whose entries stay as they were)
        if self.links:
            d["links"] = [k.json() for k in self.links]
        if self.readouts:
            d["readouts"] = [r.json() for r in self.readouts]
        if self.module:
            d["module"] = self.module
        return d


TYPES = {}
CATEGORIES = ["Balls", "Blocks & shapes", "Surfaces & ramps", "Rods & hinges", "Dominoes", "Containers", "Groups", "Air", "Scenery"]


def register(t):
    TYPES[t.key] = t
    return t


# ---------------------------------------------------------------- building
def polygon_problem(pts):
    """Why points [(x, y)] cannot be a polygon body's outline, or None (the engine's own check, part.ts polygonProblem):
    3 to 8 points, every side at least 0.5 mm, counter-clockwise once around, every corner turning left."""
    n = len(pts)
    if n < 3 or n > 8:
        return f"has {n} points; a polygon body takes 3 to 8"
    for k in range(n):
        (x1, y1), (x2, y2) = pts[k], pts[(k + 1) % n]
        side = math.hypot(x2 - x1, y2 - y1)
        if side < 0.0005:
            return f"has a side {side * 1000:.2f} mm long, from point {k} {pts[k]} to point {(k + 1) % n} {pts[(k + 1) % n]}; the shortest a polygon body's side may be is 0.5 mm"
    if sum(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1] for k in range(n)) <= 0:
        return "runs clockwise (or crosses itself): list its points counter-clockwise, in the solid's frame (x right, y up)"
    turning = 0.0
    for k in range(n):
        (x0, y0), (x1, y1), (x2, y2) = pts[k - 1], pts[k], pts[(k + 1) % n]
        ax, ay, bx, by = x1 - x0, y1 - y0, x2 - x1, y2 - y1
        cross = ax * by - ay * bx
        sine = cross / (math.hypot(ax, ay) * math.hypot(bx, by))
        if sine < -1e-9:
            return f"is not convex: it turns clockwise at point {k} {pts[k]}; make every corner turn left, or build the shape from several convex solids welded together"
        if sine <= 1e-9:
            return f"has point {k} {pts[k]} on the straight line between its neighbours; leave it out"
        turning += math.atan2(cross, ax * bx + ay * by)
    if abs(turning - 2 * math.pi) > 1e-6:
        return f"winds {round(turning / (2 * math.pi))} times around; a convex outline goes around once"
    return None


class Ctx:
    """Collects one item's solids in its own frame and places them in the world."""

    def __init__(self, scene_builder, item, P):
        self.sb, self.item, self.P = scene_builder, item, P
        a = item.get("angle", 0.0) * D2R
        self.ox, self.oy, self.ca, self.sa, self.a = item.get("x", 0.0), item.get("y", 0.0), cos(a), sin(a), a
        self.kind = "static" if (item.get("fixed") or not TYPES[item["type"]].dynamic) else "dynamic"

    def world(self, lx, ly):
        return self.ox + lx * self.ca - ly * self.sa, self.oy + lx * self.sa + ly * self.ca

    def mat(self, base=None, density=None, overrides=None):
        """The material instance for this item: its chosen base with its own bounce/friction/... and density."""
        P = self.P
        base = base or P.get("material") or TYPES[self.item["type"]].material
        props = material_of(base, overrides if overrides is not None else {k: P.get(k) for k in MATERIAL_KEYS})
        if density is not None:
            props["density"] = density
        return self.sb.material(base, props)

    def _solid(self, part, body, lx, ly, langle, material, kind, look, words, extra):
        sid = f"{self.item['id']}/{part}"
        x, y = self.world(lx, ly)
        s = {"kind": kind or self.kind, "id": sid, "words": words or TYPES[self.item["type"]].name.lower(), "body": body, "material": material,
             "at": {"x": round(x, 5), "y": round(y, 5)}, "item": self.item["id"],
             "look": look or MATERIALS[self.sb.base_of(material)]["look"]}
        ang = langle * D2R + self.a
        if abs(ang) > 1e-12:
            s["angle"] = round(ang, 6)
        s.update(extra)
        self.sb.solids.append(s)
        return sid

    def slab(self, part, w, h, depth, lx=0.0, ly=0.0, langle=0.0, material=None, kind=None, look=None, words=None, **extra):
        body = {"kind": "slab", "width": round(w, 5), "height": round(h, 5), "depth": depth}
        if "taper" in extra:
            body["taper"] = extra.pop("taper")
        fill = extra.pop("fill", None)
        sid = self._solid(part, body, lx, ly, langle, material or self.mat(), kind, look, words, extra)
        s = self.sb.solids[-1]
        s.setdefault("placeholder", {"fill": fill or LOOK_FILL.get(s["look"], "#c8955a")})
        s.setdefault("render", {"kind": "procedural", "shade": LOOK_SHADE.get(s["look"], "#8a6a45")})
        s.setdefault("depth", 2)
        return sid

    def poly(self, part, points, depth, lx=0.0, ly=0.0, langle=0.0, material=None, kind=None, look=None, words=None, **extra):
        """A convex prism (a cone's slope, a wedge, a car's hood, an egg): its side outline, 3 to 8 points counter-clockwise,
        each (x, y) or {"x", "y"}, in the solid's own frame: around its origin at (lx, ly) in the item frame, turned langle
        degrees with it (as a slab's width and height are). depth = front-to-back size. Its mass sits at the outline's
        centroid, wherever the origin is. Drawn and placed like a slab; an outline the engine would refuse (clockwise,
        concave, a point on a side's line, a side under 0.5 mm, too few or many points) raises ValueError here."""
        pts = [(p["x"], p["y"]) if isinstance(p, dict) else (p[0], p[1]) for p in points]
        pts = [(round(x, 5), round(y, 5)) for x, y in pts]
        problem = polygon_problem(pts)
        if problem:
            raise ValueError(f"{self.item['id']}/{part}: polygon {problem}")
        body = {"kind": "polygon", "points": [{"x": x, "y": y} for x, y in pts], "depth": depth}
        fill = extra.pop("fill", None)
        sid = self._solid(part, body, lx, ly, langle, material or self.mat(), kind, look, words, extra)
        s = self.sb.solids[-1]
        s.setdefault("placeholder", {"fill": fill or LOOK_FILL.get(s["look"], "#c8955a")})
        s.setdefault("render", {"kind": "procedural", "shade": LOOK_SHADE.get(s["look"], "#8a6a45")})
        s.setdefault("depth", 2)
        return sid

    def ball(self, part, r, lx=0.0, ly=0.0, material=None, kind=None, look=None, words=None, wall=None, inertia=None, **extra):
        body = {"kind": "ball", "radius": round(r, 5)}
        if wall is not None:
            body["wall"] = wall
        if inertia is not None:
            body["inertia"] = inertia
        fill = extra.pop("fill", None)
        sprite = extra.pop("sprite", None)
        sid = self._solid(part, body, lx, ly, 0.0, material or self.mat(), kind, look, words, extra)
        s = self.sb.solids[-1]
        s.setdefault("placeholder", {"fill": fill or LOOK_FILL.get(s["look"], "#888")})
        if sprite:
            s["render"] = {"kind": "rigid"}
            s["sprite"] = sprite
            self.sb.use_sprite(sprite)
        else:
            s.setdefault("render", {"kind": "procedural", "shade": LOOK_SHADE.get(s["look"], "#555")})
        s.setdefault("depth", 4)
        return sid

    def joint(self, kind, part, **fields):
        """A doc joint "<item id>/<part>" (CONTRACT.md Phase 2). a/b/chassis/wheel name this item's parts (None: the world;
        a name with "/" is a solid id kept as is); a world side's anchor, and a pulley's groundA/groundB, are in the item's
        frame and become world points; anchors on a solid stay in that solid's own frame. Points are (x, y) or {"x", "y"}."""
        pt = lambda p: (p["x"], p["y"]) if isinstance(p, dict) else (p[0], p[1])
        here = lambda p: {"x": round(pt(p)[0], 5), "y": round(pt(p)[1], 5)}
        there = lambda p: dict(zip("xy", (round(v, 5) for v in self.world(*pt(p)))))
        j = {"kind": kind, "id": f"{self.item['id']}/{part}", "item": self.item["id"], **fields}
        for side in ("a", "b", "chassis", "wheel"):
            if side in j and j[side] is not None and "/" not in j[side]:
                j[side] = f"{self.item['id']}/{j[side]}"
        for key, side in (("anchorA", "a"), ("anchorB", "b"), ("anchor", "chassis"), ("groundA", None), ("groundB", None)):
            if key in j:
                j[key] = there(j[key]) if side is None or j.get(side) is None else here(j[key])
        self.sb.joints.append(j)
        return j["id"]

    def sid(self, part):
        """This item's solid "<item id>/<part>"."""
        return f"{self.item['id']}/{part}"

    def link(self, key):
        """The item a link prop (Link) names: its id when it is an item of this scene (of one of the link's types), else None."""
        v = self.P.get(key)
        if not isinstance(v, str) or v == self.item["id"]:
            return None
        other = self.sb.scene_items.get(v)
        if other is None:
            return None
        spec = next((k for k in TYPES[self.item["type"]].links if k.key == key), None)
        if spec is not None and spec.types and other["type"] not in spec.types:
            return None
        return v

    @property
    def settings(self):
        """The scene's settings, resolved: {"gravity": m/s², "air": bool, "room_temp": °C, "time_lapse": ×} (settings_of)."""
        return self.sb.settings

    def process(self, kind, part, **fields):
        """A module process "<item id>/<part>" (tooling/src/sim/plugins.ts runs it, the engine module registers `kind`): {kind, id, item,
        **fields} in doc.processes, in build order. Fields are the module's own (numbers rounded as the module's port rounds them)."""
        rec = {"kind": kind, "id": f"{self.item['id']}/{part}", "item": self.item["id"], **fields}
        self.sb.processes.append(rec)
        return rec["id"]

    def cord(self, part, lx, ly):
        x, y = self.world(lx, ly)
        self.sb.use_sprite("cord")
        self.sb.animated.append({"kind": "animated", "id": f"{self.item['id']}/{part}", "words": "a thin cord", "sprite": "cord", "item": self.item["id"],
                                 "vector": [{"id": "cord", "tag": "rect", "attrs": {"x": -0.0015, "y": 0, "width": 0.003, "height": CORD, "fill": "#555"}}],
                                 "at": {"x": round(x, 5), "y": round(y, 5)}, "keys": [], "depth": 0})


# How each look renders: fill/shade (a flat placeholder colour) and the 3D surface hints (the view reads these from GET /api/catalog).
LOOKS = {
    "wood": dict(fill="#c8955a", shade="#a8743f", roughness=0.5, metalness=0.0, clearcoat=1.0, grain=True),
    "light wood": dict(fill="#d7a86e", shade="#b07a42", roughness=0.5, metalness=0.0, clearcoat=0.6, grain=True),
    "rubber": dict(fill="#dd2222", shade="#aa1111", roughness=0.42, metalness=0.0, clearcoat=0.0),
    "plastic": dict(fill="#f2c230", shade="#c99a10", roughness=0.22, metalness=0.0, clearcoat=0.4),
    "clay": dict(fill="#5a9b4a", shade="#3f7434", roughness=0.65, metalness=0.0, clearcoat=0.0),
    "steel": dict(fill="#9aa3ab", shade="#6b737a", roughness=0.25, metalness=1.0, clearcoat=0.0),
}
LOOK_FILL = {k: v["fill"] for k, v in LOOKS.items()}
LOOK_SHADE = {k: v["shade"] for k, v in LOOKS.items()}


def add_look(key, **kw):
    LOOKS[key] = kw
    LOOK_FILL[key], LOOK_SHADE[key] = kw["fill"], kw["shade"]


class SceneBuilder:
    def __init__(self):
        self.solids, self.animated, self.materials, self.instances, self.sprites_used = [], [], {}, {}, set()
        self.joints = []
        self.processes, self.scene_items, self.settings = [], {}, dict(STANDARD_SETTINGS)

    def material(self, base, props):
        key = json.dumps([base, {k: props[k] for k in sorted(props) if k in ("density", "bounce", "friction", "rolling", "side", "grip")}], sort_keys=True)
        if key in self.instances:
            return self.instances[key]["name"]
        same = all(abs(props.get(k, 0) - MATERIALS[base].get(k, 0)) < 1e-12 for k in ("density", "bounce", "friction", "rolling", "side"))
        name = base if same else f"{base} [{hashlib.sha1(key.encode()).hexdigest()[:6]}]"
        rec = {"density": props["density"]}
        if "yieldStrength" in MATERIALS[base]:
            rec["yieldStrength"] = MATERIALS[base]["yieldStrength"]
        if MATERIALS[base].get("source"):
            rec["source"] = MATERIALS[base]["source"]
        self.materials[name] = rec
        self.instances[key] = {"name": name, "base": base, "props": props}
        return name

    def base_of(self, name):
        return next(v["base"] for v in self.instances.values() if v["name"] == name)

    def use_sprite(self, name):
        self.sprites_used.add(name)

    def contacts(self):
        inst = list({v["name"]: v for v in self.instances.values()}.values())
        out = []
        for i, a in enumerate(inst):
            for b in inst[i:]:
                c = contact(a, b)
                out.append({"between": [a["name"], b["name"]], **c})
        return out


SPRITE_SOURCES = {"rubber": "three-balls", "plastic": "three-balls", "clay": "three-balls",
                  "hand-holding": "ball-drop", "hand-opening": "ball-drop", "hand-open": "ball-drop"}


def sprite_records(names):
    out = {}
    src = {k: json.load(open(os.path.join(SCENES, f"{k}.json")))["sprites"] for k in set(SPRITE_SOURCES.values())}
    for n in sorted(names):
        if n == "cord":
            png = os.path.join(SPRITES, "cord.png")
            cw, ch = struct.unpack(">II", open(png, "rb").read()[16:24])
            out["cord"] = {"file": "rube/sprites/cord.png", "sha256": hashlib.sha256(open(png, "rb").read()).hexdigest(), "width": cw, "height": ch,
                           "kx": 0.003 / cw, "ky": CORD / ch, "ox": -0.0015, "oy": CORD}
            continue
        rec = dict(src[SPRITE_SOURCES[n]][n])
        dst = os.path.join(SPRITES, os.path.basename(rec["file"]))
        rec["file"] = f"rube/sprites/{os.path.basename(rec['file'])}"
        rec["sha256"] = hashlib.sha256(open(dst, "rb").read()).hexdigest()
        out[n] = rec
    return out


def props_of(item):
    t = TYPES[item["type"]]
    P = t.defaults()
    P.update(item.get("props") or {})
    if t.material and item.get("props", {}).get("material") and item["props"]["material"] != t.material:
        # a new material brings its own values unless the item also changed them
        m = MATERIALS[P["material"]]
        for k in MATERIAL_KEYS:
            if k not in (item.get("props") or {}):
                P[k] = m[k]
    return P


def camera_of(stage):
    W, H = 1536, 1024
    x0, x1, y0, y1 = stage["x0"], stage["x1"], stage["y0"], stage["y1"]
    ppm = min(W / (x1 - x0), H / (y1 - y0))
    px = round((W - (x1 - x0) * ppm) / 2 - x0 * ppm)
    py = round(H - (H - (y1 - y0) * ppm) / 2 + y0 * ppm)
    return {"canvas": {"width": W, "height": H}, "origin": {"x": 0, "y": 0}, "pixel": {"x": px, "y": py}, "pixelsPerMeter": round(ppm, 3)}


# ---------------------------------------------------------------- the scene's settings (gravity, air, room temperature, time-lapse)
# scene.settings = {"gravity": "earth" | "moon" | "mars" | "jupiter" | "none" | m/s², "air": bool, "air_density": kg/m³, "room_temp": °C,
# "time_lapse": ×}, all optional. air_density (with air on) is the air's density for the engine's drag and buoyancy: 1.2 a room's (the standard),
# a world's own (NASA planetary fact sheets, nssdc.gsfc.nasa.gov/planetary/factsheet: Mars's surface ~0.020, Venus's ~65, Jupiter's and
# Saturn's at the 1-bar level 0.16 and 0.19, Neptune's 0.45, Earth's 1.217).
# The engine's are doc.settings (tooling/src/sim/plugins.ts RunSettings), written only where they differ from the standard ones, so a scene that
# says nothing (or the standard values) builds the very document it did before.
GRAVITY_PRESETS = {"earth": 9.81, "moon": 1.62, "mars": 3.71, "jupiter": 24.79, "none": 0.0}   # m/s²: NASA planetary fact sheets
# (nssdc.gsfc.nasa.gov/planetary/factsheet: Moon 1.62, Mars 3.71, Jupiter 24.79; Earth's standard 9.80665, the engine's 9.81)
STANDARD_SETTINGS = {"gravity": 9.81, "air": True, "room_temp": 20.0, "time_lapse": 1.0, "air_density": 1.2}
SETTING_LIMITS = {"gravity": (0.0, 30.0), "room_temp": (-60.0, 60.0), "time_lapse": (1.0, 100000.0), "air_density": (0.001, 100.0)}
SETTING_RANGE_TEXT = {"room_temp": "-60 to 60", "time_lapse": "1 to 100000", "air_density": "0.001 to 100 kg/m³"}


def settings_of(scene):
    """The scene's settings resolved (STANDARD_SETTINGS where it says nothing); ValueError for one the engine cannot take."""
    raw = scene.get("settings")
    out = dict(STANDARD_SETTINGS)
    if raw is None:
        return out
    if not isinstance(raw, dict):
        raise ValueError("settings must be an object {gravity, air, room_temp, time_lapse}")
    gv = raw.get("gravity")
    if gv is not None:
        if isinstance(gv, str):
            if gv.strip().lower() not in GRAVITY_PRESETS:
                raise ValueError(f"settings.gravity must be one of {', '.join(GRAVITY_PRESETS)} or m/s², not {gv[:30]!r}")
            out["gravity"] = GRAVITY_PRESETS[gv.strip().lower()]
        elif isinstance(gv, bool) or not isinstance(gv, (int, float)) or not math.isfinite(gv) or not SETTING_LIMITS["gravity"][0] <= gv <= SETTING_LIMITS["gravity"][1]:
            raise ValueError("settings.gravity must be a preset or a number of m/s² from 0 to 30")
        else:
            out["gravity"] = float(gv)
    air = raw.get("air")
    if air is not None:
        if not isinstance(air, bool):
            raise ValueError("settings.air must be true or false")
        out["air"] = air
    for key in ("room_temp", "time_lapse", "air_density"):
        v = raw.get(key)
        if v is None:
            continue
        lo, hi = SETTING_LIMITS[key]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
            raise ValueError(f"settings.{key} must be a number from {SETTING_RANGE_TEXT[key]}")
        out[key] = float(v)
    return out


def doc_settings(st):
    """doc.settings for resolved settings: only what differs from the standard (None when nothing does)."""
    out = {}
    if st["gravity"] != STANDARD_SETTINGS["gravity"]:
        out["gravity"] = st["gravity"]
    if st["air"] is not True:
        out["air"] = False
    elif st["air_density"] != STANDARD_SETTINGS["air_density"]:    # (a world's own air: only with air on; a vacuum has none)
        out["airDensity"] = st["air_density"]
    if st["room_temp"] != STANDARD_SETTINGS["room_temp"]:
        out["roomTemperature"] = st["room_temp"]
    if st["time_lapse"] != STANDARD_SETTINGS["time_lapse"]:
        out["timeLapse"] = st["time_lapse"]
    return out or None


# Build hooks (a module's register_all adds one): fn(sb, scene) after every item is built, before the document is put together (a circuit
# module gathers its parts into one network's process; a light module lists what its beams may meet). Run in registration order.
BUILD_HOOKS = []


def register_build_hook(fn):
    BUILD_HOOKS.append(fn)
    return fn


# Warning hooks (a module's register_all adds one): fn(scene, doc) -> [{"items": [ids], "text": plain words}], after the overlaps (overlaps
# below: the layout's and the run's warnings), for a start that will not do what it looks like (the space module: an ordinary ball in a space
# scene, with no gravity but the bodies', drifts toward the planet). None, or nothing to say: [] (a scene without the module's items gets
# exactly the warnings it got before). Run in registration order.
WARNING_HOOKS = []


def register_warning_hook(fn):
    WARNING_HOOKS.append(fn)
    return fn


def build(scene):
    """scene -> (engine document, {item id: resolved props})."""
    sb = SceneBuilder()
    sb.settings = settings_of(scene)
    sb.scene_items = {i["id"]: i for i in scene.get("items", []) if isinstance(i, dict) and isinstance(i.get("id"), str)}
    resolved = {}
    for item in scene.get("items", []):
        if item.get("type") not in TYPES:
            continue
        P = props_of(item)
        resolved[item["id"]] = P
        t = TYPES[item["type"]]
        t.build_fn(Ctx(sb, item, P), P)
        auto = t.auto_keys()
        if auto:    # what an auto prop's built value was made for, so the inspector can tell it from another state's: the item's type, and which of
            P["_type"] = item["type"]                                  # the auto props and what they follow the item sets itself (a typed weight
            P["_own"] = sorted(k for k in (item.get("props") or {}) if k in auto)   # is not "automatic" any more once the item drops it)
    for hook in BUILD_HOOKS:     # (a module's: after every item is built; what it adds is tagged and placed like any item's)
        hook(sb, scene)
    # every solid says which item type and which of its parts it is: the 3D view picks its model by (itemType, part)
    type_of = {i["id"]: i["type"] for i in scene.get("items", [])}
    for s in sb.solids:
        s.setdefault("itemType", type_of.get(s.get("item")))
        s.setdefault("part", s["id"].split("/", 1)[1] if "/" in s["id"] else s["id"])
    held = [s["id"] for s in sb.solids if s["kind"] == "dynamic" and next((i for i in scene["items"] if i["id"] == s["item"]), {}).get("held")]
    release = {"parts": held, "at": float(scene.get("release", 0.5))}
    organic = []
    hand_ball = next((s for s in sb.solids if s["id"] in held and s["body"]["kind"] == "ball"), None)
    if hand_ball is not None:
        organic.append({"kind": "organic", "id": "hand", "words": "a child's hand and forearm in a blue sleeve", "at": dict(hand_ball["at"]),
                        "reach": {"x": -0.5, "y": 0.25}, "poses": ["holding", "opening", "open"], "depth": 5})
        release["holder"] = {"id": "hand", "from": "holding", "via": [{"pose": "opening", "seconds": 0.08}], "to": "open"}
        for n in ("hand-holding", "hand-opening", "hand-open"):
            sb.use_sprite(n)
    doc = {"version": 1, "id": scene.get("id", "sandbox"), "camera": camera_of(scene["stage"]), "materials": sb.materials,
           "contacts": sb.contacts(), "solids": sb.solids, "animated": sb.animated, "organic": organic, "release": release,
           "seconds": float(scene.get("seconds", 4.5)), "sprites": sprite_records(sb.sprites_used)}
    if sb.joints:
        doc["joints"] = sb.joints
    ds = doc_settings(sb.settings)
    if ds is not None:
        doc["settings"] = ds
    if sb.processes:
        doc["processes"] = sb.processes
    if getattr(sb, "view", None):     # render-only settings a module's build hook gave (machines/mod_staging.py: a fixed camera, starting gates)
        doc["view"] = sb.view
    return doc, resolved


# ---------------------------------------------------------------- the core types
WOOD_PLANKS = ["varnished hardwood", "domino wood"]


def build_table(c, P):
    c.slab("top", P["width"], P["thickness"], 1.6, 0, -P["thickness"] / 2, kind="static", words="a varnished hardwood table top")


register(ItemType("table", "Table top", "Scenery", build_table, dynamic=False, material="varnished hardwood", materials=WOOD_PLANKS + ["steel"],
                  props=[Prop("width", "Width", 3.7, 0.5, 8.0, 0.05, "m"), Prop("thickness", "Thickness", 0.15, 0.02, 0.4, 0.01, "m")],
                  tags=["floor", "ground", "base", "bench", "desk"], anchor="the middle of its top surface",
                  description="The surface everything stands on.", edit=[{"kind": "length", "prop": "width", "y": "surface"}]))


def build_wall(c, P):
    c.slab("wall", P["thickness"], P["height"], 0.3, 0, P["height"] / 2, kind="static", words="a wall", hidden_3d=bool(P["invisible_in_3d"]))


register(ItemType("wall", "Wall", "Scenery", build_wall, dynamic=False, material="varnished hardwood", materials=WOOD_PLANKS + ["steel"],
                  props=[Prop("height", "Height", 1.4, 0.05, 3.0, 0.01, "m"), Prop("thickness", "Thickness", 0.05, 0.005, 0.3, 0.005, "m"),
                         Prop("invisible_in_3d", "See-through", False, kind="bool", help="A safety wall, invisible except as a faint pane while selected")],
                  tags=["barrier", "side", "stop", "backstop"], anchor="the middle of its base", edit=[{"kind": "top", "prop": "height"}]))


def build_plank(c, P):
    c.slab("plank", P["length"], P["thickness"], P["depth"], kind=None, words="a tilted varnished hardwood plank", legs=bool(P["legs"]))


register(ItemType("plank", "Wooden plank", "Surfaces & ramps", build_plank, dynamic=False, material="varnished hardwood", materials=WOOD_PLANKS + ["steel"],
                  props=[Prop("length", "Length", 1.0, 0.05, 4.0, 0.01, "m"), Prop("thickness", "Thickness", 0.022, 0.003, 0.2, 0.001, "m"),
                         Prop("depth", "Width (front to back)", 0.12, 0.01, 1.0, 0.01, "m", "Front to back: only for the look; the physics runs in one plane"),
                         Prop("legs", "Legs under it", True, kind="bool")],
                  tags=["ramp", "board", "slope", "incline", "shelf", "beam", "track"], description="A varnished hardwood plank. Tilt it to make a ramp.",
                  facts="Fixed in place · 1 m × 22 mm", edit=[{"kind": "length", "prop": "length"}, {"kind": "rotate"}]))


def _ball_volume(d, wall=None):
    """The material in a ball d across, m³: solid, or a hollow shell `wall` thick."""
    r = d / 2
    return (4 / 3) * math.pi * (cube(r) - (cube(max(0.0, r - wall)) if wall else 0.0))


def ball_type(key, name, diameter, mass, material, hollow_wall=None, sprite=None, pattern=None, look=None, tags=(), description="", source="",
              facts="", color=None, inertia=None, category="Balls"):
    """A ball of a real size and weight (its density follows); hollow when hollow_wall is set.
    The stated weight is for the stated size: resize it and the weight follows the volume of material (solid: (d/d0)³; hollow: its
    wall grows with d/d0 too) unless the item sets "mass" itself (an explicit weight is kept), and a wall the item sets is kept.
    The built values go into the item's resolved props, which is what the inspector shows."""
    ref = _ball_volume(diameter, hollow_wall)

    def build(c, P):
        given = c.item.get("props") or {}
        d = P["diameter"]
        r = d / 2
        if hollow_wall is not None and "wall" not in given:
            P["wall"] = hollow_wall * (d / diameter)
        wall = P.get("wall") if P.get("hollow") else None
        vol = _ball_volume(d, wall)
        if "mass" not in given:
            P["mass"] = mass * (vol / ref)
        x = P["mass"] / vol
        density = round(x, 6) if x >= 1 else float(f"{x:.6g}")   # a very light ball keeps 6 significant figures (6 decimals would round 1e-7 kg to no weight)
        extra = {}
        if pattern:
            extra["pattern"] = pattern
        if color or P.get("color"):
            extra["color"] = P.get("color") or color
        # The engine draws every solid that names a sprite as one rigid object and refuses a document where two of them differ in body or words,
        # so the type's sprite goes only on a ball whose body is the stated ball's (its size and its stated wall, none for a solid type): one that is
        # resized, filled in (hollow off), given a wall of its own, or whose wall followed a size a hair off the stated one, is drawn without it.
        stated = abs(P["diameter"] - diameter) < 1e-9 and round(r, 5) == round(diameter / 2, 5) and wall == hollow_wall
        c.ball("ball", r, material=c.mat(density=density), look=look, wall=wall, inertia=inertia, sprite=sprite if stated else None,
               words=f"a {name.lower()}", **extra)
    # Wall (hollow balls): from what a 5 mm ball's default wall comes to (rounded down), or the old minimum of 0.2 mm if that is lower, so the range always
    # holds what it held before, to what a 1 m ball's comes to; a step of 1 µm keeps every stated wall on the slider's grid (0.0002 is on it)
    wall_lo = min(0.0002, max(1e-6, math.floor(hollow_wall * 0.005 / diameter * 1e6 + 1e-6) / 1e6)) if hollow_wall is not None else None
    # Weight: a typed value may be anything the size range (5 mm to 1 m) can make of the stated weight, solid or hollow, so the box reaches from
    # below a 5 mm ball's weight (a power of ten, which is also the step) up to a 1 m solid ball's; the slider covers the handy part
    smallest = mass * _ball_volume(0.005, wall_lo) / ref
    w_lo = float(f"1e{math.floor(math.log10(smallest))}")
    biggest = max(20.0, float(math.ceil(mass / ref * math.pi / 6)))
    props = [Prop("diameter", "Diameter", diameter, 0.005, 1.0, 0.001, "m"),
             Prop("mass", "Weight", mass, w_lo, biggest, w_lo, "kg", "Follows the size until you type a weight", auto=("diameter", "hollow", "wall"), slider_max=float(f"{min(biggest, 20 * mass):.3g}"))]
    if hollow_wall is not None:
        props += [Prop("hollow", "Hollow", True, kind="bool"),
                  Prop("wall", "Wall thickness", hollow_wall, wall_lo, max(0.05, math.ceil(hollow_wall / diameter * 1000) / 1000), 1e-6, "m",
                       "Follows the size until you set it", auto=("diameter",))]
    return register(ItemType(key, name, category, build, props=props, tags=list(tags) + ["ball", "sphere", "round"], description=description, source=source,
                             material=material, materials=[material],
                             facts=facts or (f"{diameter * 1000:.0f} mm · {mass * 1000:.1f} g" if mass < 1 else f"{diameter * 100:.1f} cm · {mass:.2f} kg"),
                             edit=[{"kind": "radius", "prop": "diameter"}]))


_V60 = (4 / 3) * math.pi * cube(0.03)
ball_type("superball", "Superball", 0.06, 906 * _V60, "solid rubber", sprite="rubber", look="rubber", tags=["bouncy", "rubber", "red", "super ball", "high bounce"],
          description="A solid rubber superball: very bouncy, and it grips and spins hard when it bounces at an angle.",
          source="102.5 g, 60 mm superball measured by Cross, Am. J. Phys. 70, 482 (2002).")
ball_type("plastic-ball", "Hollow plastic ball", 0.06, 950 * (4 / 3) * math.pi * (cube(0.03) - cube(0.0294)), "hollow plastic", hollow_wall=0.0006, sprite="plastic", look="plastic",
          tags=["yellow", "light", "hollow", "toy"], description="A light hollow plastic toy ball.", source="Physics Factbook: hollow hard plastic ball, 92 cm drop, 43.6 cm rebound.")
ball_type("clay-ball", "Modelling clay ball", 0.06, 1570 * _V60, "modeling clay", sprite="clay", look="clay", tags=["plasticine", "dead", "no bounce", "green", "soft"],
          description="A ball of modelling clay: it doesn't bounce, it dents.", source="Van Aken plasticine, 1570 kg/m³.")


def build_domino(c, P):
    h = P["height"]
    c.slab("domino", P["thickness"], h, P["depth"], 0, h / 2, words="a wooden domino block", look="light wood")


register(ItemType("domino", "Domino", "Dominoes", build_domino, material="domino wood", materials=["domino wood", "varnished hardwood"],
                  props=[Prop("height", "Height", 0.05, 0.01, 0.6, 0.001, "m"), Prop("thickness", "Thickness", 0.008, 0.002, 0.1, 0.0005, "m"),
                         Prop("depth", "Width (front to back)", 0.025, 0.005, 0.3, 0.001, "m")],
                  tags=["tile", "block", "chain", "topple"], anchor="the middle of its base", description="One standard domino (5 x 2.5 x 0.8 cm).",
                  source="Larham's dominoes, 51.6 x 25.5 x 7.9 mm (arXiv:1302.3311).", edit=[{"kind": "top", "prop": "height"}, {"kind": "rotate"}]))


def build_domino_row(c, P):
    x, h = 0.0, P["first_height"]
    for i in range(int(P["count"])):
        if i:
            x += P["spacing"] * prev
        t = h * P["thickness_ratio"]
        c.slab(f"domino{i + 1}", t, h, h / 2, x, h / 2, words="a wooden domino block", look="light wood")
        prev = h
        h *= P["growth"]


register(ItemType("domino-row", "Domino row (growing)", "Dominoes", build_domino_row, material="domino wood", materials=["domino wood", "varnished hardwood"],
                  props=[Prop("count", "How many", 7, 1, 30, 1, "", kind="int"), Prop("first_height", "First domino height", 0.098, 0.01, 0.4, 0.001, "m"),
                         Prop("growth", "Each one bigger by", 1.193, 1.0, 1.7, 0.005, "×", "A domino can topple one about 1.5× its size"),
                         Prop("spacing", "Spacing", 0.568, 0.2, 1.2, 0.005, "heights", "Gap between dominoes, in domino heights"),
                         Prop("thickness_ratio", "Thickness", 1 / 6, 0.05, 0.5, 0.005, "of height")],
                  tags=["dominoes", "chain reaction", "row", "topple", "cascade"], anchor="the first domino's base",
                  description="A row of dominoes, each a little bigger than the last, so the wave gains energy.",
                  source="Growing chains: Whitehead, Am. J. Phys. 51, 182 (1983).", edit=[{"kind": "top", "prop": "first_height"}]))


def build_seesaw(c, P):
    L, th = P["length"], P["plank_thickness"]
    tilt = P["tilt"] * D2R
    off = P["pivot_offset"]
    right = L / 2 - off
    cy = right * sin(tilt) + (th / 2) * cos(tilt)
    plank_center = (-off * cos(tilt), cy + off * sin(tilt))
    fh = cy - th / 2 - 0.004
    c.slab("fulcrum", 0.026, fh, 0.06, 0, fh / 2, kind="static", words="a wooden fulcrum block")
    plank = c.slab("plank", L, th, 0.04, plank_center[0], plank_center[1], langle=-P["tilt"], words="a thin varnished hardwood seesaw plank",
                   pivot={"x": round(off, 5), "y": 0.0})
    if P["lip"]:
        s = {"kind": c.kind, "id": f"{c.item['id']}/lip", "words": "a small wooden lip at the seesaw's end", "item": c.item["id"], "look": "wood",
             "body": {"kind": "slab", "width": 0.008, "height": 0.026, "depth": 0.04}, "material": c.mat(),
             "at": {"x": round(L / 2 - 0.004, 5), "y": round(th / 2 + 0.013, 5)}, "parent": plank,
             "placeholder": {"fill": "#c8955a"}, "render": {"kind": "procedural", "shade": "#a8743f"}, "depth": 2}
        c.sb.solids.append(s)


register(ItemType("seesaw", "Seesaw", "Rods & hinges", build_seesaw, material="varnished hardwood", materials=WOOD_PLANKS + ["steel"],
                  props=[Prop("length", "Length", 0.598, 0.1, 2.0, 0.005, "m"), Prop("tilt", "Tilt", 12.452, 1.0, 40.0, 0.25, "°", "Its right end rests on the floor"),
                         Prop("pivot_offset", "Pivot off centre", -0.046, -0.4, 0.4, 0.002, "m", "Negative makes the right arm longer"),
                         Prop("plank_thickness", "Plank thickness", 0.012, 0.004, 0.05, 0.001, "m"),
                         Prop("lip", "Lip at the right end", True, kind="bool", help="Holds a ball on the end")],
                  tags=["lever", "teeter", "catapult", "fling", "launcher", "pivot"], anchor="the floor under its pivot",
                  description="A plank hinged on a fulcrum. Hit the raised end and the other end flings what sits on it.",
                  edit=[{"kind": "tiltEnd", "prop": "tilt"}, {"kind": "armEnd", "prop": "length"}]))


def build_box(c, P):
    bw, bwall, bt = P["width"], P["wall"], P["thickness"]
    c.slab("floor", bw, bt, P["depth"], 0, -bt / 2, kind="static", words="the box's wooden floor")
    c.slab("left", bt, bwall, P["depth"], -bw / 2 + bt / 2, bwall / 2, kind="static", words="the box's left wall")
    c.slab("right", bt, bwall, P["depth"], bw / 2 - bt / 2, bwall / 2, kind="static", words="the box's right wall")
    if P["hung"]:
        c.cord("cord-l", -bw / 2 + bt / 2, bwall)
        c.cord("cord-r", bw / 2 - bt / 2, bwall)


register(ItemType("box", "Open box", "Containers", build_box, dynamic=False, material="varnished hardwood", materials=WOOD_PLANKS + ["steel"],
                  props=[Prop("width", "Width", 0.26, 0.05, 1.5, 0.005, "m"), Prop("wall", "Depth", 0.13, 0.02, 1.0, 0.005, "m", "Wall height; a hollow ball bounces out of a shallow box"),
                         Prop("thickness", "Wall thickness", 0.012, 0.003, 0.05, 0.001, "m"), Prop("depth", "Front to back", 0.12, 0.02, 1.0, 0.01, "m"),
                         Prop("hung", "Hung on cords", True, kind="bool")],
                  tags=["crate", "target", "bin", "container", "catch", "goal", "basket"], anchor="the middle of its floor's top",
                  description="An open wooden box, hung on cords or standing. A target to land things in.",
                  edit=[{"kind": "boxWidth", "prop": "width"}, {"kind": "top", "prop": "wall"}]))

# the rest of the catalog, one file per builder (each optional; an error inside one is not hidden)
import importlib  # noqa: E402
import importlib.util  # noqa: E402

CATALOG_MODULES = ("catalog_items", "catalog_everyday", "catalog_mechanisms")
for _mod in CATALOG_MODULES:
    if importlib.util.find_spec(_mod) is not None:
        importlib.import_module(_mod).register_all(globals())

# Physics modules (heat, liquids, circuits, light, sound, magnets...): one file each, machines/mod_<name>.py, found here in name order (the
# JavaScript port registers web/sim/modules/<name>.js in the same order: web/sim/modules/index.js, written by tools/gen-modules.mjs). Each
# has register_all(g) like a catalog file (its types say module="<name>"), and may register goal kinds (register_goal_kind) and build hooks
# (register_build_hook). A module already loaded is reloaded with items.py (GET /api/catalog?reload=1 picks up its edits too).
# PLAYGROUND_MODULES="a,b" (names without mod_) loads only those; "" none (tests).
import sys as _sys  # noqa: E402

GOAL_KINDS = {}     # kind -> fn(ctx: GoalCtx, goal) -> the result entry {label, ok, kind, ...} or None (left out); see summarize
_only = os.environ.get("PLAYGROUND_MODULES")
MODULES = tuple(sorted(f[:-3] for f in os.listdir(HERE) if f.startswith("mod_") and f.endswith(".py")
                       and (_only is None or f[4:-3] in [n.strip() for n in _only.split(",") if n.strip()])))


def register_goal_kind(kind, fn):
    """A module's goal kind for summarize: fn(ctx, goal) -> {label, ok, kind, ...} (or None to leave the goal out), the same, number for number,
    as its web/sim/modules port's goal kind (registerGoalKind there)."""
    GOAL_KINDS[kind] = fn
    return fn


MODULE_ERRORS = {}   # module -> why it could not be loaded (a module being written must not stop the catalog: it is left out, and said on stderr)
for _mod in MODULES:
    try:
        _m = importlib.reload(_sys.modules[_mod]) if _mod in _sys.modules else importlib.import_module(_mod)
        _m.register_all(globals())
    except Exception as _e:  # noqa: BLE001
        import traceback as _tb
        MODULE_ERRORS[_mod] = f"{type(_e).__name__}: {_e}"
        print(f"items.py: module {_mod} could not be loaded and is left out: {MODULE_ERRORS[_mod]}\n{_tb.format_exc(limit=3)}", file=_sys.stderr)


# ---------------------------------------------------------------- what happened
def _world_poses(doc):
    by = {s["id"]: s for s in doc["solids"]}
    out = {}
    for s in doc["solids"]:
        x, y, a = s["at"]["x"], s["at"]["y"], s.get("angle", 0.0)
        if "parent" in s:
            q = by[s["parent"]]
            qa = q.get("angle", 0.0)
            x, y = q["at"]["x"] + x * cos(qa) - y * sin(qa), q["at"]["y"] + x * sin(qa) + y * cos(qa)
            a += qa
        out[s["id"]] = (x, y, a)
    return out


FALL_MIN_DEG, FALL_MAX_DEG, FALL_MARGIN_DEG = 20, 85, 5     # ai/goals.mjs: the least and the most a body must turn to have fallen, and the margin
R2D = 180 / math.pi                                         # past its tipping angle (degrees)


def _num(v):
    """A JSON number that is a finite float (not a bool), else None (a goal's own fields are whatever the scene says)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:
        return None
    return f if math.isfinite(f) else None


def _short_m(m):
    """A length for a label, as ai/goals.mjs writes it: 1.25 m, 12.3 cm."""
    t = f"{m:.2f}" if m >= 1 else f"{m * 100:.1f}"
    t = t.rstrip("0").rstrip(".") if "." in t else t
    return f"{t} m" if m >= 1 else f"{t} cm"


class _Fall:
    """The balance-point rule of ai/goals.mjs (trackTools: bodies, tipAngle, fell), so the run's summary counts a fallen body as the AI's
    goal check does: an item's rigid bodies that can fall (weld groups not hinged to the world or a parent, and not hung from or held by a
    pin, a rope, a chain or a pulley: a swing's seat, a pendulum's bob, an Atwood machine's weights swing and drop as they should without
    falling over; round ones only when it has nothing else) have fallen when turned past their tipping angle (atan(base / height) of their
    outline box at the start, + 5 degrees, within 20 to 85) or knocked down at least half their smaller side and 2 cm (not a body on wheels)."""

    def __init__(self, doc, fr):
        self.f0, self.end = fr[0]["placements"], fr[-1]["placements"]
        by_id = {s["id"]: s for s in doc["solids"]}

        def root_of(s):
            r = s
            for _ in range(50):
                if not (r.get("parent") and not r.get("pivot") and r["parent"] in by_id):
                    break
                r = by_id[r["parent"]]
            return r
        # (the solids a pin, a rope or chain, or a pulley holds: their weld groups hang or swing, they do not fall over)
        self.held = {side for j in doc.get("joints", []) if j["kind"] in ("pin", "rope", "pulley") for side in (j.get("a"), j.get("b")) if side is not None}
        self.groups = {}
        for s in doc["solids"]:
            if s["kind"] != "dynamic":
                continue
            r = root_of(s)
            lst = self.groups.setdefault(s["item"], [])
            gr = next((g for g in lst if g["root"] is r), None)
            if gr is None:
                gr = {"root": r, "members": []}
                lst.append(gr)
            gr["members"].append(s)
        self.cache = {}

    def _points(self, s, pose):
        b = s["body"]
        if b["kind"] == "ball":
            r = b["radius"]
            pts = [(-r, 0), (r, 0), (0, -r), (0, r)]
        elif b["kind"] == "slab":
            hw, hh = b["width"] / 2, b["height"] / 2
            hb = hw * b.get("taper", 1)
            pts = [(-hb, -hh), (hb, -hh), (hw, hh), (-hw, hh)]
        else:
            pts = [(p["x"], p["y"]) for p in b["points"]]
        c, n = cos(pose["angle"]), sin(pose["angle"])
        return [(pose["x"] + x * c - y * n, pose["y"] + x * n + y * c) for x, y in pts]

    def bodies(self, iid):
        if iid in self.cache:
            return self.cache[iid]
        all_ = [g for g in self.groups.get(iid, []) if not g["root"].get("pivot") and not any(m["id"] in self.held for m in g["members"])]
        round_ = lambda g: all(m["body"]["kind"] == "ball" for m in g["members"])
        keep = [g for g in all_ if not round_(g)] if any(not round_(g) for g in all_) else all_
        out = []
        for g in keep:
            pts = [p for m in g["members"] for p in self._points(m, self.f0[m["id"]])]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            w = max(xs) - min(xs) if pts else 0.0
            h = max(ys) - min(ys) if pts else 0.0
            out.append(dict(g, w=w, h=h, round=round_(g), wheeled=len(keep) < len(all_)))
        self.cache[iid] = out
        return out

    @staticmethod
    def _wrap_deg(rad):
        d = math.fmod(rad * R2D, 360)
        if d > 180:
            d -= 360
        if d < -180:
            d += 360
        return abs(d)

    def tip(self, b):
        return min(FALL_MAX_DEG, max(FALL_MIN_DEG, math.atan(b["w"] / b["h"]) * R2D + FALL_MARGIN_DEG)) if b["w"] > 0 and b["h"] > 0 else 45

    def fell(self, b):
        rid = b["root"]["id"]
        turned = 0 if b["round"] else self._wrap_deg(self.end[rid]["angle"] - self.f0[rid]["angle"])
        mid = lambda at: sum(at[m["id"]]["y"] for m in b["members"]) / len(b["members"])
        dropped = mid(self.f0) - mid(self.end)
        return turned > self.tip(b) or (not b["wheeled"] and dropped >= max(0.02, min(b["w"], b["h"]) / 2))


class GoalCtx:
    """What a module's goal kind reads (register_goal_kind): the scene, its document and track, and helpers. web/sim/items.js has the same."""

    def __init__(self, scene, doc, track, items, name):
        self.scene, self.doc, self.track, self.items, self.name = scene, doc, track, items, name
        self.frames = track["frames"]
        self.times = [f["t"] for f in self.frames]

    def known(self, v):
        """v is the id of an item of the scene."""
        return isinstance(v, str) and v in self.items

    @staticmethod
    def num(v):
        """A goal field that is a finite number, else None."""
        return _num(v)

    @staticmethod
    def short_m(m):
        return _short_m(m)

    def state(self, iid, key):
        """The reading key of item iid at every frame (a module's process set it), or None."""
        st = self.track.get("state") or {}
        v = (st.get(iid) or {}).get(key)
        return v if isinstance(v, list) else None

    def solids(self, iid, dynamic=False):
        return [x for x in self.doc["solids"] if x["item"] == iid and (not dynamic or x["kind"] == "dynamic")]

    def first_time(self, iid, key, test):
        """The first frame's time at which test(reading) holds, or None."""
        v = self.state(iid, key)
        if v is None:
            return None
        for t, x in zip(self.times, v):
            if x is not None and test(x):
                return t
        return None


def _weld_groups(doc, sids):
    """The solids sids (ids, in their order) by the rigid body each is part of: a solid with a parent and no pivot is welded to it, one
    body with it (the engine's weld groups, CONTRACT.md "Engine batch"); each group in the order its first solid comes, its solids in theirs."""
    by_id = {s["id"]: s for s in doc["solids"]}

    def root(sid):
        s = by_id[sid]
        while s.get("parent") is not None and s.get("pivot") is None and s["parent"] in by_id:
            s = by_id[s["parent"]]
        return s["id"]
    out = {}
    for sid in sids:
        out.setdefault(root(sid), []).append(sid)
    return list(out.values())


def summarize(scene, doc, track):
    """Plain-language results: the goals, each moving item's story, and the first hits between items in order. A goal is
    {kind: "in", item, container} (it ends between the container's walls), {kind: "falls", item | items: [id]} (every rigid body of them ends
    fallen, _Fall), {kind: "hits", item, target, before_s?} (something of it touches something of the target, by before_s if given),
    {kind: "moves", item, min_m?} (its rigid body that moved most, the mean of that weld group's parts, ends at least min_m, default 5 cm,
    from where it started), {kind: "off", item}
    (it ends off the table) or {kind: "walls", item, container} (it ends between a cup's, a jar's or a mug's own walls: walls_inside), as
    ai/goals.mjs checks them; each is reported {label, ok, item, container} ("in", as always) or {label, ok, kind, ...} (the others)."""
    items = {i["id"]: i for i in scene.get("items", [])}
    name = lambda iid: items[iid].get("name") or TYPES[items[iid]["type"]].name if iid in items else iid
    item_of = {s["id"]: s["item"] for s in doc["solids"]}
    fr = track["frames"]
    T = [f["t"] for f in fr]
    first, seen = [], set()
    moved_first = {}
    for iid in items:
        sol = [s["id"] for s in doc["solids"] if s["item"] == iid and s["kind"] == "dynamic"]
        for k, f in enumerate(fr):
            if sol and max(math.hypot(f["placements"][sid]["x"] - fr[0]["placements"][sid]["x"], f["placements"][sid]["y"] - fr[0]["placements"][sid]["y"]) for sid in sol) > 0.005:
                moved_first[iid] = T[k]
                break
    for h in track.get("impacts", []):
        a, b = item_of.get(h["a"]), item_of.get(h["b"])
        if a is None or b is None or a == b:
            continue
        key = frozenset((a, b))
        if key in seen:
            continue
        seen.add(key)
        dyn = lambda iid: any(s["kind"] == "dynamic" for s in doc["solids"] if s["item"] == iid)
        mover = a if dyn(a) else b
        if dyn(a) and dyn(b):     # two moving things: the one that was already moving struck the other
            mover = min((a, b), key=lambda iid: moved_first.get(iid, 1e9))
        other = b if mover == a else a
        nm = name(mover)
        verb = "hit" if nm.endswith("s") and not nm.endswith("ss") else "hits"
        first.append({"t": round(h["t"], 3), "a": mover, "b": other, "text": f"{nm} {verb} {name(other)}", "speed": h["speed"]})
    first.sort(key=lambda e: e["t"])
    stories = []
    fall = None
    for iid, it in items.items():
        sol = [s for s in doc["solids"] if s["item"] == iid and s["kind"] == "dynamic"]
        if not sol:
            continue
        t0 = fr[0]["placements"]
        moved_at, max_v, rest_at = None, 0.0, None
        # A speed is a position change over about a frame or more: the engine's frame nearest each impact sits 2 ms from its
        # neighbour, where a ball pushed back out of the surface it struck (a few mm in one step) would count as 6 m/s.
        span, j = 0.9 / (track.get("fps") or 120), 0
        for k in range(1, len(fr)):
            while j + 1 < k and T[k] - T[j + 1] >= span:
                j += 1
            dt = T[k] - T[j]
            if dt >= span:
                v = max(math.hypot(fr[k]["placements"][s["id"]]["x"] - fr[j]["placements"][s["id"]]["x"], fr[k]["placements"][s["id"]]["y"] - fr[j]["placements"][s["id"]]["y"]) / dt for s in sol)
                max_v = max(max_v, v)
            d = max(math.hypot(fr[k]["placements"][s["id"]]["x"] - t0[s["id"]]["x"], fr[k]["placements"][s["id"]]["y"] - t0[s["id"]]["y"]) for s in sol)
            if moved_at is None and d > 0.01:
                moved_at = T[k]
        end = fr[-1]["placements"]
        story = {"item": iid, "name": name(iid), "moved_at": moved_at, "max_speed": round(max_v, 2)}
        if it["type"] == "domino-row":
            # (by the balance-point rule the AI's goal check uses, _Fall: a domino leaning on the next past its tipping angle has fallen)
            fall = fall or _Fall(doc, fr)
            bodies = fall.bodies(iid)
            fallen = sum(1 for b in bodies if fall.fell(b))
            story["text"] = f"{fallen} of {len(bodies)} fall"
            story["ok"] = fallen == len(bodies)
        elif it["type"] in ("seesaw",) or any("pivot" in s for s in sol):
            turn = max(abs(f["placements"][s["id"]]["angle"] - t0[s["id"]]["angle"]) for f in fr for s in sol if "pivot" in s) if any("pivot" in s for s in sol) else 0
            story["text"] = f"turns {math.degrees(turn):.0f}°"
            story["ok"] = math.degrees(turn) > 5
        else:
            story["text"] = "doesn't move" if moved_at is None else f"top speed {max_v:.1f} m/s"
            story["ok"] = moved_at is not None
        stories.append(story)
    goals = []
    gctx = None
    poses = {sid: (p["x"], p["y"]) for sid, p in fr[-1]["placements"].items()}
    known = lambda v: isinstance(v, str) and v in items
    for g in scene.get("goals", []):
        kind = g.get("kind")
        if kind == "in" and g.get("item") in items and g.get("container") in items:
            ok = inside(scene, doc, poses, g["item"], g["container"])
            goals.append({"label": g.get("label") or f"{name(g['item'])} ends in the {name(g['container']).lower()}", "ok": ok,
                          "item": g["item"], "container": g["container"]})
        elif kind == "falls":
            ids = g["items"] if isinstance(g.get("items"), list) and g["items"] else ([g["item"]] if g.get("item") is not None else [])
            if not ids or not all(known(i) for i in ids):
                continue
            fall = fall or _Fall(doc, fr)
            bodies = [b for i in ids for b in fall.bodies(i)]
            down = sum(1 for b in bodies if fall.fell(b))
            who = f"all {len(ids)} of {', '.join(name(i) for i in ids[:3])}{'…' if len(ids) > 3 else ''}" if len(ids) > 1 else name(ids[0])
            goals.append({"label": g.get("label") or f"{who} {'fall' if len(ids) > 1 else 'falls'} over", "ok": bool(bodies) and down == len(bodies),
                          "kind": "falls", "items": ids, "fallen": down, "of": len(bodies)})
        elif kind == "hits" and known(g.get("item")) and known(g.get("target")):
            a = {s["id"] for s in doc["solids"] if s["item"] == g["item"]}
            b = {s["id"] for s in doc["solids"] if s["item"] == g["target"]}
            t = min((h["t"] for h in track.get("impacts", []) if (h["a"] in a and h["b"] in b) or (h["a"] in b and h["b"] in a)), default=None)
            by = _num(g.get("before_s"))
            when = "" if by is None else f" by {f'{by:.2f}'.rstrip('0').rstrip('.')} s"
            goals.append({"label": g.get("label") or f"{name(g['item'])} hits {name(g['target'])}{when}", "ok": t is not None and (by is None or t <= by),
                          "kind": "hits", "item": g["item"], "target": g["target"], "t": None if t is None else round(t, 3)})
        elif kind == "moves" and known(g.get("item")):
            sids = [s["id"] for s in doc["solids"] if s["item"] == g["item"] and s["kind"] == "dynamic"]
            least = _num(g.get("min_m"))
            least = 0.05 if least is None else least
            d = 0.0
            # (how far its rigid body that moved most went: the mean of each weld group's parts, the most of those. An Atwood machine's or a
            # pulley lift's two weights move opposite ways, and the mean of all of an item's parts stayed where it was; a one-body thing is
            # as before, bit for bit)
            for grp in _weld_groups(doc, sids):
                c0 = (sum(fr[0]["placements"][i]["x"] for i in grp) / len(grp), sum(fr[0]["placements"][i]["y"] for i in grp) / len(grp))
                c1 = (sum(fr[-1]["placements"][i]["x"] for i in grp) / len(grp), sum(fr[-1]["placements"][i]["y"] for i in grp) / len(grp))
                h = math.hypot(c1[0] - c0[0], c1[1] - c0[1])
                if h > d:
                    d = h
            goals.append({"label": g.get("label") or f"{name(g['item'])} moves at least {_short_m(least)}", "ok": bool(sids) and d >= least,
                          "kind": "moves", "item": g["item"], "moved_m": round(d, 4)})
        elif kind == "off" and known(g.get("item")):
            # (ai/goals.mjs "off": the mean of its moving parts ends past the table top's ends, or below its top: it left the table)
            sids = [s["id"] for s in doc["solids"] if s["item"] == g["item"] and s["kind"] == "dynamic"]
            top = next((s for s in doc["solids"] if s.get("itemType") == "table" and s.get("part") == "top" and s["body"].get("kind") == "slab"), None)
            ok = False
            if sids and top is not None:
                p = fr[0]["placements"].get(top["id"]) or top["at"]
                ty = p["y"] + top["body"]["height"] / 2
                x0 = p["x"] - top["body"]["width"] / 2
                x1 = p["x"] + top["body"]["width"] / 2
                cx = sum(fr[-1]["placements"][i]["x"] for i in sids) / len(sids)
                cy = sum(fr[-1]["placements"][i]["y"] for i in sids) / len(sids)
                ok = cx < x0 or cx > x1 or cy < ty - 0.01
            goals.append({"label": g.get("label") or f"{name(g['item'])} ends off the table", "ok": ok, "kind": "off", "item": g["item"]})
        elif kind == "walls" and known(g.get("item")) and known(g.get("container")):
            # (an "in" goal for a container the "in" check doesn't know, a plastic cup, a glass jar or a coffee mug: judged by its own walls at the
            # run's end, as web/ai/goals.js does, so the results show it too)
            ok = walls_inside(doc, fr[-1]["placements"], g["item"], g["container"])
            goals.append({"label": g.get("label") or f"{name(g['item'])} ends in the {name(g['container']).lower()}", "ok": ok, "kind": "walls",
                          "item": g["item"], "container": g["container"]})
        elif kind in GOAL_KINDS:
            # (a module's goal kind: register_goal_kind; its web/sim port reports the same)
            gctx = gctx or GoalCtx(scene, doc, track, items, name)
            r = GOAL_KINDS[kind](gctx, g)
            if r is not None:
                goals.append(r)
    out = {"goals": goals, "stories": stories, "events": first[:16]}
    # (a module's readings at the run's end, {item: {key: value}}, and what its processes said happened: only when the run has any)
    state = track.get("state")
    if isinstance(state, dict) and state:
        out["readings"] = {iid: {k: (v[-1] if isinstance(v, list) and v else None) for k, v in keys.items()} for iid, keys in state.items()}
    if track.get("events"):
        out["happenings"] = [dict(e) for e in track["events"]]
    return out


def walls_inside(doc, last, iid, cid):
    """Whether item iid's moving solids end between container cid's own walls: inside its "left" and "right" (or "wall-left" and "wall-right",
    a pulley lift's pail's "wall1" and "wall2") parts, above its "floor" (or "body", "base", "bottom"), no higher than the lower wall's top,
    each part where the run's last frame has it. False when the container has no such parts or the item no moving solid."""
    def part(names):
        return next((s for s in doc["solids"] if s["item"] == cid and s.get("part") in names), None)
    L, R, F = part(("left", "wall-left", "wall1")), part(("right", "wall-right", "wall2")), part(("floor", "body", "base", "bottom"))
    if L is None or R is None or F is None:
        return False

    def pose(s):
        if s["id"] in last:
            p = last[s["id"]]
            return (p["x"], p["y"], p.get("angle", 0))
        return (s["at"]["x"], s["at"]["y"], s.get("angle", 0))
    l, r, f = _corners(L, pose(L)), _corners(R, pose(R)), _corners(F, pose(F))
    in_l = max(q[0] for q in l)
    in_r = min(q[0] for q in r)
    top = min(max(q[1] for q in l), max(q[1] for q in r))
    floor = max(q[1] for q in f)
    n = 0
    for s in doc["solids"]:
        if s["item"] != iid or s["kind"] != "dynamic":
            continue
        n += 1
        if s["id"] not in last:
            return False
        p = last[s["id"]]
        rad = s["body"].get("radius", 0)
        if not (floor - 0.01 <= p["y"] - rad <= top and in_l <= p["x"] <= in_r):
            return False
    return n > 0


def _corners(s, pose):
    """A slab's (tapered: its true trapezoid) or a polygon's corners in the world, counter-clockwise."""
    x, y, a = pose
    b = s["body"]
    if b["kind"] == "polygon":
        pts = [(p["x"], p["y"]) for p in b["points"]]
    else:
        hw, hh = b["width"] / 2, b["height"] / 2
        hb = hw * b.get("taper", 1.0)
        pts = [(-hb, -hh), (hb, -hh), (hw, hh), (-hw, hh)]
    c, n = cos(a), sin(a)
    return [(x + px * c - py * n, y + px * n + py * c) for px, py in pts]


def _overlap_depth(sa, pa, sb, pb):
    """How deep two solids interpenetrate at the start, m (0 if apart): rube's for balls and slabs, and here for polygons
    (separating axes between two outlines; a ball's centre against an outline)."""
    ka, kb = sa["body"]["kind"], sb["body"]["kind"]
    if "polygon" not in (ka, kb):
        import rube
        return rube._overlap_depth(sa, pa, sb, pb)
    if ka == "ball" or kb == "ball":
        (sc, pc), (so, po) = ((sa, pa), (sb, pb)) if ka == "ball" else ((sb, pb), (sa, pa))
        r, (cx, cy), P = sc["body"]["radius"], pc[:2], _corners(so, po)
        inside, near, sides = float("inf"), float("inf"), 0
        for i in range(len(P)):
            (x1, y1), (x2, y2) = P[i], P[(i + 1) % len(P)]
            ex, ey = x2 - x1, y2 - y1
            m = math.hypot(ex, ey)
            if m == 0:
                continue    # (a side of no length, two corners at one point: no line to be inside of; its ends are the next side's)
            sides += 1
            inside = min(inside, (ex * (cy - y1) - ey * (cx - x1)) / m)  # distance inside this side's line (negative: outside)
            u = max(0.0, min(1.0, ((cx - x1) * ex + (cy - y1) * ey) / (m * m)))
            near = min(near, math.hypot(cx - x1 - u * ex, cy - y1 - u * ey))
        if not sides:
            return 0.0    # (an outline that is a single point holds nothing)
        if inside >= 0:
            return r + inside
        return r - near if near < r else 0.0
    A, B = _corners(sa, pa), _corners(sb, pb)
    depth, axes = float("inf"), 0
    for poly in (A, B):
        for i in range(len(poly)):
            (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
            ax, ay = -(y2 - y1), x2 - x1
            m = math.hypot(ax, ay)
            if m == 0:
                continue    # (a side of no length, as a slab 0 m wide has, or two corners at one point: no direction to test; items.js the same)
            axes += 1
            ax, ay = ax / m, ay / m
            pA = [px * ax + py * ay for px, py in A]
            pB = [px * ax + py * ay for px, py in B]
            o = min(max(pA), max(pB)) - max(min(pA), min(pB))
            if o <= 0:
                return 0.0
            depth = min(depth, o)
    return depth if axes else 0.0    # (no side with a length: two points, which hold nothing between them)


def overlaps(scene, doc, tol=0.003):
    """Plain-language warnings for items that start inside one another (deeper than tol). The depth is compared rounded to 9 decimals
    (a nanometre): a pair exactly tol deep (a 3 mm plank through a block) is the tolerance itself, whatever the last bit of the sin and cos
    of its angle (CPython's libm and a browser's differ there; web/sim/items.js rounds the same way)."""
    import rube
    items = {i["id"]: i for i in scene.get("items", [])}
    name = lambda iid: (items[iid].get("name") or TYPES[items[iid]["type"]].name) if iid in items else iid
    world = rube._world(doc)
    solids = [s for s in doc["solids"] if s.get("ghost") is not True]   # (a ghost solid, an instrument's face or a painted line, touches nothing)
    seen, out = set(), []
    for i, a in enumerate(solids):
        for b in solids[i + 1:]:
            if a["item"] == b["item"] or (a["kind"] == "static" and b["kind"] == "static" and "table" in (items.get(a["item"], {}).get("type"), items.get(b["item"], {}).get("type"))):
                continue
            if round(_overlap_depth(a, world[a["id"]], b, world[b["id"]]), 9) <= tol:
                continue
            key = frozenset((a["item"], b["item"]))
            if key in seen:
                continue
            seen.add(key)
            if b["kind"] == "dynamic" and a["kind"] != "dynamic":
                a, b = b, a
            na, nb = name(a["item"]), name(b["item"])
            if a["kind"] == "dynamic":
                many = na.endswith("s") and not na.endswith("ss")
                out.append({"items": [a["item"], b["item"]], "text": f"{na} start{'' if many else 's'} inside {nb}: {'they' if many else 'it'}'ll be shoved out at the start"})
            else:
                out.append({"items": [a["item"], b["item"]], "text": f"{na} and {nb} overlap"})
    for hook in WARNING_HOOKS:     # (a module's: WARNING_HOOKS above)
        out.extend(hook(scene, doc) or [])
    return out


def inside(scene, doc, poses, iid, cid):
    """Whether item iid's solids end within container cid's walls (between its floor and the rim)."""
    cont = next(i for i in scene["items"] if i["id"] == cid)
    P = props_of(cont)
    if cont["type"] not in ("box", "cup", "bucket", "basket"):
        return False
    cx, cy, a = cont["x"], cont["y"], cont.get("angle", 0) * D2R
    w = P.get("width", 0.2)
    wall = P.get("wall", P.get("height", 0.1))
    t = P.get("thickness", 0.012)
    for s in doc["solids"]:
        if s["item"] != iid or s["kind"] != "dynamic":
            continue
        x, y = poses[s["id"]]
        dx, dy = x - cx, y - cy
        lx, ly = dx * cos(-a) - dy * sin(-a), dx * sin(-a) + dy * cos(-a)
        r = s["body"].get("radius", 0)
        if not (-w / 2 + t <= lx <= w / 2 - t and -0.005 <= ly - r <= wall):
            return False
    return True


def preview(key):
    """One item of this type alone, built at the origin: its solids, for a catalog card's picture."""
    doc, _ = build({"stage": {"x0": -1, "x1": 1, "y0": -1, "y1": 1}, "items": [{"id": "p", "type": key, "x": 0.0, "y": 0.0}]})
    return {"solids": doc["solids"], "animated": doc["animated"], "joints": doc.get("joints", [])}


def catalog():
    types = []
    for t in TYPES.values():
        d = t.schema()
        try:
            d["preview"] = preview(t.key)
        except Exception as e:  # a broken type still lists, without its picture
            d["preview"] = {"solids": [], "animated": [], "error": str(e)}
        types.append(d)
    return {"categories": CATEGORIES, "types": types,
            "materials": {k: {kk: vv for kk, vv in v.items()} for k, v in MATERIALS.items()}, "looks": LOOKS}
