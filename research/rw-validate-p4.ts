// Engine batch 2 validation (tooling/src/sim/physics.ts, 2026-10-15): (1) no scene crashes the engine, (2) restitution only on genuine
// impacts, so a ball on a sprung pad never comes back higher than it fell from, (3) stiff, light springs followed in sub-steps (no
// stiffness cap: periods and damping within 1% of theory), (4) springs with mass (a third of it moves with what they push, Rayleigh).
// Each test builds scenes (the catalog ones through machines/items.py itself), runs them at 480 Hz with every step kept, and compares
// what the engine does with theory, or, where there is none in closed form, with the same engine stepping 10 times finer (a copy made in
// a temporary folder). Run:
//   node --no-warnings research/rw-validate-p4.ts [crash|energy|stiff|mass|all]
//   ENGINE_DIR=<a folder holding physics.ts and document.ts> runs the same scenes on another copy of the engine.
//   FUZZ_N (default 5000) and FUZZ_JOBS (default 8): the crash fuzz's size (tools/parity/engine-fuzz.mjs, in that many processes).
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const DIR = process.env.ENGINE_DIR ?? `${PG}/tooling/src/sim`
type P = { x: number; y: number; angle: number }
type Track = { frames: { t: number; placements: Record<string, P> }[]; impacts?: unknown[] }
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
type Doc = {
	solids: { id: string; kind: string; body: { kind: string; radius?: number; width?: number; height?: number; depth?: number; wall?: number }; material: string; at: { x: number; y: number }; angle?: number }[]
	materials: Record<string, { density: number }>
	joints?: { kind: string; id: string; stiffness?: number; mass?: number; rest?: number; a?: string | null; b?: string | null }[]
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
const PY = `import sys, json; sys.path.insert(0, ${JSON.stringify(`${PG}/machines`)}); import items; print(json.dumps([items.build(s)[0] for s in json.load(sys.stdin)]))`
/** The engine documents machines/items.py builds for these scenes. */
const build = (scenes: unknown[]): Doc[] => JSON.parse(execFileSync("python3", ["-c", PY], { input: JSON.stringify(scenes), maxBuffer: 1 << 30 }).toString())
const PYM = `import sys, json; sys.path.insert(0, ${JSON.stringify(`${PG}/machines`)}); import items, catalog_mechanisms as c; print(json.dumps([c._spring_mass(k, x) for k, x in json.load(sys.stdin)]))`
/** catalog_mechanisms.py's own spring masses (kg) for these (stiffness, travel) pairs. */
const springMass = (pairs: [number, number][]): number[] => JSON.parse(execFileSync("python3", ["-c", PYM], { input: JSON.stringify(pairs) }).toString())

const tests: Record<string, () => void | Promise<void>> = {}

// ---------------------------------------------------------------- 1. no scene crashes the engine
tests.crash = async () => {
	console.log("CRASHES: every scene runs to its end, every placement finite; anything that still goes wrong is said in one line")
	// The review's scene (tools/parity/fuzz-live.mjs, seed 20261015, scene 1646): a crowded table where a Newton's cradle's strings and bobs are wedged
	// into a rubber duck and a catapult's post; planck's time-of-impact pass threw "Cannot read properties of undefined (reading 'x')" on both backends.
	// (as the server takes it: cleaned and built, here by web/sim, the exact port of web/server.py's clean() and machines/items.py)
	const scene = JSON.parse(readFileSync(`${PG}/tools/parity/fixtures/fuzz-1646.json`, "utf8"))
	const sim = (await import(`${PG}/web/sim/index.js`)) as { prepare: (scene: unknown) => { doc: Doc } }
	const d = sim.prepare(scene).doc
	try {
		const F = runFrames(d)
		const steps = F.length
		claim(`fuzz-1646 (${scene.items.length} items, ${(d as Doc).solids.length} solids): runs its ${scene.seconds} s (${steps} steps), every placement finite`, finite(F))
	} catch (e) {
		claim(`fuzz-1646: ${String(e).slice(0, 160)}`, false)
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

// ---------------------------------------------------------------- 2. restitution only on genuine impacts
/** A ball's highest point after it first comes down near the plate (where it started from: its drop height above the plate's top). */
const reboundTop = (y: readonly number[], landing: number) => {
	const i = y.findIndex((v) => v < landing)
	return i < 0 ? -Infinity : Math.max(...y.slice(i))
}
tests.energy = () => {
	console.log("RESTITUTION ONLY ON GENUINE IMPACTS: a ball dropped on a sprung pad never comes back higher than it fell from")
	// Every pad whose plate starts at rest on its springs (its own weight, and a third of its springs', held up by them): the plate and the springs
	// then start at the bottom of their energy, and the ball's is all there is; it can come back no higher than its start, less what its bounces and
	// the air took. Plates from 3.4 g to 3.8 kg, springs from 50 to 10000 N/m (no cap), balls from a 2.7 g ping-pong ball (e 0.96) to a 7.3 kg bowling
	// ball (e 0.65), dropped 0.1, 0.5 and 2 m. (The engine before this batch, on these same pads: a steel ball dropped 2 m on a 6 × 2 cm rubber plate at
	// 1000 N/m came back 4.9 m above its start: the restitution was applied again as the plate, sprung back up within the step, met the ball at the
	// speed its spring had just given it, and a light plate on a stiff spring was stepped too coarsely to follow the exchange of strikes.)
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
		const plate = d.solids.find((x) => x.id === "p/plate") as Doc["solids"][number]
		const ballSolid = d.solids.find((x) => x.id.startsWith("b/")) as Doc["solids"][number]
		const springs = (d.joints ?? []).filter((j) => j.kind === "spring")
		const k = springs.reduce((sum, j) => sum + (j.stiffness ?? 0), 0)
		const carried = springs.reduce((sum, j) => sum + (j.mass ?? 0) / 3, 0)
		const mp = (plate.body.width ?? 0) * (plate.body.height ?? 0) * (plate.body.depth ?? 0) * (d.materials[plate.material]?.density ?? 0)
		const rest = (springs[0]?.rest as number) ?? 0
		// held up by its springs (not sitting on their closed coils): the spring's push at the plate's start carries its weight
		const solid = Math.max(5, Math.min(24, Math.trunc(rest / 0.01))) * 0.002 + 0.004
		if (((mp + carried) * G) / k > rest - solid) {
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
			worstCase = `${c.ball} from ${c.h} m on ${c.props.width} × ${c.props.depth} m ${c.props.material} at ${c.props.stiffness} N/m`
		}
		lost += Math.max(0, -over) / c.h
		if (process.env.VERBOSE) console.log(`    ${c.ball} from ${c.h} m on ${c.props.width} × ${c.props.depth} m ${c.props.material} at ${c.props.stiffness} N/m: back to ${(over * 1000).toFixed(2)} mm of its start`)
	}
	claim(
		`${ran} drops (${skipped} left out: pads too soft to hold their plate up, balls that landed on a narrow pad's rails): the highest any ball came back is ${(worst * 1000).toFixed(2)} mm from its start (${worstCase}); on average ${((lost / ran) * 100).toFixed(1)}% of the drop lost`,
		worst <= 0.0005
	)
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
 * free of the sampling (as long as θ < π).
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
	return { theta: Math.acos(p / (2 * r)), r }
}
tests.stiff = async () => {
	console.log("STIFF, LIGHT SPRINGS: solved in sub-steps (no stiffness cap): periods and damping within 1% of theory, no energy gain")
	// A bob of mass m on a spring from a fixed point (no gravity's lean: it hangs straight), stretched 1 mm and let go: ω·h from 0.3 to 2.8 a 480 Hz step
	// (above √2 the step alone solved part of the spring implicitly: the swing slowed and died; the catalog capped every spring at 1.2)
	const bob = (omegaH: number, zeta: number) => {
		const m = 0.05
		const k = m * (omegaH / STEP) ** 2
		const c = 2 * zeta * Math.sqrt(k * m)
		const r = Math.cbrt((3 * m) / (4 * Math.PI * 20000))
		const rest = 0.2
		const sag = ((m - AIR * (m / 20000)) * G) / k
		const F = runFrames(
			doc({
				solids: [s({ kind: "dynamic", id: "bob", words: "bob", body: { kind: "ball", radius: r }, material: "dense", at: { x: 0, y: 1 - rest - sag - 0.001 } })],
				joints: [{ kind: "spring", id: "s", a: null, b: "bob", anchorA: { x: 0, y: 1 }, anchorB: { x: 0, y: 0 }, rest, stiffness: k, damping: c }],
				seconds: 0.3
			})
		)
		const centre = 1 - rest - sag
		return { x: F.slice(1, 120).map((f) => (f.bob as P).y - centre), k, m, c }
	}
	for (const omegaH of [0.3, 0.8, 1.4, 2.0, 2.8])
		for (const zeta of [0, 0.05]) {
			const { x } = bob(omegaH, zeta)
			const { theta, r } = prony(x)
			// the air carried by the bob (half its volume's worth) and its drag are a hair of its 50 g: the theory's mass includes the air it carries
			const label = `bob on a spring, ω·h ${omegaH.toFixed(1)} a 480 Hz step${zeta > 0 ? `, ζ ${zeta}` : ""}`
			check(`${label}: its turn a step (period)`, theta, omegaH * Math.sqrt(1 - zeta * zeta), 0.01, " rad")
			if (zeta > 0) check(`${label}: its damping ratio`, -Math.log(r) / omegaH, zeta, 0.01)
			else claim(`${label}: no energy gain, its swing keeps ${(r ** 480 * 100).toFixed(3)}% of itself over a second (at most 100%)`, r <= 1 + 1e-9)
		}
	// The catalog's sprung items uncapped: the stiffest, smallest launcher pressed as far as it goes, with a ping-pong ball and a steel ball, against the
	// same engine at 4800 Hz (research/rw-validate-p3.ts has its default and 10 cm launchers, the pads and the trampolines).
	const fine = await fineEngine(4800)
	for (const [label, props, ball] of [
		["the stiffest and smallest, pressed 45 cm (5000 N/m on 50 cm springs, 6 × 2 cm plate)", { stiffness: 5000, compression: 0.45, rest_length: 0.5, width: 0.06, depth: 0.02, damping: 0 }, "ping-pong-ball"],
		["the stiffest and smallest, pressed 45 cm", { stiffness: 5000, compression: 0.45, rest_length: 0.5, width: 0.06, depth: 0.02, damping: 0 }, "steel-ball"]
	] as const) {
		const [bare] = build([sceneOf([{ id: "p", type: "spring-launcher", x: 1.3, y: 0, props }], 3)])
		const plate0 = (bare as Doc).solids.find((x) => x.id === "p/plate") as Doc["solids"][number]
		const [d] = build([sceneOf([{ id: "p", type: "spring-launcher", x: 1.3, y: 0, props }, { id: "b", type: ball, x: 1.3, y: plate0.at.y + 0.05, held: false, rest: true }], 3)])
		const sol = (d as Doc).solids.find((x) => x.id.startsWith("b/")) as Doc["solids"][number]
		const plate = (d as Doc).solids.find((x) => x.id === "p/plate") as Doc["solids"][number]
		sol.at.y = plate.at.y + (plate.body.height ?? 0) / 2 + (sol.body.radius ?? 0) + 0.0002
		const speed = (track: Track) => {
			let v = 0
			for (let k = 1; k < track.frames.length; k++) v = Math.max(v, ((track.frames[k]?.placements[sol.id] as P).y - (track.frames[k - 1]?.placements[sol.id] as P).y) / STEP)
			return v
		}
		check(`spring launcher ${label}, ${ball}: the speed it throws at`, speed(simulate(admitDocument(d).scene, 480)), speed(fine(d)), 0.01, " m/s", "at 4800 Hz")
	}
}

// ---------------------------------------------------------------- 4. springs with mass
tests.mass = () => {
	console.log("SPRING MASS: a third of a spring's own steel moves with what it pushes (Rayleigh), the steel it needs for its travel (catalog_mechanisms.py)")
	// A launcher's plate and ball, at the spring's rest length (where its push ends: the ball has every joule it gets), against the energy balance
	// ½k·x² = ½(m + m_b + mₛ/3)·v² + (m + m_b + mₛ/3)·g·x, the plate and the ball and a third of the springs' steel lifted x as they are thrown.
	const cases: [string, Record<string, number | string>, string][] = [
		["at its defaults (800 N/m, held 6 cm)", {}, "golf-ball"],
		["5000 N/m held 45 cm on 50 cm springs, 6 × 2 cm plate", { stiffness: 5000, compression: 0.45, rest_length: 0.5, width: 0.06, depth: 0.02, damping: 0 }, "ping-pong-ball"],
		["5000 N/m held 45 cm on 50 cm springs, 6 × 2 cm plate", { stiffness: 5000, compression: 0.45, rest_length: 0.5, width: 0.06, depth: 0.02, damping: 0 }, "steel-ball"],
		["2000 N/m held 20 cm on 30 cm springs, 60 × 60 cm aluminium plate", { stiffness: 2000, compression: 0.2, rest_length: 0.3, width: 0.6, depth: 0.6, damping: 0, material: "aluminium" }, "bowling-ball"]
	]
	for (const [label, props, ball] of cases) {
		const [bare] = build([sceneOf([{ id: "p", type: "spring-launcher", x: 1.3, y: 0, props: { damping: 0, ...props } }], 3)])
		const plate0 = (bare as Doc).solids.find((x) => x.id === "p/plate") as Doc["solids"][number]
		const [d] = build([sceneOf([{ id: "p", type: "spring-launcher", x: 1.3, y: 0, props: { damping: 0, ...props } }, { id: "b", type: ball, x: 1.3, y: plate0.at.y + 0.2, held: false, rest: true }], 3)])
		const dd = d as Doc
		const sol = dd.solids.find((x) => x.id.startsWith("b/")) as Doc["solids"][number]
		const plate = dd.solids.find((x) => x.id === "p/plate") as Doc["solids"][number]
		sol.at.y = plate.at.y + (plate.body.height ?? 0) / 2 + (sol.body.radius ?? 0) + 0.0002
		const springs = (dd.joints ?? []).filter((j) => j.kind === "spring")
		const k = springs.reduce((sum, j) => sum + (j.stiffness ?? 0), 0)
		const ms = springs.reduce((sum, j) => sum + (j.mass ?? 0), 0)
		const rest = springs[0]?.rest ?? 0
		const mp = (plate.body.width ?? 0) * (plate.body.height ?? 0) * (plate.body.depth ?? 0) * (dd.materials[plate.material]?.density ?? 0)
		const r = sol.body.radius ?? 0
		const ballVolume = (4 / 3) * Math.PI * r ** 3
		const inner = Math.max(0, r - (sol.body.wall ?? r))
		const mb = (sol.body.wall === undefined ? ballVolume : ballVolume - (4 / 3) * Math.PI * inner ** 3) * (dd.materials[sol.material]?.density ?? 0)
		// the ball's air: what it encloses and half its volume ride with it (inertia, no weight); the plate's and the ball's buoyancy lift a little
		const carriedAir = AIR * ((4 / 3) * Math.PI * inner ** 3 + 0.5 * ballVolume)
		const lift = AIR * ((plate.body.width ?? 0) * (plate.body.height ?? 0) * (plate.body.depth ?? 0) + (sol.body.wall === undefined ? ballVolume : ballVolume - (4 / 3) * Math.PI * inner ** 3))
		// the plate's travel from where it is held to its springs' rest length (they run from the base's top, y 0, to the plate's underside)
		const x = rest - (plate.at.y - (plate.body.height ?? 0) / 2)
		const moving = mp + mb + ms / 3
		const v2 = (k * x * x - 2 * (moving - lift) * G * x) / (moving + carriedAir)
		// the engine: the ball's speed when the plate's springs reach their rest length (the plate's underside at the rest length)
		const F = runFrames(d)
		let v = 0
		for (let i = 1; i < F.length; i++) {
			const pb = (F[i]?.["p/plate"] as P).y - (plate.body.height ?? 0) / 2
			if (pb < rest) continue
			const prev = (F[i - 1]?.["p/plate"] as P).y - (plate.body.height ?? 0) / 2
			// (interpolated to the moment the plate passes its rest: the ball's speed then, from its step's motion)
			const t = (rest - prev) / (pb - prev)
			const vb = ((F[i]?.[sol.id] as P).y - (F[i - 1]?.[sol.id] as P).y) / STEP
			const vb0 = ((F[i - 1]?.[sol.id] as P).y - (F[i - 2]?.[sol.id] as P).y) / STEP
			v = vb0 + t * (vb - vb0)
			break
		}
		const massless = Math.sqrt((k * x * x - 2 * (mp + mb - lift) * G * x) / (mp + mb + carriedAir))
		console.log(`  launcher ${label}, ${ball}: springs ${k} N/m with ${(ms * 1000).toFixed(1)} g of steel (a third moves), plate ${(mp * 1000).toFixed(1)} g, ball ${(mb * 1000).toFixed(1)} g, pressed ${(x * 100).toFixed(1)} cm`)
		check(`    its throw at the springs' rest length: ½kx² = ½(m + m_b + mₛ/3)v² + lift (were the springs weightless: ${massless.toFixed(1)} m/s)`, v, Math.sqrt(v2), 0.01, " m/s", "energy balance")
	}
	// A weight on a hanging spring swings at 2π√((m + mₛ/3)/k) (Rayleigh): the catalog's, made stiff and its steel heavy against a light weight.
	for (const props of [{}, { stiffness: 500, weight: 0.05, rest_length: 1.0, start_stretch: 0.05, damping: 0 }]) {
		const [d] = build([sceneOf([{ id: "s", type: "hanging-spring", x: 1.3, y: 2.2, props: { damping: 0, ...props } }], 4, 0.5)])
		const dd = d as Doc
		const spring = (dd.joints ?? []).find((j) => j.kind === "spring") as NonNullable<Doc["joints"]>[number]
		const w = dd.solids.find((x) => x.id === "s/weight") as Doc["solids"][number]
		const m = (w.body.width ?? 0) * (w.body.height ?? 0) * (w.body.depth ?? 0) * (dd.materials[w.material]?.density ?? 0)
		const ms = spring.mass ?? 0
		const k = spring.stiffness ?? 0
		const F = runFrames(d).slice(Math.round(0.5 / STEP) + 1)
		const y = F.map((f) => (f["s/weight"] as P).y)
		const mid = (Math.max(...y) + Math.min(...y)) / 2
		const ups: number[] = []
		for (let i = 1; i < y.length; i++) if ((y[i - 1] as number) < mid && (y[i] as number) >= mid) ups.push(i - 1 + (mid - (y[i - 1] as number)) / ((y[i] as number) - (y[i - 1] as number)))
		const T = (((ups.at(-1) ?? 0) - (ups[0] ?? 0)) / (ups.length - 1)) * STEP
		const want = 2 * Math.PI * Math.sqrt((m + ms / 3) / k)
		check(
			`hanging spring ${JSON.stringify(props)}: ${k} N/m, ${(ms * 1000).toFixed(1)} g of steel, ${(m * 1000).toFixed(0)} g weight: its period (weightless spring: ${(2 * Math.PI * Math.sqrt(m / k)).toFixed(4)} s)`,
			T,
			want,
			0.01,
			" s",
			"2π√((m + mₛ/3)/k)"
		)
	}
	// The catalog's own spring masses: the steel a coil spring needs to store its travel's energy at its working stress (5.1 g a joule).
	const [m1, m2] = springMass([
		[400, 0.06],
		[2500, 0.45]
	])
	console.log(`  catalog spring masses: 400 N/m for 6 cm ${((m1 as number) * 1000).toFixed(2)} g, 2500 N/m for 45 cm ${((m2 as number) * 1000).toFixed(0)} g`)
}

const which = process.argv[2] ?? "all"
for (const [name, fn] of Object.entries(tests)) if (which === "all" || which === name) await fn()
console.warn = warn
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`)
process.exitCode = failures === 0 ? 0 : 1
