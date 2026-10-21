// 3D models for the blocks catalog group (see web/models3d.js): wooden block, brick, steel weights, foam, ice, cardboard box,
// log, domino, wall (a glued hardwood board) and wedge (a door stop; a true right-triangle prism). Every model fills its physics outline
// (grown by SKIN_M = 0.75 mm on each x-y side so stacked things meet and resting ones touch the table; rounded or chamfered by a millimetre
// or two at most) and is built once: textures are baked per material at a fixed texel density (so resizing an item never re-bakes them),
// from noise lattices held in tables (pnS, pfbmS, worleyS) so a bake costs a few table reads per pixel, and each wood tile is baked on first use.
// Metals, lacquers, ice and tape take the room environment at their own intensity, with a warm table bounce in rays that point down only
// where there is a table (a scene, not a catalog photo); bricks, wooden blocks, ice and dominoes vary per instance (see perInstance).
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
/**
 * Periodic value noise on a tile as a sampler: pnS(fx, fy, s)(u, v) with u, v in [0, 1) and fx x fy lattice cells across the tile (integers),
 * 0..1. The lattice is a table filled once (one hash per cell, not four per sample), which is what makes a per-pixel bake cheap.
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
/** Fractal sum of `oct` octaves of pnS, doubling the lattice each octave: pfbmS(fx, fy, s, oct, gain)(u, v), 0..1. */
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
/** Periodic jittered-cell noise over precomputed cell points: worleyS(fx, fy, s)(u, v, out) sets out.f1 / out.f2 = distance to the nearest two points (cell units) and out.id = a 0..1 id of the nearest cell. */
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
	function bake(key, W, H, fn, opts = {}) {
		const hit = baked.get(key)
		if (hit) return hit
		const res = kit.bakeScope ? kit.bakeScope(`blocks|bake|${key}`, () => bakeNow(key, W, H, fn, opts)) : bakeNow(key, W, H, fn, opts) // (a bake worker may have worked it out already: models3d.js "Bake scopes")
		baked.set(key, res)
		return res
	}
	function bakeNow(key, W, H, fn, { normal = 0, rough = false, wrap = true, paint = null } = {}) {
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
			if (normal >= 6) {
				// a strong relief (bark) is smoothed by a pixel first: a one-texel furrow wall would draw a zipper of teeth in the normal map
				const t = new Float32Array(W * H)
				for (let y = 0; y < H; y++) {
					const ym = (y + H - 1) % H, yp = (y + 1) % H
					for (let x = 0; x < W; x++) {
						const xm = (x + W - 1) % W, xp = (x + 1) % W
						t[y * W + x] = (hgt[ym * W + xm] + hgt[ym * W + x] + hgt[ym * W + xp] + hgt[y * W + xm] + hgt[y * W + x] + hgt[y * W + xp] + hgt[yp * W + xm] + hgt[yp * W + x] + hgt[yp * W + xp]) / 9
					}
				}
				hgt.set(t)
			}
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
			ec = mix(ec, vec3(0.74, 0.48, 0.3) * (0.45 + 0.55 * lum) * 0.75, below * 0.62 * uTable);
			return ec * envMapIntensity;`
				tableChunk = "uniform float uTable;\n" + c.slice(0, j) + patch + c.slice(j + tail.length)
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
					if (chunk) {
						shader.fragmentShader = shader.fragmentShader.replace("#include <envmap_physical_pars_fragment>", chunk)
						shader.uniforms.uTable = m.userData.uTable ??= { value: 0 }
					}
				}
			}
			m.customProgramCacheKey = () => (env ? "blocks-grade-env" : "blocks-grade") + (inject ? "-" + hstr(inject) : "")
			if (env) {
				m.onBeforeRender = (r, scene, camera, geometry, object) => {
					if (scene.environment && m.envMap !== scene.environment) m.envMap = scene.environment
					// the warm table bounce only belongs in a scene with a table (view3d tags every model mesh with its solid's id): not in a catalog photo
					const u = (m.userData.uTable ??= { value: 0 })
					const t = object?.userData?.solidId !== undefined ? 1 : 0
					if (u.value !== t) {
						u.value = t
						m.uniformsNeedUpdate = true
					}
					// a catalog card has no room around the metal: it may carry brighter studio values (m.userData.cardTweak) that the scene's own draw never sees
					const tw = m.userData.cardTweak
					if (tw && tw.scene !== (t === 1)) {
						tw.scene = t === 1
						m.envMapIntensity = t === 1 ? tw.env0 : tw.env1
						m.roughness = t === 1 ? tw.rough0 : tw.rough1
						if (tw.color1) m.color.copy(t === 1 ? tw.color0 : tw.color1)
						m.uniformsNeedUpdate = true
					}
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
	/** A copy of material `mat` with its textures moved by (ou, ov) and mirrored (fx, fy), and its colour scaled by tint ([r, g, b]); `mirror` makes them wrap mirrored. Cached by `key`. */
	function variantOf(mat, key, { ou = 0, ov = 0, fx = false, fy = false, tint = null, mirror = false } = {}) {
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
				if (mirror) t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping // a face bigger than the tile: the tile mirrors across its edges, so no seam shows
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
		maple: { early: [228, 188, 128], late: [198, 142, 84], pore: 0.9, ringW: 0.0021, ringPore: 0, end: [206, 162, 108], endLate: [168, 122, 74] }, // amber-varnished: the catalog look is honey tan (#c8955a), not pale pine
		beech: { early: [232, 182, 124], late: [196, 138, 84], pore: 0.86, ringW: 0.0026, ringPore: 0, end: [214, 160, 104], endLate: [172, 118, 70] },
		oak: { early: [214, 172, 112], late: [168, 122, 70], pore: 0.72, ringW: 0.003, ringPore: 1, end: [200, 156, 100], endLate: [150, 108, 64] },
		walnut: { early: [118, 78, 52], late: [74, 46, 32], pore: 0.8, ringW: 0.0028, ringPore: 0.4, end: [100, 64, 42], endLate: [62, 38, 26] },
	}
	const LONG_T = [0.48, 0.12]
	const STRAIGHT_T = [0.24, 0.06] // the quarter-sawn tile is smaller: it only ever covers edges and ends
	const END_T = [0.1, 0.1]
	// cathedral: flat-sawn face (arches), straight: quarter-sawn edge face (evenly spaced straight lines), dom: the tile the domino faces sample
	const WOOD_CFG = {
		cath: { tx: 0.48, ty: 0.12, arches: 3, zmin: 0.01, zamp: 0.028 },
		straight: { tx: STRAIGHT_T[0], ty: STRAIGHT_T[1], straight: true },
		dom: { tx: 0.16, ty: 0.08, straight: true },
	}
	/**
	 * A function (u, v, o) for the long-grain wood colour at tile coordinates (grain along u): sets o.r, o.g, o.b, o.h. The rings are cylinders round
	 * a pith that runs along the grain; a flat-sawn face cuts them at a depth that varies along the board, which gives the arches (the "cathedral")
	 * of real boards. A straight face cuts the rings edge-on instead, so its lines run parallel and evenly spaced (and, as an exact whole number of
	 * rings fits the tile, it repeats without a seam). The noise lattices are built once per function, so a bake costs a few table reads per pixel.
	 */
	function woodGrainFn(P, cfg = WOOD_CFG.cath, W = 0) {
		const kx = cfg.tx / 0.16, ky = cfg.ty / 0.08 // lattice counts below were tuned on a 0.16 x 0.08 m tile
		const L = (n, k) => Math.max(1, Math.round(n * k))
		const straight = !!cfg.straight
		const n = cfg.arches ?? 1
		const archA = !straight && n > 1 ? pnS(n, 1, 61) : null
		const archP = !straight && n > 1 ? pnS(n, 1, 62) : null
		const wobA = pfbmS(L(3, kx), L(3, ky), 11, straight ? 2 : 3)
		const wobB = straight ? null : pnS(L(2, kx), L(6, ky), 12)
		const rw = straight ? cfg.ty / Math.max(1, Math.round(cfg.ty / P.ringW)) : P.ringW
		const streakA = pnS(L(4, kx), L(230, ky), 21)
		const streakB = pnS(L(14, kx), L(80, ky), 22)
		const poreN = P.ringPore ? pnS(L(70, kx), L(420, ky), 31) : pnS(L(120, kx), L(380, ky), 31)
		const toneN = pfbmS(L(2, kx), L(2, ky), 41, 3)
		const zdRow = !straight && W ? new Float32Array(W) : null // the depth of the cut depends on u only: worked out on the first row, read on the rest
		return (u, v, o) => {
			const y = (v - 0.5) * cfg.ty
			let g
			if (straight) {
				g = (y + (wobA(u, v) - 0.5) * 0.005) / rw
			} else {
				let zd
				if (zdRow && o.iy > 0) zd = zdRow[o.ix]
				else {
					const amp = cfg.zamp * (n > 1 ? 0.65 + 0.7 * archA(u, 0.5) : 1)
					const ph = n > 1 ? 0.5 * (archP(u, 0.5) - 0.5) : 0
					zd = cfg.zmin + amp * (0.5 - 0.5 * Math.cos(Math.PI * 2 * (n * u - 0.3 + ph)))
					if (zdRow) zdRow[o.ix] = zd
				}
				const pithY = n > 1 ? 0.06 : 0.012 // level with the tile's top edge: arches rise toward it instead of closing into eyes
				const wob = (wobA(u, v) - 0.5) * 0.006 + (wobB(u, v) - 0.5) * 0.002
				const yy = y - pithY + wob
				g = Math.sqrt(yy * yy + zd * zd) / rw
			}
			const fr = g - Math.floor(g)
			const late = Math.pow(fr, 2.2) * (1 - sstep(0.84, 1.0, fr)) // the ring edge is crisp but not a one-pixel step (it would stair-step on a slanted line)
			const streak = streakA(u, v) - 0.5
			const streak2 = streakB(u, v) - 0.5
			const pores = P.ringPore ? sstep(0.7, 0.9, poreN(u, v)) * (0.3 + 0.9 * (1 - late)) : sstep(0.8, 0.95, poreN(u, v)) * 0.55
			const broad = toneN(u, v) - 0.5
			const tone = clamp01(late * 0.8 + streak * 0.45 + streak2 * 0.25 + broad * 0.45)
			const c0 = P.early, c1 = P.late
			const m = (1 - (1 - P.pore) * pores) * (1 + 0.14 * broad)
			o.r = (c0[0] + (c1[0] - c0[0]) * tone) * m
			o.g = (c0[1] + (c1[1] - c0[1]) * tone) * m
			o.b = (c0[2] + (c1[2] - c0[2]) * tone) * m
			o.h = 0.5 - pores * 0.25 + streak * 0.08
		}
	}
	function woodLong(kind, straight = false) {
		const P = WOODS[kind]
		if (straight) return bake(`wood-straight3|${kind}`, 768, 192, woodGrainFn(P, WOOD_CFG.straight), { normal: 2.5 })
		return bake(`wood-long3|${kind}`, 1280, 320, woodGrainFn(P, WOOD_CFG.cath, 1280), { normal: 2.5 }) // 2.7 px/mm
	}
	function woodEnd(kind) {
		const P = WOODS[kind]
		const wobN = pfbmS(4, 4, 51, 3), dotN = pnS(500, 500, 61), rayN = pnS(70, 6, 62), toneN = pfbmS(3, 3, 63, 3)
		return bake(`wood-end3|${kind}`, 384, 384, (u, v, o) => {
			const x = (u - 0.5) * END_T[0], y = (v - 0.5) * END_T[1]
			const wob = (wobN(u, v) - 0.5) * 0.0016
			// the pith lies far to one side, so the rings cross the end as near-vertical arcs and meet the straight grain of the top and bottom
			const cx = 0.13, cy = 0.008
			const r0 = Math.hypot(x - cx, y - cy)
			const rho = r0 + wob + 0.0022 * Math.sin(r0 * 210) // rings widen and narrow with the seasons
			const g = rho / 0.0027
			const fr = g - Math.floor(g)
			const late = Math.pow(fr, 2.2) * (1 - sstep(0.84, 1.0, fr))
			const dots = sstep(0.78, 0.92, dotN(u, v)) // maple's pores are far below what the eye resolves: a faint speckle only
			const rays = rayN(Math.atan2(y - cy, x - cx) / 6.2832 + 0.5, (rho * 30) % 1)
			const tone = clamp01(late * 0.8 + (rays - 0.5) * 0.35 + (toneN(u, v) - 0.5) * 0.5)
			const c = lerp3(P.end, P.endLate, tone)
			const m = (1 - (1 - P.pore) * dots * 0.6 - 0.06) * 0.88 // end grain drinks stain and reads about 12% darker than the long grain
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = 0.5 - dots * 0.08 + (late - 0.5) * 0.06
		}, { normal: 3 })
	}
	const END_WIDE_T = [0.24, 0.12]
	const END_WIDE_BIG = 2.5 // the second size class of the wide end tile: 2.5 x the tile (60 x 30 cm) at 2 px/mm
	/**
	 * End grain for a face wider than a block's end (a wedge's triangular faces): a 0.24 x 0.12 m tile at the same 3.8 px/mm as the other end tiles, the
	 * pith 20 cm below its lower edge, so the rings cross it as arcs bowed like the end of a plank. Not periodic: a face maps to it once, with one scale on
	 * both axes (never stretched), so the rings stay true circles of their own pith. A face bigger than 1.5 tiles takes the big class: the same plank
	 * end laid out 2.5 x larger (the rings keep their 2.7 mm), so a large wedge shows plank-scale end grain and not one magnified blur.
	 */
	function woodEndWide(kind, big = false) {
		const P = WOODS[kind]
		const T = big ? END_WIDE_BIG : 1
		const Tx = END_WIDE_T[0] * T, Ty = END_WIDE_T[1] * T
		const W = big ? 1216 : 912, H = big ? 608 : 456
		const k = (n) => Math.round(n * T)
		const wobN = pfbmS(k(10), k(5), 51, 3), dotN = pnS(big ? 900 : 600, big ? 450 : 300, 61), rayN = pnS(70, 6, 62), toneN = pfbmS(k(7), k(4), 63, 3)
		return bake(big ? `wood-endw2|${kind}` : `wood-endw1|${kind}`, W, H, (u, v, o) => {
			const x = (u - 0.5) * Tx, y = (v - 0.5) * Ty
			const wob = (wobN(u, v) - 0.5) * 0.0016
			const cx = -0.03 * T, cy = -0.2 * T
			const r0 = Math.hypot(x - cx, y - cy)
			const rho = r0 + wob + 0.0022 * Math.sin(r0 * 210)
			const g = rho / 0.0027
			const fr = g - Math.floor(g)
			const late = Math.pow(fr, 2.2) * (1 - sstep(0.84, 1.0, fr))
			const dots = sstep(0.78, 0.92, dotN(u, v))
			const rays = rayN(Math.atan2(y - cy, x - cx) / 6.2832 + 0.5, (rho * 30) % 1)
			const tone = clamp01(late * 0.8 + (rays - 0.5) * 0.35 + (toneN(u, v) - 0.5) * 0.5)
			const c = lerp3(P.end, P.endLate, tone)
			const m = (1 - (1 - P.pore) * dots * 0.6 - 0.06) * 0.88
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = 0.5 - dots * 0.08 + (late - 0.5) * 0.06
		}, { normal: 3, wrap: false })
	}
	/** The wood materials {long (cathedral), straight, end} for a species (tinted when the item carries its own colour). Each tile is baked on first use. */
	function woodMats(kind, { stain = null, gloss = 0.85, tag = "" } = {}) {
		const common = { color: stain ?? "#ffffff", roughness: 0.4, metalness: 0, clearcoat: gloss, clearcoatRoughness: 0.08 }
		const out = {}
		const lazy = (name, make) => {
			let m = null
			Object.defineProperty(out, name, { enumerable: true, get: () => (m ??= make()) })
		}
		lazy("long", () => matOf(`wood-long3|${kind}|${stain}|${gloss}|${tag}`, woodLong(kind), { ...common, normalScale: new THREE.Vector2(0.5, 0.5) }))
		lazy("straight", () => matOf(`wood-straight3|${kind}|${stain}|${gloss}|${tag}`, woodLong(kind, true), { ...common, normalScale: new THREE.Vector2(0.5, 0.5) }))
		lazy("end", () => matOf(`wood-end3|${kind}|${stain}|${gloss}|${tag}`, woodEnd(kind), { ...common, roughness: 0.55, normalScale: new THREE.Vector2(0.6, 0.6) }))
		lazy("endWide", () => matOf(`wood-endw1|${kind}|${stain}|${gloss}|${tag}`, woodEndWide(kind), { ...common, roughness: 0.55, normalScale: new THREE.Vector2(0.6, 0.6) }))
		lazy("endWideBig", () => matOf(`wood-endw2|${kind}|${stain}|${gloss}|${tag}`, woodEndWide(kind, true), { ...common, roughness: 0.55, normalScale: new THREE.Vector2(0.6, 0.6) }))
		return out
	}
	const woodKindOf = (lookName) => (lookName === "dark wood" ? "walnut" : lookName === "light wood" ? "beech" : "maple")
	// ------------------------------------------------------------------------------------------ cork
	function corkTex() {
		const wr = worleyS(90, 90, 5), fleckN = pnS(140, 140, 9), toneN = pnS(12, 12, 3)
		const W = {}
		return bake("cork2", 512, 512, (u, v, o) => {
			wr(u, v, W)
			const edge = sstep(0.0, 0.3, W.f2 - W.f1)
			const c = lerp3([208, 160, 106], [164, 114, 68], W.id)
			const fleck = sstep(0.78, 0.9, fleckN(u, v)) * 0.45
			const m = (0.72 + 0.28 * edge) * (1 - fleck) * (0.94 + 0.12 * toneN(u, v))
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = 0.25 + edge * 0.6 + W.id * 0.1
		}, { normal: 3.5 })
	}
	const CORK_T = [0.1, 0.1]

	// ------------------------------------------------------------------------------------------ generic blocks
	const mesh = (g, m) => kit.mesh(g, m)
	// the engine's contact skin keeps resting bodies ~1.5 mm apart; every box model grows by this much on each x-y side (inside the ~1 mm outline rule)
	// so stacked things meet and a resting one touches the table, as view3d's own slabs do
	const SKIN_M = 0.00075
	const sixTiles = (t, ends = t, tops = t) => ({
		pz: [t[0], t[1]], nz: [t[0], t[1], 0.31, 0.17], py: [tops[0], tops[1], 0.13, 0.4], ny: [tops[0], tops[1], 0.6, 0.77],
		px: [ends[0], ends[1]], nx: [ends[0], ends[1], 0.2, 0.1],
	})
	function blockWood({ w, h, d, solid }) {
		const kind = woodKindOf(solid.look)
		const M = woodMats(kind, { stain: solid.color ?? null })
		// long grain on the two big faces, straight (edge) grain on top and bottom, end grain on the two ends (x = +-w/2). The flat-sawn tile is 12 cm tall and
		// repeats, so a face taller than that would stack the same band of arches: a tall face is rift-sawn instead (straight grain, which repeats without showing it)
		const face = h > LONG_T[1] ? M.straight : M.long
		// sanded edges as a real toy block's (3.5 mm on a 5 cm block): stacked blocks show their seams, so a stack of three reads as three
		const geo = softBox(w + 2 * SKIN_M, h + 2 * SKIN_M, d, Math.min(0.0035, 0.07 * Math.min(w, h, d)), { k: 4, tile: sixTiles(h > LONG_T[1] ? STRAIGHT_T : LONG_T, END_T, STRAIGHT_T) })
		const proto = kit.group(mesh(geo, [M.end, M.end, M.straight, M.straight, face, face]))
		// each block is cut from a different place in the board: the long-grain tiles are periodic in u, so shift and mirror them per block
		return perInstance(proto, (mesh, hsh) => {
			const vi = hsh % 12
			const ou = frac(vi, 1), fx = frac(vi, 3) < 0.5, fy = frac(vi, 4) < 0.5
			const k = 0.97 + 0.06 * frac(vi, 5)
			const tint = [k, k, k]
			const key = `w${vi}`
			return [M.end, M.end, M.straight, M.straight, face, face].map((m, i) => (i < 2 ? variantOf(m, key, { fx, fy, tint }) : variantOf(m, key, { ou, fx, fy, tint })))
		})
	}
	function blockCork({ w, h, d, solid }) {
		const b = corkTex()
		const m = matOf(`cork2|${solid.color}`, b, { color: solid.color ?? "#ffffff", roughness: 0.92, normalScale: new THREE.Vector2(0.9, 0.9) })
		const geo = softBox(w + 2 * SKIN_M, h + 2 * SKIN_M, d, Math.min(0.0018, 0.1 * Math.min(w, h, d)), { k: 3, tile: sixTiles(CORK_T) })
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
		const fn = woodGrainFn(P, WOOD_CFG.dom, 256)
		return bake("domino-grain3", 256, 512, (u, v, o) => fn(v * 0.31 + 0.2, u * 0.31 + 0.1, o), { normal: 2 }) // the grain runs along the domino's length (v)
	}
	/**
	 * The wood face with its two halves of pips and the divider. Pips are drilled and paint-filled: a bowl in the normal map, dark matte
	 * paint, a slightly higher roughness than the lacquered wood; the divider is an engraved line (dark centre, V in the normal map) with the brass spindle.
	 * Only the pixels the pips and the divider touch are worked on: the rest is the shared grain's colour and normal.
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
		// the boxes (x0, x1, y0, y1) the pips and the divider can change, a pixel wider than they reach (the normal looks at its neighbours)
		const boxes = pips.map(([cx, cy]) => [Math.max(0, Math.floor(cx - R - 3)), Math.min(W - 1, Math.ceil(cx + R + 3)), Math.max(0, Math.floor(cy - R - 3)), Math.min(H - 1, Math.ceil(cy + R + 3))])
		boxes.push([0, W - 1, Math.max(0, Math.floor(gy - gw - 2)), Math.min(H - 1, Math.ceil(gy + gw + 2))])
		// height field: 0 = the surface, negative = cut in
		const hgt = new Float32Array(W * H)
		const paint = new Float32Array(W * H) // 0..1 paint-filled
		for (const [cx, cy] of pips) {
			for (let y = Math.max(0, Math.floor(cy - R - 2)); y <= Math.min(H - 1, Math.ceil(cy + R + 2)); y++) {
				for (let x = Math.max(0, Math.floor(cx - R - 2)); x <= Math.min(W - 1, Math.ceil(cx + R + 2)); x++) {
					const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
					if (dd >= R) continue
					const bowl = 1 - (dd / R) * (dd / R)
					hgt[y * W + x] = -0.9 * Math.pow(bowl, 0.6)
					paint[y * W + x] = 1 - sstep(R - 1.2, R, dd)
				}
			}
		}
		for (let y = Math.max(0, Math.floor(gy - gw - 1)); y <= Math.min(H - 1, Math.ceil(gy + gw + 1)); y++) {
			const dy = Math.abs(y + 0.5 - gy)
			for (let x = 0; x < W; x++) {
				const inX = Math.min(sstep(gx0 - 1, gx0 + 3, x), 1 - sstep(gx1 - 3, gx1 + 1, x))
				const gv = inX * (1 - sstep(0, gw, dy))
				const i = y * W + x
				hgt[i] = Math.min(hgt[i], -0.7 * gv)
				paint[i] = Math.max(paint[i], gv * 0.9)
			}
		}
		const grainN = (grainNormalData ??= base.normalMap.image.getContext("2d").getImageData(0, 0, W, H).data)
		const grainC = base.map.image
		const map = kit.tex(`blocks|domino-face3|${a}|${b}`, W, H, (g) => {
			g.drawImage(grainC, 0, 0)
			const img = g.getImageData(0, 0, W, H)
			for (const [x0, x1, y0, y1] of boxes) {
				for (let y = y0; y <= y1; y++) {
					for (let x = x0; x <= x1; x++) {
						const i = y * W + x, pa = paint[i]
						if (pa === 0) continue
						img.data[i * 4] = mix(img.data[i * 4], 24, pa)
						img.data[i * 4 + 1] = mix(img.data[i * 4 + 1], 20, pa)
						img.data[i * 4 + 2] = mix(img.data[i * 4 + 2], 17, pa)
					}
				}
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
		const normalMap = kit.tex(`blocks|domino-face3n|${a}|${b}`, W, H, (g) => {
			const img = new ImageData(new Uint8ClampedArray(grainN), W, H)
			for (const [x0, x1, y0, y1] of boxes) {
				for (let y = y0; y <= y1; y++) {
					const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1)
					for (let x = x0; x <= x1; x++) {
						const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1)
						const dx = (hgt[y * W + xp] - hgt[y * W + xm]) * 0.5 * S
						const dy = (hgt[yp * W + x] - hgt[ym * W + x]) * 0.5 * S
						const i = (y * W + x) * 4
						// the grain's own normal (tangent-space xy) plus the cut's slope
						const gnx = grainN[i] / 127.5 - 1, gny = grainN[i + 1] / 127.5 - 1
						const nx = gnx - dx, ny = gny + dy
						const len = Math.sqrt(nx * nx + ny * ny + 1)
						img.data[i] = (nx / len * 0.5 + 0.5) * 255
						img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255
						img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255
					}
				}
			}
			g.putImageData(img, 0, 0)
		}, { data: true })
		const roughMap = kit.tex(`blocks|domino-face3r|${a}|${b}`, W, H, (g) => {
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
		const cb = DOM_COMBOS[(key >>> 5) % DOM_COMBOS.length]
		const face = (c) => {
			const b = dominoFace(c[0], c[1])
			return matOf(`domino-face3|${c}|${stain}`, b, { color: stain ?? "#ffffff", roughness: 1, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.8, normalScale: new THREE.Vector2(0.9, 0.9) }, true)
		}
		// a real domino has its pips on one face only: the back (+x) is plain lacquered wood, the pips and the divider are on -x (the face that ends up on top when a tile topples toward +x)
		const back = matOf(`domino-back|${stain}`, dominoGrain(), { color: stain ?? "#ffffff", roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.8, normalScale: new THREE.Vector2(0.9, 0.9) }, true)
		const tile = {
			pz: [STRAIGHT_T[0], STRAIGHT_T[1], 0.2, 0.31, true], nz: [STRAIGHT_T[0], STRAIGHT_T[1], 0.4, 0.5, true],
			py: [END_T[0], END_T[1]], ny: [END_T[0], END_T[1], 0.3, 0.2],
		}
		// a sanded edge: the radius a woodworker leaves (the faces and the divider are modelled as pixels, the edge as geometry)
		const geo = softBox(w + 2 * SKIN_M, h + 2 * SKIN_M, d, Math.min(0.0015, 0.08 * Math.min(w, h, d)), { k: 3, tile })
		const proto = kit.group(mesh(geo, [back, face(cb), M.end, M.end, M.straight, M.straight]))
		// every tile shows its own pips: the model is shared, so each clone picks its two halves from its solid's id the first time it is drawn
		return perInstance(proto, (mesh, hsh) => {
			const x = hsh >>> 3
			const pb = DOM_COMBOS[(x >>> 4) % DOM_COMBOS.length]
			return [back, face(pb), M.end, M.end, M.straight, M.straight]
		})
	}
	addModel("domino", "domino", dominoModel)
	addModel("domino-row", "*", dominoModel)
	// ------------------------------------------------------------------------------------------ wooden log
	const BARK_TZ = 0.25
	let barkFn = null
	/** 0 (deep furrow) .. 1 (plate top) at (angle fraction u, length coordinate v), periodic in both: the 0.5 contours of slowly varying noise are the fissures. */
	function barkDepth(u, v) {
		if (!barkFn) {
			const warpA = pfbmS(6, 2, 81, 3), warpB = pnS(3, 16, 89), warpC = pfbmS(5, 3, 96, 2), aN = pnS(34, 2, 82), bN = pnS(30, 3, 95), cN = pfbmS(70, 14, 83, 3), ridgeN = pnS(160, 8, 90)
			const lenN = pnS(40, 1, 97) // one cell along the length: its 0.5 contours are long lengthwise furrows
			barkFn = (u, v) => {
				const warp = (warpA(u, v) - 0.5) * 0.06 + (warpB(u, v) - 0.5) * 0.012
				const warp2 = (warpC(u, v) - 0.5) * 0.05
				// three sets of mostly lengthwise fissures (the 0.5 contours of noises with different cell sizes) cross and rejoin, so the plates between
				// them are long diamonds with sharp, broken edges, as on oak, not closed rounded loops; the third set is the longest and straightest
				const da = Math.min(Math.abs(aN(u + warp, v) - 0.5), Math.abs(bN(u + warp2, v) - 0.5), Math.abs(lenN(u + warp * 1.4, v) - 0.5))
				const f1 = 1 - sstep(0.0, 0.07, da) // a furrow whose walls are a few texels wide (a one-texel wall draws a zipper in the normal map)
				const c = cN(u, v)
				const plate = 0.92 + 0.08 * sstep(0.07, 0.18, da) // plates are flat-topped with a short rounded shoulder
				const ridge = ridgeN(u + warp * 0.5, v) // fine lengthwise fibrous ridges inside the plates
				return clamp01(plate + 0.06 * (c - 0.5) + 0.15 * (ridge - 0.5) - f1 * (0.7 + 0.3 * c))
			}
		}
		return barkFn(u, v)
	}
	let barkMax = 0
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
		const s1N = pnS(300, 10, 86), s2N = pnS(120, 4, 87), mottN = pfbmS(24, 6, 91, 2), lichenN = pfbmS(5, 3, 88, 2), roughN = pfbmS(240, 80, 92, 2), mot2N = pfbmS(120, 40, 93, 2)
		return bake(`bark6|${kind}`, 640, 400, (u, v, o) => {
			const d = barkDepth(u, v)
			const s1 = s1N(u, v) // lengthwise fibres
			const s2 = s2N(u, v)
			const mott = mottN(u, v)
			const lichen = sstep(0.62, 0.8, lichenN(u, v))
			let c = lerp3(P.bark[1], P.bark[0], clamp01(d * 1.25 - 0.25))
			// the walls of a furrow are a warmer reddish brown where the inner bark shows, and its floor is nearly black
			const wall = sstep(0.12, 0.25, d) * (1 - sstep(0.4, 0.6, d))
			c = lerp3(c, [110, 72, 50], wall * 0.45)
			c = lerp3(c, [150, 150, 128], lichen * 0.22 * d)
			c = lerp3(c, [28, 20, 16], 1 - sstep(0.05, 0.25, d))
			const m = (0.78 + 0.34 * (s1 - 0.5) + 0.22 * (s2 - 0.5) + 0.3 * (mott - 0.5)) * (0.85 + 0.3 * mot2N(u, v))
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = d * 0.9 + (s1 - 0.5) * 0.12 + (s2 - 0.5) * 0.06 + 0.35 * (roughN(u, v) - 0.5) * d // the plates are rough at the scale of a millimetre
			o.rough = 0.85 + 0.15 * (1 - sstep(0.1, 0.35, d))
		}, { normal: 8, rough: true })
	}
	/** The sawn end: rings, a pith dot, two or three seasoning checks that open toward the bark, faint saw marks, inner bark and outer bark. */
	function logEndTex(kind) {
		const P = LOGS[kind]
		const kh = hstr(kind)
		const nck = 2 + (kh % 2)
		const checks = []
		for (let i = 0; i < nck; i++) {
			checks.push({ a: ((i + 0.15 + 0.7 * h3(i, 1, kh)) / nck) * 6.2832, hw: (0.05 + 0.014 * h3(i, 2, kh)) * 0.5, q0: 0.36 + 0.24 * h3(i, 3, kh) })
		}
		const sawDir = [Math.cos(0.5 + 0.8 * h3(5, 5, kh)), Math.sin(0.5 + 0.8 * h3(5, 5, kh))]
		const wobN = pfbmS(5, 5, 71, 3), heartN = pfbmS(4, 4, 72, 2), rayN = pnS(90, 6, 73), fibN = pnS(260, 260, 74)
		const jagA = pnS(60, 60, 78), jagB = pnS(14, 14, 79), ibN = pnS(140, 140, 80), bfA = pnS(200, 200, 75), bfB = pnS(30, 30, 76), bhN = pnS(120, 120, 77), sawN = pnS(6, 6, 94)
		return bake(`log-end3|${kind}`, 320, 320, (u, v, o) => {
			const x = (u - 0.5) * 2, y = (v - 0.5) * 2
			const rho = Math.hypot(x, y)
			const cx = 0.05, cy = -0.03
			const ang = Math.atan2(y - cy, x - cx)
			const r0 = Math.hypot(x - cx, y - cy)
			const wob = ((wobN(u, v) - 0.5) * 0.05 + 0.02 * Math.sin(ang * 3 + 1.3)) * Math.min(1, r0 * 4) // no lobes right at the pith
			const q = r0 * (1 + 0.04 * Math.sin(ang * 2) * Math.min(1, r0 * 4)) + wob
			const g = q * P.rings
			const late = Math.pow(g - Math.floor(g), 2.6)
			const heart = 1 - sstep(0.5, 0.66, q + (heartN(u, v) - 0.5) * 0.1)
			let c = lerp3(P.sap, P.heart, heart)
			c = lerp3(c, [c[0] * 0.74, c[1] * 0.72, c[2] * 0.7], late * P.ring)
			const rays = rayN(ang / 6.2832 + 0.5, (q * 40) % 1)
			const fib = 0.94 + 0.12 * fibN(u, v)
			// faint saw marks across the whole face: arcs a little over half a millimetre apart
			const saw = Math.sin((x * sawDir[0] + y * sawDir[1]) * 600 + 8 * sawN(u, v))
			let m = (0.96 + 0.08 * (rays - 0.5) * 2) * fib * (1 - 0.03 * (0.5 + 0.5 * saw))
			let h = 0.5 + (late - 0.5) * 0.08 + 0.03 * saw
			// checks: each a wedge that starts at the bark and runs inward, a dark cut with a slightly raised lip
			let ck = 0, lip = 0
			for (const k of checks) {
				if (q < k.q0 || q > 0.94) continue
				let da = Math.abs(ang - k.a) % 6.2832
				if (da > 3.1416) da = 6.2832 - da
				const f = Math.pow(Math.min(1.1, (q - k.q0) / (0.9 - k.q0)), 0.7)
				const wd = (k.hw * f) / Math.max(q, 0.3)
				const cut = 1 - sstep(wd * 0.55, wd, da)
				ck = Math.max(ck, cut)
				lip = Math.max(lip, (1 - sstep(wd, wd + 0.012, da)) * (1 - cut) * f)
			}
			c = lerp3(c, [50, 36, 26], ck * 0.85)
			m *= 1 + 0.07 * lip
			h += -0.4 * ck + 0.1 * lip
			// the pith: a soft dark dot about a millimetre and a half across
			const pith = 1 - sstep(0.0, 0.016, Math.hypot(x - cx, y - cy))
			m *= 1 - 0.5 * pith
			c = [c[0] * m, c[1] * m, c[2] * m]
			// bark ring: a lighter inner bark band, then the dark outer bark whose inner edge is jagged
			const jag = (jagA(u, v) - 0.5) * 0.02 + (jagB(u, v) - 0.5) * 0.014
			const rj = rho + jag
			const outer = sstep(0.896, 0.906, rj)
			const innerBark = sstep(0.852, 0.866, rj) * (1 - outer)
			if (innerBark > 0) {
				const ib = 0.85 + 0.3 * ibN(u, v)
				c = lerp3(c, [150 * ib, 104 * ib, 72 * ib], innerBark * 0.9)
				h = mix(h, 0.5, innerBark * 0.5)
			}
			if (outer > 0) {
				const bf = 0.72 + 0.55 * bfA(u, v) * (0.6 + 0.4 * bfB(u, v))
				const bc = [P.bark[1][0] * 1.15 * bf, P.bark[1][1] * 1.15 * bf, P.bark[1][2] * 1.15 * bf]
				c = lerp3(c, bc, outer)
				h = mix(h, 0.5 + (bhN(u, v) - 0.5) * 0.3, outer)
			}
			o.r = c[0]
			o.g = c[1]
			o.b = c[2]
			o.h = h
		}, { normal: 3, wrap: false })
	}
	function logGeometry(R, L, kind) {
		// the bark tile goes round the log k times (one turn per 12 cm of diameter, the size of the tile's plates on the default log), so the plates keep their size
		// on a thick log instead of growing with it; the geometry's furrows sample the same k turns, so they stay lined up with the normal map
		const k = Math.max(1, Math.round(R / 0.06))
		const NS = Math.min(240, 160 * k), NZ = Math.min(48, Math.max(10, Math.round(L / 0.005))), NR = 10
		const maxDepth = Math.max(0.0015, Math.min(0.008, 0.075 * R))
		if (barkMax === 0) for (let i = 0; i < 96; i++) for (let j = 0; j < 24; j++) barkMax = Math.max(barkMax, barkDepth(i / 96, j / 24))
		const bmax = barkMax
		const rAt = (a01, z) => {
			const v = 0.5 + z / BARK_TZ
			// the vertices are far coarser than the thinnest fissures (the normal map carries those), so sample the depth over a short span along the length
			const dv = 0.4 * (L / NZ) / BARK_TZ
			const uu = a01 * k
			const f = (vv) => barkDepth(uu - Math.floor(uu), vv - Math.floor(vv))
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
				uv.push(t * k, 0.5 + z / BARK_TZ)
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
			const m = matOf("cork2|log", b, { roughness: 0.92, normalScale: new THREE.Vector2(0.9, 0.9) })
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
		const barkMat = matOf(`bark6|${kind}|${tint}`, bark, { color: tint, roughness: 1, normalScale: new THREE.Vector2(2.2, 2.2) })
		const endMat = matOf(`log-end3|${kind}|${tint}`, end, { color: tint, roughness: 0.8, normalScale: new THREE.Vector2(0.8, 0.8) })
		const [side, capA, capB] = logGeometry(r, L, kind)
		return kit.group(mesh(side, barkMat), mesh(capA, endMat), mesh(capB, endMat))
	}
	addModel("wooden-log", "log", logModel)
	// ------------------------------------------------------------------------------------------ brick (and concrete)
	const CLAYS = {
		brick: { a: [148, 62, 44], b: [118, 48, 38], dark: [84, 36, 30], pale: [200, 168, 140], rough: 0.92, grain: 0.18 },
		concrete: { a: [172, 170, 164], b: [146, 144, 138], dark: [100, 98, 94], pale: [200, 198, 192], rough: 0.95, grain: 0.22 },
	}
	// 2.1 px/mm; the header (end) faces sample the stretcher tile at another offset, so only two tiles are baked
	const BRICK_TILES = { stretcher: [0.23, 0.072, 480, 150], bed: [0.23, 0.115, 480, 240] }
	function clayTile(kind, face) {
		const P = CLAYS[kind]
		const [Tx, Ty, W, H] = BRICK_TILES[face]
		const seed = hstr(face) % 97
		const fx = (m) => Math.max(1, Math.round(Tx / m)), fy = (m) => Math.max(1, Math.round(Ty / m))
		const Wo = {}
		const mark = kind === "brick" && face === "bed" ? maskOf(W, H, (g) => {
			g.font = '900 34px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif'
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.fillText("SANDBOX", W / 2, H / 2 - 3, W * 0.34)
			g.font = '700 14px "Helvetica Neue", Arial, sans-serif'
			g.fillText("BRICK  WORKS", W / 2, H / 2 + 22, W * 0.34)
		}) : null
		const toneA = pfbmS(fx(0.06), fy(0.06), seed, 4), toneB = pfbmS(fx(0.015), fy(0.015), seed + 5, 3)
		const grainA = pnS(fx(0.0012), fy(0.0012), seed + 9), grainB = pnS(fx(0.0005), fy(0.0005), seed + 11)
		const pitW = worleyS(fx(0.004), fy(0.004), seed + 13)
		const sandH = pnS(fx(0.0005), fy(0.0005), seed + 51), sandL = pnS(fx(0.0005), fy(0.0005), seed + 52)
		const burnN = pfbmS(fx(0.045), fy(0.045), seed + 21, 3), flashN = pfbmS(fx(0.09), fy(0.03), seed + 23, 3), paleN = pnS(fx(0.002), fy(0.002), seed + 31)
		const dragN = face === "stretcher" ? null : pnS(fx(0.12), fy(0.0016), seed + 41)
		const kissWarp = face === "stretcher" ? pfbmS(4, 2, seed + 61, 3) : null
		const kissPatch = face === "stretcher" ? pfbmS(2, 1, seed + 62, 2) : null
		return bake(`clay4|${kind}|${face}`, W, H, (u, v, o) => {
			const tone = toneA(u, v)
			const tone2 = toneB(u, v)
			const grain = grainA(u, v)
			const grain2 = grainB(u, v)
			// a few real pits (a bubble or a pebble burnt out), not a dense pepper
			pitW(u, v, Wo)
			const pit = Wo.id > 0.985 ? 1 - sstep(0.0, 0.42, Wo.f1) : 0
			// sand grains of the moulding sand: pale and dark specks about half a millimetre across
			const sandHi = sstep(0.86, 0.95, sandH(u, v))
			const sandLo = sstep(0.86, 0.95, sandL(u, v))
			const burn = sstep(0.5, 0.76, burnN(u, v))
			const flash = sstep(0.62, 0.8, flashN(u, v)) // drawn-out darker flashes
			const pale = sstep(0.9, 0.97, paleN(u, v))
			const drag = dragN ? dragN(u, v) - 0.5 : 0
			// a kiss mark: where two bricks touched in the kiln stack, one darker diagonal band, present along only part of the tile (so the
			// per-brick offsets give some bricks a band, some none; periodic, so the tile still wraps)
			let kiss = 0
			if (kissWarp) {
				const q = (((u + v + 0.3 + 0.08 * (kissWarp(u, v) - 0.5)) % 1) + 1) % 1
				kiss = (1 - sstep(0.03, 0.12, Math.abs(q - 0.5))) * sstep(0.45, 0.7, kissPatch(u, v))
			}
			let c = lerp3(P.a, P.b, clamp01(tone * 1.6 - 0.4 + tone2 * 0.3 - 0.1))
			c = lerp3(c, P.dark, Math.max(burn * 0.38, flash * 0.45, kiss * 0.5))
			c = lerp3(c, P.pale, pale * 0.3)
			const m = (0.9 + P.grain * (grain - 0.5) + 0.12 * (grain2 - 0.5)) * (1 - 0.3 * pit) * (1 + 0.16 * drag) * (1 + 0.18 * sandHi - 0.25 * sandLo)
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
			const S = clayTile(kind, "stretcher"), B = clayTile(kind, "bed")
			const tint = solid.color ?? "#ffffff"
			const mk = (b, face) => matOf(`clay4|${kind}|${face}|${tint}`, b, { color: tint, roughness: CLAYS[kind].rough, normalScale: new THREE.Vector2(1.1, 1.1) })
			const tile = {
				pz: [0.23, 0.072], nz: [0.23, 0.072, 0.13, 0.2], px: [0.23, 0.072, 0.37, 0.5], nx: [0.23, 0.072, 0.8, 0.1], py: [0.23, 0.115], ny: [0.23, 0.115, 0.4, 0.3],
			}
			const W = w + 2 * SKIN_M, H = h + 2 * SKIN_M
			const half = [W / 2, H / 2, d / 2]
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
			const cell = frog ? 0.0031 : 0.004
			const seg = [Math.min(84, Math.max(2, Math.round(W / cell))), Math.min(30, Math.max(2, Math.round(H / 0.004))), Math.min(40, Math.max(2, Math.round(d / cell)))]
			const geo = softBox(W, H, d, Math.min(0.0016, 0.1 * Math.min(w, h, d)), { seg, k: 3, tile, disp })
			const mS = mk(S, "s"), mB = mk(B, "b")
			const proto = kit.group(mesh(geo, [mS, mS, mB, mB, mS, mS]))
			// every brick gets its own burn marks, kiss band and kiln tone: the side tiles are periodic, so they can be shifted and mirrored freely
			return perInstance(proto, (mesh, hsh) => {
				const vi = hsh % 12
				const ou = frac(vi, 1), ov = frac(vi, 2)
				const fx = frac(vi, 3) < 0.5, fy = frac(vi, 4) < 0.5
				const k = 0.93 + 0.14 * frac(vi, 5)
				const tint = [k * (0.97 + 0.06 * frac(vi, 6)), k, k * (0.97 + 0.06 * frac(vi, 7))]
				const key = `b${vi}`
				return [mS, mS, mB, mB, mS, mS].map((m, i) => (i === 2 || i === 3 ? variantOf(m, key, { tint }) : variantOf(m, key, { ou, ov, fx, fy, tint })))
			})
		}
	}

	// ------------------------------------------------------------------------------------------ foam
	// cut polyurethane foam: open cells about 1.5 mm across, thin struts, dark holes. One 10 x 5 cm tile at 5 px/mm that repeats.
	const FOAM_T = [0.1, 0.05]
	function foamTile() {
		const Wa = {}, Wb = {}
		const wa = worleyS(64, 32, 17), wb = worleyS(90, 45, 19) // cells of about 1.6 mm, and smaller ones of 1.1 mm: the foam's cell size drifts from place to place
		const kN = pfbmS(2, 1, 7, 3), shadeN = pfbmS(2, 1, 8, 3), idN = pnS(165, 82, 29)
		return bake("foam5", 512, 256, (u, v, o) => {
			wa(u, v, Wa)
			wb(u, v, Wb)
			const k = sstep(0.35, 0.65, kN(u, v))
			// e2 = how far the point is from the nearest wall between two cells (0 on a strut, about 1 mid-cell): the cell's depth follows it,
			// so each pore is a bowl with sloped walls and the struts stay the high, pale network
			const e2 = mix(Wa.f2 - Wa.f1, Wb.f2 - Wb.f1, k)
			const cell = sstep(0.05, 0.2, e2) // 0 on a strut (a pixel and a half wide), 1 inside a cell
			const depth = cell * sstep(0.06, 0.45, e2) // 0 at the rim, 1 on the floor of the pore
			const ridge = 1 - Math.abs(2 * idN(u, v) - 1)
			const back = sstep(0.82, 0.96, ridge) * cell // struts of the cells behind, seen through the pore
			const web = [250, 232, 142]
			const hole = [224, 192, 94]
			let c = lerp3(web, hole, cell * (0.3 + 0.25 * Wa.id) + 0.25 * depth)
			c = lerp3(c, [188, 152, 64], depth * 0.4)
			c = lerp3(c, [web[0] * 0.8, web[1] * 0.8, web[2] * 0.8], back * 0.5 * depth)
			const m = (0.98 + 0.1 * (shadeN(u, v) - 0.5)) * (0.97 + 0.06 * Wb.id) * (1 - 0.12 * depth)
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = 1 - cell * (0.55 + 0.45 * sstep(0.04, 0.4, e2))
		}, { normal: 6 })
	}
	function blockFoam({ w, h, d, solid }) {
		const b = foamTile()
		const tint = solid.color ?? "#ffffff"
		const m = matOf(`foam5|${tint}`, b, { color: tint, roughness: 0.96, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color("#fff0a0"), normalScale: new THREE.Vector2(1.4, 1.4) })
		// cut foam: slow undulation, and a ragged edge where the knife met the cell walls
		const W = w + 2 * SKIN_M, H = h + 2 * SKIN_M
		const half = [W / 2, H / 2, d / 2]
		const disp = (x, y, z) => {
			const m3 = [half[0] - Math.abs(x), half[1] - Math.abs(y), half[2] - Math.abs(z)].sort((a, c) => a - c)
			const edge = 1 - sstep(0.0, 0.004, Math.max(0, m3[1]))
			const bites = sstep(0.42, 0.72, fbm3(x * 330, y * 330, z * 330, 21, 2))
			return -(fbm3(x * 14, y * 14, z * 14, 11, 2)) * 0.0011 - 0.0007 * edge * bites - 0.0002 * fbm3(x * 160, y * 160, z * 160, 23, 2)
		}
		const seg = [Math.min(64, Math.max(2, Math.round(W / 0.004))), Math.min(40, Math.max(2, Math.round(H / 0.004))), Math.min(40, Math.max(2, Math.round(d / 0.004)))]
		const geo = softBox(W, H, d, Math.min(0.0024, 0.12 * Math.min(w, h, d)), { seg, k: 4, tile: sixTiles(FOAM_T, FOAM_T), disp })
		return kit.group(mesh(geo, m))
	}
	// ------------------------------------------------------------------------------------------ steel (machined, chamfered)
	function steelTile() {
		const sN = pnS(6, 900, 3), s2N = pnS(24, 380, 5), scrN = pnS(9, 1000, 7), mottN = pfbmS(2, 2, 9, 3)
		return bake("steel-brushed3", 768, 768, (u, v, o) => {
			const streak = sN(u, v) - 0.5
			const streak2 = s2N(u, v) - 0.5
			const scr = sstep(0.95, 0.995, scrN(u, v))
			const mott = mottN(u, v)
			const m = clamp01(0.9 + 0.05 * (streak * 0.7 + streak2 * 0.5) * 2 + 0.05 * (mott - 0.5) + 0.12 * scr)
			o.r = o.g = o.b = 255 * m
			o.h = 0.5 + streak * 0.3 + streak2 * 0.15 - scr * 0.25
			o.rough = clamp01(0.16 + 0.05 * (streak2 * 2 * 0.6 + streak * 2 * 0.4) + 0.04 * (0.5 - mott) - 0.06 * scr)
		}, { normal: 2, rough: true })
	}
	/** The machined steel face material (brushed, anisotropic highlight, warm table reflection). */
	// the soft light box of a catalog card, as a tone on a flat metal face (uTable is 0 off the table): lighter facing up, darker toward the right, so a cube's
	// three faces read as three planes of steel and not one grey
	const STEEL_STUDIO = "{ float up = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0); float lf = clamp(0.5 - normal.x * 0.5, 0.0, 1.0); outgoingLight *= mix(0.7 + 0.42 * up + 0.16 * lf, 1.0, uTable); }"
	function steelFace() {
		const m = M("steel-face4", { map: steelTile().map, normalMap: steelTile().normalMap, roughnessMap: steelTile().roughMap, color: new THREE.Color("#b9bdc3"), metalness: 1, roughness: 1, anisotropy: 0.6, envMapIntensity: 0.9, normalScale: new THREE.Vector2(0.5, 0.5) }, true, STEEL_STUDIO)
		// on a catalog card (no solid id) the steel gets 1.6x the studio reflection and a little less roughness, so it reads as polished metal
		m.userData.cardTweak ??= { env0: 0.9, env1: 1.44, rough0: 1, rough1: 0.9, scene: true }
		return m
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
		// on a catalog card the engraving is a shade darker than the steel round it, so the weight can be read at card size
		decal.userData.cardTweak ??= { env0: 0.9, env1: 0.9, rough0: 1, rough1: 1, color0: new THREE.Color("#b9bdc3"), color1: new THREE.Color("#50545b"), scene: true }
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
		const geo = chamferBox(w + 2 * SKIN_M, h + 2 * SKIN_M, d, c, tile)
		const body = mesh(geo, [face, face, face, face, face, face, edge])
		const lw = 0.36 * Math.min(w, h), lh = lw * 0.5
		const lines = [{ text: label, size: 190, spacing: 3 }, { text: "M1", size: 66, weight: 700, spacing: 8 }]
		const front = stamp(lines, lw, lh, `${label}`)
		front.position.set(0, 0, d / 2 + 0.00004)
		const back = front.clone()
		back.position.set(0, 0, -d / 2 - 0.00004)
		back.rotation.y = Math.PI
		const top = front.clone()
		top.position.set(0, h / 2 + SKIN_M + 0.00004, 0)
		top.rotation.x = -Math.PI / 2
		return kit.group(body, front, back, top)
	}
	addModel("steel-weight-1kg", "weight", steelWeight)
	addModel("steel-weight-5kg", "weight", steelWeight)

	// ------------------------------------------------------------------------------------------ ice cube (and glass)
	function frostTex() {
		const edgeN = pfbmS(5, 5, 5, 3), patchN = pfbmS(3, 3, 7, 3), fineN = pfbmS(24, 24, 3, 2)
		return bake("ice-frost2", 256, 256, (u, v, o) => {
			const e = Math.min(u, 1 - u, v, 1 - v)
			const edge = 1 - sstep(0.0, 0.16, e + (edgeN(u, v) - 0.5) * 0.14)
			const patch = sstep(0.6, 0.85, patchN(u, v)) * 0.4
			const fine = fineN(u, v)
			const mask = clamp01(Math.max(edge * 0.55, patch) * (0.8 + 0.4 * fine))
			o.r = o.g = o.b = 255 * mask
			o.rough = 0.03 + 0.7 * mask
		}, { rough: true, wrap: false })
	}
	function cloudTex() {
		const cN = pfbmS(5, 3, 9, 4)
		return bake("ice-cloud2", 256, 128, (u, v, o) => {
			const f = cN(u, v)
			o.r = o.g = o.b = 255
			o.rough = 0.03 + 0.8 * sstep(0.3, 0.7, f)
		}, { rough: true })
	}
	/** Alpha ramp for a fracture sheet, indexed by "rim" (0 at the middle, 1 on the polygon's edge): a faint body and a thin, soft edge. */
	function crackRamp() {
		return kit.tex("blocks|ice-crack-ramp2", 256, 4, (g, W, H) => {
			const img = new ImageData(W, H)
			for (let x = 0; x < W; x++) {
				const t = x / (W - 1)
				const a = 0.06 + 0.03 * Math.sin(t * 22) * Math.sin(t * 22) * (1 - t) + 0.12 * Math.pow(sstep(0.8, 1.0, t), 1.6)
				for (let y = 0; y < H; y++) {
					const i = (y * W + x) * 4
					img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, a * 255)
					img.data[i + 3] = 255
				}
			}
			g.putImageData(img, 0, 0)
		}, { data: true, wrap: false })
	}
	/** Alpha for a feather sheet (the G channel): u = rim (0 at the middle, 1 on the polygon's edge), v = the way round; dense white in the middle, streaking out along the rays, nothing left at the edge, so the sheet's outline never shows. */
	function featherTex() {
		const sN = pnS(2, 26, 97), tN = pnS(5, 9, 98)
		return bake("ice-feather2", 128, 256, (u, v, o) => {
			const streak = sstep(0.25, 0.8, sN(u, v) * 0.75 + 0.25 * tN(u, v))
			o.r = o.g = o.b = 255
			o.rough = Math.pow(1 - sstep(0.0, 1.0, u), 1.4) * (0.25 + 0.75 * streak)
		}, { rough: true, wrap: false })
	}
	/** A flat sheet through the cube: a fan over a polygon whose corners are given as fractions of the cube (-0.5..0.5); uv.x = 0 in the middle, 1 on the edge. */
	function sheetGeo(pts, w, h, d, key) {
		return kit.geo(`blocks|icesheet2|${key}|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`, () => {
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
	/** A fracture's outline: a ragged, nearly vertical plane through the cloudy core up to the top face, 48 corners with a jittered radius (fractions of the cube). */
	function crackPoints() {
		const e1 = [0.12, 0.98, 0.1]
		const l1 = Math.hypot(...e1)
		e1[0] /= l1; e1[1] /= l1; e1[2] /= l1
		let e2 = [-0.1, 0.0, 1.0]
		const dp = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]
		e2 = e2.map((x, i) => x - dp * e1[i])
		const l2 = Math.hypot(...e2)
		e2 = e2.map((x) => x / l2)
		const c = [0.08, 0.04, 0.0]
		const pts = []
		const N = 48
		for (let i = 0; i < N; i++) {
			const a = (i / N) * Math.PI * 2
			const jag = 0.8 + 0.32 * fbm3(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, 3.3, 91, 3) + 0.06 * (h3(i, 1, 55) - 0.5)
			const r1 = 0.43 * jag, r2 = 0.3 * jag
			const p = [0, 1, 2].map((k) => c[k] + e1[k] * Math.cos(a) * r1 + e2[k] * Math.sin(a) * r2)
			const m = Math.max(Math.abs(p[0]) / 0.46, Math.abs(p[1]) / 0.47, Math.abs(p[2]) / 0.46)
			pts.push(m > 1 ? p.map((x) => x / m) : p)
		}
		return pts
	}
	const FADE_EDGE = "{ float vn = abs(dot(normalize(normal), normalize(vViewPosition))); diffuseColor.a *= pow(vn, 1.0); }"
	const FADE_FLASH = "{ float vn = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition))); diffuseColor.a *= 0.02 + 0.98 * pow(vn, 1.7); }"
	const FADE_RIM = "{ float vn = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition))); diffuseColor.a *= 0.15 + 0.85 * pow(vn, 1.3); }"
	let iceDepthMat = null
	/** The shadow depth of an ice shell: only about a third of the shadow map's texels are written, so the shadow is light and soft (PCF averages the hash). */
	function iceDepth() {
		if (!iceDepthMat) {
			const a = kit.tex("blocks|ice-shadow-alpha", 4, 4, (g) => {
				g.fillStyle = "rgb(0,92,0)"
				g.fillRect(0, 0, 4, 4)
			}, { data: true, wrap: false })
			iceDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: a, alphaHash: true })
		}
		return iceDepthMat
	}
	let contactTex = null
	function iceContact() {
		return (contactTex ??= kit.tex("blocks|ice-contact", 64, 64, (g, W, H) => {
			const img = new ImageData(W, H)
			for (let y = 0; y < H; y++) {
				for (let x = 0; x < W; x++) {
					const r = Math.hypot((x + 0.5) / W - 0.5, (y + 0.5) / H - 0.5) * 2
					const a = Math.pow(1 - sstep(0.25, 1.0, r), 1.4)
					const i = (y * W + x) * 4
					img.data[i] = img.data[i + 1] = img.data[i + 2] = a * 255
					img.data[i + 3] = 255
				}
			}
			g.putImageData(img, 0, 0)
		}, { data: true, wrap: false }))
	}
	/** The shell of an ice (or glass) piece: the transmissive shell that casts a light shadow. A catalog photo is taken over an opaque card colour, so the real shell has something to refract there too.
	 *  Ice is frosted and faintly blue-white (freezer ice, a few centimetres tinted through): it reads as ice on a white plate, not as a glass block. */
	function iceShell(glass, geo, F = frostTex()) {
		const shell = M(`ice-shell3|${glass}`, glass
			? { color: new THREE.Color("#ffffff"), roughness: 0.02, metalness: 0, transmission: 1, thickness: 0.02, ior: 1.5, attenuationColor: new THREE.Color("#cfeee6"), attenuationDistance: 0.12, envMapIntensity: 0.9 }
			: { color: new THREE.Color("#ffffff"), roughness: 1, roughnessMap: F.roughMap, metalness: 0, transmission: 0.82, thickness: 0.03, ior: 1.31, attenuationColor: new THREE.Color("#8cc3e8"), attenuationDistance: 0.07, envMapIntensity: 0.9 }, true)
		shell.depthWrite = false // so the translucent cloud and fractures inside still draw over it
		const shellMesh = kit.mesh(geo, shell, { cast: true })
		shellMesh.customDepthMaterial = iceDepth()
		return [shellMesh]
	}
	/** Hang the ice's per-draw decision on a built model: the contact shadow under the base is for a scene with a table (view3d tags every mesh with its solid's id); a catalog photo makes its own shadow. */
	function iceFinish(proto) {
		const decide = function (force) {
			const tagged = this.children[0].userData.solidId !== undefined
			if (this.userData.iceScene !== tagged) {
				this.userData.iceScene = tagged
				for (const c of this.children) if (c.userData.sceneOnly) c.visible = tagged
			}
			THREE.Group.prototype.updateMatrixWorld.call(this, force)
		}
		const baseClone = proto.clone
		proto.clone = function (recursive) {
			const c = baseClone.call(this, recursive)
			// Object3D.copy leaves out customDepthMaterial and the decider
			const src = this.children, dst = c.children
			for (let i = 0; i < src.length; i++) if (src[i].customDepthMaterial) dst[i].customDepthMaterial = src[i].customDepthMaterial
			c.updateMatrixWorld = decide
			return c
		}
		return proto
	}
	/** The inside of a piece of ice: the cloudy core with its halo, feathers, trapped bubbles and a fracture, all inside a w x h x d box centred on the origin. Returns the meshes. */
	function iceInside(w, h, d) {
		const inner = []
		const s = Math.min(w, h, d)
		const sc = s / 0.04
		// the cloudy core of a cube frozen from the outside in: a soft feathery haze, low in the middle, never nearer than about 6 mm to a face
		const cl = cloudTex()
		const coreMat = M("ice-core2", { color: new THREE.Color("#f6fbff"), roughness: 0.9, metalness: 0, alphaMap: cl.roughMap, transparent: true, opacity: 0.85, depthWrite: false }, false, FADE_EDGE)
		const blobs = [[0, 0, 0, 0.26], [0.13, -0.04, 0.065, 0.156], [-0.13, 0.026, -0.065, 0.156], [0.026, 0.104, -0.117, 0.13], [-0.04, -0.09, 0.13, 0.143]]
		const coreGeoOf = (f, key) => kit.geo(`blocks|icecore2|${key}|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`, () => {
			const list = []
			blobs.forEach(([bx, by, bz, br], bi) => {
				const g = new THREE.SphereGeometry(br * f * s, 24, 16)
				const p = g.attributes.position
				for (let i = 0; i < p.count; i++) {
					const k = 1 + 0.45 * (fbm3(p.getX(i) * 150 + bi * 7, p.getY(i) * 150, p.getZ(i) * 150, 8, 2) - 0.5)
					p.setXYZ(i, p.getX(i) * k + bx * f * s, p.getY(i) * k * 0.7 + by * f * s - 0.12 * h, p.getZ(i) * k + bz * f * s)
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
		inner.push(halo)
		const core = kit.mesh(coreGeo, coreMat, { cast: false })
		core.renderOrder = 1
		inner.push(core)
		// feathers: the white of a cube frozen from the outside in streams from the core toward the corners, thin ragged sheets standing in the diagonal planes
		const featherGeo = kit.geo(`blocks|icefeather|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`, () => {
			const list = []
			;[[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sz], si) => {
				const base = [[0, 0.2], [0.2, 0.25], [0.4, 0.13], [0.55, -0.08], [0.53, -0.34], [0.35, -0.42], [0.16, -0.3], [0, -0.16]]
				const pts = base.map(([t, y], i) => {
					const j = 1 + 0.18 * (h3(si, i, 71) - 0.5) * 2
					const tt = t * j * 0.7071
					return [sx * tt * (0.92 + 0.16 * h3(si, i, 72)), (y + 0.06 * (h3(si, i, 73) - 0.5)) * 0.9 - 0.04, sz * tt * (0.92 + 0.16 * h3(si, i, 74))]
				})
				const c = [0, 0, 0]
				for (const p of pts) for (let q = 0; q < 3; q++) c[q] += p[q] / pts.length
				const pos = [c[0] * w, c[1] * h, c[2] * d], uv = [0, 0.5]
				pts.forEach((p, i) => {
					pos.push(p[0] * w, p[1] * h, p[2] * d)
					uv.push(1, (i + 0.5) / pts.length)
				})
				const idx = []
				for (let i = 0; i < pts.length; i++) idx.push(0, 1 + i, 1 + ((i + 1) % pts.length))
				const g = new THREE.BufferGeometry()
				g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
				g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
				g.setIndex(idx)
				g.computeVertexNormals()
				list.push(g)
			})
			return mergeGeometries(list, false)
		})
		const feather = kit.mesh(featherGeo, M("ice-feather", { color: new THREE.Color("#f6fbff"), roughness: 0.9, metalness: 0, alphaMap: featherTex().roughMap, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }, false, FADE_EDGE), { cast: false })
		feather.renderOrder = 1
		inner.push(feather)
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
		inner.push(kit.mesh(bubbleGeo(0.75, "in"), M("ice-bubble2", { color: new THREE.Color("#f4faff"), roughness: 0.05, metalness: 0, envMapIntensity: 2 }), { cast: false }))
		const rim = kit.mesh(bubbleGeo(1.25, "out"), M("ice-bubble-rim", { color: new THREE.Color("#5f6f7a"), roughness: 0.4, metalness: 0, transparent: true, opacity: 0.8, depthWrite: false }, false, FADE_RIM), { cast: false })
		rim.renderOrder = 3
		inner.push(rim)
		// a fracture: a ragged, nearly vertical sheet through the core that only shows at glancing angles
		const cm = M("ice-crack3", { color: new THREE.Color("#ffffff"), roughness: 0.05, metalness: 0, alphaMap: crackRamp(), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 3 }, true, FADE_FLASH)
		const sheet = kit.mesh(sheetGeo(crackPoints(), w, h, d, "s0"), cm, { cast: false })
		sheet.renderOrder = 2
		inner.push(sheet)
		return inner
	}
	/** Each piece of ice turns its inside (core, bubbles, fracture) about the vertical, and may mirror it, by a hash of its solid's id: two pieces are never twins. */
	function iceVary(proto) {
		return perInstance(proto, (mesh, hsh) => {
			const g = mesh.parent
			if (g?.userData.iceInside && !g.userData.iceVaried) {
				g.userData.iceVaried = true
				g.rotation.y = (hsh & 1) * Math.PI
				g.scale.x = hsh & 2 ? -1 : 1
				g.updateMatrix()
				g.updateMatrixWorld(true)
			}
			return null
		})
	}
	function blockIce({ w, h, d, solid }) {
		const glass = solid.look === "glass"
		const r = Math.min(0.0022, 0.11 * Math.min(w, h, d))
		const W = w + 2 * SKIN_M, H = h + 2 * SKIN_M
		const F = frostTex()
		const shellGeo = softBox(W, H, d, r, { seg: [3, 3, 3], k: 4, disp: (x, y, z) => (fbm3(x * 60, y * 60, z * 60, 4, 2) - 0.5) * 0.0005 })
		const parts = iceShell(glass, shellGeo, F)
		const inner = []
		if (!glass) {
			const s = Math.min(w, h, d)
			const sc = s / 0.04
			// frost: a white skin just under the surface, thicker toward the edges and in patches (hashed transparency)
			const frostGeo = softBox(W + 0.0002, H + 0.0002, d + 0.0002, r + 0.0001, { seg: [1, 1, 1], k: 4 })
			const frost = M("ice-frost", { color: new THREE.Color("#f4faff"), emissive: new THREE.Color("#d9ecf8"), emissiveIntensity: 0.3, roughness: 0.9, metalness: 0, alphaMap: F.roughMap, transparent: true, opacity: 0.6, depthWrite: false })
			const frostMesh = kit.mesh(frostGeo, frost, { cast: false })
			frostMesh.renderOrder = 4
			parts.push(frostMesh)
			// the body is a little milky all through
			const milk = M("ice-milk", { color: new THREE.Color("#e6f3fc"), emissive: new THREE.Color("#cfe6fa"), emissiveIntensity: 0.3, roughness: 1, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false })
			const milkMesh = kit.mesh(softBox(W - 0.0016, H - 0.0016, d - 0.0016, Math.max(0.0004, r - 0.0008), { seg: [1, 1, 1], k: 3 }), milk, { cast: false })
			milkMesh.renderOrder = 0
			parts.push(milkMesh)
			// a faint contact shadow on the table seen through the base: the cube hides what the table's own shadow would be
			const contact = new THREE.Mesh(kit.geo(`blocks|icecontact|${w.toFixed(4)}|${d.toFixed(4)}`, () => new THREE.PlaneGeometry(w - 2 * r, d - 2 * r).rotateX(-Math.PI / 2)),
				M("ice-contact", { color: new THREE.Color("#050505"), alphaMap: iceContact(), transparent: true, opacity: 0.12, roughness: 1, metalness: 0, depthWrite: false }))
			contact.position.y = -H / 2 + 0.0003
			contact.renderOrder = 1
			contact.userData.sceneOnly = true // shown in a scene only (a catalog card has no table for the shadow to lie on)
			parts.push(contact)
			inner.push(...iceInside(w, h, d))
		}
		// the inside (core, bubbles, fracture) is its own group: each cube turns it about the vertical and may mirror it, so two cubes are never twins
		const insideGroup = kit.group(...inner)
		insideGroup.userData.iceInside = true
		const proto = kit.group(...parts, insideGroup)
		iceVary(proto)
		iceFinish(proto)
		return proto
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
	/**
	 * Plain corrugated kraft liner, no print: flutes (a whole number of them) ripple across u and run along v, fibres and flecks, every noise lattice
	 * an integer count so the tile repeats without a seam. It is laid on all six faces of a box at its real size (Tx x Ty metres), so it keeps its
	 * scale however the box is resized, and the printed ink is a separate decal.
	 */
	function kraftPlain(Tx, Ty, W, H, seed) {
		const fx = (m) => Math.max(1, Math.round(Tx / m)), fy = (m) => Math.max(1, Math.round(Ty / m))
		const nFl = Math.round(Tx / 0.0065)
		const mottN = pfbmS(fx(0.07), fy(0.07), seed, 4), fibreN = pnS(fx(0.0022), fy(0.0009), seed + 3), fibre2N = pnS(fx(0.0006), fy(0.0014), seed + 5)
		const fleckN = pnS(fx(0.0012), fy(0.0012), seed + 7), ripN = pnS(3, 2, seed + 9)
		return bake(`kraft3|plain`, W, H, (u, v, o) => {
			const mott = mottN(u, v)
			const fibre = fibreN(u, v)
			const fibre2 = fibre2N(u, v)
			const fleck = sstep(0.88, 0.96, fleckN(u, v))
			const rip = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * nFl + (ripN(u, v) - 0.5) * 2)
			const m = 0.9 + 0.14 * (mott - 0.5) * 2 * 0.5 + 0.1 * (fibre - 0.5) + 0.07 * (fibre2 - 0.5) + 0.03 * (rip - 0.5)
			let c = lerp3([186, 142, 94], [170, 128, 82], clamp01(mott * 1.3 - 0.2))
			c = lerp3(c, [112, 80, 52], fleck * 0.5)
			o.r = c[0] * m
			o.g = c[1] * m
			o.b = c[2] * m
			o.h = 0.5 + 0.18 * (rip - 0.5) + 0.12 * (fibre - 0.5) + 0.06 * (fibre2 - 0.5)
		}, { normal: 3, wrap: true })
	}
	/**
	 * The printed ink of one carton panel as an alpha map (the green channel, clamped, 0 all round): the print covers Tx x Ty metres at W x H pixels, the
	 * ink a little uneven. It is laid as a decal on the plain liner, so a bigger box does not stretch it and a smaller one scales the whole print down.
	 */
	const inkTiles = new Map()
	function kraftInk(name, Tx, Ty, W, H, print, seed, dw, dh) {
		let hit = inkTiles.get(name)
		if (hit) return hit
		const mask = maskOf(W, H, (g) => { g.save(); g.scale(W / dw, H / dh); print(g, dw, dh); g.restore() })
		const fx = (m) => Math.max(1, Math.round(Tx / m)), fy = (m) => Math.max(1, Math.round(Ty / m))
		const inkN = pnS(fx(0.0014), fy(0.0014), seed + 11)
		const t = kit.tex(`blocks|kraft-ink3|${name}`, W, H, (g) => {
			const img = new ImageData(W, H)
			for (let y = 0; y < H; y++) {
				for (let x = 0; x < W; x++) {
					const a = Math.min(1, mask[y * W + x]) * 0.93 * (0.86 + 0.14 * inkN((x + 0.5) / W, 1 - (y + 0.5) / H))
					const i = (y * W + x) * 4
					img.data[i] = img.data[i + 1] = img.data[i + 2] = a * 255
					img.data[i + 3] = 255
				}
			}
			g.putImageData(img, 0, 0)
		}, { data: true, wrap: false })
		t.channel = 1 // the decal's uv1 runs 0..1 over the print; uv carries the liner's own tile
		inkTiles.set(name, t)
		return t
	}
	/** Packing-tape detail along its path (u, 0.512 m) and width (v, 0.064 m): lengthwise wrinkles and a few cross creases; roughMap carries its alpha. */
	function tapeTex() {
		const wrN = pnS(4, 70, 3), wr2N = pnS(12, 28, 5), wobN = pnS(2, 8, 7)
		return bake("tape-detail", 1024, 128, (u, v, o) => {
			const wr = wrN(u, v) - 0.5
			const wr2 = wr2N(u, v) - 0.5
			let crease = 0
			for (const [cu, tilt] of [[0.18, 0.04], [0.43, -0.03], [0.77, 0.05]]) {
				const wob = (wobN(u, v) - 0.5) * 0.01
				const du = Math.abs(u - (cu + tilt * (v - 0.5) + wob))
				crease = Math.max(crease, 1 - sstep(0.0, 0.003, du))
			}
			o.r = o.g = o.b = 255 * clamp01(0.96 + 0.06 * wr2 + 0.1 * crease)
			o.h = 0.5 + 0.22 * wr + 0.14 * wr2 + 0.5 * crease
			o.rough = clamp01(0.88 + 0.14 * crease + 0.05 * wr2) // alpha: a creased tape scatters a little more light
		}, { normal: 3, rough: true })
	}
	function cardboardBox({ w, h, d, solid }) {
		const plain = kraftPlain(0.3, 0.2, 600, 400, 1) // 2 px/mm, one tile on all six faces
		const tint = solid.color ?? "#ffffff"
		const liner = matOf(`kraft3|${tint}`, plain, { color: tint, roughness: 0.94, normalScale: new THREE.Vector2(0.9, 0.9) })
		const W = w + 2 * SKIN_M, H = h + 2 * SKIN_M
		const half = [W / 2, H / 2, d / 2]
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
		const seg = [Math.min(24, Math.max(2, Math.round(W / 0.012))), Math.min(18, Math.max(2, Math.round(H / 0.012))), Math.min(18, Math.max(2, Math.round(d / 0.012)))]
		// the same real-size liner tile on every face, each laid at its own offset so no two faces show the same flecks
		const tile = {
			pz: [0.3, 0.2, 0.17, 0.31], nz: [0.3, 0.2, 0.63, 0.12], px: [0.3, 0.2, 0.41, 0.73], nx: [0.3, 0.2, 0.86, 0.46], py: [0.3, 0.2, 0.52, 0.9], ny: [0.3, 0.2, 0.27, 0.58],
		}
		const geo = softBox(W, H, d, Math.min(0.0026, 0.1 * Math.min(w, h, d)), { seg, k: 4, tile, disp })
		const parts = [mesh(geo, liner)]
		// the printed panels: ink decals 0.1 mm off the (sagging) face, laid on the liner at the print's real size (30 x 20 cm on the two big faces, 20 x 20 on the
		// ends), shrunk to fit a face smaller than that and left out of one under 0.3 of it
		const printOn = (face, name, pw, ph, print, seed, dw, dh) => {
			const F = FACES[face]
			const faceW = dims3[F.dim[0]], faceH = dims3[F.dim[1]]
			const sc = Math.min(1, faceW / pw, faceH / ph)
			if (sc < 0.29) return
			const ink = kraftInk(name, pw, ph, Math.round(pw * 2000), Math.round(ph * 2000), print, seed, dw, dh)
			const m = M(`kraft-ink3|${name}`, { color: new THREE.Color("#261e18"), roughness: 0.9, metalness: 0, normalMap: plain.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), alphaMap: ink, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
			const T = tile[face]
			const g = kit.geo(`blocks|kraftdecal3|${face}|${name}|${W.toFixed(4)}|${H.toFixed(4)}|${d.toFixed(4)}|${sc.toFixed(4)}`, () => {
				const nA = Math.max(2, Math.round((pw * sc) / 0.012)), nB = Math.max(2, Math.round((ph * sc) / 0.012))
				const pos = [], uv = [], uv1 = [], idx = []
				for (let j = 0; j <= nB; j++) {
					for (let i = 0; i <= nA; i++) {
						const a = (i / nA - 0.5) * pw * sc, b = (j / nB - 0.5) * ph * sc
						// (a, b) are metres along the face as seen from outside (see FACES): invert F.ab
						let X, Y, Z, nx = 0, nz = 0
						if (face === "pz") { X = a; Y = b; Z = half[2]; nz = 1 } else if (face === "nz") { X = -a; Y = b; Z = -half[2]; nz = -1 } else if (face === "px") { Z = -a; Y = b; X = half[0]; nx = 1 } else { Z = a; Y = b; X = -half[0]; nx = -1 }
						const o = disp(X, Y, Z, nx, 0, nz) + 0.0001
						pos.push(X + nx * o, Y, Z + nz * o)
						uv.push(0.5 + a / T[0] + T[2], 0.5 + b / T[1] + T[3])
						uv1.push(i / nA, j / nB)
					}
				}
				// (a up the row, b up the column) is counter-clockwise seen from outside by construction of FACES.ab
				for (let j = 0; j < nB; j++) for (let i = 0; i < nA; i++) {
					const q = j * (nA + 1) + i, r = q + 1, t = q + nA + 1, u = t + 1
					idx.push(q, r, t, r, u, t)
				}
				const gg = new THREE.BufferGeometry()
				gg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
				gg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
				gg.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2))
				gg.setIndex(idx)
				gg.computeVertexNormals()
				return gg
			})
			const dm = new THREE.Mesh(g, m)
			dm.castShadow = false
			dm.receiveShadow = true
			dm.renderOrder = 1
			parts.push(dm)
		}
		const dims3 = [W, H, d]
		printOn("pz", "side", 0.3, 0.2, sidePrint, 1, 900, 600)
		printOn("nz", "side", 0.3, 0.2, sidePrint, 1, 900, 600)
		printOn("px", "end", 0.2, 0.2, endPrint, 2, 600, 600)
		printOn("nx", "end", 0.2, 0.2, endPrint, 2, 600, 600)
		// the major flaps meet along the middle of the top (a dark 1.5 mm line, seen through the tape), and each end shows the minor flap's edge a little below the fold
		const rr = Math.min(0.0026, 0.1 * Math.min(w, h, d))
		const hx = W / 2, hy = H / 2
		const seamMat = M("box-seam", { color: new THREE.Color("#3a2a1c"), roughness: 1, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
		const seamTop = new THREE.Mesh(kit.geo(`blocks|seamtop|${W.toFixed(4)}`, () => new THREE.PlaneGeometry(W - 2 * rr, 0.0015).rotateX(-Math.PI / 2)), seamMat)
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
		const t = 0.0003, drop = Math.min(0.07, 0.4 * H), tw = Math.min(0.048, 0.5 * d)
		const tapeGeo = kit.geo(`blocks|tape2|${W.toFixed(4)}|${H.toFixed(4)}|${tw.toFixed(4)}`, () => {
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

	// ------------------------------------------------------------------------------------------ wall (a hardwood board on end)
	// The wall's material is varnished hardwood (or domino wood), or steel: it is drawn as what it is made of. A real wooden wall this thick is a
	// glued-up board: three staves side by side across its depth, their long grain running up the 1.4 m faces, end grain on top and bottom, a thin
	// dark glue line between the staves.
	function wallPanel({ w, h, d, solid }) {
		const W = w + 2 * SKIN_M, H = h + 2 * SKIN_M
		if (solid.look === "steel") {
			const face = steelFace()
			const tile = { pz: [...STEEL_T, 0.1, 0.2], nz: [...STEEL_T, 0.5, 0.1], px: [...STEEL_T, 0.1, 0.2], nx: [...STEEL_T, 0.4, 0.6], py: [...STEEL_T, 0.3, 0.1], ny: [...STEEL_T, 0.7, 0.3] }
			return kit.group(mesh(softBox(W, H, d, Math.min(0.0015, 0.2 * Math.min(w, d)), { tile }), face))
		}
		const kind = woodKindOf(solid.look)
		const M = woodMats(kind, { stain: solid.color ?? null })
		const n = 3, sd = d / n
		const r = Math.min(0.0006, 0.2 * Math.min(w, sd))
		const staves = []
		// a glued-up board is sanded flush: each stave is a rounded box that runs on r past each inner seam, so its rounded inner edge lies under the
		// neighbour's flat face and the faces meet edge to edge with no groove (a groove showed the glue as dotted lines). Each stave is cut from its own bit of
		// the board and a little different in tone.
		const tints = [1.0, 0.972, 1.022] // the first stave is the board's own tone
		for (let i = 0; i < n; i++) {
			const ou = 0.07 + 0.31 * i, ov = 0.5 + 0.045 * (i - 1)
			// the long grain runs along the board (u along y), the end grain keeps one tile's width per stave
			const tile = {
				px: [LONG_T[0], LONG_T[1], ou, ov, true], nx: [LONG_T[0], LONG_T[1], ou + 0.17, ov, true],
				py: [END_T[0], END_T[1], 0.2 * i, 0], ny: [END_T[0], END_T[1], 0.3 + 0.2 * i, 0],
				pz: [STRAIGHT_T[0], STRAIGHT_T[1], ou, 0.5, true], nz: [STRAIGHT_T[0], STRAIGHT_T[1], ou + 0.3, 0.5, true],
			}
			const z0 = -d / 2 + i * sd, z1 = z0 + sd
			const lo = z0 - (i > 0 ? r : 0), hi = z1 + (i < n - 1 ? r : 0)
			const t = [tints[i], tints[i], tints[i]]
			const mats = [M.long, M.long, M.end, M.end, M.straight, M.straight].map((m) => (i === 0 ? m : variantOf(m, `wall${i}`, { tint: t })))
			const m = mesh(softBox(W, H, hi - lo, r, { seg: [1, 1, 1], k: 3, tile }), mats)
			m.position.z = (lo + hi) / 2
			staves.push(m)
		}
		// the joints between staves show as a faint dark line, not as a groove: two thin strips on each broad face and on the end grain
		const seamMat = M_seam()
		const parts = [...staves]
		const seamV = kit.geo(`blocks|wallseamv|${H.toFixed(4)}`, () => new THREE.PlaneGeometry(0.00035, H - 2 * r))
		const seamH = kit.geo(`blocks|wallseamh|${W.toFixed(4)}`, () => new THREE.PlaneGeometry(W - 2 * r, 0.00035).rotateX(-Math.PI / 2))
		for (let i = 1; i < n; i++) {
			const zs = -d / 2 + i * sd
			for (const sx of [1, -1]) {
				const m = new THREE.Mesh(seamV, seamMat)
				m.position.set(sx * (W / 2 + 0.00003), 0, zs)
				m.rotation.y = sx * Math.PI / 2
				parts.push(m)
			}
			for (const sy of [1, -1]) {
				const m = new THREE.Mesh(seamH, seamMat)
				m.position.set(0, sy * (H / 2 + 0.00003), zs)
				m.rotation.x = sy > 0 ? 0 : Math.PI
				parts.push(m)
			}
		}
		for (const m of parts) if (m.geometry === seamV || m.geometry === seamH) { m.castShadow = false; m.receiveShadow = false; m.renderOrder = 1 }
		return kit.group(...parts)
	}
	const M_seam = () => M("wall-seam", { color: new THREE.Color("#6b4a2e"), roughness: 1, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
	addModel("wall", "wall", wallPanel)

	// ------------------------------------------------------------------------------------------ wedge (a door stop)
	/** The outline `pts` (counter-clockwise {x, y}) grown by `grow` metres on every side with its corners rounded to radius r: the Minkowski sum of the inward-offset polygon and a disc. */
	function roundedOutline(pts, grow, r, stepDeg = 30) {
		const n = pts.length
		const nrm = (a, b) => {
			const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
			return [(b.y - a.y) / l, -(b.x - a.x) / l]
		}
		const off = grow - r // the inner polygon's offset (negative = inward)
		const q = pts.map((p, i) => {
			const n1 = nrm(pts[(i + n - 1) % n], p), n2 = nrm(p, pts[(i + 1) % n])
			const k = off / Math.max(1e-4, 1 + n1[0] * n2[0] + n1[1] * n2[1])
			return { x: p.x + (n1[0] + n2[0]) * k, y: p.y + (n1[1] + n2[1]) * k, a1: Math.atan2(n1[1], n1[0]), a2: Math.atan2(n2[1], n2[0]) }
		})
		const out = []
		for (const p of q) {
			let da = p.a2 - p.a1
			while (da < 0) da += Math.PI * 2
			while (da > Math.PI * 2) da -= Math.PI * 2
			const steps = Math.max(1, Math.ceil((da * 180) / Math.PI / stepDeg))
			for (let i = 0; i <= steps; i++) {
				const a = p.a1 + (da * i) / steps
				out.push({ x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) })
			}
		}
		return out
	}
	/** Vertex normals of a non-indexed geometry: each corner averages (angle weighted) the faces of its position within `crease` degrees of its own face, so the small bevel steps shade round and a real corner stays crisp. */
	function creaseNormals(g, crease = 40) {
		const P = g.attributes.position.array
		const nv = P.length / 3
		const key = (i) => `${Math.round(P[i * 3] * 1e6)},${Math.round(P[i * 3 + 1] * 1e6)},${Math.round(P[i * 3 + 2] * 1e6)}`
		const faces = new Map() // position key -> [{n, a}]
		const info = []
		for (let t = 0; t < nv; t += 3) {
			const v = [0, 1, 2].map((c) => [P[(t + c) * 3], P[(t + c) * 3 + 1], P[(t + c) * 3 + 2]])
			const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2]
			const vx = v[2][0] - v[0][0], vy = v[2][1] - v[0][1], vz = v[2][2] - v[0][2]
			let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
			const nl = Math.hypot(nx, ny, nz)
			if (nl < 1e-18) {
				info.push(null)
				continue
			}
			nx /= nl; ny /= nl; nz /= nl
			const angs = [0, 1, 2].map((c) => {
				const a = v[(c + 1) % 3], b = v[(c + 2) % 3], o = v[c]
				const e1 = [a[0] - o[0], a[1] - o[1], a[2] - o[2]], e2 = [b[0] - o[0], b[1] - o[1], b[2] - o[2]]
				const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2)
				return l1 * l2 < 1e-18 ? 0 : Math.acos(Math.max(-1, Math.min(1, (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / (l1 * l2))))
			})
			info.push({ n: [nx, ny, nz], angs })
			for (let c = 0; c < 3; c++) {
				const k = key(t + c)
				let l = faces.get(k)
				if (!l) faces.set(k, (l = []))
				l.push({ n: [nx, ny, nz], a: angs[c] })
			}
		}
		const N = new Float32Array(P.length)
		const cosT = Math.cos((crease * Math.PI) / 180)
		for (let t = 0; t < nv; t += 3) {
			const f = info[t / 3]
			for (let c = 0; c < 3; c++) {
				if (!f) {
					N[(t + c) * 3 + 2] = 1
					continue
				}
				let x = 0, y = 0, z = 0
				for (const o of faces.get(key(t + c))) {
					if (o.n[0] * f.n[0] + o.n[1] * f.n[1] + o.n[2] * f.n[2] < cosT) continue
					x += o.n[0] * o.a; y += o.n[1] * o.a; z += o.n[2] * o.a
				}
				const l = Math.hypot(x, y, z) || 1
				N[(t + c) * 3] = x / l
				N[(t + c) * 3 + 1] = y / l
				N[(t + c) * 3 + 2] = z / l
			}
		}
		g.setAttribute("normal", new THREE.BufferAttribute(N, 3))
	}
	/**
	 * A right-angled prism: the outline (counter-clockwise, metres, round its own origin) extruded through `depth` (centred in z), its profile corners
	 * rounded and its two lids bevelled by b (cut inward, so the silhouette and the depth stay exact). Group 0 = the two lids, group 1 = everything round the outline.
	 * uvOf(x, y, z, arc, lid) -> [u, v]: arc = the distance along the outline from its first corner (0 .. perimeter).
	 */
	function prismGeo(outline, depth, b, uvOf) {
		const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.y)))
		const core = Math.max(1e-5, depth - 2 * b)
		const g = new THREE.ExtrudeGeometry(shape, { depth: core, steps: 1, curveSegments: 1, bevelEnabled: b > 1e-5, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2 })
		g.translate(0, 0, -core / 2)
		creaseNormals(g)
		const n = outline.length
		const cum = [0]
		for (let i = 0; i < n; i++) cum.push(cum[i] + Math.hypot(outline[(i + 1) % n].x - outline[i].x, outline[(i + 1) % n].y - outline[i].y))
		const per = cum[n]
		const arcOf = (x, y) => {
			let best = Infinity, arc = 0
			for (let i = 0; i < n; i++) {
				const a = outline[i], c = outline[(i + 1) % n]
				const ex = c.x - a.x, ey = c.y - a.y
				const l2 = ex * ex + ey * ey || 1
				const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2))
				const dd = Math.hypot(x - (a.x + t * ex), y - (a.y + t * ey))
				if (dd < best - 1e-9) {
					best = dd
					arc = cum[i] + t * Math.sqrt(l2)
				}
			}
			return arc
		}
		const P = g.attributes.position.array
		const nv = P.length / 3
		const uv = new Float32Array(nv * 2)
		for (const grp of g.groups) {
			const lid = grp.materialIndex === 0
			for (let t = grp.start; t < grp.start + grp.count; t += 3) {
				const arcs = [0, 1, 2].map((c) => (lid ? 0 : arcOf(P[(t + c) * 3], P[(t + c) * 3 + 1])))
				if (!lid) {
					const lo = Math.min(...arcs), hi = Math.max(...arcs)
					if (hi - lo > per / 2) for (let c = 0; c < 3; c++) if (arcs[c] < per / 2) arcs[c] += per // a triangle across the seam at the first corner
				}
				for (let c = 0; c < 3; c++) {
					const i = t + c
					const [u, v] = uvOf(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], arcs[c], lid)
					uv[i * 2] = u
					uv[i * 2 + 1] = v
				}
			}
		}
		g.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
		g.computeBoundingSphere()
		g.computeBoundingBox()
		return g
	}
	// ice (or glass) on the prism: the cube's layers made from the outline
	const FROST_S = 0.04 // the cube's size: the frost's edge band is a fraction of a 4 cm face, and stays that wide in metres on any piece
	/** A frost-texture coordinate 0..0.5 from e, the distance (m) to the nearest end of a stretch whose half length is `half`: the first 1 cm keeps the cube's edge band, the rest spans the middle of the texture. */
	function frostMap(e, half) {
		const Z = 0.25 * FROST_S
		if (e <= Z || half <= Z) return Math.min(0.5, e / FROST_S)
		return 0.25 + (0.25 * (e - Z)) / (half - Z)
	}
	/** The same for a position pos along a stretch of length L (0..1, mirrored about the middle: a monotone coordinate with no seam). */
	const frostPos = (pos, L) => (pos < L / 2 ? frostMap(pos, L / 2) : 1 - frostMap(L - pos, L / 2))
	function wedgeIce({ pts, depth, r, b, x0, y0, bw, bh, glass }) {
		const n = pts.length
		const sideLen = pts.map((p, i) => Math.hypot(pts[(i + 1) % n].x - p.x, pts[(i + 1) % n].y - p.y))
		// texture coordinates the cube's way: the frost's edge term (u or v near 0) whitens every edge of a face. Each straight face runs 0..1 along itself
		// (its corners, and the rounded bits at them, being its ends) and 0..1 across the depth; the two lids are laid flat over the bounding box
		const uvOf = (x, y, z, arc, lid) => {
			if (lid) return [frostPos(x - x0, bw), frostPos(y - y0, bh)]
			let best = Infinity, e = 0, L = 1
			for (let i = 0; i < n; i++) {
				const a = pts[i], c = pts[(i + 1) % n]
				const ex = c.x - a.x, ey = c.y - a.y
				const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey || 1)))
				const dd = Math.hypot(x - (a.x + t * ex), y - (a.y + t * ey))
				if (dd < best - 1e-9) {
					best = dd
					L = sideLen[i]
					e = Math.min(t, 1 - t) * L
				}
			}
			return [frostMap(e, L / 2), frostMap(Math.max(0, depth / 2 - Math.abs(z)), depth / 2)]
		}
		const F = frostTex()
		const geo = prismGeo(roundedOutline(pts, SKIN_M, r), depth, b, uvOf)
		const parts = iceShell(glass, geo, F)
		const inner = []
		let centre = [0, 0]
		if (!glass) {
			const frost = M("ice-frost", { color: new THREE.Color("#f4faff"), emissive: new THREE.Color("#d9ecf8"), emissiveIntensity: 0.3, roughness: 0.9, metalness: 0, alphaMap: F.roughMap, transparent: true, opacity: 0.6, depthWrite: false })
			const frostMesh = kit.mesh(prismGeo(roundedOutline(pts, SKIN_M + 0.0001, r + 0.0001), depth + 0.0002, b, uvOf), frost, { cast: false })
			frostMesh.renderOrder = 4
			parts.push(frostMesh)
			const milk = M("ice-milk", { color: new THREE.Color("#e6f3fc"), emissive: new THREE.Color("#cfe6fa"), emissiveIntensity: 0.3, roughness: 1, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false })
			const rm = Math.max(0.0004, r - 0.0008)
			const milkMesh = kit.mesh(prismGeo(roundedOutline(pts, SKIN_M - 0.0008, rm), depth - 0.0016, 0.65 * rm, () => [0.5, 0.5]), milk, { cast: false })
			milkMesh.renderOrder = 0
			parts.push(milkMesh)
			// a faint contact shadow on the table seen through the base
			const contact = new THREE.Mesh(kit.geo(`blocks|icecontact|${bw.toFixed(4)}|${depth.toFixed(4)}`, () => new THREE.PlaneGeometry(bw - 2 * r, depth - 2 * r).rotateX(-Math.PI / 2)),
				M("ice-contact", { color: new THREE.Color("#050505"), alphaMap: iceContact(), transparent: true, opacity: 0.12, roughness: 1, metalness: 0, depthWrite: false }))
			contact.position.set(x0 + bw / 2, y0 - SKIN_M + 0.0003, 0)
			contact.renderOrder = 1
			contact.userData.sceneOnly = true
			parts.push(contact)
			// the cloudy core, bubbles and fracture of a cube, in the room the triangle has round its centroid (the nearest face is rho away), low in the piece
			let area = 0, cx = 0, cy = 0
			for (let i = 0; i < n; i++) {
				const a = pts[i], c = pts[(i + 1) % n]
				const cr = a.x * c.y - c.x * a.y
				area += cr
				cx += (a.x + c.x) * cr
				cy += (a.y + c.y) * cr
			}
			cx /= 3 * area
			cy /= 3 * area
			let rho = Infinity
			for (let i = 0; i < n; i++) {
				const a = pts[i], c = pts[(i + 1) % n]
				rho = Math.min(rho, ((c.x - a.x) * (cy - a.y) - (c.y - a.y) * (cx - a.x)) / sideLen[i])
			}
			centre = [cx, cy]
			const e = 1.8 * rho
			inner.push(...iceInside(e, e, Math.min(e, 0.8 * depth)))
		}
		const insideGroup = kit.group(...inner)
		insideGroup.userData.iceInside = true
		insideGroup.position.set(centre[0], centre[1], 0)
		const proto = kit.group(...parts, insideGroup)
		iceVary(proto)
		return iceFinish(proto)
	}
	function wedgeModel({ body, solid, d }) {
		const pts = body.points
		const depth = body.depth ?? d
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
		for (const p of pts) {
			x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y)
		}
		const bw = x1 - x0, bh = y1 - y0
		let r = Math.max(0.0004, Math.min(0.0012, 0.04 * Math.min(bw, bh), depth / 6))
		// a rounded tip falls short of the true corner by (r - skin) / sin(a / 2) - r, so the sharpest corner limits the rounding: down to the skin's own 0.75 mm,
		// the tip never more than 0.8 mm short (the default wedge's 27 degrees keeps its 1.2 mm)
		let amin = Math.PI
		for (let i = 0; i < pts.length; i++) {
			const a = pts[(i + pts.length - 1) % pts.length], p = pts[i], c = pts[(i + 1) % pts.length]
			const ux = a.x - p.x, uy = a.y - p.y, vx = c.x - p.x, vy = c.y - p.y
			amin = Math.min(amin, Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1)))))
		}
		const sa = Math.max(1e-3, Math.sin(amin / 2))
		if (sa < 0.95) r = Math.max(Math.min(r, SKIN_M), Math.min(r, (SKIN_M / sa + 0.0008) / (1 / sa - 1)))
		const outline = roundedOutline(pts, SKIN_M, r)
		const b = 0.65 * r
		const kind = KIND_OF_LOOK[solid.look] ?? "wood"
		const tint = solid.color ?? "#ffffff"
		let geo, mats, pick = null
		if (kind === "wood" || kind === "cardboard") {
			// end grain on the two triangular faces: one wide end tile laid on the face once, with one scale on both axes (the rings are never stretched
			// into stripes and never seamed; a face bigger than the tile scales it up), long grain running front to back along the base, the back and the slope
			const wood = woodMats(woodKindOf(solid.look), { stain: solid.color ?? null })
			// up to 1.5x the tile is stretched over the face (rings 4 mm at most); a bigger face takes the big class (the same plank end 2.5x larger, rings still 2.7 mm),
			// and beyond 1.5x of that the tile lays at its own scale and mirrors across its edges, so no face ever shows one magnified blur
			const want1 = Math.max(0.6, bw / END_WIDE_T[0], bh / END_WIDE_T[1])
			const big = want1 > 1.5
			const T = big ? END_WIDE_BIG : 1
			const want = big ? Math.max(1, bw / (END_WIDE_T[0] * T), bh / (END_WIDE_T[1] * T)) : want1
			const sc = Math.min(1.5, want)
			const mirror = want > 1.5
			const endBase = big ? wood.endWideBig : wood.endWide
			geo = prismGeo(outline, depth, b, (x, y, z, arc, lid) => (lid ? [(x - x0) / (sc * END_WIDE_T[0] * T), (y - y0) / (sc * END_WIDE_T[1] * T)] : [(z + depth / 2) / STRAIGHT_T[0] + 0.1, arc / STRAIGHT_T[1]]))
			const endMat = mirror ? variantOf(endBase, "mirror", { mirror: true }) : endBase
			mats = [endMat, wood.straight]
			pick = (mesh, hsh) => {
				const vi = hsh % 12
				const ou = frac(vi, 1), fx = frac(vi, 3) < 0.5, fy = frac(vi, 4) < 0.5
				const k = 0.97 + 0.06 * frac(vi, 5)
				const t = [k, k, k]
				return [variantOf(endBase, `w${vi}${mirror ? "m" : ""}`, { fx, tint: t, mirror }), variantOf(wood.straight, `w${vi}`, { ou, fx, fy, tint: t })]
			}
		} else if (kind === "brick" || kind === "concrete") {
			const m = matOf(`clay4|${kind}|s|${tint}`, clayTile(kind, "stretcher"), { color: tint, roughness: CLAYS[kind].rough, normalScale: new THREE.Vector2(1.1, 1.1) })
			geo = prismGeo(outline, depth, b, (x, y, z, arc, lid) => (lid ? [x / 0.23 + 0.3, y / 0.072 + 0.5] : [arc / 0.23, (z + depth / 2) / 0.072]))
			mats = [m, m]
		} else if (kind === "cork") {
			const m = matOf(`cork2|${solid.color}`, corkTex(), { color: solid.color ?? "#ffffff", roughness: 0.92, normalScale: new THREE.Vector2(0.9, 0.9) })
			geo = prismGeo(outline, depth, b, (x, y, z, arc, lid) => (lid ? [x / CORK_T[0] + 0.5, y / CORK_T[1] + 0.5] : [arc / CORK_T[0], (z + depth / 2) / CORK_T[1]]))
			mats = [m, m]
		} else if (kind === "foam") {
			const m = matOf(`foam5|${tint}`, foamTile(), { color: tint, roughness: 0.96, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color("#fff0a0"), normalScale: new THREE.Vector2(1.4, 1.4) })
			geo = prismGeo(outline, depth, b, (x, y, z, arc, lid) => (lid ? [x / FOAM_T[0] + 0.5, y / FOAM_T[1] + 0.5] : [arc / FOAM_T[0], (z + depth / 2) / FOAM_T[1]]))
			mats = [m, m]
		} else {
			return wedgeIce({ pts, depth, r, b, x0, y0, bw, bh, glass: solid.look === "glass" })
		}
		const proto = kit.group(mesh(geo, mats))
		return pick ? perInstance(proto, pick) : proto
	}
	addModel("wedge", "wedge", wedgeModel)
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
