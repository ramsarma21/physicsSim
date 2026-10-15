// 3D models for the rods catalog group (see web/models3d.js for the frame and the kit; helpers in surfaces-lib.js).
// Items: wooden-rod, steel-rod, pendulum, seesaw, lever, hinged-gate, newtons-cradle, fan.
// Every model fills its physics outline (side view, x-y plane) to within a millimetre or two; small hardware (pins, washers, screw heads,
// the cheeks of a pivot fork) may stand out of it a little, and the z extent stays inside the part's depth.
import { makeLib } from "./surfaces-lib.js"

export default function register({ addModel, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const { T, TAU, M, V2, clamp, sstep, f5, bake, withRepeat, rbox, faces, mesh, put, decalPlane, board, upright } = L
	const group = (...c) => kit.group(...c)
	const PI2 = Math.PI / 2

	// ------------------------------------------------------------- small hardware
	/** A cylinder along z (a pin, a washer) centred at (x, y, z). */
	const pinZ = (r, len, mat, x = 0, y = 0, z = 0, seg = 24) => put(mesh(kit.cylinderZ(r, len, seg), mat), x, y, z)
	/** A hexagon-headed bolt standing on +z (head toward the camera): head across-flats 2 * ra, height hh. */
	const hexHead = (ra, hh, mat, x, y, z) => put(mesh(kit.geo(`hex|${f5(ra)}|${f5(hh)}`, () => new T.CylinderGeometry(ra / Math.cos(Math.PI / 6), ra / Math.cos(Math.PI / 6), hh, 6).rotateX(PI2)), mat), x, y, z)
	/** An extruded outline (x-y points, counter-clockwise), z-thickness t, centred on zc. */
	const plate = (key, pts, t, mat, zc = 0, bevel = 0.0002) => put(mesh(L.extrudeXY(key, pts, t, { bevel }), mat), 0, 0, zc)
	/** The outline of a plate with a half-round top: width w, from yb to yt. */
	function roundTop(w, yb, yt, n = 10) {
		const r = w / 2, cy = yt - r
		const pts = [[-r, yb], [r, yb]]
		for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push([r * Math.cos(a), cy + r * Math.sin(a)]) }
		return pts
	}
	/** The outline of a plate with a half-round bottom: width w, from yb up to yt (the hanging cheek of a clevis). */
	function roundBottom(w, yb, yt, n = 10) {
		const r = w / 2, cy = yb + r
		const pts = [[-r, yt]]
		for (let i = 0; i <= n; i++) { const a = Math.PI + (i / n) * Math.PI; pts.push([r * Math.cos(a), cy + r * Math.sin(a)]) }
		pts.push([r, yt])
		return pts
	}
	/** A domed head of radius r and height hh, its base at (x, y, z) and its dome toward the unit vector dir. */
	function domeAt(r, hh, mat, x, y, z, dir = [0, 0, 1]) {
		const m = mesh(kit.geo(`dome|${f5(r)}|${f5(hh)}`, () => new T.SphereGeometry(r, 16, 8, 0, TAU, 0, PI2).scale(1, hh / r, 1).rotateX(PI2)), mat)
		m.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(...dir).normalize())
		m.position.set(x, y, z)
		return m
	}

	// ------------------------------------------------------------- round bars: the wooden dowel and the steel rod
	/** A round bar along x of radius r and length len, chamfered at both ends, its end faces drawn flat. */
	function roundBar(ctx, { r, len, mat, endMat, wood = false, chamfer = 0.0005, key, off = [0, 0] }) {
		const c = Math.min(chamfer, r * 0.2)
		const pts = [[r - c, -len / 2], [r, -len / 2 + c], [r, len / 2 - c], [r - c, len / 2]]
		const geo = L.lathe(`bar|${key}|${f5(r)}|${f5(len)}`, pts, { axis: "x", seg: Math.max(32, Math.min(64, Math.round(r * 8000))), tile: wood ? [1.0, 0.125] : 0.25, swap: true, crease: 0.6, off, seamless: true })
		const parts = [mesh(geo, mat)]
		for (const s of [-1, 1]) {
			const disc = new T.Mesh(kit.geo(`barend|${f5(r - c)}`, () => new T.CircleGeometry(r - c, 36)), endMat)
			disc.rotation.y = s * PI2
			disc.position.x = s * (len / 2)
			disc.castShadow = false
			disc.receiveShadow = true
			parts.push(disc)
		}
		return group(...parts)
	}
	addModel("wooden-rod", "rod", (ctx) => {
		const { w: len, h: t } = ctx
		const r = t / 2
		const look = ctx.solid.look ?? ""
		if (!/wood/.test(look)) {
			const sk = L.skin(ctx)
			return roundBar(ctx, { r, len, mat: sk.side, endMat: sk.end, key: look })
		}
		const sk = L.woodSet(ctx.color, 3, { straight: true, varnish: 0, rough: 0.5 }) // raw, sanded dowel: straight grain, no varnish at all
		// the cut end: the pith lies well outside the section (1.5 diameters off), so the end shows near-parallel arcs 2 mm apart, as a dowel's does
		const D = 2 * r
		const em = L.bake(`dowelend3|${D.toFixed(4)}`, 256, 256, (u, v, o) => {
			const x = (u - 0.5) * D, y = (v - 0.5) * D // metres from the centre of the cut
			const rho = Math.hypot(x + 1.5 * D * 0.92, y - 1.5 * D * 0.4) // the pith: 1.5 diameters away, down-left
			const rr = rho / 0.002 + 0.6 * (L.pfbm(u, v, 3, 3, 401, 3) - 0.5)
			const f = rr - Math.floor(rr)
			const late = (0.5 * f * f + 0.5 * L.sstep(0.62, 0.95, f)) * (1 - L.sstep(0.9, 1, f))
			const pore = L.pn(u, v, 90, 90, 402) - 0.5
			const k = 0.82 - 0.2 * late + 0.08 * pore
			o.r = L.clamp(255 * k, 0, 255); o.g = L.clamp(255 * k, 0, 255); o.b = L.clamp(255 * k * 0.96, 0, 255)
			o.h = 0.5 + 0.3 * pore + 0.1 * late
			o.rough = 0.8
		}, { normal: 1.0, wrap: false, blur: 1 })
		const endMat = M(`dowel-end3|${ctx.color}|${D.toFixed(4)}`, { color: ctx.color, map: em.map, normalMap: em.normalMap, normalScale: V2(0.5), roughness: 0.8, metalness: 0 })
		return roundBar(ctx, { r, len, mat: sk.side, endMat, wood: true, key: "wood", off: [0.3, 0.5 - (Math.PI * r) / 0.125] })
	})
	addModel("steel-rod", "rod", (ctx) => {
		const { w: len, h: t } = ctx
		const r = t / 2
		const look = ctx.solid.look ?? ""
		if (look === "steel") {
			const bar = L.brushedMetal("drawn", "#cfd4da", 0.2)
			return roundBar(ctx, { r, len, mat: bar, endMat: L.stainless(), key: "steel" })
		}
		const sk = L.skin(ctx)
		return roundBar(ctx, { r, len, mat: sk.side, endMat: sk.end, key: look })
	})

	// ------------------------------------------------------------- a wooden hanger bracket: bar, wall plate behind, screws
	/** The hanger's wooden bar (4 cm or the gate's depth deep), a plywood wall plate behind it and two screws in its top. Returns {parts, bd} (bd = the bar's depth). */
	function hangerWood(ctx) {
		const { w, h } = ctx
		const bd = ctx.d - 0.03
		const parts = [board(ctx, { r: Math.min(0.0014, h * 0.2), seed: 6, d: bd })]
		for (const sx of [-1, 1]) parts.push(put(mesh(kit.cylinderY(Math.min(0.0034, bd * 0.1), 0.0006, 20), L.brass(), { cast: false }), sx * w * 0.36, h / 2 - 0.0002, 0))
		// the mount: a patch of plywood on the wall, the bar screwed to it through its back face
		const pw = 0.1, ph = 0.1
		const plate = L.plyBoard(pw, ph, 0.012, { r: 0.0012 })
		plate.position.set(0, h / 2 - 0.03, -bd / 2 - 0.006)
		parts.push(plate)
		for (const sx of [-1, 1]) parts.push(put(mesh(kit.cylinderZ(0.0032, 0.0014, 16), L.brass()), sx * 0.034, h / 2 - 0.0035, -bd / 2 + 0.0007))
		return { parts, bd }
	}
	/** catalog_items.py `_hang`: the high bar's middle over the hinge (the swing's reach + 16 mm: its underside 1 cm over it), to 5 decimals as the builder rounds it. */
	const highBarY = (reach) => Math.round((reach + 0.016) * 1e5) / 1e5
	/**
	 * The high hanger (catalog_items.py `_hang`, part "hanger-high": the bar over the swing's reach, for a swing that goes past level): the wooden bar on its
	 * wall plate (hangerWood), a hardwood batten (bw wide, 15 mm thick) screwed to the plate and hanging from the bar's underside down BEHIND the swing to 16 mm
	 * under the hinge (its back on the plate, its front 6 mm behind the swing's back: nothing that swings can reach it), and a steel flange bearing on its front
	 * at the hinge. H = the bar's middle over the hinge. Returns {parts, zf}: zf = the flange's front face (3 mm behind the swing).
	 */
	function highHanger(ctx, H, bw, st) {
		const { h } = ctx
		const { parts, bd } = hangerWood(ctx)
		const bt = 0.015
		const zb = -bd / 2 + bt / 2
		const yTop = -h / 2 + 0.0004, yBot = -H - 0.016
		const bat = upright(ctx, { r: 0.0012, seed: 6, vary: 3, w: bw, h: yTop - yBot, d: bt }) // (the bar's wood: one bake)
		bat.position.set(0, (yTop + yBot) / 2, zb)
		parts.push(bat)
		const zf0 = zb + bt / 2 // the batten's front face
		// two brass screws through the batten into the wall plate (it reaches 74 mm under the bar's top), where the batten is long enough for them
		for (const y of [-h / 2 - 0.014, -h / 2 - 0.05]) if (y > -H + 0.02) parts.push(put(mesh(kit.cylinderZ(0.0032, 0.0012, 16), L.brass()), 0, y, zf0 + 0.0005))
		// the bearing: a turned flange (st) with four screws, a boss in its middle round the pin
		const fr = Math.min(0.0115, bw / 2 - 0.0005) // (inside the batten's width)
		parts.push(pinZ(fr, 0.002, st, 0, -H, zf0 + 0.001, 32))
		parts.push(pinZ(0.0055, 0.001, st, 0, -H, zf0 + 0.0025, 28))
		for (let k = 0; k < 4; k++) {
			const a = Math.PI / 4 + (k * Math.PI) / 2
			parts.push(domeAt(0.0013, 0.0006, L.darkSteel(), 0.74 * fr * Math.cos(a), -H + 0.74 * fr * Math.sin(a), zf0 + 0.002, [0, 0, 1]))
		}
		return { parts, zf: zf0 + 0.003 }
	}

	// ------------------------------------------------------------- pendulum: a light wooden rod on a pin held in a clevis, a brass bob
	/** Is the pivot pin drawn by a hanger? catalog_items.py `_hang` always builds one while "Show the hanger" is on (the low bracket, or the high bar where the
	 *  swing, turned with the item, would reach the low one), and each of them draws the pin itself. */
	const pendulumHung = (P) => P.hanger ?? true
	addModel("pendulum", "rod", (ctx) => {
		const look = ctx.solid.look ?? ""
		const len = ctx.h
		const parts = []
		if (/wood/.test(look)) parts.push(upright(ctx, { r: 0.0004, seed: 6 }))
		else if (look === "steel" || look === "aluminium") parts.push(mesh(rbox(ctx.d, len, ctx.w, Math.min(0.0004, ctx.w * 0.2), { seg: 2 }), look === "steel" ? L.brushedMetal("drawn", "#cfd4da", 0.2) : L.aluminium()))
		else parts.push(upright(ctx, { r: 0.0004, seed: 6 }))
		if (!pendulumHung(ctx.props)) {
			// no bracket (none asked for): the pin through the rod's top end on its own
			const py = len / 2 - 0.0011
			parts.push(pinZ(0.0011, ctx.d + 0.0016, L.stainless(), 0, py, 0, 16))
			for (const s of [-1, 1]) parts.push(pinZ(0.0022, 0.0006, L.brass(), 0, py, s * (ctx.d / 2 + 0.0004), 20))
		}
		return group(...parts)
	})
	addModel("pendulum", "bob", (ctx) => {
		const r = ctx.r
		const look = ctx.solid.look ?? ""
		const parts = []
		if (look === "steel") {
			// a polished steel bob: one solid ground sphere (a 50 mm steel ball weighs 0.5 kg: no seam of two halves) and a collar where the rod enters
			const steel = L.M("bob-steel", { color: "#dfe3e8", metalness: 1, roughness: 0.12, envMapIntensity: 1.4 })
			parts.push(mesh(kit.sphere(r, 64, 32), steel))
			const cr = Math.max(0.0028, r * 0.14)
			parts.push(put(mesh(kit.cylinderY(cr, 0.004, 24), steel), 0, r - 0.0012, 0))
			parts.push(put(mesh(kit.cylinderY(cr * 1.2, 0.0006, 24), steel), 0, r + 0.0006, 0))
		} else {
			const sk = L.skin(ctx)
			const mat = look === "aluminium" ? L.aluminium() : sk.side
			parts.push(mesh(kit.sphere(r, 64, 32), mat))
		}
		return group(...parts)
	})
	addModel("pendulum", "hanger", (ctx) => {
		// a wooden bracket on a wall plate, with a clevis (two steel cheeks) hanging from its underside to hold the pivot pin
		const { w, h } = ctx
		const { parts, bd } = hangerWood(ctx)
		const steelM = L.brushedMetal("clevis", "#c9ced4", 0.3)
		const py = -0.012 - 0.0011 // the pin: 1.1 mm under the rod's top end (the pivot is 12 mm under the hanger's middle)
		const rodD = 0.01 // the rod's depth
		const ch = roundBottom(0.012, py - 0.005 - 0.006, -h / 2 + 0.0012)
		for (const s of [-1, 1]) {
			// a cheek 1.5 mm thick on each side of the rod (and its 0.3 mm washer), from the bar's underside to 5 mm under the pin
			const zc = s * (rodD / 2 + 0.0003 + 0.00075)
			parts.push(plate(`cheek|${f5(py)}|${f5(h)}`, ch, 0.0015, steelM, zc, 0.00015))
		}
		parts.push(pinZ(0.0011, rodD + 0.0095, L.stainless(), 0, py, 0, 16))
		for (const s of [-1, 1]) {
			parts.push(pinZ(0.0034, 0.0004, L.brass(), 0, py, s * (rodD / 2 + 0.0003 + 0.00015), 20)) // washers between the rod and the cheeks
			parts.push(domeAt(0.0028, 0.0013, L.stainless(), 0, py, s * (rodD / 2 + 0.0003 + 0.0015 + 0.0006), [0, 0, s])) // a button head on each end of the pin
		}
		return group(...parts)
	})

	addModel("pendulum", "hanger-high", (ctx) => {
		// the high bar (the swing goes past level): its batten down behind the bob to a bearing at the pivot, a steel shaft from it to the rod, the pin through the rod
		const P = ctx.props
		const r = (P.bob_diameter ?? 0.05) / 2
		const H = highBarY((P.length ?? 0.5) + r)
		const { parts, zf } = highHanger(ctx, H, 0.018, M("bearing-steel", { color: "#c6cbd1", metalness: 1, roughness: 0.3, envMapIntensity: 1.2 }))
		const rodD = 0.01 // the rod's depth
		const z1 = -(rodD / 2 + 0.0004) // the back washer's back face
		if (z1 - zf > 0.0004) parts.push(pinZ(0.003, z1 - zf + 0.0004, L.stainless(), 0, -H, (zf + z1) / 2, 20))
		parts.push(pinZ(0.0011, rodD + 0.0012, L.stainless(), 0, -H, 0, 16))
		for (const s of [-1, 1]) parts.push(pinZ(0.0034, 0.0004, L.brass(), 0, -H, s * (rodD / 2 + 0.0002), 20)) // a washer each side of the rod
		parts.push(domeAt(0.0028, 0.0013, L.stainless(), 0, -H, rodD / 2 + 0.0004, [0, 0, 1])) // the pin's button head in front
		return group(...parts)
	})

	// ------------------------------------------------------------- the fork of a pivot: two steel cheeks round the plank, a bolt through (seesaw, lever)
	/** Cheeks (outline pts, thickness t) at z = +-(zIn + t / 2), a bolt along z through (0, py) with washers and hex heads outside them. */
	function pivotFork(key, pts, t, zIn, py, plankHalfH, boltR) {
		const m = L.brushedMetal("fork", "#c4c9cf", 0.32)
		const parts = []
		for (const s of [-1, 1]) parts.push(plate(`${key}|c`, pts, t, m, s * (zIn + t / 2), 0.0002))
		const zo = zIn + t
		parts.push(pinZ(boltR, 2 * zo + 0.001, L.stainless(), 0, py, 0, 20))
		for (const s of [-1, 1]) {
			parts.push(pinZ(Math.min(boltR * 1.8, 0.0065), 0.0007, L.stainless(), 0, py, s * (zo + 0.00035), 28))
			parts.push(hexHead(boltR * 1.5, 0.0026, L.darkSteel(), 0, py, s * (zo + 0.0007 + 0.0013)))
		}
		return parts
	}
	/** Two painted bands wrapped round the ends of a plank (top, bottom and both faces). */
	function endBands(ctx, color, band, dd) {
		const { w, h } = ctx
		const m = M(`band|${color}`, { color, roughness: 0.45, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false })
		const out = []
		for (const s of [-1, 1]) {
			const x = s * (w / 2 - band / 2)
			out.push(put(decalPlane(band, dd - 0.0016, m), x, h / 2 + 0.00012, 0, -PI2, 0, 0))
			out.push(put(decalPlane(band, dd - 0.0016, m), x, -h / 2 - 0.00012, 0, PI2, 0, 0))
			out.push(put(decalPlane(band, h - 0.0012, m), x, 0, dd / 2 + 0.00012))
			out.push(put(decalPlane(band, h - 0.0012, m), x, 0, -dd / 2 - 0.00012, 0, Math.PI, 0))
		}
		return out
	}

	// ------------------------------------------------------------- seesaw (model only: the starter machine uses it)
	addModel("seesaw", "plank", (ctx) => {
		// the plank's own depth (4 cm) is all wood; the pivot hardware belongs to the fork on the fulcrum
		const parts = [board(ctx, { r: Math.min(0.0008, ctx.h * 0.12), seed: 4 })]
		if (/wood/.test(ctx.solid.look ?? "")) parts.push(...endBands(ctx, "#2f6fb0", 0.03, ctx.d))
		return group(...parts)
	})
	addModel("seesaw", "fulcrum", (ctx) => {
		const th = ctx.props.plank_thickness ?? 0.012
		const fh = ctx.h
		if (!(fh > 0.002)) return group() // (a fulcrum the layout left no height, a pivot_offset beyond the plank's reach: nothing to draw, never an inside-out sliver)
		const py = fh / 2 + th / 2 + 0.004 // the world pivot above the block's middle: the block's top is 4 mm under the plank's underside
		const parts = [upright(ctx, { r: 0.0009, seed: 4, vary: 5 })]
		// two 2 mm steel cheeks screwed to the block's top, one each side of the plank, the bolt through them and the plank
		// the bolt and the cheeks' round top scale with a thin plank (a 6 mm bolt through a 4 mm plank would stand out of it): the bolt is at most 0.3 x the
		// plank's thickness, the cheeks' top 1.5 mm over the plank's and their width 8 mm + 1.2 x the plank's, never over the default's (22 mm wide, 7.5 mm over the bolt)
		const boltR = Math.min(0.0028, 0.3 * th, th / 2 - 0.0012) // (its top 1.2 mm under the plank's: the view lifts the block 1 mm onto the drawn tabletop, not the hinged plank)
		const pts = roundTop(Math.min(0.022, 0.008 + 1.2 * th), fh / 2 - 0.0005, py + Math.min(0.0075, th / 2 + 0.0015))
		parts.push(...pivotFork(`seesaw|${f5(fh)}|${f5(py)}|${f5(boltR)}`, pts, 0.002, 0.0205 - 0.0, py, th / 2, boltR))
		return group(...parts)
	})
	addModel("seesaw", "lip", (ctx) => upright(ctx, { r: 0.0007, seed: 4, vary: 6 }))

	// ------------------------------------------------------------- lever: a plank on a triangular wooden fulcrum with steel gussets and a pin
	addModel("lever", "plank", (ctx) => group(board(ctx, { r: Math.min(0.0008, ctx.h * 0.12), seed: 7 })))
	addModel("lever", "fulcrum", (ctx) => {
		const pts = ctx.body.points.map((p) => [p.x, p.y])
		const dBody = ctx.body.depth // 0.072: the wood is as wide as the plank (0.06), the gussets (2.5 mm) and the pin's heads (3.3 mm) outside it
		const dW = Math.min(0.06, dBody - 0.01)
		const th = ctx.props.thickness ?? 0.02
		const ph = Math.max(ctx.props.pivot_height ?? 0.12, th / 2 + 0.01)
		const fh = ph - th / 2 - 0.003
		const py = ph - fh / 2 // the pivot in the fulcrum's own frame
		const sk = L.skin(ctx, { seed: 7 })
		// the triangle (a prism of timber cut from a board: the grain runs along its base), edges eased a hair
		const rx = sk.kind === "wood" ? 1 / 1.0 : 1 / sk.tu
		const ry = sk.kind === "wood" ? 1 / 0.125 : 1 / sk.tv
		const rep = (t) => withRepeat(t, rx, ry, 0.3, 0.2)
		let mat = sk.side
		if (sk.kind === "wood") {
			const m = L.woodMaps(ctx.color, L.ws(7))
			mat = M(`lever-fulcrum|${ctx.color}`, { color: ctx.color, map: rep(m.map), normalMap: rep(m.normalMap), normalScale: V2(0.3), roughnessMap: rep(m.ormMap), roughness: 0.75, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2 })
		}
		const parts = [mesh(L.extrudeXY(`fulcrum|${pts.join("|")}|${f5(dW)}`, pts, dW, { bevel: 0.0006 }), mat)]
		// two steel gussets (2.5 mm) on the wood's faces, narrowing from the base to a round head round the pin
		const m = L.brushedMetal("fork", "#c4c9cf", 0.32)
		const t = 0.0025, zo = dW / 2
		const base = 0.016 // a steel strap, wider at the foot, leaving the wood showing either side
		const yb = -fh / 2 + 0.003
		// the pin and its hardware scale with a thin plank (the pin stays inside it from 3 mm up), never over the default's sizes
		const pinR = Math.min(0.0032, 0.3 * th, th / 2 - 0.0012) // (its top 1.2 mm under the plank's: the view lifts the fulcrum 1 mm onto the drawn tabletop, not the hinged plank)
		const hexR = Math.min(0.0048, 0.35 * th + 0.0008) // (its corners under 0.5 mm over a thin plank's top)
		const hr = Math.min(0.0075, Math.max(pinR + 0.002, 0.6 * th))
		const gus = [[-base, yb], [base, yb], [hr, py - 0.001]]
		for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; gus.push([hr * Math.cos(a), py - 0.001 + hr * Math.sin(a) + 0.0]) }
		for (const s of [-1, 1]) {
			parts.push(plate(`gusset|${f5(base)}|${f5(py)}|${f5(yb)}|${f5(hr)}`, gus, t, m, s * (zo + t / 2), 0.0002))
			for (const [sx, fy] of [[-0.55, 0.14], [0.55, 0.14], [0, 0.6]]) parts.push(domeAt(0.0022, 0.0009, L.stainless(), sx * base, yb + (py - yb) * fy, s * (zo + t), [0, 0, s]))
		}
		// the pivot pin: through both gussets and the plank, heads outside
		const zt = zo + t
		parts.push(pinZ(pinR, 2 * zt + 0.001, L.stainless(), 0, py, 0, 20))
		for (const s of [-1, 1]) {
			parts.push(pinZ(Math.min(0.0058, 1.8 * pinR), 0.0007, L.stainless(), 0, py, s * (zt + 0.00035), 28))
			parts.push(hexHead(hexR, 0.0026, L.darkSteel(), 0, py, s * (zt + 0.0007 + 0.0013)))
		}
		return group(...parts)
	})

	// ------------------------------------------------------------- hinged gate: planked, ledged, hung on strap hinges from a pintle
	const GATE_EYE = (th) => Math.min(0.0028, th * 0.16)
	// the knuckles, the pintle's eye: turned, smooth satin dark iron (the hammered finish is for the straps; on a part this small its dimples would read as pits)
	const satinIron = () => M("gate-satin", { color: "#3a3d41", metalness: 0.7, roughness: 0.45, envMapIntensity: 1.1 })
	const gateGeometry = (d) => {
		const sw = Math.min(0.016, d * 0.14) // the strap's width
		const zg = Math.min(d * 0.32, d / 2 - sw) // the gate's strap eyes sit at +-zg
		return { sw, zg }
	}
	addModel("hinged-gate", "gate", (ctx) => {
		const { w: th, h: len, d } = ctx
		const look = ctx.solid.look ?? ""
		const { sw, zg } = gateGeometry(d)
		const eyeR = GATE_EYE(th)
		const x0 = -th / 2
		const parts = []
		if (!/wood/.test(look)) {
			// a sheet-metal leaf: folded edges, rolled knuckles at the top where the hinge pin goes through them
			const sk = L.skin(ctx)
			parts.push(upright(ctx, { r: Math.min(0.0014, th * 0.3), seed: 3 }))
			for (const sz of [-1, 1]) parts.push(pinZ(eyeR, sw, look === "aluminium" ? L.aluminium() : L.stainless(), 0, len / 2 - 0.0005, sz * zg, 20))
			parts.push(pinZ(0.0016, d - 0.002, L.stainless(), 0, len / 2 - 0.0005, 0, 16))
			return group(...parts)
		}
		const iron = L.ironMat() // (hammered: the straps)
		const sk = L.woodSet(ctx.color, 9)
		// the boards: upright planks the whole thickness of the gate, joints between them over a dark core; a wide gate has more of them (none over 12 cm wide:
		// the grain tile is 12.5 cm across, a wider board would show its arches and its knot twice)
		const nb = d >= 0.09 ? Math.max(3, Math.ceil(d / 0.12)) : d >= 0.05 ? 2 : 1
		const gap = 0.0005
		const wb = (d - gap * (nb - 1)) / nb
		parts.push(put(mesh(kit.box(th - 0.0006, len - 0.001, d - 0.001, 0.0002, 1), M("gate-core", { color: "#40291a", roughness: 0.9, metalness: 0 }), { cast: false }), 0, 0, 0))
		for (let i = 0; i < nb; i++) {
			const z = -d / 2 + wb / 2 + i * (wb + gap)
			// each board its own stretch of the grain along the tile (the grain is periodic along it: no seam wherever a board starts); the default gate's three
			// narrow boards (6 cm and under, under half the tile across) keep theirs
			const ou = nb <= 3 && wb <= 0.06 ? 0 : L.h3(i, 1, 61)
			const g = rbox(len, th, wb, Math.min(0.0014, th * 0.12), { tu: L.grainTile(len), tv: 0.125, te: 0.125, fit: true, off: { y: [0.5 + ou, 0.5 + 0.3 * i], z: [0.5 + ou, 0.2 + 0.2 * i], x: [0.3 + 0.2 * i, 0.9] } })
			const bs = i < 3 ? sk : L.boardSkin(ctx.color, 9, i, 61)
			const m = mesh(g, faces(bs.side, bs.end))
			m.rotation.z = PI2
			m.position.set(0, 0, z)
			parts.push(m)
		}
		// two ledges across the back: inlaid flush with the boards (a joint line and cross grain), nails through them
		const lh = Math.min(0.03, len * 0.08)
		for (const fy of [0.3, 0.8]) {
			const y = len / 2 - len * fy
			parts.push(put(mesh(rbox(0.0008, lh, d - 0.003, 0.0003, { tu: 1.0, tv: 0.125, te: 0.125, tx: [1.0, 0.125], fit: true, off: { x: [0.2 * fy, 0.5 + 0.3 * fy], y: [0.5, 0.5], z: [0.5, 0.5] } }), [sk.side, sk.side, sk.side, sk.side, sk.side, sk.side]), th / 2 + 0.0003, y, 0))
			for (const sz of [-1, 1]) for (const k of [0.2, 0.5, 0.8]) parts.push(domeAt(0.0012, 0.0005, L.darkSteel(), th / 2 + 0.0007, y + (k - 0.5) * lh * 0.5, sz * d * (0.15 + 0.15 * k), [1, 0, 0]))
		}
		// strap hinges on the front face: a rolled eye at the top round the pin, a long tapering strap, three domed bolts (1.2 mm proud of the face)
		const sl = Math.min(len * 0.55, 0.16)
		const tStrap = 0.002
		for (const sz of [-1, 1]) {
			const z = sz * zg
			const strap = kit.geo(`gatestrap2|${f5(sl)}|${f5(sw)}|${f5(tStrap)}`, () => {
				// a strap narrowing to a rounded point (seen along x: width sw at the top, 0.6 sw at the end)
				const sh = new T.Shape()
				sh.moveTo(-sw / 2, 0)
				sh.lineTo(sw / 2, 0)
				sh.lineTo(sw * 0.34, -sl + sw * 0.4)
				sh.absarc(0, -sl + sw * 0.4, sw * 0.34, 0, -Math.PI, true)
				sh.lineTo(-sw / 2, 0)
				const g = new T.ExtrudeGeometry(sh, { depth: tStrap, bevelEnabled: true, bevelThickness: 0.0002, bevelSize: 0.0002, bevelSegments: 1, curveSegments: 10 })
				g.rotateY(-PI2) // shape x -> z, extrusion -> x
				return g
			})
			parts.push(put(mesh(strap, iron), x0 + 0.0008 + 0.0002, len / 2 - eyeR * 0.5, z))
			// the eye: a short tube of radius eyeR round the pin
			parts.push(put(mesh(kit.cylinderZ(eyeR, sw, 20), satinIron()), 0, len / 2 - 0.0005, z))
			for (const f of [0.35, 0.65, 0.92]) parts.push(domeAt(0.0024, 0.0009, L.stainless(), x0 - 0.001, len / 2 - sl * f - eyeR * 0.5, z, [-1, 0, 0]))
		}
		// the hinge pin through both eyes
		parts.push(pinZ(0.0016, d - 0.002, L.stainless(), 0, len / 2 - 0.0005, 0, 16))
		return group(...parts)
	})
	addModel("hinged-gate", "hanger", (ctx) => {
		const { w, h } = ctx
		const gd = ctx.d - 0.03 // the gate's depth (the bar is as deep)
		const { parts } = hangerWood(ctx)
		// the pintle: a strap from the bar's underside down to a knuckle round the pin, between the gate's two eyes
		const gth = ctx.props.thickness ?? 0.02
		const { sw } = gateGeometry(gd)
		const eyeR = GATE_EYE(gth)
		const yH = Math.round(Math.max(0.012, gth / 2 + 0.0105) * 1e5) / 1e5 // catalog_items.py build_gate: the bar's middle over the pivot
		const py = -yH - 0.0005 // the pin, 0.5 mm under the pivot (as the gate's own model has it)
		const t = 0.0022
		const pg = kit.geo(`pintle|${f5(sw)}|${f5(h)}|${f5(py)}`, () => {
			// the strap hangs in the y-z plane: from the bar's underside (y = -h / 2) down to the pin
			const sh = new T.Shape()
			sh.moveTo(-sw / 2, -h / 2 + 0.0008)
			sh.lineTo(sw / 2, -h / 2 + 0.0008)
			sh.lineTo(sw / 2, py)
			sh.lineTo(-sw / 2, py)
			const g = new T.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false })
			g.rotateY(-PI2).translate(t / 2, 0, 0)
			return g
		})
		parts.push(mesh(pg, satinIron()))
		parts.push(pinZ(eyeR, sw, satinIron(), 0, py, 0, 20))
		return group(...parts)
	})

	addModel("hinged-gate", "hanger-high", (ctx) => {
		// the high bar (the gate swings past level): its batten down behind the gate to a bearing on the hinge pin's back end, a domed nut on its front end
		const P = ctx.props
		const gd = P.depth ?? 0.12, gth = P.thickness ?? 0.02
		const H = highBarY(Math.hypot(P.length ?? 0.4, gth / 2))
		const { parts, zf } = highHanger(ctx, H, Math.min(0.03, Math.max(0.018, gth + 0.004)), satinIron())
		const pr = 0.0016 // the gate's own hinge pin (its model draws it through the boards)
		const z1 = -gd / 2 + 0.0015
		parts.push(pinZ(pr, z1 - zf, L.stainless(), 0, -H, (zf + z1) / 2, 16)) // the pin's back end, out of the gate into the bearing
		parts.push(pinZ(0.0032, 0.0005, L.stainless(), 0, -H, -gd / 2 - 0.0003, 20)) // a washer on the gate's back edge
		parts.push(pinZ(0.0032, 0.0005, L.stainless(), 0, -H, gd / 2 + 0.0003, 20)) // and on its front edge, under the nut
		parts.push(domeAt(0.0026, 0.0012, L.stainless(), 0, -H, gd / 2 + 0.0005, [0, 0, 1]))
		return group(...parts)
	})

	// ------------------------------------------------------------- Newton's cradle: chrome frame, chrome balls on two fine strings each
	addModel("newtons-cradle", "*", (ctx) => {
		const part = ctx.solid.part
		const chrome = L.chrome()
		if (/^rod\d+$/.test(part)) {
			// two fine strings in a V: from the ball's top up to the front and the back rail (they overlap in the side view)
			const len = ctx.h
			const rail = ctx.d / 2 - 0.006 // the rails are the bar's round tubes (radius 6 mm), flush with its front and back faces
			const rBall = ctx.props.ball_diameter / 2
			const top = len / 2 + 0.0022
			const bot = -len / 2 + rBall - 0.0005
			const rad = 0.00035
			const string = M("cradle-string", { color: "#e8e6df", roughness: 0.6, metalness: 0 })
			const parts = []
			for (const s of [-1, 1]) {
				const dy = top - bot
				const length = Math.hypot(dy, rail)
				const g = kit.cylinderY(rad, length, 6)
				const m = mesh(g, string, { cast: false })
				m.position.set(0, (top + bot) / 2, (s * rail) / 2)
				m.rotation.x = s * Math.atan2(rail, dy) // leans toward its rail at the top
				parts.push(m)
			}
			return group(...parts)
		}
		if (/^bob\d+$/.test(part)) {
			const r = ctx.r
			const look = ctx.solid.look ?? ""
			const mat = look === "steel" ? chrome : look === "aluminium" ? L.aluminium() : L.skin(ctx).side
			const parts = [mesh(kit.sphere(r, 48, 24), mat)]
			// the little eye the strings run through
			const er = Math.min(0.0011, r * 0.07)
			parts.push(put(mesh(kit.torus(er, Math.min(0.00028, er * 0.3), 8, 20), mat), 0, r + er * 0.55, 0, 0, PI2, 0))
			return group(...parts)
		}
		if (part === "bar") {
			// two round chrome rails, front and back
			const { w, h, d } = ctx
			const rr = h / 2
			const parts = []
			for (const s of [-1, 1]) parts.push(put(mesh(kit.cylinderY(rr, w, 40), chrome), 0, 0, s * (d / 2 - rr), 0, 0, PI2))
			return group(...parts)
		}
		if (part === "post-left" || part === "post-right") {
			// each post is a pair of round chrome tubes with a ball at the elbow where it meets the rail, a flange where it stands on the base
			const { w, h, d } = ctx
			const rr = w / 2
			const parts = []
			for (const s of [-1, 1]) {
				parts.push(put(mesh(kit.cylinderY(rr, h - rr, 40), chrome), 0, -rr / 2, s * (d / 2 - rr)))
				parts.push(put(mesh(kit.sphere(rr, 32, 16), chrome), 0, h / 2 - rr, s * (d / 2 - rr)))
				parts.push(put(mesh(kit.cylinderY(Math.min(rr * 1.5, rr + 0.0018), 0.002, 32), chrome), 0, -h / 2 + 0.001, s * (d / 2 - rr)))
			}
			return group(...parts)
		}
		if (part === "base") {
			// a heavy walnut plinth with a chrome inlay strip
			const { w, h, d } = ctx
			const wsk = L.woodSet("#7a5030", 4, { varnish: 0.9 })
			const g = rbox(w, h, d, Math.min(0.0035, h * 0.28), { seg: 4, tu: 1.0, tv: 0.125, te: 0.125, fit: true, off: { y: [0.3, 0.2], z: [0.1, 0.4], x: [0.5, 0.5] } })
			const parts = [mesh(g, faces(wsk.side, wsk.end))]
			parts.push(put(mesh(rbox(w - 0.02, 0.0008, 0.004, 0.0003, { seg: 1 }), chrome), 0, h / 2 + 0.0001, d / 2 - 0.008))
			return group(...parts)
		}
		return undefined
	})

	// ------------------------------------------------------------- fan: a desk fan, a round wire cage on a motor housing, tilt yoke, neck and base (it blows toward +x)
	const arc = (cr, cz, rad, a0, a1, n = 6) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cr + rad * Math.cos(a), cz + rad * Math.sin(a)] })
	const fanPlastic = () => L.plasticMat("#e9edf0", 0.55)
	addModel("fan", "housing", (ctx) => {
		// the cage as the physics polygon: an octagon, flat front and back, cones to a rim band 3 cm wide
		const pts = ctx.body.points
		const R = Math.max(...pts.map((p) => Math.abs(p.y)))
		const xf = Math.max(...pts.map((p) => p.x)), xb = Math.min(...pts.map((p) => p.x))
		const xc = (xf + xb) / 2
		const P = ctx.props
		// the guards are flat out to the polygon's front corner (FAN_FLAT), then a cone to the rim, FAN_SAG back (the catalog's octagon)
		const FAN_FLAT = Math.max(...pts.filter((p) => Math.abs(p.x - xf) < 1e-6).map((p) => Math.abs(p.y)))
		const FAN_SAG = xf - Math.max(...pts.filter((p) => Math.abs(Math.abs(p.y) - R) < 1e-6).map((p) => p.x))
		const key = `fan3|${f5(R)}|${f5(xf - xb)}`
		const wire = M("fan-wire", { color: "#e2e5e9", metalness: 1, roughness: 0.26, envMapIntensity: 1.4 })
		const plastic = fanPlastic()
		const parts = []
		const wr = 0.0011 // wire radius
		const xrimF = xf - FAN_SAG, xrimB = xb + FAN_SAG // where the guards meet the rim band
		// the rim: a plastic band round the middle, clamping both guards
		const rimThick = 0.007
		const rim = [[R - rimThick, xrimB], [R, xrimB], [R, xrimF], [R - rimThick, xrimF]]
		parts.push(mesh(L.lathe(`${key}|rim`, [...rim, rim[0]], { axis: "x", seg: 96, crease: 0.7 }), plastic))
		// a guard: concentric rings and spokes on a flat middle and a cone (front: toward +x; the back one mirrors it). The rings follow the cage's own size (a ring every
		// ~2 cm of radius, so none can stand outside a small cage and a big one is not a bicycle wheel); a second set of spokes starts where the first are > 5 cm apart.
		const Rr = R - 0.002
		const guardG = (sgn) => kit.geo(`${key}|guard|${sgn}`, () => {
			const list = []
			const nF = Math.max(2, Math.round(FAN_FLAT / 0.02))
			const nC = Math.max(1, Math.round((Rr - FAN_FLAT) / 0.02))
			const radii = []
			for (let k = 1; k <= nF; k++) radii.push((FAN_FLAT * k) / nF)
			for (let k = 1; k <= nC; k++) radii.push(FAN_FLAT + ((Rr - FAN_FLAT) * k) / nC)
			const coneX = (rr) => (rr <= FAN_FLAT ? 0 : -((rr - FAN_FLAT) / (Rr - FAN_FLAT)) * FAN_SAG)
			for (const rr of radii) list.push(new T.TorusGeometry(rr, wr, rr > 0.15 ? 4 : 5, clamp(Math.round(rr * 350), 24, 110)).rotateY(PI2).translate(coneX(rr), 0, 0))
			const spoke = (a, r0, r1, nSeg = 1) => {
				const x0 = coneX(r0), x1 = coneX(r1)
				const tb = new T.TubeGeometry(new T.LineCurve3(new T.Vector3(x0, r0, 0), new T.Vector3(x1, r1, 0)), nSeg, wr * 0.9, 5, false)
				tb.rotateX(a)
				list.push(tb)
			}
			const nS = 24
			for (let k = 0; k < nS; k++) {
				const a = (k / nS) * TAU
				spoke(a, 0, FAN_FLAT)
				spoke(a, FAN_FLAT, Rr)
			}
			if (Rr > 0.2) {
				const r2 = Math.max(FAN_FLAT, (nS * 0.05) / TAU)
				for (let k = 0; k < nS; k++) spoke(((k + 0.5) / nS) * TAU, r2, Rr)
			}
			const g = L.mergeGeometries(list, false)
			if (sgn < 0) g.rotateY(Math.PI) // the back guard faces the other way
			return g
		})
		parts.push(put(mesh(guardG(1), wire), xf - wr, 0, 0)) // (the wire's own radius inside the cage's outline)
		parts.push(put(mesh(guardG(-1), wire), xb + wr, 0, 0))
		// a chrome badge in the middle of each guard, with the centre ring
		for (const [x, s] of [[xf - 0.0012, 1], [xb + 0.0012, -1]]) parts.push(put(mesh(kit.cylinderY(0.016, 0.003, 32), L.chrome()), x, 0, 0, 0, 0, PI2))
		// the blades, between the guards just ahead of the motor, with a spinner hub
		const hubX = xc
		parts.push(put(mesh(kit.cylinderY(0.005, hubX - xb, 14), L.stainless()), (xb + hubX) / 2, 0, 0, 0, 0, PI2)) // the motor shaft, seen through the rear guard
		const hubR = 0.022
		parts.push(mesh(L.lathe(`${key}|hub`, [[0, hubX - 0.012], [hubR, hubX - 0.012], [hubR, hubX - 0.002], ...arc(0, hubX - 0.002, hubR, 0, PI2, 5).slice(1).map(([r_, z_]) => [r_, hubX - 0.002 + (z_ - hubX + 0.002) * 0.55]), [0, hubX - 0.002 + hubR * 0.55]], { axis: "x", seg: 36, crease: 0.9 }), plastic))
		const blade = M("fan-blade", { color: "#7fb0d6", roughness: 0.32, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.15, side: T.DoubleSide, transparent: true, opacity: 0.92 })
		const Dblade = P.diameter ?? R * 2 - 0.04
		const bl = Dblade / 2 - 0.004
		const bladeGeo = kit.geo(`${key}|blade|${f5(bl)}`, () => {
			const sh = new T.Shape()
			const w0 = hubR * 1.1, w1 = bl * 0.4
			sh.moveTo(0, -w0 / 2)
			sh.bezierCurveTo(bl * 0.25, -w0 / 2 - 0.006, bl * 0.7, -w1 * 0.55, bl, -w1 * 0.05)
			sh.bezierCurveTo(bl * 1.01, w1 * 0.3, bl * 0.8, w1 * 0.75, bl * 0.45, w1 * 0.55)
			sh.lineTo(0, w0 / 2)
			const g = new T.ShapeGeometry(sh, 18)
			// pitch the blade: twist about the radius so it bites the air; then lie it in the y-z plane
			const p = g.attributes.position
			for (let i = 0; i < p.count; i++) { const r_ = p.getX(i), c = p.getY(i); const tw = 0.5 - 0.25 * (r_ / bl); p.setXYZ(i, c * Math.sin(tw) * 0.9, r_, c * Math.cos(tw)) }
			g.computeVertexNormals()
			return g
		})
		// the blades turn together about the fan's axis (x): one group, marked for the view's clock. Each blade's +z edge stands downstream (+x) of its -z edge, so the blades
		// throw air toward +x when they swing toward -z, which is clockwise about +x (a negative rps); at most 4 turns a second, so five blades never strobe backwards
		const spinner = new T.Group()
		spinner.position.x = hubX - 0.006
		for (let i = 0; i < 5; i++) {
			const b = mesh(bladeGeo, blade)
			b.rotation.x = (i / 5) * TAU
			spinner.add(b)
		}
		spinner.userData.spin = { axis: "x", rps: -Math.min(4, 0.8 * (P.speed ?? 5)), from: P.on_at ?? 0.5 }
		parts.push(spinner)
		return group(...parts)
	})
	addModel("fan", "motor", (ctx) => {
		// a rounded cylinder behind the cage with vents, a tilt yoke at its sides and a knob
		const { w, h, d } = ctx
		const R = h / 2
		const plastic = fanPlastic()
		const parts = []
		const x0 = -w / 2, x1 = w / 2 // the front (toward the cage) is +x
		const f = 0.003
		const prof = [[0, x0], [R - f, x0], ...arc(R - f, x0 + f, f, -PI2, 0, 3).slice(1), [R, x1 - f], ...arc(R - f, x1 - f, f, 0, PI2, 3).slice(1), [0, x1]]
		parts.push(mesh(L.lathe(`fanmotor|${f5(R)}|${f5(w)}`, prof.map(([r, y]) => [r, y]), { axis: "x", seg: 64, crease: 0.9 }), plastic))
		// vent slots round the back of the barrel and across the rear face
		const slot = M("fan-slot", { color: "#1d1f22", roughness: 0.8, metalness: 0 })
		const vents = kit.geo(`fanvents|${f5(R)}|${f5(w)}`, () => {
			const list = []
			for (let i = 0; i < 22; i++) { const a = (i / 22) * TAU; const g = new T.BoxGeometry(0.03, 0.0035, 0.0008); g.translate(-w / 2 + 0.032, R - 0.0005, 0); g.rotateX(a); list.push(g) }
			return L.mergeGeometries(list, false)
		})
		parts.push(mesh(vents, slot, { cast: false }))
		// a ribbed collar where the motor meets the cage's rear guard
		parts.push(mesh(L.lathe(`fanmotor-collar|${f5(R)}|${f5(w)}`, [[0.012, x1], [0.03, x1], [0.03, x1 + 0.0001], [0.012, x1 + 0.0001]], { axis: "x", seg: 36, crease: 0.9 }), L.chrome(), { cast: false }))
		// the tilt yoke: two flat arms from a saddle under the motor to its axis, and a knob on one side
		const steelM = L.brushedMetal("yoke", "#cdd2d8", 0.3)
		const zArm = R + 0.0015
		const armPts = roundTop(0.016, -R - 0.009, 0.014)
		for (const s of [-1, 1]) parts.push(plate(`fanyoke|${f5(R)}`, armPts, 0.003, steelM, s * zArm, 0.0002))
		parts.push(put(mesh(rbox(0.034, 0.008, 2 * zArm + 0.003, 0.002, { seg: 2 }), steelM), 0, -R - 0.005, 0))
		const knobM = M("fan-knob", { color: "#1d1f22", roughness: 0.5, metalness: 0 })
		const kz = zArm + 0.0015
		parts.push(put(mesh(kit.cylinderZ(0.0045, 2 * kz + 0.012, 16), L.stainless()), 0, 0, 0))
		parts.push(put(mesh(kit.cylinderZ(0.0125, 0.012, 24), knobM), 0, 0, kz + 0.006 + 0.0))
		for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; parts.push(put(mesh(kit.box(0.003, 0.003, 0.012, 0.0005, 1), knobM), 0.0125 * Math.cos(a), 0.0125 * Math.sin(a), kz + 0.006)) }
		return group(...parts)
	})
	addModel("fan", "neck", (ctx) => {
		const { h } = ctx
		const r = ctx.w / 2
		const white = fanPlastic()
		const rubber = L.rubber("#26282b")
		const parts = [mesh(kit.cylinderY(r * 0.8, h, 32), white)]
		parts.push(put(mesh(kit.cylinderY(r, h * 0.2, 32), rubber), 0, -h / 2 + h * 0.1, 0)) // a rubber boot at the foot
		parts.push(put(mesh(kit.cylinderY(r, 0.006, 32), L.chrome()), 0, h / 2 - 0.003, 0))
		return group(...parts)
	})
	addModel("fan", "base", (ctx) => {
		const { h } = ctx
		const R = ctx.w / 2
		const white = fanPlastic()
		const prof = [[0, -h / 2], [R - 0.012, -h / 2], [R - 0.008, -h / 2 + 0.004], [R, -h / 2 + 0.0045], [R, h / 2 - 0.006], ...arc(R - 0.006, h / 2 - 0.006, 0.006, 0, PI2, 4).slice(1), [R * 0.35, h / 2 - 0.0005], [R * 0.3, h / 2], [0, h / 2]]
		const parts = [mesh(L.lathe(`fanbase|${f5(R)}|${f5(h)}`, prof, { seg: 72, crease: 0.7 }), white)]
		parts.push(mesh(L.lathe(`fanbase-foot|${f5(R)}|${f5(h)}`, [[R * 0.2, -h / 2], [R - 0.012, -h / 2], [R - 0.011, -h / 2 + 0.0012], [R * 0.2, -h / 2 + 0.0012]], { seg: 72, crease: 0.7 }), L.rubber("#26282b")))
		return group(...parts)
	})
}
