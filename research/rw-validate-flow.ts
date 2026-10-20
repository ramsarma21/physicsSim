// The flow module against theory and measurements (tooling/src/sim/flow.ts, tooling/src/sim/modules/flow.ts, machines/mod_flow.py and its port
// web/sim/modules/flow.js). Engine scenes are built by web/sim (the exact port of the Python builder) and run by the server's engine (node,
// with the browser bundle's math) at 480 Hz, 120 frames a second; the particle core's own checks drive tooling/src/sim/flow.ts directly.
// Exits 1 on any failure (a gate).
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-flow.ts [laws|jets|range|drain|siphon|force|viscous|pour|mix|carry|ramp|weigh|float|goals|conserve|determinism|fuzz|all]
// Reference values (cited where they are used):
//   [WHITE] F. M. White, Fluid Mechanics, 7th ed. (2011): sharp-edged orifice C_d 0.61, C_v 0.97 (§6.12); entrance loss 0.5 (Table 6.5); f = 64/Re
//           laminar, Blasius 0.3164·Re^−¼ (eq. 6.48); the force of a jet on a flat plate normal to it, F = ρ·Q·V (momentum, §3.4, Example 3.9);
//           plane Poiseuille flow between plates a gap G apart driven by gravity alone: mean speed g·G²/(12ν) (§6.6).
//   [TORRICELLI] v = √(2gh) (Torricelli 1643): with C_v, the jet's speed; draining a tank through a hole: dh/dt = −(C_d·a/A)·√(2gh), so
//           √h(t) = √h0 − (C_d·a/A)·√(g/2)·t; a jet from depth h below the surface at height y over the ground lands 2·C_v·√(h·y) out (the
//           range is largest for the hole halfway down a bottle standing on the ground).
//   [HENDERSON] F. M. Henderson, Open Channel Flow (1966) §6.6: a sharp-crested weir q = 0.62·⅔·√(2g)·H^{3/2}.
//   [NUSSELT] W. Nusselt (1916): a laminar film of thickness h carries q = g·h³/(3ν) per metre of width.
//   [SAMPSON] R. A. Sampson (1891): creeping flow through a circular hole of radius r, Q = r³Δp/(3μ).
//   [IAPWS-95] water at 20 °C: 998.2 kg/m³, 1.002 mPa·s. [YANNIOTIS] honey ≈ 1420 kg/m³, 10 Pa·s (approximate). Corn syrup 1380, 2.5 Pa·s (approximate).
//   Beer–Lambert: dyes mixed by volume add their absorbances: what shows through is exp(−(Σ xᵢ aᵢ)·path).
import { pathToFileURL } from "node:url"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const sim = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as {
	prepare: (s: unknown) => { scene: Scene; doc: Doc; resolved: Record<string, Record<string, unknown>> }
	finish: (s: unknown, d: Doc, r: unknown, t: Track) => { summary: { goals: { ok: boolean; label: string }[] } }
}
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: unknown } }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: unknown, fps: number) => Track }
await import(`${PG}/tooling/src/sim/modules/index.ts`)
const core = (await import(`${PG}/tooling/src/sim/flow.ts`)) as typeof import("../tooling/src/sim/flow.ts")
const mod = (await import(`${PG}/tooling/src/sim/modules/flow.ts`)) as typeof import("../tooling/src/sim/modules/flow.ts")

type Scene = { items: Item[]; [k: string]: unknown }
type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; held?: boolean; fixed?: boolean }
type Doc = { solids: { id: string; item: string; kind: string; at: { x: number; y: number } }[]; processes?: { kind: string; item?: string; [k: string]: unknown }[] }
type Track = { frames: { t: number; placements: Record<string, { x: number; y: number; angle: number }> }[]; state?: Record<string, Record<string, number[]>>; keyframes?: Record<string, Record<string, number[][]>> }

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
const RHO = 998.2
const MU = 0.001002
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items: Item[], seconds: number, extra: Record<string, unknown> = {}): Scene => ({
	version: 2, id: "v", seconds, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], ...extra
})
/** Runs a scene: its prepared document, the engine's track (and the admitted scene, for the module's own state), the summary. */
const run = (s: Scene) => {
	const { scene: sc, doc, resolved } = sim.prepare(s)
	const adm = admitDocument(doc).scene
	const track = simulate(adm, 120)
	const fin = sim.finish(sc, doc, resolved, track)
	return { doc, track, adm, summary: fin.summary, flow: mod.flowIn(adm as never) }
}
const series = (tr: Track, item: string, key: string) => tr.state?.[item]?.[key] ?? []
const at = (tr: Track, item: string, key: string, t: number) => {
	const v = series(tr, item, key)
	let k = 0
	while (k + 1 < tr.frames.length && (tr.frames[k + 1] as { t: number }).t <= t) k++
	return v[k] as number
}

const want = new Set(process.argv.slice(2))
const on = (k: string) => want.size === 0 || want.has("all") || want.has(k)

// ------------------------------------------------------------------------------------------------ the flow laws (pure)
if (on("laws")) {
	// orifice: water is Torricelli's with C_v (Sampson's term is 10⁻⁴ of the inertial one), honey through a small hole Sampson's [WHITE, SAMPSON]
	for (const h of [0.05, 0.1, 0.15, 0.3]) {
		const p = RHO * G * h
		const { v, q } = core.orificeFlow(p, 0.004, RHO, MU)
		const a = Math.PI * 0.002 * 0.002
		// (Sampson's viscous drop takes 0.3 % off at 5 cm of head, less deeper: water's jets are Torricelli's to 0.5 %)
		check(rel(v, 0.97 * Math.sqrt(2 * G * h)) < 5e-3 && rel(q, 0.61 * a * Math.sqrt(2 * G * h)) < 5e-3, `orifice, water ${h * 100} cm deep, 4 mm hole`, `v ${f(v)} m/s vs C_v√(2gh) ${f(0.97 * Math.sqrt(2 * G * h))}; Q ${f(q * 1e6)} mL/s vs C_d·a·√(2gh) ${f(0.61 * a * Math.sqrt(2 * G * h) * 1e6)}`)
	}
	{
		const p = 1420 * G * 0.05
		const r = 0.001
		const { q } = core.orificeFlow(p, 2 * r, 1420, 10)
		const sampson = (r * r * r * p) / (3 * 10)
		check(rel(q, sampson) < 0.05, "orifice, honey 5 cm deep through a 2 mm hole: creeping flow", `Q ${f(q * 1e9)} µL/s vs Sampson r³Δp/(3μ) ${f(sampson * 1e9)} µL/s`)
	}
	// weir: water as Henderson's sharp crest; a thick film as Nusselt's
	for (const H of [0.005, 0.01, 0.02]) {
		const { q } = core.weirFlow(H, MU / RHO, G)
		const qw = 0.62 * (2 / 3) * Math.sqrt(2 * G) * H ** 1.5
		check(rel(q, qw) < 2e-3, `weir, water, head ${H * 1000} mm`, `q ${f(q * 1000)} vs 0.62·⅔·√(2g)·H^1.5 ${f(qw * 1000)} L/(s·m)`)
	}
	{
		const H = 0.002
		const nu = 10 / 1420
		const { q } = core.weirFlow(H, nu, G)
		// (in series with the weir's inertial flow, which is 45× the film's here: 2.2 % off the film alone)
		check(rel(q, (G * H ** 3) / (3 * nu)) < 0.03, "weir, honey, head 2 mm: a viscous film", `q ${f(q * 1e6)} vs g·H³/(3ν) ${f(((G * H ** 3) / (3 * nu)) * 1e6)} mL/(s·m)`)
	}
	// hose: honey laminar (Poiseuille: v = g·head·d²/(32νL) when the kinetic terms are small); water turbulent against a direct solve
	{
		const nu = 10 / 1420
		const d = 0.008
		const L = 1.0
		const head = 0.2
		const v = core.pipeSpeed(head, d, L, nu, G)
		const pois = (G * head * d * d) / (32 * nu * L)
		check(rel(v, pois) < 0.01, "hose, honey, 8 mm × 1 m, 20 cm head: Poiseuille", `v ${f(v * 1000)} vs g·h·d²/(32νL) ${f(pois * 1000)} mm/s`)
	}
	{
		const d = 0.01
		const L = 1.0
		const head = 0.3
		const v = core.pipeSpeed(head, d, L, MU / RHO, G)
		const Re = (v * d) / (MU / RHO)
		const fb = 0.3164 / Re ** 0.25
		const lhs = 0.5 * v * v * (1 + 0.5 + (fb * L) / d)
		check(Re > 2300 && rel(lhs, G * head) < 1e-6, "hose, water, 10 mm × 1 m, 30 cm head: Bernoulli with Blasius friction", `v ${f(v)} m/s, Re ${f(Re, 5)}; ½v²(1.5 + fL/d) ${f(lhs)} vs g·h ${f(G * head)}`)
	}
	// the kernel's own sums (a triangular packing): rest density, weights, the Laplacian's moment, a wall
	{
		// six neighbours at s (f = (1 − ¼)³) and six at √3·s (f = (1 − ¾)³), H = 2s
		const s = 0.005
		const K = new core.Kernel(s)
		const F0 = 6 * 0.75 ** 3 + 6 * 0.25 ** 3
		const M2 = (6 * 0.75 ** 3 + 18 * 0.25 ** 3) * s * s
		check(rel(K.F0, F0) < 1e-12 && rel(K.M2, M2) < 1e-12 && K.delta0 > 0 && K.wallF > 0, "kernel sums at rest (a triangular packing)", `Σf ${f(K.F0, 8)} vs ${f(F0, 8)}; Σf·r² ${f(K.M2 * 1e6, 8)} vs ${f(M2 * 1e6, 8)} mm²; δ0 ${f(K.delta0)} /m², wall Σf ${f(K.wallF)}`)
	}
	// a basin's level in a tipped box: the clipped area × depth holds its volume exactly; layers stack by density
	{
		const b = new core.Basin([{ x: -0.05, y: 0 }, { x: 0.05, y: 0 }, { x: 0.05, y: 0.15 }, { x: -0.05, y: 0.15 }], 0.08)
		const L = [{ words: "water", density: 998.2, viscosity: 0.001 }, { words: "vegetable oil", density: 920, viscosity: 0.06 }, { words: "honey", density: 1420, viscosity: 10 }]
		b.add(300e-6, 0, [0, 0, 0], L)
		b.add(100e-6, 1, [0, 0, 0], L)
		b.add(100e-6, 2, [0, 0, 0], L)
		b.place({ x: 1, y: 0.5, angle: -0.6 })
		const order = b.layers.map((l) => (L[l.liq] as { words: string }).words).join(", ")
		const below = core.areaBelow(b.world, b.top()) * b.depth
		check(order === "honey, water, vegetable oil" && rel(below, 500e-6) < 1e-9, "basin layers and level, tipped 34°", `layers ${order}; area below the surface × depth ${f(below * 1e6, 10)} mL vs 500`)
		const p = b.pressure(b.bottom, L, G)
		const tops = b.tops
		const want = 1420 * G * ((tops[0] as number) - b.bottom) + 998.2 * G * ((tops[1] as number) - (tops[0] as number)) + 920 * G * ((tops[2] as number) - (tops[1] as number))
		check(rel(p, want) < 1e-12, "hydrostatic pressure at the bottom of three layers", `${f(p, 8)} Pa vs Σ ρ·g·thickness ${f(want, 8)}`)
	}
}

// ------------------------------------------------------------------------------------------------ jets from a bottle's holes
if (on("jets")) {
	const r = run(scene([{ id: "b", type: "leaky-bottle", x: 0.3, y: 0, props: { kept_full: true, stand_cm: 20, holes: 3, lowest_cm: 3, spacing_cm: 5, fill_cm: 20 } }], 2.5))
	// [TORRICELLI, WHITE]: v = C_v·√(2g·depth); reach to the table = v·√(2y/g) from the wall's outside (+ the jet's start just outside it)
	const hy = [0.031, 0.081, 0.131]
	const reach: number[] = []
	hy.forEach((y, k) => {
		const depth = 0.2 + 0.001 - y
		const v = at(r.track, "b", `jet${k + 1}_ms`, 2.0)
		const vt = 0.97 * Math.sqrt(2 * G * depth)
		check(rel(v, vt) < 5e-3, `jet speed, hole ${k + 1} (${f(depth * 100, 3)} cm deep)`, `${f(v)} m/s vs C_v√(2gh) ${f(vt)}`)
		const yy = 0.2 + 0.001 + y - 0.0025 // over the table, to the particle's centre resting on it
		const out = 0.002 + 0.0025 + 0.0005 // (the jet leaves just outside the wall)
		const rt = out + vt * Math.sqrt((2 * yy) / G)
		const rm = Math.max(...series(r.track, "b", `reach${k + 1}_m`))
		reach.push(rm)
		check(rel(rm, rt) < 0.03, `jet reach, hole ${k + 1}, bottle on a 20 cm block`, `lands ${f(rm)} m out vs v·√(2y/g) ${f(rt)} m`)
	})
	check(reach[0]! > reach[1]! && reach[1]! > reach[2]!, "on a block the lowest jet lands farthest", reach.map((x) => f(x)).join(" > "))
	const g = r.summary.goals
	void g
}
if (on("range")) {
	// on the table (no block) the middle hole's jet lands farthest [TORRICELLI]: reach² ∝ depth × height, largest halfway down
	const r = run(scene([{ id: "b", type: "leaky-bottle", x: 0.3, y: 0, props: { kept_full: true, stand_cm: 0, holes: 3, lowest_cm: 3, spacing_cm: 5, fill_cm: 20 } }], 2.5))
	const reach = [1, 2, 3].map((k) => Math.max(...series(r.track, "b", `reach${k}_m`)))
	check(reach[1]! > reach[0]! && reach[1]! > reach[2]!, "standing on the table, the middle jet lands farthest", reach.map((x) => f(x)).join(", "))
	// (the goal wants a clear difference, 1 cm and 5 %: holes at 3, 8 and 13 cm under 20 cm of water land within 3 % of each other for the upper
	// two (√(8·12) vs √(13·7)), too close to call; at 3, 10 and 17 cm the middle one lands clearly farthest (√(10·10) vs √(3·17), 40 %))
	const close = run(scene([{ id: "b", type: "leaky-bottle", x: 0.3, y: 0, props: { kept_full: true, stand_cm: 0 } }], 2.5, { goals: [{ kind: "jet_farthest", item: "b", hole: 2 }] })).summary.goals[0]
	check(close?.ok === false, "goal jet_farthest {hole: 2} on the table, holes 3/8/13 cm: not clearly farthest (3 % over hole 3)", close?.label ?? "no goal")
	const g = run(scene([{ id: "b", type: "leaky-bottle", x: 0.3, y: 0, props: { kept_full: true, stand_cm: 0, spacing_cm: 7 } }], 2.5, { goals: [{ kind: "jet_farthest", item: "b", hole: 2 }] })).summary.goals[0]
	check(g?.ok === true, "goal jet_farthest {hole: 2} on the table, holes 3/10/17 cm: the middle jet clearly farthest", `${g?.label ?? "no goal"} (${(g as unknown as { reach_m?: number })?.reach_m} m)`)
}

// ------------------------------------------------------------------------------------------------ a bottle draining through one hole
if (on("drain")) {
	const r = run(scene([{ id: "b", type: "leaky-bottle", x: 0.3, y: 0, props: { holes: 1, lowest_cm: 1, hole_mm: 8, fill_cm: 20, stand_cm: 0, open_at: 0.5 } }], 6))
	// √h(t) = √h0 − (C_d·a/A)·√(g/2)·t, h over the hole's centre [TORRICELLI]
	const A = (Math.PI / 4) * 0.102 * 0.102
	const a = (Math.PI / 4) * 0.008 * 0.008
	const h0 = 0.2 - 0.01
	const k = ((0.61 * a) / A) * Math.sqrt(G / 2)
	for (const t of [2, 4, 5.5]) {
		const h = (Math.sqrt(h0) - k * (t - 0.5)) ** 2
		const lv = at(r.track, "b", "level_mm", t) / 1000 - 0.01
		check(Math.abs(lv - h) < 0.0005, `draining 8 mm hole: water ${f(t - 0.5, 2)} s after it opens`, `${f(lv * 1000)} mm over the hole vs ${f(h * 1000)} mm`)
	}
}

// ------------------------------------------------------------------------------------------------ siphons between two beakers
if (on("siphon")) {
	// (1) two beakers on the table, 900 and 100 mL, a 14 mm hose: it runs until the surfaces are level [WHITE: Bernoulli with losses]
	{
		const items: Item[] = [
			{ id: "up", type: "beaker", x: 0.8, y: 0, props: { size: "1000 mL", fill_ml: 900 } },
			{ id: "down", type: "beaker", x: 1.25, y: 0, props: { size: "1000 mL", fill_ml: 100 } },
			{ id: "hose", type: "hose", x: 1.1, y: 0.3, props: { from: "up", to: "down", diameter_mm: 14, open_at: 0.5 } }
		]
		const r = run(scene(items, 14))
		const up = series(r.track, "up", "volume_ml")
		const down = series(r.track, "down", "volume_ml")
		const last = up.length - 1
		check(Math.abs(up[0]! + down[0]! - (up[last]! + down[last]!)) < 1e-6, "siphon: no liquid made or lost", `${f(up[0]! + down[0]!, 8)} → ${f(up[last]! + down[last]!, 8)} mL`)
		const recUp = r.doc.processes!.find((p) => p.kind === "liquid" && p.item === "up") as { floor: number }
		const recDn = r.doc.processes!.find((p) => p.kind === "liquid" && p.item === "down") as { floor: number }
		const yu = recUp.floor + at(r.track, "up", "level_mm", 14) / 1000
		const yd = recDn.floor + at(r.track, "down", "level_mm", 14) / 1000
		check(Math.abs(yu - yd) < 0.001, "siphon: it stops with the two surfaces level", `${f(yu * 1000)} vs ${f(yd * 1000)} mm`)
		// its flow at 1 s from Bernoulli with the hose's losses at that moment's head
		const t1 = 1.0
		const head = recUp.floor + at(r.track, "up", "level_mm", t1) / 1000 - (recDn.floor + at(r.track, "down", "level_mm", t1) / 1000)
		const path = r.track.keyframes?.hose?.h?.at(-1)?.slice(1) ?? []
		let L = 0
		for (let k = 0; k + 3 < path.length; k += 2) L += Math.hypot(path[k + 2]! - path[k]!, path[k + 3]! - path[k + 1]!)
		const v = core.pipeSpeed(head, 0.014, L, MU / RHO, G)
		const q = v * (Math.PI / 4) * 0.014 * 0.014 * 1e6
		const qm = at(r.track, "hose", "flow_ml_s", t1)
		check(rel(qm, q) < 0.01, "siphon: flow at 1 s", `${f(qm)} mL/s vs Bernoulli + losses ${f(q)} mL/s (head ${f(head * 100)} cm, hose ${f(L, 3)} m)`)
	}
	// (2) the upper beaker raised on a box: it cannot reach the lower one's level, so it drains to its hose's inlet and the siphon breaks
	{
		const items: Item[] = [
			{ id: "box", type: "box", x: 0.8, y: 0, props: {} },
			{ id: "up", type: "beaker", x: 0.8, y: 0.106, props: { size: "1000 mL", fill_ml: 400 } },
			{ id: "down", type: "beaker", x: 1.25, y: 0, props: { size: "1000 mL", fill_ml: 100 } },
			{ id: "hose", type: "hose", x: 1.1, y: 0.3, props: { from: "up", to: "down", diameter_mm: 14, open_at: 0.5, inlet_cm: 1.5 } }
		]
		const r = run(scene(items, 12))
		const lv = at(r.track, "up", "level_mm", 12)
		check(Math.abs(lv - 15) < 0.5 && at(r.track, "hose", "flow_ml_s", 12) === 0, "siphon: a raised beaker drains to its hose's inlet and the siphon breaks", `its level ${f(lv)} mm vs the inlet at 15 mm; flow ${f(at(r.track, "hose", "flow_ml_s", 12))} mL/s`)
	}
}

// ------------------------------------------------------------------------------------------------ a jet's push on a plate (the particles' momentum)
if (on("force")) {
	// no gravity: a 1 m/s jet of 50 mL/s down onto a fixed plate; the plate takes ρ·Q·V [WHITE]
	const L = [{ words: "water", density: RHO, viscosity: MU }]
	const S = new core.FlowSim(0.005, L)
	const plate = core.makeCollider(0, 1, true, { points: [{ x: -0.2, y: -0.22 }, { x: 0.2, y: -0.22 }, { x: 0.2, y: -0.2 }, { x: -0.2, y: -0.2 }] })
	S.colliders = [plate]
	S.setStatic([true])
	const em = new core.Emitter(0)
	const dt = 1 / 480
	const Q = 50e-6
	let J = 0
	let T = 0
	for (let k = 0; k < 960; k++) {
		em.run(S, dt, 0, 0, 0, -1, 1.0, Q, 0.008, 0, [0, 0, 0], 0)
		plate.jx = 0
		plate.jy = 0
		plate.jt = 0
		S.step(dt, 0)
		if (k >= 480) {
			// (jy: what the particles took up from the plate; the plate is pushed down as much)
			J += plate.jy
			T += dt
		}
		for (let i = 0; i < S.n; i++) if (Math.abs(S.x[i] as number) > 1) S.dead[i] = 1
		S.compact()
	}
	const F = J / T
	check(rel(F, RHO * Q * 1.0) < 0.12, "a jet on a plate: its push", `${f(F)} N vs ρ·Q·V ${f(RHO * Q)} N`)
}

// ------------------------------------------------------------------------------------------------ viscosity: shear waves, and syrup between two walls
if (on("viscous")) {
	// (1) the bulk: a shear wave v_x = A·sin(2πy/λ) in a block at rest (no gravity, no walls) decays as exp(−ν·k²·t) [WHITE §4.10]
	for (const [words, density, viscosity] of [["honey", 1420, 10], ["corn syrup", 1380, 2.5], ["dish soap", 1050, 0.5]] as const) {
		const s = 0.005
		const S = new core.FlowSim(s, [{ words, density, viscosity }])
		S.colliders = []
		S.setStatic([])
		const row = (s * Math.sqrt(3)) / 2
		const lam = 24 * row
		for (let j = 0; j < 48; j++) for (let i = 0; i < 24; i++) S.add(i * s + ((j & 1) !== 0 ? s / 2 : 0), j * row, 0.01 * Math.sin((2 * Math.PI * j * row) / lam), 0, s * s * 0.05, 0, [0, 0, 0], 0, 1)
		const amp = () => {
			let a = 0
			let n = 0
			for (let i = 0; i < S.n; i++) {
				if ((S.y[i] as number) < 0.03 || (S.y[i] as number) > 0.17 || (S.x[i] as number) < 0.02 || (S.x[i] as number) > 0.1) continue
				a += (S.vx[i] as number) * Math.sin((2 * Math.PI * (S.y[i] as number)) / lam)
				n++
			}
			return (2 * a) / n
		}
		const a0 = amp()
		const T = words === "dish soap" ? 0.25 : 0.05
		for (let k = 0; k < Math.round(T * 480); k++) S.step(1 / 480, 0)
		const got = -Math.log(amp() / a0) / T
		const nu = viscosity / density
		const want = nu * ((2 * Math.PI) / lam) ** 2
		check(rel(got, want) < 0.15, `${words}: a shear wave ${f(lam * 100, 3)} cm long dies away at ν·k²`, `decay rate ${f(got)} /s vs ${f(want)} /s (${f(100 * (got / want - 1), 3)} %)`)
	}
	// (2) walls: a tall plug of corn syrup let go between two walls 4 cm apart: its middle settles into plane Poiseuille flow, mean speed
	// g·G²/(12ν) [WHITE §6.6] (measured on the particles that start in its middle, after the flow has developed, before its ends reach them)
	{
		const s = 0.005
		const S = new core.FlowSim(s, [{ words: "corn syrup", density: 1380, viscosity: 2.5 }])
		const gap = 0.04
		const wall = (x0: number, x1: number, key: number) => core.makeCollider(key, 9, false, { points: [{ x: x0, y: -3 }, { x: x1, y: -3 }, { x: x1, y: 0.6 }, { x: x0, y: 0.6 }] })
		S.colliders = [wall(-gap / 2 - 0.02, -gap / 2, 0), wall(gap / 2, gap / 2 + 0.02, 1)]
		S.setStatic([false, false])
		const row = (s * Math.sqrt(3)) / 2
		const rows = 110
		for (let j = 0; j < rows; j++)
			for (let i = 0; i < 9; i++) {
				const x = -gap / 2 + S.rc + i * s + ((j & 1) !== 0 ? s / 2 : 0)
				if (x > gap / 2 - S.rc + 1e-9) continue
				S.add(x, j * row, 0, 0, s * s * 0.05, 0, [0, 0, 0], 0, 1)
			}
		const mid = new Set<number>()
		for (let i = 0; i < S.n; i++) if ((S.y[i] as number) > 0.4 * rows * row && (S.y[i] as number) < 0.6 * rows * row) mid.add(S.pid[i] as number)
		const meanY = () => {
			let m = 0
			let n = 0
			for (let i = 0; i < S.n; i++)
				if (mid.has(S.pid[i] as number)) {
					m += S.y[i] as number
					n++
				}
			return m / n
		}
		const nu = 2.5 / 1380
		const want = (G * gap * gap) / (12 * nu)
		// (developed after a few G²/(π²ν) = 0.09 s; the ends, moving at up to 1.5 × the mean, are still far from the middle by 0.25 s)
		const t0 = 0.15
		const t1 = 0.25
		let y0 = 0
		for (let k = 1; k <= Math.round(t1 * 480); k++) {
			S.step(1 / 480, G)
			if (k === Math.round(t0 * 480)) y0 = meanY()
		}
		const u = (y0 - meanY()) / (t1 - t0)
		check(rel(u, want) < 0.25, `corn syrup between walls ${gap * 100} cm apart: Poiseuille's mean speed`, `${f(u)} m/s vs g·G²/(12ν) ${f(want)} m/s (${f(100 * (u / want - 1), 3)} %)`)
	}
}

// ------------------------------------------------------------------------------------------------ pouring: honey against water
if (on("pour")) {
	const items: Item[] = [
		{ id: "b1", type: "bucket", x: 0.8, y: 0, props: {} },
		{ id: "w", type: "pitcher", x: 0.72, y: 0.45, props: { vessel: "cup", fill_ml: 200, liquid: "water", pour_at: 0.5, tilt: 75 } },
		{ id: "b2", type: "bucket", x: 1.7, y: 0, props: {} },
		{ id: "h", type: "pitcher", x: 1.67, y: 0.45, props: { vessel: "cup", fill_ml: 200, liquid: "honey", pour_at: 0.5, tilt: 75 } }
	]
	const r = run(scene(items, 10, { goals: [{ kind: "pours_faster", a: "w", b: "h" }, { kind: "fills", container: "b1", at_least_ml: 120 }] }))
	const half = (it: string) => {
		const v = series(r.track, it, "left_ml")
		const k = v.findIndex((x) => x <= 100)
		return k < 0 ? Number.POSITIVE_INFINITY : r.track.frames[k]!.t
	}
	const tw = half("w")
	const th = half("h")
	// (tipped 75°, the flow over the lip is a weir's for water and a viscous film's for honey [HENDERSON, NUSSELT])
	check(th / tw > 2, "cups tipped 75°: honey (10 Pa·s) takes over twice as long to pour half as water", `half poured at ${f(tw, 3)} s (water) vs ${f(th, 3)} s (honey)`)
	for (const g of r.summary.goals) check(g.ok, `goal: ${g.label}`, g.ok ? "met" : "not met")
	const poured = series(r.track, "w", "poured_ml").at(-1)!
	const caught = series(r.track, "b1", "liquid_ml").at(-1)!
	check(Math.abs(poured - caught) < 1, "a pour lands in the bucket below its lip", `poured ${f(poured)} mL, caught ${f(caught)} mL`)
}

// ------------------------------------------------------------------------------------------------ colours mix in a container [Beer–Lambert]
if (on("mix")) {
	const items: Item[] = [
		{ id: "jar", type: "glass-jar", x: 1.2, y: 0, props: {} },
		{ id: "blue", type: "pitcher", x: 1.12, y: 0.32, props: { vessel: "cup", fill_ml: 120, dye: "blue", pour_to: "right", pour_at: 0.5 } },
		{ id: "yellow", type: "pitcher", x: 1.28, y: 0.32, props: { vessel: "cup", fill_ml: 120, dye: "yellow", pour_to: "left", pour_at: 2.5 } }
	]
	const r = run(scene(items, 5.5, { goals: [{ kind: "mixes_to", container: "jar", color: "green" }] }))
	const ml = series(r.track, "jar", "liquid_ml").at(-1)!
	const tint = ["tint_r", "tint_g", "tint_b"].map((k) => series(r.track, "jar", k).at(-1)!)
	const water = [0.004, 0.0015, 0.0006]
	const blue = [0.5, 0.08, 0.005]
	const yellow = [0.0, 0.02, 0.5]
	const want = [0, 1, 2].map((k) => Math.exp(-((blue[k]! + yellow[k]!) / 2 + water[k]!) * 5))
	check(ml > 230, "both cups land in the jar (some on its shoulder)", `${f(ml)} mL of 240`)
	check(tint.every((t, k) => Math.abs(t - want[k]!) < 0.02), "blue + yellow in equal parts: the mixed colour", `${tint.map((x) => f(x, 3)).join(", ")} vs exp(−ā·5 cm) ${want.map((x) => f(x, 3)).join(", ")}`)
	const g = r.summary.goals[0]
	check(g?.ok === true, "goal mixes_to green", JSON.stringify(g))
}

// ------------------------------------------------------------------------------------------------ a moving container carries what it holds
if (on("carry")) {
	const items: Item[] = [
		{ id: "mug", type: "coffee-mug", x: 1.2, y: 0.05, props: {} },
		{ id: "tap", type: "tap", x: 1.2, y: 0.3, props: { flow_ml_s: 100, on_at: 0.3, off_at: 2.3 } }
	]
	const r = run(scene(items, 3.5))
	const F = r.flow as unknown as { carried: Map<{ item: string; basin: { layers: { liq: number; vol: number }[] } }, { body: { getMass(): number }; base: { mass: number } }>; liquids: { list: { density: number }[] } }
	const [st, c] = [...F.carried.entries()][0] ?? []
	const liquid = st ? st.basin.layers.reduce((m, l) => m + (F.liquids.list[l.liq] as { density: number }).density * l.vol, 0) : 0
	const body = c ? c.body.getMass() : 0
	check(!!c && rel(body, (c?.base.mass ?? 0) + liquid) < 1e-9 && liquid > 0.15, "a mug filled from a tap: its body's mass is the mug's and its water's", `${f(body, 8)} kg vs ${f(c?.base.mass ?? 0, 6)} + ${f(liquid, 6)} kg`)
	const ml = series(r.track, "mug", "liquid_ml").at(-1)!
	check(ml > 185 && ml <= 200.001, "the mug holds what the tap poured", `${f(ml)} mL of 200`)
}

// ------------------------------------------------------------------------------------------------ water runs down a ramp (a slope is no puddle)
// A film of water on a slope θ flows at Nusselt's mean speed g·sinθ·h²/(3ν) [NUSSELT]: 2 mm deep on 10°, about 2.3 m/s, never at rest; only
// on a near-level surface (within about 6°) does it stop as a puddle. A 60 cm plank at 10, 20 and 30° under a 500 mL pour, its low end over
// a bucket's opening (5 cm in from its left rim) and 7 cm above it: the bucket below must catch 90 % or more.
if (on("ramp")) {
	for (const deg of [10, 20, 30]) {
		const th = (deg * Math.PI) / 180
		const low = { x: 1.315, y: 0.35 }
		const mid = { x: low.x - 0.3 * Math.cos(th), y: low.y + 0.3 * Math.sin(th) }
		const high = { x: low.x - 0.6 * Math.cos(th), y: low.y + 0.6 * Math.sin(th) }
		const items: Item[] = [
			{ id: "r", type: "plank", x: mid.x, y: mid.y, angle: -deg, props: { length: 0.6, legs: false } },
			{ id: "b", type: "bucket", x: 1.4, y: 0.004, props: {} },
			// (poured a quarter of the way down, its lip 12 cm over the high end: water landing at the very top runs back over that end too)
			{ id: "p", type: "pitcher", x: high.x + 0.15, y: high.y + 0.12, props: { fill_ml: 500 } }
		]
		const r = run(scene(items, 7))
		const got = series(r.track, "b", "liquid_ml").at(-1) ?? 0
		const pud = Math.max(0, ...Object.values(r.track.state ?? {}).map((st) => (st.puddle_ml ?? []).at(-1) ?? 0))
		check(got >= 450, `a ${deg}° plank runs a 500 mL pour into the bucket below its low end`, `${f(got)} mL caught (≥ 450), ${f(pud)} mL left in puddles`)
	}
}

// ------------------------------------------------------------------------------------------------ what a container holds weighs
// A kitchen scale under a mug a tap fills: its reading rises by the water's mass, 0.998 g a millilitre [IAPWS-95].
if (on("weigh")) {
	const items: Item[] = [
		{ id: "sc", type: "kitchen-scale", x: 1.2, y: 0, props: {} },
		{ id: "m", type: "coffee-mug", x: 1.2, y: 0.0755, props: {} },
		{ id: "t", type: "tap", x: 1.2, y: 0.4, props: { flow_ml_s: 60, on_at: 0.5, off_at: 3.5 } }
	]
	const r = run(scene(items, 6))
	const g0 = at(r.track, "sc", "grams", 0.45)
	const g1 = series(r.track, "sc", "grams").at(-1) ?? 0
	const ml = series(r.track, "m", "liquid_ml").at(-1) ?? 0
	check(ml > 170 && rel(g1 - g0, ml * 0.9982) < 0.03, "a tap filling a mug on a kitchen scale raises the reading by about 1 g a mL", `${f(g0)} g → ${f(g1)} g for ${f(ml)} mL (want +${f(ml * 0.9982)} g)`)
}

// ------------------------------------------------------------------------------------------------ things float in a container a tap fills
// A cork (about 200 kg/m³) in a jar a tap fills rises with the water and floats a fifth under (ρ_cork/ρ_water ≈ 0.2: Archimedes).
if (on("float")) {
	const items: Item[] = [
		{ id: "j", type: "glass-jar", x: 1.2, y: 0, props: {} },
		{ id: "c", type: "cork", x: 1.2, y: 0.02, props: {} },
		{ id: "t", type: "tap", x: 1.2, y: 0.35, props: { flow_ml_s: 100, on_at: 0.3, off_at: 3.5 } }
	]
	const r = run(scene(items, 6, { goals: [{ kind: "floats", item: "c" }] }))
	const y0 = r.track.frames[0]!.placements["c/body"]?.y ?? r.track.frames[0]!.placements[Object.keys(r.track.frames[0]!.placements).find((k) => k.startsWith("c/")) ?? ""]?.y ?? 0
	const cid = Object.keys(r.track.frames.at(-1)!.placements).find((k) => k.startsWith("c/")) ?? ""
	const y1 = r.track.frames.at(-1)!.placements[cid]?.y ?? 0
	const sub = series(r.track, "c", "submerged").at(-1) ?? 0
	check(r.summary.goals[0]?.ok === true && y1 - y0 > 0.03 && sub > 0.1 && sub < 0.35, "a cork in a jar a tap fills floats up", `rose ${f((y1 - y0) * 100)} cm; ${f(sub * 100)} % under (cork ρ/water ρ about 20 %)`)
}

// ------------------------------------------------------------------------------------------------ a siphon flows from the higher surface whatever its ends are called
if (on("siphon")) {
	const items: Item[] = [
		{ id: "box", type: "box", x: 0.8, y: 0, props: {} },
		{ id: "up", type: "beaker", x: 0.8, y: 0.106, props: { size: "1000 mL", fill_ml: 900 } },
		{ id: "down", type: "beaker", x: 1.25, y: 0, props: { size: "1000 mL", fill_ml: 100 } },
		{ id: "hose", type: "hose", x: 1.25, y: 0.2, props: { from: "down", to: "up", diameter_mm: 14 } }
	]
	const r = run(scene(items, 10))
	const moved = series(r.track, "hose", "moved_ml").at(-1) ?? 0
	const ev = ((r.track as unknown as { events?: { text: string }[] }).events ?? []).map((e) => e.text)
	check(moved > 500 && ev.some((t) => /runs from up to down/.test(t)), "a hose named the other way round (from the lower beaker) still siphons from the higher one", `${f(moved)} mL moved; "${ev.find((t) => /runs from/.test(t)) ?? "no event"}"`)
}

// ------------------------------------------------------------------------------------------------ the two-item goals and what a run says
if (on("goals")) {
	// (jets: deeper water squirts farther: v = C_v·√(2g·depth), reach = v·√(2y/g) [TORRICELLI])
	const jets = run(scene([
		{ id: "deep", type: "leaky-bottle", x: 0.1, y: 0, props: { holes: 1, lowest_cm: 3, fill_cm: 20, kept_full: true, stand_cm: 15 } },
		{ id: "shallow", type: "leaky-bottle", x: 1.4, y: 0, props: { holes: 1, lowest_cm: 3, fill_cm: 8, kept_full: true, stand_cm: 15 } }
	], 3, { goals: [{ kind: "reaches_farther", a: "deep", b: "shallow" }, { kind: "reaches_farther", a: "shallow", b: "deep" }] }))
	const g = jets.summary.goals as unknown as { ok: boolean; a_m: number; b_m: number }[]
	const want = Math.sqrt((0.20 - 0.03) / (0.08 - 0.03))
	check(g[0]?.ok === true && g[1]?.ok === false && rel(g[0]!.a_m / g[0]!.b_m, want) < 0.15, "reaches_farther: the deeper bottle's jet lands farther, the shallower's does not", `${f(g[0]?.a_m ?? 0)} m vs ${f(g[0]?.b_m ?? 0)} m (ratio ${f((g[0]?.a_m ?? 0) / (g[0]?.b_m ?? 1))}, √(17/5) = ${f(want)})`)
	// (wheels: a strong stream turns its wheel faster than a trickle does)
	const wheels = run(scene([
		{ id: "w1", type: "waterwheel", x: 0.7, y: 0.45, props: {} }, { id: "t1", type: "tap", x: 0.784, y: 0.75, props: { flow_ml_s: 140, on_at: 0.3 } },
		{ id: "w2", type: "waterwheel", x: 1.7, y: 0.45, props: {} }, { id: "t2", type: "tap", x: 1.784, y: 0.75, props: { flow_ml_s: 30, on_at: 0.3 } }
	], 4, { goals: [{ kind: "turns_faster", a: "w1", b: "w2" }, { kind: "turns_faster", a: "w2", b: "w1" }] }))
	const w = wheels.summary.goals as unknown as { ok: boolean; a_rpm: number; b_rpm: number }[]
	check(w[0]?.ok === true && w[1]?.ok === false, "turns_faster: the wheel under 140 mL/s keeps a faster speed than the one under 30 mL/s", `${f(w[0]?.a_rpm ?? 0)} rpm vs ${f(w[0]?.b_rpm ?? 0)} rpm, each held half a second`)
	// (two taps: the more open fills its jar sooner; and the jar under it overflows)
	const fill = run(scene([
		{ id: "j1", type: "glass-jar", x: 0.8, y: 0, props: {} }, { id: "t1", type: "tap", x: 0.8, y: 0.3, props: { flow_ml_s: 120, on_at: 0.5 } },
		{ id: "j2", type: "glass-jar", x: 1.6, y: 0, props: {} }, { id: "t2", type: "tap", x: 1.6, y: 0.3, props: { flow_ml_s: 40, on_at: 0.5 } }
	], 6, { goals: [{ kind: "fills_faster", a: "j1", b: "j2" }, { kind: "fills_faster", a: "j2", b: "j1" }, { kind: "overflows", container: "j1" }, { kind: "overflows", container: "j2" }] }))
	const q = fill.summary.goals as unknown as { ok: boolean; a_s: number; b_s: number }[]
	check(q[0]?.ok === true && q[1]?.ok === false && q[2]?.ok === true && q[3]?.ok === false, "fills_faster and overflows: 120 mL/s fills its jar three times sooner and overflows it; 40 mL/s in 5.5 s does not", `${f(q[0]?.a_s ?? 0)} s vs ${f(q[0]?.b_s ?? 0)} s; overflows ${q[2]?.ok}/${q[3]?.ok}`)
	const ev = ((fill.track as unknown as { events?: { text: string }[] }).events ?? []).map((e) => e.text)
	check(ev.some((t) => /^t1 turns on \(120 mL\/s\)$/.test(t)) && ev.some((t) => /^j2 fills to \d+ mL$/.test(t)), "the run says when a tap turns on and how full each jar gets", ev.slice(0, 4).join("; "))
	// (oil on blue water: two layers that do not mix; the jar is the biggest layer's colour, never a blend that says green)
	const oil = run(scene([
		{ id: "j", type: "glass-jar", x: 1.25, y: 0, props: {} },
		{ id: "o", type: "pitcher", x: 1.17, y: 0.32, props: { vessel: "cup", fill_ml: 100, liquid: "vegetable oil", dye: "yellow", pour_at: 0.5 } },
		{ id: "w", type: "pitcher", x: 1.33, y: 0.32, props: { vessel: "cup", fill_ml: 160, pour_to: "left", pour_at: 3.5, dye: "blue" } }
	], 8, { goals: [{ kind: "mixes_to", container: "j", color: "green" }, { kind: "mixes_to", container: "j", color: "blue" }] }))
	const m = oil.summary.goals as unknown as { ok: boolean; color: string }[]
	check(m[0]?.ok === false && m[1]?.ok === true, "mixes_to: yellow oil on blue water is not green (they do not mix); the jar is its biggest layer's colour", `got ${m[0]?.color}`)
}

// ------------------------------------------------------------------------------------------------ every millilitre accounted for
if (on("conserve")) {
	const items: Item[] = [
		{ id: "bx", type: "box", x: 0.6, y: 0, props: {} },
		{ id: "p", type: "pitcher", x: 0.53, y: 0.4, props: { vessel: "jug", fill_ml: 1200, pour_at: 0.4 } },
		{ id: "bk", type: "beaker", x: 1.3, y: 0, props: { size: "600 mL", fill_ml: 100 } },
		{ id: "tap", type: "tap", x: 1.3, y: 0.4, props: { flow_ml_s: 150, on_at: 0.2, dye: "red" } },
		{ id: "b", type: "leaky-bottle", x: 2.0, y: 0, props: { kept_full: true } },
		{ id: "cup", type: "plastic-cup", x: 2.9, y: 0, props: {} },
		{ id: "hose", type: "hose", x: 2.9, y: 0.25, props: { from: "bk", to: "cup", diameter_mm: 6 } }
	]
	const { doc } = sim.prepare(scene(items, 4))
	const adm = admitDocument(doc).scene
	// (the budget at the start: the run's own Flow, made at its start, read before any step by a zero-second run of the same document)
	const zero = admitDocument({ ...doc, seconds: 0 }).scene
	simulate(zero, 120)
	const b0 = mod.flowIn(zero as never)!.budget()
	simulate(adm, 120)
	const b1 = mod.flowIn(adm as never)!.budget()
	const sum = (b: typeof b0) => b.basins + b.regions + b.particles + b.puddles + b.spilled + b.owed
	const lhs = sum(b1)
	const rhs = sum(b0) + b1.inflow - b0.inflow
	check(rel(lhs, rhs) < 1e-9, "conservation: every container, particle, puddle and spill", `${f(lhs * 1e6, 12)} mL vs start ${f(sum(b0) * 1e6, 10)} + in ${f((b1.inflow - b0.inflow) * 1e6, 10)} mL`)
}

// ------------------------------------------------------------------------------------------------ determinism
if (on("determinism")) {
	const items: Item[] = [
		{ id: "w", type: "waterwheel", x: 1.2, y: 0.5, props: {} },
		{ id: "tap", type: "tap", x: 1.29, y: 0.8, props: { flow_ml_s: 120 } },
		{ id: "bu", type: "bucket", x: 1.3, y: 0, props: {} },
		{ id: "p", type: "pitcher", x: 0.5, y: 0.35, props: { dye: "purple" } },
		{ id: "j", type: "glass-jar", x: 0.58, y: 0, props: {} }
	]
	const a = JSON.stringify(run(scene(items, 2.5)).track)
	const b = JSON.stringify(run(scene(items, 2.5)).track)
	check(a === b, "two runs of one scene give the same track, byte for byte", `${a.length} bytes`)
	const r = run(scene(items, 2.5, { goals: [{ kind: "turns", item: "w", at_least_rpm: 20 }] }))
	check(r.summary.goals[0]?.ok === true, "a tap's stream turns a waterwheel", `fastest ${f(Math.max(...series(r.track, "w", "rpm")))} rpm`)
}

// ------------------------------------------------------------------------------------------------ fuzz: random flow scenes run, finish and stay finite
if (on("fuzz")) {
	let seed = 12345
	const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296)
	const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)] as T
	let bad = 0
	const N = Number(process.env.FLOW_FUZZ ?? 12)
	for (let n = 0; n < N; n++) {
		const items: Item[] = []
		const kinds = ["pitcher", "tap", "leaky-bottle", "waterwheel", "bucket", "plastic-cup", "glass-jar", "coffee-mug", "beaker", "bowl"]
		for (let k = 0; k < 5; k++) {
			const type = pick(kinds)
			const x = 0.2 + rnd() * 2.6
			const props: Record<string, unknown> = {}
			if (type === "pitcher") Object.assign(props, { vessel: pick(["pitcher", "jug", "measuring cup", "cup"]), liquid: pick(["water", "honey", "vegetable oil", "corn syrup", "salt water"]), dye: pick(["none", "red", "blue"]), tilt: 30 + rnd() * 130, pour_at: rnd() * 1.5, pour_to: pick(["left", "right"]) })
			if (type === "tap") Object.assign(props, { flow_ml_s: 5 + rnd() * 240, liquid: pick(["water", "dish soap"]) })
			if (type === "leaky-bottle") Object.assign(props, { holes: 1 + Math.floor(rnd() * 4), hole_mm: 1.5 + rnd() * 6, kept_full: rnd() < 0.5, cap: rnd() < 0.2, stand_cm: Math.floor(rnd() * 40) })
			const air = ["pitcher", "tap", "waterwheel"].includes(type)
			items.push({ id: `i${k}`, type, x, y: air ? 0.25 + rnd() * 0.5 : type === "coffee-mug" || type === "bowl" ? 0.06 : 0, props })
		}
		if (rnd() < 0.5) items.push({ id: "hose", type: "hose", x: 1.5, y: 0.3, props: { from: items.find((i) => ["bucket", "plastic-cup", "glass-jar", "beaker", "pitcher"].includes(i.type))?.id ?? "i0" } })
		try {
			const r = run(scene(items, 2))
			const st = JSON.stringify(r.track.state ?? {})
			const kf = JSON.stringify(r.track.keyframes ?? {})
			if (st.includes("null") || st.includes("NaN") || kf.includes("null") || kf.includes("NaN")) {
				bad++
				console.log("  fuzz scene", n, "has a non-number:", JSON.stringify(items).slice(0, 300))
			}
		} catch (e) {
			bad++
			console.log("  fuzz scene", n, "failed:", String(e).slice(0, 200))
		}
	}
	check(bad === 0, `fuzz: ${N} random scenes of flow items run and stay finite`, `${bad} bad`)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
