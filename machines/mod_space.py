"""GRAVITY + SPACE (physics module "space"): the Sun, the planets, their moons and satellites of an ORBIT scene, a 2D N-body mode in the
machine plane (seen face on: the machine plane is the plane of the orbits), and a geologist's hammer (Apollo 15) for drops on other worlds.

Places (Earth, the Moon, Mars ...) are the scene's settings (scene.settings.gravity and .air, machines/items.py settings_of): nothing here.

Orbit mode. A scene holding a space body (sun, planet, moon, satellite) is in space: the build hook turns its uniform gravity off and its air
out (doc.settings gravity 0, air false), whatever the scene's settings say. Every body that attracts (the Sun, a planet, a moon) pulls every
moving solid with Newton's gravity, a = mu/r^2 toward its centre (inside its own radius mu*r/R^3: a uniform sphere), mu = G*M scaled to the
scene: the scene's SCALE (km per metre and real time per scene second) is the heaviest body's own `scale`, so real ratios are kept (masses,
distance ratios, period ratios): mu_scene = G*M*s^2/(1000*k)^3 with k km per metre and s real seconds per scene second (both kept in every
body's process record, so the run can say real distances, speeds and periods). A body launched to orbit (orbit_factor > 0) gets, at the
scene's release, the circular speed round its primary (`primary`, else the attractor that dominates it: the highest mu/r^3) times that
factor, at right angles to the line between them (counter-clockwise or clockwise), the pair's barycentre kept where it was: 1 circles,
under 1 falls in, sqrt(2) escapes. The engine's process "space-body" (tooling/src/sim/modules/space.ts) does both, and sets the readings.

Engine masses: a space body weighs ENGINE_KG times its real mass in the engine (Earth 5972 kg), so attracting bodies pull each other with
equal and opposite forces (F = m_i*mu_j/r^2 = m_j*mu_i/r^2 when m is proportional to mu) and collisions between them are sane; a satellite
(a test body) weighs its model's own weight and pulls nothing (the ISS's 420 t are 4e-19 of the Earth).

Sizes: a body is drawn (and collides) at its true size at the scene's scale or, where that would be too small to see, at its visible size
(`diameter`, automatic until set): planets of the Earth-Moon scale are drawn larger than true; the Earth of the low-orbit scale is its true
1.27 m. Real data: NASA NSSDCA planetary, lunar, Jovian, Saturnian and Martian satellite fact sheets (D. R. Williams,
nssdc.gsfc.nasa.gov/planetary/factsheet) [NASA-PFS]; G = 6.67430e-11 m^3/(kg s^2) [CODATA18]; 1 au = 149 597 870.7 km [IAU 2012 B2];
the Sun's radius 695 700 km [IAU 2015 B3]; Apollo 15: a 1.32 kg geologic hammer and a 0.03 kg falcon feather (NASA Apollo 15 Lunar Surface
Journal, "The hammer and the feather", D. Scott, 2 Aug 1971) [APOLLO15].
web/sim/modules/space.js is its exact JavaScript port (the parity tools compare them number for number)."""
import math

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "register_goal_kind", "register_build_hook", "register_warning_hook", "MATERIALS", "props_of", "add_look",
          "LOOK_FILL", "CATEGORIES", "TYPES", "cos", "sin", "D2R")
CAT = "Space"

G = 6.6743e-11            # m^3/(kg s^2) [CODATA18]
ENGINE_KG = 1e-21         # engine kilograms per real kilogram of a space body (only ratios matter: Earth 5972 kg, the Sun 1.99e9 kg)
AU_KM = 149597870.7       # km [IAU 2012 B2]

# key: (name, kind, mass kg, mean radius km, smallest drawn diameter m, colour, usual primary, a km round it, sidereal period days) [NASA-PFS]
BODIES = {
    "sun": ("the Sun", "star", 1.9885e30, 695700.0, 0.3, "#ffcc4d", None, 0.0, 0.0),
    "mercury": ("Mercury", "planet", 3.3010e23, 2439.7, 0.05, "#9e9a94", "sun", 57909000.0, 87.969),
    "venus": ("Venus", "planet", 4.8673e24, 6051.8, 0.1, "#e3c48a", "sun", 108210000.0, 224.701),
    "earth": ("Earth", "planet", 5.9722e24, 6371.0, 0.11, "#3f73c4", "sun", 149598000.0, 365.256),
    "mars": ("Mars", "planet", 6.4169e23, 3389.5, 0.06, "#c1502e", "sun", 227956000.0, 686.98),
    "jupiter": ("Jupiter", "planet", 1.89813e27, 69911.0, 0.22, "#d2b48c", "sun", 778479000.0, 4332.589),
    "saturn": ("Saturn", "planet", 5.6832e26, 58232.0, 0.19, "#e0c88f", "sun", 1432041000.0, 10759.22),
    "uranus": ("Uranus", "planet", 8.6811e25, 25362.0, 0.12, "#9fd8e0", "sun", 2867043000.0, 30685.4),
    "neptune": ("Neptune", "planet", 1.02409e26, 24622.0, 0.12, "#4166d5", "sun", 4514953000.0, 60189.0),
    "pluto": ("Pluto", "planet", 1.303e22, 1188.3, 0.025, "#c9b49a", "sun", 5869656000.0, 90560.0),
    "moon": ("the Moon", "moon", 7.346e22, 1737.4, 0.03, "#b9b5ae", "earth", 384400.0, 27.3217),
    "io": ("Io", "moon", 8.932e22, 1821.6, 0.03, "#e8d36a", "jupiter", 421800.0, 1.769),
    "europa": ("Europa", "moon", 4.8e22, 1560.8, 0.027, "#d8cbb3", "jupiter", 671100.0, 3.551),
    "ganymede": ("Ganymede", "moon", 1.4819e23, 2631.2, 0.04, "#a99f92", "jupiter", 1070400.0, 7.155),
    "callisto": ("Callisto", "moon", 1.0759e23, 2410.3, 0.037, "#6f665d", "jupiter", 1882700.0, 16.689),
    "titan": ("Titan", "moon", 1.3455e23, 2574.73, 0.04, "#d9a54a", "saturn", 1221870.0, 15.945),
    "phobos": ("Phobos", "moon", 1.0659e16, 11.08, 0.015, "#7d6f62", "mars", 9378.0, 0.319),
    "deimos": ("Deimos", "moon", 1.4762e15, 6.2, 0.012, "#8f8274", "mars", 23459.0, 1.262),
}
PLANETS = ["earth", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]
MOONS = ["moon", "io", "europa", "ganymede", "callisto", "titan", "phobos", "deimos"]

# the scene's scale: name -> (km per metre, real seconds per scene second, words)
SCALES = {
    "inner-planets": (149597870.7, 3456000.0, "1 m = 1 au (149.6 million km), 1 s = 40 days: Earth circles the Sun in 9.1 s, Mercury in 2.2 s"),
    "earth-moon": (300000.0, 172800.0, "1 m = 300,000 km, 1 s = 2 days: the Moon (1.28 m out) circles the Earth in 13.7 s"),
    "low-orbit": (10000.0, 600.0, "1 m = 10,000 km, 1 s = 10 minutes: the Earth is 1.27 m across, the ISS (420 km up) circles it in 9.3 s"),
    "jupiter-moons": (1000000.0, 43200.0, "1 m = 1 million km, 1 s = 12 hours: Io (0.42 m out) circles Jupiter in 3.5 s, Ganymede (1.07 m) in 14.3 s"),
    "mars-moons": (20000.0, 7200.0, "1 m = 20,000 km, 1 s = 2 hours: Phobos (0.47 m out) circles Mars in 3.8 s, Deimos (1.17 m) in 15.1 s"),
}
SCALE_CHOICES = ["auto", "inner-planets", "earth-moon", "low-orbit", "jupiter-moons", "mars-moons", "custom"]
AUTO_SCALE = {"sun": "inner-planets", "earth": "earth-moon", "jupiter": "jupiter-moons", "saturn": "jupiter-moons", "mars": "mars-moons"}
BODY_TYPES = ("sun", "planet", "moon")
SPACE_TYPES = ("sun", "planet", "moon", "satellite")
DIRECTIONS = ["counter-clockwise", "clockwise"]
# satellites: kind -> (name, slab width, height, depth (m), mass kg, look); a model's weight changes nothing of its orbit
CRAFT = {
    "satellite": ("a small satellite", 0.09, 0.026, 0.03, 0.2, "foil"),
    "space-station": ("a space station", 0.12, 0.034, 0.05, 0.4, "foil"),
    "cannonball": ("an iron cannonball", None, None, None, 0.111, "iron"),
    "probe": ("a space probe", 0.05, 0.03, 0.03, 0.15, "foil"),
}
# a moon's orbit's tilt to its planet's orbit round the Sun (degrees): the Moon's 5.145 to the ecliptic [NASA lunar fact sheet]; the others
# orbit close to their planet's equator (within 0.5 deg for Io, Europa, Ganymede, Callisto and Titan, about 1-2 deg for Phobos and Deimos
# [NASA-PFS satellite fact sheets]), so their tilt is the planet's own axial tilt (Jupiter 3.13, Saturn 26.73, Mars 25.19 [NASA-PFS])
MOON_TILT = {"moon": 5.145, "io": 3.13, "europa": 3.13, "ganymede": 3.13, "callisto": 3.13, "titan": 26.73, "phobos": 25.19, "deimos": 25.19}
# a planet's axial tilt (obliquity to its orbit, degrees) [NASA-PFS]; over 90: it turns backwards (Venus, Uranus, Pluto)
OBLIQUITY = {"mercury": 0.034, "venus": 177.36, "earth": 23.44, "mars": 25.19, "jupiter": 3.13, "saturn": 26.73, "uranus": 97.77, "neptune": 28.32,
             "pluto": 122.53}
DATES = ["march equinox", "june solstice", "september equinox", "december solstice"]


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CAT not in CATEGORIES:
        CATEGORIES.append(CAT)
    _looks()
    _materials()
    _bodies()
    _craft()
    _hammer()
    _gnomon()
    _globe()
    _moon_ball()
    register_build_hook(_orbit_mode)
    register_build_hook(_lights)
    register_warning_hook(_space_warnings)
    for kind, fn in GOALS:
        register_goal_kind(kind, fn)


def _looks():
    for key, kw in (("star", dict(fill="#ffcc4d", shade="#e09a1a", roughness=1.0, metalness=0.0, clearcoat=0.0)),
                    ("planet", dict(fill="#3f73c4", shade="#2a4f8a", roughness=0.85, metalness=0.0, clearcoat=0.0)),
                    ("moon rock", dict(fill="#b9b5ae", shade="#85817a", roughness=0.95, metalness=0.0, clearcoat=0.0)),
                    ("foil", dict(fill="#d4a63a", shade="#9c7420", roughness=0.3, metalness=0.9, clearcoat=0.0)),
                    ("iron", dict(fill="#3a3a3c", shade="#1f1f21", roughness=0.55, metalness=0.7, clearcoat=0.0))):
        if key not in LOOK_FILL:
            add_look(key, **kw)


def _materials():
    # (a space body's density is whatever makes it weigh ENGINE_KG x its real mass; its bounce and friction are a rocky surface's, provisional)
    MATERIALS.setdefault("planet rock", dict(density=3000.0, bounce=0.3, friction=0.7, rolling=0.02, side=0.0, look="planet",
                                             source="A rocky surface (provisional); the density follows the body's real mass (engine scale)."))
    MATERIALS.setdefault("spacecraft aluminium", dict(density=2700.0, bounce=0.4, friction=0.3, rolling=0.01, side=0.0, look="foil",
                                                      source="Aluminium 2700 kg/m3 (CRC); a model's density follows its stated weight."))
    MATERIALS.setdefault("cast iron", dict(density=7870.0, bounce=0.5, friction=0.4, rolling=0.005, side=0.0, look="iron",
                                           source="Iron 7870 kg/m3 (CRC)."))
    MATERIALS.setdefault("craft foam", dict(density=25.0, bounce=0.3, friction=0.6, rolling=0.02, side=0.0, look="foam",
                                            source="A white craft-foam (expanded polystyrene) ball, about 25 kg/m3 (EPS 15-35 kg/m3, EN 13163; provisional)."))


# ---------------------------------------------------------------- the scene's scale and a body's size
def body_key(item, P):
    return "sun" if item["type"] == "sun" else P["body"]


def scale_of(item, P):
    """(km per metre, real seconds per scene second, name) that this body's own scale says."""
    name = P["scale"]
    if name == "auto":
        name = AUTO_SCALE.get(body_key(item, P), "low-orbit")
    if name == "custom":
        return P["km_per_m"], P["hours_per_s"] * 3600.0, name
    k, s, _ = SCALES[name]
    return k, s, name


def heaviest(scene_items):
    """The scene's heaviest space body (its item and props) or None: it sets the scene's scale (the first of equals)."""
    best, bm = None, -1.0
    for it in scene_items.values():
        if it.get("type") not in BODY_TYPES:
            continue
        P = props_of(it)
        b = BODIES.get(body_key(it, P))
        if b is None or P.get("pulls") is False:
            continue
        m = b[2] * P["mass_scale"]
        if m > bm:
            best, bm = (it, P), m
    return best


def scene_scale(c):
    """The scene's scale: (km per metre, real seconds per scene second, name, the item that sets it)."""
    h = heaviest(c.sb.scene_items)
    if h is None:
        k, s, _ = SCALES["earth-moon"]
        return k, s, "earth-moon", None
    k, s, name = scale_of(h[0], h[1])
    return k, s, name, h[0]["id"]


def _mu(mass, k, s):
    """mu = G*M in scene units (m^3/s^2) for k km per metre and s real seconds per scene second."""
    m = k * 1000.0
    return G * mass * (s * s) / (m * m * m)


def _launch(c, P):
    f = P["orbit_factor"]
    if f <= 0:
        return None
    return {"factor": f, "direction": "cw" if P["direction"] == "clockwise" else "ccw"}


def _primary(c):
    p = c.link("primary")
    return f"{p}/body" if p else None


# ---------------------------------------------------------------- the Sun, planets and moons
def build_body(c, P):
    item = c.item
    key = body_key(item, P)
    name, kind, mass, radius_km, show, color, _, _, _ = BODIES[key]
    k, s, scale, setter = scene_scale(c)
    given = item.get("props") or {}
    far = item["type"] == "sun" and P["pulls"] is False      # a far-away Sun that only shines: no pull, parallel light (at infinity), held still
    if "diameter" not in given:   # (true size at the scale, or the visible size; a far Sun is drawn at its visible size: it is not where it is drawn)
        P["diameter"] = round(show, 5) if far else round(max(2.0 * radius_km / k, show), 5)
    r = round(P["diameter"] / 2.0, 5)
    m = mass * P["mass_scale"]
    vol = (4.0 / 3.0) * math.pi * (r * r * r)
    x = m * ENGINE_KG / vol
    density = round(x, 6) if x >= 1 else float(f"{x:.6g}")
    look = "star" if kind == "star" else ("moon rock" if kind == "moon" else "planet")
    sid = c.ball("body", r, material=c.mat(base="planet rock", density=density, overrides={}), look=look, words=name.replace("the ", ""), color=color,
                 kind="static" if far else None, stand="none")
    rec = {"solid": sid, "mu": 0.0 if far else _mu(m, k, s), "radius": r, "radius_km": radius_km, "fixed": far or c.kind == "static", "star": kind == "star",
           "km_per_m": k, "s_per_s": s, "scale": scale}
    if far:
        rec["far"] = True
    if item["type"] != "sun":
        launch = _launch(c, P)
        if launch is not None:
            rec["launch"] = launch
        rec["primary"] = _primary(c)
        if kind == "moon":
            rec["phase"] = True
            # its orbit's tilt and line of nodes (the eclipses), and how far its planet is from the Sun (a far Sun's distance), real km
            if "orbit_tilt" not in given:
                P["orbit_tilt"] = MOON_TILT.get(key, 0.0)
            rec["tilt"] = P["orbit_tilt"]
            rec["node"] = P["node_deg"]
            pid = c.link("primary")
            pit = c.sb.scene_items[pid] if pid is not None else None
            planet = BODIES.get(body_key(pit, props_of(pit))) if pit is not None else BODIES.get(BODIES[key][6] or "")
            if planet is not None and planet[1] == "planet":
                rec["sun_km"] = planet[7]
                # (the 3D view lifts the drawn Moon off the plane by its height above it times the factor its planet is drawn larger than true)
                if pit is not None:
                    PP = props_of(pit)
                    pk = body_key(pit, PP)
                    pd = PP["diameter"] if "diameter" in (pit.get("props") or {}) else max(2.0 * BODIES[pk][3] / k, BODIES[pk][4])
                    P["lift_per_km"] = round((pd / 2.0) / BODIES[pk][3], 9)
        if kind == "planet":
            if "axis_tilt" not in given:
                P["axis_tilt"] = OBLIQUITY.get(key, 0.0)
            if P["seasons"] is True:
                rec["seasons"] = {"tilt": P["axis_tilt"], "date": P["start_date"], "lat": P["town_lat"]}
                P["season_axis"] = _season_axis(c, P)
    c.process("space-body", "gravity", **rec)
    P["real_mass_kg"] = m
    P["s_per_s"] = s       # (the scene's real seconds per scene second: the 3D view turns the globe at its real rate when that can be seen)


def _season_axis(c, P):
    """For the 3D view: the planet's north axis (x, y, z; z toward the camera = the orbit's pole for a counter-clockwise orbit) at the start,
    leaning for its start date from the scene's Sun (the first pulling one, else the first) as tooling/src/sim/space.ts seasonLean does."""
    suns = [i for i in c.sb.scene_items.values() if isinstance(i, dict) and i.get("type") == "sun" and i.get("id") != c.item["id"]]
    sun = next((i for i in suns if props_of(i).get("pulls") is not False), suns[0] if suns else None)
    if sun is None:
        return None
    dx, dy = float(sun.get("x", 0.0)) - float(c.item.get("x", 0.0)), float(sun.get("y", 0.0)) - float(c.item.get("y", 0.0))
    d = math.sqrt(dx * dx + dy * dy)
    if d <= 0:
        return None
    sx, sy = dx / d, dy / d
    sense = -1.0 if P["direction"] == "clockwise" else 1.0
    date = P["start_date"]
    if date == "june solstice":
        bx, by = sx, sy
    elif date == "december solstice":
        bx, by = -sx, -sy
    else:
        bx, by = -sy * sense, sx * sense
        if date == "september equinox":
            bx, by = -bx, -by
    e = P["axis_tilt"] * D2R
    return [round(sin(e) * bx, 6) + 0.0, round(sin(e) * by, 6) + 0.0, round(cos(e) * sense, 6) + 0.0]   # (+ 0.0: never a -0.0)


def _scale_props(default_scale="auto"):
    return [Prop("scale", "Scene scale", default_scale, kind="choice", choices=SCALE_CHOICES,
                 help="How big and how fast the scene is (set by its heaviest body): auto = the body's own (the Sun: 1 m = 1 au, 1 s = 40 days; "
                      "Earth: 1 m = 300,000 km, 1 s = 2 days; Jupiter: 1 m = 1 million km, 1 s = 12 h; Mars: 1 m = 20,000 km, 1 s = 2 h; "
                      "low-orbit: 1 m = 10,000 km, 1 s = 10 min); custom uses the two numbers below"),
            Prop("km_per_m", "Custom scale: km per metre", 300000.0, 100.0, 1e10, 100.0, "km", "Used when the scale is custom"),
            Prop("hours_per_s", "Custom scale: hours per second", 48.0, 0.01, 100000.0, 0.01, "h", "Real hours that pass in each second of the run (custom scale)")]


def _launch_props(default):
    return [Prop("orbit_factor", "Launch speed", default, 0.0, 3.0, 0.01, "× orbit speed",
                 "At the release it is sent sideways at this many times the speed of a circle round what it circles: 1 a circle, "
                 "under 1 it falls in (an ellipse that meets it), between 1 and 1.41 an ellipse, 1.41 (the square root of 2) or more it escapes; 0 = let go at rest"),
            Prop("direction", "Goes round", "counter-clockwise", kind="choice", choices=DIRECTIONS, help="As seen from the front")]


def _readouts():
    """The readings the engine's space-body process sets (tooling/src/sim/modules/space.ts)."""
    base = [Readout("distance", "Distance to what it circles", "m", 3, "Centre to centre, in the scene"),
            Readout("distance_km", "Real distance", "km", 0, "The same at the scene's scale"),
            Readout("speed", "Speed round it", "m/s", 3, "Relative to what it circles, in the scene"),
            Readout("speed_kms", "Real speed", "km/s", 2, "The same at the scene's scale"),
            Readout("turns", "Orbits completed", "", 2, "Turns round what it circles, in its own direction"),
            Readout("fell", "Fell in", "", 0, "1 once it has hit what it circles"),
            Readout("escaped", "Escaping", "", 0, "1 while it moves away faster than escape speed")]
    phase = [Readout("lit", "Lit fraction seen from its planet", "", 3, "(1 + cos i)/2, i the Sun-moon-planet angle (Meeus ch. 48)"),
             Readout("elongation", "Angle from the Sun", "°", 1, "Seen from its planet, counter-clockwise from the Sun: 0 new, 90 first quarter, 180 full, 270 last quarter"),
             Readout("height_km", "Height above its planet's orbit plane", "km", 0, "Its tilted orbit takes it above (+) and below (-) the plane its planet circles the Sun in"),
             Readout("latitude", "Angle above that plane", "°", 2, "Seen from its planet (the Moon: up to 5.1)"),
             Readout("lunar_eclipse", "Lunar eclipse", "", 0, "Its planet's shadow on it: 0 none, 1 penumbral, 2 partial, 3 total (real sizes and distances)"),
             Readout("solar_eclipse", "Solar eclipse", "", 0, "Its shadow on its planet: 0 none, 1 partial, 2 annular, 3 total (real sizes and distances)")]
    return base, phase


def _season_props():
    return [Prop("seasons", "Seasons", False, kind="bool",
                 help="Read the seasons as it goes round its Sun: its axis tilted (below) and kept pointing one way in space, the Sun's noon height and the "
                      "day's length at a town (needs a sun in the scene)"),
            Prop("axis_tilt", "Axis tilt", 23.44, 0.0, 180.0, 0.01, "°", "From its orbit's pole: automatic = its real one (Earth 23.44, Mars 25.19, Uranus 97.77)",
                 auto=("body",)),
            Prop("start_date", "Date at the start", "march equinox", kind="choice", choices=DATES,
                 help="Where it is in its year at the start (for its northern half): which way its pole leans from the Sun then"),
            Prop("town_lat", "Town's latitude", 30.27, -90.0, 90.0, 0.01, "°", "Where the seasons are read: + north (Austin 30.27, London 51.5), - south")]


def _season_readouts():
    return [Readout("sun_lat", "Latitude the Sun is overhead", "°", 2, "+ north of the equator (+23.44 at Earth's June solstice), - south"),
            Readout("noon_elevation", "Noon Sun's height at the town", "°", 2, "90 - |latitude - where the Sun is overhead| (Meeus)"),
            Readout("day_length_h", "Day length at the town", "h", 2, "Sunrise to sunset (cos H0 = -tan(lat) tan(dec))"),
            Readout("night_lon", "Midnight sky's ecliptic longitude", "°", 1, "Opposite the Sun: the constellation on the ecliptic highest at midnight (90: Gemini, with Orion near; 270: Sagittarius)")]


def _bodies():
    READOUTS, PHASE_READOUTS = _readouts()
    common_tags = ["space", "orbit", "gravity", "solar system", "astronomy"]
    register(ItemType("sun", "Sun", CAT, build_body, module="space",
                      props=[Prop("diameter", "Drawn diameter", 0.3, 0.005, 3.0, 0.001, "m",
                                  "Its size in the scene (it collides at this size): automatic = its true size at the scale, or 30 cm where that is too small to see",
                                  auto=("scale", "km_per_m")),
                             Prop("mass_scale", "Mass", 1.0, 0.01, 100.0, 0.01, "× real", "Times the Sun's real mass (1.99e30 kg): heavier pulls harder"),
                             Prop("pulls", "Pulls (gravity)", True, kind="bool",
                                  help="Off: a far-away Sun that only lights the scene, its light parallel (for the Moon's phases beside an Earth and Moon: the real Sun "
                                       "is 390 times farther away than the Moon, so its pull here would tear them apart)")]
                      + _scale_props(),
                      readouts=[],
                      tags=common_tags + ["star", "solar", "sunlight"],
                      description="The Sun in an orbit scene (seen from above the plane of the orbits): it pulls everything with its real gravity at the scene's scale "
                                  "and lights the planets and moons (their phases). A scene with a space body is in space: no uniform gravity, no air.",
                      source="Mass 1.9885e30 kg, radius 695,700 km [NASA-PFS, IAU 2015 B3]; mu = G*M (G 6.67430e-11, CODATA 2018) at the scene's scale.",
                      anchor="its centre", facts="1.99e30 kg · 1 m = 1 au, 1 s = 40 days"))
    register(ItemType("planet", "Planet", CAT, build_body, module="space",
                      props=[Prop("body", "Planet", "earth", kind="choice", choices=PLANETS, help="Its real mass, size and colours"),
                             Prop("diameter", "Drawn diameter", 0.11, 0.005, 3.0, 0.001, "m",
                                  "Its size in the scene (it collides at this size): automatic = its true size at the scene's scale, or a visible size where that is too small",
                                  auto=("body", "scale", "km_per_m")),
                             Prop("mass_scale", "Mass", 1.0, 0.01, 100.0, 0.01, "× real", "Times the planet's real mass: heavier pulls harder (its moons circle faster)")]
                      + _launch_props(1.0) + _scale_props() + _season_props(),
                      links=[Link("primary", "Circles", types=["sun", "planet"], help="What it is launched round (none: the body that dominates it, the Sun)")],
                      readouts=READOUTS + _season_readouts(),
                      tags=common_tags + ["earth", "mars", "jupiter", "saturn", "venus", "mercury", "neptune", "uranus", "pluto", "world", "globe", "seasons",
                                          "axis", "tilt", "axial tilt", "solstice", "equinox", "year"],
                      description="A planet with its real mass (Earth, Mars, Jupiter ...): it pulls with its real gravity at the scene's scale and, at the release, is "
                                  "launched round what it circles (the Sun) at its Launch speed (1 = a circle). Moons and satellites circle it. With Seasons on, its "
                                  "tilted axis keeps pointing one way all round its orbit: the noon Sun at a town climbs to the June solstice and sinks to December's.",
                      source="Masses, radii, distances, periods and axial tilts (Earth 23.44°): NASA NSSDCA planetary fact sheets [NASA-PFS]; mu = G*M [CODATA18]; "
                             "noon height 90° − |φ − δ|, sin δ = sin ε cos(angle from the solstice) (Meeus).",
                      anchor="its centre", facts="Earth 5.97e24 kg · launched at 1× orbit speed"))
    register(ItemType("moon", "Moon", CAT, build_body, module="space",
                      props=[Prop("body", "Moon", "moon", kind="choice", choices=MOONS, help="Earth's Moon, or a moon of Jupiter, Saturn or Mars"),
                             Prop("diameter", "Drawn diameter", 0.03, 0.005, 3.0, 0.001, "m",
                                  "Its size in the scene: automatic = its true size at the scene's scale, or a visible size where that is too small",
                                  auto=("body", "scale", "km_per_m")),
                             Prop("mass_scale", "Mass", 1.0, 0.01, 100.0, 0.01, "× real", "Times its real mass"),
                             Prop("orbit_tilt", "Orbit tilt", 5.145, 0.0, 90.0, 0.01, "°",
                                  "Its orbit's tilt to its planet's orbit round the Sun: automatic = the real one (the Moon 5.145): it passes above or below the "
                                  "Sun's line at most new and full moons, so eclipses come only near the nodes; 0 = an eclipse every new and full moon", auto=("body",)),
                             Prop("node_deg", "Nodes from the Sun", 90.0, 0.0, 360.0, 1.0, "°",
                                  "Where its tilted orbit crosses its planet's (the ascending node), counted from the Sun's direction at the start the way it goes "
                                  "round: 0 or 180 = eclipses at this new and full moon; 90 = high at full, low at new: no eclipses (most months)")]
                      + _launch_props(1.0) + _scale_props(),
                      links=[Link("primary", "Circles", types=["planet", "sun", "moon"], help="What it is launched round (none: the body that dominates it)")],
                      readouts=READOUTS + PHASE_READOUTS,
                      tags=common_tags + ["moon", "lunar", "satellite", "phases", "io", "europa", "ganymede", "callisto", "titan", "phobos", "deimos", "eclipse",
                                          "solar eclipse", "lunar eclipse", "nodes", "tilted orbit"],
                      description="A moon with its real mass (Earth's Moon, Io, Titan ...): at the release it is launched round its planet at its Launch speed "
                                  "(1 = a circle). With a Sun in the scene its phase as its planet sees it is read every moment (new, first quarter, full ...), and "
                                  "its eclipses: its orbit is tilted (the Moon's 5.145°), so its shadow (a solar eclipse) or its planet's (a lunar one) falls only "
                                  "near the nodes, where the tilted orbit crosses the planet's.",
                      source="Moon 7.346e22 kg, 1737.4 km, 384,400 km, 27.32 d, orbit tilted 5.145° to the ecliptic; Jovian, Saturnian and Martian satellite fact "
                             "sheets [NASA-PFS]; phase (1 + cos i)/2 [MEEUS ch. 48]; eclipses from the real Sun's, planet's and moon's sizes (shadow cones).",
                      anchor="its centre", facts="7.35e22 kg · circles the Earth in 27.3 days"))


# ---------------------------------------------------------------- satellites (test bodies: they pull nothing)
def build_craft(c, P):
    name, w, h, d, mass, look = CRAFT[P["kind"]]
    size = P["size"]
    if w is None:     # a cannonball: an iron ball `size` across, weighing what iron that size weighs
        r = round(size / 2.0, 5)
        sid = c.ball("body", r, material=c.mat(base="cast iron", overrides={}), look=look, words=name, stand="none")
        mass = MATERIALS["cast iron"]["density"] * (4.0 / 3.0) * math.pi * (r * r * r)
    else:
        f = size / w
        ww, hh, dd = round(w * f, 5), round(h * f, 5), round(d * f, 5)
        x = mass / (ww * hh * dd)
        sid = c.slab("body", ww, hh, dd, material=c.mat(base="spacecraft aluminium", density=round(x, 4), overrides={}), look=look, words=name, stand="none")
    rec = {"solid": sid, "mu": 0.0, "radius": 0.0, "radius_km": 0.0, "fixed": c.kind == "static", "star": False}
    launch = _launch(c, P)
    if launch is not None:
        rec["launch"] = launch
    rec["primary"] = _primary(c)
    k, s, scale, setter = scene_scale(c)
    rec["km_per_m"], rec["s_per_s"], rec["scale"] = k, s, scale
    c.process("space-body", "gravity", **rec)
    P["model_mass_kg"] = round(mass, 6)


def _craft():
    READOUTS, _ = _readouts()
    register(ItemType("satellite", "Satellite", CAT, build_craft, module="space",
                      props=[Prop("kind", "Kind", "satellite", kind="choice", choices=list(CRAFT),
                                  help="Only the look (and the model's weight, which changes nothing of its orbit): a satellite, a space station, Newton's cannonball, a probe"),
                             Prop("size", "Size", 0.09, 0.01, 0.5, 0.005, "m", "Its width in the scene (drawn far larger than true: the ISS is 109 m across)")]
                      + _launch_props(1.0),
                      links=[Link("primary", "Circles", types=["planet", "moon", "sun"], help="What it is launched round (none: the body that dominates it)")],
                      readouts=READOUTS[:2] + [Readout("altitude_km", "Real height above the surface", "km", 0, "Distance less the real radius of what it circles")] + READOUTS[2:],
                      tags=["space", "orbit", "satellite", "iss", "space station", "spacecraft", "newton's cannon", "cannonball", "probe", "rocket", "launch", "escape"],
                      description="A satellite (or a space station, a probe, Newton's cannonball) launched sideways at the release round a planet or moon at its "
                                  "Launch speed: 1 = a circular orbit, slower falls in, 1.41 or more escapes. Its own weight does not change its orbit.",
                      source="Circular speed sqrt(G*M/r), escape speed sqrt(2*G*M/r) (Newton); the ISS: about 420 km up, 92.9 min, 7.66 km/s [ISS].",
                      anchor="its centre", facts="launched at 1× orbit speed · pulls nothing"))


# ---------------------------------------------------------------- a geologist's hammer (Apollo 15)
HAMMER_SPLIT = 0.62   # the share of its weight in the steel head (a rock hammer's 22 oz head on a 13 in handle: Estwing E3-22P, about 0.62 of 1.0 kg; provisional)


def _hammer():
    register(ItemType("rock-hammer", "Geologist's hammer", "Blocks & shapes", _hammer_build, module="space",
                      props=[Prop("mass", "Weight", 1.32, 0.3, 3.0, 0.01, "kg", "Apollo 15's hammer weighed 1.32 kg"),
                             Prop("length", "Length", 0.33, 0.2, 0.5, 0.01, "m")],
                      tags=["hammer", "apollo", "moon", "drop", "gravity", "vacuum", "feather", "falling", "galileo", "tool"],
                      description="A geologist's hammer lying on its side (its head upright at the right end). Dropped with a feather where there is no air "
                                  "(the Moon), both land together, as David Scott showed on Apollo 15.",
                      source="1.32 kg geologic hammer [APOLLO15]; a rock hammer's head carries about 0.62 of its weight (provisional).",
                      anchor="the middle of its length, on the handle's axis", facts="1.32 kg · 33 cm"))


def _hammer_build(c, P):
    """The handle (the item's root) and the head welded at its right end: the head's place is in the handle's frame (a weld)."""
    m, L = P["mass"], P["length"]
    hw, hh, hd = 0.03, 0.17, 0.028
    th, td = 0.03, 0.025
    lw = L - hw
    head = c.mat(base="steel", density=round(HAMMER_SPLIT * m / (hw * hh * hd), 4), overrides={})
    handle = c.mat(base="varnished hardwood", density=round((1 - HAMMER_SPLIT) * m / (lw * th * td), 4), overrides={})
    root = c.slab("handle", lw, th, td, -hw / 2.0, 0.0, material=handle, look="wood", words="a hammer's handle")
    sid = c.slab("head", hw, hh, hd, (L - hw) / 2.0, 0.0, material=head, look="steel", words="a hammer's steel head")
    # (welded: its place in the handle's frame, as catalog_mechanisms.py's _child does)
    s = c.sb.solids[-1]
    s["parent"] = root
    s["at"] = {"x": round(L / 2.0, 5), "y": 0.0}
    s.pop("angle", None)
    return sid


# ---------------------------------------------------------------- a shadow stick (gnomon): the Sun's height and the shadow through the day
SEASONS = ["march equinox", "june solstice", "september equinox", "december solstice", "day of year"]
TILT_DEG = 23.44      # Earth's axial tilt (obliquity), degrees [NASA-PFS]


def build_gnomon(c, P):
    """A vertical stick standing on the ground (its foot is the item's anchor) and its sun clock: the engine's process "sun-clock" works out the
    Sun's elevation and bearing for the latitude, the date and the solar time, which runs at the scene's time-lapse, and the stick's shadow."""
    h = P["height"]
    w = round(max(0.008, min(0.04, h * 0.03)), 5)
    sid = c.slab("stick", w, h, w, 0.0, h / 2.0, material=c.mat(base="varnished hardwood", overrides={}), look="wood", words="a shadow stick")
    c.process("sun-clock", "sun", solid=sid, height=h, latitude=P["latitude"], season=P["season"], day=P["day_of_year"], hour=P["hour"],
              lapse=c.settings["time_lapse"])


def _gnomon():
    register(ItemType("gnomon", "Shadow stick (gnomon)", CAT, build_gnomon, dynamic=False, module="space",
                      props=[Prop("height", "Height", 1.0, 0.05, 3.0, 0.01, "m", "Of the stick (a flagpole in a model is a stick)"),
                             Prop("latitude", "Latitude", 30.27, -66.0, 66.0, 0.01, "°", "Where on Earth: + north (Austin 30.27, London 51.5, the equator 0), - south"),
                             Prop("season", "Date", "march equinox", kind="choice", choices=SEASONS,
                                  help="The equinoxes: the Sun over the equator; the June solstice: the longest day in the north; or the day of the year below"),
                             Prop("day_of_year", "Day of the year", 80, 1, 365, 1, "", "Used with Date = day of year (1 = 1 January)", kind="int"),
                             Prop("hour", "Solar time at the start", 9.0, 0.0, 24.0, 0.25, "h",
                                  "Hours after midnight by the Sun (12 = solar noon, the Sun highest); it runs on at the scene's time-lapse (3600 = an hour a second)")],
                      readouts=[Readout("hour", "Solar time", "h", 2, "Hours after midnight by the Sun"),
                                Readout("sun_elevation", "Sun's height", "°", 1, "Above the horizon (below 0: night)"),
                                Readout("sun_azimuth", "Sun's bearing", "°", 0, "From north, clockwise (90 east, 180 south, 270 west)"),
                                Readout("shadow_m", "Shadow length", "m", 3, "The stick's shadow on level ground (0 at night)"),
                                Readout("shadow_dir", "Shadow points to", "°", 0, "Its bearing from north, clockwise: away from the Sun"),
                                Readout("day_length_h", "Day length", "h", 2, "Sunrise to sunset that day")],
                      tags=["shadow", "sun", "gnomon", "sundial", "flagpole", "stick", "day", "night", "seasons", "noon", "time of day", "latitude", "solstice", "equinox"],
                      description="A stick standing on level ground in the Sun: its shadow is long in the morning and evening, shortest at solar noon, and points away "
                                  "from the Sun (west in the morning, east in the afternoon, north at noon north of the tropics). Set the place (latitude), the date and "
                                  "the time; with the scene's time-lapse (3600: an hour a second) the shadow sweeps round through the day. The machine plane runs east-west.",
                      source="sin(elevation) = sin(lat)·sin(dec) + cos(lat)·cos(dec)·cos(H), H = 15°·(time − 12), dec = 23.44°·sin(360°·(284 + day)/365) "
                             "(Cooper 1969; 0 at the equinoxes, ±23.44° at the solstices) [MEEUS]; shadow = height / tan(elevation).",
                      anchor="the foot of the stick, on the ground", facts="1 m stick · Austin, March equinox, 9:00"))


# ---------------------------------------------------------------- the classroom Sun-Earth-Moon models: a globe under a lamp, a moon ball on a stick
# (2026-10-20) Side view, table scale. What plays the Sun is a light of the scene (LIGHT_TYPES): the heat module's desk lamp, the optics module's
# flashlight or sunlight, or a space Sun; the build hook _lights finds it (the linked one, else the first in the scene) and writes where it is
# into the globe's and the ball's process records. The engine (tooling/src/sim/modules/space.ts "globe", "moon-ball"; tooling/src/sim/space.ts)
# does the 3D geometry: the axis and the carried circle leave the machine plane.
LIGHT_TYPES = ("lamp", "flashlight", "sunlight", "sun")
LEANS = ["toward the camera", "away from the camera", "right", "left", "toward the light", "away from the light"]
BULB_RADIUS = 0.03      # m: a 60 W A19 bulb is 60 mm across (ANSI C78.20); a desk lamp's light, as a disc, for the shadows' penumbrae
LENS_RADIUS = 0.012     # m: a 2 x AA flashlight's reflector (optics: its source's 24 mm face)


def build_globe(c, P):
    """A classroom globe: a weighted base on the table (the item's anchor is its foot), a post and the ball on it (`stand_height` from the
    table to the ball's bottom). The ball does not turn in the physics (it is held on its stand); the engine's "globe" process turns the
    model's world and reads the town's day and night; the 3D view turns the drawn ball the same."""
    R = round(P["diameter"] / 2.0, 5)
    sh = P["stand_height"]
    plastic = c.mat(base="ABS plastic", overrides={})
    c.slab("base", 0.2, 0.025, 0.2, 0.0, 0.0125, material=plastic, look="plastic", words="a globe's round base", color="#2b2b2e", stand="none")
    post_h = round(max(0.005, sh - 0.025 + 0.01), 5)
    c.slab("post", 0.014, post_h, 0.014, 0.0, round(0.025 + post_h / 2.0 - 0.005, 5), material=plastic, look="plastic", words="a globe's post", stand="none", hidden_3d=True)
    sid = c.ball("ball", R, 0.0, round(sh + R, 5), material=c.mat(base="hollow plastic", overrides={}), look="plastic", words="a classroom globe", color="#2f6fb5",
                 stand="none")
    c.process("globe", "globe", solid=sid, radius=R, tilt=P["tilt_deg"], lean=P["lean"], rpm=P["spin_rpm"], hour=P["start_hour"], lat=P["town_lat"],
              light=None, lit_by=c.link("lit_by"))
    c.sb.processes[-1]["_P"] = P      # (the build hook _lights writes where the light is into the resolved props, for the 3D view, and drops this)


def _globe():
    register(ItemType("globe", "Classroom globe", CAT, build_globe, dynamic=False, module="space",
                      props=[Prop("diameter", "Diameter", 0.3, 0.1, 0.6, 0.01, "m", "A classroom globe is 30 cm (12 in) across"),
                             Prop("stand_height", "Stand height", 0.25, 0.03, 1.0, 0.01, "m",
                                  "From the table to the ball's bottom: 0.25 puts a 30 cm globe's middle 40 cm up, level with a desk lamp's bulb"),
                             Prop("tilt_deg", "Axis tilt", 23.44, 0.0, 90.0, 0.01, "°", "From the vertical: the Earth's is 23.44 (0: no seasons)"),
                             Prop("lean", "North pole leans", "toward the camera", kind="choice", choices=LEANS,
                                  help="Which way its tilted axis points, kept so: toward the light = the June solstice (the north's summer), away = December's, "
                                       "toward or away from the camera with the light to one side = an equinox"),
                             Prop("spin_rpm", "Spin", 6.0, 0.0, 60.0, 0.1, "turns/min", "Turns a minute, west to east as the Earth (one turn is one day here: 6 = a day every 10 s)"),
                             Prop("start_hour", "Town's time at the start", 6.0, 0.0, 24.0, 0.25, "h", "Its solar time when the run starts (12 = noon, the light highest)"),
                             Prop("town_lat", "Town's latitude", 30.27, -90.0, 90.0, 0.01, "°", "Where the red pin is: + north (Austin 30.27, London 51.5, the equator 0), - south")],
                      links=[Link("lit_by", "Lit by", types=list(LIGHT_TYPES), help="The light that plays the Sun (none: the first lamp, flashlight, sunlight or sun in the scene)")],
                      readouts=[Readout("day", "Day at the town", "", 0, "1 while the light is above the town's horizon (and on), 0 at night"),
                                Readout("local_time", "Town's solar time", "h", 2, "From where the light is: 12 when it is highest"),
                                Readout("sun_elevation", "Light's height at the town", "°", 1, "Above its horizon (below 0: night)"),
                                Readout("noon_elevation", "Noon height of the light", "°", 1, "90 - |latitude - where the light is overhead| (Meeus)"),
                                Readout("sun_lat", "Latitude the light is overhead", "°", 2, "+ north: the axis leaning toward the light makes it +tilt (June)"),
                                Readout("day_length_h", "Day length at the town", "h", 2, "Hours of light in one turn (cos H0 = -tan(lat) tan(dec))"),
                                Readout("turns", "Turns", "", 2, "Since the start (one turn = one day)")],
                      tags=["globe", "earth", "day", "night", "day and night", "spin", "rotation", "rotate", "turns", "axis", "tilt", "seasons", "sunrise", "sunset",
                            "time zones", "model", "sun-earth-moon", "lamp", "classroom globe", "terminator", "hemisphere"],
                      description="A 30 cm classroom globe on its stand, its axis tilted 23.44° (kept pointing one way), turning west to east, a red pin at a town. "
                                  "A lamp (or flashlight, or sunlight) plays the Sun: the half facing it is day, the other half night; the town passes from night to "
                                  "day once a turn. With its pole leaning toward the light it is the north's summer (the noon light high, long days), away from it winter.",
                      source="Earth's axial tilt 23.44° [NASA-PFS]; the light's height sin e = n·(L − P)/|L − P| at the town (P), its noon height 90° − |φ − δ| and "
                             "day length cos H0 = −tan φ tan δ (Meeus, Astronomical Algorithms ch. 13, 15).",
                      anchor="the middle of its base, on the table", facts="Ø 30 cm · tilted 23.44° · 6 turns a minute"))


def build_moon_ball(c, P):
    """A white foam ball on a stick, carried round the linked globe's middle (or round the item's own place: a viewer's eye) in a circle
    `radius` across... `radius` from it. It is carried, not thrown: its solid is a ghost (it touches nothing) held where the item stands; the
    engine's "moon-ball" process says where the hand has it and the 3D view draws it there."""
    r = round(P["diameter"] / 2.0, 5)
    # (a ghost, and clear to the optics module's rays: where the solid stands is not where the hand has the ball)
    sid = c.ball("ball", r, 0.0, 0.0, material=c.mat(base="craft foam", overrides={}), look="foam", words="a white foam ball on a stick",
                 color="#f2f0ea", kind="static", ghost=True, stand="none", optics={"role": "clear"})
    g = c.link("around")
    c.process("moon-ball", "carry", solid=sid, ball=r, radius=P["radius"], period=P["period_s"], start=P["start_deg"], tilt=P["tilt_deg"], node=P["node_deg"],
              around=f"{g}/ball" if g else None, light=None, lit_by=c.link("lit_by"))
    c.sb.processes[-1]["_P"] = P


def _moon_ball():
    register(ItemType("moon-ball", "Moon ball on a stick", CAT, build_moon_ball, dynamic=False, module="space",
                      props=[Prop("diameter", "Ball diameter", 0.075, 0.02, 0.2, 0.005, "m", "A white craft-foam ball (polystyrene), 7.5 cm (3 in)"),
                             Prop("radius", "Carried this far out", 0.6, 0.1, 2.0, 0.01, "m", "From the globe's middle (or the viewer's eye) to the ball"),
                             Prop("period_s", "Time for one trip round", 12.0, 0.0, 120.0, 0.5, "s", "Seconds to carry it once round (one month of the model; 0 = held still)"),
                             Prop("start_deg", "Starts at", 0.0, 0.0, 360.0, 1.0, "°",
                                  "How far round from the light's side at the start, counter-clockwise seen from above: 0 between the light and the globe (new moon), "
                                  "90 first quarter, 180 behind the globe (full), 270 last quarter"),
                             Prop("tilt_deg", "Circle tilt", 30.0, 0.0, 60.0, 1.0, "°",
                                  "How tilted the circle is carried: a near lamp and a big globe cast a wide shadow, so at 30° the ball passes above it at full "
                                  "moon and its own shadow misses the globe at new moon; 0 = level: an eclipse every full and new moon"),
                             Prop("node_deg", "Tilt's low and high points", 90.0, 0.0, 360.0, 1.0, "°",
                                  "Where the tilted circle crosses the level one (its ascending node), from the light's side: 90 = highest at full, lowest at new "
                                  "(no eclipses); 0 or 180 = level at new and full (eclipses)")],
                      links=[Link("around", "Carried round", types=["globe"], help="The globe it goes round (none: round the item's own place, a viewer's eye)"),
                             Link("lit_by", "Lit by", types=list(LIGHT_TYPES), help="The light that plays the Sun (none: the first lamp, flashlight, sunlight or sun in the scene)")],
                      readouts=[Readout("elongation", "Angle from the light", "°", 1, "Seen from the middle it goes round: 0 new, 90 first quarter, 180 full, 270 last quarter"),
                                Readout("lit", "Lit fraction seen from the middle", "", 3, "(1 + cos i)/2, i the light-ball-middle angle (Meeus ch. 48)"),
                                Readout("height", "Height above the middle", "m", 3, "Its tilted circle takes it above and below"),
                                Readout("lunar_eclipse", "In the globe's shadow", "", 0, "0 none, 1 penumbral, 2 partial, 3 total (a lunar eclipse)"),
                                Readout("solar_eclipse", "Its shadow on the globe", "", 0, "0 none, 1 partial, 2 annular, 3 total (a solar eclipse)")],
                      tags=["moon", "moon ball", "phases", "moon phases", "ball on a stick", "foam ball", "styrofoam", "eclipse", "lunar eclipse", "solar eclipse",
                            "new moon", "full moon", "quarter moon", "crescent", "gibbous", "model", "sun-earth-moon"],
                      description="A white foam ball on a stick carried round a globe (or round a viewer's eye) under a lamp, as the Moon goes round the Earth: "
                                  "seen from the middle it shows its phases in order (new, crescent, first quarter, gibbous, full ...). Carried level, it is eclipsed at "
                                  "full and shades the globe at new; carried on a tilted circle (as the real Moon's is tilted 5°) it misses the shadows most of the time.",
                      source="Phase: lit fraction (1 + cos i)/2 (Meeus, Astronomical Algorithms ch. 48); shadows: umbra and penumbra cones of the lamp's bulb "
                             "(60 mm across) and the balls (similar triangles); the real Moon's orbit is tilted 5.145° [NASA lunar fact sheet].",
                      anchor="the middle of the circle it is carried round (a globe's middle when it goes round one)", facts="Ø 7.5 cm · 0.6 m out · 12 s a trip"))


def _light_of(sb, iid):
    """Where the light of item iid is, for the engine: a point on a solid ({kind: point, solid, x, y, frame, radius, from}), parallel sunlight
    ({kind: parallel, dir, from}) or a far Sun ({kind: far, solid, from}); None if it is not a light this module knows."""
    it = sb.scene_items.get(iid)
    t = it.get("type") if isinstance(it, dict) else None
    if t == "lamp":
        rec = next((r for r in sb.processes if r.get("kind") == "heat" and r.get("item") == iid and r.get("role") == "lamp"), None)
        if rec is None:
            return None
        return {"kind": "point", "solid": rec["solid"], "x": rec["at"]["x"], "y": rec["at"]["y"], "frame": "world", "radius": BULB_RADIUS,
                "from": float(rec.get("from", 0.0))}
    if t in ("flashlight", "sunlight"):
        # (the optics module's build hook, which runs before this one, has gathered its source into its record; without it, it is on the solid)
        optics = next((r for r in sb.processes if r.get("kind") == "optics"), None)
        src = next((x for x in (optics or {}).get("sources", []) if isinstance(x, dict) and x.get("item") == iid and x.get("kind") in ("flashlight", "sun")), None)
        if src is None:
            src = next((x["light"] for x in sb.solids if x.get("item") == iid and isinstance(x.get("light"), dict)), None)
        if src is None:
            return None
        on = 1e9 if src.get("on") is False else float(src.get("on_at", 0.0))
        if t == "sunlight":
            return {"kind": "parallel", "dir": src["dir"], "from": on}
        return {"kind": "point", "solid": src["solid"], "x": src["x"], "y": src["y"], "frame": "solid", "radius": LENS_RADIUS, "from": on}
    if t == "sun":
        rec = next((r for r in sb.processes if r.get("kind") == "space-body" and r.get("item") == iid), None)
        if rec is None:
            return None
        if rec.get("far") is True:
            return {"kind": "far", "solid": rec["solid"], "from": 0.0}
        return {"kind": "point", "solid": rec["solid"], "x": 0.0, "y": 0.0, "frame": "world", "radius": rec["radius"], "from": 0.0}
    return None


def _lights(sb, scene):
    """After every item is built: each globe's and moon ball's light (its `lit_by` link, else the first light of the scene, in scene order)."""
    recs = [r for r in sb.processes if r.get("kind") in ("globe", "moon-ball")]
    if not recs:
        return
    first = None
    for iid, it in sb.scene_items.items():
        if isinstance(it, dict) and it.get("type") in LIGHT_TYPES and it.get("type") in TYPES:
            first = _light_of(sb, iid)
            if first is not None:
                break
    at = {x["id"]: x for x in sb.solids}
    for r in recs:
        want = r.pop("lit_by", None)
        P = r.pop("_P", None)
        light = _light_of(sb, want) if want is not None else None
        r["light"] = light if light is not None else first
        if P is None:
            continue
        # for the 3D view (resolved props): where the circle's centre is, and the light at the start: a point {x, y}, or the unit direction
        # toward a parallel light {dx, dy, parallel}
        own = at.get(r["solid"])
        cs = at.get(r["around"]) if r.get("around") else own
        c = dict(cs["at"]) if cs is not None else {"x": 0.0, "y": 0.0}
        lv = _light_view(r["light"], at, c)
        if r["kind"] == "moon-ball":
            P["centre"] = {"x": c["x"], "y": c["y"]}
            r["centre"] = {"x": c["x"], "y": c["y"]}
            # (its ghost solid where the hand has it at the start, in the machine plane: there it is picked and dragged, not inside the globe)
            if own is not None:
                own["at"] = _ball_start(r, lv, c)
        P["light"] = lv


def _ball_start(r, lv, c):
    """Where a moon ball starts, seen in the machine plane (tooling/src/sim/space.ts carriedAt at its start angle, its depth left out): its circle's
    centre c, the light's side h along x (the lights stand in the machine plane), the start angle round from it, the tilt about the line of nodes."""
    if lv is None:
        hx = -1.0
    elif lv.get("parallel"):
        hx = 1.0 if lv["dx"] > 0 else -1.0
    else:
        hx = 1.0 if lv["x"] > c["x"] else -1.0
    # (angles as degrees × D2R: crmath's sin and cos are web/sim's own there at the multiples of 30°, the usual start, node and tilt)
    a = (r["start"] - r["node"]) * D2R
    o = r["node"] * D2R
    t = r["tilt"] * D2R
    R = r["radius"]
    return {"x": round(c["x"] + R * hx * (cos(a) * cos(o) - sin(a) * cos(t) * sin(o)), 5), "y": round(c["y"] + R * sin(a) * sin(t), 5)}


def _light_view(L, at, c):
    """The light of a record where the 3D view draws it at the start: {x, y} (a point), {dx, dy, parallel: True} (toward parallel light), or None."""
    if L is None:
        return None
    if L["kind"] == "parallel":
        return {"dx": round(-cos(L["dir"]), 6), "dy": round(-sin(L["dir"]), 6), "parallel": True}
    s = at.get(L["solid"])
    if s is None:
        return None
    if L["kind"] == "far":
        dx, dy = s["at"]["x"] - c["x"], s["at"]["y"] - c["y"]
        d = math.sqrt(dx * dx + dy * dy)
        return {"dx": round(dx / d, 6), "dy": round(dy / d, 6), "parallel": True} if d > 0 else None
    x, y = L["x"], L["y"]
    if L["frame"] == "solid" and s.get("angle"):
        a = s["angle"]
        x, y = x * cos(a) - y * sin(a), x * sin(a) + y * cos(a)
    return {"x": round(s["at"]["x"] + x, 5), "y": round(s["at"]["y"] + y, 5)}


# ---------------------------------------------------------------- orbit mode (the build hook)
def _orbit_mode(sb, scene):
    """A scene holding a space body is in space: no uniform gravity and no air, whatever its settings say (the plane is the plane of the orbits)."""
    if any(isinstance(i, dict) and i.get("type") in SPACE_TYPES and i.get("type") in TYPES for i in scene.get("items", [])):
        sb.settings["gravity"] = 0.0
        sb.settings["air"] = False


def _space_warnings(scene, doc):
    """A space scene (orbit mode, _orbit_mode) has no gravity but its bodies' pull and no air, whatever its settings say: an ordinary thing that
    moves there (a ball on the table, a block) floats off and falls toward the heaviest body. Said once for each such item, before the run
    (the layout's and the run's warnings: items.py WARNING_HOOKS), so neither the person nor the AI meets it only as a ball drifting off."""
    items = [i for i in scene.get("items", []) if isinstance(i, dict)]
    if not any(i.get("type") in SPACE_TYPES and i.get("type") in TYPES for i in items):
        return []
    by_id = {}
    for i in items:
        if isinstance(i.get("id"), str):
            by_id[i["id"]] = i
    h = heaviest(by_id)
    toward = None if h is None else (h[0].get("name") or BODIES[body_key(h[0], h[1])][0])
    out, seen = [], set()
    for sd in doc.get("solids", []):
        iid = sd.get("item")
        it = by_id.get(iid)
        if sd.get("kind") != "dynamic" or sd.get("ghost") is True or it is None or iid in seen or it.get("type") in SPACE_TYPES or it.get("type") not in TYPES:
            continue
        seen.add(iid)
        name = it.get("name") or TYPES[it["type"]].name
        fall = f"floats and drifts toward {toward}" if toward else "floats where it is let go"
        out.append({"items": [iid], "text": f"no gravity in a space scene: {name} {fall} (a sun, planet, moon or satellite puts the scene in space; "
                                            f"for a drop on a world, set the place's gravity without them)"})
    return out


# ---------------------------------------------------------------- goal kinds (web/sim/modules/space.js has the same, number for number)
PHASE_NAMES = ["new moon", "waxing crescent", "first quarter", "waxing gibbous", "full moon", "waning gibbous", "last quarter", "waning crescent"]
PHASE_ALIASES = {"new": "new moon", "full": "full moon", "third quarter": "last quarter", "last": "last quarter", "first": "first quarter",
                 "half": "first quarter", "quarter": "first quarter", "crescent": "waxing crescent", "gibbous": "waxing gibbous"}


PHASE_EDGES = (22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5)


def phase_name(elongation):
    """The phase for an elongation (degrees): eight 45-degree bins centred on new (0), first quarter (90), full (180), last quarter (270)
    (compared with the bins' edges, no division, so JavaScript bins every value the same)."""
    e = elongation % 360.0
    k = 0
    for edge in PHASE_EDGES:
        if e >= edge:
            k += 1
    return PHASE_NAMES[k % 8]


def _phase_of(text):
    t = " ".join(str(text).strip().lower().replace("-", " ").split())
    return t if t in PHASE_NAMES else PHASE_ALIASES.get(t)


def _record(ctx, iid):
    return next((r for r in ctx.doc.get("processes", []) if r.get("kind") == "space-body" and r.get("item") == iid), None)


def _primary_item(ctx, iid):
    r = _record(ctx, iid)
    p = (r or {}).get("primary")
    return p.split("/", 1)[0] if isinstance(p, str) else None


def _first_landing(ctx, iid, other=None):
    """When the item first strikes something (not `other`): the first impact of one of its solids with any other item's (s, or None)."""
    mine = {s["id"] for s in ctx.solids(iid)}
    item_of = {s["id"]: s["item"] for s in ctx.doc["solids"]}
    for h in ctx.track.get("impacts", []):
        a, b = h["a"], h["b"]
        if a in mine and b not in mine:
            o = item_of.get(b)
        elif b in mine and a not in mine:
            o = item_of.get(a)
        else:
            continue
        if other is not None and o == other:
            continue
        return h["t"]
    return None


def _nm(ctx, iid):
    """What a goal's label calls an item: its own name, else a space body's real name (Earth, the Moon), else its type's name."""
    it = ctx.items.get(iid) if isinstance(iid, str) else None
    if it is not None and not it.get("name") and it.get("type") == "gnomon":
        return "the shadow stick"
    if it is not None and not it.get("name") and it.get("type") in ("globe", "moon-ball"):
        return "the globe" if it.get("type") == "globe" else "the moon ball"
    if it is not None and not it.get("name") and it.get("type") in BODY_TYPES:
        P = props_of(it)
        b = BODIES.get(body_key(it, P))
        if b is not None:
            return b[0]
    return ctx.name(iid)


def _cap(t):
    """A made label starts with a capital ("The Moon circles Earth once")."""
    return t[:1].upper() + t[1:] if t[:1] == "t" and t.startswith("the ") else t


def _fmt_s(t):
    return f"{t:.2f}".rstrip("0").rstrip(".")


def goal_orbits(ctx, g):
    """{kind: "orbits", item, around?, turns?}: the item completes `turns` (default 1) turns round what it circles without falling in."""
    if not ctx.known(g.get("item")):
        return None
    iid = g["item"]
    want = ctx.num(g.get("turns"))
    want = 1.0 if want is None or want <= 0 else want
    around = g.get("around") if ctx.known(g.get("around")) else None
    prim = _primary_item(ctx, iid)
    turns = ctx.state(iid, "turns")
    fell = ctx.state(iid, "fell")
    done = max(turns) if turns else 0.0
    ok = bool(turns) and done >= want - 1e-9 and not (fell and max(fell) >= 1) and (around is None or prim is None or around == prim)
    who = _nm(ctx, around or prim) if (around or prim) else "what it circles"
    n = f"{want:g}"
    label = g.get("label") or _cap(f"{_nm(ctx, iid)} circles {who} {'once' if want == 1 else n + ' times'}")
    return {"label": label, "ok": ok, "kind": "orbits", "item": iid, "turns": round(done, 3)}


def goal_falls_in(ctx, g):
    """{kind: "falls_in", item, into?}: the item falls onto `into` (default: what it circles): it touches its primary (the `fell` reading), or one of
    its solids strikes `into`."""
    if not ctx.known(g.get("item")):
        return None
    iid = g["item"]
    prim = _primary_item(ctx, iid)
    into = g.get("into") if ctx.known(g.get("into")) else prim
    # (falling in on an orbit grazes the surface, too slowly for an impact: the engine's `fell` reading says when it touched its primary)
    t = ctx.first_time(iid, "fell", lambda v: v >= 1) if into is not None and into == prim else None
    if t is None and into is not None:
        mine = {s["id"] for s in ctx.solids(iid)}
        theirs = {s["id"] for s in ctx.solids(into)}
        for h in ctx.track.get("impacts", []):
            if (h["a"] in mine and h["b"] in theirs) or (h["b"] in mine and h["a"] in theirs):
                t = h["t"]
                break
    label = g.get("label") or _cap(f"{_nm(ctx, iid)} falls onto {_nm(ctx, into) if into else 'what it circles'}")
    return {"label": label, "ok": t is not None, "kind": "falls_in", "item": iid, "t": None if t is None else round(t, 3)}


def goal_escapes(ctx, g):
    """{kind: "escapes", item}: at the end of the run the item is leaving what it circled for good (faster than escape speed, moving away)."""
    if not ctx.known(g.get("item")):
        return None
    iid = g["item"]
    esc = ctx.state(iid, "escaped")
    ok = bool(esc) and esc[-1] >= 1
    label = g.get("label") or _cap(f"{_nm(ctx, iid)} escapes")
    return {"label": label, "ok": ok, "kind": "escapes", "item": iid}


def goal_lands_together(ctx, g):
    """{kind: "lands_together", a, b, tol_s?}: the two first strike something (not each other) within tol_s (default 0.02 s) of each other."""
    if not (ctx.known(g.get("a")) and ctx.known(g.get("b"))):
        return None
    a, b = g["a"], g["b"]
    tol = ctx.num(g.get("tol_s"))
    tol = 0.02 if tol is None or tol < 0 else tol
    ta, tb = _first_landing(ctx, a, b), _first_landing(ctx, b, a)
    ok = ta is not None and tb is not None and abs(ta - tb) <= tol + 1e-9
    label = g.get("label") or _cap(f"{_nm(ctx, a)} and {_nm(ctx, b)} land together")
    return {"label": label, "ok": ok, "kind": "lands_together", "a": a, "b": b, "item": a,
            "ta": None if ta is None else round(ta, 3), "tb": None if tb is None else round(tb, 3)}


def goal_lands_first(ctx, g):
    """{kind: "lands_first", a, b}: a first strikes something (not b) at least 0.02 s before b does (or b never lands)."""
    if not (ctx.known(g.get("a")) and ctx.known(g.get("b"))):
        return None
    a, b = g["a"], g["b"]
    ta, tb = _first_landing(ctx, a, b), _first_landing(ctx, b, a)
    ok = ta is not None and (tb is None or tb - ta >= 0.02)
    label = g.get("label") or _cap(f"{_nm(ctx, a)} lands before {_nm(ctx, b)}")
    return {"label": label, "ok": ok, "kind": "lands_first", "a": a, "b": b, "item": a,
            "ta": None if ta is None else round(ta, 3), "tb": None if tb is None else round(tb, 3)}


def goal_phase(ctx, g):
    """{kind: "phase", item, name, at_s?, any?}: the moon shows that phase (as its planet sees it) at the end, at at_s, or (any: true) at some moment."""
    if not ctx.known(g.get("item")):
        return None
    iid = g["item"]
    want = _phase_of(g.get("name", ""))
    el = ctx.state(iid, "elongation")
    if want is None or not el:
        seen = None
        ok = False
    else:
        at = ctx.num(g.get("at_s"))
        if g.get("any") is True:
            names = [phase_name(v) for v in el]
            ok = want in names
            seen = want if ok else phase_name(el[-1])
        else:
            k = len(el) - 1
            if at is not None:
                k = min(range(len(el)), key=lambda j: abs(ctx.times[j] - at)) if ctx.times else k
            seen = phase_name(el[k])
            ok = seen == want
    when = "" if ctx.num(g.get("at_s")) is None else f" at {_fmt_s(ctx.num(g.get('at_s')))} s"
    what = want or str(g.get("name") or "a phase")
    label = g.get("label") or _cap((f"{_nm(ctx, iid)} shows a {what} at some moment" if g.get("any") is True else f"{_nm(ctx, iid)} shows a {what}{when or ' at the end'}"))
    return {"label": label, "ok": ok, "kind": "phase", "item": iid, "seen": seen}


def goal_shadow_length(ctx, g):
    """{kind: "shadow_length", item: gnomon, m, tol?, at_s?}: its shadow is m metres long (within tol, default 2 cm) at the end or at at_s."""
    if not ctx.known(g.get("item")):
        return None
    iid = g["item"]
    want = ctx.num(g.get("m"))
    tol = ctx.num(g.get("tol"))
    tol = 0.02 if tol is None or tol < 0 else tol
    sh = ctx.state(iid, "shadow_m")
    seen = None
    if want is not None and sh:
        at = ctx.num(g.get("at_s"))
        k = len(sh) - 1
        if at is not None and ctx.times:
            k = min(range(len(sh)), key=lambda j: abs(ctx.times[j] - at))
        seen = sh[k]
    ok = seen is not None and abs(seen - want) <= tol + 1e-9
    at_s = ctx.num(g.get("at_s"))
    when = "" if at_s is None else f" at {_fmt_s(at_s)} s"
    label = g.get("label") or _cap(f"{_nm(ctx, iid)}'s shadow is {_fmt_s(want) if want is not None else '?'} m long{when or ' at the end'}")
    return {"label": label, "ok": ok, "kind": "shadow_length", "item": iid, "seen": None if seen is None else round(seen, 3)}


def _nearest(ctx, n, at):
    """The frame nearest to at_s (the last frame without one): the first of equals."""
    k = n - 1
    if at is not None and ctx.times:
        k = min(range(n), key=lambda j: abs(ctx.times[j] - at))
    return k


def goal_day_night(ctx, g):
    """{kind: "day_night", item: globe, is?: "day" | "night", at_s?, days?}: with `days` (n), the globe's town sees at least n sunrises and n
    sunsets in the run (n days and nights go by); else it is day (or night) there at at_s (default the end)."""
    if not ctx.known(g.get("item")):
        return None
    iid = g["item"]
    day = ctx.state(iid, "day") or []
    want = "night" if str(g.get("is") or "day").strip().lower() in ("night", "dark", "night time", "nighttime") else "day"
    n = ctx.num(g.get("days"))
    at = ctx.num(g.get("at_s"))
    rises = 0
    sets = 0
    for j in range(1, len(day)):
        if day[j] >= 0.5 and day[j - 1] < 0.5:
            rises += 1
        elif day[j] < 0.5 and day[j - 1] >= 0.5:
            sets += 1
    seen = None
    if n is not None and n > 0:
        ok = bool(day) and rises >= n - 1e-9 and sets >= n - 1e-9
        made = f"{_nm(ctx, iid)}'s town goes through {n:g} day{'' if n == 1 else 's'} and night{'' if n == 1 else 's'}"
    else:
        if day:
            seen = "day" if day[_nearest(ctx, len(day), at)] >= 0.5 else "night"
        ok = seen == want
        made = f"It is {want} at {_nm(ctx, iid)}'s town {'at the end' if at is None else f'at {_fmt_s(at)} s'}"
    label = g.get("label") or _cap(made)
    return {"label": label, "ok": ok, "kind": "day_night", "item": iid, "seen": seen, "sunrises": rises, "sunsets": sets}


ECLIPSE_WORDS = {"lunar": ("none", "penumbral", "partial", "total"), "solar": ("none", "partial", "annular", "total")}


def _eclipse(ctx, g, typ, kind):
    """An eclipse goal: a moon's (or moon ball's) solar_eclipse / lunar_eclipse reading reaches 1 (any), 2 (central: annular or total, solar),
    3 (total) at some moment (or at at_s); none: true wants it never to."""
    key = f"{typ}_eclipse"
    if g.get("item") is not None and not ctx.known(g.get("item")):
        return None
    if g.get("item") is not None:
        ids = [g["item"]]
    else:
        ids = [i["id"] for i in ctx.scene.get("items", []) if isinstance(i, dict) and i.get("type") in ("moon", "moon-ball") and isinstance(i.get("id"), str)]
    total = g.get("total") is True
    central = g.get("central") is True and typ == "solar"
    none = g.get("none") is True
    need = 3 if total else (2 if central else 1)
    at = ctx.num(g.get("at_s"))
    best = 0
    best_id = None
    when = None
    when_id = None
    for iid in ids:
        v = ctx.state(iid, key)
        if not v:
            continue
        x = v[_nearest(ctx, len(v), at)] if at is not None else max(v)
        if x > best:
            best, best_id = x, iid
        if at is None:
            t = ctx.first_time(iid, key, lambda y: y >= need)
            if t is not None and (when is None or t < when):
                when, when_id = t, iid
    ok = (best < need) if none else (best >= need)
    adj = "total " if total else ("central (total or annular) " if central else "")
    made = f"{'No' if none else 'A'} {adj}{typ} eclipse happens{'' if at is None else f' at {_fmt_s(at)} s'}"
    label = g.get("label") or made
    who = when_id if when_id is not None else (best_id if best_id is not None else (ids[0] if ids else None))
    return {"label": label, "ok": ok, "kind": kind, "item": who, "type": typ, "seen": ECLIPSE_WORDS[typ][int(best)], "t": None if when is None else round(when, 3)}


def goal_eclipse(ctx, g):
    """{kind: "eclipse", type: "solar" | "lunar", item?, total?, central?, none?, at_s?}: that eclipse happens (by a moon or moon ball: the
    item, or any of them)."""
    typ = str(g.get("type") or "").strip().lower()
    typ = "solar" if typ in ("solar", "sun") else ("lunar" if typ in ("lunar", "moon") else None)
    if typ is None:
        return None
    return _eclipse(ctx, g, typ, "eclipse")


def goal_solar_eclipse(ctx, g):
    """{kind: "solar_eclipse", item?, total?, central?, none?, at_s?}: as eclipse with type solar."""
    return _eclipse(ctx, g, "solar", "solar_eclipse")


def goal_lunar_eclipse(ctx, g):
    """{kind: "lunar_eclipse", item?, total?, none?, at_s?}: as eclipse with type lunar."""
    return _eclipse(ctx, g, "lunar", "lunar_eclipse")


def goal_noon_sun(ctx, g):
    """{kind: "noon_sun", item: globe | planet (with seasons), deg, tol?, at_s?}: the noon Sun's height at its town is deg (within tol, default 1)."""
    if not ctx.known(g.get("item")):
        return None
    iid = g["item"]
    want = ctx.num(g.get("deg"))
    tol = ctx.num(g.get("tol"))
    tol = 1.0 if tol is None or tol < 0 else tol
    v = ctx.state(iid, "noon_elevation")
    at = ctx.num(g.get("at_s"))
    seen = v[_nearest(ctx, len(v), at)] if (v and want is not None) else None
    ok = seen is not None and abs(seen - want) <= tol + 1e-9
    made = f"The noon Sun at {_nm(ctx, iid)}'s town is {_fmt_s(want) if want is not None else '?'}° up {'at the end' if at is None else f'at {_fmt_s(at)} s'}"
    label = g.get("label") or made
    return {"label": label, "ok": ok, "kind": "noon_sun", "item": iid, "seen": None if seen is None else round(seen, 2)}


# the constellations along the ecliptic: the ecliptic longitudes (J2000, degrees) where the Sun's path enters each, by the IAU's boundaries (Delporte
# 1930; within about 0.5 degrees), and Orion, south of Taurus and Gemini, highest at midnight when the midnight sky is at 70 to 100 degrees (December, January)
ZODIAC = (("pisces", 351.6, 29.1), ("aries", 29.1, 53.5), ("taurus", 53.5, 90.4), ("gemini", 90.4, 118.3), ("cancer", 118.3, 138.2), ("leo", 138.2, 174.2),
          ("virgo", 174.2, 218.0), ("libra", 218.0, 241.0), ("scorpius", 241.0, 247.7), ("ophiuchus", 247.7, 266.3), ("sagittarius", 266.3, 299.7),
          ("capricornus", 299.7, 327.7), ("aquarius", 327.7, 351.6), ("orion", 70.0, 100.0))
SKY_ALIASES = {"scorpio": "scorpius", "capricorn": "capricornus", "the hunter": "orion", "twins": "gemini", "lion": "leo", "bull": "taurus"}


def _in_arc(lon, a, b):
    return a <= lon < b if a < b else (lon >= a or lon < b)


def constellation_at(lon):
    """The ecliptic constellation at that longitude (the zodiac's 13, Ophiuchus among them)."""
    for name, a, b in ZODIAC[:-1]:
        if _in_arc(lon, a, b):
            return name
    return None


def goal_night_sky(ctx, g):
    """{kind: "night_sky", item: a planet with seasons, constellation, at_s?, any?}: that constellation stands highest at midnight (the midnight sky's
    ecliptic longitude in its stretch of the ecliptic; Orion: 70-100 degrees) at the end, at at_s, or (any: true) at some moment."""
    if not ctx.known(g.get("item")):
        return None
    iid = g["item"]
    name = " ".join(str(g.get("constellation") or "").strip().lower().split())
    name = SKY_ALIASES.get(name, name)
    arc = next(((a, b) for n, a, b in ZODIAC if n == name), None)
    v = ctx.state(iid, "night_lon") or []
    at = ctx.num(g.get("at_s"))
    seen = None
    if arc is not None and v:
        if g.get("any") is True:
            ok = any(_in_arc(x, arc[0], arc[1]) for x in v)
        else:
            x = v[_nearest(ctx, len(v), at)]
            seen = constellation_at(x)
            ok = _in_arc(x, arc[0], arc[1])
    else:
        ok = False
    what = name[:1].upper() + name[1:] if name else "a constellation"
    when = " at some moment" if g.get("any") is True else (" at the end" if at is None else f" at {_fmt_s(at)} s")
    made = f"{what} is high in {_nm(ctx, iid)}'s midnight sky{when}"
    return {"label": g.get("label") or _cap(made), "ok": ok, "kind": "night_sky", "item": iid, "seen": seen}


GOALS = [("shadow_length", goal_shadow_length), ("orbits", goal_orbits), ("falls_in", goal_falls_in), ("escapes", goal_escapes), ("lands_together", goal_lands_together),
         ("lands_first", goal_lands_first), ("phase", goal_phase), ("day_night", goal_day_night), ("eclipse", goal_eclipse), ("solar_eclipse", goal_solar_eclipse),
         ("lunar_eclipse", goal_lunar_eclipse), ("noon_sun", goal_noon_sun), ("night_sky", goal_night_sky)]
