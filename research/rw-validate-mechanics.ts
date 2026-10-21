// MECHANICS validation (the mechanics module: machines/mod_mechanics.py, web/sim/modules/mechanics.js, tooling/src/sim/mechanics.ts and
// tooling/src/sim/modules/mechanics.ts). Every scene is built through web/sim (the browser's builder, identical to machines/items.py), placed
// by the AI's own solver where a lesson would be (a car on a ramp, a ramp on a floor, things held in the air), run by the engine itself
// (tooling/src/sim, with the bundle's math) and compared with closed-form physics and real reference values (spec engine4 mechanics.md §3):
//   ramps      K1 a 20 cm toy car (0.3 kg body, 3.4 cm wheels) down a 1 m ramp on 1 vs 3 blocks onto a carpet floor: speed at the foot
//              v² = 2g·Δh·(1 − C_rr/tan θ) and roll-out v²/(2·C_rr·g) within 20 % (wheel inertia, suspension, air), 3 blocks farther;
//              K2 the same scene twice gives the same track, byte for byte (determinism); K3 a 60 g lump of clay on the car's roof rides
//              down with it and changes the roll by under 10 % (rolling resistance ∝ weight)
//   start      K4 a motor car at 10/3 m/s given start_speed 10/3 crosses 10 m at 3.000 ± 0.005 s; a bowling ball given 2 m/s on concrete
//              still has ≥ 1.95 m/s after 1 m (rolling resistance 0.01 [WHITE-RR]: v² = v0² − 2·C_rr·g·d)
//   forces     K5 a 1 kg cart pulled 5 N one way and 3 N the other: a = (2 − C_rr·m·g)/(m + wheels' I/r²) toward the 5 N side ± 1.5 %;
//              equal pulls: it stays (≤ 1 mm); K9 F = ma: a 0.5 kg cart and 50 g over an edge pulley: a = m·g/(M + m) = 0.892 m/s²
//              [SERWAY] within 5 %, and with the cart's rolling resistance (0.003 [PASCO]) and wheels counted, within 1 %
//   pusher     a push of F for t: a toy car pushed 3-9 N for 0.15 s (0.25 N steps, rigid and 8 Hz axles, carpet and hardwood) starts faster
//              with every step, sprung as rigid (± 2 %), at (F·t − C_rr·m·g·t)/(car + wheels + the pusher's rod and paddle) (± 2 %); the same F·t,
//              the same start; 2.5, 7 and 14 cm paddles push alike; pushing nothing, its moving parts reach F·t/0.199 kg; a raised rod is
//              mounted in its housing on a riser, and stays in it over its whole stroke
//   falling    K6 1, 2 and 4 nested coffee filters: terminal speeds 1 : √2 : 2 within 5 % [Takahashi & Thompson, Am. J. Phys. 67, 709
//              (1999): drag ∝ v²], one filter about 1 m/s (spec 1.0-1.2), terminal speed reached within 0.3 m; a 50 g load under a
//              30 cm canopy falls at √(2mg/(ρ·C_d·A)) ≈ 2.9 m/s (spec, [KNACKE]) ± 10 %; a crumpled sheet lands before a flat one;
//              K7 Apollo 15's hammer and feather on the Moon (1.6 m, air off): both land at √(2h/g) = 1.41 s ± 0.01 s, together
//              [APOLLO15, NASA-PFS g_Moon 1.62]; on Earth with air the feather lands far later
//   carts      K8 a 0.25 kg plunger cart and a 0.5 kg cart push apart: speeds 2 : 1 (± 2 %), opposite, momentum ≈ 0 (< 1 % of either's);
//              velcro carts stick: m₁v/(m₁ + m₂) ± 3 %; magnet bumpers (e 0.95) swap speeds: (1 ∓ e)/2·v ± 3 %; a lump of clay dropped on a
//              rolling cart rides on at M·v/(M + m) ± 3 % (perfectly inelastic, momentum kept)
//   machines   the law of the lever m_l·d_l = m_e·d_e [SERWAY] (class 1: it holds within 0.5° at the balancing effort, tips the other way
//              4 % either side; classes 2 and 3 with the beam's own weight); a wheel and axle balances at m_l·r/R and the effort moves R/r
//              as far as the load (± 1 %); a block and tackle balances at (m_l + 0.05 kg)/n and the effort moves n times as far (± 1 %);
//              a 12 : 36 : 20 gear train at 30 rpm: −10 and +18 rpm (± 0.5 %), each pair the other way round
//   coaster    the least start height for a 25 mm steel ball to go round a 15 cm loop against a ball rolling without slipping's
//              h ≥ 2.7·(R − r) above the loop's bottom [SERWAY; spec §2 P2]; on a valley track the ball climbs back to ≥ 97 % of its drop
//   balloon    a balloon rocket's push 2·C_c·Δp·A (spec 0.3-0.4 N at 3 kPa through an 8-10 mm neck) and a 3-6 m run along a 10 m string
//   egg        K10 an egg dropped 0.5 m onto the table breaks (peak ≈ 3.1·√(1.5e4·0.057) ≈ 92 N, spec) and onto a 10 cm foam block
//              survives; the crack height onto the table is about 7 cm (the spec's calibration: a few cm to about 10 cm [EGG])
//   sensors    the lab gear's meters: an edge pulley's string pull (a force sensor) reads m·(g − a) of its hanging mass (± 1 %) and about
//              M·m·g/(M + m) [SERWAY] (± 2 %); a smart cart's acceleration reading is its track's (± 1 %) and F/a its mass (rolling resistance
//              and wheels counted, ± 2 %); a winch's cord pull reads its set force (± 1 %); pulling a 1 kg cart up a ramp at a steady 0.1 m/s
//              takes m·g·sin θ (+ rolling resistance) (± 3 %): less than lifting it straight up, and in proportion to sin θ (8 vs 3 blocks)
//   screw      a screw jack lifts at turns × pitch (± 1 %) and lifts no more than efficiency × effort × 2π·L/p (a load 3 % under that rises,
//              3 % over it does not) [SHIGLEY]; a handle twice as long gives twice the force, and about twice the load rises
//   arrows     K12 force arrows' numbers (the `forces` record): a book resting on the table: gravity m·g, support equal and opposite (± 1 %),
//              acting at the table top, net 0; a tug of war 5 N against 3 N: each pull its own (± 1 %), the net their sum with friction and
//              the air, and Newton's second law for the cart and its wheels: net = Δ(momentum)/Δt (± 1 %); a block floating in water:
//              buoyancy = its weight (± 1 %, liquids module's push); a parachute at its steady speed: the air's push = its weight (± 2 %);
//              a coffee filter falling: net = m·a while it speeds up (± 3 %)
//   energy     K11 energy bars' numbers (the `energy` record): a pendulum swinging 30° in a vacuum keeps KE + PE within 0.5 % of its swing's
//              energy (and nothing turns to heat); with air some turns to heat, never less as the run goes on; a ball falling in a vacuum
//              gains m·g·h of kinetic energy exactly (the step's mean height, ½(y₀ + y₁), is what planck's Euler step keeps); a mass bouncing
//              on an undamped spring keeps KE + PE + ½kx² within 0.5 %; a block sliding to a stop turns all its kinetic energy to heat, and
//              the leftover (start − energies) is never below −1e-6 J; the bookkeeping start + added = energies + heat holds every frame
//   node --no-warnings research/rw-validate-mechanics.ts [ramps|start|forces|pusher|sensors|falling|carts|machines|coaster|balloon|egg|screw|arrows|energy|all]
import "../tools/engine-math-node.mjs"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const sim = (await import(`${PG}/web/sim/index.js`)) as {
	prepare: (s: unknown) => { scene: unknown; doc: Doc; resolved: Record<string, Record<string, unknown>> }
	finish: (s: unknown, d: unknown, r: unknown, t: unknown) => { summary: { goals: { ok: boolean; label: string }[] } }
	catalog: () => { types: { key: string; defaults: Record<string, unknown> }[] }
}
const { solve } = (await import(`${PG}/web/ai/solver.js`)) as { solve: (plan: unknown) => { ok: boolean; scene: { items: Item[] }; errors?: { text: string }[] } }
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: unknown } }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: unknown, fps: number) => Track }

type P = { x: number; y: number; angle: number }
type Track = { frames: { t: number; placements: Record<string, P> }[]; impacts: { t: number; a: string; b: string; speed: number }[]; state?: Record<string, Record<string, number[]>> }
type Doc = { solids: { id: string; item: string; kind: string; body: { kind: string; radius?: number; width?: number; height?: number } }[]; processes?: Record<string, unknown>[] }
type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; held?: boolean; fixed?: boolean }

const which = process.argv[2] ?? "all"
const G = 9.81
let pass = 0
let fail = 0
const check = (name: string, got: number, want: number, tol: number, unit = "", rel = true) => {
	const err = rel ? Math.abs(got - want) / Math.abs(want) : Math.abs(got - want)
	const ok = err <= tol
	if (ok) pass++
	else fail++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${got.toPrecision(6)}${unit} vs ${want.toPrecision(6)}${unit} (${rel ? `${(err * 100).toFixed(3)} %` : `${err.toExponential(2)}`}, tol ${rel ? `${(tol * 100).toFixed(2)} %` : tol})`)
}
const truth = (name: string, ok: boolean, detail = "") => {
	if (ok) pass++
	else fail++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`)
}
const STAGE = { x0: -1.0, x1: 14.0, y0: -0.2, y1: 3.0 }
type Opt = { seconds?: number; release?: number; settings?: Record<string, unknown>; fps?: number; table?: boolean }
const run = (items: Item[], o: Opt = {}) => {
	const scene = { version: 2, id: "rwmech", name: "rw mechanics", seconds: o.seconds ?? 3, release: o.release ?? 0.5, stage: STAGE, items: [...(o.table === false ? [] : [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }]), ...items], goals: [], ...(o.settings ? { settings: o.settings } : {}) }
	const { scene: s, doc, resolved } = sim.prepare(scene)
	const track = simulate(admitDocument(doc).scene, o.fps ?? 240)
	return { doc, resolved, track, scene: s, meta: sim.finish(s, doc, resolved, track), release: o.release ?? 0.5 }
}
type Run = ReturnType<typeof run>
/** A plan placed by the AI's solver, then run. */
const planRun = (items: unknown[], o: Opt = {}) => {
	const r = solve({ title: "rw", seconds: o.seconds ?? 3, release: o.release ?? 0.5, items })
	if (!r.ok) throw new Error(`solve: ${JSON.stringify(r.errors)}`)
	const scene = { ...r.scene, seconds: o.seconds ?? 3, release: o.release ?? 0.5, ...(o.settings ? { settings: o.settings } : {}) }
	const p = sim.prepare(scene)
	const track = simulate(admitDocument(p.doc).scene, o.fps ?? 240)
	return { doc: p.doc, resolved: p.resolved, track, scene: p.scene as { items: Item[] }, meta: sim.finish(p.scene, p.doc, p.resolved, track), release: o.release ?? 0.5 }
}
const pose = (r: { track: Track }, sid: string, k: number) => r.track.frames[k].placements[sid] ?? r.track.frames[0].placements[sid]
const kAt = (r: { track: Track }, t: number) => {
	let k = 0
	for (let i = 1; i < r.track.frames.length; i++) if (Math.abs(r.track.frames[i].t - t) < Math.abs(r.track.frames[k].t - t)) k = i
	return k
}
const at = (r: { track: Track }, sid: string, t: number) => pose(r, sid, kAt(r, t))
/** Mean velocity of a solid between t1 and t2 (frames nearest), m/s and rad/s. */
const vel = (r: { track: Track }, sid: string, t1: number, t2: number) => {
	const a = kAt(r, t1)
	const b = kAt(r, t2)
	const dt = r.track.frames[b].t - r.track.frames[a].t
	const p = pose(r, sid, a)
	const q = pose(r, sid, b)
	return { x: (q.x - p.x) / dt, y: (q.y - p.y) / dt, w: (q.angle - p.angle) / dt }
}
/** Least squares of x(t) = x0 + v0·t + a/2·t² over [t1, t2]: the acceleration along x. */
const accel = (r: { track: Track }, sid: string, t1: number, t2: number) => {
	const rows = r.track.frames.filter((f) => f.t >= t1 && f.t <= t2).map((f) => [f.t - t1, (f.placements[sid] ?? r.track.frames[0].placements[sid]).x])
	let [s0, s1, s2, s3, s4, y0, y1, y2] = [0, 0, 0, 0, 0, 0, 0, 0]
	for (const [t, x] of rows) {
		s0 += 1
		s1 += t
		s2 += t * t
		s3 += t * t * t
		s4 += t * t * t * t
		y0 += x
		y1 += x * t
		y2 += x * t * t
	}
	// normal equations for [c0, c1, c2]
	const M = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]]
	const Y = [y0, y1, y2]
	const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
	const D = det(M)
	const M2 = M.map((row, i) => [row[0], row[1], Y[i]])
	return (2 * det(M2)) / D
}
const main = (r: { doc: Doc }, item: string) => r.doc.solids.find((s) => s.item === item && s.kind === "dynamic")?.id as string
const series = (r: Run, item: string, key: string) => r.track.state?.[item]?.[key] ?? []
const landing = (r: { track: Track }, item: string, release: number) => {
	const h = r.track.impacts.find((x) => x.a.startsWith(`${item}/`) !== x.b.startsWith(`${item}/`) && (x.a.startsWith(`${item}/`) || x.b.startsWith(`${item}/`)))
	return h === undefined ? NaN : h.t - release
}
const resolvedNum = (r: { resolved: Record<string, Record<string, unknown>> }, id: string, key: string) => Number(r.resolved[id]?.[key])

// ================================================================ K1-K3: ramps and cars
if (which === "ramps" || which === "all") {
	const C_WOOD = 0.012 // a toy car's rubber tyres on varnished wood (the catalog's tyre rubber rolling resistance)
	const rampRun = (blocks: number, extra: unknown[] = [], seconds = 7) =>
		planRun(
			[
				{ id: "gym-floor", type: "floor", props: { length: 7, material: "carpet" }, place: { on: "table", x: 3.0 } },
				{ id: "ramp", type: "ramp", props: { blocks, length: 1.0 }, place: { on: "gym-floor", x: 0.7 } },
				{ id: "car", type: "toy-car", props: { body_mass: 0.3, color: "red" }, place: { on: "ramp", x: 0.7 - 0.997 + 0.13 } },
				...extra
			],
			{ seconds, release: 0.3 }
		)
	const out: Record<number, number> = {}
	for (const blocks of [1, 3]) {
		const r = rampRun(blocks)
		const id = main(r, "car")
		const ramp = r.scene.items.find((i) => i.id === "ramp") as Item
		const floorTop = (r.scene.items.find((i) => i.id === "gym-floor") as Item).y
		const slope = resolvedNum(r, "ramp", "slope") * (Math.PI / 180)
		const y0 = pose(r, id, 0).y
		// the car's speed as its middle passes the ramp's foot (a centred difference over 2 frames)
		let k = r.track.frames.findIndex((f, i) => i > 0 && pose(r, id, i).x >= ramp.x)
		const vf = (pose(r, id, k + 2).x - pose(r, id, k - 2).x) / (r.track.frames[k + 2].t - r.track.frames[k - 2].t)
		const yFoot = pose(r, id, k).y
		const drop = y0 - yFoot
		const vth = Math.sqrt(2 * G * drop * (1 - C_WOOD / Math.tan(slope)))
		check(`K1 ${blocks} block${blocks > 1 ? "s" : ""}: the car's speed at the ramp's foot (ideal point mass, drop ${(drop * 100).toFixed(1)} cm)`, Math.abs(vf), vth, 0.2, " m/s")
		const end = pose(r, id, r.track.frames.length - 1).x
		const roll = end - ramp.x
		const C_CARPET = 0.05 // spec mechanics.md: a toy car on carpet ≈ 0.05
		check(`K1 ${blocks} block${blocks > 1 ? "s" : ""}: the roll-out on carpet, v²/(2·C_rr·g) (C_rr ≈ 0.05)`, roll, (vf * vf) / (2 * C_CARPET * G), 0.25, " m")
		truth(`K1 ${blocks} block${blocks > 1 ? "s" : ""}: the car stopped on the floor`, Math.abs(vel(r, id, 6.6, 7.0).x) < 0.01 && floorTop > 0, `ended ${roll.toFixed(2)} m past the foot`)
		out[blocks] = roll
	}
	truth("K1 3 blocks rolls farther than 1 block", out[3] > out[1] * 2, `${out[3].toFixed(2)} m vs ${out[1].toFixed(2)} m (ratio ${(out[3] / out[1]).toFixed(2)}, spec ≈ 3.6)`)
	// K2: the same scene twice: the same track
	const a = rampRun(3, [], 3)
	const b = rampRun(3, [], 3)
	truth("K2 the same scene runs the same, byte for byte", JSON.stringify(a.track.frames) === JSON.stringify(b.track.frames))
	// K3: clay on the car's roof
	const plain = rampRun(1)
	const clay = rampRun(1, [{ id: "clay", type: "clay-lump", props: { mass: 0.06 }, place: { on: "car" } }])
	const cid = main(clay, "car")
	const lid = main(clay, "clay")
	let rode = true
	for (let k = 0; k < clay.track.frames.length; k++) if (Math.abs(pose(clay, lid, k).x - pose(clay, cid, k).x) > 0.1) rode = false
	truth("K3 the clay rides down on the car's roof", rode)
	const d0 = pose(plain, main(plain, "car"), plain.track.frames.length - 1).x
	const d1 = pose(clay, cid, clay.track.frames.length - 1).x
	const foot = (plain.scene.items.find((i) => i.id === "ramp") as Item).x
	check("K3 the clay changes the roll by under 10 %", (d1 - foot) / (d0 - foot), 1, 0.1)
}

// ================================================================ K4: start speed
if (which === "start" || which === "all") {
	const v = 10 / 3
	const r = run(
		[
			{ id: "gym", type: "floor", x: 6.5, y: 0, props: { length: 14, material: "concrete" } },
			{ id: "car", type: "motor-car", x: 0, y: 0.0005, props: { speed: v, start_speed: v } }
		],
		{ seconds: 4, release: 0.5, table: false, fps: 480 }
	)
	const id = main(r, "car")
	const x0 = pose(r, id, 0).x
	const k = r.track.frames.findIndex((f, i) => pose(r, id, i).x >= x0 + 10)
	const fa = r.track.frames[k - 1]
	const fb = r.track.frames[k]
	const xa = pose(r, id, k - 1).x
	const xb = pose(r, id, k).x
	const tc = fa.t + ((x0 + 10 - xa) / (xb - xa)) * (fb.t - fa.t) - r.release
	// (the catalog's motor car holds its wheels at ω = speed/r; its tyres sink a little under it, so it runs at its own steady speed, 1.6 %
	// under the set one: not this module's. What start_speed must do: no speed-up at all, that steady speed from the release on.)
	const vSteady = vel(r, id, 2.0, 3.0).x
	console.log(`info  K4 the motor car's own steady speed ${vSteady.toFixed(4)} m/s for a set ${v.toFixed(4)} (its crossing at ${tc.toFixed(4)} s)`)
	check("K4 start_speed: the car is at its steady speed from the release (no speed-up)", vel(r, id, r.release + 0.01, r.release + 0.05).x, vSteady, 0.002, " m/s")
	check("K4 so it crosses 10 m at 10 m ÷ its speed", tc, 10 / vSteady, 0.005, " s", false)
	const b = run(
		[
			{ id: "gym", type: "floor", x: 2, y: 0, props: { length: 6, material: "concrete" } },
			{ id: "ball", type: "bowling-ball", x: 0, y: 0.109 + 0.0005, props: { start_speed: 2 } }
		],
		{ seconds: 1.5, release: 0.3, table: false, fps: 480 }
	)
	const bid = main(b, "ball")
	const bx0 = pose(b, bid, 0).x
	const kb = b.track.frames.findIndex((f, i) => pose(b, bid, i).x >= bx0 + 1)
	const vb = (pose(b, bid, kb + 2).x - pose(b, bid, kb - 2).x) / (b.track.frames[kb + 2].t - b.track.frames[kb - 2].t)
	truth("K4 a bowling ball given 2 m/s on concrete still rolls at ≥ 1.95 m/s after 1 m", vb >= 1.95, `${vb.toFixed(4)} m/s (rolling, C_rr 0.01: ${Math.sqrt(4 - 2 * 0.01 * G * (5 / 7)).toFixed(4)})`)
}

// ================================================================ K5, K9: forces
if (which === "forces" || which === "all") {
	const C_CART = 0.003 // the lab cart's wheels [PASCO]
	const WHEELS = 0.008 // its two 8 g disc wheels: I/r² = ½·m each
	const tug = (fl: number, fr: number) =>
		run(
			[
				{ id: "gym", type: "floor", x: 1.3, y: 0, props: { length: 4 } },
				{ id: "cart", type: "dynamics-cart", x: 1.3, y: 0.0005, props: { load: 0.75 } },
				{ id: "L", type: "puller", x: 0.3, y: 0, props: { pulls: "cart", faces: "right", force: fl } },
				{ id: "R", type: "puller", x: 2.3, y: 0, props: { pulls: "cart", faces: "left", force: fr } }
			],
			{ seconds: 1.2, release: 0.2, table: false }
		)
	const r = tug(5, 3)
	const m = resolvedNum(r, "cart", "total_mass")
	const a = accel(r, "cart/chassis", 0.3, 1.1)
	check("K5 tug of war 5 N vs 3 N on a 1 kg cart: a = (2 − C_rr·m·g)/(m + wheels) toward the 5 N side", -a, (2 - C_CART * m * G) / (m + WHEELS), 0.015, " m/s²")
	const e = tug(4, 4)
	truth("K5 equal pulls: the cart stays (balanced)", Math.abs(pose(e, "cart/chassis", e.track.frames.length - 1).x - pose(e, "cart/chassis", 0).x) < 0.001)
	const f = run(
		[
			{ id: "cart", type: "dynamics-cart", x: 0, y: 0.0005, props: { load: 0.25 } },
			{ id: "pulley", type: "edge-pulley", x: 3.19, y: 0.016, props: { pulls: "cart", hanging_mass: 0.05, drop: 0.1 } }
		],
		{ seconds: 1.5, release: 0.2 }
	)
	const M = resolvedNum(f, "cart", "total_mass")
	const af = accel(f, "cart/chassis", 0.3, 1.2)
	check("K9 F = ma: a = m·g/(M + m) = 0.892 m/s² (ideal, frictionless) within 5 %", af, (0.05 * G) / (M + 0.05), 0.05, " m/s²")
	check("K9 with the cart's rolling resistance and its wheels counted", af, (0.05 * G - C_CART * M * G) / (M + 0.05 + WHEELS), 0.01, " m/s²")
}

// ================================================================ the pusher: a push of F for t (engine6, 2026-10-20)
if (which === "pusher" || which === "all") {
	// What its push moves with the thing: its rod and paddle (machines/mod_mechanics.py PUSH_ROD_KG, PUSH_PADDLE_KG), whatever their sizes
	const M_PUSH = 0.135648 + 0.06336
	type Contact = { between: string[]; rollingResistance?: number }
	const rolling = (r: Run, a: string, b: string) => {
		// (a material made for one item carries its own tag: "tyre rubber [17ba5f]")
		const base = (m: string) => m.replace(/\s*\[[0-9a-f]+\]$/, "")
		const c = ((r.doc as unknown as { contacts?: Contact[] }).contacts ?? []).find((x) => x.between.map(base).includes(a) && x.between.map(base).includes(b))
		return c?.rollingResistance ?? NaN
	}
	const carPush = (f: number, susp: number, floor: string, t = 0.15) =>
		run(
			[
				{ id: "lane", type: "floor", x: 2.7, y: 0, props: { length: 6.4, material: floor } },
				{ id: "push", type: "pusher", x: -0.035, y: 0, props: { mode: "force", force: f, push_time: t, paddle: 0.07, height: 0.045 } },
				{ id: "car", type: "toy-car", x: 0.1, y: 0, props: { color: "red", suspension: susp } }
			],
			{ seconds: 0.35 + t + 0.15, release: 0.3, table: false }
		)
	/** The car's start: the chassis's highest speed along the lane by 0.05 s after the push ends (centred differences over 2 frames). */
	const startOf = (r: Run, t: number) => {
		let best = 0
		for (let k = 2; k < r.track.frames.length - 2 && r.track.frames[k].t <= r.release + t + 0.05; k++)
			best = Math.max(best, (pose(r, "car/chassis", k + 2).x - pose(r, "car/chassis", k - 2).x) / (r.track.frames[k + 2].t - r.track.frames[k - 2].t))
		return best
	}
	// the bench's sweep (lesson-regen/bench COVERAGE.md FO-36 row 7): 3-9 N in 0.25 N steps, rigid and 8 Hz axles, carpet and hardwood
	const forces = Array.from({ length: 25 }, (_, k) => 3 + 0.25 * k)
	const starts: Record<string, number[]> = {}
	let probe: Run | null = null
	for (const floor of ["carpet", "varnished hardwood"])
		for (const susp of [0, 8]) {
			starts[`${floor} ${susp}`] = forces.map((f) => {
				const r = carPush(f, susp, floor)
				if (f === 5 && susp === 0 && floor === "carpet") probe = r
				return startOf(r, 0.15)
			})
		}
	for (const [k, vs] of Object.entries(starts)) {
		let dips = 0
		for (let i = 1; i < vs.length; i++) if (!(vs[i] > vs[i - 1])) dips++
		truth(`a toy car (${k} Hz axles) pushed 3-9 N for 0.15 s: its start speed rises with every 0.25 N`, dips === 0, `${vs[0].toFixed(3)} … ${vs.at(-1)?.toFixed(3)} m/s, ${dips} dips (it was 0.93 m/s at 5 N, 0.49 at 5.25 on 8 Hz axles)`)
	}
	for (const floor of ["carpet", "varnished hardwood"]) {
		let worst = 0
		starts[`${floor} 0`].forEach((v, i) => (worst = Math.max(worst, Math.abs(starts[`${floor} 8`][i] / v - 1))))
		check(`on ${floor} a sprung toy car starts as a rigid one does, the same push (the worst of 25 forces)`, worst, 0, 0.02, "", false)
	}
	// 5 N for 0.15 s on the carpet against F·t less the rolling resistance, over the car, its wheels' turning and the pusher's moving parts
	const r5 = probe as unknown as Run
	const crr = rolling(r5, "tyre rubber", "carpet")
	const mCar = resolvedNum(r5, "car", "body_mass") + 2 * 0.011
	const mEff = mCar + 0.5 * 2 * 0.011 + M_PUSH
	const want = (5 * 0.15 - crr * mCar * G * 0.15) / mEff
	check(`a toy car pushed 5 N for 0.15 s: (F·t − C_rr·m·g·t)/(car + wheels' I/r² + the pusher's rod and paddle) (C_rr ${crr})`, starts["carpet 0"][8], want, 0.02, " m/s")
	// the same impulse, the same start (less what the rolling resistance takes over the push's time): 3 N for 0.2 s and 6 N for 0.1 s, both
	// within the stroke
	const a = startOf(carPush(3, 8, "carpet", 0.2), 0.2) + (crr * mCar * G * 0.2) / mEff
	const b = startOf(carPush(6, 8, "carpet", 0.1), 0.1) + (crr * mCar * G * 0.1) / mEff
	check("the same impulse, the same start: 3 N × 0.2 s and 6 N × 0.1 s (0.6 N·s) on a sprung toy car, the rolling resistance's share given back", a, b, 0.01, " m/s")
	// a paddle's size is its reach, not its push: 2.5, 7 and 14 cm paddles push a soccer ball alike
	const ball = (pad: number) => {
		const r = run(
			[
				{ id: "lane", type: "floor", x: 1.2, y: 0, props: { length: 3.4, material: "carpet" } },
				{ id: "push", type: "pusher", x: -0.145, y: 0, props: { mode: "force", force: 5, push_time: 0.15, paddle: pad, height: 0.11 } },
				{ id: "ball", type: "soccer-ball", x: 0, y: 0.11, props: {} }
			],
			{ seconds: 0.8, release: 0.3, table: false }
		)
		const id = main(r, "ball")
		let best = 0
		for (let k = 2; k < r.track.frames.length - 2; k++) best = Math.max(best, (pose(r, id, k + 2).x - pose(r, id, k - 2).x) / (r.track.frames[k + 2].t - r.track.frames[k - 2].t))
		return { best, r }
	}
	const p25 = ball(0.025)
	const p14 = ball(0.14)
	const p7 = ball(0.07)
	check("a 2.5 cm and a 14 cm paddle push a soccer ball alike (5 N for 0.15 s)", p25.best, p14.best, 0.005, " m/s")
	check("a 7 cm paddle too", p7.best, p14.best, 0.005, " m/s")
	// pushing nothing: its moving parts alone reach F·t/(rod + paddle) (its rod never rubs its housing)
	// (by how far they go while it pushes, ½·(F/m)·t²: its brake stops them within a few mm after)
	const free = run([{ id: "push", type: "pusher", x: 0.5, y: 0, props: { mode: "force", force: 5, push_time: 0.05 } }], { seconds: 0.6, release: 0.3 })
	const went = at(free, "push/rod", 0.35).x - pose(free, "push/rod", 0).x
	// (the engine's 480 Hz semi-implicit Euler step: n = 24 steps of h take it a·h²·n(n + 1)/2, ½·a·t² × (n + 1)/n)
	check("pushing nothing, 5 N for 0.05 s: its rod and paddle go ½·(F/0.199 kg)·t² while it pushes (× 25/24, the 480 Hz step's own sum)", went, (0.5 * 5 * 0.05 * 0.05 * (25 / 24)) / M_PUSH, 0.01, " m")
	// mounted at any height: the soccer ball's pusher (rod 11 cm up) holds its rod in its housing, on a wooden riser down to the floor, and the
	// rod's back end is still inside the housing at the end of its stroke
	const sol = (r: Run, part: string) => r.doc.solids.find((s) => s.id === `push/${part}`) as unknown as { at: { x: number; y: number }; body: { width: number; height: number } }
	const H = sol(p14.r, "housing")
	const R = sol(p14.r, "riser")
	const rod = sol(p14.r, "rod")
	truth("a raised rod is mounted in its housing, the housing on a riser that stands on the floor",
		Math.abs(rod.at.y - H.at.y) < H.body.height / 2 - 0.006 && R !== undefined && Math.abs(R.at.y - R.body.height / 2) < 1e-9 && Math.abs(R.at.y + R.body.height / 2 - (H.at.y - H.body.height / 2)) < 1e-9,
		`rod ${(rod.at.y * 100).toFixed(1)} cm up, housing ${((H.at.y - H.body.height / 2) * 100).toFixed(1)}-${((H.at.y + H.body.height / 2) * 100).toFixed(1)} cm, ${R === undefined ? "no riser" : `riser 0-${(R.body.height * 100).toFixed(1)} cm`}`)
	const full = run([{ id: "push", type: "pusher", x: 0.5, y: 0, props: { mode: "force", force: 20, push_time: 0.5, height: 0.2 } }], { seconds: 1.0, release: 0.3 })
	const end = pose(full, "push/rod", full.track.frames.length - 1)
	const Hf = sol(full, "housing")
	const rodF = sol(full, "rod")
	const moved = end.x - rodF.at.x
	truth("at the end of its whole stroke the rod's back end is still inside its housing", end.x - rodF.body.width / 2 < Hf.at.x + Hf.body.width / 2 && Math.abs(moved - 0.15) < 0.002,
		`moved ${(moved * 100).toFixed(1)} cm (stroke 15 cm), back end ${((Hf.at.x + Hf.body.width / 2 - (end.x - rodF.body.width / 2)) * 100).toFixed(1)} cm inside the front`)
}

// ================================================================ sensors: force meters and a smart cart
if (which === "sensors" || which === "all") {
	const C_CART = 0.003 // the lab cart's wheels [PASCO]
	const WHEELS = 0.008 // its two 8 g disc wheels: I/r² = ½·m each
	const median = (xs: number[]) => {
		const v = [...xs].sort((p, q) => p - q)
		return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
	}
	const window = (r: Run, item: string, key: string, t1: number, t2: number) => series(r, item, key).filter((_, k) => r.track.frames[k].t >= t1 && r.track.frames[k].t <= t2)
	// F = ma with a force sensor in the string and the cart's own accelerometer
	const f = run(
		[
			{ id: "cart", type: "dynamics-cart", x: 0, y: 0.0005, props: { load: 0.25 } },
			{ id: "pulley", type: "edge-pulley", x: 3.19, y: 0.016, props: { pulls: "cart", hanging_mass: 0.05, drop: 0.1 } }
		],
		{ seconds: 1.5, release: 0.2 }
	)
	const M = resolvedNum(f, "cart", "total_mass")
	const aFit = accel(f, "cart/chassis", 0.35, 1.2)
	const T = median(window(f, "pulley", "newtons", 0.35, 1.2))
	const aRead = median(window(f, "cart", "accel", 0.35, 1.2))
	check("force sensor: the string's pull is m·(g − a) of the 50 g hanging mass (Newton's second law on it)", T, 0.05 * (G - aFit), 0.01, " N")
	check("force sensor: about M·m·g/(M + m) for the 0.5 kg cart (ideal, frictionless)", T, (M * 0.05 * G) / (M + 0.05), 0.02, " N")
	check("smart cart: its acceleration reading is its track's", aRead, aFit, 0.01, " m/s²")
	const k1 = kAt(f, 1.0)
	check("smart cart: its speed reading is its track's", series(f, "cart", "speed")[k1], vel(f, "cart/chassis", 0.95, 1.05).x, 0.01, " m/s")
	check("F = M·a: the pull over the acceleration is the cart's mass (with its rolling resistance and wheels)", T / aRead, M + WHEELS + (C_CART * M * G) / aRead, 0.02, " kg")
	// a winch pulling with its set force: its meter reads it
	const w = run(
		[
			{ id: "gym", type: "floor", x: 1.3, y: 0, props: { length: 4 } },
			{ id: "cart", type: "dynamics-cart", x: 0.6, y: 0.0005, props: { load: 0.75 } },
			{ id: "W", type: "puller", x: 2.6, y: 0, props: { pulls: "cart", faces: "left", force: 2 } }
		],
		{ seconds: 1.2, release: 0.2, table: false }
	)
	check("a winch set to 2 N: its cord's meter reads 2 N", median(window(w, "W", "newtons", 0.35, 1.1)), 2, 0.01, " N")
	// up a ramp at a steady speed: the force an inclined plane needs
	const incline = (blocks: number) => {
		const placed = planRun(
			[
				{ id: "gym-floor", type: "floor", props: { length: 4, material: "varnished hardwood" }, place: { on: "table", x: 1.5 } },
				{ id: "ramp", type: "ramp", props: { blocks, length: 1.0, lip: false }, place: { on: "gym-floor", x: 2.0 } },
				{ id: "cart", type: "dynamics-cart", props: { load: 0.75 }, place: { on: "ramp", x: 1.45 } }
			],
			{ seconds: 1, release: 0.3 }
		)
		const items = placed.scene.items.filter((i) => i.type !== "table")
		const cart = items.find((i) => i.id === "cart") as Item
		const th = (-(cart.angle ?? 0) * Math.PI) / 180 // the cart lies along the slope, rising to the left
		const c0 = pose(placed, "cart/chassis", 0)
		// its cord runs up the slope from the cart's upper end (the chassis' -x end at its middle height), over the top of the winch's drum
		const ux = -Math.cos(th)
		const uy = Math.sin(th)
		const tie = { x: c0.x + Math.cos(c0.angle) * -0.085, y: c0.y + Math.sin(c0.angle) * -0.085 }
		const D = 0.8
		const drum = { x: tie.x + D * ux - 0.015 * Math.sin(th), y: tie.y + D * uy - 0.015 * Math.cos(th) }
		const r = run([...items, { id: "W", type: "puller", x: drum.x, y: drum.y - 0.05, props: { pulls: "cart", faces: "right", mode: "speed", speed: 0.1, height: 0.05 } }], { seconds: 3.0, release: 0.3, table: false })
		const Mi = resolvedNum(r, "cart", "total_mass")
		const read = median(window(r, "W", "newtons", 0.8, 2.9))
		const moved = Math.hypot(pose(r, "cart/chassis", r.track.frames.length - 1).x - c0.x, pose(r, "cart/chassis", r.track.frames.length - 1).y - c0.y)
		return { read, th, M: Mi, moved, goal: r.meta.summary }
	}
	const i8 = incline(8)
	const i3 = incline(3)
	for (const [n, x] of [[8, i8], [3, i3]] as const) {
		check(`incline, ${n} blocks (slope ${((x.th * 180) / Math.PI).toFixed(1)}°): pulled up at 0.1 m/s, the meter reads m·g·sin θ + C_rr·m·g·cos θ`, x.read, x.M * G * (Math.sin(x.th) + C_CART * Math.cos(x.th)), 0.03, " N")
		truth(`incline, ${n} blocks: the cart went up the slope at the winch's speed`, Math.abs(x.moved - 0.1 * 2.7) < 0.03, `${x.moved.toFixed(3)} m in 2.7 s`)
	}
	truth("incline: less force than lifting it straight up (m·g)", i8.read < i8.M * G * 0.6 && i3.read < i8.read, `${i8.read.toFixed(2)} N and ${i3.read.toFixed(2)} N vs ${(i8.M * G).toFixed(2)} N`)
	check("incline: the force goes as sin θ (8 blocks vs 3)", i8.read / i3.read, Math.sin(i8.th) / Math.sin(i3.th), 0.03)
}

// ================================================================ K6, K7: falling through air (and none)
if (which === "falling" || which === "all") {
	const vt: number[] = []
	for (const n of [1, 2, 4]) {
		const r = run([{ id: "f", type: "coffee-filters", x: 1.3, y: 2.6, props: { count: n }, held: true }], { seconds: 2.0, release: 0.2, fps: 480 })
		const id = main(r, "f")
		const v = -vel(r, id, 1.2, 1.3).y
		vt.push(v)
		// where it reached 95 % of that speed
		const y0 = pose(r, id, 0).y
		const k = r.track.frames.findIndex((fr, i) => i > 2 && -(pose(r, id, i + 1).y - pose(r, id, i - 1).y) / (r.track.frames[i + 1].t - r.track.frames[i - 1].t) >= 0.95 * v)
		const fell = y0 - pose(r, id, k).y
		const L = (v * v) / G
		check(`K6 ${n} filter${n > 1 ? "s" : ""}: the fall to 95 % of the terminal speed, (v_t²/g)·ln cosh(atanh 0.95) (quadratic drag)`, fell, L * Math.log(Math.cosh(Math.atanh(0.95))), 0.1, " m")
		if (n === 1) {
			truth("K6 one filter falls at about 1 m/s (spec 1.0-1.2)", v >= 0.95 && v <= 1.25, `${v.toFixed(3)} m/s`)
			truth("K6 one filter reaches its terminal speed within 0.3 m", fell <= 0.3, `${(fell * 100).toFixed(1)} cm`)
		}
	}
	check("K6 2 filters: v_t × √2", vt[1] / vt[0], Math.SQRT2, 0.05)
	check("K6 4 filters: v_t × 2", vt[2] / vt[0], 2, 0.05)
	const p = run([{ id: "p", type: "parachute", x: 1.3, y: 2.6, props: { canopy: 0.3, load_mass: 0.05 }, held: true }], { seconds: 2.0, release: 0.2, fps: 480 })
	check("a 50 g load under a 30 cm canopy: terminal speed ≈ 2.9 m/s (spec, [KNACKE])", -vel(p, "p/load", 0.85, 0.95).y, 2.9, 0.1, " m/s")
	const s = run([{ id: "sheet", type: "paper-sheet", x: 0.8, y: 1.8, held: true }, { id: "ball", type: "paper-ball", x: 1.8, y: 1.8, held: true }], { seconds: 3, release: 0.2 })
	const tSheet = landing(s, "sheet", 0.2)
	const tBall = landing(s, "ball", 0.2)
	truth("a crumpled sheet lands before a flat one (the same 5 g)", tBall < tSheet || (Number.isFinite(tBall) && !Number.isFinite(tSheet)), `${tBall.toFixed(3)} s vs ${Number.isFinite(tSheet) ? `${tSheet.toFixed(3)} s` : "still falling"}`)
	// K7: Apollo 15 on the Moon (the space module's rock hammer if it is there, else a 1 kg steel weight)
	const hammer = sim.catalog().types.some((t) => t.key === "rock-hammer") ? "rock-hammer" : "steel-weight-1kg"
	for (const [where, settings] of [["the Moon, no air", { gravity: "moon", air: false }], ["Earth, in air", null]] as const) {
		const r = planRun(
			[
				{ id: "hammer", type: hammer, place: { on: "air", x: 1.0, bottom_m: 1.6 }, held: true },
				// (Apollo 15's 30 g falcon feather [APOLLO15] on the Moon; on Earth a 1 g craft feather, as a classroom drops)
				{ id: "feather", type: "feather", props: { kind: settings ? "falcon" : "craft" }, place: { on: "air", x: 1.6, bottom_m: 1.6 }, held: true }
			],
			{ seconds: where === "the Moon, no air" ? 2.5 : 6, release: 0.5, fps: 480, ...(settings ? { settings } : {}) }
		)
		const th = landing(r, "hammer", 0.5)
		const tf = landing(r, "feather", 0.5)
		if (settings) {
			check(`K7 ${where}: the hammer lands at √(2h/g) = 1.405 s`, th, Math.sqrt((2 * 1.6) / 1.62), 0.01, " s", false)
			check(`K7 ${where}: the feather lands with it`, tf, th, 0.01, " s", false)
		} else truth(`K7 ${where}: a craft feather lands far later than the hammer (over 1.5 times)`, !Number.isFinite(tf) || tf > 1.5 * th, `hammer ${th.toFixed(3)} s, feather ${Number.isFinite(tf) ? `${tf.toFixed(3)} s` : "still falling at 5.5 s"}`)
	}
}

// ================================================================ K8 and collisions: carts
if (which === "carts" || which === "all") {
	const floor = { id: "gym", type: "floor", x: 1.3, y: 0, props: { length: 4 } }
	const r = run([floor, { id: "a", type: "dynamics-cart", x: 1.3 - 0.086, y: 0.0005, props: { plunger: 3 } }, { id: "b", type: "dynamics-cart", x: 1.3 + 0.086, y: 0.0005, props: { load: 0.25 } }], { seconds: 1.0, release: 0.2, table: false, fps: 480 })
	const ma = resolvedNum(r, "a", "total_mass")
	const mb = resolvedNum(r, "b", "total_mass")
	const va = vel(r, "a/chassis", 0.4, 0.5).x
	const vb = vel(r, "b/chassis", 0.4, 0.5).x
	check("K8 plunger carts 0.25 kg and 0.5 kg push apart: speeds m_b/m_a = 2", -va / vb, mb / ma, 0.02)
	truth("K8 they move opposite ways", va < 0 && vb > 0, `${va.toFixed(4)} and ${vb.toFixed(4)} m/s`)
	truth("K8 momentum stays about zero (under 1 % of either cart's)", Math.abs(ma * va + mb * vb) < 0.01 * Math.abs(mb * vb), `${(ma * va + mb * vb).toExponential(2)} kg·m/s of ${(mb * vb).toFixed(4)}`)
	const hit = (bumper: string) => run([floor, { id: "a", type: "dynamics-cart", x: 0.5, y: 0.0005, props: { bumper, start_speed: 1.0 } }, { id: "b", type: "dynamics-cart", x: 1.3, y: 0.0005, props: { bumper } }], { seconds: 2.0, release: 0.2, table: false, fps: 480 })
	/** When two items first touch (s), from the run's impacts. */
	const touch = (r: Run, a: string, b: string) => r.track.impacts.find((h) => (h.a.startsWith(`${a}/`) && h.b.startsWith(`${b}/`)) || (h.a.startsWith(`${b}/`) && h.b.startsWith(`${a}/`)))?.t ?? NaN
	const v = hit("velcro")
	const tv = touch(v, "a", "b")
	const v1 = vel(v, "a/chassis", tv - 0.06, tv - 0.01).x
	const ma2 = resolvedNum(v, "a", "total_mass")
	const mb2 = resolvedNum(v, "b", "total_mass")
	check("velcro carts stick: the pair moves on at m₁·v₁/(m₁ + m₂) (v₁ just before)", vel(v, "b/chassis", tv + 0.05, tv + 0.15).x, (ma2 * v1) / (ma2 + mb2), 0.02, " m/s")
	truth("velcro: they move on together", Math.abs(vel(v, "a/chassis", 1.3, 1.4).x - vel(v, "b/chassis", 1.3, 1.4).x) < 0.005)
	const g = hit("magnet")
	const tg = touch(g, "a", "b")
	const g1 = vel(g, "a/chassis", tg - 0.06, tg - 0.01).x
	check("magnet bumpers (e 0.95): the struck cart leaves at (1 + e)/2·v₁", vel(g, "b/chassis", tg + 0.05, tg + 0.15).x, 0.975 * g1, 0.03, " m/s")
	const ga = vel(g, "a/chassis", tg + 0.05, tg + 0.15).x
	truth("magnet bumpers: the moving one nearly stops, (1 − e)/2·v₁", Math.abs(ga - 0.025 * g1) < 0.02, `${ga.toFixed(4)} m/s (${(0.025 * g1).toFixed(4)})`)
	const c = run([floor, { id: "cart", type: "dynamics-cart", x: 0.6, y: 0.0005, props: { start_speed: 0.5 } }, { id: "clay", type: "clay-lump", x: 0.75, y: 0.12, props: { mass: 0.06 } }], { seconds: 2.0, release: 0.0, table: false, fps: 480 })
	const M = resolvedNum(c, "cart", "total_mass")
	const tc = touch(c, "clay", "cart")
	const vBefore = vel(c, "cart/chassis", tc - 0.03, tc - 0.005).x
	const vAfter = vel(c, "cart/chassis", tc + 0.1, tc + 0.2).x
	check("a lump of clay dropped on a rolling cart: M·v/(M + m) (momentum kept)", vAfter, (M * vBefore) / (M + 0.06), 0.02, " m/s")
}

// ================================================================ simple machines
if (which === "machines" || which === "all") {
	const lever = (props: Record<string, unknown>) => run([{ id: "lv", type: "lever-kit", x: 1.3, y: 0.8, props }], { seconds: 2.0, release: 0.2 })
	const base = { class: "1", load: 0.5, load_at: 0.2, effort_at: 0.4 }
	const r0 = lever({ ...base, effort: 0.25 })
	check("lever class 1: the balancing effort m_l·d_l/d_e", resolvedNum(r0, "lv", "balanced_by"), 0.25, 1e-9, " kg")
	const turn = (r: Run) => (pose(r, "lv/beam", r.track.frames.length - 1).angle * 180) / Math.PI
	truth("lever class 1 at the balancing effort holds (within 0.5°)", Math.abs(turn(r0)) < 0.5, `${turn(r0).toFixed(3)}°`)
	const up = turn(lever({ ...base, effort: 0.26 }))
	const dn = turn(lever({ ...base, effort: 0.24 }))
	truth("lever class 1: 4 % more effort tips it to the effort's side, 4 % less to the load's", up < -5 && dn > 5, `${up.toFixed(1)}° and ${dn.toFixed(1)}°`)
	for (const cls of ["2", "3"]) {
		const props = cls === "2" ? { class: "2", load: 0.5, load_at: 0.2, effort_at: 0.6 } : { class: "3", load: 0.2, load_at: 0.6, effort_at: 0.2 }
		const probe = lever({ ...props, effort: 0.1 })
		const need = resolvedNum(probe, "lv", "balanced_by")
		const r = lever({ ...props, effort: need })
		truth(`lever class ${cls} holds at its balancing effort (${need.toFixed(4)} kg, the beam's weight counted)`, Math.abs(turn(r)) < 1, `${turn(r).toFixed(3)}°`)
	}
	// wheel and axle
	const wa = (effort: number) => run([{ id: "wa", type: "wheel-and-axle", x: 1.3, y: 1.6, props: { wheel_radius: 0.15, axle_radius: 0.03, load: 1.0, effort } }], { seconds: 1.2, release: 0.2 })
	const w0 = wa(0.2)
	const dl0 = Math.abs(pose(w0, "wa/load-mass", w0.track.frames.length - 1).y - pose(w0, "wa/load-mass", 0).y)
	truth("wheel and axle (R 15 cm, r 3 cm) balances 1 kg at m_l·r/R = 0.2 kg", dl0 < 0.002, `the load moved ${(dl0 * 1000).toFixed(2)} mm`)
	const w1 = wa(0.4)
	// (while the effort falls freely: over its first 20 cm, before its cord runs out at its 40 cm drop)
	const n1 = w1.track.frames.findIndex((f, i) => pose(w1, "wa/effort-mass", 0).y - pose(w1, "wa/effort-mass", i).y > 0.2)
	const rise = pose(w1, "wa/load-mass", n1).y - pose(w1, "wa/load-mass", 0).y
	const fall = pose(w1, "wa/effort-mass", 0).y - pose(w1, "wa/effort-mass", n1).y
	check("wheel and axle: the effort moves R/r = 5 times as far as the load", fall / rise, 5, 0.01)
	// block and tackle
	for (const n of [2, 3, 4]) {
		const bt = (effort: number) => run([{ id: "bt", type: "block-and-tackle", x: 1.3, y: 1.8, props: { strands: n, load: 1.0, effort } }], { seconds: 1.0, release: 0.2 })
		const b0 = bt(1.05 / n)
		const d0 = Math.abs(pose(b0, "bt/load", b0.track.frames.length - 1).y - pose(b0, "bt/load", 0).y)
		truth(`block and tackle, ${n} strands: (1 kg + 50 g block)/${n} = ${(1.05 / n).toFixed(4)} kg balances it`, d0 < 0.002, `the load moved ${(d0 * 1000).toFixed(2)} mm`)
		const b1 = bt((1.05 / n) * 1.5)
		const k = b1.track.frames.length - 1
		const lr = pose(b1, "bt/load", k).y - pose(b1, "bt/load", 0).y
		const ef = pose(b1, "bt/effort-mass", 0).y - pose(b1, "bt/effort-mass", k).y
		check(`block and tackle, ${n} strands: the effort moves ${n} times as far as the load`, ef / lr, n, 0.01)
	}
	// gears
	const gr = run([{ id: "g", type: "gear-train", x: 1.3, y: 1.0, props: { teeth_a: 12, teeth_b: 36, teeth_c: 20, rpm: 30 } }], { seconds: 3, release: 0.2 })
	const rpm = (sid: string) => (vel(gr, sid, 1.5, 2.9).w * 60) / (2 * Math.PI)
	check("gears: the 12-tooth driver at 30 rpm", rpm("g/gear-a"), 30, 0.005, " rpm")
	check("gears: the 36-tooth gear at −30·12/36 = −10 rpm (the other way)", rpm("g/gear-b"), -10, 0.005, " rpm")
	check("gears: the 20-tooth gear at +30·12/20 = +18 rpm", rpm("g/gear-c"), 18, 0.005, " rpm")
}

// ================================================================ roller coaster
if (which === "coaster" || which === "all") {
	const R = 0.15
	const rb = 0.0127
	const goesRound = (h: number) => {
		const r = run(
			[
				{ id: "track", type: "coaster-track", x: -0.3, y: 0, props: { layout: "loop", height: h, size: R } },
				{ id: "ball", type: "steel-ball", x: -0.27, y: h - 0.03 * Math.tan((2 * Math.PI) / 180) + rb + 0.0006 }
			],
			{ seconds: 4, release: 0.0, fps: 240 }
		)
		const loop = (r.doc.processes ?? []).find((p) => p.role === "loop") as { center: { x: number; y: number } }
		let off = false
		let top = false
		for (let k = 0; k < r.track.frames.length; k++) {
			const p = pose(r, "ball/ball", k)
			const dx = p.x - loop.center.x
			const dy = p.y - loop.center.y
			const d = Math.hypot(dx, dy)
			if (dy > 0 && Math.abs(dx) < R && d < 0.8 * (R - rb)) off = true
			if (dy > 0.8 * (R - rb) && Math.abs(dx) < 0.03) top = true
		}
		return top && !off
	}
	let lo = 0.3
	let hi = 0.6
	truth("coaster: from 0.6 m the ball goes round, from 0.3 m it does not", goesRound(hi) && !goesRound(lo))
	for (let i = 0; i < 9; i++) {
		const mid = (lo + hi) / 2
		if (goesRound(mid)) hi = mid
		else lo = mid
	}
	const TRACK_T = 0.02
	check("coaster: the least start height round a 15 cm loop, h = 2 cm (the track) + 2.7·(R − r)", hi, TRACK_T + 2.7 * (R - rb), 0.1, " m")
	const h = 0.5
	const v = run([{ id: "track", type: "coaster-track", x: -0.3, y: 0, props: { layout: "valley", height: h } }, { id: "ball", type: "steel-ball", x: -0.26, y: h + rb + 0.0005, props: { start_speed: 0.05 } }], { seconds: 4, release: 0.0 })
	let best = 0
	for (const f of v.track.frames) if (f.t > 0.3 && f.t < 2.5) best = Math.max(best, (f.placements["ball/ball"] ?? v.track.frames[0].placements["ball/ball"]).y)
	const bottom = TRACK_T + rb
	truth("coaster valley: the ball climbs back to ≥ 97 % of its drop (energy kept)", (best - bottom) / (h + rb - bottom) >= 0.97, `${(((best - bottom) / (h + rb - bottom)) * 100).toFixed(2)} %`)
}

// ================================================================ balloon rocket
if (which === "balloon" || which === "all") {
	const r = run([{ id: "b", type: "balloon-rocket", x: 0, y: 0, props: { string: 10 } }], { seconds: 6, release: 0.2, fps: 120, table: false })
	const thrust = series(r, "b", "thrust").find((x) => x > 0) ?? 0
	check("balloon rocket: its push 2·C_c·Δp·A at 3 kPa through a 10 mm neck (spec ≈ 0.3-0.4 N)", thrust, 2 * 0.62 * 3000 * Math.PI * 0.005 * 0.005, 0.02, " N")
	const vol = series(r, "b", "volume")
	const kEmpty = vol.findIndex((x) => x <= vol[vol.length - 1] + 1e-9)
	const V0 = (4 / 3) * Math.PI * 0.125 ** 3
	// (the latex holds its pressure while it shrinks [Merritt & Weinhaus 1978]: the air leaves at C_c·A·√(2Δp/ρ))
	check("balloon rocket: it empties in V ÷ (C_c·A·√(2Δp/ρ)) at 3 kPa", r.track.frames[kEmpty].t - r.release, V0 / (0.62 * Math.PI * 0.005 * 0.005 * Math.sqrt((2 * 3000) / 1.2)), 0.1, " s")
	const xs = r.track.frames.map((f) => (f.placements["b/straw"] ?? r.track.frames[0].placements["b/straw"]).x)
	const went = xs[xs.length - 1] - xs[0]
	// (the spec's 3-6 m is a classroom ballpark with no source: this model's thrust, burn and drag carry a 25 cm balloon to the end of a 10 m
	// string; a slacker string, a smaller or leakier balloon go less far)
	truth("balloon rocket: it runs at least 3 m along a taut 10 m string (spec ballpark 3-6 m)", went >= 3, `${went.toFixed(2)} m`)
}

// ================================================================ K10: the egg
if (which === "egg" || which === "all") {
	const drop = (h: number, foam = false) => {
		const items: Item[] = []
		let base = 0
		if (foam) {
			items.push({ id: "foam", type: "foam-block", x: 1.3, y: 0.05, props: {} })
			base = 0.1
		}
		items.push({ id: "egg", type: "egg", x: 1.3, y: base + 0.0225 + 0.001 + h, angle: 0, props: { fragile: true } })
		const r = run(items, { seconds: 1.2, release: 0.0, fps: 240 })
		const br = series(r, "egg", "broken")
		const pk = series(r, "egg", "peak")
		return { broken: (br[br.length - 1] ?? 0) >= 0.5, peak: pk[pk.length - 1] ?? 0 }
	}
	const t = drop(0.5)
	truth("K10 an egg dropped 0.5 m onto the table breaks", t.broken)
	check("K10 its peak force ≈ 3.1·√(1.5e4·0.057) = 92 N (spec)", t.peak, 3.13 * Math.sqrt(1.5e4 * 0.057), 0.05, " N")
	const f = drop(0.5, true)
	truth("K10 onto a 10 cm foam block it survives", !f.broken, `peak ${f.peak.toFixed(1)} N`)
	let lo = 0.01
	let hi = 0.2
	for (let i = 0; i < 8; i++) {
		const mid = (lo + hi) / 2
		if (drop(mid).broken) hi = mid
		else lo = mid
	}
	truth("K10 the crack height onto the table is about 7 cm (5-9 cm; the spec's calibration)", hi >= 0.05 && hi <= 0.09, `${(hi * 100).toFixed(1)} cm`)
}

// ================================================================ screw jack
if (which === "screw" || which === "all") {
	const jack = (props: Record<string, unknown>, seconds = 4) => {
		const r = run([{ id: "j", type: "screw-jack", x: 1.3, y: 0, props }], { seconds, release: 0.5 })
		const lift = series(r, "j", "lift")
		return { r, lift, end: lift[lift.length - 1] ?? 0, P: r.resolved.j as Record<string, number> }
	}
	const a = jack({ load: 20 })
	const k1 = kAt(a.r, 1.5)
	const k2 = kAt(a.r, 3.5)
	check("screw jack: it lifts at turns × pitch (1 turn/s × 5 mm)", (a.lift[k2] - a.lift[k1]) / (a.r.track.frames[k2].t - a.r.track.frames[k1].t), 1 * 0.005, 0.01, " m/s")
	check("screw jack: ideal advantage 2π·L/p (20 cm handle, 5 mm thread)", a.P.advantage, (2 * Math.PI * 0.2) / 0.005, 1e-4)
	const most = a.P.lift_force / G - a.P.moving_mass // kg: what efficiency × effort × 2π·L/p holds up, less its own moving parts
	console.log(`info  screw jack: a 10 N push lifts at most ${most.toFixed(2)} kg (0.3 × 10 N × ${a.P.advantage.toFixed(1)} = ${a.P.lift_force.toFixed(1)} N, less ${a.P.moving_mass.toFixed(2)} kg of cap, screw and bar)`)
	const under = jack({ load: Math.round(most * 0.97 * 2) / 2 })
	const over = jack({ load: Math.round(most * 1.03 * 2) / 2 })
	truth("screw jack: 3 % under the most it can lift, it lifts", under.end > 0.01, `${(under.end * 1000).toFixed(1)} mm`)
	truth("screw jack: 3 % over it, it does not (it holds where it is: a self-locking thread)", over.end < 0.002, `${(over.end * 1000).toFixed(2)} mm`)
	// a handle twice as long: twice the lifting force (its own bar a little heavier): 97 % of that rises, which the short handle could not budge
	const long = jack({ load: 20, handle: 0.4 })
	const mostLong = long.P.lift_force / G - long.P.moving_mass
	check("screw jack: a handle twice as long, twice the lifting force", long.P.lift_force, 2 * a.P.lift_force, 1e-6, " N")
	const twice = jack({ load: Math.round(mostLong * 0.97), handle: 0.4 })
	truth("screw jack: with it, about twice the load rises", twice.end > 0.01 && twice.P.load > 1.9 * most, `${twice.P.load} kg rose ${(twice.end * 1000).toFixed(1)} mm (the 20 cm handle's most: ${most.toFixed(1)} kg)`)
}

// ================================================================ K12: force arrows
const fAt = (r: Run, item: string, kind: string, k: number) => ({ x: series(r, item, `f_${kind}_x`)[k] ?? 0, y: series(r, item, `f_${kind}_y`)[k] ?? 0 })
if (which === "arrows" || which === "all") {
	// a book at rest on the table
	const b = run([{ id: "book", type: "hardcover-book", x: 1.3, y: 0.0185, props: { arrows: "gravity+support" } }], { seconds: 1.5, release: 0.3 })
	const n = b.track.frames.length - 1
	const g = fAt(b, "book", "gravity", n)
	const sup = fAt(b, "book", "support", n)
	const net = fAt(b, "book", "net", n)
	check("K12 a book on the table: gravity = m·g (0.65 kg)", -g.y, 0.65 * G, 1e-6, " N")
	check("K12 the table's support is gravity's size (± 1 %; the air's buoyancy holds 0.17 % of it)", sup.y, -g.y, 0.01, " N")
	truth("K12 support straight up, gravity straight down", Math.abs(sup.x) < 1e-6 && Math.abs(g.x) === 0 && sup.y > 0 && g.y < 0)
	check("K12 the net force is 0 (balanced)", Math.hypot(net.x, net.y) / -g.y, 0, 0.005, "", false)
	check("K12 support acts where the book meets the table top (y 0)", series(b, "book", "f_support_py")[n] ?? NaN, 0, 0.0015, " m", false)
	// a tug of war: 5 N against 3 N on a 1 kg cart
	const t = run(
		[
			{ id: "gym", type: "floor", x: 1.3, y: 0, props: { length: 4 } },
			{ id: "cart", type: "dynamics-cart", x: 1.3, y: 0.0005, props: { load: 0.75, arrows: "all+net" } },
			{ id: "L", type: "puller", x: 0.3, y: 0, props: { pulls: "cart", faces: "right", force: 5 } },
			{ id: "R", type: "puller", x: 2.3, y: 0, props: { pulls: "cart", faces: "left", force: 3 } }
		],
		{ seconds: 1.2, release: 0.2, table: false }
	)
	const k = kAt(t, 0.8)
	const pulls = [fAt(t, "cart", "tension1", k), fAt(t, "cart", "tension2", k)].sort((p, q) => p.x - q.x)
	check("K12 tug of war: the 5 N winch's own pull", -pulls[0].x, 5, 0.01, " N")
	check("K12 tug of war: the 3 N winch's own pull", pulls[1].x, 3, 0.01, " N")
	const tn = fAt(t, "cart", "net", k)
	const sum = ["gravity", "support", "push", "friction", "tension", "spring", "air", "buoyancy", "magnetic", "applied"].reduce((a, kind) => a + fAt(t, "cart", kind, k).x, 0)
	check("K12 tug of war: net = 5 − 3 + friction + the air (the arrows' sum)", tn.x, sum, 1e-9, " N", false)
	truth("K12 tug of war: the net points to the 5 N side, under 2 N (rolling friction takes a little)", tn.x < -1.9 && tn.x > -2, `${tn.x.toFixed(4)} N`)
	// Newton's second law for the cart and its wheels (the forces between them are left out): net = Δp/Δt over 0.4-1.0 s (total_mass counts its wheels)
	const M = resolvedNum(t, "cart", "total_mass")
	const k0 = kAt(t, 0.4)
	const k1 = kAt(t, 1.0)
	const v = (kk: number) => (pose(t, "cart/chassis", kk + 1).x - pose(t, "cart/chassis", kk - 1).x) / (t.track.frames[kk + 1].t - t.track.frames[kk - 1].t)
	let mean = 0
	for (let kk = k0; kk <= k1; kk++) mean += fAt(t, "cart", "net", kk).x
	mean /= k1 - k0 + 1
	check("K12 Newton's 2nd law: the mean net force = M·Δv/Δt (0.4-1.0 s)", mean, (M * (v(k1) - v(k0))) / (t.track.frames[k1].t - t.track.frames[k0].t), 0.01, " N")
	// a block floating in water (the liquids module's push shows as buoyancy)
	const w = run(
		[
			{ id: "tank", type: "water-tank", x: 1.2, y: 0, props: { style: "aquarium" } },
			{ id: "block", type: "wooden-block", x: 1.2, y: 0.215, props: { arrows: "gravity+buoyancy+net" } }
		],
		{ seconds: 3, release: 0.3 }
	)
	const wk = w.track.frames.length - 1
	let bmean = 0
	let gmean = 0
	const kw0 = kAt(w, 2.0)
	for (let kk = kw0; kk <= wk; kk++) {
		bmean += fAt(w, "block", "buoyancy", kk).y / (wk - kw0 + 1)
		gmean += fAt(w, "block", "gravity", kk).y / (wk - kw0 + 1)
	}
	check("K12 a floating block: buoyancy (water's and air's) = its weight, 2-3 s", bmean, -gmean, 0.01, " N")
	// a parachute at its steady speed
	const c = run([{ id: "chute", type: "parachute", x: 1.3, y: 1.9, held: true, props: { arrows: "gravity+air+net", canopy: 0.5 } }], { seconds: 1.3, release: 0.2 })
	const ck = kAt(c, 1.0)
	check("K12 a parachute at its steady speed: the air's push = gravity", fAt(c, "chute", "air", ck).y, -fAt(c, "chute", "gravity", ck).y, 0.02, " N")
	// a coffee filter speeding up as the air's drag grows: each reading is the mean over the last 1/60 s (8 steps), so at 480 frames a second it is
	// m·(v_n − v_(n−8))/(8h), v_n = (y_n − y_(n−1))/h the engine's step velocity (planck's Euler step), 0.1 s after the release
	const f = run([{ id: "cf", type: "coffee-filters", x: 1.3, y: 2.0, held: true, props: { count: 1, arrows: "net" } }], { seconds: 0.6, release: 0.2, fps: 480 })
	const fk = kAt(f, 0.3)
	const vy = (kk: number) => (pose(f, "cf/filter", kk).y - pose(f, "cf/filter", kk - 1).y) / (f.track.frames[kk].t - f.track.frames[kk - 1].t)
	check("K12 a falling coffee filter: net force = m·a, over the reading's window (1.1 g, drag growing)", fAt(f, "cf", "net", fk).y, (0.0011 * (vy(fk) - vy(fk - 8))) / (f.track.frames[fk].t - f.track.frames[fk - 8].t), 0.005, " N")
}

// ================================================================ K11: energy bars
if (which === "energy" || which === "all") {
	const books = (r: Run, item: string, kk: number) => ["e_kinetic", "e_potential", "e_spring", "e_heat"].reduce((a, key) => a + (series(r, item, key)[kk] ?? 0), 0) - (series(r, item, "e_added")[kk] ?? 0)
	const swing = (air: boolean) => {
		const r = run([{ id: "pend", type: "pendulum", x: 1.3, y: 1.5, props: { start_angle: 30, show_energy: true } }], { seconds: 4.3, release: 0.3, ...(air ? {} : { settings: { air: false } }) })
		const ke = series(r, "pend", "e_kinetic")
		const pe = series(r, "pend", "e_potential")
		const low = Math.min(...pe)
		const energy = pe[0] - low
		let worst = 0
		for (let kk = 0; kk < ke.length; kk++) worst = Math.max(worst, Math.abs(ke[kk] + pe[kk] + (series(r, "pend", "e_spring")[kk] ?? 0) - pe[0]))
		return { r, energy, worst, heat: series(r, "pend", "e_heat"), ke }
	}
	const v = swing(false)
	check("K11 a pendulum swinging 30° in a vacuum: KE + PE stays its start's (within 0.5 % of the swing's energy)", v.worst / v.energy, 0, 0.005, "", false)
	check("K11 its kinetic energy at the bottom is the swing's energy (mg·Δh)", Math.max(...v.ke), v.energy, 0.005, " J")
	truth("K11 in a vacuum nothing turns to heat (< 0.5 %)", v.heat[v.heat.length - 1] <= 0.005 * v.energy, `${v.heat[v.heat.length - 1].toExponential(2)} J of ${v.energy.toFixed(4)} J`)
	const a = swing(true)
	let grows = true
	for (let kk = 1; kk < a.heat.length; kk++) if (a.heat[kk] < a.heat[kk - 1] - 1e-6) grows = false
	truth("K11 with air some turns to heat, never less as the run goes on", a.heat[a.heat.length - 1] > 0 && grows, `${a.heat[a.heat.length - 1].toExponential(3)} J after 4 s (${((100 * a.heat[a.heat.length - 1]) / a.energy).toFixed(2)} %)`)
	// a ball falling 1 m in a vacuum: ½mv² = m·g·h, to the bit of the step's mean height
	const fall = run([{ id: "ball", type: "steel-ball", x: 1.3, y: 1.2, held: true, props: { show_energy: true } }], { seconds: 0.7, release: 0.2, settings: { air: false } })
	const fk = kAt(fall, 0.6)
	const fke = series(fall, "ball", "e_kinetic")[fk]
	const fpe = series(fall, "ball", "e_potential")
	check("K11 a ball falling in a vacuum: the kinetic energy it gains is the potential energy it loses", fke, fpe[0] - fpe[fk], 1e-9, " J")
	// a 200 g weight bouncing on an undamped 20 N/m spring in a vacuum
	const sp = run([{ id: "sp", type: "hanging-spring", x: 1.3, y: 1.6, props: { damping: 0, start_stretch: 0.2, show_energy: true } }], { seconds: 3.3, release: 0.3, settings: { air: false } })
	const se = series(sp, "sp", "e_spring")
	const ske = series(sp, "sp", "e_kinetic")
	const spe = series(sp, "sp", "e_potential")
	let sw = 0
	let smax = 0
	for (let kk = 0; kk < se.length; kk++) {
		sw = Math.max(sw, Math.abs(ske[kk] + spe[kk] + se[kk] - (ske[0] + spe[0] + se[0])))
		smax = Math.max(smax, ske[kk])
	}
	truth("K11 a spring's energy is counted (½kx² of the engine's spring)", Math.max(...se) > 0.001, `${Math.max(...se).toFixed(4)} J at most`)
	check("K11 a weight bouncing on an undamped spring in a vacuum: KE + PE + ½kx² stays its start's (within 0.5 % of its swing)", sw / smax, 0, 0.005, "", false)
	// a block slid along the table: friction takes all its kinetic energy; the leftover is never below −1e-6 J
	const sl = run([{ id: "blk", type: "wooden-block", x: 0.6, y: 0.0255, props: { start_speed: 1, show_energy: true } }], { seconds: 1.0, release: 0.2 })
	const heat = series(sl, "blk", "e_heat")
	const added = series(sl, "blk", "e_added")
	const n = heat.length - 1
	const start = books(sl, "blk", n)
	check("K11 a block sliding to a stop: all its kinetic energy (½·0.177 kg·1 m/s²) turns to heat", heat[n], 0.5 * (resolvedNum(sl, "blk", "mass") || 0.1 * 0.05 * 0.05 * 700) * 1, 0.05, " J")
	truth("K11 the leftover (start − the energies) is never below −1e-6 J", Math.max(...added) <= 1e-6, `most put in ${Math.max(...added).toExponential(2)} J`)
	let worstBook = 0
	for (let kk = kAt(sl, 0.21); kk <= n; kk++) worstBook = Math.max(worstBook, Math.abs(books(sl, "blk", kk) - start))
	check("K11 the bookkeeping: start + added = KE + PE + spring + heat at every frame", worstBook, 0, 1e-9, " J", false)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
