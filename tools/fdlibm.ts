// The engine's transcendental math, in plain JS, so a run gives the same bits in every browser and on the server, on any machine.
// Math.sin, cos, atan2, exp, hypot and pow are NOT specified to the last bit: Node 26's V8 and Chromium's V8 already differ by 1 ulp on
// 3% (sin, cos), 10% (exp) and 17% (atan2) of inputs, Safari's engine differs on hypot and pow too, and node itself differs between
// machines (its pow is the system libm's). The starter scene is chaotic, so a 1 ulp step shows up as a different track. sin, cos, atan2,
// exp and hypot are ports of what V8 runs in node on macOS arm64 (src/base/ieee754.cc: FreeBSD msun / fdlibm 5.3, with V8's exp(1)
// special case and its hypot with Kahan summation), checked bit for bit against node's Math there by tools/test-fdlibm.mjs; pow is
// tools/crpow.ts, correctly rounded (checked against MPFR by tools/test-crpow.mjs).
// tools/build-engine.mjs makes the bundle use these instead of Math.sin etc. (esbuild `define`), so no global is touched; the server's
// engine (research/poc/worker.ts) and the node tools load the engine through tools/engine-math-node.mjs, which does the same in node.
// Beyond |x| = 2^19*pi/2 (about 8.2e5 rad) sin and cos reduce the angle with fdlibm's big-table routine, which is not ported: they fall
// back to the engine's own Math there (a scene never turns that far).

import { pow as crpow } from "./crpow.ts"

const f64 = new Float64Array(1)
const u32 = new Uint32Array(f64.buffer)
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
const HI = LE ? 1 : 0
const LO = LE ? 0 : 1
const hiOf = (x: number): number => {
	f64[0] = x
	return u32[HI] | 0
}
const loOf = (x: number): number => {
	f64[0] = x
	return u32[LO]
}
const fromWords = (hi: number, lo: number): number => {
	u32[HI] = hi >>> 0
	u32[LO] = lo >>> 0
	return f64[0]
}
// (Reflect.get: the build replaces the text `Math.sin` etc. with these very functions)
const nativeSin = Reflect.get(Math, "sin") as (x: number) => number
const nativeCos = Reflect.get(Math, "cos") as (x: number) => number

// ---- fma: a*b + c with one rounding, exactly (JS has no fused multiply-add). Node and Chromium on arm64 are built with clang's default
// -ffp-contract=on, so V8's C++ math routines fuse some of their a*b + c: that is the bits node produces, and what these ports reproduce.
// Exact product by Dekker's split, exact sum by 2Sum, then the sum of the three pieces rounded once (Boldo & Melquiond: round-to-odd
// on the inner add, round-to-nearest on the outer). Not for results below ~1e-290 (the product error would underflow): plain a*b + c there.
const SPLIT = 134217729 // 2^27 + 1
export const fma = (a: number, b: number, c: number): number => {
	const p = a * b
	if (!(p > 1e-290 || p < -1e-290) || !(p - p === 0) || !(c - c === 0)) return p + c
	let t = SPLIT * a
	const ah = t - (t - a)
	const al = a - ah
	t = SPLIT * b
	const bh = t - (t - b)
	const bl = b - bh
	const e = ah * bh - p + ah * bl + al * bh + al * bl // a*b = p + e exactly
	const s = p + c
	const bb = s - p
	const r = p - (s - bb) + (c - bb) // p + c = s + r exactly
	const u = r + e
	const b2 = u - r
	const err = r - (u - b2) + (e - b2) // r + e = u + err exactly
	if (err === 0) return s + u
	// The usual case, without the bit operations of round-to-odd: u small beside s (|u| < 2^-50 |s|, so s + u lies within 8 ulps of s,
	// where every halfway point between doubles is a multiple of ulp(s)/4). s + u is a multiple of min(lsb(u), ulp(s)/2), so unless it is
	// itself a halfway point it is at least that far from one, more than |err| <= ulp(u)/2: s + u + err rounds as s + u does. A halfway
	// point is the rounding error w of v = s + u being half the gap to v's neighbour: then v + 2w is that neighbour exactly.
	if ((u < 0 ? -u : u) < (s < 0 ? -s : s) * 8.881784197001252e-16) {
		const v = s + u
		const w = u - (v - s) // s + u = v + w exactly (|s| > |u|)
		const w2 = w + w
		if (w === 0 || v + w2 - v !== w2) return v
	}
	f64[0] = u
	if ((u32[LO] & 1) === 0) {
		// u is even: round to odd means the neighbour of u on the side of err
		if (err > 0 === u > 0) u32[LO] += 1
		else if (u32[LO] === 0) {
			u32[HI] -= 1
			u32[LO] = 0xffffffff
		} else u32[LO] -= 1
	}
	return s + f64[0]
}

// ---- sin, cos
const S1 = -1.66666666666666324348e-1
const S2 = 8.33333333332248946124e-3
const S3 = -1.98412698298579493134e-4
const S4 = 2.75573137070700676789e-6
const S5 = -2.50507602534068634195e-8
const S6 = 1.58969099521155010221e-10
const C1 = 4.16666666666666019037e-2
const C2 = -1.38888888888741095749e-3
const C3 = 2.48015872894767294178e-5
const C4 = -2.75573143513906633035e-7
const C5 = 2.0875723212981748279e-9
const C6 = -1.13596475577881948265e-11

const kernelSin = (x: number, y: number, iy: number): number => {
	const ix = hiOf(x) & 0x7fffffff
	if (ix < 0x3e400000 && (x | 0) === 0) return x // |x| < 2^-27
	const z = x * x
	const v = z * x
	const r = fma(z, fma(z, fma(z, fma(z, S6, S5), S4), S3), S2)
	if (iy === 0) return fma(v, fma(z, r, S1), x)
	return x - fma(-v, S1, fma(z, 0.5 * y - v * r, -y))
}

const kernelCos = (x: number, y: number): number => {
	const ix = hiOf(x) & 0x7fffffff
	if (ix < 0x3e400000 && (x | 0) === 0) return 1
	const z = x * x
	const r = z * fma(z, fma(z, fma(z, fma(z, fma(z, C6, C5), C4), C3), C2), C1)
	if (ix < 0x3fd33333) return 1 - (0.5 * z - fma(z, r, -(x * y)))
	let qx: number
	if (ix > 0x3fe90000) qx = 0.28125
	else qx = fromWords(ix - 0x00200000, 0)
	const hz = 0.5 * z - qx
	const a = 1 - qx
	return a - (hz - fma(z, r, -(x * y)))
}

const invpio2 = 6.36619772367581382433e-1
const pio2_1 = 1.57079632673412561417
const pio2_1t = 6.07710050650619224932e-11
const pio2_2 = 6.0771005063039659766e-11
const pio2_2t = 2.02226624879595063154e-21
const pio2_3 = 2.0222662487111664558e-21
const pio2_3t = 8.47842766036889956997e-32
// high words of n*pi/2, n = 1..32
const npio2hw = Array.from({ length: 32 }, (_, i) => hiOf((i + 1) * (Math.PI / 2)))
const ry = [0, 0]

/** x reduced to ry[0] + ry[1] in [-pi/4, pi/4]; returns the quadrant count n. Only for 0x3fe921fb < high word <= 0x413921fb. */
const remPio2 = (x: number): number => {
	const hx = hiOf(x)
	const ix = hx & 0x7fffffff
	let z: number
	if (ix < 0x4002d97c) {
		// |x| < 3pi/4: n = +-1
		if (hx > 0) {
			z = x - pio2_1
			if (ix !== 0x3ff921fb) {
				ry[0] = z - pio2_1t
				ry[1] = z - ry[0] - pio2_1t
			} else {
				z -= pio2_2
				ry[0] = z - pio2_2t
				ry[1] = z - ry[0] - pio2_2t
			}
			return 1
		}
		z = x + pio2_1
		if (ix !== 0x3ff921fb) {
			ry[0] = z + pio2_1t
			ry[1] = z - ry[0] + pio2_1t
		} else {
			z += pio2_2
			ry[0] = z + pio2_2t
			ry[1] = z - ry[0] + pio2_2t
		}
		return -1
	}
	// medium size
	let t = Math.abs(x)
	const n = fma(t, invpio2, 0.5) | 0
	const fn = n
	let r = fma(-fn, pio2_1, t)
	let w = fn * pio2_1t
	if (n < 32 && ix !== npio2hw[n - 1]) {
		ry[0] = r - w
	} else {
		const j = ix >> 20
		ry[0] = r - w
		let i = j - ((hiOf(ry[0]) >> 20) & 0x7ff)
		if (i > 16) {
			t = r
			w = fn * pio2_2
			r = t - w
			w = fma(fn, pio2_2t, -(t - r - w))
			ry[0] = r - w
			i = j - ((hiOf(ry[0]) >> 20) & 0x7ff)
			if (i > 49) {
				t = r
				w = fn * pio2_3
				r = t - w
				w = fma(fn, pio2_3t, -(t - r - w))
				ry[0] = r - w
			}
		}
	}
	ry[1] = r - ry[0] - w
	if (hx < 0) {
		ry[0] = -ry[0]
		ry[1] = -ry[1]
		return -n
	}
	return n
}

const sinRaw = (x: number): number => {
	const ix = hiOf(x) & 0x7fffffff
	if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0)
	if (ix >= 0x7ff00000) return x - x
	if (ix > 0x413921fb) return nativeSin(x)
	const n = remPio2(x)
	switch (n & 3) {
		case 0:
			return kernelSin(ry[0], ry[1], 1)
		case 1:
			return kernelCos(ry[0], ry[1])
		case 2:
			return -kernelSin(ry[0], ry[1], 1)
		default:
			return -kernelCos(ry[0], ry[1])
	}
}

const cosRaw = (x: number): number => {
	const ix = hiOf(x) & 0x7fffffff
	if (ix <= 0x3fe921fb) return kernelCos(x, 0)
	if (ix >= 0x7ff00000) return x - x
	if (ix > 0x413921fb) return nativeCos(x)
	const n = remPio2(x)
	switch (n & 3) {
		case 0:
			return kernelCos(ry[0], ry[1])
		case 1:
			return -kernelSin(ry[0], ry[1], 1)
		case 2:
			return -kernelCos(ry[0], ry[1])
		default:
			return kernelSin(ry[0], ry[1], 1)
	}
}

// A scene turns the same angles over and over (a body at rest is asked for the sine and cosine of its angle every step): the last answers
// are kept in a small table, keyed by the exact bits of the argument, so a repeat costs a lookup instead of the polynomial and its fused
// multiply-adds (62% of the calls in a scene of 300 balls, about 40% in a typical one). The same function of the same bits: no change to any result.
const CACHE_BITS = 10
const makeCache = (compute: (x: number) => number) => {
	const keyHi = new Int32Array(1 << CACHE_BITS)
	const keyLo = new Uint32Array(1 << CACHE_BITS)
	const val = new Float64Array(1 << CACHE_BITS)
	keyHi.fill(0x7ff80001) // empty slots: the key of a NaN with a payload, whose sine is NaN, which is what val holds
	val.fill(NaN)
	return (x: number): number => {
		f64[0] = x
		const hi = u32[HI] | 0
		const lo = u32[LO]
		const h = Math.imul(lo ^ Math.imul(hi, 0x85ebca6b), 0x9e3779b1) >>> (32 - CACHE_BITS)
		if (keyHi[h] === hi && keyLo[h] === lo) return val[h] as number
		const v = compute(x)
		keyHi[h] = hi
		keyLo[h] = lo
		val[h] = v
		return v
	}
}
export const sin = makeCache(sinRaw)
export const cos = makeCache(cosRaw)

// ---- atan, atan2
const atanhi = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.5707963267948965580]
const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17]
const aT = [
	3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1, 9.09088713343650656196e-2,
	-7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.6531572744216915527e-2,
	1.62858201153657823623e-2
]

const atan = (x0: number): number => {
	let x = x0
	const hx = hiOf(x)
	const ix = hx & 0x7fffffff
	let id: number
	if (ix >= 0x44100000) {
		// |x| >= 2^66
		if (ix > 0x7ff00000 || (ix === 0x7ff00000 && loOf(x) !== 0)) return x + x
		return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3]
	}
	if (ix < 0x3fdc0000) {
		// |x| < 0.4375
		if (ix < 0x3e400000) return x // |x| < 2^-27
		id = -1
	} else {
		x = Math.abs(x)
		if (ix < 0x3ff30000) {
			if (ix < 0x3fe60000) {
				id = 0
				x = (2 * x - 1) / (2 + x)
			} else {
				id = 1
				x = (x - 1) / (x + 1)
			}
		} else if (ix < 0x40038000) {
			id = 2
			x = (x - 1.5) / fma(1.5, x, 1)
		} else {
			id = 3
			x = -1 / x
		}
	}
	let z = x * x
	const w = z * z
	const s1 = z * fma(w, fma(w, fma(w, fma(w, fma(w, aT[10], aT[8]), aT[6]), aT[4]), aT[2]), aT[0])
	const s2 = w * fma(w, fma(w, fma(w, fma(w, aT[9], aT[7]), aT[5]), aT[3]), aT[1])
	if (id < 0) return fma(-x, s1 + s2, x)
	z = atanhi[id] - (fma(x, s1 + s2, -atanlo[id]) - x)
	return hx < 0 ? -z : z
}

const pi_o_4 = 7.85398163397448279e-1
const pi_o_2 = 1.570796326794896558
const pi = 3.141592653589793116
const pi_lo = 1.2246467991473531772e-16
const tiny = 1e-300

export const atan2 = (y: number, x: number): number => {
	const hx = hiOf(x)
	const lx = loOf(x)
	const ix = hx & 0x7fffffff
	const hy = hiOf(y)
	const ly = loOf(y)
	const iy = hy & 0x7fffffff
	if ((ix | ((lx | -lx) >>> 31)) > 0x7ff00000 || (iy | ((ly | -ly) >>> 31)) > 0x7ff00000) return x + y
	if (((hx - 0x3ff00000) | lx) === 0) return atan(y)
	let m = ((hy >> 31) & 1) | ((hx >> 30) & 2)
	if ((iy | ly) === 0) {
		switch (m) {
			case 0:
			case 1:
				return y
			case 2:
				return pi + tiny
			default:
				return -pi - tiny
		}
	}
	if ((ix | lx) === 0) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny
	if (ix === 0x7ff00000) {
		if (iy === 0x7ff00000) {
			switch (m) {
				case 0:
					return pi_o_4 + tiny
				case 1:
					return -pi_o_4 - tiny
				case 2:
					return 3 * pi_o_4 + tiny
				default:
					return -3 * pi_o_4 - tiny
			}
		}
		switch (m) {
			case 0:
				return 0
			case 1:
				return -0
			case 2:
				return pi + tiny
			default:
				return -pi - tiny
		}
	}
	if (iy === 0x7ff00000) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny
	const k = (iy - ix) >> 20
	let z: number
	if (k > 60) {
		z = pi_o_2 + 0.5 * pi_lo
		m &= 1
	} else if (hx < 0 && k < -60) {
		z = 0
	} else {
		z = atan(Math.abs(y / x))
	}
	switch (m) {
		case 0:
			return z
		case 1:
			return -z
		case 2:
			return pi - (z - pi_lo)
		default:
			return z - pi_lo - pi
	}
}

// ---- exp (V8's)
const halF = [0.5, -0.5]
const o_threshold = 7.09782712893383973096e2
const u_threshold = -7.4513321910194110842e2
const ln2HI = [6.9314718036912381649e-1, -6.9314718036912381649e-1]
const ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10]
const invln2 = 1.442695040888963387
const EP1 = 1.66666666666666019037e-1
const EP2 = -2.77777777770155933842e-3
const EP3 = 6.61375632143793436117e-5
const EP4 = -1.6533902205465251539e-6
const EP5 = 4.13813679705723846039e-8
const E = 2.718281828459045
const twom1000 = 9.3326361850321887899e-302
const two1023 = 8.988465674311579539e307

export const exp = (x0: number): number => {
	let x = x0
	let hx = hiOf(x)
	const xsb = (hx >>> 31) & 1
	hx &= 0x7fffffff
	if (hx >= 0x40862e42) {
		if (hx >= 0x7ff00000) {
			if (((hx & 0xfffff) | loOf(x)) !== 0) return x + x
			return xsb === 0 ? x : 0
		}
		if (x > o_threshold) return Infinity
		if (x < u_threshold) return 0
	}
	let k = 0
	let hi = 0
	let lo = 0
	if (hx > 0x3fd62e42) {
		if (hx < 0x3ff0a2b2) {
			if (x === 1) return E
			hi = x - ln2HI[xsb]
			lo = ln2LO[xsb]
			k = 1 - xsb - xsb
		} else {
			k = fma(invln2, x, halF[xsb]) | 0
			const t = k
			hi = fma(-t, ln2HI[0], x)
			lo = t * ln2LO[0]
		}
		x = hi - lo
	} else if (hx < 0x3e300000) {
		if (two1023 + x > 1) return 1 + x
	} else {
		k = 0
	}
	const t = x * x
	const twopk = k >= -1021 ? fromWords(0x3ff00000 + (k << 20), 0) : fromWords(0x3ff00000 + ((k + 1000) << 20), 0)
	const c = fma(-t, fma(t, fma(t, fma(t, fma(t, EP5, EP4), EP3), EP2), EP1), x)
	if (k === 0) return 1 - ((x * c) / (c - 2) - x)
	const y = 1 - (lo - (x * c) / (2 - c) - hi)
	if (k >= -1021) {
		if (k === 1024) return y * 2 * two1023
		return y * twopk
	}
	return y * twopk * twom1000
}

// ---- hypot (V8's: scale by the largest, Kahan sum of squares)
export const hypot = (a: number, b: number): number => {
	const x = Math.abs(a)
	const y = Math.abs(b)
	if (a !== a || b !== b) return x === Infinity || y === Infinity ? Infinity : NaN
	const max = x > y ? x : y
	if (max === Infinity) return Infinity
	if (max === 0) return 0
	let sum = 0
	let comp = 0
	for (let i = 0; i < 2; i++) {
		const n = (i === 0 ? x : y) / max
		const summand = n * n - comp
		const prelim = sum + summand
		comp = prelim - sum - summand
		sum = prelim
	}
	return Math.sqrt(sum) * max
}

// ---- pow: correctly rounded (tools/crpow.ts), so it is the same function on every machine and in every engine, and the same as Python's
// exact fractions where the builders need that (machines/crmath.py)
export const pow = crpow
