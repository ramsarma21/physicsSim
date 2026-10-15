// A car body lofted from its side outline: slices along x, each a rounded cross-section (top crowned, shoulders rounded, sides leaning in a little,
// the plan narrowing and rounding at the nose and tail), with half-disc wheel arches cut into the sides over the axles (the tyres stand in them).
// The side silhouette (the middle section, z = 0) is the physics outline exactly; everything else is inside z = +-hw.
// Material groups: 0 = the painted skin, 1 = the dark underbody, wheel-arch liners and inner walls (use [paint, dark]).
export function makeLoft(L, kit) {
	const T = L.THREE
	const clamp = L.clamp

	/** The outline's vertical extent [yb, yt] at x. */
	function extentAt(pts, x) {
		let lo = Infinity
		let hi = -Infinity
		const n = pts.length
		for (let e = 0; e < n; e++) {
			const p = pts[e]
			const q = pts[(e + 1) % n]
			if (Math.abs(p[0] - q[0]) < 1e-9) {
				if (Math.abs(p[0] - x) < 1e-6) {
					lo = Math.min(lo, p[1], q[1])
					hi = Math.max(hi, p[1], q[1])
				}
				continue
			}
			if ((p[0] - x) * (q[0] - x) <= 0) {
				const t = (x - p[0]) / (q[0] - p[0])
				const y = p[1] + t * (q[1] - p[1])
				lo = Math.min(lo, y)
				hi = Math.max(hi, y)
			}
		}
		return [lo, hi]
	}

	/**
	 * The plan half-width at x: hw in the middle; over the last `len` metres at an end the sides come in by `taper` (smoothly), and the corner is rounded by radius R.
	 * ends = {front: {len, taper, R}, rear: {...}}.
	 */
	function planWidth(x0, x1, hw, ends) {
		return (x) => {
			let w = hw
			const f = ends.front
			const r = ends.rear
			if (f) {
				const u = clamp((x - (x1 - f.len)) / f.len)
				w -= f.taper * u * u
				const d = x - (x1 - f.R)
				if (d > 0) w = w - f.R + Math.sqrt(Math.max(0, f.R * f.R - d * d))
			}
			if (r) {
				const u = clamp(((x0 + r.len) - x) / r.len)
				w -= r.taper * u * u
				const d = x0 + r.R - x
				if (d > 0) w = w - r.R + Math.sqrt(Math.max(0, r.R * r.R - d * d))
			}
			return Math.max(0.0005, w)
		}
	}

	/** Slice positions: the outline's own x values, a uniform grid, round the arches and densely at the rounded ends. */
	function slicesFor(pts, x0, x1, arches, ends, fine = 1) {
		const n = Math.max(4, Math.round(22 * fine))
		const na = Math.max(4, Math.round(8 * fine))
		const xs = []
		for (const p of pts) xs.push(p[0])
		for (let i = 0; i <= n; i++) xs.push(x0 + ((x1 - x0) * i) / n)
		for (const a of arches) {
			for (let k = 0; k <= na; k++) {
				const ph = (k / na) * (Math.PI / 2)
				xs.push(a.x + a.R * Math.sin(ph), a.x - a.R * Math.sin(ph))
			}
			xs.push(a.x)
			for (let k = 1; k <= 4; k++) xs.push(a.x + a.R + k * 0.002, a.x - a.R - k * 0.002) // the shoulder radius eases back to its full size over the next 8 mm (see bodyLoft)
		}
		const dense = (e, sign) => {
			if (!e) return
			for (let k = 0; k <= na; k++) xs.push(sign > 0 ? x1 - e.R + e.R * Math.sin(((k / na) * Math.PI) / 2) : x0 + e.R - e.R * Math.sin(((k / na) * Math.PI) / 2))
		}
		dense(ends.front, 1)
		dense(ends.rear, -1)
		xs.sort((a, b) => a - b)
		const out = []
		for (const x of xs) if (x >= x0 - 1e-9 && x <= x1 + 1e-9 && (!out.length || x - out[out.length - 1] > 0.0007 / Math.max(0.5, fine))) out.push(clamp(x, x0, x1))
		out[0] = x0
		out[out.length - 1] = x1
		return out
	}

	/**
	 * bodyLoft(outline, opts) -> BufferGeometry with groups [paint, dark].
	 *   outline: a convex outline [[x, y], ...], counter-clockwise (corners rounded already: L.roundPoly)
	 *   hw: the half width at the widest; ends: {front, rear} (see planWidth); tumbleDeg: how far the sides lean in toward the top;
	 *   crown: how far the top surface drops at the sides (m); rt: shoulder radius; rb: bottom edge radius;
	 *   arches: [{x, cy, R, zc}] half discs cut into the lower side (centre x, cy, radius R) leaving a core of half width zc; skin: the fender's thickness over an arch.
	 *   capGroup: material group of the two end caps.
	 */
	function bodyLoft(outline, o) {
		const { hw, ends = {}, tumbleDeg = 0, crown = 0, rt = 0.004, rb = 0.003, arches = [], skin = 0.0015, key, uvScale = 50, capGroup = 0, fine = 1 } = o
		const pts = outline
		const x0 = Math.min(...pts.map((p) => p[0]))
		const x1 = Math.max(...pts.map((p) => p[0]))
		const kk = `veh|loft|${key}|${hw.toFixed(5)}|${JSON.stringify(ends)}|${tumbleDeg}|${crown}|${rt}|${rb}|${JSON.stringify(arches)}|${skin}|${capGroup}|${fine}`
		return kit.geo(kk, () => {
			const Wp = planWidth(x0, x1, hw, ends)
			const tanT = Math.tan((tumbleDeg * Math.PI) / 180)
			const xs = slicesFor(pts, x0, x1, arches, ends, fine)
			const bez = (a, c, b, t) => [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]
			// The cross-section at x. Over an arch the fender is only as thick as what is left above it, and the shoulder radius gives way to that: `lim` is that limit slice by
			// slice, and the radius actually used (rtUse) may change by at most RT_SLOPE per unit of x, so it eases down toward the arch and back up after it (a step from one
			// slice to the next showed as a notch in the fender's outline and a crease across the hood).
			const RT_SLOPE = 0.5
			const sec = (x) => {
				const [yb, yt] = extentAt(pts, clamp(x, x0 + 1e-6, x1 - 1e-6))
				const W = Wp(x)
				const H = yt - yb
				const Wt = Math.max(0.45 * W, W - H * tanT)
				let yo = yb
				let zc = 0.8 * W
				for (const a of arches) {
					const dx = x - a.x
					if (Math.abs(dx) < a.R) yo = Math.max(yo, Math.min(a.cy + Math.sqrt(a.R * a.R - dx * dx), yt - skin))
					zc = Math.min(a.zc, W - 0.004)
				}
				return { yb, yt, W, H, Wt, yo, zc, base: Math.min(rt, H * 0.4, Wt * 0.45), lim: Math.max(0.0006, yt - crown - yo - 0.0012) }
			}
			const secs = xs.map((x) => sec(x))
			const rtUse = xs.map((x, i) => {
				let m = secs[i].base
				for (let j = 0; j < xs.length; j++) m = Math.min(m, secs[j].lim + RT_SLOPE * Math.abs(x - xs[j]))
				return m
			})
			const half = (x, si) => {
				const { yb, yt, W, H, Wt, yo, zc } = secs[si]
				const rt_ = rtUse[si]
				const arch = yo > yb + 1e-5
				const rb_ = arch ? Math.min(0.0012, rb) : Math.min(rb, H * 0.4, W * 0.4)
				const top = (z) => yt - crown * (z / Wt) * (z / Wt)
				const P = []
				const nTop = 5
				for (let i = 0; i <= nTop; i++) {
					const z = ((Wt - rt_) * i) / nTop
					P.push([z, top(z), 0])
				}
				const A = [Wt - rt_, top(Wt - rt_)]
				const C = [Wt, top(Wt)]
				const D = [W, yo]
				const sl = Math.hypot(D[0] - C[0], D[1] - C[1]) || 1
				const dir = [(D[0] - C[0]) / sl, (D[1] - C[1]) / sl]
				const B = [C[0] + dir[0] * rt_, C[1] + dir[1] * rt_]
				for (let i = 1; i <= 4; i++) {
					const q = bez(A, C, B, i / 4)
					P.push([q[0], q[1], 0])
				}
				const E1 = [D[0] - dir[0] * rb_, D[1] - dir[1] * rb_]
				P.push([(B[0] + E1[0]) / 2, (B[1] + E1[1]) / 2, 0])
				P.push([E1[0], E1[1], 0])
				const E2 = [W - rb_, yo]
				for (let i = 1; i <= 3; i++) {
					const q = bez(E1, D, E2, i / 3)
					P.push([q[0], q[1], i === 3 ? 1 : 0])
				}
				P.push([zc, yo, 1])
				P.push([zc, yb, 1])
				for (let i = 1; i <= 3; i++) P.push([(zc * (3 - i)) / 3, yb, 1])
				return P
			}
			const sample = xs.map((x, i) => half(x, i))
			const Nh = sample[0].length
			const N = 2 * Nh - 2
			const ringOf = (s) => {
				const h = sample[s]
				const out = []
				for (let j = 0; j < Nh; j++) out.push([h[j][0], h[j][1], h[j][2]])
				for (let j = Nh - 2; j >= 1; j--) out.push([-h[j][0], h[j][1], h[j][2]])
				return out
			}
			const rings = xs.map((_, s) => ringOf(s))
			const P = []
			for (let s = 0; s < xs.length; s++) for (let j = 0; j < N; j++) P.push(xs[s], rings[s][j][1], rings[s][j][0])
			const tris = [[], []]
			for (let s = 0; s < xs.length - 1; s++) {
				for (let j = 0; j < N; j++) {
					const j2 = (j + 1) % N
					const a = s * N + j
					const b = s * N + j2
					const c = (s + 1) * N + j2
					const d = (s + 1) * N + j
					const g = rings[s][j][2]
					tris[g].push(a, b, c, a, c, d)
				}
			}
			// end caps: a fan round the ring's middle
			const capTris = []
			for (const [s, flip] of [[0, true], [xs.length - 1, false]]) {
				let cy = 0
				let cz = 0
				for (let j = 0; j < N; j++) {
					cy += rings[s][j][1] / N
					cz += rings[s][j][0] / N
				}
				const ci = P.length / 3
				P.push(xs[s], cy, cz)
				for (let j = 0; j < N; j++) {
					const a = s * N + j
					const b = s * N + ((j + 1) % N)
					if (flip) capTris.push(ci, b, a)
					else capTris.push(ci, a, b)
				}
			}
			tris[capGroup].push(...capTris)
			const all = [...tris[0], ...tris[1]]
			// orientation: the signed volume must be positive (triangles wound counter-clockwise seen from outside)
			let vol = 0
			for (let t = 0; t < all.length; t += 3) {
				const a = all[t] * 3
				const b = all[t + 1] * 3
				const c = all[t + 2] * 3
				vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6
			}
			if (vol < 0) for (let t = 0; t < all.length; t += 3) [all[t + 1], all[t + 2]] = [all[t + 2], all[t + 1]]
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(P, 3))
			const uv = new Float32Array((P.length / 3) * 2)
			for (let i = 0; i < P.length / 3; i++) {
				uv[i * 2] = (P[i * 3] + P[i * 3 + 2] * 0.7) * uvScale
				uv[i * 2 + 1] = (P[i * 3 + 1] + P[i * 3 + 2] * 0.4) * uvScale
			}
			g.setAttribute("uv", new T.BufferAttribute(uv, 2))
			g.setIndex(all)
			g.addGroup(0, tris[0].length, 0)
			g.addGroup(tris[0].length, tris[1].length, 1)
			return L.creased(g, 38)
		})
	}

	/** The plan half-width function and the outline's extent, for placing things on the loft (lamps, mirrors). */
	function profileOf(outline, o) {
		const x0 = Math.min(...outline.map((p) => p[0]))
		const x1 = Math.max(...outline.map((p) => p[0]))
		const W = planWidth(x0, x1, o.hw, o.ends ?? {})
		return { x0, x1, W, extent: (x) => extentAt(outline, clamp(x, x0 + 1e-6, x1 - 1e-6)), tanT: Math.tan(((o.tumbleDeg ?? 0) * Math.PI) / 180) }
	}

	/**
	 * A thin band following the plan outline of an end of the body at x (nose or tail): the bumper. The loft's plan half-width W(x) gives the outline; the band is `thick`
	 * proud of it, `tall` high (y from y0 up), and wraps round the corners until the body is `wrap` narrower than hw. dir = +1 for the nose, -1 for the tail.
	 */
	function bumperBand(prof, hw, dir, { tall, thick, y0, wrap = 0.006, key = "" }) {
		return kit.geo(`veh|bumper|${key}|${dir}|${tall.toFixed(5)}|${thick.toFixed(5)}|${wrap.toFixed(5)}|${hw.toFixed(5)}|${prof.x0.toFixed(5)}|${prof.x1.toFixed(5)}`, () => {
			const xe = dir > 0 ? prof.x1 : prof.x0
			// z where the body is `wrap` narrower than hw, found along x
			const xAt = (zTarget) => {
				// the x (toward the end) where W(x) = zTarget, by bisection from the end inward
				let lo = 0
				let hi = 0.06
				for (let k = 0; k < 40; k++) {
					const mid = (lo + hi) / 2
					const w = prof.W(xe - dir * mid)
					if (w < zTarget) lo = mid
					else hi = mid
				}
				return (lo + hi) / 2
			}
			const wEnd = prof.W(xe)
			const zMax = hw - wrap
			const outer = []
			const n = 18
			for (let i = 0; i <= n; i++) {
				const z = -zMax + (2 * zMax * i) / n
				const az = Math.abs(z)
				const d = az <= wEnd ? 0 : xAt(az) // how far back from the end the body is at this |z|
				outer.push([xe - dir * d + dir * thick, z])
			}
			const inner = []
			for (let i = n; i >= 0; i--) {
				const z = -zMax + (2 * zMax * i) / n
				const az = Math.abs(z)
				const d = az <= wEnd ? 0 : xAt(az)
				inner.push([xe - dir * d - dir * 0.0003, z])
			}
			const shape = new T.Shape([...outer, ...inner].map(([x, z]) => new T.Vector2(x, -z)))
			const g = new T.ExtrudeGeometry(shape, { depth: tall - 0.0006, bevelEnabled: true, bevelThickness: 0.0003, bevelSize: 0.0002, bevelSegments: 1, curveSegments: 4 })
			g.translate(0, 0, 0.0003)
			g.rotateX(-Math.PI / 2) // shape (x, -z) with depth along y
			g.translate(0, y0, 0)
			return g
		})
	}

	return { bodyLoft, profileOf, extentAt, planWidth, bumperBand }
}
