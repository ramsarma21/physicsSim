// Helpers for the everyday-shapes models (everyday-a*.js): seeded noise, canvas drawing, normal maps from height
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
	/**
	 * Fills `o8` (RGBA bytes, W x H) with the tangent-space normals of a height field `src` (stride 4 = a canvas's red channel, stride 1 = a Float32Array of heights); k = 0.5 * strength per height unit.
	 * A typed-array loop (no closure, no modulo in the inner loop): the border rows and columns wrap (or clamp) by choosing their neighbour once.
	 */
	function heightToNormal(o8, src, W, H, k, wrap, stride) {
		for (let y = 0; y < H; y++) {
			const ym = (y > 0 ? y - 1 : wrap ? H - 1 : 0) * W * stride
			const yp = (y < H - 1 ? y + 1 : wrap ? 0 : H - 1) * W * stride
			const row = y * W * stride
			for (let x = 0; x < W; x++) {
				const xm = (x > 0 ? x - 1 : wrap ? W - 1 : 0) * stride
				const xp = (x < W - 1 ? x + 1 : wrap ? 0 : W - 1) * stride
				const dx = (src[row + xp] - src[row + xm]) * k
				const dy = (src[ym + x * stride] - src[yp + x * stride]) * k // canvas up = +v
				const il = 1 / Math.sqrt(dx * dx + dy * dy + 1)
				const o = (y * W + x) * 4
				o8[o] = (-dx * il * 0.5 + 0.5) * 255
				o8[o + 1] = (-dy * il * 0.5 + 0.5) * 255
				o8[o + 2] = (il * 0.5 + 0.5) * 255
				o8[o + 3] = 255
			}
		}
	}
	/** A normal map from a Float32Array height field (W x H, no 8-bit steps): strength per height unit per texel. */
	function normalFromField(key, w, h, field, { strength = 2, wrap = true } = {}) {
		return kit.tex(`nrm|${key}`, w, h, (g, W, H) => {
			const out = g.createImageData(W, H)
			heightToNormal(out.data, field, W, H, 0.5 * strength, wrap, 1)
			g.putImageData(out, 0, 0)
		}, { data: true, wrap })
	}
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
			heightToNormal(out.data, src, W, H, (0.5 * strength) / 255, wrap, 4)
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
		if (!m.userData.eaGrade) {
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
	function plate(shape, y0, y1, { bevel = 0, holes = [], curve = 10 } = {}) {
		if (holes.length) shape.holes = holes
		const depth = Math.max(1e-5, y1 - y0 - 2 * bevel)
		const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curve })
		g.translate(0, 0, bevel) // z from 0 (bottom) to y1 - y0
		g.rotateX(-Math.PI / 2)
		g.translate(0, y0, 0)
		return g
	}
	/** A rounded-rectangle plate (plan w by d, corner radius r, from y0 to y1, edges rounded by `bevel`), the outline exactly w by d. */
	function rrPlate(w, d, r, y0, y1, { bevel = 0, holes = [] } = {}) {
		return plate(rrect(w - 2 * bevel, d - 2 * bevel, Math.max(0.0001, r - bevel)), y0, y1, { bevel, holes })
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

	return {
		THREE, kit, TAU, f5, rng, hash, vnoise, fbm, clamp, mix, C, shade, blend, rich,
		normalTex, normalFromField, dataTex, mat, colorTex, withRepeat,
		rrect, rrectHole, circleHole, plate, rrPlate, notchedRRect, mergeGeos, rrectPts, circPts, loftX, ribbonX, latheLin,
		plane, decal, rbShare, faces, spaced, rr, fibres, pixels,
	}
}
