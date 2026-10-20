// The cart: an iron-bound wooden wagon. A bed of two side beams and five planks (with real end grain), iron straps, corner brackets and nail heads;
// the wheels are outside the bed on iron axles: the kind of wheel follows the material (dark wood: a spoked wagon wheel with an iron tyre exactly as wide as the felloe,
// twelve spokes, a nave sticking out past the felloe with iron bands and a linch-pin; varnished hardwood: a turned wooden wheel; steel: a machined steel wheel;
// tyre rubber: a rubber tyre on a steel disc; solid rubber, hollow plastic: moulded wheels). The axle-trees run up inside each wheel's disc to the bed.
import { makeWheelKit } from "./vehicles-wheelkit.js"
import { makeTurned } from "./vehicles-turned.js"

export default function register(addModel, L, kit) {
	const T = L.THREE
	const { TAU, rng, fbm, put, mat, normalMap, M, hash, rgb } = L
	const wk = makeWheelKit(L, kit)
	const tw = makeTurned(L, kit)
	const SPEC = { L: 0.22, axle: 0.075 }

	const woodMat = (color, rough = 0.62, varnish = 0.3, seed = 1) => L.wood(color, { seed, roughness: rough, varnish })
	const iron = () => mat("cart-iron", { color: "#3d4046", roughness: 0.55, metalness: 0.85 })
	const ironBright = () => mat("cart-iron-b", { color: "#4a4e55", roughness: 0.4, metalness: 0.9 })

	/** End grain: growth rings seen on a cut end (arcs round an off-centre pith), a lighter wood. seed varies the pith. */
	function endGrainMat(color, seed) {
		const map = kit.tex(`veh|endgrain|${color}|${seed}`, 256, 128, (g, W, H) => {
			const r = rng(seed * 13 + 5)
			const [br, bg, bb] = rgb(color)
			g.fillStyle = `rgb(${br},${bg},${bb})`
			g.fillRect(0, 0, W, H)
			const cx = (0.2 + 0.6 * r()) * W
			const cy = (r() < 0.5 ? -0.5 : 1.5) * H
			for (let i = 0; i < 46; i++) {
				const rad = 14 + i * 6.2 + 2 * r()
				g.strokeStyle = `rgba(${Math.round(br * 0.55)},${Math.round(bg * 0.5)},${Math.round(bb * 0.4)},${0.2 + 0.25 * r()})`
				g.lineWidth = 0.8 + 1.6 * r()
				g.beginPath()
				g.arc(cx, cy, rad, 0, TAU)
				g.stroke()
			}
			for (let i = 0; i < 90; i++) {
				g.fillStyle = `rgba(80,48,20,${0.05 + 0.1 * r()})`
				g.fillRect(r() * W, r() * H, 1 + r() * 2, 1)
			}
			g.fillStyle = "rgba(0,0,0,0.0)"
		}, { wrap: false })
		return mat(`endgrain|${color}|${seed}`, { map, roughness: 0.85, metalness: 0 })
	}

	// ----------------------------------------------------------------- the bed
	function bed(ctx) {
		const pb = L.bounds(ctx.body.points.map((p) => [p.x, p.y])) // a polygon body: ctx.w / ctx.h are undefined
		const w = pb.x1 - pb.x0
		const h = pb.y1 - pb.y0
		const d = ctx.d
		const g = kit.group()
		const hz = d / 2
		const hx = w / 2
		const s = w / SPEC.L
		// ---- two thick side beams (the full outline's height), planks between them
		const beamW = 0.0125 * Math.min(1, s)
		const bo = 0.0009 // the beams stand 0.9 mm inside the bed's depth: the iron straps and bolts on them are flush with it
		// (painted, the item's colour prop: the side beams, what a side view sees, take the paint as a stain; the deck stays bare wood)
		for (const sz of [1, -1]) g.add(put(kit.box(w, h, beamW, 0.0012, 2), woodMat(ctx.solid.color ?? "#a8723f", 0.6, 0.35, 11), 0, 0, sz * (hz - bo - beamW / 2)))
		const planks = 5
		const inner = d - 2 * beamW - 2 * bo + 0.0004
		const pw = inner / planks
		const deckT = h * 0.76
		const colours = ["#c99a5f", "#bc8c52", "#d1a468", "#c0914f", "#cb9d60"]
		for (let i = 0; i < planks; i++) {
			g.add(put(kit.box(w - 0.0004, deckT, pw - 0.001, 0.0006, 2), woodMat(colours[i], 0.62, 0.3, 20 + i * 7), 0, h / 2 - deckT / 2, -inner / 2 + pw * (i + 0.5)))
		}
		// two cleats under the planks, near the ends
		for (const sx of [1, -1]) g.add(put(kit.box(0.0085, h - deckT - 0.0004, inner - 0.001, 0.0004, 1), woodMat("#7c4f27", 0.7, 0.1, 61), sx * (hx - 0.016), -h / 2 + (h - deckT) / 2 - 0.0001, 0))
		// ---- end grain on the ends of the planks and beams: faces on the two ends
		for (const sx of [1, -1]) {
			for (let i = 0; i < planks; i++) {
				const end = new T.Mesh(kit.geo(`veh|cartplankend|${pw.toFixed(5)}|${deckT.toFixed(5)}`, () => new T.PlaneGeometry(pw - 0.001, deckT)), endGrainMat(colours[i], 3 + i))
				end.position.set(sx * (hx - 0.00004), h / 2 - deckT / 2, -inner / 2 + pw * (i + 0.5))
				end.rotation.y = sx * Math.PI / 2
				end.receiveShadow = true
				g.add(end)
			}
			for (const sz of [1, -1]) {
				const end = new T.Mesh(kit.geo(`veh|cartbeamend|${beamW.toFixed(5)}|${h.toFixed(5)}`, () => new T.PlaneGeometry(beamW, h - 0.0016)), endGrainMat("#a8723f", 9 + (sz > 0 ? 1 : 2)))
				end.position.set(sx * (hx - 0.00004), 0, sz * (hz - bo - beamW / 2))
				end.rotation.y = sx * Math.PI / 2
				end.receiveShadow = true
				g.add(end)
			}
		}
		// ---- iron: a strap round each beam at each axle with square bolt heads, corner brackets at the beams' ends; all inside the bed's depth
		const ax = SPEC.axle * s
		const zo = hz - 0.00045
		for (const sx of [1, -1]) {
			for (const sz of [1, -1]) {
				g.add(put(kit.box(0.0085, h - 0.0008, 0.0009, 0.0003, 1), iron(), sx * ax, 0, sz * zo))
				for (const yy of [h / 2 - 0.0075, -h / 2 + 0.0075]) g.add(put(kit.box(0.0034, 0.0034, 0.0012, 0.0004, 1), ironBright(), sx * ax, yy, sz * (zo - 0.0001)))
				g.add(put(kit.box(0.011, 0.0072, 0.0009, 0.0003, 1), iron(), sx * (hx - 0.0066), h / 2 - 0.0042, sz * zo))
				g.add(put(kit.box(0.0034, 0.0034, 0.0012, 0.0004, 1), ironBright(), sx * (hx - 0.0102), h / 2 - 0.0042, sz * (zo - 0.0001)))
				g.add(put(kit.box(0.0034, 0.0034, 0.0012, 0.0004, 1), ironBright(), sx * (hx - 0.0032), h / 2 - 0.0042, sz * (zo - 0.0001)))
			}
			g.add(put(kit.box(0.0085, 0.0009, d - 0.0006, 0.0003, 1), iron(), sx * ax, -h / 2 + 0.0004, 0)) // a strap across the bottom at the axle-tree
		}
		// nail heads along each plank
		const nail = mat("cart-nail", { color: "#25272b", roughness: 0.4, metalness: 0.9 })
		const nh = kit.geo("cart-nailhead", () => new T.CylinderGeometry(0.00075, 0.00075, 0.0006, 8))
		for (let i = 0; i < planks; i++) {
			for (const sx of [-1, 1]) for (const k of [0.78, 0.2]) g.add(put(nh, nail, sx * (hx - 0.0078 - (k > 0.5 ? 0 : 0.054)), h / 2 + 0.0001, -inner / 2 + pw * (i + 0.5)))
		}
		return g
	}

	// ----------------------------------------------------------------- the wheels
	const KIND = { "dark wood": "spoked", "varnished hardwood": "wood", steel: "steel", "tyre rubber": "tyre", "bicycle tyre": "tyre", "solid rubber": "rubber", "hollow plastic": "plastic" }

	/** The iron tyre's skin: dull iron with wear marks and a little rust, tiled round (u) and across (v). */
	function ironTex() {
		return kit.tex("veh|irontyre", 512, 32, (g, W, H) => {
			const r = rng(17)
			g.fillStyle = "#6b6f75"
			g.fillRect(0, 0, W, H)
			for (let i = 0; i < 600; i++) {
				const c = 90 + Math.round(r() * 50)
				g.fillStyle = `rgba(${c},${c + 2},${c + 6},${0.15 + 0.3 * r()})`
				g.fillRect(r() * W, r() * H, 1 + r() * 5, 1 + r() * 1.4)
			}
			for (let i = 0; i < 60; i++) {
				g.fillStyle = `rgba(${130 + Math.round(r() * 40)},${70 + Math.round(r() * 20)},${35},${0.15 + 0.3 * r()})`
				g.fillRect(r() * W, r() * H, 1 + r() * 4, 1 + r() * 2)
			}
			g.fillStyle = "rgba(190,195,200,0.25)"
			g.fillRect(0, 0, W, 1.5)
			g.fillRect(0, H - 1.5, W, 1.5)
		}, { wrap: true })
	}

	/** A spoked wagon wheel of radius R, width w (felloe and iron tyre), outer face toward +z: felloe, 12 spokes, a nave sticking out `nv` past each side. */
	function spokedWheel(R, w, nv, color) {
		const k = R / 0.025
		const g = kit.group()
		const tyreT = 0.0012 * k
		const felloeR = R - tyreT
		const felloeW = 0.0062 * k
		const wood = L.wood(color, { seed: 5, roughness: 0.6, varnish: 0.45 })
		const band = mat("cart-tyre2", { map: ironTex(), roughness: 0.5, metalness: 0.9 })
		// the iron tyre: a flat band exactly as wide as the felloe
		const tyreProf = [[R - tyreT, -w / 2], [R, -w / 2], [R, w / 2], [R - tyreT, w / 2]]
		g.add(put(L.revolveZ(tyreProf, { segments: 56, repeatU: 6, key: `carttyre2|${R.toFixed(5)}|${w.toFixed(5)}`, creaseDeg: 80 }), band))
		// the felloe: the wooden ring inside it, with its edges eased
		const fProf = L.roundedProfile([[felloeR - felloeW, -w / 2], [felloeR, -w / 2, 0.0004 * k], [felloeR, w / 2, 0.0004 * k], [felloeR - felloeW, w / 2]], 2)
		g.add(put(L.revolveZ(fProf, { segments: 48, key: `cartfel2|${R.toFixed(5)}|${w.toFixed(5)}` }), wood))
		// the nave: a barrel sticking out past the felloe on both sides, an iron band at each end, an iron cap on the outer end and a linch-pin through the axle's end
		const hubR = 0.27 * R
		const hubL = w + 2 * nv
		const bore = 0.0022 * k
		const hProf = L.roundedProfile([[bore, -hubL / 2], [hubR * 0.8, -hubL / 2, 0.0007 * k], [hubR, -hubL * 0.3], [hubR, hubL * 0.3], [hubR * 0.8, hubL / 2, 0.0007 * k], [bore, hubL / 2]], 3)
		g.add(put(L.revolveZ(hProf, { segments: 28, key: `carthub2|${R.toFixed(5)}|${hubL.toFixed(5)}` }), wood))
		for (const sg of [-1, 1]) g.add(put(kit.torus(hubR * 0.88, 0.0009 * k, 6, 28), ironBright(), 0, 0, sg * (hubL / 2 - nv * 0.35)))
		// twelve spokes: tapered boards from the nave to the felloe, a little thinner than the felloe
		const n = 12
		const r0 = hubR * 0.9
		const r1 = felloeR - felloeW + 0.0007 * k
		const sw = w * 0.6
		const sp = kit.geo(`cartspoke2|${R.toFixed(5)}|${w.toFixed(5)}`, () => {
			const shape = new T.Shape([new T.Vector2(r0, -0.0017 * k), new T.Vector2(r1, -0.0011 * k), new T.Vector2(r1, 0.0011 * k), new T.Vector2(r0, 0.0017 * k)])
			const geo = new T.ExtrudeGeometry(shape, { depth: sw, bevelEnabled: true, bevelThickness: 0.0003 * k, bevelSize: 0.0003 * k, bevelOffset: -0.0003 * k, bevelSegments: 1, curveSegments: 2 })
			geo.translate(0, 0, -sw / 2)
			return geo
		})
		for (let i = 0; i < n; i++) {
			const m = put(sp, wood)
			m.rotation.z = (i / n) * TAU + 0.12
			g.add(m)
		}
		return g
	}

	function wheelPair(ctx) {
		const R = ctx.r
		const k = R / 0.025
		const w = 0.3 * R
		const nv = 0.0035 // the nave sticks out this far past the felloe; the axle's end a little beyond it
		const tail = 0.0025
		const zc = ctx.d / 2 - tail - nv - w / 2
		const kind = KIND[ctx.props.material] ?? "spoked"
		const g = kit.group()
		const axleR = 0.0034 * k
		const wheel = () => {
			if (kind === "spoked") return spokedWheel(R, w, nv, ctx.solid.color ?? "#5b3a21")
			if (kind === "tyre") {
				// a rubber tyre on a steel disc rim
				const rimR = 0.74 * R
				const ty = wk.tyre({ R, rimR, w, blocks: 22, tread: "road", key: "cart", segments: 44 })
				const wg = kit.group()
				wg.add(put(ty.geo, ty.mat))
				wg.add(tw.turnedWheel("steel", rimR + 0.0003, w - 0.0007, { bore: axleR + 0.0001, key: "cartrim" }))
				return wg
			}
			const tk = { wood: "wood", steel: "steel", rubber: "rubber", plastic: "plastic" }[kind]
			return tw.turnedWheel(tk, R, w, { bore: axleR + 0.0001, key: "cart", color: ctx.solid.color ?? undefined })
		}
		const right = wheel()
		right.position.z = zc
		const left = wheel()
		left.rotation.y = Math.PI
		left.position.z = -zc
		g.add(right, left)
		// the iron axle through both naves to a cap and a pin just inside the outline
		g.add(put(kit.cylinderZ(axleR, ctx.d - 0.0006, 14), ironBright()))
		for (const sz of [1, -1]) {
			g.add(put(kit.cylinderZ(axleR * 1.5, 0.0009, 14), ironBright(), 0, 0, sz * (ctx.d / 2 - tail + 0.0003)))
			g.add(put(kit.cylinderY(0.0005 * k, 0.0066 * k, 8), M.steel("#9ca2aa", 0.35), 0, 0, sz * (ctx.d / 2 - 0.0012)))
		}
		// the axle-tree: a wooden beam under the bed, between the wheels, up inside the wheels' side-view discs to the bed's underside
		const half = 0.0035
		const yTop = Math.sqrt(Math.max(1e-8, R * R - half * half)) + 0.0013
		const beam = kit.geo(`veh|axletree|${R.toFixed(5)}|${ctx.d.toFixed(5)}`, () => new T.BoxGeometry(2 * half, yTop + 0.004, 2 * (zc - w / 2) - 0.0008))
		g.add(put(beam, L.wood("#6b4524", { seed: 31, roughness: 0.65, varnish: 0.15 }), 0, (yTop - 0.004) / 2, 0))
		return g
	}

	addModel("cart", "chassis", bed)
	addModel("cart", "front", wheelPair)
	addModel("cart", "rear", wheelPair)
}
