// The catalog digest's budget per tier (ai/catalog-digest.mjs promptCatalog): past FULL_LIMIT the plan and edit prompts carry the core tier in
// the cached system prompt and, in the user message, only the physics modules a request may use. Each tier has its own budget, never the whole
// catalog's (the whole digest with every module loaded is several times the core: vfy-ai5, 20 Oct, digest.test.mjs failed at 348k chars while
// every acceptance run went through the tiers), and the two Grade 3 lessons this sandbox was extended for get the modules they use.
//   node --test ai/test/digest-tiers.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { FULL_LIMIT, getCatalog, promptCatalog } from "../catalog-digest.mjs"

const CORE_MAX = 110000 // chars: the cached system prompt's catalog (about 27k tokens)
const MODULE_MAX = 60000 // chars: one module's full section
const REQUEST_MAX = 260000 // chars: the core and the sections of every module one request picks (about 65k tokens)

test("each tier keeps its own budget: the core, each module's section, and what one lesson request carries", async () => {
	const cat = await getCatalog()
	if (!cat.tiers) {
		// (a catalog under FULL_LIMIT goes whole into every prompt)
		assert.ok(cat.text.length <= FULL_LIMIT)
		return
	}
	assert.ok(cat.tiers.core.length < CORE_MAX, `the core tier is ${cat.tiers.core.length} chars (budget ${CORE_MAX})`)
	for (const [name, m] of Object.entries(cat.tiers.modules)) assert.ok(m.text.length < MODULE_MAX, `${name}'s section is ${m.text.length} chars (budget ${MODULE_MAX})`)
	// (the two Grade 3 lessons: "Is this a valid experiment?" and MO-37 "Farther, or fewer seconds?")
	const asks = [
		["Grade 3: Is this a valid experiment? Two toy cars roll down two ramps, one car carries a lump of clay. Then salt sprinkled on one of two ice cubes on plates under a desk lamp: which melts first? Then two fans pushing two sailboats in water troughs.", ["mod_heat", "mod_fluids"]],
		["MO-37 Farther, or fewer seconds? A red car and a blue car each go 10 m; the red one takes 3 s and the blue one 4 s, timed with stopwatches.", ["mod_measure"]]
	]
	for (const [text, need] of asks) {
		const pc = promptCatalog(cat, { text, types: [] })
		for (const m of need) assert.ok(pc.modules.includes(m), `${text.slice(0, 40)}…: picks ${m} (picked ${pc.modules.join(", ")})`)
		const total = pc.system.length + pc.extra.length
		assert.ok(total < REQUEST_MAX, `${text.slice(0, 40)}…: ${total} chars in all (budget ${REQUEST_MAX})`)
	}
	// (a request about nothing a module has carries the core alone)
	assert.equal(promptCatalog(cat, { text: "a ball rolls down a ramp into a cup", types: [] }).extra, "")
})
