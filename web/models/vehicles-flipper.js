// The pinball flipper: a tapered bat with a red rubber ring round its edge between two flanges of plastic (or the chosen material), one on each face,
// turning on a shoulder-bolt post (a mounting flange behind, the shaft through the hub, a washer and a domed head in front).
export default function register(addModel, L, kit) {
	const T = L.THREE
	const { TAU, mix, rng, fbm, put, mat, decalMat, quadGeo, M, roundPoly, offsetPoly, sculpt, plate, bounds, decalPoly, sideDecals } = L
	const MAT = {
		"solid rubber": { kind: "plastic", color: "#f2ecd6" }, // the default: an ivory plastic bat (the rubber is the ring round it)
		"varnished hardwood": { kind: "wood", color: "#c79257" },
		"aluminium": { kind: "alu", color: "#d3d7dc" },
		"steel": { kind: "steel", color: "#a9afb6" },
	}

	function flipper(ctx) {
		const pts = ctx.body.points.map((p) => [p.x, p.y])
		const b = bounds(pts)
		const d = ctx.d
		const K = MAT[ctx.props.material] ?? MAT["solid rubber"]
		const g = kit.group()
		const rounded = roundPoly(pts, { dev: 0.0009 })
		// ---- the rubber ring: the whole outline through the middle half of the bat's height, its edges eased (the bat's plastic flanges stand above and below it)
		const rubber = mat("flipper-rubber", { color: "#c1161c", roughness: 0.62, metalness: 0, sheen: 0.4, sheenColor: new T.Color("#ff6b6b"), sheenRoughness: 0.55, clearcoat: 0.12 })
		const key = `flipper|${JSON.stringify(pts)}|${d}`
		const bandH = 0.5 * d
		g.add(put(plate(rounded, bandH, { bevel: 0.0009, key: `${key}|band` }), rubber))
		// ---- the flanges: the bat's own plastic (or the chosen material), the outline pulled in 0.8 mm so the rubber stands proud of them, above and below the ring
		const inset = roundPoly(offsetPoly(rounded, 0.0008), { dev: 0.0005, maxR: 0.004 })
		let pm
		if (K.kind === "wood") pm = L.wood(ctx.solid.color ?? K.color, { seed: 17, roughness: 0.45, varnish: 0.8 })
		else if (K.kind === "plastic") pm = mat(`flipper-plate-plastic|${ctx.solid.color ?? K.color}`, { color: ctx.solid.color ?? K.color, roughness: 0.3, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.15 })
		else pm = mat(`flipper-plate|${K.kind}`, { color: K.color, roughness: K.kind === "alu" ? 0.3 : 0.34, metalness: 1, normalMap: L.grainNormal("brushed", { size: 128, cell: 10, strength: 0.7 }), normalScale: new T.Vector2(0.35, 0.35) })
		const fl = (d - bandH) / 2
		const pg = plate(inset, fl, { bevel: 0.0006, key: `${key}|flange` })
		for (const s of [1, -1]) g.add(put(pg, pm, 0, 0, s * (bandH / 2 + fl / 2)))
		// printed marks on the plates: a star and a stripe (decals just over the plate)
		const bw = b.x1 - b.x0
		const bh = b.y1 - b.y0
		const px = 14000
		sideDecals(g, decalPoly(inset, b.x0, b.y0, bw, bh), d / 2 + 0.00004, `flippermarks|${key}`, bw, bh, px, (c, W, H) => {
			const X = (x) => (x - b.x0) * px
			const Y = (y) => (b.y1 - y) * px
			// a pale stripe along the bat and a star near the hub
			c.fillStyle = K.kind === "wood" ? "rgba(250,244,230,0.9)" : K.kind === "plastic" ? "rgba(196,24,30,0.92)" : "rgba(230,40,40,0.9)"
			c.fillRect(X(b.x0 + 0.03), Y(0.0012), (bw - 0.056) * px, 0.0024 * px)
			c.fillStyle = "rgba(235,40,40,0.95)"
			const cx = X(b.x0 + 0.027)
			const cy = Y(0)
			const R0 = 0.0058 * px
			c.beginPath()
			for (let i = 0; i < 10; i++) {
				const rr = i % 2 ? R0 * 0.42 : R0
				const a = -Math.PI / 2 + (i / 10) * TAU
				c.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a))
			}
			c.closePath()
			c.fill()
		}, { roughness: 0.4, clearcoat: 0.7 })
		// ---- the pivot: a steel bushing in the hub (a ring flush with the plate)
		const piv = b.x0 + 0.014
		for (const s of [1, -1]) {
			g.add(put(new T.RingGeometry(0.0062, 0.0086, 32), M.steel("#aeb4bb", 0.25), piv, 0, s * (d / 2 + 0.00006), [0, s > 0 ? 0 : Math.PI, 0], { cast: false }))
		}
		return g
	}

	function post(ctx) {
		// a shoulder bolt through the bat's hub, inside the 6 mm post circle: a nut and washer behind, the shaft, a washer and a domed head in front
		const r = ctx.r
		const h = ctx.d / 2
		const g = kit.group()
		const steel = M.steel("#b6bcc4", 0.26)
		const dark = M.steel("#4c5058", 0.4)
		g.add(put(new T.CylinderGeometry(r, r, 0.0024, 6).rotateX(Math.PI / 2), steel, 0, 0, -h + 0.0012)) // the hex nut behind
		g.add(put(kit.cylinderZ(0.0042, ctx.d - 0.0091, 24), M.steel("#8f959c", 0.3), 0, 0, -0.00215)) // the shaft, ending in the head
		g.add(put(kit.cylinderZ(r * 0.98, 0.0009, 28), steel, 0, 0, h - 0.0072)) // a washer
		const head = new T.SphereGeometry(r * 0.96, 40, 12, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2)
		const dome = put(head, steel, 0, 0, h - 0.0067)
		dome.scale.set(1, 1, 0.62)
		g.add(dome)
		g.add(put(new T.CylinderGeometry(0.0021, 0.0021, 0.0008, 6).rotateX(Math.PI / 2), dark, 0, 0, h - 0.0067 + 0.0037 * 0.62 + 0.0001))
		return g
	}

	addModel("pinball-flipper", "flipper", flipper)
	addModel("pinball-flipper", "post", post)
}
