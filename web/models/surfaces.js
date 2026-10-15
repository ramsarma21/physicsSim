// 3D models for the surfaces catalog group (see web/models3d.js for the frame and the kit; helpers in surfaces-lib.js).
// Items: plank, steel-beam, ice-sheet, glass-sheet, rubber-mat, carpet-strip, concrete-slab, peg, peg-board, bumper, funnel, staircase.
// Every model fills its physics outline (side view, x = width, y = height, z = front to back) to within a millimetre or two; the
// textures are at true scale (a tile is a fixed number of metres), so resizing an item never stretches the grain or the pebbles.
// Scenery behind the part's z range (the plywood a peg or a bumper is set in, the peg board's panel) is render-only: it never collides.
import { makeLib } from "./surfaces-lib.js"

export default function register({ addModel, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const { T, TAU, M, V2, clamp, sstep, h3, rng, pn, pfbm, rgb, tone, f5, bake, withRepeat, rbox, faces, mesh, put, decalMat, decalPlane } = L
	const group = (...c) => kit.group(...c)
	const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"

	const board = L.board

	// ------------------------------------------------------------- plank
	addModel("plank", "plank", (ctx) => {
		const { w, h, d } = ctx
		let sk = L.skin(ctx, { seed: 1 })
		if (sk.kind === "wood") sk = { ...sk, tu: L.grainTile(w, sk.tu) } // (a plank over 1 m long: its grain tile as long as it, so its figure and knot come once)
		const u0 = w / 2 / sk.tu
		// the end faces get an offset in x too: their uv stay inside one tile, so the end grain is one set of arcs round the off-board pith
		const r = Math.min(0.0006, h * 0.2)
		const off = { y: [u0, 0.5], z: [u0, 0.09], x: [0.5, 0.5] }
		if (sk.kind === "wood" && d > L.GLUE_OVER) {
			// wider than a plank comes (over 20 cm): an edge-glued panel of boards, each its own stretch of the grain and its own shade
			return group(...L.gluedCuts(d).map(({ c, s, i }) => {
				const bs = L.boardSkin(ctx.color, 1, i)
				return put(mesh(rbox(w, h, s, Math.min(r, L.GLUE_R), L.boardUV(sk, i, 0, off)), faces(bs.side, bs.end)), 0, 0, c)
			}))
		}
		const g = rbox(w, h, d, r, { tu: sk.tu, tv: sk.tv, te: sk.te, ty: sk.ty, tz: sk.tz, tx: sk.tx, off, fit: sk.kind === "wood" })
		return group(mesh(g, faces(sk.side, sk.end)))
	})

	// ------------------------------------------------------------- steel beam: a hot-rolled flat bar, sawn ends, paint marks
	/**
	 * The mill's paint band: a ragged brush mark (alpha chips, bristle streaks, brushed-out ends). One tile, baked once whatever the bar's size: u runs
	 * across the band (its ragged edges at u = 0 and 1, not repeated), v round the bar, repeating (the noise is periodic in v), the tile 4 times as long
	 * round the bar as it is wide (W x H px: a tile H / W times as long as wide). fine > 1: every feature that many times finer (the dab on a sawn end, which
	 * spans the bar's whole depth).
	 */
	function bandTex(seed, fine = 1, W = 256, H = 1024) {
		const t = kit.tex(`sf|bandpaint2|${seed}|${fine}|${W}|${H}`, W, H, (g) => {
			const img = g.createImageData(W, H)
			const P = (fx, fy, s) => L.pnTab(fx * fine, Math.round((fy * fine * H) / (4 * W)), s) // (round features whatever the tile's proportions)
			const nRag = P(12, 60, seed), nRag2 = P(40, 135, seed + 1), nChip2 = P(60, 90, seed + 3), nScr = P(3, 180, seed + 4), nStr = P(4, 165, seed + 5), nStr2 = P(30, 45, seed + 6)
			const nC = [0, 1, 2].map((o) => P(9 << o, 14 << o, seed + 2 + o * 17)) // pfbm(u, v, 9, 14, seed + 2, 3), its lattices made once
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const u = x / W, v = 1 - (y + 0.5) / H
				const endd = Math.min(u, 1 - u) * fine
				const rag = nRag(u, v) - 0.5 // ragged brushed ends: bristle-wide fingers
				const rag2 = nRag2(u, v) - 0.5
				let a = clamp((endd - 0.08) / 0.1 + 1.4 * rag + 0.6 * rag2 + 0.35, 0, 1)
				const chip = (nC[0](u, v) + 0.5 * nC[1](u, v) + 0.25 * nC[2](u, v)) / 1.75 + 0.25 * (nChip2(u, v) - 0.5)
				if (chip > 0.7) a *= 1 - sstep(0.7, 0.76, chip) // worn right through to the steel
				if (nScr(u, v) > 0.9) a *= 0.5
				a = clamp(a * 1.1 - 0.05)
				const k = 0.93 + 0.14 * (nStr(u, v) - 0.5) + 0.06 * (nStr2(u, v) - 0.5) // streaks along the bristles
				const i = (y * W + x) * 4
				img.data[i] = clamp(226 * k, 0, 255); img.data[i + 1] = clamp(154 * k, 0, 255); img.data[i + 2] = clamp(2 * k + 8, 0, 255)
				img.data[i + 3] = a > 0.45 ? 255 : Math.round(a / 0.45 * 255)
			}
			g.putImageData(img, 0, 0)
		}, { wrap: false })
		t.wrapT = T.RepeatWrapping // (u stays clamped: the band's ragged edges)
		return t
	}
	/**
	 * The paint band's shell (a rounded box bw x h x d, corner radius r): its uv runs continuously round the bar (v = the distance round its rounded section
	 * / the tile, a whole number of tiles round it, so the paint has no seam at an arris), u across the band. Only this geometry depends on the size.
	 */
	function bandShell(bw, h, d, r, tile) {
		const rr = Math.max(1e-5, Math.min(r, bw / 2 - 1e-6, h / 2 - 1e-6, d / 2 - 1e-6))
		return kit.geo(`beamband|${f5(bw)}|${f5(h)}|${f5(d)}|${f5(rr)}|${f5(tile)}`, () => {
			const g = rbox(bw, h, d, rr, { seg: 3 }).clone()
			const pos = g.attributes.position, uv = g.attributes.uv
			const a = d / 2 - rr, b = h / 2 - rr
			const q = (rr * Math.PI) / 4
			const P = 4 * a + 4 * b + 8 * q
			const T0 = P / Math.max(1, Math.round(P / tile))
			const e = 1e-7
			for (const grp of g.groups) {
				const back = grp.materialIndex === 5 // the -z face: the closing stretch of the loop (from the bottom-back arris up to the top-back one)
				for (let i = grp.start; i < grp.start + grp.count; i++) {
					const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
					const cz = clamp(z, -a, a), cy = clamp(y, -b, b), dz = z - cz, dy = y - cy
					let sv
					if (Math.abs(dz) <= e && Math.abs(dy) <= e) sv = q + (z + a) // (inside the section: an end face's middle, hidden in the bar)
					else if (Math.abs(dz) <= e) sv = dy > 0 ? q + (z + a) : 5 * q + 2 * a + 2 * b + (a - z) // the top / the bottom
					else if (Math.abs(dy) <= e) sv = dz > 0 ? 3 * q + 2 * a + (b - y) : 7 * q + 4 * a + 2 * b + (y + b) // the front / the back
					else {
						const f = Math.atan2(dy, dz) // 0: toward the front, pi / 2: up
						if (dz > 0 && dy > 0) sv = q + 2 * a + rr * (Math.PI / 2 - f)
						else if (dz > 0) sv = 3 * q + 2 * a + 2 * b - rr * f
						else if (dy < 0) sv = 5 * q + 4 * a + 2 * b + rr * (-Math.PI / 2 - f)
						else sv = back ? P - rr * (f - 0.75 * Math.PI) : rr * (0.75 * Math.PI - f) // the top-back arris: split between the loop's two ends
					}
					uv.setXY(i, x / bw + 0.5, sv / T0)
				}
			}
			uv.needsUpdate = true
			return g
		})
	}
	/** Size-bucketed canvas height (steps of 4 %, 16 .. 1024 px): a slider drag reuses a few canvases instead of painting one per step. */
	const bucketPx = (hpx) => Math.round(16 * Math.pow(1.04, Math.round(Math.log(clamp(hpx, 16, 1024) / 16) / Math.log(1.04))))
	function paintDecals(ctx, parts) {
		const { w, h, d } = ctx
		const r = Math.min(0.0025, h * 0.15, d * 0.15)
		const mm = (v) => Math.round(v * 1000)
		// grade stencil along the top face (reads from the front and above)
		if (w >= 0.35 && d >= 0.05) {
			const txt = `S355JR  ${mm(h)} x ${mm(d)}  HOT ROLLED`
			const tw = Math.min(w * 0.45, 0.3)
			const th = Math.min(d * 0.2, 0.012)
			const W = 1536, H = bucketPx((W * th) / tw)
			const m = decalMat(`beam-stencil|${txt}|${W}|${H}`, W, H, (g) => {
				g.clearRect(0, 0, W, H)
				g.fillStyle = "rgba(236,234,226,0.94)"
				g.font = `700 ${Math.round(H * 0.8)}px ${SANS}`
				g.textBaseline = "middle"
				g.textAlign = "left"
				g.fillText(txt, 0, H * 0.52)
				// worn paint: scratches and specks knocked out
				const R = rng(7)
				g.globalCompositeOperation = "destination-out"
				for (let i = 0; i < 90; i++) { g.globalAlpha = 0.25 + 0.4 * R(); g.fillRect(R() * W, R() * H, 2 + R() * 12, 1 + R() * 3) }
				g.globalAlpha = 1
				g.globalCompositeOperation = "source-over"
			})
			parts.push(put(decalPlane(tw, th, m), -w / 2 + 0.06 + tw / 2, h / 2 + 0.00012, 0, -Math.PI / 2, 0, 0))
		}
		// the mill's colour code: a band of paint brushed round the bar near the right end (a thin shell that wraps the arrises) and on the sawn end itself
		if (w >= 0.2) {
			const bw = Math.min(0.03, w * 0.08)
			const bx = w / 2 - 0.035 - bw / 2
			const e = 0.0003
			const paint = M("beam-band2", { map: bandTex(2101), color: "#ffffff", roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
			const m = mesh(bandShell(bw, h + 2 * e, d + 2 * e, r + e, 4 * bw), paint, { cast: false })
			m.position.x = bx
			m.renderOrder = 3
			parts.push(m)
			// the painted end of the bar: a dab of the same yellow on the right-hand sawn face (u across the depth: its ragged edges at the front and back),
			// its chips and streaks the band's size
			const ep = M("beam-endpaint2", { map: bandTex(2121, 2, 256, 512), roughness: 0.5, metalness: 0, clearcoat: 0.25, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
			const pw = d - 2 * r, ph = h - 2 * r
			const pg = kit.geo(`beamendp|${f5(pw)}|${f5(ph)}`, () => {
				const g = new T.PlaneGeometry(pw, ph)
				const uv = g.attributes.uv
				for (let i = 0; i < uv.count; i++) uv.setY(i, ((uv.getY(i) - 0.5) * ph) / (2 * pw) + 0.5) // the same paint, at the same scale across as up
				return g
			})
			const pm = mesh(pg, ep, { cast: false })
			pm.receiveShadow = true
			parts.push(put(pm, w / 2 + 0.00012, 0, 0, 0, PI2, 0))
		}
	}
	const PI2 = Math.PI / 2
	addModel("steel-beam", "slab", (ctx) => {
		const { w, h, d } = ctx
		if (ctx.solid.look !== "steel") return board(ctx, { r: Math.min(0.0025, h * 0.15, d * 0.15) })
		const r = Math.min(0.0025, h * 0.15, d * 0.15)
		const g = rbox(w, h, d, r, { seg: 3, tu: 0.4, tv: 0.4, te: 0.1, off: { y: [0.1, 0.2], z: [0.35, 0.6], x: [0.2, 0.3] } })
		const parts = [mesh(g, faces(L.millSteel(), L.sawnEnd()))]
		paintDecals(ctx, parts)
		return group(...parts)
	})

	// ------------------------------------------------------------- concrete slab: cast concrete, bug holes, form-board lines, worn arrises
	addModel("concrete-slab", "slab", (ctx) => {
		const { w, h, d } = ctx
		if (ctx.solid.look !== "concrete") return board(ctx, { r: Math.min(0.0025, h * 0.1, d * 0.1) })
		const c = L.concrete()
		const g = rbox(w, h, d, Math.min(0.0028, h * 0.1, d * 0.1), { seg: 3, tu: 0.3, tv: 0.3, te: 0.3, off: { y: [0.0, 0.0], z: [0.4, 0.2], x: [0.7, 0.1] } })
		return group(mesh(g, c))
	})

	/**
	 * The plywood a carpet or a rubber mat is glued to when it is raised as a ramp (it would sag otherwise): the lowest `tb` of the slab, the full length and
	 * width, its layered plies showing on the edges and ends. The total thickness is the physics thickness, so the outline does not change.
	 */
	const backingBoard = (w, tb, d, yc) => {
		const pm = L.plyMats("#dcc190", tb)
		// the plies run across the thickness (uv v = y / tb: nine plies exactly fill it), the veneer's grain along the length
		const g = rbox(w, tb, d, Math.min(0.0004, tb * 0.2), { seg: 1, tx: [0.1, tb], tz: [0.1, tb], ty: [0.5, 0.25], off: { x: [0.3, 0.5], y: [0.2, 0.4], z: [0.1, 0.5] } })
		return put(mesh(g, [pm.edgeY, pm.edgeY, pm.face, pm.face, pm.edgeY, pm.edgeY]), 0, yc, 0)
	}
	// ------------------------------------------------------------- rubber mat: black, ribbed across its length, glued to a plywood board
	addModel("rubber-mat", "slab", (ctx) => {
		const { w, h: hAll, d } = ctx
		if (ctx.solid.look !== "rubber mat") return board(ctx, { r: 0.001 })
		const tb = Math.min(0.0035, 0.3 * hAll) // the board under the rubber
		const h = hAll - tb // the rubber's own thickness: the lower `tb` of the slab is the board
		const lip = Math.min(0.001, h * 0.1) // the ribs rise this far to the physics outline; the grooves between them are this deep
		const pitch = 0.012
		const top = hAll / 2, g0 = top - lip, bot = -hAll / 2 + tb
		const c = Math.min(0.001, h * 0.2) // the end edges are chamfered 1 mm at 45 degrees
		const n = Math.max(1, Math.floor((w - 0.02) / pitch))
		const margin = (w - n * pitch) / 2
		const pts = [[-w / 2 + c, bot], [w / 2 - c, bot], [w / 2, bot + c], [w / 2, top - c], [w / 2 - c, top]]
		let x = w / 2 - margin
		const gw = 0.0042, sl = 0.0007
		for (let i = 0; i < n; i++) {
			// right to left: a groove (sloped sides, a flat floor), then the flat top of the next rib
			pts.push([x, top], [x - sl, g0], [x - gw + sl, g0], [x - gw, top])
			x -= pitch
		}
		pts.push([-w / 2 + c, top], [-w / 2, top - c], [-w / 2, bot + c])
		const geom = kit.geo(`ribmat3|${f5(w)}|${f5(h)}|${f5(d)}`, () => {
			const g = L.extrudeXY(`ribmat3|${f5(w)}|${f5(h)}`, pts, d).clone()
			const col = new Float32Array(g.attributes.position.count * 3)
			for (let i = 0; i < g.attributes.position.count; i++) {
				const y = g.attributes.position.getY(i)
				const k = y >= top - 1e-6 ? 1 : y > bot + h * 0.5 ? 0.62 + 0.38 * clamp((y - g0) / lip) : 1 // (the groove floors darken)
				col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k
			}
			g.setAttribute("color", new T.BufferAttribute(col, 3))
			return g
		})
		// black, matte: a faint sheen in its own dark tone, and a fine grain in the normal map so the rib tops are not a flat grey
		const rub = L.rubber("#18191b", 1 / 0.1, { vertexColors: true, roughness: 0.85, sheen: 0.12, sheenColor: new T.Color("#2a2c2f"), normalScale: V2(0.8) })
		return group(mesh(geom, rub), backingBoard(w, tb, d, -hAll / 2 + tb / 2))
	})

	// ------------------------------------------------------------- carpet strip: cut pile on a jute backing, serged bindings on the long edges
	/** The cut edge: a 2.5 mm woven jute / latex backing under the pile's standing tufts (tile 0.04 m across, one strip height up). */
	function carpetEdge(hex, h) {
		const [r0, g0, b0] = rgb(hex)
		// the backing's share of the edge, in half-octave steps (the jute is 2.5 mm give or take 17%; one texture for every strip under 5 mm): a thickness slider step bakes a new
		// 512 x 512 texture only when it crosses a step (about ten across the slider's range), and the material is keyed by the texture, so a step inside one shares everything
		const bk = Math.min(0.5, Math.pow(2, Math.round(Math.log2(0.0025 / h) * 2) / 2))
		return bake(`carpetedge3|${hex}|${bk.toFixed(4)}`, 512, 512, (u, v, o) => {
			if (v < bk) {
				// jute: over-under threads about 0.6 mm
				const cx = u * 66, cy = (v / bk) * 4
				const wx = Math.floor(cx), wy = Math.floor(cy)
				const over = (wx + wy) & 1
				const a = over ? 0.5 + 0.5 * Math.cos(TAU * (cx - wx)) : 0.5 + 0.5 * Math.cos(TAU * (cy - wy))
				const k = 0.72 + 0.32 * a + 0.1 * (pn(u, v, 90, 40, 181) - 0.5) + 0.06 * (h3(wx, wy, 5) - 0.5)
				o.r = 190 * k; o.g = 160 * k; o.b = 104 * k
				o.h = 0.4 + 0.5 * a
			} else if (v < bk + 0.035) {
				o.r = 224; o.g = 218; o.b = 200 // the latex line
				o.h = 0.45
			} else {
				const lane = u * 57
				const i = Math.floor(lane), f = lane - i
				const prof = Math.pow(Math.sin(Math.PI * f), 0.6)
				const vv = (v - bk) / (1 - bk)
				const tuft = h3(i, Math.floor(vv * 5), 33)
				const k = (0.52 + 0.4 * vv) * (0.62 + 0.38 * prof) * (0.86 + 0.28 * tuft) * (0.9 + 0.2 * (pn(u, v, 120, 40, 183) - 0.5))
				o.r = clamp(r0 * k, 0, 255); o.g = clamp(g0 * k, 0, 255); o.b = clamp(b0 * k, 0, 255)
				o.h = 0.3 + 0.7 * prof * (0.7 + 0.3 * tuft)
			}
			o.rough = 1
		}, { normal: 1.4 })
	}
	/**
	 * The serged binding of a runner's long edge, a woven tape sewn round the edge (neutral tone, tinted by the material's colour): overlock threads
	 * running across it at a slant, a finished edge on the pile side and one row of stitches. Tile 0.05 m along the strip x 0.03 m across the band.
	 */
	function bindingMaps() {
		return bake("binding2", 512, 256, (u, v, o) => {
			const p = u * 31 + v * 14 // a thread every 1.6 mm along the strip, leaning across the band
			const f = p - Math.floor(p)
			const th = 0.5 + 0.5 * Math.cos(TAU * f)
			const tone = 0.8 + 0.1 * (h3(Math.floor(p), Math.floor(v * 3), 17) - 0.5)
			let k = (0.66 + 0.34 * th) * tone * (0.94 + 0.12 * (pn(u, v, 200, 90, 221) - 0.5))
			let hh = 0.25 + 0.6 * th
			// the finished edge on the pile side: a tight rolled hem
			if (v > 0.965) { k *= 0.78; hh *= 0.7 }
			// one row of stitches 4 mm in: a lighter thread laid in dashes of 3 mm with needle holes between
			const row = Math.abs(v - 0.87) < 0.022
			if (row) {
				const dash = (u * 16.7) % 1 < 0.7
				if (dash) { k = 1.12; hh = 0.9 } else { k *= 0.5; hh = 0.05 }
			}
			o.r = o.g = o.b = clamp(255 * k, 0, 255)
			o.h = hh
			o.rough = 1
		}, { normal: 1.6, blur: 0 })
	}
	/** The binding of one long edge: a strip swept along x, over the top (bw wide), round the arris (radius r) and down the side, offset 0.15 mm off the pile's body. */
	function bindingGeo(w, h, d, r, bw, side) {
		return kit.geo(`carpetbind2|${f5(w)}|${f5(h)}|${f5(d)}|${f5(r)}|${f5(bw)}|${side}`, () => {
			const e = 0.00015
			const rr = r + e
			const zc = d / 2 - r, yt = h / 2 - r, yb = -h / 2 + r
			const pr = [[d / 2 - bw, h / 2 + e, 0, 1], [zc, h / 2 + e, 0, 1]] // [z, y, nz, ny]
			const n1 = 5
			for (let i = 1; i <= n1; i++) { const a = PI2 - (i / n1) * PI2; pr.push([zc + rr * Math.cos(a), yt + rr * Math.sin(a), Math.cos(a), Math.sin(a)]) }
			for (let i = 0; i <= n1; i++) { const a = -(i / n1) * PI2; pr.push([zc + rr * Math.cos(a), yb + rr * Math.sin(a), Math.cos(a), Math.sin(a)]) }
			pr.push([zc - 0.004, -h / 2 - e, 0, -1])
			const x0 = -(w / 2 - r), x1 = w / 2 - r
			const pos = [], nor = [], uv = [], idx = []
			let arc = 0
			for (let k = 0; k < pr.length; k++) {
				if (k > 0) arc += Math.hypot(pr[k][0] - pr[k - 1][0], pr[k][1] - pr[k - 1][1])
				for (const x of [x0, x1]) {
					pos.push(x, pr[k][1], side * pr[k][0])
					nor.push(0, pr[k][3], side * pr[k][2])
					uv.push(x / 0.05 + 0.3, 1 - arc / 0.03) // v = 1 at the pile side's finished edge, running down the band
				}
			}
			for (let k = 0; k < pr.length - 1; k++) {
				const a = 2 * k, b = a + 1, c = a + 2, dd = a + 3
				if (side > 0) idx.push(a, c, b, b, c, dd)
				else idx.push(a, b, c, b, dd, c)
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
			g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3))
			g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2))
			g.setIndex(idx)
			return g
		})
	}
	addModel("carpet-strip", "slab", (ctx) => {
		const { w, h: hAll, d } = ctx
		if (ctx.solid.look !== "carpet") return board(ctx, { r: 0.001 })
		const tb = Math.min(0.0035, 0.3 * hAll) // the plywood the carpet is glued to (a raised ramp must not sag): the lowest `tb` of the slab
		const h = hAll - tb // the carpet's own thickness (jute and pile)
		const hex = String(ctx.color).toLowerCase() === String(ctx.look?.fill ?? "").toLowerCase() ? "#1f3560" : ctx.color // a deep navy by default
		const r = Math.min(0.003, 0.3 * h)
		const edge = carpetEdge(hex, h)
		const sheenC = new T.Color(L.tone(hex, 1.4))
		const edgeMat = M(`carpetedge4|${hex}|${edge.map.uuid}`, { map: edge.map, normalMap: edge.normalMap, normalScale: V2(0.9), roughness: 1, metalness: 0, sheen: 0.3, sheenRoughness: 0.4, sheenColor: sheenC })
		const topMat = L.pile(hex)
		const bw = Math.min(0.013, d * 0.2) // the binding: 13 mm over the top of the pile
		const bm = bindingMaps()
		const bindM = M(`carpetbind|${hex}`, { color: L.tone(hex, 0.7), map: bm.map, normalMap: bm.normalMap, normalScale: V2(0.8), roughness: 0.85, metalness: 0, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new T.Color(L.tone(hex, 1.1)) })
		// long sides (+z, -z) wear the binding, the cut ends the velour edge, the top the pile, the bottom the jute backing
		const g = rbox(w, h, d, r, { seg: 2, ty: [0.08, 0.08], tz: [0.05, 0.03], tx: [0.04, h], off: { y: [0.1, 0.3], z: [0.3, 0.5], x: [0.5, 0.5] } })
		const parts = [mesh(g, [edgeMat, edgeMat, topMat, edgeMat, bindM, bindM])]
		for (const side of [-1, 1]) parts.push(mesh(bindingGeo(w, h, d, r, bw, side), bindM, { cast: false }))
		for (const p of parts) p.position.y = tb / 2 // the carpet sits on the board: its middle is tb / 2 above the slab's
		// a slow nap shading over the pile between the bindings: soft lights and darks, 10-20 cm long swells, like a brushed pile (a small alpha map: lights white, darks black)
		const sw = w - 2 * r, sd = Math.max(0.004, d - 2 * bw - 2 * r)
		const NW = Math.max(32, Math.min(512, Math.round(sw * 160))), NH = Math.max(8, Math.min(128, Math.round((NW * sd) / sw)))
		const nap = M(`carpetnap2|${hex}|${f5(w)}|${f5(d)}`, {
			map: kit.tex(`carpetnap2|${f5(w)}|${f5(d)}`, NW, NH, (g2) => {
				const img = g2.createImageData(NW, NH)
				for (let y = 0; y < NH; y++) for (let x = 0; x < NW; x++) {
					const uu = x / NW, vv = y / NH
					const nv = pfbm(uu, vv, Math.max(3, Math.round(sw * 6)), 1, 211, 3) - 0.5 // soft bands across the strip, 15-20 cm apart: the pile brushed one way here, another there
					const dark = clamp(-nv * 2.6), light = clamp(nv * 2.6) * 0.45
					const i = (y * NW + x) * 4
					const c = light > dark ? 255 : 0
					img.data[i] = img.data[i + 1] = img.data[i + 2] = c
					img.data[i + 3] = Math.round(255 * Math.max(dark, light))
				}
				g2.putImageData(img, 0, 0)
			}, { wrap: false }),
			transparent: true, opacity: 0.4, roughness: 1, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
		})
		parts.push(put(decalPlane(sw, sd, nap), 0, h / 2 + 0.0002 + tb / 2, 0, -PI2, 0, 0))
		parts.push(backingBoard(w, tb, d, -hAll / 2 + tb / 2))
		return group(...parts)
	})

	// ------------------------------------------------------------- ice sheet: clear, wet ice: barely tinted, cyan cut edges, a rippled melt skin, a feather of bubbles
	function iceSlab(ctx) {
		const { w, h, d } = ctx
		const r = Math.min(0.0025, 0.12 * Math.min(w, h, d))
		const FF = L.frostFine()
		const MM = L.meltMaps()
		const boxOf = (rad, seg = 3) => rbox(w, h, d, rad, { seg, ty: [0.5, 0.5], tz: [0.1, 0.1], tx: [0.1, 0.1], off: { y: [0.2, 0.1], z: [0.5, 0.3], x: [0.1, 0.6] } })
		// the wet top and bottom: clear (3 cm of ice hardly tints what is seen through it), a mirror of low roughness with gentle swells and ripples
		const top = M(`ice-top6|${f5(h)}`, { color: "#eef7fc", roughness: 1, roughnessMap: MM.ormMap, normalMap: MM.normalMap, normalScale: V2(0.35), metalness: 0, transmission: 0.95, thickness: Math.max(h, 0.02), ior: 1.31, attenuationColor: new T.Color("#bfe4f7"), attenuationDistance: 0.25, clearcoat: 0.3, clearcoatRoughness: 0.04, envMapIntensity: 1.3 })
		top.depthWrite = false
		// the cut edges: the light that reaches the eye has run a long way through the block (the run along the face's normal), so it comes out cyan; a fine frost on the sawn surface
		const edgeOf = (run, tag) => {
			// a sawn face of clear ice reads frosted white with only a hint of cyan (30 cm of clear ice hardly tints what comes through)
			const m = M(`ice-edge11|${tag}|${f5(Math.min(run, 0.3))}`, { color: "#e8f6fc", roughness: 0.6, roughnessMap: FF.ormMap, normalMap: FF.normalMap, normalScale: V2(0.45), metalness: 0, transmission: 0.5, thickness: Math.max(0.03, Math.min(run, 0.3)), ior: 1.31, attenuationColor: new T.Color("#98daf4"), attenuationDistance: 0.4, sheen: 0.9, sheenRoughness: 0.6, sheenColor: new T.Color("#eaf8ff"), envMapIntensity: 1.2 })
			m.depthWrite = false
			return m
		}
		const eX = edgeOf(w, "x"), eZ = edgeOf(d, "z")
		const parts = [mesh(boxOf(r), [eX, eX, top, top, eZ, eZ], { cast: false })]
		// the block's materials do not write depth (the bubbles and the feather inside must show through its faces), so the contact shade under the slab,
		// drawn after it, would land over the ice: a colourless depth-only copy of the block, drawn after the bubbles and before the shade, hides it
		const cap = mesh(boxOf(r), M("ice-depthcap", { colorWrite: false, depthWrite: true, transparent: true, opacity: 0 }), { cast: false })
		cap.receiveShadow = false
		cap.renderOrder = 0.5
		// a single thin sheet of white bubble feathers at mid-thickness
		const unit = kit.geo("sf|unitplane", () => new T.PlaneGeometry(1, 1))
		const fm = M("ice-feather3", { color: "#f4fbff", alphaMap: L.featherMap(), alphaTest: 0.02, transparent: true, opacity: 0.15, roughness: 0.6, metalness: 0, depthWrite: false })
		const fp = mesh(unit, fm, { cast: false })
		fp.rotation.x = -PI2
		fp.scale.set(w - 0.006, d - 0.006, 1)
		fp.position.y = (h3(1, 2, 3) - 0.5) * h * 0.1
		fp.renderOrder = 0.25
		parts.push(fp)
		// trapped bubbles: tiny (0.2-0.8 mm), in strings that run up through the thickness and in a loose layer: one instanced sphere
		const nStr = Math.round(clamp(w * d * 90, 4, 60))
		const nPl = Math.round(clamp(w * d * 260, 12, 120))
		const list = []
		for (let s = 0; s < nStr; s++) {
			const cx = (h3(s, 1, 51) - 0.5) * 0.96 * w, cz = (h3(s, 2, 51) - 0.5) * 0.96 * d
			const nb = 4 + Math.floor(h3(s, 3, 51) * 9)
			let y = -h * 0.42 + h3(s, 4, 51) * h * 0.2
			for (let b = 0; b < nb; b++) {
				const rr = (0.0002 + 0.0006 * Math.pow(h3(s, b + 7, 52), 1.6)) * Math.min(1, h / 0.03 + 0.3)
				y += rr * 2.2 + h3(s, b, 54) * h * 0.04
				if (y > h * 0.44) break
				list.push([cx + (h3(s, b, 55) - 0.5) * 0.0015, y, cz + (h3(s, b, 56) - 0.5) * 0.0015, rr, rr * (1 + 0.5 * h3(s, b, 53)), rr])
			}
		}
		for (let i = 0; i < nPl; i++) {
			const rr = 0.0002 + 0.0005 * Math.pow(h3(i, 1, 57), 2)
			list.push([(h3(i, 2, 57) - 0.5) * 0.96 * w, (0.1 + 0.1 * h3(i, 3, 57)) * h - 0.05 * h, (h3(i, 4, 57) - 0.5) * 0.96 * d, rr * 1.4, rr * 0.8, rr * 1.4])
		}
		const bub = new T.InstancedMesh(kit.geo("sf|bubble-unit", () => new T.SphereGeometry(1, 5, 3)), M("ice-bubble2", { color: "#f4fbff", roughness: 0.08, metalness: 0, transparent: true, opacity: 0.7, envMapIntensity: 2.2, depthWrite: false }), list.length)
		const mx = new T.Matrix4()
		list.forEach((q, i) => bub.setMatrixAt(i, mx.compose(new T.Vector3(q[0], q[1], q[2]), new T.Quaternion(), new T.Vector3(q[3], q[4], q[5]))))
		bub.instanceMatrix.needsUpdate = true
		bub.castShadow = false
		bub.receiveShadow = false
		parts.push(bub, cap)
		// clear ice throws a light shadow (the dither passes one shadow-map texel in two: half the key light, about a fifth darker on the table), not an opaque one
		parts.push(L.lightShadow(kit.geo(`sf|shadowbox|${f5(w)}|${f5(h)}|${f5(d)}`, () => new T.BoxGeometry(w, h, d)), 0.5))
		return group(...parts)
	}
	function sheetOf(ctx) {
		const look = ctx.solid.look
		return look === "ice" ? iceSlab(ctx) : look === "glass" ? glassPane(ctx) : board(ctx, { r: 0.001 })
	}
	addModel("ice-sheet", "slab", sheetOf)

	// ------------------------------------------------------------- glass sheet: a polished pane, a glowing green edge
	function glassPane(ctx) {
		const { w, h, d } = ctx
		const r = Math.min(0.0007, h * 0.2)
		const top = L.glassMat("#ffffff", { thickness: Math.max(h, 0.006), attenuation: "#bfe8d4", dist: 0.05, env: 1.1 })
		// the edges: light runs along the pane, a long way through glass, and comes out green (thickness = the run through the pane)
		const edgeOf = (run, tag) => M(`glass-edge2|${tag}|${f5(run)}`, { color: "#a8e6cb", roughness: 0.1, metalness: 0, transmission: 0.85, thickness: Math.max(run, 0.05), ior: 1.52, attenuationColor: new T.Color("#2f9b72"), attenuationDistance: 0.5, envMapIntensity: 1.5, clearcoat: 1, clearcoatRoughness: 0.04 })
		const eX = edgeOf(d, "x") // the short ends (+x, -x): the light runs the pane's depth
		const eZ = edgeOf(w, "z") // the long front and back edges
		const g = rbox(w, h, d, r, { seg: 3, tu: 0.2, tv: 0.2, te: 0.2 })
		// a 6 mm pane throws a faint shadow (the dither passes one shadow-map texel in two: half the key light, about a fifth darker on the table), not an opaque one
		return group(mesh(g, [eX, eX, top, top, eZ, eZ], { cast: false }), L.lightShadow(kit.geo(`sf|shadowbox|${f5(w)}|${f5(h)}|${f5(d)}`, () => new T.BoxGeometry(w, h, d)), 0.5))
	}
	addModel("glass-sheet", "slab", sheetOf)

	// ------------------------------------------------------------- shared by the round things
	/** Points round a circle's quarter (or any arc): centre (cr, cz), radius rad, angles a0..a1 (rad, from +r toward +z). */
	const arc = (cr, cz, rad, a0, a1, n = 6) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cr + rad * Math.cos(a), cz + rad * Math.sin(a)] })

	// ------------------------------------------------------------- peg: a ground steel dowel standing out of a plywood backboard, seen end-on
	function dowelSkin(ctx) {
		const look = ctx.solid.look ?? ""
		if (look === "steel") return L.stainless()
		if (look === "aluminium") return L.aluminium()
		if (look === "rubber") return L.rubber(ctx.color)
		if (/wood/.test(look)) return L.woodSet(ctx.color, 2).side
		return L.skin(ctx).side
	}
	/** The peg: radius exactly r all the way (the physics circle), ground and chamfered at the tip; its back end is hidden in the backboard it stands out of. */
	function pegGeo(r, d, seg, chamfer) {
		const c = chamfer ? Math.min(0.0008, r * 0.14) : 0
		const z0 = -d / 2
		const prof = chamfer ? [[r, z0], [r, d / 2 - c], [r - c, d / 2], [0, d / 2]] : [[r, z0], [r, d / 2], [0, d / 2]]
		return L.lathe(`peg3|${f5(r)}|${f5(d)}|${seg}|${chamfer}`, prof, { axis: "z", seg, tile: 0.1, crease: 0.5 })
	}
	function pegShaft(ctx) {
		const r = ctx.r, d = ctx.d
		return mesh(pegGeo(r, d, clamp(Math.round(r * 5000), 48, 128), true), dowelSkin(ctx))
	}
	/** A bored hole: the dark ring of shadow round a peg where it goes into the board's face (0.3 mm wide, one shared geometry per size). */
	const boreRing = (r, seg = 48) => kit.geo(`bore2|${f5(r)}|${seg}`, () => new T.RingGeometry(r * 0.99, r + 0.0003, seg))
	const boreMat = () => M("bore2", { color: "#120c08", roughness: 0.9, metalness: 0, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
	const PLY_T = 0.012
	addModel("peg", "peg", (ctx) => {
		const r = ctx.r, z0 = -ctx.d / 2
		const wb = Math.max(0.06, 6 * 2 * r) // the square of birch ply the peg is set in: about 6 diameters across
		const board = L.plyBoard(wb, wb, PLY_T, { r: 0.0015 })
		board.position.z = z0 - PLY_T / 2
		const ring = new T.Mesh(boreRing(r), boreMat())
		ring.position.z = z0 + 0.00008
		ring.castShadow = false
		return group(pegShaft(ctx), board, ring)
	})
	/** The painted panel a grid of pegs is set in: MDF in enamel, a plywood rail round the edge. */
	function pegPanel(ctx) {
		const P = ctx.props
		const rows = Math.round(P.rows), cols = Math.round(P.columns), sp = P.spacing
		const dy = (sp * Math.sqrt(3)) / 2 // row spacing
		const W = (cols + 1) * sp, H = (rows - 1) * dy + 2 * sp // the pegs' extent plus one spacing on every side
		const cx = ((cols - 1) * sp) / 2, cy = -((rows - 1) * dy) / 2 // its centre, from the first peg
		const z0 = -ctx.d / 2
		const t = 0.014
		const paint = M("pegpanel-paint", { color: "#1d6b74", roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3 })
		const panel = rbox(W, H, t, 0.002, { seg: 2 })
		const m = mesh(panel, paint)
		m.position.set(cx, cy, z0 - t / 2)
		const parts = [m]
		// a rail of plywood round the edge, low enough that no ball can touch it: a frame
		const rail = 0.012, rh = 0.014
		const pm = L.plyMats("#dcc190", rh)
		for (const [w2, h2, x2, y2] of [[W, rail, cx, cy + H / 2 - rail / 2], [W, rail, cx, cy - H / 2 + rail / 2], [rail, H - 2 * rail, cx - W / 2 + rail / 2, cy], [rail, H - 2 * rail, cx + W / 2 - rail / 2, cy]]) {
			const g = rbox(w2, h2, rh, 0.001, { seg: 1, tx: [rh, 0.1], ty: [0.1, rh], tz: [0.5, 0.25], off: { x: [0.5, 0.5], y: [0.5, 0.5], z: [0.3, 0.1] } })
			const rm = mesh(g, [pm.edgeX, pm.edgeX, pm.edgeY, pm.edgeY, pm.face, pm.face])
			rm.position.set(x2, y2, z0 + rh / 2 - 0.0002)
			parts.push(rm)
		}
		return parts
	}
	/** Every peg of the board as one instanced mesh (and its bore rings as another), in the first peg's frame; the other pegs' parts draw nothing. */
	function pegField(ctx) {
		const P = ctx.props
		const rows = Math.round(P.rows), cols = Math.round(P.columns), sp = P.spacing
		const dy = (sp * Math.sqrt(3)) / 2
		const offs = []
		for (let i = 0; i < rows; i++) {
			const n = i % 2 === 0 ? cols : cols - 1
			for (let j = 0; j < n; j++) offs.push([(j - (n - 1) / 2) * sp + ((cols - 1) * sp) / 2, -i * dy])
		}
		const many = offs.length > 120
		const r = ctx.r, z0 = -ctx.d / 2
		const seg = many ? 10 : clamp(Math.round(r * 4000), 16, 32)
		const peg = new T.InstancedMesh(pegGeo(r, ctx.d, seg, !many), dowelSkin(ctx), offs.length)
		const ring = new T.InstancedMesh(boreRing(r, many ? 8 : 24), boreMat(), offs.length)
		const mp = new T.Matrix4(), mr = new T.Matrix4()
		offs.forEach(([x, y], i) => {
			peg.setMatrixAt(i, mp.makeTranslation(x, y, 0))
			ring.setMatrixAt(i, mr.makeTranslation(x, y, z0 + 0.00008))
		})
		for (const m of [peg, ring]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere() }
		peg.castShadow = true
		peg.receiveShadow = true
		ring.castShadow = false
		ring.receiveShadow = false
		return [peg, ring]
	}
	// the panel and every peg are drawn once, on the first peg's part (row 1, column 1), in that part's own frame; the other pegs' parts draw nothing
	addModel("peg-board", "*", null)
	addModel("peg-board", "peg1-1", (ctx) => group(...pegField(ctx), ...pegPanel(ctx)))

	// ------------------------------------------------------------- bumper: a pinball-style bumper: post, rubber ring, cap and a screw
	addModel("bumper", "bumper", (ctx) => {
		const R = ctx.r, d = ctx.d
		const z0 = -d / 2
		const key = `bumper|${f5(R)}|${f5(d)}`
		const parts = []
		// the playfield it is bolted to: a patch of painted plywood behind the bumper, with four screws at the corners
		const pw = 2 * R + 0.05, pt = 0.012
		const pm = L.plyMats("#dcc190", pt)
		const pgeo = rbox(pw, pw, pt, 0.0015, { seg: 2, tx: [pt, 0.1], ty: [0.1, pt], tz: [0.5, 0.25], off: { x: [0.5, 0.5], y: [0.5, 0.5], z: [0.1, 0.4] } })
		const pface = M("bumper-field", { color: "#254b83", roughness: 0.35, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.15 })
		const plate = mesh(pgeo, [pm.edgeX, pm.edgeX, pm.edgeY, pm.edgeY, pface, pface])
		plate.position.z = z0 - pt / 2
		parts.push(plate)
		for (const sx of [-1, 1]) for (const sy of [-1, 1]) parts.push(put(mesh(kit.cylinderZ(0.0032, 0.0012, 16), L.stainless()), sx * (pw / 2 - 0.009), sy * (pw / 2 - 0.009), z0 + 0.0006))
		// a dark base plate and the steel post
		parts.push(mesh(L.lathe(`${key}|base`, [[0, z0], [0.9 * R, z0], [0.9 * R, z0 + 0.1 * d], [0, z0 + 0.1 * d]], { axis: "z", seg: 96, crease: 0.5 }), L.plasticMat("#26282c", 0.7)))
		parts.push(mesh(L.lathe(`${key}|post`, [[0, z0 + 0.05 * d], [0.46 * R, z0 + 0.05 * d], [0.46 * R, 0.32 * d], [0, 0.32 * d]], { axis: "z", seg: 64, crease: 0.5 }), L.stainless()))
		// the rubber ring: a rounded band, the widest thing in the picture (radius R)
		const rin = 0.5 * R, zb = -0.24 * d, zt = 0.24 * d, c = Math.min(0.18 * R, 0.24 * d)
		// a faint moulding line round the middle of the ring: a 0.15 mm groove, as a rubber mould leaves
		const ring = [[rin, zb], ...arc(R - c, zb + c, c, -Math.PI / 2, 0, 6), [R, -0.0007], [R - 0.00018, -0.00025], [R - 0.00018, 0.00025], [R, 0.0007], ...arc(R - c, zt - c, c, 0, Math.PI / 2, 6), [rin, zt], [rin, zb]]
		// smooth satin rubber: hardly any bump, fine noise
		parts.push(mesh(L.lathe(`${key}|ring2`, ring, { axis: "z", seg: 128, tile: 0.1, crease: 1.0 }), L.rubber(L.tone(ctx.color, 0.5), 1, { sheen: 0.12, normalScale: V2(0.12), roughness: 0.72 })))
		// the screw in the middle stands out of the cap by sh; the cap's flat top is sh below the front
		const sr = 0.17 * R
		const sh = 0.0006 + 0.42 * sr
		const zt2 = d / 2 - sh
		// the cap: a short drum with a chamfered, flat top
		const zc = zt - 0.01 * d, rc = 0.84 * R
		const cap = [[0, zc], [rc, zc], [rc, zt2 - 0.34 * (zt2 - zc)], [rc - 0.05 * R, zt2 - 0.1 * (zt2 - zc)], [0.7 * R, zt2], [0, zt2]]
		parts.push(mesh(L.lathe(`${key}|cap`, cap, { axis: "z", seg: 128, crease: 0.6 }), L.plasticMat("#f1ece0", 0.85)))
		// a printed target on the cap
		const decal = decalMat(`bumper-cap`, 512, 512, (g) => {
			g.clearRect(0, 0, 512, 512)
			g.translate(256, 256)
			g.strokeStyle = "#b81818"
			g.lineWidth = 26
			g.beginPath(); g.arc(0, 0, 190, 0, TAU); g.stroke()
			g.lineWidth = 8
			g.beginPath(); g.arc(0, 0, 128, 0, TAU); g.stroke()
			g.fillStyle = "#b81818"
			for (let i = 0; i < 12; i++) { g.save(); g.rotate((i / 12) * TAU); g.fillRect(212, -6, 34, 12); g.restore() }
		}, { roughness: 0.4 })
		const disc = new T.Mesh(kit.geo(`${key}|disc`, () => new T.CircleGeometry(0.62 * R, 48)), decal)
		disc.position.z = zt2 + 0.00012
		disc.castShadow = false
		parts.push(disc)
		// the chrome screw head
		const dome = [[0, zt2 - 0.002], [sr, zt2 - 0.002], [sr, zt2 + 0.0006], ...arc(0, zt2 + 0.0006, sr, 0, Math.PI / 2, 6).slice(1).map(([r_, z_]) => [r_, zt2 + 0.0006 + (z_ - zt2 - 0.0006) * 0.42])]
		parts.push(mesh(L.lathe(`${key}|screw`, dome, { axis: "z", seg: 32, crease: 0.9 }), L.chrome()))
		return group(...parts)
	})

	// ------------------------------------------------------------- funnel: one round cone with a stem, drawn on the left wall's part (the right one and the stem are null)
	addModel("funnel", "right", null)
	addModel("funnel", "stem-left", null)
	addModel("funnel", "stem-right", null)
	addModel("funnel", "left", (ctx) => {
		const P = ctx.props
		const m = P.mouth, o = P.outlet, h = P.height, t = P.thickness
		const a = (m - o) / 2
		const Ls = Math.hypot(a, h)
		const phi = Math.atan2(a, h)
		const cphi = Math.cos(phi), sphi = Math.sin(phi)
		const cx = -(m / 2 - a / 2) - (t / 2) * (h / Ls)
		const cy = -h / 2 - (t / 2) * (a / Ls)
		// the left wall's rectangle in the funnel's frame, then turned about the axis (r = -x): n across the wall (outward +), s up its slant
		const pt = (n, s) => { const lx = -n; return [-(cx + lx * cphi - s * sphi), cy + lx * sphi + s * cphi] }
		const hs = Ls / 2, ht = t / 2
		const ls = P.outlet > 0 && a > 0.005 ? Math.min(0.08, 0.75 * o, 0.3 * h) : 0 // the stem under the cone (the catalog's stem-left / stem-right slabs)
		const k = Math.min(1, ht / 0.006)
		const prof = []
		if (ls > 0) {
			const s1 = (o / 2 + t + cx - ht * cphi) / sphi // where the outer wall meets the stem's outer face
			prof.push(pt(ht, s1))
		} else prof.push(pt(ht, -hs))
		// up the outer face, a cove cut below a turned bead, a lip eased at both corners (2.5 mm: the outline falls short by under a millimetre)
		const rr = Math.min(0.0025, ht * 0.8)
		prof.push(pt(ht, hs - 0.0185 * k), pt(ht - 0.0014 * k, hs - 0.0158 * k), pt(ht - 0.0014 * k, hs - 0.0138 * k), pt(ht, hs - 0.0112 * k), pt(ht, hs - rr))
		for (let i = 1; i <= 5; i++) { const al = (i / 5) * (Math.PI / 2); prof.push(pt(ht - rr + rr * Math.cos(al), hs - rr + rr * Math.sin(al))) }
		for (let i = 0; i <= 5; i++) { const al = (i / 5) * (Math.PI / 2); prof.push(pt(-ht + rr - rr * Math.sin(al), hs - rr + rr * Math.cos(al))) }
		// down the inner face to the outlet, then the stem and its rounded end
		prof.push(pt(-ht, -hs))
		if (ls > 0) {
			const ce = Math.min(0.0015, t * 0.3)
			prof.push([o / 2, -h - ls + ce], [o / 2 + ce * 0.3, -h - ls + ce * 0.3], [o / 2 + ce, -h - ls], [o / 2 + t - ce, -h - ls], [o / 2 + t - ce * 0.3, -h - ls + ce * 0.3], [o / 2 + t, -h - ls + ce])
		} else {
			prof.push(pt(ht, -hs + 0.0001))
		}
		prof.push(prof[0])
		const look = ctx.solid.look ?? ""
		const wood = /wood/.test(look)
		let mat
		if (look === "steel") mat = L.brushedMetal("spun", "#d3d8dd", 0.26)
		else if (look === "aluminium") mat = L.brushedMetal("spunalu", "#d4d8dd", 0.3)
		else if (look === "glass") mat = L.glassMat("#ffffff", { thickness: Math.max(t, 0.006), attenuation: "#bfe8d4", dist: 0.06, env: 1.1 })
		else if (wood) mat = L.woodSet(ctx.color, 3, { straight: true, varnish: 0.6 }).side // long straight grain: no cathedral figure to repeat round the cone
		else mat = L.skin(ctx, { seed: 3 }).side // (any other material; the wood and steel ones above bake nothing they do not use)
		// (a wooden funnel is turned from a blank whose grain runs straight across the axis: a planar uv, u = along the grain, so the figure is arcs, not rays converging on the outlet)
		const geo = L.lathe(`funnel3|${f5(m)}|${f5(o)}|${f5(h)}|${f5(t)}|${ls > 0}`, prof, { seg: 128, tile: wood ? [1.0, 0.125] : 0.25, swap: wood, seamless: true, crease: 0.7, planar: wood ? [1.0, 0.125] : null, off: wood ? [0.37, 0.21] : [0, 0] })
		// clear glass casts a faint (dithered) shadow, as the glass and ice sheets do, not a solid one
		const parts = look === "glass" ? [mesh(geo, mat, { cast: false }), L.lightShadow(geo, 0.5)] : [mesh(geo, mat)]
		if (look === "steel" || look === "aluminium") {
			// the soldered seam: a fine ridge up the back of the cone (at azimuth psi, from +x toward +z)
			const psi = -2.2
			const q0 = pt(ht, -hs), q1 = pt(ht, hs - 0.0185 * k)
			const p0 = new T.Vector3(q0[0] * Math.cos(psi), q0[1], q0[0] * Math.sin(psi)), p1 = new T.Vector3(q1[0] * Math.cos(psi), q1[1], q1[0] * Math.sin(psi))
			const dir = p1.clone().sub(p0)
			const rod = mesh(kit.cylinderY(0.0007, dir.length(), 6), L.M("seam-solder", { color: "#b9bdc2", metalness: 1, roughness: 0.4 }))
			rod.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize())
			rod.position.copy(p0.clone().add(p1).multiplyScalar(0.5))
			parts.push(rod)
		}
		const g = group(...parts)
		// front to back the rim's outside reaches the physics depth (the walls' thickness included; a funnel over 1.5 m wide is an oval cone, catalog_items.py)
		g.scale.z = ctx.d / (2 * Math.max(...prof.map((q) => q[0])))
		// the cone is built about the funnel's own axis; the part's frame is the left wall's slab: turn and shift it there
		g.rotation.z = -phi
		g.position.set(-(cx * cphi + cy * sphi), -(-cx * sphi + cy * cphi), 0)
		return g
	})

	/**
	 * Placed pieces merged into one mesh: items [{g (a geometry, non-indexed or indexed; its groups pick the materials), m (a material, or one per group), x, y, z
	 * (a translation)}] -> ONE geometry (position, normal, uv) holding every piece's faces, gathered by material, one group (one draw call) per material. The geometry
	 * is cached under `key`, which must name everything the pieces depend on (their materials are matched in the same order on every build).
	 */
	function mergeByMaterial(key, items) {
		const mats = [], slot = new Map(), runs = []
		for (const it of items) {
			const g = it.g
			const n = g.index ? g.index.count : g.attributes.position.count
			for (const grp of g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }]) {
				const m = Array.isArray(it.m) ? it.m[grp.materialIndex] : it.m
				let k = slot.get(m)
				if (k === undefined) { k = mats.length; slot.set(m, k); mats.push(m); runs.push([]) }
				runs[k].push([g, grp.start, Math.min(grp.count, n - grp.start), it.x, it.y, it.z])
			}
		}
		const geo = kit.geo(`mergemat|${key}|${mats.length}`, () => {
			let total = 0
			for (const r of runs) for (const q of r) total += q[2]
			const P = new Float32Array(total * 3), N = new Float32Array(total * 3), U = new Float32Array(total * 2)
			const out = new T.BufferGeometry()
			let o = 0
			runs.forEach((r, k) => {
				const s0 = o
				for (const [g, start, count, x, y, z] of r) {
					const pa = g.attributes.position.array, na = g.attributes.normal.array, ua = g.attributes.uv.array, ix = g.index?.array
					for (let j = start; j < start + count; j++, o++) {
						const v = ix ? ix[j] : j
						P[o * 3] = pa[v * 3] + x; P[o * 3 + 1] = pa[v * 3 + 1] + y; P[o * 3 + 2] = pa[v * 3 + 2] + z
						N[o * 3] = na[v * 3]; N[o * 3 + 1] = na[v * 3 + 1]; N[o * 3 + 2] = na[v * 3 + 2]
						U[o * 2] = ua[v * 2]; U[o * 2 + 1] = ua[v * 2 + 1]
					}
				}
				out.addGroup(s0, o - s0, k)
			})
			out.setAttribute("position", new T.BufferAttribute(P, 3))
			out.setAttribute("normal", new T.BufferAttribute(N, 3))
			out.setAttribute("uv", new T.BufferAttribute(U, 2))
			out.computeBoundingSphere()
			return out
		})
		return mesh(geo, mats)
	}
	// ------------------------------------------------------------- staircase: the whole flight is drawn on step 1's part (the others are null)
	/** The flight's side view in step 1's frame: a sawtooth, counter-clockwise (columns i = 0 .. n-1, each `run` wide, i * rise + rise / 2 high). */
	function stairProfile(n, rise, run) {
		const pts = [[-run / 2, -rise / 2], [(n - 0.5) * run, -rise / 2]]
		for (let i = n - 1; i >= 0; i--) pts.push([i * run + run / 2, i * rise + rise / 2], [i * run - run / 2, i * rise + rise / 2])
		return pts
	}
	/** A convex polygon ([[x, y], ...]) cut to the half-plane a x + b y <= c. */
	function clipHalf(poly, a, b, c) {
		const out = []
		for (let i = 0; i < poly.length; i++) {
			const P = poly[i], Q = poly[(i + 1) % poly.length]
			const fp = a * P[0] + b * P[1] - c, fq = a * Q[0] + b * Q[1] - c
			if (fp <= 0) out.push(P)
			if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]) }
		}
		return out.filter((p, i) => { const q = out[(i + 1) % out.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 2e-5 })
	}
	const STRINGER_TU = 1.0, STRINGER_TV = 0.125, STRINGER_BAND = 0.095 // the stringer's grain tile along the slope and across it (the wood's own), its boards up to 9.5 cm
	/**
	 * The sawtooth stringer board, its grain running up the slope (uv rotated by the slope angle, in metres of a wood tile). Up to 9.5 cm across the slope it is one
	 * board, inside one grain tile across. Wider (a knot and the same arches would come round again across it), it is a built-up stringer: boards glued along the
	 * slope, each up to 9.5 cm across with its own stretch of the grain: its own place along the tile and across it, its own length of figure, turned end for end or face for face (its
	 * flames point the other way), and the step blocks glued on them (cut the same way where they are big). Its outline is the sawtooth's.
	 */
	function stringerGeo(pts, n, rise, run, ts) {
		const th = Math.atan2(rise, run), cs = Math.cos(th), sn = Math.sin(th)
		// tl: the grain tile along the slope (L.grainTile of the board's length: a board over 1 m long shows its figure and its knot once, not every metre)
		// vspan (a board's width across the slope): the board turned face for face across too (its knot near the other edge)
		const uvOf = (g, ou, ov, p0, tv = STRINGER_TV, flip = 1, tl = STRINGER_TU, vspan = null) => {
			const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv
			for (let i = 0; i < pos.count; i++) {
				const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
				const su = (flip * (x * cs + y * sn)) / tl + ou
				const p = -x * sn + y * cs - p0
				if (Math.abs(nor.getZ(i)) > 0.5) uv.setXY(i, su, (vspan === null ? p : vspan - p) / tv + ov)
				else uv.setXY(i, su, z / tv + 0.5)
			}
			uv.needsUpdate = true
			return g
		}
		// the sawtooth = a triangle under the line through the steps' inner corners (from the bottom-left corner to the top-right one) + one small triangle per step
		const B0 = [-run / 2, -rise / 2], B1 = [(n - 0.5) * run, -rise / 2], B2 = [(n - 0.5) * run, (n - 0.5) * rise]
		const d0 = -(sn * B0[0] - cs * B0[1]) // d(x, y) = sn x - cs y + d0: the distance below that line (the step blocks are above it: d < 0)
		const Hb = n * run * sn, Th = rise * cs // the triangle's and a step block's extent across the slope
		const wide = Hb + Th > STRINGER_BAND
		const along = (poly) => { const q = poly.map(([x, y]) => x * cs + y * sn); return Math.max(...q) - Math.min(...q) }
		return kit.geo(`stringer5|${n}|${f5(rise)}|${f5(run)}|${f5(ts)}|${wide}`, () => {
			// one board: its whole width (from -Hb below the steps' inner corners to Th above) inside one tile across, centred in it
			if (!wide) return uvOf(L.extrudeXY(`stair|${n}|${f5(rise)}|${f5(run)}`, pts, ts, { bevel: 0.0007, inset: true }).clone(), 0.2, 0.5 * (1 - (Hb + Th) / STRINGER_TV), -Hb, STRINGER_TV, 1, L.grainTile(along(pts), STRINGER_TU))
			const pieces = [], keys = []
			const cut = (poly, D0, D1) => clipHalf(clipHalf(poly, sn, -cs, D1 - d0), -sn, cs, d0 - D0)
			const mB = Math.max(1, Math.ceil(Hb / STRINGER_BAND)), bB = Hb / mB
			const mT = Math.max(1, Math.ceil(Th / STRINGER_BAND)), bT = Th / mT
			const bev = mB + n * mT > 24 ? L.GLUE_R : 0.0007 // (a big flight's many boards: the glued arris, a hairline at each joint (44 triangles a board))
			const add = (poly, k, flip) => {
				if (poly.length < 3) return
				const pr = poly.map(([x, y]) => -x * sn + y * cs)
				const pMin = Math.min(...pr), span = Math.max(...pr) - pMin
				const g = L.extrudeXY(`strp|${poly.map((q) => f5(q[0]) + "," + f5(q[1])).join(";")}`, poly, ts, { bevel: bev, inset: true }).clone()
				// its place across the tile: anywhere that keeps the whole board inside one tile (the grain is not periodic across it)
				const room = Math.max(0, 1 - 0.02 - span / STRINGER_TV)
				// its own length of figure: the tile along it from 0.85 to 1.25 times the wood's (boards from different logs), never shorter than a board of up to 2 m
				const len = along(poly)
				let tl = L.grainTile(len, STRINGER_TU) * (0.85 + 0.4 * h3(k, 5, 57))
				if (len <= 2 && tl < len) tl = len
				pieces.push(uvOf(g, h3(k, 1, 57), 0.01 + room * h3(k, 2, 57), pMin, STRINGER_TV, flip, tl, h3(k, 4, 57) < 0.5 ? span : null))
				keys.push(k)
			}
			for (let k = 0; k < mB; k++) add(cut([B0, B1, B2], k * bB, (k + 1) * bB), k, k % 2 ? -1 : 1)
			for (let i = 0; i < n; i++) {
				const tooth = [[i * run - run / 2, i * rise - rise / 2], [(i + 1) * run - run / 2, (i + 1) * rise - rise / 2], [i * run - run / 2, i * rise + rise / 2]]
				for (let k = 0; k < mT; k++) add(mT === 1 ? tooth : cut(tooth, -(k + 1) * bT, -k * bT), 100 + i * 7 + k, (i + k) % 2 ? -1 : 1)
			}
			// one group per board (in `keys` order): each its own shade
			const g = L.mergeGeometries(pieces, true)
			g.userData.keys = keys
			for (const q of pieces) q.dispose()
			return g
		})
	}
	for (let i = 2; i <= 24; i++) addModel("staircase", `step${i}`, null)
	addModel("staircase", "step1", (ctx) => {
		const run = ctx.w, rise = ctx.h, d = ctx.d
		const n = Math.max(1, Math.round(ctx.props.steps ?? 5))
		const sk = L.skin(ctx, { seed: 2 })
		const pts = stairProfile(n, rise, run)
		if (sk.kind === "concrete" || sk.kind === "brick") {
			// one cast (or one laid) piece: no seams. Brick: courses of 65 mm + 10 mm mortar from the floor up.
			const brick = sk.kind === "brick"
			// the courses follow the steps: a whole number of them to the rise (65 mm bricks + 10 mm joints where the rise allows, a little thinner where it does not), a mortar joint at every tread
			const ch = rise / Math.max(1, Math.round(rise / 0.075)), TY = 2 * ch // two courses to the texture's tile
			const t = brick ? { tx: [0.45, TY], ty: [0.45, 0.15], tz: [0.45, TY], off: { x: [0.1, rise / 2 / TY], y: [0.3, 0.2], z: [0.2, rise / 2 / TY] } } : { tx: [0.3, 0.3], ty: [0.3, 0.3], tz: [0.3, 0.3], off: { x: [0.3, 0.1], y: [0.1, 0.6], z: [0.4, 0.2] } }
			const g = L.extrudeUV(`stair1|${n}|${f5(rise)}|${f5(run)}|${sk.kind}|2`, pts, d, { ...t, bevel: 0.0008, inset: true })
			return group(mesh(g, sk.side))
		}
		if (sk.kind !== "wood") {
			const g = L.extrudeUV(`stair2|${n}|${f5(rise)}|${f5(run)}`, pts, d, { tx: [sk.tu, sk.tu], ty: [sk.tu, sk.tu], tz: [sk.tu, sk.tu], bevel: 0.0008, inset: true })
			return group(mesh(g, sk.side))
		}
		// timber: a stringer board on each face, treads (grain along z), risers on the left face of each step, an end board, a dark core behind the joints
		const ts = Math.min(0.018, d * 0.14) // stringer
		const tt = Math.min(0.019, rise * 0.45) // tread
		const tr = Math.min(0.012, run * 0.22) // riser
		const zin = d - 2 * ts // between the stringers
		const gap = 0.0005
		// every piece is gathered (its geometry, its material or one per face, where it goes) and the lot is merged into ONE geometry with one group per material:
		// a flight of hundreds of boards is a dozen draw calls (five shades of glued board, side and end grain, the stringers, the core)
		const items = []
		const sg = stringerGeo(pts, n, rise, run, ts)
		// (a built-up stringer: each of its boards a shade of its own, from different planks, as the glued treads)
		const sm = sg.userData.keys ? sg.userData.keys.map((k) => L.boardSkin(ctx.color, 2, k, 57).side) : sk.side
		for (const sz of [-1, 1]) items.push({ g: sg, m: sm, x: 0, y: 0, z: sz * (d / 2 - ts / 2) })
		// every board takes its own place in the grain tile (hashed from its number and a salt), so no two treads or risers show the same figure, and lies
		// either way round (its arches pointing to the front or to the back)
		// (a glued board, r <= GLUE_R, is a plain box: flush square joints, the grain changing at each is the line; a big flight has hundreds of them)
		const zBoard = (w2, h2, d2, num, salt, r, bs, x, y) => items.push({ g: rbox(w2, h2, d2, r, { seg: r <= L.GLUE_R ? 0 : 2, ty: [h3(num, 7, salt) < 0.5 ? -1.0 : 1.0, 0.125], tz: [0.125, 0.125], tx: [1.0, 0.125], yswap: true, fit: true, off: { y: [h3(num, 1, salt), h3(num, 2, salt)], z: [h3(num, 3, salt), h3(num, 4, salt)], x: [h3(num, 5, salt), h3(num, 6, salt)] } }), m: [bs.side, bs.side, bs.side, bs.side, bs.end, bs.end], x, y, z: 0 })
		const rN = Math.min(0.003, tt * 0.4, run * 0.1)
		const dark = M("stair-core", { color: "#1c1209", roughness: 0.9, metalness: 0 })
		for (let i = 0; i < n; i++) {
			const xc = i * run, top = i * rise + rise / 2
			// the tread: its eased nosing at the left end, flush with the riser below it; it runs on under the next step's riser (which stands on it).
			// Over 20 cm from front to back: boards glued edge to edge (each its own grain); the first keeps the nosing, the next one laps 'rN' over its
			// rounded back arris (hidden under its top), so the joint shows as a hairline, not a groove
			const ext = i < n - 1 ? tr : 0
			const tw = run + ext - gap, x0 = xc + ext / 2 - tw / 2
			const glued = tw > L.GLUE_OVER
			for (const { c, s, i: k } of L.gluedCuts(tw)) {
				const lap = k === 1 ? rN : 0, num = glued ? 1000 + i * 13 + k : i
				zBoard(s + lap, tt, zin - gap, num, 71, k ? Math.min(rN, L.GLUE_R) : rN, glued ? L.boardSkin(ctx.color, 2, num, 71) : sk, x0 + tw / 2 + c - lap / 2, top - tt / 2)
			}
			// the riser: from the tread below up to this tread's underside, on the left face of this column (over 20 cm: boards glued one over another)
			const rh = rise - tt - gap
			const gr = rh > L.GLUE_OVER
			for (const { c, s, i: k } of L.gluedCuts(rh)) {
				const num = gr ? 1000 + i * 13 + k : i
				zBoard(tr, s, zin - gap, num, 72, gr ? L.GLUE_R : 0.0007, gr ? L.boardSkin(ctx.color, 2, num, 72) : sk, xc - run / 2 + tr / 2, top - tt - gap / 2 - rh / 2 + c)
			}
			// the core behind them (never seen but through a joint): dark
			items.push({ g: kit.box(run - 0.001, top - tt - 0.001 + rise / 2, zin - 0.001, 0.0002, 1), m: dark, x: xc, y: (top - tt - 0.001 - rise / 2) / 2, z: 0 })
		}
		// the closed back: a board across the high end
		const xe = (n - 0.5) * run, hTop = (n - 1) * rise + rise / 2
		const hb = hTop - tt - gap + rise / 2, gb = hb > L.GLUE_OVER
		for (const { c, s, i: k } of L.gluedCuts(hb)) {
			const num = gb ? 2000 + k : n
			zBoard(0.012, s, zin - gap, num, 73, gb ? L.GLUE_R : 0.0007, gb ? L.boardSkin(ctx.color, 2, num, 73) : sk, xe - 0.006, (hTop - tt - gap - rise / 2) / 2 + c)
		}
		return group(mergeByMaterial(`stairwood|${n}|${f5(rise)}|${f5(run)}|${f5(d)}|${ctx.color}|${ctx.solid.look}`, items))
	})
}
