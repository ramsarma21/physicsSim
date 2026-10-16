// ai/catalog-digest.mjs and ai/scene-digest.mjs: complete, sized, cached; scenes read back with true outlines and supports.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"
import { detailFor, digestFromCatalog, getCatalog, _resetMemo } from "../catalog-digest.mjs"
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
		assert.ok(T.outline, `${t.key} has an outline`)
	}
	// the facts a planner needs are there
	assert.match(d.text, /### box — Open box · static[\s\S]*?goal container/)
	// (a plastic cup, a glass jar, a coffee mug: their "in" goals are judged by their own walls: ai/goals.mjs wallsInside, 16 Oct)
	assert.match(d.text, /### plastic-cup[\s\S]*?goal container \("in" goals work: judged by its own walls/)
	assert.match(d.text, /### superball[\s\S]*?Outline at defaults: 0\.06 × 0\.06 m, centred on the anchor/)
	assert.match(d.text, /### seesaw[\s\S]*?does not fall/)
	assert.match(d.text, /### spring-launcher[\s\S]*?acts at the scene's release time/)
	// size: the full digest is what plan/edit carry; the brief one what refine carries
	assert.ok(d.stats.chars < 110000, `full digest ${d.stats.chars} chars`)
	assert.ok(d.stats.briefChars < 16000, `brief digest ${d.stats.briefChars} chars`)
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
