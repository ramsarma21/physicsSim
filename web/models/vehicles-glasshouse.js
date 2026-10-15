// A greenhouse (the glazed upper part of a car's or a truck's cab) on a convex side outline: painted side frames with window openings and a B-pillar,
// leaning in (tumblehome), a roof slab, tinted glass panes in the openings, a glass windshield and rear window in rubber seals. The interior shows through the glass.
// glasshouse(o) -> { group, b, zin, th, tanP, phi }: the caller adds the interior (seats, dash, wheel) and uses zin(y), the half width inside the frames at height y.
export function makeGlasshouse(L, kit, lf, pt) {
	const T = L.THREE
	const capMats = new Map()
	/** The paint without its orange-peel normal map (a quad slab carries no uv): the cap's material. */
	const capOf = (paint) => {
		let m = capMats.get(paint.uuid)
		if (!m) {
			m = paint.clone()
			m.normalMap = null
			capMats.set(paint.uuid, m)
		}
		return m
	}
	const { roundPoly, offsetPoly, clipPoly, plate, put, M, bounds } = L

	/**
	 * o.pts: the greenhouse outline (convex, counter-clockwise: [bottom-left, bottom-right, ... top ...]);  o.hz: its half depth at the bottom;  o.s: scale;
	 * o.paint: the frame material;  o.roofDark: the headliner material;  o.key: cache key;
	 * o.off(E): how far in the window opening is from edge E (a pillar width) - E = {nx, ny, tx, ty, len, p, q};
	 * o.xm, o.half: the B-pillar's x and half width (null: one big window); o.cPillar: the x of the C-pillar behind the rear side window (default: none, the window runs back to the roof line);  o.phiDeg: the lean of the sides;  o.th: frame thickness;  o.tRoof: roof slab thickness;
	 * o.front, o.rear: {sBot, sTop} margins (m) of the glass on the slanted faces, rear: false for none;
		 * o.frontPane: "longest" glazes only the longest front-facing slanted edge (a cab-over's one tall windscreen); any other front edge above it (a bevel to the roof) is closed with a body-colour cap.
	 */
	return function glasshouse(o) {
		const { pts, hz, s, paint, roofDark, key, phiDeg = 9, th = 0.0032 * s, tRoof = 0.0034 * s, off, xm = null, cPillar = null, half = 0.0016 * s, front = { sBot: 0.0031 * s, sTop: 0.0044 * s }, rear = { sBot: 0.0027 * s, sTop: 0.0046 * s }, roofEnds, roofCrown = 0.0007 * s, winR = 0.0024 * s } = o
		const b = bounds(pts)
		const H = b.y1 - b.y0
		const phi = (phiDeg * Math.PI) / 180
		const tanP = Math.tan(phi)
		const cosP = Math.cos(phi)
		const rounded = roundPoly(pts, { dev: 0.0009 })
		const g = kit.group()
		const glass = M.glass()
		const n = pts.length
		const edges = pts.map((p, e) => {
			const q = pts[(e + 1) % n]
			const dx = q[0] - p[0]
			const dy = q[1] - p[1]
			const len = Math.hypot(dx, dy)
			return { p, q, len, nx: dy / len, ny: -dx / len, tx: dx / len, ty: dy / len }
		})
		// ---- the window openings: the outline pulled in by the pillars, cut in two at the B-pillar
		const inner = offsetPoly(pts, edges.map((E) => off(E)))
		const rearOpening = xm === null ? null : clipPoly(inner, 1, 0, xm - half) // behind the B-pillar: cPillar (an x) closes it with a near-vertical C-pillar edge, the sail panel behind being body colour
		const raw = xm === null ? [inner] : [cPillar === null ? rearOpening : clipPoly(rearOpening, -1, 0, -cPillar), clipPoly(inner, -1, 0, -(xm + half))]
		const wins = raw.filter((w) => w.length >= 3 && Math.abs(L.area2(w)) > 6e-6 * s * s)
		const up = (list) => list.map(([x, y]) => [x, y - b.y0])
		const holes = wins.map((w) => up(roundPoly(w, { dev: 0.0011, maxR: winR })))
		const outer = up(rounded)
		const frameGeo = kit.geo(`veh|ghframe|${key}|${th.toFixed(5)}|${xm}`, () => {
			const bev = 0.0004
			const sh = new T.Shape(outer.map(([x, y]) => new T.Vector2(x, y)))
			for (const h of holes) sh.holes.push(new T.Path(h.map(([x, y]) => new T.Vector2(x, y))))
			const geo = new T.ExtrudeGeometry(sh, { depth: th - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: 1, curveSegments: 8 })
			geo.translate(0, 0, -(th - 2 * bev) / 2)
			return geo
		})
		for (const sz of [1, -1]) {
			const pivot = new T.Group()
			pivot.position.set(0, b.y0, sz * (hz - th / 2))
			pivot.rotation.x = sz > 0 ? -phi : phi
			const flat = new T.Group()
			flat.scale.set(1, 1 / cosP, 1)
			pivot.add(flat)
			flat.add(put(frameGeo, paint))
			holes.forEach((h, i) => {
				flat.add(put(plate(h, 0.0007 * s, { key: `${key}|w${i}` }), glass, 0, 0, 0, null, { cast: false }))
				const gd = 0.0004 * s
				const gk = kit.geo(`veh|gasket|${key}|${i}|${s.toFixed(3)}`, () => {
					const out = offsetPoly(h, -0.0007 * s)
					const sh = new T.Shape(out.map(([x, y]) => new T.Vector2(x, y)))
					sh.holes.push(new T.Path(h.map(([x, y]) => new T.Vector2(x, y))))
					return new T.ExtrudeGeometry(sh, { depth: gd, bevelEnabled: false, curveSegments: 4 })
				})
				flat.add(put(gk, M.seal(), 0, 0, sz > 0 ? th / 2 - 0.00005 : -th / 2 - gd + 0.00005, null, { cast: false })) // the rubber gasket round each window
			})
			g.add(pivot)
		}
		// ---- the roof: a slab over the top, a hair wider than the pillars' tops, its underside the headliner
		const roofClip = clipPoly(rounded, 0, -1, -(b.y1 - tRoof))
		const hzR = hz - (H - tRoof) * tanP + 0.0005
		const re = roofEnds ?? { front: { len: 0.01 * s, taper: 0.0006 * s, R: 0.003 * s }, rear: { len: 0.01 * s, taper: 0.0006 * s, R: 0.003 * s } }
		g.add(put(lf.bodyLoft(roofClip, { hw: hzR, ends: re, tumbleDeg: phiDeg, crown: roofCrown, rt: 0.0022 * s, rb: 0.0006, key: `${key}|roof`, uvScale: 40, fine: o.roofFine ?? 0.6 }), [paint, roofDark]))
		// ---- the windshield and the rear window: glass on the slanted faces between the side frames, in a black seal
		const zin = (y) => hz - th - (y - b.y0) * tanP + 0.0008
		const slanted = edges.filter((E) => Math.abs(E.ty) > 0.2 && Math.abs(E.nx) > 0.2)
		const longestFront = o.frontPane === "longest" ? slanted.filter((E) => E.nx > 0).reduce((a, E) => (!a || E.len > a.len ? E : a), null) : null
		for (const E of slanted) {
			const isFront = E.nx > 0
			if (!isFront && rear === false) continue
			if (longestFront && isFront && E !== longestFront) {
				// a front edge that is not the windscreen (the bevel up to the roof): a body-colour cap between the side frames, up under the roof slab
				const lo2 = E.p[1] < E.q[1] ? E.p : E.q
				const hi2 = E.p[1] < E.q[1] ? E.q : E.p
				const uy2 = (hi2[1] - lo2[1]) / E.len
				const ux2 = (hi2[0] - lo2[0]) / E.len
				const sTop2 = Math.min(E.len, (b.y1 - tRoof + 0.0005 - lo2[1]) / uy2)
				if (sTop2 > 0.002 * s) {
					const at2 = (sd) => {
						const x = lo2[0] + ux2 * sd - E.nx * 0.0004 * s
						const y = lo2[1] + uy2 * sd - E.ny * 0.0004 * s
						const z = zin(y)
						return [[x, y, -z], [x, y, z]]
					}
					const A = at2(0)
					const B = at2(sTop2)
					g.add(put(pt.quadSlab([A[0], A[1], B[1], B[0]], [E.nx, E.ny, 0], 0.0016 * s, `cap|${key}`), capOf(paint), 0, 0, 0, null, { cast: false }))
				}
				continue
			}
			const mg = isFront ? front : rear
			const lo = E.p[1] < E.q[1] ? E.p : E.q
			const hi = E.p[1] < E.q[1] ? E.q : E.p
			const ux = (hi[0] - lo[0]) / E.len
			const uy = (hi[1] - lo[1]) / E.len
			const sBot = mg.sBot
			const sTop = Math.min(E.len - mg.sTop, (b.y1 - tRoof - 0.0006 - lo[1]) / uy) // the glass ends under the roof slab
			if (sTop - sBot < 0.004 * s) continue
			const inset = 0.0008 * s
			const quad = (s0, s1) => {
				const at = (sd) => [lo[0] + ux * sd - E.nx * inset, lo[1] + uy * sd - E.ny * inset]
				const A = at(s0)
				const B = at(s1)
				const za = zin(A[1])
				const zb = zin(B[1])
				return [[A[0], A[1], -za], [A[0], A[1], za], [B[0], B[1], zb], [B[0], B[1], -zb]]
			}
			g.add(put(pt.quadSlab(quad(sBot, sTop), [E.nx, E.ny, 0], 0.0007 * s, `glass|${key}`), glass, 0, 0, 0, null, { cast: false }))
			const sm = (sBot + sTop) / 2
			const grow = 0.0009 * s
			const zlo = zin(lo[1] + uy * sBot)
			const zhi = zin(lo[1] + uy * sTop)
			const ring = kit.geo(`veh|sealring|${key}|${sBot.toFixed(5)}|${sTop.toFixed(5)}`, () => {
				const sh = new T.Shape([[-zlo - grow, sBot - sm - grow], [zlo + grow, sBot - sm - grow], [zhi + grow, sTop - sm + grow], [-zhi - grow, sTop - sm + grow]].map(([x, y]) => new T.Vector2(x, y)))
				sh.holes.push(new T.Path([[-zlo, sBot - sm], [-zhi, sTop - sm], [zhi, sTop - sm], [zlo, sBot - sm]].map(([x, y]) => new T.Vector2(x, y))))
				const geo = new T.ExtrudeGeometry(sh, { depth: 0.001 * s, bevelEnabled: false, curveSegments: 2 })
				geo.translate(0, 0, -0.0005 * s)
				return geo
			})
			const rm = new T.Mesh(ring, M.seal())
			rm.receiveShadow = true
			L.onFace(rm, lo[0] + ux * sm - E.nx * 0.0006 * s, lo[1] + uy * sm - E.ny * 0.0006 * s, 0, E.nx, E.ny, 0)
			g.add(rm)
		}
		return { group: g, b, zin, th, tanP, phi, edges, rounded }
	}
}
