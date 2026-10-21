// One physics module's parity and engine checks, for any module (machines/mod_<name>.py == web/sim/modules/<name>.js; the server's engine
// == the browser bundle), the release gate's check for the modules without a tool of their own (tools/parity/run.sh):
//   catalog   the module's catalog entries, Python == JS (props, links, readouts and their words, module); its categories
//   build     documents, resolved props, warnings and refusals, Python == JS: every type at its defaults and at --n random props each (every
//             number on its range's steps and at its ends, every choice, links to items of the allowed types, to nothing, to a wrong
//             one), and --mix scenes of 2-4 of its types together with partner items and random settings (a vacuum, a cold or hot room,
//             the Moon, a time-lapse); clean() on garbage props
//   engine    (--engine) the server's engine (node, the bundle's math, every module's processes) == the browser bundle web/sim/engine-worker.js,
//             the track's JSON byte for byte, on up to --per scenes of each type and the mixes; nothing non-finite; the summaries (goal kinds,
//             readings, happenings) Python == JS on those runs, with goals of every kind of the module sampled (its kinds' sample())
//   node --no-warnings tools/parity/module.mjs --module circuits [--n 12] [--mix 40] [--engine] [--per 2] [--seed 7]
// A module's own test may call runModuleParity({module, partners, ...}) with the partner items its scenes need (tools/air/test.mjs).
import { execFileSync } from "../child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const SETTINGS = [{ air: false }, { room_temp: -10 }, { room_temp: 35 }, { gravity: "moon" }, { time_lapse: 60 }, { time_lapse: 3600 }]

export function firstDiff(a, b, path = "") {
	if (isDeepStrictEqual(a, b)) return ""
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return `${path}: ${JSON.stringify(a)?.slice(0, 160)} vs ${JSON.stringify(b)?.slice(0, 160)}`
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const d = firstDiff(a[k], b[k], `${path}.${k}`)
		if (d) return d
	}
	return `${path}: key order`
}

/**
 * opts: {module (its name without mod_), n (random prop sets per type, 12), mix (mixed scenes, 40), engine (bool), per (engine runs per type, 2),
 * seed (7), partners: [{type, props?, x?, y?}] (items its mixed scenes may hold besides its own: a fan, a breeze), log (console.log)}
 * -> {cases, failed, docs, runs}
 */
export async function runModuleParity(opts = {}) {
	const name = String(opts.module ?? "")
	if (!name) throw new Error("--module <name> is needed")
	const N = opts.n ?? 12
	const MIX = opts.mix ?? 40
	const PER = opts.per ?? 2
	const log = opts.log ?? console.log
	let seed = (opts.seed ?? 7) >>> 0
	const rnd = () => {
		seed = (seed + 0x6d2b79f5) >>> 0
		let t = seed
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
	const pick = (a) => a[Math.floor(rnd() * a.length)]
	let failed = 0
	let cases = 0
	const ok = (cond, what, detail = "") => {
		cases++
		if (!cond) {
			failed++
			log(`FAIL  ${what}${detail ? `  (${detail})` : ""}`)
		}
	}
	const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
	await (sim.ready ?? Promise.resolve())
	const errs = (await import(pathToFileURL(join(PG, "web/sim/modules/index.js")).href)).MODULE_ERRORS ?? {}
	ok(!errs[`mod_${name}`], `web/sim loads mod_${name}`, errs[`mod_${name}`])
	const py = (req) => {
		try {
			return JSON.parse(execFileSync("python3", [join(HERE, "py_module.py")], { input: JSON.stringify({ module: name, ...req }), maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "pipe"] }).toString())
		} catch (e) {
			throw new Error(`py_module.py failed: ${String(e.stderr ?? e.message).trim().split("\n").slice(-40).join(" | ")}`)
		}
	}
	const cat = sim.catalog()
	const TYPES = cat.types.filter((t) => t.module === name)
	ok(TYPES.length > 0, `the catalog has mod_${name}'s types`)
	const scene = (items, extra = {}) => ({ version: 2, id: "m", name: name, seconds: 2, release: 0.3, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0 }, ...items], goals: [], ...extra })
	const randomProp = (p) => {
		if (p.kind === "bool") return rnd() < 0.5
		if (p.kind === "choice") return pick(p.choices)
		if (p.kind === "int") return p.min + Math.floor(rnd() * (p.max - p.min + 1))
		if (typeof p.min !== "number" || typeof p.max !== "number") return p.default
		if (rnd() < 0.15) return pick([p.min, p.max])
		const step = p.step || (p.max - p.min) / 100 || 1
		const steps = Math.round((p.max - p.min) / step)
		return Number((p.min + Math.floor(rnd() * (steps + 1)) * step).toFixed(6))
	}
	const randomProps = (t) => {
		const props = {}
		for (const p of t.props) if (!p.common && !p.auto && p.key !== "material" && rnd() < 0.6) props[p.key] = randomProp(p)
		const mat = t.props.find((p) => p.key === "material")
		if (mat?.choices?.length > 1 && rnd() < 0.4) props.material = pick(mat.choices)
		return props
	}
	/** Links to items of the scene of the allowed types (one is added when there is none), to nothing, or now and then to a wrong one. */
	const link = (t, item, items) => {
		for (const l of t.links ?? []) {
			const r = rnd()
			if (r < 0.15) continue
			if (r < 0.22) {
				item.props[l.key] = pick(["nobody", "table", item.id])
				continue
			}
			const allowed = (l.types ?? []).length ? l.types : cat.types.map((x) => x.key).filter((k) => k !== "table" && k !== "wall")
			let target = items.find((i) => i.id !== item.id && allowed.includes(i.type))
			if (!target) {
				const type = pick(allowed.filter((k) => cat.types.some((x) => x.key === k)))
				if (!type) continue
				target = { id: `l${items.length}`, type, x: Math.round((0.2 + 2.4 * rnd()) * 1000) / 1000, y: 0, props: {} }
				items.push(target)
			}
			item.props[l.key] = target.id
		}
	}
	const x = () => Math.round((0.1 + 2.6 * rnd()) * 1000) / 1000

	// ---- catalog
	const P0 = py({ scenes: [] })
	const jsTypes = TYPES.map(({ preview, ...t }) => t)
	ok(!P0.errors?.[`mod_${name}`], `items.py loads mod_${name}`, P0.errors?.[`mod_${name}`])
	ok(isDeepStrictEqual(P0.types, jsTypes), "catalog entries equal (props, links, readouts, module)", `${P0.types.length} vs ${jsTypes.length}: ${firstDiff(P0.types, jsTypes)}`)
	for (const c of new Set(TYPES.map((t) => t.category))) ok(P0.categories.includes(c) && cat.categories.includes(c), `the category ${c}`)

	// ---- build
	const scenes = []
	const tagOf = []
	for (const t of TYPES) {
		scenes.push(scene([{ id: "it", type: t.key, x: 1.2, y: 0, props: {} }]))
		tagOf.push(t.key)
		for (let k = 0; k < N; k++) {
			const items = [{ id: "it", type: t.key, x: x(), y: rnd() < 0.7 ? 0 : Math.round(rnd() * 1.2 * 1000) / 1000, angle: rnd() < 0.15 ? Math.round(rnd() * 60 - 30) : 0, props: randomProps(t), ...(rnd() < 0.1 ? { fixed: true } : {}), ...(rnd() < 0.1 ? { held: true } : {}) }]
			link(t, items[0], items)
			scenes.push(scene(items, rnd() < 0.15 ? { settings: pick(SETTINGS) } : {}))
			tagOf.push(t.key)
		}
		// (garbage props: clean() keeps what is in range, as items.py does)
		scenes.push(scene([{ id: "it", type: t.key, x: 1.2, y: 0, props: Object.fromEntries(t.props.slice(0, 6).map((p) => [p.key, pick([-1e9, 1e9, "zz", null, true])])) }]))
		tagOf.push(t.key)
	}
	for (let k = 0; k < MIX; k++) {
		const items = []
		const n = 2 + Math.floor(rnd() * 3)
		for (let i = 0; i < n; i++) {
			const t = pick(TYPES)
			items.push({ id: `i${i}`, type: t.key, x: x(), y: rnd() < 0.7 ? 0 : Math.round(rnd() * 1.2 * 1000) / 1000, props: randomProps(t) })
		}
		for (const it of [...items]) link(TYPES.find((t) => t.key === it.type), it, items)
		for (const p of opts.partners ?? []) if (rnd() < 0.35) items.push({ id: `p${items.length}`, type: p.type, x: p.x ?? x(), y: p.y ?? 0, props: { ...(p.props ?? {}) } })
		scenes.push(scene(items, rnd() < 0.3 ? { settings: pick(SETTINGS) } : {}))
		tagOf.push("mix")
	}
	const cleaned = []
	const jsOut = []
	for (const s of scenes) {
		try {
			const c = sim.clean(s)
			cleaned.push(c)
			const r = sim.layout(c)
			jsOut.push({ doc: r.doc, resolved: r.resolved, warnings: r.warnings })
		} catch (e) {
			cleaned.push(s)
			jsOut.push({ error: String(e.message).replace(/^can't build this scene: /, "") })
		}
	}
	const pyOut = py({ scenes }).results
	let docs = 0
	for (let k = 0; k < scenes.length; k++) {
		const a = pyOut[k]
		const b = jsOut[k]
		const what = `${scenes[k].items.slice(1).map((i) => i.type).join(" + ")} #${k}`
		if (a.error500 !== undefined) {
			ok(false, `${what}: Python fails (a 500)`, a.error500)
			continue
		}
		if (a.error !== undefined || b.error !== undefined) {
			ok(String(a.error).replace(/^can't build this scene: /, "") === b.error, `${what}: the same refusal`, `${a.error} | ${b.error}`)
			continue
		}
		docs++
		ok(isDeepStrictEqual(a.doc, b.doc), `${what}: document`, firstDiff(a.doc, b.doc))
		ok(isDeepStrictEqual(a.resolved, b.resolved), `${what}: resolved`, firstDiff(a.resolved, b.resolved))
		ok(isDeepStrictEqual(a.warnings, b.warnings), `${what}: warnings`, firstDiff(a.warnings, b.warnings))
	}

	// ---- engine and summaries
	let runs = 0
	if (opts.engine) {
		await import(pathToFileURL(join(PG, "tools/engine-math-node.mjs")).href)
		const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
		const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)
		const plugins = await import(pathToFileURL(join(PG, "tooling/src/sim/plugins.ts")).href)
		const eng = await import(pathToFileURL(join(PG, "tooling/src/sim/modules/index.ts")).href)
		ok(!eng.ENGINE_MODULE_ERRORS?.[name], `the engine loads module ${name}`, eng.ENGINE_MODULE_ERRORS?.[name])
		const round = (v, d) => Number(v.toFixed(d))
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
			return JSON.stringify({ fps: track.fps, frames: slim, impacts: track.impacts, ...plugins.slimExtras(track, round) })
		}
		const B = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href).catch(() => null)
		ok(!!B?.handle, "the browser bundle web/sim/engine-worker.js answers")
		const picks = []
		for (let k = 0; k < scenes.length; k++) {
			if (jsOut[k].error !== undefined) continue
			if (picks.filter((p) => p.t === tagOf[k]).length >= (tagOf[k] === "mix" ? Math.max(PER, Math.ceil(MIX / 4)) : PER)) continue
			picks.push({ k, t: tagOf[k] })
		}
		const done = []
		for (const { k } of picks) {
			const doc = jsOut[k].doc
			const what = `${scenes[k].items.slice(1).map((i) => i.type).join(" + ")} #${k}`
			let server
			try {
				server = serverRun(doc)
			} catch (e) {
				ok(false, `engine runs ${what}`, e.message)
				continue
			}
			runs++
			if (B?.handle) {
				const msg = B.handle({ id: k, doc, rate: 120 })
				ok(msg.error === undefined && JSON.stringify(msg.track) === server, `bundle == server engine: ${what}`, msg.error ?? `${server.length} bytes`)
			}
			const track = JSON.parse(server)
			let finite = true
			for (const f of track.frames) for (const p of Object.values(f.placements)) if (![p.x, p.y, p.angle].every(Number.isFinite)) finite = false
			ok(finite && !/null|NaN|Infinity/.test(JSON.stringify(track.state ?? {})), `finite placements and readings: ${what}`)
			done.push({ k, track })
		}
		const kinds = sim.plugins.modules().find((m) => m.name === `mod_${name}`)?.goals ?? []
		const sc = []
		const tr = []
		for (const { k, track } of done) {
			let goals = []
			try {
				goals = kinds.map((g) => g.sample?.(cleaned[k], pick)).filter(Boolean)
			} catch (e) {
				ok(false, `goal samples for #${k}`, e.message)
			}
			sc.push({ ...cleaned[k], goals })
			tr.push(track)
		}
		const P = py({ scenes: sc, tracks: tr }).results
		for (let i = 0; i < sc.length; i++) {
			let js
			try {
				js = sim.finish(sc[i], jsOut[done[i].k].doc, jsOut[done[i].k].resolved, tr[i]).summary
			} catch (e) {
				ok(false, `summary in JS #${done[i].k}`, e.message)
				continue
			}
			ok(P[i].error === undefined && isDeepStrictEqual(P[i].summary, js), `summary Python == JS #${done[i].k} (${sc[i].goals.length} goals)`, P[i].error ?? firstDiff(P[i].summary, js))
		}
		log(`engine: ${runs} runs${B?.handle ? ", the bundle compared" : ""}; ${sc.reduce((a, s) => a + s.goals.length, 0)} goals of ${kinds.length} kinds summarised`)
	}
	log(`mod_${name} parity: ${cases} checks, ${TYPES.length} types, ${docs} documents, ${runs} engine runs, ${failed} mismatches`)
	return { cases, failed, docs, runs }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const arg = (k, d) => {
		const i = process.argv.indexOf(k)
		return i >= 0 ? process.argv[i + 1] : d
	}
	const r = await runModuleParity({ module: arg("--module"), n: Number(arg("--n", 12)), mix: Number(arg("--mix", 40)), per: Number(arg("--per", 2)), seed: Number(arg("--seed", 7)), engine: process.argv.includes("--engine") })
	process.exit(r.failed ? 1 : 0)
}
