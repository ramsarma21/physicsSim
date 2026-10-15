// Real-world validation tests for the 2D scene engine (read-only use of tooling/src/sim/physics.ts).
// Each test builds a small scene, runs it at 480 Hz (every step kept) and prints what the engine does
// next to what measured physics says. Run:
//   node --no-warnings research/rw-validate.ts [drop|ramp|incline|domino|seesaw|rest|all] [key=value ...]
import { simulate } from "/Users/ramsarma/Downloads/science-map-share/blender-playground/tooling/src/sim/physics.ts"
import { admitDocument } from "/Users/ramsarma/Downloads/science-map-share/blender-playground/tooling/src/sim/document.ts"

const args = Object.fromEntries(process.argv.slice(3).map((a) => a.split("=") as [string, string]))
const num = (k: string, d: number) => (args[k] === undefined ? d : Number(args[k]))
const G = 9.81
const STEP = 1 / 480
const D2R = Math.PI / 180
const s = (o: Record<string, unknown>) => ({ placeholder: { fill: "#888" }, render: { kind: "procedural", shade: "#666" }, depth: 1, ...o })
const doc = (o: { materials: Record<string, unknown>; contacts: unknown[]; solids: unknown[]; seconds: number }) => ({
	version: 1,
	id: "rw",
	camera: { canvas: { width: 10, height: 10 }, origin: { x: 0, y: 0 }, pixel: { x: 0, y: 0 }, pixelsPerMeter: 1 },
	animated: [],
	organic: [],
	release: { parts: [], at: 0 },
	sprites: {},
	...o
})
const run = (d: unknown) => simulate(admitDocument(d).scene, 480).frames
const floor = (width = 8) =>
	s({ kind: "static", id: "floor", words: "floor", body: { kind: "slab", width, height: 0.1, depth: 1 }, material: "wood", at: { x: width / 2 - 1, y: -0.05 } })
const MAT = { rubber: { density: 906 }, wood: { density: 700 }, celluloid: { density: 1370 }, domino: { density: 1050 } }
const rubberWood = (o: Record<string, number> = {}) => ({
	between: ["rubber", "wood"],
	friction: num("mu", 0.52),
	restitution: num("e", 0.86),
	rollingResistance: num("crr", 0.012),
	tangentRestitution: num("ex", 0),
	grip: num("grip", 0.9),
	...o
})
const R = 0.03
const M_RUBBER = 906 * (4 / 3) * Math.PI * R ** 3
const dragK = (r: number, m: number) => (0.5 * 1.2 * 0.47 * Math.PI * r * r) / m

/** 1D drop with quadratic drag and constant e: apex heights (of the ball's bottom). */
const dropTheory = (h: number, e: number, k: number, bounces: number) => {
	const apexes: number[] = []
	let y = h
	let v = 0
	const dt = 1e-5
	for (let b = 0; b <= bounces; b++) {
		while (y > 0) {
			v += (-G + k * v * v) * dt
			y += v * dt
		}
		v = -e * v
		y = 0
		while (v > 0) {
			v += (-G - k * v * v) * dt
			y += v * dt
		}
		apexes.push(y)
	}
	return apexes
}

const tests: Record<string, () => void> = {
	drop: () => {
		const h = num("h", 1)
		const F = run(
			doc({
				materials: MAT,
				contacts: [rubberWood()],
				solids: [floor(), s({ kind: "dynamic", id: "ball", words: "ball", body: { kind: "ball", radius: R }, material: "rubber", at: { x: 0, y: h + R } })],
				seconds: num("t", 10)
			})
		).map((f) => f.placements.ball!)
		const apex: number[] = []
		for (let k = 1; k + 1 < F.length; k++) if (F[k]!.y > F[k - 1]!.y && F[k]!.y >= F[k + 1]!.y && F[k]!.y - R > 0.003) apex.push(F[k]!.y - R)
		const e = num("e", 0.86)
		const th = dropTheory(h, e, dragK(R, M_RUBBER), 5)
		console.log(`DROP ${h} m superball, e=${e}: engine apexes (m)`, apex.slice(0, 6).map((a) => a.toFixed(4)).join(" "))
		console.log(`  theory e^n h (no drag):`, [1, 2, 3, 4, 5, 6].map((n) => (h * e ** (2 * n)).toFixed(4)).join(" "))
		console.log(`  theory with drag Cd .47:`, th.slice(0, 6).map((a) => a.toFixed(4)).join(" "))
		const last = F.at(-1)!
		const moving = F.slice(-48).some((p, i, a) => i > 0 && Math.abs(p.y - a[i - 1]!.y) > 1e-6)
		console.log(`  bounces counted ${apex.length}; final center y ${(last.y * 1000).toFixed(2)} mm (penetration ${((R - last.y) * 1000).toFixed(2)} mm), still moving: ${moving}`)
		console.log(`  constant-e total bounce time t0(1+e)/(1-e) = ${(Math.sqrt((2 * h) / G) * (1 + e) / (1 - e)).toFixed(2)} s`)
	},
	ramp: () => {
		const deg = num("deg", 30)
		const h = num("h", 1)
		const th = deg * D2R
		const F = run(
			doc({
				materials: MAT,
				contacts: [rubberWood({ rollingResistance: 0 })],
				solids: [
					s({ kind: "static", id: "plate", words: "plate", body: { kind: "slab", width: 2, height: 0.04, depth: 0.1 }, material: "wood", at: { x: -0.02 * Math.sin(th), y: -0.02 * Math.cos(th) }, angle: -th }),
					s({ kind: "dynamic", id: "ball", words: "ball", body: { kind: "ball", radius: R }, material: "rubber", at: { x: 0, y: h + R / Math.cos(th) } })
				],
				seconds: 0.7
			})
		).map((f) => f.placements.ball!)
		const n = { x: Math.sin(th), y: Math.cos(th) }
		const t = { x: Math.cos(th), y: -Math.sin(th) }
		const gap = (k: number) => F[k]!.x * n.x + F[k]!.y * n.y - R
		const vel = (k: number) => {
			const vx = (F[k + 1]!.x - F[k]!.x) / STEP
			const vy = (F[k + 1]!.y - F[k]!.y) / STEP
			return { vx, vy, vn: vx * n.x + vy * n.y, vt: vx * t.x + vy * t.y, w: (F[k + 1]!.angle - F[k]!.angle) / STEP }
		}
		// The impact step: where the ball comes closest (with CCD it can rebound within the step, a mm short).
		const k0 = F.findIndex((_, k) => k > 0 && k + 1 < F.length && gap(k) < 0.004 && gap(k + 1) > gap(k))
		// Gravity acts during the window either side of the impact step; take it back out.
		const gx = 0
		const gy = -G
		const fix = (v: ReturnType<typeof vel>, steps: number) => {
			const vx = v.vx - gx * steps * STEP
			const vy = v.vy - gy * steps * STEP
			return { vx, vy, vn: vx * n.x + vy * n.y, vt: vx * t.x + vy * t.y, w: v.w }
		}
		const b = fix(vel(k0 - 2), -2)
		const a = fix(vel(k0 + 6), 6)
		const fromVertical = Math.atan2(a.vx, a.vy) / D2R
		const en = -a.vn / b.vn
		const ex = -(a.vt + a.w * R) / (b.vt + b.w * R)
		// Theory for a solid sphere (alpha = 0.4) with no incident spin.
		const pred = (exx: number, eyy: number) => {
			const vt = b.vt * (1 - 0.4 * exx) / 1.4
			const vn = -eyy * b.vn
			const w = -((1 + exx) / 1.4) * b.vt / R
			return { ang: deg + Math.atan2(vt, vn) / D2R, w, speed: Math.hypot(vt, vn) }
		}
		console.log(`RAMP ${deg} deg, ${h} m drop: incoming v ${Math.hypot(b.vx, b.vy).toFixed(3)} m/s`)
		console.log(`  engine: e_n ${en.toFixed(3)}, e_x ${ex.toFixed(3)}, rebound ${fromVertical.toFixed(1)} deg from vertical, speed ${Math.hypot(a.vx, a.vy).toFixed(3)}, spin ${a.w.toFixed(1)} rad/s`)
		for (const [label, exx, eyy] of [
			["rigid rolling (e_x=0)", 0, 0.86],
			["Cross 2002 superball e_x=0.76", 0.76, 0.86],
			["Cross grip-slip e_x=0.49", 0.49, 0.91],
			["Garwin ideal e_x=e_y=1", 1, 1]
		] as const) {
			const p = pred(exx, eyy)
			console.log(`  ${label}: rebound ${p.ang.toFixed(1)} deg from vertical, speed ${p.speed.toFixed(3)}, spin ${p.w.toFixed(1)} rad/s`)
		}
	},
	incline: () => {
		const deg = num("deg", 20)
		const crr = num("crr", 0.012)
		const th = deg * D2R
		const L = 0.6
		// Ball resting on the incline's top end, then a long flat run-out.
		const top = { x: -L * Math.cos(th), y: L * Math.sin(th) }
		const F = run(
			doc({
				materials: MAT,
				contacts: [rubberWood({ rollingResistance: crr })],
				solids: [
					floor(30),
					s({ kind: "static", id: "ramp", words: "ramp", body: { kind: "slab", width: L, height: 0.02, depth: 0.1 }, material: "wood", at: { x: top.x / 2 - 0.01 * Math.sin(th), y: top.y / 2 - 0.01 * Math.cos(th) }, angle: -th }),
					s({ kind: "dynamic", id: "ball", words: "ball", body: { kind: "ball", radius: R }, material: "rubber", at: { x: top.x + 0.03 + R * Math.sin(th), y: top.y - 0.03 * Math.tan(th) + R * Math.cos(th) } })
				],
				seconds: num("t", 6)
			})
		).map((f) => f.placements.ball!)
		// Along-slope acceleration while on the incline (first 0.25 s).
		const along = (k: number) => F[k]!.x * Math.cos(th) - F[k]!.y * Math.sin(th)
		const k1 = 12
		const k2 = 120
		const s1 = along(k1)
		const s2 = along(k2)
		const s3 = along(Math.round((k1 + k2) / 2))
		const aMeas = (4 * (s1 + s2 - 2 * s3)) / ((k2 - k1) * STEP) ** 2
		console.log(`INCLINE ${deg} deg superball, C_rr ${crr}: engine a = ${aMeas.toFixed(3)} m/s^2`)
		console.log(`  theory rolling solid sphere 5/7 g (sin - Crr cos) = ${((5 / 7) * G * (Math.sin(th) - crr * Math.cos(th))).toFixed(3)}; without Crr ${((5 / 7) * G * Math.sin(th)).toFixed(3)}; sliding-free requires mu >= 2/7 tan = ${((2 / 7) * Math.tan(th)).toFixed(3)}`)
		// Flat run-out deceleration, once well onto the floor (y back to R, x > 0.2).
		const flat = F.map((p, k) => ({ p, k })).filter(({ p }) => p.x > 0.3 && Math.abs(p.y - R) < 0.006)
		if (flat.length > 200) {
			const a0 = flat[20]!
			const a1 = flat[Math.min(flat.length - 2, 20 + 960)]!
			const v = (k: number) => (F[k + 1]!.x - F[k]!.x) / STEP
			const decel = (v(a0.k) - v(a1.k)) / ((a1.k - a0.k) * STEP)
			const vAvg = (v(a0.k) + v(a1.k)) / 2
			const drag = dragK(R, M_RUBBER) * vAvg * vAvg
			console.log(`  flat run-out: v ${v(a0.k).toFixed(3)} -> ${v(a1.k).toFixed(3)} m/s, decel ${decel.toFixed(4)} m/s^2; implied C_rr (7/5 (a - drag)/g) = ${((7 / 5) * (decel - drag) / G).toFixed(4)}`)
			const stop = F.findIndex((p, k) => k > a0.k && k + 1 < F.length && Math.abs(v(k)) < 0.005)
			console.log(`  roll-out: reached x = ${F.at(-1)!.x.toFixed(2)} m by t=${(F.length * STEP).toFixed(1)} s${stop > 0 ? `, stopped at t=${(stop * STEP).toFixed(2)} s` : ""}`)
		}
	},
	rest: () => {
		// Resting penetration: a domino standing and a ball resting on the floor.
		const H = 0.0516
		const T = 0.0079
		const F = run(
			doc({
				materials: MAT,
				contacts: [rubberWood({ restitution: 0 }), { between: ["domino", "wood"], friction: 0.4, restitution: 0, rollingResistance: 0 }],
				solids: [
					floor(),
					s({ kind: "dynamic", id: "d", words: "domino", body: { kind: "slab", width: T, height: H, depth: 0.0255 }, material: "domino", at: { x: 0, y: H / 2 } }),
					s({ kind: "dynamic", id: "ball", words: "ball", body: { kind: "ball", radius: R }, material: "rubber", at: { x: 0.3, y: R } })
				],
				seconds: 2
			})
		)
		const last = F.at(-1)!.placements
		console.log(`REST after 2 s: domino center y ${(last.d!.y * 1000).toFixed(2)} mm vs ${(H * 500).toFixed(2)} (sinks ${((H / 2 - last.d!.y) * 1000).toFixed(2)} mm); ball center ${(last.ball!.y * 1000).toFixed(2)} mm vs 30 (sinks ${((R - last.ball!.y) * 1000).toFixed(2)} mm)`)
	},
	domino: () => {
		const H = num("H", 0.0516)
		const W = num("W", 0.0255)
		const T = num("T", 0.0079)
		const pitch = num("pitch", 0.035)
		const N = num("n", 30)
		const mudd = num("mudd", 0.3)
		const edd = num("edd", 0)
		const mudf = num("mudf", 0.5)
		const tilt = num("tilt", 15) * D2R
		const solids: unknown[] = [floor()]
		for (let i = 0; i < N; i++) {
			const x0 = i * pitch
			if (i === 0) {
				// Tilted forward about its front bottom edge, past its tipping angle.
				const c = { x: x0 + T / 2 + (-T / 2) * Math.cos(tilt) + (H / 2) * Math.sin(tilt), y: (T / 2) * Math.sin(tilt) + (H / 2) * Math.cos(tilt) }
				solids.push(s({ kind: "dynamic", id: `d${i}`, words: "domino", body: { kind: "slab", width: T, height: H, depth: W }, material: "domino", at: c, angle: -tilt }))
			} else {
				solids.push(s({ kind: "dynamic", id: `d${i}`, words: "domino", body: { kind: "slab", width: T, height: H, depth: W }, material: "domino", at: { x: x0, y: H / 2 } }))
			}
		}
		const F = run(
			doc({
				materials: MAT,
				contacts: [
					{ between: ["domino", "domino"], friction: mudd, restitution: edd, rollingResistance: 0 },
					{ between: ["domino", "wood"], friction: mudf, restitution: 0, rollingResistance: 0 }
				],
				solids,
				seconds: num("t", 2.5)
			})
		)
		const hit = Array.from({ length: N }, (_, i) => F.findIndex((f) => Math.abs(f.placements[`d${i}`]!.angle) > 0.02))
		const fallen = hit.filter((k) => k >= 0).length
		const from = 6
		const to = Math.min(N - 4, fallen - 2)
		const dt = ((hit[to]! - hit[from]!) * STEP) / (to - from)
		const gap = pitch - T
		const v = pitch / dt
		console.log(`DOMINO H ${H} T ${T} pitch ${pitch} (gap/H ${(gap / H).toFixed(2)}), mu_dd ${mudd}, e_dd ${edd}, mu_floor ${mudf}: ${fallen}/${N} toppled`)
		console.log(`  engine wave speed ${v.toFixed(3)} m/s = ${(v / Math.sqrt(G * H)).toFixed(2)} sqrt(gH)  (dominoes ${from}-${to}); first-hit steps`, hit.slice(0, 10).join(","))
		const slid = Array.from({ length: Math.min(N, fallen) }, (_, i) => {
			const f = F.at(-1)!.placements[`d${i}`]!
			return f.x - i * pitch
		})
		console.log(`  base drift of fallen dominoes (mm):`, slid.slice(0, 12).map((d) => (d * 1000).toFixed(1)).join(" "))
	},
	seesaw: () => {
		const Lp = 0.4
		const tp = 0.012
		const pivotY = num("py", 0.05)
		const rArm = 0.17
		const drop = num("drop", 0.3)
		// Plank angle with its left end's bottom corner on the floor.
		let phi = 0
		for (let i = 0; i < 60; i++) phi = Math.asin((pivotY - (tp / 2) * Math.cos(phi)) / (Lp / 2))
		const RB = 0.02
		const wall = 0.0004
		const mB = 1370 * (4 / 3) * Math.PI * (RB ** 3 - (RB - wall) ** 3)
		const along = (r: number, up: number) => ({ x: r * Math.cos(phi) - up * Math.sin(phi), y: pivotY + r * Math.sin(phi) + up * Math.cos(phi) })
		const aTop = along(rArm, tp / 2 + R + drop)
		// A lip at the light ball's end keeps it from rolling off the tilted plank before the strike.
		const lipW = 0.008
		const lipH = 0.02
		const lipR = rArm + RB + lipW / 2
		const mLip = 700 * lipW * lipH * 0.04
		const bAt = along(-rArm, tp / 2 + RB)
		const F = run(
			doc({
				materials: MAT,
				contacts: [
					rubberWood({ rollingResistance: 0 }),
					{ between: ["celluloid", "wood"], friction: 0.25, restitution: 0.88, rollingResistance: 0 },
					{ between: ["wood", "wood"], friction: 0.4, restitution: num("eplank", 0.3), rollingResistance: 0 },
					{ between: ["rubber", "celluloid"], friction: 0.4, restitution: 0.6, rollingResistance: 0 }
				],
				solids: [
					floor(),
					s({ kind: "dynamic", id: "plank", words: "plank", body: { kind: "slab", width: Lp, height: tp, depth: 0.04 }, material: "wood", at: { x: 0, y: pivotY }, angle: phi, pivot: { x: 0, y: 0 } }),
					s({ kind: "dynamic", id: "lip", words: "lip", body: { kind: "slab", width: lipW, height: lipH, depth: 0.04 }, material: "wood", at: { x: -lipR, y: tp / 2 + lipH / 2 }, parent: "plank" }),
					s({ kind: "dynamic", id: "A", words: "heavy", body: { kind: "ball", radius: R }, material: "rubber", at: { x: aTop.x, y: aTop.y } }),
					s({ kind: "dynamic", id: "B", words: "light", body: { kind: "ball", radius: RB, wall }, material: "celluloid", at: { x: bAt.x, y: bAt.y } })
				],
				seconds: 1.5
			})
		)
		const ang = F.map((f) => f.placements.plank!.angle)
		// The strike: the first step the plank turns faster than 1 rad/s (it may settle a hair first).
		const kImp = ang.findIndex((a, k) => k > 0 && k + 1 < ang.length && Math.abs(ang[k + 1]! - a) / STEP > 1)
		const w = (k: number) => (ang[k + 1]! - ang[k]!) / STEP
		const mP = 700 * Lp * tp * 0.04
		const Ip = (mP * (Lp * Lp + tp * tp)) / 12
		const Itot = Ip + mB * rArm * rArm + mLip * (lipR * lipR + (tp / 2 + lipH / 2) ** 2) + (mLip * (lipW * lipW + lipH * lipH)) / 12
		const vA = Math.sqrt(2 * G * drop) * Math.cos(phi)
		const e = 0.86
		const J = ((1 + e) * vA) / (1 / M_RUBBER + (rArm * rArm) / Itot)
		const wTh = (J * rArm) / Itot
		const By = F.map((f) => f.placements.B!.y)
		const apex = Math.max(...By.slice(kImp))
		console.log(`SEESAW plank ${(mP * 1000).toFixed(0)} g, I ${Ip.toExponential(3)}; superball ${(M_RUBBER * 1000).toFixed(1)} g dropped ${drop} m on arm ${rArm}; ping-pong ${(mB * 1000).toFixed(2)} g on other arm; tilt ${(phi / D2R).toFixed(1)} deg`)
		console.log(`  engine plank spin just after impact: ${w(kImp + 1).toFixed(2)}, +3 steps ${w(kImp + 3).toFixed(2)} rad/s; theory (angular momentum + e=0.86) ${(-wTh).toFixed(2)} rad/s`)
		const vB = wTh * rArm
		console.log(`  theory ping-pong kicked off at impact: ${vB.toFixed(2)} m/s, ${(phi / D2R).toFixed(1)} deg from vertical AWAY from the pivot (plank normal at impact); apex rise, no drag ${(((vB * Math.cos(phi)) ** 2) / (2 * G)).toFixed(3)} m`)
		const kB = kImp + 2
		const bvx = (F[kB + 1]!.placements.B!.x - F[kB]!.placements.B!.x) / STEP
		const bvy = (F[kB + 1]!.placements.B!.y - F[kB]!.placements.B!.y) / STEP
		console.log(`  engine ping-pong just after impact: ${Math.hypot(bvx, bvy).toFixed(2)} m/s at ${(Math.atan2(bvx, bvy) / D2R).toFixed(1)} deg from vertical (negative = away from pivot)`)
		console.log(`  engine ping-pong apex center y ${apex.toFixed(3)} m (start ${By[0]!.toFixed(3)}), max |x| travel ${Math.max(...F.map((f) => Math.abs(f.placements.B!.x - bAt.x))).toFixed(3)} m`)
	}
}

const which = process.argv[2] ?? "all"
for (const [name, fn] of Object.entries(tests)) if (which === "all" || which === name) fn()
