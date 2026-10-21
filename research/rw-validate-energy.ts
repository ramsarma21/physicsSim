// The energy module against theory and measurements (tooling/src/sim/energy.ts, tooling/src/sim/modules/energy.ts, machines/mod_energy.py and
// its port web/sim/modules/energy.js; the circuits module's generator on a shaft and battery car, tooling/src/sim/modules/circuits.ts). Engine
// scenes are built by web/sim (the exact port of the Python builder) and run by the server's engine (node, with the browser bundle's math) at
// 480 Hz, 120 frames a second. Exits 1 on any failure (a gate).
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-energy.ts [bem|generator|led|wind|spool|wheel|car|yaw|goals|determinism|all]
// Reference values (cited where they are used):
//   [BETZ] A. Betz (1920): no rotor takes more than 16/27 of the power of the wind through its disc.
//   [JWEA] Pinwheel type wind turbines in a wind tunnel (Wind Engineering 27, 2003; J. Japan Wind Energy Assoc. 27-1): a conventional four-blade
//          pinwheel peaks at C_p 0.17 at a tip speed ratio of 2.
//   [NING] S. A. Ning, Wind Energy 17, 1327 (2014): the BEM equations solved by one bracketed root in the inflow angle (here an independent solve).
//   [VERNIER] Vernier/KidWind, "Wind Turbine Generator / Motor, specifications for using as a generator" (generator_data.pdf): open circuit 2.13 V
//          at 720 rpm, 4.25 at 1440, 6.54 at 2450, 9.81 at 3630; with 200 Ω 1.82 V and with 100 Ω 1.59 V at 720 rpm; with 100 Ω 3.14 V at 1440 rpm.
//          Vernier, "Why does my KidWind turbine not light the LED": "the generator shaft has to be spinning at around 700 rpm to produce the
//          roughly 1.75 V a red LED needs".
//   [KIDWIND] KidWind MINI wind turbine manual: about 3 ft from a box fan on high its LED lights; typical output 1-4 V.
//   [DC] A permanent-magnet DC machine: EMF = k·ω, torque = k·I (the same k), so the electrical power k·ω·I is the mechanical power it takes.
import { pathToFileURL } from "node:url"

const PG = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const sim = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as {
	prepare: (s: unknown) => { scene: Scene; doc: Doc; resolved: Record<string, Record<string, unknown>> }
	finish: (s: unknown, d: Doc, r: unknown, t: Track) => { summary: { goals: { ok: boolean; label: string; kind?: string }[] } }
}
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: unknown } }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: unknown, fps: number) => Track }
await import(`${PG}/tooling/src/sim/modules/index.ts`)
const E = (await import(`${PG}/tooling/src/sim/energy.ts`)) as typeof import("../tooling/src/sim/energy.ts")

type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; fixed?: boolean }
type Scene = { items: Item[]; [k: string]: unknown }
type Solid = { id: string; item: string; kind: string; at: { x: number; y: number }; body: { kind: string; radius?: number }; material: string; pivot?: unknown; motor?: { speed: number; torque: number } }
type Doc = { solids: Solid[]; materials: Record<string, { density: number }>; processes?: { kind: string; id: string; item?: string; [k: string]: unknown }[]; joints?: { id: string; [k: string]: unknown }[] }
type Track = { frames: { t: number; placements: Record<string, { x: number; y: number; angle: number }> }[]; state?: Record<string, Record<string, number[]>>; events?: { t: number; text: string }[] }

let failed = 0
let passed = 0
const check = (ok: boolean, what: string, detail: string) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${what}  (${detail})`)
	if (ok) passed++
	else failed++
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b))
const f = (v: number, d = 4) => (Number.isFinite(v) ? Number(v.toPrecision(d)).toString() : String(v))
const G = 9.81
const RHO = 1.2
const RPM = 60 / (2 * Math.PI)
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items: Item[], seconds: number, extra: Record<string, unknown> = {}): Scene => ({
	version: 2, id: "v", seconds, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals: [], ...extra
})
/** A scene's document (web/sim), optionally changed before the run (`edit`), its track and summary. */
const run = (s: Scene, edit?: (doc: Doc) => void) => {
	const { scene: sc, doc, resolved } = sim.prepare(s)
	edit?.(doc)
	const track = simulate(admitDocument(doc).scene, 120)
	const fin = sim.finish(sc, doc, resolved, track)
	return { doc, track, resolved, summary: fin.summary }
}
const series = (tr: Track, item: string, key: string) => tr.state?.[item]?.[key] ?? []
/** The mean of a reading over [t0, t1]. */
const mean = (tr: Track, item: string, key: string, t0: number, t1: number) => {
	const v = series(tr, item, key)
	let s = 0
	let n = 0
	tr.frames.forEach((fr, k) => {
		if (fr.t >= t0 && fr.t <= t1 && Number.isFinite(v[k])) {
			s += v[k] as number
			n++
		}
	})
	return n ? s / n : Number.NaN
}
const placement = (tr: Track, id: string, t: number) => {
	let p = tr.frames[0]?.placements[id]
	for (const fr of tr.frames) {
		if (fr.t > t + 1e-9) break
		p = fr.placements[id] ?? p
	}
	return p as { x: number; y: number; angle: number }
}
/** The default rotors as their records give them (from a built document). */
const rotorOf = (doc: Doc, item: string) => (doc.processes ?? []).find((p) => p.kind === "energy" && p.role === "rotor" && p.item === item)?.rotor as import("../tooling/src/sim/energy.ts").Rotor
/** The aerodynamic torque at a steady turning in an even axial wind (the induction relaxed to its fixed point). */
const steadyTorque = (rot: import("../tooling/src/sim/energy.ts").Rotor, U: number, omega: number) => {
	const ans = E.annuliOf(rot)
	const ind = { a: ans.map(() => 0), ap: ans.map(() => 0) }
	let L = { torque: 0, thrust: 0, wind: 0 }
	for (let k = 0; k < 400; k++) L = E.rotorLoads(rot, ans, omega, RHO, () => ({ axial: U, across: 0 }), ind)
	return L.torque
}
/** A bearing's friction torque from its document joint. */
const frictionOf = (doc: Doc, id: string) => Number((doc.joints ?? []).find((j) => j.id === id)?.friction ?? 0)

const want = new Set(process.argv.slice(2))
const on = (k: string) => want.size === 0 || want.has("all") || want.has(k)

// ------------------------------------------------------------------------------------------------ blade-element momentum (pure)
if (on("bem")) {
	const turbine = rotorOf(sim.prepare(scene([{ id: "wt", type: "wind-turbine", x: 1, y: 0 }], 1)).doc, "wt")
	const pinwheel = rotorOf(sim.prepare(scene([{ id: "pw", type: "pinwheel", x: 1, y: 0 }], 1)).doc, "pw")
	// [NING]: the induction the engine relaxes step by step is the steady BEM solution
	let worst = 0
	let n = 0
	for (const rot of [turbine, pinwheel])
		for (const lam of [0.5, 1, 1.5, 2, 2.5, 3]) {
			const U = 4
			const omega = (lam * U) / rot.R
			const ans = E.annuliOf(rot)
			const ind = { a: ans.map(() => 0), ap: ans.map(() => 0) }
			for (let k = 0; k < 600; k++) E.rotorLoads(rot, ans, omega, RHO, () => ({ axial: U, across: 0 }), ind)
			ans.forEach((an, j) => {
				const s = E.steadyAnnulus(an, rot, U, omega)
				if (s === undefined || s.ap > 3.9) return
				worst = Math.max(worst, Math.abs((ind.a[j] as number) - s.a))
				n++
			})
		}
	check(worst < 1e-7 && n > 60, "the induction relaxed each step converges on the steady BEM solution (a bracketed root of Ning's residual) [NING]", `largest |Δa| ${worst.toExponential(2)} over ${n} annuli, two rotors, λ 0.5-3`)
	// [BETZ]
	let most = 0
	let at = ""
	for (const B of [2, 3, 6, 12])
		for (const p of [0, 5, 10, 20, 35])
			for (const lam of [1, 2, 3, 4, 6]) {
				const rot = { ...turbine, blades: B, pitch: [(p * Math.PI) / 180, (p * Math.PI) / 180] as [number, number] }
				const omega = (lam * 5) / rot.R
				const cp = (steadyTorque(rot, 5, omega) * omega) / (0.5 * RHO * Math.PI * rot.R * rot.R * 125)
				if (cp > most) {
					most = cp
					at = `${B} blades at ${p}°, λ ${lam}`
				}
			}
	check(most < 16 / 27 && most > 0.1, "no rotor takes more than Betz's 16/27 of the wind's power [BETZ]", `best Cp ${f(most, 3)} (${at}) of 100 rotors and speeds`)
	// [JWEA]
	let best = { lam: 0, cp: -1 }
	for (let lam = 1; lam <= 3.001; lam += 0.05) {
		const omega = (lam * 4) / pinwheel.R
		const cp = (steadyTorque(pinwheel, 4, omega) * omega) / (0.5 * RHO * Math.PI * pinwheel.R * pinwheel.R * 64)
		if (cp > best.cp) best = { lam, cp }
	}
	check(Math.abs(best.cp - 0.17) < 0.03 && Math.abs(best.lam - 2) < 0.35, "the default paper windmill (4 sails) peaks near Cp 0.17 at a tip speed ratio of 2 [JWEA]",
		`Cp ${f(best.cp, 3)} at λ ${f(best.lam, 3)} vs 0.17 at 2`)
}

// ------------------------------------------------------------------------------------------------ the generator on a shaft turned at a set speed
/** A waterwheel turned at `rpm` by a motor on its hub (its own hinge driven: a doc edit), a KidWind generator on it, and what is wired to it. */
const driven = (rpm: number, load: Item[], gen: Record<string, unknown> = {}) =>
	run(
		scene([
			{ id: "ww", type: "waterwheel", x: 1.0, y: 0.5 },
			{ id: "gen", type: "generator", x: 1.3, y: 0, props: { shaft: "ww", ...gen } },
			...load
		], 1.5),
		(doc) => {
			const hub = doc.solids.find((s) => s.id === "ww/hub") as Solid
			hub.motor = { speed: rpm / RPM, torque: 50 }
		}
	)
const wired = (part: Item): Item[] => [
	part,
	{ id: "w1", type: "wire", x: 0, y: 0, props: { a: "gen", a_end: "+", b: part.id, b_end: "+" } },
	{ id: "w2", type: "wire", x: 0, y: 0, props: { a: part.id, a_end: "-", b: "gen", b_end: "-" } }
]
if (on("generator")) {
	// [VERNIER]: the KidWind generator's open-circuit voltage (k = 5.9 V at 2000 rpm: Vernier's rating) at the table's speeds
	for (const [rpm, v, tol] of [[720, 2.13, 0.02], [1440, 4.25, 0.02], [2450, 6.54, 0.12], [3630, 9.81, 0.12]] as const) {
		const r = driven(rpm, [])
		const got = mean(r.track, "gen", "voltage", 1.0, 1.5)
		check(rel(got, v) < tol, `KidWind generator, open circuit at ${rpm} rpm [VERNIER]`, `${f(got)} V vs measured ${v} V (±${tol * 100} %${tol > 0.05 ? ": the real one's EMF per rpm falls about 9 % by 3600 rpm, the model's is constant" : ""})`)
	}
	// [VERNIER]: loaded by a resistor (38 Ω inside: the 720 and 1440 rpm rows)
	for (const [rpm, ohms, v] of [[720, 200, 1.82], [720, 100, 1.59], [1440, 100, 3.14]] as const) {
		const r = driven(rpm, wired({ id: "res", type: "resistor", x: 1.6, y: 0.006, props: { ohms } }))
		const got = mean(r.track, "res", "voltage", 1.0, 1.5)
		check(rel(got, v) < 0.06, `KidWind generator at ${rpm} rpm across ${ohms} Ω [VERNIER]`, `${f(got)} V vs measured ${v} V`)
	}
	// [DC]: the current's torque holds the shaft back as much as the electrical power it gives: k·I·ω_gen = V·I + I²·R inside
	{
		const r = driven(1440, wired({ id: "res", type: "resistor", x: 1.6, y: 0.006, props: { ohms: 20 } }))
		const k = 5.9 / (2000 / RPM)
		const w = mean(r.track, "gen", "rpm", 1.0, 1.5) / RPM
		const i = mean(r.track, "gen", "current", 1.0, 1.5)
		const v = mean(r.track, "gen", "voltage", 1.0, 1.5)
		const mech = k * w * i
		const elec = v * i + i * i * 38
		check(rel(mech, elec) < 0.003, "a generator's EMF and its torque are one k: the power it takes is the power it gives [DC]", `k·ω·I ${f(mech * 1000)} mW vs V·I + I²R ${f(elec * 1000)} mW (20 Ω load, 1440 rpm)`)
	}
	// a step-up belt: the generator turns ratio times the shaft
	{
		const r = driven(144, [], { ratio: 5 })
		const g = mean(r.track, "gen", "rpm", 1.0, 1.5)
		check(rel(g, 720) < 0.002 && rel(mean(r.track, "gen", "voltage", 1.0, 1.5), 2.13) < 0.02, "a 5:1 belt: a shaft at 144 rpm turns the generator at 720 rpm, 2.1 V", `${f(g)} rpm, ${f(mean(r.track, "gen", "voltage", 1.0, 1.5))} V`)
		const sw = driven(144, [], { ratio: 5, leads: "swapped" })
		check(rel(mean(sw.track, "gen", "voltage", 1.0, 1.5), -2.13) < 0.02, "swapped leads: the voltage the other way round", `${f(mean(sw.track, "gen", "voltage", 1.0, 1.5))} V`)
	}
}
if (on("led")) {
	// [VERNIER]: a red LED on the KidWind generator lights from about 700 rpm (1.75 V); the model's knee 1.8 V at 2 mA (a tenth of its light)
	let first = Number.NaN
	for (let rpm = 500; rpm <= 900; rpm += 20) {
		const r = driven(rpm, wired({ id: "led", type: "led", x: 1.6, y: 0.006, props: { color: "red" } }))
		if (mean(r.track, "led", "light", 1.0, 1.5) >= 0.1) {
			first = rpm
			break
		}
	}
	check(Math.abs(first - 700) <= 80, "a red LED on the KidWind generator lights from about 700 rpm [VERNIER]", `lights from ${first} rpm`)
}

// ------------------------------------------------------------------------------------------------ rotors in the wind
/** A breeze across the whole table (the liquids module's: a 20 m stream) at U m/s blowing right, from x = −0.4. */
const breeze = (U: number): Item => ({ id: "wind", type: "breeze", x: -0.4, y: 0, props: { speed: U } })
if (on("wind")) {
	// a free-running turbine (no generator) settles where the wind's torque meets its bearing's friction: the engine's run against BEM solved apart
	for (const U of [3, 5]) {
		const r = run(scene([breeze(U), { id: "wt", type: "wind-turbine", x: 1.2, y: 0, props: { generator: "none" } }], 8))
		const rot = rotorOf(r.doc, "wt")
		const F = frictionOf(r.doc, "wt/bearing")
		const wind = mean(r.track, "wt", "wind_ms", 7, 8)
		// (bisect ω where Q(ω) = F)
		let lo = 1
		let hi = 400
		for (let k = 0; k < 40; k++) {
			const m = (lo + hi) / 2
			if (steadyTorque(rot, wind, m) > F) lo = m
			else hi = m
		}
		const got = mean(r.track, "wt", "rpm", 7, 8)
		check(rel(got, lo * RPM) < 0.01 && rel(wind, U) < 0.01, `a free-running turbine in a ${U} m/s breeze settles where the wind's torque meets its friction`, `${f(got)} rpm vs BEM ${f(lo * RPM)} rpm (wind ${f(wind)} m/s, friction ${f(F * 1000)} mN·m)`)
	}
	// [KIDWIND]: a turbine 45 cm from a 50 cm fan on high lights an LED; the generator gives 1-4 V
	{
		const r = run(scene([
			{ id: "fan", type: "fan", x: 0.55, y: 0.45, props: { speed: 5, diameter: 0.5 } },
			{ id: "wt", type: "wind-turbine", x: 1.0, y: 0 },
			...[{ id: "led", type: "led", x: 1.45, y: 0.006 }, { id: "w1", type: "wire", x: 0, y: 0, props: { a: "wt", a_end: "+", b: "led", b_end: "+" } }, { id: "w2", type: "wire", x: 0, y: 0, props: { a: "led", a_end: "-", b: "wt", b_end: "-" } }]
		], 8, { goals: [{ kind: "lights", item: "led" }] }))
		const v = mean(r.track, "wt", "generator_voltage", 7, 8)
		const rpm = mean(r.track, "wt", "rpm", 7, 8)
		check(r.summary.goals[0]?.ok === true && v > 1 && v < 4, "a model turbine in front of a fan lights an LED; the generator gives 1-4 V [KIDWIND]", `${f(v)} V at ${f(rpm)} rpm, LED light ${f(mean(r.track, "led", "light", 7, 8))}`)
		// [DC] + BEM: at its steady speed the wind's torque is the bearing's friction and the generator's k·I
		const rot = rotorOf(r.doc, "wt")
		const w = rpm / RPM
		const wind = mean(r.track, "wt", "wind_ms", 7, 8)
		const i = mean(r.track, "wt", "generator_current", 7, 8)
		const q = mean(r.track, "wt", "power_mw", 7, 8) / 1000 / w
		const F = frictionOf(r.doc, "wt/bearing")
		const k = 5.9 / (2000 / RPM)
		check(rel(q, F + k * i) < 0.01, "a lit turbine's torque balance: the wind's torque = the bearing's friction + the generator's k·I", `${f(q * 1000)} mN·m vs ${f(F * 1000)} + ${f(k * i * 1000)} mN·m (wind ${f(wind)} m/s over its disc)`)
	}
	// a vacuum: no air, no turning
	{
		const r = run(scene([breeze(5), { id: "wt", type: "wind-turbine", x: 1.2, y: 0, props: { generator: "none" } }], 3, { settings: { air: false } }))
		check(Math.abs(mean(r.track, "wt", "rpm", 2, 3)) < 1e-6, "in a vacuum the wind does nothing: the turbine stands still", `${f(mean(r.track, "wt", "rpm", 2, 3))} rpm`)
	}
	// a fan's round jet is narrower than a big rotor: each blade element takes the jet's speed at its own distance from the jet's axis (also the
	// elements out of the picture's plane), so the wind over the disc is the jet's profile averaged over the disc's area (the engine's round jet:
	// full speed in its core, half speed max(D/2, 0.094·distance) from its axis, Gaussian across: Rajaratnam, Turbulent Jets, 1976)
	{
		const r = run(scene([{ id: "fan", type: "fan", x: 0.5, y: 0.45, props: { speed: 5, diameter: 0.2 } }, { id: "wt", type: "wind-turbine", x: 1.0, y: 0, props: { generator: "none", blade_length: 0.25 } }], 1))
		const disc = mean(r.track, "wt", "wind_ms", 0.5, 1)
		const D = 0.18
		const along = 1.0 - 0.07 - (0.5 + 0.02)
		const half = Math.max(D / 2, 0.094 * along)
		const core = 5 * Math.min(1, (6.2 * D) / along)
		const r0 = 0.03
		const R = 0.28
		const k = Math.LN2 / (half * half)
		const exact = (core * (Math.exp(-k * r0 * r0) - Math.exp(-k * R * R))) / k / (R * R - r0 * r0)
		check(rel(disc, exact) < 0.03, "a narrow fan's round jet on a big rotor: the disc takes the jet's profile averaged over its area (blades out of the picture's plane too)",
			`${f(disc)} m/s over the 56 cm disc vs the profile's area mean ${f(exact)} m/s (5 m/s at its middle)`)
	}
}
if (on("yaw")) {
	// turned toward the viewer by ψ, a rotor meets the wind's component along its shaft: a free-running one turns cos ψ as fast
	const rpm = (yaw: number) => mean(run(scene([breeze(5), { id: "wt", type: "wind-turbine", x: 1.2, y: 0, props: { generator: "none", yaw } }], 8)).track, "wt", "rpm", 7, 8)
	const r0 = rpm(0)
	const r30 = rpm(30)
	// (and a little less: the wind's share across the yawed disc runs with the blades on one side and against them on the other, which costs more
	// on the one than it gives on the other; measured on model turbines, free-running speed falls about as cos ψ, power as cos² to cos³ ψ)
	check(r30 / r0 < Math.cos(Math.PI / 6) && r30 / r0 > 0.94 * Math.cos(Math.PI / 6), "a turbine turned 30° out of the wind turns about cos 30° as fast (its axial wind)",
		`${f(r30)} vs ${f(r0)} rpm: ratio ${f(r30 / r0)} vs cos 30° ${f(Math.cos(Math.PI / 6))}`)
}

// ------------------------------------------------------------------------------------------------ spools lift loads
if (on("spool")) {
	// a paper windmill in a 4 m/s breeze lifts a cup of pennies: the thread it winds in is the turning times the straw's radius (no slip, no
	// stretch: the free thread shortens by Δθ·r), and the windmill stops with 2.2 cm of thread left (the cup swings a little in the breeze)
	{
		const r = run(scene([breeze(4), { id: "pw", type: "pinwheel", x: 1.2, y: 0, props: { load_g: 20 } }], 4))
		const rope = series(r.track, "pw", "rope")
		const ang = series(r.track, "pw", "angle")
		const k0 = rope.findIndex((v) => v < 0.21)
		const k1 = rope.findIndex((v) => v < 0.09)
		const dl = (rope[k0] as number) - (rope[k1] as number)
		const wound = ((ang[k1] as number) - (ang[k0] as number)) * 0.003
		const left = mean(r.track, "pw", "rope", 3, 4)
		check(k0 > 0 && k1 > k0 && rel(dl, wound) < 0.01 && Math.abs(left - 0.022) < 0.002, "a windmill winds its thread: the free thread shortens by the turning × the straw's radius (6 mm), and it stops with 2.2 cm left",
			`${f(dl)} m wound in vs Δθ·r ${f(wound)} m from ${f(r.track.frames[k0]?.t ?? 0)} to ${f(r.track.frames[k1]?.t ?? 0)} s; ${f(left)} m of thread left at the end; the cup lifted ${f(Math.max(...series(r.track, "pw", "lift_m")))} m`)
		// (held at the top in the breeze: the thread pulls the cup's weight and the breeze's push on it, ½ρ·C_d·A·U² sideways)
		const pull = mean(r.track, "pw", "pull_n", 3.5, 4)
		const drag = 0.5 * RHO * 1.05 * 0.05 * 0.05 * 16
		const want = Math.hypot(0.02 * G, drag)
		check(rel(pull, want) < 0.01, "held at the top, the thread pulls the cup's weight and the breeze's push on it", `${f(pull)} N vs √((m·g)² + drag²) ${f(want)} N (m·g ${f(0.02 * G)} N)`)
	}
	// the heaviest load: where the windmill's starting torque (BEM at standstill) meets the load's torque on the straw and the bearing's friction
	{
		const probe = sim.prepare(scene([{ id: "pw", type: "pinwheel", x: 1.2, y: 0, props: { load_g: 10 } }], 1)).doc
		const rot = rotorOf(probe, "pw")
		const q0 = steadyTorque(rot, 4, 0)
		const F10 = frictionOf(probe, "pw/bearing")
		// friction = μ·r_b·(m + load)·g: solve q0 = load·g·r + F(load)
		const per = (frictionOf(sim.prepare(scene([{ id: "pw", type: "pinwheel", x: 1.2, y: 0, props: { load_g: 110 } }], 1)).doc, "pw/bearing") - F10) / 0.1
		const F0 = F10 - per * 0.01
		const most = (q0 - F0) / (G * 0.003 + per)
		// (at the end of 3 s: a cup a little too heavy may be jerked up a few millimetres as the sails take up the thread's slack, then sinks back)
		const lifts = (g: number) => {
			const v = series(run(scene([breeze(4), { id: "pw", type: "pinwheel", x: 1.2, y: 0, props: { load_g: g } }], 3)).track, "pw", "lift_m")
			return v[v.length - 1] as number
		}
		const under = lifts(Math.round(most * 900))
		const over = lifts(Math.round(most * 1100))
		check(under > 0.05 && over < 0.01, "the heaviest cup a windmill lifts from rest: its standstill torque over g·r (+ its friction)",
			`${f(most * 1000)} g at most: ${Math.round(most * 900)} g ends ${f(under)} m up, ${Math.round(most * 1100)} g ${f(over)} m`)
	}
}
if (on("wheel")) {
	// a tap's stream turns a waterwheel that winds a cup of pennies up on its axle (the thread on the side that rises: the stream falls on its right)
	const r = run(scene([
		{ id: "ww", type: "waterwheel", x: 1.2, y: 0.45, props: { load_g: 20 } },
		{ id: "tap", type: "tap", x: 1.284, y: 0.75, props: { flow_ml_s: 140, on_at: 0.1 } }
	], 5, { goals: [{ kind: "rises", item: "ww" }] }))
	const spool = (r.doc.processes ?? []).find((p) => p.id === "ww/thread")
	const lifted = Math.max(...series(r.track, "ww", "lift_m"))
	check(spool?.sense === -1 && lifted > 0.1 && r.summary.goals[0]?.ok === true, "a waterwheel under a tap winds up a cup of pennies (its thread on the left: the stream turns it clockwise)",
		`sense ${String(spool?.sense)}, lifted ${f(lifted)} m; goal ${r.summary.goals[0]?.label}: ${String(r.summary.goals[0]?.ok)}`)
	const heavy = run(scene([
		{ id: "ww", type: "waterwheel", x: 1.2, y: 0.45, props: { load_g: 2000 } },
		{ id: "tap", type: "tap", x: 1.284, y: 0.75, props: { flow_ml_s: 140, on_at: 0.1 } }
	], 3))
	check(Math.max(...series(heavy.track, "ww", "lift_m")) < 0.005, "a 2 kg cup is too heavy for the stream: the wheel cannot lift it", `lifted ${f(Math.max(...series(heavy.track, "ww", "lift_m")))} m`)
}

// ------------------------------------------------------------------------------------------------ a battery car
if (on("car")) {
	// a 48:1 gear motor on two AA cells drives a cart's rear wheels: it runs up to where the motor's torque meets its gearbox's friction
	const r = run(scene([
		{ id: "car", type: "cart", x: 0.4, y: 0 },
		{ id: "bat", type: "battery", x: 0.4, y: 0.0735 },
		{ id: "mot", type: "motor", x: 0.4, y: 0.2, props: { kind: "geared", drives: "wheels", car: "car" } },
		{ id: "w1", type: "wire", x: 0, y: 0, props: { a: "bat", a_end: "+", b: "mot", b_end: "+" } },
		{ id: "w2", type: "wire", x: 0, y: 0, props: { a: "mot", a_end: "-", b: "bat", b_end: "-" } }
	], 4, { goals: [{ kind: "moves", item: "car", min_m: 0.3 }] }))
	const part = ((r.doc.processes ?? []).find((p) => p.kind === "circuit")?.parts as { id: string; k: number; r: number; efficiency: number; friction: number }[]).find((p) => p.id === "mot/motor") as { k: number; r: number; efficiency: number; friction: number }
	const x0 = placement(r.track, "car/chassis", 2.5).x
	const x1 = placement(r.track, "car/chassis", 3.5).x
	const v = x1 - x0
	const vb = mean(r.track, "bat", "voltage", 2.5, 3.5)
	const i = mean(r.track, "mot", "current", 2.5, 3.5)
	const rpm = mean(r.track, "mot", "rpm", 2.5, 3.5)
	const wheelR = 0.025
	check(rel(v, (rpm / RPM) * wheelR) < 0.02 && v > 0, "the battery car rolls forward as its wheels turn (v = ω·r: they grip)", `${f(v)} m/s vs ω·r ${f((rpm / RPM) * wheelR)} m/s`)
	// the motor's own line: V = k·ω + I·R, and at a steady speed η·k·I = its gearbox's friction (plus the car's rolling)
	const vm = mean(r.track, "mot", "voltage", 2.5, 3.5)
	check(rel(vm, part.k * (rpm / RPM) + i * part.r) < 0.01, "the motor's back-EMF: its voltage = k·ω + I·R", `${f(vm)} V vs ${f(part.k * (rpm / RPM) + i * part.r)} V (battery ${f(vb)} V)`)
	check(part.efficiency * part.k * i >= part.friction * 0.98 && part.efficiency * part.k * i < part.friction * 1.6, "at its steady speed the motor's torque holds its gearbox's friction and the car's rolling", `η·k·I ${f(part.efficiency * part.k * i * 1000)} mN·m vs friction ${f(part.friction * 1000)} mN·m`)
	check(r.summary.goals[0]?.ok === true, "the battery car moves at least 30 cm", `${r.summary.goals[0]?.label}: ${String(r.summary.goals[0]?.ok)}, ${f(placement(r.track, "car/chassis", 4).x - placement(r.track, "car/chassis", 0).x)} m`)
	// with the motor's leads the other way round it drives backward
	const back = run(scene([
		{ id: "car", type: "cart", x: 1.6, y: 0 },
		{ id: "bat", type: "battery", x: 1.6, y: 0.0735 },
		{ id: "mot", type: "motor", x: 1.6, y: 0.2, props: { kind: "geared", drives: "wheels", car: "car" } },
		{ id: "w1", type: "wire", x: 0, y: 0, props: { a: "bat", a_end: "+", b: "mot", b_end: "-" } },
		{ id: "w2", type: "wire", x: 0, y: 0, props: { a: "mot", a_end: "+", b: "bat", b_end: "-" } }
	], 2))
	check(placement(back.track, "car/chassis", 2).x < 1.6 - 0.2, "wired the other way round the car drives backward", `${f(placement(back.track, "car/chassis", 2).x - 1.6)} m`)
}

// ------------------------------------------------------------------------------------------------ goal kinds and the same track twice
if (on("goals")) {
	const r = run(scene([
		breeze(5),
		{ id: "a", type: "wind-turbine", x: 0.6, y: 0, props: { blades: 3 } },
		{ id: "b", type: "wind-turbine", x: 1.8, y: 0, props: { blades: 3, pitch: 45 } },
		...[["ra", "a", 0.9], ["rb", "b", 2.1]].flatMap(([res, gen, x]) => [
			{ id: res as string, type: "resistor", x: x as number, y: 0.006, props: { ohms: 50 } },
			{ id: `${res}1`, type: "wire", x: 0, y: 0, props: { a: gen, a_end: "+", b: res, b_end: "+" } },
			{ id: `${res}2`, type: "wire", x: 0, y: 0, props: { a: res, a_end: "-", b: gen, b_end: "-" } }
		])
	], 8, { goals: [{ kind: "generates", item: "a", at_least_v: 1 }, { kind: "generates_more", a: "a", b: "b" }] }))
	const [g1, g2] = r.summary.goals
	check(g1?.ok === true && g2?.ok === true, "goals: a turbine generates at least 1 V; 20° blades make more power than 45° ones (a fair test)", `${g1?.label}: ${String(g1?.ok)}; ${g2?.label}: ${String(g2?.ok)}`)
	const p = run(scene([
		breeze(4),
		{ id: "a", type: "pinwheel", x: 0.6, y: 0, props: { load_g: 20, axle_mm: 6 } },
		{ id: "b", type: "pinwheel", x: 1.8, y: 0, props: { load_g: 20, axle_mm: 3 } }
	], 1.2, { goals: [{ kind: "lifts_higher", a: "a", b: "b" }] }))
	check(p.summary.goals[0]?.ok === true, "goals: in the same time a thicker straw lifts the cup higher (it winds more thread a turn)", `${p.summary.goals[0]?.label}: ${String(p.summary.goals[0]?.ok)}`)
}
if (on("determinism")) {
	const s = scene([breeze(5), { id: "wt", type: "wind-turbine", x: 1.2, y: 0, props: { load_g: 50 } }], 3)
	const a = JSON.stringify(run(s).track)
	const b = JSON.stringify(run(s).track)
	check(a === b, "the same scene twice: the same track, byte for byte", `${a.length} bytes`)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
