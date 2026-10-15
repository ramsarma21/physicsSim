// Vendors Clerk's browser SDK (sign in with Google; docs/ACCOUNTS.md 1.3) into web/vendor/clerk/, so the page loads no code from another origin.
//   node tools/vendor-clerk.mjs            (npm run vendor:clerk)        rebuilds web/vendor/clerk/
//   node tools/vendor-clerk.mjs --check    (npm run vendor:clerk:check)  writes nothing; exits 1 if web/vendor/clerk is missing, holds an extra
//                                                                         file, or differs from what the pinned tarball makes now
// The source is ONE pinned tarball, @clerk/clerk-js 6.39.0 from the npm registry, checked against its sha512 integrity below (npm pack, from
// npm's cache when it is there; no install, no lifecycle scripts, none of the package's 50 dependencies: its "no remotely hosted code" build,
// dist/clerk.no-rhc.mjs, is already one bundle). Not a package.json dependency on purpose: that would put ~160 MB of wallet SDKs into every
// `npm ci`. What is written:
//   web/vendor/clerk/clerk.mjs   that build, re-bundled by the pinned esbuild into one ES module with no bare imports left: the four optional
//                                modules it loads only for Web3 wallets and password-strength hints (@base-org/account, @coinbase/wallet-sdk,
//                                @zxcvbn-ts/core, @zxcvbn-ts/language-common), which this app never uses (Google is the only sign-in), are
//                                replaced by a module that says so. The no-RHC build loads nothing from Clerk at run time (no UI bundle, no
//                                Cloudflare Turnstile, no Stripe): this script fails if any of those URLs appear.
//   web/vendor/clerk/LICENSE     Clerk's MIT licence, unmodified.
// web/index.html's importmap maps the bare name: "clerk-js": "./vendor/clerk/clerk.mjs" (only web/account/clerk.js imports it, and only on a
// deployment with accounts configured). To move to another version: change PIN (version and integrity: `npm view @clerk/clerk-js@<v>
// dist.integrity`), run this, and test a sign-in.
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"
import path from "node:path"

export const PIN = {
	name: "@clerk/clerk-js",
	version: "6.39.0",
	integrity: "sha512-1vGRCP+220kawQn827xgrcdUubSrCVmSlQT64WBHQoM60FaXkAzNaK7aPNEIMTRfg5Ync4SNBwCBr9YbwIUZLg==",
	entry: "dist/clerk.no-rhc.mjs",
}
const OPTIONAL = ["@base-org/account", "@coinbase/wallet-sdk", "@zxcvbn-ts/core", "@zxcvbn-ts/language-common"]
const REMOTE = [/challenges\.cloudflare\.com/, /js\.stripe\.com/, /\/npm\/@clerk\/ui@/, /ui\.browser\.js/, /clerk\.browser\.js/]

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const out = path.join(root, "web", "vendor", "clerk")
const fail = (m) => {
	console.error(`vendor-clerk: ${m}`)
	process.exit(1)
}

const args = process.argv.slice(2)
const check = args.includes("--check")
const unknown = args.find((a) => a !== "--check")
if (unknown) fail(`unknown argument ${unknown} (the only one is --check)`)
if (!existsSync(path.join(root, "node_modules", "esbuild", "package.json"))) fail("esbuild is not installed (run `npm ci` in the project root).")
const esbuild = createRequire(path.join(root, "node_modules", "x.js"))("esbuild")

const tmp = mkdtempSync(path.join(tmpdir(), "vendor-clerk-"))
try {
	// 1. the pinned tarball, checked
	const npm = process.platform === "win32" ? "npm.cmd" : "npm"
	const pack = spawnSync(npm, ["pack", `${PIN.name}@${PIN.version}`, "--pack-destination", tmp, "--prefer-offline", "--ignore-scripts", "--silent", "--json"], { cwd: tmp, encoding: "utf8", env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" } })
	if (pack.status !== 0) fail(`npm pack ${PIN.name}@${PIN.version} failed (offline, and not in npm's cache?): ${(pack.stderr || pack.stdout || "").trim().split("\n").slice(-2).join(" / ")}`)
	const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"))
	if (!tgz) fail("npm pack made no tarball")
	const bytes = readFileSync(path.join(tmp, tgz))
	const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
	if (integrity !== PIN.integrity) fail(`the tarball of ${PIN.name}@${PIN.version} is not the pinned one (sha512 ${integrity.slice(0, 24)}… is not ${PIN.integrity.slice(0, 24)}…): nothing was written`)
	const x = spawnSync("tar", ["-xzf", path.join(tmp, tgz), "-C", tmp, "package/package.json", "package/LICENSE", `package/${PIN.entry}`], { encoding: "utf8" })
	if (x.status !== 0) fail(`could not unpack the tarball: ${(x.stderr || "").trim()}`)
	const pkg = JSON.parse(readFileSync(path.join(tmp, "package", "package.json"), "utf8"))
	if (pkg.name !== PIN.name || pkg.version !== PIN.version) fail(`the tarball holds ${pkg.name}@${pkg.version}`)

	// 2. one module, no bare imports
	const r = await esbuild.build({
		entryPoints: [path.join(tmp, "package", PIN.entry)],
		bundle: true,
		write: false,
		format: "esm",
		platform: "browser",
		target: "es2020",
		minify: true,
		legalComments: "none",
		logLevel: "silent",
		define: { "process.env.NODE_ENV": '"production"' },
		banner: { js: `/*! ${PIN.name} ${PIN.version} (${PIN.entry}), MIT licence (LICENSE beside this file). Vendored by tools/vendor-clerk.mjs; the optional wallet and password-strength modules are left out. */` },
		plugins: [{
			name: "optional",
			setup(b) {
				const re = new RegExp(`^(${OPTIONAL.map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})$`)
				b.onResolve({ filter: re }, (a) => ({ path: a.path, namespace: "optional" }))
				b.onLoad({ filter: /.*/, namespace: "optional" }, (a) => ({ contents: `throw new Error(${JSON.stringify(`${a.path} is not in this build (Google is the only sign-in)`)})`, loader: "js" }))
				b.onResolve({ filter: /^[^./]/ }, (a) => (a.kind === "entry-point" ? undefined : { errors: [{ text: `unexpected bare import "${a.path}" in ${PIN.entry}: add it to OPTIONAL or vendor it` }] }))
			},
		}],
	})
	const code = r.outputFiles[0].text
	for (const re of REMOTE) if (re.test(code)) fail(`the bundle names ${re} (remotely hosted code): this build must load nothing from Clerk or others at run time`)
	if (/(?<![.\w$])import\s*\(\s*["'`](?![./])/.test(code) || /(?<![.\w$])(?:from|import)\s*["'`](?![./])/.test(code)) fail("the bundle still has a bare import")
	if (!/export\s*\{[^}]*\bas Clerk\b/.test(code) && !/export\s*\{[^}]*\bClerk\b/.test(code)) fail("the bundle does not export Clerk")
	const files = new Map([["clerk.mjs", Buffer.from(code)], ["LICENSE", readFileSync(path.join(tmp, "package", "LICENSE"))]])

	// 3. write, or compare
	if (check) {
		const problems = []
		const have = existsSync(out) ? readdirSync(out) : null
		if (!have) problems.push("web/vendor/clerk/ is missing")
		else {
			for (const f of have) if (!files.has(f)) problems.push(`web/vendor/clerk/${f} is not made by this script`)
			for (const [f, b] of files) if (!have.includes(f)) problems.push(`web/vendor/clerk/${f} is missing`)
				else if (!readFileSync(path.join(out, f)).equals(b)) problems.push(`web/vendor/clerk/${f} differs from what ${PIN.name}@${PIN.version} makes now`)
		}
		if (problems.length) fail(`${problems.join("; ")} (run npm run vendor:clerk)`)
		console.log(`vendor-clerk: web/vendor/clerk/ is up to date (${PIN.name}@${PIN.version}, ${(files.get("clerk.mjs").length / 1024).toFixed(0)} KiB)`)
	} else {
		rmSync(out, { recursive: true, force: true })
		mkdirSync(out, { recursive: true })
		for (const [f, b] of files) writeFileSync(path.join(out, f), b)
		const js = files.get("clerk.mjs")
		console.log(`vendor-clerk: wrote web/vendor/clerk/ from ${PIN.name}@${PIN.version} (integrity checked): clerk.mjs ${(js.length / 1024).toFixed(0)} KiB (${(gzipSync(js).length / 1024).toFixed(0)} KiB gzipped), LICENSE`)
	}
} finally {
	rmSync(tmp, { recursive: true, force: true })
}
