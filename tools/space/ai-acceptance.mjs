// AI acceptance of the space module: real Opus 5.5 calls through a local server (web/server.py on --port, its /api/ai/* steps and
// /api/simulate), driven by the app's own pipeline (web/ai/orchestrator.js: plan → solve → simulate → refine → tune, and the edit step with
// its make-it-work search), as the AI panel runs it (without the panel's renders: shot null). Each case's final scene, run, report and
// verdict are written to --out. The verdict re-runs the final scene and checks: the module's items are used, every stated goal is met,
// and for an edit what the request asked changed (and nothing it did not ask), the card's words, and a checked fix when the edit broke a goal.
//   node tools/space/ai-acceptance.mjs --port 8918 --out <dir> [--cases build1,edit2] [--jobs 3]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const argv = process.argv.slice(2)
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const PORT = Number(opt("--port", "8918"))
const OUT = opt("--out", "/tmp/space-ai")
const ONLY = opt("--cases", null)?.split(",") ?? null
const JOBS = Number(opt("--jobs", "3"))
const BASE = `http://localhost:${PORT}`
mkdirSync(OUT, { recursive: true })

await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
await import(pathToFileURL(join(PG, "web/sim/modules/index.js")).href)
const ORCH = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)

const post = async (p, body, signal) => {
	const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal })
	const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
	return j
}
const api = async (p, body, signal) => post(p, body, signal)
const simulate = async (scene, signal) => {
	const r = await fetch(BASE + "/api/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scene }), signal })
	const j = await r.json()
	if (!r.ok) {
		const e = new Error(j.error ?? `HTTP ${r.status}`)
		e.status = r.status
		throw e
	}
	return j
}
const orch = ORCH.createOrchestrator({ api, shot: null, simulate })
const clone = (o) => JSON.parse(JSON.stringify(o))
const SPACE = new Set(["sun", "planet", "moon", "satellite", "rock-hammer", "gnomon", "globe", "moon-ball"])

// ---------------------------------------------------------------- the base scenes the edits start from (built by hand, as a teacher would)
const STAGE = { x0: -0.6, x1: 3.4, y0: -0.2, y1: 3.0 }
const BASES = {
	earthMoon: {
		version: 2, id: "earth-moon", name: "Earth and Moon", seconds: 14.5, release: 0.5, stage: STAGE,
		items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "earth", type: "planet", x: 1.3, y: 1.45, props: {} }, { id: "moon", type: "moon", x: 2.58133, y: 1.45, props: { primary: "earth" } }],
		goals: [{ kind: "orbits", item: "moon", around: "earth", label: "The Moon circles Earth once" }]
	},
	cannon: {
		version: 2, id: "newtons-cannon", name: "Newton's cannon", seconds: 9.8, release: 0.5, stage: { x0: -0.6, x1: 3.2, y0: -0.2, y1: 3.4 },
		items: [
			{ id: "table", type: "table", x: 1.3, y: 0, props: {} },
			{ id: "earth", type: "planet", x: 1.3, y: 1.55, fixed: true, props: { scale: "low-orbit" } },
			{ id: "ball", type: "satellite", x: 1.3, y: 1.55 + 0.6791, name: "Cannonball", props: { kind: "cannonball", size: 0.04, primary: "earth" } }
		],
		goals: [{ kind: "orbits", item: "ball", around: "earth", label: "The cannonball circles Earth once" }]
	},
	moonDrop: {
		version: 2, id: "moon-drop", name: "Hammer and ball on the Moon", seconds: 2.4, release: 0.5, stage: { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }, settings: { gravity: "moon", air: false },
		items: [
			{ id: "table", type: "table", x: 1.3, y: 0, props: {} },
			{ id: "hammer", type: "rock-hammer", x: 1.0, y: 1.685, held: true, props: {} },
			{ id: "ball", type: "ping-pong-ball", x: 1.8, y: 1.62, held: true, props: {} }
		],
		goals: [{ kind: "lands_together", a: "hammer", b: "ball", label: "The hammer and the ball land together" }]
	},
	// (2026-10-20) the classroom models
	globe: {
		version: 2, id: "globe-day-night", name: "Day and night on a globe", seconds: 20, release: 0.5, stage: { x0: -0.4, x1: 2.4, y0: -0.2, y1: 1.4 },
		items: [
			{ id: "table", type: "table", x: 1.3, y: 0, props: {} },
			{ id: "lamp", type: "lamp", name: "Lamp", x: 0.25, y: 0, props: { target: "globe", head_height: 0.4 } },
			{ id: "globe", type: "globe", name: "Globe", x: 1.3, y: 0, props: { spin_rpm: 6, start_hour: 6, town_lat: 30.27 } }
		],
		goals: [{ kind: "day_night", item: "globe", days: 1, label: "The town goes through a day and a night" }]
	},
	globeNoon: {
		version: 2, id: "globe-noon", name: "Noon at the town", seconds: 4, release: 0.5, stage: { x0: -0.4, x1: 2.4, y0: -0.2, y1: 1.4 },
		items: [
			{ id: "table", type: "table", x: 1.3, y: 0, props: {} },
			{ id: "lamp", type: "lamp", name: "Lamp", x: 0.25, y: 0, props: { target: "globe", head_height: 0.4 } },
			{ id: "globe", type: "globe", name: "Globe", x: 1.3, y: 0, props: { spin_rpm: 6, start_hour: 6, town_lat: 30.27 } }
		],
		goals: [{ kind: "day_night", item: "globe", is: "day", at_s: 2.5, label: "It is day at the town at 2.5 s" }]
	},
	moonBall: {
		version: 2, id: "moon-ball-phases", name: "Moon phases with a ball", seconds: 7, release: 0.5, stage: { x0: -0.4, x1: 2.4, y0: -0.2, y1: 1.4 },
		items: [
			{ id: "table", type: "table", x: 1.3, y: 0, props: {} },
			{ id: "lamp", type: "lamp", name: "Lamp", x: 0.15, y: 0, props: { target: "globe" } },
			{ id: "globe", type: "globe", name: "Globe", x: 1.4, y: 0, props: { spin_rpm: 0, start_hour: 12 } },
			{ id: "ball", type: "moon-ball", name: "Moon ball", x: 1.4, y: 0.4, props: { around: "globe", period_s: 12 } }
		],
		goals: [{ kind: "phase", item: "ball", name: "full moon", at_s: 6, label: "Full moon at 6 s" }]
	}
}

const CASES = [
	{ id: "build1", mode: "build", text: "Show the Moon going around the Earth once, at the real distance for the scale.", expect: { types: ["planet", "moon"], kinds: ["orbits"] } },
	{ id: "build2", mode: "build", text: "On the Moon, drop a geologist's hammer and a ping-pong ball from the same height at the same time, like Apollo 15. They should land together.", expect: { types: ["rock-hammer"], settings: { gravity: "moon", air: false }, kinds: ["lands_together"] } },
	{ id: "build3", mode: "build", text: "Newton's cannon: three cannonballs fired sideways from just above the top of the Earth: one too slow so it falls back to Earth, one at orbit speed so it goes all the way around, and one fast enough to escape.", expect: { types: ["planet", "satellite"], kinds: ["falls_in", "orbits", "escapes"] } },
	{ id: "build4", mode: "build", text: "Show how a 1 m stick's shadow changes from 8 in the morning to 4 in the afternoon on the March equinox in Austin, Texas, an hour every second. Its shadow should be shortest at noon, about 0.58 m.", expect: { types: ["gnomon"], kinds: ["shadow_length"] } },
	{ id: "edit1", mode: "edit", base: "earthMoon", text: "Make the Moon go around the other way.", expect: { change: { id: "moon", key: "direction", value: "clockwise" } } },
	{ id: "edit2", mode: "edit", base: "moonDrop", text: "Do the same drop on Mars instead.", expect: { settings: { gravity: "mars" } } },
	{ id: "edit3", mode: "edit", base: "earthMoon", text: "Make the Earth half as heavy.", expect: { change: { id: "earth", key: "mass_scale", value: 0.5 }, breaks: true } },
	{ id: "edit4", mode: "edit", base: "cannon", text: "Fire the cannonball at only 0.8 times orbit speed.", expect: { change: { id: "ball", key: "orbit_factor", value: 0.8 }, breaks: true } },
	// (2026-10-20) the classroom models, eclipses and seasons
	{ id: "build5", mode: "build", text: "Show day and night: a classroom globe spinning under a desk lamp, with a town that goes from night into day and back.", expect: { types: ["globe", "lamp"], kinds: ["day_night"] } },
	{ id: "build6", mode: "build", text: "Show the phases of the Moon with a white foam ball on a stick carried around a globe under a lamp, from new moon round to full moon and back.", expect: { types: ["globe", "moon-ball"], kinds: ["phase"] } },
	{ id: "build7", mode: "build", text: "Show with the real Sun, Earth and Moon why there isn't an eclipse every month: the Moon goes round once with no solar and no lunar eclipse.", expect: { types: ["planet", "moon"], kindsAny: ["eclipse", "solar_eclipse", "lunar_eclipse"] } },
	{ id: "build8", mode: "build", text: "Show the Earth going around the Sun with its tilted axis, so the noon Sun in Austin is highest at the June solstice and lowest in December.", expect: { types: ["sun", "planet"], kinds: ["noon_sun"] } },
	{ id: "edit5", mode: "edit", base: "globe", text: "Start the town at noon instead.", expect: { change: { id: "globe", key: "start_hour", value: 12 } } },
	// (a slower trip moves the full moon later: the AI may move the goal's time with it and say so, or keep it and offer a checked fix)
	{ id: "edit6", mode: "edit", base: "moonBall", text: "Carry the ball round in 20 seconds instead of 12.", expect: { change: { id: "ball", key: "period_s", value: 20 }, breaks: true, mayAdapt: true } },
	// (a day now takes 60 s, longer than the 20 s run: no setting of the scene's things brings a whole day back, the run's length would: the card must
	// say so honestly; the AI may lengthen the run itself)
	{ id: "edit7", mode: "edit", base: "globe", text: "Spin the globe at only 1 turn a minute.", expect: { change: { id: "globe", key: "spin_rpm", value: 1 }, breaks: true, mayAdapt: true, honestOnly: true } },
	// (twice as fast: the town is at sunset by 2.5 s; the module's aim starts it at midnight so its noon is at 2.5 s again)
	{ id: "edit8", mode: "edit", base: "globeNoon", text: "Spin the globe at 12 turns a minute.", expect: { change: { id: "globe", key: "spin_rpm", value: 12 }, breaks: true, mayAdapt: true } }
]

async function runCase(c) {
	const t0 = Date.now()
	const rec = { id: c.id, mode: c.mode, text: c.text, at: new Date().toISOString() }
	const events = []
	const onEvent = (e) => events.push({ ms: Date.now() - t0, type: e?.type, step: e?.step ?? null, text: typeof e?.text === "string" ? e.text.slice(0, 300) : null })
	try {
		let req
		let before = null
		if (c.mode === "edit") {
			before = clone(BASES[c.base])
			req = { text: c.text, mode: "edit", scene: before, history: [] }
		} else req = { text: c.text }
		const job = orch.build(req, { onEvent })
		const rep = await job.result
		rec.ms = Date.now() - t0
		const scene = rep.scene ?? (before ? clone(before) : null)
		rec.scene = scene
		rec.report = {
			title: rep.title ?? null, goals: rep.goals ?? null, stages: rep.stages ?? null, missing: rep.missing ?? null, issues: rep.issues ?? null,
			lead: rep.lead ?? rep.edit?.lead ?? null, reply: rep.reply ?? rep.edit?.reply ?? null, changes: rep.changes ?? rep.edit?.changes ?? null,
			fix: rep.fix ?? rep.edit?.fix ?? null, tune: rep.tune ?? null, refine: (rep.refine ?? []).map((r) => ({ score: r.score ?? r.score_0_10 ?? null, issues: r.issues ?? null })),
			calls: (rep.calls ?? []).map((x) => ({ step: x.step, model: x.model, ms: x.ms, usd: x.usage?.costInUSD ?? null }))
		}
		rec.reportKeys = Object.keys(rep)
		// an edit that stopped a goal: the panel runs the make-it-work search on the change it put on the table (report.fixCtx) and offers
		// what it found, checked in the engine (web/ai/panel.js startFixSearch); the physics search alone first (the module's knobs and the
		// generic moves), then with the AI's reworks as the panel allows them
		if (rep.fixNeeded && rep.fixCtx) {
			const job2 = { text: c.text, history: [], plan: rep.plan ?? null, keep: rep.edit?.touched ?? null, hard: rep.edit?.hard ?? null }
			let fx = await orch.makeItWork(rep.fixCtx, { ai: false, job: job2 })
			rec.fixSearch = { how: "physics", status: fx.status, info: fx.info ?? null }
			if (fx.status !== "found") {
				fx = await orch.makeItWork(rep.fixCtx, { ai: true, job: job2 })
				rec.fixSearch = { how: "physics+ai", status: fx.status, info: fx.info ?? null }
			}
			rec.report.fix = fx.info ?? null
		}
		// the verdict, on a fresh run of the final scene
		const sim = scene ? await simulate(scene) : null
		const goals = sim?.summary?.goals ?? []
		const kinds = (scene?.goals ?? []).map((g) => g.kind)
		const types = new Set((scene?.items ?? []).map((i) => i.type))
		const v = { goalsMet: goals.length > 0 && goals.every((g) => g.ok), goals: goals.map((g) => ({ label: g.label, ok: g.ok, kind: g.kind })) }
		if (c.expect.types) v.types = c.expect.types.every((t) => types.has(t))
		if (c.expect.kinds) v.kinds = c.expect.kinds.every((k) => kinds.includes(k))
		if (c.expect.kindsAny) v.kinds = c.expect.kindsAny.some((k) => kinds.includes(k))
		if (c.expect.settings) v.settings = Object.entries(c.expect.settings).every(([k, val]) => scene?.settings?.[k] === val)
		if (c.mode === "edit") {
			rec.diff = ORCH.describeDiff(before, scene)
			if (c.expect.change) {
				const it = scene?.items?.find((i) => i.id === c.expect.change.id)
				const val = it?.props?.[c.expect.change.key]
				v.change = typeof c.expect.change.value === "number" ? Math.abs(Number(val) - c.expect.change.value) < 1e-9 : val === c.expect.change.value
			}
			// nothing else changed: every other item where it was, with the same props
			const others = (before?.items ?? []).filter((i) => i.id !== c.expect.change?.id)
			v.othersKept = others.every((o) => {
				const n = scene?.items?.find((i) => i.id === o.id)
				return n && Math.abs((n.x ?? 0) - (o.x ?? 0)) < 1e-6 && Math.abs((n.y ?? 0) - (o.y ?? 0)) < 1e-6 && JSON.stringify(n.props ?? {}) === JSON.stringify(o.props ?? {})
			})
			if (c.expect.breaks && c.expect.mayAdapt && v.goalsMet && v.change !== false) {
				// (the change kept and every goal met: the edit's answer adapted the scene itself, said in the card's change lines, or the goal still holds)
				rec.adapted = Array.isArray(rec.diff) && rec.diff.length > 1
				v.goalsHold = true
			} else if (c.expect.breaks && c.expect.honestOnly) {
				// (a break no fix of the scene's things can mend in the run's time: the card says it honestly)
				v.fixOffered = rec.report.fix?.state === "found" ? true : undefined
				v.honest = /fall|no longer|fails|doesn.t|does not|instead|longer than|: no ✗|✗/i.test(`${rec.report.lead ?? ""} ${rec.report.reply ?? ""}`)
			} else if (c.expect.breaks) {
				// the edit broke the stated goal: the card must say so honestly and offer a checked fix (a fix the search ran and saw work)
				const fix = rec.report.fix
				v.fixOffered = fix?.state === "found"
				v.honest = /fall|no longer|fails|doesn.t|does not|instead|: no ✗|✗/i.test(`${rec.report.lead ?? ""} ${rec.report.reply ?? ""}`)
				// the offered fix, run again here: every goal met, and the change the person asked for kept
				const fscene = fix?.sceneJSON ? JSON.parse(fix.sceneJSON) : null
				if (fix?.state === "found" && fscene) {
					rec.fixScene = fscene
					const fsim = await simulate(fscene)
					v.fixWorks = (fsim.summary?.goals ?? []).every((g) => g.ok)
					const fit = fscene.items?.find((i) => i.id === c.expect.change?.id)
					v.fixKeepsChange = c.expect.change ? Math.abs(Number(fit?.props?.[c.expect.change.key]) - c.expect.change.value) < 1e-9 : true
				}
			}
		}
		rec.verdict = v
		rec.pass = Object.entries(v).filter(([k]) => !["goals", "goalsMet"].includes(k) || k === "goalsMet").every(([k, val]) => (k === "goalsMet" && c.expect.breaks ? true : val !== false))
	} catch (e) {
		rec.ms = Date.now() - t0
		rec.error = String(e?.stack ?? e).slice(0, 2000)
		rec.pass = false
	}
	rec.events = events.slice(-60)
	writeFileSync(join(OUT, `${c.id}.json`), JSON.stringify(rec, null, 1))
	console.log(`${rec.pass ? "PASS" : "FAIL"} ${c.id} (${Math.round((rec.ms ?? 0) / 1000)} s) ${JSON.stringify(rec.verdict ?? rec.error?.slice(0, 300))}`)
	return rec
}

const todo = CASES.filter((c) => !ONLY || ONLY.includes(c.id))
const results = []
for (let i = 0; i < todo.length; i += JOBS) results.push(...(await Promise.all(todo.slice(i, i + JOBS).map(runCase))))
const pass = results.filter((r) => r.pass).length
writeFileSync(join(OUT, "summary.json"), JSON.stringify({ pass, of: results.length, cases: results.map((r) => ({ id: r.id, pass: r.pass, ms: r.ms, verdict: r.verdict ?? null, error: r.error?.slice(0, 300) ?? null })) }, null, 1))
console.log(`${pass} of ${results.length} passed`)
