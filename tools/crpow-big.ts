// The exact half of tools/crpow.ts: x ** y correctly rounded with BigInt arithmetic, for the pairs the double-double path leaves to it
// (results below 2^-1021, the exact and halfway cases such as (1 + 2^-18) ** 3, and about one random pair in 2^38 too near a halfway
// point), and the high-precision logarithms and powers of two that tools/gen-crpow-tables.mjs writes into tools/crpow-tables.ts.
// Slow (5 to 50 microseconds) and simple:
//   1. when x ** y is a dyadic rational (x a power of two, y an integer, or x a perfect 2^k-th power and y = odd / 2^k), it is computed
//      exactly and rounded once: that settles every exact and every halfway case, which no approximation can;
//   2. otherwise x ** y is irrational, or a rational that is not dyadic, or a dyadic too long to be a double or a halfway point; it is
//      then never a rounding boundary, and Ziv's loop settles it: e^(y ln x) is enclosed in an interval of fixed-point BigInts with a
//      proven width, both ends are rounded, and the precision is doubled until they agree.
// Everything here is integer arithmetic (BigInt), so it gives the same answer in every JavaScript engine.
// Plain ES module, no dependencies; pure functions.

const f64 = new Float64Array(1)
const u32 = new Uint32Array(f64.buffer)
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
const HI = LE ? 1 : 0
const LO = LE ? 0 : 1
const fromWords = (hi: number, lo: number): number => {
	u32[HI] = hi >>> 0
	u32[LO] = lo >>> 0
	return f64[0] as number
}

/** 2^k as a double, exactly, for -1074 <= k <= 1023. */
export const pow2 = (k: number): number => {
	if (k >= -1022) return fromWords((k + 1023) << 20, 0)
	const s = k + 1074 // a subnormal: one bit of the 52-bit fraction
	return s >= 32 ? fromWords(1 << (s - 32), 0) : fromWords(0, (1 << s) >>> 0)
}

/** v * 2^k with one rounding at most (exact when the result is a double), for v >= 1 and any integer k. */
export const scale2 = (v: number, k: number): number => {
	while (k > 1023) {
		v *= pow2(1023)
		k -= 1023
		if (v === Infinity) return v
	}
	while (k < -1022) {
		// v >= 1 stays normal through each step but the last
		if (k >= -1022 - 52) {
			v *= pow2(-1022)
			k += 1022
			break
		}
		v *= pow2(-1022)
		k += 1022
		if (v === 0) return 0
	}
	return v * pow2(k)
}

export const bitLength = (n: bigint): number => (n === 0n ? 0 : n.toString(2).length)

/** x (finite, > 0) = m * 2^e with m an odd BigInt. */
export const decompose = (x: number): [bigint, number] => {
	f64[0] = x
	const hi = u32[HI] as number
	const lo = u32[LO] as number
	let e = (hi >>> 20) & 0x7ff
	let mh = hi & 0xfffff
	if (e === 0) e = 1
	else mh |= 0x100000
	let m = (BigInt(mh) << 32n) | BigInt(lo)
	e -= 1075
	if (m === 0n) throw new RangeError("decompose(0)")
	// strip the trailing zero bits
	let tz = 0
	while (((m >> BigInt(tz)) & 0xffffffffn) === 0n) tz += 32
	while (((m >> BigInt(tz)) & 1n) === 0n) tz++
	return [m >> BigInt(tz), e + tz]
}

/**
 * The double nearest to N * 2^e (N > 0), ties to even; `sticky`: the true value is a little above N * 2^e (less than 2^e above it), which
 * only breaks ties, so the caller makes N long enough (at least two bits below the rounding position, see roundRational).
 */
export const roundScaled = (N: bigint, e: number, sticky = false): number => {
	const b = bitLength(N)
	const top = b - 1 + e // N * 2^e is in [2^top, 2^(top+1))
	if (top >= 1024) return Infinity
	if (top < -1076) return 0 // below 2^-1075: rounds to zero (2^-1075 itself is the halfway point to the least subnormal)
	const lsb = Math.max(top - 52, -1074) // the exponent of the result's last bit
	const shift = lsb - e
	if (shift <= 0) {
		if (sticky) throw new RangeError("roundScaled: sticky bit with nothing dropped")
		return scale2(Number(N << BigInt(-shift)), lsb)
	}
	const s = BigInt(shift)
	let q = N >> s
	const r = N - (q << s)
	const half = 1n << (s - 1n)
	if (r > half || (r === half && (sticky || (q & 1n) === 1n))) q += 1n
	if (q === 0n) return 0
	const v = scale2(Number(q), lsb)
	return v
}

/** The double nearest to num / den * 2^e (num, den > 0), ties to even. */
export const roundRational = (num: bigint, den: bigint, e: number): number => {
	// q = floor(num * 2^s / den) with at least 56 bits, so the rounding position is two or more bits above its last bit; a tiny result
	// (num / den * 2^e below about 2^-1020) also gets its last bit below 2^-1076, two bits under the least subnormal
	let s = Math.max(0, 56 + bitLength(den) - bitLength(num))
	if (bitLength(num) - bitLength(den) + e < -1020) s = Math.max(s, e + 1076)
	const n = num << BigInt(s)
	const q = n / den
	return roundScaled(q, e - s, q * den !== n)
}

/** floor(sqrt(n)) for n >= 0 (Newton's method on BigInt). */
const isqrt = (n: bigint): bigint => {
	if (n < 2n) return n
	let x = 1n << BigInt((bitLength(n) >> 1) + 1)
	for (;;) {
		const y = (x + n / x) >> 1n
		if (y >= x) return x
		x = y
	}
}

// ---------------------------------------------------------------- the exact cases
const EXACT_BITS = 4096 // the longest power computed exactly; a longer dyadic cannot be a double or a halfway point

/**
 * x ** y exactly rounded when it is a rational number whose numerator and denominator are short enough to compute (x > 0 finite, y
 * finite and not zero): the exact and halfway cases go through here. Returns undefined when x ** y is not such a number: then it is
 * irrational, or a rational that is not dyadic, or a dyadic longer than EXACT_BITS bits, and in each case not a rounding boundary.
 */
export const exactPow = (x: number, y: number): number | undefined => {
	const [mx, ex] = decompose(x)
	const [my, ey] = decompose(y < 0 ? -y : y)
	const neg = y < 0
	let base: bigint // x ** y = base ** n * 2^(ex * n), n = my when y is an odd integer times 2^ey...
	let n: bigint
	let e2: bigint // ... the power of two: x ** y = base ** n * 2^e2
	if (ey >= 0) {
		n = my << BigInt(ey)
		base = mx
		e2 = BigInt(ex) * n
	} else {
		// y = my / 2^k (my odd): rational only if mx is a perfect 2^k-th power w^(2^k) and ex * my is a multiple of 2^k
		const k = -ey
		const d = 1n << BigInt(k)
		if ((BigInt(ex) * my) % d !== 0n) return undefined
		let w = mx
		if (mx !== 1n) {
			if (k > 5) return undefined // 3^64 > 2^53: no odd mx > 1 is a 2^6-th power
			for (let i = 0; i < k; i++) {
				const s = isqrt(w)
				if (s * s !== w) return undefined
				w = s
			}
		}
		base = w
		n = my
		e2 = (BigInt(ex) * my) / d
	}
	if (neg) e2 = -e2
	if (base === 1n) {
		// a power of two: 2^e2 (or its reciprocal), whatever the exponent
		const e = Number(e2)
		if (e > 2000) return Infinity
		if (e < -2000) return 0
		return roundScaled(1n, e)
	}
	if (bitLength(base) * Number(n) > EXACT_BITS) return undefined
	const p = base ** n
	const e = Number(e2)
	if (e > 1e6 || e < -1e6) return undefined // (cannot happen for a result between the overflow and underflow thresholds)
	return neg ? roundRational(1n, p, e) : roundScaled(p, e)
}

// ---------------------------------------------------------------- fixed point: a BigInt v stands for v / 2^W
/**
 * atanh(z) for |z| <= 1/5, z = v / 2^W exactly; |error| <= 2 * terms + 4 units of 2^-W, terms = the number of series terms (at most
 * W / 5 + 2): each truncated product is off by at most 1.24 units (the error carried from the previous one shrinks by z^2 < 0.03), each
 * truncated division adds 1, and the terms left out sum to less than a unit.
 */
const atanhFixed = (v: bigint, W: number): bigint => {
	const WB = BigInt(W)
	const z2 = (v * v) >> WB
	let term = v
	let sum = v
	for (let k = 3n; ; k += 2n) {
		term = (term * z2) >> WB
		if (term === 0n || term === -1n) break
		sum += term / k
	}
	return sum
}

const LN2_CACHE = new Map<number, bigint>()
// 18, 2 and 8 times three series, each within 2 (W + G) / 9 + 8 units of 2^-(W + G): with G = 16 + ceil(log2 W) guard bits that is under
// 28 (2 (W + G) / 9 + 8) / (65536 W) < 0.001 units of 2^-W for every W >= 128 (powExact's loop goes to W = 65664), and the shift adds one
const LN2_ERR = 4
/** ln 2 * 2^W, to within LN2_ERR units: three atanh series with 16 + ceil(log2 W) guard bits (Machin-like formula), then a truncating shift. */
export const ln2Fixed = (W: number): bigint => {
	const have = LN2_CACHE.get(W)
	if (have !== undefined) return have
	// ln 2 = 18 atanh(1/26) - 2 atanh(1/4801) + 8 atanh(1/8749)
	const G = 16 + (32 - Math.clz32(W - 1)) // 16 + ceil(log2 W), in integers (the same in every engine)
	const WG = W + G
	const one = 1n << BigInt(WG)
	const v = (18n * atanhFixed(one / 26n, WG) - 2n * atanhFixed(one / 4801n, WG) + 8n * atanhFixed(one / 8749n, WG)) >> BigInt(G)
	LN2_CACHE.set(W, v)
	return v
}

/**
 * ln(x) * 2^W for x = mx * 2^ex (mx odd, > 0), to within errUnits units (returned with it). ln x = E ln 2 + 2 atanh((M - 1) / (M + 1)),
 * M = x / 2^E in [sqrt(1/2), sqrt(2)).
 */
const lnFixed = (mx: bigint, ex: number, W: number): { v: bigint; err: number; E: number } => {
	const bm = bitLength(mx)
	// x = mx * 2^ex; M = mx / 2^(bm - 1) in [1, 2), E = bm - 1 + ex
	let E = bm - 1 + ex
	let num = mx // M = num / den
	let den = 1n << BigInt(bm - 1)
	// M > sqrt(2) <=> num^2 > 2 den^2
	if (num * num > 2n * den * den) {
		den <<= 1n
		E += 1
	}
	const WB = BigInt(W)
	const z = ((num - den) << WB) / (num + den) // |z| <= 0.1716; truncation error < 1 unit
	const a = atanhFixed(z, W)
	const terms = Math.ceil(W / 5) + 2
	const v = 2n * a + BigInt(E) * ln2Fixed(W)
	// error: z off by < 1 unit (atanh' <= 1.03 there), the series 2 terms + 4 units, both doubled; ln 2 off by LN2_ERR units times |E|
	const err = 2 * (1.03 + 2 * terms + 4) + Math.abs(E) * LN2_ERR + 1
	return { v, err, E }
}

/**
 * exp(t) for t = v / 2^W (|t| < 1000): returns m, k, err with exp(t) in [(m - err) * 2^(k - W), (m + err) * 2^(k - W)], given that
 * v itself is within errIn units of the true argument.
 */
const expFixed = (v: bigint, errIn: number, W: number): { m: bigint; k: number; err: bigint } => {
	const WB = BigInt(W)
	const L2 = ln2Fixed(W)
	// k = round(t / ln 2)
	let k = v / L2
	let s = v - k * L2
	if (2n * s > L2) {
		k += 1n
		s -= L2
	} else if (2n * s < -L2) {
		k -= 1n
		s += L2
	}
	// s = t - k ln 2 in [-0.35, 0.35]: off by errIn + |k| LN2_ERR units (and the rounding of k)
	const kn = Number(k)
	const errS = errIn + Math.abs(kn) * LN2_ERR + 2
	// exp(s) = sum s^j / j!: each term truncated (1 unit), its error carried forward shrinks (|s| < 0.36)
	const one = 1n << WB
	let term = one
	let sum = one
	let j = 0n
	for (;;) {
		j += 1n
		term = (term * s) / (one * j)
		if (term === 0n) break
		sum += term
	}
	const terms = Number(j)
	// exp(s) <= 1.42; an error of errS units in s is at most 1.43 errS units in exp(s); the series 2 units per term
	const err = BigInt(Math.ceil(1.43 * errS + 2 * terms + 4))
	return { m: sum, k: kn, err }
}

/**
 * The double nearest to x ** y (x > 0 finite, y finite, not zero), ties to even, whatever x and y. The result is decided before this
 * when it overflows or underflows by far; here |y ln x| < 800 or so (the caller checks).
 */
export const powExact = (x: number, y: number): number => {
	const exact = exactPow(x, y)
	if (exact !== undefined) return exact
	const [mx, ex] = decompose(x)
	const [my, ey] = decompose(y < 0 ? -y : y)
	for (let P = 128; P <= 1 << 16; P *= 2) {
		const W = P + 128
		const ln = lnFixed(mx, ex, W)
		// t = y ln x: my * ln shifted by ey (y = +-my * 2^ey)
		let t = my * ln.v
		let errT = Number(my) * ln.err // |my| * err (as a double: an upper bound once rounded up below)
		if (ey >= 0) {
			t <<= BigInt(ey)
			errT *= pow2(ey)
		} else {
			t >>= BigInt(-ey) // floor: within 1 unit
			errT = errT * pow2(ey) + 1
		}
		if (y < 0) t = -t
		errT = errT * (1 + pow2(-40)) + 1 // the double arithmetic of the bound itself, rounded up
		if (!(errT < pow2(W - P - 20))) continue // y * ln x is not known well enough at this W (a huge y): more bits
		const r = expFixed(t, errT, W)
		const lo = roundScaled(r.m - r.err, r.k - W)
		const hi = roundScaled(r.m + r.err, r.k - W)
		if (lo === hi) return lo
	}
	throw new Error(`crpow: no rounding for ${x} ** ${y}`)
}

// ---------------------------------------------------------------- for tools/gen-crpow-tables.mjs
/** The double-double nearest to log2(a) for a double a > 0: [hi, lo] with hi + lo within 2^-106 |log2 a| (hi correctly rounded). */
export const log2DD = (a: number): [number, number] => {
	if (a === 1) return [0, 0]
	const [m, e] = decompose(a)
	const W = 400
	const ln = lnFixed(m, e, W)
	// log2 a = ln a / ln 2, as a rational v / L2: round to a double, then the remainder
	const L2 = ln2Fixed(W)
	const hi = ln.v < 0n ? -roundRational(-ln.v, L2, 0) : roundRational(ln.v, L2, 0)
	// remainder: ln.v / L2 - hi = (ln.v - hi * L2) / L2; hi = mh * 2^he exactly
	const [mh, he] = decompose(Math.abs(hi))
	const hiNum = (hi < 0 ? -mh : mh) * L2 // hi * L2 = hiNum * 2^he
	let num: bigint
	let sh: number
	if (he >= 0) {
		num = ln.v - (hiNum << BigInt(he))
		sh = 0
	} else {
		num = (ln.v << BigInt(-he)) - hiNum
		sh = he
	}
	const lo = num === 0n ? 0 : num < 0n ? -roundRational(-num, L2, sh) : roundRational(num, L2, sh)
	return [hi, lo]
}

/** The double-double nearest to 2^(j / 2^b) (0 <= j < 2^b, b <= 12): [hi, lo] (hi correctly rounded, lo the rounded remainder). */
export const exp2DD = (j: number, b: number): [number, number] => {
	const W = 400
	const t = (BigInt(j) * ln2Fixed(W)) >> BigInt(b)
	const r = expFixed(t, LN2_ERR + 2, W)
	const hi = roundScaled(r.m, r.k - W)
	const [mh, he] = decompose(hi)
	// remainder r.m * 2^(k - W) - mh * 2^he
	const sh = r.k - W
	const num = he >= sh ? r.m - (mh << BigInt(he - sh)) : (r.m << BigInt(sh - he)) - mh
	const s = Math.min(he, sh)
	const lo = num === 0n ? 0 : num < 0n ? -roundScaled(-num, s) : roundScaled(num, s)
	return [hi, lo]
}
