"""The measure module: instruments that read the run and the things they measure against.

Instruments (each reads the run in the engine, tooling/src/sim/modules/measure.ts, and draws its reading on its own face every frame):
stopwatch, measuring-tape, speed-gate, speedometer (a radar speed sign), spring-scale (Newton meter), kitchen-scale, pan-balance,
protractor, motion-sensor. What they measure against: lane (a long floor with metre marks and start/finish lines), start-line,
finish-line, metre-stick, gram-mass (slotted brass masses), plumb-line. What draws the run: motion-trail (a path or strobe ghosts behind a
moving item), graph-board (distance-, speed- or reading-time graphs), data-table (a board of readings).

An instrument's face, a painted line or a tape is a `ghost` solid (tooling/src/sim/part.ts): drawn and picked like any solid, it touches
nothing, so measuring never changes what is measured. The physical instruments (a spring scale's hook and spring, a kitchen scale's platform,
a pan balance's beam and pans, a metre stick, the gram masses) are real solids.

web/sim/modules/measure.js is the exact JavaScript port (the same documents, number for number) and holds the AI plug-ins.

Sources (cited where used): [VERNIER] Vernier Photogate user manual (0.1 ms resolution; v = flag length / blocked time); [OHAUS] Ohaus /
PASCO spring scales (0-2.5 / 5 / 10 / 20 / 50 N, about 10 cm of scale travel); [NIST-HB44] NIST Handbook 44 (kitchen scales: d = 1 g up to
5 kg); [OIML-R111] OIML R111-1 (2004) weights: brass and stainless steel 7950-8400 kg/m³, cylindrical form, height about 1.25 x diameter;
[HUMAN-RT] simple reaction time 0.2-0.25 s (Kosinski, "A literature review on reaction time", Clemson University 2008); [ASPHALT] asphalt
concrete 2300-2400 kg/m³ (Engineering ToolBox, "Asphalt"), rubber on asphalt friction 0.5-0.8 dry (Engineering ToolBox, "Friction
coefficients"); a stopwatch reads to 0.01 s; a kitchen tape measure is 25 mm wide; a metre stick is 1 m x 28 mm x 6 mm maple (about 0.12 kg).
"""
import math

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "register_goal_kind", "register_build_hook", "register_warning_hook", "MATERIALS", "add_look",
          "CATEGORIES", "props_of", "TYPES", "D2R", "cos", "sin")

CAT = "Measuring"
MODULE = "measure"
G = 9.81
WATCHABLE = ()          # (a watch link may name any item)
LINES = ("start-line", "finish-line", "lane")
MARKS = {"10 cm": 0.1, "50 cm": 0.5, "1 m": 1.0, "2 m": 2.0, "5 m": 5.0}
SURFACES = {"gym floor": "varnished hardwood", "vinyl": "vinyl rubber", "concrete": "concrete", "carpet": "carpet", "asphalt": "asphalt"}
PAINTS = ["pale gray", "pale blue", "pale green", "pale yellow", "white", "tan"]
COLORS = ["red", "blue", "green", "orange", "purple", "yellow", "black", "white"]
# Slotted brass masses [OIML-R111]: nominal grams -> (diameter, height of the body) in metres, brass 8400 kg/m³ at height = 1.25 x diameter (the
# knob on top is drawn only); the density is the nominal mass over the body's volume, so each weighs exactly its nominal mass.
GRAM_SIZES = {"1 g": (0.0055, 0.0069), "2 g": (0.0069, 0.0087), "5 g": (0.0094, 0.0118), "10 g": (0.0119, 0.0149), "20 g": (0.0150, 0.0187),
              "50 g": (0.0203, 0.0254), "100 g": (0.0256, 0.0320), "200 g": (0.0323, 0.0403), "500 g": (0.0438, 0.0547), "1 kg": (0.0551, 0.0689)}
SCALE_RANGES = ["2.5 N", "5 N", "10 N", "20 N", "50 N"]
# The pan balance's gravity bob: a brass weight on its pointer, 9 cm under the pivot (above the pointer's scale plate), so the beam has a centre of mass below its pivot and a
# restoring torque (with the pointer's) of about 0.053 N·m per radian: it settles level with equal loads, tips 1.5° per gram of difference
# (its 15° stop at 10 g), swings with a period of 1.7 s empty and 2.4 s with 100 g in each pan (a school equal-arm balance: sensitivity about
# 1 g, a period of a few seconds), whatever the gravity (both torques scale with g).
BOB_KG, BOB_Y = 0.0466, -0.09


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CAT not in CATEGORIES:
        CATEGORIES.append(CAT)
    if "asphalt" not in MATERIALS:
        MATERIALS["asphalt"] = dict(density=2360, bounce=0.6, friction=0.7, rolling=0.008, side=0.0, look="concrete",
                                    source="Asphalt concrete 2300-2400 kg/m³ and rubber on dry asphalt 0.5-0.8 [ASPHALT]; rolling resistance provisional.")
    if "brass" not in MATERIALS:
        MATERIALS["brass"] = dict(density=8400, bounce=0.8, friction=0.35, rolling=0.001, side=0.0, look="polished brass",
                                  source="Brass 8400-8730 kg/m³; OIML R111 weights 8400 kg/m³ [OIML-R111].")
    for key, kw in (("lane paint", dict(fill="#d9dcdf", shade="#a9adb2", roughness=0.6, metalness=0.0, clearcoat=0.3)),
                    ("polished brass", dict(fill="#c9a24a", shade="#94742c", roughness=0.25, metalness=1.0, clearcoat=0.0)),
                    ("instrument face", dict(fill="#2a2d33", shade="#15171a", roughness=0.4, metalness=0.0, clearcoat=0.5)),
                    ("tape steel", dict(fill="#f2c418", shade="#b8920c", roughness=0.35, metalness=0.2, clearcoat=0.3)),
                    ("clear acrylic", dict(fill="#e8f1f6", shade="#b4c3cc", roughness=0.05, metalness=0.0, clearcoat=1.0, transmission=0.9))):
        add_look(key, **kw)
    _lines()
    _stopwatch()
    _tape()
    _gate()
    _speedometer()
    _spring_scale()
    _kitchen_scale()
    _balance()
    _gram_mass()
    _protractor()
    _plumb()
    _metre_stick()
    _sensor()
    _trail()
    _boards()
    register_build_hook(hang_hooks)
    register_warning_hook(link_warnings)
    for kind, fn in (("reads", goal_reads), ("crosses", goal_crosses), ("faster", goal_faster), ("farther", goal_farther), ("stops_between", goal_stops_between)):
        register_goal_kind(kind, fn)


def _r5(v):
    return round(v, 5)


def _given(c):
    return c.item.get("props") or {}


def _ghost(c, part, w, h, depth, lx=0.0, ly=0.0, look="instrument face", words=None, **extra):
    """A display-only slab: static, colliding with nothing (the engine's `ghost`). `stand: "self"`: its model and the module's view plugin draw what
    holds it (a pole, a stand, the floor it is painted on), so the AI's solver adds no wooden stand under it and the view no mount."""
    return c.slab(part, w, h, depth, lx, ly, kind="static", material=c.mat(base="hollow plastic", overrides={}), look=look, words=words, ghost=True, stand="self", **extra)


def _line_x(c, key, fallback):
    """The x where a stopwatch's start or stop line is: a linked start-line / finish-line item's x, a linked lane's start or finish mark
    (start_at / finish_at metres from its 0 m mark), else the stopwatch's own start_x / stop_x."""
    lid = c.link(key)
    if lid is None:
        return round(float(fallback), 5), None
    it = c.sb.scene_items[lid]
    if it["type"] == "lane":
        P = props_of(it)
        given = it.get("props") or {}
        at = given.get("finish_at", P["length"]) if key == "finish_line" else P["start_at"]
        return round(it["x"] + min(at, P["length"]), 5), lid
    return round(it["x"], 5), lid


# ---------------------------------------------------------------- lane, start and finish lines
def build_lane(c, P):
    L, m, w = P["length"], P["margin"], P["width"]
    given = _given(c)
    if "finish_at" not in given:
        P["finish_at"] = L
    P["finish_at"] = min(P["finish_at"], L)
    P["start_at"] = min(P["start_at"], P["finish_at"])
    P["raised"] = round(max(0.0, c.item.get("y", 0.0) - 0.02), 5)      # (its underside's height over the table top: the model draws brackets under a raised lane)
    mat = c.mat(base=SURFACES[P["surface"]], overrides={})
    c.slab("floor", L + 2 * m, 0.02, w, L / 2, -0.01, kind="static", material=mat, look="lane paint", words="a long lane floor with metre marks", stand="self")
    if P["end_stop"] and m >= 0.1:
        # a foam bumper on the floor's far end: what races past the finish stops there instead of running off a raised lane
        c.slab("stop", 0.08, 0.1, w, L + m - 0.04, 0.05, kind="static", material=c.mat(base="foam", overrides={}), look="foam",
               words="a foam bumper at the lane's end", stand="self")
    x0 = c.item.get("x", 0.0)
    c.process("measure-mark", "marks", zero=_r5(x0), start=_r5(x0 + P["start_at"]), finish=_r5(x0 + P["finish_at"]))


def build_start_line(c, P):
    _ghost(c, "line", 0.05, 0.002, P["depth"], 0.0, -0.001, look="lane paint", words="a painted start line")
    c.process("measure-mark", "mark", x=_r5(c.item.get("x", 0.0)))


def build_finish_line(c, P):
    _ghost(c, "line", 0.05, 0.002, P["depth"], 0.0, -0.001, look="lane paint", words="a painted finish line")
    c.process("measure-mark", "mark", x=_r5(c.item.get("x", 0.0)))


def _lines():
    register(ItemType("lane", "Lane (with metre marks)", CAT, build_lane, dynamic=False, module=MODULE,
                      props=[Prop("length", "Length", 10.0, 1.0, 60.0, 0.5, "m", "From its 0 m mark to its end mark"),
                             Prop("marks_every", "Marks every", "1 m", kind="choice", choices=list(MARKS)),
                             Prop("labels", "Numbers", True, kind="bool", help="Numbers beside the marks"),
                             Prop("label_cm", "Number height", 20.0, 5.0, 50.0, 1.0, "cm", "Big numbers read in a wide 12 m shot"),
                             Prop("start_at", "Start line at", 0.0, 0.0, 60.0, 0.1, "m"),
                             Prop("finish_at", "Finish line at", 10.0, 0.0, 60.0, 0.1, "m", "Follows the length until you set it", auto=("length",)),
                             Prop("width", "Width (front to back)", 0.6, 0.3, 1.5, 0.05, "m"),
                             Prop("surface", "Surface", "gym floor", kind="choice", choices=list(SURFACES)),
                             Prop("color", "Colour", "pale gray", kind="choice", choices=PAINTS),
                             Prop("margin", "Floor past each end", 1.0, 0.0, 5.0, 0.1, "m", "Floor before its 0 m mark and after its end, to start and stop on"),
                             Prop("end_stop", "Bumper at the far end", True, kind="bool", help="A foam block on the floor's far end stops what runs past the finish (with 10 cm of floor or more past the end)")],
                      tags=["track", "race", "runway", "floor", "metre", "meter", "marks", "distance", "lanes", "ruler", "hallway", "10 m"],
                      anchor="its 0 m mark, on its top surface",
                      description="A long floor with a mark every metre (or as set), big numbers, a start line and a finish line. Things race along it; "
                                  "stopwatches link to it to stop at its finish. Two lanes one above the other compare two racers. A foam bumper on its "
                                  "far end stops what runs past the finish.",
                      source="A static floor slab 2 cm thick of the chosen surface (gym floor = varnished hardwood, vinyl, concrete, carpet, asphalt "
                             "[ASPHALT]); its marks and numbers are paint (drawn only).",
                      facts="10 m · marks every metre · start and finish lines", edit=[{"kind": "length", "prop": "length"}]))
    for key, name, build, words in (("start-line", "Start line", build_start_line, "start"), ("finish-line", "Finish line", build_finish_line, "finish")):
        register(ItemType(key, name, CAT, build, dynamic=False, module=MODULE,
                          props=[Prop("depth", "Length across", 0.6, 0.1, 2.0, 0.05, "m", "Across the floor, front to back"),
                                 Prop("gate", "Light gate posts", False, kind="bool", help="Two posts at the line (only drawn: the timing is the same)"),
                                 Prop("sign", f"{words.upper()} sign", True, kind="bool")],
                          tags=["line", "race", words, "tape", "mark", "timing", "lane", "checkered" if words == "finish" else "go"],
                          anchor="the middle of the line, on the floor",
                          description=f"A painted {words} line across the floor. A stopwatch linked to it {'stops' if words == 'finish' else 'starts'} "
                                      f"when the watched thing's front reaches it.",
                          source="Paint (drawn only: it touches nothing).", facts=f"{words} line · 5 cm wide"))


# ---------------------------------------------------------------- stopwatch
def build_stopwatch(c, P):
    face = P["face_cm"] / 100
    if P["on_table"]:
        # a real stopwatch standing on its edge: 6 x 8 x 1.5 cm, 60 g (ABS), its face to the camera
        c.slab("body", 0.06, 0.08, 0.015, 0.0, 0.0, material=c.mat(base="ABS plastic", density=round(0.06 / (0.06 * 0.08 * 0.015), 3), overrides={}),
               look="instrument face", words="a digital stopwatch")
    else:
        _ghost(c, "face", face, face * 0.9, max(0.01, face * 0.25), words="a big stopwatch face")
    watch = c.link("watch")
    start_x, start_line = _line_x(c, "start_line", P["start_x"])
    stop_x, finish_line = _line_x(c, "finish_line", P["stop_x"])
    c.process("measure-stopwatch", "watch", watch=watch, start=P["start"], stop=P["stop"],
              start_x=start_x if P["start"] == "crosses" else None, stop_x=stop_x if P["stop"] == "crosses" else None,
              stop_at=_r5(P["stop_at"]), reaction=_r5(P["reaction_s"]), lesson=P["counts"] == "lesson")


def _stopwatch():
    register(ItemType("stopwatch", "Stopwatch", CAT, build_stopwatch, dynamic=False, module=MODULE,
                      props=[Prop("start", "Starts", "release", kind="choice", choices=["release", "moves", "crosses"],
                                  help="release: at the scene's release; moves: when the watched thing has moved 1 mm; crosses: when its front reaches the start line"),
                             Prop("stop", "Stops", "crosses", kind="choice", choices=["crosses", "stops", "hits", "at", "never"],
                                  help="crosses: its front reaches the finish line (or stop_x); stops: it comes to rest; hits: it first touches something new; at: after stop_at seconds; never: keeps counting"),
                             Prop("start_x", "Start line x", 0.0, -100.0, 100.0, 0.01, "m", "Where it starts, when no start line is linked (scene x)"),
                             Prop("stop_x", "Finish line x", 10.0, -100.0, 100.0, 0.01, "m", "Where it stops, when no finish line is linked (scene x)"),
                             Prop("stop_at", "Stop after", 3.0, 0.0, 20.0, 0.01, "s", "For stop = at"),
                             Prop("reaction_s", "Hand timing delay", 0.0, 0.0, 0.3, 0.01, "s", "0 = an electronic timer; a person presses about 0.2 s late"),
                             Prop("counts", "Shows", "run", kind="choice", choices=["run", "lesson"], help="lesson: the time-lapse clock (1 h 32 min) when the scene runs time-lapsed"),
                             Prop("face_cm", "Face size", 20.0, 6.0, 60.0, 1.0, "cm", "A real one is 6 cm; make it big to read it in a wide shot"),
                             Prop("on_table", "A real one on the table", False, kind="bool", help="A real 60 g stopwatch standing on the table instead of a floating display")],
                      links=[Link("watch", "Times", help="The thing it times"),
                             Link("start_line", "Start line", types=list(LINES), help="A start line, or a lane (its start mark)"),
                             Link("finish_line", "Finish line", types=list(LINES), help="A finish line, or a lane (its finish mark)")],
                      readouts=[Readout("seconds", "Time", "s", 2), Readout("meters", "Distance moved", "m", 2), Readout("start_s", "Started at", "s", 3),
                                Readout("stop_s", "Stopped at", "s", 3)],
                      tags=["timer", "clock", "time", "seconds", "race", "timing", "watch", "stop watch", "measure"],
                      anchor="the middle of its face",
                      description="A digital stopwatch timing the thing it watches: it starts at the release (or when it moves, or crosses a start "
                                  "line) and stops when its front crosses the finish line (or when it stops, hits something, or after set seconds). "
                                  "Its big face shows the time; it touches nothing.",
                      source="Times from the engine's 480 Hz steps, interpolated to the moment the front reaches the line; reads to 0.01 s like a "
                             "handheld stopwatch. Hand timing adds a reaction delay of 0.2-0.25 s [HUMAN-RT] when reaction_s is set.",
                      facts="reads 0.01 s · starts at release · stops at the finish"))


# ---------------------------------------------------------------- measuring tape
def build_tape(c, P):
    L = P["length"]
    sgn = 1.0 if P["from"] == "left end" else -1.0
    _ghost(c, "tape", L, 0.0006, 0.025, sgn * L / 2, -0.0003, look="tape steel", words="a steel measuring tape")
    c.process("measure-tape", "read", watch=c.link("watch"), zero=_r5(c.item.get("x", 0.0)), dir=sgn, point=P["point"], length=_r5(L))


def _tape():
    register(ItemType("measuring-tape", "Measuring tape", CAT, build_tape, dynamic=False, module=MODULE,
                      props=[Prop("length", "Length", 5.0, 0.3, 30.0, 0.1, "m"),
                             Prop("from", "Zero at", "left end", kind="choice", choices=["left end", "right end"], help="Its zero is at its anchor; it runs right (or left) from there"),
                             Prop("point", "Reads", "front", kind="choice", choices=["front", "back", "centre"], help="Which point of the watched thing it reads"),
                             Prop("numbers", "Numbers every", "1 m", kind="choice", choices=["10 cm", "1 m"]),
                             Prop("label_cm", "Number height", 4.0, 1.0, 30.0, 0.5, "cm")],
                      links=[Link("watch", "Measures", help="The thing whose place it reads")],
                      readouts=[Readout("meters", "Reads", "m", 3), Readout("past_end", "Past its end", "", 0, words={0: "on the tape", 1: "past its end"})],
                      tags=["tape measure", "ruler", "distance", "how far", "metres", "meters", "length", "measure"],
                      anchor="its zero end, on the floor",
                      description="A steel tape laid along the floor from its zero end. Linked to a thing, it reads where that thing's front is "
                                  "(and where it stopped): how far a car rolled from a ramp's foot. It reads 0 to its length (past_end 1 beyond it).",
                      source="A 25 mm steel tape with mm marks; the reading is the watched thing's front (back, centre) along the tape, to 1 mm.",
                      facts="5 m · reads to 1 mm", edit=[{"kind": "length", "prop": "length"}]))


# ---------------------------------------------------------------- speed gate, speedometer
def build_gate(c, P):
    h = P["beam_height"]
    _ghost(c, "gate", 0.03, h + 0.04, 0.12, 0.0, (h + 0.04) / 2, look="instrument face", words="a light gate")
    pair = c.link("pair")
    c.process("measure-gate", "beam", watch=c.link("watch"), x=_r5(c.item.get("x", 0.0)), y=_r5(c.item.get("y", 0.0) + h), pair=pair)


def _gate():
    register(ItemType("speed-gate", "Speed gate (light gate)", CAT, build_gate, dynamic=False, module=MODULE,
                      props=[Prop("beam_height", "Beam height", 0.03, 0.005, 1.0, 0.005, "m", "How high the beam crosses the track"),
                             Prop("face_cm", "Display size", 12.0, 4.0, 40.0, 1.0, "cm")],
                      links=[Link("watch", "Times", help="The thing it times (else whatever blocks the beam first)"),
                             Link("pair", "First gate", types=["speed-gate"], help="Another gate: this one also reads the time since that one was blocked")],
                      readouts=[Readout("speed", "Speed", "m/s", 2), Readout("blocked_s", "Blocked for", "s", 4), Readout("between_s", "Time from the first gate", "s", 3)],
                      tags=["photogate", "light gate", "speed", "timer", "beam", "velocity", "speed trap"],
                      anchor="the floor under its beam",
                      description="A light gate: an infrared beam across the track. It times how long the passing thing blocks the beam and reads "
                                  "its speed = its length / that time; two linked gates read the time between them.",
                      source="v = flag length / blocked time, timed to 0.1 ms [VERNIER]; the length is the thing's own outline where the beam meets it.",
                      facts="reads speed to 0.01 m/s"))


def build_speedometer(c, P):
    face = P["face_cm"] / 100
    _ghost(c, "sign", face, face * 0.75, 0.05, words="a radar speed sign")
    c.process("measure-speed", "radar", watch=c.link("watch"), kmh=P["units"] == "km/h")


def _speedometer():
    register(ItemType("speedometer", "Speedometer (radar sign)", CAT, build_speedometer, dynamic=False, module=MODULE,
                      props=[Prop("units", "Units", "m/s", kind="choice", choices=["m/s", "km/h"]),
                             Prop("face_cm", "Sign size", 30.0, 8.0, 80.0, 1.0, "cm")],
                      links=[Link("watch", "Reads", help="The thing whose speed it shows")],
                      readouts=[Readout("speed", "Speed now", "m/s", 2), Readout("top", "Top speed", "m/s", 2), Readout("mean", "Mean speed", "m/s", 2)],
                      tags=["speed", "radar", "speed gun", "velocity", "how fast", "meter", "your speed"],
                      anchor="the middle of its sign",
                      description="A radar speed sign showing how fast the watched thing moves now (and its top and mean speed). It touches nothing.",
                      source="The speed of the thing's centre of mass from the engine, every step.", facts="m/s or km/h"))


# ---------------------------------------------------------------- spring scale (Newton meter)
def build_spring_scale(c, P):
    rng = float(P["range"].split()[0])
    k = rng / 0.10                                  # full scale over 10 cm of travel [OHAUS]
    tube, hook_h, hook_m = 0.25, 0.04, 0.012
    # the case hangs from its ring at the anchor; its scale runs down the tube; the hook (steel, 12 g) hangs on the spring below it
    case = c.slab("case", 0.025, tube, 0.025, 0.0, -tube / 2, kind="static", look="clear acrylic", words="a spring scale's clear tube",
                  material=c.mat(base="ABS plastic", overrides={}), stand="self")
    rest = 0.02
    hy = -tube - rest - hook_h / 2
    hook = c.slab("hook", 0.006, hook_h, 0.006, 0.0, hy, look="steel",
                  material=c.mat(base="steel", density=round(hook_m / (0.006 * hook_h * 0.006), 3), overrides={}), words="a spring scale's hook")
    m_nom = 0.5 * rng / G
    damping = round(2 * 0.3 * math.sqrt(k * (m_nom + hook_m)), 5)
    c.joint("spring", "spring", a="case", b="hook", anchorA=(0.0, -tube / 2), anchorB=(0.0, hook_h / 2), rest=rest, stiffness=round(k, 5),
            damping=damping, coils=40, coilRadius=0.008)
    # the hook bottoms out 5 mm past full scale (the end of the tube): its spring never stretches past that, however much hangs on it
    travel = (rng + hook_m * G) / k + 0.005
    c.process("measure-spring", "read", case=case, hook=hook, aA={"x": 0.0, "y": _r5(-tube / 2)}, aB={"x": 0.0, "y": _r5(hook_h / 2)}, stiffness=round(k, 5),
              rest=rest, hook_mass=hook_m, range=rng, stop=_r5(rest + travel))


def _spring_scale():
    register(ItemType("spring-scale", "Spring scale (newton meter)", CAT, build_spring_scale, module=MODULE,
                      props=[Prop("range", "Range", "10 N", kind="choice", choices=SCALE_RANGES, help="Full scale; its spring stretches 10 cm at full scale")],
                      links=[Link("hook", "Hangs", help="The thing hung from its hook by a short string")],
                      readouts=[Readout("newtons", "Force", "N", 2), Readout("grams", "As a weight", "g", 0), Readout("over", "Over its range", "", 0, words={0: "in range", 1: "over its range"})],
                      tags=["newton meter", "force meter", "spring balance", "weigh", "weight", "force", "pull", "hooke"],
                      anchor="its top ring",
                      description="A newton meter: a spring in a clear tube with a hook below, held up by a retort stand. Hang a thing on its hook (link it) and "
                                  "the spring stretches until it holds the thing's weight; the pointer reads the force in newtons. It shows weight: on the "
                                  "Moon 1 kg pulls 1.62 N (its grams, worked out with the Earth's 9.81, read 165 g). Past its range the hook bottoms out "
                                  "(over 1).",
                      source="Stiffness = range / 0.10 m (10 cm of travel to full scale) [OHAUS]; Hooke's law F = k·x; the reading is the spring's pull "
                             "less the hook's own weight (zeroed, as a real scale's zero screw does), averaged over 0.2 s; grams = newtons / 9.81 "
                             "(calibrated on Earth); Moon g = 1.62 m/s² (NASA Moon fact sheet).",
                      facts="2.5-50 N · 10 cm of travel"))


def hang_hooks(sb, scene):
    """Build hook: a spring scale's linked item hangs from its hook on a short string (a rope joint from the hook's bottom to the top of the
    item's topmost moving solid, taut as placed)."""
    for it in scene.get("items", []):
        if not isinstance(it, dict) or it.get("type") != "spring-scale":
            continue
        other = (it.get("props") or {}).get("hook")
        if not isinstance(other, str) or other == it.get("id") or other not in sb.scene_items:
            continue
        hook = next((s for s in sb.solids if s["id"] == f"{it['id']}/hook"), None)
        tops = [s for s in sb.solids if s["item"] == other and s["kind"] == "dynamic" and "parent" not in s]
        if hook is None or not tops:
            continue
        top = max(tops, key=lambda s: s["at"]["y"])
        b = top["body"]
        if b["kind"] == "ball":
            lx, ly = 0.0, b["radius"]
        elif b["kind"] == "slab":
            lx, ly = 0.0, b["height"] / 2
        else:
            p = max(b["points"], key=lambda q: q["y"])
            lx, ly = p["x"], p["y"]
        a = top.get("angle", 0.0)
        tx = top["at"]["x"] + lx * cos(a) - ly * sin(a)
        ty = top["at"]["y"] + lx * sin(a) + ly * cos(a)
        hb = hook["body"]["height"] / 2
        hx, hy = hook["at"]["x"], hook["at"]["y"] - hb
        length = max(0.005, math.hypot(tx - hx, ty - hy))
        sb.joints.append({"kind": "rope", "id": f"{it['id']}/string", "item": it["id"], "a": hook["id"], "b": top["id"],
                          "anchorA": {"x": 0.0, "y": round(-hb, 5)}, "anchorB": {"x": round(lx, 5), "y": round(ly, 5)},
                          "length": round(length, 5), "thickness": 0.0015})


# ---------------------------------------------------------------- kitchen scale, pan balance, gram masses
def build_kitchen_scale(c, P):
    mech = P["style"] == "mechanical"
    body = c.mat(base="ABS plastic", overrides={})
    if mech:
        c.slab("base", 0.17, 0.11, 0.16, 0.0, 0.055, kind="static", material=body, look="plastic", words="a dial kitchen scale")
        top = c.slab("platform", 0.2, 0.008, 0.2, 0.0, 0.114, kind="static", material=c.mat(base="steel", overrides={}), look="steel", words="its weighing tray")
        h = 0.118
    else:
        c.slab("base", 0.18, 0.02, 0.18, 0.0, 0.01, kind="static", material=body, look="plastic", words="a digital kitchen scale")
        top = c.slab("platform", 0.15, 0.006, 0.15, 0.0, 0.023, kind="static", material=c.mat(base="steel", overrides={}), look="steel", words="its steel platform")
        h = 0.026
    P["top"] = h
    c.process("measure-scale", "load", platform=top, tare=bool(P["tare"]), capacity=_r5(P["capacity_kg"]))


def _kitchen_scale():
    register(ItemType("kitchen-scale", "Kitchen scale", CAT, build_kitchen_scale, dynamic=False, module=MODULE,
                      props=[Prop("style", "Kind", "digital", kind="choice", choices=["digital", "mechanical"]),
                             Prop("tare", "Tare at the start", False, kind="bool", help="Zero it with what is on it when the run starts"),
                             Prop("capacity_kg", "Capacity", 5.0, 0.5, 30.0, 0.5, "kg", "It shows 'Err' above this")],
                      readouts=[Readout("grams", "Reads", "g", 0), Readout("newtons", "Force on it", "N", 2)],
                      tags=["scale", "weigh", "mass", "grams", "balance", "kitchen", "conservation", "weight"],
                      anchor="the middle of its underside, on the table",
                      description="A kitchen scale: whatever rests on its platform, directly or stacked, is weighed in grams (the push on the "
                                  "platform divided by the Earth's g, 9.81: it is calibrated on Earth). It reads true at rest; a bouncing thing makes it "
                                  "jump about. It shows weight, so on the Moon a 1 kg mass reads 165 g (a pan balance compares masses and reads the same "
                                  "anywhere).",
                      source="Digital: 0-5 kg, d = 1 g, 15 x 15 cm platform [NIST-HB44]. The reading is the weight of what rests on the platform "
                             "plus the push of what is speeding up or slowing down on it (Newton's second law for what it carries), filtered over "
                             "0.05 s as a load cell's electronics do.", facts="0-5 kg · 1 g"))


def build_balance(c, P):
    L, beam_y = 0.30, 0.25
    wood = c.mat(base="varnished hardwood", overrides={})
    steel = c.mat(base="steel", overrides={})
    c.slab("base", 0.16, 0.02, 0.12, 0.0, 0.01, kind="static", material=wood, look="wood", words="a balance's base")
    post = beam_y - 0.02 - 0.016             # (the post stops 1 cm under the beam, past the engine's 2 mm contact skin: the beam turns on its pin alone)
    c.slab("post", 0.016, post, 0.016, 0.0, 0.02 + post / 2, kind="static", material=steel, look="steel", words="a balance's post")
    # the beam is a ghost too: in the side view it stands over the middle of the pans, so what is dropped into a pan passes it (in the room the
    # pans hang from bows at its ends, and things go in from the side); it weighs what it weighs and turns on its pin
    beam = c.slab("beam", L, 0.012, 0.012, 0.0, beam_y, material=c.mat(base="aluminium", overrides={}), look="aluminium", words="a balance beam", ghost=True)
    # its pointer hangs below the pivot, so the beam has a centre of mass under it: it settles level with equal loads and tips a little
    # toward the heavier pan (a real balance's sensitivity). The pointer swings in front of the post and the hangers come down to the middle
    # of the pans, where in one plane they would meet the post and the masses: they are ghosts (their weight counts, they touch nothing)
    c.sb.solids.append({"kind": c.kind, "id": c.sid("pointer"), "words": "a balance's pointer", "item": c.item["id"], "look": "steel",
                        "body": {"kind": "slab", "width": 0.004, "height": 0.12, "depth": 0.004}, "material": steel,
                        "at": {"x": 0.0, "y": -0.066}, "parent": beam, "placeholder": {"fill": "#9aa3ab"}, "render": {"kind": "procedural", "shade": "#6b737a"}, "depth": 2,
                        "ghost": True})
    bw, bh, bd = 0.022, 0.016, 0.016
    c.sb.solids.append({"kind": c.kind, "id": c.sid("bob"), "words": "a balance's gravity bob", "item": c.item["id"], "look": "polished brass",
                        "body": {"kind": "slab", "width": bw, "height": bh, "depth": bd}, "material": c.mat(base="brass", density=round(BOB_KG / (bw * bh * bd), 3), overrides={}),
                        "at": {"x": 0.0, "y": BOB_Y}, "parent": beam, "placeholder": {"fill": "#c9a24a"}, "render": {"kind": "procedural", "shade": "#94742c"}, "depth": 2,
                        "ghost": True})
    # each pan hangs 12 cm under its end of the beam; the hanger's body is the top 2 cm of its bow (the model draws the bow down to the pan), so
    # nothing of it stands in a pan: the AI's solver sets what goes inside the balance down on the pan (plugin place.interior, rim 0.2 m)
    pan_r, drop, hang = 0.06, 0.12, 0.02
    for side, sx in (("left", -1.0), ("right", 1.0)):
        px = sx * (L / 2 - 0.01)
        hanger = c.slab(f"hanger-{side}", 0.004, hang, 0.004, px, beam_y - hang / 2, material=steel, look="steel", words="a pan's hanger", ghost=True)
        c.joint("pin", f"hinge-{side}", a="beam", b=f"hanger-{side}", anchorA=(px, 0.0), anchorB=(0.0, round(hang / 2, 5)), damping=0.0005)
        for part, w, h, lx, ly in ((f"pan-{side}", 2 * pan_r, 0.004, 0.0, -drop - 0.002 + hang / 2), (f"lip-{side}-l", 0.004, 0.012, -pan_r + 0.002, -drop + 0.006 + hang / 2),
                                   (f"lip-{side}-r", 0.004, 0.012, pan_r - 0.002, -drop + 0.006 + hang / 2)):
            c.sb.solids.append({"kind": c.kind, "id": c.sid(part), "words": "a balance pan", "item": c.item["id"], "look": "polished brass",
                                "body": {"kind": "slab", "width": w, "height": h, "depth": 0.12}, "material": steel,
                                "at": {"x": lx, "y": ly}, "parent": hanger, "placeholder": {"fill": "#c9a24a"}, "render": {"kind": "procedural", "shade": "#94742c"}, "depth": 2})
    c.joint("pin", "pivot", a=None, b="beam", anchorA=(0.0, beam_y), anchorB=(0.0, 0.0),
            limits={"lower": round(-P["stop_deg"] * D2R, 5), "upper": round(P["stop_deg"] * D2R, 5)}, damping=round(P["damping"], 5))
    c.process("measure-balance", "tilt", beam=beam, left=[c.sid(p) for p in ("pan-left", "lip-left-l", "lip-left-r")],
              right=[c.sid(p) for p in ("pan-right", "lip-right-l", "lip-right-r")])


def _balance():
    register(ItemType("pan-balance", "Pan balance", CAT, build_balance, module=MODULE,
                      props=[Prop("stop_deg", "Tilts at most", 15.0, 3.0, 30.0, 0.5, "°"),
                             Prop("damping", "Beam damping", 0.02, 0.0, 0.05, 0.0005, "N·m·s", "A real beam's air damper: it settles instead of rocking for ever")],
                      readouts=[Readout("tilt", "Tilt", "°", 1), Readout("heavier", "Heavier side", "", 0, help="-1 left, 0 level, 1 right"),
                                Readout("left_g", "Left pan holds", "g", 1), Readout("right_g", "Right pan holds", "g", 1)],
                      tags=["balance", "scale", "compare", "mass", "heavier", "lighter", "equal arm", "weigh", "pans"],
                      anchor="the middle of its base, on the table",
                      description="An equal-arm balance: a 30 cm beam on a post with a pan hanging from each end. It tips toward the heavier pan "
                                  "(1.5° a gram, up to its stop) and settles level when both pans hold the same mass, whatever their size. It compares "
                                  "masses, so it reads the same on the Moon (a scale, showing weight, reads 1/6 there). Put things IN its pans: inside "
                                  "the balance at x = its x - 0.14 m (left pan) or + 0.14 m (right pan).",
                      source="Beam 30 cm, pans 12 cm across, 14 cm from the pivot; a gravity bob on the pointer 9 cm under the pivot keeps the beam's "
                             "centre of mass low, so equal loads settle level (the lever rule) within a few swings of 1.7-2.5 s; its readings say "
                             "what each pan holds (g).",
                      facts="30 cm beam · ±15° stop"))


def build_gram_mass(c, P):
    d, h = GRAM_SIZES[P["grams"]]
    grams = float(P["grams"].split()[0]) * (1000.0 if P["grams"].endswith("kg") else 1.0)
    m = grams / 1000
    dens = round(m / (d * h * d), 3)        # (the engine's slab is a d x h x d box: its density is set so the box weighs the cylinder's nominal mass)
    c.slab("mass", d, h, d, 0.0, h / 2, material=c.mat(base="brass", density=dens, overrides={}), look="polished brass",
           words=f"a {P['grams']} brass mass")
    P["kg"] = round(m, 6)


def _gram_mass():
    register(ItemType("gram-mass", "Gram mass (brass)", CAT, build_gram_mass, module=MODULE, material="brass", materials=["brass"],
                      props=[Prop("grams", "Mass", "100 g", kind="choice", choices=list(GRAM_SIZES))],
                      tags=["weight", "mass", "slotted mass", "calibration", "brass", "grams", "kilogram", "standard mass"],
                      anchor="the middle of its base",
                      description="A brass laboratory mass (1 g to 1 kg) of exactly its marked mass: put it in a balance pan or on a scale.",
                      source="Cylindrical brass weights, height about 1.25 x diameter, 8400 kg/m³ [OIML-R111]; the body's density is set so it weighs "
                             "exactly its nominal mass.", facts="1 g to 1 kg"))


# ---------------------------------------------------------------- protractor, plumb line, metre stick
def build_protractor(c, P):
    R = P["size_cm"] / 200
    _ghost(c, "face", 2 * R, R, 0.002, 0.0, R / 2, look="clear acrylic", words="a clear protractor")
    c.process("measure-angle", "read", watch=c.link("watch"))


def _protractor():
    register(ItemType("protractor", "Protractor", CAT, build_protractor, dynamic=False, module=MODULE,
                      props=[Prop("size_cm", "Size", 30.0, 10.0, 100.0, 1.0, "cm", "Across its straight edge; a school one is 15 cm")],
                      links=[Link("watch", "Measures", help="A ramp, a pendulum, a lever: the thing whose angle it reads")],
                      readouts=[Readout("degrees", "Angle", "°", 1), Readout("swing", "Swing", "°", 1)],
                      tags=["angle", "degrees", "slope", "tilt", "incline", "measure", "pendulum"],
                      anchor="the middle of its straight edge (its centre mark)",
                      description="A clear 180° protractor. Linked to a ramp it reads the slope from level; to a pendulum or lever, how far it is "
                                  "turned from hanging straight, and how far it swings. It touches nothing.",
                      source="The linked thing's turn from the engine (its main solid's angle), to 0.1°; marks every degree.", facts="180° · 0.5° marks"))


def build_plumb(c, P):
    L = P["length"]
    _ghost(c, "line", 0.004, L, 0.004, 0.0, -L / 2, look="steel", words="a plumb line")


def _plumb():
    register(ItemType("plumb-line", "Plumb line", CAT, build_plumb, dynamic=False, module=MODULE,
                      props=[Prop("length", "Length", 0.5, 0.05, 3.0, 0.01, "m")],
                      tags=["plumb", "vertical", "down", "gravity", "plumb bob", "straight down"],
                      anchor="where its string is tied (the top)",
                      description="A string with a pointed brass bob: it hangs straight down, toward the Earth's centre: it shows which way "
                                  "gravity pulls. Only drawn: it touches nothing.", source="A plumb bob hangs along g.", facts="shows straight down"))


def build_metre_stick(c, P):
    L = P["length"]
    c.slab("stick", L, 0.006, 0.028, 0.0, 0.003, look="light wood", words="a wooden metre stick")


def _metre_stick():
    register(ItemType("metre-stick", "Metre stick", CAT, build_metre_stick, module=MODULE, material="varnished hardwood", materials=["varnished hardwood", "domino wood"],
                      props=[Prop("length", "Length", 1.0, 0.3, 2.0, 0.1, "m")],
                      tags=["meter stick", "ruler", "metre rule", "yardstick", "measure", "centimetres", "lever"],
                      anchor="the middle of its underside",
                      description="A 1 m wooden stick with centimetre marks (lay it beside a thing to measure it; it is a real stick: it can be a lever).",
                      source="1 m x 28 mm x 6 mm maple, about 0.12 kg.", facts="1 m · cm marks", edit=[{"kind": "length", "prop": "length"}]))


# ---------------------------------------------------------------- motion sensor
def build_sensor(c, P):
    _ghost(c, "box", 0.06, 0.05, 0.08, 0.0, 0.0, look="instrument face", words="an ultrasonic motion sensor")
    a = c.item.get("angle", 0.0) * D2R
    c.process("measure-ranger", "ping", x=_r5(c.item.get("x", 0.0)), y=_r5(c.item.get("y", 0.0)), dx=round(cos(a), 6), dy=round(sin(a), 6),
              near=0.15, far=_r5(P["range_m"]))


def _sensor():
    register(ItemType("motion-sensor", "Motion sensor", CAT, build_sensor, dynamic=False, module=MODULE,
                      props=[Prop("range_m", "Range", 6.0, 0.5, 10.0, 0.5, "m", "Farthest it hears an echo")],
                      readouts=[Readout("distance", "Distance", "m", 3)],
                      tags=["ultrasonic", "ranger", "sonar", "distance sensor", "position", "graph", "data logger"],
                      anchor="the middle of the sensor (it faces to the right; turn it to aim)",
                      description="An ultrasonic motion sensor: it reads the distance to the nearest thing in front of it (15 cm to 6 m), "
                                  "every step; a graph board can plot it.", source="Ultrasonic rangers read 0.15-6 m (Vernier Motion Detector).",
                      facts="0.15-6 m", edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- what draws the run: a trail, a graph board, a data table
def build_trail(c, P):
    _ghost(c, "tag", 0.02, 0.02, 0.002, words="a motion trail marker", hidden_3d=True)


def _trail():
    register(ItemType("motion-trail", "Motion trail", CAT, build_trail, dynamic=False, module=MODULE,
                      props=[Prop("color", "Colour", "red", kind="choice", choices=COLORS),
                             Prop("style", "Draws", "line", kind="choice", choices=["line", "dots", "ghosts"], help="ghosts: copies of the thing every strobe_s seconds (a motion diagram)"),
                             Prop("strobe_s", "Every", 0.5, 0.05, 2.0, 0.05, "s", "Dots and ghosts: one every this many seconds"),
                             Prop("fade_s", "Fades after", 0.0, 0.0, 20.0, 0.5, "s", "0: the whole path stays")],
                      links=[Link("watch", "Follows", help="The moving thing whose path it draws")],
                      tags=["trail", "path", "strobe", "motion diagram", "trace", "track", "ghost"],
                      anchor="anywhere (it is only drawn behind the thing it follows)",
                      description="Draws the path behind the linked moving thing as it goes: a line, dots or ghost copies every strobe_s seconds "
                                  "(a motion diagram: wide spacing = fast). Drawn only.", source="From the engine's track.", facts="line, dots or ghosts"))


# The reading a board shows of a linked thing that has readings: a measuring instrument's own (MAIN), else the first of these it has (a
# thermometer's reading, a cup's water_temp before its wall's temp), else its first reading with a unit, else its first.
PREFER = ("reading", "water_temp", "grams", "seconds", "meters", "speed", "newtons", "degrees", "distance", "tilt", "temp", "temp_c", "volume_ml", "level_mm")


def main_reading(t):
    """{"key", "unit", "label", "digits"} of the reading a board shows of a thing of type t, or None when it has no readings."""
    ros = list(getattr(TYPES[t], "readouts", None) or []) if t in TYPES else []
    if not ros:
        return None
    keys = [r.key for r in ros]
    pick = None
    if t in MAIN and MAIN[t][0] in keys:
        pick = ros[keys.index(MAIN[t][0])]
    if pick is None:
        pick = next((ros[keys.index(k)] for k in PREFER if k in keys), None)
    if pick is None:
        pick = next((r for r in ros if r.unit), ros[0])
    return {"key": pick.key, "unit": pick.unit, "label": pick.label, "digits": pick.digits}


def build_board(c, P):
    w, h = P["width"], P["height"]
    _ghost(c, "board", w, h, 0.02, 0.0, h / 2, look="instrument face", words="a white board on legs")
    names, reads = {}, {}
    for key in ("watch", "watch2", "watch3", "watch4"):
        lid = c.link(key) if any(k.key == key for k in TYPES[c.item["type"]].links) else None
        if lid is not None:
            names[lid] = c.sb.scene_items[lid].get("name") or lid
            r = main_reading(c.sb.scene_items[lid]["type"])
            if r is not None:
                reads[lid] = r
    P["names"] = names            # (what the board writes beside each line or row: the linked things' own names)
    P["reads"] = reads            # (and the reading it plots or lists of each, with its unit)


# ---------------------------------------------------------------- links that name nothing: the layout's warnings (items.py WARNING_HOOKS)
# (what a measure item does without the link: said with the warning, so the person and the AI see why it reads nothing and can put it right)
WITHOUT = {("stopwatch", "watch"): "it times nothing and reads 0.00 s", ("stopwatch", "start_line"): "it starts at its own start_x instead",
           ("stopwatch", "finish_line"): "it stops at its own stop_x instead", ("measuring-tape", "watch"): "it reads nothing",
           ("speed-gate", "watch"): "it times the first thing through its beam", ("speed-gate", "pair"): "it reads no time between gates",
           ("speedometer", "watch"): "it reads nothing", ("spring-scale", "hook"): "nothing hangs on its hook", ("protractor", "watch"): "it reads nothing",
           ("motion-trail", "watch"): "it draws nothing"}


def _type_name(t):
    return TYPES[t].name if t in TYPES else str(t)


def link_warnings(scene, doc):
    """A measure item's link that names nothing it can use (no item of the scene by that id, the item itself, an item of a type the link does
    not take), and a stopwatch, trail or board with nothing to show: [{"items": [id], "text"}] (the layout's and the run's warnings)."""
    items = {i["id"]: i for i in scene.get("items", []) if isinstance(i, dict) and isinstance(i.get("id"), str)}
    out = []
    for it in scene.get("items", []):
        if not isinstance(it, dict) or it.get("type") not in TYPES or not isinstance(it.get("id"), str):
            continue
        T = TYPES[it["type"]]
        if getattr(T, "module", None) != MODULE or not T.links:
            continue
        name = it.get("name") or T.name
        given = it.get("props") or {}
        P = props_of(it)
        clock = it["type"] == "stopwatch" and P["start"] == "release" and P["stop"] in ("at", "never")
        linked = 0
        for L in T.links:
            v = given.get(L.key)
            if v is None:
                continue
            if not isinstance(v, str) or not v.strip():
                why = "names no item"
            elif v == it["id"]:
                why = "names itself"
            elif v not in items:
                why = f'names "{v}", which is no item of this scene'
            elif L.types and items[v].get("type") not in L.types:
                o = items[v]
                kinds = [_type_name(k).lower() for k in L.types]
                tn = _type_name(o.get("type")).lower()
                who = f"{o['name']}, a {tn}" if isinstance(o.get("name"), str) and o["name"] and o["name"].lower() != tn else f"a {tn}"
                takes = ", a ".join(kinds[:-1]) + " or a " + kinds[-1] if len(kinds) > 1 else kinds[0]
                why = f"names {who}: it takes a {takes}"
            else:
                linked += 1
                continue
            what = "it runs as a plain clock" if clock and L.key == "watch" else WITHOUT.get((it["type"], L.key), "the link is left out")
            out.append({"items": [it["id"]], "text": f"{name}'s {L.key.replace('_', ' ')} link {why}, so {what}"})
        if it["type"] == "stopwatch" and given.get("watch") is None and not clock:
            out.append({"items": [it["id"]], "text": f"{name} has no watch link (the thing it times), so it reads 0.00 s"})
        if it["type"] in ("motion-trail", "graph-board", "data-table") and linked == 0 and all(given.get(L.key) is None for L in T.links):
            out.append({"items": [it["id"]], "text": f"{name} has no linked {'thing' if it['type'] == 'motion-trail' else 'things'}, so it shows nothing"})
    return out


def _boards():
    register(ItemType("graph-board", "Graph board", CAT, build_board, dynamic=False, module=MODULE,
                      props=[Prop("plot", "Plots", "distance", kind="choice", choices=["distance", "speed", "reading"],
                                  help="distance or speed of the linked things against time, or an instrument's reading"),
                             Prop("width", "Width", 1.2, 0.4, 4.0, 0.1, "m"), Prop("height", "Height", 0.8, 0.3, 2.0, 0.1, "m"),
                             Prop("t_max", "Time axis", 0.0, 0.0, 20.0, 0.5, "s", "0: the run's length")],
                      links=[Link("watch", "Line 1"), Link("watch2", "Line 2"), Link("watch3", "Line 3")],
                      tags=["graph", "chart", "plot", "distance-time", "speed-time", "position", "data", "whiteboard"],
                      anchor="the middle of its bottom edge",
                      description="A board standing behind the scene that draws, as the run plays, the distance (from where each started) or speed "
                                  "of up to three linked things against time, or a linked instrument's reading. Drawn only.",
                      source="From the engine's track and the instruments' readings.", facts="distance-time · speed-time"))
    register(ItemType("data-table", "Data table", CAT, build_board, dynamic=False, module=MODULE,
                      props=[Prop("width", "Width", 1.0, 0.4, 4.0, 0.1, "m"), Prop("height", "Height", 0.7, 0.3, 2.0, 0.1, "m"),
                             Prop("title", "Title", "Results", kind="choice", choices=["Results", "Trial results", "Times", "Distances", "Readings"])],
                      links=[Link("watch", "Row 1"), Link("watch2", "Row 2"), Link("watch3", "Row 3"), Link("watch4", "Row 4")],
                      tags=["table", "results", "data", "trials", "record", "fair test"],
                      anchor="the middle of its bottom edge",
                      description="A board listing the linked instruments' readings (a stopwatch's time, a tape's distance) as the run ends: a "
                                  "fair test's results. Drawn only.", source="The instruments' readings.", facts="up to 4 rows"))


# ---------------------------------------------------------------- goals (the same, number for number, as web/sim/modules/measure.js)
UNIT_KEYS = (("seconds", "seconds", 0.1, "s"), ("meters", "meters", 0.05, "m"), ("mps", "speed", 0.1, "m/s"), ("newtons", "newtons", 0.1, "N"),
             ("grams", "grams", 10.0, "g"), ("degrees", "degrees", 1.0, "°"), ("value", None, None, ""))
MAIN = {"stopwatch": ("seconds", 0.1, "s"), "measuring-tape": ("meters", 0.05, "m"), "speed-gate": ("speed", 0.1, "m/s"), "speedometer": ("speed", 0.1, "m/s"),
        "spring-scale": ("newtons", 0.1, "N"), "kitchen-scale": ("grams", 10.0, "g"), "pan-balance": ("tilt", 1.0, "°"), "protractor": ("degrees", 1.0, "°"),
        "motion-sensor": ("distance", 0.05, "m")}


def _fmt(v):
    t = f"{v:.3f}".rstrip("0").rstrip(".")
    return t if t not in ("", "-0") else "0"


def _end_reading(ctx, iid, key):
    v = ctx.state(iid, key)
    return None if v is None or not v else v[-1]


def goal_reads(ctx, g):
    """{kind: "reads", item: instrument, value | seconds | meters | mps | newtons | grams | degrees: target, key?, tol?}: the instrument's reading at
    the end of the run is within tol of the target. The reading is the one the goal's unit names when the instrument has it (a stopwatch's
    "meters" for a distance), else `key` (one of its readouts), else its main one (a stopwatch's time, a tape's metres, a gate's speed; any other
    module's instrument: its first readout). Default tol: the reading's own (0.1 s, 5 cm, 0.1 m/s, 0.1 N, 10 g, 1°), else 2 % of the target."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    t = ctx.items[iid]["type"]
    ros = list(getattr(TYPES[t], "readouts", None) or []) if t in TYPES else []
    keys = [r.key for r in ros]
    want = key = tol = None
    unit = ""
    for k, field, ktol, kunit in UNIT_KEYS:
        v = ctx.num(g.get(k))
        if v is None:
            continue
        want = v
        if field is not None and field in keys:
            key, tol, unit = field, ktol, kunit
        elif isinstance(g.get("key"), str) and g["key"] in keys:
            ro = ros[keys.index(g["key"])]
            key, tol, unit = ro.key, None, ro.unit
        elif t in MAIN:
            key, tol, unit = MAIN[t]
        elif ros:
            key, tol, unit = ros[0].key, None, ros[0].unit
        break
    if want is None or key is None:
        return None
    got = _end_reading(ctx, iid, key)
    tl = ctx.num(g.get("tol"))
    if tl is None:
        tl = tol if tol is not None else max(1e-9, abs(want) * 0.02)
    ok = got is not None and abs(got - want) <= tl + 1e-9
    label = g.get("label") or f"{ctx.name(iid)} reads {_fmt(want)}{(' ' + unit) if unit else ''} (± {_fmt(tl)})"
    return {"label": label, "ok": ok, "kind": "reads", "item": iid, "key": key, "got": None if got is None else round(got, 4), "want": want}


class _Track:
    """The track read the way the race goals need it: an item's outline's extent along x per frame (lo, hi), its middle, its crossings."""

    def __init__(self, ctx):
        self.ctx, self.fr, self.T = ctx, ctx.frames, ctx.times
        self.cache = {}

    def pose(self, k, s):
        p = self.fr[k]["placements"].get(s["id"])
        if p is None:
            p = self.fr[0]["placements"].get(s["id"])
        if p is None:
            return (s["at"]["x"], s["at"]["y"], s.get("angle", 0.0))
        return (p["x"], p["y"], p.get("angle", 0.0))

    @staticmethod
    def span(s, pose):
        x, y, a = pose
        b = s["body"]
        if b["kind"] == "ball":
            return (x - b["radius"], x + b["radius"])
        if b["kind"] == "polygon":
            pts = [(p["x"], p["y"]) for p in b["points"]]
        else:
            hw, hh = b["width"] / 2, b["height"] / 2
            hb = hw * b.get("taper", 1.0)
            pts = [(-hb, -hh), (hb, -hh), (hw, hh), (-hw, hh)]
        c, n = cos(a), sin(a)
        xs = [x + px * c - py * n for px, py in pts]
        return (min(xs), max(xs))

    def series(self, iid):
        if iid in self.cache:
            return self.cache[iid]
        sol = self.ctx.solids(iid, True) or self.ctx.solids(iid)
        lo, hi, cx = [], [], []
        for k in range(len(self.fr)):
            ps = [self.pose(k, s) for s in sol]
            sp = [self.span(s, p) for s, p in zip(sol, ps)]
            lo.append(min(a for a, _ in sp))
            hi.append(max(b for _, b in sp))
            cx.append(sum(p[0] for p in ps) / len(ps))
        out = {"lo": lo, "hi": hi, "cx": cx}
        self.cache[iid] = out
        return out

    def crossing(self, values, level, rising):
        T = self.T
        if (values[0] >= level) if rising else (values[0] <= level):
            return T[0]
        for k in range(1, len(T)):
            a, b = values[k - 1], values[k]
            if (b >= level) if rising else (b <= level):
                return T[k - 1] + (level - a) * (T[k] - T[k - 1]) / (b - a) if b != a else T[k]
        return None

    def reach(self, iid, X):
        """When the item's front (its edge toward X, by where its middle starts) first reaches x = X, or None."""
        s = self.series(iid)
        if s["cx"][0] <= X:
            return self.crossing(s["hi"], X, True)
        return self.crossing(s["lo"], X, False)

    def travel(self, iid):
        """How far its middle ends along +x from where it started (m)."""
        s = self.series(iid)
        return s["cx"][-1] - s["cx"][0]


def _mark(ctx, iid):
    """A lane's or a line's marks as its builder wrote them in the document (a measure-mark record), or None (a document from before them)."""
    for r in ctx.doc.get("processes") or []:
        if isinstance(r, dict) and r.get("kind") == "measure-mark" and r.get("item") == iid:
            return r
    return None


def _x_of(ctx, g, key="line"):
    """A goal's line: a start-line / finish-line item's x, a lane's finish mark (from the document's measure-mark record, so a check with the
    document alone reads it too), or a number x."""
    v = g.get(key)
    if ctx.known(v):
        r = _mark(ctx, v)
        if r is not None:
            return float(r["finish"]) if "finish" in r else float(r["x"])
        it = ctx.items[v]
        if not isinstance(it.get("x"), (int, float)) or isinstance(it.get("x"), bool):
            return None
        if it["type"] == "lane":
            P = props_of(it)
            given = it.get("props") or {}
            return it["x"] + min(given.get("finish_at", P["length"]), P["length"])
        return float(it["x"])
    return ctx.num(g.get("x"))


def goal_crosses(ctx, g):
    """{kind: "crosses", item, line | x, before_s?, after_s?}: the item's front reaches the line (a start-line / finish-line item, a lane's finish
    mark, or x in metres), within the times given."""
    iid = g.get("item")
    if not ctx.known(iid) or not ctx.solids(iid):
        return None
    X = _x_of(ctx, g)
    if X is None:
        return None
    t = _Track(ctx).reach(iid, X)
    by, after = ctx.num(g.get("before_s")), ctx.num(g.get("after_s"))
    ok = t is not None and (by is None or t <= by) and (after is None or t >= after)
    where = ctx.name(g["line"]) if ctx.known(g.get("line")) else f"x = {_fmt(X)} m"
    when = (f" by {_fmt(by)} s" if by is not None else "") + (f" after {_fmt(after)} s" if after is not None else "")
    return {"label": g.get("label") or f"{ctx.name(iid)} reaches {where}{when}", "ok": ok, "kind": "crosses", "item": iid,
            "t": None if t is None else round(t, 3), "x": round(X, 4)}


def goal_faster(ctx, g):
    """{kind: "faster", a, b, line? | x?}: a is faster than b: over a common distance (the line, else the shorter of their two runs, from where
    each starts) a gets there sooner; if neither gets there, a ends farther along."""
    a, b = g.get("a"), g.get("b")
    if not (ctx.known(a) and ctx.known(b)) or a == b or not ctx.solids(a) or not ctx.solids(b):
        return None
    tr = _Track(ctx)
    X = _x_of(ctx, g)
    if X is not None:
        ta, tb = tr.reach(a, X), tr.reach(b, X)
    else:
        da, db = tr.travel(a), tr.travel(b)
        d = min(abs(da), abs(db))
        if d < 0.01:
            ta = tb = None
        else:
            sa, sb_ = tr.series(a), tr.series(b)
            ta = tr.crossing(sa["cx"], sa["cx"][0] + d, True) if da > 0 else tr.crossing(sa["cx"], sa["cx"][0] - d, False)
            tb = tr.crossing(sb_["cx"], sb_["cx"][0] + d, True) if db > 0 else tr.crossing(sb_["cx"], sb_["cx"][0] - d, False)
    if ta is not None and tb is not None:
        ok = ta < tb
        detail = f"{_fmt(ta)} s vs {_fmt(tb)} s"
    elif ta is not None or tb is not None:
        ok = ta is not None
        detail = f"{ctx.name(a if ta is not None else b)} only"
    else:
        ok = abs(tr.travel(a)) > abs(tr.travel(b)) + 0.01
        detail = "neither got there"
    return {"label": g.get("label") or f"{ctx.name(a)} is faster than {ctx.name(b)}", "ok": ok, "kind": "faster", "a": a, "b": b, "detail": detail}


def goal_farther(ctx, g):
    """{kind: "farther", a, b}: a ends at least 1 cm farther along +x from where it started than b does (its middle)."""
    a, b = g.get("a"), g.get("b")
    if not (ctx.known(a) and ctx.known(b)) or a == b or not ctx.solids(a) or not ctx.solids(b):
        return None
    tr = _Track(ctx)
    da, db = tr.travel(a), tr.travel(b)
    return {"label": g.get("label") or f"{ctx.name(a)} goes farther than {ctx.name(b)}", "ok": da >= db + 0.01, "kind": "farther", "a": a, "b": b,
            "a_m": round(da, 4), "b_m": round(db, 4)}


def goal_stops_between(ctx, g):
    """{kind: "stops_between", item, x0, x1}: the item's middle ends between x0 and x1 (m)."""
    iid = g.get("item")
    x0, x1 = ctx.num(g.get("x0")), ctx.num(g.get("x1"))
    if not ctx.known(iid) or not ctx.solids(iid) or x0 is None or x1 is None:
        return None
    lo, hi = min(x0, x1), max(x0, x1)
    x = _Track(ctx).series(iid)["cx"][-1]
    return {"label": g.get("label") or f"{ctx.name(iid)} stops between {_fmt(lo)} and {_fmt(hi)} m", "ok": lo <= x <= hi, "kind": "stops_between",
            "item": iid, "x": round(x, 4)}
