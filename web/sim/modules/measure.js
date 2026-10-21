// The measure module's port (machines/mod_measure.py, line for line: the same documents, number for number) and its plug-ins for the AI
// (goal kinds, digest, knobs, prompts, placement rules, change words). A module file takes everything from the framework object register_all
// gets (web/sim/items.js FRAMEWORK), so it imports nothing. See the Python file for the items, the rules and the sources.
let F = null
let py = null
let register, ItemType, Prop, Link, Readout, register_build_hook, register_warning_hook, MATERIALS, add_look, CATEGORIES, props_of, TYPES, D2R, define_material

const CAT = "Measuring"
const MODULE = "measure"
const G = 9.81
const LINES = ["start-line", "finish-line", "lane"]
const MARKS = { "10 cm": 0.1, "50 cm": 0.5, "1 m": 1.0, "2 m": 2.0, "5 m": 5.0 }
const SURFACES = { "gym floor": "varnished hardwood", vinyl: "vinyl rubber", concrete: "concrete", carpet: "carpet", asphalt: "asphalt" }
const PAINTS = ["pale gray", "pale blue", "pale green", "pale yellow", "white", "tan"]
const COLORS = ["red", "blue", "green", "orange", "purple", "yellow", "black", "white"]
const GRAM_SIZES = {
	"1 g": [0.0055, 0.0069], "2 g": [0.0069, 0.0087], "5 g": [0.0094, 0.0118], "10 g": [0.0119, 0.0149], "20 g": [0.015, 0.0187],
	"50 g": [0.0203, 0.0254], "100 g": [0.0256, 0.032], "200 g": [0.0323, 0.0403], "500 g": [0.0438, 0.0547], "1 kg": [0.0551, 0.0689]
}
const SCALE_RANGES = ["2.5 N", "5 N", "10 N", "20 N", "50 N"]
// (the pan balance's gravity bob: machines/mod_measure.py BOB_KG, BOB_Y)
const BOB_KG = 0.0466
const BOB_Y = -0.09

export function register_all(f) {
	F = f
	py = f.py
	;({ register, ItemType, Prop, Link, Readout, register_build_hook, register_warning_hook, MATERIALS, add_look, CATEGORIES, props_of, TYPES, D2R, define_material } = f)
	if (!CATEGORIES.includes(CAT)) CATEGORIES.push(CAT)
	if (!("asphalt" in MATERIALS))
		define_material("asphalt", { density: 2360, bounce: 0.6, friction: 0.7, rolling: 0.008, side: 0.0, look: "concrete", source: "Asphalt concrete 2300-2400 kg/m³ and rubber on dry asphalt 0.5-0.8 [ASPHALT]; rolling resistance provisional." }, ["density"])
	if (!("brass" in MATERIALS))
		define_material("brass", { density: 8400, bounce: 0.8, friction: 0.35, rolling: 0.001, side: 0.0, look: "polished brass", source: "Brass 8400-8730 kg/m³; OIML R111 weights 8400 kg/m³ [OIML-R111]." }, ["density"])
	for (const [key, kw] of [
		["lane paint", { fill: "#d9dcdf", shade: "#a9adb2", roughness: 0.6, metalness: 0.0, clearcoat: 0.3 }],
		["polished brass", { fill: "#c9a24a", shade: "#94742c", roughness: 0.25, metalness: 1.0, clearcoat: 0.0 }],
		["instrument face", { fill: "#2a2d33", shade: "#15171a", roughness: 0.4, metalness: 0.0, clearcoat: 0.5 }],
		["tape steel", { fill: "#f2c418", shade: "#b8920c", roughness: 0.35, metalness: 0.2, clearcoat: 0.3 }],
		["clear acrylic", { fill: "#e8f1f6", shade: "#b4c3cc", roughness: 0.05, metalness: 0.0, clearcoat: 1.0, transmission: 0.9 }]
	])
		add_look(key, kw)
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
}

const r5 = (v) => py.pyRound(v, 5)
const given = (c) => c.item.props ?? {}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const P_ = (key, label, def, ...rest) => new Prop(key, label, def, ...rest)

function ghost(c, part, w, h, depth, lx = 0.0, ly = 0.0, o = {}) {
	if (lx !== null && typeof lx === "object") {
		o = lx // (Python's keyword arguments: ghost(c, part, w, h, depth, {words}) leaves lx and ly at 0)
		lx = 0.0
		ly = 0.0
	}
	const { look = "instrument face", words = null, ...extra } = o
	return c.slab(part, w, h, depth, lx, ly, { kind: "static", material: c.mat({ base: "hollow plastic", overrides: {} }), look, words, ghost: true, stand: "self", ...extra })
}

function line_x(c, key, fallback) {
	const lid = c.link(key)
	if (lid === null) return [py.pyRound(fallback, 5), null]
	const it = c.sb.scene_items.get(lid)
	if (it.type === "lane") {
		const P = props_of(it)
		const g = it.props ?? {}
		const at = key === "finish_line" ? (has(g, "finish_at") ? g.finish_at : P.length) : P.start_at
		return [py.pyRound(it.x + Math.min(at, P.length), 5), lid]
	}
	return [py.pyRound(it.x, 5), lid]
}

// ---------------------------------------------------------------- lane, start and finish lines
function build_lane(c, P) {
	const L = P.length
	const m = P.margin
	const w = P.width
	const g = given(c)
	if (!has(g, "finish_at")) P.finish_at = L
	P.finish_at = Math.min(P.finish_at, L)
	P.start_at = Math.min(P.start_at, P.finish_at)
	P.raised = r5(Math.max(0.0, (c.item.y ?? 0.0) - 0.02))
	const mat = c.mat({ base: SURFACES[P.surface], overrides: {} })
	c.slab("floor", L + 2 * m, 0.02, w, L / 2, -0.01, { kind: "static", material: mat, look: "lane paint", words: "a long lane floor with metre marks", stand: "self" })
	if (P.end_stop && m >= 0.1)
		c.slab("stop", 0.08, 0.1, w, L + m - 0.04, 0.05, { kind: "static", material: c.mat({ base: "foam", overrides: {} }), look: "foam", words: "a foam bumper at the lane's end", stand: "self" })
	const x0 = c.item.x ?? 0.0
	c.process("measure-mark", "marks", { zero: r5(x0), start: r5(x0 + P.start_at), finish: r5(x0 + P.finish_at) })
}
function build_start_line(c, P) {
	ghost(c, "line", 0.05, 0.002, P.depth, 0.0, -0.001, { look: "lane paint", words: "a painted start line" })
	c.process("measure-mark", "mark", { x: r5(c.item.x ?? 0.0) })
}
function build_finish_line(c, P) {
	ghost(c, "line", 0.05, 0.002, P.depth, 0.0, -0.001, { look: "lane paint", words: "a painted finish line" })
	c.process("measure-mark", "mark", { x: r5(c.item.x ?? 0.0) })
}

function _lines() {
	register(new ItemType("lane", "Lane (with metre marks)", CAT, build_lane, {
		dynamic: false, module: MODULE,
		props: [
			P_("length", "Length", 10.0, 1.0, 60.0, 0.5, "m", "From its 0 m mark to its end mark"),
			P_("marks_every", "Marks every", "1 m", { kind: "choice", choices: Object.keys(MARKS) }),
			P_("labels", "Numbers", true, { kind: "bool", help: "Numbers beside the marks" }),
			P_("label_cm", "Number height", 20.0, 5.0, 50.0, 1.0, "cm", "Big numbers read in a wide 12 m shot"),
			P_("start_at", "Start line at", 0.0, 0.0, 60.0, 0.1, "m"),
			P_("finish_at", "Finish line at", 10.0, 0.0, 60.0, 0.1, "m", "Follows the length until you set it", { auto: ["length"] }),
			P_("width", "Width (front to back)", 0.6, 0.3, 1.5, 0.05, "m"),
			P_("surface", "Surface", "gym floor", { kind: "choice", choices: Object.keys(SURFACES) }),
			P_("color", "Colour", "pale gray", { kind: "choice", choices: PAINTS }),
			P_("margin", "Floor past each end", 1.0, 0.0, 5.0, 0.1, "m", "Floor before its 0 m mark and after its end, to start and stop on"),
			P_("end_stop", "Bumper at the far end", true, { kind: "bool", help: "A foam block on the floor's far end stops what runs past the finish (with 10 cm of floor or more past the end)" })
		],
		tags: ["track", "race", "runway", "floor", "metre", "meter", "marks", "distance", "lanes", "ruler", "hallway", "10 m"],
		anchor: "its 0 m mark, on its top surface",
		description: "A long floor with a mark every metre (or as set), big numbers, a start line and a finish line. Things race along it; " +
			"stopwatches link to it to stop at its finish. Two lanes one above the other compare two racers. A foam bumper on its " +
			"far end stops what runs past the finish.",
		source: "A static floor slab 2 cm thick of the chosen surface (gym floor = varnished hardwood, vinyl, concrete, carpet, asphalt " +
			"[ASPHALT]); its marks and numbers are paint (drawn only).",
		facts: "10 m · marks every metre · start and finish lines", edit: [{ kind: "length", prop: "length" }]
	}))
	for (const [key, name, build, words] of [["start-line", "Start line", build_start_line, "start"], ["finish-line", "Finish line", build_finish_line, "finish"]]) {
		register(new ItemType(key, name, CAT, build, {
			dynamic: false, module: MODULE,
			props: [
				P_("depth", "Length across", 0.6, 0.1, 2.0, 0.05, "m", "Across the floor, front to back"),
				P_("gate", "Light gate posts", false, { kind: "bool", help: "Two posts at the line (only drawn: the timing is the same)" }),
				P_("sign", `${words.toUpperCase()} sign`, true, { kind: "bool" })
			],
			tags: ["line", "race", words, "tape", "mark", "timing", "lane", words === "finish" ? "checkered" : "go"],
			anchor: "the middle of the line, on the floor",
			description: `A painted ${words} line across the floor. A stopwatch linked to it ${words === "finish" ? "stops" : "starts"} ` +
				"when the watched thing's front reaches it.",
			source: "Paint (drawn only: it touches nothing).", facts: `${words} line · 5 cm wide`
		}))
	}
}

// ---------------------------------------------------------------- stopwatch
// (mod_measure.py STOP_READINGS: readings another module's item has that a stopwatch may stop on; the choice is open; engine6 crossmod)
export const STOP_READINGS = ["empty", "bottom_g", "clogged", "melted", "reading", "temp", "water_temp", "boiling", "flame", "popped", "broken", "light", "on", "lux",
	"liquid_ml", "volume_ml", "left_ml", "flooded", "sunk", "grams", "level", "rpm", "dissolved_g"]

function build_stopwatch(c, P) {
	const face = P.face_cm / 100
	if (P.on_table) {
		c.slab("body", 0.06, 0.08, 0.015, 0.0, 0.0, { material: c.mat({ base: "ABS plastic", density: py.pyRound(0.06 / (0.06 * 0.08 * 0.015), 3), overrides: {} }), look: "instrument face", words: "a digital stopwatch" })
	} else ghost(c, "face", face, face * 0.9, Math.max(0.01, face * 0.25), { words: "a big stopwatch face" })
	const watch = c.link("watch")
	const [start_x] = line_x(c, "start_line", P.start_x)
	const [stop_x] = line_x(c, "finish_line", P.stop_x)
	const reads = P.stop === "reads" ? { stop_key: String(P.stop_reading), stop_value: r5(P.stop_value) } : {}
	c.process("measure-stopwatch", "watch", {
		watch, start: P.start, stop: P.stop, start_x: P.start === "crosses" ? start_x : null, stop_x: P.stop === "crosses" ? stop_x : null,
		stop_at: r5(P.stop_at), reaction: r5(P.reaction_s), lesson: P.counts === "lesson", ...reads
	})
}
function _stopwatch() {
	register(new ItemType("stopwatch", "Stopwatch", CAT, build_stopwatch, {
		dynamic: false, module: MODULE,
		props: [
			P_("start", "Starts", "release", { kind: "choice", choices: ["release", "moves", "crosses"], help: "release: at the scene's release; moves: when the watched thing has moved 1 mm; crosses: when its front reaches the start line" }),
			P_("stop", "Stops", "crosses", { kind: "choice", choices: ["crosses", "stops", "hits", "at", "reads", "never"], help: "crosses: its front reaches the finish line (or stop_x); stops: it comes to rest; hits: it first touches something new; at: after stop_at seconds; reads: its reading below reaches a value (a sand timer runs out); never: keeps counting" }),
			P_("start_x", "Start line x", 0.0, -100.0, 100.0, 0.01, "m", "Where it starts, when no start line is linked (scene x)"),
			P_("stop_x", "Finish line x", 10.0, -100.0, 100.0, 0.01, "m", "Where it stops, when no finish line is linked (scene x)"),
			P_("stop_at", "Stop after", 3.0, 0.0, 20.0, 0.01, "s", "For stop = at"),
			P_("stop_reading", "Stop on its reading", "empty", { kind: "choice", choices: STOP_READINGS, open: true, help: "For stop = reads: which reading of the thing it times (a sand timer's empty, an ice cube's melted, a thermometer's reading; any reading it has)" }),
			P_("stop_value", "Stop when it reaches", 1.0, -1000.0, 100000.0, 0.01, "", "For stop = reads: the value, reached from either side (empty 1: the timer has run out; melted 1; flame 0: the candle went out)", { slider_max: 100.0 }),
			P_("reaction_s", "Hand timing delay", 0.0, 0.0, 0.3, 0.01, "s", "0 = an electronic timer; a person presses about 0.2 s late"),
			P_("counts", "Shows", "run", { kind: "choice", choices: ["run", "lesson"], help: "lesson: the time-lapse clock (1 h 32 min) when the scene runs time-lapsed" }),
			P_("face_cm", "Face size", 20.0, 6.0, 60.0, 1.0, "cm", "A real one is 6 cm; make it big to read it in a wide shot"),
			P_("on_table", "A real one on the table", false, { kind: "bool", help: "A real 60 g stopwatch standing on the table instead of a floating display" })
		],
		links: [
			new Link("watch", "Times", { help: "The thing it times" }),
			new Link("start_line", "Start line", { types: [...LINES], help: "A start line, or a lane (its start mark)" }),
			new Link("finish_line", "Finish line", { types: [...LINES], help: "A finish line, or a lane (its finish mark)" })
		],
		readouts: [new Readout("seconds", "Time", { unit: "s", digits: 2 }), new Readout("meters", "Distance moved", { unit: "m", digits: 2 }), new Readout("start_s", "Started at", { unit: "s", digits: 3 }),
			new Readout("stop_s", "Stopped at", { unit: "s", digits: 3 })],
		tags: ["timer", "clock", "time", "seconds", "race", "timing", "watch", "stop watch", "measure"],
		anchor: "the middle of its face",
		description: "A digital stopwatch timing the thing it watches: it starts at the release (or when it moves, or crosses a start " +
			"line) and stops when its front crosses the finish line (or when it stops, hits something, after set seconds, or when a reading of " +
			"the thing it times reaches a value: a sand timer runs out, ice melts, a candle goes out). " +
			"Its big face shows the time; it touches nothing.",
		source: "Times from the engine's 480 Hz steps, interpolated to the moment the front reaches the line; reads to 0.01 s like a " +
			"handheld stopwatch. Hand timing adds a reaction delay of 0.2-0.25 s [HUMAN-RT] when reaction_s is set.",
		facts: "reads 0.01 s · starts at release · stops at the finish"
	}))
}

// ---------------------------------------------------------------- measuring tape
function build_tape(c, P) {
	const L = P.length
	const sgn = P.from === "left end" ? 1.0 : -1.0
	ghost(c, "tape", L, 0.0006, 0.025, (sgn * L) / 2, -0.0003, { look: "tape steel", words: "a steel measuring tape" })
	c.process("measure-tape", "read", { watch: c.link("watch"), zero: r5(c.item.x ?? 0.0), dir: sgn, point: P.point, length: r5(L) })
}
function _tape() {
	register(new ItemType("measuring-tape", "Measuring tape", CAT, build_tape, {
		dynamic: false, module: MODULE,
		props: [
			P_("length", "Length", 5.0, 0.3, 30.0, 0.1, "m"),
			P_("from", "Zero at", "left end", { kind: "choice", choices: ["left end", "right end"], help: "Its zero is at its anchor; it runs right (or left) from there" }),
			P_("point", "Reads", "front", { kind: "choice", choices: ["front", "back", "centre"], help: "Which point of the watched thing it reads" }),
			P_("numbers", "Numbers every", "1 m", { kind: "choice", choices: ["10 cm", "1 m"] }),
			P_("label_cm", "Number height", 4.0, 1.0, 30.0, 0.5, "cm")
		],
		links: [new Link("watch", "Measures", { help: "The thing whose place it reads" })],
		readouts: [new Readout("meters", "Reads", { unit: "m", digits: 3 }), new Readout("past_end", "Past its end", { unit: "", digits: 0, words: { 0: "on the tape", 1: "past its end" } })],
		tags: ["tape measure", "ruler", "distance", "how far", "metres", "meters", "length", "measure"],
		anchor: "its zero end, on the floor",
		description: "A steel tape laid along the floor from its zero end. Linked to a thing, it reads where that thing's front is " +
			"(and where it stopped): how far a car rolled from a ramp's foot. It reads 0 to its length (past_end 1 beyond it).",
		source: "A 25 mm steel tape with mm marks; the reading is the watched thing's front (back, centre) along the tape, to 1 mm.",
		facts: "5 m · reads to 1 mm", edit: [{ kind: "length", prop: "length" }]
	}))
}

// ---------------------------------------------------------------- speed gate, speedometer
function build_gate(c, P) {
	const h = P.beam_height
	ghost(c, "gate", 0.03, h + 0.04, 0.12, 0.0, (h + 0.04) / 2, { look: "instrument face", words: "a light gate" })
	const pair = c.link("pair")
	c.process("measure-gate", "beam", { watch: c.link("watch"), x: r5(c.item.x ?? 0.0), y: r5((c.item.y ?? 0.0) + h), pair })
}
function _gate() {
	register(new ItemType("speed-gate", "Speed gate (light gate)", CAT, build_gate, {
		dynamic: false, module: MODULE,
		props: [P_("beam_height", "Beam height", 0.03, 0.005, 1.0, 0.005, "m", "How high the beam crosses the track"), P_("face_cm", "Display size", 12.0, 4.0, 40.0, 1.0, "cm")],
		links: [
			new Link("watch", "Times", { help: "The thing it times (else whatever blocks the beam first)" }),
			new Link("pair", "First gate", { types: ["speed-gate"], help: "Another gate: this one also reads the time since that one was blocked" })
		],
		readouts: [new Readout("speed", "Speed", { unit: "m/s", digits: 2 }), new Readout("blocked_s", "Blocked for", { unit: "s", digits: 4 }), new Readout("between_s", "Time from the first gate", { unit: "s", digits: 3 })],
		tags: ["photogate", "light gate", "speed", "timer", "beam", "velocity", "speed trap"],
		anchor: "the floor under its beam",
		description: "A light gate: an infrared beam across the track. It times how long the passing thing blocks the beam and reads " +
			"its speed = its length / that time; two linked gates read the time between them.",
		source: "v = flag length / blocked time, timed to 0.1 ms [VERNIER]; the length is the thing's own outline where the beam meets it.",
		facts: "reads speed to 0.01 m/s"
	}))
}
function build_speedometer(c, P) {
	const face = P.face_cm / 100
	ghost(c, "sign", face, face * 0.75, 0.05, { words: "a radar speed sign" })
	c.process("measure-speed", "radar", { watch: c.link("watch"), kmh: P.units === "km/h" })
}
function _speedometer() {
	register(new ItemType("speedometer", "Speedometer (radar sign)", CAT, build_speedometer, {
		dynamic: false, module: MODULE,
		props: [P_("units", "Units", "m/s", { kind: "choice", choices: ["m/s", "km/h"] }), P_("face_cm", "Sign size", 30.0, 8.0, 80.0, 1.0, "cm")],
		links: [new Link("watch", "Reads", { help: "The thing whose speed it shows" })],
		readouts: [new Readout("speed", "Speed now", { unit: "m/s", digits: 2 }), new Readout("top", "Top speed", { unit: "m/s", digits: 2 }), new Readout("mean", "Mean speed", { unit: "m/s", digits: 2 })],
		tags: ["speed", "radar", "speed gun", "velocity", "how fast", "meter", "your speed"],
		anchor: "the middle of its sign",
		description: "A radar speed sign showing how fast the watched thing moves now (and its top and mean speed). It touches nothing.",
		source: "The speed of the thing's centre of mass from the engine, every step.", facts: "m/s or km/h"
	}))
}

// ---------------------------------------------------------------- spring scale (Newton meter)
function build_spring_scale(c, P) {
	const rng = parseFloat(P.range.split(" ")[0])
	const k = rng / 0.1
	const tube = 0.25
	const hook_h = 0.04
	const hook_m = 0.012
	const kase = c.slab("case", 0.025, tube, 0.025, 0.0, -tube / 2, { kind: "static", look: "clear acrylic", words: "a spring scale's clear tube", material: c.mat({ base: "ABS plastic", overrides: {} }), stand: "self" })
	const rest = 0.02
	const hy = -tube - rest - hook_h / 2
	const hook = c.slab("hook", 0.006, hook_h, 0.006, 0.0, hy, { look: "steel", material: c.mat({ base: "steel", density: py.pyRound(hook_m / (0.006 * hook_h * 0.006), 3), overrides: {} }), words: "a spring scale's hook" })
	const m_nom = (0.5 * rng) / G
	const damping = py.pyRound(2 * 0.3 * Math.sqrt(k * (m_nom + hook_m)), 5)
	c.joint("spring", "spring", { a: "case", b: "hook", anchorA: [0.0, -tube / 2], anchorB: [0.0, hook_h / 2], rest, stiffness: py.pyRound(k, 5), damping, coils: 40, coilRadius: 0.008 })
	const travel = (rng + hook_m * G) / k + 0.005
	c.process("measure-spring", "read", { case: kase, hook, aA: { x: 0.0, y: r5(-tube / 2) }, aB: { x: 0.0, y: r5(hook_h / 2) }, stiffness: py.pyRound(k, 5), rest, hook_mass: hook_m, range: rng, stop: r5(rest + travel) })
}
function _spring_scale() {
	register(new ItemType("spring-scale", "Spring scale (newton meter)", CAT, build_spring_scale, {
		module: MODULE,
		props: [P_("range", "Range", "10 N", { kind: "choice", choices: SCALE_RANGES, help: "Full scale; its spring stretches 10 cm at full scale" })],
		links: [new Link("hook", "Hangs", { help: "The thing hung from its hook by a short string" })],
		readouts: [new Readout("newtons", "Force", { unit: "N", digits: 2 }), new Readout("grams", "As a weight", { unit: "g", digits: 0 }), new Readout("over", "Over its range", { unit: "", digits: 0, words: { 0: "in range", 1: "over its range" } })],
		tags: ["newton meter", "force meter", "spring balance", "weigh", "weight", "force", "pull", "hooke"],
		anchor: "its top ring",
		description: "A newton meter: a spring in a clear tube with a hook below, held up by a retort stand. Hang a thing on its hook (link it) and " +
			"the spring stretches until it holds the thing's weight; the pointer reads the force in newtons. It shows weight: on the " +
			"Moon 1 kg pulls 1.62 N (its grams, worked out with the Earth's 9.81, read 165 g). Past its range the hook bottoms out " +
			"(over 1).",
		source: "Stiffness = range / 0.10 m (10 cm of travel to full scale) [OHAUS]; Hooke's law F = k·x; the reading is the spring's pull " +
			"less the hook's own weight (zeroed, as a real scale's zero screw does), averaged over 0.2 s; grams = newtons / 9.81 " +
			"(calibrated on Earth); Moon g = 1.62 m/s² (NASA Moon fact sheet).",
		facts: "2.5-50 N · 10 cm of travel"
	}))
}

function hang_hooks(sb, scene) {
	for (const it of scene.items ?? []) {
		if (it === null || typeof it !== "object" || it.type !== "spring-scale") continue
		const other = (it.props ?? {}).hook
		if (typeof other !== "string" || other === it.id || !sb.scene_items.has(other)) continue
		const hook = sb.solids.find((s) => s.id === `${it.id}/hook`) ?? null
		const tops = sb.solids.filter((s) => s.item === other && s.kind === "dynamic" && !("parent" in s))
		if (hook === null || !tops.length) continue
		let top = tops[0]
		for (const s of tops) if (s.at.y > top.at.y) top = s
		const b = top.body
		let lx
		let ly
		if (b.kind === "ball") {
			lx = 0.0
			ly = b.radius
		} else if (b.kind === "slab") {
			lx = 0.0
			ly = b.height / 2
		} else {
			let p = b.points[0]
			for (const q of b.points) if (q.y > p.y) p = q
			lx = p.x
			ly = p.y
		}
		const a = top.angle ?? 0.0
		const tx = top.at.x + lx * py.cos(a) - ly * py.sin(a)
		const ty = top.at.y + lx * py.sin(a) + ly * py.cos(a)
		const hb = hook.body.height / 2
		const hx = hook.at.x
		const hy = hook.at.y - hb
		const length = Math.max(0.005, py.hypot(tx - hx, ty - hy))
		sb.joints.push({ kind: "rope", id: `${it.id}/string`, item: it.id, a: hook.id, b: top.id, anchorA: { x: 0.0, y: r5(-hb) }, anchorB: { x: r5(lx), y: r5(ly) }, length: r5(length), thickness: 0.0015 })
	}
}

// ---------------------------------------------------------------- kitchen scale, pan balance, gram masses
function build_kitchen_scale(c, P) {
	const mech = P.style === "mechanical"
	const body = c.mat({ base: "ABS plastic", overrides: {} })
	let top
	let h
	if (mech) {
		c.slab("base", 0.17, 0.11, 0.16, 0.0, 0.055, { kind: "static", material: body, look: "plastic", words: "a dial kitchen scale" })
		top = c.slab("platform", 0.2, 0.008, 0.2, 0.0, 0.114, { kind: "static", material: c.mat({ base: "steel", overrides: {} }), look: "steel", words: "its weighing tray" })
		h = 0.118
	} else {
		c.slab("base", 0.18, 0.02, 0.18, 0.0, 0.01, { kind: "static", material: body, look: "plastic", words: "a digital kitchen scale" })
		top = c.slab("platform", 0.15, 0.006, 0.15, 0.0, 0.023, { kind: "static", material: c.mat({ base: "steel", overrides: {} }), look: "steel", words: "its steel platform" })
		h = 0.026
	}
	P.top = h
	c.process("measure-scale", "load", { platform: top, tare: !!P.tare, capacity: r5(P.capacity_kg) })
}
function _kitchen_scale() {
	register(new ItemType("kitchen-scale", "Kitchen scale", CAT, build_kitchen_scale, {
		dynamic: false, module: MODULE,
		props: [
			P_("style", "Kind", "digital", { kind: "choice", choices: ["digital", "mechanical"] }),
			P_("tare", "Tare at the start", false, { kind: "bool", help: "Zero it with what is on it when the run starts" }),
			P_("capacity_kg", "Capacity", 5.0, 0.5, 30.0, 0.5, "kg", "It shows 'Err' above this")
		],
		readouts: [new Readout("grams", "Reads", { unit: "g", digits: 0 }), new Readout("newtons", "Force on it", { unit: "N", digits: 2 })],
		tags: ["scale", "weigh", "mass", "grams", "balance", "kitchen", "conservation", "weight"],
		anchor: "the middle of its underside, on the table",
		description: "A kitchen scale: whatever rests on its platform, directly or stacked, is weighed in grams (the push on the " +
			"platform divided by the Earth's g, 9.81: it is calibrated on Earth). It reads true at rest; a bouncing thing makes it " +
			"jump about. It shows weight, so on the Moon a 1 kg mass reads 165 g (a pan balance compares masses and reads the same " +
			"anywhere).",
		source: "Digital: 0-5 kg, d = 1 g, 15 x 15 cm platform [NIST-HB44]. The reading is the weight of what rests on the platform " +
			"plus the push of what is speeding up or slowing down on it (Newton's second law for what it carries), filtered over " +
			"0.05 s as a load cell's electronics do.",
		facts: "0-5 kg · 1 g"
	}))
}

function build_balance(c, P) {
	const L = 0.3
	const beam_y = 0.25
	const wood = c.mat({ base: "varnished hardwood", overrides: {} })
	const steel = c.mat({ base: "steel", overrides: {} })
	c.slab("base", 0.16, 0.02, 0.12, 0.0, 0.01, { kind: "static", material: wood, look: "wood", words: "a balance's base" })
	const post = beam_y - 0.02 - 0.016
	c.slab("post", 0.016, post, 0.016, 0.0, 0.02 + post / 2, { kind: "static", material: steel, look: "steel", words: "a balance's post" })
	const beam = c.slab("beam", L, 0.012, 0.012, 0.0, beam_y, { material: c.mat({ base: "aluminium", overrides: {} }), look: "aluminium", words: "a balance beam", ghost: true })
	c.sb.solids.push({
		kind: c.kind, id: c.sid("pointer"), words: "a balance's pointer", item: c.item.id, look: "steel",
		body: { kind: "slab", width: 0.004, height: 0.12, depth: 0.004 }, material: steel,
		at: { x: 0.0, y: -0.066 }, parent: beam, placeholder: { fill: "#9aa3ab" }, render: { kind: "procedural", shade: "#6b737a" }, depth: 2,
		ghost: true
	})
	const bw = 0.022
	const bh = 0.016
	const bd = 0.016
	c.sb.solids.push({
		kind: c.kind, id: c.sid("bob"), words: "a balance's gravity bob", item: c.item.id, look: "polished brass",
		body: { kind: "slab", width: bw, height: bh, depth: bd }, material: c.mat({ base: "brass", density: py.pyRound(BOB_KG / (bw * bh * bd), 3), overrides: {} }),
		at: { x: 0.0, y: BOB_Y }, parent: beam, placeholder: { fill: "#c9a24a" }, render: { kind: "procedural", shade: "#94742c" }, depth: 2,
		ghost: true
	})
	const pan_r = 0.06
	const drop = 0.12
	const hang = 0.02
	for (const [side, sx] of [["left", -1.0], ["right", 1.0]]) {
		const px = sx * (L / 2 - 0.01)
		const hanger = c.slab(`hanger-${side}`, 0.004, hang, 0.004, px, beam_y - hang / 2, { material: steel, look: "steel", words: "a pan's hanger", ghost: true })
		c.joint("pin", `hinge-${side}`, { a: "beam", b: `hanger-${side}`, anchorA: [px, 0.0], anchorB: [0.0, py.pyRound(hang / 2, 5)], damping: 0.0005 })
		for (const [part, w, h, lx, ly] of [[`pan-${side}`, 2 * pan_r, 0.004, 0.0, -drop - 0.002 + hang / 2], [`lip-${side}-l`, 0.004, 0.012, -pan_r + 0.002, -drop + 0.006 + hang / 2],
			[`lip-${side}-r`, 0.004, 0.012, pan_r - 0.002, -drop + 0.006 + hang / 2]]) {
			c.sb.solids.push({
				kind: c.kind, id: c.sid(part), words: "a balance pan", item: c.item.id, look: "polished brass",
				body: { kind: "slab", width: w, height: h, depth: 0.12 }, material: steel,
				at: { x: lx, y: ly }, parent: hanger, placeholder: { fill: "#c9a24a" }, render: { kind: "procedural", shade: "#94742c" }, depth: 2
			})
		}
	}
	c.joint("pin", "pivot", { a: null, b: "beam", anchorA: [0.0, beam_y], anchorB: [0.0, 0.0], limits: { lower: py.pyRound(-P.stop_deg * D2R, 5), upper: py.pyRound(P.stop_deg * D2R, 5) }, damping: py.pyRound(P.damping, 5) })
	c.process("measure-balance", "tilt", { beam, left: ["pan-left", "lip-left-l", "lip-left-r"].map((p) => c.sid(p)), right: ["pan-right", "lip-right-l", "lip-right-r"].map((p) => c.sid(p)) })
}
function _balance() {
	register(new ItemType("pan-balance", "Pan balance", CAT, build_balance, {
		module: MODULE,
		props: [P_("stop_deg", "Tilts at most", 15.0, 3.0, 30.0, 0.5, "°"), P_("damping", "Beam damping", 0.02, 0.0, 0.05, 0.0005, "N·m·s", "A real beam's air damper: it settles instead of rocking for ever")],
		readouts: [new Readout("tilt", "Tilt", { unit: "°", digits: 1 }), new Readout("heavier", "Heavier side", { unit: "", digits: 0, help: "-1 left, 0 level, 1 right" }),
			new Readout("left_g", "Left pan holds", { unit: "g", digits: 1 }), new Readout("right_g", "Right pan holds", { unit: "g", digits: 1 })],
		tags: ["balance", "scale", "compare", "mass", "heavier", "lighter", "equal arm", "weigh", "pans"],
		anchor: "the middle of its base, on the table",
		description: "An equal-arm balance: a 30 cm beam on a post with a pan hanging from each end. It tips toward the heavier pan " +
			"(1.5° a gram, up to its stop) and settles level when both pans hold the same mass, whatever their size. It compares " +
			"masses, so it reads the same on the Moon (a scale, showing weight, reads 1/6 there). Put things IN its pans: inside " +
			"the balance at x = its x - 0.14 m (left pan) or + 0.14 m (right pan).",
		source: "Beam 30 cm, pans 12 cm across, 14 cm from the pivot; a gravity bob on the pointer 9 cm under the pivot keeps the beam's " +
			"centre of mass low, so equal loads settle level (the lever rule) within a few swings of 1.7-2.5 s; its readings say " +
			"what each pan holds (g).",
		facts: "30 cm beam · ±15° stop"
	}))
}

function build_gram_mass(c, P) {
	const [d, h] = GRAM_SIZES[P.grams]
	const grams = parseFloat(P.grams.split(" ")[0]) * (P.grams.endsWith("kg") ? 1000.0 : 1.0)
	const m = grams / 1000
	const dens = py.pyRound(m / (d * h * d), 3)
	c.slab("mass", d, h, d, 0.0, h / 2, { material: c.mat({ base: "brass", density: dens, overrides: {} }), look: "polished brass", words: `a ${P.grams} brass mass` })
	P.kg = py.pyRound(m, 6)
}
function _gram_mass() {
	register(new ItemType("gram-mass", "Gram mass (brass)", CAT, build_gram_mass, {
		module: MODULE, material: "brass", materials: ["brass"],
		props: [P_("grams", "Mass", "100 g", { kind: "choice", choices: Object.keys(GRAM_SIZES) })],
		tags: ["weight", "mass", "slotted mass", "calibration", "brass", "grams", "kilogram", "standard mass"],
		anchor: "the middle of its base",
		description: "A brass laboratory mass (1 g to 1 kg) of exactly its marked mass: put it in a balance pan or on a scale.",
		source: "Cylindrical brass weights, height about 1.25 x diameter, 8400 kg/m³ [OIML-R111]; the body's density is set so it weighs " +
			"exactly its nominal mass.",
		facts: "1 g to 1 kg"
	}))
}

// ---------------------------------------------------------------- protractor, plumb line, metre stick
function build_protractor(c, P) {
	const R = P.size_cm / 200
	ghost(c, "face", 2 * R, R, 0.002, 0.0, R / 2, { look: "clear acrylic", words: "a clear protractor" })
	c.process("measure-angle", "read", { watch: c.link("watch") })
}
function _protractor() {
	register(new ItemType("protractor", "Protractor", CAT, build_protractor, {
		dynamic: false, module: MODULE,
		props: [P_("size_cm", "Size", 30.0, 10.0, 100.0, 1.0, "cm", "Across its straight edge; a school one is 15 cm")],
		links: [new Link("watch", "Measures", { help: "A ramp, a pendulum, a lever: the thing whose angle it reads" })],
		readouts: [new Readout("degrees", "Angle", { unit: "°", digits: 1 }), new Readout("swing", "Swing", { unit: "°", digits: 1 })],
		tags: ["angle", "degrees", "slope", "tilt", "incline", "measure", "pendulum"],
		anchor: "the middle of its straight edge (its centre mark)",
		description: "A clear 180° protractor. Linked to a ramp it reads the slope from level; to a pendulum or lever, how far it is " +
			"turned from hanging straight, and how far it swings. It touches nothing.",
		source: "The linked thing's turn from the engine (its main solid's angle), to 0.1°; marks every degree.", facts: "180° · 0.5° marks"
	}))
}
function build_plumb(c, P) {
	const L = P.length
	ghost(c, "line", 0.004, L, 0.004, 0.0, -L / 2, { look: "steel", words: "a plumb line" })
}
function _plumb() {
	register(new ItemType("plumb-line", "Plumb line", CAT, build_plumb, {
		dynamic: false, module: MODULE,
		props: [P_("length", "Length", 0.5, 0.05, 3.0, 0.01, "m")],
		tags: ["plumb", "vertical", "down", "gravity", "plumb bob", "straight down"],
		anchor: "where its string is tied (the top)",
		description: "A string with a pointed brass bob: it hangs straight down, toward the Earth's centre: it shows which way " +
			"gravity pulls. Only drawn: it touches nothing.",
		source: "A plumb bob hangs along g.", facts: "shows straight down"
	}))
}
function build_metre_stick(c, P) {
	const L = P.length
	c.slab("stick", L, 0.006, 0.028, 0.0, 0.003, { look: "light wood", words: "a wooden metre stick" })
}
function _metre_stick() {
	register(new ItemType("metre-stick", "Metre stick", CAT, build_metre_stick, {
		module: MODULE, material: "varnished hardwood", materials: ["varnished hardwood", "domino wood"],
		props: [P_("length", "Length", 1.0, 0.3, 2.0, 0.1, "m")],
		tags: ["meter stick", "ruler", "metre rule", "yardstick", "measure", "centimetres", "lever"],
		anchor: "the middle of its underside",
		description: "A 1 m wooden stick with centimetre marks (lay it beside a thing to measure it; it is a real stick: it can be a lever).",
		source: "1 m x 28 mm x 6 mm maple, about 0.12 kg.", facts: "1 m · cm marks", edit: [{ kind: "length", prop: "length" }]
	}))
}

// ---------------------------------------------------------------- motion sensor
function build_sensor(c, P) {
	ghost(c, "box", 0.06, 0.05, 0.08, 0.0, 0.0, { look: "instrument face", words: "an ultrasonic motion sensor" })
	const a = (c.item.angle ?? 0.0) * D2R
	c.process("measure-ranger", "ping", { x: r5(c.item.x ?? 0.0), y: r5(c.item.y ?? 0.0), dx: py.pyRound(py.cos(a), 6), dy: py.pyRound(py.sin(a), 6), near: 0.15, far: r5(P.range_m) })
}
function _sensor() {
	register(new ItemType("motion-sensor", "Motion sensor", CAT, build_sensor, {
		dynamic: false, module: MODULE,
		props: [P_("range_m", "Range", 6.0, 0.5, 10.0, 0.5, "m", "Farthest it hears an echo")],
		readouts: [new Readout("distance", "Distance", { unit: "m", digits: 3 })],
		tags: ["ultrasonic", "ranger", "sonar", "distance sensor", "position", "graph", "data logger"],
		anchor: "the middle of the sensor (it faces to the right; turn it to aim)",
		description: "An ultrasonic motion sensor: it reads the distance to the nearest thing in front of it (15 cm to 6 m), " +
			"every step; a graph board can plot it.",
		source: "Ultrasonic rangers read 0.15-6 m (Vernier Motion Detector).", facts: "0.15-6 m", edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- what draws the run
function build_trail(c, P) {
	void P
	ghost(c, "tag", 0.02, 0.02, 0.002, { words: "a motion trail marker", hidden_3d: true })
}
function _trail() {
	register(new ItemType("motion-trail", "Motion trail", CAT, build_trail, {
		dynamic: false, module: MODULE,
		props: [
			P_("color", "Colour", "red", { kind: "choice", choices: COLORS }),
			P_("style", "Draws", "line", { kind: "choice", choices: ["line", "dots", "ghosts"], help: "ghosts: copies of the thing every strobe_s seconds (a motion diagram)" }),
			P_("strobe_s", "Every", 0.5, 0.05, 2.0, 0.05, "s", "Dots and ghosts: one every this many seconds"),
			P_("fade_s", "Fades after", 0.0, 0.0, 20.0, 0.5, "s", "0: the whole path stays")
		],
		links: [new Link("watch", "Follows", { help: "The moving thing whose path it draws" })],
		tags: ["trail", "path", "strobe", "motion diagram", "trace", "track", "ghost"],
		anchor: "anywhere (it is only drawn behind the thing it follows)",
		description: "Draws the path behind the linked moving thing as it goes: a line, dots or ghost copies every strobe_s seconds " +
			"(a motion diagram: wide spacing = fast). Drawn only.",
		source: "From the engine's track.", facts: "line, dots or ghosts"
	}))
}
// (machines/mod_measure.py PREFER, main_reading)
const PREFER = ["reading", "water_temp", "grams", "seconds", "meters", "speed", "newtons", "degrees", "distance", "tilt", "temp", "temp_c", "volume_ml", "level_mm"]
export function main_reading(t) {
	const ros = t in TYPES ? [...(TYPES[t].readouts ?? [])] : []
	if (!ros.length) return null
	const keys = ros.map((r) => r.key)
	let pick = null
	if (t in MAIN && keys.includes(MAIN[t][0])) pick = ros[keys.indexOf(MAIN[t][0])]
	if (pick === null) {
		const k = PREFER.find((q) => keys.includes(q))
		if (k !== undefined) pick = ros[keys.indexOf(k)]
	}
	if (pick === null) pick = ros.find((r) => truthy(r.unit)) ?? ros[0]
	return { key: pick.key, unit: pick.unit, label: pick.label, digits: pick.digits }
}
function build_board(c, P) {
	const w = P.width
	const h = P.height
	ghost(c, "board", w, h, 0.02, 0.0, h / 2, { look: "instrument face", words: "a white board on legs" })
	const names = {}
	const reads = {}
	for (const key of ["watch", "watch2", "watch3", "watch4"]) {
		const lid = TYPES[c.item.type].links.some((k) => k.key === key) ? c.link(key) : null
		if (lid !== null) {
			names[lid] = truthy(c.sb.scene_items.get(lid).name) ? c.sb.scene_items.get(lid).name : lid
			const r = main_reading(c.sb.scene_items.get(lid).type)
			if (r !== null) reads[lid] = r
		}
	}
	P.names = names
	P.reads = reads
}

// ---------------------------------------------------------------- links that name nothing: the layout's warnings (machines/mod_measure.py)
const WITHOUT = {
	"stopwatch|watch": "it times nothing and reads 0.00 s", "stopwatch|start_line": "it starts at its own start_x instead", "stopwatch|finish_line": "it stops at its own stop_x instead",
	"measuring-tape|watch": "it reads nothing", "speed-gate|watch": "it times the first thing through its beam", "speed-gate|pair": "it reads no time between gates",
	"speedometer|watch": "it reads nothing", "spring-scale|hook": "nothing hangs on its hook", "protractor|watch": "it reads nothing", "motion-trail|watch": "it draws nothing"
}
const typeName = (t) => (t in TYPES ? TYPES[t].name : String(t))
export function link_warnings(scene, doc) {
	void doc
	const items = new Map()
	for (const i of scene.items ?? []) if (i !== null && typeof i === "object" && typeof i.id === "string") items.set(i.id, i) // (the last of an id, as a Python dict keeps it)
	const out = []
	for (const it of scene.items ?? []) {
		if (it === null || typeof it !== "object" || !(it.type in TYPES) || typeof it.id !== "string") continue
		const T = TYPES[it.type]
		if (T.module !== MODULE || !T.links.length) continue
		const name = truthy(it.name) ? it.name : T.name
		const g = it.props ?? {}
		const P = props_of(it)
		const clock = it.type === "stopwatch" && P.start === "release" && (P.stop === "at" || P.stop === "never")
		let linked = 0
		for (const L of T.links) {
			const v = g[L.key]
			if (v === undefined || v === null) continue
			let why
			if (typeof v !== "string" || !v.trim()) why = "names no item"
			else if (v === it.id) why = "names itself"
			else if (!items.has(v)) why = `names "${v}", which is no item of this scene`
			else if (L.types.length && !L.types.includes(items.get(v).type)) {
				const o = items.get(v)
				const kinds = L.types.map((k) => typeName(k).toLowerCase())
				const tn = typeName(o.type).toLowerCase()
				const who = typeof o.name === "string" && o.name && o.name.toLowerCase() !== tn ? `${o.name}, a ${tn}` : `a ${tn}`
				const takes = kinds.length > 1 ? `${kinds.slice(0, -1).join(", a ")} or a ${kinds[kinds.length - 1]}` : kinds[0]
				why = `names ${who}: it takes a ${takes}`
			} else {
				linked++
				continue
			}
			const what = clock && L.key === "watch" ? "it runs as a plain clock" : WITHOUT[`${it.type}|${L.key}`] ?? "the link is left out"
			out.push({ items: [it.id], text: `${name}'s ${L.key.replace(/_/g, " ")} link ${why}, so ${what}` })
		}
		if (it.type === "stopwatch" && (g.watch === undefined || g.watch === null) && !clock) out.push({ items: [it.id], text: `${name} has no watch link (the thing it times), so it reads 0.00 s` })
		if (["motion-trail", "graph-board", "data-table"].includes(it.type) && linked === 0 && T.links.every((L) => g[L.key] === undefined || g[L.key] === null))
			out.push({ items: [it.id], text: `${name} has no linked ${it.type === "motion-trail" ? "thing" : "things"}, so it shows nothing` })
	}
	return out
}
function _boards() {
	register(new ItemType("graph-board", "Graph board", CAT, build_board, {
		dynamic: false, module: MODULE,
		props: [
			P_("plot", "Plots", "distance", { kind: "choice", choices: ["distance", "speed", "reading"], help: "distance or speed of the linked things against time, or an instrument's reading" }),
			P_("width", "Width", 1.2, 0.4, 4.0, 0.1, "m"), P_("height", "Height", 0.8, 0.3, 2.0, 0.1, "m"),
			P_("t_max", "Time axis", 0.0, 0.0, 20.0, 0.5, "s", "0: the run's length")
		],
		links: [new Link("watch", "Line 1"), new Link("watch2", "Line 2"), new Link("watch3", "Line 3")],
		tags: ["graph", "chart", "plot", "distance-time", "speed-time", "position", "data", "whiteboard"],
		anchor: "the middle of its bottom edge",
		description: "A board standing behind the scene that draws, as the run plays, the distance (from where each started) or speed " +
			"of up to three linked things against time, or a linked instrument's reading. Drawn only.",
		source: "From the engine's track and the instruments' readings.", facts: "distance-time · speed-time"
	}))
	register(new ItemType("data-table", "Data table", CAT, build_board, {
		dynamic: false, module: MODULE,
		props: [P_("width", "Width", 1.0, 0.4, 4.0, 0.1, "m"), P_("height", "Height", 0.7, 0.3, 2.0, 0.1, "m"),
			P_("title", "Title", "Results", { kind: "choice", choices: ["Results", "Trial results", "Times", "Distances", "Readings"] })],
		links: [new Link("watch", "Row 1"), new Link("watch2", "Row 2"), new Link("watch3", "Row 3"), new Link("watch4", "Row 4")],
		tags: ["table", "results", "data", "trials", "record", "fair test"],
		anchor: "the middle of its bottom edge",
		description: "A board listing the linked instruments' readings (a stopwatch's time, a tape's distance) as the run ends: a " +
			"fair test's results. Drawn only.",
		source: "The instruments' readings.", facts: "up to 4 rows"
	}))
}

// ---------------------------------------------------------------- goals (machines/mod_measure.py, number for number)
const UNIT_KEYS = [["seconds", "seconds", 0.1, "s"], ["meters", "meters", 0.05, "m"], ["mps", "speed", 0.1, "m/s"], ["newtons", "newtons", 0.1, "N"], ["grams", "grams", 10.0, "g"], ["degrees", "degrees", 1.0, "°"], ["value", null, null, ""]]
const MAIN = {
	stopwatch: ["seconds", 0.1, "s"], "measuring-tape": ["meters", 0.05, "m"], "speed-gate": ["speed", 0.1, "m/s"], speedometer: ["speed", 0.1, "m/s"],
	"spring-scale": ["newtons", 0.1, "N"], "kitchen-scale": ["grams", 10.0, "g"], "pan-balance": ["tilt", 1.0, "°"], protractor: ["degrees", 1.0, "°"],
	"motion-sensor": ["distance", 0.05, "m"]
}
export const fmt = (v) => {
	const t = py.fmtF(v, 3).replace(/0+$/, "").replace(/\.$/, "")
	return t === "" || t === "-0" ? "0" : t
}
const endReading = (ctx, iid, key) => {
	const v = ctx.state(iid, key)
	return v === null || !v.length ? null : v[v.length - 1]
}
const truthy = (v) => py.truthy(v)

export function goal_reads(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const t = ctx.items.get(iid).type
	const ros = t in TYPES ? [...(TYPES[t].readouts ?? [])] : []
	const keys = ros.map((r) => r.key)
	let want = null
	let key = null
	let tol = null
	let unit = ""
	for (const [k, field, ktol, kunit] of UNIT_KEYS) {
		const v = ctx.num(g[k])
		if (v === null) continue
		want = v
		if (field !== null && keys.includes(field)) [key, tol, unit] = [field, ktol, kunit]
		else if (typeof g.key === "string" && keys.includes(g.key)) {
			const ro = ros[keys.indexOf(g.key)]
			;[key, tol, unit] = [ro.key, null, ro.unit]
		} else if (t in MAIN) [key, tol, unit] = MAIN[t]
		else if (ros.length) [key, tol, unit] = [ros[0].key, null, ros[0].unit]
		break
	}
	if (want === null || key === null) return null
	// (a stopwatch that shows the lesson clock: its time is what its face shows, the run's seconds × the time-lapse; engine6 crossmod)
	if (key === "seconds" && t === "stopwatch" && ctx.state(iid, "lesson_s") !== null) key = "lesson_s"
	const got = endReading(ctx, iid, key)
	let tl = ctx.num(g.tol)
	if (tl === null) tl = tol !== null ? tol : Math.max(1e-9, Math.abs(want) * 0.02)
	const ok = got !== null && Math.abs(got - want) <= tl + 1e-9
	const label = truthy(g.label) ? g.label : `${ctx.name(iid)} reads ${fmt(want)}${unit ? " " + unit : ""} (± ${fmt(tl)})`
	return { label, ok, kind: "reads", item: iid, key, got: got === null ? null : py.pyRound(got, 4), want }
}

/** The make-it-work search's aim for a missed reading (web/ai/fixer.js, plugins.js GOAL KINDS aim): the setting worked out from what the run
 *  read, for the readings the timed thing's speed decides. A stopwatch that stops when the thing crosses a line or hits something reads
 *  distance / speed: the speed × got / want; one that stops after set seconds reads the metres it went, and a speed gate or a speedometer its
 *  speed: the speed × want / got. A motor car's top speed (and its start speed with it when the two are the same: already at speed at the
 *  release); a thing with only a start speed (a ball rolled off at speed), that. Two roundings (0.01 and 0.001 m/s). The search runs each
 *  like any other candidate: only what the run shows is offered. (JS only: the search is the app's.) -> [{changes, cost}] */
export function aim_reads(g, res, scene, run = null) {
	const got = Number(res?.got)
	const want = Number(res?.want)
	const items = scene?.items ?? []
	const byId = (id) => items.find((i) => i.id === id) ?? null
	// (a pan balance that should read level: its own aim, from what each pan held)
	if (byId(g?.item)?.type === "pan-balance") return Number.isFinite(got) && Math.abs(got - want) > 1e-9 ? aim_balance(g, res, scene, run, byId(g.item)) : []
	if (!Number.isFinite(got) || !Number.isFinite(want) || got <= 0 || want <= 0 || Math.abs(got - want) < 1e-9) return []
	// (a type's own props, else a catalog-wide one it takes: the mechanics module's start_speed, items.js COMMON_PROPS)
	const spec = (it, k) => {
		const t = TYPES[it?.type]
		if (!t) return null
		return (t.props ?? []).find((q) => q.key === k) ?? (F?.COMMON_PROPS ?? []).find(([q, ok]) => q.key === k && ok(t))?.[0] ?? null
	}
	const prop = (it, k) => {
		const v = it?.props?.[k]
		if (v !== undefined && v !== null) return v
		const p = spec(it, k)
		return p ? p.default : undefined
	}
	const ins = byId(g.item)
	if (!ins) return []
	let ratio = null
	if (ins.type === "stopwatch" && res.key === "seconds" && ["crosses", "hits"].includes(prop(ins, "stop"))) ratio = got / want
	else if (ins.type === "stopwatch" && res.key === "meters" && prop(ins, "stop") === "at") ratio = want / got
	else if (["speed-gate", "speedometer"].includes(ins.type) && res.key === "speed") ratio = want / got
	if (ratio === null || !(ratio > 0.2 && ratio < 5)) return []
	const it = byId(ins.props?.watch)
	if (!it) return []
	const v = Number(prop(it, "speed"))
	const s0 = Number(prop(it, "start_speed"))
	const keys = []
	if (it.type === "motor-car" && v > 0) {
		keys.push(["speed", v])
		if (s0 > 0 && Math.abs(s0 - v) < 1e-6 && spec(it, "start_speed")) keys.push(["start_speed", s0])
	} else if (s0 > 0 && spec(it, "start_speed")) keys.push(["start_speed", s0])
	if (!keys.length) return []
	const out = []
	for (const [q, cost] of [[100, 0.5], [1000, 0.6]]) {
		const changes = []
		for (const [k, v0] of keys) {
			const sp = spec(it, k)
			let to = Math.round(v0 * ratio * q) / q
			if (sp?.lo !== null && sp?.lo !== undefined) to = Math.max(sp.lo, to)
			if (sp?.hi !== null && sp?.hi !== undefined) to = Math.min(sp.hi, to)
			if (Math.abs(to - v0) < 1e-9) break
			changes.push({ kind: "prop", id: it.id, key: k, from: v0, to })
		}
		if (changes.length === keys.length && !out.some((c) => c.changes[0].to === changes[0].to)) out.push({ changes, cost })
	}
	return out
}

/** Nominal grams of a gram-mass size ("50 g" -> 50, "1 kg" -> 1000). */
const sizeGrams = (s) => parseFloat(String(s).split(" ")[0]) * (String(s).endsWith("kg") ? 1000 : 1)
/** The aim for a pan balance that should read level: the gram masses in its pans (the scene's, by where they stand: within 7 cm of a pan's
 *  middle) resized, one or two of them, so both pans hold the same grams, from what the run says each pan held (left_g, right_g): the
 *  orange that took the apple's place, 131 g against 182 g of masses: the 50 g mass and the 2 g one made 1 g each... whichever needs the
 *  fewest changes, within 0.5 g (it reads level within 0.3 g). -> [{changes, cost}] */
function aim_balance(g, res, scene, run, ins) {
	const want = Number(res?.want)
	if (!Number.isFinite(want) || Math.abs(want) > 0.5) return []
	const st = run?.track?.state?.[ins.id]
	const end = (k) => (Array.isArray(st?.[k]) && st[k].length ? Number(st[k][st[k].length - 1]) : NaN)
	const L = end("left_g")
	const R = end("right_g")
	if (!Number.isFinite(L) || !Number.isFinite(R)) return []
	const bx = Number(ins.x) || 0
	const side = (it) => (Math.abs((Number(it.x) || 0) - (bx - 0.14)) <= 0.07 ? -1 : Math.abs((Number(it.x) || 0) - (bx + 0.14)) <= 0.07 ? 1 : 0)
	const masses = (scene?.items ?? []).filter((it) => it.type === "gram-mass" && side(it) !== 0).map((it) => ({ it, s: side(it), was: it.props?.grams ?? "100 g" }))
	if (!masses.length) return []
	const sizes = Object.keys(GRAM_SIZES)
	// (what must change: the right pan's masses less the left's, by L - R grams; one, two or three of them resized, the fewest first: the
	// search drops any that changes what the person set, the thing they swapped in, so several are offered)
	const need = L - R
	const ok = []
	const walk = (from, picked, sum, depth) => {
		if (picked.length && Math.abs(need - sum) <= 0.5) ok.push({ err: Math.abs(need - sum), changes: [...picked] })
		if (depth === 0) return
		for (let i = from; i < masses.length; i++) {
			const a = masses[i]
			for (const sa of sizes) {
				if (sa === a.was) continue
				picked.push([a, sa])
				walk(i + 1, picked, sum + a.s * (sizeGrams(sa) - sizeGrams(a.was)), depth - 1)
				picked.pop()
			}
		}
	}
	walk(0, [], 0, Math.min(3, masses.length))
	ok.sort((p, q) => p.changes.length - q.changes.length || p.err - q.err)
	return ok.slice(0, 8).map((t, k) => ({ changes: t.changes.map(([m, to]) => ({ kind: "prop", id: m.it.id, key: "grams", from: m.was, to })), cost: 0.5 + 0.05 * k + 0.2 * (t.changes.length - 1) }))
}

export class Track {
	constructor(ctx) {
		this.ctx = ctx
		this.fr = ctx.frames
		this.T = ctx.times
		this.cache = new Map()
	}
	pose(k, s) {
		let p = this.fr[k].placements[s.id]
		if (p === undefined) p = this.fr[0].placements[s.id]
		if (p === undefined) return [s.at.x, s.at.y, s.angle ?? 0.0]
		return [p.x, p.y, p.angle ?? 0.0]
	}
	static span(s, pose) {
		const [x, , a] = pose
		const b = s.body
		if (b.kind === "ball") return [x - b.radius, x + b.radius]
		let pts
		if (b.kind === "polygon") pts = b.points.map((p) => [p.x, p.y])
		else {
			const hw = b.width / 2
			const hh = b.height / 2
			const hb = hw * (b.taper ?? 1.0)
			pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
		}
		const c = py.cos(a)
		const n = py.sin(a)
		let lo = Infinity
		let hi = -Infinity
		for (const [px, pyy] of pts) {
			const v = x + px * c - pyy * n
			if (v < lo) lo = v
			if (v > hi) hi = v
		}
		return [lo, hi]
	}
	series(iid) {
		if (this.cache.has(iid)) return this.cache.get(iid)
		let sol = this.ctx.solids(iid, true)
		if (!sol.length) sol = this.ctx.solids(iid)
		const lo = []
		const hi = []
		const cx = []
		for (let k = 0; k < this.fr.length; k++) {
			const ps = sol.map((s) => this.pose(k, s))
			const sp = sol.map((s, i) => Track.span(s, ps[i]))
			let a = Infinity
			let b = -Infinity
			for (const [l, h] of sp) {
				if (l < a) a = l
				if (h > b) b = h
			}
			lo.push(a)
			hi.push(b)
			cx.push(py.pySum(ps.map((p) => p[0])) / ps.length)
		}
		const out = { lo, hi, cx }
		this.cache.set(iid, out)
		return out
	}
	crossing(values, level, rising) {
		const T = this.T
		if (rising ? values[0] >= level : values[0] <= level) return T[0]
		for (let k = 1; k < T.length; k++) {
			const a = values[k - 1]
			const b = values[k]
			if (rising ? b >= level : b <= level) return b !== a ? T[k - 1] + ((level - a) * (T[k] - T[k - 1])) / (b - a) : T[k]
		}
		return null
	}
	reach(iid, X) {
		const s = this.series(iid)
		if (s.cx[0] <= X) return this.crossing(s.hi, X, true)
		return this.crossing(s.lo, X, false)
	}
	travel(iid) {
		const s = this.series(iid)
		return s.cx[s.cx.length - 1] - s.cx[0]
	}
}

/** A lane's or a line's marks as its builder wrote them in the document (a measure-mark record), or null. */
function mark_of(ctx, iid) {
	for (const r of ctx.doc.processes ?? []) if (r !== null && typeof r === "object" && r.kind === "measure-mark" && r.item === iid) return r
	return null
}
function x_of(ctx, g, key = "line") {
	const v = g[key]
	if (ctx.known(v)) {
		const r = mark_of(ctx, v)
		if (r !== null) return has(r, "finish") ? r.finish : r.x
		const it = ctx.items.get(v)
		if (typeof it.x !== "number") return null
		if (it.type === "lane") {
			const P = props_of(it)
			const gv = it.props ?? {}
			return it.x + Math.min(has(gv, "finish_at") ? gv.finish_at : P.length, P.length)
		}
		return it.x
	}
	return ctx.num(g.x)
}

export function goal_crosses(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || !ctx.solids(iid).length) return null
	const X = x_of(ctx, g)
	if (X === null) return null
	const t = new Track(ctx).reach(iid, X)
	const by = ctx.num(g.before_s)
	const after = ctx.num(g.after_s)
	const ok = t !== null && (by === null || t <= by) && (after === null || t >= after)
	const where = ctx.known(g.line) ? ctx.name(g.line) : `x = ${fmt(X)} m`
	const when = (by !== null ? ` by ${fmt(by)} s` : "") + (after !== null ? ` after ${fmt(after)} s` : "")
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} reaches ${where}${when}`, ok, kind: "crosses", item: iid, t: t === null ? null : py.pyRound(t, 3), x: py.pyRound(X, 4) }
}

export function goal_faster(ctx, g) {
	const a = g.a
	const b = g.b
	if (!(ctx.known(a) && ctx.known(b)) || a === b || !ctx.solids(a).length || !ctx.solids(b).length) return null
	const tr = new Track(ctx)
	const X = x_of(ctx, g)
	let ta
	let tb
	if (X !== null) {
		ta = tr.reach(a, X)
		tb = tr.reach(b, X)
	} else {
		const da = tr.travel(a)
		const db = tr.travel(b)
		const d = Math.min(Math.abs(da), Math.abs(db))
		if (d < 0.01) ta = tb = null
		else {
			const sa = tr.series(a)
			const sb = tr.series(b)
			ta = da > 0 ? tr.crossing(sa.cx, sa.cx[0] + d, true) : tr.crossing(sa.cx, sa.cx[0] - d, false)
			tb = db > 0 ? tr.crossing(sb.cx, sb.cx[0] + d, true) : tr.crossing(sb.cx, sb.cx[0] - d, false)
		}
	}
	let ok
	let detail
	if (ta !== null && tb !== null) {
		ok = ta < tb
		detail = `${fmt(ta)} s vs ${fmt(tb)} s`
	} else if (ta !== null || tb !== null) {
		ok = ta !== null
		detail = `${ctx.name(ta !== null ? a : b)} only`
	} else {
		ok = Math.abs(tr.travel(a)) > Math.abs(tr.travel(b)) + 0.01
		detail = "neither got there"
	}
	return { label: truthy(g.label) ? g.label : `${ctx.name(a)} is faster than ${ctx.name(b)}`, ok, kind: "faster", a, b, detail }
}

export function goal_farther(ctx, g) {
	const a = g.a
	const b = g.b
	if (!(ctx.known(a) && ctx.known(b)) || a === b || !ctx.solids(a).length || !ctx.solids(b).length) return null
	const tr = new Track(ctx)
	const da = tr.travel(a)
	const db = tr.travel(b)
	return { label: truthy(g.label) ? g.label : `${ctx.name(a)} goes farther than ${ctx.name(b)}`, ok: da >= db + 0.01, kind: "farther", a, b, a_m: py.pyRound(da, 4), b_m: py.pyRound(db, 4) }
}

export function goal_stops_between(ctx, g) {
	const iid = g.item
	const x0 = ctx.num(g.x0)
	const x1 = ctx.num(g.x1)
	if (!ctx.known(iid) || !ctx.solids(iid).length || x0 === null || x1 === null) return null
	const lo = Math.min(x0, x1)
	const hi = Math.max(x0, x1)
	const s = new Track(ctx).series(iid)
	const x = s.cx[s.cx.length - 1]
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} stops between ${fmt(lo)} and ${fmt(hi)} m`, ok: lo <= x && x <= hi, kind: "stops_between", item: iid, x: py.pyRound(x, 4) }
}


// ---------------------------------------------------------------- the AI's plug-ins (web/sim/plugins.js)
const sampleOf = (scene, types) => (scene.items ?? []).filter((i) => types.includes(i.type))
const movers = (scene) => (scene.items ?? []).filter((i) => i.type !== "table" && i.type !== "wall" && !(TYPES[i.type]?.module === MODULE && TYPES[i.type]?.dynamic === false) && TYPES[i.type]?.dynamic !== false)
// ---- what the AI reads: how the instruments work together (the catalog digest), fixed prompt lines, worked examples
const HOWTO = [
	"Instruments read the run and show their reading on their own face every frame (a stopwatch's LCD, a light gate's and a speed sign's LEDs, a kitchen scale's grams, a spring scale's pointer); after a run each one's readings are listed with the item. Their faces, painted lines, tapes, trails and boards touch nothing (display only); the spring scale's hook, the kitchen scale's platform, the pan balance and the gram masses are real things.",
	"LINKS are props naming another item by its id: stopwatch.watch (what it times), stopwatch.start_line / finish_line (a start-line, a finish-line or a lane: a lane's finish is its finish_at mark), measuring-tape.watch (whose front it reads), speed-gate.watch (+ pair: an earlier gate, to time between them), speedometer.watch, spring-scale.hook (the thing hung on its hook by a string), protractor.watch (a ramp, pendulum or lever), motion-trail.watch, graph-board.watch/watch2/watch3 (lines), data-table.watch…watch4 (instruments whose readings it lists).",
	"A lane is a long floor 1-60 m (a static board 2 cm thick) with a mark every metre (or as set), big upright metre numbers, a white start line at start_at and a chequered finish line at finish_at; its anchor is its 0 m mark on its top surface, so the d-metre mark is at x = lane.x + d and things race on y = lane.y. Two lanes one above the other (y 0.02 and 0.82, the upper one stands on legs) compare two racers without them meeting.",
	"Stopwatch: start = release (the scene's release) | moves (the watched thing has moved 1 mm) | crosses (its front reaches start_line or start_x); stop = crosses (its front reaches finish_line or stop_x) | stops (it comes to rest) | hits (it first touches something new) | at (stop_at seconds after the start) | reads (the watched thing's reading stop_reading reaches stop_value, from the side it started on: a sand timer runs out, hourglass empty 1; ice melts, ice-cube melted 1; a thermometer's reading reaches 50; a candle goes out, flame 0; a balloon pops, popped 1; any reading the thing has) | never. It reads to 0.01 s; meters = how far the thing moved while it ran. counts lesson: its face shows the lesson clock (the run's seconds × the time-lapse) and a reads goal's seconds are that. face_cm sets how big its face is drawn (a real one is 6 cm; 30-40 cm reads in a wide 12 m shot).",
	"A kitchen-scale also weighs sand heaped on its platform (granular: a funnel above it, a sand-pile on it) and liquid lying on it as a puddle (flow: a tap or a pitcher spilling onto it), at about 1 g a mL of water; what falls on it pushes it only as it rests there (a stream's own push is not added).",
	"Readings: stopwatch seconds, meters, start_s, stop_s (lesson_s with counts lesson); measuring-tape meters (0 to its length; past_end 1 beyond its end); speed-gate speed (= length / blocked time), blocked_s, between_s; speedometer speed, top, mean; spring-scale newtons, grams, over (1: past its range, its hook bottomed out 5 % past full scale); kitchen-scale grams; pan-balance tilt (degrees, right pan down +), heavier (-1 left, 0 level, 1 right), left_g and right_g (what each pan holds); protractor degrees (a ramp's slope from level, a pendulum's turn from hanging straight), swing; motion-sensor distance.",
	"Weight and mass: a kitchen-scale and a spring-scale show WEIGHT (their grams are the force ÷ the Earth's 9.81: they are calibrated on Earth), so under settings.gravity moon a 1 kg mass reads 1.62 N and 165 g (1/6), on Mars 3.71 N and 378 g; a pan-balance compares MASSES (both pans feel the same g) and reads the same anywhere: 1 kg balances 1 kg on the Moon too.",
	"A pan-balance's pans hang 14 cm either side of its middle under the beam: put a thing IN a pan with place {inside: the balance, x: balance.x - 0.14} (left) or {inside: the balance, x: balance.x + 0.14} (right), gram masses the same (they stack in the pan). It tips 1.5° for each gram of difference, up to its 15° stop (10 g or more), and reads level (heavier 0, |tilt| under 0.5°) within 0.3 g; it settles in a few swings of 2-5 s.",
	"A lane has a foam bumper on its far end (end_stop): what races past the finish stops there and stays on the lane. A stopwatch with no watch link that starts at the release and stops at stop_at (or never) is a plain clock; a link that names nothing (a wrong id, itself, the wrong kind of item) is listed in the run's warnings."
].join(" ")
const PLAN = [
	"- A race over a distance: one lane per racer (length = the distance, lane.x = 0; stacked: the bottom lane on: table (y 0.02), the next on: air at y_m = 0.82), each racer ON its lane with its FRONT at the 0 m mark at the release (a motor-car or toy-car is anchored at its middle and is 0.2 m long at defaults: x = lane.x - length/2), and one stopwatch per racer: watch = the racer, finish_line = its lane, start = release, stop = crosses, face_cm 30-40, on: air above its lane near the finish (x = lane.x + finish_at, y_m = the lane's y + 0.5). Give the plan a stage from lane.x - 1.5 to lane.x + length + 1.5 m and seconds = the slowest finish + 0.7.",
	"- A steady speed: a motor-car (props.speed m/s, push 5 N). Its wheels roll on the engine's contact skin, so it drives about 1.6 % slower than its speed setting, and from rest it needs about 0.5 s to get up to speed: for an exact time over a distance give it a start speed equal to its speed (a start_speed prop, where the catalog lists one) and speed = wanted × 1.016, or time it from a start line 1 m in (start = crosses), and add a reads goal with the time so the make-it-work search tunes the speed.",
	"- Same seconds, different distances: both stopwatches stop = at with stop_at = the seconds; a measuring-tape (or the lane's numbers) says how far each got. How far something rolls: a measuring-tape with its zero at the ramp's foot, watch = the thing.",
	"- Speed: a speed-gate on the floor (watch = the thing; its beam at the thing's mid-height) or a speedometer sign. Force: a spring-scale on: air high enough that the thing hangs 3-5 cm under the hook (hook = the thing); its range at least the thing's weight (a 2.5 N scale holds 250 g). Mass: a kitchen-scale with things resting on its platform (on: the scale), or a pan-balance with things IN its pans (place inside: the balance, x = balance.x - 0.14 for the left pan, + 0.14 for the right; never on: the balance, which sets them on its beam); gram-mass items are exact masses; a kitchen-scale's tare: true zeroes it with what rests on it at the release (a bowl, a plate), so what is dropped in later reads its own grams (an egg smashed in the bowl still reads the egg's).",
	"- On another world (settings.gravity moon / mars): a scale's goal is the weight's grams, mass × g ÷ 9.81 (1 kg on the Moon reads 165 g, 1.62 N); a pan-balance's goal stays level for equal masses.",
	"- Goals: reads {item: instrument, seconds | meters | mps | newtons | grams | degrees | value, tol}, crosses {item, line | x, before_s?}, faster {a, b, line?}, farther {a, b}, stops_between {item, x0, x1}. To show a path: a motion-trail watching the thing (style ghosts + strobe_s for a motion diagram)."
].join("\n")
const EDIT = [
	"- \"Make the red car take 4 s\" over a 10 m lane: its speed (and its start_speed, where it has one) = 10 / 4 = 2.5 m/s (× 1.016 for the tyre slip). A stopwatch's reading changes only by changing what it times or how that moves: never by moving its finish line or the lane's numbers.",
	"- When the person changes a time, a distance, a speed or when a stopwatch stops, the scene's goals that state the OLD number are now wrong: give them the new number (set_goals with every goal: a reads goal's seconds / meters and its label, a crosses goal's before_s), and make the run long enough to show it (set_scene seconds ≥ the slowest new finish + 0.7 s; the run's release counts). Keep the goals the change leaves true as they are.",
	"- \"Time it to 8 m\": finish_line unlinked and stop_x = lane.x + 8 (or the lane's finish_at = 8). \"Stop the watch at 3 s\": stop = at, stop_at = 3. \"Bigger stopwatch\": face_cm. \"Show the path\": add a motion-trail watching it. \"Time the sand timer\" (or the ice melting, the candle going out): watch = it, stop = reads with stop_reading empty (melted, flame) and stop_value 1 (1, 0), counts lesson when the scene has a time-lapse.",
	"- Two racers compared: change only the one thing asked (a fair test); keep the other racer, its lane and its stopwatch as they are.",
	"- A change to the thing being tested (a harder push, a higher ramp, a heavier load, a faster car, a different mass in a pan) changes the outcome: rewrite the goal that states the old outcome to the new expected one with set_goals (a car pushed harder stops farther: stops_between {x0: the new nearer mark, x1: a farther one}; a heavier thing in a pan tips the balance its way: reads tilt ±15). Never leave the old outcome for the make-it-work search to undo the change the person asked for.",
	"- A thing swapped in a pan for one of another mass (an orange for the apple) unbalances it: give the other pan gram masses that add up to the new thing's mass (sizes 1, 2, 5, 10, 20, 50, 100, 200, 500 g, 1 kg), or say it now tips toward the heavier."
].join("\n")
const REFINE = "- A stopwatch that reads the wrong time: check its watch, start/stop rules and its finish line before changing speeds; a stopwatch that never started had nothing reach its start (or its watched thing never moved). Instrument faces float above the lanes on poles; that is right."
const EXAMPLES = [
	{ ask: "Red car goes 10 m in 3 s, blue car 10 m in 4 s; stopwatches show it", how: "two 10 m lanes (y 0.02 and 0.82), a motor-car on each with its front at 0 m (red speed 3.39 m/s, blue 2.54 m/s, start speeds equal to those), a stopwatch per car (watch, finish_line = its lane, face_cm 40) above each lane's finish; goals reads seconds 3 and 4 (tol 0.05) and faster {red, blue}" },
	{ ask: "Same 3 seconds: which car goes farther?", how: "both stopwatches stop = at, stop_at = 3; red 3.39 m/s reaches 10 m, blue 2.71 m/s reaches 8 m in the same 3 s; a measuring-tape along each lane watching its car (or read the lane's numbers); goal farther {red, blue}" },
	{ ask: "Two balls race 10 m", how: "soccer balls on 10 m lanes, held at 0 m with a start_speed; a rolling ball slows (air drag, rolling resistance), so 10 m in 3 s needs about 3.74 m/s at the start (12 % above 10/3); reads goals let the search tune it" },
	{ ask: "A car rolls down a ramp; how far does it go?", how: "a plank ramp on a lane or the table, a toy-car at its top, a measuring-tape with its zero at the ramp's foot watching the car; a higher ramp sends it farther (goal farther between two set-ups)" },
	{ ask: "Weigh an apple with a newton meter", how: "a spring-scale (range 5 N) on: air with hook = the apple hanging 3 cm under it; it reads about 1.8 N (180 g × 9.81)" },
	{ ask: "Show that mass is kept when the clay is squashed", how: "a kitchen-scale with the clay ball on its platform; it reads the same grams before and after (reads goal on grams)" },
	{ ask: "Which is heavier, the stone or the sponge?", how: "a pan-balance with one in each pan (inside the balance at x = balance.x ∓ 0.14); it tips toward the heavier (reads goal on tilt -15 or 15)" },
	{ ask: "Does a 1 kg mass weigh less on the Moon?", how: "settings.gravity moon (air false); a kitchen-scale with a 1 kg gram-mass on it reads about 165 g (1.62 N: a scale shows weight); a pan-balance with 1 kg in each pan still balances (mass is the same); goals reads grams 165 tol 2 and reads tilt 0 tol 1" },
	{ ask: "Measure the ramp's angle", how: "a protractor at the ramp's foot with watch = the ramp; it reads the slope in degrees" },
	{ ask: "Time a ball dropped from 1 m", how: "a ball held at y 1 m, a stopwatch watch = the ball, start = release, stop = hits: about 0.45 s (√(2h/g))" },
	{ ask: "Show a speed-time graph of the car", how: "a graph-board behind the scene, plot = speed, watch = the car" },
	{ ask: "Time a one-minute sand timer with a stopwatch", how: "an hourglass on the table (its 66 g of fine sand run out in about 60 s), settings.time_lapse 4 and seconds 20 (the run shows a lesson minute in 15 s), a stopwatch with watch = the hourglass, start = release, stop = reads (stop_reading empty, stop_value 1), counts lesson; goal reads {item: stopwatch, seconds: 60, tol: 3}" },
	{ ask: "Weigh the sand a funnel pours onto a kitchen scale", how: "a kitchen-scale on the table and a sand-funnel standing on the table beside it with its spout over the platform (funnel x = scale x; its heap lands on the platform); the scale's grams rise as the heap grows, to the funnel's poured_g (goal reads {item: scale, grams: the funnel's sand_kg × 1000, tol: 5})" }
]

/** A stopwatch's start/stop rules in words. */
const ruleWords = (P, nameOf) => {
	const st = { release: "at the release", moves: "when it moves", crosses: `when it reaches ${P.start_line ? nameOf(P.start_line) : `x = ${fmt(P.start_x ?? 0)} m`}` }[P.start ?? "release"] ?? "at the release"
	const sp = { crosses: `when its front reaches ${P.finish_line ? nameOf(P.finish_line) : `x = ${fmt(P.stop_x ?? 10)} m`}`, stops: "when it stops", hits: "when it hits something", at: `after ${fmt(P.stop_at ?? 3)} s`, never: "never" }[P.stop ?? "crosses"] ?? "at its finish"
	return { st, sp }
}
const endOf = (st, k) => (Array.isArray(st?.[k]) && st[k].length ? st[k][st[k].length - 1] : null)
const nm = (sim, id) => sim?.summary?.stories?.find?.((s) => s.item === id)?.name ?? id

/** The edit step's extra lines for an item (its readings are listed by the framework already): what a stopwatch timed, a racer's lane marks. */
function digest(item, sim) {
	if (!item || typeof item.id !== "string" || !sim?.track?.frames?.length) return null
	const out = []
	const st = sim.track.state?.[item.id]
	const P = { ...(TYPES[item.type]?.defaults?.() ?? {}), ...(sim.resolved?.[item.id] ?? {}), ...(item.props ?? {}) }
	const nameOf = (id) => nm(sim, id)
	if (item.type === "stopwatch") {
		const { st: a, sp: b } = ruleWords(P, nameOf)
		const s0 = endOf(st, "start_s")
		const s1 = endOf(st, "stop_s")
		const who = typeof P.watch === "string" ? nameOf(P.watch) : "nothing (no watch link)"
		if (s0 === null) out.push(`times ${who}: it never started (starts ${a})`)
		else if (s1 === null) out.push(`times ${who}: started ${a} at ${fmt(s0)} s, still running at the end (${fmt(endOf(st, "seconds") ?? 0)} s, ${fmt(endOf(st, "meters") ?? 0)} m)`)
		else out.push(`times ${who}: started ${a} at ${fmt(s0)} s, stopped ${b} at ${fmt(s1)} s: shows ${(s1 - s0).toFixed(2)} s; it moved ${fmt(endOf(st, "meters") ?? 0)} m`)
		return out
	}
	if (item.type === "measuring-tape" && st) return [`reads ${fmt(endOf(st, "meters") ?? 0)} m: ${typeof P.watch === "string" ? nameOf(P.watch) : "nothing"}'s ${P.point ?? "front"} at the end, from its zero at x = ${fmt(item.x ?? 0)} m${endOf(st, "past_end") === 1 ? ` (past the tape's ${fmt(P.length ?? 5)} m end: a longer tape reads it)` : ""}`]
	if (item.type === "speed-gate" && st) return endOf(st, "speed") !== null ? [`timed ${typeof P.watch === "string" ? nameOf(P.watch) : "the first thing through"}: blocked ${fmt(endOf(st, "blocked_s"))} s from ${fmt(endOf(st, "entered_s"))} s: ${fmt(endOf(st, "speed"))} m/s`] : ["nothing passed its beam"]
	if (item.type === "pan-balance" && st) {
		const h = endOf(st, "heavier")
		const lg = endOf(st, "left_g")
		const rg = endOf(st, "right_g")
		const pans = lg !== null && rg !== null ? `; the left pan holds ${fmt(lg)} g, the right ${fmt(rg)} g` : ""
		return [(h === 0 ? "level: the pans hold the same mass" : `tips toward the ${h < 0 ? "left" : "right"} pan (${fmt(Math.abs(endOf(st, "tilt") ?? 0))}°): it holds more mass`) + pans]
	}
	if (item.type === "spring-scale" && st) {
		const g = sim.doc?.settings?.gravity
		const bits = [`reads ${fmt(endOf(st, "newtons") ?? 0)} N (${fmt(Math.round(endOf(st, "grams") ?? 0))} g as a weight on Earth's scale)`]
		if (endOf(st, "over") === 1) bits.push("over its range: its hook bottomed out (a stronger scale reads it)")
		if (typeof g === "number" && Math.abs(g - G) > 1e-9) bits.push(`gravity here is ${fmt(g)} m/s², so it shows ${fmt(g / G)} of the Earth weight`)
		return [bits.join("; ")]
	}
	if (item.type === "kitchen-scale" && st) {
		const g = sim.doc?.settings?.gravity
		const bits = [`reads ${fmt(Math.round(endOf(st, "grams") ?? 0))} g`]
		if (endOf(st, "over") === 1) bits.push(`over its capacity (${fmt(P.capacity_kg ?? 5)} kg)`)
		if (typeof g === "number" && Math.abs(g - G) > 1e-9) bits.push(`it shows weight: gravity here is ${fmt(g)} m/s², so a mass reads ${fmt(g / G)} of its grams`)
		return [bits.join("; ")]
	}
	// a racer on a lane: when its front crossed the lane's marks
	const lanes = (sim.doc?.solids ?? []).filter((x) => x.itemType === "lane" && x.part === "floor")
	const mine = (sim.doc?.solids ?? []).filter((x) => x.item === item.id && x.kind === "dynamic")
	if (!lanes.length || !mine.length) return out.length ? out : null
	const fr = sim.track.frames
	const at = (k, x) => fr[k].placements[x.id] ?? fr[0].placements[x.id]
	const front = (k) => {
		let hi = -Infinity
		for (const x of mine) {
			const p = at(k, x)
			if (!p) continue
			const r = x.body.kind === "ball" ? x.body.radius : x.body.kind === "slab" ? Math.hypot(x.body.width, x.body.height) / 2 : Math.max(...x.body.points.map((q) => Math.hypot(q.x, q.y)))
			hi = Math.max(hi, p.x + (x.body.kind === "ball" ? r : Track.span(x, [p.x, p.y, p.angle ?? 0])[1] - p.x))
		}
		return hi
	}
	const p0 = at(0, mine[0])
	const lane = lanes.find((l) => Math.abs(l.at.y + l.body.height / 2 - (p0?.y ?? 0)) < 0.25 && p0 && p0.x >= l.at.x - l.body.width / 2 && p0.x <= l.at.x + l.body.width / 2)
	if (!lane) return out.length ? out : null
	const lp = sim.resolved?.[lane.item] ?? {}
	const L = Number(lp.length) || lane.body.width
	const zero = lane.at.x - L / 2
	const stepM = L <= 12 ? (L <= 5 ? 1 : 2) : Math.ceil(L / 6)
	const marks = []
	for (let d = stepM; d <= L + 1e-6; d += stepM) marks.push(d)
	if (marks[marks.length - 1] !== L) marks.push(L)
	const times = marks.map((d) => {
		const X = zero + d
		for (let k = 1; k < fr.length; k++) {
			const a = front(k - 1)
			const b = front(k)
			if (b >= X && a < X) return fr[k - 1].t + ((X - a) * (fr[k].t - fr[k - 1].t)) / (b - a)
		}
		return null
	})
	const crossed = marks.filter((_, i) => times[i] !== null)
	const endM = front(fr.length - 1) - zero
	out.push(`on ${nameOf(lane.item)} (0 m at x = ${fmt(zero)}): ${crossed.length ? `its front crossed ${crossed.map((d) => fmt(d)).join("/")} m at ${times.filter((t) => t !== null).map((t) => t.toFixed(2)).join("/")} s` : "it crossed no metre mark"}; its front ends at ${fmt(endM)} m`)
	return out
}

/** Change lines in real units for the module's props. */
function change(type, key, a, b, nameOf) {
	const n = (v) => (typeof v === "number" ? fmt(v) : String(v))
	if (type === "stopwatch") {
		if (key === "watch") return `times ${b ? nameOf(b) : "nothing"} instead of ${a ? nameOf(a) : "nothing"}`
		if (key === "finish_line") return `stops at ${b ? nameOf(b) : "its own stop_x"} instead of ${a ? nameOf(a) : "its own stop_x"}`
		if (key === "start_line") return `starts at ${b ? nameOf(b) : "its own start_x"} instead of ${a ? nameOf(a) : "its own start_x"}`
		if (key === "stop") return `stops ${{ crosses: "at its finish line", stops: "when the thing stops", hits: "when it hits something", at: "after set seconds", never: "never" }[b] ?? b} (was ${{ crosses: "at its finish line", stops: "when it stops", hits: "when it hits something", at: "after set seconds", never: "never" }[a] ?? a})`
		if (key === "start") return `starts ${{ release: "at the release", moves: "when the thing moves", crosses: "at the start line" }[b] ?? b} (was ${{ release: "at the release", moves: "when it moves", crosses: "at the start line" }[a] ?? a})`
		if (key === "stop_at") return `stops after ${n(b)} s instead of ${n(a)} s`
		if (key === "stop_x") return `its finish x ${n(a)} → ${n(b)} m`
		if (key === "face_cm") return `face ${n(a)} → ${n(b)} cm`
		if (key === "reaction_s") return `hand timing delay ${n(a)} → ${n(b)} s`
	}
	if (type === "lane") {
		if (key === "length") return `the lane ${n(a)} m → ${n(b)} m`
		if (key === "finish_at") return `its finish line at ${n(b)} m (was ${n(a)} m)`
		if (key === "start_at") return `its start line at ${n(b)} m (was ${n(a)} m)`
		if (key === "label_cm") return `its numbers ${n(a)} → ${n(b)} cm tall`
		if (key === "marks_every") return `marks every ${b} (was ${a})`
		if (key === "end_stop") return b ? "a foam bumper on its far end" : "no bumper on its far end"
	}
	if (type === "pan-balance" && key === "damping") return `its beam's damping ${n(a)} → ${n(b)} N·m·s`
	if (type === "measuring-tape" && key === "length") return `the tape ${n(a)} → ${n(b)} m`
	if (type === "spring-scale" && key === "range") return `a ${b} scale instead of ${a} (its spring stretches 10 cm at full scale)`
	if (type === "spring-scale" && key === "hook") return `hangs ${b ? nameOf(b) : "nothing"} (was ${a ? nameOf(a) : "nothing"})`
	if (["measuring-tape", "speed-gate", "speedometer", "protractor", "motion-trail"].includes(type) && key === "watch") return `${type === "motion-trail" ? "follows" : "reads"} ${b ? nameOf(b) : "nothing"} instead of ${a ? nameOf(a) : "nothing"}`
	if (type === "gram-mass" && key === "grams") return `${a} → ${b}`
	return null
}

export const plugin = {
	title: "Measuring: lanes, stopwatches, tapes, scales and gauges",
	howto: HOWTO,
	prompt: { plan: PLAN, edit: EDIT, refine: REFINE },
	examples: EXAMPLES,
	digest,
	words: {
		change,
		// (requests that need an instrument though their words are everyday ones: "time it", "how many seconds", "how far did it roll")
		picks: "\\btim(?:e|es|ed|ing)\\s+(?:it|them|the|how|each|both|a|its|their)\\b|\\btimers?\\b|\\bstop\\s*watch|\\bhow\\s+(?:many|long)\\s+(?:seconds?|minutes?|metres?|meters?|cm|centimet\\w*)\\b|\\b(?:seconds?|metres?|meters?)\\s+(?:it|they)\\s+(?:take|takes|took|goes|went|rolls?|rolled)\\b|\\bhow\\s+far\\b|\\bhow\\s+fast\\b|\\bmeasur\\w*\\s+(?:the\\s+|its\\s+|how\\s+)?(?:time|distance|speed|far|fast|long|mass|weight|force)|\\bweigh(?:s|ed|ing)?\\b|\\bnewtons?\\b|\\bgrams?\\b",
		// (a change to the thing being tested changes the outcome a goal states: such an edit may rewrite the goals; web/sim/plugins.js moduleRegoals)
		regoals: "(?:harder|softer|stronger|weaker|gentler|bigger|smaller)\\s+(?:push|shove|kick|motor|launch)|push\\w*\\s+(?:\\w+\\s+){0,3}(?:harder|softer|more|less)|(?:higher|lower|steeper|taller|shorter|longer)\\s+ramp|ramp\\s+(?:\\w+\\s+){0,2}(?:higher|lower|steeper)|(?:raise|lower)\\w*\\s+(?:the\\s+)?ramp|(?:heavier|lighter)\\s+(?:load|car|cart|truck|ball|thing)|(?:faster|slower)\\s+(?:car|ball|cart|truck|racer)"
	},
	goals: [
		{
			kind: "reads",
			aliases: ["read", "reading", "shows", "measures"],
			fields: { item: "item", value: "number?", seconds: "number?", meters: "number?", mps: "number?", newtons: "number?", grams: "number?", degrees: "number?", key: "string?", tol: "number?" },
			subject: ["item"],
			about: "reads {item: an instrument, seconds | meters | mps | newtons | grams | degrees | value, key?, tol?}: the instrument's reading at the end is within tol of the number (a stopwatch's time, a tape's metres, a gate's speed, a scale's grams; any module's instrument by value)",
			label: (g, n) => `${n(g.item)} reads ${g.seconds ?? g.meters ?? g.mps ?? g.newtons ?? g.grams ?? g.degrees ?? g.value}`,
			summarize: (ctx, g) => goal_reads(ctx, g),
			aim: (g, res, scene, run) => aim_reads(g, res, scene, run),
			sample: (scene, pick) => {
				const ins = sampleOf(scene, Object.keys(MAIN))
				return ins.length ? { kind: "reads", item: pick(ins).id, value: pick([0, 1, 3, 10]), tol: pick([0.05, 0.5]) } : null
			}
		},
		{
			kind: "crosses",
			aliases: ["reaches", "crosses_line", "finishes", "reach"],
			fields: { item: "item", line: "item?", x: "number?", before_s: "number?", after_s: "number?" },
			subject: ["item"],
			about: "crosses {item, line (a start-line / finish-line / lane: its finish mark) | x (m), before_s?, after_s?}: the thing's front reaches that line (within the times)",
			label: (g, n) => `${n(g.item)} reaches ${g.line ? n(g.line) : `x = ${g.x} m`}`,
			summarize: (ctx, g) => goal_crosses(ctx, g),
			sample: (scene, pick) => {
				const m = movers(scene)
				return m.length ? { kind: "crosses", item: pick(m).id, x: pick([0.5, 2, 10]) } : null
			}
		},
		{
			kind: "faster",
			aliases: ["quicker", "beats", "wins"],
			fields: { a: "item", b: "item", line: "item?", x: "number?" },
			subject: ["a", "b"],
			about: "faster {a, b, line? | x?}: a is faster than b (gets to the line, or over the same distance, sooner)",
			label: (g, n) => `${n(g.a)} is faster than ${n(g.b)}`,
			summarize: (ctx, g) => goal_faster(ctx, g),
			sample: (scene, pick) => {
				const m = movers(scene)
				return m.length > 1 ? { kind: "faster", a: m[0].id, b: m[1].id } : null
			}
		},
		{
			kind: "farther",
			aliases: ["further", "goes_farther", "rolls_farther"],
			fields: { a: "item", b: "item" },
			subject: ["a", "b"],
			about: "farther {a, b}: a ends at least 1 cm farther along +x from where it started than b",
			label: (g, n) => `${n(g.a)} goes farther than ${n(g.b)}`,
			summarize: (ctx, g) => goal_farther(ctx, g),
			sample: (scene, pick) => {
				const m = movers(scene)
				return m.length > 1 ? { kind: "farther", a: m[1].id, b: m[0].id } : null
			}
		},
		{
			kind: "stops_between",
			aliases: ["stops_at", "ends_between", "lands_between"],
			fields: { item: "item", x0: "number", x1: "number" },
			subject: ["item"],
			about: "stops_between {item, x0, x1}: the thing's middle ends between x0 and x1 (m)",
			label: (g, n) => `${n(g.item)} stops between ${g.x0} and ${g.x1} m`,
			summarize: (ctx, g) => goal_stops_between(ctx, g),
			sample: (scene, pick) => {
				const m = movers(scene)
				return m.length ? { kind: "stops_between", item: pick(m).id, x0: 0, x1: pick([1, 5, 12]) } : null
			}
		}
	],
	knobs: [
		{ type: "motor-car", key: "speed", how: "abs", steps: [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1], more: "speed {it} up", less: "slow {it} down", why: "a motor car's top speed (m/s): faster crosses a line sooner and goes farther in the same seconds (time = distance / speed; it drives about 1.6 % under the setting)" },
		{ type: "motor-car", key: "push", how: "rel", cost: 2, more: "give {it} a stronger motor", less: "give {it} a weaker motor", why: "how hard its motor pushes (N): more gets it up to speed sooner, up to what its tyres can grip" },
		{ type: "lane", key: "finish_at", how: "abs", steps: [0.1, 0.25, 0.5, 1, 2], cost: 4, more: "move {it}'s finish line further", less: "move {it}'s finish line nearer", why: "where the race ends: a longer race takes longer (change it only when the request leaves the distance open)" },
		{ type: "stopwatch", key: "stop_at", how: "abs", steps: [0.1, 0.25, 0.5, 1], cost: 4, more: "stop {it} later", less: "stop {it} sooner", why: "for a watch that stops after set seconds: a later stop lets the thing go farther" },
		{ type: "speed-gate", key: "beam_height", how: "m", cost: 2, more: "raise {it}'s beam", less: "lower {it}'s beam", why: "the beam must cross the thing's body to see it pass" },
		{ type: "spring-scale", key: "range", how: "choice", cost: 2, more: "use a stronger scale", less: "use a weaker scale", why: "a stiffer spring holds a heavier thing without running off its scale (it stretches 10 cm at full scale)" },
		{ type: "kitchen-scale", key: "tare", how: "bool", cost: 3, more: "zero {it} at the start", less: "do not zero {it}", why: "taring takes off what was on it at the release" },
		{ type: "pan-balance", key: "damping", how: "rel", cost: 2, more: "damp {it} more", less: "damp {it} less", why: "a damped beam settles sooner instead of rocking" },
		{ type: "gram-mass", key: "grams", how: "choice", cost: 2, more: "use a heavier mass for {it}", less: "use a lighter mass for {it}", why: "a brass mass's size (1 g to 1 kg, exact): a pan balance levels when both pans hold the same grams; a scale reads it" }
	],
	place: {
		// (a pan balance's inside: both pans, 14 cm either side of its middle, at the pans' top 13 cm up; the rim (20 cm) is under its beam, so
		// the solver sets things down in a pan, never on the beam: the solver keeps them between x0 and x1, at the x the plan gives)
		containers: ["pan-balance"],
		interior: (type) => (type === "pan-balance" ? { x0: -0.2, x1: 0.2, floor: 0.13, rim: 0.2 } : null)
	}
}
