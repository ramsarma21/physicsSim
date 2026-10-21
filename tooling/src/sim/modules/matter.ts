/**
 * The matter module's process kind, "matter" (the physics is in tooling/src/sim/matter/*.ts). One record per item, by `role` (made by
 * machines/mod_matter.py's builders, `c.process("matter", part, role=...)`); lengths m, masses kg, temperatures °C, times s of the run:
 *   {role: "box", origin {x, y} (the inside's floor centre, world), width, height, substance, second (a gas key or null), count, radius,
 *       mass, volume (m³), start, heater (W), heatFrom, piston, pistonAt, load (kg), area (m²), outside (Pa), divider, openAt,
 *       drive ({from, until, to} or null: a hand-pushed plunger), seed}         the particle model (box.ts); a syringe is one with a drive
 *   {role: "balloon", start, bath, volume (m³), tau, dipAt}                   Charles: V ∝ T as the air comes to the water's temperature
 *   {role: "glass", solid (the glass's base), ballast, weighed, radius, depth, height, floor (the inner floor's height in the base's frame),
 *       temp, solute, crystal, mass, grain, porous, specks, startIn, pourAt, stir, stirFrom, stirUntil, solubility, seed}   dissolving (glass.ts)
 *   {role: "bag", solid (its floor), ballast, inside {x0, x1, y0, y1} (in the floor's frame), sealed}   holds what melts or leaves its contents
 *   {role: "bar", pieces [solid ids], snapAt, apart (m/s)}                    a chocolate bar snapped into its pieces
 *   {role: "reaction", solid, ballast, soda (kg), co2 (kg it can make), mixAt, tau, closure (open | cap | balloon), headspace (m³), temp,
 *       liquid (m³ of vinegar: Henry's law shares the gas with it under a cap or a balloon; none: nothing dissolves)}   a cap pops at
 *       CAP_POPS (closed.ts)
 *   {role: "ball", solid, ballast, start, end (kg of air), startBar, endBar, pumpAt, pumpFor}   a ball pumped up: the air's mass
 *   {role: "grains", solid (the container's floor), ballast (or null), origin {x, y} (the inside's floor centre in that solid's frame), width,
 *       wall, components [{key, mass (g)}], grains, magnet ({item, br, length, area, inset} or null), aperture, wire, sieveHeight,
 *       sieveWidth, shake, shakeHz, shakeFrom, shakeUntil, pour, seed}      a mixture, a sieve, a magnet (grains.ts)
 *   {role: "block", mass, volume, density}                                    a density block's readings
 *   {role: "filter", funnel (rim diameter), paper, water (m³), temp, undissolved (a key or "none"), undissolvedMass, dissolved (a key or "none"),
 *       dissolvedMass, crystals (kg the water could not dissolve), pourAt, pourFor (run s), rinse (m³)}   filtering (separate.ts)
 *   {role: "evaporate", solid (the dish's base), ballast, rim, depth, dish (kg), water (kg), start, solute, mass (kg), heat (hot plate |
 *       sun | room), power (W), humidity (0-1), heatFrom (run s)}              an evaporating dish (separate.ts)
 *   chemical changes (chem.ts; `heat`: the item's heat record's id, or null without the heat module; capacity J/K; area m²; at run s):
 *   {role: "pack", solid, heat, chemical, molar (kg/mol), dh (J/mol), salt (kg), water (kg), capacity, at, tau (lesson s), area}   a cold/hot pack
 *   {role: "warmer", solid, heat, ballast, iron (kg), full (kg of oxygen), capacity, at, lasts (lesson s), area}                   a hand warmer
 *   {role: "rust", solid, heat, ballast, iron (kg), full, share, capacity, rustTau (lesson s), at, area}                            steel wool
 *   {role: "indicator", solid (the beaker's base), heat (its water's record), ballast, water (kg), start, extra (kg), steps [{what, at,
 *       acetic, citric, hco3, co3, na (mol), ml, kg}], fizz (lesson s), capacity (the glass's), area}                              red cabbage
 *   {role: "precip", solid, heat, ballast, water, start, cacl2, hco3 (mol), extra, depth (m), at, react, fizz (lesson s), capacity, area}
 *   {role: "atoms", readings {key: number}, atoms, bonds}                      a molecule's or crystal's model: its fixed readings
 * Readings (track.state[item]): see each type's readouts in mod_matter.py; series (track.series[item]): "p" (positions: x, y per particle
 * of a box or a mixture, x, y, z, r per speck of a glass, in the container's frame), "k" (each particle's colour code).
 * Masses that no solid shows ride on the item's hidden `ballast` solid, resized as they change (mod_matter.py's docstring).
 */
import { ParticleBox } from "#sim/matter/box.ts"
import { CAP_POPS, capPops, co2Split, degas } from "#sim/matter/closed.ts"
import { criticalPoint, vapourPressure } from "#sim/matter/vapour.ts"
import { CHEM_ROLES, chemProblem, chemProcess } from "#sim/matter/chem.ts"
import { Glass } from "#sim/matter/glass.ts"
import { barMagnet, type FieldAt, GRAINS, Mixture } from "#sim/matter/grains.ts"
import { Dish, Filter, FILTER_SOLIDS, PAPERS } from "#sim/matter/separate.ts"
import { FREE, LIQUID, SOLID } from "#sim/matter/particles.ts"
import { KELVIN, R, SOLUTES, SUBSTANCES } from "#sim/matter/substances.ts"
import type { ProcessContext, ProcessKind, ProcessRecord, SolidHandle } from "#sim/plugins.ts"

export const MATTER_ROLES = ["box", "balloon", "glass", "bag", "bar", "reaction", "ball", "grains", "block", "filter", "evaporate", ...CHEM_ROLES] as const

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d)
const bool = (v: unknown) => v === true

/** The most a run's matter process may hold: it keeps a run's work bounded (a box of 160 particles, a mixture of 300 grains). */
const LIMITS: Readonly<Record<string, readonly [number, number]>> = {
	count: [1, 200],
	grains: [1, 400],
	specks: [1, 200],
	width: [0.005, 2],
	height: [0.005, 2],
	radius: [0.0005, 0.05],
	mass: [0, 100],
	volume: [1e-9, 100],
	start: [-273, 6000],
	heater: [-1e5, 1e6],
	tau: [0.01, 1e5],
	funnel: [0.01, 1],
	water: [0, 10],
	humidity: [0, 1],
	power: [0, 1e5],
	rim: [0.005, 1]
}

/**
 * A handle's ballast resized to carry `mass` kg, its document body carrying `full` kg (the largest it will carry). Only once the bodies move
 * (after the release: a held body's mass is the engine's to set when it lets go); the first call after the release is before the first step.
 */
const carry = (h: SolidHandle | undefined, mass: number, full: number, ctx?: ProcessContext) => {
	if (h === undefined || !(full > 0) || (ctx !== undefined && !ctx.released())) return
	const k = mass <= 0 ? 0 : Math.pow(Math.min(1, mass / full), 1 / 3)
	if (Math.abs(k - h.scale()) > 1e-9) h.resize(k < 0.01 ? 0.01 : k)
}

/** A point of the world in a solid's own frame. */
const toLocal = (h: SolidHandle, x: number, y: number) => {
	const p = h.pose()
	const c = Math.cos(p.angle)
	const s = Math.sin(p.angle)
	return { x: (x - p.x) * c + (y - p.y) * s, y: -(x - p.x) * s + (y - p.y) * c, angle: p.angle }
}

// ---------------------------------------------------------------- the particle model
/** A gas's pressure past its vapour pressure by this factor is said (a few %: the curve's own accuracy where it is extrapolated). */
const DENSE_SAID = 1.05
/** A syringe's plunger held with more than this is said, N (about what one hand pushes: a modelling choice). */
const PUSH_SAID = 200

const boxProcess = (r: ProcessRecord, run?: ProcessContext) => {
	const item = r.item as string
	// (the run's world: the load weighs by its gravity; in a vacuum no air presses on a piston or a plunger from outside)
	const air = run === undefined || run.settings.air
	const gravity = run === undefined ? 9.81 : run.settings.gravity
	const sub = SUBSTANCES[str(r.substance, "water")] ?? (SUBSTANCES.water as NonNullable<(typeof SUBSTANCES)[string]>)
	const second = typeof r.second === "string" ? SUBSTANCES[r.second] : undefined
	const drive = r.drive as { from?: unknown; until?: unknown; to?: unknown } | null | undefined
	const box = new ParticleBox({
		width: num(r.width, 0.2),
		height: num(r.height, 0.2),
		substance: sub,
		...(second === undefined ? {} : { second }),
		count: Math.round(num(r.count, 60)),
		radius: num(r.radius, 0.004),
		mass: num(r.mass, 0.001),
		volume: num(r.volume, 0.001),
		start: num(r.start, 20),
		heater: num(r.heater, 0),
		heatFrom: num(r.heatFrom, 0),
		piston: bool(r.piston),
		pistonAt: num(r.pistonAt, 0.6),
		load: num(r.load, 0),
		area: num(r.area, 0.000707),
		outside: air ? num(r.outside, 101325) : 0,
		gravity,
		divider: bool(r.divider),
		openAt: num(r.openAt, 1),
		drive: drive && typeof drive === "object" ? { from: num(drive.from, 1), until: num(drive.until, 3), to: num(drive.to, 0.5) } : null,
		seed: Math.round(num(r.seed, 1))
	})
	const codes: number[] = new Array(box.p.n).fill(0)
	const pos: number[] = new Array(2 * box.p.n).fill(0)
	// (what the card says happened: the heating curve's corners, once each, from the real sample's fractions; a gas squeezed past its
	// vapour pressure (a real one would partly condense); a plunger held with more than PUSH_SAID N)
	const said = { melt: false, boil: false, gas: false, dense: false, push: false }
	const syringe = box.spec.drive !== null && box.spec.drive !== undefined
	let first = true
	const publish = (ctx: ProcessContext) => {
		const rd = box.readings
		if (first) {
			said.melt = rd.solid <= 0
			said.boil = rd.gas > 0
			said.gas = rd.gas >= 0.995
			first = false
		}
		if (!said.melt && rd.liquid > 0 && rd.solid > 0) {
			said.melt = true
			ctx.event(`${item} starts to melt (${rd.temperature.toFixed(1)} °C)`, [item], "melts")
		}
		if (!said.boil && rd.gas > 0 && rd.liquid > 0) {
			said.boil = true
			ctx.event(`${item} starts to boil (${rd.temperature.toFixed(1)} °C)`, [item], "boils")
		}
		if (!said.gas && rd.gas >= 0.995) {
			said.gas = true
			ctx.event(`${item} is all gas`, [item], "gas")
		}
		if (!said.dense && rd.gas >= 0.995 && box.spec.second === undefined && rd.temperature < criticalPoint(box.spec.substance)) {
			const sat = vapourPressure(box.spec.substance, rd.temperature)
			if (rd.pressure * 1000 > sat * DENSE_SAID) {
				said.dense = true
				ctx.event(
					`${item}: in ${rd.volume.toFixed(rd.volume < 10 ? 1 : 0)} mL its ${box.spec.substance.name} gas presses ${rd.pressure.toFixed(0)} kPa at ${rd.temperature.toFixed(1)} °C, ` +
						`more than its vapour pressure there (${(sat / 1000).toFixed(sat < 10000 ? 1 : 0)} kPa): a real sample squeezed this much would be partly liquid (the model's states are the ones at 1 atm)`,
					[item],
					"condenses"
				)
			}
		}
		if (syringe) {
			// the push the plunger needs to hold the air where it is: (inside − outside) × its area
			const force = (rd.pressure * 1000 - box.spec.outside) * box.spec.area
			ctx.set(item, "force_n", force)
			const d = box.spec.drive as { until: number }
			if (!said.push && ctx.time() >= d.until && Math.abs(force) > PUSH_SAID) {
				said.push = true
				ctx.event(`${item}: holding its plunger at ${rd.volume.toFixed(1)} mL takes ${Math.abs(force).toFixed(0)} N (${force > 0 ? "a push" : "a pull"} like the weight of ${(Math.abs(force) / 9.81).toFixed(0)} kg)`, [item], "push")
			}
		}
		ctx.set(item, "temp_c", rd.temperature)
		ctx.set(item, "solid_pct", rd.solid * 100)
		ctx.set(item, "liquid_pct", rd.liquid * 100)
		ctx.set(item, "gas_pct", rd.gas * 100)
		ctx.set(item, "pressure_kpa", rd.pressure)
		ctx.set(item, "volume_ml", rd.volume)
		ctx.set(item, "speed_ms", rd.speed)
		ctx.set(item, "heat_kj", rd.heat / 1000)
		ctx.set(item, "mixed_pct", rd.mixed * 100)
		ctx.set(item, "piston_m", rd.piston)
		const p = box.p
		for (let i = 0; i < p.n; i++) {
			pos[2 * i] = p.x[i] as number
			pos[2 * i + 1] = p.y[i] as number
			// colour code: phase (0 gas, 1 liquid, 2 solid) + 3 × its colour (0 the substance's, 1 the other side's or the other gas's)
			const other = box.spec.second !== undefined ? (p.kind[i] as number) : box.spec.divider && box.left0[i] === 0 ? 1 : 0
			codes[i] = (p.phase[i] as number) + 3 * other
		}
		ctx.series(item, "p", pos)
		ctx.series(item, "k", codes)
	}
	return {
		// (the heater's work every 8 steps, 60 Hz: the heating curve's corners within a sixtieth of a run second)
		coarse: 8,
		start(ctx: ProcessContext) {
			publish(ctx)
		},
		slow(ctx: ProcessContext, dt: number) {
			box.heat(dt, ctx.time())
		},
		step(ctx: ProcessContext) {
			box.advance(ctx.step, ctx.time())
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- Charles: a balloon in a water bath
const balloonProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const T0 = num(r.start, 20)
	const bath = num(r.bath, 60)
	const V0 = num(r.volume, 0.001)
	const tau = num(r.tau, 20)
	const dipAt = num(r.dipAt, 0.5)
	let T = T0
	const publish = (ctx: ProcessContext) => {
		// V ∝ T in kelvin at constant pressure (Charles)
		const V = (V0 * (T + KELVIN)) / (T0 + KELVIN)
		ctx.set(item, "temp_c", T)
		ctx.set(item, "volume_l", V * 1000)
		ctx.set(item, "diameter_cm", 100 * 2 * Math.pow((3 * V) / (4 * Math.PI), 1 / 3))
	}
	return {
		coarse: 8,
		start: publish,
		slow(ctx: ProcessContext, dt: number) {
			if (ctx.time() < dipAt) return
			// the air comes to the water's temperature exponentially, time constant tau (lesson seconds)
			T = bath + (T - bath) * Math.exp(-dt / tau)
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- dissolving
const glassProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const solute = SOLUTES[str(r.solute, "salt")] ?? (SOLUTES.salt as NonNullable<(typeof SOLUTES)[string]>)
	const startIn = str(r.startIn, "spoon") as "spoon" | "dish" | "glass"
	const full = num(r.mass, 0.006)
	const floor = num(r.floor, 0.003)
	let glass: Glass | undefined
	const pos: number[] = []
	let turns = 0
	let saidDone = false
	let saidSat = false
	const publish = (ctx: ProcessContext) => {
		const g = glass as Glass
		const dissolved = g.dissolved()
		const left = g.undissolved()
		const total = dissolved + left
		if (!saidDone && g.poured && dissolved > 0 && left <= Math.max(5e-6, 0.01 * total)) {
			saidDone = true
			ctx.event(`what was put in ${item} has dissolved (${(g.clock / 60).toFixed(1)} lesson min after it went in)`, [item], "dissolved")
		}
		const water = Math.PI * g.spec.radius * g.spec.radius * g.spec.depth * 998.2
		ctx.set(item, "dissolved_g", dissolved * 1000)
		ctx.set(item, "left_g", left * 1000)
		ctx.set(item, "dissolved_pct", total > 0 ? (100 * dissolved) / total : 0)
		ctx.set(item, "strength_pct", water > 0 ? (100 * dissolved) / (water + dissolved) : 0)
		const S = num(r.solubility, 0) / 100
		const sat = S > 0 && left > 1e-6 && g.strength() >= S * 0.995
		ctx.set(item, "saturated", sat ? 1 : 0)
		if (sat && !saidSat) {
			saidSat = true
			ctx.event(`${item} is saturated: ${(left * 1000).toFixed(1)} g stays undissolved`, [item], "saturated")
		}
		ctx.set(item, "clock_s", g.poured ? g.clock : 0)
		ctx.set(item, "stir_turns", turns)
		const weighed = startIn === "spoon" ? g.inGlass() : full
		ctx.set(item, "weighed_g", weighed * 1000)
		carry(ctx.solid(r.ballast as string), weighed, full, ctx)
		pos.length = 4 * g.n
		for (let i = 0; i < g.n; i++) {
			const k = (g.m[i] as number) > 0 ? Math.pow((g.m[i] as number) / g.m0, 1 / 3) : 0
			pos[4 * i] = g.x[i] as number
			pos[4 * i + 1] = (g.y[i] as number) + floor
			pos[4 * i + 2] = g.z[i] as number
			pos[4 * i + 3] = g.drawRadius * k
		}
		ctx.series(item, "p", pos)
	}
	return {
		start(ctx: ProcessContext) {
			glass = new Glass({
				radius: num(r.radius, 0.035),
				height: num(r.height, 0.1),
				depth: num(r.depth, 0.05),
				temperature: num(r.temp, 20),
				solute: { ...solute, density: num(r.crystal, solute.density) },
				mass: full,
				grain: num(r.grain, 0.0003),
				specks: Math.round(num(r.specks, 40)),
				pourAt: num(r.pourAt, 0.5),
				pourHeight: num(r.height, 0.1) + 0.03,
				startIn,
				porous: num(r.porous, 1),
				stir: num(r.stir, 0),
				stirFrom: num(r.stirFrom, 1),
				stirUntil: num(r.stirUntil, 20),
				timeLapse: ctx.settings.timeLapse,
				seed: Math.round(num(r.seed, 1))
			})
			publish(ctx)
		},
		step(ctx: ProcessContext) {
			const g = glass as Glass
			g.step(ctx.time(), ctx.step)
			const s = g.spec
			if (s.stir > 0 && ctx.time() >= s.stirFrom && ctx.time() < s.stirUntil) turns += s.stir * Math.min(s.timeLapse, 20) * ctx.step
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- a bag that keeps what melts in it
const BAG_FULL = 1 // kg: the most melt water a bag's ballast carries

const bagProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const floorId = r.solid as string
	const inside = (r.inside ?? {}) as { x0?: number; x1?: number; y0?: number; y1?: number }
	let held: { h: SolidHandle; m0: number }[] | null = null
	return {
		coarse: 8,
		start(ctx: ProcessContext) {
			ctx.set(item, "water_g", 0)
			ctx.set(item, "contents_g", 0)
			carry(ctx.solid(r.ballast as string), 0, BAG_FULL, ctx)
		},
		step(ctx: ProcessContext) {
			const floor = ctx.solid(floorId)
			if (floor === undefined) return
			if (held === null) {
				// what is in it: every other item's moving solids whose middle starts inside it
				held = []
				for (const h of ctx.all()) {
					if (h.item === item || !h.dynamic) continue
					const p = h.pose()
					const q = toLocal(floor, p.x, p.y)
					if (q.x >= num(inside.x0, -0.08) && q.x <= num(inside.x1, 0.08) && q.y >= num(inside.y0, -0.005) && q.y <= num(inside.y1, 0.1))
						held.push({ h, m0: h.mass() })
				}
			}
			// what its contents have lost (ice melted, a fizz's gas while sealed) stays in the bag as water
			let lost = 0
			let now = 0
			for (const { h, m0 } of held) {
				const m = h.mass()
				lost += Math.max(0, m0 - m)
				now += m
			}
			carry(ctx.solid(r.ballast as string), Math.min(lost, BAG_FULL), BAG_FULL, ctx)
			ctx.set(item, "water_g", lost * 1000)
			ctx.set(item, "contents_g", (now + lost) * 1000)
		}
	}
}

// ---------------------------------------------------------------- a chocolate bar snapped
const barProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const ids = Array.isArray(r.pieces) ? (r.pieces as unknown[]).filter((x): x is string => typeof x === "string") : []
	const snapAt = num(r.snapAt, 1)
	const apart = num(r.apart, 0.15)
	let snapped = false
	let width = 0
	return {
		start(ctx: ProcessContext) {
			ctx.set(item, "pieces_apart", 0)
			const a = ctx.solid(ids[0] ?? "")
			const b = ctx.solid(ids[1] ?? "")
			width = a !== undefined && b !== undefined ? Math.abs(b.pose().x - a.pose().x) : 0.03
		},
		force(ctx: ProcessContext, h: number) {
			if (snapped || ctx.time() < snapAt) return
			snapped = true
			// each piece gets a sideways push away from the middle (an impulse over one sub-step), the outer ones fastest
			const n = ids.length
			for (let k = 0; k < n; k++) {
				const s = ctx.solid(ids[k] as string)
				if (s === undefined || !s.dynamic) continue
				const share = n > 1 ? (k - (n - 1) / 2) / ((n - 1) / 2) : 0
				s.push((s.mass() * apart * share) / h, 0)
			}
		},
		step(ctx: ProcessContext) {
			let gaps = 0
			for (let k = 1; k < ids.length; k++) {
				const a = ctx.solid(ids[k - 1] as string)
				const b = ctx.solid(ids[k] as string)
				if (a === undefined || b === undefined) continue
				const d = Math.hypot(b.pose().x - a.pose().x, b.pose().y - a.pose().y)
				if (d > width + 0.002) gaps++
			}
			ctx.set(item, "pieces_apart", gaps === 0 ? 0 : gaps + 1)
		}
	}
}

// ---------------------------------------------------------------- baking soda and vinegar
/** Air's density at 20 °C, 1 atm, kg/m³ (ρ = P/(R_air T), R_air 287.05 J/(kg·K)). */
const airDensity = (T: number, P = 101325) => P / (287.05 * (T + KELVIN))

const reactionProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const soda = num(r.soda, 0.005)
	const co2 = num(r.co2, 0.00262)
	const mixAt = num(r.mixAt, 1)
	const tau = num(r.tau, 6)
	const closure = str(r.closure, "open")
	const headspace = num(r.headspace, 4e-4)
	const liquid = num(r.liquid, 0)
	const T = num(r.temp, 20)
	let made = 0
	let escaped = 0
	// (kg of CO2 in the vinegar (Henry's law: under a cap or a balloon), and whether the cap has popped off)
	let dissolved = 0
	let popped = false
	return {
		coarse: 8,
		start(ctx: ProcessContext) {
			ctx.set(item, "co2_g", 0)
			ctx.set(item, "escaped_g", 0)
			ctx.set(item, "balloon_ml", 0)
			ctx.set(item, "pressure_kpa", 101.325)
			ctx.set(item, "fizz", 0)
			ctx.set(item, "co2_dissolved_g", 0)
			ctx.set(item, "popped", 0)
		},
		slow(ctx: ProcessContext, dt: number) {
			const t = ctx.time()
			if (t < mixAt) return
			// the gas comes off as 1 − e^(−t/τ) of all it can make (fast at first): a modelling choice; τ in lesson seconds
			const lesson = (t - mixAt) * ctx.settings.timeLapse
			const before = made
			made = co2 * (1 - Math.exp(-lesson / tau))
			const rate = dt > 0 ? (made - before) / dt : 0
			let gas = made // in the bottle (capped) or the balloon
			let pressure = 101325
			let balloon = 0
			if (closure === "open" || popped) {
				// (open: what is made escapes; a popped cap: so does what was dissolved, over DEGAS_S)
				if (popped) dissolved = degas(dissolved, dt)
				escaped = made - dissolved
				gas = 0
			} else {
				// Henry's law: the vinegar holds its share of the gas (closed.ts)
				gas = closure === "cap" || closure === "balloon" ? co2Split(closure, made / 0.04401, liquid, headspace, T) * 0.04401 : made
				dissolved = made - gas
				const mol = gas / 0.04401
				if (closure === "cap") pressure = 101325 + (mol * R * (T + KELVIN)) / headspace
				if (closure === "balloon") balloon = (mol * R * (T + KELVIN)) / 101325
				if (closure === "cap" && capPops(pressure)) {
					// the cap lets go: the gas over the vinegar rushes out at once
					popped = true
					ctx.event(`the cap pops off ${item} past ${(CAP_POPS / 1000).toFixed(0)} kPa: the gas over the vinegar rushes out (${(gas * 1000).toFixed(2)} g), the rest of what is dissolved follows over minutes`, [item], "pops")
					escaped = gas
					gas = 0
					pressure = 101325
				}
			}
			// the scale weighs the bottle less what has escaped, less the buoyancy of the air the balloon now pushes aside (none in a vacuum)
			const apparent = soda - escaped - (ctx.settings.air ? airDensity(T) : 0) * balloon
			carry(ctx.solid(r.ballast as string), Math.max(0, apparent), soda, ctx)
			ctx.set(item, "co2_g", made * 1000)
			ctx.set(item, "escaped_g", escaped * 1000)
			ctx.set(item, "balloon_ml", balloon * 1e6)
			ctx.set(item, "pressure_kpa", pressure / 1000)
			ctx.set(item, "fizz", co2 > 0 ? Math.min(1, (rate * tau) / co2) : 0)
			ctx.set(item, "co2_dissolved_g", dissolved * 1000)
			ctx.set(item, "popped", popped ? 1 : 0)
		}
	}
}

// ---------------------------------------------------------------- a ball pumped up
const ballProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const a0 = num(r.start, 0.0067)
	const a1 = num(r.end, 0.012)
	const b0 = num(r.startBar, 0)
	const b1 = num(r.endBar, 0.8)
	const at = num(r.pumpAt, 1)
	const span = num(r.pumpFor, 3)
	const full = Math.max(a0, a1)
	return {
		start(ctx: ProcessContext) {
			ctx.set(item, "air_g", a0 * 1000)
			ctx.set(item, "gauge_bar", b0)
			carry(ctx.solid(r.ballast as string), a0, full, ctx)
		},
		step(ctx: ProcessContext) {
			const u = span > 0 ? Math.min(1, Math.max(0, (ctx.time() - at) / span)) : ctx.time() >= at ? 1 : 0
			const air = a0 + (a1 - a0) * u
			ctx.set(item, "air_g", air * 1000)
			ctx.set(item, "gauge_bar", b0 + (b1 - b0) * u)
			carry(ctx.solid(r.ballast as string), air, full, ctx)
		}
	}
}

// ---------------------------------------------------------------- mixtures, sieves and magnets
const grainsProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const comps = (Array.isArray(r.components) ? (r.components as { key?: unknown; mass?: unknown }[]) : [])
		.map((c) => ({ grain: GRAINS[str(c.key, "sand")], mass: num(c.mass, 0) }))
		.filter((c): c is { grain: NonNullable<(typeof GRAINS)[string]>; mass: number } => c.grain !== undefined)
	const origin = (r.origin ?? {}) as { x?: number; y?: number }
	const ox = num(origin.x, 0)
	const oy = num(origin.y, 0)
	const magnet = r.magnet as { item?: string; br?: number; length?: number; area?: number; inset?: number } | null | undefined
	const width = num(r.width, 0.15)
	const wall = num(r.wall, 0.035)
	const aperture = num(r.aperture, 0)
	const sieveHeight = num(r.sieveHeight, 0)
	const mix = new Mixture({
		components: comps,
		grains: Math.round(num(r.grains, 150)),
		width,
		wall,
		pour: bool(r.pour),
		pourHeight: 0.1,
		aperture,
		wire: num(r.wire, 0.0008),
		sieveHeight,
		sieveWidth: num(r.sieveWidth, 0.16),
		shake: num(r.shake, 0),
		shakeHz: num(r.shakeHz, 0),
		shakeFrom: num(r.shakeFrom, 0),
		shakeUntil: num(r.shakeUntil, 0),
		seed: Math.round(num(r.seed, 1))
	})
	const total = comps.reduce((a, c) => a + c.mass, 0) / 1000
	const pos: number[] = new Array(2 * mix.p.n).fill(0)
	const codes: number[] = Array.from(mix.p.kind)
	const magnetOutline = { points: [] as number[], cx: 0, cy: 0, vx: 0, vy: 0, w: 0, restitution: 0.2, friction: 0.6, push: { x: 0, y: 0, m: 0 } }
	const wand = r.wand as { from?: number; until?: number; height?: number; lift?: number; br?: number; length?: number; radius?: number; rod?: number } | null | undefined
	const wandOutline = { points: [] as number[], cx: 0, cy: 0, vx: 0, vy: 0, w: 0, restitution: 0.2, friction: 0.8, push: { x: 0, y: 0, m: 0 } }
	/** The wand tip's place at run time t, in the system's frame (the inside's floor centre). */
	const wandAt = (t: number) => {
		const from = num(wand?.from, 0.5)
		const until = num(wand?.until, 3)
		const low = num(wand?.height, 0.025)
		const high = num(wand?.lift, 0.085)
		const rod = num(wand?.rod, 0.008)
		const x0 = -width / 2 + rod + 0.004
		const x1 = width / 2 - rod - 0.004
		const D = Math.min(0.4, (until - from) / 4)
		const ease = (u: number) => {
			const v = Math.min(1, Math.max(0, u))
			return v * v * (3 - 2 * v)
		}
		if (t < from) return { x: x0, y: high }
		if (t < from + D) return { x: x0, y: high + (low - high) * ease((t - from) / D) }
		if (t < until - D) return { x: x0 + (x1 - x0) * ease((t - from - D) / Math.max(1e-6, until - from - 2 * D)), y: low }
		if (t < until) return { x: x1, y: low + (high - low) * ease((t - until + D) / D) }
		return { x: x1, y: high }
	}
	const publish = (ctx: ProcessContext) => {
		const p = mix.p
		for (let i = 0; i < p.n; i++) {
			pos[2 * i] = p.x[i] as number
			pos[2 * i + 1] = p.y[i] as number
		}
		ctx.series(item, "p", pos)
		ctx.series(item, "k", codes)
		if (aperture > 0) {
			const sh = mix.shares()
			const a = sh[0] ?? { passed: 0 }
			const b = sh[1] ?? { passed: 0 }
			ctx.set(item, "a_passed_pct", 100 * a.passed)
			ctx.set(item, "b_passed_pct", 100 * b.passed)
			ctx.set(item, "a_passed_g", a.passed * (comps[0]?.mass ?? 0))
			ctx.set(item, "b_passed_g", b.passed * (comps[1]?.mass ?? 0))
			ctx.set(item, "sieve_x", mix.sieveOffset())
		} else {
			// in the dish: below its rim and between its walls, and not clinging to a magnet (within 2 mm of its outline)
			const p = mix.p
			const n = comps.length
			const inside = new Array(n).fill(0) as number[]
			const count = new Array(n).fill(0) as number[]
			const all = mix.p.outlines.map((o) => o.points).filter((q) => q.length >= 6)
			for (let i = 0; i < p.n; i++) {
				const c = mix.component[i] as number
				count[c] = (count[c] as number) + 1
				const x = p.x[i] as number
				const y = p.y[i] as number
				let held = false
				for (const pts of all) {
					const reach = (p.r[i] as number) + 0.002
					let near = Infinity
					for (let a = 0; a < pts.length; a += 2) {
						const x1 = pts[a] as number
						const y1 = pts[a + 1] as number
						const x2 = pts[(a + 2) % pts.length] as number
						const y2 = pts[(a + 3) % pts.length] as number
						const ex = x2 - x1
						const ey = y2 - y1
						const len2 = ex * ex + ey * ey
						const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - x1) * ex + (y - y1) * ey) / len2)) : 0
						const dx = x - x1 - u * ex
						const dy = y - y1 - u * ey
						near = Math.min(near, dx * dx + dy * dy)
					}
					if (near < reach * reach) held = true
				}
				if (!held && x >= -width / 2 - 0.01 && x <= width / 2 + 0.01 && y >= -0.01 && y <= wall + 0.002) inside[c] = (inside[c] as number) + 1
			}
			const a = { inside: (count[0] ?? 0) > 0 ? (inside[0] as number) / (count[0] as number) : 1 }
			const b = { inside: (count[1] ?? 0) > 0 ? (inside[1] as number) / (count[1] as number) : 1 }
			ctx.set(item, "a_left_pct", 100 * a.inside)
			ctx.set(item, "b_left_pct", 100 * b.inside)
			ctx.set(item, "a_out_g", (1 - a.inside) * (comps[0]?.mass ?? 0))
			ctx.set(item, "b_out_g", (1 - b.inside) * (comps[1]?.mass ?? 0))
			const weighed = (a.inside * (comps[0]?.mass ?? 0) + b.inside * (comps[1]?.mass ?? 0)) / 1000
			ctx.set(item, "weighed_g", weighed * 1000)
			if (typeof r.ballast === "string") carry(ctx.solid(r.ballast), weighed, total, ctx)
		}
	}
	return {
		start(ctx: ProcessContext) {
			publish(ctx)
		},
		step(ctx: ProcessContext) {
			const floor = ctx.solid(r.solid as string)
			mix.field = undefined
			mix.p.outlines.length = 0
			let wandField: FieldAt | undefined
			if (wand) {
				// the wand: lowered at the dish's left end, swept to its right end, lifted out (smooth moves); its tip magnet's field and its outline
				const t = ctx.time()
				const at0 = wandAt(t)
				const at1 = wandAt(t + ctx.step)
				const L = num(wand.length, 0.025)
				const rad = num(wand.radius, 0.00635)
				// (a cylinder magnet: its poles at its faces, each a disc of its radius: softened over R²/3, see barMagnet)
				wandField = barMagnet(at0.x, at0.y + L / 2, Math.PI / 2, L, Math.PI * rad * rad, num(wand.br, 1.3), (rad * rad) / 3)
				const rod = num(wand.rod, 0.008)
				wandOutline.points = [at0.x - rod, at0.y, at0.x + rod, at0.y, at0.x + rod, at0.y + 0.15, at0.x - rod, at0.y + 0.15]
				wandOutline.cx = at0.x
				wandOutline.cy = at0.y
				wandOutline.vx = (at1.x - at0.x) / ctx.step
				wandOutline.vy = (at1.y - at0.y) / ctx.step
				mix.p.outlines.push(wandOutline)
				mix.field = wandField
				ctx.set(item, "wand_x", at0.x)
				ctx.set(item, "wand_y", at0.y)
			}
			if (magnet && typeof magnet.item === "string" && floor !== undefined) {
				const mh = ctx.solidsOf(magnet.item).find((h) => h.part.body.kind !== "ball") ?? ctx.solidsOf(magnet.item)[0]
				if (mh !== undefined) {
					// the magnet in the container's frame (the system's origin is the inside's floor centre): its field (two poles) and its outline
					const mp = mh.pose()
					const c = toLocal(floor, mp.x, mp.y)
					const angle = mp.angle - c.angle
					const field: FieldAt = barMagnet(c.x - ox, c.y - oy, angle, Math.max(0.005, num(magnet.length, 0.15) - 2 * num(magnet.inset, 0.005)), num(magnet.area, 1.8e-4), num(magnet.br, 0.39))
					mix.field = wandField === undefined ? field : (x: number, y: number) => {
						const a = field(x, y)
						const b = (wandField as FieldAt)(x, y)
						return { bx: a.bx + b.bx, by: a.by + b.by }
					}
					const o = mh.outline()
					const pts: number[] = []
					if (o.points !== undefined) {
						for (const q of o.points) {
							const l = toLocal(floor, q.x, q.y)
							pts.push(l.x - ox, l.y - oy)
						}
						magnetOutline.points = pts
						magnetOutline.cx = c.x - ox
						magnetOutline.cy = c.y - oy
						mix.p.outlines.push(magnetOutline)
					}
				}
			}
			mix.advance(ctx.step, ctx.time(), ctx.released())
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- filtering
const filterProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const paper = PAPERS[str(r.paper, "filter paper")] ?? (PAPERS["filter paper"] as NonNullable<(typeof PAPERS)[string]>)
	const solid = FILTER_SOLIDS[str(r.undissolved, "none")]
	const water = Math.max(0, num(r.water, 1e-4))
	const solidMass = solid === undefined ? 0 : Math.max(0, num(r.undissolvedMass, 0))
	const dissolvedMass = Math.max(0, num(r.dissolvedMass, 0))
	const crystals = Math.max(0, num(r.crystals, 0))
	const rinse = Math.max(0, num(r.rinse, 0))
	let f: Filter | undefined
	let saidDrip = false
	let saidDone = false
	const publish = (ctx: ProcessContext) => {
		const F = f as Filter
		const all = water + rinse
		if (!saidDrip && F.filtrate > 5e-8) {
			saidDrip = true
			ctx.event(`the filtrate starts dripping from ${item} into its beaker${solid !== undefined && !F.keeps() ? " (cloudy)" : ""}`, [item], "drips")
		}
		if (!saidDone && F.cup <= 0 && F.rinseLeft <= 0 && F.free <= 0) {
			saidDone = true
			ctx.event(`everything has run through ${item} (${(F.filtrate * 1e6).toFixed(0)} mL in its beaker, ${(F.kept() * 1000).toFixed(1)} g on its paper)`, [item], "drained")
		}
		ctx.set(item, "poured_ml", (all - F.cup - F.rinseLeft) * 1e6)
		ctx.set(item, "in_funnel_ml", F.free * 1e6)
		ctx.set(item, "held_ml", F.held * 1e6)
		ctx.set(item, "filtrate_ml", F.filtrate * 1e6)
		ctx.set(item, "filtrate_pct", all > 0 ? (100 * F.filtrate) / all : 0)
		ctx.set(item, "salt_through_g", F.dissolvedOut * 1000)
		ctx.set(item, "salt_through_pct", dissolvedMass > 0 ? (100 * F.dissolvedOut) / dissolvedMass : 100)
		const undissolved = solidMass + crystals
		ctx.set(item, "kept_g", F.kept() * 1000)
		ctx.set(item, "through_g", F.through * 1000)
		ctx.set(item, "kept_pct", undissolved > 0 ? (100 * F.kept()) / undissolved : 100)
		ctx.set(item, "clear", F.through <= Math.max(1e-6, 0.01 * solidMass) ? 1 : 0)
		ctx.set(item, "flow_ml_min", F.flow * 6e7)
		ctx.set(item, "level_mm", F.level() * 1000)
		ctx.set(item, "clock_s", F.clock)
	}
	return {
		coarse: 8,
		start(ctx: ProcessContext) {
			f = new Filter({
				funnel: num(r.funnel, 0.075),
				paper,
				water,
				temperature: num(r.temp, 20),
				...(solid === undefined ? {} : { solid }),
				solidMass,
				dissolvedMass,
				crystals,
				pourAt: num(r.pourAt, 0.5),
				pourFor: num(r.pourFor, 3),
				rinse,
				gravity: ctx.settings.gravity
			})
			publish(ctx)
		},
		slow(ctx: ProcessContext, dt: number) {
			;(f as Filter).step(dt, ctx.time(), dt / ctx.settings.timeLapse)
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- evaporating
const evaporateProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const solute = SOLUTES[str(r.solute, "salt")] ?? (SOLUTES.salt as NonNullable<(typeof SOLUTES)[string]>)
	const water = Math.max(0, num(r.water, 0.05))
	const mass = Math.max(0, num(r.mass, 0.005))
	const heat = str(r.heat, "hot plate")
	const heatFrom = num(r.heatFrom, 1)
	let d: Dish | undefined
	const said = { boil: false, crystals: false, dry: false, start: true, vacuum: false }
	const publish = (ctx: ProcessContext) => {
		const D = d as Dish
		// (crystals there from the start, more than the water could dissolve, did not "appear")
		if (said.start) {
			said.crystals = D.crystals > 1e-6
			said.start = false
		}
		if (!said.boil && D.boiling) {
			said.boil = true
			ctx.event(`${item} starts to boil (${D.T.toFixed(1)} °C)`, [item], "boils")
		}
		if (!said.crystals && D.crystals > 1e-6 && D.water > 0) {
			said.crystals = true
			ctx.event(`${solute.key === "sugar" ? "sugar" : "salt"} crystals appear in ${item} (the water left is saturated)`, [item], "crystals")
		}
		if (!said.dry && D.water <= 0 && D.evaporated + D.boiled > 0) {
			said.dry = true
			ctx.event(`${item} is dry: ${(D.crystals * 1000).toFixed(1)} g of crystals left`, [item], "dry")
		}
		ctx.set(item, "water_g", D.water * 1000)
		ctx.set(item, "temp_c", D.T)
		ctx.set(item, "dissolved_g", D.dissolved * 1000)
		ctx.set(item, "crystals_g", D.crystals * 1000)
		ctx.set(item, "strength_pct", D.strength())
		ctx.set(item, "saturated", D.crystals > 0 && D.water > 0 ? 1 : 0)
		ctx.set(item, "dry", D.water <= 0 ? 1 : 0)
		ctx.set(item, "boiling", D.boiling ? 1 : 0)
		ctx.set(item, "evaporated_g", (D.evaporated + D.boiled) * 1000)
		ctx.set(item, "loss_g_min", D.rate * 6e4)
		ctx.set(item, "level_mm", D.level() * 1000)
		ctx.set(item, "clock_s", D.clock)
		const weighed = D.water + D.dissolved + D.crystals
		ctx.set(item, "weighed_g", weighed * 1000)
		carry(ctx.solid(r.ballast as string), weighed, water + mass, ctx)
	}
	return {
		coarse: 8,
		start(ctx: ProcessContext) {
			d = new Dish({
				rim: num(r.rim, 0.045),
				depth: num(r.depth, 0.035),
				dish: num(r.dish, 0.11),
				water,
				start: num(r.start, 20),
				solute,
				soluteMass: mass,
				heat: heat === "sun" || heat === "room" ? heat : "hot plate",
				power: num(r.power, 300),
				room: ctx.settings.roomTemperature,
				humidity: num(r.humidity, 0.5)
			})
			publish(ctx)
		},
		slow(ctx: ProcessContext, dt: number) {
			// (the hot plate is switched on, or the dish set out, at heatFrom: until then nothing changes)
			if (!ctx.settings.air) {
				// a vacuum: water boils there at room temperature and freezes as it boils (it cools itself), which this model of a dish in a
				// room's air does not do: it is refused (said once; nothing changes; mod_matter.py warns before the run)
				if (!said.vacuum) {
					said.vacuum = true
					ctx.event(`${item} needs air: in a vacuum its water would boil at room temperature and freeze, which this model does not show (nothing evaporates)`, [item], "vacuum")
				}
			} else if (ctx.time() >= heatFrom) (d as Dish).step(dt)
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- density blocks
const blockProcess = (r: ProcessRecord) => {
	const item = r.item as string
	return {
		start(ctx: ProcessContext) {
			ctx.set(item, "mass_g", num(r.mass, 0) * 1000)
			ctx.set(item, "volume_cm3", num(r.volume, 0) * 1e6)
			ctx.set(item, "density_gcm3", num(r.density, 0) / 1000)
		}
	}
}

const matter: ProcessKind = {
	kind: "matter",
	check(record: ProcessRecord, solids: ReadonlySet<string>) {
		const role = record.role
		if (typeof role !== "string" || !(MATTER_ROLES as readonly string[]).includes(role)) return `role must be one of ${MATTER_ROLES.join(", ")} (it is ${String(role)})`
		for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
			const v = record[key]
			if (v === undefined || v === null) continue
			if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) return `${key} must be a number from ${lo} to ${hi}, not ${String(v)}`
		}
		for (const key of ["solid", "ballast"]) {
			const v = record[key]
			if (typeof v === "string" && !solids.has(v)) return `its ${key} "${v}" is not a solid of the document`
		}
		if (role === "bar" && Array.isArray(record.pieces) && (record.pieces as unknown[]).some((p) => typeof p !== "string" || !solids.has(p)))
			return "a piece of the bar is not a solid of the document"
		if ((CHEM_ROLES as readonly string[]).includes(role)) return chemProblem(record)
		return undefined
	},
	create(record, ctx) {
		switch (record.role) {
			case "box":
				return boxProcess(record, ctx)
			case "balloon":
				return balloonProcess(record)
			case "glass":
				return glassProcess(record)
			case "bag":
				return bagProcess(record)
			case "bar":
				return barProcess(record)
			case "reaction":
				return reactionProcess(record)
			case "ball":
				return ballProcess(record)
			case "grains":
				return grainsProcess(record)
			case "filter":
				return filterProcess(record)
			case "evaporate":
				return evaporateProcess(record)
			case "pack":
			case "warmer":
			case "rust":
			case "indicator":
			case "precip":
			case "atoms":
				return chemProcess(record)
			default:
				return blockProcess(record)
		}
	}
}

void FREE
void LIQUID
void SOLID

export default matter
