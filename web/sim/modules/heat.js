// The heat module: temperatures, heat flow and changes of state (melting, freezing, boiling, evaporation, dew), with salt on ice, plates and bowls,
// a desk lamp, a hot plate, thermometers, pots and cups of water, spoons, rods and meltable dabs, and the scene's time-lapse.
// A port of machines/mod_heat.py, line by line (same names, same order, same numbers); plain ES module, no dependencies beyond web/sim.
// web/sim/modules/index.js registers it (register_all, as a catalog file's) after the catalog files; its `plugin` export is the AI's view of it
// (goal kinds, digest, knobs, prompt lines, placement rules, change words: web/sim/plugins.js). Sources: see the Python file's docstring.
// (a module file takes everything from the framework object register_all gets: web/sim/items.js FRAMEWORK, its `py` = pymath.js)
let register, ItemType, Prop, Link, Readout, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, D2R, register_goal_kind, register_build_hook, TYPES, polygon_problem, CATEGORIES
let props_of, define_material, register_common_prop, COMMON_PROPS
let pyRound, pyRoundInt, hasOwn, ValueError, fmtG, truthy, cos, sin
let F = null
import { heatPlugin } from "./heat-ai.js"

export const MODULE = "heat"
const CAT = "Heat & temperature"

function _bind(g) {
	;({ register, ItemType, Prop, Link, Readout, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, D2R, register_goal_kind, register_build_hook, TYPES, polygon_problem, CATEGORIES } = g)
	;({ props_of, define_material, register_common_prop, COMMON_PROPS } = g)
	;({ pyRound, pyRoundInt, hasOwn, ValueError, fmtG, truthy, cos, sin } = g.py)
	F = g
}

/** Only what this module adds to another catalog's types for every scene: the candle's (a parity harness gives the everyday port what the whole
 *  server has with it: tools/parity/core.mjs loadCatalogWide). */
export function register_catalog_wide(g) {
	_bind(g)
	_candle_wide()
	register_build_hook(heat_hook)
}

export function register_all(g) {
	_bind(g)
	if (!CATEGORIES.includes(CAT)) CATEGORIES.push(CAT)
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
	// (the goal kinds are registered from `plugin.goals` by web/sim/modules/index.js)
}

// ---------------------------------------------------------------- looks and materials
function _looks() {
	add_look("salt", { fill: "#f4f4f0", shade: "#cfcfc8", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 })
	add_look("glazed", { fill: "#f2f0ea", shade: "#cdc9bf", roughness: 0.18, metalness: 0.0, clearcoat: 0.9 })
	add_look("melamine", { fill: "#f0eee8", shade: "#c9c5bb", roughness: 0.3, metalness: 0.0, clearcoat: 0.5 })
	add_look("paperboard", { fill: "#f3efe6", shade: "#cbc4b5", roughness: 0.8, metalness: 0.0, clearcoat: 0.0 })
	add_look("stainless", { fill: "#c3c8cc", shade: "#8c9297", roughness: 0.18, metalness: 1.0, clearcoat: 0.0 })
	add_look("enamel", { fill: "#2b2d30", shade: "#16171a", roughness: 0.35, metalness: 0.2, clearcoat: 0.3 })
	add_look("chocolate", { fill: "#5a3420", shade: "#3c2214", roughness: 0.4, metalness: 0.0, clearcoat: 0.3 })
	add_look("butter", { fill: "#f3dc7e", shade: "#d6bd5c", roughness: 0.45, metalness: 0.0, clearcoat: 0.2 })
	add_look("thermometer glass", { fill: "#e8f0f2", shade: "#b9c9cc", roughness: 0.05, metalness: 0.0, clearcoat: 1.0, transmission: 0.85, ior: 1.5, thickness: 0.004 })
	add_look("jar glass", { fill: "#e6f1f2", shade: "#b6c8cb", roughness: 0.04, metalness: 0.0, clearcoat: 1.0, transmission: 0.9, ior: 1.5, thickness: 0.003 })
}

/** MATERIALS[key] = kw (rolling and side 0.0 unless given, appended as dict.setdefault does); only when no module has it yet. Every number a float. */
function _mat(key, kw) {
	const values = { ...kw }
	if (!("rolling" in values)) values.rolling = 0.0
	if (!("side" in values)) values.side = 0.0
	if (!hasOwn(MATERIALS, key)) define_material(key, values, [])
}

function _materials() {
	_mat("table salt", { density: 1217.0, bounce: 0.05, friction: 0.6, rolling: 0.1, look: "salt",
		source: "A loose pile of table salt: 6 g a level teaspoon (4.93 mL) [USDA], about 1.22 g/mL; NaCl crystals 2.165 g/cm³ [CRC]. Barely bounces (provisional)." })
	_mat("stainless steel", { density: 8000.0, bounce: 0.9, friction: 0.4, rolling: 0.001, side: 0.1, look: "stainless",
		source: "Stainless steel AISI 304: 8000 kg/m³ [INC Table A.1]; it conducts heat about 4 times worse than plain steel (16 W/(m·K) against 60)." })
	_mat("copper", { density: 8933.0, bounce: 0.8, friction: 0.4, rolling: 0.001, look: "copper",
		source: "Copper 8933 kg/m³, the best ordinary conductor of heat: 401 W/(m·K) [INC Table A.1]. Bounce provisional." })
	_mat("melamine", { density: 1500.0, bounce: 0.6, friction: 0.4, rolling: 0.01, look: "melamine",
		source: "Melamine resin (plastic plates and bowls) about 1500 kg/m³; a poor conductor, 0.3-0.4 W/(m·K) (provisional)." })
	_mat("paperboard", { density: 700.0, bounce: 0.2, friction: 0.5, rolling: 0.02, look: "paperboard",
		source: "Paper plates and cups: paperboard about 700 kg/m³; a poor conductor (0.05-0.1 W/(m·K)) [INC Table A.3]. Bounce provisional." })
	_mat("vacuum flask", { density: 2000.0, bounce: 0.5, friction: 0.4, rolling: 0.005, look: "stainless",
		source: "A vacuum flask's double wall (stainless steel round a vacuum), as one wall: its weight is set by the item; its heat flow by the " +
			"engine's effective conductivity (a 0.5 L flask keeps 95 °C water above 75 °C for 6 h)." })
	_mat("chocolate", { density: 1300.0, bounce: 0.1, friction: 0.6, rolling: 0.05, look: "chocolate",
		source: "Milk chocolate about 1.3 g/cm³; melts at about 34 °C (cocoa butter form V) taking about 45 kJ/kg for the bar (Beckett, Industrial Chocolate Manufacture and Use)." })
	_mat("butter", { density: 911.0, bounce: 0.05, friction: 0.8, rolling: 0.1, look: "butter",
		source: "Butter 911 kg/m³; melts between 32 and 35 °C (its milk fat), about 70 kJ/kg (provisional)." })
	_mat("puddle water", { density: 998.0, bounce: 0.05, friction: 0.1, rolling: 0.0, look: "water",
		source: "Water 998 kg/m³ at 20 °C; a puddle about 1.5 mm deep (it spreads until surface tension holds it)." })
	_mat("dry sand", { density: 1600.0, bounce: 0.02, friction: 0.6, rolling: 0.2, look: hasOwn(LOOK_FILL, "sand") ? "sand" : "salt",
		source: "Dry sand poured loose: about 1600 kg/m³ (quartz 2650 with about 40 % pores); c 830 J/(kg·K) [CRC], k 0.27 W/(m·K) [INC Table A.3]." })
}

// ---------------------------------------------------------------- small helpers (as the Python, step for step)
const _r5 = (v) => pyRound(v, 5)
const _r6 = (v) => pyRound(v, 6)
/** Another module's material when it is loaded (the granular, fluids, mechanics or circuits module's), else one of the catalog's own. */
const _have = (key, fallback) => (hasOwn(MATERIALS, key) ? key : fallback)
const _look = (key, fallback) => (hasOwn(LOOK_FILL, key) ? key : fallback)

/** A solid welded to another solid of this item, `at` in the parent's own frame (an unturned parent: the item's frame from its at). */
function _child(c, part, parent, body, at, material, look, words, color = null) {
	const s = {
		kind: c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look, body, material,
		at: { x: _r5(at[0]), y: _r5(at[1]) }, parent, placeholder: { fill: truthy(color) ? color : LOOK_FILL[look] },
		render: { kind: "procedural", shade: LOOK_SHADE[look] }, depth: 2
	}
	if (truthy(color)) s.color = color
	c.sb.solids.push(s)
	return s.id
}

function _poly_body(pts, depth) {
	pts = pts.map(([x, y]) => [_r5(x), _r5(y)])
	const problem = polygon_problem(pts)
	if (problem) throw new ValueError(`polygon ${problem}`)
	return { kind: "polygon", points: pts.map(([x, y]) => ({ x, y })), depth: _r5(depth) }
}

function _poly_area(pts) {
	const n = pts.length
	let a = 0.0
	for (let k = 0; k < n; k++) a += pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1]
	return Math.abs(a) / 2
}

export const COLORS = { white: "#f2f0ea", blue: "#3f6fc2", red: "#c8443a", green: "#4f9a5a", yellow: "#e8c13a", black: "#2a2a2a", grey: "#9aa0a6",
	orange: "#e8823a", pink: "#e58fae", brown: "#7a5236" }
const COLOR_NAMES = Object.keys(COLORS)

/** Whether this scene runs heat: a heat item (it made a "heat" record) or a room temperature or time-lapse other than the standard. */
export function _heat_on(sb) {
	return sb.processes.some((p) => p.kind === "heat") || sb.settings.room_temp !== 20.0 || sb.settings.time_lapse !== 1.0 ||
		[...sb.scene_items.values()].some((i) => i !== null && typeof i === "object" && !Array.isArray(i) && i.type === "candle" && (i.props ?? {}).lit === true)
}

// ---------------------------------------------------------------- existing items that take part
const ROD_TYPES = ["steel-rod", "wooden-rod"]
const FLOW_TEMP_TYPES = ["pitcher", "tap"]
// a candle's flame [NIST-CANDLE] (heat-data.ts CANDLE): its heat, its wax burned a second, its light (1 cd: 12.6 lm) and radiation (20 % of 80 W)
const CANDLE_W = 80.0
const CANDLE_BURN = 1.66667e-6
const CANDLE_LM = 12.6
const CANDLE_IR = 16.0
const FLAME_UP = 0.0125
// flow's own sources
const FLOW_SOURCES = ["pitcher", "tap", "leaky-bottle", "hose"]

function _extend() {
	const t = TYPES["ice-cube"]
	if (t !== undefined && !t.props.some((p) => p.key === "start_temp_c")) {
		t.props.push(new Prop("start_temp_c", "Start temperature", -18.0, -30.0, 0.0, 1.0, "°C",
			"How cold it starts (a home freezer is −18 °C); it melts when the scene has heat (a time-lapse, a lamp, a plate, salt...)"))
		t.readouts.push(
			new Readout("temp", "Temperature", { unit: "°C", digits: 1, help: "Its ice (at 0 °C, or colder in salt water, while it melts)" }),
			new Readout("melted", "Melted", { unit: "", digits: 2, help: "The share of its ice that has melted (1 = all of it)" }),
			new Readout("puddle_g", "Puddle", { unit: "g", digits: 1, help: "Melt water that has run off into a puddle" })
		)
	}
	for (const key of ROD_TYPES) {
		const r = TYPES[key]
		if (r !== undefined && !r.readouts.some((ro) => ro.key === "temp0"))
			r.readouts.push(new Readout("temp0", "Temperature at the left end", { unit: "°C", digits: 1 }), new Readout("temp7", "Temperature at the right end", { unit: "°C", digits: 1 }))
	}
	const s = TYPES["steel-rod"]
	if (s !== undefined) for (const m of ["copper", "stainless steel", "glass"]) if (!s.materials.includes(m)) s.materials.push(m)
	_candle_wide()
	// flow's pitchers and taps say how warm their liquid is
	for (const key of FLOW_TEMP_TYPES) {
		const t = TYPES[key]
		if (t !== undefined && !t.props.some((p) => p.key === "temp_c"))
			t.props.push(new Prop("temp_c", "Liquid temperature", 20.0, 0.0, 100.0, 1.0, "°C",
				"How warm its liquid is (when the scene has heat: a thermometer, a time-lapse...): hot and cold water poured together mix to one temperature"))
	}
}

/** The highest point of a solid's own outline (its frame), m. */
function _top(solid) {
	const b = solid.body
	if (b.kind === "polygon") return Math.max(...b.points.map((q) => q.y))
	if (b.kind === "ball") return b.radius
	return b.height / 2
}

/** A fluids container's liquid as heat takes it: [water kg, salt kg, [[words, kg]] of its other liquids, kg/m³ of it all]. */
function _layer_liquids(rec, item) {
	let water = 0.0
	let salt = 0.0
	let other_kg = 0.0
	let vol = 0.0
	const others = []
	for (const lay of rec.layers ?? []) {
		const words = lay.words ?? ""
		const kg = lay.height * rec.area * lay.density
		vol += lay.height * rec.area
		if (words.includes("water")) {
			water += kg
			if (words === "salt water") {
				// its salt: the fluids module's salt share (salt_pct of the salt water)
				const P0 = props_of(item)
				const pct = hasOwn(P0, "salt_pct") ? P0.salt_pct : 0.0
				salt += (kg * pct) / 100.0
			} else if (words === "sea water") salt += kg * 0.035
		} else {
			others.push([words, pyRound(kg, 7)])
			other_kg += kg
		}
	}
	const rho = vol > 0 ? (water + other_kg) / vol : 998.2
	return [water, salt, others, rho]
}

// a thermometer or spoon through a lid: the lid has a hole where it crosses it (an insulated-cup lid's thermometer hole)
const PROBE_TYPES = ["thermometer", "spoon"]
const LID_GAP = 0.0015 // m of clearance either side of what goes through (provisional: a snug thermometer hole)
const LID_MIN = 0.002 // m: a piece of lid narrower than this is left out

/** A thermometer (or spoon) standing in a lidded cup or pan goes through its lid: the lid's slab is cut where each one crosses it into pieces
 *  welded to the vessel as the lid was (the first keeps the lid's id, the others are <item>/lid-2, -3 ...), and the water record's `cover`
 *  lists them (mod_heat.py _lid_holes, number for number). */
function _lid_holes(sb) {
	const by = new Map(sb.solids.map((s) => [s.id, s]))
	const typeOf = (iid) => (sb.scene_items.has(iid) ? sb.scene_items.get(iid)?.type : undefined)
	const probes = sb.solids.filter((s) => PROBE_TYPES.includes(typeOf(s.item)) && s.body.kind === "slab")
	if (!probes.length) return
	const lids = sb.solids.filter((s) => s.id === `${s.item}/lid` && by.has(s.parent) && ["drink-cup", "saucepan"].includes(typeOf(s.item)))
	for (const lid of lids) {
		const fl = by.get(lid.parent)
		const fx = fl.at.x
		const fy = fl.at.y
		const fa = hasOwn(fl, "angle") ? fl.angle : 0.0
		const fc = cos(fa)
		const fs = sin(fa)
		const lx = lid.at.x
		const ly = lid.at.y
		const w = lid.body.width
		const h = lid.body.height
		const y0 = ly - h / 2
		const y1 = ly + h / 2
		const gaps = []
		for (const pr of probes) {
			if (pr.item === lid.item) continue
			let x = pr.at.x
			let y = pr.at.y
			let a = hasOwn(pr, "angle") ? pr.angle : 0.0
			if (hasOwn(pr, "parent")) {
				const q = by.get(pr.parent)
				const qa = hasOwn(q, "angle") ? q.angle : 0.0
				;[x, y] = [q.at.x + x * cos(qa) - y * sin(qa), q.at.y + x * sin(qa) + y * cos(qa)]
				a += qa
			}
			const c = cos(a)
			const n = sin(a)
			const hw = pr.body.width / 2
			const hh = pr.body.height / 2
			const pts = []
			for (const [px, py] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
				const dx = x + px * c - py * n - fx
				const dy = y + px * n + py * c - fy
				pts.push([dx * fc + dy * fs, -dx * fs + dy * fc])
			}
			// (where its outline, in the floor's frame, is within the lid's band: its corners there and its sides' crossings of the band's edges)
			const us = pts.filter(([, v]) => y0 <= v && v <= y1).map(([u]) => u)
			for (let i = 0; i < 4; i++) {
				const [ua, va] = pts[i]
				const [ub, vb] = pts[(i + 1) % 4]
				for (const e of [y0, y1]) if ((va - e) * (vb - e) < 0) us.push(ua + ((ub - ua) * (e - va)) / (vb - va))
			}
			if (!us.length || Math.max(...us) < lx - w / 2 || Math.min(...us) > lx + w / 2) continue
			gaps.push([Math.min(...us) - LID_GAP, Math.max(...us) + LID_GAP])
		}
		if (!gaps.length) continue
		gaps.sort((p, q) => p[0] - q[0] || p[1] - q[1])
		const pieces = []
		let at = lx - w / 2
		for (const [g0, g1] of gaps) {
			if (g0 - at >= LID_MIN) pieces.push([at, g0])
			at = Math.max(at, g1)
		}
		if (lx + w / 2 - at >= LID_MIN) pieces.push([at, lx + w / 2])
		const k = sb.solids.indexOf(lid)
		const made = pieces.map(([a0, a1], i) => ({ ...lid, ...(i > 0 ? { id: `${lid.item}/lid-${i + 1}` } : {}), body: { ...lid.body, width: _r6(a1 - a0) }, at: { x: _r6((a0 + a1) / 2), y: ly } }))
		sb.solids.splice(k, 1, ...made)
		for (const rec of sb.processes)
			if (rec.kind === "heat" && rec.role === "water" && rec.item === lid.item && hasOwn(rec, "cover")) rec.cover = made.map((s) => s.id)
	}
}

/** The everyday candle can be lit: `lit` and `lit_at` as catalog-wide props of the candle alone (COMMON_PROPS: listed on it, never built unless an
 *  item sets them), its readouts, tags and words. */
function _candle_wide() {
	const cnd = TYPES.candle
	if (cnd === undefined) return
	if (!COMMON_PROPS.some(([p]) => p.key === "lit")) {
		const is_candle = (t) => t.key === "candle"
		register_common_prop(new Prop("lit", "Lit", false, { kind: "bool",
			help: "Light its wick (the scene then has heat): an 80 W flame that burns 0.1 g of wax a minute, warms what is over it and goes out in a closed jar" }), is_candle)
		register_common_prop(new Prop("lit_at", "Lit at", 0.0, 0.0, 20.0, 0.1, "s", "When its flame is lit (run seconds)"), is_candle)
	}
	if (!cnd.readouts.some((r) => r.key === "flame")) {
		cnd.readouts.push(new Readout("flame", "Flame", { unit: "", digits: 0, help: "1 while it burns, 0 once it is out" }), new Readout("burned_g", "Wax burned", { unit: "g", digits: 2 }),
			new Readout("temp", "Wax", { unit: "°C", digits: 1, help: "Its wax (the flame's heat rises away from it)" }))
		for (const t of ["flame", "lit candle", "burning", "combustion", "fire", "candle under a jar"]) if (!cnd.tags.includes(t)) cnd.tags.push(t)
		cnd.description += " Lit (heat): an 80 W flame 2.5 cm tall that burns 0.1 g of wax a minute (the candle gets lighter), heats what is over it " +
			"by its rising plume, gives light, and goes out under a closed jar (candle-jar) when the oxygen falls to about 16 %."
	}
}

export function heat_hook(sb, scene) {
	if (!_heat_on(sb)) return
	_lid_holes(sb)
	const items = (scene.items ?? []).filter((i) => i !== null && typeof i === "object" && !Array.isArray(i) && hasOwn(TYPES, i.type))
	for (const item of items) {
		const t = item.type
		if (t === "ice-cube") {
			const P = props_of(item)
			sb.processes.push({ kind: "heat", id: `${item.id}/heat`, item: item.id, role: "body", solid: `${item.id}/block`, start: P.start_temp_c })
		} else if (ROD_TYPES.includes(t)) {
			const P = props_of(item)
			sb.processes.push({ kind: "heat", id: `${item.id}/heat`, item: item.id, role: "body", solid: `${item.id}/rod`, cells: Math.max(4, Math.min(32, pyRoundInt(P.length / 0.01))), profile: true })
		}
	}
	// lit candles: a flame on the wick, and its light for the optics module's tracer when the scene has something of optics' (a screen, a light
	// meter, a lens, the sun...: it then gathers solids' "light"; else heat's own estimate carries the flame's radiation)
	const optics_on = (scene.items ?? []).some((i) => i !== null && typeof i === "object" && !Array.isArray(i) && hasOwn(TYPES, i.type) && TYPES[i.type].module === "optics")
	for (const item of items) {
		if (item.type !== "candle") continue
		const P = props_of(item)
		if (!truthy(P.lit)) continue
		const body = sb.solids.find((s) => s.item === item.id && s.id.endsWith("/body"))
		if (body === undefined) continue
		const top = _r5(_top(body))
		sb.processes.push({ kind: "heat", id: `${item.id}/flame`, item: item.id, role: "flame", solid: body.id,
			at: { x: 0.0, y: top }, power: CANDLE_W, burn: CANDLE_BURN, from: hasOwn(P, "lit_at") ? P.lit_at : 0.0 })
		if (optics_on)
			body.light = { id: `${item.id}/flame-light`, item: item.id, solid: body.id, kind: "lamp", x: 0.0,
				y: _r5(top + FLAME_UP), dir: 1.570796, spread: 3.1, out: 3.1, round: true, size: 0.012, blur: 0.0,
				rays: 64, light: "incandescent", lumens: CANDLE_LM, infrared: CANDLE_IR,
				drive: { item: item.id, key: "flame", scale: 1.0 } }
	}
	// flow's pitchers: their liquid at their temp_c (the room's when not set), its mass following what flow says is left in them (left_ml);
	// its taps: water that arrives at theirs
	const room = sb.settings.room_temp
	const pours = sb.processes.filter((p) => p.kind === "flow-pour" || p.kind === "flow-tap")
	for (const rec of pours) {
		const iid = rec.item
		const item = sb.scene_items.has(iid) ? sb.scene_items.get(iid) : null
		if (item === null || item === undefined) continue
		const given = item.props ?? {}
		const T = hasOwn(given, "temp_c") ? props_of(item).temp_c : room
		if (rec.kind === "flow-tap") {
			sb.processes.push({ kind: "heat", id: `${iid}/tap-heat`, item: iid, role: "tap", key: "flowed_ml", start: T })
			continue
		}
		const box = rec.inside
		const liq = rec.liquid
		const rho = liq.density
		const L = heat_liquid(liq.words)
		const fluids = L === null || L.water ? [] : [[liq.words, pyRound(rec.volume * rho, 7)]]
		let water = !fluids.length ? pyRound(rec.volume * rho, 7) : 0.0
		let salt = 0.0
		if (liq.words.startsWith("salt water")) {
			const P0 = props_of(item)
			const pct = hasOwn(P0, "salt_pct") ? P0.salt_pct : 0.0
			salt = pyRound((water * pct) / 100.0, 7)
			water = pyRound(water - salt, 7)
		} else if (liq.words === "sea water") {
			salt = pyRound(water * 0.035, 7)
			water = pyRound(water - salt, 7)
		}
		const rec2 = { kind: "heat", id: `${iid}/water-heat`, item: iid, role: "water", solid: rec.solid,
			x0: Math.min(...box.map((q) => q.x)), x1: Math.max(...box.map((q) => q.x)), y0: Math.min(...box.map((q) => q.y)), y1: Math.max(...box.map((q) => q.y)),
			depth: rec.depth, round: true, liquid: water, salt, start: T, wall: hasOwn(rec, "wall") ? rec.wall : 0.003, keep: true,
			density: rho, follow: { item: iid, key: "left_ml" } }
		if (fluids.length) rec2.fluids = fluids
		sb.processes.push(rec2)
	}
	// the liquids of the fluids module's containers: water (salt water, sea water) for heat at the item's water_temp_c, other liquids by their own
	// heat capacity; where flow pours, their liquid grows by what it brings (received_ml), even into an empty one
	const flowing = pours.length > 0 || (scene.items ?? []).some((i) => i !== null && typeof i === "object" && !Array.isArray(i) && FLOW_SOURCES.includes(i.type))
	for (const rec of sb.processes.filter((p) => p.kind === "liquid")) {
		const iid = rec.item
		const item = sb.scene_items.has(iid) ? sb.scene_items.get(iid) : null
		const layers = rec.layers ?? []
		if (item === null || (!layers.length && !flowing)) continue
		const [water, salt, others, rho] = _layer_liquids(rec, item)
		if (water <= 0 && !others.length && !flowing) continue
		const P = props_of(item)
		const floor = `${iid}/floor`
		const walls = sb.solids.filter((s) => s.item === iid && s.id !== floor && s.kind === "static").map((s) => s.id)
		const fs = sb.solids.find((s) => s.id === floor)
		const mat = fs !== undefined ? fs.material : "glass"
		const wall = _r6(hasOwn(P, "wall") ? P.wall : 0.003)
		sb.processes.push({ kind: "heat", id: `${iid}/vessel-heat`, item: iid, role: "body", solid: floor, with: walls })
		const wrec = {
			kind: "heat", id: `${iid}/water-heat`, item: iid, role: "water", solid: floor, frame: "world",
			x0: rec.x0, x1: rec.x1, y0: rec.floor, y1: rec.rim, area: rec.area,
			liquid: pyRound(water - salt, 7), salt: pyRound(salt, 7), start: hasOwn(P, "water_temp_c") ? P.water_temp_c : 20.0,
			wall, wallMaterial: mat
		}
		if (others.length) {
			wrec.fluids = others
			wrec.density = pyRound(rho, 4)
		}
		if (flowing) wrec.follow = { item: iid, key: "received_ml", add: true }
		sb.processes.push(wrec)
	}
	// a granular sand tray's sand: one body with the tray (the sand's heat capacity, 830 J/(kg·K) [CRC], and its absorptivity)
	for (const item of items) {
		if (item.type !== "sand-tray") continue
		const P = props_of(item)
		const g = item.id
		const sid = `${g}/sand`
		if (!sb.solids.some((s) => s.id === sid)) continue
		const kg = P.length * Math.min(P.sand_depth, P.wall) * Math.max(0.0, P.width - 0.024) * 1600.0
		sb.processes.push({ kind: "heat", id: `${g}/sand-heat`, item: g, role: "body", solid: sid, material: "dry sand", extra: [["dry sand", pyRound(kg, 6)]] })
	}
	// each heat record carries its item's name when it has one, for the run's events ("Salted ice cube melted completely")
	for (const rec of sb.processes) {
		if (rec.kind !== "heat") continue
		const it = sb.scene_items.has(rec.item) ? sb.scene_items.get(rec.item) : null
		const nm = it !== null && typeof it === "object" && !Array.isArray(it) ? it.name : undefined
		if (typeof nm === "string" && nm !== "") rec.name = nm
	}
}

// the liquids heat knows by their words (tooling/src/sim/heat-data.ts HEAT_LIQUIDS: the engine's own numbers; here only which are water)
const HEAT_LIQUID_WATER = { water: true, "salt water": true, "sea water": true, "vegetable oil": false, honey: false, "corn syrup": false, "dish soap": false, "rubbing alcohol": false }

/** {water: bool} for a liquid heat knows by its words ("salt water (10 % salt)" is salt water), else null. */
export function heat_liquid(words) {
	const base = words.includes(" (") ? words.slice(0, words.indexOf(" (")) : words
	return hasOwn(HEAT_LIQUID_WATER, base) ? { water: HEAT_LIQUID_WATER[base] } : null
}

// ---------------------------------------------------------------- salt
const SALT_BULK = { table: 1217.0, coarse: 1000.0 }
const SALT_RATE = { table: 0.1, coarse: 0.03 }
const TAN_REPOSE = 0.649408

/** The radius of a cone of salt at its angle of repose holding this volume: (π/3)·tan 33°·r³ = V, by Newton's method (60 fixed steps). */
export function cone_radius(volume) {
	const k = (3.0 * volume) / (Math.PI * TAN_REPOSE)
	let r = 0.01
	for (let i = 0; i < 60; i++) r = (2.0 * r + k / (r * r)) / 3.0
	return r
}

function _salt() {
	function build(c, P) {
		const m = P.mass_g / 1000.0
		const r = cone_radius(m / SALT_BULK[P.grain])
		const h = r * TAN_REPOSE
		const pts = [[-r, 0.0], [r, 0.0], [0.0, h]]
		const depth = 2.0 * r
		const dens = pyRound(m / (_poly_area(pts.map(([x, y]) => [_r5(x), _r5(y)])) * _r5(depth)), 4)
		const sid = c.poly("pile", pts, _r5(depth), 0.0, 0.0, { material: c.mat({ base: "table salt", density: dens }), look: "salt", words: "a pile of table salt" })
		c.process("heat", "salt", { role: "salt", solid: sid, mass: pyRound(m, 7), rate: SALT_RATE[P.grain] })
	}
	register(new ItemType("salt-pile", "Salt pile", CAT, build, {
		material: "table salt", materials: ["table salt"], module: MODULE,
		props: [new Prop("mass_g", "Salt", 3.0, 0.2, 30.0, 0.1, "g", "How much salt (a level teaspoon is 6 g)"),
			new Prop("grain", "Grain", "table", { kind: "choice", choices: ["table", "coarse"], help: "table: fine grains; coarse: kosher or rock salt, dissolves about 3 times slower" })],
		readouts: [new Readout("salt_g", "Salt left", { unit: "g", digits: 2, help: "What has not dissolved yet" })],
		tags: ["salt", "table salt", "sodium chloride", "rock salt", "de-icer", "sprinkle", "melt ice"],
		description: "A little cone of table salt. Put it ON an ice cube (resting on its top): it dissolves into the melt water and makes salt water, " +
			"which melts ice below 0 °C, so the cube melts sooner. More salt keeps the water saltier for longer. On a dry table nothing happens.",
		source: "A cone at salt's angle of repose (33°) of loose salt 1.22 g/mL (6 g a teaspoon [USDA]): 1 g is 2.1 cm across, 6 g 3.8 cm. Salt water " +
			"freezes at −3 °C at 5 %, −6.6 °C at 10 %, −21.1 °C at 23.3 % (the coldest) [CRC]; salt dissolves to 35.9 g per 100 g of water [CRC].",
		anchor: "the middle of its base", facts: "3 g of table salt, 2.7 cm across",
		edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- plates and bowls
const DISH_THICK = { ceramic: 0.005, glass: 0.005, melamine: 0.003, aluminium: 0.001, foam: 0.002, paperboard: 0.0012 }
const DISH_MATS = ["ceramic", "glass", "melamine", "aluminium", "foam", "paperboard"]
const FOOT_GAP = 0.004
const DISH_LOOK = { ceramic: "glazed", glass: "glass", melamine: "melamine", aluminium: "aluminium", foam: "foam", paperboard: "paperboard" }

/** The dish's own material with the density that gives it its real weight (a round dish, against the side view's slabs). */
function _dish_material(c, P, mass, volume) {
	return c.mat({ base: P.material, density: pyRound(mass / volume, 4) })
}

function _dishes() {
	function build_plate(c, P) {
		const D = P.diameter
		const mat = P.material
		const t = DISH_THICK[mat]
		const well = 0.62 * D
		const rise = (0.02 * D) / 0.27
		const color = mat !== "aluminium" && mat !== "glass" ? COLORS[P.color] : null
		const look = DISH_LOOK[mat]
		// a real plate's weight: a disc of its diameter and thickness (the side view's base and rims are slabs as deep as the plate)
		const mass = MATERIALS[mat].density * Math.PI * (D / 2) * (D / 2) * t
		const rim = [[well / 2, 0.0], [D / 2, rise], [D / 2, rise + t], [well / 2, t]]
		const vol = well * t * well + 2.0 * _poly_area(rim.map(([x, y]) => [_r5(x), _r5(y)])) * _r5(D)
		const m = _dish_material(c, P, mass, vol)
		const kw = truthy(color) ? { color, fill: color } : {}
		const base = c.slab("base", well, t, _r5(well), 0.0, t / 2, { material: m, look, words: "a dinner plate", ...kw })
		for (const [side, nm] of [[1, "rim-right"], [-1, "rim-left"]]) {
			let pts = rim.map(([x, y]) => [side * x, y])
			if (side < 0) pts = [pts[1], pts[0], pts[3], pts[2]]
			_child(c, nm, base, _poly_body(pts, D), [0.0, -t / 2], m, look, "the rim of a dinner plate", color)
		}
		c.process("heat", "heat", { role: "body", solid: base, cells: Math.max(4, Math.min(32, pyRoundInt(well / 0.01))), retain: 0.002, standoff: FOOT_GAP })
	}
	register(new ItemType("plate", "Plate", CAT, build_plate, {
		material: "ceramic", materials: DISH_MATS, module: MODULE,
		props: [new Prop("diameter", "Diameter", 0.27, 0.15, 0.32, 0.005, "m", "A dinner plate is 27 cm (10.5 in), a side plate 20 cm"),
			new Prop("color", "Colour", "white", { kind: "choice", choices: COLOR_NAMES, help: "The glaze or paint (not for aluminium or glass)" })],
		readouts: [new Readout("temp", "Temperature", { unit: "°C", digits: 1, help: "Its mean" }), new Readout("temp_min", "Coldest spot", { unit: "°C", digits: 1, help: "Under an ice cube, say" })],
		tags: ["plate", "dish", "dinner plate", "saucer", "ceramic", "china", "tray", "under the ice"],
		description: "A dinner plate with a low rim. Put an ice cube in its middle: melt water stays on it as a puddle. What it is made of matters: " +
			"an aluminium plate feeds heat to the cube far faster than ceramic, and foam hardly at all.",
		source: "A 27 cm (10.5 in) dinner plate: a flat well 62 % of its width, a rim 2 cm high; stoneware 5 mm (about 0.66 kg), melamine 3 mm, glass 5 mm, " +
			"an aluminium pie plate 1 mm, foam 2 mm (about 5 g), paper 1.2 mm. Heat flows along it cell by cell (1 cm each).",
		anchor: "the middle of its base, where it stands", facts: "27 cm stoneware dinner plate",
		edit: [{ kind: "rotate" }]
	}))

	function build_bowl(c, P) {
		const D = P.diameter
		const H = P.height
		const mat = P.material
		const t = DISH_THICK[mat]
		const b = 0.55 * D
		const color = mat !== "aluminium" && mat !== "glass" ? COLORS[P.color] : null
		const look = DISH_LOOK[mat]
		const slant = Math.sqrt((D / 2 - b / 2) * (D / 2 - b / 2) + H * H)
		const mass = MATERIALS[mat].density * t * (Math.PI * (b / 2) * (b / 2) + Math.PI * (b / 2 + D / 2) * slant)
		const wall = [[b / 2 - t, 0.0], [b / 2, 0.0], [D / 2, H], [D / 2 - t, H]]
		const vol = b * t * b + 2.0 * _poly_area(wall.map(([x, y]) => [_r5(x), _r5(y)])) * _r5(D)
		const m = _dish_material(c, P, mass, vol)
		const kw = truthy(color) ? { color, fill: color } : {}
		const base = c.slab("base", b, t, _r5(b), 0.0, t / 2, { material: m, look, words: "a bowl", ...kw })
		for (const [side, nm] of [[1, "wall-right"], [-1, "wall-left"]]) {
			let pts = wall.map(([x, y]) => [side * x, y])
			if (side < 0) pts = [pts[1], pts[0], pts[3], pts[2]]
			_child(c, nm, base, _poly_body(pts, D), [0.0, -t / 2], m, look, "the side of a bowl", color)
		}
		c.process("heat", "heat", { role: "body", solid: base, cells: Math.max(4, Math.min(32, pyRoundInt(b / 0.01))), retain: 0.005, standoff: FOOT_GAP })
		_contents(c, P, b, D, H, t)
	}
	register(new ItemType("bowl", "Bowl", CAT, build_bowl, {
		material: "ceramic", materials: DISH_MATS, module: MODULE,
		props: [new Prop("diameter", "Diameter", 0.15, 0.1, 0.3, 0.005, "m", "Across the rim"), new Prop("height", "Height", 0.065, 0.04, 0.12, 0.005, "m"),
			new Prop("color", "Colour", "white", { kind: "choice", choices: COLOR_NAMES, help: "The glaze or paint (not for aluminium or glass)" }),
			new Prop("contents", "Holds", "nothing", { kind: "choice", choices: ["nothing", "water", "sand"],
				help: "water, or dry sand (sand warms about 5 times faster than water under the same lamp: c 830 against 4184 J/(kg·K))" }),
			new Prop("contents_g", "How much", 200.0, 10.0, 1000.0, 10.0, "g", "Of the water or sand"),
			new Prop("contents_temp_c", "Its temperature", 20.0, 0.0, 90.0, 1.0, "°C", "Where the water or sand starts")],
		readouts: [new Readout("temp", "Temperature", { unit: "°C", digits: 1, help: "Its mean" }), new Readout("temp_min", "Coldest spot", { unit: "°C", digits: 1 })],
		tags: ["bowl", "dish", "cereal bowl", "soup bowl", "ceramic", "basin"],
		description: "A cereal bowl. An ice cube in it sits in its own melt water (the bowl holds about 5 mm of it round the cube), so salt on the " +
			"cube stays in contact longer than on a flat plate.",
		source: "A 15 cm × 6.5 cm stoneware cereal bowl, 5 mm thick, about 0.38 kg; the floor 55 % of its width.",
		anchor: "the middle of its base, where it stands", facts: "15 cm stoneware bowl",
		edit: [{ kind: "rotate" }]
	}))
}

/** A bowl's water (a water record over its floor) or dry sand (a slab of it lying on its floor: its own body), when it holds some. */
function _contents(c, P, b, D, H, t) {
	const what = P.contents
	const kg = P.contents_g / 1000.0
	// (where flow's pitchers or taps pour, it catches liquid: its water then follows what flow says it has received, mixing heat for heat)
	const flowing = [...c.sb.scene_items.values()].some((i) => i !== null && typeof i === "object" && !Array.isArray(i) && FLOW_SOURCES.includes(i.type))
	if (what === "water" || (flowing && what === "nothing")) {
		const extra = flowing ? { follow: { item: c.item.id, key: "liquid_ml", add: true } } : {}
		c.process("heat", "water", { role: "water", solid: c.sid("base"), x0: _r6(-(b / 2 - t)), x1: _r6(b / 2 - t), y0: _r6(t / 2), y1: _r6(t / 2 + H),
			depth: _r6((b + D) / 2), round: true, liquid: what === "water" ? pyRound(kg, 7) : 0.0, start: P.contents_temp_c, lid: false,
			salt: 0.0, wall: t, wallMaterial: P.material, ...extra })
	} else if (what === "sand") {
		const w = b - 2 * t - 0.002
		const hs = kg / (1600.0 * w * b)
		c.slab("sand", w, hs, _r5(b), 0.0, t + hs / 2 + 0.0005, { material: c.mat({ base: "dry sand", density: pyRound(kg / (_r5(w) * _r5(hs) * _r5(b)), 4), overrides: {} }),
			look: _look("sand", "salt"), words: "dry sand in the bowl" })
		c.process("heat", "sand-heat", { role: "body", solid: c.sid("sand"), start: P.contents_temp_c })
	}
}

// ---------------------------------------------------------------- the desk lamp
export const BULBS = { incandescent: 0.8, halogen: 0.8, led: 0.35 }
const SHADE = 0.7

/** The lamp's head pivot (item frame), the beam's direction (a unit vector, item frame) and the bulb (item frame). The beam points at its
 *  target item when it has one, else along `aim` (degrees from +x, counter-clockwise). */
export function lamp_geometry(P, item, scene_items) {
	const hx = 0.12
	const hy = P.head_height
	const tid = P.target
	const target = typeof tid === "string" && tid !== item.id && scene_items.has(tid) ? scene_items.get(tid) : null
	let ux = null
	let uy = null
	if (target !== null) {
		const dx = Number(target.x ?? 0.0) - (Number(item.x ?? 0.0) + hx)
		const dy = Number(target.y ?? 0.0) - (Number(item.y ?? 0.0) + hy)
		const d = Math.sqrt(dx * dx + dy * dy)
		if (d > 1e-6) {
			ux = dx / d
			uy = dy / d
		}
	}
	if (ux === null) {
		const a = P.aim * D2R
		ux = cos(a)
		uy = sin(a)
	}
	return [[hx, hy], [ux, uy], [hx + 0.03 * ux, hy + 0.03 * uy]]
}

function _lamp() {
	function build(c, P) {
		const [[hx, hy], [ux, uy], [bx, by]] = lamp_geometry(P, c.item, c.sb.scene_items)
		const base = c.slab("base", 0.15, 0.025, 0.15, 0.0, 0.0125, { material: c.mat({ base: "steel", overrides: {} }), look: "enamel", words: "a desk lamp's weighted base" })
		// the arm: a 1.2 cm bar from the base's top to the head
		const ax = -0.02
		const ay = 0.025
		const dx = hx - ax
		const dy = hy - ay
		const L = Math.sqrt(dx * dx + dy * dy)
		const nx = (-dy / L) * 0.006
		const ny = (dx / L) * 0.006
		const arm = [[ax - nx, ay - ny], [hx - nx, hy - ny], [hx + nx, hy + ny], [ax + nx, ay + ny]]
		c.poly("arm", arm, 0.012, 0.0, 0.0, { material: c.mat({ base: "steel", overrides: {} }), look: "enamel", words: "a desk lamp's arm", kind: "static" })
		// the shade: a cone along the beam, 6 cm across at its back and 13 cm at its mouth, 11 cm long
		const px = -uy
		const py = ux
		const b0x = hx - 0.02 * ux
		const b0y = hy - 0.02 * uy
		const m0x = hx + 0.09 * ux
		const m0y = hy + 0.09 * uy
		const shade = [[b0x - 0.03 * px, b0y - 0.03 * py], [m0x - 0.065 * px, m0y - 0.065 * py], [m0x + 0.065 * px, m0y + 0.065 * py], [b0x + 0.03 * px, b0y + 0.03 * py]]
		c.poly("shade", shade, 0.13, 0.0, 0.0, { material: c.mat({ base: "steel", overrides: {} }), look: "enamel", words: "a desk lamp's shade", kind: "static" })
		const on = P.on
		c.process("heat", "light", {
			role: "lamp", solid: base, at: { x: _r5(bx), y: _r5(by - 0.0125) }, dir: { x: _r6(ux), y: _r6(uy) },
			spread: _r6((P.beam_angle / 2) * D2R), power: pyRound(P.power_w * BULBS[P.bulb] * SHADE, 4),
			...(truthy(on) ? { from: P.on_at } : { from: 1e9 })
		})
	}
	register(new ItemType("lamp", "Desk lamp", CAT, build, {
		dynamic: false, module: MODULE,
		props: [new Prop("bulb", "Bulb", "incandescent", { kind: "choice", choices: Object.keys(BULBS),
			help: "incandescent (old-style, hot) or halogen: about 80 % of its power comes out as light and heat; LED: about 35 %, almost no heat" }),
		new Prop("power_w", "Power", 60.0, 1.0, 150.0, 1.0, "W", "What the bulb draws (an LED filament bulb 2-8 W, an old-style bulb 25-150 W)"),
		new Prop("on", "On", true, { kind: "bool" }),
		new Prop("on_at", "Turns on at", 0.0, 0.0, 20.0, 0.1, "s", "When it switches on (run seconds)"),
		new Prop("aim", "Aim", -60.0, -180.0, 180.0, 1.0, "°", "Which way the beam points (0 right, −90 straight down); its target wins"),
		new Prop("beam_angle", "Beam angle", 100.0, 40.0, 140.0, 1.0, "°", "How wide the beam spreads (full cone)"),
		new Prop("head_height", "Head height", 0.4, 0.2, 0.6, 0.01, "m", "How high the shade is above the base")],
		links: [new Link("target", "Shines on", { help: "Aim the beam at this item (its middle)" })],
		readouts: [new Readout("on", "On", { unit: "", digits: 0 })],
		tags: ["lamp", "desk lamp", "light", "bulb", "heat lamp", "incandescent", "led", "halogen", "torch", "spotlight", "sun lamp"],
		description: "A desk lamp on a heavy base whose shade shines a cone of light and warmth. What its beam reaches warms (an ice cube melts sooner), " +
			"more the nearer it is (1/distance²). Link it to a target and it points at it. An LED bulb gives light but almost no heat.",
		source: "A 60 W incandescent bulb gives about 48 W of light and infrared (7.5 % light, 73 % infrared [IES]); the shade sends about 70 % of it into " +
			"a 100° cone: about 15 W per steradian, 240 W/m² at 25 cm (sunlight is about 1000 W/m²). An LED lamp about 35 % [DOE].",
		anchor: "the middle of its base, where it stands", facts: "60 W incandescent, shade 40 cm up",
		edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- thermometers
export const THERMOMETERS = {
	glass: [0.16, 2e-4, 0.006, 43.7],
	digital: [0.066, 1.5e-4, 0.0035, 37.0]
}

function _thermometer() {
	function build(c, P) {
		const style = P.style
		const [cap, area, size, res] = THERMOMETERS[style]
		let sid
		let at
		if (style === "glass") {
			// a 30 cm × 7 mm glass stem; its bulb (the anchor) at the bottom
			sid = c.slab("stem", 0.007, 0.3, 0.007, 0.0, 0.144, { material: c.mat({ base: "glass", density: pyRound(0.015 / (0.007 * 0.3 * 0.007), 4) }), look: "thermometer glass",
				words: "a glass thermometer" })
			at = { x: 0.0, y: -0.144 }
		} else {
			// a 12 cm stainless probe with its tip (the anchor) at the bottom, and its 5 × 8 cm display head on top
			sid = c.slab("probe", 0.0035, 0.12, 0.0035, 0.0, 0.06, { material: c.mat({ base: "stainless steel", density: pyRound(0.03 / (0.0035 * 0.12 * 0.0035), 4) }),
				look: "stainless", words: "a digital thermometer's probe" })
			_child(c, "display", sid, { kind: "slab", width: 0.05, height: 0.08, depth: 0.02 }, [0.0, 0.1], c.mat({ base: "ABS plastic", density: pyRound(0.06 / (0.05 * 0.08 * 0.02), 4) }),
				"plastic", "a digital thermometer's display", "#e8e8e4")
			at = { x: 0.0, y: -0.06 }
		}
		c.process("heat", "bulb", { role: "sensor", solid: sid, at, capacity: cap, area, size, resistance: res, absorptivity: style === "glass" ? 0.5 : 0.3 })
	}
	register(new ItemType("thermometer", "Thermometer", CAT, build, {
		module: MODULE,
		props: [new Prop("style", "Kind", "glass", { kind: "choice", choices: Object.keys(THERMOMETERS),
			help: "glass: a lab thermometer, a red column (−10 to 110 °C); digital: a probe with a display (0.1 °C)" }),
		new Prop("units", "Shows", "C", { kind: "choice", choices: ["C", "F"], help: "Degrees Celsius or Fahrenheit (the reading is kept in °C)" })],
		readouts: [new Readout("reading", "Reads", { unit: "°C", digits: 1, help: "The temperature of what its bulb (tip) is in or touches, else the air's" }),
			new Readout("in_water", "Bulb in water", { unit: "", digits: 0, help: "Whether its bulb (tip) is in water now", words: { 0: "no", 1: "yes" } })],
		tags: ["thermometer", "temperature", "probe", "measure", "degrees", "celsius", "fahrenheit", "instrument", "lab"],
		description: "Reads the temperature of what its bulb (the bottom end) is in or touches: water in a cup, a plate, else the air. It takes a " +
			"while to settle: about 8 s in water and a minute in air for the glass one (3 s and 30 s for the digital probe). In a lamp's beam or " +
			"the sun it reads high. Tick Fixed to stand it upright in a cup.",
		source: "A 30 cm × 7 mm glass lab thermometer, 15 g, alcohol column; a stainless digital probe 12 cm × 3.5 mm. Response times from typical specs " +
			"(provisional): the bulb's heat capacity and inside resistance give them.",
		anchor: "its bulb (the bottom end)", facts: "glass lab thermometer, −10 to 110 °C",
		edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- the hot plate
function _hot_plate() {
	function build(c, P) {
		c.slab("body", 0.2, 0.08, 0.2, 0.0, 0.04, { material: c.mat({ base: "steel", overrides: {} }), look: "enamel", words: "a hot plate's body", kind: "static" })
		const top = c.slab("top", 0.18, 0.006, 0.18, 0.0, 0.083, { material: c.mat({ base: "aluminium", overrides: {} }), look: "aluminium", words: "a hot plate's top", kind: "static" })
		const on = P.on
		c.process("heat", "heater", { role: "heater", solid: top, power: P.power_w, setpoint: P.setpoint_c, ...(truthy(on) ? { from: P.on_at } : { from: 1e9 }) })
	}
	register(new ItemType("hot-plate", "Hot plate", CAT, build, {
		dynamic: false, module: MODULE,
		props: [new Prop("power_w", "Power", 600.0, 100.0, 1500.0, 10.0, "W", "How fast it heats"),
			new Prop("setpoint_c", "Set to", 250.0, 20.0, 550.0, 5.0, "°C", "Its thermostat keeps the top within 5 °C of this; it glows dull red above about 500 °C"),
			new Prop("on", "On", true, { kind: "bool" }), new Prop("on_at", "Turns on at", 0.0, 0.0, 20.0, 0.1, "s", "When it switches on (run seconds)")],
		readouts: [new Readout("temp", "Top", { unit: "°C", digits: 0 }), new Readout("power", "Heating", { unit: "W", digits: 0 })],
		tags: ["hot plate", "stove", "hob", "burner", "cooker", "heater", "boil", "lab", "heat"],
		description: "An electric hot plate with an aluminium top 18 cm square. What stands on it (a pot, a beaker, a block) is heated through the touch; " +
			"its thermostat holds the top near its setting. 600 W brings 1 L of water to the boil in about 10 minutes.",
		source: "A lab hot plate: 18 × 18 cm aluminium top 6 mm, 100-1500 W, thermostat ±5 °C; it glows dull red above about 500 °C (Draper point 525 °C).",
		anchor: "the middle of its base, where it stands", facts: "600 W, set to 250 °C",
		edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- pots and cups of water
export const CUPS = {
	foam: [0.085, 0.055, 0.105, 0.0025, 0.0025, "foam", "foam", 0.004, "a foam cup"],
	paper: [0.085, 0.055, 0.105, 0.002, 0.0006, "paperboard", "paperboard", 0.012, "a paper cup"],
	plastic: [0.085, 0.055, 0.105, 0.002, 0.0006, "polypropylene", "plastic", 0.01, "a plastic cup"],
	glass: [0.07, 0.065, 0.11, 0.003, 0.003, "glass", "glass", 0.25, "a drinking glass"],
	steel: [0.07, 0.065, 0.11, 0.002, 0.0008, "stainless steel", "stainless", 0.15, "a steel tumbler"],
	mug: [0.073, 0.073, 0.088, 0.0043, 0.0043, "ceramic", "glazed", 0.33, "a ceramic mug"],
	flask: [0.06, 0.06, 0.18, 0.004, 0.01, "vacuum flask", "stainless", 0.35, "a vacuum flask"]
}

/** The water in a vessel whose floor (`solid`, t thick) has its middle t/2 above the item's anchor: its inside in the floor's own frame. */
function _water_record(c, part, solid, inner_top, inner_bottom, t, H, water_kg, P, wall, wall_mat) {
	c.process("heat", part, {
		role: "water", solid, x0: _r6(-inner_top / 2), x1: _r6(inner_top / 2), y0: _r6(t / 2), y1: _r6(t / 2 + H),
		depth: _r6((inner_top + inner_bottom) / 2), round: true, liquid: pyRound(water_kg, 7), start: P.water_temp_c,
		lid: truthy(P.lid), salt: pyRound((hasOwn(P, "salt_g") ? P.salt_g : 0.0) / 1000.0, 7), wall, wallMaterial: wall_mat,
		...(truthy(P.lid) ? { cover: [c.sid("lid")] } : {})
	})
}

const HANDLES = { pot: [0.12, 0.012, 0.02], mug: [0.025, 0.06, 0.012] }

/** A round vessel in side view: a floor and two walls (tapered when its top is wider), welded; a handle; its lid when P.lid. Returns the floor's id. */
function _vessel(c, P, inner_top, inner_bottom, H, t, mat, look, mass, words, color = null, handle = null) {
	const floor_w = _r5(inner_bottom + 2 * t)
	const walls = []
	for (const [side, nm] of [[-1, "wall-left"], [1, "wall-right"]]) {
		// a wall from the floor's edge up to the rim: a parallelogram whose inner face runs from (b/2, 0) to (top/2, t + H)
		const x0 = (side * inner_bottom) / 2
		const x1 = (side * inner_top) / 2
		let pts = [[x0, 0.0], [x0 + side * t, 0.0], [x1 + side * t, t + H], [x1, t + H]]
		if (side < 0) pts = [pts[1], pts[0], pts[3], pts[2]]
		walls.push([nm, pts.map(([x, y]) => [_r5(x), _r5(y)])])
	}
	const depth = _r5(inner_top + 2 * t)
	let vol = floor_w * t * floor_w
	for (const [, pts] of walls) vol += _poly_area(pts) * depth
	let hw = 0.0
	let hh = 0.0
	let hd = 0.0
	if (handle !== null) {
		;[hw, hh, hd] = HANDLES[handle]
		vol += hw * hh * hd
	}
	const lid = _r5(inner_top + 2 * t + 0.004)
	if (truthy(P.lid)) vol += lid * 0.004 * lid
	const m = c.mat({ base: mat, density: pyRound(mass / vol, 4) })
	const kw = truthy(color) ? { color, fill: color } : {}
	const floor = c.slab("floor", floor_w, t, floor_w, 0.0, t / 2, { material: m, look, words, ...kw })
	for (const [nm, pts] of walls) _child(c, nm, floor, _poly_body(pts, depth), [0.0, -t / 2], m, look, words, color)
	if (handle !== null) {
		const y = handle === "pot" ? H - 0.01 : t + H / 2
		_child(c, "handle", floor, { kind: "slab", width: hw, height: hh, depth: hd }, [inner_top / 2 + t + hw / 2, y - t / 2], m, look, words, color)
	}
	if (truthy(P.lid)) _child(c, "lid", floor, { kind: "slab", width: lid, height: 0.004, depth: lid }, [0.0, t + H + 0.002 - t / 2], m, look, `the lid of ${words}`, color)
	return floor
}

function _vessels() {
	function build_pot(c, P) {
		const D = P.diameter
		const H = P.height
		const t = 0.003
		const floor = _vessel(c, P, D, D, H, t, "stainless steel", "stainless", 0.9 * (D / 0.18) * (D / 0.18), "a saucepan", null, "pot")
		const cap = Math.PI * (D / 2) * (D / 2) * (H - 0.005)
		const water = Math.min(P.water_ml / 1e6, cap) * 998.2
		_water_record(c, "water", floor, D, D, t, H, water, P, 0.001, "stainless steel")
	}
	register(new ItemType("saucepan", "Saucepan of water", CAT, build_pot, {
		module: MODULE, material: "stainless steel", materials: ["stainless steel"],
		props: [new Prop("diameter", "Diameter", 0.18, 0.12, 0.3, 0.005, "m", "Inside"), new Prop("height", "Height", 0.1, 0.06, 0.18, 0.005, "m"),
			new Prop("water_ml", "Water", 1000.0, 0.0, 3000.0, 10.0, "mL", "Up to what fits"),
			new Prop("water_temp_c", "Water temperature", 20.0, 0.0, 100.0, 1.0, "°C"),
			new Prop("salt_g", "Salt in it", 0.0, 0.0, 200.0, 1.0, "g", "Salt water boils a little hotter and freezes colder"),
			new Prop("lid", "Lid on", false, { kind: "bool", help: "A lid keeps the steam in: no water boils away, less heat is lost" })],
		readouts: [new Readout("water_temp", "Water", { unit: "°C", digits: 1 }), new Readout("water_g", "Water left", { unit: "g", digits: 0 }), new Readout("boiling", "Boiling", { unit: "", digits: 0 }),
			new Readout("temp", "Pan", { unit: "°C", digits: 0 })],
		tags: ["pot", "pan", "saucepan", "boil", "boiling", "water", "cook", "kettle", "steam", "stove"],
		description: "A stainless steel saucepan of water. Stand it on a hot plate: the water warms, boils at 100 °C (the thermometer stops rising while " +
			"it boils) and boils away; with the lid on, no water is lost. Off the heat it cools, mostly by evaporating from its surface.",
		source: "An 18 cm stainless saucepan about 0.9 kg, a 3 mm base; water 998.2 kg/m³, 4184 J/(kg·K), boils at 100 °C taking 2257 kJ/kg [CRC].",
		anchor: "the middle of its base, where it stands", facts: "18 cm saucepan, 1 L of water at 20 °C",
		edit: [{ kind: "rotate" }]
	}))

	function build_cup(c, P) {
		const [top, bottom, H, t, t_heat, mat, look, mass, words] = CUPS[P.style]
		const color = ["plastic", "mug", "paper"].includes(P.style) ? COLORS[P.color] : null
		const floor = _vessel(c, P, top, bottom, H, t, mat, look, mass, words, color, P.style === "mug" ? "mug" : null)
		const cap = ((((Math.PI * (top + bottom)) / 4) * (top + bottom)) / 4) * (H - 0.003)
		const water = Math.min(P.water_ml / 1e6, cap) * 998.2
		_water_record(c, "water", floor, top, bottom, t, H, water, P, t_heat, mat)
	}
	register(new ItemType("drink-cup", "Cup of water", CAT, build_cup, {
		module: MODULE,
		props: [new Prop("style", "Cup", "foam", { kind: "choice", choices: Object.keys(CUPS),
			help: "foam (insulated), paper, plastic, glass, steel tumbler, ceramic mug, or a vacuum flask (the best insulator)" }),
		new Prop("water_ml", "Water", 200.0, 0.0, 500.0, 5.0, "mL", "Up to what fits"),
		new Prop("water_temp_c", "Water temperature", 80.0, 0.0, 100.0, 1.0, "°C", "Hot tea or cocoa is about 70-80 °C"),
		new Prop("lid", "Lid on", false, { kind: "bool", help: "A lid stops evaporation, which takes a third to a half of an open hot drink's heat (a thermometer or spoon goes through it)" }),
		new Prop("color", "Colour", "white", { kind: "choice", choices: COLOR_NAMES, help: "Paper, plastic and mug cups" })],
		readouts: [new Readout("water_temp", "Water", { unit: "°C", digits: 1 }), new Readout("water_g", "Water", { unit: "g", digits: 0 }), new Readout("temp", "Cup", { unit: "°C", digits: 1 })],
		tags: ["cup", "mug", "insulated cup", "foam cup", "styrofoam", "thermos", "vacuum flask", "tumbler", "hot chocolate", "cocoa", "tea", "coffee",
			"glass of water", "cold drink", "ice water"],
		description: "A cup of water at a temperature you choose. Hot water cools (cold water warms) through the cup's wall and from its surface: a foam " +
			"cup with a lid keeps it hot longest after a vacuum flask; an open paper or plastic cup cools fastest; a shiny steel tumbler gets hot " +
			"to touch but radiates little; an open cup loses a third to a half of its heat by evaporation, which a lid stops. Put a " +
			"thermometer in it (bulb in the water; it goes through the lid) to read it; drop an ice cube in and it melts and chills the water.",
		source: "Cup sizes: 12 oz foam or paper cup 8.5 cm across the top, 5.5 cm at the base, 10.5 cm tall; walls: foam 2.5 mm (k 0.033), paper 0.6 mm, " +
			"steel 0.8 mm, glass 3 mm, mug 4.3 mm; a vacuum flask as an effective wall [INC Table A.3]. Evaporation by the heat and mass transfer " +
			"analogy, which agrees with Carrier's equation [ASHRAE].",
		anchor: "the middle of its base, where it stands", facts: "foam cup, 200 mL at 80 °C",
		edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- spoons, rods and meltables
export const SPOONS = {
	"stainless steel": [0.002, 0.012, "stainless"],
	aluminium: [0.002, 0.012, "aluminium"],
	copper: [0.002, 0.012, "copper"],
	polypropylene: [0.003, 0.012, "plastic"],
	"varnished hardwood": [0.006, 0.02, "wood"]
}

function _spoon() {
	function build(c, P) {
		const mat = P.material
		const [th, w, look] = SPOONS[mat]
		const L = P.length
		const sid = c.slab("spoon", L, th, w, 0.0, 0.0, { material: c.mat({ base: mat, overrides: {} }), look, words: "a spoon" })
		c.process("heat", "heat", { role: "body", solid: sid, cells: Math.max(4, Math.min(32, pyRoundInt(L / 0.01))), profile: true })
	}
	register(new ItemType("spoon", "Spoon", CAT, build, {
		module: MODULE, material: "stainless steel", materials: Object.keys(SPOONS),
		props: [new Prop("length", "Length", 0.15, 0.1, 0.35, 0.005, "m", "A teaspoon is 15 cm, a wooden spoon 25-30 cm")],
		readouts: [new Readout("temp0", "Bowl end", { unit: "°C", digits: 1, help: "Its left end (the bowl)" }), new Readout("temp7", "Handle end", { unit: "°C", digits: 1, help: "Its right end (the handle)" }),
			new Readout("temp", "Mean", { unit: "°C", digits: 1 })],
		tags: ["spoon", "teaspoon", "wooden spoon", "metal spoon", "plastic spoon", "conductor", "insulator", "utensil", "stir"],
		description: "A spoon (its bowl at its left end). Stand its bowl end in hot water and heat creeps along it: a metal spoon's handle gets " +
			"warm (copper and aluminium fast, stainless steel slowly), a plastic or wooden one hardly at all. Heat flows along it cell by cell.",
		source: "A teaspoon 15 cm: stainless steel 25 g (k 16 W/(m·K)), aluminium 9 g (237), copper (401), plastic 3-5 g (0.22); a wooden spoon 25-30 cm " +
			"(0.16) [INC Tables A.1, A.3].",
		anchor: "its middle", facts: "15 cm stainless teaspoon",
		edit: [{ kind: "length", prop: "length" }, { kind: "rotate" }]
	}))
}

function _meltable() {
	function build(c, P) {
		const sid = c.slab("piece", P.width, P.height, P.depth, 0.0, 0.0, { material: c.mat({ base: P.material, overrides: {} }),
			look: MATERIALS[P.material].look, words: `a piece of ${P.material}` })
		c.process("heat", "heat", { role: "body", solid: sid, start: P.start_temp_c })
	}
	register(new ItemType("meltable", "Meltable piece (butter, chocolate or wax)", CAT, build, {
		module: MODULE, material: "butter", materials: ["butter", "chocolate", "wax"],
		props: [new Prop("width", "Width", 0.02, 0.005, 0.1, 0.001, "m"), new Prop("height", "Height", 0.01, 0.002, 0.05, 0.001, "m"),
			new Prop("depth", "Front to back", 0.02, 0.005, 0.1, 0.001, "m"),
			new Prop("start_temp_c", "Start temperature", 20.0, -20.0, 60.0, 1.0, "°C", "Butter from the fridge is 4 °C")],
		readouts: [new Readout("temp", "Temperature", { unit: "°C", digits: 1 }), new Readout("melted", "Melted", { unit: "", digits: 2 })],
		tags: ["butter", "chocolate", "wax", "crayon", "melt", "dab", "pat", "conduction race", "sun"],
		description: "A small piece of butter (melts at 32-35 °C), chocolate (34 °C) or candle wax (58 °C). Warm it past that and it melts (it shrinks to a " +
			"puddle): put dabs along a spoon or a rod to see how far the heat has crept, or chocolate in a lamp's beam or the sun.",
		source: "Butter melts between 32 and 35 °C (its milk fat), about 70 kJ/kg; milk chocolate about 34 °C, 45 kJ/kg; paraffin wax 58 °C, 200 kJ/kg " +
			"(provisional; heat-data.ts).",
		anchor: "its centre", facts: "a 2 × 1 × 2 cm pat of butter",
		edit: [{ kind: "size", w: "width", h: "height" }, { kind: "rotate" }]
	}))
}

function _puddle() {
	function build(c, P) {
		const v = P.water_ml / 1e6
		const d = Math.sqrt((4.0 * v) / (Math.PI * 0.0015))
		const sid = c.slab("water", d, 0.0015, _r5(d), 0.0, 0.00075, { material: c.mat({ base: "puddle water", density: pyRound((v * 998.0) / (_r5(d) * 0.0015 * _r5(d)), 4) }),
			look: "water", words: "a puddle of water" })
		c.process("heat", "heat", { role: "body", solid: sid, start: P.water_temp_c, pool: true })
	}
	register(new ItemType("puddle", "Puddle of water", CAT, build, {
		module: MODULE, material: "puddle water", materials: ["puddle water"],
		props: [new Prop("water_ml", "Water", 50.0, 5.0, 1000.0, 5.0, "mL"), new Prop("water_temp_c", "Water temperature", 20.0, 0.0, 60.0, 1.0, "°C")],
		readouts: [new Readout("liquid_g", "Water left", { unit: "g", digits: 1 }), new Readout("temp", "Temperature", { unit: "°C", digits: 1 })],
		tags: ["puddle", "spill", "water", "evaporate", "evaporation", "dry", "wet", "rain"],
		description: "A puddle of water about 1.5 mm deep. It slowly evaporates (faster when warm, in the sun or a lamp's beam, or in a fan's wind) " +
			"and thins, its edge staying put, until it is a film that draws in and dries; in a freezing room it freezes. At 22 °C it dries in about 12 h " +
			"whatever its size (sooner under a lamp): use a time-lapse.",
		source: "A puddle spreads to about 1.5 mm; 50 mL is 21 cm across. In still air at 22 °C, 50 % humidity, water evaporates about 1.4 g an " +
			"hour from 80 cm² (Carrier's equation [ASHRAE]).",
		anchor: "the middle of its base", facts: "50 mL puddle, 21 cm across",
		edit: []
	}))
}

// ---------------------------------------------------------------- rubbing: a hand sanding block
const SANDER = [0.08, 0.025, 0.05]

function _sander() {
	function build(c, P) {
		const [w, h, d] = SANDER
		const block = c.slab("block", w, h, d, 0.0, 0.001 + h / 2, { material: c.mat({ base: _have("pine", "varnished hardwood"), density: pyRound(0.05 / (w * h * d), 4), overrides: {} }),
			look: "wood", words: "a wooden sanding block" })
		_child(c, "paper", block, { kind: "slab", width: w, height: 0.001, depth: d }, [0.0, -h / 2 - 0.0005],
			c.mat({ base: _have("sandpaper", "varnished hardwood"), overrides: {} }), _look("sandpaper", "wood"), "the sandpaper under the block")
		const t0 = P.rub_at
		c.process("heat", "rub", { role: "drive", solid: block, speed: pyRound(P.speed, 4), stroke: pyRound(P.stroke, 4), press: pyRound(P.press_n, 4),
			from: t0, until: pyRound(t0 + P.rub_s, 4) })
	}
	register(new ItemType("sanding-block", "Sanding block", CAT, build, {
		module: MODULE, material: _have("pine", "varnished hardwood"), materials: [_have("pine", "varnished hardwood")],
		props: [new Prop("press_n", "Pressed with", 5.0, 0.5, 30.0, 0.5, "N", "How hard the hand presses it down (its own weight is 0.5 N more)"),
			new Prop("speed", "Rubbing speed", 0.5, 0.05, 1.5, 0.05, "m/s", "How fast it is pushed back and forth"),
			new Prop("stroke", "Stroke", 0.1, 0.02, 0.3, 0.01, "m", "How far each push goes before it comes back"),
			new Prop("rub_s", "Rubs for", 10.0, 0.5, 30.0, 0.5, "s"),
			new Prop("rub_at", "Starts at", 0.5, 0.0, 20.0, 0.1, "s", "When the rubbing starts (run seconds)")],
		readouts: [new Readout("temp", "Temperature", { unit: "°C", digits: 2, help: "The block's (a lumped mean: its rubbed face gets warmer than this)" }),
			new Readout("work_j", "Friction's work", { unit: "J", digits: 1, help: "Heat it has taken in from rubbing (half the friction's work: the rest warms what it rubs)" })],
		tags: ["sanding block", "sandpaper", "rubbing", "friction", "rub", "sand", "friction makes heat", "warms by rubbing", "hands rubbing"],
		description: "A small pine block with sandpaper under it that a hand rubs back and forth along what it stands on (a board, the table), " +
			"pressing down. Friction's work turns to heat in the block and the surface (half each): honest, small sizes, +0.1 °C for 10 s " +
			"at 5 N and 0.5 m/s (its rubbed face gets much warmer than its mean). A thermometer touching it reads it.",
		source: "Friction's work μ·N·v·t from the engine's own contact impulses: sandpaper on wood μ about 0.6; 5 N, 0.5 m/s for 10 s give about 16 J, " +
			"8 J into a 56 g block (pine 1380 J/(kg·K) [INC Table A.3]): about +0.1 °C.",
		anchor: "the middle of its base (the sandpaper's underside)", facts: "pine 8 × 2.5 × 5 cm, 50 g, pressed with 5 N",
		edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- a jar over a candle
const JAR_T = 0.003

/** A jar's inside: diameter and height (m) for its volume, standing 1.3 times as tall as it is wide (a 1 L jar: 9.9 × 12.9 cm). */
export function jar_size(volume_ml) {
	const k = (4.0 * (volume_ml / 1e6)) / (1.3 * Math.PI)
	let D = 0.1
	// (the cube root by Newton's method, 60 fixed steps: the same bits as the Python on any machine)
	for (let i = 0; i < 60; i++) D = (2.0 * D + k / (D * D)) / 3.0
	return [D, 1.3 * D]
}

function _jar() {
	function build(c, P) {
		const [D, H] = jar_size(P.volume_ml)
		const t = JAR_T
		// its weight: a real round jar's glass (π·D·H + π·D²/4)·t at 2500 kg/m³; the side view's slabs are as deep as the jar
		const mass = 2500.0 * t * (Math.PI * D * H + (Math.PI * D * D) / 4)
		const vol = (D + 2 * t) * t * (D + 2 * t) + 2 * t * H * (D + 2 * t)
		const m = c.mat({ base: "glass", density: pyRound(mass / vol, 4), overrides: {} })
		const top = c.slab("top", D + 2 * t, t, _r5(D + 2 * t), 0.0, H + t / 2, { material: m, look: "jar glass", words: "an upside-down glass jar" })
		for (const [side, nm] of [[-1, "wall-left"], [1, "wall-right"]])
			_child(c, nm, top, { kind: "slab", width: t, height: _r5(H), depth: _r5(D + 2 * t) }, [side * (D / 2 + t / 2), -H / 2 - t / 2], m, "jar glass",
				"the glass wall of the jar")
		c.process("heat", "air", { role: "jar", solid: top, x0: _r6(-D / 2), x1: _r6(D / 2), y0: _r6(-t / 2 - H), y1: _r6(-t / 2), volume: pyRound(((Math.PI * D * D) / 4) * H, 9) })
	}
	register(new ItemType("candle-jar", "Jar over a candle", CAT, build, {
		module: MODULE, material: "glass", materials: ["glass"],
		props: [new Prop("volume_ml", "Holds", 1000.0, 250.0, 4000.0, 50.0, "mL", "A bigger jar holds more air: a candle under it burns longer")],
		readouts: [new Readout("o2_pct", "Oxygen inside", { unit: "%", digits: 1, help: "Air is 20.9 % oxygen; a candle flame goes out near 16 %" })],
		tags: ["jar", "glass jar", "candle under a jar", "oxygen", "air", "combustion", "snuffer", "bell jar", "candle goes out"],
		description: "A glass jar stood mouth-down on the table (its anchor is the middle of its mouth): put it over a short lit candle " +
			"(candle height 0.08 m or so, centred under it) and the flame uses up the oxygen in the trapped air and goes out at about " +
			"16 %: a 1 L jar in about 10-15 s, a 2 L jar twice as long; the same candle in the open keeps burning.",
		source: "Paraffin takes 3.45 g of oxygen a gram and a candle burns 0.1 g a minute [NIST-CANDLE]: 4.3 mL of oxygen a second from air at " +
			"20.95 % (NOAA); candle flames go out near 16 % (provisional). A 1 L jar 10 cm across, 13 cm tall, 3 mm glass, about 0.4 kg.",
		anchor: "the middle of its mouth (its rim on the table)", facts: "1 L glass jar, mouth down",
		edit: []
	}))
}

// ---------------------------------------------------------------- solids expand: the ball and ring, the bimetal strip
const ALPHA = { brass: 1.9e-5, steel: 1.2e-5 }
const YOUNG = { brass: 1.0e11, steel: 2.0e11 }
const RING_OUT = 0.045
const RING_T = 0.006
const STRIP_T = 0.0006

function _ball_ring() {
	function build(c, P) {
		const hole = P.hole_mm / 1000.0
		const ball = P.ball_mm / 1000.0
		const H = P.ring_height
		const steel = c.mat({ base: "steel", overrides: {} })
		c.slab("base", 0.14, 0.012, 0.1, 0.0, 0.006, { material: steel, look: "steel", words: "the stand's base", kind: "static" })
		c.slab("post", 0.01, H, 0.01, -0.06, 0.012 + H / 2, { material: steel, look: "steel", words: "the stand's post", kind: "static" })
		const jaw = (RING_OUT - hole) / 2
		c.slab("arm", 0.06 - RING_OUT / 2 - 0.005, 0.006, 0.008, -0.06 + (0.06 - RING_OUT / 2 + 0.005) / 2, 0.012 + H, { material: steel, look: "steel",
			words: "the stand's arm", kind: "static" })
		for (const [side, nm] of [[-1, "ring-left"], [1, "ring-right"]])
			c.slab(nm, _r5(jaw), RING_T, RING_OUT, side * (hole / 2 + jaw / 2), 0.012 + H, { material: steel, look: "steel", words: "a steel ring", kind: "static" })
		const y0 = 0.012 + H + RING_T / 2 + P.drop + ball / 2
		c.ball("ball", ball / 2, 0.0, y0, { material: c.mat({ base: _have("brass", "steel"), overrides: {} }), look: _look("brass", "steel"), words: "a brass ball" })
		c.process("heat", "ball-heat", { role: "body", solid: c.sid("ball"), start: P.ball_temp_c, expand: ALPHA.brass, size: _r6(ball), ref: 20.0 })
		c.process("heat", "ring-heat", { role: "body", solid: c.sid("ring-left"), with: [c.sid("ring-right")], start: P.ring_temp_c,
			expand: ALPHA.steel, size: _r6(hole), ref: 20.0 })
		c.process("heat", "fit", { role: "ring", ball: c.sid("ball"), jaws: [c.sid("ring-left"), c.sid("ring-right")] })
	}
	register(new ItemType("ball-and-ring", "Ball and ring", CAT, build, {
		module: MODULE, material: _have("brass", "steel"), materials: [_have("brass", "steel")],
		props: [new Prop("ball_temp_c", "Ball's temperature", 20.0, -20.0, 600.0, 5.0, "°C", "Heated in a flame it is 300-500 °C"),
			new Prop("ring_temp_c", "Ring's temperature", 20.0, -20.0, 600.0, 5.0, "°C"),
			new Prop("ball_mm", "Ball", 25.4, 10.0, 50.0, 0.01, "mm", "Its diameter at 20 °C"),
			new Prop("hole_mm", "Ring's hole", 25.45, 10.0, 50.0, 0.01, "mm", "The hole's diameter at 20 °C: the ball just passes when both are cold"),
			new Prop("drop", "Dropped from", 0.04, 0.0, 0.2, 0.005, "m", "How far above the ring the hand lets it go"),
			new Prop("ring_height", "Ring height", 0.2, 0.08, 0.4, 0.01, "m")],
		readouts: [new Readout("ball_mm", "Ball", { unit: "mm", digits: 3, help: "Its diameter now (it grows 0.48 µm a °C)" }), new Readout("hole_mm", "Hole", { unit: "mm", digits: 3 }),
			new Readout("fits", "Fits", { unit: "", digits: 0, help: "1 while the ball is smaller than the hole" }), new Readout("through", "Went through", { unit: "", digits: 0 }),
			new Readout("temp", "Ball's temperature", { unit: "°C", digits: 0 })],
		tags: ["ball and ring", "expansion", "thermal expansion", "expand", "metal expands", "heat makes things bigger", "gravesande", "particles move apart"],
		description: "The classic ball-and-ring: a brass ball dropped onto a steel ring it just passes when cold. Heated (ball_temp_c 300) it is " +
			"0.13 mm bigger and sits on the ring until it cools (or heat the ring too: it passes again). The fit is decided by their true " +
			"sizes, 1 + α·ΔT each (brass 19e-6/K, steel 12e-6/K).",
		source: "Linear expansion brass 19e-6/K, steel 12e-6/K [CRC]: a 25.4 mm ball at 300 °C is 25.535 mm, past a 25.45 mm hole (a 0.05 mm " +
			"clearance: provisional; real sets vary).",
		anchor: "the middle of the stand's base", facts: "25.4 mm brass ball, 25.45 mm steel ring", edit: []
	}))
}

function _bimetal() {
	function build(c, P) {
		const L = P.length
		const H = P.height
		const [top, bottom] = P.layers === "brass on steel" ? ["brass", "steel"] : ["steel", "brass"]
		const steel = c.mat({ base: "steel", overrides: {} })
		c.slab("base", 0.1, 0.012, 0.08, 0.0, 0.006, { material: steel, look: "steel", words: "the stand's base", kind: "static" })
		c.slab("post", 0.012, H, 0.012, -0.03, 0.012 + H / 2, { material: steel, look: "steel", words: "the stand's post", kind: "static" })
		c.slab("clamp", 0.03, 0.02, 0.02, -0.015, 0.012 + H, { material: steel, look: "steel", words: "the clamp", kind: "static" })
		const y = 0.012 + H
		c.slab("strip-top", L, STRIP_T, 0.01, L / 2, y + STRIP_T / 2, { material: c.mat({ base: _have(top, "steel"), overrides: {} }), look: _look(top, "steel"),
			words: `a bimetal strip's ${top}`, kind: "static" })
		c.slab("strip-bottom", L, STRIP_T, 0.01, L / 2, y - STRIP_T / 2, { material: c.mat({ base: _have(bottom, "steel"), overrides: {} }), look: _look(bottom, "steel"),
			words: `a bimetal strip's ${bottom}`, kind: "static" })
		c.process("heat", "heat", { role: "body", solid: c.sid("strip-top"), with: [c.sid("strip-bottom")], start: P.start_temp_c,
			bend: { a1: ALPHA[bottom], a2: ALPHA[top], e1: YOUNG[bottom], e2: YOUNG[top], t1: STRIP_T, t2: STRIP_T, length: _r5(L), ref: 20.0 } })
	}
	register(new ItemType("bimetal-strip", "Bimetal strip", CAT, build, {
		dynamic: false, module: MODULE, material: _have("brass", "steel"), materials: [_have("brass", "steel")],
		props: [new Prop("layers", "Layers", "brass on steel", { kind: "choice", choices: ["brass on steel", "steel on brass"],
			help: "Brass expands more than steel: heated, the strip curls toward the steel side (down with brass on top)" }),
		new Prop("length", "Length", 0.1, 0.04, 0.2, 0.005, "m"), new Prop("height", "Height", 0.12, 0.05, 0.3, 0.005, "m", "Its clamp's height"),
		new Prop("start_temp_c", "Start temperature", 20.0, -20.0, 400.0, 5.0, "°C", "It is straight at 20 °C")],
		readouts: [new Readout("bend_mm", "Tip moves", { unit: "mm", digits: 1, help: "Down with brass on top (toward the steel), as it heats" }),
			new Readout("bend_deg", "Bent by", { unit: "°", digits: 1 }), new Readout("temp", "Temperature", { unit: "°C", digits: 0 })],
		tags: ["bimetal", "bimetallic strip", "thermostat", "expansion", "metal expands", "bends when heated", "fire alarm"],
		description: "A strip of brass bonded to steel, clamped at its left end. Heat it (a candle flame under it, a hot plate, a lamp, or start " +
			"it hot) and it curls toward the steel, because brass expands more: about 4 mm at the tip of a 10 cm strip for 100 °C. " +
			"A thermostat's or fire alarm's switch.",
		source: "Timoshenko 1925: κ = 6 (α2 − α1) ΔT (1 + m)² / (h (3 (1 + m)² + (1 + mn)(m² + 1/(mn)))); brass 19e-6/K, 100 GPa; steel 12e-6/K, " +
			"200 GPa [CRC]; two 0.6 mm layers, 1 cm wide.", anchor: "the middle of the stand's base", facts: "10 cm brass-steel strip", edit: []
	}))
}

// ---------------------------------------------------------------- goal kinds (machines/mod_heat.py has the same, number for number)
function _lapse(ctx) {
	const s = ctx.doc.settings ?? {}
	const v = s.timeLapse
	return typeof v === "number" && Number.isFinite(v) ? v : 1.0
}

/** Lesson time for a label: 45 s, 12 min, 1 h 30 min. */
export function _clock_text(s) {
	if (s < 60) return `${pyRoundInt(s)} s`
	const m = pyRoundInt(s / 60.0)
	if (m < 60) return `${m} min`
	return m % 60 === 0 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** A goal's lesson time, s: its minutes field (by_min, at_min: what the AI writes) × 60, else its seconds field (before_s, at_s), else null. */
function _lesson_s(ctx, g, sKey, minKey) {
	const m = ctx.num(g[minKey])
	if (m !== null) return m * 60.0
	return ctx.num(g[sKey])
}
const _when_label = (by) => (by === null ? "" : ` within ${_clock_text(by)}`)
const _label = (g, fallback) => (truthy(g.label) ? g.label : fallback)

/** The run's time (s) its ice first counts as melted (99.5 %), or null. */
const _melt_time = (ctx, iid) => ctx.first_time(iid, "melted", (v) => v >= 0.995)

function _end(ctx, iid, key) {
	const v = ctx.state(iid, key)
	return v && v.length ? v[v.length - 1] : null
}

export function goal_melts(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "melted") === null) return null
	const by = _lesson_s(ctx, g, "before_s", "by_min")
	const lapse = _lapse(ctx)
	const t = _melt_time(ctx, iid)
	const lesson = t === null ? null : pyRound(t * lapse, 1)
	const ok = lesson !== null && (by === null || lesson <= by)
	return { label: _label(g, `${ctx.name(iid)} melts${_when_label(by)}`), ok, kind: "melts", item: iid, t: lesson, melted: pyRound(_end(ctx, iid, "melted"), 3) }
}

export function goal_melts_first(ctx, g) {
	const a = g.a
	const b = g.b
	if (!ctx.known(a) || !ctx.known(b) || ctx.state(a, "melted") === null || ctx.state(b, "melted") === null) return null
	const ta = _melt_time(ctx, a)
	const tb = _melt_time(ctx, b)
	const fa = _end(ctx, a, "melted")
	const fb = _end(ctx, b, "melted")
	let ok
	if (ta !== null) ok = tb === null || ta < tb
	else if (tb !== null) ok = false
	else ok = fa >= fb + 0.02
	const lapse = _lapse(ctx)
	return {
		label: _label(g, `${ctx.name(a)} melts before ${ctx.name(b)}`), ok, kind: "melts_first", a, b,
		t_a: ta === null ? null : pyRound(ta * lapse, 1), t_b: tb === null ? null : pyRound(tb * lapse, 1), melted_a: pyRound(fa, 3), melted_b: pyRound(fb, 3)
	}
}

function _frame_at(ctx, n, at) {
	let k = n - 1
	if (at !== null) {
		const lapse = _lapse(ctx)
		k = 0
		ctx.times.forEach((t, i) => {
			if (t * lapse <= at + 1e-9) k = i
		})
	}
	return k
}

export function goal_melt_fraction(ctx, g) {
	const iid = g.item
	const v = ctx.known(iid) ? ctx.state(iid, "melted") : null
	if (v === null) return null
	const lo = ctx.num(g.at_least)
	const hi = ctx.num(g.at_most)
	const at = _lesson_s(ctx, g, "at_s", "at_min")
	if (lo === null && hi === null) return null
	const f = v[_frame_at(ctx, v.length, at)]
	const ok = (lo === null || f >= lo) && (hi === null || f <= hi)
	const bound = [...(lo !== null ? [`at least ${pyRoundInt(lo * 100)} %`] : []), ...(hi !== null ? [`at most ${pyRoundInt(hi * 100)} %`] : [])].join(" and ")
	const when = at === null ? "" : ` after ${_clock_text(at)}`
	return { label: _label(g, `${ctx.name(iid)} is ${bound} melted${when}`), ok, kind: "melt_fraction", item: iid, melted: pyRound(f, 3) }
}

const TEMP_KEYS = ["reading", "water_temp", "liquid_temp", "sand:temp", "temp"]

function _temp_key(ctx, iid) {
	for (const k of TEMP_KEYS) if (ctx.state(iid, k) !== null) return k
	return null
}

export function goal_reaches(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const key = _temp_key(ctx, iid)
	const lo = ctx.num(g.at_least_c)
	const hi = ctx.num(g.at_most_c)
	if (key === null || (lo === null && hi === null)) return null
	const by = _lesson_s(ctx, g, "before_s", "by_min")
	const test = lo !== null ? (v) => v >= lo : (v) => v <= hi
	const t = ctx.first_time(iid, key, test)
	const lapse = _lapse(ctx)
	const lesson = t === null ? null : pyRound(t * lapse, 1)
	// (a thermometer put in water whose bulb has left it when it gets there reads something else, a hot plate or the air: not met, and said)
	let left = false
	const wet = key === "reading" ? ctx.state(iid, "in_water") : null
	if (t !== null && wet && wet.length && wet[0] !== null && wet[0] !== undefined && wet[0] >= 1) {
		const v = ctx.state(iid, key)
		const k = v.findIndex((x) => x !== null && x !== undefined && test(x))
		left = k < wet.length && wet[k] !== null && wet[k] !== undefined && wet[k] < 1
	}
	const ok = lesson !== null && (by === null || lesson <= by) && !left
	const what = lo !== null ? `at least ${fmtG(lo, 6)} °C` : `${fmtG(hi, 6)} °C or less`
	const verb = lo !== null ? "reaches" : "cools to"
	const out = { label: _label(g, `${ctx.name(iid)} ${verb} ${what}${_when_label(by)}`), ok, kind: "reaches", item: iid, t: lesson, end_c: pyRound(_end(ctx, iid, key), 2) }
	if (left) out.left_water = true
	return out
}

export function goal_warmer(ctx, g) {
	const a = g.a
	const b = g.b
	if (!ctx.known(a) || !ctx.known(b)) return null
	const ka = _temp_key(ctx, a)
	const kb = _temp_key(ctx, b)
	if (ka === null || kb === null) return null
	const va = ctx.state(a, ka)
	const vb = ctx.state(b, kb)
	const at = _lesson_s(ctx, g, "at_s", "at_min")
	const k = _frame_at(ctx, va.length, at)
	const ok = va[k] >= vb[k] + 0.5
	const when = at === null ? "" : ` after ${_clock_text(at)}`
	return { label: _label(g, `${ctx.name(a)} is warmer than ${ctx.name(b)}${when}`), ok, kind: "warmer", a, b, a_c: pyRound(va[k], 2), b_c: pyRound(vb[k], 2) }
}

export function goal_boils(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "boiling") === null) return null
	const by = _lesson_s(ctx, g, "before_s", "by_min")
	const t = ctx.first_time(iid, "boiling", (v) => v >= 1)
	const lesson = t === null ? null : pyRound(t * _lapse(ctx), 1)
	return { label: _label(g, `the water in ${ctx.name(iid)} boils${_when_label(by)}`), ok: lesson !== null && (by === null || lesson <= by), kind: "boils", item: iid, t: lesson }
}

export function goal_freezes(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const ice = ctx.state(iid, "ice_g")
	const water = ctx.state(iid, "water_g") !== null ? ctx.state(iid, "water_g") : ctx.state(iid, "liquid_g")
	if (ice === null || water === null) return null
	let t = null
	const n = Math.min(ctx.times.length, ice.length, water.length)
	for (let k = 0; k < n; k++) {
		if (ice[k] > 0 && water[k] <= 0) {
			t = ctx.times[k]
			break
		}
	}
	const by = _lesson_s(ctx, g, "before_s", "by_min")
	const lesson = t === null ? null : pyRound(t * _lapse(ctx), 1)
	return { label: _label(g, `${ctx.name(iid)} freezes${_when_label(by)}`), ok: lesson !== null && (by === null || lesson <= by), kind: "freezes", item: iid, t: lesson }
}

export function goal_dries(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	let key
	if (ctx.items.get(iid).type === "puddle") key = "liquid_g"
	else if (ctx.state(iid, "water_g") !== null) key = "water_g"
	else key = "puddle_g"
	const v = ctx.state(iid, key)
	if (v === null) return null
	const by = _lesson_s(ctx, g, "before_s", "by_min")
	let seen = false
	let t = null
	const n = Math.min(ctx.times.length, v.length)
	for (let k = 0; k < n; k++) {
		if (v[k] > 0.05) seen = true
		else if (seen) {
			t = ctx.times[k]
			break
		}
	}
	const lesson = t === null ? null : pyRound(t * _lapse(ctx), 1)
	return { label: _label(g, `${ctx.name(iid)} dries up${_when_label(by)}`), ok: lesson !== null && (by === null || lesson <= by), kind: "dries", item: iid, t: lesson, left_g: pyRound(v[v.length - 1], 2) }
}

export function goal_dew(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const v = ctx.state(iid, "wet_g")
	let most = 0.0
	if (v && v.length) most = Math.max(...v)
	return { label: _label(g, `water condenses on ${ctx.name(iid)}`), ok: most >= 0.05, kind: "dew", item: iid, most_g: pyRound(most, 3) }
}

/** The run's time (s) a reading first passes a test (after time `after`, if given), or null. */
function _first_after(ctx, iid, key, test, after = null) {
	const v = ctx.state(iid, key)
	if (!v || !v.length) return null
	const n = Math.min(v.length, ctx.times.length)
	for (let i = 0; i < n; i++) if ((after === null || ctx.times[i] > after) && test(v[i])) return ctx.times[i]
	return null
}

export function goal_burns_out(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "flame") === null) return null
	const lit = ctx.first_time(iid, "flame", (v) => v >= 1)
	const out = lit === null ? null : _first_after(ctx, iid, "flame", (v) => v < 1, lit)
	const by = _lesson_s(ctx, g, "before_s", "by_min")
	const lesson = out === null ? null : pyRound(out * _lapse(ctx), 1)
	return { label: _label(g, `${ctx.name(iid)} goes out${_when_label(by)}`), ok: lesson !== null && (by === null || lesson <= by),
		kind: "burns_out", item: iid, t: lesson, burned_g: pyRound(_end(ctx, iid, "burned_g") ?? 0.0, 3) }
}

export function goal_scorches(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const t = ctx.first_time(iid, "scorched", (v) => v >= 1)
	const v = ctx.state(iid, "spot_temp")
	const most = v && v.length ? Math.max(...v) : null
	const by = _lesson_s(ctx, g, "before_s", "by_min")
	const lesson = t === null ? null : pyRound(t * _lapse(ctx), 1)
	return { label: _label(g, `${ctx.name(iid)} scorches${_when_label(by)}`), ok: lesson !== null && (by === null || lesson <= by),
		kind: "scorches", item: iid, t: lesson, hottest_c: most === null ? null : pyRound(most, 1) }
}

export function goal_passes_through(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "through") === null) return null
	const want = typeof g.passes === "boolean" ? g.passes : true
	const went = (_end(ctx, iid, "through") ?? 0.0) >= 1
	const nm = ctx.name(iid)
	return { label: _label(g, want ? `the ball of ${nm} passes through the ring` : `the ball of ${nm} stays stuck on the ring`),
		ok: went === want, kind: "passes_through", item: iid, through: went,
		ball_mm: pyRound(_end(ctx, iid, "ball_mm") ?? 0.0, 3), hole_mm: pyRound(_end(ctx, iid, "hole_mm") ?? 0.0, 3) }
}

export function goal_bends(ctx, g) {
	const iid = g.item
	const v = ctx.known(iid) ? ctx.state(iid, "bend_mm") : null
	if (!v || !v.length) return null
	let lo = ctx.num(g.at_least_mm)
	if (lo === null) lo = 1.0
	const most = Math.max(...v.map((x) => Math.abs(x)))
	return { label: _label(g, `${ctx.name(iid)} bends at least ${fmtG(lo, 6)} mm`), ok: most >= lo, kind: "bends", item: iid, most_mm: pyRound(most, 2) }
}

// (a temperature rise, "warms_by", is the matter module's goal kind: it reads heat's temp, reading and water_temp)

// ---------------------------------------------------------------- the AI's view (web/sim/modules/heat-ai.js; given what it needs, so no import cycle)
export const plugin = heatPlugin({
	goals: { melts: goal_melts, melts_first: goal_melts_first, melt_fraction: goal_melt_fraction, reaches: goal_reaches, warmer: goal_warmer, boils: goal_boils, freezes: goal_freezes, dries: goal_dries, dew: goal_dew,
		burns_out: goal_burns_out, scorches: goal_scorches, passes_through: goal_passes_through, bends: goal_bends },
	BULBS, CUPS, lamp_geometry, cone_radius, jar_size, clock: _clock_text
})
