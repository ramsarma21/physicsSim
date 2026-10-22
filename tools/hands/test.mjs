// The hands module (machines/mod_hands.py, web/sim/modules/hands.js; render only: web/hands.js draws the hands), end to end:
//   catalog   `hand` / `hand_from` listed (common props) on every dynamic type but the pusher; the pusher's `hand` (Pushed by) and the pitcher's;
//             nowhere else; every catalog entry equal in items.py and web/sim
//   document  a scene that sets them builds the very document it builds without them (Python and JS), its resolved props differing only by them;
//             the 12 scenarios and the 10 gallery scenes build the same documents, resolved props and warnings with the module and without it
//   errors    a choice that is not one is refused with the same words in both
//   engine    the same track with and without them (the browser bundle; the server too with --server <port>)
//   mesh      with --server: web/server.py serves web/models/hand.glb as model/gltf-binary, byte for byte
//   plugins   the AI's registry: the module's paragraph, prompt lines and change words; the catalog digest names props.hand
//   node tools/hands/test.mjs [--server 9801]
import { execFileSync } from "../child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const args = process.argv.slice(2)
const serverPort = args.includes("--server") ? args[args.indexOf("--server") + 1] : null
let failed = 0
let passed = 0
const ok = (cond, what, detail = "") => {
	if (cond) passed++
	else failed++
	if (!cond || process.env.HANDS_VERBOSE) console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
}
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const py = (req, env = {}) =>
	JSON.parse(execFileSync("python3", [join(HERE, "py_hands.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30, env: { ...process.env, ...env } }).toString())
ok(sim.MODULES.includes("mod_hands") && !sim.MODULE_ERRORS.mod_hands, "web/sim loads the module", JSON.stringify(sim.MODULE_ERRORS.mod_hands ?? ""))

// ---- catalog: every entry Python == JS; the props where they belong
const P0 = py({ all_types: true })
ok(P0.modules.includes("mod_hands") && !P0.module_errors.mod_hands, "items.py loads the module", JSON.stringify(P0.module_errors.mod_hands ?? ""))
const js = new Map(sim.catalog().types.map(({ preview, ...t }) => [t.key, t]))
let same = 0
const differ = []
P0.types.forEach((t, i) => (isDeepStrictEqual(t, js.get(P0.keys[i])) ? same++ : differ.push(P0.keys[i])))
ok(differ.length === 0 && same === js.size, `catalog: all ${js.size} entries items.py == web/sim`, differ.slice(0, 5).join(", "))
let held = 0
for (const t of js.values()) {
	const hand = t.props.find((p) => p.key === "hand")
	const from = t.props.find((p) => p.key === "hand_from")
	if (t.key === "pusher") ok(hand?.label === "Pushed by" && isDeepStrictEqual(hand.choices, ["none", "finger", "hand", "two hands", "fist"]) && hand.common && t.defaults.hand === "none" && !from, "pusher: hand = Pushed by (none, finger, hand, two hands, fist), no hand_from")
	else if (t.key === "pitcher") ok(isDeepStrictEqual(hand?.choices, ["none", "hand"]) && hand.common && t.defaults.hand === "none" && !from, "pitcher: hand (none, hand)")
	else if (t.dynamic) {
		held++
		if (!(isDeepStrictEqual(hand?.choices, ["none", "auto", "pinch", "palm", "press", "grip"]) && hand.default === "none" && hand.common && isDeepStrictEqual(from?.choices, ["auto", "left", "right", "above"]) && t.defaults.hand === "none" && t.defaults.hand_from === "auto"))
			ok(false, `${t.key}: hand and hand_from listed`)
	} else if (hand || from) ok(false, `${t.key} (not dynamic) lists no hand`)
}
ok(held > 100, `hand and hand_from on every dynamic type but the pusher (${held})`)

// ---- documents: the props build nothing
const proto = (f) => JSON.parse(readFileSync(join(PG, "tools", "hands", "scenes", f), "utf8"))
const scenes = readdirSync(join(PG, "tools", "hands", "scenes")).filter((f) => f.endsWith(".json")).sort()
const strip = (scene) => ({
	...scene,
	items: scene.items.map((i) => {
		if (!i.props) return i
		const { hand: _h, hand_from: _f, ...props } = i.props
		return { ...i, props }
	})
})
const handKeys = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([p]) => p !== "hand" && p !== "hand_from"))]))
const withP = py({ scenes: scenes.map(proto) })
const withoutP = py({ scenes: scenes.map((f) => strip(proto(f))) })
scenes.forEach((f, i) => {
	const scene = proto(f)
	const a = sim.layout(sim.clean(scene))
	const b = sim.layout(sim.clean(strip(scene)))
	ok(isDeepStrictEqual(a.doc, b.doc), `${f}: the same document with and without the hand props (web/sim)`)
	ok(isDeepStrictEqual(handKeys(a.resolved), b.resolved) && isDeepStrictEqual(a.warnings, b.warnings), `${f}: resolved props differ only by hand / hand_from`)
	const P = withP.results[i]
	const Q = withoutP.results[i]
	ok(!P.error && isDeepStrictEqual(P.doc, a.doc) && isDeepStrictEqual(P.resolved, a.resolved) && isDeepStrictEqual(P.warnings, a.warnings), `${f}: items.py == web/sim (document, resolved, warnings)`, P.error ?? "")
	ok(!Q.error && isDeepStrictEqual(P.doc, Q.doc), `${f}: items.py builds the same document without them`)
	const set = scene.items.filter((it) => it.props?.hand !== undefined)
	ok(set.every((it) => a.resolved[it.id]?.hand === it.props.hand), `${f}: the hand props are in the resolved props the view reads`)
})

// ---- the 12 scenarios and 10 gallery scenes: the same with the module and without it (PLAYGROUND_MODULES: every module but this one)
const builtins = [
	...readdirSync(join(PG, "web", "scenarios")).filter((f) => f.endsWith(".json")).map((f) => join(PG, "web", "scenarios", f)),
	...readdirSync(join(PG, "web", "gallery")).filter((f) => f.endsWith(".json") && f !== "index.json").map((f) => join(PG, "web", "gallery", f))
]
const others = sim.MODULES.filter((m) => m !== "mod_hands").map((m) => m.slice(4)).join(",")
const dump = `
const sim = await import(${JSON.stringify(pathToFileURL(join(PG, "web/sim/index.js")).href)})
const { readFileSync } = await import("node:fs")
const out = []
for (const f of ${JSON.stringify(builtins)}) {
	const r = sim.layout(sim.clean(JSON.parse(readFileSync(f, "utf8"))))
	out.push({ f, doc: r.doc, resolved: r.resolved, warnings: r.warnings })
}
process.stdout.write(JSON.stringify({ modules: sim.MODULES, out }))`
const run = (env) => JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", dump], { env: { ...process.env, ...env }, maxBuffer: 1 << 30 }).toString())
const A = run({})
const B = run({ PLAYGROUND_MODULES: others })
ok(A.modules.includes("mod_hands") && !B.modules.includes("mod_hands") && B.modules.length === A.modules.length - 1, "the identity runs: with every module, and with all but hands")
ok(builtins.length === 22, `${builtins.length} built-in scenes (12 scenarios, 10 gallery)`)
for (let i = 0; i < builtins.length; i++) {
	const f = builtins[i].split("/").slice(-2).join("/")
	ok(isDeepStrictEqual(A.out[i].doc, B.out[i].doc) && isDeepStrictEqual(A.out[i].resolved, B.out[i].resolved) && isDeepStrictEqual(A.out[i].warnings, B.out[i].warnings), `${f}: the same document, resolved props and warnings with the module and without`)
}
const pyA = py({ scenes: builtins.map((f) => JSON.parse(readFileSync(f, "utf8"))) })
const pyB = py({ scenes: builtins.map((f) => JSON.parse(readFileSync(f, "utf8"))) }, { PLAYGROUND_MODULES: others })
ok(isDeepStrictEqual(pyA.results, pyB.results) && pyA.results.every((r) => !r.error), "items.py: the 22 built-in scenes the same with the module and without")

// ---- errors alike: a choice that is not one
for (const [type, bad] of [
	["plastic-ball", { hand: "claw" }],
	["plastic-ball", { hand_from: "below" }],
	["pusher", { hand: "pinch" }],
	["pitcher", { hand: "grip" }],
	["plastic-ball", { hand: 3 }]
]) {
	const scene = { version: 2, id: "bad", name: "bad", items: [{ id: "x", type, x: 0.2, y: 0.3, held: true, props: bad }] }
	let a = null
	try {
		sim.clean(scene)
	} catch (e) {
		a = e.message
	}
	const b = py({ scenes: [scene] }).results[0].error ?? null
	ok(a !== null && a === b, `bad ${JSON.stringify(bad)} on a ${type}: refused alike`, `${a} | ${b}`)
}

// ---- engine: the props are not physics
const E = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
let n = 0
for (const f of scenes) {
	const scene = proto(f)
	const a = sim.layout(sim.clean(scene)).doc
	const b = sim.layout(sim.clean(strip(scene))).doc
	const ra = E.handle({ id: ++n, doc: a, rate: 120 })
	const rb = E.handle({ id: ++n, doc: b, rate: 120 })
	ok(ra.error === undefined && JSON.stringify(ra.track) === JSON.stringify(rb.track), `${f}: browser bundle, the same track with and without them`, ra.error ?? `${JSON.stringify(ra.track).length} bytes`)
	if (serverPort) {
		const post = async (sc) => (await fetch(`http://127.0.0.1:${serverPort}/api/simulate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scene: sc }) })).json()
		const sa = await post(scene)
		const sb = await post(strip(scene))
		ok(!sa.error && JSON.stringify(sa.track) === JSON.stringify(sb.track) && JSON.stringify(sa.track) === JSON.stringify(ra.track), `${f}: server :${serverPort}: the same track with and without them, and the bundle's`, sa.error ?? "")
		ok(isDeepStrictEqual(sa.resolved, sim.layout(sim.clean(scene)).resolved), `${f}: server: the resolved props web/sim builds`)
	}
}

// ---- the mesh web/hands.js draws, as the server serves it
if (serverPort) {
	const r = await fetch(`http://127.0.0.1:${serverPort}/models/hand.glb`)
	const got = Buffer.from(await r.arrayBuffer())
	ok(r.status === 200 && r.headers.get("content-type") === "model/gltf-binary" && got.equals(readFileSync(join(PG, "web/models/hand.glb"))),
		`server :${serverPort}: web/models/hand.glb served as model/gltf-binary, byte for byte`, `${r.status} ${r.headers.get("content-type")}, ${got.length} bytes`)
}

// ---- plugins and the AI
const S = globalThis[Symbol.for("sandbox.plugins")]
const mod = S.modules.get("mod_hands")
ok(!!mod && /props\.hand/.test(mod.howto) && /pinch/.test(mod.howto) && /props\.hand/.test(mod.prompt.plan) && /props\.hand/.test(mod.prompt.edit), "the AI's registry: the module's paragraph and prompt lines")
ok(sim.plugins.changeWords("plastic-ball", "hand", "none", "press") === "a fingertip holds it down", "change words: a held thing")
ok(sim.plugins.changeWords("pusher", "hand", "none", "two hands") === "two hands push it", "change words: a pusher")
ok(sim.plugins.changeWords("pitcher", "hand", "none", "hand") === "a hand holds and tips it", "change words: a pitcher")
const digest = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
const dg = digest.digestFromCatalog(sim.catalog())
ok(dg.text.includes("props.hand") && dg.text.includes("hand_from"), "the AI's catalog digest names props.hand and hand_from", `${dg.stats.tokens} tokens`)
const picked = (text) => digest.promptCatalog(dg, { text }).modules
ok(["The hand lets go of the cork", "A finger pushes the red ball", "a magnet held in a fist"].every((t) => picked(t).includes("mod_hands")) && !picked("a ball rolls down a ramp into a cup").includes("mod_hands"), "a request that names a hand, a finger or a fist carries the module's section; a plain one does not")
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
