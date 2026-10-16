// Checks tools/fdlibm.ts against this node's own Math, bit for bit, on millions of inputs (the engine's ranges and the awkward ones): sin, cos,
// atan2, exp and hypot are ports of what node runs on macOS arm64, so run this there. (pow is correctly rounded, not node's: tools/test-crpow.mjs.)
//   node tools/test-fdlibm.mjs [millions-per-function]
import * as fd from "./fdlibm.ts"

const N = Math.round(Number(process.argv[2] ?? 1) * 1e6)
let s = 0x9e3779b9
const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) // 32-bit LCG
const rnd53 = () => rnd() + rnd() / 4294967296 // finer
const f64 = new Float64Array(1)
const u32 = new Uint32Array(f64.buffer)
const bits = (v) => ((f64[0] = v), u32[1].toString(16).padStart(8, "0") + u32[0].toString(16).padStart(8, "0"))
const scale = (r) => (r < 0.5 ? 1 : r < 0.8 ? 1e-3 : r < 0.95 ? 20 : 1e5) // a mix of magnitudes
const ulpStep = () => (rnd() < 0.5 ? -1 : 1) * Math.floor(rnd() * 8)
const nudge = (v) => { // a few ulps either way
	f64[0] = v
	const lo = u32[0] + ulpStep()
	u32[0] = lo >>> 0
	return f64[0]
}
const nearPi2 = () => nudge(Math.floor((rnd() * 2 - 1) * 3000) * (Math.PI / 2) + (rnd() < 0.5 ? 0 : (rnd() - 0.5) * 1e-6))
const gens = {
	sin: () => [(rnd53() * 2 - 1) * scale(rnd())],
	cos: () => [(rnd53() * 2 - 1) * scale(rnd())],
	"sin (near multiples of pi/2)": () => [nearPi2()],
	"cos (near multiples of pi/2)": () => [nearPi2()],
	"sin (up to the 8e5 limit)": () => [(rnd53() * 2 - 1) * 823549],
	atan2: () => [(rnd53() * 2 - 1) * scale(rnd()), (rnd53() * 2 - 1) * scale(rnd())],
	"atan2 (ratios at the branch points)": () => {
		const x = (rnd53() * 2 - 1) * scale(rnd()) || 1
		const r = [0.4375, 0.6875, 1, 1.1875, 2.4375, 1e18, 1e-18, 7e19, 3e-19][Math.floor(rnd() * 9)]
		return [nudge(Math.abs(x) * r * (rnd() < 0.5 ? 1 : -1)), x]
	},
	exp: () => [(rnd53() * 2 - 1) * (rnd() < 0.8 ? 5 : rnd() < 0.9 ? 50 : 700)],
	"exp (near multiples of ln2)": () => [nudge(Math.floor((rnd() * 2 - 1) * 1000) * Math.LN2 * (rnd() < 0.5 ? 1 : 0.5) + (rnd() < 0.5 ? 0 : (rnd() - 0.5) * 1e-6))],
	hypot: () => [(rnd53() * 2 - 1) * scale(rnd()), (rnd53() * 2 - 1) * scale(rnd())]
}
const special = [0, -0, 1, -1, 0.5, Math.PI, Math.PI / 2, Math.PI / 4, 3 * Math.PI / 4, 1e-300, 5e-324, 1e300, 823549.6, 823550, 2e6, -2e6, Infinity, -Infinity, NaN, 2 ** -27, 2 ** -28, 709.78, 709.79, -745, -746, 1e-9]
let bad = 0
for (const label of Object.keys(gens)) {
	const name = label.split(" ")[0]
	if (!fd[name]) continue
	const native = Math[name]
	let mism = 0
	let first = null
	const check = (args) => {
		const a = native(...args)
		const b = fd[name](...args)
		const again = fd[name](...args) // (sin and cos keep their last answers: the second call is the one answered from there)
		if ((!Object.is(a, b) || !Object.is(a, again)) && !(a !== a && b !== b && again !== again)) {
			mism++
			first ??= `${name}(${args.join(", ")}): node ${a} (${bits(a)}), port ${b} (${bits(b)})`
		}
	}
	if (label === name) for (const x of special) {
		if (name === "atan2" || name === "hypot") for (const y of special) check([x, y])
		else check([x])
	}
	for (let i = 0; i < N; i++) check(gens[label]())
	console.log(`${label.padEnd(38)} ${mism === 0 ? "identical" : mism + " DIFFER"} on ${N} + specials${first ? "; first: " + first : ""}`)
	bad += mism
}
process.exit(bad ? 1 : 0)
