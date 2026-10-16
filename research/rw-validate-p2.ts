// Phase 2 validation: joints, motors, wheels and conveyors in the 2D engine (tooling/src/sim/physics.ts)
// against analytic physics. Every test runs at 480 Hz with every step kept; bodies are dense and compact
// so air drag (always on) stays far below the tolerance. Run:
//   node --no-warnings research/rw-validate-p2.ts [spring|damped|rope|pin|car|atwood|conveyor|stiff|all]
import { Contact } from "/Users/ramsarma/Downloads/science-map-share/blender-playground/tooling/node_modules/planck/dist/planck.mjs"
import { admitDocument } from "/Users/ramsarma/Downloads/science-map-share/blender-playground/tooling/src/sim/document.ts"
import { simulate } from "/Users/ramsarma/Downloads/science-map-share/blender-playground/tooling/src/sim/physics.ts"

const G = 9.81
const STEP = 1 / 480
const D2R = Math.PI / 180
type P = { x: number; y: number; angle: number }
const s = (o: Record<string, unknown>) => ({ placeholder: { fill: "#888" }, render: { kind: "procedural", shade: "#666" }, depth: 1, ...o })
const doc = (o: { materials?: Record<string, unknown>; contacts?: unknown[]; solids: unknown[]; joints?: unknown[]; seconds: number }) => ({
	version: 1,
	id: "rw2",
	camera: { canvas: { width: 10, height: 10 }, origin: { x: 0, y: 0 }, pixel: { x: 0, y: 0 }, pixelsPerMeter: 1 },
	animated: [],
	organic: [],
	release: { parts: [], at: 0 },
	sprites: {},
	materials: { dense: { density: 20000 }, steel: { density: 7850 }, wood: { density: 700 }, rubber: { density: 1100 } },
	contacts: [],
	...o
})
const run = (d: unknown) => simulate(admitDocument(d).scene, 480).frames.map((f) => f.placements as Record<string, P>)
/** A ball of `mass` kg made of the dense material: its radius follows. */
const denseBall = (mass: number) => Math.cbrt((3 * mass) / (4 * Math.PI * 20000))
const pct = (got: number, want: number) => `${(((got - want) / want) * 100).toFixed(2)}%`
const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL")
let failures = 0
const check = (label: string, got: number, want: number, tol: number, unit = "") => {
	const ok = Math.abs(got - want) <= Math.abs(want) * tol
	if (!ok) failures++
	console.log(`  ${verdict(ok)} ${label}: engine ${got.toFixed(4)}${unit}, theory ${want.toFixed(4)}${unit} (${pct(got, want)}, within ${(tol * 100).toFixed(1)}%)`)
}
const claim = (label: string, ok: boolean) => {
	if (!ok) failures++
	console.log(`  ${verdict(ok)} ${label}`)
}
/** Steps where a series peaks, refined by a parabola through the three samples about each. */
const peaks = (y: readonly number[]) => {
	const out: { t: number; v: number }[] = []
	for (let k = 1; k + 1 < y.length; k++) {
		const a = y[k - 1]!
		const b = y[k]!
		const c = y[k + 1]!
		if (b > a && b >= c) {
			const den = a - 2 * b + c
			const off = den === 0 ? 0 : (0.5 * (a - c)) / den
			out.push({ t: (k + off) * STEP, v: b - 0.25 * (a - c) * off })
		}
	}
	return out
}
/** Upward zero crossings, linearly interpolated, in seconds. */
const crossings = (y: readonly number[]) => {
	const out: number[] = []
	for (let k = 1; k < y.length; k++) if (y[k - 1]! < 0 && y[k]! >= 0) out.push((k - 1 + y[k - 1]! / (y[k - 1]! - y[k]!)) * STEP)
	return out
}
/** Least-squares a in x = x0 + v0 t + ½ a t² over steps [k0, k1]. */
const accel = (x: readonly number[], k0: number, k1: number) => {
	const S = Array.from({ length: 5 }, () => 0)
	const B = [0, 0, 0]
	for (let k = k0; k <= k1; k++) {
		const t = (k - k0) * STEP
		for (let p = 0; p < 5; p++) S[p]! += t ** p
		for (let p = 0; p < 3; p++) B[p]! += x[k]! * t ** p
	}
	// Normal equations for [c0, c1, c2], solved by Cramer's rule.
	const M = [
		[S[0]!, S[1]!, S[2]!],
		[S[1]!, S[2]!, S[3]!],
		[S[2]!, S[3]!, S[4]!]
	]
	const det = (m: number[][]) =>
		m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
		m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
		m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
	const M2 = M.map((row, i) => [row[0]!, row[1]!, B[i]!])
	return (2 * det(M2)) / det(M)
}
const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length

/** A ball hung from a world point on a vertical spring, starting at the spring's rest length. */
const hung = (k: number, c: number, seconds: number) => {
	const m = 1
	const r = denseBall(m)
	const top = 1.2
	const rest = 0.3
	const F = run(
		doc({
			solids: [s({ kind: "dynamic", id: "bob", words: "bob", body: { kind: "ball", radius: r }, material: "dense", at: { x: 0, y: top - rest } })],
			joints: [{ kind: "spring", id: "s", a: null, b: "bob", anchorA: { x: 0, y: top }, anchorB: { x: 0, y: 0 }, rest, stiffness: k, damping: c }],
			seconds
		})
	)
	return { m, y: F.map((f) => f.bob!.y), start: top - rest }
}

const tests: Record<string, () => void> = {
	spring: () => {
		const k = 200
		const { m, y, start } = hung(k, 0, 3)
		const top = peaks(y)
		const bottom = peaks(y.map((v) => -v))
		const center = (mean(top.map((p) => p.v)) - mean(bottom.map((p) => p.v))) / 2
		const period = (top.at(-1)!.t - top[0]!.t) / (top.length - 1)
		console.log(`SPRING 1 kg on 200 N/m, hung at its rest length (omega dt ${(Math.sqrt(k / m) * STEP).toFixed(3)})`)
		check("static stretch (oscillation centre below rest)", start - center, (m * G) / k, 0.01, " m")
		check("period", period, 2 * Math.PI * Math.sqrt(m / k), 0.01, " s")
	},
	damped: () => {
		const k = 200
		const zeta = 0.1
		const m = 1
		const c = 2 * zeta * Math.sqrt(k * m)
		const { y, start } = hung(k, c, 6)
		const rest = y.at(-1)!
		const top = peaks(y.map((v) => v - rest)).slice(0, 6)
		const ratios = top.slice(1).map((p, i) => p.v / top[i]!.v)
		console.log(`DAMPED SPRING 1 kg, 200 N/m, c ${c.toFixed(3)} N s/m (zeta ${zeta}): successive peak ratios ${ratios.map((r) => r.toFixed(4)).join(" ")}`)
		check("amplitude ratio per cycle (mean of 5)", mean(ratios), Math.exp((-2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)), 0.03)
		check("static stretch at rest after 6 s", start - rest, (m * G) / k, 0.01, " m")
	},
	rope: () => {
		const L = 1
		const top = 1.5
		const th0 = 5 * D2R
		const r = denseBall(0.5)
		const bob = (at: { x: number; y: number }) => s({ kind: "dynamic", id: "bob", words: "bob", body: { kind: "ball", radius: r }, material: "dense", at })
		const rope = { kind: "rope", id: "r", a: null, b: "bob", anchorA: { x: 0, y: top }, anchorB: { x: 0, y: 0 }, length: L }
		const F = run(doc({ solids: [bob({ x: L * Math.sin(th0), y: top - L * Math.cos(th0) })], joints: [rope], seconds: 8.5 }))
		const x = F.map((f) => f.bob!.x)
		const up = crossings(x)
		const period = (up.at(-1)! - up[0]!) / (up.length - 1)
		console.log(`ROPE pendulum L ${L} m, 0.5 kg bob, from ${th0 / D2R} deg (${up.length - 1} periods)`)
		check("small-swing period (with the finite-amplitude 1 + th0^2/16)", period, 2 * Math.PI * Math.sqrt(L / G) * (1 + th0 ** 2 / 16), 0.015, " s")
		const longest = Math.max(...F.map((f) => Math.hypot(f.bob!.x, f.bob!.y - top)))
		claim(`rope never longer than its length: longest ${(longest * 1000).toFixed(2)} mm vs ${L * 1000} mm`, longest <= L + 0.002)
		// Dropped from the anchor: it falls exactly as a free ball does until the rope pulls taut half a meter down.
		const Ld = 0.5
		const D = run(doc({ solids: [bob({ x: 0, y: top })], joints: [{ ...rope, length: Ld }], seconds: 1 })).map((f) => f.bob!)
		const free = run(doc({ solids: [bob({ x: 0, y: top })], seconds: 1 })).map((f) => f.bob!)
		const taut = D.findIndex((p) => top - p.y >= Ld - 1e-4)
		let worst = 0
		for (let k = 0; k < taut; k++) worst = Math.max(worst, Math.abs(D[k]!.y - free[k]!.y))
		console.log(`ROPE drop: bob released at the anchor on a ${Ld} m rope`)
		check("moment the rope goes taut", taut * STEP, Math.sqrt((2 * Ld) / G), 0.015, " s")
		claim(`falls freely until then: worst gap from the same ball with no rope ${(worst * 1e6).toFixed(1)} um`, worst < 1e-6)
		const after = D.slice(taut).map((p) => Math.hypot(p.x, p.y - top))
		claim(`held at the rope's length after: ${(Math.min(...after) * 1000).toFixed(1)} to ${(Math.max(...after) * 1000).toFixed(1)} mm`, Math.max(...after) <= Ld + 0.002)
	},
	pin: () => {
		const Lr = 0.4
		const T = 0.02
		const rod = (at: { x: number; y: number }) =>
			s({ kind: "dynamic", id: "rod", words: "rod", body: { kind: "slab", width: Lr, height: T, depth: T }, material: "dense", at })
		const m = 20000 * Lr * T * T
		const pin = (anchorB: { x: number; y: number }, extra: Record<string, unknown>) => ({
			kind: "pin",
			id: "p",
			a: null,
			b: "rod",
			anchorA: { x: 0, y: 1 },
			anchorB,
			...extra
		})
		// Unloaded: pinned at its centre, gravity has no lever.
		const speed = 3
		const U = run(doc({ solids: [rod({ x: 0, y: 1 })], joints: [pin({ x: 0, y: 0 }, { motor: { speed, torque: 0.5 } })], seconds: 1 }))
		const w = (F: Record<string, P>[], k: number) => (F[k + 1]!.rod!.angle - F[k]!.rod!.angle) / STEP
		console.log(`PIN MOTOR rod ${Lr} m, ${m.toFixed(3)} kg`)
		check("unloaded rod's spin after 1 s (motor 3 rad/s, 0.5 N m)", w(U, U.length - 2), speed, 0.005, " rad/s")
		// Pinned at its left end, level: lifting it needs m g L/2.
		const need = (m * G * Lr) / 2
		const lift = (share: number) =>
			run(doc({ solids: [rod({ x: Lr / 2, y: 1 })], joints: [pin({ x: -Lr / 2, y: 0 }, { motor: { speed: 1, torque: share * need } })], seconds: 0.5 }))
		const weak = lift(0.8)
		const strong = lift(1.2)
		const weakMax = Math.max(...weak.slice(0, -1).map((_, k) => w(weak, k)))
		claim(
			`torque 0.8x the load's ${need.toFixed(3)} N m stalls it: fastest lift ${weakMax.toFixed(3)} rad/s (motor 1), ends ${(weak.at(-1)!.rod!.angle / D2R).toFixed(1)} deg (sagging)`,
			weakMax < 0.05 && weak.at(-1)!.rod!.angle < 0
		)
		check("torque 1.2x lifts it at the motor's speed", w(strong, strong.length - 2), 1, 0.01, " rad/s")
		const lim = run(doc({ solids: [rod({ x: Lr / 2, y: 1 })], joints: [pin({ x: -Lr / 2, y: 0 }, { limits: { lower: -0.5, upper: 0.5 } })], seconds: 1.5 }))
		const stop = lim.at(-1)!.rod!.angle
		claim(`limits -0.5..0.5 rad: an unpowered rod falls and stops at ${stop.toFixed(4)} rad (Box2D holds a limit within its 2 deg angular slop)`, Math.abs(stop + 0.5) < (2 * Math.PI) / 180)
	},
	car: () => {
		const th = 10 * D2R
		const r = 0.03
		const f = 5
		const zeta = 0.7
		const cw = 0.24
		const ch = 0.03
		const cd = 0.06
		const wx = 0.08
		const wy = -0.03
		const Mc = 7850 * cw * ch * cd
		const mw = 7850 * (4 / 3) * Math.PI * r ** 3
		const along = { x: Math.cos(th), y: -Math.sin(th) }
		const normal = { x: Math.sin(th), y: Math.cos(th) }
		const on = (a: number, n: number) => ({ x: a * along.x + n * normal.x, y: a * along.y + n * normal.y })
		const car = (place: (a: number, n: number) => { x: number; y: number }, angle: number, ground: unknown, damping: number, seconds: number) => {
			const solids = [
				ground,
				s({ kind: "dynamic", id: "chassis", words: "chassis", body: { kind: "slab", width: cw, height: ch, depth: cd }, material: "steel", at: place(0.3, r - wy), angle }),
				s({ kind: "dynamic", id: "front", words: "wheel", body: { kind: "ball", radius: r, inertia: 0.5 }, material: "steel", at: place(0.3 + wx, r) }),
				s({ kind: "dynamic", id: "rear", words: "wheel", body: { kind: "ball", radius: r, inertia: 0.5 }, material: "steel", at: place(0.3 - wx, r) })
			]
			const wheel = (id: string, x: number) => ({ kind: "wheel", id, chassis: "chassis", wheel: id, anchor: { x, y: wy }, axis: { x: 0, y: 1 }, frequency: f, damping })
			return run(
				doc({
					contacts: [{ between: ["steel", "steel"], friction: 0.9, restitution: 0, rollingResistance: 0 }],
					solids,
					joints: [wheel("front", wx), wheel("rear", -wx)],
					seconds
				})
			)
		}
		const slope = s({ kind: "static", id: "slope", words: "slope", body: { kind: "slab", width: 4, height: 0.04, depth: 0.2 }, material: "steel", at: on(1.6, -0.02), angle: -th })
		const F = car(on, -th, slope, zeta, 1.4)
		const x = F.map((p) => p.chassis!.x * along.x + p.chassis!.y * along.y)
		const k0 = Math.round(0.3 / STEP)
		const k1 = Math.round(1.3 / STEP)
		const M = Mc + 2 * mw
		const spin = 2 * 0.5 * mw
		console.log(`CAR on a 10 deg slope: chassis ${Mc.toFixed(3)} kg, two ${(mw * 1000).toFixed(0)} g disc wheels r ${r} m, suspension ${f} Hz, damping ${zeta}`)
		check("acceleration down the slope", accel(x, k0, k1), G * Math.sin(th) * (M / (M + spin)), 0.03, " m/s^2")
		// Sag: how far each wheel has risen along the axis from its anchor, i.e. how far the chassis sank.
		const sag = (p: Record<string, P>, id: string, ax: number) => {
			const c = p.chassis!
			const ca = Math.cos(c.angle)
			const sa = Math.sin(c.angle)
			const anchor = { x: c.x + ax * ca - wy * sa, y: c.y + ax * sa + wy * ca }
			return (p[id]!.x - anchor.x) * -sa + (p[id]!.y - anchor.y) * ca
		}
		const late = F.slice(k0, k1)
		const k = (Mc / 2) * (2 * Math.PI * f) ** 2
		const load = (Mc / 2) * G * Math.cos(th)
		const front = mean(late.map((p) => sag(p, "front", wx)))
		const rear = mean(late.map((p) => sag(p, "rear", -wx)))
		console.log(`  stiffness per wheel k = load mass (2 pi f)^2 = ${k.toFixed(1)} N/m; sag front ${(front * 1000).toFixed(2)} mm, rear ${(rear * 1000).toFixed(2)} mm`)
		check("mean suspension sag = load / k", (front + rear) / 2, load / k, 0.03, " m")
		// The same car parked on level ground, lightly damped: it bounces at the suspension's frequency.
		const level = s({ kind: "static", id: "floor", words: "floor", body: { kind: "slab", width: 2, height: 0.04, depth: 0.2 }, material: "steel", at: { x: 0.3, y: -0.02 } })
		const bounce = car((a, n) => ({ x: a, y: n }), 0, level, 0.02, 2)
		const yc = bounce.map((p) => p.chassis!.y)
		const tops = peaks(yc).slice(0, 8)
		check("bounce frequency on level ground (damping 0.02)", (tops.length - 1) / (tops.at(-1)!.t - tops[0]!.t), f * Math.sqrt(1 - 0.02 ** 2), 0.02, " Hz")
	},
	atwood: () => {
		const m1 = 2
		const m2 = 1
		const ball = (id: string, m: number, x: number) =>
			s({ kind: "dynamic", id, words: id, body: { kind: "ball", radius: denseBall(m) }, material: "dense", at: { x, y: 0.9 } })
		const F = run(
			doc({
				solids: [ball("m1", m1, -0.2), ball("m2", m2, 0.2)],
				joints: [{ kind: "pulley", id: "p", a: "m1", b: "m2", groundA: { x: -0.2, y: 1.6 }, groundB: { x: 0.2, y: 1.6 }, anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: 0 }, ratio: 1 }],
				seconds: 0.6
			})
		)
		const y1 = F.map((p) => -p.m1!.y)
		const y2 = F.map((p) => p.m2!.y)
		console.log(`ATWOOD ${m1} kg and ${m2} kg over a pulley`)
		check("heavy side's acceleration down", accel(y1, 2, F.length - 1), (G * (m1 - m2)) / (m1 + m2), 0.01, " m/s^2")
		check("light side's acceleration up", accel(y2, 2, F.length - 1), (G * (m1 - m2)) / (m1 + m2), 0.01, " m/s^2")
	},
	conveyor: () => {
		const speed = 0.5
		const mu = 0.5
		const side = 0.05
		// Which fixture the belt is in each carried contact, from planck's own calls.
		const seen = { A: 0, B: 0 }
		const proto = Contact.prototype as unknown as { setTangentSpeed: (v: number) => void; getFixtureA: () => { getUserData: () => unknown } }
		const original = proto.setTangentSpeed
		proto.setTangentSpeed = function (this: typeof proto, v: number) {
			if (v !== 0) {
				const tag = this.getFixtureA().getUserData() as { part?: { id: string } } | undefined
				if (tag?.part?.id === "belt") seen.A++
				else seen.B++
			}
			original.call(this, v)
		}
		const belt = (angle: number, surfaceSpeed = speed) =>
			s({
				kind: "static",
				id: "belt",
				words: "belt",
				body: { kind: "slab", width: 3, height: 0.04, depth: 0.3 },
				material: "rubber",
				at: { x: 0.02 * Math.sin(angle), y: -0.02 * Math.cos(angle) },
				angle,
				surfaceSpeed
			})
		/** A block resting 3 mm above the top of a belt tilted by `angle`. */
		const block = (angle = 0) => {
			const up = side / 2 + 0.003
			return s({ kind: "dynamic", id: "load", words: "block", body: { kind: "slab", width: side, height: side, depth: side }, material: "dense", at: { x: -up * Math.sin(angle), y: up * Math.cos(angle) }, angle })
		}
		const ball = s({ kind: "dynamic", id: "load", words: "ball", body: { kind: "ball", radius: 0.03 }, material: "dense", at: { x: 0, y: 0.033 } })
		const contacts = [{ between: ["dense", "rubber"], friction: mu, restitution: 0, rollingResistance: 0 }]
		/** Its distance and speed along a direction, per step. */
		const along = (F: Record<string, P>[], u: { x: number; y: number }) => {
			const x = F.map((p) => p.load!.x * u.x + p.load!.y * u.y)
			return { x, v: x.slice(0, -1).map((d, k) => (x[k + 1]! - d) / STEP) }
		}
		const ride = (label: string, solids: unknown[], u: { x: number; y: number }, a0: number) => {
			seen.A = 0
			seen.B = 0
			const { x, v } = along(run(doc({ contacts, solids, seconds: 1 })), u)
			// The sliding phase: from when it lands and starts moving until it nears the belt's speed.
			const a = accel(x, v.findIndex((w) => w > 0.02), v.findIndex((w) => w > 0.45))
			console.log(`CONVEYOR at 0.5 m/s, ${label} (belt is fixture A in ${seen.A} carried contacts, B in ${seen.B})`)
			check("acceleration while it slips", a, a0, 0.03, " m/s^2")
			check("speed it rides at after 1 s", mean(v.slice(-48)), speed, 0.02, " m/s")
			return seen.A > 0 ? "A" : seen.B > 0 ? "B" : "-"
		}
		const east = { x: 1, y: 0 }
		const orders = [
			ride("block dropped on it, belt listed first", [belt(0), block()], east, mu * G),
			ride("block dropped on it, block listed first", [block(), belt(0)], east, mu * G)
		]
		claim(`both fixture orders carried the same way: belt was fixture ${orders.join(", then ")}`, orders.includes("A") && orders.includes("B"))
		ride("speed -0.5: it carries the block toward -x", [belt(0, -speed), block()], { x: -1, y: 0 }, mu * G)
		const th = 15 * D2R
		ride("tilted 15 deg, carrying the block uphill: a = g(mu cos - sin)", [belt(th), block(th)], { x: Math.cos(th), y: Math.sin(th) }, G * (mu * Math.cos(th) - Math.sin(th)))
		// A ball on it rolls: it stops slipping when its contact point keeps up with the belt, its centre at s/(1 + m r^2/I).
		seen.A = 0
		seen.B = 0
		const B = along(run(doc({ contacts, solids: [belt(0), ball], seconds: 1 })), east)
		console.log(`CONVEYOR solid ball dropped on it (belt is fixture A in ${seen.A} carried contacts, B in ${seen.B})`)
		check("ball rolls along at", mean(B.v.slice(-48)), speed / (1 + 5 / 2), 0.02, " m/s")
		proto.setTangentSpeed = original
	},
	stiff: () => {
		// Since the engine batch 2 (2026-10-15) a stiff spring's group is solved in sub-steps (physics.ts `subSteps`, up to 16 a step): 1e5 N/m on a
		// 33 g ball (ω·dt 3.6) is followed, and nothing is said; a spring too stiff even for 16 sub-steps (1e9 N/m: ω·dt 361) is said once.
		const said: string[] = []
		const warn = console.warn
		console.warn = (...m: unknown[]) => void said.push(m.join(" "))
		const hang = (k: number) =>
			run(
				doc({
					solids: [s({ kind: "dynamic", id: "bob", words: "bob", body: { kind: "ball", radius: 0.01 }, material: "steel", at: { x: 0, y: 0.9 } })],
					joints: [{ kind: "spring", id: "stiff", a: null, b: "bob", anchorA: { x: 0, y: 1 }, anchorB: { x: 0, y: 0 }, rest: 0.1, stiffness: k, damping: 0 }],
					seconds: 0.05
				})
			)
		hang(1e5)
		const quiet = said.length
		hang(1e9)
		console.warn = warn
		console.log(`STIFF SPRING 1e5 N/m on a 33 g ball (ω·dt 3.6), then 1e9 N/m (ω·dt 361)`)
		claim(`1e5 N/m: followed in sub-steps, nothing said (${quiet} warnings)`, quiet === 0)
		claim(`1e9 N/m: warns: ${said[quiet] ?? "(nothing said)"}`, said.length - quiet === 1)
	}
}

const which = process.argv[2] ?? "all"
for (const [name, fn] of Object.entries(tests)) if (which === "all" || which === name) fn()
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`)
process.exitCode = failures === 0 ? 0 : 1
