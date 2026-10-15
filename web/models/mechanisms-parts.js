// Shared pieces of the mechanisms models (see mechanisms.js): the mounting beam, spring seats, screws, the hooked lab mass.
// Every function takes the item's ctx (web/models3d.js) and returns a THREE.Group in the part's own frame.

export function makeParts(kit, THREE, L) {
	const T = THREE
	const { f5, put, faces } = L
	const HALF = Math.PI / 2
	const mesh = (g, m, o) => kit.mesh(g, m, o)
	const group = (...c) => kit.group(...c)
	const sideOf = (ctx) => (/[a-z]1$/.test(ctx.solid.id) ? -1 : 1)
	const seedOf = (ctx) => (L.hashStr(ctx.solid.id) % 97) + 1

	/** A mounting beam / bracket: steel plate on top (with screws), a block of the part's own material below, brass eyes on the underside at `eyes` (x). */
	function beam(ctx, { eyes = [0], screwPitch = 0.07, inset = 0.004 } = {}) {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const tp = Math.min(0.003, h * 0.27)
		const bh = h - tp
		const block = mesh(L.rbox(w, bh, Math.max(0.004, d - inset), Math.min(0.0012, bh * 0.3), { grain: 0, seed: seedOf(ctx) }), faces(sk.side, sk.end, 0))
		block.position.y = -h / 2 + bh / 2
		const top = mesh(L.rbox(w, tp, d, Math.min(0.0008, tp * 0.4)), L.zinc())
		top.position.y = h / 2 - tp / 2
		const out = [block, top]
		const n = Math.max(2, Math.round(w / screwPitch))
		const rs = Math.min(0.0024, d * 0.06)
		for (let i = 0; i < n; i++) {
			const x = -(w / 2 - 0.007) + (i * (w - 0.014)) / (n - 1)
			out.push(put(L.slottedScrew(rs, (i * 1.3) % 3), x, h / 2, 0))
		}
		for (const x of eyes) out.push(screwEye(x, -h / 2))
		return group(out)
	}

	/** A brass screw eye hanging under a surface at y (the ring lies in the x-y plane, so the rope or spring hooks into it from the front). */
	function screwEye(x, y, z = 0) {
		return group(
			put(mesh(L.washer(0.0046, 0.0008), L.brass()), x, y - 0.0006, z),
			put(mesh(kit.cylinderY(0.0016, 0.0030, 16), L.brass()), x, y - 0.0010, z),
			put(mesh(kit.torus(0.0025, 0.0008, 10, 26), L.brass()), x, y - 0.0030, z),
		)
	}

	/** A spring seat: a steel disc with a raised lip the coil sits in, standing on the surface at the origin, facing `dir`. */
	function seat(dir = "+y", R = 0.0148) {
		const m = L.steel("#a3a9af")
		const g = group(mesh(L.washer(R, 0.0006), m), mesh(L.washer(R, 0.0016, R - 0.002), m))
		if (dir === "-y") g.rotation.x = Math.PI
		else if (dir === "+x") g.rotation.z = -HALF
		else if (dir === "-x") g.rotation.z = HALF
		return g
	}
	/** A small slotted screw on a face: `dir` is the face's outward direction. `flat`: a countersunk head, 0.3 mm proud (where the part must stay within its depth). */
	function screwOn(x, y, z, r, dir = "+y", spin = 0, flat = false) {
		let g
		if (flat) {
			const slot = mesh(L.slotBox(r), L.darkSteel(), { cast: false })
			slot.position.y = 0.00022
			slot.rotation.y = spin
			g = group(mesh(L.csHead(r), L.steel("#9aa0a6")), slot)
		} else g = group(L.slottedScrew(r, spin))
		g.position.set(x, y, z)
		if (dir === "+z") g.rotation.x = HALF
		else if (dir === "-z") g.rotation.x = -HALF
		else if (dir === "+x") g.rotation.z = -HALF
		else if (dir === "-x") g.rotation.z = HALF
		else if (dir === "-y") g.rotation.x = Math.PI
		return g
	}

	// ------------------------------------------------------------- the hooked lab mass
	/** The stamped numerals come from ONE glyph atlas (the digits, '.', g, k in a single row: an ink map and a bump map, baked once and the same for every weight), and
	 *  each value is a row of small curved patches that pick their glyphs out of it: a new weight bakes no texture at all (sliders drag through hundreds of values). */
	const GLYPHS = "0123456789.gk"
	const CELL_W = 78
	const CELL_H = 192
	const ATLAS_W = 1024
	const FONT = `700 ${CELL_H / 2}px ui-sans-serif, "Helvetica Neue", Helvetica, Arial, sans-serif`
	let advances = null
	/** Each glyph's advance, px of the atlas (a space is as wide as a '.'): measured once. */
	const glyphAdvances = () => {
		if (advances) return advances
		advances = {}
		let g = null
		try {
			g = document.createElement("canvas").getContext("2d")
			g.font = FONT
		} catch (e) { g = null }
		for (const ch of GLYPHS) advances[ch] = g ? Math.min(CELL_W - 8, g.measureText(ch).width + 4) : CELL_H * 0.32
		advances[" "] = advances["."]
		return advances
	}
	const atlasDraw = (ink) => (g, W, H) => {
		g.clearRect(0, 0, W, H)
		if (!ink) { g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, W, H) }
		g.font = FONT
		g.textAlign = "center"
		g.textBaseline = "middle"
		for (let i = 0; i < GLYPHS.length; i++) {
			const x = i * CELL_W + CELL_W / 2
			const y = CELL_H / 2 + CELL_H * 0.04
			if (ink) { g.fillStyle = "rgba(24,27,32,0.82)"; g.fillText(GLYPHS[i], x, y) }
			else {
				g.fillStyle = "#101010"
				g.fillText(GLYPHS[i], x, y)
				g.globalAlpha = 0.5
				g.strokeStyle = "#101010"
				g.lineWidth = 2
				g.strokeText(GLYPHS[i], x, y)
				g.globalAlpha = 1
			}
		}
	}
	/** Dark, stamped numerals: the atlas as a transparent ink decal over the metal with its own bump map, so the digits read as cut into the surface. */
	function stampMat() {
		const map = kit.tex("mechStampAtlasC", ATLAS_W, CELL_H, atlasDraw(true), { wrap: false })
		const bump = kit.tex("mechStampAtlasB", ATLAS_W, CELL_H, atlasDraw(false), { data: true, wrap: false })
		return L.MAT("stampAtlas", { map, bumpMap: bump, bumpScale: 1.2, transparent: true, roughness: 0.55, metalness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
	}
	/** The value `text` as curved patches on a cylinder of radius R (axis y), centred on the +z side, the glyphs `bandH` tall, merged into one geometry (cached per text and size). */
	function stampGeo(text, R, bandH) {
		return kit.geo(`massLabel|${text}|${f5(R)}|${f5(bandH)}`, () => {
			const adv = glyphAdvances()
			const k = bandH / CELL_H // metres per atlas px
			const total = [...text].reduce((a, ch) => a + (adv[ch] ?? adv["0"]) * k, 0)
			let x = -total / 2
			const parts = []
			for (const ch of text) {
				const w = (adv[ch] ?? adv["0"]) * k
				const gi = GLYPHS.indexOf(ch)
				if (gi >= 0 && ch !== " ") {
					const half = (adv[ch] + 3) / 2 // a little margin either side of the glyph
					const cx = gi * CELL_W + CELL_W / 2
					const u0 = (cx - half) / ATLAS_W
					const u1 = (cx + half) / ATLAS_W
					const x0 = x - (1.5 * k)
					const dth = ((adv[ch] + 3) * k) / R
					const g = new T.CylinderGeometry(R + 0.00012, R + 0.00012, bandH, Math.max(1, Math.ceil(dth / 0.1)), 1, true, x0 / R, dth)
					const uv = g.attributes.uv
					for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + (u1 - u0) * uv.getX(i))
					parts.push(g)
				}
				x += w
			}
			const out = L.mergeGeometries(parts, false)
			for (const q of parts) q.dispose()
			return out
		})
	}

	/** The turned body of a hardwood mass, its wood at true scale: the grain runs along the turning axis (u = y / 0.24 m, as in turned stock) and its rings round the side (v goes round
	 *  a whole number of 0.12 m tiles, so the one seam, at the back of the +z side where the stamp is, matches); the flat end faces (group 1) take the end-grain tile, planar. */
	function woodLathe(prof, R, H) {
		return kit.geo(`massWood|${f5(R)}|${f5(H)}`, () => {
			const g = new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(Math.max(0, r), y)), 96).toNonIndexed()
			const pos = g.attributes.position
			const nor = g.attributes.normal
			const uv = g.attributes.uv
			const reps = Math.max(1, Math.round((2 * Math.PI * R) / 0.12))
			const flat = (i) => [0, 1, 2].every((k) => Math.abs(Math.abs(pos.getY(i + k)) - H / 2) < 1e-7)
			const side = []
			const end = []
			for (let i = 0; i < pos.count; i += 3) (flat(i) ? end : side).push(i)
			const te = Math.max(0.1, 2.1 * R) // the end-grain tile's size: its own 0.1 m, or the whole end face
			const P = new Float32Array(pos.count * 3)
			const N = new Float32Array(pos.count * 3)
			const U = new Float32Array(pos.count * 2)
			let w = 0
			for (const list of [side, end])
				for (const i of list)
					for (let k = 0; k < 3; k++, w++) {
						P[w * 3] = pos.getX(i + k); P[w * 3 + 1] = pos.getY(i + k); P[w * 3 + 2] = pos.getZ(i + k)
						N[w * 3] = nor.getX(i + k); N[w * 3 + 1] = nor.getY(i + k); N[w * 3 + 2] = nor.getZ(i + k)
						if (list === end) { U[w * 2] = (pos.getX(i + k) + R) / te; U[w * 2 + 1] = (pos.getZ(i + k) + R) / te }
						else { U[w * 2] = (pos.getY(i + k) + H / 2) / 0.24 + 0.37; U[w * 2 + 1] = uv.getX(i + k) * reps }
					}
			const out = new T.BufferGeometry()
			out.setAttribute("position", new T.BufferAttribute(P, 3))
			out.setAttribute("normal", new T.BufferAttribute(N, 3))
			out.setAttribute("uv", new T.BufferAttribute(U, 2))
			out.addGroup(0, side.length * 3, 0)
			out.addGroup(side.length * 3, end.length * 3, 1)
			g.dispose()
			return out
		})
	}

	/** A turned lab mass: a lathe body (96 segments, chamfers, a shoulder groove, a turned neck), the value stamped on its side, and a wire hook on the neck.
	 *  Fills a w x h cylinder outline; the neck and hook rise ~8 mm above it (the place the spring or rope is made fast). */
	function hookedMass(ctx, grams) {
		const R = ctx.w / 2
		const H = ctx.h
		const c = Math.min(0.0008, R * 0.06)
		const yg = H / 2 - 0.2 * H
		const neckR = 0.4 * R
		const neckH = 0.002
		const gw = Math.min(0.0014, R * 0.1)
		const gd = Math.min(0.0008, R * 0.06)
		const prof = [[0, -H / 2], [R - c, -H / 2], [R, -H / 2 + c], [R, yg - gw], [R - gd, yg - gw * 0.55], [R - gd, yg + gw * 0.55], [R, yg + gw], [R, H / 2 - c], [R - c, H / 2],
			[neckR + 0.0012, H / 2], [neckR + 0.0003, H / 2 + 0.0006], [neckR, H / 2 + 0.0014], [neckR, H / 2 + neckH - 0.0006], [neckR - 0.0006, H / 2 + neckH], [0, H / 2 + neckH]]
		const look = ctx.solid.look ?? ""
		const wood = /wood/.test(look)
		const bodyMat =
			look === "aluminium" ? L.alu("#d9dde1")
			: look === "brick" ? L.MAT("massBrick", { color: "#a2523b", roughness: 0.9, metalness: 0 })
			: L.metal("turned", "#c1c6cc", 0.3)
		const out = [wood ? mesh(woodLathe(prof, R, H), (({ side, end }) => [side, end])(L.skin(ctx))) : mesh(kit.lathe(prof, 96, `mass|${f5(R)}|${f5(H)}`), bodyMat)]
		// the hook: a closed-looking wire eye, open at the top, standing on the neck in the plane facing the camera
		const wr = Math.max(0.0005, Math.min(0.0007, R * 0.045))
		const hr = Math.min(0.0029, R * 0.2)
		const hy = H / 2 + neckH + hr - wr * 0.6
		const gap = 0.32
		const ring = mesh(kit.torus(hr, wr, 10, 40, Math.PI * 2 - gap), L.steel("#b4bac0"))
		ring.rotation.z = HALF + gap / 2 + 0.0 // opening at the top, a little toward the front-left
		ring.position.y = hy
		out.push(ring)
		out.push(put(mesh(kit.sphere(wr * 1.35, 10, 8), L.steel("#b4bac0")), 0, H / 2 + neckH - 0.0003, 0))
		// the stamped value on the side wall, facing the camera
		const text = grams > 0 ? (grams >= 1000 ? `${+(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`) : ""
		if (text) {
			const patch = mesh(stampGeo(text, R, 0.34 * H), stampMat(), { cast: false })
			patch.position.y = -0.1 * H
			out.push(patch)
		}
		return group(out)
	}
	const grams = (kg) => (kg ?? 0) * 1000

	return { beam, screwEye, seat, screwOn, hookedMass, grams, mesh, group, sideOf, seedOf, HALF }
}
