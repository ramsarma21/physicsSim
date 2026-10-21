// Softbody module validation (tooling/src/sim/softbody.ts, engine4 second wave, October 2026): bending beams against Euler-Bernoulli, clay's
// dents against the flow-pressure energy law, inflated and foam balls' contacts against their contact laws, the coil spring against Hooke,
// the rubber-band launcher's and car's energy against their stored energy. Every scene is built through the catalog (web/sim, the exact port
// of machines/mod_softbody.py: the same documents) and run on the engine at 480 Hz with every step kept. Each check prints the engine's
// number, the reference (with its source), the tolerance, and PASS or FAIL; the run exits 1 on any FAIL.
//   node --no-warnings research/rw-validate-softbody.ts [beam|bridge|clay|ball|foam|spring|band|car|all]
// References:
//   [EB]   Euler-Bernoulli beam (Timoshenko & Gere, Mechanics of Materials): a cantilever's deflection at its tip under a load F at a from the
//          clamp, F·a²·(3L − a)/(6EI), under its own weight q·L⁴/(8EI); a beam on two supports, a centre load F·L³/(48EI), its weight
//          5·q·L⁴/(384EI); first modes 1.8751²·√(EI/(ρA·L⁴)) (cantilever).
//   [TABOR] a fully plastic dent's mean pressure 3 × the flow stress (Tabor 1951; physics.ts DENT_PRESSURE): a sphere flattened δ carries
//          p·π·(2Rδ − δ²) and has taken the work p·π·(R·δ² − δ³/3); [SOFUOGLU] plasticine's flow stress 0.08-0.175 MPa (0.12 used).
//   [CROSS] an inflated ball's contact force is its over-pressure × the flat's area, k ≈ 2π·R·Δp for a small squash; the gas compressed
//          adiabatically by the flattened cap (γ 1.4, from 101 325 Pa + the gauge): the squash and the contact time integrated here from that
//          law on its own (RK4); it leaves at e(p) of its landing speed ([BOUNCE] in machines/mod_softbody.py): its first bounce e² of the drop.
//   [HERTZ] a sphere on a rigid flat, F = (4/3)E*√R·δ^1.5: contact time 2.87·(m²/(R·E*²·v))^(1/5) (Johnson, Contact Mechanics, §11.4).
//   [HOOKE] a coil spring squashed x = F/k, a mass on it swings with period 2π√(m/k); its readings zeroed with its platform on it, so the
//          reading is m·g/k for a load m: twice the load, twice the reading.
//   [TRELOAR] a rubber strand's force A0·(E/3)·(λ − 1/λ²) (neo-Hookean, E = 3G, G ≈ 0.5 MPa for natural rubber).
import { pathToFileURL } from "node:url"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
await import(pathToFileURL(`${PG}/tools/engine-math-node.mjs`).href)
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (doc: unknown) => { scene: unknown } }
type P = { x: number; y: number; angle: number }
type Track = { frames: { t: number; placements: Record<string, P> }[]; state?: Record<string, Record<string, number[]>>; events?: { t: number; text: string; kind?: string; items: string[] }[] }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (scene: unknown, fps: number) => Track }
const sim = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as { prepare: (s: unknown) => { doc: { solids: { id: string; body: { radius?: number; width?: number }; at: { x: number; y: number } }[]; processes?: Record<string, unknown>[]; materials: Record<string, { density: number }> }; resolved: Record<string, Record<string, number>> } }
const SB = (await import(pathToFileURL(`${PG}/web/sim/modules/softbody.js`).href)) as { BALLS: Record<string, unknown[]>; bounce_e: (fit: unknown, kpa: number) => number; AXLE_R: number; BAND_SNAP: number }
/** console.warn's over-speed lines of a run (the engine says so when a part was moving faster than 250 m/s). */
const warned: string[] = []
const quietWarn = console.warn
console.warn = (...a: unknown[]) => {
	warned.push(a.map(String).join(" "))
	if (process.env.WARN) quietWarn(...a)
}

const G = 9.81
const STEP = 1 / 480
const only = process.argv[2] ?? "all"
let failed = 0
let checks = 0
const check = (name: string, got: number, want: number, tol: number, what: string, rel = true) => {
	checks++
	const err = rel ? Math.abs(got - want) / Math.abs(want) : Math.abs(got - want)
	const ok = Number.isFinite(got) && err <= tol
	if (!ok) failed++
	console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} engine ${fmt(got)}  reference ${fmt(want)}  (${rel ? `${(err * 100).toFixed(2)} %` : fmt(err)} ≤ ${rel ? `${(tol * 100).toFixed(1)} %` : fmt(tol)})  ${what}`)
}
const fmt = (v: number) => (Math.abs(v) >= 100 || (Math.abs(v) < 0.01 && v !== 0) ? v.toPrecision(4) : v.toFixed(4))
const scene = (items: unknown[], seconds = 3, release = 0.1) => ({
	version: 2, id: "v", name: "v", seconds, release, stage: { x0: -1, x1: 4, y0: -0.2, y1: 3 }, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals: []
})
const run = (sc: unknown, fps = 480) => {
	const { doc, resolved } = sim.prepare(sc)
	const track = simulate(admitDocument(doc).scene, fps)
	return { doc, resolved, track }
}
const last = (v: number[] | undefined) => (v === undefined ? Number.NaN : (v[v.length - 1] as number))
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
/**
 * The settled value of a reading that still rings (a metal ruler loaded at the release swings for seconds: aluminium's damping ratio is a few
 * thousandths): its mean over whole swings in the last `win` frames (from the first to the last time it rises through the window's mean), so a
 * part-swing left over never biases it; the plain mean when it no longer swings.
 */
const settledMean = (v: number[], win: number) => {
	const w = v.slice(-win)
	const m0 = mean(w)
	const up: number[] = []
	for (let i = 1; i < w.length; i++) if (w[i - 1] < m0 && w[i] >= m0) up.push(i)
	return up.length < 2 ? m0 : mean(w.slice(up[0], up[up.length - 1]))
}
const beamEI = (E: number, b: number, t: number) => (E * b * t * t * t) / 12
/** The measure module's slotted mass of this many kg (gram-mass: 1 g to 1 kg; its anchor is the middle of its base). */
const grams = (kg: number) => (kg >= 1 ? "1 kg" : `${Math.round(kg * 1000)} g`)

// ------------------------------------------------------------------------------------------------------------------------------ beams
if (only === "all" || only === "beam") {
	console.log("\n# A clamped ruler: the bend of its end against Euler-Bernoulli [EB]")
	// the load, a slotted brass mass, is set on the last segment's middle (L − ℓ/2) and let go at the release: loaded at once, the ruler rings
	// with a swing about its whole bend, so at the top of each swing the mass hardly presses on it and slides a little down its slope: a
	// 100 g mass creeps 4-5 mm toward the end (a 20 g one 0.2 mm), as a weight dropped on a springy ruler does. Its weight acts on the line
	// through its centre, so the reference puts the load at its centre's mean place over the last 1.2 s (the creep is printed); the ruler's
	// own weight adds q·L⁴/8EI. The end's bend is read once the beam has settled: its mean over whole swings in the last 1.2 s (settledMean).
	const cases: [string, number, number, number, number, number][] = [
		// material, E, density, thickness, overhang, load kg
		["acrylic", 3.2e9, 1190, 0.003, 0.2, 0.05],
		["acrylic", 3.2e9, 1190, 0.003, 0.2, 0.1],
		["acrylic", 3.2e9, 1190, 0.003, 0.1, 0.02],
		["acrylic", 3.2e9, 1190, 0.003, 0.2, 0.02],
		["varnished hardwood", 12e9, 700, 0.0035, 0.25, 0.2],
		["aluminium", 69e9, 2700, 0.0015, 0.2, 0.1],
		["steel", 200e9, 7850, 0.0005, 0.15, 0.02]
	]
	const bends: Record<string, number> = {}
	const refs: Record<string, number> = {}
	for (const [mat, E, rho, t, ov, load] of cases) {
		const b = 0.03
		const sc = scene([{ id: "r", type: "flex-ruler", x: 0.5, y: 0, props: { material: mat, overhang: ov } }], 2.5)
		const { doc } = sim.prepare(sc)
		const segs = doc.solids.filter((s) => s.id.startsWith("r/seg"))
		const lastSeg = segs[segs.length - 1] as (typeof segs)[number]
		const seg = lastSeg.body.width as number
		const N = segs.length
		// the load: a slotted brass mass (the measure module's gram-mass) on the last segment's middle
		const top = lastSeg.at.y + Math.max(t, 0.002) / 2
		;(sc.items as unknown[]).push({ id: "w", type: "gram-mass", x: lastSeg.at.x, y: top + 0.0002, props: { grams: grams(load) } })
		const r = run(sc, 120)
		const v = r.track.state?.r?.bend_mm ?? []
		const settled = settledMean(v, 144) / 1000
		const EI = beamEI(E, b, t)
		// where its weight acts at the end: its centre's mean place over the last 1.2 s, from the bend's root (the ruler's anchor, x 0.5)
		const wx = r.track.frames.map((f) => f.placements["w/mass"]?.x ?? Number.NaN)
		const a = Math.min(ov, mean(wx.slice(-144)) - 0.5)
		console.log(`      the load was set ${((ov - seg / 2) * 100).toFixed(2)} cm out and ended ${(a * 100).toFixed(2)} cm out (crept ${((a - (ov - seg / 2)) * 1000).toFixed(1)} mm toward the end)`)
		const F = load * G
		const q = rho * b * t * G
		// the load's weight spread evenly over its foot (as wide as the brass mass) around a, each bit bending the tip x²(3L − x)/6EI
		const foot = { "20 g": 0.015, "50 g": 0.0203, "100 g": 0.0256, "200 g": 0.0323 }[grams(load)] ?? 0.02
		let spread = 0
		for (let i = 0; i < 200; i++) {
			const x = Math.min(ov, a - foot / 2 + ((i + 0.5) / 200) * foot)
			spread += (x * x * (3 * ov - x)) / (6 * EI) / 200
		}
		const ref = F * spread + (q * ov * ov * ov * ov) / (8 * EI)
		check(`${mat} ${t * 1000} mm, ${ov * 100} cm out, ${load * 1000} g (N ${N})`, settled, ref, 0.03, "[EB] the load over its foot ∫x²(3L − x)/6EI + qL⁴/8EI")
		bends[`${mat}|${ov}|${load}`] = settled
		refs[`${mat}|${ov}|${load}`] = ref
	}
	const lin = (bends["acrylic|0.2|0.1"] as number) / (bends["acrylic|0.2|0.05"] as number)
	// (twice the load: twice the load's share, at where each load ended; the ruler's own weight's share stays: about 1.9)
	const linRef = (refs["acrylic|0.2|0.1"] as number) / (refs["acrylic|0.2|0.05"] as number)
	check("twice the load, about twice the bend", lin, linRef, 0.05, "linear in the load (the beam's own weight's share aside)")
	// twice as far out, the same 20 g on its end: (a²(3L − a)) grows 7.4 times (the load's foot is 1.5 cm), its own weight's share 16 times
	const longer = (bends["acrylic|0.2|0.02"] as number) / (bends["acrylic|0.1|0.02"] as number)
	const EIa = beamEI(3.2e9, 0.03, 0.003)
	const tipAt = (L: number, seg: number, F: number) => (F * (L - seg / 2) * (L - seg / 2) * (3 * L - (L - seg / 2))) / (6 * EIa) + (1190 * 0.03 * 0.003 * G * L * L * L * L) / (8 * EIa)
	check("twice as far out: about 8 times the bend", longer, tipAt(0.2, 0.025, 0.02 * G) / tipAt(0.1, 0.1 / 6, 0.02 * G), 0.05, "∝ L³ (Euler-Bernoulli)")
}

if (only === "all" || only === "bridge") {
	console.log("\n# A plank across two supports: the sag in the middle [EB]")
	// two fixed posts 2 cm wide whose inner edges are `span` apart; a load in the middle
	for (const [mat, E, rho, t, span, load] of [["pine", 8.9e9, 500, 0.006, 0.5, 0.5], ["card", 3.5e9, 700, 0.0015, 0.25, 0.02], ["aluminium", 69e9, 2700, 0.002, 0.6, 1.0]] as [string, number, number, number, number, number][]) {
		const b = 0.1
		const c = 0.03
		const L = span + 2 * c
		// two fixed steel balls (2 cm) under it, `span` apart: point supports, the span exact
		const rb = 0.01
		const items = [
			{ id: "p1", type: "steel-ball", x: 1.0 - span / 2, y: 0.1, fixed: true, props: { diameter: 2 * rb } },
			{ id: "p2", type: "steel-ball", x: 1.0 + span / 2, y: 0.1, fixed: true, props: { diameter: 2 * rb } },
			{ id: "pl", type: "flex-plank", x: 1.0, y: 0.1 + rb + 0.0003, props: { material: mat, length: L, thickness_mm: t * 1000, width: b } },
			{ id: "w", type: "gram-mass", x: 1.0, y: 0.1 + rb + Math.max(t, 0.002) + 0.0006, props: { grams: grams(load) } }
		]
		const r = run(scene(items, 2.5), 120)
		const v = r.track.state?.pl?.bend_mm ?? []
		const sag = mean(v.slice(-36)) / 1000
		// the reading is the sag below the line through the plank's ENDS: its middle's drop between the supports, plus the overhangs' lift as the
		// plank turns over the supports (c × the slope there); its weight on the span and its slope (5qL⁴/384EI, c·qL³/24EI)
		const EI = beamEI(E, b, t)
		const q = rho * b * t * G
		const F = load * G
		const ref = (F * span * span * span) / (48 * EI) + (5 * q * span * span * span * span) / (384 * EI) + c * ((F * span * span) / (16 * EI) + (q * span * span * span) / (24 * EI))
		check(`${mat} ${t * 1000} mm over ${span * 100} cm, ${load * 1000} g`, sag, ref, 0.08, "[EB] F·L³/48EI + 5qL⁴/384EI + c·(FL²/16EI + qL³/24EI)")
	}
	console.log("\n# A springboard's own sag and its first mode [EB]")
	{
		const r = run(scene([{ id: "sb", type: "springboard", x: 0.3, y: 0, props: {} }], 4), 480)
		const v = r.track.state?.sb?.bend_mm ?? []
		const EI = beamEI(8.9e9, 0.25, 0.018)
		const q = 500 * 0.25 * 0.018 * G
		check("pine board 1 m × 25 cm × 18 mm, own weight", mean(v.slice(-240)) / 1000, (q * 1) / (8 * EI), 0.03, "[EB] qL⁴/8EI")
		// its swing about that sag after the release: the time between down-crossings of the mean
		const m = mean(v.slice(-240))
		const cross: number[] = []
		for (let k = 1; k < v.length; k++) if ((v[k - 1] as number) < m && (v[k] as number) >= m) cross.push(k * STEP)
		const period = cross.length >= 3 ? ((cross[cross.length - 1] as number) - (cross[0] as number)) / (cross.length - 1) : Number.NaN
		const f1 = ((1.8751 * 1.8751) / (2 * Math.PI)) * Math.sqrt(EI / (500 * 0.25 * 0.018))
		check("its first mode's frequency", 1 / period, f1, 0.05, `[EB] 1.8751²/(2π)·√(EI/ρA)·1/L² = ${f1.toFixed(2)} Hz`)
	}
	console.log("\n# A ruler bent too far: wood snaps, steel keeps a permanent bend")
	{
		const r = run(scene([{ id: "r", type: "flex-ruler", x: 0.5, y: 0.2, props: { material: "varnished hardwood", overhang: 0.25 } }, { id: "w", type: "steel-weight-5kg", x: 0.72, y: 0.6, props: {} }], 2.5), 120)
		const snapped = (r.track.events ?? []).some((e) => e.kind === "snap")
		check("a 5 kg weight dropped on a wooden ruler's end snaps it", snapped ? 1 : 0, 1, 0, "M = F·a > MOR·b·t²/6 (100 MPa: 6.1 N·m)", false)
		const s = run(scene([{ id: "r", type: "flex-ruler", x: 0.5, y: 0.2, props: { material: "aluminium", overhang: 0.2 } }, { id: "w", type: "steel-weight-5kg", x: 0.68, y: 0.35, props: {} }], 2.5), 120)
		const set = Math.max(...(s.track.state?.r?.set_deg ?? [0]))
		console.log(`      (aluminium ruler 1.5 mm under 5 kg: permanent bend ${set.toFixed(1)}°; yield moment σ_y·b·t²/6 = ${(240e6 * 0.03 * 0.0015 * 0.0015 / 6).toFixed(2)} N·m against about ${(5 * G * 0.18).toFixed(1)} N·m)`)
		check("a 5 kg weight bends a 1.5 mm aluminium ruler for good", set > 0.5 ? 1 : 0, 1, 0, "it yields (σ_y 240 MPa)", false)
	}
}

// ------------------------------------------------------------------------------------------------------------------------------ clay
if (only === "all" || only === "clay") {
	console.log("\n# Clay dropped on the table: its dent against the flow-pressure law [TABOR] [SOFUOGLU]")
	for (const [h, d, soft] of [[0.25, 0.06, "normal"], [0.5, 0.06, "normal"], [1.0, 0.06, "normal"], [1.0, 0.06, "soft"], [1.0, 0.1, "firm"]] as [number, number, string][]) {
		const R = d / 2
		const r = run(scene([{ id: "c", type: "soft-clay", x: 1, y: h + R, props: { diameter: d, softness: soft } }], 1.2), 480)
		const peak = Math.max(...(r.track.state?.c?.squash_mm ?? [Number.NaN])) / 1000
		const dent = last(r.track.state?.c?.dent_mm) / 1000
		const sigma = { firm: 175000, normal: 120000, soft: 80000 }[soft] as number
		const p = 3 * sigma
		const m = 1570 * (4 / 3) * Math.PI * R * R * R
		// its energy at the table (the air's drag on a 6 cm ball over 1 m takes 0.1 %: left out) plus its weight's work while it flattens
		let lo = 0
		let hi = R
		for (let i = 0; i < 60; i++) {
			const x = (lo + hi) / 2
			if (p * Math.PI * (R * x * x - (x * x * x) / 3) < m * G * (h + x)) lo = x
			else hi = x
		}
		check(`${d * 100} cm ${soft} clay from ${h} m: deepest flattening`, peak, (lo + hi) / 2, 0.03, "p·π(Rδ² − δ³/3) = m·g·(h + δ), p = 3σ")
		check(`${d * 100} cm ${soft} clay from ${h} m: the dent it keeps`, dent, (lo + hi) / 2, 0.05, "the same, less the clay's 2 % elastic spring-back")
	}
	console.log("\n# A weight resting on clay: the flat that carries it")
	{
		const R = 0.03
		const r = run(scene([{ id: "c", type: "soft-clay", x: 1, y: R, props: {} }, { id: "w", type: "gram-mass", x: 1, y: 2 * R + 0.0005, props: { grams: "1 kg" } }], 2), 120)
		const dents = r.track.state?.c?.dent_mm ?? []
		// both flats: the table's under it and the weight's on top each carry the weight (plus the clay's own on the bottom one)
		// (the deepest flat is the bottom one: it carries the weight and the clay's own 177 g)
		const W = (1 + 1570 * (4 / 3) * Math.PI * R * R * R) * G
		const p = 3 * 120000
		let lo = 0
		let hi = R
		for (let i = 0; i < 60; i++) {
			const x = (lo + hi) / 2
			if (p * Math.PI * (2 * R * x - x * x) < W) lo = x
			else hi = x
		}
		// (the weight is set down 0.5 mm above it: the hit's 5 mJ adds a little; the deepest flat is the bottom one, carrying the clay's weight too)
		check("1 kg resting on a 6 cm clay ball: its bottom flat", last(dents) / 1000, (lo + hi) / 2, 0.1, "p·π(2Rδ − δ²) = W (the load and the clay's weight)")
	}
	{
		// a 5 kg steel weight dropped 11 cm onto it: once still, the clay holds it steadily, its force_n every frame of the last 2 s the weight's push
		// and the table's (2 × 49.05 N + its own 1.74 N)
		const R = 0.03
		const r = run(scene([{ id: "c", type: "soft-clay", x: 1, y: R, props: {} }, { id: "w", type: "steel-weight-5kg", x: 1, y: 0.2 }], 3), 120)
		const f = (r.track.state?.c?.force_n ?? []).slice(-240)
		const want = 2 * 5 * G + 1570 * (4 / 3) * Math.PI * R * R * R * G
		check("5 kg on a clay ball: force_n, its least over the last 2 s", Math.min(...f), want, 0.02, "what presses on it: the weight on top and the table under it (2W + its own)")
		check("5 kg on a clay ball: force_n, its most over the last 2 s", Math.max(...f), want, 0.02, "steady: the stiff clay contact never on one step and off the next")
	}
}

// ------------------------------------------------------------------------------------------------------------------------------ balls
const contact = (track: Track, item: string) => {
	// the first touch: from the first frame with a squash to the first one after it without (the readings are a step behind the bodies)
	const v = track.state?.[item]?.squash_mm ?? []
	const a = v.findIndex((x) => x > 0)
	let b = a
	while (b < v.length && (v[b] as number) > 0) b++
	let peak = 0
	for (let k = a; k < b; k++) peak = Math.max(peak, v[k] as number)
	return { a, b, dur: (b - a) * STEP, peak: peak / 1000 }
}
/** A body's vertical velocity at time t from frames i..j clear of the contact (each frame's own time): its speed and its acceleration there (gravity,
 *  the air's drag and lift: a 65 cm ball's lift is 16 % of its weight) measured, the speed brought to t (m/s, + up). */
const vyAt = (track: Track, id: string, i: number, j: number, t: number) => {
	const f = track.frames
	const at = (k: number) => f[k] as Track["frames"][number]
	const speed = (a: number, b: number) => ((at(b).placements[id]?.y ?? 0) - (at(a).placements[id]?.y ?? 0)) / (at(b).t - at(a).t)
	const m = Math.round((i + j) / 2)
	const v1 = speed(i, m)
	const v2 = speed(m, j)
	const t1 = (at(i).t + at(m).t) / 2
	const t2 = (at(m).t + at(j).t) / 2
	const acc = (v2 - v1) / (t2 - t1)
	return v2 + acc * (t - t2)
}
if (only === "all" || only === "ball") {
	console.log("\n# Inflated balls dropped on the table [CROSS]")
	// The soft contact squashes at the full force of the law and gives back e² of it as it eases (a hysteresis loop whose area is the energy
	// e leaves out), so: the deepest squash is the undamped one, v·√(m/k) for a small squash (a little more: the flat's area grows more slowly
	// than a straight line as it deepens); the contact lasts half a period squashing and 1/e of a half period easing, (π/2)·√(m/k)·(1 + 1/e);
	// it leaves at e times the speed it came at.
	// The contact's own law, here on its own: the flat's area A = π(2Rδ − δ²), the gas squeezed by the cap πδ²(R − δ/3) out of 4/3·πR³,
	// p = (101 325 + gauge)·(V0/V)^1.4, F = (p − 101 325)·A. Squashing at its full force and easing at e² of it, the ball's centre is
	// integrated (RK4, 2 µs) from the speed it lands at: the deepest squash, the time to it and back.
	const gasF = (R: number, gauge: number, x: number) => {
		const A = Math.PI * (2 * R * x - x * x)
		const V0 = (4 / 3) * Math.PI * R * R * R
		const V = V0 - Math.PI * x * x * (R - x / 3)
		return ((101325 + gauge) * Math.pow(V0 / V, 1.4) - 101325) * A
	}
	const squashRef = (R: number, gauge: number, mInert: number, mg: number, v0: number, e: number) => {
		const dt = 2e-6
		let x = 0
		let v = v0
		let t = 0
		let peak = 0
		const acc = (xx: number, vv: number) => (mg - gasF(R, gauge, Math.max(0, xx)) * (vv >= 0 ? 1 : e * e)) / mInert
		while (t < 1) {
			const k1v = acc(x, v)
			const k1x = v
			const k2v = acc(x + (dt / 2) * k1x, v + (dt / 2) * k1v)
			const k2x = v + (dt / 2) * k1v
			const k3v = acc(x + (dt / 2) * k2x, v + (dt / 2) * k2v)
			const k3x = v + (dt / 2) * k2v
			const k4v = acc(x + dt * k3x, v + dt * k3v)
			const k4x = v + dt * k3v
			x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
			v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
			t += dt
			peak = Math.max(peak, x)
			if (x < 0 && v < 0) break
		}
		return { peak, dur: t }
	}
	for (const [type, d, m, kPa, h] of [["playground-ball", 0.216, 0.4, 14, 1.0], ["exercise-ball", 0.65, 1.1, 4, 0.5], ["playground-ball", 0.216, 0.4, 28, 1.0], ["playground-ball", 0.216, 0.4, 2, 1.0]] as [string, number, number, number, number][]) {
		const R = d / 2
		const e = SB.bounce_e(SB.BALLS[type]?.[5], kPa)
		const r = run(scene([{ id: "b", type, x: 1, y: h + R, props: { pressure: kPa } }], 2.4), 480)
		const c = contact(r.track, "b")
		// (the ball's enclosed air moves with it: physics.ts adds its mass (ρ·V) to the ball's inertia, not its weight)
		const mInert = m + 1.2 * (4 / 3) * Math.PI * R * R * R
		const mg = (m - 1.2 * (4 / 3) * Math.PI * R * R * R) * G
		const id = "b/ball"
		const f = r.track.frames
		const t0 = (f[c.a - 1]?.t ?? 0) as number
		const t1 = (f[c.b - 1]?.t ?? 0) as number
		const v0 = -vyAt(r.track, id, c.a - 24, c.a - 6, t0)
		const v1 = vyAt(r.track, id, c.b + 6, c.b + 24, t1)
		const ref = squashRef(R, kPa * 1000, mInert, mg, v0, e)
		// (a nearly flat ball's deep, slow squash eases at e² 0.27 of its force for 20 ms: the step's implicit share of its stiffness ends it ~15 % sooner)
		check(`${type} ${kPa} kPa: contact time`, c.dur, ref.dur, kPa < 5 ? 0.16 : 0.12, "the gas law integrated, squashing at its force and easing at e² of it (a step's resolution)")
		check(`${type} ${kPa} kPa: deepest squash`, c.peak, ref.peak, 0.1, "the gas law's: (p − p_atm)·A with p rising as the cap squeezes the gas")
		// (its weight, less the air's lift, does work m·g·δ squashing it and takes it back as it rises: a deep, slow squash leaves a little under e)
		const KE0 = 0.5 * mInert * v0 * v0
		const Wg = mg * c.peak
		const eRef = Math.sqrt(Math.max(0, e * e * (KE0 + Wg) - Wg) / KE0)
		check(`${type} ${kPa} kPa: coefficient of restitution`, v1 / v0, eRef, 0.04, `e(p) [BOUNCE] ${e.toFixed(3)}, less the weight's work over the squash`)
	}
	console.log("\n# More air bounces higher: a playground ball dropped 1 m, its first bounce at each pressure [BOUNCE]")
	{
		const items = [0.5, 2, 3, 5, 8, 14, 20, 30, 35].map((kPa, i) => ({ id: `b${i}`, type: "playground-ball", x: -0.3 + 0.4 * i, y: 1.108, props: { pressure: kPa } }))
		const r = run(scene(items, 2.4), 120)
		const SBm = SB as unknown as { bounce_height: (ctx: unknown, id: string) => [number, number] | null }
		const ctx = { frames: r.track.frames, times: r.track.frames.map((q) => q.t), solids: (iid: string) => r.doc.solids.filter((x) => x.id.startsWith(`${iid}/`)), state: (iid: string, key: string) => r.track.state?.[iid]?.[key] ?? null }
		let prev = -1
		let rising = true
		for (const [i, it] of items.entries()) {
			const b = SBm.bounce_height(ctx, it.id)?.[0] ?? Number.NaN
			const e = SB.bounce_e(SB.BALLS["playground-ball"]?.[5], it.props.pressure)
			// (the air's drag on a 22 cm, 400 g ball over 2 m takes about 2 % of it)
			check(`${it.props.pressure} kPa: first bounce`, b, e * e * 1.0, 0.1, `about e² of the 1 m drop (e ${e.toFixed(3)}), a little less for the air`)
			if (!(b > prev)) rising = false
			prev = b
			void i
		}
		check("the bounce rises with every step of pressure (no dead ball at low pressure)", rising ? 1 : 0, 1, 0, "0.5 → 35 kPa", false)
	}
	console.log("\n# Elastic and plastic: dropped side by side")
	{
		const r = run({ ...scene([{ id: "c", type: "soft-clay", x: 0.6, y: 1.03, props: {} }, { id: "b", type: "playground-ball", x: 1.2, y: 1.108, props: {} }], 3), goals: [] }, 120)
		check("the clay keeps its dent", last(r.track.state?.c?.dent_mm), 7.33, 0.05, "dropped 1 m (the flow law above)")
		check("the playground ball ends round (no dent)", last(r.track.state?.b?.squash_mm) ?? 0, 0.0, 1.0, "elastic: mm of squash left (resting under its own weight: about 0.3 mm)", false)
	}
}
if (only === "all" || only === "foam") {
	console.log("\n# A foam ball dropped on the table [HERTZ]")
	// Hertz squashing at the law's full force: the deepest squash (15mv²/(16E*√R))^(2/5) and half its contact time 1.47·(m²/(R·E*²·v))^(1/5)
	// (Johnson: the whole, 2.94); it eases at e² of the force: that half lasts 1/e as long (the law scaled by e² is a spring e² as stiff)
	for (const h of [0.3, 1.0]) {
		const R = 0.035
		const r = run(scene([{ id: "f", type: "foam-ball", x: 1, y: h + R, props: {} }], 1.5), 480)
		const c = contact(r.track, "f")
		const m = 0.022
		const Es = 100000 / (1 - 0.09)
		const f = r.track.frames
		const v = -vyAt(r.track, "f/ball", c.a - 24, c.a - 6, (f[c.a - 1]?.t ?? 0) as number)
		const half = 1.47 * Math.pow((m * m) / (R * Es * Es * v), 0.2)
		// (a 22 g foam ball's touch lasts 4-6 steps of 2.08 ms: the step resolves its time to about a step, and the share of its stiffness the step
		// cannot follow (ω·h ≈ 0.85) is solved implicitly: it comes out shorter)
		check(`foam ball from ${h} m: contact time`, c.dur, half * (1 + 1 / 0.55), 0.4, "1.47·(m²/(R·E*²·v))^(1/5)·(1 + 1/e) (Hertz; 4-7 steps: the step's resolution)")
		const v1 = vyAt(r.track, "f/ball", c.b + 6, c.b + 24, (f[c.b - 1]?.t ?? 0) as number)
		check(`foam ball from ${h} m: coefficient of restitution`, v1 / v, 0.55, 0.08, "its foam's e (the hysteresis loop)")
		const dmax = Math.pow((15 * m * v * v) / (16 * Es * Math.sqrt(R)), 0.4)
		check(`foam ball from ${h} m: deepest squash`, c.peak, dmax, 0.12, "(15mv²/(16E*√R))^(2/5) (Hertz)")
	}
}

// ------------------------------------------------------------------------------------------------------------------------------ spring
if (only === "all" || only === "spring") {
	console.log("\n# The coil spring [HOOKE]")
	const squashed = (k: number, mass: number) => {
		const items = [{ id: "s", type: "coil-spring", x: 1, y: 0, props: { stiffness: k, damping: 3 } }, ...(mass > 0 ? [{ id: "w", type: "gram-mass", x: 1, y: 0.02 + 0.12 + 0.008 + 0.001, props: { grams: grams(mass) } }] : [])]
		const r = run(scene(items, 5), 120)
		return settledMean(r.track.state?.s?.compression_mm ?? [], 144) / 1000
	}
	for (const [k, mass] of [[200, 0.5], [500, 1.0], [100, 0.2]] as [number, number][]) check(`${k} N/m under ${mass} kg`, squashed(k, mass), (mass * G) / k, 0.02, "x = m·g/k (zeroed with its platform on it)")
	check("200 N/m with nothing on it reads 0", squashed(200, 0), 0, 0.00005, "m (zeroed with its platform on it, as a lab zeroes its scale)", false)
	for (const k of [50, 200]) {
		const a = squashed(k, 0.1)
		const b = squashed(k, 0.2)
		check(`${k} N/m: 200 g squashes it twice what 100 g does`, b - a, (0.1 * G) / k, 0.02, "squash(2m) − squash(m) = m·g/k (Hooke: the reading is proportional to the load)")
	}
}

// ------------------------------------------------------------------------------------------------------------------------------ rubber
/** The work (J) a rubber strand of rest length l0 and section A0 takes from λ = 1 to λ: ∫A0·G·(λ − 1/λ²)·J_m/(J_m − (λ² + 2/λ − 3)) l0 dλ
 *  (neo-Hookean [TRELOAR] stiffened toward the chains' full stretch [GENT]; midpoint rule, 4000 pieces). */
const strandWork = (A0: number, l0: number, lam: number, E = 1.5e6, Jm = 40) => {
	let w = 0
	const n = 4000
	for (let i = 0; i < n; i++) {
		const x = 1 + ((i + 0.5) / n) * (lam - 1)
		w += A0 * (E / 3) * (x - 1 / (x * x)) * (Jm / (Jm - (x * x + 2 / x - 3)))
	}
	return (w * (lam - 1) * l0) / n
}
if (only === "all" || only === "band") {
	console.log("\n# The rubber-band launcher [TRELOAR] [GENT]")
	for (const [draw, bands, size] of [[0.1, 1, "medium"], [0.15, 1, "medium"], [0.1, 2, "medium"], [0.1, 1, "thick"], [0.05, 1, "thin"]] as [number, number, string][]) {
		// a 2.5 cm wooden ball in its pouch, on the board; flung forward. Stored at the release vs the ball's energy in flight
		const R = 0.0125
		const items = [
			{ id: "L", type: "band-launcher", x: 0.6, y: 0, props: { draw, bands, band: size, height: R } },
			{ id: "b", type: "wooden-ball", x: 0.6 - draw + R + 0.002, y: 0.012 + R + 0.0003, props: { diameter: 2 * R } }
		]
		const r = run(scene(items, 0.6), 480)
		const E0 = r.track.state?.L?.energy_j?.[0] ?? Number.NaN
		// the band meets the pouch at its back, 16 mm × cos 25° behind its tips (which are `draw` behind the posts); each strand runs to a post 5 cm
		// to the side, its rest length 5 % short of that. At the start the pouch closes up to the ball (the ball sits in it): its back where the
		// run's first frame has it, which is checked to be at most the 2 mm placing gap (+ the ball's curve between the tips) nearer the posts
		const A0 = { thin: 1.6e-3 * 0.79e-3, medium: 6.35e-3 * 0.79e-3, thick: 12.7e-3 * 0.79e-3 }[size] as number
		const spread = 0.1
		const l0 = spread / 2 / 1.05
		const put = draw + 0.016 * Math.cos((25 * Math.PI) / 180)
		const r0 = 0.6 - (r.track.frames[0]?.placements["L/pouch"]?.x ?? Number.NaN)
		const seat = put - r0
		console.log(`      the pouch closes ${(seat * 1000).toFixed(2)} mm up to the ball at the start (the ball sits in it)`)
		check(`draw ${draw * 100} cm, ${bands}× ${size}: the pouch seats against the ball`, seat > 0 && seat < 0.005 ? 1 : 0, 1, 0, "it closes the 2 mm placing gap, less 0.5 mm, and no farther than 5 mm", false)
		const lam = Math.sqrt(r0 * r0 + (spread / 2) * (spread / 2)) / l0
		check(`draw ${draw * 100} cm, ${bands}× ${size}: stored`, E0, 2 * bands * strandWork(A0, l0, lam), 0.01, "2n·∫A0·G(λ − 1/λ²)·Gent dl (λ " + lam.toFixed(2) + ")")
		// its speed in flight: the median of its speeds 30-90 ms after it leaves the pouch (each frame's own time)
		const f = r.track.frames
		const id = "b/ball"
		const x0 = f[0]?.placements[id]?.x ?? 0
		const leave = f.findIndex((q) => (q.placements[id]?.x ?? 0) > x0 + draw + 0.02)
		const sp: number[] = []
		for (let k = leave + 14; k < Math.min(f.length - 1, leave + 44); k++) {
			const A = f[k] as Track["frames"][number]
			const B = f[k + 1] as Track["frames"][number]
			sp.push(Math.hypot((B.placements[id]?.x ?? 0) - (A.placements[id]?.x ?? 0), (B.placements[id]?.y ?? 0) - (A.placements[id]?.y ?? 0)) / (B.t - A.t))
		}
		sp.sort((a, b) => a - b)
		const v = sp[Math.floor(sp.length / 2)] ?? Number.NaN
		const ballMass = r.resolved.b?.mass ?? Number.NaN
		const eff = (0.5 * ballMass * v * v) / E0
		console.log(`      it flies at ${v.toFixed(2)} m/s: the ball takes ${(eff * 100).toFixed(1)} % of the stored energy (the band gives back 80 % of its pull as it shortens; the 2 g pouch keeps its share)`)
		check(`draw ${draw * 100} cm, ${bands}× ${size}: share the ball takes`, eff, 0.5, 0.45, "between about 30 % and 75 % (resilience 0.8, the pouch's share, the ball's roll)")
	}
}
if (only === "all" || only === "band") {
	console.log("\n# The rubber-band launcher at its props' limits: bounded, steady (no part past 250 m/s), every prop at its most")
	const lim = (props: Record<string, unknown>) => Object.entries(props).map(([k, v]) => `${k} ${v}`).join(", ")
	for (const props of [{ draw: 0.2, bands: 4, band: "thick", spread: 0.09, height: 0.3 }, { draw: 0.2, bands: 4, band: "thick", spread: 0.09, height: 0.02 }, { draw: 0.2, bands: 4, band: "thick", spread: 0.3, height: 0.03 }, { draw: 0.2, bands: 1, band: "thin", spread: 0.09, height: 0.005 }, { draw: 0, bands: 4, band: "thick", spread: 0.09, height: 0.03 }])
		for (const load of ["nothing", "ping-pong-ball", "toy-car"]) {
			const R = 0.02
			const draw = props.draw as number
			const items: unknown[] = [{ id: "L", type: "band-launcher", x: 0.3, y: 0, props }]
			if (load === "ping-pong-ball") items.push({ id: "p", type: "ping-pong-ball", x: 0.3 - draw + R + 0.003, y: 0.012 + R + 0.0003 })
			if (load === "toy-car") items.push({ id: "p", type: "toy-car", x: 0.3 - draw + 0.1 + 0.003, y: 0.012 })
			warned.length = 0
			const r = run(scene(items, 1.5), 120)
			const E = r.track.state?.L?.energy_j ?? []
			const fast = warned.filter((w) => /faster than/.test(w)).length
			const far = Math.max(...r.track.frames.map((q) => Math.abs((q.placements["L/pouch"]?.x ?? 0.3) - 0.3)))
			// (what it throws may nudge the pouch back a millimetre as it settles: 1 % and 5 mJ of slack; a run-away is orders of magnitude)
			const ok = Number.isFinite(Math.max(...E)) && Math.max(...E) <= (E[0] as number) * 1.01 + 0.005 && fast === 0 && far < 1
			check(`${lim(props)}; ${load}`, ok ? 1 : 0, 1, 0, `its energy never above the ${(E[0] as number).toFixed(2)} J it starts with (most ${Math.max(...E).toFixed(3)} J), no over-speed (${fast}), the pouch within ${far.toFixed(2)} m of the posts`, false)
		}
	console.log("\n# A band stretched to 6 × its length snaps [BAND_SNAP]")
	{
		// (a launcher's band cannot be pulled that far by its props: its record's rest length is shortened here so the start stretches it 6.2×)
		const p = sim.prepare(scene([{ id: "L", type: "band-launcher", x: 0.6, y: 0, props: { draw: 0.2 } }, { id: "b", type: "wooden-ball", x: 0.6 - 0.2 + 0.0125 + 0.002, y: 0.012 + 0.0125 + 0.0003, props: { diameter: 0.025 } }], 1.0))
		const rec = (p.doc.processes ?? []).find((q) => q.role === "band") as Record<string, number>
		rec.l0 = rec.l0 * 0.75
		const track = simulate(admitDocument(p.doc).scene, 120)
		const snap = (track.events ?? []).find((e) => e.kind === "snap")
		check("the band snaps at once (λ 6.2)", snap !== undefined && snap.t < 0.01 ? 1 : 0, 1, 0, snap ? `"${snap.text}" at ${snap.t.toFixed(3)} s` : "no snap event", false)
		check("then it holds nothing: its stored energy", Math.max(...(track.state?.L?.energy_j ?? [1])), 0, 1e-9, "J", false)
		check("its broken reading", last(track.state?.L?.broken), 1, 0, "1 once snapped", false)
		const x0 = track.frames[0]?.placements["b/ball"]?.x ?? 0
		const x1 = track.frames[track.frames.length - 1]?.placements["b/ball"]?.x ?? 0
		check("and the ball in its pouch is not thrown", Math.abs(x1 - x0), 0, 0.01, "m it moved", false)
	}
}
if (only === "all" || only === "car") {
	console.log("\n# A rubber-band car [TRELOAR] [GENT]")
	let prev = 0
	for (const turns of [5, 10, 20]) {
		const r = run(scene([{ id: "car", type: "toy-car", x: 0.2, y: 0, props: { band_turns: turns } }], 6), 120)
		const E0 = r.track.state?.car?.band_energy_j?.[0] ?? Number.NaN
		const l0 = 0.6 * 0.2
		const lam = (l0 + turns * 2 * Math.PI * SB.AXLE_R) / l0
		check(`${turns} turns: stored`, E0, 2 * strandWork(6.35e-3 * 0.79e-3, l0, lam), 0.01, "2 strands · ∫A0·G(λ − 1/λ²)·Gent dl")
		const x0 = r.track.frames[0]?.placements["car/chassis"]?.x ?? 0
		const x1 = r.track.frames[r.track.frames.length - 1]?.placements["car/chassis"]?.x ?? 0
		const unwound = (r.track.events ?? []).some((e) => e.kind === "unwound")
		console.log(`      it drives ${(x1 - x0).toFixed(2)} m (its band unwound: ${unwound ? "yes" : "no"})`)
		// (wound much more, the band's pull spins the light car's rear wheels and lifts its nose: the energy goes into the spin. A real rubber-band
		// car does the same; so only 5 → 10 turns is checked)
		if (turns === 10) check("10 turns drive it farther than 5", x1 - x0 > prev ? 1 : 0, 1, 0, "more wound band, more energy, farther", false)
		prev = x1 - x0
	}
	console.log("\n# More turns never take a band car less far: 5, 10, 20, 30 turns of each band on a 24 m run of tables (the tyres grip μ·N·r)")
	for (const type of ["toy-car", "cart"])
		for (const size of ["thin", "medium", "thick"]) {
			const dist: number[] = []
			let spun = 0
			for (const turns of [5, 10, 20, 30]) {
				const tables = [4, 12, 20].map((x, i) => ({ id: i ? `table${i}` : "table", type: "table", x, y: 0, props: { width: 8 } }))
				const sc = { ...scene([], 12), stage: { x0: -0.6, x1: 24.5, y0: -0.2, y1: 2 }, items: [...tables, { id: "car", type, x: 0.4, y: 0, props: { band_turns: turns, band_size: size } }] }
				const r = run(sc, 120)
				const xs = r.track.frames.map((q) => q.placements["car/chassis"]?.x ?? 0)
				dist.push((xs[xs.length - 1] as number) - (xs[0] as number))
				if ((r.track.events ?? []).some((e) => e.kind === "spin")) spun++
			}
			let ok = true
			for (let i = 1; i < dist.length; i++) if (!((dist[i] as number) >= (dist[i - 1] as number) - 0.001)) ok = false
			check(`${type}, ${size} band: ${dist.map((d) => d.toFixed(2)).join(" ≤ ")} m`, ok ? 1 : 0, 1, 0, `non-decreasing (${spun} of 4 spun their wheels: the turns past the tyres' grip wasted)`, false)
		}
}

console.log(`\n${checks - failed}/${checks} checks pass`)
process.exit(failed ? 1 : 0)
