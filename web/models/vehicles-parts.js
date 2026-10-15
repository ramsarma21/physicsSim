// Small parts shared by the car and truck models: headlamps, tail lamps, grille, mirrors, seats, steering wheel, dashboard, thin glass panes.
// All lengths are metres; every part is built facing +z (a lamp's lens looks toward +z) at the origin; turn it with rotation.y to face +x (the nose) or -x (the tail).
export function makeParts(L, kit) {
	const T = L.THREE
	const { TAU, mat, put, M, plate, roundPoly } = L

	/** A thin four-cornered pane of glass between four points (a quad, counter-clockwise seen from the front), thick `thick`, the front face toward `normal`. */
	function quadSlab(c, normal, thick, key) {
		return kit.geo(`veh|quadslab|${key}|${c.map((p) => p.map((v) => v.toFixed(5)).join(",")).join(";")}|${thick}`, () => {
			const n = new T.Vector3(...normal).normalize()
			const P = []
			for (const p of c) P.push(p[0] + n.x * thick / 2, p[1] + n.y * thick / 2, p[2] + n.z * thick / 2)
			for (const p of c) P.push(p[0] - n.x * thick / 2, p[1] - n.y * thick / 2, p[2] - n.z * thick / 2)
			const idx = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]
			for (let i = 0; i < 4; i++) {
				const j = (i + 1) % 4
				idx.push(i, i + 4, j + 4, i, j + 4, j)
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(P, 3))
			g.setIndex(idx)
			const out = L.creased(g, 30)
			// orientation: the front must face along `normal`
			const pos = out.attributes.position
			const a = new T.Vector3().fromBufferAttribute(pos, 0)
			const b = new T.Vector3().fromBufferAttribute(pos, 1)
			const d = new T.Vector3().fromBufferAttribute(pos, 2)
			const fn = new T.Vector3().crossVectors(b.sub(a), d.sub(a))
			if (fn.dot(n) < 0) {
				const idx2 = []
				for (let i = 0; i < idx.length; i += 3) idx2.push(idx[i], idx[i + 2], idx[i + 1])
				g.setIndex(idx2)
				return L.creased(g, 30)
			}
			return out
		})
	}

	// ------------------------------------------------------------------ lamps
	const reflector = (key, tint) => kit.tex(`veh|reflector|${key}|${tint}`, 256, 256, (g, W, H) => {
		const c = W / 2
		const grd = g.createRadialGradient(c, c, 0, c, c, c)
		grd.addColorStop(0, "#ffffff")
		grd.addColorStop(0.18, tint)
		grd.addColorStop(0.6, L.shade(tint, 0.75))
		grd.addColorStop(1, L.shade(tint, 0.5))
		g.fillStyle = grd
		g.fillRect(0, 0, W, H)
		// reflector facets: concentric rings and spokes
		g.strokeStyle = "rgba(60,60,70,0.28)"
		g.lineWidth = 2
		for (let r = 0.3; r < 1; r += 0.2) {
			g.beginPath()
			g.arc(c, c, r * c, 0, TAU)
			g.stroke()
		}
		for (let i = 0; i < 14; i++) {
			const a = (i / 14) * TAU
			g.beginPath()
			g.moveTo(c + Math.cos(a) * c * 0.28, c + Math.sin(a) * c * 0.28)
			g.lineTo(c + Math.cos(a) * c * 0.96, c + Math.sin(a) * c * 0.96)
			g.stroke()
		}
		g.fillStyle = "#fffdf2"
		g.beginPath()
		g.arc(c, c, c * 0.17, 0, TAU)
		g.fill()
	}, { wrap: false })

	/** A round headlamp of radius R: a chrome bezel ring, a dished lens with a reflector behind it; sits proud of the face by about 0.35 R. */
	function headlamp(R, { tint = "#fff1c8", glow = 0.22, key = "" } = {}) {
		const g = kit.group()
		g.add(put(kit.torus(R * 0.93, R * 0.1, 6, 28), M.chrome("#dfe2e7"), 0, 0, R * 0.08))
		g.add(put(kit.cylinderZ(R * 0.98, R * 0.1, 28), mat("lampcup", { color: "#17181a", roughness: 0.5, metalness: 0.5 }), 0, 0, R * 0.01))
		const map = reflector(key, tint)
		const lens = mat(`headlens|${tint}|${glow}|${key}`, { map, emissiveMap: map, emissive: new T.Color(tint), emissiveIntensity: glow, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 })
		const dome = kit.geo(`veh|lensdome|${R.toFixed(5)}`, () => {
			const th = 0.4
			const rad = (R * 0.86) / Math.sin(th)
			const g2 = new T.SphereGeometry(rad, 20, 6, 0, TAU, 0, th).rotateX(Math.PI / 2).translate(0, 0, -rad * Math.cos(th))
			const pos = g2.attributes.position
			const uv = g2.attributes.uv
			for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * R * 0.86) + 0.5, pos.getY(i) / (2 * R * 0.86) + 0.5)
			return g2
		})
		const m = put(dome, lens, 0, 0, R * 0.12)
		g.add(m)
		return g
	}

	/** A tail lamp cluster, w x h wide, facing +z: a black bezel with a red lens, an amber indicator and a white reverse lamp (top to bottom, by the given shares). */
	function taillamp(w, h, { key = "", split = [0.55, 0.25, 0.2], glow = 0.3 } = {}) {
		const g = kit.group()
		const pxm = 14000
		const map = kit.tex(`veh|tail|${key}|${split.join(",")}`, Math.round(w * pxm), Math.round(h * pxm), (c, W, H) => {
			c.fillStyle = "#0e0f11"
			c.fillRect(0, 0, W, H)
			const b = 0.06 * H
			let y = b
			const hh = H - 2 * b
			const cols = ["#d4121c", "#ff9d12", "#f5f6f2"]
			split.forEach((s, i) => {
				const hs = s * hh
				c.fillStyle = cols[i]
				c.fillRect(b, y, W - 2 * b, hs - (i < split.length - 1 ? b * 0.6 : 0))
				c.fillStyle = "rgba(255,255,255,0.16)"
				for (let k = 0; k < 7; k++) c.fillRect(b + 2, y + (hs * k) / 7, W - 2 * b - 4, 1)
				y += hs
			})
		}, { wrap: false })
		const lens = mat(`taillens|${key}|${split.join(",")}`, { map, emissiveMap: map, emissive: new T.Color("#ffffff"), emissiveIntensity: glow, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 })
		g.add(put(kit.box(w, h, 0.0012, Math.min(0.0006, h / 4), 2), lens, 0, 0, 0.0004))
		return g
	}

	/** A grille: a dark recessed panel w x h with `n` chrome slats (a frame round it); facing +z. */
	function grille(w, h, { n = 4, key = "" } = {}) {
		const g = kit.group()
		g.add(put(kit.box(w, h, 0.0016, Math.min(0.0006, h / 3), 2), mat("grille-dark", { color: "#0c0d0f", roughness: 0.55, metalness: 0.2 }), 0, 0, 0))
		const slat = kit.geo(`veh|slat|${w.toFixed(5)}|${h.toFixed(5)}|${n}`, () => new T.BoxGeometry(w - 0.0012, Math.min(0.0007, h / (2.6 * n)), 0.0007))
		for (let i = 0; i < n; i++) g.add(put(slat, M.chrome("#d4d7dc"), 0, h / 2 - (h * (i + 0.75)) / (n + 0.5), 0.0011))
		const frame = kit.geo(`veh|grilleframe|${w.toFixed(5)}|${h.toFixed(5)}`, () => {
			const outer = roundPoly([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], { dev: 0.0005, maxR: 0.002 })
			const sh = new T.Shape(outer.map(([x, y]) => new T.Vector2(x, y)))
			const inner = roundPoly([[-w / 2 + 0.0007, -h / 2 + 0.0007], [w / 2 - 0.0007, -h / 2 + 0.0007], [w / 2 - 0.0007, h / 2 - 0.0007], [-w / 2 + 0.0007, h / 2 - 0.0007]], { dev: 0.0004, maxR: 0.0016 })
			sh.holes.push(new T.Path(inner.map(([x, y]) => new T.Vector2(x, y))))
			return new T.ExtrudeGeometry(sh, { depth: 0.0012, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -0.0004)
		})
		g.add(put(frame, M.chrome("#dadde2"), 0, 0, 0.0004))
		return g
	}

	/** A door mirror: a teardrop housing on a stalk, the glass on its rear face. Built for the +z side, the housing's long axis along x, glass facing -x. s scales it (1 = 6 x 4 x 4 mm). */
	function mirror(paintMat, { s = 1, key = "" } = {}) {
		const g = kit.group()
		const house = put(kit.sphere(1, 16, 10), paintMat, 0, 0, 0.0021 * s)
		house.scale.set(0.0031 * s, 0.002 * s, 0.0021 * s)
		g.add(house)
		g.add(put(kit.cylinderY(0.0007 * s, 0.0034 * s, 10), M.plastic("#17181a", 0.5), 0.0006 * s, -0.0011 * s, 0.0008 * s, [0, 0, -0.5]))
		const glass = kit.geo(`veh|mirrorglass|${s}`, () => new T.CircleGeometry(1, 20))
		const m = put(glass, mat("mirror-glass", { color: "#aeb8c2", roughness: 0.04, metalness: 1 }), -0.0029 * s, 0, 0.0021 * s, [0, -Math.PI / 2, 0], { cast: false })
		m.scale.set(0.0017 * s, 0.0016 * s, 1)
		g.add(m)
		return g
	}

	// ------------------------------------------------------------------ the interior: seats, a steering wheel, a dashboard
	const fabric = (c = "#2d2e33") => mat(`seat|${c}`, { color: c, roughness: 0.92, metalness: 0, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new T.Color("#565860") })
	/** A seat: a cushion and a leaning back with a headrest. Faces +x (the back at -x). w across (z), height of the back h. */
	function seat(w, h, { color = "#2d2e33", depth = 0.012, key = "" } = {}) {
		const g = kit.group()
		const f = fabric(color)
		const cushion = put(kit.box(depth, 0.0032, w, 0.0013, 1), f, depth * 0.1, 0.0016, 0)
		const back = put(kit.box(0.0036, h, w, 0.0015, 1), f, -depth * 0.42, 0.0032 + h / 2 - 0.0004, 0)
		back.rotation.z = 0.2
		back.position.x -= Math.sin(0.2) * h * 0.1
		const head = put(kit.box(0.0034, 0.0036, w * 0.46, 0.0014, 1), f, -depth * 0.42 - Math.sin(0.2) * h * 0.6, 0.0032 + h + 0.0015, 0)
		head.rotation.z = 0.2
		g.add(cushion, back, head)
		return g
	}
	/** A steering wheel: a rim ring on a column, tilted toward the driver; faces +x (the rim's plane is y-z tilted). */
	function steering(R, { key = "" } = {}) {
		const g = kit.group()
		const dark = M.plastic("#202124", 0.45)
		const ring = put(kit.torus(R, R * 0.14, 8, 28), dark, 0, 0, 0, [0, Math.PI / 2, 0])
		g.add(ring)
		g.add(put(kit.cylinderY(R * 0.12, R * 1.7, 10), dark, R * 0.55, -R * 0.78, 0, [0, 0, -1.0]))
		g.add(put(kit.cylinderZ(R * 0.28, R * 0.12, 14), dark, 0, 0, 0, [0, Math.PI / 2, 0]))
		return g
	}

	return { quadSlab, headlamp, taillamp, grille, mirror, seat, steering, fabric }
}
