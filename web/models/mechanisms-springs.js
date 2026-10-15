// Mechanisms models: spring launcher, bounce pad, spring bumper, spring gate, spring catapult. The springs themselves are drawn by the view.
export default function register({ addModel, kit, THREE, L, P }) {
	const T = THREE
	const { f5, put, faces } = L
	const { mesh, group, HALF, sideOf, seedOf, beam, seat, screwOn, screwEye } = P
	const D2R = Math.PI / 180
	/** A spring seat's radius: 14.8 mm, narrower on a part less than ~31 mm deep so it stays within its depth (the catalog narrows the coil to match). */
	const seatR = (d) => Math.max(0.005, Math.min(0.0148, d / 2 - 0.0005))
	/** Where a sprung plate's two springs stand (x of each, either side of the middle): 25 mm in from the plate's ends, but never closer to the middle than the catalog's coil
	 *  (radius max(4, min(12, d / 2 - 3.3) mm) and a 3 mm gap: a plate under ~76 mm wide has them closer in than that, and the seats would overlap). The same in _sprung_plate. */
	const springX = (W, d) => Math.max(W / 2 - 0.025, Math.max(0.004, Math.min(0.012, d / 2 - 0.0033)) + 0.003)
	/** The seat's radius where the springs stand springX apart: never wider than the gap to the middle (a 0.4 mm clearance), so two seats never overlap. */
	const seatRx = (W, d) => Math.min(seatR(d), springX(W, d) - 0.0004)

	// ============================================================== spring launcher and bounce pad
	/** The base block under a sprung plate: two spring seats, four screws. */
	function sprungBase(ctx) {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const W = ctx.props.width ?? w - 0.05
		const body = mesh(L.rbox(w, h, d, Math.min(0.003, h * 0.3, d * 0.3), { grain: 0, seed: seedOf(ctx) }), faces(sk.side, sk.end, 0))
		const out = [body]
		for (const sx of [-1, 1]) out.push(put(seat("+y", seatRx(W, d)), sx * springX(W, d), h / 2 - 0.0002, 0))
		if (d > 0.05) for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(screwOn(sx * (w / 2 - 0.011), h / 2, sz * (d / 2 - 0.011), 0.0024, "+y", sx + sz))
		return group(out)
	}
	/** A flat steel guide rail standing on end, with an L-foot screwed down to the base on its outer side. */
	function rail(ctx) {
		const { w, h, d } = ctx
		const side = sideOf(ctx)
		const steel = L.zinc()
		const out = [mesh(L.rbox(w, h, d, Math.min(0.0012, w * 0.3)), steel)]
		const rs = Math.min(0.002, w * 0.3)
		for (const y of [-h / 2 + 0.03, h / 2 - 0.014]) out.push(screwOn(0, y, d / 2, rs, "+z", y * 40, true))
		const ft = 0.002
		const fl = 0.012
		out.push(put(mesh(L.rbox(w + fl, ft, d, 0.0005), steel), side * (fl / 2), -h / 2 + ft / 2, 0))
		for (const z of [-1, 1]) out.push(screwOn(side * (w / 2 + fl * 0.58), -h / 2 + ft, z * d * 0.28, 0.0015, "+y", z))
		return group(out)
	}
	/** The guide clips on a plate's two ends: a pair of steel straps (in front of and behind the rail) that carry the plate up the rail. */
	function clips(ctx, plateH) {
		const { w, d } = ctx
		const out = []
		const steel = L.steel("#bfc4ca")
		const hc = Math.max(0.008, plateH + 0.003)
		const rd = 0.02 // the rail's depth
		const zs = Math.min(rd / 2 + 0.0009, d / 2 - 0.0006) // the straps lie either side of the rail, but never outside the plate's own depth (a plate as shallow as the rail)
		for (const sx of [-1, 1])
			for (const sz of [-1, 1]) {
				const len = 0.0125
				const strap = mesh(L.rbox(len, hc, 0.0012, 0.0004), steel)
				strap.position.set(sx * (w / 2 + len / 2 - 0.001), 0, sz * zs)
				out.push(strap)
				out.push(put(mesh(kit.sphere(0.0011, 10, 6), L.steel("#aeb4ba")), sx * (w / 2 + 0.0085), 0, sz * Math.min(zs + 0.0006, d / 2)))
			}
		return out
	}
	addModel("spring-launcher", "base", sprungBase)
	addModel("spring-launcher", "guide1", rail)
	addModel("spring-launcher", "guide2", rail)
	addModel("spring-launcher", "plate", (ctx) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const body = mesh(L.rbox(w, h, d, Math.min(0.0025, h * 0.3), { grain: 0, seed: seedOf(ctx) }), faces(sk.side, sk.end, 0))
		const out = [body, ...clips(ctx, h)]
		for (const sx of [-1, 1]) out.push(put(seat("-y", seatRx(w, d)), sx * springX(w, d), -h / 2 + 0.0002, 0))
		return group(out)
	})
	addModel("bounce-pad", "base", sprungBase)
	addModel("bounce-pad", "guide1", rail)
	addModel("bounce-pad", "guide2", rail)
	// the pad: 1.5 mm aluminium backing under 2.5 mm of rubber, its top moulded with flat-topped raised diamonds (a height map with plateaus)
	const treadNormal = () => L.normalTex("padTread", 64, 64, (x, y) => {
		const fr = (v) => v - Math.floor(v)
		const a = Math.abs(fr((x + y) / 64) - 0.5) * 2 // 1 on the groove lines, 0 mid-diamond
		const b = Math.abs(fr((x - y) / 64) - 0.5) * 2
		const gv = Math.max(a, b)
		const t = Math.min(1, Math.max(0, (gv - 0.8) / 0.12))
		return 1 - t * t * (3 - 2 * t) // plateau = 1, groove = 0
	}, { strength: 3.4 })
	addModel("bounce-pad", "plate", (ctx) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const tb = Math.min(0.0015, h * 0.4)
		const tr = h - tb
		const tread = sk.kind === "rubber" ? L.MAT(`padTread|${ctx.color}`, { color: L.rich(ctx.color), roughness: 0.74, metalness: 0, normalMap: treadNormal(), normalScale: new T.Vector2(1.1, 1.1) }) : sk.main
		const rub = mesh(L.rbox(w, tr, d, Math.min(0.0009, tr * 0.4), { grain: 0, tu: 0.008, tv: 0.008, te: 0.008, seed: 3 }), [sk.side, sk.side, tread, sk.side, sk.side, sk.side])
		rub.position.y = h / 2 - tr / 2
		const back = mesh(L.rbox(w - 0.0006, tb, d - 0.0006, Math.min(0.0005, tb * 0.4)), L.alu("#cfd3d8"))
		back.position.y = -h / 2 + tb / 2
		const out = [rub, back, ...clips(ctx, h)]
		for (const sx of [-1, 1]) out.push(put(seat("-y", seatRx(w, d)), sx * springX(w, d), -h / 2 + 0.0002, 0))
		return group(out)
	})

	// ============================================================== spring bumper
	/** A bumper spring's seat: no wider than a quarter of the plate's height less 0.5 mm, so the two seats (half the height apart) never touch and stay on the plate
	 *  (the catalog's coil is a quarter of the height less 3 mm on a plate under ~6 cm tall). */
	const bumperSeatR = (d, H) => Math.min(seatR(d), H / 4 - 0.0005)
	addModel("spring-bumper", "wall", (ctx) => {
		// the wall stands on the floor (the item's origin) up to the keeper rail's top: the shelf butts its face along the bottom 10 mm, the keeper along the top 10 mm
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const H = ctx.props.height ?? h - 0.0245
		const body = mesh(L.rbox(w, h, d, 0.002, { grain: 1, seed: 5 }), faces(sk.side, sk.end, 1))
		const out = [body]
		// a steel mounting plate on its face between the shelf and the keeper, the spring seats on it, a screw in each corner
		const y0 = 0.011 - h / 2 // the plate's bottom and top in the wall's frame (1 mm clear of the shelf and the keeper, whose 10 mm rail ends at the wall's top)
		const y1 = h / 2 - 0.011
		const plate = mesh(L.rbox(0.0018, y1 - y0, d - 0.012, 0.0006), L.zinc())
		plate.position.set(w / 2, (y0 + y1) / 2, 0)
		out.push(plate)
		for (const f of [0.25, 0.75]) out.push(put(seat("+x", bumperSeatR(d, H)), w / 2 + 0.0002, 0.01 + f * H - h / 2, 0))
		if (d > 0.04 && y1 - y0 > 0.03) for (const y of [y0 + 0.006, y1 - 0.006]) for (const sz of [-1, 1]) out.push(screwOn(w / 2 + 0.0009, y, sz * (d / 2 - 0.012), 0.0018, "+x", y * 50 + sz))
		return group(out)
	})
	/** A shelf or keeper rail: a wood rail with a polished steel runner let into the face the plate slides on (the shelf's top, the keeper's underside). */
	const slideRail = (ctx, face) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const body = mesh(L.rbox(w, h, d, 0.0018, { grain: 0, seed: face > 0 ? 9 : 10 }), faces(sk.side, sk.end, 0))
		const out = [body]
		const run = mesh(L.rbox(w - 0.012, 0.0008, Math.max(0.01, d * 0.5), 0.0003), L.steel("#d3d8dd"))
		run.position.y = face * (h / 2 - 0.0002)
		out.push(run)
		return out
	}
	addModel("spring-bumper", "shelf", (ctx) => group(slideRail(ctx, 1)))
	// the guide pin inside each spring (the catalog's pin1, pin2): a bright steel rod from the wall's seat, as long as the physics slab and within its round section,
	// a black rubber tip on its end where the plate lands when the bumper is hit hard
	const guidePin = (ctx) => {
		const { w, h } = ctx
		const r = h / 2
		const tip = Math.min(0.003, w * 0.25)
		const rod = mesh(kit.latheX([[0, -w / 2], [r - 0.0004, -w / 2], [r - 0.0004, w / 2 - tip + 0.0002], [0, w / 2 - tip + 0.0002]], 20, `pinRod|${f5(r)}|${f5(w)}|${f5(tip)}`), L.steel("#c9ced3"))
		const cap = mesh(kit.latheX([[0, -tip / 2], [r, -tip / 2], [r, tip / 2 - 0.0008], [r - 0.0008, tip / 2], [0, tip / 2]], 20, `pinTip|${f5(r)}|${f5(tip)}`), L.rubberMat("#1b1c1f"))
		cap.position.x = w / 2 - tip / 2
		return group([rod, cap])
	}
	addModel("spring-bumper", "pin1", guidePin)
	addModel("spring-bumper", "pin2", guidePin)
	addModel("spring-bumper", "keeper", (ctx) => {
		// the keeper rail over the plate, butted against the wall's face and held to the wall's top by a flat steel mending plate (1.5 mm proud of both tops) with four screws
		const { w, h, d } = ctx
		const out = slideRail(ctx, -1)
		const mw = Math.min(0.03, d - 0.008) // the mending plate across the joint: 12 mm over the wall, 25 mm along the keeper
		const mend = mesh(L.rbox(0.037, 0.0015, mw, 0.0005), L.zinc())
		mend.position.set(-w / 2 + 0.0065, h / 2 + 0.00075, 0)
		out.push(mend)
		if (mw >= 0.012) for (const x of [-w / 2 - 0.006, -w / 2 + 0.018]) for (const sz of mw >= 0.022 ? [-1, 1] : [0]) out.push(screwOn(x, h / 2 + 0.0015, sz * (mw / 2 - 0.0055), 0.0016, "+y", x * 90 + sz, true))
		return group(out)
	})
	/** The rubber pad's profile in x-y: a flat back, the front moulded in rounded ribs (the ends are half ribs, so the outline is full). */
	function ribPad(t, h, n, depthG, bev) {
		{
			const hh = h / 2 - bev
			const x0 = bev
			const front = (y) => {
				const u = ((y + h / 2) / h) * n
				const v = Math.cos(2 * Math.PI * u) // 1 at a rib's crown
				const k = Math.min(1, Math.max(0, (v + 0.45) / 0.8))
				return t - bev - depthG * (1 - k * k * (3 - 2 * k))
			}
			const s = new T.Shape()
			s.moveTo(x0, -hh)
			const N = Math.max(220, n * 16) // points along the profile: enough for every rib
			for (let i = 0; i <= N; i++) {
				const y = -hh + (2 * hh * i) / N
				s.lineTo(front(y), y)
			}
			s.lineTo(x0, hh)
			s.closePath()
			return s
		}
	}
	addModel("spring-bumper", "plate", (ctx) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const out = []
		if (sk.kind === "rubber") {
			// a solid rubber plate: the whole thickness is one moulded block, its face in rounded ribs 1.8 mm deep (real relief, not paint)
			const n = Math.max(3, Math.round(h / 0.016))
			const bev = 0.0008
			const shape = ribPad(w, h, n, 0.0018, bev)
			const pad = mesh(L.extrudeShape(`bumperPadG|${f5(w)}|${f5(h)}|${n}`, shape, d, bev, 2), sk.main)
			pad.position.x = -w / 2
			out.push(pad)
		} else {
			// a plate of its own material (wood grain along its height, or bare metal), edges eased; four countersunk screws through the face into the spring brackets
			out.push(mesh(L.rbox(w, h, d, 0.0018, { grain: 1, seed: 6 }), sk.kind === "wood" ? faces(sk.side, sk.end, 1) : sk.main))
			if (h > 0.05 && d > 0.04) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(screwOn(w / 2, sy * (h / 2 - 0.013), sz * (d / 2 - 0.013), 0.0021, "+x", sy + sz, true))
		}
		for (const f of [0.25, 0.75]) out.push(put(seat("-x", bumperSeatR(d, h)), -w / 2 - 0.0002 + 0.0004, f * h - h / 2, 0))
		return group(out)
	})

	// ============================================================== spring gate
	const steelBlue = () => L.steel("#c3c8ce")
	/** A hinge knuckle: a barrel along z with chamfered ends. */
	const barrel = (r, len) => kit.latheZ([[0, -len / 2], [r - 0.0005, -len / 2], [r, -len / 2 + 0.0005], [r, len / 2 - 0.0005], [r - 0.0005, len / 2], [0, len / 2]], 32, `knuckle|${f5(r)}|${f5(len)}`)
	/** A flat leaf with rounded corners lying in the y-z plane (normal along x), thickness t, z length len, y height hgt. */
	const leafYZ = (len, hgt, t, mat) => {
		const m = mesh(L.extrudeShape(`leaf|${f5(len)}|${f5(hgt)}|${f5(t)}`, L.roundRect(len - 0.0006, hgt - 0.0006, Math.min(0.004, len / 4, hgt / 4)), t, 0.0003, 4), mat)
		m.rotation.y = HALF
		return m
	}
	/** Half the width (z) of the mortise in the gate's top end that the hanger's knuckle and strap sit in: 20.3 mm, or 3 mm short of the gate's front and back faces. */
	const gateSlot = (d) => Math.min(0.0203, d / 2 - 0.003)
	addModel("spring-gate", "hanger", (ctx) => {
		// the hanger's half of the hinge: its knuckle (|z| < 20 mm) on a leaf screwed to the underside; the pivot is `drop` below the block, as the catalog's build_gate
		// puts it (6 mm, or half the gate's thickness and 3 mm more, so the gate's top corners clear the block at any angle)
		const { w, h, d } = ctx
		const out = [beam(ctx, { eyes: [], inset: 0.004 })]
		const rb = 0.0036
		const drop = Math.max(0.006, (ctx.props.thickness ?? 0.02) / 2 + 0.003)
		const pinY = -h / 2 - drop
		const steel = steelBlue()
		const lz = Math.min(d, 2 * gateSlot(ctx.props.depth ?? 0.12)) - 0.0006 // the knuckle spans the hanger's depth, or the gate's slot where that is narrower
		out.push(put(mesh(barrel(rb, lz), steel), 0, pinY, 0))
		// the web: a steel strap from inside the knuckle up into the leaf (a longer hanging bracket for a thick gate), 3.6 mm thick, 4.5 mm past 2 cm long
		const webT = drop > 0.02 ? 0.0045 : 0.0036
		const webH = drop - rb + 0.0008 + 0.0007
		out.push(put(mesh(L.rbox(webT, webH, lz, 0.0006), steel), 0, pinY + rb - 0.0008 + webH / 2, 0)) // the web up to the leaf
		out.push(put(mesh(L.rbox(0.03, 0.0014, d - 0.004, 0.0005), steel), 0, -h / 2 - 0.0007, 0)) // the leaf on the underside
		for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(screwOn(sx * 0.011, -h / 2 - 0.0014, sz * 0.012, 0.0013, "-y", sx + sz))
		return group(out)
	})
	addModel("spring-gate", "post", (ctx) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const out = [mesh(L.rbox(w, h, d, 0.002, { grain: 1, seed: 8 }), faces(sk.side, sk.end, 1))]
		// the spring's hook: an eye screw in the post's left face, a steel plate and two screws on the front
		out.push(put(mesh(L.washer(0.0042, 0.0008), L.brass()), -w / 2 - 0.0001, 0, 0).rotateZ(HALF))
		out.push(put(mesh(kit.torus(0.0028, 0.0009, 10, 22), L.steel("#aab0b6")), -w / 2 - 0.0026, 0, 0))
		for (const sy of [-1, 1]) out.push(screwOn(0, sy * (h / 2 - 0.009), d / 2, 0.0022, "+z", sy, true))
		return group(out)
	})
	addModel("spring-gate", "gate", (ctx) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const rb = 0.0036
		// the plank, its top end mortised (|z| < the slot, rb + 0.6 mm deep) for the hanger's knuckle and strap: swung toward level, the strap lies along the top end and
		// sinks into the slot, not the wood; the front and back faces keep the full height (the side view is the physics outline). Its side profile (z, y) is drawn inset
		// by the bevel and extruded through the thickness (x)
		const b = Math.min(0.0008, w * 0.15)
		const r = Math.min(0.002, w * 0.2, d * 0.2)
		const sh = gateSlot(d)
		const sd = rb + 0.0006
		const geo = L.woodGeo(`gatePlank|${f5(w)}|${f5(h)}|${f5(d)}`, () => {
			const Z = d / 2 - b
			const Y = h / 2 - b
			const rr = Math.max(1e-4, r - b)
			const s = new T.Shape()
			s.moveTo(-Z + rr, -Y)
			s.lineTo(Z - rr, -Y)
			s.absarc(Z - rr, -Y + rr, rr, -Math.PI / 2, 0, false)
			s.lineTo(Z, Y - rr)
			s.absarc(Z - rr, Y - rr, rr, 0, Math.PI / 2, false)
			s.lineTo(sh + b, Y)
			s.lineTo(sh + b, h / 2 - sd - b)
			s.lineTo(-sh - b, h / 2 - sd - b)
			s.lineTo(-sh - b, Y)
			s.lineTo(-Z + rr, Y)
			s.absarc(-Z + rr, Y - rr, rr, Math.PI / 2, Math.PI, false)
			s.lineTo(-Z, -Y + rr)
			s.absarc(-Z + rr, -Y + rr, rr, Math.PI, 1.5 * Math.PI, false)
			const dd = Math.max(1e-5, w - 2 * b)
			const g = new T.ExtrudeGeometry(s, { depth: dd, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4 })
			g.translate(0, 0, -dd / 2)
			g.rotateY(Math.PI / 2)
			return toCreased(g)
		}, { grain: 1, seed: 12 })
		const out = [mesh(geo, [sk.side, sk.end])]
		const steel = steelBlue()
		const kz0 = sh // the hanger's knuckle takes the slot; the gate's two knuckles take the rest of the depth, either side
		const kz1 = d / 2 - 0.0016
		const kl = kz1 - kz0
		const tp = 0.0011
		const lh = Math.min(0.03, h * 0.4) // how far down the leaf runs
		if (kl >= 0.005) {
			for (const sz of [-1, 1]) {
				const zc = (sz * (kz0 + kz1)) / 2
				// the leaf: a plate over the top end and down each face, rolled up into the knuckle; countersunk screws in the cheeks
				out.push(put(mesh(L.rbox(w + 2 * tp, tp, kl - 0.001, 0.0004), steel), 0, h / 2 + tp / 2 - 0.0002, zc))
				for (const sx of [-1, 1]) {
					const lf = leafYZ(kl - 0.001, lh, tp, steel)
					lf.position.set(sx * (w / 2 + tp / 2), h / 2 - lh / 2 + tp - 0.0002, zc)
					out.push(lf)
					const two = kl > 0.026
					for (const y of [h / 2 - 0.009, h / 2 - 0.021]) {
						if (y < h / 2 - lh + 0.004) continue
						for (const dz of two ? [-1, 1] : [0]) out.push(screwOn(sx * (w / 2 + tp), y, zc + dz * 0.0115, 0.0014, sx > 0 ? "+x" : "-x", y * 70 + dz))
					}
				}
				out.push(put(mesh(barrel(rb, kl), steel), 0, h / 2, zc))
			}
		}
		// the hinge pin through all the knuckles (the depth of the gate), a peened head flush at each end
		const pin = mesh(kit.cylinderZ(0.0019, d, 16), L.darkSteel())
		pin.position.set(0, h / 2, 0)
		out.push(pin)
		for (const sz of [-1, 1]) {
			const head = put(mesh(kit.sphere(0.0026, 16, 8), L.steel("#b4bac0")), 0, h / 2, sz * (d / 2 - 0.0007))
			head.scale.z = 0.3
			out.push(head)
		}
		// the spring's eye screw, 70 % of the way down on the right face
		const ey = h / 2 - 0.7 * h
		out.push(put(mesh(L.washer(0.0042, 0.0008), L.brass()), w / 2 + 0.0001, ey, 0).rotateZ(-HALF))
		out.push(put(mesh(kit.torus(0.0028, 0.0009, 10, 22), L.steel("#aab0b6")), w / 2 + 0.0026, ey, 0))
		return group(out)
	})

	// ============================================================== spring catapult
	/** The leather of the arm's cup and of the lip's cushion: ONE key, one set of parameters (the grain's normal map included), whichever part is built first. */
	const armLeather = () => L.MAT("armLeather", { color: "#3a2416", roughness: 0.8, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.5, normalMap: L.normalTex("leather", 64, 64, (x, y) => L.vnoise((x * 19) / 64, (y * 19) / 64, 7, 19) * 0.6 + L.vnoise((x * 58) / 64, (y * 58) / 64, 8, 58) * 0.4, { strength: 1.4 }), normalScale: new T.Vector2(0.5, 0.5) })
	addModel("spring-catapult", "base", (ctx) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const out = [mesh(L.rbox(w, h, d, 0.003, { grain: 0, seed: 14 }), faces(sk.side, sk.end, 0))]
		// the spring's foot, under the cocked eye: the base reaches 3 cm past it (the catalog's build_catapult), so the base's middle is right of the post by half of what it adds
		const a = (ctx.props.cocked_angle ?? 25) * D2R
		const tip = (0.3 * (ctx.props.arm_length ?? 0.4) - 0.02) * Math.cos(a)
		const tipX = tip - (Math.max(0.17, tip + 0.03) - 0.17) / 2
		out.push(put(mesh(L.washer(0.0052, 0.0008), L.steel("#a3a9af")), tipX, h / 2 - 0.0002, 0))
		out.push(put(mesh(kit.torus(0.0036, 0.0011, 10, 22), L.steel("#aab0b6")), tipX, h / 2 + 0.0004, 0, HALF))
		for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(screwOn(sx * (w / 2 - 0.012), h / 2, sz * (d / 2 - 0.012), 0.0024, "+y", sx + sz))
		return group(out)
	})
	addModel("spring-catapult", "post", (ctx) => {
		// a wood clevis post: two cheeks the full height and depth either side of the slot for the arm, and a bridge block between them under the slot. Each cheek's top is
		// rounded in a lug round the pivot (the pin and its heads sit inside it); the lug is no wider than the arm is thick (10 mm either side of the pivot,
		// which the arm's own outline always covers), so the side view's silhouette is still the physics'.
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		// the pivot is 9 mm under the slab's top (the catalog's build_catapult stands the post that much over it for the lug): yp in the slab's frame
		const yp = h / 2 - 0.009
		// the slot is deep enough for the arm's underside (20 mm arm, pivot on its middle line) at both ends of its swing, cocked and on its stop (the catalog's
		// build_catapult: the sweep ends at most 50 degrees past level; the arm overshoots that by up to 3 degrees as it lands), 2 mm to spare over the bridge across
		// the post's width
		const cocked = ctx.props.cocked_angle ?? 25
		const ends = [cocked, cocked - Math.min(ctx.props.sweep ?? 70, cocked + 50) - 3]
		const under = Math.max(...ends.map((a) => (w / 2) * Math.abs(Math.tan(a * D2R)) + 0.01 / Math.cos(a * D2R) + 0.002))
		const slot = Math.min(0.6 * (h - 0.009), Math.max(0.024, under))
		const armD = 0.05
		const hz = d / 2
		const sw = Math.min(hz - 0.003, armD / 2 + 0.0004) // the slot's half width
		const yb = yp - slot // the bridge's top, the slot's floor
		const eps = 0.0001
		const b = 0.0016 // the cheek's bevel
		const R = Math.min(0.009, w / 2 - 0.004) // the lug's radius (its top is the slab's top)
		const sh = Math.min(0.012, slot * 0.5) // the cheek's full width ends this far under the pin
		const key = `catCheek2|${f5(w)}|${f5(h)}|${f5(slot)}|${f5(hz - sw)}`
		const geo = L.woodGeo(key, () => {
			const hw = w / 2 - b
			const Rr = R - b
			const th = Math.atan2(-sh, hw) + Math.acos(Rr / Math.hypot(hw, sh)) // where the line from the shoulder touches the lug's circle
			const s = new T.Shape()
			s.moveTo(-hw, -h / 2 + b)
			s.lineTo(hw, -h / 2 + b)
			s.lineTo(hw, yp - sh)
			s.lineTo(Rr * Math.cos(th), yp + Rr * Math.sin(th))
			s.absarc(0, yp, Rr, th, Math.PI - th, false)
			s.lineTo(-hw, yp - sh)
			s.closePath()
			const dd = hz - sw - 2 * b
			const g = new T.ExtrudeGeometry(s, { depth: dd, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 14 })
			g.translate(0, 0, -dd / 2)
			return toCreased(g)
		}, { grain: 1, seed: 15 })
		const out = []
		for (const sz of [-1, 1]) out.push(put(mesh(geo, [sk.side, sk.end]), 0, 0, (sz * (sw + hz)) / 2))
		// the bridge: fills the post between the cheeks up to the slot's floor (its ends are buried in the cheeks)
		const bridge = mesh(L.rbox(w - 4 * eps, yb + h / 2, 2 * sw + 4 * eps, 0.0012, { grain: 1, seed: 16 }), faces(sk.side, sk.end, 1))
		bridge.position.y = (-h / 2 + yb) / 2
		out.push(bridge)
		return group(out)
	})
	addModel("spring-catapult", "stop", (ctx) => {
		// the stop the arm comes to rest on: a wood block on the post's right face (the physics polygon, its top 2.4 mm under the arm's underside where the arm comes to rest) with a 3 mm rubber cap on the top edge, two countersunk screws through the front
		const pts = ctx.body.points.map((p) => [p.x, p.y]) // the quad: bottom-left, bottom-right, top-right, top-left
		const bev = 0.0005
		const cx = pts.reduce((a, p) => a + p[0], 0) / 4
		const cy = pts.reduce((a, p) => a + p[1], 0) / 4
		const inset = ([x, y]) => {
			const dx = x - cx
			const dy = y - cy
			const l = Math.hypot(dx, dy)
			return new T.Vector2(x - (dx / l) * bev * 1.4, y - (dy / l) * bev * 1.4)
		}
		const capH = 0.003
		const [p0, p1, p2, p3] = pts
		const low = (p) => [p[0], p[1] - capH]
		// the cap's crown stands 1.9 mm proud of the physics polygon's top (a thin detail within the 2 mm rule): the arm comes to rest a contact skin (~2.6 mm) above the polygon, so it visibly sits on the rubber
		const tx = p2[0] - p3[0], ty = p2[1] - p3[1], tl = Math.hypot(tx, ty)
		const crown = (p) => [p[0] - (ty / tl) * 0.0019, p[1] + (tx / tl) * 0.0019]
		const key = pts.map((p) => f5(p[0]) + "," + f5(p[1])).join("|")
		const sk = L.skin(ctx)
		const d = ctx.d
		const woodShape = new T.Shape([p0, p1, low(p2), low(p3)].map(inset))
		const capShape = new T.Shape([low(p3), low(p2), crown(p2), crown(p3)].map(inset))
		// the block's wood at true scale (a raw extrusion's uv are metres, which magnifies the 0.24 m tile 4 x), grain along its length, the end grain on the two ends
		const dd = Math.max(1e-5, d - 2 * bev)
		const woodG = L.woodGeo(`catStopW|${key}|${f5(d)}`, () => {
			const g = new T.ExtrudeGeometry(woodShape, { depth: dd, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 2 })
			g.translate(0, 0, -dd / 2)
			return L.creased(g, 0.75)
		}, { grain: 0, seed: 7 })
		const out = [mesh(woodG, sk.kind === "wood" ? [sk.side, sk.end] : sk.side), mesh(L.extrudeShape(`catStopC|${key}|${f5(d)}`, capShape, d, bev, 2), L.rubberMat("#1b1c1f"))]
		const ang = Math.atan2(p2[1] - p3[1], p2[0] - p3[0])
		for (const t of [0.22, 0.78]) {
			const x = p0[0] + (p1[0] - p0[0]) * t
			const y = (p0[1] + (p3[1] - capH - p0[1]) * 0.5) + (p1[1] - p0[1]) * t
			const sc = screwOn(x, y, d / 2, 0.0017, "+z", ang * 6 + t, true)
			out.push(sc)
		}
		return group(out)
	})
	addModel("spring-catapult", "arm", (ctx) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const out = [mesh(L.rbox(w, h, d, 0.0022, { grain: 0, seed: 18 }), faces(sk.side, sk.end, 0))]
		// where the spring hooks on: a screw eye in the underside near the right end, its ring in the plane the spring pulls in
		const ex = w / 2 - 0.02
		out.push(screwEye(ex, -h / 2 + 0.0004))
		// the pivot: a flush steel strap on each face, a pivot washer and four countersunk screws
		const px = 0.2 * w
		const steel = L.zinc()
		for (const z of [-1, 1]) {
			out.push(put(mesh(L.rbox(0.05, h - 0.004, 0.0016, 0.0005), steel), px, 0, z * (d / 2 - 0.0015 + 0.0016 / 2 + 0.0001)))
			out.push(put(mesh(kit.cylinderZ(0.0062, 0.0006, 24), L.steel("#aeb4ba")), px, 0, z * (d / 2 + 0.0001 + 0.0002)))
			for (const dx of [-0.018, 0.018]) out.push(screwOn(px + dx, 0, z * (d / 2 + 0.0001), 0.0014, z > 0 ? "+z" : "-z", dx * 90))
		}
		// the cup: a leather seat with a raised brass rim for the ball, against the lip (one ball diameter, about 5 cm, wide)
		const cx = -w / 2 + 0.008 + 0.026
		const rr = 0.0235
		const leather = armLeather()
		out.push(put(mesh(kit.cylinderY(rr, 0.0008, 56), leather), cx, h / 2 + 0.0004, 0))
		out.push(put(mesh(kit.torus(rr, 0.0010, 8, 64), L.brass()), cx, h / 2 + 0.0008, 0, HALF))
		for (let k = 0; k < 4; k++) {
			const a = (k * Math.PI) / 2 + 0.7
			out.push(put(mesh(kit.sphere(0.0013, 10, 6), L.brass()), cx + (rr - 0.0058) * Math.cos(a), h / 2 + 0.0005, (rr - 0.0058) * Math.sin(a)))
		}
		return group(out)
	})
	addModel("spring-catapult", "lip", (ctx) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const out = [mesh(L.rbox(w, h, d, 0.0016, { grain: 1, seed: 19 }), faces(sk.side, sk.end, 1))]
		// a leather cushion on the ball's side and two screws through the lip's face
		out.push(put(mesh(L.rbox(0.0018, h - 0.008, d - 0.01, 0.0006), armLeather()), w / 2 + 0.0008, 0, 0))
		for (const sz of [-1, 1]) out.push(screwOn(0, h / 2 - 0.007, sz * (d / 2 - 0.007), 0.0016, "+z", sz))
		return group(out)
	})

	function toCreased(g) {
		return L.creased ? L.creased(g) : g
	}
}
