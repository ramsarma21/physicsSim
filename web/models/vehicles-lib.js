// Helpers for the vehicle models (vehicles*.js): seeded noise, canvas painting, normal maps from height drawings, outlines with rounded
// corners, "sculpts" (a convex side outline made into a rounded solid), lathes about the z axis, spoked wheels, tyre tread.
// Everything is built once per model (the kit caches textures, materials and geometries by key); nothing here runs per frame.
// All lengths are metres, x to the right, y up, z toward the camera (the wheels turn about z).
export function makeLib(kit, THREE) {
	const T = THREE
	const TAU = Math.PI * 2
	const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
	const mix = (a, b, t) => a + (b - a) * t
	const f5 = (v) => Number(v).toFixed(5)

	// ------------------------------------------------------------- noise (seeded: the same picture every time)
	const hash = (x, y, s = 0) => {
		let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0
		h = Math.imul(h ^ (h >>> 13), 1274126177)
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296
	}
	const rng = (seed) => {
		let a = seed >>> 0
		return () => {
			a = (a + 0x6d2b79f5) >>> 0
			let t = Math.imul(a ^ (a >>> 15), 1 | a)
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
	}
	const sm = (t) => t * t * (3 - 2 * t)
	/** Value noise in 0..1; period > 0 tiles it every `period` cells (x and y). */
	function vnoise(x, y, s = 0, period = 0) {
		const xi = Math.floor(x)
		const yi = Math.floor(y)
		const fx = sm(x - xi)
		const fy = sm(y - yi)
		const w = (i) => (period ? ((i % period) + period) % period : i)
		const a = hash(w(xi), w(yi), s)
		const b = hash(w(xi + 1), w(yi), s)
		const c = hash(w(xi), w(yi + 1), s)
		const d = hash(w(xi + 1), w(yi + 1), s)
		return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
	}
	function fbm(x, y, octaves = 4, s = 0, period = 0) {
		let v = 0
		let amp = 0.5
		let tot = 0
		let f = 1
		for (let o = 0; o < octaves; o++) {
			v += amp * vnoise(x * f, y * f, s + o * 17, period ? period * f : 0)
			tot += amp
			amp *= 0.5
			f *= 2
		}
		return v / tot
	}

	// ------------------------------------------------------------- colours
	/** sRGB 0..255 of a hex colour (what a canvas wants). */
	const rgb = (hex) => {
		const o = {}
		new T.Color(hex).getRGB(o, T.SRGBColorSpace)
		return [o.r * 255, o.g * 255, o.b * 255]
	}
	const css = (r, g, b, a = 1) => `rgba(${Math.round(clamp(r, 0, 255))},${Math.round(clamp(g, 0, 255))},${Math.round(clamp(b, 0, 255))},${a})`
	/** A hex colour lightened (k > 1) or darkened (k < 1), as a canvas colour. */
	const shade = (hex, k, a = 1) => {
		const [r, g, b] = rgb(hex)
		return css(r * k, g * k, b * k, a)
	}
	/** The same as a hex string for materials. */
	const shadeHex = (hex, k) => {
		const c = new T.Color(hex)
		c.multiplyScalar(k)
		return "#" + c.getHexString()
	}
	const blend = (a, b, t) => {
		const x = rgb(a)
		const y = rgb(b)
		return css(mix(x[0], y[0], t), mix(x[1], y[1], t), mix(x[2], y[2], t))
	}

	// ------------------------------------------------------------- textures
	/** A tangent-space normal map from a height function h(x, y) -> 0..1 over a W x H canvas (tileable if h is and wrap). */
	function normalMap(key, W, H, height, { strength = 2, wrap = true } = {}) {
		return kit.tex(`veh|nrm|${key}`, W, H, (g) => {
			const hgt = new Float32Array(W * H)
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hgt[y * W + x] = height(x, y)
			const out = g.createImageData(W, H)
			const px = out.data
			// one row of pixels (a function called H times tiers up at once); the neighbours wrap round or clamp at the edges, without a modulo per pixel
			const row = (y) => {
				const ym = y > 0 ? y - 1 : wrap ? H - 1 : 0
				const yp = y < H - 1 ? y + 1 : wrap ? 0 : H - 1
				const r0 = y * W
				const rm = ym * W
				const rp = yp * W
				let o = r0 * 4
				for (let x = 0; x < W; x++) {
					const xm = x > 0 ? x - 1 : wrap ? W - 1 : 0
					const xp = x < W - 1 ? x + 1 : wrap ? 0 : W - 1
					const dx = (hgt[r0 + xp] - hgt[r0 + xm]) * 0.5 * strength
					const dy = (hgt[rm + x] - hgt[rp + x]) * 0.5 * strength // canvas up = +v
					const il = 1 / Math.sqrt(dx * dx + dy * dy + 1)
					px[o] = (-dx * il * 0.5 + 0.5) * 255
					px[o + 1] = (-dy * il * 0.5 + 0.5) * 255
					px[o + 2] = (il * 0.5 + 0.5) * 255
					px[o + 3] = 255
					o += 4
				}
			}
			for (let y = 0; y < H; y++) row(y)
			g.putImageData(out, 0, 0)
		}, { data: true, wrap })
	}
	/** A grey-level data texture (roughness / metalness / bump maps): draw paints grey levels. */
	const dataTex = (key, W, H, draw, wrap = true) => kit.tex(`veh|data|${key}`, W, H, draw, { data: true, wrap })
	/** A colour texture drawn by draw(g, W, H). */
	const colorTex = (key, W, H, draw, wrap = false) => kit.tex(`veh|col|${key}`, W, H, draw, { wrap })
	const mat = (key, params) => kit.mat(`veh|${key}`, params)
	const reps = new Map()
	/** A copy of a texture with its own repeat / offset (the image is shared; cached). */
	function withRepeat(t, rx, ry, ox = 0, oy = 0) {
		const k = `${t.uuid}|${rx}|${ry}|${ox}|${oy}`
		let c = reps.get(k)
		if (!c) {
			c = t.clone()
			c.repeat.set(rx, ry)
			c.offset.set(ox, oy)
			c.wrapS = c.wrapT = T.RepeatWrapping
			c.needsUpdate = true
			reps.set(k, c)
		}
		return c
	}
	/** Fine speckle noise as a normal map (paint orange peel, grit, cast metal, rubber): a tileable square texture. */
	const grainNormal = (key, { size = 256, scale = 1, octaves = 3, strength = 1.2, cell = 6 } = {}) =>
		normalMap(`grain|${key}|${size}|${cell}`, size, size, (x, y) => fbm((x / size) * cell * scale, (y / size) * cell * scale, 5, octaves, cell * scale), { strength })

	// ------------------------------------------------------------- outlines (2D, [[x, y], ...])
	const norm2 = (x, y) => {
		const l = Math.hypot(x, y) || 1
		return [x / l, y / l]
	}
	/** Corners of a polygon (any simple outline) rounded by arcs so the outline moves at most `dev` metres (and no arc is longer than 45% of a side).
	 *  maxR caps the radius. The model stays inside the physics outline to within `dev`. */
	function roundPoly(pts, { dev = 0.0009, maxR = 1, stepDeg = 12 } = {}) {
		const n = pts.length
		const out = []
		const meta = [] // per output point: which corner of the sharp outline it came from, and whether it starts (s), is inside (m), ends (e) its arc, or is the corner itself (x)
		for (let j = 0; j < n; j++) {
			const p0 = pts[(j - 1 + n) % n]
			const p = pts[j]
			const p1 = pts[(j + 1) % n]
			const [d1x, d1y] = norm2(p[0] - p0[0], p[1] - p0[1])
			const [d2x, d2y] = norm2(p1[0] - p[0], p1[1] - p[1])
			const tau = Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y)
			if (Math.abs(tau) < 0.02) {
				out.push([p[0], p[1]])
				meta.push({ c: j, role: "x" })
				continue
			}
			const half = Math.abs(tau) / 2
			let r = Math.min(maxR, dev / (1 / Math.cos(half) - 1))
			let t = r * Math.tan(half)
			const tmax = 0.45 * Math.min(Math.hypot(p[0] - p0[0], p[1] - p0[1]), Math.hypot(p1[0] - p[0], p1[1] - p[1]))
			if (t > tmax) {
				t = tmax
				r = t / Math.tan(half)
			}
			const ax = p[0] - d1x * t
			const ay = p[1] - d1y * t
			const sg = tau > 0 ? 1 : -1
			const cx = ax + -d1y * sg * r
			const cy = ay + d1x * sg * r
			const a0 = Math.atan2(ay - cy, ax - cx)
			const steps = Math.max(2, Math.ceil(Math.abs(tau) / ((stepDeg * Math.PI) / 180)))
			for (let k = 0; k <= steps; k++) {
				const a = a0 + (tau * k) / steps
				out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
				meta.push({ c: j, role: k === 0 ? "s" : k === steps ? "e" : "m" })
			}
		}
		out.meta = meta
		out.sharp = pts
		return out
	}
	/** A convex outline moved inward: offsets[e] (or one number) for the edge from point e to e+1 (counter-clockwise outline, interior on the left). */
	function offsetPoly(pts, offsets) {
		const n = pts.length
		const off = (e) => (typeof offsets === "number" ? offsets : offsets[e])
		const nrm = pts.map((p, e) => {
			const q = pts[(e + 1) % n]
			const [dx, dy] = norm2(q[0] - p[0], q[1] - p[1])
			return [-dy, dx]
		})
		return pts.map((p, j) => {
			const e1 = (j - 1 + n) % n
			const [n1x, n1y] = nrm[e1]
			const [n2x, n2y] = nrm[j]
			const o1 = off(e1)
			const o2 = off(j)
			const det = n1x * n2y - n1y * n2x
			if (Math.abs(det) < 0.02) return [p[0] + (n1x * o1 + n2x * o2) / 2, p[1] + (n1y * o1 + n2y * o2) / 2]
			return [p[0] + (o1 * n2y - o2 * n1y) / det, p[1] + (n1x * o2 - n2x * o1) / det]
		})
	}
	/** Part of a convex outline: the points with x on one side of a vertical (or any) line: keep a*x + b*y <= c. */
	function clipPoly(pts, a, b, c) {
		const out = []
		const n = pts.length
		for (let i = 0; i < n; i++) {
			const p = pts[i]
			const q = pts[(i + 1) % n]
			const dp = a * p[0] + b * p[1] - c
			const dq = a * q[0] + b * q[1] - c
			if (dp <= 0) out.push(p)
			if (dp < 0 !== dq < 0) {
				const t = dp / (dp - dq)
				out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
			}
		}
		return out
	}
	const area2 = (pts) => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2
	const centroid2 = (pts) => {
		const a = area2(pts)
		let cx = 0
		let cy = 0
		for (let i = 0; i < pts.length; i++) {
			const p = pts[i]
			const q = pts[(i + 1) % pts.length]
			const k = p[0] * q[1] - q[0] * p[1]
			cx += (p[0] + q[0]) * k
			cy += (p[1] + q[1]) * k
		}
		return [cx / (6 * a), cy / (6 * a)]
	}
	const shapeOf = (pts) => new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y)))
	/** Window openings and plates: an outline extruded `thick` (centred in z), with the outline kept exact by an inward bevel. */
	function plate(pts, thick, { bevel = 0, key = null } = {}) {
		return kit.geo(`veh|plate|${key ?? JSON.stringify(pts.map((p) => [f5(p[0]), f5(p[1])]))}|${f5(thick)}|${f5(bevel)}`, () => {
			const shape = shapeOf(pts)
			const depth = Math.max(1e-5, thick - 2 * bevel)
			const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 10 })
			g.translate(0, 0, -depth / 2)
			return g
		})
	}

	// ------------------------------------------------------------- creased normals (like BufferGeometryUtils', but for millimetre-sized models)
	function creased(geometry, creaseDeg = 40) {
		const g = geometry.index ? geometry.toNonIndexed() : geometry
		const pos = g.attributes.position
		const P = pos.array
		const n = pos.count / 3
		const cd = Math.cos((creaseDeg * Math.PI) / 180)
		const fn = new Float32Array(n * 3)
		// vertices at the same place (to 0.01 mm) share a bucket: a numeric key (17 bits per axis, models stay within +-0.65 m of their origin) and linked lists, not strings and arrays
		const head = new Map()
		const next = new Int32Array(n * 3)
		const keyAt = (o) => ((Math.round(P[o] * 1e5) + 65536) * 131072 + (Math.round(P[o + 1] * 1e5) + 65536)) * 131072 + (Math.round(P[o + 2] * 1e5) + 65536)
		const keys = new Float64Array(n * 3)
		for (let i = 0; i < n; i++) {
			const o = i * 9
			const ux = P[o] - P[o + 3]
			const uy = P[o + 1] - P[o + 4]
			const uz = P[o + 2] - P[o + 5] // a - b
			const vx = P[o + 6] - P[o + 3]
			const vy = P[o + 7] - P[o + 4]
			const vz = P[o + 8] - P[o + 5] // c - b
			// cb x ab
			let nx = vy * uz - vz * uy
			let ny = vz * ux - vx * uz
			let nz = vx * uy - vy * ux
			const len = Math.hypot(nx, ny, nz)
			if (len > 0) {
				nx /= len
				ny /= len
				nz /= len
			}
			fn[i * 3] = nx
			fn[i * 3 + 1] = ny
			fn[i * 3 + 2] = nz
			for (let k = 0; k < 3; k++) {
				const j = i * 3 + k
				const key = keyAt(j * 3)
				keys[j] = key
				const h = head.get(key)
				next[j] = h === undefined ? -1 : h
				head.set(key, j)
			}
		}
		const out = new Float32Array(pos.count * 3)
		for (let i = 0; i < n; i++) {
			const nx = fn[i * 3]
			const ny = fn[i * 3 + 1]
			const nz = fn[i * 3 + 2]
			for (let k = 0; k < 3; k++) {
				const j = i * 3 + k
				let sx = 0
				let sy = 0
				let sz = 0
				for (let q = head.get(keys[j]); q !== -1; q = next[q]) {
					const f = (q / 3) | 0
					const dot = nx * fn[f * 3] + ny * fn[f * 3 + 1] + nz * fn[f * 3 + 2]
					if (dot >= cd) {
						sx += fn[f * 3]
						sy += fn[f * 3 + 1]
						sz += fn[f * 3 + 2]
					}
				}
				const l = Math.hypot(sx, sy, sz) || 1
				out[j * 3] = sx / l
				out[j * 3 + 1] = sy / l
				out[j * 3 + 2] = sz / l
			}
		}
		g.setAttribute("normal", new T.BufferAttribute(out, 3))
		return g
	}

	// ------------------------------------------------------------- sculpt: a convex side outline made into a rounded solid
	/**
	 * pts: a convex outline [[x, y], ...] counter-clockwise (the physics polygon, corners already rounded if you like), depth: its front-to-back size.
	 * The solid's silhouette from the side is exactly the outline (at mid depth). Round the edges with quarter-ellipses: along each edge the side
	 * face is inset by a (metres, in the outline's plane) and has dropped by b (metres, in z) before it reaches the outline:
	 *   shape(ox, oy, e) -> {a, b}, called with the edge's outward normal (ox, oy).
	 * hz: half the depth the side faces sit at (default depth / 2). uv: planar (x, y) * uvScale.
	 */
	function sculpt(pts, depth, { shape = () => ({ a: 0.004, b: 0.004 }), steps = 5, hz = depth / 2, crease = 40, uvScale = 1, key = null } = {}) {
		return kit.geo(`veh|sculpt|${key ?? JSON.stringify(pts.map((p) => [f5(p[0]), f5(p[1])]))}|${f5(depth)}|${f5(hz)}|${steps}|${crease}|${uvScale}|${shape.toString().length}|${JSON.stringify(shape(0, 1, 0))}${JSON.stringify(shape(1, 0, 0))}${JSON.stringify(shape(0, -1, 0))}`, () => {
			const n = pts.length
			const E = pts.map((p, e) => {
				const q = pts[(e + 1) % n]
				const [dx, dy] = norm2(q[0] - p[0], q[1] - p[1])
				return { nx: -dy, ny: dx }
			})
			const S = E.map((ed, e) => shape(-ed.nx, -ed.ny, e))
			const bz = pts.map((_, j) => Math.min(hz, (S[(j - 1 + n) % n].b + S[j].b) / 2))
			// where each outline vertex goes at the cap: straight runs move along their edge's normal, a rounded corner's inner points all go to the cap's corner
			let target = null
			if (pts.sharp && pts.meta) {
				const sharp = pts.sharp
				const ns = sharp.length
				const SE = sharp.map((p, e) => {
					const q = sharp[(e + 1) % ns]
					const [dx, dy] = norm2(q[0] - p[0], q[1] - p[1])
					return { nx: -dy, ny: dx }
				})
				const SA = SE.map((ed, e) => shape(-ed.nx, -ed.ny, e).a)
				const capC = offsetPoly(sharp, SA)
				const dirOf = (e) => norm2(sharp[(e + 1) % ns][0] - sharp[e][0], sharp[(e + 1) % ns][1] - sharp[e][1])
				target = pts.map((p, j) => {
					const { c, role } = pts.meta[j]
					if (role === "s") {
						// the end of the straight run into corner c: on the edge's inset line, but not past the cap's corner
						const e = (c - 1 + ns) % ns
						const t0 = [p[0] + SE[e].nx * SA[e], p[1] + SE[e].ny * SA[e]]
						const [dx, dy] = dirOf(e)
						return (t0[0] - capC[c][0]) * dx + (t0[1] - capC[c][1]) * dy > 0 ? capC[c] : t0
					}
					if (role === "e") {
						const t0 = [p[0] + SE[c].nx * SA[c], p[1] + SE[c].ny * SA[c]]
						const [dx, dy] = dirOf(c)
						return (t0[0] - capC[c][0]) * dx + (t0[1] - capC[c][1]) * dy < 0 ? capC[c] : t0
					}
					return capC[c]
				})
			}
			const K = steps
			const P = []
			const ring = (side, i) => {
				const ph = (i / K) * (Math.PI / 2)
				const c = 1 - Math.cos(ph)
				const s = Math.sin(ph)
				for (let j = 0; j < n; j++) {
					let px
					let py
					if (target) {
						px = pts[j][0] + (target[j][0] - pts[j][0]) * c
						py = pts[j][1] + (target[j][1] - pts[j][1]) * c
					} else {
						const e1 = (j - 1 + n) % n
						const o1 = S[e1].a * c
						const o2 = S[j].a * c
						const [n1x, n1y] = [E[e1].nx, E[e1].ny]
						const [n2x, n2y] = [E[j].nx, E[j].ny]
						const det = n1x * n2y - n1y * n2x
						let sx
						let sy
						if (Math.abs(det) < 0.02) {
							sx = (n1x * o1 + n2x * o2) / 2
							sy = (n1y * o1 + n2y * o2) / 2
						} else {
							sx = (o1 * n2y - o2 * n1y) / det
							sy = (n1x * o2 - n2x * o1) / det
						}
						px = pts[j][0] + sx
						py = pts[j][1] + sy
					}
					P.push(px, py, side * (hz - bz[j] + bz[j] * s))
				}
			}
			for (const side of [1, -1]) for (let i = 0; i <= K; i++) ring(side, i)
			const idx = (side, i, j) => ((side > 0 ? 0 : K + 1) + i) * n + (j % n)
			const [gx, gy] = centroid2(pts)
			const tris = []
			const quad = (a, b, c, d) => tris.push(a, b, c, a, c, d)
			for (const side of [1, -1]) {
				for (let i = 0; i < K; i++) for (let j = 0; j < n; j++) quad(idx(side, i, j), idx(side, i, j + 1), idx(side, i + 1, j + 1), idx(side, i + 1, j))
			}
			for (let j = 0; j < n; j++) {
				if (bz[j] < hz - 1e-9 || bz[(j + 1) % n] < hz - 1e-9) quad(idx(1, 0, j), idx(1, 0, j + 1), idx(-1, 0, j + 1), idx(-1, 0, j))
			}
			// caps: a fan around the cap's middle
			for (const side of [1, -1]) {
				const c = P.length / 3
				let cx = 0
				let cy = 0
				for (let j = 0; j < n; j++) {
					cx += P[idx(side, K, j) * 3] / n
					cy += P[idx(side, K, j) * 3 + 1] / n
				}
				P.push(cx, cy, side * hz)
				for (let j = 0; j < n; j++) tris.push(c, idx(side, K, j), idx(side, K, j + 1))
			}
			// every triangle faces outward (the solid is convex about (gx, gy, 0))
			for (let t = 0; t < tris.length; t += 3) {
				const [a, b, c] = [tris[t] * 3, tris[t + 1] * 3, tris[t + 2] * 3]
				const ux = P[b] - P[a]
				const uy = P[b + 1] - P[a + 1]
				const uz = P[b + 2] - P[a + 2]
				const vx = P[c] - P[a]
				const vy = P[c + 1] - P[a + 1]
				const vz = P[c + 2] - P[a + 2]
				const nx = uy * vz - uz * vy
				const ny = uz * vx - ux * vz
				const nz = ux * vy - uy * vx
				const fx = (P[a] + P[b] + P[c]) / 3 - gx
				const fy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - gy
				const fz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3
				if (nx * fx + ny * fy + nz * fz < 0) [tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]]
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(P, 3))
			const uv = new Float32Array((P.length / 3) * 2)
			for (let i = 0; i < P.length / 3; i++) {
				uv[i * 2] = P[i * 3] * uvScale
				uv[i * 2 + 1] = P[i * 3 + 1] * uvScale
			}
			g.setAttribute("uv", new T.BufferAttribute(uv, 2))
			g.setIndex(tris)
			return creased(g, crease)
		})
	}

	// ------------------------------------------------------------- lathe about the z axis (wheels, tyres, hubs)
	/**
	 * A surface of revolution about z from a profile [[r, z], ...]: traverse it so the solid is on the left (an outer tread goes toward +z,
	 * a front face goes toward smaller r). u = angle (x repeatU), v = distance along the profile (x repeatV, in metres when vMetres).
	 */
	function revolveZ(profile, { segments = 64, repeatU = 1, vScale = 0, creaseDeg = 50, key = null, closeUV = true } = {}) {
		return kit.geo(`veh|rev|${key ?? JSON.stringify(profile.map((p) => [f5(p[0]), f5(p[1])]))}|${segments}|${repeatU}|${vScale}|${creaseDeg}`, () => {
			const m = profile.length
			const P = []
			const UV = []
			let s = 0
			const sv = [0]
			for (let k = 1; k < m; k++) sv.push((s += Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1])))
			for (let k = 0; k < m; k++) {
				for (let i = 0; i <= segments; i++) {
					const a = (i / segments) * TAU
					P.push(profile[k][0] * Math.cos(a), profile[k][0] * Math.sin(a), profile[k][1])
					UV.push((i / segments) * repeatU, vScale ? sv[k] * vScale : sv[k] / (s || 1))
				}
			}
			const tris = []
			const w = segments + 1
			for (let k = 0; k < m - 1; k++) {
				for (let i = 0; i < segments; i++) {
					const a = k * w + i
					const b = a + 1
					const c = (k + 1) * w + i + 1
					const d = (k + 1) * w + i
					// the normal is (dz, -dr) rotated about z: toward the outside of the solid for a profile with the solid on its left
					tris.push(a, b, c, a, c, d)
				}
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(P, 3))
			g.setAttribute("uv", new T.Float32BufferAttribute(UV, 2))
			g.setIndex(tris)
			return creased(g, creaseDeg)
		})
	}
	/** A profile from corner points with rounded corners (so a lathe has soft shoulders): points [[r, z, radius?], ...]; radius in metres per corner. */
	function roundedProfile(points, segs = 5) {
		const n = points.length
		const out = [[points[0][0], points[0][1]]]
		for (let j = 1; j < n - 1; j++) {
			const [x, y, r = 0] = points[j]
			const p0 = points[j - 1]
			const p1 = points[j + 1]
			if (r <= 0) {
				out.push([x, y])
				continue
			}
			const [d1x, d1y] = norm2(x - p0[0], y - p0[1])
			const [d2x, d2y] = norm2(p1[0] - x, p1[1] - y)
			const tau = Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y)
			if (Math.abs(tau) < 0.02) {
				out.push([x, y])
				continue
			}
			let t = r * Math.tan(Math.abs(tau) / 2)
			const tmax = 0.48 * Math.min(Math.hypot(x - p0[0], y - p0[1]), Math.hypot(p1[0] - x, p1[1] - y))
			let rr = r
			if (t > tmax) {
				t = tmax
				rr = t / Math.tan(Math.abs(tau) / 2)
			}
			const ax = x - d1x * t
			const ay = y - d1y * t
			const sg = tau > 0 ? 1 : -1
			const cx = ax - d1y * sg * rr
			const cy = ay + d1x * sg * rr
			const a0 = Math.atan2(ay - cy, ax - cx)
			for (let k = 0; k <= segs; k++) {
				const a = a0 + (tau * k) / segs
				out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
			}
		}
		out.push([points[n - 1][0], points[n - 1][1]])
		return out
	}

	// ------------------------------------------------------------- small helpers for building
	/** A mesh from geometry + material at a position (x, y, z), optionally rotated (rx, ry, rz). */
	function put(geometry, material, x = 0, y = 0, z = 0, rot = null, { cast = true } = {}) {
		const m = kit.mesh(geometry, material, { cast })
		m.position.set(x, y, z)
		if (rot) m.rotation.set(rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0)
		return m
	}
	/** Merge a list of geometries (each already positioned) into one, cached under key. */
	const merged = (key, make) => kit.geo(`veh|merged|${key}`, () => kit.merge(make(), `veh|m|${key}`))
	/** A cylinder between two points (for spokes, pins, rods) as a BufferGeometry positioned in space. */
	function rod(a, b, r, radial = 8) {
		const dx = b[0] - a[0]
		const dy = b[1] - a[1]
		const dz = b[2] - a[2]
		const len = Math.hypot(dx, dy, dz)
		const g = new T.CylinderGeometry(r, r, len, radial, 1, false)
		const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(dx / len, dy / len, dz / len))
		g.applyQuaternion(q)
		g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
		return g
	}
	/** Texture for a printed label or decal: draw(g, W, H) painting on a transparent canvas at `pxPerM` pixels per metre over w x h metres. */
	function decalMat(key, w, h, pxPerM, draw, { roughness = 0.5, metalness = 0, clearcoat = 0, offset = -2 } = {}) {
		const W = Math.max(8, Math.round(w * pxPerM))
		const H = Math.max(8, Math.round(h * pxPerM))
		const map = kit.tex(`veh|decal|${key}`, W, H, (g) => draw(g, W, H), { wrap: false })
		map.anisotropy = 8
		return mat(`decal|${key}|${roughness}|${metalness}|${clearcoat}`, { map, transparent: true, roughness, metalness, clearcoat, depthWrite: false, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset })
	}
	/** The flat part of a sculpt's side face: the outline pulled in by each edge's inset a (same shape function as the sculpt's). */
	function capPoly(pts0, shape) {
		const pts = pts0.sharp ?? pts0
		const n = pts.length
		return offsetPoly(pts, pts.map((p, e) => {
			const q = pts[(e + 1) % n]
			const [dx, dy] = norm2(q[0] - p[0], q[1] - p[1])
			return shape(dy, -dx, e).a
		}))
	}
	/** A decal surface the shape of a polygon (so it never leaves the face it lies on), with uv over the box x0, y0, w, h. */
	function decalPoly(pts, x0, y0, w, h) {
		return kit.geo(`veh|decalpoly|${JSON.stringify(pts.map((p) => [f5(p[0]), f5(p[1])]))}|${f5(x0)}|${f5(y0)}|${f5(w)}|${f5(h)}`, () => {
			const g = new T.ShapeGeometry(shapeOf(pts))
			const pos = g.attributes.position
			const uv = g.attributes.uv
			for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x0) / w, (pos.getY(i) - y0) / h)
			return g
		})
	}
	/** The same picture on both sides of a body: geo is a decalPoly (in world x-y positions), laid at z = +off and (mirrored in z) at -off. draw(c, W, H, flip) paints
	 *  the near side; for the far side it is called with flip = true: features stay where they are, only text must be drawn mirrored (use flipText). */
	function sideDecals(group, geo, off, key, w, h, pxPerM, draw, opts = {}) {
		for (const sz of [1, -1]) {
			const m = decalMat(`${key}|${sz}`, w, h, pxPerM, (c, W, H) => draw(c, W, H, sz < 0), opts)
			const mesh = put(geo, m, 0, 0, sz * off, null, { cast: false })
			if (sz < 0) mesh.scale.z = -1
			group.add(mesh)
		}
	}
	/** Text at (x, y) on a canvas: mirrored about its own middle when flip (so it reads right on the far side). */
	const flipText = (c, str, x, y, flip) => {
		c.save()
		c.translate(x, y)
		if (flip) c.scale(-1, 1)
		c.fillText(str, 0, 0)
		c.restore()
	}
	/** A flat rectangle (w x h) in the x-y plane facing +z, centred; for decals. */
	const quadGeo = (w, h) => kit.geo(`veh|quad|${f5(w)}|${f5(h)}`, () => new T.PlaneGeometry(w, h))

	// ------------------------------------------------------------- shared materials and outline helpers for the vehicles
	/** A value that varies smoothly with the direction an outline edge faces: front (+x), top (+y), rear (-x), bottom (-y). */
	const byAngle = (front, top, rear, bottom) => (ox, oy) => {
		const th = Math.atan2(oy, ox)
		if (th >= 0 && th <= Math.PI / 2) return mix(front, top, th / (Math.PI / 2))
		if (th > Math.PI / 2) return mix(top, rear, (th - Math.PI / 2) / (Math.PI / 2))
		if (th >= -Math.PI / 2) return mix(front, bottom, -th / (Math.PI / 2))
		return mix(bottom, rear, (-th - Math.PI / 2) / (Math.PI / 2))
	}
	const bounds = (pts) => ({
		x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])),
		y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])),
	})
	/** Orange-peel in lacquer: a very fine bumpy normal map. */
	const peel = () => normalMap("peel", 128, 128, (x, y) => fbm(x / 3.5, y / 3.5, 3, 9, 36), { strength: 0.45 })
	const M = {
		/** Glossy car paint under a clear coat. */
		paint: (color, metal = 0.3) => mat(`paint|${color}|${metal}`, { color, metalness: metal, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, normalMap: peel(), normalScale: new T.Vector2(0.12, 0.12) }),
		plastic: (color, rough = 0.5) => mat(`plastic|${color}|${rough}`, { color, roughness: rough, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4 }),
		chrome: (color = "#d9dce1") => mat(`chrome|${color}`, { color, roughness: 0.12, metalness: 1 }),
		steel: (color = "#9ea4ab", rough = 0.35) => mat(`steel|${color}|${rough}`, { color, roughness: rough, metalness: 1 }),
		/** Tinted automotive glass: you see the interior through it (transmission), and the sky in it (clear coat). */
		glass: () => mat("glass-tint2", { color: "#9db0b8", roughness: 0.04, metalness: 0, transmission: 0.9, thickness: 0.002, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.02 }),
		seal: () => mat("seal", { color: "#0e0f11", roughness: 0.7, metalness: 0 }),
		rubber: (color = "#17181a", rough = 0.86) => mat(`rubber|${color}|${rough}`, { color, roughness: rough, metalness: 0 }),
		lamp: (color, glow = 0.18) => mat(`lamp|${color}|${glow}`, { color, roughness: 0.06, metalness: 0, clearcoat: 1, emissive: color, emissiveIntensity: glow }),
	}

	/** One neutral wood grain, baked once per (rings, stretch, contrast, warp) and shared by every colour and seed: grain along the texture's x (u), growth rings wandering
	 *  across the width, dark late-wood lines, fine pores. Each pixel holds k / KMAX (the brightness) with the late-wood tint on green and blue; a material multiplies it by
	 *  its own base colour (see wood()), so one 512 x 256 bake serves a whole cart's planks, beams and wheels. */
	const WOOD_KMAX = 1.15
	const woodGrain = (rings, stretch, contrast, wp, WW = 512, HH = 256) =>
		kit.tex(`veh|woodgrain|${rings}|${stretch}|${contrast}|${wp}${WW === 512 && HH === 256 ? "" : `|${WW}x${HH}`}`, WW, HH, (g, W, H) => {
			const img = g.createImageData(W, H)
			// every noise term changes over many pixels along the grain: they are sampled every STEP pixels and interpolated, so the work per pixel is the ring's cosine.
			// The two slow ones (the ring warps) also change slowly down the rows: they are sampled every K rows and interpolated between.
			// The pattern is laid out for 512 x 512 pixels whatever the size: a larger bake shows the same grain, only sharper.
			const sx = 512 / W
			const STEP = Math.max(1, Math.round(8 / sx))
			const NX = Math.ceil(W / STEP) + 1
			const K = Math.max(1, Math.round(H / 64))
			const coarse = (row, out) => {
				const yy = (row * 512) / H
				for (let i = 0; i < NX; i++) {
					const x = i * STEP * sx
					out[i * 2] = fbm(x * 0.006 * stretch, yy * 0.02, 4, 1, 0) - 0.5
					out[i * 2 + 1] = fbm(x * 0.03 * stretch, yy * 0.05, 3, 8, 0) - 0.5
				}
			}
			const px = img.data
			// the late-wood profile of one ring: c^3 with c = (1 + cos 2 pi u) / 2, as a table (u in 0..1)
			const LATE = new Float32Array(2049)
			for (let i = 0; i <= 2048; i++) {
				const c = 0.5 + 0.5 * Math.cos((i / 2048) * TAU)
				LATE[i] = c * c * c
			}
			// one row of pixels, walked a node interval at a time with the fields stepped linearly: a function called H times tiers up at once
			const paintRow = (y, yy, fy, A, B, fine) => {
				let o = y * W * 4
				const tBase = (yy / 512) * rings
				for (let i = 0; i + 1 < NX; i++) {
					const o2 = i * 2
					let warp = A[o2] + (B[o2] - A[o2]) * fy
					let warp2 = A[o2 + 1] + (B[o2 + 1] - A[o2 + 1]) * fy
					const dWarp = (A[o2 + 2] + (B[o2 + 2] - A[o2 + 2]) * fy - warp) / STEP
					const dWarp2 = (A[o2 + 3] + (B[o2 + 3] - A[o2 + 3]) * fy - warp2) / STEP
					let streak = fine[o2]
					let pores = fine[o2 + 1]
					const dStreak = (fine[o2 + 2] - streak) / STEP
					const dPores = (fine[o2 + 3] - pores) / STEP
					for (let j = 0; j < STEP; j++) {
						const t = tBase + warp * wp + warp2 * 0.5
						const late = LATE[((t - Math.floor(t)) * 2048 + 0.5) | 0] // thin dark late-wood bands
						let k = 1.06 - 0.2 * late * contrast - 0.07 * pores * contrast + 0.07 * streak
						k = (k < 0.55 ? 0.55 : k > 1.2 ? 1.2 : k) * (255 / WOOD_KMAX)
						px[o] = k
						px[o + 1] = k * (1 - 0.03 * late)
						px[o + 2] = k * (1 - 0.06 * late)
						px[o + 3] = 255
						o += 4
						warp += dWarp
						warp2 += dWarp2
						streak += dStreak
						pores += dPores
					}
				}
			}
			let cA = new Float32Array(NX * 2)
			let cB = new Float32Array(NX * 2)
			coarse(0, cA)
			coarse(K, cB)
			const fine = new Float32Array(NX * 2)
			for (let y = 0; y < H; y++) {
				if (y > 0 && y % K === 0) {
					const t = cA
					cA = cB
					cB = t
					coarse(y + K, cB)
				}
				const yy = (y * 512) / H // sampled every second row at 256 rows
				for (let i = 0; i < NX; i++) {
					const x = i * STEP * sx
					fine[i * 2] = vnoise(x * 0.01 * stretch, yy * 0.35, 6, 0) - 0.5
					fine[i * 2 + 1] = vnoise(x * 0.04 * stretch, yy * 1.1, 4, 0) - 0.5 // the pores: streaks along the grain
				}
				paintRow(y, yy, (y % K) / K, cA, cB, fine)
			}
			g.putImageData(img, 0, 0)
		}, { wrap: false })
	/** sRGB 0..1 to linear (a material colour is multiplied with the texture in linear light). */
	const toLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4))
	/** Wood: the shared grain (above) tinted to `base`, a varnish coat on top. seed picks which part of the grain this piece shows (a window onto the shared bake, mirrored for odd
	 *  seeds), so neighbouring planks differ without a bake of their own. */
	function wood(base, { seed = 1, roughness = 0.55, varnish = 0.5, rings = 7, stretch = 1, contrast = 1, warp: wp = 2.2, hi = false } = {}) {
		// hi: the whole 1024 x 512 bake over the uv square (a big disc's face: about 5 px/mm along the grain and 2.5 across on a 20 cm disc), not a 0.6 window of the 512 x 256 one
		const grain = hi ? woodGrain(rings, stretch, contrast, wp, 1024, 512) : woodGrain(rings, stretch, contrast, wp)
		const fr = (v) => v - Math.floor(v)
		const ou = fr(seed * 0.6180339) * 0.4
		const ov = fr(seed * 0.7548776) * 0.4
		const mir = Math.floor(seed) % 2 === 1
		const map = hi ? grain : withRepeat(grain, mir ? -0.6 : 0.6, 0.6, mir ? ou + 0.6 : ou, ov)
		const [br, bg, bb] = rgb(base)
		const col = new T.Color().setRGB(toLinear((br / 255) * WOOD_KMAX), toLinear((bg / 255) * WOOD_KMAX), toLinear((bb / 255) * WOOD_KMAX), T.LinearSRGBColorSpace)
		return mat(`wood2|${base}|${seed}|${roughness}|${varnish}|${rings}|${stretch}|${contrast}|${wp}${hi ? "|hi" : ""}`, { color: col, map, roughness, metalness: 0, clearcoat: varnish, clearcoatRoughness: 0.18 })
	}
	/** The orientation of a decal or lamp lying on an outline's side face with outward normal (nx, ny): its z points along the normal, its y up the face,
	 *  its x along the face to the viewer's right (front faces: -z world, rear faces: +z world). */
	const faceQuat = (nx, ny) => {
		let yx = -ny
		let yy = nx
		if (yy < 0) {
			yx = -yx
			yy = -yy
		}
		const Z = new T.Vector3(nx, ny, 0)
		const Y = new T.Vector3(yx, yy, 0)
		const X = new T.Vector3().crossVectors(Y, Z)
		return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(X, Y, Z))
	}
	/** Put a mesh on an outline face: at (x, y) in the x-y plane (and z across the face), lifted `lift` along the outward normal. */
	const onFace = (mesh, x, y, z, nx, ny, lift = 0) => {
		mesh.quaternion.copy(faceQuat(nx, ny))
		mesh.position.set(x + nx * lift, y + ny * lift, z)
		return mesh
	}

	return {
		byAngle, bounds, peel, M, faceQuat, onFace,
		THREE: T, TAU, clamp, mix, rng, hash, vnoise, fbm, rgb, css, shade, shadeHex, blend,
		normalMap, dataTex, colorTex, mat, withRepeat, grainNormal,
		roundPoly, offsetPoly, clipPoly, area2, centroid2, shapeOf, plate, creased, sculpt, revolveZ, roundedProfile, put, merged, rod, decalMat, quadGeo, norm2, capPoly, decalPoly, sideDecals, flipText, wood,
	}
}
