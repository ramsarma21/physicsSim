// Mechanisms models: rope pendulum, wrecking ball, swing, hanging chain. The ropes themselves are drawn by the view.
export default function register({ addModel, kit, THREE, L, P }) {
	const T = THREE
	const { f5, put, faces } = L
	const { mesh, group, HALF, sideOf, seedOf, beam, screwOn, screwEye } = P

	// ------------------------------------------------------------- shared: hemp rope stubs, a bob that is rigid with its rope
	const frac = (x) => x - Math.floor(x)
	/** The view's three-strand hemp, for short rope pieces the models draw (a swing's knot). */
	function ropeMat() {
		const map = kit.tex("mechRope", 64, 64, (g, W, H) => {
			const img = g.createImageData(W, H)
			for (let y = 0; y < H; y++)
				for (let x = 0; x < W; x++) {
					const u = x / W
					const v = y / H
					const p = 0.5 - 0.5 * Math.cos(L.TAU * frac(u * 3 + v))
					const k = (0.3 + 0.7 * Math.pow(p, 0.7)) * (0.86 + 0.28 * L.vnoise(u * 16, v * 16, 16, 16, 91))
					const o = (y * W + x) * 4
					img.data[o] = Math.min(255, 208 * k)
					img.data[o + 1] = Math.min(255, 172 * k)
					img.data[o + 2] = Math.min(255, 112 * k)
					img.data[o + 3] = 255
				}
			g.putImageData(img, 0, 0)
		})
		return L.MAT("ropeStub", { map, color: "#d0d0d0", roughness: 0.88, metalness: 0 })
	}
	/** A rope piece standing along y: radius r, length len, the strands twisting once per 14 mm. */
	function ropePiece(r, len) {
		return kit.geo(`mropePiece|${f5(r)}|${f5(len)}`, () => {
			const g = new T.CylinderGeometry(r, r, len, 12, 1)
			const uv = g.attributes.uv
			for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / 0.0147))
			return g
		})
	}
	/** Whether the bob turns with its rope: the catalog turns the ball to lie along the rope and ties the rope to its eye (the solid carries `eye`, the height
	 *  of the eye ring's centre above the ball), so the eye always points along the rope. A bob without it is drawn without an eye. */
	function bobRigid(ctx) {
		return ctx.solid.eye != null
	}
	const polished = () => L.metal("bobSteel", "#d0d5db", 0.2)

	// ============================================================== rope pendulum: a polished bob (steel by default)
	function ballSkin(ctx) {
		const look = ctx.solid.look ?? ""
		if (look === "steel") return { kind: "steel", mat: polished() }
		if (look === "aluminium") return { kind: "alu", mat: L.alu("#e4e7ea") }
		if (look === "rubber") return { kind: "rubber", mat: L.rubberMat(ctx.color) }
		if (/wood/.test(look)) return { kind: "wood", mat: L.woodSide(ctx.color) }
		// modeling clay: dead matte with soft lumps (no clear coat, no highlights)
		if (look === "clay") return { kind: "clay", mat: L.MAT(`clay|${ctx.color}`, { color: L.rich(ctx.color), roughness: 0.92, metalness: 0, normalMap: L.normalTex("clayLumps", 128, 128, (x, y) => L.vnoise(x / 16, y / 16, 3, 8) * 0.7 + L.vnoise(x / 5.33, y / 5.33, 9, 24) * 0.3, { strength: 0.9 }), normalScale: new T.Vector2(0.65, 0.65) }) }
		return { kind: "other", mat: L.plasticMat(ctx.color) }
	}
	addModel("rope-pendulum", "hanger", (ctx) => beam(ctx, { eyes: [0] }))
	addModel("rope-pendulum", "bob", (ctx) => {
		const r = ctx.r
		const sk = ballSkin(ctx)
		// a solid turned ball (no parting line: it is one piece, as the physics' solid steel is)
		const out = [mesh(kit.sphere(r, 96, 48), sk.mat)]
		if (bobRigid(ctx)) {
			// the screw eye the rope is tied to: a collar on a shoulder and a ring in the plane facing the camera
			const m = sk.kind === "steel" || sk.kind === "alu" ? sk.mat : L.steel("#c4c9ce")
			const k = Math.max(0.35, Math.min(4.0, r / 0.025)) // the catalog's eye (_bob in catalog_mechanisms.py): it follows the ball up to a 20 cm ball
			const collar = kit.lathe([[0, 0], [0.0042 * k, 0], [0.0042 * k, 0.0006 * k], [0.0030 * k, 0.0016 * k], [0.0030 * k, 0.0026 * k], [0, 0.0026 * k]], 28, `bobCollar|${f5(k)}`)
			out.push(put(mesh(collar, m), 0, r - 0.0006 * k, 0))
			out.push(put(mesh(kit.torus(0.0029 * k, 0.0010 * k, 10, 28), m), 0, r + (0.0026 + 0.0027) * k - 0.0006 * k, 0))
		}
		return group(out)
	})

	// ============================================================== wrecking ball: dark forged steel, a forged lifting eye (when the rope is tied to it)
	const hazard = (key, W, H) => L.grade(kit.printed(`hazard|${key}`, (g, w, h) => {
		g.fillStyle = L.richCss("#f4b400")
		g.fillRect(0, 0, w, h)
		g.fillStyle = "#1b1c1f"
		const sp = h * 0.9
		for (let x = -h; x < w + h; x += sp) {
			g.beginPath()
			g.moveTo(x, h)
			g.lineTo(x + sp * 0.5, h)
			g.lineTo(x + sp * 0.5 + h, 0)
			g.lineTo(x + h, 0)
			g.fill()
		}
	}, { w: W, h: H, roughness: 0.45, clearcoat: 0.4 }))
	addModel("wrecking-ball", "hanger", (ctx) => {
		// the crane's jib tip: a yellow I-beam (flanges across the full depth, a web between them), stiffeners, hazard-striped end plates,
		// a clamp plate under the middle with a lug the chain is made fast to
		const { w, h, d } = ctx
		const tf = Math.min(0.0016, h * 0.14)
		const tw = Math.min(0.003, d * 0.08)
		const capT = 0.004
		const bl = w - 2 * capT
		const yellow = L.paint("#f4b400", 0.65)
		const out = []
		const flange = (sy) => put(mesh(L.rbox(bl, tf, d, 0.0004, { uv: false }), yellow), 0, sy * (h / 2 - tf / 2), 0)
		out.push(flange(1), flange(-1))
		out.push(mesh(L.rbox(bl, h - 2 * tf + 0.0006, tw, 0.0004, { uv: false }), yellow))
		const nSt = Math.max(3, Math.round(bl / 0.034))
		for (let i = 0; i < nSt; i++) {
			const x = -bl / 2 + 0.017 + (i * (bl - 0.034)) / (nSt - 1)
			for (const sz of [-1, 1]) out.push(put(mesh(L.rbox(0.0016, h - 2 * tf, d / 2 - tw / 2 - 0.002, 0.0004, { uv: false }), yellow), x, 0, sz * (tw / 2 + (d / 2 - tw / 2 - 0.002) / 2)))
		}
		const stripes = hazard(`${f5(h)}|${f5(d)}`, 256, 128)
		for (const sx of [-1, 1]) out.push(put(mesh(L.rbox(capT, h, d, 0.0007, { uv: false }), [stripes, stripes, stripes, stripes, stripes, stripes]), sx * (w / 2 - capT / 2), 0, 0))
		// the clamp: a steel plate under the bottom flange with two bolts, and the lug (a pierced boss with a cross pin)
		const plate = mesh(L.rbox(0.03, 0.0026, d - 0.004, 0.0007), L.steel("#c0c5cb"))
		plate.position.y = -h / 2 - 0.0013
		out.push(plate)
		for (const sz of [-1, 1]) {
			const bolt = mesh(kit.cylinderY(0.0034, 0.0022, 6), L.steel("#9aa0a6"))
			bolt.position.set(0.0095, -h / 2 - 0.0037, sz * 0.012)
			const bolt2 = bolt.clone()
			bolt2.position.x = -0.0095
			out.push(bolt, bolt2)
		}
		const lug = mesh(L.rbox(0.014, 0.0075, 0.009, 0.002), L.steel("#bfc4ca"))
		lug.position.set(0, -h / 2 - 0.0026 - 0.00375 + 0.0004, 0)
		out.push(lug)
		const pin = mesh(kit.cylinderZ(0.0021, 0.0135, 16), L.steel("#9aa0a6"))
		pin.position.set(0, -h / 2 - 0.0056, 0)
		out.push(pin)
		return group(out)
	})
	addModel("wrecking-ball", "bob", (ctx) => {
		const r = ctx.r
		const out = [mesh(kit.sphere(r, 96, 48), L.forged())]
		const seam = mesh(kit.torus(r, 0.0007, 6, 96), L.darkSteel())
		seam.rotation.x = HALF
		out.push(seam)
		if (bobRigid(ctx)) {
			// a forged lifting eye: a boss with a fillet and a heavy ring
			const k = Math.max(0.67, Math.min(2.2, r / 0.045)) // the catalog's eye (_bob in catalog_mechanisms.py): the same size, so the eye is where the chain is made fast and its hole takes the chain's wire
			const boss = mesh(kit.lathe([[0, 0], [0.0110 * k, 0], [0.0094 * k, 0.0014 * k], [0.0075 * k, 0.0038 * k], [0.0064 * k, 0.0062 * k], [0, 0.0062 * k]], 32, `wb-boss2|${f5(k)}`), L.forged())
			boss.position.y = r - 0.0025 * k
			const ring = mesh(kit.torus(0.0072 * k, 0.0027 * k, 12, 32), L.forged())
			ring.position.y = r - 0.0025 * k + (0.0062 + 0.0072 - 0.0010) * k
			out.push(boss, ring)
		}
		return group(out)
	})

	// ============================================================== swing: a plank seat with brass funnel eyelets, the rope through each hole and knotted underneath
	addModel("swing", "bar", (ctx) => {
		const x = (ctx.props.seat_width ?? 0.3) / 2 - 0.02
		return beam(ctx, { eyes: [-x, x], screwPitch: 0.08 })
	})
	addModel("swing", "seat", (ctx) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const body = mesh(L.rbox(w, h, d, Math.min(0.005, h * 0.35), { grain: 0, seed: 11 }), faces(sk.side, sk.end, 0))
		const out = [body]
		const hx = (ctx.props.seat_width ?? 0.3) / 2 - 0.02
		const dark = L.MAT("holeDark", { color: "#120d08", roughness: 0.9 })
		const rope = ropeMat()
		const brass = L.brass()
		// a brass flanged grommet in each rope hole (1 mm flange, rolled lip, a neck lining the hole); the same one turned over on the underside
		const grommet = kit.lathe([[0.0078, 0], [0.0078, 0.0006], [0.0072, 0.0010], [0.0062, 0.0012], [0.0053, 0.0010], [0.0047, 0.0004], [0.0044, -0.0006], [0.0044, -0.0030]], 40, "swingGrommet")
		const knot = kit.geo("swingKnot", () => new T.TorusKnotGeometry(0.0030, 0.0016, 64, 10, 2, 3))
		const holeDisc = kit.geo("swingHole", () => new T.CircleGeometry(0.0044, 32).rotateX(-HALF))
		const ky = -h / 2 + 0.0038 // the stopper knot: the rope's end, bigger than the hole, seated against the plank so its bulge shows 2 mm under the underside
		for (const sx of [-1, 1]) {
			const x = sx * hx
			out.push(put(mesh(holeDisc, dark, { cast: false }), x, h / 2 + 0.0001, 0))
			out.push(put(mesh(grommet, brass), x, h / 2 - 0.0002, 0))
			out.push(put(mesh(holeDisc, dark, { cast: false }).rotateX(Math.PI), x, -h / 2 - 0.0001, 0))
			const gu = put(mesh(grommet, brass), x, -h / 2 + 0.0002, 0)
			gu.rotation.x = Math.PI
			out.push(gu)
			// the rope's last piece: down inside the hole (it ends 1 mm under the top face) to the knot
			const yTop = h / 2 - 0.001
			out.push(put(mesh(ropePiece(0.0019, yTop - ky), rope), x, (yTop + ky) / 2, 0))
			out.push(put(mesh(knot, rope), x, ky, 0, HALF * 0.3, 0.3, 0))
		}
		return group(out)
	})

	// ============================================================== hanging chain: real links (wire d = 0.29 h, an even number to each pin), clevis blocks at the ends
	const chainPost = (ctx) => {
		const { w, h, d } = ctx
		const slot = Math.max(0.005, 1.3 * 0.29 * (ctx.props.thickness ?? 0.01)) // the slot the first link's wire (0.29 of the link thickness) turns in, with 30 % to spare
		const cheek = (d - slot) / 2
		const steel = L.steel("#bfc4ca")
		const out = []
		for (const sz of [-1, 1]) out.push(put(mesh(L.rbox(w, h, cheek, 0.0016, { uv: false, seg: 2 }), steel), 0, 0, sz * (slot / 2 + cheek / 2)))
		// the bridge over the slot (the slot is open underneath, where the chain leaves)
		out.push(put(mesh(L.rbox(w, h / 2, slot + 0.0004, 0.0012, { uv: false, seg: 2 }), steel), 0, h / 4, 0))
		// the cross pin: its flat round head in each cheek, flush with the face (a peened pin through the slot's top)
		const bolt = L.steel("#9da3a9")
		const headR = Math.max(0.005, 0.5 * 0.29 * (ctx.props.thickness ?? 0.01) + 0.002) // the pin is as thick as the link's wire, its head 2 mm more all round
		for (const sz of [-1, 1]) {
			const head = mesh(kit.cylinderZ(headR, 0.0004, 24), bolt)
			head.position.z = sz * (d / 2)
			out.push(head)
		}
		for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(screwOn(sx * (w / 2 - 0.0042), sy * (h / 2 - 0.0042), sz * d / 2, 0.0016, sz > 0 ? "+z" : "-z", sx + sy, true))
		return group(out)
	}
	addModel("hanging-chain", "post-left", chainPost)
	addModel("hanging-chain", "post-right", chainPost)
	// ---- the links: each bar is ONE mesh (its links merged into one geometry), at a detail that follows how many links the whole chain has
	/** [radial segments of the wire, segments of each half ring]: a link is 4 x radial x (segments + 1) triangles (280 for 7 x 9, 60 for 3 x 4). */
	const LINK_LEVELS = [[7, 9], [6, 8], [5, 6], [4, 5], [3, 4]]
	const linkTris = ([r, t]) => 4 * r * (t + 1)
	const CHAIN_BUDGET = 20000 // triangles for all the links of one chain (the two clevis blocks add about 4-6k: the item stays under ~30k)
	/** One chain link standing in the x-y plane (flat): wire d, clear length Li, clear width wi; two half tori and two straights, merged (not cached: only the bar keeps it). */
	function linkBase(Li, wi, d, [rad, seg]) {
		const rc = (wi + d) / 2
		const S = Math.max(1e-4, Li - wi)
		const parts = []
		parts.push(new T.TorusGeometry(rc, d / 2, rad, seg, Math.PI).rotateZ(-HALF).translate(S / 2, 0, 0))
		parts.push(new T.TorusGeometry(rc, d / 2, rad, seg, Math.PI).rotateZ(HALF).translate(-S / 2, 0, 0))
		for (const s of [-1, 1]) parts.push(new T.CylinderGeometry(d / 2, d / 2, S, rad, 1, true).rotateZ(HALF).translate(0, s * rc, 0))
		const g = L.mergeGeometries(parts, false)
		for (const q of parts) q.dispose()
		return g
	}
	/** A whole bar: N links of pitch p along x (the first centred p/2 in from the bar's end), every second one turned a quarter round the chain's axis (edge-on), in one geometry. */
	function barGeo(N, w, Li, wi, d, lvl, wood = false) {
		return kit.geo(`mchainBar|${N}|${f5(w)}|${f5(Li)}|${f5(wi)}|${f5(d)}|${lvl[0]}x${lvl[1]}|${wood ? "w" : ""}`, () => {
			const base = linkBase(Li, wi, d, lvl)
			const bp = base.attributes.position
			const bn = base.attributes.normal
			const bu = base.attributes.uv
			const bi = base.index
			const vc = bp.count
			const ic = bi.count
			const P = new Float32Array(N * vc * 3)
			const Nn = new Float32Array(N * vc * 3)
			const U = new Float32Array(N * vc * 2)
			const I = new (N * vc > 65535 ? Uint32Array : Uint16Array)(N * ic)
			const p = w / N
			for (let k = 0; k < N; k++) {
				const x0 = -w / 2 + (k + 0.5) * p
				const flat = k % 2 === 0
				for (let v = 0; v < vc; v++) {
					const o = (k * vc + v) * 3
					const x = bp.getX(v)
					const y = bp.getY(v)
					const z = bp.getZ(v)
					P[o] = x + x0
					P[o + 1] = flat ? y : -z // edge-on: turned +90 degrees about x, (y, z) -> (-z, y)
					P[o + 2] = flat ? z : y
					const nx = bn.getX(v)
					const ny = bn.getY(v)
					const nz = bn.getZ(v)
					Nn[o] = nx
					Nn[o + 1] = flat ? ny : -nz
					Nn[o + 2] = flat ? nz : ny
					// a wooden link takes the wood texture at true scale, the grain along the chain (u = x / 0.24 m, v round the wire); the others keep the tube's own uv
					U[(k * vc + v) * 2] = wood ? P[o] / 0.24 : bu.getX(v)
					U[(k * vc + v) * 2 + 1] = wood ? (P[o + 1] + 1.7 * P[o + 2]) / 0.12 : bu.getY(v)
				}
				for (let i = 0; i < ic; i++) I[k * ic + i] = bi.getX(i) + k * vc
			}
			base.dispose()
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.BufferAttribute(P, 3))
			g.setAttribute("normal", new T.BufferAttribute(Nn, 3))
			g.setAttribute("uv", new T.BufferAttribute(U, 2))
			g.setIndex(new T.BufferAttribute(I, 1))
			return g
		})
	}
	/** How the whole chain is drawn, worked out from its props alone (so every bar agrees): the wire, the links to a bar, the detail level.
	 *  Links to a bar are even (the last bar odd) so each hooks through its neighbour; the detail drops (and, past the lowest, the pitch lengthens) so the links stay within the budget. */
	function chainPlan(ctx) {
		const n = Math.max(1, Math.round(ctx.props.links ?? 14))
		const th = ctx.h
		const d = Math.max(0.0006, 0.29 * Math.min(th, ctx.d)) // wire diameter
		const Lc = Math.max(ctx.props.chain_length ?? 0.8, (ctx.props.span ?? 0.6) * 1.02)
		const even = (w) => 2 * Math.max(1, Math.round(w / (3 * d) / 2))
		const per = even(Lc / n) // links to a bar, on average
		let lvl = LINK_LEVELS[LINK_LEVELS.length - 1]
		for (const l of LINK_LEVELS) if (n * per * linkTris(l) <= CHAIN_BUDGET) { lvl = l; break }
		const cap = Math.max(2, 2 * Math.floor(CHAIN_BUDGET / (n * linkTris(lvl)) / 2)) // most links to a bar at the lowest detail (even)
		// a chain of far more links than the budget has triangles (a long thin one: 3 m of 3 mm chain is over a thousand links): lengthening the pitch would turn the links
		// into paper-clips, so it is drawn as ribbons instead (below): the links keep their proportions, a few triangles each
		const ribbon = n * per * linkTris(LINK_LEVELS[LINK_LEVELS.length - 1]) > 1.3 * CHAIN_BUDGET
		return { n, d, lvl, cap, even, ribbon }
	}
	// ---- the ribbon chain: each bar is two crossing flat ribbons (one in the chain's plane, one across it), each carrying a tileable picture of two pitches of links
	// with an alpha cut-out and a normal map that rounds the wire: the face-on links are rings with their holes open, the edge-on ones bars through them. One tile
	// (240 x 136 px: 40 px a wire diameter) serves every size, since a link's proportions are fixed in wire diameters; the uv run along the bar in whole pitches.
	const RK = 40
	const RIB_W = 240
	const RIB_H = 136
	/** The tile's field at pixel (px, py): [coverage 0..1, nx, ny, nz]. A ring (face-on link) is centred at x = 60 (and 300), a bar (edge-on link) at 180 (and -60). */
	function ribbonPixel(px, py) {
		const Y = (RIB_H / 2 - (py + 0.5)) / RK
		const best = (cx, ring) => {
			const X = (px + 0.5 - cx) / RK
			const a = ring ? 0.8 : 2.0 // half length of the centre line's straight part
			const ds = Math.hypot(Math.max(Math.abs(X) - a, 0), Y)
			const dc = ring ? ds - 1.2 : ds // distance from the wire's centre line, in wire diameters
			const cov = Math.min(1, Math.max(0, (0.5 - Math.abs(dc)) * RK + 0.5))
			if (cov <= 0) return null
			const t = Math.max(-1, Math.min(1, dc / 0.5))
			const dx = Math.max(Math.abs(X) - a, 0) * Math.sign(X)
			const il = ds > 1e-6 ? 1 / ds : 0
			return [cov, dx * il * t, Y * il * t, Math.sqrt(Math.max(0, 1 - t * t))]
		}
		const ring = best(60, true) ?? best(300, true)
		const bar = best(180, false) ?? best(-60, false)
		if (ring && (!bar || ring[0] >= 0.5 || ring[0] >= bar[0])) return ring
		return bar ?? [0, 0, 0, 1]
	}
	function ribbonMat(ctx, look) {
		const alpha = kit.tex("chainRibbonA", RIB_W, RIB_H, (g, W, H) => {
			const img = g.createImageData(W, H)
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const o = (y * W + x) * 4
				img.data[o] = img.data[o + 1] = img.data[o + 2] = 255
				img.data[o + 3] = ribbonPixel(x, y)[0] * 255
			}
			g.putImageData(img, 0, 0)
		}, { data: true })
		const normal = kit.tex("chainRibbonN", RIB_W, RIB_H, (g, W, H) => {
			const img = g.createImageData(W, H)
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const [c, nx, ny, nz] = ribbonPixel(x, y)
				const o = (y * W + x) * 4
				img.data[o] = (nx * 0.5 + 0.5) * 255
				img.data[o + 1] = (ny * 0.5 + 0.5) * 255
				img.data[o + 2] = (nz * 0.5 + 0.5) * 255
				img.data[o + 3] = 255
			}
			g.putImageData(img, 0, 0)
		}, { data: true })
		const base = { map: alpha, normalMap: normal, normalScale: new T.Vector2(1, 1), alphaTest: 0.5, side: T.DoubleSide }
		if (/wood/.test(look)) return L.MAT(`chainRibbon|wood|${ctx.color}`, { ...base, color: L.rich(ctx.color), metalness: 0, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.15 })
		if (look === "aluminium") return L.MAT("chainRibbon|alu", { ...base, color: "#d3d8dd", metalness: 1, roughness: 0.34 })
		return L.MAT("chainRibbon|steel", { ...base, color: "#d4d8dc", metalness: 1, roughness: 0.34 })
	}
	/** One bar as two crossing ribbons: the links' outer width wo tall, the bar's length w long, uv in whole pitches (p = w / N). */
	function ribbonGeo(N, w, wo) {
		return kit.geo(`mchainRib|${N}|${f5(w)}|${f5(wo)}`, () => {
			const p = w / N
			const P = [], U = []
			const quad = (pos, vShift) => {
				for (const k of [0, 1, 2, 0, 2, 3]) {
					const [x, a] = pos[k]
					P.push(x, ...(vShift ? [0, a] : [a, 0]))
					U.push((x + w / 2) / (2 * p) + (vShift ? 0.5 : 0), (a + wo / 2) / wo)
				}
			}
			quad([[-w / 2, -wo / 2], [w / 2, -wo / 2], [w / 2, wo / 2], [-w / 2, wo / 2]], false) // in the chain's plane (x-y)
			quad([[-w / 2, -wo / 2], [w / 2, -wo / 2], [w / 2, wo / 2], [-w / 2, wo / 2]], true) // across it (x-z), half a tile on
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.BufferAttribute(new Float32Array(P), 3))
			g.setAttribute("normal", new T.BufferAttribute(Float32Array.from({ length: P.length }, (_, i) => (i < 18 ? (i % 3 === 2 ? 1 : 0) : i % 3 === 1 ? 1 : 0)), 3))
			g.setAttribute("uv", new T.BufferAttribute(new Float32Array(U), 2))
			return g
		})
	}
	const linkModel = (ctx) => {
		const { w } = ctx
		const i = Number(/\d+/.exec(ctx.solid.id.split("/")[1])[0]) // 1-based
		const { n, d, lvl, cap, even, ribbon } = chainPlan(ctx)
		const wo = 3.4 * d // outer width
		let N = ribbon ? even(w) : Math.min(even(w), cap)
		if (i === n) N = ribbon ? Math.max(1, 2 * Math.round((w / (3 * d) - 1) / 2) + 1) : Math.min(Math.max(1, 2 * Math.round((w / (3 * d) - 1) / 2) + 1), cap - 1) // the very last bar gets an odd number so it ends flat on the pin
		const Li = w / N
		const wi = Math.max(d * 1.2, wo - 2 * d)
		if (ribbon) return group(mesh(ribbonGeo(N, w, wo), ribbonMat(ctx, ctx.solid.look ?? ""), { cast: true }))
		// the links are made of what the chain is: zinc-plated steel, aluminium, or varnished hardwood (the look of the link solids)
		const look = ctx.solid.look ?? ""
		const wood = /wood/.test(look)
		const m = wood ? L.woodSide(ctx.color) : look === "aluminium" ? L.alu("#d3d8dd") : L.zinc()
		return group(mesh(barGeo(N, w, Li, wi, d, lvl, wood), m))
	}
	for (let i = 1; i <= 30; i++) addModel("hanging-chain", `link${i}`, linkModel)
}
