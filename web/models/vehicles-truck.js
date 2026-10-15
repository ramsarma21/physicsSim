// The truck: a toy cab-over flatbed. An open frame (two real C-channel rails, crossmembers) under a plank deck with steel side angles and stake pockets, a toolbox and a
// fuel tank between the axles, a chrome bumper; a yellow cab (a lofted lower body with grille, lamps, doors, step, plus a greenhouse of frames, glass and an interior,
// with a cab guard and a rear window on its back); the cab's yellow skirt, apron and step round the front wheel's arch; big lugged tyres on red steel wheels.
// The parts are the catalog's: the frame-and-deck slab (chassis), the cab, and two blocks of the cab's lower front (apron ahead of the wheel, step behind it).
import { makeWheelKit } from "./vehicles-wheelkit.js"
import { makeLoft } from "./vehicles-loft.js"
import { makeParts } from "./vehicles-parts.js"
import { makeTurned } from "./vehicles-turned.js"
import { makeGlasshouse } from "./vehicles-glasshouse.js"

const G = 9.81

export default function register(addModel, L, kit) {
	const T = L.THREE
	const { TAU, shade, roundPoly, offsetPoly, clipPoly, plate, put, mat, decalMat, quadGeo, bounds, M, decalPoly, sideDecals, flipText, norm2, onFace } = L
	const wk = makeWheelKit(L, kit)
	const lf = makeLoft(L, kit)
	const pt = makeParts(L, kit)
	const tw = makeTurned(L, kit)
	const glasshouse = makeGlasshouse(L, kit, lf, pt)
	const SPEC = { L: 0.5, yellow: "#ffc400", frame: "#2b2d32", chrome: "#d9dce1" }
	// the plan of the truck's one yellow front face: the cab, the slab's nose slice and the apron all get these ends, so their corners and edges line up
	const NOSE_LEN = 0.03
	const noseEnds = (s) => ({ len: NOSE_LEN * s, taper: 0.003 * s, R: 0.012 * s })
	const pts2 = (ctx) => ctx.body.points.map((p) => [p.x, p.y])
	const yellowOf = (ctx) => ctx.solid.color ?? SPEC.yellow
	const steel = () => mat("truck-steel", { color: "#3a3d43", roughness: 0.48, metalness: 0.85 })
	const frameMat = () => mat("truck-frame2", { color: SPEC.frame, roughness: 0.5, metalness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4, normalMap: L.peel(), normalScale: new T.Vector2(0.2, 0.2) })
	const dark = () => M.plastic("#141517", 0.5)

	/** The numbers of the truck from its props (the same as machines/catalog_mechanisms.py _hull_flatbed). */
	function rig(ctx) {
		const P = ctx.props
		const Lc = P.length ?? SPEC.L
		const s = Lc / SPEC.L
		const r = (P.wheel_diameter ?? 0.1) / 2
		const hzs = (P.suspension ?? 4) <= 0 ? 0 : Math.max(P.suspension ?? 4, 2)
		const sag = hzs ? G / (2 * Math.PI * hzs) ** 2 : 0
		const lift = Math.max(0.6 * r, sag + 0.008)
		const hh = Math.max(0.08 * s, 2 * r + sag + 0.004 - lift, 0.01)
		const t = 0.035 * s
		const top = Math.max(lift + hh, 2 * r + sag + 0.016)
		const yc = top - t / 2
		return { Lc, s, r, sag, lift, t, yc, ax: 0.17 * s, wy: r - yc, cyL: r - yc + sag, hz: 0.1 * s }
	}
	// a box: a plain 12-triangle one when its edge radius is 0.6 mm or less (rails, crossmembers, angles: the rounding cannot be seen), else a rounded one
	const pbox = (w, h, d) => kit.geo(`veh|pbox|${w.toFixed(5)}|${h.toFixed(5)}|${d.toFixed(5)}`, () => new T.BoxGeometry(w, h, d))
	const box = (w, h, d, x, y, z, m, r = 0.0006) => put(r <= 0.0006 ? pbox(w, h, d) : kit.box(w, h, d, r, 1), m, x, y, z)

	// ----------------------------------------------------------------- the frame and deck
	function chassis(ctx) {
		const R = rig(ctx)
		const { Lc, s, t, r, ax, cyL } = R
		const hz = ctx.d / 2
		const x0 = -Lc / 2
		const x1 = Lc / 2
		const yT = t / 2
		const yB = -t / 2
		const g = kit.group()
		const fr = frameMat()
		const st = steel()
		const deckT = 0.01 * s
		const yD = yT - deckT // the deck's underside
		const cabBack = 0.18 * Lc
		// ---- two C-channel rails (open to the outside) with rows of rivets, and crossmembers between them
		const zr = 0.05 * s
		const rw = 0.012 * s
		const wt = 0.003 * s
		const railL = x1 - 0.012 * s - (x0 + 0.002)
		const railX = (x0 + 0.002 + x1 - 0.012 * s) / 2
		for (const sz of [1, -1]) {
			g.add(box(railL, yD - yB, wt, railX, (yD + yB) / 2, sz * (zr - rw / 2 + wt / 2), fr, 0.0004)) // the web, on the inside
			g.add(box(railL, wt, rw, railX, yD - wt / 2, sz * zr, fr, 0.0004)) // top flange
			g.add(box(railL, wt, rw, railX, yB + wt / 2, sz * zr, fr, 0.0004)) // bottom flange
		}
		const rivet = kit.geo(`veh|rivet|${s.toFixed(3)}`, () => new T.CylinderGeometry(0.0014 * s, 0.0014 * s, 0.0008, 6).rotateZ(Math.PI / 2))
		const rivets = L.merged(`truckrivets|${s.toFixed(3)}|${Lc.toFixed(3)}`, () => {
			const list = []
			for (let k = 0; k < 16; k++) {
				const x = x0 + 0.02 * s + (k * (Lc - 0.05 * s)) / 15
				for (const yy of [yD - 0.0075 * s, yB + 0.0075 * s]) list.push(rivet.clone().translate(x, yy, 0))
			}
			return list
		})
		for (const sz of [1, -1]) g.add(put(rivets, st, 0, 0, sz * (zr - rw / 2 - 0.0004)))
		for (const fx of [-0.45, -0.3, -0.15, 0.0, 0.16, 0.34, 0.455]) {
			g.add(box(0.008 * s, 0.012 * s, 2 * (zr - rw / 2), fx * Lc, yD - 0.006 * s, 0, fr, 0.0004))
		}
		// ---- the deck: eight planks along x to the cab, steel angle along the sides and rear, stake pockets
		const planks = 8
		const zd = hz - 0.0028 * s
		const wp = (2 * zd) / planks
		const colours = ["#dcb780", "#d2ab72", "#e0bd88", "#cba068", "#d8b27a", "#d0a870", "#e2bf8c", "#c99d66"]
		const xe = cabBack - 0.0004
		for (let i = 0; i < planks; i++) {
			const xs = x0 + 0.0028 * s + 0.0012 * (i % 3)
			const len = xe - xs
			g.add(put(kit.box(len, deckT, wp - 0.0012, 0.0006, 1), L.wood(colours[i], { seed: 3 + i * 5, roughness: 0.6, varnish: 0.3, rings: 6 }), xs + len / 2, yT - deckT / 2, -zd + wp * (i + 0.5)))
		}
		const angle = mat("truck-angle", { color: "#454950", roughness: 0.4, metalness: 0.9 })
		for (const sz of [1, -1]) g.add(box(xe - x0, deckT, 0.0025 * s, (x0 + xe) / 2, yT - deckT / 2, sz * (hz - 0.00125 * s), angle, 0.0005))
		g.add(box(0.0028 * s, deckT, 2 * hz - 0.0006, x0 + 0.0014 * s, yT - deckT / 2, 0, angle, 0.0005)) // the tail's angle
		const socket = box(0.015 * s, 0.0105 * s, 0.0034 * s, 0, 0, 0, angle, 0.0005).geometry
		const slot = kit.geo(`veh|slot|${s.toFixed(3)}`, () => new T.BoxGeometry(0.0105 * s, 0.0004, 0.0016 * s))
		const slotM = mat("truck-slot", { color: "#08090a", roughness: 0.7 })
		for (let k = 0; k < 7; k++) {
			const x = x0 + 0.03 * s + (k * (cabBack - x0 - 0.06 * s)) / 6
			for (const sz of [1, -1]) {
				g.add(put(socket, angle, x, yT - 0.0063 * s + 0.0015, sz * (hz - 0.0027 * s - 0.0003)))
				g.add(put(slot, slotM, x, yT + 0.0014 * s + 0.0003, sz * (hz - 0.0027 * s - 0.0003)))
			}
		}
		// ---- between the axles: a fuel tank on the left, a diamond-plate toolbox on the right
		const tankR = 0.0105 * s
		const tank = put(kit.cylinderY(tankR, 0.088 * s, 28), mat("truck-tank", { color: "#b9bec6", roughness: 0.32, metalness: 1 }), -0.04 * s, yB + tankR + 0.0001, -(zr + rw / 2 + 0.019 * s), [0, 0, Math.PI / 2])
		g.add(tank)
		for (const dx of [-0.022, 0.022]) g.add(put(kit.cylinderY(tankR + 0.0004, 0.0035 * s, 28), st, -0.04 * s + dx * s, yB + tankR + 0.0001, -(zr + rw / 2 + 0.019 * s), [0, 0, Math.PI / 2]))
		g.add(put(kit.cylinderZ(0.0032 * s, 0.003 * s, 14), M.steel("#2a2c31", 0.5), -0.04 * s + 0.047 * s, yB + tankR + 0.0001, -(zr + rw / 2 + 0.019 * s)))
		const diamond = decalMat(`diamond|${s.toFixed(3)}`, 0.075 * s, 0.022 * s, 9000, (c, W, H) => {
			c.fillStyle = "#c9ced4"
			c.fillRect(0, 0, W, H)
			c.fillStyle = "rgba(255,255,255,0.55)"
			c.strokeStyle = "rgba(60,64,70,0.5)"
			c.lineWidth = 1
			for (let y = 6; y < H; y += 12) for (let x = ((y / 12) % 2) * 7 + 4; x < W; x += 14) {
				c.beginPath()
				c.ellipse(x, y, 4.2, 1.7, ((y / 12) % 2 ? 1 : -1) * 0.75, 0, TAU)
				c.fill()
				c.stroke()
			}
			c.strokeStyle = "rgba(40,44,50,0.9)"
			c.lineWidth = 3
			c.strokeRect(W * 0.04, H * 0.1, W * 0.92, H * 0.8)
			c.fillStyle = "#2a2c31"
			c.fillRect(W * 0.78, H * 0.45, 20, 5)
		}, { metalness: 0.7, roughness: 0.4 })
		const tbZ = zr + rw / 2 + 0.021 * s
		g.add(box(0.075 * s, 0.0215 * s, 0.026 * s, 0.047 * s, yB + 0.01075 * s + 0.0001, tbZ, mat("truck-toolbox", { color: "#9ea4ab", roughness: 0.4, metalness: 0.9 }), 0.0012))
		g.add(put(quadGeo(0.075 * s, 0.0215 * s), diamond, 0.047 * s, yB + 0.01075 * s + 0.0001, tbZ + 0.013 * s + 0.0001, null, { cast: false }))
		// ---- the cab's yellow skirt: a side panel over the frame from the cab's back to the nose, the front wheel's arch cut out
		const yellow = yellowOf(ctx)
		const paint = M.paint(yellow, 0)
		const Ra = 1.1 * r
		const dxA = Math.sqrt(Math.max(0, Ra * Ra - (yB - cyL) * (yB - cyL)))
		const aL = Math.atan2(yB - cyL, -dxA) // the arch meets the frame's underside at these angles (the wheel's centre is below it): over the top from left to right
		const aR = Math.atan2(yB - cyL, dxA)
		const skirtPts = [[cabBack, yB], [ax - dxA, yB]]
		for (let k = 1; k < 16; k++) {
			const a = aL + ((aR - aL) * k) / 16
			skirtPts.push([ax + Ra * Math.cos(a), cyL + Ra * Math.sin(a)])
		}
		skirtPts.push([ax + dxA, yB], [x1 - NOSE_LEN * s, yB], [x1 - NOSE_LEN * s, yT], [cabBack, yT]) // the skirt ends where the nose slice (the plan-rounded front) begins
		const skirtGeo = kit.geo(`veh|truckskirt|${Lc.toFixed(4)}|${r.toFixed(4)}|${cyL.toFixed(4)}|${t.toFixed(4)}`, () => {
			const sh = new T.Shape(skirtPts.map(([x, y]) => new T.Vector2(x, y)))
			const geo = new T.ExtrudeGeometry(sh, { depth: 0.0022 * s, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelOffset: -0.0004, bevelSegments: 1, curveSegments: 6 })
			geo.translate(0, 0, -0.0011 * s)
			return geo
		})
		const flareGeo = kit.geo(`veh|truckflare|${Ra.toFixed(4)}|${aL.toFixed(3)}|${aR.toFixed(3)}`, () => new T.TorusGeometry(Ra + 0.0012 * s, 0.0016 * s, 6, 28, aL - aR).rotateZ(aR))
		for (const sz of [1, -1]) {
			g.add(put(skirtGeo, paint, 0, 0, sz * (hz - 0.0016 * s)))
			const fl = put(flareGeo, dark(), ax, cyL, sz * (hz - 0.0016 * s))
			g.add(fl)
		}
		// the dark liner above the wheel: a half-tube inside the arch
		const liner = kit.geo(`veh|truckliner|${r.toFixed(4)}|${aL.toFixed(3)}`, () => {
			const sh = new T.Shape()
			sh.absarc(0, 0, Ra, aR, aL, false)
			sh.absarc(0, 0, Ra - 0.002, aL, aR, true)
			const geo = new T.ExtrudeGeometry(sh, { depth: 0.032 * s, bevelEnabled: false, curveSegments: 20 })
			geo.translate(0, 0, -0.016 * s)
			return geo
		})
		for (const sz of [1, -1]) g.add(put(liner, dark(), ax, cyL, sz * (hz - 0.019 * s)))
		// ---- the front: the slab's nose is one slice of the same yellow face as the cab above it and the apron below it (the same plan ends: the corners line up, and no rounding
		// at the seams); the bumper is on the apron. The tail: a bar, lamps, a plate.
		const chrome = M.chrome(SPEC.chrome)
		const noseOutline = [[x1 - NOSE_LEN * s, yB], [x1, yB], [x1, yT], [x1 - NOSE_LEN * s, yT]]
		g.add(put(lf.bodyLoft(noseOutline, { hw: hz, ends: { front: noseEnds(s) }, tumbleDeg: 0, crown: 0, rt: 0, rb: 0, key: `trucknose|${yellow}|${x1.toFixed(4)}|${t.toFixed(4)}|${hz.toFixed(4)}`, fine: 0.4 }), [paint, mat("truck-cab-under", { color: "#1a1b1e", roughness: 0.6, metalness: 0.3 })]))
		// the cab's mounting gap: a dark rubber band round the top of the nose slice (it hides the seam where the cab's face, leaning back 4.7 degrees, meets the slice's upright one), and a lower air intake in the slice
		const noseProf = lf.profileOf(noseOutline, { hw: hz, ends: { front: noseEnds(s) } })
		g.add(put(lf.bumperBand(noseProf, hz, 1, { tall: 0.0032 * s, thick: 0.0012 * s, y0: yT - 0.0027 * s, wrap: 0.006 * s, key: `trucknosegap|${x1.toFixed(4)}|${t.toFixed(4)}|${hz.toFixed(4)}` }), dark()))
		g.add(onFace(pt.grille(0.058 * s, 0.015 * s, { n: 3, key: "truck-low" }), x1, (yT + yB) / 2 - 0.0012 * s, 0, 1, 0, -0.0002))
		g.add(box(0.0072 * s, 0.0085 * s, 2 * (hz - 0.012 * s), x0 + 0.0036 * s, yB + 0.00425 * s, 0, chrome, 0.0015)) // the tail bar stands on the slab's underside
		for (const sz of [1, -1]) {
			const tl = pt.taillamp(0.021 * s, 0.0105 * s, { key: "truck", split: [0.5, 0.3, 0.2] })
			tl.rotation.y = -Math.PI / 2
			tl.position.set(x0 + 0.0004, yB + 0.0182 * s + 0.0001, sz * (hz - 0.019 * s))
			g.add(tl)
		}
		g.add(put(quadGeo(0.032 * s, 0.0105 * s), decalMat(`truckplate|${s.toFixed(3)}`, 0.032 * s, 0.0105 * s, 9000, (c, W, H) => {
			c.fillStyle = "#f2d24b"
			c.fillRect(0, 0, W, H)
			c.strokeStyle = "rgba(0,0,0,0.55)"
			c.lineWidth = 2
			c.strokeRect(1, 1, W - 2, H - 2)
			c.fillStyle = "#101216"
			c.font = `800 ${H * 0.55}px ui-sans-serif, Helvetica, Arial, sans-serif`
			c.textAlign = "center"
			c.textBaseline = "middle"
			c.fillText("TRUCK 25", W / 2, H / 2 + H * 0.03)
		}, { roughness: 0.4 }), x0 - 0.0001 + 0.0001, yB + 0.0182 * s + 0.0001, 0, [0, -Math.PI / 2, 0], { cast: false }))
		return g
	}

	// ----------------------------------------------------------------- the cab: a lofted lower body and a greenhouse
	function cab(ctx) {
		const R = rig(ctx)
		const { s } = R
		const pts = pts2(ctx)
		const b = bounds(pts)
		const H = b.y1 - b.y0
		const hz = ctx.d / 2
		const yellow = yellowOf(ctx)
		const paint = M.paint(yellow, 0)
		const g = kit.group()
		const yW = b.y0 + 0.5 * H // the waist: the windshield's and the windows' sill
		const lowerPts = clipPoly(pts, 0, 1, yW)
		const upperPts = clipPoly(pts, 0, -1, -yW)
		const lowerR = roundPoly(lowerPts, { dev: 0.0009, maxR: 0.0006 }) // crisp corners: the foot stands on the slab's nose slice, the waist carries the greenhouse
		const ends = { front: noseEnds(s), rear: { len: 0.03 * s, taper: 0.003 * s, R: 0.012 * s } }
		const key = `truckcab|${yellow}|${JSON.stringify(pts)}|${hz.toFixed(4)}`
		const o = { hw: hz, ends, tumbleDeg: 0, crown: 0.0006 * s, rt: 0.0035 * s, rb: 0, key, capGroup: 0, fine: 0.55 } // rb 0: the cab's foot stands on the slab's nose slice with no crease
		const prof = lf.profileOf(lowerR, o)
		g.add(put(lf.bodyLoft(lowerR, o), [paint, mat("truck-cab-under", { color: "#1a1b1e", roughness: 0.6, metalness: 0.3 })]))
		// ---- the greenhouse above the waist
		const intDark = mat("truck-int", { color: "#6d6a63", roughness: 0.85 })
		const gh = glasshouse({
			pts: upperPts, hz, s, paint, roofDark: mat("truck-ceiling", { color: "#a09886", roughness: 0.85 }), key: key + "|gh", phiDeg: 3, th: 0.004 * s, tRoof: 0.0045 * s,
			off: (E) => (E.ny < -0.9 ? 0.0042 * s : E.ny > 0.9 ? 0.0062 * s : E.nx > 0 ? 0.0074 * s : 0.0092 * s),
			frontPane: "longest", front: { sBot: 0.005 * s, sTop: 0.0015 * s }, rear: { sBot: 0.007 * s, sTop: 0.0092 * s }, winR: 0.0042 * s,
			roofEnds: { front: { len: 0.016 * s, taper: 0.001 * s, R: 0.008 * s }, rear: { len: 0.016 * s, taper: 0.001 * s, R: 0.008 * s } }, roofCrown: 0.0012 * s,
		})
		g.add(gh.group)
		// ---- the interior: floor, two seats, a dashboard and a big steering wheel
		const xr = Math.min(...upperPts.map((p) => p[0]))
		const xf = Math.max(...upperPts.map((p) => p[0]))
		const zi = hz - gh.th - 0.001
		g.add(put(kit.box(xf - xr - 0.01 * s, 0.0008, 2 * zi, 0.0002, 1), intDark, (xr + xf) / 2, yW + 0.0003, 0))
		const xs = xr + 0.3 * (xf - xr)
		for (const sz of [1, -1]) {
			const sm = pt.seat(0.048 * s, 0.032 * s, { depth: 0.04 * s, color: "#52555c" })
			sm.position.set(xs, yW + 0.0006, sz * 0.043 * s)
			g.add(sm)
		}
		// the cab's back wall: a dark panel behind the seats, up to the headliner (the rear window and the cab guard are on its far side)
		const yTop = b.y1 - 0.0085 * s
		g.add(put(kit.box(0.003 * s, yTop - yW, 2 * zi, 0.0005, 1), intDark, xr + 0.008 * s, (yW + yTop) / 2, 0))
		const dashX = xf - 0.024 * s
		g.add(put(kit.box(0.018 * s, 0.014 * s, 2 * zi * 0.97, 0.004, 1), pt.fabric("#3a3c41"), dashX, yW + 0.007 * s + 0.0006, 0))
		const sw = pt.steering(0.0125 * s)
		sw.position.set(dashX - 0.028 * s, yW + 0.0255 * s, 0.043 * s)
		sw.rotation.z = 0
		g.add(sw)
		// ---- the front face: grille, lamps, indicators; wipers on the glass
		const nE = lowerR.sharp.length
		const sharp = lowerR.sharp
		let fe = null
		for (let e = 0; e < nE; e++) {
			const p = sharp[e]
			const q = sharp[(e + 1) % nE]
			const dx = q[0] - p[0]
			const dy = q[1] - p[1]
			const len = Math.hypot(dx, dy)
			const nx = dy / len
			if (nx > 0.9 && (!fe || len > fe.len)) fe = { p, q, len, nx, ny: -dx / len, tx: dx / len, ty: dy / len }
		}
		const wFront = prof.W(prof.x1)
		if (fe) {
			// the face runs from its lower end p up to q (tx, ty); distance sd along it
			const at = (sd) => [fe.p[0] + fe.tx * sd, fe.p[1] + fe.ty * sd]
			const lampR = 0.0105 * s
			const lampZ = Math.min(wFront - lampR - 0.0045 * s, 0.073 * s)
			for (const sz of [1, -1]) {
				const lamp = pt.headlamp(lampR, { tint: "#fff1c8", key: "truck" })
				const [lx, ly] = at(0.0225 * s)
				onFace(lamp, lx, ly, sz * lampZ, fe.nx, fe.ny, -0.0019 * s)
				g.add(lamp)
				const ind = new T.Mesh(kit.box(0.0085 * s, 0.012 * s, 0.0016, 0.0006, 1), M.lamp("#ff9d12", 0.22))
				const [ix, iy] = at(0.0225 * s)
				onFace(ind, ix, iy, sz * (lampZ - lampR - 0.0095 * s), fe.nx, fe.ny, 0)
				g.add(ind)
			}
			const gw = 2 * (lampZ - lampR - 0.021 * s)
			const gr = pt.grille(Math.min(gw, 0.078 * s), 0.036 * s, { n: 7, key: "truck" })
			const [gx, gy] = at(0.0225 * s)
			onFace(gr, gx, gy, 0, fe.nx, fe.ny, -0.0002)
			g.add(gr)
			// a badge between the grille's top and the glass
			// wipers: two dark arms on the glass, parked along its foot
			const wsE = gh.edges.find((E) => E.nx > 0.9)
			if (wsE) {
				for (const sz of [-1, 1]) {
					const wip = new T.Mesh(kit.box(0.0011, 0.034 * s, 0.0008, 0.0003, 1), mat("wiper", { color: "#0b0b0c", roughness: 0.5 }))
					onFace(wip, wsE.p[0] + wsE.tx * 0.012 * s, wsE.p[1] + wsE.ty * 0.012 * s, sz * 0.045 * s, wsE.nx, wsE.ny, 0.0007)
					wip.rotateZ(sz * 0.55 + 1.2)
					g.add(wip)
				}
			}
		}
		// ---- the side: door shut lines, handle, step, the number; mirrors on stalks at the front corners; roof marker lamps; the cab's back
		const sx = ctx.d / 2
		const flatPoly = (() => {
			const n2 = sharp.length
			const offs = sharp.map((p, e) => {
				const q = sharp[(e + 1) % n2]
				const [dx] = norm2(q[0] - p[0], q[1] - p[1])
				const ny = -dx
				return ny < -0.5 ? o.rb : ny > 0.5 ? o.rt : 0.002
			})
			let c = offsetPoly(sharp, offs)
			c = clipPoly(c, 1, 0, prof.x1 - ends.front.len)
			return clipPoly(c, -1, 0, -(prof.x0 + ends.rear.len))
		})()
		const bw = prof.x1 - prof.x0
		const bh = yW - b.y0
		const pxm = 4500
		const doorF = prof.x1 - 0.034 * s
		const doorR = prof.x0 + 0.025 * s
		if (flatPoly.length >= 3) sideDecals(g, decalPoly(flatPoly, prof.x0, b.y0, bw, bh), sx + 0.0002, `truckdoor2|${key}`, bw, bh, pxm, (c, W, Hh, flip) => {
			const X = (x) => (x - prof.x0) * pxm
			const Y = (y) => (yW - y) * pxm
			c.strokeStyle = "rgba(20,16,4,0.88)"
			c.lineWidth = 0.0006 * pxm
			c.beginPath()
			c.moveTo(X(doorF), Y(yW))
			c.lineTo(X(doorF), Y(b.y0 + 0.0052 * s))
			c.lineTo(X(doorR), Y(b.y0 + 0.0052 * s))
			c.lineTo(X(doorR), Y(yW))
			c.stroke()
			// the handle: a chrome bar high on the door's rear edge
			c.fillStyle = "rgba(226,229,235,0.97)"
			c.fillRect(X(doorR + 0.007 * s), Y(yW - 0.007 * s), 0.014 * s * pxm, 0.0026 * s * pxm)
			c.fillStyle = "rgba(0,0,0,0.4)"
			c.fillRect(X(doorR + 0.007 * s), Y(yW - 0.007 * s) + 0.0026 * s * pxm, 0.014 * s * pxm, 0.0005 * pxm)
			// the step: a dark well with two steel treads at the foot of the door
			c.fillStyle = "rgba(14,14,16,0.92)"
			c.fillRect(X(doorR + 0.002 * s), Y(b.y0 + 0.0125 * s), (doorF - doorR - 0.004 * s) * pxm, 0.009 * s * pxm)
			c.fillStyle = "rgba(170,176,184,0.95)"
			c.fillRect(X(doorR + 0.004 * s), Y(b.y0 + 0.0112 * s), (doorF - doorR - 0.008 * s) * pxm, 0.0018 * s * pxm)
			c.fillRect(X(doorR + 0.004 * s), Y(b.y0 + 0.0062 * s), (doorF - doorR - 0.008 * s) * pxm, 0.0018 * s * pxm)
			// a roundel with the number
			const cx = X((doorF + doorR) / 2)
			const cy = Y(b.y0 + 0.032 * s)
			c.fillStyle = "#f4f6f8"
			c.beginPath()
			c.arc(cx, cy, 0.0105 * s * pxm, 0, TAU)
			c.fill()
			c.fillStyle = "#14161a"
			c.font = `800 ${0.0125 * s * pxm}px ui-sans-serif, Helvetica, Arial, sans-serif`
			c.textAlign = "center"
			c.textBaseline = "middle"
			flipText(c, "25", cx, cy + 0.0004 * pxm, flip)
		}, { roughness: 0.45, clearcoat: 0.6 })
		// mirrors: a black housing on two stalks off the A-pillar, within the cab's width
		const mxs = prof.x1 - 0.012 * s
		for (const sz of [1, -1]) {
			const mz = sz * (hz - 0.0075 * s)
			g.add(put(kit.box(0.0035 * s, 0.0026 * s, 0.006 * s, 0.0009, 1), M.steel("#2a2c31", 0.5), mxs + 0.0005 * s, yW + 0.0185 * s, mz - sz * 0.004 * s))
			g.add(put(kit.box(0.0035 * s, 0.0026 * s, 0.006 * s, 0.0009, 1), M.steel("#2a2c31", 0.5), mxs + 0.0005 * s, yW + 0.0052 * s, mz - sz * 0.004 * s))
			g.add(put(kit.box(0.0085 * s, 0.0215 * s, 0.0036 * s, 0.0016, 1), M.plastic("#18191c", 0.45), mxs - 0.0014 * s, yW + 0.0118 * s, mz + sz * 0.0006))
			g.add(put(kit.box(0.0004, 0.0188 * s, 0.003 * s, 0.0001, 1), M.chrome("#aeb8c2"), mxs - 0.0057 * s, yW + 0.0118 * s, mz + sz * 0.0006))
		}
		// roof marker lamps
		const topPts = upperPts.filter((p) => Math.abs(p[1] - b.y1) < 1e-4)
		const roofFront = Math.max(...topPts.map((p) => p[0]))
		for (const sz of [-1, 0, 1]) g.add(put(kit.box(0.0075 * s, 0.0017 * s, 0.013 * s, 0.0007, 1), M.lamp("#ff9d12", 0.22), roofFront - 0.012 * s, b.y1 + 0.0004, sz * 0.032 * s))
		// ---- the cab's back: a cab guard (a flat frame of steel tubes) over the rear window, <2 mm proud of the back
		let rearP = null
		for (let e = 0; e < pts.length; e++) {
			const p = pts[e]
			const q = pts[(e + 1) % pts.length]
			if (p[0] < q[0] - 1e-6 || Math.abs(p[0] - q[0]) > 0.02 * s || p[1] < q[1]) continue
			if (!rearP || Math.min(p[0], q[0]) < Math.min(rearP[0][0], rearP[1][0])) rearP = [p, q]
		}
		const xBack = (y) => {
			if (!rearP) return prof.x0
			const [p, q] = rearP
			return p[0] + ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1] || 1)
		}
		const tubeM = M.steel("#2c2e33", 0.4)
		const yG0 = yW + 0.004 * s
		const yG1 = b.y1 - 0.0145 * s
		for (const yy of [yG0, (yG0 + yG1) / 2, yG1]) g.add(put(kit.cylinderZ(0.0009 * s, 2 * (hz - 0.016 * s), 8), tubeM, xBack(yy) + 0.0002, yy, 0))
		for (const zz of [-0.075, -0.025, 0.025, 0.075]) g.add(put(kit.cylinderY(0.0009 * s, yG1 - yG0, 8), tubeM, xBack((yG0 + yG1) / 2) + 0.0002, (yG0 + yG1) / 2, zz * s))
		// two grab handles low on the back: a chrome bar on two studs, either side of the cab's middle
		for (const zz of [-0.088, 0.088]) {
			const yh0 = b.y0 + 0.012 * s
			const yh1 = yW - 0.012 * s
			g.add(put(kit.cylinderY(0.0012 * s, yh1 - yh0, 10), M.chrome("#dfe2e7"), xBack((yh0 + yh1) / 2) + 0.0003, (yh0 + yh1) / 2, zz * s))
			for (const yy of [yh0, yh1]) g.add(put(kit.cylinderZ(0.0013 * s, 0.002, 8), M.chrome("#dfe2e7"), xBack(yy) - 0.0001, yy, zz * s, [0, Math.PI / 2, 0]))
		}
		return g
	}

	// ----------------------------------------------------------------- the lower front of the cab: the apron ahead of the wheel and the step behind it
	function lowerBlock(ctx, kind) {
		const R = rig(ctx)
		const { s } = R
		const pts = pts2(ctx)
		const b = bounds(pts)
		const hz = ctx.d / 2
		const g = kit.group()
		const yellow = yellowOf(ctx)
		const paint = M.paint(yellow, 0)
		// the apron's face stands 1 mm behind the outline (x = L/2) and the bumper 1 mm proud of it: the bumper's face is the one that sits on the outline, and the small step up to the nose slice
		// reads as a tucked-in valance. The step block is 1.2 mm narrower than the cab (z), so its treads stay inside the depth
		const rec = kind === "apron" ? 0.001 * s : 0
		const hwB = kind === "apron" ? hz : hz - 0.0012 * s
		const loftPts = kind === "apron" ? clipPoly(pts, 1, 0, b.x1 - rec) : pts
		const rounded = roundPoly(loftPts, { dev: 0.0009, maxR: 0.0006 }) // crisp corners: the top stands against the slab's nose slice
		const ends = kind === "apron" ? { front: noseEnds(s) } : { rear: { len: 0.02 * s, taper: 0.002 * s, R: 0.008 * s } }
		const key = `truck${kind}|${yellow}|${JSON.stringify(pts)}|${rec.toFixed(4)}`
		const o = { hw: hwB, ends, tumbleDeg: 0, crown: 0, rt: 0, rb: 0.004 * s, key, fine: 0.5 } // rt 0: the top stands against the slab's nose slice with no crease
		g.add(put(lf.bodyLoft(rounded, o), [paint, mat("truck-cab-under", { color: "#1a1b1e", roughness: 0.6, metalness: 0.3 })]))
		const prof = lf.profileOf(rounded, o)
		const nb = bounds(pts)
		const px = 4500
		const sharp = rounded.sharp
		const offs = sharp.map(() => 0.003)
		let c0 = offsetPoly(sharp, offs)
		if (kind === "apron") c0 = clipPoly(c0, 1, 0, prof.x1 - ends.front.len)
		else c0 = clipPoly(c0, -1, 0, -(prof.x0 + ends.rear.len))
		if (c0.length >= 3) sideDecals(g, decalPoly(c0, nb.x0, nb.y0, nb.x1 - nb.x0, nb.y1 - nb.y0), hwB + 0.0002, `trucklow2|${key}`, nb.x1 - nb.x0, nb.y1 - nb.y0, px, (c, W, Hh) => {
			const Y = (y) => (nb.y1 - y) * px
			c.fillStyle = "rgba(14,14,16,0.9)"
			c.fillRect(0, Y(nb.y0 + 0.008 * s), W, 0.005 * s * px) // a black rubber strip along the foot
		}, { roughness: 0.45, clearcoat: 0.6 })
		if (kind === "apron") {
			// the bumper: a chunky chrome bar round the foot of the front face (it wraps the corners like the plan does), its face on the outline, and the number plate above it.
			// The cab's one grille and pair of lamps are above (the slice's lower intake too).
			g.add(put(lf.bumperBand(prof, hz, 1, { tall: 0.013 * s, thick: rec + 0.001 * s, y0: nb.y0 + 0.0065 * s, wrap: 0.006 * s, key: key + "|bumper" }), M.chrome(SPEC.chrome)))
			g.add(put(quadGeo(0.032 * s, 0.0105 * s), decalMat(`truckplate|${s.toFixed(3)}`, 0.032 * s, 0.0105 * s, 9000, (c, W, H) => {
				c.fillStyle = "#f2d24b"
				c.fillRect(0, 0, W, H)
				c.strokeStyle = "rgba(0,0,0,0.55)"
				c.lineWidth = 2
				c.strokeRect(1, 1, W - 2, H - 2)
				c.fillStyle = "#101216"
				c.font = `800 ${H * 0.55}px ui-sans-serif, Helvetica, Arial, sans-serif`
				c.textAlign = "center"
				c.textBaseline = "middle"
				c.fillText("TRUCK 25", W / 2, H / 2 + H * 0.03)
			}, { roughness: 0.4 }), prof.x1 + 0.0001, nb.y0 + 0.0295 * s, 0, [0, Math.PI / 2, 0], { cast: false }))
		} else {
			// two step treads cut into the outer face: a dark pocket with a steel tread plate and its ribs, a hair proud of the side (inside the outline's tolerance)
			const pocketM = mat("truck-pocket", { color: "#0b0c0e", roughness: 0.65, metalness: 0.3 })
			const tread = M.steel("#9aa0a8", 0.35)
			const xm = (prof.x0 + prof.x1) / 2 + 0.002 * s
			const pw = Math.min(0.018 * s, prof.x1 - prof.x0 - 0.01 * s)
			const zAt = prof.W(xm)
			for (const sz of [1, -1]) {
				for (const f of [0.34, 0.7]) {
					const yy = nb.y0 + f * (nb.y1 - nb.y0)
					g.add(put(pbox(pw, 0.0085 * s, 0.0006), pocketM, xm, yy, sz * (zAt + 0.0003)))
					g.add(put(pbox(pw - 0.0016 * s, 0.0028 * s, 0.0008), tread, xm, yy - 0.0022 * s, sz * (zAt + 0.0005)))
					for (let k = 0; k < 4; k++) g.add(put(pbox(0.0008, 0.0012 * s, 0.001), tread, xm - pw / 2 + (pw * (k + 1)) / 5, yy + 0.0018 * s, sz * (zAt + 0.0006)))
				}
			}
		}
		return g
	}

	// ----------------------------------------------------------------- wheels: big lugged tyres on red steel wheels
	const WKIND = { "solid rubber": "rubber", "hollow plastic": "plastic", "varnished hardwood": "wood" }
	function wheelPair(ctx) {
		const R = ctx.r
		const k = R / 0.05
		const w = 0.56 * R
		const zc = ctx.d / 2 - w / 2
		const g = kit.group()
		const rimR = 0.69 * R
		const ty = wk.tyre({ R, rimR, w, c: 0.4 * (R - rimR), blocks: 22, tread: "lug", key: "truck", color: "#151617", rough: 0.9, normalScale: 1.6, segments: 40 })
		const red = mat("truck-rim", { color: "#b6231b", roughness: 0.38, metalness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.25 })
		const darkM = mat("truck-rimbase", { color: "#1c1d20", roughness: 0.6, metalness: 0.6 })
		const star = wk.starPlate({ Ro: rimR - 0.0012 * k, r0: 0.5 * R, r1: 0.62 * R, n: 8, hw0: 0.0075 * k, hw1: 0.0065 * k, depth: 0.0034 * k, round: 0.0028 * k, stepDeg: 30, dev: 0.0012 * k, key: "truck" })
		const hub = kit.geo(`truckhub|${R.toFixed(5)}`, () => new T.SphereGeometry(0.2 * R, 20, 6, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2))
		const nut = kit.geo(`trucknut|${R.toFixed(5)}`, () => new T.CylinderGeometry(0.0034 * k, 0.0034 * k, 0.0014 * k, 6).rotateX(Math.PI / 2))
		const zd = w / 2 - 0.0058 * k // the dark drum's face; the red wheel disc stands on it
		const wheel = () => {
			const wg = kit.group()
			wg.add(put(ty.geo, ty.mat))
			wg.add(put(kit.cylinderZ(rimR - 0.0008 * k, 0.012 * k, 24), darkM, 0, 0, zd - 0.006 * k))
			wg.add(put(kit.torus(rimR - 0.001 * k, 0.0024 * k, 5, 32), red, 0, 0, w / 2 - 0.0022 * k))
			wg.add(put(star, red, 0, 0, zd + 0.0011 * k))
			// the inner side closed with the same steel disc, dished the same way (the wheel is seen from under the truck and past the axle: an open drum read as an empty tyre)
			wg.add(put(kit.cylinderZ(rimR - 0.0008 * k, 0.012 * k, 24), darkM, 0, 0, -(zd - 0.006 * k)))
			wg.add(put(kit.torus(rimR - 0.001 * k, 0.0024 * k, 4, 24), red, 0, 0, -(w / 2 - 0.0022 * k)))
			wg.add(put(kit.cylinderZ(rimR - 0.0016 * k, 0.0034 * k, 28), red, 0, 0, -(zd + 0.0017 * k))) // a plain dished disc: no vent holes on the side nobody sees head-on
			wg.add(put(kit.torus(0.355 * R, 0.0036 * k, 4, 20), red, 0, 0, -(zd + 0.0034 * k)))
			wg.add(put(kit.torus(0.355 * R, 0.0036 * k, 5, 28), red, 0, 0, zd + 0.0017 * k))
			const dome = put(hub, M.chrome("#dfe2e7"), 0, 0, zd + 0.0024 * k)
			dome.scale.set(1, 1, 0.3)
			wg.add(dome)
			for (let i = 0; i < 8; i++) {
				const a2 = (i / 8) * TAU
				wg.add(put(nut, M.chrome("#eef0f3"), 0.255 * R * Math.cos(a2), 0.255 * R * Math.sin(a2), zd + 0.0028 * k + 0.0007 * k))
			}
			return wg
		}
		const kind = WKIND[ctx.props.material]
		const wheelOf = kind ? () => tw.turnedWheel(kind, R, w, { bore: 0.0085 * k + 0.0001, key: "truck", color: ctx.solid.color ?? undefined, blocks: kind === "rubber" ? 22 : 0 }) : wheel
		const right = wheelOf()
		right.position.z = zc
		const left = wheelOf()
		left.rotation.y = Math.PI
		left.position.z = -zc
		g.add(right, left)
		g.add(put(kit.cylinderZ(0.0085 * k, kind ? 2 * zc + w - 0.0004 : 2 * zc - w + 0.004, 18), M.steel("#8e949b")))
		return g
	}

	addModel("truck", "chassis", chassis)
	addModel("truck", "cabin", cab)
	addModel("truck", "apron", (ctx) => lowerBlock(ctx, "apron"))
	addModel("truck", "step", (ctx) => lowerBlock(ctx, "step"))
	addModel("truck", "front", wheelPair)
	addModel("truck", "rear", wheelPair)
}
