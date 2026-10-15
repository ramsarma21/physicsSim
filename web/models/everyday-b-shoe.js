// The sneaker: a running shoe built from its physics outline (machines/catalog_everyday.py: a forefoot polygon and a heel polygon, toe to the right).
// Everything is built in the shoe's own millimetres (x from the heel back 0 to the toe tip 300, y up from the table, z across, centred), then scaled
// into the physics frame (origin at the middle of the 300 x 110 mm outline). The bottom edge of the sole and the top edge of the upper are the
// outline's own chords; between them: a thin dark outsole and a white midsole (both fading into a plain white heel cup at the back), the upper (a loft
// with the collar opening cut down into it, closed at the back by a white heel cup), a round toe cap, a heel counter that wraps the back, raised
// padded eyestays flanking a V-shaped throat, eyelets, laces with a real bow at the top, a padded collar and a thick padded tongue standing in the
// opening (its side flaps fill the collar dip, so the side view is solid up to the outline). In plan the heel is a semicircle and the inner (medial)
// side is relieved over the arch.
export default function register(addModel, L) {
	const { THREE, kit, TAU, rng, vnoise, fbm, clamp, mix, normalTex, mat, withRepeat, pixels, chordAt } = L
	const sm = (t) => t * t * (3 - 2 * t)

	const FORE = [[80, 0], [245, 0], [300, 18], [297, 34], [255, 58], [190, 88], [130, 110], [80, 86]]
	const HEEL = [[30, 0], [80, 0], [80, 86], [34, 100], [10, 92], [0, 52], [2, 14]]
	void FORE; void HEEL
	// the outline (the two polygons' union) with each corner eased (never more than ~1.5 mm off it): chord(x) = [bottom, top] there
	const UNION = [[2, 14], [30, 0], [245, 0], [300, 18], [297, 34], [255, 58], [190, 88], [130, 110], [80, 86], [34, 100], [10, 92], [0, 52]]
	const UR = [6, 11, 11, 5, 5, 3, 6, 5, 2, 5, 4, 6] // the radius eased at each corner above: tight where the silhouette must stay on the outline (the collar V, the toe's top)
	function roundPoly(pts, rs, per = 8) {
		const out = []
		const n = pts.length
		for (let i = 0; i < n; i++) {
			const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n]
			const la = Math.hypot(b[0] - a[0], b[1] - a[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1])
			const ra = Math.min(rs[i], la / 2), rc = Math.min(rs[i], lc / 2)
			const p0 = [b[0] + ((a[0] - b[0]) * ra) / la, b[1] + ((a[1] - b[1]) * ra) / la]
			const p2 = [b[0] + ((c[0] - b[0]) * rc) / lc, b[1] + ((c[1] - b[1]) * rc) / lc]
			for (let k = 0; k <= per; k++) {
				const t = k / per, u = 1 - t
				out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]])
			}
		}
		return out
	}
	const SMOOTH = roundPoly(UNION, UR, 8)
	const XMIN = Math.min(...SMOOTH.map((q) => q[0])), XMAX = Math.max(...SMOOTH.map((q) => q[0]))
	// chord(x) = [bottom, top] of the outline at x. Looked up many thousands of times (every vertex of every surface asks): tabulated once every 0.05 mm over the outline's length and interpolated
	// (the outline is flat or a gentle curve everywhere but a few millimetres at its two tips, where 0.05 mm steps are still far finer than a millimetre).
	const CH_STEP = 0.05
	const CH_N = Math.ceil((XMAX - XMIN - 0.3) / CH_STEP)
	let chordTab = null
	const chord = (x) => {
		if (!chordTab) {
			chordTab = new Float64Array((CH_N + 1) * 2)
			for (let i = 0; i <= CH_N; i++) { const c = chordAt(SMOOTH, XMIN + 0.15 + i * CH_STEP) ?? [0, 20]; chordTab[i * 2] = c[0]; chordTab[i * 2 + 1] = c[1] }
		}
		const u = clamp((x - XMIN - 0.15) / CH_STEP, 0, CH_N)
		const i = Math.min(CH_N - 1, Math.floor(u)), f = u - i
		return [chordTab[i * 2] + (chordTab[i * 2 + 2] - chordTab[i * 2]) * f, chordTab[i * 2 + 1] + (chordTab[i * 2 + 3] - chordTab[i * 2 + 1]) * f]
	}
	const interp = (tab, x) => {
		if (x <= tab[0][0]) return tab[0][1]
		for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) return mix(tab[i - 1][1], tab[i][1], (x - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]))
		return tab[tab.length - 1][1]
	}
	const bump = (x, a, b, c, d) => sm(clamp((x - a) / (b - a))) * (1 - sm(clamp((x - c) / (d - c)))) // 0 below a, 1 from b to c, 0 above d
	const spline = L.spline

	// ---- plan view: the heel is a semicircle of radius 37 mm, then the waist, the ball widest, a rounded toe box; the medial (-z) side is relieved over the arch
	const WTAB = spline([[37, 37.0], [60, 37.6], [90, 38.4], [120, 40.4], [150, 44.8], [180, 50.4], [205, 52.3], [235, 50.6], [262, 44.5], [276, 38.5], [287, 30], [294, 21], [298.5, 11], [299.8, 3]], 5)
	const SPAN = XMAX - XMIN
	const soleBase = (x) => { const xl = x - XMIN; return xl < 37 ? Math.sqrt(Math.max(0, 37 * 37 - (37 - xl) ** 2)) : interp(WTAB, (xl / SPAN) * 300) }
	const arch = (x) => 5 * bump(x, 85, 110, 135, 160)
	const soleHalf = (x, side = 1) => Math.max(0.05, soleBase(x) - (side < 0 ? arch(x) : 0)) // side +1 lateral (+z), -1 medial (-z)
	// The sole's own plan (outsole, midsole, stripe): drawn a hair inside the outline's two tips. The outline's back wall leans (the top at x 0, the bottom at x 2) and its front wall too (3 mm), and
	// both lower corners are rounded: at the end of a round plan the wall would shrink to a sliver and the bottom edge climb in a steep V. Pulled in by DH and DT (the outline's walls are then at
	// most ~1 mm from the sole's ends over the heights the sole occupies), the ends are clean arcs.
	const DH = 1.04, DT = 0.15
	const XTIP_H = XMIN + DH, XTIP_T = XMAX - DT
	const soleBaseS = (x) => { const xl = x - XTIP_H; return xl <= 0 ? 0 : xl < 37 ? Math.sqrt(Math.max(0, 37 * 37 - (37 - xl) ** 2)) : interp(WTAB, ((x - XMIN) / SPAN) * 300) }
	const soleHalfS = (x, side = 1) => Math.max(0.05, soleBaseS(x) - (side < 0 ? arch(x) : 0))
	// how far the upper sits inside the sole's edge: nearly flush round the heel (one white surface), a lip along the rest. Over the toe the plan's edge runs steeply across x (the toe is a blunt arc), so an inset
	// measured along z is much less than the same inset measured square to the edge: there it grows to keep the upper's skin (with the toe cap's 0.45) 1.5 mm square-on inside the foam bumper's wall
	const inset = (x) => Math.max(mix(0.55, 1.9, sm(clamp((x - 14) / 46))) + 0.5 * bump(x, 12, 22, 36, 60), x > 250 ? 1.5 * Math.hypot(1, (soleBase(Math.min(x + 0.6, XMAX - 0.3)) - soleBase(x - 0.6)) / 1.2) : 0)
	const upperHalf = (x, side = 1) => Math.max(0.05, soleHalf(x, side) - inset(x))
	const soleTh = (x) => interp([[0, 28], [40, 27.5], [100, 23], [170, 19.5], [240, 17.2], [300, 17]], x) // sole thickness above the bottom outline
	const ySole = (x) => { const [lo, hi] = chord(x); return Math.min(chord(Math.max(x, 5))[0] + soleTh(x), hi - 3.6) } // (the sole's top does not climb the rounded back corner)
	const yTop = (x) => chord(x)[1]
	// the top of the upper: under the outline by the collar dip (the quarters fall 5 mm below the tongue), by the eyestays' height (lace area) and at the toe
	const dip = (x) => 5 * bump(x, 94, 108, 116, 128)
	const laceDrop = (x) => 3.2 * sm(clamp((x - 126) / 12)) * (1 - sm(clamp((x - 224) / 10))) // the lace area sits 3.2 mm under the outline up to the last eyelet row (x 224), so the eyelets and laces stay within about 1 mm of the outline
	// over the last ~8 mm the vamp's top sinks into the foam toe bumper (a real toe bumper wraps the vamp's tip): at the vamp's end (XU_END) its end face lies ~2 mm inside the foam, so no edge of
	// leather or knit shows in front of the bumper's rounded wall
	const toeDive = (x) => 3.2 * sm(clamp((x - 290) / 6))
	// the upper's foot sinks deeper into the foam where the foam's rounded shoulder falls away beside it: at the toe (the sole line falls and the plan's edge runs steeply) and round the back, where the upper
	// sits nearly flush with the foam's wall (a foot left at the shoulder's top would float above it and show the knit through the gap)
	const baseSink = (x) => 1.6 * sm(clamp((x - 286) / 6)) + 2.3 * (1 - sm(clamp((x - 5) / 55)))
	const yBase = (x, y1) => Math.min(ySole(x) + 2.0 - baseSink(x), y1 - 0.4) // where the upper's wall starts (its foot, inside the foam)
	const yUp = (x) => yTop(x) - 0.7 * sm(clamp((x - 262) / 22)) - dip(x) - laceDrop(x) - toeDive(x)
	// the collar opening in plan: from the heel tab to the throat, narrowing to a point at each end
	const XO0 = 12, XO1 = 128
	const openHalf = (x) => {
		if (x <= XO0 || x >= XO1) return 0
		const t = (x - XO0) / (XO1 - XO0)
		const e = Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))
		return Math.max(0, (upperHalf(x) - 5.4) * Math.pow(e, t < 0.5 ? 0.8 : 1.7))
	}
	const NSE = (x) => mix(2.5, 2.1, sm(clamp((x - 235) / 50))) // the upper's cross-section exponent (2 = ellipse): rounder in the toe box

	// a point on the outer surface of one side of the upper: x along the shoe, a in 0..1 from the sole line up to the rim (or the top)
	const upperPoint = (x, a, side = 1) => {
		const y1 = yUp(x), y0 = yBase(x, y1)
		const ow = openHalf(x), wu = Math.max(upperHalf(x, side), ow + 0.02)
		const ph = a * (Math.PI / 2), n = NSE(x)
		const c = Math.pow(Math.max(0, Math.cos(ph)), 2 / n), s = Math.pow(Math.max(0, Math.sin(ph)), 2 / n)
		return [x, y0 + Math.max(0, y1 - y0) * s, side * (ow + (wu - ow) * c)]
	}
	// the dome height at z over the closed top (laces, stays, tongue)
	const domeY = (x, z) => {
		const y1 = yUp(x), y0 = yBase(x, y1), wu = upperHalf(x, z < 0 ? -1 : 1)
		const zz = clamp(Math.abs(z) / wu, 0, 1)
		return y0 + (y1 - y0) * Math.pow(Math.max(0, 1 - Math.pow(zz, NSE(x))), 1 / NSE(x))
	}

	// the tongue: a padded flap standing in the opening and running on under the laces; its top lies under the outline by `sag`, its side flaps hang 18 mm below the top
	const TX0 = 96, TX1 = 172
	const tongueTh = (x) => 4.5 + 13.5 * sm(clamp((x - TX0) / 24)) // its thickness below the top: a thin edge at the back, a deep pad from the throat on (its underside ramps down into the opening)
	const tongueSag = (x) => interp([[96, 0.6], [110, 0.6], [118, 2.0], [123, 2.9], [131, 2.4], [140, 2.6], [152, 2.0], [172, 1.9]], x)
	const tongueTop = (x) => yTop(x) - tongueSag(x)
	const hzTongue = (x) => { const w = mix(14.5, 12.8, clamp((x - 136) / 36)); return Math.max(0.05, w * Math.sqrt(Math.max(0, 1 - Math.pow(clamp((TX0 + 9 - x) / 9), 2))) * Math.sqrt(Math.max(0, 1 - Math.pow(clamp((x - (TX1 - 9)) / 9), 2)))) }
	const TONGUE_RT = 5.5
	const tongueCrown = (x, z) => { const e = Math.abs(z) - (hzTongue(x) - TONGUE_RT); return e <= 0 ? 0 : TONGUE_RT - Math.sqrt(Math.max(0, TONGUE_RT * TONGUE_RT - e * e)) }

	// ---------------------------------------------------------- loft helper: rings -> an indexed mesh with one group per ring-index range
	/** rings: [{x, pts: [[y, z], ...]}] all the same count (closed); groups: [{from, to}] ring-index ranges (one material each). uv = (x fraction, index fraction). */
	function loft(rings, groups) {
		const n = rings.length, m = rings[0].pts.length
		const pos = [], uv = []
		const x0 = rings[0].x, x1 = rings[n - 1].x
		for (let i = 0; i < n; i++) for (let j = 0; j <= m; j++) {
			const p = rings[i].pts[j % m]
			pos.push(rings[i].x, p[0], p[1])
			uv.push((rings[i].x - x0) / (x1 - x0 || 1), j / m)
		}
		const row = m + 1
		const idx = []
		const gr = []
		for (const g of groups) {
			const start = idx.length
			for (let i = 0; i < n - 1; i++) for (let j = g.from; j < g.to; j++) {
				const a = i * row + j, b = a + 1, c = a + row, d = c + 1
				idx.push(a, b, c, b, d, c)
			}
			gr.push([start, idx.length - start])
		}
		// wind the faces outward: the vertex with the largest z of the middle ring must face away from the ring's centre
		const ring = rings[Math.floor(n / 2)]
		let cy = 0, cz = 0
		for (const q of ring.pts) { cy += q[0]; cz += q[1] }
		cy /= m; cz /= m
		const j = ring.pts.reduce((best, q, k) => (q[1] > ring.pts[best][1] ? k : best), 0)
		const i = Math.floor(n / 2)
		const a = i * row + j, b = a + 1, c = a + row
		const P = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2])
		const nrm = new THREE.Vector3().subVectors(P(b), P(a)).cross(new THREE.Vector3().subVectors(P(c), P(a)))
		if (nrm.dot(new THREE.Vector3(0, ring.pts[j][0] - cy, ring.pts[j][1] - cz)) < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t }
		const geo = new THREE.BufferGeometry()
		geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
		geo.setIndex(idx)
		gr.forEach(([s, cnt], k) => geo.addGroup(s, cnt, k))
		geo.computeVertexNormals()
		const nr = geo.attributes.normal // one smooth normal across the closing seam
		for (let r = 0; r < n; r++) {
			const a0 = r * row, b0 = a0 + m
			const v = new THREE.Vector3().fromBufferAttribute(nr, a0).add(new THREE.Vector3().fromBufferAttribute(nr, b0)).normalize()
			nr.setXYZ(a0, v.x, v.y, v.z)
			nr.setXYZ(b0, v.x, v.y, v.z)
		}
		return geo
	}
	/** A flat fan closing the end of a loft: the first or last ring, facing -x or +x (the rings already shrink to almost nothing there). */
	function endCap(ring, dir) {
		const m = ring.pts.length
		let cy = 0, cz = 0
		for (const q of ring.pts) { cy += q[0]; cz += q[1] }
		cy /= m; cz /= m
		const pos = [ring.x, cy, cz]
		for (const q of ring.pts) pos.push(ring.x, q[0], q[1])
		const idx = []
		for (let k = 0; k < m; k++) idx.push(0, 1 + k, 1 + ((k + 1) % m))
		const geo = new THREE.BufferGeometry()
		geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		geo.setIndex(idx)
		geo.computeVertexNormals()
		const nrm = geo.attributes.normal
		if (nrm.getX(0) * dir < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t } geo.setIndex(idx); geo.computeVertexNormals() }
		return geo
	}

	/** A rounded-rectangle ring [y, z] pairs: bottom y0, top y1, half width hz, bottom corner radius rb, top corner radius rt; shifted by dz across. */
	function sectionRing(y0, y1, hz, rb, rt, seg = 5, dz = 0) {
		const pts = []
		const arc = (cy, cz, r, a0, a1) => { for (let k = 0; k <= seg; k++) { const a = mix(a0, a1, k / seg); pts.push([cy + r * Math.sin(a), dz + cz + r * Math.cos(a)]) } }
		const lim = Math.max(1e-3, Math.min((y1 - y0) / 2, hz) - 1e-3)
		rb = Math.max(1e-3, Math.min(rb, lim)); rt = Math.max(1e-3, Math.min(rt, lim))
		arc(y1 - rt, hz - rt, rt, 0, Math.PI / 2)
		arc(y1 - rt, -(hz - rt), rt, Math.PI / 2, Math.PI)
		arc(y0 + rb, -(hz - rb), rb, Math.PI, Math.PI * 1.5)
		arc(y0 + rb, hz - rb, rb, Math.PI * 1.5, TAU)
		return pts
	}
	/** The same for a section whose lateral (+z) and medial (-z) half widths differ. */
	const asymRing = (y0, y1, hzL, hzM, rb, rt, seg = 5) => sectionRing(y0, y1, (hzL + hzM) / 2, rb, rt, seg, (hzL - hzM) / 2)

	// ---------------------------------------------------------- the ends of the plan: polar caps
	// An x-loft shrinks to slivers where the plan closes (the heel is a semicircle of radius 37, the toe a blunt 6 mm tip) while the outline's height stays (a tall back wall): the ring quads
	// there are long and thin and their normals crease. So the sole and the heel cup are lofted only where the plan is wide, and each end is closed by a cap built in polar form about the
	// middle C of the chord where it joins the loft: columns run round the plan outline (evenly by length), rows from the pole C out over the top face, down the rounded wall and over the bottom
	// face. Every vertex takes its height from the same analytic surface as the loft (from its plan position), so the shape is the same: only the quads stay square.
	const R_H = 37 // the heel semicircle's radius, as in the plan above
	const CXH = XTIP_H + R_H // its centre (the sole's plan): where the loft of the sole starts at the heel
	const XT = XMIN + (262 * SPAN) / 300 // where the plan's toe curve starts: where the loft of the sole ends at the toe
	/** An open polyline [[x, z], ...] resampled to n + 1 points evenly spaced by length. */
	function resampleOpen(pts, n) {
		const cum = [0]
		for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
		const total = cum[cum.length - 1]
		const out = []
		let k = 1
		for (let i = 0; i <= n; i++) {
			const sLen = (total * i) / n
			while (k < pts.length - 1 && cum[k] < sLen) k++
			const t = clamp((sLen - cum[k - 1]) / (cum[k] - cum[k - 1] || 1))
			out.push([mix(pts[k - 1][0], pts[k][0], t), mix(pts[k - 1][1], pts[k][1], t)])
		}
		return out
	}
	/** The plan outline round one end: from the chord at x = xa (its +z end) round the tip at x = xb to the chord's -z end, as n + 1 points even by length. half(x) = the plan's half width. */
	function endRim(half, xa, xb, n) {
		const side = []
		const M = 200
		for (let i = 0; i <= M; i++) { const u = i / M; const x = xa + (xb - xa) * (1 - (1 - u) * (1 - u)); side.push([x, half(x)]) } // (bunched toward the tip, where the outline turns fast)
		return resampleOpen(side.concat(side.slice().reverse().map(([x, z]) => [x, -z])), n)
	}
	/**
	 * A polar cap. C = [x, z] the middle of the joining chord; rim = J + 1 points [x, z] on the plan outline, from the chord's +z end round the tip to its -z end; rows (top to bottom):
	 * {d(xr)} a row d in from the rim along the outline's normal, or {t, inner(xr)} a row t (0 = the pole C, 1 = the rim moved in by inner) of the way out from C; y(x, z) its height there;
	 * ring: [i, k] = which ring point of the loft's end ring (+z side, -z side) it joins (for matching normals). uv: u by x between x0 and x1, v by row.
	 */
	function polarCap({ C, rim, rows, x0, x1 }) {
		const J = rim.length - 1, Rn = rows.length
		const nrm = rim.map((p, j) => {
			const a = rim[Math.max(0, j - 1)], b = rim[Math.min(J, j + 1)]
			let tx = b[0] - a[0], tz = b[1] - a[1]
			const l = Math.hypot(tx, tz) || 1
			tx /= l; tz /= l
			let nx = tz, nz = -tx
			if (nx * (p[0] - C[0]) + nz * (p[1] - C[1]) < 0) { nx = -nx; nz = -nz }
			return [nx, nz]
		})
		const pos = new Float32Array((J + 1) * Rn * 3), uv = new Float32Array((J + 1) * Rn * 2)
		for (let j = 0; j <= J; j++) {
			const [px, pz] = rim[j], [nx, nz] = nrm[j]
			for (let r = 0; r < Rn; r++) {
				const row = rows[r]
				let x, z
				if (row.t !== undefined) { const d = row.inner(px); x = C[0] + row.t * (px - d * nx - C[0]); z = C[1] + row.t * (pz - d * nz - C[1]) }
				else { const d = row.d(px); x = px - d * nx; z = pz - d * nz }
				const k = (j * Rn + r) * 3
				pos[k] = x; pos[k + 1] = row.y(x, z, row.t); pos[k + 2] = z
				uv[(j * Rn + r) * 2] = (x - x0) / (x1 - x0)
				uv[(j * Rn + r) * 2 + 1] = r / (Rn - 1)
			}
		}
		const idx = []
		const at = (j, r) => (j * Rn + r) * 3
		const area2 = (a, b, c) => {
			const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
			return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
		}
		const tri = (a, b, c) => { if (area2(at(...a), at(...b), at(...c)) > 1e-9) idx.push(a[0] * Rn + a[1], b[0] * Rn + b[1], c[0] * Rn + c[1]) }
		for (let j = 0; j < J; j++) for (let r = 0; r < Rn - 1; r++) { tri([j, r], [j + 1, r], [j + 1, r + 1]); tri([j, r], [j + 1, r + 1], [j, r + 1]) }
		// face outward: the triangles' normals, summed against the vectors from a point inside the solid (the centroid of the cap's vertices), must come out positive (the divergence theorem's sign)
		{
			let ox = 0, oy = 0, oz = 0
			for (let k = 0; k < pos.length; k += 3) { ox += pos[k]; oy += pos[k + 1]; oz += pos[k + 2] }
			ox /= pos.length / 3; oy /= pos.length / 3; oz /= pos.length / 3
			let sum = 0
			for (let t = 0; t < idx.length; t += 3) {
				const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
				const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
				sum += (uy * vz - uz * vy) * (pos[a] - ox) + (uz * vx - ux * vz) * (pos[a + 1] - oy) + (ux * vy - uy * vx) * (pos[a + 2] - oz)
			}
			if (sum < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t }
		}
		const geo = new THREE.BufferGeometry()
		geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
		geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
		geo.setIndex(idx)
		geo.computeVertexNormals()
		// one normal for every copy of a pole (all columns share the point)
		const nr = geo.attributes.normal
		rows.forEach((row, r) => {
			if (row.t !== 0) return
			const v = new THREE.Vector3()
			for (let j = 0; j <= J; j++) v.add(new THREE.Vector3().fromBufferAttribute(nr, j * Rn + r))
			v.normalize()
			for (let j = 0; j <= J; j++) nr.setXYZ(j * Rn + r, v.x, v.y, v.z)
		})
		return { geo, J, Rn, rows }
	}
	/** Where a cap joins a loft's end ring (index ringI of m points + the seam copy), both smooth: the shared vertices get the average of their two normals. */
	function joinNormals(cap, loftGeo, ringI, m) {
		const cn = cap.geo.attributes.normal, ln = loftGeo.attributes.normal, row = m + 1
		const v = new THREE.Vector3()
		cap.rows.forEach((r, ri) => {
			if (!r.ring) return
			;[[0, r.ring[0]], [cap.J, r.ring[1]]].forEach(([col, k]) => {
				const ci = col * cap.Rn + ri, li = ringI * row + k
				v.set(cn.getX(ci) + ln.getX(li), cn.getY(ci) + ln.getY(li), cn.getZ(ci) + ln.getZ(li)).normalize()
				cn.setXYZ(ci, v.x, v.y, v.z)
				ln.setXYZ(li, v.x, v.y, v.z)
				if (k === 0) ln.setXYZ(ringI * row + m, v.x, v.y, v.z) // (the ring's seam copy of point 0)
			})
		})
	}
	/**
	 * The rows of a polar cap for a rounded section made by sectionRing (seg segments per corner): `f(x)` = {lo, top, rb, rt, ins} (the section at x: its bottom and top height, corner radii, how far
	 * in from the plan outline its wall stands). Top face (3 rows from the pole), the top corner, the bottom corner, the bottom face; each row's ring point matches sectionRing's order.
	 */
	function roundedRows(seg, f, tops = [0, 0.4, 0.75]) {
		const rows = []
		for (const t of tops) rows.push({ t, inner: (xr) => f(xr).ins + f(xr).rt, y: (x) => f(x).top })
		for (let k = seg; k >= 0; k--) {
			const a = (Math.PI / 2) * (k / seg)
			rows.push({ d: (xr) => f(xr).ins + f(xr).rt * (1 - Math.cos(a)), y: (x) => f(x).top - f(x).rt + f(x).rt * Math.sin(a), ring: [k, 2 * seg + 1 - k] })
		}
		for (let k = seg; k >= 0; k--) {
			const a = Math.PI * 1.5 + (Math.PI / 2) * (k / seg)
			rows.push({ d: (xr) => f(xr).ins + f(xr).rb * (1 - Math.cos(a)), y: (x) => f(x).lo + f(x).rb + f(x).rb * Math.sin(a), ring: [3 * seg + 3 + k, 3 * seg + 2 - k] })
		}
		for (const t of [0.75, 0.4, 0]) rows.push({ t, inner: (xr) => f(xr).ins + f(xr).rb, y: (x) => f(x).lo })
		return rows
	}

	/** A flat lace: an elliptical section (half width hw across, half thickness ht) swept along a curve through `points`, lying flat (its width across the curve and the up direction). */
	function band(points, hw, ht, { closed = false, seg = 16, rad = 6, upAt = null } = {}) {
		const curve = new THREE.CatmullRomCurve3(points, closed)
		const count = closed ? seg : seg + 1
		const pos = [], idx = []
		const up = new THREE.Vector3(0, 1, 0)
		for (let i = 0; i < count; i++) {
			const t = i / seg
			const p = curve.getPoint(t), T = curve.getTangent(t)
			const B = new THREE.Vector3().crossVectors(T, upAt ? upAt(p) : up)
			if (B.lengthSq() < 1e-6) B.set(0, 0, 1)
			B.normalize()
			const N = new THREE.Vector3().crossVectors(B, T).normalize()
			for (let j = 0; j < rad; j++) {
				const a = (j / rad) * TAU
				pos.push(p.x + B.x * hw * Math.cos(a) + N.x * ht * Math.sin(a), p.y + B.y * hw * Math.cos(a) + N.y * ht * Math.sin(a), p.z + B.z * hw * Math.cos(a) + N.z * ht * Math.sin(a))
			}
		}
		const rings = closed ? count : count - 1
		for (let i = 0; i < rings; i++) {
			const i1 = (i + 1) % count
			for (let j = 0; j < rad; j++) {
				const j1 = (j + 1) % rad
				const a = i * rad + j, b = i * rad + j1, c = i1 * rad + j, d = i1 * rad + j1
				idx.push(a, c, b, b, c, d)
			}
		}
		const geo = new THREE.BufferGeometry()
		geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		geo.setIndex(idx)
		geo.computeVertexNormals()
		// face outward: ring 0's first vertex lies at +B (j = 0): its normal must point away from the centre line
		const c0 = points[0]
		const nrm = new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, 0)
		const v0 = new THREE.Vector3(pos[0], pos[1], pos[2]).sub(curve.getPoint(0))
		if (nrm.dot(v0) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t } geo.setIndex(idx); geo.computeVertexNormals() }
		void c0
		return geo
	}

	// ---------------------------------------------------------- textures
	const knitNormal = () => normalTex("eb-shoe-knit2", 128, 128, (g, W, H) => {
		g.fillStyle = "#808080"
		g.fillRect(0, 0, W, H)
		g.strokeStyle = "#e6e6e6"
		g.lineWidth = 5
		g.lineCap = "round"
		for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
			const x = i * 16 + 8, y = j * 16 + 8
			g.beginPath(); g.moveTo(x - 5, y - 6); g.lineTo(x, y + 5); g.lineTo(x + 5, y - 6); g.stroke()
		}
		g.strokeStyle = "#282828"
		g.lineWidth = 2
		for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const x = i * 16 + 8, y = j * 16 + 8; g.beginPath(); g.moveTo(x - 8, y + 7); g.lineTo(x + 8, y + 7); g.stroke() }
	}, { strength: 2.0, blur: 0.8 })
	const foamNormal = () => normalTex("eb-shoe-foam", 128, 128, (g, W, H) => pixels(g, W, H, (x, y) => { const v = 100 + 130 * fbm(x / 3.5, y / 3.5, 3, 41, 36); return [v, v, v] }), { strength: 1.3 })

	// ---------------------------------------------------------- the model
	// The shoe is built once, in its own millimetres (nothing in it depends on the item's size or colour), and every size is that same model scaled: a resize slider step costs a clone, not a rebuild.
	const buildBase = () => {
		const g = kit.group()
		const blue = "#0a3a8c"
		const whiteLeather = mat("eb-shoe-leather", { color: "#f3f1ea", roughness: 0.4, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3 })
		const accent = mat("eb-shoe-accent", { color: "#e2600a", roughness: 0.4, metalness: 0, clearcoat: 0.4, toneMapped: false })
		const knit = mat(`eb-shoe-upper2|${blue}`, { color: blue, roughness: 0.85, metalness: 0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: "#5d86c4", normalMap: withRepeat(knitNormal(), 11, 8), normalScale: new THREE.Vector2(0.55, 0.55), toneMapped: false })
		const tongueMat = mat("eb-shoe-tongue2", { color: "#0c4aa8", roughness: 0.9, metalness: 0, sheen: 0.5, sheenRoughness: 0.55, sheenColor: "#7c9fd8", normalMap: withRepeat(knitNormal(), 5, 4), normalScale: new THREE.Vector2(0.45, 0.45), toneMapped: false })
		const lining = mat("eb-shoe-lining", { color: "#23262c", roughness: 0.95, metalness: 0, sheen: 0.5, sheenColor: "#6b7385", side: THREE.DoubleSide })
		const foam = mat("eb-shoe-foam", { color: "#f4f2ec", roughness: 0.6, metalness: 0, normalMap: withRepeat(foamNormal(), 30, 3), normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 0.12, clearcoatRoughness: 0.5 })
		const rubber = mat("eb-shoe-outsole", { color: "#222328", roughness: 0.78, metalness: 0 })
		const lace = mat("eb-shoe-lace", { color: "#f7f6f1", roughness: 0.85, metalness: 0, sheen: 0.6, sheenColor: "#ffffff" })
		const steel = kit.metal("#cfd3d8", { roughness: 0.28 })
		const hole = mat("eb-shoe-eyelet-hole", { color: "#101114", roughness: 0.9, metalness: 0 })

		// the rings' x stations: wherever the outline, the plan or the collar opening changes fast (the rounded back, the toe tip, the opening's ends) they bunch up
		const XC = XO0 // the white heel cup (a tab behind the opening) ends here
		const XS = [XMIN + 0.03]
		{
			const xe = XMAX - 0.25
			let x = XS[0]
			const probe = (xx) => { const c = chord(xx); return [c[0], c[1], soleHalf(xx), openHalf(xx)] }
			while (x < xe - 1e-6) {
				const a = probe(x)
				let dx = 6.2
				const tight = x < 16 || x > 256 // the rounded back corner and the toe box turn fast: finer stations there
				const tolY = tight ? 1.9 : 3.4, tolZ = tight ? 3.2 : 5
				for (let k = 0; k < 18; k++) {
					const b = probe(Math.min(x + dx, xe))
					if (Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) <= tolY && Math.abs(b[2] - a[2]) <= tolZ && Math.abs(b[3] - a[3]) <= 4) break
					dx *= 0.62
				}
				x = Math.min(x + Math.max(dx, 0.04), xe)
				XS.push(x)
			}
			if (!XS.some((v) => Math.abs(v - XC) < 0.05)) XS.push(XC)
			g.userData.stations = XS.length
			XS.sort((p, q) => p - q)
			for (let k = XS.length - 1; k > 0; k--) if (XS[k] - XS[k - 1] < 0.04) XS.splice(k, 1)
		}
		// the static pieces that share a material (and whether they cast a shadow) are merged into one mesh each at the end: about 15 draw calls for the whole shoe
		const batches = new Map()
		const put = (geo, material, cast = true) => {
			const k = `${material.uuid}|${cast}`
			let b = batches.get(k)
			if (!b) batches.set(k, (b = { material, cast, geos: [] }))
			b.geos.push(geo)
		}
		const closed = (rings, material) => {
			put(loft(rings, [{ from: 0, to: rings[0].pts.length }]), material)
			put(endCap(rings[0], -1), material)
			put(endCap(rings[rings.length - 1], 1), material)
		}

		// ---- the sole: a dark outsole under a white midsole whose top edge rises a few millimetres round the upper; both fade into the white heel at the very back.
		// Each is lofted along x only where the plan is wide (CXH .. XT) and closed at the heel and the toe by a polar cap (see polarCap).
		const osFade = (x) => sm(clamp((x - 2) / 20)) // 0 at the heel's back corner, 1 from 22 mm on
		const foamTop = (x) => Math.min(ySole(x) + 2.8, yTop(x) - 0.3)
		const xlo = (x) => Math.max(x, 2.2) // (the bottom edge stops climbing the leaning, rounded back corner)
		const XFR = 297.5 // and the sole's heights stop changing 2 mm short of the toe's tip: there the outline's front wall leans back and its corners round off, so over the last millimetres its top falls and its bottom climbs to a 3 mm sliver
		const loS = (x) => { let a = 0; for (let k = -3; k <= 3; k++) a += chord(xlo(Math.min(x + k * 1.2, XFR)))[0]; return a / 7 } // the outline's bottom, smoothed over +-3.6 mm (a polygon's corners as a soft edge)
		const fOut = (x) => { const lo = loS(x), top = lo + 0.08 + 4.12 * osFade(x), lim = Math.max(1e-3, (top - lo) / 2 - 1e-3); return { lo, top, rb: Math.min(1.6, lim), rt: Math.min(0.4, lim), ins: 0.1 } }
		const fFoam = (x) => { // (the toe bumper's top is rounded across into a low dome as the foam rises to meet the cap)
			const nose = sm(clamp((x - 293) / 3)) // over the last few millimetres the bumper is fuller (its top 0.55 mm higher, its shoulder tighter), so its silhouette keeps to the outline's rounded nose
			const lo = loS(x) + 3.6 * osFade(x), top = Math.max(lo + 1, foamTop(Math.min(x, XFR)) + 0.55 * nose), lim = Math.max(1e-3, (top - lo) / 2 - 1e-3)
			return { lo, top, rb: Math.min(1.2, lim), rt: Math.min(mix(3.2, 2.2, nose), 0.7 + 2.2 * (inset(x) - 0.45), 0.95 * ((top - lo) / 2), lim), ins: 0.45 } // (round the back, where the upper stands nearly flush with the foam's wall, the foam's top edge is tight: a wide rounding would fall away from the upper's wall as a groove)
		}
		// where the toe's skins run in under the foam bumper's lid (the lid is the foam's top, fFoam(x).top, over the toe) they turn down more steeply: within 2 mm above the lid a point is pulled
		// down by up to 1.5 mm, so the leather meets the lid at about 2.5 times the angle and the line where the two cross is clean (at the shallow angle their facets crossed in a sawtooth). The knit
		// under the leather is pulled the same way by its own height, which pulls it further: it stays under the leather.
		const underLid = (x, y) => { if (x <= 262) return 0; const h = y - fFoam(Math.min(x, XMAX)).top; return h >= 2 ? 0 : 1.5 * (1 - Math.max(0, h) / 2) ** 2 }
		const XL = [CXH, ...XS.filter((x) => x > CXH + 0.5 && x < XT - 0.5), XT]
		const TOE_TOPS = [0, 0.2, 0.4, 0.58, 0.7, 0.79, 0.86, 0.93, 0.97]
		const solePart = (f, seg, material) => {
			const rings = XL.map((x) => { const q = f(x); return { x, pts: asymRing(q.lo, q.top, soleHalfS(x) - q.ins, soleHalfS(x, -1) - q.ins, q.rb, q.rt, seg) } })
			const m = rings[0].pts.length
			const lg = loft(rings, [{ from: 0, to: m }])
			const rows = roundedRows(seg, f)
			const toeRows = f === fFoam ? roundedRows(seg, f, TOE_TOPS) : rows // (the bumper's lid follows the outline's top over ~35 mm: rows every ~4 mm, so the vamp can sink under it)
			const heel = polarCap({ C: [CXH, 0], rim: endRim(soleHalfS, CXH, XTIP_H, 36), rows, x0: CXH, x1: XT })
			const toe = polarCap({ C: [XT, 0], rim: endRim(soleHalfS, XT, XTIP_T, 36), rows: toeRows, x0: CXH, x1: XT })
			joinNormals(heel, lg, 0, m)
			joinNormals(toe, lg, rings.length - 1, m)
			put(lg, material)
			put(heel.geo, material)
			put(toe.geo, material)
		}
		solePart(fOut, 2, rubber)
		solePart(fFoam, 3, foam)
		// a thin coloured stripe all the way round the midsole: ONE closed flat tube along the plan outline, at a constant 10 mm over the foam's bottom (never above half the foam's height; its height and
		// thickness follow the foam where that thins at the tips, smoothed along the loop), a quarter millimetre proud of the foam's wall. (As a loft along x it broke at the heel's back corner and at the
		// toe tip, where the plan closes.)
		{
			const sec = (x) => { const q = fFoam(x); return { lo: q.lo, top: q.top, loc: loS(x) } } // (loc: the outline's bottom: the stripe's height does not ride the foam's fade at the heel)
			const side = (sgn) => { const o = []; for (let x = CXH + 3; x < XT - 2; x += 3) o.push([x, sgn * soleHalfS(x, sgn)]); return o }
			const loop = [...endRim(soleHalfS, CXH, XTIP_H, 40), ...side(-1), ...endRim(soleHalfS, XT, XTIP_T, 40).reverse(), ...side(1).reverse()]
			const N = 200
			const pl = resampleOpen([...loop, loop[0]], N).slice(0, N)
			const cx = pl.reduce((a, q) => a + q[0], 0) / N
			const nrm = pl.map((q, i) => {
				const a = pl[(i + N - 1) % N], b = pl[(i + 1) % N]
				let tx = b[0] - a[0], tz = b[1] - a[1]
				const l = Math.hypot(tx, tz) || 1
				tx /= l; tz /= l
				let nx = tz, nz = -tx
				if (nx * (q[0] - cx) + nz * q[1] < 0) { nx = -nx; nz = -nz }
				return [nx, nz]
			})
			const smooth = (v, k) => v.map((_, i) => { let a = 0; for (let d = -k; d <= k; d++) a += v[(i + d + N) % N]; return a / (2 * k + 1) })
			const S = pl.map((q) => sec(q[0]))
			const ym = smooth(S.map((q) => { const base = q.loc + 3.6; return base + Math.min(10, (q.top - base) * 0.5) }), 5)
			const ht = smooth(S.map((q) => Math.min(1.1, 0.42 * (q.top - q.lo))), 3)
			const hwR = 0.5, rad = 5
			const pos = [], idx = []
			for (let i = 0; i < N; i++) {
				const h = Math.min(ht[i], Math.max(0.2, Math.min(ym[i] - S[i].lo, S[i].top - ym[i]) - 0.1)) // (inside the foam's height)
				for (let j = 0; j < rad; j++) {
					const a = (j / rad) * TAU
					pos.push(pl[i][0] - (0.2 + hwR) * nrm[i][0] + nrm[i][0] * hwR * Math.cos(a), ym[i] + h * Math.sin(a), pl[i][1] - (0.2 + hwR) * nrm[i][1] + nrm[i][1] * hwR * Math.cos(a))
				}
			}
			for (let i = 0; i < N; i++) {
				const i1 = (i + 1) % N
				for (let j = 0; j < rad; j++) { const j1 = (j + 1) % rad, a = i * rad + j, b = i * rad + j1, c = i1 * rad + j, d = i1 * rad + j1; idx.push(a, c, b, b, c, d) }
			}
			const tg = new THREE.BufferGeometry()
			tg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			tg.setIndex(idx)
			tg.computeVertexNormals()
			{ // the vertex at the outside of ring 0 (j = 0) must face along that ring's outward normal
				const n0 = new THREE.Vector3().fromBufferAttribute(tg.attributes.normal, 0)
				if (n0.x * nrm[0][0] + n0.z * nrm[0][1] < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t } tg.setIndex(idx); tg.computeVertexNormals() }
			}
			put(tg, accent)
		}

		// ---- the upper: sidewalls up to the collar rim, a pit down to the footbed where the foot goes in, closing into the vamp toward the toe;
		// the back (behind the opening) is a white heel cup
		const NA = 15, NB = 4, NC = 4
		const XU_END = XTIP_T - 3.0 // (the vamp ends 3 mm inside the sole's front wall, sunk (toeDive) well inside the foam bumper: a vamp end level with the foam's wall overhung it and hid the stripe)
		const XDV = 283 // from here to the vamp's end the top sinks into the bumper (toeDive) and curves fast: a station every ~2 mm keeps the knit's chords inside the toe cap's
		const XU = [XC, ...XS.filter((x) => x > XC + 0.05 && x < XDV), ...Array.from({ length: Math.ceil((XU_END - XDV) / 2.0) }, (_, k) => XDV + (k * (XU_END - XDV)) / Math.ceil((XU_END - XDV) / 2.0)), XU_END] // the vamp runs on over the toe to the tip (the foam bumper is only a low rim under it); behind XC the heel cup is a polar cap
		const upperRings = XU.map((x) => {
			const y1 = yUp(x), y0 = yBase(x, y1)
			const ow = openHalf(x)
			const pts = []
			for (let k = 0; k < NA; k++) { const p = upperPoint(x, k / (NA - 1), 1); pts.push([p[1] - underLid(x, p[1]), p[2]]) } // outer right wall: sole line to the rim
			const rho = Math.min(3.0, ow * 0.7)
			const floor = Math.min(y1, Math.max(y0 + 5, y1 - 50 * sm(clamp(ow / 12)))) // (never above the top: at the toe tip the vamp is thinner than 5 mm)
			const inner = (side, k) => { // over the rim and down the inner wall, k = 1..NB
				const t = k / NB
				if (t < 0.4) { const a = (t / 0.4) * (Math.PI / 2); return [y1 - rho * (1 - Math.cos(a)), side * (ow - rho * Math.sin(a))] }
				return [mix(y1 - rho, floor, (t - 0.4) / 0.6), side * (ow - rho)]
			}
			for (let k = 1; k <= NB; k++) pts.push(inner(1, k))
			for (let k = 1; k < NC; k++) pts.push([floor, mix(ow - rho, -(ow - rho), k / NC)]) // across the footbed, right to left
			for (let k = NB; k >= 1; k--) pts.push(inner(-1, k))
			for (let k = NA - 1; k >= 0; k--) { const p = upperPoint(x, k / (NA - 1), -1); pts.push([p[1] - underLid(x, p[1]), p[2]]) } // outer left wall down to the sole line
			return { x, pts }
		})
		const mUp = upperRings[0].pts.length
		const iL = NA + NB + (NC - 1) + NB // where the left outer wall starts
		const upperGroups = [{ from: 0, to: NA - 1 }, { from: NA - 1, to: iL }, { from: iL, to: mUp }]
		const kg = loft(upperRings, upperGroups)
		g.add(kit.mesh(kg, [knit, lining, knit]))
		// the white heel cup behind the opening: a polar cap about the middle of the chord at XC (the cup's top face is the sloping back; its wall the superellipse sections of the loft)
		{
			const n0 = NSE(XC)
			const dome = (x, z, t) => { const y1 = yUp(x), y0 = yBase(x, y1), n = NSE(x); return t >= 1 ? y0 : y0 + (y1 - y0) * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(z) / upperHalf(x)), n)), 1 / n) } // (the rim row is the wall's foot: its width is nothing at the very tip)
			const rows = []
			for (let k = NA - 1; k >= 0; k--) {
				const ph = (k / (NA - 1)) * (Math.PI / 2)
				rows.push({ t: k === NA - 1 ? 0 : Math.pow(Math.cos(ph), 2 / n0), inner: () => 0, y: dome, ring: k === NA - 1 ? null : [k, iL + NA - 1 - k] })
			}
			const cup = polarCap({ C: [XC, 0], rim: endRim(upperHalf, XC, XMIN, 36), rows, x0: XC, x1: XMAX })
			joinNormals(cup, kg, 0, mUp)
			put(cup.geo, whiteLeather)
		}
		put(endCap(upperRings[upperRings.length - 1], 1), whiteLeather) // (the vamp's front end lies under the white toe cap)

		// ---- overlays that hug the upper's surface
		const surf = (x, a, side) => { const p = upperPoint(x, a, side); return new THREE.Vector3(p[0], p[1], p[2]) }
		const outward = new THREE.Vector3()
		const faceOut = (p) => outward.set(0, p.y - (yBase(p.x, yUp(p.x)) + yUp(p.x)) / 2, p.z)
		const normalAt = (x, a, side) => {
			const dx = surf(x + 0.4, a, side).sub(surf(x - 0.4, a, side))
			const da = surf(x, clamp(a + 0.004, 0, 1), side).sub(surf(x, clamp(a - 0.004, 0, 1), side))
			const n = new THREE.Vector3().crossVectors(dx, da).normalize()
			if (n.dot(faceOut(surf(x, a, side))) < 0) n.negate()
			return n
		}
		/** A ribbon of the upper's surface: map(u, v) -> [x, a, side] over a grid, floated `off` mm off the surface along its normal (off may be a function of (u, v)). */
		function patch(map, off, material, { nu = 40, nv = 8, shadow = false, sinkLo = 0, sinkHi = 0, under = null } = {}) {
			const pos = [], idx = [], uvs = []
			for (let i = 0; i <= nu; i++) {
				for (let j = 0; j <= nv; j++) {
					const [x, a, side] = map(i / nu, j / nv)
					const p = surf(x, a, side)
					p.addScaledVector(normalAt(x, a, side), typeof off === "function" ? off(i / nu, j / nv) : off)
					if (j === 0) p.y -= sinkLo // (a patch's foot edge sinks into the foam below it: no hairline of the knit under it)
					else if (j === nv) p.y -= sinkHi
					if (under) p.y -= under(p)
					pos.push(p.x, p.y, p.z)
					uvs.push(i / nu, j / nv)
				}
			}
			const row = nv + 1
			for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
				const a = i * row + j, b = a + 1, c = a + row, d = c + 1
				idx.push(a, c, b, b, c, d)
			}
			const geo = new THREE.BufferGeometry()
			geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
			geo.setIndex(idx)
			geo.computeVertexNormals()
			const p0 = new THREE.Vector3().fromBufferAttribute(geo.attributes.position, idx[0])
			const nm = new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, idx[0])
			if (nm.dot(faceOut(p0)) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t } geo.setIndex(idx); geo.computeVertexNormals() }
			put(geo, material, shadow)
		}
		/** A thin piping tube along a curve of the surface: pts(t) -> [x, a, side]. */
		function piping(pts, off, material, r = 0.55, n = 30) {
			const v = []
			for (let k = 0; k <= n; k++) {
				const [x, a, side] = pts(k / n)
				const p = surf(x, a, side)
				v.push(p.addScaledVector(normalAt(x, a, side), off))
			}
			put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v), n, r, 5, false), material)
		}
		const both = (fn) => [1, -1].forEach(fn)
		// a point across the front of the toe: phi 0 .. PI goes from the lateral sole line over the top to the medial sole line
		const across = (phi) => (phi <= Math.PI / 2 ? [phi / (Math.PI / 2), 1] : [(Math.PI - phi) / (Math.PI / 2), -1])

		// the toe cap: a round overlay over the whole toe box, its back edge a smooth arc (no crease at the top), piped in orange
		const toeX = (a) => 236 + 32 * (1 - Math.pow(Math.max(0, Math.cos((a * Math.PI) / 2)), 1.6))
		patch((u, v) => { const [a, side] = across(v * Math.PI); return [mix(toeX(a), XU_END, u), a, side] }, 0.45, whiteLeather, { nu: 24, nv: 38, sinkLo: 0.8, sinkHi: 0.8, under: (p) => underLid(p.x, p.y) })
		piping((t) => { const [a, side] = across(t * Math.PI); return [toeX(a) + 0.15, a, side] }, 0.6, accent, 0.55, 48)
		// the heel counter: a cup over the white heel cup that wraps the whole back, with a curved front edge and a sloping top
		const heelX = (a) => (a <= 0.62 ? 52 - 17 * sm(a / 0.62) : 35 - 20 * sm(clamp((a - 0.62) / 0.3)))
		both((s) => {
			patch((u, v) => { const a = v; return [mix(XC - 1.5, heelX(a), u), a, s] }, (u) => 0.2 + 0.45 * sm(clamp(u / 0.35)), whiteLeather, { nu: 16, nv: 22, sinkLo: 0.8 })
			piping((t) => { const a = t * 0.97; return [heelX(a) - 0.2, a, s] }, 0.6, accent, 0.55, 30)
		})

		// ---- the lace area: a V-shaped throat between two raised, padded eyestays, the tongue showing between them
		const lacingX0 = 134, lacingX1 = 224
		const rows = Array.from({ length: 7 }, (_, k) => lacingX0 + k * ((lacingX1 - lacingX0) / 6.2))
		const zIn = (x) => mix(12, 3.6, clamp((x - lacingX0) / (rows[6] - lacingX0))) // the throat's half width: wide at the collar, narrow at the toe
		const STAY_W = 9.5, STAY_H = 2.5
		const stayX0 = 127, stayX1 = rows[6] + 7
		const stay = (side) => {
			const nu = 46, nv = 8
			const pos = [], idx = [], uvs = []
			for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
				const x = mix(stayX0, stayX1, i / nu), v = j / nv
				const z = side * (zIn(x) - 1.2 + v * (STAY_W + 1.2))
				const e = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(2 * v - 1), 4))) * Math.pow(Math.min(1, Math.min(i, nu - i) / 5), 0.5) // padded edges, rounded ends
				pos.push(x, domeY(x, z) + 0.15 + STAY_H * e, z)
				uvs.push(i / nu, v)
			}
			const row = nv + 1
			for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * row + j, b = a + 1, c = a + row, d = c + 1; idx.push(a, b, c, b, d, c) }
			const geo = new THREE.BufferGeometry()
			geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
			geo.setIndex(idx)
			geo.computeVertexNormals()
			if (geo.attributes.normal.getY(Math.floor(pos.length / 6)) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t } geo.setIndex(idx); geo.computeVertexNormals() }
			put(geo, whiteLeather)
		}
		both((s) => stay(s))
		const stayTop = (x, z) => domeY(x, z) + 0.15 + STAY_H

		// ---- a padded collar round the opening (a tube along the rim crest)
		{
			const crest = []
			const xs = Array.from({ length: 40 }, (_, k) => mix(XO0 + 1.5, XO1 - 1.5, k / 39))
			for (const x of xs) crest.push(new THREE.Vector3(x, yUp(x) - 1.4, openHalf(x) - 1.9))
			for (const x of [...xs].reverse()) crest.push(new THREE.Vector3(x, yUp(x) - 1.4, -(openHalf(x) - 1.9)))
			const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(crest, true), 110, 2.1, 6, true)
			put(tube, whiteLeather)
		}
		// ---- the tongue: a thick padded flap standing in the opening and running on under the laces. A closed block 18 mm deep whose top is crowned across,
		// so its side flaps fill the collar dip (seen from the side it is solid up to the outline), with a rounded back end
		{
			const rings = Array.from({ length: 40 }, (_, k) => { const x = mix(TX0, TX1, 0.5 - 0.5 * Math.cos((Math.PI * k) / 39)); const yt = tongueTop(x); return { x, pts: sectionRing(yt - tongueTh(x), yt, hzTongue(x), 1.4, TONGUE_RT, 6) } })
			closed(rings, tongueMat)
			// a woven label stitched on the tongue's crown
			const lab = kit.mesh(new THREE.BoxGeometry(11, 0.5, 6.4), mat("eb-shoe-label", { color: "#f1efe8", roughness: 0.8, metalness: 0 }))
			lab.position.set(110, tongueTop(110) + 0.1, 0)
			lab.rotation.z = Math.atan2(tongueTop(116) - tongueTop(104), 12)
			g.add(lab)
		}

		// ---- eyelets and laces: seven rows, laces crossing the throat in an X, a bow at the top
		const zEye = (x) => zIn(x) + 4.4
		const eyeGeo = kit.torus(2.6, 0.7, 5, 12)
		const holeGeo = new THREE.CircleGeometry(2.0, 14).rotateX(-Math.PI / 2)
		for (const x of rows) for (const s of [1, -1]) {
			const z = s * zEye(x), y = stayTop(x, z) + 0.45
			put(eyeGeo.clone().rotateX(Math.PI / 2).translate(x, y, z), steel)
			put(holeGeo.clone().translate(x, y - 0.05, z), hole, false)
		}
		const tube = (pts, r, seg = 14) => band(pts, r * 1.35, r * 0.6, { seg })
				const surfY = (x, z) => Math.max(domeY(x, z), Math.abs(z) < hzTongue(x) ? tongueTop(x) - tongueCrown(x, z) : -1e9) // what a lace lies on at (x, z): the tongue's crown or the dome
		for (let k = 0; k < rows.length - 1; k++) for (const s of [1, -1]) {
			const pts = []
			const xa = rows[k], xb = rows[k + 1]
			const ya = stayTop(xa, s * zEye(xa)) + 1.0, yb = stayTop(xb, -s * zEye(xb)) + 1.0
			for (let i = 0; i <= 8; i++) {
				const t = i / 8, x = mix(xa, xb, t), z = s * mix(zEye(xa), -zEye(xb), t)
				const crossing = Math.abs(z) < Math.max(zIn(x), 1) // over the throat gap: no lower than the tongue's face
				pts.push(new THREE.Vector3(x, Math.max(mix(ya, yb, t) - 0.9 * Math.sin(Math.PI * t), crossing ? tongueTop(x) - tongueCrown(x, z) + 1.5 : 0), z))
			}
			put(tube(pts, 1.4, 16), lace)
		}
		{
			// the straight bar under the top row
			const x0 = rows[0] - 0.4
			put(tube([new THREE.Vector3(x0, stayTop(x0, -zEye(x0)) + 1.0, -zEye(x0)), new THREE.Vector3(x0, tongueTop(x0) - tongueCrown(x0, 0) + 1.6, 0), new THREE.Vector3(x0, stayTop(x0, zEye(x0)) + 1.0, zEye(x0))], 1.4, 10), lace)
			// the bow: a knot on the tongue, two loops about 28 x 11 mm lying across the quarters, two tails 40 mm long falling over the vamp's sides
			const xk = 123
			const onS = (x, z, lift) => new THREE.Vector3(x, surfY(x, z) + lift, z)
			const kp = onS(xk, 0, 0.9)
			put(kit.sphere(2.6, 12, 8).clone().scale(1.15, 0.75, 1.15).translate(kp.x, kp.y, kp.z), lace)
			const aglet = kit.mesh(new THREE.CylinderGeometry(1.4, 1.4, 7, 8), kit.plastic("#d8d8d8"))
			for (const s of [1, -1]) {
				const ep = []
				const NL = 24
				for (let i = 0; i < NL; i++) {
					const t = (i / NL) * TAU
					const w = 0.5 + 0.5 * (1 - Math.cos(t)) / 2 // a teardrop: narrow at the knot, round at the far end
					const x = xk + 0.6 * s + 6.4 * w * Math.sin(t)
					const z = s * (2.4 + 13.8 * (1 - Math.cos(t)))
					ep.push(onS(x, z, 0.9 + 0.3 * Math.sin(t / 2)))
				}
				put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ep, true), 30, 1.5, 6, true), lace)
				// the tail: out from the knot, over the eyestay and down the side of the vamp
				const L2 = s > 0 ? 1 : 0.88
				const tp = [[0.5, 0], [5, 6 * L2], [11, 14 * L2], [17, 22 * L2], [22, 29 * L2]].map(([dx, dz], i) => onS(xk + dx, s * dz, 1.0 - 0.15 * i))
				put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tp), 18, 1.45, 6, false), lace)
				const ag = aglet.clone()
				const dir = tp[4].clone().sub(tp[3]).normalize()  // the aglet lies along the tail's last stretch
				ag.position.copy(tp[4]).addScaledVector(dir, 1.2)
				ag.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
				g.add(ag)
			}
		}
		for (const [k, b] of batches) g.add(kit.mesh(L.mergeGeos(b.geos, `eb-sneaker|${k}`), b.material, { cast: b.cast }))
		// ---- into the physics frame: mm -> m, origin at the middle of the 300 x 110 outline
		g.scale.setScalar(0.001)
		g.position.set(-0.15, -0.055, 0)
		return g
	}
	let BASE = null
	addModel("sneaker", "fore", ({ props }) => {
		const W = props.width ?? 0.3, H = props.height ?? 0.11, D = props.depth ?? 0.105
		BASE ??= buildBase()
		const out = kit.group(BASE.clone())
		out.scale.set(W / 0.3, H / 0.11, D / 0.105)
		return out
	})
	addModel("sneaker", "heel", null)
}
