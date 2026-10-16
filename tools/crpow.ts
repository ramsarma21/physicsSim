// x ** y correctly rounded (to nearest, ties to even) for every pair of doubles, with ECMAScript's special cases (Math.pow): the same bits
// in every JavaScript engine and on every machine, and the bits any correctly rounded pow gives (MPFR's, CORE-MATH's, Python's exact
// fractions: tools/test-crpow.mjs checks it against MPFR). Written from first principles for this project; no library's code or tables.
// Only IEEE-754 + - * / and integer operations are used (every engine rounds those identically: JavaScript has no fused multiply-add and
// no extended precision), and BigInt in the rare slow path.
//
// The fast path, |result| in [2^-1021, 2^1024): x ** y = 2^(y log2 x) in double-double arithmetic (Dekker's exact product, Knuth's exact sum).
//   log2 x = E + log2 c + log2(1 + r): x = 2^E z with z in [0.7077, 1.4154), c the midpoint of z's 1/256 of that range (log2 c from a
//     table; c = 1 for the interval around 1, which reaches 2^-9.6 either side of it), r = z / c - 1 exactly as a double-double
//     (|r| < 2^-9.004), ln(1 + r) by its Taylor series to r^11 (Horner's scheme, the last five steps in double-double), times 1 / ln 2.
//   L = y log2 x as a double-double; 2^L = 2^(L >> 8) * 2^(j/256) (a table) * exp(g), g = (L - N/256) ln 2, |g| <= 2^-9.53, exp(g) by its
//     Taylor series to g^8 (the last four steps in double-double).
// Error bound (u = 2^-53; relative errors; every exact step above is exact under the ranges stated):
//   ln(1 + r): truncation |r|^11 / 12 < 2^-102.6; levels 11..6 in double off by at most 2^-54.5, weighed by |r|^5: 2^-99.5; level 5's
//     rounded product 2^-64.5, by |r|^4: 2^-100.5; the double-double levels and the last product 2^-103.4 together: in all < 2^-98.6.
//     Times 1 / ln 2 (a double-double product): < 2^-98.5 for log2(1 + r).
//   + log2 c (table: 2^-107) with one rounding of the low parts (2^-105 of |log2 c| + |log2(1 + r)|): the two cancel at most 2.5 times
//     (z just outside the middle interval: tools/gen-crpow-tables.mjs's intervals), so log2 z is within 2^-96.9 relatively, and log2 x
//     (+ E) within 2^-96.8.
//   L = y log2 x: an exact product plus y times the low part rounded (2^-106 |L|): |L| 2^-96.5 absolutely, so 2^L is off by
//     |L| 2^-96.5 ln 2 < |L| 2^-97 relatively; g's own rounding adds 2^-104 |L|.
//   exp(g): truncation 2^-104.3, levels 8..4 2^-106, the double-double steps and the product with 2^(j/256) 2^-103.5: < 2^-102.8.
//   In all: (Rh + Rl) 2^e is within |L| 2^-96.9 + 2^-102.8 of x ** y, relatively. The rounding test allows (1 + |L|) 2^-92, 30 times more;
//   tools/test-crpow.mjs measures the worst case on 4 million pairs: 2^-99.8 (1 + |L|).
// When the test cannot decide (x ** y within that of a halfway point between two doubles: about one random pair in 2^38, and the exact
// halfway cases such as (1 + 2^-18) ** 3), or the result is tiny (subnormal), tools/crpow-big.ts computes it exactly with BigInt.
import { pow2, powExact } from "./crpow-big.ts"
import { CONSTS, EXP2_TAB, LOG2_TAB, OFF } from "./crpow-tables.ts"

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
const hexDouble = (h: string): number => fromWords(parseInt(h.slice(0, 8), 16), parseInt(h.slice(8, 16), 16))
const pairs = (s: string): [Float64Array, Float64Array] => {
	const w = s.split(" ")
	const hi = new Float64Array(w.length / 2)
	const lo = new Float64Array(w.length / 2)
	for (let i = 0; i < hi.length; i++) {
		hi[i] = hexDouble(w[2 * i] as string)
		lo[i] = hexDouble(w[2 * i + 1] as string)
	}
	return [hi, lo]
}
const K: Record<string, [number, number]> = {}
for (const e of CONSTS.split(" ")) {
	const [name, h, l] = e.split(":") as [string, string, string]
	K[name] = [hexDouble(h), hexDouble(l)]
}
const [LN2_H, LN2_L] = K.LN2 as [number, number]
const [IL_H, IL_L] = K.INVLN2 as [number, number]
const [C3_H, C3_L] = K.THIRD as [number, number]
const [C5_H, C5_L] = K.FIFTH as [number, number]
const [E3_H, E3_L] = K.SIXTH as [number, number]
const [E4_H, E4_L] = K.R24 as [number, number]
const [LT_H, LT_L] = pairs(LOG2_TAB)
const [ET_H, ET_L] = pairs(EXP2_TAB)
// 1 / c for each interval of the logarithm (c = 1 for the middle one): exact IEEE divisions, the same everywhere (and in the generator)
const INVC = new Float64Array(256)
for (let i = 0; i < 256; i++) INVC[i] = i === 149 ? 1 : 1 / ((fromWords(OFF + i * 4096, 0) + fromWords(OFF + (i + 1) * 4096, 0)) / 2)
// ln(1 + r) = r - r^2/2 + r^3/3 - ...: the coefficients from r^6 on as doubles
const L6 = -1 / 6
const L7 = 1 / 7
const L8 = -1 / 8
const L9 = 1 / 9
const L10 = -1 / 10
const L11 = 1 / 11
// exp(g) = 1 + g + g^2/2 + ...: 1/k! from k = 5 on
const E5 = 1 / 120
const E6 = 1 / 720
const E7 = 1 / 5040
const E8 = 1 / 40320

const SPLIT = 134217729 // 2^27 + 1: Dekker's split
const EPS_A = pow2(-92) // the rounding test's allowance: (EPS_A + EPS_B |L|) relative
const EPS_B = pow2(-92)

/**
 * The fast path for x > 0 normal or subnormal, y finite with |y| <= 2^64: returns the correctly rounded |x| ** y, or NaN when it cannot
 * be sure (then the caller takes the exact path). `out` (for tests) receives the double-double result before rounding.
 */
const fast = (x: number, y: number, out?: Float64Array): number => {
	// ---- x = 2^E z, z in [fromWords(OFF), 2 fromWords(OFF)), interval i
	f64[0] = x
	let hx = u32[HI] as number
	let E = 0
	if (hx < 0x00100000) {
		// subnormal: scale by 2^64 (exact)
		f64[0] = x * 18446744073709551616
		hx = u32[HI] as number
		E = -64
	}
	const lx = u32[LO] as number
	const t = (hx - OFF) | 0
	const k = t >> 20
	const i = (t >> 12) & 255
	E += k
	const z = fromWords(hx - (k << 20), lx)
	// ---- r = z invc - 1 exactly: z invc = p + pe (Dekker), p - 1 exact (Sterbenz), then (p - 1) + pe as rh + rl
	const invc = INVC[i] as number
	let rh: number
	let rl: number
	{
		const p = z * invc
		let s = SPLIT * z
		const zh = s - (s - z)
		const zl = z - zh
		s = SPLIT * invc
		const ch = s - (s - invc)
		const cl = invc - ch
		const pe = zh * ch - p + zh * cl + zl * ch + zl * cl
		const d = p - 1
		rh = d + pe
		rl = pe - (rh - d)
	}
	// split of rh, used by every exact product with r below
	let s = SPLIT * rh
	const r1 = s - (s - rh)
	const r2 = rh - r1
	// ---- ln(1 + r): Horner from r^11 down; levels 11..6 in double, 5 with a double-double constant, 4..1 in double-double
	let q = L11
	q = L10 + rh * q
	q = L9 + rh * q
	q = L8 + rh * q
	q = L7 + rh * q
	q = L6 + rh * q
	let qh: number
	let ql: number
	let ph: number
	let pl: number
	{
		// level 5: 1/5 + r q6
		const p = rh * q
		const sh = C5_H + p
		ql = p - (sh - C5_H) + (C5_L + rl * q)
		qh = sh
	}
	// level 4: -1/4 + r q (r q exactly by Dekker, plus the cross terms)
	ph = rh * qh
	s = SPLIT * qh
	let a1 = s - (s - qh)
	let a2 = qh - a1
	pl = r1 * a1 - ph + r1 * a2 + r2 * a1 + r2 * a2 + (rh * ql + rl * qh)
	s = -0.25 + ph
	ql = ph - (s - -0.25) + pl
	qh = s
	// level 3: 1/3 + r q
	ph = rh * qh
	s = SPLIT * qh
	a1 = s - (s - qh)
	a2 = qh - a1
	pl = r1 * a1 - ph + r1 * a2 + r2 * a1 + r2 * a2 + (rh * ql + rl * qh)
	s = C3_H + ph
	ql = ph - (s - C3_H) + (pl + C3_L)
	qh = s
	// level 2: -1/2 + r q
	ph = rh * qh
	s = SPLIT * qh
	a1 = s - (s - qh)
	a2 = qh - a1
	pl = r1 * a1 - ph + r1 * a2 + r2 * a1 + r2 * a2 + (rh * ql + rl * qh)
	s = -0.5 + ph
	ql = ph - (s - -0.5) + pl
	qh = s
	// level 1: 1 + r q
	ph = rh * qh
	s = SPLIT * qh
	a1 = s - (s - qh)
	a2 = qh - a1
	pl = r1 * a1 - ph + r1 * a2 + r2 * a1 + r2 * a2 + (rh * ql + rl * qh)
	s = 1 + ph
	ql = ph - (s - 1) + pl
	qh = s
	// ln(1 + r) = r q
	ph = rh * qh
	s = SPLIT * qh
	a1 = s - (s - qh)
	a2 = qh - a1
	pl = r1 * a1 - ph + r1 * a2 + r2 * a1 + r2 * a2 + (rh * ql + rl * qh)
	// log2(1 + r) = ln(1 + r) / ln 2: times INVLN2 (double-double)
	let lh: number
	let ll: number
	{
		const h = ph + pl
		const l = pl - (h - ph)
		const m = h * IL_H
		s = SPLIT * h
		const b1 = s - (s - h)
		const b2 = h - b1
		s = SPLIT * IL_H
		const c1 = s - (s - IL_H)
		const c2 = IL_H - c1
		lh = m
		ll = b1 * c1 - m + b1 * c2 + b2 * c1 + b2 * c2 + (h * IL_L + l * IL_H)
	}
	// + log2 c (table, double-double): exact sum of the high parts (2Sum), the low parts added
	{
		const th = LT_H[i] as number
		const sh = th + lh
		const bb = sh - th
		const e = th - (sh - bb) + (lh - bb) + ((LT_L[i] as number) + ll)
		lh = sh + e
		ll = e - (lh - sh)
	}
	// + E (an integer; |log2 z| < 0.51, so E dominates when it is not 0)
	if (E !== 0) {
		const sh = E + lh
		const e = lh - (sh - E) + ll
		lh = sh + e
		ll = e - (lh - sh)
	}
	// ---- L = y log2 x (|y| <= 2^64, |log2 x| < 1076: no overflow in the split)
	let Lh = y * lh
	if (!(Lh < 1025)) return Infinity // L >= 1025 - 2^-40: past the largest double
	if (Lh < -1080) return 0 // below 2^-1079.9: under half the least subnormal
	if (Lh < -1021) return NaN // tiny or subnormal: the exact path
	let Ll: number
	{
		s = SPLIT * y
		const y1 = s - (s - y)
		const y2 = y - y1
		s = SPLIT * lh
		const b1 = s - (s - lh)
		const b2 = lh - b1
		Ll = y1 * b1 - Lh + y1 * b2 + y2 * b1 + y2 * b2 + y * ll
		const h = Lh + Ll
		Ll = Ll - (h - Lh)
		Lh = h
	}
	// ---- 2^L = 2^e 2^(j/256) exp(g)
	const N = Math.round(Lh * 256)
	const j = N & 255
	const e2 = (N - j) / 256
	const fh = Lh - N / 256 // exact (Sterbenz)
	// g = (fh + Ll) ln 2
	let gh = fh * LN2_H
	let gl: number
	{
		s = SPLIT * fh
		const b1 = s - (s - fh)
		const b2 = fh - b1
		s = SPLIT * LN2_H
		const c1 = s - (s - LN2_H)
		const c2 = LN2_H - c1
		gl = b1 * c1 - gh + b1 * c2 + b2 * c1 + b2 * c2 + (fh * LN2_L + Ll * LN2_H)
		const h = gh + gl
		const bb = h - gh
		gl = gh - (h - bb) + (gl - bb)
		gh = h
	}
	s = SPLIT * gh
	const g1 = s - (s - gh)
	const g2 = gh - g1
	// exp(g) = 1 + g Q1, Q1 = 1 + g/2 + g^2/6 + ...: levels 8..5 in double, 4 with a double-double constant, 3..1 in double-double
	q = E8
	q = E7 + gh * q
	q = E6 + gh * q
	q = E5 + gh * q
	{
		// level 4: 1/24 + g q5
		const p = gh * q
		const sh = E4_H + p
		ql = p - (sh - E4_H) + (E4_L + gl * q)
		qh = sh
	}
	// level 3: 1/6 + g q
	ph = gh * qh
	s = SPLIT * qh
	a1 = s - (s - qh)
	a2 = qh - a1
	pl = g1 * a1 - ph + g1 * a2 + g2 * a1 + g2 * a2 + (gh * ql + gl * qh)
	s = E3_H + ph
	ql = ph - (s - E3_H) + (pl + E3_L)
	qh = s
	// level 2: 1/2 + g q
	ph = gh * qh
	s = SPLIT * qh
	a1 = s - (s - qh)
	a2 = qh - a1
	pl = g1 * a1 - ph + g1 * a2 + g2 * a1 + g2 * a2 + (gh * ql + gl * qh)
	s = 0.5 + ph
	ql = ph - (s - 0.5) + pl
	qh = s
	// level 1: 1 + g q
	ph = gh * qh
	s = SPLIT * qh
	a1 = s - (s - qh)
	a2 = qh - a1
	pl = g1 * a1 - ph + g1 * a2 + g2 * a1 + g2 * a2 + (gh * ql + gl * qh)
	s = 1 + ph
	ql = ph - (s - 1) + pl
	qh = s
	// exp(g) = 1 + g q
	ph = gh * qh
	s = SPLIT * qh
	a1 = s - (s - qh)
	a2 = qh - a1
	pl = g1 * a1 - ph + g1 * a2 + g2 * a1 + g2 * a2 + (gh * ql + gl * qh)
	s = 1 + ph
	ql = ph - (s - 1) + pl
	qh = s
	// times 2^(j/256)
	const th = ET_H[j] as number
	const Rh = th * qh
	let Rl: number
	{
		s = SPLIT * th
		const b1 = s - (s - th)
		const b2 = th - b1
		s = SPLIT * qh
		const c1 = s - (s - qh)
		const c2 = qh - c1
		Rl = b1 * c1 - Rh + b1 * c2 + b2 * c1 + b2 * c2 + (th * ql + (ET_L[j] as number) * qh)
	}
	if (out !== undefined) {
		out[0] = Rh
		out[1] = Rl
		out[2] = e2
		out[3] = Lh
	}
	// ---- the rounding test: every value within the error bound rounds to the same double
	const err = Rh * (EPS_A + EPS_B * (Lh < 0 ? -Lh : Lh))
	const v = Rh + (Rl - err)
	if (v !== Rh + (Rl + err)) return NaN
	// 2^e2 times v: exact (the result is normal: L >= -1021), or Infinity past the largest double
	return e2 > 1000 ? v * pow2(1000) * pow2(e2 - 1000) : v * pow2(e2)
}

/** Whether y (finite) is an odd integer. */
const isOddInteger = (y: number): boolean => {
	const a = y < 0 ? -y : y
	if (!(a < 9007199254740992)) return false // from 2^53 on every double is even
	return Math.floor(a) === a && a % 2 === 1
}

/** x ** y as Math.pow defines it (ECMAScript Number::exponentiate), correctly rounded. */
export const pow = (x: number, y: number): number => {
	// cases that are exact or correctly rounded by one IEEE operation
	if (y === 2) return x * x
	if (y === 1) return x
	if (y === 0.5) return x === -Infinity ? Infinity : Math.sqrt(x + 0)
	if (y === -1) return 1 / x
	// the special values, in the order of the specification
	if (y !== y) return NaN
	if (y === 0) return 1
	if (x !== x) return NaN
	const ay = y < 0 ? -y : y
	if (ay === Infinity) {
		const ax = x < 0 ? -x : x
		if (ax === 1) return NaN
		return ax > 1 === y > 0 ? Infinity : 0
	}
	if (x === 0) {
		const odd = 1 / x < 0 && isOddInteger(y) // -0 to an odd power keeps its sign
		if (y > 0) return odd ? -0 : 0
		return odd ? -Infinity : Infinity
	}
	if (x === Infinity) return y > 0 ? Infinity : 0
	if (x === -Infinity) {
		const odd = isOddInteger(y)
		if (y > 0) return odd ? -Infinity : Infinity
		return odd ? -0 : 0
	}
	let neg = false
	let ax = x
	if (x < 0) {
		if (Math.floor(y) !== y) return NaN
		neg = isOddInteger(y)
		ax = -x
	}
	let v: number
	if (ay > 18446744073709551616) {
		// |y| > 2^64 (and x not 1): |y log2 x| > 2^64 2^-53 > 1100, an overflow or an underflow
		if (ax === 1) v = 1
		else v = ax > 1 === y > 0 ? Infinity : 0
	} else {
		v = fast(ax, y)
		if (v !== v) v = powExact(ax, y)
	}
	return neg ? -v : v
}

/** x ** 3, correctly rounded (the page's ball volumes). */
export const cube = (x: number): number => pow(x, 3)

/** For tools/test-crpow.mjs: the fast path's double-double result before rounding ([Rh, Rl, e, Lh]: x ** y = (Rh + Rl) 2^e). */
export const _fastParts = (x: number, y: number, out?: Float64Array): number => fast(x < 0 ? -x : x, y, out)
