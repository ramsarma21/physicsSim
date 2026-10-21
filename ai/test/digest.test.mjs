// ai/catalog-digest.mjs and ai/scene-digest.mjs: complete, sized, cached; scenes read back with true outlines and supports.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"
import { detailFor, digestFromCatalog, getCatalog, promptCatalog, simFingerprint, _resetMemo } from "../catalog-digest.mjs"
import { sceneDigest, simText } from "../scene-digest.mjs"

const PG = new URL("../../", import.meta.url)
const scenario = (id) => JSON.parse(readFileSync(new URL(`web/scenarios/${id}.json`, PG), "utf8"))

test("the digest lists every catalog type with its props, ranges, anchor and outline", async () => {
	const sim = await import(new URL("web/sim/index.js", PG).href)
	const raw = sim.catalog()
	const d = digestFromCatalog(raw)
	assert.equal(d.stats.types, raw.types.length)
	assert.ok(raw.types.length >= 100)
	for (const t of raw.types) {
		assert.ok(d.text.includes(`### ${t.key} — `), `${t.key} is in the digest`)
		assert.ok(d.brief.includes(`- ${t.key} (`), `${t.key} is in the brief list`)
		const T = d.index.types[t.key]
		for (const p of t.props) {
			assert.ok(T.props[p.key], `${t.key}.${p.key} indexed`)
			if (p.min !== undefined) assert.equal(T.props[p.key].min, p.min)
			if (p.max !== undefined) assert.equal(T.props[p.key].max, p.max)
		}
		// (a module's type that builds no solid, a circuit's wire or its upright board, is only drawn: it has no outline)
		if (t.preview?.solids?.length) assert.ok(T.outline, `${t.key} has an outline`)
	}
	// the facts a planner needs are there
	assert.match(d.text, /### box — Open box · static[\s\S]*?goal container/)
	// (a plastic cup, a glass jar, a coffee mug: their "in" goals are judged by their own walls: ai/goals.mjs wallsInside, 16 Oct)
	assert.match(d.text, /### plastic-cup[\s\S]*?goal container \("in" goals work: judged by its own walls/)
	assert.match(d.text, /### superball[\s\S]*?Outline at defaults: 0\.06 × 0\.06 m, centred on the anchor/)
	assert.match(d.text, /### seesaw[\s\S]*?does not fall/)
	assert.match(d.text, /### spring-launcher[\s\S]*?acts at the scene's release time/)
	// size: the full digest is what plan/edit carry; the brief one what refine carries
	// (what the plan and edit prompts carry: the whole digest, or with many physics modules' types its core tier, ai/catalog-digest.mjs promptCatalog)
	assert.ok(d.stats.promptChars < 110000, `the prompts' digest ${d.stats.promptChars} chars (the whole: ${d.stats.chars})`)
	// (one line per type: a physics module's types add theirs)
	const moduleTypes = Object.values(d.index.types).filter((T) => T.module).length
	assert.ok(d.stats.briefChars < 16000 + 120 * moduleTypes, `brief digest ${d.stats.briefChars} chars (${moduleTypes} module types)`)
})

test("detailFor gives full detail for just the named types (unknown ones skipped, no repeats)", async () => {
	const cat = await getCatalog()
	const t = detailFor(cat, ["superball", "nope", "plank", "superball"])
	assert.equal((t.match(/^### /gm) ?? []).length, 2)
})

test("the cache: written once, then reused while web/sim is unchanged", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ai-digest-"))
	try {
		const url = new URL("../catalog-digest.mjs", import.meta.url).href + `?cache-test=${Date.now()}`
		process.env.AI_CACHE_DIR = dir
		const m = await import(url)
		const a = await m.getCatalog()
		assert.ok(existsSync(join(dir, "catalog-digest.json")))
		m._resetMemo()
		const b = await m.getCatalog()
		assert.equal(b.builtAt, a.builtAt, "read back from the cache file")
		const c = await m.getCatalog({ rebuild: true })
		assert.notEqual(c.builtAt, undefined)
	} finally {
		delete process.env.AI_CACHE_DIR
		rmSync(dir, { recursive: true, force: true })
	}
})

test("the committed digest (ai/.cache/catalog-digest.json) is web/sim's as it is in this commit (npm run digest:ai rebuilds it)", () => {
	// (its fingerprint is of the files' contents: a checkout of this commit reads it as it is and leaves it unchanged; before, keyed by the
	// files' times, every checkout rebuilt it and the tree showed it changed, and its text had fallen behind web/sim: milk did not yet mix)
	if (typeof process.env.PLAYGROUND_MODULES === "string") return // (a process with only some modules has a digest of its own)
	const committed = JSON.parse(readFileSync(new URL("../.cache/catalog-digest.json", import.meta.url), "utf8"))
	assert.equal(committed.fingerprint, simFingerprint(), "ai/.cache/catalog-digest.json is stale: run npm run digest:ai and commit it")
	assert.equal(committed.source, "web/sim")
})

test("a cup of grains in the request's words gives the planner the pitcher (the flow module) and the grains' heap (the granular module)", async () => {
	const cat = await getCatalog()
	if (!cat.tiers) return // (a catalog small enough to go whole into every prompt: nothing is picked)
	// (V2 release, 2026-10-21: "a hand tips a cup of salt" picked granular, hands and heat only, and the planner said the library had no tipping
	// pourer for grains and used a funnel of sand; "a cup of salt is tipped over a bowl" picked heat alone, "tip a cup of grains into a glass" waves)
	for (const text of [
		"A hand tips a cup of salt so it pours into a round glass jar on the table, and the salt piles up inside the jar.",
		"A hand tips a cup of sugar so it pours into a round glass jar on the table, and the sugar piles up inside the jar.",
		"A hand tips a cup of rice so it pours into a round glass jar on the table, and the rice piles up inside the jar.",
		"A cup of salt is tipped over a bowl.",
		"Tip a cup of grains into a glass.",
		"Pour flour from a cup into a bowl.",
		"Salt pours from a mug into a jar."
	]) {
		const picked = promptCatalog(cat, { text }).modules
		for (const m of ["mod_flow", "mod_granular"]) assert.ok(picked.includes(m), `${text}: picks ${m} (picked ${picked.join(", ")})`)
	}
	// (grains with no cup, tip or pour, and a cup with no grains, are not a cup of grains)
	assert.ok(!promptCatalog(cat, { text: "A ball rolls down a ramp into a cup" }).modules.includes("mod_granular"))
	assert.ok(!promptCatalog(cat, { text: "Salt on one of two ice cubes: which melts first?" }).modules.includes("mod_flow"))
})

test("scene digest: true outlines and what each item rests on (sloped supports too)", async () => {
	const cat = await getCatalog()
	const rg = await sceneDigest(scenario("rube-goldberg"), cat.index)
	const by = Object.fromEntries(rg.items.map((r) => [r.id, r]))
	assert.equal(by.ball2.rests_on, "seesaw")
	assert.equal(by.dominoes.rests_on, "table")
	assert.equal(by.ball1.rests_on, "nothing (in the air)")
	assert.equal(by.box.rests_on, "nothing (fixed in place)")
	assert.ok(Math.abs(by.ball1.box.y0 - 0.719) < 1e-6)
	assert.match(rg.text, /ball1 · superball "Ball 1" · dynamic, held until the release · \(0, 0\.749\)/)
	assert.match(rg.text, /Goals: "Ball 2 lands in the box" \(ball2 in box\)/)
	const car = await sceneDigest(scenario("car-ramp-dominoes"), cat.index)
	assert.equal(car.items.find((r) => r.id === "car").rests_on, "ramp")
	const wb = await sceneDigest(scenario("wrecking-ball"), cat.index)
	assert.equal(wb.items.find((r) => r.id === "brick3").rests_on, "brick2")
	const tr = await sceneDigest(scenario("trampoline"), cat.index)
	assert.equal(tr.items.find((r) => r.id === "trampoline").rests_on, "table")
})

test("scene digest of a scene the builder refuses still answers (with the reason)", async () => {
	const cat = await getCatalog()
	const d = await sceneDigest({ items: [{ id: "a/b", type: "superball", x: 0, y: 1 }] }, cat.index)
	assert.match(d.text, /could not lay this scene out/)
})

test("simText: goals, stories, events and warnings in plain words", () => {
	const t = simText({
		summary: { goals: [{ label: "Ball in box", ok: false, item: "b", container: "c" }], stories: [{ item: "b", text: "top speed 2.1 m/s", moved_at: 0.5 }], events: [{ t: 1.234, text: "Ball hits Ramp", speed: 1.5 }] },
		warnings: [{ text: "Ball starts inside Ramp" }]
	})
	assert.match(t, /FAILED: Ball in box/)
	assert.match(t, /1\.23 s Ball hits Ramp at 1\.50 m\/s/)
	assert.match(t, /Warnings: Ball starts inside Ramp/)
	assert.match(simText(null), /No run results/)
})

test("the edit step's rich digest says what the user sees: a pool ball's colour from its number, not a car's wheels, 'dark red', 'an', a thing sunk a hair into the table stands on it", async () => {
	const { richDigestFrom } = await import("../rich-digest.mjs")
	const cat = await getCatalog()
	const scene = {
		id: "t",
		seconds: 3,
		release: 0.5,
		stage: { x0: -0.6, x1: 3.2, y0: -0.2, y1: 2 },
		items: [
			{ id: "table", type: "table", x: 1.3, y: 0, props: { width: 3.7, thickness: 0.15 } },
			{ id: "eight", type: "billiard-ball", name: "Eight ball", x: 0.2, y: 0.0286, props: { number: 8 } },
			{ id: "car", type: "toy-car", name: "Red toy car", x: 0.6, y: 0.02 },
			{ id: "book", type: "hardcover-book", name: "Book", x: 1.2, y: 0.0175 },
			{ id: "hoop", type: "basketball", name: "Basketball", x: 2.2, y: 0.121 },
			{ id: "crate", type: "box", name: "Crate", x: 2.8, y: 0 },
			{ id: "deep", type: "box", name: "Sunk box", x: 2.0, y: -0.04 }
		]
	}
	const d = await sceneDigest(scene, cat.index)
	const text = richDigestFrom(scene, d, { sim: null, plan: null, cat }).text
	assert.match(text, /- eight · “Eight ball” · a black ball: billiard-ball/)
	assert.match(text, /- car · “Red toy car” · a car: toy-car/)
	assert.match(text, /- book · “Book” · a dark red book: hardcover-book/)
	assert.match(text, /- hoop · “Basketball” · an orange ball: basketball/)
	assert.match(text, /- crate · “Crate” · [^\n]*\n  where: right third of the table, standing on the table;/)
	assert.match(text, /- deep · “Sunk box” · [^\n]*\n  where: [^\n]*in the air; its bottom 5\.2 cm below the top of the table;/)
	assert.doesNotMatch(text, /-\d[.\d]* cm above/)
})

test("the edit step's digest gives each goal's moving thing as the whole run measured it: how high its centre rises, how fast it leaves, the container's rim (V8842: 'it rises barely 2 cm' for a ball that rose 27 cm)", async () => {
	const { richDigestFrom, goalFacts } = await import("../rich-digest.mjs")
	const { runScene } = await import("../steps.mjs")
	const { readFileSync } = await import("node:fs")
	const cat = await getCatalog()
	const scene = JSON.parse(readFileSync(new URL("../../web/scenarios/rube-goldberg.json", import.meta.url), "utf8"))
	// (the tennis ball swapped in and seated on the seesaw as the app seats it: V8842's swap scene)
	const sw = { ...scene, items: scene.items.map((i) => (i.id === "ball2" ? { ...i, type: "tennis-ball", name: "Tennis ball", x: 3.020394, y: 0.055448, props: {} } : i)) }
	const run = await runScene(sw)
	const facts = goalFacts(run, sw.goals)
	assert.equal(facts.length, 1)
	assert.equal(facts[0].item, "ball2")
	assert.ok(facts[0].peak_y > facts[0].y0 + 0.2, JSON.stringify(facts[0]))
	assert.ok(facts[0].launch > 1.2 && facts[0].launch < 2.5, JSON.stringify(facts[0]))
	const d = await sceneDigest(sw, cat.index)
	const text = richDigestFrom(sw, d, { sim: { summary: run.summary, resolved: run.resolved, track: { frames: [run.track.frames[0], run.track.frames.at(-1)] } }, plan: null, cat, facts }).text
	assert.match(text, /## The goals' moving things in the last run \(measured; quote heights and speeds of these things only from here\)/)
	assert.match(text, /- ball2 \(“Tennis ball”\) \(goal: [^)]*\): its centre starts at y 0\.0\d m; starts moving at \d\.\d\d s and leaves at 1\.\d\d m\/s \(its own top speed in the next 0\.3 s\); its centre rises highest to y 0\.3\d m at \d\.\d\d s; box \(“Box”\)'s rim \(the top of its walls\) is at y 0\.3\d m/)
})
