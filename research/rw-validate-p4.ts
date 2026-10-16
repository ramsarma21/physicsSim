// Engine batch 2 validation (tooling/src/sim/physics.ts, 2026-10-15), with its repair after review: (1) no scene crashes the engine or runs
// for minutes, (2) restitution only on genuine impacts and no energy from the sub-steps, so a ball on a sprung pad never comes back higher than
// it fell from and an undamped spring never rings up, (3) stiff, light springs followed in sub-steps (periods and damping against theory over
// a fine scan of ω·h), (4) springs with mass (the fundamental mode's share and half the weight at the moving end, a uniform bar's consistent
// mass between two moving ends; the catalog keeps a spring's steel light against what it throws, where a lumped mass is true to a real coil),
// (5) strikes carried on through lasting contacts (a ball stacked on a ball, a Newton's cradle of touching balls).
// Each test builds scenes (the catalog ones through machines/items.py itself), runs them at 480 Hz with every step kept, and compares what the
// engine does with theory, with a 400-node model of the coil (a spring's mass as it really is, spread along it), or, where there is none in
// closed form, with the same engine stepping 10 times finer (a copy made in a temporary folder). Run:
//   node --no-warnings research/rw-validate-p4.ts [crash|energy|stiff|mass|impacts|all]
//   ENGINE_DIR=<a folder holding physics.ts and document.ts> runs the same scenes on another copy of the engine; MACHINES_DIR=<a folder holding
//   items.py and the catalog modules> builds the catalog's scenes with another copy of the builder.
//   FUZZ_N (default 5000) and FUZZ_JOBS (default 8): the crash fuzz's size (tools/parity/engine-fuzz.mjs, in that many processes).
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const DIR = process.env.ENGINE_DIR ?? `${PG}/tooling/src/sim`
const MACHINES = process.env.MACHINES_DIR ?? `${PG}/machines`
type P = { x: number; y: number; angle: number }
type Track = { frames: { t: number; placements: Record<string, P> }[]; impacts?: { t: number; a: string; b: string; speed: number }[] }
type Simulate = (scene: unknown, fps: number) => Track
const physics = (await import(`${DIR}/physics.ts`)) as { simulate: Simulate; SimulationError?: new (m: string) => Error }
const { simulate } = physics
const { admitDocument } = (await import(`${DIR}/document.ts`)) as { admitDocument: (doc: unknown) => { scene: unknown } }

/** The same engine stepping at `hz` instead of 480 Hz (a copy of its folder with STEP changed), run to a track at 480 frames a second. */
const fineEngine = async (hz: number) => {
	const root = mkdtempSync(path.join(tmpdir(), `p4-${hz}hz-`))
	process.on("exit", () => rmSync(root, { recursive: true, force: true }))
	mkdirSync(path.join(root, "src", "sim"), { recursive: true })
	for (const f of readdirSync(DIR).filter((f) => f.endsWith(".ts"))) {
		let text = readFileSync(path.join(DIR, f), "utf8")
		if (f === "physics.ts") {
			if (!text.includes("const STEP = 1 / 480\n")) throw new Error("physics.ts has no `const STEP = 1 / 480` to refine")
			text = text.replace("const STEP = 1 / 480\n", `const STEP = 1 / ${hz}\n`)
		}
		writeFileSync(path.join(root, "src", "sim", f), text)
	}
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ private: true, type: "module", imports: { "#*": "./src/*" } }))
	symlinkSync(`${PG}/tooling/node_modules`, path.join(root, "node_modules"))
	const sim = ((await import(path.join(root, "src", "sim", "physics.ts"))) as { simulate: Simulate }).simulate
	const admit = ((await import(path.join(root, "src", "sim", "document.ts"))) as { admitDocument: (doc: unknown) => { scene: unknown } }).admitDocument
	return (doc: unknown) => sim(admit(doc).scene, 480)
}

// (the engine's own notes on stiff springs and wedged solids are by design here: WARN=1 shows them)
const warn = console.warn
if (!process.env.WARN) console.warn = () => {}

const G = 9.81
const STEP = 1 / 480
const AIR = 1.2
type Solid = { id: string; kind: string; body: { kind: string; radius?: number; width?: number; height?: number; depth?: number; wall?: number }; material: string; at: { x: number; y: number }; angle?: number }
type Joint = { kind: string; id: string; stiffness?: number; mass?: number; rest?: number; damping?: number; a?: string | null; b?: string | null; anchorA?: { x: number; y: number }; anchorB?: { x: number; y: number } }
type Doc = {
	solids: Solid[]
	materials: Record<string, { density: number }>
	contacts: { between: [string, string]; restitution: number }[]
	joints?: Joint[]
	release: { at: number }
	[k: string]: unknown
}
const s = (o: Record<string, unknown>) => ({ placeholder: { fill: "#888" }, render: { kind: "procedural", shade: "#666" }, depth: 1, ...o })
const doc = (o: { materials?: Record<string, unknown>; contacts?: unknown[]; solids: unknown[]; joints?: unknown[]; seconds: number }) => ({
	version: 1,
	id: "rw4",
	camera: { canvas: { width: 10, height: 10 }, origin: { x: 0, y: 0 }, pixel: { x: 0, y: 0 }, pixelsPerMeter: 1 },
	animated: [],
	organic: [],
	release: { parts: [], at: 0 },
	sprites: {},
	materials: { dense: { density: 20000 }, steel: { density: 7850 }, wood: { density: 700 } },
	contacts: [],
	...o
})
const runFrames = (d: unknown) => simulate(admitDocument(d).scene, 480).frames.map((f) => f.placements)
const pct = (got: number, want: number) => `${(((got - want) / want) * 100).toFixed(3)}%`
let failures = 0
const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL")
const check = (label: string, got: number, want: number, tol: number, unit = "", against = "theory") => {
	const ok = Math.abs(got - want) <= Math.abs(want) * tol
	if (!ok) failures++
	console.log(`  ${verdict(ok)} ${label}: engine ${got.toFixed(5)}${unit}, ${against} ${want.toFixed(5)}${unit} (${pct(got, want)}, within ${(tol * 100).toFixed(2)}%)`)
}
const claim = (label: string, ok: boolean) => {
	if (!ok) failures++
	console.log(`  ${verdict(ok)} ${label}`)
}
const finite = (F: Record<string, P>[]) => F.every((q) => Object.values(q).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle)))

// ---------------------------------------------------------------- catalog scenes, built by machines/items.py itself
const STAGE = { x0: -0.55908203125, x1: 3.19091796875, y0: -0.15625, y1: 2.34375 }
const TABLE = { id: "table", type: "table", name: "Table", x: 1.3, y: 0.0, props: { width: 3.7, thickness: 0.15 } }
const sceneOf = (items: unknown[], seconds = 3, release = 0.5) => ({ version: 2, id: "p4", name: "p4", seconds, release, stage: STAGE, items: [TABLE, ...items], goals: [] })
const PY = `import sys, json; sys.path.insert(0, ${JSON.stringify(MACHINES)}); import items; print(json.dumps([list(items.build(s)[:2]) for s in json.load(sys.stdin)]))`
/** The engine documents (and resolved props) machines/items.py builds for these scenes. */
const buildBoth = (scenes: unknown[]): [Doc, Record<string, Record<string, unknown>>][] => JSON.parse(execFileSync("python3", ["-c", PY], { input: JSON.stringify(scenes), maxBuffer: 1 << 30 }).toString())
const build = (scenes: unknown[]): Doc[] => buildBoth(scenes).map(([d]) => d)
const PYM = `import sys, json; sys.path.insert(0, ${JSON.stringify(MACHINES)}); import items, catalog_mechanisms as c; print(json.dumps([c._spring_mass(k, x) for k, x in json.load(sys.stdin)]))`
/** catalog_mechanisms.py's own spring masses (kg) for these (stiffness, travel) pairs. */
const springMass = (pairs: [number, number][]): number[] => JSON.parse(execFileSync("python3", ["-c", PYM], { input: JSON.stringify(pairs) }).toString())
const densityOf = (d: Doc, x: Solid) => d.materials[x.material]?.density ?? 0
const slabMass = (d: Doc, x: Solid) => (x.body.width ?? 0) * (x.body.height ?? 0) * (x.body.depth ?? 0) * densityOf(d, x)
const ballVolume = (x: Solid) => {
	const r = x.body.radius ?? 0
	const inner = Math.max(0, r - (x.body.wall ?? r))
	return (4 / 3) * Math.PI * (r ** 3 - inner ** 3)
}
const ballMass = (d: Doc, x: Solid) => ballVolume(x) * densityOf(d, x)
/** The air a ball carries (inertia, no weight): what it encloses and half its volume (physics.ts `airCarried`). */
const ballAir = (x: Solid) => {
	const r = x.body.radius ?? 0
	const inner = Math.max(0, r - (x.body.wall ?? r))
	return AIR * (4 / 3) * Math.PI * (inner ** 3 + 0.5 * r ** 3)
}
const restitutionOf = (d: Doc, a: string, b: string) => d.contacts.find((c) => (c.between[0] === a && c.between[1] === b) || (c.between[0] === b && c.between[1] === a))?.restitution ?? 0
const springsOf = (d: Doc) => (d.joints ?? []).filter((j) => j.kind === "spring")

const tests: Record<string, () => void | Promise<void>> = {}

// ---------------------------------------------------------------- 1. no scene crashes the engine
tests.crash = async () => {
	console.log("CRASHES: every scene runs to its end, every placement finite, in reasonable time; anything that still goes wrong is said in one line")
	// The review's scene (tools/parity/fuzz-live.mjs, seed 20261015, scene 1646): a crowded table where a Newton's cradle's strings and bobs are wedged
	// into a rubber duck and a catapult's post; planck's time-of-impact pass threw "Cannot read properties of undefined (reading 'x')" on both backends.
	// (as the server takes it: cleaned and built, here by web/sim, the exact port of web/server.py's clean() and machines/items.py)
	const scene = JSON.parse(readFileSync(`${PG}/tools/parity/fixtures/fuzz-1646.json`, "utf8"))
	const sim = (await import(`${PG}/web/sim/index.js`)) as { prepare: (scene: unknown) => { doc: Doc } }
	const d = sim.prepare(scene).doc
	try {
		const F = runFrames(d)
		claim(`fuzz-1646 (${scene.items.length} items, ${(d as Doc).solids.length} solids): runs its ${scene.seconds} s (${F.length} steps), every placement finite`, finite(F))
	} catch (e) {
		claim(`fuzz-1646: ${String(e).slice(0, 160)}`, false)
	}
	// The second review's documents (engine-fuzz.mjs's logic, seed 99991, as the builder made them then: tools/parity/fixtures/fuzz99991-*.doc.json):
	// 8970, a sneaker's heel wedged among fixed pegs, whose contacts' stored impulses grew step after step until the warm start alone flung it and its
	// motion was NaN at 1.181 s ("the simulation broke down", HTTP 500 after 46 s); 4425, a handle wedged against a fixed ball and a wheel that set
	// off 122,432 time-of-impact events in 1.5 s (51 to 329 s for 3 s, the server's 120 s limit). Now each runs to its end, in seconds.
	for (const [name, what] of [
		["fuzz99991-8970", "a heel wedged among pegs (NaN at 1.181 s before)"],
		["fuzz99991-4425", "a handle wedged against a ball and a wheel (51-329 s before)"]
	] as const) {
		const dd = JSON.parse(readFileSync(`${PG}/tools/parity/fixtures/${name}.doc.json`, "utf8"))
		const t0 = performance.now()
		try {
			const F = runFrames(dd)
			const s = (performance.now() - t0) / 1000
			claim(`${name}, ${what}: runs its ${dd.seconds} s, every placement finite, in ${s.toFixed(1)} s (at most 30)`, finite(F) && s <= 30)
		} catch (e) {
			claim(`${name}: ${String(e).slice(0, 160)}`, false)
		}
	}
	// A failure inside a step is said in one line, with when: here a part whose place is not a number (put there after the document was admitted).
	const one = doc({ solids: [s({ kind: "dynamic", id: "ball", words: "ball", body: { kind: "ball", radius: 0.02 }, material: "steel", at: { x: 0, y: 1 } })], seconds: 0.1 })
	const admitted = structuredClone(admitDocument(one).scene) as { solids: { at: { x: number; y: number } }[] }
	;(admitted.solids[0] as { at: { x: number; y: number } }).at = { x: Number.NaN, y: 1 }
	try {
		simulate(admitted, 480)
		claim("a part with no place: refused", false)
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		claim(
			`a part whose place is not a number: a clean one-line error (${e instanceof Error ? e.name : "?"}): "${message}"`,
			e instanceof Error && e.name === "SimulationError" && !message.includes("\n") && message.startsWith("the simulation broke down at")
		)
	}
	// A document that does not fit the format is refused on admission in one line, its place in the document said: a spring's mass below zero.
	const negative = doc({
		solids: [s({ kind: "dynamic", id: "bob", words: "bob", body: { kind: "ball", radius: 0.02 }, material: "steel", at: { x: 0, y: 0.5 } })],
		joints: [{ kind: "spring", id: "s", a: null, b: "bob", anchorA: { x: 0, y: 1 }, anchorB: { x: 0, y: 0 }, rest: 0.4, stiffness: 50, damping: 0, mass: -1 }],
		seconds: 0.1
	})
	try {
		admitDocument(negative)
		claim("a spring of mass −1 kg: refused", false)
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		claim(`a spring of mass −1 kg is refused on admission in one line: "${message}"`, !message.includes("\n") && message.includes('["mass"]'))
	}
	// The weightless foam pillow (0.5 g, 2 m deep: lighter than the air it fills), dropped: its nine welded parts' drags were each limited on their own,
	// together nine times its motion, and it was flung at the 5760 m/s planck allows within four steps. Now never faster than the air lets it go.
	const [pillow] = build([sceneOf([{ id: "p", type: "pillow", x: 1.3, y: 1.2, props: { mass: 0.0005, depth: 2 }, held: true }], 3)])
	const PF = runFrames(pillow)
	let fastest = 0
	for (let k = 1; k < PF.length; k++) {
		const a = PF[k]?.["p/body"] as P
		const b = PF[k - 1]?.["p/body"] as P
		fastest = Math.max(fastest, Math.hypot(a.x - b.x, a.y - b.y) / STEP)
	}
	// (it is lighter than the air it fills: its first step takes the whole lift, 7.7 m/s, as a slab carries no air with it (a known limit: a ball does), and
	// its drag then holds it to a few metres a second)
	claim(`a 0.5 g foam pillow 2 m deep, let go 1.2 m up: fastest ${fastest.toFixed(3)} m/s (it rises: lighter than its air), never flung`, fastest < 10 && finite(PF))
	// A 1 m steel ball let fall from 1000 m for 20 s (the longest run, from the highest place the server takes) is never slowed by the engine's guard
	// (SANE_SPEED, 250 m/s): it falls at what gravity and the air give it, 180 m/s by the end.
	const [far] = build([{ ...sceneOf([{ id: "b", type: "steel-ball", x: 20, y: 1000, props: { diameter: 1 } }], 20, 0), stage: { x0: -1000, x1: 1000, y0: -1000, y1: 1000 } }])
	const ballF = runFrames(far)
	const id = (far as Doc).solids.find((x) => x.id.startsWith("b/"))?.id as string
	let top = 0
	for (let k = 1; k < ballF.length; k++) top = Math.max(top, Math.abs(((ballF[k]?.[id] as P).y - (ballF[k - 1]?.[id] as P).y) / STEP))
	const b0 = (far as Doc).solids.find((x) => x.id === id) as Solid
	const m = ballMass(far as Doc, b0)
	const r0 = b0.body.radius ?? 0
	const kd = (0.5 * AIR * 0.47 * Math.PI * r0 * r0) / (m + ballAir(b0))
	const gEff = (G * (m - AIR * ballVolume(b0))) / (m + ballAir(b0))
	let v = 0
	for (let t = 0; t < 20 - 1e-9; t += 1e-4) v += (gEff - kd * v * v) * 1e-4
	check("a 1 m steel ball falling 20 s from 1000 m: its speed at the end (never slowed by the guard)", top, v, 0.005, " m/s", "free fall with drag")
	// The crash fuzz: random scenes of every catalog type with extreme props, dense clusters, held and fixed items (tools/parity/engine-fuzz.mjs).
	const n = Number(process.env.FUZZ_N ?? 5000)
	const jobs = Number(process.env.FUZZ_JOBS ?? 8)
	const r = spawnSync("node", ["--no-warnings", `${PG}/tools/parity/engine-fuzz.mjs`, "--n", String(n), "--jobs", String(jobs), "--engine", DIR], { encoding: "utf8", maxBuffer: 1 << 28 })
	const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
	const lines = out.split("\n")
	for (const line of lines) if (/^ {2}(scenes|time|exceptions|non-finite)/.test(line)) console.log(`    ${line.trim().slice(0, 220)}`)
	const verdictLine = lines.find((l) => /^(PASS|FAIL):/.test(l)) ?? "(no verdict)"
	claim(`engine fuzz, ${n} random scenes: ${verdictLine}`, r.status === 0 && verdictLine.startsWith("PASS"))
}

// ---------------------------------------------------------------- 2. restitution only on genuine impacts; no energy from the sub-steps
/** A ball's highest point after it first comes down near the plate (where it started from: its drop height above the plate's top). */
const reboundTop = (y: readonly number[], landing: number) => {
	const i = y.findIndex((v) => v < landing)
	return i < 0 ? -Infinity : Math.max(...y.slice(i))
}
/**
 * A bounce pad as the catalog builds it, then given springs of `k` N/m together (each half) and `mass` kg each (an engine test: the catalog keeps
 * its stiffness lower on light plates, `_spring_cap`), its plate settled where those springs hold it up, and the ball `h` m over the plate.
 */
const stiffPad = (props: Record<string, number | string>, k: number, ball: string, h: number, seconds: number, mass = 0) => {
	const [d] = build([sceneOf([{ id: "p", type: "bounce-pad", x: 1.3, y: 0, props: { damping: 0, ...props } }, { id: "b", type: ball, x: 1.3, y: 1, held: true }], seconds)]) as [Doc]
	const plate = d.solids.find((x) => x.id === "p/plate") as Solid
	const springs = springsOf(d)
	for (const j of springs) {
		j.stiffness = k / 2
		if (mass > 0) j.mass = mass
		else delete j.mass
	}
	const rest = springs[0]?.rest ?? 0
	const mp = slabMass(d, plate)
	// (held up by its springs: its weight and half of theirs)
	plate.at.y = rest - ((mp + springs.length * (mass / 2)) * G) / k + (plate.body.height ?? 0) / 2
	const sol = d.solids.find((x) => x.id.startsWith("b/")) as Solid
	sol.at.y = plate.at.y + (plate.body.height ?? 0) / 2 + (sol.body.radius ?? 0) + h
	return { d, plate, sol }
}
tests.energy = () => {
	console.log("NO ENERGY FROM NOWHERE: a ball dropped on a sprung pad never comes back higher than it fell from; an undamped pad never rings up")
	// Every pad whose plate starts at rest on its springs (its own weight, and half of its springs', held up by them): the plate and the springs then
	// start at the bottom of their energy, and the ball's is all there is; it can come back no higher than its start, less what its bounces and the air
	// took. Plates from 3.4 g to 3.8 kg, springs from 50 to 10000 N/m asked for (the catalog builds the light plates' stiff ones lower: _spring_cap),
	// balls from a 2.7 g ping-pong ball (e 0.96) to a 7.3 kg bowling ball (e 0.65), dropped 0.1, 0.5 and 2 m. (The engine before batch 2, on these same
	// pads: a steel ball dropped 2 m on a 6 × 2 cm rubber plate at 1000 N/m came back 4.9 m above its start.)
	type Case = { props: Record<string, number | string>; ball: string; h: number }
	const cases: Case[] = []
	for (const width of [0.06, 0.8])
		for (const depth of [0.02, 0.6])
			for (const material of ["solid rubber", "steel"])
				for (const stiffness of [50, 1000, 10000])
					for (const ball of ["ping-pong-ball", "superball", "steel-ball", "bowling-ball"]) for (const h of [0.1, 0.5, 2]) cases.push({ props: { width, depth, material, stiffness, damping: 0 }, ball, h })
	const docs = build(cases.map((c) => sceneOf([{ id: "p", type: "bounce-pad", x: 1.3, y: 0, props: c.props }, { id: "b", type: c.ball, x: 1.3, y: 1, held: true }], c.h > 1 ? 3 : 2.2)))
	let ran = 0
	let worst = -Infinity
	let worstCase = ""
	let lost = 0
	let skipped = 0
	for (const [i, c] of cases.entries()) {
		const d = docs[i] as Doc
		const plate = d.solids.find((x) => x.id === "p/plate") as Solid
		const ballSolid = d.solids.find((x) => x.id.startsWith("b/")) as Solid
		const springs = springsOf(d)
		const k = springs.reduce((sum, j) => sum + (j.stiffness ?? 0), 0)
		const held = springs.reduce((sum, j) => sum + (j.mass ?? 0) / 2, 0)
		const mp = slabMass(d, plate)
		const rest = (springs[0]?.rest as number) ?? 0
		// held up by its springs (not sitting on their closed coils): the spring's push at the plate's start carries its weight
		const solid = Math.max(5, Math.min(24, Math.trunc(rest / 0.01))) * 0.002 + 0.004
		if (((mp + held) * G) / k > rest - solid) {
			skipped++
			continue
		}
		ballSolid.at.y = plate.at.y + (plate.body.height ?? 0) / 2 + (ballSolid.body.radius ?? 0) + c.h
		const F = runFrames(d)
		const y = F.map((f) => (f[ballSolid.id] as P).y)
		const y0 = y[0] as number
		const top = reboundTop(y, y0 - c.h + 0.5 * (ballSolid.body.radius ?? 0))
		const over = top - y0
		// (a ball wider than the plate lands on its rails' tops, never near the plate: nothing to measure)
		if (!Number.isFinite(over)) {
			skipped++
			continue
		}
		ran++
		if (over > worst) {
			worst = over
			worstCase = `${c.ball} from ${c.h} m on ${c.props.width} × ${c.props.depth} m ${c.props.material} at ${k} N/m`
		}
		lost += Math.max(0, -over) / c.h
		if (process.env.VERBOSE) console.log(`    ${c.ball} from ${c.h} m on ${c.props.width} × ${c.props.depth} m ${c.props.material} at ${k} N/m: back to ${(over * 1000).toFixed(2)} mm of its start`)
	}
	claim(
		`catalog pads: ${ran} drops (${skipped} left out: pads too soft to hold their plate up, balls that landed on a narrow pad's rails): the highest any ball came back is ${(worst * 1000).toFixed(2)} mm from its start (${worstCase}); on average ${((lost / ran) * 100).toFixed(1)}% of the drop lost`,
		worst <= 0.0005
	)
	// Stiff pads as documents (an engine test, past the catalog's cap), undamped, 6 s: 3000, 5000 and 7000 N/m on 3 to 20 cm springs under 6 and 20 cm
	// rubber plates, a marble, a golf ball, a superball and a steel ball dropped 0.5 and 2 m. (Before the repair, the sub-step count followed the
	// plate's swing (the sideways stiffness of a stretched spring comes and goes each half period), which pumped energy into the undamped swing:
	// a marble dropped 2 m on a 6 × 10 cm pad at 7000 N/m rose to 6.6 m, a steel ball dropped 4 m on a 10 × 10 cm one at 10000 N/m 7 m above its start.)
	{
		let n = 0
		let top = -Infinity
		let at = ""
		for (const k of [3000, 5000, 7000])
			for (const rest of [0.03, 0.08, 0.12, 0.2])
				for (const width of [0.06, 0.2])
					for (const ball of ["glass-marble", "golf-ball", "superball", "steel-ball"])
						for (const h of [0.5, 2]) {
							const { d, sol } = stiffPad({ width, depth: 0.1, rest_length: rest }, k, ball, h, 6)
							const y = runFrames(d).map((f) => (f[sol.id] as P).y)
							const over = reboundTop(y, sol.at.y - h + 0.5 * (sol.body.radius ?? 0)) - sol.at.y
							if (!Number.isFinite(over)) continue
							n++
							if (over > top) {
								top = over
								at = `${ball} from ${h} m on a ${width * 100} cm pad, ${rest * 100} cm springs, ${k} N/m`
							}
						}
		claim(`stiff pads (documents, past the catalog's cap): ${n} drops over 6 s: the highest any ball came back is ${(top * 1000).toFixed(2)} mm from its start (${at})`, top <= 0.0005)
	}
	// The review's scenes, as documents (the catalog now builds these pads softer): a marble dropped 2 m on a 6 × 10 cm pad, 12 cm springs, 7000 N/m; a
	// golf ball dropped 1 m on a 20 × 10 cm pad, 8 cm springs, 7000 N/m; a steel ball dropped 4 m on a 10 × 10 cm pad, 12 cm springs, 10000 N/m; 8 s each.
	for (const [label, props, k, ball, h] of [
		["a marble dropped 2 m on a 6 × 10 cm pad at 7000 N/m (rose to 6.6 m before)", { width: 0.06, depth: 0.1, rest_length: 0.12 }, 7000, "glass-marble", 2],
		["a golf ball dropped 1 m on a 20 × 10 cm pad at 7000 N/m (+0.134 m before)", { width: 0.2, depth: 0.1, rest_length: 0.08 }, 7000, "golf-ball", 1],
		["a steel ball dropped 4 m on a 10 × 10 cm pad at 10000 N/m (+7.04 m before)", { width: 0.1, depth: 0.1, rest_length: 0.12 }, 10000, "steel-ball", 4]
	] as const) {
		const { d, sol } = stiffPad(props, k, ball, h, 8)
		const y = runFrames(d).map((f) => (f[sol.id] as P).y)
		const over = reboundTop(y, sol.at.y - h + 0.5 * (sol.body.radius ?? 0)) - sol.at.y
		claim(`${label}: over 8 s it comes back at most ${(over * 1000).toFixed(1)} mm from its start`, over <= 0.0005)
	}
	// The pad alone, ringing: a 10 × 10 cm plate on 12 cm springs at 10000 N/m, undamped, pushed 17 mm down and let go, nothing touching it: its swing
	// may only die away (the air's drag); it rang up to 93 mm in 2.5 s before the repair.
	{
		const { d, plate } = stiffPad({ width: 0.1, depth: 0.1, rest_length: 0.12 }, 10000, "glass-marble", 1.5, 3)
		d.solids = d.solids.filter((x) => !x.id.startsWith("b/"))
		const y0 = plate.at.y
		plate.at.y -= 0.017
		const y = runFrames(d).map((f) => (f["p/plate"] as P).y - y0)
		const rel = Math.round(0.5 / STEP)
		const half = (a: number, b: number) => (Math.max(...y.slice(a, b)) - Math.min(...y.slice(a, b))) / 2
		const first = half(rel, rel + 48)
		const last = half(y.length - 48, y.length)
		claim(`an undamped 10 × 10 cm pad at 10000 N/m pushed 17 mm down, alone: its swing ${(first * 1000).toFixed(2)} mm at the release, ${(last * 1000).toFixed(2)} mm 2.5 s later (never more)`, last <= first * 1.001)
	}
	// Ordinary bounces are as before: a superball (e 0.86) dropped 1 m on a wooden floor in still air rebounds e² of its fall less the air's drag, on
	// the main solve's path and on the time-of-impact pass's (a fast small ball), as research/rw-validate.ts's DROP and RAMP (Cross 2002) find.
	const r = 0.03
	const m = 906 * (4 / 3) * Math.PI * r ** 3
	const drop = runFrames(
		doc({
			materials: { rubber: { density: 906 }, wood: { density: 700 } },
			contacts: [{ between: ["rubber", "wood"], friction: 0.52, restitution: 0.86, rollingResistance: 0.012 }],
			solids: [
				s({ kind: "static", id: "floor", words: "floor", body: { kind: "slab", width: 8, height: 0.1, depth: 1 }, material: "wood", at: { x: 3, y: -0.05 } }),
				s({ kind: "dynamic", id: "ball", words: "ball", body: { kind: "ball", radius: r }, material: "rubber", at: { x: 0, y: 1 + r } })
			],
			seconds: 1.6
		})
	)
	const ys = drop.map((f) => (f.ball as P).y - r)
	const landed = ys.findIndex((v) => v < 0.01)
	const apex = Math.max(...ys.slice(landed))
	// 1D drop with quadratic drag k = ½ρ·Cd·A/m (the air carried adds to m) and e: the first apex
	const kd = (0.5 * AIR * 0.47 * Math.PI * r * r) / (m + AIR * (2 / 3) * Math.PI * r ** 3)
	let yy = 1
	let v = 0
	const dt = 1e-5
	while (yy > 0) {
		v += (-G * (1 - (AIR * (4 / 3) * Math.PI * r ** 3) / (m + AIR * (2 / 3) * Math.PI * r ** 3)) + kd * v * v) * dt
		yy += v * dt
	}
	v = -0.86 * v
	yy = 0
	while (v > 0) {
		v += (-G * (1 - (AIR * (4 / 3) * Math.PI * r ** 3) / (m + AIR * (2 / 3) * Math.PI * r ** 3)) - kd * v * v) * dt
		yy += v * dt
	}
	check("a superball (e 0.86) dropped 1 m on a wooden floor: its first rebound's top", apex, yy, 0.02, " m", "e² with the air's drag and lift")
}

// ---------------------------------------------------------------- 3. stiff, light springs in sub-steps
/**
 * The sampled motion of a damped oscillator, x_n = A·rⁿ·cos(nθ + φ) about its centre, obeys x_{n+1} = 2r·cos θ·x_n − r²·x_{n−1} exactly: a
 * least-squares fit of those two coefficients over the steps gives its turn a step θ = ω_d·h and its decay a step r = exp(−ζω·h) (Prony),
 * free of the sampling (as long as θ < π; past it, θ aliased, r still).
 */
const prony = (x: readonly number[]) => {
	let s11 = 0
	let s12 = 0
	let s22 = 0
	let b1 = 0
	let b2 = 0
	for (let n = 1; n + 1 < x.length; n++) {
		const u = x[n] as number
		const w = x[n - 1] as number
		const z = x[n + 1] as number
		s11 += u * u
		s12 += u * w
		s22 += w * w
		b1 += z * u
		b2 += z * w
	}
	const det = s11 * s22 - s12 * s12
	const p = (b1 * s22 - b2 * s12) / det
	const q = (s11 * b2 - s12 * b1) / det
	const r = Math.sqrt(-q)
	return { theta: Math.acos(Math.max(-1, Math.min(1, p / (2 * r)))), r }
}
/** A bob of 50 g on a spring from a fixed point (no gravity's lean: it hangs straight), pulled `amp` m down from its rest and let go: its offsets a step. */
const bob = (omegaH: number, zeta: number, amp: number, seconds: number) => {
	const m = 0.05
	const k = m * (omegaH / STEP) ** 2
	const c = 2 * zeta * Math.sqrt(k * m)
	const r = Math.cbrt((3 * m) / (4 * Math.PI * 20000))
	const rest = 0.2
	const sag = ((m - AIR * (m / 20000)) * G) / k
	const F = runFrames(
		doc({
			solids: [s({ kind: "dynamic", id: "bob", words: "bob", body: { kind: "ball", radius: r }, material: "dense", at: { x: 0, y: 1 - rest - sag - amp } })],
			joints: [{ kind: "spring", id: "s", a: null, b: "bob", anchorA: { x: 0, y: 1 }, anchorB: { x: 0, y: 0 }, rest, stiffness: k, damping: c }],
			seconds
		})
	)
	const centre = 1 - rest - sag
	return F.slice(1).map((f) => (f.bob as P).y - centre)
}
tests.stiff = async () => {
	console.log("STIFF, LIGHT SPRINGS: solved in sub-steps (no stiffness cap for the engine): periods and damping against theory over a fine scan, no energy gain")
	// A bob on a spring at ω·h from 0.2 to 2.8 a 480 Hz step in steps of 0.05 (0.9, 1.35, 1.8, 2.25, 2.7, where the sub-step count changes, included),
	// undamped and at ζ 0.05 and 0.1 (and 0.3 to ω·h 1.5): its turn a step and decay a step by Prony over a quarter second. The sub-steps keep ω·h at
	// most 0.45 each (SUB_TURN), so a period comes out at most 1 − 0.45/(2·asin 0.225) = 0.86 % short, more with heavy damping (the trapezoidal rule's).
	const worst: Record<string, { period: number; damping: number; atP: string; atD: string }> = {}
	for (let i = 4; i <= 56; i++) {
		const omegaH = i * 0.05
		for (const zeta of [0, 0.05, 0.1, 0.3]) {
			if (zeta === 0.3 && omegaH > 1.5 + 1e-9) continue
			const x = bob(omegaH, zeta, 0.001, 0.3).slice(0, 119)
			const { theta, r } = prony(x)
			const w = (worst[String(zeta)] ??= { period: 0, damping: 0, atP: "", atD: "" })
			const pe = theta / (omegaH * Math.sqrt(1 - zeta * zeta)) - 1
			if (Math.abs(pe) > Math.abs(w.period)) {
				w.period = pe
				w.atP = omegaH.toFixed(2)
			}
			if (zeta > 0) {
				const de = -Math.log(r) / omegaH / zeta - 1
				if (Math.abs(de) > Math.abs(w.damping)) {
					w.damping = de
					w.atD = omegaH.toFixed(2)
				}
			}
		}
	}
	for (const [zeta, w] of Object.entries(worst)) {
		const tolP = zeta === "0.3" ? 0.015 : 0.009
		claim(`bob on a spring, ζ ${zeta}, ω·h 0.2 to ${zeta === "0.3" ? "1.5" : "2.8"} (0.05 steps): its period within ${(tolP * 100).toFixed(1)}% everywhere: worst ${(-w.period * 100).toFixed(3)}% at ω·h ${w.atP} (its turn a step ${(w.period * 100).toFixed(3)}% over theory)`, Math.abs(w.period) <= tolP)
		if (zeta !== "0") claim(`bob on a spring, ζ ${zeta}: its damping ratio within 1% everywhere: worst ${(w.damping * 100).toFixed(3)}% at ω·h ${w.atD}`, Math.abs(w.damping) <= 0.01)
	}
	// No undamped swing ever grows, at any ω·h, small or large: a bob pulled 1 mm or 2 cm, 3 s, its decay a step by Prony (r ≤ 1). Before the repair,
	// the sub-step count followed the swing's phase and 21 of 139 such bobs rang up (×10.75 at ω·h 1.3 with 2 cm); the review's five are named.
	let grew = 0
	let most = 0
	let mostAt = ""
	let n = 0
	for (let i = 6; i <= 150; i++) {
		for (const amp of [0.001, 0.02]) {
			const omegaH = i * 0.05
			const g = prony(bob(omegaH, 0, amp, 3)).r ** (3 / STEP)
			n++
			if (g > 1.0005) grew++
			if (g > most) {
				most = g
				mostAt = `ω·h ${omegaH.toFixed(2)}, ${amp * 1000} mm`
			}
		}
	}
	claim(`${n} undamped bobs (ω·h 0.3 to 7.5, 1 mm and 2 cm), 3 s each: ${grew} grew; the most kept: ×${most.toFixed(5)} (${mostAt})`, grew === 0)
	for (const omegaH of [0.9, 1.3, 1.35, 1.75, 3.45]) {
		const g = prony(bob(omegaH, 0, 0.02, 3)).r ** (3 / STEP)
		claim(`the review's bob at ω·h ${omegaH}, 2 cm, undamped, 3 s: keeps ×${g.toFixed(5)} of its swing (at most 1)`, g <= 1.0005)
	}
	// The stiffest launcher as a document (5000 N/m on 50 cm springs, 6 × 2 cm plate, pressed 45 cm; batch 2's steel, 1.27 kg a spring, a third of it on
	// the plate: an engine test of the sub-steps, past the catalog's cap) throwing a ping-pong ball and a steel ball, against the same engine at 4800 Hz.
	const fine = await fineEngine(4800)
	for (const ball of ["ping-pong-ball", "steel-ball"]) {
		const props = { stiffness: 50, compression: 0.45, rest_length: 0.5, width: 0.06, depth: 0.02, damping: 0 }
		const [bare] = build([sceneOf([{ id: "p", type: "spring-launcher", x: 1.3, y: 0, props }], 3)])
		const plate0 = (bare as Doc).solids.find((x) => x.id === "p/plate") as Solid
		const [d] = build([sceneOf([{ id: "p", type: "spring-launcher", x: 1.3, y: 0, props }, { id: "b", type: ball, x: 1.3, y: plate0.at.y + 0.05, held: false, rest: true }], 3)]) as [Doc]
		for (const j of springsOf(d)) {
			j.stiffness = 2500
			j.mass = 1.27489
		}
		const sol = d.solids.find((x) => x.id.startsWith("b/")) as Solid
		const plate = d.solids.find((x) => x.id === "p/plate") as Solid
		sol.at.y = plate.at.y + (plate.body.height ?? 0) / 2 + (sol.body.radius ?? 0) + 0.0002
		const speed = (track: Track) => {
			let v = 0
			for (let k = 1; k < track.frames.length; k++) v = Math.max(v, ((track.frames[k]?.placements[sol.id] as P).y - (track.frames[k - 1]?.placements[sol.id] as P).y) / STEP)
			return v
		}
		check(`spring launcher at 5000 N/m on 50 cm springs, 6 × 2 cm plate, pressed 45 cm (a document), ${ball}: the speed it throws at`, speed(simulate(admitDocument(d).scene, 480)), speed(fine(d)), 0.01, " m/s", "at 4800 Hz")
	}
}

// ---------------------------------------------------------------- 4. springs with mass
/**
 * A real coil: a launcher's two springs (together k, mass mₛ, fixed at the base's top) as 400 equal segments, the plate (with half a segment's steel)
 * on top and the ball riding on the plate until the plate pulls away from it, all under gravity, the air's lift and drag as the engine has them,
 * from the springs at rest under their own weight with the plate held pressed. -> the ball's fastest climb (its throw), m/s.
 */
const coilThrow = (o: { k: number; ms: number; rest: number; d0: number; mp: number; liftP: number; dragP: number; mb: number; air: number; liftB: number; dragB: number }) => {
	const N = 400
	const mn = o.ms / N
	const ks = N * o.k
	const l = o.rest / N
	const y = new Float64Array(N + 1)
	const v = new Float64Array(N + 1)
	// at rest under gravity with both ends held: s_i = −(mₙ·g/(2·N·k))·i(N − i) below the straight line
	for (let i = 0; i <= N; i++) y[i] = (i * o.d0) / N - ((mn * G) / (2 * ks)) * i * (N - i)
	const mPlate = o.mp + mn / 2
	const mBall = o.mb + o.air
	const dt = 0.1 / (2 * N * Math.sqrt(o.k / o.ms))
	let attached = true
	let yb = 0
	let vb = 0
	let fastest = 0
	const f = new Float64Array(N + 1)
	for (let t = 0; t < 1.5; t += dt) {
		// (thrown well before this, or it never leaves the plate)
		if (attached && t > 0.6) break
		f.fill(0)
		for (let i = 1; i <= N; i++) {
			const T = ks * (y[i] - y[i - 1] - l)
			f[i] -= T
			f[i - 1] += T
		}
		for (let i = 1; i < N; i++) f[i] -= mn * G
		const vp = v[N] as number
		let fp = (f[N] as number) - mPlate * G + o.liftP - o.dragP * Math.abs(vp) * vp
		const fb = (u: number) => -o.mb * G + o.liftB - o.dragB * Math.abs(u) * u
		if (attached) {
			const a = (fp + fb(vp)) / (mPlate + mBall)
			// (the push the plate gives the ball: it only pushes)
			if (mBall * a - fb(vp) < 0) {
				attached = false
				yb = y[N] as number
				vb = vp
			} else fp = mPlate * a
		}
		for (let i = 1; i < N; i++) v[i] = (v[i] as number) + ((f[i] as number) / mn) * dt
		v[N] = vp + (fp / mPlate) * dt
		for (let i = 1; i <= N; i++) y[i] = (y[i] as number) + (v[i] as number) * dt
		if (attached) fastest = Math.max(fastest, v[N] as number)
		else {
			vb += (fb(vb) / mBall) * dt
			yb += vb * dt
			fastest = Math.max(fastest, vb)
			if (vb < fastest - 1) break
		}
	}
	return fastest
}
tests.mass = () => {
	console.log("SPRING MASS: a spring's own steel, spread along it as it is, against the engine's lumped share of it (and the catalog's sizing)")
	// The hanging spring's weight swings at the exact fundamental of a uniform spring with a mass on its end: 2π·√(mₛ/k)/β with β·tan β = mₛ/m (the
	// engine moves mₛ/β² − m with the weight: Rayleigh's mₛ/3 for a light spring, which it is to the last digit's noise there). Before the repair it moved
	// mₛ/3 whatever the spring weighed: 500 N/m with 906 g of steel and a 50 g weight swung 7.2 % fast.
	for (const props of [{}, { stiffness: 500, weight: 0.05, rest_length: 1.0, start_stretch: 0.05 }, { stiffness: 100, weight: 0.1, rest_length: 0.5, start_stretch: 0.05 }, { stiffness: 5, weight: 0.5, rest_length: 0.3 }, { stiffness: 100, weight: 2, start_stretch: 0.3 }]) {
		const [d] = build([sceneOf([{ id: "s", type: "hanging-spring", x: 1.3, y: 2.2, props: { damping: 0, ...props } }], 4, 0.5)]) as [Doc]
		const spring = springsOf(d)[0] as Joint
		const w = d.solids.find((x) => x.id === "s/weight") as Solid
		const m = slabMass(d, w)
		const ms = spring.mass ?? 0
		const k = spring.stiffness ?? 0
		// (three periods at least)
		d.seconds = Math.max(4, 0.5 + 3.5 * 2 * Math.PI * Math.sqrt((m + ms / 2) / k))
		const F = runFrames(d).slice(Math.round(0.5 / STEP) + 1)
		const y = F.map((f) => (f["s/weight"] as P).y)
		const mid = (Math.max(...y) + Math.min(...y)) / 2
		const ups: number[] = []
		for (let i = 1; i < y.length; i++) if ((y[i - 1] as number) < mid && (y[i] as number) >= mid) ups.push(i - 1 + (mid - (y[i - 1] as number)) / ((y[i] as number) - (y[i - 1] as number)))
		const T = (((ups.at(-1) ?? 0) - (ups[0] ?? 0)) / (ups.length - 1)) * STEP
		const x = ms / m
		let lo = 0
		let hi = Math.PI / 2
		for (let i = 0; i < 80; i++) {
			const b = (lo + hi) / 2
			if (b * Math.tan(b) < x) lo = b
			else hi = b
		}
		const beta = (lo + hi) / 2
		const want = ms > 0 ? (2 * Math.PI * Math.sqrt(ms / k)) / beta : 2 * Math.PI * Math.sqrt(m / k)
		check(
			`hanging spring ${JSON.stringify(props)}: ${k} N/m, ${(ms * 1000).toFixed(1)} g of steel, ${(m * 1000).toFixed(0)} g weight: its period (Rayleigh's 2π√((m + mₛ/3)/k): ${(2 * Math.PI * Math.sqrt((m + ms / 3) / k)).toFixed(5)} s)`,
			T,
			want,
			0.0015,
			" s",
			"a uniform spring's fundamental"
		)
	}
	// Launchers against the 400-node coil, the catalog's springs as built (their stiffness capped where their steel would outweigh the plate and a light
	// ball: _spring_cap): within 2.5 % wherever the catalog lets them be. (Batch 2 sized the steel by the held compression and capped nothing: the
	// stiffest launcher's 2.55 kg of steel threw a ping-pong ball at 34 m/s by Rayleigh's share, where the coil throws it at 19.8.)
	const cases: [string, Record<string, number | string>, string][] = [
		["at its defaults (800 N/m, held 6 cm)", {}, "golf-ball"],
		["at its defaults", {}, "ping-pong-ball"],
		["asked 5000 N/m, held 10 cm", { stiffness: 5000, compression: 0.1 }, "golf-ball"],
		["30 cm springs asked 2000 N/m, held 25 cm", { stiffness: 2000, rest_length: 0.3, compression: 0.25 }, "ping-pong-ball"],
		["6 × 2 cm plate, 50 cm springs asked 5000 N/m, held 45 cm", { stiffness: 5000, compression: 0.45, rest_length: 0.5, width: 0.06, depth: 0.02 }, "ping-pong-ball"],
		["10 × 5 cm plate, 20 cm springs asked 800 N/m, held 15 cm", { stiffness: 800, compression: 0.15, rest_length: 0.2, width: 0.1, depth: 0.05 }, "steel-ball"],
		["60 × 60 cm aluminium plate, 30 cm springs at 2000 N/m, held 20 cm", { stiffness: 2000, compression: 0.2, rest_length: 0.3, width: 0.6, depth: 0.6, material: "aluminium" }, "bowling-ball"]
	]
	for (const [label, props, ball] of cases) {
		const [bare] = build([sceneOf([{ id: "p", type: "spring-launcher", x: 1.3, y: 0, props: { damping: 0, ...props } }], 3)])
		const plate0 = (bare as Doc).solids.find((x) => x.id === "p/plate") as Solid
		const [[d, resolved]] = buildBoth([sceneOf([{ id: "p", type: "spring-launcher", x: 1.3, y: 0, props: { damping: 0, ...props } }, { id: "b", type: ball, x: 1.3, y: plate0.at.y + 0.2, held: false, rest: true }], 3)]) as [[Doc, Record<string, Record<string, unknown>>]]
		const sol = d.solids.find((x) => x.id.startsWith("b/")) as Solid
		const plate = d.solids.find((x) => x.id === "p/plate") as Solid
		sol.at.y = plate.at.y + (plate.body.height ?? 0) / 2 + (sol.body.radius ?? 0) + 0.0002
		const springs = springsOf(d)
		const k = springs.reduce((sum, j) => sum + (j.stiffness ?? 0), 0)
		const ms = springs.reduce((sum, j) => sum + (j.mass ?? 0), 0)
		const rest = springs[0]?.rest ?? 0
		const mp = slabMass(d, plate)
		const mb = ballMass(d, sol)
		const W = plate.body.width ?? 0
		const coil = coilThrow({
			k,
			ms,
			rest,
			d0: plate.at.y - (plate.body.height ?? 0) / 2,
			mp,
			liftP: AIR * W * (plate.body.height ?? 0) * (plate.body.depth ?? 0) * G,
			dragP: 0.5 * AIR * 1.05 * W * (plate.body.depth ?? 0),
			mb,
			air: ballAir(sol),
			liftB: AIR * ballVolume(sol) * G,
			dragB: 0.5 * AIR * 0.47 * Math.PI * (sol.body.radius ?? 0) ** 2
		})
		const F = runFrames(d)
		// (its first flight: an undamped plate rings on, and a ball that falls back on it can be thrown again)
		let v = 0
		for (let i = 1; i < F.length; i++) {
			const u = ((F[i]?.[sol.id] as P).y - (F[i - 1]?.[sol.id] as P).y) / STEP
			if (v > 0.5 && u < 0) break
			v = Math.max(v, u)
		}
		const asked = (props.stiffness as number | undefined) ?? 800
		const built = resolved.p?.stiffness as number
		console.log(
			`  launcher ${label}, ${ball}: built at ${built} N/m${built < asked ? ` (asked ${asked}: capped)` : ""}, ${(ms * 1000).toFixed(1)} g of steel (a third of it ${((ms / 3 / mp) * 100).toFixed(0)}% of the ${(mp * 1000).toFixed(1)} g plate), ball ${(mb * 1000).toFixed(1)} g`
		)
		check(`    its throw`, v, coil, 0.025, " m/s", "a 400-node coil")
	}
	// A pad's plate starts where its springs hold it up, their own weight's half included (the catalog's (m + mₛ/2)·g/k, the engine's statics): let go, it
	// stays put, on light plates and heavy springs as well as at the defaults.
	for (const props of [{}, { stiffness: 10000 }, { width: 0.06, depth: 0.02, stiffness: 10000, rest_length: 0.4 }, { width: 0.8, depth: 0.6, material: "steel", stiffness: 10000 }]) {
		const [[d, resolved]] = buildBoth([sceneOf([{ id: "p", type: "bounce-pad", x: 1.3, y: 0, props: { damping: 0, ...props } }], 2)]) as [[Doc, Record<string, Record<string, unknown>>]]
		const y0 = (d.solids.find((x) => x.id === "p/plate") as Solid).at.y
		const F = runFrames(d).slice(Math.round(0.5 / STEP))
		const moved = Math.max(...F.map((f) => Math.abs((f["p/plate"] as P).y - y0)))
		const ms = springsOf(d).reduce((sum, j) => sum + (j.mass ?? 0), 0)
		claim(`bounce pad ${JSON.stringify(props)} (built at ${resolved.p?.stiffness} N/m, ${(ms * 1000).toFixed(1)} g of steel): its plate moves at most ${(moved * 1e6).toFixed(1)} µm once let go (at most 50)`, moved <= 5e-5)
	}
	// Between two moving bodies (a document: the catalog has none): two 50 g balls joined by a spring of 50 g, falling free, its stretch let go. Its
	// stretching swing is two springs of half its length each with a fixed middle, 2π·√(mₛ/2/(2k))/β, β·tan β = (mₛ/2)/m: the consistent mass
	// (mₛ/6 at each end, 2mₛ/3 at the middle) gives it within 0.2 %, where half the spring's mass at each end swung 11.6 % slow.
	{
		const m = 0.05
		const ms = 0.05
		const k = 67.5
		const r = Math.cbrt((3 * m) / (4 * Math.PI * 20000))
		const F = runFrames(
			doc({
				solids: [
					s({ kind: "dynamic", id: "a", words: "a", body: { kind: "ball", radius: r }, material: "dense", at: { x: 0, y: 5 } }),
					s({ kind: "dynamic", id: "b", words: "b", body: { kind: "ball", radius: r }, material: "dense", at: { x: 0.21, y: 5 } })
				],
				joints: [{ kind: "spring", id: "s", a: "a", b: "b", anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: 0 }, rest: 0.2, stiffness: k, damping: 0, mass: ms }],
				seconds: 0.6
			})
		)
		const gap = F.slice(1).map((f) => (f.b as P).x - (f.a as P).x - 0.2)
		const { theta } = prony(gap)
		let lo = 0
		let hi = Math.PI / 2
		for (let i = 0; i < 80; i++) {
			const b = (lo + hi) / 2
			if (b * Math.tan(b) < ms / 2 / m) lo = b
			else hi = b
		}
		const beta = (lo + hi) / 2
		check(`a 50 g spring between two falling 50 g balls: its stretching swing's turn a step (half its mass at each end: ${(Math.sqrt((2 * k) / (m + ms / 2)) * STEP).toFixed(5)} rad)`, theta, beta * Math.sqrt((4 * k) / ms) * STEP, 0.005, " rad", "the uniform spring's")
	}
	// The catalog sizes a spring for the most its item can ever deflect it, whatever the item is set to (a launcher held 0, 6 or 45 cm, a hanging spring
	// with 50 g, 200 g or 5 kg on it, a bumper pushed in or pulled out: the same spring, the same steel; batch 2 sized it by the setting, so a launcher's
	// spring weighed 81 times more held 45 cm than 5 cm, and nothing held at 0).
	const same = (type: string, key: string, values: (number | string)[], extra: Record<string, number> = {}) => {
		const docs = build(values.map((v) => sceneOf([{ id: "p", type, x: 1.3, y: 1.5, props: { ...extra, [key]: v } }], 1)))
		const masses = docs.map((d) => springsOf(d).map((j) => j.mass ?? 0))
		const first = JSON.stringify(masses[0])
		claim(`${type}: its springs' steel whatever its ${key} (${values.join(", ")}): ${masses.map((m) => m.map((x) => `${(x * 1000).toFixed(2)} g`).join("+")).join(" | ")}`, masses.every((m) => JSON.stringify(m) === first) && (masses[0]?.[0] ?? 0) > 0)
	}
	same("spring-launcher", "compression", [0, 0.05, 0.06, 0.45])
	same("spring-launcher", "compression", [0, 0.2, 0.45], { rest_length: 0.5, stiffness: 300 })
	same("hanging-spring", "weight", [0.05, 0.2, 5])
	same("hanging-spring", "start_stretch", [0, 0.2, 1])
	same("spring-bumper", "pushed_in", [-0.1, 0, 0.1])
	const [m1, m2] = springMass([
		[400, 0.116],
		[2500, 0.45]
	])
	console.log(`  catalog spring masses (2.5 g a joule, at the most stress steel takes without a set, 1 GPa): 400 N/m for 11.6 cm ${((m1 as number) * 1000).toFixed(2)} g, 2500 N/m for 45 cm ${((m2 as number) * 1000).toFixed(0)} g`)
}

// ---------------------------------------------------------------- 5. strikes carried on through lasting contacts
tests.impacts = () => {
	console.log("STRIKES CARRIED ON: a strike on a ball that touches another runs on through it, one collision at a time (sequential impacts)")
	// A tennis ball resting on a basketball, let fall 1 m (the basketball's bottom over the table): the basketball rebounds off the table, then meets the
	// tennis ball still falling and throws it up (Cross 2007's two-ball model): theory, the pair falling together (each with its own drag, the tennis
	// ball pressing on the basketball while it would fall faster, else apart), the basketball's bounce off the table with e₁, then their collision with
	// e₂ the moment they meet, and the tennis ball's flight with its drag. Before the repair the pair was solved as one, and the tennis ball rose to 0.85 m.
	{
		const [d] = build([sceneOf([{ id: "bb", type: "basketball", x: 1.3, y: 1.5 }, { id: "tb", type: "tennis-ball", x: 1.3, y: 1.8 }], 3, 0.5)]) as [Doc]
		const top = d.solids.find((x) => x.id === "table/top") as Solid
		const tt = top.at.y + (top.body.height ?? 0) / 2
		const bb = d.solids.find((x) => x.id.startsWith("bb/")) as Solid
		const tb = d.solids.find((x) => x.id.startsWith("tb/")) as Solid
		const rb = bb.body.radius ?? 0
		const rt = tb.body.radius ?? 0
		bb.at.y = tt + 1.0 + rb
		tb.at.y = bb.at.y + rb + rt + 0.00002
		const run = simulate(admitDocument(d).scene, 480)
		const F = run.frames.map((f) => f.placements)
		const y = F.map((f) => (f[tb.id] as P).y)
		const yb = F.map((f) => (f[bb.id] as P).y)
		const land = yb.findIndex((v) => v <= tt + rb + 0.002)
		const apex = Math.max(...y.slice(land))
		// theory
		const body = (x: Solid) => ({ m: ballMass(d, x), air: ballAir(x), lift: AIR * ballVolume(x) * G, drag: 0.5 * AIR * 0.47 * Math.PI * (x.body.radius ?? 0) ** 2 })
		const B = body(bb)
		const T = body(tb)
		const e1 = restitutionOf(d, top.material, bb.material)
		const e2 = restitutionOf(d, bb.material, tb.material)
		const acc = (o: typeof B, u: number) => (-o.m * G + o.lift - o.drag * Math.abs(u) * u) / (o.m + o.air)
		let pb = bb.at.y
		let pt = tb.at.y
		let vbb = 0
		let vtb = 0
		const dt = 1e-6
		// falling: together while the tennis ball would fall faster than the basketball, else apart
		while (pb > tt + rb) {
			let ab = acc(B, vbb)
			let at = acc(T, vtb)
			if (pt - pb <= rb + rt + 1e-4 && at < ab) {
				const together = (-(B.m + T.m) * G + B.lift + T.lift - B.drag * Math.abs(vbb) * vbb - T.drag * Math.abs(vtb) * vtb) / (B.m + B.air + T.m + T.air)
				ab = together
				at = together
			}
			vbb += ab * dt
			vtb += at * dt
			pb += vbb * dt
			pt += vtb * dt
		}
		vbb = -e1 * vbb
		let met = false
		let tops = pt
		for (let t = 0; t < 3; t += dt) {
			if (!met && pt - pb <= rb + rt) {
				// the collision: e₂ on the approach, momentum kept (the air carried moves with each)
				const mB = B.m + B.air
				const mT = T.m + T.air
				const vc = (mB * vbb + mT * vtb) / (mB + mT)
				const nb = vc - (e2 * mT * (vbb - vtb)) / (mB + mT)
				const nt = vc + (e2 * mB * (vbb - vtb)) / (mB + mT)
				vbb = nb
				vtb = nt
				met = true
			}
			vbb += acc(B, vbb) * dt
			vtb += acc(T, vtb) * dt
			pb += vbb * dt
			pt += vtb * dt
			tops = Math.max(tops, pt)
			if (met && vtb < 0) break
		}
		check(`a tennis ball resting on a basketball, let fall 1 m onto the table (e ${e1} off the table, ${e2} between them): the tennis ball's highest`, apex, tops, 0.03, " m", "sequential impacts")
		const hit = (run.impacts ?? []).some((h) => [h.a, h.b].includes(bb.id) && [h.a, h.b].includes(tb.id))
		claim("    and their meeting is an impact of its own (the run's impacts list it)", hit)
	}
	// A Newton's cradle of five 6 cm steel balls touching (gap 0, the slider's least) on 40 cm strings, its first ball let go from 35°: one ball goes out
	// on the far side, as far as the e of steel on steel (0.95, four strikes in a row) lets it; the middle ones stay. Two went out before the repair.
	{
		const [d] = build([sceneOf([{ id: "c", type: "newtons-cradle", x: 1.3, y: 0.55, props: { count: 5, gap: 0, ball_diameter: 0.06, length: 0.4 } }], 3, 0.5)]) as [Doc]
		const bobs = d.solids.filter((x) => /^c\/bob\d$/.test(x.id)).map((x) => x.id)
		const F = runFrames(d)
		const rel = Math.round(0.5 / STEP)
		const x0 = Object.fromEntries(bobs.map((b) => [b, (F[0]?.[b] as P).x]))
		const reach = bobs.map((b) => {
			let m = 0
			for (let i = rel; i < Math.min(F.length, rel + Math.round(0.6 / STEP)); i++) m = Math.max(m, Math.abs((F[i]?.[b] as P).x - (x0[b] as number)))
			return m
		})
		const first = reach[0] as number
		const last = reach.at(-1) as number
		const middle = Math.max(...reach.slice(1, -1))
		claim(
			`Newton's cradle, 5 touching 6 cm balls, the first let go: swings ${reach.map((r) => (r * 1000).toFixed(1)).join(" / ")} mm: the last ball out ${((last / first) * 100).toFixed(0)}% as far (at least 80), none of the others over 5% (${((middle / first) * 100).toFixed(1)}%)`,
			last >= 0.8 * first && middle <= 0.05 * first
		)
	}
	// Nothing is struck where nothing strikes: a tennis ball resting on a basketball resting on the table stays put (no bounce from the lasting contacts).
	{
		const [d] = build([sceneOf([{ id: "bb", type: "basketball", x: 1.3, y: 0.2 }, { id: "tb", type: "tennis-ball", x: 1.3, y: 0.4 }], 2, 0.5)]) as [Doc]
		const top = d.solids.find((x) => x.id === "table/top") as Solid
		const tt = top.at.y + (top.body.height ?? 0) / 2
		const bb = d.solids.find((x) => x.id.startsWith("bb/")) as Solid
		const tb = d.solids.find((x) => x.id.startsWith("tb/")) as Solid
		bb.at.y = tt + (bb.body.radius ?? 0) + 0.0005
		tb.at.y = bb.at.y + (bb.body.radius ?? 0) + (tb.body.radius ?? 0) + 0.0005
		const F = runFrames(d)
		const rise = Math.max(...F.map((f) => (f[tb.id] as P).y - tb.at.y))
		claim(`a tennis ball resting on a basketball on the table: it never rises (at most ${(rise * 1000).toFixed(3)} mm over where it was set, at most 0.5)`, rise <= 0.0005)
	}
}

const which = process.argv[2] ?? "all"
for (const [name, fn] of Object.entries(tests)) if (which === "all" || which === name) await fn()
console.warn = warn
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`)
process.exitCode = failures === 0 ? 0 : 1
