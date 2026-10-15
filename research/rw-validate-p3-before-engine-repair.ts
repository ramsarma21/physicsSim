// Engine batch validation (tooling/src/sim/physics.ts, October 2026): rigid weld groups, unconditionally stable springs, pulley rope-end
// stops and a rope that never pushes, energy-correct pins and ropes in big swings, hinge friction and angular damping, colliding chains,
// and wheel loads from the chassis's centre of mass. Each test builds scenes (some through the catalog itself, machines/items.py), runs
// them at 480 Hz with every step kept, and compares what the engine does with theory. Run:
//   node --no-warnings research/rw-validate-p3.ts [weld|spring|pulley|swing|friction|chain|wheel|all]
//   ENGINE_DIR=<a folder holding physics.ts and document.ts> runs the same scenes on another copy of the engine (the numbers before
//   this batch: the checks then report what that engine does; they are written for this one).
import { execFileSync } from "node:child_process"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const DIR = process.env.ENGINE_DIR ?? `${PG}/tooling/src/sim`
const { simulate } = (await import(`${DIR}/physics.ts`)) as { simulate: (scene: unknown, fps: number) => { frames: { t: number; placements: Record<string, P> }[]; impacts?: unknown[] } }
const { admitDocument } = (await import(`${DIR}/document.ts`)) as { admitDocument: (doc: unknown) => { scene: unknown } }

const G = 9.81
const STEP = 1 / 480
const D2R = Math.PI / 180
const AIR = 1.2
type P = { x: number; y: number; angle: number }
type V = { x: number; y: number }
type Doc = {
	solids: { id: string; kind: string; body: { kind: string; radius?: number; width?: number; height?: number; depth?: number; wall?: number; inertia?: number }; material: string; at: V; angle?: number; pivot?: V; parent?: string }[]
	materials: Record<string, { density: number }>
	joints?: Record<string, unknown>[]
	release: { at: number }
	[k: string]: unknown
}
const s = (o: Record<string, unknown>) => ({ placeholder: { fill: "#888" }, render: { kind: "procedural", shade: "#666" }, depth: 1, ...o })
const doc = (o: { materials?: Record<string, unknown>; contacts?: unknown[]; solids: unknown[]; joints?: unknown[]; seconds: number }) => ({
	version: 1,
	id: "rw3",
	camera: { canvas: { width: 10, height: 10 }, origin: { x: 0, y: 0 }, pixel: { x: 0, y: 0 }, pixelsPerMeter: 1 },
	animated: [],
	organic: [],
	release: { parts: [], at: 0 },
	sprites: {},
	materials: { dense: { density: 20000 }, steel: { density: 7850 }, wood: { density: 700 }, rubber: { density: 1100 }, light: { density: 300 } },
	contacts: [],
	...o
})
const runFrames = (d: unknown) => simulate(admitDocument(d).scene, 480).frames.map((f) => f.placements)
const timed = (d: unknown) => {
	const t0 = performance.now()
	const frames = runFrames(d)
	return { frames, ms: performance.now() - t0 }
}
const pct = (got: number, want: number) => `${(((got - want) / want) * 100).toFixed(3)}%`
let failures = 0
const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL")
const check = (label: string, got: number, want: number, tol: number, unit = "") => {
	const ok = Math.abs(got - want) <= Math.abs(want) * tol
	if (!ok) failures++
	console.log(`  ${verdict(ok)} ${label}: engine ${got.toFixed(5)}${unit}, theory ${want.toFixed(5)}${unit} (${pct(got, want)}, within ${(tol * 100).toFixed(2)}%)`)
}
const claim = (label: string, ok: boolean) => {
	if (!ok) failures++
	console.log(`  ${verdict(ok)} ${label}`)
}
const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y)
/** A point of a solid's own frame where its placement puts it. */
const at = (p: P, q: V): V => ({ x: p.x + q.x * Math.cos(p.angle) - q.y * Math.sin(p.angle), y: p.y + q.x * Math.sin(p.angle) + q.y * Math.cos(p.angle) })

// ---------------------------------------------------------------- catalog scenes, built by machines/items.py itself
const STAGE = { x0: -0.55908203125, x1: 3.19091796875, y0: -0.15625, y1: 2.34375 }
const TABLE = { id: "table", type: "table", name: "Table", x: 1.3, y: 0.0, props: { width: 3.7, thickness: 0.15 } }
const sceneOf = (items: unknown[], seconds = 3, release = 0.5) => ({ version: 2, id: "p3", name: "p3", seconds, release, stage: STAGE, items: [TABLE, ...items], goals: [] })
const PY = `import sys, json; sys.path.insert(0, ${JSON.stringify(`${PG}/machines`)}); import items; print(json.dumps([items.build(s)[0] for s in json.load(sys.stdin)]))`
/** The engine documents machines/items.py builds for these scenes. */
const build = (scenes: unknown[]): Doc[] => JSON.parse(execFileSync("python3", ["-c", PY], { input: JSON.stringify(scenes), maxBuffer: 1 << 30 }).toString())

/** The world point a solid's pivot is at, at the start (its parent is the world). */
const pivotOf = (d: Doc, id: string) => {
	const sol = d.solids.find((x) => x.id === id)
	if (sol?.pivot === undefined) throw new Error(`${id} has no pivot`)
	return at({ x: sol.at.x, y: sol.at.y, angle: sol.angle ?? 0 }, sol.pivot)
}

/** Complete elliptic integral of the first kind K(k), by the arithmetic-geometric mean. */
const ellipticK = (k: number) => {
	let a = 1
	let b = Math.sqrt(1 - k * k)
	for (let i = 0; i < 30; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]
	return Math.PI / (2 * a)
}
/**
 * A rigid pendulum's period about a fixed pivot from the parts of the doc that hang on it (their own masses, the
 * air a ball carries as inertia, the air's buoyancy off their weight), at amplitude a0: 4 √(I/(M g d)) K(sin(a0/2)).
 */
const pendulumPeriod = (d: Doc, ids: readonly string[], pivot: V, a0: number) => {
	let I = 0
	let moment = 0
	for (const id of ids) {
		const sol = d.solids.find((x) => x.id === id)
		if (sol === undefined) throw new Error(id)
		const rho = d.materials[sol.material]?.density ?? 0
		// the part's centre at the start, from its own pose (a child's `at` is in its parent's frame)
		const parent = sol.parent === undefined ? undefined : d.solids.find((x) => x.id === sol.parent)
		const c = parent === undefined ? sol.at : at({ x: parent.at.x, y: parent.at.y, angle: parent.angle ?? 0 }, sol.at)
		const r2 = (c.x - pivot.x) ** 2 + (c.y - pivot.y) ** 2
		const b = sol.body
		if (b.kind === "ball") {
			const r = b.radius ?? 0
			const inner = Math.max(0, r - (b.wall ?? r))
			const vol = (4 / 3) * Math.PI * (r ** 3 - inner ** 3)
			const m = rho * vol
			const carried = AIR * (4 / 3) * Math.PI * (inner ** 3 + 0.5 * r ** 3)
			const k = b.inertia ?? (b.wall === undefined ? 2 / 5 : (2 / 5) * ((1 - (inner / r) ** 5) / (1 - (inner / r) ** 3)))
			I += k * m * r * r + (m + carried) * r2
			moment += (m - AIR * vol) * Math.sqrt(r2)
		} else {
			const w = b.width ?? 0
			const h = b.height ?? 0
			const vol = w * h * (b.depth ?? 0)
			const m = rho * vol
			I += (m * (w * w + h * h)) / 12 + m * r2
			moment += (m - AIR * vol) * Math.sqrt(r2)
		}
	}
	return 4 * Math.sqrt(I / (moment * G)) * ellipticK(Math.sin(a0 / 2))
}
/** Upward zero crossings of a series, linearly interpolated, in seconds from the series' start. */
const crossings = (y: readonly number[]) => {
	const out: number[] = []
	for (let k = 1; k < y.length; k++) if ((y[k - 1] as number) < 0 && (y[k] as number) >= 0) out.push((k - 1 + (y[k - 1] as number) / ((y[k - 1] as number) - (y[k] as number))) * STEP)
	return out
}
/** The turning points of a series (steps where it peaks or troughs), refined by a parabola. */
const extremes = (y: readonly number[]) => {
	const out: { t: number; v: number }[] = []
	for (let k = 1; k + 1 < y.length; k++) {
		const a = y[k - 1] as number
		const b = y[k] as number
		const c = y[k + 1] as number
		if ((b > a && b >= c) || (b < a && b <= c)) {
			const den = a - 2 * b + c
			const off = den === 0 ? 0 : (0.5 * (a - c)) / den
			out.push({ t: (k + off) * STEP, v: b - 0.25 * (a - c) * off })
		}
	}
	return out
}

const tests: Record<string, () => void> = {
	weld: () => {
		console.log("WELD GROUPS: a part with a parent and no pivot is part of its parent's body")
		// Pendulum: every corner of the sliders (length, bob weight, bob size, start angle), the hanger off (nothing to hit), and the
		// review's cases (10 kg bob) with the hanger on.
		const corners: Record<string, unknown>[] = []
		for (const length of [0.1, 2.0])
			for (const bob_mass of [0.01, 10])
				for (const bob_diameter of [0.01, 0.3])
					for (const start_angle of [-170, 170]) corners.push({ length, bob_mass, bob_diameter, start_angle, hanger: false })
		const review = [
			{ length: 0.5, bob_mass: 10, start_angle: 30 },
			{ length: 0.5, bob_mass: 10, start_angle: 90 },
			{ length: 0.2, bob_mass: 10, start_angle: 90 },
			{ length: 0.1, bob_mass: 10, start_angle: 140 },
			{ length: 0.1, bob_mass: 10, start_angle: 140, hanger: false }
		]
		const pend = [...corners, ...review]
		const docs = build(pend.map((props) => sceneOf([{ id: "p", type: "pendulum", x: 1.3, y: 2.2, props }], 3)))
		let worst = 0
		let worstCase = ""
		let worstPivot = 0
		for (const [i, d] of docs.entries()) {
			const pivot = pivotOf(d, "p/rod")
			const F = runFrames(d)
			const L0 = dist(F[0]?.["p/bob"] as P, pivot)
			let stretch = 0
			let drift = 0
			for (const f of F) {
				stretch = Math.max(stretch, Math.abs(dist(f["p/bob"] as P, pivot) - L0))
				const rod = d.solids.find((x) => x.id === "p/rod")
				drift = Math.max(drift, dist(at(f["p/rod"] as P, rod?.pivot ?? { x: 0, y: 0 }), pivot))
			}
			if (stretch > worst) {
				worst = stretch
				worstCase = JSON.stringify(pend[i])
			}
			worstPivot = Math.max(worstPivot, drift)
			if (i >= corners.length) console.log(`  pendulum ${JSON.stringify(pend[i])}: bob-to-pivot stretch at most ${(stretch * 1000).toFixed(3)} mm, pivot drift ${(drift * 1000).toFixed(3)} mm`)
		}
		claim(`pendulum, ${pend.length} cases (all ${corners.length} slider corners and the review's 10 kg cases): bob-to-pivot stretch at most ${(worst * 1000).toFixed(4)} mm (${worstCase}); its hinge at most ${(worstPivot * 1000).toFixed(4)} mm off the pivot`, worst < 5e-6 && worstPivot < 5e-6)
		// Newton's cradle: every corner of its sliders, the frame on and off. A ball is welded to its string, so it never moves on it at all;
		// its string's hinge holds wherever the start pose is clear (the first ball pulled outward, the frame off). Pulled inward (+90°) the first
		// ball starts inside the row, and with the frame on, a ball pulled level starts inside the top bar (2.5 mm over the pivots): the
		// contacts push them out at the release, against the hinges (the catalog's start poses, reported here, not the engine's to fix).
		const cr: Record<string, unknown>[] = []
		for (const frame of [true, false])
			for (const count of [2, 9])
				for (const ball_diameter of [0.01, 0.15])
					for (const length of [0.1, 1.0])
						for (const start_angle of [-90, 90]) for (const gap of [0, 0.01]) cr.push({ count, ball_diameter, length, start_angle, gap, frame })
		const cdocs = build(cr.map((props) => sceneOf([{ id: "c", type: "newtons-cradle", x: 0.8, y: 2.2, props }], 3)))
		let weldWorst = 0
		const hinge = { clear: 0, clearCase: "", inward: 0, bar: 0 }
		for (const [i, d] of cdocs.entries()) {
			const F = runFrames(d)
			const props = cr[i] as { count: number; start_angle: number; frame: boolean }
			for (let b = 1; b <= props.count; b++) {
				const rod = d.solids.find((x) => x.id === `c/rod${b}`)
				const bob = d.solids.find((x) => x.id === `c/bob${b}`)
				const pivot = pivotOf(d, `c/rod${b}`)
				let drift = 0
				for (const f of F) {
					// the ball against where its string's frame holds it (its weld), and the string's hinge against the pivot
					weldWorst = Math.max(weldWorst, dist(f[`c/bob${b}`] as P, at(f[`c/rod${b}`] as P, bob?.at ?? { x: 0, y: 0 })))
					drift = Math.max(drift, dist(at(f[`c/rod${b}`] as P, rod?.pivot ?? { x: 0, y: 0 }), pivot))
				}
				if (props.start_angle > 0) hinge.inward = Math.max(hinge.inward, drift)
				else if (props.frame) hinge.bar = Math.max(hinge.bar, drift)
				else if (drift > hinge.clear) {
					hinge.clear = drift
					hinge.clearCase = JSON.stringify(props)
				}
			}
		}
		claim(`Newton's cradle, all ${cr.length} slider corners (frame on and off): a ball at most ${(weldWorst * 1000).toFixed(6)} mm off its string's end (welded: one body)`, weldWorst < 1e-9)
		claim(`  the strings' hinges, the ${cr.length / 4} corners whose start is clear (first ball pulled out, frame off): at most ${(hinge.clear * 1000).toFixed(4)} mm off their pivots`, hinge.clear < 1e-6)
		console.log(`  (start poses that overlap, pushed apart at the release: first ball pulled +90° into the row, at most ${(hinge.inward * 1000).toFixed(3)} mm; pulled level with the frame on, starting inside its top bar, ${(hinge.bar * 1000).toFixed(3)} mm)`)
		// The swing keeps its period: the default pendulum and the 10 kg one at 30 degrees against the rigid pendulum's.
		for (const props of [{ start_angle: 30, hanger: false }, { start_angle: 30, bob_mass: 10, hanger: false }, { start_angle: 90, bob_mass: 10, hanger: false }]) {
			const [d] = build([sceneOf([{ id: "p", type: "pendulum", x: 1.3, y: 2.2, props }], 6.5)])
			if (d === undefined) continue
			const pivot = pivotOf(d, "p/rod")
			const F = runFrames(d).slice(Math.round(d.release.at / STEP) + 1)
			const up = crossings(F.map((f) => (f["p/bob"] as P).x - pivot.x))
			const period = ((up.at(-1) as number) - (up[0] as number)) / (up.length - 1)
			check(`pendulum ${JSON.stringify(props)}: period over ${up.length - 1} swings`, period, pendulumPeriod(d, ["p/rod", "p/bob"], pivot, Number(props.start_angle) * D2R), 0.003, " s")
		}
		// A welded pail floor and its walls never collide with each other: a stack of pieces welded touching each other stays in one piece.
		const box = (id: string, x: number, y: number, w: number, h: number, parent?: string) =>
			s({ kind: "dynamic", id, words: id, body: { kind: "slab", width: w, height: h, depth: 0.05 }, material: "steel", at: { x, y }, ...(parent === undefined ? {} : { parent }) })
		const floor = s({ kind: "static", id: "floor", words: "floor", body: { kind: "slab", width: 2, height: 0.1, depth: 0.2 }, material: "wood", at: { x: 0, y: -0.05 } })
		const pail = run3(
			doc({
				solids: [floor, box("base", 0, 0.5, 0.1, 0.003), box("w1", -0.0485, 0.0365, 0.003, 0.07, "base"), box("w2", 0.0485, 0.0365, 0.003, 0.07, "base"), box("lid", 0, 0.072, 0.1, 0.003, "w1")],
				contacts: [{ between: ["steel", "wood"], friction: 0.5, restitution: 0.3, rollingResistance: 0 }],
				seconds: 1.5
			})
		)
		const last = pail.at(-1) as Record<string, P>
		const rel = (id: string, local: V) => dist(last[id] as P, at(last.base as P, local))
		claim(
			`a welded box whose walls touch its floor and lid (pieces welded to one another, not only to the root) lands whole: pieces off their places by at most ${(Math.max(rel("w1", { x: -0.0485, y: 0.0365 }), rel("w2", { x: 0.0485, y: 0.0365 })) * 1000).toFixed(4)} mm`,
			Math.max(rel("w1", { x: -0.0485, y: 0.0365 }), rel("w2", { x: 0.0485, y: 0.0365 })) < 1e-9
		)
	}
}

const run3 = (d: unknown) => runFrames(d)

/** A dense ball of `mass` kg (radius from 20000 kg/m³) hung on a vertical spring from a world point, starting `from` m below the spring's rest length. */
const hung = (k: number, c: number, mass: number, seconds: number, from = 0) => {
	const r = Math.cbrt((3 * mass) / (4 * Math.PI * 20000))
	const top = 1.5
	const rest = 0.3
	const F = run3(
		doc({
			solids: [s({ kind: "dynamic", id: "bob", words: "bob", body: { kind: "ball", radius: r }, material: "dense", at: { x: 0, y: top - rest - from } })],
			joints: [{ kind: "spring", id: "s", a: null, b: "bob", anchorA: { x: 0, y: top }, anchorB: { x: 0, y: 0 }, rest, stiffness: k, damping: c }],
			seconds
		})
	)
	// its rest: m·g less the air's lift (the air it carries is inertia only) over k, below the spring's rest length
	const centre = top - rest - ((mass - AIR * (mass / 20000)) * G) / k
	return { y: F.map((f) => (f.bob as P).y), centre }
}

/**
 * A plate of `mass` kg on two springs (a bounce pad or a launcher, uncapped: any stiffness and damping), pressed `press` m from where it
 * rests and let go. Standing on its springs over a fixed base between two guide rails, as the catalog's pads do (a plate standing on two
 * springs alone buckles sideways like a column, as a real one would), or hanging from a fixed bar on them (`hang`: they pull). Returns its
 * track and the most speed its start's energy allows it (½·k·press², gravity's share cancelling about the rest point).
 */
const plate = (mass: number, k: number, c: number, press: number, seconds = 3, extra: unknown[] = [], pushOnly = false, hang = false) => {
	const W = 0.12
	const th = 0.004
	const depth = mass / (7850 * W * th)
	const rest = 0.08
	const sag = ((mass - AIR * (mass / 7850)) * G) / k
	const fixed = (id: string, x: number, y: number, w: number, h: number) =>
		s({ kind: "static", id, words: id, body: { kind: "slab", width: w, height: h, depth: 0.1 }, material: "wood", at: { x, y } })
	// standing: the plate's middle over the base's top (y = 0); hanging: under the bar's underside (y = 0.3)
	const restY = hang ? 0.3 - rest - sag - th / 2 : rest - sag + th / 2
	const y0 = hang ? restY - press : restY - press
	const springs = [-0.04, 0.04].map((x, n) => ({
		kind: "spring",
		id: `s${n}`,
		a: hang ? "bar" : "base",
		b: "plate",
		anchorA: { x, y: hang ? -0.01 : 0.01 },
		anchorB: { x, y: hang ? th / 2 : -th / 2 },
		rest,
		stiffness: k / 2,
		damping: c / 2,
		...(pushOnly ? { compressOnly: true } : {})
	}))
	const F = run3(
		doc({
			solids: [
				...(hang ? [fixed("bar", 0, 0.31, 0.2, 0.02)] : [fixed("base", 0, -0.01, 0.2, 0.02), fixed("rail1", -(W / 2 + 0.007), 0.1, 0.006, 0.2), fixed("rail2", W / 2 + 0.007, 0.1, 0.006, 0.2)]),
				s({ kind: "dynamic", id: "plate", words: "plate", body: { kind: "slab", width: W, height: th, depth }, material: "steel", at: { x: 0, y: y0 } }),
				...extra
			],
			contacts: [{ between: ["steel", "wood"], friction: 0.3, restitution: 0, rollingResistance: 0 }],
			joints: springs,
			seconds
		})
	)
	const vmax = Math.sqrt((k * press * press) / mass)
	return { F, vmax, rest: restY }
}
const speedOf = (F: Record<string, P>[], id: string) => {
	let v = 0
	for (let k = 1; k < F.length; k++) v = Math.max(v, dist(F[k]?.[id] as P, F[k - 1]?.[id] as P) / STEP)
	return v
}

tests.spring = () => {
	console.log("SPRINGS: explicit Hooke force, trapezoidal damping solved in the step, implicit stiffness only for a spring the step cannot follow")
	// Analytic period and damping ratio of a hung 1 kg bob: T = 2π/(ω√(1-ζ²)), successive peaks in the ratio exp(-2πζ/√(1-ζ²)).
	for (const [k, zeta] of [
		[200, 0],
		[200, 0.1],
		[5000, 0.02],
		[50, 0.3]
	] as const) {
		const m = 1
		const c = 2 * zeta * Math.sqrt(k * m)
		const { y, centre } = hung(k, c, m, 6, 0.02)
		const wd = Math.sqrt(k / m) * Math.sqrt(1 - zeta * zeta)
		// the turning points while the swing is still more than 1% of its first (later ones are lost in the air's drag)
		const turns = extremes(y.map((v) => v - centre))
		const big = turns.filter((e) => Math.abs(e.v) > 0.01 * Math.abs(turns[0]?.v ?? 0))
		const tops = big.filter((e) => e.v > 0)
		const period = ((tops.at(-1)?.t ?? 0) - (tops[0]?.t ?? 0)) / (tops.length - 1)
		console.log(`  ${k} N/m, ζ ${zeta} (c ${c.toFixed(3)} N·s/m), 1 kg: ω·dt ${(Math.sqrt(k / m) * STEP).toFixed(3)}`)
		check(`    period (over ${tops.length - 1})`, period, (2 * Math.PI) / wd, 0.002, " s")
		if (zeta > 0) {
			const ratios = tops.slice(1, 4).map((p, i) => p.v / (tops[i]?.v ?? 1))
			check(`    amplitude ratio per period (mean of ${ratios.length})`, mean(ratios), Math.exp((-2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)), 0.005)
		} else {
			// undamped: only the air's drag takes energy. A drag F = ½ρ·Cd·πr²·v² on v = ωA·cos ωt takes ∮F·v dt = (4/3)·ρ·Cd·πr²·ω²A³ a period,
			// and E = ½kA², so the swing shrinks by ΔA = (4/3)·ρ·Cd·πr²·A²/m a period
			const A = tops[0]?.v ?? 0
			const r = Math.cbrt((3 * m) / (4 * Math.PI * 20000))
			const dragLoss = ((4 / 3) * AIR * 0.47 * Math.PI * r * r * A * A * (tops.length - 1)) / m
			const drift = (tops[0]?.v ?? 0) - (tops.at(-1)?.v ?? 0)
			check(`    undamped: its ${(A * 1000).toFixed(2)} mm swing's loss over ${tops.length - 1} periods, against the air's drag alone (energy otherwise kept)`, drift * 1e6, dragLoss * 1e6, 0.03, " µm")
		}
	}
	// A plate on two springs, uncapped (the catalog caps them for the old explicit spring), pressed 1 cm and let go: never faster than its
	// stored energy allows (but for the symplectic step's own swing, at most 1/√(1 − (ω·h)²/4) over it, 15% at ω·h = 1), never turned
	// past what its rails allow, and at rest on its springs at the end when damped.
	for (const hang of [false, true]) {
		let worst = 0
		let worstCase = ""
		let turned = 0
		let unsettled = 0
		let n = 0
		for (const mass of [0.005, 0.0145, 0.2])
			for (const k of [50, 1000, 1e5, 1e7])
				for (const c of [0, 0.5, 20, 1e3]) {
					const { F, vmax, rest } = plate(mass, k, c, 0.01, 3, [], false, hang)
					const v = speedOf(F, "plate")
					n++
					if (v / vmax > worst) {
						worst = v / vmax
						worstCase = `${mass * 1000} g, ${k} N/m, ${c} N·s/m`
					}
					const turn = Math.max(...F.map((f) => Math.abs((f.plate as P).angle)))
					turned = Math.max(turned, turn)
					// (a damper that takes longer than half a second to let the spring move it, c/k, is still creeping home: as it would)
					const off = Math.abs((F.at(-1)?.plate as P).y - rest)
					if (c > 0 && c / k < 0.5 && off > 0.001) unsettled++
					if (process.env.VERBOSE) console.log(`    ${mass} kg ${k} N/m ${c} N·s/m: ${v.toFixed(3)} m/s (${((v / vmax) * 100).toFixed(1)}%), turned ${(turn / D2R).toFixed(3)}°, ends ${(off * 1000).toFixed(3)} mm off rest`)
				}
		claim(
			`${n} light plates ${hang ? "hanging on two springs" : "standing on two springs between guide rails"} (5 g to 200 g, 50 N/m to 1e7 N/m, damping 0 to 1000 N·s/m, the catalog's caps lifted): fastest ${(worst * 100).toFixed(1)}% of the speed its stored energy allows (${worstCase}); turned at most ${(turned / D2R).toFixed(3)}°; ${unsettled} damped ones not at rest on their springs after 3 s`,
			worst < 1.16 && turned < 10 * D2R && unsettled === 0
		)
	}
	// The review's case: a 14.5 g bounce pad plate at damping 20 (before: it left at 344 m/s).
	const pad = plate(0.0145, 1000, 20, 0.0)
	claim(`bounce pad plate 14.5 g, 1000 N/m, damping 20, nothing touching it: fastest ${speedOf(pad.F, "plate").toFixed(4)} m/s`, speedOf(pad.F, "plate") < 0.01)
	// A ball dropped on a push-only pad (dead contact: the springs do all the bouncing) never comes back higher than it fell from.
	const ball = s({ kind: "dynamic", id: "ball", words: "ball", body: { kind: "ball", radius: 0.03 }, material: "dense", at: { x: 0, y: 0.4 } })
	const drop = plate(0.02, 2000, 0, 0, 4, [ball], true)
	const yb = drop.F.map((f) => (f.ball as P).y)
	// its apexes after the first landing: the local highs of its path once it has come down to the plate
	const landed = yb.findIndex((y) => y < drop.rest + 0.04)
	const apexes = extremes(yb.slice(landed)).filter((e, i, all) => i > 0 && e.v > (all[i - 1]?.v ?? 0))
	claim(`a 2.26 kg ball dropped onto a 20 g plate on push-only springs (dead contact, no damping): apexes ${apexes.slice(0, 5).map((a) => a.v.toFixed(4)).join(", ")} m, never above its 0.4 m start`, Math.max(...yb.slice(10)) <= 0.4 + 1e-6)
}

/** Least-squares a in x = x0 + v0·t + ½·a·t² over steps [k0, k1]. */
const accel = (x: readonly number[], k0: number, k1: number) => {
	const S = [0, 0, 0, 0, 0]
	const B = [0, 0, 0]
	for (let k = k0; k <= k1; k++) {
		const t = (k - k0) * STEP
		for (let p = 0; p < 5; p++) S[p] = (S[p] as number) + t ** p
		for (let p = 0; p < 3; p++) B[p] = (B[p] as number) + (x[k] as number) * t ** p
	}
	const M = [
		[S[0] as number, S[1] as number, S[2] as number],
		[S[1] as number, S[2] as number, S[3] as number],
		[S[2] as number, S[3] as number, S[4] as number]
	]
	const det = (m: number[][]) =>
		(m[0]?.[0] as number) * ((m[1]?.[1] as number) * (m[2]?.[2] as number) - (m[1]?.[2] as number) * (m[2]?.[1] as number)) -
		(m[0]?.[1] as number) * ((m[1]?.[0] as number) * (m[2]?.[2] as number) - (m[1]?.[2] as number) * (m[2]?.[0] as number)) +
		(m[0]?.[2] as number) * ((m[1]?.[0] as number) * (m[2]?.[1] as number) - (m[1]?.[1] as number) * (m[2]?.[0] as number))
	return (2 * det(M.map((row, i) => [row[0] as number, row[1] as number, B[i] as number]))) / det(M)
}

/** A cube of steel-weight density (8000 kg/m³, OIML) weighing `m` kg: its side. */
const cube = (m: number) => Math.cbrt(m / 8000)
/** Two cubes on a pulley over one wheel of radius R between ground points (±R, top): the Atwood machine, with no stops of its own. */
const atwood = (mA: number, mB: number, drop: number, seconds: number, extra: Record<string, unknown> = {}, floorY?: number) => {
	const R = 0.05
	const top = 1.5
	const sa = cube(mA)
	const sb = cube(mB)
	const solids = [
		s({ kind: "dynamic", id: "A", words: "A", body: { kind: "slab", width: sa, height: sa, depth: sa }, material: "weight", at: { x: -R, y: top - drop - sa / 2 } }),
		s({ kind: "dynamic", id: "B", words: "B", body: { kind: "slab", width: sb, height: sb, depth: sb }, material: "weight", at: { x: R, y: top - drop - sb / 2 } }),
		...(floorY === undefined ? [] : [s({ kind: "static", id: "floor", words: "floor", body: { kind: "slab", width: 1, height: 0.02, depth: 0.2 }, material: "wood", at: { x: 0, y: floorY - 0.01 } })])
	]
	const F = run3(
		doc({
			materials: { weight: { density: 8000 }, wood: { density: 700 } },
			contacts: [{ between: ["weight", "wood"], friction: 0.5, restitution: 0, rollingResistance: 0 }],
			solids,
			joints: [{ kind: "pulley", id: "p", a: "A", b: "B", groundA: { x: -R, y: top }, groundB: { x: R, y: top }, anchorA: { x: 0, y: sa / 2 }, anchorB: { x: 0, y: sb / 2 }, ratio: 1, wheelRadius: R, ...extra }],
			seconds
		})
	)
	return { F, R, top, sa, sb }
}

tests.pulley = () => {
	console.log("PULLEY: a rope that only pulls, and rope ends that jam at their wheels")
	// Atwood's acceleration, the rope taut: a = g(m1 − m2)/(m1 + m2).
	{
		const { F } = atwood(0.3, 0.2, 0.5, 0.6)
		const a = accel(F.map((f) => -(f.A as P).y), 2, F.length - 1)
		check("Atwood 0.3 kg and 0.2 kg: the heavy side's acceleration (least squares over 0.6 s)", a, (G * (0.3 - 0.2)) / 0.5, 0.005, " m/s²")
	}
	// The light side hauled up into its wheel by a side 60 times heavier, either way round, with no stops of the catalog's: it jams where its
	// top's inner corner meets the wheel (a circle of radius R tangent to its run at the ground point's height), and stays there; the heavy side stops with it.
	for (const [mA, mB] of [
		[0.05, 3],
		[3, 0.05]
	] as const) {
		const { F, R, top, sa, sb } = atwood(mA, mB, 0.45, 2)
		const light = mA < mB ? "A" : "B"
		const s0 = light === "A" ? sa : sb
		const jam = Math.sqrt(R * R - (R - s0 / 2) ** 2)
		const g = light === "A" ? { x: -R, y: top } : { x: R, y: top }
		const runs = F.map((f) => dist(at(f[light] as P, { x: 0, y: s0 / 2 }), g))
		const shortest = Math.min(...runs)
		const end = runs.at(-1) as number
		const heavy = light === "A" ? "B" : "A"
		const still = Math.abs((F.at(-1)?.[heavy] as P).y - (F.at(-48)?.[heavy] as P).y)
		console.log(`  light ${light} (${Math.min(mA, mB)} kg) hauled up by ${Math.max(mA, mB)} kg: its run's shortest ${(shortest * 1000).toFixed(2)} mm, at the end ${(end * 1000).toFixed(2)} mm; the heavy side moves ${(still * 1000).toFixed(3)} mm in the last 0.1 s`)
		check(`    jams where its top's inner corner meets the wheel (run √(R² − (R − s/2)²))`, shortest, jam, 0.02, " m")
		claim(`    and stays there: run at the end within 0.5 mm of the jam, the heavy side still (< 0.1 mm in the last 0.1 s)`, Math.abs(end - jam) < 0.0005 && still < 0.0001)
	}
	// The rope never pushes: the heavy side lands on the table and stops; the light side flies on up, its rope slack, as far as its speed takes it
	// (v²/2g), and falls back until the rope is taut again.
	{
		const top = 1.5
		const mA = 1
		const mB = 2
		const drop = 0.6
		const fall = 0.3
		const sb = cube(mB)
		const floorY = top - drop - sb - fall
		const { F } = atwood(mA, mB, drop, 1.2, {}, floorY)
		const yA = F.map((f) => (f.A as P).y)
		const yB = F.map((f) => (f.B as P).y)
		const landed = yB.findIndex((y, k) => k > 0 && (yB[k - 1] as number) - y < 1e-7 && y < (yB[0] as number) - fall + 0.002)
		const v = Math.sqrt(2 * ((G * (mB - mA)) / (mA + mB)) * fall)
		// (from the step the heavy side is stopped, at the light side's speed then)
		const vA = ((yA[landed] as number) - (yA[landed - 1] as number)) / STEP
		const rise = Math.max(...yA.slice(landed)) - (yA[landed] as number)
		console.log(`  the heavy side (2 kg) lands after falling ${fall} m, the light (1 kg) rising at ${v.toFixed(3)} m/s (${vA.toFixed(3)} m/s the step it stops); it lands at ${(landed * STEP).toFixed(3)} s`)
		// (measured from step positions, a symplectic step's rise at speed v is v²/2g − v·h/2)
		check("    the light side's free rise after, v²/2g", rise, (vA * vA) / (2 * G) - (vA * STEP) / 2, 0.005, " m")
		claim(`    it was still rising at the speed the fall gave it when the heavy side stopped (${vA.toFixed(3)} vs ${v.toFixed(3)} m/s)`, Math.abs(vA - v) < 0.03 * v)
	}
}

/**
 * A dense ball (a material of 2·10⁶ kg/m³: a 1 cm ball weighs 8.4 kg, so the air's drag takes under 0.01% of a swing's energy a
 * period) swung from `deg` degrees on a pin `L` above its centre (a point in its own frame, so no rod) or on a rope of that length.
 * Returns its angle from straight down at every step.
 */
const dense = (how: "pin" | "rope", L: number, deg: number, seconds: number) => {
	const a = deg * D2R
	const r = 0.01
	const ball = s({ kind: "dynamic", id: "bob", words: "bob", body: { kind: "ball", radius: r }, material: "lead", at: { x: L * Math.sin(a), y: 1.5 - L * Math.cos(a) } })
	const F = run3(
		doc({
			materials: { lead: { density: 2e6 } },
			solids: [how === "pin" ? { ...ball, angle: a, pivot: { x: 0, y: L } } : ball],
			joints: how === "rope" ? [{ kind: "rope", id: "r", a: null, b: "bob", anchorA: { x: 0, y: 1.5 }, anchorB: { x: 0, y: 0 }, length: L }] : [],
			seconds
		})
	)
	return F.map((f) => Math.atan2((f.bob as P).x, 1.5 - (f.bob as P).y))
}

tests.swing = () => {
	console.log("SWINGS: pins and ropes keep a swing's energy (their constraint is met where the step leaves the bob, its path's bend included)")
	for (const how of ["pin", "rope"] as const) {
		for (const deg of how === "pin" ? [30, 90, 150, 170] : [30, 60, 90]) {
			const L = 0.5
			const theta = dense(how, L, deg, 12)
			// turning points: where |θ| peaks
			const turns = extremes(theta.map(Math.abs)).filter((e) => e.v > 0.05)
			const E = turns.map((e) => 1 - Math.cos(e.v))
			const periods = (E.length - 1) / 2
			const loss = (1 - (E.at(-1) as number) / (E[0] as number)) / periods
			claim(
				`  ${how} ${L} m, ${deg}°: turning points ${turns.slice(0, 3).map((e) => (e.v / D2R).toFixed(3)).join(", ")} ... ${((turns.at(-1)?.v ?? 0) / D2R).toFixed(3)}°; energy lost ${(loss * 100).toFixed(4)}% a period over ${periods.toFixed(1)} periods (under 0.05%)`,
				Math.abs(loss) < 0.0005
			)
		}
	}
	// The catalog's hinged gate (a 40 cm plank, 12 cm deep) let go at 150°: in air, its broad plank's drag slows it; the pin itself takes nothing.
	const [gate] = build([sceneOf([{ id: "g", type: "hinged-gate", x: 1.3, y: 2.2, props: { start_angle: 150, hanger: false } }], 3.5)])
	if (gate !== undefined) {
		const pivot = pivotOf(gate, "g/gate")
		const F = runFrames(gate).slice(Math.round(gate.release.at / STEP))
		const th = F.map((f) => Math.atan2((f["g/gate"] as P).x - pivot.x, pivot.y - (f["g/gate"] as P).y))
		const turns = extremes(th.map(Math.abs)).filter((e) => e.v > 0.05)
		console.log(`  hinged gate (catalog) from 150°: turning points ${turns.slice(0, 6).map((e) => (e.v / D2R).toFixed(2)).join(", ")}° in 3 s (air drag on the 40 × 12 cm plank only)`)
	}
}

/** The dense ball of `dense` (8.4 kg, 1 cm) on a pin joint `L` above its centre, with the pin's own friction and damping. */
const pinned = (deg: number, L: number, seconds: number, extra: Record<string, unknown>) => {
	const a = deg * D2R
	const F = run3(
		doc({
			materials: { lead: { density: 2e6 } },
			solids: [s({ kind: "dynamic", id: "bob", words: "bob", body: { kind: "ball", radius: 0.01 }, material: "lead", at: { x: L * Math.sin(a), y: 1.5 - L * Math.cos(a) }, angle: a })],
			joints: [{ kind: "pin", id: "p", a: null, b: "bob", anchorA: { x: 0, y: 1.5 }, anchorB: { x: 0, y: L }, ...extra }],
			seconds
		})
	)
	return F.map((f) => Math.atan2((f.bob as P).x, 1.5 - (f.bob as P).y))
}
const LEAD = { m: 2e6 * (4 / 3) * Math.PI * 0.01 ** 3, r: 0.01 }

tests.friction = () => {
	console.log("HINGE FRICTION AND ANGULAR DAMPING (off unless set)")
	const L = 0.3
	const { m, r } = LEAD
	const I = (2 / 5) * m * r * r + (m + AIR * (4 / 3) * Math.PI * 0.5 * r ** 3) * L * L
	const mgd = (m - AIR * (4 / 3) * Math.PI * r ** 3) * G * L
	// Coulomb: each half swing gives up τ·(θ1 + θ2) of its height, mgd·(cos θ2 − cos θ1)
	{
		const tau = 0.03 * mgd
		const theta = pinned(40, L, 3, { friction: tau })
		const turns = extremes(theta.map(Math.abs)).filter((e) => e.v > 0.02)
		let want = 40 * D2R
		const wants: number[] = []
		for (let k = 0; k < Math.min(4, turns.length); k++) {
			const t1 = want
			let lo = 0
			let hi = t1
			for (let i = 0; i < 80; i++) {
				const mid = (lo + hi) / 2
				// (what the height still holds over what the friction takes: falls from + at θ₂ = 0 to − at θ₂ = θ₁)
				if (mgd * (Math.cos(mid) - Math.cos(t1)) - tau * (t1 + mid) > 0) lo = mid
				else hi = mid
			}
			want = (lo + hi) / 2
			wants.push(want)
		}
		console.log(`  Coulomb friction ${tau.toFixed(4)} N·m (3% of m·g·d) on an 8.4 kg bob 0.3 m under its pin, from 40°: turning points ${turns.slice(0, 4).map((e) => (e.v / D2R).toFixed(3)).join(", ")}°`)
		check("    the 4th turning point against the energy balance mgd(cos θ₂ − cos θ₁) = τ(θ₁ + θ₂)", (turns[3]?.v ?? 0) / D2R, (wants[3] ?? 0) / D2R, 0.002, "°")
		// it holds the bob still where what turns it is less than its friction, and lets go where it is more
		const tilt = 20 * D2R
		const hold = pinned(20, L, 1, { friction: 1.01 * mgd * Math.sin(tilt) })
		const slip = pinned(20, L, 1, { friction: 0.99 * mgd * Math.sin(tilt) })
		claim(`    friction 1% over m·g·d·sin 20° holds it at 20°: it moves ${((Math.max(...hold) - Math.min(...hold)) / D2R).toFixed(6)}°`, Math.max(...hold) - Math.min(...hold) < 1e-6)
		// 1% under, it slips down only until gravity's torque is less than the friction, stopping where mgd(cos θ₂ − cos θ₁) = τ(θ₁ − θ₂)
		const tau2 = 0.99 * mgd * Math.sin(tilt)
		// (negative at θ₂ = 0, positive just under θ₁, where the trivial root θ₂ = θ₁ is)
		let lo = 0
		let hi = tilt * 0.999
		for (let i = 0; i < 80; i++) {
			const mid = (lo + hi) / 2
			if (mgd * (Math.cos(mid) - Math.cos(tilt)) - tau2 * (tilt - mid) > 0) hi = mid
			else lo = mid
		}
		check(`    friction 1% under it: it slips down to (lowest angle)`, Math.min(...slip) / D2R, lo / D2R, 0.001, "°")
	}
	// Viscous: I·θ'' + c·θ' + m·g·d·θ = 0, a small swing's amplitude falling exp(−2πζ/√(1−ζ²)) a period, ζ = c/(2√(I·m·g·d)).
	{
		const zeta = 0.05
		const c = 2 * zeta * Math.sqrt(I * mgd)
		const theta = pinned(3, L, 6, { damping: c })
		const tops = extremes(theta).filter((e) => e.v > 1e-4)
		const ratios = tops.slice(1, 5).map((p, i) => p.v / (tops[i]?.v ?? 1))
		check(`  hinge damping ${c.toFixed(4)} N·m·s (ζ ${zeta}) on the same bob from 3°: amplitude ratio per period`, mean(ratios), Math.exp((-2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)), 0.005)
		// and a damping far past what the bob can take in a step (c·h/I ≫ 1) only ever slows it
		const heavy = pinned(60, L, 2, { damping: 1e4 })
		claim(`    damping 10⁴ N·m·s (c·h/I = ${((1e4 * STEP) / I).toFixed(0)}): it creeps down from 60° and never swings past the bottom (lowest |θ| ${(Math.min(...heavy.map(Math.abs)) / D2R).toFixed(3)}°, all on one side: ${heavy.every((t) => t >= 0)})`, heavy.every((t) => t >= 0))
	}
	// Angular damping on a free body: a solid ball rolling down a 10° slope with c = 2/s: m(1 + k)·v' = m·g·sin θ − c·k·m·v (k = 2/5), so
	// v(t) = (g sin θ/(c·k))·(1 − exp(−c·k·t/(1 + k))).
	{
		const th = 10 * D2R
		const c = 2
		const R = 0.03
		const along = { x: Math.cos(th), y: -Math.sin(th) }
		const normal = { x: Math.sin(th), y: Math.cos(th) }
		const ballAt = (a: number) => ({ x: a * along.x + (R + 0.0002) * normal.x, y: 1 + a * along.y + (R + 0.0002) * normal.y })
		const run = (spin?: number) =>
			run3(
				doc({
					contacts: [{ between: ["dense", "wood"], friction: 1, restitution: 0, rollingResistance: 0 }],
					solids: [
						s({ kind: "static", id: "slope", words: "slope", body: { kind: "slab", width: 4, height: 0.04, depth: 0.2 }, material: "wood", at: { x: 1.5 * along.x - 0.02 * normal.x, y: 1 + 1.5 * along.y - 0.02 * normal.y }, angle: -th }),
						s({ kind: "dynamic", id: "ball", words: "ball", body: { kind: "ball", radius: R }, material: "dense", at: ballAt(0.2), ...(spin === undefined ? {} : { angularDamping: spin }) })
					],
					seconds: 1.5
				})
			).map((f) => (f.ball as P).x * along.x + (f.ball as P).y * along.y)
		const x = run(c)
		const free = run()
		const k = 2 / 5
		const t = 1.2
		const n = Math.round(t / STEP)
		const v = ((x[n] as number) - (x[n - 1] as number)) / STEP
		const vFree = ((free[n] as number) - (free[n - 1] as number)) / STEP
		// (the ball settles onto the slope in its first steps: time from when it starts rolling)
		const t0 = (x.findIndex((p, i) => i > 0 && p - (x[0] as number) > 1e-5) - 1) * STEP
		const want = ((G * Math.sin(th)) / (c * k)) * (1 - Math.exp((-c * k * (t - t0)) / (1 + k)))
		check(`  angular damping 2/s on a solid ball rolling down 10°: its speed after ${t} s (undamped: ${vFree.toFixed(3)} m/s)`, v, want, 0.01, " m/s")
	}
}

/**
 * A taut chain (or rope) from a fixed hook down to its end at 20° under level, 1 m away: a fixed post, or a 3 kg ball held out at the
 * chain's length by a wall on its hook's side; and a brick dropped onto its middle from 5 cm over its band.
 */
const chainScene = (rope: Record<string, unknown>, fixedEnd: boolean, seconds = 1.5) => {
	const L = 1
	const th = 20 * D2R
	const hook = { x: 0, y: 1 }
	const end = { x: L * Math.cos(th), y: 1 - L * Math.sin(th) }
	const r = Math.cbrt((3 * 3) / (4 * Math.PI * 7850))
	const band = rope.render === undefined ? Number(rope.thickness) / 2 : 1.775 * Math.max(0.004, Math.min(0.012, 1.5 * Number(rope.thickness)))
	// the brick, level with the chain, over its middle: its underside 5 cm over the band
	const mid = { x: (hook.x + end.x) / 2, y: (hook.y + end.y) / 2 }
	const up = { x: Math.sin(th), y: Math.cos(th) }
	const lift = band + 0.025 + 0.05
	const F = run3(
		doc({
			contacts: [
				{ between: ["steel", "wood"], friction: 0.6, restitution: 0, rollingResistance: 0 },
				{ between: ["wood", "wood"], friction: 0.6, restitution: 0, rollingResistance: 0 }
			],
			solids: [
				s({ kind: "static", id: "floor", words: "floor", body: { kind: "slab", width: 3, height: 0.1, depth: 0.3 }, material: "wood", at: { x: 0.5, y: -0.05 } }),
				...(fixedEnd
					? [s({ kind: "static", id: "end", words: "post", body: { kind: "slab", width: 0.02, height: 0.02, depth: 0.1 }, material: "wood", at: end })]
					: [
							s({ kind: "dynamic", id: "end", words: "ball", body: { kind: "ball", radius: r }, material: "steel", at: end }),
							s({ kind: "static", id: "wall", words: "wall", body: { kind: "slab", width: 0.02, height: 0.3, depth: 0.1 }, material: "wood", at: { x: end.x - r - 0.01 - 0.0002, y: end.y } })
						]),
				s({ kind: "dynamic", id: "brick", words: "brick", body: { kind: "slab", width: 0.1, height: 0.05, depth: 0.05 }, material: "wood", at: { x: mid.x + lift * up.x, y: mid.y + lift * up.y }, angle: -th })
			],
			joints: [{ kind: "rope", id: "chain", a: null, b: "end", anchorA: hook, anchorB: { x: 0, y: 0 }, length: L, ...rope }],
			seconds
		})
	)
	return { F, band, hook }
}

/** How deep a segment's points go into a slab placed at p (its centre, angle), m: the most any of them is inside it (negative: outside). */
const depthInSlab = (p: P, w: number, h: number, a: V, b: V) => {
	let deepest = Number.NEGATIVE_INFINITY
	for (let i = 0; i <= 200; i++) {
		const q = { x: a.x + ((b.x - a.x) * i) / 200, y: a.y + ((b.y - a.y) * i) / 200 }
		const c = Math.cos(p.angle)
		const sn = Math.sin(p.angle)
		const lx = (q.x - p.x) * c + (q.y - p.y) * sn
		const ly = -(q.x - p.x) * sn + (q.y - p.y) * c
		deepest = Math.max(deepest, Math.min(w / 2 - Math.abs(lx), h / 2 - Math.abs(ly)))
	}
	return deepest
}

tests.chain = () => {
	console.log("CHAINS: a taut chain (or a rope flagged to) is a band moving solids land and rest on")
	for (const fixedEnd of [true, false])
		for (const [label, rope] of [
			["chain (thickness 5.55 mm, the wrecking ball's)", { thickness: 0.00555, render: { style: "chain" } }],
			["rope flagged collide (10 mm)", { thickness: 0.01, collide: true }]
		] as const) {
			const { F, band, hook } = chainScene(rope, fixedEnd)
			const end = F.at(-1) as Record<string, P>
			const brick = end.brick as P
			// how far the brick's middle is over the line from the hook to the end's anchor, less its half-height: its underside's gap
			const tip = (end.end as P | undefined) ?? { x: Math.cos(20 * D2R), y: 1 - Math.sin(20 * D2R), angle: 0 }
			const dx = tip.x - hook.x
			const dy = tip.y - hook.y
			const len = Math.hypot(dx, dy)
			const over = ((brick.x - hook.x) * -dy + (brick.y - hook.y) * dx) / len
			const gap = over - 0.025
			const before = F.at(-49)?.brick as P
			const moving = Math.hypot(brick.x - before.x, brick.y - before.y) / (48 * STEP)
			const endMoved = fixedEnd ? 0 : dist(tip, { x: Math.cos(20 * D2R), y: 1 - Math.sin(20 * D2R) })
			claim(
				`  a brick dropped on a ${label} to a ${fixedEnd ? "fixed post" : "3 kg ball held out by a wall"}, 20° under level: it rests on it, its underside ${(gap * 1000).toFixed(2)} mm over the line (band ${(band * 1000).toFixed(2)} mm, + 1 mm skins), moving ${(moving * 1000).toFixed(3)} mm/s at the end${fixedEnd ? "" : `; the ball moved ${(endMoved * 1000).toFixed(2)} mm`}`,
				Math.abs(gap - band - 0.002) < 0.002 && moving < 0.5e-3 && endMoved < 0.002
			)
		}
	// The catalog's wrecking ball (3 kg, 1 m chain, let go at −60°) swings its chain into a brick that overhangs a shelf in its path: the chain
	// knocks it off, never passing through it.
	const [d] = build([
		sceneOf(
			[
				{ id: "crane", type: "wrecking-ball", x: 0.9, y: 1.1625, props: { start_angle: -60 } },
				{ id: "shelf", type: "plank", x: 1.2, y: 0.6, props: { length: 0.4, thickness: 0.022, legs: false } },
				{ id: "brick", type: "brick", x: 1.07, y: 0.6 + 0.011 + 0.0325 + 0.0005 }
			],
			2
		)
	])
	if (d !== undefined) {
		const F = runFrames(d)
		const rope = d.joints?.[0] as { anchorA: V; anchorB: V; thickness: number }
		const band = 1.775 * Math.max(0.004, Math.min(0.012, 1.5 * rope.thickness))
		const hanger = d.solids.find((x) => x.id === "crane/hanger")
		const hookAt = at({ x: hanger?.at.x ?? 0, y: hanger?.at.y ?? 0, angle: 0 }, rope.anchorA)
		const brick = d.solids.find((x) => x.id === "brick/block")
		let deepest = Number.NEGATIVE_INFINITY
		let moved = 0
		for (const f of F) {
			const tip = at(f["crane/bob"] as P, rope.anchorB)
			deepest = Math.max(deepest, depthInSlab(f["brick/block"] as P, brick?.body.width ?? 0, brick?.body.height ?? 0, hookAt, tip))
			moved = Math.max(moved, dist(f["brick/block"] as P, F[0]?.["brick/block"] as P))
		}
		claim(
			`  the wrecking ball's chain sweeps into a brick overhanging a shelf: the brick is knocked ${(moved * 1000).toFixed(0)} mm; the chain's line stays at least ${(-deepest * 1000).toFixed(2)} mm outside it (its band ${(band * 1000).toFixed(1)} mm each side, the skins 2 mm)`,
			moved > 0.05 && -deepest > band - 0.004
		)
	}
}

/** A steel car on level ground: a 24 cm chassis with a 2 kg steel weight welded over it `ahead` m in front of its middle, two 3 cm disc wheels 8 cm either side. */
const frontHeavy = (ahead: number, f: number, zeta: number, seconds: number) => {
	const r = 0.03
	const wx = 0.08
	const wy = -0.03
	const cw = 0.24
	const ch = 0.03
	const cd = 0.06
	const lump = Math.cbrt(2 / 7850)
	const F = run3(
		doc({
			contacts: [{ between: ["steel", "wood"], friction: 0.9, restitution: 0, rollingResistance: 0 }],
			solids: [
				s({ kind: "static", id: "floor", words: "floor", body: { kind: "slab", width: 2, height: 0.04, depth: 0.2 }, material: "wood", at: { x: 0, y: -0.02 } }),
				s({ kind: "dynamic", id: "chassis", words: "chassis", body: { kind: "slab", width: cw, height: ch, depth: cd }, material: "steel", at: { x: 0, y: r - wy } }),
				// (welded 5 cm over the chassis, on a bracket the physics leaves out, clear of the wheels however far the chassis sags)
				s({ kind: "dynamic", id: "lump", words: "weight", body: { kind: "slab", width: lump, height: lump, depth: lump }, material: "steel", at: { x: ahead, y: ch / 2 + 0.05 + lump / 2 }, parent: "chassis" }),
				...[
					["front", wx],
					["rear", -wx]
				].map(([id, x]) => s({ kind: "dynamic", id, words: "wheel", body: { kind: "ball", radius: r, inertia: 0.5 }, material: "steel", at: { x, y: r } }))
			],
			joints: [
				["front", wx],
				["rear", -wx]
			].map(([id, x]) => ({ kind: "wheel", id, chassis: "chassis", wheel: id, anchor: { x, y: wy }, axis: { x: 0, y: 1 }, frequency: f, damping: zeta })),
			seconds
		})
	)
	/** How far each wheel has risen along its axis from its anchor (the chassis's sag over it), m. */
	const sag = (p: Record<string, P>, id: string, ax: number) => {
		const c = p.chassis as P
		const anchor = at(c, { x: ax, y: wy })
		return ((p[id] as P).x - anchor.x) * -Math.sin(c.angle) + ((p[id] as P).y - anchor.y) * Math.cos(c.angle)
	}
	return { F, sag: (p: Record<string, P>) => ({ front: sag(p, "front", wx), rear: sag(p, "rear", -wx) }), wx }
}

tests.wheel = () => {
	console.log("WHEELS: each wheel's spring carries its own share of the chassis (from where its centre of mass is), so it sags as much as the others")
	const f = 4
	const want = G / (2 * Math.PI * f) ** 2
	for (const ahead of [0, 0.06]) {
		const { F, sag } = frontHeavy(ahead, f, 0.7, 2)
		const rest = F.slice(-96)
		const front = mean(rest.map((p) => sag(p).front))
		const rear = mean(rest.map((p) => sag(p).rear))
		const pitch = mean(rest.map((p) => (p.chassis as P).angle))
		console.log(`  2 kg weight ${(ahead * 100).toFixed(0)} cm ahead of the chassis's middle, ${f} Hz suspension: sag front ${(front * 1000).toFixed(2)} mm, rear ${(rear * 1000).toFixed(2)} mm, chassis pitched ${(pitch / D2R).toFixed(3)}°`)
		check(`    front sag, g/(2πf)²`, front, want, 0.02, " m")
		check(`    rear sag, g/(2πf)²`, rear, want, 0.02, " m")
	}
	// lightly damped, it bounces at its suspension's frequency (heave: the weight's share and the springs' agree, so no pitching)
	const { F } = frontHeavy(0.06, f, 0.02, 2.5)
	const y = F.map((p) => (p.chassis as P).y)
	const tops = extremes(y).filter((e, i, all) => i > 0 && e.v > (all[i - 1]?.v ?? 0)).slice(0, 8)
	const pitchSwing = Math.max(...F.slice(20).map((p) => Math.abs((p.chassis as P).angle)))
	check(`  front-heavy, damping 0.02: its bounce frequency (pitching at most ${(pitchSwing / D2R).toFixed(3)}°)`, (tops.length - 1) / ((tops.at(-1)?.t ?? 0) - (tops[0]?.t ?? 0)), f * Math.sqrt(1 - 0.02 ** 2), 0.02, " Hz")
}

const which = process.argv[2] ?? "all"
for (const [name, fn] of Object.entries(tests)) if (which === "all" || which === name) fn()
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`)
process.exitCode = failures === 0 ? 0 : 1
