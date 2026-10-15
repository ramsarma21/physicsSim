// Mechanisms models: Atwood machine, pulley lift (a round aluminium pail on a wire bail). The wheels, ropes and brackets are drawn by the view.
export default function register({ addModel, kit, THREE, L, P }) {
	const T = THREE
	const { f5, put, faces } = L
	const { mesh, group, HALF, sideOf, seedOf, beam, screwOn, hookedMass, grams } = P

	// ============================================================== atwood machine
	// the bar carries no screw eyes: the view's pulley brackets are bolted to its underside and the rope runs over the wheels (eyes at the rope's runs held nothing)
	addModel("atwood-machine", "bar", (ctx) => beam(ctx, { eyes: [], screwPitch: 0.055 }))
	addModel("atwood-machine", "left", (ctx) => hookedMass(ctx, grams(ctx.props.left_mass)))
	addModel("atwood-machine", "right", (ctx) => hookedMass(ctx, grams(ctx.props.right_mass)))

	// ============================================================== pulley lift
	addModel("pulley-lift", "bar", (ctx) => beam(ctx, { eyes: [], screwPitch: 0.06 }))
	addModel("pulley-lift", "weight", (ctx) => hookedMass(ctx, grams(ctx.props.weight)))

	// the pail: a round spun-aluminium pail (3 mm sheet, as thick as the physics walls) with a rolled rim and bottom chime, a pressed bead round the middle and two
	// riveted ears; the bail is a semicircle of 3 mm aluminium wire (seven straight pieces in the physics, drawn round) with a turned walnut grip either side of the
	// rope's tie. The pail is as deep as it is wide (the catalog's depth), its floor a disc and each wall a half cylinder.
	const T_ = 0.003 // the sheet and the wire (the catalog's LIFT_T)
	const ARCH = 7 // the catalog's LIFT_ARCH
	const pailAlu = () => L.alu("#dfe2e6")
	const walnut = () => L.MAT("walnutGrip", { color: "#5a3a24", roughness: 0.5, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.2 })
	/** A horizontal ring (axis y) of radius R and tube radius r, its half on the `side` of x (0: the whole ring), at the origin. */
	const ringGeo = (R, r, side, radial = 8, tubular = 40) =>
		kit.geo(`pailRing|${f5(R)}|${f5(r)}|${side}|${radial}|${tubular}`, () => {
			const g = new T.TorusGeometry(R, r, radial, side ? Math.ceil(tubular / 2) : tubular, side ? Math.PI : Math.PI * 2).rotateX(HALF)
			return side ? g.rotateY(side * HALF) : g
		})
	addModel("pulley-lift", "floor", (ctx) => {
		const { w, h } = ctx
		const ro = w / 2
		const out = [mesh(kit.cylinderY(ro - h / 2, h, 56), pailAlu())]
		// the rolled chime: a bead round the bottom edge, exactly the floor's thickness
		out.push(mesh(ringGeo(ro - h / 2, h / 2, 0, 8, 64), pailAlu()))
		return group(out)
	})
	/** One side of the pail's wall: a half annulus about the pail's axis (outer radius ro, inner ri), extruded `height` along y, smooth-shaded. */
	const halfShell = (side, ro, ri, height) =>
		kit.geo(`pailShell|${side}|${f5(ro)}|${f5(ri)}|${f5(height)}`, () => {
			const sh = new T.Shape()
			if (side > 0) {
				sh.absarc(0, 0, ro, -HALF, HALF, false)
				sh.absarc(0, 0, ri, HALF, -HALF, true)
			} else {
				sh.absarc(0, 0, ro, HALF, 3 * HALF, false)
				sh.absarc(0, 0, ri, 3 * HALF, HALF, true)
			}
			const g = new T.ExtrudeGeometry(sh, { depth: height, bevelEnabled: false, curveSegments: 28 }).rotateX(-HALF)
			g.translate(0, -height / 2, 0)
			return L.creased(g, 0.7)
		})
	const EAR_T = 0.0010 // how far the ear's sheet stands out of the wall: 1 mm, so the ear and its flush rivets stay within 1.3 mm of the physics wall
	/** The ear: a strip of the pail's own sheet on the outside of the wall, `ang` either side of the end, `eh` tall (a sector of a ring about the pail's axis). */
	const earGeo = (side, ro, ang, eh) =>
		kit.geo(`pailEar|${side}|${f5(ro)}|${f5(ang)}|${f5(eh)}`, () => {
			const a0 = side < 0 ? Math.PI : 0
			const sh = new T.Shape()
			sh.absarc(0, 0, ro + EAR_T, a0 - ang, a0 + ang, false)
			sh.absarc(0, 0, ro - 0.0001, a0 + ang, a0 - ang, true)
			const g = new T.ExtrudeGeometry(sh, { depth: eh, bevelEnabled: false, curveSegments: 10 }).rotateX(-HALF)
			g.translate(0, -eh / 2, 0)
			return L.creased(g, 0.7)
		})
	const pailWall = (ctx) => {
		const { w, h, d } = ctx // the wall slab: t wide, the pail's height tall, as deep as the pail is wide
		const side = sideOf(ctx)
		const ro = d / 2
		const ri = ro - w
		const xc = side * (ro - w / 2) // the wall slab's middle, measured from the pail's axis: the models below are drawn about the axis and moved by -xc
		const shift = (m) => (m.position.x -= xc, m)
		const shell = mesh(halfShell(side, ro, ri, h - 0.0015), pailAlu())
		shell.position.set(-xc, -0.00075, 0)
		const out = [shell]
		// the rolled rim (a wire bead round the top edge, as thick as the wall) and a pressed bead round the middle
		out.push(shift(put(mesh(ringGeo(ro - w / 2, 0.0015, side, 8, 48), pailAlu()), 0, h / 2 - 0.0015, 0)))
		out.push(shift(put(mesh(ringGeo(ro - 0.0004, 0.0007, side, 6, 48), pailAlu()), 0, -h * 0.08, 0)))
		// the ear below the rim on the outside of the end: a strip of sheet with two flush rivets
		const eh = Math.min(0.016, h * 0.6)
		const ang = Math.min(0.36, 0.014 / ro + 0.12)
		const yEar = h / 2 - eh / 2 - 0.0003 // the ear's top meets the rim bead: the bail's end hooks through it at the top (bailPiece)
		out.push(shift(put(mesh(earGeo(side, ro, ang, eh), pailAlu()), 0, yEar, 0)))
		for (const z of [-1, 1]) {
			const a = (side < 0 ? Math.PI : 0) + z * ang * 0.62
			const rv = screwOn((ro + EAR_T) * Math.cos(a) - xc, yEar, (ro + EAR_T) * Math.sin(a), 0.0011, side < 0 ? "-x" : "+x", z, true)
			out.push(rv)
		}
		return group(out)
	}
	addModel("pulley-lift", "wall1", pailWall)
	addModel("pulley-lift", "wall2", pailWall)

	// the bail: the wire arch, piece by piece (each piece draws the round wire over its own stretch of the arch, a seventh of it: the physics pieces stop 1.25 mm short of each
	// other and stand 2.5 mm over the walls' tops, the catalog's LIFT_GAP, so the wire is drawn whole over those gaps); each end turns outward through a pierced boss on the
	// pail's ear, two walnut grips (one either side of where the rope is tied, which is at the very top). A piece's own origin is the floor's middle wherever it is welded
	// (the catalog welds a narrow, tall pail to a wall)
	const bailPiece = (ctx) => {
		const Wc = ctx.props.cup_width ?? 0.08
		const Hc = ctx.props.cup_height ?? 0.07
		const k = Number(/\d+/.exec(ctx.solid.id.split("/")[1])[0]) - 1
		const a0 = Math.PI * (1 - k / ARCH) // this piece runs from angle a0 down to a1 about the rim's middle
		const a1 = Math.PI * (1 - (k + 1) / ARCH)
		const Rb = Wc / 2 - T_ / 2 // the wire's centre line
		const cy = T_ / 2 + Hc // the rim's height in the pail's frame
		const arc = (R, r, lo, hi, key) => {
			// the arc is cached about the rim's middle at the origin, and the mesh is moved up to the rim: the rim's height is not in the cache key, so one arc serves every pail height
			const g = kit.geo(`pailArc|${key}|${f5(R)}|${f5(r)}|${f5(lo)}|${f5(hi)}`, () => new T.TorusGeometry(R, r, 10, Math.max(3, Math.ceil(((hi - lo) / (Math.PI / ARCH)) * 6)), hi - lo).rotateZ(lo))
			const m = mesh(g, key === "grip" ? walnut() : pailAlu())
			m.position.y = cy
			return m
		}
		const out = [arc(Rb, T_ / 2, a1, a0, "wire")]
		for (const [lo, hi] of [[HALF + 0.07, HALF + 0.29], [HALF - 0.29, HALF - 0.07]]) {
			const a = Math.max(lo, a1)
			const b = Math.min(hi, a0)
			if (b - a > 0.012) out.push(arc(Rb, 0.0030, a, b, "grip"))
		}
		// where each end meets the pail: the wire turns outward (a 2.4 mm bend) and runs through a pierced boss on the ear, a small steel ring 1 mm out of the wall
		const elbow = (sx) => {
			const R = 0.0024
			const pts = [[sx * Rb, cy + 0.0006]]
			for (let i = 0; i <= 5; i++) {
				const a = (i / 5) * HALF
				pts.push([sx * (Rb + R - R * Math.cos(a)), cy - R * Math.sin(a)])
			}
			pts.push([sx * (Rb + R + 0.0007), cy - R])
			const g = L.wire(`pailElbow|${sx}|${f5(Rb)}|${f5(cy)}`, pts, T_ / 2, { radial: 10, per: 3 })
			out.push(mesh(g, pailAlu()))
			const boss = mesh(kit.torus(0.0021, 0.0006, 8, 18), L.steel("#aab0b6"))
			boss.rotation.y = HALF
			boss.position.set(sx * (Wc / 2 + 0.0007), cy - R, 0)
			out.push(boss)
		}
		if (k === 0) elbow(-1)
		if (k === ARCH - 1) elbow(1)
		return group(out)
	}
	for (let i = 1; i <= ARCH; i++) addModel("pulley-lift", `bail${i}`, bailPiece)
}
