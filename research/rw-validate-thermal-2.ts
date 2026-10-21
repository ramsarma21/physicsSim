// The heat module's repair checks (20 Oct): one water and one level with the liquids module, the lesson clock against the release and the
// time-lapse, the hot plate's thermostat, no air, thermometers through lids, and lids on cups.
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-thermal-2.ts [level|clock|thermostat|vacuum|lids|cups|all]
// Scenes are built by web/sim (number for number machines/*.py) and run by the engine in node, as the server runs them. Sources:
//   [ARCHIMEDES] floating ice displaces its own weight of water, so its melt water fills exactly the volume it displaced (the level holds;
//           Archimedes, On Floating Bodies I, prop. 5; e.g. Noerdlinger & Brower, Geophys. J. Int. 170, 145 (2007) for the fresh-on-fresh case)
//   [ASHRAE] ASHRAE Handbook — HVAC Applications ch. 6 (Carrier's equation): an open cup of hot water loses a third to a half of its heat by
//           evaporation, which a lid stops
//   [INC]   Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, 6th ed.: foam k 0.033 W/(m·K) against stainless 15 (a 2.5 mm foam wall
//           adds 0.076 m²·K/W, a 0.8 mm steel wall nothing), polished stainless ε 0.15
//   [SPEC]  the thermal module's spec (engine4/spec/modules/thermal.md): the hot plate's thermostat holds ±5 K
import path from "node:path"
import { pathToFileURL } from "node:url"

const PG = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const DIR = process.env.ENGINE_DIR ?? `${PG}/tooling/src/sim`
const { admitDocument } = (await import(`${DIR}/document.ts`)) as { admitDocument: (d: unknown) => { scene: object } }
const { simulate } = (await import(`${DIR}/physics.ts`)) as { simulate: (s: object, fps: number) => Track }
await import(`${DIR}/modules/index.ts`)
const H = (await import(`${DIR}/heat.ts`)) as { heatWorldOf: (s: object) => World | undefined }
const sim = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as {
	prepare: (s: object) => { scene: object; doc: Doc; resolved: object; warnings?: { text: string }[] }
	summarize: (scene: object, doc: Doc, track: Track) => { goals?: Record<string, unknown>[]; warnings?: { text: string }[] }
}

interface Track {
	frames: { t: number; placements: Record<string, { x: number; y: number; scale?: number }> }[]
	state?: Record<string, Record<string, number[]>>
}
interface Doc {
	solids: { id: string }[]
	processes?: Record<string, unknown>[]
}
interface World {
	imbalance(): number
	ledger: Record<string, number>
}
const want = process.argv[2] ?? "all"
let failed = 0
let passed = 0
const check = (ok: boolean, what: string, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
	if (ok) passed++
	else failed++
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const TABLE = { id: "table", type: "table", x: 1.3, y: 0, props: {} }
type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; fixed?: boolean }
interface Run {
	scene: Record<string, unknown>
	track: Track
	doc: Doc
	lapse: number
	world: World | undefined
	warnings: string[]
}
function run(items: Item[], { lapse = 900, seconds = 15, room = 22, release = 0.2, settings = {}, goals = [] }: { lapse?: number; seconds?: number; room?: number; release?: number; settings?: Record<string, unknown>; goals?: object[] } = {}): Run {
	const scene = { version: 2, id: "v", name: "v", seconds, release, stage: STAGE, settings: { room_temp: room, time_lapse: lapse, ...settings }, items: [TABLE, ...items], goals }
	const { doc } = sim.prepare(scene)
	const { scene: s } = admitDocument(doc)
	const track = simulate(s, 24)
	const sum = sim.summarize(scene, doc, track)
	return { scene, track, doc, lapse, world: H.heatWorldOf(s), warnings: (sum.warnings ?? []).map((w) => (typeof w === "string" ? w : w.text)) }
}
const series = (r: Run, id: string, key: string) => r.track.state?.[id]?.[key] ?? []
const endOf = (r: Run, id: string, key: string) => series(r, id, key).at(-1) as number
/** The lesson time (s) a reading first passes a test, or null. */
function when(r: Run, id: string, key: string, test: (v: number) => boolean): number | null {
	const v = series(r, id, key)
	for (let k = 0; k < v.length; k++) if (test(v[k] as number)) return (r.track.frames[k]?.t ?? 0) * r.lapse
	return null
}
const meltS = (r: Run, id: string) => when(r, id, "melted", (v) => v >= 0.995)
const energyOk = (r: Run) => {
	const w = r.world
	if (!w) return 1
	const scale = Math.max(1, Math.abs(w.ledger.room ?? 0) + Math.abs(w.ledger.sources ?? 0) + Math.abs(w.ledger.vapor ?? 0))
	return Math.abs(w.imbalance()) / scale
}
const groups: Record<string, () => void> = {}

// ---------------------------------------------------------------- one water, one level (heat-fluids.ts)
groups.level = () => {
	// an 8 × 6 × 8 cm cube (352 g) floating in an aquarium 20 × 10 cm across with 10 cm of water, 22 °C room: while it floats and as it melts the
	// level holds [ARCHIMEDES]; heat's water and the liquids module's volume grow together
	const r = run(
		[
			{ id: "tank", type: "water-tank", x: 1.2, y: 0, props: { length: 0.2, height: 0.2, depth: 0.1, fill: 0.1, water_temp_c: 20 } },
			{ id: "ice", type: "ice-cube", x: 1.2, y: 0.135, props: { width: 0.08, height: 0.06, depth: 0.08 } }
		],
		{ lapse: 600, seconds: 12, release: 0.05 }
	)
	const lv = series(r, "tank", "level_mm")
	const vol = series(r, "tank", "volume_ml")
	const wg = series(r, "tank", "water_g")
	const ev = series(r, "tank", "boiled_g")
	const melted = series(r, "ice", "melted")
	// (the frames it floats steadily, a third to nineteen-twentieths melted: the level's mean; and the level once it has all melted)
	const floating = lv.filter((_, k) => (melted[k] as number) >= 0.33 && (melted[k] as number) <= 0.95)
	const mean = floating.reduce((a, b) => a + b, 0) / Math.max(1, floating.length)
	const kEnd = melted.findIndex((v) => v >= 1)
	const after = kEnd >= 0 ? (lv[Math.min(lv.length - 1, kEnd + 6)] as number) : NaN
	// (what evaporated or condensed meanwhile, over the tank's cross-section: its water's own change, not the ice's)
	const areaMm2 = ((vol[0] as number) * 1000) / Math.max(1e-9, lv[0] as number)
	const evMm = ((Math.abs((ev[Math.min(ev.length - 1, kEnd + 6)] as number) - (ev[melted.findIndex((v) => v >= 0.33)] as number)) / 0.9982) * 1000) / areaMm2
	check(kEnd > 0 && Math.abs(after - mean) <= 0.1 + evMm, "floating ice that melts leaves the level where it was, within 0.1 mm and what evaporated or condensed [ARCHIMEDES]", `floating ${mean.toFixed(2)} mm, melted ${after.toFixed(2)} mm, ${evMm.toFixed(3)} mm of vapour`)
	check(!("level" in (r.track.state?.tank ?? {})), "a fluids container has one level reading (the liquids module's level_mm; heat gives none of its own)")
	const water0 = (wg[0] as number) / 0.9982
	const iceMl = ((0.08 * 0.06 * 0.08 * 917) / 998.2) * 1e6
	const volEnd = vol.at(-1) as number
	const evEnd = (ev.at(-1) as number) / 0.9982
	check(Math.abs(volEnd - (water0 + iceMl - evEnd)) < 2, "its volume ends as its water plus the ice's melt water, less what evaporated (mL)", `${volEnd.toFixed(1)} vs ${(water0 + iceMl - evEnd).toFixed(1)} mL`)
	check(Math.abs((wg.at(-1) as number) / 0.9982 - volEnd) < 2, "heat's water and the liquids module's volume agree at the end", `${((wg.at(-1) as number) / 0.9982).toFixed(1)} vs ${volEnd.toFixed(1)} mL`)
	check(energyOk(r) < 1e-9, "the bookkeeping closes", energyOk(r).toExponential(2))
	// a hot tank evaporates: its level falls by what heat's water loses
	const rh = run([{ id: "tank", type: "water-tank", x: 1.2, y: 0, props: { length: 0.2, height: 0.2, depth: 0.1, fill: 0.1, water_temp_c: 80 } }], { lapse: 3600, seconds: 6 })
	const lost = (endOf(rh, "tank", "boiled_g") as number) / 0.9982
	const drop = (series(rh, "tank", "volume_ml")[0] as number) - endOf(rh, "tank", "volume_ml")
	check(lost > 5 && Math.abs(drop - lost) < 0.5, "an 80 °C tank's level falls by the water that evaporates (mL)", `${drop.toFixed(1)} vs ${lost.toFixed(1)} mL in 6 h`)
}

// ---------------------------------------------------------------- the lesson clock: from t = 0, whatever the release or the time-lapse
const saltScene = (): Item[] => [
	{ id: "plate1", type: "plate", x: 0.8, y: 0 },
	{ id: "plate2", type: "plate", x: 1.4, y: 0 },
	{ id: "salted", type: "ice-cube", x: 0.8, y: 0.0255, props: { width: 0.04, height: 0.04, depth: 0.04 } },
	{ id: "plain", type: "ice-cube", x: 1.4, y: 0.0255, props: { width: 0.04, height: 0.04, depth: 0.04 } },
	{ id: "salt", type: "salt-pile", x: 0.8, y: 0.0458, props: { mass_g: 6 } }
]
groups.clock = () => {
	// things that rest on each other touch from t = 0 (heat takes what stands touching before the release), so melt times hold within 1 % and
	// a frame whether the release is 0.2, 2 or 5 s (2 to 50 minutes of lesson time at 600×) or the time-lapse 300 to 3600
	const times: Record<string, [number | null, number | null, number]> = {}
	for (const rel of [0.2, 2, 5]) {
		const r = run(saltScene(), { lapse: 600, seconds: 12, release: rel })
		times[`release ${rel} s`] = [meltS(r, "salted"), meltS(r, "plain"), 600 / 24]
	}
	for (const tl of [300, 1200, 3600]) {
		const r = run(saltScene(), { lapse: tl, seconds: Math.ceil(7200 / tl) + 1, release: 0.2 })
		times[`time-lapse ${tl}`] = [meltS(r, "salted"), meltS(r, "plain"), tl / 24]
	}
	const base = times["release 0.2 s"] as [number, number, number]
	for (const [k, [a, b, frame]] of Object.entries(times)) {
		const ok = a !== null && b !== null && Math.abs(a - base[0]) <= 0.01 * base[0] + Math.max(frame, base[2]) && Math.abs(b - base[1]) <= 0.01 * base[1] + Math.max(frame, base[2])
		check(ok, `the salted and plain cubes melt at the same lesson times with ${k} as with release 0.2 s (1 % and a frame)`, `${((a ?? NaN) / 60).toFixed(1)} / ${((b ?? NaN) / 60).toFixed(1)} min vs ${(base[0] / 60).toFixed(1)} / ${(base[1] / 60).toFixed(1)}`)
	}
	// salt dissolves from the start: by 10 lesson minutes most of it, whatever the release
	for (const rel of [0.2, 5]) {
		const r = run(saltScene(), { lapse: 600, seconds: 2, release: rel })
		const k = r.track.frames.findIndex((f) => f.t * 600 >= 600)
		const left = series(r, "salt", "salt_g")[k] as number
		check(left < 3, `the salt dissolves into the melt water from the start (release ${rel} s: under half of its 6 g left at 10 min)`, `${left.toFixed(2)} g left`)
	}
}

// ---------------------------------------------------------------- the hot plate's thermostat: its band at any time-lapse
groups.thermostat = () => {
	for (const [tl, sp] of [[60, 300], [600, 300], [3000, 300], [30000, 300], [3000, 550]] as const) {
		const r = run([{ id: "hp", type: "hot-plate", x: 1.2, y: 0, props: { power_w: 1500, setpoint_c: sp } }], { lapse: tl, seconds: 10 })
		const T = series(r, "hp", "temp")
		const top = Math.max(...T)
		const late = T.slice(Math.floor(T.length / 2))
		// (it never passes the band's top; it may cool a few kelvin under the band's bottom within one sub-step before it switches back on)
		check(top <= sp + 5.01 && Math.min(...late) >= sp - 10, `an empty 1500 W hot plate set to ${sp} °C never passes its setpoint + 5 K at time-lapse ${tl} [SPEC: ±5 K]`, `${Math.min(...late).toFixed(1)}-${top.toFixed(1)} °C`)
	}
}

// ---------------------------------------------------------------- no air: radiation and contact only
groups.vacuum = () => {
	const earth = run(saltScene(), { lapse: 600, seconds: 14 })
	const space = run(saltScene(), { lapse: 600, seconds: 20, settings: { gravity: "moon", air: false } })
	const a = meltS(earth, "plain")
	const b = meltS(space, "plain")
	check(a !== null && (b === null || b > 1.3 * a), "without air (settings.air false) a cube on a plate melts far slower: no convection, only radiation and contact", `${((a ?? NaN) / 60).toFixed(1)} min with air, ${b === null ? "not melted in 3.3 h" : `${(b / 60).toFixed(1)} min`} without`)
	const cup = (air: boolean) => run([{ id: "cup", type: "drink-cup", x: 1.2, y: 0, props: { style: "paper", water_temp_c: 80 } }], { lapse: 120, seconds: 10, settings: { air } })
	const vac = cup(false)
	check(endOf(vac, "cup", "boiled_g") === 0, "nothing evaporates from an open cup without air (no air to carry the vapour: evaporation is not modelled in a vacuum)", `${endOf(vac, "cup", "boiled_g").toFixed(3)} g`)
	check(endOf(vac, "cup", "water_temp") > endOf(cup(true), "cup", "water_temp"), "an open hot cup without air keeps warmer than one in air")
}

// ---------------------------------------------------------------- thermometers and spoons through lids
groups.lids = () => {
	// a pot with its lid on, a thermometer in it: the lid has a hole for it, so nothing is shoved, the bulb stays in the water and reads it
	const pot = (lid: boolean) =>
		run(
			[
				{ id: "hp", type: "hot-plate", x: 1.2, y: 0, props: { power_w: 1000, setpoint_c: 400 } },
				{ id: "pot", type: "saucepan", x: 1.2, y: 0.0865, props: { water_ml: 1000, lid } },
				{ id: "therm", type: "thermometer", x: 1.2, y: 0.11, props: { style: "digital" }, fixed: true }
			],
			{ lapse: 150, seconds: 12, goals: [{ kind: "reaches", item: "therm", at_least_c: 99 }, { kind: "boils", item: "pot" }] }
		)
	const rl = pot(true)
	check(!rl.warnings.some((w) => /shoved/.test(w)), "a thermometer through a saucepan's lid: no warning that the pan is shoved out", rl.warnings.join("; ") || "no warnings")
	const wet = series(rl, "therm", "in_water")
	check(wet.length > 0 && wet.every((v) => v === 1), "its bulb stays in the water all the run")
	const tw = when(rl, "pot", "boiling", (v) => v >= 1)
	const tt = when(rl, "therm", "reading", (v) => v >= 99)
	check(tw !== null && tt !== null && Math.abs(tt - tw) < 120, "it reads 99 °C when the water boils (lid on)", `${((tt ?? NaN) / 60).toFixed(1)} vs ${((tw ?? NaN) / 60).toFixed(1)} min`)
	check(rl.doc.solids.filter((s) => /^pot\/lid/.test(s.id)).length >= 2, "the lid is cut where the thermometer goes through it (two pieces or more)")
	// a cup with a lid and a glass thermometer: it reads the 40 °C water
	const rc = run(
		[
			{ id: "cup", type: "drink-cup", x: 1.2, y: 0, props: { style: "foam", water_temp_c: 40, lid: true } },
			{ id: "therm", type: "thermometer", x: 1.2, y: 0.02, fixed: true }
		],
		{ lapse: 30, seconds: 6 }
	)
	check(!rc.warnings.some((w) => /shoved/.test(w)) && endOf(rc, "therm", "reading") > 38, "a thermometer through a foam cup's lid reads its 40 °C water", `${endOf(rc, "therm", "reading").toFixed(1)} °C`)
	// a reaches goal on a thermometer whose bulb leaves the water it started in is not met, and says so (left_water): a shallow pan boils dry
	// and the probe, resting on its floor, then reads the hot floor past 100 °C
	const rd = run(
		[
			{ id: "hp", type: "hot-plate", x: 1.2, y: 0, props: { power_w: 1000, setpoint_c: 400 } },
			{ id: "pot", type: "saucepan", x: 1.2, y: 0.0865, props: { water_ml: 150, water_temp_c: 30 } },
			{ id: "therm", type: "thermometer", x: 1.2, y: 0.092, props: { style: "digital" }, fixed: true }
		],
		{ lapse: 150, seconds: 16, goals: [{ kind: "reaches", item: "therm", at_least_c: 105 }] }
	)
	const g = sim.summarize(rd.scene, rd.doc, rd.track).goals?.[0] ?? {}
	const w2 = series(rd, "therm", "in_water")
	const leaves = w2[0] === 1 && w2.some((v) => v === 0)
	check(leaves && g.left_water === true && g.ok === false, "a thermometer whose water boils away reads the pan's floor: `reaches` 105 °C is not met but said (left_water)", `in water ${w2[0]} → ${w2.at(-1)}, reads ${endOf(rd, "therm", "reading").toFixed(0)} °C, goal ok ${String(g.ok)}, left_water ${String(g.left_water)}`)
}

// ---------------------------------------------------------------- lids on cups: foam insulates; a lid stops the evaporation
groups.cups = () => {
	const styles = ["foam", "paper", "plastic", "glass", "steel", "mug", "flask"]
	const end: Record<string, Record<string, number>> = { open: {}, lid: {} }
	for (const lid of [false, true]) {
		const r = run(
			styles.map((s, i) => ({ id: s, type: "drink-cup", x: 0.2 + i * 0.4, y: 0, props: { style: s, lid, water_ml: 200, water_temp_c: 80 } })),
			{ lapse: 180, seconds: 10, room: 20 }
		)
		for (const s of styles) (end[lid ? "lid" : "open"] as Record<string, number>)[s] = endOf(r, s, "water_temp")
	}
	const o = end.open as Record<string, number>
	const l = end.lid as Record<string, number>
	check((l.foam as number) >= (l.steel as number) && (l.flask as number) > (l.foam as number), "with lids, after 30 min: a flask, then foam, warmer than a steel tumbler (foam's wall insulates; steel's adds nothing) [INC]", styles.map((s) => `${s} ${(l[s] as number).toFixed(1)}`).join(", "))
	// the lid saves a third to a half of an open cup's cooling (the evaporation it stops [ASHRAE]); for every open style alike (within 20-60 %)
	const saved = styles.filter((s) => s !== "flask").map((s) => [s, ((l[s] as number) - (o[s] as number)) / (80 - (o[s] as number))] as const)
	check(saved.every(([, f]) => f >= 0.2 && f <= 0.6), "a lid saves 20-60 % of an open cup's cooling, whatever the cup (the evaporation it stops: a third to a half [ASHRAE])", saved.map(([s, f]) => `${s} ${(f * 100).toFixed(0)} %`).join(", "))
	check(Object.values(o).every((v) => v > 30 && v < 70), "open cups after 30 min from 80 °C in a 20 °C room: 30-70 °C (a hot drink cools 80 → 50 °C in 20-60 min)", styles.map((s) => `${s} ${(o[s] as number).toFixed(1)}`).join(", "))
}

const order = ["level", "clock", "thermostat", "vacuum", "lids", "cups"]
for (const g of want === "all" ? order : want.split(",")) {
	console.log(`# ${g}`)
	groups[g]?.()
}
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
