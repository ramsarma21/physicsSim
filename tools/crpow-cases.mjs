// The test pairs (x, y) of tools/test-crpow.mjs, made the same in every JavaScript engine: a 32-bit generator, the doubles built from
// their bits and from + - * / only (no Math.exp or Math.log, which differ between engines). Plain ES module, no dependencies.
//   cases(scale, seed) -> [{ name, xy: Float64Array of pairs }]   scale 1 = about 10.4 million pairs

const f64 = new Float64Array(1)
const u32 = new Uint32Array(f64.buffer)
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
const HI = LE ? 1 : 0
const LO = LE ? 0 : 1
const fromWords = (hi, lo) => ((u32[HI] = hi >>> 0), (u32[LO] = lo >>> 0), f64[0])
const hiOf = (x) => ((f64[0] = x), u32[HI])

export const cases = (scale = 1, seed = 0x2545f491) => {
	let s = seed >>> 0
	// xorshift32: integers only, so every engine draws the same numbers
	const u = () => {
		s ^= s << 13
		s >>>= 0
		s ^= s >>> 17
		s ^= s << 5
		s >>>= 0
		return s
	}
	const unit = () => u() / 4294967296 + u() / 18446744073709551616 // [0, 1), 53 random bits or so
	const int = (a, b) => a + (u() % (b - a + 1)) // a..b
	const pow2 = (k) => {
		if (k >= -1022) return fromWords((k + 1023) << 20, 0)
		const b = k + 1074 // a subnormal: one bit of the fraction
		return b >= 32 ? fromWords(1 << (b - 32), 0) : fromWords(0, (1 << b) >>> 0)
	}
	const anyDouble = (eLo, eHi) => fromWords(((int(eLo, eHi) + 1023) << 20) | (u() & 0xfffff), u()) // 2^e (1 + random fraction)
	// a rough log2 (within 0.09), from the bits: to aim y at a wanted size of x ** y
	const log2ish = (x) => {
		const h = hiOf(x)
		return ((h >>> 20) & 0x7ff) - 1023 + (h & 0xfffff) / 1048576
	}
	const out = []
	const group = (name, n, gen) => {
		n = Math.max(1, Math.round(n * scale))
		const xy = new Float64Array(2 * n)
		for (let i = 0; i < n; i++) {
			const [x, y] = gen(i)
			xy[2 * i] = x
			xy[2 * i + 1] = y
		}
		out.push({ name, xy })
	}
	group("random x of any size, y for a result of any size", 3.5e6, () => {
		const x = anyDouble(-1022, 1023)
		const l = log2ish(x) || 1 / 1024
		const want = (unit() * 2 - 1) * 1100 // the result's log2
		return [x, (want / l) * (1 + (unit() - 0.5) / 64)]
	})
	group("x ** 3 and x ** 4 on the micrometre grid (balls sized to 1 um)", 2e6, (i) => [int(1, 1000000) / ((i & 2) ? 1e6 : 2e6), (i & 1) ? 3 : 4])
	group("five-decimal x ** 3, (m / d) ** (1/3), ** 2.5", 1e6, (i) => {
		const k = i % 3
		if (k === 0) return [int(1, 100000) / 100000, 3]
		if (k === 1) return [int(1, 9999999) / 10000 / [7850, 8000, 1100, 700, 2700, 1000][int(0, 5)], 1 / 3]
		return [int(1, 200000) / 100000, 2.5]
	})
	group("common exponents, x in [2^-10, 2^10]", 1e6, () => [anyDouble(-10, 9), [3, 4, 5, 6, 0.25, 0.75, 1.5, 2.5, 1 / 3, -1 / 3, -2, -3, -0.5, 7, 10, 1.25, 1.1][int(0, 16)]])
	group("x near 1, y up to 2^60", 1e6, () => {
		const x = 1 + (unit() - 0.5) * pow2(-int(1, 52))
		return [x, (unit() * 2 - 1) * pow2(int(0, 60))]
	})
	group("exact and halfway results (short mantissas, perfect powers)", 6e5, (i) => {
		const k = i % 12
		const odd = (bits) => (u() & ((1 << bits) - 1)) | 1 | (1 << (bits - 1))
		if (k === 0) return [odd(int(2, 18)) * pow2(int(-60, 40)), 3] // x ** 3 with up to 54 bits: exact or halfway
		if (k === 1) return [odd(int(2, 14)) * pow2(int(-40, 30)), 4]
		if (k === 2) return [odd(int(2, 11)) * pow2(int(-30, 20)), 5]
		if (k === 3) {
			const w = odd(int(2, 26))
			return [w * w * pow2(2 * int(-30, 30)), [0.5, 1.5, 2.5, -0.5, -1.5][int(0, 4)]] // w ** 3 etc: exact or halfway
		}
		if (k === 4) {
			const w = odd(int(2, 13))
			return [w * w * w * w * pow2(4 * int(-20, 20)), [0.25, 0.75, 1.25, -0.25][int(0, 3)]]
		}
		if (k === 5) return [pow2(int(-1074, 1023)), int(-2000, 2000) / pow2(int(0, 12))] // a power of two to a dyadic power
		if (k === 6) return [pow2(int(-60, 60)), int(-40, 40)] // reaching 2^-1075 (the halfway point to 0) and the extremes
		if (k === 7) return [odd(int(2, 12)) * pow2(-int(80, 400)), int(3, 13)] // tiny exact results, many subnormal
		if (k === 8) return [odd(int(2, 18)) * pow2(int(-60, 40)), -int(1, 4)] // reciprocals: rational, not dyadic
		if (k === 9) return [int(2, 1000), int(2, 30)] // whole numbers to whole powers
		if (k === 10) return [int(1, 100000) / 1024, 3]
		return [odd(int(2, 27)) * pow2(int(-30, 30)), 2] // squares
	})
	group("results at the overflow and underflow edges, subnormal results", 6e5, (i) => {
		const x = anyDouble(-30, 30)
		const l = log2ish(x) || 1 / 1024
		const want = (i & 1) ? 1023.5 + unit() * 1.2 : -1082 + unit() * 62
		return [x, want / l]
	})
	group("subnormal x", 2e5, () => [fromWords(u() & 0xfffff, u()) || 5e-324, (unit() * 2 - 1) * 1.2])
	group("negative x, whole y", 5e5, () => [-anyDouble(-20, 20), int(-60, 60)])
	return out
}

// Values for the special-case grid (checked against the engine's own Math.pow, whose special cases ECMAScript fixes exactly).
export const SPECIAL = [NaN, 0, -0, Infinity, -Infinity, 1, -1, 0.5, -0.5, 2, -2, 3, -3, 1.5, -1.5, 4.9e-324, -4.9e-324, 1.7976931348623157e308,
	-1.7976931348623157e308, 9007199254740992, -9007199254740992, 9007199254740993, 0.25, 1 / 3, 18446744073709551616, -18446744073709551616, 36893488147419103232, 1e-300, 1e300, 7]

/** FNV-1a over the 32-bit words of the results' bits, as 8 hex digits, x2 (two seeds): the same text in every engine for the same bits. */
export const digest = (vals) => {
	// a NaN counts as 0x7ff8000000000000 whatever its bits: the engines write different NaN patterns for the same value (V8 and
	// JavaScriptCore differ), so a digest of the raw bytes would differ wherever a result is NaN
	const w = new Uint32Array(vals.buffer, vals.byteOffset, vals.length * 2)
	let a = 0x811c9dc5
	let b = 0x01000193 ^ 0x5bd1e995
	for (let i = 0; i < w.length; i++) {
		const nan = vals[i >> 1] !== vals[i >> 1]
		const v = nan ? (i & 1 ? 0x7ff80000 : 0) : LE ? w[i] : w[i ^ 1]
		a = Math.imul(a ^ v, 0x01000193) >>> 0
		b = Math.imul(b ^ ((v >>> 16) | (v << 16)), 0x01000193) >>> 0
	}
	return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
}
