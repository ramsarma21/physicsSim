// Python's numbers and strings, in JavaScript: what machines/items.py and web/server.py do with them, done the same way.
// Plain ES module, no dependencies; runs in the browser and in node. Every function here is checked against CPython (3.13) by
// tools/parity/prims.mjs; the notes say where JavaScript differs and what is done about it. What depends on the Unicode version (which
// characters repr() escapes, which are decimal digits, how lower() maps them) comes from unicode.js, made by tools/parity/gen_unicode.py from
// CPython's own tables, so every browser answers as Python 3.13 does whatever Unicode version it has itself.

// ---------------------------------------------------------------- errors (Python's, by name)
export class ValueError extends Error {
	constructor(message) {
		super(message)
		this.name = "ValueError"
	}
}
export class ArithmeticError extends Error {
	constructor(message) {
		super(message)
		this.name = "ArithmeticError"
	}
}
export class ZeroDivisionError extends ArithmeticError {
	constructor(message = "float division by zero") {
		super(message)
		this.name = "ZeroDivisionError"
	}
}

/** a / b as Python does it: dividing by zero raises (JavaScript gives Infinity or NaN). */
export const div = (a, b) => {
	if (b === 0) throw new ZeroDivisionError()
	return a / b
}

import { TRIG30_COS, TRIG30_RANGE, TRIG30_SIN } from "./trig.js"
import { DECIMAL_ZEROS, LOWER_MULTI, LOWER_RUNS, NONPRINTABLE, SIGMA_CLASS } from "./unicode.js"

export const D2R = Math.PI / 180 // math.pi / 180

// ---------------------------------------------------------------- objects with any string key
/** obj[key] = value even for the key "__proto__" (an item id or a prop name is whatever the user typed). */
export const setOwn = (obj, key, value) => {
	Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
	return obj
}
export const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

/** A Python int marker for the few places where int and float print differently (the material key's JSON). */
export class PyInt {
	constructor(value) {
		this.value = value
	}
}

// ---------------------------------------------------------------- truthiness, max, min
/** Python's `bool(v)` for the values a scene can hold. */
export function truthy(v) {
	if (v === null || v === undefined) return false
	if (typeof v === "boolean") return v
	if (typeof v === "number") return v !== 0 // NaN is true in Python
	if (typeof v === "string") return v.length > 0
	if (v instanceof PyInt) return v.value !== 0
	if (Array.isArray(v)) return v.length > 0
	if (typeof v === "object") return Object.keys(v).length > 0
	return true
}
/** max(a, b) and min(a, b): the FIRST of two equal values wins (it matters for 0.0 and -0.0). */
export const pymax = (a, b) => (b > a ? b : a)
export const pymin = (a, b) => (b < a ? b : a)
/** max()/min() of a list, first of equals; throws ValueError on an empty list like Python. */
export function maxOf(list) {
	if (!list.length) throw new ValueError("max() iterable argument is empty")
	let m = list[0]
	for (let i = 1; i < list.length; i++) if (list[i] > m) m = list[i]
	return m
}
export function minOf(list) {
	if (!list.length) throw new ValueError("min() iterable argument is empty")
	let m = list[0]
	for (let i = 1; i < list.length; i++) if (list[i] < m) m = list[i]
	return m
}

// ---------------------------------------------------------------- exact decimal work (BigInt)
const f64 = new DataView(new ArrayBuffer(8))

/** x (finite, > 0) = m * 2**e with m an integer (BigInt). */
function decompose(x) {
	f64.setFloat64(0, x)
	const hi = f64.getUint32(0)
	const lo = f64.getUint32(4)
	const biased = (hi >>> 20) & 0x7ff
	let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
	if (biased === 0) return { m, e: -1074 }
	m |= 1n << 52n
	return { m, e: biased - 1075 }
}

const pow10 = (n) => 10n ** BigInt(n)

/** round-half-even of num / den (BigInt, den > 0, num >= 0). */
function divRoundEven(num, den) {
	let q = num / den
	const r = num - q * den
	const twice = r * 2n
	if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n
	return q
}

/** The integer nearest ax * 10**n (ax finite, >= 0), ties to even, on ax's exact binary value. */
function scaledRound(ax, n) {
	if (ax === 0) return 0n
	const { m, e } = decompose(ax)
	let num = m
	let den = 1n
	if (e >= 0) num <<= BigInt(e)
	else den <<= BigInt(-e)
	if (n >= 0) num *= pow10(n)
	else den *= pow10(-n)
	return divRoundEven(num, den)
}

/** Python's round(x, n) for a float x: the decimal rounding is exact (ties to even on the binary value) and the result is the double
 *  nearest that decimal. toFixed does the same except on exact ties (it rounds those up), so a tie is settled here. */
export function pyRound(x, n) {
	if (!Number.isFinite(x) || x === 0) return x
	if (n > 323) return x
	if (n < -308) return 0 * x
	const ax = Math.abs(x)
	const neg = x < 0
	if (n >= 0 && n <= 100 && ax < 1e21) {
		// a tie needs ax * 2**(n+1) to be an odd integer
		const t = ax * 2 ** (n + 1)
		if (!(Number.isInteger(t) && t % 2 === 1)) {
			const r = Number(ax.toFixed(n))
			return neg ? -r : r
		}
	}
	const q = scaledRound(ax, n)
	const r = Number(`${q}e${-n}`)
	return neg ? -r : r
}

/** Python's round(x) for a float: an int, ties to even (-0.5 -> 0). */
export function pyRoundInt(x) {
	if (!Number.isFinite(x)) throw new ValueError(Number.isNaN(x) ? "cannot convert float NaN to integer" : "cannot convert float infinity to integer")
	let r = Math.round(x) // ties toward +infinity
	if (Math.abs(x % 1) === 0.5 && r % 2 !== 0) r -= 1 // an exact tie that landed odd: the even neighbour is one below
	return r === 0 ? 0 : r
}

// ---------------------------------------------------------------- printing floats
/** repr(x) for a Python float: the shortest digits that read back, 1e-05 / 1e+16 style exponents, ".0" on whole numbers. */
export function floatRepr(x) {
	if (Number.isNaN(x)) return "nan"
	if (x === Infinity) return "inf"
	if (x === -Infinity) return "-inf"
	if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0"
	const sign = x < 0 ? "-" : ""
	const [mant, exp] = Math.abs(x).toExponential().split("e")
	const digits = mant.replace(".", "")
	const decpt = Number(exp) + 1 // x = 0.DIGITS * 10**decpt
	let body
	if (decpt <= -4 || decpt > 16) {
		const e = decpt - 1
		body = `${digits[0]}${digits.length > 1 ? "." + digits.slice(1) : ""}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`
	} else if (decpt <= 0) body = `0.${"0".repeat(-decpt)}${digits}`
	else if (decpt >= digits.length) body = `${digits}${"0".repeat(decpt - digits.length)}.0`
	else body = `${digits.slice(0, decpt)}.${digits.slice(decpt)}`
	return sign + body
}

/** format(x, ".{n}f") */
export function fmtF(x, n) {
	if (Number.isNaN(x)) return "nan"
	if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf"
	const sign = x < 0 || Object.is(x, -0) ? "-" : ""
	let s = scaledRound(Math.abs(x), n).toString()
	if (n > 0) {
		s = s.padStart(n + 1, "0")
		s = `${s.slice(0, -n)}.${s.slice(-n)}`
	}
	return sign + s
}

/** format(x, ".{p}g") */
export function fmtG(x, p) {
	if (Number.isNaN(x)) return "nan"
	if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf"
	if (p === 0) p = 1
	const sign = x < 0 || Object.is(x, -0) ? "-" : ""
	const ax = Math.abs(x)
	if (ax === 0) return sign + "0"
	// p significant digits: find the decimal exponent e10 so that round(ax / 10**(e10 - p + 1)) has exactly p digits
	let e10 = Math.floor(Math.log10(ax))
	let q
	for (let tries = 0; tries < 4; tries++) {
		q = scaledRound(ax, p - 1 - e10)
		if (q >= pow10(p)) e10 += 1
		else if (q < pow10(p - 1)) e10 -= 1
		else break
	}
	let digits = q.toString()
	if (e10 < -4 || e10 >= p) {
		digits = digits.replace(/0+$/, "") || "0"
		const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits
		return `${sign}${mant}e${e10 < 0 ? "-" : "+"}${String(Math.abs(e10)).padStart(2, "0")}`
	}
	let s
	if (e10 >= 0) s = `${digits.slice(0, e10 + 1)}${digits.length > e10 + 1 ? "." + digits.slice(e10 + 1) : ""}`
	else s = `0.${"0".repeat(-e10 - 1)}${digits}`
	if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "")
	return sign + s
}

/** Python's sum() of floats (3.12+: Neumaier's compensated sum). */
export function pySum(values) {
	if (!values.length) return 0
	let f = values[0]
	let c = 0.0
	for (let i = 1; i < values.length; i++) {
		const x = values[i]
		const t = f + x
		if (Math.abs(f) >= Math.abs(x)) c += f - t + x
		else c += x - t + f
		f = t
	}
	if (c && Number.isFinite(c)) f += c
	return f
}

// ---------------------------------------------------------------- math.hypot: CPython's own algorithm (not libm), so the bits match
// V8's Math.hypot differs from it in the last bit for about a third of random pairs; this is Modules/mathmodule.c vector_norm (3.12+),
// with the fma of dl_mul done by Dekker's exact product.
const SPLIT = 134217729 // 2**27 + 1
function twoProd(x, y) {
	const z = x * y
	let t = x * SPLIT
	const xh = t - (t - x)
	const xl = x - xh
	t = y * SPLIT
	const yh = t - (t - y)
	const yl = y - yh
	return [z, xh * yh - z + xh * yl + xl * yh + xl * yl]
}
function ldexp1(k) {
	// 2**k exactly, for -1022 <= k <= 1023
	if (k < -1022) return 2 ** k
	f64.setUint32(0, (k + 1023) << 20)
	f64.setUint32(4, 0)
	return f64.getFloat64(0)
}
function frexpExp(x) {
	// the e of frexp: x = m * 2**e with 0.5 <= m < 1 (x > 0, finite)
	f64.setFloat64(0, x)
	const biased = (f64.getUint32(0) >>> 20) & 0x7ff
	if (biased === 0) return Math.floor(Math.log2(x)) + 1 // subnormal: only the "< -1023" test matters
	return biased - 1022
}
function vectorNorm(vec, max, foundNan) {
	if (max === Infinity) return max
	if (foundNan) return NaN
	const n = vec.length
	if (max === 0 || n <= 1) return max
	const maxE = frexpExp(max)
	if (maxE < -1023) {
		const MIN = 2.2250738585072014e-308 // DBL_MIN
		return MIN * vectorNorm(vec.map((v) => v / MIN), max / MIN, foundNan)
	}
	const scale = ldexp1(-maxE)
	let csum = 1.0
	let frac1 = 0.0
	let frac2 = 0.0
	for (let i = 0; i < n; i++) {
		const x = vec[i] * scale // lossless scaling
		const [phi, plo] = twoProd(x, x) // lossless squaring
		const sx = csum + phi // lossless addition (csum >= phi)
		const sy = csum - sx + phi
		csum = sx
		frac1 += plo
		frac2 += sy
	}
	let h = Math.sqrt(csum - 1.0 + (frac1 + frac2))
	const [qhi, qlo] = twoProd(-h, h)
	const sx = csum + qhi
	const sy = csum - sx + qhi
	csum = sx
	frac1 += qlo
	frac2 += sy
	const x = csum - 1.0 + (frac1 + frac2)
	h += x / (2.0 * h) // differential correction
	return h / scale
}
/** math.hypot(...args) */
export function hypot(...args) {
	const vec = new Array(args.length)
	let max = 0
	let foundNan = false
	for (let i = 0; i < args.length; i++) {
		const v = Math.abs(args[i])
		vec[i] = v
		if (Number.isNaN(v)) foundNan = true
		else if (v > max) max = v
	}
	return vectorNorm(vec, max, foundNan)
}

// ---------------------------------------------------------------- libm: what JavaScript's Math gives instead (reported by prims.mjs)
// sin/cos/pow/log10 are the engine's own (V8: fdlibm; the other browsers differ again); CPython calls the platform libm. They agree to the last
// bit most of the time (pow(x, 3): always in the checks; sin/cos: all but about 4% of random arguments, by one unit in the last place), and
// every number the builders print goes through round(.., 5 or 6), so a last-bit difference shows only when a value sits exactly on a rounding
// tie. That happens by construction at multiples of 30 degrees (sin/cos 0, +-1/2, +-1: an offset of five decimals times 1/2 is a tie), where
// V8 differs from CPython at cos(+-120 deg) and six more such angles in +-3600: for those arguments (degrees * D2R) the table made by
// tools/parity/gen_trig.py gives CPython's values, in every browser. Everything else is Math.sin / Math.cos.
function thirtyDegrees(x) {
	const d = Math.round(x / D2R)
	return d !== 0 && d % 30 === 0 && d >= -TRIG30_RANGE && d <= TRIG30_RANGE && d * D2R === x ? d / 30 + TRIG30_RANGE / 30 : -1
}
export const sin = (x) => {
	const i = thirtyDegrees(x)
	return i < 0 ? Math.sin(x) : TRIG30_SIN[i]
}
export const cos = (x) => {
	const i = thirtyDegrees(x)
	return i < 0 ? Math.cos(x) : TRIG30_COS[i]
}
// cube(x): the engine's own deterministic pow (web/sim/engine-math.js, the same bits in every browser), so ball volumes come out as the server's do
export { cube } from "./engine-math.js"
export const log10 = Math.log10
export const floorLog10 = (x) => Math.floor(Math.log10(x))
/** math.degrees(x) */
export const degrees = (x) => x * (180.0 / Math.PI)

// ---------------------------------------------------------------- strings
const SPACE = /^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g
/** sorted(strings): by code point, as Python does (JavaScript's default compares UTF-16 units, which puts emoji before U+E000-FFFF). */
export function pySorted(strings) {
	const cps = new Map(strings.map((k) => [k, Array.from(k, (c) => c.codePointAt(0))]))
	return [...strings].sort((a, b) => {
		const x = cps.get(a)
		const y = cps.get(b)
		for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]
		return x.length - y.length
	})
}
/** str.strip() (Python's whitespace: not U+FEFF, but U+001C-001F and U+0085). */
export const pyStrip = (s) => s.replace(SPACE, "")
/** How Final_Sigma sees a code point: 1 = case-ignorable (skipped), 2 = cased, 0 = neither (Python 3.13's Unicode). */
function sigmaClass(cp) {
	const i = entryAt(SIGMA_CLASS, 3, cp)
	return i >= 0 && cp <= SIGMA_CLASS[i * 3 + 1] ? SIGMA_CLASS[i * 3 + 2] : 0
}
/** str.lower() for the characters of Python 3.13's Unicode, whatever the engine's own: a table of the non-ASCII mappings, and CPython's Final_Sigma
 *  rule for U+03A3 (lower-cased to U+03C2 when a cased letter comes before it and none after it, skipping case-ignorable characters; else U+03C3). */
export function pyLower(s) {
	if (/^[\x00-\x7f]*$/.test(s)) return s.toLowerCase()
	const cps = Array.from(s, (c) => c.codePointAt(0)) // (a lone surrogate is a code point of its own, as in Python)
	let out = ""
	for (let i = 0; i < cps.length; i++) {
		const cp = cps[i]
		if (cp < 0x80) out += cp >= 65 && cp <= 90 ? String.fromCharCode(cp + 32) : String.fromCharCode(cp)
		else if (cp === 0x3a3) {
			let j = i - 1
			while (j >= 0 && sigmaClass(cps[j]) === 1) j--
			let final = j >= 0 && sigmaClass(cps[j]) === 2
			if (final) {
				j = i + 1
				while (j < cps.length && sigmaClass(cps[j]) === 1) j++
				final = j === cps.length || sigmaClass(cps[j]) !== 2
			}
			out += final ? "\u03c2" : "\u03c3"
		} else {
			const k = entryAt(LOWER_RUNS, 4, cp)
			if (k >= 0 && cp <= LOWER_RUNS[k * 4 + 1] && (cp - LOWER_RUNS[k * 4]) % LOWER_RUNS[k * 4 + 2] === 0) out += String.fromCodePoint(cp + LOWER_RUNS[k * 4 + 3])
			else {
				const multi = LOWER_MULTI.find((m) => m[0] === cp)
				out += multi ? multi[1] : String.fromCodePoint(cp)
			}
		}
	}
	return out
}
/** A string's length in code points (len(s)); s[:n] likewise. */
export const pyLen = (s) => {
	let n = 0
	for (const _ of s) n++ // eslint-disable-line no-unused-vars
	return n
}
export const pySlice = (s, n) => (s.length <= n ? s : Array.from(s).slice(0, n).join(""))

/** Index of the last entry of a flat table (`width` numbers per entry, the first of them ascending) whose first number is <= cp, or -1. */
function entryAt(table, width, cp) {
	let lo = 0
	let hi = table.length / width - 1
	let found = -1
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (table[mid * width] <= cp) {
			found = mid
			lo = mid + 1
		} else hi = mid - 1
	}
	return found
}
/** str.isprintable() false, for a code point from U+0080 up: Python 3.13's Unicode, not the engine's. */
function nonPrintable(cp) {
	const i = entryAt(NONPRINTABLE, 2, cp)
	return i >= 0 && cp <= NONPRINTABLE[i * 2 + 1]
}
const hex = (n, w) => n.toString(16).padStart(w, "0")
function strRepr(s) {
	const quote = s.includes("'") && !s.includes('"') ? '"' : "'"
	let out = quote
	for (const ch of s) {
		const cp = ch.codePointAt(0)
		if (ch === quote || ch === "\\") out += "\\" + ch
		else if (ch === "\t") out += "\\t"
		else if (ch === "\n") out += "\\n"
		else if (ch === "\r") out += "\\r"
		else if (cp < 0x20 || cp === 0x7f) out += "\\x" + hex(cp, 2)
		else if (cp < 0x7f) out += ch
		else if (nonPrintable(cp)) out += cp <= 0xff ? "\\x" + hex(cp, 2) : cp <= 0xffff ? "\\u" + hex(cp, 4) : "\\U" + hex(cp, 8)
		else out += ch
	}
	return out + quote
}
/** repr() of a number a JavaScript client sent: a whole number was an int in its JSON, anything else a float. */
function numberRepr(x) {
	if (!Number.isFinite(x)) return floatRepr(x)
	return /^-?\d+$/.test(JSON.stringify(x)) ? JSON.stringify(x) : floatRepr(x)
}
/** repr(v) of a parsed-JSON value as Python would print it. */
export function pyRepr(v) {
	if (v === null || v === undefined) return "None"
	if (v === true) return "True"
	if (v === false) return "False"
	if (typeof v === "number") return numberRepr(v)
	if (v instanceof PyInt) return String(v.value)
	if (typeof v === "string") return strRepr(v)
	if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`
	if (typeof v === "object") return `{${Object.keys(v).map((k) => `${strRepr(k)}: ${pyRepr(v[k])}`).join(", ")}}`
	return String(v)
}
/** str(v) */
export const pyStr = (v) => (typeof v === "string" ? v : pyRepr(v))

// ---------------------------------------------------------------- float("...")
/** The decimal value of a code point (unicodedata.decimal, Python 3.13's Unicode): every digit set is ten code points from a zero; -1 for a non-digit. */
function decimalValue(cp) {
	const i = entryAt(DECIMAL_ZEROS, 1, cp)
	return i >= 0 && cp - DECIMAL_ZEROS[i] < 10 ? cp - DECIMAL_ZEROS[i] : -1
}
/** float(s) for a string: Python's grammar (underscores between digits, inf/nan, Unicode digits and spaces); NaN-free failure is ValueError. */
export function pyFloat(s) {
	const fail = () => new ValueError(`could not convert string to float: ${strRepr(s)}`)
	let t = ""
	for (const ch of s) {
		// CPython (_PyUnicode_TransformDecimalAndSpaceToASCII): ASCII below DEL is kept; any other whitespace becomes a space; any other
		// Unicode decimal digit becomes its ASCII digit; anything else fails. Then only ASCII whitespace is stripped.
		const cp = ch.codePointAt(0)
		if (cp < 127) t += ch
		else if (/^[\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/.test(ch)) t += " "
		else {
			const d = decimalValue(cp)
			if (d < 0) throw fail()
			t += d
		}
	}
	t = t.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, "")
	const m = /^([+-]?)(?:(inf|infinity)|(nan)|((?:\d(?:_?\d)*)?(?:\.(?:\d(?:_?\d)*)?)?)(?:[eE]([+-]?\d(?:_?\d)*))?)$/i.exec(t)
	if (!m) throw fail()
	const sign = m[1] === "-" ? -1 : 1
	if (m[2]) return sign * Infinity
	if (m[3]) return NaN
	const mant = m[4]
	if (mant === "" || mant === ".") throw fail()
	return sign * Number(`${mant.replace(/_/g, "")}${m[5] !== undefined ? "e" + m[5].replace(/_/g, "") : ""}`)
}
/** float(v) for anything a scene can hold. */
export function toFloat(v) {
	if (typeof v === "number") return v
	if (typeof v === "boolean") return v ? 1 : 0
	if (v instanceof PyInt) return v.value
	if (typeof v === "string") return pyFloat(v)
	throw new TypeError(`float() argument must be a string or a real number, not '${v === null || v === undefined ? "NoneType" : Array.isArray(v) ? "list" : typeof v === "object" ? "dict" : typeof v}'`)
}

// ---------------------------------------------------------------- json.dumps(.., sort_keys=True), Python's way
function jsonString(s) {
	let out = '"'
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		const ch = s[i]
		if (ch === '"') out += '\\"'
		else if (ch === "\\") out += "\\\\"
		else if (ch === "\n") out += "\\n"
		else if (ch === "\r") out += "\\r"
		else if (ch === "\t") out += "\\t"
		else if (ch === "\b") out += "\\b"
		else if (ch === "\f") out += "\\f"
		else if (c < 0x20 || c > 0x7e) out += "\\u" + hex(c, 4)
		else out += ch
	}
	return out + '"'
}
/** json.dumps(v, sort_keys=True): ", " and ": " separators, ensure_ascii, floats as repr (a PyInt prints as an int). */
export function dumps(v) {
	if (v === null || v === undefined) return "null"
	if (v === true) return "true"
	if (v === false) return "false"
	if (typeof v === "number") return Number.isFinite(v) ? floatRepr(v) : Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity"
	if (v instanceof PyInt) return String(v.value)
	if (typeof v === "string") return jsonString(v)
	if (Array.isArray(v)) return `[${v.map(dumps).join(", ")}]`
	return `{${pySorted(Object.keys(v)).map((k) => `${jsonString(k)}: ${dumps(v[k])}`).join(", ")}}`
}

// ---------------------------------------------------------------- hashlib.sha1(text.encode()).hexdigest()
/** SHA-1 of a string's UTF-8 bytes, as hex (synchronous: crypto.subtle is not). */
export function sha1hex(text) {
	const bytes = new TextEncoder().encode(text)
	const n = bytes.length
	const padded = new Uint8Array(((n + 9 + 63) >> 6) << 6)
	padded.set(bytes)
	padded[n] = 0x80
	const dv = new DataView(padded.buffer)
	dv.setUint32(padded.length - 8, Math.floor((n * 8) / 4294967296))
	dv.setUint32(padded.length - 4, (n * 8) >>> 0)
	let h0 = 0x67452301
	let h1 = 0xefcdab89
	let h2 = 0x98badcfe
	let h3 = 0x10325476
	let h4 = 0xc3d2e1f0
	const w = new Uint32Array(80)
	for (let off = 0; off < padded.length; off += 64) {
		for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
		for (let i = 16; i < 80; i++) {
			const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
			w[i] = (x << 1) | (x >>> 31)
		}
		let a = h0
		let b = h1
		let c = h2
		let d = h3
		let e = h4
		for (let i = 0; i < 80; i++) {
			let f
			let k
			if (i < 20) {
				f = (b & c) | (~b & d)
				k = 0x5a827999
			} else if (i < 40) {
				f = b ^ c ^ d
				k = 0x6ed9eba1
			} else if (i < 60) {
				f = (b & c) | (b & d) | (c & d)
				k = 0x8f1bbcdc
			} else {
				f = b ^ c ^ d
				k = 0xca62c1d6
			}
			const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0
			e = d
			d = c
			c = (b << 30) | (b >>> 2)
			b = a
			a = t
		}
		h0 = (h0 + a) >>> 0
		h1 = (h1 + b) >>> 0
		h2 = (h2 + c) >>> 0
		h3 = (h3 + d) >>> 0
		h4 = (h4 + e) >>> 0
	}
	return [h0, h1, h2, h3, h4].map((v) => hex(v >>> 0, 8)).join("")
}
