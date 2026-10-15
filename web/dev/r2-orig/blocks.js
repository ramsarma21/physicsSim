// 3D models for the blocks catalog group (see web/models3d.js): wooden block, brick, steel weights, foam, ice, cardboard box,
// log, domino, wall. Every model fills its physics box (rounded or chamfered by a millimetre or two at most) and is built once:
// textures are baked per material at a fixed texel density (so resizing an item never re-bakes them) and the geometry is a rounded
// box whose faces carry their own maps. Metals, lacquers, ice and tape take the room environment at their own intensity with a warm
// table bounce in rays that point down; bricks, wooden blocks and dominoes vary per instance (see perInstance).
// Frame: x = width, y = height, z = front to back (toward the camera is +z); see web/models3d.js.

import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

// ------------------------------------------------------------------------------------------------ noise (tileable)
const mod = (a, n) => ((a % n) + n) % n
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const mix = (a, b, t) => a + (b - a) * t
const sstep = (a, b, x) => {
	const t = clamp01((x - a) / (b - a))
	return t * t * (3 - 2 * t)
}
function h3(a, b, c) {
	let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const hstr = (s) => {
	let h = 2166136261
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
	return h >>> 0
}
/** Periodic value noise on a tile: u, v in [0, 1), fx x fy lattice cells across it (integers), 0..1. */
function pn(u, v, fx, fy, s) {
	const x = u * fx, y = v * fy
	const xi = Math.floor(x), yi = Math.floor(y)
	let xf = x - xi, yf = y - yi
	xf = xf * xf * (3 - 2 * xf)
	yf = yf * yf * (3 - 2 * yf)
	let x0 = xi, y0 = yi
	if (x0 < 0 || x0 >= fx) x0 = mod(x0, fx)
	if (y0 < 0 || y0 >= fy) y0 = mod(y0, fy)
	const x1 = x0 + 1 === fx ? 0 : x0 + 1, y1 = y0 + 1 === fy ? 0 : y0 + 1
	const a = h3(x0, y0, s), b = h3(x1, y0, s), c = h3(x0, y1, s), d = h3(x1, y1, s)
	return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf
}
function pfbm(u, v, fx, fy, s, oct = 4, gain = 0.5) {
	let a = 0, amp = 1, norm = 0
	for (let o = 0; o < oct; o++) {
		a += amp * pn(u, v, fx << o, fy << o, s + o * 17)
		norm += amp
		amp *= gain
	}
	return a / norm
}
/**
 * The same noise as pn(), as a sampler over a lattice table filled once (one hash per cell instead of four per sample): the cheap way to
 * evaluate it for every pixel of a bake. pnS(fx, fy, s)(u, v) === pn(u, v, fx, fy, s).
 */
function pnS(fx, fy, s) {
	const T = new Float32Array(fx * fy)
	for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) T[j * fx + i] = h3(i, j, s)
	return (u, v) => {
		const x = u * fx, y = v * fy
		let xi = Math.floor(x), yi = Math.floor(y)
		let xf = x - xi, yf = y - yi
		xf = xf * xf * (3 - 2 * xf)
		yf = yf * yf * (3 - 2 * yf)
		if (xi < 0 || xi >= fx) xi = mod(xi, fx)
		if (yi < 0 || yi >= fy) yi = mod(yi, fy)
		const x1 = xi + 1 === fx ? 0 : xi + 1, y1 = yi + 1 === fy ? 0 : yi + 1
		const r0 = yi * fx, r1 = y1 * fx
		const a = T[r0 + xi], b = T[r0 + x1], c = T[r1 + xi], d = T[r1 + x1]
		return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf
	}
}
/** pfbm() as a sampler (see pnS). */
function pfbmS(fx, fy, s, oct = 4, gain = 0.5) {
	const f = []
	let norm = 0, amp = 1
	for (let o = 0; o < oct; o++) {
		f.push(pnS(fx << o, fy << o, s + o * 17))
		norm += amp
		amp *= gain
	}
	return (u, v) => {
		let a = 0, k = 1
		for (let o = 0; o < oct; o++) {
			a += k * f[o](u, v)
			k *= gain
		}
		return a / norm
	}
}
/** worley() as a sampler over precomputed cell points: worleyS(fx, fy, s)(u, v, out). */
function worleyS(fx, fy, s) {
	const PX = new Float32Array(fx * fy), PY = new Float32Array(fx * fy), ID = new Float32Array(fx * fy)
	for (let j = 0; j < fy; j++) {
		for (let i = 0; i < fx; i++) {
			PX[j * fx + i] = h3(i, j, s)
			PY[j * fx + i] = h3(i, j, s + 1)
			ID[j * fx + i] = h3(i, j, s + 2)
		}
	}
	return (u, v, o) => {
		const x = u * fx, y = v * fy
		const xi = Math.floor(x), yi = Math.floor(y)
		let f1 = 9, f2 = 9, id = 0
		for (let j = -1; j <= 1; j++) {
			const cy = yi + j
			const wy = cy < 0 ? cy + fy : cy >= fy ? cy - fy : cy
			for (let i = -1; i <= 1; i++) {
				const cx = xi + i
				const wx = cx < 0 ? cx + fx : cx >= fx ? cx - fx : cx
				const k = wy * fx + wx
				const dx = cx + PX[k] - x, dy = cy + PY[k] - y
				const d = dx * dx + dy * dy // squared: the root is taken for the two nearest only
				if (d < f1) {
					f2 = f1
					f1 = d
					id = ID[k]
				} else if (d < f2) f2 = d
			}
		}
		o.f1 = Math.sqrt(f1)
		o.f2 = Math.sqrt(f2)
		o.id = id
	}
}
/** Periodic jittered-cell noise: out.f1 / out.f2 = distance to the nearest two points (cell units), out.id = a 0..1 id of the nearest cell. */
function worley(u, v, fx, fy, s, o) {
	const x = u * fx, y = v * fy
	const xi = Math.floor(x), yi = Math.floor(y)
	let f1 = 9, f2 = 9, id = 0
	for (let j = -1; j <= 1; j++) {
		for (let i = -1; i <= 1; i++) {
			const cx = xi + i, cy = yi + j
			const wx = mod(cx, fx), wy = mod(cy, fy)
			const dx = cx + h3(wx, wy, s) - x, dy = cy + h3(wx, wy, s + 1) - y
			const d = Math.sqrt(dx * dx + dy * dy)
			if (d < f1) {
				f2 = f1
				f1 = d
				id = h3(wx, wy, s + 2)
			} else if (d < f2) f2 = d
		}
	}
	o.f1 = f1
	o.f2 = f2
	o.id = id
}
/** Plain (non periodic) 3D value noise for geometry, 0..1. */
function n3(x, y, z, s) {
	const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
	let xf = x - xi, yf = y - yi, zf = z - zi
	xf = xf * xf * (3 - 2 * xf)
	yf = yf * yf * (3 - 2 * yf)
	zf = zf * zf * (3 - 2 * zf)
	const k = (i, j, l) => h3(xi + i + s * 7, yi + j, zi + l)
	const a0 = mix(mix(k(0, 0, 0), k(1, 0, 0), xf), mix(k(0, 1, 0), k(1, 1, 0), xf), yf)
	const a1 = mix(mix(k(0, 0, 1), k(1, 0, 1), xf), mix(k(0, 1, 1), k(1, 1, 1), xf), yf)
	return mix(a0, a1, zf)
}
const fbm3 = (x, y, z, s, oct = 3) => {
	let a = 0, amp = 1, norm = 0, f = 1
	for (let o = 0; o < oct; o++) {
		a += amp * n3(x * f, y * f, z * f, s + o)
		norm += amp
		amp *= 0.5
		f *= 2
	}
	return a / norm
}

export default function register({ addModel, kit, THREE }) {
	const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]

	// ------------------------------------------------------------------------------------------ baked textures
	const baked = new Map()
	/**
	 * Bake colour (+ normal, + roughness) maps from a per-pixel function fn(u, v, o) (u right, v up, 0..1 on the tile; set o.r/g/b 0..255,
	 * o.h height 0..1, o.rough 0..1). Opts: normal = strength (0 = none), rough, wrap (repeat), paint(g, W, H) draws over the colour afterwards.
	 */
	function bake(key, W, H, fn, { normal = 0, rough = false, wrap = true, paint = null } = {}) {
		const hit = baked.get(key)
		if (hit) return hit
		const col = new ImageData(W, H)
		const rgh = rough ? new ImageData(W, H) : null
		const hgt = normal ? new Float32Array(W * H) : null
		const o = { r: 128, g: 128, b: 128, h: 0.5, rough: 0.5, ix: 0, iy: 0 }
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				o.h = 0.5
				o.rough = 0.5
				o.ix = x
				o.iy = y
				fn((x + 0.5) / W, 1 - (y + 0.5) / H, o)
				const i = (y * W + x) * 4
				col.data[i] = o.r
				col.data[i + 1] = o.g
				col.data[i + 2] = o.b
				col.data[i + 3] = 255
				if (hgt) hgt[y * W + x] = o.h
				if (rgh) {
					rgh.data[i + 1] = Math.max(0, Math.min(255, o.rough * 255))
					rgh.data[i + 3] = 255
				}
			}
		}
		let nrm = null
		if (hgt) {
			nrm = new ImageData(W, H)
			for (let y = 0; y < H; y++) {
				const ym = (y + H - 1) % H, yp = (y + 1) % H
				for (let x = 0; x < W; x++) {
					const xm = (x + W - 1) % W, xp = (x + 1) % W
					const dx = (hgt[y * W + xp] - hgt[y * W + xm]) * 0.5 * normal
					const dy = (hgt[yp * W + x] - hgt[ym * W + x]) * 0.5 * normal // canvas y points down: +dy is toward -v
					const len = Math.sqrt(dx * dx + dy * dy + 1)
					const i = (y * W + x) * 4
					nrm.data[i] = (-dx / len * 0.5 + 0.5) * 255
					nrm.data[i + 1] = (dy / len * 0.5 + 0.5) * 255
					nrm.data[i + 2] = (1 / len * 0.5 + 0.5) * 255
					nrm.data[i + 3] = 255
				}
			}
		}
		const put = (img, over) => (g) => {
			g.putImageData(img, 0, 0)
			if (over) over(g, W, H)
		}
		const res = {
			map: kit.tex(`blocks|${key}|c`, W, H, put(col, paint), { wrap }),
			normalMap: nrm ? kit.tex(`blocks|${key}|n`, W, H, put(nrm), { data: true, wrap }) : null,
			roughMap: rgh ? kit.tex(`blocks|${key}|r`, W, H, put(rgh), { data: true, wrap }) : null,
		}
		baked.set(key, res)
		return res
	}
	/** A 0..1 mask (Float32Array W*H, row 0 = top) of what draw(g, W, H) paints in white on black. */
	function maskOf(W, H, draw) {
		const c = document.createElement("canvas")
		c.width = W
		c.height = H
		const g = c.getContext("2d")
		g.fillStyle = "#000"
		g.fillRect(0, 0, W, H)
		g.fillStyle = "#fff"
		g.strokeStyle = "#fff"
		draw(g, W, H)
		const d = g.getImageData(0, 0, W, H).data
		const m = new Float32Array(W * H)
		for (let i = 0; i < m.length; i++) m[i] = d[i * 4] / 255
		return m
	}
	// the scene grades its own materials a little more saturated before tone mapping (view3d's `satify`); do the same here
	const SAT = 1.3
	const GRADE = `{ float gl = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)); outgoingLight = max(vec3(0.0), mix(vec3(gl), outgoingLight, ${SAT.toFixed(2)})); }`
	// Metals and lacquers get the room environment with its own intensity (the kit's materials only see the scene's 0.5), and rays that
	// point down meet the table: a warm wood bounce in the reflection, as on any real polished object standing on a wooden table.
	let tableChunk = null
	function tableEnvChunk() {
		if (tableChunk === null) {
			let c = THREE.ShaderChunk.envmap_physical_pars_fragment
			const i = c.indexOf("vec3 getIBLRadiance")
			const tail = "return envMapColor.rgb * envMapIntensity;"
			const j = c.indexOf(tail, i)
			if (i < 0 || j < 0) tableChunk = ""
			else {
				const patch = `vec3 ec = envMapColor.rgb;
			float below = smoothstep(0.08, -0.3, reflectVec.y);
			float lum = dot(ec, vec3(0.3333));
			ec = mix(ec, vec3(0.74, 0.48, 0.3) * (0.45 + 0.55 * lum) * 0.75, below * 0.62);
			return ec * envMapIntensity;`
				tableChunk = c.slice(0, j) + patch + c.slice(j + tail.length)
			}
		}
		return tableChunk
	}
	function graded(m, env = false, inject = "") {
		if (!m.userData.graded) {
			m.userData.graded = true
			m.userData.gradedOpts = { env, inject }
			m.onBeforeCompile = (shader) => {
				shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", inject + "\n" + GRADE + "\n#include <opaque_fragment>")
				if (env) {
					const chunk = tableEnvChunk()
					if (chunk) shader.fragmentShader = shader.fragmentShader.replace("#include <envmap_physical_pars_fragment>", chunk)
				}
			}
			m.customProgramCacheKey = () => (env ? "blocks-grade-env" : "blocks-grade") + (inject ? "-" + hstr(inject) : "")
			if (env) {
				m.onBeforeRender = (r, scene) => {
					if (scene.environment && m.envMap !== scene.environment) m.envMap = scene.environment
				}
			}
		}
		return m
	}
	/** A cached graded material (kit.mat). */
	const M = (key, params, env = false, inject = "") => graded(kit.mat(`blocks|${key}`, params), env, inject)
	/** A material from baked maps. extra = three.js params (color, roughness, clearcoat, ...). */
	function matOf(key, b, extra = {}, env = false) {
		const p = { ...extra }
		if (b.map) p.map = b.map
		if (b.normalMap) p.normalMap = b.normalMap
		if (b.roughMap) p.roughnessMap = b.roughMap
		return M(key, p, env)
	}

	// ------------------------------------------------------------------------------------------ per-instance variation
	// A model is built once and cloned for every item of its kind, so five bricks would be five identical copies. Each mesh of a clone is
	// given its own look the first time it is drawn, chosen by a hash of the owning solid's id (view3d tags every mesh with it), so a stack of bricks
	// or a row of dominoes differs, and the same scene always looks the same. Without an id (a catalog thumbnail) the base look stays.
	const variantMats = new Map()
	/** A copy of material `mat` with its textures moved by (ou, ov) and mirrored (fx, fy), and its colour scaled by tint ([r, g, b]). Cached by `key`. */
	function variantOf(mat, key, { ou = 0, ov = 0, fx = false, fy = false, tint = null } = {}) {
		const k = `${mat.uuid}|${key}`
		let m = variantMats.get(k)
		if (!m) {
			m = mat.clone()
			const o = mat.userData.gradedOpts ?? { env: false, inject: "" }
			delete m.userData.graded
			graded(m, o.env, o.inject)
			for (const slot of ["map", "normalMap", "roughnessMap"]) {
				if (!mat[slot]) continue
				const t = mat[slot].clone()
				t.repeat.set(fx ? -1 : 1, fy ? -1 : 1)
				t.offset.set((fx ? 1 : 0) + ou, (fy ? 1 : 0) + ov)
				t.needsUpdate = true
				m[slot] = t
			}
			if (tint) m.color = new THREE.Color().setRGB(mat.color.r * tint[0], mat.color.g * tint[1], mat.color.b * tint[2], THREE.LinearSRGBColorSpace)
			variantMats.set(k, m)
		}
		return m
	}
	/** Install the one-time per-instance pick on every mesh of `group` (a fresh clone): pick(mesh, hash) returns the mesh's material(s), or null to keep them. */
	function varyOnFirstDraw(group, pick) {
		group.traverse((o) => {
			if (!o.isMesh) return
			o.onBeforeRender = function () {
				const id = this.userData.solidId
				if (id === undefined) return // not placed in a scene yet (or a thumbnail): try again next draw
				this.onBeforeRender = () => {}
				const m = pick(this, hstr(String(id)))
				if (m) this.material = m
			}
		})
		return group
	}
	/** Make `proto` (a built model) hand out clones that vary per instance by pick(mesh, hash). */
	function perInstance(proto, pick) {
		proto.clone = function (recursive) {
			return varyOnFirstDraw(THREE.Group.prototype.clone.call(this, recursive), pick)
		}
		return proto
	}
	const frac = (hsh, n) => h3(hsh | 0, n, 4021)

	// ------------------------------------------------------------------------------------------ geometry
	const FACE = ["px", "nx", "py", "ny", "pz", "nz"]
	// per face: which axes the grid runs along (u list, v list), the fixed axis and its sign, how the flat coordinates become the
	// face's own (a, b) as seen from outside, and which box dimensions those two span (0 = w, 1 = h, 2 = d)
	const FACES = {
		px: { ax: [2, 1], fixed: 0, sign: 1, ab: (x, y, z) => [-z, y], dim: [2, 1] },
		nx: { ax: [2, 1], fixed: 0, sign: -1, ab: (x, y, z) => [z, y], dim: [2, 1] },
		py: { ax: [0, 2], fixed: 1, sign: 1, ab: (x, y, z) => [x, -z], dim: [0, 2] },
		ny: { ax: [0, 2], fixed: 1, sign: -1, ab: (x, y, z) => [x, z], dim: [0, 2] },
		pz: { ax: [0, 1], fixed: 2, sign: 1, ab: (x, y, z) => [x, y], dim: [0, 1] },
		nz: { ax: [0, 1], fixed: 2, sign: -1, ab: (x, y, z) => [-x, y], dim: [0, 1] },
	}
	/** Sample positions along one axis of a rounded box: dense in the two rounded zones (equal angle steps), `n` even steps between. */
	function axisList(half, r, n, k) {
		const inner = half - r
		const out = []
		for (let i = k; i >= 1; i--) out.push(-(inner + r * Math.tan((i / k) * Math.PI / 4)))
		for (let i = 0; i <= n; i++) out.push(-inner + (2 * inner * i) / n)
		for (let i = 1; i <= k; i++) out.push(inner + r * Math.tan((i / k) * Math.PI / 4))
		return out
	}
	/**
	 * A rounded box w x h x d (corner radius r) with six material groups in the order +x -x +y -y +z -z, smooth welded normals, and
	 * uv per face centred on the face. opts: seg [sx, sy, sz] even steps per axis, k arc steps, disp(x, y, z, nx, ny, nz) = offset along
	 * the normal, tile {face: [tu, tv, ou, ov, swap]}: the texture covers tu x tv metres (so it keeps its real size however the box is
	 * resized), u = 0.5 + a / tu + ou, v = 0.5 + b / tv + ov, a and b being metres along the face as seen from outside; `swap` runs
	 * the texture's u along b instead (grain across the face). A face with no tile maps 0..1 over the whole face.
	 */
	function softBox(w, h, d, r, { seg = [1, 1, 1], k = 4, tile = {}, disp = null } = {}) {
		const dims = [w, h, d]
		const half = dims.map((v) => v / 2)
		r = Math.max(1e-5, Math.min(r, 0.49 * Math.min(w, h, d)))
		const lists = [0, 1, 2].map((i) => axisList(half[i], r, Math.max(1, seg[i]), k))
		const inner = half.map((v) => v - r)
		const pos = [], uvs = [], idx = [], groups = []
		let base = 0
		for (const name of FACE) {
			const F = FACES[name]
			const A = lists[F.ax[0]], B = lists[F.ax[1]]
			const T = tile[name]
			const start = idx.length
			const flat = (i, j) => {
				const p = [0, 0, 0]
				p[F.ax[0]] = A[i]
				p[F.ax[1]] = B[j]
				p[F.fixed] = F.sign * half[F.fixed]
				return p
			}
			for (let j = 0; j < B.length; j++) {
				for (let i = 0; i < A.length; i++) {
					const p = flat(i, j)
					const c0 = Math.max(-inner[0], Math.min(inner[0], p[0]))
					const c1 = Math.max(-inner[1], Math.min(inner[1], p[1]))
					const c2 = Math.max(-inner[2], Math.min(inner[2], p[2]))
					let dx = p[0] - c0, dy = p[1] - c1, dz = p[2] - c2
					const dl = Math.hypot(dx, dy, dz) || 1
					dx /= dl
					dy /= dl
					dz /= dl
					let X = c0 + dx * r, Y = c1 + dy * r, Z = c2 + dz * r
					if (disp) {
						const o = disp(X, Y, Z, dx, dy, dz)
						X += dx * o
						Y += dy * o
						Z += dz * o
					}
					pos.push(X, Y, Z)
					const [a, b] = F.ab(p[0], p[1], p[2])
					if (T) {
						if (T[4]) uvs.push(0.5 + b / T[0] + (T[2] ?? 0), 0.5 + a / T[1] + (T[3] ?? 0))
						else uvs.push(0.5 + a / T[0] + (T[2] ?? 0), 0.5 + b / T[1] + (T[3] ?? 0))
					} else uvs.push(0.5 + a / dims[F.dim[0]], 0.5 + b / dims[F.dim[1]])
				}
			}
			// the triangle order that points outward: test the first cell
			const p00 = flat(0, 0), p10 = flat(1, 0), p01 = flat(0, 1)
			const e1 = [0, 1, 2].map((q) => p10[q] - p00[q]), e2 = [0, 1, 2].map((q) => p01[q] - p00[q])
			const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
			const rev = cr[F.fixed] * F.sign < 0
			const W = A.length
			for (let j = 0; j < B.length - 1; j++) {
				for (let i = 0; i < W - 1; i++) {
					const a = base + j * W + i, b = a + 1, c = a + W, e = c + 1
					if (rev) idx.push(a, c, b, b, c, e)
					else idx.push(a, b, c, b, e, c)
				}
			}
			groups.push([start, idx.length - start])
			base += A.length * B.length
		}
		const g = new THREE.BufferGeometry()
		g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
		g.setIndex(idx)
		groups.forEach(([s, n], i) => g.addGroup(s, n, i))
		weldNormals(g)
		return g
	}
	/** Vertex normals averaged over coincident vertices (so the seams between the six faces shade smoothly). */
	function weldNormals(g) {
		const P = g.attributes.position.array
		const I = g.index.array
		const key = (i) => `${Math.round(P[i * 3] * 1e7)},${Math.round(P[i * 3 + 1] * 1e7)},${Math.round(P[i * 3 + 2] * 1e7)}`
		const acc = new Map()
		const keys = new Array(P.length / 3)
		for (let i = 0; i < keys.length; i++) keys[i] = key(i)
		for (let t = 0; t < I.length; t += 3) {
			const a = I[t], b = I[t + 1], c = I[t + 2]
			const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2]
			const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2]
			const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
			for (const v of [a, b, c]) {
				let e = acc.get(keys[v])
				if (!e) acc.set(keys[v], (e = [0, 0, 0]))
				e[0] += nx
				e[1] += ny
				e[2] += nz
			}
		}
		const N = new Float32Array(P.length)
		for (let i = 0; i < keys.length; i++) {
			const e = acc.get(keys[i])
			const l = Math.hypot(e[0], e[1], e[2]) || 1
			N[i * 3] = e[0] / l
			N[i * 3 + 1] = e[1] / l
			N[i * 3 + 2] = e[2] / l
		}
		g.setAttribute("normal", new THREE.BufferAttribute(N, 3))
		g.computeBoundingSphere()
		g.computeBoundingBox()
	}

	// ------------------------------------------------------------------------------------------ wood
	// baked tiles per species: grain along u on the "long" tile, end grain on the "end" tile (real sizes, so they keep their scale)
	const WOODS = {
		maple: { early: [242, 212, 156], late: [214, 166, 104], pore: 0.9, ringW: 0.0021, ringPore: 0, end: [220, 184, 132], endLate: [184, 142, 92] },
		beech: { early: [232, 182, 124], late: [196, 138, 84], pore: 0.86, ringW: 0.0026, ringPore: 0, end: [214, 160, 104], endLate: [172, 118, 70] },
		oak: { early: [214, 172, 112], late: [168, 122, 70], pore: 0.72, ringW: 0.003, ringPore: 1, end: [200, 156, 100], endLate: [150, 108, 64] },
		walnut: { early: [118, 78, 52], late: [74, 46, 32], pore: 0.8, ringW: 0.0028, ringPore: 0.4, end: [100, 64, 42], endLate: [62, 38, 26] },
	}
	const LONG_T = [0.48, 0.12]
	const END_T = [0.1, 0.1]
	// cathedral: flat-sawn face (arches), straight: quarter-sawn edge face (evenly spaced straight lines), dom: the small legacy tile the domino faces sample
	const WOOD_CFG = {
		cath: { tx: 0.48, ty: 0.12, arches: 3, zmin: 0.01, zamp: 0.028 },
		straight: { tx: 0.48, ty: 0.12, straight: true },
		dom: { tx: 0.16, ty: 0.08, arches: 1, zmin: 0.003, zamp: 0.022 },
	}
	/**
	 * Long-grain wood colour at tile coordinates (grain along u): sets o.r, o.g, o.b, o.h. The rings are cylinders round a pith that runs
	 * along the grain; a flat-sawn face cuts them at a depth that varies along the board, which gives the arches (the "cathedral") of real boards.
	 * A straight face cuts the rings edge-on instead (the pith far off the tile), so its lines run parallel and evenly spaced.
	 */
	function woodGrain(P, u, v, o, cfg = WOOD_CFG.cath) {
		const kx = cfg.tx / 0.16, ky = cfg.ty / 0.08 // lattice counts below were tuned on a 0.16 x 0.08 m tile
		const L = (n, k) => Math.max(1, Math.round(n * k))
		const y = (v - 0.5) * cfg.ty
		let zd, pithY
		if (cfg.straight) {
			zd = 0.004
			pithY = -0.09
		} else {
			const n = cfg.arches
			const amp = cfg.zamp * (n > 1 ? 0.65 + 0.7 * pn(u, 0.5, n, 1, 61) : 1)
			const ph = n > 1 ? 0.5 * (pn(u, 0.5, n, 1, 62) - 0.5) : 0
			zd = cfg.zmin + amp * (0.5 - 0.5 * Math.cos(Math.PI * 2 * (n * u - 0.3 + ph)))
			pithY = n > 1 ? 0.06 : 0.012 // level with the tile's top edge: arches rise toward it instead of closing into eyes
		}
		const wob = (pfbm(u, v, L(3, kx), L(3, ky), 11, 4) - 0.5) * 0.006 + (pn(u, v, L(2, kx), L(6, ky), 12) - 0.5) * 0.002
		const rho = Math.hypot(y - pithY + wob, zd)
		const g = rho / P.ringW
		const fr = g - Math.floor(g)
		const late = Math.pow(fr, 2.2) * (1 - sstep(0.84, 1.0, fr)) // the ring edge is crisp but not a one-pixel step (it would stair-step on a slanted line)
		const streak = pn(u, v, L(4, kx), L(230, ky), 21) - 0.5
		const streak2 = pn(u, v, L(14, kx), L(80, ky), 22) - 0.5
		const pores = P.ringPore ? sstep(0.7, 0.9, pn(u, v, L(70, kx), L(420, ky), 31)) * (0.3 + 0.9 * (1 - late)) : sstep(0.8, 0.95, pn(u, v, L(120, kx), L(380, ky), 31)) * 0.55
		const tone = clamp01(late * 0.8 + streak * 0.45 + streak2 * 0.25 + (pfbm(u, v, L(2, kx), L(2, ky), 41, 3) - 0.5) * 0.45)
		const c = lerp3(P.early, P.late, tone)
		const chat = 1 + 0.07 * (pn(u, v, L(5, kx), L(2, ky), 45) - 0.5) * 2
		const m = (1 - (1 - P.pore) * pores) * chat
		o.r = c[0] * m
		o.g = c[1] * m
		o.b = c[2] * m
		o.h = 0.5 - pores * 0.25 + streak * 0.08
	}
	function woodLong(kind, straight = false) {
		const P = WOODS[kind]
		const cfg = straight ? WOOD_CFG.straight : WOOD_CFG.cath
		return bake(`wood-long2|${kind}|${straight}`, 1536, 384, (u, v, o) => woodGrain(P, u, v, o, cfg), { normal: 2.5 })
	}
	function woodEnd(kind) {
		const P = WOODS[kind]
		return bake(`wood-end2|${kind}`, 384, 384, (u, v, o) => {
			const x = (u - 0.5) * END_T[0], y = (v - 0.5) * END_T[1]
			const wob = (pfbm(u, v, 4, 4, 51, 3) - 0.5) * 0.0016
			// the pith lies far to one side, so the rings cross the end as near-vertical arcs and meet the straight grain of the top and bottom
			const cx = 0.13, cy = 0.008
			const r0 = Math.hypot(x - cx, y - cy)
			const rho = r0 + wob + 0.0022 * Math.sin(r0 * 210) // rings widen and narrow with the seasons
			const g = rho / 0.0027
			const fr = g - Math.floor(g)
			const late = Math.pow(fr, 2.2) * (1 - sstep(0.84, 1.0, fr))
			const dots = sstep(0.78, 0.92, pn(u, v, 500, 500, 61)) // maple's pores are far below what the eye resolves: a faint speckle only
			const rays = pn(Math.atan2(y - cy, x - cx) / 6.2832 + 0.5, (rho * 30) % 1, 70, 6, 62)
			const tone = clamp01(late * 0.8 + (rays - 0.5) * 0.35 + (pfbm(u, v, 3, 3, 63, 3) - 0.5) * 0.5)
			const c = lerp3(P.end, P.endLate, tone)
			const m = (1 - (1 - P.pore) * dots * 0.6 - 0.06) * 0.88 // end grain drinks stain and reads about 12% darker than the long grain
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = 0.5 - dots * 0.08 + (late - 0.5) * 0.06
		}, { normal: 3 })
	}
	/** The wood materials {long (cathedral), straight, end} for a species (tinted when the item carries its own colour). */
	function woodMats(kind, { stain = null, gloss = 0.85, tag = "" } = {}) {
		const L = woodLong(kind), S = woodLong(kind, true), E = woodEnd(kind)
		const common = { color: stain ?? "#ffffff", roughness: 0.4, metalness: 0, clearcoat: gloss, clearcoatRoughness: 0.08 }
		return {
			long: matOf(`wood-long2|${kind}|${stain}|${gloss}|${tag}`, L, { ...common, normalScale: new THREE.Vector2(0.5, 0.5) }),
			straight: matOf(`wood-straight2|${kind}|${stain}|${gloss}|${tag}`, S, { ...common, normalScale: new THREE.Vector2(0.5, 0.5) }),
			end: matOf(`wood-end2|${kind}|${stain}|${gloss}|${tag}`, E, { ...common, roughness: 0.55, normalScale: new THREE.Vector2(0.6, 0.6) }),
		}
	}
	const woodKindOf = (lookName) => (lookName === "dark wood" ? "walnut" : lookName === "light wood" ? "beech" : "maple")

	// ------------------------------------------------------------------------------------------ cork
	function corkTex() {
		return bake("cork", 512, 512, (u, v, o) => {
			const W = {}
			worley(u, v, 90, 90, 5, W)
			const edge = sstep(0.0, 0.3, W.f2 - W.f1)
			const c = lerp3([208, 160, 106], [164, 114, 68], W.id)
			const fleck = sstep(0.78, 0.9, pn(u, v, 140, 140, 9)) * 0.45
			const m = (0.72 + 0.28 * edge) * (1 - fleck) * (0.94 + 0.12 * pn(u, v, 12, 12, 3))
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = 0.25 + edge * 0.6 + W.id * 0.1
		}, { normal: 3.5 })
	}
	const CORK_T = [0.1, 0.1]

	// ------------------------------------------------------------------------------------------ generic blocks
	const mesh = (g, m) => kit.mesh(g, m)
	const sixTiles = (t, ends = t) => ({
		pz: [t[0], t[1]], nz: [t[0], t[1], 0.31, 0.17], py: [t[0], t[1], 0.13, 0.4], ny: [t[0], t[1], 0.6, 0.77],
		px: [ends[0], ends[1]], nx: [ends[0], ends[1], 0.2, 0.1],
	})
	function blockWood({ w, h, d, solid }) {
		const kind = woodKindOf(solid.look)
		const M = woodMats(kind, { stain: solid.color ?? null })
		// long grain on the four long faces (along x), end grain on the two ends (x = +-w/2)
		const geo = softBox(w, h, d, Math.min(0.0016, 0.1 * Math.min(w, h, d)), { k: 4, tile: sixTiles(LONG_T, END_T) })
		const proto = kit.group(mesh(geo, [M.end, M.end, M.straight, M.straight, M.long, M.long]))
		// each block is cut from a different place in the board: the long-grain tiles are periodic in u, so shift and mirror them per block
		return perInstance(proto, (mesh, hsh) => {
			const vi = hsh % 12
			const ou = frac(vi, 1), fx = frac(vi, 3) < 0.5, fy = frac(vi, 4) < 0.5
			const k = 0.97 + 0.06 * frac(vi, 5)
			const tint = [k, k, k]
			const key = `w${vi}`
			return [M.end, M.end, M.straight, M.straight, M.long, M.long].map((m, i) => (i < 2 ? variantOf(m, key, { fx, fy, tint }) : variantOf(m, key, { ou, fx, fy, tint })))
		})
	}
	function blockCork({ w, h, d, solid }) {
		const b = corkTex()
		const m = matOf(`cork|${solid.color}`, b, { color: solid.color ?? "#ffffff", roughness: 0.92, normalScale: new THREE.Vector2(0.9, 0.9) })
		const geo = softBox(w, h, d, Math.min(0.0018, 0.1 * Math.min(w, h, d)), { k: 3, tile: sixTiles(CORK_T) })
		return kit.group(mesh(geo, m))
	}

	// ------------------------------------------------------------------------------------------ domino
	const PIPS = [
		[], [[0.5, 0.5]], [[0.28, 0.28], [0.72, 0.72]], [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]], [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
		[[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]], [[0.28, 0.28], [0.72, 0.28], [0.28, 0.5], [0.72, 0.5], [0.28, 0.72], [0.72, 0.72]],
	]
	const DOM_COMBOS = [[6, 6], [5, 3], [4, 1], [2, 6], [0, 4], [3, 3], [1, 5], [2, 0], [6, 4], [5, 5], [3, 1], [0, 0]]
	function dominoGrain() {
		const P = WOODS.beech
		return bake("domino-grain2", 256, 512, (u, v, o) => woodGrain(P, v * 0.31 + 0.2, u * 0.31 + 0.1, o, WOOD_CFG.dom), { normal: 2 }) // the grain runs along the domino's length (v)
	}
	/**
	 * The wood face with its two halves of pips and the divider. Pips are drilled and paint-filled: a bowl in the normal map with a thin lip, dark matte
	 * paint, a slightly higher roughness than the lacquered wood; the divider is an engraved line (dark centre, V in the normal map) with the brass spindle.
	 */
	let grainNormalData = null
	const dominoFaces = new Map() // "a|b" -> {map, normalMap, roughMap}: the height field is built once per pip pair, not per clone
	function dominoFace(a, b) {
		const known = dominoFaces.get(`${a}|${b}`)
		if (known) return known
		const base = dominoGrain()
		const W = 256, H = 512
		const R = 0.075 * W
		const pips = []
		for (const [n, top] of [[a, true], [b, false]]) for (const [px, py] of PIPS[n]) pips.push([px * W, top ? (0.5 - py / 2) * H : (1 - py / 2) * H])
		const gx0 = 0.1 * W, gx1 = 0.9 * W, gy = H / 2, gw = 2.6 // divider: half-width in px
		// height field: 0 = the surface, negative = cut in
		const hgt = new Float32Array(W * H)
		const paint = new Float32Array(W * H) // 0..1 paint-filled
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
			let hv = 0, pa = 0
			for (const [cx, cy] of pips) {
				const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
				if (dd < R + 2) {
					const bowl = dd < R ? 1 - (dd / R) * (dd / R) : 0
					hv = Math.min(hv, -0.9 * Math.pow(bowl, 0.6) * (dd < R ? 1 : 0)) + (dd >= R && dd < R + 1.6 ? 0.18 : 0) // the wood's lip
					if (dd < R) pa = 1 - sstep(R - 1.2, R, dd)
				}
			}
			const inX = Math.min(sstep(gx0 - 1, gx0 + 3, x), 1 - sstep(gx1 - 3, gx1 + 1, x))
			const dy = Math.abs(y + 0.5 - gy)
			const gv = inX * (1 - sstep(0, gw, dy))
			hv = Math.min(hv, -0.7 * gv)
			hgt[y * W + x] = hv
			paint[y * W + x] = Math.max(pa, gv * 0.9)
		}
		const grainN = (grainNormalData ??= base.normalMap.image.getContext("2d").getImageData(0, 0, W, H).data)
		const grainC = base.map.image
		const map = kit.tex(`blocks|domino-face2|${a}|${b}`, W, H, (g) => {
			g.drawImage(grainC, 0, 0)
			const img = g.getImageData(0, 0, W, H)
			for (let i = 0; i < W * H; i++) {
				const pa = paint[i]
				const lip = hgt[i] > 0 ? 1 : 0
				const k = lip ? 1.04 : 1
				img.data[i * 4] = mix(img.data[i * 4] * k, 24, pa)
				img.data[i * 4 + 1] = mix(img.data[i * 4 + 1] * k, 20, pa)
				img.data[i * 4 + 2] = mix(img.data[i * 4 + 2] * k, 17, pa)
			}
			g.putImageData(img, 0, 0)
			// the brass spindle at the centre of the divider
			g.fillStyle = "#d6b25e"
			g.beginPath()
			g.arc(W / 2, H / 2, 0.036 * W, 0, Math.PI * 2)
			g.fill()
			g.strokeStyle = "rgba(60,40,10,0.7)"
			g.lineWidth = 1.2
			g.stroke()
		})
		const S = 2.4
		const normalMap = kit.tex(`blocks|domino-face2n|${a}|${b}`, W, H, (g) => {
			const img = new ImageData(W, H)
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1)
				const dx = (hgt[y * W + xp] - hgt[y * W + xm]) * 0.5 * S
				const dy = (hgt[yp * W + x] - hgt[ym * W + x]) * 0.5 * S
				const i = (y * W + x) * 4
				// the grain's own normal (tangent-space xy) plus the cut's slope
				const gnx = grainN[i] / 127.5 - 1, gny = grainN[i + 1] / 127.5 - 1
				let nx = gnx - dx, ny = gny + dy, nz = 1
				const len = Math.hypot(nx, ny, nz)
				img.data[i] = (nx / len * 0.5 + 0.5) * 255
				img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255
				img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255
				img.data[i + 3] = 255
			}
			g.putImageData(img, 0, 0)
		}, { data: true })
		const roughMap = kit.tex(`blocks|domino-face2r|${a}|${b}`, W, H, (g) => {
			const img = new ImageData(W, H)
			for (let i = 0; i < W * H; i++) {
				img.data[i * 4 + 1] = 255 * (0.3 + 0.28 * paint[i])
				img.data[i * 4 + 3] = 255
			}
			g.putImageData(img, 0, 0)
		}, { data: true })
		const out = { map, normalMap, roughMap }
		dominoFaces.set(`${a}|${b}`, out)
		return out
	}
	function dominoModel({ w, h, d, solid }) {
		const kind = "beech"
		const stain = solid.color ?? null
		const M = woodMats(kind, { stain, gloss: 1, tag: "lacquer" })
		const key = hstr(String(solid.id))
		const ca = DOM_COMBOS[key % DOM_COMBOS.length], cb = DOM_COMBOS[(key >>> 5) % DOM_COMBOS.length]
		const face = (c) => {
			const b = dominoFace(c[0], c[1])
			return matOf(`domino-face2|${c}|${stain}`, b, { color: stain ?? "#ffffff", roughness: 1, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.8, normalScale: new THREE.Vector2(0.9, 0.9) }, true)
		}
		const tile = {
			pz: [LONG_T[0], LONG_T[1], 0.2, 0.31, true], nz: [LONG_T[0], LONG_T[1], 0.4, 0.5, true],
			py: [END_T[0], END_T[1]], ny: [END_T[0], END_T[1], 0.3, 0.2],
		}
		const geo = softBox(w, h, d, Math.min(0.0006, 0.12 * Math.min(w, h, d)), { k: 3, tile })
		const proto = kit.group(mesh(geo, [face(ca), face(cb), M.end, M.end, M.straight, M.straight]))
		// every tile shows its own pips: the model is shared, so each clone picks its two halves from its solid's id the first time it is drawn
		return perInstance(proto, (mesh, hsh) => {
			const x = hsh >>> 3
			const pa = DOM_COMBOS[x % DOM_COMBOS.length], pb = DOM_COMBOS[(x >>> 4) % DOM_COMBOS.length]
			return [face(pa), face(pb), M.end, M.end, M.straight, M.straight]
		})
	}
	addModel("domino", "domino", dominoModel)
	addModel("domino-row", "*", dominoModel)

	// ------------------------------------------------------------------------------------------ wooden log
	const BARK_TZ = 0.25
	/** 0 (deep furrow) .. 1 (plate top) at (angle fraction u, length coordinate v), periodic in both: the 0.5 contours of slowly varying noise are the fissures. */
	function barkDepth(u, v) {
		const warp = (pfbm(u, v, 6, 2, 81, 3) - 0.5) * 0.06 + (pn(u, v, 3, 16, 89) - 0.5) * 0.012
		const a = pn(u + warp, v, 34, 2, 82)
		const da = Math.abs(a - 0.5)
		const f1 = 1 - sstep(0.0, 0.065, da)
		const b = pn(u + warp * 0.8, v, 78, 4, 84)
		const f2 = (1 - sstep(0.0, 0.06, Math.abs(b - 0.5))) * 0.4
		const c = pfbm(u, v, 70, 14, 83, 3)
		const plate = 0.85 + 0.15 * sstep(0.05, 0.3, da) // plates are only slightly rounded
		const ridge = pn(u + warp * 0.5, v, 160, 8, 90) // fine lengthwise fibrous ridges inside the plates
		return clamp01(plate + 0.06 * (c - 0.5) + 0.15 * (ridge - 0.5) - Math.max(f1, f2) * (0.7 + 0.3 * c))
	}
	const LOGS = {
		oak: { sap: [226, 190, 138], heart: [170, 122, 76], ring: 0.78, bark: [[118, 98, 82], [66, 48, 38]], rings: 24 },
		beech: { sap: [236, 210, 168], heart: [220, 180, 132], ring: 0.84, bark: [[140, 132, 120], [88, 78, 68]], rings: 28 },
		walnut: { sap: [192, 160, 120], heart: [92, 58, 38], ring: 0.72, bark: [[92, 76, 64], [52, 38, 30]], rings: 22 },
	}
	function logKind(lookName) {
		return lookName === "dark wood" ? "walnut" : lookName === "light wood" ? "beech" : "oak"
	}
	function barkTex(kind) {
		const P = LOGS[kind]
		return bake(`bark3|${kind}`, 1024, 640, (u, v, o) => {
			const d = barkDepth(u, v)
			const s1 = pn(u, v, 300, 10, 86) // lengthwise fibres
			const s2 = pn(u, v, 120, 4, 87)
			const mott = pfbm(u, v, 24, 6, 91, 3)
			const lichen = sstep(0.62, 0.8, pfbm(u, v, 5, 3, 88, 3))
			let c = lerp3(P.bark[1], P.bark[0], clamp01(d * 1.25 - 0.25))
			// the walls of a furrow are a warmer reddish brown where the inner bark shows
			const wall = sstep(0.12, 0.25, d) * (1 - sstep(0.4, 0.6, d))
			c = lerp3(c, [110, 72, 50], wall * 0.55)
			c = lerp3(c, [150, 150, 128], lichen * 0.22 * d)
			const m = 0.78 + 0.34 * (s1 - 0.5) + 0.22 * (s2 - 0.5) + 0.3 * (mott - 0.5)
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = d * 0.9 + (s1 - 0.5) * 0.12 + (s2 - 0.5) * 0.06
		}, { normal: 5 })
	}
	function logEndTex(kind) {
		const P = LOGS[kind]
		const cracks = [0.06, 0.2, 0.33, 0.52, 0.66, 0.83].map((a, i) => ({ a: a * 6.2832 + 0.4 * h3(i, 1, 5), w: 0.016 + 0.014 * h3(i, 2, 5), q0: 0.32 + 0.33 * h3(i, 3, 5), q1: 0.92 }))
		return bake(`log-end2|${kind}`, 640, 640, (u, v, o) => {
			const x = (u - 0.5) * 2, y = (v - 0.5) * 2
			const rho = Math.hypot(x, y)
			const cx = 0.05, cy = -0.03
			const ang = Math.atan2(y - cy, x - cx)
			const wob = (pfbm(u, v, 5, 5, 71, 3) - 0.5) * 0.05 + 0.02 * Math.sin(ang * 3 + 1.3)
			const q = Math.hypot(x - cx, y - cy) * (1 + 0.04 * Math.sin(ang * 2)) + wob
			const g = q * P.rings
			const late = Math.pow(g - Math.floor(g), 2.6)
			const heart = 1 - sstep(0.5, 0.66, q + (pfbm(u, v, 4, 4, 72, 2) - 0.5) * 0.1)
			let c = lerp3(P.sap, P.heart, heart)
			c = lerp3(c, [c[0] * 0.74, c[1] * 0.72, c[2] * 0.7], late * P.ring)
			const rays = pn(ang / 6.2832 + 0.5, (q * 40) % 1, 90, 6, 73)
			const fib = 0.94 + 0.12 * pn(u, v, 260, 260, 74)
			let m = (0.96 + 0.08 * (rays - 0.5) * 2) * fib
			let h = 0.5 + (late - 0.5) * 0.08
			// radial checks
			let ck = 0
			for (const k of cracks) {
				let da = Math.abs(ang - k.a) % 6.2832
				if (da > 3.1416) da = 6.2832 - da
				const wd = k.w * (0.4 + q * 0.9)
				ck = Math.max(ck, (1 - sstep(wd * 0.3, wd, da)) * sstep(k.q0, k.q0 + 0.05, q) * (1 - sstep(k.q1, k.q1 + 0.05, q)))
			}
			m *= 1 - 0.7 * ck
			h -= 0.35 * ck
			const pith = 1 - sstep(0.012, 0.03, q)
			m *= 1 - 0.55 * pith
			c = [c[0] * m, c[1] * m, c[2] * m]
			// bark ring: a lighter reddish inner bark band, then the dark outer bark whose inner edge is jagged
			const jag = (pn(u, v, 60, 60, 78) - 0.5) * 0.02 + (pn(u, v, 14, 14, 79) - 0.5) * 0.014
			const rj = rho + jag
			const outer = sstep(0.896, 0.906, rj)
			const innerBark = sstep(0.852, 0.866, rj) * (1 - outer)
			if (innerBark > 0) {
				const ib = 0.85 + 0.3 * pn(u, v, 140, 140, 80)
				c = lerp3(c, [172 * ib, 116 * ib, 82 * ib], innerBark * 0.9)
				h = mix(h, 0.5, innerBark * 0.5)
			}
			if (outer > 0) {
				const bf = 0.72 + 0.55 * pn(u, v, 200, 200, 75) * (0.6 + 0.4 * pn(u, v, 30, 30, 76))
				const bc = [P.bark[1][0] * 1.15 * bf, P.bark[1][1] * 1.15 * bf, P.bark[1][2] * 1.15 * bf]
				c = lerp3(c, bc, outer)
				h = mix(h, 0.5 + (pn(u, v, 120, 120, 77) - 0.5) * 0.3, outer)
			}
			o.r = c[0]
			o.g = c[1]
			o.b = c[2]
			o.h = h
		}, { normal: 3, wrap: false })
	}
	function logGeometry(R, L, kind) {
		const NS = 180, NZ = Math.min(56, Math.max(10, Math.round(L / 0.0045))), NR = 10
		const maxDepth = Math.max(0.0015, Math.min(0.008, 0.075 * R))
		let bmax = 0
		for (let i = 0; i < 96; i++) for (let j = 0; j < 24; j++) bmax = Math.max(bmax, barkDepth(i / 96, j / 24))
		const rAt = (a01, z) => {
			const v = 0.5 + z / BARK_TZ
			// the vertices are far coarser than the thinnest fissures (the normal map carries those), so sample the depth over a short span along the length
			const dv = 0.4 * (L / NZ) / BARK_TZ
			const f = (vv) => barkDepth(a01 - Math.floor(a01), vv - Math.floor(vv))
			const dd = clamp01((0.5 * f(v) + 0.25 * (f(v - dv) + f(v + dv))) / bmax)
			const fade = 0.18 + 0.82 * sstep(0, 0.025, L / 2 - Math.abs(z))
			return R - maxDepth * (1 - dd) * fade
		}
		// the side
		const pos = [], uv = [], idx = []
		for (let j = 0; j <= NZ; j++) {
			const z = -L / 2 + (L * j) / NZ
			for (let i = 0; i <= NS; i++) {
				const t = i / NS, th = t * Math.PI * 2
				const r = rAt(i === NS ? 0 : t, z)
				pos.push(r * Math.cos(th), r * Math.sin(th), z)
				uv.push(t, 0.5 + z / BARK_TZ)
			}
		}
		for (let j = 0; j < NZ; j++) for (let i = 0; i < NS; i++) {
			const a = j * (NS + 1) + i, b = a + 1, c = a + NS + 1, e = c + 1
			idx.push(a, b, c, b, e, c)
		}
		const side = new THREE.BufferGeometry()
		side.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		side.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
		side.setIndex(idx)
		weldNormals(side)
		// the two ends
		const cap = (sgn) => {
			const p = [], t = [], ix = []
			for (let m = 0; m <= NR; m++) {
				const rho = m / NR
				for (let i = 0; i <= NS; i++) {
					const a01 = i / NS, th = a01 * Math.PI * 2
					const r = rAt(i === NS ? 0 : a01, (sgn * L) / 2) * rho
					const x = r * Math.cos(th), y = r * Math.sin(th)
					const dish = 0.0004 * fbm3(x * 90, y * 90, sgn * 3, 5, 3) + 0.0003 * Math.sin(y * 260 + 2 * fbm3(x * 20, y * 20, 1, 9, 2))
					p.push(x, y, sgn * (L / 2 - Math.max(0, dish)))
					t.push(0.5 + (sgn * 0.5 * x) / R, 0.5 + (0.5 * y) / R)
				}
			}
			for (let m = 0; m < NR; m++) for (let i = 0; i < NS; i++) {
				const a = m * (NS + 1) + i, b = a + NS + 1, c = a + 1, e = b + 1
				if (sgn > 0) ix.push(a, b, c, c, b, e)
				else ix.push(a, c, b, c, e, b)
			}
			const g = new THREE.BufferGeometry()
			g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3))
			g.setAttribute("uv", new THREE.Float32BufferAttribute(t, 2))
			g.setIndex(ix)
			weldNormals(g)
			return g
		}
		return [side, cap(1), cap(-1)]
	}
	function logModel({ r, solid, props }) {
		const lookName = solid.look
		const L = solid.length ?? props.length ?? 4 * r
		if (lookName === "cork") {
			const b = corkTex()
			const m = matOf("cork|log", b, { roughness: 0.92, normalScale: new THREE.Vector2(0.9, 0.9) })
			const g = new THREE.CylinderGeometry(r, r, L, 96, 1).rotateX(Math.PI / 2)
			const uv = g.attributes.uv, nr = g.attributes.normal
			for (let i = 0; i < uv.count; i++) {
				const cap = Math.abs(nr.getZ(i)) > 0.99
				uv.setXY(i, uv.getX(i) * (cap ? (2 * r) / CORK_T[0] : (2 * Math.PI * r) / CORK_T[0]), uv.getY(i) * (cap ? (2 * r) / CORK_T[1] : L / CORK_T[1]))
			}
			return kit.group(mesh(g, m))
		}
		const kind = logKind(lookName)
		const bark = barkTex(kind), end = logEndTex(kind)
		const tint = solid.color ?? "#ffffff"
		const barkMat = matOf(`bark3|${kind}|${tint}`, bark, { color: tint, roughness: 0.95, normalScale: new THREE.Vector2(1.5, 1.5) })
		const endMat = matOf(`log-end2|${kind}|${tint}`, end, { color: tint, roughness: 0.8, normalScale: new THREE.Vector2(0.8, 0.8) })
		const [side, capA, capB] = logGeometry(r, L, kind)
		return kit.group(mesh(side, barkMat), mesh(capA, endMat), mesh(capB, endMat))
	}
	addModel("wooden-log", "log", logModel)

	// ------------------------------------------------------------------------------------------ brick (and concrete)
	const CLAYS = {
		brick: { a: [148, 62, 44], b: [118, 48, 38], dark: [84, 36, 30], pale: [200, 168, 140], rough: 0.92, grain: 0.18 },
		concrete: { a: [172, 170, 164], b: [146, 144, 138], dark: [100, 98, 94], pale: [200, 198, 192], rough: 0.95, grain: 0.22 },
	}
	const BRICK_TILES = { stretcher: [0.23, 0.072, 768, 240], header: [0.115, 0.072, 384, 240], bed: [0.23, 0.115, 768, 384] }
	function clayTile(kind, face) {
		const P = CLAYS[kind]
		const [Tx, Ty, W, H] = BRICK_TILES[face]
		const seed = hstr(face) % 97
		const fx = (m) => Math.max(1, Math.round(Tx / m)), fy = (m) => Math.max(1, Math.round(Ty / m))
		const Wo = {}
		const mark = kind === "brick" && face === "bed" ? maskOf(W, H, (g) => {
			g.font = '900 54px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif'
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.fillText("SANDBOX", W / 2, H / 2 - 6, W * 0.34)
			g.font = '700 22px "Helvetica Neue", Arial, sans-serif'
			g.fillText("BRICK  WORKS", W / 2, H / 2 + 36, W * 0.34)
		}) : null
		return bake(`clay2|${kind}|${face}`, W, H, (u, v, o) => {
			const tone = pfbm(u, v, fx(0.06), fy(0.06), seed, 4)
			const tone2 = pfbm(u, v, fx(0.015), fy(0.015), seed + 5, 3)
			const grain = pn(u, v, fx(0.0012), fy(0.0012), seed + 9)
			const grain2 = pn(u, v, fx(0.0005), fy(0.0005), seed + 11)
			// a few real pits (a bubble or a pebble burnt out), not a dense pepper
			worley(u, v, fx(0.004), fy(0.004), seed + 13, Wo)
			const pit = Wo.id > 0.965 ? 1 - sstep(0.0, 0.42, Wo.f1) : 0
			// sand grains of the moulding sand: pale and dark specks about half a millimetre across
			const sandHi = sstep(0.86, 0.95, pn(u, v, fx(0.0005), fy(0.0005), seed + 51))
			const sandLo = sstep(0.86, 0.95, pn(u, v, fx(0.0005), fy(0.0005), seed + 52))
			const burn = sstep(0.5, 0.76, pfbm(u, v, fx(0.045), fy(0.045), seed + 21, 3))
			const flash = sstep(0.62, 0.8, pfbm(u, v, fx(0.09), fy(0.03), seed + 23, 3)) // drawn-out darker flashes
			const pale = sstep(0.9, 0.97, pn(u, v, fx(0.002), fy(0.002), seed + 31))
			const drag = face === "stretcher" ? 0 : pn(u, v, fx(0.12), fy(0.0016), seed + 41) - 0.5
			// kiss marks: where bricks touched in the kiln stack, a darker diagonal band in patches (periodic, so the tile still wraps)
			let kiss = 0
			if (face === "stretcher") {
				const q = (2 * u + v + 0.3 + 0.1 * (pfbm(u, v, 4, 2, seed + 61, 3) - 0.5)) % 1
				const band = 1 - sstep(0.04, 0.17, Math.abs(q - 0.5))
				kiss = band * sstep(0.38, 0.62, pfbm(u, v, 3, 2, seed + 62, 3))
			}
			let c = lerp3(P.a, P.b, clamp01(tone * 1.6 - 0.4 + tone2 * 0.3 - 0.1))
			c = lerp3(c, P.dark, Math.max(burn * 0.38, flash * 0.45, kiss * 0.5))
			c = lerp3(c, P.pale, pale * 0.3)
			const m = (0.9 + P.grain * (grain - 0.5) + 0.12 * (grain2 - 0.5)) * (1 - 0.5 * pit) * (1 + 0.16 * drag) * (1 + 0.18 * sandHi - 0.25 * sandLo)
			const mk = mark ? mark[o.iy * W + o.ix] : 0
			// the maker's name is pressed in raised relief: same clay colour, slightly smoother
			const k = 1 - 0.04 * mk
			o.r = c[0] * m * k
			o.g = c[1] * m * k
			o.b = c[2] * m * k
			o.h = 0.5 + (grain - 0.5) * 0.3 + (grain2 - 0.5) * 0.12 + (sandHi - sandLo) * 0.1 - pit * 0.5 + drag * 0.18 + 0.5 * mk - kiss * 0.05
		}, { normal: 4 })
	}
	function blockClay(kind) {
		return ({ w, h, d, solid }) => {
			const S = clayTile(kind, "stretcher"), Hd = clayTile(kind, "header"), B = clayTile(kind, "bed")
			const tint = solid.color ?? "#ffffff"
			const mk = (b, face) => matOf(`clay2|${kind}|${face}|${tint}`, b, { color: tint, roughness: CLAYS[kind].rough, normalScale: new THREE.Vector2(1.1, 1.1) })
			const tile = {
				pz: [0.23, 0.072], nz: [0.23, 0.072, 0.13, 0.2], px: [0.115, 0.072], nx: [0.115, 0.072, 0.3, 0.1], py: [0.23, 0.115], ny: [0.23, 0.115, 0.4, 0.3],
			}
			const half = [w / 2, h / 2, d / 2]
			// a pressed brick has a shallow pocket (the frog) in its upper bed: a flat floor inside sloped walls
			const frog = kind === "brick" && w > 0.1 && d > 0.07 && h > 0.04
			const fw = 0.3 * w, fd = 0.27 * d, fdepth = Math.min(0.0065, 0.12 * h)
			const disp = (x, y, z, nx, ny, nz) => {
				const m = [half[0] - Math.abs(x), half[1] - Math.abs(y), half[2] - Math.abs(z)].sort((a, b) => a - b)
				const e2 = Math.max(0, m[1])
				const chip = sstep(0.54, 0.72, fbm3(x * 190, y * 190, z * 190, 7, 2)) * (1 - sstep(0.0, 0.0048, e2)) * 0.0012
				const warp = (fbm3(x * 16, y * 16, z * 16, 3, 2) - 0.5) * 0.0007
				let pocket = 0
				if (frog && ny > 0.8) {
					const dx = Math.max(0, Math.abs(x) - fw), dz = Math.max(0, Math.abs(z) - fd)
					pocket = fdepth * (1 - sstep(0, 0.008, Math.hypot(dx, dz))) * sstep(0.8, 0.97, ny)
				}
				return warp - chip - pocket
			}
			const cell = frog ? 0.0027 : 0.004
			const seg = [Math.min(84, Math.max(2, Math.round(w / cell))), Math.min(30, Math.max(2, Math.round(h / 0.004))), Math.min(40, Math.max(2, Math.round(d / cell)))]
			const geo = softBox(w, h, d, Math.min(0.0016, 0.1 * Math.min(w, h, d)), { seg, k: 3, tile, disp })
			const mS = mk(S, "s"), mH = mk(Hd, "h"), mB = mk(B, "b")
			const proto = kit.group(mesh(geo, [mH, mH, mB, mB, mS, mS]))
			// every brick gets its own burn marks, kiss band and kiln tone: the side tiles are periodic, so they can be shifted and mirrored freely
			return perInstance(proto, (mesh, hsh) => {
				const vi = hsh % 12
				const ou = frac(vi, 1), ov = frac(vi, 2)
				const fx = frac(vi, 3) < 0.5, fy = frac(vi, 4) < 0.5
				const k = 0.93 + 0.14 * frac(vi, 5)
				const tint = [k * (0.97 + 0.06 * frac(vi, 6)), k, k * (0.97 + 0.06 * frac(vi, 7))]
				const key = `b${vi}`
				return [mH, mH, mB, mB, mS, mS].map((m, i) => (i === 2 || i === 3 ? variantOf(m, key, { tint }) : variantOf(m, key, { ou, ov, fx, fy, tint })))
			})
		}
	}

	// ------------------------------------------------------------------------------------------ foam
	function foamTile() {
		return bake("foam3", 1024, 512, (u, v, o) => {
			const Wa = {}, Wb = {}, Wc = {}
			worley(u, v, 128, 64, 17, Wa) // cells of about 1.6 mm
			worley(u, v, 180, 90, 19, Wb) // and smaller ones of 1.1 mm: the foam's cell size drifts from place to place
			worley(u, v, 330, 165, 29, Wc) // the cells behind them, seen through the holes
			const k = sstep(0.35, 0.65, pfbm(u, v, 4, 2, 7, 3))
			const e2 = mix(Wa.f2 - Wa.f1, Wb.f2 - Wb.f1, k), f1 = mix(Wa.f1, Wb.f1, k)
			const e1 = Wc.f2 - Wc.f1
			const cell = sstep(0.03, 0.22, e2) // 0 on a strut, 1 inside a cell (a hole you look into)
			const depth = cell * sstep(0.0, 0.55, f1) // deeper toward the middle of the hole
			const back = (1 - sstep(0.03, 0.12, e1)) * cell // struts of the cells behind, deep inside
			const web = [250, 222, 98]
			const hole = [112, 78, 16]
			let c = lerp3(web, hole, cell * (0.35 + 0.2 * Wa.id) + 0.5 * depth)
			c = lerp3(c, [web[0] * 0.55, web[1] * 0.55, web[2] * 0.5], back * 0.55 * depth)
			const m = (0.97 + 0.1 * (pfbm(u, v, 3, 2, 7, 3) - 0.5)) * (0.96 + 0.08 * Wc.id)
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = 1 - cell * (0.45 + 0.5 * sstep(0.0, 0.6, f1)) + back * 0.15 * depth
		}, { normal: 4.5 })
	}
	const FOAM_T = [0.2, 0.1]
	function blockFoam({ w, h, d, solid }) {
		const b = foamTile()
		const tint = solid.color ?? "#ffffff"
		const m = matOf(`foam3|${tint}`, b, { color: tint, roughness: 0.96, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color("#fff0a0"), normalScale: new THREE.Vector2(1.4, 1.4) })
		// cut foam: slow undulation, and a ragged edge where the knife met the cell walls
		const half = [w / 2, h / 2, d / 2]
		const disp = (x, y, z) => {
			const m3 = [half[0] - Math.abs(x), half[1] - Math.abs(y), half[2] - Math.abs(z)].sort((a, c) => a - c)
			const edge = 1 - sstep(0.0, 0.004, Math.max(0, m3[1]))
			const bites = sstep(0.42, 0.72, fbm3(x * 330, y * 330, z * 330, 21, 2))
			return -(fbm3(x * 14, y * 14, z * 14, 11, 2)) * 0.0011 - 0.0007 * edge * bites - 0.0002 * fbm3(x * 160, y * 160, z * 160, 23, 2)
		}
		const seg = [Math.min(64, Math.max(2, Math.round(w / 0.004))), Math.min(40, Math.max(2, Math.round(h / 0.004))), Math.min(40, Math.max(2, Math.round(d / 0.004)))]
		const geo = softBox(w, h, d, Math.min(0.0024, 0.12 * Math.min(w, h, d)), { seg, k: 4, tile: sixTiles(FOAM_T, FOAM_T), disp })
		return kit.group(mesh(geo, m))
	}

	// ------------------------------------------------------------------------------------------ steel (machined, chamfered)
	function steelTile() {
		return bake("steel-brushed2", 768, 768, (u, v, o) => {
			const streak = pn(u, v, 6, 900, 3) - 0.5
			const streak2 = pn(u, v, 24, 380, 5) - 0.5
			const scr = sstep(0.95, 0.995, pn(u, v, 9, 1000, 7))
			const mott = pfbm(u, v, 2, 2, 9, 3)
			const m = clamp01(0.9 + 0.05 * (streak * 0.7 + streak2 * 0.5) * 2 + 0.05 * (mott - 0.5) + 0.12 * scr)
			o.r = o.g = o.b = 255 * m
			o.h = 0.5 + streak * 0.3 + streak2 * 0.15 - scr * 0.25
			o.rough = clamp01(0.16 + 0.05 * (streak2 * 2 * 0.6 + streak * 2 * 0.4) + 0.04 * (0.5 - mott) - 0.06 * scr)
		}, { normal: 2, rough: true })
	}
	/** The machined steel face material (brushed, anisotropic highlight, warm table reflection). */
	function steelFace() {
		return matOf("steel-face2", steelTile(), { color: "#b9bdc3", metalness: 1, roughness: 1, anisotropy: 0.6, envMapIntensity: 0.9, normalScale: new THREE.Vector2(0.5, 0.5) }, true)
	}
	const STEEL_T = [0.1, 0.1]
	/** A box with all twelve edges chamfered by c: six squares (groups 0..5: +x -x +y -y +z -z), then the chamfers and corner triangles (group 6). Flat shaded. */
	function chamferBox(w, h, d, c, tile = {}) {
		const hh = [w / 2, h / 2, d / 2], ii = hh.map((v) => v - c)
		const pos = [], nor = [], uvs = [], idx = [], groups = [[0, 0]]
		const polys = []
		for (let a = 0; a < 3; a++) {
			for (const s of [1, -1]) {
				const b = (a + 1) % 3, cc = (a + 2) % 3
				const verts = []
				for (const [sb, sc] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
					const p = [0, 0, 0]
					p[a] = s * hh[a]
					p[b] = sb * ii[b]
					p[cc] = sc * ii[cc]
					verts.push(p)
				}
				polys.push({ verts, group: a * 2 + (s > 0 ? 0 : 1), face: ["px", "nx", "py", "ny", "pz", "nz"][a * 2 + (s > 0 ? 0 : 1)] })
			}
		}
		for (let a = 0; a < 3; a++) {
			const b = (a + 1) % 3, cc = (a + 2) % 3
			for (const sa of [1, -1]) for (const sb of [1, -1]) {
				const verts = []
				for (const sc of [-1, 1]) {
					const p = [0, 0, 0], q = [0, 0, 0]
					p[a] = sa * hh[a]; p[b] = sb * ii[b]; p[cc] = sc * ii[cc]
					q[a] = sa * ii[a]; q[b] = sb * hh[b]; q[cc] = sc * ii[cc]
					verts.push(p, q)
				}
				polys.push({ verts: [verts[0], verts[1], verts[3], verts[2]], group: 6 })
			}
		}
		for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
			polys.push({ verts: [[sx * hh[0], sy * ii[1], sz * ii[2]], [sx * ii[0], sy * hh[1], sz * ii[2]], [sx * ii[0], sy * ii[1], sz * hh[2]]], group: 6 })
		}
		const byGroup = [[], [], [], [], [], [], []]
		for (const p of polys) byGroup[p.group].push(p)
		let base = 0
		for (let gi = 0; gi < 7; gi++) {
			const start = idx.length
			for (const pl of byGroup[gi]) {
				let vs = pl.verts
				const cen = [0, 1, 2].map((q) => vs.reduce((s, v) => s + v[q], 0) / vs.length)
				const e1 = [0, 1, 2].map((q) => vs[1][q] - vs[0][q]), e2 = [0, 1, 2].map((q) => vs[2][q] - vs[0][q])
				let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
				if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0) {
					vs = vs.slice().reverse()
					n = n.map((x) => -x)
				}
				const nl = Math.hypot(...n) || 1
				n = n.map((x) => x / nl)
				for (const v of vs) {
					pos.push(...v)
					nor.push(...n)
					// uv: look along the dominant axis; faces use their own tile
					const ax = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2
					const T = (pl.face && tile[pl.face]) || [0.1, 0.1]
					const [a2, b2] = ax === 0 ? [-v[2] * Math.sign(n[0]), v[1]] : ax === 1 ? [v[0], -v[2] * Math.sign(n[1])] : [v[0] * Math.sign(n[2]), v[1]]
					uvs.push(0.5 + a2 / T[0] + (T[2] ?? 0), 0.5 + b2 / T[1] + (T[3] ?? 0))
				}
				for (let t = 1; t < vs.length - 1; t++) idx.push(base, base + t, base + t + 1)
				base += vs.length
			}
			groups[gi] = [start, idx.length - start]
		}
		const g = new THREE.BufferGeometry()
		g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3))
		g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
		g.setIndex(idx)
		groups.forEach(([s, n], i) => g.addGroup(s, n, i))
		g.computeBoundingSphere()
		return g
	}
	/** Box-blur a Float32Array W*H mask (separable, radius r, repeated n times). */
	function blurMask(m, W, H, r, n = 2) {
		let a = m, b = new Float32Array(m.length)
		for (let pass = 0; pass < n; pass++) {
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				let t = 0
				for (let k = -r; k <= r; k++) t += a[y * W + Math.max(0, Math.min(W - 1, x + k))]
				b[y * W + x] = t / (2 * r + 1)
			}
			const c = new Float32Array(m.length)
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				let t = 0
				for (let k = -r; k <= r; k++) t += b[Math.max(0, Math.min(H - 1, y + k)) * W + x]
				c[y * W + x] = t / (2 * r + 1)
			}
			a = c
		}
		return a
	}
	/**
	 * A stamped (engraved) mark: a decal whose normal and roughness maps are cut from the letters, so it shades with the metal: sloped
	 * walls catch the light, the floor of each letter is a little rougher. Same steel colour as the face, no ink.
	 */
	function stamp(lines, wPlane, hPlane, key) {
		const W = 512, H = Math.max(32, Math.round(512 * (hPlane / wPlane)))
		const mask = maskOf(W, H, (g) => {
			g.textAlign = "center"
			g.textBaseline = "middle"
			const total = lines.reduce((s2, l) => s2 + l.size * 1.15, 0)
			let y = (H - total) / 2
			for (const l of lines) {
				g.font = `${l.weight ?? 800} ${l.size}px "Helvetica Neue", Arial, sans-serif`
				if ("letterSpacing" in g) g.letterSpacing = `${l.spacing ?? 0}px`
				g.fillText(l.text, W / 2, y + l.size * 0.575, W * 0.94)
				y += l.size * 1.15
			}
		})
		const bl = blurMask(mask, W, H, 2, 2)
		const mk = (name, fill, data = true) => kit.tex(`blocks|stamp2|${key}|${name}`, W, H, (g) => {
			const img = new ImageData(W, H)
			fill(img.data)
			g.putImageData(img, 0, 0)
		}, { data, wrap: false })
		const alphaMap = mk("a", (d) => {
			for (let i = 0; i < W * H; i++) {
				const a = Math.min(1, bl[i] * 6) * 255 // the blurred mask reaches a little past the letter: that rim is the sloped wall
				d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = a
				d[i * 4 + 3] = 255
			}
		})
		const roughMap = mk("r", (d) => {
			for (let i = 0; i < W * H; i++) {
				d[i * 4 + 1] = 255 * (0.16 + 0.42 * sstep(0.6, 0.95, bl[i]))
				d[i * 4 + 3] = 255
			}
		})
		const normalMap = mk("n", (d) => {
			const S = 3.2
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const hx = (-bl[y * W + Math.min(W - 1, x + 1)] + bl[y * W + Math.max(0, x - 1)]) * 0.5 * S
				const hy = (-bl[Math.min(H - 1, y + 1) * W + x] + bl[Math.max(0, y - 1) * W + x]) * 0.5 * S
				// height = -blurred (cut in); canvas y points down, texture v up
				const gx = hx, gy = -hy
				const len = Math.hypot(gx, gy, 1)
				const i = (y * W + x) * 4
				d[i] = (-gx / len * 0.5 + 0.5) * 255
				d[i + 1] = (-gy / len * 0.5 + 0.5) * 255
				d[i + 2] = (1 / len * 0.5 + 0.5) * 255
				d[i + 3] = 255
			}
		})
		const decal = M(`stamp2|${key}`, {
			color: "#b9bdc3", metalness: 1, roughness: 1, roughnessMap: roughMap, normalMap, normalScale: new THREE.Vector2(1, 1), anisotropy: 0.3, envMapIntensity: 0.9,
			alphaMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
		}, true)
		const plane = kit.geo(`blocks|plane|${wPlane.toFixed(5)}|${hPlane.toFixed(5)}`, () => new THREE.PlaneGeometry(wPlane, hPlane))
		const m1 = new THREE.Mesh(plane, decal)
		m1.castShadow = false
		m1.receiveShadow = false
		const grp = new THREE.Group()
		grp.add(m1)
		return grp
	}
	function steelWeight({ w, h, d, props }) {
		const kg = props.mass ?? 1
		const label = `${Number(kg.toFixed(2))} kg`
		const face = steelFace()
		const edge = M("steel-chamfer2", { color: "#dfe2e7", metalness: 1, roughness: 0.14, envMapIntensity: 1.0 }, true)
		const c = Math.min(0.0014, 0.04 * Math.min(w, h, d))
		const tile = {
			px: [...STEEL_T, 0.1, 0.2], nx: [...STEEL_T, 0.4, 0.6], py: [...STEEL_T, 0.3, 0.1], ny: [...STEEL_T, 0.7, 0.3], pz: [...STEEL_T, 0.2, 0.2], nz: [...STEEL_T, 0.5, 0.1],
		}
		const geo = chamferBox(w, h, d, c, tile)
		const body = mesh(geo, [face, face, face, face, face, face, edge])
		const lw = 0.36 * Math.min(w, h), lh = lw * 0.5
		const lines = [{ text: label, size: 190, spacing: 3 }, { text: "M1", size: 66, weight: 700, spacing: 8 }]
		const front = stamp(lines, lw, lh, `${label}`)
		front.position.set(0, 0, d / 2 + 0.00004)
		const back = front.clone()
		back.position.set(0, 0, -d / 2 - 0.00004)
		back.rotation.y = Math.PI
		const top = front.clone()
		top.position.set(0, h / 2 + 0.00004, 0)
		top.rotation.x = -Math.PI / 2
		return kit.group(body, front, back, top)
	}
	addModel("steel-weight-1kg", "weight", steelWeight)
	addModel("steel-weight-5kg", "weight", steelWeight)

	// ------------------------------------------------------------------------------------------ ice cube (and glass)
	function frostTex() {
		return bake("ice-frost", 256, 256, (u, v, o) => {
			const e = Math.min(u, 1 - u, v, 1 - v)
			const edge = 1 - sstep(0.0, 0.16, e + (pfbm(u, v, 5, 5, 5, 3) - 0.5) * 0.14)
			const patch = sstep(0.6, 0.85, pfbm(u, v, 3, 3, 7, 3)) * 0.4
			const fine = pfbm(u, v, 24, 24, 3, 2)
			const mask = clamp01(Math.max(edge * 0.55, patch) * (0.8 + 0.4 * fine))
			o.r = o.g = o.b = 255 * mask
			o.rough = 0.03 + 0.7 * mask
		}, { rough: true, wrap: false })
	}
	function cloudTex() {
		return bake("ice-cloud", 256, 128, (u, v, o) => {
			const f = pfbm(u, v, 5, 3, 9, 4)
			o.r = o.g = o.b = 255
			o.rough = 0.03 + 0.8 * sstep(0.3, 0.7, f)
		}, { rough: true })
	}
	/** Alpha ramp for a fracture sheet, indexed by "rim" (0 at the middle, 1 on the polygon's edge): a faint body and a thin bright edge. */
	function crackRamp() {
		return kit.tex("blocks|ice-crack-ramp", 256, 4, (g, W, H) => {
			const img = new ImageData(W, H)
			for (let x = 0; x < W; x++) {
				const t = x / (W - 1)
				const a = 0.07 + 0.03 * Math.sin(t * 22) * Math.sin(t * 22) * (1 - t) + 0.42 * Math.pow(sstep(0.8, 1.0, t), 1.6)
				for (let y = 0; y < H; y++) {
					const i = (y * W + x) * 4
					img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, a * 255)
					img.data[i + 3] = 255
				}
			}
			g.putImageData(img, 0, 0)
		}, { data: true, wrap: false })
	}
	/** A flat sheet through the cube: a fan over a polygon whose corners are given as fractions of the cube (-0.5..0.5); uv.x = 0 in the middle, 1 on the edge. */
	function sheetGeo(pts, w, h, d, key) {
		return kit.geo(`blocks|icesheet|${key}|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`, () => {
			const c = [0, 0, 0]
			for (const p of pts) for (let i = 0; i < 3; i++) c[i] += p[i] / pts.length
			const pos = [c[0] * w, c[1] * h, c[2] * d], uv = [0, 0.5]
			for (const p of pts) {
				pos.push(p[0] * w, p[1] * h, p[2] * d)
				uv.push(1, 0.5)
			}
			const idx = []
			for (let i = 0; i < pts.length; i++) idx.push(0, 1 + i, 1 + ((i + 1) % pts.length))
			const g = new THREE.BufferGeometry()
			g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
			g.setIndex(idx)
			g.computeVertexNormals()
			return g
		})
	}
	const FADE_EDGE = "{ float vn = abs(dot(normalize(normal), normalize(vViewPosition))); diffuseColor.a *= pow(vn, 1.0); }"
	const FADE_FLASH = "{ float vn = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition))); diffuseColor.a *= 0.16 + 0.84 * pow(vn, 1.7); }"
	const FADE_RIM = "{ float vn = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition))); diffuseColor.a *= 0.15 + 0.85 * pow(vn, 1.3); }"
	function blockIce({ w, h, d, solid }) {
		const glass = solid.look === "glass"
		const r = Math.min(0.0022, 0.11 * Math.min(w, h, d))
		const F = frostTex()
		const shellGeo = softBox(w, h, d, r, { seg: [3, 3, 3], k: 4, disp: (x, y, z) => (fbm3(x * 60, y * 60, z * 60, 4, 2) - 0.5) * 0.0005 })
		const shell = M(`ice-shell2|${glass}`, glass
			? { color: new THREE.Color("#ffffff"), roughness: 0.02, metalness: 0, transmission: 1, thickness: 0.02, ior: 1.5, attenuationColor: new THREE.Color("#cfeee6"), attenuationDistance: 0.12, envMapIntensity: 0.9 }
			: { color: new THREE.Color("#ffffff"), roughness: 1, roughnessMap: F.roughMap, metalness: 0, transmission: 1, thickness: 0.03, ior: 1.31, attenuationColor: new THREE.Color("#a9d6f0"), attenuationDistance: 0.25, envMapIntensity: 0.9 }, true)
		shell.depthWrite = false // so the translucent cloud and fractures inside still draw over it
		const parts = [kit.mesh(shellGeo, shell, { cast: false })]
		if (!glass) {
			const s = Math.min(w, h, d)
			const sc = s / 0.04
			// frost: a white skin just under the surface, thicker toward the edges and in patches (hashed transparency)
			const frostGeo = softBox(w + 0.0002, h + 0.0002, d + 0.0002, r + 0.0001, { seg: [1, 1, 1], k: 4 })
			const frost = M("ice-frost", { color: new THREE.Color("#f4faff"), emissive: new THREE.Color("#d9ecf8"), emissiveIntensity: 0.3, roughness: 0.9, metalness: 0, alphaMap: F.roughMap, transparent: true, opacity: 0.6, depthWrite: false })
			const frostMesh = kit.mesh(frostGeo, frost, { cast: false })
			frostMesh.renderOrder = 4
			parts.push(frostMesh)
			// the body is a little milky all through
			const milk = M("ice-milk", { color: new THREE.Color("#e6f3fc"), emissive: new THREE.Color("#cfe6fa"), emissiveIntensity: 0.3, roughness: 1, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false })
			const milkMesh = kit.mesh(softBox(w - 0.0016, h - 0.0016, d - 0.0016, Math.max(0.0004, r - 0.0008), { seg: [1, 1, 1], k: 3 }), milk, { cast: false })
			milkMesh.renderOrder = 0
			parts.push(milkMesh)
			// the cloudy core of a cube frozen from the outside in: a soft feathery haze, low in the middle, never nearer than about 6 mm to a face
			const cl = cloudTex()
			const coreMat = M("ice-core2", { color: new THREE.Color("#f6fbff"), roughness: 0.9, metalness: 0, alphaMap: cl.roughMap, transparent: true, opacity: 0.85, depthWrite: false }, false, FADE_EDGE)
			const blobs = [[0, 0, 0, 0.17], [0.1, -0.03, 0.05, 0.12], [-0.1, 0.02, -0.05, 0.12], [0.02, 0.08, -0.09, 0.1], [-0.03, -0.07, 0.1, 0.11]]
			const coreGeoOf = (f, key) => kit.geo(`blocks|icecore2|${key}|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`, () => {
				const list = []
				blobs.forEach(([bx, by, bz, br], bi) => {
					const g = new THREE.SphereGeometry(br * f * s, 24, 16)
					const p = g.attributes.position
					for (let i = 0; i < p.count; i++) {
						const k = 1 + 0.45 * (fbm3(p.getX(i) * 150 + bi * 7, p.getY(i) * 150, p.getZ(i) * 150, 8, 2) - 0.5)
						p.setXYZ(i, p.getX(i) * k + bx * f * s, p.getY(i) * k * 0.8 + by * f * s - 0.12 * h, p.getZ(i) * k + bz * f * s)
					}
					list.push(g)
				})
				const g = mergeGeometries(list, false)
				g.computeVertexNormals()
				return g
			})
			const coreGeo = coreGeoOf(1, "a")
			const halo = kit.mesh(coreGeoOf(1.3, "b"), M("ice-halo", { color: new THREE.Color("#f2f8ff"), roughness: 0.9, metalness: 0, alphaMap: cl.roughMap, transparent: true, opacity: 0.3, depthWrite: false }, false, FADE_EDGE), { cast: false })
			halo.renderOrder = 1
			parts.push(halo)
			const core = kit.mesh(coreGeo, coreMat, { cast: false })
			core.renderOrder = 1
			parts.push(core)
			// tiny bubbles trapped in the cloud, each with a dark rim and a bright glint
			const bubbleSpec = []
			for (let i = 0; i < 22; i++) {
				const a = h3(i, 1, 33) * Math.PI * 2, rad = Math.pow(h3(i, 2, 33), 0.6)
				bubbleSpec.push([
					Math.cos(a) * rad * 0.2 * s, (h3(i, 3, 33) - 0.5) * 0.18 * s - 0.12 * h, Math.sin(a) * rad * 0.2 * s,
					(0.00015 + 0.00045 * Math.pow(h3(i, 4, 33), 2)) * sc,
				])
			}
			const bubbleGeo = (scaleR, key) => kit.geo(`blocks|icebubbles2|${key}|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`, () => {
				const list = bubbleSpec.map(([x, y, z, br]) => new THREE.SphereGeometry(br * scaleR, 10, 8).translate(x, y, z))
				return mergeGeometries(list, false)
			})
			parts.push(kit.mesh(bubbleGeo(0.75, "in"), M("ice-bubble2", { color: new THREE.Color("#f4faff"), roughness: 0.05, metalness: 0, envMapIntensity: 2 }), { cast: false }))
			const rim = kit.mesh(bubbleGeo(1.25, "out"), M("ice-bubble-rim", { color: new THREE.Color("#5f6f7a"), roughness: 0.4, metalness: 0, transparent: true, opacity: 0.8, depthWrite: false }, false, FADE_RIM), { cast: false })
			rim.renderOrder = 3
			parts.push(rim)
			// fractures: thin straight-edged sheets that flash at glancing angles, one running up from the core to the top, one low and flat out to the front
			const cm = M("ice-crack2", { color: new THREE.Color("#ffffff"), roughness: 0.05, metalness: 0, alphaMap: crackRamp(), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 3 }, true, FADE_FLASH)
			const sheets = [
				[[0.06, -0.3, -0.22], [0.08, -0.2, -0.02], [0.1, -0.12, 0.28], [0.13, 0.02, 0.33], [0.14, 0.15, 0.27], [0.12, 0.47, 0.2], [0.07, 0.47, -0.06], [0.05, 0.47, -0.2], [0.03, 0.3, -0.25], [0.02, 0.2, -0.3]],
				[[-0.4, -0.2, -0.1], [-0.33, -0.19, 0.12], [-0.25, -0.17, 0.3], [-0.1, -0.2, 0.41], [0.05, -0.22, 0.47], [0.2, -0.2, 0.36], [0.35, -0.19, 0.42], [0.46, -0.22, 0.2], [0.45, -0.24, 0.0], [0.3, -0.25, -0.2], [0.2, -0.26, -0.3], [0.0, -0.24, -0.2], [-0.2, -0.25, -0.35]],
			]
			sheets.forEach((pts, i) => {
				const m = kit.mesh(sheetGeo(pts, w, h, d, `s${i}`), cm, { cast: false })
				m.renderOrder = 2
				parts.push(m)
			})
		}
		return kit.group(...parts)
	}

	// ------------------------------------------------------------------------------------------ cardboard box
	const INK = [38, 30, 24]
	const FONT_HEAVY = '900 150px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif'
	const sans = (wt, px) => `${wt} ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`
	function upArrow(g, cx, top, w, h) {
		const head = h * 0.42
		g.beginPath()
		g.moveTo(cx, top)
		g.lineTo(cx + w / 2, top + head)
		g.lineTo(cx + w * 0.2, top + head)
		g.lineTo(cx + w * 0.2, top + h)
		g.lineTo(cx - w * 0.2, top + h)
		g.lineTo(cx - w * 0.2, top + head)
		g.lineTo(cx - w / 2, top + head)
		g.closePath()
		g.fill()
	}
	function wineGlass(g, cx, cy, s) {
		g.lineWidth = s * 0.06
		g.lineJoin = "round"
		g.beginPath()
		g.moveTo(cx - s * 0.3, cy - s * 0.42)
		g.lineTo(cx + s * 0.3, cy - s * 0.42)
		g.quadraticCurveTo(cx + s * 0.34, cy + s * 0.05, cx, cy + s * 0.12)
		g.quadraticCurveTo(cx - s * 0.34, cy + s * 0.05, cx - s * 0.3, cy - s * 0.42)
		g.stroke()
		g.beginPath()
		g.moveTo(cx, cy + s * 0.12)
		g.lineTo(cx, cy + s * 0.38)
		g.moveTo(cx - s * 0.18, cy + s * 0.4)
		g.lineTo(cx + s * 0.18, cy + s * 0.4)
		g.stroke()
		// the crack
		g.beginPath()
		g.moveTo(cx - s * 0.12, cy - s * 0.42)
		g.lineTo(cx - s * 0.02, cy - s * 0.2)
		g.lineTo(cx - s * 0.1, cy - s * 0.1)
		g.lineTo(cx + s * 0.04, cy + 0.05 * s)
		g.stroke()
	}
	function sidePrint(g, W, H) {
		g.textBaseline = "alphabetic"
		g.textAlign = "left"
		g.font = FONT_HEAVY
		g.fillText("SANDBOX", 58, 196, 500)
		g.font = sans(700, 40)
		if ("letterSpacing" in g) g.letterSpacing = "13px"
		g.fillText("PACKING CO.", 62, 250)
		if ("letterSpacing" in g) g.letterSpacing = "0px"
		g.fillRect(60, 276, 480, 7)
		// this side up
		upArrow(g, 96, 372, 62, 170)
		upArrow(g, 186, 372, 62, 170)
		g.font = sans(900, 52)
		g.fillText("THIS SIDE", 250, 438)
		g.fillText("UP", 250, 498)
		// fragile
		g.strokeStyle = "#fff"
		g.lineWidth = 6
		g.strokeRect(690, 54, 160, 160)
		wineGlass(g, 770, 128, 120)
		g.font = sans(900, 34)
		g.textAlign = "center"
		g.fillText("FRAGILE", 770, 250)
		// box maker's stamp
		g.beginPath()
		g.arc(760, 458, 76, 0, Math.PI * 2)
		g.lineWidth = 6
		g.stroke()
		g.beginPath()
		g.arc(760, 458, 58, 0, Math.PI * 2)
		g.lineWidth = 2.5
		g.stroke()
		g.font = sans(800, 20)
		g.fillText("BOX MAKER", 760, 440)
		g.font = sans(900, 30)
		g.fillText("32 ECT", 760, 470)
		g.font = sans(800, 15)
		g.fillText("RECYCLED", 760, 492)
		g.textAlign = "left"
		g.font = sans(600, 26)
		g.fillText("30 x 20 x 20 CM  -  MAX 15 KG", 60, 572)
	}
	function endPrint(g, W, H) {
		g.textAlign = "center"
		g.textBaseline = "alphabetic"
		upArrow(g, W / 2, 250, 130, 190)
		g.font = sans(900, 74)
		g.fillText("THIS WAY UP", W / 2, 500)
		g.font = sans(700, 34)
		if ("letterSpacing" in g) g.letterSpacing = "9px"
		g.fillText("SANDBOX", W / 2, 556)
		if ("letterSpacing" in g) g.letterSpacing = "0px"
	}
	/** Kraft liner with flutes running along v (ripples across u), the printed ink mask laid over it. */
	function kraftTile(name, Tx, Ty, W, H, print, seed, dw = 900, dh = 600) {
		const mask = print ? maskOf(W, H, (g) => { g.save(); g.scale(W / dw, H / dh); print(g, dw, dh); g.restore() }) : null
		const fx = (m) => Math.max(1, Math.round(Tx / m)), fy = (m) => Math.max(1, Math.round(Ty / m))
		const nFl = Math.round(Tx / 0.0065)
		return bake(`kraft|${name}`, W, H, (u, v, o) => {
			const mott = pfbm(u, v, fx(0.07), fy(0.07), seed, 4)
			const fibre = pn(u, v, fx(0.0022), fy(0.0009), seed + 3)
			const fibre2 = pn(u, v, fx(0.0006), fy(0.0014), seed + 5)
			const fleck = sstep(0.88, 0.96, pn(u, v, fx(0.0012), fy(0.0012), seed + 7))
			const rip = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * nFl + (pn(u, v, 3, 2, seed + 9) - 0.5) * 2)
			let m = 0.9 + 0.14 * (mott - 0.5) * 2 * 0.5 + 0.1 * (fibre - 0.5) + 0.07 * (fibre2 - 0.5) + 0.03 * (rip - 0.5)
			let c = lerp3([186, 142, 94], [170, 128, 82], clamp01(mott * 1.3 - 0.2))
			c = lerp3(c, [112, 80, 52], fleck * 0.5)
			if (mask) {
				const ink = mask[o.iy * W + o.ix] * (0.86 + 0.14 * pn(u, v, fx(0.0014), fy(0.0014), seed + 11))
				if (ink > 0) c = lerp3(c, INK, clamp01(ink) * 0.93)
			}
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = 0.5 + 0.18 * (rip - 0.5) + 0.12 * (fibre - 0.5) + 0.06 * (fibre2 - 0.5)
		}, { normal: 3, wrap: false })
	}
	/** Packing-tape detail along its path (u, 0.512 m) and width (v, 0.064 m): lengthwise wrinkles and a few cross creases; roughMap carries its alpha. */
	function tapeTex() {
		return bake("tape-detail", 1024, 128, (u, v, o) => {
			const wr = pn(u, v, 4, 70, 3) - 0.5
			const wr2 = pn(u, v, 12, 28, 5) - 0.5
			let crease = 0
			for (const [cu, tilt] of [[0.18, 0.04], [0.43, -0.03], [0.77, 0.05]]) {
				const wob = (pn(u, v, 2, 8, 7) - 0.5) * 0.01
				const du = Math.abs(u - (cu + tilt * (v - 0.5) + wob))
				crease = Math.max(crease, 1 - sstep(0.0, 0.003, du))
			}
			o.r = o.g = o.b = 255 * clamp01(0.96 + 0.06 * wr2 + 0.1 * crease)
			o.h = 0.5 + 0.22 * wr + 0.14 * wr2 + 0.5 * crease
			o.rough = clamp01(0.88 + 0.14 * crease + 0.05 * wr2) // alpha: a creased tape scatters a little more light
		}, { normal: 3, rough: true })
	}
	function cardboardBox({ w, h, d, solid }) {
		const side = kraftTile("side", 0.3, 0.2, 720, 480, sidePrint, 1, 900, 600)
		const end = kraftTile("end", 0.2, 0.2, 480, 480, endPrint, 2, 600, 600)
		const top = kraftTile("top", 0.3, 0.2, 720, 480, null, 3)
		const tint = solid.color ?? "#ffffff"
		const mk = (b, n) => matOf(`kraft|${n}|${tint}`, b, { color: tint, roughness: 0.94, normalScale: new THREE.Vector2(0.9, 0.9) })
		const mS = mk(side, "s"), mE = mk(end, "e"), mT = mk(top, "t")
		const half = [w / 2, h / 2, d / 2]
		// panels sag a little between the folded edges
		const disp = (x, y, z, nx, ny, nz) => {
			const win = (p, hf) => Math.max(0, 1 - (p / hf) * (p / hf))
			let dent = 0
			const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
			if (ax > 0.5) dent = Math.max(dent, sstep(0.5, 0.95, ax) * win(y, half[1]) * win(z, half[2]))
			if (ay > 0.5) dent = Math.max(dent, sstep(0.5, 0.95, ay) * win(x, half[0]) * win(z, half[2]))
			if (az > 0.5) dent = Math.max(dent, sstep(0.5, 0.95, az) * win(x, half[0]) * win(y, half[1]))
			return -0.0009 * dent + (fbm3(x * 25, y * 25, z * 25, 3, 2) - 0.5) * 0.0004
		}
		const seg = [Math.min(24, Math.max(2, Math.round(w / 0.012))), Math.min(18, Math.max(2, Math.round(h / 0.012))), Math.min(18, Math.max(2, Math.round(d / 0.012)))]
		const tile = { pz: [0.3, 0.2], nz: [0.3, 0.2], px: [0.2, 0.2], nx: [0.2, 0.2], py: [0.3, 0.2], ny: [0.3, 0.2] }
		const geo = softBox(w, h, d, Math.min(0.0026, 0.1 * Math.min(w, h, d)), { seg, k: 4, tile, disp })
		const parts = [mesh(geo, [mE, mE, mT, mT, mS, mS])]
		// the major flaps meet along the middle of the top (a dark 1.5 mm line, seen through the tape), and each end shows the minor flap's edge a little below the fold
		const rr = Math.min(0.0026, 0.1 * Math.min(w, h, d))
		const hx = w / 2, hy = h / 2
		const seamMat = M("box-seam", { color: new THREE.Color("#3a2a1c"), roughness: 1, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
		const seamTop = new THREE.Mesh(kit.geo(`blocks|seamtop|${w.toFixed(4)}`, () => new THREE.PlaneGeometry(w - 2 * rr, 0.0015).rotateX(-Math.PI / 2)), seamMat)
		seamTop.position.set(0, hy + 0.00004, 0)
		parts.push(seamTop)
		const flapGeo = kit.geo(`blocks|flapline|${d.toFixed(4)}`, () => new THREE.PlaneGeometry(d - 2 * rr, 0.0012))
		for (const sx of [1, -1]) {
			const m = new THREE.Mesh(flapGeo, seamMat)
			m.position.set(sx * (hx + 0.00004), hy - 0.0035, 0)
			m.rotation.y = sx * Math.PI / 2
			parts.push(m)
		}
		// packing tape along the seam of the top flaps, wrapping down both ends: a glossy amber ribbon that the kraft shows through,
		// with fine lengthwise wrinkles, a few cross creases and serrated cut ends
		const t = 0.0003, drop = Math.min(0.07, 0.4 * h), tw = Math.min(0.048, 0.5 * d)
		const tapeGeo = kit.geo(`blocks|tape2|${w.toFixed(4)}|${h.toFixed(4)}|${tw.toFixed(4)}`, () => {
			const path = [[-hx - t, hy - drop], [-hx - t, hy - rr]]
			const R = rr + t
			for (let i = 1; i <= 4; i++) {
				const a = Math.PI - (i / 4) * Math.PI / 2
				path.push([-hx + rr + R * Math.cos(a), hy - rr + R * Math.sin(a)])
			}
			for (let i = 0; i <= 4; i++) {
				const a = Math.PI / 2 - (i / 4) * Math.PI / 2
				path.push([hx - rr + R * Math.cos(a), hy - rr + R * Math.sin(a)])
			}
			path.push([hx + t, hy - drop])
			const NZ = Math.max(8, Math.round(tw / 0.001))
			const pos = [], uv = [], idx = []
			let sacc = 0
			path.forEach((pt, i) => {
				if (i) sacc += Math.hypot(pt[0] - path[i - 1][0], pt[1] - path[i - 1][1])
				const end = i === 0 || i === path.length - 1
				for (let j = 0; j <= NZ; j++) {
					const z = -tw / 2 + (tw * j) / NZ
					// a serrated cut: teeth about 3.5 mm apart and 2 mm deep, each a little uneven
					const ph = (z / 0.0035) % 1, k = Math.floor(z / 0.0035)
					const tooth = end ? 0.002 * (1 - Math.abs(2 * ((ph + 1) % 1) - 1)) * (0.7 + 0.3 * h3(k, 5, 91)) : 0
					pos.push(pt[0], pt[1] + tooth, z)
					uv.push(sacc / 0.512, 0.5 + z / 0.064)
				}
			})
			for (let i = 0; i < path.length - 1; i++) {
				for (let j = 0; j < NZ; j++) {
					const a = i * (NZ + 1) + j, b = (i + 1) * (NZ + 1) + j, c = a + 1, e = b + 1
					idx.push(a, c, b, b, c, e)
				}
			}
			const g = new THREE.BufferGeometry()
			g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
			g.setIndex(idx)
			g.computeVertexNormals()
			return g
		})
		const tb = tapeTex()
		const tape = M("tape2", { color: new THREE.Color("#a8742f"), roughness: 0.25, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, normalMap: tb.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), alphaMap: tb.roughMap, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }, true)
		const tapeMesh = new THREE.Mesh(tapeGeo, tape)
		tapeMesh.castShadow = false
		tapeMesh.receiveShadow = true
		tapeMesh.renderOrder = 2
		parts.push(tapeMesh)
		return kit.group(...parts)
	}

	// ------------------------------------------------------------------------------------------ wall (painted wainscot partition)
	const BOARD = 0.06 // beadboard pitch: five boards across the wall's 0.3 m depth
	function wallTile() {
		return bake("wall-bead2", 1024, 256, (u, v, o) => {
			const x = u * 0.3
			const t = x / BOARD
			const dg = Math.abs(t - Math.round(t)) * BOARD // metres to the nearest joint between boards
			const V = clamp01(1 - dg / 0.003) // the V-groove, 3 mm each side
			const bd = (t - Math.floor(t)) * BOARD // across a board, from its left joint
			const bead = Math.exp(-Math.pow((bd - 0.0075) / 0.0017, 2)) // a rounded bead running beside the groove
			const stip = pfbm(u, v, 160, 40, 5, 2) - 0.5
			const brush = pn(u, v, 2, 90, 9) - 0.5
			const m = 1 - 0.5 * V * V + 0.12 * bead + 0.035 * stip + 0.012 * brush
			o.r = o.g = o.b = 255 * clamp01(m)
			o.h = 1 - V * 0.95 + bead * 0.8 + stip * 0.12
		}, { normal: 4 })
	}
	function wallPlain() {
		return bake("wall-plain", 256, 256, (u, v, o) => {
			const stip = pfbm(u, v, 40, 40, 5, 2) - 0.5
			const brush = pn(u, v, 2, 60, 9) - 0.5
			o.r = o.g = o.b = 255 * clamp01(1 + 0.04 * stip + 0.015 * brush)
			o.h = 0.5 + stip * 0.3
		}, { normal: 1.2 })
	}
	// the cut edge of the plywood core: thin veneers, cross-grain layers darker, dark glue lines between
	const PLY_T = [0.096, 0.2]
	function plyEdge() {
		const layers = 32
		return bake("ply-edge", 768, 256, (u, v, o) => {
			const L = u * layers
			const li = Math.floor(L), lf = L - li
			const cross = li % 2 === 1
			const id = h3(li, 3, 77)
			const glue = Math.max(1 - sstep(0.02, 0.1, lf), sstep(0.9, 0.98, lf))
			const strk = pn(u, v, layers * 3, 5, 5 + (li % 11))
			const fine = pn(u, v, 300, 3, 9)
			const voidp = sstep(0.965, 0.99, pn(u, v, layers, 14, 33))
			const base = cross ? [190, 150, 98] : [226, 194, 142]
			let c = lerp3(base, [base[0] * 0.86, base[1] * 0.84, base[2] * 0.8], id)
			const m = (0.9 + 0.22 * (strk - 0.5) + 0.1 * (fine - 0.5)) * (1 - 0.6 * voidp)
			c = lerp3([c[0] * m, c[1] * m, c[2] * m], [86, 58, 36], glue * 0.85)
			o.r = c[0]
			o.g = c[1]
			o.b = c[2]
			o.h = 0.6 - glue * 0.5 - voidp * 0.4 + (strk - 0.5) * 0.15
		}, { normal: 2.5 })
	}
	/**
	 * A prism with a convex x-y profile (counter-clockwise, metres, around its own origin) extruded through depth d (centred in z): a moulding.
	 * Rounded corners (profile vertices with small turns) shade smoothly. Groups: 0 the sides, 1 the +z end, 2 the -z end. Side uv: along the
	 * profile and along z, both in units of `tile` metres; ends: x and y in tile units.
	 */
	function profilePrism(pts, d, tile, key, capTile = PLY_T) {
		return kit.geo(`blocks|prism|${key}|${d.toFixed(4)}`, () => {
			const n = pts.length
			const segN = []
			for (let i = 0; i < n; i++) {
				const a = pts[i], b = pts[(i + 1) % n]
				const dx = b[0] - a[0], dy = b[1] - a[1]
				const l = Math.hypot(dx, dy) || 1
				segN.push([dy / l, -dx / l, l])
			}
			const vn = (i, seg) => {
				const pn0 = segN[(i + n - 1) % n], pn1 = segN[i % n]
				if (pn0[0] * pn1[0] + pn0[1] * pn1[1] > 0.8) {
					const x = pn0[0] + pn1[0], y = pn0[1] + pn1[1], l = Math.hypot(x, y) || 1
					return [x / l, y / l]
				}
				return [seg[0], seg[1]]
			}
			const pos = [], nor = [], uv = [], idx = []
			let arc = 0
			for (let i = 0; i < n; i++) {
				const a = pts[i], b = pts[(i + 1) % n], sg = segN[i]
				const na = vn(i, sg), nb = vn(i + 1, sg)
				const base = pos.length / 3
				for (const [p, nn, ar] of [[a, na, arc], [b, nb, arc + sg[2]]]) {
					for (const z of [d / 2, -d / 2]) {
						pos.push(p[0], p[1], z)
						nor.push(nn[0], nn[1], 0)
						uv.push(ar / tile, (z + d / 2) / tile)
					}
				}
				idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
				arc += sg[2]
			}
			const sideCount = idx.length
			const capStart = idx.length
			const capIdx = []
			for (const sgn of [1, -1]) {
				const base = pos.length / 3
				for (const p of pts) {
					pos.push(p[0], p[1], (sgn * d) / 2)
					nor.push(0, 0, sgn)
					uv.push(p[0] / capTile[0] + 0.5, p[1] / capTile[1] + 0.5)
				}
				for (let i = 1; i < n - 1; i++) {
					if (sgn > 0) capIdx.push(base, base + i, base + i + 1)
					else capIdx.push(base, base + i + 1, base + i)
				}
			}
			const half = capIdx.length / 2
			idx.push(...capIdx)
			const g = new THREE.BufferGeometry()
			g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3))
			g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
			g.setIndex(idx)
			g.addGroup(0, sideCount, 0)
			g.addGroup(capStart, half, 1)
			g.addGroup(capStart + half, half, 2)
			g.computeBoundingSphere()
			g.computeBoundingBox()
			return g
		})
	}
	/** A rectangle w x h (centred) with its top corners either chamfered (steps = 1) or rounded (more steps) by radius r; the bottom stays square. */
	function topRounded(w, hh, r, steps) {
		const pts = [[-w / 2, -hh / 2], [w / 2, -hh / 2]]
		for (let i = 0; i <= steps; i++) {
			const a = (i / steps) * Math.PI / 2
			pts.push([w / 2 - r + r * Math.cos(a), hh / 2 - r + r * Math.sin(a)])
		}
		for (let i = 0; i <= steps; i++) {
			const a = Math.PI / 2 + (i / steps) * Math.PI / 2
			pts.push([-w / 2 + r + r * Math.cos(a), hh / 2 - r + r * Math.sin(a)])
		}
		return pts
	}
	function wallPanel({ w, h, d, solid }) {
		if (solid.look === "steel") {
			const face = steelFace()
			const tile = { pz: [...STEEL_T, 0.1, 0.2], nz: [...STEEL_T, 0.5, 0.1], px: [...STEEL_T, 0.1, 0.2], nx: [...STEEL_T, 0.4, 0.6], py: [...STEEL_T, 0.3, 0.1], ny: [...STEEL_T, 0.7, 0.3] }
			return kit.group(mesh(softBox(w, h, d, Math.min(0.0015, 0.2 * Math.min(w, d)), { tile }), face))
		}
		const paint = solid.color ?? "#9bb7c2"
		const common = { roughness: 0.5, metalness: 0, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color("#ffffff") }
		const fieldMat = matOf(`wall2|${paint}`, wallTile(), { ...common, color: paint, normalScale: new THREE.Vector2(1.3, 1.3) })
		const trimMat = matOf("wall2|trim", wallPlain(), { ...common, color: "#f7f4ec", roughness: 0.42, normalScale: new THREE.Vector2(0.8, 0.8) })
		const plyMat = matOf("wall2|ply", plyEdge(), { color: "#ffffff", roughness: 0.7, metalness: 0, normalScale: new THREE.Vector2(1, 1) })
		const dark = M("wall2|gap", { color: "#262b2f", roughness: 1, metalness: 0 })
		const r = Math.min(0.0015, 0.2 * Math.min(w, d))
		// board faces run 0.3 m across z; the cut edges (front, back, top) are plywood laminations across the thickness
		const fieldTile = { px: [0.3, 0.3], nx: [0.3, 0.3, 0.1, 0.2], pz: [...PLY_T], nz: [...PLY_T, 0.3, 0.2], py: [...PLY_T, 0.1, 0.2], ny: [...PLY_T, 0.2, 0.2] }
		const fieldMats = [fieldMat, fieldMat, plyMat, plyMat, plyMat, plyMat]
		if (h < 0.5) return kit.group(mesh(softBox(w, h, d, r, { seg: [1, 1, 1], k: 3, tile: fieldTile }), fieldMats))
		const innerMats = [fieldMat, fieldMat, dark, dark, plyMat, plyMat] // the field's top and bottom edges sit in the shadow grooves
		// a painted wainscot: skirting at the foot with a chamfered top, beaded boards between, a bullnosed cap rail on top, a dark shadow
		// groove at each joint, all inside the wall's own box. The ends of the mouldings show the plywood core like the rest of the edge.
		const foot = Math.min(0.14, 0.12 * h), cap = Math.min(0.045, 0.05 * h), g = 0.003
		const mid = h - foot - cap - 2 * g
		const ends = [trimMat, plyMat, plyMat]
		const skirt = new THREE.Mesh(profilePrism(topRounded(w, foot, Math.min(0.006, w / 3, foot / 3), 1), d, 0.3, `skirt|${w.toFixed(4)}|${foot.toFixed(4)}`), ends)
		skirt.position.y = -h / 2 + foot / 2
		const rail = new THREE.Mesh(profilePrism(topRounded(w, cap, Math.min(0.0075, w / 3, cap / 3), 6), d, 0.3, `cap|${w.toFixed(4)}|${cap.toFixed(4)}`), ends)
		rail.position.y = h / 2 - cap / 2
		const field = mesh(softBox(w, mid, d, r, { seg: [1, 1, 1], k: 3, tile: fieldTile }), innerMats)
		field.position.y = -h / 2 + foot + g + mid / 2
		const strip = (yc) => {
			const m = mesh(kit.box(w - 0.0012, g + 0.0006, d - 0.0012, 0.0002, 1), dark)
			m.position.y = yc
			return m
		}
		for (const m of [skirt, rail]) {
			m.castShadow = true
			m.receiveShadow = true
		}
		return kit.group(skirt, strip(-h / 2 + foot + g / 2), field, strip(h / 2 - cap - g / 2), rail)
	}
	addModel("wall", "wall", wallPanel)

	// ------------------------------------------------------------------------------------------ registration
	const BUILD = { wood: blockWood, cork: blockCork, ice: blockIce, brick: blockClay("brick"), concrete: blockClay("concrete"), foam: blockFoam, cardboard: cardboardBox }
	const KIND_OF_LOOK = { wood: "wood", "light wood": "wood", "dark wood": "wood", cork: "cork", ice: "ice", glass: "ice", brick: "brick", concrete: "concrete", foam: "foam", cardboard: "cardboard" }
	// an item's own material gives its look; the item's material list can also swap it (a wooden block of brick, a brick of cork ...)
	const block = (dflt) => (ctx) => BUILD[KIND_OF_LOOK[ctx.solid.look] ?? dflt](ctx)
	addModel("wooden-block", "block", block("wood"))
	addModel("brick", "block", block("brick"))
	addModel("foam-block", "block", block("foam"))
	addModel("ice-cube", "block", block("ice"))
	addModel("cardboard-box", "block", block("cardboard"))
}
