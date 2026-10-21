// Unit tests of separating by filtering and evaporating (tooling/src/sim/matter/separate.ts): node --test tooling/src/sim/matter/separate.test.ts
// Filtering: the cone's exponential drain against its time constant τ = sin30°·μ·R/(share·ρ·g) from Darcy's law and Whatman Grade 1's Herzberg
// flow time; what the paper keeps (sand, chalk's flocs) and lets through (salt); the water held by the wet paper and the rinse that carries its
// salt; every drop and gram accounted for; a cake's resistance by Kozeny-Carman; warm water faster. Evaporating: the boiling point raised by the
// salt; crystals once saturated (26.4 % salt); all of it left when dry; the energy a hot plate puts in against what the water took; the room's
// slow evaporation against Chilton-Colburn; drier air faster; determinism.
import { test } from "node:test"
import assert from "node:assert/strict"
import { Dish, type DishSpec, Filter, FILTER_SOLIDS, type FilterSpec, FULL, kozenyCarman, PAPERS, PLATE_SHARE, SHARE } from "./separate.ts"
import { SOLUTES, solubility, table, WATER_DENSITY, WATER_VISCOSITY } from "./substances.ts"

const rel = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${what}: ${a} vs ${b} (±${tol * 100}%)`)

const FILTER: FilterSpec = {
	funnel: 0.075,
	paper: PAPERS["filter paper"]!,
	water: 100e-6,
	temperature: 20,
	solid: FILTER_SOLIDS.sand,
	solidMass: 0.01,
	dissolvedMass: 0.005,
	crystals: 0,
	pourAt: 0,
	pourFor: 0.1,
	rinse: 10e-6,
	gravity: 9.81
}
/** Runs a filter for `lesson` s of lesson time in steps of `dt`, its pour paced by `lapse` (lesson s a run second). */
const filterFor = (spec: FilterSpec, lesson: number, dt = 1, lapse = 60) => {
	const f = new Filter(spec)
	for (let t = 0; t < lesson; t += dt) f.step(dt, t / lapse, dt / lapse)
	return f
}

test("Whatman Grade 1's resistance is its Herzberg flow time (100 mL through 10 cm² under a 10 cm head in 150 s)", () => {
	const mu = table(WATER_VISCOSITY, 20)
	const rho = table(WATER_DENSITY, 20)
	const Q = 100e-6 / 150
	rel(PAPERS["filter paper"]!.resistance, (rho * 9.81 * 0.1 * 10e-4) / (mu * Q), 0.005, "R from Herzberg")
})

test("a full funnel drains exponentially with τ = sin30°·μ·R/(share·ρ·g) (Darcy's law in a 60° cone)", () => {
	const spec = { ...FILTER, solid: undefined, solidMass: 0, rinse: 0 }
	const f = new Filter(spec)
	// fill it at once, then watch it drain
	f.step(1e-6, 0, 1)
	const V0 = f.free
	const tau = (0.5 * table(WATER_VISCOSITY, 20) * PAPERS["filter paper"]!.resistance) / (SHARE * table(WATER_DENSITY, 20) * 9.81)
	rel(f.tau(), tau, 1e-9, "τ")
	assert.ok(tau > 100 && tau < 130, `about two minutes: ${tau}`)
	for (let k = 0; k < 100; k++) f.step(1, 0, 0)
	rel(f.free, (V0 * Math.exp(-100 / tau)) as number, 1e-6, "V(100 s)")
	rel(f.capacity, ((Math.PI * 0.5773502691896257 ** 2) / 3) * (FULL * 0.075) ** 3, 1e-9, "capacity")
	assert.ok(f.capacity * 1e6 > 30 && f.capacity * 1e6 < 40, `a 75 mm funnel holds about 34 mL above the paper: ${f.capacity * 1e6}`)
})

test("filter paper keeps the sand and lets the salt water through; the rinse carries the held salt; nothing is lost", () => {
	const f = filterFor(FILTER, 4000)
	rel(f.kept(), 0.01, 1e-12, "all the sand on the paper")
	assert.equal(f.through, 0, "none through")
	// every drop: through + held + free = poured
	rel(f.filtrate + f.held + f.free, 110e-6, 1e-12, "water")
	rel(f.dissolvedIn + f.dissolvedOut, 0.005, 1e-12, "salt")
	assert.ok(f.dissolvedOut / 0.005 >= 0.98, `with a 10 mL rinse at least 98 % of the salt through: ${f.dissolvedOut / 0.005}`)
	const noRinse = filterFor({ ...FILTER, rinse: 0 }, 4000)
	assert.ok(noRinse.dissolvedOut < f.dissolvedOut && noRinse.dissolvedOut / 0.005 < 0.97, `without it the wet paper and sand keep their share: ${noRinse.dissolvedOut / 0.005}`)
	// the wet paper and the cake's pores hold their water: 2 mL and 10 g of sand's 40 % pores
	rel(f.held, 2e-6 + ((0.01 / 2650) * 0.4) / 0.6, 1e-9, "held")
})

test("what a paper keeps: chalk's flocs on filter paper, not in a coffee filter; no paper keeps nothing", () => {
	const chalk = { ...FILTER, solid: FILTER_SOLIDS.chalk, solidMass: 0.002, dissolvedMass: 0 }
	const paper = filterFor(chalk, 30000, 5)
	const coffee = filterFor({ ...chalk, paper: PAPERS["coffee filter"]! }, 30000, 5)
	const none = filterFor({ ...FILTER, paper: PAPERS.none! }, 600)
	rel(paper.kept(), 0.002, 1e-12, "filter paper keeps the chalk")
	assert.ok(coffee.kept() === 0 && coffee.through > 0.0019, `the coffee filter's filtrate is cloudy: ${coffee.through}`)
	assert.ok(none.through > 0.0099 && none.kept() === 0, "no paper: the sand runs through")
})

test("a cake of fine chalk slows the filtering (Kozeny-Carman), sand's hardly; warm water runs faster", () => {
	assert.ok(kozenyCarman(2.5e-4, 0.4) / kozenyCarman(5e-6, 0.5) > 100, "sand's bed is far more permeable")
	const sand = new Filter({ ...FILTER })
	const chalk = new Filter({ ...FILTER, solid: FILTER_SOLIDS.chalk, solidMass: 0.01 })
	sand.cake = 0.01
	chalk.cake = 0.01
	const bare = new Filter({ ...FILTER, solidMass: 0 })
	assert.ok(sand.tau() / bare.tau() < 1.05, `10 g of sand adds under 5 %: ${sand.tau() / bare.tau()}`)
	assert.ok(chalk.tau() / bare.tau() > 5, `10 g of chalk slows it many times: ${chalk.tau() / bare.tau()}`)
	const warm = new Filter({ ...FILTER, temperature: 50 })
	rel(bare.tau() / warm.tau(), table(WATER_VISCOSITY, 20) / table(WATER_VISCOSITY, 50) * (table(WATER_DENSITY, 50) / table(WATER_DENSITY, 20)), 1e-9, "μ/ρ")
	assert.ok(bare.tau() / warm.tau() > 1.7, "about twice as fast at 50 °C")
})

const DISH: DishSpec = { rim: 0.045, depth: 0.035, dish: 0.11, water: 0.05, start: 20, solute: SOLUTES.salt!, soluteMass: 0.005, heat: "hot plate", power: 300, room: 20, humidity: 0.5 }
const dishFor = (spec: DishSpec, lesson: number, dt: number, watch?: (d: Dish, t: number) => void) => {
	const d = new Dish(spec)
	for (let t = 0; t < lesson; t += dt) {
		d.step(dt)
		watch?.(d, t + dt)
	}
	return d
}

test("a hot plate boils salt water at its raised boiling point, crystals appear at saturation, all the salt is left when dry", () => {
	let boilT = 0
	let satWater = -1
	let satStrength = 0
	const d = dishFor(DISH, 3000, 5, (x) => {
		if (x.boiling && boilT === 0) boilT = x.T
		if (satWater < 0 && x.crystals > 0 && x.water > 0) {
			satWater = x.water
			satStrength = x.strength()
		}
	})
	// 5 g of salt in 50 g of water: 1.71 mol/kg, + 0.512 × 2 × 1.71 = 101.75 °C (CRC: K_b 0.512 K·kg/mol)
	rel(boilT, 100 + (0.512 * 2 * (0.005 / 0.05844)) / 0.0499, 0.002, "boiling point")
	// crystals once the water holds no more: 5 g in 5 / 0.37 g of water at about 107 °C (the solubility at the dish's temperature)
	rel(satWater, 0.005 / solubility(SOLUTES.salt!, 100), 0.03, "water left at saturation")
	assert.ok(satStrength > 26 && satStrength < 28.5, `saturated brine is 26-28 % salt: ${satStrength}`)
	assert.equal(d.water, 0)
	rel(d.crystals, 0.005, 1e-12, "all the salt left")
	rel(d.evaporated + d.boiled, 0.05, 1e-12, "all the water gone")
})

test("the hot plate's heat: half its power heats the water and boils it away (within the losses to the room)", () => {
	let dry = 0
	dishFor(DISH, 3000, 2, (x, t) => {
		if (!dry && x.water <= 0) dry = t
	})
	// energy to dryness: warm 50 g from 20 °C to ~102 °C, boil it (2257 kJ/kg), warm the 110 g dish
	const E = 0.05 * 4184 * 82 + 0.05 * 2257e3 + 0.11 * 830 * 87
	const ideal = E / (PLATE_SHARE * 300)
	assert.ok(dry > ideal && dry < ideal * 1.3, `dry after ${dry} s: the ideal ${ideal.toFixed(0)} s plus the room's losses (convection, radiation)`)
})

test("in a room the water evaporates slowly (Chilton-Colburn: a few g a day), faster in dry air and in the sun", () => {
	const room = { ...DISH, heat: "room" as const }
	const day = dishFor(room, 86400, 300)
	const lostRoom = 0.05 - day.water
	// (still indoor air takes about 0.5-3 mm of water a day off an open dish: 2-14 g from this one's 47 cm²; its first day, full and wide, the most)
	const mm = lostRoom / 998 / (Math.PI * 0.0385 * 0.0385) * 1000
	assert.ok(mm > 0.5 && mm < 3, `${(lostRoom * 1000).toFixed(1)} g in the first day: ${mm.toFixed(2)} mm`)
	const dry = dishFor({ ...room, humidity: 0.2 }, 86400, 300)
	assert.ok(0.05 - dry.water > lostRoom * 1.3, "drier air takes more")
	const sun = dishFor({ ...DISH, heat: "sun" }, 86400, 300)
	assert.ok(0.05 - sun.water > lostRoom * 1.5, "the sun's warmth takes more")
	// it cools below the room as it evaporates (a wet bulb)
	assert.ok(day.T < 20, `evaporation cools it: ${day.T}`)
})

test("the salt's water activity lowers the vapour (NaCl: 0.753 saturated, Robinson & Stokes); sugar by Norrish", () => {
	const d = new Dish({ ...DISH, soluteMass: 0 })
	assert.equal(d.activity(), 1)
	const sat = new Dish({ ...DISH, water: 0.1, soluteMass: 0.0359 })
	assert.ok(Math.abs(sat.activity() - 0.755) < 0.01, `saturated brine: ${sat.activity()}`)
	const syrup = new Dish({ ...DISH, solute: SOLUTES.sugar!, water: 0.1, soluteMass: 0.2 })
	assert.ok(syrup.activity() > 0.83 && syrup.activity() < 0.87, `saturated sucrose about 0.85: ${syrup.activity()}`)
})

test("deterministic: the same dish and filter give the same numbers, bit for bit", () => {
	const a = dishFor(DISH, 2000, 7)
	const b = dishFor(DISH, 2000, 7)
	assert.equal(a.T, b.T)
	assert.equal(a.crystals, b.crystals)
	const f1 = filterFor(FILTER, 1500)
	const f2 = filterFor(FILTER, 1500)
	assert.equal(f1.filtrate, f2.filtrate)
	assert.equal(f1.dissolvedOut, f2.dissolvedOut)
})
