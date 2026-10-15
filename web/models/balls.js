// 3D models for the balls catalog group (see web/models3d.js for the frame and the kit).
// Every ball is a sphere of exactly its physics radius (so what you see is what collides), wearing textures that are
// baked ONCE per ball type by walking an equirectangular canvas pixel by pixel (the direction of each pixel is known, so
// seams, dimples, panels and noise are exact on the sphere, with no pole pinching): colour, normal and roughness maps.
// A few details are real geometry (baseball stitches, bowling holes, the marble's cat's-eye vanes, the beach-ball valve).
// Frame: the sphere's poles are on y, u = 0.25 faces +z (the camera) as in three's SphereGeometry; the ball only ever turns
// about z, so what faces the camera is what the picture shows. No brand names anywhere.
export default function register({ addModel, kit, THREE }) {
	const TAU = Math.PI * 2
	const PI = Math.PI

	// ---------------------------------------------------------------- small maths
	const cache = new Map()
	const memo = (k, f) => {
		let v = cache.get(k)
		if (v === undefined) {
			v = kit.bakeScope ? kit.bakeScope(`balls|${k}`, f) : f() // (a bake worker may have worked it out already: models3d.js "Bake scopes")
			cache.set(k, v)
		}
		return v
	}
	const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
	const smooth = (a, b, x) => {
		const t = clamp((x - a) / (b - a))
		return t * t * (3 - 2 * t)
	}
	const mix = (a, b, t) => a + (b - a) * t
	const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
	const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
	const rgbOf = (s) => {
		let c = String(s ?? "#cccccc").replace("#", "")
		if (c.length === 3) c = c.split("").map((x) => x + x).join("")
		const v = [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
		return v.some((x) => Number.isNaN(x)) ? [200, 200, 200] : v
	}
	const css = (c, a = 1) => `rgba(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(clamp(c[2], 0, 255))},${a})`
	const hexOf = (c) => "#" + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")
	const norm = (v) => {
		const l = Math.hypot(v[0], v[1], v[2]) || 1
		return [v[0] / l, v[1] / l, v[2] / l]
	}
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
	const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
	const f6 = (v) => Number(v).toFixed(6)
	function rng(seed) {
		let a = seed >>> 0
		return () => {
			a = (a + 0x6d2b79f5) >>> 0
			let t = a
			t = Math.imul(t ^ (t >>> 15), t | 1)
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
	}
	function hash2(a, b, s = 0) {
		let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 1442695041)
		h = Math.imul(h ^ (h >>> 13), 1274126177)
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296
	}

	// ---------------------------------------------------------------- 3D gradient noise (seamless on a sphere: sample it at the pixel's direction)
	const PERM = new Uint8Array(512)
	{
		const r = rng(20241014)
		const p = Array.from({ length: 256 }, (_, i) => i)
		for (let i = 255; i > 0; i--) {
			const j = Math.floor(r() * (i + 1))
			;[p[i], p[j]] = [p[j], p[i]]
		}
		for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
	}
	const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
	const lerp = (t, a, b) => a + t * (b - a)
	function grad(h, x, y, z) {
		h &= 15
		const u = h < 8 ? x : y
		const v = h < 4 ? y : h === 12 || h === 14 ? x : z
		return (h & 1 ? -u : u) + (h & 2 ? -v : v)
	}
	function noise3(x, y, z) {
		let X = Math.floor(x)
		let Y = Math.floor(y)
		let Z = Math.floor(z)
		x -= X
		y -= Y
		z -= Z
		X &= 255
		Y &= 255
		Z &= 255
		const u = fade(x)
		const v = fade(y)
		const w = fade(z)
		const A = PERM[X] + Y
		const AA = PERM[A] + Z
		const AB = PERM[A + 1] + Z
		const B = PERM[X + 1] + Y
		const BA = PERM[B] + Z
		const BB = PERM[B + 1] + Z
		return lerp(
			w,
			lerp(v, lerp(u, grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z)), lerp(u, grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z))),
			lerp(v, lerp(u, grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1)), lerp(u, grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1))),
		)
	}
	function fbm(x, y, z, oct = 4) {
		let s = 0
		let a = 0.5
		let f = 1
		for (let i = 0; i < oct; i++) {
			s += a * noise3(x * f, y * f, z * f)
			f *= 2.03
			a *= 0.5
		}
		return s * 1.8
	}

	// ---------------------------------------------------------------- equirect baking
	/** Walk a W x H equirect map; fn(p, outs) per pixel with p = {i, x, y, dx,dy,dz (direction), ex,ey,ez (east), nx,ny,nz (north), th, st, ct}. */
	function bake(W, H, n, fn) {
		const outs = []
		for (let k = 0; k < n; k++) outs.push(new Uint8ClampedArray(W * H * 4))
		const cph = new Float64Array(W)
		const sph = new Float64Array(W)
		for (let x = 0; x < W; x++) {
			const ph = ((x + 0.5) / W) * TAU
			cph[x] = Math.cos(ph)
			sph[x] = Math.sin(ph)
		}
		const p = { x: 0, y: 0, i: 0, dx: 0, dy: 0, dz: 0, ex: 0, ey: 0, ez: 0, nx: 0, ny: 0, nz: 0, st: 0, ct: 0, th: 0 }
		for (let y = 0; y < H; y++) {
			const th = ((y + 0.5) / H) * PI
			const st = Math.sin(th)
			const ct = Math.cos(th)
			p.y = y
			p.th = th
			p.st = st
			p.ct = ct
			for (let x = 0; x < W; x++) {
				const c = cph[x]
				const s = sph[x]
				p.x = x
				p.i = (y * W + x) * 4
				p.dx = -c * st
				p.dy = ct
				p.dz = s * st
				p.ex = s
				p.ey = 0
				p.ez = c
				p.nx = c * ct
				p.ny = st
				p.nz = -s * ct
				fn(p, outs)
			}
		}
		return outs
	}
	function canvasOf(W, H, data = null) {
		const c = document.createElement("canvas")
		c.width = W
		c.height = H
		const g = c.getContext("2d")
		if (data) g.putImageData(new ImageData(data, W, H), 0, 0)
		return c
	}
	/** A CanvasTexture; colour maps are sRGB, data maps (normal, roughness) are not. */
	function texOf(canvas, { data = false } = {}) {
		const t = new THREE.CanvasTexture(canvas)
		if (!data) t.colorSpace = THREE.SRGBColorSpace
		t.wrapS = THREE.RepeatWrapping
		t.wrapT = THREE.ClampToEdgeWrapping
		t.anisotropy = 8
		return t
	}
	const setRGB = (o, i, c) => {
		o[i] = c[0]
		o[i + 1] = c[1]
		o[i + 2] = c[2]
		o[i + 3] = 255
	}
	/** A tangent-space normal from the height gradient (gx toward east, gy toward north, both dimensionless slopes). */
	function putN(o, i, gx, gy) {
		const l = 1 / Math.sqrt(gx * gx + gy * gy + 1)
		o[i] = (-gx * l * 0.5 + 0.5) * 255
		o[i + 1] = (-gy * l * 0.5 + 0.5) * 255
		o[i + 2] = (l * 0.5 + 0.5) * 255
		o[i + 3] = 255
	}
	/** Box blur (wraps in x) of a W x H float map, `rad` pixels, twice (close to a gaussian). Runs along rows only, so it stays cache-friendly. */
	function blur(a, W, H, rad) {
		if (rad < 1) return a
		const inv = 1 / (2 * rad + 1)
		const tmp = new Float32Array(a.length)
		const pad = new Float32Array(W + 2 * rad + 1)
		const cs = new Float64Array(W)
		const hrun = (src, dst) => {
			for (let y = 0; y < H; y++) {
				const o = y * W
				for (let i = 0; i < rad; i++) pad[i] = src[o + W - rad + i]
				for (let i = 0; i < W; i++) pad[rad + i] = src[o + i]
				for (let i = 0; i <= rad; i++) pad[rad + W + i] = src[o + i]
				let s = 0
				for (let i = 0; i <= 2 * rad; i++) s += pad[i]
				for (let k = 0; k < W; k++) {
					dst[o + k] = s * inv
					s += pad[k + 2 * rad + 1] - pad[k]
				}
			}
		}
		const vrun = (src, dst) => {
			cs.fill(0)
			for (let k = -rad; k <= rad; k++) {
				const o = Math.min(H - 1, Math.max(0, k)) * W
				for (let x = 0; x < W; x++) cs[x] += src[o + x]
			}
			for (let y = 0; y < H; y++) {
				const o = y * W
				const oa = Math.min(H - 1, y + rad + 1) * W
				const ob = Math.max(0, y - rad) * W
				for (let x = 0; x < W; x++) {
					dst[o + x] = cs[x] * inv
					cs[x] += src[oa + x] - src[ob + x]
				}
			}
		}
		for (let pass = 0; pass < 2; pass++) {
			hrun(a, tmp)
			vrun(tmp, a)
		}
		return a
	}
	/** Normals (Uint8 RGBA) from a height map in metres on a sphere of radius r. */
	function normalsOf(h, W, H, r, gain = 1) {
		const out = new Uint8ClampedArray(W * H * 4)
		for (let y = 0; y < H; y++) {
			const st = Math.sin(((y + 0.5) / H) * PI)
			const ide = gain / (((TAU * r * Math.max(st, 0.03)) / W) * 2)
			const ym = Math.max(y - 1, 0)
			const yp = Math.min(y + 1, H - 1)
			const idn = gain / ((yp - ym) * ((PI * r) / H))
			const o = y * W
			const om = ym * W
			const op = yp * W
			for (let x = 0; x < W; x++) {
				const xm = x === 0 ? W - 1 : x - 1
				const xp = x === W - 1 ? 0 : x + 1
				putN(out, (o + x) * 4, (h[o + xp] - h[o + xm]) * ide, (h[om + x] - h[op + x]) * idn)
			}
		}
		return out
	}
	/** A coarse equirect grid of C float channels: fn(dx, dy, dz, out, gx, gy) fills `out` for the direction of each cell centre.
	 * Slowly varying terms (warps, mottling) are worked out on one of these and read back bilinearly per pixel instead of calling noise per pixel. */
	function coarse(Wg, Hg, C, fn) {
		const a = new Float32Array(Wg * Hg * C)
		const out = new Float32Array(C)
		for (let y = 0; y < Hg; y++) {
			const th = ((y + 0.5) / Hg) * PI
			const st = Math.sin(th)
			const ct = Math.cos(th)
			for (let x = 0; x < Wg; x++) {
				const ph = ((x + 0.5) / Wg) * TAU
				fn(-Math.cos(ph) * st, ct, Math.sin(ph) * st, out, x, y)
				const o = (y * Wg + x) * C
				for (let c = 0; c < C; c++) a[o + c] = out[c]
			}
		}
		return { Wg, Hg, C, a }
	}
	/** Bilinear lookup of a coarse grid at pixel (x, y) of a W x H map (wraps in x, clamps in y): fills `out`. */
	function samp(g, x, y, W, H, out) {
		const { Wg, Hg, C, a } = g
		const u = ((x + 0.5) * Wg) / W - 0.5
		const v = ((y + 0.5) * Hg) / H - 0.5
		const xf = Math.floor(u)
		const yf = Math.floor(v)
		const fx = u - xf
		const fy = v - yf
		const x1 = (xf + 1) % Wg
		const x0 = (xf + Wg) % Wg
		const y0 = yf < 0 ? 0 : yf
		const y1 = yf + 1 >= Hg ? Hg - 1 : yf + 1
		const w00 = (1 - fx) * (1 - fy)
		const w10 = fx * (1 - fy)
		const w01 = (1 - fx) * fy
		const w11 = fx * fy
		const i00 = (y0 * Wg + x0) * C
		const i10 = (y0 * Wg + x1) * C
		const i01 = (y1 * Wg + x0) * C
		const i11 = (y1 * Wg + x1) * C
		for (let c = 0; c < C; c++) out[c] = a[i00 + c] * w00 + a[i10 + c] * w10 + a[i01 + c] * w01 + a[i11 + c] * w11
	}

	// ---- drawing on the sphere through a canvas: seams, channels, stitches (ribbons whose width is true on the sphere)
	function pxOf(d, W, H) {
		let ph = Math.atan2(d[2], -d[0])
		if (ph < 0) ph += TAU
		return [(ph / TAU) * W, (Math.acos(clamp(d[1], -1, 1)) / PI) * H]
	}
	function fillPoly(g, W, H, dirs) {
		const pts = []
		let prev = null
		let off = 0
		for (const d of dirs) {
			const p = pxOf(d, W, H)
			if (prev !== null) {
				const dx = p[0] + off - prev
				if (dx > W / 2) off -= W
				else if (dx < -W / 2) off += W
			}
			p[0] += off
			prev = p[0]
			pts.push(p)
		}
		const x0 = Math.min(...pts.map((p) => p[0]))
		const x1 = Math.max(...pts.map((p) => p[0]))
		for (const o of [-W, 0, W]) {
			if (x1 + o < 0 || x0 + o > W) continue
			g.beginPath()
			pts.forEach((p, i) => (i ? g.lineTo(p[0] + o, p[1]) : g.moveTo(p[0] + o, p[1])))
			g.closePath()
			g.fill()
		}
	}
	/** A ribbon along a path of unit directions; hw = half width in radians (number or (i) => number). */
	function ribbon(g, W, H, pts, hw, closed = false) {
		const n = pts.length
		const last = closed ? n : n - 1
		for (let i = 0; i < last; i++) {
			const a = pts[i]
			const b = pts[(i + 1) % n]
			const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]])
			const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
			const side = norm(cross(norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]), t))
			const w0 = typeof hw === "function" ? hw(i) : hw
			const w1 = typeof hw === "function" ? hw(i + 1) : hw
			const e = 0.35 * len
			const a2 = [a[0] - t[0] * e, a[1] - t[1] * e, a[2] - t[2] * e]
			const b2 = [b[0] + t[0] * e, b[1] + t[1] * e, b[2] + t[2] * e]
			const q = (p, s, w) => norm([p[0] + side[0] * s * w, p[1] + side[1] * s * w, p[2] + side[2] * s * w])
			fillPoly(g, W, H, [q(a2, -1, w0), q(b2, -1, w1), q(b2, 1, w1), q(a2, 1, w0)])
		}
	}
	function arc(a, b, n) {
		const w = Math.acos(clamp(dot(a, b), -1, 1))
		const sw = Math.sin(w) || 1
		return Array.from({ length: n + 1 }, (_, i) => {
			const t = i / n
			const k0 = Math.sin((1 - t) * w) / sw
			const k1 = Math.sin(t * w) / sw
			return norm([a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1])
		})
	}
	const circle = (axisA, axisB, n) => Array.from({ length: n }, (_, i) => {
		const t = (i / n) * TAU
		return norm([axisA[0] * Math.cos(t) + axisB[0] * Math.sin(t), axisA[1] * Math.cos(t) + axisB[1] * Math.sin(t), axisA[2] * Math.cos(t) + axisB[2] * Math.sin(t)])
	})
	/** The baseball / tennis seam: one closed curve with two lobes up and two down, circling the pole axis; then turned by Euler angles. */
	function seamCurve(n, b = 0.3, euler = [0, 0, 0]) {
		const c = 2 * Math.sqrt(b)
		const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2]))
		const v = new THREE.Vector3()
		const out = []
		for (let i = 0; i < n; i++) {
			const t = (i / n) * TAU
			v.set(Math.cos(t) + b * Math.cos(3 * t), c * Math.sin(2 * t), Math.sin(t) - b * Math.sin(3 * t)).normalize().applyQuaternion(q)
			out.push([v.x, v.y, v.z])
		}
		return out
	}

	// ---------------------------------------------------------------- materials: a touch of saturation, like the rest of the view
	const SAT = { value: 1.25 }
	// AgX mixes the colour channels before its curve, which washes saturated paints toward grey: push the saturation up before it,
	// letting the weakest channel go a little below zero (clamped at -0.5 of the luminance) so a pure yellow still comes out yellow
	const GRADE = "{ float gl = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)); outgoingLight = max(vec3(-0.5 * gl), mix(vec3(gl), outgoingLight, uSatB * uSatM)); }"
	/** The fibre-tip shells' cut-out (see bm's `fuzz`): value noise on a 3D lattice in the ball's own frame (no poles, no seams), in cells per unit radius. */
	const FUZZ_GLSL = `varying vec3 vFz;
uvec3 fzPcg( uvec3 v ) {
	v = v * 1664525u + 1013904223u;
	v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
	v ^= v >> 16u;
	v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
	return v;
}
float fzVal( ivec3 c ) { return float( fzPcg( uvec3( c + 4096 ) ).x ) * ( 1.0 / 4294967295.0 ); }
float fzNoise( vec3 p ) {
	vec3 fl = floor( p );
	ivec3 c = ivec3( fl );
	vec3 t = p - fl;
	float a = mix( mix( fzVal( c ), fzVal( c + ivec3( 1, 0, 0 ) ), t.x ), mix( fzVal( c + ivec3( 0, 1, 0 ) ), fzVal( c + ivec3( 1, 1, 0 ) ), t.x ), t.y );
	float b = mix( mix( fzVal( c + ivec3( 0, 0, 1 ) ), fzVal( c + ivec3( 1, 0, 1 ) ), t.x ), mix( fzVal( c + ivec3( 0, 1, 1 ) ), fzVal( c + ivec3( 1, 1, 1 ) ), t.x ), t.y );
	return 0.5 + ( mix( a, b, t.z ) - 0.5 ) * 1.22; // (spread like the bilinear random texture it replaces: sd about 0.19)
}`
	function bm(key, params, { sat = true, holes = null, tint = 0.7, diffIbl = params.envMap ? 0.3 : 1, boost = 1, fuzz = null } = {}) {
		// saturated paints clip toward white in AgX under the key light: scale the albedo down like the rest of the view does (PAINT_TINT)
		const col = new THREE.Color(params.color ?? "#ffffff").multiplyScalar(tint)
		const fuzzKey = fuzz ? [fuzz.freq, fuzz.lo, fuzz.hi, fuzz.mlo, fuzz.mhi].join(",") : ""
		const m = kit.mat(`ball|${key}|${tint}|${boost}|${fuzzKey}`, { ...params, color: col })
		if (m.userData.ballGraded) return m
		m.userData.ballGraded = true
		const f = (v) => Number(v).toFixed(6)
		m.onBeforeCompile = (shader) => {
			shader.uniforms.uSatB = SAT
			shader.uniforms.uSatM = { value: boost }
			shader.uniforms.uIblDiff = { value: diffIbl }
			let vs = shader.vertexShader
			let fs = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uSatB;\nuniform float uSatM;\nuniform float uIblDiff;")
			fs = fs.replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\n#if defined( RE_IndirectDiffuse )\n iblIrradiance *= uIblDiff;\n#endif")
			if (holes) {
				vs = vs.replace("#include <common>", "#include <common>\nvarying vec3 vObjB;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjB = position;")
				fs = fs
					.replace("#include <common>", "#include <common>\nvarying vec3 vObjB;")
					.replace("void main() {", `void main() {\n vec3 ddB = normalize(vObjB);\n${holes.map((h) => ` if (dot(ddB, vec3(${h.a.map(f).join(",")})) > ${f(h.c)}) discard;`).join("\n")}`)
			}
			// fibre-tip shells: a cut-out of 3D value noise in the ball's own frame (the flecks of loose fibre ends; no poles or seams), edged by alpha-to-coverage. The
			// cells-per-pixel footprint of the lattice is an ellipse. Once its SHORT axis is under about 2.7 px a cell the flecks would only sparkle, and the shell fades
			// out (lo..hi). Near the outline the surface is seen edge-on and only the LONG axis grows: there the flecks stay, making the felt's fuzzy outline, until a pixel
			// spans about a cell along that axis (mlo..mhi; point-sampled noise would speckle). Fading erodes the flecks (a higher cut: fewer and smaller) rather than
			// making them see-through, which alpha-to-coverage would draw as a dither
			if (fuzz) {
				vs = vs.replace("#include <common>", "#include <common>\nvarying vec3 vFz;").replace("#include <begin_vertex>", `#include <begin_vertex>\nvFz = normalize( position ) * ${f(fuzz.freq)};`)
				fs = fs.replace("#include <common>", "#include <common>\n" + FUZZ_GLSL).replace(
					"#include <alphatest_fragment>",
					`{
	vec3 fzA = dFdx( vFz );
	vec3 fzB = dFdy( vFz );
	vec3 fzC = cross( fzA, fzB );
	float fzS = dot( fzA, fzA ) + dot( fzB, fzB );
	float fzG = dot( fzC, fzC );
	float fzR = sqrt( max( fzS * fzS - 4.0 * fzG, 0.0 ) );
	float fzMin = sqrt( 2.0 * fzG / max( fzS + fzR, 1e-20 ) );
	float fzMax = sqrt( 0.5 * ( fzS + fzR ) );
	float fzN = fzNoise( vFz );
	float fzW = min( fwidth( fzN ), 0.08 ); // (a resolved fleck's edge spans well under that; where the noise is minified the fade has taken the shell)
	float fzFade = ( 1.0 - smoothstep( ${f(fuzz.lo)}, ${f(fuzz.hi)}, fzMin ) ) * ( 1.0 - smoothstep( ${f(fuzz.mlo)}, ${f(fuzz.mhi)}, fzMax ) );
	float fzT = mix( 1.12, alphaTest, fzFade ); // (the noise stays under 1.11)
	float fzCov = smoothstep( fzT - 0.5 * fzW, fzT + 0.5 * fzW + 1e-5, fzN ) * min( fzFade * 10.0, 1.0 ); // (and none at all once faded)
	diffuseColor.a = fzCov;
	if ( fzCov <= 0.0 ) discard;
}`,
				)
			}
			if (sat) fs = fs.replace("#include <opaque_fragment>", GRADE + "\n#include <opaque_fragment>")
			shader.vertexShader = vs
			shader.fragmentShader = fs
		}
		m.customProgramCacheKey = () => `ballmat|${sat ? 1 : 0}|${fuzzKey}|${holes ? holes.map((h) => h.a.map(f).join(",") + "," + f(h.c)).join(";") : ""}`
		return m
	}

	// ---------------------------------------------------------------- the studio: an HDR room that shiny balls reflect (window, softboxes, door, shelf, wall, the warm table)
	function studio() {
		return memo("studio", () => {
			// 1024 x 512 half-float (a mirror ball seen close up shows the window's edge: at 512 wide it steps); built with plain loops: rectangles are tested only in their own rows
			const W = 1024
			const H = 512
			const half = new Uint16Array(W * H * 4)
			// float -> half for the positive, normal-range radiances used here (0.05 and up): a rounded shift of the float's bits
			const f32 = new Float32Array(1)
			const u32 = new Uint32Array(f32.buffer)
			const hf = (v) => {
				f32[0] = v
				return ((u32[0] + 0x1000) >> 13) - 0x1c000
			}
			const ONE = hf(1)
			// [azimuth from +x toward +z, elevation, width, height (all degrees), radiance, tint, bars]
			const lights = [
				[138, 44, 30, 38, 15, [1, 0.97, 0.9], true], // the window: front, left, above (where the key light is)
				[24, 18, 18, 24, 4.5, [0.95, 0.97, 1], false], // a softbox front right
				[250, 36, 56, 8, 6, [1, 1, 1], false], // a strip high behind
				[335, 7, 22, 12, 2.4, [1, 0.95, 0.88], false], // a lamp low right
				[200, 14, 10, 24, 1.1, [1, 0.96, 0.9], false], // a second, dim window left behind
			]
			// dark things in the room: [azimuth, elevation, width, height, radiance]
			const darks = [
				[22, 14, 34, 26, 0.05], // a bookcase front right
				[176, 22, 11, 44, 0.05], // a door left
				[260, 20, 40, 30, 0.05], // a bookcase behind
			]
			// per column: the window's reflection streak in the table, as a gaussian of the wrapped azimuth
			const colStreak = new Float64Array(W)
			const colAz = new Float64Array(W)
			// the table's wood grain: parallel lines along world x, so it is a function of the floor point's z (a 1-D profile); a ball sees the floor point at unit height
			// below it, z = sin(azimuth) / tan(-elevation), which is a family of curves across the mirror (not a fan of streaks converging on the contact point)
			const GZ = 4
			const GN = 2048
			const grainTab = new Float64Array(GN + 2)
			for (let i = 0; i <= GN + 1; i++) {
				const z = -GZ + ((2 * GZ) * i) / GN
				grainTab[i] = 0.7 * noise3(z * 7, 0.5, 0) + 0.3 * noise3(z * 19, 3.1, 0)
			}
			const colSin = new Float64Array(W) // sin(azimuth), azimuth from +x toward +z
			for (let x = 0; x < W; x++) {
				const azD = ((x + 0.5) / W - 0.5) * 360
				colAz[x] = (azD + 360) % 360
				const ar = (colAz[x] * PI) / 180
				colSin[x] = Math.sin(ar)
				const daS = ((((azD - 138 + 540) % 360) + 360) % 360) - 180
				colStreak[x] = Math.exp(-((daS / 38) ** 2))
			}
			// a rectangle's mask is a product of an azimuth and an elevation ramp (smooth edges, 1.1 half-sizes out); the elevation part is fixed along a row
			const ramp = (d) => 1 - smooth(1, 1.18, d)
			const rowRects = (list, elD) => {
				const out = []
				for (const [baz, bel, bw, bh, I, tint, bars] of list) {
					const dy = Math.abs(elD - bel) / (bh / 2)
					if (dy > 1.2) continue
					out.push({ baz, hw: bw / 2, my: ramp(dy), I, tint, bars, barRow: Math.abs(elD - bel) < 0.9 })
				}
				return out
			}
			for (let y = 0; y < H; y++) {
				const elD = ((y + 0.5) / H - 0.5) * 180
				// floor (the table) and wall blend smoothly through the horizon
				const t = smooth(-14, 8, elD)
				const fl = 0.45 + 0.55 * smooth(-70, -4, elD)
				const grainW = 0.2 * smooth(-4, -20, elD)
				const invTan = elD < -0.5 ? 1 / Math.tan((-elD * PI) / 180) : 0 // the floor point's distance out, per unit of height
				const rowStreak = Math.exp(-(((elD + 34) / 16) ** 2))
				const k = smooth(0, 70, elD)
				const wr = mix(0.115, 0.19, k)
				const wg = mix(0.11, 0.185, k)
				const wb = mix(0.1, 0.175, k)
				const dk = rowRects(darks, elD)
				const lt = rowRects(lights, elD)
				const nd = dk.length
				const nl = lt.length
				for (let x = 0; x < W; x++) {
					const az = colAz[x]
					const streak = colStreak[x] * rowStreak // the window mirrored in the polished table
					let gm = 1
					if (grainW > 0) {
						const zf = colSin[x] * invTan
						const az2 = zf < 0 ? -zf : zf
						if (az2 < GZ) {
							const u = ((zf + GZ) / (2 * GZ)) * GN
							const i0 = u | 0
							const fr = u - i0
							gm = 1 + grainW * smooth(GZ, 1, az2) * (grainTab[i0] * (1 - fr) + grainTab[i0 + 1] * fr)
						}
					}
					let r = mix(0.25 * fl * gm + 0.7 * streak, wr, t)
					let g = mix(0.15 * fl * gm + 0.62 * streak, wg, t)
					let b = mix(0.085 * fl * gm + 0.5 * streak, wb, t)
					for (let q = 0; q < nd; q++) {
						const o = dk[q]
						let da = az - o.baz
						if (da > 180) da -= 360
						else if (da < -180) da += 360
						const dx = (da < 0 ? -da : da) / o.hw
						if (dx > 1.2) continue
						const m = ramp(dx) * o.my
						r += (o.I - r) * m
						g += (o.I - g) * m
						b += (o.I - b) * m
					}
					for (let q = 0; q < nl; q++) {
						const o = lt[q]
						let da = az - o.baz
						if (da > 180) da -= 360
						else if (da < -180) da += 360
						const ad = da < 0 ? -da : da
						const dx = ad / o.hw
						if (dx > 1.2) continue
						let m = ramp(dx) * o.my
						if (o.bars && (ad < 0.9 || o.barRow)) m *= 0.3 // the window bars
						r += (o.I * o.tint[0] - r) * m
						g += (o.I * o.tint[1] - g) * m
						b += (o.I * o.tint[2] - b) * m
					}
					const i = (y * W + x) * 4
					half[i] = hf(r)
					half[i + 1] = hf(g)
					half[i + 2] = hf(b)
					half[i + 3] = ONE
				}
			}
			const t = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType)
			t.mapping = THREE.EquirectangularReflectionMapping
			t.minFilter = THREE.LinearFilter
			t.magFilter = THREE.LinearFilter
			t.generateMipmaps = false
			t.needsUpdate = true
			return t
		})
	}
	const ball = (r, material, segs = [128, 64]) => kit.mesh(kit.sphere(r, segs[0], segs[1]), material)


	// ---- gradients (dimensionless slopes along east / north) for little bumps and ridges, used to build normal maps analytically
	const ZERO2 = [0, 0] // shared result of the analytic gradients outside their support (never written to)
	/** tangent direction at d pointing away from the point c, and the angle to c */
	function awayFrom(p, c) {
		const cd = p.dx * c[0] + p.dy * c[1] + p.dz * c[2]
		let tx = p.dx * cd - c[0]
		let ty = p.dy * cd - c[1]
		let tz = p.dz * cd - c[2]
		const l = Math.hypot(tx, ty, tz) || 1
		tx /= l
		ty /= l
		tz /= l
		return { ex: tx * p.ex + ty * p.ey + tz * p.ez, ey: tx * p.nx + ty * p.ny + tz * p.nz, ang: Math.acos(clamp(cd, -1, 1)) }
	}
	/** a ridge (S > 0) or groove (S < 0) along the great circle whose pole is ns: gaussian profile of half width w (rad), peak slope about 0.86 S */
	function ridge(p, ns, w, S) {
		const sa = p.dx * ns[0] + p.dy * ns[1] + p.dz * ns[2]
		if (sa > 3.4 * w || sa < -3.4 * w) return ZERO2 // the gaussian is gone (e^-11)
		const a = Math.asin(clamp(sa, -1, 1))
		const dh = S * (-2 * a / w) * Math.exp(-((a / w) ** 2))
		const tx = ns[0] - sa * p.dx
		const ty = ns[1] - sa * p.dy
		const tz = ns[2] - sa * p.dz
		const l = Math.hypot(tx, ty, tz) || 1
		return [(dh * (tx * p.ex + ty * p.ey + tz * p.ez)) / l, (dh * (tx * p.nx + ty * p.ny + tz * p.nz)) / l]
	}
	/** a gaussian dimple (S > 0) or bump (S < 0) of radius rho (rad) around c: returns [gx, gy] */
	function dimple(p, c, rho, S) {
		if (p.dx * c[0] + p.dy * c[1] + p.dz * c[2] < Math.cos(Math.min(PI, 2.6 * rho))) return ZERO2
		const a = awayFrom(p, c)
		const s = a.ang / rho
		if (s > 2.6) return [0, 0]
		const dh = 2 * S * s * Math.exp(-s * s)
		return [dh * a.ex, dh * a.ey]
	}
	/** a Float32 mask (0..1) of whatever `draw(g, W, H)` paints in white on black */
	function maskOf(W, H, draw, blurPx = 0) {
		const c = canvasOf(W, H)
		const g = c.getContext("2d")
		g.fillStyle = "#000"
		g.fillRect(0, 0, W, H)
		g.fillStyle = "#fff"
		g.strokeStyle = "#fff"
		draw(g, W, H)
		const d = g.getImageData(0, 0, W, H).data
		const m = new Float32Array(W * H)
		for (let i = 0; i < m.length; i++) m[i] = d[i * 4] / 255
		return blur(m, W, H, blurPx)
	}

	// ================================================================ SUPERBALL: dense red rubber, a faint swirl, a few sparkles
	addModel("superball", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		// where the glitter flecks are: [u, v, size in texels of a 512-wide map]
		const flecks = memo("superball|fleckpos", () => {
			const rnd = rng(11)
			return Array.from({ length: 150 }, () => {
				const v = 0.14 + 0.72 * rnd()
				const u = rnd()
				return [u, v, 0.45 + 0.6 * rnd()]
			})
		})
		const map = memo(`superball|${color}`, () => {
			// the swirl is smooth (its finest octave is under 6 cycles round the ball): 512 x 256 is plenty, the warps come off a coarse grid
			const W = 512
			const H = 256
			const dark = scale3(base, 0.95)
			const light = scale3(base, 1.2)
			const hi = scale3(base, 1.4)
			const warp = coarse(128, 64, 3, (dx, dy, dz, out) => {
				const x = dx * 1.4
				const y = dy * 1.4
				const z = dz * 1.4
				out[0] = fbm(x, y, z, 2)
				out[1] = fbm(x + 5.2, y + 1.3, z + 8.1, 2)
				out[2] = fbm(x + 9.1, y + 4.7, z + 2.3, 2)
			})
			const q = new Float32Array(3)
			const [o] = bake(W, H, 1, (p, outs) => {
				const x = p.dx * 1.4
				const y = p.dy * 1.4
				const z = p.dz * 1.4
				samp(warp, p.x, p.y, W, H, q)
				const n = fbm(x + 1.3 * q[0], y + 1.3 * q[1], z + 1.3 * q[2], 3)
				const t = smooth(-0.5, 0.6, n)
				const vein = 0.12 * smooth(0.9, 0.99, 1 - Math.abs(fbm(x * 1.6 + q[0], y * 1.6 + q[1], z * 1.6 + q[2], 2)))
				const i = p.i
				outs[0][i] = mix(dark[0], light[0], t) * (1 - vein) + hi[0] * vein
				outs[0][i + 1] = mix(dark[1], light[1], t) * (1 - vein) + hi[1] * vein
				outs[0][i + 2] = mix(dark[2], light[2], t) * (1 - vein) + hi[2] * vein
				outs[0][i + 3] = 255
			})
			const cv = canvasOf(W, H, o)
			const g = cv.getContext("2d")
			g.fillStyle = css(scale3(base, 1.6).map((v, i) => v + 40 * (i ? 1 : 0)), 0.6) // a lighter fleck, so it reads as a glint and never as a dark pit
			for (const [u, v, sz] of flecks) {
				g.beginPath()
				g.arc(u * W, v * H, sz, 0, TAU)
				g.fill()
			}
			return texOf(cv)
		})
		// the glitter: the same flecks, glossier than the rubber round them in the roughness map (green): a sharp reflection near a highlight
		const fleck = memo("superball|flecks", () => {
			const W = 1024
			const H = 512
			const cv = canvasOf(W, H)
			const g = cv.getContext("2d")
			g.fillStyle = "rgb(0,255,0)"
			g.fillRect(0, 0, W, H)
			g.fillStyle = "rgb(0,150,0)"
			for (const [u, v, sz] of flecks) {
				g.beginPath()
				g.arc(u * W, v * H, sz * 1.3, 0, TAU)
				g.fill()
			}
			return texOf(cv, { data: true })
		})
		const m = bm(`superball|${color}`, { color: "#ffffff", map, roughnessMap: fleck, metalness: 0, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.12, emissive: hexOf(scale3(base, 0.3)), emissiveIntensity: 0.1, envMap: studio(), envMapIntensity: 0.9 }, { tint: 0.6 })
		return kit.group(ball(r, m))
	})

	// ================================================================ PLASTIC BALL: glossy hollow toy ball with its moulding seam and a tiny vent dent
	addModel("plastic-ball", "ball", ({ r, color }) => {
		const ns = norm([0.3, 0.9, 0.28])
		const nm = memo("plastic|normal", () => {
			const W = 1024
			const H = 512
			const along = norm(cross(ns, [0.2, 0.1, 1]))
			const vent = norm([ns[0] * 0 + along[0] * Math.cos(0.5) + cross(ns, along)[0] * Math.sin(0.5), along[1] * Math.cos(0.5) + cross(ns, along)[1] * Math.sin(0.5), along[2] * Math.cos(0.5) + cross(ns, along)[2] * Math.sin(0.5)])
			const [o] = bake(W, H, 1, (p, outs) => {
				let [gx, gy] = ridge(p, ns, 0.02, 0.3)
				const [vx, vy] = dimple(p, vent, 0.075, 0.9)
				gx += vx
				gy += vy
				putN(outs[0], p.i, gx, gy)
			})
			return texOf(canvasOf(W, H, o), { data: true })
		})
		const base = rgbOf(color)
		const grey = (base[0] + base[1] + base[2]) / 3
		const vivid = hexOf(base.map((v) => grey + (v - grey) * 1.25))
		const m = bm(`plastic|${color}`, { color: vivid, normalMap: nm, clearcoatNormalMap: nm, roughness: 0.16, clearcoat: 0.8, clearcoatRoughness: 0.05, emissive: vivid, emissiveIntensity: 0.03, envMap: studio(), envMapIntensity: 1.1 }, { tint: 1, boost: 1.1 })
		return kit.group(ball(r, m))
	})

	// ================================================================ PING-PONG BALL: matte white celluloid, a faint seam, a tiny printed "40+" with its stars
	addModel("ping-pong-ball", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		const ns = norm([0.62, 0.55, -0.2])
		const maps = memo(`pingpong|${color}`, () => {
			const W = 2048
			const H = 1024
			// the faint orange-peel of moulded celluloid: a slow waviness (about 7 mm across), read from a coarse grid
			const peel = coarse(256, 128, 2, (dx, dy, dz, out) => {
				out[0] = 0.03 * noise3(dx * 45, dy * 45, dz * 45)
				out[1] = 0.015 * noise3(dx * 45 + 7, dy * 45, dz * 45)
			})
			const v = new Float32Array(2)
			const [n] = bake(1024, 512, 1, (p, outs) => {
				const [gx, gy] = ridge(p, ns, 0.012, 0.1)
				samp(peel, p.x, p.y, 1024, 512, v)
				putN(outs[0], p.i, gx + v[0], gy + v[1])
			})
			const cv = canvasOf(W, H)
			const g = cv.getContext("2d")
			g.fillStyle = css(base)
			g.fillRect(0, 0, W, H)
			// the seam: a thin darker line along the equator of the two moulded halves
			g.fillStyle = css(scale3(base, 0.82), 0.45)
			const seam = circle(norm(cross(ns, [0, 0, 1])), norm(cross(ns, norm(cross(ns, [0, 0, 1])))), 360)
			ribbon(g, W, H, seam, 0.0035, true)
			// the print: three stars over "40+", small and orange
			const ink = "#e2612c"
			const pxr = W / TAU
			g.save()
			g.translate(W * 0.25 + 0.02 * pxr, H * 0.5 - 0.03 * pxr)
			g.rotate(-0.22)
			g.fillStyle = ink
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.font = `600 ${0.1 * pxr}px ui-sans-serif, Helvetica, Arial, sans-serif`
			g.fillText("★★★", 0, -0.085 * pxr)
			g.font = `700 ${0.17 * pxr}px ui-sans-serif, Helvetica, Arial, sans-serif`
			g.fillText("40+", 0, 0.04 * pxr)
			g.restore()
			return { map: texOf(cv), normal: texOf(canvasOf(1024, 512, n), { data: true }) }
		})
		const m = bm(`pingpong|${color}`, { color: "#ffffff", map: maps.map, normalMap: maps.normal, roughness: 0.42, clearcoat: 0.22, clearcoatRoughness: 0.3, envMap: studio(), envMapIntensity: 0.9 }, { tint: 1, diffIbl: 0.75 })
		return kit.group(ball(r, m))
	})

	// ================================================================ TENNIS BALL: optic-yellow felt (fluorescent, sheen + fuzz), the white curved seam sunk below the puffy felt
	addModel("tennis-ball", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		const seam = seamCurve(480, 0.3, [0.45, 0.2, 0.35])
		const maps = memo(`tennis|${color}`, () => {
			const W = 1024
			const H = 512
			const R = 0.0335
			// the white strip (about 3.5 mm wide) and the puffed halo of felt round it, as masks
			const white = maskOf(W, H, (g) => ribbon(g, W, H, seam, 0.052, true), 3)
			const groove = maskOf(W, H, (g) => ribbon(g, W, H, seam, 0.115, true), 5)
			// the slowly varying terms come off coarse grids: the fibre direction, a low and a mid mottling
			const dir = coarse(128, 64, 2, (dx, dy, dz, out) => {
				const a = 6.2832 * fbm(dx * 3 + 1.7, dy * 3, dz * 3, 2)
				out[0] = Math.cos(a)
				out[1] = Math.sin(a)
			})
			const low = coarse(256, 128, 1, (dx, dy, dz, out) => (out[0] = fbm(dx * 5, dy * 5, dz * 5, 3)))
			const mid = coarse(512, 256, 1, (dx, dy, dz, out) => (out[0] = noise3(dx * 38, dy * 38, dz * 38)))
			const hts = new Float32Array(W * H)
			const v2 = new Float32Array(2)
			const vl = new Float32Array(1)
			const vm = new Float32Array(1)
			const b0 = base[0] * 0.92 // a touch greener: the optic yellow of a real ball
			const b1 = base[1]
			const b2 = base[2] * 0.92
			const [o] = bake(W, H, 1, (p, outs) => {
				const idx = p.y * W + p.x
				// felt fibres: noise stretched along a slowly turning direction in the surface
				samp(dir, p.x, p.y, W, H, v2)
				const tx = v2[0] * p.ex + v2[1] * p.nx
				const ty = v2[0] * p.ey + v2[1] * p.ny
				const tz = v2[0] * p.ez + v2[1] * p.nz
				const qx = p.dx * 100
				const qy = p.dy * 100
				const qz = p.dz * 100
				const dt = (qx * tx + qy * ty + qz * tz) * 0.8
				const fib = noise3(qx - dt * tx, qy - dt * ty, qz - dt * tz)
				const fine = hash2(p.x, p.y, 3) - 0.5
				samp(mid, p.x, p.y, W, H, vm)
				samp(low, p.x, p.y, W, H, vl)
				const gr = groove[idx]
				const k = 1 + 0.16 * fib + 0.07 * fine + 0.06 * vm[0] + 0.05 * vl[0]
				let wh = 0
				if (gr > 0.004) {
					const rag = noise3(p.dx * 70 + 2, p.dy * 70, p.dz * 70)
					wh = smooth(0.32, 0.68, white[idx] + 0.3 * rag + 0.14 * fib) // a ragged edge, fibres fraying over it
				}
				const dk = 1 - 0.22 * gr * (1 - wh)
				const fk = 1 + 0.09 * fib + 0.05 * fine + 0.04 * vm[0]
				const i = p.i
				outs[0][i] = (b0 * k * dk) * (1 - wh) + 236 * fk * wh
				outs[0][i + 1] = (b1 * k * dk) * (1 - wh) + 238 * fk * wh
				outs[0][i + 2] = (b2 * k * dk) * (1 - wh) + 222 * fk * wh
				outs[0][i + 3] = 255
				const rim = gr * (1 - white[idx])
				hts[idx] = 0.000084 * fine + 0.00007 * fib + 0.00003 * vm[0] - 0.0004 * wh + 0.00022 * rim
			})
			return { map: texOf(canvasOf(W, H, o)), normal: texOf(canvasOf(W, H, normalsOf(hts, W, H, R, 1)), { data: true }) }
		})
		const sheen = hexOf(mix3(base, [244, 255, 192], 0.3))
		// the fuzz shells' own sheen stays near the felt colour: a whitish one rims the backlit limb with a glassy grey line
		const sheenShell = hexOf(mix3(base, [244, 255, 192], 0.12))
		const m = bm(`tennis|${color}`, {
			color: "#ffffff", map: maps.map, normalMap: maps.normal, roughness: 1, sheen: 1, sheenRoughness: 0.35, sheenColor: sheen,
			emissive: "#ffffff", emissiveMap: maps.map, emissiveIntensity: 0.2, envMapIntensity: 1,
		}, { tint: 0.9, boost: 1 })
		// alpha-to-coverage turns the cut-out fibre tips into a soft fringe instead of hard dashes that show the darker core. Its partial alpha must not reach the canvas
		// (the page would show through the fleck edges as pale outlines): the blend keeps the alpha already there and writes the colour as an opaque surface does.
		// The flecks: about 0.14 mm cells on the real ball (1536 round it, as the felt texture's), scaling with the ball
		const shell = (rad, thr, k) =>
			kit.mesh(kit.sphere(rad, 96, 48), bm(`tennis|fuzz3|${color}|${thr}`, {
				color: "#ffffff", map: maps.map, alphaTest: thr, alphaToCoverage: true, roughness: 1, sheen: 0.7, sheenRoughness: 0.35, sheenColor: sheenShell,
				emissive: "#ffffff", emissiveMap: maps.map, emissiveIntensity: 0.2, envMapIntensity: 1,
				blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor,
				blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
			}, { tint: 0.85 * k, boost: 1, fuzz: { freq: 1536 / TAU, lo: 0.165, hi: 0.377, mlo: 0.8, mhi: 2 } }), { cast: false })
		// a core just under the surface and two thin shells of loose fibres: the outline is the felt's tips. The felt is 0.8 mm deep on a real (67 mm) ball; a smaller
		// one would show only its core (the shells' flecks fade out below a pixel), so the depth scales down with the ball (kt) and the drawn ball fills its outline
		const kt = Math.min(1, r / 0.0335)
		return kit.group(kit.mesh(kit.sphere(r - 0.0008 * kt, 96, 48), m), shell(r - 0.0004 * kt, 0.42, 1.02), shell(r, 0.7, 1.08))
	})

	// ================================================================ GOLF BALL: glossy white with ~330 real dimples, an undimpled parting line
	addModel("golf-ball", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		const maps = memo(`golf|${color}`, () => {
			const ns = norm([0.5, 0.35, 0.5]) // the pole of the parting line's plane
			const band = 0.024 // half the width of the smooth stripe (rad): the line is about 1 mm wide
			const N = 330
			const spacing = Math.sqrt(14.51 / N)
			const rho = 0.47 * spacing
			const cosRho = Math.cos(rho)
			// one hemisphere in rings of a hexagon-like packing (the first ring starts band + rho above the parting plane), then mirrored across the plane
			const e1 = norm(cross(ns, [0.31, 0.2, -0.93]))
			const e2 = cross(ns, e1)
			const upper = []
			const rowStep = spacing * 0.866
			let e = band + rho
			for (let k = 0; e < PI / 2 - 0.95 * spacing; k++, e += rowStep) {
				const n = Math.max(3, Math.round((TAU * Math.cos(e)) / spacing)) // round, so every ring closes with an even pitch
				for (let i = 0; i < n; i++) {
					const a2 = ((i + (k % 2) * 0.5) / n) * TAU
					const ce = Math.cos(e) * Math.cos(a2)
					const cs = Math.cos(e) * Math.sin(a2)
					upper.push(norm([ce * e1[0] + cs * e2[0] + Math.sin(e) * ns[0], ce * e1[1] + cs * e2[1] + Math.sin(e) * ns[1], ce * e1[2] + cs * e2[2] + Math.sin(e) * ns[2]]))
				}
			}
			upper.push(ns) // one at the pole
			const pts = []
			for (const c of upper) {
				pts.push(c)
				const d = dot(c, ns)
				pts.push([c[0] - 2 * d * ns[0], c[1] - 2 * d * ns[1], c[2] - 2 * d * ns[2]]) // its mirror image across the parting plane
			}
			// a grid of cells (side 0.111, at least rho): each lists the dimples within one cell of it, so a pixel only tests a handful
			const G = 18
			const cell = (v) => Math.min(G - 1, Math.max(0, Math.floor(((v + 1) / 2) * G)))
			const grid = new Map()
			for (const c of pts) {
				const cx = cell(c[0])
				const cy = cell(c[1])
				const cz = cell(c[2])
				for (let a = -1; a <= 1; a++)
					for (let b = -1; b <= 1; b++)
						for (let d = -1; d <= 1; d++) {
							const kx = cx + a
							const ky = cy + b
							const kz = cz + d
							if (kx < 0 || ky < 0 || kz < 0 || kx >= G || ky >= G || kz >= G) continue
							const key = (kx * G + ky) * G + kz
							let l = grid.get(key)
							if (!l) grid.set(key, (l = []))
							l.push(c)
						}
			}
			// the nearest dimple to the pixel (largest dot); returns null on land
			let bestC = null
			let bestD = 0
			const eval1 = (p) => {
				const l = grid.get((cell(p.dx) * G + cell(p.dy)) * G + cell(p.dz))
				if (!l) return false
				let bd = -2
				let best = null
				for (let i = 0; i < l.length; i++) {
					const c = l[i]
					const d = p.dx * c[0] + p.dy * c[1] + p.dz * c[2]
					if (d > bd) {
						bd = d
						best = c
					}
				}
				if (bd < cosRho) return false
				bestC = best
				bestD = bd
				return true
			}
			const NW = 1536
			const NH = 768
			const [n] = bake(NW, NH, 1, (p, outs) => {
				if (!eval1(p)) {
					putN(outs[0], p.i, 0, 0)
					return
				}
				const a = awayFrom(p, bestC)
				const s = a.ang / rho
				const dh = 0.24 * s * (1 - smooth(0.9, 1, s)) // a spherical cap with a crisp rim
				putN(outs[0], p.i, dh * a.ex, dh * a.ey)
			})
			const CW = 768
			const CH = 384
			const [c] = bake(CW, CH, 1, (p, outs) => {
				let k = 1
				if (eval1(p)) {
					const s = Math.acos(clamp(bestD, -1, 1)) / rho
					k = 1 - 0.09 * (1 - s * s) ** 2
				}
				const i = p.i
				outs[0][i] = base[0] * k
				outs[0][i + 1] = base[1] * k
				outs[0][i + 2] = base[2] * k
				outs[0][i + 3] = 255
			})
			return { map: texOf(canvasOf(CW, CH, c)), normal: texOf(canvasOf(NW, NH, n), { data: true }) }
		})
		const m = bm(`golf|${color}`, { color: "#ffffff", map: maps.map, normalMap: maps.normal, roughness: 0.26, clearcoat: 0.35, clearcoatRoughness: 0.12, clearcoatNormalMap: maps.normal, envMap: studio(), envMapIntensity: 1 }, { tint: 0.96, diffIbl: 0.6 })
		return kit.group(ball(r, m))
	})

	// ================================================================ BASEBALL: white leather, a seam, 108 raised red double stitches (real geometry)
	addModel("baseball", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		const seamPts = seamCurve(600, 0.4, [0.5, 0.35, 0.18])
		// the stitch plan: 108 stitches along the seam; each is a V whose two threads leave a hole either side of the seam and meet on its centre line a little further on
		const plan = memo("baseball|plan", () => {
			const NP = seamPts.length
			const len = [0]
			for (let i = 1; i <= NP; i++) {
				const a = seamPts[i - 1]
				const b = seamPts[i % NP]
				len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))
			}
			const L = len[NP]
			const at = (s) => {
				s = ((s % L) + L) % L
				let lo = 0
				let hi = NP
				while (hi - lo > 1) {
					const mid = (lo + hi) >> 1
					if (len[mid] <= s) lo = mid
					else hi = mid
				}
				const t = (s - len[lo]) / (len[hi] - len[lo] || 1)
				const a = seamPts[lo]
				const b = seamPts[hi % NP]
				const pos = norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
				const tan = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]])
				return { pos, side: norm(cross(pos, tan)) }
			}
			const stitches = 108
			const pitch = L / stitches
			const lat = 0.0029 / 0.037 // half spread of a stitch across the seam, in radians: an angle, so the stitching is the same at every size (drawn for the 7.4 cm ball)
			const hole = (s, sign) => {
				const q = at(s)
				return norm([q.pos[0] + q.side[0] * sign * lat, q.pos[1] + q.side[1] * sign * lat, q.pos[2] + q.side[2] * sign * lat])
			}
			const holes = []
			const centres = []
			const threads = []
			for (let i = 0; i < stitches; i++) {
				const s = i * pitch
				const A = hole(s, -1)
				const B = hole(s, 1)
				const C = at(s + 0.62 * pitch).pos
				holes.push(A, B)
				centres.push(C)
				threads.push([A, C], [B, C])
			}
			return { holes, centres, threads }
		})
		const maps = memo(`baseball|${color}`, () => {
			const W = 1280
			const H = 640
			const R = 0.037 // the heights below are millimetres on the standard 7.4 cm ball: the maps are the same picture at every size (a resize never re-bakes them)
			const ringDirs = (h, rad) => {
				const t1 = norm(cross(h, [0.31, 0.93, 0.2]))
				const t2 = cross(h, t1)
				return Array.from({ length: 8 }, (_, i) => {
					const a = (i / 8) * TAU
					const ca = Math.sin(rad) * Math.cos(a)
					const sa = Math.sin(rad) * Math.sin(a)
					const k = Math.cos(rad)
					return norm([h[0] * k + t1[0] * ca + t2[0] * sa, h[1] * k + t1[1] * ca + t2[1] * sa, h[2] * k + t1[2] * ca + t2[2] * sa])
				})
			}
			// one drawing of the seam ribbon: its blurred copy is the soft crease, the barely blurred copy the dark seam line
			const ribbonRaw = maskOf(W, H, (g) => ribbon(g, W, H, seamPts, 0.05, true), 0)
			const dark = maskOf(W, H, (g) => ribbon(g, W, H, seamPts, 0.012, true), 1)
			const soft = blur(ribbonRaw, W, H, 6)
			const dots = maskOf(W, H, (g) => {
				for (const h of plan.holes) fillPoly(g, W, H, ringDirs(h, 0.0135))
				for (const c of plan.centres) fillPoly(g, W, H, ringDirs(c, 0.009))
			}, 1)
			// the leather's mottling comes off coarse grids; only the finest grain is worked out per pixel
			const g2 = coarse(512, 256, 1, (dx, dy, dz, out) => (out[0] = noise3(dx * 40 + 3, dy * 40, dz * 40)))
			const lowG = coarse(256, 128, 1, (dx, dy, dz, out) => (out[0] = fbm(dx * 4, dy * 4, dz * 4, 2)))
			const vg = new Float32Array(1)
			const vl = new Float32Array(1)
			const hts = new Float32Array(W * H)
			const [o] = bake(W, H, 1, (p, outs) => {
				const idx = p.y * W + p.x
				const grain = noise3(p.dx * 95, p.dy * 95, p.dz * 95)
				samp(g2, p.x, p.y, W, H, vg)
				samp(lowG, p.x, p.y, W, H, vl)
				const low = vl[0]
				const grain2 = vg[0]
				const k = 1 + 0.025 * grain + 0.02 * grain2 + 0.035 * low
				const warm = 0.18 * smooth(-0.2, 0.8, low) // a faint warm cast, like aged leather
				const sh = 1 - 0.22 * soft[idx] - 0.38 * dark[idx]
				const dt = 0.75 * dots[idx]
				const i = p.i
				outs[0][i] = (((base[0] * k) * (1 - warm) + 226 * warm) * sh) * (1 - dt) + 74 * dt
				outs[0][i + 1] = (((base[1] * k) * (1 - warm) + 214 * warm) * sh) * (1 - dt) + 48 * dt
				outs[0][i + 2] = (((base[2] * k) * (1 - warm) + 186 * warm) * sh) * (1 - dt) + 36 * dt
				outs[0][i + 3] = 255
				hts[idx] = 0.00005 * grain + 0.00004 * grain2 - 0.0004 * soft[idx] - 0.0007 * dark[idx] - 0.0005 * dots[idx]
			})
			return { map: texOf(canvasOf(W, H, o)), normal: texOf(canvasOf(W, H, normalsOf(hts, W, H, R, 1)), { data: true }) }
		})
		const leather = bm(`baseball|${color}`, { color: "#ffffff", map: maps.map, normalMap: maps.normal, roughness: 0.62, clearcoat: 0.12, clearcoatRoughness: 0.45, envMapIntensity: 1 }, { tint: 0.82 })
		// the threads: 216 short tubes that dive into the holes and lie just proud of the leather between them, built straight into one geometry
		// the stitching is the standard ball's scaled with it (k), except that no thread may stand more than ~0.6 mm out of the physics sphere: heights stop growing at k = 1 (the thread flattens into a ribbon on a big ball, its width and length still scale)
		const k = r / 0.037
		const kl = Math.min(k, 1)
		const rr = r - 0.0003 * kl // the leather's surface
		const geo = kit.geo(`baseball|stitches|${f6(r)}`, () => {
			const NU = 6
			const NR = 5
			const tubeW = 0.00046 * k // the thread's half width across the seam
			const tubeH = Math.min(0.00046 * k, 0.0005) // and its half height out of the leather
			const nT = plan.threads.length
			const nv = nT * (NU + 1) * NR
			const pos = new Float32Array(nv * 3)
			const nor = new Float32Array(nv * 3)
			const idx = new Uint16Array(nT * NU * NR * 6)
			const P = Array.from({ length: NU + 1 }, () => [0, 0, 0])
			let vi = 0
			let ii = 0
			for (let t = 0; t < nT; t++) {
				const [Hh, C] = plan.threads[t]
				const u = arc(Hh, C, NU)
				for (let i = 0; i <= NU; i++) {
					const f = i / NU
					const off = kl * (0.0004 * Math.sin(PI * f) ** 0.35 - 0.0008 * (1 - f) ** 6 - 0.0007 * f ** 6) // dives into the hole, lies proud between, dips under at the centre line
					const rad = rr + off
					P[i][0] = u[i][0] * rad
					P[i][1] = u[i][1] * rad
					P[i][2] = u[i][2] * rad
				}
				const base0 = vi
				for (let i = 0; i <= NU; i++) {
					const a = P[Math.max(0, i - 1)]
					const b = P[Math.min(NU, i + 1)]
					const tg = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]])
					// the frame: N = the radial direction made square to the tangent, B = T x N
					const ru = u[i]
					const d = ru[0] * tg[0] + ru[1] * tg[1] + ru[2] * tg[2]
					const N = norm([ru[0] - tg[0] * d, ru[1] - tg[1] * d, ru[2] - tg[2] * d])
					const B = cross(tg, N)
					for (let j = 0; j < NR; j++) {
						const an = (j / NR) * TAU
						const c = Math.cos(an)
						const s = Math.sin(an)
						// an ellipse: tubeH along the radial N, tubeW across the seam along B (its normal is the gradient c/tubeH, s/tubeW)
						pos[vi * 3] = P[i][0] + tubeH * c * N[0] + tubeW * s * B[0]
						pos[vi * 3 + 1] = P[i][1] + tubeH * c * N[1] + tubeW * s * B[1]
						pos[vi * 3 + 2] = P[i][2] + tubeH * c * N[2] + tubeW * s * B[2]
						const ex = (c / tubeH) * N[0] + (s / tubeW) * B[0]
						const ey = (c / tubeH) * N[1] + (s / tubeW) * B[1]
						const ez = (c / tubeH) * N[2] + (s / tubeW) * B[2]
						const el = Math.hypot(ex, ey, ez) || 1
						nor[vi * 3] = ex / el
						nor[vi * 3 + 1] = ey / el
						nor[vi * 3 + 2] = ez / el
						vi++
					}
				}
				for (let i = 0; i < NU; i++)
					for (let j = 0; j < NR; j++) {
						const a = base0 + i * NR + j
						const b = base0 + i * NR + ((j + 1) % NR)
						const c = a + NR
						const d = b + NR
						idx[ii++] = a
						idx[ii++] = b
						idx[ii++] = c
						idx[ii++] = b
						idx[ii++] = d
						idx[ii++] = c
					}
			}
			const g = new THREE.BufferGeometry()
			g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
			g.setAttribute("normal", new THREE.BufferAttribute(nor, 3))
			g.setIndex(new THREE.BufferAttribute(idx, 1))
			return g
		})
		const thread = bm("baseball|thread", { color: "#80101a", roughness: 0.74, sheen: 0.6, sheenRoughness: 0.4, sheenColor: "#c03040", envMapIntensity: 0.6 }, { tint: 0.85 })
		return kit.group(ball(rr, leather, [96, 48]), kit.mesh(geo, thread))
	})

	// ================================================================ BASKETBALL: pebbled orange rubber, black channels
	addModel("basketball", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		const maps = memo(`basketball|${color}`, () => {
			const W = 1536
			const H = 768
			const R = 0.121
			// the two curved channels are closed loops round +x and -x: they come within about 10 degrees of the poles but never touch the meridian
			const loop = (sx) => Array.from({ length: 200 }, (_, i) => {
				const psi = (i / 200) * TAU
				const rho = 1.03 + 0.36 * Math.cos(2 * psi)
				return norm([sx * Math.cos(rho), Math.sin(rho) * Math.cos(psi), Math.sin(rho) * Math.sin(psi)])
			})
			const hw = 0.024
			// the channels, drawn once: the equator is a band of rows; each meridian (through front and back) is a band hw wide on the sphere, so hw / sin(theta)
			// wide in longitude, and the whole row at the poles: no ribbon degenerating there
			const raw = maskOf(W, H, (g) => {
				const yh = (hw / PI) * H
				g.fillRect(0, H / 2 - yh, W, 2 * yh)
				const shw = Math.sin(hw)
				for (let y = 0; y < H; y++) {
					const s = shw / Math.sin(((y + 0.5) / H) * PI)
					if (s >= 1) {
						g.fillRect(0, y, W, 1)
						continue
					}
					const dx = (Math.asin(s) / TAU) * W
					g.fillRect(W / 4 - dx, y, 2 * dx, 1)
					g.fillRect((3 * W) / 4 - dx, y, 2 * dx, 1)
				}
				for (const sx of [-1, 1]) ribbon(g, W, H, loop(sx), hw, true)
			}, 0)
			const chan = blur(raw.slice(), W, H, 1)
			const soft = blur(raw, W, H, 2)
			// the inflation valve: a small recessed black dot inside one panel, in a smooth flat disc (no pebbles)
			const vc = norm([0.28, -0.5, 0.82])
			const cV0 = Math.cos(0.021)
			const cV1 = Math.cos(0.016)
			const cF0 = Math.cos(0.064)
			const cF1 = Math.cos(0.046)
			// pebbles: rings of jittered cells, each a little dome (cell centres worked out once)
			const rows = Math.round(PI / 0.0155)
			const dth = PI / rows
			const nj = new Int32Array(rows)
			const start = new Int32Array(rows + 1)
			for (let j = 0; j < rows; j++) {
				nj[j] = Math.max(1, Math.round((TAU * Math.sin((j + 0.5) * dth)) / dth))
				start[j + 1] = start[j] + nj[j]
			}
			const cPh = new Float32Array(start[rows])
			const cTh = new Float32Array(start[rows])
			const cAmp = new Float32Array(start[rows])
			for (let j = 0; j < rows; j++)
				for (let k = 0; k < nj[j]; k++) {
					const dph = TAU / nj[j]
					cPh[start[j] + k] = (k + 0.5) * dph + (hash2(j, k, 1) - 0.5) * 0.55 * dph
					cTh[start[j] + k] = (j + 0.5) * dth + (hash2(j, k, 2) - 0.5) * 0.55 * dth
					cAmp[start[j] + k] = 0.85 + 0.15 * hash2(j, k, 3)
				}
			const inv = 1 / (0.66 * dth) ** 2
			const mott = coarse(128, 64, 1, (dx, dy, dz, out) => (out[0] = noise3(dx * 6, dy * 6, dz * 6)))
			const vm = new Float32Array(1)
			const hts = new Float32Array(W * H)
			const [o] = bake(W, H, 1, (p, outs) => {
				const idx = p.y * W + p.x
				const ph = ((p.x + 0.5) / W) * TAU
				const dv = p.dx * vc[0] + p.dy * vc[1] + p.dz * vc[2]
				const valve = smooth(cV0, cV1, dv)
				const flat = smooth(cF0, cF1, dv)
				let hp = 0
				if (flat < 1) {
					// the dome of the pebble that covers this point: its row is j0 or the neighbour on the near side, likewise its cell in the row
					const fj = p.th / dth
					const j0 = Math.floor(fj)
					const ja = fj - j0 < 0.5 ? j0 - 1 : j0
					for (let j = ja; j <= ja + 1; j++) {
						if (j < 0 || j >= rows) continue
						const n = nj[j]
						const dph = TAU / n
						const kf = ph / dph
						const k0 = Math.floor(kf)
						const kLo = n < 24 ? k0 - 1 : kf - k0 < 0.5 ? k0 - 1 : k0
						const kHi = n < 24 ? k0 + 1 : kLo + 1
						for (let k = kLo; k <= kHi; k++) {
							const kk = ((k % n) + n) % n
							const ci = start[j] + kk
							let dphi = ph - cPh[ci]
							if (dphi > PI) dphi -= TAU
							else if (dphi < -PI) dphi += TAU
							const dx = dphi * p.st
							const dy = p.th - cTh[ci]
							const s2 = (dx * dx + dy * dy) * inv
							if (s2 < 1) {
								const v = Math.sqrt(1 - s2) * cAmp[ci]
								if (v > hp) hp = v
							}
						}
					}
					hp *= 1 - flat
				}
				const cm = chan[idx]
				const sm = soft[idx]
				samp(mott, p.x, p.y, W, H, vm)
				const kc = (0.88 + 0.2 * hp + 0.03 * vm[0] + 0.05 * flat) * (1 - 0.3 * sm)
				const dm = smooth(0.3, 0.75, cm > valve ? cm : valve)
				const i = p.i
				outs[0][i] = base[0] * kc * (1 - dm) + 14 * dm
				outs[0][i + 1] = base[1] * kc * (1 - dm) + 10 * dm
				outs[0][i + 2] = base[2] * kc * (1 - dm) + 8 * dm
				outs[0][i + 3] = 255
				hts[idx] = (hp - 1) * 0.0003 * (1 - cm) * (1 - valve) - 0.0018 * sm - 0.0007 * valve
			})
			return { map: texOf(canvasOf(W, H, o)), normal: texOf(canvasOf(W, H, normalsOf(hts, W, H, R, 1)), { data: true }) }
		})
		const m = bm(`basketball|${color}`, { color: "#ffffff", map: maps.map, normalMap: maps.normal, roughness: 0.62, clearcoat: 0.1, clearcoatRoughness: 0.5, emissive: "#ffffff", emissiveMap: maps.map, emissiveIntensity: 0.06, envMap: studio(), envMapIntensity: 0.8 }, { tint: 0.85 })
		return kit.group(ball(r, m))
	})

	// ================================================================ SOCCER BALL: truncated icosahedron, 12 black pentagons and 20 white hexagons, puffed panels, stitched seams
	const soccerData = () =>
		memo("soccer|data", () => {
			const phi = (1 + Math.sqrt(5)) / 2
			let V = []
			for (const a of [-1, 1]) for (const b of [-1, 1]) V.push(norm([0, a, b * phi]), norm([a, b * phi, 0]), norm([b * phi, 0, a]))
			const to = new THREE.Vector3(...norm([0.12, 0.22, 1]))
			const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...V[0]), to)
			const spin = new THREE.Quaternion().setFromAxisAngle(to, 0.35)
			q.premultiply(spin)
			V = V.map((v) => {
				const t = new THREE.Vector3(...v).applyQuaternion(q)
				return [t.x, t.y, t.z]
			})
			const adj = (a, b) => Math.abs(dot(a, b) - 1 / Math.sqrt(5)) < 1e-3
			const nb = V.map((v, i) => V.map((_, j) => j).filter((j) => j !== i && adj(v, V[j])))
			const centres = []
			const hs = []
			const pent = []
			V.forEach((v, i) => {
				const j = nb[i][0]
				centres.push(v)
				hs.push(dot(norm([2 * v[0] + V[j][0], 2 * v[1] + V[j][1], 2 * v[2] + V[j][2]]), v) * Math.hypot(2 * v[0] + V[j][0], 2 * v[1] + V[j][1], 2 * v[2] + V[j][2]) / 3)
				pent.push(true)
			})
			for (let i = 0; i < 12; i++)
				for (let j = i + 1; j < 12; j++)
					for (let k = j + 1; k < 12; k++)
						if (adj(V[i], V[j]) && adj(V[j], V[k]) && adj(V[i], V[k])) {
							const f = norm([V[i][0] + V[j][0] + V[k][0], V[i][1] + V[j][1] + V[k][1], V[i][2] + V[j][2] + V[k][2]])
							const pt = [(2 * V[i][0] + V[j][0]) / 3, (2 * V[i][1] + V[j][1]) / 3, (2 * V[i][2] + V[j][2]) / 3]
							centres.push(f)
							hs.push(dot(pt, f))
							pent.push(false)
						}
			const P = (i, j) => norm([2 * V[i][0] + V[j][0], 2 * V[i][1] + V[j][1], 2 * V[i][2] + V[j][2]])
			const edges = []
			for (let i = 0; i < 12; i++) {
				for (const j of nb[i]) if (i < j) edges.push([P(i, j), P(j, i)])
				for (const j of nb[i]) for (const k of nb[i]) if (j < k && adj(V[j], V[k])) edges.push([P(i, j), P(i, k)])
			}
			return { centres, hs, pent, edges }
		})
	addModel("soccer-ball", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		const maps = memo(`soccer|${color}`, () => {
			const { centres, hs, pent, edges } = soccerData()
			const black = [24, 24, 27]
			const seamCol = [96, 96, 98]
			// the 32 panel centres flat (x, y, z, 1 / reach), each panel's own tone
			const pc = new Float64Array(32 * 4)
			const jit = new Float64Array(32)
			for (let k = 0; k < 32; k++) {
				pc[k * 4] = centres[k][0]
				pc[k * 4 + 1] = centres[k][1]
				pc[k * 4 + 2] = centres[k][2]
				pc[k * 4 + 3] = 1 / hs[k]
				jit[k] = 0.97 + 0.05 * hash2(k, 1, 5)
			}
			// the 6 nearest panels of each cell of a 128 x 64 direction grid (cells are under 3 degrees, a panel is 40): a pixel tests only those 6, not all 32 (checked against all 32: no pixel differs)
			const GW = 128
			const GH = 64
			const cand = new Uint8Array(GW * GH * 6)
			const sc = new Float64Array(32)
			for (let gy = 0; gy < GH; gy++) {
				const th = ((gy + 0.5) / GH) * PI
				const st = Math.sin(th)
				const ct = Math.cos(th)
				for (let gx = 0; gx < GW; gx++) {
					const ph = ((gx + 0.5) / GW) * TAU
					const dx = -Math.cos(ph) * st
					const dz = Math.sin(ph) * st
					for (let k = 0; k < 32; k++) sc[k] = (dx * pc[k * 4] + ct * pc[k * 4 + 1] + dz * pc[k * 4 + 2]) * pc[k * 4 + 3]
					for (let m = 0; m < 6; m++) {
						let bi = 0
						for (let k = 1; k < 32; k++) if (sc[k] > sc[bi]) bi = k
						cand[(gy * GW + gx) * 6 + m] = bi
						sc[bi] = -9
					}
				}
			}
			// best and second-best panel score at a pixel (scores are the dot with the centre over the panel's reach; their gap is the distance to the seam)
			let bestK = 0
			let gapV = 0
			const nearest = (p, W, H) => {
				const ci = (Math.floor((p.y * GH) / H) * GW + Math.floor((p.x * GW) / W)) * 6
				let best = -9
				let second = -9
				for (let m = 0; m < 6; m++) {
					const k = cand[ci + m]
					const s = (p.dx * pc[k * 4] + p.dy * pc[k * 4 + 1] + p.dz * pc[k * 4 + 2]) * pc[k * 4 + 3]
					if (s > best) {
						second = best
						best = s
						bestK = k
					} else if (s > second) second = s
				}
				gapV = best - second
			}
			// the colour map keeps the seams crisp (2048 wide); the panel puff (the normal map) is smooth and gets 1024
			const W = 2048
			const H = 1024
			const [o] = bake(W, H, 1, (p, outs) => {
				nearest(p, W, H)
				const edge = (1 - smooth(0.002, 0.011, gapV)) * (pent[bestK] ? 0.45 : 0.8)
				const j = pent[bestK] ? 1 : jit[bestK]
				const i = p.i
				outs[0][i] = (pent[bestK] ? black[0] : base[0] * j) * (1 - edge) + seamCol[0] * edge
				outs[0][i + 1] = (pent[bestK] ? black[1] : base[1] * j) * (1 - edge) + seamCol[1] * edge
				outs[0][i + 2] = (pent[bestK] ? black[2] : base[2] * j) * (1 - edge) + seamCol[2] * edge
				outs[0][i + 3] = 255
			})
			const cv = canvasOf(W, H, o)
			const g = cv.getContext("2d")
			// the stitching: short threads across every seam
			g.fillStyle = css([188, 186, 178], 0.4)
			for (const [A, B] of edges) {
				const ln = arc(A, B, 24)
				const len = Math.acos(clamp(dot(A, B), -1, 1))
				const n = Math.max(4, Math.round(len / 0.036))
				for (let i = 0; i < n; i++) {
					const t = (i + 0.5) / n
					const k = Math.min(23, Math.floor(t * 24))
					const pa = ln[k]
					const pb = ln[k + 1]
					const m = norm([pa[0] + pb[0], pa[1] + pb[1], pa[2] + pb[2]])
					const tan = norm([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]])
					const side = norm(cross(m, tan))
					const e1 = norm([m[0] - side[0] * 0.007, m[1] - side[1] * 0.007, m[2] - side[2] * 0.007])
					const e2 = norm([m[0] + side[0] * 0.007, m[1] + side[1] * 0.007, m[2] + side[2] * 0.007])
					ribbon(g, W, H, [e1, e2], 0.0022)
				}
			}
			const NW = 1024
			const NH = 512
			const [nrm] = bake(NW, NH, 1, (p, outs) => {
				nearest(p, NW, NH)
				const a = awayFrom(p, centres[bestK])
				const t = a.ang / (pent[bestK] ? 0.34 : 0.37)
				const sl = 0.3 * Math.min(1.4, t ** 1.4) * smooth(0, 0.0025, gapV)
				putN(outs[0], p.i, -sl * a.ex + 0.012 * (hash2(p.x, p.y, 7) - 0.5), -sl * a.ey + 0.024 * (hash2(p.x, p.y, 6) - 0.5))
			})
			return { map: texOf(cv), normal: texOf(canvasOf(NW, NH, nrm), { data: true }) }
		})
		const m = bm(`soccer|${color}`, { color: "#ffffff", map: maps.map, normalMap: maps.normal, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.25, envMap: studio(), envMapIntensity: 0.9 }, { tint: 0.85, diffIbl: 0.5 })
		return kit.group(ball(r, m))
	})

	// ================================================================ BOWLING BALL: glossy marbled resin, three finger holes (cut out of the shell, lined with tubes)
	addModel("bowling-ball", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		const spec = [[-0.14, 0.5, 0.1, 0.055], [0.14, 0.5, 0.1, 0.055], [0, -0.62, 0.115, 0.065]].map(([x, y, rho, depth]) => {
			const c = Math.cos(0.25)
			const s = Math.sin(0.25)
			const rx = x * c - y * s
			const ry = x * s + y * c
			const a = norm([Math.sin(rx) * Math.cos(ry), Math.sin(ry), Math.cos(rx) * Math.cos(ry)])
			return { a, rho, c: Math.cos(rho), depth }
		})
		const map = memo(`bowling|${color}`, () => {
			const W = 2048 // 0.33 mm a texel over the 685 mm circumference: the resin's veins stay crisp in a close orbit
			const H = 1024
			const c0 = scale3(base, 0.55)
			const c1 = mix3(base, [34, 82, 190], 0.65)
			const c2 = [140, 185, 250]
			// the marbling is a warped fbm: the warps (3 octaves from 1.15 cycles, so smooth) come off a coarse grid, the field itself off a 512 x 256 one, and only
			// the bands (a sine of the field) are worked out per pixel
			const warp = coarse(128, 64, 3, (dx, dy, dz, out) => {
				const x = dx * 1.15
				const y = dy * 1.15
				const z = dz * 1.15
				out[0] = fbm(x, y, z, 3)
				out[1] = fbm(x + 3.1, y + 7.2, z + 1.9, 3)
				out[2] = fbm(x + 6.3, y + 2.2, z + 5.4, 3)
			})
			const w = new Float32Array(3)
			const field = coarse(512, 256, 1, (dx, dy, dz, out, gx, gy) => {
				samp(warp, gx, gy, 512, 256, w)
				out[0] = fbm(dx * 1.15 + 1.8 * w[0], dy * 1.15 + 1.8 * w[1], dz * 1.15 + 1.8 * w[2], 4)
			})
			const vn = new Float32Array(1)
			const [o] = bake(W, H, 1, (p, outs) => {
				samp(field, p.x, p.y, W, H, vn)
				const n = vn[0]
				const band = 0.5 + 0.5 * Math.sin(3.6 * (n + 0.35 * (p.dx * 1.15 + 0.6 * p.dy * 1.15)))
				const t = smooth(0.05, 0.9, band) * smooth(-0.7, 0.2, n)
				const crest = 0.55 * smooth(0.93, 1, band) * smooth(0, 0.6, n)
				const i = p.i
				outs[0][i] = (c0[0] + (c1[0] - c0[0]) * t) * (1 - crest) + c2[0] * crest
				outs[0][i + 1] = (c0[1] + (c1[1] - c0[1]) * t) * (1 - crest) + c2[1] * crest
				outs[0][i + 2] = (c0[2] + (c1[2] - c0[2]) * t) * (1 - crest) + c2[2] * crest
				outs[0][i + 3] = 255
			})
			return texOf(canvasOf(W, H, o))
		})
		const body = bm(`bowling|${color}`, { color: "#ffffff", map, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMap: studio(), envMapIntensity: 1.3 }, { holes: spec.map((h) => ({ a: h.a, c: h.c })) })
		// inside a hole: unlit, black deep down and a dark grey wall near the lip (the key light reaches a little way in); a lit grey wall reads as a shallow dish
		const wallMat = memo("bowling|wall", () => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))
		const floorMat = memo("bowling|floor", () => new THREE.MeshBasicMaterial({ color: 0x000000 }))
		const lip = bm(`bowling|lip|${color}`, { color: hexOf(scale3(base, 0.5)), roughness: 0.3, envMap: studio(), envMapIntensity: 0.5 }, { tint: 1 })
		const parts = [ball(r, body, [128, 64])]
		const up = new THREE.Vector3(0, 1, 0)
		const k = r / 0.109 // the hole details (depth, lip, fade) are drawn for the standard 21.8 cm ball and scale with the ball
		for (const h of spec) {
			const axis = new THREE.Vector3(...h.a)
			const q = new THREE.Quaternion().setFromUnitVectors(up, axis)
			const rt = r * Math.sin(h.rho)
			const top = r * h.c
			const depth = h.depth * k // the bores scale with the ball: a small ball must not have them come out of its far side
			const fadeLen = 0.009 * k
			const wallGeo = kit.geo(`bowl|wall|${f6(rt)}|${f6(depth)}|${f6(fadeLen)}`, () => {
				const g = new THREE.CylinderGeometry(rt, rt * 0.97, depth, 40, 24, true)
				const pa = g.attributes.position
				const col = new Float32Array(pa.count * 3)
				for (let i = 0; i < pa.count; i++) {
					const down = depth / 2 - pa.getY(i) // how far below the lip
					const v = 0.1 * Math.max(0, 1 - down / fadeLen) ** 1.5 // black within a centimetre: seen at an angle the bore must read as dark, not a grey lid
					col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v
				}
				g.setAttribute("color", new THREE.BufferAttribute(col, 3))
				return g
			})
			const tube = kit.mesh(wallGeo, wallMat, { cast: false })
			tube.quaternion.copy(q)
			tube.position.copy(axis).multiplyScalar(top - depth / 2)
			const floor = kit.mesh(kit.geo(`bowl|floor|${f6(rt)}`, () => new THREE.CircleGeometry(rt * 0.97, 40).rotateX(-PI / 2)), floorMat, { cast: false })
			floor.quaternion.copy(q)
			floor.position.copy(axis).multiplyScalar(top - depth)
			// the rounded edge of the hole: its tube sits 1.2 mm below the rim plane, so it is flush with the cover instead of a grommet standing proud
			const ring = kit.mesh(kit.geo(`bowl|lip2|${f6(rt)}|${f6(k)}`, () => new THREE.TorusGeometry(rt, 0.0012 * k, 8, 48).rotateX(PI / 2)), lip, { cast: false })
			ring.quaternion.copy(q)
			ring.position.copy(axis).multiplyScalar(top - 0.0012 * k)
			parts.push(tube, floor, ring)
		}
		return kit.group(parts)
	})

	// ---------------------------------------------------------------- clear glass balls: the lens, and a light shadow
	/** three.js' transmission looks up the picture behind a glass thing one flat slab (the thickness) further along the refracted ray, which makes a glass ball look like a
	 * hollow bubble. A ball is a lens: refract in, cross the sphere (centre = the model's origin, radius = thickness x scale), refract out, and look where that ray goes (4 radii
	 * on): what is behind the marble comes out inverted and shrunk, as through a real one. Per material (its own program), only for balls. */
	function ballLens(m) {
		if (m.userData.ballLens) return
		m.userData.ballLens = true
		const prev = m.onBeforeCompile
		const old = "vec3 refractedRayExit = position + transmissionRay;"
		const lens = `vec3 refractedRayExit;
			{
				vec3 bC = vec3( modelMatrix[ 3 ] );
				float bR = thickness * length( vec3( modelMatrix[ 0 ].xyz ) );
				vec3 bn = normalize( position - bC );
				vec3 t1 = normalize( refract( - v, bn, 1.0 / ior ) );
				float bs = - 2.0 * dot( t1, position - bC );
				vec3 bQ = position + t1 * bs;
				vec3 bo = normalize( bQ - bC );
				vec3 t2 = refract( t1, - bo, ior );
				if ( dot( t2, t2 ) < 0.5 ) t2 = reflect( t1, - bo );
				transmissionRay = t1 * bs;
				refractedRayExit = bQ + normalize( t2 ) * ( 4.0 * bR );
			}`
		m.onBeforeCompile = (shader, renderer) => {
			prev?.(shader, renderer)
			const chunk = THREE.ShaderChunk.transmission_pars_fragment
			if (!chunk.includes(old)) return // a three.js whose chunk differs: leave the stock look rather than break the shader
			shader.fragmentShader = shader.fragmentShader.replace("#include <transmission_pars_fragment>", chunk.split(old).join(lens))
		}
		const key = m.customProgramCacheKey
		m.customProgramCacheKey = () => `${key.call(m)}|balllens`
	}
	// three.js leaves transmissive meshes out of the shadow map. A child that draws nothing in the picture but casts a light shadow: its depth material (for the shadow pass)
	// throws away the fragments whose cell of a 2 x 2 ordered dither, taken in SHADOW-MAP pixels, is above `density`, so every soft-shadow tap meets the same share of opaque texels
	class ShadowProxy extends THREE.Mesh {
		copy(source, recursive) {
			super.copy(source, recursive)
			this.customDepthMaterial = source.customDepthMaterial // (Object3D.copy leaves it out: the model's clones keep it)
			return this
		}
	}
	function glassShadow(geometry, density) {
		const dm = memo(`glassShadow|${density}`, () => {
			const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
			d.onBeforeCompile = (shader) => {
				shader.fragmentShader = shader.fragmentShader.replace(
					"void main() {",
					`float bayer2( vec2 p ) { vec2 q = mod( floor( p ), 2.0 ); float t = q.x < 0.5 ? ( q.y < 0.5 ? 0.0 : 3.0 ) : ( q.y < 0.5 ? 2.0 : 1.0 ); return ( t + 0.5 ) / 4.0; }\nvoid main() {\n\tif ( bayer2( gl_FragCoord.xy ) >= ${density.toFixed(4)} ) discard;`,
				)
			}
			d.customProgramCacheKey = () => `ball-glass-shadow-${density}`
			return d
		})
		const none = memo("glassShadow|none", () => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }))
		const p = new ShadowProxy(geometry, none)
		p.customDepthMaterial = dm
		p.castShadow = true
		p.receiveShadow = false
		p.renderOrder = -1
		return p
	}

	// ================================================================ GLASS MARBLE: clear glass (real transmission), a coloured cat's-eye of twisted vanes inside
	const EYE_APPARENT = 1.35
	addModel("glass-marble", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		// the cat's eye: three leaf-shaped vanes fanning out from the axis (out to 0.22 r), twisted like a propeller, reaching 62% of the way out along the axis;
		// the whole eye is tilted, as a marble's is seen from any side
		const vaneGeo = (list, name) =>
			kit.geo(`marble|${name}|${f6(r)}`, () => {
				const R = r * 0.62
				const U = 40
				const V = 12
				const pos = []
				const col = []
				const idx = []
				for (const k of list) {
					const phi0 = (k / 3) * TAU
					for (const side of [-1, 1]) {
						const b0 = pos.length / 3
						for (let iu = 0; iu <= U; iu++) {
							const u = iu / U
							const th = u * PI
							const y = R * Math.cos(th)
							const rm = 0.44 * R * Math.pow(Math.sin(th), 0.8)
							for (let iv = 0; iv <= V; iv++) {
								const v = iv / V
								const rho = rm * v
								const al = phi0 + 1.8 * (u - 0.5) + side * 0.02 * (1 - v)
								pos.push(rho * Math.cos(al), y, rho * Math.sin(al))
								// thin coloured glass: deepest along the axis (0.85 x the vane colour), lighter towards the leaf's edge (1.2 x), where light crosses less of it
								const m = 0.85 + 0.35 * v * v
								col.push(m, m, m)
							}
						}
						for (let iu = 0; iu < U; iu++)
							for (let iv = 0; iv < V; iv++) {
								const a = b0 + iu * (V + 1) + iv
								const c = a + V + 1
								idx.push(a, c, a + 1, a + 1, c, c + 1)
							}
					}
				}
				const g = new THREE.BufferGeometry()
				g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
				g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
				g.setIndex(idx)
				g.computeVertexNormals()
				return g
			})
		const hsl = {}
		new THREE.Color(...base.map((v) => v / 255)).getHSL(hsl)
		const vaneCol = new THREE.Color().setHSL(hsl.h, clamp(hsl.s * 1.3), hsl.l * 0.8)
		// the cat's eye is drawn AFTER the glass (a transparent-pass mesh): the glass below it is a ball lens that shows an inverted, shrunken picture of what is behind
		// the marble, and a vane in the opaque pass would be run through that mapping and vanish from its own place. The vanes are coloured glass, a little see-through (0.88)
		const vaneMat = bm(`marble|vane3|${color}`, { color: "#" + vaneCol.getHexString(), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, vertexColors: true, side: THREE.DoubleSide, emissive: "#" + vaneCol.getHexString(), emissiveIntensity: 0.12, envMap: studio(), envMapIntensity: 1, transparent: true, opacity: 0.88 }, { tint: 1, diffIbl: 0.6 })
		// no reflection in the glass itself (specularIntensity 0): the shell drawn last adds it over the cat's eye too, as the glass surface in front of it does
		const glass = bm(`marble|glass2|${f6(r)}`, {
			color: "#ffffff", roughness: 0, metalness: 0, transmission: 1, thickness: 1.0 * r, ior: 1.5, attenuationColor: "#cfeee6", attenuationDistance: 0.3,
			specularIntensity: 0, envMap: studio(), envMapIntensity: 1.6, depthWrite: false,
		}, { tint: 1, sat: false })
		ballLens(glass)
		const shell = kit.mat("ball|marble|shell", { color: "#000000", roughness: 0, metalness: 0, specularIntensity: 1, ior: 1.5, envMap: studio(), envMapIntensity: 1.6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
		const vane = kit.mesh(vaneGeo([0, 1, 2], "vB"), vaneMat, { cast: false }) // (its shadow is the glass proxy's)
		vane.rotation.set(0.55, 0, 0.5)
		// the glass in front magnifies an object near the centre by about its index (1.5); the vanes are drawn after the glass, so they are drawn at that apparent size
		// (tips then reach 0.84 r, still inside the ball) instead of at their true, smaller one
		vane.scale.setScalar(EYE_APPARENT)
		vane.renderOrder = 1
		const shellMesh = kit.mesh(kit.sphere(r, 64, 32), shell, { cast: false })
		shellMesh.renderOrder = 2
		return kit.group(vane, kit.mesh(kit.sphere(r, 96, 48), glass, { cast: false }), shellMesh, glassShadow(kit.sphere(r, 32, 16), 0.4))
	})

	// ================================================================ STEEL BALL: a mirror-polished chrome bearing
	addModel("steel-ball", "ball", ({ r }) => {
		const m = bm("steel", { color: "#e4e8ee", metalness: 1, roughness: 0.04, envMap: studio(), envMapIntensity: 1.5 }, { tint: 1, sat: false })
		return kit.group(ball(r, m, [128, 64]))
	})

	// ================================================================ BEACH BALL: six vinyl gores, white caps, welded seams, a valve
	addModel("beach-ball", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		const gores = [[228, 36, 28], [255, 212, 0], [0, 88, 200], [228, 36, 28], [255, 212, 0], [0, 88, 200]]
		const capR = 0.2
		const TILT = 0.42
		const maps = memo(`beach|${color}`, () => {
			// plain scalar loops (no per-pixel objects): a column gives the gore and the angle to the nearest seam (per unit sin theta), a row gives the cap, the cap's
			// rim and the printed circle
			const cols = (W) => {
				const k = new Uint8Array(W)
				const ul = new Float64Array(W)
				const sd = new Float64Array(W)
				for (let x = 0; x < W; x++) {
					const u = ((((x + 0.5) / W) * TAU) / TAU) * 6
					k[x] = Math.floor(u) % 6
					ul[x] = (u - Math.floor(u)) * 2 - 1
					sd[x] = (1 - Math.abs(ul[x])) * (TAU / 12) // x sin(theta) = rad along east to the nearest seam
				}
				return { k, ul, sd }
			}
			const W = 2048
			const H = 1024
			const o = new Uint8ClampedArray(W * H * 4)
			const u32 = new Uint32Array(o.buffer)
			const C = cols(W)
			const rowCol = new Float64Array(18) // the six gores' colours in this row, away from a seam
			for (let y = 0; y < H; y++) {
				const th = ((y + 0.5) / H) * PI
				const st = Math.sin(th)
				const thp = Math.min(th, PI - th)
				const inCap = thp < capR
				const rim = 0.45 * Math.exp(-(((thp - capR) / 0.0055) ** 2))
				const wp = inCap ? 0.5 * Math.exp(-(((thp - capR * 0.52) / 0.004) ** 2)) : 0 // a printed circle on the cap
				const row = y * W
				if (inCap) {
					let cr = 246
					let cg = 246
					let cb = 242
					cr += (190 - cr) * rim
					cg += (190 - cg) * rim
					cb += (186 - cb) * rim
					cr += (120 - cr) * wp
					cg += (130 - cg) * wp
					cb += (150 - cb) * wp
					const i = row * 4
					o[i] = cr
					o[i + 1] = cg
					o[i + 2] = cb
					o[i + 3] = 255
					u32.fill(u32[row], row + 1, row + W)
					continue
				}
				for (let k = 0; k < 6; k++) {
					const c = gores[k]
					rowCol[k * 3] = c[0] + (190 - c[0]) * rim
					rowCol[k * 3 + 1] = c[1] + (190 - c[1]) * rim
					rowCol[k * 3 + 2] = c[2] + (186 - c[2]) * rim
				}
				const near = 0.0075 * 7 // beyond this the weld's whitening is under 1e-21
				for (let x = 0; x < W; x++) {
					const i = (row + x) * 4
					const k = C.k[x]
					const dSeam = C.sd[x] * st
					if (dSeam < near) {
						const w1 = 0.35 * Math.exp(-((dSeam / 0.0075) ** 2)) // the welded seam, a little lighter
						const c = gores[k]
						let cr = c[0] + (255 - c[0]) * w1
						let cg = c[1] + (255 - c[1]) * w1
						let cb = c[2] + (255 - c[2]) * w1
						cr += (190 - cr) * rim
						cg += (190 - cg) * rim
						cb += (186 - cb) * rim
						o[i] = cr
						o[i + 1] = cg
						o[i + 2] = cb
					} else {
						o[i] = rowCol[k * 3]
						o[i + 1] = rowCol[k * 3 + 1]
						o[i + 2] = rowCol[k * 3 + 2]
					}
					o[i + 3] = 255
				}
			}
			// the normals: each gore bulges (a slope across it), the welds dip, the caps' rims are a little ridge; plus a faint slow waviness (off a coarse grid)
			const NW = 1024
			const NH = 512
			const nrm = new Uint8ClampedArray(NW * NH * 4)
			const CN = cols(NW)
			const wav = coarse(256, 128, 2, (dx, dy, dz, out) => {
				out[0] = 0.035 * noise3(dx * 5, dy * 5, dz * 5)
				out[1] = 0.035 * noise3(dx * 5 + 4, dy * 5, dz * 5)
			})
			const v2 = new Float32Array(2)
			const w = 0.012
			for (let y = 0; y < NH; y++) {
				const th = ((y + 0.5) / NH) * PI
				const st = Math.sin(th)
				const thp = Math.min(th, PI - th)
				const inCap = thp < capR
				const ringA = thp - capR
				const gy = 0.5 * (ringA / 0.008) * Math.exp(-((ringA / 0.008) ** 2)) * (th > PI / 2 ? -1 : 1)
				const row = y * NW
				for (let x = 0; x < NW; x++) {
					let gx = 0
					if (!inCap) {
						const ul = CN.ul[x]
						const dSeam = CN.sd[x] * st
						gx = -0.55 * ul + 0.5 * (ul > 0 ? 1 : -1) * (dSeam / w) * Math.exp(-((dSeam / w) ** 2))
					}
					samp(wav, x, y, NW, NH, v2)
					putN(nrm, (row + x) * 4, gx + v2[0], gy + v2[1])
				}
			}
			return { map: texOf(canvasOf(W, H, o)), normal: texOf(canvasOf(NW, NH, nrm), { data: true }) }
		})
		const m = bm(`beach|${color}`, { color: "#ffffff", map: maps.map, normalMap: maps.normal, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.12, emissive: "#ffffff", emissiveMap: maps.map, emissiveIntensity: 0.1, envMap: studio(), envMapIntensity: 0.9 }, { tint: 0.82 })
		// the sphere dips about 1.2 mm along every welded seam (inside r), so the gores bulge a little in the silhouette; the valve and the dip are the real
		// (40 cm) ball's sizes and scale down with a smaller ball (kv), so a small one is not all valve and lobes (and nothing stands out of its sphere by more than 2 mm)
		const kv = Math.min(1, r / 0.2)
		const sphereGeo = kit.geo(`beach|sphere|${f6(r)}`, () => {
			const SW = 144
			const SH = 72
			const g = new THREE.SphereGeometry(r, SW, SH)
			const pos = g.attributes.position
			const v = new THREE.Vector3()
			for (let i = 0; i < pos.count; i++) {
				v.fromBufferAttribute(pos, i)
				const len = v.length()
				let ph = Math.atan2(v.z, -v.x)
				if (ph < 0) ph += TAU
				const th = Math.acos(clamp(v.y / len, -1, 1))
				const u6 = (ph / TAU) * 6
				const dseam = Math.abs(u6 - Math.round(u6)) * (TAU / 6) * Math.sin(th)
				const away = smooth(capR, capR + 0.15, Math.min(th, PI - th))
				const dip = 0.0012 * kv * Math.exp(-((dseam / 0.075) ** 2)) * away
				v.multiplyScalar((len - dip) / len)
				pos.setXYZ(i, v.x, v.y, v.z)
			}
			g.computeVertexNormals()
			const nr = g.attributes.normal
			const n1 = new THREE.Vector3()
			const n2 = new THREE.Vector3()
			for (let iy = 0; iy <= SH; iy++) {
				const a = iy * (SW + 1)
				const b = a + SW
				if (iy === 0 || iy === SH) {
					for (let ix = 0; ix <= SW; ix++) nr.setXYZ(a + ix, 0, iy === 0 ? 1 : -1, 0)
					continue
				}
				n1.fromBufferAttribute(nr, a)
				n2.fromBufferAttribute(nr, b)
				n1.add(n2).normalize()
				nr.setXYZ(a, n1.x, n1.y, n1.z)
				nr.setXYZ(b, n1.x, n1.y, n1.z)
			}
			g.rotateX(TILT) // the tilt is in the geometry: a rotated parent would make the catalog card frame the cube round the sphere
			return g
		})
		// the boss is its own cooler, glossier plastic (a distinct raised ring on the white cap), with a dark band where it meets the vinyl
		const valveMat = bm("beach|valve2", { color: "#e4e6e8", roughness: 0.3, clearcoat: 0.3, envMapIntensity: 0.8 })
		const footMat = bm("beach|valve-foot", { color: "#8d8d88", roughness: 0.6, envMapIntensity: 0.5, side: THREE.DoubleSide })
		const stem = bm("beach|valve-dark", { color: "#2a2b30", roughness: 0.5, envMapIntensity: 0.6 })
		// the valve: a little round boss on the north cap, just proud of the vinyl (under 2 mm)
		const bossPts = [[0, 0.0016], [0.0045, 0.0016], [0.0052, 0.0011], [0.0066, 0.0006], [0.0072, -0.0004], [0, -0.0004]].map(([x, y]) => [x * kv, y * kv])
		const boss = kit.mesh(kit.lathe(bossPts, 28, `valve|${f6(kv)}`), valveMat, { cast: false })
		const hole = kit.mesh(kit.cylinderY(0.0021 * kv, 0.0004 * kv, 20), stem, { cast: false })
		const footPts = [[0.0066, 0.0003], [0.0066, 0.0005], [0.0074, 0.0005], [0.0074, 0.0003]].map(([x, y]) => [x * kv, y * kv])
		const foot = kit.mesh(kit.lathe(footPts, 28, `valveFoot|${f6(kv)}`), footMat, { cast: false })
		for (const [part, h] of [[boss, r - 0.0003 * kv], [hole, r + 0.0014 * kv], [foot, r - 0.0003 * kv]]) {
			part.rotation.x = TILT
			part.position.set(0, h * Math.cos(TILT), h * Math.sin(TILT)) // on the tilted pole
		}
		return kit.group(kit.mesh(sphereGeo, m), boss, foot, hole)
	})

	// ================================================================ WOODEN BALL: turned hardwood, rings cut off-centre so the grain makes arches
	addModel("wooden-ball", "ball", ({ r, color }) => {
		const base = rgbOf(color)
		const map = memo(`wooden|${color}`, () => {
			const W = 1024
			const H = 512
			const axis = norm([0.28, 1, 0.12])
			const e1 = norm(cross(axis, [0, 0, 1]))
			const e2 = cross(axis, e1)
			const c0 = [0.62, 0, -0.4]
			const light = mix3(base, [212, 150, 98], 0.4)
			const dark = scale3(base, 0.5)
			// the wobble of the growth rings is slow (a few cycles round the ball): a coarse grid
			const wob = coarse(256, 128, 1, (dx, dy, dz, out) => (out[0] = 0.22 * fbm(dx * 1.3, dy * 1.3, dz * 1.3, 2) + 0.05 * noise3(dx * 9, dy * 9, dz * 9)))
			const vw = new Float32Array(1)
			const [o] = bake(W, H, 1, (p, outs) => {
				const vx = p.dx - c0[0]
				const vy = p.dy - c0[1]
				const vz = p.dz - c0[2]
				const along = vx * axis[0] + vy * axis[1] + vz * axis[2]
				const px = vx - axis[0] * along
				const py = vy - axis[1] * along
				const pz = vz - axis[2] * along
				const rho = Math.hypot(px, py, pz)
				samp(wob, p.x, p.y, W, H, vw)
				const ringsV = rho * 9 + vw[0]
				const f = ringsV - Math.floor(ringsV)
				const late = smooth(0.45, 0.85, f) * (1 - smooth(0.9, 1, f)) // a soft, wide band of dense late wood
				const fib = noise3(p.dx * e1[0] * 38 + p.dy * e1[1] * 38 + p.dz * e1[2] * 38, p.dx * e2[0] * 38 + p.dy * e2[1] * 38 + p.dz * e2[2] * 38, along * 2.4)
				const lt = 0.1 + 0.25 * late
				const pore = late * smooth(0.93, 0.995, hash2(p.x, p.y, 9)) // little dark pores in the late wood
				const k = (1 + 0.12 * fib) * (1 - 0.2 * pore)
				const i = p.i
				outs[0][i] = (light[0] + (dark[0] - light[0]) * lt) * k
				outs[0][i + 1] = (light[1] + (dark[1] - light[1]) * lt) * k
				outs[0][i + 2] = (light[2] + (dark[2] - light[2]) * lt) * k
				outs[0][i + 3] = 255
			})
			return texOf(canvasOf(W, H, o))
		})
		// oiled hardwood: a thin satin coat, not a milky haze
		const m = bm(`wooden|${color}`, { color: "#ffffff", map, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4, envMap: studio(), envMapIntensity: 0.6 })
		return kit.group(ball(r, m))
	})

	// ================================================================ BILLIARD BALL: glossy phenolic with the white number circles (and a stripe above 8)
	const POOL = [
		[0, [244, 242, 232]], [1, [255, 205, 0]], [2, [26, 70, 170]], [3, [196, 18, 38]], [4, [86, 40, 132]], [5, [238, 112, 34]], [6, [24, 128, 72]], [7, [124, 28, 36]], [8, [20, 20, 22]],
	]
	addModel("billiard-ball", "ball", ({ r, color, solid, props }) => {
		const base = rgbOf(solid?.color ?? color)
		let number = solid?.number ?? props?.number
		if (number === undefined || number === null) {
			let best = 0
			let bd = Infinity
			for (const [n, c] of POOL) {
				const d = (c[0] - base[0]) ** 2 + (c[1] - base[1]) ** 2 + (c[2] - base[2]) ** 2
				if (d < bd) {
					bd = d
					best = n
				}
			}
			number = best
		}
		number = Math.max(0, Math.min(15, Math.round(Number(number))))
		const tone = number === 0 ? POOL[0][1] : (POOL.find(([n]) => n === (number > 8 ? number - 8 : number)) ?? POOL[8])[1]
		const striped = number > 8
		const map = memo(`billiard|${number}|${hexOf(tone)}`, () => {
			const W = 2048
			const H = 1024
			const white = POOL[0][1]
			const dots = number === 0 ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] : []
			const [o] = bake(W, H, 1, (p, outs) => {
				let c = striped ? (Math.abs(p.dy) < 0.52 ? tone : white) : tone
				if (striped) c = mix3(white, tone, smooth(0.535, 0.505, Math.abs(p.dy)))
				for (const d of dots) if (p.dx * d[0] + p.dy * d[1] + p.dz * d[2] > 0.9992) c = [178, 40, 36]
				setRGB(outs[0], p.i, c)
			})
			const cv = canvasOf(W, H, o)
			if (number > 0) {
				const g = cv.getContext("2d")
				const pxr = W / TAU
				for (const u of [0.25, 0.75]) {
					g.fillStyle = "#fbfaf4"
					g.beginPath()
					g.ellipse(W * u, H * 0.5, 0.32 * pxr, 0.32 * pxr, 0, 0, TAU) // about a third of the ball's diameter, like a real pool ball's circle
					g.fill()
					g.fillStyle = "#17171a"
					g.textAlign = "center"
					g.textBaseline = "middle"
					const two = number > 9
					g.font = `700 ${(two ? 0.37 : 0.45) * pxr}px ui-sans-serif, Helvetica, Arial, sans-serif`
					g.fillText(String(number), W * u, H * 0.5 + 0.015 * pxr)
				}
			}
			return texOf(cv)
		})
		const m = bm(`billiard|${number}|${hexOf(tone)}`, { color: "#ffffff", map, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.02, envMap: studio(), envMapIntensity: 0.8 }, { tint: number === 0 ? 0.95 : (tone[0] + tone[1] + tone[2]) / 3 > 150 ? 0.9 : 0.82 })
		return kit.group(ball(r, m, [128, 64]))
	})
	// @@END
}
