// Shared helpers for the surfaces, rods and containers models (surfaces.js, rods.js, containers.js; see web/models3d.js for the frame
// and the kit): tileable noise, baked colour + normal + roughness/metal maps at true scale, the materials of timber, steel, concrete,
// rubber, carpet, glass and ice, boxes whose texture coordinates are in metres, lathes, decals. Everything is built once (the kit
// caches textures, materials and geometries by key) and nothing here runs per frame.
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { mergeGeometries, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js"

const TAU = Math.PI * 2
const mod = (a, n) => ((a % n) + n) % n
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
const mix = (a, b, t) => a + (b - a) * t
const sstep = (a, b, x) => {
	const t = clamp((x - a) / (b - a))
	return t * t * (3 - 2 * t)
}
function h3(a, b, c) {
	let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
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
/** Periodic value noise on a tile: u, v in [0, 1), fx x fy lattice cells across it (integers), 0..1. */
function pn(u, v, fx, fy, s) {
	const x = u * fx, y = v * fy
	const xi = Math.floor(x), yi = Math.floor(y)
	let xf = x - xi, yf = y - yi
	xf = xf * xf * (3 - 2 * xf)
	yf = yf * yf * (3 - 2 * yf)
	const x0 = mod(xi, fx), y0 = mod(yi, fy)
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
/** pn() with its lattice made once: the same values, no hashing per call (for the per-pixel noises of a big bake). u, v in [0, 1). */
function pnTab(fx, fy, s) {
	const t = new Float32Array(fx * fy)
	for (let y = 0; y < fy; y++) for (let x = 0; x < fx; x++) t[y * fx + x] = h3(x, y, s)
	return (u, v) => {
		const x = u * fx, y = v * fy
		const xi = Math.floor(x), yi = Math.floor(y)
		let xf = x - xi, yf = y - yi
		xf = xf * xf * (3 - 2 * xf)
		yf = yf * yf * (3 - 2 * yf)
		const x0 = xi >= 0 && xi < fx ? xi : mod(xi, fx), y0 = yi >= 0 && yi < fy ? yi : mod(yi, fy)
		const x1 = x0 + 1 === fx ? 0 : x0 + 1, y1 = y0 + 1 === fy ? 0 : y0 + 1
		const a = t[y0 * fx + x0], b = t[y0 * fx + x1], c = t[y1 * fx + x0], d = t[y1 * fx + x1]
		return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf
	}
}
/** Periodic jittered-cell noise: out.f1 / out.f2 = distance to the nearest two points (cell units), out.id = 0..1 id of the nearest cell. */
function worley(u, v, fx, fy, s, o) {
	const x = u * fx, y = v * fy
	const xi = Math.floor(x), yi = Math.floor(y)
	let f1 = 9, f2 = 9, id = 0, bx = 0, by = 0
	for (let j = -1; j <= 1; j++) {
		for (let i = -1; i <= 1; i++) {
			const cx = xi + i, cy = yi + j
			const wx = mod(cx, fx), wy = mod(cy, fy)
			const dx = cx + h3(wx, wy, s) - x, dy = cy + h3(wx, wy, s + 1) - y
			const d = Math.sqrt(dx * dx + dy * dy)
			if (d < f1) { f2 = f1; f1 = d; id = h3(wx, wy, s + 2); bx = dx; by = dy } else if (d < f2) f2 = d
		}
	}
	o.dx = bx
	o.dy = by
	o.f1 = f1
	o.f2 = f2
	o.id = id
}

/** Faster periodic jittered-cell noise: the cell points are made once and every call only reads them. wy(u, v, o) sets o.f1 / f2 / id / dx / dy as worley() does. */
function worleyFn(fx, fy, s) {
	const n = fx * fy
	const px = new Float32Array(n), py = new Float32Array(n), pid = new Float32Array(n)
	for (let cy = 0; cy < fy; cy++) for (let cx = 0; cx < fx; cx++) {
		const k = cy * fx + cx
		px[k] = h3(cx, cy, s)
		py[k] = h3(cx, cy, s + 1)
		pid[k] = h3(cx, cy, s + 2)
	}
	return (u, v, o) => {
		const x = u * fx, y = v * fy
		const xi = Math.floor(x), yi = Math.floor(y)
		let f1 = 1e9, f2 = 1e9, id = 0, bx = 0, by = 0
		for (let j = -1; j <= 1; j++) {
			const cy = yi + j
			const wy = cy < 0 ? cy + fy : cy >= fy ? cy - fy : cy
			for (let i = -1; i <= 1; i++) {
				const cx = xi + i
				const wx = cx < 0 ? cx + fx : cx >= fx ? cx - fx : cx
				const k = wy * fx + wx
				const dx = cx + px[k] - x, dy = cy + py[k] - y
				const d = dx * dx + dy * dy
				if (d < f1) { f2 = f1; f1 = d; id = pid[k]; bx = dx; by = dy } else if (d < f2) f2 = d
			}
		}
		o.dx = bx
		o.dy = by
		o.f1 = Math.sqrt(f1)
		o.f2 = Math.sqrt(f2)
		o.id = id
	}
}

// The bake cache and the repeat copies live at module scope: surfaces.js, rods.js and containers.js each call makeLib, and the kit
// (textures, materials, geometries) is one for all of them, so one bake must serve every file (not once per file).
const baked = new Map()
const reps = new Map()

export function makeLib(kit, THREE) {
	const T = THREE
	const f5 = (v) => Number(v).toFixed(5)
	const M = (key, params) => kit.mat(`sf|${key}`, params)
	const V2 = (a, b = a) => new T.Vector2(a, b)

	// ------------------------------------------------------------- colours
	const rgb = (hex) => {
		const c = new T.Color(hex).convertLinearToSRGB()
		return [c.r * 255, c.g * 255, c.b * 255]
	}
	const css = (r, g, b, a = 1) => `rgba(${Math.round(clamp(r, 0, 255))},${Math.round(clamp(g, 0, 255))},${Math.round(clamp(b, 0, 255))},${a})`
	const shade = (hex, k) => { const c = rgb(hex); return css(c[0] * k, c[1] * k, c[2] * k) }
	/** A hex colour scaled (k < 1 darker), as a hex string for a material colour. */
	const tone = (hex, k) => new T.Color(hex).multiplyScalar(k).getStyle()

	// ------------------------------------------------------------- baked textures
	/**
	 * Bake maps from a per-pixel function fn(u, v, o) (u right, v up, 0..1 on the tile; set o.r/g/b 0..255, o.h height 0..1, o.rough 0..1,
	 * o.metal 0..1). Options: normal = strength (0: none), orm (roughness in G + metalness in B of one data map), wrap, paint(g, W, H) draws on
	 * the colour afterwards. Returns {map, normalMap, ormMap}.
	 */
	function bake(key, W, H, fn, opts = {}) {
		const hit = baked.get(key)
		if (hit) return hit
		const out = kit.bakeScope ? kit.bakeScope(`sf|bake|${key}`, () => bakeNow(key, W, H, fn, opts)) : bakeNow(key, W, H, fn, opts) // (a bake worker may have worked it out already: models3d.js "Bake scopes")
		baked.set(key, out)
		return out
	}
	function bakeNow(key, W, H, fn, { normal = 0, orm = false, wrap = true, paint = null, blur = 0, aniso = 16 } = {}) {
		const t0 = performance.now()
		const col = new ImageData(W, H)
		const om = orm ? new ImageData(W, H) : null
		const hgt = normal ? new Float32Array(W * H) : null
		const grad = normal ? new Float32Array(W * H * 2) : null // o.gx / o.gy: slopes added straight to the normal (a tilted facet, no height needed)
		const o = { r: 128, g: 128, b: 128, h: 0.5, rough: 0.5, metal: 0 }
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				o.h = 0.5
				o.rough = 0.5
				o.metal = 0
				o.gx = 0
				o.gy = 0
				fn((x + 0.5) / W, 1 - (y + 0.5) / H, o)
				const i = (y * W + x) * 4
				col.data[i] = o.r
				col.data[i + 1] = o.g
				col.data[i + 2] = o.b
				col.data[i + 3] = o.a ?? 255
				if (hgt) { hgt[y * W + x] = o.h; grad[(y * W + x) * 2] = o.gx; grad[(y * W + x) * 2 + 1] = o.gy }
				if (om) {
					om.data[i] = 255
					om.data[i + 1] = clamp(o.rough) * 255
					om.data[i + 2] = clamp(o.metal) * 255
					om.data[i + 3] = 255
				}
			}
		}
		const out = {}
		out.map = kit.tex(`${key}|c`, W, H, (g) => {
			g.putImageData(col, 0, 0)
			if (paint) paint(g, W, H)
		}, { wrap })
		out.map.anisotropy = aniso
		if (hgt && blur > 0) {
			// soften the height before the normal is taken from it: no one-pixel steps feeding a hard normal
			const tmp = new Float32Array(W * H)
			for (let pass = 0; pass < blur; pass++) {
				for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
					const xm = wrap ? (x + W - 1) % W : Math.max(0, x - 1), xp = wrap ? (x + 1) % W : Math.min(W - 1, x + 1)
					tmp[y * W + x] = 0.25 * hgt[y * W + xm] + 0.5 * hgt[y * W + x] + 0.25 * hgt[y * W + xp]
				}
				for (let y = 0; y < H; y++) {
					const ym = wrap ? (y + H - 1) % H : Math.max(0, y - 1), yp = wrap ? (y + 1) % H : Math.min(H - 1, y + 1)
					for (let x = 0; x < W; x++) hgt[y * W + x] = 0.25 * tmp[ym * W + x] + 0.5 * tmp[y * W + x] + 0.25 * tmp[yp * W + x]
				}
			}
		}
		if (hgt) {
			const nm = new ImageData(W, H)
			for (let y = 0; y < H; y++) {
				const ym = wrap ? (y + H - 1) % H : Math.max(0, y - 1), yp = wrap ? (y + 1) % H : Math.min(H - 1, y + 1)
				for (let x = 0; x < W; x++) {
					const xm = wrap ? (x + W - 1) % W : Math.max(0, x - 1), xp = wrap ? (x + 1) % W : Math.min(W - 1, x + 1)
					const dx = (hgt[y * W + xp] - hgt[y * W + xm]) * 0.5 * normal + grad[(y * W + x) * 2]
					const dy = (hgt[yp * W + x] - hgt[ym * W + x]) * 0.5 * normal - grad[(y * W + x) * 2 + 1] // canvas y points down: +dy is toward -v
					const il = 1 / Math.hypot(dx, dy, 1)
					const i = (y * W + x) * 4
					nm.data[i] = (-dx * il * 0.5 + 0.5) * 255
					nm.data[i + 1] = (dy * il * 0.5 + 0.5) * 255
					nm.data[i + 2] = (il * 0.5 + 0.5) * 255
					nm.data[i + 3] = 255
				}
			}
			out.normalMap = kit.tex(`${key}|n`, W, H, (g) => g.putImageData(nm, 0, 0), { data: true, wrap })
			out.normalMap.anisotropy = aniso
		}
		if (om) { out.ormMap = kit.tex(`${key}|o`, W, H, (g) => g.putImageData(om, 0, 0), { data: true, wrap }); out.ormMap.anisotropy = aniso }
		;(globalThis.__bakeMs ??= {})[key] = Math.round(performance.now() - t0)
		return out
	}
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

	// ------------------------------------------------------------- timber
	/** Wood grain variants are few (each is a texture to bake): any seed maps to 1, 2 or 3. */
	const ws = (seed) => 1 + (Math.abs(seed | 0) % 3)
	const WOOD_TU = 1.0 // m along the grain per wood tile
	const WOOD_TV = 0.125 // m across the grain per wood tile
	/**
	 * Flat-sawn timber with the grain along u: cathedral arches from rings round an off-board pith that drifts along the board. The map is baked
	 * in a neutral tone, once per seed (and shape), and every wood colour tints it through the material's colour (so one bake serves them all).
	 * `hex` is only kept so a call can state the board's colour.
	 */
	function woodMaps(hex, seed = 1, { straight = false } = {}) {
		const s1 = seed * 7 + 1
		// one knot per tile, somewhere along the board
		const kx = 0.3 + 0.5 * h3(seed, 1, 5), ky = 0.03 + 0.065 * h3(seed, 2, 5)
		// the slow fields (ring waviness, cloudy tone) are baked on a coarse grid and interpolated: they are smooth, and cheap that way
		const GW = 96, GH = 24
		const warpGrid = new Float32Array(GW * GH), cloudGrid = new Float32Array(GW * GH)
		for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
			const u = i / GW, v = j / (GH - 1)
			warpGrid[j * GW + i] = 0.4 * (pfbm(u, v, 2, 2, s1 + 5, 3) - 0.5) + 0.18 * (pn(u, v, 6, 24, s1 + 8) - 0.5)
			cloudGrid[j * GW + i] = pfbm(u, v, 2, 2, s1 + 13, 3) - 0.5
		}
		const samp = (g, u, v) => {
			const x = u * GW, y = clamp(v, 0, 1) * (GH - 1)
			const xi = Math.floor(x), yi = Math.min(GH - 2, Math.floor(y))
			const fx = x - xi, fy = y - yi
			const x0 = xi % GW, x1 = (xi + 1) % GW
			return mix(mix(g[yi * GW + x0], g[yi * GW + x1], fx), mix(g[(yi + 1) * GW + x0], g[(yi + 1) * GW + x1], fx), fy)
		}
		// 1024 x 256: the grain is all but constant along the board (a texel of 1 mm there), and the fibres need the 0.5 mm across it
		const WW = 1024
		const RING_DROP = 11 * 0.0033 // m: eleven ring spacings
		const colD = new Float32Array(WW), colY0 = new Float32Array(WW)
		const fibreN = pnTab(6, 280, s1 + 9), fineN = pnTab(40, 560, s1 + 11)
		return bake(`wood7|${seed}${straight ? '|s' : ''}`, WW, 256, (u, v, o) => {
			const X = u * WOOD_TU
			const Y = v * WOOD_TV
			// the board is cut slantwise to the log: the pith's distance D shrinks along the board, so each ring crosses it as a long arch
			const ci = Math.min(WW - 1, Math.floor(u * WW))
			let D = colD[ci], Y0 = colY0[ci]
			if (D === 0) {
				if (straight) {
					// straight-grained stock (a dowel): the pith is close to the surface, lines run down the length with only a hint of arch
					D = colD[ci] = 0.032 + 0.012 * pn(u, 0.5, 3, 1, s1)
					Y0 = colY0[ci] = 0.0625
				} else {
					// the pith's distance falls by exactly RING_DROP (eleven rings) along the 1 m tile, and Y0 comes back to its start: with the rings taken as
					// parabolas (below), ring k at the tile's end is ring k + 11 at its start, so the figure runs on across the wrap with no cross-grain jump
					// (a board may start anywhere in the tile, each glued board its own stretch, or run past 1 m, without a seam)
					D = colD[ci] = 0.15 - RING_DROP * u + 0.0025 * pn(u, 0.5, 2, 1, s1)
					Y0 = colY0[ci] = 0.05 + 0.012 * Math.sin(TAU * u + 2.1 * seed) + 0.006 * pn(u, 0.5, 2, 1, s1 + 3)
				}
			}
			// a knot bends the rings round itself
			const dx = (X - kx) * 0.45, dy = Y - ky
			const dk = straight ? 9 : Math.sqrt(dx * dx + dy * dy)
			const knot = dk < 0.05 ? Math.exp(-(dk * dk) / (2 * 0.011 * 0.011)) : 0
			// the ring through this point, as a parabola round the pith (D + y^2 / 2 D-bar: the circle's own shape within a ring over the board's width, and its
			// fall along the tile the same for every y), its spacing varied by waves whose period in q divides RING_DROP (so they also run on across the wrap)
			const q = straight ? Math.sqrt(D * D + (Y - Y0) * (Y - Y0)) : D + ((Y - Y0) * (Y - Y0)) / (2 * 0.132)
			const warp = samp(warpGrid, u, v)
			const wav = straight ? 0.45 * Math.sin(q * 61 + seed) + 0.25 * Math.sin(q * 143 + 2 * seed) : 0.45 * Math.sin((q * TAU) / RING_DROP + seed) + 0.25 * Math.sin((q * 2 * TAU) / RING_DROP + 2 * seed)
			const r = q / 0.0033 + warp + wav + 4.2 * knot
			const f = r - Math.floor(r)
			const late = (0.55 * f * f + 0.45 * sstep(0.66, 0.96, f)) * (1 - sstep(0.9, 1.0, f)) // a wide late-wood band, easing back to early wood (no one-pixel step)
			const fibre = fibreN(u, v) - 0.5
			const fine = fineN(u, v) - 0.5
			const cloud = samp(cloudGrid, u, v)
			let k = 0.8 - 0.2 * late + 0.09 * fibre + 0.05 * fine + 0.12 * cloud
			let kg = 1 - 0.05 * late, kb = 1 - 0.15 * late
			if (dk < 0.0075) { const c = 1 - sstep(0.004, 0.0075, dk); k *= 1 - 0.55 * c; kg *= 1 - 0.1 * c; kb *= 1 - 0.2 * c } // the knot itself, dark and tight
			else if (dk < 0.012) { const c = 1 - sstep(0.0075, 0.012, dk); k *= 1 - 0.18 * c } // a dark halo round it
			o.r = clamp(255 * k, 0, 255)
			o.g = clamp(255 * k * kg, 0, 255)
			o.b = clamp(255 * k * kb, 0, 255)
			o.h = 0.5 + 0.12 * late + 0.22 * fibre + 0.08 * fine - 0.15 * (dk < 0.0075 ? 1 : 0)
			o.rough = 0.5 + 0.12 * late + 0.1 * fibre
		}, {
			normal: 1.1, orm: true, blur: 1,
			paint: (g, W, H) => { // open pores: short dark dashes along the grain
				const R = rng(seed * 31 + 5)
				g.globalAlpha = 0.14
				g.fillStyle = css(255 * 0.3, 255 * 0.24, 255 * 0.2)
				const sc = W / 3072
				for (let i = 0, n = Math.round((2700 * W) / 2048); i < n; i++) {
					const x = R() * W, y = R() * H, l = (8 + R() * 70) * sc
					g.fillRect(x, y, l, 1)
					if (x + l > W) g.fillRect(x - W, y, l, 1) // (wrapped round the tile's end: the grain has no seam there)
				}
				g.globalAlpha = 1
			},
		})
	}
	/** The cut end of the same board: rings as arcs round the pith (tile WOOD_TV m each way: u across the width, v through the thickness). */
	function endMaps(hex, seed = 1) {
		const s1 = seed * 5 + 2
		const f0 = pnTab(4, 4, s1), f1 = pnTab(8, 8, s1 + 17), f2 = pnTab(16, 16, s1 + 34) // pfbm(u, v, 4, 4, s1, 3), its lattices made once
		const poreN = pnTab(120, 120, s1 + 4), cloudN = pnTab(8, 8, s1 + 6)
		return bake(`woodEnd4|${seed}`, 384, 384, (u, v, o) => {
			const Y = u * WOOD_TV
			const Tt = (1 - v) * WOOD_TV
			const qa = Y - 0.05, qb = Tt + 0.04 - 0.01 * Math.sin(Y * 30)
			const q = Math.sqrt(qa * qa + qb * qb)
			const r = q / 0.0034 + 1.4 * ((f0(u, v) + 0.5 * f1(u, v) + 0.25 * f2(u, v)) / 1.75 - 0.5)
			const f = r - Math.floor(r)
			const late = f * f * Math.pow(f, 0.2)
			const pore = poreN(u, v) - 0.5
			const k = 0.8 - 0.2 * late + 0.1 * pore + 0.05 * (cloudN(u, v) - 0.5)
			o.r = clamp(255 * k, 0, 255)
			o.g = clamp(255 * k, 0, 255)
			o.b = clamp(255 * k * 0.96, 0, 255)
			o.h = 0.5 + 0.3 * pore + 0.1 * late
			o.rough = 0.78
		}, { normal: 1.0 })
	}
	/** The faces of a varnished board: {side (grain along x), end (cut across it; baked only when something asks for it)}. */
	function woodSet(hex, seed = 1, { varnish = 0.7, rough = 0.5, straight = false } = {}) {
		seed = ws(seed)
		const m = woodMaps(hex, seed, { straight })
		let end = null
		return {
			side: M(`wood|${hex}|${seed}|${varnish}|${rough}|${straight}`, { color: hex, map: m.map, normalMap: m.normalMap, normalScale: V2(0.3), roughnessMap: m.ormMap, roughness: rough * 1.5, metalness: 0, clearcoat: varnish, clearcoatRoughness: 0.2 }),
			get end() {
				if (!end) {
					const e = endMaps(hex, seed)
					end = M(`woodEnd|${hex}|${seed}|${varnish}`, { color: hex, map: e.map, normalMap: e.normalMap, normalScale: V2(0.5), roughness: 0.78, metalness: 0, clearcoat: varnish * 0.25, clearcoatRoughness: 0.4 })
				}
				return end
			},
		}
	}
	/** Cork: a speckled tan board (tile 0.2 m). */
	function corkMat() {
		const wk = worleyFn(48, 48, 71)
		const t = bake("cork", 512, 512, (u, v, o) => {
			const w = {}
			wk(u, v, w)
			const grain = 1 - sstep(0.15, 0.7, w.f1)
			const k = 0.86 + 0.25 * w.id + 0.12 * (pn(u, v, 6, 6, 72) - 0.5) + 0.1 * (pn(u, v, 100, 100, 73) - 0.5)
			o.r = clamp(200 * k, 0, 255)
			o.g = clamp(152 * k, 0, 255)
			o.b = clamp(98 * k, 0, 255)
			o.h = 0.35 + 0.45 * grain + 0.1 * w.id
			if (w.f1 < 0.1 && w.id < 0.2) { o.r *= 0.5; o.g *= 0.45; o.b *= 0.4; o.h = 0.05 }
		}, { normal: 1.5 })
		return M("cork", { map: withRepeat(t.map, 1, 1), normalMap: t.normalMap, normalScale: V2(0.8), roughness: 0.92, metalness: 0 })
	}

	// ------------------------------------------------------------- metals
	/**
	 * Hot-rolled mill finish: bluish scale in patches over bare, streaked steel, streaks along u. The uv's tile is 0.4 m (as every steel face's), but the
	 * colour and the roughness (the patches of scale) repeat only every 1.2 m (their textures are drawn at a third of the uv's rate), so a plate of a couple of
	 * metres shows no grid of the same blotches; the fine rolling streaks are relief (the normal map) at the uv's own 0.4 m.
	 */
	function millSteel() {
		// the scale's patches: soft-edged (a wide step over a smooth field, the rolling streaks only nudging their edges) and of low contrast (about +-12 % about
		// the mean, as a plate's mottling reads from a metre away: a big plate is not camouflage)
		const t = bake("millsteel5", 512, 512, (u, v, o) => {
			const { fb, fst, fsc, fsp } = millTabs()
			const blot = (fb[0](u, v) + 0.5 * fb[1](u, v) + 0.25 * fb[2](u, v) + 0.125 * fb[3](u, v)) / 1.875 // pfbm(u, v, 9, 9, 81, 4): patches the size they were on a 0.4 m tile
			const streak = fst(u, v) - 0.5
			const scale = sstep(0.28, 0.7, blot + 0.06 * streak + 0.04 * (fsc(u, v) - 0.5))
			const k = mix(1.0, 0.96, scale) + 0.06 * streak + 0.03 * (fsp(u, v) - 0.5)
			o.r = clamp(mix(152, 124, scale) * k, 0, 255)
			o.g = clamp(mix(156, 129, scale) * k, 0, 255)
			o.b = clamp(mix(163, 141, scale) * k, 0, 255)
			o.rough = mix(0.38, 0.5, scale) + 0.04 * (fsp(u, v) - 0.5)
			o.metal = mix(1, 0.85, scale)
		}, { orm: true })
		const n = bake("millsteel4n", 256, 512, (u, v, o) => {
			// the relief: long rolling streaks and fine ones, at the uv's 0.4 m tile
			const { fst0, ffine, fpit } = millTabs()
			o.h = 0.5 + 0.12 * (fst0(u, v) - 0.5) + 0.06 * (ffine(u, v) - 0.5) + 0.04 * (fpit(u, v) - 0.5)
		}, { normal: 0.9 })
		const third = (x) => withRepeat(x, 1 / 3, 1 / 3, 0.17, 0.41)
		const orm = third(t.ormMap)
		return M("millsteel5", { map: third(t.map), normalMap: n.normalMap, normalScale: V2(0.5), roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, envMapIntensity: 1.3 })
	}
	let msTabs = null // millSteel's noise lattices, made on its first bake
	const millTabs = () => (msTabs ??= {
		fb: [0, 1, 2, 3].map((o) => pnTab(9 << o, 9 << o, 81 + o * 17)),
		fst: pnTab(12, 210, 82), fsc: pnTab(90, 90, 83), fsp: pnTab(120, 160, 86),
		fst0: pnTab(4, 70, 82), ffine: pnTab(50, 260, 84), fpit: pnTab(40, 40, 85),
	})
	/** A sawn steel end: bright metal with the arcs of the blade (tile 0.1 m): spaced about 1.6 mm, a long way round, with a few burr streaks. */
	function sawnEnd() {
		const t = bake("sawnend4", 512, 512, (u, v, o) => {
			const d = Math.hypot(u - 0.5, v + 1.6) // the blade's arcs, about 160 mm from the cut
			const ring = 0.5 + 0.5 * Math.sin(d * 30 * TAU + 3 * (pfbm(u, v, 4, 4, 94, 3) - 0.5))
			const ring2 = 0.5 + 0.5 * Math.sin(d * 11 * TAU + 8 * (pn(u, v, 3, 3, 97) - 0.5))
			const burr = pn(u, v, 160, 8, 98) - 0.5
			const k = 1.0 + 0.1 * (ring - 0.5) + 0.05 * (ring2 - 0.5) + 0.05 * burr + 0.04 * (pn(u, v, 60, 60, 91) - 0.5)
			o.r = clamp(206 * k, 0, 255)
			o.g = clamp(210 * k, 0, 255)
			o.b = clamp(216 * k, 0, 255)
			o.rough = 0.2 + 0.25 * ring + 0.06 * ring2 + 0.05 * (pn(u, v, 30, 30, 92) - 0.5)
			o.metal = 1
			o.h = 0.5 + 0.35 * ring + 0.1 * ring2 + 0.08 * burr
		}, { normal: 1.1, orm: true, blur: 1 })
		return M("sawnend4", { map: t.map, normalMap: t.normalMap, normalScale: V2(0.7), roughnessMap: t.ormMap, metalnessMap: t.ormMap, roughness: 1, metalness: 1, envMapIntensity: 1.4 })
	}
	/** Fine brushing lines along u as a roughness map (tile 0.25 m). */
	function brushedMaps(key, base, rough) {
		return bake(`brushed|${key}`, 512, 512, (u, v, o) => {
			const line = pn(u, v, 4, 400, 95) - 0.5
			const line2 = pn(u, v, 24, 200, 96) - 0.5
			const k = 0.96 + 0.1 * line + 0.05 * line2
			o.r = clamp(base[0] * k, 0, 255)
			o.g = clamp(base[1] * k, 0, 255)
			o.b = clamp(base[2] * k, 0, 255)
			o.rough = clamp(rough + 0.14 * line + 0.07 * line2)
			o.metal = 1
			o.h = 0.5 + 0.5 * line
		}, { normal: 0.9, orm: true })
	}
	function brushedMetal(key, hex, rough = 0.3, extra = {}) {
		const t = brushedMaps(key, rgb(hex), rough)
		return M(`brushed|${key}`, { map: t.map, normalMap: t.normalMap, normalScale: V2(0.35), roughnessMap: t.ormMap, metalnessMap: t.ormMap, roughness: 1, metalness: 1, ...extra })
	}
	const steel = () => brushedMetal("steel", "#c7ccd2", 0.3)
	const aluminium = () => brushedMetal("alu", "#d4d8dd", 0.34)
	const chrome = () => M("chrome", { color: "#f3f5f7", metalness: 1, roughness: 0.04, envMapIntensity: 1.5 })
	const stainless = () => M("stainless", { color: "#dfe3e8", metalness: 1, roughness: 0.16, envMapIntensity: 1.3 })
	const brass = () => M("brass", { color: "#e2b254", metalness: 1, roughness: 0.16, envMapIntensity: 1.4 })
	const darkSteel = () => M("darksteel", { color: "#6a6e74", metalness: 1, roughness: 0.4 })
	const blackIron = () => M("blackiron", { color: "#2c2e31", metalness: 0.85, roughness: 0.5 })
	/** Hammered dark iron (tile 0.1 m, 512 px): a satin slate-grey metal dished by the smith's blows (dimples of about 5 mm). */
	function ironMat() {
		const wk = worleyFn(20, 20, 71)
		const t = bake("iron4", 512, 512, (u, v, o) => {
			const w = {}
			wk(u, v, w)
			const dish = sstep(0.0, 0.6, w.f1)
			const k = 0.82 + 0.28 * dish + 0.16 * (pn(u, v, 140, 140, 72) - 0.5) + 0.12 * (pfbm(u, v, 3, 3, 73, 3) - 0.5)
			o.r = clamp(92 * k, 0, 255)
			o.g = clamp(96 * k, 0, 255)
			o.b = clamp(104 * k, 0, 255)
			o.h = 0.3 + 0.55 * dish + 0.1 * (pn(u, v, 140, 140, 72) - 0.5)
			o.rough = 0.38 + 0.2 * (1 - dish) + 0.1 * (pn(u, v, 80, 80, 74) - 0.5)
			o.metal = 0.6
		}, { normal: 2.2, orm: true, blur: 1 })
		return M("iron4", { map: t.map, normalMap: t.normalMap, normalScale: V2(1), roughnessMap: t.ormMap, metalnessMap: t.ormMap, roughness: 1, metalness: 1, envMapIntensity: 1.2 })
	}
	/** Galvanised steel: spangled zinc (tile 0.25 m, 512 px). Cells of 12-16 mm that differ mostly in roughness and in a small tilt of each
	 * facet (so they glint one by one), albedo only +-4%, feathered dendrite streaks fanning out of each cell's nucleus. */
	function galvanised(tint = "#ffffff", { contrast = 1 } = {}) {
		const wk = worleyFn(17, 17, 61)
		const t = bake("galv6", 512, 512, (u, v, o) => {
			const w = {}
			wk(u, v, w)
			const ang = Math.atan2(w.dy, w.dx)
			const nb = 7 + Math.floor(w.id * 6)
			const feather = 0.5 + 0.5 * Math.sin(ang * nb + 9 * w.id + 5.5 * w.f1 + 4 * (pn(u, v, 70, 70, 66) - 0.5))
			const feather2 = 0.5 + 0.5 * Math.sin(ang * nb * 2.5 + 31 * w.id + 11 * w.f1)
			const edge = sstep(0.0, 0.09, w.f2 - w.f1) // the grain boundary between two cells
			const frost = pfbm(u, v, 12, 12, 67, 4) - 0.5 // slow mottling across many cells
			const k = 0.97 + 0.11 * (w.id - 0.5) + 0.05 * (feather - 0.5) + 0.05 * frost + 0.012 * (pn(u, v, 140, 140, 62) - 0.5)
			o.r = clamp(196 * k * (0.985 + 0.015 * edge), 0, 255)
			o.g = clamp(201 * k * (0.985 + 0.015 * edge), 0, 255)
			o.b = clamp(207 * k * (0.985 + 0.015 * edge), 0, 255)
			o.rough = 0.18 + 0.2 * w.id + 0.08 * (feather - 0.5) + 0.06 * (1 - edge) + 0.05 * frost
			o.metal = 1
			// each facet leans its own way (a few degrees), with feather ripples across it
			const a2 = h3(Math.floor(w.id * 9973), 7, 13) * TAU
			const tilt = 0.02 + 0.06 * ((w.id * 7.31) % 1)
			o.gx = Math.cos(a2) * tilt + w.dx * 0.02 + 0.016 * (feather - 0.5) + 0.006 * (feather2 - 0.5)
			o.gy = Math.sin(a2) * tilt + w.dy * 0.02 + 0.006 * (feather2 - 0.5)
			o.h = 0.5 - 0.25 * (1 - edge)
		}, { normal: 0.5, orm: true, blur: 1 })
		// contrast < 1: a quieter spangle (the darker inside of a pail): a plain roughness, a gentler normal map
		if (contrast < 1) return M(`galv6|${tint}|${contrast}`, { color: tint, map: t.map, normalMap: t.normalMap, normalScale: V2(contrast * 0.8), roughness: 0.36, metalness: 1, envMapIntensity: 1.2 })
		return M(`galv6|${tint}|${contrast}`, { color: tint, map: t.map, normalMap: t.normalMap, normalScale: V2(contrast), roughnessMap: t.ormMap, metalnessMap: t.ormMap, roughness: 1, metalness: 1, envMapIntensity: 1.3 })
	}

	// ------------------------------------------------------------- stone, rubber, fabric
	/** A slow field (a periodic fbm of a few cells) baked once on a coarse N x N grid and read back bilinearly: far cheaper than evaluating it per texel. */
	function field(N, fn) {
		const g = new Float32Array(N * N)
		for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g[y * N + x] = fn((x + 0.5) / N, (y + 0.5) / N)
		return g
	}
	function fsamp(g, N, u, v) {
		const x = u * N - 0.5, y = v * N - 0.5
		const xi = Math.floor(x), yi = Math.floor(y)
		const fx = x - xi, fy = y - yi
		const x0 = mod(xi, N), x1 = x0 + 1 === N ? 0 : x0 + 1, y0 = mod(yi, N), y1 = y0 + 1 === N ? 0 : y0 + 1
		return mix(mix(g[y0 * N + x0], g[y0 * N + x1], fx), mix(g[y1 * N + x0], g[y1 * N + x1], fx), fy)
	}
	/** Cast (formed) concrete (tile 0.3 m, 512 px): grey cement paste with fine sand speckle and slow mottling, bug holes (0.5-4 mm pits, a few per
	 * 10 cm2) and the faint horizontal joints of the form boards. No stones show: aggregate only shows where an arris is chipped. */
	function concreteMaps() {
		const key = "concrete4"
		if (baked.has(key)) return baked.get(key)
		const W = 512, TILE = 0.3
		const pxm = TILE / W // metres per texel
		const paste = field(160, (u, v) => pfbm(u, v, 3, 3, 102, 5))
		const cloud = field(160, (u, v) => pfbm(u, v, 11, 11, 107, 3))
		const warmF = field(96, (u, v) => pfbm(u, v, 4, 4, 109, 3))
		// bug holes: one in seven cells of 7.5 mm holds a pit of 0.35-1.8 mm radius, drawn once into a depth plane and a shadow plane
		const pitT = new Float32Array(W * W), pitS = new Float32Array(W * W)
		for (let cy = 0; cy < 40; cy++) for (let cx = 0; cx < 40; cx++) {
			const pid = h3(cx, cy, 107)
			if (pid >= 0.14) continue
			const q = pid / 0.14
			const rad = (0.045 + 0.2 * q * q) * 7.5e-3 * (0.75 + 0.5 * h3(cx, cy, 111))
			const cu = (cx + h3(cx, cy, 105)) / 40, cv = (cy + h3(cx, cy, 106)) / 40
			const R = Math.ceil((rad * 1.6) / pxm) + 1
			const x0 = Math.floor(cu * W), y0 = Math.floor((1 - cv) * W)
			for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
				const uu = (x0 + i + 0.5) / W, vv = 1 - (y0 + j + 0.5) / W
				const dm = Math.hypot((uu - cu) * TILE, (vv - cv) * TILE)
				if (dm >= rad * 1.6) continue
				const k = mod(y0 + j, W) * W + mod(x0 + i, W)
				const tt = 1 - sstep(rad * 0.4, rad, dm)
				if (tt > pitT[k]) {
					pitT[k] = tt
					pitS[k] = 1 - 0.3 * clamp((cv - vv) * 120 + 0.5) // the upper rim of a pit lies in its own shadow
				} else if (tt === 0 && dm > rad * 0.9 && pitT[k] === 0) pitS[k] = -1 // a thin lip of paste round it
			}
		}
		return bake(key, W, W, (u, v, o) => {
			const px = Math.floor(u * W), py = Math.floor((1 - v) * W)
			const ps = fsamp(paste, 160, u, v)
			const cl = fsamp(cloud, 160, u, v)
			const sand = h3(px, py, 103) - 0.5 // grain finer than the texel: plain white noise
			const sand2 = pn(u, v, 170, 170, 104) - 0.5
			const grain = h3(px, py, 108) - 0.5
			let k = 0.95 + 0.34 * (ps - 0.5) + 0.12 * (cl - 0.5) + 0.12 * sand + 0.07 * sand2 + 0.08 * grain
			// form boards 0.15 m high: a hairline joint and a slightly different tone for each board
			const row = v * 2
			const rf = row - Math.floor(row)
			const dj = Math.min(rf, 1 - rf) * 0.15 // metres from the nearest joint
			const seam = Math.exp(-(dj * dj) / (2 * 0.0006 * 0.0006))
			k *= (1 + 0.04 * (h3(Math.floor(row) % 2, 3, 9) - 0.5)) * (1 - 0.1 * seam)
			let hgt = 0.5 + 0.22 * sand + 0.1 * ps + 0.12 * grain - 0.25 * seam
			let r = 160, g = 158, b = 152
			// a warm or a cool cast over the big mottles
			const warm = fsamp(warmF, 96, u, v) - 0.5
			r += 8 * warm; b -= 8 * warm
			const kk = py * W + px
			const tt = pitT[kk]
			if (tt > 0) { k *= 1 - 0.5 * tt * pitS[kk]; hgt -= 0.7 * tt }
			else if (pitS[kk] === -1) k *= 1.02
			// a few tiny pinholes of the paste
			if (h3(px, py, 113) > 0.993) { k *= 0.78; hgt -= 0.15 }
			o.h = hgt
			o.rough = 0.88 + 0.08 * sand + 0.04 * ps
			o.r = clamp(r * k, 0, 255)
			o.g = clamp(g * k, 0, 255)
			o.b = clamp(b * k * 0.99, 0, 255)
		}, { normal: 1.6, orm: true, blur: 1 })
	}
	function concrete() {
		const t = concreteMaps()
		return M("concrete4", { map: t.map, normalMap: t.normalMap, normalScale: V2(0.8), roughnessMap: t.ormMap, roughness: 1, metalness: 0 })
	}
	/** Rubber (tile 0.1 m, 512 px): a fine stipple of about 0.4 mm, the colour hardly varying (+-6%). Baked once in a neutral tone: the colour tints it. */
	function rubberMaps(hex = "#18191b", vari = 0.06) {
		const blotF = field(64, (u, v) => pfbm(u, v, 3, 3, 113, 3))
		return bake(`rubber4|${vari}`, 512, 512, (u, v, o) => {
			const s1 = pn(u, v, 250, 250, 111) - 0.5
			const s2 = pn(u, v, 90, 90, 112) - 0.5
			const blot = fsamp(blotF, 64, u, v) - 0.5
			const k = 1 + vari * (0.9 * s1 + 0.7 * s2 + 1.6 * blot)
			o.r = o.g = o.b = clamp(255 * k, 0, 255)
			o.h = 0.5 + s1 * 0.6 + s2 * 0.3
			o.rough = 0.78 + 0.08 * s1 + 0.1 * blot
		}, { normal: 0.9, orm: true, blur: 1 })
	}
	/** rep: tiles per uv unit (1 for a box's uv in tile units; 1 / 0.1 for uv in metres). */
	function rubber(hex = "#18191b", rep = 1, extra = {}) {
		const t = rubberMaps(hex)
		const wr = (x) => (rep === 1 ? x : withRepeat(x, rep, rep))
		return M(`rubber4|${hex}|${rep}|${Object.keys(extra).join(",")}`, { color: hex, map: wr(t.map), normalMap: wr(t.normalMap), normalScale: V2(0.5), roughnessMap: wr(t.ormMap), roughness: 1, metalness: 0, sheen: 0.12, sheenRoughness: 0.7, sheenColor: new T.Color("#2a2c2f"), ...extra })
	}
	/**
	 * Cut-pile carpet (tile 0.08 m, 384 px), in a neutral tone (the colour tints it): a fine even speckle of tuft tips (tufts of about 0.7 mm, a
	 * lighter tip each, a per-pixel scatter of lighter and darker ends), leaning into soft clumps of 1.5-2 mm that are smooth value noise (no cell
	 * edges, so no network of crevices), and a slow mottle.
	 */
	function pileMaps(hex) {
		const wf = worleyFn(120, 120, 121)
		const mottle = field(48, (u, v) => pfbm(u, v, 4, 4, 127, 3))
		return bake("pile6", 384, 384, (u, v, o) => {
			const w = {}
			wf(u, v, w)
			const tip = 1 - sstep(0.0, 0.62, w.f1)
			const hf = pn(u, v, 380, 380, 123) - 0.5
			const sp = h3(Math.floor(u * 384), Math.floor(v * 384), 129) - 0.5 // each tuft end a little lighter or darker than its neighbour
			const cl = pn(u, v, 44, 44, 125) - 0.5 + 0.5 * (pn(u, v, 88, 88, 126) - 0.5) // clumps of 1.5-2 mm
			const gap = sstep(0.5, 1.0, w.f1) // the dark between two tufts
			const mot = fsamp(mottle, 48, u, v) - 0.5
			const k = (0.62 + 0.18 * tip + 0.1 * (w.id - 0.5) + 0.08 * hf + 0.2 * sp + 0.16 * cl + 0.2 * mot) * (1 - 0.1 * gap)
			o.r = o.g = o.b = clamp(255 * k, 0, 255)
			o.h = 0.1 + 0.3 * tip + 0.2 * w.id + 0.25 * hf + 0.14 * sp + 0.2 * cl - 0.08 * gap
			o.rough = 1
		}, { normal: 1.1, blur: 0 })
	}
	/** Pile material of a colour: rep = tiles per uv unit. The sheen is the colour's own lighter tone (a pile glows in its own colour, not white). */
	function pile(hex, rep = 1, extra = {}) {
		const t = pileMaps(hex)
		const wr = (x) => (rep === 1 ? x : withRepeat(x, rep, rep))
		return M(`pile6|${hex}|${rep}|${Object.keys(extra).join(",")}`, { color: hex, map: wr(t.map), normalMap: wr(t.normalMap), normalScale: V2(0.8), roughness: 1, metalness: 0, sheen: 0.3, sheenRoughness: 0.4, sheenColor: new T.Color(tone(hex, 1.3)), ...extra })
	}
	/** Plain fabric / felt of a colour: a woven micro-pattern (tile 0.1 m). */
	function cloth(hex, { weave = 64 } = {}) {
		const [r0, g0, b0] = rgb(hex)
		const t = bake(`cloth|${hex}|${weave}`, 512, 512, (u, v, o) => {
			const x = u * weave, y = v * weave
			const warp = (Math.floor(x) + Math.floor(y)) & 1
			const a = warp ? 0.5 + 0.5 * Math.cos(TAU * mod(x, 1)) : 0.5 + 0.5 * Math.cos(TAU * mod(y, 1))
			const k = 0.82 + 0.28 * a + 0.12 * (pn(u, v, 90, 90, 131) - 0.5)
			o.r = clamp(r0 * k, 0, 255)
			o.g = clamp(g0 * k, 0, 255)
			o.b = clamp(b0 * k, 0, 255)
			o.h = a
			o.rough = 1
		}, { normal: 1.8 })
		return M(`cloth|${hex}|${weave}`, { map: t.map, normalMap: t.normalMap, normalScale: V2(0.8), roughness: 1, metalness: 0, sheen: 0.8, sheenRoughness: 0.5, sheenColor: new T.Color(hex).lerp(new T.Color("#ffffff"), 0.3) })
	}
	/** Brickwork (tile 0.45 x 0.15 m, 1152 x 384 px): stretcher bond of 215 x 65 mm bricks with 10 mm recessed mortar joints, each brick its own tone. */
	function brickMat(hex = "#b5523b") {
		const [r0, g0, b0] = rgb(tone(hex, 0.62))
		const t = bake(`brick5|${hex}`, 1152, 384, (u, v, o) => {
			const X = u * 0.45, Y = v * 0.15
			const c = Math.floor(Y / 0.075)
			const yy = Y - c * 0.075
			const xs = X - c * 0.1125
			const bi = Math.floor(xs / 0.225)
			const xx = xs - bi * 0.225
			const id = h3(((bi % 2) + 2) % 2, c, 41)
			// distance into the brick from its nearest face (m): the arris is rounded over 1 mm
			const dxe = Math.min(xx - 0.005, 0.22 - xx), dye = Math.min(yy - 0.005, 0.07 - yy)
			const inside = Math.min(dxe, dye)
			const sand = pn(u, v, 520, 170, 142) - 0.5
			const grit = pn(u, v, 1300, 430, 143) - 0.5
			const blot = pfbm(u, v, 6, 3, 144, 4) - 0.5
			if (inside > 0) {
				const arr = sstep(0, 0.0012, inside)
				const k = (0.9 + 0.5 * (id - 0.5) + 0.3 * blot + 0.12 * sand + 0.12 * grit) * (0.86 + 0.14 * arr)
				const burn = 0.5 + 0.5 * pfbm(u, v, 12, 6, 145 + Math.floor(id * 9), 3) // a darker, bluer burn on some bricks
				o.r = clamp(r0 * k * (1 + 0.12 * (id - 0.5) - 0.08 * burn * id), 0, 255)
				o.g = clamp(g0 * k * (1 + 0.1 * blot), 0, 255)
				o.b = clamp(b0 * k * (1 + 0.16 * burn * id), 0, 255)
				o.h = 0.62 + 0.25 * sstep(0, 0.0015, inside) + 0.07 * sand + 0.05 * grit
				o.rough = 0.9
			} else {
				const k = 0.86 + 0.4 * (pn(u, v, 700, 240, 146) - 0.5) + 0.18 * blot
				o.r = clamp(140 * k, 0, 255)
				o.g = clamp(135 * k, 0, 255)
				o.b = clamp(124 * k, 0, 255)
				o.h = 0.12 + 0.12 * sand + 0.1 * grit
				o.rough = 0.96
			}
		}, { normal: 2.4, blur: 1 })
		return M(`brick5|${hex}`, { map: t.map, normalMap: t.normalMap, normalScale: V2(0.9), roughness: 0.92, metalness: 0 })
	}
	function foamMat(hex = "#e6cf5e") {
		const [r0, g0, b0] = rgb(hex)
		const wk = worleyFn(40, 40, 151)
		const t = bake(`foam|${hex}`, 512, 512, (u, v, o) => {
			const w = {}
			wk(u, v, w)
			const k = 0.85 + 0.2 * w.id + 0.18 * (1 - sstep(0.0, 0.5, w.f1))
			o.r = clamp(r0 * k, 0, 255)
			o.g = clamp(g0 * k, 0, 255)
			o.b = clamp(b0 * k, 0, 255)
			o.h = 0.4 + 0.6 * sstep(0.1, 0.5, w.f2 - w.f1)
			o.rough = 1
		}, { normal: 1.2 })
		return M(`foam|${hex}`, { map: t.map, normalMap: t.normalMap, normalScale: V2(0.6), roughness: 1, metalness: 0 })
	}
	function cardboardMat(hex = "#c9a26b") {
		const [r0, g0, b0] = rgb(hex)
		const t = bake(`card|${hex}`, 512, 512, (u, v, o) => {
			const flute = 0.5 + 0.5 * Math.cos(TAU * u * 24)
			const f = pn(u, v, 120, 120, 161) - 0.5
			const k = 0.92 + 0.1 * f + 0.05 * flute
			o.r = clamp(r0 * k, 0, 255)
			o.g = clamp(g0 * k, 0, 255)
			o.b = clamp(b0 * k, 0, 255)
			o.h = 0.5 + 0.4 * flute + 0.3 * f
			o.rough = 0.92
		}, { normal: 0.8 })
		return M(`card|${hex}`, { map: t.map, normalMap: t.normalMap, normalScale: V2(0.5), roughness: 0.92, metalness: 0 })
	}
	function plasticMat(hex, gloss = 0.5) {
		return M(`plastic|${hex}|${gloss}`, { color: hex, roughness: 0.55 - 0.4 * gloss, metalness: 0, clearcoat: 0.4 * gloss, clearcoatRoughness: 0.2 })
	}

	// ------------------------------------------------------------- glass and ice
	function glassMat(tint = "#ffffff", { thickness = 0.01, attenuation = "#cfeee0", dist = 0.4, depthWrite = true, env = 1.1 } = {}) {
		const m = M(`glass|${tint}|${thickness}|${attenuation}|${dist}|${env}`, { color: tint, roughness: 0.02, metalness: 0, transmission: 1, thickness, ior: 1.5, attenuationColor: new T.Color(attenuation), attenuationDistance: dist, envMapIntensity: env, specularIntensity: 1 })
		m.depthWrite = depthWrite
		return m
	}
	/** Fine isotropic frost for the cut faces of ice (tile 0.1 m): a roughness map (G) and a grain normal, no streaks. */
	function frostFine() {
		return bake("frostfine2", 256, 256, (u, v, o) => {
			const a = pn(u, v, 120, 120, 171) - 0.5
			const b = pn(u, v, 48, 48, 172) - 0.5
			const c = pfbm(u, v, 5, 5, 173, 3) - 0.5
			o.r = o.g = o.b = 255
			o.rough = 0.4 + 0.32 * a + 0.2 * b + 0.2 * c
			o.h = 0.5 + 0.5 * a + 0.3 * b
		}, { normal: 1.0, orm: true, blur: 1 })
	}
	/** The gently rippled skin of melting ice (tile 0.5 m): broad swells and fine ripples as a normal map, and a roughness that is lowest in the wet hollows. */
	function meltMaps() {
		return bake("melt3", 256, 256, (u, v, o) => {
			const swell = pfbm(u, v, 5, 5, 181, 4) - 0.5
			const rip = Math.sin((u * 30 + 4 * (pfbm(u, v, 3, 3, 182, 3) - 0.5)) * TAU) * 0.5 + Math.sin((v * 22 + 3 * (pfbm(u, v, 4, 4, 183, 3) - 0.5)) * TAU) * 0.5
			o.r = o.g = o.b = 255
			o.h = 0.5 + 0.6 * swell + 0.05 * rip
			o.rough = 0.05 + 0.05 * (swell + 0.5)
		}, { normal: 1.6, orm: true, blur: 1 })
	}
	/** White bubble 'feathers' for a sheet at mid-thickness of ice (an alpha map on a 1 x 0.5 tile): fibrous, flowing streaks, not clouds. */
	function featherMap() {
		return kit.tex("sf|ice-feather", 1024, 512, (g, W, H) => {
			const img = g.createImageData(W, H)
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const u = x / W, v = y / H
				const warp = 0.06 * (pfbm(u, v, 3, 3, 191, 3) - 0.5)
				const streak = pn(u + warp, v, 5, 28, 192) // soft wisps along u
				const fine = pn(u + warp * 2, v, 11, 60, 193)
				const body = pfbm(u, v, 3, 3, 194, 4)
				const m = clamp((streak * 0.6 + fine * 0.4 - 0.42) * 2.2) * clamp((body - 0.32) * 2.6)
				const c = m * 255
				const i = (y * W + x) * 4
				img.data[i] = img.data[i + 1] = img.data[i + 2] = c
				img.data[i + 3] = 255
			}
			g.putImageData(img, 0, 0)
		}, { data: true, wrap: false })
	}

	// ------------------------------------------------------------- boxes with texture coordinates in metres
	/**
	 * A rounded box centred on the origin (radius r) whose uv are in tile units (metres / tile size):
	 *   faces +y/-y: u = x / ty[0], v = z / ty[1]  (yswap: u = z, v = x, so the grain runs along z)
	 *   faces +z/-z: u = x / tz[0], v = y / tz[1]
	 *   faces +x/-x: u = z / tx[0], v = y / tx[1]
	 * tu, tv, te are the shorthand for the wood board: ty = tz = [tu, tv], tx = [te, te]. off = {y, z, x: [u, v]} shifts each family.
	 * fit (a wood board: its grain repeats along the tile, not across it): every face's v range is kept inside ONE tile, so no face shows the tile's
	 * edge as a seam down its length: its v offset moved (mod 1) as little as that takes, and its tile widened only when the face is wider than 96 % of one.
	 * Faces in three's order: +x -x +y -y +z -z.
	 */
	function rbox(w, h, d, r = 0.001, { seg = 2, tu = 0.5, tv = 0.125, te = 0.125, ty = null, tz = null, tx = null, off = {}, yswap = false, fit = false } = {}) {
		const rr = Math.max(1e-5, Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6, d / 2 - 1e-6))
		let Ty = ty ?? [tu, tv], Tz = tz ?? [tu, tv], Tx = tx ?? [te, te]
		if (fit) {
			// [tile, offset] of a face family whose v runs over +-half (m) round its middle
			const fv = (T2, o, half) => {
				const a = Math.abs(T2[1]), k = Math.max(1, half / (0.48 * a)), hv = half / (a * k)
				return [[T2[0], T2[1] * k], [o[0], clamp(mod(o[1], 1), hv + 0.02, 1 - hv - 0.02)]]
			}
			const fx = fv(Tx, off.x ?? [0, 0], h / 2), fy = fv(Ty, off.y ?? [0, 0], (yswap ? w : d) / 2), fz = fv(Tz, off.z ?? [0, 0], h / 2)
			Tx = fx[0]; Ty = fy[0]; Tz = fz[0]
			off = { x: fx[1], y: fy[1], z: fz[1] }
		}
		return kit.geo(`sbox2|${f5(w)}|${f5(h)}|${f5(d)}|${f5(rr)}|${seg}|${Ty}|${Tz}|${Tx}|${JSON.stringify(off)}|${yswap}`, () => {
			// (seg 0: a plain box, square edges. BoxGeometry is indexed and its groups count index positions: de-indexed, the groups count vertices, as the
			// loop below reads them (and as RoundedBoxGeometry's already do), so every face gets its own axis's mapping)
			const g = seg > 0 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new T.BoxGeometry(w, h, d).toNonIndexed()
			const pos = g.attributes.position
			const uv = g.attributes.uv
			const ox = off.x ?? [0, 0], oy = off.y ?? [0, 0], oz = off.z ?? [0, 0]
			for (const grp of g.groups) {
				const axis = grp.materialIndex >> 1
				for (let i = grp.start; i < grp.start + grp.count; i++) {
					const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
					if (axis === 0) uv.setXY(i, z / Tx[0] + ox[0], y / Tx[1] + ox[1])
					else if (axis === 1) { if (yswap) uv.setXY(i, z / Ty[0] + oy[0], x / Ty[1] + oy[1]); else uv.setXY(i, x / Ty[0] + oy[0], z / Ty[1] + oy[1]) }
					else uv.setXY(i, x / Tz[0] + oz[0], y / Tz[1] + oz[1])
				}
			}
			uv.needsUpdate = true
			return g
		})
	}
	/** The six face materials of a board: the ends (+x, -x) get `end`, every other face `side`; or per face {px, nx, py, ny, pz, nz}. */
	const faces = (side, end) => (side && end !== undefined ? [end, end, side, side, side, side] : [side.px, side.nx, side.py, side.ny, side.pz, side.nz])
	/**
	 * A shape (array of [x, y]) extruded through z (centred); bevel rounds the edges; uv in metres. A bevel grows the outline by `bevel` (more at a sharp corner);
	 * inset: the bevel is cut inside the outline instead (the sides stand exactly on it).
	 */
	function extrudeXY(key, pts, depth, { bevel = 0, curve = 8, inset = false } = {}) {
		return kit.geo(`sext|${key}|${f5(depth)}|${f5(bevel)}${inset ? "|in" : ""}`, () => {
			const shape = new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y)))
			const dd = Math.max(1e-5, depth - 2 * bevel)
			const g = new T.ExtrudeGeometry(shape, { depth: dd, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: inset ? -bevel : 0, bevelSegments: 2, curveSegments: curve })
			g.translate(0, 0, -dd / 2)
			return toCreasedNormals(g, 0.6)
		})
	}
	/**
	 * A lathe about y (axis "z": about z, the profile's y becoming z; "x": about x, y becoming x) from [[r, y], ...]; uv: u around, v = profile arclength / tile
	 * (swap: u = arclength, v = around, so a wood grain runs along the profile). The profile may be a closed loop (a thick wall): go
	 * counter-clockwise seen with r to the right, so the normals face out.
	 */
	function lathe(key, pts0, { seg = 96, tile = 0.1, phi = TAU, swap = false, axis = "y", crease = 0.8, off = [0, 0], seamless = false, uniformU = false, planar = null } = {}) {
		return kit.geo(`slathe|${key}|${seg}|${[].concat(tile)}|${f5(phi)}|${swap}|${axis}|${crease}|${off}|${seamless}|${uniformU}|${planar}`, () => {
			// corners sharper than `crease` become hard edges: the profile point is doubled, so each side keeps its own normal (a lathe's
			// normals are averaged over a profile point's two segments); smoother bends stay smooth
			const pts = []
			for (let i = 0; i < pts0.length; i++) {
				pts.push(pts0[i])
				if (i > 0 && i < pts0.length - 1) {
					const a = [pts0[i][0] - pts0[i - 1][0], pts0[i][1] - pts0[i - 1][1]]
					const b = [pts0[i + 1][0] - pts0[i][0], pts0[i + 1][1] - pts0[i][1]]
					const la = Math.hypot(...a), lb = Math.hypot(...b)
					if (la > 1e-9 && lb > 1e-9 && Math.acos(clamp((a[0] * b[0] + a[1] * b[1]) / (la * lb), -1, 1)) > crease) pts.push(pts0[i])
				}
			}
			const g = new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(Math.max(0, r), y)), seg, 0, phi)
			const uv = g.attributes.uv
			const n = pts.length
			const [t0, t1] = Array.isArray(tile) ? tile : [tile, tile] // tile size around (or along the grain when swapped), and along the profile
			const arc = [0]
			for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
			const meanR = pts.reduce((a, p) => a + p[0], 0) / n
			// seamless, not swapped: one whole number of tiles round every ring of a smooth run of the profile (from the run's length-weighted mean radius), so a
			// tapered wall's texture stretches a little with the radius instead of shearing by up to a tile in the band where a per-ring count would jump. The count
			// may change only at a hard corner (a doubled profile point: the two rings coincide, so the band between them has no area to shear).
			const runCirc = new Array(n).fill(0)
			if (seamless && !swap) {
				let i0 = 0
				for (let i = 1; i <= n; i++) {
					if (i < n && !(pts[i][0] === pts[i - 1][0] && pts[i][1] === pts[i - 1][1])) continue
					let sl = 0, sr = 0
					for (let q = i0 + 1; q < i; q++) { const l = Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]); sl += l; sr += l * (pts[q][0] + pts[q - 1][0]) / 2 }
					const rm = sl > 1e-9 ? sr / sl : pts[i0][0]
					const c = Math.max(1, Math.round((Math.max(0.0005, uniformU ? meanR : rm) * phi) / t0)) * t0
					for (let q = i0; q < i; q++) runCirc[q] = c
					i0 = i
				}
			}
			for (let j = 0; j <= seg; j++) {
				for (let i = 0; i < n; i++) {
					const k = j * n + i
					let circ = Math.max(0.0005, uniformU ? meanR : pts[i][0]) * phi // uniformU: every ring maps the same u (a printed band keeps its dots straight and round)
					// seamless: a whole number of tiles round each ring, so the texture closes without a jump where the lathe's two ends meet.
					// Swapped (grain along the profile): one count for every ring, from the mean radius, so each grain line is a meridian and does not shear round the cone.
					if (seamless) circ = swap ? Math.max(1, Math.round((Math.max(0.0005, meanR) * phi) / t1)) * t1 : runCirc[i]
					if (swap) uv.setXY(k, arc[i] / t0 + off[0], ((j / seg) * circ) / t1 + off[1])
					else uv.setXY(k, ((j / seg) * circ) / t0 + off[0], arc[i] / t1 + off[1])
				}
			}
			if (planar) {
				// planar uv in the lathe's own frame, looking down the axis (u = x / planar[0], v = z / planar[1]): a flat disc (a pail's floor) or a turned blank keeps a straight grain
				const pos = g.attributes.position
				for (let k = 0; k < pos.count; k++) uv.setXY(k, pos.getX(k) / planar[0] + off[0], pos.getZ(k) / planar[1] + off[1])
			}
			uv.needsUpdate = true
			if (axis === "z") g.rotateX(Math.PI / 2)
			else if (axis === "x") g.rotateZ(-Math.PI / 2)
			else g.rotateY(Math.PI) // the seam where the wrap closes goes to the back (-z), away from the camera
			return g
		})
	}
	/** A tube along a polyline of 3D points (radius r, circular section), uv u along its length in metres / tile. */
	function tube(key, points, r, { seg = 8, closed = false, tile = 0.1 } = {}) {
		return kit.geo(`stube|${key}|${f5(r)}|${seg}|${closed}|${tile}`, () => {
			const curve = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p)), closed, "catmullrom", 0.2)
			const g = new T.TubeGeometry(curve, Math.max(8, Math.round(points.length * 6)), r, seg, closed)
			const uv = g.attributes.uv
			const len = curve.getLength()
			for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / tile)
			return g
		})
	}

	// ------------------------------------------------------------- plywood and extrusions with box-projected uv
	/** Birch plywood: a pale veneer face (tile 0.5 x 0.25 m, grain along u) and the layered edge (nine plies across `thick`): {face, edgeX, edgeY}. */
	function plyMats(hex = "#dcc190", thick = 0.012) {
		const [r0, g0, b0] = rgb(hex)
		const t = bake("ply2", 512, 256, (u, v, o) => {
			const streak = pn(u, v, 5, 120, 201) - 0.5
			const fine = pn(u, v, 40, 380, 202) - 0.5
			const cloud = pfbm(u, v, 2, 2, 203, 3) - 0.5
			const arch = 0.5 + 0.5 * Math.sin((v * 7 + 1.4 * pfbm(u, v, 2, 4, 204, 3) + 0.5 * Math.sin(u * TAU)) * TAU) // a faint, wide cathedral
			const k = 0.95 + 0.08 * streak + 0.04 * fine + 0.09 * cloud - 0.05 * arch
			o.r = clamp(255 * k, 0, 255); o.g = clamp(255 * k * 0.99, 0, 255); o.b = clamp(255 * k * 0.97, 0, 255)
			o.h = 0.5 + 0.4 * streak + 0.2 * fine
			o.rough = 0.62 + 0.1 * streak
		}, { normal: 0.7, orm: true, blur: 1 })
		const face = M(`ply|${hex}`, { color: hex, map: t.map, normalMap: t.normalMap, normalScale: V2(0.3), roughnessMap: t.ormMap, roughness: 1, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.5 })
		const edge = (vertical) => {
			const mk = vertical ? 1 : 0
			return M(`plyedge|${hex}|${mk}`, { map: kit.tex(`sf|plyedge|${hex}|${mk}`, 256, 256, (g, W, H) => {
				const R = rng(77 + mk)
				const n = 9
				for (let i = 0; i < n; i++) {
					const cross = i % 2
					const k = (cross ? 0.82 : 1.02) * (0.95 + 0.1 * R())
					g.fillStyle = css(r0 * k, g0 * k * 0.97, b0 * k * 0.92)
					if (vertical) g.fillRect(0, (i * H) / n, W, H / n + 1)
					else g.fillRect((i * W) / n, 0, W / n + 1, H)
					// glue line and grain tick marks
					g.fillStyle = "rgba(70,40,10,0.45)"
					if (vertical) g.fillRect(0, (i * H) / n - 1, W, 3)
					else g.fillRect((i * W) / n - 1, 0, 3, H)
				}
				g.globalAlpha = 0.18
				for (let i = 0; i < 700; i++) { g.fillStyle = R() < 0.5 ? "#000" : "#fff"; if (vertical) g.fillRect(R() * W, R() * H, 6 + R() * 30, 1); else g.fillRect(R() * W, R() * H, 1, 6 + R() * 30) }
			}, { wrap: true }), roughness: 0.78, metalness: 0 })
		}
		return { face, edgeX: edge(false), edgeY: edge(true) }
	}
	/** A plywood board lying in the machine plane: w by h, `t` thick (z), front face toward the camera. */
	function plyBoard(w, h, t, { hex = "#dcc190", r = 0.0012, off = [0.2, 0.3] } = {}) {
		const pm = plyMats(hex, t)
		const g = rbox(w, h, t, r, { seg: 2, tx: [t, 0.1], ty: [0.1, t], tz: [0.5, 0.25], off: { x: [0.5, 0.5], y: [0.5, 0.5], z: off } })
		return kit.mesh(g, [pm.edgeX, pm.edgeX, pm.edgeY, pm.edgeY, pm.face, pm.face])
	}
	/** An outline in the x-y plane extruded through z with uv in metres by the dominant axis of each face (tx: faces facing x ...). */
	function extrudeUV(key, pts, depth, { tx = [0.3, 0.3], ty = [0.3, 0.3], tz = [0.3, 0.3], off = {}, bevel = 0, inset = false } = {}) {
		return kit.geo(`sextuv|${key}|${f5(depth)}|${f5(bevel)}|${tx}|${ty}|${tz}|${JSON.stringify(off)}${inset ? "|in" : ""}`, () => {
			const g = extrudeXY(key, pts, depth, { bevel, inset }).clone()
			const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv
			const ox = off.x ?? [0, 0], oy = off.y ?? [0, 0], oz = off.z ?? [0, 0]
			for (let i = 0; i < pos.count; i++) {
				const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i))
				const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
				if (nz >= nx && nz >= ny) uv.setXY(i, x / tz[0] + oz[0], y / tz[1] + oz[1])
				else if (ny >= nx) uv.setXY(i, x / ty[0] + oy[0], z / ty[1] + oy[1])
				else uv.setXY(i, z / tx[0] + ox[0], y / tx[1] + ox[1])
			}
			uv.needsUpdate = true
			return g
		})
	}

	// ------------------------------------------------------------- decals and small parts
	/** A thin plane carrying a transparent drawing, lying on a surface: draw(g, W, H) paints it. */
	function decalMat(key, W, H, draw, extra = {}) {
		return M(`decal|${key}`, { map: kit.tex(`sfdecal|${key}`, W, H, draw, { wrap: false }), transparent: true, roughness: 0.55, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...extra })
	}
	/** A plane of size w x h, as a decal (placed on a face by the caller: rotate / position). */
	const decalPlane = (w, h, material) => {
		const m = new T.Mesh(kit.geo(`splane|${f5(w)}|${f5(h)}`, () => new T.PlaneGeometry(w, h)), material)
		m.castShadow = false
		m.receiveShadow = true
		return m
	}
	const put = (m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
		m.position.set(x, y, z)
		m.rotation.set(rx, ry, rz)
		return m
	}
	const mesh = (g, m, opts) => kit.mesh(g, m, opts)

	/**
	 * The surfaces of a board-like part by its look (grain / streaks along x): {side, end}. ctx = a model context (solid.look, color).
	 * The item models give their own look to the material they are made for; any other material comes through here.
	 */
	function skin(ctx, { seed = 1 } = {}) {
		const look = ctx.solid.look ?? ""
		const color = ctx.color
		const both = (c, tile) => ({ side: c, end: c, ...tile })
		if (/wood/.test(look) || look === "") return { ...woodSet(color, seed), tu: 1.0, tv: 0.125, te: 0.125, kind: "wood" }
		if (look === "cork") return both(corkMat(), { tu: 0.2, tv: 0.2, te: 0.2, kind: "cork" })
		if (look === "steel") return { side: millSteel(), end: sawnEnd(), tu: 0.4, tv: 0.4, te: 0.1, kind: "steel" }
		if (look === "aluminium") return both(aluminium(), { tu: 0.25, tv: 0.25, te: 0.25, kind: "metal" })
		if (look === "concrete") return both(concrete(), { tu: 0.3, tv: 0.3, te: 0.3, kind: "concrete" })
		if (look === "rubber mat") return both(rubber("#18191b"), { tu: 0.1, tv: 0.1, te: 0.1, kind: "rubber" })
		if (look === "rubber") return both(rubber(color), { tu: 0.1, tv: 0.1, te: 0.1, kind: "rubber" })
		if (look === "carpet") return both(pile(color), { tu: 0.08, tv: 0.08, te: 0.08, kind: "carpet" })
		if (look === "brick") return both(brickMat(color), { tu: 0.45, tv: 0.15, te: 0.45, ty: [0.45, 0.15], tz: [0.45, 0.15], tx: [0.45, 0.15], kind: "brick" })
		if (look === "foam") return both(foamMat(color), { tu: 0.2, tv: 0.2, te: 0.2, kind: "foam" })
		if (look === "cardboard") return both(cardboardMat(color), { tu: 0.15, tv: 0.15, te: 0.15, kind: "cardboard" })
		if (look === "glass") return both(glassMat("#ffffff"), { tu: 0.2, tv: 0.2, te: 0.2, kind: "glass" })
		if (look === "ice") return both(glassMat("#e9f6ff", { attenuation: "#a9d6f0", dist: 0.25 }), { tu: 0.2, tv: 0.2, te: 0.2, kind: "ice" })
		return both(plasticMat(color), { tu: 0.2, tv: 0.2, te: 0.2, kind: "plastic" })
	}

	// ---- the light shadow of clear things (a glass pane, a slab of ice): three.js gives a transmissive mesh the full shadow of an opaque one, so the part casts none itself and carries a child that
	// draws nothing in the picture but casts a thin one: its depth material throws away every fragment whose cell of a 2 x 2 ordered (Bayer) dither, taken in SHADOW-MAP pixels, is above
	// `density`, so every soft-shadow filter tap meets the same share of opaque texels and the table gets an even, see-through grey. (The mesh is cloned with the model: copy() keeps the depth material.)
	const depthMats = new Map()
	let proxyMat = null
	const BAYER_GLSL = `float bayer2(vec2 p) {
	vec2 q = mod(floor(p), 2.0);
	float t = q.x < 0.5 ? (q.y < 0.5 ? 0.0 : 3.0) : (q.y < 0.5 ? 2.0 : 1.0);
	return (t + 0.5) / 4.0;
}
`
	class ShadowProxy extends T.Mesh {
		copy(source, recursive) {
			super.copy(source, recursive)
			this.customDepthMaterial = source.customDepthMaterial
			return this
		}
	}
	/** The proxy child that casts a shadow `density` (0..1) dark, with the part's silhouette (`geometry`: a plain box is enough). */
	function lightShadow(geometry, density = 0.25) {
		const key = density.toFixed(3)
		let dm = depthMats.get(key)
		if (!dm) {
			dm = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking })
			dm.onBeforeCompile = (shader) => {
				shader.fragmentShader = shader.fragmentShader.replace("void main() {", `${BAYER_GLSL}\nvoid main() {\n\tif (bayer2(gl_FragCoord.xy) >= ${density.toFixed(4)}) discard;`)
			}
			dm.customProgramCacheKey = () => `sf-clear-shadow-${key}`
			depthMats.set(key, dm)
		}
		proxyMat ??= new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
		const p = new ShadowProxy(geometry, proxyMat)
		p.customDepthMaterial = dm
		p.castShadow = true
		p.receiveShadow = false
		p.renderOrder = -1
		return p
	}

	/**
	 * The grain tile's length along a wooden face `len` long: the wood's own 1 m, or for a longer face its whole length (up to 2 m: one board never shows its
	 * figure and its knot twice), else half or a third of it (the figure stretched at most 2 x: its arches longer, its knot an oval, as on a long board).
	 */
	const grainTile = (len, tu = WOOD_TU) => (len > tu ? len / Math.ceil(len / (2 * tu)) : tu)
	/** A plain board of any material: the rounded box of the part with the skin of its look (grain along x, ends with end grain). */
	function board(ctx, { r = 0.0007, seed = 1, vary = seed, off = {}, w = ctx.w, h = ctx.h, d = ctx.d } = {}) {
		let sk = skin(ctx, { seed })
		if (sk.kind === "wood") sk = { ...sk, tu: grainTile(w, sk.tu) }
		const rr = Math.min(r, h * 0.3, d * 0.3)
		const u0 = w / 2 / sk.tu // the pattern starts at the left end, so a tile seam never cuts the middle of a short board
		const o = { y: [u0, 0.5], z: [u0 + 0.31 * vary, 0.07 + 0.2 * vary], x: [0.5, 0.85], ...off }
		if (sk.kind === "wood" && d > GLUE_OVER) {
			// wider than a plank comes: edge-glued boards
			return kit.group(...gluedCuts(d).map(({ c, s, i }) => {
				const bs = boardSkin(ctx.color, seed, i, vary)
				const g = rbox(w, h, s, Math.min(rr, GLUE_R), boardUV(sk, i, vary, o))
				const m = kit.mesh(g, faces(bs.side, bs.end))
				m.position.z = c
				return m
			}))
		}
		const g = rbox(w, h, d, rr, { tu: sk.tu, tv: sk.tv, te: sk.te, ty: sk.ty, tz: sk.tz, tx: sk.tx, off: o, fit: sk.kind === "wood" })
		return kit.group(kit.mesh(g, faces(sk.side, sk.end)))
	}
	// ---- edge-glued boards: a wooden part wider than 20 cm across its grain is drawn as a glued-up panel of boards no wider than 12 cm (as real ones are made),
	// each its own stretch of the grain and its own shade, so a wide plank or tread shows no column of the same arches and knots (the grain tile is 12.5 cm across)
	const GLUE_OVER = 0.2, GLUE_MAX = 0.12
	const GLUE_R = 0.00025 // the boards' arrises: a fine dark line at each joint
	/** Where a size wider than GLUE_OVER is cut into equal boards: [{c (centre, from the middle), s (width), i}]; one piece when narrower. */
	function gluedCuts(size) {
		if (!(size > GLUE_OVER)) return [{ c: 0, s: size, i: 0 }]
		const n = Math.ceil(size / GLUE_MAX), s = size / n
		return Array.from({ length: n }, (_, i) => ({ c: -size / 2 + (i + 0.5) * s, s, i }))
	}
	/** Board i's wood (the same baked grain, tinted a shade lighter or darker: boards from different planks; two boards side by side always differ by 6 % or more as
	 *  seen: the factors scale the linear colour, about 2.2 times what the eye sees after the sRGB curve). */
	const BOARD_TONES = [1, 0.86, 1.12, 0.91, 1.16, 0.88]
	function boardSkin(hex, seed, i, salt = 0) {
		const k = BOARD_TONES[(i + Math.floor(h3(0, 7, 91 + salt) * 6)) % 6]
		return woodSet(k === 1 ? hex : tone(hex, k), seed)
	}
	/** Board i's rbox uv options (grain along x; boards stacked along z): its own place along the grain tile, every other one turned end for end (its arches point the other way). */
	function boardUV(sk, i, salt, o) {
		const du = h3(i, 1, 33 + salt), flip = i % 2 ? -1 : 1
		return {
			seg: 1, // (a 0.25 mm arris needs no more)
			fit: true,
			tu: sk.tu, tv: sk.tv, te: sk.te, ty: [flip * sk.tu, flip * sk.tv], tz: [sk.tu, sk.tv], tx: [sk.te, sk.te],
			off: { y: [o.y[0] + du, 0.5], z: [o.z[0] + du, o.z[1] + 0.37 * i], x: [0.5, o.x[1] + 0.29 * i] },
		}
	}
	/** The same turned upright: the grain runs up the part (a fulcrum, a post), the cut ends on its top and bottom. w, h, d are the part's own sizes. */
	function upright(ctx, { r = 0.0007, seed = 1, vary = seed, w = ctx.w, h = ctx.h, d = ctx.d, off = {} } = {}) {
		let sk = skin(ctx, { seed })
		if (sk.kind === "wood") sk = { ...sk, tu: grainTile(h, sk.tu) }
		const rr = Math.min(r, w * 0.3, d * 0.3)
		const o = { y: [h / 2 / sk.tu, 0.5], z: [h / 2 / sk.tu + 0.31 * vary, 0.07 + 0.2 * vary], x: [0.5, 0.85], ...off }
		if (sk.kind === "wood" && d > GLUE_OVER) {
			// wider than a plank comes: edge-glued boards (as board())
			return kit.group(...gluedCuts(d).map(({ c, s, i }) => {
				const bs = boardSkin(ctx.color, seed, i, vary)
				const m = kit.mesh(rbox(h, w, s, Math.min(rr, GLUE_R), boardUV(sk, i, vary, o)), faces(bs.side, bs.end))
				m.rotation.z = Math.PI / 2
				m.position.z = c
				return m
			}))
		}
		const g = rbox(h, w, d, rr, { tu: sk.tu, tv: sk.tv, te: sk.te, off: o, fit: sk.kind === "wood" })
		const m = kit.mesh(g, faces(sk.side, sk.end))
		m.rotation.z = Math.PI / 2
		return kit.group(m)
	}

	return {
		ws, board, upright, skin, grainTile, gluedCuts, boardSkin, boardUV, GLUE_OVER, GLUE_R, T, TAU, mod, clamp, mix, sstep, h3, rng, pn, pnTab, pfbm, worley, worleyFn, field, fsamp, rgb, css, shade, tone, f5, M, V2,
		bake, withRepeat,
		woodMaps, endMaps, woodSet, corkMat, millSteel, sawnEnd, brushedMetal, steel, aluminium, chrome, stainless, brass, darkSteel, blackIron, ironMat, galvanised,
		concrete, rubber, rubberMaps, pile, pileMaps, cloth, brickMat, foamMat, cardboardMat, plasticMat, glassMat, frostFine, meltMaps, featherMap, plyMats, plyBoard, extrudeUV,
		rbox, faces, extrudeXY, lathe, tube, decalMat, decalPlane, put, mesh, lightShadow, mergeGeometries, toCreasedNormals, WOOD_TU, WOOD_TV,
	}
}
