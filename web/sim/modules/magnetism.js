// The magnetism module (magnets, soft iron, a compass, static electricity): an exact port of machines/mod_magnetism.py (the same names, the
// same order, the same numbers; see its docstring for the records each item writes and the sources), and the module's plug-ins for the AI
// (web/sim/plugins.js): its goal kinds, how-to, prompt lines, readings in the edit digest, the make-it-work knobs and the change words.
// A module file imports nothing: register_all gets the framework (web/sim/items.js FRAMEWORK).
let F = null
let register, ItemType, Prop, Readout, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, CATEGORIES, TYPES, define_material
let pyRound, fmtG, cube, cos, sin, pySum

const MU0 = 1.25663706212e-6 // T·m/A [CODATA18]
const EPS0 = 8.8541878128e-12 // F/m [CODATA18]
const CATEGORY = "Magnets & static"
const STEEL = 7850.0 // kg/m³: low-carbon steel

// Permanent magnet grades (mod_magnetism.py GRADES)
const GRADES = {
	ceramic: { br: 0.39, density: 4900.0, eff: 1.0, look: "magnet paint", words: "ceramic (ferrite)", source: "Ceramic 8 (Y30) ferrite: B_r 0.385-0.40 T, 4.9 g/cm³ [ARN]." },
	alnico: {
		br: 1.25, density: 7300.0, eff: 0.86, look: "magnet paint", words: "alnico",
		source: "Alnico 5: B_r 1.25 T, H_c 51 kA/m (640 Oe), recoil permeability 3.7, (BH)max 43.8 kJ/m³ at B_d 1.0 T, 7.3 g/cm³ " +
			"[ARN]; a bar's magnetization is solved along it (its ends partly demagnetized: its poles spread over its last few cm); " +
			"a horseshoe works at about 1.07 T."
	},
	neodymium: { br: 1.3, density: 7500.0, eff: 1.0, look: "nickel plate", words: "neodymium (NdFeB)", source: "NdFeB N42: B_r 1.28-1.32 T, 7.5 g/cm³, nickel plated [KJ]." }
}
const GRADE_KEYS = ["ceramic", "alnico", "neodymium"]

// An alnico bar's poles (mod_magnetism.py ALNICO_HC: why, and the curve): its magnetization solved along it, its ends partly demagnetized
const ALNICO_HC = 51000.0
const ALNICO_CHI = 2.7
// a bar's half in cells from its end to its middle, at the Chebyshev nodes 1 − cos(π·k/24), fractions of the half-length (mod_magnetism.py BAR_NODES)
const BAR_NODES = [0.0, 0.008555138626189618, 0.03407417371093169, 0.07612046748871326, 0.1339745962155613, 0.20664665970876483,
	0.2928932188134524, 0.39123857099127934, 0.5, 0.6173165676349102, 0.7411809548974793, 0.8694738077799483, 1.0]
// 3-point Gauss-Legendre nodes and weights (mod_magnetism.py GAUSS3)
const GAUSS3 = [[-0.7745966692414834, 0.2777777777777778], [0.0, 0.4444444444444444], [0.7745966692414834, 0.2777777777777778]]

// Soft magnetic materials: saturation M_s (A/m) and initial susceptibility (mod_magnetism.py SOFT)
const SOFT = {
	steel: { ms: 1.6e6, chi: 1000.0 },
	"steel weight": { ms: 1.4e6, chi: 300.0 },
	"low-carbon steel": { ms: 1.6e6, chi: 1000.0 },
	"tinplate steel": { ms: 1.6e6, chi: 1000.0 },
	nickel: { ms: 4.85e5, chi: 100.0 },
	// the other modules' steels and irons (mod_magnetism.py SOFT: the same values and sources)
	"density set steel": { ms: 1.6e6, chi: 1000.0 },
	"cast iron": { ms: 1.27e6, chi: 300.0 },
	"spring bumper": { ms: 1.6e6, chi: 300.0 },
	"steel wool": { ms: 1.6e6, chi: 300.0, solid: 7850.0 }
}
const CONDUCTORS = ["steel", "steel weight", "low-carbon steel", "tinplate steel", "nickel", "aluminium", "aluminium can", "aluminium foil", "glass & aluminium", "cupronickel", "copper", "brass",
	"density set steel", "cast iron", "spring bumper", "steel wool", "stainless steel", "copper-plated zinc", "density set aluminium", "density set brass", "density set copper", "density set zinc", "can aluminium", "spacecraft aluminium", "magnet bumper", "graphite"]

// light things that are not metal, polarized as dielectrics (mod_magnetism.py DIELECTRIC: ε_r of the solid stuff and its own density)
const CELLULOSE = [4.5, 1500.0]
const KERATIN = [3.5, 1300.0]
const WATERY = [80.0, 998.0]
const DIELECTRIC = {
	paper: CELLULOSE, "office paper": CELLULOSE, "folded paper": CELLULOSE, "paper strip": CELLULOSE, "crumpled paper": CELLULOSE,
	"tissue paper": CELLULOSE, "envelope tissue": CELLULOSE, "index card": CELLULOSE, card: CELLULOSE, cardboard: CELLULOSE,
	paperboard: CELLULOSE, "cotton balls": CELLULOSE, "folded towel": CELLULOSE, "varnished hardwood": CELLULOSE, "dark wood": CELLULOSE,
	pine: CELLULOSE, birch: CELLULOSE, balsa: CELLULOSE, "domino wood": CELLULOSE, "density set oak": CELLULOSE, "density set pine": CELLULOSE,
	feather: KERATIN, felt: KERATIN, "felt (tennis)": KERATIN, "leather (basketball)": KERATIN,
	polyethylene: [2.3, 950.0], "density set polyethylene": [2.3, 950.0], "bag film": [2.3, 920.0], "bubble wrap": [2.3, 920.0],
	polypropylene: [2.2, 905.0], "density set polypropylene": [2.2, 905.0], "hollow plastic": [2.3, 950.0],
	"ABS plastic": [2.9, 1050.0], "ABS housing": [2.9, 1050.0], "model plastic": [2.9, 1050.0], "cart plastic": [2.9, 1050.0],
	acrylic: [3.0, 1190.0], "density set acrylic": [3.0, 1180.0], "box acrylic": [3.0, 1180.0],
	PET: [3.2, 1380.0], "pillow stuffing": [3.2, 1380.0], "sail cloth": [3.2, 1380.0], "nylon canopy": [3.8, 1150.0],
	"density set nylon": [3.8, 1150.0], velcro: [3.8, 1150.0],
	"PVC (beach ball)": [3.2, 1380.0], "density set PVC": [3.2, 1380.0], "exercise PVC": [3.2, 1380.0], vinyl: [3.2, 1400.0],
	"suction cup vinyl": [3.2, 1300.0], "vinyl rubber": [3.2, 1150.0],
	celluloid: [3.5, 1370.0],
	foam: [2.55, 1050.0], "packing foam": [2.55, 1050.0], "polyurethane foam": [3.5, 1200.0], urethane: [3.5, 1200.0],
	latex: [2.7, 950.0], "balloon latex": [2.7, 920.0], "solid rubber": [2.7, 906.0], "rubber band": [2.7, 1100.0],
	"playground rubber": [3.0, 1100.0], "rubber mat": [3.0, 1100.0],
	glass: [6.5, 2500.0], "glass marble": [6.5, 2518.0], "mirror glass": [6.5, 2500.0], "optical glass": [6.5, 2510.0],
	wax: [2.25, 900.0], cork: [1.7, 200.0],
	"liquid water": WATERY, "puddle water": WATERY, "egg insides": WATERY, grape: WATERY, fruit: WATERY,
	ice: [90.0, 917.0],
	"table salt": [5.9, 2165.0], chalk: [8.0, 2710.0], eggshell: [8.0, 2710.0], "dry sand": [4.5, 2650.0], rice: [3.5, 1450.0],
	"dry pasta": [3.5, 1450.0], "modeling clay": [4.0, 1570.0], "modelling clay": [4.0, 1570.0], "soft clay": [4.0, 1570.0]
}
const EPS_OTHER = 3.0
const LIGHT_KG = 0.05
const LIGHT_M = 0.3
const REACH_T = 2e-6
const GRID_T = 1e-3

const STROKE_C = 1e-8
const STROKES_MAX = 10
const PATCH_AREA = 0.004 // m²
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

export function register_all(f) {
	F = f
	;({ register, ItemType, Prop, Readout, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, CATEGORIES, TYPES, define_material } = f)
	;({ pyRound, fmtG, cube, cos, sin, pySum } = f.py)
	if (!CATEGORIES.includes(CATEGORY)) CATEGORIES.push(CATEGORY)
	_looks()
	_materials()
	_magnets()
	_iron()
	_others()
	_compass()
	_static()
	f.register_build_hook(_magnetize)
	for (const [kind, fn] of [["attracts", goal_attracts], ["repels", goal_repels], ["sticks", goal_sticks], ["lifts", goal_lifts], ["points", goal_points], ["holds", goal_holds], ["levitates", goal_levitates], ["not_attracted", goal_not_attracted]]) {
		f.register_goal_kind(kind, fn)
	}
}

/** add_look only for a name nobody has made yet (as the Python): the catalogs and earlier modules keep their own looks. */
function _look(key, kw) {
	if (!(key in LOOK_FILL)) add_look(key, kw)
}

function _looks() {
	_look("magnet paint", { fill: "#c8302a", shade: "#8e2018", roughness: 0.35, metalness: 0.0, clearcoat: 0.5 })
	_look("nickel plate", { fill: "#c9ccd1", shade: "#8d9096", roughness: 0.18, metalness: 1.0, clearcoat: 0.0 })
	_look("zinc plate", { fill: "#c3c7cc", shade: "#878b90", roughness: 0.3, metalness: 1.0, clearcoat: 0.0 })
	_look("brass", { fill: "#c9a640", shade: "#8f7426", roughness: 0.28, metalness: 1.0, clearcoat: 0.0 })
	_look("copper", { fill: "#c46a3c", shade: "#8a4423", roughness: 0.3, metalness: 1.0, clearcoat: 0.0 })
	_look("foil", { fill: "#d9dcdf", shade: "#9ea2a6", roughness: 0.35, metalness: 1.0, clearcoat: 0.0 })
	_look("latex", { fill: "#d62f3a", shade: "#9a1f27", roughness: 0.3, metalness: 0.0, clearcoat: 0.8 })
	_look("paper", { fill: "#f4f1ea", shade: "#c9c4b8", roughness: 0.85, metalness: 0.0, clearcoat: 0.0 })
}

/** MATERIALS[key] = kw, rolling and side 0.0 unless given (they come last, as dict.setdefault adds them). */
function _mat(key, kw) {
	const values = { ...kw }
	if (!("rolling" in values)) values.rolling = 0.0
	if (!("side" in values)) values.side = 0.0
	if (!Object.hasOwn(MATERIALS, key)) define_material(key, values, [])
}

function _materials() {
	for (const k of GRADE_KEYS) {
		const gr = GRADES[k]
		_mat(`${k} magnet`, { density: gr.density, bounce: 0.4, friction: 0.45, rolling: 0.002, look: gr.look, source: gr.source + " Friction and bounce provisional." })
	}
	_mat("low-carbon steel", { density: STEEL, bounce: 0.6, friction: 0.4, rolling: 0.002, look: "zinc plate", source: "Low-carbon steel wire and sheet, 7850 kg/m³; µ0·M_s ≈ 2.0 T [CHIKAZUMI]. Bounce provisional." })
	_mat("tinplate steel", { density: STEEL, bounce: 0.3, friction: 0.35, rolling: 0.003, look: "steel", source: "Tin-plated low-carbon steel sheet (a food can), 7850 kg/m³. Bounce provisional." })
	_mat("nickel", { density: 8900.0, bounce: 0.6, friction: 0.4, rolling: 0.002, look: "steel", source: "Nickel 8900 kg/m³; µ0·M_s 0.61 T [CHIKAZUMI]." })
	_mat("brass", { density: 8500.0, bounce: 0.6, friction: 0.35, rolling: 0.002, look: "brass", source: "Brass 8400-8730 kg/m³ (CRC Handbook); not magnetic." })
	_mat("copper", { density: 8960.0, bounce: 0.5, friction: 0.35, rolling: 0.002, look: "copper", source: "Copper 8960 kg/m³ (CRC Handbook); not magnetic." })
	_mat("aluminium foil", { density: 2700.0, bounce: 0.2, friction: 0.5, rolling: 0.02, look: "foil", source: "Aluminium 2700 kg/m³; a crumpled ball is mostly air (its density is set by its weight). Not magnetic." })
	_mat("latex", { density: 950.0, bounce: 0.6, friction: 0.6, rolling: 0.02, look: "latex", source: "Natural latex rubber 920-960 kg/m³; a party balloon's wall stretched to about 0.02 mm. Bounce provisional." })
	_mat("paper", { density: 800.0, bounce: 0.1, friction: 0.5, rolling: 0.02, look: "paper", source: "Copy paper 80 g/m² at 0.1 mm (800 kg/m³); a scrap's body is its outline, its weight its paper's." })
}

const _r = (x, n = 5) => pyRound(x, n)
/** float(f"{x:.6g}") */
const g6 = (x) => Number(fmtG(x, 6))

function _face(x, y, angle, width, depth, sigma, z = null) {
	const f = { x: _r(x), y: _r(y), angle, width: _r(width), depth: _r(depth), sigma: pyRound(sigma, 1) }
	if (z !== null) f.z = _r(z)
	return f
}

function _sigma(grade, flip) {
	const gr = GRADES[grade]
	const s = (gr.br * gr.eff) / MU0
	return flip ? -s : s
}

/** The solid angle the rectangle |y| ≤ b, |z| ≤ c of the plane x = 0 subtends at (d, py, pz) (mod_magnetism.py _solid_angle). */
function _solid_angle(d, py, pz, b, c) {
	let t = 0.0
	for (const [sy, yy] of [[1.0, b - py], [-1.0, -b - py]]) {
		for (const [sz, zz] of [[1.0, c - pz], [-1.0, -c - pz]]) t += sy * sz * Math.atan((yy * zz) / (d * Math.sqrt(yy * yy + zz * zz + d * d)))
	}
	return t
}

/** A small dense system by Gaussian elimination with partial pivoting (mod_magnetism.py _solve_linear: the same steps). */
function _solve_linear(A0, rhs0) {
	const n = rhs0.length
	const A = A0.map((row) => row.slice())
	const rhs = rhs0.slice()
	for (let col = 0; col < n; col++) {
		let p = col
		for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r
		;[A[col], A[p]] = [A[p], A[col]]
		;[rhs[col], rhs[p]] = [rhs[p], rhs[col]]
		for (let r = col + 1; r < n; r++) {
			const f = A[r][col] / A[col][col]
			for (let k = col; k < n; k++) A[r][k] -= f * A[col][k]
			rhs[r] -= f * rhs[col]
		}
	}
	const x = new Array(n).fill(0.0)
	for (let r = n - 1; r >= 0; r--) {
		let v = rhs[r]
		for (let k = r + 1; k < n; k++) v -= A[r][k] * x[k]
		x[r] = v / A[r][r]
	}
	return x
}

const _ALNICO_BARS = new Map()
/** An alnico bar's magnetization along its length: [s, M], the cell boundaries' distances from its end and the cells' magnetizations from
 *  the end in (mod_magnetism.py _alnico_bar: the same cells, curve and Newton steps). */
function _alnico_bar(L, W, D) {
	const key = `${L},${W},${D}`
	const seen = _ALNICO_BARS.get(key)
	if (seen !== undefined) return seen
	const n = BAR_NODES.length - 1
	const half = L / 2
	const s = BAR_NODES.map((f) => half * f)
	const xs = []
	for (let j = 0; j < n; j++) xs.push(half - s[j])
	const xc = []
	for (let i = 0; i < n; i++) xc.push(half - (s[i] + s[i + 1]) / 2)
	const [b, c] = [W / 2, D / 2]
	const mean_omega = (d) => {
		let t = 0.0
		for (const [gy, wy] of GAUSS3) for (const [gz, wz] of GAUSS3) t += wy * wz * _solid_angle(d, gy * b, gz * c, b, c)
		return t
	}
	const kq = []
	for (let i = 0; i < n; i++) {
		const row = []
		for (let j = 0; j < n; j++) row.push((mean_omega(xc[i] - xs[j]) - mean_omega(xc[i] + xs[j])) / (4 * Math.PI))
		kq.push(row)
	}
	const K = []
	for (let i = 0; i < n; i++) {
		const row = []
		for (let j = 0; j < n; j++) row.push(kq[i][j] - (j + 1 < n ? kq[i][j + 1] : 0.0))
		K.push(row)
	}
	const mr = GRADES.alnico.br / MU0
	const knee = mr - (1 + ALNICO_CHI) * ALNICO_HC
	const m_of = (h) => {
		const h2 = h * h
		const h4 = h2 * h2
		const h16 = h4 * h4 * h4 * h4
		return mr - ALNICO_CHI * ALNICO_HC * h - knee * (h16 * h4)
	}
	const dm_of = (h) => {
		const h2 = h * h
		const h4 = h2 * h2
		const h16 = h4 * h4 * h4 * h4
		return -ALNICO_CHI * ALNICO_HC - 20 * knee * (h16 * h2 * h)
	}
	let h = new Array(n).fill(0.0)
	for (let it = 0; it < 50; it++) {
		const m = h.map(m_of)
		const res = []
		for (let i = 0; i < n; i++) {
			let f = 0.0
			for (let j = 0; j < n; j++) f += K[i][j] * m[j]
			res.push(f + ALNICO_HC * h[i])
		}
		const jac = []
		for (let i = 0; i < n; i++) {
			const row = []
			for (let j = 0; j < n; j++) row.push(K[i][j] * dm_of(h[j]) + (i === j ? ALNICO_HC : 0.0))
			jac.push(row)
		}
		const step = _solve_linear(jac, res.map((x) => -x))
		const next = h.map((x, i) => Math.min(1.0, Math.max(0.0, x + step[i])))
		let moved = 0.0
		for (let i = 0; i < n; i++) moved = Math.max(moved, Math.abs(next[i] - h[i]))
		h = next
		if (moved < 1e-13) break
	}
	const out = [s, h.map(m_of)]
	_ALNICO_BARS.set(key, out)
	return out
}

/** A straight bar magnet's charges along its length: its end faces, and an alnico bar's inner sheets (mod_magnetism.py _bar_faces). */
function _bar_faces(L, W, D, grade, flip) {
	if (grade !== "alnico") {
		const s = _sigma(grade, flip)
		return [_face(L / 2, 0.0, 0.0, W, D, s), _face(-L / 2, 0.0, Math.PI, W, D, -s)]
	}
	const [s, m] = _alnico_bar(L, W, D)
	const sg = flip ? -1.0 : 1.0
	const faces = [_face(L / 2, 0.0, 0.0, W, D, sg * m[0]), _face(-L / 2, 0.0, Math.PI, W, D, -sg * m[0])]
	const inset = Math.min(W, D) / 10
	const [w, d] = [W - 2 * inset, D - 2 * inset]
	const k = (W * D) / (w * d)
	for (let j = 1; j < m.length; j++) {
		const q = sg * (m[j] - m[j - 1]) * k
		if (pyRound(q, 1) === 0) continue
		const x = L / 2 - s[j]
		faces.push({ ..._face(x, 0.0, 0.0, w, d, q), inner: true }, { ..._face(-x, 0.0, Math.PI, w, d, -q), inner: true })
	}
	return faces
}

function _child_slab(c, part, parent, w, h, depth, lx, ly, material, words, look, kind = null) {
	const s = {
		kind: kind ?? c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look,
		body: { kind: "slab", width: _r(w), height: _r(h), depth }, material,
		at: { x: _r(lx), y: _r(ly) }, parent,
		placeholder: { fill: LOOK_FILL[look] ?? "#888" }, render: { kind: "procedural", shade: LOOK_SHADE[look] ?? "#555" }, depth: 2
	}
	c.sb.solids.push(s)
	return s.id
}

function _magnet_props(default_grade) {
	return [new Prop("material", "Material", default_grade, { kind: "choice", choices: GRADE_KEYS, help: "ceramic (ferrite, B_r 0.39 T), alnico (1.25 T) or neodymium (1.3 T): at the same size a neodymium magnet pulls about 11 times harder than a ceramic one" })]
}

function _show_props() {
	return [
		new Prop("flip", "North on the other side", false, { kind: "bool", help: "Swaps its north and south poles" }),
		new Prop("show_field", "Show field lines", false, { kind: "bool", help: "Draw its magnetic field lines (a drawing only)" })
	]
}

// ---------------------------------------------------------------- permanent magnets
// A part held in mid-air (a fixed magnet, the electromagnet, a rod): the view draws a retort stand behind it (doc solid `stand`)
const _held = (c) => (c.kind === "static" ? { stand: "post" } : {})

function build_bar(c, P) {
	const [L, W, D] = [P.length, P.width, P.depth]
	const grade = P.material
	const mat = c.mat({ base: `${grade} magnet`, overrides: {} })
	const sid = c.slab("magnet", L, W, D, 0.0, 0.0, { material: mat, look: GRADES[grade].look, words: `a ${GRADES[grade].words} bar magnet`, ..._held(c) })
	c.process("magnetism", "field", { role: "magnet", solid: sid, faces: _bar_faces(L, W, D, grade, P.flip) })
}

const ARM_SEAM = 0.0003
function build_horseshoe(c, P) {
	const [H, Wd, D] = [P.height, P.width, P.depth]
	const a = Math.min(P.arm, Wd / 2 - 0.004, H - 0.004)
	const grade = P.material
	const mat = c.mat({ base: `${grade} magnet`, overrides: {} })
	const look = GRADES[grade].look
	const words = `a ${GRADES[grade].words} horseshoe magnet`
	const by = H / 2 - a / 2
	const root = c.slab("bend", Wd, a, D, 0.0, by, { material: mat, look, words })
	const arm_h = H - a
	for (const [part, sx] of [["left", -1], ["right", 1]]) {
		_child_slab(c, part, root, a, arm_h - ARM_SEAM, D, sx * (Wd / 2 - a / 2), -a / 2 - ARM_SEAM - (arm_h - ARM_SEAM) / 2, mat, words, look)
		if (part === "left") Object.assign(c.sb.solids[c.sb.solids.length - 1], _held(c))
	}
	const s = _sigma(grade, P.flip)
	const tip = -a / 2 - arm_h
	c.process("magnetism", "field", { role: "magnet", solid: root, faces: [_face(-(Wd / 2 - a / 2), tip, -Math.PI / 2, a, D, s), _face(Wd / 2 - a / 2, tip, -Math.PI / 2, a, D, -s)] })
}

function build_disc(c, P) {
	const [d, t] = [P.diameter, P.thickness]
	const grade = P.material
	const mass = (((GRADES[grade].density * Math.PI) / 4) * d * d) * t
	const mat = c.mat({ base: `${grade} magnet`, overrides: {}, density: pyRound(mass / (d * t * d), 3) })
	const sid = c.slab("magnet", d, t, d, 0.0, 0.0, { material: mat, look: GRADES[grade].look, words: `a ${GRADES[grade].words} disc magnet`, ..._held(c) })
	const s = _sigma(grade, P.flip)
	const side = d * 0.886226925452758
	c.process("magnetism", "field", { role: "magnet", solid: sid, faces: [_face(0.0, t / 2, Math.PI / 2, side, side, s), _face(0.0, -t / 2, -Math.PI / 2, side, side, -s)] })
}

const RING_GAP = 0.0025
const RING_OFF = 0.0006

function build_rings(c, P) {
	const n = Math.trunc(P.count)
	const [OD, t, Hd] = [P.outer, P.thickness, P.height]
	const ID = Math.min(P.hole, OD - 0.006)
	const grade = P.material
	const look = GRADES[grade].look
	const words = `a ${GRADES[grade].words} ring magnet`
	const wood = c.mat({ base: "varnished hardwood", overrides: {} })
	c.slab("base", 0.08, 0.015, 0.08, 0.0, 0.0075, { kind: "static", material: wood, look: "wood", words: "a wooden base" })
	// (at least 3 mm: a hole near its 5 mm least leaves less than the two clearances, and a dowel 0 m wide would be a line with no sides)
	const dw = Math.max(0.003, ID - 2 * RING_GAP)
	c.slab("dowel", dw, Hd, dw, 0.0, 0.015 + Hd / 2, { kind: "static", material: wood, look: "light wood", words: "a wooden dowel" })
	const mass = ((((GRADES[grade].density * Math.PI) / 4) * (OD * OD - ID * ID))) * t
	const half = (OD - ID) / 2
	const mat = c.mat({ base: `${grade} magnet`, overrides: {}, density: pyRound(mass / (2 * half * t * OD), 3) })
	const s0 = (_sigma(grade, false) * Math.PI) / 4
	const [R, rr] = [OD / 2, ID / 2]
	const m_ring = ((((((GRADES[grade].br * GRADES[grade].eff) / MU0) * Math.PI) / 4) * (OD * OD - ID * ID))) * t
	const gravity = c.settings.gravity
	let y = 0.015 - 0.002
	for (let i = 0; i < n; i++) {
		let gap = 0.002
		if (P.alternate && i > 0 && gravity > 0) {
			const z = Math.sqrt(Math.sqrt((3 * MU0 * m_ring * m_ring) / (2 * Math.PI * (n - i) * mass * gravity)))
			gap = Math.max(0.002, z - t)
		}
		y = i > 0 ? y + gap + t / 2 : y + 0.002 + t / 2
		let up = i % 2 === 0 || !P.alternate
		if (P.flip) up = !up
		const off = i % 2 === 0 ? RING_OFF : -RING_OFF
		const left = c.slab(`ring${i + 1}`, half, t, OD, -(R + rr) / 2 + off, y, { material: mat, look, words })
		_child_slab(c, `ring${i + 1}-r`, left, half, t, OD, R + rr, 0.0, mat, words, look)
		y = y + t / 2
		const s = up ? s0 : -s0
		const faces = []
		for (const [side, sy] of [[1, t / 2], [-1, -t / 2]]) {
			const ang = side > 0 ? Math.PI / 2 : -Math.PI / 2
			const sg = s * side
			faces.push(_face(0.0, sy, ang, half, OD, sg), _face(R + rr, sy, ang, half, OD, sg), _face((R + rr) / 2, sy, ang, ID, half, sg, (R + rr) / 2), _face((R + rr) / 2, sy, ang, ID, half, sg, -(R + rr) / 2))
		}
		c.process("magnetism", `field${i + 1}`, { role: "magnet", solid: left, faces, level: true, center: { x: _r((R + rr) / 2), y: 0.0 } })
	}
}

function build_magnet_cart(c, P) {
	const cart = TYPES.cart
	const Pc = cart.defaults()
	for (const k of ["length", "wheel_diameter", "body_mass"]) Pc[k] = P[k]
	// (the cart's own builder, with the cart's own props: its wheels take their material from them)
	const mine = c.P
	c.P = Pc
	cart.build_fn(c, Pc)
	c.P = mine
	const chassis = c.sb.solids.find((s) => s.id === `${c.item.id}/chassis`)
	const b = chassis.body
	const top = b.kind === "slab" ? b.height / 2 : Math.max(...b.points.map((p) => p.y))
	const grade = P.material
	const [L, W, D] = [P.magnet_length, 0.019, 0.0095]
	const mat = c.mat({ base: `${grade} magnet`, overrides: {} })
	const sx = P.magnet_end === "front" ? 1 : -1
	const x = sx * (P.length / 2 - L / 2)
	const sid = _child_slab(c, "magnet", chassis.id, L, W, D, x, top + W / 2, mat, `a ${GRADES[grade].words} bar magnet`, GRADES[grade].look)
	c.process("magnetism", "field", { role: "magnet", solid: sid, faces: _bar_faces(L, W, D, grade, P.flip) })
}

function _magnets() {
	const bar = [
		new Prop("length", "Length", 0.15, 0.03, 0.2, 0.005, "m"),
		new Prop("width", "Width", 0.019, 0.005, 0.03, 0.001, "m", "Its size up and down in the picture"),
		new Prop("depth", "Depth", 0.0095, 0.005, 0.03, 0.0005, "m", "Its size front to back")
	]
	register(new ItemType("bar-magnet", "Bar magnet", CATEGORY, build_bar, {
		module: "magnetism", props: [..._magnet_props("ceramic"), ...bar, ..._show_props()],
		readouts: [new Readout("pull_mN", "Magnetic pull", { unit: "mN", digits: 2, help: "The magnetic force on it now" }), new Readout("heading_deg", "North end points", { unit: "°", digits: 0, help: "Which way its north pole points, counter-clockwise from the right" })],
		tags: ["magnet", "bar magnet", "poles", "north", "south", "attract", "repel", "ferrite", "ceramic", "alnico", "neodymium", "classroom magnet"],
		description: "A classroom bar magnet, north pole (red, N) on the right unless flipped. Like poles push apart, unlike poles pull " +
			"together, and it pulls iron and steel (clips, nails, steel balls) but not aluminium, copper, brass, plastic, wood or glass. " +
			"The pull falls off steeply with distance: a ceramic bar lifts a paper clip from 1-2 cm, a neodymium one from several cm.",
		source: "Pole faces with σ = B_r/µ0 (the charge model [FUR]); grades [ARN] [KJ]. A ceramic 152 × 19 × 9.5 mm bar weighs 134 g.",
		anchor: "its centre", facts: "ceramic · 15 cm · 134 g · N on the right", edit: [{ kind: "length", prop: "length" }, { kind: "rotate" }]
	}))
	register(new ItemType("horseshoe-magnet", "Horseshoe magnet", CATEGORY, build_horseshoe, {
		module: "magnetism",
		props: [..._magnet_props("alnico"), new Prop("height", "Height", 0.07, 0.03, 0.15, 0.005, "m"), new Prop("width", "Width", 0.06, 0.03, 0.12, 0.005, "m"),
			new Prop("arm", "Arm thickness", 0.018, 0.006, 0.04, 0.001, "m"), new Prop("depth", "Depth", 0.01, 0.005, 0.03, 0.001, "m"), ..._show_props()],
		readouts: [new Readout("pull_mN", "Magnetic pull", { unit: "mN", digits: 2 })],
		tags: ["magnet", "horseshoe", "u magnet", "u-shaped", "poles", "alnico", "attract"],
		description: "A U-shaped magnet with its two poles side by side at the ends of its arms (opening downward; turn it to aim). " +
			"Both poles pull iron, and the field is strongest in the gap between them.",
		source: "Alnico horseshoe 7 × 6 cm, magnetized along the U: its pole faces at the tips [ARN] [FUR].",
		anchor: "its centre", facts: "alnico · 7 cm · poles at the bottom", edit: [{ kind: "rotate" }]
	}))
	register(new ItemType("disc-magnet", "Disc magnet", CATEGORY, build_disc, {
		module: "magnetism",
		props: [..._magnet_props("neodymium"), new Prop("diameter", "Diameter", 0.0127, 0.005, 0.05, 0.0005, "m"), new Prop("thickness", "Thickness", 0.0032, 0.001, 0.02, 0.0005, "m"), ..._show_props()],
		readouts: [new Readout("pull_mN", "Magnetic pull", { unit: "mN", digits: 2 })],
		tags: ["magnet", "disc", "button magnet", "neodymium", "rare earth", "fridge magnet", "round magnet", "strong magnet"],
		description: "A small round magnet lying flat, its poles on its round faces (north up unless flipped). A neodymium one is very strong for its size.",
		source: "NdFeB N42 disc 12.7 × 3.2 mm (K&J D82) [KJ]; its faces as squares of the same area.",
		anchor: "its centre", facts: "N42 · 12.7 × 3.2 mm · 3 g · N up", edit: [{ kind: "rotate" }]
	}))
	register(new ItemType("ring-magnets", "Ring magnets on a dowel", CATEGORY, build_rings, {
		module: "magnetism",
		props: [..._magnet_props("ceramic"), new Prop("count", "Rings", 3, 1, 6, 1, "", { kind: "int" }),
			new Prop("alternate", "Like faces together", true, { kind: "bool", help: "Every other ring turned over, so neighbours push apart and float" }),
			new Prop("outer", "Outer diameter", 0.025, 0.015, 0.06, 0.001, "m"), new Prop("hole", "Hole", 0.009, 0.005, 0.02, 0.0005, "m"),
			new Prop("thickness", "Thickness", 0.005, 0.003, 0.02, 0.0005, "m"), new Prop("height", "Dowel height", 0.15, 0.06, 0.4, 0.01, "m"), ..._show_props()],
		readouts: [new Readout("pull_mN", "Magnetic push", { unit: "mN", digits: 2 })],
		tags: ["magnet", "ring magnet", "levitate", "levitating", "floating magnets", "magnetic tower", "dowel", "repel", "stack"],
		description: "Ring magnets threaded on an upright wooden dowel on a base. With like faces together each ring floats above the one " +
			"below it, where the push up equals the weight above (the bottom gap is the smallest); with unlike faces they snap together.",
		source: "Ceramic rings Ø 25 mm, 9 mm hole, 5 mm thick (10.5 g) [ARN]; faces poled on the flat sides.",
		anchor: "the middle of the base's bottom (on the table)", facts: "3 ceramic rings · Ø 25 mm · float apart"
	}))
	const cart_props = [
		new Prop("magnet_end", "Magnet at", "front", { kind: "choice", choices: ["front", "back"], help: "Which end of the cart the bar magnet sits at" }),
		new Prop("magnet_length", "Magnet length", 0.1, 0.03, 0.15, 0.005, "m"),
		new Prop("length", "Cart length", 0.22, 0.11, 0.55, 0.005, "m"), new Prop("wheel_diameter", "Wheel diameter", 0.05, 0.025, 0.1, 0.002, "m"),
		new Prop("body_mass", "Cart weight", 0.2, 0.04, 1.2, 0.005, "kg")
	]
	register(new ItemType("magnet-cart", "Magnet cart", CATEGORY, build_magnet_cart, {
		module: "magnetism", props: [..._magnet_props("ceramic"), ...cart_props, ..._show_props()],
		readouts: [new Readout("pull_mN", "Magnetic push or pull", { unit: "mN", digits: 2 })],
		tags: ["magnet car", "magnet cart", "magnetic car", "push without touching", "repel", "attract", "cart", "trolley"],
		description: "A wooden cart with a bar magnet on its deck at the front (north pole forward unless flipped). Two magnet carts with " +
			"like poles facing push each other apart without touching; with unlike poles they roll together.",
		source: "The catalog's cart with a ceramic bar magnet [ARN] on its deck.",
		anchor: "the ground under its middle, where the wheels touch", facts: "cart + 10 cm ceramic magnet", edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- soft iron and steel
function _soft(c, part, sid, w, h, d, volume, material = "low-carbon steel", round_ = false, x = 0.0, y = 0.0) {
	const m = SOFT[material]
	const rec = { role: "soft", solid: sid, x: _r(x), y: _r(y), w: _r(w), h: _r(h), d: _r(d), volume: g6(volume), ms: m.ms, chi: m.chi }
	if (round_) rec.round = true
	c.process("magnetism", part, rec)
}

// Magnetically a clip is its wire (mod_magnetism.py CLIP_WIRE, CLIP_BUNDLE)
const CLIP_WIRE = 0.0009
const CLIP_BUNDLE = 0.0019
const COLOURS = { silver: null, red: "#c0392b", blue: "#2e6fc4", green: "#2f9a4c", yellow: "#e2b52a", black: "#2a2a2a" }

// `facing` (mod_magnetism.py FACINGS): "edge-on" as it lies, "face-on" stood on its edge, its face toward the camera (its side outline is its face)
const FACINGS = ["edge-on", "face-on"]
const FACING_HELP = "edge-on: as it lies (flat, its face up), a side view sees its thin edge; face-on: standing on its edge with its face toward you " +
	"(the same steel and weight turned a quarter turn: what you see is what touches)"
// a regular octagon's corner at 22.5° (exact square roots: the same bits as Python's)
const OCT_C = Math.sqrt(2.0 + Math.sqrt(2.0)) / 2.0
const OCT_S = Math.sqrt(2.0 - Math.sqrt(2.0)) / 2.0
const facing_camera = (P) => P.facing === "face-on"
/** A clip standing on its edge, its loops toward the camera (mod_magnetism.py clip_face): its side outline L × Wd with pointed ends, T front to back. */
function clip_face(c, part, L, Wd, T, m, lx = 0.0, ly = 0.0, langle = 0.0, base = "low-carbon steel", kw = {}) {
	const e = Math.min(0.003, L / 4)
	const pts = [[L / 2, 0.0], [L / 2 - e, Wd / 2], [-L / 2 + e, Wd / 2], [-L / 2, 0.0], [-L / 2 + e, -Wd / 2], [L / 2 - e, -Wd / 2]].map(([x, y]) => [pyRound(x, 5), pyRound(y, 5)])
	const terms = []
	for (let k = 0; k < 6; k++) terms.push(pts[k][0] * pts[(k + 1) % 6][1] - pts[(k + 1) % 6][0] * pts[k][1])
	const area = pySum(terms) / 2
	const mat = c.mat({ base, overrides: {}, density: pyRound(m / (area * T), 3) })
	return c.poly(part, pts, T, lx, ly, { langle, material: mat, ...kw })
}

function build_clips(c, P) {
	const n = Math.trunc(P.count)
	const sp = P.spacing
	const colour = has(COLOURS, P.color) ? COLOURS[P.color] : null
	const [L, T, Wd, m] = [0.033, 0.001, 0.008, 0.00045]
	const face = facing_camera(P)
	const mat = c.mat({ base: "low-carbon steel", overrides: {}, density: pyRound(m / (L * T * Wd), 3) })
	const x0 = (-(n - 1) * sp) / 2
	const extra = colour === null ? {} : { color: colour }
	for (let i = 0; i < n; i++) {
		if (face) {
			const sid = clip_face(c, `clip${i + 1}`, L, Wd, T, m, x0 + i * sp, 0.0, 0.0, "low-carbon steel", { look: "zinc plate", words: "a steel paper clip", ...extra })
			_soft(c, `iron${i + 1}`, sid, L, CLIP_BUNDLE, CLIP_WIRE, m / STEEL)
		} else {
			const sid = c.slab(`clip${i + 1}`, L, T, Wd, x0 + i * sp, 0.0, { material: mat, look: "zinc plate", words: "a steel paper clip", ...extra })
			_soft(c, `iron${i + 1}`, sid, L, CLIP_WIRE, CLIP_BUNDLE, m / STEEL)
		}
	}
}

function build_nail(c, P) {
	const [L, dia] = [P.length, P.diameter]
	const r = dia / 2
	const p = Math.min(0.004, L / 6)
	const [head_d, head_t] = [pyRound(dia * 2.2, 5), 0.001]
	const vol_round = Math.PI * r * r * (L - p) + (Math.PI * r * r * p) / 3
	const vol_poly = (2 * r * (L - p) + r * p) * dia
	const mat = c.mat({ base: "low-carbon steel", overrides: {}, density: pyRound((STEEL * vol_round) / vol_poly, 3) })
	const pts = [[-L / 2, -r], [L / 2 - p, -r], [L / 2, 0.0], [L / 2 - p, r], [-L / 2, r]]
	const sid = c.poly("shank", pts, dia, 0.0, 0.0, { material: mat, look: "steel", words: "an iron nail" })
	const head_mass = ((((STEEL * Math.PI) / 4) * head_d) * head_d) * head_t
	const hmat = c.mat({ base: "low-carbon steel", overrides: {}, density: pyRound(head_mass / (head_t * head_d * head_d), 3) })
	_child_slab(c, "head", sid, head_t, head_d, head_d, -L / 2 - head_t / 2, 0.0, hmat, "the nail's head", "steel")
	_soft(c, "iron", sid, L, dia, dia, vol_round)
}

function build_washer(c, P) {
	const [od, t] = [P.diameter, P.thickness]
	const hole = od * 0.525
	const vol = ((Math.PI / 4) * (od * od - hole * hole)) * t
	if (facing_camera(P)) {
		// on its edge, its face toward the camera: a regular octagon through the rim, t front to back; magnetized as the square block between its flats
		const R = od / 2
		const pts = [[OCT_C, OCT_S], [OCT_S, OCT_C], [-OCT_S, OCT_C], [-OCT_C, OCT_S], [-OCT_C, -OCT_S], [-OCT_S, -OCT_C], [OCT_S, -OCT_C], [OCT_C, -OCT_S]].map(([a, b]) => [pyRound(R * a, 5), pyRound(R * b, 5)])
		const terms = []
		for (let k = 0; k < 8; k++) terms.push(pts[k][0] * pts[(k + 1) % 8][1] - pts[(k + 1) % 8][0] * pts[k][1])
		const area = pySum(terms) / 2
		const pmat = c.mat({ base: "low-carbon steel", overrides: {}, density: pyRound((STEEL * vol) / (area * t), 3) })
		const psid = c.poly("washer", pts, t, 0.0, 0.0, { material: pmat, look: "zinc plate", words: "a steel washer" })
		_soft(c, "iron", psid, 2 * R * OCT_C, 2 * R * OCT_C, t, vol)
		return
	}
	const mat = c.mat({ base: "low-carbon steel", overrides: {}, density: pyRound((STEEL * vol) / (od * t * od), 3) })
	const sid = c.slab("washer", od, t, od, 0.0, 0.0, { material: mat, look: "zinc plate", words: "a steel washer" })
	_soft(c, "iron", sid, od, t, od, vol)
}

function build_can(c, P) {
	const [D, H, m] = [P.diameter, P.height, P.mass]
	const mat = c.mat({ base: "tinplate steel", overrides: {}, density: pyRound(m / (D * H * D), 3) })
	const sid = c.slab("can", D, H, D, 0.0, 0.0, { material: mat, look: "steel", words: "an empty steel food can" })
	const box = D * H * D
	const steel = m / STEEL
	c.process("magnetism", "iron", { role: "soft", solid: sid, x: 0.0, y: 0.0, w: _r(D), h: _r(H), d: _r(D), volume: g6(box), ms: pyRound((SOFT["tinplate steel"].ms * steel) / box, 1), chi: SOFT["tinplate steel"].chi })
}

function build_can_side(c, P) {
	const [D, H] = [P.diameter, P.height]
	const steel = P.material === "steel"
	const m = P.mass
	const r = D / 2
	const base = steel ? "tinplate steel" : "aluminium can"
	const mat = c.mat({ base, overrides: {}, density: pyRound(m / (((4 / 3) * Math.PI) * cube(r)), 4) })
	const sid = c.ball("can", r, 0.0, 0.0, {
		material: mat, look: steel ? "steel" : "aluminium", inertia: 0.85, shape: "cylinder", length: _r(H), depth3d: _r(H),
		words: steel ? "an empty steel can on its side" : "an empty aluminium can on its side"
	})
	if (steel) {
		const side = D * 0.886226925452758
		const box = side * side * H
		c.process("magnetism", "iron", { role: "soft", solid: sid, x: 0.0, y: 0.0, w: _r(side), h: _r(side), d: _r(H), volume: g6(box), ms: pyRound((SOFT["tinplate steel"].ms * (m / STEEL)) / box, 1), chi: SOFT["tinplate steel"].chi, round: true })
	}
}

const [AWG24_D, AWG24_OHM] = [0.000511, 0.0842]
const [AA_V, AA_OHM, LEADS] = [1.5, 0.2, 0.3]

/** The coil's current (A): the cells' voltage over the wire's resistance and theirs (mod_magnetism.py coil_amps). */
export function coil_amps(turns, cells, dia) {
	const wire = turns * Math.PI * (dia + AWG24_D) + LEADS
	return (cells * AA_V) / (wire * AWG24_OHM + cells * AA_OHM)
}

function build_electromagnet(c, P) {
	const [L, dia] = [P.length, P.diameter]
	const [n, cells] = [Math.trunc(P.turns), Math.trunc(P.cells)]
	const r = dia / 2
	const p = Math.min(0.004, L / 6)
	const vol_round = Math.PI * r * r * (L - p) + (Math.PI * r * r * p) / 3
	const vol_poly = (2 * r * (L - p) + r * p) * dia
	const mat = c.mat({ base: "low-carbon steel", overrides: {}, density: pyRound((STEEL * vol_round) / vol_poly, 3) })
	const pts = [[-L / 2, -r], [L / 2 - p, -r], [L / 2, 0.0], [L / 2 - p, r], [-L / 2, r]]
	const sid = c.poly("core", pts, dia, 0.0, 0.0, { langle: -90.0, material: mat, look: "steel", words: "an iron nail wrapped with copper wire", ..._held(c) })
	let amps = P.on ? coil_amps(n, cells, dia) : 0.0
	if (P.flip) amps = -amps
	const current = [{ t: pyRound(P.on_at, 4), amps: pyRound(amps, 4) }]
	c.process("magnetism", "core", {
		role: "soft", solid: sid, x: 0.0, y: 0.0, w: _r(L), h: _r(dia), d: _r(dia), volume: g6(vol_round),
		ms: SOFT["low-carbon steel"].ms, chi: SOFT["low-carbon steel"].chi, coil: { turns: n, length: _r(L - 0.01), current }
	})
}

function _iron() {
	const soft_read = () => [
		new Readout("magnetized", "Magnetized", { unit: "%", digits: 1, help: "How strongly a magnet's field has magnetized it, % of its steel's most" }),
		new Readout("pull_mN", "Magnetic pull", { unit: "mN", digits: 2, help: "The magnetic force on it now" })
	]
	register(new ItemType("paper-clip", "Paper clips", CATEGORY, build_clips, {
		module: "magnetism",
		props: [new Prop("count", "Clips", 1, 1, 30, 1, "", { kind: "int" }), new Prop("spacing", "Spacing", 0.04, 0.034, 0.3, 0.001, "m", "Between the clips' middles, in a row"),
			new Prop("color", "Colour", "silver", { kind: "choice", choices: Object.keys(COLOURS), help: "A coated clip is still steel inside" }),
			new Prop("facing", "To the camera", "edge-on", { kind: "choice", choices: FACINGS, help: FACING_HELP })],
		readouts: soft_read(),
		tags: ["paper clip", "paperclip", "clip", "steel", "iron", "magnetic", "attracted", "pick up", "chain"],
		description: "Steel paper clips (33 mm, 0.45 g) lying flat in a row. A magnet pulls them whichever pole is near; a clip on a magnet " +
			"becomes a magnet itself and holds the next one (a chain). Face-on stands them on their edges, their loops toward you.",
		source: "Gem no. 1 clip: 0.9 mm low-carbon steel wire, 0.45 g; soft iron, magnetized by the field [FUR] [AHARONI].",
		anchor: "the middle of the row, at the clips' middle", facts: "steel · 33 mm · 0.45 g each"
	}))
	register(new ItemType("iron-nail", "Iron nail", CATEGORY, build_nail, {
		module: "magnetism",
		props: [new Prop("length", "Length", 0.051, 0.02, 0.15, 0.001, "m"), new Prop("diameter", "Shank diameter", 0.0029, 0.0015, 0.006, 0.0001, "m")],
		readouts: soft_read(),
		tags: ["nail", "iron", "steel", "magnetic", "attracted", "core"],
		description: "A common steel nail (51 mm, 3 g) lying on its side. A magnet pulls it and turns it to lie along the field.",
		source: "2 in. common nail: 51 mm × 2.9 mm shank, about 3 g; low-carbon steel [FUR].",
		anchor: "the middle of its shank", facts: "steel · 51 mm · 3 g"
	}))
	register(new ItemType("steel-washer", "Steel washer", CATEGORY, build_washer, {
		module: "magnetism",
		props: [new Prop("diameter", "Diameter", 0.016, 0.008, 0.05, 0.0005, "m"), new Prop("thickness", "Thickness", 0.0016, 0.0008, 0.005, 0.0001, "m"),
			new Prop("facing", "To the camera", "edge-on", { kind: "choice", choices: FACINGS, help: FACING_HELP })],
		readouts: soft_read(),
		tags: ["washer", "steel", "metal", "magnetic", "ring"],
		description: "A flat zinc-plated steel washer (M8: 16 mm, 1.8 g) lying flat. Magnetic. Face-on stands it on its edge, its ring " +
			"toward you (magnetized along its face, it is pulled from farther than one lying flat).",
		source: "DIN 125 M8 washer: 16 mm, 8.4 mm hole, 1.6 mm thick, 1.8 g.", anchor: "its centre", facts: "steel · 16 mm · 1.8 g"
	}))
	register(new ItemType("steel-can", "Steel can", CATEGORY, build_can, {
		module: "magnetism",
		props: [new Prop("diameter", "Diameter", 0.075, 0.05, 0.12, 0.001, "m"), new Prop("height", "Height", 0.11, 0.05, 0.2, 0.001, "m"),
			new Prop("mass", "Weight", 0.05, 0.02, 0.2, 0.001, "kg", "Empty")],
		readouts: soft_read(),
		tags: ["tin can", "steel can", "food can", "can", "metal", "magnetic", "recycling"],
		description: "An empty tin-plated steel food can standing up (7.5 × 11 cm, 50 g). A magnet pulls it; an aluminium soda can it does not.",
		source: "A 15 oz food can: tin-plated low-carbon steel, Ø 75 × 110 mm, about 50 g empty [FUR].",
		anchor: "its centre", facts: "steel · Ø 7.5 × 11 cm · 50 g", edit: [{ kind: "rotate" }]
	}))
	register(new ItemType("battery-electromagnet", "Electromagnet (nail and battery)", CATEGORY, build_electromagnet, {
		dynamic: false, module: "magnetism",
		props: [new Prop("turns", "Turns of wire", 50, 5, 300, 5, "", { kind: "int", help: "More turns, a stronger magnet (until the nail's iron is full)" }),
			new Prop("cells", "AA batteries", 2, 1, 4, 1, "", { kind: "int", help: "1.5 V each, in series: more batteries, more current" }),
			new Prop("on", "Switched on", true, { kind: "bool" }), new Prop("on_at", "Switch on at", 0.0, 0.0, 10.0, 0.1, "s"),
			new Prop("flip", "Current the other way", false, { kind: "bool", help: "Swaps its north and south ends (clips are pulled either way)" }),
			new Prop("length", "Nail length", 0.051, 0.03, 0.15, 0.001, "m"), new Prop("diameter", "Nail diameter", 0.0029, 0.0015, 0.006, 0.0001, "m"),
			new Prop("show_field", "Show field lines", false, { kind: "bool", help: "Draw its magnetic field lines (a drawing only)" })],
		readouts: [new Readout("amps", "Current", { unit: "A", digits: 2, help: "Through its coil" }), new Readout("magnetized", "Magnetized", { unit: "%", digits: 1, help: "How strongly its nail is magnetized, % of the most iron takes" }),
			new Readout("pull_mN", "Magnetic pull", { unit: "mN", digits: 2 })],
		tags: ["electromagnet", "coil", "nail", "battery", "wire", "turns", "magnet", "current", "switch"],
		description: "An iron nail wrapped with turns of copper wire on AA batteries, held point down in a clamp. Switched on, current in the coil makes " +
			"the nail a magnet: it picks up paper clips. More turns or more batteries make it stronger, until the nail's iron is fully " +
			"magnetized; switched off it lets them go. It has its own AA batteries (switch it with on and on_at): the circuits module has no coil to wire one into a circuit.",
		source: "24 AWG wire 84.2 mΩ/m; AA 1.5 V, about 0.2 Ω; coil field n·I in a nail core magnetized up to M_s (2.0 T) [AHARONI] [CHIKAZUMI].",
		anchor: "the middle of the nail", facts: "50 turns · 2 AA · ≈ 6 A", edit: [{ kind: "rotate" }]
	}))
	register(new ItemType("can-on-side", "Empty can on its side", CATEGORY, build_can_side, {
		module: "magnetism",
		props: [new Prop("material", "Can", "aluminium", { kind: "choice", choices: ["aluminium", "steel"], help: "An aluminium soda can (15 g) is not magnetic; a steel food can (50 g) is" }),
			new Prop("diameter", "Diameter", 0.0662, 0.04, 0.12, 0.001, "m"), new Prop("height", "Length", 0.1224, 0.05, 0.2, 0.001, "m"),
			new Prop("mass", "Weight", 0.015, 0.005, 0.2, 0.001, "kg", "Empty: soda can 15 g, food can 50 g")],
		readouts: soft_read(),
		tags: ["can", "soda can", "empty can", "rolling can", "aluminium can", "steel can", "tin can", "static", "roll"],
		description: "An empty can lying on its side, free to roll. A charged balloon held near an aluminium one rolls it toward the balloon " +
			"(the metal is polarized); a magnet pulls only a steel one.",
		source: "A 12 oz soda can, Ø 66 × 122 mm, 15 g empty, aluminium (not magnetic) [FUR].",
		anchor: "its centre (its axis)", facts: "aluminium · 15 g · rolls"
	}))
}

// ---------------------------------------------------------------- things a magnet does not pull
function build_plastic_clip(c, P) {
	const [L, T, Wd, m] = [0.033, 0.0012, 0.008, 0.0003]
	const colour = (has(COLOURS, P.color) ? COLOURS[P.color] : null) || "#2e6fc4"
	if (facing_camera(P)) {
		clip_face(c, "clip", L, Wd, T, m, 0.0, 0.0, 0.0, "polypropylene", { look: "plastic", words: "a plastic paper clip", color: colour })
		return
	}
	const mat = c.mat({ base: "polypropylene", overrides: {}, density: pyRound(m / (L * T * Wd), 3) })
	c.slab("clip", L, T, Wd, 0.0, 0.0, { material: mat, look: "plastic", words: "a plastic paper clip", color: colour })
}

function build_foil(c, P) {
	const [d, m] = [P.diameter, P.mass]
	const r = d / 2
	const mat = c.mat({ base: "aluminium foil", overrides: {}, density: pyRound(m / (((4 / 3) * Math.PI) * cube(r)), 3) })
	c.ball("ball", r, 0.0, 0.0, { material: mat, look: "foil", words: "a crumpled aluminium foil ball" })
}

function build_copper(c, P) {
	const mat = c.mat({ base: "copper", overrides: {}, density: pyRound(0.002 / (0.02 * 0.008 * 0.008), 3) })
	c.slab("coil", 0.02, 0.008, 0.008, 0.0, 0.0, { material: mat, look: "copper", words: "a little coil of copper wire" })
}

function build_key(c, P) {
	const mat = c.mat({ base: "brass", overrides: {}, density: pyRound(0.006 / (0.05 * 0.002 * 0.022), 3) })
	c.slab("key", 0.05, 0.002, 0.022, 0.0, 0.0, { material: mat, look: "brass", words: "a brass key" })
}

function build_bead(c, P) {
	c.ball("bead", P.diameter / 2, 0.0, 0.0, { material: c.mat({ base: "varnished hardwood", overrides: {} }), look: "wood", words: "a wooden bead" })
}

const SHEETS = {
	paper: [0.0001, 0.001, "paper", "paper"],
	cardboard: [0.002, 0.002, "cardboard", "cardboard"],
	plastic: [0.002, 0.002, "ABS plastic", "plastic"],
	glass: [0.003, 0.003, "glass", "glass"],
	aluminium: [0.001, 0.001, "aluminium", "aluminium"],
	steel: [0.0005, 0.001, "low-carbon steel", "steel"]
}

function build_sheet(c, P) {
	const kind = P.material
	const [real, body_t, base, look] = SHEETS[kind]
	const w = P.width
	const mat = c.mat({ base, overrides: {}, density: pyRound((MATERIALS[base].density * real) / body_t, 3) })
	const sid = c.slab("sheet", body_t, w, w, 0.0, w / 2, { material: mat, look, words: `a sheet of ${kind}` })
	if (kind === "steel") _soft(c, "iron", sid, body_t, w, w, real * w * w)
}

function build_clip_thread(c, P) {
	const th = P.thread
	const [L, T, Wd, m] = [0.033, 0.001, 0.008, 0.00045]
	c.slab("anchor", 0.02, 0.006, 0.02, 0.0, 0.003, { kind: "static", material: c.mat({ base: "modeling clay", overrides: {} }), look: "clay", words: "a lump of putty" })
	const face = facing_camera(P)
	let sid
	if (face) sid = clip_face(c, "clip", L, Wd, T, m, 0.0, 0.006 + th + L / 2, 90.0, "low-carbon steel", { look: "zinc plate", words: "a steel paper clip on a thread" })
	else {
		const mat = c.mat({ base: "low-carbon steel", overrides: {}, density: pyRound(m / (L * T * Wd), 3) })
		sid = c.slab("clip", L, T, Wd, 0.0, 0.006 + th + L / 2, { langle: 90.0, material: mat, look: "zinc plate", words: "a steel paper clip on a thread" })
	}
	c.joint("rope", "thread", { a: null, b: "clip", anchorA: [0.0, 0.006], anchorB: [-L / 2, 0.0], length: _r(th), thickness: 0.0005 })
	_soft(c, "iron", sid, L, face ? CLIP_BUNDLE : CLIP_WIRE, face ? CLIP_WIRE : CLIP_BUNDLE, m / STEEL)
}

function _others() {
	register(new ItemType("plastic-clip", "Plastic clip", CATEGORY, build_plastic_clip, {
		module: "magnetism", props: [new Prop("color", "Colour", "blue", { kind: "choice", choices: Object.keys(COLOURS).filter((k) => k !== "silver") }),
			new Prop("facing", "To the camera", "edge-on", { kind: "choice", choices: FACINGS, help: FACING_HELP })],
		tags: ["plastic clip", "plastic", "not magnetic", "non-magnetic", "test object"],
		description: "An all-plastic paper clip (0.3 g). Not magnetic: a magnet does not pull it at all.",
		source: "Polypropylene clip, 33 mm, about 0.3 g.", anchor: "its centre", facts: "plastic · 0.3 g · not magnetic"
	}))
	register(new ItemType("foil-ball", "Foil ball", CATEGORY, build_foil, {
		module: "magnetism", props: [new Prop("diameter", "Diameter", 0.02, 0.008, 0.06, 0.001, "m"), new Prop("mass", "Weight", 0.001, 0.0002, 0.01, 0.0001, "kg")],
		tags: ["aluminium foil", "aluminum foil", "tin foil", "foil ball", "metal", "not magnetic", "conductor"],
		description: "A crumpled ball of aluminium kitchen foil (2 cm, 1 g). A metal, but not magnetic; it conducts, so a charged balloon pulls it.",
		source: "Kitchen foil 16 µm: a 15 × 15 cm sheet weighs about 1 g. Aluminium is not ferromagnetic [FUR].",
		anchor: "its centre", facts: "aluminium · 1 g · not magnetic"
	}))
	register(new ItemType("copper-wire", "Copper wire coil", CATEGORY, build_copper, {
		module: "magnetism", tags: ["copper", "wire", "metal", "not magnetic", "conductor"],
		description: "A little coil of bare copper wire (2 g). A metal, but a magnet does not pull it.",
		source: "Copper 8960 kg/m³ (CRC Handbook); diamagnetic, χ ≈ −1e-5: no pull you could see.", anchor: "its centre", facts: "copper · 2 g · not magnetic"
	}))
	register(new ItemType("brass-key", "Brass key", CATEGORY, build_key, {
		module: "magnetism", tags: ["key", "brass", "metal", "not magnetic"],
		description: "A brass house key lying flat (5 cm, 6 g). Brass (copper and zinc) is not magnetic.",
		source: "A brass key blank is about 6 g. Brass is not ferromagnetic [FUR].", anchor: "its centre", facts: "brass · 6 g · not magnetic"
	}))
	register(new ItemType("wooden-bead", "Wooden bead", CATEGORY, build_bead, {
		module: "magnetism", props: [new Prop("diameter", "Diameter", 0.016, 0.006, 0.04, 0.001, "m")],
		tags: ["bead", "wood", "not magnetic", "test object"],
		description: "A round wooden bead (16 mm, 1.5 g). Not magnetic.", source: "Beech bead 16 mm, 700 kg/m³: 1.5 g.",
		anchor: "its centre", facts: "wood · 1.5 g · not magnetic"
	}))
	register(new ItemType("barrier-sheet", "Sheet (barrier)", CATEGORY, build_sheet, {
		dynamic: false, module: "magnetism",
		props: [new Prop("material", "Material", "cardboard", { kind: "choice", choices: Object.keys(SHEETS), help: "Paper, cardboard, plastic, glass and aluminium let a magnet's pull straight through; a steel sheet (0.5 mm) takes the field into itself and blocks most of a ceramic magnet's pull (and is itself pulled); a strong neodymium magnet saturates it and pulls through about half" }),
			new Prop("width", "Size", 0.1, 0.04, 0.3, 0.005, "m")],
		readouts: [new Readout("magnetized", "Magnetized", { unit: "%", digits: 1 })],
		tags: ["sheet", "barrier", "paper", "cardboard", "through", "shield", "between", "screen", "plate"],
		description: "A square sheet standing upright in a clip stand, to put between a magnet and what it pulls. The pull passes through " +
			"paper, cardboard, plastic, glass and aluminium unchanged; a steel sheet blocks most of it (a ceramic magnet's: 88 % at 8 mm).",
		source: "Non-magnetic materials have µ_r = 1 to within 1e-5: the field passes as through air [FUR].",
		anchor: "the middle of its bottom edge (on the table)", facts: "10 × 10 cm · cardboard", edit: [{ kind: "rotate" }]
	}))
	register(new ItemType("clip-on-thread", "Clip on a thread", CATEGORY, build_clip_thread, {
		module: "magnetism", props: [new Prop("thread", "Thread length", 0.1, 0.02, 0.4, 0.005, "m"),
			new Prop("facing", "To the camera", "edge-on", { kind: "choice", choices: FACINGS, help: FACING_HELP })],
		readouts: [new Readout("pull_mN", "Magnetic pull", { unit: "mN", digits: 2 })],
		tags: ["thread", "string", "floating clip", "paper clip", "hover", "tethered", "without touching"],
		description: "A steel paper clip tied by a thread to a lump of putty on the table, standing up at the thread's end. Hold a magnet " +
			"(fixed) just above it and the clip floats in the air on its taut thread without touching the magnet; with no magnet it flops over.",
		source: "Gem no. 1 clip, 0.45 g [FUR]; a cotton thread.", anchor: "the putty's bottom middle (on the table)", facts: "10 cm thread"
	}))
}

// ---------------------------------------------------------------- compass and the Earth's field
const EARTH_T = 2e-5

function build_compass(c, P) {
	const D = P.size
	const L = 0.8 * D
	const w = 0.1 * L
	const t = 0.0005
	c.slab("foot", pyRound(0.6 * D, 5), 0.008, pyRound(0.6 * D, 5), 0.0, -D / 2 - 0.004, { kind: "static", material: c.mat({ base: "ABS plastic", overrides: {} }), look: "plastic", words: "the compass's foot", color: "#2b2b2b" })
	const m_n = (((STEEL * L * w) / 2) * t)
	const inertia = (m_n * (L * L + w * w)) / 24
	const north = P.north === "right" ? 1 : -1
	// (the needle always turns on its pivot, a held compass's too; it starts pointing north: to the left when north is to the left)
	const sid = c.poly("needle", [[L / 2, 0.0], [0.0, w / 2], [-L / 2, 0.0], [0.0, -w / 2]], t, 0.0, 0.0, {
		langle: north > 0 ? 0.0 : 180.0, material: c.mat({ base: "low-carbon steel", overrides: {} }), kind: "dynamic", look: "steel", words: "a compass needle", pivot: { x: 0.0, y: 0.0 }, damping: Number(fmtG(4 * inertia, 4))
	})
	const M = 5e5
	const q = M * w * t
	const s = q / ((w / 2) * t)
	c.process("magnetism", "field", { role: "magnet", solid: sid, faces: [_face(L / 4, 0.0, 0.0, w / 2, t, s), _face(-L / 4, 0.0, Math.PI, w / 2, t, -s)], needle: true })
	if (P.earth) c.process("magnetism", "earth", { role: "earth", x: north * EARTH_T, y: 0.0 })
}

function _compass() {
	register(new ItemType("compass", "Compass", CATEGORY, build_compass, {
		module: "magnetism",
		props: [new Prop("size", "Size", 0.05, 0.03, 0.12, 0.005, "m", "The case's diameter"),
			new Prop("earth", "Earth's field", true, { kind: "bool", help: "The Earth's own field (20 µT, level) turns the needle north when no magnet is near" }),
			new Prop("north", "North is", "right", { kind: "choice", choices: ["right", "left"], help: "Which way north is in the picture" })],
		readouts: [new Readout("heading_deg", "Needle points", { unit: "°", digits: 0, help: "Which way the needle's north (red) end points, counter-clockwise from the right" })],
		tags: ["compass", "needle", "north", "direction", "navigation", "field", "earth's field"],
		description: "A compass standing face-on (its needle turns in the picture's plane). Its red end points north (to the right) " +
			"unless a magnet is near: then it lines up with the magnet's field, its red end toward the magnet's south pole.",
		source: "A magnetized steel needle (4 cm) on a pivot in a fluid-filled case; Earth's horizontal field 20 µT [WMM]. A real compass lies flat.",
		anchor: "the needle's pivot (the case's centre)", facts: "Ø 5 cm · red end north"
	}))
}

// ---------------------------------------------------------------- static electricity
function _patch(rubbed, side, r) {
	const strokes = Math.min(STROKES_MAX, Math.max(0, Math.trunc(rubbed)))
	const q = -strokes * STROKE_C
	const a = Math.sqrt(PATCH_AREA / Math.PI)
	const depth = a / Math.sqrt(2)
	const [ux, uy] = SIDES[side]
	const d = Math.max(0.0, r - depth)
	return [q, [ux * d, uy * d], depth]
}

const DIAG = 0.7071067811865476
const SIDES = { bottom: [0.0, -1.0], top: [0.0, 1.0], left: [-1.0, 0.0], right: [1.0, 0.0], "lower right": [DIAG, -DIAG], "lower left": [-DIAG, -DIAG] }
const BALLOON_COLOURS = { red: "#d62f3a", blue: "#2f62d6", yellow: "#f2c230", green: "#2fa54a", pink: "#ec6fa8", orange: "#f08a24", purple: "#8a4fc8", white: "#f2f2f2" }

function build_balloon(c, P) {
	const D = P.diameter
	const r = D / 2
	const wall = 0.00002
	const mass = 0.0035 * (D / 0.25) * (D / 0.25) + (((0.03 * 1.2 * 4) / 3) * Math.PI) * cube(r)
	const shell = ((4 / 3) * Math.PI) * (cube(r) - cube(r - wall))
	const mat = c.mat({ base: "latex", overrides: {}, density: pyRound(mass / shell, 3) })
	const sid = c.ball("balloon", r, 0.0, 0.0, { material: mat, look: "latex", words: "a party balloon", wall, color: BALLOON_COLOURS[P.color] })
	const [q, [px, py], core] = _patch(P.rubbed, P.rubbed_side, r)
	if (q !== 0) c.process("magnetism", "charge", { role: "charge", solid: sid, x: _r(px), y: _r(py), q, radius: _r(core), capacitance: g6(4 * Math.PI * EPS0 * r) })
	if (P.on_thread) {
		const th = P.thread
		c.slab("hook", 0.03, 0.01, 0.03, 0.0, r + th + 0.005, { kind: "static", material: c.mat({ base: "varnished hardwood", overrides: {} }), look: "wood", words: "a hook" })
		c.joint("rope", "thread", { a: null, b: "balloon", anchorA: [0.0, r + th], anchorB: [0.0, r], length: _r(th), thickness: 0.0005 })
	}
}

const PAPERS = { "printer paper": [0.08, 0.0001], "tissue paper": [0.017, 0.00004] }

function build_paper_bits(c, P) {
	const n = Math.trunc(P.count)
	const size = P.size
	const [gsm, thick] = PAPERS[P.paper]
	const m = gsm * size * size
	const mat = c.mat({ base: "paper", overrides: {}, density: pyRound(m / (size * 0.001 * size), 3) })
	const sp = size + 0.004
	const x0 = (-(n - 1) * sp) / 2
	for (let i = 0; i < n; i++) {
		const sid = c.slab(`bit${i + 1}`, size, 0.001, size, x0 + i * sp, 0.0, { material: mat, look: "paper", words: "a scrap of paper" })
		c.process("magnetism", `polar${i + 1}`, { role: "polar", solid: sid, x: 0.0, y: 0.0, w: _r(size), h: thick, d: _r(size), volume: g6(size * size * thick), epsr: 0.0 })
	}
}

function build_rod(c, P) {
	const [L, d] = [P.length, P.diameter]
	const plastic = P.material === "plastic"
	const base = plastic ? "ABS plastic" : "glass"
	const sid = c.slab("rod", L, d, d, 0.0, 0.0, { material: c.mat({ base, overrides: {} }), look: plastic ? "plastic" : "glass", words: plastic ? "a plastic rod" : "a glass rod", ...(plastic ? { color: "#2b2b2b" } : {}), ..._held(c) })
	const strokes = Math.min(STROKES_MAX, Math.max(0, Math.trunc(P.rubbed)))
	const q = strokes * 7e-9 * (plastic ? -1 : 1)
	if (q !== 0) {
		for (const [k, x] of [[1, L / 8], [2, (3 * L) / 8]]) {
			c.process("magnetism", `charge${k}`, { role: "charge", solid: sid, x: _r(x), y: 0.0, q: q / 2, radius: _r(d / 2), capacitance: g6((4 * Math.PI * EPS0 * L) / 4) })
		}
	}
}

function build_pith(c, P) {
	const [th, d] = [P.thread, P.diameter]
	const r = d / 2
	c.slab("hook", 0.03, 0.01, 0.03, 0.0, r + th + 0.005, { kind: "static", material: c.mat({ base: "varnished hardwood", overrides: {} }), look: "wood", words: "a stand's arm" })
	const mat = c.mat({ base: "foam", overrides: {}, density: pyRound(0.00004 / (((4 / 3) * Math.PI) * cube(r)), 3) })
	const sid = c.ball("ball", r, 0.0, 0.0, { material: mat, look: "foil", words: "a pith ball coated with foil" })
	c.joint("rope", "thread", { a: null, b: "ball", anchorA: [0.0, r + th], anchorB: [0.0, r], length: _r(th), thickness: 0.0003 })
	const cap = g6(4 * Math.PI * EPS0 * r)
	c.process("magnetism", "charge", { role: "charge", solid: sid, x: 0.0, y: 0.0, q: pyRound(P.charge_nC * 1e-9, 12), radius: _r(r), capacitance: cap, conductor: true })
	const side = r * 1.6119919540164696
	c.process("magnetism", "polar", { role: "polar", solid: sid, x: 0.0, y: 0.0, w: _r(side), h: _r(side), d: _r(side), volume: g6(((4 / 3) * Math.PI) * cube(r)), epsr: 0.0, round: true })
}

function _static() {
	register(new ItemType("balloon", "Balloon", CATEGORY, build_balloon, {
		module: "magnetism",
		props: [new Prop("diameter", "Diameter", 0.25, 0.15, 0.4, 0.01, "m"),
			new Prop("color", "Colour", "red", { kind: "choice", choices: Object.keys(BALLOON_COLOURS) }),
			new Prop("rubbed", "Rubbed (strokes)", 0, 0, 20, 1, "", { kind: "int", help: "Strokes on hair or a wool sweater: each puts 10 nC of negative charge on it, up to 10 strokes (100 nC, as much as its rubbed patch holds)" }),
			new Prop("rubbed_side", "Rubbed side", "bottom", { kind: "choice", choices: Object.keys(SIDES), help: "Where the charge sits (it stays where it was rubbed)" }),
			new Prop("on_thread", "Hung on a thread", true, { kind: "bool", help: "Hangs from a hook by a thread; off: it floats down on its own" }),
			new Prop("thread", "Thread length", 0.5, 0.05, 1.5, 0.01, "m")],
		readouts: [new Readout("charge_uC", "Charge", { unit: "µC", digits: 3 }), new Readout("pull_mN", "Electric pull", { unit: "mN", digits: 3 })],
		tags: ["balloon", "static", "static electricity", "rub", "charge", "hair", "wool", "attract", "repel", "party balloon"],
		description: "An air-filled party balloon (25 cm, about 4 g with its extra air), hung on a thread from a hook. Rub it (strokes) and it " +
			"takes a negative charge on the rubbed side: it pulls scraps of paper and light metal things toward it, and two rubbed " +
			"balloons push each other apart.",
		source: "Latex 3.5 g; charge 10 nC a stroke up to 100 nC on a 40 cm² patch (25 µC/m², near air's limit [AIR-BD]); latex goes negative on hair [TRIBO].",
		anchor: "its centre", facts: "25 cm · 3.8 g · rubbed: −10 nC a stroke"
	}))
	register(new ItemType("paper-bits", "Paper scraps", CATEGORY, build_paper_bits, {
		module: "magnetism",
		props: [new Prop("count", "Scraps", 8, 1, 20, 1, "", { kind: "int" }), new Prop("size", "Size", 0.006, 0.003, 0.012, 0.0005, "m"),
			new Prop("paper", "Paper", "tissue paper", { kind: "choice", choices: Object.keys(PAPERS), help: "Tissue paper (17 g/m²) is about 5 times lighter than printer paper (80 g/m²)" })],
		readouts: [new Readout("pull_mN", "Electric pull", { unit: "mN", digits: 4 })],
		tags: ["paper", "bits of paper", "paper scraps", "confetti", "static", "attract", "light objects"],
		description: "Small square scraps of paper lying in a row on the table. Neutral, but a charged balloon or rod held about a centimetre " +
			"above them polarizes them: they stand up and jump to it.",
		source: "Tissue 17 g/m², copy paper 80 g/m²; damp paper conducts, so a scrap polarizes as a conducting flake would.",
		anchor: "the middle of the row, at the scraps' middle", facts: "8 scraps · 6 mm · tissue"
	}))
	register(new ItemType("charged-rod", "Charged rod", CATEGORY, build_rod, {
		dynamic: false, module: "magnetism",
		props: [new Prop("material", "Rod", "plastic", { kind: "choice", choices: ["plastic", "glass"], help: "A plastic rod rubbed with wool goes negative; a glass rod rubbed with silk positive" }),
			new Prop("rubbed", "Rubbed (strokes)", 10, 0, 20, 1, "", { kind: "int", help: "7 nC a stroke on its rubbed (right) half, up to 10 strokes" }),
			new Prop("length", "Length", 0.3, 0.1, 0.6, 0.01, "m"), new Prop("diameter", "Diameter", 0.015, 0.006, 0.03, 0.001, "m")],
		readouts: [new Readout("charge_uC", "Charge", { unit: "µC", digits: 3 })],
		tags: ["rod", "charged rod", "glass rod", "plastic rod", "static", "electrostatics", "rubbed"],
		description: "A rod held in a clamp (it does not fall), rubbed along its right half: plastic with wool (negative) or glass with silk (positive).",
		source: "Up to 70 nC on the rubbed half (10 µC/m²) [TRIBO] [AIR-BD].", anchor: "its centre", facts: "plastic · −70 nC", edit: [{ kind: "rotate" }]
	}))
	register(new ItemType("pith-ball", "Pith ball", CATEGORY, build_pith, {
		module: "magnetism",
		props: [new Prop("thread", "Thread length", 0.25, 0.05, 0.6, 0.01, "m"), new Prop("diameter", "Diameter", 0.012, 0.006, 0.03, 0.001, "m"),
			new Prop("charge_nC", "Starting charge", 0.0, -50.0, 50.0, 1.0, "nC")],
		readouts: [new Readout("charge_uC", "Charge", { unit: "µC", digits: 4 }), new Readout("pull_mN", "Electric pull", { unit: "mN", digits: 4 })],
		tags: ["pith ball", "electroscope", "foil ball", "static", "charge", "conductor", "thread"],
		description: "A tiny foil-coated pith ball (0.04 g) hanging on a silk thread. A charged thing pulls it; once it touches, it takes some of " +
			"the charge and is pushed away (like charges repel).",
		source: "A pith-ball electroscope: a 12 mm foam ball coated with foil (a conductor), 0.04 g.", anchor: "the ball's centre", facts: "0.04 g · conductor"
	}))
}

// ---------------------------------------------------------------- existing parts of magnetic or conducting materials (the build hook)
function _bbox(body) {
	if (body.kind === "ball") return null
	if (body.kind === "slab") return [0.0, 0.0, body.width, body.height, body.width * body.height * body.depth]
	const xs = body.points.map((p) => p.x)
	const ys = body.points.map((p) => p.y)
	const pts = body.points
	let area = 0.0
	for (let k = 0; k < pts.length; k++) {
		const [p, q] = [pts[k], pts[(k + 1) % pts.length]]
		area += p.x * q.y - q.x * p.y
	}
	const mx = (a) => a.reduce((u, v) => (v > u ? v : u))
	const mn = (a) => a.reduce((u, v) => (v < u ? v : u))
	return [(mx(xs) + mn(xs)) / 2, (mx(ys) + mn(ys)) / 2, mx(xs) - mn(xs), mx(ys) - mn(ys), (area / 2) * body.depth]
}

/** A solid's origin in the world (m): a welded part's `at` is in its parent's frame (mod_magnetism.py _world_of). */
function _world_of(sb, s) {
	let [x, y] = [s.at.x, s.at.y]
	let [p, hops] = [s.parent ?? null, 0]
	while (p !== null && hops < 8) {
		const par = sb.solids.find((t) => t.id === p) ?? null
		if (par === null) break
		const a = par.angle ?? 0.0
		const [cs, sn] = [cos(a), sin(a)]
		;[x, y] = [par.at.x + x * cs - y * sn, par.at.y + x * sn + y * cs]
		;[p, hops] = [par.parent ?? null, hops + 1]
	}
	return [x, y]
}

/** The scene's magnets and coils as [[x, y, half size, the most dipole moment it can have, held still]] (mod_magnetism.py _sources). */
function _sources(sb, recs) {
	const out = []
	for (const r of recs) {
		const s = sb.solids.find((t) => t.id === r.solid) ?? null
		if (s === null) continue
		const [x, y] = _world_of(sb, s)
		if (r.role === "magnet") {
			let [mx, my, half] = [0.0, 0.0, 0.0]
			for (const f of r.faces) {
				const q = f.sigma * f.width * f.depth
				mx += q * f.x
				my += q * f.y
				half = Math.max(half, Math.sqrt(f.x * f.x + f.y * f.y) + f.width / 2)
			}
			out.push([x, y, half, Math.sqrt(mx * mx + my * my), s.kind !== "dynamic"])
		} else if (r.role === "soft" && F.py.truthy(r.coil)) {
			const [ax, ay] = [Math.abs(r.x) + r.w / 2, Math.abs(r.y) + r.h / 2]
			out.push([x, y, Math.sqrt(ax * ax + ay * ay), r.ms * r.volume, s.kind !== "dynamic"])
		}
	}
	return out
}

/** Whether a magnet or coil could pull a part whose middle is (x, y) and whose half size is `half` (mod_magnetism.py _reached). */
function _reached(sources, x, y, half, tesla = REACH_T) {
	for (const [sx, sy, sh, m] of sources) {
		const [dx, dy] = [x - sx, y - sy]
		const gap = Math.sqrt(dx * dx + dy * dy) - half - sh
		if (gap <= 0 || MU0 * m > 2 * Math.PI * tesla * gap * gap * gap) return true
	}
	return false
}

/** A light non-metal part's ε_r for its polar record (mod_magnetism.py _dielectric_eps). */
function _dielectric_eps(base, density, hollow) {
	const [eps_s, rho_s] = has(DIELECTRIC, base) ? DIELECTRIC[base] : [EPS_OTHER, null]
	let eps = rho_s === null ? eps_s : 1 + (eps_s - 1) * Math.min(1.0, density / rho_s)
	if (hollow) {
		const a = Math.min(2.7, ((eps - 1) * (2 * eps + 1)) / (3 * eps))
		eps = (3 + 2 * a) / (3 - a)
	}
	return pyRound(eps, 4)
}

function _magnetize(sb, scene) {
	const recs = sb.processes.filter((p) => p.kind === "magnetism")
	if (!recs.length) return
	const magnets = recs.some((r) => r.role === "magnet" || (r.role === "soft" && F.py.truthy(r.coil)))
	const charges = recs.some((r) => r.role === "charge")
	const sources = magnets ? _sources(sb, recs) : []
	const taken = new Set(recs.map((r) => r.item))
	for (const s of [...sb.solids]) {
		if (taken.has(s.item)) continue
		const base = sb.base_of(s.material)
		const body = s.body
		const soft = magnets && has(SOFT, base)
		const polar = charges && CONDUCTORS.includes(base)
		const dielectric = charges && !polar && s.kind === "dynamic" && !base.endsWith(" magnet")
		if (!soft && !polar && !dielectric) continue
		let geo, steel, box, rnd
		if (body.kind === "ball" && s.shape === "cylinder" && F.py.truthy(s.length)) {
			const [r, L] = [body.radius, s.length]
			const side = r * 1.7724538509055159
			geo = { x: 0.0, y: 0.0, w: _r(side), h: _r(side), d: _r(L) }
			;[steel, box, rnd] = [Math.PI * r * r * L, side * side * L, false]
		} else if (body.kind === "ball") {
			const r = body.radius
			const outer = ((4 / 3) * Math.PI) * cube(r)
			const inner = F.py.truthy(body.wall) ? ((4 / 3) * Math.PI) * cube(r - body.wall) : 0.0
			const side = r * 1.6119919540164696
			geo = { x: 0.0, y: 0.0, w: _r(side), h: _r(side), d: _r(side) }
			;[steel, box, rnd] = [outer - inner, outer, true]
		} else {
			const [cx, cy, w, h, vol] = _bbox(body)
			geo = { x: _r(cx), y: _r(cy), w: _r(w), h: _r(h), d: _r(body.depth) }
			;[steel, box, rnd] = [vol, w * h * body.depth, false]
		}
		// (a part thinner than the records' 0.01 mm, or of no area: too small to matter to a field, and a record of it would be refused)
		if (!(geo.w > 0 && geo.h > 0 && geo.d > 0 && box > 0)) continue
		let wx = 0.0
		let wy = 0.0
		let half = 0.0
		if (soft || dielectric) {
			;[wx, wy] = _world_of(sb, s)
			half = Math.sqrt(geo.w * geo.w + geo.h * geo.h) / 2
		}
		const still = s.kind !== "dynamic" && sources.every((src) => src[4])
		if (soft && (!still || _reached(sources, wx, wy, half))) {
			const m = SOFT[base]
			const fill = has(m, "solid") ? Math.min(1.0, sb.materials[s.material].density / m.solid) : 1.0
			const rec = { kind: "magnetism", id: `${s.id}/iron`, item: s.item, role: "soft", solid: s.id, ...geo, volume: g6(box), ms: pyRound(m.ms * Math.min(1.0, steel / box) * fill, 1), chi: fill === 1.0 ? m.chi : pyRound(Math.max(1.0, m.chi * fill), 3) }
			if (rnd) rec.round = true
			if (!_reached(sources, wx, wy, half, GRID_T)) rec.grid = false
			sb.processes.push(rec)
		}
		if (polar) {
			const rec = { kind: "magnetism", id: `${s.id}/polar`, item: s.item, role: "polar", solid: s.id, ...geo, volume: g6(box), epsr: 0.0 }
			if (rnd) rec.round = true
			sb.processes.push(rec)
		} else if (dielectric) {
			const density = sb.materials[s.material].density
			if (density * steel > LIGHT_KG || Math.max(geo.w, geo.h, geo.d) > LIGHT_M) continue
			const hollow = body.kind === "ball" && F.py.truthy(body.wall) && s.shape !== "cylinder"
			const rec = { kind: "magnetism", id: `${s.id}/polar`, item: s.item, role: "polar", solid: s.id, ...geo, volume: g6(steel), epsr: _dielectric_eps(base, density, hollow) }
			if (rnd) rec.round = true
			sb.processes.push(rec)
		}
	}
}

// ---------------------------------------------------------------- goal kinds (machines/mod_magnetism.py reports the same, number for number)
const TOUCH = 0.003

function _outline(s, pose) {
	const b = s.body
	const [x, y, a] = [pose.x, pose.y, pose.angle ?? 0.0]
	if (b.kind === "ball") return ["circle", x, y, b.radius]
	let pts
	if (b.kind === "slab") {
		const [hw, hh] = [b.width / 2, b.height / 2]
		const hb = hw * (b.taper ?? 1.0)
		pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
	} else pts = b.points.map((p) => [p.x, p.y])
	const [c, n] = [cos(a), sin(a)]
	return ["poly", pts.map(([px, py]) => [x + px * c - py * n, y + px * n + py * c])]
}

function _near_on_poly(poly, x, y) {
	let best = null
	let inside = true
	for (let i = 0; i < poly.length; i++) {
		const [[px, py], [qx, qy]] = [poly[i], poly[(i + 1) % poly.length]]
		const [ex, ey] = [qx - px, qy - py]
		if (ex * (y - py) - ey * (x - px) < 0) inside = false
		const l2 = ex * ex + ey * ey
		const u = l2 > 0 ? Math.max(0.0, Math.min(1.0, ((x - px) * ex + (y - py) * ey) / l2)) : 0.0
		const [cx, cy] = [px + u * ex, py + u * ey]
		const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
		if (best === null || d < best) best = d
	}
	return [best, inside]
}

function _gap(oa, ob) {
	if (oa[0] === "circle" && ob[0] === "circle") {
		const [dx, dy] = [ob[1] - oa[1], ob[2] - oa[2]]
		return Math.max(0.0, Math.sqrt(dx * dx + dy * dy) - oa[3] - ob[3])
	}
	if (oa[0] === "circle" || ob[0] === "circle") {
		const [circ, poly] = oa[0] === "circle" ? [oa, ob[1]] : [ob, oa[1]]
		const [d, inside] = _near_on_poly(poly, circ[1], circ[2])
		return inside ? 0.0 : Math.max(0.0, d - circ[3])
	}
	let best = null
	let hit = false
	for (const [P_, Q] of [[oa[1], ob[1]], [ob[1], oa[1]]]) {
		for (const [x, y] of P_) {
			const [d, inside] = _near_on_poly(Q, x, y)
			if (inside) hit = true
			if (best === null || d < best) best = d
		}
	}
	return hit ? 0.0 : best
}

function _pose_at(ctx, sid, k) {
	let p = ctx.frames[k].placements[sid]
	if (p === undefined) p = ctx.frames[0].placements[sid]
	if (p === undefined) {
		const s = ctx.doc.solids.find((x) => x.id === sid)
		p = { x: s.at.x, y: s.at.y, angle: s.angle ?? 0.0 }
	}
	return p
}

function _item_gap(ctx, a, b, k) {
	let best = null
	for (const sa of ctx.solids(a)) {
		const oa = _outline(sa, _pose_at(ctx, sa.id, k))
		for (const sb_ of ctx.solids(b)) {
			const g = _gap(oa, _outline(sb_, _pose_at(ctx, sb_.id, k)))
			if (best === null || g < best) best = g
		}
	}
	return best
}

const _cm = (m) => pyRound(m * 100, 2)
const _label = (g, fallback) => (F.py.truthy(g.label) ? g.label : fallback)

function goal_attracts(ctx, g) {
	const [a, b] = [g.source, g.item]
	if (!ctx.known(a) || !ctx.known(b) || a === b) return null
	const [g0, g1] = [_item_gap(ctx, a, b, 0), _item_gap(ctx, a, b, ctx.frames.length - 1)]
	if (g0 === null || g1 === null) return null
	// (it starts apart, more than 3 mm: a thing that starts touching the source was not pulled to it)
	const ok = g0 > TOUCH && (g1 <= TOUCH || g0 - g1 >= 0.01)
	return { label: _label(g, `${ctx.name(a)} pulls ${ctx.name(b)} to it`), ok, kind: "attracts", source: a, item: b, gap_cm: [_cm(g0), _cm(g1)] }
}

function goal_repels(ctx, g) {
	const [a, b] = [g.a, g.b]
	if (!ctx.known(a) || !ctx.known(b) || a === b) return null
	let least = ctx.num(g.min_m)
	least = least === null ? 0.01 : least
	const gaps = ctx.frames.map((_, k) => _item_gap(ctx, a, b, k))
	if (gaps.some((x) => x === null)) return null
	const widest = gaps.reduce((u, v) => (v > u ? v : u))
	return { label: _label(g, `${ctx.name(a)} and ${ctx.name(b)} push apart`), ok: widest - gaps[0] >= least, kind: "repels", a, b, gap_cm: [_cm(gaps[0]), _cm(gaps[gaps.length - 1])], widest_cm: _cm(widest) }
}

function goal_sticks(ctx, g) {
	const [a, b] = [g.item, g.to]
	if (!ctx.known(a) || !ctx.known(b) || a === b) return null
	const n = ctx.frames.length
	const t_end = ctx.times[ctx.times.length - 1]
	const ks = []
	for (let k = 0; k < n; k++) if (ctx.times[k] >= t_end - 0.5) ks.push(k)
	const gaps = ks.map((k) => _item_gap(ctx, b, a, k))
	if (!gaps.length || gaps.some((x) => x === null)) return null
	return { label: _label(g, `${ctx.name(a)} sticks to ${ctx.name(b)}`), ok: gaps.every((x) => x <= TOUCH), kind: "sticks", item: a, to: b, gap_cm: _cm(gaps[gaps.length - 1]) }
}

function _mid_y(ctx, item, k) {
	const sids = ctx.solids(item, true).map((s) => s.id)
	if (!sids.length) return null
	return pySum(sids.map((i) => _pose_at(ctx, i, k).y)) / sids.length
}

function goal_lifts(ctx, g) {
	const [a, b] = [g.source, g.item]
	if (!ctx.known(a) || !ctx.known(b) || a === b) return null
	let least = ctx.num(g.min_m)
	least = least === null ? 0.005 : least
	const [y0, y1] = [_mid_y(ctx, b, 0), _mid_y(ctx, b, ctx.frames.length - 1)]
	const [g0, g1] = [_item_gap(ctx, a, b, 0), _item_gap(ctx, a, b, ctx.frames.length - 1)]
	if (y0 === null || g0 === null || g1 === null) return null
	const rise = y1 - y0
	return { label: _label(g, `${ctx.name(a)} lifts ${ctx.name(b)}`), ok: rise >= least && g1 < g0, kind: "lifts", source: a, item: b, rise_cm: _cm(rise) }
}

function _wrap(deg) {
	let d = deg % 360.0
	if (d > 180) d -= 360
	if (d < -180) d += 360
	return d
}

function goal_points(ctx, g) {
	const cid = g.compass
	if (!ctx.known(cid)) return null
	const head = ctx.state(cid, "heading_deg")
	if (head === null) return null
	let tol = ctx.num(g.tol_deg)
	tol = tol === null ? 15.0 : tol
	const k = ctx.frames.length - 1
	let want = ctx.num(g.angle_deg)
	const toward = g.toward
	if (want === null && ctx.known(toward)) {
		const needle = ctx.solids(cid, true)[0] ?? null
		const sol = ctx.solids(toward)
		if (needle === null || !sol.length) return null
		const p = _pose_at(ctx, needle.id, k)
		const tx = pySum(sol.map((s) => _pose_at(ctx, s.id, k).x)) / sol.length
		const ty = pySum(sol.map((s) => _pose_at(ctx, s.id, k).y)) / sol.length
		want = (Math.atan2(ty - p.y, tx - p.x) * 180) / Math.PI
	}
	if (want === null) return null
	const off = Math.abs(_wrap(head[head.length - 1] - want))
	const what = ctx.known(toward) && ctx.num(g.angle_deg) === null ? ctx.name(toward) : `${F.py.pyRoundInt(want)}°`
	return { label: _label(g, `${ctx.name(cid)} points at ${what}`), ok: off <= tol, kind: "points", compass: cid, heading_deg: pyRound(head[head.length - 1], 1), off_deg: pyRound(off, 1) }
}

function goal_holds(ctx, g) {
	const mid = g.magnet
	if (!ctx.known(mid)) return null
	let want = ctx.num(g.count)
	want = want === null ? 1 : want
	const k = ctx.frames.length - 1
	const pool = Array.isArray(g.items) ? g.items : null
	const soft = new Set((ctx.doc.processes ?? []).filter((p) => p.kind === "magnetism" && p.role === "soft").map((p) => p.item))
	const cands = ctx.doc.solids.filter((s) => s.kind === "dynamic" && s.item !== mid && (pool !== null ? pool.includes(s.item) : soft.has(s.item)))
	const ids = new Set(cands.map((s) => s.id))
	const outl = new Map(cands.map((s) => [s.id, _outline(s, _pose_at(ctx, s.id, k))]))
	const mag = ctx.solids(mid).map((s) => _outline(s, _pose_at(ctx, s.id, k)))
	const rest = ctx.doc.solids.filter((s) => s.item !== mid && !ids.has(s.id)).map((s) => _outline(s, _pose_at(ctx, s.id, k)))
	const free = cands.filter((s) => rest.every((o) => _gap(outl.get(s.id), o) > TOUCH))
	const held = new Set()
	const frontier = free.filter((s) => mag.some((o) => _gap(outl.get(s.id), o) <= TOUCH)).map((s) => s.id)
	while (frontier.length) {
		const sid = frontier.shift()
		if (held.has(sid)) continue
		held.add(sid)
		for (const s of free) if (!held.has(s.id) && _gap(outl.get(s.id), outl.get(sid)) <= TOUCH) frontier.push(s.id)
	}
	const n = held.size
	return { label: _label(g, `${ctx.name(mid)} holds ${want === Math.trunc(want) ? Math.trunc(want) : want} or more`), ok: n >= want, kind: "holds", magnet: mid, held: n }
}

const _lowest = (o) => (o[0] === "circle" ? o[2] - o[3] : o[1].reduce((u, p) => (p[1] < u ? p[1] : u), Infinity))

function goal_levitates(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	let least = ctx.num(g.min_m)
	const k = ctx.frames.length - 1
	const rings = ctx.solids(iid, true).filter((s) => (s.part ?? "").startsWith("ring") && !(s.part ?? "").includes("-"))
	const base = ctx.solids(iid).find((s) => s.part === "base") ?? null
	if (!rings.length || base === null) {
		const mine = ctx.solids(iid, true)
		if (!mine.length) return null
		least = least === null ? 0.01 : least
		const top = ctx.doc.solids.find((s) => s.itemType === "table" && s.part === "top" && s.body.kind === "slab") ?? null
		const floor = top === null ? 0.0 : _pose_at(ctx, top.id, 0).y + top.body.height / 2
		const outl = mine.map((s) => _outline(s, _pose_at(ctx, s.id, k)))
		const low = outl.map(_lowest).reduce((u, v) => (v < u ? v : u)) - floor
		const others = ctx.doc.solids.filter((s) => s.item !== iid)
		const free = outl.every((o) => others.every((s) => _gap(o, _outline(s, _pose_at(ctx, s.id, k))) > TOUCH))
		return { label: _label(g, `${ctx.name(iid)} floats in the air`), ok: low >= least && free, kind: "levitates", item: iid, height_cm: _cm(low), touching: !free }
	}
	least = least === null ? 0.002 : least
	let want = ctx.num(g.count)
	want = want === null ? rings.length - 1 : want
	const ys = rings.map((s) => _pose_at(ctx, s.id, k).y).sort((u, v) => u - v)
	const h = rings[0].body.height
	const floor = _pose_at(ctx, base.id, k).y + base.body.height / 2
	const gaps = []
	let below = floor
	for (const y of ys) {
		gaps.push(y - h / 2 - below)
		below = y + h / 2
	}
	const floating = gaps.filter((x) => x >= least).length
	return { label: _label(g, `${ctx.name(iid)}: ${want === Math.trunc(want) ? Math.trunc(want) : want} float`), ok: floating >= want, kind: "levitates", item: iid, floating, gaps_mm: gaps.map((x) => pyRound(x * 1000, 1)) }
}

function goal_not_attracted(ctx, g) {
	const [a, b] = [g.source, g.item]
	if (!ctx.known(a) || !ctx.known(b) || a === b) return null
	let most = ctx.num(g.max_m)
	most = most === null ? TOUCH : most
	const gaps = ctx.frames.map((_, k) => _item_gap(ctx, a, b, k))
	if (gaps.some((x) => x === null)) return null
	const nearer = gaps[0] - gaps.reduce((u, v) => (v < u ? v : u))
	return { label: _label(g, `${ctx.name(b)} is not pulled to ${ctx.name(a)}`), ok: nearer <= most, kind: "not_attracted", source: a, item: b, gap_cm: [_cm(gaps[0]), _cm(gaps[gaps.length - 1])], nearer_cm: _cm(nearer) }
}

// ================================================================ the AI's plug-ins (web/sim/plugins.js)
const MAGNET_TYPES = ["bar-magnet", "horseshoe-magnet", "disc-magnet", "ring-magnets", "magnet-cart", "battery-electromagnet"]
const SOFT_TYPES = ["paper-clip", "iron-nail", "steel-washer", "steel-can", "clip-on-thread", "can-on-side"]
const NOT_MAGNETIC = ["plastic-clip", "foil-ball", "copper-wire", "brass-key", "wooden-bead"]
const fmt1 = (x) => (Math.round(x * 10) / 10).toString()
const cmText = (m) => `${fmt1(m * 100)} cm`
const pick1 = (scene, types) => scene.items.filter((i) => types.includes(i.type))

/** An item's magnetism records in a run's document. */
const recordsOf = (run, id) => (run?.doc?.processes ?? []).filter((p) => p.kind === "magnetism" && p.item === id)

/** The gap (m) at the run's last frame between two items of a run, or null. */
function gapAtEnd(run, a, b) {
	const doc = run?.doc
	const frames = run?.track?.frames
	if (!doc?.solids || !frames?.length) return null
	const ctx = { doc, frames, solids: (iid) => doc.solids.filter((s) => s.item === iid) }
	return _item_gap(ctx, a, b, frames.length - 1)
}

/** A direction in whole degrees, 0 to 359 (counter-clockwise from the right). */
const deg360 = (deg) => ((Math.round(deg) % 360) + 360) % 360
function compassWord(deg) {
	const d = ((deg % 360) + 360) % 360
	const names = ["right", "up and right", "up", "up and left", "left", "down and left", "down", "down and right"]
	return names[Math.round(d / 45) % 8]
}

export const plugin = {
	title: "Magnets and static electricity",
	howto: [
		"Magnets (bar-magnet, horseshoe-magnet, disc-magnet, ring-magnets on a dowel, magnet-cart, battery-electromagnet) pull iron and steel and push or pull each other; nothing else is magnetic. Pulled by any magnet: paper-clip (a row of `count` clips), iron-nail, steel-washer, steel-can, can-on-side with material steel, clip-on-thread, the catalog's steel balls and steel weights, and the other modules' iron and steel (the matter module's steel density cube and steel wool, cast iron, a cart's steel spring bumper). NOT pulled at all: plastic-clip, foil-ball, copper-wire, brass-key, wooden-bead, coins (a penny is copper-plated zinc), aluminium cans, stainless-steel spoons and pans (austenitic), the density set's aluminium, brass, copper and zinc cubes, glass, wood, plastic, rubber. (A cart's magnet bumpers are magnets of their own: not modelled as iron.)",
		"Poles: a bar magnet's north (red, N) is on its right (+x) unless `flip`; turn it with its angle (angle_deg -90 points its north pole DOWN, 90 up). Like poles facing push apart, unlike pull together; iron is pulled by either pole. Strength: `material` ceramic (B_r 0.39 T) < alnico (B_r 1.25 T, but a bar's ends partly demagnetized: its pull spread over its last few cm, so a nail hangs under its end) < neodymium (1.3 T): at the same size neodymium pulls about 11 times harder than ceramic at contact.",
		"Distance matters a lot: the pull falls off steeply (two magnets far apart as 1/distance⁴; a magnet on a clip faster). A 15 cm ceramic bar held pole-down lifts a paper clip lying on the table from about 1.5 cm below it, a neodymium bar from about 3 cm; lying on the table end-on, a clip slides to a ceramic bar's pole from 3 cm, to a neodymium one from 5 cm. Hold (`fixed: true`) a magnet that should stay where it is (above clips, in front of a row of objects); leave carts and things to be pulled free. A barrier-sheet between a magnet and a clip: paper, cardboard, plastic, glass and aluminium change nothing; a steel one (0.5 mm) blocks most of a ceramic magnet's pull (a clip 8 mm behind it stays put) but a neodymium bar saturates it and still pulls about half.",
		"magnet-cart: a wooden cart with a bar magnet on its deck (`magnet_end` front/back, `flip`). Two carts 5-10 cm apart with like poles facing (one flipped or its magnet at the back facing the other's front with flip) roll apart; unlike poles roll together. ring-magnets: `count` rings on an upright dowel; with `alternate` (like faces together) each ring floats where the push equals the weight above it (the bottom gap smaller); unlike faces snap together.",
		"compass: stands face-on, its needle's red end points north (right, unless `north` left: it starts that way) by the Earth's field (`earth`), and near a magnet lines up with its field: red end toward the magnet's south pole and away from its north; a magnet flipped right in line with it swings it round. Its needle always turns on its pivot, a fixed (held) compass's too. Its reading heading_deg is the red end's direction, counter-clockwise from the right (0 right, 90 up, 180 left).",
		"battery-electromagnet: a nail wrapped with `turns` of wire on `cells` AA batteries, held point down (fixed); switched `on` (at `on_at` s) it is a magnet: it picks up a clip lying 0.5-1 cm under its point, and holds a chain of clips hung from its point (paper-clip count 6, spacing 0.0345, angle -90, held: the ones it cannot hold fall at the release; on 2 AA, 10 turns hold one, 50 two, 200 three: a chain end to end holds few, as a real one does). More turns make it stronger until the nail's iron is full (about 300 turns); more batteries add little current with few turns (the batteries' own resistance limits it to about 6 A). It has its own batteries: the circuits module has no coil to wire it into a circuit, so switch it with `on` and `on_at`.",
		"Static electricity: a balloon `rubbed` N strokes (on hair or wool) carries −10 nC a stroke up to −100 nC on its `rubbed_side` (bottom, top, left, right, lower right, lower left); hung `on_thread` from a hook (its `thread` length) it swings. It pulls paper-bits (light, polarized: they stand up and jump to it from about 1 cm below its rubbed side) and an aluminium can-on-side (rolls toward it from a few cm). Two rubbed balloons hung 30 cm apart with rubbed sides facing push apart (they swing apart about 5-10°). Any light thing that is not metal is polarized as a dielectric (its ε_r: paper 2-3, plastic 2-3.5, wood 1.4-2.7, water 80): a ping-pong ball rolls to a rubbed balloon only from about 5 mm (a plastic shell is weakly polarized), where an aluminium can goes from several cm; other modules' metals (a penny, a spoon) are conductors. charged-rod (fixed: plastic rubbed with wool negative, glass with silk positive) and pith-ball (a light conductor on a thread: pulled, touches, takes some charge and is pushed away).",
		"Readings each run: pull_mN (the magnetic or electric force on the item now), magnetized (%, soft iron), amps (an electromagnet's current), heading_deg (a magnet's or compass needle's north end), charge_uC (a charged item's charge). Field lines are a drawing option (`show_field` on a magnet).",
		"For a picture of a paper-clip, plastic-clip, clip-on-thread or steel-washer (a thin sliver from the side): `facing` face-on stands it on its edge, its face toward the camera (the same steel and weight; its side outline is then its face: a clip 33 × 8 mm, a washer its ring)."
	].join(" "),
	prompt: {
		plan: [
			"Magnets: only iron and steel things (paper-clip, iron-nail, steel-washer, steel-can, can-on-side steel, the catalog's steel balls) are pulled; never use a magnet on plastic, aluminium, copper, brass, wood or coins expecting a pull (they are the 'not magnetic' examples). Put a magnet that must stay put `fixed: true` (held). To make a clip jump up, hold a bar magnet pole-down (place.angle_deg -90) with its bottom 0.5-1 cm above the clip (ceramic) or up to 2 cm (neodymium). A row of test objects in front of a magnet: each within 2-3 cm of a pole face, on the table, the magnet lying on the table (its y = half its width).",
			"Magnet carts: two magnet-cart items on the table facing each other 5-8 cm apart: repel = like poles facing (cart A magnet_end front, cart B magnet_end back with flip true), attract = unlike (cart B magnet_end back, flip false). Levitating rings: one ring-magnets item (alternate true). Compass: compare its heading with a magnet nearby and far away. Electromagnet (how many clips it holds): battery-electromagnet in the air (place.y_m 0.244: its 5 cm nail's point 21.8 cm up) with a chain of clips hanging from its point, a paper-clip item count 6, spacing 0.0345, held true, place {on: air, same x, y_m 0.11425, angle_deg -90}; when released the clips it cannot hold fall; compare turns (10, 50, 200) in copies 0.7 m apart; goal holds {magnet, count, items: [its chain]}.",
			"Static electricity: balloon with rubbed 10 and rubbed_side facing what it should pull (bottom over paper-bits, its lowest point 0.5-1 cm above them; lower right/left toward a can-on-side 3-4 cm away on the table, or a ping-pong ball only about 5 mm away); two balloons for repulsion: hooks 30 cm apart, rubbed sides facing (right and left). Goals: attracts {source, item}, repels {a, b}, sticks {item, to}, lifts {source, item}, holds {magnet, count, items: [ids]} (items is always a list, even of one chain), points {compass, toward | angle_deg}, levitates {item}, not_attracted {source, item}. Every test object that must NOT be pulled (plastic, foil, brass, copper, wood next to a magnet; the paper under an unrubbed balloon: the control) gets its own not_attracted goal, so the lesson's other half is checked too."
		].join("\n"),
		edit: "Magnets: a magnet's poles swap with `flip` (like poles push, unlike pull; iron is pulled either way); its strength with `material` (ceramic < alnico < neodymium) and size; distance changes the pull steeply (half the gap: several times the pull). A balloon's charge is `rubbed` (strokes, 10 nC each, up to 10) on its `rubbed_side`; an electromagnet's strength is `turns` (and `cells`), and `on`/`on_at` switch it. Only iron and steel are magnetic: changing a plastic or aluminium thing's distance or size never makes a magnet pull it. A pole flip (or a cart's magnet_end) that makes like poles face each other turns the outcome around: rewrite that pair's attracts goal as repels {a, b} (and repels back to attracts when unlike poles come to face); \"pushed away\" or \"pushed apart\" is repels, never moves. A test object swapped for one that is or is not magnetic changes its goal the same way (attracts for iron or steel, not_attracted for anything else).",
		refine: "Magnets: a clip or can that must be pulled must start within reach (≈1-2 cm from a ceramic pole, more for neodymium); a magnet that must stay put needs fixed: true; two carts that must repel need like poles facing. A charged balloon must face the scraps or can with its rubbed side and be close (paper scraps ≈ 1 cm under it). Fix a failing magnetism goal with distance, the magnet's material or the poles (flip), never by making a non-magnetic thing 'stronger'."
	},
	examples: [
		{ ask: "A paper clip jumps up to a bar magnet held just above it (G1).", how: "bar-magnet fixed, pole down (place on air, angle_deg -90), its bottom 1 cm above a paper-clip on the table (ceramic; up to 2 cm neodymium); goals lifts {source: magnet, item: clip} + sticks {item: clip, to: magnet}", plan: { items: [{ id: "magnet", type: "bar-magnet", fixed: true, place: { on: "air", x: 1.0, y_m: 0.086, angle_deg: -90 } }, { id: "clip", type: "paper-clip", place: { on: "table", x: 1.0 } }], goals: [{ kind: "lifts", source: "magnet", item: "clip" }, { kind: "sticks", item: "clip", to: "magnet" }] } },
		{ ask: "Two magnet carts with like poles facing push apart without touching (G2).", how: "two magnet-cart on the table 30 cm apart (middles), A's magnet at its front, B's at its back with flip true, so north faces north; goal repels {a, b}", plan: { items: [{ id: "a", type: "magnet-cart", place: { on: "table", x: 0.9 } }, { id: "b", type: "magnet-cart", props: { magnet_end: "back", flip: true }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "repels", a: "a", b: "b" }] } },
		{ ask: "Which things does a magnet pick up? A steel clip, a plastic clip, a foil ball and a nail (G3).", how: "one fixed neodymium bar-magnet (length 0.1) on the table per test object, each object 2-3 cm past its pole; goals attracts {source, item} for the steel clip and the nail, not_attracted {source, item} for the plastic clip and the foil ball", plan: { items: [{ id: "m1", type: "bar-magnet", props: { material: "neodymium", length: 0.1 }, fixed: true, place: { on: "table", x: 0.4 } }, { id: "steel", type: "paper-clip", place: { on: "table", x: 0.48 } }, { id: "m2", type: "bar-magnet", props: { material: "neodymium", length: 0.1 }, fixed: true, place: { on: "table", x: 0.9 } }, { id: "plastic", type: "plastic-clip", place: { on: "table", x: 0.98 } }, { id: "m3", type: "bar-magnet", props: { material: "neodymium", length: 0.1 }, fixed: true, place: { on: "table", x: 1.4 } }, { id: "foil", type: "foil-ball", place: { on: "table", x: 1.48 } }, { id: "m4", type: "bar-magnet", props: { material: "neodymium", length: 0.1 }, fixed: true, place: { on: "table", x: 1.9 } }, { id: "nail", type: "iron-nail", place: { on: "table", x: 1.97 } }], goals: [{ kind: "attracts", source: "m1", item: "steel" }, { kind: "attracts", source: "m4", item: "nail" }, { kind: "not_attracted", source: "m2", item: "plastic" }, { kind: "not_attracted", source: "m3", item: "foil" }] } },
		{ ask: "A magnet pulls a clip through a piece of cardboard (G4).", how: "fixed neodymium bar-magnet on the table, a barrier-sheet (cardboard) standing just past its pole, a paper-clip on the far side of the sheet; goal sticks {item: clip, to: sheet} (it is pulled up against the sheet)", plan: { items: [{ id: "magnet", type: "bar-magnet", props: { material: "neodymium", length: 0.1 }, fixed: true, place: { on: "table", x: 1.0 } }, { id: "sheet", type: "barrier-sheet", props: { material: "cardboard" }, place: { on: "table", x: 1.056 } }, { id: "clip", type: "paper-clip", place: { on: "table", x: 1.097 } }], goals: [{ kind: "sticks", item: "clip", to: "sheet" }] } },
		{ ask: "Two magnet carts with unlike poles facing roll together and stick (G2).", how: "two magnet-cart on the table 30 cm apart, A's magnet at its front, B's at its back, no flip (north faces south); goal attracts {source: a, item: b}", plan: { items: [{ id: "a", type: "magnet-cart", props: { magnet_end: "front" }, place: { on: "table", x: 0.9 } }, { id: "b", type: "magnet-cart", props: { magnet_end: "back" }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "attracts", source: "a", item: "b" }] } },
		{ ask: "A paper clip on a thread floats under a magnet without touching it (G5).", how: "clip-on-thread (thread 0.1) on the table, a fixed neodymium bar-magnet pole down (angle_deg -90) with its bottom about 1-2 cm above where the clip's top reaches; goal levitates {item: clip}", plan: { items: [{ id: "clip", type: "clip-on-thread", props: { thread: 0.1 }, place: { on: "table", x: 1.0 } }, { id: "magnet", type: "bar-magnet", props: { material: "neodymium" }, fixed: true, place: { on: "air", x: 1.0, y_m: 0.222, angle_deg: -90 } }], goals: [{ kind: "levitates", item: "clip" }] } },
		{ ask: "Ring magnets float above each other on a pencil (G6).", how: "one ring-magnets item (count 3, alternate true: like faces together) on the table; goal levitates {item: rings}", plan: { items: [{ id: "rings", type: "ring-magnets", props: { count: 3 }, place: { on: "table", x: 1.0 } }], goals: [{ kind: "levitates", item: "rings" }] } },
		{ ask: "A compass points north, but near a bar magnet it turns (G7).", how: "fixed bar-magnet lying on the table, one compass in the air 9 cm above its middle and another far away (1.5 m); goals points {compass: near, angle_deg: 180} (over the bar its field runs north to south pole: right to left) and points {compass: far, angle_deg: 0} (Earth's north, to the right)", plan: { items: [{ id: "magnet", type: "bar-magnet", fixed: true, place: { on: "table", x: 0.8 } }, { id: "near", type: "compass", place: { on: "air", x: 0.8, y_m: 0.09 } }, { id: "far", type: "compass", place: { on: "air", x: 2.4, y_m: 0.06 } }], goals: [{ kind: "points", compass: "near", angle_deg: 180 }, { kind: "points", compass: "far", angle_deg: 0 }] } },
		{ ask: "More turns of wire make an electromagnet hold more paper clips (MS-PS2-3).", how: "battery-electromagnet copies 1 m apart (turns 10 and 200), each with a chain paper-clip (count 6, spacing 0.0345, held, angle_deg -90) hanging from its point (place y_m 0.244 and 0.11425); seconds 3, release 0.4; goal holds {magnet: strong, count: 2, items: [chainB]} (items always a list, even of one chain)", plan: { seconds: 3, release: 0.4, items: [{ id: "weak", type: "battery-electromagnet", props: { turns: 10 }, place: { on: "air", x: 0.7, y_m: 0.244 } }, { id: "chainA", type: "paper-clip", props: { count: 6, spacing: 0.0345 }, held: true, place: { on: "air", x: 0.7, y_m: 0.11425, angle_deg: -90 } }, { id: "strong", type: "battery-electromagnet", props: { turns: 200 }, place: { on: "air", x: 1.7, y_m: 0.244 } }, { id: "chainB", type: "paper-clip", props: { count: 6, spacing: 0.0345 }, held: true, place: { on: "air", x: 1.7, y_m: 0.11425, angle_deg: -90 } }], goals: [{ kind: "holds", magnet: "strong", count: 2, items: ["chainB"] }] } },
		{ ask: "A rubbed balloon picks up little bits of paper (G11).", how: "balloon rubbed 10 on its bottom, on a 30 cm thread, its lowest point about 8 mm above paper-bits (count 5) on the table; goal attracts {source: balloon, item: bits}", plan: { items: [{ id: "balloon", type: "balloon", props: { rubbed: 10, rubbed_side: "bottom", thread: 0.3 }, place: { on: "air", x: 1.0, y_m: 0.134 } }, { id: "bits", type: "paper-bits", props: { count: 5 }, place: { on: "table", x: 1.0 } }], goals: [{ kind: "attracts", source: "balloon", item: "bits" }] } },
		{ ask: "Two rubbed balloons hanging side by side push each other apart (G12).", how: "two balloons rubbed 10 hung 30 cm apart, rubbed sides facing (right and left); goal repels {a: b1, b: b2}", plan: { items: [{ id: "b1", type: "balloon", props: { rubbed: 10, rubbed_side: "right" }, place: { on: "air", x: 1.0, y_m: 0.6 } }, { id: "b2", type: "balloon", props: { rubbed: 10, rubbed_side: "left", color: "blue" }, place: { on: "air", x: 1.3, y_m: 0.6 } }], goals: [{ kind: "repels", a: "b1", b: "b2" }] } },
		{ ask: "A charged balloon rolls an empty soda can toward it without touching (G13).", how: "balloon rubbed 10 on its lower right, hung so its rubbed side is 3-4 cm from a can-on-side (aluminium) on the table; goal attracts {source: balloon, item: can}", plan: { items: [{ id: "balloon", type: "balloon", props: { rubbed: 10, rubbed_side: "lower right", thread: 0.3 }, place: { on: "air", x: 1.0, y_m: 0.127 } }, { id: "can", type: "can-on-side", place: { on: "table", x: 1.172 } }], goals: [{ kind: "attracts", source: "balloon", item: "can" }] } },
		{ ask: "Only the rubbed balloon picks up paper; the balloon that was not rubbed does nothing (G11 with a control).", how: "two balloons on 30 cm threads 1 m apart, one rubbed 10 on its bottom and one not rubbed, each 8 mm above its own paper-bits; goals attracts {source: rubbed, item: bits1} and not_attracted {source: plain, item: bits2}", plan: { items: [{ id: "rubbed", type: "balloon", props: { rubbed: 10, rubbed_side: "bottom", thread: 0.3 }, place: { on: "air", x: 0.8, y_m: 0.134 } }, { id: "bits1", type: "paper-bits", props: { count: 5 }, place: { on: "table", x: 0.8 } }, { id: "plain", type: "balloon", props: { rubbed: 0, thread: 0.3, color: "blue" }, place: { on: "air", x: 1.8, y_m: 0.134 } }, { id: "bits2", type: "paper-bits", props: { count: 5 }, place: { on: "table", x: 1.8 } }], goals: [{ kind: "attracts", source: "rubbed", item: "bits1" }, { kind: "not_attracted", source: "plain", item: "bits2" }] } },
		{ ask: "A pith ball on a thread is pulled to a charged plastic rod, touches it, then flies away from it (P3).", how: "fixed charged-rod (plastic, rubbed 10) and a pith-ball on a 25 cm thread hanging 1-2 cm beside the rod's rubbed end; seconds 4; goal repels {a: rod, b: pith, min_m: 0.01}", plan: { seconds: 4, items: [{ id: "rod", type: "charged-rod", props: { rubbed: 10 }, place: { on: "air", x: 0.85, y_m: 0.35 } }, { id: "pith", type: "pith-ball", props: { thread: 0.25 }, place: { on: "air", x: 1.014, y_m: 0.35 } }], goals: [{ kind: "repels", a: "rod", b: "pith", min_m: 0.01 }] } }
	],
	goals: [
		{
			kind: "attracts", aliases: ["attract", "pulls", "pull", "attracted", "attracts_to", "pulled_to", "draws", "pulled_toward", "pulls_toward", "pulled_closer", "drawn_to"], fields: { source: "item", item: "item" }, subject: ["item", "source"],
			about: "attracts {source, item}: the source (a magnet, a charged balloon or rod) pulls the item to it: the item starts more than 3 mm from it (one that starts touching was not pulled: use sticks) and ends touching it, or 1 cm or more nearer than it started",
			label: (g, nameOf) => `${nameOf(g.source)} pulls ${nameOf(g.item)} to it`,
			summarize: (ctx, g) => goal_attracts(ctx, g),
			sample: (scene, pick) => { const xs = scene.items.filter((i) => i.type !== "table"); return xs.length > 1 ? { kind: "attracts", source: pick(xs).id, item: pick(xs).id } : null }
		},
		{
			kind: "repels", aliases: ["repel", "pushes_apart", "push_apart", "repelled", "pushed_apart", "pushes_away", "pushed_away", "push_away"], fields: { a: "item", b: "item", min_m: "number?" }, subject: ["a", "b"], compares: false,
			about: "repels {a, b, min_m?}: a and b push each other apart: the gap between them grows by min_m (default 1 cm) or more at its widest (hung balloons swing apart and back)",
			label: (g, nameOf) => `${nameOf(g.a)} and ${nameOf(g.b)} push apart`,
			summarize: (ctx, g) => goal_repels(ctx, g),
			sample: (scene, pick) => { const xs = scene.items.filter((i) => i.type !== "table"); return xs.length > 1 ? { kind: "repels", a: pick(xs).id, b: pick(xs).id, ...(pick([true, false]) ? { min_m: pick([0.005, 0.02]) } : {}) } : null }
		},
		{
			kind: "sticks", aliases: ["stick", "stays_on", "clings", "sticks_to"], fields: { item: "item", to: "item" }, subject: ["item", "to"],
			about: "sticks {item, to}: the item touches `to` (within 3 mm) all through the run's last half second",
			label: (g, nameOf) => `${nameOf(g.item)} sticks to ${nameOf(g.to)}`,
			summarize: (ctx, g) => goal_sticks(ctx, g),
			sample: (scene, pick) => { const xs = scene.items.filter((i) => i.type !== "table"); return xs.length > 1 ? { kind: "sticks", item: pick(xs).id, to: pick(xs).id } : null }
		},
		{
			kind: "lifts", aliases: ["lift", "pulls_up", "picks_up_one", "jumps_to"], fields: { source: "item", item: "item", min_m: "number?" }, subject: ["item", "source"],
			about: "lifts {source, item, min_m?}: the item rises at least min_m (default 5 mm) and ends nearer the source (a clip jumping up to a magnet held above it)",
			label: (g, nameOf) => `${nameOf(g.source)} lifts ${nameOf(g.item)}`,
			summarize: (ctx, g) => goal_lifts(ctx, g),
			sample: (scene, pick) => { const xs = scene.items.filter((i) => i.type !== "table"); return xs.length > 1 ? { kind: "lifts", source: pick(xs).id, item: pick(xs).id } : null }
		},
		{
			kind: "points", aliases: ["point", "compass_points", "points_to", "points_at"], fields: { compass: "item", toward: "item?", angle_deg: "number?", tol_deg: "number?" },
			about: "points {compass, toward? | angle_deg?, tol_deg?}: the compass needle's red (north) end ends pointing at the item's middle, or along angle_deg (0 right, 90 up, 180 left), within tol_deg (default 15)",
			label: (g, nameOf) => `${nameOf(g.compass)} points at ${typeof g.toward === "string" ? nameOf(g.toward) : `${g.angle_deg}°`}`,
			summarize: (ctx, g) => goal_points(ctx, g),
			sample: (scene, pick) => { const cs = pick1(scene, ["compass", "bar-magnet"]); const xs = scene.items.filter((i) => i.type !== "table"); return cs.length ? { kind: "points", compass: pick(cs).id, ...(pick([true, false]) ? { toward: pick(xs).id } : { angle_deg: pick([0, 90, 180]) }) } : null }
		},
		{
			kind: "holds", aliases: ["hold", "picks_up", "pick_up", "lifts_clips", "holds_clips"], fields: { magnet: "item", count: "number", items: "items?" }, subject: ["magnet"],
			about: "holds {magnet, count, items?}: at least `count` pieces of iron or steel (clips, nails, washers: every soft-iron item's pieces, or those of `items`) end hanging from the magnet: touching it or a piece that does, and touching nothing else (off the table)",
			label: (g, nameOf) => `${nameOf(g.magnet)} holds ${g.count} or more`,
			summarize: (ctx, g) => goal_holds(ctx, g),
			sample: (scene, pick) => { const xs = scene.items.filter((i) => i.type !== "table"); return xs.length ? { kind: "holds", magnet: pick(xs).id, count: pick([1, 2, 3]) } : null }
		},
		{
			kind: "levitates", aliases: ["levitate", "floats_in_air", "hovers", "hover", "float_above"], fields: { item: "item", count: "number?", min_m: "number?" },
			about: "levitates {item, count?, min_m?}: ring magnets: at least count rings (default all but the bottom one) float with a gap of min_m (2 mm) under each; anything else: it ends in the air (min_m, default 1 cm, above the table) touching nothing of another item (a clip on a thread under a magnet)",
			label: (g, nameOf) => `${nameOf(g.item)} floats`,
			summarize: (ctx, g) => goal_levitates(ctx, g),
			sample: (scene, pick) => { const xs = scene.items.filter((i) => i.type !== "table"); return xs.length ? { kind: "levitates", item: pick(xs).id } : null }
		},
		{
			kind: "not_attracted", aliases: ["not_pulled", "not_pulled_to", "is_not_attracted", "isnt_attracted", "not_attracted_to", "not_moved_toward", "unmoved_by", "not_picked_up", "not_lifted", "does_not_move_toward", "no_pull"], fields: { source: "item", item: "item", max_m: "number?" }, subject: ["item", "source"],
			about: "not_attracted {source, item, max_m?}: the item is NOT pulled to the source: all through the run it never comes more than max_m (default 3 mm) nearer to it than it started. Use it for every test object that must stay put (the plastic clip, foil, brass key, wooden bead next to a magnet; the paper under an unrubbed balloon)",
			label: (g, nameOf) => `${nameOf(g.item)} is not pulled to ${nameOf(g.source)}`,
			summarize: (ctx, g) => goal_not_attracted(ctx, g),
			sample: (scene, pick) => { const xs = scene.items.filter((i) => i.type !== "table"); return xs.length > 1 ? { kind: "not_attracted", source: pick(xs).id, item: pick(xs).id, ...(pick([true, false]) ? { max_m: pick([0.002, 0.01]) } : {}) } : null }
		}
	],
	knobs: [
		...["bar-magnet", "horseshoe-magnet", "disc-magnet", "ring-magnets", "magnet-cart"].map((type) => ({ type, key: "material", how: "choice", cost: 2, more: "make {it} a stronger kind of magnet", less: "make {it} a weaker kind of magnet", why: "neodymium (1.3 T) pulls about 11 times harder than ceramic (0.39 T) of the same size at contact; alnico about 7 times, but an alnico bar only 2 to 4 times (its ends are partly demagnetized)" })),
		...["bar-magnet", "horseshoe-magnet", "disc-magnet", "magnet-cart", "battery-electromagnet"].map((type) => ({ type, key: "flip", how: "bool", more: "turn {it} around, swapping its poles", less: "turn {it} around, swapping its poles", why: "like poles push apart and unlike poles pull together; iron and steel are pulled by either pole, so flipping changes nothing for a clip" })),
		{ type: "bar-magnet", key: "length", how: "rel", more: "make {it} longer", less: "make {it} shorter", why: "it grows or shrinks about its middle: a longer bar's ends reach farther out (nearer what lies beyond them), and its far pole is farther away, so the near pole's pull is less cancelled" },
		{ type: "bar-magnet", key: "width", how: "rel", more: "make {it} thicker", less: "make {it} thinner", why: "a bigger pole face carries more pole strength: it pulls harder and reaches farther" },
		{ type: "bar-magnet", key: "depth", how: "rel", more: "make {it} deeper (front to back)", less: "make {it} shallower (front to back)", why: "a bigger pole face carries more pole strength: it pulls harder and reaches farther" },
		{ type: "disc-magnet", key: "diameter", how: "rel", more: "make {it} bigger", less: "make {it} smaller", why: "a bigger disc has a bigger pole face: a stronger, longer-reaching pull" },
		{ type: "ring-magnets", key: "alternate", how: "bool", cost: 2, more: "turn every other ring over, so like faces meet", less: "turn every other ring over, so unlike faces meet", why: "like faces together push the rings apart so they float; unlike faces pull them together into a stack" },
		{ type: "ring-magnets", key: "thickness", how: "rel", more: "use thicker rings", less: "use thinner rings", why: "thicker rings are stronger and heavier: the gaps change a little" },
		{ type: "magnet-cart", key: "magnet_end", how: "choice", more: "move {it}'s magnet to its other end", less: "move {it}'s magnet to its other end", why: "the magnet must be at the end facing the other cart to push or pull it" },
		{ type: "battery-electromagnet", key: "turns", how: "rel", more: "give {it} more turns of wire", less: "give {it} fewer turns of wire", why: "the coil's field grows with its turns (with few turns the batteries' own resistance keeps the current near 6 A): more turns, a stronger magnet, until the nail's iron is full" },
		{ type: "battery-electromagnet", key: "cells", how: "abs", steps: [1, 2], more: "add a battery to {it}", less: "use one battery fewer on {it}", why: "another cell adds 1.5 V but also its own 0.2 Ω: with a short coil the current hardly rises; with a long coil it does" },
		{ type: "battery-electromagnet", key: "on", how: "bool", cost: 2, more: "switch {it} on", less: "switch {it} off", why: "with no current the nail is only soft iron: it pulls nothing" },
		{ type: "balloon", key: "rubbed", how: "abs", steps: [2, 4, 6, 10], more: "give {it} more rubs", less: "give {it} fewer rubs", why: "each stroke adds 10 nC up to 10 strokes (100 nC); the pull on a neutral scrap grows as the charge squared, between charges as their product" },
		{ type: "balloon", key: "rubbed_side", how: "choice", more: "move {it}'s rubbed patch to another side", less: "move {it}'s rubbed patch to another side", why: "the charge stays where it was rubbed: that side must face what it should pull or push" },
		{ type: "balloon", key: "thread", how: "rel", more: "use a longer thread for {it}", less: "use a shorter thread for {it}", why: "a longer thread lets a hung balloon swing farther for the same push" },
		{ type: "balloon", key: "y", how: "m", steps: [0.002, 0.004, 0.006, 0.01], more: "move {it} up", less: "move {it} down", why: "a scrap's pull falls off about as the fifth power of the distance to the charge: hung a few millimetres lower, a weakly rubbed balloon lifts what it could not" },
		{ type: "charged-rod", key: "y", how: "m", steps: [0.002, 0.004, 0.006, 0.01], more: "move {it} up", less: "move {it} down", why: "held a few millimetres nearer, a weakly rubbed rod pulls much harder (the pull on a neutral thing falls off about as the fifth power of the distance)" },
		{ type: "paper-bits", key: "paper", how: "choice", more: "use another paper for {it}", less: "use another paper for {it}", why: "tissue paper (17 g/m²) is about 5 times lighter than printer paper (80 g/m²) and pulled about as hard (a damp scrap is pulled as a conducting flake of its size): it jumps with about half the charge" },
		{ type: "paper-bits", key: "size", how: "rel", more: "use bigger scraps for {it}", less: "use smaller scraps for {it}", why: "a conducting flake's pull grows about as its size cubed and its weight as its size squared: a bigger scrap is pulled more for its weight (3 mm scraps need about 1.4 times the charge 6 mm ones do)" },
		{ type: "charged-rod", key: "rubbed", how: "abs", steps: [2, 4, 6, 10], more: "give {it} more rubs", less: "give {it} fewer rubs", why: "each stroke adds 7 nC on its rubbed half, up to 10 strokes" },
		{ type: "charged-rod", key: "material", how: "choice", cost: 2, more: "use the other kind of rod", less: "use the other kind of rod", why: "plastic rubbed with wool goes negative, glass rubbed with silk positive: it flips the charge" },
		{ type: "clip-on-thread", key: "thread", how: "rel", more: "lengthen {it}'s thread", less: "shorten {it}'s thread", why: "the thread sets how far below the magnet the clip hangs: nearer, the pull is much stronger" },
		{ type: "barrier-sheet", key: "material", how: "choice", cost: 2, more: "make {it} of another material", less: "make {it} of another material", why: "a steel sheet takes the magnet's field into itself: it blocks most of a ceramic magnet's pull (88 % 8 mm from the pole), about half a neodymium one's (it saturates); paper, cardboard, plastic, glass and aluminium let the pull straight through" },
		{ type: "compass", key: "north", how: "choice", cost: 3, more: "turn the scene so north is the other way", less: "turn the scene so north is the other way", why: "with no magnet near, the needle points along the Earth's field (north)" },
		{ type: "can-on-side", key: "material", how: "choice", cost: 2, more: "use the other kind of can", less: "use the other kind of can", why: "a steel can is pulled by a magnet, an aluminium one is not (a charged balloon pulls both)" }
	],
	digest(item, run, h = {}) {
		const out = []
		const type = item?.type
		const P = run?.resolved?.[item?.id] ?? item?.props ?? {}
		const recs = recordsOf(run, item?.id)
		const state = run?.track?.state?.[item?.id] ?? {}
		const last = (k) => (Array.isArray(state[k]) && state[k].length ? state[k][state[k].length - 1] : null)
		if (MAGNET_TYPES.includes(type)) {
			const grade = typeof P.material === "string" && GRADES[P.material] ? GRADES[P.material] : null
			if (type === "battery-electromagnet") {
				const amps = last("amps")
				out.push(`electromagnet: ${P.turns ?? "?"} turns on ${P.cells ?? "?"} AA cell(s), ${P.on === false ? "switched OFF (pulls nothing)" : `on${P.on_at ? ` from ${P.on_at} s` : ""}`}${amps !== null ? `, ${Math.abs(amps).toFixed(1)} A` : ""}; its point is a ${P.flip ? "south" : "north"} pole`)
			} else if (grade) out.push(`${grade.words} magnet (B_r ${grade.br} T)${type === "ring-magnets" ? `, ${P.count ?? 3} rings, ${P.alternate === false ? "unlike faces together (they snap together)" : "like faces together (they float)"}` : ""}`)
			const head = last("heading_deg")
			if (head !== null && type !== "ring-magnets") out.push(`its north pole points ${compassWord(head)} (${deg360(head)}°)${P.flip ? " (flipped)" : ""}`)
			// what it ends near: every other magnetic or charged item within 10 cm at the end
			const others = new Set((run?.doc?.processes ?? []).filter((p) => p.kind === "magnetism" && p.item !== item?.id && typeof p.solid === "string").map((p) => p.item))
			const near = []
			for (const o of others) {
				const g = gapAtEnd(run, item.id, o)
				if (g !== null && g <= 0.1) near.push(`${o} ${g <= TOUCH ? "touching" : `${cmText(g)} away`}`)
			}
			if (near.length) out.push(`at the end: ${near.slice(0, 8).join(", ")}`)
		} else if (SOFT_TYPES.includes(type) || recs.some((r) => r.role === "soft")) {
			out.push("magnetic (iron/steel): any magnet's pole pulls it")
			const mag = last("magnetized")
			if (mag !== null) out.push(`magnetized ${mag.toFixed(0)} % at the end${mag >= 99 ? " (its steel is full: saturated)" : ""}`)
		} else if (NOT_MAGNETIC.includes(type)) {
			out.push("NOT magnetic: no magnet pulls it at all (a charged balloon pulls light conductors like foil a little)")
		}
		// (anything near a charge: a metal is a conductor, a light thing that is not a dielectric of its stuff's ε_r)
		const polar = recs.find((r) => r.role === "polar")
		if (polar && !["paper-bits", "pith-ball"].includes(type)) out.push(polar.epsr === 0 ? "a metal: a charged balloon or rod pulls it (charges in it move: a conductor)" : `not metal: a charged balloon or rod pulls it only weakly (a dielectric, ε_r ${fmt1(polar.epsr)}; light and close, within a few mm, it moves)`)
		if (type === "balloon" || type === "charged-rod" || type === "pith-ball") {
			const q = last("charge_uC")
			out.push(q !== null && q !== 0 ? `charge ${(q * 1000).toFixed(0)} nC${type === "balloon" ? ` on its ${P.rubbed_side ?? "bottom"} side` : ""}` : "no charge (not rubbed)")
		}
		if (type === "compass") {
			const head = last("heading_deg")
			if (head !== null) out.push(`needle's red end ends pointing ${compassWord(head)} (${deg360(head)}°; north is ${P.north ?? "right"})`)
		}
		const pull = last("pull_mN")
		if (pull !== null && pull > 0.001) out.push(`magnetic/electric force on it at the end: ${pull.toFixed(pull < 1 ? 3 : 1)} mN`)
		void h
		return out.length ? out : null
	},
	place: {},
	words: {
		// the words that name a setting in a request (web/sim/plugins.js keyWords): "flip the held magnet" names its flip, which then stays the
		// person's choice (a fix never turns it back)
		keys: {
			...Object.fromEntries(["bar-magnet", "horseshoe-magnet", "disc-magnet", "ring-magnets", "magnet-cart", "battery-electromagnet"].map((t) => [`${t}.flip`, "flip\\w*|turn\\w* (?:[\\w'-]+ ){0,9}a?round|rotat\\w* (?:[\\w'-]+ ){0,9}(?:180|half a turn|a?round)|revers\\w*|swap\\w* (?:its |the |their )?(?:poles|ends)|poles? (?:swapped|reversed|the other way|fac\\w*)|other way (?:round|around)|upside down|(?:north|south|n|s) (?:poles? |ends? )?(?:fac\\w*|toward\\w*|point\\w*)|(?:like|unlike|opposite|same|matching|different) (?:poles|ends)"])),
			"ring-magnets.alternate": "alternat\\w*|like faces|unlike faces|every other ring|turn\\w* (?:\\w+ ){0,3}over",
			"magnet-cart.magnet_end": "magnet end|other end|front|back",
			"battery-electromagnet.on": "switch\\w*|turn\\w* (?:\\w+ ){0,3}(?:on|off)|power\\w*|connect\\w*|disconnect\\w*",
			"battery-electromagnet.turns": "turns?|coil\\w*|wrap\\w*|winding\\w*|loops?",
			"battery-electromagnet.cells": "batter(?:y|ies)|cells?|volts?|voltage",
			"balloon.rubbed": "rub\\w*|charge\\w*|strokes?",
			"charged-rod.rubbed": "rub\\w*|charge\\w*|strokes?",
			"balloon.rubbed_side": "rubbed (?:side|patch)|(?:top|bottom|left|right|lower left|lower right) side",
			"balloon.on_thread": "thread|hang\\w*|hung|string",
			"compass.north": "north",
			"compass.earth": "earth\\w*",
			"paper-bits.paper": "tissue\\w*|printer paper"
		},
		// (an outcome said in other words than the goal kinds': "so the boat is pushed away", "so the magnet pulls the cart closer")
		outcomes: "push\\w* (?:\\w+ ){0,3}(?:away|apart|back)|pull\\w* (?:\\w+ ){0,3}(?:toward|towards|closer|nearer|in|together)|drawn (?:toward|towards|to)|jump\\w* up|pick\\w* (?:\\w+ ){0,3}up|snap\\w* together|swing\\w* apart|pulled|attracted|repelled|stuck|sticks?|cling\\w*|(?:is|are|be|gets?) not (?:pulled|attracted|picked up|lifted)|(?:does|do)n['’]?t (?:move|budge|jump|get pulled)|stays? (?:put|down|still|where it is)|point\\w* (?:at|to|toward|towards|north|south|left|right|the other way)|turn\\w* (?:a?round|to point|back)|fac\\w* each other",
		change(type, key, a, b, nameOf) {
			if (key === "material" && GRADES[a] && GRADES[b]) {
				// (an alnico bar's ends are partly demagnetized (mod_magnetism.py ALNICO_HC): near its end it pulls a clip 2 to 4 times as hard as a
				// ceramic bar does, a third to a half as hard as a neodymium one, not what its B_r says: research/rw-validate-magnetism.ts alnico)
				if ((type === "bar-magnet" || type === "magnet-cart") && a !== b && (a === "alnico" || b === "alnico"))
					return `${a} → ${b} magnet (an alnico bar's ends are partly demagnetized: near its end it pulls 2 to 4× as hard as a ceramic bar, a third to a half as hard as a neodymium one)`
				const ra = GRADES[a].br * GRADES[a].eff
				const rb = GRADES[b].br * GRADES[b].eff
				return `${a} → ${b} magnet (about ${fmt1((rb * rb) / (ra * ra))}× the pull at contact)`
			}
			if (key === "flip" && MAGNET_TYPES.includes(type)) return b ? "north and south poles swapped" : "poles back the usual way round"
			if (key === "rubbed" && (type === "balloon" || type === "charged-rod")) {
				const per = type === "balloon" ? 10 : 7
				const q = (n) => Math.min(10, Math.max(0, Math.trunc(n))) * per
				return `rubbed ${a} → ${b} times (${type === "balloon" ? "−" : ""}${q(a)} → ${type === "balloon" ? "−" : ""}${q(b)} nC)`
			}
			if (key === "alternate" && type === "ring-magnets") return b ? "rings turned so like faces meet: they float" : "rings turned so unlike faces meet: they snap together"
			if (key === "turns" && type === "battery-electromagnet") return `${a} → ${b} turns of wire (${fmt1(coil_amps(Math.trunc(b), 2, 0.0029) * b / (coil_amps(Math.trunc(a), 2, 0.0029) * a))}× the coil's field with 2 cells)`
			if (key === "material" && type === "barrier-sheet") return `${a} → ${b} sheet (${b === "steel" ? "steel blocks most of the pull" : "the pull passes straight through"})`
			if (key === "on" && type === "battery-electromagnet") return b ? "switched on" : "switched off: it pulls nothing"
			if (key === "size" && type === "paper-bits" && typeof a === "number" && typeof b === "number")
				return `paper scraps ${fmt1(a * 1000)} → ${fmt1(b * 1000)} mm (${b < a ? "lighter, but pulled less for their weight: they need a stronger or closer charge" : "heavier, but pulled more for their weight: a weaker charge lifts them"})`
			if (key === "north" && type === "compass") return `north set to the ${b} (the Earth's field turns its needle ${b})`
			void nameOf
			return null
		}
	}
}
