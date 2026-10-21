// Unit tests of the matter module's physics core (tooling/src/sim/matter/*.ts): node --test tooling/src/sim/matter/matter.test.ts
// Each test checks a law against the model: restitution, rest, the ideal gas (P = nRT/V from the particles' hits), Boyle, Charles, Graham,
// the heating curve, the states, mixing, dissolving (solubility, rates: hot > cold, stirred > still, fine > coarse; mass conserved), sieving,
// a magnet pulling iron out of sand, settling at the drag law's terminal speed, and determinism.
import { test } from "node:test"
import assert from "node:assert/strict"
import { dampingRatio, FREE, LIQUID, noPullRestitution, Particles, random, SOLID } from "./particles.ts"
import { ATM, heatAt, KELVIN, meanSpeed, rmsSpeed, SOLUTES, stateAt, SUBSTANCES, solubility } from "./substances.ts"
import { ParticleBox, type BoxSpec, SPEED_SCALE } from "./box.ts"
import { diffusivity, dissolveRate, lifetime, saturated } from "./dissolve.ts"
import { Glass, type GlassSpec } from "./glass.ts"
import { barMagnet, GRAINS, Mixture, type MixtureSpec } from "./grains.ts"

const near = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`)
const rel = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${what}: ${a} vs ${b} (±${tol * 100}%)`)
const H = 1 / 480

const BOX: BoxSpec = {
	width: 0.16,
	height: 0.16,
	substance: SUBSTANCES.air as never,
	count: 64,
	radius: 0.004,
	mass: 0.0012,
	volume: 0.001,
	start: 20,
	heater: 0,
	heatFrom: 0,
	piston: false,
	pistonAt: 0.6,
	load: 0,
	area: 0.0007,
	outside: ATM,
	divider: false,
	openAt: 0,
	seed: 1
}

/** Runs a box for `secs`, heating on the 10 Hz beat with a time-lapse; returns the mean of a reading over the last `avg` seconds. */
const runBox = (spec: Partial<BoxSpec>, secs: number, lapse = 1, avg = 0, key: keyof ParticleBox["readings"] = "pressure") => {
	const b = new ParticleBox({ ...BOX, ...spec })
	let sum = 0
	let n = 0
	for (let k = 0; k <= Math.round(secs * 480); k++) {
		if (k % 48 === 0) b.heat(48 * H * lapse, k * H)
		b.advance(H, k * H)
		if (avg > 0 && k * H >= secs - avg && k % 24 === 0) {
			sum += b.readings[key] as number
			n++
		}
	}
	return { box: b, mean: n > 0 ? sum / n : NaN }
}

test("substances: real values (CRC)", () => {
	near(rmsSpeed(SUBSTANCES.air!.molar, 20), 502.3, 1, "air rms at 20 °C")
	near(meanSpeed(SUBSTANCES.air!.molar, 20), 462.8, 1, "air mean at 20 °C")
	near(rmsSpeed(SUBSTANCES.water!.molar, 100), 719.4, 1, "steam rms at 100 °C")
	near(solubility(SOLUTES.salt!, 20), 0.3589, 1e-9, "salt 35.89 g/100 g at 20 °C")
	near(solubility(SOLUTES.sugar!, 100), 4.872, 1e-9, "sugar 487.2 g/100 g at 100 °C")
	near(solubility(SOLUTES.sugar!, 25), (2.039 + 2.195) / 2, 1e-9, "interpolated")
	assert.equal(solubility(SOLUTES.sand!, 50), 0)
	// saturated brine: 26.4 % by mass, 1.197 g/cm³ → 316 kg/m³ of salt
	near(saturated(SOLUTES.salt!, 20), 316.3, 1, "saturated brine")
	near(diffusivity(SOLUTES.sugar!, 25), 5.228e-10, 1e-15, "D at 25 °C")
	rel(diffusivity(SOLUTES.sugar!, 80) / diffusivity(SOLUTES.sugar!, 20), ((80 + KELVIN) / (20 + KELVIN)) * (1.002 / 0.355), 1e-9, "Stokes-Einstein")
})

test("heating curve: plateaus hold the latent heat", () => {
	const w = SUBSTANCES.water!
	const m = 0.01
	for (const T of [-30, -1, 0.5, 20, 99, 100.5, 150]) near(stateAt(w, m, heatAt(w, m, T)).T, T, 1e-9, `round trip ${T} °C`)
	// from all solid at 0 °C: melting takes m·L = 3335.5 J at 0 °C, then 100 K of water (4184 J), then boiling 22570 J at 100 °C
	assert.deepEqual(stateAt(w, m, 0), { T: 0, solid: 1, liquid: 0, gas: 0 })
	const half = stateAt(w, m, (m * w.fusion) / 2)
	near(half.T, 0, 0)
	near(half.liquid, 0.5, 1e-12)
	const boiling = stateAt(w, m, m * w.fusion + m * w.cLiquid * 100 + (m * w.vaporization) / 4)
	near(boiling.T, 100, 1e-9)
	near(boiling.gas, 0.25, 1e-12)
	const dry = SUBSTANCES["carbon dioxide"]!
	const sub = stateAt(dry, m, (m * dry.vaporization) / 2)
	near(sub.T, -78.46, 1e-9)
	near(sub.gas, 0.5, 1e-12)
	assert.equal(sub.liquid, 0)
})

test("contacts: restitution exact for the spring-dashpot (bisection on exp)", () => {
	for (const e of [0.15, 0.3, 0.5, 0.8, 0.95]) near(noPullRestitution(dampingRatio(e)), e, 1e-12, `ζ(${e})`)
	// a contact that never pulls cannot be deader than ≈ 0.137 (Schwager & Pöschel): a lower e gets the most damping there is
	near(noPullRestitution(dampingRatio(0.05)), noPullRestitution(0.9999), 1e-3, "the floor")
	// small damping: the linear oscillator's e = exp(−πζ/√(1−ζ²)) (the force turns negative only at the very end)
	near(noPullRestitution(0.01), Math.exp((-Math.PI * 0.01) / Math.sqrt(1 - 0.0001)), 2e-4, "light damping")
	assert.equal(dampingRatio(1), 0)
	// two equal particles head on: the rebound speed ÷ the approach speed is e (to the sub-step's error)
	for (const e of [0.2, 0.5, 0.9]) {
		const kinds = [{ radius: 0.002, mass: 1e-4, restitution: e, friction: 0, magnetic: 0, volume: 3.35e-8 }]
		const p = new Particles(
			{ kinds, stiffness: 200, gravity: { x: 0, y: 0 }, gravityByPhase: [0, 0, 0], cohesionRange: 0, cohesionForce: 0, liquidDamping: 0, bondStiffness: 0, bondDamping: 0, bounds: { x0: -0.05, y0: -0.05, x1: 0.05, y1: 0.05 }, maxSubStep: 1e-5 },
			2
		)
		p.add(0, -0.003, 0, 0.5, 0)
		p.add(0, 0.003, 0, -0.5, 0)
		for (let k = 0; k < 4000; k++) p.step(1e-5)
		near((p.vx[1] as number) - (p.vx[0] as number), e * 1.0, 0.01 * e + 0.002, `e ${e}`)
	}
})

test("a grain rests on the floor, pressed in by its weight over the stiffness", () => {
	const kinds = [{ radius: 0.001, mass: 1.11e-5, restitution: 0.3, friction: 0.5, magnetic: 0, volume: 4.19e-9 }]
	const p = new Particles(
		{ kinds, stiffness: 100, gravity: { x: 0, y: -9.81 }, gravityByPhase: [1, 1, 1], cohesionRange: 0, cohesionForce: 0, liquidDamping: 0, bondStiffness: 0, bondDamping: 0, bounds: { x0: -0.05, y0: -0.01, x1: 0.05, y1: 0.05 }, maxSubStep: 1e-4 },
		1
	)
	p.addWall({ ax: -0.05, ay: 0, bx: 0.05, by: 0, r: 0, group: 0, restitution: 0.3, friction: 0.5 })
	p.add(0, 0, 0.01, 0, 0)
	for (let k = 0; k < 20000; k++) p.step(5e-5)
	near(p.y[0] as number, 0.001 - (1.11e-5 * 9.81) / 100, 1e-8, "rest height")
	near(p.vy[0] as number, 0, 1e-9, "at rest")
})

test("ideal gas: the particles' hits read P = nRT/V within 5 % (soft discs at packing 0.03-0.44)", () => {
	for (const count of [32, 64, 120]) {
		const { box, mean } = runBox({ count }, 6, 1, 4)
		rel(mean * 1000, box.idealPressure(20), 0.05, `${count} particles`)
	}
	// (a gauge on 64 particles reads within about ±5 % over a few seconds: three runs averaged)
	for (const T of [200, -150]) {
		let r = 0
		for (const seed of [1, 2, 3]) {
			const run = runBox({ start: T, seed }, 6, 1, 5)
			r += (run.mean * 1000) / run.box.idealPressure(T) / 3
		}
		near(r, 1, 0.05, `at ${T} °C`)
	}
	rel(runBox({ start: 200 }, 0.01).box.idealPressure(200) / runBox({}, 0.01).box.idealPressure(20), (200 + KELVIN) / (20 + KELVIN), 1e-12, "P ∝ T")
})

test("the thermostat holds the particles' energy at the temperature; the model speed is SPEED_SCALE of the real", () => {
	const b = new ParticleBox({ ...BOX, start: 50 })
	let e = 0
	let v2 = 0
	let n = 0
	for (let k = 0; k < 960; k++) {
		b.advance(H, k * H)
		if (k >= 480 && k % 12 === 0) {
			const t = b.p.thermal(1 << FREE)
			e += t.energy / t.count
			for (let i = 0; i < b.p.n; i++) v2 += ((b.p.vx[i] as number) ** 2 + (b.p.vy[i] as number) ** 2) / b.p.n
			n++
		}
	}
	rel(e / n, b.kT(50, SUBSTANCES.air!), 0.02, "kT per particle")
	rel(Math.sqrt(v2 / n), SPEED_SCALE * rmsSpeed(SUBSTANCES.air!.molar, 50), 0.02, "rms speed")
})

test("Boyle and Charles: a piston settles where the gas holds its load", () => {
	// 1 atm + 1 kg on 7 cm² = 115.3 kPa: V = 1000 mL × 101.0 / 115.3
	const outside = ATM
	const load = 1
	const P1 = outside + (load * 9.81) / 0.0007
	const boyle = runBox({ piston: true, load }, 8, 1, 5, "volume")
	const V0 = boyle.box.idealPressure(20) // (at the run's end; recompute at the start volume)
	void V0
	const start = new ParticleBox({ ...BOX, piston: true, load }).idealPressure(20)
	rel(boyle.mean, (1000 * start) / P1, 0.08, "Boyle: V = V0·P0/P")
	const heavy = runBox({ piston: true, load: 4 }, 8, 1, 5, "volume")
	assert.ok(heavy.mean < boyle.mean * 0.85, `more load, less volume (${heavy.mean} < ${boyle.mean})`)
	// Charles: no load, 20 °C → 100 °C: V ∝ T
	const cold = runBox({ piston: true, load: 0 }, 8, 1, 5, "volume")
	const warm = runBox({ piston: true, load: 0, start: 100 }, 8, 1, 5, "volume")
	rel(warm.mean / cold.mean, (100 + KELVIN) / (20 + KELVIN), 0.08, "Charles: V ∝ T")
})

test("a sealed syringe pushed from 60 to 30 mL reads twice the pressure (Boyle), within 6 %", () => {
	const H = 0.1072 * 1.05
	let r = 0
	for (const seed of [1, 2, 3]) {
		const run = runBox({ width: 0.0267, height: H, count: 36, radius: 0.00152, mass: 1.2041 * 60e-6, volume: 60e-6, piston: true, pistonAt: 0.1072 / H, area: (Math.PI * 0.0267 ** 2) / 4, drive: { from: 1, until: 3, to: 0.0536 / H }, seed }, 7, 1, 3, "pressure")
		near(run.box.readings.volume, 30, 1e-9, "the plunger at 30 mL")
		r += (run.mean * 1000) / 202650 / 3
	}
	near(r, 1, 0.06, "p·V constant: 202.65 kPa")
})

test("Graham: two gases at one temperature, the lighter's particles faster by √(M2/M1)", () => {
	const b = new ParticleBox({ ...BOX, second: SUBSTANCES.bromine, divider: true, openAt: 100 })
	const sp = [0, 0]
	const n = [0, 0]
	for (let k = 0; k < 480 * 4; k++) {
		b.advance(H, k * H)
		if (k < 480 || k % 12 !== 0) continue
		for (let i = 0; i < b.p.n; i++) {
			const kind = b.p.kind[i] as number
			sp[kind] = (sp[kind] as number) + (b.p.vx[i] as number) ** 2 + (b.p.vy[i] as number) ** 2
			n[kind] = (n[kind] as number) + 1
		}
	}
	rel(Math.sqrt((sp[0] as number) / (n[0] as number)) / Math.sqrt((sp[1] as number) / (n[1] as number)), Math.sqrt(SUBSTANCES.bromine!.molar / SUBSTANCES.air!.molar), 0.04, "speed ratio")
})

test("mixing: nothing crosses the divider; once lifted the gases mix, faster when hotter", () => {
	const time = (start: number) => {
		const b = new ParticleBox({ ...BOX, start, divider: true, openAt: 0.5 })
		let at = Infinity
		for (let k = 0; k < 480 * 8; k++) {
			b.advance(H, k * H)
			if (k * H < 0.5) assert.equal(b.readings.mixed, 0, "no mixing through the divider")
			if (b.readings.mixed >= 0.7 && at === Infinity) at = k * H - 0.5
		}
		return at
	}
	const cold = time(-50)
	const hot = time(300)
	assert.ok(hot < cold, `hot mixes faster: ${hot} s < ${cold} s`)
	assert.ok(cold < 6, `mixes within the run: ${cold} s`)
})

test("states: a solid holds its lattice, a liquid pools at the bottom, a gas fills the box", () => {
	const meanY = (b: ParticleBox) => {
		let s = 0
		for (let i = 0; i < b.p.n; i++) s += b.p.y[i] as number
		return s / b.p.n
	}
	const solid = runBox({ substance: SUBSTANCES.water as never, start: -20, mass: 0.001 }, 2).box
	assert.equal(solid.readings.solid, 1)
	assert.ok(solid.p.bondA.length > 100, `bonded (${solid.p.bondA.length} bonds)`)
	// each particle's mean place over a quarter second, a second apart: it vibrates about a fixed site (the block neither slides nor flows)
	const mean = (from: number) => {
		const sx = new Float64Array(solid.p.n)
		const sy = new Float64Array(solid.p.n)
		for (let k = 0; k < 120; k++) {
			solid.advance(H, from + k * H)
			for (let i = 0; i < solid.p.n; i++) {
				sx[i] = (sx[i] as number) + (solid.p.x[i] as number) / 120
				sy[i] = (sy[i] as number) + (solid.p.y[i] as number) / 120
			}
		}
		return { sx, sy }
	}
	const a = mean(2)
	for (let k = 0; k < 360; k++) solid.advance(H, 2.25 + k * H)
	const b = mean(3)
	let drift = 0
	for (let i = 0; i < solid.p.n; i++) drift = Math.max(drift, Math.hypot((b.sx[i] as number) - (a.sx[i] as number), (b.sy[i] as number) - (a.sy[i] as number)))
	assert.ok(drift < 0.0015, `a solid keeps its shape: its particles' sites move ${drift * 1000} mm`)
	const liquid = runBox({ substance: SUBSTANCES.water as never, start: 50, mass: 0.001 }, 3).box
	assert.equal(liquid.readings.liquid, 1)
	assert.ok(meanY(liquid) < 0.16 / 4, `the liquid pools: mean height ${meanY(liquid)}`)
	const gas = runBox({ substance: SUBSTANCES.water as never, start: 150, mass: 0.001 }, 3).box
	assert.equal(gas.readings.gas, 1)
	near(meanY(gas), 0.08, 0.016, "the gas fills the box")
})

test("heating ice: melts at 0 °C, boils at 100 °C, the particles follow (a time-lapse heating curve)", () => {
	// 1 g of ice at −10 °C, 10 W, ×60: 21 J to 0 °C, 333.6 J to melt, 418 J to 100 °C, 2257 J to boil
	const b = new ParticleBox({ ...BOX, substance: SUBSTANCES.water as never, start: -10, mass: 0.001, heater: 10 })
	const seen: { t: number; T: number; s: number; l: number; g: number; free: number }[] = []
	for (let k = 0; k <= 480 * 7; k++) {
		if (k % 48 === 0) b.heat(48 * H * 60, k * H)
		b.advance(H, k * H)
		if (k % 48 === 0) {
			let free = 0
			for (let i = 0; i < b.p.n; i++) if (b.p.phase[i] === FREE) free++
			seen.push({ t: k * H, T: b.readings.temperature, s: b.readings.solid, l: b.readings.liquid, g: b.readings.gas, free })
		}
	}
	const melting = seen.filter((r) => r.s > 0 && r.s < 1)
	assert.ok(melting.length > 0 && melting.every((r) => r.T === 0), "melts at 0 °C")
	const boiling = seen.filter((r) => r.g > 0 && r.g < 1)
	assert.ok(boiling.length > 0 && boiling.every((r) => r.T === 100), "boils at 100 °C")
	// the melt takes m·L/P = 33.4 s of lesson time = 0.556 s of the run at ×60
	near(melting.length * 0.1, (0.001 * 333550) / 10 / 60, 0.15, "melting time")
	const last = seen[seen.length - 1]!
	assert.equal(last.g, 1)
	assert.equal(last.free, b.p.n, "every particle a gas particle")
})

test("dissolving rates: hot beats cold, stirred beats still, fine beats coarse, sand never", () => {
	const s = SOLUTES.sugar!
	assert.ok(lifetime(s, 80, 0.0006, 0) < lifetime(s, 20, 0.0006, 0) / 2, "hot water at least twice as fast")
	assert.ok(lifetime(s, 20, 0.0006, 0.1) < lifetime(s, 20, 0.0006, 0) / 1.5, "a stirred grain faster")
	assert.ok(lifetime(s, 20, 0.0003, 0) < lifetime(s, 20, 0.004, 0) / 10, "fine grains much faster than coarse")
	assert.equal(dissolveRate(SOLUTES.sand!, 20, 0.001, 0.1, 0), 0)
	assert.equal(dissolveRate(s, 20, 0.001, 0, saturated(s, 20)), 0, "saturated water dissolves no more")
})

const GLASS: GlassSpec = {
	radius: 0.035,
	height: 0.12,
	depth: 0.09,
	temperature: 20,
	solute: SOLUTES.salt!,
	mass: 0.006,
	grain: 0.0004,
	specks: 48,
	pourAt: 0.5,
	pourHeight: 0.13,
	stir: 0,
	stirFrom: 1,
	stirUntil: 30,
	timeLapse: 1,
	seed: 1
}
const runGlass = (spec: Partial<GlassSpec>, secs: number) => {
	const g = new Glass({ ...GLASS, ...spec })
	for (let k = 0; k <= Math.round(secs * 480); k++) g.step(k * H, H)
	return g
}

test("a glass of water: stirring dissolves faster, hot water faster, mass conserved exactly", () => {
	const still = runGlass({}, 12)
	const stirred = runGlass({ stir: 2 }, 12)
	assert.ok(stirred.undissolved() < still.undissolved() * 0.6, `stirred ${stirred.undissolved()} < still ${still.undissolved()}`)
	const cold = runGlass({ solute: SOLUTES.sugar!, grain: 0.0006, temperature: 5 }, 6)
	const hot = runGlass({ solute: SOLUTES.sugar!, grain: 0.0006, temperature: 80 }, 6)
	assert.ok(hot.undissolved() < cold.undissolved() * 0.5, `hot ${hot.undissolved()} < cold ${cold.undissolved()}`)
	for (const g of [still, stirred, cold, hot]) near(g.dissolved() + g.undissolved(), 0.006, 1e-12, "dissolved + left = poured")
	const sand = runGlass({ solute: SOLUTES.sand!, grain: 0.0005, stir: 2 }, 8)
	assert.equal(sand.dissolved(), 0, "sand never dissolves")
})

test("a saturated solution: 50 g of salt in 100 mL of water at 20 °C stops at 35.9 g", () => {
	// a glass 3.5 cm in radius with 2.6 cm of water = 100.1 mL; stirred for a long (time-lapsed) time
	const g = runGlass({ mass: 0.05, depth: 0.026, stir: 3, timeLapse: 60 }, 12)
	const water = Math.PI * 0.035 * 0.035 * 0.026 * 998.2
	near(g.dissolved(), solubility(SOLUTES.salt!, 20) * water, 0.02 * solubility(SOLUTES.salt!, 20) * water, "dissolved = solubility × water")
	assert.ok(g.undissolved() > 0.013, "the rest stays as crystals")
})

test("sieving: the sand passes the mesh, the gravel stays (a grain passes only if smaller than the aperture)", () => {
	const spec: MixtureSpec = {
		components: [
			{ grain: GRAINS.sand!, mass: 50 },
			{ grain: GRAINS.gravel!, mass: 50 }
		],
		grains: 120,
		width: 0.2,
		wall: 0.04,
		pour: false,
		pourHeight: 0.1,
		aperture: 0.004,
		wire: 0.0008,
		sieveHeight: 0.08,
		sieveWidth: 0.16,
		shake: 0.01,
		shakeHz: 4,
		shakeFrom: 0.5,
		shakeUntil: 4,
		seed: 3
	}
	const m = new Mixture(spec)
	for (let k = 0; k <= 480 * 4; k++) m.advance(H, k * H, k * H >= 0.3)
	const sh = m.shares()
	assert.ok((sh[0] as { passed: number }).passed > 0.9, `sand through: ${(sh[0] as { passed: number }).passed}`)
	assert.equal((sh[1] as { passed: number }).passed, 0, "no gravel through")
	for (let i = 0; i < m.p.n; i++) assert.ok(Number.isFinite(m.p.x[i] as number) && Number.isFinite(m.p.y[i] as number))
})

test("a magnet pulls iron filings out of sand, never the sand", () => {
	const spec: MixtureSpec = {
		components: [
			{ grain: GRAINS.sand!, mass: 50 },
			{ grain: GRAINS["iron-filings"]!, mass: 20 }
		],
		grains: 120,
		width: 0.16,
		wall: 0.03,
		pour: false,
		pourHeight: 0,
		aperture: 0,
		wire: 0,
		sieveHeight: 0,
		sieveWidth: 0,
		shake: 0,
		shakeHz: 0,
		shakeFrom: 0,
		shakeUntil: 0,
		seed: 5
	}
	const m = new Mixture(spec)
	m.field = barMagnet(0, 0.04, -Math.PI / 2, 0.04, 2.2e-4, 1.3)
	m.p.outlines.push({ points: [-0.01, 0.015, 0.01, 0.015, 0.01, 0.065, -0.01, 0.065], cx: 0, cy: 0.04, vx: 0, vy: 0, w: 0, restitution: 0.2, friction: 0.6, push: { x: 0, y: 0, m: 0 } })
	for (let k = 0; k <= 480 * 2; k++) m.advance(H, k * H, k * H >= 0.2)
	const lifted = m.shares({ x0: -0.02, x1: 0.02, y0: 0.008, y1: 0.07 })
	assert.ok((lifted[1] as { inside: number }).inside > 0.1, `filings on the magnet: ${(lifted[1] as { inside: number }).inside}`)
	assert.equal((lifted[0] as { inside: number }).inside, 0, "no sand lifted")
})

test("a grain sinks through water at the Schiller-Naumann terminal speed", () => {
	const r = 0.0005
	const rho = 2650
	const V = (4 / 3) * Math.PI * r * r * r
	const kinds = [{ radius: r, mass: rho * V, restitution: 0.3, friction: 0.5, magnetic: 0, volume: V }]
	const p = new Particles(
		{ kinds, stiffness: 100, gravity: { x: 0, y: -9.81 }, gravityByPhase: [1, 1, 1], cohesionRange: 0, cohesionForce: 0, liquidDamping: 0, bondStiffness: 0, bondDamping: 0, bounds: { x0: -0.1, y0: -1, x1: 0.1, y1: 1 }, maxSubStep: 1e-4 },
		1
	)
	p.bath = { level: 0.9, density: 998.2, viscosity: 1.002e-3 }
	p.add(0, 0, 0.5, 0, 0)
	for (let k = 0; k < 20000; k++) p.step(1e-4)
	// solve the terminal speed: (ρp − ρw)·V·g = 3πμd(1 + 0.15 Re^0.687)·v
	let v = 0.1
	for (let k = 0; k < 200; k++) {
		const re = (998.2 * v * 2 * r) / 1.002e-3
		v = ((rho - 998.2) * V * 9.81) / (3 * Math.PI * 1.002e-3 * 2 * r * (1 + 0.15 * Math.pow(re, 0.687)))
	}
	rel(-(p.vy[0] as number), v, 0.005, "terminal speed")
})

test("deterministic: the same run twice gives the same bits", () => {
	const a = runBox({ substance: SUBSTANCES.water as never, start: -5, mass: 0.001, heater: 20 }, 2, 60).box
	const b = runBox({ substance: SUBSTANCES.water as never, start: -5, mass: 0.001, heater: 20 }, 2, 60).box
	assert.deepEqual(Array.from(a.p.x), Array.from(b.p.x))
	assert.deepEqual(Array.from(a.p.vy), Array.from(b.p.vy))
	const r1 = random(7)
	const r2 = random(7)
	for (let k = 0; k < 10; k++) assert.equal(r1(), r2())
	void LIQUID
	void SOLID
})
