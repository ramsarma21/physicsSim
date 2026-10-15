// The intro's little machine (web/ui/ui.js draws it): a ball rolls down a ramp, drops to the table and knocks over a row of six dominoes; the last
// domino pushes a second ball off a block, and it drops into a box. Nothing here is drawn by hand. heroMotion() works the motion out with
// ordinary mechanics, once, when the intro opens:
//   - the ball rolls without slipping down the ramp (a = 5/7 g sin θ), flies off its end, lands and rolls on;
//   - it hits the first domino low down (a rubber ball about as heavy as one domino: restitution 0.6), bounces back a little, and its own
//     spin (sliding friction, then rolling) brings it forward again to rest against the fallen domino;
//   - the dominoes topple about their front foot; one that touches the next keeps leaning on it, so the falling ones move as one system
//     (Lagrangian, one degree of freedom, energy conserved between hits) and each new hit is plastic (generalised momentum carried over);
//   - the last one hits the second ball (restitution 0.5, the block takes the downward part), comes to rest against the block, and every
//     domino behind it stops leaning on the one in front: the fan you see at the end is that resting pose, not a guess;
//   - the second ball (the same rubber, smaller) slides, then rolls, leaves the block, clears the box wall, bounces on the cardboard and
//     rolls against the far wall until it rests.
// The picture uses one length unit (the SVG's) and plays the motion uniformly slowed down (SLOW), so every part keeps its true proportions in time.
// heroSvg() draws the parts from the same numbers; playHero() plays the result (Web Animations, one loop: fade in, run, hold, fade out).
// heroMotion() also hands back the outline helpers, so a test can check that no two parts ever overlap along the way.

export const GEOM = {
	floor: 150, // the table top (SVG y; y grows downward)
	ramp: { x0: 58, y0: 61, x1: 262, y1: 131, thick: 7 }, // its top surface, from the high end to the low end
	r1: 11, // the first ball
	start: 30, // how far down the ramp (along its surface) the first ball starts
	dom: { n: 6, t: 9, h: 40, foot: 330, pitch: 22 }, // foot: the first domino's front (right) bottom corner, which it tips about
	block: { x0: 448, x1: 480, h: 26 }, // the block the second ball sits on
	r2: 8, // the second ball
	ball2: 457, // its centre x on the block
	box: { x0: 480, x1: 536, wall: 4, h: 16, base: 4 },
}
const SLOW = 3 // the motion is played this many times slower than real time at this scale (1 unit = 3 mm: dominoes 12 cm tall)
const G_REAL = 3270 // g in units/s² (9.81 m/s² at 3 mm per unit)
const DEG = 180 / Math.PI
const M1 = 0.2 // the first ball's mass, as a share of the first domino's effective mass where it is hit (about one domino's mass)
const E1 = 0.6 // rubber on wood
const MU = 0.5 // sliding friction, rubber on wood
const BOX = { floor: 0.35, wall: 0.3, roll: 0.06 } // the cardboard box: bounce off its floor and walls, rolling resistance on its floor

/** Works the motion out. → {end (s, as played: all at rest), ball1, ball2: [{t, x, y, rot}] (centre, SVG units; rot in radians), dom: [{t, a: [radians × 6]}], …} */
export function heroMotion() {
	const g = G_REAL / (SLOW * SLOW) // (slowing time by SLOW is the same motion under g / SLOW²)
	const { floor, ramp, r1, r2, dom, block, box } = GEOM
	const Y = (y) => floor - y // y-up height above the table ⇄ SVG y
	const { t: T, h: H, pitch: D, n: N } = dom
	const foot = (i) => dom.foot + i * D
	const dt = 1 / 600

	// ---- the dominoes' geometry (angle a: tipped forward, about the front foot)
	const corners = (i, a) => { // the domino's outline, y-up
		const c = Math.cos(a), s = Math.sin(a), x = foot(i)
		return [[x, 0], [x - T * c, T * s], [x - T * c + H * s, T * s + H * c], [x + H * s, H * c]]
	}
	/** the angle a domino comes to rest at, leaning on the next one tipped b (its top corner on that one's back face, or its face on that one's heel) */
	const lean = (b) => {
		const u = (D * Math.cos(b) - T) / H
		return u >= 0 ? b + Math.asin(u) : Math.atan2(D - T * Math.cos(b), T * Math.sin(b))
	}
	const dlean = (b) => (lean(b + 1e-6) - lean(b - 1e-6)) / 2e-6
	const I = (H * H + T * T) / 3 // per unit mass, about the foot
	const ycm = (a) => (T / 2) * Math.sin(a) + (H / 2) * Math.cos(a)
	/** front domino k tipped q: every angle, and how fast each turns per unit of q */
	function chain(k, q) {
		const a = new Array(N).fill(0), J = new Array(N).fill(0)
		a[k] = q
		J[k] = 1
		for (let j = k - 1; j >= 0; j--) { a[j] = lean(a[j + 1]); J[j] = dlean(a[j + 1]) * J[j + 1] }
		let M = 0, V = 0
		for (let j = 0; j <= k; j++) { M += I * J[j] * J[j]; V += g * ycm(a[j]) }
		return { a, J, M, V }
	}

	// ---- circle against polygon (y-up): the distance from a point to the outline, with the nearest point
	function nearest(px, py, poly) {
		let best = Infinity, bx = 0, by = 0
		for (let i = 0; i < poly.length; i++) {
			const [ax, ay] = poly[i], [cx, cy] = poly[(i + 1) % poly.length]
			const ex = cx - ax, ey = cy - ay
			const u = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)))
			const qx = ax + u * ex, qy = ay + u * ey, d = Math.hypot(px - qx, py - qy)
			if (d < best) { best = d; bx = qx; by = qy }
		}
		return { d: best, x: bx, y: by }
	}
	/** the first angle (from lo) at which domino i touches the circle (cx, cy, r), by bisection on a sampled bracket */
	function touchAngle(i, cx, cy, r, lo = 0, hi = Math.PI / 2) {
		let prev = lo
		for (let a = lo; a <= hi + 1e-9; a += 0.002) {
			if (nearest(cx, cy, corners(i, a)).d <= r) {
				let x0 = prev, x1 = a
				for (let k = 0; k < 50; k++) { const m = (x0 + x1) / 2; if (nearest(cx, cy, corners(i, m)).d <= r) x1 = m; else x0 = m }
				return x0
			}
			prev = a
		}
		return null
	}

	// ---- ball 1: down the ramp, off its end, onto the table
	const th = Math.atan2(ramp.y1 - ramp.y0, ramp.x1 - ramp.x0) // the slope (SVG y down: positive)
	const L = Math.hypot(ramp.x1 - ramp.x0, ramp.y1 - ramp.y0)
	const dir = [Math.cos(th), Math.sin(th)] // down the slope, SVG
	const nrm = [Math.sin(th), -Math.cos(th)] // off the surface, SVG
	const onRamp = (s) => [ramp.x0 + s * dir[0] + r1 * nrm[0], ramp.y0 + s * dir[1] + r1 * nrm[1]]
	const b1 = [] // {t, x, y, rot}
	const acc = (5 / 7) * g * Math.sin(th)
	let t = 0
	let s = GEOM.start, v = 0, rot = 0
	while (s < L) {
		const [x, y] = onRamp(s)
		b1.push({ t, x, y, rot })
		v += acc * dt; s += v * dt; rot += (v * dt) / r1; t += dt
	}
	let [x1, y1] = onRamp(L)
	let vx = v * dir[0], vy = v * dir[1] // SVG: vy > 0 is down
	const spin = v / r1
	while (y1 < floor - r1) { // flying (its spin carries on)
		b1.push({ t, x: x1, y: y1, rot })
		vy += g * dt; x1 += vx * dt; y1 += vy * dt; rot += spin * dt; t += dt
	}
	y1 = floor - r1
	// the landing stops the fall; friction then matches the roll (angular momentum about the contact point is kept)
	let v1 = (5 / 7) * (vx + (2 / 5) * r1 * spin)
	const hitX = foot(0) - T - r1
	while (x1 < hitX) {
		b1.push({ t, x: x1, y: y1, rot })
		x1 = Math.min(hitX, x1 + v1 * dt); rot += (v1 * dt) / r1; t += dt
	}
	const tHit = t
	// ---- the hit, low on the first domino (a horizontal push at height r1 above its foot: its effective mass there is I / r1²)
	let k = 0, q = 0, qd = (((1 + E1) * M1) / (1 + M1)) * (v1 / r1)
	let u1 = ((M1 - E1) / (1 + M1)) * v1 // the ball's speed just after (back, a little)
	let st = chain(k, q)
	let E = 0.5 * st.M * qd * qd + st.V
	const domT = [] // {t, a: [...]}
	const ball2Contact = touchAngle(N - 1, GEOM.ball2, block.h + r2, r2)
	const blockStop = Math.atan2(block.x0 - foot(N - 1), block.h) // its face meets the block's top corner
	const hitNext = Math.asin((D - T) / H) // its top corner meets the next one's back face
	let b2 = null // the second ball's state once it is hit
	let ball2Hit = false
	let w1 = v1 / r1, xb1 = x1 // ball 1 after the hit: its spin is still the roll it had
	const mu = MU
	const b1after = []
	const tick = () => { // ball 1 creeps after the domino on its spin (sliding until it rolls), never into it
		const want = r1 * w1 - u1
		if (want > 1e-6) { const du = Math.min(want * (2 / 7), mu * g * dt); u1 += du; w1 -= (du * 5) / (2 * r1) } // (the slip closes 7/2 as fast as the speed changes)
		let nx = xb1 + u1 * dt
		const a0 = domT.length ? domT[domT.length - 1].a[0] : 0
		const lim = (() => { // the farthest the ball can be with the first domino at a0
			let lo = hitX - 1, hi = foot(0) + 1
			for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (nearest(m, r1, corners(0, a0)).d >= r1) lo = m; else hi = m }
			return lo
		})()
		if (nx >= lim) { nx = Math.max(xb1, lim); u1 = Math.max(0, (nx - xb1) / dt); w1 = u1 / r1 }
		rot += ((nx - xb1) / r1) || 0
		xb1 = nx
		b1after.push({ t, x: xb1, y: y1, rot })
	}
	for (let guard = 0; guard < 200000; guard++) {
		st = chain(k, q)
		domT.push({ t, a: st.a.slice() })
		tick()
		if (k === N - 1 && q >= blockStop) break
		// the next event for the front domino
		const end = k < N - 1 ? hitNext : !ball2Hit && ball2Contact != null ? ball2Contact : blockStop
		const KE = E - st.V
		if (KE <= 0) break // (it would stall: not with these numbers)
		qd = Math.sqrt((2 * KE) / st.M)
		let nq = q + qd * dt
		// a second pass with the speed at the end of the step (energy is kept, so the mean speed is near-exact)
		if (nq < end) { const st2 = chain(k, nq); const qd2 = Math.sqrt(Math.max(1e-9, (2 * (E - st2.V)) / st2.M)); nq = q + 0.5 * (qd + qd2) * dt }
		t += dt
		if (nq < end) { q = nq; continue }
		q = end
		st = chain(k, q)
		qd = Math.sqrt(Math.max(0, (2 * (E - st.V)) / st.M))
		if (k < N - 1) { // plastic hit on the next domino: generalised momentum carried over to the bigger system
			const pre = st.J.map((J) => J * qd)
			const nx = chain(k + 1, 0)
			let num = 0
			for (let j = 0; j <= k; j++) num += I * nx.J[j] * pre[j]
			k++
			q = 0
			qd = num / nx.M
			E = 0.5 * nx.M * qd * qd + nx.V
		} else if (!ball2Hit && ball2Contact != null && q >= ball2Contact - 1e-9) { // the last domino hits the second ball
			ball2Hit = true
			const poly = corners(N - 1, q).map(([x, y]) => [x, y])
			const c = nearest(GEOM.ball2, block.h + r2, poly)
			const sArm = Math.hypot(c.x - foot(N - 1), c.y) // how far up its face it touches
			const nx = (GEOM.ball2 - c.x) / Math.hypot(GEOM.ball2 - c.x, block.h + r2 - c.y) // the normal's horizontal share
			const m2 = (r2 / r1) ** 3 * M1 * (I / (r1 * r1)) // the same rubber as the first ball
			const e2 = 0.5
			const P = ((1 + e2) * sArm * qd) / ((nx * nx) / m2 + (sArm * sArm) / st.M)
			qd = qd - (P * sArm) / st.M
			E = 0.5 * st.M * qd * qd + st.V
			b2 = { t, x: GEOM.ball2, y: block.h + r2, vx: (P * nx) / m2, w: 0, rot: 0 }
		}
	}
	const tEnd1 = t // the dominoes are at rest
	for (let guard = 0; guard < 6000 && (u1 > 1e-3 || r1 * w1 - u1 > 1e-3); guard++) { t += dt; tick() } // (the first ball's last creep)

	// ---- ball 2: slides, rolls, leaves the block, drops into the box and settles
	const b2t = []
	if (b2) {
		let { x, y, vx: u, w, rot: r } = b2
		let tt = b2.t
		let vyb = 0 // y-up speed
		let air = false
		const innerL = box.x0 + box.wall + r2, innerR = box.x1 - box.wall - r2, ground = box.base + r2
		const eFloor = BOX.floor, eWall = BOX.wall, crr = BOX.roll
		let rest = 0
		for (let guard = 0; guard < 60000; guard++) {
			b2t.push({ t: tt, x, y: Y(y), rot: r })
			if (!air && y > ground + 0.01 && x > block.x1) air = true // off the block
			if (air) {
				vyb -= g * dt; x += u * dt; y += vyb * dt; r += w * dt
				if (y <= ground) { // on the box floor: a small bounce
					y = ground
					vyb = -vyb * eFloor
					if (vyb < 0.06 * Math.sqrt(g * r2)) { vyb = 0; air = false }
					const L2 = u + (2 / 5) * r2 * w // friction matches the roll on landing
					u = (5 / 7) * L2; w = u / r2
				}
			} else {
				const slip = u - r2 * w
				if (Math.abs(slip) > 1e-6) { // sliding: friction speeds the spin up (or slows it) until it rolls
					const du = Math.min(Math.abs(slip) * (2 / 7), mu * g * dt) * Math.sign(slip)
					u -= du; w += (du * 5) / (2 * r2)
				} else if (y <= ground + 0.01) { // rolling in the box: the cardboard's rolling resistance
					const dv = Math.min(Math.abs(u), crr * g * dt) * Math.sign(u)
					u -= dv; w = u / r2
				}
				x += u * dt; r += w * dt
				if (y > ground + 0.01 && x > block.x1) { air = true; vyb = 0 }
			}
			const low = x > box.x0 && y - r2 < box.h // in the box, below its walls' tops (on its floor or in a bounce)
			if (low && x >= innerR && u > 0) { x = innerR; u = -u * eWall; w = u / r2 }
			if (low && x <= innerL && u < 0) { x = innerL; u = -u * eWall; w = u / r2 }
			tt += dt
			if (!air && y <= ground + 0.01 && Math.abs(u) < 0.5) { if ((rest += dt) > 0.05) break } else rest = 0
		}
		b2t.push({ t: tt, x, y: Y(y), rot: r })
	}
	const tEnd = Math.max(tEnd1, b2t.length ? b2t[b2t.length - 1].t : 0, b1after.length ? b1after[b1after.length - 1].t : 0)
	return {
		end: tEnd, // when everything is at rest (s, as played)
		ball1: [...b1, ...b1after], ball2: b2t, ball2Start: { x: GEOM.ball2, y: Y(block.h + r2) },
		dom: domT, tHit, hitNext: hitNext * DEG, ball2Contact: ball2Contact * DEG, blockStop: blockStop * DEG,
		corners, nearest, Y,
	}
}

/** The SVG's inner markup: the static parts, then the moving ones (one group, so the loop can fade them out and back) */
export function heroSvg() {
	const { floor, ramp, r1, r2, dom, block, box } = GEOM
	const th = Math.atan2(ramp.y1 - ramp.y0, ramp.x1 - ramp.x0)
	const s0 = GEOM.start
	const bx = ramp.x0 + s0 * Math.cos(th) + r1 * Math.sin(th), by = ramp.y0 + s0 * Math.sin(th) - r1 * Math.cos(th)
	const f = (n) => Math.round(n * 100) / 100
	const doms = Array.from({ length: dom.n }, (_, i) => `<rect class="wood dom" x="${dom.foot + i * dom.pitch - dom.t}" y="${floor - dom.h}" width="${dom.t}" height="${dom.h}" rx="1"/>`).join("")
	const { x0, x1, wall, h, base } = box
	return `
		<rect class="wood" x="0" y="${floor}" width="560" height="18"/>
		<rect class="wood-2" x="0" y="${floor}" width="560" height="3"/>
		<rect class="wood-2" x="66" y="66" width="7" height="${floor - 66}" rx="1.5"/>
		<rect class="wood-2" x="246" y="128" width="7" height="${floor - 128}" rx="1.5"/>
		<polygon class="shade" points="60,${floor} 262,${floor} 262,${floor + 2} 60,${floor + 2}"/>
		<polygon class="wood-3" points="${ramp.x0},${ramp.y0} ${ramp.x1},${ramp.y1} ${ramp.x1},${ramp.y1 + ramp.thick} ${ramp.x0},${ramp.y0 + ramp.thick}"/>
		<rect class="wood-3 block" x="${block.x0}" y="${floor - block.h}" width="${block.x1 - block.x0}" height="${block.h}" rx="1"/>
		<path class="box" d="M${x0} ${floor - h} h${wall} v${h - base} h${x1 - x0 - 2 * wall} v${-(h - base)} h${wall} v${h} h${-(x1 - x0)}z"/>
		<g class="moving">
			<g class="doms">${doms}</g>
			<g class="roll b1"><g class="spin"><circle class="ball" cx="${f(bx)}" cy="${f(by)}" r="${r1}"/><circle class="shine" cx="${f(bx - 4)}" cy="${f(by - 4.1)}" r="3.4"/></g></g>
			<g class="roll b2"><g class="spin"><circle class="ball ball-2" cx="${GEOM.ball2}" cy="${floor - block.h - r2}" r="${r2}"/><circle class="shine" cx="${GEOM.ball2 - 3}" cy="${floor - block.h - r2 - 3}" r="2.4"/></g></g>
		</g>`
}

let plan = null
/** Plays the motion in svg (from heroSvg) on a loop: fade in, run, hold the result, fade out. → stop() */
export function playHero(svg) {
	plan ??= heroMotion()
	const P = plan
	const fadeIn = 0.35, lead = 0.25, hold = 1.5, fadeOut = 0.45
	const run = P.end
	const total = fadeIn + lead + run + hold + fadeOut
	const at = (tm) => (fadeIn + lead + tm) / total // a motion time → offset in the loop
	const anims = []
	const opts = { duration: total * 1000, iterations: Infinity, easing: "linear" }
	const thin = (frames, same) => frames.filter((f, i, a) => i === 0 || i === a.length - 1 || !same(a[i - 1], f) || !same(f, a[i + 1]))
	const every = (list, step) => list.filter((_, i, a) => i % step === 0 || i === a.length - 1) // (600 steps a second, keyframes at 60)
	const ballTrack = (el, spinEl, track, x0, y0) => {
		const pts = every(track, 10)
		const last = pts[pts.length - 1]
		const kf = [{ offset: 0, transform: "translate(0px, 0px)" }]
		const sk = [{ offset: 0, transform: "rotate(0deg)" }]
		for (const p of pts) {
			const o = at(p.t)
			kf.push({ offset: o, transform: `translate(${(p.x - x0).toFixed(2)}px, ${(p.y - y0).toFixed(2)}px)` })
			sk.push({ offset: o, transform: `rotate(${(p.rot * DEG).toFixed(1)}deg)` })
		}
		kf.push({ offset: 1, transform: `translate(${(last.x - x0).toFixed(2)}px, ${(last.y - y0).toFixed(2)}px)` })
		sk.push({ offset: 1, transform: `rotate(${(last.rot * DEG).toFixed(1)}deg)` })
		anims.push(el.animate(thin(kf, (a, b) => a.transform === b.transform), opts), spinEl.animate(thin(sk, (a, b) => a.transform === b.transform), opts))
	}
	const b1 = svg.querySelector(".b1"), b2 = svg.querySelector(".b2")
	const c1 = b1.querySelector("circle")
	ballTrack(b1, b1.querySelector(".spin"), P.ball1, +c1.getAttribute("cx"), +c1.getAttribute("cy"))
	if (P.ball2.length) ballTrack(b2, b2.querySelector(".spin"), [{ ...P.ball2[0], t: 0 }, ...P.ball2], P.ball2Start.x, P.ball2Start.y)
	const doms = [...svg.querySelectorAll(".dom")]
	const fr = every(P.dom, 10)
	doms.forEach((el, i) => {
		const kf = [{ offset: 0, transform: "rotate(0deg)" }]
		for (const d of fr) kf.push({ offset: at(d.t), transform: `rotate(${(d.a[i] * DEG).toFixed(2)}deg)` })
		const last = fr[fr.length - 1].a[i] * DEG
		kf.push({ offset: 1, transform: `rotate(${last.toFixed(2)}deg)` })
		anims.push(el.animate(thin(kf, (a, b) => a.transform === b.transform), opts))
	})
	const moving = svg.querySelector(".moving")
	anims.push(moving.animate([
		{ offset: 0, opacity: 0 }, { offset: fadeIn / total, opacity: 1 },
		{ offset: (total - fadeOut) / total, opacity: 1 }, { offset: 1, opacity: 0 },
	], opts))
	return () => { for (const a of anims) a.cancel() }
}
