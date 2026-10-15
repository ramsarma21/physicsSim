// The toy car (a red die-cast hatchback) and the motor car (a blue-and-white sports coupe), drawn on the catalog's two polygons (a lower body and a cabin).
// The lower body is a lofted shell (plan taper, crowned top, rounded shoulders) with real wheel arches: a narrow core, a dark liner, and the tyres standing in the arches.
// The cabin is a greenhouse: painted side frames with window openings (leaning in 9 degrees: tumblehome), a roof, tinted glass you can see the interior through
// (floor, seats, dashboard, steering wheel), a seal-framed windshield and rear window. Bumpers wrap the nose and tail; lamps, grille, plates, door mirrors.
import { makeWheelKit } from "./vehicles-wheelkit.js"
import { makeLoft } from "./vehicles-loft.js"
import { makeParts } from "./vehicles-parts.js"
import { makeTurned } from "./vehicles-turned.js"
import { makeGlasshouse } from "./vehicles-glasshouse.js"

const G = 9.81

export default function register(addModel, L, kit) {
	const T = L.THREE
	const { TAU, shade, roundPoly, offsetPoly, clipPoly, plate, put, mat, decalMat, quadGeo, bounds, M, decalPoly, sideDecals, flipText, norm2 } = L
	const wk = makeWheelKit(L, kit)
	const lf = makeLoft(L, kit)
	const pt = makeParts(L, kit)
	const tw = makeTurned(L, kit)
	const glasshouse = makeGlasshouse(L, kit, lf, pt)

	// ----------------------------------------------------------------- the two cars' designs
	const CARS = {
		"toy-car": {
			L: 0.2, axle: 0.063, r: 0.017, clear: 0.5, paint: "#b5200f", metal: 0.25, chrome: "#d9dce1", rim: "alloy", spokes: 5,
			doors: { front: 0.205, mid: -0.085, rear: -0.21 }, // door shut lines (x / length)
			stripe: null, roundel: null, lamp: "#fff1c8", plate: ["S-BOX 7", "TOY 20"], rearSeat: true, mirrorX: 0.0335, trim: { floor: "#6e6858", ceiling: "#a89f8a", seat: "#b9a98a", dash: "#4d4a44" },
		},
		"motor-car": {
			L: 0.2, axle: 0.064, r: 0.016, clear: 0.5, paint: "#1d5db8", metal: 0.45, chrome: "#cfd3da", rim: "dark", spokes: 7,
			doors: { front: 0.19, mid: null, rear: -0.2 },
			stripe: "#f4f6f8", roundel: "25", lamp: "#e9f3ff", plate: ["MOTOR", "25"], rearSeat: false, mirrorX: 0.0135, trim: { floor: "#4e5258", ceiling: "#9ea3aa", seat: "#d3d6da", dash: "#34373c" },
		},
	}
	const pts2 = (ctx) => ctx.body.points.map((p) => [p.x, p.y])
	/** Where the car's parts sit, from its props (the same numbers as machines/catalog_mechanisms.py). */
	function rig(ctx, spec, pts) {
		const P = ctx.props
		const Lc = P.length ?? spec.L
		const r = (P.wheel_diameter ?? 2 * spec.r) / 2
		const s = Lc / spec.L
		const hzs = (P.suspension ?? 8) <= 0 ? 0 : Math.max(P.suspension ?? 8, 2)
		const sag = hzs ? G / (2 * Math.PI * hzs) ** 2 : 0
		const lift = Math.max(spec.clear * r, sag + 0.008)
		const b = bounds(pts)
		const hh = b.y1 - b.y0
		return { Lc, r, s, sag, ax: spec.axle * s, wy: r - (lift + hh / 2), hh, ...b }
	}
	const paintOf = (ctx, spec) => ctx.solid.color ?? spec.paint
	/** The outline's front (max x) or rear (min x) face: its x and the y range of the points on it. */
	function endFace(pts, front) {
		const x = front ? Math.max(...pts.map((p) => p[0])) : Math.min(...pts.map((p) => p[0]))
		const ys = pts.filter((p) => Math.abs(p[0] - x) < 1e-4).map((p) => p[1])
		return { x, y0: Math.min(...ys), y1: Math.max(...ys) }
	}
	const under = () => mat("car-underbody", { color: "#1a1b1e", roughness: 0.62, metalness: 0.3 })
	const interior = (c = "#27282c") => mat(`car-interior|${c}`, { color: c, roughness: 0.85, metalness: 0 })
	const darkPlastic = () => M.plastic("#141517", 0.5)

	// ----------------------------------------------------------------- the lower body
	function loftOf(ctx, spec) {
		const pts = pts2(ctx)
		const rg = rig(ctx, spec, pts)
		const s = rg.s
		const hw = ctx.d / 2
		const rounded = roundPoly(pts, { dev: 0.0009 })
		const tyreW = 0.53 * rg.r
		const zc = hw - 0.001 - tyreW - 0.0025
		const ends = { front: { len: 0.025 * s, taper: 0.08 * hw, R: 0.01 * s }, rear: { len: 0.02 * s, taper: 0.08 * hw, R: 0.01 * s } }
		const arches = [1, -1].map((sx) => ({ x: sx * rg.ax, cy: rg.wy + rg.sag, R: 1.1 * rg.r, zc })) // centred on the wheel as it sits when the body has settled on its springs
		const o = { hw, ends, tumbleDeg: 0, crown: 0.001 * s, rt: 0.0045 * s, rb: 0.0035 * s, arches, skin: 0.0015, key: `${spec.paint}|${JSON.stringify(pts)}` }
		return { pts, rg, s, hw, rounded, ends, arches, o, prof: lf.profileOf(rounded, o) }
	}

	function body(ctx, spec) {
		const { pts, rg, s, hw, rounded, ends, arches, o, prof } = loftOf(ctx, spec)
		const g = kit.group()
		const paint = M.paint(paintOf(ctx, spec), spec.metal)
		g.add(put(lf.bodyLoft(rounded, o), [paint, under()]))

		// ---- the side decal on the flat part of the side: rocker strip, character line, door shut lines, handles, stripe, roundel; the arches are erased
		const sharp = rounded.sharp
		const nE = sharp.length
		const offs = sharp.map((p, e) => {
			const q = sharp[(e + 1) % nE]
			const [dx] = norm2(q[0] - p[0], q[1] - p[1])
			const ny = -dx
			return ny < -0.5 ? o.rb : ny > 0.5 ? o.rt : 0.002
		})
		let cap = offsetPoly(sharp, offs)
		cap = clipPoly(cap, 1, 0, rg.x1 - ends.front.len)
		cap = clipPoly(cap, -1, 0, -(rg.x0 + ends.rear.len))
		const bw = rg.x1 - rg.x0
		const bh = rg.y1 - rg.y0
		const pxm = 6500
		const Lc = rg.Lc
		if (cap.length >= 3) sideDecals(g, decalPoly(cap, rg.x0, rg.y0, bw, bh), hw + 0.0002, `carside2|${o.key}|${spec.stripe}|${spec.roundel}`, bw, bh, pxm, (c, W, H, flip) => {
			const X = (x) => (x - rg.x0) * pxm
			const Y = (y) => (rg.y1 - y) * pxm
			// the rocker panel: dark plastic
			c.fillStyle = "rgba(22,23,26,0.94)"
			c.fillRect(0, Y(rg.y0 + o.rb + 0.0042 * s), W, 0.0042 * s * pxm + 3)
			// the pressed character line, a light edge over a dark one
			const yl = rg.y0 + (spec.stripe ? 0.0235 : 0.0225) * s * (rg.hh / (0.036 * s))
			c.lineWidth = 0.00065 * pxm
			c.strokeStyle = "rgba(255,255,255,0.34)"
			c.beginPath()
			c.moveTo(0, Y(yl + 0.0007))
			c.lineTo(W, Y(yl + 0.0007))
			c.stroke()
			c.strokeStyle = "rgba(0,0,0,0.3)"
			c.beginPath()
			c.moveTo(0, Y(yl - 0.0006))
			c.lineTo(W, Y(yl - 0.0006))
			c.stroke()
			if (spec.stripe) {
				c.fillStyle = spec.stripe
				c.fillRect(0, Y(rg.y0 + 0.0125 * s), W, 0.0052 * s * pxm)
			}
			// door shut lines: front, middle (if any), rear; slightly leaning like the real thing
			const d = spec.doors
			const lines = [d.front, d.mid, d.rear].filter((u) => u !== null && u !== undefined)
			const top = rg.y1 - 0.0004
			const bot = rg.y0 + o.rb + 0.0042 * s
			c.strokeStyle = "rgba(10,10,12,0.88)"
			c.lineWidth = 0.0006 * pxm
			for (const u of lines) {
				c.beginPath()
				c.moveTo(X(u * Lc + 0.002 * s), Y(top))
				c.lineTo(X(u * Lc - 0.0015 * s), Y(bot))
				c.stroke()
			}
			c.beginPath()
			c.moveTo(X(lines[0] * Lc - 0.0015 * s), Y(bot))
			c.lineTo(X(lines[lines.length - 1] * Lc - 0.0015 * s), Y(bot))
			c.stroke()
			// handles: a chrome bar high on the rear of each door
			const handleY = rg.y1 - 0.0065 * s
			const doors = [d.front, d.mid, d.rear].filter((u) => u !== null && u !== undefined)
			for (let i = 0; i < doors.length - 1; i++) {
				const hx = doors[i + 1] * Lc + 0.0095 * s
				c.fillStyle = "rgba(222,226,232,0.96)"
				c.fillRect(X(hx), Y(handleY), 0.0085 * s * pxm, 0.0016 * s * pxm)
				c.fillStyle = "rgba(0,0,0,0.4)"
				c.fillRect(X(hx), Y(handleY) + 0.0016 * s * pxm, 0.0085 * s * pxm, 0.0004 * pxm)
			}
			if (spec.roundel) {
				const cx = X(((d.front + d.rear) / 2) * Lc + 0.003)
				const cy = Y(rg.y0 + 0.0205 * s)
				c.fillStyle = "#f4f6f8"
				c.beginPath()
				c.arc(cx, cy, 0.0037 * s * pxm, 0, TAU)
				c.fill()
				c.fillStyle = "#101216"
				c.font = `800 ${0.0046 * s * pxm}px ui-sans-serif, Helvetica, Arial, sans-serif`
				c.textAlign = "center"
				c.textBaseline = "middle"
				flipText(c, spec.roundel, cx, cy + 0.0002 * pxm, flip)
			}
			// the wheel arches are open (the loft has them): wipe the decal there
			c.globalCompositeOperation = "destination-out"
			c.fillStyle = "#000"
			for (const a of arches) {
				c.beginPath()
				c.arc(X(a.x), Y(a.cy), (a.R + 0.0007) * pxm, 0, TAU)
				c.fill()
			}
		}, { roughness: 0.42, clearcoat: 0.6 })

		// ---- the nose: headlamps, grille, a wrap-around bumper
		const nose = endFace(pts, true)
		const tail = endFace(pts, false)
		const nh = nose.y1 - nose.y0
		const th = tail.y1 - tail.y0
		const wN = prof.W(prof.x1)
		const wT = prof.W(prof.x0)
		const chrome = M.chrome(spec.chrome)
		const lampR = Math.min(0.0036 * s, nh * 0.21)
		const lampY = nose.y1 - 0.0017 * s - lampR
		const lampZ = wN - lampR - 0.0033 * s
		for (const sz of [1, -1]) {
			const lamp = pt.headlamp(lampR, { tint: spec.lamp, key: spec.paint })
			lamp.rotation.y = Math.PI / 2
			lamp.position.set(nose.x - 0.00012, lampY, sz * lampZ)
			g.add(lamp)
		}
		const gw = 2 * (lampZ - lampR - 0.0021 * s)
		const gh = Math.min(0.0075 * s, nh * 0.42)
		const gr = pt.grille(gw, gh, { n: 4, key: spec.paint })
		gr.rotation.y = Math.PI / 2
		gr.position.set(nose.x - 0.0003, nose.y1 - 0.0017 * s - gh / 2, 0)
		g.add(gr)
		const tallB = Math.min(0.0055 * s, nh * 0.34)
		const bumpY = nose.y0 + 0.0005 * s
		const bumper = (dir, ex) => {
			g.add(put(lf.bumperBand(prof, hw, dir, { tall: tallB, thick: 0.0013 * s, y0: bumpY, wrap: 0.006 * s, key: `${o.key}|b` }), darkPlastic()))
			g.add(put(lf.bumperBand(prof, hw, dir, { tall: 0.0011 * s, thick: 0.0016 * s, y0: bumpY + tallB * 0.38, wrap: 0.0075 * s, key: `${o.key}|c` }), chrome))
			void ex
		}
		bumper(1)
		bumper(-1)
		// ---- the tail: lamp clusters, a plate
		const tlH = Math.min(0.0116 * s, th * 0.5)
		const tlW = 0.0058 * s
		for (const sz of [1, -1]) {
			const tl = pt.taillamp(tlW, tlH, { key: spec.paint })
			tl.rotation.y = -Math.PI / 2
			tl.position.set(tail.x + 0.0001, tail.y1 - 0.0017 * s - tlH / 2, sz * (wT - tlW / 2 - 0.0033 * s))
			g.add(tl)
		}
		const mk = (txt, bgc) => decalMat(`plate2|${txt}|${bgc}`, 0.0165 * s, 0.0072 * s, 12000 / s, (c, W, H) => {
			c.fillStyle = bgc
			c.fillRect(0, 0, W, H)
			c.strokeStyle = "rgba(0,0,0,0.5)"
			c.lineWidth = 2
			c.strokeRect(1, 1, W - 2, H - 2)
			c.fillStyle = "#101216"
			c.font = `700 ${H * 0.52}px ui-sans-serif, Helvetica, Arial, sans-serif`
			c.textAlign = "center"
			c.textBaseline = "middle"
			c.fillText(txt, W / 2, H / 2 + H * 0.03)
		}, { roughness: 0.4 })
		if (nh > 0.012 * s) g.add(put(quadGeo(0.0165 * s, 0.0072 * s), mk(spec.plate[0], "#f1f1ec"), nose.x + 0.0016 * s + 0.0003, bumpY + tallB * 0.5, 0, [0, Math.PI / 2, 0], { cast: false }))
		g.add(put(quadGeo(0.0165 * s, 0.0072 * s), mk(spec.plate[1], "#f2d24b"), tail.x - 0.0004, Math.max(bumpY + tallB + 0.0011, tail.y1 - th * 0.52), 0, [0, -Math.PI / 2, 0], { cast: false }))

		// ---- door mirrors: a teardrop housing on a stalk at the front of each door, on the cabin base
		const cabBase = Math.max(...pts.filter((p) => p[0] < nose.x - 0.02 * s).map((p) => p[1])) // the body's flat top, where the cabin stands
		const hzCab = ctx.d / 2 - 0.004 * s
		for (const sz of [1, -1]) {
			const m = pt.mirror(paint, { s: s * 1.08, key: spec.paint })
			m.position.set(spec.mirrorX * s, cabBase + 0.0013 * s, sz * (hzCab - 0.0005))
			m.scale.z = sz
			g.add(m)
		}
		return g
	}

	// ----------------------------------------------------------------- the cabin: a greenhouse
	function cabin(ctx, spec) {
		const pts = pts2(ctx)
		const P = ctx.props
		const Lc = P.length ?? spec.L
		const s = Lc / spec.L
		const hz = ctx.d / 2
		const d = spec.doors
		const xm = d.mid !== null && d.mid !== undefined ? d.mid * Lc : d.rear * Lc + 0.002 * s // the B-pillar on the door's shut line
		const key = `cab2|${spec.paint}|${JSON.stringify(pts)}|${hz.toFixed(5)}`
		const gh = glasshouse({
			pts, hz, s, paint: M.paint(paintOf(ctx, spec), spec.metal), roofDark: interior(spec.trim.ceiling), key, phiDeg: 9, xm,
			cPillar: d.mid !== null && d.mid !== undefined ? null : xm - 0.0016 * s - 0.018 * s, // a one-door car: the quarter light ends in a C-pillar 18 mm behind the B-pillar
			off: (E) => (E.ny < -0.9 ? 0.0023 * s : E.ny > 0.9 ? 0.0041 * s : E.nx > 0 ? 0.0047 * s : 0.0057 * s),
		})
		const g = gh.group
		const b = gh.b
		// ---- the interior, seen through the glass: floor, seats, dashboard, steering wheel
		const xb0 = pts[0][0]
		const xb1 = pts[1][0]
		const Lb = xb1 - xb0
		const zi = hz - gh.th - 0.0008
		g.add(put(kit.box(Lb - 0.004 * s, 0.0008, 2 * zi, 0.0002, 1), interior(spec.trim.floor), (xb0 + xb1) / 2, b.y0 + 0.0003, 0))
		const seat = (x, w, z) => {
			const sm = pt.seat(w, 0.0105 * s, { depth: 0.0125 * s, color: spec.trim.seat })
			sm.position.set(x, b.y0 + 0.0006, z)
			return sm
		}
		const xs = xb0 + (spec.rearSeat ? 0.62 : 0.58) * Lb
		g.add(seat(xs, 0.0135 * s, 0.0105 * s), seat(xs, 0.0135 * s, -0.0105 * s))
		if (spec.rearSeat) g.add(seat(xb0 + 0.2 * Lb, 0.0345 * s, 0))
		const dashX = xb1 - 0.0105 * s - 0.0032 * s
		g.add(put(kit.box(0.0066 * s, 0.0050 * s, 2 * zi * 0.97, 0.0016, 2), pt.fabric(spec.trim.dash), dashX, b.y0 + 0.0025 * s + 0.0006, 0))
		const sw = pt.steering(0.0032 * s)
		sw.position.set(dashX - 0.0105 * s, b.y0 + 0.0089 * s, 0.0105 * s)
		g.add(sw)
		return g
	}

	// ----------------------------------------------------------------- wheels: a pair on an axle, the kind of wheel following the chosen material
	const KIND = { "tyre rubber": "tyre", "bicycle tyre": "tyre", "solid rubber": "rubber", "hollow plastic": "plastic", "varnished hardwood": "wood", "dark wood": "darkwood", steel: "steel" }
	function wheelPair(ctx, spec) {
		const R = ctx.r
		const k = R / 0.03
		const w = 0.53 * R
		const zc = ctx.d / 2 - w / 2
		const kind = KIND[ctx.props.material] ?? "tyre"
		const g = kit.group()
		const axleR = 0.1 * R
		const wheel = () => {
			if (kind !== "tyre") {
				const tg = tw.turnedWheel(kind, R, w, { bore: axleR + 0.0001, key: "car", color: ctx.solid.color ?? undefined, blocks: 0 })
				return tg
			}
			const rimR = 0.73 * R
			const ty = wk.tyre({ R, rimR, w, blocks: spec.rim === "dark" ? 30 : 26, tread: "road", key: "car", segments: 40 })
			const alloy = spec.rim === "alloy" ? M.chrome("#cfd3da") : mat("rim-dark", { color: "#202226", roughness: 0.28, metalness: 0.9 })
			const baseMat = mat("rim-base", { color: "#26282c", roughness: 0.55, metalness: 0.7 })
			const capMat = spec.rim === "alloy" ? M.chrome("#e8eaee") : mat("rim-cap", { color: "#e24a1f", roughness: 0.3, metalness: 0.4, clearcoat: 0.6 })
			const star = wk.starPlate({ Ro: rimR - 0.0012 * k, r0: 0.27 * R, r1: rimR - 0.0028 * k, n: spec.spokes, hw0: 0.0036 * k, hw1: 0.0026 * k, depth: 0.0026 * k, round: 0.0016 * k, key: `car|${spec.rim}|${k.toFixed(3)}` })
			const hubCap = kit.geo(`carcap|${R.toFixed(5)}`, () => new T.SphereGeometry(0.15 * R, 16, 5, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2))
			const zd = w / 2 - 0.0042 * k // the dark drum behind the spokes ends here
			const wg = kit.group()
			wg.add(put(ty.geo, ty.mat))
			wg.add(put(kit.cylinderZ(rimR - 0.0006 * k, 0.0075 * k, 28), baseMat, 0, 0, zd - 0.00375 * k))
			wg.add(put(kit.torus(rimR - 0.0007 * k, 0.0015 * k, 6, 32), alloy, 0, 0, w / 2 - 0.0015 * k))
			wg.add(put(star, alloy, 0, 0, zd + 0.0008 * k))
			const cap = put(hubCap, capMat, 0, 0, zd + 0.0019 * k)
			cap.scale.set(1, 1, 0.38)
			wg.add(cap)
			return wg
		}
		const right = wheel()
		right.position.z = zc
		const left = wheel()
		left.rotation.y = Math.PI
		left.position.z = -zc
		g.add(right, left)
		g.add(put(kit.cylinderZ(axleR, 2 * zc - w + 0.002, 16), M.chrome("#9ea4ab")))
		if (kind !== "tyre") {
			// the axle's ends: a domed cap in each wheel's bore
			for (const sz of [1, -1]) {
				const d = put(kit.sphere(axleR * 1.5, 14, 8), M.chrome("#c9ccd2"), 0, 0, sz * (zc + w / 2 - axleR * 0.6))
				d.scale.z = 0.5
				g.add(d)
			}
		}
		return g
	}

	for (const [key, spec] of Object.entries(CARS)) {
		addModel(key, "chassis", (ctx) => body(ctx, spec))
		addModel(key, "cabin", (ctx) => cabin(ctx, spec))
		addModel(key, "front", (ctx) => wheelPair(ctx, spec))
		addModel(key, "rear", (ctx) => wheelPair(ctx, spec))
	}
}
