// Checks web/sim/pymath.js against CPython on the numbers and strings the port depends on (the Python side is tools/parity/py_prims.py).
//   node tools/parity/prims.mjs [--seed N] [--quick]
// Exact functions (round, repr, format, hypot, sum, float(), sha1, repr of strings) must match on every input: a mismatch fails the run.
// Platform math (sin, cos, x ** 3, log10) is JavaScript's own and CPython's is the C library's: those are only counted and shown, except
// sin/cos at multiples of 30 degrees (where ties arise by construction), which must match the builders' (machines/crmath.py sin and cos read
// pymath.js's table, web/sim/trig.js: the same bits on any machine), and the 1M-placement check at the end, which shows whether any printed
// number can still differ.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PG = path.resolve(HERE, "../..")
const SIM = pathToFileURL(path.resolve(process.env.PARITY_SIM || path.join(PG, "web/sim"))).href
const M = await import(`${SIM}/pymath.js`)
const args = process.argv.slice(2)
const QUICK = args.includes("--quick")
const SEED = args.includes("--seed") ? Number(args[args.indexOf("--seed") + 1]) : 777
const K = QUICK ? 0.1 : 1
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "prims-"))

function mulberry32(a) {
	return () => {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}
const rng = mulberry32(SEED)
const U = (a, b) => a + (b - a) * rng()
const ri = (a, b) => a + Math.floor(rng() * (b - a + 1))
const pick = (arr) => arr[Math.floor(rng() * arr.length)]
const chance = (p) => rng() < p
const dv = new DataView(new ArrayBuffer(8))
const bits = (x) => {
	dv.setFloat64(0, x)
	return dv.getBigUint64(0).toString(16).padStart(16, "0")
}
const fromBits = (h) => {
	dv.setBigUint64(0, BigInt(`0x${h}`))
	return dv.getFloat64(0)
}
const randBits = () => {
	for (;;) {
		dv.setUint32(0, Math.floor(rng() * 4294967296))
		dv.setUint32(4, Math.floor(rng() * 4294967296))
		const x = dv.getFloat64(0)
		if (Number.isFinite(x)) return x
	}
}
const sgn = () => (chance(0.5) ? -1 : 1)
const logU = (a, b) => Math.exp(U(Math.log(a), Math.log(b)))
const nextUp = (x, k) => {
	dv.setFloat64(0, x)
	dv.setBigUint64(0, dv.getBigUint64(0) + BigInt(k))
	return dv.getFloat64(0)
}

function py(op, cases) {
	const f = path.join(TMP, `${op}.in.json`)
	const g = path.join(TMP, `${op}.out.json`)
	fs.writeFileSync(f, JSON.stringify({ op, cases }))
	execFileSync("python3", ["-I", path.join(HERE, "py_prims.py"), f, g], { maxBuffer: 1 << 30 })
	return JSON.parse(fs.readFileSync(g, "utf8")).results
}

const rows = []
let failed = 0
function check(name, cases, jsFn, { exact = true, op = name, show = (c) => JSON.stringify(c), eq = (a, b) => a === b } = {}) {
	const t = Date.now()
	const want = py(op, cases)
	let bad = 0
	const samples = []
	cases.forEach((c, i) => {
		let got
		try {
			got = jsFn(c)
		} catch (e) {
			got = "ERR:" + (e.name === "ValueError" ? "ValueError" : e.name)
		}
		if (!eq(got, want[i])) {
			bad++
			if (samples.length < 4) samples.push(`${show(c)}: js ${got}  python ${want[i]}`)
		}
	})
	rows.push({ name, n: cases.length, bad, exact, ms: Date.now() - t })
	if (bad && exact) failed++
	if (bad) for (const s of samples) console.log(`    ${s}`)
}

// ---- round(x, n)
{
	const cases = []
	const specials = [0.015625, 2.5, -0.5, 0.5, 1.5, -1.5, 1e-7, -1e-7, 1e22, 1e21, 123456789012345680000, 5e-324, 1.7976931348623157e308, 0.125, 0.375, 0.0625, 1e15 + 0.5, 4503599627370495.5, 4503599627370497, 0.1, 0.2, 0.3, 2.675, 1.005, 8.345, 0.285, 1 / 3, 2 / 3, 0.000005, 0.0000049999999999999996, 0.00001234565, 1.00000499999999989, 123.456785, 0.0078125, 0.99999999999, 0.999995, 0.9999949999999999]
	for (const x of specials) for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 15, 20, 100, 300, 323, 324, 400, -1, -2, -5, -300, -400]) for (const s of [1, -1]) cases.push([bits(s * x), n])
	for (let i = 0; i < 300000 * K; i++) {
		const n = ri(0, 8)
		const r = rng()
		let x
		if (r < 0.2) x = sgn() * logU(1e-9, 1e9)
		else if (r < 0.3) x = sgn() * U(0, 5)
		else if (r < 0.5) x = sgn() * (2 * ri(0, 100000) + 1) / 2 ** (n + 1) // an exact tie for round(x, n)
		else if (r < 0.6) x = sgn() * (2 * ri(0, 1000000) + 1) / 2 ** ri(1, 20)
		else if (r < 0.7) x = sgn() * (ri(0, 10 ** 7) + 0.5) / 10 ** n // a decimal tie, not exact in binary
		else if (r < 0.8) x = sgn() * ri(0, 10 ** 9) / 10 ** ri(0, 10)
		else if (r < 0.9) x = nextUp(sgn() * ri(0, 10 ** 8) / 10 ** n, ri(-2, 2))
		else x = randBits()
		cases.push([bits(x), n])
	}
	check("round(x, n)", cases, (c) => bits(M.pyRound(fromBits(c[0]), c[1])), { op: "round" })
}
// ---- round(x) -> int
{
	const cases = []
	for (const x of [0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5, -3.5, 0.49999999999999994, 4503599627370495.5, 4503599627370497, 1e15 + 0.5, 1e300, -1e300, 0, -0, 1e22, 123456.5, 123457.5]) cases.push(bits(x))
	for (let i = 0; i < 100000 * K; i++) cases.push(bits(chance(0.5) ? sgn() * (ri(0, 1e6) + 0.5) : chance(0.5) ? sgn() * U(0, 1e6) : randBits()))
	check("roundint", cases, (c) => String(M.pyRoundInt(fromBits(c))).replace(/^-0$/, "0"), { eq: (a, b) => a === b || (b.length > 16 && a === String(Number(b))) })
}
// ---- repr(float)
{
	const cases = []
	for (const x of [0, -0, 1, -1, 0.1, 1e-4, 1e-5, 9.999e-5, 0.0001234, 1e16, 1e15, 9999999999999998, 1.5e16, 123456789012345678, 1e22, 1e21, 1e-7, 5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, 0.30000000000000004, 100, 1e2, 12345.678, 1 / 3, 1e100, 1.234e-10, 123456789.12345679]) cases.push(bits(x))
	for (let i = 0; i < 200000 * K; i++) {
		const r = rng()
		cases.push(bits(r < 0.3 ? randBits() : r < 0.6 ? sgn() * logU(1e-20, 1e20) : r < 0.8 ? sgn() * ri(0, 1e12) / 10 ** ri(0, 12) : sgn() * 10 ** ri(-10, 20) * pick([1, 2, 5, 1.5, 9.99999])))
	}
	check("repr(float)", cases, (c) => M.floatRepr(fromBits(c)), { op: "repr" })
}
// ---- format(x, '.nf') and '.pg'
{
	const cases = []
	for (let i = 0; i < 100000 * K; i++) {
		const n = ri(0, 8)
		const r = rng()
		const x = r < 0.3 ? sgn() * logU(1e-6, 1e9) : r < 0.5 ? sgn() * (2 * ri(0, 100000) + 1) / 2 ** (n + 1) : r < 0.7 ? sgn() * ri(0, 10 ** 8) / 10 ** ri(0, 6) : r < 0.8 ? sgn() * U(0, 100) : r < 0.9 ? sgn() * 10 ** ri(-8, 12) : randBits()
		cases.push([bits(x), n])
	}
	for (const x of [0, -0, 0.05, 0.15, 0.25, 0.35, 2.5, 0.5, 1e22, 1e-7, 0.0049, 0.004999999999999999, 1e21, 123456.789]) for (const n of [0, 1, 2, 5]) cases.push([bits(x), n])
	check("format(x, .nf)", cases, (c) => M.fmtF(fromBits(c[0]), c[1]), { op: "fmtf" })
	const g = []
	for (let i = 0; i < 100000 * K; i++) {
		const p = ri(1, 8)
		const r = rng()
		const x = r < 0.4 ? sgn() * logU(1e-8, 1e12) : r < 0.6 ? sgn() * 10 ** ri(-6, 10) * pick([1, 9.5, 9.99, 9.999, 0.99999, 1.0001, 5, 12.5, 99.95, 0.0001, 0.00001]) : r < 0.8 ? sgn() * ri(1, 10 ** 6) / 10 ** ri(0, 6) : randBits()
		g.push([bits(x), p])
	}
	for (const x of [0, -0, 1, 10, 100, 1000, 999.5, 9.995, 0.0001, 0.00001, 0.000099999, 1e16, 123456789, 20 * 0.1025, 2.05, 475, 20, 1e-5, 0.0001]) for (const p of [1, 2, 3, 4, 6]) g.push([bits(x), p])
	check("format(x, .pg)", g, (c) => M.fmtG(fromBits(c[0]), c[1]), { op: "fmtg" })
}
// ---- hypot (CPython's own algorithm)
{
	const cases = []
	for (let i = 0; i < 500000 * K; i++) {
		const r = rng()
		let a
		let b
		if (r < 0.3) [a, b] = [U(0, 5), U(0, 5)]
		else if (r < 0.5) [a, b] = [U(-1, 1) * 10 ** ri(-12, 3), U(-1, 1) * 10 ** ri(-12, 3)]
		else if (r < 0.6) [a, b] = [U(-1, 1) * 1e-3, U(-1, 1) * 1e-3]
		else if (r < 0.7) [a, b] = [ri(-100, 100) / 8, ri(-100, 100) / 8]
		else if (r < 0.8) [a, b] = [U(-1, 1) * 1e150, U(-1, 1) * 1e150]
		else if (r < 0.85) [a, b] = [U(-1, 1) * 1e-160, U(-1, 1) * 1e-160]
		else if (r < 0.9) [a, b] = [U(-1, 1) * 1e-310, U(-1, 1) * 1e-309]
		else if (r < 0.95) [a, b] = [randBits(), randBits()]
		else [a, b] = [U(0, 1), 0]
		cases.push([bits(a), bits(b)])
	}
	for (const [a, b] of [[3, 4], [5, 12], [0, 0], [1, 0], [0, -2], [Infinity, NaN], [NaN, 1], [1e308, 1e308], [1e-320, 1e-320], [2, 2], [1, 1], [0.1, 0.2], [Infinity, 1], [-Infinity, 0]]) cases.push([bits(a), bits(b)])
	check("hypot(a, b)", cases, (c) => bits(M.hypot(fromBits(c[0]), fromBits(c[1]))), { op: "hypot", eq: (a, b) => a === b || (Number.isNaN(fromBits(a)) && Number.isNaN(fromBits(b))) })
	const c3 = []
	for (let i = 0; i < 50000 * K; i++) c3.push([bits(U(-3, 3)), bits(U(-3, 3)), bits(U(-3, 3))])
	check("hypot(a, b, c)", c3, (c) => bits(M.hypot(fromBits(c[0]), fromBits(c[1]), fromBits(c[2]))), { op: "hypot3" })
}
// ---- sum() of floats (3.12+ compensated)
{
	const cases = []
	for (let i = 0; i < 40000 * K; i++) {
		const n = ri(1, 9)
		cases.push(Array.from({ length: n }, () => bits(chance(0.5) ? U(-1, 1) * 10 ** ri(-3, 2) : ri(-1000, 1000) / 64 + (chance(0.3) ? 1e-17 : 0))))
	}
	// the polygon's area test: nearly cancelling terms
	for (let i = 0; i < 20000 * K; i++) cases.push(Array.from({ length: ri(3, 8) }, () => bits(U(-1, 1) * 0.1 * (chance(0.5) ? 1 : 1 + 1e-16))))
	check("sum(floats)", cases, (c) => bits(M.pySum(c.map(fromBits))), { op: "sum" })
}
// ---- float("...")
{
	const cases = ["1", "1.5", " 2.5 ", "1_000", "1__0", "_1", "1_", "1e3", "1E-3", "+5", "-5", "--5", ".5", "5.", ".", "e5", "1e", "1e+", "inf", "-inf", "+Inf", "infinity", "-INFINITY", "nan", "-nan", "NaN", "infi", "0x10", "0b1", "1,5", "", " ", "abc", "1 2", "١٢٣", "٣.٥", "१२", "１２３", "1 ", " 1", " 1 ", "\t1\n", "\u001c1\u001d", "\u00851", "1​", "﻿1", "1_0.5_5e1_0", "1_e5", "1e_5", "0_0", "00012", "1.0e+0010", "9" .repeat(400), "1e400", "-1e400", "1e-400", "4.9e-324", "2.4703282292062327e-324", "0.1", "0.30000000000000004", "123456789012345678901234567890", "1.7976931348623157e308", "1.7976931348623159e308", "²", "1²", "𝟏𝟐", "٠١٢٣٤٥٦٧٨٩", "1.", ".1e1_0", "+.5", "-.5e-1", "nan1", "in f", "I N F"]
	for (let i = 0; i < 3000 * K; i++) {
		const parts = [pick(["", "+", "-", " ", " ", "  "]), String(ri(0, 99999)), pick(["", ".", "." + ri(0, 999), "_" + ri(1, 9)]), pick(["", "e5", "E-3", "e+10", "e_5", "e1_0"]), pick(["", " ", "\n", "x", "_"])]
		cases.push(parts.join(""))
	}
	check("float(str)", cases, (c) => bits(M.pyFloat(c)), { op: "pyfloat", show: (c) => JSON.stringify(c), eq: (a, b) => a === b || (/^[0-9a-f]{16}$/.test(a) && /^[0-9a-f]{16}$/.test(b) && Number.isNaN(fromBits(a)) && Number.isNaN(fromBits(b))) })
}
// ---- repr() and json.dumps of the values a client sends
{
	const gen = (depth = 0) => {
		const r = rng()
		if (depth > 3 || r < 0.5) {
			const k = rng()
			if (k < 0.15) return null
			if (k < 0.25) return chance(0.5)
			if (k < 0.5) return ri(-1000, 1000)
			if (k < 0.65) return sgn() * logU(1e-8, 1e24)
			if (k < 0.75) return pick([0.1, 1e21, 1e20, 123456789012345680000, 1e-5, 1e16, 1.5, 2.5e-7, -0.0001, 5e-324, 1.7976931348623157e308])
			return genStr()
		}
		if (r < 0.75) return Array.from({ length: ri(0, 4) }, () => gen(depth + 1))
		const o = {}
		for (let i = 0; i < ri(0, 4); i++) o[genStr(true)] = gen(depth + 1)
		return o
	}
	const genStr = (key) => {
		const alphabet = ["a", "b", "z", "'", '"', "\\", "\n", "\t", "\r", " ", "é", "日", "😀", "\u0000", "\u007f", " ", "​", " ", "́", "­", "﻿", "7", "_", "\u0085", "ÿ", "Ā", "　"]
		return Array.from({ length: ri(key ? 1 : 0, 8) }, () => pick(alphabet)).join("")
	}
	const vals = Array.from({ length: 20000 * K }, () => gen())
	check("repr(value)", vals.map((v) => JSON.stringify(v)), (t) => M.pyRepr(JSON.parse(t)), { op: "pyrepr" })
	// dumps: a JS number is a float, so whole ones go to Python as 5.0
	const asFloatText = (v) => (typeof v === "number" ? (Number.isInteger(v) && Math.abs(v) < 1e21 ? v.toFixed(1) : String(v)) : Array.isArray(v) ? `[${v.map(asFloatText).join(",")}]` : v && typeof v === "object" ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${asFloatText(x)}`).join(",")}}` : JSON.stringify(v))
	check("json.dumps(sort_keys)", vals.map(asFloatText), (t) => M.dumps(JSON.parse(t)), { op: "dumps" })
	const strs = Array.from({ length: 5000 * K }, () => genStr())
	check("str.strip()", strs.map((s) => JSON.stringify(s)), (t) => JSON.stringify(M.pyStrip(JSON.parse(t))), { op: "strip" })
	check("len(str)", strs.map((s) => JSON.stringify(s)), (t) => String(M.pyLen(JSON.parse(t))), { op: "strlen" })
	const sha = strs.filter((s) => !/[\ud800-\udfff]/.test(s))
	check("sha1 of text", sha, (s) => M.sha1hex(s), { op: "sha1" })
	check("sha1 of long text", Array.from({ length: 300 }, () => Array.from({ length: ri(0, 400) }, () => pick(["a", "é", "😀", "x", "\n"])).join("")), (s) => M.sha1hex(s), { op: "sha1" })
}
// ---- repr of every code point
{
	const cps = []
	for (let cp = 0; cp < 0x110000; cp++) if (cp < 0xd800 || cp > 0xdfff) cps.push(cp)
	const want = py("strrepr", cps)
	let bad = 0
	const kinds = {}
	cps.forEach((cp, i) => {
		const got = M.pyRepr(String.fromCodePoint(cp))
		if (got !== want[i]) {
			bad++
			const cat = /^'\\[xuU]/.test(want[i]) && !/^'\\[xuU]/.test(got) ? "node prints it, python escapes it (assigned after Python's Unicode version)" : "node escapes it, python prints it"
			kinds[cat] = (kinds[cat] ?? 0) + 1
			if (bad <= 3) console.log(`    U+${cp.toString(16)}: js ${got}  python ${want[i]}`)
		}
	})
	rows.push({ name: "repr(str), every code point", n: cps.length, bad, exact: true, ms: 0, note: bad ? JSON.stringify(kinds) : "" })
	if (bad) failed++
}
// ---- float() of every code point (the decimal digits and spaces of Python's Unicode, not the engine's), and str.lower() of every code point,
// alone and in the contexts Final_Sigma looks at: each template is that text around the code point, for every code point but the surrogates
{
	Error.stackTraceLimit = 0 // (a failing float() throws ValueError a million times)
	const FLOAT_TEMPLATES = [(c) => c, (c) => "1" + c, (c) => c + "1", (c) => "1" + c + "2"]
	const LOWER_TEMPLATES = [(c) => c, (c) => c + "\u03a3", (c) => "a" + c + "\u03a3", (c) => "a\u03a3" + c, (c) => c + "\u03a3a", (c) => "a" + c + "\u03a3" + c + "a"]
	const run = (name, op, templates, jsFn) => {
		const t = Date.now()
		const want = py(op, templates.map((_, i) => i))
		let n = 0
		let bad = 0
		templates.forEach((tmpl, k) => {
			const got = jsFn(tmpl)
			const w = want[k]
			n += w.length
			const len = Math.max(got.length, w.length)
			let shown = 0
			for (let i = 0; i < len; i++) {
				if (got[i] !== w[i]) {
					bad++
					if (shown++ < 3) console.log(`    ${name} template ${k}: entry ${i}: js ${JSON.stringify(got[i])}  python ${JSON.stringify(w[i])}`)
				}
			}
		})
		rows.push({ name, n, bad, exact: true, ms: Date.now() - t })
		if (bad) failed++
	}
	run("float(str), every code point", "float_all", FLOAT_TEMPLATES, (tmpl) => {
		const out = []
		for (let cp = 0; cp < 0x110000; cp++) {
			if (cp >= 0xd800 && cp <= 0xdfff) continue
			try {
				out.push(`${cp}:${bits(M.pyFloat(tmpl(String.fromCodePoint(cp))))}`)
			} catch (e) {
				if (e.name !== "ValueError") throw e
			}
		}
		return out
	})
	run("str.lower(), every code point (and Final_Sigma)", "lower_all", LOWER_TEMPLATES, (tmpl) => {
		const out = []
		for (let cp = 0; cp < 0x110000; cp++) if (cp < 0xd800 || cp > 0xdfff) out.push(M.pyLower(tmpl(String.fromCodePoint(cp))))
		return out
	})
	Error.stackTraceLimit = 10
}
// ---- platform math: counted only
{
	const trig = (name, fn, gen, n) => {
		const cases = Array.from({ length: n * K }, gen).map(bits)
		check(`${name}`, cases, (c) => bits(fn(fromBits(c))), { exact: false, op: name.startsWith("sin") ? "sin" : name.startsWith("cos") ? "cos" : "cube" })
	}
	const deg = () => ri(-100000, 100000) * (Math.PI / 180)
	// every multiple of 30 degrees in +-3600, and the same through D2R at the call sites' exact expression: the builders' sin and cos
	// (machines/crmath.py) must give the table's values exactly; how many of them this machine's libm rounds otherwise is only counted
	{
		const cases = []
		for (let k = -120; k <= 120; k++) cases.push(bits((30 * k) * (Math.PI / 180)))
		check("sin, multiples of 30 deg = crmath.sin", cases, (c) => bits(M.sin(fromBits(c))), { exact: true, op: "crsin" })
		check("cos, multiples of 30 deg = crmath.cos", cases, (c) => bits(M.cos(fromBits(c))), { exact: true, op: "crcos" })
		check("sin, multiples of 30 deg vs this libm", cases, (c) => bits(M.sin(fromBits(c))), { exact: false, op: "sin" })
		check("cos, multiples of 30 deg vs this libm", cases, (c) => bits(M.cos(fromBits(c))), { exact: false, op: "cos" })
	}
	trig("sin, radians -1745..1745", M.sin, () => U(-1745, 1745), 200000)
	trig("cos, radians -1745..1745", M.cos, () => U(-1745, 1745), 200000)
	trig("sin, whole degrees", M.sin, deg, 100000)
	trig("cos, whole degrees", M.cos, deg, 100000)
	trig("sin, quarter degrees", M.sin, () => ri(-4000, 4000) * 0.25 * (Math.PI / 180), 50000)
	trig("cos, quarter degrees", M.cos, () => ri(-4000, 4000) * 0.25 * (Math.PI / 180), 50000)
	trig("sin, tilt-like (1..40 deg, 3 decimals)", M.sin, () => ri(1000, 40000) / 1000 * (Math.PI / 180), 50000)
	trig("cos, tilt-like (1..40 deg, 3 decimals)", M.cos, () => ri(1000, 40000) / 1000 * (Math.PI / 180), 50000)
	trig("cube, 0..0.5", (x) => x ** 3, () => U(0, 0.5), 1000000)
	trig("cube, ball radii 0.0025..0.5 and shells", (x) => x ** 3, () => logU(0.0025, 0.5), 500000)
	const l10 = []
	for (let k = -12; k <= 8; k++) for (let j = -8; j <= 8; j++) l10.push(bits(nextUp(Number(`1e${k}`), j)))
	for (let i = 0; i < 20000 * K; i++) l10.push(bits(logU(1e-9, 1e9)))
	check("floor(log10(x)), near powers of ten and random", l10, (c) => String(M.floorLog10(fromBits(c))), { exact: false, op: "floorlog10" })
}

// ---- powers: pymath.js's cube and engine-math.js's pow are correctly rounded (tools/crpow.ts), and so are machines/crmath.py's cube and
// cr_pow, which the builders use for x ** 3 and x ** (1/3): the same bits on every machine, so these must match exactly
{
	const E = await import(`${SIM}/engine-math.js`)
	const cubes = []
	for (let i = 0; i < 300000 * K; i++) {
		const r = rng()
		cubes.push(bits(r < 0.4 ? ri(1, 500000) / 1e6 : r < 0.6 ? ri(1, 100000) / 1e5 : r < 0.8 ? logU(0.0025, 0.5) : r < 0.9 ? ri(1, 1 << 18) / 2 ** ri(10, 24) : logU(1e-30, 1e30)))
	}
	check("cube = crmath.cube: radii, shells, short mantissas, any size", cubes, (c) => bits(M.cube(fromBits(c))), { op: "crcube" })
	const roots = []
	const dens = [7850, 8000, 1100, 700, 2700, 1000, 11340, 950, 1.2]
	for (let i = 0; i < 60000 * K; i++) {
		const r = rng()
		roots.push(bits(r < 0.5 ? ri(1, 2000000) / 1000 / pick(dens) : r < 0.8 ? (3 * logU(0.001, 50)) / (4 * Math.PI * pick(dens)) : logU(1e-12, 1e12)))
	}
	for (const k of [1, 8, 27, 64, 125, 0.001, 0.008, 2, 3]) roots.push(bits(k))
	check("x ** (1/3) = crmath.cr_pow(x, 1/3): weights' sides, bobs' radii, any size", roots, (c) => bits(E.pow(fromBits(c), 1 / 3)), { op: "crcbrt" })
}

// ---- where a last-bit sin/cos difference could reach a printed number: Ctx.world's x, y = round(origin + offset turned by the angle, 5)
{
	const n = Math.round(1000000 * K)
	const f = path.join(TMP, "world.bin")
	execFileSync("python3", ["-I", path.join(HERE, "py_prims.py"), "worldfuzz", String(n), String(SEED), f], { maxBuffer: 1 << 30 })
	const buf = fs.readFileSync(f)
	const dvw = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
	const D2R = Math.PI / 180
	let atRisk = 0
	let bad = 0
	const samples = []
	for (let i = 0; i < n; i++) {
		const [ox, oy, deg, lx, ly, x, y] = Array.from({ length: 7 }, (_, k) => dvw.getFloat64(i * 64 + k * 8))
		const a = deg * D2R
		const ca = M.cos(a)
		const sa = M.sin(a)
		const jx = M.pyRound(ox + lx * ca - ly * sa, 5)
		const jy = M.pyRound(oy + lx * sa + ly * ca, 5)
		if (!Object.is(jx, x) || !Object.is(jy, y)) {
			bad++
			if (samples.length < 6) samples.push(`origin (${ox}, ${oy}) angle ${deg} deg, offset (${lx}, ${ly}): js (${jx}, ${jy})  python (${x}, ${y})`)
		}
	}
	for (const s of samples) console.log(`    ${s}`)
	rows.push({ name: "world x, y (round 5) at nice values", n, bad, exact: false, note: "(sin/cos last-bit differences reaching a rounded number)" })
}

console.log("\ncheck".padEnd(46) + "cases".padStart(9) + "mismatches".padStart(12) + "  kind")
for (const r of rows) console.log(`${r.name.padEnd(45)}${String(r.n).padStart(9)}${String(r.bad).padStart(12)}  ${r.exact ? "exact" : "platform math"}${r.note ? " " + r.note : ""}`)
fs.rmSync(TMP, { recursive: true, force: true })
console.log(failed ? `\n${failed} exact check(s) FAILED` : "\nevery exact check matches CPython")
process.exit(failed ? 1 : 0)
