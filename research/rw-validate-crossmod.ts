// Cross-module gaps (engine6 crossmod, 2026-10-20) against theory: where one module's thing meets another's. Every scene is built by web/sim (the
// exact port of machines/*.py: tools/parity proves it) and run by the engine from its sources (tooling/src/sim, every module registered, the
// bundle's math in node), at 480 Hz, 120 frames a second; the optics checks also call the tracer directly. Exits 1 on any failure (a gate).
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-crossmod.ts [vessel|weigh|solar|depth|telephone|stopwatch|all]
//   vessel     a tap's stream into a bowl floating in a tank goes into the bowl (flow's land(): the innermost container, and a container's opening
//              over another's surface), never the tank's water: it fills to ρ·V_envelope − m and sinks [ARCHIMEDES]; a cup standing in a bucket
//              fills before the bucket does
//   weigh      a kitchen scale weighs the grains heaped on its platform (granular grainsOn) and the liquid lying on it as a puddle (flow puddlesOn):
//              the mass × g ÷ g at rest [NIST-HB44], a tare taking what was set on it at the release; sand poured into a bowl standing on it is
//              weighed with the bowl (wherever the grains lie, their weight is on the platform)
//   solar      a solar panel takes the light the optics module traces onto its face: a flashlight aimed at it makes current, aimed away none, a
//              card between them shades it, a mirror turns the beam onto it
//   depth      optics: a clear body, a filter and a flat mirror catch the part of a lamp's tube their depth catches (as an opaque body does), not
//              the whole height: |z| < D/2 of the tube [the tracer's own out-of-plane model]; a mirror turns sunlight back as a band its own depth tall
//   telephone  a string telephone: the far cup's ear hears a whisper through a taut string, not through a slack, pinched or airless one; its
//              loss and speed as waves.ts telephoneOf's model says, worked out here again from the materials: Ernst's modulus [ERNST], a thin
//              bar's wave √(E/ρ) and impedance A·√(Eρ) [KIN §3.5], a lossy bar's e^(−η·ω·L/(2c)) [KIN]
//   stopwatch  a stopwatch that stops on another item's reading: a sand timer's empty (its own run_s), its bottom bulb's 20 g, an ice cube's
//              melted (the melt event), a person's reaction added; a reads goal on a lesson-clock stopwatch reads its lesson seconds
// References: [ARCHIMEDES] a floating body displaces its weight of liquid; a vessel floods when the liquid in it and its own mass make up ρ·V of
// its whole outer volume; [NIST-HB44] NIST Handbook 44 (a scale reads Σm·g ÷ g at rest); [ERNST] H. J. Ernst, Der Bauingenieur 40, 52-55 (1965);
// [KIN] Kinsler, Frey, Coppens & Sanders, Fundamentals of Acoustics, 4th ed. (2000); [IAPWS-95] water 998.2 kg/m³ at 20 °C; [CRC] nylon 6,6
// 1140 kg/m³, 2-4 GPa; steel 7850 kg/m³, 200 GPa.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..")
const imp = (p: string) => import(pathToFileURL(join(PG, p)).href)
const sim = await imp("web/sim/index.js")
const { admitDocument } = await imp("tooling/src/sim/document.ts")
const { simulate } = await imp("tooling/src/sim/physics.ts")
await imp("tooling/src/sim/modules/index.ts")
const O = await imp("tooling/src/sim/optics.ts")
const WV = await imp("tooling/src/sim/waves.ts")

let passed = 0
let failed = 0
const check = (ok: boolean, what: string, detail: string) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${what}  (${detail})`)
	if (ok) passed++
	else failed++
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b))
const f = (v: number, d = 4) => (Number.isFinite(v) ? Number(v.toPrecision(d)).toString() : String(v))
const want = new Set(process.argv.slice(2))
const on = (k: string) => want.size === 0 || want.has("all") || want.has(k)

type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; held?: boolean; fixed?: boolean; name?: string }
type Track = {
	frames: { t: number; placements: Record<string, { x: number; y: number; angle: number }> }[]
	state?: Record<string, Record<string, number[]>>
	events?: { t: number; items: string[]; text: string; kind?: string }[]
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
/** A scene through the app's builder and the engine: its track, readings, events, summary. */
const run = (items: Item[], seconds: number, extra: Record<string, unknown> = {}) => {
	const scene = { version: 2, id: "v", name: "v", seconds, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals: [], ...extra }
	const { scene: sc, doc, resolved } = sim.prepare(scene)
	const track = simulate(admitDocument(doc).scene, 120) as Track
	const fin = sim.finish(sc, doc, resolved, track)
	const series = (item: string, key: string) => track.state?.[item]?.[key] ?? []
	const end = (item: string, key: string) => series(item, key).at(-1) as number
	const frame = (t: number) => {
		let k = 0
		while (k + 1 < track.frames.length && (track.frames[k + 1] as { t: number }).t <= t + 1e-9) k++
		return k
	}
	const at = (item: string, key: string, t: number) => series(item, key)[frame(t)] as number
	const events = track.events ?? []
	return { doc, track, series, end, at, frame, events, summary: fin.summary as { goals: { ok: boolean; label: string; [k: string]: unknown }[] } }
}
const eventAt = (r: ReturnType<typeof run>, re: RegExp) => r.events.find((e) => re.test(e.text))?.t ?? Number.NaN

// ------------------------------------------------------------------------------------------------ a stream into a floating bowl
if (on("vessel")) {
	// a melamine bowl floating in the aquarium (the solver's floating height), a tap of 80 mL/s straight over its middle from 0.5 s
	const r = run(
		[
			{ id: "tank", type: "water-tank", x: 1.45, y: 0 },
			{ id: "bowl", type: "bowl", x: 1.45, y: 0.196195, props: { material: "melamine" } },
			{ id: "tap", type: "tap", x: 1.45, y: 0.45, props: { flow_ml_s: 80, on_at: 0.5 } }
		],
		14,
		{ goals: [{ kind: "floats_then_sinks", item: "bowl" }] }
	)
	const flood = eventAt(r, /bowl fills with water and sinks/)
	// (while it floats: what the tap has let go of, less what is still falling (its fall of about 0.25 m, ≈ 0.23 s), is in the bowl)
	const t1 = Math.min(6.5, flood - 0.5)
	const inBowl = r.at("bowl", "liquid_ml", t1)
	const poured = r.at("tap", "flowed_ml", t1 - 0.25)
	check(Number.isFinite(flood) && rel(inBowl, poured) < 0.03, "a tap's stream lands in the bowl floating under it, not in the tank's water round it", `${f(inBowl)} mL in the bowl at ${t1} s for ${f(poured)} mL let go a fall earlier`)
	// (until its rim reaches the tank's surface (its freeboard 0): then the tank's water comes over it, and what lands there is the tank's)
	const fb = r.series("bowl", "freeboard_mm")
	const k0 = fb.findIndex((v) => v <= 0)
	const wet = k0 >= 0 ? (r.track.frames[k0] as { t: number }).t : Number.NaN
	const tankBefore = r.at("tank", "received_ml", wet - 0.05) || 0
	check(Number.isFinite(wet) && tankBefore < 3, "the tank takes none of the stream while the bowl floats under it", `${f(tankBefore)} mL before its rim reaches the water at ${f(wet)} s (it floods at ${f(flood)} s)`)
	// (it floods when the water in it and its own mass make up ρ·V of its outer volume: the fluids module's measured 565 mL for this bowl, CONTRACT)
	const full = Math.max(...r.series("bowl", "liquid_ml"))
	check(rel(full, 565) < 0.02, "it fills until it floods: ρ·V_envelope − m of water in it [ARCHIMEDES]", `${f(full)} mL (565 mL)`)
	check(r.summary.goals[0]?.ok === true, "goal floats_then_sinks {bowl} with a tap (it was a hose's only)", JSON.stringify(r.summary.goals[0]))
	const sunk = r.end("bowl", "sunk")
	check(sunk === 1 && r.end("tank", "received_ml") > 100, "sunk, the bowl is under the water: the stream joins the tank's water again", `sunk ${sunk}, the tank took ${f(r.end("tank", "received_ml"))} mL in all`)
	// a cup standing on a bucket's floor: the tap over the cup fills the cup; only what overflows its rim reaches the bucket
	const n = run(
		[
			{ id: "bucket", type: "bucket", x: 1.3, y: 0 },
			{ id: "cup", type: "cup", x: 1.3, y: 0.004 },
			{ id: "tap", type: "tap", x: 1.3, y: 0.3, props: { flow_ml_s: 60, on_at: 0.5 } }
		],
		12
	)
	const over = eventAt(n, /cup overflows/)
	const bucketBefore = Number.isFinite(over) ? n.at("bucket", "liquid_ml", over - 0.05) : n.end("bucket", "liquid_ml")
	const cupFull = Math.max(...n.series("cup", "liquid_ml"))
	check(Number.isFinite(over) && bucketBefore < 2 && n.end("bucket", "liquid_ml") > 50, "a cup standing in a bucket fills first; the bucket gets only what overflows the cup", `the cup holds ${f(cupFull)} mL and overflows at ${f(over)} s; the bucket ${f(bucketBefore)} mL before, ${f(n.end("bucket", "liquid_ml"))} mL at the end`)
}

// ------------------------------------------------------------------------------------------------ a kitchen scale weighs grains and puddles
if (on("weigh")) {
	// 30 mL of water spilt straight onto the bare platform: a puddle that weighs 30 × 0.9982 g [IAPWS-95]
	const p = run([{ id: "sc", type: "kitchen-scale", x: 1.2, y: 0 }, { id: "t", type: "tap", x: 1.2, y: 0.2, props: { flow_ml_s: 20, on_at: 0.5, off_at: 2.0 } }], 4)
	const ml = p.end("sc", "puddle_ml")
	check(ml > 25 && rel(p.end("sc", "grams"), ml * 0.9982) < 0.005, "water lying on a kitchen scale's platform as a puddle is weighed [NIST-HB44]", `${f(p.end("sc", "grams"))} g for a ${f(ml)} mL puddle (${f(ml * 0.9982)} g)`)
	check(p.at("sc", "grams", 0.45) === 0, "nothing on it before the tap runs: 0 g", `${f(p.at("sc", "grams", 0.45))} g`)
	// corn syrup (1380 kg/m³) from a pitcher tipped over the platform: its puddle there weighs 1.38 g a mL
	const s = run([{ id: "sc", type: "kitchen-scale", x: 1.2, y: 0 }, { id: "j", type: "pitcher", x: 1.15, y: 0.2, props: { vessel: "cup", fill_ml: 60, liquid: "corn syrup", pour_at: 0.5 } }], 6)
	const sml = s.end("sc", "puddle_ml")
	check(sml > 5 && rel(s.end("sc", "grams"), sml * 1.38) < 0.01, "a puddle of corn syrup weighs 1.38 g a mL", `${f(s.end("sc", "grams"))} g for ${f(sml)} mL (${f(sml * 1.38)} g)`)
	// 100 g of sand heaped on the platform; and tared with it on
	const pile = (tare: boolean) => run([{ id: "sc", type: "kitchen-scale", x: 1.2, y: 0, props: { tare } }, { id: "pl", type: "sand-pile", x: 1.2, y: 0.026, props: { sand_kg: 0.1 } }], 1.5)
	const a = pile(false)
	check(rel(a.end("sc", "grams"), a.end("pl", "mass_g")) < 0.005, "a heap of sand set on the platform is weighed: its mass", `${f(a.end("sc", "grams"))} g for ${f(a.end("pl", "mass_g"))} g of sand`)
	const b = pile(true)
	check(Math.abs(b.end("sc", "grams")) < 0.5, "a tare with the heap on it at the release reads 0 g", `${f(b.end("sc", "grams"))} g`)
	// a funnel's 100 g poured onto the platform: once it has run empty the scale reads the heap it built there
	const fn = run([{ id: "sc", type: "kitchen-scale", x: 1.2, y: 0 }, { id: "fu", type: "sand-funnel", x: 1.2, y: 0.026, props: { sand_kg: 0.1 } }], 7)
	const heap = fn.end("fu", "heap_g")
	check(heap > 90 && rel(fn.end("sc", "grams"), heap) < 0.01, "sand a funnel pours onto the platform is weighed as it heaps up", `${f(fn.end("sc", "grams"))} g, its heap ${f(heap)} g (poured ${f(fn.end("fu", "poured_g"))} g)`)
	const mid = fn.at("sc", "grams", 1.5)
	check(mid > 5 && mid < fn.end("sc", "grams") - 5, "  and its reading rises as the heap grows", `${f(mid)} g at 1.5 s, ${f(fn.end("sc", "grams"))} g at the end`)
	// a heap on the table beside the scale is not on it
	const off = run([{ id: "sc", type: "kitchen-scale", x: 1.2, y: 0 }, { id: "pl", type: "sand-pile", x: 1.6, y: 0, props: { sand_kg: 0.1 } }], 1.5)
	check(off.end("sc", "grams") === 0, "a heap on the table beside it does not count", `${f(off.end("sc", "grams"))} g`)
	// a bowl standing on the platform and a funnel's 100 g poured into it: the scale reads the bowl and the sand (the sand's weight is on the
	// platform whether the bowl holds it or, where grains rest only on fixed solids, it lies on the platform under the bowl)
	const bowl = run([{ id: "sc", type: "kitchen-scale", x: 1.2, y: 0 }, { id: "bw", type: "bowl", x: 1.2, y: 0.026 }], 1.5)
	const bw = run([{ id: "sc", type: "kitchen-scale", x: 1.2, y: 0 }, { id: "bw", type: "bowl", x: 1.2, y: 0.026 }, { id: "fu", type: "sand-funnel", x: 1.2, y: 0, props: { sand_kg: 0.1, height: 0.3 } }], 9)
	const B = bowl.end("sc", "grams")
	const sandIn = bw.end("fu", "poured_g")
	const extra = bw.end("sc", "grams") - B
	check(B > 100 && sandIn > 95 && rel(extra, sandIn) < 0.01, "sand a funnel pours into a bowl standing on the platform is weighed with the bowl", `${f(bw.end("sc", "grams"))} g: the bowl's ${f(B)} g and ${f(extra)} g for the ${f(sandIn)} g poured`)
}

// ------------------------------------------------------------------------------------------------ the solar panel takes the traced light
if (on("solar")) {
	// a mini panel indoors (its own sun 0) and a flashlight 30 cm over it: aimed at it, aimed away, shaded by a card, turned onto it by a mirror
	// (wired to an ammeter: a closed loop, so its light makes current)
	const panel: Item[] = [
		{ id: "panel", type: "solar-panel", x: 1.3, y: 0.006, props: { sun: 0 } },
		{ id: "A", type: "meter", x: 1.6, y: 0.075, props: { mode: "amps" } },
		{ id: "w1", type: "wire", x: 0, y: 0, props: { a: "panel", a_end: "+", b: "A", b_end: "+" } },
		{ id: "w2", type: "wire", x: 0, y: 0, props: { a: "A", a_end: "-", b: "panel", b_end: "-" } }
	]
	const lit = run([...panel, { id: "torch", type: "flashlight", x: 1.3, y: 0.3, props: { aim: -90, lumens: 300 } }], 1)
	const away = run([...panel, { id: "torch", type: "flashlight", x: 1.3, y: 0.3, props: { aim: 90, lumens: 300 } }], 1)
	const e1 = lit.end("panel", "irradiance")
	check(e1 > 1 && lit.end("panel", "current") > 0, "a flashlight aimed at the panel: its traced light makes current", `${f(e1)} W/m² of sunlight's worth, ${f(lit.end("panel", "current") * 1000)} mA`)
	check(away.end("panel", "irradiance") === 0 && away.end("panel", "current") === 0, "aimed away: no light on the panel, no current", `${f(away.end("panel", "irradiance"))} W/m²`)
	const card = run([...panel, { id: "torch", type: "flashlight", x: 1.3, y: 0.3, props: { aim: -90, lumens: 300 } }, { id: "card", type: "material-panel", x: 1.3, y: 0.15, angle: 90, props: { sample: "cardboard", size: 0.2 } }], 1)
	check(card.end("panel", "irradiance") < 0.05 * e1, "a card held between them shades the panel", `${f(card.end("panel", "irradiance"))} W/m² against ${f(e1)}`)
	// the flashlight level with the panel's face, pointing right at a mirror 45° to the beam that turns it down onto the panel
	const mir = run([...panel, { id: "torch", type: "flashlight", x: 0.9, y: 0.3, props: { aim: 0, lumens: 300 } }, { id: "m", type: "mirror", x: 1.3, y: 0.3, props: { aim: 225, width: 0.2 } }], 1)
	check(mir.end("panel", "irradiance") > 0.1 * e1 && mir.end("panel", "current") > 0, "a mirror turns a flashlight's beam onto the panel: it makes current", `${f(mir.end("panel", "irradiance"))} W/m², ${f(mir.end("panel", "current") * 1000)} mA`)
}

// ------------------------------------------------------------------------------------------------ the depth share of a beam
if (on("depth")) {
	const NB = O.NB as number
	const white = () => {
		const p = new Float64Array(NB)
		for (let b = 0; b < NB; b++) p[b] = 0.1
		return p
	}
	// a flashlight-like round cone (10° each way, in the plane and out of it) from the origin along +x
	const torch = { id: "T/light", item: "T", solid: "", kind: "flashlight", x: 0, y: 0, dir: 0, spread: 10 * (Math.PI / 180), outSpread: 10 * (Math.PI / 180), round: true, size: 0.01, blur: 0, power: white(), nm: 0, rays: 64 }
	const slab = (id: string, role: string, half: number, extra: Record<string, unknown> = {}) => ({ id: `${id}/b`, item: id, role, prims: O.slabPrims(0.04, 0.04), halfDepth: half, absorb: [1, 1, 1, 1, 1, 1, 1, 1], ...extra })
	const caught = (body: Record<string, unknown>, x: number) => {
		const r = O.trace({ bodies: [body], sources: [torch], pose: () => ({ x, y: 0, angle: 0 }) })
		let w = 0
		for (const d of r.deposits) if (!d.volume) for (let b = 0; b < NB; b++) w += d.incident[b] as number
		return w
	}
	// a 4 cm ice-like clear cube 34 cm away takes what a 4 cm opaque cube takes (the torch's cone is 12 cm tall there: about a third of it)
	const glass = caught(slab("G", "glass", 0.02, { medium: "crown glass", absorb: [0, 0, 0, 0, 0, 0, 0, 0] }), 0.34)
	const opaque = caught(slab("K", "opaque", 0.02), 0.34)
	const deep = caught(slab("D", "glass", 1, { medium: "crown glass", absorb: [0, 0, 0, 0, 0, 0, 0, 0] }), 0.34)
	check(rel(glass, opaque) < 0.005, "a 4 cm clear cube 34 cm from a torch catches what a 4 cm opaque cube does (|z| < D/2 of its tube)", `${f(glass * 1000)} mW against ${f(opaque * 1000)} mW`)
	check(glass < 0.5 * deep, "  not the whole height of the beam: a body 2 m deep there catches all of it", `${f(glass * 1000)} mW against ${f(deep * 1000)} mW (they were the same before)`)
	// a desk lamp's wide shade (35° each way: its cone is 48 cm tall there): the heat repair's "12 times its light" case
	const lamp = { ...torch, spread: 35 * (Math.PI / 180), outSpread: 35 * (Math.PI / 180) }
	const caughtBy = (src: Record<string, unknown>, body: Record<string, unknown>) => {
		const r = O.trace({ bodies: [body], sources: [src], pose: () => ({ x: 0.34, y: 0, angle: 0 }) })
		let w = 0
		for (const d of r.deposits) if (!d.volume) for (let b = 0; b < NB; b++) w += d.incident[b] as number
		return w
	}
	const lg = caughtBy(lamp, slab("G", "glass", 0.02, { medium: "water", absorb: [0, 0, 0, 0, 0, 0, 0, 0] }))
	const lo = caughtBy(lamp, slab("K", "opaque", 0.02))
	const ld = caughtBy(lamp, slab("D", "glass", 1, { medium: "water", absorb: [0, 0, 0, 0, 0, 0, 0, 0] }))
	check(rel(lg, lo) < 0.005 && ld > 8 * lg, "under a desk lamp's wide cone a 4 cm clear cube takes its depth's share, a tenth of the beam's height", `${f(lg * 1000)} mW (opaque ${f(lo * 1000)} mW; the whole height ${f(ld * 1000)} mW, ${f(ld / lg)} ×)`)
	const filt = caught(slab("F", "filter", 0.02, { pass: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9] }), 0.34)
	check(rel(filt, opaque) < 0.005, "a 4 cm colour filter there catches its depth's share too", `${f(filt * 1000)} mW`)
	// a flat mirror 4 cm deep turns back only what it catches: a deep screen behind the torch gets that × its reflectance
	const mirror = { id: "M/m", item: "M", role: "mirror", prims: O.slabPrims(0.004, 0.1), halfDepth: 0.02, faces: [2], absorb: [1, 1, 1, 1, 1, 1, 1, 1], reflect: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9] }
	const screen = { id: "S/s", item: "S", role: "opaque", prims: O.slabPrims(0.01, 0.6), halfDepth: 1, absorb: [1, 1, 1, 1, 1, 1, 1, 1] }
	// (the torch along +x onto a mirror at 0.3 m turned −45°: its face (prim 2) faces back-up, turning the beam straight up onto a deep screen)
	const r = O.trace({ bodies: [mirror, screen], sources: [torch], pose: (id: string) => (id === "M/m" ? { x: 0.3, y: 0, angle: -Math.PI / 4 } : { x: 0.3, y: 0.4, angle: Math.PI / 2 }) })
	let atMirror = 0
	let atScreen = 0
	for (const d of r.deposits) {
		let w = 0
		for (let b = 0; b < NB; b++) w += d.incident[b] as number
		// (on the mirror: its silvered face only, prim 2; its thin edges take light without turning it)
		if (d.body === 0) atMirror += d.prim === 2 ? w : 0
		else atScreen += w
	}
	// (what the mirror's face catches is what an opaque slab of its outline, depth and place catches there)
	const dull = O.trace({ bodies: [{ ...mirror, role: "opaque", faces: undefined, reflect: undefined }], sources: [torch], pose: () => ({ x: 0.3, y: 0, angle: -Math.PI / 4 }) })
	let atDull = 0
	for (const d of dull.deposits) if (d.prim === 2) for (let b = 0; b < NB; b++) atDull += d.incident[b] as number
	check(atMirror > 0 && rel(atMirror, atDull) < 0.005 && rel(atScreen, 0.9 * atMirror) < 0.02, "a flat mirror 4 cm deep catches its depth's share of a torch's beam and turns back only that", `the mirror's face ${f(atMirror * 1000)} mW (an opaque slab there ${f(atDull * 1000)} mW); the deep screen ${f(atScreen * 1000)} mW = 0.9 × it`)
	// sunlight (W per metre of height) off a flat mirror 10 cm deep onto a body 1 m deep: a band 10 cm tall, not the body's metre of it
	// (sunlight straight down onto a mirror turned 45°: its top face (prim 1) turns the band left onto a tall body 1 m deep)
	const sun = { id: "U/light", item: "U", solid: "", kind: "sun", x: 0, y: 1, dir: -Math.PI / 2, spread: 0, outSpread: 0, size: 0.02, blur: 0, power: white(), nm: 0, rays: 16 }
	const flat = { id: "M/m", item: "M", role: "mirror", prims: O.slabPrims(0.2, 0.004), halfDepth: 0.05, faces: [1], absorb: [1, 1, 1, 1, 1, 1, 1, 1], reflect: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9] }
	const big = { id: "B/b", item: "B", role: "opaque", prims: O.slabPrims(0.01, 0.6), halfDepth: 0.5, absorb: [1, 1, 1, 1, 1, 1, 1, 1] }
	const s2 = O.trace({ bodies: [flat, big], sources: [sun], pose: (id: string) => (id === "M/m" ? { x: 0, y: 0, angle: Math.PI / 4 } : { x: -0.5, y: 0, angle: 0 }) })
	let mir2 = 0
	let big2 = 0
	for (const d of s2.deposits) {
		let w = 0
		for (let b = 0; b < NB; b++) w += d.incident[b] as number
		if (d.body === 0) mir2 += w
		else big2 += w
	}
	check(mir2 > 0 && rel(big2, 0.9 * mir2) < 0.02, "sunlight off a flat mirror 10 cm deep: a body 1 m deep above gets 0.9 × what the mirror caught, not 10 ×", `${f(big2 * 1000)} mW against the mirror's ${f(mir2 * 1000)} mW`)
	// a laser's thin beam (0.75 mm) fits any body: through a 4 cm glass block it is untouched by the depth rule (two 4 % reflections)
	const p = new Float64Array(NB)
	p[O.bandOf(650)] = 0.001
	const laser = { id: "L/light", item: "L", solid: "", kind: "laser", x: 0, y: 0, dir: 0, spread: 0, outSpread: 0, size: 0.00075, blur: 0.0005, power: p, nm: 650, rays: 1 }
	const lr = O.trace({ bodies: [slab("G", "glass", 0.02, { medium: "crown glass", absorb: [0, 0, 0, 0, 0, 0, 0, 0] })], sources: [laser], pose: () => ({ x: 0.34, y: 0, angle: 0 }) })
	let lw = 0
	for (const d of lr.deposits) if (!d.volume) for (let b = 0; b < NB; b++) lw += d.incident[b] as number
	check(rel(lw, 0.001) < 1e-9, "a laser's 0.75 mm beam into a 4 cm glass block arrives whole", `${f(lw * 1000, 8)} mW of 1 mW`)
	// through the app: the optics demo of two ice cubes under a desk lamp (demos/optics/demo-lamp-ice.json): the near cube's light_w is its 4 cm
	// depth's share, not the whole height of the lamp's beam (2.0 W before)
	const demo = JSON.parse(readFileSync(join(PG, "demos/optics/demo-lamp-ice.json"), "utf8"))
	const { doc: ddoc } = sim.prepare(demo)
	const dtr = simulate(admitDocument(ddoc).scene, 120) as Track
	const lw2 = dtr.state?.cube2?.light_w?.at(-1) as number
	check(lw2 > 0 && lw2 < 0.3, "the lamp-and-ice demo: the near cube takes its depth's share of the lamp's light", `${f(lw2)} W (2.0 W with the beam's whole height)`)
}

// ------------------------------------------------------------------------------------------------ the string telephone
if (on("telephone")) {
	// the materials as the builder gives them (machines/mod_waves.py PHONE_STRINGS, PHONE_CUP), the model worked out here again
	const STR: Record<string, [number, number, number, number]> = { "cotton string": [0.001, 764, 2e9, 0.08], "fishing line": [0.0005, 1140, 3e9, 0.03], wire: [0.0003, 7850, 200e9, 0.001] }
	const model = (string: string, L: number, T: number, g = 9.81) => {
		const [d, rho, E, eta] = STR[string] as [number, number, number, number]
		const A = (Math.PI * d * d) / 4
		const w = rho * A * g
		const Eeq = E / (1 + ((w * L) ** 2 * E * A) / (12 * T ** 3))
		const Zs = A * Math.sqrt(Eeq * rho)
		const om = 2 * Math.PI * 1000
		const S = Math.PI * 0.0265 ** 2
		const Zd = om * 0.00066 * Math.abs(1 - (590 / 1000) ** 2)
		const ratio = ((2 * S * S * Zs * 1.4 * 101325) / (om * 0.000266 * (Zd * Zd + Zs * Zs))) * Math.exp((-eta * om * L) / (2 * Math.sqrt(E / rho)))
		// (the sag as the builder hangs it: at most 15 % of its length, never below y = 0, here 0.3 m under it)
		return { loss: -20 * Math.log10(ratio), c: Math.sqrt(Eeq / rho), sag: Math.min(0.15 * L, 0.295, (w * L * L) / (8 * T)) }
	}
	const phone = (props: Record<string, unknown>, extra: Record<string, unknown> = {}, ear = true) => {
		const L = (props.length as number | undefined) ?? 3
		return run(
			[
				{ id: "phone", type: "string-telephone", x: 1.3, y: 0.3, props },
				...(ear ? [{ id: "ear", type: "sound-meter", x: Number((1.3 + L / 2 + 0.12).toFixed(3)), y: 0, props: { height: 0.3 } }] : [])
			],
			3,
			{ stage: { x0: -4, x1: 7, y0: -0.2, y1: 3 }, ...extra }
		)
	}
	const taut = phone({})
	const m = model("cotton string", 3, 5)
	check(Math.abs(taut.end("phone", "loss_db") - m.loss) < 0.01 && rel(taut.end("phone", "string_ms"), m.c) < 1e-6, "3 m of cotton string pulled with 5 N: its loss cup to cup and its speed as the model says [ERNST, KIN]", `${f(taut.end("phone", "loss_db"))} dB (${f(m.loss)}), ${f(taut.end("phone", "string_ms"))} m/s (√(E/ρ) ${f(Math.sqrt(2e9 / 764))})`)
	check(Math.abs(taut.end("phone", "sag_mm") - m.sag * 1000) <= 0.001, "  its sag μ·g·L²/(8T) (to the record's micrometre)", `${f(taut.end("phone", "sag_mm"))} mm (${f(m.sag * 1000)})`)
	const heard = taut.end("ear", "peak:phone")
	check(heard >= 35 && taut.summary.goals.length === 0, "a whisper into the near cup is heard by an ear at the far cup (over a quiet room's 35 dB)", `${f(heard)} dB`)
	// its sound arrives along the string, before the air could bring it: L/c along the string, the air legs at 343 m/s
	const arrive = taut.end("ear", "at:phone") - 0.5
	const legs = 0.12 - 0.09
	check(Math.abs(arrive - (3 / m.c + legs / WV.airSpeed(20))) < 2.5e-4, "  along the string at its speed, ahead of the air (3 m at 343 m/s: 8.7 ms)", `${f(arrive * 1000)} ms (${f((3 / m.c + legs / WV.airSpeed(20)) * 1000)} ms)`)
	const slack = phone({ pull: 0 })
	const pinched = phone({ pinched: true })
	check(slack.end("phone", "carries") === 0 && pinched.end("phone", "carries") === 0, "slack (no pull) or pinched, the string carries nothing", `carries ${slack.end("phone", "carries")}, ${pinched.end("phone", "carries")}`)
	check(pinched.end("ear", "peak:phone") < 35 && slack.end("ear", "peak:phone") < 35, "  and the ear does not hear the whisper through the air (under 35 dB)", `pinched ${f(pinched.end("ear", "peak:phone"))} dB, slack ${f(slack.end("ear", "peak:phone"))} dB`)
	check(heard - pinched.end("ear", "peak:phone") > 6, "  the taut string brings it far louder than the air alone", `${f(heard)} against ${f(pinched.end("ear", "peak:phone"))} dB`)
	// longer cotton loses its loss factor's 8.686·η·ω/(2c) dB a metre; wire carries the most; a drooping string less
	const l1 = phone({ length: 1 }, {}, false).end("phone", "loss_db")
	const l5 = phone({ length: 5 }, {}, false).end("phone", "loss_db")
	const perM = (8.685889638 * 0.08 * 2 * Math.PI * 1000) / (2 * Math.sqrt(2e9 / 764))
	check(Math.abs((l5 - l1) / 4 - perM) < 0.01, "cotton string loses η·ω/(2c) a metre (1.35 dB)", `${f((l5 - l1) / 4)} dB/m (${f(perM)})`)
	const wire = phone({ string: "wire" }, {}, false).end("phone", "loss_db")
	const droop = phone({ pull: 0.1 }, {}, false).end("phone", "loss_db")
	check(wire < taut.end("phone", "loss_db") && droop > taut.end("phone", "loss_db") + 10, "steel wire carries more than cotton; a drooping string (0.1 N) far less [ERNST]", `wire ${f(wire)} dB, cotton ${f(taut.end("phone", "loss_db"))} dB, drooping ${f(droop)} dB`)
	const moon = phone({ pull: 0.1 }, { settings: { gravity: "moon" } }, false)
	check(moon.end("phone", "loss_db") < droop && Math.abs(moon.end("phone", "sag_mm") - model("cotton string", 3, 0.1, 1.62).sag * 1000) <= 0.001, "on the Moon the same pull droops less and carries more", `${f(moon.end("phone", "sag_mm"))} mm (${f(model("cotton string", 3, 0.1, 1.62).sag * 1000)}), ${f(moon.end("phone", "loss_db"))} dB`)
	const vac = phone({ voice: "normal" }, { settings: { air: false } })
	check(!(vac.end("ear", "peak:phone") > 0), "in a vacuum no voice reaches the cup: nothing is heard", `${f(vac.end("ear", "peak:phone"))}`)
	// the goals: hears, and hears with expect false for the slack one
	const g = run(
		[
			{ id: "taut", type: "string-telephone", x: 1.3, y: 0.9, props: { pull: 5 } },
			{ id: "slack", type: "string-telephone", x: 1.3, y: 0.3, props: { pull: 0 } },
			{ id: "ear1", type: "sound-meter", x: 2.97, y: 0.78, props: { height: 0.12 } },
			{ id: "ear2", type: "sound-meter", x: 2.97, y: 0, props: { height: 0.3 } }
		],
		3,
		{ goals: [{ kind: "hears", meter: "ear1", source: "taut" }, { kind: "hears", meter: "ear2", source: "slack", expect: false }, { kind: "hears", meter: "ear2", source: "slack" }] }
	)
	const ok = g.summary.goals.map((x) => x.ok)
	check(ok[0] === true && ok[1] === true && ok[2] === false, "goals: the taut telephone's ear hears it, the slack one's does not (hears, expect false)", JSON.stringify(g.summary.goals.map((x) => [x.label, x.ok])))
}

// ------------------------------------------------------------------------------------------------ a stopwatch that stops on a reading
if (on("stopwatch")) {
	// a one-minute sand timer under a time-lapse of 4, three stopwatches: on its empty (lesson clock), on 20 g in its bottom bulb, on its empty with a
	// person's 0.2 s reaction
	const r = run(
		[
			{ id: "hg", type: "hourglass", x: 1.0, y: 0 },
			{ id: "sw", type: "stopwatch", x: 1.5, y: 0.6, props: { watch: "hg", stop: "reads", counts: "lesson" } },
			{ id: "sw2", type: "stopwatch", x: 2.0, y: 0.6, props: { watch: "hg", stop: "reads", stop_reading: "bottom_g", stop_value: 20, counts: "lesson" } },
			{ id: "sw3", type: "stopwatch", x: 2.5, y: 0.6, props: { watch: "hg", stop: "reads", reaction_s: 0.2 } }
		],
		20,
		{ settings: { time_lapse: 4 }, goals: [{ kind: "reads", item: "sw", seconds: 60, tol: 3 }] }
	)
	const out = eventAt(r, /hg runs out/)
	check(Math.abs(r.end("sw", "lesson_s") - r.end("hg", "run_s")) < 0.02 && Math.abs(r.end("sw", "stop_s") - out) < 0.005, "a stopwatch stopped by the sand timer's empty reads the timer's own run time, in lesson seconds", `${f(r.end("sw", "lesson_s"))} s against run_s ${f(r.end("hg", "run_s"))} s; stopped at ${f(r.end("sw", "stop_s"))} s (it ran out at ${f(out)} s)`)
	const k = r.frame(r.end("sw2", "stop_s"))
	const g20 = r.series("hg", "bottom_g")[k] as number
	check(Math.abs(g20 - 20) < 0.3, "one stopped when the bottom bulb holds 20 g stops there", `${f(g20)} g at its stop (${f(r.end("sw2", "lesson_s"))} lesson s)`)
	check(Math.abs(r.end("sw3", "stop_s") - r.end("sw", "stop_s") - 0.2) < 0.005, "a person's 0.2 s reaction stops it 0.2 s later", `${f(r.end("sw3", "stop_s"))} s against ${f(r.end("sw", "stop_s"))} s`)
	const goal = r.summary.goals[0] as { ok: boolean; key?: string; got?: number }
	check(goal?.ok === true && goal.key === "lesson_s", "a reads goal on a lesson-clock stopwatch reads its lesson seconds (what its face shows)", JSON.stringify(goal))
	// an ice cube melting under a time-lapse: the stopwatch stops as its melted reading reaches 1, when the run says it melted completely
	const ice = run([{ id: "plate", type: "plate", x: 1.0, y: 0 }, { id: "ice", type: "ice-cube", x: 1.0, y: 0.03 }, { id: "sw", type: "stopwatch", x: 1.5, y: 0.6, props: { watch: "ice", stop: "reads", stop_reading: "melted", counts: "lesson" } }], 12, { settings: { time_lapse: 600 } })
	const melt = eventAt(ice, /melted completely/)
	check(Number.isFinite(melt) && Math.abs(ice.end("sw", "stop_s") - melt) < 0.11, "one stopped by an ice cube's melted reading stops as it melts away (within its 10 Hz reading)", `stopped at ${f(ice.end("sw", "stop_s"))} s, melted at ${f(melt)} s (${f(ice.end("sw", "lesson_s") / 60)} lesson minutes)`)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
