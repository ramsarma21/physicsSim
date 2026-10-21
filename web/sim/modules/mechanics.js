// The mechanics module's port (machines/mod_mechanics.py, line for line: the same documents, number for number) and its plug-ins for the AI
// (goal kinds, digest, knobs, prompts, placement rules, change words). A module file takes everything from the framework object register_all
// gets (web/sim/items.js FRAMEWORK), so it imports nothing. See the Python file for the items, the rules and the sources.
let F = null
let py = null
let register, ItemType, Prop, Link, Readout, register_goal_kind, register_build_hook, register_common_prop, MATERIALS, props_of, TYPES, add_look, CATEGORIES, D2R, define_material, measured, LOOK_FILL, LOOK_SHADE

const PAINTS = { red: "#d62828", blue: "#1f5fbf", green: "#2e9e44", yellow: "#f2c230", orange: "#f07f1a", purple: "#7b3fb0", pink: "#ec6fa5", white: "#f4f4f0", black: "#222222", gray: "#8a8f96", brown: "#7a4a26" }
const COLOR_CHOICES = ["none", ...Object.keys(PAINTS)]
const UNPAINTED = ["front", "rear", "wheel", "tyre", "tire", "hub", "axle", "spring", "hanger", "cord", "rope", "pin", "lip"]
const START_MAX = 30.0
// force arrows: the kinds the engine records (tooling/src/sim/mechanics.ts FORCE_KINDS, in its order; net is the sum of the others)
export const FORCE_KINDS = ["gravity", "support", "push", "friction", "tension", "spring", "air", "buoyancy", "magnetic", "applied", "net"]
// (an open choice: any of these, or kinds joined by "+" (the AI's checks take any join of their words: ai/schemas.mjs, web/ai/solver.js))
const ARROW_CHOICES = ["none", "all", "net", "all+net", ...FORCE_KINDS.slice(0, -1), "gravity+support", "gravity+support+friction", "tension+net", "gravity+air+net", "gravity+buoyancy"]
const ENERGY_GOALS = ["energy_kept", "energy_to_heat"]

const BLOCK = [0.1, 0.05, 0.05]
const PLANK_T = 0.018
const OVERHANG = 0.03
const LIP = [0.006, 0.015]
const CLAY_DENSITY = 1570
const CLAY_SHAPE = [[-0.5, -0.5], [0.5, -0.5], [0.4330127, 0.0], [0.17101007, 0.43969262], [-0.17101007, 0.43969262], [-0.4330127, 0.0]]

function _bind(f) {
	F = f
	py = f.py
	;({ register, ItemType, Prop, Link, Readout, register_goal_kind, register_build_hook, register_common_prop, MATERIALS, props_of, TYPES, add_look, CATEGORIES, D2R, define_material, measured, LOOK_FILL, LOOK_SHADE } = f)
}

export function register_all(f) {
	_bind(f)
	for (const cat of ["Machines & motion"]) if (!CATEGORIES.includes(cat)) CATEGORIES.push(cat)
	_materials()
	_catalog_wide()
	_floor()
	_ramp()
	_clay()
	_cart()
	_puller()
	_pusher()
	_edge_pulley()
	_falling()
	_coaster()
	_gears()
	_wheel_axle()
	_tackle()
	_lever()
	_balloon()
	_screw_jack()
	_energy_board()
	// (an egg's breaks / survives are the fracture module's goals, clay and velcro's sticks the magnetism module's: no other module's goal is replaced)
	for (const [kind, fn] of [["balanced", goal_balanced], ["loops", goal_loops], ["gear_speed", goal_gear_speed], ["rises", goal_rises], ["recoils", goal_recoils],
		["accelerates", goal_accelerates], ["pulls_with", goal_pulls_with], ["net_force", goal_net_force], ["energy_kept", goal_energy_kept], ["energy_to_heat", goal_energy_to_heat]])
		register_goal_kind(kind, fn)
}

/** Only what this module adds to every type: the catalog-wide props and the build hooks that read them, for a parity harness that gives the core
 *  port what the whole server has (tools/parity/core.mjs --mode server and everyday: machines/mod_mechanics.py register_catalog_wide). */
export function register_catalog_wide(f) {
	_bind(f)
	_catalog_wide()
}

/** The catalog-wide props (COMMON_PROPS) and the build hooks that read them: paint, glow and starts (_common), the cords of pullers and edge
 *  pulleys (_links), an egg's shell (_fragile). */
function _catalog_wide() {
	const dynamic = (t) => !!t.dynamic
	register_common_prop(new Prop("color", "Colour", "none", { kind: "choice", choices: COLOR_CHOICES, open: true, help: "Paints it (only the look): a car's or truck's body, not its tyres" }))
	register_common_prop(new Prop("glow", "Glow", false, { kind: "bool", help: "A soft glow round it, to point it out (only the look)" }))
	register_common_prop(
		new Prop("start_speed", "Start speed", 0.0, 0.0, START_MAX, 0.01, "m/s", "Already moving this fast when the scene lets go (a kick, a launch, a car already rolling)"),
		dynamic
	)
	register_common_prop(
		new Prop("start_dir", "Start direction", 0.0, -180.0, 180.0, 1.0, "°", "Degrees from the way it faces (its +x turned by its angle), counter-clockwise: 0 forward, 180 back, 90 up"),
		dynamic
	)
	register_common_prop(
		new Prop("start_spin", "Start spin", "roll", { kind: "choice", choices: ["roll", "none"], help: "roll: a ball, a wheel or a car's wheels start turning as if rolling along the floor" }),
		dynamic
	)
	register_common_prop(
		new Prop("arrows", "Force arrows", "none", {
			kind: "choice", choices: ARROW_CHOICES, open: true,
			help: "Arrows for the forces on it as it moves (only the look; the run records them): all, net, all+net, or kinds joined by + (gravity+support+friction): gravity, support, push, friction, tension, spring, air, buoyancy, magnetic, applied"
		}),
		dynamic
	)
	register_common_prop(
		new Prop("arrow_scale", "Arrow length", 0.0, 0.0, 1.0, 0.005, "m/N", "Metres of arrow per newton; 0: chosen so the scene's biggest force is a clear arrow (about its thing's size, 15-50 cm)"),
		dynamic
	)
	register_common_prop(
		new Prop("show_energy", "Energy bars", false, { kind: "bool", help: "Bars over it of its kinetic, potential and spring energy, and what has turned to heat and sound, as it moves" }),
		dynamic
	)
	register_common_prop(
		new Prop("fragile", "Breaks", false, { kind: "bool", help: "It cracks if it lands hard: a peak force over about 35 N (an egg cracks dropped about 7 cm or more onto a table, not 80 cm onto foam)" }),
		(t) => t.key === "egg"
	)
	register_build_hook(_common)
	register_build_hook(_links)
	register_build_hook(_fragile)
	register_build_hook(_shows)
}

/** The kinds an `arrows` prop asks for (FORCE_KINDS order): "all" every kind but net, "none" nothing, else the kinds named (joined by "," "+" or spaces). */
export function _arrow_kinds(v) {
	if (typeof v !== "string") return []
	const words = new Set(v.trim().toLowerCase().split(/[,+\s]+/))
	if (words.has("all")) for (const k of FORCE_KINDS.slice(0, -1)) words.add(k)
	return FORCE_KINDS.filter((k) => words.has(k))
}

/** Force arrows' and energy bars' records (machines/mod_mechanics.py _shows): `forces` for an item with arrows or one a net_force goal is about,
 *  `energy` for one with show_energy, one an energy-bars board shows, or one an energy goal is about. */
function _shows(sb, scene) {
	// (a scene's goals or items that are not a list, null or NaN in a hand-made scene, are none)
	const items = (Array.isArray(scene.items) ? scene.items : []).filter((i) => i !== null && typeof i === "object" && !Array.isArray(i) && typeof i.id === "string" && has(TYPES, i.type))
	const ids = new Set(items.map((i) => i.id))
	const goals = (Array.isArray(scene.goals) ? scene.goals : []).filter((g) => g !== null && typeof g === "object" && !Array.isArray(g))
	const netted = new Set(goals.filter((g) => g.kind === "net_force").map((g) => g.item))
	const energised = new Set(goals.filter((g) => ENERGY_GOALS.includes(g.kind)).map((g) => g.item))
	for (const b of items) {
		if (b.type !== "energy-bars") continue
		const w = props_of(b).watch
		if (typeof w === "string" && ids.has(w) && w !== b.id) energised.add(w)
	}
	for (const item of items) {
		const iid = item.id
		const props = item.props ?? {}
		const mine = sb.solids.filter((x) => x.item === iid && x.kind === "dynamic").map((x) => x.id).slice(0, 64)
		if (!mine.length) continue
		const show = _arrow_kinds(props.arrows)
		if (show.length || netted.has(iid))
			sb.processes.push({ kind: "mechanics", id: `${iid}#forces`, item: iid, role: "forces", solids: mine, show, scale: _r(Math.min(1.0, Math.max(0.0, _num(props.arrow_scale, 0.0))), 5) })
		if (props.show_energy === true || energised.has(iid)) sb.processes.push({ kind: "mechanics", id: `${iid}#energy`, item: iid, role: "energy", solids: mine, bars: props.show_energy === true })
	}
}

// ---------------------------------------------------------------- materials
function _mat(key, kw) {
	// (as mod_mechanics.py's kw.setdefault: the given fields in their order, then rolling and side where they are not given: the same record, key for key)
	const values = { ...kw }
	if (!("rolling" in values)) values.rolling = 0.0
	if (!("side" in values)) values.side = 0.0
	define_material(key, values, ["density"])
}

function _materials() {
	add_look("cart blue", { fill: "#2f6db5", shade: "#1f4c80", roughness: 0.35, metalness: 0.0, clearcoat: 0.5 })
	add_look("office paper", { fill: "#f6f4ee", shade: "#d8d4c8", roughness: 0.85, metalness: 0.0, clearcoat: 0.0 })
	add_look("feather", { fill: "#8a6a4a", shade: "#5e4630", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 })
	add_look("nylon canopy", { fill: "#e8543a", shade: "#b53a24", roughness: 0.6, metalness: 0.0, clearcoat: 0.1 })
	add_look("velcro", { fill: "#2a2a2a", shade: "#151515", roughness: 1.0, metalness: 0.0, clearcoat: 0.0 })
	add_look("felt", { fill: "#3d6e4e", shade: "#2b4f38", roughness: 0.95, metalness: 0.0, clearcoat: 0.0 })
	add_look("sandpaper", { fill: "#b98a55", shade: "#8c6438", roughness: 1.0, metalness: 0.0, clearcoat: 0.0 })
	add_look("grass", { fill: "#4f8a3a", shade: "#3a6a2a", roughness: 1.0, metalness: 0.0, clearcoat: 0.0 })
	add_look("modelling clay", { fill: "#c0573e", shade: "#8f3d2a", roughness: 0.7, metalness: 0.0, clearcoat: 0.0 })
	_mat("felt", {
		density: 300, bounce: 0.3, friction: 0.6, rolling: 0.03, look: "felt",
		source: "Wool felt about 300 kg/m³; wood on felt friction about 0.5-0.7 (felt pads); a tyre sinks into it: rolling resistance 0.03 provisional."
	})
	_mat("sandpaper", {
		density: 1500, bounce: 0.5, friction: 0.9, rolling: 0.02, look: "sandpaper",
		source: "Abrasive paper on a backing, about 1500 kg/m³; wood on 80-120 grit sandpaper friction 0.6-1.0 (spec mechanics.md, provisional); a tyre rolls on its grit with about 0.02 (provisional)."
	})
	_mat("grass", {
		density: 400, bounce: 0.4, friction: 0.35, rolling: 0.07, look: "grass",
		source: "Mown turf: a ball rolls with a resistance of 0.05-0.1 on it (spec mechanics.md; golf-green stimp tests give 0.05-0.08); friction 0.35 (spec mechanics.md); bulk density provisional."
	})
	_mat("cart plastic", {
		density: 1050, bounce: 0.6, friction: 0.35, rolling: 0.003, look: "cart blue",
		source: "ABS plastic about 1050 kg/m³; a lab cart's low-friction wheels roll with 0.002-0.005 ([PASCO] carts; provisional 0.003); bounce of a plain plastic end provisional."
	})
	_mat("spring bumper", { density: 7850, bounce: 0.9, friction: 0.4, rolling: 0.001, look: "steel", source: "A spring-steel leaf bumper: carts bounce off it with e about 0.9 (lab collision carts; provisional)." })
	_mat("magnet bumper", { density: 7500, bounce: 0.95, friction: 0.3, rolling: 0.001, look: "steel", source: "Repelling magnet bumpers: the carts never touch and part with e about 0.95 (lab magnetic collision carts; provisional)." })
	_mat("velcro", { density: 400, bounce: 0.0, friction: 1.0, rolling: 0.01, look: "velcro", source: "Hook-and-loop pads: they hold on contact (the module welds them: a perfectly inelastic collision)." })
	_mat("office paper", { density: 800, bounce: 0.3, friction: 0.4, rolling: 0.02, look: "office paper", source: "Office paper 80 g/m², about 0.1 mm thick: 800 kg/m³ (ISO 536 grammage; caliper about 0.1 mm); bounce provisional." })
	_mat("feather", { density: 50, bounce: 0.1, friction: 0.5, rolling: 0.05, look: "feather", source: "A feather's vane is mostly air: its mass over its outline's volume (provisional)." })
	_mat("nylon canopy", { density: 60, bounce: 0.1, friction: 0.5, rolling: 0.05, look: "nylon canopy", source: "A light plastic or ripstop canopy: its mass spread over its shape's volume (provisional)." })
	_mat("modelling clay", {
		density: CLAY_DENSITY, bounce: 0.054, friction: 0.9, rolling: 0.3, look: "modelling clay",
		source: "Van Aken plasticine 1570 kg/m³ (Eckerson et al. 2008); it barely bounces (as items.py's modeling clay) and grips."
	})
	measured("spring bumper", "spring bumper", { friction: 0.4, restitution: 0.9, rollingResistance: 0.001, source: "Two lab carts' spring bumpers: e about 0.9 (provisional)." })
	measured("magnet bumper", "magnet bumper", { friction: 0.3, restitution: 0.95, rollingResistance: 0.001, source: "Two lab carts' repelling magnets: e about 0.95 (provisional)." })
	for (const other of ["cart plastic", "spring bumper", "magnet bumper"])
		measured("velcro", other, { friction: 1.0, restitution: 0.0, rollingResistance: 0.01, source: "Velcro meets anything dead (and then holds)." })
	measured("velcro", "velcro", { friction: 1.0, restitution: 0.0, rollingResistance: 0.01, source: "Velcro on velcro: dead, and it holds." })
}

// ---------------------------------------------------------------- the catalog-wide props, applied after every item is built
function _paint(v) {
	if (typeof v !== "string") return null
	const k = py.pyLower(v.trim())
	if (Object.prototype.hasOwnProperty.call(PAINTS, k)) return PAINTS[k]
	if (k.length === 7 && k[0] === "#" && [...k.slice(1)].every((ch) => "0123456789abcdef".includes(ch))) return k
	return null
}

const _num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const has = (o, k) => o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k)

function _common(sb, scene) {
	for (const item of scene.items ?? []) {
		if (item === null || typeof item !== "object" || !has(TYPES, item.type)) continue
		const props = item.props ?? {}
		if (!["color", "glow", "start_speed"].some((k) => has(props, k))) continue
		const iid = item.id
		const mine = sb.solids.filter((s) => s.item === iid)
		if (has(props, "color")) {
			const hexv = _paint(props.color)
			const commonColor = !TYPES[item.type].props.some((p) => p.key === "color") // (its colour is this module's prop, not one of its own)
			for (const s of mine) {
				const part = s.id.includes("/") ? s.id.slice(s.id.indexOf("/") + 1) : s.id
				if (py.truthy(s.hidden_3d) || UNPAINTED.some((w) => part.startsWith(w))) continue
				if (s.color === props.color) {
					// (a ball's builder copies its colour prop as it is: any other text is kept, as before. The 3D ball reads only a #rrggbb, so
					// a named paint becomes the paint's hex and "none" leaves the ball its own colours, as on every other type: "blue" or "none"
					// drew it grey)
					if (commonColor && typeof props.color === "string") {
						const k = py.pyLower(props.color.trim())
						if (k === "none") delete s.color
						else if (has(PAINTS, k)) s.color = PAINTS[k]
					}
					continue
				}
				if (hexv !== null) s.color = hexv
			}
		}
		if (props.glow === true) for (const s of mine) s.glow = true
		const v = Math.min(START_MAX, Math.max(0.0, _num(props.start_speed, 0.0)))
		if (v > 0 && TYPES[item.type].dynamic && !py.truthy(item.fixed)) {
			const heading = _num(item.angle, 0.0) * D2R
			const a = heading + Math.min(180.0, Math.max(-180.0, _num(props.start_dir, 0.0))) * D2R
			const vx = py.pyRound(v * py.cos(a), 6)
			const vy = py.pyRound(v * py.sin(a), 6)
			const along = v * py.cos(a - heading)
			const roll = (has(props, "start_spin") ? props.start_spin : "roll") !== "none"
			for (const s of mine) {
				if (s.kind !== "dynamic" || (has(s, "parent") && !has(s, "pivot"))) continue
				const rec = { kind: "mechanics", id: `${s.id}#start`, item: iid, role: "start", solid: s.id, vx, vy }
				if (roll && s.body.kind === "ball" && s.body.radius > 0) rec.w = py.pyRound(-along / s.body.radius, 6) // (a ball too small to have a radius in the doc does not spin)
				sb.processes.push(rec)
			}
		}
	}
}

// ---------------------------------------------------------------- floor
const _has = (...names) => names.filter((n) => Object.prototype.hasOwnProperty.call(MATERIALS, n))

function _floor() {
	const build_floor = (c, P) => {
		const L = P.length
		const t = P.thickness
		c.slab("floor", L, t, P.depth, 0, -t / 2, { kind: "static", words: `a long ${P.material} floor`, ...(c.oy > 0.02 ? { legs: true } : {}) })
	}
	register(new ItemType("floor", "Floor", "Scenery", build_floor, {
		dynamic: false, material: "varnished hardwood",
		materials: _has("varnished hardwood", "concrete", "carpet", "rubber mat", "grass", "ice", "felt"), module: "mechanics",
		props: [
			new Prop("length", "Length", 12.0, 0.5, 60.0, 0.1, "m", "Left to right: long enough for a 10 m race"),
			new Prop("thickness", "Thickness", 0.05, 0.02, 0.3, 0.005, "m"),
			new Prop("depth", "Width (front to back)", 1.2, 0.2, 4.0, 0.05, "m", "Only for the 3D look")
		],
		tags: ["ground", "floor", "gym", "hallway", "lane", "track", "road", "pavement", "long", "race", "playground", "court"],
		anchor: "the middle of its top surface",
		description: "A long floor (up to 60 m) of wood, concrete, carpet, rubber, grass or ice: room for races and long rolls.",
		source: "Surfaces as the catalog's materials (gym floor = varnished hardwood); grass: rolling resistance 0.05-0.1 (spec mechanics.md).",
		facts: "12 m · fixed", edit: [{ kind: "length", prop: "length", y: "surface" }]
	}))
}

// ---------------------------------------------------------------- ramp on blocks
export function ramp_geometry(blocks, length, rises) {
	const t = PLANK_T
	const e = OVERHANG
	const bh = BLOCK[1]
	let n = Math.max(0, Math.trunc(blocks))
	while (n > 0 && n * bh > 0.8 * (length - e - t)) n -= 1
	const H = n * bh
	const out = { blocks: n, rise: H }
	const sx = rises !== "right" ? -1.0 : 1.0
	if (n === 0) return { ...out, s: 0.0, c: 1.0, plank: null, flat: true, stack: [], lip: null }
	let s = H / (length - e)
	for (let k = 0; k < 6; k++) s = (H + t * Math.sqrt(1 - s * s)) / (length - e)
	const c = Math.sqrt(1 - s * s)
	const L = length
	const T = [-L * c, L * s]
	const Tb = [-L * c - t * s, L * s - t * c]
	const B0 = [-t / s, 0.0]
	let pts = [[0.0, 0.0], T, Tb, B0]
	const Lb = L - (t * c) / s
	const xs = B0[0] - (Lb - e) * c
	let stack = []
	for (let k = 0; k < n; k++) stack.push([xs - BLOCK[0] / 2, bh / 2 + k * bh])
	const [lt, lh] = LIP
	const ux = -c
	const uy = s
	const nx = s
	const ny = c
	const base = [T[0] - lt * ux, T[1] - lt * uy]
	let lip = [[T[0], T[1]], base, [base[0] + lh * nx, base[1] + lh * ny], [T[0] + lh * nx, T[1] + lh * ny]]
	if (sx > 0) {
		pts = pts.map(([x, y]) => [-x, y]).reverse()
		stack = stack.map(([x, y]) => [-x, y])
		lip = lip.map(([x, y]) => [-x, y]).reverse()
	}
	return { ...out, s, c, plank: pts, flat: false, stack, lip }
}

function _ramp() {
	const build_ramp = (c, P) => {
		const g = ramp_geometry(P.blocks, P.length, P.rises)
		const d = P.depth
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		if (g.flat) {
			const sx = P.rises !== "right" ? -1.0 : 1.0
			const L = P.length
			c.slab("plank", L, PLANK_T, d, sx * (L / 2 + 0.06), PLANK_T / 2, { kind: "static", words: "a flat board on the floor" })
			const bevel = [[0.0, 0.0], [sx * 0.06, PLANK_T], [sx * 0.06, 0.0]]
			c.poly("foot", sx < 0 ? bevel : [...bevel].reverse(), d, 0.0, 0.0, { kind: "static", words: "the board's bevelled foot" })
		} else {
			c.poly("plank", g.plank, d, 0.0, 0.0, { kind: "static", words: `a ramp: a plank on ${g.blocks} wooden block${g.blocks !== 1 ? "s" : ""}` })
			g.stack.forEach(([x, y], k) => {
				c.slab(`block${k + 1}`, BLOCK[0], BLOCK[1], Math.min(0.3, Math.max(BLOCK[2], d * 0.6)), x, y, { kind: "static", material: wood, look: "wood", words: "a wooden block under the ramp" })
			})
			if (py.truthy(P.lip)) c.poly("lip", g.lip, d, 0.0, 0.0, { kind: "static", material: wood, look: "wood", words: "a small stop at the top of the ramp" })
		}
		P.blocks_used = g.blocks
		P.rise = py.pyRound(g.rise, 5)
		P.slope = py.pyRound(py.degrees(Math.atan2(g.s, g.c)), 2)
	}
	register(new ItemType("ramp", "Ramp on blocks", "Surfaces & ramps", build_ramp, {
		dynamic: false, material: "varnished hardwood",
		materials: _has("varnished hardwood", "carpet", "felt", "sandpaper", "rubber mat", "ice"), module: "mechanics",
		props: [
			new Prop("blocks", "Blocks under it", 1, 0, 8, 1, "", "Wooden blocks stacked under its high end, 5 cm each: 1 block vs 3 blocks", { kind: "int" }),
			new Prop("length", "Length", 1.0, 0.4, 2.0, 0.01, "m", "The plank's length"),
			new Prop("depth", "Width (front to back)", 0.12, 0.08, 0.4, 0.01, "m", "Only for the 3D look"),
			new Prop("rises", "High end", "left", { kind: "choice", choices: ["left", "right"], help: "left: things roll down to the right" }),
			new Prop("lip", "Stop at the top", true, { kind: "bool", help: "A small stop a car can wait against at the top" })
		],
		readouts: [],
		tags: ["ramp", "incline", "slope", "blocks", "fair test", "car ramp", "inclined plane", "height", "plank", "board", "hill"],
		anchor: "the floor at the ramp's foot (its low end)",
		description:
			"A plank resting on a stack of wooden blocks (5 cm each) at its high end, its foot feathered onto the floor: more blocks, a steeper ramp. A car let go at the top rolls down and off onto the floor.",
		source:
			"The catalog's wooden block, 10 x 5 x 5 cm, lies flat under the plank (5 cm of rise each); an 18 mm pine plank (provisional). sin θ = rise / (plank under the stack): 1 block under a 1 m plank is 3.0°, 3 blocks 8.9°.",
		facts: "1 m plank · 1 block (5 cm)", edit: [{ kind: "length", prop: "length" }]
	}))
}

// ---------------------------------------------------------------- clay that sticks
function _clay_fill() {
	const n = CLAY_SHAPE.length
	let a = 0
	for (let k = 0; k < n; k++) a += CLAY_SHAPE[k][0] * CLAY_SHAPE[(k + 1) % n][1] - CLAY_SHAPE[(k + 1) % n][0] * CLAY_SHAPE[k][1]
	return a / 2
}

function _clay() {
	const build_clay = (c, P) => {
		const m = P.mass
		const w = P.width
		const h = py.pyRound(Math.min(Math.max(m / CLAY_DENSITY / (_clay_fill() * w * w), 0.004), w), 5)
		const pts = CLAY_SHAPE.map(([x, y]) => [py.pyRound(x * w, 5), py.pyRound(y * h, 5)])
		const n = pts.length
		let area = 0
		for (let k = 0; k < n; k++) area += pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1]
		area /= 2
		const dens = py.pyRound(m / (area * w), 3)
		const sid = c.poly("clay", pts, w, 0.0, 0.0, { material: c.mat({ density: dens }), words: "a lump of modelling clay" })
		if (py.truthy(P.sticky)) c.process("mechanics", "stick", { role: "sticky", solid: sid, to: P.sticks_to === "anything" ? "all" : "moving" })
		P.height = h
	}
	register(new ItemType("clay-lump", "Lump of clay", "Blocks & shapes", build_clay, {
		material: "modelling clay", materials: ["modelling clay"], module: "mechanics",
		props: [
			new Prop("mass", "Weight", 0.06, 0.005, 1.0, 0.005, "kg", "60 g: a small handful"),
			new Prop("width", "Width", 0.05, 0.015, 0.15, 0.001, "m"),
			new Prop("sticky", "Sticks", true, { kind: "bool", help: "It sticks to the first thing it touches (and stays stuck)" }),
			new Prop("sticks_to", "Sticks to", "moving things", { kind: "choice", choices: ["moving things", "anything"], help: "moving things: a car or a cart it touches, not the floor; anything: walls and floors too" })
		],
		tags: ["clay", "plasticine", "play-doh", "sticky", "stick", "glue", "velcro", "load", "weight", "inelastic"],
		anchor: "its middle",
		description:
			"A lump of modelling clay. Pressed onto a car or a cart it rides along stuck to it (it adds its weight); thrown at a cart it sticks: a perfectly inelastic hit, both moving on together.",
		source: "Plasticine 1570 kg/m³ (Eckerson et al. 2008); a stuck lump is welded to what it touched (tooling/src/sim/mechanics.ts `sticky`).",
		facts: "60 g · sticks", edit: []
	}))
}

// ---------------------------------------------------------------- helpers
function _child(c, part, parent, w, h, d, dx, dy, material, words, look) {
	const s = {
		kind: c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look,
		body: { kind: "slab", width: py.pyRound(w, 5), height: py.pyRound(h, 5), depth: d }, material,
		at: { x: py.pyRound(dx, 5), y: py.pyRound(dy, 5) }, parent,
		placeholder: { fill: LOOK_FILL[look] ?? "#c8955a" }, render: { kind: "procedural", shade: LOOK_SHADE[look] ?? "#8a6a45" }, depth: 2
	}
	c.sb.solids.push(s)
	return s.id
}
const _r = (v, n = 5) => py.pyRound(v, n)
const fg = (v) => py.fmtG(v, 6)

// ---------------------------------------------------------------- dynamics cart (plunger, bumpers, added masses)
const CART = { L: 0.17, H: 0.035, clear: 0.006, r: 0.0125, ax: 0.055, depth: 0.08, mass: 0.25, wheels: 0.016 }
const PLUNGER = { k: 400.0, click: 0.008, stroke: 0.026, rod: 0.006, len: 0.05 }
const BUMPERS = { plain: null, spring: "spring bumper", magnet: "magnet bumper", velcro: "velcro", clay: "modelling clay" }
const STEEL = 7850

function _cart() {
	const build_cart = (c, P) => {
		const { L, H, clear: cl, r, ax, depth: d } = CART
		const clicks = Math.trunc(P.plunger)
		const rod_m = clicks > 0 ? STEEL * PLUNGER.len * PLUNGER.rod * PLUNGER.rod : 0.0
		const body_m = CART.mass - CART.wheels - rod_m
		const yc = cl + H / 2
		const chassis = c.slab("chassis", L, H, d, 0.0, yc, { material: c.mat({ base: "cart plastic", density: _r(body_m / (L * H * d), 3), overrides: {} }), look: "cart blue", words: "a lab dynamics cart's body" })
		const wmat = c.mat({ base: "cart plastic", density: _r(CART.wheels / 2 / ((4 / 3) * Math.PI * r * r * r), 3), overrides: {} })
		for (const [part, sx] of [["front", 1.0], ["rear", -1.0]]) {
			c.ball(part, r, sx * ax, r, { material: wmat, inertia: 0.5, shape: "cylinder", length: 0.01, depth3d: 0.012, words: "a lab cart's wheel" })
			c.joint("wheel", `axle-${part}`, { chassis: "chassis", wheel: part, anchor: [sx * ax, r - yc], axis: { x: 0.0, y: 1.0 }, frequency: 0.0, damping: 0.0 })
		}
		const top = H / 2
		const load = P.load
		if (load >= 0.001) {
			// (under 82 g a 2 mm plate, its density made up to weigh exactly that; under a gram, none: machines/mod_mechanics.py)
			let hb = load / (STEEL * 0.13 * 0.04)
			let mat = c.mat({ base: "steel", overrides: {} })
			if (hb < 0.002) {
				hb = 0.002
				mat = c.mat({ base: "steel", density: _r(load / (0.13 * hb * 0.04), 3), overrides: {} })
			}
			_child(c, "load", chassis, 0.13, hb, 0.04, 0.0, top + hb / 2, mat, `${fg(load)} kg of steel bars on the cart`, "steel")
		}
		const bm = has(BUMPERS, P.bumper) ? BUMPERS[P.bumper] : null
		if (bm !== null && has(MATERIALS, bm)) {
			const bt = 0.006
			const mat = c.mat({ base: bm, density: _r(0.01 / (bt * 0.025 * 0.05), 3), overrides: {} })
			for (const [part, sx] of [["bumper-front", 1.0], ["bumper-back", -1.0]]) {
				const sid = _child(c, part, chassis, bt, 0.025, 0.05, sx * (L / 2 + bt / 2), 0.0, mat, `a ${P.bumper} bumper`, MATERIALS[bm].look)
				if (P.bumper === "velcro" || P.bumper === "clay") c.process("mechanics", `${part}-stick`, { role: "sticky", solid: sid, to: "moving" })
			}
		}
		if (clicks > 0) {
			const { k: pk, click, stroke, rod, len: rl } = PLUNGER
			const comp = clicks * click
			const out_x = L / 2 + stroke
			const tip = out_x - comp
			const sid = c.slab("plunger", rl, rod, rod, tip - rl / 2, yc + 0.008, { material: c.mat({ base: "steel", overrides: {} }), look: "steel", words: "the cart's spring plunger" })
			c.process("mechanics", "plunger-rail", {
				role: "slider", a: chassis, b: sid, anchorA: { x: 0.0, y: 0.0 }, anchorB: { x: 0.0, y: 0.0 },
				axis: { x: 1.0, y: 0.0 }, lower: _r(-(stroke - comp)), upper: _r(comp), friction: 0.05
			})
			const back = L / 2 - rl
			const rest = _r(out_x - rl - (back - stroke))
			c.joint("spring", "plunger-spring", { a: "chassis", b: "plunger", anchorA: [_r(back - stroke), 0.008], anchorB: [_r(-rl / 2), 0.0], rest, stiffness: pk, damping: 0.0, compressOnly: true, coils: 10, coilRadius: 0.004 })
		}
		// its smart-cart sensor: speed along its track (+ forward) and acceleration, each over the last 0.1 s
		c.process("mechanics", "sensor", { role: "meter", reads: "motion", solid: chassis, key: "speed" })
		P.total_mass = py.pyRound(CART.mass + load + (bm === null ? 0.0 : 0.02), 4)
	}
	register(new ItemType("dynamics-cart", "Dynamics cart", "Machines & motion", build_cart, {
		material: "cart plastic", materials: ["cart plastic"], module: "mechanics",
		props: [
			new Prop("load", "Added mass", 0.0, 0.0, 2.0, 0.05, "kg", "Steel bars on its deck (0.25 kg each in a lab set)"),
			new Prop("plunger", "Plunger clicks", 0, 0, 3, 1, "", "Its spring plunger pushed in 1-3 notches: let go, it pushes off what it touches", { kind: "int" }),
			new Prop("bumper", "Bumpers", "plain", { kind: "choice", choices: Object.keys(BUMPERS), help: "spring and magnet bounce (e 0.9, 0.95); velcro and clay stick (a perfectly inelastic hit)" })
		],
		readouts: [
			new Readout("speed", "Speed", { unit: "m/s", digits: 3, help: "Its speed along its track, + forward (the way it faces): a smart cart's wheel encoder, over 0.1 s" }),
			new Readout("accel", "Acceleration", { unit: "m/s²", digits: 2, help: "How fast its speed changes, + forward: over the last 0.1 s" })
		],
		tags: ["cart", "dynamics cart", "lab cart", "trolley", "collision", "momentum", "plunger", "newton", "F = ma", "velcro", "bumper", "track"],
		anchor: "the ground under its middle, where the wheels touch",
		description:
			"A lab dynamics cart (0.25 kg, 17 cm) on low-friction wheels: add steel bars, set its bumpers (spring, magnet, velcro, clay), cock its spring plunger to push two carts apart. For F = ma, momentum and collisions.",
		source: "[PASCO]-style class cart: 0.25 kg, 17 x 8 cm, wheels rolling with 0.002-0.005; plunger spring 400 N/m, 8 mm a click (provisional).",
		facts: "0.25 kg · 17 cm · low friction", edit: []
	}))
}

// ---------------------------------------------------------------- puller (a motor winch) and pusher (a driven paddle)
const DRUM = 0.015
const PULL_TOP = 2.0

function _puller() {
	const build_puller = (c, P) => {
		const h = P.height
		const side = P.faces === "left" ? -1.0 : 1.0
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		c.slab("base", 0.14, 0.03, 0.12, 0.0, 0.015, { kind: "static", material: c.mat({ base: "steel", overrides: {} }), look: "steel", words: "the winch's heavy base" })
		c.slab("post", 0.03, Math.max(0.01, h - 0.03), 0.04, -side * 0.035, 0.03 + Math.max(0.01, h - 0.03) / 2, { kind: "static", material: wood, look: "wood", words: "the winch's post" })
		const mode = P.mode
		const sp = mode === "speed" ? P.speed : PULL_TOP
		const tq = (mode === "speed" ? 100.0 : P.force) * DRUM
		c.ball("drum", DRUM, 0.0, h, {
			material: c.mat({ base: "steel", density: _r((mode === "force" ? 0.01 : 2.0) / ((4 / 3) * Math.PI * DRUM * DRUM * DRUM), 3), overrides: {} }), look: "steel", words: "the winch's drum",
			shape: "cylinder", length: 0.04, depth3d: 0.04, pivot: { x: 0.0, y: 0.0 }, motor: { speed: _r((side * sp) / DRUM, 4), torque: _r(tq, 5) }
		})
		P.pull = mode === "force" ? py.pyRound(P.force, 4) : null
	}
	register(new ItemType("puller", "Winch puller", "Machines & motion", build_puller, {
		dynamic: true, module: "mechanics",
		props: [
			new Prop("mode", "Pulls", "force", { kind: "choice", choices: ["force", "speed"], help: "force: a steady pull of its set force; speed: reels in at its set speed" }),
			new Prop("force", "Force", 5.0, 0.1, 100.0, 0.1, "N", "The steady pull on its cord (force mode)"),
			new Prop("speed", "Speed", 0.2, 0.01, 2.0, 0.01, "m/s", "How fast it reels in (speed mode)"),
			new Prop("height", "Drum height", 0.05, 0.03, 1.0, 0.005, "m", "Its cord leaves the drum's top this high: set it to the pulled thing's middle"),
			new Prop("faces", "Pulls toward", "left", { kind: "choice", choices: ["left", "right"], help: "Which side its cord leaves on (it reels the linked thing toward itself)" })
		],
		links: [new Link("pulls", "Pulls", { help: "The thing its cord is tied to (a cart, a block, a sled)" })],
		readouts: [new Readout("newtons", "Pull", { unit: "N", digits: 2, help: "The pull in its cord now: a force meter in the cord (over the last 0.1 s)" })],
		tags: ["puller", "winch", "force meter", "newton meter", "pull", "force", "rope", "tug of war", "constant force", "motor", "applied force", "net force"],
		anchor: "the middle of its base, on the floor",
		description:
			"A motor winch on a stand: its cord, tied to the linked thing, pulls with a steady force (newtons) or reels it in at a set speed. Two pullers on one cart: a tug-of-war (balanced when their forces are equal).",
		source: "A geared motor held at torque F·r on a 15 mm drum: the cord's tension is F while the load moves slower than 2 m/s.",
		facts: "5 N steady pull", edit: []
	}))
}

function _pusher() {
	const build_pusher = (c, P) => {
		const stroke = P.stroke
		const h = P.height
		const steel = c.mat({ base: "steel", overrides: {} })
		c.slab("housing", 0.1, 0.05, 0.08, -0.05, 0.025, { kind: "static", material: c.mat({ base: "cart plastic", overrides: {} }), look: "cart blue", words: "the pusher's housing" })
		const rod = c.slab("rod", 0.12, 0.012, 0.012, -0.04, h, { material: steel, look: "steel", words: "the pusher's rod" })
		c.slab("paddle", 0.012, P.paddle, 0.08, 0.026, h, { material: c.mat({ base: "rubber mat", overrides: {} }), look: "rubber mat", words: "the pusher's flat paddle" })
		const s = c.sb.solids[c.sb.solids.length - 1]
		s.parent = rod
		s.at = { x: 0.066, y: 0.0 }
		delete s.angle
		const t0 = P.delay
		const [wx, wy] = c.world(-0.04, h)
		const base = { role: "slider", a: null, b: rod, anchorA: { x: _r(wx), y: _r(wy) }, anchorB: { x: 0.0, y: 0.0 }, axis: { x: _r(py.cos(c.a), 6), y: _r(py.sin(c.a), 6) }, lower: 0.0, upper: _r(stroke) }
		if (P.mode === "force") c.process("mechanics", "drive", { ...base, speed: 10.0, force: _r(P.force, 4), friction: 50.0, ...(t0 > 0 ? { from: t0 } : {}), until: _r(P.push_time + t0, 4) })
		else c.process("mechanics", "drive", { ...base, speed: _r(P.speed, 4), force: 200.0, friction: 50.0, ...(t0 > 0 ? { from: t0 } : {}) })
	}
	register(new ItemType("pusher", "Pusher", "Machines & motion", build_pusher, {
		dynamic: true, module: "mechanics",
		props: [
			new Prop("mode", "Pushes", "force", { kind: "choice", choices: ["force", "speed"], help: "force: pushes with its set force for its push time; speed: moves its paddle at a set speed for its stroke" }),
			new Prop("force", "Force", 5.0, 0.1, 50.0, 0.1, "N", "The push (force mode)"),
			new Prop("push_time", "Push time", 0.2, 0.02, 5.0, 0.01, "s", "How long it pushes (force mode)"),
			new Prop("speed", "Speed", 0.5, 0.05, 3.0, 0.01, "m/s", "The paddle's speed (speed mode)"),
			new Prop("stroke", "Stroke", 0.15, 0.03, 0.5, 0.005, "m", "How far its paddle can go"),
			new Prop("height", "Height", 0.03, 0.015, 0.5, 0.005, "m", "The rod's height: set it to the pushed thing's middle"),
			new Prop("paddle", "Paddle height", 0.06, 0.02, 0.3, 0.005, "m"),
			new Prop("delay", "Starts after", 0.0, 0.0, 10.0, 0.05, "s", "Seconds after the scene lets go")
		],
		tags: ["pusher", "push", "force", "piston", "plunger", "applied force", "kick", "shove", "paddle", "net force", "harder push"],
		anchor: "the floor under its paddle's starting face",
		description:
			"A driven paddle on a rod from a fixed housing: it pushes what is in front of it (to its right; turn it to push another way) with a set force for a set time, or moves at a set speed: a harder push, a bigger change in motion.",
		source: "A linear actuator held at its set force (or speed) along its stroke; no people needed.", facts: "5 N for 0.2 s", edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- edge pulley: a cart pulled by a hanging mass (F = ma)
const EDGE_R = 0.025

function _edge_pulley() {
	const build_edge = (c, P) => {
		const m = P.hanging_mass
		const side = P.mass_side === "right" ? 1.0 : -1.0
		c.slab("clamp", 0.03, 0.06, 0.05, -side * 0.02, -0.03, { kind: "static", material: c.mat({ base: "steel", overrides: {} }), look: "steel", words: "the pulley's clamp" })
		c.ball("wheel", EDGE_R, 0.0, 0.0, { kind: "static", material: c.mat({ base: "cart plastic", overrides: {} }), look: "cart blue", words: "the pulley wheel", shape: "cylinder", length: 0.012, depth3d: 0.012 })
		const hb = Math.min(_r(Math.max(0.012, m / (8400 * 0.025 * 0.025)), 5), 0.25)
		c.slab("mass", 0.025, hb, 0.025, side * EDGE_R, -P.drop - hb / 2, { material: c.mat({ base: "steel", density: _r(m / (0.025 * hb * 0.025), 3), overrides: {} }), look: "steel", words: `a ${fg(m * 1000)} g hanging mass` })
		P.mass_height = hb
	}
	register(new ItemType("edge-pulley", "Edge pulley", "Machines & motion", build_edge, {
		dynamic: true, module: "mechanics",
		props: [
			new Prop("hanging_mass", "Hanging mass", 0.05, 0.005, 2.0, 0.005, "kg", "Hangs on the string over the pulley and pulls the cart"),
			new Prop("drop", "String below the pulley", 0.15, 0.02, 1.5, 0.005, "m", "From the wheel's axle down to the mass's top at the start"),
			new Prop("mass_side", "Mass hangs on", "right", { kind: "choice", choices: ["right", "left"], help: "The table's edge side: the cart is on the other side" })
		],
		links: [new Link("pulls", "Pulls", { help: "The cart (or block) its string is tied to" })],
		readouts: [
			new Readout("newtons", "String pull", {
				unit: "N", digits: 3, help: "The pull in the string (a force sensor where it is tied to the cart), over the last 0.1 s: less than the hanging weight while it falls, T = m·(g − a)"
			})
		],
		tags: ["pulley", "edge pulley", "force sensor", "hanging mass", "F = ma", "newton second law", "modified atwood", "cart", "string", "acceleration", "lab"],
		anchor: "the pulley wheel's axle (clamp it at the table's edge, its top level with the cart's string)",
		description: "A pulley clamped at the table's edge: a string from the linked cart runs over it to a hanging mass, which falls and pulls the cart: a = m·g/(M + m) (Newton's second law).",
		source: "An ideal light pulley (a lab low-friction pulley): a = m g / (M + m) for a frictionless cart [SERWAY].", facts: "50 g pulls the cart",
		edit: []
	}))
}

// ---------------------------------------------------------------- things that fall through the air: coffee filters, a parachute, paper, a feather
const FILTER = { mass: 0.0011, top: 0.13, bottom: 0.06, h: 0.045 }

function _falling() {
	const build_filters = (c, P) => {
		const n = Math.trunc(P.count)
		const { top: w, bottom: b, h } = FILTER
		const hh = h + 0.002 * (n - 1)
		const pts = [[-b / 2, -hh / 2], [b / 2, -hh / 2], [w / 2, hh / 2], [-w / 2, hh / 2]]
		const area = ((w + b) / 2) * hh
		const m = FILTER.mass * n
		const sid = c.poly("filter", pts, w, 0.0, 0.0, { material: c.mat({ base: "office paper", density: _r(m / (area * w), 4), overrides: {} }), look: "office paper", words: `${n} nested paper coffee filter${n > 1 ? "s" : ""}` })
		c.process("mechanics", "shell", { role: "unbuoy", solid: sid, volume: _r(area * w - m / 800.0, 7) })
		P.mass = py.pyRound(m, 6)
	}
	register(new ItemType("coffee-filters", "Coffee filters", "Machines & motion", build_filters, {
		material: "office paper", materials: ["office paper"], module: "mechanics",
		props: [new Prop("count", "How many nested", 1, 1, 8, 1, "", "Nested basket filters fall as one, faster with more (speed ∝ √n)", { kind: "int" })],
		tags: ["coffee filter", "terminal velocity", "air resistance", "drag", "falling", "paper", "parachute", "slow fall"],
		anchor: "its middle",
		description: "Basket coffee filters (1.1 g each), nested: dropped mouth up they reach terminal speed within a few tens of cm, about 1 m/s for one; n nested fall √n times faster (the classic air-resistance lab).",
		source: "A #4 basket filter 1.1 g, about 13 cm across falling (spec mechanics.md); v_t = sqrt(2mg / (ρ C_d A)) with the engine's flat-plate drag (C_d 1.05 on width x depth) [HOE].",
		facts: "1.1 g each · about 1 m/s", edit: []
	}))

	const build_parachute = (c, P) => {
		const D = P.canopy
		const m = P.load_mass
		const L = P.lines
		const dome = 0.18 * D
		const k = 0.12 * D
		let pts = [[-D / 2, 0.0], [-D / 2 + k, -0.004], [D / 2 - k, -0.004], [D / 2, 0.0], [D / 2 - k, dome * 0.75], [0.0, dome], [-D / 2 + k, dome * 0.75]]
		pts = pts.map(([x, y]) => [py.pyRound(x, 5), py.pyRound(y, 5)])
		const cm = P.canopy_mass
		let a2 = 0
		for (let i = 0; i < 7; i++) a2 += pts[i][0] * pts[(i + 1) % 7][1] - pts[(i + 1) % 7][0] * pts[i][1]
		const area = Math.abs(a2) / 2
		const sid = c.poly("canopy", pts, D, 0.0, L, { material: c.mat({ base: "nylon canopy", density: _r(cm / (area * D), 4), overrides: {} }), look: "nylon canopy", words: "a parachute canopy" })
		c.process("mechanics", "shell", { role: "unbuoy", solid: sid, volume: _r(area * D - cm / 1000.0, 7) })
		const s = 0.03
		c.slab("load", s, s, s, 0.0, 0.0, { material: c.mat({ base: "steel", density: _r(m / (s * s * s), 3), overrides: {} }), look: "steel", words: `a ${fg(m * 1000)} g load` })
		for (const [part, sx] of [["line-left", -1.0], ["line-right", 1.0]])
			c.joint("rope", part, { a: "canopy", b: "load", anchorA: [_r((sx * D) / 2), 0.0], anchorB: [_r((sx * s) / 2), _r(s / 2)], length: _r(py.hypot(D / 2 - s / 2, L - s / 2) + 0.002), thickness: 0.001 })
	}
	register(new ItemType("parachute", "Parachute", "Machines & motion", build_parachute, {
		material: "nylon canopy", materials: ["nylon canopy"], module: "mechanics",
		props: [
			new Prop("canopy", "Canopy width", 0.4, 0.15, 1.2, 0.01, "m"), new Prop("load_mass", "Load", 0.05, 0.005, 1.0, 0.005, "kg"),
			new Prop("canopy_mass", "Canopy weight", 0.004, 0.001, 0.05, 0.001, "kg"), new Prop("lines", "Lines", 0.35, 0.1, 1.0, 0.01, "m", "From the canopy's rim down to the load")
		],
		tags: ["parachute", "air resistance", "drag", "terminal velocity", "egg drop", "slow fall", "canopy"],
		anchor: "the load's middle",
		description: "A plastic canopy on two lines over a load: it falls at a steady terminal speed, v = √(2mg/(ρ·C_d·A)) (50 g under a 30 cm canopy: about 3 m/s); a bigger canopy, a slower fall.",
		source: "Canopy C_d 1.3-1.4 on its area [KNACKE]; the engine's flat-plate drag C_d 1.05 on width x depth matches it to 5 %.",
		facts: "40 cm canopy · 50 g", edit: []
	}))

	const build_sheet = (c, P) => {
		const [w, d] = P.held === "long side" ? [0.297, 0.21] : [0.21, 0.297]
		const t = 0.001
		c.slab("sheet", w, t, d, 0.0, 0.0, { material: c.mat({ base: "office paper", density: _r(P.mass / (w * t * d), 3), overrides: {} }), look: "office paper", words: "a flat sheet of paper" })
	}
	register(new ItemType("paper-sheet", "Sheet of paper", "Machines & motion", build_sheet, {
		material: "office paper", materials: ["office paper"], module: "mechanics",
		props: [
			new Prop("mass", "Weight", 0.005, 0.001, 0.05, 0.0005, "kg", "An A4 sheet of 80 g/m² paper weighs 5.0 g"),
			new Prop("held", "Falls with its", "long side", { kind: "choice", choices: ["long side", "short side"], help: "Which side we see" })
		],
		tags: ["paper", "sheet", "A4", "air resistance", "falling", "flat", "crumpled", "drag"],
		anchor: "its middle",
		description: "A flat A4 sheet of office paper (5 g): flat it drifts down slowly (about 1 m/s); crumpled (the paper ball) it falls fast.",
		source: "A4 is 210 x 297 mm (ISO 216); 80 g/m² → 5.0 g.", facts: "A4 · 5 g", edit: []
	}))

	const build_ball = (c, P) => {
		const D = P.diameter
		const r = D / 2
		c.ball("ball", r, 0.0, 0.0, { material: c.mat({ base: "office paper", density: _r(P.mass / ((4 / 3) * Math.PI * r * r * r), 4), overrides: {} }), look: "office paper", words: "a crumpled ball of paper" })
	}
	register(new ItemType("paper-ball", "Crumpled paper ball", "Machines & motion", build_ball, {
		material: "office paper", materials: ["office paper"], module: "mechanics",
		props: [new Prop("diameter", "Diameter", 0.06, 0.02, 0.15, 0.001, "m"), new Prop("mass", "Weight", 0.005, 0.001, 0.05, 0.0005, "kg")],
		tags: ["paper", "crumpled", "ball", "air resistance", "falling", "drag"], anchor: "its middle",
		description: "The same 5 g sheet crumpled into a ball about 6 cm across: it falls nearly as fast as a stone over a metre.",
		source: "An A4 sheet (5.0 g) crumpled: about 6 cm across (spec mechanics.md).", facts: "6 cm · 5 g", edit: []
	}))

	const build_feather = (c, P) => {
		const kind = P.kind
		const [L, w, m] = kind === "falcon" ? [0.25, 0.04, 0.03] : [0.15, 0.04, 0.001]
		const t = 0.004
		c.slab("feather", L, t, w, 0.0, 0.0, { material: c.mat({ base: "feather", density: _r(m / (L * t * w), 3), overrides: {} }), look: "feather", words: `a ${kind} feather` })
		P.mass = m
	}
	register(new ItemType("feather", "Feather", "Machines & motion", build_feather, {
		material: "feather", materials: ["feather"], module: "mechanics",
		props: [new Prop("kind", "Feather", "falcon", { kind: "choice", choices: ["falcon", "craft"], help: "falcon: the 30 g feather of Apollo 15's hammer-and-feather drop; craft: a 1 g craft feather" })],
		tags: ["feather", "hammer and feather", "apollo", "vacuum", "air resistance", "falling", "moon", "galileo"],
		anchor: "its middle",
		description: "A feather: in air it drifts down slowly; in a vacuum (the scene's air off) it falls with a hammer, as on the Moon in 1971.",
		source: "[APOLLO15]: a 1.32 kg hammer and a 0.03 kg falcon feather, dropped together on the Moon, landed together.",
		facts: "30 g falcon feather", edit: []
	}))
}

// ---------------------------------------------------------------- links: what a module item does to another item, once both are built
// where a cord or a string is tied on a pulled thing of these types (its part), not on its first moving solid: a parachute's load (machines/mod_mechanics.py)
const TIE_PART = { parachute: "load" }

function _root_solid(sb, iid, itype = null) {
	const part = has(TIE_PART, itype) ? TIE_PART[itype] : null
	if (part !== null) {
		const s = sb.solids.find((x) => x.id === `${iid}/${part}` && x.kind === "dynamic")
		if (s !== undefined) return s
	}
	for (const s of sb.solids) if (s.item === iid && s.kind === "dynamic" && !(has(s, "parent") && !has(s, "pivot"))) return s
	return null
}

function _world_of(sb, s) {
	let x = s.at.x
	let y = s.at.y
	let a = has(s, "angle") ? s.angle : 0.0
	if (has(s, "parent")) {
		const q = sb.solids.find((p) => p.id === s.parent) ?? null
		if (q !== null) {
			const [qx, qy, qa] = _world_of(sb, q)
			;[x, y, a] = [qx + x * py.cos(qa) - y * py.sin(qa), qy + x * py.sin(qa) + y * py.cos(qa), a + qa]
		}
	}
	return [x, y, a]
}

function _half_extent(s) {
	const b = s.body
	if (b.kind === "ball") return [b.radius, b.radius]
	if (b.kind === "slab") return [b.width / 2, b.height / 2]
	const xs = b.points.map((p) => p.x)
	const ys = b.points.map((p) => p.y)
	return [(py.maxOf(xs) - py.minOf(xs)) / 2, (py.maxOf(ys) - py.minOf(ys)) / 2]
}

function _tie_point(sb, target, towards) {
	const [x, y, a] = _world_of(sb, target)
	const [hx, hy] = _half_extent(target)
	const dx = towards[0] - x
	const dy = towards[1] - y
	const lx = dx * py.cos(-a) - dy * py.sin(-a)
	const ly = dx * py.sin(-a) + dy * py.cos(-a)
	if (target.body.kind === "ball") return [_r((lx >= 0 ? hx : -hx) * 0.98), 0.0]
	return [_r(lx >= 0 ? hx : -hx), _r(Math.min(hy, Math.max(-hy, ly)))]
}

function _links(sb, scene) {
	const items = new Map()
	for (const i of scene.items ?? []) if (i !== null && typeof i === "object" && typeof i.id === "string") items.set(i.id, i)
	for (const item of scene.items ?? []) {
		if (item === null || typeof item !== "object" || !["puller", "edge-pulley"].includes(item.type)) continue
		const iid = item.id
		const P = props_of(item)
		const other = P.pulls
		if (typeof other !== "string" || other === iid || !items.has(other) || !has(TYPES, items.get(other).type)) continue
		const target = _root_solid(sb, other, items.get(other).type)
		if (target === null) continue
		if (item.type === "puller") {
			const drum = sb.solids.find((s) => s.id === `${iid}/drum`) ?? null
			if (drum === null) continue
			const side = P.faces === "left" ? -1.0 : 1.0
			const top = [drum.at.x + side * 0.0, drum.at.y + DRUM]
			const tie = _tie_point(sb, target, top)
			sb.processes.push({ kind: "mechanics", id: `${iid}/cord`, item: iid, role: "spool", drum: drum.id, b: target.id, center: { x: 0.0, y: 0.0 }, radius: DRUM, sense: side > 0 ? 1 : -1, anchorB: { x: tie[0], y: tie[1] }, minLength: 0.02 })
			// (its force meter: the cord's pull)
			sb.processes.push({ kind: "mechanics", id: `${iid}/meter`, item: iid, role: "meter", reads: "rope", a: drum.id, b: target.id, key: "newtons" })
		} else {
			const wheel = sb.solids.find((s) => s.id === `${iid}/wheel`) ?? null
			const mass = sb.solids.find((s) => s.id === `${iid}/mass`) ?? null
			if (wheel === null || mass === null) continue
			const side = P.mass_side === "right" ? 1.0 : -1.0
			const wx = wheel.at.x
			const wy = wheel.at.y
			const top = [wx, wy + EDGE_R]
			const tie = _tie_point(sb, target, top)
			sb.joints.push({
				kind: "pulley", id: `${iid}/string`, item: iid, a: target.id, b: mass.id,
				groundA: { x: _r(wx), y: _r(wy + EDGE_R) }, groundB: { x: _r(wx + side * EDGE_R), y: _r(wy) },
				anchorA: { x: tie[0], y: tie[1] }, anchorB: { x: 0.0, y: _r(mass.body.height / 2) },
				ratio: 1.0, wheelRadius: EDGE_R, render: { draw: "none" }
			})
			// (its force sensor: the string's pull, where it is tied to the cart)
			sb.processes.push({ kind: "mechanics", id: `${iid}/meter`, item: iid, role: "meter", reads: "rope", a: target.id, b: mass.id, key: "newtons" })
		}
	}
}

// ---------------------------------------------------------------- curved track: a roller coaster / marble run of true arcs (KE <-> PE)
const TRACK_T = 0.02
const ARC_STEP = 12.0
const SLOPE = 40.0
const START_TILT = 2.0

function _arc_pieces(c, name, cx, cy, R, a0, a1, side, material, look, d, loop = null) {
	const n = Math.max(1, Math.trunc(Math.ceil(Math.abs(a1 - a0) / ARC_STEP - 1e-9)))
	const made = []
	for (let k = 0; k < n; k++) {
		const p0 = a0 + ((a1 - a0) * k) / n
		const p1 = a0 + ((a1 - a0) * (k + 1)) / n
		const lo = Math.min(p0, p1)
		const hi = Math.max(p0, p1)
		const [r_in, r_out] = side === "in" ? [R, R + TRACK_T] : [R - TRACK_T, R]
		const pt = (r, a) => [cx + r * py.cos(a * D2R), cy + r * py.sin(a * D2R)]
		const pts = [pt(r_in, lo), pt(r_out, lo), pt(r_out, hi), pt(r_in, hi)].map(([x, y]) => [py.pyRound(x, 5), py.pyRound(y, 5)])
		const sid = c.poly(`${name}${k + 1}`, _ccw(pts), d, 0.0, 0.0, { kind: "static", material, look, words: "a curved piece of track" })
		const rec = { role: "arc", solid: sid, center: { x: 0.0, y: 0.0 }, radius: _r(R), side, from: _r(lo * D2R, 6), to: _r(hi * D2R, 6) }
		if (loop !== null) rec.loop = { id: loop[0], p0: _r((lo - loop[1]) * D2R, 6), p1: _r((hi - loop[1]) * D2R, 6) }
		made.push(rec)
	}
	return made
}

function _ccw(pts) {
	let a = 0
	for (let k = 0; k < pts.length; k++) a += pts[k][0] * pts[(k + 1) % pts.length][1] - pts[(k + 1) % pts.length][0] * pts[k][1]
	return a > 0 ? pts : [...pts].reverse()
}

function _flat_piece(c, name, x0, x1, y, material, look, d) {
	c.slab(name, x1 - x0, TRACK_T, d, (x0 + x1) / 2, y - TRACK_T / 2, { kind: "static", material, look, words: "a straight piece of track" })
}

function _slope_piece(c, name, p, q, material, look, d) {
	const dx = q[0] - p[0]
	const dy = q[1] - p[1]
	const L = py.hypot(dx, dy)
	let nx = dy / L
	let ny = -dx / L
	if (ny > 0) {
		nx = -nx
		ny = -ny
	}
	let pts = [p, q, [q[0] + nx * TRACK_T, q[1] + ny * TRACK_T], [p[0] + nx * TRACK_T, p[1] + ny * TRACK_T]]
	pts = pts.map(([x, y]) => [py.pyRound(x, 5), py.pyRound(y, 5)])
	c.poly(name, _ccw(pts), d, 0.0, 0.0, { kind: "static", material, look, words: "a sloped piece of track" })
}

export function coaster_profile(layout, h, size, run) {
	const a = SLOPE
	const sa = py.sin(a * D2R)
	const ca = py.cos(a * D2R)
	const ta = sa / ca
	const base = TRACK_T
	const Rc = 0.08
	const Rv = Math.min(0.3, Math.max(0.08, 0.6 * (h - base)))
	const segs = []
	const x1 = 0.08
	const sg = py.sin(START_TILT * D2R)
	const cg = py.cos(START_TILT * D2R)
	const y1 = h - (x1 * sg) / cg
	segs.push(["slope", [0.0, h], [x1, y1]])
	const cx1 = x1 - Rc * sg
	const cy1 = y1 - Rc * cg
	segs.push(["arc", cx1, cy1, Rc, 90.0 - START_TILT, 90.0 - a, "out", null])
	const E1 = [cx1 + Rc * sa, cy1 + Rc * ca]
	const S2y = base + Rv - Rv * ca
	const S2x = E1[0] + (E1[1] - S2y) / ta
	const xb = S2x + Rv * sa
	segs.push(["slope", E1, [S2x, S2y]])
	segs.push(["arc", xb, base + Rv, Rv, 270.0 - a, 270.0, "in", null])
	let end = xb
	if (layout === "valley") {
		segs.push(["arc", xb, base + Rv, Rv, 270.0, 270.0 + a, "in", null])
		const S3 = [xb + Rv * sa, S2y]
		const E3x = S3[0] + (E1[1] - S2y) / ta
		segs.push(["slope", S3, [E3x, E1[1]]])
		const x4 = E3x + Rc * sa
		segs.push(["arc", x4, h - Rc, Rc, 90.0 + a, 90.0, "out", null])
		segs.push(["flat", x4, x4 + 0.08, h])
		end = x4 + 0.08
	} else if (layout === "hill") {
		const b = 30.0
		const Hh = Math.min(size, 0.9 * (h - base))
		const Rf = Hh / (2 * (1 - py.cos(b * D2R)))
		const sb_ = py.sin(b * D2R)
		const xh = xb + 0.1
		segs.push(["flat", xb, xh, base])
		segs.push(["arc", xh, base + Rf, Rf, 270.0, 270.0 + b, "in", null])
		const xt = xh + 2 * Rf * sb_
		segs.push(["arc", xt, base + Hh - Rf, Rf, 90.0 + b, 90.0 - b, "out", null])
		const xe = xt + 2 * Rf * sb_
		segs.push(["arc", xe, base + Rf, Rf, 270.0 - b, 270.0, "in", null])
		segs.push(["flat", xe, xe + run, base])
		end = xe + run
	} else if (layout === "loop") {
		const RL = size
		const xl = xb + 0.15
		segs.push(["flat", xb, xl, base])
		segs.push(["arc", xl, base + RL, RL, -90.0, 270.0, "in", "loop"])
		segs.push(["flat", xl, xl + run, base])
		end = xl + run
	} else {
		segs.push(["flat", xb, xb + run, base])
		end = xb + run
	}
	return { segs, start: [0.04, h - (0.04 * sg) / cg], end, bottom: [xb, base], base }
}

function _coaster() {
	const build_coaster = (c, P) => {
		const { layout, height: h, size, run, depth: d } = P
		const g = coaster_profile(layout, h, size, run)
		const mat = c.mat()
		const look = MATERIALS[P.material].look
		let k = 0
		let recs = []
		for (const seg of g.segs) {
			k += 1
			if (seg[0] === "flat") _flat_piece(c, `flat${k}`, seg[1], seg[2], seg[3], mat, look, d)
			else if (seg[0] === "slope") _slope_piece(c, `slope${k}`, seg[1], seg[2], mat, look, d)
			else {
				const [, cx, cy, R, a0, a1, side, lp] = seg
				const loop = lp ? [c.sid("loop"), -90.0] : null
				recs = recs.concat(_arc_pieces(c, `arc${k}-`, cx, cy, R, a0, a1, side, mat, look, d, loop).map((r) => ({ ...r, center: { x: _r(cx), y: _r(cy) } })))
			}
		}
		c.slab("stop", 0.01, 0.02, d, -0.005, h + 0.01, { kind: "static", material: mat, look, words: "the stop at the track's start" })
		for (const r of recs) c.process("mechanics", `${r.solid.slice(r.solid.indexOf("/") + 1)}#arc`, r)
		if (layout === "loop") {
			const RL = size
			const xl = g.bottom[0] + 0.15
			const [wx, wy] = c.world(xl, g.base + RL)
			c.process("mechanics", "loop", { role: "loop", center: { x: _r(wx), y: _r(wy) }, radius: _r(RL), entry: _r(-90.0 * D2R + c.a, 6), sense: 1 })
		}
		P.start_height = py.pyRound(h, 5)
		P.length_used = py.pyRound(g.end, 5)
		if (layout === "loop") P.least_height_marble = py.pyRound(TRACK_T + 2.7 * (size - 0.008), 4)
	}
	register(new ItemType("coaster-track", "Roller-coaster track", "Surfaces & ramps", build_coaster, {
		dynamic: false, material: "steel", materials: _has("steel", "varnished hardwood", "hollow plastic"), module: "mechanics",
		props: [
			new Prop("layout", "Shape", "loop", { kind: "choice", choices: ["curved ramp", "valley", "hill", "loop"], help: "curved ramp: a drop onto a flat run; valley: a U (a half-pipe); hill: a drop, then a hump; loop: a drop, then a loop-the-loop" }),
			new Prop("height", "Start height", 0.6, 0.15, 2.0, 0.01, "m", "Its start platform's height above the floor"),
			new Prop("size", "Loop / hill size", 0.15, 0.04, 0.6, 0.005, "m", "The loop's radius, or the hill's height"),
			new Prop("run", "Run-out", 0.6, 0.1, 3.0, 0.01, "m", "The flat track after it"),
			new Prop("depth", "Channel width", 0.05, 0.02, 0.2, 0.005, "m", "Only for the 3D look")
		],
		tags: ["roller coaster", "coaster", "loop", "loop the loop", "track", "marble run", "half pipe", "valley", "hill", "energy", "potential energy", "kinetic energy", "curved ramp", "curve"],
		anchor: "the floor under its start (the track runs to the right)",
		description:
			"A curved track of true arcs (no bumps at its joints): a drop from its start platform, then a flat run, a valley (U), a hill or a loop-the-loop. Potential energy turns into motion and back; a ball needs a start 2.7 times the loop's radius high to go round.",
		source:
			"A solid ball rolling without slipping needs h ≥ 2.7 (R − r) to loop (energy: m g h = ½ m v² (1 + 2/5), v² ≥ g (R − r) at the top) [SERWAY]; the engine rides the true arcs (tooling/src/sim/mechanics.ts ArcTouch).",
		facts: "60 cm drop · 15 cm loop", edit: []
	}))
}

// ---------------------------------------------------------------- gears: a train of meshed spur gears on a board
function _gears() {
	const build_gears = (c, P) => {
		const m = P.module / 1000
		const teeth = [Math.trunc(P.teeth_a), Math.trunc(P.teeth_b)].concat(Math.trunc(P.teeth_c) > 0 ? [Math.trunc(P.teeth_c)] : [])
		const radii = teeth.map((n) => (m * n) / 2)
		const xs = [0.0]
		for (let k = 1; k < radii.length; k++) xs.push(xs[xs.length - 1] + radii[k - 1] + radii[k])
		const x_mid = (xs[0] + xs[xs.length - 1]) / 2
		const ids = []
		teeth.forEach((n, k) => {
			const r = radii[k]
			const x = xs[k]
			const name = "abc"[k]
			const dens = _r(P.gear_mass / ((4 / 3) * Math.PI * r * r * r), 3)
			const extra = k === 0 && P.rpm > 0 ? { motor: { speed: _r(((P.rpm * 2 * Math.PI) / 60) * (P.turns === "counter-clockwise" ? 1 : -1), 5), torque: _r(P.torque, 5) } } : {}
			const gid = c.ball(`gear-${name}`, r, x - x_mid, 0.0, {
				material: c.mat({ base: "hollow plastic", density: dens, overrides: {} }), look: "plastic", words: `a ${n}-tooth gear`,
				shape: "cylinder", length: 0.01, depth3d: 0.012, pivot: { x: 0.0, y: 0.0 }, inertia: 0.5, ...extra
			})
			ids.push(gid)
		})
		for (let k = 1; k < ids.length; k++) c.process("mechanics", `mesh-${"abc"[k - 1]}${"abc"[k]}`, { role: "gear", a: ids[k - 1], b: ids[k], na: teeth[k - 1], nb: teeth[k] })
		const last = teeth.length - 1
		const ratio = teeth[0] / teeth[last]
		P.ratio = py.pyRound(ratio, 5)
		P.last_rpm = py.pyRound(P.rpm * ratio, 4)
		P.last_turns = last % 2 === 0 ? "same way" : "the other way"
	}
	register(new ItemType("gear-train", "Gear train", "Machines & motion", build_gears, {
		dynamic: true, module: "mechanics",
		props: [
			new Prop("teeth_a", "Driver teeth", 12, 6, 80, 1, "", "The gear the motor turns", { kind: "int" }),
			new Prop("teeth_b", "Second gear teeth", 36, 6, 80, 1, "", { kind: "int" }),
			new Prop("teeth_c", "Third gear teeth", 0, 0, 80, 1, "", "0: no third gear", { kind: "int" }),
			new Prop("module", "Tooth size", 4.0, 0.5, 8.0, 0.1, "mm", "The gears' module: a gear's pitch diameter is its teeth × this (4 mm: a 12-tooth gear is 4.8 cm across)"),
			new Prop("rpm", "Motor speed", 30.0, 0.0, 300.0, 1.0, "rpm", "The driver's turning speed; 0: no motor"),
			new Prop("turns", "Motor turns", "counter-clockwise", { kind: "choice", choices: ["counter-clockwise", "clockwise"] }),
			new Prop("torque", "Motor torque", 0.5, 0.01, 10.0, 0.01, "N·m", "The most the motor gives"),
			new Prop("gear_mass", "Gear weight", 0.02, 0.002, 1.0, 0.001, "kg", "Each gear's own weight")
		],
		tags: ["gear", "gears", "gear train", "cog", "speed ratio", "torque", "simple machine", "mesh", "transmission", "rpm", "teeth"],
		anchor: "the middle between its first and last gear's axles",
		description:
			"Two or three meshed spur gears on axles: the motor turns the driver; each gear turns the next the other way, its speed times (driver teeth ÷ its teeth): a 12-tooth gear turns a 36-tooth one 3 times slower (and 3 times as hard).",
		source: "Meshed gears: n_a ω_a = −n_b ω_b (the pitch circles roll on each other); torque goes the other way round [SERWAY].",
		facts: "12 : 36 teeth · 30 rpm", edit: []
	}))
}

// ---------------------------------------------------------------- wheel and axle (a windlass): MA = R / r
function _wheel_axle() {
	const build_wa = (c, P) => {
		const R = P.wheel_radius
		const r = P.axle_radius
		const ml = P.load
		const me = P.effort
		const drop = P.drop
		const hub = c.ball("hub", 0.006, 0.0, 0.0, { kind: "static", material: c.mat({ base: "steel", overrides: {} }), look: "steel", words: "the axle's fixed hub", shape: "cylinder", length: 0.04, depth3d: 0.06, stand: "post" })
		const wm = P.wheel_mass
		const wheel = c.ball("wheel", R, 0.0, 0.0, {
			material: c.mat({ base: "varnished hardwood", density: _r(wm / ((4 / 3) * Math.PI * R * R * R), 3), overrides: {} }),
			look: "wood", words: "the big wheel", shape: "cylinder", length: 0.02, depth3d: 0.02, pivot: { x: 0.0, y: 0.0 }, parent: hub, inertia: 0.5
		})
		c.sb.solids[c.sb.solids.length - 1].at = { x: 0.0, y: 0.0 }
		const sz = 0.04
		const tall = {}
		for (const [part, m, x] of [["effort-mass", me, R], ["load-mass", ml, -r]]) {
			const hb = Math.min(0.3, Math.max(0.012, m / (STEEL * sz * sz)))
			tall[part] = hb
			c.slab(part, sz, hb, sz, x, -drop - hb / 2, { material: c.mat({ base: "steel", density: _r(m / (sz * hb * sz), 3), overrides: {} }), look: "steel", words: part === "effort-mass" ? "the effort weight" : "the load" })
		}
		c.process("mechanics", "effort-rope", { role: "spool", drum: wheel, b: c.sid("effort-mass"), center: { x: 0.0, y: 0.0 }, radius: _r(R), sense: 1, anchorB: { x: 0.0, y: _r(tall["effort-mass"] / 2) }, minLength: 0.03 })
		c.process("mechanics", "load-rope", { role: "spool", drum: wheel, b: c.sid("load-mass"), center: { x: 0.0, y: 0.0 }, radius: _r(r), sense: -1, anchorB: { x: 0.0, y: _r(tall["load-mass"] / 2) }, minLength: 0.03 })
		P.advantage = py.pyRound(R / r, 4)
		P.balance_effort = py.pyRound((ml * r) / R, 5)
	}
	register(new ItemType("wheel-and-axle", "Wheel and axle", "Machines & motion", build_wa, {
		dynamic: true, module: "mechanics",
		props: [
			new Prop("wheel_radius", "Wheel radius", 0.15, 0.04, 0.4, 0.005, "m"), new Prop("axle_radius", "Axle radius", 0.03, 0.01, 0.1, 0.002, "m"),
			new Prop("load", "Load", 1.0, 0.05, 10.0, 0.05, "kg", "Hangs from a rope wound on the axle"),
			new Prop("effort", "Effort weight", 0.25, 0.01, 10.0, 0.01, "kg", "Hangs from a rope wound on the wheel"),
			new Prop("drop", "Ropes below the axle", 0.4, 0.1, 1.5, 0.01, "m"),
			new Prop("wheel_mass", "Wheel weight", 0.2, 0.01, 3.0, 0.01, "kg")
		],
		tags: ["wheel and axle", "windlass", "winch", "simple machine", "mechanical advantage", "crank", "well", "lift", "torque"],
		anchor: "the wheel's axle",
		description:
			"A big wheel fixed to a thin axle: an effort weight on a rope round the wheel lifts a heavier load on a rope round the axle. Mechanical advantage R/r: a 15 cm wheel on a 3 cm axle lifts 1 kg with 0.2 kg (just over that to move it).",
		source: "Balance of torques: m_effort·R = m_load·r [SERWAY]; ropes wound on the wheel and the axle (tooling/src/sim/mechanics.ts SpoolRope).",
		facts: "MA 5 · 1 kg load", edit: []
	}))
}

// ---------------------------------------------------------------- block and tackle: MA = the strands holding the load
function _tackle() {
	const build_tackle = (c, P) => {
		const n = Math.trunc(P.strands)
		const ml = P.load
		const me = P.effort
		const drop = P.drop
		const steel = c.mat({ base: "steel", overrides: {} })
		c.slab("top-block", 0.06, 0.05, 0.04, 0.0, 0.0, { kind: "static", material: steel, look: "steel", words: "the fixed upper pulley block", stand: "wall" })
		const bh = 0.05
		const lw = 0.05
		const lh = Math.min(0.3, Math.max(0.012, ml / (STEEL * lw * lw)))
		c.slab("load", lw, lh, lw, 0.0, -drop - bh - lh / 2, { material: c.mat({ base: "steel", density: _r(ml / (lw * lh * lw), 3), overrides: {} }), look: "steel", words: "the load" })
		_child(c, "moving-block", c.sid("load"), 0.05, bh, 0.04, 0.0, lh / 2 + bh / 2, c.mat({ base: "steel", density: _r(0.05 / (0.05 * bh * 0.04), 3), overrides: {} }), "the moving pulley block", "steel")
		const ew = 0.03
		const eh = Math.min(0.3, Math.max(0.012, me / (STEEL * ew * ew)))
		const ex = 0.06
		c.slab("effort-mass", ew, eh, ew, ex, -drop - eh / 2, { material: c.mat({ base: "steel", density: _r(me / (ew * eh * ew), 3), overrides: {} }), look: "steel", words: "the effort weight" })
		c.joint("pulley", "rope", { a: "effort-mass", b: "load", groundA: [ex, -0.025], groundB: [0.0, -0.025], anchorA: [0.0, _r(eh / 2)], anchorB: [0.0, _r(lh / 2 + bh)], ratio: n, render: { draw: "none", strands: n } })
		P.advantage = n
		P.balance_effort = py.pyRound((ml + 0.05) / n, 5)
	}
	register(new ItemType("block-and-tackle", "Block and tackle", "Machines & motion", build_tackle, {
		dynamic: true, module: "mechanics",
		props: [
			new Prop("strands", "Strands", 2, 2, 4, 1, "", "The rope's strands holding the moving block: its mechanical advantage", { kind: "int" }),
			new Prop("load", "Load", 1.0, 0.05, 10.0, 0.05, "kg"), new Prop("effort", "Effort weight", 0.6, 0.01, 10.0, 0.01, "kg"),
			new Prop("drop", "Rope below the top block", 0.5, 0.15, 1.5, 0.01, "m")
		],
		tags: ["pulley", "pulleys", "block and tackle", "mechanical advantage", "simple machine", "hoist", "crane", "lift", "strands"],
		anchor: "the fixed top block's middle",
		description: "A fixed pulley block above, a moving block below carrying the load: with n rope strands holding it, an effort of 1/n of the load (and the block) holds it up, and the effort moves n times as far as the load rises.",
		source: "Ideal (light, frictionless) sheaves: effort = load / n, distance × n [SERWAY]; the moving block weighs 50 g (provisional).",
		facts: "MA 2 · 1 kg", edit: []
	}))
}

// ---------------------------------------------------------------- levers: first, second and third class, weights in balance
function _lever() {
	const build_lever = (c, P) => {
		const cls = P.class
		const L = P.length
		const dl = P.load_at
		const de = P.effort_at
		const ml = P.load
		const me = P.effort
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		const steel = c.mat({ base: "steel", overrides: {} })
		const th = 0.006
		const bd = _r(Math.min(0.1, Math.max(0.005, P.beam_mass / (700.0 * L * th))), 5)
		const fx = 0.0
		const bx = cls === "1" ? 0.0 : L / 2 - 0.02
		c.slab("beam", L, th, bd, bx, 0.0, { material: c.mat({ base: "varnished hardwood", density: _r(P.beam_mass / (L * th * bd), 3), overrides: {} }), look: "wood", words: "a lever's beam" })
		c.slab("fulcrum", 0.03, 0.2, 0.06, fx, -0.11 - th / 2, { kind: "static", material: wood, look: "wood", words: "the lever's fulcrum stand" })
		c.joint("pin", "fulcrum-pin", { a: null, b: "beam", anchorA: [fx, 0.0], anchorB: [_r(fx - bx), 0.0], limits: { lower: -0.35, upper: 0.35 }, damping: 0.02, friction: _r(PIN_MU * (P.load + P.effort + P.beam_mass) * 9.81 * PIN_R, 6) })
		let xl
		let xe
		let up
		if (cls === "1") [xl, xe, up] = [-dl, de, false]
		else if (cls === "2") [xl, xe, up] = [dl, de, true]
		else [xl, xe, up] = [dl, de, true]
		const hang = 0.25
		const ls = 0.04
		const lh = Math.min(0.3, Math.max(0.012, ml / (STEEL * ls * ls)))
		c.slab("load-mass", ls, lh, ls, xl, -hang - lh / 2, { material: c.mat({ base: "steel", density: _r(ml / (ls * lh * ls), 3), overrides: {} }), look: "steel", words: "the load" })
		c.joint("rope", "load-cord", { a: "beam", b: "load-mass", anchorA: [_r(xl - bx), _r(-th / 2)], anchorB: [0.0, _r(lh / 2)], length: _r(hang - th / 2), thickness: 0.002 })
		const es = 0.03
		const eh = Math.min(0.3, Math.max(0.012, me / (STEEL * es * es)))
		if (!up) {
			c.slab("effort-mass", es, eh, es, xe, -hang - eh / 2, { material: c.mat({ base: "steel", density: _r(me / (es * eh * es), 3), overrides: {} }), look: "steel", words: "the effort weight" })
			c.joint("rope", "effort-cord", { a: "beam", b: "effort-mass", anchorA: [_r(xe - bx), _r(-th / 2)], anchorB: [0.0, _r(eh / 2)], length: _r(hang - th / 2), thickness: 0.002 })
		} else {
			const top = 0.35
			c.ball("pulley", 0.02, xe + 0.02, top, { kind: "static", material: steel, look: "steel", words: "the pulley over the lever", shape: "cylinder", length: 0.01, depth3d: 0.012, stand: "post" })
			c.slab("effort-mass", es, eh, es, xe + 0.04, top - 0.2 - eh / 2, { material: c.mat({ base: "steel", density: _r(me / (es * eh * es), 3), overrides: {} }), look: "steel", words: "the effort weight" })
			c.joint("pulley", "effort-cord", { a: "beam", b: "effort-mass", groundA: [xe, top], groundB: [xe + 0.04, top], anchorA: [_r(xe - bx), _r(th / 2)], anchorB: [0.0, _r(eh / 2)], ratio: 1.0, render: { draw: "none" } })
		}
		const beam_turn = cls === "1" ? 0.0 : (P.beam_mass - 1.2 * L * th * bd) * bx
		P.load_turn = py.pyRound(ml * Math.abs(xl), 5)
		P.beam_turn = py.pyRound(beam_turn, 5)
		P.effort_turn = py.pyRound(me * Math.abs(xe), 5)
		P.balanced_by = py.pyRound((ml * Math.abs(xl) + beam_turn) / Math.max(1e-9, Math.abs(xe)), 5)
	}
	register(new ItemType("lever-kit", "Lever", "Machines & motion", build_lever, {
		dynamic: true, module: "mechanics",
		props: [
			new Prop("class", "Class", "1", { kind: "choice", choices: ["1", "2", "3"], help: "1: the fulcrum between load and effort (a seesaw); 2: the load between (a wheelbarrow); 3: the effort between (tweezers)" }),
			new Prop("length", "Beam length", 1.0, 0.3, 2.0, 0.01, "m"),
			new Prop("load", "Load", 0.5, 0.01, 10.0, 0.01, "kg"), new Prop("load_at", "Load from the fulcrum", 0.2, 0.02, 1.0, 0.005, "m"),
			new Prop("effort", "Effort weight", 0.25, 0.01, 10.0, 0.01, "kg"), new Prop("effort_at", "Effort from the fulcrum", 0.4, 0.02, 1.0, 0.005, "m"),
			new Prop("beam_mass", "Beam weight", 0.12, 0.01, 2.0, 0.005, "kg", "A metre stick weighs about 0.12 kg (classes 2 and 3 lift it too)")
		],
		tags: ["lever", "fulcrum", "simple machine", "first class lever", "second class lever", "third class lever", "balance", "torque", "seesaw", "effort", "load", "mechanical advantage", "moment"],
		anchor: "the fulcrum's pin",
		description: "A beam on a fulcrum with a hanging load and an effort (a weight hanging, or pulling up over a pulley): balanced when load × its distance = effort × its distance. Classes 1, 2 and 3.",
		source: "The law of the lever: m_load·d_load = m_effort·d_effort [SERWAY]; the beam swings on a lightly damped pin, ±20°.",
		facts: "class 1 · 0.5 kg at 20 cm", edit: []
	}))
}

// ---------------------------------------------------------------- balloon rocket on a string (action and reaction)
function _balloon() {
	const build_balloon = (c, P) => {
		const L = P.string
		const D = P.diameter
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		for (const [part, x] of [["post-start", -0.1], ["post-end", L + 0.05]]) c.slab(part, 0.03, 1.0, 0.03, x, 0.5, { kind: "static", material: wood, look: "wood", words: "a post holding the string" })
		const straw = c.slab("straw", 0.1, 0.008, 0.008, 0.0, 1.0, { material: c.mat({ base: "hollow plastic", density: _r(P.rubber / (0.1 * 0.008 * 0.008), 2), overrides: {} }), look: "plastic", words: "a drinking straw on the string" })
		const a = c.a
		const [wx, wy] = c.world(0.0, 1.0)
		c.process("mechanics", "string", { role: "slider", a: null, b: straw, anchorA: { x: _r(wx), y: _r(wy) }, anchorB: { x: 0.0, y: 0.0 }, axis: { x: _r(py.cos(a), 6), y: _r(py.sin(a), 6) }, lower: -0.05, upper: _r(L - 0.15), friction: _r(P.friction, 4) })
		c.process("mechanics", "jet", { role: "balloon", solid: straw, diameter: _r(D), rest: 0.06, pressure: _r(P.pressure, 2), nozzle: _r(P.nozzle), direction: _r(Math.PI, 6), at: { x: 0.0, y: _r(-D / 2 - 0.004) }, cd: 0.47 })
	}
	register(new ItemType("balloon-rocket", "Balloon rocket", "Machines & motion", build_balloon, {
		dynamic: true, module: "mechanics",
		props: [
			new Prop("string", "String length", 4.0, 0.5, 15.0, 0.1, "m"), new Prop("diameter", "Balloon size", 0.25, 0.12, 0.4, 0.005, "m", "Blown up"),
			new Prop("pressure", "Pressure inside", 3000.0, 1000.0, 6000.0, 50.0, "Pa", "Over the room's: a party balloon's is about 2-4 kPa"),
			new Prop("nozzle", "Neck", 0.01, 0.004, 0.02, 0.0005, "m", "The open neck's bore: wider, a stronger, shorter push"),
			new Prop("friction", "String friction", 0.015, 0.0, 0.2, 0.001, "N", "The straw rubbing on the string"),
			new Prop("rubber", "Rubber and straw", 0.005, 0.002, 0.03, 0.0005, "kg")
		],
		readouts: [new Readout("volume", "Air left", { unit: "m³", digits: 4 }), new Readout("thrust", "Jet push", { unit: "N", digits: 3 })],
		tags: ["balloon rocket", "rocket", "action reaction", "newton third law", "thrust", "jet", "balloon", "string", "straw"],
		anchor: "the floor under the string's start (its left end); the string runs 1 m up, to the right, the balloon waiting at its start",
		description: "A blown-up balloon taped to a straw on a taut string: let go, its air rushes out of the neck backward and pushes it forward (Newton's third law) until it is empty, then it coasts.",
		source: "Jet thrust 2·C_c·Δp·A (Bernoulli, contraction 0.62) while the latex holds its pressure (Merritt & Weinhaus, Am. J. Phys. 46, 976 (1978)); drag of a sphere (C_d 0.47) on its size now (tooling/src/sim/mechanics.ts).",
		facts: "4 m string · 25 cm balloon", edit: []
	}))
}

// ---------------------------------------------------------------- screw jack: an inclined plane wrapped round a rod (machines/mod_mechanics.py: ideal MA
// 2π·L / p, efficiency 0.2-0.4 [SHIGLEY], self-locking)
const JACK = { bottom: 0.14, top: 0.07, base: 0.12, gap: 0.001, cap: 0.09, cap_h: 0.02, screw: 0.024, screw_h: 0.13, bar: 0.012, foot: 0.18 }

function _screw_jack() {
	const build_jack = (c, P) => {
		const J = JACK
		const p = P.pitch / 1000.0
		const [L, Fe, n, eta, ml, lift] = [P.handle, P.effort, P.turns, P.efficiency, P.load, P.lift]
		const steel = c.mat({ base: "steel", overrides: {} })
		c.poly("housing", [[-J.bottom / 2, 0.0], [J.bottom / 2, 0.0], [J.top / 2, J.base], [-J.top / 2, J.base]], J.bottom, 0.0, 0.0, { kind: "static", material: steel, look: "steel", words: "the screw jack's cast-iron base (its nut inside)" })
		const yc = J.base + J.gap + J.cap_h / 2
		const cap = c.slab("cap", J.cap, J.cap_h, J.cap, 0.0, yc, { material: steel, look: "steel", words: "the screw jack's lifting cap" })
		for (const [part, w, h, d, dy, words] of [
			["screw", J.screw, J.screw_h, J.screw, -J.cap_h / 2 - J.screw_h / 2, "the jack's threaded screw"],
			["bar", 2 * L, J.bar, J.bar, J.cap_h / 2 - J.bar / 2 - 0.004, "the jack's handle (a tommy bar)"]
		]) {
			_child(c, part, cap, w, h, d, 0.0, dy, steel, words, "steel")
			c.sb.solids[c.sb.solids.length - 1].ghost = true
		}
		if (ml > 0) {
			const fw = J.foot
			const hl = Math.min(0.8, Math.max(0.01, _r(ml / (STEEL * fw * fw), 5)))
			c.slab("load", fw, hl, fw, 0.0, yc + J.cap_h / 2 + 0.001 + hl / 2, { material: c.mat({ base: "steel", density: _r(ml / (fw * hl * fw), 3), overrides: {} }), look: "steel", words: `a ${fg(ml)} kg steel load` })
		}
		const ma = (2 * Math.PI * L) / p
		const force = eta * Fe * ma
		const [wx, wy] = c.world(0.0, yc)
		c.process("mechanics", "screw", {
			role: "slider", a: null, b: cap, anchorA: { x: _r(wx), y: _r(wy) }, anchorB: { x: 0.0, y: 0.0 },
			axis: { x: _r(0.0 - py.sin(c.a), 6), y: _r(py.cos(c.a), 6) }, lower: 0.0, upper: _r(lift), speed: _r(n * p, 6), force: _r(force, 3), friction: _r(force, 3)
		})
		c.process("mechanics", "lift", { role: "meter", reads: "rise", solid: cap, key: "lift" })
		const moving = STEEL * (J.cap * J.cap_h * J.cap + J.screw * J.screw_h * J.screw + 2 * L * J.bar * J.bar)
		P.advantage = py.pyRound(ma, 3)
		P.lift_force = py.pyRound(force, 3)
		P.moving_mass = py.pyRound(moving, 4)
		P.lifts = force > (ml + moving) * 9.81
	}
	register(new ItemType("screw-jack", "Screw jack", "Machines & motion", build_jack, {
		dynamic: true, module: "mechanics",
		props: [
			new Prop("load", "Load", 20.0, 0.0, 300.0, 0.5, "kg", "A steel load on its cap"),
			new Prop("effort", "Push on the handle", 10.0, 0.5, 200.0, 0.5, "N", "The push at the handle's end as it is turned"),
			new Prop("handle", "Handle length", 0.2, 0.05, 0.5, 0.01, "m", "From the screw to where it is pushed: a longer handle, more force"),
			new Prop("pitch", "Thread pitch", 5.0, 1.0, 12.0, 0.5, "mm", "How far one turn lifts it: a finer thread lifts more, more slowly"),
			new Prop("turns", "Turns a second", 1.0, 0.1, 4.0, 0.1, "turns/s", "How fast the handle goes round"),
			new Prop("efficiency", "Efficiency", 0.3, 0.1, 0.9, 0.01, "", "The share of the work that lifts (thread friction takes the rest: 0.2-0.4 for most jacks)"),
			new Prop("lift", "Stroke", 0.05, 0.01, 0.3, 0.005, "m", "How far the cap can rise")
		],
		readouts: [new Readout("lift", "Lifted", { unit: "m", digits: 4, help: "How far its cap (and the load on it) has risen" })],
		tags: ["screw", "screw jack", "car jack", "jack", "simple machine", "inclined plane", "thread", "pitch", "lift", "mechanical advantage", "lever", "wedge"],
		anchor: "the middle of its base, on the floor",
		description:
			"A screw jack: turning its handle drives a screw up through the nut in its base, lifting a heavy load on its cap a pitch a turn. A 10 N push on a 20 cm handle with a 5 mm thread lifts about 75 kg (ideal advantage 2π·L / pitch = 251, about 30 % efficient), but only 5 mm a turn: force traded for distance.",
		source: "Power screws [SHIGLEY]: ideal advantage 2π·L/p, efficiency tan λ / tan(λ + φ), 0.2-0.4 for square and Acme threads (μ 0.1-0.2), self-locking under 0.5.",
		facts: "MA 251 · 30 % · 5 mm a turn", edit: []
	}))
}

// ---------------------------------------------------------------- fragile things (an egg)
const EGG = { k: 1.5e4, force: 35.0 }
const PIN_MU = 0.25
const PIN_R = 0.0015
const SOFT = { foam: 5e4, sponge: 1e5, pillow: 1e4, "rubber mat": 2e6, carpet: 5e5, "trampoline mat": 2e5, felt: 3e5 }

function _fragile(sb, scene) {
	for (const item of scene.items ?? []) {
		if (item === null || typeof item !== "object" || item.type !== "egg" || (item.props ?? {}).fragile !== true) continue
		const root = sb.solids.find((s) => s.id === `${item.id}/egg`) ?? null
		if (root === null) continue
		sb.processes.push({ kind: "mechanics", id: `${item.id}/shell`, item: item.id, role: "fragile", solid: root.id, stiffness: EGG.k, force: EGG.force, soft: { ...SOFT } })
	}
}

// ---------------------------------------------------------------- energy bars: a board showing a moving thing's energy as the run plays
function _energy_board() {
	const build_board = (c, P) => {
		const w = P.width
		const h = P.height
		// a display only: a static ghost (it touches nothing), its own stand drawn by the model
		c.slab("board", w, h, 0.02, 0.0, h / 2, { kind: "static", material: c.mat({ base: "hollow plastic", overrides: {} }), look: "office paper", words: "a white board of energy bars on a stand", ghost: true, stand: "self" })
	}
	register(new ItemType("energy-bars", "Energy bars", "Machines & motion", build_board, {
		dynamic: false, module: "mechanics",
		props: [
			new Prop("width", "Width", 0.6, 0.3, 2.0, 0.05, "m"), new Prop("height", "Height", 0.5, 0.25, 1.5, 0.05, "m"),
			new Prop("zero", "Height from", "lowest", { kind: "choice", choices: ["lowest", "floor"], help: "lowest: potential energy counted from the lowest point it reaches in the run (a swing's bottom); floor: from the floor" })
		],
		links: [new Link("watch", "Shows", { help: "The moving thing whose energy it shows (a pendulum's bob, a ball on a track, a car on a ramp)" })],
		tags: ["energy", "energy bars", "kinetic energy", "potential energy", "conservation of energy", "energy transfer", "heat", "bar chart", "pendulum", "roller coaster"],
		anchor: "the middle of its bottom edge",
		description: "A board standing behind the scene with bars of the linked moving thing's energy as the run plays: kinetic (½mv²), " +
			"potential (mgh), spring (½kx²) and what has turned to heat and sound, their total the start's: energy changes " +
			"form, the total stays. Drawn only.",
		source: "From the engine's bookkeeping (tooling/src/sim/mechanics.ts `energy`: start + added = kinetic + potential + spring + heat).",
		facts: "KE · PE · heat"
	}))
}

// ---------------------------------------------------------------- goal kinds (machines/mod_mechanics.py has the same, number for number)
/** A solid's placement at frame k (a static one is listed only in the first frame). */
function _pl(ctx, k, sid) {
	const p = ctx.frames[k].placements[sid]
	return p !== undefined && p !== null ? p : ctx.frames[0].placements[sid] ?? null
}

/** The solid a goal about item iid follows: its part `part` when it has one, else its first moving solid that no weld holds (its main body). */
function _main(ctx, iid, part = null) {
	if (typeof part === "string" && part) {
		const s = ctx.doc.solids.find((x) => x.id === `${iid}/${part}`)
		if (s !== undefined) return s
	}
	return ctx.doc.solids.find((x) => x.item === iid && x.kind === "dynamic" && !("parent" in x && !("pivot" in x))) ?? null
}

const _label = (g, text) => g.label || text
const _nearest = (ctx, t) => {
	let k = 0
	for (let i = 1; i < ctx.times.length; i++) if (Math.abs(ctx.times[i] - t) < Math.abs(ctx.times[k] - t)) k = i
	return k
}
const _trim = (s) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s)

function goal_balanced(ctx, g) {
	if (!ctx.known(g.item)) return null
	const s = _main(ctx, g.item, g.part)
	if (s === null || _pl(ctx, 0, s.id) === null) return null
	let max_deg = ctx.num(g.max_deg)
	max_deg = max_deg === null ? 2.0 : max_deg
	let max_m = ctx.num(g.max_m)
	max_m = max_m === null ? 0.01 : max_m
	const p0 = _pl(ctx, 0, s.id)
	let moved = 0.0
	let turned = 0.0
	for (let k = 0; k < ctx.frames.length; k++) {
		const p = _pl(ctx, k, s.id)
		moved = py.pymax(moved, py.hypot(p.x - p0.x, p.y - p0.y))
		turned = py.pymax(turned, Math.abs(p.angle - p0.angle))
	}
	const deg = (turned * 180) / Math.PI
	return { label: _label(g, `${ctx.name(g.item)} stays balanced`), ok: moved <= max_m && deg <= max_deg, kind: "balanced", item: g.item, moved_m: py.pyRound(moved, 4), turned_deg: py.pyRound(deg, 2) }
}

function goal_loops(ctx, g) {
	if (!(ctx.known(g.item) && ctx.known(g.track))) return null
	const loop = (ctx.doc.processes ?? []).find((p) => p.kind === "mechanics" && p.role === "loop" && p.item === g.track) ?? null
	const s = _main(ctx, g.item)
	if (loop === null || s === null) return null
	const [cx, cy, R, entry, sense] = [loop.center.x, loop.center.y, loop.radius, loop.entry, loop.sense]
	const r = s.body.kind === "ball" ? s.body.radius : 0.0
	let prog = null
	let last = null
	let best = 0.0
	let fell = false
	for (let k = 0; k < ctx.frames.length; k++) {
		const p = _pl(ctx, k, s.id)
		const dx = p.x - cx
		const dy = p.y - cy
		const d = py.hypot(dx, dy)
		if (prog === null && d > 1.6 * R + 0.2) continue
		let a = sense * (Math.atan2(dy, dx) - entry)
		while (a > Math.PI) a -= 2 * Math.PI
		while (a <= -Math.PI) a += 2 * Math.PI
		if (prog === null) prog = a <= 0 || d <= R ? a : a + 2 * Math.PI
		else {
			let da = a - last
			while (da > Math.PI) da -= 2 * Math.PI
			while (da <= -Math.PI) da += 2 * Math.PI
			prog += da
		}
		last = a
		if (prog >= 0.0) {
			best = py.pymax(best, py.pymin(prog, 2 * Math.PI))
			if (0.5 * Math.PI <= prog && prog <= 1.5 * Math.PI && d < 0.8 * (R - r)) fell = true
		}
	}
	const ok = best >= 2 * Math.PI - 0.2 && !fell
	return { label: _label(g, `${ctx.name(g.item)} goes round the loop`), ok, kind: "loops", item: g.item, track: g.track, round_deg: py.pyRound((best * 180) / Math.PI, 1), fell_off: fell }
}

/** The part a turning goal follows by default: a gear train's last gear, else the item's main body. */
function _turn_part(ctx, iid) {
	for (const part of ["gear-c", "gear-b", "wheel", "drum"]) if (ctx.doc.solids.some((x) => x.id === `${iid}/${part}`)) return part
	return null
}

function goal_gear_speed(ctx, g) {
	if (!ctx.known(g.item)) return null
	const s = _main(ctx, g.item, py.truthy(g.part) ? g.part : _turn_part(ctx, g.item))
	const n = ctx.frames.length
	if (s === null || n < 3) return null
	const k0 = Math.floor(n / 2)
	const dt = ctx.times[n - 1] - ctx.times[k0]
	if (dt <= 0) return null
	const rpm = (((_pl(ctx, n - 1, s.id).angle - _pl(ctx, k0, s.id).angle) / dt) * 60) / (2 * Math.PI)
	const target = ctx.num(g.rpm)
	let tol = ctx.num(g.tol)
	tol = tol === null ? 0.1 : tol
	const way = g.direction === "clockwise" || g.direction === "counter-clockwise" ? g.direction : null
	let ok = Math.abs(rpm) > 0.5
	if (target !== null) ok = ok && Math.abs(Math.abs(rpm) - Math.abs(target)) <= tol * Math.abs(target)
	if (way === "clockwise") ok = ok && rpm < 0
	else if (way === "counter-clockwise") ok = ok && rpm > 0
	const what = target !== null ? ` at ${_trim(py.fmtF(target, 1))} rpm` : ""
	return { label: _label(g, `${ctx.name(g.item)} turns${what}${way ? " " + way : ""}`), ok, kind: "gear_speed", item: g.item, rpm: py.pyRound(rpm, 2) }
}

function goal_rises(ctx, g) {
	if (!ctx.known(g.item)) return null
	let part = g.part
	if (!py.truthy(part)) part = ["load", "load-mass"].find((q) => ctx.doc.solids.some((x) => x.id === `${g.item}/${q}`)) ?? null
	const s = _main(ctx, g.item, part)
	if (s === null) return null
	let least = ctx.num(g.min_m)
	least = least === null ? (ctx.items.get(g.item).type === "screw-jack" ? 0.01 : 0.05) : least
	const rise = _pl(ctx, ctx.frames.length - 1, s.id).y - _pl(ctx, 0, s.id).y
	return { label: _label(g, `${ctx.name(g.item)} lifts its load ${ctx.short_m(least)}`), ok: rise >= least, kind: "rises", item: g.item, rise_m: py.pyRound(rise, 4) }
}

/** {kind: "pulls_with", item, newtons, tol?}: a force meter's steady reading (machines/mod_mechanics.py goal_pulls_with): the median of its `newtons`
 *  from 0.2 s after the release, leaving out the frames under a tenth of its highest (a slack cord), within tol (5 %, at least 0.05 N). */
function goal_pulls_with(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const want = ctx.num(g.newtons)
	const vals = ctx.state(iid, "newtons")
	if (want === null || !vals || !vals.length) return null
	const rel = ctx.doc.release?.at ?? 0.5
	let xs = vals.filter((v, k) => k < ctx.times.length && ctx.times[k] >= rel + 0.2)
	const top = xs.length ? Math.max(...xs) : 0.0
	xs = xs.filter((v) => v >= 0.1 * top && v > 0).sort((a, b) => a - b)
	const got = !xs.length ? null : xs.length % 2 === 1 ? xs[Math.floor(xs.length / 2)] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2
	let tol = ctx.num(g.tol)
	tol = tol === null ? Math.max(0.05, 0.05 * Math.abs(want)) : tol
	return { label: _label(g, `${ctx.name(iid)} pulls with ${_trim(py.fmtF(want, 2))} N`), ok: got !== null && Math.abs(got - want) <= tol + 1e-9, kind: "pulls_with", item: iid, newtons_read: got === null ? null : py.pyRound(got, 4) }
}

/** The mean x velocity of a solid between the frames nearest t1 and t2, m/s. */
function _speed_x(ctx, sid, t1, t2) {
	const k1 = _nearest(ctx, t1)
	const k2 = _nearest(ctx, t2)
	const dt = ctx.times[k2] - ctx.times[k1]
	return dt <= 0 ? 0.0 : (_pl(ctx, k2, sid).x - _pl(ctx, k1, sid).x) / dt
}

function goal_recoils(ctx, g) {
	if (!(ctx.known(g.a) && ctx.known(g.b))) return null
	const A = _main(ctx, g.a)
	const B = _main(ctx, g.b)
	if (A === null || B === null) return null
	const rel = ctx.doc.release?.at ?? 0.5
	const va = _speed_x(ctx, A.id, rel + 0.15, rel + 0.35)
	const vb = _speed_x(ctx, B.id, rel + 0.15, rel + 0.35)
	// (a push apart starts from rest: neither is given a start speed, or the speeds say nothing about the push)
	const rest = !(ctx.doc.processes ?? []).some((p) => p.kind === "mechanics" && p.role === "start" && (p.item === g.a || p.item === g.b))
	let ok = rest && va * vb < 0 && Math.abs(va) >= 0.02 && Math.abs(vb) >= 0.02
	const ratio = Math.abs(vb) > 1e-9 ? Math.abs(va) / Math.abs(vb) : null
	const want = ctx.num(g.ratio)
	let tol = ctx.num(g.tol)
	tol = tol === null ? 0.1 : tol
	if (want !== null) ok = ok && ratio !== null && Math.abs(ratio - want) <= tol * want
	return { label: _label(g, `${ctx.name(g.a)} and ${ctx.name(g.b)} push apart`), ok, kind: "recoils", a: g.a, b: g.b, speed_a: py.pyRound(va, 4), speed_b: py.pyRound(vb, 4), ratio: ratio === null ? null : py.pyRound(ratio, 3), from_rest: rest }
}

function goal_accelerates(ctx, g) {
	if (!ctx.known(g.item)) return null
	const s = _main(ctx, g.item)
	const want = ctx.num(g.accel)
	if (s === null || want === null) return null
	const rel = ctx.doc.release?.at ?? 0.5
	const mine = new Set(ctx.doc.solids.filter((x) => x.item === g.item).map((x) => x.id))
	let hit = null
	for (const h of ctx.track.impacts ?? []) if (mine.has(h.a) !== mine.has(h.b) && h.t > rel + 0.05 && (hit === null || h.t < hit)) hit = h.t
	const end = hit === null ? rel + 1.5 : py.pymin(rel + 1.5, hit - 0.02)
	const ks = []
	for (let k = 0; k < ctx.times.length; k++) if (rel + 0.02 <= ctx.times[k] && ctx.times[k] <= end) ks.push(k)
	if (ks.length < 4) return null
	const p0 = _pl(ctx, ks[0], s.id)
	const pe = _pl(ctx, ks[ks.length - 1], s.id)
	const L = py.hypot(pe.x - p0.x, pe.y - p0.y)
	const [ux, uy] = L > 0 ? [(pe.x - p0.x) / L, (pe.y - p0.y) / L] : [1.0, 0.0]
	// least squares of d = v0·τ + (a/2)·τ² (through the first point)
	let s11 = 0.0
	let s12 = 0.0
	let s22 = 0.0
	let r1 = 0.0
	let r2 = 0.0
	for (const k of ks) {
		const p = _pl(ctx, k, s.id)
		const tau = ctx.times[k] - ctx.times[ks[0]]
		const dd = (p.x - p0.x) * ux + (p.y - p0.y) * uy
		const f1 = tau
		const f2 = 0.5 * tau * tau
		s11 += f1 * f1
		s12 += f1 * f2
		s22 += f2 * f2
		r1 += f1 * dd
		r2 += f2 * dd
	}
	const det = s11 * s22 - s12 * s12
	const a = det === 0 ? 0.0 : (s11 * r2 - s12 * r1) / det
	let tol = ctx.num(g.tol)
	tol = tol === null ? 0.1 : tol
	return { label: _label(g, `${ctx.name(g.item)} speeds up at ${_trim(py.fmtF(want, 2))} m/s²`), ok: Math.abs(a - want) <= tol * Math.abs(want), kind: "accelerates", item: g.item, a_mps2: py.pyRound(a, 4) }
}

function _median(xs) {
	const v = [...xs].sort((a, b) => a - b)
	const n = v.length
	return n === 0 ? null : n % 2 === 1 ? v[Math.floor(n / 2)] : (v[n / 2 - 1] + v[n / 2]) / 2
}
const _fmt_n = (v) => {
	const t = _trim(py.fmtF(v, 2))
	return t === "" || t === "-0" ? "0" : t
}

function goal_net_force(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const xs = ctx.state(iid, "f_net_x")
	const ys = ctx.state(iid, "f_net_y")
	const gy = ctx.state(iid, "f_gravity_y")
	if (!xs || !xs.length || !ys || !ys.length) return null
	const rel = ctx.doc.release?.at ?? 0.5
	const ks = []
	for (let k = 0; k < Math.min(xs.length, ys.length, ctx.times.length); k++) if (ctx.times[k] >= rel + 0.1) ks.push(k)
	const net = _median(ks.map((k) => py.hypot(xs[k], ys[k])))
	if (net === null) return null
	const weight = _median(ks.filter((k) => gy && k < gy.length).map((k) => Math.abs(gy[k]))) || 0.0
	let hi = ctx.num(g.at_most_n)
	const lo = ctx.num(g.at_least_n)
	const balanced = hi === null && lo === null
	if (balanced) hi = 0.02 * weight + 0.01
	const ok = (hi === null || net <= hi + 1e-9) && (lo === null || net >= lo - 1e-9)
	const text = balanced
		? `the forces on ${ctx.name(iid)} balance`
		: lo === null
			? `the net force on ${ctx.name(iid)} is at most ${_fmt_n(hi)} N`
			: hi === null
				? `the net force on ${ctx.name(iid)} is at least ${_fmt_n(lo)} N`
				: `the net force on ${ctx.name(iid)} is ${_fmt_n(lo)} to ${_fmt_n(hi)} N`
	return { label: _label(g, text), ok, kind: "net_force", item: iid, net_n: py.pyRound(net, 4), weight_n: py.pyRound(weight, 4) }
}

/** What an item's energy bars say at the end: [share of the energy it had to spend turned to heat and sound, heat J, energy to spend J], or null. */
function _energy_spent(ctx, iid) {
	const [ke, pe, se, heat, added] = ["e_kinetic", "e_potential", "e_spring", "e_heat", "e_added"].map((k) => ctx.state(iid, k))
	if (!(ke && ke.length && pe && pe.length && se && se.length && heat && heat.length && added && added.length)) return null
	const total = ke[ke.length - 1] + pe[pe.length - 1] + se[se.length - 1] + heat[heat.length - 1]
	const spend = total - Math.min(...pe)
	if (!(spend > 1e-9)) return null
	return [heat[heat.length - 1] / spend, heat[heat.length - 1], spend]
}

function goal_energy_kept(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const e = _energy_spent(ctx, iid)
	if (e === null) return null
	let tol = ctx.num(g.tol)
	tol = tol === null ? 0.05 : tol
	return { label: _label(g, `${ctx.name(iid)} keeps its energy`), ok: e[0] <= tol + 1e-12, kind: "energy_kept", item: iid, lost_pct: py.pyRound(100 * e[0], 3), heat_j: py.pyRound(e[1], 5) }
}

function goal_energy_to_heat(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const e = _energy_spent(ctx, iid)
	if (e === null) return null
	let want = ctx.num(g.at_least_pct)
	want = want === null ? 10.0 : want
	return { label: _label(g, `${ctx.name(iid)}'s energy turns to heat and sound`), ok: 100 * e[0] >= want - 1e-9, kind: "energy_to_heat", item: iid, lost_pct: py.pyRound(100 * e[0], 3), heat_j: py.pyRound(e[1], 5) }
}

// ---------------------------------------------------------------- the AI's plug-ins
const MACHINES = ["lever-kit", "wheel-and-axle", "block-and-tackle", "gear-train"]
const f2 = (v, d = 2) => (Number.isFinite(v) ? _trim(Number(v).toFixed(d)) : "?")
const cm = (m) => `${f2(m * 100, 1)} cm`
const kg = (m) => (m < 1 ? `${f2(m * 1000, 0)} g` : `${f2(m, 2)} kg`)

/** The engine-side numbers a module item resolved to (sim.resolved), with its props over its defaults. */
function _P(item, sim) {
	const T = TYPES?.[item?.type]
	const base = {}
	for (const p of T?.props ?? []) base[p.key] = p.default
	return { ...base, ...(sim?.resolved?.[item.id] ?? {}), ...(item.props ?? {}) }
}
function _track_of(sim, sid) {
	const fr = sim?.track?.frames ?? []
	if (!fr.length) return null
	const at = (k) => fr[k].placements?.[sid] ?? fr[0].placements?.[sid] ?? null
	if (!at(0)) return null
	return { first: at(0), last: at(fr.length - 1), at, frames: fr }
}

/** A force meter's steady reading in the run (goal pulls_with's median), or null. */
function _steady(sim, id) {
	const v = sim?.track?.state?.[id]?.newtons
	const fr = sim?.track?.frames ?? []
	if (!Array.isArray(v) || !v.length || !fr.length) return null
	const rel = sim?.doc?.release?.at ?? 0.5
	let xs = v.filter((x, k) => k < fr.length && fr[k].t >= rel + 0.2)
	const top = xs.length ? Math.max(...xs) : 0
	xs = xs.filter((x) => x >= 0.1 * top && x > 0).sort((a, b) => a - b)
	return xs.length ? (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2) : null
}

function digestLines(item, sim) {
	if (!item || typeof item !== "object") return null
	const P = _P(item, sim)
	const out = []
	const id = item.id
	switch (item.type) {
		case "lever-kit": {
			const tr = _track_of(sim, `${id}/beam`)
			const turned = tr ? (Math.abs(tr.last.angle - tr.first.angle) * 180) / Math.PI : null
			out.push(`class ${P.class} lever: load ${kg(P.load)} at ${cm(P.load_at)} from the fulcrum, effort ${kg(P.effort)} at ${cm(P.effort_at)}${P.class === "1" ? " on the other side" : P.class === "2" ? " (pulling up, further out than the load)" : " (pulling up, nearer than the load)"}; it balances with ${kg(P.balanced_by)} of effort there (load × distance = effort × distance${P.class === "1" ? "" : ", the beam's own weight counted"})${turned === null ? "" : `; the beam turned ${f2(turned, 1)}° in the run (it swings at most 20°)`}`)
			break
		}
		case "wheel-and-axle": {
			const tr = _track_of(sim, `${id}/load-mass`)
			out.push(`wheel ${cm(P.wheel_radius)} round an axle ${cm(P.axle_radius)}: mechanical advantage ${f2(P.advantage ?? P.wheel_radius / P.axle_radius)}; ${kg(P.balance_effort ?? (P.load * P.axle_radius) / P.wheel_radius)} on the wheel's cord balances the ${kg(P.load)} load (effort now ${kg(P.effort)})${tr ? `; the load ${tr.last.y >= tr.first.y ? "rose" : "fell"} ${cm(Math.abs(tr.last.y - tr.first.y))}` : ""}`)
			break
		}
		case "block-and-tackle": {
			const tr = _track_of(sim, `${id}/load`)
			out.push(`${P.strands} rope strands hold the moving block: mechanical advantage ${P.strands}; ${kg(P.balance_effort ?? (P.load + 0.05) / P.strands)} balances the ${kg(P.load)} load and its 50 g block (effort now ${kg(P.effort)}); the effort moves ${P.strands}× as far as the load${tr ? `; the load ${tr.last.y >= tr.first.y ? "rose" : "fell"} ${cm(Math.abs(tr.last.y - tr.first.y))}` : ""}`)
			break
		}
		case "gear-train": {
			const last = P.teeth_c > 0 ? "gear-c" : "gear-b"
			const tr = _track_of(sim, `${id}/${last}`)
			let rpm = null
			if (tr && tr.frames.length > 2) {
				const n = tr.frames.length
				const k0 = Math.floor(n / 2)
				const dt = tr.frames[n - 1].t - tr.frames[k0].t
				if (dt > 0) rpm = ((tr.at(n - 1).angle - tr.at(k0).angle) / dt) * (60 / (2 * Math.PI))
			}
			out.push(`gears of ${P.teeth_a}${P.teeth_b ? ` : ${P.teeth_b}` : ""}${P.teeth_c ? ` : ${P.teeth_c}` : ""} teeth; the first (the driver) turns at ${f2(P.rpm, 1)} rpm ${P.turns}; the last turns ${f2(P.last_rpm ?? NaN, 2)} rpm (speed × first teeth ÷ last teeth), ${P.last_turns ?? "?"} (each meshing pair turns opposite ways)${rpm === null ? "" : `; measured ${f2(Math.abs(rpm), 2)} rpm ${rpm < 0 ? "clockwise" : "counter-clockwise"}`}`)
			break
		}
		case "screw-jack": {
			const W = (P.load + (P.moving_mass ?? 2.3)) * 9.81
			const lift = sim?.track?.state?.[id]?.lift
			const rose = Array.isArray(lift) && lift.length ? lift[lift.length - 1] : null
			out.push(`screw: ${f2(P.pitch, 1)} mm a turn, handle ${cm(P.handle)}: ideal mechanical advantage 2π·L/pitch = ${f2(P.advantage ?? (2 * Math.PI * P.handle) / (P.pitch / 1000), 0)}; at ${f2(P.efficiency * 100, 0)} % efficiency a ${f2(P.effort, 1)} N push lifts up to ${f2(P.lift_force ?? 0, 0)} N (${kg((P.lift_force ?? 0) / 9.81 - (P.moving_mass ?? 2.3))} of load); the load is ${kg(P.load)} (${f2(W, 0)} N with its cap): ${P.lifts ? "it lifts" : "TOO HEAVY: it does not lift (a self-locking screw holds it where it is)"}, ${f2(P.turns * P.pitch, 1)} mm/s, at most ${cm(P.lift)}${rose === null ? "" : `; it rose ${f2(rose * 1000, 1)} mm in the run`}; the handle's end travels 2π·L = ${cm(2 * Math.PI * P.handle)} a turn for ${f2(P.pitch, 1)} mm of lift (force traded for distance)`)
			break
		}
		case "dynamics-cart": {
			const tr = _track_of(sim, `${id}/chassis`)
			let vmax = 0
			if (tr) for (let k = 1; k < tr.frames.length; k++) {
				const dt = tr.frames[k].t - tr.frames[k - 1].t
				if (dt > 0) vmax = Math.max(vmax, Math.abs(tr.at(k).x - tr.at(k - 1).x) / dt)
			}
			out.push(`total mass ${kg(P.total_mass ?? 0.25 + P.load)} (a 250 g cart with ${kg(P.load)} of bars); bumper ${P.bumper}${P.plunger > 0 ? `; spring plunger cocked at setting ${P.plunger} (it fires at the release and pushes what touches its front)` : ""}${tr ? `; fastest ${f2(vmax, 2)} m/s, momentum then ${f2(vmax * (P.total_mass ?? 0.25), 3)} kg·m/s` : ""}`)
			break
		}
		case "puller": {
			const n = _steady(sim, id)
			out.push(`${P.mode === "force" ? `pulls ${P.pulls ?? "nothing (no link)"} toward itself with a steady ${f2(P.force)} N` : `reels ${P.pulls ?? "nothing (no link)"} in at ${f2(P.speed)} m/s`}; its cord ${cm(P.height)} up${n === null ? "" : `; its force meter read ${f2(n, 2)} N while it pulled (the median: goal pulls_with)`}`)
			break
		}
		case "pusher":
			out.push(`${P.mode === "force" ? `pushes with ${f2(P.force)} N for ${f2(P.push_time)} s (impulse ${f2(P.force * P.push_time, 3)} N·s)` : `pushes at ${f2(P.speed)} m/s over ${cm(P.stroke)}`}${P.delay > 0 ? ` after ${f2(P.delay)} s` : ""}`)
			break
		case "edge-pulley": {
			const M = P.pulls ? sim?.resolved?.[P.pulls]?.total_mass ?? sim?.resolved?.[P.pulls]?.mass ?? null : null
			const n = _steady(sim, id)
			out.push(`a ${kg(P.hanging_mass)} hanging mass pulls ${P.pulls ?? "nothing (no link)"} over the pulley: its weight ${f2(P.hanging_mass * 9.81, 3)} N${Number.isFinite(M) ? `; with the ${kg(M)} cart a = m·g/(M + m) = ${f2((P.hanging_mass * 9.81) / (M + P.hanging_mass), 3)} m/s² (less a little rolling friction), the string pulling with M·a = ${f2((M * P.hanging_mass * 9.81) / (M + P.hanging_mass), 3)} N` : ""}${n === null ? "" : `; its force sensor read ${f2(n, 3)} N`}; it falls at most ${cm(P.drop)}`)
			break
		}
		case "coaster-track": {
			out.push(`${P.layout} track starting ${cm(P.height)} up${P.layout === "loop" ? `, loop radius ${cm(P.size)}: a rolling ball needs a start at least about 2.7 × the loop radius above the loop's bottom (${cm(P.least_height_marble ?? 2.7 * P.size)} here) to go round` : ""}; energy: speed at the bottom ≈ √(10/7 · g · drop) for a rolling ball, less a little lost`)
			break
		}
		case "ramp":
			out.push(`plank on ${P.blocks_used ?? P.blocks} wooden block${(P.blocks_used ?? P.blocks) === 1 ? "" : "s"}: rise ${cm(P.rise ?? 0.05 * P.blocks)}, slope ${f2(P.slope ?? NaN, 1)}°; it rises to the ${P.rises}${P.lip ? ", a small stop at its top holds a car until the release" : ""}`)
			break
		case "balloon-rocket": {
			const tr = _track_of(sim, `${id}/straw`)
			if (tr) out.push(`travelled ${cm(Math.abs(tr.last.x - tr.first.x))} along the string`)
			break
		}
		case "coffee-filters":
		case "parachute":
		case "paper-sheet":
		case "paper-ball":
		case "feather": {
			const part = { "coffee-filters": "filter", parachute: "load", "paper-sheet": "sheet", "paper-ball": "ball", feather: "feather" }[item.type]
			const tr = _track_of(sim, `${id}/${part}`)
			if (tr && tr.frames.length > 4) {
				let v = 0
				for (let k = 1; k < tr.frames.length; k++) {
					const dt = tr.frames[k].t - tr.frames[k - 1].t
					if (dt > 0) v = Math.max(v, (tr.at(k - 1).y - tr.at(k).y) / dt)
				}
				out.push(`fastest fall ${f2(v, 2)} m/s (air resistance: it stops speeding up at its terminal speed)`)
			}
			break
		}
		case "egg": {
			if (P.fragile !== true) break
			const st = sim?.track?.state?.[id]
			const peak = Array.isArray(st?.peak) && st.peak.length ? st.peak[st.peak.length - 1] : null
			const broke = Array.isArray(st?.broken) && st.broken.some((v) => v >= 0.5)
			out.push(`fragile: it breaks at a peak force over 35 N; ${peak === null ? "no landing yet" : `peak ${f2(peak, 1)} N: ${broke ? "it BROKE" : "it survived"}`}`)
			break
		}
	}
	if (Number(P.start_speed) > 0) out.push(`starts moving at ${f2(P.start_speed)} m/s at the release, ${f2(P.start_dir ?? 0, 0)}° from the way it faces${P.start_spin === "none" ? ", not spinning" : ""}`)
	if (item.type === "energy-bars") out.push(`shows the energy of ${typeof P.watch === "string" ? P.watch : "nothing (link watch to a moving thing)"}: kinetic, potential (counted from ${P.zero === "floor" ? "the floor" : "the lowest point it reaches"}), spring, heat and sound`)
	const fl = forceLine(id, sim, P)
	if (fl) out.push(fl)
	const el = energyLine(id, sim)
	if (el) out.push(el)
	return out.length ? out : null
}

/** Which way a force points, in words: up, down, left, right, or between two of them. */
function _way(x, y) {
	const ax = Math.abs(x)
	const ay = Math.abs(y)
	if (ay >= 2 * ax) return y >= 0 ? "up" : "down"
	if (ax >= 2 * ay) return x >= 0 ? "right" : "left"
	return `${y >= 0 ? "up" : "down"} and ${x >= 0 ? "right" : "left"}`
}
const FORCE_WORDS = { gravity: "gravity", support: "support", push: "push", friction: "friction", tension: "pull of a rope", spring: "spring", air: "air", buoyancy: "buoyancy", magnetic: "magnetic", applied: "applied", net: "net" }
/** An item's forces at frame k (its force arrows' numbers): "gravity 6.38 N down, support 6.36 N up, ...", the kinds over 0.5 % of the largest. */
function _forcesAt(st, k) {
	const parts = []
	let top = 0
	for (const kind of FORCE_KINDS) if (kind !== "net") top = Math.max(top, Math.hypot(st[`f_${kind}_x`]?.[k] ?? 0, st[`f_${kind}_y`]?.[k] ?? 0))
	for (const kind of FORCE_KINDS) {
		if (kind === "net") continue
		const x = st[`f_${kind}_x`]?.[k] ?? 0
		const y = st[`f_${kind}_y`]?.[k] ?? 0
		const m = Math.hypot(x, y)
		if (m > 1e-4 && m >= 0.005 * top) parts.push(`${FORCE_WORDS[kind]} ${f2(m, m < 1 ? 3 : 2)} N ${_way(x, y)}`)
	}
	const nx = st.f_net_x?.[k] ?? 0
	const ny = st.f_net_y?.[k] ?? 0
	const nm = Math.hypot(nx, ny)
	return `${parts.join(", ") || "none"}; net ${f2(nm, 3)} N${nm > 1e-3 ? ` ${_way(nx, ny)}` : " (balanced)"}`
}
/** The digest's force line (an item with force arrows or a net_force goal: its forces record's readings), or null. */
function forceLine(id, sim, P) {
	const st = sim?.track?.state?.[id]
	const fr = sim?.track?.frames ?? []
	if (!st || !Array.isArray(st.f_net_x) || !fr.length) return null
	const rel = sim?.doc?.release?.at ?? 0.5
	let k0 = fr.findIndex((f) => f.t >= rel + 0.05)
	if (k0 < 0) k0 = fr.length - 1
	const kinds = _arrow_kinds(P.arrows)
	const ropes = Object.keys(st).filter((k) => /^f_(tension|spring)\d+_x$/.test(k)).length
	return `forces on it (N, from the run${kinds.length ? `; its arrows show ${kinds.join(", ")}` : ""}): just after the release ${_forcesAt(st, Math.min(k0, st.f_net_x.length - 1))}; at the end ${_forcesAt(st, st.f_net_x.length - 1)}${ropes ? ` (${ropes} ropes or springs pull it, each its own arrow)` : ""}`
}
/** The digest's energy line (an item with energy bars, on an energy-bars board, or with an energy goal), or null. */
function energyLine(id, sim) {
	const st = sim?.track?.state?.[id]
	if (!st || !Array.isArray(st.e_kinetic) || !st.e_kinetic.length) return null
	const n = st.e_kinetic.length - 1
	const j = (v) => `${f2(v, Math.abs(v) < 0.1 ? 4 : 3)} J`
	const pe = st.e_potential
	const low = Math.min(...pe)
	const total = st.e_kinetic[n] + pe[n] + st.e_spring[n] + st.e_heat[n]
	const spend = total - low
	const lost = spend > 1e-9 ? (100 * st.e_heat[n]) / spend : 0
	// (just after the release: a start speed is given at the release, so the frame before it reads no kinetic energy)
	const fr = sim?.track?.frames ?? []
	const rel = sim?.doc?.release?.at ?? 0.5
	let k0 = fr.findIndex((f) => f.t > rel + 1e-9)
	if (k0 < 0 || k0 > n) k0 = n
	return `energy (J; potential counted from the lowest point it reaches): just after the release kinetic ${j(st.e_kinetic[k0])}, potential ${j(pe[k0] - low)}, spring ${j(st.e_spring[k0])}; at the end kinetic ${j(st.e_kinetic[n])}, potential ${j(pe[n] - low)}, spring ${j(st.e_spring[n])}, heat and sound ${j(st.e_heat[n])} (${f2(lost, 1)} % of the ${j(spend)} it had to spend)${st.e_added[n] > 1e-6 ? `, put in ${j(st.e_added[n])} (a push, a motor or a falling weight)` : ""}; the most kinetic ${j(Math.max(...st.e_kinetic))}`
}

function changeWords(type, key, a, b) {
	const T = TYPES?.[type]
	const def = (T?.props ?? []).find((p) => p.key === key)?.default
	const A = a ?? def
	const B = b ?? def
	if (key === "color") return `colour ${A ?? "none"} → ${B ?? "none"}`
	if (key === "glow") return `glow ${A ? "on" : "off"} → ${B ? "on" : "off"}`
	if (key === "start_speed") return `start speed ${f2(A ?? 0)} → ${f2(B ?? 0)} m/s`
	if (key === "start_dir") return `start direction ${f2(A ?? 0, 0)}° → ${f2(B ?? 0, 0)}°`
	if (key === "fragile") return `breaks when it lands hard: ${A ? "yes" : "no"} → ${B ? "yes" : "no"}`
	if (key === "arrows") return `force arrows ${A ?? "none"} → ${B ?? "none"}`
	if (key === "arrow_scale") return `arrow length ${Number(A) > 0 ? `${f2(A * 100, 1)} cm per N` : "auto"} → ${Number(B) > 0 ? `${f2(B * 100, 1)} cm per N` : "auto"}`
	if (key === "show_energy") return `energy bars ${A ? "on" : "off"} → ${B ? "on" : "off"}`
	if (T?.module !== "mechanics") return null
	const kgw = (v) => (Number.isFinite(v) ? kg(v) : "?")
	switch (`${type}.${key}`) {
		case "ramp.blocks": return `ramp on ${A} → ${B} block${B === 1 ? "" : "s"}, rise ${cm(0.05 * A)} → ${cm(0.05 * B)}`
		case "dynamics-cart.load": return `bars on the cart ${kgw(A)} → ${kgw(B)}, the cart ${kgw(0.25 + A)} → ${kgw(0.25 + B)} in all`
		case "dynamics-cart.plunger": return `plunger setting ${A} → ${B}`
		case "dynamics-cart.bumper": return `bumper ${A} → ${B}`
		case "lever-kit.class": return `class ${A} → ${B} lever`
		case "gear-train.teeth_a": return `first gear ${A} → ${B} teeth`
		case "gear-train.teeth_b": return `second gear ${A} → ${B} teeth`
		case "gear-train.teeth_c": return `third gear ${A ? `${A} teeth` : "none"} → ${B ? `${B} teeth` : "none"}`
		case "gear-train.rpm": return `driver ${f2(A, 1)} → ${f2(B, 1)} rpm`
		case "block-and-tackle.strands": return `${A} → ${B} rope strands, mechanical advantage ${A} → ${B}`
		case "coaster-track.height": return `start height ${cm(A)} → ${cm(B)}`
		case "coaster-track.size": return `loop radius ${cm(A)} → ${cm(B)}`
		case "coaster-track.layout": return `track ${A} → ${B}`
		case "coffee-filters.count": return `${A} → ${B} nested filter${B === 1 ? "" : "s"}`
		case "parachute.canopy": return `canopy ${cm(A)} → ${cm(B)} across`
		case "balloon-rocket.pressure": return `balloon pressure ${f2(A, 0)} → ${f2(B, 0)} Pa`
		case "balloon-rocket.nozzle": return `balloon neck ${f2(A * 1000, 1)} → ${f2(B * 1000, 1)} mm`
		case "edge-pulley.hanging_mass": return `hanging mass ${kgw(A)} → ${kgw(B)}`
		case "puller.force": case "pusher.force": return `force ${f2(A)} → ${f2(B)} N`
		case "pusher.push_time": return `push time ${f2(A)} → ${f2(B)} s`
		case "puller.speed": return `reels in at ${f2(A)} → ${f2(B)} m/s`
		case "puller.mode": return `pulls with a set ${A === "speed" ? "speed" : "force"} → a set ${B === "speed" ? "speed" : "force"}`
		case "screw-jack.pitch": return `thread pitch ${f2(A, 1)} → ${f2(B, 1)} mm a turn`
		case "screw-jack.handle": return `handle ${cm(A)} → ${cm(B)}`
		case "screw-jack.effort": return `push on the handle ${f2(A, 1)} → ${f2(B, 1)} N`
		case "screw-jack.turns": return `${f2(A, 1)} → ${f2(B, 1)} turns a second`
		case "screw-jack.efficiency": return `efficiency ${f2(A * 100, 0)} → ${f2(B * 100, 0)} %`
		case "screw-jack.lift": return `stroke ${cm(A)} → ${cm(B)}`
		case "energy-bars.zero": return `potential energy counted from ${A === "floor" ? "the floor" : "its lowest point"} → ${B === "floor" ? "the floor" : "its lowest point"}`
		case "energy-bars.watch": return `energy bars show ${A ?? "nothing"} → ${B ?? "nothing"}`
	}
	if (["load", "effort", "beam_mass", "load_mass", "mass", "hanging_mass", "wheel_mass"].includes(key)) return `${key.replace(/_/g, " ")} ${kgw(A)} → ${kgw(B)}`
	if (["load_at", "effort_at", "wheel_radius", "axle_radius", "length", "drop", "height", "diameter", "string", "size", "run"].includes(key) && Number.isFinite(A) && Number.isFinite(B))
		return `${key.replace(/_at$/, " from the fulcrum").replace(/_/g, " ")} ${cm(A)} → ${cm(B)}`
	return null
}

const HOWTO = [
	"ANY ITEM (catalog-wide props): color (none, red, blue, green, yellow, orange, purple, pink, white, black, gray, brown: the look only; a car's or truck's body, not its tyres), glow (true: a soft halo to point it out), and for every moving item start_speed (m/s it already has at the release, a push, kick or launch), start_dir (degrees from the way it faces, counter-clockwise: 0 forward, 180 back, 90 up) and start_spin (\"roll\": balls and wheels already turning as if rolling). Cars and trucks face right (+x) at angle 0. An egg with props {fragile: true} cracks if it lands hard (peak force over 35 N: about 7 cm or more onto a table breaks it, 80 cm onto a 10 cm foam block does not); goals breaks / survives.",
	"FLOORS, RAMPS, SURFACES: floor (a long ground slab, length up to 60 m, its anchor the middle of its top; material varnished hardwood (gym), concrete, carpet, rubber mat, grass, ice: friction lessons race the same car over different floors). ramp: a plank on `blocks` stacked wooden blocks (5 cm each: blocks 1 vs 3 = rise 5 vs 15 cm), `length` (m), rises \"left\" (default: the top is length·cos(slope) to the LEFT of its anchor, the foot at the anchor) or \"right\"; lip true keeps a small stop at the top. A car or cart on a ramp: place {on: <ramp id>, x: the top end + half the car's length + 0.03} (the top end is at the ramp's x − length when it rises left, x + length when it rises right; a 20 cm toy car on a ramp at x 1.0 rising left: x 0.13); it is turned to lie along the slope and rolls down at the release. Put the ramp on the floor item or the table (place {on: <floor id>}); give a floor item an id other than \"floor\", \"ground\" or \"table\" (e.g. \"gym-floor\"): place.on \"floor\" means the table. A FAIR TEST of ramp height (1 block vs 3 blocks, the Grade 3 'is this a valid experiment?'): one long carpet floor (length 8: the table alone is too short, its end walls stop the cars), both ramps rising left (the default) so both cars roll right, the 3-block ramp's foot 2.4 m right of the 1-block ramp's (on carpet a toy car rolls about 1 m past a 1-block ramp and 2.5 m past a 3-block one, so the first stops before the second ramp; on wood 3 m and 11 m), the same car (same colour, same clay) on each, only the blocks differ; goal farther {a: the 3-block car, b: the 1-block car} (farther measures the distance along +x).",
	"FORCES AND MOTION: dynamics-cart (a 250 g lab cart: load = kg of bars added, plunger 0-3 = a cocked spring that fires at the release, bumper plain/spring/magnet/velcro/clay: magnet carts bounce apart, velcro and clay stick). puller (a winch on the floor, link pulls = the thing its cord is tied to; mode force: a steady force in N (balanced pulls: two pullers facing each other, equal forces, the cart stays put); faces left/right = the way its cord leaves it; height (3 cm up) = the cord's height: near the pulled thing's middle, the default for a cart; set it 1-2 m away). pusher (a paddle: force N for push_time s, or a speed over a stroke). edge-pulley: clamp it at the table's right end (its anchor = the pulley's axle, place {on: \"air\", x: the table's right end + 0.04, y_m: 0.016}: the wheel's top level with a dynamics cart's string), link pulls = the cart on the table, hanging_mass falls and pulls it: a = m·g/(M + m) (F = ma; double the cart's mass with load, the acceleration halves). Two carts pushing apart: a plunger cart and a second cart touching its front (left_of/right_of with align touching), the lighter one leaves faster: v_a/v_b = m_b/m_a (goal recoils {a, b, ratio}).",
	"FORCE METERS AND SENSORS (readings in the run, shown in the digest): a puller's `newtons` is the pull in its cord (a force meter); in mode speed it reels in at its set speed, so its reading is the force that takes: pulling a cart UP A RAMP at a steady 0.1 m/s reads m·g·sin(slope), less than lifting it straight up (m·g) (stand the puller on the floor just past the ramp's top end, faces right when the cart is down to its right, its height (the drum's, up to 1 m) on the slope's line there so the cord runs along it). An edge-pulley's `newtons` is the string's pull on the cart (a force sensor: T = M·a, less than the hanging weight). A dynamics-cart reads its own speed (m/s, + forward) and accel (m/s²): F = M·a with the string's pull. Goal pulls_with {item: the puller or edge pulley, newtons, tol?}: its steady reading; measure's reads {item, newtons} reads the end value.",
	"SIMPLE MACHINES (the lever, wheel and axle, block and tackle and gears hang in the air: place {on: \"air\", y_m}; their stands are drawn; the screw jack stands on the table or floor): lever-kit (class 1, 2 or 3; load kg at load_at m from the fulcrum, effort kg at effort_at m; its masses hang 25 cm under the beam: y_m about 0.6; balances when load × load_at = effort × effort_at, resolved balanced_by says the effort that balances). wheel-and-axle (wheel_radius, axle_radius: MA = R/r; load on the axle's cord, effort on the wheel's; y_m about 1.4 with drop 0.4). block-and-tackle (strands 2-4 = MA; effort = (load + 0.05 kg block) / strands balances; y_m about 1.6). screw-jack (stands on the floor or table: a handle turning a screw lifts a heavy load on its cap a pitch a turn: load kg, effort N at the handle's end, handle m, pitch mm, turns a second, efficiency (0.3); it lifts when efficiency × effort × 2π·handle/pitch > the load's weight: 10 N on a 20 cm handle with a 5 mm thread lifts up to about 75 kg, at 5 mm/s: give the scene seconds 6-10; goal rises {item} (1 cm by default)). gear-train (teeth_a drives at rpm, teeth_b and teeth_c (0 = only two gears): the last gear turns rpm × teeth_a ÷ teeth_last, each pair turning opposite ways; place in the air at a visible height, y_m about 0.5). Goals: balanced {item} (it holds still), rises {item, min_m?} (its load goes up), gear_speed {item, rpm?, direction?} (a gear train's last gear).",
	"ROLLER COASTER (coaster-track: layout curved ramp, valley, hill or loop; height = the start's height (m), size = the loop's radius; its anchor is the floor under the start and it runs to the right). Put the ball (steel-ball, glass-marble) at the start: place {on: <track id>, x: track x + 0.03}; it rolls at the release. Energy: a rolling ball needs a start about 2.7 × the loop radius above the loop's bottom to go round (height 0.45 m for a 15 cm loop just goes round; 0.35 m falls off). Goal loops {item, track}.",
	"FALLING AND AIR: coffee-filters (count nested: terminal speed about 1 m/s × √count), parachute (canopy m across, load_mass kg: a bigger canopy, a slower fall), paper-sheet (falls slowly flat) vs paper-ball (the same 5 g crumpled, falls fast), feather. Drop them held at the same height (held: true, place {on: \"air\", y_m}) so they let go together. Vacuum or the Moon: scene settings {air: false} (and gravity \"moon\"): a feather and a hammer land together.",
	"FORCE ARROWS AND ENERGY BARS (any moving item; from the run, so they are true to it): arrows (\"all\", \"net\", \"all+net\", or kinds joined by +: gravity, support (what it rests on pushing up), push (a wall, a paddle, a collision), friction, tension (ropes, cords, strings: each its own arrow when two or more pull it, a tug of war's two pulls), spring, air (resistance, or a fan's wind), buoyancy (water's and air's lift), magnetic, applied (a jet, a motor's push)); arrow_scale m of arrow per N (0 auto: the scene's biggest force about the thing's size). A free-body diagram of a book on the table: hardcover-book arrows \"gravity+support\" (equal and opposite: net 0); balanced and unbalanced pulls: a dynamics-cart between two pullers, arrows \"tension+net\" (or \"all+net\"); goal net_force {item, at_most_n?, at_least_n?} (with neither: its forces balance, net under 2 % of its weight). show_energy true draws small bars over the item; an energy-bars board (placed behind the scene, e.g. {on: \"air\", y_m: 1.0} beside the action, link watch = the moving thing; zero lowest (default) or floor) draws them large: kinetic, potential, spring, heat and sound; the total stays the start's. Goals energy_kept {item, tol?} (at most tol, 5 %, of the energy it had to spend turned to heat: a pendulum in a vacuum, settings {air: false}) and energy_to_heat {item, at_least_pct?} (10 %: a ball rolling to a stop on carpet, a bounce dying away).",
	"ACTION AND REACTION, COLLISIONS: balloon-rocket (a balloon on a straw on a string `string` m long running from its anchor to the right, 1 m up: let go, it rushes forward; pressure Pa, nozzle m). clay-lump (sticks to the first moving thing it touches: drop it on a rolling cart to show momentum shared). Carts that collide: give one start_speed toward the other (velcro bumpers stick: they move on together at half the speed; magnet bumpers swap speeds)."
].join("\n")

const PROMPT_PLAN = [
	"- Force and motion lessons: use the module's lab gear (dynamics-cart, puller, pusher, edge-pulley, ramp, floor) rather than building them from parts; moving things get start_speed (and start_dir) for a push or a kick that is already done at the release.",
	"- Different masses: the same item type with different masses (dynamics-cart load, truck body_mass) and different colours so the card can tell them apart (color red / blue).",
	"- Simple machines (lever-kit, wheel-and-axle, block-and-tackle, gear-train) go on \"air\" with y_m high enough that what hangs from them clears the table (lever 0.6, wheel and axle 1.4, block and tackle 1.6). Choose the effort from the rule (lever: effort × effort_at = load × load_at; wheel and axle: effort = load × axle/wheel; tackle: (load + 0.05)/strands) and say it in the goal.",
	"- Goals: balanced {item}, rises {item, min_m?}, gear_speed {item, part?, rpm?, direction?}, loops {item, track}, recoils {a, b, ratio?} (two carts pushing apart), accelerates {item, accel, tol?} (accel in m/s²), pulls_with {item, newtons, tol?} (a puller's or edge pulley's force meter while it pulls); for a fragile egg breaks {item} / survives {item}, for clay or velcro carts sticks {item, to}.",
	"- Forces you can see: give the moving item arrows (\"all\", \"all+net\", \"gravity+support\"...) when a lesson is about the forces on it (a free-body diagram, balanced or unbalanced forces, friction, air resistance, floating); goal net_force {item} for balanced forces, {item, at_least_n} for unbalanced. Energy lessons (kinetic and potential energy, energy changes form, a pendulum, a roller coaster, friction turning motion to heat): show_energy true on the moving item and/or an energy-bars board linked to it (watch); goals energy_kept {item} / energy_to_heat {item}.",
	"- A screw (screw-jack) is the simple machine for \"a screw lifts a heavy load\" (an inclined plane wrapped round a rod); an inclined plane with a force meter is a ramp, a dynamics-cart and a puller in mode speed pulling it up (goal pulls_with)."
].join("\n")
const PROMPT_EDIT = [
	"- Say a machine change with its numbers (\"effort 0.25 → 0.3 kg\", \"2 → 3 strands\", \"middle gear 36 → 24 teeth\", \"ramp on 1 → 3 blocks\"). A heavier cart: dynamics-cart load (kg of bars). \"Faster\" for something already moving is its start_speed.",
	"- Moving a lever's weight is load_at / effort_at (m from the fulcrum), never the item's x.",
	"- \"Show the forces\" / \"add arrows\" is the item's arrows prop (\"all\" or the kinds named, \"+net\" for the net force); \"bigger arrows\" is arrow_scale (m per N, e.g. 0.02 → 0.04); \"show its energy\" is show_energy true or an energy-bars board linked to it (watch). The digest's force and energy lines say the run's numbers in N and J: quote them."
].join("\n")
const PROMPT_REFINE = "- Mechanics: a lever that tips needs effort × effort_at = load × load_at (resolved balanced_by); a loop the ball falls off needs a higher start (coaster height ≥ 2.7 × size above the bottom); a cart that does not reach needs more start_speed or a steeper ramp (more blocks). net_force that is not balanced: make the opposing forces equal (two pullers' force); energy_kept that fails: take the air away (settings air false) or a smoother surface; energy_to_heat that fails: a rougher surface (carpet), more distance or time."

export const EXAMPLES = [
	{ ask: "Show a first-class lever in balance: a 0.5 kg load 20 cm from the fulcrum and a 0.25 kg weight 40 cm on the other side.", how: "lever-kit class 1, load 0.5, load_at 0.2, effort 0.25, effort_at 0.4 on air y_m 0.6; goal balanced {item: lever}" },
	{ ask: "A wheel and axle lifts a 1 kg load with a smaller weight on the wheel.", how: "wheel-and-axle wheel_radius 0.15, axle_radius 0.03 (MA 5), load 1, effort 0.25 on air y_m 1.4; goal rises {item}" },
	{ ask: "A pulley system with 3 strands lifts a 1 kg load.", how: "block-and-tackle strands 3, load 1, effort 0.5 on air y_m 1.6; goal rises" },
	{ ask: "Two gears: a 12-tooth gear drives a 36-tooth gear; the big one turns a third as fast the other way.", how: "gear-train teeth_a 12, teeth_b 36, teeth_c 0, rpm 30 on air y_m 0.5; goal gear_speed {item, rpm: 10, direction: clockwise}" },
	{ ask: "A marble rolls down a roller-coaster track and goes round the loop.", how: "coaster-track layout loop height 0.6 size 0.15 on the table; steel-ball on the track at its start (x + 0.03); goal loops {item: ball, track}" },
	{ ask: "Two carts push apart: a 0.25 kg cart with a spring plunger and a 0.5 kg cart.", how: "floor; dynamics-cart plunger 3 (red); dynamics-cart load 0.25 (blue) right_of it, align touching; goal recoils {a, b, ratio: 2}" },
	{ ask: "Newton's second law: a 50 g hanging mass pulls a 0.5 kg cart across the table.", how: "dynamics-cart load 0.25 on the table near its left end; edge-pulley at the table's right end, pulls the cart, hanging_mass 0.05; goal accelerates {item: cart, accel: 0.89}" },
	{ ask: "Roll a car down a ramp on 1 block and on 3 blocks: which goes farther?", how: "carpet floor length 8 on the table; ramp blocks 1 at x 1.0 and ramp blocks 3 at x 3.4 on the floor (both rising left); the same red toy-car near each top (on: ramp); a clay-lump on each car if asked (on: car); goal farther {a: the 3-block car, b: the 1-block car}" },
	{ ask: "Drop one coffee filter and four nested ones from 2 m.", how: "coffee-filters count 1 and count 4, held at y_m 2.0; goal lands_first {a: four, b: one}" },
	{ ask: "Drop an egg onto the table and one onto a foam block.", how: "two eggs with fragile true held 0.8 m up; foam-block under one; goals breaks / survives" },
	{ ask: "A balloon rocket zooms along a string.", how: "balloon-rocket string 3 on the table's left; goal moves {item, min_m: 1}" },
	{ ask: "Show that a screw jack lets a small push lift a heavy weight.", how: "screw-jack load 50, effort 10, handle 0.2, pitch 5 on the table; seconds 8; goal rises {item}" },
	{ ask: "Pull a cart up a ramp with a force meter: it takes less force than lifting it.", how: "floor, ramp blocks 8 length 1 (lip false), dynamics-cart load 0.75 on the ramp's middle; puller mode speed 0.1, faces right, on the floor just past the ramp's top with height putting its drum on the slope's line, pulls the cart; goal pulls_with {item: puller, newtons: 4.2, tol: 0.4}" },
	{ ask: "Measure the pull in the string of an F = ma cart with a force sensor.", how: "dynamics-cart load 0.25 on the table, edge-pulley hanging_mass 0.05 at the table's right end pulling it; goals accelerates {item: cart, accel: 0.85} and pulls_with {item: pulley, newtons: 0.45}" },
	{ ask: "A tug of war: 5 N against 3 N on a cart. Which way does it go? And with equal pulls?", how: "floor; dynamics-cart load 0.75; pullers left (faces right, force 5) and right (faces left, force 3) 1 m either side, both pulls the cart; goal accelerates or moves toward the 5 N side; equal forces: balanced {item: cart}" },
	{ ask: "Drop a hammer and a feather on the Moon.", how: "settings gravity moon, air false; a steel weight and a feather held 1.6 m up side by side; goal lands_together {a: hammer, b: feather}" },
	{ ask: "Show the forces on a book resting on a table: gravity pulls it down and the table pushes it up just as hard.", how: "hardcover-book on the table, props {arrows: \"gravity+support\"} (arrows label each force in N); goal net_force {item: book} (balanced)" },
	{ ask: "Balanced and unbalanced forces: a tug of war on a cart, 5 N against 3 N, then 5 N against 5 N.", how: "floor; dynamics-cart load 0.75 with arrows \"tension+net\"; puller left (faces right, force 5) and right (faces left, force 3 or 5), both pulls the cart; goal net_force {item: cart, at_least_n: 1.5} (unbalanced: it moves toward the 5 N) or net_force {item: cart} (balanced: it stays)" },
	{ ask: "A pendulum swings: show its kinetic and potential energy trading back and forth.", how: "pendulum on air y_m 1.5 with show_energy true; an energy-bars board beside it ({on: \"air\", y_m: 1.0}, watch: the pendulum); settings air false to keep it all (goal energy_kept {item: pendulum}) or air on to watch a little turn to heat" },
	{ ask: "A ball rolls down a ramp onto carpet and stops: where did its energy go?", how: "carpet floor; ramp blocks 3; steel-ball at the ramp's top (on: ramp) with show_energy true; energy-bars board watching it; goal energy_to_heat {item: ball, at_least_pct: 90}" },
	{ ask: "Show the forces on a parachute falling at a steady speed.", how: "parachute held 2 m up (on air), arrows \"gravity+air+net\"; seconds 3; at terminal speed the air's push equals gravity: goal net_force {item: parachute} with the release early" },
	{ ask: "Two carts with velcro bumpers collide and stick.", how: "floor; dynamics-cart bumper velcro (red) with start_speed 0.5 toward a second velcro cart at rest (blue) 0.5 m away; goal sticks {item: a, to: b}" },
	{ ask: "Put a lump of clay on a toy car and roll it down a ramp: does the clay ride along?", how: "floor, ramp blocks 3, toy-car on the ramp's top, clay-lump place {on: car}; goal moves {item: car}; the clay sticks to the car" },
	{ ask: "Does a bigger parachute fall slower?", how: "two parachutes canopy 0.3 and 0.6, load_mass 0.05, held at y_m 2; goal lands_first {a: small, b: big}" }
]

const _sample_item = (scene, pick, types) => {
	const xs = scene.items.filter((i) => types.includes(i.type))
	return xs.length ? pick(xs) : null
}

export const plugin = {
	title: "Machines and motion (mechanics): forces, force arrows (free-body diagrams) and energy bars",
	howto: HOWTO,
	prompt: { plan: PROMPT_PLAN, edit: PROMPT_EDIT, refine: PROMPT_REFINE },
	examples: EXAMPLES,
	goals: [
		{
			kind: "balanced", aliases: ["balances", "balance", "in_balance", "stays_level", "holds_still"], fields: { item: "item", part: "string?", max_deg: "number?", max_m: "number?" },
			about: "balanced {item, part?, max_deg?, max_m?}: its main moving part (a lever's beam, a wheel and axle's wheel, a tackle's load, a pulled cart) moves less than max_m (1 cm) and turns less than max_deg (2°) all run: the forces or turning effects balance",
			label: (g, n) => `${n(g.item)} stays balanced`,
			summarize: (ctx, g) => goal_balanced(ctx, g),
			sample: (scene, pick) => {
				const it = _sample_item(scene, pick, ["lever-kit", "wheel-and-axle", "block-and-tackle", "dynamics-cart"])
				return it ? { kind: "balanced", item: it.id, ...(pick([true, false]) ? { max_deg: pick([1, 5]) } : {}) } : null
			}
		},
		{
			kind: "loops", aliases: ["loop", "loops_the_loop", "goes_round_the_loop"], fields: { item: "item", track: "item" },
			about: "loops {item, track}: the ball (or car) goes all the way round the coaster track's loop without falling off at the top",
			label: (g, n) => `${n(g.item)} goes round the loop`,
			summarize: (ctx, g) => goal_loops(ctx, g),
			sample: (scene, pick) => {
				const tr = _sample_item(scene, pick, ["coaster-track"])
				const it = scene.items.find((i) => F.TYPES[i.type]?.dynamic)
				return tr && it ? { kind: "loops", item: it.id, track: tr.id } : null
			}
		},
		{
			kind: "gear_speed", aliases: ["turns_at", "gear_turns", "gear_rpm", "turns_at_rpm"], fields: { item: "item", part: "string?", rpm: "number?", tol: "number?", direction: "string?" },
			about: "gear_speed {item, part?, rpm?, tol?, direction?}: its part (a gear train's last gear by default) turns, over the run's second half, at rpm (within tol, 10 %) and/or \"clockwise\" / \"counter-clockwise\"",
			label: (g, n) => `${n(g.item)} turns${Number.isFinite(g.rpm) ? ` at ${g.rpm} rpm` : ""}${g.direction ? ` ${g.direction}` : ""}`,
			summarize: (ctx, g) => goal_gear_speed(ctx, g),
			sample: (scene, pick) => {
				const it = _sample_item(scene, pick, ["gear-train", "wheel-and-axle"])
				return it ? { kind: "gear_speed", item: it.id, ...(pick([true, false]) ? { rpm: pick([10, 18, 30]) } : {}), ...(pick([true, false]) ? { direction: pick(["clockwise", "counter-clockwise", "sideways"]) } : {}) } : null
			}
		},
		{
			kind: "rises", aliases: ["lifts_load", "raises", "raises_load", "load_rises"], fields: { item: "item", part: "string?", min_m: "number?" },
			about: "rises {item, part?, min_m?}: its load (a wheel and axle's, a block and tackle's, a lever's, a screw jack's) ends at least min_m (5 cm; a screw jack's 1 cm) higher than it started",
			label: (g, n) => `${n(g.item)} lifts its load`,
			summarize: (ctx, g) => goal_rises(ctx, g),
			sample: (scene, pick) => {
				const it = _sample_item(scene, pick, ["wheel-and-axle", "block-and-tackle", "lever-kit", "screw-jack"])
				return it ? { kind: "rises", item: it.id, ...(pick([true, false]) ? { min_m: pick([0.01, 0.1]) } : {}) } : null
			}
		},
		{
			kind: "recoils", aliases: ["action_reaction", "pushes_off", "push_off", "carts_push_apart"], fields: { a: "item", b: "item", ratio: "number?", tol: "number?" },
			subject: ["a", "b"],
			about: "recoils {a, b, ratio?, tol?}: from rest (no start_speed on either), just after the push the two move off opposite ways (each at 2 cm/s or more); with ratio, a's speed ÷ b's just after the push is ratio within tol (10 %): equal and opposite pushes, speeds in the inverse ratio of the masses",
			label: (g, n) => `${n(g.a)} and ${n(g.b)} push apart`,
			summarize: (ctx, g) => goal_recoils(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => F.TYPES[i.type]?.dynamic)
				return xs.length > 1 ? { kind: "recoils", a: xs[0].id, b: pick(xs.slice(1)).id, ...(pick([true, false]) ? { ratio: pick([1, 2]) } : {}) } : null
			}
		},
		{
			kind: "pulls_with", aliases: ["force_reads", "meter_reads", "pull_reads", "pull_force", "reads_force"], fields: { item: "item", newtons: "number", tol: "number?" },
			about: "pulls_with {item, newtons, tol?}: a force meter's steady reading (a puller's cord, an edge pulley's string: its newtons) is newtons within tol (5 %, at least 0.05 N): the median of its readings from 0.2 s after the release, slack moments left out (an inclined plane: m·g·sin θ while it pulls a cart up at a steady speed)",
			label: (g, n) => `${n(g.item)} pulls with ${g.newtons} N`,
			summarize: (ctx, g) => goal_pulls_with(ctx, g),
			sample: (scene, pick) => {
				const it = _sample_item(scene, pick, ["puller", "edge-pulley"])
				return it ? { kind: "pulls_with", item: it.id, newtons: pick([0.45, 2, 4.2]), ...(pick([true, false]) ? { tol: pick([0.05, 0.5]) } : {}) } : null
			}
		},
		{
			kind: "accelerates", aliases: ["speeds_up", "acceleration", "accelerates_at"], fields: { item: "item", accel: "number", tol: "number?" },
			about: "accelerates {item, accel, tol?}: from the release it speeds up at accel m/s² (within tol, 10 %) until it hits something or 1.5 s pass (F = ma: a hanging mass m on an edge pulley gives a cart M a = m·g/(M + m))",
			label: (g, n) => `${n(g.item)} speeds up at ${g.accel} m/s²`,
			summarize: (ctx, g) => goal_accelerates(ctx, g),
			sample: (scene, pick) => {
				const it = _sample_item(scene, pick, ["dynamics-cart", "toy-car", "cart"])
				return it ? { kind: "accelerates", item: it.id, accel: pick([0.89, 0.5, 2]) } : null
			}
		},
		{
			kind: "net_force", aliases: ["balanced_forces", "forces_balance", "net_force_is", "unbalanced_force", "net_force_at_least"], fields: { item: "item", at_most_n: "number?", at_least_n: "number?" },
			about: "net_force {item, at_most_n?, at_least_n?}: the net force on it (the sum of every push and pull on it from outside: its force arrows' net, recorded in the run whether or not it shows arrows), the median from 0.1 s after the release, is at most at_most_n N and/or at least at_least_n N; with neither its forces balance (net under 2 % of its weight + 0.01 N): a book on a table, equal pulls on a cart, a parachute at its steady speed",
			label: (g, n) => (Number.isFinite(g.at_most_n) || Number.isFinite(g.at_least_n) ? `the net force on ${n(g.item)} is ${Number.isFinite(g.at_least_n) ? `at least ${g.at_least_n} N` : ""}${Number.isFinite(g.at_least_n) && Number.isFinite(g.at_most_n) ? " and " : ""}${Number.isFinite(g.at_most_n) ? `at most ${g.at_most_n} N` : ""}` : `the forces on ${n(g.item)} balance`),
			summarize: (ctx, g) => goal_net_force(ctx, g),
			sample: (scene, pick) => {
				const it = scene.items.find((i) => F.TYPES[i.type]?.dynamic)
				return it ? { kind: "net_force", item: it.id, ...(pick([true, false]) ? { at_least_n: pick([0.5, 2]) } : {}), ...(pick([true, false]) ? { at_most_n: pick([0.05, 5]) } : {}) } : null
			}
		},
		{
			kind: "energy_kept", aliases: ["keeps_energy", "energy_conserved", "conserves_energy", "energy_stays"], fields: { item: "item", tol: "number?" },
			about: "energy_kept {item, tol?}: by the end at most tol (0.05 = 5 %) of the energy it had to spend (its start's kinetic, its potential above the lowest it went, spring energy, and anything put in) has turned to heat and sound: its energy only changed form (a pendulum or a ball on a smooth track with settings {air: false})",
			label: (g, n) => `${n(g.item)} keeps its energy`,
			summarize: (ctx, g) => goal_energy_kept(ctx, g),
			sample: (scene, pick) => {
				const it = scene.items.find((i) => F.TYPES[i.type]?.dynamic)
				return it ? { kind: "energy_kept", item: it.id, ...(pick([true, false]) ? { tol: pick([0.01, 0.2]) } : {}) } : null
			}
		},
		{
			kind: "energy_to_heat", aliases: ["loses_energy", "energy_lost", "turns_to_heat", "energy_to_thermal", "friction_heat"], fields: { item: "item", at_least_pct: "number?" },
			about: "energy_to_heat {item, at_least_pct?}: by the end at least at_least_pct (10 %) of the energy it had to spend has turned to heat and sound (friction, bumps, the air): a ball rolling to a stop on carpet, a bounce dying away, a cart braking",
			label: (g, n) => `${n(g.item)}'s energy turns to heat and sound`,
			summarize: (ctx, g) => goal_energy_to_heat(ctx, g),
			sample: (scene, pick) => {
				const it = scene.items.find((i) => F.TYPES[i.type]?.dynamic)
				return it ? { kind: "energy_to_heat", item: it.id, ...(pick([true, false]) ? { at_least_pct: pick([5, 50, 99]) } : {}) } : null
			}
		}
	],
	knobs: [
		{ type: "lever-kit", key: "effort", how: "abs", steps: [0.01, 0.02, 0.05, 0.1, 0.2], cost: 1, more: "put more weight on {it}'s effort side", less: "take weight off {it}'s effort side", why: "the effort's turning effect is its weight × its distance from the fulcrum; it balances when that equals the load's" },
		{ type: "lever-kit", key: "effort_at", how: "m", steps: [0.005, 0.01, 0.02, 0.025, 0.03, 0.05, 0.1], cost: 1, more: "move {it}'s effort further from the fulcrum", less: "move {it}'s effort nearer the fulcrum", why: "further from the fulcrum, the same effort turns the beam harder" },
		{ type: "lever-kit", key: "load_at", how: "m", steps: [0.005, 0.01, 0.02, 0.025, 0.03, 0.05, 0.1], cost: 2, more: "move {it}'s load further from the fulcrum", less: "move {it}'s load nearer the fulcrum", why: "a load nearer the fulcrum needs less effort to balance" },
		{ type: "wheel-and-axle", key: "effort", how: "abs", steps: [0.01, 0.02, 0.05, 0.1, 0.2], cost: 1, more: "hang more on {it}'s wheel", less: "hang less on {it}'s wheel", why: "effort × wheel radius against load × axle radius: more than the balance lifts the load" },
		{ type: "wheel-and-axle", key: "wheel_radius", how: "rel", cost: 2, more: "give {it} a bigger wheel", less: "give {it} a smaller wheel", why: "a bigger wheel round the same axle multiplies the effort more (MA = R/r)" },
		{ type: "block-and-tackle", key: "effort", how: "abs", steps: [0.01, 0.02, 0.05, 0.1, 0.2], cost: 1, more: "pull {it} harder", less: "pull {it} less hard", why: "with n strands an effort of (load + block)/n holds the load; more lifts it" },
		{ type: "block-and-tackle", key: "strands", how: "abs", steps: [1, 2], cost: 2, more: "add strands to {it}", less: "take strands off {it}", why: "each strand holding the moving block shares the load: n strands, 1/n of the effort" },
		{ type: "gear-train", key: "rpm", how: "rel", cost: 1, more: "drive {it} faster", less: "drive {it} slower", why: "every gear turns in proportion to the driver" },
		{ type: "gear-train", key: "teeth_b", how: "abs", steps: [2, 4, 6, 12], cost: 2, more: "give {it}'s second gear more teeth", less: "give {it}'s second gear fewer teeth", why: "with two gears the second turns rpm × teeth_a ÷ teeth_b; more teeth, slower" },
		{ type: "gear-train", key: "teeth_a", how: "abs", steps: [2, 4, 6, 12], cost: 2, more: "give {it}'s driver more teeth", less: "give {it}'s driver fewer teeth", why: "a driver with more teeth turns the others faster" },
		{ type: "coaster-track", key: "height", how: "m", steps: [0.02, 0.05, 0.1, 0.15], cost: 1, more: "start {it} higher", less: "start {it} lower", why: "a higher start gives the ball more energy: enough for the loop's top at about 2.7 × its radius above the bottom" },
		{ type: "coaster-track", key: "size", how: "m", steps: [0.01, 0.02, 0.03, 0.05], cost: 2, more: "make {it}'s loop bigger", less: "make {it}'s loop smaller", why: "a smaller loop needs less height to go round" },
		{ type: "ramp", key: "blocks", how: "abs", steps: [1, 2], cost: 1, more: "stack {it} on more blocks", less: "take blocks from under {it}", why: "a higher ramp gives what rolls down it more speed at the bottom" },
		{ type: "dynamics-cart", key: "load", how: "abs", steps: [0.05, 0.1, 0.125, 0.25, 0.5, 0.75], cost: 2, more: "add bars to {it}", less: "take bars off {it}", why: "a heavier cart speeds up less under the same force (a = F/m) and carries more momentum at the same speed" },
		{ type: "dynamics-cart", key: "plunger", how: "abs", steps: [1, 2], cost: 1, more: "cock {it}'s plunger further", less: "cock {it}'s plunger less", why: "a harder-cocked spring pushes the carts apart faster" },
		{ type: "edge-pulley", key: "hanging_mass", how: "rel", steps: [0.1, 0.2, 0.3, 0.5, 0.6, 0.8, 1.0, 1.5], cost: 1, more: "hang more on {it}", less: "hang less on {it}", why: "a heavier hanging mass pulls the cart harder: a = m·g/(M + m)" },
		// (newtons added or taken off: two opposite pulls are balanced by making them equal, 3 N + 2 N against 5 N, which relative steps seldom hit)
		{ type: "puller", key: "force", how: "abs", steps: [0.1, 0.2, 0.5, 1, 2, 3, 5], cost: 1, more: "pull harder with {it}", less: "pull less hard with {it}", why: "the bigger of two opposite pulls wins; equal pulls balance (net force 0)" },
		{ type: "pusher", key: "force", how: "rel", cost: 1, more: "push harder with {it}", less: "push less hard with {it}", why: "a bigger push (force × time) gives more speed" },
		{ type: "balloon-rocket", key: "pressure", how: "rel", cost: 1, more: "blow {it} up harder", less: "blow {it} up less", why: "more pressure, a stronger jet push" },
		{ type: "parachute", key: "canopy", how: "rel", cost: 1, more: "give {it} a bigger canopy", less: "give {it} a smaller canopy", why: "a bigger canopy has more air resistance: a slower fall" },
		{ type: "coffee-filters", key: "count", how: "abs", steps: [1, 2, 3], cost: 1, more: "nest more filters in {it}", less: "nest fewer filters in {it}", why: "more filters, the same shape: heavier for the same drag, they fall faster (about √n)" },
		{ type: "screw-jack", key: "effort", how: "rel", steps: [0.1, 0.2, 0.3, 0.4, 0.6, 1.0, 1.5, 2.0], cost: 1, more: "push {it}'s handle harder", less: "push {it}'s handle less hard", why: "the lifting force is efficiency × push × 2π × handle ÷ pitch" },
		{ type: "screw-jack", key: "handle", how: "rel", steps: [0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5], cost: 1, more: "give {it} a longer handle", less: "give {it} a shorter handle", why: "a longer handle turns the screw with more force: the advantage is 2π × handle ÷ pitch" },
		{ type: "screw-jack", key: "pitch", how: "rel", steps: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], cost: 2, more: "give {it} a coarser thread", less: "give {it} a finer thread", why: "a finer thread lifts less a turn, so the same push lifts more weight (more slowly)" },
		{ type: "screw-jack", key: "load", how: "rel", cost: 3, more: "load {it} more", less: "lighten {it}'s load", why: "a lighter load needs less lifting force" },
		{ type: "screw-jack", key: "turns", how: "rel", cost: 2, more: "turn {it}'s handle faster", less: "turn {it}'s handle slower", why: "each turn lifts one pitch: faster turning, a faster lift (not a stronger one)" },
		{ type: "puller", key: "speed", how: "rel", cost: 1, more: "reel in faster with {it}", less: "reel in slower with {it}", why: "in speed mode it pulls at its set speed whatever force that takes (up to 100 N)" },
		{ type: "edge-pulley", key: "drop", how: "m", steps: [0.05, 0.1, 0.2], cost: 2, more: "give {it}'s mass further to fall", less: "give {it}'s mass less far to fall", why: "the hanging mass pulls only until it lands" },
		...["toy-car", "truck", "cart", "dynamics-cart", "steel-ball", "glass-marble", "golf-ball", "wooden-block"].map((type) => ({
			// (relative steps: only a start speed the scene already gives is turned up or down; a thing at rest is never given a push as a "fix")
			type, key: "start_speed", how: "rel", cost: 2, more: "start {it} faster", less: "start {it} slower", why: "a faster start carries it further (its kinetic energy, ½mv²)"
		}))
	],
	digest: (item, sim) => digestLines(item, sim),
	words: {
		change: changeWords,
		// (requests that need this module though their words are core ones: a balloon rocket on a string line, a cart (ai/catalog-digest.mjs))
		picks: "\\bballoon[\\s-]+rockets?\\b|\\bcarts?\\b|\\btrolleys?\\b",
		keys: {
			"dynamics-cart.load": "heav\\w*|light\\w*|mass|bars?|load\\w*|weigh\\w*",
			"lever-kit.effort": "effort|weight on the other|counter\\w*",
			"lever-kit.load": "load",
			"lever-kit.effort_at": "effort.{0,20}(?:further|closer|nearer|distance)|move the (?:effort|weight)",
			"lever-kit.load_at": "load.{0,20}(?:further|closer|nearer|distance)|move the load",
			"ramp.blocks": "blocks?|steep\\w*|higher ramp|lower ramp|taller",
			"coaster-track.height": "high\\w*|low\\w*|start height|drop",
			"coaster-track.size": "loop.{0,10}(?:big|small|size|radius)|(?:big|small)\\w* loop",
			"gear-train.teeth_a": "teeth|tooth|gear size",
			"gear-train.teeth_b": "teeth|tooth|gear size",
			"gear-train.rpm": "fast\\w*|slow\\w*|rpm|speed",
			"block-and-tackle.strands": "strands?|pulleys?|ropes?",
			"edge-pulley.hanging_mass": "hanging|weight|mass|heav\\w*",
			start_speed: "fast\\w*|slow\\w*|speed|push\\w*|kick\\w*|launch\\w*|throw\\w*",
			color: "colou?r|red|blue|green|yellow|orange|purple|pink|white|black|gr[ae]y|brown",
			fragile: "break\\w*|crack\\w*|fragile",
			"puller.force": "pull\\w*|force|strong\\w*|harder",
			"pusher.force": "push\\w*|force|strong\\w*|harder",
			"coffee-filters.count": "filters?|nest\\w*|stack\\w*",
			"parachute.canopy": "canopy|parachute size|bigger|smaller",
			"screw-jack.pitch": "thread|pitch|finer|coarser",
			"screw-jack.handle": "handle|bar|longer|shorter|lever",
			"screw-jack.effort": "push\\w*|effort|harder|force|strong\\w*",
			"screw-jack.load": "load|heav\\w*|light\\w*|weigh\\w*|mass|kg",
			"screw-jack.turns": "turn\\w*|fast\\w*|slow\\w*|speed",
			"puller.speed": "speed|fast\\w*|slow\\w*|reel\\w*",
			arrows: "arrows?|forces?|free.body|fbd",
			arrow_scale: "arrows?.{0,12}(?:bigger|smaller|longer|shorter|length|size)|(?:bigger|smaller|longer|shorter) arrows?",
			show_energy: "energy|kinetic|potential|bars?",
			"energy-bars.watch": "energy|bars?|board|shows?",
			"energy-bars.zero": "zero|lowest|floor|height from"
		}
	}
}
