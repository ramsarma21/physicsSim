// The matter module (machines/mod_matter.py, web/sim/modules/matter.js, tooling/src/sim/modules/matter.ts, tooling/src/sim/matter/*) against
// real reference values: the particle model's gas laws and heating curve, dissolving and saturation, settling, conservation of mass on a
// kitchen scale (a snapped bar, ice melting in a bag, salt dissolving, a fizzing bottle open, capped and ballooned, a ball pumped up), the
// density cubes, sieving and a magnet's field and pull, the lesson demos, determinism and a crash fuzz. Gated: exit 1 when any check fails.
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-matter.ts [gas|heating|boyle|charles|piston|graham|mixing|dissolve|saturate|settle|mass|density|sieve|magnet|filter|evaporate|demos|chem|models|closed|fuzz|all]
// Scenes are built by web/sim (the browser's builder; tools/parity/matter.mjs proves it is machines/*.py number for number) and run by the
// engine from its sources in node, as the server runs them.
// References (each check names its own):
//   [CODATA] R = 8.314462618 J/(mol·K) (CODATA 2018, exact); 1 atm = 101.325 kPa; 0 °C = 273.15 K
//   [ISO]    ISO 2533: dry air M = 28.9644 g/mol, ρ = P/(287.05·T) (1.204 kg/m³ at 20 °C, 1 atm)
//   [KT]     kinetic theory: mean speed √(8RT/πM) (Maxwell 1860); ideal gas P = nRT/V (Clapeyron 1834); Boyle (1662) p·V constant at fixed T;
//            Charles / Gay-Lussac (1802) V ∝ T at fixed p; Graham (1846) speeds ∝ 1/√M
//   [CRC]    CRC Handbook of Chemistry and Physics, 97th ed.: ice c_p 2.09 kJ/(kg·K) near −10 °C, water 4.184, fusion 333.55 kJ/kg, vaporization
//            2257 kJ/kg; NaCl solubility 35.89 g per 100 g water at 20 °C (26.4 mass %), 37.17 g at 60 °C; sucrose 203.9 g at 20 °C; water
//            998.21 kg/m³ at 20 °C, 1.0016 mPa·s; densities of the cube materials
//   [NIST]   NIST Chemistry WebBook molar masses: NaHCO3 84.007, CO2 44.010, CH3COOH 60.052 g/mol; 5 g of soda gives 5·44.010/84.007 = 2.619 g CO2
//   [SN]     Schiller & Naumann (1933): a sphere's drag C_D = 24/Re·(1 + 0.15·Re^0.687), Re < 800 (Clift, Grace & Weber, Bubbles, Drops and
//            Particles, 1978, Table 5.2)
//   [FURLANI] a cylinder magnet's on-axis field B(z) = (Br/2)·[(z+L)/√((z+L)²+R²) − z/√(z²+R²)] (Furlani, Permanent Magnet and
//            Electromechanical Devices, 2001, §2.7; K&J Magnetics' calculator); N42 Br 1.3 T
//   [FIFA]   size-5 ball 68-70 cm round (Ø 22 cm, 5.58 L), 0.6-1.1 bar
//   [NIST-HB44] a kitchen scale's division d = 1 g (NIST Handbook 44, class III); its reading follows Σm (the engine's contact forces ÷ g)
//   [WHATMAN] Cytiva, Whatman qualitative filter papers: Grade 1, particle retention 11 µm, Herzberg flow 150 s (100 mL through 10 cm² under
//            a 10 cm head): Darcy's R = ρgh·A/(μQ) = 1.47e9 1/m; in a 60° funnel V(t) = V0·e^(−t/τ), τ = sin30°·μR/(share·ρ·g)
//   [CARMAN] Kozeny-Carman k = d²ε³/(180(1 − ε)²) (Carman 1937): a cake of 5 µm chalk is thousands of times tighter than 0.25 mm sand
//   [ASHRAE] psychrometrics: the wet-bulb temperature of air at 20 °C, 50 % RH is 13.7 °C (an evaporating surface cools toward it)
//   [SANDER15] Henry's law for CO2 in water: H^cp = 3.3e-4 mol/(m³·Pa) at 25 °C, −d ln H/d(1/T) = 2400 K (Sander, Atmos. Chem. Phys. 15,
//            4399, 2015): 1.69 g per litre per atm at 20 °C
//   [ISBT]   PET soda bottles: a closure holds 100 psi (690 kPa gauge) in the secure-seal test; bottles burst at about 1-1.5 MPa
//   [SPAN96] CO2's vapour pressure 5729 kPa at 20 °C (Span & Wagner 1996, NIST WebBook); water's 101.42 kPa at 100 °C (IAPWS-95)
//   [LAB]    gravity filtration of about 100 mL through qualitative paper in a 75 mm funnel takes 10-30 minutes; 50 mL of salt water boils dry
//            on a hot plate in 10-25 minutes; a dish of water in still indoor air loses about 0.5-3 mm a day (common lab and classroom
//            experience: approximate ranges, not measurements)
import { pathToFileURL } from "node:url"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
type Track = { frames: { t: number }[]; state?: Record<string, Record<string, number[]>>; series?: Record<string, Record<string, number[][]>> }
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: object } }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: object, fps: number) => Track }
await import(`${PG}/tooling/src/sim/modules/index.ts`)
const G = (await import(`${PG}/tooling/src/sim/matter/glass.ts`)) as { Glass: new (s: object) => { step: (t: number, h: number) => void; y: Float64Array; vy: Float64Array } }
const SUB = (await import(`${PG}/tooling/src/sim/matter/substances.ts`)) as { SOLUTES: Record<string, object> }
const GR = (await import(`${PG}/tooling/src/sim/matter/grains.ts`)) as { barMagnet: (cx: number, cy: number, a: number, L: number, A: number, br: number, soft?: number) => (x: number, y: number) => { bx: number; by: number } }
const sim = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as {
	prepare: (s: object) => { scene: object; doc: object; resolved: object }
	finish: (s: object, d: object, r: object, t: Track) => { summary: { goals: { ok: boolean; label: string }[]; readings: Record<string, Record<string, number>> } }
	catalog: () => { types: { key: string; module?: string; props: { key: string; kind: string; min?: number; max?: number; choices?: string[] }[] }[] }
}

const R = 8.314462618
const ATM = 101.325
const K0 = 273.15
let failures = 0
let checks = 0
const pct = (got: number, want: number) => (want === 0 ? `${(got - want).toExponential(2)}` : `${(((got - want) / want) * 100).toFixed(2)}%`)
const check = (label: string, got: number | null | undefined, want: number, tol: number, unit = "") => {
	checks++
	const ok = typeof got === "number" && Number.isFinite(got) && Math.abs(got - want) <= tol
	if (!ok) failures++
	console.log(`  ${ok ? "PASS" : "FAIL"} ${label}: ${typeof got === "number" ? got.toFixed(4) : got}${unit}, reference ${want.toFixed(4)}${unit} (${typeof got === "number" ? pct(got, want) : "-"}; within ±${tol}${unit})`)
}
const claim = (label: string, ok: boolean, detail = "") => {
	checks++
	if (!ok) failures++
	console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`)
}
const STAGE = { x0: -0.6, x1: 4.2, y0: -0.2, y1: 1.6 }
const scene = (items: object[], extra: Record<string, unknown> = {}) => ({ version: 2, id: "rwmat", name: "rwmat", seconds: 4, release: 0.3, stage: STAGE, items: [{ id: "table", type: "table", x: 1.8, y: 0, props: { width: 5 } }, ...items], goals: [], ...extra })
const run = (s: object, fps = 60) => {
	const p = sim.prepare(s)
	const track = simulate(admitDocument(p.doc).scene, fps)
	const fin = sim.finish(p.scene, p.doc, p.resolved, JSON.parse(JSON.stringify(track)))
	const times = track.frames.map((f) => f.t)
	const st = (item: string, key: string) => track.state?.[item]?.[key] ?? []
	const end = (item: string, key: string) => {
		const v = st(item, key)
		return v.length ? (v[v.length - 1] as number) : null
	}
	/** The mean of a reading over run times t0..t1. */
	const mean = (item: string, key: string, t0: number, t1: number) => {
		const v = st(item, key)
		let s = 0
		let n = 0
		times.forEach((t, i) => {
			if (t >= t0 && t <= t1 && typeof v[i] === "number") {
				s += v[i] as number
				n++
			}
		})
		return n ? s / n : null
	}
	/** The first run time a reading meets `when`. */
	const first = (item: string, key: string, when: (v: number) => boolean) => {
		const v = st(item, key)
		for (let i = 0; i < times.length; i++) if (typeof v[i] === "number" && when(v[i] as number)) return times[i] as number
		return null
	}
	return { track, times, st, end, mean, first, summary: fin.summary }
}
const SCALE_TOP = 0.026

// ---------------------------------------------------------------- the particle box's gauge against the ideal gas
function gas() {
	console.log("particle box: a sealed gas's gauge (the particles' wall hits, calibrated) against P = nRT/V [KT][CODATA] (mean of the last 2 s over 3 boxes: the model's 40-60 particles flicker)")
	for (const [sub, M, T] of [["air", 28.9644e-3, 20], ["air", 28.9644e-3, 150], ["helium", 4.0026e-3, 20], ["nitrogen", 28.0134e-3, -50]] as const) {
		const ids = ["b1", "b2", "b3"]
		const r = run(scene(ids.map((id, k) => ({ id, type: "particle-box", x: 0.4 + k * 1.2, y: 0, props: { substance: sub, temp_c: T, sample_g: 1, volume_ml: 1000 } })), { seconds: 4 }))
		const got = ids.map((id) => r.mean(id, "pressure_kpa", 2, 4) as number).reduce((a, b) => a + b, 0) / ids.length
		const want = ((1e-3 / M) * R * (T + K0)) / 1e-3 / 1000
		check(`${sub} 1 g in 1 L at ${T} °C`, got, want, want * 0.08, " kPa")
		// the reading of the molecules' mean speed is exact kinetic theory
		check(`${sub} mean molecular speed at ${T} °C`, r.end("b1", "speed_ms"), Math.sqrt((8 * R * (T + K0)) / (Math.PI * M)), Math.sqrt((8 * R * (T + K0)) / (Math.PI * M)) * 0.005, " m/s")
	}
}

// ---------------------------------------------------------------- the heating curve
function heating() {
	console.log("particle box: 1 g of ice at −20 °C on a 10 W heater (time-lapse 50: 500 J a run second): its temperature climbs, holds at 0 °C while it melts and at 100 °C while it boils, for exactly the latent heats [CRC]")
	const W = 10
	const lapse = 50
	const r = run(scene([{ id: "box", type: "particle-box", x: 1.2, y: 0, props: { substance: "water", temp_c: -20, sample_g: 1, heater_w: W, heat_from_s: 0.5 } }], { seconds: 8, settings: { time_lapse: lapse } }), 120)
	const rate = W * lapse // J per run second
	const plateau = (temp: number) => {
		const v = r.st("box", "temp_c")
		const at = r.times.filter((_, i) => Math.abs((v[i] as number) - temp) < 1e-9)
		return at.length ? (at[at.length - 1] as number) - (at[0] as number) : null
	}
	check("the 0 °C plateau lasts fusion ÷ power (333.55 J)", plateau(0), 333.55 / rate, 2 / 120 + 1e-9, " s")
	check("the 100 °C plateau lasts vaporization ÷ power (2257 J)", plateau(100), 2257 / rate, 2 / 120 + 1e-9, " s")
	check("melting begins once the ice is warmed 20 K (41.8 J)", r.first("box", "liquid_pct", (x) => x > 0), 0.5 + 41.8 / rate, 2 / 120, " s")
	check("boiling begins after melting and warming 100 K (+333.55 + 418.4 J)", r.first("box", "gas_pct", (x) => x > 0), 0.5 + (41.8 + 333.55 + 418.4) / rate, 2 / 120, " s")
	check("the heat put in = power × lesson time", r.mean("box", "heat_kj", 3, 3), (W * (3 - 0.5) * lapse) / 1000, 0.006, " kJ")
	check("the particles at the end are a gas", r.end("box", "gas_pct"), 100, 0)
	// melting share ∝ heat in, on the plateau
	const mid = r.mean("box", "liquid_pct", 0.5 + (41.8 + 333.55 / 2) / rate, 0.5 + (41.8 + 333.55 / 2) / rate + 1 / 120)
	check("half the fusion heat in: half melted (the heater's work comes in 60 Hz beats of 8.3 J: 2.5 % of the fusion)", mid, 50, 3, " %")
}

// ---------------------------------------------------------------- Boyle: a sealed syringe pushed in
function boyle() {
	console.log("syringe: a sealed 60 mL syringe of air pushed in (isothermal: p·V = 60 mL × 101.325 kPa) [KT] (the reading is the real air's: within 0.1 %, down to 5 mL; the push to hold it (p − 1 atm) × 5.60 cm² [BD])")
	for (const [to, push] of [[45, 1.5], [30, 1.5], [20, 1.5], [10, 1.5], [5, 1.5], [5, 0.1]] as const) {
		const r = run(scene([{ id: "s1", type: "syringe", x: 0.6, y: 0, props: { start_ml: 60, push_to_ml: to, push_from_s: 0.5, push_s: push } }], { seconds: 3 }), 120)
		check(`pushed to ${to} mL in ${push} s: volume`, r.end("s1", "volume_ml"), to, 0.01, " mL")
		check(`pushed to ${to} mL in ${push} s: pressure`, r.mean("s1", "pressure_kpa", 2.5, 3), (ATM * 60) / to, ((ATM * 60) / to) * 0.001, " kPa")
		const force = ((ATM * 60) / to - ATM) * 1000 * ((Math.PI * 0.0267 ** 2) / 4)
		check(`pushed to ${to} mL: the push that holds it`, r.end("s1", "force_n"), force, Math.max(0.05, force * 0.001), " N")
		claim(`  said once past 200 N (${to} mL)`, ((r.track as { events?: { text: string }[] }).events ?? []).filter((e) => /plunger/.test(e.text)).length === (force > 200 ? 1 : 0))
	}
}

// ---------------------------------------------------------------- Charles: a balloon in a warm or cold bath
function charles() {
	console.log("balloon-bath: a 1 L balloon of air at 20 °C dipped in water: its volume follows the kelvin temperature (V = V0·T/T0) [KT]")
	for (const T of [0, 40, 60, 80]) {
		const r = run(scene([{ id: "b", type: "balloon-bath", x: 1.2, y: 0, props: { water_temp_c: T, settle_s: 5 } }], { seconds: 6, settings: { time_lapse: 20 } }))
		check(`water at ${T} °C`, r.end("b", "volume_l"), (T + K0) / (20 + K0), 0.002, " L")
	}
}

// ---------------------------------------------------------------- a piston holding a load
function piston() {
	console.log("particle box with a piston: the piston slides to where the gas's nRT/V = 1 atm + load·g/area [KT] (its volume at the end); heated, it rises (Charles)")
	for (const [kg, T] of [[0.5, 20], [1, 20], [2, 20], [4, 20], [1, 120]] as const) {
		const r = run(scene([{ id: "p", type: "particle-box", x: 1.2, y: 0, props: { substance: "air", sample_g: 1.2, temp_c: T, piston: true, load_kg: kg, particles: 40 } }], { seconds: 4 }), 60)
		const P = ATM * 1000 + (kg * 9.81) / 7.07e-4
		const want = ((1.2e-3 / 28.9644e-3) * R * (T + K0)) / P * 1e6
		check(`${kg} kg on 7.07 cm² at ${T} °C`, r.end("p", "volume_ml"), want, want * 0.005, " mL")
	}
	// heated from 20 °C under 1 kg: the volume follows the kelvin temperature
	const h = run(scene([{ id: "p", type: "particle-box", x: 1.2, y: 0, props: { substance: "air", sample_g: 1.2, temp_c: 20, piston: true, load_kg: 1, particles: 40, heater_w: 1, heat_from_s: 0.5 } }], { seconds: 6, settings: { time_lapse: 30 } }), 60)
	// (the piston follows in about PISTON_TAU, 0.3 s: on a steady climb it stands where the gas was 0.3 s before)
	const T1 = h.mean("p", "temp_c", 5.69, 5.71) as number
	check(`heated under 1 kg (${T1.toFixed(1)} °C 0.3 s before the end): V = V(20 °C)·T/293.15 K`, h.end("p", "volume_ml"), 876.5694 * (T1 + K0) / (20 + K0), 876.5694 * (T1 + K0) / (20 + K0) * 0.01, " mL")
}

// ---------------------------------------------------------------- Graham: lighter molecules are faster
function graham() {
	console.log("particle box: two gases at one temperature: the mean speed readings go as 1/√M [KT]; the model's particles too (their mean speed over 2 s)")
	const r = run(scene([
		{ id: "he", type: "particle-box", x: 0.6, y: 0, props: { substance: "helium", temp_c: 20 } },
		{ id: "n2", type: "particle-box", x: 1.8, y: 0, props: { substance: "nitrogen", temp_c: 20 } }
	], { seconds: 3 }))
	check("speed ratio helium / nitrogen", (r.end("he", "speed_ms") as number) / (r.end("n2", "speed_ms") as number), Math.sqrt(28.0134 / 4.0026), 0.002)
	// the drawn particles: their positions over time (the series p: x, y per particle)
	const speed = (id: string) => {
		const p = r.track.series?.[id]?.p
		if (!p || p.length < 20) return null
		const dt = (r.times[1] as number) - (r.times[0] as number)
		let s = 0
		let n = 0
		for (let f = Math.floor(p.length / 3); f < p.length - 1; f++) {
			const a = p[f] as number[]
			const b = p[f + 1] as number[]
			for (let k = 0; k + 1 < a.length && k + 1 < b.length; k += 2) {
				const d = Math.hypot((b[k] as number) - (a[k] as number), (b[k + 1] as number) - (a[k + 1] as number))
				if (d < 0.05) {
					s += d / dt
					n++
				}
			}
		}
		return n ? s / n : null
	}
	const he = speed("he")
	const n2 = speed("n2")
	if (he !== null && n2 !== null) check("the model particles' speed ratio (frame to frame, bounces blur it)", he / n2, Math.sqrt(28.0134 / 4.0026), 0.6)
	else claim("the model's particle series is there", false)
}

// ---------------------------------------------------------------- mixing: diffusion
function mixing() {
	console.log("particle box with a divider: nothing mixes before it lifts; after, the two gases spread through each other, faster when hotter [KT]")
	const r = run(scene([
		{ id: "cold", type: "particle-box", x: 0.6, y: 0, props: { substance: "air", second: "bromine", divider: true, open_at_s: 1, temp_c: 0 } },
		{ id: "hot", type: "particle-box", x: 1.8, y: 0, props: { substance: "air", second: "bromine", divider: true, open_at_s: 1, temp_c: 300 } }
	], { seconds: 5 }))
	check("mixed before the divider lifts", r.mean("cold", "mixed_pct", 0.5, 0.95), 0, 0.001, " %")
	const tc = r.first("cold", "mixed_pct", (x) => x >= 60)
	const th = r.first("hot", "mixed_pct", (x) => x >= 60)
	claim("both mix (≥ 80 % at the end)", (r.end("cold", "mixed_pct") as number) >= 80 && (r.end("hot", "mixed_pct") as number) >= 80, `${r.end("cold", "mixed_pct")} / ${r.end("hot", "mixed_pct")} %`)
	claim("the hot box reaches 60 % mixed first", th !== null && (tc === null || th < tc), `hot ${th} s, cold ${tc} s`)
}

// ---------------------------------------------------------------- dissolving: what speeds it up
function dissolve() {
	console.log("dissolving-glass: faster when hotter, stirred, finer (Noyes-Whitney with Ranz-Marshall / Churchill mass transfer); sand and chalk never [CRC]; lesson times")
	const g = (id: string, x: number, props: object) => ({ id, type: "dissolving-glass", x, y: 0, props: { start_in: "glass", ...props } })
	const r = run(scene([
		g("hot", 0.3, { solute: "sugar", grain: "cube", solute_g: 2.2, water_temp_c: 60 }),
		g("cold", 0.8, { solute: "sugar", grain: "cube", solute_g: 2.2, water_temp_c: 10 }),
		g("stir", 1.3, { solute: "salt", solute_g: 10, stir: 2, stir_from_s: 0.5 }),
		g("still", 1.8, { solute: "salt", solute_g: 10 }),
		g("fine", 2.3, { solute: "sugar", grain: "powder", solute_g: 5, stir: 1, stir_from_s: 0.5 }),
		g("coarse", 2.8, { solute: "sugar", grain: "coarse", solute_g: 5, stir: 1, stir_from_s: 0.5 }),
		g("sand", 3.3, { solute: "sand", solute_g: 10, stir: 2 }),
		g("chalk", 3.8, { solute: "chalk", solute_g: 10, stir: 2 })
	], { seconds: 10, settings: { time_lapse: 30 } }))
	const done = (id: string) => r.first(id, "left_g", (v) => v <= 0.005)
	const share = (id: string) => (r.end(id, "dissolved_pct") as number) ?? 0
	const beats = (a: string, b: string) => {
		const ta = done(a)
		const tb = done(b)
		return ta !== null ? tb === null || ta < tb : share(a) > share(b)
	}
	claim("a sugar cube: hot (60 °C) before cold (10 °C)", beats("hot", "cold"), `${done("hot")} vs ${done("cold")} s; ${share("hot")} vs ${share("cold")} %`)
	claim("table salt: stirred before still", beats("stir", "still"), `${done("stir")} vs ${done("still")} s`)
	claim("sugar: powder before coarse", beats("fine", "coarse"), `${done("fine")} vs ${done("coarse")} s`)
	check("sand dissolves none", r.end("sand", "dissolved_g"), 0, 0, " g")
	check("chalk dissolves none (CaCO3: 0.0013 g per 100 g)", r.end("chalk", "dissolved_g"), 0, 0.001, " g")
	// lesson times (the clock reading is lesson seconds): stirred table salt (10 g in 200 mL) goes in well under a minute, as in a kitchen;
	// a still sugar cube in cold water takes minutes
	const clockAt = (id: string, t: number | null) => (t === null ? null : r.mean(id, "clock_s", t, t + 1e-6))
	const tStir = clockAt("stir", done("stir"))
	claim("stirred table salt: all dissolved within 10-60 s of lesson time", tStir !== null && tStir >= 10 && tStir <= 60, `${tStir} s`)
	claim("a sugar cube in 10 °C still water: not gone within 2 lesson minutes", (r.mean("cold", "left_g", 0, 0) ?? 0) >= 0 && (r.first("cold", "clock_s", (v) => v >= 120) === null || (r.mean("cold", "left_g", r.first("cold", "clock_s", (v) => v >= 120) as number, r.first("cold", "clock_s", (v) => v >= 120) as number) as number) > 0), `${r.end("cold", "left_g")} g left at ${r.end("cold", "clock_s")} s`)
	// mass: dissolved + left = put in, exactly
	for (const id of ["hot", "stir", "fine", "sand"]) check(`${id}: dissolved + undissolved = put in`, (r.end(id, "dissolved_g") as number) + (r.end(id, "left_g") as number), id === "hot" ? 2.2 : id === "fine" ? 5 : 10, 0.001, " g")
}

// ---------------------------------------------------------------- saturation
function saturate() {
	console.log("dissolving-glass: more than the water holds stays on the bottom; the dissolved mass stops at the solubility × water's mass [CRC]")
	for (const [sol, T, ml, put, per100] of [["salt", 20, 100, 50, 35.89], ["salt", 60, 100, 50, 37.17], ["sugar", 20, 40, 100, 203.9]] as const) {
		const r = run(scene([{ id: "g", type: "dissolving-glass", x: 1.2, y: 0, props: { solute: sol, solute_g: put, water_ml: ml, water_temp_c: T, stir: 3, start_in: "glass", stir_from_s: 0.3 } }], { seconds: 10, settings: { time_lapse: 60 } }))
		const rho = T === 20 ? 0.99821 : 0.98320
		const want = (per100 * ml * rho) / 100
		check(`${put} g of ${sol} in ${ml} mL at ${T} °C: dissolved`, r.end("g", "dissolved_g"), want, want * 0.01, " g")
		check(`  left on the bottom`, r.end("g", "left_g"), put - want, Math.max(0.05, want * 0.01), " g")
		claim(`  reads saturated`, r.end("g", "saturated") === 1)
	}
}

// ---------------------------------------------------------------- a grain sinking through water
function settle() {
	console.log("dissolving-glass's crystals: a coarse grain of sand (insoluble) sinks through still water at the Schiller-Naumann terminal speed [SN][CRC]")
	for (const d of [0.0003, 0.001, 0.002]) {
		const solute = SUB.SOLUTES.sand as { density: number }
		const g = new G.Glass({ radius: 0.035, height: 0.1, depth: 0.09, temperature: 20, solute, mass: 1e-4, grain: d, specks: 1, pourAt: 0, pourHeight: 0.085, startIn: "spoon", stir: 0, stirFrom: 0, stirUntil: 0, timeLapse: 1, seed: 1 })
		let v = 0
		for (let k = 0; k < 480 * 2; k++) {
			g.step(k / 480, 1 / 480)
			if ((g.y[0] as number) > 0.01) v = -(g.vy[0] as number)
		}
		// terminal: (ρs − ρ)·g·πd³/6 = ½·ρ·v²·C_D·πd²/4, C_D = 24/Re·(1 + 0.15 Re^0.687); solved by bisection
		const rho = 998.21
		const mu = 1.0016e-3
		const f = (u: number) => {
			const Re = (rho * u * d) / mu
			return (24 / Re) * (1 + 0.15 * Math.pow(Re, 0.687)) * 0.5 * rho * u * u * (Math.PI * d * d) / 4 - (solute.density - rho) * 9.81 * (Math.PI * d * d * d) / 6
		}
		let lo = 1e-6
		let hi = 2
		for (let k = 0; k < 80; k++) {
			const mid = (lo + hi) / 2
			if (f(mid) > 0) hi = mid
			else lo = mid
		}
		check(`a ${d * 1000} mm grain`, v, lo, lo * 0.03, " m/s")
	}
}

// ---------------------------------------------------------------- conservation of mass on a kitchen scale
function mass() {
	console.log("kitchen-scale: closed changes keep the mass (snapping, melting in a sealed bag, dissolving); open ones lose the gas; a balloon buoys; pumped air adds [NIST][ISO][FIFA][NIST-HB44]")
	const on = (scaleX: number, item: object) => [{ id: `s${scaleX}`, type: "kitchen-scale", x: scaleX, y: 0 }, { ...item, x: scaleX, y: SCALE_TOP }]
	const r = run(scene([
		...on(0.3, { id: "bar", type: "chocolate-bar", props: { snap_at_s: 1.2 } }),
		...on(0.7, { id: "glass", type: "dissolving-glass", props: { solute: "salt", solute_g: 10, water_ml: 100, start_in: "dish", stir: 2, pour_at_s: 1, stir_from_s: 1.2 } }),
		...on(1.1, { id: "open", type: "reaction-bottle", props: { closure: "open", react_s: 1.5 } }),
		...on(1.5, { id: "cap", type: "reaction-bottle", props: { closure: "cap", react_s: 1.5 } }),
		...on(1.9, { id: "bal", type: "reaction-bottle", props: { closure: "balloon", react_s: 1.5 } }),
		...on(2.3, { id: "ball", type: "pumped-ball", props: { pump_at_s: 1, pump_s: 2 } })
	], { seconds: 10, settings: { time_lapse: 10 } }))
	const rel = 0.3
	const start = (s: string) => r.mean(s, "grams", rel + 0.5, rel + 0.6) as number
	const fin = (s: string) => r.mean(s, "grams", 9.7, 10) as number
	check("chocolate bar: 100 g whole", start("s0.3"), 100, 0.05, " g")
	check("chocolate bar: 100 g snapped", fin("s0.3"), 100, 0.05, " g")
	claim("  the bar did snap", (r.end("bar", "pieces_apart") as number) > 0)
	check("salt dissolving (dish on the scale): reading unchanged", fin("s0.7") - start("s0.7"), 0, 0.05, " g")
	claim("  the salt did dissolve", (r.end("glass", "left_g") as number) <= 0.005, `${r.end("glass", "left_g")} g left`)
	const co2 = (5 * 44.01) / 84.007
	check("open bottle: down by the CO2 made (5 g soda)", fin("s1.1") - start("s1.1"), -co2, 0.06, " g")
	// (the fizz runs on the lesson clock: 9 run seconds × time-lapse 10 = 90 lesson seconds, 60 of its 1.5 s times: all made)
	check("  its CO2 reading", r.end("open", "co2_g"), co2 * (1 - Math.exp(-((10 - 1) * 10) / 1.5)), 0.01, " g")
	check("capped bottle: unchanged", fin("s1.5") - start("s1.5"), 0, 0.05, " g")
	const vBal = r.end("bal", "balloon_ml") as number
	// (the vinegar keeps its Henry's-law share of the gas [SANDER15]: the balloon holds the rest at about 1 atm, 24.06 L/mol at 20 °C)
	check("balloon bottle: the balloon holds the CO2 the vinegar does not (Henry) at about 1 atm (24.06 L/mol at 20 °C)", vBal, henryBalloon(co2 / 44.01, 100e-6, 400e-6) * 24055, 5, " mL")
	check("balloon bottle: down by the air the balloon pushes aside (1.204 kg/m³ × V)", fin("s1.9") - start("s1.9"), -1.204e-3 * vBal, 0.06, " g")
	const air = (0.8e5 / (287.05 * (20 + K0))) * ((4 / 3) * Math.PI * 0.11 ** 3) * 1000
	check("ball pumped 0 → 0.8 bar (Ø 22 cm): up by the air's mass", fin("s2.3") - start("s2.3"), air, 0.05, " g")
	// ice melting in a sealed bag (heat module's ice): mass the same, the ice did melt
	const b = run(scene([{ id: "s", type: "kitchen-scale", x: 1.2, y: 0 }, { id: "bag", type: "zip-bag", x: 1.2, y: SCALE_TOP }, { id: "ice", type: "ice-cube", x: 1.2, y: SCALE_TOP + 0.0025 + 0.015, props: { width: 0.03, height: 0.03, depth: 0.03 } }], { seconds: 8, settings: { time_lapse: 900, room_temp: 25 } }))
	check("ice in a sealed bag: reading unchanged as it melts", (b.mean("s", "grams", 7.7, 8) as number) - (b.mean("s", "grams", 0.8, 0.9) as number), 0, 0.05, " g")
	claim("  the ice melted (water in the bag)", (b.end("bag", "water_g") as number) > 5, `${b.end("bag", "water_g")} g of water`)
}

// ---------------------------------------------------------------- closed containers: Henry's law, a cap that pops, a vacuum, impossible states
/** mol of CO2 in the gas of a ballooned bottle: made mol shared with V_l m³ of vinegar under the headspace's V_h m³ of air at 1 atm [SANDER15]. */
function henryBalloon(made: number, Vl: number, Vh: number) {
	const H = 3.3e-4 * Math.exp(2400 * (1 / (20 + K0) - 1 / 298.15))
	const RT = R * (20 + K0)
	const nAir = (ATM * 1000 * Vh) / RT
	const k = H * Vl * ATM * 1000
	// n² + n(n_air + k − made) − made·n_air = 0
	const b = nAir + k - made
	return (-b + Math.sqrt(b * b + 4 * made * nAir)) / 2
}
function closed() {
	console.log("closed containers: a capped fizz bottle shares its CO2 with the vinegar (Henry) [SANDER15] and pops its cap past 900 kPa [ISBT]; a vacuum; a box packed tighter than its solid; a gas past its vapour pressure [SPAN96]")
	const H = 3.3e-4 * Math.exp(2400 * (1 / (20 + K0) - 1 / 298.15))
	check("Henry's constant for CO2 at 20 °C: 1.69 g per litre per atm", H * ATM * 1000 * 44.01 / 1000, 1.688, 0.01, " g/L/atm")
	const on = (x: number, item: object) => [{ id: `s${x}`, type: "kitchen-scale", x, y: 0 }, { ...item, x, y: SCALE_TOP }]
	const r = run(scene([
		...on(0.4, { id: "cap", type: "reaction-bottle", props: { closure: "cap", react_s: 1.5 } }),
		...on(1.1, { id: "big", type: "reaction-bottle", props: { closure: "cap", vinegar_ml: 400, acid_pct: 10, soda_g: 30, react_s: 3 } }),
		...on(1.6, { id: "open", type: "reaction-bottle", props: { closure: "open", vinegar_ml: 400, acid_pct: 10, soda_g: 30, react_s: 3 } })
	], { seconds: 8, settings: { time_lapse: 10 } }))
	const start = (s: string) => r.mean(s, "grams", 0.8, 0.9) as number
	const fin = (s: string) => r.mean(s, "grams", 7.7, 8) as number
	// 5 g of soda capped: n_g = n/(1 + H·V_l·RT/V_h) in the 400 mL headspace over 100 mL of vinegar
	const n = 5 / 84.007
	const ng = n / (1 + (H * 100e-6 * R * (20 + K0)) / 400e-6)
	check("capped (5 g soda, 100 mL): CO2 dissolved in the vinegar", r.end("cap", "co2_dissolved_g"), (n - ng) * 44.01, 0.01, " g")
	check("capped: the pressure is the air sealed in + the CO2 gas's n·R·T/V", r.end("cap", "pressure_kpa"), ATM + (ng * R * (20 + K0)) / 400e-6 / 1000, 0.5, " kPa")
	check("capped: the scale reads the same", fin("s0.4") - start("s0.4"), 0, 0.05, " g")
	claim("capped: no pop at that pressure (under 900 kPa)", r.end("cap", "popped") === 0)
	claim("30 g of soda in 400 mL of 10 % vinegar, capped: the cap pops", r.end("big", "popped") === 1)
	claim("  said once", ((r.track as { events?: { text: string }[] }).events ?? []).filter((e) => /cap pops off big past 900 kPa/.test(e.text)).length === 1)
	const before = r.st("big", "pressure_kpa").filter((x) => x > ATM + 1)
	check("  the highest pressure before it pops: under 900 kPa", Math.max(...before), 880, 20, " kPa")
	claim("  after the pop the pressure is the room's", Math.abs((r.end("big", "pressure_kpa") as number) - ATM) < 1e-6)
	const lost = fin("s1.1") - start("s1.1")
	check("  the scale goes down by what escaped", lost, -(r.end("big", "escaped_g") as number), 0.06, " g")
	claim("  less than an open bottle loses: some is still dissolved, coming out over minutes", lost > fin("s1.6") - start("s1.6") + 1, `${lost.toFixed(2)} vs ${(fin("s1.6") - start("s1.6")).toFixed(2)} g`)
	// a vacuum: no buoyancy on the balloon; the dish refuses to run
	const v = run(scene([...on(0.6, { id: "bal", type: "reaction-bottle", props: { closure: "balloon", react_s: 1.5 } }), { id: "dish", type: "evaporating-dish", x: 1.6, y: 0, props: { heat: "room", water_ml: 50 } }], { seconds: 8, settings: { air: false, time_lapse: 100 } }))
	check("in a vacuum a ballooned bottle's scale reads the same (no air to buoy it)", (v.mean("s0.6", "grams", 7.7, 8) as number) - (v.mean("s0.6", "grams", 0.8, 0.9) as number), 0, 0.05, " g")
	check("in a vacuum the evaporating dish does not run (refused)", v.end("dish", "water_g"), v.st("dish", "water_g")[0] as number, 1e-9, " g")
	claim("  and says why", ((v.track as { events?: { text: string }[] }).events ?? []).some((e) => /dish needs air/.test(e.text)))
	const p = sim.prepare(scene([{ id: "dish", type: "evaporating-dish", x: 1.2, y: 0 }, { id: "box", type: "particle-box", x: 2, y: 0, props: { substance: "carbon dioxide", sample_g: 1000, volume_ml: 1 } }], { settings: { air: false } })) as { doc: { processes: { item: string; mass?: number }[] } }
	const lay = (sim as unknown as { layout: (s: object) => { warnings?: { text: string }[] } }).layout(scene([{ id: "dish", type: "evaporating-dish", x: 1.2, y: 0 }, { id: "box", type: "particle-box", x: 2, y: 0, props: { substance: "carbon dioxide", sample_g: 1000, volume_ml: 1 } }], { settings: { air: false } }))
	claim("  warned before the run (dish; box too dense)", (lay.warnings ?? []).some((w) => /dish needs air/.test(w.text)) && (lay.warnings ?? []).some((w) => /cannot fit in 1 mL/.test(w.text)))
	check("1000 g of CO2 asked in 1 mL: the box holds what dry ice packs (1.562 g/mL)", (p.doc.processes.find((x) => x.item === "box")?.mass as number) * 1000, 1.562, 1e-9, " g")
	// a gas past its vapour pressure: said once; a heavy piston goes to nRT/P (its reading is the load's pressure)
	const q = run(scene([{ id: "b", type: "particle-box", x: 1.2, y: 0, props: { substance: "carbon dioxide", sample_g: 1, piston: true, load_kg: 50, piston_area_cm2: 0.5 } }], { seconds: 4 }))
	const Pload = ATM * 1000 + (50 * 9.81) / 0.5e-4
	check("1 g of CO2 under 50 kg on 0.5 cm²: its volume nRT/P", q.end("b", "volume_ml"), ((1 / 44.01) * R * (20 + K0)) / Pload * 1e6, 0.03, " mL")
	check("  its pressure reading is the load's (the gauge, the volume and nRT/V agree)", (q.end("b", "pressure_kpa") as number), Pload / 1000, Pload / 1000 * 0.005, " kPa")
	claim("  said: past CO2's vapour pressure (5729 kPa at 20 °C) a real one would be partly liquid", ((q.track as { events?: { text: string }[] }).events ?? []).some((e) => /vapour pressure there \(5729 kPa\)/.test(e.text)))
	const w = run(scene([{ id: "b", type: "particle-box", x: 1.2, y: 0, props: { substance: "air", sample_g: 1, piston: true, load_kg: 1 } }], { seconds: 3, settings: { air: false } }))
	check("in a vacuum a piston carries only its load (1 kg on 7.07 cm²): V = nRT/(m·g/A)", w.end("b", "volume_ml"), Math.min(((1e-3 / 28.9644e-3) * R * (20 + K0)) / ((1 * 9.81) / 7.07e-4) * 1e6, 1000 / 0.6), 2, " mL")
	// the heating curve's plateaus as goals (holds_at), and one that is not
	const h = run(scene([{ id: "box", type: "particle-box", x: 1.2, y: 0, props: { substance: "water", temp_c: -20, sample_g: 1, heater_w: 10, heat_from_s: 0.5 } }], {
		seconds: 8, settings: { time_lapse: 50 },
		goals: [{ kind: "holds_at", item: "box", temp_c: 0, while: "melting" }, { kind: "holds_at", item: "box", temp_c: 100, while: "boiling" }, { kind: "holds_at", item: "box", temp_c: 50, while: "melting" }, { kind: "holds_at", item: "box", temp_c: 0, while: "boils" }]
	}), 120)
	const gs = h.summary.goals
	claim("holds_at: 0 °C while it melts (met)", gs[0]?.ok === true, gs[0]?.label)
	claim("holds_at: 100 °C while it boils (met)", gs[1]?.ok === true, gs[1]?.label)
	claim("holds_at: 50 °C while it melts (not met)", gs[2]?.ok === false)
	claim("holds_at: 0 °C while it boils (not met)", gs[3]?.ok === false)
	claim("the 1 g in 1 L box at 100 °C: its steam (171 kPa) past water's vapour pressure (101 kPa) is said", ((h.track as { events?: { text: string }[] }).events ?? []).some((e) => /vapour pressure there \(101 kPa\)/.test(e.text)))
}

// ---------------------------------------------------------------- density cubes
function density() {
	console.log("density-cube (1 inch) and equal-mass-block: mass = ρ·V, volume = m/ρ; in water they float when ρ < 0.998 g/cm³ [CRC]")
	const MAT: [string, number][] = [["aluminium", 2700], ["brass", 8500], ["copper", 8960], ["steel", 7850], ["zinc", 7140], ["oak", 750], ["pine", 400], ["acrylic", 1180], ["nylon", 1150], ["PVC", 1380], ["polypropylene", 905], ["polyethylene", 950]]
	const r = run(scene(MAT.flatMap(([m], k) => [
		{ id: `c-${m}`, type: "density-cube", x: -0.4 + k * 0.35, y: 0, props: { made_of: m } },
		{ id: `b-${m}`, type: "equal-mass-block", x: -0.25 + k * 0.35, y: 0, props: { made_of: m, mass_g: 100 } }
	]), { seconds: 1 }))
	const V = 2.54 ** 3
	for (const [m, rho] of MAT) {
		check(`${m} cube's mass`, r.end(`c-${m}`, "mass_g"), (rho / 1000) * V, (rho / 1000) * V * 0.002, " g")
		check(`${m} 100 g block's volume`, r.end(`b-${m}`, "volume_cm3"), 100 / (rho / 1000), (100 / (rho / 1000)) * 0.002, " cm³")
	}
	const floats = ["pine", "polypropylene", "polyethylene", "nylon", "copper"]
	const tank = run(scene([{ id: "tank", type: "water-tank", x: 1.2, y: 0, props: { style: "aquarium", length: 0.6 } }, ...floats.map((m, k) => ({ id: m, type: "density-cube", x: 0.98 + k * 0.11, y: 0.2, props: { made_of: m } }))], {
		seconds: 4,
		goals: floats.map((m) => ({ kind: (MAT.find((x) => x[0] === m) as [string, number])[1] < 998 ? "floats" : "sinks", item: m }))
	}))
	for (const g of tank.summary.goals) claim(g.label, g.ok)
}

// ---------------------------------------------------------------- sieving
function sieve() {
	console.log("sieve: shaken, the grains smaller than its holes fall through (sand 2 mm through 4 mm; gravel 7 mm stays; nothing through 1.5 mm)")
	const r = run(scene([
		{ id: "s4", type: "sieve", x: 0.6, y: 0, props: { mixture: "sand + gravel", aperture_mm: 4 } },
		{ id: "s15", type: "sieve", x: 1.8, y: 0, props: { mixture: "sand + gravel", aperture_mm: 1.5 } }
	], { seconds: 7 }))
	claim("4 mm mesh: ≥ 95 % of the sand through", (r.end("s4", "a_passed_pct") as number) >= 95, `${r.end("s4", "a_passed_pct")} %`)
	check("4 mm mesh: no gravel through", r.end("s4", "b_passed_pct"), 0, 0, " %")
	// (the sand's grains are 1.73, 2.0 and 2.27 mm: none is smaller than 1.5 mm; the wires are rigid)
	check("1.5 mm mesh: no sand through", r.end("s15", "a_passed_pct"), 0, 0, " %")
	check("  sand through, in grams (of 60 g)", r.end("s4", "a_passed_g"), ((r.end("s4", "a_passed_pct") as number) / 100) * 60, 0.01, " g")
}

// ---------------------------------------------------------------- a magnet's field and what it lifts
function magnet() {
	console.log("magnet wand: its N42 tip magnet's field on its axis against a cylinder's exact field [FURLANI]; swept over sand and iron filings, it lifts the iron and leaves the sand")
	const L = 0.025
	const Rm = 0.00635
	const f = GR.barMagnet(0, L / 2, Math.PI / 2, L, Math.PI * Rm * Rm, 1.3, (Rm * Rm) / 3)
	for (const z of [0.003, 0.005, 0.01, 0.02, 0.04]) {
		const b = f(0, -z)
		const exact = (1.3 / 2) * ((z + L) / Math.sqrt((z + L) ** 2 + Rm * Rm) - z / Math.sqrt(z * z + Rm * Rm))
		check(`|B| ${z * 1000} mm below its face`, Math.hypot(b.bx, b.by), exact, exact * 0.12, " T")
	}
	const r = run(scene([
		{ id: "fe", type: "mixture-dish", x: 0.6, y: 0, props: { mixture: "sand + iron filings" } },
		{ id: "clips", type: "mixture-dish", x: 1.4, y: 0, props: { mixture: "sand + paper clips" } },
		{ id: "high", type: "mixture-dish", x: 2.2, y: 0, props: { mixture: "sand + iron filings", wand_height: 0.06 } }
	], { seconds: 4 }))
	claim("iron filings: ≥ 90 % lifted out", (r.end("fe", "b_left_pct") as number) <= 10, `${100 - (r.end("fe", "b_left_pct") as number)} %`)
	// (a sand grain caught among the filings on the tip can come out with them, as with a real magnet: a few per cent at most)
	claim("  sand lifted out: at most 2 %", 100 - (r.end("fe", "a_left_pct") as number) <= 2, `${100 - (r.end("fe", "a_left_pct") as number)} %`)
	claim("paper clips: ≥ 90 % lifted out", (r.end("clips", "b_left_pct") as number) <= 10, `${100 - (r.end("clips", "b_left_pct") as number)} %`)
	claim("the wand 6 cm up (4.5 cm over the heap): too far, lifts less than half", (r.end("high", "b_left_pct") as number) > 50, `${100 - (r.end("high", "b_left_pct") as number)} % lifted`)
}

// ---------------------------------------------------------------- the lesson demos and determinism
async function demos() {
	console.log("the lesson demos (tools/parity/fixtures/matter-demos.json, X1-X14): every goal met on the engine from its sources; a run twice is bit-identical")
	const { readFileSync } = await import("node:fs")
	const D = JSON.parse(readFileSync(`${PG}/tools/parity/fixtures/matter-demos.json`, "utf8")) as { id: string; goals: object[] }[]
	for (const d of D) {
		const r = run(d, 120)
		claim(`${d.id}: ${r.summary.goals.map((g) => `${g.ok ? "✓" : "✗"} ${g.label}`).join("; ")}`, r.summary.goals.length === d.goals.length && r.summary.goals.every((g) => g.ok))
	}
	for (const id of ["x9-diffusion", "x5b-stirred-still", "x10b-magnet"]) {
		const d = D.find((x) => x.id === id) as object
		const a = JSON.stringify(run(d, 120).track)
		const b = JSON.stringify(run(d, 120).track)
		claim(`${id}: two runs bit-identical`, a === b, `${(a.length / 1e6).toFixed(2)} MB of track`)
	}
}

// ---------------------------------------------------------------- filtering
function filter() {
	console.log("filter-funnel: Darcy flow through Whatman Grade 1 in a 60° funnel; the paper keeps the sand and lets the salt water through; chalk's tight cake; warm water faster [WHATMAN][CARMAN][CRC][LAB]")
	const MU = (t: number) => (t === 20 ? 1.002e-3 : 0.547e-3) // [CRC] water's viscosity at 20 and 50 °C
	const RHO = (t: number) => (t === 20 ? 998.21 : 988.04) // [CRC] its density
	const R1 = (998.21 * 9.81 * 0.1 * 10e-4) / (1.002e-3 * (100e-6 / 150)) // [WHATMAN]
	const tauOf = (t: number) => (0.5 * MU(t) * R1) / ((2 / 3) * RHO(t) * 9.81)
	// one batch of plain water (less than the funnel holds), poured at once: its decay's time constant from two moments
	const lapse = 60
	for (const T of [20, 50]) {
		const r = run(scene([{ id: "f", type: "filter-funnel", x: 1.2, y: 0, props: { solid: "none", dissolved: "none", water_ml: 30, water_temp_c: T, rinse_ml: 0, pour_at_s: 0.5, pour_s: 0.2 } }], { seconds: 6, settings: { time_lapse: lapse } }), 120)
		const a = r.mean("f", "in_funnel_ml", 1.5, 1.52) as number
		const b = r.mean("f", "in_funnel_ml", 3.5, 3.52) as number
		const tau = ((3.5 - 1.5) * lapse) / Math.log(a / b)
		check(`water at ${T} °C drains with τ = sin30°·μR/(share·ρ·g)`, tau, tauOf(T), tauOf(T) * 0.01, " s")
		const poured = r.end("f", "poured_ml") as number
		check(`  every drop accounted for at ${T} °C: through + held + in the funnel = poured`, (r.end("f", "filtrate_ml") as number) + (r.end("f", "held_ml") as number) + (r.end("f", "in_funnel_ml") as number), poured, 0.002, " mL")
	}
	// X10: sand + salt water through filter paper, a 10 mL rinse
	const x = run(scene([{ id: "f", type: "filter-funnel", x: 1.2, y: 0, props: { solid: "sand", solid_g: 10, dissolved: "salt", dissolved_g: 5, water_ml: 100, rinse_ml: 10 } }], { seconds: 14, settings: { time_lapse: 150 } }))
	check("the sand stays on the paper (all of it)", x.end("f", "kept_g"), 10, 0.0005, " g")
	check("  none of it comes through (the filtrate is clear)", x.end("f", "through_g"), 0, 1e-6, " g")
	check("the salt comes through with the water and the rinse (recovered within 2 %)", x.end("f", "salt_through_pct"), 100, 2, " %")
	const done = x.first("f", "filtrate_pct", (v) => v >= 90)
	claim("110 mL through filter paper in a 75 mm funnel takes 10-30 lesson minutes [LAB]", done !== null && ((done - 0.5) * 150) / 60 > 10 && ((done - 0.5) * 150) / 60 < 30, `${done === null ? "never" : (((done - 0.5) * 150) / 60).toFixed(1)} min to 90 %`)
	// chalk: kept by filter paper (slowly: its cake), let through by a coffee filter
	const c = run(scene([
		{ id: "paper", type: "filter-funnel", x: 0.8, y: 0, props: { solid: "chalk", solid_g: 5, dissolved: "none", water_ml: 30, rinse_ml: 0, pour_s: 0.2 } },
		{ id: "sand", type: "filter-funnel", x: 1.6, y: 0, props: { solid: "sand", solid_g: 5, dissolved: "none", water_ml: 30, rinse_ml: 0, pour_s: 0.2 } },
		{ id: "coffee", type: "filter-funnel", x: 2.4, y: 0, props: { solid: "chalk", solid_g: 5, dissolved: "none", water_ml: 30, rinse_ml: 0, pour_s: 0.2, paper: "coffee filter" } }
	], { seconds: 8, settings: { time_lapse: 600 } }))
	check("filter paper keeps chalk's flocs (over its 11 µm)", c.end("paper", "kept_pct"), 100, 0.01, " %")
	check("a coffee filter (20 µm) keeps none of them", c.end("coffee", "kept_pct"), 0, 0.01, " %")
	// (what the wet paper's water holds keeps its share of the cloud: about 3 mL of the 30)
	claim("  and its filtrate is cloudy: most of the chalk comes through", (c.end("coffee", "through_g") as number) > 4.4 && c.end("coffee", "clear") === 0, `${c.end("coffee", "through_g")} g through`)
	const tChalk = c.first("paper", "filtrate_pct", (v) => v >= 50)
	const tSand = c.first("sand", "filtrate_pct", (v) => v >= 50)
	claim("chalk's tight cake (Kozeny-Carman) filters several times slower than sand's [CARMAN]", tSand !== null && (tChalk === null || tChalk - 0.5 > 3 * (tSand - 0.5)), `half through: sand ${tSand === null ? "never" : (((tSand - 0.5) * 600) / 60).toFixed(1)} min, chalk ${tChalk === null ? "not in the run" : (((tChalk - 0.5) * 600) / 60).toFixed(1)} min`)
}

// ---------------------------------------------------------------- evaporating
function evaporate() {
	console.log("evaporating-dish: boiling raised by the salt, crystals at saturation, all the salt left; the hot plate's energy; slow evaporation in a room; the water's mass on a scale [CRC][R&S][ASHRAE][LAB]")
	const lapse = 150
	const r = run(scene([{ id: "d", type: "evaporating-dish", x: 1.2, y: 0, props: { solute: "salt", solute_g: 5, water_ml: 50, heater_w: 300 } }], { seconds: 12, settings: { time_lapse: lapse } }), 120)
	const tBoil = r.first("d", "boiling", (v) => v >= 0.5) as number
	const i = r.times.findIndex((t) => t >= tBoil)
	const water0 = (r.st("d", "water_g")[i] as number) / 1000
	const salt0 = (r.st("d", "dissolved_g")[i] as number) / 1000
	check("it boils at 100 °C + K_b·i·b (0.512 K·kg/mol, i = 2 for NaCl) [CRC]", r.st("d", "temp_c")[i] as number, 100 + (0.512 * 2 * (salt0 / 0.05844)) / water0, 0.05, " °C")
	const tSat = r.first("d", "crystals_g", (v) => v > 0.001) as number
	const j = r.times.findIndex((t) => t >= tSat)
	const T = r.st("d", "temp_c")[j] as number
	// [CRC] NaCl's solubility at that temperature (g per 100 g of water: 37.93 at 80 °C, 38.47 at 90, 39.07 at 100; held at 100 above it)
	const S = T >= 100 ? 39.07 : 38.47 + ((39.07 - 38.47) * (T - 90)) / 10
	check("crystals appear when the brine is saturated: strength S/(100 + S) [CRC]", r.st("d", "strength_pct")[j] as number, (100 * S) / (100 + S), 0.3, " %")
	check("when dry all the salt is left as crystals (within 2 %)", r.end("d", "crystals_g"), 5, 0.1, " g")
	check("  and every gram of the water is gone", r.end("d", "evaporated_g"), 50 * 0.99821, 0.01, " g")
	const tDry = r.first("d", "dry", (v) => v >= 0.5) as number
	const lesson = (tDry - 1) * lapse
	const ideal = (0.0499 * 4184 * 82 + 0.0499 * 2257e3 + 0.11 * 830 * 87) / (0.5 * 300)
	claim("dry after the heat it needs (warm, boil 2257 kJ/kg) over half the hot plate's 300 W, plus the room's losses [CRC]", lesson > ideal && lesson < 1.3 * ideal, `${(lesson / 60).toFixed(1)} min vs ideal ${(ideal / 60).toFixed(1)} min`)
	claim("50 mL boils dry on a hot plate in 10-25 minutes [LAB]", lesson / 60 > 10 && lesson / 60 < 25, `${(lesson / 60).toFixed(1)} min`)
	// in a room: slow, cooled toward the wet bulb; on a kitchen scale the reading falls by the water only
	const room = run(scene([{ id: "s", type: "kitchen-scale", x: 1.2, y: 0 }, { id: "d", type: "evaporating-dish", x: 1.2, y: SCALE_TOP, props: { solute: "salt", solute_g: 5, water_ml: 50, heat: "room" } }], { seconds: 14, settings: { time_lapse: 100000, room_temp: 20 } }), 60)
	const k = room.times.findIndex((t) => t >= 1 + 86400 / 100000)
	const lost = 49.91 - (room.st("d", "water_g")[k] as number)
	const mm = lost / 998 / (Math.PI * 0.0385 * 0.0385)
	claim("still indoor air takes about 0.5-3 mm a day off the dish [LAB]", mm > 0.5 && mm < 3, `${mm.toFixed(2)} mm in its first day (${lost.toFixed(1)} g)`)
	const Tw = room.st("d", "temp_c")[k] as number
	claim("evaporating, the water cools below the room but not below its wet bulb (13.7 °C at 20 °C, 50 %) [ASHRAE]", Tw < 20 && Tw > 13.7, `${Tw.toFixed(2)} °C`)
	const start = room.mean("s", "grams", 0.8, 0.9) as number
	const end = room.mean("s", "grams", 13.7, 14) as number
	claim("  dry within 14 days", (room.end("d", "dry") as number) === 1, `${room.end("d", "water_g")} g left`)
	check("on a kitchen scale the reading falls by the water's mass only (the salt stays)", end - start, -49.91, 0.05, " g")
}

// ---------------------------------------------------------------- chemical changes: packs, a hand warmer, rusting, red cabbage, a precipitate
// [CRC-H] ΔsolH NH4NO3 +25.69, CaCl2 −81.3 kJ/mol; ΔfH Fe2O3 −824.2 kJ/mol (412.1 kJ per mol of iron); Ka acetic 1.75e-5, carbonic
// 4.45e-7 / 4.69e-11; Kw 1e-14 [CRC]: weak acid pH = −log10((−Ka + √(Ka² + 4KaC))/2); a bicarbonate solution pH ≈ (pKa1 + pKa2)/2 = 8.34; a
// carbonate's pH = 14 + log10(√(Kw/K2 · C)); CaCl2 + 2NaHCO3 → CaCO3 (100.087 g/mol) + CO2 (44.01) [IUPAC13]; 4Fe + 3O2: 0.4298 g O2 per g Fe
async function chem() {
	console.log("chemistry: cold and hot packs, a hand warmer, rusting steel wool, red cabbage's pH, a precipitate [CRC-H][CRC][IUPAC13]")
	const r = run(scene([
		{ id: "cold", type: "cold-pack", x: 0.3, y: 0, props: { dissolve_s: 5 } },
		{ id: "hot", type: "cold-pack", x: 0.8, y: 0, props: { chemical: "calcium chloride", dissolve_s: 5 } },
		{ id: "hw", type: "hand-warmer", x: 1.3, y: 0 },
		{ id: "vin", type: "indicator-cup", x: 1.8, y: 0, props: { add: "vinegar", amount: 10 } },
		{ id: "soda", type: "indicator-cup", x: 2.1, y: 0, props: { add: "baking soda", amount: 2 } },
		{ id: "wash", type: "indicator-cup", x: 2.4, y: 0, props: { add: "washing soda", amount: 2 } },
		{ id: "pc", type: "reaction-cup", x: 2.9, y: 0 }
	], { seconds: 8, settings: { time_lapse: 30 } }))
	// packs: the heat booked is exactly the moles dissolved × ΔsolH; the coldest / hottest is near the no-heat-in change (C = water + salt + film)
	const nCold = 30 / 80.043
	const Ccold = 0.09982 * 4184 + 0.03 * 1740 + (2 * 0.15 * 0.12 * 0.09 + 0.001) * 2300
	check("cold pack: heat taken in = n × ΔsolH (all 30 g dissolved)", r.end("cold", "heat_kj"), -nCold * 25.69, 0.05, " kJ")
	const lo = Math.min(...r.st("cold", "temp_c"))
	check("cold pack: its coldest, near the no-heat-in change (20 °C − n·ΔH/C; a little heat leaks in)", lo, 20 - (nCold * 25690) / Ccold, 3, " °C")
	const nHot = 30 / 110.984
	const Chot = 0.09982 * 4184 + 0.03 * 657 + (2 * 0.15 * 0.12 * 0.09 + 0.001) * 2300
	const hi = Math.max(...r.st("hot", "temp_c"))
	check("hot pack (calcium chloride): its hottest, near 20 °C + n·81.3 kJ/C (some heat leaks out)", hi, 20 + (nHot * 81300) / Chot, 5, " °C")
	// hand warmer: its heat is its iron rusted × 412.1 kJ/mol, its power that over its lifetime
	const used = (100 - (r.end("hw", "iron_left_pct") as number)) / 100
	check("hand warmer: heat given out = iron rusted × 412.1 kJ/mol", r.end("hw", "heat_kj"), (used * 20) / 55.845 * 412.1, 0.01, " kJ")
	check("hand warmer: its power (20 g over 5 h)", r.end("hw", "power_w"), ((20 / 55.845) * 412100) / 18000, 0.01, " W")
	check("hand warmer: oxygen taken in = 0.75 × 32.0 g per mol of iron rusted", r.end("hw", "oxygen_g"), (used * 20) / 55.845 * 0.75 * 31.998, 1e-4, " g")
	claim("hand warmer: warms by more than 10 °C in 6.8 × 30 s = 3.4 minutes", Math.max(...r.st("hw", "temp_c")) - 20 > 10, `${(Math.max(...r.st("hw", "temp_c")) - 20).toFixed(1)} °C`)
	// red cabbage: pH against the analytical weak acid / amphiprotic / weak base values
	const Ka = 1.75e-5
	const C = (10 * 1.005 * 0.05) / 60.052 / (0.1 + 0.01)
	check("vinegar 10 mL in 100 mL: pH of a weak acid", r.end("vin", "ph"), -Math.log10((-Ka + Math.sqrt(Ka * Ka + 4 * Ka * C)) / 2), 0.03)
	check("baking soda 2 g: about (pKa1 + pKa2)/2", r.end("soda", "ph"), (6.352 + 10.329) / 2, 0.15)
	const Cc = 2 / 105.988 / 0.0998
	check("washing soda 2 g: pH of a carbonate (Kb = Kw/K2)", r.end("wash", "ph"), 14 + Math.log10(Math.sqrt((1e-14 / 4.69e-11) * Cc)), 0.05)
	claim("vinegar: red; baking soda: blue; washing soda: green", r.end("vin", "color_band") === 0 && r.end("soda", "color_band") === 3 && r.end("wash", "color_band") === 5,
		`${r.end("vin", "color_band")}, ${r.end("soda", "color_band")}, ${r.end("wash", "color_band")}`)
	// the precipitate: all the white solid the scarcer reagent allows; its CO2 made, dissolved to 1.69 g/L or bubbled out
	const p = Math.min(5 / 110.984, 5 / 84.007 / 2)
	check("precipitate: calcium carbonate made (the bicarbonate runs out first)", r.end("pc", "solid_g"), p * 100.087, 0.01, " g")
	check("precipitate: CO2 bubbled out = made − what 100 mL holds (1.69 g/L)", r.end("pc", "escaped_g"), p * 44.01 - 1.69 * 0.1, 0.03, " g")
	claim("precipitate: it turned cloudy and warmed", Math.max(...r.st("pc", "cloudy")) > 0.9 && Math.max(...r.st("pc", "temp_c")) > 23, `cloudy ${Math.max(...r.st("pc", "cloudy")).toFixed(2)}, ${Math.max(...r.st("pc", "temp_c")).toFixed(1)} °C`)
	const goals = run(scene([{ id: "cold", type: "cold-pack", x: 0.5, y: 0 }, { id: "ind", type: "indicator-cup", x: 1.2, y: 0, props: { add: "vinegar", amount: 10, then_add: "baking soda", then_amount: 3, then_at_s: 3 } }],
		{ seconds: 6, settings: { time_lapse: 30 }, goals: [{ kind: "cools_by", item: "cold", at_least_c: 15 }, { kind: "warms_by", item: "cold", at_least_c: 1 }, { kind: "color_changes", item: "ind" }, { kind: "color_changes", item: "ind", to: "purple" }, { kind: "color_changes", item: "ind", to: "green" }] })).summary.goals
	claim("goals: cools_by met, warms_by not, color_changes (red, then purple again) met, to purple met, to green not",
		goals.map((g) => g.ok).join() === "true,false,true,true,false", goals.map((g) => `${g.label}: ${g.ok}`).join("; "))
	// steel wool rusting on a scale over days: the scale gains its rust's oxygen
	const w = run(scene([{ id: "s", type: "kitchen-scale", x: 1.2, y: 0 }, { id: "wool", type: "steel-wool", x: 1.2, y: SCALE_TOP }], { seconds: 6, settings: { time_lapse: 86400 } }))
	const gained = (w.mean("s", "grams", 5.7, 6) as number) - (w.mean("s", "grams", 0.8, 0.9) as number)
	check("steel wool: the scale gains its rust's oxygen (rust_pct × 5 g × 0.4298)", gained, ((w.end("wool", "rust_pct") as number) / 100) * 5 * 0.4298, 0.03, " g")
	check("steel wool: half of it rusted in 4.8 days soaked in vinegar (63 % in half a day)", w.end("wool", "rust_pct"), 50 * (1 - Math.exp(-((6 - 1.2) * 86400) / 43200)), 0.05, " %")
}

// ---------------------------------------------------------------- models of molecules and crystals: their atoms, bonds and shapes
function models() {
	console.log("molecule and crystal models: atom counts, molecular masses, the bond angles the balls are placed at [CCCBDB][IUPAC13][CRC]")
	const r = run(scene([
		{ id: "w", type: "molecule", x: 0.3, y: 0 },
		{ id: "c", type: "molecule", x: 0.6, y: 0, props: { molecule: "carbon dioxide" } },
		{ id: "m", type: "molecule", x: 0.9, y: 0, props: { molecule: "methane" } },
		{ id: "salt", type: "crystal", x: 1.4, y: 0 },
		{ id: "dia", type: "crystal", x: 1.9, y: 0, props: { lattice: "diamond" } },
		{ id: "ice", type: "crystal", x: 2.4, y: 0, props: { lattice: "ice" } }
	], { seconds: 1 }))
	check("water: 18.015 u", r.end("w", "mass_u"), 2 * 1.008 + 15.999, 1e-9, " u")
	check("carbon dioxide: 44.009 u", r.end("c", "mass_u"), 12.011 + 2 * 15.999, 1e-9, " u")
	const doc = sim.prepare(scene([{ id: "w", type: "molecule", x: 1, y: 0, props: { scale_cm: 5 } }])).doc as { solids: { id: string; at: { x: number; y: number }; parent?: string }[] }
	const at = (id: string) => doc.solids.find((x) => x.id === id)!.at
	const h1 = at("w/a2")
	const h2 = at("w/a3")
	const ang = (Math.acos((h1.x * h2.x + h1.y * h2.y) / (Math.hypot(h1.x, h1.y) * Math.hypot(h2.x, h2.y))) * 180) / Math.PI
	check("water's balls: H–O–H at 104.52°", ang, 104.52, 0.02, "°")
	check("water's balls: O–H 0.9572 Å × 5 cm/Å", Math.hypot(h1.x, h1.y), 0.9572 * 0.05, 2e-5, " m")
	check("salt, 2 repeats a side: 5³ = 125 ions", r.end("salt", "atoms"), 125, 0)
	claim("salt: 63 sodium and 62 chloride ions (alternating)", r.end("salt", "sodium") === 63 && r.end("salt", "chloride") === 62)
	check("diamond, 2³ cubic cells: 8 atoms each", r.end("dia", "atoms"), 64, 0)
	claim("ice: 16 oxygens, 32 hydrogens (H2O)", r.end("ice", "oxygen") === 16 && r.end("ice", "hydrogen") === 32, `${r.end("ice", "oxygen")} O, ${r.end("ice", "hydrogen")} H`)
	const rest = (id: string) => {
		const s = r.st(id, "atoms")
		return s.length > 0
	}
	claim("every model reads its atoms", ["w", "c", "m", "salt", "dia", "ice"].every(rest))
}

// ---------------------------------------------------------------- crash fuzz
function fuzz() {
	const N = 24
	console.log(`fuzz: ${N} random scenes of matter types (props anywhere in their ranges), every reading finite`)
	let seed = 20261019
	const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
	const types = sim.catalog().types.filter((t) => t.module === "matter")
	let bad = 0
	let readings = 0
	for (let n = 0; n < N; n++) {
		const items: object[] = []
		for (let k = 0; k < 3; k++) {
			const t = types[Math.floor(rnd() * types.length)]!
			const props: Record<string, unknown> = {}
			for (const p of t.props) {
				if (rnd() < 0.5 || p.key === "particles" || p.key === "grains") continue
				if (p.kind === "bool") props[p.key] = rnd() < 0.5
				else if (p.kind === "choice") props[p.key] = p.choices![Math.floor(rnd() * p.choices!.length)]
				else if (p.kind === "number" || p.kind === "int") props[p.key] = (p.min ?? 0) + rnd() * ((p.max ?? 1) - (p.min ?? 0))
			}
			items.push({ id: `m${k}`, type: t.key, x: 0.2 + k * 1.3, y: 0, props })
		}
		try {
			const r = run(scene(items, { seconds: 1 + rnd() * 2, settings: { time_lapse: 1 + Math.floor(rnd() * 100) } }), 30)
			for (const [, keys] of Object.entries(r.track.state ?? {}))
				for (const [, v] of Object.entries(keys)) {
					readings++
					if (!v.every((x) => Number.isFinite(x))) bad++
				}
		} catch (e) {
			bad++
			console.log(`  scene ${n}: ${(e as Error).message.split("\n")[0]}`)
		}
	}
	claim(`${N} scenes: no exception, ${readings} readings all finite`, bad === 0, `${bad} bad`)
}

const which = process.argv[2] ?? "all"
const all: Record<string, () => void | Promise<void>> = { gas, heating, boyle, charles, piston, graham, mixing, dissolve, saturate, settle, mass, density, sieve, magnet, filter, evaporate, demos, chem, models, closed, fuzz }
for (const [k, f] of Object.entries(all)) if (which === "all" || which === k) await f()
console.log(`\n${checks - failures} of ${checks} checks pass${failures ? `; ${failures} FAIL` : ": ALL PASS"}`)
process.exit(failures ? 1 : 0)
