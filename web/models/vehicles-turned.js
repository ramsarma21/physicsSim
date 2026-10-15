// One-piece "turned" wheels shared by the stand-alone wheel, the toy cars and the cart: a turned wooden wheel (end grain and long grain on the tread), a machined steel
// or bead-blasted aluminium wheel (lathe rings, a raised boss, bolts), a moulded rubber wheel (grooved tread, steel hub insert), a moulded plastic wheel, concrete.
// turnedWheel(kind, R, t, opts) -> a group about the z axis, thickness t (faces at +-t/2), outer face toward +z; the axle bore is open (a dark sleeve in it).
export function makeTurned(L, kit) {
	const T = L.THREE
	const { TAU, mat, put, normalMap, fbm, hash, rng, revolveZ, roundedProfile, M, shade, rgb } = L
	const f5 = (v) => Number(v).toFixed(5)

	const KIND = {
		wood: { color: "#c79257" },
		darkwood: { color: "#5b3a21" },
		steel: { color: "#b3b9c1" },
		alu: { color: "#d6dade" },
		rubber: { color: "#1b1b1d" },
		plastic: { color: "#e2ab19" },
		concrete: { color: "#9b9a95" },
	}

	/** Does this triangle (three vertices of a revolved profile) belong to a flat face? The decision is the same for both triangles of a profile segment's quad (it uses the two rings'
	 *  |normal z| only: the smallest and the largest of the three), so the boundary between face and tread always runs along a ring: no sawtooth where the two uv systems meet. */
	function faceTri(nrm, a, b, c) {
		const z0 = Math.abs(nrm.getZ(a))
		const z1 = Math.abs(nrm.getZ(b))
		const z2 = Math.abs(nrm.getZ(c))
		return (Math.min(z0, z1, z2) + Math.max(z0, z1, z2)) / 2 > 0.5
	}

	/** Planar uv on the two faces (flat triangles) over the whole disc, so grain and marks lie flat; the tread keeps the lathe's uv. Chosen per triangle (never a mix inside one). */
	function planarFaces(geo, R) {
		const g = geo.index ? geo.toNonIndexed() : geo.clone()
		const nrm = g.attributes.normal
		const pos = g.attributes.position
		const uv = g.attributes.uv
		for (let i = 0; i < pos.count; i += 3) {
			if (!faceTri(nrm, i, i + 1, i + 2)) continue
			for (let k = 0; k < 3; k++) uv.setXY(i + k, pos.getX(i + k) / (2 * R) + 0.5, pos.getY(i + k) / (2 * R) + 0.5)
		}
		return g
	}

	/** The wood on a tread: u runs round (and tiles: no seam), v across. Where the board's grain meets the rim head-on (cos 2 theta = 1) end grain shows, elsewhere long grain. */
	function treadWood(color, seed = 4) {
		const W = 512
		const H = 64
		const map = kit.tex(`veh|treadwood|${color}|${seed}`, W, H, (g) => {
			const img = g.createImageData(W, H)
			const px = img.data
			const [br, bg, bb] = rgb(color)
			// the two noise fields change over 20 pixels or more: sampled every 4 pixels (they tile round the tread: the last sample is the first) and interpolated,
			// and only on every second row (the odd rows take the mean of their two neighbours)
			const STEP = 4
			const NX = W / STEP + 1
			const field = (y, out) => {
				for (let i = 0; i < NX; i++) {
					const x = i * STEP
					out[i * 2] = fbm((x / W) * 8, (y / H) * 2.2, 4, seed, 8) - 0.5
					out[i * 2 + 1] = fbm((x / W) * 24, (y / H) * 6, 3, seed + 3, 24) - 0.5
				}
			}
			// one row of pixels: a function called H times tiers up at once
			const paintRow = (y, A, B, fy) => {
				let o = y * W * 4
				for (let x = 0; x < W; x++) {
					const th = (x / W) * TAU
					const wEnd = 0.5 + 0.5 * Math.cos(2 * th) // 1 at the two ends of the board's axis
					const i = (x / STEP) | 0
					const f = (x - i * STEP) / STEP
					const o2 = i * 2
					const a1 = A[o2] + (B[o2] - A[o2]) * fy
					const b1 = A[o2 + 2] + (B[o2 + 2] - A[o2 + 2]) * fy
					const a2 = A[o2 + 1] + (B[o2 + 1] - A[o2 + 1]) * fy
					const b2 = A[o2 + 3] + (B[o2 + 3] - A[o2 + 3]) * fy
					const n1 = a1 + (b1 - a1) * f
					const n2 = a2 + (b2 - a2) * f
					const long = 0.5 + 0.5 * Math.cos(TAU * ((y / H) * 5.5 + 1.8 * n1)) // long grain: stripes along the tread
					const end = 0.5 + 0.5 * Math.cos(TAU * ((y / H) * 2.5 + 3 * n1 + 1.5 * n2)) // end grain: wandering growth rings
					const mixv = (1 - wEnd) * long + wEnd * end
					const late = mixv * mixv * mixv
					const pores = hash(x, y, seed)
					let k = 1.06 - 0.3 * late + 0.1 * n2 - 0.08 * (pores - 0.5) * (0.4 + wEnd) - 0.12 * wEnd
					k = k < 0.55 ? 0.55 : k > 1.2 ? 1.2 : k
					px[o] = Math.min(255, br * k)
					px[o + 1] = Math.min(255, bg * k * (1 - 0.03 * late))
					px[o + 2] = Math.min(255, bb * k * (1 - 0.06 * late))
					px[o + 3] = 255
					o += 4
				}
			}
			let A = new Float32Array(NX * 2)
			let B = new Float32Array(NX * 2)
			field(0, A)
			field(2, B)
			for (let y = 0; y < H; y++) {
				if (y > 0 && y % 2 === 0) {
					const t = A
					A = B
					B = t
					field(y + 2, B)
				}
				paintRow(y, A, B, (y % 2) / 2)
			}
			g.putImageData(img, 0, 0)
		}, { wrap: true })
		map.anisotropy = 8
		return map
	}

	/** Concentric machining lines (turned metal): a normal map and a roughness map over the profile's arclength, one line per `pitch` metres. */
	function lathe(pitch, key, { depth = 0.5 } = {}) {
		const N = normalMap(`lathe2|${key}`, 4, 64, (x, y) => 0.5 + 0.38 * Math.sin((y / 64) * TAU) + 0.08 * hash(x, y, 4), { strength: 2.4 })
		const Rg = L.dataTex(`latherough|${key}`, 4, 64, (g, W, H) => {
			for (let y = 0; y < H; y++) {
				const v = 0.5 + 0.35 * Math.sin((y / H) * TAU + 1.1) + 0.1 * (hash(y, 3, 9) - 0.5)
				g.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`
				g.fillRect(0, y, W, 1)
			}
		})
		return { N, Rg, pitch, depth }
	}

	function profileLength(prof) {
		let s = 0
		for (let i = 1; i < prof.length; i++) s += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1])
		return s
	}

	/**
	 * kind: "wood" | "darkwood" | "steel" | "alu" | "rubber" | "plastic" | "concrete".  R radius, t thickness.
	 * opts: color, bore (the axle hole's radius; default 0.04 R, at least 1.5 mm), key.
	 */
	function turnedWheel(kind, R, t, { color, bore, key = "", blocks = 0 } = {}) {
		const K = KIND[kind] ?? KIND.wood
		const col = color ?? K.color
		const h = t / 2
		const g = kit.group()
		const rb = bore ?? Math.max(0.0015, Math.min(0.012, 0.06 * R)) // the axle bore: a plain wheel's reads as a real hole (6 % of its radius), not a pinhole
		const ch = Math.min(0.002, 0.3 * rb + 0.0003, 0.2 * h) // the bore's chamfer
		const c = Math.min(0.2 * t, 0.2 * R, 0.0045) // the tread's rounded shoulders
		const kk = `${kind}|${f5(R)}|${f5(t)}|${f5(rb)}|${col}|${key}|${blocks}`
		let pts
		if (kind === "wood" || kind === "darkwood") {
			// dished on both faces: a boss round the hub, a recessed web, a raised rim
			const dish = Math.min(0.12 * t, 0.003, 0.35 * h)
			const rBoss = Math.min(0.26 * R, R - 0.02)
			const hb = h - Math.min(0.0004, 0.2 * h)
			pts = [[rb, -hb + ch], [rb + ch, -hb]]
			if (dish > 0.0003) pts.push([rBoss, -hb], [rBoss + dish * 1.3, -h + dish], [0.8 * R, -h + dish], [0.87 * R, -h, dish])
			else pts.push([0.5 * R, -hb], [0.55 * R, -h])
			pts.push([R, -h, c], [R, h, c])
			if (dish > 0.0003) pts.push([0.87 * R, h, dish], [0.8 * R, h - dish], [rBoss + dish * 1.3, h - dish], [rBoss, hb])
			else pts.push([0.55 * R, h], [0.5 * R, hb])
			pts.push([rb + ch, hb], [rb, hb - ch])
		} else if (kind === "steel" || kind === "alu") {
			// a machined disc: a raised boss, a recessed web, a rim with chamfered edges
			const rec = Math.min(0.0008 + 0.01 * R, 0.25 * h)
			const rBoss = Math.max(rb + 0.004, 0.2 * R)
			const cR = Math.min(0.0009 + 0.006 * R, 0.2 * t)
			pts = [[rb, -h + ch], [rb + ch, -h], [rBoss, -h], [rBoss + rec, -h + rec], [0.84 * R, -h + rec], [0.9 * R, -h], [R - cR, -h], [R, -h + cR]]
			pts.push([R, h - cR], [R - cR, h], [0.9 * R, h], [0.84 * R, h - rec], [rBoss + rec, h - rec], [rBoss, h], [rb + ch, h], [rb, h - ch])
		} else if (kind === "rubber") {
			// a moulded tyre: flat faces with a shallow recess, rounded tread edges
			const rec = Math.min(0.0007 + 0.006 * R, 0.2 * h)
			pts = [[0.3 * R, -h + rec], [0.34 * R, -h], [R, -h, Math.min(c, 0.25 * t)], [R, h, Math.min(c, 0.25 * t)], [0.34 * R, h], [0.3 * R, h - rec]]
		} else if (kind === "plastic") {
			// moulded plastic: a rounded rim, a recessed web with a hub boss
			const rec = Math.min(0.0009 + 0.01 * R, 0.3 * h)
			pts = [[rb, -h + ch], [rb + ch, -h], [0.3 * R, -h], [0.36 * R, -h + rec], [0.72 * R, -h + rec], [0.8 * R, -h, 0.0012], [R, -h, c], [R, h, c], [0.8 * R, h, 0.0012], [0.72 * R, h - rec], [0.36 * R, h - rec], [0.3 * R, h], [rb + ch, h], [rb, h - ch]]
		} else {
			pts = [[rb, -h + ch], [rb + ch, -h], [0.5 * R, -h], [0.55 * R, -h + 0.0006], [R, -h, c], [R, h, c], [0.55 * R, h - 0.0006], [0.5 * R, h], [rb + ch, h], [rb, h - ch]]
		}
		const prof = roundedProfile(pts, 4)
		const arc = profileLength(prof)
		let m
		let geo
		if (kind === "wood" || kind === "darkwood") {
			geo = revolveZ(prof, { segments: 96, key: `turned|${kk}`, creaseDeg: 55 })
			const face = L.wood(col, { seed: 9, roughness: 0.5, varnish: 0.65, rings: 14, warp: 1.1, hi: R >= 0.045 })
			const tread = mat(`turned-tread|${col}`, { map: treadWood(col), roughness: 0.5, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.2 })
			// two meshes from one geometry: faces and tread separated by the normal's z
			g.add(put(splitByNormal(geo, true, kk, R), face))
			g.add(put(splitByNormal(geo, false, kk, R), tread))
		} else if (kind === "steel" || kind === "alu") {
			const lt = lathe(0.0006, `${kind}`)
			const geo2 = revolveZ(prof, { segments: 96, key: `turned|${kk}|v`, vScale: 1 / 0.0007, creaseDeg: 50 })
			geo = geo2
			if (kind === "steel") {
				m = mat(`turned-steel|${col}`, { color: col, roughness: 0.26, metalness: 1, normalMap: lt.N, normalScale: new T.Vector2(1.1, 1.1), roughnessMap: lt.Rg })
			} else {
				const grit = L.grainNormal("blast", { size: 128, cell: 40, strength: 0.7 })
				m = mat(`turned-alu|${col}`, { color: col, roughness: 0.46, metalness: 1, normalMap: grit, normalScale: new T.Vector2(0.35, 0.35) })
			}
			g.add(put(geo, m))
			// six socket bolts on the web, silver hex heads in dark counterbores, both faces
			const dark = mat("wheel-bore", { color: "#0e0f11", roughness: 0.6, metalness: 0.4 })
			const rec = Math.min(0.0008 + 0.01 * R, 0.25 * h)
			const rBolt = Math.max(0.5 * R, 0.0065)
			const rr = Math.max(0.045 * R, 0.0012)
			// the heads sit in the recess, their tops 0.2 mm under the faces (nothing sticks out of the wheel's thickness)
			const hexH = Math.max(0.0004, Math.min(rr * 0.7, rec - 0.0004))
			const hex = kit.geo(`veh|boltheadz|${f5(rr)}|${f5(hexH)}`, () => new T.CylinderGeometry(rr, rr, hexH, 6).rotateX(Math.PI / 2))
			const cb = kit.cylinderZ(rr * 1.35, Math.min(rr * 0.3, 0.0003), 20)
			if (R > 0.012) {
				for (const sgn of [1, -1]) {
					for (let i = 0; i < 6; i++) {
						const a = (i / 6) * TAU + 0.3
						g.add(put(cb, dark, rBolt * Math.cos(a), rBolt * Math.sin(a), sgn * (h - rec + 0.00012)))
						g.add(put(hex, M.steel("#c8ccd2", 0.25), rBolt * Math.cos(a), rBolt * Math.sin(a), sgn * (h - rec + 0.0002 + hexH / 2), [0, 0, a]))
					}
				}
			}
		} else if (kind === "rubber") {
			// grooved tread (circumferential grooves and short blocks) on a grey-black rubber
			const treadFrac0 = (0.66 * R + (Math.PI / 2) * Math.min(c, 0.25 * t)) / arc
			const N = normalMap(`rubberwheel|${blocks}`, 512, 128, (x, y) => {
				const u = x / 512
				const v = y / 128
				let hh = 0.55 + 0.12 * (fbm(x / 3, y / 3, 2, 5, 0) - 0.5)
				const inTread = v > treadFrac0 && v < 1 - treadFrac0
				if (inTread) {
					const t01 = (v - treadFrac0) / (1 - 2 * treadFrac0)
					for (const gv of [0.25, 0.5, 0.75]) if (Math.abs(t01 - gv) < 0.035) hh -= 0.38
					if (blocks > 0 && (((u * blocks) % 1) + 1) % 1 < 0.14) hh -= 0.25
				}
				return hh
			}, { strength: 2 })
			m = mat(`turned-rubber|${col}|${blocks}`, { color: col, roughness: 0.84, metalness: 0, normalMap: N, normalScale: new T.Vector2(0.9, 0.9) })
			geo = revolveZ(prof, { segments: 96, key: `turned|${kk}`, creaseDeg: 55 })
			g.add(put(geo, m))
			// the steel hub insert, flush with the faces, the bore through it
			const steel = M.steel("#9ca2aa", 0.3)
			const insert = kit.geo(`veh|insert|${f5(R)}|${f5(t)}|${f5(rb)}`, () => {
				const p = roundedProfile([[rb, -h + 0.0003], [rb + 0.0008, -h + 0.0001], [0.36 * R, -h + 0.0001], [0.36 * R, h - 0.0001], [rb + 0.0008, h - 0.0001], [rb, h - 0.0003]], 2)
				return revolveZ(p, { segments: 40, key: `insert|${f5(R)}|${f5(t)}|${f5(rb)}` })
			})
			g.add(put(insert, steel))
		} else if (kind === "plastic") {
			geo = revolveZ(prof, { segments: 96, key: `turned|${kk}`, creaseDeg: 55 })
			m = mat(`turned-plastic|${col}`, { color: col, roughness: 0.28, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.12 })
			g.add(put(geo, m))
			// a hub cap: a shallow dome on each face
			const cap = kit.geo(`veh|plasticcap|${f5(R)}`, () => new T.SphereGeometry(0.26 * R, 24, 6, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2))
			for (const sgn of [1, -1]) {
				const rec = Math.min(0.0009 + 0.01 * R, 0.3 * h)
				const d = put(cap, M.chrome("#dfe2e7"), 0, 0, sgn * (h - rec + 0.0001), [sgn > 0 ? 0 : Math.PI, 0, 0])
				d.scale.set(1, 1, 0.35)
				g.add(d)
			}
		} else {
			const bump = normalMap("concrete-grain2", 256, 256, (x, y) => fbm(x / 1.8, y / 1.8, 4, 31, 140), { strength: 1.6 })
			const tex = kit.tex("veh|concrete", 256, 256, (c2, W, H) => {
				const r = rng(77)
				c2.fillStyle = "#7c7b76"
				c2.fillRect(0, 0, W, H)
				for (let i = 0; i < 2600; i++) {
					const g2 = 82 + r() * 70
					c2.fillStyle = `rgba(${g2},${g2 - 3},${g2 - 8},${0.25 + 0.4 * r()})`
					c2.beginPath()
					c2.arc(r() * W, r() * H, 0.5 + r() * 2.1, 0, TAU)
					c2.fill()
				}
				for (let i = 0; i < 60; i++) {
					c2.fillStyle = `rgba(60,58,55,${0.2 + 0.4 * r()})`
					c2.beginPath()
					c2.arc(r() * W, r() * H, 0.6 + r() * 1.2, 0, TAU)
					c2.fill()
				}
			})
			m = mat("wheel-concrete2", { map: tex, roughness: 0.95, metalness: 0, normalMap: bump, normalScale: new T.Vector2(0.55, 0.55) })
			geo = kit.geo(`veh|planarconc|${kk}`, () => planarFaces(revolveZ(prof, { segments: 96, key: `turned|${kk}`, creaseDeg: 55 }), R * 0.4))
			g.add(put(geo, m))
		}
		// the bore: a dark sleeve (bronze for steel and wood wheels), open at both ends
		const sleeve = kind === "steel" || kind === "alu" ? mat("wheel-bush", { color: "#8a6a32", roughness: 0.4, metalness: 1 }) : mat("wheel-sleeve", { color: "#111214", roughness: 0.55, metalness: 0.5 })
		const bush = kit.geo(`veh|bore|${f5(rb)}|${f5(t)}`, () => new T.CylinderGeometry(rb, rb, t - 0.0002, 24, 1, true).rotateX(Math.PI / 2))
		g.add(put(bush, sleeve))
		return g
	}

	/** Part of a revolved geometry: its two flat faces (see faceTri) when `faces`, else the rest (the tread and the rounded shoulders). Cached under key.
	 *  The faces get planar uv over the disc of radius R (whole triangles, never mixed with the lathe uv); the tread keeps the lathe's. */
	function splitByNormal(geo, faces, key, R) {
		return kit.geo(`veh|split2|${key}|${faces}`, () => {
			const g = geo.index ? geo.toNonIndexed() : geo
			const pos = g.attributes.position
			const nrm = g.attributes.normal
			const uv = g.attributes.uv
			const d = { p: [], n: [], u: [] }
			for (let i = 0; i < pos.count; i += 3) {
				if (faceTri(nrm, i, i + 1, i + 2) !== faces) continue
				for (let k = 0; k < 3; k++) {
					d.p.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k))
					d.n.push(nrm.getX(i + k), nrm.getY(i + k), nrm.getZ(i + k))
					if (faces) d.u.push(pos.getX(i + k) / (2 * R) + 0.5, pos.getY(i + k) / (2 * R) + 0.5)
					else d.u.push(uv.getX(i + k), uv.getY(i + k))
				}
			}
			const q = new T.BufferGeometry()
			q.setAttribute("position", new T.Float32BufferAttribute(d.p, 3))
			q.setAttribute("normal", new T.Float32BufferAttribute(d.n, 3))
			q.setAttribute("uv", new T.Float32BufferAttribute(d.u, 2))
			return q
		})
	}

	return { turnedWheel, treadWood, planarFaces }
}
