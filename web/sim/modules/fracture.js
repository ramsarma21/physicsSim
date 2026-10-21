// The fracture module's port (machines/mod_fracture.py, line for line: the same documents, number for number) and its plug-ins for the AI
// (goal kinds, digest, knobs, prompts, change words). A module file takes everything from the framework object register_all gets
// (web/sim/items.js FRAMEWORK), so it imports nothing. See the Python file for the items, the rules and the sources.
let F = null
let py = null
let register, ItemType, Prop, Readout, register_build_hook, MATERIALS, add_look, CATEGORIES, LOOK_FILL, TYPES, define_material, props_of

const CAT = "Breaking & padding"
const MODULE = "fracture"
const SQ2 = Math.sqrt(2.0)
const C45 = Math.sqrt(0.5)
const OUT8 = 2.0 / Math.sqrt(2.0 + SQ2)

const CUSHIONS = {
	foam: [1, 4000.0, 0.4, 0.8],
	"packing foam": [1, 100000.0, 0.1, 0.75],
	"bubble wrap": [2, 55700.0, 0.0, 0.0],
	"cotton balls": [3, 150.0, 0.0, 0.0],
	"pillow stuffing": [3, 230.0, 0.0, 0.0],
	"crumpled paper": [3, 1000.0, 0.0, 0.0],
	"folded towel": [3, 3000.0, 0.0, 0.0],
	carpet: [3, 6600.0, 0.0, 0.0],
	"rubber mat": [4, 3000000.0, 0.5, 0.0]
}
const PADS = ["foam", "packing foam", "bubble wrap", "cotton balls", "pillow stuffing", "crumpled paper", "folded towel", "carpet"]
const BOX_PADS = ["none", "foam", "bubble wrap", "cotton balls", "crumpled paper", "pillow stuffing", "packing foam"]

const EGG_L = 0.057
const EGG_W = 0.044
const EGG_M = 0.057
const EGG_K = 21500.0
const EGG_LIMIT = 35.0
const SHELL_SHARE = 0.11
const GLASS_K = 1500000.0
const GLASS_LIMIT = 1840.0
const GLASS_M = 0.25
const PLATE_K = 2000000.0
const PLATE_LIMIT = 2470.0
const PLATE_M = 0.45
const BOX_K = 50000.0
const BOARD = 0.45
const CHUTE_CD = 0.8
const CHUTE_AREAL = 0.03
const EDGE = 0.5
const TRUE_DENSITY = { "raw-egg": 1080.0, "drinking-glass": 2500.0, "ceramic-plate": 2400.0 }
const PANE_E = 72000000000.0
const PANE_NU = 0.22
const PANE_SIGMA = 82000000.0
const PANE_R0 = 0.005

const BEAMS = {
	spaghetti: ["round", 0.00175, 0.00175, 36000000.0, 4100000000.0, "dry pasta"],
	"craft sticks": ["rect", 0.01, 0.002, 85000000.0, 11000000000.0, "birch"],
	chalk: ["round", 0.01, 0.01, 3000000.0, 2000000000.0, "chalk"],
	"chocolate bar": ["rect", 0.035, 0.008, 2500000.0, 400000000.0, "milk chocolate"]
}
const BEAM_REST = 0.02
const BEAM_PIECES = 6
const BLOCK_GAP = 0.001
const PARKED = 0.001

const GLUES = { "sticky tack": [10000.0, 10000.0], "glue stick": [200000.0, 200000.0], "white glue": [3000000.0, 6000000.0] }
const GLUE_NAMES = ["none", "sticky tack", "tape", "glue stick", "white glue"]

export function register_all(f) {
	F = f
	py = f.py
	;({ register, ItemType, Prop, Readout, register_build_hook, MATERIALS, add_look, CATEGORIES, LOOK_FILL, TYPES, define_material, props_of } = f)
	if (!CATEGORIES.includes(CAT)) CATEGORIES.push(CAT)
	_looks()
	_materials()
	_egg()
	_glass()
	_plate()
	_cushion()
	_box()
	_bridge()
	_tower()
	_pane()
	register_build_hook(soft_table)
}

const r5 = (v) => py.pyRound(v, 5)
/** ln x from + − × ÷ and square roots (machines/mod_fracture.py _ln: the same bits). */
function _ln(x0) {
	let x = x0
	if (!(x > 0)) return 0.0
	let k = 0
	while ((x > 1.1 || x < 0.9) && k < 64) {
		x = Math.sqrt(x)
		k += 1
	}
	const z = (x - 1) / (x + 1)
	const z2 = z * z
	let total = 0.0
	let term = z
	for (let n = 1; n < 26; n += 2) {
		total += term / n
		term *= z2
	}
	let out = 2 * total
	for (let i = 0; i < k; i++) out *= 2
	return out
}
const given = (c) => c.item.props ?? {}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const nameOf = (c) => (py.truthy(c.item.name) ? c.item.name : TYPES[c.item.type].name)

function _mat(name, kw) {
	if (!(name in MATERIALS)) define_material(name, { rolling: 0.0, side: 0.0, ...kw }, ["density"])
}

function _looks() {
	for (const [key, kw] of [
		["packing foam", { fill: "#f4f4ee", shade: "#d6d6cc", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 }],
		["bubble wrap", { fill: "#dfeef2", shade: "#aac4cc", roughness: 0.15, metalness: 0.0, clearcoat: 0.6, transmission: 0.6 }],
		["cotton", { fill: "#fbfbf7", shade: "#e2e2da", roughness: 1.0, metalness: 0.0, clearcoat: 0.0 }],
		["fiberfill", { fill: "#f6f6f2", shade: "#dcdcd4", roughness: 1.0, metalness: 0.0, clearcoat: 0.0 }],
		["crumpled paper", { fill: "#ece8dc", shade: "#c9c3b2", roughness: 0.95, metalness: 0.0, clearcoat: 0.0 }],
		["towel", { fill: "#7fb3d5", shade: "#5a8fb2", roughness: 1.0, metalness: 0.0, clearcoat: 0.0 }],
		["egg yolk", { fill: "#f2b632", shade: "#d9951a", roughness: 0.25, metalness: 0.0, clearcoat: 0.8 }],
		["pasta", { fill: "#f0d68a", shade: "#cfae5c", roughness: 0.55, metalness: 0.0, clearcoat: 0.1 }],
		["chalk", { fill: "#f7f6f0", shade: "#d8d6cc", roughness: 1.0, metalness: 0.0, clearcoat: 0.0 }],
		["chocolate", { fill: "#6b4226", shade: "#4a2b17", roughness: 0.45, metalness: 0.0, clearcoat: 0.2 }],
		["birch", { fill: "#e8d3a8", shade: "#c9b07f", roughness: 0.7, metalness: 0.0, clearcoat: 0.0 }],
		["ceramic", { fill: "#f5f3ee", shade: "#d3cfc5", roughness: 0.2, metalness: 0.0, clearcoat: 0.8 }]
	])
		if (!(key in LOOK_FILL)) add_look(key, kw)
}

function _materials() {
	_mat("packing foam", { density: 17, bounce: 0.3, friction: 0.6, look: "packing foam", source: "Expanded polystyrene EPS 100, about 17 kg/m³, 100 kPa at 10 % (EN 13163 CS(10)100). Bounce and friction provisional." })
	_mat("bubble wrap", { density: 9, bounce: 0.5, friction: 0.5, look: "bubble wrap", source: "Polyethylene film with 10 mm air bubbles, about 9 kg/m³ in bulk; trapped air squashes by Boyle's law. Bounce and friction provisional." })
	_mat("cotton balls", { density: 40, bounce: 0.05, friction: 0.8, look: "cotton", source: "Loose cotton wool about 40 kg/m³; fibres squash by van Wyk's law (J. Textile Inst. 37, 1946): provisional." })
	_mat("pillow stuffing", { density: 20, bounce: 0.1, friction: 0.8, look: "fiberfill", source: "Polyester fiberfill about 20 kg/m³ in a pillow; fibres squash by van Wyk's law: provisional." })
	_mat("crumpled paper", { density: 30, bounce: 0.2, friction: 0.6, look: "crumpled paper", source: "Loosely crumpled newspaper about 30 kg/m³: provisional." })
	_mat("folded towel", { density: 150, bounce: 0.05, friction: 0.9, look: "towel", source: "A folded cotton terry towel about 150 kg/m³: provisional." })
	_mat("egg insides", { density: 1035, bounce: 0.0, friction: 1.0, look: "egg yolk", source: "Egg white and yolk about 1.03-1.04 kg/L; a spill does not bounce or slide." })
	_mat("dry pasta", { density: 1450, bounce: 0.3, friction: 0.4, look: "pasta", source: "Dry durum-wheat pasta about 1450 kg/m³ [PASTA]. Bounce and friction provisional." })
	_mat("chalk", { density: 1400, bounce: 0.2, friction: 0.5, look: "chalk", source: "School chalk (calcium sulfate / carbonate) about 1400 kg/m³: provisional." })
	_mat("milk chocolate", { density: 1270, bounce: 0.1, friction: 0.5, look: "chocolate", source: "Milk chocolate about 1270 kg/m³: provisional." })
	_mat("birch", { density: 600, bounce: 0.6, friction: 0.4, look: "birch", source: "Paper birch about 600 kg/m³ at 12 % moisture (Wood Handbook FPL-GTR-190 table 5-3a)." })
}

function _area(pts) {
	let a = 0.0
	const n = pts.length
	for (let k = 0; k < n; k++) {
		const [x1, y1] = pts[k]
		const [x2, y2] = pts[(k + 1) % n]
		a += x1 * y2 - x2 * y1
	}
	return a / 2
}

function _clip(pts, a, b, c) {
	const out = []
	const n = pts.length
	for (let k = 0; k < n; k++) {
		const [x1, y1] = pts[k]
		const [x2, y2] = pts[(k + 1) % n]
		const d1 = a * x1 + b * y1 - c
		const d2 = a * x2 + b * y2 - c
		if (d1 <= 0) out.push([x1, y1])
		if (d1 <= 0 !== d2 <= 0) {
			const u = d1 / (d1 - d2)
			out.push([x1 + u * (x2 - x1), y1 + u * (y2 - y1)])
		}
	}
	const clean = []
	for (const [x, y] of out) {
		const p = [r5(x), r5(y)]
		if (!clean.length || clean[clean.length - 1][0] !== p[0] || clean[clean.length - 1][1] !== p[1]) clean.push(p)
	}
	if (clean.length > 1 && clean[0][0] === clean[clean.length - 1][0] && clean[0][1] === clean[clean.length - 1][1]) clean.pop()
	return clean
}

const _rounded = (pts) => pts.map(([x, y]) => [r5(x), r5(y)])

function _egg_points(L, W) {
	const a = (L / 2) * OUT8
	const b = (W / 2) * OUT8
	const s = C45
	return _rounded([
		[a, 0.0], [s * a, s * b * (1 - 0.08 * s)], [0.0, b], [-(s * a), s * b * (1 + 0.08 * s)], [-a, 0.0],
		[-(s * a), -(s * b * (1 + 0.08 * s))], [0.0, -b], [s * a, -(s * b * (1 - 0.08 * s))]
	])
}

function _readouts_brittle(what) {
	return [
		new Readout("broken", "Broken", { unit: "", digits: 0, help: `0 whole, 1 cracked, 2 in pieces (${what})`, words: { 0: "whole", 1: "cracked", 2: "in pieces" } }),
		new Readout("peak_force", "Biggest force", { unit: "N", digits: 1, help: "The largest force it has felt: an impact's peak, or a steady load" }),
		new Readout("share", "Of its breaking force", { unit: "×", digits: 2, help: "The biggest force over the force that breaks it (1 or more: it broke)" }),
		new Readout("impact_speed", "Hardest hit", { unit: "m/s", digits: 2, help: "The speed of its hardest impact" })
	]
}

// ---------------------------------------------------------------- raw egg
function _egg() {
	register(new ItemType("raw-egg", "Raw egg", CAT, build_raw_egg, {
		module: MODULE,
		props: [
			new Prop("length", "Length", EGG_L, 0.03, 0.1, 0.001, "m"), new Prop("width", "Width", EGG_W, 0.02, 0.08, 0.001, "m"),
			new Prop("mass", "Weight", EGG_M, 0.01, 0.3, 0.001, "kg", "Follows the size until you type a weight", { auto: ["length", "width"] }),
			new Prop("strength", "Breaks at", EGG_LIMIT, 5.0, 200.0, 1.0, "N", "The force that cracks its shell: hen eggs 30-40 N")
		],
		readouts: _readouts_brittle("an egg cracks, then smashes when hit twice as hard"),
		tags: ["egg", "raw egg", "fragile", "breakable", "egg drop", "crack", "shell"], anchor: "its centre",
		description: "A raw hen's egg that breaks: it cracks when a force on it passes its breaking force (35 N: dropped about 5 cm onto a " +
			"hard floor) and smashes into shell pieces and a spill when hit twice as hard. Padding under it (a cushion, a pillow) " +
			"lets it fall much farther.",
		source: "35 N quasi-static breaking force (Mendel University); cracks at a 1.0 m/s impact on a rigid floor (Trnka et al.).",
		facts: "57 g · cracks at 35 N (a 5 cm drop on a hard floor)", edit: [{ kind: "rotate" }]
	}))
}

function build_raw_egg(c, P) {
	const g = given(c)
	const L = P.length
	const W = P.width
	if (!has(g, "mass")) P.mass = (EGG_M * (L * W * W)) / (EGG_L * EGG_W * EGG_W)
	const m = P.mass
	const pts = _egg_points(L, W)
	const depth = r5(W)
	const a = _area(pts)
	const left = pts.slice(2, 7)
	const right = [pts[6], pts[7], pts[0], pts[1], pts[2]]
	const h = 0.004
	const spill = _rounded([[-0.4 * L, -h], [0.4 * L, -h], [0.4 * L, h], [-0.4 * L, h]])
	const al = _area(left)
	const ar = _area(right)
	const masses = [py.pyRound((SHELL_SHARE * m * al) / (al + ar), 6), py.pyRound((SHELL_SHARE * m * ar) / (al + ar), 6), py.pyRound((1 - SHELL_SHARE) * m, 6)]
	const sid = c.poly("egg", pts, depth, 0.0, 0.0, { material: c.mat({ base: "eggshell", density: py.pyRound(m / (a * depth), 6), overrides: {} }), look: "eggshell", words: "a raw hen's egg" })
	const s1 = c.poly("shell-1", left, depth, 0.0, 0.0, { material: c.mat({ base: "eggshell", density: PARKED, overrides: {} }), look: "eggshell", words: "a broken piece of eggshell", kind: "dynamic" })
	const s2 = c.poly("shell-2", right, depth, 0.0, 0.0, { material: c.mat({ base: "eggshell", density: PARKED, overrides: {} }), look: "eggshell", words: "a broken piece of eggshell", kind: "dynamic" })
	const sp = c.poly("spill", spill, depth, 0.0, 0.0, { material: c.mat({ base: "egg insides", density: PARKED, overrides: {} }), look: "egg yolk", words: "a spilled raw egg", kind: "dynamic" })
	c.process("fracture-brittle", "break", {
		solid: sid, mode: "free", name: nameOf(c), noun: "shell", verb: "smashes", mass: py.pyRound(m, 6),
		limit: P.strength, k: EGG_K, radius: r5(W / 2), area: 0.0, smash: 2.0, scatter: 0.15, pieces: [s1, s2, sp], masses, puddle: sp
	})
}

// ---------------------------------------------------------------- drinking glass
function _glass() {
	register(new ItemType("drinking-glass", "Drinking glass", CAT, build_glass, {
		module: MODULE,
		props: [
			new Prop("diameter", "Width at the rim", 0.075, 0.04, 0.15, 0.001, "m"), new Prop("height", "Height", 0.1, 0.05, 0.25, 0.001, "m"),
			new Prop("mass", "Weight", GLASS_M, 0.02, 2.0, 0.005, "kg", "Follows the size until you type a weight", { auto: ["diameter", "height"] }),
			new Prop("strength", "Breaks at", GLASS_LIMIT, 100.0, 20000.0, 10.0, "N",
				"The impact force that shatters it: an annealed tumbler about 1840 N (a 46 cm drop bottom-first onto a hard floor)")
		],
		readouts: _readouts_brittle("a glass shatters at once"),
		tags: ["glass", "tumbler", "cup", "fragile", "breakable", "shatter", "glassware"], anchor: "the middle of its bottom",
		description: "An annealed glass tumbler that shatters into shards when an impact's force passes its breaking force: dropped bottom-first " +
			"onto a hard floor from above about 46 cm; a carpet or a cushion saves it from higher.",
		source: "Annealed soda-lime glass, modulus of rupture 41 MPa (Pilkington ATS-129); breaking force a calibration (see machines/mod_fracture.py).",
		facts: "250 g · shatters from about a 46 cm drop onto a hard floor"
	}))
}

function _glass_outline(d, h) {
	const bw = 0.84 * d
	return _rounded([[-(bw / 2), 0.0], [bw / 2, 0.0], [d / 2, h], [-(d / 2), h]])
}

function build_glass(c, P) {
	const g = given(c)
	const d = P.diameter
	const h = P.height
	if (!has(g, "mass")) P.mass = (GLASS_M * (d * h + (d * d) / 4)) / (0.075 * 0.1 + (0.075 * 0.075) / 4)
	const m = P.mass
	const pts = _glass_outline(d, h)
	const depth = r5(d)
	const rho = py.pyRound(m / (_area(pts) * depth), 6)
	const mat = c.mat({ base: "glass", density: rho, overrides: {} })
	const sid = c.poly("glass", pts, depth, 0.0, 0.0, { material: mat, look: "glass", words: "a drinking glass" })
	const low = _clip(pts, 0.0, 1.0, 0.2 * h)
	const up = _clip(pts, 0.0, -1.0, -(0.2 * h))
	const cuts = [
		low, _clip(_clip(up, 1.0, 0.0, 0.0), 0.0, 1.0, 0.6 * h), _clip(_clip(up, -1.0, 0.0, 0.0), 0.0, 1.0, 0.6 * h),
		_clip(_clip(up, 1.0, 0.0, 0.0), 0.0, -1.0, -(0.6 * h)), _clip(_clip(up, -1.0, 0.0, 0.0), 0.0, -1.0, -(0.6 * h))
	]
	const parked = c.mat({ base: "glass", density: PARKED, overrides: {} })
	const pieces = cuts.map((q, k) => c.poly(`shard-${k + 1}`, q, depth, 0.0, 0.0, { material: parked, look: "glass", words: "a shard of broken glass", kind: "dynamic" }))
	const whole = _area(pts)
	const masses = cuts.map((q) => py.pyRound((m * _area(q)) / whole, 6))
	const bw = 0.84 * d
	c.process("fracture-brittle", "break", {
		solid: sid, mode: "free", name: nameOf(c), noun: "glass", verb: "shatters", mass: py.pyRound(m, 6),
		limit: P.strength, k: GLASS_K, radius: 0.0, area: py.pyRound(Math.PI * (bw / 2) * (bw / 2), 6), smash: 1.0, scatter: 0.25,
		pieces, masses, puddle: null, edge: EDGE
	})
}

// ---------------------------------------------------------------- ceramic plate
function _plate() {
	register(new ItemType("ceramic-plate", "Ceramic plate", CAT, build_plate, {
		module: MODULE,
		props: [
			new Prop("diameter", "Diameter", 0.26, 0.1, 0.4, 0.005, "m"), new Prop("height", "Height", 0.025, 0.01, 0.06, 0.001, "m"),
			new Prop("mass", "Weight", PLATE_M, 0.05, 3.0, 0.01, "kg", "Follows the size until you type a weight", { auto: ["diameter"] }),
			new Prop("strength", "Breaks at", PLATE_LIMIT, 100.0, 20000.0, 10.0, "N",
				"The impact force that breaks it: a stoneware dinner plate about 2470 N (a 35 cm flat drop onto a hard floor)")
		],
		readouts: _readouts_brittle("a plate breaks into sherds at once"),
		tags: ["plate", "dish", "dinner plate", "ceramic", "porcelain", "fragile", "breakable"], anchor: "the middle of its bottom",
		description: "A stoneware dinner plate that breaks into four sherds when an impact's force passes its breaking force: dropped flat onto " +
			"a hard floor from above about 35 cm.",
		source: "Porcelain and stoneware bend at 40-110 MPa; breaking force a calibration (see machines/mod_fracture.py).",
		facts: "450 g · breaks from about a 35 cm drop onto a hard floor"
	}))
}

function build_plate(c, P) {
	const g = given(c)
	const d = P.diameter
	const h = P.height
	if (!has(g, "mass")) P.mass = (PLATE_M * (d * d)) / (0.26 * 0.26)
	const m = P.mass
	const R = d / 2
	const f = 0.36 * R
	const pts = _rounded([[-f, 0.0], [f, 0.0], [R, 0.7 * h], [0.94 * R, h], [-(0.94 * R), h], [-R, 0.7 * h]])
	const depth = r5(d)
	const mat = c.mat({ base: "ceramic", density: py.pyRound(m / (_area(pts) * depth), 6), overrides: {} })
	const sid = c.poly("plate", pts, depth, 0.0, 0.0, { material: mat, look: "ceramic", words: "a ceramic dinner plate" })
	const cuts = [
		_clip(pts, 1.0, 0.0, -(0.5 * R)), _clip(_clip(pts, -1.0, 0.0, 0.5 * R), 1.0, 0.0, 0.0),
		_clip(_clip(pts, -1.0, 0.0, 0.0), 1.0, 0.0, 0.5 * R), _clip(pts, -1.0, 0.0, -(0.5 * R))
	]
	const parked = c.mat({ base: "ceramic", density: PARKED, overrides: {} })
	const pieces = cuts.map((q, k) => c.poly(`sherd-${k + 1}`, q, depth, 0.0, 0.0, { material: parked, look: "ceramic", words: "a broken piece of a plate", kind: "dynamic" }))
	const whole = _area(pts)
	const masses = cuts.map((q) => py.pyRound((m * _area(q)) / whole, 6))
	c.process("fracture-brittle", "break", {
		solid: sid, mode: "free", name: nameOf(c), noun: "plate", verb: "breaks", mass: py.pyRound(m, 6),
		limit: P.strength, k: PLATE_K, radius: 0.0, area: py.pyRound(Math.PI * f * f, 6), smash: 1.0, scatter: 0.2, pieces, masses, puddle: null,
		edge: EDGE
	})
}

// ---------------------------------------------------------------- padding
function _cushion() {
	register(new ItemType("cushion", "Cushion pad", CAT, build_cushion, {
		module: MODULE, material: "foam", materials: [...PADS],
		props: [
			new Prop("width", "Width", 0.3, 0.03, 2.0, 0.01, "m"), new Prop("thickness", "Padding layer", 0.05, 0.005, 0.5, 0.005, "m", "How thick the pad is"),
			new Prop("depth", "Front to back", 0.3, 0.03, 2.0, 0.01, "m")
		],
		readouts: [new Readout("squash", "Squashed", { unit: "m", digits: 3, help: "How far a breakable thing that hit it squashed it (springing back after)" })],
		tags: ["cushion", "padding", "pad", "foam", "pillow", "bubble wrap", "cotton", "landing pad", "soft", "mat", "egg drop"],
		anchor: "the middle of its bottom",
		description: "A pad of padding: foam, packing foam, bubble wrap, cotton balls, pillow stuffing, crumpled paper, a folded towel or carpet. " +
			"A breakable thing that lands on it squashes it and feels a much smaller force than on a hard floor; thicker and softer " +
			"padding saves it from higher. (Any pillow, foam block, sponge, carpet or rubber mat pads the same way.)",
		source: "Compression laws: flexible PU foam 4 kPa at 40 % (DIN EN ISO 3386-1); EPS 100 kPa at 10 % (EN 13163); bubble wrap by Boyle's law; " +
			"fibres by van Wyk's law.",
		facts: "30 × 30 cm · 5 cm of soft foam", edit: [{ kind: "top", prop: "thickness" }]
	}))
}

function build_cushion(c, P) {
	const t = P.thickness
	c.slab("pad", P.width, t, P.depth, 0.0, t / 2, { words: `a pad of ${P.material}` })
}

// ---------------------------------------------------------------- egg-drop box
function _box() {
	register(new ItemType("egg-drop-box", "Egg-drop box", CAT, build_box, {
		module: MODULE,
		props: [
			new Prop("size", "Box size", 0.15, 0.08, 0.4, 0.005, "m", "Each side of the cardboard cube"),
			new Prop("padding", "Padding", "cotton balls", { kind: "choice", choices: [...BOX_PADS], help: "What fills the box around the egg" }),
			new Prop("padding_thickness", "Padding round the egg", 0.03, 0.0, 0.15, 0.005, "m", "How thick it is all round the egg (no more than the box has room for)"),
			new Prop("parachute", "Parachute", 0.0, 0.0, 1.5, 0.05, "m", "The canopy's width (0: none); it slows the fall in air"),
			new Prop("strength", "Egg breaks at", EGG_LIMIT, 5.0, 200.0, 1.0, "N", "The force that cracks the egg inside")
		],
		readouts: _readouts_brittle("the egg inside: 1 cracked, 2 smashed"),
		tags: ["egg drop", "egg drop challenge", "capsule", "container", "padding", "parachute", "box", "engineering", "design"],
		anchor: "the middle of its bottom",
		description: "The egg-drop challenge: a raw egg inside a cardboard box, padded all round, with a parachute if you like. When the box " +
			"lands, the egg is pressed by its padding (softer and thicker padding: less force) or only by its share of the box's " +
			"slowing on a soft landing; it cracks at 35 N. A parachute slows the fall.",
		source: "Egg 35 N, 21.5 kN/m (as the raw egg); padding laws as the cushion's; parachute drag coefficient 0.8 (Knacke 1992).",
		facts: "15 cm box · cotton balls 3 cm thick"
	}))
}

function build_box(c, P) {
	const s = P.size
	const room = (s - 0.006 - EGG_L) / 2
	let t = Math.max(0.0, Math.min(P.padding_thickness, room))
	P.padding_thickness = r5(t)
	const pad = P.padding in CUSHIONS ? P.padding : null
	t = pad !== null ? P.padding_thickness : 0.0
	const egg_v = (Math.PI / 6) * EGG_L * EGG_W * EGG_W
	const pad_v = pad !== null ? Math.max(0.0, (EGG_L + 2 * t) * (EGG_W + 2 * t) * (EGG_W + 2 * t) - egg_v) : 0.0
	const pad_m = pad !== null ? MATERIALS[pad].density * pad_v : 0.0
	const D = P.parachute
	const chute_area = (Math.PI * D * D) / 4
	const chute_m = D > 0 ? CHUTE_AREAL * chute_area + 0.002 : 0.0
	const box_m = BOARD * 6 * s * s + pad_m + chute_m
	const sid = c.slab("box", s, s, s, 0.0, s / 2, { material: c.mat({ base: "cardboard", density: py.pyRound(box_m / (s * s * s), 6), overrides: {} }), look: "cardboard", words: "a closed cardboard box" })
	const pts = _egg_points(EGG_L, EGG_W)
	const depth = r5(EGG_W)
	const egg = c.poly("egg", pts, depth, 0.0, 0.0, { material: c.mat({ base: "eggshell", density: py.pyRound(EGG_M / (_area(pts) * depth), 6), overrides: {} }), look: "eggshell", words: "a raw egg padded inside the box" })
	const e = c.sb.solids[c.sb.solids.length - 1]
	e.at = { x: 0.0, y: 0.0 }
	delete e.angle
	e.parent = sid
	c.process("fracture-brittle", "break", {
		solid: egg, mode: "boxed", name: nameOf(c), noun: "egg", verb: "smashes", mass: EGG_M, limit: P.strength,
		k: EGG_K, radius: r5(EGG_W / 2), area: py.pyRound(Math.PI * (EGG_L / 2) * (EGG_W / 2), 6), smash: 2.0, scatter: 0.0, pieces: [], puddle: null, box: sid, boxk: BOX_K, boxarea: r5(s * s),
		pad: pad !== null ? [...CUSHIONS[pad]] : null, padt: r5(t)
	})
	if (D > 0) c.process("fracture-chute", "chute", { solid: sid, area: py.pyRound(chute_area, 6), cd: CHUTE_CD, lift: r5(s / 2 + 0.6 * D) })
}

// ---------------------------------------------------------------- snapping bridges
function _bridge() {
	register(new ItemType("snap-bridge", "Snapping bridge", CAT, build_bridge, {
		module: MODULE,
		props: [
			new Prop("made_of", "Made of", "spaghetti", { kind: "choice", choices: Object.keys(BEAMS), help: "What the beam across the gap is" }),
			new Prop("strands", "Strands", 5, 1, 60, 1, "", "How many pieces of what it is made of lie side by side: strands of spaghetti, craft sticks, " +
				"sticks of chalk or chocolate bars (1: one bar or one stick; more: stronger)", { kind: "int" }),
			new Prop("span", "Span length", 0.2, 0.03, 0.6, 0.005, "m", "The gap between the supports it spans (wider: weaker)"),
			new Prop("support_height", "Support height", 0.1, 0.02, 0.5, 0.005, "m")
		],
		readouts: [
			new Readout("broken", "Broken", { unit: "", digits: 0, help: "0 whole, 2 snapped", words: { 0: "whole", 1: "cracked", 2: "snapped" } }),
			new Readout("load", "Load on it", { unit: "N", digits: 2, help: "What presses down on it besides its supports" }),
			new Readout("share", "Of its strength", { unit: "×", digits: 2, help: "The biggest bending over the bending that snaps it (1: it snaps)" }),
			new Readout("sag", "Sag", { unit: "m", digits: 4, help: "How far its middle sags under the load" })
		],
		tags: ["bridge", "spaghetti bridge", "beam", "snap", "break", "load", "strength", "chalk", "craft sticks", "popsicle sticks", "chocolate", "engineering"],
		anchor: "the middle of the floor under the gap",
		description: "A beam of spaghetti, craft sticks, chalk or a chocolate bar across the gap between two supports. Put weights on it: it " +
			"bends, and snaps where the bending passes its strength (5 strands of spaghetti over a 20 cm gap hold about 175 g in the middle). " +
			"More strands hold more; a wider gap holds less.",
		source: "Bending strength: dry pasta 36 MPa, E 4.1 GPa; birch 85 MPa, 11 GPa (Wood Handbook); chalk 3 MPa; milk chocolate 2.5 MPa.",
		facts: "5 strands of spaghetti over a 20 cm gap"
	}))
}

function _beam_section(made_of, n) {
	const [kind, b, h, sigma, E, mat] = BEAMS[made_of]
	let I, Z, A
	if (kind === "round") {
		I = (Math.PI * b * b * b * b) / 64
		Z = (Math.PI * b * b * b) / 32
		A = (Math.PI * b * b) / 4
	} else {
		I = (b * h * h * h) / 12
		Z = (b * h * h) / 6
		A = b * h
	}
	const rho = MATERIALS[mat].density
	return [h, n * b, rho * A * n, E * I * n, sigma * Z * n]
}

function build_bridge(c, P) {
	const made = P.made_of in BEAMS ? P.made_of : "spaghetti"
	const n = Math.trunc(Number(P.strands))
	const span = P.span
	const H = P.support_height
	const [h, w, per_m, EI, Mc] = _beam_section(made, n)
	const L = span + 2 * BEAM_REST
	const hp = Math.max(h, 0.003)
	const dp = Math.max(w, 0.01)
	const rho = py.pyRound((per_m * L) / (L * hp * dp), 6)
	const mat = BEAMS[made][5]
	const wood = c.mat({ base: "varnished hardwood", overrides: {} })
	const sx = span / 2 + 0.025
	const sd = Math.max(0.12, dp)
	c.slab("support-left", 0.05, H, sd, -sx, H / 2, { kind: "static", material: wood, look: "wood", words: "a wooden support block" })
	c.slab("support-right", 0.05, H, sd, sx, H / 2, { kind: "static", material: wood, look: "wood", words: "a wooden support block" })
	const m = c.mat({ base: mat, density: rho, overrides: {} })
	const look = MATERIALS[mat].look
	const beam = c.slab("beam", L, hp, dp, 0.0, H + hp / 2, { kind: "static", material: m, look, words: `a beam of ${made}` })
	const pieces = []
	// (its pieces carry the beam's real weight in the document: the whole beam is fixed, so they count it once; parked, they follow it)
	const parked = c.mat({ base: mat, density: rho, overrides: {} })
	for (let i = 0; i < BEAM_PIECES; i++) {
		const dx = -(L / 2) + L / (2 * BEAM_PIECES) + (i * L) / BEAM_PIECES
		const pid = c.slab(`piece-${i + 1}`, L / BEAM_PIECES, hp, dp, dx, H + hp / 2, { material: parked, look, words: `a broken piece of ${made}`, kind: "dynamic" })
		pieces.push([pid, r5(dx), py.pyRound((per_m * L) / BEAM_PIECES, 6)])
	}
	const rest = span / 2 + BEAM_REST / 2
	c.process("fracture-beam", "snap", {
		solid: beam, name: nameOf(c), noun: made, pieces, length: r5(L), ei: Number(py.fmtG(EI, 6)), mc: Number(py.fmtG(Mc, 6)),
		per_m: Number(py.fmtG(per_m, 6)), supports: [r5(-rest), r5(rest)], three: made === "spaghetti"
	})
}

// ---------------------------------------------------------------- towers of blocks, loose or glued
function _tower() {
	register(new ItemType("block-tower", "Block tower", CAT, build_tower, {
		module: MODULE,
		props: [
			new Prop("blocks", "Blocks", 6, 1, 20, 1, "", "", { kind: "int" }), new Prop("block_width", "Block width", 0.1, 0.02, 0.4, 0.005, "m"),
			new Prop("block_height", "Block height", 0.05, 0.01, 0.3, 0.005, "m"),
			new Prop("block_depth", "Block front to back", 0.05, 0.01, 0.3, 0.005, "m"),
			new Prop("glue", "Held together with", "none", {
				kind: "choice", choices: [...GLUE_NAMES],
				help: "none: loose blocks; tape, glue or sticky tack join each block to the next until the joint's strength is passed"
			})
		],
		readouts: [
			new Readout("broken", "Came apart", { unit: "", digits: 0, help: "1 once a glued joint has let go, or a block has fallen off (dropped or tipped)", words: { 0: "no", 1: "yes" } }),
			new Readout("blocks_fallen", "Blocks fallen", { unit: "", digits: 0, help: "How many blocks have dropped more than half a block below where they " +
				"were stacked, or tipped past 35° (a block that only slides along stays counted as standing)" }),
			new Readout("top_height", "Height now", { unit: "m", digits: 3, help: "How high its highest block's top is above its base now" }),
			new Readout("share", "Of the glue's strength", { unit: "×", digits: 2, help: "The most any joint has been pulled, over what it holds" })
		],
		tags: ["tower", "blocks", "stack", "glued", "tape", "structure", "knock down", "engineering"], anchor: "the middle of its base",
		description: "A tower of wooden blocks stacked one on another, loose or held together with sticky tack, tape, a glue stick or white glue. " +
			"Loose blocks fall off when hit hard (a block that only slides along still stands); glued ones move as one until a joint's " +
			"strength is passed (white glue: hardly ever). It reports how many blocks fell and how tall it stands now.",
		source: "Masking tape 2.7 N/cm peel (3M 2090); white glue 3 MPa across a wooden face (Wood Handbook); tack and glue stick provisional.",
		facts: "6 wooden blocks, 10 × 5 × 5 cm", edit: [{ kind: "top", prop: "block_height" }]
	}))
}

function build_tower(c, P) {
	const n = Math.trunc(Number(P.blocks))
	const w = P.block_width
	const h = P.block_height
	const d = P.block_depth
	const wood = c.mat({ base: "varnished hardwood", overrides: {} })
	const ids = []
	for (let i = 0; i < n; i++) ids.push(c.slab(`block${i + 1}`, w, h, d, 0.0, h / 2 + BLOCK_GAP + i * (h + BLOCK_GAP), { material: wood, look: "wood", words: "a wooden block" }))
	const glue = GLUE_NAMES.includes(P.glue) ? P.glue : "none"
	if (n >= 2) {
		const [sigma, tau] = glue === "none" ? [0.0, 0.0] : glue === "tape" ? [540.0 / d, 540.0 / d] : GLUES[glue]
		c.process("fracture-glue", "glue", { name: nameOf(c), glue, blocks: ids, w: r5(w), d: r5(d), h: r5(h), sigma: py.pyRound(sigma, 3), tau: py.pyRound(tau, 3) })
	}
}

// ---------------------------------------------------------------- a window pane
const PANE_CUTS = [0.0, 0.21, 0.4, 0.62, 0.81, 1.0]

function _pane() {
	register(new ItemType("window-pane", "Window pane", CAT, build_pane, {
		dynamic: false, module: MODULE, material: "glass", materials: ["glass"],
		props: [
			new Prop("height", "Height", 0.6, 0.1, 1.5, 0.01, "m"),
			new Prop("width", "Front to back", 0.6, 0.1, 1.5, 0.01, "m", "Its width across the window (the side view sees its edge)"),
			new Prop("thickness", "Glass", 0.003, 0.002, 0.012, 0.001, "m", "How thick the glass is: 3 mm in a house window, 4-6 mm in big ones"),
			new Prop("mount", "Held", "frame", {
				kind: "choice", choices: ["frame", "loose"],
				help: "frame: fixed upright in a wooden window frame standing where it is placed; loose: a free sheet of glass (lay it flat " +
					"or lean it)"
			}),
			new Prop("strength", "Breaks at", 258.0, 20.0, 20000.0, 1.0, "N", "The force of a hit at its middle that shatters it: follows its " +
				"size and glass until you type one", { auto: ["height", "width", "thickness"] })
		],
		readouts: _readouts_brittle("a pane shatters at once"),
		tags: ["window", "window pane", "pane", "glass sheet", "sheet of glass", "glass", "broken window", "fragile", "breakable", "shatter", "baseball", "throw"],
		anchor: "the middle of its bottom",
		description: "A pane of window glass (3 mm) in a wooden frame, or loose. A ball thrown hard at it shatters it into shards that fall; " +
			"a gentle toss bounces off. Thicker glass, or a smaller pane, takes a harder hit; a soft ball (a playground ball) " +
			"hits it more gently than a hard one (a baseball).",
		source: "Plate bending (Timoshenko; Roark table 11.2): stiffness 16π·D·(1+ν)/((3+ν)·a²) and the load that breaks it " +
			"2π·t²·σ/(3·[(1+ν)·ln(a/r0)+1]); soda-lime glass E 72 GPa, 41 MPa x 2 for a millisecond hit (see machines/mod_fracture.py).",
		facts: "60 × 60 cm · 3 mm glass · shatters at 258 N (a baseball at about 4 m/s)", edit: [{ kind: "top", prop: "height" }]
	}))
}

/** [stiffness N/m, breaking force N] of a pane held round its edge, hit at its middle (machines/mod_fracture.py pane_numbers). */
export function pane_numbers(H, W, t) {
	const a = Math.min(H, W) / 2
	const D = (PANE_E * t * t * t) / (12 * (1 - PANE_NU * PANE_NU))
	const k = (16 * Math.PI * D * (1 + PANE_NU)) / ((3 + PANE_NU) * a * a)
	const P = (2 * Math.PI * t * t * PANE_SIGMA) / (3 * ((1 + PANE_NU) * _ln(a / PANE_R0) + 1))
	return [k, P]
}

function build_pane(c, P) {
	const g = given(c)
	const H = P.height
	const W = P.width
	const t = P.thickness
	const [k, limit] = pane_numbers(H, W, t)
	if (!has(g, "strength")) P.strength = py.pyRound(limit, 1)
	const framed = P.mount !== "loose"
	const sill = framed ? 0.04 : 0.0
	const rho = MATERIALS.glass.density
	const m = rho * H * W * t
	const glass = c.mat({ base: "glass", overrides: {} })
	const whole = _rounded([[-(t / 2), sill], [t / 2, sill], [t / 2, sill + H], [-(t / 2), sill + H]])
	const sid = c.poly("pane", whole, r5(W), 0.0, 0.0, { material: glass, look: "glass", words: "a pane of window glass", kind: framed ? "static" : "dynamic" })
	if (framed) {
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		c.slab("frame-bottom", 0.06, sill, W + 0.08, 0.0, sill / 2, { kind: "static", material: wood, look: "wood", words: "the window frame's sill" })
		c.slab("frame-top", 0.06, 0.04, W + 0.08, 0.0, sill + H + 0.02, { kind: "static", material: wood, look: "wood", words: "the window frame's top" })
	}
	const parked = c.mat({ base: "glass", density: framed ? rho : PARKED, overrides: {} })
	const pieces = []
	const masses = []
	for (let i = 0; i < PANE_CUTS.length - 1; i++) {
		const y0 = sill + PANE_CUTS[i] * H
		const y1 = sill + PANE_CUTS[i + 1] * H
		const q = _rounded([[-(t / 2), y0], [t / 2, y0], [t / 2, y1], [-(t / 2), y1]])
		pieces.push(c.poly(`shard-${i + 1}`, q, r5(W), 0.0, 0.0, { material: parked, look: "glass", words: "a shard of window glass", kind: "dynamic" }))
		masses.push(py.pyRound(m * (PANE_CUTS[i + 1] - PANE_CUTS[i]), 6))
	}
	c.process("fracture-brittle", "break", {
		solid: sid, mode: "free", name: nameOf(c), noun: "pane", verb: "shatters", mass: py.pyRound(m, 6),
		limit: P.strength, k: py.pyRound(k, 1), radius: 0.0, area: py.pyRound(t * W, 6), smash: 1.0, scatter: 0.3, pieces, masses, puddle: null, edge: EDGE
	})
}

// ---------------------------------------------------------------- the padding table, and what other modules' things need from this one
const isNum = (v) => typeof v === "number"

/** [[solid id, law]]: other modules' soft things a breakable meets through their own law (machines/mod_fracture.py _body_laws). */
function _body_laws(sb) {
	const out = []
	for (const p of sb.processes) {
		const sid = p.solid
		if (typeof sid !== "string") continue
		const law = p.contact_law
		if (Array.isArray(law) && law.length && law.every(isNum) && law[0] >= 5 && law[0] <= 8) {
			out.push([sid, law.map((v) => v)])
			continue
		}
		if (p.kind !== "softbody" || p.role !== "ball") continue
		const R = p.R ?? 0.0
		const hard = p.hard ?? 0.0
		if (p.law === "pressure") out.push([sid, [5.0, p.gauge ?? 0.0, R, p.wall ?? 0.0, hard]])
		else if (p.law === "hertz") {
			const nu = p.nu ?? 0.3
			out.push([sid, [6.0, py.pyRound((p.E ?? 0.0) / (1 - nu * nu), 3), R, hard]])
		} else if (p.law === "clay") {
			const flow = p.flow ?? 0.0
			const ratio = R > 0 && flow > 0 ? py.pyRound((p.kc ?? 0.0) / (2 * Math.PI * R * flow), 4) : 50.0
			out.push([sid, [7.0, flow, R, ratio, hard]])
		}
	}
	for (const s of sb.solids) {
		const it = sb.scene_items.get(s.item) ?? {}
		if (it.type === "trampoline" && s.id === `${s.item}/mat`) {
			const P = props_of(it)
			out.push([s.id, [8.0, P.stiffness, r5(0.9 * P.height)]])
		}
	}
	return out
}

function _volume(b) {
	if (b.kind === "slab") return b.width * b.height * b.depth
	if (b.kind === "polygon") return Math.abs(_area(b.points.map((q) => [q.x, q.y]))) * b.depth
	return 0.0
}

function soft_table(sb, scene) {
	void scene
	claim_goals()
	const procs = sb.processes
	if (procs.some((p) => p.kind === "fracture-brittle" || p.kind === "fracture-beam")) {
		const soft = {}
		for (const s of sb.solids) {
			const base = sb.base_of(s.material)
			if (base in CUSHIONS) soft[s.id] = [...CUSHIONS[base]]
		}
		for (const [sid, law] of _body_laws(sb)) if (!has(soft, sid)) soft[sid] = law
		procs.push({ kind: "fracture-soft", id: "~fracture/soft", soft })
	}
	const jars = procs.filter((p) => p.kind === "air" && p.role === "jar").map((p) => ({ item: p.item, x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1 }))
	if (jars.length) for (const p of procs) if (p.kind === "fracture-chute") p.jars = jars.map((j) => ({ ...j }))
	if (procs.some((p) => p.kind === "liquid")) {
		for (const p of [...procs]) {
			if (p.kind !== "fracture-brittle" || p.mode !== "free") continue
			const item = sb.scene_items.get(p.item) ?? {}
			const rho = has(TRUE_DENSITY, item.type) ? TRUE_DENSITY[item.type] : null
			if (rho === null) continue
			let whole = 0.0
			let parts = 0.0
			for (const s of sb.solids) {
				if (s.item === p.item && s.kind === "dynamic") {
					const v = _volume(s.body)
					parts += v
					if (s.id === p.solid) whole = v
				}
			}
			if (whole > 0) procs.push({ kind: "displace", id: `${p.item}/displace`, item: p.item, volume_ml: py.pyRound(p.mass / rho * parts / whole * 1e6, 4) })
		}
	}
}

// ---------------------------------------------------------------- goals (the summary: machines/mod_fracture.py's, number for number)
const trim = (v) => py.fmtF(v, 2).replace(/0+$/, "").replace(/\.$/, "")
const fin = (v) => typeof v === "number" && Number.isFinite(v)

function goal_breaks(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "broken") === null) return null
	const by = ctx.num(g.before_s)
	const t = ctx.first_time(iid, "broken", (v) => v >= 0.5)
	const when = by === null ? "" : ` by ${trim(by)} s`
	return { label: py.truthy(g.label) ? g.label : `${ctx.name(iid)} breaks${when}`, ok: t !== null && (by === null || t <= by), kind: "breaks", item: iid, t: t === null ? null : py.pyRound(t, 3) }
}

const PREV = {}

/** "breaks" for an item of any module (machines/mod_fracture.py goal_breaks_any): every item with a broken reading by it, others by the other
 *  module's. */
function goal_breaks_any(ctx, g) {
	if (ctx.known(g.item) && ctx.state(g.item, "broken") !== null) return goal_breaks(ctx, g)
	return PREV.breaks ? PREV.breaks(ctx, g) : null
}
function goal_survives_any(ctx, g) {
	if (ctx.known(g.item) && ctx.state(g.item, "broken") !== null) return goal_survives(ctx, g)
	return PREV.survives ? PREV.survives(ctx, g) : null
}

/** Other modules call their goals "breaks" and "survives" too and load after this one (items.py's _claim_goals): the first build hands theirs
 *  on and answers for both. The plug-in registry says which module's kind is registered now. */
function claim_goals() {
	const S = globalThis[Symbol.for("sandbox.plugins")]
	if (!S?.goals) return
	for (const [kind, fn] of [["breaks", goal_breaks_any], ["survives", goal_survives_any]]) {
		const spec = S.goals.get(kind)
		if (!spec || spec.module === "mod_fracture") continue
		PREV[kind] = (ctx, g) => spec.summarize(ctx, g)
		const mine = S.modules.get("mod_fracture")?.goals?.find((k) => k.kind === kind)
		if (mine) S.goals.set(kind, { ...mine, module: "mod_fracture" })
		S.version++
		F.GOAL_KINDS.set(kind, (ctx, g) => fn(ctx, g))
	}
}

function goal_survives(ctx, g) {
	const iid = g.item
	const st = ctx.known(iid) ? ctx.state(iid, "broken") : null
	if (st === null) return null
	const t = ctx.first_time(iid, "broken", (v) => v >= 0.5)
	const sh = ctx.state(iid, "share") ?? []
	let most = 0.0
	let any = false
	for (const v of sh) {
		if (v === null || v === undefined) continue
		most = any ? Math.max(most, v) : v
		any = true
	}
	return { label: py.truthy(g.label) ? g.label : `${ctx.name(iid)} survives`, ok: t === null, kind: "survives", item: iid, share: py.pyRound(most, 2), t: t === null ? null : py.pyRound(t, 3) }
}

function goal_breaks_first(ctx, g) {
	const a = g.item
	const b = g.other
	if (!(ctx.known(a) && ctx.known(b)) || ctx.state(a, "broken") === null || ctx.state(b, "broken") === null) return null
	const ta = ctx.first_time(a, "broken", (v) => v >= 0.5)
	const tb = ctx.first_time(b, "broken", (v) => v >= 0.5)
	return {
		label: py.truthy(g.label) ? g.label : `${ctx.name(a)} breaks before ${ctx.name(b)}`, ok: ta !== null && (tb === null || ta < tb),
		kind: "breaks_first", item: a, other: b, t: ta === null ? null : py.pyRound(ta, 3), other_t: tb === null ? null : py.pyRound(tb, 3)
	}
}

function goal_knocked_down(ctx, g) {
	const iid = g.item
	const hs = ctx.known(iid) ? ctx.state(iid, "top_height") : null
	if (hs === null || hs === undefined) return null
	const first = hs.find((v) => v !== null && v !== undefined)
	if (first === undefined) return null
	const n = ctx.num(g.at_least_blocks)
	let t
	let label
	if (n !== null) {
		t = ctx.first_time(iid, "blocks_fallen", (v) => v >= n)
		label = `${ctx.name(iid)} is knocked down (${trim(n)} or more blocks fall)`
	} else {
		const half = Math.floor((ctx.solids(iid, true).length + 1) / 2)
		const ta = ctx.first_time(iid, "top_height", (v) => v < 0.5 * first)
		const tb = half > 0 ? ctx.first_time(iid, "blocks_fallen", (v) => v >= half) : null
		t = tb === null ? ta : ta === null ? tb : Math.min(ta, tb)
		label = `${ctx.name(iid)} is knocked down`
	}
	const fallen = ctx.state(iid, "blocks_fallen") ?? []
	let most = 0.0
	let any = false
	for (const v of fallen) {
		if (v === null || v === undefined) continue
		most = any ? Math.max(most, v) : v
		any = true
	}
	return { label: py.truthy(g.label) ? g.label : label, ok: t !== null, kind: "knocked_down", item: iid, fallen: Math.trunc(most), t: t === null ? null : py.pyRound(t, 3) }
}

// ---------------------------------------------------------------- the AI's plug-ins
const BREAKABLE = ["raw-egg", "drinking-glass", "ceramic-plate", "egg-drop-box", "snap-bridge", "block-tower", "window-pane"]
const pick1 = (scene, pick, types) => {
	const list = scene.items.filter((i) => types.includes(i.type))
	return list.length ? pick(list) : null
}
const cm = (m) => `${trim(m * 100)} cm`
const mmOrCm = (m) => (m < 0.01 ? `${trim(m * 1000)} mm` : cm(m))
const grams = (kg) => (kg >= 1 ? `${kg.toFixed(2)} kg` : `${(kg * 1000).toFixed(0)} g`)
const maxOf = (list) => {
	let most = null
	for (const v of Array.isArray(list) ? list : []) if (fin(v) && (most === null || v > most)) most = v
	return most
}

/** The load a snap-bridge snaps under, resting at its middle over a width w (m; 0: at one point), kg: M = P/2·(L/2 − w/4)… for a load
 *  spread over w (two contact points w apart, as a block sits): P = 4·M_c/(L − w), L between the middles of its rests. */
function bridgeHolds(made, n, span, w) {
	const [kind, b, h, sigma] = BEAMS[made]
	const Z = kind === "round" ? (Math.PI * b * b * b) / 32 : (b * h * h) / 6
	const L = span + BEAM_REST
	return (4 * sigma * Z * n) / Math.max(1e-6, L - Math.min(w, 0.9 * L)) / 9.81
}

export const plugin = {
	title: "Breaking things and padding (eggs, glass, plates, windows, bridges, glued towers)",
	howto:
		"Things that BREAK when a force passes a real threshold: raw-egg (cracks at 35 N: about a 5 cm drop onto a hard floor; smashes into shell " +
		"pieces and a spill when hit twice as hard), drinking-glass (shatters: about a 46 cm drop onto a hard floor), ceramic-plate (breaks into " +
		"sherds: about 35 cm), window-pane (window glass, mount frame = fixed upright in a wooden frame, or loose: a baseball moving faster than about " +
		"4 m/s shatters a 3 mm pane, a gentle toss bounces off; thicker glass or a soft ball takes more), snap-bridge (a beam of spaghetti, craft " +
		"sticks, chalk or a chocolate bar across two supports, with its supports: put loads ON it at its x and it bends and snaps; strands = how many " +
		"pieces of made_of lie side by side, so strands 1 is one chocolate bar or one stick of chalk: set it from the request whenever you change " +
		"made_of; 5 spaghetti strands over a 20 cm gap hold about 175 g pressed at one point in its middle, and a wide load spreads its bending and " +
		"holds more: a 3.5 cm steel weight about 15 % more; more strands or a shorter gap hold more), block-tower (wooden blocks, loose or glued: a " +
		"hard knock makes loose blocks fall off and tape let go, white glue hardly ever; it reads blocks_fallen and top_height, and a block that only " +
		"slides along still stands). For any egg that should crack or break use raw-egg (it cracks at 35 N, about a 5 cm drop onto a hard floor, and " +
		"breaks into pieces); the mechanics module's egg {fragile: true} is a simpler egg with no pieces (it cracks from about 7 cm): use it only when the plain egg is asked for. " +
		"PADDING saves them: a cushion (material foam, packing foam, bubble wrap, cotton balls, pillow stuffing, crumpled paper, folded towel, " +
		"carpet; thickness) under where it lands, or any pillow, foam block, sponge, carpet strip or rubber mat; other modules' soft things cushion " +
		"by their own squash too: an inflated playground or exercise ball, a foam ball, a clay ball, a trampoline's mat (an egg dropped 50 cm onto an " +
		"exercise ball or 1 m onto a trampoline survives). Thicker and softer padding saves it from higher (an egg: 5 cm of soft foam from about " +
		"50 cm, a pillow from about 95 cm). Hard on hard (a glass dropped on a glass, a rim on a rim) breaks at half the force of a flat landing. " +
		"WATER: a breakable dropped into a water-tank's water is slowed by it and only its hit on the tank's floor counts, so an egg dropped 30 cm into " +
		"20 cm of water survives where one dropped onto the table smashes; a raw egg sinks in fresh water and floats in salt water of 12 % or more " +
		"(the fluids module's floats / sinks goals). The tank's liquid is the water: never stand a cushion in for water. TABLES AND SHELVES: for " +
		"\"falls off a table\" or \"knocked off a shelf\", stand it on the real table or on a shelf that stands on something (a plank on two wooden " +
		"blocks or posts; never a plank hanging in the air), or hold it (held: true, on air at y_m) at that height and say so. The egg-drop challenge " +
		"is ONE item, egg-drop-box (padding, padding_thickness, parachute = canopy width in m: 0.4-0.8 slows a box to 2-4 m/s; a parachute does " +
		"nothing in a vacuum or a pumped vacuum jar): drop it held: true at a height (place on air with y_m). To load an egg (books or a weight " +
		"resting on it) make it fixed: true (held in a carton: a loose egg rolls out from under a load); it cracks under a resting 35 N (3.6 kg). " +
		"Each breakable reports broken (0 whole, 1 cracked, 2 in pieces), peak_force (N), share (peak over its breaking force) and impact_speed; a " +
		"bridge also load (N) and sag. Goals: breaks {item, before_s?}, survives {item}, breaks_first {item, other}, knocked_down {item, " +
		"at_least_blocks?}.",
	prompt: {
		plan:
			"For anything that should crack, shatter or snap use the fracture items (raw-egg, drinking-glass, ceramic-plate, window-pane, snap-bridge, " +
			"block-tower, egg-drop-box) and a breaks / survives / breaks_first goal (a tower knocked over: knocked_down). A drop is the item held: true " +
			"in the air (place on: \"air\", y_m) above what it lands on: an egg cracks from 5 cm on a hard table, a glass from about 46 cm. Something " +
			"knocked off a table or a shelf starts on the real table, or on a shelf that stands on wooden blocks or posts, never on a plank floating in " +
			"the air. To compare padding, drop identical items side by side from the same height onto different cushions (cushion props: material, " +
			"thickness). For a bridge, put the loads on the snap-bridge (place on its id at its x), set strands to how many pieces of made_of the " +
			"request has (one chocolate bar: strands 1), and say whether it holds (survives) or snaps (breaks). A fair comparison (two towers, two eggs, " +
			"two bridges) gives each its own striker, ramp or drop, side by side, so one test never spoils or blocks the other.",
		edit:
			"Fracture items: raw-egg/drinking-glass/ceramic-plate/window-pane props strength (N); window-pane thickness and mount; cushion material + " +
			"thickness; egg-drop-box padding, padding_thickness, parachute (m); snap-bridge made_of, strands, span (strands counts pieces of made_of: " +
			"when the request swaps what it is made of, set strands from it too: \"use a chocolate bar\" = made_of chocolate bar, strands 1); " +
			"block-tower glue. Readings broken/peak_force/share say how close it came: share 0.6 = 60 % of the force that breaks it.",
		refine:
			"A breakable's share reading is its biggest force over its breaking force: above 1 it broke. Raise or lower a drop, add or thicken padding " +
			"to change it. Never drop or relabel the goal of an outcome the person predicted or asked for (a bridge that should snap, an egg that should " +
			"survive) because a run disagrees: keep it, say it is not met yet, and offer the change that makes it happen (strands, the load, the gap, " +
			"the padding, the drop height)."
	},
	examples: [
		{
			ask: "Drop three raw eggs from 50 cm: onto the table, onto a foam pad and onto a pillow. Which survive?",
			how: "three raw-egg held: true on air at y_m 0.5 above their landing, side by side 40 cm apart: one over the bare table, one over a cushion {material: foam, thickness: 0.05}, one over a cushion {material: pillow stuffing, thickness: 0.15}; goals breaks {the egg over the table}, survives {each padded egg}"
		},
		{
			ask: "How many strands of spaghetti hold 300 g across a 25 cm gap?",
			how: "snap-bridge {made_of: spaghetti, span: 0.25, strands: 6} and another {strands: 12} side by side, a steel-weight-1kg {mass: 0.3} placed on each bridge at its middle; goals breaks {the 6-strand bridge}, survives {the 12-strand bridge} (10 strands hold about 320 g of a 3.5 cm weight)"
		},
		{
			ask: "Egg-drop challenge: a padded box with a parachute against a bare box, from 1.5 m",
			how: "egg-drop-box {padding: cotton balls, padding_thickness: 0.03, parachute: 0.6} and egg-drop-box {padding: none, parachute: 0}, both held: true on air at y_m 1.5, side by side; goals survives {the padded box}, breaks {the bare box}"
		},
		{
			ask: "Does a glass break if it falls on the floor? What about on a carpet?",
			how: "two drinking-glass held: true on air at y_m 0.6, one over the bare table, one over a cushion {material: carpet, thickness: 0.01}; goals breaks {the glass over the table}, survives {the glass over the carpet}"
		},
		{
			ask: "Knock down a loose tower and a glued tower with a rolling ball",
			how: "block-tower {glue: none} and block-tower {glue: white glue} 1.2 m apart, each with its own plank ramp (angle -30) and a bowling-ball held at its top; goals knocked_down {the loose tower}, survives {the glued tower}"
		},
		{
			ask: "Throw a baseball at a window",
			how: "a window-pane {mount: frame} standing on the table, a baseball 1 m to its left given start_speed 9 (m/s) toward it (start_dir 0); goal breaks {the pane}; a second pane with the ball at start_speed 2 survives"
		},
		{
			ask: "Drop an egg into a tank of water and another onto the table from 30 cm",
			how: "a water-tank {fill: 0.2} and a raw-egg held: true 30 cm above its water; a second raw-egg held 30 cm above the bare table; goals survives {the egg over the water}, breaks {the egg over the table}"
		}
	],
	goals: [
		{
			kind: "breaks",
			aliases: ["break", "cracks", "crack", "snaps", "snap", "shatters", "shatter", "smashes", "smash", "breaks_apart", "comes_apart"],
			fields: { item: "item", before_s: "number?" },
			about: "breaks {item, before_s?}: a breakable item (raw-egg, drinking-glass, ceramic-plate, window-pane, egg-drop-box's egg, snap-bridge, block-tower: a glued joint lets go or a block falls off; any item with a broken reading) cracks, shatters, snaps or comes apart (by before_s if given)",
			label: (g, n) => `${n(g.item)} breaks${fin(g.before_s) ? ` by ${trim(g.before_s)} s` : ""}`,
			summarize: goal_breaks_any,
			sample: (scene, pick) => {
				const it = pick1(scene, pick, BREAKABLE)
				return it ? { kind: "breaks", item: it.id, ...(pick([true, false]) ? { before_s: pick([0.5, 1.2, 2.5]) } : {}) } : null
			}
		},
		{
			kind: "survives",
			aliases: ["survive", "intact", "stays_intact", "stays_whole", "does_not_break", "doesnt_break", "no_break", "unbroken", "not_broken"],
			fields: { item: "item" },
			about: "survives {item}: a breakable item never breaks in the run (an egg that is padded well enough, a bridge that holds its load)",
			label: (g, n) => `${n(g.item)} survives`,
			summarize: goal_survives_any,
			sample: (scene, pick) => {
				const it = pick1(scene, pick, BREAKABLE)
				return it ? { kind: "survives", item: it.id } : null
			}
		},
		{
			kind: "breaks_first",
			aliases: ["breaks_before", "first_to_break", "breaks_sooner"],
			fields: { item: "item", other: "item" },
			subject: ["item"],
			about: "breaks_first {item, other}: item breaks, and before other does (or other never breaks)",
			label: (g, n) => `${n(g.item)} breaks before ${n(g.other)}`,
			summarize: goal_breaks_first,
			sample: (scene, pick) => {
				const list = scene.items.filter((i) => BREAKABLE.includes(i.type))
				if (list.length < 2) return null
				const a = pick(list)
				const b = pick(list.filter((i) => i !== a))
				return { kind: "breaks_first", item: a.id, other: b.id }
			}
		},
		{
			kind: "knocked_down",
			aliases: ["knock_down", "knocks_down", "tower_falls", "tower_knocked_down", "collapses", "collapse", "tower_collapses"],
			fields: { item: "item", at_least_blocks: "number?" },
			about: "knocked_down {item, at_least_blocks?}: a block-tower is knocked down: half its blocks or more fell, or it stands less than half as tall as it was built; with at_least_blocks, that many of its blocks fell (a block that only slides along still stands)",
			label: (g, n) => `${n(g.item)} is knocked down${fin(g.at_least_blocks) ? ` (${trim(g.at_least_blocks)} or more blocks fall)` : ""}`,
			summarize: goal_knocked_down,
			sample: (scene, pick) => {
				const it = pick1(scene, pick, ["block-tower"])
				return it ? { kind: "knocked_down", item: it.id, ...(pick([true, false]) ? { at_least_blocks: pick([1, 2, 4]) } : {}) } : null
			}
		}
	],
	knobs: [
		{ type: "cushion", key: "thickness", how: "m", steps: [0.01, 0.02, 0.04, 0.08, 0.12], more: "make {it} thicker", less: "make {it} thinner", why: "thicker padding squashes farther, so what lands on it stops more gently and feels less force" },
		{ type: "cushion", key: "material", how: "choice", more: "swap what {it} is made of", less: "swap what {it} is made of", why: "softer padding (pillow stuffing, foam, cotton) gives a smaller force than stiff packing foam or carpet; too thin a soft pad squashes flat and stops it hard" },
		{ type: "egg-drop-box", key: "padding_thickness", how: "m", steps: [0.005, 0.01, 0.02, 0.04], more: "add padding round the egg in {it}", less: "use less padding round the egg in {it}", why: "more padding round the egg stops it more gently (up to what the box has room for)" },
		{ type: "egg-drop-box", key: "padding", how: "choice", more: "swap the padding in {it}", less: "swap the padding in {it}", why: "soft padding (cotton balls, pillow stuffing, foam) protects the egg; stiff packing foam much less" },
		{ type: "egg-drop-box", key: "parachute", how: "m", steps: [0.1, 0.2, 0.3, 0.5], more: "give {it} a bigger parachute", less: "give {it} a smaller parachute", from_zero: "give {it} a {to} parachute", to_zero: "take {it}'s parachute off", why: "a bigger canopy slows the fall, so the box lands slower (in air only: nothing in a vacuum)" },
		{ type: "egg-drop-box", key: "size", how: "rel", more: "make {it} bigger", less: "make {it} smaller", why: "a bigger box has room for more padding round the egg" },
		{ type: "snap-bridge", key: "strands", how: "abs", steps: [1, 2, 5], more: "add strands to {it}", less: "use fewer strands in {it}", why: "each strand carries its own share of the bending: twice the strands hold twice the load" },
		{ type: "snap-bridge", key: "span", how: "rel", more: "widen {it}'s gap", less: "narrow {it}'s gap", why: "the bending a load makes grows with the gap: half the gap holds about twice the load in the middle" },
		{ type: "snap-bridge", key: "made_of", how: "choice", more: "swap what {it} is made of", less: "swap what {it} is made of", why: "craft sticks are far stronger than spaghetti, chalk and chocolate far weaker (strands keeps its count: that many of the new pieces)" },
		{ type: "block-tower", key: "glue", how: "choice", more: "use something else to hold {it} together", less: "use something else to hold {it} together", why: "loose blocks fall off when hit; tape lets go under a hard knock; white glue hardly ever" },
		{ type: "window-pane", key: "thickness", how: "abs", steps: [0.001, 0.002, 0.003], more: "use thicker glass in {it}", less: "use thinner glass in {it}", why: "thicker glass is stiffer and much stronger (its breaking force grows with its thickness squared): a 6 mm pane takes about 4 times the force of a 3 mm one" },
		{ type: "raw-egg", key: "strength", how: "abs", steps: [1, 2, 3, 5], min: 30, max: 40, cost: 4, more: "use a stronger egg for {it}", less: "use a weaker egg for {it}", why: "hen eggs break at 30-40 N; outside that it is no longer a real egg" },
		{ type: "drinking-glass", key: "strength", how: "rel", cost: 4, more: "use a tougher glass for {it}", less: "use a more fragile glass for {it}", why: "a tempered glass is about 4 times as strong as an annealed one" },
		{ type: "ceramic-plate", key: "strength", how: "rel", cost: 4, more: "use a tougher plate for {it}", less: "use a more fragile plate for {it}", why: "porcelain and stoneware vary about twofold in strength" }
	],
	digest: (item, run) => {
		const t = item?.type
		if (!BREAKABLE.includes(t) && t !== "cushion") return null
		const p = item.props ?? {}
		const out = []
		const st = run?.track?.state?.[item.id]
		if (t === "raw-egg") out.push(`breaks at ${trim(fin(p.strength) ? p.strength : EGG_LIMIT)} N (cracks from about a 5 cm drop onto a hard floor; smashes at twice that); in water it sinks (fresh) or floats (12 % salt or more)`)
		if (t === "drinking-glass") out.push(`shatters at ${trim(fin(p.strength) ? p.strength : GLASS_LIMIT)} N (about a 46 cm drop onto a hard floor; dropped on another glass, half that)`)
		if (t === "ceramic-plate") out.push(`breaks at ${trim(fin(p.strength) ? p.strength : PLATE_LIMIT)} N (about a 35 cm drop onto a hard floor)`)
		if (t === "window-pane") {
			const H = fin(p.height) ? p.height : 0.6
			const W = fin(p.width) ? p.width : 0.6
			const th = fin(p.thickness) ? p.thickness : 0.003
			const [k, P0] = pane_numbers(H, W, th)
			const P = fin(p.strength) ? p.strength : P0
			out.push(`${mmOrCm(th)} glass, ${p.mount === "loose" ? "loose" : "in a frame"}: shatters at ${trim(P)} N (a 145 g baseball at about ${(P / Math.sqrt(k * 0.145)).toFixed(1)} m/s, a 57 g tennis ball at about ${(P / Math.sqrt(k * 0.057)).toFixed(1)} m/s)`)
		}
		if (t === "egg-drop-box")
			out.push(`padding ${p.padding ?? "cotton balls"} ${cm(fin(p.padding_thickness) ? p.padding_thickness : 0.03)} thick, parachute ${fin(p.parachute) && p.parachute > 0 ? cm(p.parachute) : "none"}; the egg inside cracks at ${trim(fin(p.strength) ? p.strength : EGG_LIMIT)} N`)
		if (t === "snap-bridge") {
			const made = p.made_of in BEAMS ? p.made_of : "spaghetti"
			const n = fin(p.strands) ? Math.trunc(p.strands) : 5
			const span = fin(p.span) ? p.span : 0.2
			const what = made === "chocolate bar" ? (n === 1 ? "1 chocolate bar" : `${n} chocolate bars`) : made === "chalk" ? (n === 1 ? "1 stick of chalk" : `${n} sticks of chalk`) : made === "craft sticks" ? (n === 1 ? "1 craft stick" : `${n} craft sticks`) : n === 1 ? "1 strand of spaghetti" : `${n} strands of spaghetti`
			out.push(`${what} side by side across a ${cm(span)} gap (strands counts pieces of what it is made of): holds about ${grams(bridgeHolds(made, n, span, 0))} pressed at one point in its middle, about ${grams(bridgeHolds(made, n, span, 0.035))} of a 3.5 cm steel weight, ${grams(bridgeHolds(made, n, span, 0.05))} of a 5 cm block (less off-centre or dropped)`)
			const sh = st ? maxOf(st.share) : null
			const load = st && Array.isArray(st.load) ? st.load[st.load.length - 1] : null
			const b = st && Array.isArray(st.broken) ? st.broken[st.broken.length - 1] : null
			if (b !== null && b < 1 && fin(sh) && sh > 0.05 && fin(load) && load > 0.01)
				out.push(`with the last run's load where it is (${grams(load / 9.81)} on it, ${(sh * 100).toFixed(0)} % of its strength), it snaps at about ${grams(load / sh / 9.81)}`)
		}
		if (t === "block-tower") out.push(`held together with ${p.glue ?? "none"}`)
		if (t === "block-tower" && st && Array.isArray(st.top_height) && st.top_height.length) {
			const n = fin(p.blocks) ? Math.trunc(p.blocks) : 6
			const fell = maxOf(st.blocks_fallen) ?? 0
			const h0 = st.top_height[0]
			const h1 = st.top_height[st.top_height.length - 1]
			const b = Array.isArray(st.broken) ? st.broken[st.broken.length - 1] : 0
			const glued = (p.glue ?? "none") !== "none"
			const how = fell > 0 ? `came apart: ${fell} of ${n} blocks fell` : b >= 1 && glued ? "a glued joint let go, but no block fell" : "stood: no block fell"
			const sh = glued ? maxOf(st.share) : null
			out.push(`last run: ${how}; its top ${cm(h1)} up at the end (built ${cm(h0)})${h1 < 0.5 * h0 || fell >= Math.floor((n + 1) / 2) ? ": knocked down" : ""}${glued && fin(sh) ? `; the glue took ${(sh * 100).toFixed(0)} % of its strength` : ""}`)
		} else if (st && Array.isArray(st.broken) && st.broken.length) {
			const b = st.broken[st.broken.length - 1]
			const sh = maxOf(st.share)
			const f = Array.isArray(st.peak_force) ? st.peak_force[st.peak_force.length - 1] : null
			const word = t === "snap-bridge" ? (b >= 1 ? "SNAPPED" : "held") : b >= 2 ? "BROKE (in pieces)" : b >= 1 ? "BROKE (cracked)" : "did not break"
			out.push(`last run: ${word}${fin(f) ? `, biggest force ${f.toFixed(1)} N` : ""}${fin(sh) ? ` (${(sh * 100).toFixed(0)} % of what breaks it)` : ""}`)
		}
		if (t === "cushion" && st && Array.isArray(st.squash)) out.push(`squashed up to ${cm(maxOf(st.squash) ?? 0)} in the last run`)
		return out
	},
	words: {
		change: (type, key, a, b) => {
			if (type === "egg-drop-box" && key === "parachute") return `parachute ${fin(a) && a > 0 ? cm(a) : "none"} → ${fin(b) && b > 0 ? cm(b) : "none"}`
			if (type === "egg-drop-box" && key === "padding") return `padding ${a ?? "cotton balls"} → ${b ?? "cotton balls"}`
			if (type === "egg-drop-box" && key === "padding_thickness") return `padding round the egg ${fin(a) ? cm(a) : "3 cm"} → ${fin(b) ? cm(b) : "?"}`
			if (type === "snap-bridge" && key === "strands") return `${fin(a) ? a : 5} → ${fin(b) ? b : 5} strands`
			if (type === "snap-bridge" && key === "made_of") return `made of ${a ?? "spaghetti"} → ${b ?? "spaghetti"}`
			if (type === "snap-bridge" && key === "span") return `gap ${fin(a) ? cm(a) : "20 cm"} → ${fin(b) ? cm(b) : "?"}`
			if (type === "block-tower" && key === "glue") return `held with ${a ?? "none"} → ${b ?? "none"}`
			if (type === "cushion" && key === "material") return `padding ${a ?? "foam"} → ${b ?? "foam"}`
			if (type === "cushion" && key === "thickness") return `padding ${fin(a) ? cm(a) : "5 cm"} → ${fin(b) ? cm(b) : "?"} thick`
			if (type === "window-pane" && key === "thickness") return `glass ${fin(a) ? mmOrCm(a) : "3 mm"} → ${fin(b) ? mmOrCm(b) : "?"} thick`
			if (type === "window-pane" && key === "mount") return `${a === "loose" ? "loose" : "in a frame"} → ${b === "loose" ? "loose" : "in a frame"}`
			if (["raw-egg", "drinking-glass", "ceramic-plate", "egg-drop-box", "window-pane"].includes(type) && key === "strength") return `breaks at ${fin(a) ? trim(a) : "?"} → ${fin(b) ? trim(b) : "?"} N`
			return null
		}
	}
}
