// Crash fuzz of the physics engine (tooling/src/sim/physics.ts) on random scenes of every catalog type with extreme props: every scene the
// builder (web/sim, the exact port of machines/items.py) makes a document of must run to its end without any exception, every placement finite.
// Needs no server: the scenes are built with web/sim and run with the engine in node, sharded over child processes.
//   node --no-warnings tools/parity/engine-fuzz.mjs [--n 5000] [--seed 20261015] [--jobs 8] [--engine tooling/src/sim] [--dump fails.jsonl] [--wild 60]
//     [--only 12,345 [--doc out/prefix]]   (just those scenes, in this process; --doc writes each one's document to <prefix>-<i>.json)
// Cases: per scene 1-30 items (a tenth of them 12-30), each type drawn so every type comes up about equally often (every type but the catalog's
// look variants, which run as their base types do: tools/parity/look-variants.mjs, so a seed makes the scenes it made), a third of the scenes with
// every number prop at one corner (min, max, the slider's top, below the range, above it: the builder clamps), the rest with each prop at a
// random corner or value half the time; a quarter of the scenes packed into one cluster 3-50 cm across (items deep inside each other), held and
// fixed items, any angle (huge, fractional), random seconds and release. Reported: scenes run, scenes the builder refused (400, as the server
// would), documents the engine refused on admission (a clean message: listed), exceptions while stepping (FAIL), non-finite placements (FAIL),
// the slowest scenes, and (for review, not a failure) "wild" scenes where a solid moved faster than --wild m/s or turned faster than 50·wild rad/s.
// Exits 1 on any exception while stepping or any non-finite number.
// The engine runs with the browser bundle's math, as the server's worker does (tools/engine-math-node.mjs, registered before the engine is
// imported below: in this process and in every shard it forks), so a scene behaves here as on the server and in the page, on any machine.
import "../engine-math-node.mjs"
import { fork } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { fuzzKeys } from "./look-variants.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PG = path.resolve(HERE, "../..")
const args = process.argv.slice(2)
const opt = (name, dflt) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt)
const N = Number(opt("n", 5000))
const SEED = Number(opt("seed", 20261015))
const JOBS = Number(opt("jobs", 8))
const ENGINE = path.resolve(PG, opt("engine", "tooling/src/sim"))
const SIM = path.resolve(PG, opt("sim", "web/sim"))
const DUMP = opt("dump", null)
const WILD = Number(opt("wild", 60))
const SHARD = opt("shard", null)
const ONLY = opt("only", null) // a comma list of scene indexes: run just those (in this process)
const DOC = opt("doc", null) // with --only: write each scene's document to <DOC>-<i>.json (to trace it)

function mulberry32(a) {
	return () => {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Scene i of the run: drawn from its own seed, so a scene is the same whatever the sharding or --only. */
const sceneOf = (CAT, i) => {
	const rng = mulberry32((SEED ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0)
	const U = (a, b) => a + (b - a) * rng()
	const ri = (a, b) => a + Math.floor(rng() * (b - a + 1))
	const pick = (arr) => arr[Math.floor(rng() * arr.length)]
	const chance = (p) => rng() < p
	const keys = fuzzKeys(CAT.types)
	const corners = ["min", "max", "slider", "below", "above"]
	const value = (p, mode) => {
		if (p.kind === "bool") return chance(0.5)
		if (p.kind === "choice") return pick(p.choices)
		const lo = p.min
		const hi = p.max
		let v
		switch (mode) {
			case "min":
				v = lo
				break
			case "max":
				v = hi
				break
			case "slider":
				v = p.slider_max ?? hi
				break
			case "below":
				v = lo - pick([U(0, 1) * (hi - lo), 1, 1e3, 1e9])
				break
			case "above":
				v = hi + pick([U(0, 1) * (hi - lo), 1, 1e3, 1e9])
				break
			case "near-min":
				v = lo + U(0, 1e-6) * (hi - lo || 1)
				break
			default:
				v = U(lo, hi)
		}
		return p.kind === "int" ? Math.round(v) : v
	}
	const allCorner = chance(1 / 3) ? pick(corners) : null
	const n = chance(0.1) ? ri(12, 30) : ri(1, 10)
	const items = []
	if (chance(0.5)) items.push({ id: "table", type: "table", x: 1.3, y: 0, angle: 0, props: {} })
	for (let k = 0; k < n; k++) {
		// every type about equally often: scene i's first item walks the catalog, the rest are random
		const type = k === 0 ? keys[i % keys.length] : pick(keys)
		const t = CAT.types.find((x) => x.key === type)
		const props = {}
		for (const p of t.props) {
			if (allCorner && (p.kind === "number" || p.kind === "int")) props[p.key] = value(p, chance(0.8) ? allCorner : pick(corners))
			else if (chance(0.5)) props[p.key] = value(p, pick([...corners, "near-min", "uniform", "uniform"]))
		}
		const it = { id: `i${k}`, type, x: Number(U(-0.5, 3.1).toFixed(3)), y: Number(U(-0.1, 2.2).toFixed(3)), angle: 0, props }
		const a = rng()
		if (a < 0.4) it.angle = 0
		else if (a < 0.6) it.angle = pick([15, 30, 45, 60, 90, 120, 180, -30, -90, -150, 270, 360])
		else if (a < 0.9) it.angle = U(-180, 180)
		else it.angle = pick([720, -1080, 3630, 99999, -1e5, U(-1e-9, 1e-9)])
		if (chance(0.25)) it.held = true
		if (chance(0.1)) it.fixed = true
		items.push(it)
	}
	if (chance(0.25)) {
		const cx = U(0, 2.6)
		const cy = U(0.1, 1.5)
		const r = pick([0.015, 0.05, 0.12, 0.25])
		for (const it of items) if (it.id !== "table") Object.assign(it, { x: cx + U(-r, r), y: cy + U(-r, r) })
	}
	return { version: 2, id: `ef-${i}`, name: `engine fuzz ${i}`, seconds: pick([1, 1.5, 2, 2.5, 3, U(0.5, 4)]), release: pick([0, 0.1, 0.5, U(0, 1)]), items, goals: [] }
}

/** Runs scenes [indexes] in this process; returns one record per scene. */
const runScenes = async (indexes) => {
	const sim = await import(pathToFileURL(path.join(SIM, "index.js")).href)
	const { simulate } = await import(pathToFileURL(path.join(ENGINE, "physics.ts")).href)
	const { admitDocument } = await import(pathToFileURL(path.join(ENGINE, "document.ts")).href)
	console.warn = () => {}
	const CAT = sim.catalog()
	const out = []
	for (const i of indexes) {
		const scene = sceneOf(CAT, i)
		const rec = { i, items: scene.items.length }
		let doc
		try {
			doc = sim.prepare(structuredClone(scene)).doc
		} catch (e) {
			rec.built = e instanceof sim.BadScene ? "400" : `builder error: ${e.message}`
			out.push(rec)
			continue
		}
		if (DOC !== null) fs.writeFileSync(`${DOC}-${i}.json`, JSON.stringify(doc))
		let admitted
		try {
			admitted = admitDocument(doc).scene
		} catch (e) {
			rec.refused = String(e.message).trim().split("\n").at(-1)
			out.push(rec)
			continue
		}
		const t0 = performance.now()
		try {
			const track = simulate(admitted, 120)
			rec.ms = Math.round(performance.now() - t0)
			let fast = 0
			let spin = 0
			let who = ""
			let bad = null
			const frames = track.frames
			for (let k = 0; k < frames.length; k++) {
				const f = frames[k].placements
				for (const id in f) {
					const p = f[id]
					if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.angle) || (p.squash !== undefined && !Number.isFinite(p.squash))) bad ??= `${id} at ${frames[k].t}`
					const q = k > 0 ? frames[k - 1].placements[id] : undefined
					if (q === undefined) continue
					const dt = frames[k].t - frames[k - 1].t
					if (!(dt > 0)) continue
					const v = Math.hypot(p.x - q.x, p.y - q.y) / dt
					const w = Math.abs(p.angle - q.angle) / dt
					if (v > fast) [fast, who] = [v, id]
					if (w > spin) spin = w
				}
			}
			for (const hit of track.impacts ?? []) if (!Number.isFinite(hit.speed)) bad ??= `impact ${hit.a}/${hit.b}`
			rec.fast = Math.round(fast * 10) / 10
			rec.spin = Math.round(spin)
			rec.who = who
			if (bad) rec.nonfinite = bad
		} catch (e) {
			rec.ms = Math.round(performance.now() - t0)
			rec.threw = String(e.message)
			rec.stack = String(e.stack).split("\n").slice(0, 6).join(" | ")
		}
		out.push(rec)
	}
	return out
}

if (SHARD !== null) {
	// a child: run its shard and send the records back
	const [k, K] = SHARD.split("/").map(Number)
	const idx = []
	for (let i = k; i < N; i += K) idx.push(i)
	const recs = await runScenes(idx)
	process.send(recs, () => process.exit(0))
} else {
	const t0 = Date.now()
	let recs
	if (ONLY !== null) recs = await runScenes(ONLY.split(",").map(Number))
	else {
		console.log(`engine-fuzz: ${N} scenes, seed ${SEED}, ${JOBS} processes, engine ${path.relative(PG, ENGINE) || ENGINE}`)
		const parts = await Promise.all(
			Array.from({ length: JOBS }, (_, k) =>
				new Promise((resolve, reject) => {
					const child = fork(fileURLToPath(import.meta.url), [...args.filter((a, j) => a !== "--jobs" && args[j - 1] !== "--jobs"), "--shard", `${k}/${JOBS}`], { execArgv: ["--no-warnings", "--stack-size=4000"] })
					let got = null
					child.on("message", (m) => (got = m))
					child.on("exit", (code) => (got ? resolve(got) : reject(new Error(`shard ${k}/${JOBS} exited with ${code} and no answer (a crashed process)`))))
				})
			)
		)
		recs = parts.flat().sort((a, b) => a.i - b.i)
	}
	const ran = recs.filter((r) => r.ms !== undefined)
	const threw = recs.filter((r) => r.threw !== undefined)
	const nonfinite = recs.filter((r) => r.nonfinite !== undefined)
	const refused = recs.filter((r) => r.refused !== undefined)
	const built400 = recs.filter((r) => r.built === "400")
	const builderErr = recs.filter((r) => r.built !== undefined && r.built !== "400")
	const wild = ran.filter((r) => r.fast > WILD || r.spin > 50 * WILD)
	console.log(`  scenes: ${recs.length}; run ${ran.length} (${ran.reduce((s, r) => s + r.items, 0)} items); builder refused ${built400.length} (400) and failed on ${builderErr.length}; engine refused on admission ${refused.length}`)
	if (refused.length) console.log(`    admission messages: ${[...new Set(refused.map((r) => r.refused))].slice(0, 6).join(" | ")}`)
	for (const r of builderErr.slice(0, 5)) console.log(`    builder error in scene ${r.i}: ${r.built}`)
	const slow = [...ran].sort((a, b) => b.ms - a.ms).slice(0, 5)
	console.log(`  time: ${(ran.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(0)} s of engine; slowest ${slow.map((r) => `#${r.i} ${r.ms} ms`).join(", ")}`)
	console.log(`  wild (a solid faster than ${WILD} m/s or ${50 * WILD} rad/s; for review): ${wild.length}${wild.length ? ": " + wild.slice(0, 12).map((r) => `#${r.i} ${r.fast} m/s ${r.spin} rad/s (${r.who})`).join(", ") : ""}`)
	console.log(`  exceptions while stepping: ${threw.length}${threw.length ? "" : " (none)"}`)
	for (const r of threw.slice(0, 10)) console.log(`    scene ${r.i}: ${r.threw}\n      ${r.stack}`)
	console.log(`  non-finite placements: ${nonfinite.length}`)
	for (const r of nonfinite.slice(0, 10)) console.log(`    scene ${r.i}: ${r.nonfinite}`)
	if (DUMP) fs.writeFileSync(DUMP, recs.map((r) => JSON.stringify(r)).join("\n") + "\n")
	const ok = threw.length === 0 && nonfinite.length === 0 && builderErr.length === 0
	console.log(`${ok ? "PASS" : "FAIL"}: ${threw.length} exceptions, ${nonfinite.length} non-finite, in ${ran.length} scenes (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
	process.exit(ok ? 0 : 1)
}
