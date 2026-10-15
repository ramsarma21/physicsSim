"""The rest of the sandbox's catalog: materials, looks, balls, blocks, surfaces, rods and hinges, groups, containers, a fan.

items.py calls register_all(globals()) once at import time (it never imports this file's names itself), so everything
here is built from items.py's own framework: MATERIALS, measured(), add_look(), ItemType, Prop, ball_type, Ctx.

Every number says where it comes from (regulation, textbook, handbook); a guess says "provisional".
A ball's bounce is chosen so that bounce x 0.93 (hardwood) is its real restitution on a hard surface.
"""
import math

NEEDED = ("register", "ItemType", "Prop", "ball_type", "MATERIALS", "measured", "add_look", "LOOK_FILL", "LOOK_SHADE", "D2R",
          "WOOD_PLANKS")


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    _looks()
    _materials()
    _pairs()
    _balls()
    _blocks()
    _surfaces()
    _rods()
    _containers()
    _groups()
    _air()


# ---------------------------------------------------------------- helpers
def _b(e_on_wood):
    """The bounce value that gives restitution e_on_wood against the varnished hardwood table."""
    return round(e_on_wood / MATERIALS["varnished hardwood"]["bounce"], 3)


def _sphere_density(mass, diameter, wall=None):
    r = diameter / 2
    vol = (4 / 3) * math.pi * (r ** 3 - (max(0.0, r - wall) ** 3 if wall else 0.0))
    return round(mass / vol, 1)


def _mat(key, **kw):
    kw.setdefault("rolling", 0.0)
    kw.setdefault("side", 0.0)
    MATERIALS[key] = kw


def _hanger(c, y=0.012, w=0.08, bar_depth=0.04, part="hanger", words="a small wooden hanger", **extra):
    """A small static wooden bar over a hinge at the item's origin, so the hinge looks held: its middle y straight up from the hinge in the WORLD and level,
    whatever the item's angle (it is the bracket the hinge hangs from, fixed to a wall or a stand; turning the item only swings the part hung from it).
    Its depth (3D only) is the bar's plus 3 cm: room for the wall plate behind it (a mount) and the clevis in front."""
    c.slab(part, w, 0.012, round(bar_depth + 0.03, 4), 0.0, 0.0, langle=-c.item.get("angle", 0.0), kind="static", words=words, look="wood",
           material=c.mat(base="varnished hardwood", overrides={}), **extra)
    # (placed straight from the hinge's world point, not turned there through the item's sin and cos: their last bit is not the same in every
    # browser and would decide a round(..., 5) that lands on a tie)
    c.sb.solids[-1]["at"] = {"x": round(c.ox + 0.0, 5), "y": round(c.oy + y, 5)}


def _hanger_clear(w_deg, bob=None, y=0.012, w=0.08):
    """True when a part hung from the pivot under a level _hanger at height y, swinging between -w_deg and w_deg from straight down in the world, never
    reaches the bar. Up to horizontal a plank's top corners stay under the bar (the caller puts it high enough for them); past it the plank itself sweeps
    through the space over the pivot. bob = (L, r): a ball of radius r at L from the pivot, which must clear the bar by 4.5 mm (Box2D's 2 mm skin and
    room) at the ends of its swing, its highest points (the bar is symmetric: one end is enough)."""
    if w_deg > 90:
        return False
    if bob is not None:
        L, r = bob
        a = w_deg * D2R
        dx = max(abs(L * math.sin(a)) - w / 2, 0.0)
        dy = max((y - 0.006) + L * math.cos(a), 0.0)
        return math.hypot(dx, dy) >= r + 0.0045
    return True


def _hang(c, start_deg, low_y, low_depth, reach, half_depth, bob=None):
    """The hanger of a part let go start_deg out (in the item's frame) on a hinge at the item's origin. Gravity swings it between -w and w from straight
    down in the world, w = |start + the item's angle| (wrapped to 180°). With w up to 90° (and a bob clear of it) the low bar just over the hinge holds the
    pin; past that the swing reaches round over the hinge, so the bar ("hanger-high") goes up beyond the swing's reach (its underside 1 cm over the part's
    farthest point from the hinge: no start, no knock can bring it there), level, on a stand of its own (the view's post, or a wall bracket above 1.3 m).
    Its 3D model hangs a batten from it down to the hinge BEHIND the swing (half_depth + 6 mm and more behind the plane) with a bearing for the pin:
    nothing of it is ever in the way. Its depth makes room for that batten: 2.1 cm behind the swing, as far in front."""
    w = abs((start_deg + c.item.get("angle", 0.0) + 180.0) % 360.0 - 180.0)
    if _hanger_clear(w, bob=bob, y=low_y):
        _hanger(c, y=low_y, bar_depth=low_depth)
        return
    H = round(reach + 0.016, 5)
    _hanger(c, y=H, bar_depth=round(2 * (half_depth + 0.021), 5), part="hanger-high", words="a wooden hanger bar above the swing",
            stand="wall" if c.oy + H - 0.006 > 1.3 else "post")


def _child_ball(c, part, parent, lx, ly, r, material, words, look=None, **extra):
    """A ball welded to another part of the same item: lx, ly are in the parent's frame (as build_seesaw's lip)."""
    look = look or MATERIALS[c.sb.base_of(material)]["look"]
    s = {"kind": c.kind, "id": f"{c.item['id']}/{part}", "words": words, "item": c.item["id"], "look": look,
         "body": {"kind": "ball", "radius": round(r, 5)}, "material": material, "at": {"x": round(lx, 5), "y": round(ly, 5)}, "parent": parent,
         "placeholder": {"fill": LOOK_FILL.get(look, "#888")}, "render": {"kind": "procedural", "shade": LOOK_SHADE.get(look, "#555")}, "depth": 4}
    s.update(extra)
    c.sb.solids.append(s)


def _hung_ball(c, tag, px, py, length, deg, diameter, bob_density, rod_thickness=0.004, rod_depth=0.01, rod_density=None, rod_words="a light wooden rod", rod_look="light wood"):
    """A light wooden rod pivoted to the world at (px, py), a ball welded to its lower end; swung out by deg (bob at L sin a, -L cos a)."""
    a = deg * D2R
    rod = c.slab(f"rod{tag}", rod_thickness, length, rod_depth, px + (length / 2) * math.sin(a), py - (length / 2) * math.cos(a), langle=deg,
                 material=c.mat(base="domino wood", overrides={}, density=rod_density), words=rod_words, look=rod_look,
                 pivot={"x": 0.0, "y": round(length / 2, 5)})
    _child_ball(c, f"bob{tag}", rod, 0.0, -length / 2, diameter / 2, c.mat(density=bob_density), f"a {c.P.get('material', 'steel')} pendulum bob")
    return rod


# ---------------------------------------------------------------- looks
def _looks():
    add_look("glass", fill="#bfe3ee", shade="#7fb6c8", roughness=0.04, metalness=0.0, clearcoat=1.0, transmission=0.9, ior=1.5, thickness=0.01)
    add_look("ice", fill="#cfeaf7", shade="#8fc2dc", roughness=0.15, metalness=0.0, clearcoat=0.6, transmission=0.55, ior=1.31, thickness=0.03)
    add_look("foam", fill="#e6cf5e", shade="#bfa534", roughness=0.95, metalness=0.0, clearcoat=0.0)
    add_look("brick", fill="#b5523b", shade="#8a3a28", roughness=0.92, metalness=0.0, clearcoat=0.0)
    add_look("carpet", fill="#4f6d9a", shade="#38527a", roughness=1.0, metalness=0.0, clearcoat=0.0)
    add_look("cork", fill="#c89a62", shade="#a47a45", roughness=0.9, metalness=0.0, clearcoat=0.0)
    add_look("cardboard", fill="#c9a26b", shade="#a07c48", roughness=0.9, metalness=0.0, clearcoat=0.0)
    add_look("aluminium", fill="#c9ced3", shade="#8f979e", roughness=0.35, metalness=1.0, clearcoat=0.0)
    add_look("concrete", fill="#a6a39d", shade="#7d7a74", roughness=0.95, metalness=0.0, clearcoat=0.0)
    add_look("rubber mat", fill="#3a3d42", shade="#25272b", roughness=0.85, metalness=0.0, clearcoat=0.0)
    add_look("dark wood", fill="#7a4a2a", shade="#5a3319", roughness=0.5, metalness=0.0, clearcoat=0.8, grain=True)
    add_look("tennis felt", fill="#c8da2c", shade="#9fb01c", roughness=1.0, metalness=0.0, clearcoat=0.0)
    add_look("leather", fill="#e8772e", shade="#b8561a", roughness=0.55, metalness=0.0, clearcoat=0.3)
    add_look("synthetic leather", fill="#fbfbf8", shade="#bcbcb6", roughness=0.4, metalness=0.0, clearcoat=0.35)
    add_look("celluloid", fill="#f7f7f2", shade="#cfcdbf", roughness=0.35, metalness=0.0, clearcoat=0.5)
    add_look("golf", fill="#fafaf6", shade="#cfcfc8", roughness=0.3, metalness=0.0, clearcoat=0.6)
    add_look("baseball", fill="#f5f1e6", shade="#c9c1a8", roughness=0.7, metalness=0.0, clearcoat=0.0)
    add_look("bowling", fill="#1f2937", shade="#111827", roughness=0.1, metalness=0.0, clearcoat=1.0)
    add_look("marble", fill="#4ea6e6", shade="#2f85b8", roughness=0.03, metalness=0.0, clearcoat=1.0, transmission=0.8, ior=1.5, thickness=0.016)
    add_look("pvc", fill="#ef4136", shade="#bf2a22", roughness=0.35, metalness=0.0, clearcoat=0.5)
    add_look("phenolic", fill="#2a5db0", shade="#1b3f80", roughness=0.08, metalness=0.0, clearcoat=1.0)


# ---------------------------------------------------------------- materials
# (density kg/m³, bounce = restitution against a rigid surface, Coulomb friction, rolling resistance, side spring-back)
def _materials():
    # surfaces and blocks
    _mat("glass", density=2500, bounce=0.92, friction=0.4, rolling=0.001, side=0.1, look="glass",
         source="Soda-lime glass 2500 kg/m³; glass on glass, kinetic friction about 0.4 (Engineering ToolBox). Hard, so a high bounce: provisional.")
    _mat("ice", density=917, bounce=0.95, friction=0.03, rolling=0.001, look="ice",
         source="Ice 917 kg/m³ at 0 °C; kinetic friction of ice on ice about 0.03 (Engineering ToolBox, 0.02-0.09). Rigid (Young's modulus about 9 GPa), so a ball bounces off it "
                "about as well as off concrete: 0.95 provisional. A flat block landing on it is dead (see _pairs).")
    _mat("foam", density=30, bounce=0.15, friction=0.7, rolling=0.06, look="foam",
         source="Flexible polyurethane foam 24-40 kg/m³ (Engineering ToolBox). It soaks up an impact: bounce and friction provisional.")
    _mat("brick", density=1900, bounce=0.95, friction=0.65, rolling=0.003, look="brick",
         source="Common clay brick 1600-2000 kg/m³ (Engineering ToolBox); brick on wood friction about 0.6. Rigid (10-20 GPa, like concrete), so a ball bounces off it: 0.95 "
                "provisional. A flat block landing on it is dead (see _pairs).")
    _mat("carpet", density=200, bounce=0.7, friction=0.8, rolling=0.05, look="carpet",
         source="Pile carpet, bulk density about 200 kg/m³ (provisional); a ball rolls with large resistance on it. Bounce and friction provisional.")
    _mat("cork", density=200, bounce=0.55, friction=0.5, rolling=0.01, look="cork",
         source="Cork 120-240 kg/m³ (Engineering ToolBox); cork on wood friction about 0.5. Bounce provisional.")
    _mat("cardboard", density=24, bounce=0.3, friction=0.45, rolling=0.01, look="cardboard",
         source="Effective density of an EMPTY corrugated box (board about 0.45 kg/m², so a 30 x 20 x 20 cm box weighs about 0.3 kg): provisional.")
    _mat("aluminium", density=2700, bounce=0.85, friction=0.4, rolling=0.0015, look="aluminium",
         source="Aluminium 2700 kg/m³. Friction on wood and bounce provisional.")
    _mat("concrete", density=2400, bounce=0.97, friction=0.6, rolling=0.005, look="concrete",
         source="Concrete 2400 kg/m³; concrete on wood friction about 0.6 (Engineering ToolBox). Very rigid: ball bounce is the ball's own.")
    _mat("rubber mat", density=1100, bounce=0.8, friction=0.85, rolling=0.025, look="rubber mat",
         source="Rubber flooring about 1100 kg/m³; rubber on dry floors 0.7-1.0. Bounce and rolling provisional.")
    _mat("steel weight", density=8000, bounce=0.25, friction=0.4, rolling=0.001, look="steel",
         source="Weights are made to a conventional density of 8000 kg/m³ (OIML R 111); steel on wood friction about 0.4. A big flat block lands dead: bounce provisional.")
    _mat("dark wood", density=750, bounce=_b(0.62), friction=0.4, rolling=0.004, look="dark wood",
         source="Dark hardwood (walnut, mahogany) 650-800 kg/m³; a wooden ball on a wood floor rebounds with e about 0.62 (provisional).")
    # ball materials: each density is what its ball's mass and wall work out to
    _mat("celluloid", density=_sphere_density(0.0027, 0.040, 0.0004), bounce=_b(0.896), friction=0.25, rolling=0.004, side=0.2, look="celluloid",
         source="ITTF: 40 mm, 2.7 g, a 0.4 mm shell (celluloid 1350-1400 kg/m³); 305 mm onto a steel block rebounds 235-255 mm, so e = 0.90. Friction, rolling, side provisional.")
    _mat("felt (tennis)", density=_sphere_density(0.0577, 0.067, 0.0045), bounce=_b(0.745), friction=0.6, rolling=0.012, side=0.3, look="tennis felt",
         source="ITF: 65.4-68.6 mm, 56.0-59.4 g; 254 cm onto concrete rebounds 135-147 cm, so e = 0.745. Friction, rolling, side provisional.")
    _mat("golf ionomer", density=_sphere_density(0.0459, 0.0427), bounce=_b(0.80), friction=0.25, rolling=0.004, side=0.4, look="golf",
         source="USGA/R&A: at least 42.67 mm, at most 45.93 g; surlyn cover. e about 0.78 against a rigid plate at 140 ft/s, a little higher when slow: 0.80 is provisional.")
    _mat("baseball (leather/cork)", density=_sphere_density(0.145, 0.074), bounce=_b(0.55), friction=0.5, rolling=0.01, side=0.2, look="baseball",
         source="MLB/ASTM F1887: 142-149 g, 72.6-74.7 mm; COR 0.546 ± 0.032 against an ash plank at 85 ft/s. Friction, rolling, side provisional.")
    _mat("leather (basketball)", density=_sphere_density(0.62, 0.242, 0.0035), bounce=_b(0.767), friction=0.6, rolling=0.012, side=0.3, look="leather",
         source="FIBA size 7: 24.0-24.8 cm, 567-650 g; from 1.80 m (its bottom) it rebounds 1.20-1.40 m (its top), so e = sqrt((1.30 - 0.242) / 1.8) = 0.77. Wall provisional.")
    _mat("synthetic leather (soccer)", density=_sphere_density(0.43, 0.22, 0.0035), bounce=_b(0.80), friction=0.5, rolling=0.015, side=0.3, look="synthetic leather",
         source="FIFA size 5: 68-70 cm round, 410-450 g; from 2 m it rebounds 135-155 cm (e 0.74-0.88 depending on where that is measured): 0.80 provisional.")
    _mat("bowling resin", density=_sphere_density(7.26, 0.218), bounce=_b(0.60), friction=0.2, rolling=0.004, side=0.1, look="bowling",
         source="USBC: 8.5 in (218 mm), at most 16 lb (7.26 kg); resin shell. Bounce, friction, rolling provisional.")
    _mat("glass marble", density=_sphere_density(0.0054, 0.016), bounce=_b(0.66), friction=0.3, rolling=0.0015, side=0.2, look="marble",
         source="Standard 5/8 in (16 mm) marble of soda-lime glass, 2500 kg/m³, about 5.4 g. Physics Factbook: a glass marble dropped 92 cm onto concrete rebounds 39.8 cm, e 0.66 "
                "(wood is no stiffer). Friction, rolling provisional.")
    _mat("PVC (beach ball)", density=_sphere_density(0.1, 0.40, 0.0002), bounce=_b(0.55), friction=0.4, rolling=0.02, side=0.1, look="pvc",
         source="Inflatable PVC film 0.15-0.3 mm, about 100 g at 40 cm (provisional); soft, low pressure, so a dull bounce (provisional).")
    _mat("phenolic resin", density=_sphere_density(0.17, 0.0572), bounce=_b(0.80), friction=0.2, rolling=0.003, side=0.2, look="phenolic",
         source="Pool balls: phenolic resin, 57.15 mm, 156-170 g (BCA/WPA). Bounce on a wooden table, friction, rolling provisional.")


def _pairs():
    # only where there is a real number
    measured("celluloid", "steel", friction=0.316, restitution=0.896, rollingResistance=0.004,
             source="ITTF: a ball dropped 305 mm onto a steel block rebounds 235-255 mm (e = sqrt(245 / 305) = 0.896). Friction mixed.")
    measured("felt (tennis)", "concrete", friction=0.62, restitution=0.745, rollingResistance=0.012,
             source="ITF: a tennis ball dropped 254 cm onto concrete rebounds 135-147 cm (e = sqrt(141 / 254) = 0.745).")
    measured("glass marble", "glass", friction=0.28, restitution=0.9, rollingResistance=0.0015,
             source="Glass spheres on glass at low speed give e about 0.9-0.95 (impact tests); friction mixed.")
    measured("steel", "steel", friction=0.4, restitution=0.95, rollingResistance=0.001,
             source="Hard steel on steel at low speed 0.9-0.95; the upper end for bearing balls, so a Newton's cradle swings on. Provisional.")
    measured("phenolic resin", "phenolic resin", friction=0.06, restitution=0.95, rollingResistance=0.0,
             source="Pool ball on pool ball: e about 0.92-0.96, friction about 0.05 (pool physics measurements).")
    # a steel ball on wood or stone is not a steel-on-steel ring: the softer body's losses dominate, not the product of the two bounces
    for m in ("varnished hardwood", "domino wood", "dark wood", "concrete", "brick"):
        measured("steel", m, friction=round(math.sqrt(0.4 * MATERIALS[m]["friction"]), 3), restitution=0.6, rollingResistance=0.001,
                 source="Physics Factbook: a steel ball bearing dropped 92 cm onto concrete rebounds 32.8 cm, e 0.597; wood and brick are no stiffer than concrete. Friction mixed.")
    # ice is far slipperier on wood and steel than the mixing rule says (Engineering ToolBox: ice on wood 0.05, on steel 0.03)
    for m in ("varnished hardwood", "domino wood", "dark wood"):
        measured("ice", m, friction=0.05, restitution=0.3, rollingResistance=0.001,
                 source="Engineering ToolBox: ice on wood, kinetic friction 0.05. Restitution provisional: a flat block lands dead.")
    measured("ice", "steel", friction=0.03, restitution=0.5, rollingResistance=0.001,
             source="Engineering ToolBox: ice on steel, kinetic friction 0.03. Restitution provisional.")
    # ice and brick are rigid, so a ball bounces off them as well as off concrete (their bounce is 0.95); but a flat block of either landing on a hard
    # surface lands dead (e about 0.3, provisional), as brick and ice did before their bounce was raised. Friction and rolling resistance are the mixing rule's.
    for hard, other in (("ice", "ice"), ("ice", "brick"), ("ice", "concrete"), ("ice", "glass"), ("ice", "aluminium"),
                        ("brick", "brick"), ("brick", "concrete"), ("brick", "glass"), ("brick", "aluminium"),
                        ("brick", "varnished hardwood"), ("brick", "domino wood"), ("brick", "dark wood")):
        a, b = MATERIALS[hard], MATERIALS[other]
        measured(hard, other, friction=round(math.sqrt(a["friction"] * b["friction"]), 4), restitution=0.3, rollingResistance=max(a["rolling"], b["rolling"]),
                 source="Provisional: a flat block of brick or ice landing on a hard surface lands dead. Friction and rolling resistance mixed from the two materials.")


# ---------------------------------------------------------------- balls
def _balls():
    ball_type("ping-pong-ball", "Ping-pong ball", 0.040, 0.0027, "celluloid", hollow_wall=0.0004, pattern="pingpong",
              tags=["table tennis", "ping pong", "pingpong", "light", "hollow", "celluloid"],
              description="A table-tennis ball: a 0.4 mm celluloid shell, so light that the air slows it.",
              source="ITTF: 40 mm, 2.7 g; rebounds 235-255 mm from 305 mm onto a steel block.", facts="40 mm · 2.7 g · ITTF size and weight")
    ball_type("tennis-ball", "Tennis ball", 0.067, 0.0577, "felt (tennis)", hollow_wall=0.0045, pattern="tennis",
              tags=["felt", "yellow", "racket", "hollow", "fuzzy"],
              description="A felt-covered hollow rubber ball with the ITF bounce.",
              source="ITF: 65.4-68.6 mm, 56.0-59.4 g; 254 cm onto concrete rebounds 135-147 cm.", facts="67 mm · 57.7 g · bounces 141 cm from 254 cm")
    ball_type("golf-ball", "Golf ball", 0.0427, 0.0459, "golf ionomer", pattern="golf",
              tags=["dimpled", "white", "hard", "solid", "surlyn"],
              description="A small hard solid ball, as heavy as the rules allow for its size.",
              source="USGA/R&A: diameter at least 42.67 mm, weight at most 45.93 g.", facts="42.7 mm · 45.9 g · USGA limits")
    ball_type("baseball", "Baseball", 0.074, 0.145, "baseball (leather/cork)", pattern="baseball",
              tags=["leather", "cork", "hardball", "bat", "stitched"],
              description="A leather ball wound round a cork core: heavy, and only about half as bouncy as a tennis ball.",
              source="MLB/ASTM F1887: 5-5.25 oz, 9-9.25 in round; COR 0.546 ± 0.032.", facts="74 mm · 145 g · COR about 0.55")
    ball_type("basketball", "Basketball", 0.242, 0.62, "leather (basketball)", hollow_wall=0.0035, pattern="basketball",
              tags=["hoop", "orange", "inflated", "hollow", "big"],
              description="A big inflated ball. Dropped from 1.8 m it comes back up between 1.2 and 1.4 m.",
              source="FIBA size 7: 24.0-24.8 cm, 567-650 g; 1.80 m drop (bottom) rebounds 1.20-1.40 m (top).", facts="24.2 cm · 0.62 kg · FIBA rebound 1.2-1.4 m from 1.8 m")
    ball_type("soccer-ball", "Soccer ball", 0.22, 0.43, "synthetic leather (soccer)", hollow_wall=0.0035, pattern="soccer",
              tags=["football", "futbol", "white", "inflated", "hollow"],
              description="A size-5 inflated ball.", source="FIFA size 5: 68-70 cm round, 410-450 g; 2 m drop rebounds 135-155 cm.", facts="22 cm · 0.43 kg")
    ball_type("bowling-ball", "Bowling ball", 0.218, 7.26, "bowling resin", pattern="bowling",
              tags=["heavy", "ten pin", "lane", "strike", "resin"],
              description="The heaviest ball allowed in the game: it hardly bounces and rolls a long way.",
              source="USBC: 8.5 in (218 mm), at most 16 lb (7.26 kg).", facts="21.8 cm · 7.26 kg")
    ball_type("glass-marble", "Glass marble", 0.016, 0.0054, "glass marble", pattern="marble",
              tags=["marbles", "glass ball", "blue", "toy", "small", "clear"],
              description="A small glass ball. It bounces best off hard things like glass.",
              source="Standard 5/8 in marble of soda-lime glass.", facts="16 mm · 5.4 g")
    ball_type("steel-ball", "Steel ball bearing", 0.0254, 0.0674, "steel", tags=["ball bearing", "metal", "heavy", "silver", "iron ball", "bb"],
              description="A 1 inch hardened-steel bearing ball: small and dense, and it rings off other metal.",
              source="1 in (25.4 mm) bearing ball, steel 7850 kg/m³.", facts="25.4 mm · 67 g")
    ball_type("beach-ball", "Beach ball", 0.40, 0.1, "PVC (beach ball)", hollow_wall=0.0002, pattern="beach",
              tags=["inflatable", "pool", "balloon", "air", "light", "plastic", "big"],
              description="A huge, thin, light inflatable: the air slows it long before it hits anything.",
              source="PVC film 0.15-0.3 mm; mass provisional.", facts="40 cm · 0.1 kg · air drag matters")
    ball_type("wooden-ball", "Wooden ball", 0.05, 0.049, "dark wood", pattern="wooden",
              tags=["wood", "croquet", "dark", "solid", "hardwood"],
              description="A solid hardwood ball.", source="Dark hardwood ball, about 750 kg/m³.", facts="50 mm · 49 g")
    _billiard = ball_type("billiard-ball", "Billiard ball", 0.0572, 0.17, "phenolic resin", pattern="billiard",
              tags=["pool", "snooker", "cue ball", "eight ball", "resin"],
              description="A pool ball: hard resin that bounces off other pool balls almost perfectly.",
              source="BCA/WPA: 2.25 in (57.15 mm), 5.5-6 oz (156-170 g), phenolic resin.", facts="57.2 mm · 170 g")
    # the printed number (0 = cue ball, 9-15 striped): only the 3D look reads it
    _billiard.props.append(Prop("number", "Number", 2, 0, 15, 1, kind="int", help="The number printed on it: 0 is the cue ball, 8 the black ball, 9-15 are striped. Only the 3D look uses it"))


# ---------------------------------------------------------------- blocks & shapes
BLOCK_WOODS = ["varnished hardwood", "domino wood", "dark wood", "cork"]
BLOCK_ALL = ["varnished hardwood", "dark wood", "cork", "brick", "concrete", "ice", "foam", "cardboard", "aluminium", "glass", "steel weight"]


def _block(key, name, material, materials, size, tags, description, source, facts=None):
    w, h, d = size

    def build(c, P):
        c.slab("block", P["width"], P["height"], P["depth"], 0, 0, words=f"a {name.lower()}")
    mass = MATERIALS[material]["density"] * w * h * d
    register(ItemType(key, name, "Blocks & shapes", build, material=material, materials=materials,
                      props=[Prop("width", "Width", w, 0.01, 1.5, 0.005, "m", "Left to right"), Prop("height", "Height", h, 0.01, 1.5, 0.005, "m", "Bottom to top"),
                             Prop("depth", "Front to back", d, 0.01, 1.5, 0.005, "m", "Only for the 3D look and the weight")],
                      tags=tags, description=description, source=source, facts=facts or f"{w * 1000:.0f} x {h * 1000:.0f} x {d * 1000:.0f} mm · {mass:.2f} kg",
                      edit=[{"kind": "size", "w": "width", "h": "height"}, {"kind": "rotate"}]))


def _weight(key, name, kg):
    dens = MATERIALS["steel weight"]["density"]

    def build(c, P):
        s = (P["mass"] / dens) ** (1 / 3)
        c.slab("weight", s, s, s, 0, 0, words=f"a {name.lower()}")
    register(ItemType(key, name, "Blocks & shapes", build, material="steel weight", materials=["steel weight"],
                      props=[Prop("mass", "Weight", kg, 0.1, 50.0, 0.1, "kg", "A solid cube of steel with this weight")],
                      tags=["weight", "mass", "metal", "iron", "heavy", "kilogram", "cube", "calibration"],
                      description=f"A solid steel cube weighing {kg:g} kg: it lands with a thud and pushes things hard.",
                      source="Weights use the conventional density 8000 kg/m³ (OIML R 111).",
                      facts=f"{kg:g} kg · a {(kg / dens) ** (1 / 3) * 100:.1f} cm cube", edit=[{"kind": "rotate"}]))


def _blocks():
    _block("wooden-block", "Wooden block", "varnished hardwood", BLOCK_WOODS + ["ice", "brick", "foam"], (0.10, 0.05, 0.05),
           ["wood", "building block", "toy block", "brick", "cuboid", "box"], "A toy building block, 4 x 2 x 2 inches.", "Hardwood about 700 kg/m³.")
    _block("brick", "Brick", "brick", ["brick", "concrete", "varnished hardwood", "cork"], (0.215, 0.065, 0.1025),
           ["wall", "masonry", "red", "building", "heavy", "block"], "A standard clay brick.", "UK standard brick 215 x 102.5 x 65 mm; clay brick about 1900 kg/m³.")
    _weight("steel-weight-1kg", "Steel weight (1 kg)", 1.0)
    _weight("steel-weight-5kg", "Steel weight (5 kg)", 5.0)
    _block("foam-block", "Foam block", "foam", ["foam", "cork", "cardboard"], (0.20, 0.10, 0.10), ["sponge", "soft", "light", "cushion", "mattress", "padding"],
           "A block of soft polyurethane foam: almost weightless, and it takes the bounce out of whatever lands on it.", "Polyurethane foam 24-40 kg/m³.")
    _block("ice-cube", "Ice cube", "ice", ["ice", "glass", "varnished hardwood"], (0.04, 0.04, 0.04), ["frozen", "slippery", "cold", "slide", "cube"],
           "A cube of ice: it slides almost without friction.", "Ice 917 kg/m³; kinetic friction on wood 0.05 and on steel 0.03 (Engineering ToolBox).")
    _block("cardboard-box", "Cardboard box", "cardboard", ["cardboard", "varnished hardwood", "foam"], (0.30, 0.20, 0.20),
           ["carton", "package", "parcel", "crate", "empty box", "moving box"], "An empty corrugated box: big, light and not bouncy.",
           "Effective density of an empty box (provisional).")

    def build_wedge(c, P):
        # a true right-triangle prism (a door stop): flat base, upright back on the right, the long sloped face rising to it.
        # The origin is the bounding box's centre, so a wedge placed at y = h/2 stands on the table and the size handle sits at the top of the back.
        w, h = P["width"], P["height"]
        c.poly("wedge", [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2)], P["depth"], 0, 0, words="a wooden wedge")
    mass = MATERIALS["varnished hardwood"]["density"] * 0.2 * 0.1 / 2 * 0.1
    register(ItemType("wedge", "Wedge", "Blocks & shapes", build_wedge, material="varnished hardwood", materials=BLOCK_WOODS + ["brick", "ice", "foam"],
                      props=[Prop("width", "Base width", 0.20, 0.02, 1.5, 0.005, "m"), Prop("height", "Height", 0.10, 0.02, 1.5, 0.005, "m"),
                             Prop("depth", "Front to back", 0.10, 0.01, 1.0, 0.005, "m", "Only for the 3D look and the weight")],
                      tags=["triangle", "ramp", "doorstop", "slope", "prism", "roof", "split"],
                      description="A right-angled hardwood wedge (a door stop): flat base, upright back, its long sloped face a small ramp.",
                      source="A right-triangle outline (polygon): mass = density x area x depth, centred on the triangle's centroid.",
                      facts=f"200 x 100 x 100 mm · {mass:.2f} kg", edit=[{"kind": "size", "w": "width", "h": "height"}, {"kind": "rotate"}]))

    def build_log(c, P):
        r = P["diameter"] / 2
        # the engine weighs a ball body as a sphere, so its density is scaled to make the cylinder's weight
        rho = MATERIALS[P["material"]]["density"]
        c.ball("log", r, material=c.mat(density=round(rho * 3 * P["length"] / (4 * r), 4)), inertia=0.5, shape="cylinder", length=P["length"],
               words="a wooden log")
    mass = 700 * math.pi * 0.06 ** 2 * 0.25
    register(ItemType("wooden-log", "Wooden log", "Blocks & shapes", build_log, material="varnished hardwood", materials=BLOCK_WOODS,
                      props=[Prop("diameter", "Diameter", 0.12, 0.02, 0.6, 0.005, "m"), Prop("length", "Length (front to back)", 0.25, 0.02, 1.0, 0.005, "m", "Only for the 3D look and the weight")],
                      tags=["wood", "cylinder", "roller", "trunk", "rolling", "tree", "dowel", "round"],
                      description="A round log seen end-on: it rolls like a cylinder (inertia ½ m r²), not like a ball.",
                      source="Hardwood about 700 kg/m³; a solid cylinder's moment of inertia is ½ m r² (textbook).",
                      facts=f"12 cm round, 25 cm long · {mass:.1f} kg", edit=[{"kind": "radius", "prop": "diameter"}]))


# ---------------------------------------------------------------- surfaces & ramps
def _surface(key, name, material, materials, size, tags, description, source, legs=True):
    length, thickness, depth = size

    def build(c, P):
        c.slab("slab", P["length"], P["thickness"], P["depth"], words=f"a {name.lower()}", legs=bool(P["legs"]))
    register(ItemType(key, name, "Surfaces & ramps", build, dynamic=False, material=material, materials=materials,
                      props=[Prop("length", "Length", length, 0.05, 4.0, 0.01, "m", "Along the surface; tilt it with the turn handle"), Prop("thickness", "Thickness", thickness, 0.003, 0.2, 0.001, "m"),
                             Prop("depth", "Width (front to back)", depth, 0.01, 1.0, 0.01, "m", "Only for the 3D look and the weight"),
                             Prop("legs", "Legs under it (3D)", legs, kind="bool", help="Wooden legs under each end, drawn only in 3D")],
                      tags=tags, description=description, source=source, facts="Fixed in place",
                      edit=[{"kind": "length", "prop": "length"}, {"kind": "rotate"}]))


def _surfaces():
    _surface("steel-beam", "Steel beam", "steel", ["steel", "aluminium", "concrete"], (1.0, 0.025, 0.08), ["girder", "rail", "metal", "ramp", "track", "iron"],
             "A steel beam. Tilt it for a hard, smooth ramp.", "Carbon steel 7850 kg/m³; steel on steel e about 0.95.")
    _surface("ice-sheet", "Ice sheet", "ice", ["ice", "glass"], (1.0, 0.03, 0.30), ["rink", "frozen", "slippery", "slide", "skate", "ramp"],
             "A slab of ice: almost no friction, so things slide down it.", "Ice on ice kinetic friction about 0.03.")
    _surface("glass-sheet", "Glass sheet", "glass", ["glass", "ice"], (0.6, 0.01, 0.30), ["pane", "window", "mirror", "smooth", "ramp", "plate"],
             "A pane of glass: hard and smooth.", "Soda-lime glass 2500 kg/m³; glass marble on glass e about 0.9.")
    _surface("rubber-mat", "Rubber mat", "rubber mat", ["rubber mat", "carpet", "cork"], (1.0, 0.012, 0.30), ["gym floor", "grip", "sticky", "non-slip", "flooring", "ramp"],
             "A rubber mat: things grip it instead of sliding.", "Rubber flooring about 1100 kg/m³; friction 0.7-1.0.")
    _surface("carpet-strip", "Carpet strip", "carpet", ["carpet", "rubber mat", "cork"], (1.0, 0.01, 0.30), ["rug", "soft", "floor", "slows", "rough", "runner"],
             "A strip of carpet: a rolling ball loses speed fast on it and bounces low.", "Pile carpet; rolling resistance of balls on carpet about 0.03-0.1 (provisional).")
    _surface("concrete-slab", "Concrete slab", "concrete", ["concrete", "steel", "brick"], (0.8, 0.05, 0.30), ["pavement", "floor", "cement", "court", "hard", "ramp", "stone"],
             "A slab of concrete: the hardest, grippiest ground.", "Concrete 2400 kg/m³; the ITF tennis bounce test is on concrete.")

    def build_peg(c, P):
        # a dowel standing out of a backboard, seen end-on: a cylinder along the depth axis (a circle in the machine's plane)
        c.ball("peg", P["diameter"] / 2, shape="cylinder", depth3d=round(min(0.4, max(0.08, 5 * P["diameter"])), 4), words="a small steel peg")
    register(ItemType("peg", "Peg", "Surfaces & ramps", build_peg, dynamic=False, material="steel", materials=["steel", "aluminium", "varnished hardwood", "solid rubber"],
                      props=[Prop("diameter", "Diameter", 0.012, 0.002, 0.1, 0.001, "m")], tags=["pin", "nail", "post", "plinko", "pachinko", "stud", "dowel", "knob"],
                      description="A small fixed steel peg that things bounce off.", source="Steel 7850 kg/m³; e about 0.95 against hard balls.", anchor="its centre",
                      facts="12 mm, fixed", edit=[{"kind": "radius", "prop": "diameter"}]))

    def build_bumper(c, P):
        # a pinball-style bumper seen from above: a round rubber ring on a post, so a cylinder along the depth axis
        c.ball("bumper", P["diameter"] / 2, shape="cylinder", depth3d=round(min(0.2, max(0.04, 0.55 * P["diameter"])), 4), words="a round rubber bumper")
    register(ItemType("bumper", "Bumper", "Surfaces & ramps", build_bumper, dynamic=False, material="solid rubber", materials=["solid rubber", "rubber mat", "foam"],
                      props=[Prop("diameter", "Diameter", 0.12, 0.02, 0.5, 0.005, "m")],
                      tags=["trampoline", "pinball", "springy", "kicker", "bouncy", "rubber ball", "spring", "bouncer", "pad"],
                      description="A fixed round rubber bumper: balls spring off it and are kicked sideways.",
                      source="Superball rubber: e 0.86 on wood, with sideways spring-back (Cross, Am. J. Phys. 70, 482, 2002).", anchor="its centre",
                      facts="12 cm, fixed", edit=[{"kind": "radius", "prop": "diameter"}]))

    def build_funnel(c, P):
        m, o, h, t = P["mouth"], P["outlet"], P["height"], P["thickness"]
        # a round funnel: as deep (front to back) as it is wide, rim included; never over 1.5 m deep (a wider one is an oval cone: it stays in front of the
        # room's back wall, 0.8 m behind the machine plane)
        d = round(min(1.5, max(m, o) + 2 * t), 5)
        a = (m - o) / 2
        L = math.hypot(a, h)
        phi = math.degrees(math.atan2(a, h))
        for side, nm in ((-1, "left"), (1, "right")):
            # the inner surface runs from the mouth's edge down to the outlet's; the plank lies outside it
            cx = side * (m / 2 - a / 2) + side * (t / 2) * (h / L)
            cy = -h / 2 - (t / 2) * (a / L)
            c.slab(nm, t, L, d, cx, cy, langle=-side * phi, words=f"the funnel's {nm} plank")
        if a > 0.005:
            # a short straight stem under the cone (the funnel's spout): two vertical walls just wide enough for the outlet's gap, running up into the
            # cone's walls (4 mm) so there is no crack where they meet
            ls = round(min(0.08, 0.75 * o, 0.3 * h), 5)
            up = 0.004
            for side, nm in ((-1, "left"), (1, "right")):
                c.slab(f"stem-{nm}", t, ls + up, round((o + 2 * t) * min(1.0, 1.5 / (max(m, o) + 2 * t)), 5), side * (o / 2 + t / 2), -h - ls / 2 + up / 2,
                       words=f"the funnel's {nm} stem wall")   # (as deep as it is wide, as oval as the cone over 1.5 m)
    register(ItemType("funnel", "Funnel", "Surfaces & ramps", build_funnel, dynamic=False, material="varnished hardwood", materials=WOOD_PLANKS + ["steel", "aluminium", "glass"],
                      props=[Prop("mouth", "Mouth width", 0.40, 0.05, 2.0, 0.01, "m"), Prop("outlet", "Outlet width", 0.08, 0.01, 1.0, 0.005, "m", "Gap at the bottom"),
                             Prop("height", "Height", 0.25, 0.05, 1.5, 0.01, "m"), Prop("thickness", "Wall thickness", 0.012, 0.003, 0.05, 0.001, "m")],
                      tags=["hopper", "chute", "v", "channel", "guide", "slide", "two ramps", "sorter"],
                      description="A round cone of wood with a short stem that guides whatever falls in down through a small gap.", anchor="the middle of its mouth",
                      source="A cone seen from the side is two fixed slanted walls; the gap is measured between their inner faces.", facts="40 cm mouth, 8 cm outlet",
                      edit=[{"kind": "length", "prop": "mouth"}]))

    def build_stairs(c, P):
        n, rise, run, d = int(P["steps"]), P["rise"], P["run"], P["depth"]
        for i in range(n):
            c.slab(f"step{i + 1}", run, rise * (i + 1), d, -n * run / 2 + (i + 0.5) * run, rise * (i + 1) / 2, words="a wooden stair step")
    register(ItemType("staircase", "Staircase", "Surfaces & ramps", build_stairs, dynamic=False, material="varnished hardwood", materials=WOOD_PLANKS + ["concrete", "brick"],
                      props=[Prop("steps", "Steps", 5, 2, 20, 1, "", "How many steps going up", kind="int"), Prop("rise", "Step height", 0.05, 0.01, 0.3, 0.005, "m"),
                             Prop("run", "Step depth", 0.10, 0.02, 0.5, 0.005, "m"), Prop("depth", "Width (front to back)", 0.12, 0.02, 1.0, 0.01, "m")],
                      tags=["stairs", "steps", "ladder", "cascade", "waterfall", "ramp"], anchor="the middle of its bottom",
                      description="Steps going up to the right: a ball drops from one to the next.", source="Fixed solid steps; the default rise and run are provisional.",
                      facts="5 steps, 5 cm high, 10 cm deep", edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- rods & hinges
def _rod(key, name, material, materials, thickness, tags, description, source):
    def build(c, P):
        # a round rod seen from the side is a rectangle (length x diameter, as deep as it is thick); its weight is the round section's, pi/4 of the square's
        rho = round(MATERIALS[P["material"]]["density"] * math.pi / 4, 1)
        c.slab("rod", P["length"], P["thickness"], P["thickness"], material=c.mat(density=rho), words=f"a {name.lower()}")
    mass = MATERIALS[material]["density"] * math.pi / 4 * 0.5 * thickness * thickness
    register(ItemType(key, name, "Rods & hinges", build, material=material, materials=materials,
                      props=[Prop("length", "Length", 0.5, 0.05, 2.0, 0.01, "m", "Along the rod"), Prop("thickness", "Diameter", thickness, 0.002, 0.1, 0.001, "m", "Round section")],
                      tags=tags, description=description, source=source, facts=f"50 cm, {thickness * 1000:.0f} mm round · {mass * 1000:.0f} g",
                      edit=[{"kind": "length", "prop": "length"}, {"kind": "rotate"}]))


def _rods():
    _rod("wooden-rod", "Wooden rod", "varnished hardwood", BLOCK_WOODS, 0.012, ["dowel", "stick", "bar", "pole", "wood", "lever", "baton"],
         "A wooden dowel, loose.", "Hardwood about 700 kg/m³, a round section.")
    _rod("steel-rod", "Steel rod", "steel", ["steel", "aluminium"], 0.008, ["bar", "pole", "metal", "crowbar", "shaft", "axle", "iron"],
         "A thin round steel bar, loose.", "Steel 7850 kg/m³, a round section.")

    # --- pendulum
    def build_pendulum(c, P):
        L, d, a = P["length"], P["bob_diameter"], P["start_angle"]
        _hung_ball(c, "", 0.0, 0.0, L, a, d, _sphere_density(P["bob_mass"], d))
        if P["hanger"]:
            # a 4 cm bar drawn as a wooden bracket with a clevis for the pivot pin; over the swing's reach (the bob's far side) where it would be hit
            _hang(c, a, 0.012, 0.04, L + d / 2, max(d / 2, 0.005), bob=(L, d / 2))
    register(ItemType("pendulum", "Pendulum", "Rods & hinges", build_pendulum, material="steel", materials=["steel", "solid rubber", "varnished hardwood", "dark wood", "aluminium", "modeling clay"],
                      props=[Prop("length", "Length", 0.5, 0.1, 2.0, 0.01, "m", "From the pivot to the middle of the bob"),
                             Prop("bob_diameter", "Bob diameter", 0.05, 0.01, 0.3, 0.001, "m"), Prop("bob_mass", "Bob weight", 0.5, 0.01, 10.0, 0.01, "kg"),
                             Prop("start_angle", "Start angle", 30.0, -170.0, 170.0, 1.0, "°", "From straight down; negative pulls the bob to the left"),
                             Prop("hanger", "Show the hanger", True, kind="bool", help="A wooden bracket holding the pivot pin (up over the bob's reach when it starts past level); a swing knocked up past level stops against the low one")],
                      tags=["swing", "bob", "clock", "metronome", "wrecking ball", "hinge", "string", "oscillate", "weight on a string"],
                      description="A bob on a light rod, pivoted at the top. Pull it aside and let go: it swings with a period 2π√(L/g).",
                      source="Physics: period 2π√(L/g) for small swings (textbook); a light wooden rod, a frictionless pivot.", anchor="the pivot, at the top",
                      facts="50 cm · 0.5 kg bob · period about 1.4 s", edit=[{"kind": "swing", "prop": "start_angle", "length": "length"}, {"kind": "rotate"}]))

    # --- lever
    def build_lever(c, P):
        L, th, ph, off, tilt = P["length"], P["thickness"], P["pivot_height"], P["pivot_offset"], P["tilt"]
        ph = max(ph, th / 2 + 0.01)
        fh = ph - th / 2 - 0.003
        # a triangular fulcrum (apex up, 3 mm under the plank) so the plank can turn as far as it likes; 72 mm deep: the plank's 60 mm between two steel
        # gussets with the pin's heads outside them
        c.poly("fulcrum", [(-0.03, -fh / 2), (0.03, -fh / 2), (0.0, fh / 2)], 0.072, 0, fh / 2, kind="static", words="a wooden triangular fulcrum", look="wood",
               material=c.mat(base="varnished hardwood", overrides={}))
        t = tilt * D2R
        # the plank turns about a point `off` along it from its middle; that point sits at the fulcrum's top
        c.slab("plank", L, th, 0.06, -off * math.cos(t), ph - off * math.sin(t), langle=tilt, words="a lever plank", pivot={"x": round(off, 5), "y": 0.0})
    register(ItemType("lever", "Lever", "Rods & hinges", build_lever, material="varnished hardwood", materials=WOOD_PLANKS + ["steel", "aluminium"],
                      props=[Prop("length", "Length", 1.0, 0.2, 3.0, 0.01, "m"), Prop("thickness", "Thickness", 0.02, 0.005, 0.1, 0.001, "m"),
                             Prop("pivot_height", "Fulcrum height", 0.12, 0.03, 1.0, 0.005, "m", "Where the plank turns, above the floor"),
                             Prop("pivot_offset", "Fulcrum off centre", 0.0, -0.45, 0.45, 0.005, "m", "Positive moves the fulcrum toward the right end"),
                             Prop("tilt", "Start tilt", 0.0, -30.0, 30.0, 0.5, "°", "Positive lifts the right end")],
                      tags=["fulcrum", "balance", "see-saw", "teeter", "crowbar", "catapult", "plank", "pivot", "beam"], anchor="the floor under its fulcrum",
                      description="A plank resting on a fulcrum and free to turn on it: balanced when the fulcrum is in the middle.",
                      source="Physics: balanced when the torques of both arms are equal (textbook); frictionless pivot.", facts="1 m plank, fulcrum in the middle",
                      edit=[{"kind": "top", "prop": "pivot_height"}]))

    # --- hinged gate
    def build_gate(c, P):
        L, th, d, a = P["length"], P["thickness"], P["depth"], P["start_angle"] * D2R
        c.slab("gate", th, L, d, (L / 2) * math.sin(a), -(L / 2) * math.cos(a), langle=P["start_angle"], words="a hinged wooden gate", pivot={"x": 0.0, "y": round(L / 2, 5)})
        if P["hanger"]:
            # the gate's top corners swing on a circle of radius th / 2 round the pivot: the low bar's underside sits th / 2 + 4.5 mm above it; past level
            # the bar goes over the reach of its far corners
            _hang(c, P["start_angle"], round(max(0.012, th / 2 + 0.0105), 5), d, math.hypot(L, th / 2), d / 2)
    register(ItemType("hinged-gate", "Hinged gate", "Rods & hinges", build_gate, material="varnished hardwood", materials=WOOD_PLANKS + ["steel", "aluminium"],
                      props=[Prop("length", "Length", 0.4, 0.05, 2.0, 0.01, "m"), Prop("thickness", "Thickness", 0.02, 0.003, 0.1, 0.001, "m"),
                             Prop("depth", "Width (front to back)", 0.12, 0.02, 1.0, 0.01, "m"),
                             Prop("start_angle", "Start angle", 40.0, -170.0, 170.0, 1.0, "°", "From hanging straight down; negative swings it to the left"),
                             Prop("hanger", "Show the hanger", True, kind="bool", help="A wooden bracket holding the hinge pin (up over the gate's reach when it starts past level); a gate knocked up past level stops against the low one")],
                      tags=["door", "flap", "swing door", "trapdoor", "hinge", "saloon", "paddle", "pendulum", "pivot"], anchor="the hinge, at the top",
                      description="A plank hinged at its top end: it hangs straight down and swings open when something hits it.",
                      source="A plank pivoted to the world on a frictionless hinge.", facts="40 cm gate", edit=[{"kind": "swing", "prop": "start_angle", "length": "length"}, {"kind": "rotate"}]))


# ---------------------------------------------------------------- containers
def _vessel(noun):
    def build(c, P):
        W, H, t, d = P["width"], P["wall"], P["thickness"], P["depth"]
        Wb = W * P["bottom_ratio"]
        c.slab("floor", Wb, t, d, 0, -t / 2, kind="static", words=f"the {noun}'s floor")
        run = (W - Wb) / 2
        L = math.hypot(run, H)
        phi = math.degrees(math.atan2(run, H))
        for side, nm in ((-1, "left"), (1, "right")):
            c.slab(nm, t, L, d, side * ((Wb - t) / 2 + run / 2), H / 2, langle=-side * phi, kind="static", words=f"the {noun}'s {nm} wall")
    return build


def _container(key, noun, material, materials, size, ratio, tags, description, source):
    W, H, t, d = size
    register(ItemType(key, noun.capitalize(), "Containers", _vessel(noun), dynamic=False, material=material, materials=materials,
                      props=[Prop("width", "Width (top)", W, 0.03, 1.5, 0.005, "m"), Prop("wall", "Depth", H, 0.02, 1.0, 0.005, "m", "Wall height; a bouncy ball hops out of a shallow one"),
                             Prop("thickness", "Wall thickness", t, 0.002, 0.05, 0.001, "m"), Prop("depth", "Front to back", d, 0.02, 1.0, 0.01, "m"),
                             Prop("bottom_ratio", "Bottom width / top width", ratio, 0.3, 1.0, 0.01, "", "1 is straight sides, less is tapered")],
                      tags=tags, description=description, source=source, anchor="the middle of its floor's top", facts=f"{W * 100:.0f} cm wide, {H * 100:.0f} cm deep",
                      edit=[{"kind": "boxWidth", "prop": "width"}, {"kind": "top", "prop": "wall"}]))


def _containers():
    _container("cup", "cup", "cardboard", ["cardboard", "aluminium", "glass", "varnished hardwood"], (0.08, 0.10, 0.003, 0.08), 0.7,
               ["mug", "glass", "paper cup", "catch", "target", "goal", "pot", "plinko", "bin", "container"],
               "A small tapered cup: a target to land things in.", "A paper cup is about 8 cm across and 10 cm tall.")
    _container("bucket", "bucket", "aluminium", ["aluminium", "steel", "cardboard", "varnished hardwood"], (0.28, 0.27, 0.004, 0.304), 0.78,
               ["pail", "tub", "pot", "catch", "target", "goal", "container", "bin", "tapered"],
               "A tapered metal bucket: wider at the top than at the bottom.", "A 10 litre pail is about 28 cm across the top, 22 cm at the base and 27 cm tall.")
    _container("basket", "basket", "dark wood", ["dark wood", "varnished hardwood", "cardboard", "cork"], (0.45, 0.18, 0.01, 0.30), 1.0,
               ["hamper", "crate", "tray", "catch", "target", "goal", "container", "wide", "low", "bin"],
               "A wide, low basket with straight sides: easy to hit, easy to bounce out of.", "A laundry-sized basket; the size is provisional.")


# ---------------------------------------------------------------- groups
def _groups():
    # --- Newton's cradle
    def build_cradle(c, P):
        n, d, L, a, step = int(P["count"]), P["ball_diameter"], P["length"], P["start_angle"], P["ball_diameter"] + P["gap"]
        r = d / 2
        for i in range(n):
            # each ball hangs by two fine strings in a V (they line up in the side view, so one 1 mm "string" is the physics), 9 cm deep like the frame
            # (the V spreads about as wide as the base is deep, which keeps a real cradle's swing in one plane). The string weighs about a gram.
            _hung_ball(c, str(i + 1), i * step, 0.0, L, a if i == 0 else 0.0, d, MATERIALS[P["material"]]["density"], rod_thickness=0.001, rod_depth=0.09,
                       rod_density=round(0.001 / (0.001 * L * 0.09), 1), rod_words="a fine string", rod_look="fabric")
        if P["frame"]:
            reach = L * math.sin(math.radians(min(abs(a), 90.0))) + r + 0.03
            left, right = -reach, (n - 1) * step + reach
            top, base = 0.0145, -(L + r + 0.05)   # the top bar's underside is 2.5 mm above the rods' top ends
            frame = c.mat(base="steel", overrides={})
            c.slab("bar", right - left, 0.012, 0.09, (left + right) / 2, 0.0085, kind="static", words="the cradle's top bar", look="steel", material=frame)
            for nm, x in (("post-left", left), ("post-right", right)):
                c.slab(nm, 0.012, top - base, 0.09, x, (top + base) / 2, kind="static", words="a post of the cradle's frame", look="steel", material=frame)
            # the base is a walnut plinth (the 3D model draws it so): a ball that falls on it bounces off wood, not steel
            c.slab("base", right - left + 0.012, 0.012, 0.14, (left + right) / 2, base - 0.006, kind="static", words="the cradle's base", look="dark wood", material=c.mat(base="dark wood", overrides={}))
    register(ItemType("newtons-cradle", "Newton's cradle", "Groups", build_cradle, material="steel", materials=["steel", "aluminium", "varnished hardwood", "solid rubber"],
                      props=[Prop("count", "Balls", 5, 2, 9, 1, "", "How many hang in the row", kind="int"), Prop("ball_diameter", "Ball diameter", 0.04, 0.01, 0.15, 0.001, "m"),
                             Prop("length", "String length", 0.3, 0.1, 1.0, 0.01, "m", "From each pivot to the middle of its ball"),
                             Prop("start_angle", "First ball pulled back", -35.0, -90.0, 90.0, 1.0, "°", "Negative pulls it to the left"),
                             Prop("gap", "Gap between balls", 0.001, 0.0, 0.01, 0.0005, "m", "A real cradle's balls hang a hair apart; 0 makes them touch exactly"),
                             Prop("frame", "Show the frame", True, kind="bool")],
                      tags=["desk toy", "balls", "momentum", "swinging balls", "click clack", "executive toy", "pendulums", "collision"],
                      description="Steel balls hanging in a row, touching: pull one back and let go, and the one at the other end swings out.",
                      source="Hard steel balls, e about 0.95 (hard steel on steel at low speed); light wooden rods.", anchor="the pivot of the first (left) ball",
                      facts="5 balls, 4 cm, 30 cm strings", edit=[{"kind": "swing", "prop": "start_angle", "length": "length"}, {"kind": "rotate"}]))

    # --- peg board
    def build_pegboard(c, P):
        rows, cols, s, d = int(P["rows"]), int(P["columns"]), P["spacing"], P["peg_diameter"]
        # the pegs stand out of a backboard (3D only): long enough that a ball between two pegs (at most s wide) clears it
        depth3d = round(min(0.2, max(0.06, 0.9 * s)), 4)
        for r in range(rows):
            n = cols if r % 2 == 0 else cols - 1
            for j in range(n):
                c.ball(f"peg{r + 1}-{j + 1}", d / 2, (j - (n - 1) / 2) * s, -r * s * math.sqrt(3) / 2, shape="cylinder",
                       depth3d=depth3d, words="a small steel peg")
    register(ItemType("peg-board", "Peg board", "Groups", build_pegboard, dynamic=False, material="steel", materials=["steel", "aluminium", "varnished hardwood", "solid rubber"],
                      props=[Prop("rows", "Rows", 8, 2, 20, 1, "", "Rows of pegs, top to bottom", kind="int"), Prop("columns", "Pegs in a row", 7, 2, 20, 1, "", kind="int", help="Every other row has one fewer"),
                             Prop("spacing", "Spacing", 0.07, 0.03, 0.3, 0.005, "m", "Between neighbours in a row; a ball must be narrower than this minus the peg"),
                             Prop("peg_diameter", "Peg diameter", 0.008, 0.003, 0.05, 0.001, "m")],
                      tags=["plinko", "pachinko", "galton board", "pins", "grid", "bean machine", "random", "pegs", "quincunx"],
                      description="A grid of fixed pegs, every other row shifted half a step, like a Plinko or Galton board.",
                      source="Fixed steel pegs in a triangular grid (row spacing √3/2 of the spacing).", anchor="the middle of its top row",
                      facts="8 rows, 7 pegs wide, 7 cm apart", edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- air
def _air():
    def build_fan(c, P):
        D = P["diameter"]
        H = D + 0.04
        R = H / 2
        # a desk fan seen from the side. The cage is an octagon: flat guards (r < 7 cm) front and back, cones out to a rim band 3 cm wide
        # (its side outline), on a motor housing behind it (a 12 cm round barrel, 10 cm long) that sits on a neck and a weighted round base
        fr = round(min(0.07, 0.45 * R), 5)      # the flat middle of each guard
        cage = [(0.05, -fr), (0.05, fr), (0.015, R), (-0.015, R), (-0.05, fr), (-0.05, -fr), (-0.015, -R), (0.015, -R)]
        c.poly("housing", cage, H, -0.05, 0.0, kind="static", words="a desk fan's wire cage", look="aluminium")
        c.slab("motor", 0.10, 0.12, 0.15, -0.15, 0.0, kind="static", words="the fan's motor housing", look="aluminium")
        # the neck runs from under the motor down to a base that stands 2 cm under the cage's lowest wire
        neck = round(R - 0.04, 4)
        c.slab("neck", 0.04, neck, 0.04, -0.15, -0.06 - neck / 2, kind="static", words="the fan's neck", look="aluminium")
        c.slab("base", 0.2, 0.025, 0.2, -0.15, -0.06 - neck - 0.0125, kind="static", words="the fan's round base", look="aluminium")
        x, y = c.world(0.0, 0.0)
        c.sb.animated.append({
            "kind": "animated", "id": f"{c.item['id']}/blades", "words": "a fan's spinning blades", "sprite": "fan", "item": c.item["id"],
            "vector": [{"id": "blades", "tag": "ellipse", "attrs": {"cx": -0.05, "cy": 0, "rx": 0.008, "ry": round(D / 2 * 0.92, 4), "fill": "#dde3e8", "stroke": "#555", "stroke-width": 0.003}},
                       {"id": "hub", "tag": "circle", "attrs": {"cx": -0.05, "cy": 0, "r": 0.025, "fill": "#555"}}],
            "at": {"x": round(x, 5), "y": round(y, 5)}, "keys": [{"t": 0.0, "angle": round(c.a, 6)}],
            "airflow": {"from": P["on_at"], "at": {"x": 0.02, "y": 0.0}, "direction": 0.0, "diameter": round(D * 0.9, 4), "speed": P["speed"],
                        "source": "Round free jet (Rajaratnam, Turbulent Jets, 1976); a household fan blows 2-8 m/s at its face (provisional)."},
            "depth": 3})
    register(ItemType("fan", "Fan", "Air", build_fan, dynamic=False, material="aluminium", materials=["aluminium", "steel"],
                      props=[Prop("speed", "Air speed", 5.0, 0.5, 15.0, 0.5, "m/s", "How fast the air leaves the fan"), Prop("diameter", "Blade diameter", 0.30, 0.1, 0.6, 0.01, "m"),
                             Prop("on_at", "Switch on at", 0.0, 0.0, 10.0, 0.1, "s")],
                      tags=["blower", "wind", "breeze", "air", "blow", "propeller", "cooler", "gust", "draft"],
                      description="A desk fan on its base. The air blows the way the fan points (turn it with the item's angle) and pushes light things along.",
                      source="A round free jet: speed holds for about 6 diameters, then fades (Rajaratnam, Turbulent Jets, 1976).",
                      anchor="the middle of its front face", facts="blows 5 m/s along its angle", edit=[{"kind": "rotate"}]))
