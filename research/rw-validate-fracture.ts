// The fracture module against real reference values (machines/mod_fracture.py, tooling/src/sim/fracture.ts, tooling/src/sim/modules/fracture.ts).
// Every gate builds scenes from the catalog (web/sim, the same documents as machines/items.py: tools/fracture/test.mjs), runs them in the
// server's engine (tooling/src/sim, node) and compares what it does with the measured value it rests on, within a stated tolerance:
//   egg      an egg's crush force under a load resting on it (fixed: held in a carton) vs 34.9-36.4 N [EGG-F]; its crack speed on a rigid floor
//            vs 1.0 m/s [EGG-V]; at 4 m/s it is smashed [EGG-V]; its pieces weigh what it did
//   padding  the compression laws at their sources' points (PU foam 4 kPa at 40 % [PU], EPS 100 kPa at 10 % [EPS], Boyle's law [AIR]); the peak
//            force through padding in the engine vs the module's own energy balance; the order of the paddings an egg survives (softer and
//            thicker: from higher)
//   glass    an annealed tumbler: whole from 40 cm, shards from 50 cm (its 46 cm calibration); one with tempered glass's 4x strength survives a
//            70 cm drop bottom-first, as NITE's did [NITE]; its shards weigh what it did
//   plate    a stoneware plate: whole from 30 cm, sherds from 40 cm (its 35 cm calibration)
//   beam     the load that snaps a beam in the middle of its span vs P = 4·σ·Z/L (spaghetti 36 MPa [PASTA], birch craft sticks 85 MPa [WOOD]) for
//            several strand counts and spans; the sag under it vs P·L³/(48·E·I)
//   glue     a bowling ball rolled into a tower: loose blocks come apart, tape lets go, white glue holds [TAPE] [PVA]
//   chute    an egg-drop box under its parachute falls at the terminal speed √(2·M·g/(ρ·C_d·A)) [CHUTE]
//   moon     on the Moon (g 1.62) an egg's crack height is 9.81/1.62 times Earth's (the same 1.0 m/s)
//   soft     other modules' soft things in series: an egg's landing force on an exercise ball, a foam ball's on an egg and a trampoline's mat
//            vs the module's own laws (fracture.ts 5-8, [SOFT]); an egg survives 50 cm onto an exercise ball (also softened to 0.5 kPa) and
//            1 m onto a trampoline, where the bare table smashes it
//   water    a raw egg sinks in fresh water and floats in 12 % salt water (specific gravity 1.08 [HAMILTON]; 12 % NaCl 1.0857 kg/L, CRC);
//            dropped 30 cm into 20 cm of water it survives (its hit on the tank's floor is slow)
//   jar      an egg-drop box's parachute in a vacuum jar pumped to 0.1 kPa: it falls as fast as with no parachute (ρ ∝ p)
//   edge     a glass dropped 60 cm onto a standing glass breaks both, as onto the table ([EDGE]: half the force of a flat landing)
//   pane     a 3 mm window pane's stiffness and breaking force vs the plate formulas [PLATE]; a baseball at 9 m/s and 4.5 m/s shatters it
//            and goes on through, slowed by the energy the break took; at 2 m/s it bounces off; 6 mm glass takes the 4.5 m/s hit
//   tower    a block that only slides along does not count as fallen; a tower knocked over reads knocked down (less than half its height)
// Run: node --no-warnings research/rw-validate-fracture.ts [egg|padding|glass|plate|beam|glue|chute|moon|soft|water|jar|edge|pane|tower|all]
import path from "node:path"
import { pathToFileURL } from "node:url"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const imp = (p: string) => import(pathToFileURL(path.join(PG, p)).href)
const sim = (await imp("web/sim/index.js")) as { prepare: (s: unknown) => { doc: { solids: { id: string; item: string; body: { kind: string; points?: { x: number; y: number }[]; width?: number; height?: number; depth: number }; material: string }[]; materials: Record<string, { density: number }> } } }
await imp("tools/engine-math-node.mjs")
const { admitDocument } = (await imp("tooling/src/sim/document.ts")) as { admitDocument: (d: unknown) => { scene: unknown } }
const { simulate } = (await imp("tooling/src/sim/physics.ts")) as { simulate: (s: unknown, fps: number) => Track }
await imp("tooling/src/sim/modules/index.ts")
const F = (await imp("tooling/src/sim/fracture.ts")) as typeof import("../tooling/src/sim/fracture.ts")

type Track = { frames: { t: number; placements: Record<string, { x: number; y: number; angle: number; scale?: number }> }[]; state?: Record<string, Record<string, number[]>>; events?: { t: number; text: string }[] }
const which = process.argv[2] ?? "all"
const rows: [string, string, string, string, boolean][] = []
const gate = (group: string, what: string, got: string, want: string, ok: boolean) => {
	rows.push([group, what, got, want, ok])
	console.log(`${ok ? "PASS" : "FAIL"}  [${group}] ${what}: ${got}  (reference ${want})`)
}
const HB = (0.044 / 2) * (2 / Math.sqrt(2 + Math.SQRT2)) // an egg's half height lying on its side (its outline round the curve)
const run = (items: unknown[], extra: Record<string, unknown> = {}) => {
	const s = { version: 2, seconds: 1.6, release: 0.1, stage: { x0: -0.5, x1: 4, y0: -0.1, y1: 3 }, items: [{ id: "table", type: "table", x: 1.5, y: 0, props: { width: 6 } }, ...items], goals: [], ...extra }
	const p = sim.prepare(s)
	return { track: simulate(admitDocument(p.doc).scene, 120), doc: p.doc }
}
const end = (tr: Track, id: string, k: string) => tr.state?.[id]?.[k]?.at(-1) ?? NaN
const pct = (a: number, b: number) => `${(((a - b) / b) * 100).toFixed(1)} %`
/** The least x in [lo, hi] at which test(x) holds (it holds above some point), to `tol`. */
const threshold = (lo: number, hi: number, tol: number, test: (x: number) => boolean) => {
	while (hi - lo > tol) {
		const mid = (lo + hi) / 2
		if (test(mid)) hi = mid
		else lo = mid
	}
	return (lo + hi) / 2
}
const G = 9.81

// ================================================================ egg
if (which === "all" || which === "egg") {
	// crush: a steel weight resting on an egg held still (a carton): the least mass that cracks it (the run's steady load is the weight's)
	const crushKg = threshold(2.0, 6.0, 0.05, (kg) => {
		const { track } = run([{ id: "egg", type: "raw-egg", x: 0.5, y: HB, fixed: true }, { id: "w", type: "steel-weight-1kg", x: 0.5, y: 2 * HB + (0.05 * Math.cbrt(kg)) / 2 + 0.0002, props: { mass: kg } }], { seconds: 0.8 })
		return end(track, "egg", "broken") >= 1
	})
	const crushN = crushKg * G
	gate("egg", "the steady load that cracks an egg (a weight resting on it)", `${crushN.toFixed(1)} N (${crushKg.toFixed(2)} kg)`, "34.9-36.4 N, quasi-static, Mendel University [EGG-F]", crushN > 33 && crushN < 39)
	// impact: the crack speed on a rigid floor (the table: hardwood on a fixed body)
	let speed = NaN
	const crackH = threshold(0.02, 0.12, 0.002, (h) => {
		const { track } = run([{ id: "egg", type: "raw-egg", x: 0.5, y: h + HB, held: true }], { seconds: 0.7 })
		const broke = end(track, "egg", "broken") >= 1
		if (broke) speed = end(track, "egg", "impact_speed")
		return broke
	})
	gate("egg", "the impact speed that cracks an egg on a rigid floor", `${speed.toFixed(2)} m/s (a ${(crackH * 100).toFixed(1)} cm drop)`, "1.0 m/s: partly cracked, nothing spilled [EGG-V]", Math.abs(speed - 1.0) < 0.12)
	const r4 = run([{ id: "egg", type: "raw-egg", x: 0.5, y: 0.82 + HB, held: true }], { seconds: 0.9 })
	gate("egg", "an egg striking at about 4 m/s", `broken ${end(r4.track, "egg", "broken")} at ${end(r4.track, "egg", "impact_speed").toFixed(2)} m/s`, "smashed (broken = 2) [EGG-V]", end(r4.track, "egg", "broken") === 2)
	// its pieces weigh what it did (shells 11 %, insides 89 %: the masses the engine gives them when it lets them go), and a kitchen scale under
	// it reads the same before and after it smashes on it (the measure module's scale: every moving thing resting on its platform)
	const { doc } = run([{ id: "egg", type: "raw-egg", x: 0.5, y: 0.3 }])
	const rec = (doc as unknown as { processes: { kind: string; mass: number; masses: number[] }[] }).processes.find((p) => p.kind === "fracture-brittle")!
	const parts = rec.masses.reduce((a, m) => a + m, 0)
	gate("egg", "the pieces' masses against the whole egg's", `${(parts * 1000).toFixed(2)} g vs ${(rec.mass * 1000).toFixed(2)} g (shells ${(((rec.masses[0]! + rec.masses[1]!) / rec.mass) * 100).toFixed(1)} %)`, "the same (mass is kept when it breaks), shell 9-12 % [EGG-M]", Math.abs(parts - rec.mass) < 2e-6 && Math.abs((rec.masses[0]! + rec.masses[1]!) / rec.mass - 0.11) < 0.002)
	const top = 0.026
	const sc = run([{ id: "sc", type: "kitchen-scale", x: 0.5, y: 0, props: { tare: false } }, { id: "egg", type: "raw-egg", x: 0.5, y: top + 0.3 + HB, held: true }], { seconds: 2.5, release: 0.3 }).track
	const whole = run([{ id: "sc", type: "kitchen-scale", x: 0.5, y: 0, props: { tare: false } }, { id: "egg", type: "raw-egg", x: 0.5, y: top + 0.002 + HB, held: true }], { seconds: 2.5, release: 0.3 }).track
	gate("egg", "a kitchen scale under an egg: whole, and after it smashed on it from 30 cm", `${end(whole, "sc", "grams").toFixed(1)} g, ${end(sc, "sc", "grams").toFixed(1)} g (broken ${end(sc, "egg", "broken")})`, "57 g both times: mass is conserved (MAT4-040)", Math.abs(end(sc, "sc", "grams") - 57) < 0.5 && Math.abs(end(whole, "sc", "grams") - 57) < 0.5 && end(sc, "egg", "broken") === 2)
}

// ================================================================ padding
if (which === "all" || which === "padding") {
	gate("padding", "flexible PU foam at 40 % (the law's own point)", `${(F.stress([1, 4000, 0.4, 0.8], 0.4) / 1000).toFixed(2)} kPa`, "CLD 40 % 2-8 kPa (DIN EN ISO 3386-1) [PU]", Math.abs(F.stress([1, 4000, 0.4, 0.8], 0.4) - 4000) < 1)
	gate("padding", "EPS packing foam at 10 %", `${(F.stress([1, 100000, 0.1, 0.75], 0.1) / 1000).toFixed(1)} kPa`, "100 kPa (EN 13163 CS(10)100) [EPS]", Math.abs(F.stress([1, 100000, 0.1, 0.75], 0.1) - 100000) < 1)
	const boyle = F.stress([2, 0.55 * 101300], 0.5)
	gate("padding", "bubble wrap at half its height", `${(boyle / 1000).toFixed(1)} kPa`, "Boyle: φ·p0·ε/(1−ε) = 55.7 kPa [AIR]", Math.abs(boyle - 55715) < 1)
	// the engine's peak force through padding vs the module's energy balance (the same model: the engine adds the run's own impact speed)
	const cases: [string, number, number][] = [["foam", 0.05, 0.4], ["pillow stuffing", 0.15, 0.8], ["bubble wrap", 0.02, 0.15], ["cotton balls", 0.05, 0.25]]
	const law: Record<string, number[]> = { foam: [1, 4000, 0.4, 0.8], "pillow stuffing": [3, 230], "bubble wrap": [2, 55700], "cotton balls": [3, 150] }
	for (const [mat, t, h] of cases) {
		const { track } = run([{ id: "pad", type: "cushion", x: 0.5, y: 0, props: { material: mat, thickness: t } }, { id: "egg", type: "raw-egg", x: 0.5, y: t + h + HB, held: true }], { seconds: 1.2 })
		const v = end(track, "egg", "impact_speed")
		const want = F.peakForce(0.057, v, 21500, [new F.Padding(law[mat]!, t, { radius: 0.022 })]).force
		const got = end(track, "egg", "peak_force")
		gate("padding", `an egg onto ${t * 100} cm of ${mat} from ${h * 100} cm: peak force`, `${got.toFixed(1)} N at ${v.toFixed(2)} m/s`, `${want.toFixed(1)} N (½mv² = F²/2k + ∫F dx)`, Math.abs(got - want) / want < 0.03)
	}
	// the order: the highest drop each padding lets an egg survive
	const pads: [string, string, number][] = [["the bare table", "", 0], ["packing foam", "packing foam", 0.05], ["carpet", "carpet", 0.01], ["bubble wrap", "bubble wrap", 0.02], ["cotton balls", "cotton balls", 0.05], ["foam", "foam", 0.05], ["a fiberfill pillow", "pillow stuffing", 0.15]]
	const heights: number[] = []
	for (const [label, mat, t] of pads) {
		const h = threshold(0.01, 1.6, 0.01, (hh) => {
			const items: unknown[] = [{ id: "egg", type: "raw-egg", x: 0.5, y: t + hh + HB, held: true }]
			if (mat) items.push({ id: "pad", type: "cushion", x: 0.5, y: 0, props: { material: mat, thickness: t } })
			const { track } = run(items, { seconds: 1.4 })
			return end(track, "egg", "broken") >= 1
		})
		heights.push(h)
		console.log(`      ${label} (${t * 100} cm): an egg survives up to ${(h * 100).toFixed(0)} cm`)
	}
	gate("padding", "the highest safe drop rises with softer, thicker padding", heights.map((h) => `${(h * 100).toFixed(0)}`).join(" ≤ ") + " cm", "table < EPS ≈ 1 cm carpet < bubble wrap < cotton < foam < pillow (each within the 1 cm search)", heights.every((h, i) => i === 0 || h >= heights[i - 1]! - 0.011) && heights.slice(1).every((h) => h > heights[0]! + 0.03) && heights[6]! > 0.85)
}

// ================================================================ glass and plate
if (which === "all" || which === "glass") {
	const { track } = run([0.4, 0.5].map((h, i) => ({ id: `g${i}`, type: "drinking-glass", x: 0.5 + i, y: h, held: true })), { seconds: 1.2 })
	gate("glass", "an annealed tumbler dropped bottom-first onto a hard floor", `40 cm: ${end(track, "g0", "broken")}, 50 cm: ${end(track, "g1", "broken")}`, "whole from 40 cm, shards from 50 cm (46 cm calibration)", end(track, "g0", "broken") === 0 && end(track, "g1", "broken") === 2)
	const t2 = run([{ id: "g", type: "drinking-glass", x: 0.5, y: 0.7, held: true, props: { strength: 1840 * 165 / 41 } }], { seconds: 1.2 }).track
	gate("glass", "a tumbler with tempered glass's strength (×165/41) from 70 cm, bottom-first", `broken ${end(t2, "g", "broken")} (${end(t2, "g", "peak_force").toFixed(0)} N)`, "none broke bottom-first from 70 cm [NITE]; MOR 41 vs 165 MPa [GLASS]", end(t2, "g", "broken") === 0)
	const { doc } = run([{ id: "g", type: "drinking-glass", x: 0.5, y: 0.3 }])
	const rec = (doc as unknown as { processes: { kind: string; mass: number; masses: number[] }[] }).processes.find((p) => p.kind === "fracture-brittle")!
	const shards = rec.masses.reduce((a, m) => a + m, 0)
	gate("glass", "its shards' masses together against the whole glass", `${(shards * 1000).toFixed(2)} g vs ${(rec.mass * 1000).toFixed(2)} g`, "the same", Math.abs(shards - rec.mass) < 1e-5)
}
if (which === "all" || which === "plate") {
	const { track } = run([0.3, 0.4].map((h, i) => ({ id: `p${i}`, type: "ceramic-plate", x: 0.5 + i, y: h, held: true })), { seconds: 1.2 })
	gate("plate", "a stoneware dinner plate dropped flat onto a hard floor", `30 cm: ${end(track, "p0", "broken")}, 40 cm: ${end(track, "p1", "broken")}`, "whole from 30 cm, sherds from 40 cm (35 cm calibration; porcelain 40-110 MPa [PORC])", end(track, "p0", "broken") === 0 && end(track, "p1", "broken") === 2)
}

// ================================================================ beams
if (which === "all" || which === "beam") {
	const SEC: Record<string, { d: number; h: number; sigma: number; E: number; round: boolean }> = {
		spaghetti: { d: 0.00175, h: 0.00175, sigma: 36e6, E: 4.1e9, round: true },
		"craft sticks": { d: 0.01, h: 0.002, sigma: 85e6, E: 11e9, round: false }
	}
	for (const [made, n, span] of [["spaghetti", 1, 0.1], ["spaghetti", 5, 0.2], ["spaghetti", 10, 0.2], ["spaghetti", 5, 0.1], ["craft sticks", 1, 0.1]] as [string, number, number][]) {
		const s = SEC[made]!
		const Z = s.round ? (Math.PI * s.d ** 3) / 32 : (s.d * s.h * s.h) / 6
		const I = s.round ? (Math.PI * s.d ** 4) / 64 : (s.d * s.h ** 3) / 12
		const L = span + 0.02 // (between the middles of its 2 cm rests)
		const want = (4 * s.sigma * Z * n) / L
		const H = 0.1
		const hp = Math.max(s.h, 0.003)
		// a steel ball resting at the middle of the span (one contact point: a point load), its mass raised until the beam snaps
		let shareAt = NaN
		let sagAt = NaN
		let loadAt = NaN
		const P = threshold(want * 0.5, want * 1.6, want * 0.01, (N) => {
			const r = 0.01
			const { track } = run([{ id: "b", type: "snap-bridge", x: 0.5, y: 0, props: { made_of: made, strands: n, span } }, { id: "w", type: "steel-ball", x: 0.5, y: H + hp + r, props: { diameter: 2 * r, mass: N / G } }], { seconds: 0.6 })
			if (end(track, "b", "broken") < 1) {
				shareAt = end(track, "b", "share")
				sagAt = end(track, "b", "sag")
				loadAt = N
			}
			return end(track, "b", "broken") >= 1
		})
		gate("beam", `${n} ${made} over a ${span * 100} cm gap: the centre load that snaps it`, `${P.toFixed(3)} N (${((P / G) * 1000).toFixed(0)} g)`, `4σZ/L = ${want.toFixed(3)} N (σ ${s.sigma / 1e6} MPa ${made === "spaghetti" ? "[PASTA]" : "[WOOD]"}) ±6 %`, Math.abs(P - want) / want < 0.06)
		// the sag the run reports under the heaviest load it held (the ball's weight and the beam's own, at the middle)
		const theory = (loadAt * L ** 3) / (48 * s.E * I * n)
		gate("beam", `  its sag under the heaviest load it held (${loadAt.toFixed(3)} N, share ${shareAt.toFixed(2)})`, `${(sagAt * 1000).toFixed(2)} mm`, `P·L³/48EI = ${(theory * 1000).toFixed(2)} mm (+ its own weight) ±8 %`, Math.abs(sagAt - theory) / theory < 0.08)
	}
}

// ================================================================ glue
if (which === "all" || which === "glue") {
	const items: unknown[] = []
	for (const [i, glue] of ["none", "tape", "glue stick", "white glue"].entries()) {
		items.push({ id: `t${i}`, type: "block-tower", x: 0.6 + i * 1.2, y: 0, props: { glue } })
		items.push({ id: `r${i}`, type: "plank", x: 0.0 + i * 1.2, y: 0.25, angle: -30, props: { length: 0.8 } })
		items.push({ id: `b${i}`, type: "bowling-ball", x: 0.2 + i * 1.2, y: 0.42, held: true })
	}
	const { track } = run(items, { seconds: 2.5 })
	const res = [0, 1, 2, 3].map((i) => end(track, `t${i}`, "broken"))
	gate("glue", "a bowling ball rolled into 6-block towers: loose, tape, glue stick, white glue", res.join(", "), "loose and taped come apart (tape 2.7 N/cm [TAPE]); white glue holds (3 MPa [PVA])", res[0] === 1 && res[1] === 1 && res[3] === 0)
}

// ================================================================ parachute
if (which === "all" || which === "chute") {
	const { track, doc } = run([{ id: "box", type: "egg-drop-box", x: 0.5, y: 2.5, held: true, props: { parachute: 0.8, padding: "foam", padding_thickness: 0.04 } }], { seconds: 3.2 })
	const ys = track.frames.map((f) => [f.t, f.placements["box/box"]!.y] as const)
	const k1 = ys.findIndex(([t]) => t >= 1.2)
	const k0 = ys.findIndex(([t]) => t >= 1.0)
	const v = (ys[k0]![1] - ys[k1]![1]) / (ys[k1]![0] - ys[k0]![0])
	const box = doc.solids.filter((s) => s.item === "box")
	const M = box.reduce((a, s) => a + (s.body.kind === "slab" ? s.body.width! * s.body.height! : Math.abs((s.body.points ?? []).reduce((q, p, i, pts) => q + p.x * pts[(i + 1) % pts.length]!.y - pts[(i + 1) % pts.length]!.x * p.y, 0)) / 2) * s.body.depth * doc.materials[s.material]!.density, 0)
	const A = (Math.PI * 0.8 * 0.8) / 4
	const vt = Math.sqrt((2 * M * G) / (1.204 * 0.8 * A))
	gate("chute", "an egg-drop box under a 80 cm parachute: its fall speed after 1 s", `${v.toFixed(2)} m/s (box ${(M * 1000).toFixed(0)} g)`, `terminal √(2Mg/ρC_dA) = ${vt.toFixed(2)} m/s (C_d 0.8 [CHUTE]; the box's own drag slows it a little more)`, v < vt * 1.02 && v > vt * 0.85)
}

// ================================================================ the Moon
if (which === "all" || which === "moon") {
	const h = threshold(0.1, 0.6, 0.004, (hh) => end(run([{ id: "egg", type: "raw-egg", x: 0.5, y: hh + HB, held: true }], { seconds: 1.6, settings: { gravity: "moon", air: false } }).track, "egg", "broken") >= 1)
	gate("moon", "an egg's crack height on the Moon (no air)", `${(h * 100).toFixed(1)} cm`, `the same 1.0 m/s: ${((1.0 * 1.0) / (2 * 1.62) * 100).toFixed(1)} cm (v²/2g, g 1.62 m/s²)`, Math.abs(h - 1 / (2 * 1.62)) / (1 / (2 * 1.62)) < 0.12)
}

// ================================================================ other modules' soft things
if (which === "all" || which === "soft") {
	// an egg 50 cm onto an exercise ball resting on the table (65 cm, 4 kPa): its landing force (the first hit) against the law's own
	const first = (tr: Track, id: string, before: number) => {
		const k = tr.frames.findIndex((f) => f.t >= before)
		return tr.state?.[id]?.peak_force?.[k] ?? NaN
	}
	const ex = run([{ id: "ball", type: "exercise-ball", x: 0.5, y: 0.325 }, { id: "egg", type: "raw-egg", x: 0.5, y: 0.65 + 0.5 + HB, held: true }], { seconds: 1.4 })
	const v = end(ex.track, "egg", "impact_speed")
	const exLaw = [5, 4000, 0.325, 0, 0.1625]
	const want = F.peakForce(0.057, v, 21500, [new F.Padding(exLaw, 0, { radius: 0.022 })]).force
	const got = end(ex.track, "egg", "peak_force")
	gate("soft", "an egg 50 cm onto an exercise ball (65 cm, 4 kPa): its landing force", `${got.toFixed(1)} N at ${v.toFixed(2)} m/s, broken ${end(ex.track, "egg", "broken")}`, `${want.toFixed(1)} N (gas Δp·π(2R_eff·x − x²) [CROSS] + the skin's pull 2πTx/ln(R/a), T = Δp·R/2), whole (it cracks at 35 N)`, Math.abs(got - want) / want < 0.03 && end(ex.track, "egg", "broken") === 0)
	const soft = run([{ id: "ball", type: "exercise-ball", x: 0.5, y: 0.325, props: { pressure: 0.5 } }, { id: "egg", type: "raw-egg", x: 0.5, y: 0.65 + 0.5 + HB, held: true }], { seconds: 1.4 })
	gate("soft", "  the same ball softened to 0.5 kPa (FR3)", `${end(soft.track, "egg", "peak_force").toFixed(1)} N, broken ${end(soft.track, "egg", "broken")}`, "softer: less force, whole", end(soft.track, "egg", "broken") === 0 && end(soft.track, "egg", "peak_force") < got)
	const bare = run([{ id: "egg", type: "raw-egg", x: 0.5, y: 0.5 + HB, held: true }], { seconds: 1.4 })
	gate("soft", "  the same drop onto the bare table", `${end(bare.track, "egg", "peak_force").toFixed(0)} N, broken ${end(bare.track, "egg", "broken")}`, "smashed (v·√(k·m) ≈ 108 N)", end(bare.track, "egg", "broken") === 2)
	// a 22 g foam ball (E 100 kPa) dropped 55 cm onto an egg held in a carton: Hertz with the two surfaces' R_eff
	const fb = run([{ id: "egg", type: "raw-egg", x: 0.5, y: HB, fixed: true }, { id: "fb", type: "foam-ball", x: 0.5, y: 2 * HB + 0.55 + 0.035, held: true }], { seconds: 1.4 })
	const vf = end(fb.track, "egg", "impact_speed")
	const wantF = F.peakForce(0.022, vf, 21500, [new F.Padding([6, 100000 / (1 - 0.09), 0.035, 0.021], 0, { radius: 0.022 })]).force
	gate("soft", "a foam ball (7 cm, 22 g, E 100 kPa) dropped 55 cm onto an egg", `${end(fb.track, "egg", "peak_force").toFixed(1)} N at ${vf.toFixed(2)} m/s, broken ${end(fb.track, "egg", "broken")}`, `Hertz (4/3)E*√R_eff·x^1.5 [Johnson §4.2]: ${wantF.toFixed(1)} N, whole`, Math.abs(end(fb.track, "egg", "peak_force") - wantF) / wantF < 0.03 && end(fb.track, "egg", "broken") === 0)
	// a trampoline (80 cm mat, 300 N/m) from 1 m: the mat's springs in series, the egg's own mass
	const tr = run([{ id: "tr", type: "trampoline", x: 0.8, y: 0 }, { id: "egg", type: "raw-egg", x: 0.8, y: 0.35 + 1.0 + HB, held: true }], { seconds: 1.8 })
	const vt = end(tr.track, "egg", "impact_speed")
	const wantT = vt * Math.sqrt(((21500 * 300) / (21500 + 300)) * 0.057)
	gate("soft", "an egg dropped 1 m onto a trampoline (300 N/m)", `${end(tr.track, "egg", "peak_force").toFixed(1)} N at ${vt.toFixed(2)} m/s, broken ${end(tr.track, "egg", "broken")}`, `v·√(k_series·m) = ${wantT.toFixed(1)} N, whole`, Math.abs(end(tr.track, "egg", "peak_force") - wantT) / wantT < 0.03 && end(tr.track, "egg", "broken") === 0)
	void first
}

// ================================================================ water
if (which === "all" || which === "water") {
	const res: string[] = []
	let good = true
	for (const [liq, salt, want] of [["water", 0, "sinks"], ["salt water", 12, "floats"]] as const) {
		const { track } = run([{ id: "tank", type: "water-tank", x: 0.6, y: 0, props: { liquid: liq, salt_pct: salt } }, { id: "egg", type: "raw-egg", x: 0.6, y: 0.18 }], { seconds: 3 })
		const sunk = end(track, "egg", "sunk")
		const afloat = end(track, "egg", "afloat")
		const buoy = end(track, "egg", "buoyancy_n")
		res.push(`${liq} ${salt} %: sunk ${sunk}, afloat ${afloat} (buoyancy ${buoy.toFixed(3)} N)`)
		good &&= want === "sinks" ? sunk === 1 && afloat === 0 : afloat === 1
	}
	gate("water", "a raw egg (57 g) in a tank of fresh water, and of 12 % salt water", res.join("; "), "sinks in fresh water (1.08 kg/L > 0.998), floats in 12 % salt water (1.0857 kg/L) [HAMILTON]", good)
	const { track } = run([{ id: "tank", type: "water-tank", x: 0.6, y: 0 }, { id: "egg", type: "raw-egg", x: 0.6, y: 0.3 + 0.3, held: true }, { id: "egg2", type: "raw-egg", x: 1.8, y: 0.3 + HB, held: true }], { seconds: 2 })
	gate("water", "an egg dropped 30 cm into 20 cm of water, and one onto the table", `water: broken ${end(track, "egg", "broken")} (hit the floor at ${end(track, "egg", "impact_speed").toFixed(2)} m/s); table: broken ${end(track, "egg2", "broken")}`, "the water slows it: whole; the table smashes it", end(track, "egg", "broken") === 0 && end(track, "egg2", "broken") === 2)
}

// ================================================================ parachute in a vacuum jar
if (which === "all" || which === "jar") {
	const jar = { height: 0.8, width: 0.4, pump_at: 0, pump_s: 0.2, lowest_kpa: 0.1 }
	const one = (inJar: boolean, chute: number) => {
		const items: unknown[] = [{ id: "box", type: "egg-drop-box", x: 0.6, y: 0.65, held: true, props: { parachute: chute, size: 0.1 } }]
		if (inJar) items.push({ id: "jar", type: "vacuum-jar", x: 0.6, y: 0, props: jar })
		else items.push({ id: "plate", type: "concrete-slab", x: 0.6, y: 0, props: {} })
		return end(run(items, { seconds: 2.5, release: 1.5 }).track, "box", "impact_speed")
	}
	const inJar = one(true, 0.3)
	const bareJar = one(true, 0)
	gate("jar", "an egg-drop box with a 30 cm parachute in a jar pumped to 0.1 kPa, against none", `${inJar.toFixed(3)} vs ${bareJar.toFixed(3)} m/s`, "the same: no air, no drag (ρ ∝ p: 0.1 % of the room's)", Math.abs(inJar - bareJar) / bareJar < 0.01)
}

// ================================================================ hard on hard
if (which === "all" || which === "edge") {
	const { track } = run([{ id: "g1", type: "drinking-glass", x: 0.5, y: 0 }, { id: "g2", type: "drinking-glass", x: 0.5, y: 0.1 + 0.6, held: true }, { id: "g3", type: "drinking-glass", x: 1.5, y: 0.6, held: true }, { id: "g4", type: "drinking-glass", x: 2.5, y: 0.1 + 0.2, held: true }, { id: "g5", type: "drinking-glass", x: 2.5, y: 0 }], { seconds: 1.4 })
	gate("edge", "a glass dropped 60 cm onto a standing glass; onto the table; 20 cm onto a glass", `on glass: ${end(track, "g2", "broken")} and ${end(track, "g1", "broken")} (${end(track, "g1", "peak_force").toFixed(0)} N); table: ${end(track, "g3", "broken")}; 20 cm: ${end(track, "g4", "broken")} (${end(track, "g4", "peak_force").toFixed(0)} N)`, "both shatter from 60 cm (rim on rim breaks at 0.5 × 1840 N [EDGE]), as onto the table; from 20 cm the series springs keep them under 920 N", end(track, "g1", "broken") === 2 && end(track, "g2", "broken") === 2 && end(track, "g3", "broken") === 2 && end(track, "g4", "broken") === 0)
}

// ================================================================ window pane
if (which === "all" || which === "pane") {
	const a = 0.3
	const t = 0.003
	const D = (72e9 * t ** 3) / (12 * (1 - 0.22 ** 2))
	const kWant = (16 * Math.PI * D * 1.22) / (3.22 * a * a)
	const pWant = (2 * Math.PI * t * t * 82e6) / (3 * (1.22 * Math.log(a / 0.005) + 1))
	const { doc } = run([{ id: "pane", type: "window-pane", x: 1, y: 0 }])
	const rec = (doc as unknown as { processes: { kind: string; k: number; limit: number }[] }).processes.find((p) => p.kind === "fracture-brittle")!
	gate("pane", "a 60 cm square, 3 mm pane: stiffness and breaking force at its middle", `${(rec.k / 1000).toFixed(2)} kN/m, ${rec.limit.toFixed(1)} N`, `16πD(1+ν)/((3+ν)a²) = ${(kWant / 1000).toFixed(2)} kN/m; 2πt²σ/(3[(1+ν)ln(a/r0)+1]) = ${pWant.toFixed(1)} N [PLATE]`, Math.abs(rec.k - kWant) / kWant < 0.001 && Math.abs(rec.limit - pWant) < 0.1)
	// (each pane on its own, the ball 15 cm from it, so it flies nearly level)
	const hit = (v: number, thick: number) => {
		const tr = run([{ id: "pane", type: "window-pane", x: 0.85, y: 0, props: { thickness: thick } }, { id: "ball", type: "baseball", x: 0.85 - 0.0015 * (thick / 0.003) - 0.0373 - 0.15, y: 0.35, held: true, props: { start_speed: v, start_dir: 0 } }], { seconds: 0.6, release: 0.05 }).track
		return { b: end(tr, "pane", "broken"), f: end(tr, "pane", "peak_force"), v: end(tr, "pane", "impact_speed") }
	}
	const cases = [hit(9, 0.003), hit(2, 0.003), hit(4.5, 0.003), hit(4.5, 0.006)]
	const say = (c: { b: number; f: number; v: number }) => `${c.b} (${c.f.toFixed(0)} N at ${c.v.toFixed(2)} m/s)`
	gate("pane", "a 145 g baseball at a 3 mm pane: 9, 2, 4.5 m/s; at a 6 mm pane: 4.5 m/s", cases.map(say).join(", "), "shatters (a baseball breaks a window), bounces off (a toss), shatters (over about 3.6 m/s); 6 mm holds it (P ∝ t², k ∝ t³: its threshold ∝ √t, about 5 m/s)", cases[0]!.b === 2 && cases[1]!.b === 0 && cases[2]!.b === 2 && cases[3]!.b === 0)
	// the ball goes on through the pane it shatters, slowed by what breaking it took: ½·m·v'² = ½·m·v² − P²/(2k)
	{
		const tr = run([{ id: "pane", type: "window-pane", x: 0.85, y: 0 }, { id: "ball", type: "baseball", x: 0.85 - 0.0015 - 0.0373 - 0.15, y: 0.35, held: true, props: { start_speed: 9, start_dir: 0 } }], { seconds: 0.4, release: 0.05 }).track
		const t0 = (tr.events ?? []).find((e) => /shatters/.test(e.text))?.t ?? NaN
		const k0 = tr.frames.findIndex((f) => f.t >= t0 + 0.02)
		const a = tr.frames[k0]!.placements["ball/ball"]!
		const b = tr.frames[k0 + 3]!.placements["ball/ball"]!
		const vx = (b.x - a.x) / (tr.frames[k0 + 3]!.t - tr.frames[k0]!.t)
		const vin = end(tr, "pane", "impact_speed")
		const want = Math.sqrt(vin * vin - (2 * (rec.limit * rec.limit) / (2 * rec.k)) / 0.145)
		gate("pane", "  the baseball after it shatters the 3 mm pane at 9 m/s", `${vx.toFixed(2)} m/s on (x ${b.x.toFixed(2)} m, past the pane at 0.85 m)`, `through, not bounced back: √(v² − P²/(k·m)) = ${want.toFixed(2)} m/s (the pane took ${((rec.limit * rec.limit) / (2 * rec.k)).toFixed(2)} J)`, Math.abs(vx - want) / want < 0.03 && b.x > 0.85)
	}
	const k = rec.k
	gate("pane", "  the force of each hit against v·√(k·m)", cases.map((c, i) => `${c.f.toFixed(0)} vs ${(c.v * Math.sqrt((i === 3 ? 8 : 1) * k * 0.145)).toFixed(0)} N`).join(", "), "the striker's mass against the pane's stiffness (the pane fixed in its frame)", cases.every((c, i) => Math.abs(c.f - c.v * Math.sqrt((i === 3 ? 8 : 1) * k * 0.145)) / c.f < 0.03))
}

// ================================================================ towers
if (which === "all" || which === "tower") {
	// a bowling ball knocks a loose tower down; a tennis ball tossed gently at a 2-block tower's top block slides it along: still standing
	const knock = run([{ id: "t", type: "block-tower", x: 0.9, y: 0 }, { id: "ball", type: "bowling-ball", x: 0.3, y: 0.11, props: { start_speed: 3, start_dir: 0 } }], { seconds: 2.5 }).track
	const h0 = knock.state?.t?.top_height?.[0] ?? NaN
	gate("tower", "a bowling ball at 3 m/s into a loose 6-block tower", `fallen ${end(knock, "t", "blocks_fallen")} of 6, top ${(end(knock, "t", "top_height") * 100).toFixed(1)} of ${(h0 * 100).toFixed(1)} cm`, "knocked down: half its blocks or more fell (or less than half its height left)", (end(knock, "t", "top_height") < 0.5 * h0 || end(knock, "t", "blocks_fallen") >= 3) && end(knock, "t", "broken") === 1)
	const nudge = run([{ id: "t2", type: "block-tower", x: 2.4, y: 0, props: { blocks: 2 } }, { id: "tb", type: "tennis-ball", x: 2.4 - 0.05 - 0.034 - 0.004, y: 0.077, held: true, props: { start_speed: 1.0, start_dir: 0 } }], { seconds: 1.5 }).track
	const k2 = nudge.frames.length - 1
	const moved = (nudge.frames[k2]!.placements["t2/block2"]!.x - nudge.frames[0]!.placements["t2/block2"]!.x) * 100
	gate("tower", "  a tennis ball tossed at 1 m/s at a 2-block tower's top block", `it slid ${moved.toFixed(1)} cm; fallen ${end(nudge, "t2", "blocks_fallen")}, broken ${end(nudge, "t2", "broken")}, top ${(end(nudge, "t2", "top_height") * 100).toFixed(1)} cm`, "slid along but still stacked: nothing fell, not come apart", moved > 0.3 && end(nudge, "t2", "blocks_fallen") === 0 && end(nudge, "t2", "broken") === 0)
}

const failed = rows.filter((r) => !r[4]).length
console.log(`\n${rows.length - failed} of ${rows.length} gates pass${failed ? ` — ${failed} FAILED` : ""}`)
process.exit(failed ? 1 : 0)
