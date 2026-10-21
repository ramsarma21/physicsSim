// describeRun's words for a physics module's happenings (web/ai/orchestrator.js describeRun named()): each item's id swapped for its name on
// screen once, in one pass, never inside a name already there. A module that already names its items ("Desk lamp's light reaches White plate
// (salt + lamp)") keeps its words; one that says ids ("timer's top bulb") gets the names. Repair for the verified card of a real AI run (th1):
// "Desk Desk lamp's light reaches White plate (salt + Desk lamp) ... Spoonful of Spoonful of salt".
//   node --test web/ai/test/describe-run-names.test.mjs
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const { describeRun } = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)

// (the th1 scene: salt + lamp versus plain ice, as the AI built it)
const ITEMS = [
	{ id: "table", type: "table", name: "Table", x: 1.3, y: 0, angle: 0, props: {} },
	{ id: "plate_a", type: "plate", name: "White plate (salt + lamp)", x: 1, y: 0.0015, angle: 0, props: {} },
	{ id: "cube_a", type: "ice-cube", name: "Ice cube with salt and lamp", x: 1, y: 0.028, angle: 0, props: {} },
	{ id: "salt", type: "salt-pile", name: "Spoonful of salt", x: 1, y: 0.0495, angle: 0, props: { mass_g: 6 } },
	{ id: "lamp", type: "lamp", name: "Desk lamp", x: 0.6, y: 0, angle: 0, props: { head_height: 0.3, target: "cube_a", beam_angle: 50 } },
	{ id: "plate_b", type: "plate", name: "White plate (nothing)", x: 1.8, y: 0.0015, angle: 0, props: {} },
	{ id: "cube_b", type: "ice-cube", name: "Plain ice cube", x: 1.8, y: 0.028, angle: 0, props: {} },
]
const sc = { items: ITEMS }
const runOf = (happenings) => ({ summary: { events: [], stories: [], happenings } })
const say = (h, scene = sc) => describeRun(runOf(h), scene)

test("the th1 card: a module's own names are kept, each said once", () => {
	const h = [
		{ t: 0, text: "Desk lamp's light reaches Table", items: ["lamp", "table"] },
		{ t: 0, text: "Desk lamp's light reaches White plate (salt + lamp)", items: ["lamp", "plate_a"] },
		{ t: 0, text: "Desk lamp's light reaches Ice cube with salt and lamp", items: ["lamp", "cube_a"] },
		{ t: 0, text: "Desk lamp's light reaches Spoonful of salt", items: ["lamp", "salt"] },
		{ t: 0, text: "Light is totally reflected inside Ice cube with salt and lamp", items: ["cube_a"] },
	]
	assert.equal(
		say(h),
		"In the run: Desk lamp's light reaches Table (0.00 s) → Desk lamp's light reaches White plate (salt + lamp) (0.00 s) → Desk lamp's light reaches Ice cube with salt and lamp (0.00 s) → Desk lamp's light reaches Spoonful of salt (0.00 s) → 1 more.",
	)
})

test("every swap in one pass: a name swapped in is never scanned again, whatever the items' order", () => {
	for (const order of [["cube_a", "lamp"], ["lamp", "cube_a"]]) assert.equal(say([{ t: 0.5, text: "lamp warms cube_a", items: order }]), "In the run: Desk lamp warms Ice cube with salt and lamp (0.50 s).", order.join())
	for (const order of [["plate_a", "salt", "lamp"], ["lamp", "salt", "plate_a"], ["salt", "plate_a", "lamp"]])
		assert.equal(say([{ t: 2, text: "salt melts into plate_a under lamp", items: order }]), "In the run: Spoonful of salt melts into White plate (salt + lamp) under Desk lamp (2.00 s).", order.join())
})

test("an id is never swapped inside a name already there; an item already named keeps its bare id a plain word", () => {
	assert.equal(say([{ t: 1, text: "White plate (salt + lamp) holds salt", items: ["plate_a", "salt", "lamp"] }]), "In the run: White plate (salt + lamp) holds Spoonful of salt (1.00 s).")
	assert.equal(say([{ t: 1, text: "Spoonful of salt: salt dissolves under lamp", items: ["salt", "lamp"] }]), "In the run: Spoonful of salt: salt dissolves under Desk lamp (1.00 s).")
})

test("only ids that stand alone are swapped; a '$' in a name is said as it is", () => {
	const s2 = { items: [{ id: "hg", type: "hourglass", name: "Sand $& timer" }, { id: "hg-2", type: "hourglass", name: "Second timer" }] }
	assert.equal(say([{ t: 3, text: "hg runs out before hg-2 (hgx, hg_a)", items: ["hg", "hg-2"] }], s2), "In the run: Sand $& timer runs out before Second timer (hgx, hg_a) (3.00 s).")
	// ("Desk lamps" is not the name "Desk lamp": the lamp's id still swaps)
	assert.equal(say([{ t: 0, text: "Desk lamps glow; lamp is on", items: ["lamp"] }]), "In the run: Desk lamps glow; Desk lamp is on (0.00 s).")
	// (an item with no name of its own, or not in the scene, is left as the module said it)
	assert.equal(say([{ t: 0, text: "ghost hums", items: ["ghost"] }]), "In the run: ghost hums (0.00 s).")
})
