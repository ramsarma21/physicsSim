// The space module (machines/mod_space.py, web/sim/modules/space.js, tooling/src/sim/modules/space.ts), end to end. Checks:
//   catalog   its types (props, links, readouts, module) are the same in machines/items.py and web/sim
//   build     random scenes of its items (random props in and at their ranges, links that name bodies, nothing or the wrong type, other
//             items, settings): items.py == web/sim, document, resolved props, warnings and refusals, key for key
//   engine    the server's engine (research/poc/worker.ts: node, the bundle's math) == the browser bundle (web/sim/engine-worker.js),
//             the track's JSON text byte for byte, readings and events included
//   summary   items.py summarize == web/sim summarize on those tracks, with every goal kind of the module (random fields)
//   plugins   the AI's registry: goal kinds and aliases, knobs, prompt snippets, digest lines, change words, checkModuleGoal == summarize
//   physics   a few outcomes (the validator research/rw-validate-space.ts has the full set)
//   node tools/space/test.mjs [--n 60] [--seed 7]
import { execFileSync, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const argv = process.argv.slice(2)
const opt = (k, d) => (argv.includes(k) ? Number(argv[argv.indexOf(k) + 1]) : d)
const N = opt("--n", 60)
let seed = opt("--seed", 7)
const rnd = () => {
	// mulberry32
	seed |= 0
	seed = (seed + 0x6d2b79f5) | 0
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
let failed = 0
let passed = 0
const ok = (cond, what, detail = "") => {
	if (cond) passed++
	else failed++
	if (!cond || process.env.VERBOSE) console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
}

await import(pathToFileURL(join(PG, "tools/engine-math-node.mjs")).href)
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
await import(pathToFileURL(join(PG, "web/sim/modules/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const space = await import(pathToFileURL(join(PG, "web/sim/modules/space.js")).href)
const TYPES = ["sun", "planet", "moon", "satellite", "rock-hammer", "gnomon", "globe", "moon-ball"]
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_space.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30 }).toString())

// ---- catalog
const cat = sim.catalog()
const P0 = py({ scenes: [], types: TYPES })
for (const t of P0.types) {
	const { preview, ...js } = cat.types.find((x) => x.key === t.key) ?? {}
	ok(isDeepStrictEqual(t, js), `catalog entry ${t.key}: items.py == web/sim`)
}
ok(cat.categories.includes("Space"), "the Space category is listed")

// ---- random scenes
const spec = (key) => cat.types.find((t) => t.key === key)
const randomProps = (key) => {
	const t = spec(key)
	const props = {}
	for (const p of t.props) {
		if (rnd() < 0.55) continue
		if (p.kind === "choice") props[p.key] = pick(p.choices)
		else if (p.kind === "bool") props[p.key] = rnd() < 0.5
		else {
			const lo = p.min ?? 0
			const hi = p.key === "km_per_m" ? pick([1e4, 3e5, 1.5e8, 1e10]) : p.key === "hours_per_s" ? pick([0.01, 0.5, 48, 960, 100000]) : (p.max ?? 1)
			const r = rnd()
			props[p.key] = r < 0.1 ? lo : r < 0.2 ? hi : Number((lo + rnd() * (hi - lo)).toPrecision(6))
		}
	}
	return props
}
const STAGE = { x0: -0.6, x1: 3.4, y0: -0.2, y1: 3.0 }
const LIGHTS = ["lamp", "flashlight", "sunlight"].filter((t) => spec(t))
/** A classroom scene: a light (or none, or two), globes, moon balls round them or round their own place, random props and links. */
const makeClassroom = (k) => {
	const items = [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }]
	const ids = []
	const lights = []
	const nl = rnd() < 0.15 ? 0 : rnd() < 0.8 ? 1 : 2
	for (let i = 0; i < nl && LIGHTS.length; i++) {
		const type = pick(LIGHTS)
		const id = `${type}${i}`
		const props = randomProps(type)
		delete props.target
		items.push({ id, type, x: Number((rnd() * 0.6 - 0.2).toFixed(4)), y: type === "sunlight" ? 0.5 : type === "flashlight" ? 0.4 : 0, ...(type === "flashlight" ? { fixed: rnd() < 0.5 } : {}), props })
		lights.push(id)
	}
	const globes = []
	const n = 1 + Math.floor(rnd() * 3)
	for (let i = 0; i < n; i++) {
		const type = rnd() < 0.55 ? "globe" : "moon-ball"
		const id = `${type}${i}`
		const props = randomProps(type)
		if (type === "moon-ball") {
			if (rnd() < 0.7 && globes.length) props.around = pick(globes)
			else if (rnd() < 0.2) props.around = pick(["nobody", id, ...lights])
		}
		if (rnd() < 0.4) props.lit_by = rnd() < 0.8 && lights.length ? pick(lights) : pick(["nobody", "table", id])
		const x = Number((0.9 + rnd() * 1.6).toFixed(4))
		items.push({ id, type, x, y: type === "globe" ? 0 : Number((0.2 + rnd() * 0.6).toFixed(4)), props })
		if (type === "globe") globes.push(id)
		ids.push(id)
	}
	const goals = []
	const kinds = plugins.modules().find((m) => m.name === "mod_space").goals
	for (let g = 0; g < 5; g++) {
		const goal = pick(kinds).sample({ items }, pick)
		if (goal) goals.push(goal)
	}
	return { version: 2, id: `classroom${k}`, name: `classroom ${k}`, seconds: Number((1 + rnd() * 3).toFixed(2)), release: pick([0, 0.5]), stage: STAGE, items, goals }
}
const makeScene = (k) => {
	const items = [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }]
	const n = 1 + Math.floor(rnd() * 5)
	const ids = []
	const cx = 0.6 + rnd() * 1.8
	const cy = 1.0 + rnd() * 1.0
	for (let i = 0; i < n; i++) {
		const type = pick(["sun", "planet", "planet", "moon", "moon", "satellite", "satellite", "rock-hammer", "gnomon", "globe", "moon-ball"])
		const id = `${type}${i}`
		const props = randomProps(type)
		if (["planet", "moon", "satellite"].includes(type) && rnd() < 0.7) props.primary = rnd() < 0.8 && ids.length ? pick(ids) : pick(["nobody", id, "table"])
		const r = i === 0 ? 0 : 0.15 + rnd() * 0.9
		const a = rnd() * 2 * Math.PI
		items.push({ id, type, x: Number((cx + r * Math.cos(a)).toFixed(4)), y: Number((cy + r * Math.sin(a)).toFixed(4)), angle: type === "rock-hammer" ? pick([0, 30, -90]) : 0, props, ...(rnd() < 0.1 ? { fixed: true } : {}), ...(rnd() < 0.15 ? { held: true } : {}) })
		ids.push(id)
	}
	if (rnd() < 0.3) items.push({ id: "ball", type: pick(["golf-ball", "steel-ball", "ping-pong-ball"]), x: cx + 0.3, y: cy + 0.3, props: {} })
	const goals = []
	const kinds = plugins.modules().find((m) => m.name === "mod_space").goals
	for (let g = 0; g < 4; g++) {
		const kind = pick(kinds)
		const goal = kind.sample({ items }, pick)
		if (goal) goals.push(goal)
	}
	const settings = rnd() < 0.3 ? { gravity: pick(["moon", "mars", "earth", 3.7, "none"]), air: rnd() < 0.5, ...(rnd() < 0.5 ? { time_lapse: pick([60, 3600, 86400]) } : {}) } : undefined
	return { version: 2, id: `space${k}`, name: `space ${k}`, seconds: Number((1.5 + rnd() * 3).toFixed(2)), release: pick([0, 0.2, 0.5]), stage: STAGE, items, goals, ...(settings ? { settings } : {}) }
}
const scenes = Array.from({ length: N }, (_, k) => makeScene(k)).concat(Array.from({ length: Math.ceil(N / 2) }, (_, k) => makeClassroom(k)))
// the demo scenes too
const demo = [
	{ version: 2, id: "em", name: "Earth and Moon", seconds: 14.5, release: 0.5, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "earth", type: "planet", x: 0.9, y: 1.45 }, { id: "moon", type: "moon", x: 2.18133, y: 1.45, props: { primary: "earth" } }], goals: [{ kind: "orbits", item: "moon", around: "earth" }] },
	{ version: 2, id: "sem", name: "Sun Earth Moon", seconds: 14.5, release: 0.5, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "sun", type: "sun", x: -0.35, y: 1.45, props: { pulls: false, diameter: 0.3 } }, { id: "earth", type: "planet", x: 0.9, y: 1.45 }, { id: "moon", type: "moon", x: 2.18133, y: 1.45, props: { primary: "earth" } }], goals: [{ kind: "phase", item: "moon", name: "new moon", any: true }, { kind: "phase", item: "moon", name: "full", at_s: 0.4 }, { kind: "orbits", item: "moon" }] }
]
const all = scenes.concat(demo)
const cleaned = all.map((s) => sim.clean(s))
const jsBuilt = cleaned.map((s) => {
	try {
		return sim.layout(s)
	} catch (e) {
		return { error: e.message }
	}
})
const pyBuilt = py({ scenes: cleaned.map((scene) => ({ scene })) }).results
let same = 0
cleaned.forEach((s, i) => {
	const J = jsBuilt[i]
	const P = pyBuilt[i]
	const good = J.error !== undefined ? P.error !== undefined && J.error === `can't build this scene: ${P.error}` : isDeepStrictEqual(P.doc, J.doc) && isDeepStrictEqual(P.resolved, J.resolved) && isDeepStrictEqual(P.warnings, J.warnings)
	if (good) same++
	else {
		ok(false, `build ${s.id}: items.py == web/sim`, J.error ?? P.error ?? "")
		if (process.env.VERBOSE) console.log(JSON.stringify(P).slice(0, 2000), "\n", JSON.stringify(J).slice(0, 2000))
	}
})
ok(same === cleaned.length, `build: ${same} of ${cleaned.length} scenes identical (document, resolved, warnings, refusals)`)

// ---- engine: the server's worker vs the bundle, byte for byte
const worker = spawn("node", ["--no-warnings", join(PG, "research/poc/worker.ts")], { stdio: ["pipe", "pipe", "inherit"] })
const lines = createInterface({ input: worker.stdout })
const waiting = new Map()
lines.on("line", (l) => {
	const [id, a, b] = l.split("\t")
	const w = waiting.get(Number(id))
	waiting.delete(Number(id))
	w?.(a === "error" ? { error: JSON.parse(b) } : { track: b })
})
let nextId = 1
const serverRun = (doc) =>
	new Promise((res) => {
		const id = nextId++
		waiting.set(id, res)
		worker.stdin.write(JSON.stringify({ id, doc, rate: 120 }) + "\n")
	})
const tracks = []
let engSame = 0
let engRuns = 0
for (let i = 0; i < cleaned.length; i++) {
	const J = jsBuilt[i]
	if (J.error !== undefined) {
		tracks.push(null)
		continue
	}
	const { doc } = sim.prepare(cleaned[i])
	const a = await serverRun(doc)
	let b
	try {
		b = { track: JSON.stringify(bundle.run(doc, 120)) }
	} catch (e) {
		b = { error: e.message }
	}
	engRuns++
	const good = a.error !== undefined ? b.error !== undefined && b.error.endsWith(a.error.split("\n").pop()) : a.track === b.track
	if (good) engSame++
	else ok(false, `engine ${cleaned[i].id}: worker.ts == bundle`, a.error ?? b.error ?? `${a.track?.length} vs ${b.track?.length}`)
	tracks.push(a.error === undefined ? JSON.parse(a.track) : null)
}
worker.stdin.end()
ok(engSame === engRuns, `engine: ${engSame} of ${engRuns} runs byte-identical (node worker vs browser bundle)`)

// ---- summary parity with every goal kind
const withTracks = cleaned.map((scene, i) => ({ scene, track: tracks[i] })).filter((x) => x.track)
const pyS = py({ scenes: withTracks }).results
let sumSame = 0
withTracks.forEach(({ scene, track }, i) => {
	const { scene: s, doc, resolved } = sim.prepare(scene)
	const meta = sim.finish(s, doc, resolved, track)
	const good = isDeepStrictEqual(pyS[i].summary, meta.summary)
	if (good) sumSame++
	else {
		ok(false, `summary ${scene.id}: items.py == web/sim`)
		if (process.env.VERBOSE) console.log(JSON.stringify(pyS[i].summary?.goals), "\n", JSON.stringify(meta.summary?.goals))
	}
})
ok(sumSame === withTracks.length, `summary: ${sumSame} of ${withTracks.length} runs identical (goals of every kind, stories, events)`)
const goalsSeen = new Set(withTracks.flatMap(({ scene }) => (scene.goals ?? []).map((g) => g.kind)))
ok(["orbits", "falls_in", "escapes", "lands_together", "lands_first", "phase", "shadow_length", "day_night", "eclipse", "solar_eclipse", "lunar_eclipse", "noon_sun", "night_sky"].every((k) => goalsSeen.has(k)), "every goal kind was exercised", [...goalsSeen].join(", "))

// ---- the demo scenes' outcomes and the AI's goal checks
const di = cleaned.length - demo.length
const emTrack = tracks[di]
const em = sim.finish(...Object.values(sim.prepare(cleaned[di])), emTrack)
ok(em.summary.goals[0]?.ok === true, "Earth-Moon: the Moon circles the Earth once", JSON.stringify(em.summary.goals[0]))
const d = emTrack.state.moon.distance
ok(Math.max(...d) / Math.min(...d) - 1 < 0.002, "Earth-Moon: the distance holds within 0.2 %", `${Math.min(...d).toFixed(4)}..${Math.max(...d).toFixed(4)} m`)
const semTrack = tracks[di + 1]
const sem = sim.finish(...Object.values(sim.prepare(cleaned[di + 1])), semTrack)
ok(sem.summary.goals[0]?.ok === true, "Sun-Earth-Moon: a new moon shows during the run", JSON.stringify(sem.summary.goals[0]))
ok(sem.summary.goals[1]?.ok === true, "Sun-Earth-Moon: a full moon at the start (the Earth between the Sun and the Moon)", JSON.stringify(sem.summary.goals[1]))
for (const [k, g] of sem.summary.goals.entries()) {
	const chk = plugins.checkModuleGoal(cleaned[di + 1].goals[k], { scene: cleaned[di + 1], doc: sim.prepare(cleaned[di + 1]).doc, track: semTrack })
	ok(chk.ok === g.ok, `the AI's check of goal ${k} (${g.kind}) agrees with the summary`)
}

// ---- plugins
const mod = plugins.modules().find((m) => m.name === "mod_space")
ok(!!mod, "mod_space is registered with the AI's plug-ins")
for (const k of ["orbits", "falls_in", "escapes", "lands_together", "lands_first", "phase", "day_night", "eclipse", "solar_eclipse", "lunar_eclipse", "noon_sun", "night_sky"]) ok(plugins.goalKind(k)?.kind === k, `goal kind ${k}`)
ok(plugins.goalKind("daytime")?.kind === "day_night" && plugins.goalKind("blood_moon")?.kind === "lunar_eclipse" && plugins.goalKind("sun_height")?.kind === "noon_sun", "the new aliases resolve")
ok(plugins.goalProblem({ kind: "eclipse", type: "lunar", item: "m" }, new Set(["m"])) === null && plugins.goalProblem({ kind: "eclipse", item: "m" }, new Set(["m"])) !== null && plugins.goalProblem({ kind: "eclipse", type: "lunar" }, new Set(["m"])) !== null, "an eclipse goal needs its type and names its moon")
ok(plugins.knobsFor("globe").some((k) => k.key === "start_hour") && plugins.knobsFor("moon-ball").some((k) => k.key === "tilt_deg") && plugins.knobsFor("moon").some((k) => k.key === "node_deg"), "knobs: the globe's clock, the ball's tilt, the Moon's nodes")
ok(/CLASSROOM/.test(plugins.howtoText()) && /ECLIPSES and SEASONS/.test(plugins.howtoText()) && /day_night/.test(plugins.promptSnippets("plan")), "the digest and the plan prompt get the classroom models and eclipses")
ok(plugins.changeWords("moon-ball", "start_deg", 0, 180, (x) => x) === "starts 0° → 180° round from the light (new moon → full moon)", "change words: the moon ball's start", plugins.changeWords("moon-ball", "start_deg", 0, 180, (x) => x))
ok(plugins.changeWords("globe", "lean", "toward the camera", "toward the light", (x) => x) === "north pole leans toward the camera → toward the light", "change words: the globe's lean")
ok(/no eclipses this month/.test(plugins.changeWords("moon", "node_deg", 0, 90, (x) => x) ?? ""), "change words: the Moon's nodes", plugins.changeWords("moon", "node_deg", 0, 90, (x) => x))
ok(plugins.goalKind("orbit")?.kind === "orbits" && plugins.goalKind("falls_together")?.kind === "lands_together" && plugins.goalKind("moon_phase")?.kind === "phase", "aliases resolve")
ok(plugins.goalProblem({ kind: "orbits", item: "moon" }, new Set(["moon"])) === null, "a plan's orbits goal validates")
ok(plugins.goalProblem({ kind: "lands_together", a: "x" }, new Set(["x"])) !== null, "a lands_together goal without b is refused")
ok(plugins.knobsFor("satellite").some((k) => k.key === "orbit_factor") && plugins.knobsFor("planet").some((k) => k.key === "mass_scale"), "knobs: orbit_factor, mass_scale")
ok(/orbit/i.test(plugins.promptSnippets("plan")) && /settings\.gravity/.test(plugins.promptSnippets("plan")), "the plan prompt gets the places and the orbit mode")
ok(/ORBIT MODE/.test(plugins.howtoText()), "the catalog digest gets the how-to")
const lines2 = plugins.digestLines({ id: "moon", type: "moon" }, { doc: sim.prepare(cleaned[di + 1]).doc, track: semTrack })
ok(lines2.some((l) => /phase as its planet sees it/.test(l)) && lines2.some((l) => /km real/.test(l)), "digest lines: real distance and the phase", lines2.join(" | "))
ok(plugins.changeWords("satellite", "orbit_factor", 1, 1.2, (x) => x) === "launch speed 1 → 1.2× orbit speed (an ellipse that swings out farther)", "change words: launch speed")
ok(plugins.changeWords("planet", "body", "earth", "mars", (x) => x) === "Earth → Mars", "change words: planet")
ok(space.placeWords("moon", false) === "the Moon (g 1.62 m/s², no air)", "place words", space.placeWords("moon", false))

console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
