"""Tests of the space module's catalog (machines/mod_space.py): python3 machines/test_space.py
Every type builds at its defaults and at its props' ends; the orbit mode's settings; the bodies' real data and the scales' periods (Kepler's
third law with mu = G*M at the scale); the goal kinds on hand-made tracks. (The engine's side, the JS port and the AI: tools/space/test.mjs and
research/rw-validate-space.ts.)"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("PLAYGROUND_MODULES", "space")
import items  # noqa: E402
import mod_space as S  # noqa: E402

FAILS = []
N = [0]


def check(cond, what):
    N[0] += 1
    if not cond:
        FAILS.append(what)
        print("FAIL", what)


STAGE = {"x0": -0.6, "x1": 3.4, "y0": -0.2, "y1": 3.0}


def scene(items_, **kw):
    return {"version": 2, "id": "t", "stage": STAGE, "seconds": 4, "release": 0.5, "items": [{"id": "table", "type": "table", "x": 1.3, "y": 0}] + items_, **kw}


# every type at its defaults and at its props' ends
for key in ("sun", "planet", "moon", "satellite", "rock-hammer", "gnomon", "globe", "moon-ball"):
    t = items.TYPES[key]
    check(t.module == "space", f"{key} says module space")
    doc, res = items.build(scene([{"id": "a", "type": key, "x": 1.3, "y": 1.2, "props": {}}]))
    check(any(s["item"] == "a" for s in doc["solids"]), f"{key} builds solids at its defaults")
    for p in t.props:
        if p.kind in ("number", "int"):
            for v in (p.lo, p.hi):
                d2, _ = items.build(scene([{"id": "a", "type": key, "x": 1.3, "y": 1.2, "props": {p.key: v}}]))
                check(any(s["item"] == "a" for s in d2["solids"]), f"{key}.{p.key} = {v} builds")
        elif p.kind == "choice":
            for v in p.choices:
                d2, _ = items.build(scene([{"id": "a", "type": key, "x": 1.3, "y": 1.2, "props": {p.key: v}}]))
                check(any(s["item"] == "a" for s in d2["solids"]), f"{key}.{p.key} = {v} builds")

# orbit mode: a space body turns gravity and air off; a scene without one keeps its settings (and the standard ones say nothing)
doc, _ = items.build(scene([{"id": "e", "type": "planet", "x": 1, "y": 1.2}], settings={"gravity": "moon"}))
check(doc.get("settings") == {"gravity": 0.0, "air": False}, "orbit mode: no gravity, no air")
doc, _ = items.build(scene([{"id": "h", "type": "rock-hammer", "x": 1, "y": 1.2}], settings={"gravity": "moon", "air": False}))
check(doc.get("settings") == {"gravity": 1.62, "air": False}, "the Moon's settings without space bodies")
doc, _ = items.build(scene([{"id": "h", "type": "rock-hammer", "x": 1, "y": 1.2}]))
check("settings" not in doc, "no settings: the document says none")

# the bodies' data: masses, radii, the drawn size never under the visible one
for k, b in S.BODIES.items():
    check(b[2] > 0 and b[3] > 0 and b[4] > 0, f"{k}: mass, radius and visible size")
# Kepler at each scale: the real orbit (a, period) of the scale's showcase body comes out at its real period, in scene seconds
for scale, body in (("earth-moon", "moon"), ("inner-planets", "earth"), ("inner-planets", "mercury"), ("jupiter-moons", "io"), ("mars-moons", "phobos")):
    k, s, _ = S.SCALES[scale]
    prim = S.BODIES[S.BODIES[body][6]]
    mu = S._mu(prim[2] + S.BODIES[body][2], k, s)
    r = S.BODIES[body][7] / k
    T = 2 * math.pi * math.sqrt(r ** 3 / mu) * s / 86400
    check(abs(T / S.BODIES[body][8] - 1) < 0.01, f"{body} at the {scale} scale: Kepler {T:.3f} d vs NASA {S.BODIES[body][8]} d")

# the heaviest body sets the scale; a Sun that only shines does not
doc, _ = items.build(scene([{"id": "s", "type": "sun", "x": 0, "y": 1.2, "props": {"pulls": False}}, {"id": "e", "type": "planet", "x": 1.5, "y": 1.2},
                            {"id": "m", "type": "moon", "x": 2.78, "y": 1.2, "props": {"primary": "e"}}]))
recs = {r["item"]: r for r in doc["processes"]}
check(recs["m"]["scale"] == "earth-moon" and recs["s"]["mu"] == 0.0 and recs["s"].get("far") is True, "a far Sun: no pull, the Earth's scale")
check(recs["m"]["primary"] == "e/body" and recs["m"].get("phase") is True, "the Moon circles its linked planet and reads its phase")
sun_solid = next(x for x in doc["solids"] if x["id"] == "s/body")
check(sun_solid["kind"] == "static" and sun_solid.get("stand") == "none", "a far Sun is held still, with no stand drawn")

# goal kinds on hand-made tracks
items_ = [{"id": "m", "type": "moon", "x": 1, "y": 1}, {"id": "e", "type": "planet", "x": 0, "y": 1}, {"id": "g", "type": "gnomon", "x": 2, "y": 0}]
doc = {"solids": [{"id": "m/body", "item": "m", "kind": "dynamic"}, {"id": "e/body", "item": "e", "kind": "dynamic"}, {"id": "g/stick", "item": "g", "kind": "static"},
                   {"id": "table/top", "item": "table", "kind": "static"}],
       "processes": [{"kind": "space-body", "item": "m", "primary": "e/body"}, {"kind": "space-body", "item": "e", "primary": None}]}
track = {"frames": [{"t": 0.0}, {"t": 1.0}, {"t": 2.0}],
         "state": {"m": {"turns": [0.0, 0.6, 1.2], "fell": [0, 0, 0], "escaped": [0, 0, 1], "elongation": [0.0, 90.0, 181.0]},
                   "g": {"shadow_m": [1.3, 0.58, 1.3]}},
         "impacts": [{"t": 1.5, "a": "m/body", "b": "table/top", "speed": 1}, {"t": 1.51, "a": "g/stick", "b": "table/top", "speed": 1}]}
ctx = items.GoalCtx({"items": items_}, doc, track, {i["id"]: i for i in items_}, lambda i: i)
check(S.goal_orbits(ctx, {"item": "m"})["ok"] is True, "orbits: 1.2 turns is at least one")
check(S.goal_orbits(ctx, {"item": "m", "turns": 2})["ok"] is False, "orbits: not two")
check(S.goal_escapes(ctx, {"item": "m"})["ok"] is True, "escapes at the end")
check(S.goal_phase(ctx, {"item": "m", "name": "full"})["ok"] is True, "phase: full at the end (an alias)")
check(S.goal_phase(ctx, {"item": "m", "name": "first quarter", "at_s": 1})["ok"] is True, "phase: first quarter at 1 s")
check(S.goal_phase(ctx, {"item": "m", "name": "waxing gibbous", "any": True})["ok"] is False, "phase: never waxing gibbous in these frames")
check(S.goal_shadow_length(ctx, {"item": "g", "m": 0.58, "at_s": 1})["ok"] is True, "shadow_length at 1 s")
check(S.goal_lands_together(ctx, {"a": "m", "b": "g"})["ok"] is True, "lands_together within 0.02 s")
check(S.goal_lands_first(ctx, {"a": "m", "b": "g"})["ok"] is False, "lands_first needs 0.02 s")
check([S.phase_name(x) for x in (0, 45, 90, 135, 180, 225, 270, 315, 359.9)] == S.PHASE_NAMES + ["new moon"], "the eight phase bins")

# (2026-10-20) the classroom models: the light the build hook finds, the records, the view's props; the Moon's tilt; the seasons
LAMPS = "lamp" in items.TYPES
if LAMPS:
    doc, res = items.build(scene([{"id": "lamp", "type": "lamp", "x": 0.25, "y": 0, "props": {"aim": 0, "head_height": 0.4}},
                                  {"id": "g", "type": "globe", "x": 1.3, "y": 0},
                                  {"id": "b", "type": "moon-ball", "x": 1.3, "y": 0.4, "props": {"around": "g"}}]))
    rg = next(r for r in doc["processes"] if r["kind"] == "globe")
    rb = next(r for r in doc["processes"] if r["kind"] == "moon-ball")
    check(rg["light"] == {"kind": "point", "solid": "lamp/base", "x": 0.15, "y": 0.3875, "frame": "world", "radius": 0.03, "from": 0.0}, f"the globe is lit by the lamp's bulb: {rg['light']}")
    check(rb["light"] == rg["light"] and rb["around"] == "g/ball", "the moon ball goes round the globe's ball, lit by the same lamp")
    check("lit_by" not in rg and "_P" not in rg and "_P" not in rb, "the build hook's helpers are gone from the records")
    check(res["g"]["light"] == {"x": 0.4, "y": 0.4} and res["b"]["centre"] == {"x": 1.3, "y": 0.4}, f"the view's props: the light at the start and the circle's centre {res['g'].get('light')} {res['b'].get('centre')}")
    ball = next(x for x in doc["solids"] if x["id"] == "b/ball")
    check(ball.get("ghost") is True and ball["kind"] == "static", "the moon ball's solid is a ghost (carried, it touches nothing)")
    gb = next(x for x in doc["solids"] if x["id"] == "g/ball")
    check(abs(gb["at"]["y"] - 0.4) < 1e-12 and gb["body"]["radius"] == 0.15, "the globe's ball: 30 cm, its middle 40 cm up")
    # the link wins over the first light; none at all: no light
    doc, _ = items.build(scene([{"id": "lamp", "type": "lamp", "x": 0.25, "y": 0}, {"id": "lamp2", "type": "lamp", "x": 2.5, "y": 0, "props": {"aim": 180}},
                                {"id": "g", "type": "globe", "x": 1.3, "y": 0, "props": {"lit_by": "lamp2"}}]))
    check(next(r for r in doc["processes"] if r["kind"] == "globe")["light"]["solid"] == "lamp2/base", "lit_by names the light")
doc, res = items.build(scene([{"id": "g", "type": "globe", "x": 1.3, "y": 0}]))
check(next(r for r in doc["processes"] if r["kind"] == "globe")["light"] is None and res["g"]["light"] is None, "a globe with no light in the scene: none")
if "sunlight" in items.TYPES:
    doc, res = items.build(scene([{"id": "sun", "type": "sunlight", "x": -0.3, "y": 0.4, "props": {"elevation": 30}}, {"id": "g", "type": "globe", "x": 1.3, "y": 0}]))
    L = next(r for r in doc["processes"] if r["kind"] == "globe")["light"]
    check(L["kind"] == "parallel" and abs(L["dir"] + 30 * math.pi / 180) < 1e-6, f"sunlight: parallel, its direction {L}")
    check(abs(res["g"]["light"]["dx"] + math.cos(math.pi / 6)) < 1e-6 and abs(res["g"]["light"]["dy"] - 0.5) < 1e-6, "the view's sunlight: toward it, up 30°")
# the Moon's orbit: tilted 5.145° by default (by body), its nodes, its planet's distance from the Sun; the view's lift factor
doc, res = items.build(scene([{"id": "e", "type": "planet", "x": 1.0, "y": 1.2}, {"id": "m", "type": "moon", "x": 2.28, "y": 1.2, "props": {"primary": "e"}},
                              {"id": "io", "type": "moon", "x": 1.5, "y": 1.2, "props": {"body": "io", "node_deg": 0}}]))
rm = {r["item"]: r for r in doc["processes"]}
check(rm["m"]["tilt"] == 5.145 and rm["m"]["node"] == 90.0 and rm["m"]["sun_km"] == 149598000.0, f"the Moon's record: tilt, node, its planet's distance {rm['m']}")
check(rm["io"]["tilt"] == 3.13 and rm["io"]["node"] == 0, "Io: Jupiter's axial tilt (its orbit lies in Jupiter's equator)")
check(abs(res["m"]["lift_per_km"] - 0.055 / 6371.0) < 1e-9 and res["m"]["orbit_tilt"] == 5.145, "the view lifts the Moon by the factor the Earth is drawn larger")
doc, res = items.build(scene([{"id": "m", "type": "moon", "x": 2.28, "y": 1.2, "props": {"orbit_tilt": 0}}]))
check(next(r for r in doc["processes"] if r["item"] == "m")["tilt"] == 0, "orbit_tilt set: kept (0: in the plane)")
# a planet's seasons: only when on
doc, res = items.build(scene([{"id": "s", "type": "sun", "x": 1.0, "y": 1.2}, {"id": "e", "type": "planet", "x": 2.0, "y": 1.2}]))
check("seasons" not in next(r for r in doc["processes"] if r["item"] == "e") and "season_axis" not in res["e"], "no seasons unless asked")
doc, res = items.build(scene([{"id": "s", "type": "sun", "x": 1.0, "y": 1.2}, {"id": "e", "type": "planet", "x": 2.0, "y": 1.2, "props": {"seasons": True, "start_date": "june solstice"}}]))
re_ = next(r for r in doc["processes"] if r["item"] == "e")
check(re_["seasons"] == {"tilt": 23.44, "date": "june solstice", "lat": 30.27}, f"seasons on: its record {re_.get('seasons')}")
ax = res["e"]["season_axis"]
check(abs(ax[0] + math.sin(23.44 * math.pi / 180)) < 1e-6 and abs(ax[1]) < 1e-9 and abs(ax[2] - math.cos(23.44 * math.pi / 180)) < 1e-6, f"June: the pole leans toward the Sun (the view's axis {ax})")
doc, res = items.build(scene([{"id": "s", "type": "sun", "x": 1.0, "y": 1.2}, {"id": "e", "type": "planet", "x": 2.0, "y": 1.2, "props": {"body": "uranus", "seasons": True}}]))
check(next(r for r in doc["processes"] if r["item"] == "e")["seasons"]["tilt"] == 97.77, "Uranus' axis tilt by body: 97.77°")

# the new goal kinds on hand-made tracks
items_ = [{"id": "g", "type": "globe", "x": 1, "y": 0}, {"id": "b", "type": "moon-ball", "x": 1, "y": 0.4}, {"id": "m", "type": "moon", "x": 2, "y": 1}]
doc = {"solids": [{"id": "g/ball", "item": "g", "kind": "static"}, {"id": "b/ball", "item": "b", "kind": "static"}, {"id": "m/body", "item": "m", "kind": "dynamic"}], "processes": []}
track = {"frames": [{"t": 0.0}, {"t": 1.0}, {"t": 2.0}, {"t": 3.0}, {"t": 4.0}],
         "state": {"g": {"day": [0, 1, 1, 0, 1], "noon_elevation": [59.73, 59.73, 83.17, 83.17, 83.17]},
                   "b": {"lunar_eclipse": [0, 1, 3, 1, 0], "solar_eclipse": [0, 0, 0, 0, 0]},
                   "m": {"lunar_eclipse": [0, 0, 0, 0, 0], "solar_eclipse": [0, 0, 2, 0, 0]}}}
ctx = items.GoalCtx({"items": items_}, doc, track, {i["id"]: i for i in items_}, lambda i: i)
check(S.goal_day_night(ctx, {"item": "g", "days": 1})["ok"] is True, "day_night: one sunrise and one sunset is a day")
check(S.goal_day_night(ctx, {"item": "g", "days": 2})["ok"] is False, "day_night: not two")
check(S.goal_day_night(ctx, {"item": "g", "is": "night", "at_s": 3})["ok"] is True and S.goal_day_night(ctx, {"item": "g", "at_s": 3})["ok"] is False, "day_night: night at 3 s")
check(S.goal_day_night(ctx, {"item": "g"})["ok"] is True and S.goal_day_night(ctx, {"item": "g"})["label"] == "It is day at the globe's town at the end", "day_night: day at the end, and its label")
check(S.goal_eclipse(ctx, {"type": "lunar", "total": True})["ok"] is True and S.goal_eclipse(ctx, {"type": "lunar", "total": True})["item"] == "b", "eclipse: a total lunar one (by the ball)")
check(S.goal_eclipse(ctx, {"type": "solar"})["ok"] is True and S.goal_eclipse(ctx, {"type": "solar", "total": True})["ok"] is False, "eclipse: a solar one, not total")
check(S.goal_eclipse(ctx, {"type": "solar", "central": True})["ok"] is True and S.goal_eclipse(ctx, {"type": "solar", "central": True})["seen"] == "annular", "eclipse: central = annular or total")
check(S.goal_eclipse(ctx, {"type": "lunar", "none": True})["ok"] is False and S.goal_eclipse(ctx, {"type": "solar", "none": True, "item": "b"})["ok"] is True, "eclipse: none")
check(S.goal_eclipse(ctx, {"type": "lunar", "at_s": 2})["t"] is None and S.goal_eclipse(ctx, {"type": "lunar", "at_s": 0})["ok"] is False, "eclipse: at at_s")
check(S.goal_eclipse(ctx, {"type": "bogus"}) is None, "eclipse: an unknown type leaves the goal out")
check(S.goal_lunar_eclipse(ctx, {"total": True})["ok"] is True and S.goal_solar_eclipse(ctx, {"item": "m"})["ok"] is True, "solar_eclipse / lunar_eclipse kinds")
check(S.goal_noon_sun(ctx, {"item": "g", "deg": 83.17})["ok"] is True and S.goal_noon_sun(ctx, {"item": "g", "deg": 83.17, "at_s": 0})["ok"] is False, "noon_sun at the end and at at_s")
check(S.goal_noon_sun(ctx, {"item": "g", "deg": 60, "at_s": 0, "tol": 0.5})["ok"] is True, "noon_sun within tol")
track["state"]["m"]["night_lon"] = [180.0, 270.0, 0.0, 90.0, 85.0]
ctx = items.GoalCtx({"items": items_}, doc, track, {i["id"]: i for i in items_}, lambda i: i)
check(S.goal_night_sky(ctx, {"item": "m", "constellation": "Orion"})["ok"] is True and S.goal_night_sky(ctx, {"item": "m", "constellation": "gemini"})["ok"] is False, "night_sky: Orion at 85°, not Gemini")
check(S.goal_night_sky(ctx, {"item": "m", "constellation": "Sagittarius", "at_s": 1})["ok"] is True and S.goal_night_sky(ctx, {"item": "m", "constellation": "scorpio", "any": True})["ok"] is False, "night_sky at at_s, any, an alias")
check(S.goal_night_sky(ctx, {"item": "m", "constellation": "pisces", "at_s": 2})["ok"] is True and S.goal_night_sky(ctx, {"item": "m", "constellation": "bogus"})["ok"] is False, "night_sky: Pisces across 0°, a name it does not know")
check([S.constellation_at(x) for x in (0, 45, 90, 180, 245, 260, 270, 340)] == ["pisces", "aries", "taurus", "virgo", "scorpius", "ophiuchus", "sagittarius", "aquarius"], "the ecliptic's constellations")

print(f"{N[0] - len(FAILS)} of {N[0]} checks pass")
sys.exit(1 if FAILS else 0)
