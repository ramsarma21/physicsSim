// The edit step's digest shows each physics module's readings from a run made here, also when that run comes from the edit-run cache (ai/steps.mjs
// digestPart keeps only the first and last frames, so each item's module lines are read off the whole run before the track is dropped). vfy-ai5,
// 20 Oct: "What does each thermometer read at 20 minutes?" got "The run summary I have doesn't include the exact readings".
//   node --test ai/test/edit-digest-modules.test.mjs
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, beforeEach, test } from "node:test"
import { runScene, runStep } from "../steps.mjs"
import { getCatalog } from "../catalog-digest.mjs"
import { sceneDigest } from "../scene-digest.mjs"
import { moduleLinesOf, richDigestFrom } from "../rich-digest.mjs"
import { mockEnv, startMockGateway, testRouting } from "./mock-gateway.mjs"

let gw
let dir
let was
before(async () => {
	gw = await startMockGateway()
	dir = mkdtempSync(join(tmpdir(), "ai-edit-digest-"))
	was = process.env.AI_CACHE_DIR
	process.env.AI_CACHE_DIR = dir
})
after(async () => {
	await gw.close()
	if (was === undefined) delete process.env.AI_CACHE_DIR
	else process.env.AI_CACHE_DIR = was
	rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => gw.reset())
const opts = () => ({ env: mockEnv(gw), routing: testRouting(), backoffScale: 0.01 })
const ANSWER = { content: JSON.stringify({ kind: "answer", targets: [], mode: "patch", reply: "ok", patches: [] }) }
const wall = (id, x) => ({ id, type: "wall", name: id, props: { invisible_in_3d: true }, x, y: 0 })

// Grade 5 insulators (vfy-ai5 T2): a foam cup and a steel cup of hot water, a thermometer in each, 20 minutes of lesson time
const CUPS = () => ({
	version: 2,
	name: "Foam vs metal cup",
	seconds: 12,
	release: 0.5,
	settings: { room_temp: 22, time_lapse: 100 },
	items: [
		{ id: "table", type: "table", name: "Table", props: {}, x: 1.3, y: 0 },
		{ id: "foam-cup", type: "drink-cup", name: "Foam cup", props: {}, x: 0.9, y: 0.0015 },
		{ id: "metal-cup", type: "drink-cup", name: "Metal cup", props: { style: "steel" }, x: 1.7, y: 0.0015 },
		{ id: "therm-foam", type: "thermometer", name: "Thermometer in the foam cup", props: {}, x: 0.9, y: 0.0115 },
		{ id: "therm-metal", type: "thermometer", name: "Thermometer in the metal cup", props: {}, x: 1.7, y: 0.011 },
		wall("wall-left", -0.52),
		wall("wall-right", 3.12)
	],
	goals: [{ kind: "warmer", a: "therm-foam", b: "therm-metal", at_min: 20, label: "After 20 minutes the water in the foam cup is warmer than in the metal cup" }]
})
// Grade 6 displacement (vfy-ai5 F3): a graduated cylinder filled to 50 mL, a small rock dropped in
const CYLINDER = () => ({
	version: 2,
	name: "Rock in a cylinder",
	seconds: 3,
	release: 0.5,
	items: [
		{ id: "table", type: "table", name: "Table", props: {}, x: 1.3, y: 0 },
		{ id: "cyl", type: "graduated-cylinder", name: "Graduated cylinder", props: { fill_ml: 50 }, x: 1.3, y: 0 },
		{ id: "rock", type: "pebble", name: "Small rock", props: { width: 0.02, height: 0.015 }, x: 1.3, y: 0.26 },
		wall("wall-left", -0.52),
		wall("wall-right", 3.12)
	],
	goals: [{ kind: "sinks", item: "rock", label: "The rock sinks to the bottom of the cylinder" }]
})
const userOf = (k) => gw.requests[k].body.messages[1].content
const itemBlock = (user, id) => {
	const i = user.indexOf(`- ${id} · `)
	assert.ok(i >= 0, `${id} is in the digest`)
	const j = user.indexOf("\n- ", i + 3)
	const k = user.indexOf("\n## ", i + 3)
	return user.slice(i, Math.min(j < 0 ? Infinity : j, k < 0 ? Infinity : k))
}

test("a heat scene's edit digest says what each thermometer reads (°C, start → end and through the run in lesson time), run here and again from the cache", async () => {
	gw.script("m1", [ANSWER, ANSWER])
	// (the cache is keyed by web/sim's fingerprint too: a module file edited between the two requests is a new engine, run again)
	const fp0 = (await getCatalog()).fingerprint
	const a = await runStep("edit", { text: "What does each thermometer read at 20 minutes?", scene: CUPS() }, opts())
	const b = await runStep("edit", { text: "What does each thermometer read at 20 minutes?", scene: CUPS() }, opts())
	const same = (await getCatalog()).fingerprint === fp0
	assert.equal(a.prompt.digest.cached, false)
	if (same) assert.equal(b.prompt.digest.cached, true, "the second request reads the run from the edit-run cache")
	assert.ok(readdirSync(join(dir, "edit-runs")).some((n) => n.endsWith(".json")))
	for (const k of [0, 1]) {
		const u = userOf(k)
		for (const id of ["therm-foam", "therm-metal"]) {
			const blk = itemBlock(u, id)
			assert.match(blk, /\n  readings in the last run: reads -?\d+(\.\d)? → -?\d+(\.\d)? °C/, `${id}: its reading start → end`)
			assert.match(blk, /\n  through the run \(lesson time\): reads \(°C\): [^\n]* at 0 s, [^\n]* at 20 min/, `${id}: its readings through the 20 lesson minutes`)
			assert.match(blk, /\n  reads -?[\d.]+ → -?[\d.]+ °C \(what its bulb/, `${id}: the heat module's own line`)
		}
		assert.match(itemBlock(u, "foam-cup"), /\n  water [\d.]+ → [\d.]+ °C, [\d.]+ → [\d.]+ g over 20 min of lesson time/)
	}
	if (same) assert.equal(userOf(1), userOf(0), "the cached run gives the same digest, word for word")
})

test("a graduated cylinder's edit digest gives its volume_ml reading (the scale's mL) and the rock's draft", async () => {
	gw.script("m1", [ANSWER])
	await runStep("edit", { text: "What does the cylinder read after the rock goes in?", scene: CYLINDER() }, opts())
	const blk = itemBlock(userOf(0), "cyl")
	assert.match(blk, /reads 50\.0 → 5\d\.\d mL/, "the cylinder's volume_ml reading, start → end")
	assert.match(blk, /its scale reads 50 → 5\d(\.\d+)? mL/, "the fluids module's own line")
	assert.match(itemBlock(userOf(0), "rock"), /draft \d+(\.\d+)? mm/)
})

test("the run as the edit-run cache keeps it (two frames and the module lines) gives the digest the whole run gives, through JSON", async () => {
	const cat = await getCatalog()
	for (const sc of [CUPS(), CYLINDER()]) {
		const d = await sceneDigest(sc, cat.index)
		const run = await runScene(sc)
		const f = run.track.frames
		const kept = JSON.parse(JSON.stringify({ resolved: run.resolved ?? {}, summary: run.summary, track: { frames: [f[0], f.at(-1)] }, moduleLines: moduleLinesOf(sc, run, cat) }))
		const full = richDigestFrom(sc, d, { sim: run, cat }).text
		assert.equal(richDigestFrom(sc, d, { sim: kept, cat }).text, full, sc.name)
		// (and a run kept the old way, without the lines, says none of them: what the cache's version bump rebuilds)
		const old = { resolved: kept.resolved, summary: kept.summary, track: kept.track }
		assert.doesNotMatch(richDigestFrom(sc, d, { sim: old, cat }).text, /readings in the last run/)
	}
	// (a scene without physics modules: no lines, and the digest is as before)
	const plain = JSON.parse(readFileSync(new URL("../../web/scenarios/rube-goldberg.json", import.meta.url), "utf8"))
	const run = await runScene(plain)
	assert.deepEqual(moduleLinesOf(plain, run, cat), {})
})

// Grade 3 "is this a valid experiment?" (vfy-ai5 R-L1 / A-K2): two toy cars down two ramps, one carrying clay
const CARS = () => ({
	version: 2,
	name: "Clay cars",
	seconds: 7,
	release: 0.5,
	items: [
		{ id: "table", type: "table", name: "Table", props: { width: 8 }, x: 2.5, y: 0 },
		{ id: "gym-floor", type: "floor", name: "Carpet floor", props: { length: 8, material: "carpet" }, x: 2.5, y: 0.05 },
		{ id: "ramp-a", type: "ramp", name: "Ramp A", props: {}, x: 0.5, y: 0.05 },
		{ id: "ramp-b", type: "ramp", name: "Ramp B", props: {}, x: 2.9, y: 0.05 },
		{ id: "car-clay", type: "toy-car", name: "Car with clay", props: { color: "red", start_gate: true }, x: -0.37, y: 0.111603 },
		{ id: "clay", type: "clay-lump", name: "Big lump of clay", props: { mass: 0.15, width: 0.08 }, x: -0.368209, y: 0.199573 },
		{ id: "car-empty", type: "toy-car", name: "Empty car", props: { color: "red", start_gate: true }, x: 2.03, y: 0.111603 }
	],
	goals: []
})

test("a toy car (four solids that go together) says where it ended and how far it went, so 'which car went farther?' has its numbers", async () => {
	gw.script("m1", [ANSWER])
	await runStep("edit", { text: "Which car went farther, and by how much?", scene: CARS() }, opts())
	for (const id of ["car-clay", "car-empty"]) assert.match(itemBlock(userOf(0), id), /\n  in the last run: [^\n]*ends at x -?[\d.]+, y -?[\d.]+ \(it went 1\.\d+ m right( and [\d.]+ cm down)? from its start\)/, id)
})
