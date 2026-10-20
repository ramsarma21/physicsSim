/**
 * The heat module's process kind, "heat" (tooling/src/sim/heat.ts does the work). Every record of a document joins one heat world
 * per run; the first record's process steps it on the slow beat (time-lapse scaled), the others only bring their records.
 *
 * Records (made by machines/catalog_heat.py's builders, `c.process("heat", part, role=...)`), `solid` = the solid it is about
 * ("<item>/<part>"; the record's own id when absent), lengths m, temperatures °C, powers W, masses kg, times s of the run:
 *   {role: "body", solid, with?, start?, liquid?, material?, absorptivity?, cells?, profile?, retain?, pool?, wet?, inert?}   a body's own settings
 *       (its start temperature; a heat material by name; a chain of `cells` along it (`profile`: readings along it); what melt water it
 *       holds around a cube on it (`retain`, m: a plate 0.002, a bowl 0.005); `with`: other solids that are one body with it (a fixed
 *       beaker's floor and walls); `pool`: a puddle item (its area its water 1.5 mm deep); a fixed solid that is a body; `inert`: no heat)
 *   {role: "water", solid (the vessel part), x0, x1, y0, y1 (the inside, in that part's frame; `frame: "world"`: in the world, a fixed
 *       container's), depth or area (m²), round?, liquid, ice?, salt?, start?, lid?, wall? (m), wallMaterial?}       a container's water
 *   {role: "sensor", solid, at {x, y} (the bulb in the part's frame), capacity (J/K), area (m²), size (m), resistance (K/W inside it),
 *       absorptivity?}   a thermometer
 *   {role: "lamp", solid, at {x, y}, dir {x, y} (a unit vector, or direction: rad; in the part's frame), spread (half-angle, rad), power (W of light into the beam),
 *       from?, until?}
 *   {role: "heater", solid (the hot surface; a body), power, setpoint (°C: its thermostat switches off 5 K above, on 5 K below), from?, until?}
 *   {role: "salt", solid (a salt pile's), mass (kg), rate (1/s: how fast it dissolves toward saturation)}
 *   {role: "sun", irradiance (W/m²), direction (rad: the way the light travels), from?}
 *   {role: "enclosure", solid, x0, x1, y0, y1 (the inside, in that part's frame), air (°C)}   a freezer, a fridge, an oven
 *   {role: "room", humidity (0..1)}
 *   {role: "flame", solid (a candle's body), at {x, y} (its wick's top, the solid's frame), power? (W, 80), burn? (kg/s, 0.1 g/min), plume?, radiant?
 *       (shares of the power), from?, until?}   a lit candle: its plume and radiation heat what is near, its wax burns away, it goes out in a jar
 *   {role: "jar", solid, x0, x1, y0, y1 (the inside, that solid's frame), volume (m³)}   a jar over a candle: its air's oxygen (it goes out at 16 %)
 *   {role: "ring", ball (solid), jaws [solids]}   a ball-and-ring: the ball's and the ring's body records carry `expand` (α, 1/K), `size` (m) and `ref` (°C)
 *   {role: "tap", item, key (its reading of what it has run, mL), start (°C)}   water another module brings in
 *   {role: "drive", solid, speed (m/s), stroke (m), press (N), from?, until?}   a hand rubbing it back and forth (a sanding block), pressing down
 * Body records may also carry extra [[material, kg], ...] (what it holds that is no solid: a sand tray's sand), expand/size/ref, bend {a1, a2, e1,
 * e2, t1, t2, length, ref} (a bimetal strip); water records fluids [[words, kg], ...] (oil, honey, alcohol with it), density (kg/m³), follow
 * {item, key} (its volume follows another module's reading, mL: flow's pitchers and basins), keep (it does not spill when tipped).
 * Readings (track.state[item]): temp (°C; a chain's mean, with temp_min, temp_max and, with `profile`, temp0..temp7 from one end to the
 * other), melted (0..1), liquid_g (melt water it holds), brine_g (salt dissolved in it), scale (its size), puddle_g and puddle_temp (its
 * drained melt water), wet_g (dew); water_temp, water_g, ice_g, level (m), boiled_g, boiling (0/1); reading (a thermometer's °C); salt_g
 * (a salt pile's); power (a heater's W now); on (a lamp, 0/1); work_j (J of friction's and impacts' work a body took in); spot_temp, scorched (its
 * hottest spot under focused light; 0/1); bend_mm, bend_deg (a bimetal strip); flame (0/1), flame_w, burned_g (a candle); o2_pct (a jar);
 * ball_mm, hole_mm, fits, through (a ball-and-ring); liquid_temp, liquid_g (a container of oil, honey, alcohol). An item's second body or water is
 * prefixed "<part>:".
 */
import { heatWorldFor } from "#sim/heat.ts"
import type { ProcessContext, ProcessKind, ProcessRecord } from "#sim/plugins.ts"

export const HEAT_ROLES = ["body", "water", "sensor", "lamp", "heater", "salt", "sun", "enclosure", "room", "flame", "jar", "ring", "tap", "drive"] as const
const ON_SOLID = new Set(["body", "water", "sensor", "lamp", "heater", "salt", "enclosure", "flame", "jar", "drive"])
/** Numeric fields a record may carry, and their sane bounds. */
const BOUNDS: Readonly<Record<string, readonly [number, number]>> = {
	start: [-100, 1500],
	salt: [0, 10],
	liquid: [0, 1000],
	ice: [0, 1000],
	wet: [0, 100],
	absorptivity: [0, 1],
	cells: [1, 32],
	retain: [0, 0.05],
	standoff: [0, 0.02],
	mass: [0, 100],
	rate: [0, 100],
	resistance: [0, 1e6],
	capacity: [1e-6, 1e6],
	area: [1e-8, 100],
	size: [1e-4, 10],
	power: [0, 1e6],
	setpoint: [-100, 1500],
	spread: [0.01, 3.2],
	irradiance: [0, 5000],
	air: [-100, 1500],
	humidity: [0, 1],
	depth: [1e-4, 100],
	wall: [1e-5, 1],
	from: [-1e9, 1e9],
	until: [-1e9, 1e9],
	burn: [0, 1],
	plume: [0, 1],
	radiant: [0, 1],
	volume: [1e-7, 10],
	density: [1, 20000],
	expand: [0, 1e-3],
	ref: [-100, 1500],
	speed: [0, 10],
	stroke: [0.001, 2],
	press: [0, 1000]
}

/**
 * A hand rubbing a solid back and forth (a sanding block): from `from` to `until` s of the run, every (sub-)step it moves at `speed` m/s along
 * the world's x, turning back every `stroke` m, and is pressed down with `press` N. Friction's work at its contacts is heat (HeatWorld.rub).
 */
const driveOf = (r: ProcessRecord) => {
	const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
	const solid = String(r.solid ?? "")
	const speed = Math.max(0, num(r.speed, 0.5))
	const stroke = Math.max(0.001, num(r.stroke, 0.1))
	const press = Math.max(0, num(r.press, 0))
	const from = num(r.from, 0)
	const until = num(r.until, Infinity)
	const cycle = speed > 0 ? (2 * stroke) / speed : Infinity
	return (c: ProcessContext) => {
		const t = c.time()
		if (t < from || t >= until || !(speed > 0)) return
		const h = c.solid(solid)
		if (h === undefined) return
		const phase = (t - from) % cycle
		const v = h.velocity()
		h.setVelocity(phase < cycle / 2 ? speed : -speed, v.y, 0)
		if (press > 0) h.push(0, -press)
	}
}

const heat: ProcessKind = {
	kind: "heat",
	check(record: ProcessRecord, solids: ReadonlySet<string>) {
		const role = record.role
		if (typeof role !== "string" || !(HEAT_ROLES as readonly string[]).includes(role)) return `role must be one of ${HEAT_ROLES.join(", ")} (it is ${String(role)})`
		if (ON_SOLID.has(role)) {
			const id = typeof record.solid === "string" ? record.solid : record.id
			if (!solids.has(id)) return `its solid "${id}" is not a solid of the document`
		}
		for (const [key, [lo, hi]] of Object.entries(BOUNDS)) {
			const v = record[key]
			if (v === undefined) continue
			if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) return `${key} must be a number from ${lo} to ${hi}, not ${String(v)}`
		}
		for (const key of ["x0", "x1", "y0", "y1", "direction"]) {
			const v = record[key]
			if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1000)) return `${key} must be a number (m or rad) within ±1000`
		}
		for (const key of ["at", "dir"]) {
			const at = record[key] as { x?: unknown; y?: unknown } | undefined
			if (at !== undefined && (typeof at !== "object" || at === null || typeof at.x !== "number" || typeof at.y !== "number" || !Number.isFinite(at.x) || !Number.isFinite(at.y)))
				return `${key} must be a point {x, y}`
		}
		if (record.with !== undefined && (!Array.isArray(record.with) || record.with.some((x) => typeof x !== "string" || !solids.has(x)))) return "with must list solids of the document"
		if (record.frame !== undefined && record.frame !== "world") return 'frame must be "world" (or left out: the solid\'s own frame)'
		if (role === "water" && !(typeof record.x0 === "number" && typeof record.x1 === "number" && (record.x1 as number) > (record.x0 as number))) return "a water's inside needs x0 < x1"
		if (role === "water" && !(typeof record.y0 === "number" && typeof record.y1 === "number" && (record.y1 as number) > (record.y0 as number))) return "a water's inside needs y0 < y1"
		if (role === "jar" && !(typeof record.x0 === "number" && typeof record.x1 === "number" && typeof record.y0 === "number" && typeof record.y1 === "number" && record.x1 > record.x0 && record.y1 > record.y0))
			return "a jar's inside needs x0 < x1 and y0 < y1"
		if (role === "ring") {
			if (typeof record.ball !== "string" || !solids.has(record.ball)) return `a ring's ball "${String(record.ball)}" is not a solid of the document`
			if (!Array.isArray(record.jaws) || record.jaws.length === 0 || record.jaws.some((x) => typeof x !== "string" || !solids.has(x))) return "a ring's jaws must list solids of the document"
		}
		for (const key of ["extra", "fluids"]) {
			const v = record[key]
			if (v !== undefined && (!Array.isArray(v) || v.some((x) => !Array.isArray(x) || typeof x[0] !== "string" || typeof x[1] !== "number" || !Number.isFinite(x[1]) || x[1] < 0 || x[1] > 1000)))
				return `${key} must list [name, kg] pairs`
		}
		if (record.follow !== undefined) {
			const f = record.follow as { item?: unknown; key?: unknown }
			if (typeof f !== "object" || f === null || typeof f.item !== "string" || typeof f.key !== "string") return "follow must be {item, key} (another module's reading of the liquid's volume, mL)"
		}
		if (record.bend !== undefined) {
			const b = record.bend as Record<string, unknown>
			if (typeof b !== "object" || b === null || ["a1", "a2", "e1", "e2", "t1", "t2", "length"].some((k) => typeof b[k] !== "number" || !Number.isFinite(b[k] as number) || (b[k] as number) < 0))
				return "bend must be {a1, a2, e1, e2, t1, t2, length} (non-negative numbers)"
		}
		return undefined
	},
	create(record, ctx) {
		const world = heatWorldFor(ctx.scene)
		world.add(record)
		const steps = world.records.length === 1
		// (the first record's process steps the world; it also books friction's work after each (sub-)step and impacts as contacts begin, and
		// leaves out a ball-and-ring's contacts while the ball fits through)
		return {
			coarse: 8,
			start: (c) => world.build(c),
			...(steps ? { slow: (c, dt) => world.advance(c, dt), after: (c) => world.rub(c), contact: (c, touch, phase) => world.touch(c, touch, phase) } : {}),
			...(record.role === "drive" ? { force: driveOf(record) } : record.role === "ring" ? { force: (c: ProcessContext) => world.wake(c) } : {})
		}
	}
}

export default heat
