// Helpers for the everyday-b models (a working copy of everyday-a-lib.js): seeded noise, canvas drawing, normal maps from height
// drawings, plan-view plates with bevels, lofts along x, lathes with linear uv, small decal planes.
// Everything is built once per model (the kit caches textures and materials by key); nothing here runs per frame.
export function makeLib(kit, THREE) {
	const TAU = Math.PI * 2
	const f5 = (v) => Number(v).toFixed(5)

	// ------------------------------------------------------------- noise (seeded: the same picture every time)
	const rng = (seed) => {
		let a = seed >>> 0
		return () => {
			a = (a + 0x6d2b79f5) >>> 0
			let t = Math.imul(a ^ (a >>> 15), 1 | a)
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
	}
	const hash = (x, y, s = 0) => {
		let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0
		h = Math.imul(h ^ (h >>> 13), 1274126177)
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296
	}
	const sm = (t) => t * t * (3 - 2 * t)
	/** Value noise in 0..1; period > 0 makes it tile every `period` cells. */
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
	const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
	const mix = (a, b, t) => a + (b - a) * t

	// ------------------------------------------------------------- colours
	const C = (hex) => new THREE.Color(hex)
	/** A hex colour lightened (k > 1) or darkened (k < 1), as "rgb(...)" for canvas use. */
	function shade(hex, k) {
		const c = C(hex).convertLinearToSRGB()
		const r = (v) => Math.round(clamp(v * k) * 255)
		return `rgb(${r(c.r)},${r(c.g)},${r(c.b)})`
	}
	/** A hex colour made punchier for this scene's tone mapping: more saturation, a touch less light (as a CSS colour). */
	function rich(hex, sat = 1.2, light = 0.85) {
		const c = C(hex)
		const hsl = {}
		c.getHSL(hsl, THREE.SRGBColorSpace)
		c.setHSL(hsl.h, clamp(hsl.s * sat), clamp(hsl.l * light), THREE.SRGBColorSpace)
		return c.getStyle()
	}
	/** Mix two hex colours (sRGB) by t. */
	function blend(a, b, t) {
		const x = C(a).convertLinearToSRGB()
		const y = C(b).convertLinearToSRGB()
		const r = (u, v) => Math.round(mix(u, v, t) * 255)
		return `rgb(${r(x.r, y.r)},${r(x.g, y.g)},${r(x.b, y.b)})`
	}

	// ------------------------------------------------------------- textures and materials
	/** A tangent-space normal map from a height drawing: draw(g, w, h) paints grey levels (white = high). */
	function normalTex(key, w, h, draw, { strength = 2, wrap = true, repeat = null, blur = 0 } = {}) {
		return kit.tex(`nrm|${key}`, w, h, (g, W, H) => {
			draw(g, W, H)
			if (blur > 0) {
				const c2 = document.createElement("canvas")
				c2.width = W
				c2.height = H
				const g2 = c2.getContext("2d")
				g2.filter = `blur(${blur}px)`
				g2.drawImage(g.canvas, 0, 0)
				g.clearRect(0, 0, W, H)
				g.drawImage(c2, 0, 0)
			}
			const src = g.getImageData(0, 0, W, H).data
			const out = g.createImageData(W, H)
			const at = (x, y) => {
				x = wrap ? (x + W) % W : clamp(x, 0, W - 1)
				y = wrap ? (y + H) % H : clamp(y, 0, H - 1)
				return src[(y * W + x) * 4] / 255
			}
			for (let y = 0; y < H; y++) {
				for (let x = 0; x < W; x++) {
					const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength
					const dy = (at(x, y - 1) - at(x, y + 1)) * 0.5 * strength // canvas up = +v
					const il = 1 / Math.hypot(dx, dy, 1)
					const o = (y * W + x) * 4
					out.data[o] = (-dx * il * 0.5 + 0.5) * 255
					out.data[o + 1] = (-dy * il * 0.5 + 0.5) * 255
					out.data[o + 2] = (il * 0.5 + 0.5) * 255
					out.data[o + 3] = 255
				}
			}
			g.putImageData(out, 0, 0)
		}, { data: true, wrap, repeat })
	}
	/** A grey-level data texture (roughness or metalness maps): draw paints grey levels. */
	function dataTex(key, w, h, draw, opts = {}) {
		return kit.tex(`data|${key}`, w, h, draw, { data: true, wrap: !!opts.wrap, repeat: opts.repeat ?? null })
	}
	/** The same little saturation boost the view gives its own materials before tone mapping (three's AgX is flatter than the renders). */
	const GRADE = "{ float gl = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)); outgoingLight = max(vec3(0.0), mix(vec3(gl), outgoingLight, 1.3)); }"
	/** A cached physical material (key must be unique per parameter set). Maps may be textures made by kit.tex/normalTex. */
	const mat = (key, params) => {
		const m = kit.mat(`ea|${key}`, params)
		// transmissive materials (glass, water) are left ungraded: the saturation boost would turn the table seen through them amber
		if (!m.userData.eaGrade && !(params.transmission > 0)) {
			m.userData.eaGrade = true
			m.onBeforeCompile = (shader) => {
				shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", GRADE + "\n#include <opaque_fragment>")
			}
			m.customProgramCacheKey = () => "ea-grade"
		}
		return m
	}
	/** A printed colour map as a texture: draw(g, w, h). */
	const colorTex = (key, w, h, draw, opts = {}) => kit.tex(`ea|${key}`, w, h, draw, { wrap: !!opts.wrap, repeat: opts.repeat ?? null })

	const reps = new Map()
	/** A copy of a texture with its own repeat/offset (the image is shared; cached). */
	function withRepeat(t, rx, ry, ox = 0, oy = 0) {
		const k = `${t.uuid}|${rx}|${ry}|${ox}|${oy}`
		let c = reps.get(k)
		if (!c) {
			c = t.clone()
			c.repeat.set(rx, ry)
			c.offset.set(ox, oy)
			c.wrapS = c.wrapT = THREE.RepeatWrapping
			c.needsUpdate = true
			reps.set(k, c)
		}
		return c
	}

	// ------------------------------------------------------------- shapes in plan (x-z plane)
	function rrectPath(path, cx, cy, w, h, r) {
		r = Math.max(0.00001, Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6))
		const x0 = cx - w / 2
		const x1 = cx + w / 2
		const y0 = cy - h / 2
		const y1 = cy + h / 2
		path.moveTo(x0 + r, y0)
		path.lineTo(x1 - r, y0)
		path.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false)
		path.lineTo(x1, y1 - r)
		path.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false)
		path.lineTo(x0 + r, y1)
		path.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false)
		path.lineTo(x0, y0 + r)
		path.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false)
		return path
	}
	/** A rounded rectangle Shape, w by h, corner radius r, centred (x-y shape coordinates). */
	const rrect = (w, h, r, cx = 0, cy = 0) => rrectPath(new THREE.Shape(), cx, cy, w, h, r)
	/** A rounded rectangle hole Path. */
	const rrectHole = (w, h, r, cx = 0, cy = 0) => rrectPath(new THREE.Path(), cx, cy, w, h, r)
	const circleHole = (r, cx = 0, cy = 0) => {
		const p = new THREE.Path()
		p.absarc(cx, cy, r, 0, TAU, true)
		return p
	}

	/**
	 * A plate lying in the x-z plane between heights y0 and y1: `shape` is the plan outline (x, y shape coordinates = x, -z),
	 * `holes` optional Paths. `bevel` rounds the top and bottom edges (the outline you give is the one at the middle of the side).
	 * Groups: 0 = the two faces, 1 = the sides. Face uv in metres of the plan (x, -z): scale with the texture repeat.
	 */
	function plate(shape, y0, y1, { bevel = 0, holes = [], curve = 10, bevelSegments = 2 } = {}) {
		if (holes.length) shape.holes = holes
		const depth = Math.max(1e-5, y1 - y0 - 2 * bevel)
		const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments, curveSegments: curve })
		g.translate(0, 0, bevel) // z from 0 (bottom) to y1 - y0
		g.rotateX(-Math.PI / 2)
		g.translate(0, y0, 0)
		return g
	}
	/** A rounded-rectangle plate (plan w by d, corner radius r, from y0 to y1, edges rounded by `bevel`), the outline exactly w by d. */
	function rrPlate(w, d, r, y0, y1, { bevel = 0, holes = [], curve = 10, bevelSegments = 2 } = {}) {
		return plate(rrect(w - 2 * bevel, d - 2 * bevel, Math.max(0.0001, r - bevel)), y0, y1, { bevel, holes, curve, bevelSegments })
	}

	// ------------------------------------------------------------- lofts and lathes
	const rrectPts = (hy, hz, r, seg = 4, cy = 0, cz = 0) => {
		// the outline of a rounded rectangle (half sizes hy, hz) as [y, z] points, counter-clockwise seen from +z
		r = Math.max(1e-5, Math.min(r, hy - 1e-6, hz - 1e-6))
		const pts = []
		const corner = (cyy, czz, a0) => {
			for (let i = 0; i <= seg; i++) {
				const a = a0 + (i / seg) * (Math.PI / 2)
				pts.push([cy + cyy + r * Math.sin(a), cz + czz + r * Math.cos(a)])
			}
		}
		// z grows with cos, y with sin: start at the +z, +y corner going toward +y
		corner(hy - r, hz - r, 0) // from (+z) up toward (+y)
		corner(hy - r, -(hz - r), Math.PI / 2)
		corner(-(hy - r), -(hz - r), Math.PI)
		corner(-(hy - r), hz - r, Math.PI * 1.5)
		return pts
	}
	const circPts = (r, n = 24, cy = 0, cz = 0) => Array.from({ length: n }, (_, i) => [cy + r * Math.sin((i / n) * TAU), cz + r * Math.cos((i / n) * TAU)])

	/**
	 * A closed tube along x through rings [{x, pts: [[y, z], ...]}] (all rings with the same number of points).
	 * uv: u = along x (0..1), v = around (0..1 by arc length of the first ring). Optional flat end caps.
	 */
	function loftX(rings, { caps = true } = {}) {
		const n = rings.length
		const m = rings[0].pts.length
		const pos = []
		const uv = []
		const idx = []
		const x0 = rings[0].x
		const x1 = rings[n - 1].x
		const arc = [0]
		for (let j = 1; j <= m; j++) {
			const a = rings[0].pts[j - 1]
			const b = rings[0].pts[j % m]
			arc[j] = arc[j - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])
		}
		const total = arc[m] || 1
		for (let i = 0; i < n; i++) {
			for (let j = 0; j <= m; j++) {
				const p = rings[i].pts[j % m]
				pos.push(rings[i].x, p[0], p[1])
				uv.push((rings[i].x - x0) / (x1 - x0 || 1), arc[j] / total)
			}
		}
		const row = m + 1
		for (let i = 0; i < n - 1; i++) {
			for (let j = 0; j < m; j++) {
				const a = i * row + j
				const b = a + 1
				const c = a + row
				const d = c + 1
				idx.push(a, b, c, b, d, c)
			}
		}
		const sideCount = idx.length
		const g = new THREE.BufferGeometry()
		g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
		g.setIndex(idx)
		// make the triangles face outward: compare the first with the direction from the ring's centre
		{
			const p = g.attributes.position
			const tri = [idx[0], idx[1], idx[2]].map((k) => new THREE.Vector3().fromBufferAttribute(p, k))
			const nrm = new THREE.Vector3().subVectors(tri[1], tri[0]).cross(new THREE.Vector3().subVectors(tri[2], tri[0]))
			const cen = new THREE.Vector3(0, 0, 0)
			for (const q of rings[0].pts) cen.add(new THREE.Vector3(0, q[0], q[1]))
			cen.divideScalar(m)
			const out = tri[0].clone().sub(new THREE.Vector3(tri[0].x, cen.y, cen.z))
			if (nrm.dot(out) < 0) for (let k = 0; k < sideCount; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]]
			g.setIndex(idx)
		}
		g.computeVertexNormals()
		// one smooth normal across the seam
		{
			const nr = g.attributes.normal
			for (let i = 0; i < n; i++) {
				const a = i * row
				const b = a + m
				const v = new THREE.Vector3().fromBufferAttribute(nr, a).add(new THREE.Vector3().fromBufferAttribute(nr, b)).normalize()
				nr.setXYZ(a, v.x, v.y, v.z)
				nr.setXYZ(b, v.x, v.y, v.z)
			}
		}
		if (!caps) return g
		// caps are separate geometry (flat normals): triangulated, so concave profiles (a crescent) work too
		const cp = []
		const cn = []
		const cu = []
		const ci = []
		const cap = (ring, sgn) => {
			const base = cp.length / 3
			let zmin = Infinity, zmax = -Infinity, ymin = Infinity, ymax = -Infinity
			for (const q of ring.pts) {
				zmin = Math.min(zmin, q[1]); zmax = Math.max(zmax, q[1])
				ymin = Math.min(ymin, q[0]); ymax = Math.max(ymax, q[0])
			}
			for (const q of ring.pts) {
				cp.push(ring.x, q[0], q[1])
				cn.push(sgn, 0, 0)
				cu.push((q[1] - zmin) / (zmax - zmin || 1), (q[0] - ymin) / (ymax - ymin || 1))
			}
			const tris = THREE.ShapeUtils.triangulateShape(ring.pts.map((q) => new THREE.Vector2(q[1], q[0])), [])
			for (const t of tris) {
				const a = base + t[0], b = base + t[1], c = base + t[2]
				const P = (i) => new THREE.Vector3(cp[i * 3], cp[i * 3 + 1], cp[i * 3 + 2])
				const nr = new THREE.Vector3().subVectors(P(b), P(a)).cross(new THREE.Vector3().subVectors(P(c), P(a)))
				if (nr.x * sgn < 0) ci.push(a, c, b)
				else ci.push(a, b, c)
			}
		}
		cap(rings[0], -1)
		cap(rings[n - 1], 1)
		const off = pos.length / 3
		const ap = Array.from(g.attributes.position.array).concat(cp)
		const an = Array.from(g.attributes.normal.array).concat(cn)
		const au = Array.from(g.attributes.uv.array).concat(cu)
		const ai = Array.from(g.index.array).concat(ci.map((v) => v + off))
		const out = new THREE.BufferGeometry()
		out.setAttribute("position", new THREE.Float32BufferAttribute(ap, 3))
		out.setAttribute("normal", new THREE.Float32BufferAttribute(an, 3))
		out.setAttribute("uv", new THREE.Float32BufferAttribute(au, 2))
		out.setIndex(ai)
		out.addGroup(0, sideCount, 0)
		out.addGroup(sideCount, ai.length - sideCount, 1)
		return out
	}

	/** An open ribbon along x through [y, z] points (a curved spine); uv u along x, v along the points. Faces the side the points run counter-clockwise from. */
	function ribbonX(pts, x0, x1, { segsX = 1, flip = false } = {}) {
		const m = pts.length
		const pos = []
		const uv = []
		const idx = []
		const arc = [0]
		for (let j = 1; j < m; j++) arc[j] = arc[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1])
		for (let i = 0; i <= segsX; i++) {
			const x = mix(x0, x1, i / segsX)
			for (let j = 0; j < m; j++) {
				pos.push(x, pts[j][0], pts[j][1])
				uv.push(i / segsX, arc[j] / arc[m - 1])
			}
		}
		for (let i = 0; i < segsX; i++) {
			for (let j = 0; j < m - 1; j++) {
				const a = i * m + j
				const b = a + 1
				const c = a + m
				const d = c + 1
				if (flip) idx.push(a, c, b, b, c, d)
				else idx.push(a, b, c, b, d, c)
			}
		}
		const g = new THREE.BufferGeometry()
		g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
		g.setIndex(idx)
		g.computeVertexNormals()
		return g
	}

	/**
	 * A lathe about the y axis from [[r, y], ...] (bottom to top) whose uv is linear: u around (0..1, u = 0.5 faces +z), v = (y - y0) / (y1 - y0).
	 * rotateY(pi) puts the middle of the wrap toward the camera.
	 */
	function latheLin(points, segments, y0, y1, { rotY = Math.PI } = {}) {
		const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments)
		const p = g.attributes.position
		const uv = g.attributes.uv
		for (let i = 0; i < p.count; i++) uv.setY(i, (p.getY(i) - y0) / (y1 - y0))
		if (rotY) g.rotateY(rotY)
		return g
	}

	/** A rounded rectangle with a semicircular notch cut into its front (+z) edge, as a Shape in plan (x, y_shape = -z). */
	function notchedRRect(w, d, r, notchR) {
		const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2
		const sh = new THREE.Shape()
		sh.moveTo(x0 + r, y0)
		sh.lineTo(-notchR, y0)
		sh.absarc(0, y0, notchR, Math.PI, 0, true)
		sh.lineTo(x1 - r, y0)
		sh.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false)
		sh.lineTo(x1, y1 - r)
		sh.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false)
		sh.lineTo(x0 + r, y1)
		sh.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false)
		sh.lineTo(x0, y0 + r)
		sh.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false)
		return sh
	}
	/** Merge geometries into one (non-indexed, position/normal/uv only). */
	function mergeGeos(list, key) {
		const prep = list.map((g) => {
			const x = g.index ? g.toNonIndexed() : g.clone()
			for (const name of Object.keys(x.attributes)) if (!["position", "normal", "uv"].includes(name)) x.deleteAttribute(name)
			if (!x.attributes.uv) x.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2))
			x.clearGroups()
			return x
		})
		return kit.merge(prep, key)
	}

	// ------------------------------------------------------------- small things
	/** A flat plane w by h facing +z (rotate/position it yourself). */
	const plane = (w, h) => new THREE.PlaneGeometry(w, h)
	/** A decal plane lying on a face of a box centred at the origin: side "+y" "-y" "+z" "-z" "+x" "-x"; the plane's uv is upright as seen from outside
	 *  (for +y: top of the texture toward -z). off = how far it floats off the surface. */
	function decal(side, w, h, material, off, at = [0, 0]) {
		const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material)
		m.castShadow = false
		m.receiveShadow = true
		if (side === "+z") { m.position.set(at[0], at[1], off) }
		else if (side === "-z") { m.rotation.y = Math.PI; m.position.set(at[0], at[1], -off) }
		else if (side === "+y") { m.rotation.x = -Math.PI / 2; m.position.set(at[0], off, at[1]) }
		else if (side === "-y") { m.rotation.x = Math.PI / 2; m.position.set(at[0], -off, at[1]) }
		else if (side === "+x") { m.rotation.y = Math.PI / 2; m.position.set(off, at[1], at[0]) }
		else if (side === "-x") { m.rotation.y = -Math.PI / 2; m.position.set(-off, at[1], at[0]) }
		return m
	}
	/** The uv share each rounded corner takes on a RoundedBoxGeometry face of this side length and radius (the flat part is [a, 1 - a]). */
	const rbShare = (side, r) => {
		const arc = (TAU * r) / 4
		return (0.5 * arc) / (arc + Math.max(0, side - 2 * r))
	}
	/** The 6 materials of a box in three's order: +x, -x, +y, -y, +z, -z. */
	const faces = (o) => [o.px, o.nx, o.py, o.ny, o.pz, o.nz]

	/** Draw `str` with letter spacing (canvas letterSpacing where supported). */
	function spaced(g, str, x, y, spacing = 0) {
		if ("letterSpacing" in g) {
			g.letterSpacing = `${spacing}px`
			g.fillText(str, x, y)
			g.letterSpacing = "0px"
			return
		}
		g.fillText(str, x, y)
	}
	/** Fill a rounded rectangle path on a canvas. */
	function rr(g, x, y, w, h, r) {
		r = Math.min(r, w / 2, h / 2)
		g.beginPath()
		g.moveTo(x + r, y)
		g.arcTo(x + w, y, x + w, y + h, r)
		g.arcTo(x + w, y + h, x, y + h, r)
		g.arcTo(x, y + h, x, y, r)
		g.arcTo(x, y, x + w, y, r)
		g.closePath()
	}
	/** Paper-like speckle over the canvas (fibres): density per 1000 px². */
	function fibres(g, W, H, seed, { n = 4000, alpha = 0.05, dark = "#000", light = "#fff", len = 6 } = {}) {
		const r = rng(seed)
		for (let i = 0; i < n; i++) {
			const x = r() * W
			const y = r() * H
			const a = r() * TAU
			g.strokeStyle = r() < 0.5 ? dark : light
			g.globalAlpha = alpha * (0.4 + r())
			g.lineWidth = 0.7
			g.beginPath()
			g.moveTo(x, y)
			g.lineTo(x + Math.cos(a) * len * (0.5 + r()), y + Math.sin(a) * len * (0.5 + r()))
			g.stroke()
		}
		g.globalAlpha = 1
	}
	/** Per-pixel painter: fn(x, y) -> [r, g, b] 0..255 (use sparingly; fine at <= 1024 px). */
	function pixels(g, W, H, fn) {
		const img = g.createImageData(W, H)
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const c = fn(x, y)
				const o = (y * W + x) * 4
				img.data[o] = c[0]
				img.data[o + 1] = c[1]
				img.data[o + 2] = c[2]
				img.data[o + 3] = c[3] ?? 255
			}
		}
		g.putImageData(img, 0, 0)
	}

	// ------------------------------------------------------------- smooth profiles (everyday-b)
	/** A centripetal Catmull-Rom curve through 2D points [[a, b], ...], `per` samples per span (the curve passes through every point). */
	function spline(pts, per = 8) {
		const c = new THREE.CatmullRomCurve3(pts.map(([a, b]) => new THREE.Vector3(a, b, 0)), false, "centripetal")
		return c.getPoints(per * (pts.length - 1)).map((v) => [v.x, v.y])
	}
	/** Interpolate a profile table [[y, r], ...] (ascending y) linearly at y. */
	function profileAt(rows, y) {
		if (y <= rows[0][0]) return rows[0][1]
		for (let i = 1; i < rows.length; i++) if (y <= rows[i][0]) return mix(rows[i - 1][1], rows[i][1], (y - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0] || 1))
		return rows[rows.length - 1][1]
	}
	/** A lathe about y whose radius is modulated around the axis: r *= 1 + amp(y) * cos(n * theta) (flutes, ribs, knurling). */
	function flutedLathe(points, segments, n, amp, y0 = -Infinity, y1 = Infinity, { rotY = Math.PI } = {}) {
		const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments)
		const p = g.attributes.position
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
			if (y < y0 || y > y1) continue
			const th = Math.atan2(z, x)
			const k = 1 + amp * Math.cos(n * th)
			p.setXYZ(i, x * k, y, z * k)
		}
		g.computeVertexNormals()
		if (rotY) g.rotateY(rotY)
		return g
	}
	/** A polyline [[x, y], ...] with every interior corner rounded by a quadratic curve that starts `r` before and ends `r` after the vertex. */
	function roundedPolyline(pts, r, per = 6) {
		const out = [pts[0]]
		for (let i = 1; i < pts.length - 1; i++) {
			const a = pts[i - 1], b = pts[i], c = pts[i + 1]
			const la = Math.hypot(b[0] - a[0], b[1] - a[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1])
			const ra = Math.min(r, la / 2), rc = Math.min(r, lc / 2)
			const p0 = [b[0] + ((a[0] - b[0]) * ra) / la, b[1] + ((a[1] - b[1]) * ra) / la]
			const p2 = [b[0] + ((c[0] - b[0]) * rc) / lc, b[1] + ((c[1] - b[1]) * rc) / lc]
			for (let k = 0; k <= per; k++) {
				const t = k / per, u = 1 - t
				out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]])
			}
		}
		out.push(pts[pts.length - 1])
		return out
	}
	/** A closed convex polygon [[x, y], ...] with every corner rounded by a quadratic curve starting `r` (at most half an edge) before the vertex and ending `r` after. */
	function roundedPolygon(pts, r, per = 6) {
		const out = []
		const n = pts.length
		for (let i = 0; i < n; i++) {
			const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n]
			const la = Math.hypot(b[0] - a[0], b[1] - a[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1])
			const ra = Math.min(r, la / 2), rc = Math.min(r, lc / 2)
			const p0 = [b[0] + ((a[0] - b[0]) * ra) / la, b[1] + ((a[1] - b[1]) * ra) / la]
			const p2 = [b[0] + ((c[0] - b[0]) * rc) / lc, b[1] + ((c[1] - b[1]) * rc) / lc]
			for (let k = 0; k <= per; k++) {
				const t = k / per, u = 1 - t
				out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]])
			}
		}
		return out
	}
	/** The y-interval [lo, hi] where the vertical line at x crosses a convex polygon [[x, y], ...] (null outside it). */
	function chordAt(poly, x) {
		let lo = Infinity, hi = -Infinity
		for (let i = 0; i < poly.length; i++) {
			const a = poly[i], b = poly[(i + 1) % poly.length]
			if ((a[0] - x) * (b[0] - x) > 0) continue
			if (Math.abs(b[0] - a[0]) < 1e-12) { lo = Math.min(lo, a[1], b[1]); hi = Math.max(hi, a[1], b[1]); continue }
			const t = (x - a[0]) / (b[0] - a[0])
			const y = a[1] + t * (b[1] - a[1])
			lo = Math.min(lo, y); hi = Math.max(hi, y)
		}
		return hi < lo ? null : [lo, hi]
	}
	/** A superellipse ring point at angle a: half sizes (hz, hy), exponent n (2 = ellipse, large = box), top and bottom exponents may differ. */
	function superRing(count, hz, hy, cy, nTop, nBot = nTop, cz = 0) {
		const pts = []
		for (let i = 0; i < count; i++) {
			const a = (i / count) * TAU
			const c = Math.cos(a), s = Math.sin(a)
			const n = s >= 0 ? nTop : nBot
			pts.push([cy + hy * Math.sign(s) * Math.abs(s) ** (2 / n), cz + hz * Math.sign(c) * Math.abs(c) ** (2 / n)])
		}
		return pts // [y, z] counter-clockwise seen from +x... (loftX wants [y, z] pairs)
	}
	/** The view grades its own materials with a little extra saturation before tone mapping (AgX is flatter than the renders it matches);
	 *  a model's strongly coloured material can take the same grade: satify(mat, 1.4). Idempotent. */
	function satify(m, k = 1.4) {
		m.userData.satK = k
		m.onBeforeCompile = (shader) => {
			shader.uniforms.uSat = { value: k }
			shader.fragmentShader = shader.fragmentShader
				.replace("#include <common>", "#include <common>\nuniform float uSat;")
				.replace("#include <opaque_fragment>", "{ float gl = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)); outgoingLight = max(vec3(0.0), mix(vec3(gl), outgoingLight, uSat)); }\n#include <opaque_fragment>")
		}
		m.customProgramCacheKey = () => `eb-sat-${k}`
		m.needsUpdate = true
		return m
	}
	/** Turn a group built along y (centred) so its axis runs along z, the +y end toward the camera. */
	const alongZ = (g) => {
		g.rotation.x = Math.PI / 2
		return kit.group(g)
	}
	/** A disc facing +y (a lid, a base) of radius r at height y. */
	const disc = (r, y, seg = 64) => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2).translate(0, y, 0)

	// ------------------------------------------------------------- implicit surfaces (soft toys, moulded plastic)
	/**
	 * Polygonise the zero set of f(x, y, z) (negative inside) over the box [x0, y0, z0, x1, y1, z1] on a grid of cell size h (surface nets: one vertex
	 * per cell the surface crosses, snapped onto the surface; smooth normals from f's gradient). Returns a BufferGeometry (position, normal).
	 */
	function meshSDF(f, box, h) {
		const [x0, y0, z0, x1, y1, z1] = box
		const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1
		const ix = (i, j, k) => i + nx * (j + ny * k)
		const val = new Float32Array(nx * ny * nz)
		for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[ix(i, j, k)] = f(x0 + i * h, y0 + j * h, z0 + k * h)
		const cellV = new Int32Array(nx * ny * nz).fill(-1)
		const pos = []
		const E = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [3, 7], [2, 6]] // corner bits: x = 1, y = 2, z = 4
		const cv = new Float32Array(8)
		const grad = (x, y, z, e) => {
			const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e)
			const l = Math.hypot(gx, gy, gz) || 1
			return [gx / l, gy / l, gz / l, l / (2 * e)]
		}
		for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
			let neg = 0
			for (let c = 0; c < 8; c++) { const v = val[ix(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; cv[c] = v; if (v < 0) neg++ }
			if (neg === 0 || neg === 8) continue
			let sx = 0, sy = 0, sz = 0, n = 0
			for (const [a, b] of E) {
				const va = cv[a], vb = cv[b]
				if ((va < 0) === (vb < 0)) continue
				const t = va / (va - vb)
				sx += (a & 1) + t * ((b & 1) - (a & 1)); sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1)); sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1)); n++
			}
			cellV[ix(i, j, k)] = pos.length / 3
			pos.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h)
		}
		// snap every vertex onto the surface (one Newton step along the gradient, at most 0.7 h) and take its normal there
		const nv = pos.length / 3
		const nor = new Float32Array(nv * 3)
		for (let v = 0; v < nv; v++) {
			let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2]
			let g = grad(x, y, z, h * 0.3)
			const fv = f(x, y, z)
			const step = Math.max(-h * 0.7, Math.min(h * 0.7, fv / Math.max(g[3], 1e-3)))
			x -= g[0] * step; y -= g[1] * step; z -= g[2] * step
			g = grad(x, y, z, h * 0.3)
			pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z
			nor[v * 3] = g[0]; nor[v * 3 + 1] = g[1]; nor[v * 3 + 2] = g[2]
		}
		const idx = []
		const quad = (a, b, c, d, flip) => {
			if (a < 0 || b < 0 || c < 0 || d < 0) return
			// orient by the normals: the triangle (a, b, c) must face along the vertices' average gradient
			const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2]
			const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az
			const wx = pos[c * 3] - ax, wy = pos[c * 3 + 1] - ay, wz = pos[c * 3 + 2] - az
			const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx
			const gx = nor[a * 3] + nor[b * 3] + nor[c * 3] + nor[d * 3], gy = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1] + nor[d * 3 + 1], gz = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2] + nor[d * 3 + 2]
			if (cx * gx + cy * gy + cz * gz >= 0) idx.push(a, b, c, a, c, d)
			else idx.push(a, c, b, a, d, c)
		}
		for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
			const v0 = val[ix(i, j, k)] < 0
			if ((val[ix(i + 1, j, k)] < 0) !== v0) quad(cellV[ix(i, j - 1, k - 1)], cellV[ix(i, j, k - 1)], cellV[ix(i, j, k)], cellV[ix(i, j - 1, k)])
			if ((val[ix(i, j + 1, k)] < 0) !== v0) quad(cellV[ix(i - 1, j, k - 1)], cellV[ix(i, j, k - 1)], cellV[ix(i, j, k)], cellV[ix(i - 1, j, k)])
			if ((val[ix(i, j, k + 1)] < 0) !== v0) quad(cellV[ix(i - 1, j - 1, k)], cellV[ix(i, j - 1, k)], cellV[ix(i, j, k)], cellV[ix(i - 1, j, k)])
		}
		const g = new THREE.BufferGeometry()
		g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3))
		g.setIndex(idx)
		return g
	}
	/** Polynomial smooth minimum of two distance values (blend width k). */
	const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25 }


	// ------------------------------------------------------------- shadows of clear things
	const depthMats = new Map()
	let proxyMat = null
	const BAYER_GLSL = `float bayer3(vec2 p) {
	// a 3 x 3 ordered-dither matrix (0 5 2 / 7 3 8 / 4 1 6) as (v + 0.5) / 9: k of the 9 cells are below k / 9
	vec2 q = mod(floor(p), 3.0);
	int i = int(q.x) + 3 * int(q.y);
	float t = i == 0 ? 0.0 : i == 1 ? 5.0 : i == 2 ? 2.0 : i == 3 ? 7.0 : i == 4 ? 3.0 : i == 5 ? 8.0 : i == 6 ? 4.0 : i == 7 ? 1.0 : 6.0;
	return (t + 0.5) / 9.0;
}
`
	/** A mesh that keeps its customDepthMaterial when the model is cloned (Mesh.copy does not copy it). */
	class ShadowProxy extends THREE.Mesh {
		copy(source, recursive) {
			super.copy(source, recursive)
			this.customDepthMaterial = source.customDepthMaterial
			return this
		}
	}
	/**
	 * three.js skips transmissive meshes in the shadow pass' light (a glass jar or a bottle of water would cast nothing, or only the shadow of its label and lid). Give the mesh a
	 * child that draws nothing in the picture but casts a light shadow: the same geometry, no colour or depth written, and a depth material for the shadow pass that throws away every
	 * fragment whose cell of a 3 x 3 ordered dither, taken in SHADOW-MAP pixels (gl_FragCoord), is above `density` (k of the 9 cells are opaque: 2 for 0.25, 3 for 0.35, 4 for 0.5). The dither
	 * is then exactly as fine as the shadow map's own texels, and its period (3) matches the odd 3 x 3 box of the PCF soft-shadow filter, so every filter window holds the same share of opaque texels
	 * and the table gets an even, see-through grey (a dither laid on the mesh's uv is far finer than a texel and landed in random clumps that read as sand; a period-2 dither left a regular
	 * screen-door pattern, as an even period does not average evenly over an odd number of taps). Cloned with the model (ShadowProxy.copy). `geometry`: a coarser stand-in with the same silhouette (the proxy is drawn in the picture too, with colour writes off).
	 */
	function glassShadow(mesh, density = 0.25, geometry = mesh.geometry) {
		const key = density.toFixed(3)
		let dm = depthMats.get(key)
		if (!dm) {
			dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
			dm.onBeforeCompile = (shader) => {
				shader.fragmentShader = shader.fragmentShader.replace("void main() {", `${BAYER_GLSL}\nvoid main() {\n\tif (bayer3(gl_FragCoord.xy) >= ${density.toFixed(4)}) discard;`)
			}
			dm.customProgramCacheKey = () => `eb-glass-shadow-b3-${key}`
			depthMats.set(key, dm)
		}
		if (!proxyMat) proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
		const p = new ShadowProxy(geometry, proxyMat)
		p.customDepthMaterial = dm
		p.castShadow = true
		p.receiveShadow = false
		p.renderOrder = -1
		mesh.add(p)
		return mesh
	}

	return {
		meshSDF, smin, glassShadow,
		spline, profileAt, flutedLathe, alongZ, disc, roundedPolyline, roundedPolygon, chordAt, superRing, satify,
		THREE, kit, TAU, f5, rng, hash, vnoise, fbm, clamp, mix, C, shade, blend, rich,
		normalTex, dataTex, mat, colorTex, withRepeat,
		rrect, rrectHole, circleHole, plate, rrPlate, notchedRRect, mergeGeos, rrectPts, circPts, loftX, ribbonX, latheLin,
		plane, decal, rbShare, faces, spaced, rr, fibres, pixels,
	}
}
