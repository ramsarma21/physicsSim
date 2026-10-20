// Drink vessels: the PET water bottle (standing and on its side), the plastic party cup, the glass jar, the coffee mug. (helpers: everyday-b-lib.js)
// Every model fills its physics outline (side view, x-y; the outline numbers live in machines/catalog_everyday.py) to within a millimetre or two.
export default function register(addModel, L) {
	const { THREE, kit, TAU, rng, vnoise, fbm, clamp, mix, shade, blend, normalTex, dataTex, mat, colorTex, withRepeat, rr, fibres, spaced, latheLin, spline, flutedLathe, alongZ, disc, pixels, glassShadow } = L
	const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
	const sm = (t) => t * t * (3 - 2 * t)
	const mm = (pts) => pts.map(([a, b]) => [a / 1000, b / 1000])
	const latheMm = (pts, seg = 96) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r) / 1000, y / 1000)), seg)
	const lathe = (pts, seg = 96) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg)
	/** A profile [[r, y], ...] thinned to points at least `step` apart (the shadow proxies of clear things need only the silhouette, a millimetre or so: far fewer triangles). */
	const thin = (pts, step) => {
		const out = [pts[0]]
		for (let i = 1; i < pts.length - 1; i++) { const a = out[out.length - 1]; if (Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) >= step) out.push(pts[i]) }
		out.push(pts[pts.length - 1])
		return out
	}

	// ============================================================= the PET water bottle
	// nominal 65 × 205 mm (physics: a body 124 mm tall, a two-step shoulder to a 30.5 mm neck, the neck and cap as a second solid)
	const NOM_D = 65, NOM_H = 205
	function bottleShellProfile() {
		const pts = []
		// petaloid base: a standing ring, the middle domed up
		pts.push([0, 5.2], [9, 4.9], [18, 3.9], [23.5, 2.0], [26.2, 0.45], [27.4, 0], [29.6, 0], [31.1, 0.55], [32.0, 1.5], [32.45, 2.8])
		// the body: ring ribs low down (grip), grooves under the shoulder
		const grooves = [[9.5, 0.95, 1.5], [16, 0.95, 1.5], [22.5, 0.95, 1.5], [29, 0.95, 1.5], [36, 0.7, 1.4], [108, 0.85, 1.2], [113.5, 0.85, 1.2]] // [y, depth, sigma]
		const rAt = (y) => 32.5 - grooves.reduce((a, [yk, dep, sg]) => a + dep * Math.exp(-0.5 * ((y - yk) / sg) ** 2), 0)
		let y = 3.4
		while (y < 121) {
			const near = grooves.some(([yk, , sg]) => Math.abs(y - yk) < 2.5 * sg)
			pts.push([rAt(y), y])
			y += near ? 0.9 : 7
		}
		pts.push([rAt(121), 121])
		// the shoulder: a smooth dome through the polygon's chords (a hair outside them)
		for (const p of spline([[32.5, 121], [31.7, 130], [30.3, 138], [27.8, 147], [24.3, 154.5], [20.1, 160.5], [16.6, 164.6], [15.4, 166.5]], 3).slice(1)) pts.push(p)
		// the neck finish: a support ring just above the shoulder (never wider than the 30.5 mm neck block of the physics outline), then the threaded neck (the thread is added in makeBottle)
		// up under the cap, which starts at 185 mm
		pts.push([15.0, 167.2], [15.2, 168.0], [15.25, 168.7], [15.25, 170.5], [14.4, 171.3], [13.9, 172.2], [13.9, 190])
		return pts
	}
	const labelTex = (full) => colorTex(`eb-bottle-label|${full}`, 2048, 560, (g, W, H) => {
		// a wrap-around paper-free film label: white above a blue wave, a name, small print on the back (u = 0.5 faces the camera)
		const bg = g.createLinearGradient(0, 0, 0, H)
		bg.addColorStop(0, "#f7fbfe")
		bg.addColorStop(0.55, "#eaf4fb")
		bg.addColorStop(1, "#d3e8f5")
		g.fillStyle = bg
		g.fillRect(0, 0, W, H)
		// mountains behind the wave
		const mt = (yBase, amp, seed, col) => {
			g.fillStyle = col
			g.beginPath()
			g.moveTo(0, H)
			for (let x = 0; x <= W; x += 16) g.lineTo(x, yBase - amp * (0.55 * Math.abs(Math.sin(x * 0.0062 + seed)) + 0.45 * Math.abs(Math.sin(x * 0.0171 + seed * 2.1))))
			g.lineTo(W, H)
			g.closePath()
			g.fill()
		}
		mt(H * 0.79, H * 0.2, 3, "rgba(160,200,226,0.65)")
		mt(H * 0.85, H * 0.16, 7, "rgba(96,156,204,0.75)")
		// the wave band along the bottom
		const wv = g.createLinearGradient(0, H * 0.84, 0, H)
		wv.addColorStop(0, "#2b7fcf")
		wv.addColorStop(1, "#14529d")
		g.fillStyle = wv
		g.beginPath()
		g.moveTo(0, H)
		for (let x = 0; x <= W; x += 8) g.lineTo(x, H * 0.89 + Math.sin(x * 0.014) * H * 0.03 + Math.sin(x * 0.0043 + 1) * H * 0.025)
		g.lineTo(W, H)
		g.closePath()
		g.fill()
		g.strokeStyle = "rgba(255,255,255,0.7)"
		g.lineWidth = 3
		g.beginPath()
		for (let x = 0; x <= W; x += 8) { const y = H * 0.89 + Math.sin(x * 0.014) * H * 0.03 + Math.sin(x * 0.0043 + 1) * H * 0.025 + 6; x ? g.lineTo(x, y) : g.moveTo(x, y) }
		g.stroke()
		// a thin blue band at the top
		g.fillStyle = "#1b66b8"
		g.fillRect(0, 0, W, H * 0.07)
		// the name, at u = 0.5 (the front) and again at the back
		for (const cx of [W * 0.5, W * 0.0, W * 1.0]) {
			g.textAlign = "center"
			g.textBaseline = "alphabetic"
			g.fillStyle = "#0f4a92"
			g.font = `800 ${H * 0.2}px ${SANS}`
			g.fillText("SPRING", cx, H * 0.38)
			g.fillStyle = "#1f78c8"
			g.font = `300 ${H * 0.17}px ${SANS}`
			spaced(g, "WATER", cx, H * 0.56, H * 0.03)
			g.fillStyle = "#0f4a92"
			g.font = `600 ${H * 0.058}px ${SANS}`
			spaced(g, "NATURAL SOURCE  ·  500 mL", cx, H * 0.69, H * 0.008)
			// a drop
			g.fillStyle = "#2b8fe0"
			g.beginPath()
			g.moveTo(cx + H * 0.45, H * 0.17)
			g.bezierCurveTo(cx + H * 0.41, H * 0.26, cx + H * 0.395, H * 0.29, cx + H * 0.45, H * 0.31)
			g.bezierCurveTo(cx + H * 0.505, H * 0.29, cx + H * 0.49, H * 0.26, cx + H * 0.45, H * 0.17)
			g.fill()
		}
		// the back: small print
		g.fillStyle = "#33516f"
		g.font = `500 ${H * 0.035}px ${SANS}`
		g.textAlign = "left"
		const lines = ["NUTRITION FACTS", "Serving size 16.9 fl oz (500 mL)", "Calories 0   Sodium 0 mg   Total fat 0 g", "Please recycle this bottle.", "Best before: see cap"]
		lines.forEach((t, i) => g.fillText(t, W * 0.74, H * (0.2 + 0.075 * i)))
		// a barcode
		g.fillStyle = "#101820"
		const r = rng(5)
		for (let x = 0; x < 150; ) { const w2 = 2 + Math.floor(r() * 5); g.fillRect(W * 0.76 + x, H * 0.6, w2, H * 0.14); x += w2 + 2 + Math.floor(r() * 4) }
	})

	/** The bottle upright, base at y = 0, nominal size in metres. full: a PET shell with the water inside it (the neck above the water line is air);
	 *  lying: water right up to the neck (a bottle on its side holds its water against the cap). */
	function makeBottle({ full, lying = false }) {
		const g = kit.group()
		const prof = bottleShellProfile()
		const shell = latheMm(prof, 72)
		let threadMat
		if (full) {
			// the water: a transmissive volume inset 0.45 mm inside the shell, a flat (slightly dished) top at 160 mm, so the neck above it is visibly air
			const yMax = lying ? 168.6 : 160
			const rs = prof.filter(([, y], i) => i >= 10 && y >= 3.4) // (the first 10 points are the petaloid base, whose y runs back and forth: the body starts at the 11th)
			const rAtY = (y) => { for (let i = 1; i < rs.length; i++) if (rs[i][1] >= y) { const a = rs[i - 1], b = rs[i]; return mix(a[0], b[0], (y - a[1]) / (b[1] - a[1] || 1)) } return rs[rs.length - 1][0] }
			const rMin = (y) => { let r = Infinity; for (let k = -3; k <= 3; k++) r = Math.min(r, rAtY(y + k * 0.5)); return r } // the shell's tightest radius within 1.5 mm: the water is seen through the shell, it follows the grooves only roughly
			const wall = 0.45
			const wp = [[0, 5.2 + wall], [9, 4.9 + wall], [18, 3.9 + wall], [23.5, 2.0 + wall], [26.2, 0.9], [27.4, 0.5], [29.6, 0.5], [31.1, 1.0], [31.8, 2.0], [32.0 - wall, 3.0]]
			for (let y = 4.5; y < yMax - 1.5; y += y < 38 ? 2.5 : y < 100 ? 8 : 3) wp.push([rMin(y) - wall, y])
			const rTop = rAtY(yMax) - wall
			if (lying) wp.push([rTop, yMax], [0.001, yMax])
			else wp.push([rTop, yMax + 0.5], [rTop - 1.3, yMax + 0.1], [rTop - 5, yMax - 0.1], [0.001, yMax - 0.15])
			const zc = -(32.05 - 6) / 1000
			// a bottle on its side holds its air in a long bubble along the top (a 25 mL headspace is a bubble about 6 mm deep): the water's upper side (local -z once the model is laid
			// down) is cut by a plane 6 mm under the wall, so the bubble runs from the shoulder along the body; the shoulder and neck (narrower than that) stay full
			const cutTop = (geo) => {
				const P = geo.attributes.position
				for (let i = 0; i < P.count; i++) if (P.getZ(i) < zc) P.setZ(i, zc)
				geo.computeVertexNormals()
				return geo
			}
			const waterGeo = lying ? cutTop(latheMm(wp, 64)) : latheMm(wp, 64)
			const waterProxy = lying ? cutTop(latheMm(thin(wp, 2.5), 28)) : latheMm(thin(wp, 2.5), 28)
			let waterline = null
			if (lying) {
				// where the flat top meets the shell: sampled every 1.2 mm along the smooth shell (the grooves show as a gentle wave), from the base's dome to where the shoulder narrows past the plane
				const baseRows = [[1.0, 31.1], [2.0, 31.8], [3.0, 32.0 - wall], [3.4, rAtY(3.4) - wall]]
				const rw = (y) => (y < 3.4 ? L.profileAt(baseRows, y) : rAtY(y) - wall) / 1000
				waterline = []
				for (let y = 1.0; y < 170; y += 1.2) {
					const r = rw(y)
					if (r <= Math.abs(zc) + 1e-5) { if (waterline.length) break; else continue }
					waterline.push([y / 1000, Math.sqrt(r * r - zc * zc), zc - 0.00012])
				}
			}
			const water = mat("eb-water", { color: "#ffffff", roughness: 0.02, metalness: 0, transmission: 1, thickness: 0.05, ior: 1.333, attenuationColor: "#9fd2f2", attenuationDistance: 0.16, specularIntensity: 1, envMapIntensity: 1.2 })
			g.add(glassShadow(kit.mesh(waterGeo, water, { cast: false }), 0.5, waterProxy))
			if (waterline && waterline.length > 2) {
				// the water's flat top, seen from above through the bubble: a faint mirror (the air-water surface) with a bright thin line along each end where it meets the shell
				const pos = [], idx = []
				waterline.forEach(([y, hx, z], i) => { pos.push(-hx, y, z, hx, y, z); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) } })
				const sheet = new THREE.BufferGeometry()
				sheet.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
				sheet.setIndex(idx)
				sheet.computeVertexNormals()
				const sheetMat = mat("eb-waterline-sheet", { color: "#ffffff", roughness: 0.02, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2.4, specularIntensity: 1 })
				const sh = kit.mesh(sheet, sheetMat, { cast: false })
				sh.renderOrder = 1
				g.add(sh)
				const lineMat = mat("eb-waterline-edge", { color: "#ffffff", roughness: 0.08, metalness: 0, transparent: true, opacity: 0.8, depthWrite: false, envMapIntensity: 2 })
				const nLine = waterline.length
				const loop = [...waterline.map(([y, hx, z]) => new THREE.Vector3(-hx, y, z)), ...waterline.slice().reverse().map(([y, hx, z]) => new THREE.Vector3(hx, y, z))]
				const ln = kit.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loop, true), 2 * nLine, 0.00026, 4, true), lineMat, { cast: false })
				ln.renderOrder = 1
				g.add(ln)
			}
			// the thin PET shell over it: nearly clear, so only its highlights and edge reflections show on the water
			const pet = mat("eb-pet-over-water", { color: "#ffffff", roughness: 0.05, metalness: 0, ior: 1.57, specularIntensity: 1.6, envMapIntensity: 1.8, transparent: true, opacity: 0.2, depthWrite: false, clearcoat: 0.3, clearcoatRoughness: 0.08 })
			const shellMesh = kit.mesh(shell, pet, { cast: false })
			shellMesh.renderOrder = 2
			g.add(shellMesh)
			threadMat = pet
		} else {
			const shellMat = mat("eb-pet-empty", { color: "#ffffff", roughness: 0.05, metalness: 0, transmission: 1, thickness: 0.0012, ior: 1.57, attenuationColor: "#ffffff", attenuationDistance: 1, specularIntensity: 1.2, clearcoat: 0.3, clearcoatRoughness: 0.06, envMapIntensity: 1.4 })
			g.add(glassShadow(kit.mesh(shell, shellMat, { cast: false }), 0.25, latheMm(thin(prof, 2.5), 28)))
			threadMat = shellMat
		}
		// the screw thread on the neck finish, between the support ring and the cap: two turns of a raised helix (one tube: a few hundred triangles)
		{
			const th = []
			for (let k = 0; k <= 96; k++) {
				const t = k / 96, a = t * 2.1 * TAU
				th.push(new THREE.Vector3(Math.cos(a) * 14.2 / 1000, mix(173.6, 183.8, t) / 1000, Math.sin(a) * 14.2 / 1000))
			}
			g.add(kit.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(th), 96, 0.55 / 1000, 5, false), threadMat, { cast: false }))
		}
		// the label (a film wrapped round the middle)
		const labelMat = mat("eb-bottle-label", { map: labelTex(full), roughness: 0.38, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.2 })
		g.add(kit.mesh(latheLin(mm([[32.62, 40], [32.62, 100]]), 72, 0.040, 0.100), labelMat))
		// the cap: blue, fluted, with a tamper band under it and a domed top
		const capMat = mat("eb-cap", { color: "#1f62c4", roughness: 0.32, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.2, toneMapped: false })
		const capPts = [[14.7, 185.0], [15.05, 185.4], [15.1, 188.6], [14.35, 189.1], [14.35, 189.7], [15.2, 190.2], [15.25, 202.2]] // a 28 mm cap: 15 mm tall over a 3.6 mm tamper band
		for (let k = 1; k <= 5; k++) { const a = (k / 5) * (Math.PI / 2); capPts.push([15.25 - 2 * (1 - Math.cos(a)), 202.8 + 2 * Math.sin(a) * 1.0]) }
		capPts.push([8, 205], [0, 205.05])
		const cap = flutedLathe(mm(capPts), 108, 36, 0.011, 0.1902, 0.2022)
		g.add(kit.mesh(cap, capMat))
		// the tamper band's thin bridges and its lower rim are enough; a darker seam sits between the band and the cap
		const seam = kit.mesh(latheMm([[14.3, 189.0], [14.3, 190.0]], 48), mat("eb-cap-seam", { color: "#143f7a", roughness: 0.6, side: THREE.DoubleSide }))
		g.add(seam)
		return g
	}
	// the nominal bottle is built once per state (nothing in it depends on the size: every size is that model scaled), and cloned: a resize slider step costs a clone, not a rebuild
	const nomBottles = new Map()
	const bottleNom = (full, lying = false) => {
		const k = `${full}|${lying}`
		let b = nomBottles.get(k)
		if (!b) nomBottles.set(k, (b = makeBottle({ full, lying })))
		return b.clone()
	}
	addModel("water-bottle", "body", ({ props, w, h }) => {
		const g = bottleNom(props.full !== false)
		const D = props.diameter ?? w, H = props.height ?? h
		g.scale.set(D / (NOM_D / 1000), H / (NOM_H / 1000), D / (NOM_D / 1000))
		g.position.y = -H / 2
		return kit.group(g)
	})
	addModel("water-bottle", "neck", null)
	addModel("water-bottle-side", "body", ({ r, solid, props }) => {
		const g = bottleNom(props.full !== false, true)
		const Ln = solid.depth3d ?? solid.length ?? props.length ?? 0.205
		g.scale.set((2 * r) / (NOM_D / 1000), Ln / (NOM_H / 1000), (2 * r) / (NOM_D / 1000))
		g.position.y = -Ln / 2
		return alongZ(kit.group(g))
	})

	// ============================================================= the plastic party cup (static: floor + two walls; the model hangs on "floor")
	function cupParts(props) {
		const W = props.width, H = props.wall, t = props.thickness, Wb = W * props.bottom_ratio
		const run = (W - Wb) / 2
		const Lw = Math.hypot(run, H)
		const phi = Math.atan2(run, H)
		const cx = (Wb - t) / 2 + run / 2 // the right wall slab's centre x; its centre y is H / 2
		const u = [Math.sin(phi), Math.cos(phi)] // along the wall, bottom to top
		const n = [Math.cos(phi), -Math.sin(phi)] // outward
		const corner = (a, b) => [cx + a * (Lw / 2) * u[0] + b * (t / 2) * n[0], H / 2 + a * (Lw / 2) * u[1] + b * (t / 2) * n[1]]
		return { W, H, t, Wb, outerBottom: corner(-1, 1), outerTop: corner(1, 1), innerBottom: corner(-1, -1), innerTop: corner(1, -1), phi }
	}
	addModel("plastic-cup", "floor", ({ props, solid }) => {
		const c = cupParts(props)
		const { H, t, Wb, outerBottom, outerTop, innerBottom, innerTop } = c
		const red = solid?.color ?? "#bd2218" // (painted: the item's colour prop)
		const g = kit.group()
		// exterior: from the floor's underside up the outside of the wall, then a rolled lip
		const lipR = 0.0017
		const outer = [[0, -t], [Wb / 2 - 0.0015, -t], [Wb / 2 - 0.0004, -t + 0.0003], [outerBottom[0] + 0.0001, -t + 0.0014]]
		// the wall's outer line, sampled with a few shallow grooves (the cup's stiffening rings) cut inward
		const grooves = [[0.30, 0.0006], [0.62, 0.0006], [0.70, 0.0006]]
		for (let k = 0; k <= 40; k++) {
			const s = k / 40
			const x = mix(outerBottom[0], outerTop[0], s)
			const y = mix(outerBottom[1], outerTop[1], s)
			const dep = grooves.reduce((a, [sg, d]) => a + d * Math.exp(-0.5 * ((s - sg) / 0.012) ** 2), 0)
			outer.push([x - dep * Math.cos(c.phi), y + dep * Math.sin(c.phi)])
		}
		// the rolled lip: a bead curling outward and over the top
		const top = outerTop
		const lip = []
		// the bead sits inside the wall slab's top corner: its outer edge at the slab's outer corner, its crown at the slab's top (never above or beside the physics wall)
		const lipCx = top[0] - 0.9 * lipR, lipCy = top[1] - lipR
		for (let k = 0; k <= 10; k++) {
			const a = (k / 10) * Math.PI * 1.05 // from the outside, over the top, to the inside
			lip.push([lipCx + lipR * 0.9 * Math.cos(a), lipCy + lipR * Math.sin(a)])
		}
		// a grip of fine vertical flutes on the lower wall: a normal map (one flute per tile, 28 round the cup) that fades out above 40 % of the wall
		const flutes = normalTex("eb-cup-flutes", 32, 256, (g2, Wc, Hc) => pixels(g2, Wc, Hc, (x, y) => {
			const v = 1 - y / Hc
			const m = sm(clamp((v - 0.07) / 0.03)) * (1 - sm(clamp((v - 0.38) / 0.04)))
			const h = 0.5 + 0.5 * Math.cos((x / Wc) * TAU)
			const k = 128 + 110 * m * (h - 0.5)
			return [k, k, k]
		}), { strength: 2.4, blur: 0 })
		const outerMat = mat("eb-cup-red2|" + red, { color: red, roughness: 0.34, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3, toneMapped: false, normalMap: withRepeat(flutes, 28, 1), normalScale: new THREE.Vector2(0.85, 0.85) })
		const innerMat = mat("eb-cup-white", { color: "#f3f0ea", roughness: 0.4, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.3, side: THREE.DoubleSide })
		g.add(kit.mesh(lathe([...outer, ...lip.slice(0, 6)], 128), outerMat))
		g.add(kit.mesh(lathe([...lip.slice(5), [innerTop[0], innerTop[1] - 0.0002], [innerBottom[0] + 0.0001, 0.0006], [innerBottom[0] - 0.0008, 0], [0.0, 0]], 128), innerMat))
		g.position.y = t / 2 // the model's origin is the floor slab's centre: the item's origin is the top of the floor
		return kit.group(g)
	})
	addModel("plastic-cup", "left", null)
	addModel("plastic-cup", "right", null)

	// ============================================================= the glass jar
	function jarProfile(props) {
		const W = props.width, H = props.wall
		const hb = 0.768 * H, hs = 0.875 * H, rn = 0.897 * W / 2
		// the glass's thickness; glass thicker than the neck's radius (a narrow jar with the thickness slider high: the physics walls overlap into solid glass) leaves a 0.8 mm bore
		const t = Math.min(props.thickness, rn - 0.0008)
		const cl = [[W / 2 - t / 2, 0], [W / 2 - t / 2, hb], [rn - t / 2, hs], [rn - t / 2, H]] // the glass's centre line, right half
		// offset by +-t/2 with mitred joints
		const norm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dy / l, -dx / l] }
		const offs = (sgn) => cl.map((p, i) => {
			const nA = i > 0 ? norm(cl[i - 1], p) : null
			const nB = i < cl.length - 1 ? norm(p, cl[i + 1]) : null
			const a = nA ?? nB, b = nB ?? nA
			const m = [a[0] + b[0], a[1] + b[1]]
			const ml = Math.hypot(m[0], m[1])
			const k = (t / 2) / (ml / 2) // mitre length
			return [p[0] + sgn * (m[0] / ml) * k, p[1] + sgn * (m[1] / ml) * k]
		})
		return { W, H, t, hb, hs, rn, outer: offs(1), inner: offs(-1) }
	}
	// the lettering pressed into the glass: a height drawing (white = raised) in the body lathe's uv (u round, 0.5 at the camera; v up the
	// 115.5 mm from the floor's underside to just above the rim), 0.1334 mm per pixel round the body. It becomes the frosted roughness map and a normal map
	// (the 0.35 mm relief catches the light as the lettering does; no geometry is spent on it)
	const EMB_W = 2048, EMB_H = 1024
	const paintEmboss = (g2, bg, fg) => {
		g2.fillStyle = bg
		g2.fillRect(0, 0, EMB_W, EMB_H)
		g2.fillStyle = fg
		g2.strokeStyle = fg
		g2.textAlign = "center"
		g2.textBaseline = "middle"
		const yPx = (mmY) => (1 - (mmY + 3) / 115.5) * EMB_H // mm above the floor's top -> canvas row
		const cx = EMB_W * 0.5
		g2.font = `800 118px ${SANS}`
		g2.fillText("PINT", cx, yPx(58))
		g2.font = `700 60px ${SANS}`
		spaced(g2, "16 OZ  ·  473 mL", cx, yPx(43.5), 4)
		g2.lineWidth = 8
		g2.beginPath(); g2.moveTo(cx - 190, yPx(50.2)); g2.lineTo(cx + 190, yPx(50.2)); g2.stroke()
		// a ring of round beads near the base
		for (let k = 0; k < 85; k++) { g2.beginPath(); g2.arc(((k + 0.5) / 85) * EMB_W, yPx(8.6), 11, 0, TAU); g2.fill() }
	}
	/** The frosted lettering's roughness map: clear glass (0.04) with the raised letters and beads satin (0.55). */
	const embossRough = () => dataTex("eb-jar-emboss-rough", EMB_W / 2, EMB_H / 2, (g2) => { g2.scale(0.5, 0.5); paintEmboss(g2, "rgb(10,10,10)", "rgb(140,140,140)") })
	const embossNormal = () => normalTex("eb-jar-emboss-nrm", EMB_W / 2, EMB_H / 2, (g2) => { g2.scale(0.5, 0.5); paintEmboss(g2, "#000", "#fff") }, { strength: 2.4, blur: 0.8, wrap: false })
	addModel("glass-jar", "floor", ({ props }) => {
		const p = jarProfile(props)
		const { W, H, rn } = p
		const t = props.thickness // (the floor: the physics floor slab is this thick whatever the walls are)
		const tw = p.t // the walls' glass
		const nk = H - p.hs // the neck's height: 14 mm on the 112 mm jar; the shoulder's and rim's roundings fit in it on a short jar
		const g = kit.group()
		// clear glass: a closed shell (outer wall, rim, inner wall, floor), front faces only, no clearcoat, so the table shows through sharp
		const glass = mat("eb-jar-glass2", { color: "#ecf7f1", roughness: 1, roughnessMap: embossRough(), normalMap: embossNormal(), normalScale: new THREE.Vector2(1.1, 1.1), metalness: 0, transmission: 1, thickness: 0.004, ior: 1.5, attenuationColor: "#bde6d4", attenuationDistance: 0.09, specularIntensity: 1.0, clearcoat: 0, envMapIntensity: 1.1, side: THREE.FrontSide })
		// outside: floor underside -> the body -> shoulder -> neck -> the rim (rounded) -> inside down to the floor
		const o = p.outer, i = p.inner
		const prof = []
		prof.push([0, -t], [W / 2 - 0.0035, -t], [W / 2 - 0.0018, -t + 0.0003], [W / 2 - 0.0004, -t + 0.0014])
		prof.push([o[0][0], 0.0016])
		let yy = 0.0016
		while (yy < o[1][1] - 0.012) { yy = Math.min(o[1][1] - 0.012, yy + 0.016); prof.push([o[0][0], yy]) }
		const rr = Math.min(0.45 * tw, 0.45 * nk, 0.0015) // the rim's rounded corners (a half-round on 3 mm glass; thick glass keeps a flat top with 1.5 mm corners inside its slab)
		const nUp = Math.min(0.0025, 0.18 * nk), nTop = Math.max(Math.min(0.0012, 0.086 * nk), rr) // up the neck from the shoulder; down from the rim's top to where its round starts
		for (const q of spline([[o[1][0], o[1][1] - 0.006], [o[1][0] + 0.0001, o[1][1]], [mix(o[1][0], o[2][0], 0.5) + 0.0004, mix(o[1][1], o[2][1], 0.5)], [o[2][0], o[2][1]], [o[2][0], o[2][1] + nUp]], 4)) prof.push(q)
		prof.push([o[3][0] - 0.0001, o[3][1] - nTop])
		for (let k = 0; k <= 4; k++) { const a = (k / 4) * (Math.PI / 2); prof.push([o[3][0] - rr + Math.cos(a) * rr, H - rr + Math.sin(a) * rr]) }
		for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 + (k / 4) * (Math.PI / 2); prof.push([i[3][0] + rr + Math.cos(a) * rr, H - rr + Math.sin(a) * rr]) }
		// the inside: down the neck and the shoulder, down the wall, and across the floor's top (it runs inward at every width: a fixed 12 mm centre folded back through the wall of a narrow jar)
		const fl = i[0][0] - Math.min(0.0022, 0.25 * i[0][0])
		for (const q of [[i[3][0], i[3][1] - nTop], [i[2][0], i[2][1] + nUp], [i[2][0], i[2][1]], [i[1][0], i[1][1]], [i[1][0], Math.min(0.004, 0.5 * i[1][1])], [fl, 0.0004], [Math.min(0.012, 0.5 * fl), 0.0001], [0, 0]]) prof.push(q)
		const body = latheLin(prof, 112, -t, H + 0.0005)
		g.add(glassShadow(kit.mesh(body, glass, { cast: false }), 0.25))
		// the screw thread on the neck: nearly two turns of a raised helix
		const th = []
		const y0 = p.hs + 0.25 * nk, y1 = H - 0.18 * nk // 3.5 mm above the shoulder to 2.5 mm under the rim on the 14 mm neck: below the rim at every height
		const kt = Math.min(1, nk / 0.014, rn / 0.039) // a small jar's thread is finer: 0.6 mm round, 0.3 mm proud on the pint jar
		for (let k = 0; k <= 120; k++) {
			const s = k / 120
			const a = s * 1.8 * TAU
			th.push(new THREE.Vector3(Math.cos(a) * (rn + 0.0003 * kt), mix(y0, y1, s), Math.sin(a) * (rn + 0.0003 * kt)))
		}
		g.add(kit.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(th), 120, 0.0006 * kt, 6, false), mat("eb-jar-glass-plain", { color: "#ffffff", roughness: 0.03, metalness: 0, transmission: 1, thickness: 0.004, ior: 1.5, attenuationColor: "#a9dcc4", attenuationDistance: 0.05, envMapIntensity: 1.8 }), { cast: false }))
		// the two-piece canning lid, when it is on: a screw band (12 mm tall, knurled, a 4 mm lip folded in over the rim) and the flat lid disc seated under the lip
		if (props.lid) {
			const lr = rn + 0.0015, top = H + 0.010 // the physics lid slab: x +-(rn + 1.5 mm), from H - 2 mm to H + 10 mm
			const steel = mat("eb-jar-lid", { color: "#b9bdc2", roughness: 0.32, metalness: 1 })
			const lip = 0.0042
			const band = [[lr - 0.0012, H - 0.002], [lr - 0.0004, H - 0.0019], [lr, H - 0.0016]]
			for (let k = 0; k <= 4; k++) band.push([lr, mix(H - 0.0016, top - 0.0012, k / 4)])
			for (let k = 1; k <= 5; k++) { const a = (k / 5) * (Math.PI / 2); band.push([lr - 0.0012 * (1 - Math.cos(a)), top - 0.0012 + 0.0012 * Math.sin(a)]) }
			band.push([lr - lip + 0.0008, top], [lr - lip, top - 0.0006], [lr - lip, top - 0.0014]) // across the lip's top, down its inner edge
			band.push([rn + 0.0004, top - 0.0014], [rn + 0.0004, H - 0.002], [lr - 0.0012, H - 0.002]) // under the lip, down inside the band, back to the start
			g.add(kit.mesh(flutedLathe(band, 180, 90, 0.0055, H - 0.0016, top - 0.0045), steel))
			// the flat lid disc: a flange under the lip, a centre that rises into the lip's hole to 0.6 mm under its top, with a pressed ring
			const rd = lr - 0.0012, ct = top - 0.0006
			const disc = [[0, top - 0.0050], [rd - 0.0006, top - 0.0050], [rd, top - 0.0044], [rd, top - 0.0021], [rd - 0.0005, top - 0.0021], [lr - lip - 0.0001, top - 0.0021],
				[lr - lip - 0.0006, ct - 0.0001], [lr - lip - 0.0018, ct], [lr - lip - 0.0030, ct - 0.0007], [lr - lip - 0.0044, ct], [rd * 0.42, ct - 0.0002], [0, ct - 0.0003]]
			g.add(kit.mesh(new THREE.LatheGeometry(disc.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), 96), mat("eb-jar-lid-disc", { color: "#c4c8cc", roughness: 0.28, metalness: 1 })))
		}
		g.position.y = t / 2
		return kit.group(g)
	})
	for (const part of ["left", "right", "left-shoulder", "right-shoulder", "left-neck", "right-neck", "lid"]) addModel("glass-jar", part, null)

	// ============================================================= the coffee mug
	// physics (machines/catalog_everyday.py, mm, origin at the middle of the 95 mm body): a floor 7.9 mm thick, two walls 4.3 mm thick, and a C handle of three pieces
	// (10 mm strap, arms at y -30..-20 and 27..37, outer bar to x 77, outer corners of radius 16)
	// the mug's body and handle at the nominal size, built once per glaze colour (a resize is a scale of it)
	const nomMugs = new Map()
	const makeMug = (color) => {
		const g = kit.group()
		let handle = null
		const R = 0.041, Hh = 0.095
		const glazeColor = color || "#f2eee6"
		// the two thin blue bands are painted into the glaze's colour map (a texture on the outer wall's lathe), not laid over it as separate shells
		const bandMap = colorTex(`eb-mug-bands|${Hh}`, 4, 2048, (g2, Wc, Hc) => {
			g2.fillStyle = "#ffffff"
			g2.fillRect(0, 0, Wc, Hc)
			const yPx = (mmY) => (1 - mmY / 95) * Hc
			for (const [y0, y1] of [[76.8, 79.6], [81.4, 83.0]]) {
				g2.fillStyle = "#3f7f9f"
				g2.fillRect(0, yPx(y1), Wc, yPx(y0) - yPx(y1))
			}
		})
		const glaze = mat(`eb-mug-glaze|${glazeColor}`, { color: glazeColor, map: bandMap, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.2, sheenColor: "#ffffff" })
		const glazePlain = mat(`eb-mug-glaze-plain|${glazeColor}`, { color: glazeColor, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.2, sheenColor: "#ffffff" })
		const rawClay = mat("eb-mug-foot", { color: "#c9a77f", roughness: 0.9, metalness: 0 })
		// the body: a foot ring of bare clay, the glazed wall, a rounded rim; the inside down to a thick floor
		const foot = lathe([[0.0, 0.0006], [0.0345, 0.0006], [0.0345, 0.0], [0.0385, 0.0], [0.0392, 0.0006], [0.0394, 0.0022]], 96)
		g.add(kit.mesh(foot, rawClay))
		const outer = [[0.0394, 0.0022], [0.0402, 0.0034], [0.0406, 0.0058], [R, 0.0145]]
		for (let y = 0.026; y < Hh - 0.0016; y += 0.012) outer.push([R, y])
		outer.push([R, Hh - 0.0016])
		const rim = []
		for (let k = 1; k <= 12; k++) { const a = (k / 12) * Math.PI; rim.push([0.0389 + 0.0021 * Math.cos(a), Hh - 0.0016 + 0.0016 * Math.sin(a)]) }
		const innerWall = [[0.0368, Hh - 0.0016], [0.0368, 0.0155], [0.0358, 0.0098], [0.0335, 0.0082], [0.0, 0.0078]]
		const prof = [...outer, ...rim, ...innerWall]
		const bodyG = latheLin(prof, 128, 0, Hh)
		{
			// the bands are only on the outside: everything after the rim samples the white row of the map
			const uv = bodyG.attributes.uv, NP = prof.length, innerStart = outer.length + rim.length - 1
			for (let k = 0; k < uv.count; k++) if (k % NP >= innerStart) uv.setY(k, 0.0)
		}
		g.add(kit.mesh(bodyG, glaze))
		// the handle: a flattened ceramic strap swept along a D-shaped centre line (10 mm in the plane, 13 mm across, wider across and a little fuller where it joins the wall; its ends are buried in the wall)
		{
			// centre line [x, y] mm, one smooth D: out of the wall at y 32, round the top corner, down a bar at x 72 (its outer edge reaches the C outline's 77), round the bottom corner, back to the wall at y -25
			// the physics handle is a C: arms 10 mm thick (centre lines y 32 and -25), an outer bar 8.8 mm thick (x 68.2 - 77, centre 72.6: the pieces are 1.2 mm apart in the outline), the outer corners round
			// (radius 16 about (61, 21) and (61, -14)) and the finger hole's corners square (its sides: the arms' faces at y 27 and -20, the bar's at x 68.2). The strap follows it: straight runs, and round each
			// corner an arc about the corner's centre whose inner edge r_in(a) = the hole's boundary seen from that centre (the nearer of the two faces, eased by 1.2 mm where they meet) and whose outer
			// edge is the outline's 16 mm: centre line radius (16 + r_in) / 2, half width (16 - r_in) / 2 (5 mm on the arm, 3.4 mm at the hole's corner, 4.4 mm on the bar)
			const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25 }
			const rIn = (a) => smin(6 / Math.max(Math.sin(a), 1e-6), 7.2 / Math.max(Math.cos(a), 1e-6), 1.2) // a: angle from the bar's direction (0) to the arm's (90 degrees)
			const arc = (cy, sg, a0, a1, n) => Array.from({ length: n + 1 }, (_, k) => { const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180, R = (16 + rIn(Math.min(Math.max(a, 0.0), Math.PI / 2))) / 2; return [61 + R * Math.cos(a), cy + sg * R * Math.sin(a)] })
			const pl = [[38.9, 32], [46, 32], [54, 32], ...arc(21, 1, 90, 0, 14), [72.6, 8], [72.6, -4], ...arc(-14, -1, 0, 90, 14), [54, -25], [46, -25], [38.9, -25]] // its two ends sit in the 41 - 36.8 mm thickness of the wall (35.9 - 40.2 mm out at the strap's 7.9 mm half-width), so they never show inside the cup
			const raAt = (x, y) => { // half width in the plane (mm) at a centre-line point
				if (x <= 61) return 5
				const cy = y > 21 ? 21 : y < -14 ? -14 : null
				if (cy === null) return 4.4
				return (16 - rIn(Math.atan2(Math.abs(y - cy), x - 61))) / 2
			}
			const path = new THREE.CatmullRomCurve3(pl.map(([x, y]) => new THREE.Vector3(x / 1000, y / 1000, 0)), false, "centripetal")
			const len = path.getLength()
			const NR = 28
			const RF = 0.004, FY = 0.0015, WALL_R = 0.041 // the fillet's radius across the depth, its growth in the strap's plane, and the body's outer radius (m)
			// the rings along the strap: every 0.75 mm, and through each root's fillet 16 steps of its quarter circle (even in angle, so the last millimetre, where the skirt turns to lie
			// along the wall, is as finely drawn as the rest: coarser, its last ring stood on the wall as a flat disc with an edge)
			const ts = []
			for (let i = 0; i <= 240; i++) { const d = Math.min(i / 240, 1 - i / 240) * len; if (d <= 0.0021 || d >= 0.0021 + RF) ts.push(i / 240) }
			for (let k = 0; k <= 16; k++) { const d = 0.0021 + RF * (1 - Math.cos((k / 16) * (Math.PI / 2))); ts.push(d / len, 1 - d / len) }
			ts.sort((p, q) => p - q)
			for (let i = ts.length - 1; i > 0; i--) if (ts[i] - ts[i - 1] < 2e-5) ts.splice(i, 1) // (no two rings within 4 microns)
			const NT = ts.length - 1
			const pos = [], idx = [], wallW = [] // wallW: per ring, how far its normals are turned to the wall's (1 at the root, where the skirt lies on the wall)
			for (let i = 0; i <= NT; i++) {
				const t = ts[i]
				const P = path.getPointAt(t), T = path.getTangentAt(t)
				const N = new THREE.Vector3(-T.y, T.x, 0)
				const dEnd = Math.min(t, 1 - t) * len // metres to the nearer end
				const full = 1 + 0.1 * (1 - t) // a touch fuller across toward the top attachment
				const dS = Math.min(Math.max(0, dEnd - 0.0021), RF) // metres beyond the wall's surface (0 at the wall), up to the fillet's radius
				const fz = RF - Math.sqrt(Math.max(0, RF * RF - (RF - dS) ** 2)) // a quarter circle: 0 beyond the fillet, RF at the wall
				wallW.push(dEnd <= 0.0021 ? 1 : Math.max(0, 1 - dS / 0.0008) ** 2)
				const fy = FY * (fz / RF) // the same fillet in the strap's own plane, kept to 1.5 mm (the outline allows about 2 mm)
				const ra = 0.001 * raAt(P.x * 1000, P.y * 1000) + fy
				// and across its depth a fillet where it meets the wall: from the wall's surface (2.1 mm before the path's end) outward over 4 mm, its half width grows by a quarter circle of radius 4 mm, tangent to the
				// strap's sides and (at the wall) to the cylinder, and its points follow the cylinder in (x) so the skirt lies ON the wall: the root blends into the glaze instead of standing on it as a knob.
				// (The depth is not tied to the outline's thin handle: the physics pieces are 16 mm deep, the skirt reaches 10.5 mm either side.)
				const rb = Math.min(0.0079, 0.0065 * full * (1 + 0.08 * Math.min(1, fz / RF))) + fz
				for (let j = 0; j <= NR; j++) {
					const f = (j / NR) * TAU
					const c = Math.cos(f), sn = Math.sin(f)
					// a rounded-rectangle-ish oval: flatter faces across, rounder edges in the plane
					const e = 0.8
					const z = rb * Math.sign(sn) * Math.abs(sn) ** e
					const cyl = (fz / RF) * (WALL_R - Math.sqrt(Math.max(0, WALL_R * WALL_R - z * z))) // how far the cylinder falls away at this z (the skirt's points follow it)
					pos.push(P.x + N.x * ra * Math.sign(c) * Math.abs(c) ** e - cyl, P.y + N.y * ra * Math.sign(c) * Math.abs(c) ** e, z)
				}
			}
			for (let i = 0; i < NT; i++) for (let j = 0; j < NR; j++) { const a = i * (NR + 1) + j, b = a + 1, c = a + NR + 1, d = c + 1; idx.push(a, b, c, b, d, c) }
			const hg = new THREE.BufferGeometry()
			hg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			hg.setIndex(idx)
			hg.computeVertexNormals()
			// face outward: the first vertex of a ring at phi = 0 lies on +N: its normal must point that way
			const nn = new THREE.Vector3().fromBufferAttribute(hg.attributes.normal, Math.floor(NT / 2) * (NR + 1))
			const pp = new THREE.Vector3().fromBufferAttribute(hg.attributes.position, Math.floor(NT / 2) * (NR + 1)).sub(path.getPointAt(0.5))
			if (nn.dot(pp) < 0) { for (let k = 0; k < idx.length; k += 3) { const t2 = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t2 } hg.setIndex(idx); hg.computeVertexNormals() }
			// at each root the skirt's normals turn to the wall's (straight out from the mug's axis), so its edge on the wall shades as the wall does: no seam where it meets the glaze
			{
				const nrm = hg.attributes.normal, P3 = hg.attributes.position, v = new THREE.Vector3(), w3 = new THREE.Vector3()
				for (let i = 0; i <= NT; i++) {
					const w = wallW[i]
					if (!(w > 0)) continue
					for (let j = 0; j <= NR; j++) {
						const k = i * (NR + 1) + j
						w3.set(P3.getX(k), 0, P3.getZ(k)).normalize()
						v.fromBufferAttribute(nrm, k).multiplyScalar(1 - w).addScaledVector(w3, w).normalize()
						nrm.setXYZ(k, v.x, v.y, v.z)
					}
				}
				nrm.needsUpdate = true
			}
			handle = kit.mesh(hg, glazePlain)
		}
		return { g, handle }
	}
	addModel("coffee-mug", "body", ({ props, color }) => {
		const D = props.diameter ?? 0.082, H = props.height ?? 0.095
		const sx = D / 0.082, sy = H / 0.095
		let nom = nomMugs.get(color ?? "")
		if (!nom) nomMugs.set(color ?? "", (nom = makeMug(color)))
		const g = nom.g.clone(), handle = nom.handle.clone()
		g.scale.set(sx, sy, sx)
		g.position.y = -H / 2
		// the handle is drawn in the physics frame (origin at the middle of the body) and scaled evenly by the smaller of the two stretches, its root staying on the wall (as machines/catalog_everyday.py's mug_up does)
		const u = Math.min(sx, sy)
		handle.scale.setScalar(u)
		handle.position.x = 0.041 * (sx - u)
		return kit.group(g, handle)
	})
	for (const part of ["wall-left", "wall-right", "handle-top", "handle", "handle-bottom"]) addModel("coffee-mug", part, null)
}
