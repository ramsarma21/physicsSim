// The staging module (machines/mod_staging.py, web/sim/modules/staging.js; render only: a fixed camera and starting gates), end to end:
//   catalog   start_gate is listed (a common prop) on the balls, vehicles and blocks, and only there; the entries are equal in items.py and web/sim
//   document  scenes with settings.camera and start_gate build the same doc.view in both; scenes without them have no doc.view (byte-identical docs)
//   errors    a bad settings.camera is refused with the same words in both
//   engine    doc.view changes no track: the browser bundle runs a document with and without it to the same bytes; the server too (--server <port>)
//   plugins   the AI's registry has the module's digest paragraph, prompt lines and change words; the AI schema takes settings.camera
//   node tools/staging/test.mjs [--server 8972]
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const args = process.argv.slice(2)
const serverPort = args.includes("--server") ? args[args.indexOf("--server") + 1] : null
let failed = 0
const ok = (cond, what, detail = "") => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
	if (!cond) failed++
}
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_staging.py")], { input: JSON.stringify(req), maxBuffer: 1 << 28 }).toString())
ok(sim.MODULES.includes("mod_staging") && !sim.MODULE_ERRORS.mod_staging, "web/sim loads the module", JSON.stringify(sim.MODULE_ERRORS.mod_staging ?? ""))

// ---- catalog
const GATED = ["toy-car", "truck", "motor-car", "cart", "plastic-ball", "superball", "clay-ball", "wooden-block", "bowling-ball"]
const NOT = ["table", "plank", "cup", "fan", "seesaw", "domino", "pendulum", "ramp"]
const keys = [...GATED, ...NOT].filter((k) => sim.catalog().types.some((t) => t.key === k))
const P0 = py({ types: keys })
ok(P0.modules.includes("mod_staging") && !P0.module_errors.mod_staging, "items.py loads the module", JSON.stringify(P0.module_errors.mod_staging ?? ""))
const jsTypes = keys.map((k) => sim.catalog().types.find((t) => t.key === k)).map(({ preview, ...t }) => t)
for (let i = 0; i < keys.length; i++) ok(isDeepStrictEqual(P0.types[i], jsTypes[i]), `catalog entry ${keys[i]}: items.py == web/sim`)
for (const t of jsTypes) {
	const p = t.props.find((q) => q.key === "start_gate")
	const want = GATED.includes(t.key)
	ok(want ? !!p && p.kind === "bool" && p.default === false && p.common === true && t.defaults.start_gate === false : !p, `${t.key} ${want ? "lists" : "does not list"} start_gate`)
}

// ---- documents
const lane = JSON.parse(readFileSync(join(PG, "tools", "staging", "fixtures", "ramps_lane_3b_truck.json"), "utf8"))
const ball = {
	version: 2, id: "gate-ball", name: "Gate ball", seconds: 3, release: 0.6, stage: { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 },
	items: [
		{ id: "table", type: "table", x: 1.3, y: 0 },
		{ id: "ramp", type: "plank", x: 0.3, y: 0.25, angle: -20, props: { length: 1.0 } },
		{ id: "ball", type: "plastic-ball", x: 0.0, y: 0.47, held: true, props: { start_gate: true } },
		{ id: "loose", type: "superball", x: 2.0, y: 0.03, props: { start_gate: true } }
	]
}
const cases = [
	["fairtest lane, gate + camera", { ...lane, release: 0.5, settings: { camera: { x0: -0.6, x1: 2.4, y: 0.25, pitch: 6, hfov: 40 } }, items: lane.items.map((i) => (i.id === "toy" ? { ...i, held: true, props: { ...(i.props ?? {}), start_gate: true } } : i)) }],
	["camera only (defaults filled in)", { ...lane, settings: { camera: { x0: -3, x1: 11 } } }],
	["camera with gravity", { ...lane, settings: { gravity: "moon", camera: { x0: 0, x1: 0.1, y: -10, pitch: -20, hfov: 5 } } }],
	["gates only (a held one and a loose one)", ball],
	["neither", lane]
]
for (const [what, scene] of cases) {
	const clean = sim.clean(scene)
	const js = sim.layout(clean)
	const P = py({ scene: clean })
	ok(!P.error && isDeepStrictEqual(P.doc, js.doc), `document: items.py == web/sim: ${what}`, P.error ?? "")
	ok(isDeepStrictEqual(P.resolved, js.resolved) && isDeepStrictEqual(P.warnings, js.warnings), `resolved props and warnings equal: ${what}`)
}
const view = (scene) => sim.layout(sim.clean(scene)).doc.view
ok(view(cases[0][1])?.camera?.hfov === 40 && isDeepStrictEqual(view(cases[0][1]).gates, ["toy"]), "doc.view: the camera and the gated item", JSON.stringify(view(cases[0][1])))
ok(isDeepStrictEqual(view(cases[1][1]), { camera: { x0: -3, x1: 11, y: 0.3, pitch: 6.843, hfov: 69.39 } }), "doc.view.camera: the Wide shot's lens and tilt by default", JSON.stringify(view(cases[1][1])))
ok(isDeepStrictEqual(view(ball), { gates: ["ball", "loose"] }), "doc.view.gates: every item that sets start_gate (the view draws a gate only for held ones)")
ok(view(lane) === undefined && !("view" in sim.layout(sim.clean(lane)).doc), "a scene without them has no doc.view")
const noView = sim.layout(sim.clean({ ...cases[0][1], settings: undefined, items: lane.items })).doc
const withView = sim.layout(sim.clean(cases[0][1])).doc
const strip = ({ view: _v, ...d }) => d
ok(isDeepStrictEqual(strip(sim.layout(sim.clean({ ...lane, settings: { camera: { x0: 0, x1: 2 } } })).doc), sim.layout(sim.clean(lane)).doc), "the camera adds doc.view and nothing else")

// ---- errors alike
for (const bad of [{ x0: 1 }, { x0: 0, x1: 0.05 }, { x0: 0, x1: 1, y: "a" }, { x0: 0, x1: 1, zoom: 2 }, "wide", { x0: 0, x1: 1, hfov: 200 }, { x0: true, x1: 1 }, { x0: 0, x1: 400 }, [], { x0: 0, x1: 1, pitch: -30 }]) {
	const sc = sim.clean({ ...lane, settings: { camera: bad } })
	let a = null
	try {
		sim.layout(sc)
	} catch (e) {
		a = e.message
	}
	const b = py({ scene: sc }).error
	ok(a !== null && a === `can't build this scene: ${b}`, `bad camera refused alike: ${JSON.stringify(bad)}`, a)
}

// ---- engine: doc.view is not physics
const E = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const runA = E.handle({ id: 1, doc: withView, rate: 120 })
const runB = E.handle({ id: 2, doc: { ...withView, view: undefined }, rate: 120 })
delete runB.ms
ok(runA.error === undefined && JSON.stringify(runA.track) === JSON.stringify(runB.track), "browser bundle: the same track with and without doc.view", runA.error ?? `${JSON.stringify(runA.track).length} bytes`)
const gatedHeld = sim.layout(sim.clean(cases[0][1])).doc
const heldOnly = sim.layout(sim.clean({ ...cases[0][1], settings: undefined, items: cases[0][1].items.map((i) => (i.id === "toy" ? { ...i, props: Object.fromEntries(Object.entries(i.props).filter(([k]) => k !== "start_gate")) } : i)) })).doc
const runC = E.handle({ id: 3, doc: heldOnly, rate: 120 })
ok(JSON.stringify(runA.track) === JSON.stringify(runC.track), "a starting gate and a camera change no track (the same held scene without them)")
void noView
void gatedHeld
if (serverPort) {
	const post = async (scene) => (await fetch(`http://127.0.0.1:${serverPort}/api/simulate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scene }) })).json()
	const a = await post(cases[0][1])
	const b = await post({ ...cases[0][1], settings: undefined, items: heldOnly ? cases[0][1].items.map((i) => (i.id === "toy" ? { ...i, props: Object.fromEntries(Object.entries(i.props).filter(([k]) => k !== "start_gate")) } : i)) : [] })
	ok(!a.error && JSON.stringify(a.track) === JSON.stringify(b.track), `server :${serverPort}: the same track with and without them`, a.error ?? "")
	ok(isDeepStrictEqual(a.doc.view, withView.view), "server: doc.view as web/sim builds it")
	ok(JSON.stringify(a.track) === JSON.stringify(runA.track), "server track == browser bundle track")
}

// ---- plugins and the AI
const S = globalThis[Symbol.for("sandbox.plugins")]
const mod = S.modules.get("mod_staging")
ok(!!mod && /settings\.camera/.test(mod.howto) && /start_gate/.test(mod.howto) && /start_gate/.test(mod.prompt.plan), "the AI's registry: digest paragraph and prompt lines")
ok(sim.plugins.changeWords("plastic-ball", "start_gate", false, true) === "starting gate on (it lifts at the release)", "change words")
const digest = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
const dg = digest.digestFromCatalog(sim.catalog())
ok(dg.text.includes("settings.camera") && dg.text.includes("start_gate"), "the AI's catalog digest names settings.camera and start_gate", `${dg.stats.tokens} tokens`)
const schemas = await import(pathToFileURL(join(PG, "ai/schemas.mjs")).href)
const cam = schemas.planSchema?.properties?.settings?.properties?.camera
ok(cam?.type === "object" && isDeepStrictEqual(cam.required, ["x0", "x1"]), "ai/schemas.mjs: a plan's settings take camera {x0, x1, y, pitch, hfov}")
console.log(failed ? `${failed} FAILED` : "all passed")
process.exit(failed ? 1 : 0)
