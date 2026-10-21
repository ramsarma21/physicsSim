// The measure module's validation (machines/mod_measure.py, web/sim/modules/measure.js, tooling/src/sim/modules/measure.ts): every instrument
// against real reference values, the stopwatch against the engine's own 480 Hz track, the lessons' numbers, determinism and a crash fuzz.
// Each check builds a scene through web/sim (the browser's builder; tools/parity proves it is the Python one), runs it on the engine from its
// sources (with the module's processes) and compares the instrument's reading with theory. Run:
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-measure.ts [time|roll|gate|spring|scale|balance|angle|tape|sensor|lesson|rules|fuzz|all]
// References: g = 9.81 m/s² (the engine's; standard gravity 9.80665, CGPM 1901); free fall t = √(2h/g) (Galileo, Two New Sciences 1638); a
// solid ball rolling without slipping down a slope accelerates at (5/7)·g·sin θ (I = 2/5·m·r²; e.g. Serway & Jewett 9th ed. §10.9); a photogate's
// speed = flag length / blocked time (Vernier Photogate user manual); a spring scale reads F = k·x = m·g (Hooke); a scale reads Σm·g ÷ g at rest
// (NIST Handbook 44: d = 1 g); an equal-arm balance tips toward the larger mass (lever rule); a simple pendulum keeps its swing (energy) when
// undamped; ultrasonic rangers read 0.15-6 m (Vernier Motion Detector).
import { pathToFileURL } from "node:url"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
type P = { x: number; y: number; angle: number }
type Track = { frames: { t: number; placements: Record<string, P> }[]; state?: Record<string, Record<string, number[]>>; impacts?: { t: number; a: string; b: string }[] }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: unknown, fps: number) => Track }
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: unknown } }
const sim = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as {
	layout: (s: unknown) => { doc: { solids: { id: string; item: string; kind: string; body: Record<string, number> & { kind: string }; at: { x: number; y: number } }[] }; resolved: Record<string, Record<string, unknown>> }
	catalog: () => { types: { key: string; props: { key: string }[] }[] }
}
const G = 9.81
const D2R = Math.PI / 180
let failures = 0
let checks = 0
const pct = (got: number, want: number) => (want === 0 ? `${(got - want).toExponential(2)}` : `${(((got - want) / want) * 100).toFixed(2)}%`)
const check = (label: string, got: number | null | undefined, want: number, tol: number, unit = "") => {
	checks++
	const ok = typeof got === "number" && Number.isFinite(got) && Math.abs(got - want) <= tol
	if (!ok) failures++
	console.log(`  ${ok ? "PASS" : "FAIL"} ${label}: ${typeof got === "number" ? got.toFixed(4) : got}${unit}, reference ${want.toFixed(4)}${unit} (${typeof got === "number" ? pct(got, want) : "-"}; within ±${tol}${unit})`)
}
const claim = (label: string, ok: boolean, detail = "") => {
	checks++
	if (!ok) failures++
	console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`)
}
const scene = (items: unknown[], extra: Record<string, unknown> = {}) => ({
	version: 2, id: "rwm", name: "rwm", seconds: 4, release: 0.5, stage: { x0: -1.5, x1: 14, y0: -0.3, y1: 3 }, items: [{ id: "table", type: "table", x: 1.3, y: 0 }, ...items], goals: [], ...extra
})
const run = (s: unknown, fps = 120) => {
	const { doc, resolved } = sim.layout(s)
	const track = simulate(admitDocument(doc).scene, fps)
	const end = (item: string, key: string) => {
		const v = track.state?.[item]?.[key]
		return v && v.length ? (v[v.length - 1] as number) : null
	}
	return { doc, resolved, track, end }
}
const { mass: partMass } = (await import(`${PG}/tooling/src/sim/part.ts`)) as { mass: (p: unknown) => number }
/** An item's mass in grams: its resolved mass (an egg's, a clay ball's), a slotted mass's marked grams, else Σ density × volume of its moving parts. */
const itemGrams = (doc: unknown, resolved: Record<string, Record<string, unknown>>, id: string) => {
	const P = resolved[id] ?? {}
	if (typeof P["mass"] === "number") return (P["mass"] as number) * 1000
	if (typeof P["grams"] === "string" && /^\d+(\.\d+)? (g|kg)$/.test(P["grams"] as string)) {
		const [v, u] = (P["grams"] as string).split(" ")
		return Number(v) * (u === "kg" ? 1000 : 1)
	}
	const parts = (admitDocument(doc).scene as { solids: { id: string; kind: string }[] }).solids
	return parts.filter((q) => q.id.startsWith(`${id}/`) && q.kind === "dynamic").reduce((a, q) => a + partMass(q) * 1000, 0)
}
const has = (type: string, prop: string) => sim.catalog().types.find((t) => t.key === type)?.props.some((p) => p.key === prop) ?? false

// ---------------------------------------------------------------- free fall timed from the release to the hit
function time() {
	console.log("stopwatch: a steel ball dropped from rest, timed from the release to its first touch (t = √(2h/g) with the air's drag; h = the drop of its bottom to the table, less the 0.5 mm contact skin)")
	for (const h of [0.25, 0.5, 1.0, 2.0]) {
		const r = 0.0127
		const R = run(scene([
			{ id: "ball", type: "steel-ball", x: 1.0, y: h + r, held: true },
			{ id: "sw", type: "stopwatch", x: 2, y: 1, props: { watch: "ball", start: "release", stop: "hits" } }
		], { seconds: Math.sqrt((2 * h) / G) + 1.0 }))
		// with the air's drag (the engine's: ½·ρ·Cd·A·v², ρ 1.2 kg/m³, a sphere's Cd 0.47): h = (v_t²/g)·ln cosh(g·t/v_t), so t = (v_t/g)·acosh(e^(g·h/v_t²))
		const m = 0.0674
		const vt = Math.sqrt((2 * m * G) / (1.2 * 0.47 * Math.PI * r * r))
		const fall = h - 0.0005
		// (the engine's 480 Hz step, semi-implicit Euler, runs ahead of the exact fall by half a step: ½·g·h·t of drop, 1.04 ms of time)
		check(`drop ${h} m (vacuum ${Math.sqrt((2 * fall) / G).toFixed(4)} s)`, R.end("sw", "seconds"), (vt / G) * Math.acosh(Math.exp((G * fall) / (vt * vt))) - 0.5 / 480, 0.0005, " s")
	}
}

// ---------------------------------------------------------------- rolling down a slope
function roll() {
	console.log("stopwatch: a steel ball rolling from rest down a plank, timed from the release until its front has gone d along the slope (a = 5/7·g·sin θ; t = √(2d/a))")
	for (const deg of [5, 10, 20]) {
		const th = deg * D2R
		const r = 0.0127
		const d = 1.0
		// a 2.5 m plank tilted at θ about its middle (x = 1.3, y = 0.5); the ball starts 0.4 m from its upper end
		const L = 2.5
		const cx = 1.3
		const cy = 0.7
		const s0 = -L / 2 + 0.4 // along the plank from its middle
		const t2 = 0.011 // half the plank's thickness (22 mm)
		const bx = cx + s0 * Math.cos(-th) - (t2 + r + 0.0003) * Math.sin(-th)
		const by = cy + s0 * Math.sin(-th) + (t2 + r + 0.0003) * Math.cos(-th)
		const front0 = bx + r
		const R = run(scene([
			{ id: "ramp", type: "plank", x: cx, y: cy, angle: -deg, props: { length: L, legs: false } },
			{ id: "ball", type: "steel-ball", x: bx, y: by, held: true },
			{ id: "sw", type: "stopwatch", x: 2, y: 1.5, props: { watch: "ball", start: "release", stop: "crosses", stop_x: front0 + d * Math.cos(th) } }
		], { seconds: 3.5 }))
		// steel on varnished wood rolls against 0.001 (the catalog's larger of the two): a = 5/7·g·(sin θ − 0.001·cos θ); ±1.5 % for the rest (air, contact skin)
		const a = (5 / 7) * G * (Math.sin(th) - 0.001 * Math.cos(th))
		const want = Math.sqrt((2 * d) / a)
		check(`${deg}° slope, 1 m`, R.end("sw", "seconds"), want, 0.015 * want, " s")
	}
}

// ---------------------------------------------------------------- the stopwatch against the engine's own 480 Hz track; the speed gate
function gate() {
	console.log("stopwatch and speed gate: a motor car at a steady speed between two lines 4 m apart, against its 480 Hz track (the front edge interpolated between steps)")
	for (const v of [0.8, 2.0, 3.3]) {
		const s = scene([
			{ id: "lane", type: "lane", x: 0, y: 0.02, props: { length: 8 } },
			{ id: "car", type: "motor-car", x: -0.1, y: 0.02, props: { speed: v, push: 6 } },
			{ id: "a", type: "start-line", x: 2, y: 0.02 },
			{ id: "b", type: "finish-line", x: 6, y: 0.02 },
			{ id: "sw", type: "stopwatch", x: 4, y: 1, props: { watch: "car", start: "crosses", start_line: "a", stop: "crosses", finish_line: "b" } },
			{ id: "gate", type: "speed-gate", x: 4, y: 0.02, props: { watch: "car" } }
		], { seconds: 6 / v + 2 })
		const R = run(s, 480)
		// the front edge from the track (every step), as an outsider measures it
		const sol = R.doc.solids.filter((q) => q.item === "car" && q.kind === "dynamic")
		const front = (k: number) => {
			let hi = -Infinity
			for (const q of sol) {
				const p = R.track.frames[k]!.placements[q.id]!
				if (q.body.kind === "ball") hi = Math.max(hi, p.x + q.body.radius)
				else {
					const pts = (q.body as unknown as { points?: { x: number; y: number }[] }).points ?? [
						{ x: -q.body.width / 2, y: -q.body.height / 2 }, { x: q.body.width / 2, y: -q.body.height / 2 }, { x: q.body.width / 2, y: q.body.height / 2 }, { x: -q.body.width / 2, y: q.body.height / 2 }
					]
					for (const v2 of pts) hi = Math.max(hi, p.x + v2.x * Math.cos(p.angle) - v2.y * Math.sin(p.angle))
				}
			}
			return hi
		}
		const cross = (X: number) => {
			const fr = R.track.frames
			for (let k = 1; k < fr.length; k++) {
				const a = front(k - 1)
				const b = front(k)
				if (b >= X && a < X) return fr[k - 1]!.t + ((X - a) * (fr[k]!.t - fr[k - 1]!.t)) / (b - a)
			}
			return NaN
		}
		const t0 = cross(2)
		const t1 = cross(6)
		check(`${v} m/s: stopwatch vs the track's crossings`, R.end("sw", "seconds"), t1 - t0, 0.002, " s")
		check(`${v} m/s: 4 m over the time = its mean speed from the track`, 4 / (R.end("sw", "seconds") ?? 1), 4 / (t1 - t0), 0.002, " m/s")
		// the gate: the car's speed as it passes (the middle's, over the 10 frames around the moment the gate saw it), against length / blocked time
		const tm = ((R.end("gate", "entered_s") ?? 0) + (R.end("gate", "exit_s") ?? 0)) / 2
		const k = R.track.frames.findIndex((f) => f.t >= tm)
		const mid = (j: number) => sol.reduce((s2, q) => s2 + R.track.frames[j]!.placements[q.id]!.x, 0) / sol.length
		const vt = (mid(k + 5) - mid(k - 5)) / (R.track.frames[k + 5]!.t - R.track.frames[k - 5]!.t)
		check(`${v} m/s: the gate's length / blocked time vs the car's speed`, R.end("gate", "speed"), vt, 0.005 * vt, " m/s")
	}
	console.log("speed gate: a golf ball falling through a beam: its diameter over the time from its bottom reaching the beam to its top leaving it, from the 480 Hz track, and v = √(2g·drop of its middle)")
	for (const h of [0.2, 0.5, 1.0]) {
		const Y = 0.25
		const R = run(scene([
			{ id: "ball", type: "golf-ball", x: 1.0, y: Y + h + 0.03, held: true },
			{ id: "gate", type: "speed-gate", x: 1.0, y: 0, props: { watch: "ball", beam_height: Y } }
		], { seconds: 1.5 }), 480)
		const r = 0.02135
		const ys = R.track.frames.map((f) => [f.t, f.placements["ball/ball"]!.y] as const)
		const cross = (lv: number) => {
			for (let k = 1; k < ys.length; k++) if (ys[k]![1] <= lv && ys[k - 1]![1] > lv) return ys[k - 1]![0] + ((lv - ys[k - 1]![1]) * (ys[k]![0] - ys[k - 1]![0])) / (ys[k]![1] - ys[k - 1]![1])
			return NaN
		}
		const vt = (2 * r) / (cross(Y - r) - cross(Y + r))
		check(`dropped ${h} m (its middle ${h + 0.03} m to the beam): the gate's chord / blocked time vs the track's`, R.end("gate", "speed"), vt, 0.001 * vt, " m/s")
		// (the mean speed over the blocked time is the speed as its middle crosses the beam; the air takes off up to 0.6 % over 1 m)
		check(`  and against √(2g·${h + 0.03} m)`, R.end("gate", "speed"), Math.sqrt(2 * G * (h + 0.03)), 0.008 * Math.sqrt(2 * G * (h + 0.03)), " m/s")
	}
}

// ---------------------------------------------------------------- spring scale
function spring() {
	console.log("spring scale: hung loads read their weight m·g (Hooke: k = range / 0.10 m; the hook zeroed)")
	for (const [range, type, props, m] of [["20 N", "steel-weight-1kg", {}, 1.0], ["5 N", "gram-mass", { grams: "100 g" }, 0.1], ["5 N", "apple", {}, 0.182], ["50 N", "steel-weight-5kg", {}, 5.0]] as const) {
		const R = run(scene([
			{ id: "nm", type: "spring-scale", x: 1.2, y: 1.6, props: { range, hook: "load" } },
			{ id: "load", type, x: 1.2, y: 0.9, props }
		], { seconds: 5 }))
		check(`${range} scale, ${type} (${m} kg)`, R.end("nm", "newtons"), m * G, Math.max(0.01, 0.003 * m * G), " N")
		claim(`  in its range (over 0)`, R.end("nm", "over") === 0)
	}
	// past its range the hook bottoms out at the end of the tube, 5 mm past full scale (it reads about 1.05 × its range and says over), never
	// stretched four times its travel
	const O = run(scene([{ id: "nm", type: "spring-scale", x: 1.2, y: 1.6, props: { range: "2.5 N", hook: "load" } }, { id: "load", type: "steel-weight-1kg", x: 1.2, y: 0.9 }], { seconds: 5 }))
	claim("1 kg on a 2.5 N scale: over 1", O.end("nm", "over") === 1, `${O.end("nm", "newtons")?.toFixed(3)} N`)
	check("  its spring stretched to the end of its travel (full scale 10 cm + the hook's own 4.7 mm + 5 mm), not 40 cm", O.end("nm", "stretch"), 0.1 + (0.012 * G) / 25 + 0.005, 0.0015, " m")
	check("  so it reads about 1.05 × its range", O.end("nm", "newtons"), 2.5 * 1.05, 0.04, " N")
	// a scale shows weight: on the Moon (g = 1.62 m/s², NASA Moon fact sheet) 1 kg pulls 1.62 N; its grams, worked out with the Earth's 9.81
	// (it is calibrated on Earth), read 1000 × 1.62 / 9.81 = 165.1 g
	const M = run(scene([{ id: "nm", type: "spring-scale", x: 1.2, y: 1.6, props: { range: "20 N", hook: "load" } }, { id: "load", type: "steel-weight-1kg", x: 1.2, y: 0.9 }], { seconds: 6, settings: { gravity: "moon", air: false } }))
	check("1 kg on the Moon: newtons", M.end("nm", "newtons"), 1.62, 0.01, " N")
	check("1 kg on the Moon: grams (a scale calibrated on Earth)", M.end("nm", "grams"), (1000 * 1.62) / G, 1, " g")
}

// ---------------------------------------------------------------- kitchen scale
function scale() {
	console.log("kitchen scale: what rests on its platform, directly or stacked, reads its mass in grams (NIST HB44: d = 1 g)")
	const R = run(scene([
		{ id: "k", type: "kitchen-scale", x: 1.0, y: 0 },
		{ id: "a", type: "gram-mass", x: 1.0, y: 0.026, props: { grams: "200 g" } },
		{ id: "b", type: "gram-mass", x: 1.0, y: 0.0663, props: { grams: "100 g" } },
		{ id: "k2", type: "kitchen-scale", x: 2.0, y: 0, props: { tare: true } },
		{ id: "c", type: "gram-mass", x: 2.0, y: 0.026, props: { grams: "1 kg" } },
		{ id: "k3", type: "kitchen-scale", x: 0.2, y: 0, props: { style: "mechanical" } },
		{ id: "d", type: "steel-weight-1kg", x: 0.2, y: 0.17 }
	], { seconds: 3 }))
	check("200 g + 100 g stacked", R.end("k", "grams"), 300, 1, " g")
	check("1 kg set on a tared scale (it tares what was on it at the start)", R.end("k2", "grams"), 0, 1, " g")
	check("1 kg dropped 5 cm onto the dial scale, at rest", R.end("k3", "grams"), 1000, 1, " g")
	const R2 = run(scene([{ id: "k", type: "kitchen-scale", x: 1.0, y: 0 }, { id: "c", type: "clay-ball", x: 1.0, y: 0.06 }], { seconds: 3 }))
	const clay = R2.resolved["c"]!["mass"] as number
	check("a clay ball (mass conservation demos read the same grams)", R2.end("k", "grams"), clay * 1000, 1, " g")
	check("200 g + 100 g stacked, at 0 s (before the release: what was set on it reads from the start)", R.track.state?.["k"]?.["grams"]?.[0], 300, 1, " g")
	check("  the tared one at 0 s", R.track.state?.["k2"]?.["grams"]?.[0], 0, 1, " g")
	// a kitchen scale shows weight: calibrated on Earth (9.81), 1 kg on the Moon (1.62 m/s²) reads 165 g; on Mars (3.71) 378 g
	for (const [world, g] of [["moon", 1.62], ["mars", 3.71]] as const) {
		const W = run(scene([{ id: "k", type: "kitchen-scale", x: 1.0, y: 0 }, { id: "c", type: "gram-mass", x: 1.0, y: 0.026, props: { grams: "1 kg" } }], { seconds: 3, settings: { gravity: world, air: false } }))
		check(`1 kg on the ${world === "moon" ? "Moon" : "Mars"} (g ${g}): it reads 1000 × ${g} / 9.81`, W.end("k", "grams"), (1000 * g) / G, 1, " g")
	}
	// a run that ends at its release: nothing weighed yet, every reading still there (0 g)
	const R5 = run(scene([{ id: "k", type: "kitchen-scale", x: 1.0, y: 0 }, { id: "c", type: "clay-ball", x: 1.0, y: 0.06 }], { seconds: 0.5 }))
	claim("a run that ends at the release: the scale reads 0 g in every frame", (R5.track.state?.["k"]?.["grams"] ?? [NaN]).every((v) => v === 0), `${R5.track.state?.["k"]?.["grams"]?.length} frames`)
	// Tare with a bowl on it, then something dropped into the bowl after the release (a mass-conservation lesson: an egg smashing in a bowl on a
	// tared scale reads the egg's mass, NIST HB44 d = 1 g; here within 0.5 g): the tare is the bowl's weight at the release, never the landing.
	if (!sim.catalog().types.some((t) => t.key === "bowl")) {
		console.log("  (no bowl type in this catalog: the tared-bowl drops are left out)")
		return
	}
	const drops: [string, Record<string, unknown>][] = [["clay-ball", {}], ["gram-mass", { grams: "200 g" }]]
	if (sim.catalog().types.some((t) => t.key === "raw-egg")) drops.push(["raw-egg", {}])
	for (const [type, props] of drops) {
		for (const h of [0.05, 0.25, 0.5, 1.0]) {
			const fall = Math.sqrt((2 * h) / G)
			const R3 = run(scene([
				{ id: "k", type: "kitchen-scale", x: 1.6, y: 0, props: { tare: true } },
				{ id: "bowl", type: "bowl", x: 1.6, y: 0.0275 },
				{ id: "m", type, x: 1.6, y: 0.0275 + 0.03 + h, held: true, props },
				{ id: "k0", type: "kitchen-scale", x: 0.6, y: 0 },
				{ id: "bowl0", type: "bowl", x: 0.6, y: 0.0275 },
				{ id: "m0", type, x: 0.6, y: 0.0275 + 0.03 + h, held: true, props }
			], { seconds: 0.5 + fall + 2.5 }))
			const m = itemGrams(R3.doc, R3.resolved, "m")
			const bowl = itemGrams(R3.doc, R3.resolved, "bowl")
			check(`tared scale + bowl, ${type} (${m.toFixed(1)} g) dropped ${h * 100} cm into the bowl`, R3.end("k", "grams"), m, 0.5, " g")
			check(`  the same, not tared: bowl (${bowl.toFixed(1)} g) + ${type}`, R3.end("k0", "grams"), bowl + m, 0.5, " g")
			// from the start of the run until the drop lands the tared scale reads 0 and the other the bowl (no settling swing, no filter ramp)
			const gr = R3.track.state?.["k"]?.["grams"] ?? []
			const gr0 = R3.track.state?.["k0"]?.["grams"] ?? []
			let worst = 0
			let worst0 = 0
			R3.track.frames.forEach((f, i) => {
				if (f.t >= 0.5 + fall - 0.02) return
				worst = Math.max(worst, Math.abs(gr[i] ?? NaN))
				worst0 = Math.max(worst0, Math.abs((gr0[i] ?? NaN) - bowl))
			})
			check(`  tared, from 0 s until it lands (${(0.5 + fall - 0.02).toFixed(2)} s): the largest reading`, worst, 0, 0.5, " g")
			check(`  not tared, from 0 s until it lands: the largest miss of the bowl's grams`, worst0, 0, 0.5, " g")
		}
	}
	if (!sim.catalog().types.some((t) => t.key === "raw-egg")) return
	// the lesson itself: a raw egg dropped 50 cm smashes in the bowl; its shells and spill lie in the bowl, and the tared scale still reads its mass
	const R4 = run(scene([
		{ id: "k", type: "kitchen-scale", x: 1.6, y: 0, props: { tare: true } },
		{ id: "bowl", type: "bowl", x: 1.6, y: 0.0275 },
		{ id: "egg", type: "raw-egg", x: 1.6, y: 0.615, held: true },
		{ id: "k0", type: "kitchen-scale", x: 1.0, y: 0 },
		{ id: "egg0", type: "raw-egg", x: 1.0, y: 0.05131 }
	], { seconds: 4 }))
	claim("an egg dropped 50 cm into the bowl smashes", (R4.end("egg", "broken") ?? 0) >= 1, `broken ${R4.end("egg", "broken")}`)
	check("  the tared scale under the bowl, after the smash: the egg's mass (mass is conserved)", R4.end("k", "grams"), itemGrams(R4.doc, R4.resolved, "egg"), 0.5, " g")
	check("  a whole egg on its own scale", R4.end("k0", "grams"), itemGrams(R4.doc, R4.resolved, "egg0"), 0.5, " g")
}

// ---------------------------------------------------------------- pan balance
function balance() {
	console.log("pan balance: it tips toward the larger mass (whatever its size) and settles level with equal masses")
	const pans = (l: string, r: string) =>
		run(scene([
			{ id: "bal", type: "pan-balance", x: 1.3, y: 0 },
			{ id: "L", type: "gram-mass", x: 1.3 - 0.14, y: 0.13, props: { grams: l } },
			{ id: "R", type: "gram-mass", x: 1.3 + 0.14, y: 0.13, props: { grams: r } }
		], { seconds: 6 }))
	const a = pans("100 g", "50 g")
	claim("100 g left vs 50 g right: heavier = left (-1)", a.end("bal", "heavier") === -1, `tilt ${a.end("bal", "tilt")?.toFixed(2)}°`)
	const b = pans("20 g", "200 g")
	claim("20 g left vs 200 g right: heavier = right (1)", b.end("bal", "heavier") === 1, `tilt ${b.end("bal", "tilt")?.toFixed(2)}°`)
	const c = pans("100 g", "100 g")
	claim("100 g each: level (|tilt| < 0.5°)", c.end("bal", "heavier") === 0, `tilt ${c.end("bal", "tilt")?.toFixed(3)}°`)
	check("  the left pan holds 100 g", c.end("bal", "left_g"), 100, 0.01, " g")
	// it comes back level: equal masses, one dropped 5 cm into its pan (the other set in), knock the beam; it settles within ±0.5° in about 5 s
	// (a beam with its centre of mass under its pivot: the gravity bob), and never sleeps tipped (planck's sleep froze it at its stop before)
	const at = (R: ReturnType<typeof run>, key: string, t: number) => {
		const k = R.track.frames.findIndex((f) => f.t >= t - 1e-9)
		const v = R.track.state?.["bal"]?.[key] ?? []
		return v[k < 0 ? v.length - 1 : k] as number
	}
	const knock = (hl: number, hr: number, extra: Record<string, unknown> = {}) =>
		run(scene([
			{ id: "bal", type: "pan-balance", x: 1.3, y: 0 },
			{ id: "L", type: "gram-mass", x: 1.3 - 0.14, y: hl, props: { grams: "100 g" } },
			{ id: "R", type: "gram-mass", x: 1.3 + 0.14, y: hr, props: { grams: "100 g" } }
		], { seconds: 12, ...extra }))
	const k = knock(0.13, 0.18)
	const tilts = [5, 6, 8, 10, 12].map((t) => at(k, "tilt", t))
	claim("100 g each, one dropped 5 cm: within ±0.5° from 5 s on", tilts.every((v) => Math.abs(v) <= 0.5), tilts.map((v) => v.toFixed(2)).join(", "))
	// its swing period: the time between the first two up-crossings of the mean after the knock (a school balance: a few seconds)
	const tr = k.track.frames.map((f, i) => [f.t, (k.track.state?.["bal"]?.["tilt"] ?? [])[i] as number] as const).filter(([t]) => t > 0.6)
	const ups = tr.filter(([, v], i) => i > 0 && tr[i - 1]![1] < 0 && v >= 0).map(([t]) => t)
	const period = ups.length >= 2 ? ups[1]! - ups[0]! : NaN
	claim("  its swing period is a few seconds (1.5-6 s)", period >= 1.5 && period <= 6, `${period.toFixed(2)} s`)
	const d = knock(0.3, 0.3)
	check("100 g each dropped from 30 cm (they fall past the beam into the pans): the left pan holds", d.end("bal", "left_g"), 100, 0.01, " g")
	check("  and it ends level", d.end("bal", "tilt"), 0, 0.5, "°")
	// a gram's difference tips it 1.5° (its 15° stop at 10 g), on the Moon too: both pans feel the same g (a balance compares masses), and the
	// beam is never left asleep however slowly it starts to turn
	const one = (extra: Record<string, unknown>) => run(scene([
		{ id: "bal", type: "pan-balance", x: 1.3, y: 0 },
		{ id: "L", type: "gram-mass", x: 1.3 - 0.14, y: 0.13, props: { grams: "1 g" } },
		{ id: "R", type: "gram-mass", x: 1.3 + 0.14, y: 0.13, props: { grams: "2 g" } }
	], { seconds: 20, ...extra }))
	const e = one({})
	const m = one({ settings: { gravity: "moon", air: false } })
	check("1 g vs 2 g on Earth: it tips 1.5° to the right (1.5° a gram)", e.end("bal", "tilt"), 1.5, 0.2, "°")
	check("1 g vs 2 g on the Moon: the same tilt (a balance compares masses)", m.end("bal", "tilt"), e.end("bal", "tilt") ?? NaN, 0.1, "°")
	claim("  heavier right on the Moon", m.end("bal", "heavier") === 1)
}

// ---------------------------------------------------------------- protractor, tape, motion sensor
function angle() {
	console.log("protractor: a ramp's slope; a pendulum's pull-back and swing")
	for (const deg of [12, 30]) {
		const R = run(scene([{ id: "ramp", type: "plank", x: 1.3, y: 0.4, angle: deg }, { id: "p", type: "protractor", x: 0.8, y: 0.1, props: { watch: "ramp" } }], { seconds: 1 }))
		check(`plank at ${deg}°`, R.end("p", "degrees"), deg, 0.05, "°")
	}
	const R = run(scene([{ id: "pend", type: "pendulum", x: 1.3, y: 0.8, props: { start_angle: 30, length: 0.5 } }, { id: "p", type: "protractor", x: 1.3, y: 0.8, props: { watch: "pend" } }], { seconds: 3, release: 0 }))
	check("pendulum let go at 30°: its swing (half its whole sweep)", R.end("p", "swing"), 30, 0.3, "°")
}
function tape() {
	console.log("measuring tape: a block's front edge where it rests (its x + half its width), from the tape's zero; it reads only along itself")
	for (const x of [0.4, 1.73, 2.9]) {
		const R = run(scene([{ id: "blk", type: "wooden-block", x, y: 0 }, { id: "t", type: "measuring-tape", x: 0.1, y: 0, props: { length: 3, watch: "blk" } }], { seconds: 1 }))
		check(`block at x = ${x}`, R.end("t", "meters"), x + 0.05 - 0.1, 0.001, " m")
		claim("  on the tape (past_end 0)", R.end("t", "past_end") === 0)
	}
	const P = run(scene([{ id: "blk", type: "wooden-block", x: 2.9, y: 0 }, { id: "t", type: "measuring-tape", x: 0.1, y: 0, props: { length: 0.5, watch: "blk" } }], { seconds: 1 }))
	check("a block 2.85 m along a 0.5 m tape: it reads its full length", P.end("t", "meters"), 0.5, 1e-9, " m")
	claim("  and says past its end", P.end("t", "past_end") === 1)
}
function sensor() {
	console.log("motion sensor: the distance to a wall in front of it (0.15-6 m)")
	for (const d of [0.5, 1.5, 3.0]) {
		const R = run(scene([{ id: "wall", type: "wall", x: 0.0 + d + 0.025, y: 0 }, { id: "m", type: "motion-sensor", x: 0, y: 0.3 }], { seconds: 0.5, stage: { x0: -1, x1: 4, y0: -0.2, y1: 2 } }))
		check(`wall face ${d} m away`, R.end("m", "distance"), d, 0.0005, " m")
	}
}

// ---------------------------------------------------------------- the lessons' numbers (MO-37): 10 m in 3 s vs 4 s; 10 m vs 8 m in 3 s
function lesson() {
	console.log("MO-37: red 10 m in 3 s, blue 10 m in 4 s; then both stopped at 3 s: red 10 m, blue 8 m (±0.1 s / ±5 cm; motor cars at speed × 1.016 for the tyre slip)")
	const startSpeed = has("motor-car", "start_speed")
	const car = (id: string, y: number, v: number) => ({ id, type: "motor-car", x: startSpeed ? -0.1 : -1.1, y, held: true, props: { speed: Number((v * 1.016).toFixed(4)), push: 6, ...(startSpeed ? { start_speed: Number((v * 1.016).toFixed(4)) } : {}) } })
	const lanes = [{ id: "top", type: "lane", x: 0, y: 0.82, props: { margin: 1.6, length: 10 } }, { id: "bottom", type: "lane", x: 0, y: 0.02, props: { margin: 1.6, length: 10 } }]
	const sw = (id: string, watch: string, lane: string, extra: Record<string, unknown> = {}) => ({ id, type: "stopwatch", x: 10, y: lane === "top" ? 1.4 : 0.6, props: { watch, finish_line: lane, ...(startSpeed ? {} : { start: "crosses", start_line: lane }), ...extra } })
	console.log(`  (the cars ${startSpeed ? "start at their speed at the release (start_speed)" : "start 1 m before the 0 m line and are timed from it (no start_speed in this catalog)"})`)
	const A = run(scene([...lanes, car("red", 0.82, 10 / 3), car("blue", 0.02, 2.5), sw("swr", "red", "top"), sw("swb", "blue", "bottom")], { seconds: 6, stage: { x0: -2, x1: 13, y0: -0.3, y1: 2.2 } }))
	check("red: 10 m reads 3.00 s", A.end("swr", "seconds"), 3.0, 0.1, " s")
	check("blue: 10 m reads 4.00 s", A.end("swb", "seconds"), 4.0, 0.1, " s")
	check("red: 10 m reads 3.00 s (lesson precision ±0.03)", A.end("swr", "seconds"), 3.0, 0.03, " s")
	check("blue: 10 m reads 4.00 s (lesson precision ±0.03)", A.end("swb", "seconds"), 4.0, 0.03, " s")
	const B = run(scene([...lanes, car("red", 0.82, 10 / 3), car("blue", 0.02, 8 / 3), sw("swr", "red", "top", { stop: "at", stop_at: 3 }), sw("swb", "blue", "bottom", { stop: "at", stop_at: 3 })], { seconds: 6, stage: { x0: -2, x1: 13, y0: -0.3, y1: 2.2 } }))
	check("red: 3 s covers 10 m", B.end("swr", "meters"), 10, 0.05, " m")
	check("blue: 3 s covers 8 m", B.end("swb", "meters"), 8, 0.05, " m")
	check("both stopwatches read 3.00 s", B.end("swb", "seconds"), 3.0, 0.001, " s")
	// the lane's foam bumper: the red car, still driving at 3.39 m/s after its finish, stops on its raised lane (it drove off its end before)
	const C = run(scene([...lanes, car("red", 0.82, 10 / 3), sw("swr", "red", "top")], { seconds: 6, stage: { x0: -2, x1: 13, y0: -0.3, y1: 2.2 } }))
	const fl = C.doc.solids.find((q) => q.id === "top/floor")!
	const end = Math.max(...C.doc.solids.filter((q) => q.item === "red" && q.kind === "dynamic").map((q) => C.track.frames.at(-1)!.placements[q.id]!.x))
	const lowest = Math.min(...C.track.frames.flatMap((f) => C.doc.solids.filter((q) => q.item === "red" && q.kind === "dynamic").map((q) => f.placements[q.id]!.y)))
	claim("the red car ends on its lane, stopped by the bumper (its parts end short of the floor's end, never below the lane)", end < fl.at.x + fl.body.width / 2 && lowest > 0.82 - 0.01, `x ${end.toFixed(2)} (floor ends ${(fl.at.x + fl.body.width / 2).toFixed(2)}), lowest y ${lowest.toFixed(3)}`)
	check("  its stopwatch still reads 3.00 s", C.end("swr", "seconds"), 3.0, 0.03, " s")
}

// ---------------------------------------------------------------- the stopwatch's rules: stops, hits, reaction, never, lesson clock
function rules() {
	console.log("stopwatch rules: stops (comes to rest), a person's reaction delay, never, the time-lapse clock; determinism")
	const R = run(scene([
		{ id: "ramp", type: "plank", x: 0.6, y: 0.2, angle: -30, props: { legs: false } },
		{ id: "car", type: "wooden-block", x: 0.38, y: 0.35, angle: -30, held: true },
		{ id: "sw", type: "stopwatch", x: 2, y: 1, props: { watch: "car", start: "release", stop: "stops" } },
		{ id: "sw2", type: "stopwatch", x: 2, y: 1.5, props: { watch: "car", start: "release", stop: "never" } }
	], { seconds: 8 }))
	// when the car last moved more than 1 mm from where it ends: the stop must be there (±a frame)
	const sol = R.doc.solids.filter((q) => q.item === "car" && q.kind === "dynamic")
	const fr = R.track.frames
	// (a wooden block sliding down a 30° plank onto the table, where friction stops it)
	const last = fr.length - 1
	let tRest = 0
	for (let k = last; k > 0; k--) {
		const d = Math.max(...sol.map((q) => Math.hypot(fr[k]!.placements[q.id]!.x - fr[last]!.placements[q.id]!.x, fr[k]!.placements[q.id]!.y - fr[last]!.placements[q.id]!.y)))
		if (d > 0.001) {
			tRest = fr[k]!.t
			break
		}
	}
	const stop = R.end("sw", "stop_s")
	claim("stops: the stop is where the block last moved 1 mm (±10 ms)", stop !== null && Math.abs(stop - tRest) < 0.01, `stop ${stop?.toFixed(3)} s, rest ${tRest.toFixed(3)} s`)
	check("never: still counting at the end", R.end("sw2", "seconds"), 8 - 0.5, 0.005, " s")
	const S = (reaction: number) => scene([
		{ id: "ball", type: "steel-ball", x: 1, y: 1.0127, held: true },
		{ id: "sw", type: "stopwatch", x: 2, y: 1, props: { watch: "ball", start: "release", stop: "hits", reaction_s: reaction } }
	], { seconds: 1.5 })
	const r0 = run(S(0)).end("sw", "seconds") ?? 0
	check("a 0.2 s hand reaction adds 0.2 s to a release-to-hit time", run(S(0.2)).end("sw", "seconds"), r0 + 0.2, 0.0025, " s")
	const L = run(scene([{ id: "ball", type: "steel-ball", x: 1, y: 0.5, held: true }, { id: "sw", type: "stopwatch", x: 2, y: 1, props: { watch: "ball", stop: "never", counts: "lesson" } }], { seconds: 2, settings: { time_lapse: 600 } }))
	check("lesson clock: 1.5 run seconds × 600 = 900 lesson seconds", L.end("sw", "lesson_s"), 900, 1, " s")
	// with nothing to watch: started by the release and stopped after set seconds (or never) it is a clock; anything else reads 0 (and the
	// layout's warnings say why)
	const K = run(scene([{ id: "c1", type: "stopwatch", x: 1, y: 1, props: { stop: "at", stop_at: 2 } }, { id: "c2", type: "stopwatch", x: 1, y: 1, props: { stop: "never", watch: "c2" } },
		{ id: "c3", type: "stopwatch", x: 1, y: 1, props: { watch: "no-such-car" } }], { seconds: 3 }))
	check("a clock stopped after 2 s", K.end("c1", "seconds"), 2, 1e-9, " s")
	check("a clock that never stops (its watch names itself)", K.end("c2", "seconds"), 2.5, 1e-9, " s")
	check("a watch naming nothing that must see a crossing reads 0", K.end("c3", "seconds"), 0, 1e-9, " s")
	const W = (sim as unknown as { layout: (s: unknown) => { warnings: { items: string[]; text: string }[] } }).layout(scene([{ id: "c3", type: "stopwatch", x: 1, y: 1, props: { watch: "no-such-car" } }])).warnings
	claim("  the layout's warnings name it", W.some((w) => w.items[0] === "c3" && /no-such-car/.test(w.text)), W.map((w) => w.text).join("; "))
	const a = JSON.stringify(run(S(0)).track)
	const b = JSON.stringify(run(S(0)).track)
	claim("deterministic: the same scene twice, the same track", a === b)
}

// ---------------------------------------------------------------- crash fuzz: random instrument scenes stay finite
function fuzz() {
	const N = Number(process.env.FUZZ_N ?? 120)
	console.log(`fuzz: ${N} random scenes of every measure type (props anywhere in range, links anywhere), every reading finite`)
	let seed = 20261019
	const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
	const types = sim.catalog().types.filter((t) => (t as unknown as { module?: string }).module === "measure") as unknown as { key: string; props: { key: string; kind: string; min?: number; max?: number; choices?: string[] }[]; links?: { key: string }[] }[]
	let bad = 0
	let readings = 0
	for (let n = 0; n < N; n++) {
		const items: Record<string, unknown>[] = [{ id: "car", type: "motor-car", x: rnd() * 3, y: 0, props: { speed: 0.2 + rnd() * 6 } }, { id: "ball", type: "golf-ball", x: rnd() * 3, y: rnd() * 2 }]
		for (let k = 0; k < 6; k++) {
			const t = types[Math.floor(rnd() * types.length)]!
			const props: Record<string, unknown> = {}
			for (const p of t.props) {
				if (rnd() < 0.5) continue
				if (p.kind === "bool") props[p.key] = rnd() < 0.5
				else if (p.kind === "choice") props[p.key] = p.choices![Math.floor(rnd() * p.choices!.length)]
				else if (p.kind === "number" || p.kind === "int") props[p.key] = (p.min ?? 0) + rnd() * ((p.max ?? 1) - (p.min ?? 0))
			}
			for (const l of t.links ?? []) props[l.key] = ["car", "ball", `m${(k + 1) % 6}`][Math.floor(rnd() * 3)]
			items.push({ id: `m${k}`, type: t.key, x: rnd() * 12 - 1, y: rnd() * 2, angle: rnd() < 0.2 ? rnd() * 360 : 0, props })
		}
		try {
			const R = run(scene(items, { seconds: 1 + rnd() * 3 }))
			for (const [, keys] of Object.entries(R.track.state ?? {}))
				for (const [, v] of Object.entries(keys)) {
					readings++
					if (!v.every((x) => Number.isFinite(x))) bad++
				}
		} catch (e) {
			bad++
			console.log(`  scene ${n}: ${(e as Error).message.split("\n")[0]}`)
		}
	}
	claim(`${N} scenes: no exception, ${readings} readings all finite`, bad === 0, `${bad} bad`)
}

const which = process.argv[2] ?? "all"
const all: Record<string, () => void> = { time, roll, gate, spring, scale, balance, angle, tape, sensor, lesson, rules, fuzz }
for (const [k, f] of Object.entries(all)) if (which === "all" || which === k) f()
console.log(`\n${checks - failures} of ${checks} checks pass${failures ? `; ${failures} FAIL` : ": ALL PASS"}`)
process.exit(failures ? 1 : 0)
