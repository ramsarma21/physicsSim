// The heat module (tooling/src/sim/heat.ts, modules/heat.ts) against real reference values, analytic solutions and its own bookkeeping.
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-thermal.ts [data|melt|salt|lamp|plates|water|cups|conduction|sensor|energy|work|candle|light|liquids|expansion|fuzz|all]
// Scenes are built by web/sim (the browser's builder, number for number the server's machines/*.py) and run by the engine in node, as the server runs them.
// Reference sources (the comments at each check say which):
//   [NIST-CANDLE] Hamins, Bundy & Dillon, J. Fire Prot. Eng. 15 (2005) 265: a candle about 80 W, 0.1 g of wax a minute
//   [SFPE]  Heskestad, "Fire plumes", SFPE Handbook of Fire Protection Engineering, 5th ed.: a plume's axis temperature and speed
//   [TIMOSHENKO] Timoshenko, "Analysis of bi-metal thermostats", J. Opt. Soc. Am. 11 (1925) 233
//   [ETB]   Engineering ToolBox, "Specific Heat of Liquids": olive (vegetable) oil 1.97 kJ/(kg·K)
//   [CRC]   CRC Handbook of Chemistry and Physics, 97th ed. (latent heats, salt water's freezing points, steam tables' vapour pressure)
//   [INC]   Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, 6th ed. (conductivities, emissivities, the fin equation)
//   [ASHRAE] ASHRAE Handbook — HVAC Applications ch. 6, Carrier's evaporation equation
//   [SPEC]  the thermal module's research spec (engine4/spec/modules/thermal.md §5): its reference model's melt times and ranges (T1-T16),
//           a lumped ice cube on a ceramic plate in still air at 22 °C; the ranges include that model's own uncertainty
//   [EI]    Educational Innovations "Ice Melting Blocks": a cube on aluminium melts in minutes, on plastic it hardly changes
// ENGINE_DIR=<folder with physics.ts, document.ts, heat.ts, modules/> runs another copy of the engine (it must register its modules itself).
import path from "node:path"
import { pathToFileURL } from "node:url"

const PG = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const DIR = process.env.ENGINE_DIR ?? `${PG}/tooling/src/sim`
const { admitDocument } = (await import(`${DIR}/document.ts`)) as { admitDocument: (d: unknown) => { scene: object } }
const { simulate } = (await import(`${DIR}/physics.ts`)) as { simulate: (s: object, fps: number) => Track }
await import(`${DIR}/modules/index.ts`)
const H = (await import(`${DIR}/heat.ts`)) as { heatWorldOf: (s: object) => World | undefined }
const D = (await import(`${DIR}/heat-data.ts`)) as Record<string, (...a: number[]) => number> & Record<string, unknown>
const sim = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as { prepare: (s: object) => { scene: object; doc: Doc; resolved: object } }

interface Track {
	frames: { t: number; placements: Record<string, { x: number; y: number; scale?: number }> }[]
	state?: Record<string, Record<string, number[]>>
	events?: { t: number; text: string }[]
}
interface Doc {
	settings?: { timeLapse?: number }
	processes?: Record<string, unknown>[]
}
interface World {
	imbalance(): number
	ledger: Record<string, number>
	energy(): number
	start0: number
}

const want = process.argv[2] ?? "all"
let failed = 0
let passed = 0
const check = (ok: boolean, what: string, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
	if (ok) passed++
	else failed++
}
const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi
const f1 = (v: number | null) => (v === null ? "never" : v.toFixed(1))

const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const TABLE = { id: "table", type: "table", x: 1.3, y: 0, props: {} }
type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; fixed?: boolean }
interface Run {
	track: Track
	doc: Doc
	lapse: number
	world: World | undefined
	ms: number
}
/** Builds a scene with web/sim and runs it in the engine (24 frames a second: the readings are per frame). */
function run(items: Item[], { lapse = 900, seconds = 15, room = 22 }: { lapse?: number; seconds?: number; room?: number } = {}): Run {
	const scene = { version: 2, id: "v", name: "v", seconds, release: 0.2, stage: STAGE, settings: { room_temp: room, time_lapse: lapse }, items: [TABLE, ...items], goals: [] }
	const { doc } = sim.prepare(scene)
	const { scene: s } = admitDocument(doc)
	const t0 = performance.now()
	const track = simulate(s, 24)
	return { track, doc, lapse, world: H.heatWorldOf(s), ms: performance.now() - t0 }
}
const series = (r: Run, id: string, key: string) => r.track.state?.[id]?.[key] ?? []
/** The lesson time (s) a reading first passes a test, or null. */
function when(r: Run, id: string, key: string, test: (v: number) => boolean): number | null {
	const v = series(r, id, key)
	for (let k = 0; k < v.length; k++) if (test(v[k] as number)) return (r.track.frames[k]?.t ?? 0) * r.lapse
	return null
}
/** A reading at a lesson time (s). */
function at(r: Run, id: string, key: string, s: number): number {
	const v = series(r, id, key)
	const k = r.track.frames.findIndex((f) => f.t * r.lapse >= s)
	return (k < 0 ? v[v.length - 1] : v[k]) as number
}
const meltMin = (r: Run, id: string) => {
	const t = when(r, id, "melted", (v) => v >= 0.995)
	return t === null ? null : t / 60
}
const energyOk = (r: Run) => {
	const w = r.world
	if (!w) return 1
	const scale = Math.max(1, Math.abs(w.ledger.room ?? 0) + Math.abs(w.ledger.sources ?? 0) + Math.abs(w.ledger.vapor ?? 0))
	return Math.abs(w.imbalance()) / scale
}

// ---- items, placed by hand (anchors: a plate's or bowl's foot, a cube's middle, a salt pile's foot)
const plate = (id: string, x: number, props: Record<string, unknown> = {}): Item => ({ id, type: "plate", x, y: 0, props })
const bowl = (id: string, x: number, props: Record<string, unknown> = {}): Item => ({ id, type: "bowl", x, y: 0, props })
const THICK: Record<string, number> = { ceramic: 0.005, glass: 0.005, melamine: 0.003, aluminium: 0.001, foam: 0.002, paperboard: 0.0012 }
const cube = (id: string, x: number, s: number, on: number, start = 0): Item => ({ id, type: "ice-cube", x, y: on + s / 2 + 0.0005, props: { width: s, height: s, depth: s, start_temp_c: start } })
const salt = (id: string, x: number, y: number, g: number): Item => ({ id, type: "salt-pile", x, y: y + 0.0003, props: { mass_g: g } })

const groups: Record<string, () => void> = {}

// ---------------------------------------------------------------- the numbers themselves
groups.data = () => {
	// saturation vapour pressure vs the steam tables [CRC 6-10]: 611.2 Pa at 0 °C (over water 611.3), 2339 at 20, 7384 at 40, 12352 at 50, 101325 at 100
	const vp = D.vaporPressure as (t: number) => number
	for (const [t, ref, tol] of [[0, 611.3, 0.005], [20, 2339, 0.005], [40, 7384, 0.005], [50, 12352, 0.006], [100, 101325, 0.03]] as const)
		check(Math.abs(vp(t) / ref - 1) < tol, `saturation vapour pressure at ${t} °C [CRC steam tables]`, `${vp(t).toFixed(0)} Pa vs ${ref}`)
	// over ice at −20 °C: 103.3 Pa [CRC]
	check(Math.abs(vp(-20) / 103.3 - 1) < 0.01, "saturation vapour pressure over ice at −20 °C [CRC]", `${vp(-20).toFixed(1)} Pa vs 103.3`)
	// the dew point of 22 °C, 50 % air: 11.1 °C (psychrometric chart)
	const dp = (D.dewPoint as (t: number, rh: number) => number)(22, 0.5)
	check(Math.abs(dp - 11.1) < 0.2, "dew point of 22 °C air at 50 % humidity (psychrometric chart: 11.1 °C)", `${dp.toFixed(2)} °C`)
	// salt water's freezing points [CRC 8-80]; and the van 't Hoff check from the spec: 5 % → b 0.90 mol/kg, ΔT = i·K_f·b ≈ 3.1 K (i 1.85)
	const bf = D.brineFreezing as (w: number) => number
	for (const [w, ref] of [[0.05, -3.05], [0.1, -6.56], [0.15, -10.89], [0.2, -16.46], [0.25, -21.1]] as const)
		check(Math.abs(bf(w) - ref) < 0.1, `salt water at ${w * 100} % freezes at ${ref} °C [CRC]`, `${bf(w).toFixed(2)} °C`)
	check(Math.abs(-bf(0.05) - 1.85 * 1.86 * (0.05 / 0.05844 / 0.95)) < 0.25, "5 % salt water vs van 't Hoff (i 1.85, K_f 1.86 K·kg/mol)", `${(-bf(0.05)).toFixed(2)} K`)
	// latent heats [CRC]: fusion 333.55 kJ/kg; vaporization 2257 kJ/kg at 100 °C, 2501 at 0
	const lv = D.vaporization as (t: number) => number
	check(Math.abs(lv(100) - 2.257e6) < 2e3 && Math.abs(lv(0) - 2.501e6) < 2e3, "latent heat of vaporization at 0 and 100 °C [CRC]", `${lv(0)} / ${lv(100)} J/kg`)
	check((D.ICE as { fusion: number }).fusion === 333550, "latent heat of fusion 333.55 kJ/kg [CRC]")
	// Carrier's evaporation in still air (0.089·Δp/Y) and the engine's analogy (h_m = h/(ρ·c_p·Le^⅔)) at 80 °C water, 22 °C, 50 %: the same within 15 %
	const h = (D.naturalAir as (dt: number, l: number, f: string) => number)(58, 0.08, "rising")
	const hm = Math.max(h, D.STILL_AIR_MASS as unknown as number) / ((D.AIR_RHO_CP as unknown as number) * (D.LEWIS_23 as unknown as number))
	const vd = D.vaporDensity as (t: number) => number
	const ours = hm * (vd(80) - 0.5 * vd(22))
	const carrier = (0.089 * (vp(80) / 1000 - (0.5 * vp(22)) / 1000)) / (lv(80) / 1000)
	check(Math.abs(ours / carrier - 1) < 0.15, "evaporation from 80 °C water in still air vs Carrier's equation [ASHRAE]", `${(ours * 1000).toFixed(3)} vs ${(carrier * 1000).toFixed(3)} g/(m²·s)`)
	// colour absorptivity: white paint 0.2, black 0.97 [INC Table A.12]
	const ca = D.colourAbsorptivity as unknown as (hex: string) => number
	check(Math.abs(ca("#ffffff") - 0.2) < 0.01 && Math.abs(ca("#000000") - 0.97) < 0.01, "colour absorptivity: white 0.2, black 0.97 [INC Table A.12]", `${ca("#ffffff")} / ${ca("#000000")}`)
}

// ---------------------------------------------------------------- melting (spec T1, T7 and size)
groups.melt = () => {
	const cer = THICK.ceramic as number
	// T1: a 4 cm cube from 0 °C on a ceramic plate at 22 °C: melted in 80-150 min (reference 110), 0.45 ± 0.12 at 30 min, 0.76 ± 0.12 at 60 min [SPEC]
	const r = run([plate("p", 1.0), cube("c", 1.0, 0.04, cer, 0)])
	const m = meltMin(r, "c")
	check(m !== null && within(m, 80, 150), "T1: 4 cm cube on a ceramic plate, 22 °C, melts in 80-150 min [SPEC: 110]", `${f1(m)} min`)
	const a30 = at(r, "c", "melted", 1800)
	const a60 = at(r, "c", "melted", 3600)
	check(within(a30, 0.33, 0.57), "T1: melted share at 30 min 0.45 ± 0.12 [SPEC]", a30.toFixed(3))
	check(within(a60, 0.64, 0.88), "T1: melted share at 60 min 0.76 ± 0.12 [SPEC]", a60.toFixed(3))
	// from −18 °C it takes longer: the sensible heat 2.05 × 18 = 37 kJ/kg on top of 333 kJ/kg: about +11 % [SPEC]; here +3 to +20 %
	const r18 = run([plate("p", 1.0), cube("c", 1.0, 0.04, cer, -18)])
	const m18 = meltMin(r18, "c")
	check(m !== null && m18 !== null && within(m18 / m - 1, 0.03, 0.2), "T1: from −18 °C, 3-20 % longer [SPEC: about 11 %]", `${f1(m18)} min, +${m && m18 ? ((m18 / m - 1) * 100).toFixed(1) : "?"} %`)
	// size: 2.5 cm in 35-75 min [SPEC model 54], 5 cm in 100-200 min [SPEC model 152]; and monotone
	const rs = run([plate("p", 1.0), cube("c", 1.0, 0.025, cer, 0)])
	const rb = run([plate("p", 1.0), cube("c", 1.0, 0.05, cer, 0)], { seconds: 20 })
	const ms = meltMin(rs, "c")
	const mb = meltMin(rb, "c")
	check(ms !== null && within(ms, 35, 75), "a 2.5 cm cube on a ceramic plate melts in 35-75 min [SPEC model: 54]", `${f1(ms)} min`)
	check(mb !== null && within(mb, 95, 200), "a 5 cm cube on a ceramic plate melts in 95-200 min [SPEC model: 152]", `${f1(mb)} min`)
	check(ms !== null && m !== null && mb !== null && ms < m && m < mb, "bigger cubes take longer (2.5 < 4 < 5 cm)")
	// T7: plates: aluminium ≫ ceramic > foam [SPEC; EI]
	const al = run([plate("p", 1.0, { material: "aluminium" }), cube("c", 1.0, 0.04, THICK.aluminium as number, 0)])
	const fo = run([plate("p", 1.0, { material: "foam" }), cube("c", 1.0, 0.04, THICK.foam as number, 0)], { seconds: 20 })
	const mal = meltMin(al, "c")
	const ffo = at(fo, "c", "melted", 3600)
	check(mal !== null && m !== null && mal < 0.6 * m, "T7: on an aluminium plate far sooner than on ceramic [EI]", `${f1(mal)} vs ${f1(m)} min`)
	check(ffo < a60, "T7: on a foam plate slower than on ceramic (melted share at 60 min)", `${ffo.toFixed(2)} vs ${a60.toFixed(2)}`)
	for (const x of [r, r18, rs, rb, al, fo]) check(energyOk(x) < 1e-9, "T16: the bookkeeping closes (energy now − start = what the ledger booked)", energyOk(x).toExponential(2))
	// the cube shrinks with its ice: its placement's scale is the cube root of what is left
	const sc = series(r, "c", "scale")
	const me = series(r, "c", "melted")
	const k = Math.floor(sc.length / 3)
	check(Math.abs((sc[k] as number) - (1 - (me[k] as number)) ** (1 / 3)) < 0.01, "a melting cube's size is the cube root of its ice", `${sc[k]} vs ${((1 - (me[k] as number)) ** (1 / 3)).toFixed(4)}`)
	// mass: what melted is the puddle, the film and the vapour (the ice and its water are conserved but for evaporation, at most a few %)
	const pud = series(r, "c", "puddle_g").at(-1) as number
	// (a 58.7 g puddle spread 1.5 mm deep is 390 cm²: at about 20 °C it evaporates some 4-6 g an hour, so over the 3.75 h run 70-95 % is left)
	check(within(pud / (917 * 0.04 ** 3 * 1000), 0.7, 0.97), "the melted ice ends in its puddle, less what evaporated from it over 3.75 h", `${pud.toFixed(1)} g of ${(917 * 0.04 ** 3 * 1000).toFixed(1)} g`)
}

// ---------------------------------------------------------------- salt (spec T2-T4)
groups.salt = () => {
	const b = THICK.ceramic as number
	const big = (id: string, x: number, g: number | null) => [bowl(`${id}b`, x), cube(id, x, 0.05, b, 0), ...(g === null ? [] : [salt(`${id}s`, x, b + 0.0505, g)])]
	const r = run([...big("plain", 0.4, null), ...big("one", 1.0, 1), ...big("six", 1.6, 6)], { seconds: 20 })
	const mp = meltMin(r, "plain")
	const m1 = meltMin(r, "one")
	const m6 = meltMin(r, "six")
	check(mp !== null && m1 !== null && within(1 - m1 / mp, 0.02, 0.15), "T3: 1 g of salt on a 5 cm cube in a bowl: 2-15 % sooner [SPEC: 3-10 %, model 5 %]", `${f1(m1)} vs ${f1(mp)} min, ${mp && m1 ? ((1 - m1 / mp) * 100).toFixed(1) : "?"} %`)
	check(mp !== null && m6 !== null && within(1 - m6 / mp, 0.1, 0.35), "T3: 6 g of salt: 10-35 % sooner [SPEC: 10-30 %, model 19 %]", `${f1(m6)} min, ${mp && m6 ? ((1 - m6 / mp) * 100).toFixed(1) : "?"} %`)
	check(m1 !== null && m6 !== null && m6 < m1, "T3: more salt, sooner")
	// salt water melts ice below 0 °C: the salted cube's ice is colder than 0 °C while it melts
	const lo = Math.min(...series(r, "six", "temp"))
	check(lo < -3, "salt water melts the ice below 0 °C (the salted cube's lowest temperature)", `${lo.toFixed(1)} °C`)
	// T2: a big salted cube (5 cm, 6 g) against a small plain one (2.5 cm), in bowls: the small one first [SPEC]
	const r2 = run([...big("big", 0.6, 6), bowl("sb", 1.4), cube("small", 1.4, 0.025, b, 0)])
	const t2 = meltMin(r2, "small")
	const t2b = meltMin(r2, "big")
	check(t2 !== null && (t2b === null || t2 < t2b), "T2: size beats salt: a small plain cube melts before a big salted one [SPEC]", `${f1(t2)} vs ${f1(t2b)} min`)
	// T4: the same salt on two identical cubes: the same melt time within 0.1 % [SPEC]
	const r4 = run([...big("a", 0.7, 6), ...big("bb", 1.5, 6)], { seconds: 20 })
	const ta = meltMin(r4, "a")
	const tb = meltMin(r4, "bb")
	check(ta !== null && tb !== null && Math.abs(ta / tb - 1) < 0.001, "T4: equal salt on equal cubes: equal times within 0.1 % [SPEC]", `${f1(ta)} / ${f1(tb)} min`)
	for (const x of [r, r2, r4]) check(energyOk(x) < 1e-9, "T16: the bookkeeping closes (salt's heat of solution and its brine included)", energyOk(x).toExponential(2))
}

// ---------------------------------------------------------------- lamps (spec T5, T6)
groups.lamp = () => {
	const c = THICK.ceramic as number
	const lamp = (id: string, x: number, target: string, props: Record<string, unknown> = {}): Item => ({ id, type: "lamp", x, y: 0, props: { target, head_height: 0.3, ...props } })
	const r = run([plate("p1", 0.8), cube("lit", 0.8, 0.04, c), plate("p2", 1.8), cube("dark", 1.8, 0.04, c), lamp("l", 0.52, "lit")])
	const ml = meltMin(r, "lit")
	const md = meltMin(r, "dark")
	// the 60 W bulb 30 cm up, 13 cm to the side: about 33.6 W into a 100° beam, 15 W/sr, ≈ 140 W/m² on the cube (sunlight 1000): 5-25 % sooner [SPEC T5]
	check(ml !== null && md !== null && within(1 - ml / md, 0.04, 0.3), "T5: a 60 W incandescent desk lamp on one cube: 4-30 % sooner [SPEC: 8-25 %]", `${f1(ml)} vs ${f1(md)} min, ${ml && md ? ((1 - ml / md) * 100).toFixed(1) : "?"} %`)
	const r6 = run([plate("p1", 0.8), cube("led", 0.8, 0.04, c), plate("p2", 1.8), cube("none", 1.8, 0.04, c), lamp("l", 0.52, "led", { bulb: "led", power_w: 9 })])
	const m6 = meltMin(r6, "led")
	const n6 = meltMin(r6, "none")
	check(m6 !== null && n6 !== null && Math.abs(1 - m6 / n6) < 0.03, "T6: a 9 W LED lamp: under 3 % difference [SPEC]", `${f1(m6)} vs ${f1(n6)} min`)
	// irradiance falls as 1/d²: the same lamp twice as far gives a quarter (beam axis, nothing between): measured by a thermometer's lamp-heated rise is
	// indirect, so check the engine's own number through two black plates' first heating (heat in ∝ irradiance while both start at room temperature)
	const plateBlack = (id: string, x: number): Item => ({ id, type: "plate", x, y: 0, props: { color: "black" } })
	const near = run([plateBlack("a", 1.0), { id: "la", type: "lamp", x: 0.8, y: 0, props: { target: "a", head_height: 0.25, aim: -90 } }], { lapse: 20, seconds: 3 })
	const far = run([plateBlack("a", 1.0), { id: "la", type: "lamp", x: 0.8, y: 0, props: { target: "a", head_height: 0.55, aim: -90 } }], { lapse: 20, seconds: 3 })
	const dn = at(near, "a", "temp", 30) - 22
	const df = at(far, "a", "temp", 30) - 22
	check(dn > 2.5 * df, "a lamp nearer heats more: about 1/distance² (head 25 cm vs 55 cm up)", `+${dn.toFixed(2)} vs +${df.toFixed(2)} K in 30 s`)
	// T13: black vs white plates under the same lamp: the black one warms 2.5-5 × faster at first (α 0.97 vs 0.2 [INC Table A.12])
	const white = run([{ id: "a", type: "plate", x: 1.0, y: 0, props: { color: "white" } }, { id: "la", type: "lamp", x: 0.8, y: 0, props: { target: "a", head_height: 0.25 } }], { lapse: 20, seconds: 3 })
	const black = run([plateBlack("a", 1.0), { id: "la", type: "lamp", x: 0.8, y: 0, props: { target: "a", head_height: 0.25 } }], { lapse: 20, seconds: 3 })
	const dw = at(white, "a", "temp", 20) - 22
	const db = at(black, "a", "temp", 20) - 22
	check(within(db / dw, 2.5, 5), "T13: a black plate warms 2.5-5 × faster than a white one under the same lamp [INC A.12: 0.97 vs 0.2]", `${(db / dw).toFixed(2)} ×`)
	for (const x of [r, r6, near, far, white, black]) check(energyOk(x) < 1e-9, "T16: the bookkeeping closes (lamp heat booked as a source)", energyOk(x).toExponential(2))
}

// ---------------------------------------------------------------- water: boiling, heating curves (spec T15)
groups.water = () => {
	const r = run([{ id: "hp", type: "hot-plate", x: 1.2, y: 0, props: { power_w: 600, setpoint_c: 400 } }, { id: "pot", type: "saucepan", x: 1.2, y: 0.0865, props: { water_ml: 1000 } }], { lapse: 300, seconds: 12 })
	const tb = when(r, "pot", "boiling", (v) => v >= 1)
	// 1 L from 20 to 100 °C takes 335 kJ: at 600 W, 9.3 min if all of it reached the water; an electric hot plate passes 50-80 % to a pot (US DOE
	// cooking-product test data: electric coil and solid plates 50-74 %): 11.5-19 min
	check(tb !== null && within(tb / 60, 9.3, 20), "a 600 W hot plate brings 1 L of water to the boil in 9.3-20 min (efficiency 50-100 %)", `${f1(tb === null ? null : tb / 60)} min`)
	// the temperature stops at 100 °C while it boils (a plateau), and water boils away at about P_net/L_v
	const wt = series(r, "pot", "water_temp")
	const k0 = wt.findIndex((v) => v >= 99.5)
	const plateau = wt.slice(k0, k0 + 40)
	check(k0 > 0 && plateau.every((v) => within(v, 99.3, 100.3)), "the water's temperature stays at 100 °C while it boils (a plateau)", `${Math.min(...plateau).toFixed(2)}-${Math.max(...plateau).toFixed(2)} °C`)
	const g0 = series(r, "pot", "water_g")[k0 + 10] as number
	const g1 = series(r, "pot", "water_g")[k0 + 50] as number
	const dt = ((r.track.frames[k0 + 50]?.t ?? 0) - (r.track.frames[k0 + 10]?.t ?? 0)) * r.lapse
	const rate = (g0 - g1) / 1000 / dt
	check(within((rate * 2.257e6) / 600, 0.4, 0.95), "while boiling, water boils away at 40-95 % of the plate's 600 W / 2257 kJ/kg", `${(rate * 3.6e6).toFixed(0)} g/h, ${((rate * 2.257e6) / 600 * 100).toFixed(0)} % of 600 W`)
	// a lid: nothing boils away
	const rl = run([{ id: "hp", type: "hot-plate", x: 1.2, y: 0, props: { power_w: 600, setpoint_c: 400 } }, { id: "pot", type: "saucepan", x: 1.2, y: 0.0865, props: { water_ml: 1000, lid: true } }], { lapse: 300, seconds: 12 })
	const lost = (series(rl, "pot", "water_g")[0] as number) - (series(rl, "pot", "water_g").at(-1) as number)
	check(Math.abs(lost) < 0.5, "with the lid on no water boils away", `${lost.toFixed(2)} g`)
	// salt water boils hotter: 100 g of salt in 1 kg of water (b = 1.711 mol/kg): 100 + 0.512 × 2 × 1.711 = 101.75 °C (ideal: K_b 0.512 K·kg/mol, i 2 [CRC]; a
	// real 9 % brine boils about 101.5 °C)
	const bp = (D.boilingPoint as (s: number, w: number) => number)(0.1, 1)
	check(Math.abs(bp - 101.752) < 0.01, "salt water boils at 100 + K_b·i·b (100 g in 1 kg of water: 101.75 °C) [CRC]", `${bp.toFixed(3)} °C`)
	// freezing: a cup of water in a room at −18 °C (a freezer) freezes; its temperature holds at 0 °C while it does
	const rf = run([{ id: "cup", type: "drink-cup", x: 1.2, y: 0, props: { style: "plastic", water_ml: 100, water_temp_c: 10 } }], { lapse: 1800, seconds: 12, room: -18 })
	const tf = when(rf, "cup", "ice_g", (v) => v > 0)
	const tall = when(rf, "cup", "water_g", (v) => v <= 0)
	check(tf !== null && tall !== null, "a cup of water in a −18 °C room freezes solid", `ice from ${f1(tf === null ? null : tf / 60)} min, solid at ${f1(tall === null ? null : tall / 60)} min`)
	if (tf !== null && tall !== null) {
		const wt2 = series(rf, "cup", "water_temp")
		const ka = rf.track.frames.findIndex((f) => f.t * rf.lapse >= tf + 60)
		const kb = rf.track.frames.findIndex((f) => f.t * rf.lapse >= tall - 60)
		check(wt2.slice(ka, kb).every((v) => Math.abs(v) < 0.05), "while it freezes it stays at 0 °C (latent heat)")
	}
	for (const x of [r, rl, rf]) check(energyOk(x) < 1e-9, "T16: the bookkeeping closes (boiled steam's enthalpy booked as vapour)", energyOk(x).toExponential(2))
}

// ---------------------------------------------------------------- cups (spec T14), dew
groups.cups = () => {
	const cup = (id: string, x: number, style: string, lid = false): Item => ({ id, type: "drink-cup", x, y: 0, props: { style, lid, water_ml: 200, water_temp_c: 80 } })
	const r = run([cup("foam", 0.5, "foam", true), cup("paper", 0.9, "paper"), cup("mug", 1.3, "mug"), cup("steel", 1.7, "steel"), cup("flask", 2.1, "flask", true)], { lapse: 120, seconds: 10 })
	const end = (id: string) => series(r, id, "water_temp").at(-1) as number
	check(end("foam") > Math.max(end("paper"), end("mug"), end("steel")) && end("flask") > end("foam"), "T14: after 20 min a flask, then a foam cup with a lid, keep their water hottest [SPEC]", `flask ${end("flask").toFixed(1)}, foam+lid ${end("foam").toFixed(1)}, mug ${end("mug").toFixed(1)}, steel ${end("steel").toFixed(1)}, paper ${end("paper").toFixed(1)} °C`)
	// an open hot cup loses about half its heat by evaporation [SPEC; ASHRAE]: the evaporated water's latent heat over the water's heat lost
	const lostJ = 0.2 * 4184 * (80 - end("paper"))
	const evapJ = (((series(r, "paper", "boiled_g").at(-1) as number) / 1000) * 2.35e6) as number
	check(within(evapJ / lostJ, 0.3, 0.75), "T14: an open paper cup of 80 °C water loses 30-75 % of its heat by evaporation", `${((evapJ / lostJ) * 100).toFixed(0)} %`)
	// a vacuum flask: 0.5 L at 95 °C still above 75 °C after 6 h (typical flask specs): here 200 mL at 80 °C keeps above 60 °C for 2 h
	const rfl = run([{ id: "fl", type: "drink-cup", x: 1.2, y: 0, props: { style: "flask", lid: true, water_ml: 450, water_temp_c: 95 } }], { lapse: 1800, seconds: 12 })
	const t6 = at(rfl, "fl", "water_temp", 6 * 3600)
	check(t6 > 70, "a vacuum flask with its stopper keeps 450 mL of 95 °C water above 70 °C for 6 h (typical spec: 75 °C)", `${t6.toFixed(1)} °C at 6 h`)
	// dew: a glass of 2 °C water in a 25 °C, 50 % room (dew point 13.9 °C) sweats; a glass at 20 °C does not
	const rd = run([{ id: "cold", type: "drink-cup", x: 0.8, y: 0, props: { style: "glass", water_temp_c: 2 } }, { id: "warm", type: "drink-cup", x: 1.6, y: 0, props: { style: "glass", water_temp_c: 20 } }], { lapse: 60, seconds: 10, room: 25 })
	const wc = Math.max(...series(rd, "cold", "wet_g"), 0)
	const ww = Math.max(...series(rd, "warm", "wet_g"), 0)
	check(wc > 0.05 && ww < 0.005, "dew forms on a cold glass (below the dew point), not on one at 20 °C", `${wc.toFixed(3)} g vs ${ww.toFixed(4)} g`)
	for (const x of [r, rfl, rd]) check(energyOk(x) < 1e-9, "T16: the bookkeeping closes (evaporation and dew booked as vapour)", energyOk(x).toExponential(2))
}

// ---------------------------------------------------------------- conduction (spec T10, T11)
groups.conduction = () => {
	const mug = (id: string, x: number): Item => ({ id, type: "drink-cup", x, y: 0, props: { style: "mug", water_temp_c: 90, lid: false } })
	const spoon = (id: string, x: number, material: string): Item => ({ id, type: "spoon", x: x + 0.0175, y: 0.0845, angle: 60, fixed: true, props: { material } })
	const r = run([mug("m1", 0.4), spoon("al", 0.4, "aluminium"), mug("m2", 0.9), spoon("st", 0.9, "stainless steel"), mug("m3", 1.4), spoon("wd", 1.4, "varnished hardwood"), mug("m4", 1.9), spoon("cu", 1.9, "copper")], { lapse: 60, seconds: 10 })
	const handle = (id: string) => series(r, id, "temp7").at(-1) as number
	check(handle("cu") > handle("al") && handle("al") > handle("st") && handle("st") > handle("wd"), "T10: a spoon's handle in hot water: copper > aluminium > stainless > wood", `${handle("cu").toFixed(1)} > ${handle("al").toFixed(1)} > ${handle("st").toFixed(1)} > ${handle("wd").toFixed(1)} °C`)
	check(handle("wd") < 24, "T10: a wooden spoon's handle hardly warms (under 24 °C) [SPEC]", `${handle("wd").toFixed(1)} °C`)
	check(handle("al") > 33, "T10: an aluminium spoon's handle gets warm enough to melt butter (over 33 °C)", `${handle("al").toFixed(1)} °C`)
	// the fin equation [INC eq. 3.80]: a long rod's excess temperature falls as e^(−m·x), m = √(hP/(kA)): copper's falls far slower than steel's
	const hot = { id: "hp", type: "hot-plate", x: 1.0, y: 0, props: { setpoint_c: 200 } }
	const rod = (id: string, x: number, material: string): Item => ({ id, type: "steel-rod", x, y: 0.09, fixed: true, props: { material, length: 0.3 } })
	const dab = (id: string, x: number): Item => ({ id, type: "meltable", x, y: 0.0995, props: { width: 0.01, height: 0.006, depth: 0.01 } })
	const rr = run([hot, rod("cu", 1.19, "copper"), rod("st", 0.81, "stainless steel"), dab("dcu", 1.27), dab("dst", 0.73)], { lapse: 120, seconds: 10 })
	const tc = when(rr, "dcu", "melted", (v) => v >= 0.995)
	const ts = when(rr, "dst", "melted", (v) => v >= 0.995)
	check(tc !== null && (ts === null || tc < ts), "T11: butter on a copper rod over a hot plate melts before butter on a stainless one", `${f1(tc === null ? null : tc / 60)} vs ${f1(ts === null ? null : ts / 60)} min`)
	for (const x of [r, rr]) check(energyOk(x) < 1e-9, "T16: the bookkeeping closes (chains of cells, a heater)", energyOk(x).toExponential(2))
}

// ---------------------------------------------------------------- thermometers
groups.sensor = () => {
	// a glass thermometer's lag: about 8 s in water, about 60 s in air (typical response times); measured as its time to 63 % of a step
	const rw = run([{ id: "cup", type: "drink-cup", x: 1.2, y: 0, props: { style: "glass", water_temp_c: 60 } }, { id: "th", type: "thermometer", x: 1.2, y: 0.02, fixed: true }], { lapse: 4, seconds: 10 })
	const w0 = series(rw, "th", "reading")
	const target = series(rw, "cup", "water_temp")
	const tw = when(rw, "th", "reading", (v) => v >= 22 + 0.632 * ((target.at(-1) as number) - 22))
	check(tw !== null && within(tw, 5, 13), "a glass thermometer in water reaches 63 % of a step in 5-13 s (typical: 8 s)", `${f1(tw)} s, reads ${(w0.at(-1) as number).toFixed(1)} °C in ${(target.at(-1) as number).toFixed(1)} °C water`)
	// in air: a thermometer starting at room temperature in a 2 °C... (use a hot room: 40 °C, the thermometer at 22 °C has no own start: the room's) → lying in still air it reads the room
	const ra = run([{ id: "th", type: "thermometer", x: 1.2, y: 0.25, angle: 0, fixed: true }], { lapse: 1, seconds: 4, room: 30 })
	check(Math.abs((series(ra, "th", "reading").at(-1) as number) - 30) < 0.01, "in still air, away from everything, it reads the room", `${(series(ra, "th", "reading").at(-1) as number).toFixed(3)} °C`)
	// in a lamp's beam it reads high (the sun or a lamp on a thermometer: SR3-007)
	const rl = run([{ id: "th", type: "thermometer", x: 1.0, y: 0.04, angle: 90, fixed: true }, { id: "l", type: "lamp", x: 0.8, y: 0, props: { target: "th", head_height: 0.25 } }], { lapse: 60, seconds: 6 })
	const hi = series(rl, "th", "reading").at(-1) as number
	check(hi > 23, "a thermometer in a lamp's beam reads above the room", `${hi.toFixed(1)} °C in a 22 °C room`)
}

// ---------------------------------------------------------------- the bookkeeping and stability (spec T16, fuzz)
groups.energy = () => {
	// determinism: the same document twice gives the same readings, bit for bit
	const items = [plate("p", 1.0), cube("c", 1.0, 0.04, THICK.ceramic as number), salt("s", 1.0, (THICK.ceramic as number) + 0.0405, 3)]
	const a = run(items, { seconds: 6 })
	const b = run(items, { seconds: 6 })
	check(JSON.stringify(a.track.state) === JSON.stringify(b.track.state) && JSON.stringify(a.track.frames) === JSON.stringify(b.track.frames), "deterministic: the same scene twice, the same track bit for bit")
	check(energyOk(a) < 1e-9, "T16: energy now − at the start = sources + room + vapour + salt (relative)", energyOk(a).toExponential(2))
}
groups.fuzz = () => {
	// random heat scenes (every heat item, random props and places, settings): no exception, every reading finite, the bookkeeping closing
	let seed = 20261019
	const rand = () => {
		seed = (seed + 0x6d2b79f5) >>> 0
		let t = seed
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
	const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T
	const N = Number(process.env.FUZZ_N ?? 120)
	let bad = 0
	let worst = 0
	let slow = 0
	for (let k = 0; k < N; k++) {
		const items: Item[] = []
		const n = 2 + Math.floor(rand() * 6)
		for (let i = 0; i < n; i++) {
			const type = pick(["ice-cube", "salt-pile", "plate", "bowl", "lamp", "thermometer", "hot-plate", "saucepan", "drink-cup", "spoon", "meltable", "puddle", "steel-rod", "wooden-rod",
				"sanding-block", "candle", "candle-jar", "ball-and-ring", "bimetal-strip"])
			const props: Record<string, unknown> = {}
			if (type === "ice-cube") Object.assign(props, { width: 0.01 + rand() * 0.07, height: 0.01 + rand() * 0.07, depth: 0.01 + rand() * 0.07, start_temp_c: -30 + rand() * 30 })
			if (type === "salt-pile") props.mass_g = 0.2 + rand() * 29.8
			if (type === "lamp") Object.assign(props, { power_w: 5 + rand() * 145, bulb: pick(["incandescent", "led", "halogen"]), aim: -180 + rand() * 360 })
			if (type === "hot-plate") Object.assign(props, { power_w: 100 + rand() * 1400, setpoint_c: 20 + rand() * 530 })
			if (type === "drink-cup") Object.assign(props, { style: pick(["foam", "paper", "plastic", "glass", "steel", "mug", "flask"]), water_temp_c: rand() * 100, water_ml: rand() * 500, lid: rand() < 0.5 })
			if (type === "saucepan") Object.assign(props, { water_ml: rand() * 3000, water_temp_c: rand() * 100, salt_g: rand() < 0.3 ? rand() * 200 : 0 })
			if (type === "bowl") Object.assign(props, { contents: pick(["nothing", "water", "sand"]), contents_g: 10 + rand() * 990 })
			if (type === "candle") Object.assign(props, { height: 0.065 + rand() * 0.2, lit: rand() < 0.8, lit_at: rand() * 2 })
			if (type === "candle-jar") props.volume_ml = 250 + rand() * 3750
			if (type === "sanding-block") Object.assign(props, { press_n: 0.5 + rand() * 29.5, speed: 0.05 + rand() * 1.45, rub_s: 0.5 + rand() * 5 })
			if (type === "ball-and-ring") Object.assign(props, { ball_temp_c: -20 + rand() * 620, ring_temp_c: -20 + rand() * 620 })
			if (type === "bimetal-strip") Object.assign(props, { start_temp_c: -20 + rand() * 420, layers: pick(["brass on steel", "steel on brass"]) })
			items.push({ id: `i${i}`, type, x: -0.3 + rand() * 3, y: rand() * 0.5, angle: rand() < 0.2 ? -40 + rand() * 80 : 0, props, ...(rand() < 0.15 ? { fixed: true } : {}) })
		}
		const opts = { lapse: pick([1, 60, 600, 3600, 100000]), seconds: pick([1, 2, 3]), room: -40 + rand() * 90 }
		if (process.env.FUZZ_ONLY !== undefined && Number(process.env.FUZZ_ONLY) !== k) continue
		try {
			const r = run(items, opts)
			const finite = Object.values(r.track.state ?? {}).every((o) => Object.values(o).every((v) => v.every((x) => Number.isFinite(x))))
			const e = energyOk(r)
			worst = Math.max(worst, e)
			if (!finite || !(e < 1e-8)) bad++
			if (r.ms > 20000) slow++
			if (!finite || !(e < 1e-8) || r.ms > 20000 || process.env.FUZZ_ONLY !== undefined)
				console.log(`  scene ${k}: ${items.map((i) => i.type).join(", ")}; lapse ${opts.lapse}, ${opts.seconds} s, room ${opts.room.toFixed(1)} °C: ${finite ? "finite" : "NOT FINITE"}, imbalance ${e.toExponential(2)}, ${(r.ms / 1000).toFixed(1)} s`)
		} catch (e) {
			bad++
			console.log("  fuzz scene threw:", String(e).slice(0, 200))
		}
	}
	check(bad === 0, `fuzz: ${N} random heat scenes (time-lapse 1-100000, rooms −40-50 °C): no exception, finite readings, the bookkeeping closing`, `${bad} bad, worst imbalance ${worst.toExponential(2)}, ${slow} over 20 s`)
}

// ---------------------------------------------------------------- work into heat: rubbing and impacts (thermal spec §3 P2: honest sizes)
const endOf = (r: Run, id: string, key: string) => {
	const v = series(r, id, key)
	return v.length ? (v[v.length - 1] as number) : NaN
}
const riseOf = (r: Run, id: string, key = "temp") => {
	const v = series(r, id, key).filter((x) => x !== null) as number[]
	return v.length ? Math.max(...v) - (v[0] as number) : NaN
}
groups.work = () => {
	// [SPEC] a 50 g block rubbed with 5 N for 10 s at 0.5 m/s: 25 J of friction's work, half into it: about +0.1 °C. Here μ(sandpaper on the
	// table) ≈ 0.6 and N = 5 N + its own 0.55 N: about 16 J, 8 J into its 56 g (pine 1380, sandpaper 1100 J/(kg·K)): +0.1 °C; less what it
	// gives the table and the air
	const r = run([{ id: "s", type: "sanding-block", x: 1.0, y: 0, props: {} }], { lapse: 1, seconds: 11, room: 20 })
	const W = endOf(r, "s", "work_j")
	const dT = riseOf(r, "s")
	check(within(W, 4, 12), "rubbing: a sanding block rubbed 10 s at 5 N and 0.5 m/s takes in 4-12 J of friction's work (half of μ·N·v·t) [SPEC]", `${W.toFixed(2)} J`)
	check(within(dT, 0.05, 0.2), "rubbing: it warms by about +0.1 °C, an honest small rise (0.05-0.2) [SPEC]", `+${dT.toFixed(3)} °C`)
	check(energyOk(r) < 1e-9, "rubbing: the bookkeeping closes with friction's work booked", energyOk(r).toExponential(2))
	// twice the press, about twice the work (μ·N·v·t: N doubles from 5.55 to 10.55 N)
	const r2 = run([{ id: "s", type: "sanding-block", x: 1.0, y: 0, props: { press_n: 10 } }], { lapse: 1, seconds: 11, room: 20 })
	const W2 = endOf(r2, "s", "work_j")
	check(within(W2 / W, 1.6, 2.1), "rubbing: pressed 10 N instead of 5 N, about 1.9 times the work (μ·N·v·t)", `${(W2 / W).toFixed(2)}×`)
	// [SPEC] a 1 kg steel weight dropped 1 m: 9.8 J, all of it lost in its bounces, half into the weight: +0.011 °C (cast iron 450 J/(kg·K))
	// (a thermometer on the table: the scene has heat)
	const d = run([{ id: "w", type: "steel-weight-1kg", x: 1.8, y: 1.026, props: {} }, { id: "t", type: "thermometer", x: 0.5, y: 0.2, fixed: true, props: {} }], { lapse: 1, seconds: 3, room: 20 })
	const Wd = endOf(d, "w", "work_j")
	check(within(Wd, 4.2, 6.0), "impact: a 1 kg weight dropped 1 m takes in about half its 9.8 J (4.2-6.0 J) [SPEC]", `${Wd.toFixed(2)} J`)
	check(within(riseOf(d, "w"), 0.008, 0.015), "impact: it warms by about +0.01 °C (the spec's 0.02 if all of it stayed in the weight)", `+${riseOf(d, "w").toFixed(4)} °C`)
	// the mechanics module's pusher sliding a 1 kg steel weight 30 cm at 0.5 m/s: μ·m·g·d ≈ 0.4 × 9.81 × 0.3 = 1.2 J of friction's work, half
	// into the weight (+0.001 °C: far too little to feel)
	const pu = run([{ id: "p", type: "pusher", x: 0.6, y: 0, props: { mode: "speed", speed: 0.5, stroke: 0.3, height: 0.025 } },
		{ id: "b", type: "steel-weight-1kg", x: 0.6 + 0.0262, y: 0.0252, props: {} }, { id: "t", type: "thermometer", x: 2.5, y: 0.2, fixed: true, props: {} }], { lapse: 1, seconds: 2, room: 20 })
	const Wp = endOf(pu, "b", "work_j")
	check(within(Wp, 0.2, 1.2), "the pusher: a 1 kg weight slid 30 cm takes in about half of μ·m·g·d (0.6 J): it warms by about a thousandth of a degree", `${Wp.toFixed(3)} J, +${riseOf(pu, "b").toFixed(5)} °C`)
	// what rests takes in (almost) nothing: a block standing still on the table, settling, under 1 mJ
	const st = run([{ id: "b", type: "sanding-block", x: 1.0, y: 0, props: { rub_s: 0.5, rub_at: 20 } }, { id: "c", type: "ice-cube", x: 1.5, y: 0.0205, props: { width: 0.04, height: 0.04, depth: 0.04 } }], { lapse: 1, seconds: 3, room: 20 })
	check(series(st, "b", "work_j").length === 0 || endOf(st, "b", "work_j") < 0.001, "no fake heat: a resting block takes in under 1 mJ (it has no work_j reading)", `${series(st, "b", "work_j").length ? endOf(st, "b", "work_j") : 0} J`)
}

// ---------------------------------------------------------------- a candle's flame [NIST-CANDLE]: its wax, its plume, a jar's oxygen
const candleAt = (id: string, x: number, props: Record<string, unknown> = {}): Item => ({ id, type: "candle", x, y: 0.04, props: { height: 0.08, mass: 0.027, lit: true, ...props } })
groups.candle = () => {
	// burning 0.1 g of wax a minute (Hamins et al. 2005): over 10 lesson minutes 1.00 g
	const b = run([candleAt("c", 1.0)], { lapse: 60, seconds: 10, room: 20 })
	const g = endOf(b, "c", "burned_g")
	check(Math.abs(g - 1.0) < 0.02, "candle: it burns 0.1 g of wax a minute: 1.0 g in 10 lesson minutes [NIST-CANDLE]", `${g.toFixed(3)} g`)
	check(series(b, "c", "flame").every((v) => v === 1), "candle: in the open it burns all the time")
	// on a kitchen scale (the measure module's, 1 g): it gets lighter as it burns, 1 g in 10 lesson minutes
	const sc = run([{ id: "s", type: "kitchen-scale", x: 1.0, y: 0, props: {} }, { id: "c", type: "candle", x: 1.0, y: 0.023 + 0.04, props: { height: 0.08, mass: 0.027, lit: true } }], { lapse: 60, seconds: 10, room: 20 })
	const gs = series(sc, "s", "grams") as number[]
	const k1 = sc.track.frames.findIndex((f) => f.t >= 1)
	check(gs.length > 0 && within((gs[k1] as number) - (gs[gs.length - 1] as number), 0.5, 1.5), "candle on a kitchen scale: the scale reads about 1 g less after 10 lesson minutes of burning (MS-PS1-5: the wax goes into the air)", `${gs[k1]} → ${gs[gs.length - 1]} g`)
	// a 1 L jar: 4.3 mL of oxygen a second from 209 mL; out at 16 %: (20.95 − 16) % × 1 L / 4.32 mL/s = 11.5 s; a 2 L jar twice as long
	const outAt = (vol: number) => {
		// (lesson time twice the run's: a run is at most 20 s; the flame burns on the lesson clock)
		const r = run([candleAt("c", 1.0), { id: "j", type: "candle-jar", x: 1.0, y: 0, props: { volume_ml: vol } }], { lapse: 2, seconds: 16, room: 20 })
		return { t: when(r, "c", "flame", (v) => v < 1), o2: endOf(r, "j", "o2_pct"), r }
	}
	const one = outAt(1000)
	const two = outAt(2000)
	check(one.t !== null && within(one.t, 9, 14), "candle under a 1 L jar goes out in about 11.5 s (its oxygen 20.95 → 16 % at 4.3 mL/s) [NIST-CANDLE]", `${f1(one.t)} s, ${one.o2.toFixed(2)} % oxygen left`)
	check(one.t !== null && two.t !== null && within(two.t / one.t, 1.85, 2.15), "candle: under a 2 L jar it burns twice as long", `${f1(two.t)} s (${two.t !== null && one.t !== null ? (two.t / one.t).toFixed(2) : "?"}×)`)
	check(within(one.o2, 15.8, 16.05), "candle: it goes out when the jar's air is at 16 % oxygen", `${one.o2.toFixed(2)} %`)
	check(energyOk(one.r) < 1e-9, "candle: the bookkeeping closes (its wax's heat booked, its flame's heat a source)", energyOk(one.r).toExponential(2))
	// its plume (Heskestad): 17 cm over the wick, 60 W convected: ΔT0 = 9.1·(T∞/(g·cp²·ρ²))^⅓·Qc^⅔·z^(−5/3) = 73 K on the axis; a thermometer there
	// reads that within a minute (its glass bulb lags: 60 s in still air, faster in the plume's 0.7 m/s)
	const T = 293.15
	const dT0 = 9.1 * Math.cbrt(T / (9.81 * 1007 * 1007 * 1.2 * 1.2)) * Math.pow(60, 2 / 3) * Math.pow(0.17, -5 / 3)
	// (a thermometer reads a hot gas low: its bulb also radiates to the cooler room, about 7 W/(m²·K) against the plume's 25 of convection)
	const pl = run([candleAt("c", 1.0), { id: "t", type: "thermometer", x: 1.0, y: 0.25, fixed: true, props: {} }], { lapse: 6, seconds: 20, room: 20 })
	const rd = endOf(pl, "t", "reading")
	// (it radiates to the room and takes the flame's own radiation: within 0.6-1.1 of the gas's rise)
	check(within(rd - 20, 0.6 * dT0, 1.1 * dT0), "candle: a thermometer 17 cm over the wick comes close to the plume's axis temperature (Heskestad: +73 K) [SFPE]", `${rd.toFixed(1)} °C, axis +${dT0.toFixed(1)} K`)
	const side = run([candleAt("c", 1.0), { id: "t", type: "thermometer", x: 1.15, y: 0.25, fixed: true, props: {} }], { lapse: 6, seconds: 20, room: 20 })
	check(endOf(side, "t", "reading") < 22, "candle: 15 cm to the side of the plume the air is the room's (a plume is 3-4 cm wide there)", `${endOf(side, "t", "reading").toFixed(2)} °C`)
}

// ---------------------------------------------------------------- light: clear glass, the optics module's traced light, a lens's focus
groups.light = () => {
	const cubeIn = (x: number) => cube(`c${Math.round(x * 10)}`, x, 0.04, 0, 0)
	// heat's own estimate and the optics module's agree that a clear jar over a cube passes about 92 % of a lamp's light (glass: 2 × 4 % Fresnel)
	const scene = [cubeIn(0.8), { id: "la", type: "lamp", x: 0.6, y: 0, props: { target: "c8", head_height: 0.35 } }, cubeIn(2.0),
		{ id: "j", type: "candle-jar", x: 2.0, y: 0, fixed: true, props: { volume_ml: 1000 } }, { id: "lb", type: "lamp", x: 1.8, y: 0, props: { target: "c20", head_height: 0.35 } }]
	const r = run(scene, { lapse: 600, seconds: 6, room: 22 })
	const a = endOf(r, "c8", "melted")
	const b = endOf(r, "c20", "melted")
	const open = run([cubeIn(0.8), cubeIn(2.0)], { lapse: 600, seconds: 6, room: 22 })
	const base = endOf(open, "c8", "melted")
	const share = (b - base) / (a - base)
	check(within(share, 0.85, 0.97), "clear glass: an ice cube under a clear jar still gets about 92 % of the lamp's heat (Hecht §4.6: two faces' 4 %)", `${(share * 100).toFixed(0)} % of the lamp's extra melting`)
	// a magnifying glass: sunlight through a 5 cm lens (f 10 cm) focused on paper: its hottest spot passes 230 °C within seconds; the same paper in
	// plain sunlight has no hot spot (sunlight 1000 W/m² on white paper warms it a few degrees)
	const sunLens = [{ id: "sun", type: "sunlight", x: 1.0, y: 0.6, props: { elevation: 90, width: 0.3 } }, { id: "lens", type: "convex-lens", x: 1.0, y: 0.101, props: { focal_length: 0.1, diameter: 0.05, aim: 90 } }]
	const g = run([...sunLens, { id: "paper", type: "paper-sheet", x: 1.0, y: 0.0006, props: {} }, { id: "paper2", type: "paper-sheet", x: 1.6, y: 0.0006, props: {} }], { lapse: 1, seconds: 5, room: 22 })
	const spot = Math.max(...(series(g, "paper", "spot_temp") as number[]))
	const t = when(g, "paper", "spot_temp", (v) => v >= 230)
	check(spot >= 230 && t !== null && t < 3, "burning glass: paper at a 5 cm lens's focus in sunlight passes 230 °C within 3 s (paper scorches at 233 °C)", `hottest ${spot.toFixed(0)} °C at ${f1(t)} s`)
	check(series(g, "paper2", "spot_temp").length === 0, "burning glass: paper in plain sunlight has no hot spot")
	const unfocused = run([...sunLens.slice(0, 1), { id: "lens", type: "convex-lens", x: 1.0, y: 0.101, props: { focal_length: 0.3, diameter: 0.05, aim: 90 } }, { id: "paper", type: "paper-sheet", x: 1.0, y: 0.0006, props: {} }], { lapse: 1, seconds: 3, room: 22 })
	const s2 = series(unfocused, "paper", "spot_temp") as number[]
	check(!s2.length || Math.max(...s2) < spot / 2, "burning glass: out of focus (a 30 cm lens 10 cm up) the spot is far cooler", `${s2.length ? Math.max(...s2).toFixed(0) : "no spot"} °C`)
	// foil reflectors: sunlight off an aluminium foil panel beside a piece of chocolate gives it about 60 % more light (opaque bodies take the optics
	// module's traced light, mirrors and all), so it warms faster than one in the sun alone
	const f = run([{ id: "sun", type: "sunlight", x: 1.4, y: 0.8, props: { elevation: 60, width: 3 } }, { id: "a", type: "meltable", x: 0.8, y: 0.0105, props: { material: "chocolate" } },
		{ id: "foil", type: "material-panel", x: 0.92, y: 0.1, props: { sample: "aluminium foil", size: 0.2, aim: -18 } }, { id: "b", type: "meltable", x: 2.0, y: 0.0105, props: { material: "chocolate" } }], { lapse: 30, seconds: 6, room: 22 })
	const la = endOf(f, "a", "light_w")
	const lb = endOf(f, "b", "light_w")
	check(within(la / lb, 1.3, 2.0), "foil reflector: chocolate beside a foil panel in the sun takes 30-100 % more light (the optics module's tracing)", `${la.toFixed(3)} W vs ${lb.toFixed(3)} W`)
	check(endOf(f, "a", "temp") > endOf(f, "b", "temp") + 0.5, "foil reflector: and it is warmer", `${endOf(f, "a", "temp").toFixed(1)} vs ${endOf(f, "b", "temp").toFixed(1)} °C`)
}

// ---------------------------------------------------------------- liquids: pouring hot into cold (T8), oil (MS-PS3-4), sand (T12)
groups.liquids = () => {
	// [SPEC T8] 100 g at 80 °C into 100 g at 20 °C gives 50.0 °C with no losses; here 200 mL into 200 mL in a 600 mL glass beaker: the beaker's own
	// glass (as heat has it) takes its share, so the mix is the calorimetry of water + water + glass, less a little to the air while it pours
	const r = run([{ id: "beaker", type: "beaker", x: 1.0, y: 0, props: { size: "600 mL", fill_ml: 200, water_temp_c: 20 } },
		{ id: "jug", type: "pitcher", x: 0.99, y: 0.2, props: { vessel: "cup", fill_ml: 200, temp_c: 80, pour_at: 1, tilt: 120 } },
		{ id: "t", type: "thermometer", x: 1.03, y: 0.012, fixed: true, props: {} }], { lapse: 1, seconds: 8, room: 20 })
	const end = endOf(r, "beaker", "water_temp")
	const glass = (r.world as unknown as { node(id: string): { C: number } | undefined }).node("beaker/floor")?.C ?? 0
	const mw = 0.2 * 0.9982
	const mix = (mw * 4184 * 80 + mw * 4184 * 20 + glass * 20) / (2 * mw * 4184 + glass)
	// (between the calorimetry with all of the beaker's glass warmed, and 50.0 °C with none of it: its thick glass is still warming; less a little to the air)
	check(within(end, mix - 1.5, 50.0), "T8: hot water poured into cold comes to the mass-weighted mix: between 50.0 °C and the calorimetry with the beaker's glass [SPEC]", `${end.toFixed(2)} °C, calorimetry ${mix.toFixed(2)} °C (no glass: 50.0)`)
	check(within(endOf(r, "beaker", "water_g"), 395, 400), "T8: all the poured water arrived (flow's particles, heat for heat)", `${endOf(r, "beaker", "water_g").toFixed(1)} g`)
	check(energyOk(r) < 1e-8, "T8: the bookkeeping closes through the pour", energyOk(r).toExponential(2))
	// vegetable oil (c 1970) against water (4184) in the same beaker under the same lamp: the oil warms 2-4 times as fast (by volume: its c·ρ is 2.3
	// times less; water also loses heat by evaporating)
	const lampOn = (id: string, x: number, t: string) => ({ id, type: "lamp", x, y: 0, props: { target: t, power_w: 100, head_height: 0.3 } })
	const o = run([{ id: "bo", type: "beaker", x: 0.8, y: 0, props: { size: "250 mL", fill_ml: 200, liquid: "vegetable oil", water_temp_c: 22 } }, lampOn("lo", 0.6, "bo"),
		{ id: "bw", type: "beaker", x: 1.8, y: 0, props: { size: "250 mL", fill_ml: 200, liquid: "water", water_temp_c: 22 } }, lampOn("lw", 1.6, "bw")], { lapse: 60, seconds: 6, room: 22 })
	const ro = riseOf(o, "bo", "liquid_temp")
	const rw = riseOf(o, "bw", "water_temp")
	check(within(ro / rw, 2, 4.5), "oil vs water: under the same lamp oil warms 2-4.5 times as fast (c 1970 against 4184 J/(kg·K)) [ETB]", `+${ro.toFixed(2)} vs +${rw.toFixed(2)} °C`)
	// [SPEC T12] 200 g of dry sand against 200 g of water in identical bowls under the same lamp: sand warms 4-5 times faster at first (c ratio 5.0,
	// less what the water absorbs more)
	const sw = run([{ id: "bs", type: "bowl", x: 0.8, y: 0, props: { contents: "sand", contents_g: 200, contents_temp_c: 22 } }, { id: "ls", type: "lamp", x: 0.6, y: 0, props: { target: "bs", power_w: 100, head_height: 0.25 } },
		{ id: "bw", type: "bowl", x: 1.8, y: 0, props: { contents: "water", contents_g: 200, contents_temp_c: 22 } }, { id: "lw", type: "lamp", x: 1.6, y: 0, props: { target: "bw", power_w: 100, head_height: 0.25 } }], { lapse: 60, seconds: 6, room: 22 })
	const rs = riseOf(sw, "bs", "sand:temp")
	const rww = riseOf(sw, "bw", "water_temp")
	check(within(rs / rww, 2.5, 6), "T12: dry sand warms about 3-5 times faster than the same mass of water under one lamp (c 830 against 4184) [SPEC]", `+${rs.toFixed(2)} vs +${rww.toFixed(2)} °C`)
}

// ---------------------------------------------------------------- solids expand: the ball and ring, the bimetal strip [CRC], [TIMOSHENKO]
groups.expansion = () => {
	const r = run([{ id: "cold", type: "ball-and-ring", x: 0.8, y: 0, props: { ball_temp_c: 20 } }, { id: "hot", type: "ball-and-ring", x: 1.5, y: 0, props: { ball_temp_c: 300 } }], { lapse: 1, seconds: 4, room: 20 })
	check(endOf(r, "cold", "through") === 1, "ball and ring: the cold ball (25.40 mm) drops through the 25.45 mm ring")
	check(endOf(r, "hot", "through") === 0, "ball and ring: heated to 300 °C it sits on the ring")
	const d300 = 25.4 * (1 + 19e-6 * 280)
	check(Math.abs((series(r, "hot", "ball_mm")[0] as number) - d300) < 0.002, "ball and ring: brass grows 19e-6/K: 25.4 mm at 300 °C is 25.535 mm [CRC]", `${(series(r, "hot", "ball_mm")[0] as number).toFixed(4)} mm vs ${d300.toFixed(4)}`)
	const c = run([{ id: "hot", type: "ball-and-ring", x: 1.5, y: 0, props: { ball_temp_c: 300 } }], { lapse: 60, seconds: 10, room: 20 })
	const through = when(c, "hot", "through", (v) => v >= 1)
	check(through !== null && within(through / 60, 1, 10), "ball and ring: the hot ball cools on the ring (and warms it) until it fits and drops through: in minutes", `at ${through === null ? "never" : (through / 60).toFixed(1)} min`)
	const ballC = through === null ? NaN : at(c, "hot", "ball:temp", through)
	const ringC = through === null ? NaN : at(c, "hot", "temp", through)
	check(Math.abs(25.4 * (1 + 19e-6 * (ballC - 20)) - 25.45 * (1 + 12e-6 * (ringC - 20))) < 0.003, "ball and ring: it drops as the two sizes meet", `ball ${ballC.toFixed(0)} °C, ring ${ringC.toFixed(0)} °C`)
	// Timoshenko 1925, two equal layers (m = 1), brass over steel (n = E_steel/E_brass = 2): κ = 24·Δα·ΔT / (h·(12 + 3·1.5)); a 10 cm strip at
	// 120 °C (100 K over straight): δ = κ·L²/2
	const k = (24 * 7e-6 * 100) / (0.0012 * (12 + 3 * 1.5))
	const bm = run([{ id: "s", type: "bimetal-strip", x: 1.0, y: 0, props: { start_temp_c: 120 } }], { lapse: 1, seconds: 1, room: 20 })
	const tip0 = series(bm, "s", "bend_mm")[0] as number
	const T0 = series(bm, "s", "temp")[0] as number
	check(Math.abs(tip0 - ((k * (T0 - 20)) / 100) * 0.01 * 500) < 0.01, "bimetal: a 10 cm brass-on-steel strip 100 K over its straight temperature bends 4.24 mm at its tip (Timoshenko 1925)", `${tip0.toFixed(3)} mm at ${T0.toFixed(1)} °C`)
	const flip = run([{ id: "s", type: "bimetal-strip", x: 1.0, y: 0, props: { start_temp_c: 120, layers: "steel on brass" } }], { lapse: 1, seconds: 1, room: 20 })
	check((series(flip, "s", "bend_mm")[0] as number) < 0, "bimetal: steel on brass bends the other way (toward the steel, up)")
	const cold = run([{ id: "s", type: "bimetal-strip", x: 1.0, y: 0, props: { start_temp_c: -20 } }], { lapse: 1, seconds: 1, room: 20 })
	check((series(cold, "s", "bend_mm")[0] as number) < 0, "bimetal: cooled below 20 °C it bends the other way (toward the brass)")
}

const order = ["data", "melt", "salt", "lamp", "water", "cups", "conduction", "sensor", "energy", "work", "candle", "light", "liquids", "expansion", "fuzz"]
for (const g of want === "all" ? order : want.split(",")) {
	console.log(`\n# ${g}`)
	const fn = groups[g]
	if (!fn) {
		console.log(`no group ${g}`)
		failed++
		continue
	}
	fn()
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
