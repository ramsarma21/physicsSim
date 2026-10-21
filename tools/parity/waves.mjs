// The waves module's parity and engine checks (machines/mod_waves.py, web/sim/modules/waves.js, tooling/src/sim/modules/waves.ts):
//   catalog   the module's catalog entries: items.py == web/sim (props, readouts, module)
//   build     random scenes of every waves type (random props across their ranges and choices, walls, rods, balls dropped on sources, a
//             pendulum, a vacuum, a warm room): document, resolved props and warnings, items.py == web/sim
//   engine    the server's engine (node, the bundle's math: research/poc/worker.ts's run) == the browser bundle (web/sim/engine-worker.js),
//             the track byte for byte, readings included; and the same scene run twice gives the same bytes
//   summary   items.py summarize == web/sim finish (every waves goal kind, random fields)
//   sane      no NaN or Infinity in any reading; every engine run under its time budget
//   node tools/parity/waves.mjs [--n 60] [--seed 7] [--browser]   (--browser: the bundle in headless Chromium too, on every 4th scene)
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const N = Number(arg("--n", 60))
let seed = Number(arg("--seed", 7)) >>> 0
const BROWSER = process.argv.includes("--browser")
const OUT = process.env.WAVES_OUT || join(os.tmpdir(), "waves-parity")
mkdirSync(OUT, { recursive: true })
let failed = 0
let cases = 0
const ok = (cond, what, detail = "") => {
	cases++
	if (!cond) {
		failed++
		console.log(`FAIL  ${what}${detail ? `  (${detail})` : ""}`)
	}
	return cond
}
// a small deterministic generator (mulberry32)
const rnd = () => {
	seed = (seed + 0x6d2b79f5) >>> 0
	let t = seed
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (list) => list[Math.floor(rnd() * list.length)]

const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const items = await import(pathToFileURL(join(PG, "web/sim/items.js")).href)
const wavesJs = await import(pathToFileURL(join(PG, "web/sim/modules/waves.js")).href)
await import(pathToFileURL(join(PG, "tools/engine-math-node.mjs")).href)
const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)
const { slimExtras } = await import(pathToFileURL(join(PG, "tooling/src/sim/plugins.ts")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)

const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_waves.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30 }).toString())
const round = (v, d) => Number(v.toFixed(d))
/** research/poc/worker.ts's run (the server's engine), as plugin-toy/test.mjs copies it. */
const serverRun = (doc) => {
	const { scene: s } = admitDocument(doc)
	const track = simulate(s, 120)
	const frames = track.frames
	const first = frames[0]?.placements ?? {}
	const still = new Set()
	for (const part of s.solids) {
		const a = first[part.id]
		if (part.kind !== "static" || a === undefined) continue
		let same = true
		for (let k = 1; k < frames.length && same; k++) {
			const b = frames[k]?.placements[part.id]
			same = b !== undefined && b.x === a.x && b.y === a.y && b.angle === a.angle && b.squash === a.squash && b.scale === a.scale
		}
		if (same) still.add(part.id)
	}
	const slim = frames.map((f, k) => {
		const placements = {}
		for (const id in f.placements) {
			if (k > 0 && still.has(id)) continue
			const p = f.placements[id]
			const q = { x: round(p.x, 5), y: round(p.y, 5), angle: round(p.angle, 5) }
			if (p.squash !== undefined) q.squash = round(p.squash, 5)
			if (p.scale !== undefined) q.scale = round(p.scale, 5)
			placements[id] = q
		}
		return { t: round(f.t, 6), placements }
	})
	return JSON.stringify({ fps: track.fps, frames: slim, impacts: track.impacts, ...slimExtras(track, round) })
}

// ---- the catalog
const types = sim.catalog().types.filter((t) => t.module === "waves")
const P0 = py({ scenes: [], types: true })
ok(Object.keys(P0.module_errors ?? {}).length === 0, "machines/items.py loaded every module", JSON.stringify(P0.module_errors))
const jsTypes = P0.types.map((t) => types.find((u) => u.key === t.key)).map((t) => (t ? (({ preview, ...rest }) => rest)(t) : null))
ok(types.length === 19 && P0.types.length === 19, "19 waves types on both sides", `${types.length} / ${P0.types.length}`)
for (let i = 0; i < P0.types.length; i++) ok(isDeepStrictEqual(P0.types[i], jsTypes[i]), `catalog entry ${P0.types[i].key}: items.py == web/sim`)
for (const t of types) ok(!t.preview?.error, `${t.key} builds its catalog picture`, t.preview?.error)

// ---- random scenes
const randomProp = (p) => {
	if (p.kind === "bool") return rnd() < 0.5
	if (p.kind === "choice") return pick(p.choices)
	if (p.kind === "int") return Math.round(p.min + rnd() * (p.max - p.min))
	const raw = p.min + rnd() * (p.max - p.min)
	const v = rnd() < 0.15 ? pick([p.min, p.max, p.default]) : Math.round(raw / (p.step || 0.001)) * (p.step || 0.001)
	return Math.min(p.max, Math.max(p.min, Number(v.toFixed(6))))
}
const SOURCES = ["tuning-fork", "plucked-ruler", "drum", "monochord", "rubber-band", "xylophone-bar", "glass-bottle", "speaker", "clapper", "bell-jar"]
const makeScene = (k) => {
	const wide = rnd() < 0.3
	const tableW = wide ? 12 : 3.7
	const stage = wide ? { x0: -1, x1: 12, y0: -0.2, y1: 3 } : { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
	const x0 = wide ? -0.4 : -0.45
	const x1 = wide ? 10.5 : 3.0
	const its = [{ id: "table", type: "table", x: wide ? 5.5 : 1.3, y: 0, props: wide ? { width: tableW } : {} }]
	const n = 1 + Math.floor(rnd() * 5)
	for (let i = 0; i < n; i++) {
		const t = pick(types.filter((u) => u.key !== "rice"))
		const props = {}
		for (const p of t.props) if (p.kind !== "link" && rnd() < 0.45 && !["bounce", "friction", "rolling", "side", "material"].includes(p.key)) props[p.key] = randomProp(p)
		if (props.seconds) delete props.seconds
		let x = Number((x0 + rnd() * (x1 - x0)).toFixed(3))
		if (t.key === "plucked-ruler") x = wide ? 11.5 : 3.15
		if ((t.key === "wave-rope" || t.key === "slinky") && props.length) props.length = Math.min(props.length, wide ? 9 : 2.8)
		// (a ripple tank sometimes turned, up to upside down: it keeps itself level)
		its.push({ id: `${t.key}-${i}`, type: t.key, x, y: 0, props, ...(t.key === "ripple-tank" && rnd() < 0.4 ? { angle: pick([45, 90, 150, -120, 180]) } : {}) })
		// rice on a drum's head; a ball dropped on a drum, a fork or a bar
		if (t.key === "drum" && rnd() < 0.7) its.push({ id: `rice-${i}`, type: "rice", x, y: props.height ?? 0.16, props: { count: 1 + Math.floor(rnd() * 12), spread: Number((rnd() * 0.15).toFixed(3)) } })
		if (["drum", "xylophone-bar", "tuning-fork"].includes(t.key) && rnd() < 0.4)
			its.push({ id: `ball-${i}`, type: pick(["golf-ball", "ping-pong-ball", "steel-ball", "superball"]), x: x + (t.key === "tuning-fork" ? 0.03 : 0), y: Number((0.4 + rnd() * 0.5).toFixed(3)), held: rnd() < 0.5 })
	}
	if (rnd() < 0.6) its.push({ id: "meter-a", type: "sound-meter", x: Number((x0 + rnd() * (x1 - x0)).toFixed(3)), y: 0, props: rnd() < 0.3 ? { listen: "touching", weighting: pick(["dB(A)", "dB(Z)"]) } : {} })
	if (rnd() < 0.4) its.push({ id: "meter-b", type: "sound-meter", x: Number((x0 + rnd() * (x1 - x0)).toFixed(3)), y: 0, props: { response: pick(["fast", "slow"]), room: Math.round(rnd() * 60) } })
	if (rnd() < 0.4) its.push({ id: "wall-a", type: "wall", x: Number((x0 + rnd() * (x1 - x0)).toFixed(3)), y: 0, props: rnd() < 0.5 ? { material: "steel" } : {} })
	if (rnd() < 0.2) its.push({ id: "rod-a", type: "steel-rod", x: Number((x0 + rnd() * (x1 - x0)).toFixed(3)), y: 0.006, fixed: true, angle: 0, props: { length: 1 } })
	if (rnd() < 0.2) its.push({ id: "pend-a", type: "pendulum", x: Number((x0 + rnd() * (x1 - x0)).toFixed(3)), y: 0.9 })
	// a water tank (the liquids module's) with a hydrophone hung into it, and sometimes a fork standing in its water
	if (rnd() < 0.2 && sim.catalog().types.some((u) => u.key === "water-tank")) {
		const tx = Number((x0 + 0.5 + rnd() * (x1 - x0 - 1)).toFixed(3))
		its.push({ id: "tank-a", type: "water-tank", x: tx, y: 0 })
		its.push({ id: "hydro-a", type: "hydrophone", x: tx - 0.45, y: 0, props: { reach: 0.4, probe_height: 0.06 + Number((rnd() * 0.1).toFixed(3)) } })
		if (rnd() < 0.6) its.push({ id: "fork-w", type: "tuning-fork", x: tx + 0.05, y: 0.01, props: { box: false } })
	}
	const scene = { version: 2, id: `waves-${k}`, name: `Waves ${k}`, seconds: Number((1 + rnd() * 3).toFixed(2)), release: Number((rnd() * 0.6).toFixed(2)), stage, items: its, goals: [] }
	if (rnd() < 0.15) scene.settings = { air: false }
	else if (rnd() < 0.2) scene.settings = { room_temp: Math.round(-10 + rnd() * 50) }
	// random goals of the module's kinds (and some with fields that name nothing, or odd numbers)
	for (const spec of wavesJs.plugin.goals) for (let j = 0; j < 2; j++) {
		const g = spec.sample?.(scene, pick)
		if (g) scene.goals.push(rnd() < 0.1 ? { ...g, label: "a goal of my own" } : g)
	}
	if (rnd() < 0.3) scene.goals.push({ kind: "sounds", source: "nobody" }, { kind: "echo", meter: "meter-a", delay_s: "x" }, { kind: "louder", a: "meter-a", b: "meter-a" })
	return scene
}

const scenes = []
for (let k = 0; k < N; k++) scenes.push(sim.clean(makeScene(k)))
// a few fixed ones: every type at its defaults together; a vacuum; a buzzer-free circuit scene is circuits' own test
scenes.push(sim.clean({ version: 2, id: "waves-all", name: "All", seconds: 3, release: 0.2, stage: { x0: -1, x1: 30, y0: -0.2, y1: 3 }, items: [{ id: "table", type: "table", x: 14.5, y: 0, props: { width: 31 } }, ...types.map((t, i) => ({ id: `w${i}`, type: t.key, x: t.key === "plucked-ruler" ? 30 : i * 2, y: t.key === "rice" ? 0.5 : 0 }))], goals: [] }))

scenes.push(sim.clean({ version: 2, id: "waves-standing", name: "Standing", seconds: 4, release: 0.2, stage: { x0: -1, x1: 5, y0: -0.2, y1: 3 }, items: [{ id: "table", type: "table", x: 2, y: 0, props: { width: 6 } }, { id: "rope", type: "wave-rope", x: -0.4, y: 0, props: { shake: "keep shaking", frequency: 2.5, amplitude: 0.015, ribbon: 0.3 } }, { id: "tank", type: "ripple-tank", x: 4.2, y: 0, angle: 90 }, { id: "sp", type: "speaker", x: 3.4, y: 0 }, { id: "o", type: "oscilloscope", x: 3.7, y: 0 }], goals: [{ kind: "standing", item: "rope", loops: 2 }, { kind: "wavelength", item: "rope", m: 4 }, { kind: "wave_speed", item: "rope", m_s: 10 }, { kind: "stays_put", item: "rope" }, { kind: "stays_put", item: "tank" }, { kind: "trace", oscilloscope: "o", waves_across: 4.4 }] }))
// string telephones (engine6 crossmod): taut with an ear at its far cup, slack, pinched, drooping on the Moon, in a vacuum; a speaker at a voiceless one's cup
for (const [k, props, settings] of [[0, {}, undefined], [1, { pull: 0 }, undefined], [2, { pinched: true, string: "wire" }, undefined], [3, { pull: 0.1, string: "fishing line", length: 6 }, { gravity: "moon" }], [4, { voice: "normal" }, { air: false }], [5, { voice: "none", length: 1.5 }, undefined]])
	scenes.push(sim.clean({
		version: 2, id: `waves-phone-${k}`, name: `Telephone ${k}`, seconds: 3, release: 0.2, stage: { x0: -1, x1: 8, y0: -0.2, y1: 3 }, ...(settings ? { settings } : {}),
		items: [
			{ id: "table", type: "table", x: 3.5, y: 0, props: { width: 9 } },
			{ id: "phone", type: "string-telephone", x: 3, y: 0.3, props },
			{ id: "ear", type: "sound-meter", x: Number((3 + (props.length ?? 3) / 2 + 0.12).toFixed(3)), y: 0, props: { height: 0.3 } },
			...(props.voice === "none" ? [{ id: "sp", type: "speaker", x: Number((3 - 0.75 - 0.2).toFixed(3)), y: 0.2 }] : [])
		],
		goals: [{ kind: "hears", meter: "ear", source: props.voice === "none" ? "sp" : "phone" }, { kind: "hears", meter: "ear", source: "phone", expect: false }, { kind: "sounds", source: "phone" }]
	}))
const PY = py({ scenes: scenes.map((scene) => ({ scene })) }).results
const tracks = []
let worst = 0
for (let k = 0; k < scenes.length; k++) {
	const scene = scenes[k]
	let js
	try {
		js = sim.layout(scene)
	} catch (e) {
		ok(PY[k].error !== undefined && `can't build this scene: ${PY[k].error}` === e.message, `scene ${scene.id}: both refuse it alike`, e.message)
		tracks.push(null)
		continue
	}
	ok(PY[k].error === undefined, `scene ${scene.id}: items.py builds it`, PY[k].error)
	ok(isDeepStrictEqual(PY[k].doc, js.doc), `scene ${scene.id}: document items.py == web/sim`)
	ok(isDeepStrictEqual(PY[k].resolved, js.resolved), `scene ${scene.id}: resolved props`)
	ok(isDeepStrictEqual(PY[k].warnings, js.warnings), `scene ${scene.id}: warnings`)
	const t0 = performance.now()
	const server = serverRun(js.doc)
	const ms = performance.now() - t0
	worst = Math.max(worst, ms / scene.seconds)
	const msg = bundle.handle({ id: k, doc: js.doc, rate: 120 })
	ok(msg.error === undefined, `scene ${scene.id}: the bundle runs it`, msg.error)
	const b = JSON.stringify(msg.track)
	ok(server === b, `scene ${scene.id}: track, server's engine == bundle, byte for byte`, `${server.length} vs ${b.length}`)
	ok(serverRun(js.doc) === server, `scene ${scene.id}: the same run twice gives the same bytes`)
	const track = JSON.parse(b)
	let bad = 0
	for (const keys of Object.values(track.state ?? {})) for (const v of Object.values(keys)) for (const x of v) if (typeof x !== "number" || !Number.isFinite(x)) bad++
	ok(bad === 0, `scene ${scene.id}: every reading finite`, `${bad} bad`)
	tracks.push({ js, track })
}
console.log(`engine: the slowest scene ran ${worst.toFixed(0)} ms per second of run`)
// (a hang check: grains wedged under a rod or a ball are the engine's slow case, not the module's: CONTRACT "Engine batch 2")
ok(worst < 10000, "every scene runs faster than 10 s per second of run", `${worst.toFixed(0)} ms/s`)

// ---- summaries
const withTracks = scenes.map((scene, k) => ({ scene, track: tracks[k]?.track })).filter((c) => c.track)
const PS = py({ scenes: withTracks }).results
withTracks.forEach((c, i) => {
	const k = scenes.indexOf(c.scene)
	const meta = sim.finish(c.scene, tracks[k].js.doc, tracks[k].js.resolved, c.track)
	ok(isDeepStrictEqual(PS[i].summary, JSON.parse(JSON.stringify(meta.summary))), `scene ${c.scene.id}: summary items.py == web/sim`)
})
const kinds = new Set(withTracks.flatMap((c, i) => (PS[i].summary?.goals ?? []).map((g) => g.kind)))
ok(["sounds", "higher", "louder", "hears", "echo", "wave_reaches", "jumps", "period", "reflects", "standing", "wavelength", "wave_speed", "stays_put", "trace"].every((k) => kinds.has(k)), "every waves goal kind was checked", [...kinds].join(", "))

// ---- the bundle in headless Chromium (the same bytes as node)
if (BROWSER) {
	const require = createRequire(import.meta.url)
	const { chromium } = require(process.env.PLAYWRIGHT_CORE || "/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")
	const http = await import("node:http")
	const fs = await import("node:fs")
	const server = http.createServer((req, res) => {
		const u = decodeURIComponent(new URL(req.url, "http://x").pathname)
		if (u === "/") return res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><meta charset=utf-8><title>waves</title>")
		const f = join(PG, "web", u)
		if (!f.startsWith(join(PG, "web", "sim")) || !fs.existsSync(f)) return res.writeHead(404).end()
		res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(fs.readFileSync(f))
	})
	await new Promise((r) => server.listen(0, "127.0.0.1", r))
	const base = `http://127.0.0.1:${server.address().port}`
	const shell = join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell")
	const browser = await chromium.launch({ headless: true, ...(existsSync(shell) ? { executablePath: shell } : {}) })
	try {
		const page = await browser.newPage()
		await page.goto(base)
		for (let k = 0; k < scenes.length; k += 4) {
			if (!tracks[k]) continue
			const out = await page.evaluate(async (docJson) => {
				const m = await import("/sim/engine-worker.js")
				const r = m.handle({ id: 1, doc: JSON.parse(docJson), rate: 120 })
				return r.error ?? JSON.stringify(r.track)
			}, JSON.stringify(tracks[k].js.doc))
			ok(out === JSON.stringify(tracks[k].track), `scene ${scenes[k].id}: Chromium's bundle == node's`)
		}
	} finally {
		await browser.close()
		server.close()
	}
}
writeFileSync(join(OUT, "scenes.json"), JSON.stringify(scenes))
console.log(`${cases} cases, ${failed} mismatches (${scenes.length} scenes)`)
process.exit(failed ? 1 : 0)
