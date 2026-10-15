// Polygon bodies: validation of tooling/src/sim/physics.ts's {kind: "polygon"} solids against the slab they
// generalize and against analytic rigid-body physics. Every test runs at 480 Hz with every step kept. Run:
//   node --no-warnings research/rw-validate-poly.ts [same|reject|wedge|hexagon|square|egg|all]
import { admitDocument } from "/Users/ramsarma/Downloads/science-map-share/blender-playground/tooling/src/sim/document.ts"
import { mass, polygonArea, polygonCentroid } from "/Users/ramsarma/Downloads/science-map-share/blender-playground/tooling/src/sim/part.ts"
import { simulate } from "/Users/ramsarma/Downloads/science-map-share/blender-playground/tooling/src/sim/physics.ts"

const G = 9.81
const STEP = 1 / 480
const D2R = Math.PI / 180
/** The gap Box2D keeps between two polygons at rest (2 × its 1 mm skin less its 0.5 mm slop), m. */
const REST_GAP = 0.0015
type V = { x: number; y: number }
type P = { x: number; y: number; angle: number }
const s = (o: Record<string, unknown>) => ({ placeholder: { fill: "#888" }, render: { kind: "procedural", shade: "#666" }, depth: 1, ...o })
const contact = (a: string, b: string, friction: number, restitution = 0, extra: Record<string, number> = {}) => ({
	between: [a, b],
	friction,
	restitution,
	rollingResistance: 0,
	...extra
})
const doc = (o: { contacts?: unknown[]; solids: unknown[]; joints?: unknown[]; seconds: number }) => ({
	version: 1,
	id: "poly",
	camera: { canvas: { width: 10, height: 10 }, origin: { x: 0, y: 0 }, pixel: { x: 0, y: 0 }, pixelsPerMeter: 1 },
	animated: [],
	organic: [],
	release: { parts: [], at: 0 },
	sprites: {},
	materials: { wood: { density: 700 }, steel: { density: 7850 }, rubber: { density: 1100 } },
	contacts: [],
	...o
})
const track = (d: unknown) => simulate(admitDocument(d).scene, 480)
const run = (d: unknown) => track(d).frames.map((f) => f.placements as Record<string, P>)
const pct = (got: number, want: number) => `${(((got - want) / want) * 100).toFixed(2)}%`
const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL")
let failures = 0
const check = (label: string, got: number, want: number, tol: number, unit = "") => {
	const ok = Math.abs(got - want) <= Math.abs(want) * tol
	if (!ok) failures++
	console.log(`  ${verdict(ok)} ${label}: engine ${got.toFixed(5)}${unit}, theory ${want.toFixed(5)}${unit} (${pct(got, want)}, within ${(tol * 100).toFixed(1)}%)`)
}
const near = (label: string, got: number, want: number, tol: number, unit = "") => {
	const ok = Math.abs(got - want) <= tol
	if (!ok) failures++
	console.log(`  ${verdict(ok)} ${label}: engine ${got.toFixed(5)}${unit}, theory ${want.toFixed(5)}${unit} (off ${(got - want).toExponential(2)}, within ${tol}${unit})`)
}
const claim = (label: string, ok: boolean) => {
	if (!ok) failures++
	console.log(`  ${verdict(ok)} ${label}`)
}

// ---------------------------------------------------------------- geometry
const rect = (w: number, h: number): V[] => [
	{ x: -w / 2, y: -h / 2 },
	{ x: w / 2, y: -h / 2 },
	{ x: w / 2, y: h / 2 },
	{ x: -w / 2, y: h / 2 }
]
const regular = (n: number, R: number, rot = 0): V[] =>
	Array.from({ length: n }, (_, k) => ({ x: R * Math.cos(rot + (2 * Math.PI * k) / n), y: R * Math.sin(rot + (2 * Math.PI * k) / n) }))
const rot = (p: V, a: number): V => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) })
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y
/** Polar moment of a uniform polygon lamina about its centroid, per unit mass (m²). */
const inertiaPerMass = (pts: readonly V[]) => {
	let I = 0
	for (let k = 0; k < pts.length; k++) {
		const p = pts[k]!
		const q = pts[(k + 1) % pts.length]!
		const c = p.x * q.y - q.x * p.y
		I += (c * (p.x * p.x + p.x * q.x + q.x * q.x + p.y * p.y + p.y * q.y + q.y * q.y)) / 12
	}
	const c = polygonCentroid(pts)
	return I / polygonArea(pts) - dot(c, c)
}

/**
 * A slope descending to the right at θ: a static slab whose top surface passes through the world origin.
 * `on` places a body (points in its own frame, turned by `angle`) with its lowest point `gap` above that
 * surface, `along` meters downhill from the origin.
 */
const slope = (theta: number, length = 4, material = "wood") => {
	const d = { x: Math.cos(theta), y: -Math.sin(theta) }
	const n = { x: Math.sin(theta), y: Math.cos(theta) }
	const solid = s({
		kind: "static",
		id: "slope",
		words: "slope",
		body: { kind: "slab", width: length, height: 0.05, depth: 1 },
		material,
		at: { x: (length / 2 - 0.5) * d.x - 0.025 * n.x, y: (length / 2 - 0.5) * d.y - 0.025 * n.y },
		angle: -theta
	})
	const on = (pts: readonly V[], angle: number, along: number, gap = REST_GAP): V => {
		const low = Math.min(...pts.map((p) => dot(rot(p, angle), n)))
		return { x: along * d.x + (gap - low) * n.x, y: along * d.y + (gap - low) * n.y }
	}
	return { solid, d, n, on, theta }
}

/** Quadratic least-squares fit y = c0 + c1 (t - t0) + c2 (t - t0)² over samples (t, y). */
const quadFit = (ts: readonly number[], ys: readonly number[], t0: number) => {
	const S = Array.from({ length: 5 }, () => 0)
	const B = [0, 0, 0]
	ts.forEach((t, i) => {
		const u = t - t0
		for (let p = 0; p < 5; p++) S[p]! += u ** p
		for (let p = 0; p < 3; p++) B[p]! += ys[i]! * u ** p
	})
	const M = [
		[S[0]!, S[1]!, S[2]!],
		[S[1]!, S[2]!, S[3]!],
		[S[2]!, S[3]!, S[4]!]
	]
	const det = (m: number[][]) =>
		m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
		m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
		m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
	const D = det(M)
	const c = [0, 1, 2].map((j) => det(M.map((row, i) => row.map((v, k) => (k === j ? B[i]! : v)))) / D)
	return { c0: c[0]!, c1: c[1]!, c2: c[2]!, at: (t: number) => c[0]! + c[1]! * (t - t0) + c[2]! * (t - t0) ** 2, rate: (t: number) => c[1]! + 2 * c[2]! * (t - t0) }
}

/**
 * The angular speed just before and just after the impact that ends a pivoting phase, from the angle
 * series: the step where the turn rate jumps, quadratic fits on each side (clear of the impact's own steps),
 * evaluated where the two fitted curves meet (the angle itself is continuous through an impact).
 */
const impactAt = (angle: readonly number[], k: number, prev = -Infinity, next = Infinity) => {
	const side = (from: number, to: number) => {
		const ts: number[] = []
		const ys: number[] = []
		for (let j = from; j <= to; j++) {
			ts.push(j * STEP)
			ys.push(angle[j]!)
		}
		return quadFit(ts, ys, k * STEP)
	}
	const before = side(Math.max(k - 12, prev + 3, 0), k - 2)
	const after = side(k + 3, Math.min(k + 13, next - 2, angle.length - 1))
	// where they meet, near step k
	let t = k * STEP
	for (let i = 0; i < 20; i++) {
		const f = before.at(t) - after.at(t)
		const df = before.rate(t) - after.rate(t)
		if (df === 0) break
		t -= f / df
	}
	return { t, before: before.rate(t), after: after.rate(t) }
}
/** Steps where a body's turn rate jumps by more than `jump` rad/s in one step (its impacts), strongest of each cluster. */
const jumps = (angle: readonly number[], jump: number) => {
	const w = angle.map((a, k) => (k === 0 ? 0 : (a - angle[k - 1]!) / STEP))
	const out: number[] = []
	for (let k = 2; k + 2 < w.length; k++) {
		const dw = Math.abs(w[k + 1]! - w[k]!)
		if (dw > jump && dw >= Math.abs(w[k]! - w[k - 1]!) && dw >= Math.abs(w[k + 2]! - w[k + 1]!)) {
			if (out.length && k - out.at(-1)! < 8) continue
			out.push(k)
		}
	}
	return out
}
/** The ratio of the turn rate just after to just before an impact that makes vertex B the new pivot in place of A (C the centroid). */
const pivotRatio = (A: V, B: V, C: V, Ic: number) => (Ic + dot(sub(C, B), sub(C, A))) / (Ic + dot(sub(C, B), sub(C, B)))

// ---------------------------------------------------------------- tests
const tests: Record<string, () => void> = {
	same: () => {
		// Every slab feature at once: free tumbling with restitution and sideways spring-back, a hinge to the world
		// with a welded child and a damper, a spring joint, a pin joint between two bodies, a fast thin body that
		// needs continuous collision. Run once with slabs, once with the same boxes as polygons: the tracks must
		// be identical to the last bit.
		const build = (poly: boolean) => {
			const box = (w: number, h: number, depth: number) =>
				poly ? { kind: "polygon", points: rect(w, h), depth } : { kind: "slab", width: w, height: h, depth }
			return doc({
				contacts: [
					contact("wood", "wood", 0.45, 0.5, { tangentRestitution: 0.3, grip: 0.6 }),
					contact("wood", "steel", 0.3, 0.6),
					contact("steel", "steel", 0.2, 0.4),
					contact("wood", "rubber", 0.8, 0.7, { tangentRestitution: 0.5 }),
					contact("rubber", "steel", 0.7, 0.6),
					contact("rubber", "rubber", 0.9, 0.8)
				],
				solids: [
					s({ kind: "static", id: "floor", words: "floor", body: { kind: "slab", width: 6, height: 0.1, depth: 1 }, material: "wood", at: { x: 1, y: -0.05 } }),
					s({ kind: "static", id: "wall", words: "wall", body: box(0.004, 0.6, 0.3), material: "steel", at: { x: 2.2, y: 0.3 } }),
					s({ kind: "dynamic", id: "tumbler", words: "a tumbling block", body: box(0.1, 0.06, 0.08), material: "wood", at: { x: 0, y: 0.6 }, angle: 0.4 }),
					s({ kind: "dynamic", id: "rubber", words: "a rubber block", body: box(0.05, 0.05, 0.05), material: "rubber", at: { x: 0.3, y: 0.4 }, angle: -0.7 }),
					s({ kind: "dynamic", id: "beam", words: "a hinged beam", body: box(0.5, 0.02, 0.05), material: "wood", at: { x: 0.9, y: 0.35 }, angle: 0.3, pivot: { x: -0.05, y: 0 }, damping: 0.002 }),
					s({ kind: "dynamic", id: "weight", words: "a weight welded on", body: box(0.04, 0.04, 0.04), material: "steel", at: { x: 0.23, y: 0.03 }, parent: "beam" }),
					s({ kind: "dynamic", id: "bob", words: "a block on a spring", body: box(0.06, 0.03, 0.05), material: "steel", at: { x: 1.5, y: 0.5 }, angle: 0.2 }),
					s({ kind: "dynamic", id: "arm1", words: "arm", body: box(0.2, 0.02, 0.03), material: "wood", at: { x: 1.8, y: 0.8 } }),
					s({ kind: "dynamic", id: "arm2", words: "arm", body: box(0.2, 0.02, 0.03), material: "wood", at: { x: 2.0, y: 0.8 } }),
					s({ kind: "static", id: "shelf", words: "a thin shelf", body: box(0.3, 0.004, 0.2), material: "steel", at: { x: 2.7, y: 0.3 } }),
					s({ kind: "dynamic", id: "dart", words: "a thin fast block", body: box(0.03, 0.004, 0.01), material: "steel", at: { x: 2.7, y: 1.6 }, angle: 0.05 })
				],
				joints: [
					{ kind: "spring", id: "spring", a: null, b: "bob", anchorA: { x: 1.5, y: 0.9 }, anchorB: { x: 0.02, y: 0.015 }, rest: 0.3, stiffness: 40, damping: 0.05 },
					{ kind: "pin", id: "elbow", a: "arm1", b: "arm2", anchorA: { x: 0.1, y: 0 }, anchorB: { x: -0.1, y: 0 } },
					{ kind: "rope", id: "hang", a: null, b: "arm1", anchorA: { x: 1.7, y: 1.1 }, anchorB: { x: -0.1, y: 0 }, length: 0.3 }
				],
				seconds: 3
			})
		}
		// the dart falls 1.3 m onto a 4 mm shelf: at 5 m/s it moves 10 mm a step, so only continuous collision stops it
		const a = track(build(false))
		const b = track(build(true))
		let worst = 0
		let count = 0
		for (let k = 0; k < a.frames.length; k++) {
			const fa = a.frames[k]!
			const fb = b.frames[k]!
			if (fa.t !== fb.t) worst = Math.max(worst, Number.POSITIVE_INFINITY)
			for (const id of Object.keys(fa.placements)) {
				const pa = fa.placements[id]!
				const pb = fb.placements[id]!
				worst = Math.max(worst, Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y), Math.abs(pa.angle - pb.angle))
				count++
			}
		}
		const moved = (id: string) => {
			const p0 = a.frames[0]!.placements[id]!
			const p1 = a.frames.at(-1)!.placements[id]!
			return Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.abs(p1.angle - p0.angle)
		}
		console.log(`SAME: 10 boxes as slabs, then as polygon rectangles; ${a.frames.length} steps, ${a.impacts?.length ?? 0} impacts`)
		console.log(`  every box moved: ${["tumbler", "rubber", "beam", "weight", "bob", "arm1", "arm2", "dart"].map((id) => `${id} ${moved(id).toFixed(2)}`).join(", ")}`)
		claim(`identical tracks (worst difference ${worst} over ${count} placements)`, worst === 0 && a.frames.length === b.frames.length)
		const dartEnd = (t: typeof a) => t.frames.at(-1)!.placements.dart!.y
		claim(`the dart, falling at 5 m/s onto the 4 mm shelf, stops on it (continuous collision): ends at y ${dartEnd(a).toFixed(4)} and ${dartEnd(b).toFixed(4)} m`, dartEnd(a) > 0.3 && dartEnd(b) > 0.3)
		claim(
			`identical impacts (${a.impacts?.length} and ${b.impacts?.length})`,
			JSON.stringify(a.impacts) === JSON.stringify(b.impacts) && (a.impacts?.length ?? 0) > 5
		)
	},

	reject: () => {
		console.log("REJECT: what is not a convex counterclockwise outline is refused on admission, with the reason")
		const attempt = (label: string, points: V[]) => {
			const d = doc({
				solids: [s({ kind: "dynamic", id: "thing/body", words: "thing", body: { kind: "polygon", points, depth: 0.05 }, material: "wood", at: { x: 0, y: 1 } })],
				seconds: 0.1
			})
			try {
				admitDocument(d)
				claim(`${label}: refused`, false)
			} catch (e) {
				const msg = (e as Error).message
				claim(`${label}: refused: "${msg}"`, msg.includes("thing/body"))
			}
		}
		attempt("clockwise square", [...rect(0.1, 0.1)].reverse())
		attempt("concave arrowhead", [{ x: 0, y: 0 }, { x: 0.1, y: -0.05 }, { x: 0.03, y: 0 }, { x: 0.1, y: 0.05 }])
		attempt("two points", [{ x: 0, y: 0 }, { x: 0.1, y: 0 }])
		attempt("nine points", regular(9, 0.05))
		attempt("a point on a side's line", [{ x: -0.05, y: 0 }, { x: 0, y: 0 }, { x: 0.05, y: 0 }, { x: 0, y: 0.05 }])
		attempt("a side 0.1 mm long", [{ x: 0, y: 0 }, { x: 0.05, y: 0 }, { x: 0.0501, y: 0 + 1e-4 }, { x: 0, y: 0.05 }])
		attempt("a star, all left turns, around twice", [0, 2, 4, 1, 3].map((k) => regular(5, 0.05)[k]!))
		let ok = true
		try {
			admitDocument(doc({ solids: [s({ kind: "dynamic", id: "hex", words: "hex", body: { kind: "polygon", points: regular(6, 0.05), depth: 0.05 }, material: "wood", at: { x: 0, y: 1 } })], seconds: 0.1 }))
		} catch {
			ok = false
		}
		claim("a regular hexagon is admitted", ok)
	},

	wedge: () => {
		// A right-triangle wedge, legs 20 cm (base) and 10 cm, 5 cm deep, of wood: A is its right angle.
		const A = { x: -0.1, y: -0.05 }
		const B = { x: 0.1, y: -0.05 }
		const C = { x: -0.1, y: 0.05 }
		const pts = [A, B, C]
		const depth = 0.05
		const m = 700 * 0.5 * 0.2 * 0.1 * depth
		const Gc = { x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 }
		const Ic = (0.2 ** 2 + 0.1 ** 2 + Math.hypot(0.2, 0.1) ** 2) / 36 // per unit mass: (a² + b² + c²)/36 about the centroid
		const wedge = (o: Record<string, unknown>) => s({ kind: "dynamic", id: "wedge", words: "a wooden wedge", body: { kind: "polygon", points: pts, depth }, material: "wood", ...o })
		console.log(`WEDGE right triangle 20 x 10 cm, 5 cm deep, wood: m ${m.toFixed(3)} kg, centroid (${Gc.x.toFixed(4)}, ${Gc.y.toFixed(4)}) from its box centre, Ic ${(m * Ic).toExponential(4)} kg m²`)
		const scene = admitDocument(doc({ solids: [wedge({ at: { x: 0, y: 1 } })], seconds: 0.1 })).scene
		check("the engine's mass (density x area x depth)", mass(scene.solids[0]!), m, 1e-12, " kg")
		check("polar moment about the centroid (the polygon formula vs the triangle's (a²+b²+c²)/36)", inertiaPerMass(pts), Ic, 1e-12, " m²")

		// Hung by a spring from its centroid: it stretches the spring mg/k and never turns (gravity and the spring
		// both act through its centre of mass, so if planck put the mass anywhere else it would tilt).
		const k = 50
		const top = { x: 0, y: 1.2 }
		const rest = 0.3
		const F = run(
			doc({
				solids: [wedge({ at: { x: top.x - Gc.x, y: top.y - rest - Gc.y } })],
				joints: [{ kind: "spring", id: "s", a: null, b: "wedge", anchorA: top, anchorB: Gc, rest, stiffness: k, damping: 2 * 0.3 * Math.sqrt(k * m) }],
				seconds: 4
			})
		)
		const end = F.at(-1)!.wedge!
		// its centroid where it ends, the wedge as turned as the track has it
		const cy = end.y + Gc.x * Math.sin(end.angle) + Gc.y * Math.cos(end.angle)
		const turned = Math.max(...F.map((f) => Math.abs(f.wedge!.angle)))
		check("hung from its centroid by a 50 N/m spring: stretch (mass)", top.y - rest - cy, (m * G) / k, 0.002, " m")
		// Gravity and the spring both act through its centre of mass, so it hangs as it starts: were planck's centre of mass anywhere else, it would
		// turn until that point hung under the spring's end (tens of degrees for a millimetre). The air turns it a little as it drops and bobs: it
		// presses on the flat underside it falls on, whose middle is off the centroid (physics.ts `outlineDrag`), and nothing turns it back.
		near("  ...and it hangs as it starts (centre of mass at the centroid; the air on its underside turns it under 2°)", turned, 0, 0.035, " rad")

		// Hinged at its right-angle corner: it comes to rest with its centroid straight below the hinge, and swings
		// with the period of a physical pendulum, T = 2π √(I_A / (m g d)).
		const AG = sub(Gc, A)
		const d = Math.hypot(AG.x, AG.y)
		const IA = m * (Ic + d * d)
		const rest0 = -Math.PI / 2 - Math.atan2(AG.y, AG.x) // body angle that puts the centroid below A
		const hinge = (angle: number, damping: number, seconds: number) =>
			run(
				doc({
					solids: [wedge({ at: sub({ x: 0, y: 1 }, rot(A, angle)), angle, pivot: A, ...(damping > 0 ? { damping } : {}) })],
					seconds
				})
			).map((f) => f.wedge!.angle)
		const settled = hinge(0, 0.5 * 2 * IA * Math.sqrt((m * G * d) / IA), 4).at(-1)!
		const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
		near("hinged at the right angle, damped: rest angle (centroid below the hinge)", wrap(settled) / D2R, wrap(rest0) / D2R, 0.02, "°")
		const amp = 6 * D2R
		const swing = hinge(rest0 + amp, 0, 3).map((a) => a - rest0)
		const ups: number[] = []
		for (let i = 1; i < swing.length; i++) if (swing[i - 1]! < 0 && swing[i]! >= 0) ups.push((i - 1 + swing[i - 1]! / (swing[i - 1]! - swing[i]!)) * STEP)
		const period = (ups.at(-1)! - ups[0]!) / (ups.length - 1)
		check("  ...swinging 6°: period (moment of inertia)", period, 2 * Math.PI * Math.sqrt(IA / (m * G * d)) * (1 + amp ** 2 / 16), 0.002, " s")

		// On the table it rests on its long face (the hypotenuse) at a third of that face's altitude, standing on its
		// short leg it topples over C onto the long face once tipped past atan(foot distance / height) = 45°.
		const floor = s({ kind: "static", id: "floor", words: "floor", body: { kind: "slab", width: 3, height: 0.1, depth: 1 }, material: "wood", at: { x: 0, y: -0.05 } })
		const contacts = [contact("wood", "wood", 0.45, 0)]
		const faceDown = (k: number) => {
			const p = pts[k]!
			const q = pts[(k + 1) % 3]!
			return -Math.PI / 2 - Math.atan2(-(q.x - p.x), q.y - p.y) // turns edge k's outward normal (dy, -dx) to point down
		}
		const drop = (angle: number, height: number, seconds = 2.5) => {
			const low = Math.min(...pts.map((p) => rot(p, angle).y))
			return run(doc({ contacts, solids: [floor, wedge({ at: { x: 0, y: height - low }, angle })], seconds }))
		}
		const faceOf = (f: P) => {
			let best = -1
			let bestDot = -2
			for (let k = 0; k < 3; k++) {
				const p = pts[k]!
				const q = pts[(k + 1) % 3]!
				const nrm = rot({ x: q.y - p.y, y: -(q.x - p.x) }, f.angle)
				const c = -nrm.y / Math.hypot(nrm.x, nrm.y)
				if (c > bestDot) {
					bestDot = c
					best = k
				}
			}
			return { face: best, tilt: Math.acos(Math.min(1, bestDot)) / D2R }
		}
		const names = ["AB (the 20 cm leg)", "BC (the long face)", "CA (the 10 cm leg)"]
		const hyp = Math.hypot(0.2, 0.1)
		const altitude = (2 * 0.5 * 0.2 * 0.1) / hyp
		const tumble = drop(faceDown(1) + 25 * D2R, 0.12)
		const last = tumble.at(-1)!.wedge!
		const prev = tumble.at(-49)!.wedge!
		const lie = faceOf(last)
		claim(`dropped 12 cm tilted 25° off its long face: lands, rocks and lies on ${names[lie.face]} (tilt ${lie.tilt.toFixed(3)}°)`, lie.face === 1 && lie.tilt < 0.05)
		near("  ...its centroid height: a third of the long face's altitude (+ the 1.5 mm rest gap)", last.y + rot(Gc, last.angle).y, altitude / 3 + REST_GAP, 0.0003, " m")
		near("  ...at rest (speed over its last 0.1 s)", Math.hypot(last.x - prev.x, last.y - prev.y) / (48 * STEP), 0, 0.001, " m/s")
		// standing on CA, tipped about C: the centroid passes over C at atan(|foot of G from C| / height of G over CA)
		const CA = sub(A, C)
		const along = dot(sub(Gc, C), CA) / Math.hypot(CA.x, CA.y)
		const height = Math.abs(CA.x * (Gc.y - C.y) - CA.y * (Gc.x - C.x)) / Math.hypot(CA.x, CA.y)
		const tipTheory = Math.atan2(along, height) / D2R
		const ends = (tilt: number) => faceOf(drop(faceDown(2) + tilt * D2R, REST_GAP, 2).at(-1)!.wedge!).face
		let lo = tipTheory - 5
		let hi = tipTheory + 5
		claim(`stood on its short leg tipped ${lo.toFixed(1)}° about C it falls back onto CA; ${hi.toFixed(1)}° and it topples onto the long face BC`, ends(lo) === 2 && ends(hi) === 1)
		for (let i = 0; i < 8; i++) {
			const mid = (lo + hi) / 2
			if (ends(mid) === 1) hi = mid
			else lo = mid
		}
		near("  ...the tipping angle about C", (lo + hi) / 2, tipTheory, 0.5, "°")
	},

	hexagon: () => {
		// A regular hexagon, 5 cm to each corner, 5 cm deep, of wood on a wooden slope (μ 0.9, no bounce). Resting on a
		// face it tips over its downhill corner only on slopes steeper than 180°/6 = 30°. Pivoting on a corner and
		// landing on the next, its turn rate drops to (Ic + m R² cos 60°)/(Ic + m R²) = 11/17 (angular momentum about
		// the new corner). Rolling on, each face gains m g s sinθ and each landing keeps (11/17)² of its energy.
		const R = 0.05
		const depth = 0.05
		const hex = regular(6, R, 0) // corners at 0°, 60°, ...: the face from 240° to 300° is its bottom
		const Ic = inertiaPerMass(hex)
		const r = (Ic + R * R * 0.5) / (Ic + R * R)
		console.log(`HEXAGON R ${R} m on wood, μ 0.9: Ic/m ${Ic.toExponential(4)} m² (theory 5/12 R² = ${((5 / 12) * R * R).toExponential(4)}), landing ratio 11/17 = ${r.toFixed(4)}`)
		const contacts = [contact("wood", "wood", 0.9, 0)]
		const roll = (theta: number, tilt: number, seconds: number) => {
			const sl = slope(theta * D2R, 6)
			const angle = -theta * D2R - tilt * D2R
			const at = sl.on(hex, angle, 0.3)
			const frames = run(doc({ contacts, solids: [sl.solid, s({ kind: "dynamic", id: "hex", words: "a hexagon", body: { kind: "polygon", points: hex, depth }, material: "wood", at, angle })], seconds }))
			return { frames, sl, at, angle }
		}
		const stays = (theta: number) => {
			const { frames } = roll(theta, 0, 1.5)
			const a = frames[0]!.hex!
			const b = frames.at(-1)!.hex!
			return Math.hypot(b.x - a.x, b.y - a.y) < 0.001 && Math.abs(b.angle - a.angle) < 0.01
		}
		claim("at rest on a face it stays on 20° and 29°, and rolls away on 31° and 35°", stays(20) && stays(29) && !stays(31) && !stays(35))

		// On 20°: tipped 2° past its downhill corner it pivots over it and lands on the next face.
		const tipped = roll(20, 30 - 20 + 2, 3)
		const ang = tipped.frames.map((f) => f.hex!.angle)
		const hits = jumps(ang, 1.0)
		const first = impactAt(ang, hits[0]!)
		const ideal = Math.sqrt((2 * G * R * (Math.cos(2 * D2R) - Math.cos(50 * D2R))) / (Ic + R * R))
		check("20°, tipped 2° past its corner: turn rate as it lands (energy, pivoting 48° about the corner)", -first.before, ideal, 0.03, " rad/s")
		check("  ...turn rate kept by the landing (11/17)", first.after / first.before, r, 0.015)
		const p0 = tipped.frames[0]!.hex!
		const p1 = tipped.frames.at(-1)!.hex!
		const travel = dot(sub(p1, p0), tipped.sl.d)
		claim(`  ...and it rolls on down the slope: ${travel.toFixed(2)} m and ${((p0.angle - p1.angle) / (2 * Math.PI)).toFixed(1)} turns in 3 s (${hits.length} landings)`, travel > 1 && p0.angle - p1.angle > 4 * Math.PI)

		// On 10° the rolling settles into a steady rhythm: every landing leaves it turning at
		// ω² = 2 r² m g s sinθ / ((1 - r²) I_corner), whatever it started with.
		const steady = roll(10, 30 - 10 + 2, 4)
		const ang10 = steady.frames.map((f) => f.hex!.angle)
		const landings = jumps(ang10, 0.5).map((k) => impactAt(ang10, k))
		const wss = Math.sqrt((2 * r * r * G * R * Math.sin(10 * D2R)) / ((1 - r * r) * (Ic + R * R)))
		console.log(`  10°: turn rate after each landing ${landings.map((l) => (-l.after).toFixed(3)).join(" ")} rad/s`)
		const tail = landings.slice(-4).map((l) => -l.after)
		check("10°, steady rolling: turn rate after each landing (mean of the last 4)", tail.reduce((a, b) => a + b, 0) / tail.length, wss, 0.02, " rad/s")
		// time per face at that rhythm: the centroid swings from 20° behind its corner to 40° past it,
		// T = ∫ dφ / √(ω² + 2 g R (cos φ0 − cos φ) / (Ic/m + R²))
		const f0 = -(30 - 10) * D2R
		const f1 = (30 + 10) * D2R
		const rate = (f: number) => Math.sqrt(wss * wss + ((2 * G * R) / (Ic + R * R)) * (Math.cos(f0) - Math.cos(f)))
		const N = 4000
		let T = 0
		for (let i = 0; i < N; i++) T += ((f1 - f0) / N) / rate(f0 + ((i + 0.5) * (f1 - f0)) / N)
		const gaps = landings.slice(-9).map((l, i, all) => (i ? l.t - all[i - 1]!.t : 0)).slice(1)
		console.log(`  ...seconds per face ${gaps.map((g) => g.toFixed(4)).join(" ")}`)
		// Box2D's contact skin makes it a few percent quick: a corner lands when it comes within 2 mm and is pushed
		// to the 1.5 mm rest gap, so each landing gets about 0.6° of turn for free, and the pivoting corner creeps
		// forward about 0.5 mm a face (its friction holds by velocity, not position). Slabs and balls share both.
		check("  ...seconds per face (mean of the last 8; Box2D's 2 mm skin makes it a little quick)", gaps.reduce((x, y) => x + y, 0) / gaps.length, T, 0.06, " s")
	},

	square: () => {
		// A wooden block on a slope: it stays, slides (when μ < tanθ, at a = g (sinθ − μ cosθ)), or topples over its
		// downhill edge (when tanθ > its width over its height, before it can slide).
		// Steel, so air drag (always on: 2% of a wooden 6 cm block's weight at 3 m/s) stays far below the tolerance.
		const go = (w: number, h: number, theta: number, mu: number, seconds = 1.5) => {
			const sl = slope(theta * D2R, 4)
			const pts = rect(w, h)
			const angle = -theta * D2R
			const at = sl.on(pts, angle, 0.3)
			const frames = run(
				doc({ contacts: [contact("wood", "steel", mu, 0)], solids: [sl.solid, s({ kind: "dynamic", id: "block", words: "a block", body: { kind: "polygon", points: pts, depth: 0.05 }, material: "steel", at, angle })], seconds })
			)
			const along = frames.map((f) => dot(f.block!, sl.d))
			const turned = Math.abs(frames.at(-1)!.block!.angle - angle) / D2R
			return { along, turned, moved: along.at(-1)! - along[0]! }
		}
		console.log("SQUARE / BLOCK of steel on a wooden slope (no bounce)")
		const verdictOf = (o: ReturnType<typeof go>) => (o.turned > 30 ? "topples" : o.moved > 0.005 ? "slides" : "stays")
		const cases: [number, number, number, number, string][] = [
			[0.06, 0.06, 20, 0.5, "stays"],
			[0.06, 0.06, 40, 1.2, "stays"],
			[0.06, 0.06, 30, 0.3, "slides"],
			[0.06, 0.06, 35, 0.5, "slides"],
			[0.06, 0.06, 50, 1.5, "topples"],
			[0.04, 0.08, 24, 1.0, "stays"],
			[0.04, 0.08, 29, 1.0, "topples"],
			[0.04, 0.08, 29, 0.4, "slides"]
		]
		for (const [w, h, theta, mu, want] of cases) {
			const o = go(w, h, theta, mu)
			const why = `tanθ ${Math.tan(theta * D2R).toFixed(3)} vs μ ${mu}, tip at ${(Math.atan(w / h) / D2R).toFixed(1)}°`
			claim(`${(w * 100).toFixed(0)}x${(h * 100).toFixed(0)} cm on ${theta}° with μ ${mu}: ${verdictOf(o)} (theory ${want}; ${why}; moved ${(o.moved * 1000).toFixed(1)} mm, turned ${o.turned.toFixed(1)}°)`, verdictOf(o) === want)
			if (want === "slides" && w === h) {
				const k0 = Math.round(0.1 / STEP)
				const k1 = o.along.length - 1
				const ts = Array.from({ length: k1 - k0 + 1 }, (_, i) => (k0 + i) * STEP)
				const fit = quadFit(ts, o.along.slice(k0, k1 + 1), k0 * STEP)
				check(`  ...its acceleration down the slope`, 2 * fit.c2, G * (Math.sin(theta * D2R) - mu * Math.cos(theta * D2R)), 0.01, " m/s²")
			}
		}
	},

	egg: () => {
		// An egg's side outline as 8 corners: 6 cm long, 4.4 cm wide, its blunt end at +x. Its centre of mass is off its
		// box centre toward the blunt end, and its faces differ, so it does not rock or roll evenly.
		const a = 0.03
		const b = 0.022
		const k = 0.18
		const egg = Array.from({ length: 8 }, (_, i) => {
			const t = Math.PI / 8 + (i * Math.PI) / 4
			return { x: Math.round(a * Math.cos(t) * 1e5) / 1e5, y: Math.round(b * Math.sin(t) * (1 + k * Math.cos(t)) * 1e5) / 1e5 }
		})
		const depth = 0.044
		const C = polygonCentroid(egg)
		const Ic = inertiaPerMass(egg)
		const m = 1030 * polygonArea(egg) * depth
		console.log(`EGG 8 corners ${JSON.stringify(egg)}: centroid (${(C.x * 1000).toFixed(2)}, ${(C.y * 1000).toFixed(2)}) mm, Ic/m ${Ic.toExponential(4)} m², ${(m * 1000).toFixed(1)} g`)
		const contacts = [contact("wood", "shell", 0.6, 0)]
		const materials = { wood: { density: 700 }, shell: { density: 1030 } }
		// Where its centroid stands over a corner, and that corner's moment of inertia (per unit mass)
		const lift = (corner: number, angle: number) => rot(sub(C, egg[corner]!), angle).y
		const Icorner = (corner: number) => Ic + dot(sub(C, egg[corner]!), sub(C, egg[corner]!))
		const faceDown = (i: number, theta: number) => {
			const p = egg[i]!
			const q = egg[(i + 1) % 8]!
			return -Math.PI / 2 - theta * D2R - Math.atan2(-(q.x - p.x), q.y - p.y)
		}
		/** The face it lies on (the edge whose outward normal points most nearly into the slope) and how far off flat. */
		const lying = (angle: number, theta: number) => {
			let best = 0
			let bestDot = -2
			for (let i = 0; i < 8; i++) {
				const p = egg[i]!
				const q = egg[(i + 1) % 8]!
				const nrm = rot({ x: q.y - p.y, y: -(q.x - p.x) }, angle + theta * D2R)
				const c = -nrm.y / Math.hypot(nrm.x, nrm.y)
				if (c > bestDot) {
					bestDot = c
					best = i
				}
			}
			return { face: best, off: Math.acos(Math.min(1, bestDot)) / D2R }
		}
		/** The slopes on which face i holds: its centroid's foot inside it, by the tip angles over each corner. */
		const holds = (i: number, theta: number) => {
			const p = egg[i]!
			const q = egg[(i + 1) % 8]!
			const L = Math.hypot(q.x - p.x, q.y - p.y)
			const along = dot(sub(C, p), sub(q, p)) / L
			const h = Math.abs((q.x - p.x) * (C.y - p.y) - (q.y - p.y) * (C.x - p.x)) / L
			return Math.atan2(L - along, h) / D2R > theta && Math.atan2(along, h) / D2R > -theta
		}
		const reversals = (ang: readonly number[]) => {
			const w = ang.map((v, i) => (i ? (v - ang[i - 1]!) / STEP : 0))
			let n = 0
			let sign = 0
			for (const x of w) {
				if (Math.abs(x) < 0.05) continue
				if (sign !== 0 && Math.sign(x) !== sign) n++
				sign = Math.sign(x)
			}
			return n
		}

		const place = (theta: number, angle: number, seconds: number) =>
			run({
				...doc({
					contacts,
					solids: [slope(theta * D2R, 3).solid, s({ kind: "dynamic", id: "egg", words: "an egg", body: { kind: "polygon", points: egg, depth }, material: "shell", at: slope(theta * D2R, 3).on(egg, angle, 0.3), angle })],
					seconds
				}),
				materials
			})
		/** Energy per kg along the run (its centre of mass moving and turning, and its height), and the most it ever rose. */
		const energy = (frames: Record<string, P>[]) => {
			const E = frames.map((f, i, all) => {
				const q = all[Math.max(0, i - 1)]!.egg!
				const n = all[Math.min(all.length - 1, i + 1)]!.egg!
				const dt = (Math.min(all.length - 1, i + 1) - Math.max(0, i - 1)) * STEP
				const vx = (n.x + rot(C, n.angle).x - q.x - rot(C, q.angle).x) / dt
				const vy = (n.y + rot(C, n.angle).y - q.y - rot(C, q.angle).y) / dt
				const om = (n.angle - q.angle) / dt
				return 0.5 * (vx * vx + vy * vy) + 0.5 * Ic * om * om + G * (f.egg!.y + rot(C, f.egg!.angle).y)
			})
			let gain = 0
			let low = E[0]!
			for (const e of E) {
				gain = Math.max(gain, e - low)
				low = Math.min(low, e)
			}
			return { drop: E[0]! - E.at(-1)!, gain }
		}

		// On 10° it lies on its long side, face 5 (corners 5 uphill and 6 downhill). Rocked back about corner 5 and let
		// go, it falls onto corner 6 and pivots forward on it, but (rocked back only so far that the energy it keeps is
		// well short of carrying it over corner 6) swings back onto corner 5, and so on: it wobbles, each landing keeping
		// the share of its turn rate that angular momentum about the new corner gives, each swing smaller, until it lies still.
		const theta = 10
		const rest = faceDown(5, theta)
		const r56 = pivotRatio(egg[5]!, egg[6]!, C, Ic)
		const overSix = G * (Math.hypot(C.x - egg[6]!.x, C.y - egg[6]!.y) - lift(6, rest)) // to balance on corner 6 from lying
		const kept = (psi: number) => r56 * r56 * (Icorner(6) / Icorner(5)) * G * (lift(5, rest + psi * D2R) - lift(5, rest))
		let rock = 0
		while (kept(rock + 0.1) < 0.6 * overSix) rock += 0.1
		const rocked = place(theta, rest + rock * D2R, 3)
		const ang = rocked.map((f) => f.egg!.angle)
		const extremes: number[] = [rock]
		for (let i = 2; i < ang.length; i++) {
			const w0 = ang[i - 1]! - ang[i - 2]!
			const w1 = ang[i]! - ang[i - 1]!
			if (Math.abs(w0) > 1e-7 && Math.abs(w1) > 1e-7 && Math.sign(w0) !== Math.sign(w1)) extremes.push((ang[i - 1]! - rest) / D2R)
		}
		const hits = jumps(ang, 0.3)
		console.log(`  10° slope, rocked back ${rock.toFixed(1)}° about its uphill corner: it swings ${extremes.map((x) => `${x > 0 ? "+" : ""}${x.toFixed(2)}°`).join(" → ")}, ${hits.length} landings`)
		const l1 = impactAt(ang, hits[0]!, -Infinity, hits[1] ?? Infinity)
		check("  first landing (onto corner 6, off corner 5): turn rate kept (Box2D's skin and solver, at 2 cm and a few rad/s, give a few %)", l1.after / l1.before, r56, 0.06)
		// Box2D lands a corner as it comes within 2 mm while the pivot sits at 1.5 mm, so it lands up to a degree before
		// lying flat: the swing that follows is reckoned from where it actually landed.
		const landed = ang[hits[0]!]! + (ang[hits[0]! + 1]! - ang[hits[0]!]!) * (l1.t / STEP - hits[0]!)
		const keptThere = r56 * r56 * (Icorner(6) / Icorner(5)) * G * (lift(5, rest + rock * D2R) - lift(5, landed))
		let swing = 0
		while (G * (lift(6, landed - (swing + 0.01) * D2R) - lift(6, landed)) < keptThere) swing += 0.01
		console.log(`  ...it landed on corner 6 ${((landed - rest) / D2R).toFixed(2)}° before lying flat`)
		check("  ...its swing forward on corner 6 (the energy that landing keeps)", -extremes[1]!, swing - (landed - rest) / D2R, 0.12, "°")
		claim(
			`  it wobbles: ${extremes.length - 1} swings, each smaller than the last, alternating sides, then lies still`,
			extremes.length >= 3 && extremes.every((x, i) => i === 0 || (Math.abs(x) < Math.abs(extremes[i - 1]!) && Math.sign(x) !== Math.sign(extremes[i - 1]!)))
		)
		const end = rocked.at(-1)!.egg!
		const before = rocked.at(-49)!.egg!
		near("  ...and lies still on face 5 (turn from lying flat; the corners rest anywhere in Box2D's 0.5 mm slop)", (end.angle - rest) / D2R, 0, 0.3, "°")
		near("  ...not creeping down the slope (μ 0.6 > tan 10°)", Math.hypot(end.x - before.x, end.y - before.y) / (48 * STEP), 0, 0.001, " m/s")

		// Stood on its blunt end (face 7, which tips at 20.2°) on a 5° slope and tipped 18° downhill, it topples, rocks and
		// lies still on a face that holds on 5°. On 15°, stood on its pointed end (face 3, tipping at 13.7°), it topples and
		// never stops: it tumbles end over end down the slope. Either way energy only ever leaves it.
		const fall = place(5, faceDown(7, 5) - 18 * D2R, 3)
		const lie = lying(fall.at(-1)!.egg!.angle, 5)
		const fa = fall.map((f) => f.egg!.angle)
		const fe = energy(fall)
		const still = Math.hypot(fall.at(-1)!.egg!.x - fall.at(-49)!.egg!.x, fall.at(-1)!.egg!.y - fall.at(-49)!.egg!.y) < 1e-5
		claim(
			`5°, stood on its blunt end and tipped 18°: topples, rocks (${reversals(fa)} reversals) and lies still on face ${lie.face} (${lie.off.toFixed(2)}° off flat; it ${holds(lie.face, 5) ? "holds" : "does not hold"} on 5°)`,
			reversals(fa) >= 2 && still && holds(lie.face, 5) && lie.face !== 7 && lie.off < 0.5
		)
		claim(`  energy only leaves it (worst rise ${((fe.gain / fe.drop) * 100).toFixed(2)}% of the ${(fe.drop * 1000).toFixed(1)} mJ/kg it loses)`, fe.gain < 0.02 * fe.drop)
		const tumble = place(15, faceDown(3, 15), 3)
		const ta = tumble.map((f) => f.egg!.angle)
		const te = energy(tumble)
		const travel = dot(sub(tumble.at(-1)!.egg!, tumble[0]!.egg!), slope(15 * D2R).d)
		claim(`15°, stood on its pointed end: tumbles end over end, ${((ta[0]! - ta.at(-1)!) / (2 * Math.PI)).toFixed(1)} turns and ${travel.toFixed(2)} m in 3 s`, ta[0]! - ta.at(-1)! > 4 * Math.PI && travel > 0.5)
		claim(`  energy only leaves it (worst rise ${((te.gain / te.drop) * 100).toFixed(2)}% of the ${(te.drop * 1000).toFixed(1)} mJ/kg it loses)`, te.gain < 0.02 * te.drop)
	}
}

const which = process.argv[2] ?? "all"
for (const [name, test] of Object.entries(tests)) if (which === "all" || which === name) test()
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
