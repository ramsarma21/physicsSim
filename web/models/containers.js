// 3D models for the containers catalog group (see web/models3d.js for the frame and the kit; helpers in surfaces-lib.js).
// Items: box (a wooden crate, open front and back: its end panels and floor are the physics), cup, bucket, basket.
// The round and the woven vessels are drawn on their floor's part (the two walls are null): together the three parts' outlines are the
// vessel's side view, and that is exactly what the drawn vessel fills; its depth (front to back) is the vessel's own.
import { makeLib } from "./surfaces-lib.js"

export default function register({ addModel, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const { T, TAU, M, V2, clamp, mix, sstep, h3, pn, pfbm, rgb, f5, bake, withRepeat, rbox, mesh, put, decalMat, board } = L
	const group = (...c) => kit.group(...c)
	const PI2 = Math.PI / 2

	// ------------------------------------------------------------- small hardware
	/** A domed head (rivet, nail, bolt) of radius r and height hh, its base at (x, y, z) and its dome toward `dir`. */
	function domeAt(r, hh, mat, x, y, z, dir = [0, 0, 1]) {
		const m = mesh(kit.geo(`cdome|${f5(r)}|${f5(hh)}`, () => new T.SphereGeometry(r, 14, 7, 0, TAU, 0, PI2).scale(1, hh / r, 1).rotateX(PI2)), mat, { cast: false })
		m.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(...dir).normalize())
		m.position.set(x, y, z)
		return m
	}

	// ------------------------------------------------------------- box: a wooden crate, nailed boards, a boarded back and a slatted front
	/** A board with the grain along z (front to back): its end grain shows on the front and back faces. */
	function zBoard(w, h, d, sk, seed, r) {
		const g = rbox(w, h, d, r, { tu: 1.0, tv: 0.125, te: 0.125, ty: [1.0, 0.125], tz: [0.125, 0.125], tx: [1.0, 0.125], yswap: true, fit: true, off: { y: [0.5 + 0.13 * seed, 0.5], z: [0.31 * seed, 0.2 + 0.1 * seed], x: [0.5, 0.2 + 0.2 * seed] } })
		return mesh(g, [sk.side, sk.side, sk.side, sk.side, sk.end, sk.end])
	}
	/** A board with the grain along x (a back board, a slat). */
	function xBoard(w, h, d, sk, seed, r) {
		const g = rbox(w, h, d, r, { tu: 1.0, tv: 0.125, te: 0.125, fit: true, off: { y: [0.5 + 0.17 * seed, 0.5], z: [0.31 * seed, 0.2 + 0.1 * seed], x: [0.5, 0.2 + 0.2 * seed] } })
		return mesh(g, [sk.end, sk.end, sk.side, sk.side, sk.side, sk.side])
	}
	const nailMat = () => M("crate-nail", { color: "#2d2f33", metalness: 0.9, roughness: 0.45 })
	function nail(x, y, z, axis, r = 0.0014) {
		const m = mesh(kit.geo(`nail|${f5(r)}`, () => new T.CylinderGeometry(r, r * 0.9, 0.0007, 12)), nailMat(), { cast: false })
		m.position.set(x, y, z)
		if (axis === "x") m.rotation.z = -PI2
		return m
	}
	/**
	 * The ring a cord is tied to, on a panel's top: a flat steel ring lying on a washer screwed into the wood, so it stands under 2 mm over the panel's
	 * outline (a ball dropped in beside the wall passes it without the drawing crossing it).
	 */
	function screwEye(x, y, z, k = 1) {
		// k: the scale on a thin panel (the washer stays within 1 mm of the panel's faces)
		const steel = L.stainless()
		const tube = 0.0008 * k
		return [
			put(mesh(kit.cylinderY(0.0052 * k, 0.0003, 20), steel, { cast: false }), x, y + 0.00015, z), // the washer
			put(mesh(kit.torus(0.0032 * k, tube, 8, 20), steel), x, y + 0.0003 + tube, z, PI2, 0, 0), // the ring, lying flat on it (1.9 mm at its top)
			put(mesh(kit.cylinderY(0.0016 * k, 0.0005, 10), steel, { cast: false }), x, y + 0.0003 + 0.00025, z), // the screw's head in the ring's eye
		]
	}
	function crateParts(ctx) {
		const { w, h, d } = ctx
		const part = ctx.solid.part
		const P = ctx.props
		if (!/wood/.test(ctx.solid.look ?? "")) return board(ctx, { r: 0.001 })
		const sk = L.woodSet(ctx.color, 5)
		const parts = []
		const r = Math.min(0.0008, w * 0.1, h * 0.1)
		const wall = P.wall ?? 0.13, tp = P.thickness ?? 0.012
		const nb = clamp(Math.round(wall / 0.045), 1, 8)
		const gap = 0.0006
		const hb = (wall - gap * (nb - 1)) / nb
		if (part === "floor") {
			// floor boards side by side, front to back
			const nf = w >= 0.22 ? 3 : w >= 0.1 ? 2 : 1
			const wb = (w - gap * (nf - 1)) / nf
			for (let i = 0; i < nf; i++) parts.push(put(zBoard(wb, h, d, sk, 1 + i, r), -w / 2 + wb / 2 + i * (wb + gap), 0, 0))
			// the back: horizontal boards 8 mm thick between the end panels, nailed to them; the front: a low slat and a top rail, the middle open
			const inner = w - 2 * tp - 0.001
			const tb = 0.008
			for (let i = 0; i < nb; i++) {
				const y = h / 2 + i * (hb + gap) + hb / 2
				parts.push(put(xBoard(inner, hb, tb, sk, 11 + i, r), 0, y, -d / 2 + tb / 2))
				if (nb >= 3 && (i === 0 || i === nb - 1)) parts.push(put(xBoard(inner, hb, tb, sk, 21 + i, r), 0, y, d / 2 - tb / 2))
			}
		} else {
			// an end panel: horizontal boards stacked up, with a nail near each end of each board on the outer face
			const out = part === "left" ? -1 : 1
			for (let i = 0; i < nb; i++) {
				const y = -h / 2 + hb / 2 + i * (hb + gap)
				parts.push(put(zBoard(w, hb, d, sk, 4 + i, r), 0, y, 0))
				for (const sz of [-1, 1]) parts.push(nail(out * (w / 2 + 0.0003), y, sz * (d / 2 - 0.004), "x", Math.min(0.0016, hb * 0.18)))
			}
			// the screw eyes the cords are tied to (the view hangs them 1 cm in from the front and back faces): on a shallow box two smaller ones whose washers
			// stay apart; one too shallow for that (under 3 cm deep) gets one eye in the middle, where both cords meet
			if (P.hung) {
				const k = Math.min(1, (0.5 * w + 0.001) / 0.0052), ze = d / 2 - 0.01
				const k2 = Math.min(k, (ze - 0.0002) / 0.0052)
				if (k2 >= 0.6 * k) for (const z of [-ze, ze]) parts.push(...screwEye(0, h / 2, z, k2))
				else parts.push(...screwEye(0, h / 2, 0, k))
			}
		}
		return group(...parts)
	}
	addModel("box", "*", crateParts)

	// ------------------------------------------------------------- the wall of a round vessel: the physics walls turned about the axis
	/** The side view of a vessel (floor + two walls: containers' _vessel in machines/catalog_items.py) as three profiles in (r, y), r from the axis. */
	function vesselProfiles(P) {
		const W = P.width, H = P.wall, t = P.thickness, Wb = W * P.bottom_ratio
		const run = (W - Wb) / 2
		const phi = Math.atan2(run, H)
		const c = Math.cos(phi), s = Math.sin(phi)
		const x0 = (Wb - t) / 2
		const ob = [x0 + (t / 2) * c, -(t / 2) * s]
		const ib = [x0 - (t / 2) * c, (t / 2) * s]
		const it = [x0 + run - (t / 2) * c, H + (t / 2) * s]
		const ot = [x0 + run + (t / 2) * c, H - (t / 2) * s]
		const xj = ib[0] - (t / 2) * Math.tan(phi) * s // where the inner wall meets the floor's top
		const yc = phi > 1e-6 ? ((t / 2) * (c - 1)) / s : -t
		const outer = [[0, -t], [Wb / 2, -t]]
		if (yc > -t + 1e-5 && phi > 1e-6) outer.push([Wb / 2, yc])
		outer.push(ot)
		const tanPhi = Math.tan(phi)
		return { outer, rim: [ot, it], inner: [it, [xj, 0], [0, 0]], ot, it, ob, ib, phi, tanPhi, W, H, t, Wb, rAt: (y) => ob[0] + (y - ob[1]) * tanPhi }
	}
	/**
	 * Densify a polyline (for ribs): a point every `step` of height within +-`win` of each height in `ys` (where a bead's ridge needs them), and the rest no
	 * further apart than `far` (a straight cone only needs its ends): a tall vessel stays near 50 rings however big it is.
	 */
	function densify(pts, ys = [], { far = 0.03, step = 0.002, win = 0.014 } = {}) {
		const out = [pts[0]]
		const nk = Math.round(win / step)
		for (let i = 1; i < pts.length; i++) {
			const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
			const len = Math.hypot(x1 - x0, y1 - y0)
			const dy = y1 - y0
			const ts = [0, 1]
			if (Math.abs(dy) > 1e-9) for (const yb of ys) for (let k = -nk; k <= nk; k++) { const t = (yb + k * step - y0) / dy; if (t > 1e-6 && t < 1 - 1e-6) ts.push(t) }
			ts.sort((a, b) => a - b)
			for (let j = 1; j < ts.length; j++) {
				const t0 = ts[j - 1], t1 = ts[j]
				if (t1 - t0 < 1e-6) continue
				const n = Math.max(1, Math.ceil(((t1 - t0) * len) / far))
				for (let q = 1; q <= n; q++) { const t = t0 + ((t1 - t0) * q) / n; out.push([mix(x0, x1, t), mix(y0, y1, t)]) }
			}
		}
		return out
	}
	/**
	 * A surface of revolution built stave by stave (a cooper's pail): n staves, each its own strip with its own grain, a V of `groove` m at every seam.
	 * pts = [[r, y], ...] bottom to top; tile = [along the grain (the profile), across]; the seam between staves is a hard edge.
	 */
	function staveLathe(key, pts, n, { tile = [1.0, 0.125], groove = 0.0007, perStave = 4 } = {}) {
		return kit.geo(`stave|${key}|${n}|${f5(groove)}`, () => {
			const np = pts.length
			const arc = [0]
			for (let i = 1; i < np; i++) arc[i] = arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
			const pos = [], uv = [], idx = []
			const R0 = Math.max(...pts.map((p) => p[0]))
			for (let k = 0; k < n; k++) {
				const du = h3(k, 1, 77), dv = h3(k, 2, 77) * 4
				const base = pos.length / 3
				for (let j = 0; j <= perStave; j++) {
					const f = j / perStave
					const ph = ((k + f) / n) * TAU
					// the V groove: deepest at both edges of the stave
					const e = Math.min(f, 1 - f)
					const g = groove * Math.max(0, 1 - e / 0.1)
					for (let i = 0; i < np; i++) {
						const r = Math.max(0, pts[i][0] - (pts[i][0] > 0.0005 ? g : 0))
						pos.push(-r * Math.sin(ph), pts[i][1], -r * Math.cos(ph)) // (the lathe's seam goes to the back)
						const chord = (pts[i][0] * TAU) / n
						uv.push(arc[i] / tile[0] + du, f * (chord / tile[1]) + dv)
					}
				}
				for (let j = 0; j < perStave; j++) for (let i = 0; i < np - 1; i++) {
					const a = base + j * np + i, b = a + np, c = a + 1, d2 = b + 1
					idx.push(a, b, c, c, b, d2)
				}
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
			g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2))
			g.setIndex(idx)
			g.computeVertexNormals()
			void R0
			return g
		})
	}
	/**
	 * A round vessel on its floor's part: the cone of three lathes, a rolled rim, scaled in z to the item's depth. Options:
	 * beads (stiffening ribs at fractions of the wall's height), rimBead (rolled rim radius), skirt (the rolled-under bottom: a step this much inside the wall),
	 * margin (m of depth kept clear front and back for hardware), staves (a cooper's pail: this many staves), wood, extras(pr) -> more parts,
	 * beadAmp / beadW (a bead's height out of the wall and its half-width, m), zScale(pr, zv) -> the z scale (zv: how far the vessel's own wall and rim
	 * reach from the axis; default (depth - 2 margin) / width), outside(pr, zs, zv) -> {parts, dz} or null: parts built unscaled beside the scaled vessel
	 * (a pail's ears and bail), and a shift of the whole in z.
	 */
	function roundVessel(ctx, sk, { beads = [], rimBead = 0.0013, extras = () => [], wood = false, margin = 0, skirt = 0, staves = 0, beadAmp = 0.0011, beadW = 0.0045, zScale = null, outside = null } = {}) {
		const P = ctx.props
		const pr = vesselProfiles(P)
		const key = `${f5(pr.W)}|${f5(pr.H)}|${f5(pr.t)}|${f5(pr.Wb)}`
		let outer = pr.outer
		if (skirt > 0) {
			// the bottom of a paper cup is rolled under: a narrow step above the floor, then the wall. Its heights follow the cup's own height up to a 10 cm cup
			// (a 3 cm cup stands on a 2 mm roll, not on a stem), and the step's top stays on the slanted wall
			const rb = pr.Wb / 2
			const k = Math.min(1, pr.H / 0.1)
			outer = [[0, -pr.t], [rb - skirt, -pr.t], [rb - skirt, 0.0035 * k], [rb - skirt * 0.4, 0.0055 * k], [pr.rAt(0.0075 * k), 0.0075 * k], pr.ot]
		}
		// only a wall with beads in it needs points along its length (4 mm apart); a plain cone is straight
		const bk = beadW / 0.0045
		const outerPts = (beads.length ? densify(outer, beads.map((f) => f * pr.H), { step: 0.002 * bk, win: 0.014 * bk }) : outer).map(([r, y]) => {
			// stiffening beads: a smooth ridge of 1 mm out of the wall at each given fraction of the wall's height
			let dr = 0
			for (const f of beads) dr += beadAmp * Math.exp(-Math.pow((y - f * pr.H) / beadW, 2)) * (y > 0 && y < pr.H ? 1 : 0)
			return [r + dr, y]
		})
		const parts = []
		const lt = wood ? { tile: [1.0, 0.125], swap: true } : { tile: [0.25, 0.25] }
		if (staves > 0) parts.push(mesh(staveLathe(`out|${key}`, outerPts, staves, { tile: [1.0, 0.125] }), sk.outer))
		else parts.push(mesh(L.lathe(`vessel|out3|${key}|${beads}|${f5(beadAmp)}|${f5(beadW)}|${wood}|${skirt}`, outerPts, { seg: 80, ...lt, crease: 0.9, seamless: true }), sk.outer))
		parts.push(mesh(L.lathe(`vessel|rim|${key}`, pr.rim, { seg: 96, crease: 0.9 }), sk.rim))
		// the inside: the wall (a lathe), and the floor as its own flat disc with a planar uv (a polar one twists a spangle or a grain into a whirlpool)
		parts.push(mesh(L.lathe(`vessel|in3|${key}|${wood}`, pr.inner.slice(0, 2), { seg: 96, ...lt, crease: 0.9, seamless: true }), sk.inner))
		parts.push(mesh(L.lathe(`vessel|floor3|${key}|${wood}`, pr.inner.slice(1), { seg: 96, crease: 0.9, tile: lt.tile, planar: wood ? [1.0, 0.125] : [0.25, 0.25], off: [0.31, 0.17] }), sk.inner))
		let zv = Math.max(...outerPts.map((p) => p[0]))
		if (rimBead > 0) {
			// the rolled rim: a bead of wire / curl round the top edge, flush with the wall's thickness
			const rr = Math.min(rimBead, pr.t * 0.5, 0.0018)
			const cy = (pr.ot[1] + pr.it[1]) / 2 + 0.0001
			const cr = (pr.ot[0] + pr.it[0]) / 2
			parts.push(put(mesh(kit.torus(cr, rr, 8, 96), sk.rim), 0, cy, 0, PI2, 0, 0))
			zv = Math.max(zv, cr + rr)
		}
		parts.push(...extras(pr))
		if (sk.kind === "glass") {
			// clear glass casts a faint (dithered) shadow, as the glass and ice sheets do, not a solid one
			for (const q of parts) q.traverse((o) => { if (o.isMesh) o.castShadow = false })
			parts.push(L.lightShadow(parts[0].geometry, 0.5))
		}
		const g = group(...parts)
		const zs = zScale ? zScale(pr, zv) : (ctx.d - 2 * margin) / pr.W
		g.scale.z = zs // an oval vessel if the item is deeper or shallower than it is wide
		// hardware that must keep its own shape on an oval vessel (a bail wire stays round, an ear plate keeps its size): built unscaled on the oval wall,
		// beside the scaled vessel; it says how far to shift the whole in z (the vessel and its handle centred in the item's depth)
		const o = outside ? outside(pr, zs, zv) : null
		const top = o ? group(g, ...o.parts) : g
		top.position.set(0, pr.t / 2, o?.dz ?? 0) // the floor's slab is centred half its thickness below the vessel's frame origin
		return top
	}

	// ------------------------------------------------------------- paper vessels: a kraft cup (or tub) with a printed band, a seam and a rolled skirt
	function kraftParams() {
		// kraft paper: an isotropic speckle of fibres (no grain: the sheet's fibres lie every way), tile 0.25 m at 256 px
		const t = bake("kraft3", 256, 256, (u, v, o) => {
			const px = Math.floor(u * 256), py = Math.floor((1 - v) * 256)
			const f = h3(px, py, 301) - 0.5
			const f2 = pn(u, v, 64, 64, 302) - 0.5
			const k = 0.95 + 0.04 * f + 0.03 * f2 + 0.04 * (pfbm(u, v, 3, 3, 303, 3) - 0.5)
			o.r = clamp(196 * k, 0, 255); o.g = clamp(153 * k, 0, 255); o.b = clamp(106 * k, 0, 255)
			o.h = 0.5 + 0.3 * f + 0.3 * f2
			o.rough = 0.75
		}, {
			normal: 0.5, blur: 1,
			paint: (g, W, H) => { // sparse short fibres, 2-4 mm, every way round
				const R = L.rng(311)
				for (let i = 0; i < 520; i++) {
					const x = R() * W, y = R() * H, a = R() * Math.PI, l = 2 + R() * 2.5
					g.strokeStyle = R() < 0.5 ? "rgba(255,240,215,0.2)" : "rgba(95,62,30,0.16)"
					g.lineWidth = 0.7
					g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke()
				}
			},
		})
		return { map: t.map, normalMap: t.normalMap, normalScale: V2(0.1), roughness: 0.75, metalness: 0 }
	}
	function cupSkins(ctx) {
		const look = ctx.solid.look ?? ""
		if (look === "cardboard") {
			// painted (the item's colour prop: its solids' colour): a plain coloured paper cup, no printed band
			if (ctx.solid.color) return { outer: L.cardboardMat(ctx.solid.color), rim: L.cardboardMat(ctx.solid.color), inner: L.plasticMat("#f4f1ea", 0.55), kind: "painted" }
			const outer = M("cup-kraft3", kraftParams())
			return { outer, rim: L.cardboardMat("#d6b78a"), inner: L.plasticMat("#f4f1ea", 0.55), kind: "paper" }
		}
		if (look === "glass") { const g = L.glassMat("#ffffff", { thickness: 0.006, attenuation: "#d2efe0", dist: 0.3 }); return { outer: g, rim: g, inner: g, kind: "glass" } }
		if (look === "aluminium") { const a = L.aluminium(); return { outer: a, rim: L.stainless(), inner: L.stainless(), kind: "metal" } }
		const sk = L.skin(ctx)
		return { outer: sk.side, rim: sk.side, inner: sk.side, kind: /wood/.test(look) ? "wood" : "other" }
	}
	/** The printed band and the glued seam of a paper vessel: parts in the vessel's frame. */
	function paperExtras(pr, tag, { bandFrom = 0.38, bandTo = 0.78, seam = true } = {}) {
		const out = []
		const y0 = pr.H * bandFrom, y1 = pr.H * bandTo
		const rOut = (y) => pr.rAt(y) + 0.00015
		const slant = Math.hypot(rOut(y1) - rOut(y0), y1 - y0)
		const circ = TAU * (rOut(y0) + rOut(y1)) / 2
		// the canvas has the band's own proportions (a dot is round), its height in steps of 4 %: a drag of the size slider reuses a few canvases (about 50 in
		// all; the dots stay round to 2 %) instead of painting a new one every step
		const W = 1024, H = Math.round(64 * Math.pow(1.04, Math.round(Math.log(clamp((W * slant) / circ, 64, 512) / 64) / Math.log(1.04))))
		const band = decalMat(`cup-band2|${tag}|${W}|${H}`, W, H, (g) => {
			g.clearRect(0, 0, W, H)
			g.fillStyle = "#f4efe3"
			g.fillRect(0, 0.08 * H, W, 0.84 * H)
			g.fillStyle = "#3a2a1e"
			g.fillRect(0, 0.08 * H, W, 0.035 * H); g.fillRect(0, 0.885 * H, W, 0.035 * H)
			g.fillStyle = "#b5402a"
			const dotPx = 0.107 * H // the dots are a tenth of the band's height, whatever the vessel's size (the canvas is all they depend on: it is cached by its size)
			const n = Math.max(4, Math.round(W / (3.7 * dotPx)))
			for (let i = 0; i < n; i++) { g.beginPath(); g.arc(((i + 0.5) * W) / n, H / 2, dotPx, 0, TAU); g.fill() }
			g.fillStyle = "rgba(0,0,0,0.2)"
			g.fillRect(0, 0.2 * H, W, 0.012 * H)
		}, { roughness: 0.6 })
		band.side = T.DoubleSide
		const pts = [[rOut(y0), y0], [rOut(y1), y1]]
		out.push(mesh(L.lathe(`cup|band2|${tag}|${f5(pr.W)}|${f5(pr.H)}`, pts, { seg: 96, tile: [circ, slant], crease: 1.5, seamless: false, uniformU: true }), band, { cast: false }))
		if (seam) {
			// the glued overlap: a strip of kraft (6 mm, or 7 % of the radius on a small cup) a hair proud of the wall, below and above the printed band (the print
			// runs over the overlap: across the band only the overlap's edge shows, as a fine shadow line down the whole seam)
			const ys = [0.0075, pr.H - 0.003]
			const rs = (y) => pr.rAt(y) + 0.0002
			const phiS = Math.min(0.006, 0.07 * pr.rAt(pr.H * 0.5)) / pr.rAt(pr.H * 0.5)
			const sm = M("cup-seam", { color: "#c9a26b", roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
			const sh = M("cup-seam-shadow", { color: "#5a4128", roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
			const pieces = [[[ys[0], y0 - 0.0002], sm, 2, phiS, 0], [[y1 + 0.0002, ys[1]], sm, 2, phiS, 0], [ys, sh, 1, 0.0006 / pr.rAt(pr.H * 0.5), 0.00005]]
			for (const [[ya, yb], m, seg, phi, dr] of pieces) {
				if (!(yb - ya > 0.001)) continue
				const g = L.lathe(`cup|seam2|${f5(pr.W)}|${f5(pr.H)}|${f5(pr.t)}|${f5(ya)}|${f5(yb)}|${f5(phi)}`, [[rs(ya) - dr, ya], [rs(yb) - dr, yb]], { seg, tile: 0.1, phi, crease: 1.5 })
				const me = mesh(g, m, { cast: false })
				me.rotation.y = 0.9
				out.push(me)
			}
		}
		return out
	}
	function paperCup(ctx) {
		const sk = cupSkins(ctx)
		const extras = (pr) => (sk.kind === "paper" ? paperExtras(pr, "cup") : [])
		return roundVessel(ctx, sk, { rimBead: ctx.props.thickness * 0.4, extras, wood: sk.kind === "wood", skirt: sk.kind === "paper" ? 0.001 : 0 })
	}
	addModel("cup", "right", null)
	addModel("cup", "left", null)
	addModel("cup", "floor", paperCup)

	// ------------------------------------------------------------- bucket: a galvanised pail (ribs, rolled rim and chime, ears, a wire bail with a grip), a coopered wooden pail, a kraft tub
	/**
	 * The pail's hardware, in proportion to the pail: s = 1 is a 28 cm x 27 cm pail (the default). The ears' height under the rim and the bail's drop follow
	 * s (from the smaller of the pail's height and width: they must fit on its wall); the wire and its grip span the pail's whole width, so they follow sw (from
	 * the width alone), and the ears are big enough to hold that wire (se). All 0.25 .. 2.5; the wire thins out less than that (a toy pail's wire is still a
	 * wire). No handle (hasHandle false) on a pail under 4 cm tall or 5 cm wide (a plain mini pail), on a tray or a shallow tub over four times as wide as it is
	 * tall (those have no bail), on an oval flattened to under a third of its width front to back (no room for the bail in front of it), or on one
	 * drawn out to over 2.5 times its width (a trough: a bail strung along its side is no real thing).
	 * R(y): the radius of the wire's centre at height y: on the wall's outer surface, but never more than 1.8 mm less the wire's radius outside the outline
	 * (a straight-sided pail's wall is the outline: the wire sinks into it there by the difference).
	 */
	function pailHardware(pr, d) {
		const s = clamp(Math.min(pr.H / 0.27, pr.W / 0.28), 0.25, 2.5)
		const sw = clamp(pr.W / 0.28, 0.25, 2.5)
		const hasHandle = pr.H >= 0.04 && pr.W >= 0.05 && pr.W <= 4 * pr.H && d >= 0.35 * pr.W && d <= 2.5 * pr.W
		const wr = 0.0019 * clamp(sw, 0.4, 2) // the bail wire's radius
		const se = clamp(Math.max(s, 0.7 * sw), 0.25, 2.5) // the ears' scale
		const sg = Math.max(sw, (wr + 0.0002) / 0.0026) // the grip's scale: its bore always hides the wire
		const yE = pr.H - 0.022 * se // the ears' centre: their top 7 mm (x se) under the rim
		const xo = pr.ot[0] // the outline's half-width (the wall's outer top corner)
		const R = (y) => Math.min(pr.rAt(y) - 0.0001, xo + 0.0018 - wr)
		// how far the bail hangs below the ears, down the front: the grip at its bottom stays clear of the floor
		const drop = Math.max(0.05 * pr.H, Math.min(clamp(0.6 * (pr.H - 0.045 * s), 0.15 * pr.H, 0.16 * s), yE - 0.0074 * sg - 0.08 * pr.H))
		const yb = yE - drop
		return {
			s, sw, se, sg, hasHandle, wr, yE, drop, R,
			tE: 0.0012 * clamp(se, 0.4, 1), // the ear plate's thickness (with its rivets' heads it stands under 2 mm off the wall)
			Rf: R(yb), // the wire's centre at the bottom of the U (the front)
			cf: 0.0074 * sg, // how far the grip stands out from it: the sleeve's axis 1.6 mm (x sg) out, its barrel 5.8 mm (x sg) round that
		}
	}
	/** A point of the oval wall (radius r at angle th from +x toward +z, the vessel's z scale zs) and the wall's outward normal there. */
	const ovalAt = (r, th, y, zs) => {
		const c = Math.cos(th), sn = Math.sin(th)
		const n = new T.Vector3(zs * c, 0, sn).normalize()
		return { p: new T.Vector3(r * c, y, zs * r * sn), n }
	}
	/**
	 * The bail: a wire U hung from the two ears over the front of the pail, hugging its wall, with a grip at the bottom of the U. Built unscaled on the oval wall
	 * (zs: the vessel's z scale), so the wire and the grip keep round sections whatever the depth. zf: how far the wire and grip reach toward +z.
	 */
	function bailParts(pr, hw, wire, grip, tag, zs) {
		const out = []
		const { wr, yE, drop, se, R } = hw
		const pts = []
		const N = 36
		for (let i = 0; i <= N; i++) {
			const u = (i / N) * Math.PI
			const y = yE - drop * Math.sin(u)
			const { p } = ovalAt(R(y), Math.PI - u, y, zs) // pi: the left ear, pi / 2: the front, 0: the right ear; the wire's centre on the wall's surface
			pts.push([p.x, p.y, p.z])
		}
		const bail = mesh(L.tube(`bail2|${tag}|${f5(pr.W)}|${f5(pr.H)}|${f5(pr.Wb)}|${f5(pr.t)}|${f5(hw.sw)}|${f5(hw.se)}|${f5(drop)}|${f5(zs)}`, pts, wr, { seg: 8, tile: 0.1 }), wire)
		out.push(bail)
		// the hooked ends go in through the ears' holes: from the wall's outer surface (a real bail's hook bends back inside the ear, never through the wall) to inside the ear plate
		const x0 = pr.rAt(yE) + 0.0002, x1 = pr.rAt(yE) + 0.7 * hw.tE
		for (const sx of [-1, 1]) out.push(put(mesh(kit.cylinderY(wr, x1 - x0, 10), wire), sx * (x0 + x1) / 2, yE, 0, 0, 0, PI2))
		// the grip: a turned sleeve on the wire at the bottom of the U (8.6 cm x sw, a slight barrel with rounded ends and two shallow grooves), following the wire's curve
		const gm = mesh(gripGeo(pr, hw, tag, zs), grip)
		out.push(gm)
		return { parts: out, zf: Math.max(...[bail, gm].map((m) => (m.geometry.boundingBox ?? (m.geometry.computeBoundingBox(), m.geometry.boundingBox)).max.z)) }
	}
	/** The grip sleeve: a variable-radius tube swept along the bail wire's own path round the front of the (oval) pail. */
	function gripGeo(pr, hw, tag, zs) {
		const { yE, drop, sw, sg, R } = hw
		return kit.geo(`grip5|${tag}|${f5(pr.W)}|${f5(pr.H)}|${f5(pr.Wb)}|${f5(pr.t)}|${f5(sw)}|${f5(sg)}|${f5(drop)}|${f5(yE)}|${f5(zs)}`, () => {
			const P = (u) => {
				const y = yE - drop * Math.sin(u)
				const { p, n } = ovalAt(R(y), Math.PI - u, y, zs)
				return p.addScaledVector(n, 0.0016 * sg) // the sleeve's axis a little outside the wire's (along the wall's normal): the wire runs through its lower part
			}
			const half = 0.043 * sw
			let uLo = PI2, uHi = PI2, len = 0
			const du = 0.0005
			for (; len < half && uLo > 0.05; uLo -= du) len += P(uLo).distanceTo(P(uLo - du))
			len = 0
			for (; len < half && uHi < Math.PI - 0.05; uHi += du) len += P(uHi).distanceTo(P(uHi + du))
			const sList = [0, 0.003, 0.009, 0.018, 0.03]
			for (let k = 1; k < 24; k++) sList.push(0.03 + (k / 24) * 0.94)
			sList.push(0.97, 0.982, 0.991, 0.997, 1)
			const seg = 20
			const pos = [], uv = [], idx = []
			const Lg = 2 * half
			sList.forEach((sv) => {
				const u = uLo + (uHi - uLo) * sv
				const c = P(u)
				const tg = P(u + 0.002).sub(P(u - 0.002)).normalize()
				const rn = ovalAt(1, Math.PI - u, 0, zs).n
				const n1 = rn.clone().sub(tg.clone().multiplyScalar(rn.dot(tg))).normalize()
				const b = new T.Vector3().crossVectors(tg, n1)
				const cap = sv < 0.03 ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - sv / 0.03, 2))) : sv > 0.97 ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - (1 - sv) / 0.03, 2))) : 1
				let rad = 0.0042 + 0.0016 * Math.pow(Math.sin(Math.PI * sv), 0.5)
				for (const g of [0.27, 0.73]) rad -= 0.0004 * Math.exp(-Math.pow((sv - g) / 0.014, 2))
				rad *= cap * sg
				for (let j = 0; j <= seg; j++) {
					const a = (j / seg) * TAU
					pos.push(c.x + (Math.cos(a) * n1.x + Math.sin(a) * b.x) * rad, c.y + (Math.cos(a) * n1.y + Math.sin(a) * b.y) * rad, c.z + (Math.cos(a) * n1.z + Math.sin(a) * b.z) * rad)
					uv.push(j / seg, (sv * Lg) / 0.1)
				}
			})
			for (let i = 0; i < sList.length - 1; i++) for (let j = 0; j < seg; j++) {
				const a = i * (seg + 1) + j, b2 = a + 1, c2 = a + seg + 1, d = c2 + 1
				idx.push(a, b2, c2, b2, d, c2)
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
			g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2))
			g.setIndex(idx)
			g.computeVertexNormals()
			return g
		})
	}
	/**
	 * An ear plate: a rounded outline 24 x 30 mm (x se) with a hole for the wire and two rivets, lying on the wall at x = +-r (built for +x; the -x one is
	 * mirrored). Unscaled, bent round the oval wall (radius Re at its height, the vessel's z scale zs) so its edges lie on it.
	 */
	function earParts(pr, hw, steel, rivet, zs) {
		const { se: s, yE, tE: t, wr } = hw
		const Re = pr.rAt(yE)
		const geo = kit.geo(`ear5|${f5(t)}|${f5(s)}|${f5(wr)}|${f5(Re)}|${f5(zs)}`, () => {
			const w2 = 0.012 * s, h2 = 0.015 * s, rc = 0.006 * s
			const sh = new T.Shape()
			sh.moveTo(-w2 + rc, -h2)
			sh.lineTo(w2 - rc, -h2)
			sh.absarc(w2 - rc, -h2 + rc, rc, -PI2, 0, false)
			sh.lineTo(w2, h2 - rc)
			sh.absarc(w2 - rc, h2 - rc, rc, 0, PI2, false)
			sh.lineTo(-w2 + rc, h2)
			sh.absarc(-w2 + rc, h2 - rc, rc, PI2, Math.PI, false)
			sh.lineTo(-w2, -h2 + rc)
			sh.absarc(-w2 + rc, -h2 + rc, rc, Math.PI, 1.5 * Math.PI, false)
			const hole = new T.Path()
			hole.absarc(0, 0, Math.max(0.0034 * s, 1.35 * wr), 0, TAU, true) // (always wide enough for the wire)
			sh.holes.push(hole)
			const g = new T.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 10 })
			g.rotateY(-PI2).translate(t, 0, 0) // shape x -> z, extrusion -> +x
			// bent onto the wall: each point moved in x by how far the (oval) wall falls away from its tangent plane at that z. The extrusion's caps are
			// a few long triangles across the plate: they are first cut (each edge halved, every way it is long) until none spans over w2 / 3 in z (a chord
			// then falls under 0.05 mm inside the wall), so the bent plate follows the wall instead of cutting chords into it (an edge two triangles share is
			// cut the same way in both: no cracks)
			const step = w2 / 3
			const P = g.attributes.position.array, U = g.attributes.uv.array
			const op = [], ou = []
			const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2)
			const tri = (a, b, c) => {
				const ab = Math.abs(a[2] - b[2]), bc = Math.abs(b[2] - c[2]), ca = Math.abs(c[2] - a[2])
				const m = Math.max(ab, bc, ca)
				if (m <= step) { for (const q of [a, b, c]) { op.push(q[0], q[1], q[2]); ou.push(q[3], q[4]) } return }
				if (m === ab) { const k = mid(a, b); tri(a, k, c); tri(k, b, c) }
				else if (m === bc) { const k = mid(b, c); tri(a, b, k); tri(a, k, c) }
				else { const k = mid(c, a); tri(a, b, k); tri(k, b, c) }
			}
			const V = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2], U[i * 2], U[i * 2 + 1]]
			for (let i = 0; i < P.length / 3; i += 3) tri(V(i), V(i + 1), V(i + 2))
			for (let i = 0; i < op.length; i += 3) {
				const q = clamp(op[i + 2] / (zs * Re), -1, 1)
				op[i] += Re * (Math.sqrt(1 - q * q) - 1)
			}
			g.dispose()
			const b = new T.BufferGeometry()
			b.setAttribute("position", new T.Float32BufferAttribute(op, 3))
			b.setAttribute("uv", new T.Float32BufferAttribute(ou, 2))
			b.computeVertexNormals()
			return b
		})
		const g = new T.Group()
		g.add(mesh(geo, steel))
		const rr = 0.0016 * clamp(s, 0.4, 1.6), rh = 0.0006 * clamp(s, 0.4, 1)
		for (const dy of [-0.0085 * s, 0.0085 * s]) g.add(domeAt(rr, rh, rivet, t, dy, 0, [1, 0, 0]))
		// lying on the wall: its normal tilts down with the wall's slope; its middle is at the wall's surface
		g.rotation.z = -pr.phi
		g.position.set(Re - 0.0001, yE, 0)
		const out = [g]
		const m = g.clone()
		m.scale.x = -1
		m.position.x = -g.position.x
		out.push(m)
		return out
	}
	function bucket(ctx) {
		const look = ctx.solid.look ?? ""
		const steelPail = look === "steel"
		const alu = look === "aluminium"
		const metal = alu || steelPail
		const wood = /wood/.test(look)
		if (look === "cardboard") {
			// a kraft tub with a printed band, as the cup but with a heavier rolled rim
			const sk = cupSkins(ctx)
			return roundVessel(ctx, sk, { rimBead: ctx.props.thickness * 0.5, extras: (pr) => paperExtras(pr, "tub", { bandFrom: 0.3, bandTo: 0.72 }), skirt: 0.001 })
		}
		let sk
		const wire = M("bail-wire", { color: "#c9ced3", metalness: 1, roughness: 0.3, envMapIntensity: 1.2 })
		const steel = alu ? L.brushedMetal("spunalu", "#d4d8dd", 0.3) : L.brushedMetal("pailear", "#b9bec4", 0.3) // (one baked metal for the whole aluminium pail)
		const rivet = L.stainless()
		// a galvanised pail is spangled zinc; an aluminium one (the default, and what the bounce is computed for) is spun metal, satin, with fine turning lines round it
		if (steelPail) { sk = { outer: L.galvanised(), rim: L.galvanised("#c9ccd0"), inner: L.galvanised("#a9adb2", { contrast: 0.5 }) } }
		else if (alu) { sk = { outer: L.brushedMetal("spunalu", "#d4d8dd", 0.3), rim: L.brushedMetal("spunalu", "#d4d8dd", 0.3), inner: L.brushedMetal("spunalu", "#d4d8dd", 0.3) } }
		else if (wood) { const s = L.woodSet(ctx.color, 2, { varnish: 0.5 }).side; sk = { outer: s, rim: s, inner: s } }
		else { const s = L.skin(ctx).side; sk = { outer: s, rim: s, inner: s } }
		const grip = L.plasticMat("#1b1c1f", 0.35)
		const d = ctx.d
		const hw = pailHardware(vesselProfiles(ctx.props), d)
		const sm = Math.min(1, hw.s) // (the chime and the beads do not grow past a 28 cm pail's)
		const extras = (pr) => {
			const out = []
			if (metal) {
				// a rolled chime at the foot, just inside the outline
				const yc = 0.0042 * sm
				out.push(put(mesh(kit.torus(pr.rAt(yc) - 0.0004 * sm, 0.0021 * sm, 8, 96), sk.rim), 0, yc, 0, PI2, 0, 0))
			}
			if (wood) {
				// two steel hoops, flat bands a hair proud of the staves
				const hh = 0.0065 * hw.s // (half the hoop's width: 13 mm on a 28 cm pail, in proportion to the pail)
				for (const f of [0.17, 0.78]) {
					const y0 = f * pr.H - hh, y1 = f * pr.H + hh
					out.push(mesh(L.lathe(`hoop|${f5(pr.W)}|${f5(pr.H)}|${f}|${f5(hh)}`, [[pr.rAt(y0) + 0.0007, y0], [pr.rAt(y1) + 0.0007, y1]], { seg: 96, tile: 0.1, crease: 1.5 }), L.M("hoop-steel", { color: "#8d9298", metalness: 1, roughness: 0.42, side: T.DoubleSide })))
					out.push(mesh(L.lathe(`hoopedge|${f5(pr.W)}|${f5(pr.H)}|${f}|${f5(hh)}`, [[pr.rAt(y0) + 0.0007, y0], [pr.rAt(y0) + 0.0007, y0 + 0.0002]], { seg: 96, tile: 0.1, crease: 1.5 }), steel))
				}
			}
			return out
		}
		// front to back: the pail and its handle fill the item's depth (an oval when that is not its width). The handle hangs in front: the vessel is scaled so
		// that its back (-zv x zs) to the grip's front (Rf x zs + cf) spans the depth, and the whole is shifted back to centre it (a few mm at most), so the
		// handle never sticks out of the depth and the back never falls short of it
		// (the vessel's reach round its axis: its wall and rim (zv), or the chime at its foot where that stands further out, as on a straight-sided pail)
		const reach = (pr, zv) => (metal ? Math.max(zv, pr.rAt(0.0042 * sm) + 0.0017 * sm) : zv)
		const zScale = (pr, zv0) => {
			const zv = reach(pr, zv0)
			return hw.hasHandle ? Math.min(d / (2 * zv), (d - hw.cf) / (hw.Rf + zv)) : d / (2 * zv)
		}
		const outside = (pr, zs, zv0) => {
			if (!hw.hasHandle) return null
			const zv = reach(pr, zv0)
			const b = bailParts(pr, hw, wire, grip, look, zs)
			const front = Math.max(zs * zv, b.zf)
			return { parts: [...earParts(pr, hw, steel, rivet, zs), ...b.parts], dz: (zs * zv - front) / 2 }
		}
		return roundVessel(ctx, sk, { beads: metal ? [0.28, 0.66] : [], beadAmp: 0.0011 * sm, beadW: 0.0045 * clamp(hw.s, 0.25, 2), rimBead: ctx.props.thickness * 0.45, extras, wood, staves: wood ? Math.max(8, Math.round((TAU * ctx.props.width / 2) / 0.045)) : 0, zScale, outside })
	}
	addModel("bucket", "right", null)
	addModel("bucket", "left", null)
	addModel("bucket", "floor", bucket)

	// ------------------------------------------------------------- basket: a stake-and-strand wicker basket: woven walls, a cane-wrapped rim, closed all round
	const PITCH_S = 0.025 // stake pitch
	const ROW = 0.008 // weaver pitch
	/** A plan path (rounded rectangle W x D, corner radius rc) as points with outward normals and arc length, `step` m apart; at(s) evaluates it anywhere. */
	function planPath(W, D, rc, step) {
		const segs = []
		const hx = W / 2, hz = D / 2
		// counter-clockwise seen from above (+y): start at the middle of the front (+z) edge going toward +x
		const line = (x0, z0, x1, z1, nx, nz) => segs.push({ kind: "line", x0, z0, x1, z1, nx, nz, len: Math.hypot(x1 - x0, z1 - z0) })
		const arcS = (cx, cz, a0, a1) => segs.push({ kind: "arc", cx, cz, a0, a1, len: rc * Math.abs(a1 - a0) })
		line(0, hz, hx - rc, hz, 0, 1)
		arcS(hx - rc, hz - rc, PI2, 0)
		line(hx, hz - rc, hx, -hz + rc, 1, 0)
		arcS(hx - rc, -hz + rc, 0, -PI2)
		line(hx - rc, -hz, -hx + rc, -hz, 0, -1)
		arcS(-hx + rc, -hz + rc, -PI2, -Math.PI)
		line(-hx, -hz + rc, -hx, hz - rc, -1, 0)
		arcS(-hx + rc, hz - rc, Math.PI, PI2)
		line(-hx + rc, hz, 0, hz, 0, 1)
		const perim = segs.reduce((a, s) => a + s.len, 0)
		const on = (seg, f) => {
			if (seg.kind === "line") return { x: mix(seg.x0, seg.x1, f), z: mix(seg.z0, seg.z1, f), nx: seg.nx, nz: seg.nz }
			const a = mix(seg.a0, seg.a1, f)
			return { x: seg.cx + rc * Math.cos(a), z: seg.cz + rc * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) }
		}
		/** The point at arc length s along the path (wrapping), with its outward normal. */
		const at = (s0) => {
			let s = ((s0 % perim) + perim) % perim
			let seg = segs[0]
			for (const q of segs) { if (s <= q.len || q === segs[segs.length - 1]) { seg = q; break } s -= q.len }
			return on(seg, seg.len > 0 ? Math.min(1, s / seg.len) : 0)
		}
		const n = Math.max(24, 2 * Math.round(perim / step / 2)) // an even count (the inner wall takes every other point)
		const pts = []
		for (let i = 0; i < n; i++) pts.push({ ...at((i / n) * perim), s: (i / n) * perim })
		return { pts, perim, n, at, segs }
	}
	/**
	 * The weave as a texture: tile 8 stakes x 8 rows (0.2 x 0.064 m). Plain over-and-under: a weaver passes over one stake and under the next; each strand has its own tone.
	 */
	function weaveMaps(hex) {
		const [r0, g0, b0] = rgb(hex)
		return bake(`wicker3|${hex}`, 1600, 512, (u, v, o) => {
			const x = u * 8, y = v * 8
			const i = Math.floor(x), j = Math.floor(y)
			const fx = x - i, fy = y - j
			const over = (i + j) % 2 === 0 // the weaver of this row passes over this stake
			const stakeW = 0.2 // a stake is 4.5 mm of 25
			const xs = (fx - (0.5 - stakeW / 2)) / stakeW // 0..1 across the stake
			const inStake = xs >= 0 && xs <= 1
			const wy0 = 0.1, wy1 = 0.9 // the weaver fills 6.4 mm of its 8 mm row
			const ys = (fy - wy0) / (wy1 - wy0)
			const inWeaver = ys >= 0 && ys <= 1
			const stakeTint = 0.82 + 0.34 * h3(i, 3, 61) // each stake and each weaver has its own tone
			const weaverTint = 0.82 + 0.34 * h3(j, 5, 62)
			let k = 0.2, h = 0, tint = 1
			const along = pn(u, v, 60, 4, 321) - 0.5 // fibres along a weaver (x)
			const alongS = pn(u, v, 4, 60, 331) - 0.5 // fibres along a stake (y)
			const showWeaver = inWeaver && (over || !inStake)
			const showStake = inStake && !showWeaver
			if (showWeaver) {
				const prof = Math.sin(Math.PI * clamp(ys)) // rounded across its width
				// where it dips under a neighbour it darkens toward the stake
				const dip = over ? 1 : sstep(0, 0.28, Math.abs(fx - 0.5) - stakeW / 2)
				k = (0.55 + 0.5 * prof) * (0.9 + 0.2 * along) * (0.78 + 0.22 * dip)
				h = prof * (over ? 0.9 : 0.5) * (0.6 + 0.4 * dip)
				tint = weaverTint
			} else if (showStake) {
				const prof = Math.sin(Math.PI * clamp(xs))
				k = (0.5 + 0.5 * prof) * (0.9 + 0.2 * alongS) * 0.95
				h = prof * 0.85
				tint = stakeTint
			}
			o.r = clamp(r0 * k * tint, 0, 255)
			o.g = clamp(g0 * k * tint * (1 + 0.04 * (tint - 1)), 0, 255)
			o.b = clamp(b0 * k * tint * 0.97, 0, 255)
			o.h = h
			o.rough = 0.58 + 0.15 * (1 - h)
		}, { normal: 3.4, blur: 1 })
	}
	/** Cane for the wrapped rim (neutral tone, tinted by the colour): fine fibres along the ribbon, its edges rolled darker. Tile 0.05 m along x 6 mm across. */
	function caneMaps() {
		return bake("cane2", 256, 64, (u, v, o) => {
			const px = Math.floor(u * 256), py = Math.floor((1 - v) * 64)
			const fib = pn(u, v, 8, 60, 341) - 0.5
			const fib2 = pn(u, v, 32, 24, 342) - 0.5
			const edge = Math.min(v, 1 - v)
			const round = 0.55 + 0.45 * Math.sin(Math.PI * clamp(edge * 2.4)) // the ribbon is rounded across
			const k = (0.88 + 0.2 * fib + 0.08 * fib2 + 0.04 * (h3(px, py, 343) - 0.5)) * round
			o.r = clamp(255 * k, 0, 255); o.g = clamp(255 * k * 0.985, 0, 255); o.b = clamp(255 * k * 0.96, 0, 255)
			o.h = 0.2 + 0.6 * round + 0.3 * fib
			o.rough = 0.6
		}, { normal: 1.4, blur: 1 })
	}
	function basket(ctx) {
		const P = ctx.props
		const W = P.width, H = P.wall, t = P.thickness, D = ctx.d
		const look = ctx.solid.look ?? ""
		// woven walls (cane) for the woody looks; a sheet material (kraft board, cork board) keeps its own surface and is not woven
		const sheet = look === "cardboard" || look === "cork"
		const sk = sheet ? L.skin(ctx) : null
		// a dark-wood basket is stained cane, a varnished one honey cane; another material keeps its own colour
		const hex = look === "dark wood" ? "#8a5a2e" : look === "varnished hardwood" || look === "wood" ? "#b78443" : ctx.color
		const wm = sheet ? null : weaveMaps(hex)
		const pr = vesselProfiles(P)
		const cph = Math.cos(pr.phi), sph = Math.sin(pr.phi), tanP = pr.tanPhi
		// the plan's corner radius (a look only: the physics has no front or back wall): up to 6 cm, and at least the wall's own plan thickness where the basket is wide enough, so the inner face
		// of a thick wall turns a corner of its own (a wall thicker than the corner is round has a sharp inner corner, not a loop)
		let rc = Math.min(0.06, D / 2 - 0.005, W / 2 - 0.005)
		rc = Math.max(rc, Math.min(t / cph + 0.002, D / 2 - 0.0005, W / 2 - 0.0005))
		const perim0 = 2 * (W - 2 * rc) + 2 * (D - 2 * rc) + TAU * rc
		// a small basket is woven finer (a miniature's stakes, weavers and rim are thinner): its pitches, rim and wrap shrink with it, to a third at the smallest
		const sB = clamp(Math.min(W / 0.08, H / 0.05, D / 0.06), 1 / 3, 1)
		const nTile = Math.max(1, Math.round(perim0 / (0.2 * sB)))
		const tileU = perim0 / nTile
		const pitch = tileU / 8
		const wickerM = sheet ? sk.side : M(`wicker3|${hex}`, { map: wm.map, normalMap: wm.normalMap, normalScale: V2(1.0), roughness: 0.7, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.5, side: T.FrontSide })
		// a thick wall leaning so far that its square-cut top spans more than 45 % of its height, a wall lower than 0.6 of its thickness, or walls so thick that
		// they leave no room inside: no woven wall can lean, wrap and turn its corners there, so the basket is drawn as what the physics is, woven slabs (the
		// floor, the two walls) with upright end boards between the walls where there is room
		if (t * sph > 0.45 * H || H < 0.6 * t || W - (2 * t) / cph < 0.02) return basketBlock(ctx, pr, wickerM, sheet ? sk : null)
		const coreM = M("wicker-core", { color: "#4a3118", roughness: 0.9, metalness: 0 })
		// the walls lean out like the physics walls (the vessel's profile): the two side walls (x) lean by phi, and the plan is scaled in x only with height, so the
		// front and back walls stand upright, exactly the prism the physics has (a ball in the machine plane always finds the room the physics gives it).
		// Everything that depends on the lean is worked out per plan point (`lean`): 0 on the front and back walls, phi on the side walls, in between round the corners.
		const hxN = W / 2
		const scaleAt = (y) => pr.rAt(y) / hxN
		/** The wall's lean at a plan point (outward normal nx, nz of the top outline): slope s of the face along its normal; k = 1 / cos (the plan thickness across a wall t thick). */
		const lean = (p) => { const s = p.nx * (p.x / hxN) * tanP; const k = Math.sqrt(1 + s * s); return { s, k, c: 1 / k, sn: s / k } }
		/** A plan point's place at height y, `rad` m out along the plan's (scaled) normal: the x-scaled outline's normal is (nx / sy, nz). */
		const planXZ = (p, y, rad) => {
			const sy = scaleAt(y)
			const a = p.nx / sy, b = p.nz, l = Math.hypot(a, b)
			return [p.x * sy + (a / l) * rad, p.z + (b / l) * rad]
		}
		const key = `${f5(W)}|${f5(D)}|${f5(H)}|${f5(t)}|${f5(P.bottom_ratio)}|${sheet ? look : "w"}|${f5(sB)}`
		// the rim: a core of cane, wrapped in a ribbon of it; it spans the wall's whole top (as wide as the wall, 8 mm tall or more on a thick one) and hides the weave's last stretch
		const rimA = Math.min(Math.max(0.0025 * sB, t / 2 - 0.0002), Math.max(0.0025 * sB, rc - t / 2 - 0.0005)) // half its width, across the wall (never wider than its own corners are round)
		const rimB = Math.min(Math.max(0.004 * sB, 0.45 * rimA), H * 0.2) // half its height
		const rimTop = 0.0003 // it rises this far over the outline
		const qRim = rimTop - rimB - 0.0003 // the rim's middle, along the wall's own up direction, from the middle of the wall's top edge (the wrapping ribbon adds 0.3 mm on top)
		// per point: the weave runs up to a cut square to the slope (a line 2.2 mm under the rim's middle): the outer face ends at hw, the inner one a little higher (t * sin) where the wall leans
		const hts = (L_) => {
			const yc = H + qRim * L_.c // the rim's middle: the rim section leans with the wall, so its top follows the slab's top edge
			const hw = Math.max(0.01 * sB, yc - Math.min(rimB - 0.0018 * sB, 0.0022 * sB) * L_.c - (t / 2) * L_.sn)
			return { hw, hwIn: hw + t * L_.sn, yBot: L_.s > 1e-9 ? ((t / 2) * (1 - L_.k)) / L_.s : 0, yIn0: (t / 2) * L_.sn, tt: t * L_.k }
		}
		const LX = { s: tanP, k: 1 / cph, c: cph, sn: sph } // a side wall
		const hX = hts(LX)
		const yBot = hX.yBot // where the side walls' outer face meets the floor slab's side
		const Hs = (hX.hw - yBot) / cph // the weave's height along the slope
		const nRows = Math.max(2, Math.round(Hs / (ROW * sB)))
		const rowH = Hs / nRows // the weaver rows fit the wall exactly (8 mm, give or take)
		const parts = []
		// the ripple of the weave: a radial offset (m) at arc length s and height l along the slope, outermost +0.6 mm, deepest -1 mm
		const pp = planPath(W, D, rc, Math.max(pitch / 3, perim0 / 200))
		const N = pp.n
		for (const p of pp.pts) { p.L = lean(p); p.h = hts(p.L) }
		const amp = sheet ? 0 : clamp((pitch / (pp.perim / N) - 1.2) / 1.6) // a coarse grid (a very big basket) cannot carry the over-and-under: the normal map does it
		const rippleScale = (tt) => clamp((tt - 0.0006) / 0.003, 0.15, 1) // the two faces of a thin wall (under 3.6 mm across) must not meet in the dips: the ripple shrinks with the wall
		const ripple = (s, l, ky = 1, tt = t) => {
			if (amp === 0) return 0
			const j = Math.floor(l / rowH)
			const fx = s / pitch - Math.floor(s / pitch), fy = l / rowH - j
			const cs = Math.sin(Math.PI * clamp((fy - 0.1) / 0.8)) // across the weaver
			const hOver = 0.5 + 0.5 * Math.cos(Math.PI * (s / pitch - 0.5 + j)) // 1 where it crosses over a stake, 0 where it goes under
			const stake = Math.exp(-Math.pow((fx - 0.5) / 0.1, 2)) * (1 - hOver) * 0.5
			return sB * rippleScale(tt) * (-0.001 + amp * ky * 0.0016 * clamp(cs * (0.42 + 0.58 * hOver) + stake * 0.45))
		}
		const wallKey = (tag) => `basket|${tag}|${key}`
		const uvS = sheet ? sk.tu : tileU, uvL = sheet ? sk.tu : rowH * 8
		const lOf = (y) => (y - yBot) / cph // the height along the slope, which the weave's rows and its texture follow all round
		// the outer weave and the inner weave: grids of (cols + 1) x (rows + 1) vertices on one set of heights (clamped to each column's own foot and top, so the rows
		// stay level all round); the rows are capped, so any size stays within a budget. The outer face is at the outline; the inner one t inside it, from the physics
		// wall's inner bottom corner (the square-cut foot, (t/2) sin phi over the floor) to the top, bulging into the basket (0.6 mm at most) where its strand is outermost.
		const wallGeo = (inner) => kit.geo(wallKey(inner ? "win4" : "wout4"), () => {
			const ds = inner ? 2 : 1
			const cols = Math.floor(N / ds)
			const cp = Array.from({ length: cols + 1 }, (_, c) => pp.pts[(c * ds) % N])
			const y0s = cp.map((p) => (inner ? p.h.yIn0 : p.h.yBot))
			const yTs = cp.map((p) => Math.max(inner ? p.h.hwIn : p.h.hw, (inner ? p.h.yIn0 : p.h.yBot) + 0.001))
			const yMin = Math.min(...y0s), yMax = Math.max(...yTs)
			const dy0 = inner ? rowH * cph : (rowH * cph) / 2
			// the rows are capped by the grid's quads, not by a fixed number: a big basket stays near 30k triangles (outer wall 7.2k quads, inner 2.4k; the default's 7.2k and 1.8k fit)
			const rows = sheet ? 2 : Math.min(inner ? 45 : 90, Math.max(2, Math.min(Math.round((yMax - yMin) / dy0), Math.floor((inner ? 2400 : 7200) / Math.max(1, cols)))))
			const pos = [], uv = [], idx = []
			const ky = inner ? 1 : clamp((rowH / ((yMax - yMin) / rows / cph) - 0.9) / 1.1) // rows fewer than two to a weaver (a tall basket) cannot carry its ripple: the normal map does
			for (let r = 0; r <= rows; r++) {
				const yg = yMin + (r / rows) * (yMax - yMin)
				for (let c = 0; c <= cols; c++) {
					const p = cp[c]
					const y = clamp(yg, y0s[c], yTs[c])
					const l = lOf(y)
					const s = c === cols ? pp.perim : p.s
					const a = ripple(s, l, ky, p.h.tt) // -1 mm .. +0.6 mm
					const [X, Z] = planXZ(p, y, inner ? -p.h.tt - a : a)
					pos.push(X, y, Z)
					uv.push(s / uvS, l / uvL)
				}
			}
			for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
				const a = r * (cols + 1) + c, b = a + 1, c2 = a + cols + 1, d2 = c2 + 1
				if (inner) idx.push(a, c2, b, b, c2, d2)
				else idx.push(a, b, c2, b, d2, c2)
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
			g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2))
			g.setIndex(idx)
			g.computeVertexNormals()
			return g
		})
		parts.push(mesh(wallGeo(false), wickerM))
		const innerM = sheet ? sk.side : M(`wicker3in|${hex}`, { map: wm.map, normalMap: wm.normalMap, normalScale: V2(1.0), roughness: 0.75, metalness: 0, color: "#d8d0c8", side: T.FrontSide })
		parts.push(mesh(wallGeo(true), innerM))
		// a core wall behind the weave (so no joint ever shows the sky), as tall as the weave, dark: two strips just inside the two faces, leaning with the wall
		const cm = Math.min(0.0013, t * 0.3)
		const coreStrip = (inner) => kit.geo(wallKey(inner ? "coreIn4" : "coreOut4"), () => {
			const pos = [], idx = []
			for (const top of [0, 1]) {
				for (let c = 0; c <= N; c++) {
					const p = pp.pts[c % N]
					const y = top ? (inner ? p.h.hwIn : p.h.hw) - 0.0005 : inner ? p.h.yIn0 : p.h.yBot
					const cmP = Math.min(Math.max(cm, 0.001 * rippleScale(p.h.tt) + 0.00015), p.h.tt / 2 - 0.0002) // (behind the weave's deepest dip on a thin wall)
					const [X, Z] = planXZ(p, y, inner ? -(p.h.tt - cmP) : -cmP)
					pos.push(X, y, Z)
				}
			}
			for (let c = 0; c < N; c++) {
				const a = c, b = a + 1, c2 = a + N + 1, d2 = c2 + 1
				if (inner) idx.push(a, c2, b, b, c2, d2)
				else idx.push(a, b, c2, b, d2, c2)
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
			g.setIndex(idx)
			g.computeVertexNormals()
			return g
		})
		parts.push(mesh(coreStrip(false), coreM, { cast: false }), mesh(coreStrip(true), coreM, { cast: false }))
		// the wall's top, closed: the cut across the weave from the outer face's top to the inner face's top (a thick wall has a real top to it; the rim sits on it)
		const capG = kit.geo(wallKey("cap4"), () => {
			const pos = [], uv = [], idx = []
			for (let c = 0; c <= N; c++) {
				const p = pp.pts[c % N]
				const s = c === N ? pp.perim : p.s
				for (const f of [0, 1]) {
					const y = mix(p.h.hw, p.h.hwIn, f)
					const [X, Z] = planXZ(p, y, mix(-0.0004, -p.h.tt + 0.0004, f))
					pos.push(X, y, Z)
					uv.push(s / uvS, (f * t) / uvL + lOf(p.h.hw) / uvL)
				}
			}
			for (let c = 0; c < N; c++) {
				const a = c * 2, b = a + 1, c2 = a + 2, d2 = c2 + 1
				idx.push(a, c2, b, b, c2, d2)
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
			g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2))
			g.setIndex(idx)
			g.computeVertexNormals()
			return g
		})
		parts.push(mesh(capG, wickerM))
		// the wall's foot: a wall that leans ends square to its slope, so its inner bottom corner stands (t/2) sin phi over the floor and the cut runs down and out to the floor's top
		// (the slab's underside, seen into the small gap between it and the floor when you look in low)
		if (hX.yIn0 > 0.0003) {
			const footG = kit.geo(wallKey("foot4"), () => {
				const pos = [], idx = []
				for (const lo of [0, 1]) {
					for (let c = 0; c <= N; c++) {
						const p = pp.pts[c % N]
						const y = lo ? 0 : p.h.yIn0
						const [X, Z] = planXZ(p, y, lo ? -p.h.tt / 2 : -p.h.tt)
						pos.push(X, y, Z)
					}
				}
				for (let c = 0; c < N; c++) {
					const a = c, b = a + 1, c2 = a + N + 1, d2 = c2 + 1
					idx.push(a, c2, b, b, c2, d2)
				}
				const g = new T.BufferGeometry()
				g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
				g.setIndex(idx)
				g.computeVertexNormals()
				return g
			})
			parts.push(mesh(footG, M("wicker-core-2s", { color: "#4a3118", roughness: 0.9, metalness: 0, side: T.DoubleSide }), { cast: false }))
		}
		// the floor: a plate under the weave (weave texture), its top flush with the wall's foot: the floor slab's width, the full depth (the walls in front and behind stand upright)
		const sf = scaleAt(yBot)
		const floorG = kit.geo(`basket|floor3|${key}`, () => {
			const sh = new T.Shape()
			const qx = rc * sf, qz = rc, hx = hxN * sf, hz = D / 2
			const arcE = (cx, cz, a0, a1) => sh.absellipse(cx, cz, qx, qz, a0, a1, false, 0)
			sh.moveTo(-hx + qx, -hz)
			sh.lineTo(hx - qx, -hz)
			arcE(hx - qx, -hz + qz, -PI2, 0)
			sh.lineTo(hx, hz - qz)
			arcE(hx - qx, hz - qz, 0, PI2)
			sh.lineTo(-hx + qx, hz)
			arcE(-hx + qx, hz - qz, PI2, Math.PI)
			sh.lineTo(-hx, -hz + qz)
			arcE(-hx + qx, -hz + qz, Math.PI, 1.5 * Math.PI)
			const g = new T.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 12 })
			g.rotateX(PI2) // shape y -> z, extrusion -> -y
			const pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal
			const tu = sheet ? sk.tu : 0.2, tv = sheet ? sk.tu : 0.064
			// the cap (the weave seen from above) is planar; the floor's edge reads as the weave too, running round it
			for (let i = 0; i < pos.count; i++) {
				if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, pos.getX(i) / tu, pos.getZ(i) / tv)
				else uv.setXY(i, (pos.getX(i) + pos.getZ(i)) / tu, pos.getY(i) / tv)
			}
			uv.needsUpdate = true
			return g
		})
		parts.push(mesh(floorG, wickerM))
		// the rim: a core of cane (an oval section, rimA across the wall and rimB up, both tilted with the wall), centred over the wall's top edge, following the plan path; wrapped in a ribbon of cane
		// (across = a = (n cos, -up sin), up = b = (n sin, up cos) in the plane through the plan normal n and the vertical; the tilt is the wall's own at each point: none on the front and back)
		const cm2 = sheet ? null : caneMaps()
		const coreRimM = sheet ? sk.side : M(`canecore|${hex}`, { color: L.tone(hex, 0.5), roughness: 0.8, metalness: 0 })
		const rimAt = (p, A, B) => {
			const L_ = p.L ?? lean(p)
			const o = -t / 2 + qRim * L_.sn + A * L_.c + B * L_.sn // (along the plan normal, outward +)
			return [p.x + p.nx * o, H + qRim * L_.c - A * L_.sn + B * L_.c, p.z + p.nz * o]
		}
		// the rim's section: an ellipse on a thin wall, a squarer and squarer rounded bar as the wall thickens (a thick wall's top is wide and flat: it reaches the slab's corners)
		const seN = 2 + 6 * clamp((rimA - 0.0055) / 0.015)
		const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e)
		/** The section at angle th for half-sizes a (across) and b (up): its point (A, B) and its unit normal (nA, nB). */
		const sect = (th, a, b) => {
			const ca = Math.cos(th), sa = Math.sin(th), e = 2 / seN
			const nA = spow(ca, e * (seN - 1)) / a, nB = spow(sa, e * (seN - 1)) / b, nl = Math.hypot(nA, nB) || 1
			return [a * spow(ca, e), b * spow(sa, e), nA / nl, nB / nl]
		}
		const NR = rimA > 0.008 ? 16 : 14
		const rimCore = kit.geo(`basket|rimcore3|${key}`, () => {
			// samples: the two ends of every straight run, and a ring every ~4 degrees round every corner
			const ss = [0]
			let sAcc = 0
			for (const q of pp.segs) {
				const m = q.kind === "arc" ? Math.max(2, Math.round(Math.abs(q.a1 - q.a0) / 0.07)) : 1
				for (let i = 1; i <= m; i++) ss.push(sAcc + (q.len * i) / m)
				sAcc += q.len
			}
			const pos = [], nor = [], uv = [], idx = []
			for (const s of ss) {
				const p = pp.at(s)
				const L_ = lean(p)
				p.L = L_
				for (let j = 0; j <= NR; j++) {
					const [pa, pb, A, B] = sect((j / NR) * TAU, rimA, rimB)
					pos.push(...rimAt(p, pa, pb))
					nor.push(p.nx * (A * L_.c + B * L_.sn), -A * L_.sn + B * L_.c, p.nz * (A * L_.c + B * L_.sn))
					uv.push(s / 0.05, j / NR)
				}
			}
			for (let i = 0; i < ss.length - 1; i++) for (let j = 0; j < NR; j++) {
				const a = i * (NR + 1) + j, b = a + 1, c = a + NR + 1, d = c + 1
				idx.push(a, c, b, b, c, d)
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
			g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3))
			g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2))
			g.setIndex(idx)
			return g
		})
		parts.push(mesh(rimCore, coreRimM))
		// the wrapping: one flat ribbon of cane winding round the core in a tight spiral (about 55 degrees to the rim's length, each turn a hair under touching the last);
		// a wide rim takes a wider ribbon and more facets to a turn
		if (!sheet) {
			const rimWrap = kit.geo(`basket|rimwrap3|${key}`, () => {
				const Pw = Math.max(0.0058 * sB, pp.perim / 400, 0.66 * (rimA + rimB)) // the spiral's pitch along the rim: the ribbon is 85% of it
				const ws = 0.85 * Pw
				const per = Math.max(6, Math.min(clamp(Math.round((10 * (rimA + rimB)) / 0.0088), 10, 28), Math.floor((3000 * Pw) / pp.perim))) // facets to a turn (at most 3000 facets in all)
				const ds = Pw / per
				const n = Math.round(pp.perim / ds)
				const e = 0.0003
				const pos = [], uv = [], idx = []
				const nor = []
				let len = 0
				for (let i = 0; i <= n; i++) {
					const s = i * ds
					const [pa, pb, na, nb] = sect((TAU * s) / Pw, rimA + e, rimB + e)
					const q = (sv) => {
						const p = pp.at(sv)
						p.L = lean(p)
						return [...rimAt(p, pa, pb), p]
					}
					const A = q(s), B = q(s + ws)
					if (i > 0) len += Math.hypot(pos[pos.length - 6] - A[0], pos[pos.length - 5] - A[1], pos[pos.length - 4] - A[2]) // (along edge A)
					pos.push(A[0], A[1], A[2], B[0], B[1], B[2])
					for (const pq of [A[3], B[3]]) nor.push(pq.nx * (na * pq.L.c + nb * pq.L.sn), -na * pq.L.sn + nb * pq.L.c, pq.nz * (na * pq.L.c + nb * pq.L.sn))
					uv.push(len / 0.05, 0, len / 0.05, 1)
				}
				for (let i = 0; i < n; i++) {
					const a = 2 * i, b = a + 1, c = a + 2, d = a + 3
					idx.push(a, b, c, b, d, c)
				}
				const g = new T.BufferGeometry()
				g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
				g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3))
				g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2))
				g.setIndex(idx)
				return g
			})
			const wrapM = M(`canewrap|${hex}`, { color: hex, map: cm2.map, normalMap: cm2.normalMap, normalScale: V2(0.8), roughness: 0.55, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4, side: T.DoubleSide })
			parts.push(mesh(rimWrap, wrapM))
		}
		const g = group(...parts)
		g.position.y = t / 2 // the floor's slab is centred half its thickness below the item's origin
		// (the floor plate's top is at y = 0 in the basket's frame; the wall stands on it)
		return g
	}
	/** An extreme basket (walls low and thick, or no room between them): the floor slab and the two leaning wall slabs of the physics as woven boards, and an end board front and back. */
	function basketBlock(ctx, pr, wickerM, sheet) {
		const { W, H, t, Wb, phi } = pr
		const D = ctx.d
		const run = (W - Wb) / 2, Lw = Math.hypot(run, H)
		const r = Math.min(0.0015, t * 0.2, H * 0.2)
		const tl = sheet ? [sheet.tu, sheet.tu] : [0.2, 0.064] // the weave: 8 stakes to 20 cm, 8 rows to 6.4 cm
		const uvW = { ty: [tl[1], tl[0]], tz: [tl[0], tl[1]], tx: [tl[0], tl[1]], off: { x: [0.3, 0.1], y: [0.2, 0.4], z: [0.1, 0.3] } }
		const parts = [put(mesh(L.rbox(Wb, t, D, r, { ty: tl, tz: tl, tx: tl, off: { y: [0.5, 0.5] } }), wickerM), 0, -t / 2, 0)]
		for (const side of [-1, 1]) parts.push(put(mesh(L.rbox(t, Lw, D, r, uvW), wickerM), side * ((Wb - t) / 2 + run / 2), H / 2, 0, 0, 0, -side * phi))
		// the end boards: the room between the walls' inner faces (from the floor up to the walls' inner top corners), lapping a quarter of the wall's thickness into each
		const xj = pr.inner[1][0], [xt, yt] = pr.it
		const tz = Math.min(t, D / 4)
		const bev = Math.min(0.001, tz * 0.2) // (an extrusion's bevel grows its outline by this much: the board is drawn that much inside the room)
		const yTop = yt - Math.max(r, bev) // (its top under the walls' rounded inner top corners)
		if (xj > 0.004 && xt > 0.004 && yTop > 0.004) {
			const lap = (t / 4) / Math.cos(phi) - bev
			const xT = xj + ((xt - xj) * yTop) / yt
			const pts = [[-xj - lap, bev], [xj + lap, bev], [xT + lap, yTop], [-xT - lap, yTop]]
			const g = L.extrudeUV(`basketend|${f5(xj)}|${f5(xT)}|${f5(yTop)}|${f5(lap)}|${sheet ? "s" : "w"}`, pts, tz, { tz: tl, ty: [tl[0], tl[0]], tx: tl, bevel: bev, off: { z: [0.37, 0.21] } })
			for (const sz of [-1, 1]) parts.push(put(mesh(g, wickerM), 0, 0, sz * (D / 2 - tz / 2)))
		}
		const g = group(...parts)
		g.position.y = t / 2 // (the floor part's frame: see basket)
		return g
	}
	addModel("basket", "right", null)
	addModel("basket", "left", null)
	addModel("basket", "floor", basket)
}
