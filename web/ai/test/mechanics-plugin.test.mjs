// The mechanics module's AI plug-ins (web/sim/modules/mechanics.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (a plan's
// fields, the summary, the AI's own check), knobs, how-to, prompt lines and worked examples, the edit digest's lines (a lever's balance, a gear
// train's speeds, a cart's mass, a loop's least height) and its change words; its goal kinds' summaries Python == JavaScript on real runs; the
// catalog-wide props (color, glow, start_speed, start_dir, start_spin) listed for every type but kept out of the catalog digest's per-type lines;
// and the make-it-work search finding a checked fix through the module's knobs.   node --test web/ai/test/mechanics-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "fracture,magnetism,mechanics"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const goals = await import(pathToFileURL(join(PG, "web/ai/goals.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_mechanics")

const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 2, extra = {}) => ({ version: 2, id: "t", name: "t", seconds, release: 0.0, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals, ...extra })
const run = (s) => {
	const p = sim.prepare(JSON.parse(JSON.stringify(s)))
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: fin.resolved ?? p.resolved }
}
const lever = (effort, goals = []) => scene([{ id: "lever", type: "lever-kit", name: "Lever", x: 1.3, y: 0.6, props: { class: "1", load: 0.5, load_at: 0.2, effort, effort_at: 0.4 } }], goals, 2)

test("the module is registered with its goal kinds, knobs, how-to, prompt lines and examples, and replaces no other module's goal", () => {
	assert.ok(mod, "mod_mechanics is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), ["accelerates", "balanced", "energy_kept", "energy_to_heat", "gear_speed", "loops", "net_force", "pulls_with", "recoils", "rises"])
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function" && typeof g.label === "function", g.kind)
	for (const t of ["lever-kit", "wheel-and-axle", "block-and-tackle", "gear-train", "coaster-track", "ramp", "dynamics-cart", "edge-pulley", "toy-car", "screw-jack", "puller"]) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const t of ["lever-kit", "gear-train"]) for (const k of plugins.knobsFor(t)) assert.ok(k.why && k.more && k.less, `${t}.${k.key}`)
	// the other modules keep their own goals: an egg's breaks (fracture), sticks (magnetism)
	assert.equal(plugins.goalKind("breaks")?.module, "mod_fracture")
	assert.equal(plugins.goalKind("sticks")?.module, "mod_magnetism")
	assert.equal(plugins.goalKind("pushes_apart")?.module, "mod_magnetism", "the magnets' alias is not taken")
	assert.equal(plugins.goalKind("action_reaction")?.kind, "recoils", "an alias")
	assert.equal(plugins.goalKind("gear_rpm")?.kind, "gear_speed", "an alias")
	assert.match(mod.howto, /lever-kit/)
	assert.match(mod.howto, /start_speed/)
	assert.match(mod.howto, /screw-jack/)
	assert.match(mod.howto, /FORCE METERS/)
	assert.match(mod.howto, /FORCE ARROWS AND ENERGY BARS/)
	assert.match(plugins.goalKindLines(), /net_force \{item, at_most_n\?, at_least_n\?\}/)
	assert.match(plugins.goalKindLines(), /energy_to_heat \{item, at_least_pct\?\}/)
	assert.equal(plugins.goalKind("balanced_forces")?.kind, "net_force", "an alias")
	assert.equal(plugins.goalKind("conserves_energy")?.kind, "energy_kept", "an alias")
	assert.match(plugins.goalKindLines(), /pulls_with \{item, newtons, tol\?\}/)
	assert.match(plugins.promptSnippets("plan"), /Machines and motion/)
	assert.match(plugins.promptSnippets("edit"), /effort 0\.25 → 0\.3 kg/)
	assert.match(plugins.goalKindLines(), /gear_speed \{item, part\?, rpm\?, tol\?, direction\?\}/)
	assert.ok(mod.examples.length >= 10 && mod.examples.every((e) => e.ask && e.how))
	const keys = new Set(sim.catalog().types.map((t) => t.key))
	for (const e of mod.examples) for (const m of e.how.matchAll(/\b([a-z]+(?:-[a-z]+)+)\b/g)) if (/(kit|axle|tackle|train|track|cart|pulley|ramp|car|ball|marble|block|filters|rocket|egg)$/.test(m[1])) assert.ok(keys.has(m[1]), `${m[1]} in "${e.ask}"`)
})

test("catalog-wide props: every type lists them (common), with defaults; a scene that sets none builds as before", () => {
	const cat = sim.catalog()
	const car = cat.types.find((t) => t.key === "toy-car")
	for (const k of ["color", "glow", "start_speed", "start_dir", "start_spin"]) assert.ok(car.props.some((p) => p.key === k && p.common), k)
	const table = cat.types.find((t) => t.key === "table")
	assert.ok(table.props.some((p) => p.key === "color"), "a fixed type takes a colour")
	assert.ok(!table.props.some((p) => p.key === "start_speed"), "but no start speed")
	const a = sim.prepare(scene([{ id: "car", type: "toy-car", x: 1, y: 0.02 }]))
	const b = sim.prepare(scene([{ id: "car", type: "toy-car", x: 1, y: 0.02, props: { color: "none", start_speed: 0 } }]))
	assert.deepEqual(JSON.stringify(a.doc), JSON.stringify(b.doc), "the defaults change nothing")
	const c = sim.prepare(scene([{ id: "car", type: "toy-car", x: 1, y: 0.02, props: { start_speed: 1.5 } }]))
	assert.ok(c.doc.processes.some((p) => p.role === "start" && p.item === "car"), "a start record for a set start speed")
})

test("a plan's mechanics goals are checked by their fields", () => {
	const ids = new Set(["lever", "gears", "ball", "track", "a", "b", "cart"])
	assert.equal(plugins.goalProblem({ kind: "balanced", item: "lever" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "loops", item: "ball" }, ids), /needs track/)
	assert.match(plugins.goalProblem({ kind: "gear_speed", item: "gears", rpm: "fast" }, ids), /must be a number/)
	assert.match(plugins.goalProblem({ kind: "recoils", a: "a", b: "nobody" }, ids), /no item "nobody"/)
	assert.equal(plugins.goalProblem({ kind: "accelerates", item: "cart", accel: 0.89 }, ids), null)
	assert.match(plugins.goalProblem({ kind: "accelerates", item: "cart" }, ids), /needs accel/)
})

test("the summary and the AI's own check agree: a lever in balance and one that tips, a wheel and axle lifting, gears", () => {
	const r = run(
		scene(
			[
				{ id: "lever", type: "lever-kit", x: 0.6, y: 0.6, props: { class: "1", load: 0.5, load_at: 0.2, effort: 0.25, effort_at: 0.4 } },
				{ id: "tips", type: "lever-kit", x: 1.6, y: 0.6, props: { class: "1", load: 0.5, load_at: 0.2, effort: 0.3, effort_at: 0.4 } },
				{ id: "wa", type: "wheel-and-axle", x: 2.6, y: 1.5, props: { load: 1, effort: 0.4 } },
				{ id: "gears", type: "gear-train", x: 1.0, y: 1.6, props: { teeth_a: 12, teeth_b: 36, teeth_c: 20, rpm: 30 } }
			],
			[
				{ kind: "balanced", item: "lever" },
				{ kind: "balanced", item: "tips" },
				{ kind: "rises", item: "tips" },
				{ kind: "rises", item: "wa", min_m: 0.1 },
				{ kind: "gear_speed", item: "gears", rpm: 18, direction: "counter-clockwise" },
				{ kind: "gear_speed", item: "gears", part: "gear-b", rpm: 10, direction: "clockwise" },
				{ kind: "gear_speed", item: "gears", rpm: 30 }
			],
			3
		)
	)
	const want = [true, false, true, true, true, true, false]
	assert.deepEqual(r.summary.goals.map((g) => g.ok), want, JSON.stringify(r.summary.goals))
	for (const [i, g] of r.scene.goals.entries()) assert.equal(plugins.checkModuleGoal(g, { doc: r.doc, track: r.track, scene: r.scene }).ok, want[i], `checkModuleGoal ${g.kind}`)
	assert.deepEqual(goals.checkGoals(r.scene.goals, { doc: r.doc, track: r.track, summary: r.summary }).map((x) => x.ok), want)
})

test("the edit digest: a lever's balance, gear speeds, a cart's mass and momentum, a ramp's rise, a set start speed", () => {
	const r = run(
		scene(
			[
				{ id: "lever", type: "lever-kit", x: 0.6, y: 0.6, props: { load: 0.5, load_at: 0.2, effort: 0.3, effort_at: 0.4 } },
				{ id: "gears", type: "gear-train", x: 1.6, y: 1.6, props: { teeth_a: 12, teeth_b: 36, rpm: 30 } },
				{ id: "floor", type: "floor", x: 2.2, y: 0, props: { length: 1.5 } },
				{ id: "cart", type: "dynamics-cart", x: 2.0, y: 0, props: { load: 0.25, start_speed: 0.5 } },
				{ id: "ramp", type: "ramp", x: 0.9, y: 0, props: { blocks: 3 } }
			],
			[],
			1
		)
	)
	const it = (id) => r.scene.items.find((i) => i.id === id)
	const ll = mod.digest(it("lever"), r, {}).join(" | ")
	assert.match(ll, /class 1 lever: load 500 g at 20 cm from the fulcrum, effort 300 g at 40 cm/)
	assert.match(ll, /balances with 250 g of effort there/)
	assert.match(ll, /the beam turned \d+(\.\d)?° in the run/)
	const gl = mod.digest(it("gears"), r, {}).join(" | ")
	assert.match(gl, /gears of 12 : 36 teeth; the first \(the driver\) turns at 30 rpm counter-clockwise; the last turns 10 rpm/)
	assert.match(gl, /measured 10(\.0\d)? rpm clockwise/)
	const cl = mod.digest(it("cart"), r, {}).join(" | ")
	assert.match(cl, /total mass 500 g \(a 250 g cart with 250 g of bars\)/)
	assert.match(cl, /starts moving at 0\.5 m\/s at the release/)
	assert.match(mod.digest(it("ramp"), r, {}).join(" | "), /plank on 3 wooden blocks: rise 15 cm, slope \d/)
	assert.equal(mod.digest({ id: "x", type: "superball", props: {} }, r, {}), null)
})

test("change words in real units", () => {
	assert.equal(plugins.changeWords("lever-kit", "effort", 0.25, 0.3), "effort 250 g → 300 g")
	assert.equal(plugins.changeWords("lever-kit", "effort_at", 0.4, 0.45), "effort from the fulcrum 40 cm → 45 cm")
	assert.equal(plugins.changeWords("block-and-tackle", "strands", 2, 3), "2 → 3 rope strands, mechanical advantage 2 → 3")
	assert.equal(plugins.changeWords("gear-train", "teeth_b", 36, 24), "second gear 36 → 24 teeth")
	assert.equal(plugins.changeWords("ramp", "blocks", 1, 3), "ramp on 1 → 3 blocks, rise 5 cm → 15 cm")
	assert.equal(plugins.changeWords("dynamics-cart", "load", 0, 0.5), "bars on the cart 0 g → 500 g, the cart 250 g → 750 g in all")
	assert.equal(plugins.changeWords("toy-car", "start_speed", 0, 1.2), "start speed 0 → 1.2 m/s")
	assert.equal(plugins.changeWords("truck", "color", "red", "blue"), "colour red → blue")
	assert.equal(plugins.changeWords("coaster-track", "height", 0.4, 0.5), "start height 40 cm → 50 cm")
	assert.equal(plugins.changeWords("superball", "diameter", 0.06, 0.08), null)
	assert.equal(plugins.changeWords("screw-jack", "pitch", 5, 2.5), "thread pitch 5 → 2.5 mm a turn")
	assert.equal(plugins.changeWords("screw-jack", "handle", 0.2, 0.3), "handle 20 cm → 30 cm")
	assert.equal(plugins.changeWords("screw-jack", "effort", 10, 20), "push on the handle 10 → 20 N")
	assert.equal(plugins.changeWords("screw-jack", "load", 20, 50), "load 20 kg → 50 kg")
	assert.equal(plugins.changeWords("puller", "speed", 0.1, 0.2), "reels in at 0.1 → 0.2 m/s")
})

test("every goal kind: Python's summary (machines/mod_mechanics.py) == web/sim's on a real run", () => {
	const h = 0.6
	const s = scene(
		[
			{ id: "lever", type: "lever-kit", x: 0.4, y: 1.3, props: { load: 0.5, load_at: 0.2, effort: 0.25, effort_at: 0.4 } },
			{ id: "bt", type: "block-and-tackle", x: 2.8, y: 1.8, props: { strands: 3, load: 1, effort: 0.5 } },
			{ id: "gears", type: "gear-train", x: 1.6, y: 1.9, props: { teeth_a: 12, teeth_b: 36, teeth_c: 20, rpm: 30 } },
			{ id: "track", type: "coaster-track", x: -0.45, y: 0, props: { layout: "loop", height: h, size: 0.15 } },
			{ id: "ball", type: "steel-ball", x: -0.42, y: h - 0.03 * Math.tan((2 * Math.PI) / 180) + 0.0127 + 0.0006 },
			{ id: "a", type: "dynamics-cart", x: 2.2 - 0.086, y: 0, props: { plunger: 3 } },
			{ id: "b", type: "dynamics-cart", x: 2.2 + 0.086, y: 0, props: { load: 0.25 } }
		],
		[
			{ kind: "balanced", item: "lever" }, { kind: "balanced", item: "gears", label: "the gears hold still" }, { kind: "rises", item: "bt" }, { kind: "rises", item: "lever", min_m: 0.2 },
			{ kind: "gear_speed", item: "gears", rpm: 18, direction: "counter-clockwise" }, { kind: "gear_speed", item: "gears", part: "gear-a" }, { kind: "loops", item: "ball", track: "track" },
			{ kind: "recoils", a: "a", b: "b", ratio: 2 }, { kind: "recoils", a: "a", b: "b" }, { kind: "accelerates", item: "b", accel: 1 }, { kind: "balanced", item: "nobody" }
		],
		3
	)
	const js = run(s)
	const py = JSON.parse(
		execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'machines'); import items; r = json.load(sys.stdin); print(json.dumps(items.summarize(r['scene'], r['doc'], r['track'])))"], {
			cwd: PG,
			input: JSON.stringify({ scene: js.scene, doc: js.doc, track: js.track }),
			env: { ...process.env, PLAYGROUND_MODULES: "fracture,magnetism,mechanics" },
			maxBuffer: 1 << 28
		}).toString()
	)
	assert.equal(JSON.stringify(py.goals), JSON.stringify(js.summary.goals))
	assert.deepEqual(py.happenings, js.summary.happenings)
	assert.equal(js.summary.goals.length, 10, "the goal on a missing item is left out")
	assert.deepEqual(js.summary.goals.map((g) => g.ok).slice(0, 8), [true, false, true, false, true, true, true, true])
})

test("make it work: a lever that tips is balanced again through the module's knobs, found and checked", async () => {
	const s = lever(0.27, [{ kind: "balanced", item: "lever", label: "The lever stays balanced" }])
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "0.27 kg at 40 cm tips a 0.5 kg load at 20 cm")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 90000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 600))
	const words = JSON.stringify(fr.fix ?? fr)
	assert.match(words, /effort|load|fulcrum|lever/i, words.slice(0, 400))
})

test("a screw jack lifts a load its push can lift, not a heavier one; its digest says so; the summary, the AI's check and Python agree", () => {
	const s = scene(
		[
			{ id: "light", type: "screw-jack", name: "Jack 1", x: 0.6, y: 0, props: { load: 20 } },
			{ id: "heavy", type: "screw-jack", name: "Jack 2", x: 2.0, y: 0, props: { load: 100 } }
		],
		[{ kind: "rises", item: "light" }, { kind: "rises", item: "heavy" }, { kind: "rises", item: "light", min_m: 0.05 }],
		3
	)
	const r = run(s)
	const want = [true, false, false]
	assert.deepEqual(r.summary.goals.map((g) => g.ok), want, JSON.stringify(r.summary.goals))
	assert.deepEqual(goals.checkGoals(r.scene.goals, { doc: r.doc, track: r.track, summary: r.summary }).map((x) => x.ok), want)
	assert.ok(r.track.state.light.lift.at(-1) > 0.01 && r.track.state.heavy.lift.at(-1) < 0.002, "its lift reading")
	const it = (id) => r.scene.items.find((i) => i.id === id)
	const dl = mod.digest(it("light"), r, {}).join(" | ")
	assert.match(dl, /ideal mechanical advantage 2π·L\/pitch = 251/)
	assert.match(dl, /a 10 N push lifts up to 754 N/)
	assert.match(dl, /it lifts, 5 mm\/s/)
	assert.match(mod.digest(it("heavy"), r, {}).join(" | "), /TOO HEAVY/)
	const py = JSON.parse(
		execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'machines'); import items; r = json.load(sys.stdin); print(json.dumps(items.summarize(r['scene'], r['doc'], r['track'])))"], {
			cwd: PG, input: JSON.stringify({ scene: r.scene, doc: r.doc, track: r.track }), env: { ...process.env, PLAYGROUND_MODULES: "fracture,magnetism,mechanics" }, maxBuffer: 1 << 28
		}).toString()
	)
	assert.equal(JSON.stringify(py.goals), JSON.stringify(r.summary.goals))
})

test("force meters: an edge pulley's string pull and a winch's cord pull read in the run; pulls_with checks the steady reading, in Python too", () => {
	const s = scene(
		[
			{ id: "cart", type: "dynamics-cart", x: 0.1, y: 0.0005, props: { load: 0.25 } },
			{ id: "pulley", type: "edge-pulley", name: "Pulley", x: 3.19, y: 0.016, props: { pulls: "cart", hanging_mass: 0.05, drop: 0.1 } },
			{ id: "cart2", type: "dynamics-cart", x: 0.4, y: 0.0005, props: { load: 0.75 } },
			{ id: "winch", type: "puller", name: "Winch", x: 2.0, y: 0, props: { pulls: "cart2", faces: "left", force: 2 } }
		],
		[{ kind: "pulls_with", item: "pulley", newtons: 0.45 }, { kind: "pulls_with", item: "pulley", newtons: 0.6 }, { kind: "pulls_with", item: "winch", newtons: 2 }, { kind: "accelerates", item: "cart", accel: 0.85 }],
		1.2
	)
	const r = run(s)
	const want = [true, false, true, true]
	assert.deepEqual(r.summary.goals.map((g) => g.ok), want, JSON.stringify(r.summary.goals))
	assert.deepEqual(goals.checkGoals(r.scene.goals, { doc: r.doc, track: r.track, summary: r.summary }).map((x) => x.ok), want)
	const it = (id) => r.scene.items.find((i) => i.id === id)
	assert.match(mod.digest(it("pulley"), r, {}).join(" | "), /its force sensor read 0\.44\d N/)
	assert.match(mod.digest(it("winch"), r, {}).join(" | "), /its force meter read 1\.99 N while it pulled/)
	assert.ok(Math.abs(r.track.state.cart.accel.at(-1) - 0.85) < 0.02, `the cart's own acceleration reading ${r.track.state.cart.accel.at(-1)}`)
	const py = JSON.parse(
		execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'machines'); import items; r = json.load(sys.stdin); print(json.dumps(items.summarize(r['scene'], r['doc'], r['track'])))"], {
			cwd: PG, input: JSON.stringify({ scene: r.scene, doc: r.doc, track: r.track }), env: { ...process.env, PLAYGROUND_MODULES: "fracture,magnetism,mechanics" }, maxBuffer: 1 << 28
		}).toString()
	)
	assert.equal(JSON.stringify(py.goals), JSON.stringify(r.summary.goals))
	assert.equal(plugins.goalKind("force_reads")?.kind, "pulls_with", "an alias")
})

test("make it work: a screw jack loaded past what its push lifts is fixed through its knobs (a harder push, a longer handle, a finer thread), checked", async () => {
	const s = scene([{ id: "jack", type: "screw-jack", name: "Jack", x: 1.3, y: 0, props: { load: 100 } }], [{ kind: "rises", item: "jack", label: "The jack lifts the load" }], 3)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "10 N on a 20 cm handle does not lift 100 kg")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate: async (sc) => run(sc), budgetMs: 90000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 600))
	assert.match(JSON.stringify(fr.fix ?? fr), /push|handle|thread|load/i)
})

const pySummary = (r) =>
	JSON.parse(
		execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'machines'); import items; r = json.load(sys.stdin); print(json.dumps(items.summarize(r['scene'], r['doc'], r['track'])))"], {
			cwd: PG, input: JSON.stringify({ scene: r.scene, doc: r.doc, track: r.track }), env: { ...process.env, PLAYGROUND_MODULES: "fracture,magnetism,mechanics" }, maxBuffer: 1 << 28
		}).toString()
	)
const tug = (right, extra = {}) =>
	scene(
		[
			{ id: "cart", type: "dynamics-cart", name: "Cart", x: 1.3, y: 0.0005, props: { load: 0.75, arrows: "tension+net", ...extra } },
			{ id: "left", type: "puller", name: "Left winch", x: 0.3, y: 0, props: { pulls: "cart", faces: "right", force: 5 } },
			{ id: "right", type: "puller", name: "Right winch", x: 2.3, y: 0, props: { pulls: "cart", faces: "left", force: right } }
		],
		[{ kind: "net_force", item: "cart", label: "The pulls on the cart balance" }],
		1.5
	)

test("force arrows: records only when asked; a book's gravity and support equal and opposite; a tug of war's two pulls, each its own, and the net", () => {
	const plain = sim.prepare(scene([{ id: "book", type: "hardcover-book", x: 1.3, y: 0 }]))
	assert.ok(!(plain.doc.processes ?? []).some((p) => p.role === "forces" || p.role === "energy"), "no arrows, no records")
	const none = sim.prepare(scene([{ id: "book", type: "hardcover-book", x: 1.3, y: 0, props: { arrows: "none", show_energy: false, arrow_scale: 0 } }]))
	assert.equal(JSON.stringify(none.doc), JSON.stringify(plain.doc), "the defaults change nothing")
	const r = run(scene([{ id: "book", type: "hardcover-book", name: "Book", x: 1.3, y: 0, props: { arrows: "gravity+support" } }], [{ kind: "net_force", item: "book" }], 1))
	const rec = r.doc.processes.find((p) => p.role === "forces")
	assert.deepEqual(rec.show, ["gravity", "support"])
	const st = r.track.state.book
	const g = st.f_gravity_y.at(-1)
	const up = st.f_support_y.at(-1) + st.f_buoyancy_y.at(-1)
	assert.ok(g < -6 && Math.abs(up + g) <= 0.01 * Math.abs(g), `support ${up} against gravity ${g} (K12: within 1 %)`)
	assert.ok(Math.abs(st.f_support_py.at(-1)) < 0.003, "support acts where the book meets the table top (y 0)")
	assert.equal(r.summary.goals[0].ok, true, JSON.stringify(r.summary.goals[0]))
	// a tug of war: 5 N against 3 N
	const t = run(tug(3))
	const ts = t.track.state.cart
	const n = ts.f_net_x.length - 1
	const pulls = [ts.f_tension1_x[n], ts.f_tension2_x[n]].sort((a, b) => a - b)
	assert.ok(Math.abs(pulls[0] + 5) < 0.1 && Math.abs(pulls[1] - 3) < 0.05, `each pull its own arrow: ${pulls}`)
	assert.ok(Math.abs(ts.f_net_x[n] - (ts.f_tension_x[n] + ts.f_friction_x[n] + ts.f_air_x[n])) < 1e-4, "net = the pulls' sum + friction + air")
	assert.ok(ts.f_net_x[n] < -1.8 && ts.f_net_x[n] > -2, `net ${ts.f_net_x[n]}: 2 N less rolling friction, toward the 5 N`)
	assert.equal(t.summary.goals[0].ok, false)
	assert.equal(run(tug(5)).summary.goals[0].ok, true, "equal pulls balance")
	assert.deepEqual(goals.checkGoals(t.scene.goals, { doc: t.doc, track: t.track, summary: t.summary }).map((x) => x.ok), [false])
	assert.equal(JSON.stringify(pySummary(t).goals), JSON.stringify(t.summary.goals))
	const dl = mod.digest(t.scene.items.find((i) => i.id === "cart"), t, {}).join(" | ")
	assert.match(dl, /forces on it \(N, from the run; its arrows show tension, net\)/)
	assert.match(dl, /pull of a rope \d\.\d+ N left/)
	assert.match(dl, /net 1\.\d+ N left/)
	assert.match(dl, /2 ropes or springs pull it/)
})

test("energy bars: a pendulum in a vacuum keeps its energy (K11), a block sliding to a stop turns it to heat; Python == JS; the digest says it in joules", () => {
	const p = run(scene([{ id: "pend", type: "pendulum", name: "Pendulum", x: 1.3, y: 1.5, props: { show_energy: true } }], [{ kind: "energy_kept", item: "pend", tol: 0.005 }, { kind: "energy_to_heat", item: "pend", at_least_pct: 1 }], 3, { settings: { air: false } }))
	const st = p.track.state.pend
	const low = Math.min(...st.e_potential)
	const swing = st.e_potential[0] - low
	let spread = 0
	for (let k = 0; k < st.e_kinetic.length; k++) spread = Math.max(spread, Math.abs(st.e_kinetic[k] + st.e_potential[k] + st.e_spring[k] - st.e_potential[0]))
	assert.ok(swing > 0.3 && spread <= 0.005 * swing, `KE + PE within 0.5 %: ${spread} of ${swing} J`)
	assert.deepEqual(p.summary.goals.map((g) => g.ok), [true, false])
	assert.equal(JSON.stringify(pySummary(p).goals), JSON.stringify(p.summary.goals))
	// a block slid along the table at 1 m/s: friction (μ 0.45) stops it within 12 cm, all its kinetic energy turned to heat
	const b = run(
		scene(
			[
				{ id: "ball", type: "wooden-block", name: "Block", x: 0.6, y: 0.0255, props: { start_speed: 1 } },
				{ id: "bars", type: "energy-bars", x: 2.2, y: 0.4, props: { watch: "ball" } }
			],
			[{ kind: "energy_to_heat", item: "ball", at_least_pct: 90 }, { kind: "energy_kept", item: "ball" }],
			1.5
		)
	)
	assert.ok(b.doc.processes.some((q) => q.role === "energy" && q.item === "ball" && q.bars === false), "the board's thing gets an energy record (no small bars)")
	const bs = b.track.state.ball
	const n = bs.e_kinetic.length - 1
	assert.ok(Math.min(...bs.e_heat) >= 0 && Math.min(...bs.e_added) >= 0, "never below 0")
	const books = (k) => bs.e_kinetic[k] + bs.e_potential[k] + bs.e_spring[k] + bs.e_heat[k] - bs.e_added[k]
	for (let k = 1; k <= n; k++) assert.ok(Math.abs(books(k) - books(1)) < 1e-4, `the bookkeeping balances at frame ${k}: start = the energies + heat − what was put in`)
	assert.ok(bs.e_kinetic[n] < 1e-6 && bs.e_heat[n] > 0.9 * bs.e_heat.reduce((a, v) => Math.max(a, v), 0), "it stopped: its energy is heat")
	assert.deepEqual(b.summary.goals.map((g) => g.ok), [true, false], JSON.stringify(b.summary.goals))
	assert.equal(JSON.stringify(pySummary(b).goals), JSON.stringify(b.summary.goals))
	const el = mod.digest(b.scene.items.find((i) => i.id === "ball"), b, {}).join(" | ")
	assert.match(el, /energy \(J; potential counted from the lowest point it reaches\): just after the release kinetic 0\.0\d+ J/)
	assert.match(el, /heat and sound 0\.\d+ J \(\d+(\.\d)? % of the/)
	assert.match(mod.digest(b.scene.items.find((i) => i.id === "bars"), b, {}).join(" | "), /shows the energy of ball/)
})

test("arrows' words: the AI's checks take any join of them; change words", async () => {
	const schemas = await import(pathToFileURL(join(PG, "ai/schemas.mjs")).href)
	const spec = sim.catalog().types.find((t) => t.key === "toy-car").props.find((p) => p.key === "arrows")
	assert.ok(spec.common && spec.open, "a catalog-wide open choice")
	assert.deepEqual(schemas.checkProp(spec, "gravity+support+net", "p"), ["gravity+support+net", null])
	assert.deepEqual(schemas.checkProp(spec, "Friction, Air", "p"), ["friction+air", null])
	assert.ok(schemas.checkProp(spec, "gravity+wobble", "p")[1], "a word no arrow has is refused")
	const color = sim.catalog().types.find((t) => t.key === "toy-car").props.find((p) => p.key === "color")
	assert.ok(schemas.checkProp(color, "red+blue", "p")[1], "a colour is not a join")
	assert.equal(plugins.changeWords("hardcover-book", "arrows", "none", "all"), "force arrows none → all")
	assert.equal(plugins.changeWords("toy-car", "show_energy", false, true), "energy bars off → on")
	assert.equal(plugins.changeWords("toy-car", "arrow_scale", 0, 0.02), "arrow length auto → 2 cm per N")
	assert.equal(plugins.changeWords("energy-bars", "zero", "lowest", "floor"), "potential energy counted from its lowest point → the floor")
})

test("make it work: an unbalanced tug of war is balanced through the pullers' force, found and checked", async () => {
	const R = run(tug(3))
	assert.equal(R.summary.goals[0].ok, false)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate: async (sc) => run(sc), budgetMs: 90000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 600))
	assert.match(JSON.stringify(fr.fix ?? fr), /force|pull/i)
})
