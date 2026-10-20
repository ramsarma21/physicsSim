// PLACES' AIR + SPACE-SCENE WARNINGS validation (2026-10-20 repairs of the space module and the framework's settings):
//   air      settings.air_density (kg/m³, with air on: machines/items.py settings_of, web/sim/items.js, tooling/src/sim/plugins.ts RunSettings
//            .airDensity, physics.ts airDensity): a world's own air for the engine's drag and buoyancy, against quadratic drag's closed form
//            t = m_eff/√(k·W)·acosh(e^{h·k/m_eff}) (W the weight less the buoyancy, m_eff with the carried air, k = ½ρC_d·A):
//            Mars's thin surface air 0.020 kg/m³ [NASA Mars fact sheet: "Surface density: ~0.020 kg/m3"], Venus's thick 65 kg/m³
//            [NASA Venus fact sheet: "~65 kg/m3"], Jupiter's 0.16 kg/m³ at the 1-bar level [NASA Jupiter fact sheet]. A craft feather (1 g,
//            15 × 4 cm, falling flat) and a golf ball from 2 m on Mars: the feather lands after the ball (it no longer lands with it, as it did
//            with Mars's air off); on Venus the feather (42 kg/m³) is lighter than the air and rises at its terminal speed √((ρV − m)g/k).
//   doc      the standard air (1.2) writes no doc.settings.airDensity (old scenes are byte-identical), air off writes none, odd values are
//            refused by both builders with the same words, and the engine refuses an airDensity out of 0.001…100
//   warn     a space scene (orbit mode) with an ordinary moving thing (a steel ball on the table) warns once for it, naming the body it drifts
//            toward (items.py WARNING_HOOKS, mod_space.py _space_warnings), the same in Python and JS; the module's demo scenes warn nothing
//   words    the AI's words: the setting's change ("air density 1.2 → 0.02 kg/m³ (Mars's thin air)"), the bodies as proper nouns ("the Earth",
//            "Mars"), the edit digest's line for a floating thing, and the edit prompt's rule for a speed change (orbit_factor, not the
//            primary's mass)
//   node --no-warnings research/rw-validate-space-air.ts [air|doc|warn|words|all]
import "../tools/engine-math-node.mjs"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
type P = { x: number; y: number; angle: number }
type Track = { frames: { t: number; placements: Record<string, P> }[]; impacts: { t: number; a: string; b: string; speed: number }[] }
type Doc = { solids: { id: string; item: string; kind: string; body: Record<string, number | string> }[]; settings?: Record<string, unknown>; processes?: { kind: string }[] }
type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; held?: boolean; fixed?: boolean; name?: string }
const sim = (await import(`${PG}/web/sim/index.js`)) as {
	prepare: (s: unknown) => { scene: { items: Item[] }; doc: Doc; resolved: Record<string, Record<string, number>> }
	finish: (s: unknown, d: unknown, r: unknown, t: unknown) => { summary: { goals: { ok: boolean; label: string }[] }; warnings: { items: string[]; text: string }[] }
	layout: (s: unknown) => { doc: Doc; warnings: { items: string[]; text: string }[] }
	clean: (s: unknown) => unknown
}
const plugins = (await import(`${PG}/web/sim/plugins.js`)) as {
	settingWords: (k: string, a: unknown, b: unknown) => string | null
	properName: (n: string) => string | null
	digestLines: (item: unknown, run: unknown) => string[]
	promptSnippets: (step: string) => string
}
const fixer = (await import(`${PG}/web/ai/fixer.js`)) as { theName: (it: unknown) => string }
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: unknown } }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: unknown, fps: number) => Track }
const { settingsProblem } = (await import(`${PG}/tooling/src/sim/plugins.ts`)) as { settingsProblem: (s: unknown) => string | undefined }

const which = process.argv[2] ?? "all"
let pass = 0
let fail = 0
const check = (name: string, got: number, want: number, tol: number, unit = "") => {
	const err = Math.abs(got - want) / Math.abs(want)
	const ok = err <= tol
	ok ? pass++ : fail++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${got.toPrecision(6)}${unit} vs ${want.toPrecision(6)}${unit} (${(err * 100).toFixed(3)} %, tol ${(tol * 100).toFixed(2)} %)`)
}
const truth = (name: string, ok: boolean, detail = "") => {
	ok ? pass++ : fail++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`)
}
const STAGE = { x0: -0.6, x1: 3.4, y0: -0.2, y1: 3.0 }
const RELEASE = 0.5
const scene = (items: Item[], o: { seconds?: number; settings?: Record<string, unknown>; goals?: unknown[] } = {}) => ({
	version: 2, id: "rwair", name: "rw air", seconds: o.seconds ?? 3, release: RELEASE, stage: STAGE,
	items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals: o.goals ?? [], ...(o.settings ? { settings: o.settings } : {})
})
const run = (items: Item[], o: { seconds?: number; settings?: Record<string, unknown>; goals?: unknown[] } = {}) => {
	const sc = scene(items, o)
	const { scene: s, doc, resolved } = sim.prepare(sc)
	const track = simulate(admitDocument(doc).scene, 480)
	return { doc, resolved, track, meta: sim.finish(s, doc, resolved, track) }
}
/** The first impact of an item's solids with the table (s after the release). */
const landing = (r: ReturnType<typeof run>, item: string) => {
	const h = r.track.impacts.find((x) => (x.a.startsWith(`${item}/`) && x.b.startsWith("table/")) || (x.b.startsWith(`${item}/`) && x.a.startsWith("table/")))
	return h === undefined ? NaN : h.t - RELEASE
}
/** Quadratic drag from rest: the time to fall h (m) with net weight W (N), inertia m_eff (kg), drag F = k·v². */
const dragFall = (h: number, W: number, meff: number, k: number) => (meff / Math.sqrt(k * W)) * Math.acosh(Math.exp((h * k) / meff))
const BOX_DRAG = 1.05 // physics.ts: a slab's sides meet ½ρ·1.05·depth·(width across)·v²
const SPHERE_DRAG = 0.47 // physics.ts: a sphere's disc

// ---------------------------------------------------------------- the air of other worlds
if (which === "all" || which === "air") {
	console.log("\n== air: Mars's thin air, Venus's thick air, Jupiter's at 1 bar (settings.air_density)")
	// a craft feather (mechanics: 1 g, 15 cm × 4 mm × 4 cm, falling flat: 15 cm across the flow, 4 cm deep) and a golf ball from 2 m
	const feather = (y: number): Item => ({ id: "feather", type: "feather", x: 1.0, y, held: true, props: { kind: "craft" } })
	const golf: Item = { id: "ball", type: "golf-ball", x: 1.7, y: 2.0 + 0.02135, held: true }
	const featherFall = (rho: number, g: number) => {
		const L = 0.15, t = 0.004, w = 0.04, m = 0.001
		const V = L * t * w
		return dragFall(2.0, (m - rho * V) * g, m, 0.5 * rho * BOX_DRAG * w * L)
	}
	const golfFall = (rho: number, g: number) => {
		const r = 0.0427 / 2, m = 0.0459
		const V = (4 / 3) * Math.PI * r ** 3
		return dragFall(2.0, (m - rho * V) * g, m + rho * 0.5 * V, 0.5 * rho * SPHERE_DRAG * Math.PI * r * r)
	}
	const mars = run([feather(2.0 + 0.002), golf], { seconds: 2.5, settings: { gravity: "mars", air_density: 0.02 }, goals: [{ kind: "lands_first", a: "ball", b: "feather" }, { kind: "lands_together", a: "ball", b: "feather" }] })
	truth("Mars: doc.settings carries Mars's air", isDeepStrictEqual(mars.doc.settings, { gravity: 3.71, airDensity: 0.02 }), JSON.stringify(mars.doc.settings))
	check("Mars (0.020 kg/m³): a craft feather falls 2 m (quadratic drag, flat plate)", landing(mars, "feather"), featherFall(0.02, 3.71), 0.01, " s")
	check("Mars (0.020 kg/m³): a golf ball falls 2 m", landing(mars, "ball"), golfFall(0.02, 3.71), 0.005, " s")
	truth("Mars: the ball lands first (goal lands_first)", mars.meta.summary.goals[0]?.ok === true, `ball ${landing(mars, "ball").toFixed(3)} s, feather ${landing(mars, "feather").toFixed(3)} s`)
	truth("Mars: they no longer land together (goal lands_together false)", mars.meta.summary.goals[1]?.ok === false, mars.meta.summary.goals[1]?.label)
	const marsVac = run([feather(2.0 + 0.002), golf], { seconds: 2.5, settings: { gravity: "mars", air: false }, goals: [{ kind: "lands_together", a: "ball", b: "feather" }] })
	check("Mars with the air off: the feather falls 2 m at √(2h/g)", landing(marsVac, "feather"), Math.sqrt((2 * 2.0) / 3.71), 0.005, " s")
	truth("Mars with the air off: they land together", marsVac.meta.summary.goals[0]?.ok === true)
	const earth = run([feather(2.0 + 0.002), golf], { seconds: 3.5 })
	check("Earth (1.2 kg/m³): the craft feather falls 2 m", landing(earth, "feather"), featherFall(1.2, 9.81), 0.01, " s")
	// the feather's terminal speed √(W/k) (its weight less its buoyancy): on Earth it reaches it within the 2 m (measured from its track just before
	// it lands); Mars's is about 4.8 × Earth's (√(g_M·ρ_E / (g_E·ρ_M)) with the buoyancy), so it never nears it in 2 m: the delay stays small
	const vt = (rho: number, g: number) => Math.sqrt(((0.001 - rho * 2.4e-5) * g) / (0.5 * rho * BOX_DRAG * 0.006))
	{
		const fr = earth.track.frames
		const tl = landing(earth, "feather") + RELEASE
		const a = fr.findLast((f) => f.t <= tl - 0.15)
		const b = fr.findLast((f) => f.t <= tl - 0.05)
		const v = a && b ? (a.placements["feather/feather"].y - b.placements["feather/feather"].y) / (b.t - a.t) : NaN
		check("Earth: the craft feather falls at its terminal speed √(W/k) before it lands", v, vt(1.2, 9.81), 0.01, " m/s")
		truth("Mars: its terminal speed is about 4.8 × Earth's (√(g ρ_E / g_E ρ)), about twice the 3.9 m/s a 2 m fall reaches", vt(0.02, 3.71) / vt(1.2, 9.81) > 4.7 && vt(0.02, 3.71) > 1.9 * Math.sqrt(2 * 3.71 * 2), `${vt(0.02, 3.71).toFixed(2)} m/s vs ${vt(1.2, 9.81).toFixed(2)} m/s`)
	}
	// Venus: 65 kg/m³ (and 8.87 m/s²): the golf ball against the closed form; the 42 kg/m³ feather is lighter than the air: it rises
	const venus = run([feather(1.0), { ...golf }], { seconds: 3.0, settings: { gravity: 8.87, air_density: 65 } })
	check("Venus (65 kg/m³): a golf ball falls 2 m (drag, buoyancy, carried air)", landing(venus, "ball"), golfFall(65, 8.87), 0.01, " s")
	{
		const fr = venus.track.frames
		const y = (f: (typeof fr)[number]) => f.placements["feather/feather"]?.y ?? NaN
		const a = fr.find((f) => f.t >= 2.0)
		const b = fr.find((f) => f.t >= 3.0) ?? fr[fr.length - 1]
		const up = a && b ? (y(b) - y(a)) / (b.t - a.t) : NaN
		const want = Math.sqrt(((65 * 2.4e-5 - 0.001) * 8.87) / (0.5 * 65 * BOX_DRAG * 0.006))
		truth("Venus: the craft feather (42 kg/m³) is lighter than the air and rises", y(fr[fr.length - 1]) > 1.0 + 0.2, `from 1.0 m to ${y(fr[fr.length - 1]).toFixed(3)} m`)
		check("Venus: it rises at its terminal speed √((ρV − m)g/k)", up, want, 0.02, " m/s")
	}
	// Jupiter's cloud tops (1 bar): 0.16 kg/m³ at 24.79 m/s²: a ping-pong ball from 1 m (hollow: buoyancy of its shell, the air inside carried)
	{
		const r = run([{ id: "pp", type: "ping-pong-ball", x: 1.0, y: 1.0 + 0.02, held: true }], { seconds: 1.5, settings: { gravity: "jupiter", air_density: 0.16 } })
		const P0 = r.resolved["pp"] as { mass: number; diameter: number; wall: number }
		const rad = P0.diameter / 2, rin = rad - P0.wall, rho = 0.16
		const W = (P0.mass - rho * (4 / 3) * Math.PI * (rad ** 3 - rin ** 3)) * 24.79
		const meff = P0.mass + rho * (4 / 3) * Math.PI * (rin ** 3 + 0.5 * rad ** 3)
		check("Jupiter (0.16 kg/m³, 24.79 m/s²): a ping-pong ball falls 1 m", landing(r, "pp"), dragFall(1.0, W, meff, 0.5 * rho * SPHERE_DRAG * Math.PI * rad * rad), 0.01, " s")
	}
}

// ---------------------------------------------------------------- the document and the refusals
if (which === "all" || which === "doc") {
	console.log("\n== doc: what the builders write and refuse, Python and JS alike")
	const cases: [string, Record<string, unknown>][] = [
		["the standard 1.2", { air_density: 1.2 }], ["Mars", { gravity: "mars", air_density: 0.02 }], ["air off with a density", { air: false, air_density: 0.02 }],
		["the limits", { air_density: 0.001 }], ["100", { air_density: 100 }], ["0 (refused)", { air_density: 0 }], ["101 (refused)", { air_density: 101 }],
		["a string (refused)", { air_density: "0.02" }], ["true (refused)", { air_density: true }]
	]
	const scenes = cases.map(([, st]) => sim.clean(scene([{ id: "b", type: "golf-ball", x: 1.0, y: 0.5, held: true }], { settings: st })))
	const py = JSON.parse(execFileSync("python3", [`${PG}/tools/space/py_space.py`], { input: JSON.stringify({ scenes: scenes.map((s) => ({ scene: s })), types: [] }) }).toString()) as { results: { doc?: Doc; error?: string }[] }
	cases.forEach(([name], i) => {
		let js: { doc?: Doc; error?: string }
		try {
			js = { doc: sim.layout(scenes[i]).doc }
		} catch (e) {
			js = { error: String((e as Error).message) }
		}
		const P = py.results[i]
		const same = P.error !== undefined ? js.error !== undefined && js.error.endsWith(P.error) : isDeepStrictEqual(P.doc?.settings, js.doc?.settings)
		truth(`settings ${name}: Python and JS agree`, same, P.error ?? JSON.stringify(P.doc?.settings ?? null))
	})
	truth("the standard air density writes no settings", py.results[0].doc?.settings === undefined)
	truth("air off writes no density", isDeepStrictEqual(py.results[2].doc?.settings, { air: false }))
	truth("the engine refuses an airDensity out of 0.001…100", settingsProblem({ airDensity: 0 }) !== undefined && settingsProblem({ airDensity: 200 }) !== undefined && settingsProblem({ airDensity: 0.02 }) === undefined)
}

// ---------------------------------------------------------------- warnings in a space scene
if (which === "all" || which === "warn") {
	console.log("\n== warn: an ordinary moving thing in a space scene")
	const dir = "/private/tmp/claude-501/-Users-ramsarma-Downloads-science-map-share/cb014d17-1cd6-4220-a508-cf6ce5539a35/scratchpad/engine4/space/scenes"
	const base = JSON.parse(readFileSync(`${dir}/earth-moon-phases.json`, "utf8"))
	const withBall = structuredClone(base)
	withBall.items.push({ id: "ball", type: "steel-ball", x: 2.5, y: 0.0127, props: {} }, { id: "blk", type: "wooden-block", x: 2.8, y: 0.3, props: {} })
	const lay = sim.layout(sim.clean(withBall))
	const mine = lay.warnings.filter((w) => /space scene/.test(w.text))
	truth("the steel ball on the table warns once, naming the Earth it drifts toward", mine.some((w) => w.items[0] === "ball" && /drifts toward Earth/.test(w.text)), mine.map((w) => w.text).join(" | "))
	truth("one warning per ordinary moving item", new Set(mine.map((w) => w.items[0])).size === mine.length)
	const all = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "zoo.json").map((f) => [f, JSON.parse(readFileSync(`${dir}/${f}`, "utf8"))] as const)
	const noisy = all.filter(([, s]) => sim.layout(sim.clean(s)).warnings.some((w) => /space scene/.test(w.text))).map(([f]) => f)
	truth("the module's demo scenes warn nothing", noisy.length === 0, noisy.join(", ") || `${all.length} scenes`)
	const scenes = [withBall, base, ...all.map(([, s]) => s)].map((s) => sim.clean(s))
	const py = JSON.parse(execFileSync("python3", [`${PG}/tools/space/py_space.py`], { input: JSON.stringify({ scenes: scenes.map((s) => ({ scene: s })), types: [] }) }).toString()) as { results: { warnings?: unknown }[] }
	const same = scenes.every((s, i) => isDeepStrictEqual(py.results[i].warnings, sim.layout(s).warnings))
	truth("Python and JS give the same warnings", same, `${scenes.length} scenes`)
	// the run: it does drift (the engine's bodies pull it), and the edit digest says so
	const { scene: s, doc, resolved } = sim.prepare(withBall)
	const track = simulate(admitDocument(doc).scene, 60)
	const meta = sim.finish(s, doc, resolved, track)
	const p0 = track.frames[0].placements["ball/ball"]
	const p1 = track.frames[track.frames.length - 1].placements["ball/ball"]
	truth("the run's warnings carry it too", meta.warnings.some((w) => w.items[0] === "ball" && /space scene/.test(w.text)))
	truth("in the run it drifts off the table toward the Earth model", Math.hypot(p1.x - 1.6, p1.y - 1.45) < Math.hypot(p0.x - 1.6, p0.y - 1.45) - 0.3, `(${p0.x.toFixed(2)}, ${p0.y.toFixed(2)}) → (${p1.x.toFixed(2)}, ${p1.y.toFixed(2)})`)
	const dl = plugins.digestLines(s.items.find((i) => i.id === "ball"), { doc, track, scene: s })
	truth("the edit digest says it floats and drifts toward Earth", dl.some((l) => /^floats: .*drifts toward Earth/.test(l)), dl.join(" | "))
}

// ---------------------------------------------------------------- the AI's words
if (which === "all" || which === "words") {
	console.log("\n== words: the AI layer")
	const w = plugins.settingWords("air_density", undefined, 0.02)
	truth("a change of air density in real units", w === "air density 1.2 → 0.02 kg/m³ (Mars's thin air)", String(w))
	truth("the bodies are proper nouns", plugins.properName("earth") === "the Earth" && plugins.properName("Moon") === "the Moon" && plugins.properName("Mars") === "Mars" && plugins.properName("ball") === null)
	truth("the change cards name them so", fixer.theName({ id: "earth", type: "planet", name: "Earth" }) === "the Earth" && fixer.theName({ id: "m", type: "planet", name: "Mars" }) === "Mars" && fixer.theName({ id: "b", type: "steel-ball", name: "Steel ball" }) === "the steel ball")
	const edit = plugins.promptSnippets("edit")
	truth("the edit prompt: a speed change is the body's orbit_factor, never the primary's mass", /THAT body's orbit_factor/.test(edit) && /never its primary's mass_scale/.test(edit) && /keep the same orbit/.test(edit) && /goal escapes/.test(edit))
	const plan = plugins.promptSnippets("plan")
	truth("the plan prompt gives Mars its thin air, not a vacuum", /Mars 0\.02 \(thin\)/.test(plan) && !/false on the Moon, Mars/.test(plan))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
