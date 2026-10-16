// Checks tools/crpow.ts (the engine's pow): correctly rounded on about 10 million pairs (tools/crpow-cases.mjs: random sizes, the engine's
// cubes, exact and halfway cases, the overflow and underflow edges, subnormals) against MPFR (tools/crpow_ref.py, gmpy2), ECMAScript's
// special cases against this engine's own Math.pow, the double-double path's error against its allowance, and the SAME bits in every
// JavaScript engine at hand: node (V8), bun (JavaScriptCore), deno (V8) and headless Chromium (V8, through playwright-core).
//   node tools/test-crpow.mjs [--scale 1] [--no-ref] [--no-engines] [--err 1]   (--scale 1 = 10.4 M pairs; --err N = about N M pairs measured)
//   bun tools/test-crpow.mjs --digest-only [--scale 1]       (what the other engines run: one digest of the results per group, as JSON)
// Exit 1 on any difference.
import { cases, digest, SPECIAL } from "./crpow-cases.mjs"
import { _fastParts, pow } from "./crpow.ts"

const argv = typeof process !== "undefined" ? process.argv.slice(2) : Deno.args
const opt = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt)
const SCALE = Number(opt("--scale", 1))

const runAll = () => {
	const groups = cases(SCALE)
	const t0 = performance.now()
	for (const g of groups) {
		const n = g.xy.length / 2
		g.res = new Float64Array(n)
		for (let i = 0; i < n; i++) g.res[i] = pow(g.xy[2 * i], g.xy[2 * i + 1])
	}
	const ms = performance.now() - t0
	return { groups, ms }
}

const engineName = () =>
	typeof Bun !== "undefined" ? `bun ${Bun.version} (JavaScriptCore)` : typeof Deno !== "undefined" ? `deno ${Deno.version.deno} (V8 ${Deno.version.v8})` : `node ${process.version} (V8 ${process.versions.v8})`

if (argv.includes("--digest-only")) {
	const { groups, ms } = runAll()
	console.log(JSON.stringify({ engine: engineName(), ms: Math.round(ms), digests: groups.map((g) => digest(g.res)) }))
} else {
	const { execFileSync, spawnSync } = await import("node:child_process")
	const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = await import("node:fs")
	const { createRequire } = await import("node:module")
	const os = await import("node:os")
	const path = await import("node:path")
	const { fileURLToPath } = await import("node:url")
	const here = path.dirname(fileURLToPath(import.meta.url))
	const root = path.resolve(here, "..")
	const tmp = mkdtempSync(path.join(os.tmpdir(), "crpow-"))
	process.on("exit", () => rmSync(tmp, { recursive: true, force: true }))
	let bad = 0
	const fail = (what) => {
		bad++
		console.log(`  FAIL ${what}`)
	}
	const f64 = new Float64Array(1)
	const u32 = new Uint32Array(f64.buffer)
	const hex = (v) => ((f64[0] = v), u32[1].toString(16).padStart(8, "0") + u32[0].toString(16).padStart(8, "0"))

	const { groups, ms } = runAll()
	const total = groups.reduce((a, g) => a + g.res.length, 0)
	console.log(`${engineName()}: ${total} pairs in ${(ms / 1000).toFixed(1)} s (${((ms * 1e6) / total).toFixed(0)} ns a pair)`)

	// ---- ECMAScript's special cases: this engine's Math.pow is exact there (the specification fixes every one)
	{
		let n = 0
		let diff = 0
		for (const x of SPECIAL)
			for (const y of SPECIAL) {
				const special = y !== y || y === 0 || x !== x || x === 0 || !Number.isFinite(x) || !Number.isFinite(y) || (x < 0 && Math.floor(y) !== y)
				if (!special) continue
				n++
				const a = pow(x, y)
				const b = Math.pow(x, y)
				if (!Object.is(a, b)) {
					diff++
					if (diff <= 5) fail(`special pow(${x}, ${y}) = ${a}, Math.pow gives ${b}`)
				}
			}
		console.log(`${diff ? "FAIL" : "ok  "} special values: ${n} pairs, ${diff} differ from Math.pow`)
	}

	// ---- against MPFR
	if (!argv.includes("--no-ref")) {
		const py = spawnSync("python3", ["-I", "-c", "import gmpy2, numpy"], { stdio: "ignore" })
		if (py.status !== 0) console.log("skip  MPFR reference: python3 with gmpy2 and numpy not found (pip install gmpy2 numpy)")
		else {
			const all = new Float64Array(total * 2)
			let k = 0
			for (const g of groups) {
				all.set(g.xy, k)
				k += g.xy.length
			}
			// the finite pairs of the special grid go along too
			const extra = []
			for (const x of SPECIAL) for (const y of SPECIAL) if (Number.isFinite(x) && Number.isFinite(y) && x !== 0 && y !== 0 && !(x < 0 && Math.floor(y) !== y)) extra.push(x, y)
			const inF = path.join(tmp, "pairs.bin")
			const outF = path.join(tmp, "ref.bin")
			const both = new Float64Array(all.length + extra.length)
			both.set(all)
			both.set(extra, all.length)
			writeFileSync(inF, new Uint8Array(both.buffer))
			const t0 = performance.now()
			execFileSync("python3", ["-I", path.join(here, "crpow_ref.py"), inF, outF], { stdio: "inherit" })
			const buf = readFileSync(outF)
			const ref = new Float64Array(buf.buffer, buf.byteOffset, buf.length / 8)
			console.log(`MPFR reference: ${ref.length} pairs in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
			let at = 0
			for (const g of groups) {
				let diff = 0
				let first = ""
				for (let i = 0; i < g.res.length; i++) {
					const a = g.res[i]
					const b = ref[at + i]
					if (!Object.is(a, b) && !(a !== a && b !== b)) {
						if (!diff) first = `; first: pow(${g.xy[2 * i]}, ${g.xy[2 * i + 1]}) = ${a} (${hex(a)}), MPFR ${b} (${hex(b)})`
						diff++
					}
				}
				g.refDigest = digest(ref.subarray(at, at + g.res.length))
				at += g.res.length
				// how many went the exact (BigInt) way: the double-double path could not decide, or the result is subnormal
				let slow = 0
				for (let i = 0; i < g.res.length; i++) {
					const x = g.xy[2 * i]
					const y = g.xy[2 * i + 1]
					if (x !== 0 && Number.isFinite(x) && y !== 2 && y !== 1 && y !== 0.5 && y !== -1 && Math.abs(y) <= 18446744073709551616 && _fastParts(x, y) !== _fastParts(x, y)) slow++
				}
				console.log(`${diff ? "FAIL" : "ok  "} ${g.name}: ${g.res.length} pairs (${slow} by the exact path), ${diff} not correctly rounded${first}`)
				if (diff) bad++
			}
			let diff = 0
			for (let i = 0; i < extra.length / 2; i++) {
				const a = pow(extra[2 * i], extra[2 * i + 1])
				if (!Object.is(a, ref[at + i])) {
					diff++
					if (diff <= 3) fail(`pow(${extra[2 * i]}, ${extra[2 * i + 1]}) = ${a}, MPFR ${ref[at + i]}`)
				}
			}
			console.log(`${diff ? "FAIL" : "ok  "} the special grid's finite pairs: ${extra.length / 2}, ${diff} not correctly rounded`)
		}
	}

	// ---- the double-double path's error, measured, against the allowance the rounding test uses ((1 + |L|) 2^-92)
	const errM = Number(opt("--err", 0))
	if (errM > 0) {
		const sample = cases(errM / 10.4, 0x1234567)
		const rows = []
		const out = new Float64Array(4)
		for (const g of sample)
			for (let i = 0; i < g.xy.length / 2; i++) {
				const x = g.xy[2 * i]
				const y = g.xy[2 * i + 1]
				if (!(Number.isFinite(x) && x !== 0 && Number.isFinite(y) && y !== 0)) continue
				out.fill(NaN)
				_fastParts(x, y, out)
				if (out[0] === out[0]) rows.push(x, y, out[0], out[1], out[2], out[3])
			}
		const f = path.join(tmp, "parts.bin")
		writeFileSync(f, new Uint8Array(new Float64Array(rows).buffer))
		const r = JSON.parse(execFileSync("python3", ["-I", path.join(here, "crpow_ref.py"), f, "-", "--err"]).toString())
		const ok = r.worstPerL < -92
		console.log(`${ok ? "ok  " : "FAIL"} double-double path: ${r.rows} pairs, worst error 2^${r.worst.toFixed(2)}, worst error / (1 + |L|) 2^${r.worstPerL.toFixed(2)} (allowed 2^-92) at x = ${r.at[0]}, y = ${r.at[1]}`)
		if (!ok) bad++
	}

	// ---- the same bits in the other engines
	if (!argv.includes("--no-engines")) {
		const mine = groups.map((g) => digest(g.res))
		if (groups[0].refDigest) {
			const same = groups.every((g, i) => g.refDigest === mine[i])
			console.log(`${same ? "ok  " : "FAIL"} digests: node's results ${same ? "equal" : "DIFFER from"} MPFR's (${mine.join(" ")})`)
		}
		const compare = (who, answer) => {
			const same = answer.digests.length === mine.length && answer.digests.every((d, i) => d === mine[i])
			console.log(`${same ? "ok  " : "FAIL"} ${answer.engine}: ${same ? "the same bits as node" : "DIFFERENT bits: " + answer.digests.join(" ")} (${(answer.ms / 1000).toFixed(1)} s)`)
			if (!same) bad++
		}
		const me = path.join(here, "test-crpow.mjs")
		for (const [who, cmd, args] of [
			["bun", "bun", [me, "--digest-only", "--scale", String(SCALE)]],
			["deno", "deno", ["run", "--allow-read", me, "--digest-only", "--scale", String(SCALE)]]
		]) {
			const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 24 })
			if (r.error) console.log(`skip  ${who}: not installed`)
			else if (r.status !== 0) fail(`${who}: ${r.stderr.trim().split("\n").slice(-3).join(" / ")}`)
			else compare(who, JSON.parse(r.stdout.trim().split("\n").at(-1)))
		}
		// headless Chromium: the same modules bundled by esbuild into one page script
		const require = createRequire(import.meta.url)
		let playwright
		for (const p of [process.env.PLAYWRIGHT_CORE, path.join(os.homedir(), ".bun/install/cache/playwright-core@1.60.0@@@1"), "playwright-core"]) {
			if (!p) continue
			try {
				playwright = require(p)
				break
			} catch {}
		}
		const esbuildDir = [path.join(root, "node_modules"), path.join(root, "tooling", "node_modules")].find((d) => existsSync(path.join(d, "esbuild", "package.json")))
		if (!playwright || !esbuildDir) console.log("skip  Chromium: playwright-core or esbuild not found")
		else {
			const esbuild = createRequire(path.join(esbuildDir, "x.js"))("esbuild")
			const entry = path.join(tmp, "entry.mjs")
			writeFileSync(
				entry,
				`import { cases, digest } from ${JSON.stringify(path.join(here, "crpow-cases.mjs"))}\nimport { pow } from ${JSON.stringify(path.join(here, "crpow.ts"))}\n` +
					`globalThis.runCrpow = (scale) => { const t0 = performance.now(); const d = cases(scale).map((g) => { const r = new Float64Array(g.xy.length / 2); for (let i = 0; i < r.length; i++) r[i] = pow(g.xy[2 * i], g.xy[2 * i + 1]); return digest(r) }); return { ms: performance.now() - t0, digests: d } }\n`
			)
			const js = (await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "iife", target: "es2022", minify: true })).outputFiles[0].text
			const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright")
			const shells = existsSync(cache)
				? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse().map((d) => path.join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"))
				: []
			const executablePath = [process.env.CHROMIUM_PATH, ...shells].find((p) => p && existsSync(p))
			const browser = await playwright.chromium.launch({ headless: true }).catch((e) => {
				if (!executablePath) throw e
				return playwright.chromium.launch({ headless: true, executablePath })
			})
			try {
				const page = await browser.newPage()
				await page.addScriptTag({ content: js })
				const r = await page.evaluate((s) => globalThis.runCrpow(s), SCALE)
				compare("chromium", { engine: `Chromium ${browser.version()} (V8)`, ms: r.ms, digests: r.digests })
				for (const kind of ["firefox", "webkit"]) {
					const b = await playwright[kind].launch({ headless: true }).catch(() => undefined)
					if (!b) {
						console.log(`skip  ${kind}: no browser installed for playwright`)
						continue
					}
					const p2 = await b.newPage()
					await p2.addScriptTag({ content: js })
					const r2 = await p2.evaluate((s) => globalThis.runCrpow(s), SCALE)
					compare(kind, { engine: `${kind} ${b.version()}`, ms: r2.ms, digests: r2.digests })
					await b.close()
				}
			} finally {
				await browser.close()
			}
		}
	}
	console.log(bad ? `${bad} FAILED` : "all passed")
	process.exit(bad ? 1 : 0)
}
