// ai/schemas.mjs against the real catalog: plans, observations, refine and edit answers, patches.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { before, test } from "node:test"
import { getCatalog } from "../catalog-digest.mjs"
import { applyPatches, checkSchema, planFromScene, planSchema, validate } from "../schemas.mjs"

let catalog
before(async () => {
	catalog = (await getCatalog()).index
})
const PG = new URL("../../", import.meta.url)
const scenario = (id) => JSON.parse(readFileSync(new URL(`web/scenarios/${id}.json`, PG), "utf8"))

const goodPlan = () => ({
	title: "Ball into bucket",
	seconds: 4,
	release: 0.5,
	items: [
		{ id: "ramp", type: "plank", name: "Ramp", place: { lean: { from: { on: "air", x: 0.0, y: 0.7 }, to: { on: "air", x: 0.8, y: 0.45 } } }, why: "ramp" },
		{ id: "ball", type: "tennis-ball", name: "Ball", place: { on: "ramp", x: 0.06 }, held: true, why: "rolls" },
		{ id: "pot", type: "bucket", name: "Pot", place: { on: "table", x: 1.25 }, why: "target" },
		{ id: "wall", type: "wall", props: { invisible_in_3d: true }, place: { on: "table", x: 3.1 } },
		{ id: "box1", type: "cardboard-box", place: { on: "table", left_of: { id: "pot", gap_m: 0.1 } } },
		{ id: "block", type: "wooden-block", place: { on: "box1" } },
		{ id: "marble", type: "glass-marble", place: { on: "pot", inside: "pot" } }
	],
	missing: [{ asked: "a flower pot", reason: "none in the library", substitute_type: "bucket", substitute_id: "pot" }],
	goals: [{ label: "Ball in the pot", item: "ball", container: "pot" }],
	tune: [{ id: "pot", param: "x", min: 1.0, max: 1.7 }, { id: "ball", param: "diameter", min: 0.05, max: 0.08 }],
	notes: "",
	assumptions: ["none"]
})
const errorsOf = (step, v, ctx = {}) => validate(step, v, { catalog, ...ctx }).errors
const hasError = (errors, re) => assert.ok(errors.some((e) => re.test(e)), `expected an error matching ${re}; got:\n${errors.join("\n")}`)

test("a sound plan passes, normalised (lean gets on: air, align dropped where meaningless)", () => {
	const r = validate("plan", goodPlan(), { catalog })
	assert.deepEqual(r.errors, [])
	assert.equal(r.ok, true)
	assert.equal(r.value.items[0].place.on, "air")
	assert.equal(r.value.goals[0].kind, "in")
})

test("types: unknown (with a suggestion), the table, case/underscore spellings normalised", () => {
	const p = goodPlan()
	p.items[1].type = "tenis-ball"
	hasError(errorsOf("plan", p), /type "tenis-ball" is not in the catalog \(did you mean "tennis-ball"\?\)/)
	const q = goodPlan()
	q.items.push({ id: "t2", type: "table", place: { on: "air", x: 1, y_m: 1 } })
	hasError(errorsOf("plan", q), /the table is already in every scene/)
	const r = goodPlan()
	r.items[1].type = "Tennis_Ball"
	const v = validate("plan", r, { catalog })
	assert.equal(v.ok, true)
	assert.equal(v.value.items[1].type, "tennis-ball")
	assert.ok(v.warnings.some((w) => /read as "tennis-ball"/.test(w)))
})

test("props: unknown keys, out of range, wrong kinds, bad choices, ints", () => {
	const p = goodPlan()
	p.items[0].props = { length: 9, colour: "red" }
	p.items[1].props = { hollow: "yes", material: "rubber" }
	p.items[3].props = { height: -1 }
	p.items.push({ id: "row", type: "domino-row", props: { count: 7.5 }, place: { on: "table", x: 2.2 } })
	const e = errorsOf("plan", p)
	hasError(e, /ramp\)\.props\.length is 9 m, above its maximum 4/)
	hasError(e, /props\.colour is not a prop of plank/)
	hasError(e, /props\.hollow must be true or false/)
	hasError(e, /props\.material must be one of "felt \(tennis\)"/)
	hasError(e, /props\.height is -1 m, below its minimum/)
	hasError(e, /props\.count must be a whole number/)
})

test("small unambiguous slips are normalised with a warning, not sent back for repair", () => {
	const p = goodPlan()
	p.items[4].place = { on: "table", right_of: { id: "ramp", gap_m: 0.1, align: "gap" } }
	p.items[3].place = { on: "table", left_of: "box1" }
	p.items[2].place = { on: "table", x: "1.25", angle: 5 }
	const r = validate("plan", p, { catalog })
	assert.deepEqual(r.errors, [])
	assert.equal(r.value.items[4].place.align, "gap")
	assert.deepEqual(r.value.items[3].place.left_of, { id: "box1", gap_m: 0 })
	assert.equal(r.value.items[2].place.x, 1.25)
	assert.equal(r.value.items[2].place.angle_deg, 5)
	assert.ok(r.warnings.length >= 3)
})

test("ids: unique, well formed, not reserved", () => {
	const p = goodPlan()
	p.items[4].id = "ramp"
	p.items.push({ id: "air", type: "golf-ball", place: { on: "table", x: 2 } })
	p.items.push({ id: "bad id!", type: "golf-ball", place: { on: "table", x: 2.5 } })
	const e = errorsOf("plan", p)
	hasError(e, /the id "ramp" is used twice/)
	hasError(e, /"air" is reserved/)
	hasError(e, /id must be 1 to 40 letters/)
})

test("references: on, left_of, inside, lean ends, goals, tune, missing must exist; no circles", () => {
	const p = goodPlan()
	p.items[1].place.on = "rampp"
	p.items[4].place.left_of.id = "nothing"
	p.goals[0].container = "box1"
	p.tune.push({ id: "ghost", param: "x", min: 0, max: 1 })
	p.tune.push({ id: "ball", param: "material", min: 0, max: 1 })
	p.missing[0].substitute_type = "flowerpot"
	const e = errorsOf("plan", p)
	hasError(e, /place\.on "rampp" is not an item of the plan \(did you mean "ramp"\?\)/)
	hasError(e, /left_of\.id "nothing" is not an item/)
	hasError(e, /"box1" is a cardboard-box; an "in" goal can only be checked for a box, cup, bucket, basket/)
	hasError(e, /"ghost" is not an item of the plan/)
	hasError(e, /material is a choice prop; only number props can be tuned/)
	hasError(e, /substitute_type "flowerpot" is not in the catalog/)
	const c = goodPlan()
	c.items[0].place = { on: "block", x: 0.5 }
	c.items[5].place = { on: "ball" }
	hasError(errorsOf("plan", c), /go round in a circle \((ramp → ball → ramp|ball → ramp → ball|.*block.*)\)/)
})

test("placement rules: air needs y_m, y_m only in the air, one horizontal position, lean ends, inside a container, the stage", () => {
	const p = goodPlan()
	p.items[2].place = { on: "air", x: 1.2 }
	p.items[3].place = { on: "table", x: 3.1, y_m: 0.2 }
	p.items[4].place = { on: "table", x: 0.5, left_of: { id: "pot", gap_m: 0.1 } }
	p.items[6].place = { on: "pot", inside: "ball" }
	p.items.push({ id: "far", type: "golf-ball", place: { on: "table", x: 12 } })
	p.items.push({ id: "nowhere", type: "golf-ball", place: { on: "table" } })
	p.items.push({ id: "lean2", type: "plank", place: { lean: { from: { on: "air", x: 0.3 }, to: { on: "table", x: 0.3, y: 0.1 } }, angle_deg: 10 } })
	const e = errorsOf("plan", p)
	hasError(e, /an item in the air needs y_m/)
	hasError(e, /y_m is only for items placed on "air"/)
	hasError(e, /give either x or left_of, not both/)
	hasError(e, /inside "ball" is a tennis-ball, not a container/)
	hasError(e, /x = 12 m is outside the stage/)
	hasError(e, /say where along the table it goes/)
	hasError(e, /lean sets the position and angle from its two ends/)
	hasError(e, /lean\.from: an end in the air needs y/)
	hasError(e, /lean\.to\.y is only for an end in the air/)
	hasError(e, /the two ends are at the same x/)
})

test("structure and semantics are reported together (one repair can fix both)", () => {
	const p = goodPlan()
	p.seconds = 99
	p.items[1].type = "unicorn"
	p.items[2].place.on = "nowhere"
	const e = errorsOf("plan", p)
	hasError(e, /plan\.seconds is 99, above the maximum 20/)
	hasError(e, /type "unicorn" is not in the catalog/)
	hasError(e, /place\.on "nowhere" is not an item/)
	const junk = errorsOf("plan", { title: "x", seconds: 2, items: [null, 3, { id: 5 }, { id: "a", type: "golf-ball", place: "table" }], missing: "no", goals: [], tune: [], notes: "" })
	assert.ok(junk.length >= 3, junk.join("\n"))
})

test("structure: missing fields, unknown fields with suggestions, ranges", () => {
	const e = errorsOf("plan", { title: "", seconds: 40, items: [{ id: "a", type: "golf-ball", place: { on: "table", x: 1, angel_deg: 3 }, colour: 1 }] })
	hasError(e, /plan\.title must not be empty/)
	hasError(e, /plan\.seconds is 40, above the maximum 20/)
	hasError(e, /place\.angel_deg is not a field here \(did you mean "angle_deg"\?\)/)
	hasError(e, /items\[0\]\.colour is not a field here/)
	assert.deepEqual(errorsOf("plan", []), ["the plan must be a JSON object"])
})

test("flags: held+fixed is an error; held/fixed on a static type is dropped with a warning; goals need a mover", () => {
	const p = goodPlan()
	p.items[1].fixed = true
	p.items[2].held = true
	const r = validate("plan", p, { catalog })
	hasError(r.errors, /held and fixed are both true/)
	hasError(r.errors, /"ball" is fixed, so it never moves/)
	assert.ok(r.warnings.some((w) => /held dropped \(a bucket is static/.test(w)))
})

test("release after the end of the run is an error", () => {
	const p = goodPlan()
	p.release = 6
	hasError(errorsOf("plan", p), /release \(6 s\) is after the end of the run/)
})

test("observation: a sound one passes; labels, boxes, supports and relations are checked", () => {
	const obs = {
		summary: "a ball on a ramp",
		objects: [
			{ label: "red ball", count: 1, bbox: [0.1, 0.3, 0.2, 0.4], est_size_m: { w: 0.06, h: 0.06 }, material: "rubber", color: "red", state: "resting", supports: "Ramp" },
			{ label: "ramp", count: 1, bbox: [0.05, 0.4, 0.6, 0.8], est_size_m: null, material: "wood", color: "tan", state: "leaning", supports: "table" }
		],
		relations: [{ a: "red ball", rel: "on", b: "ramp" }],
		motion_story: ["it rolls"],
		view: { camera: "side", plane: "image right = +x" },
		scale_hint: { label: "red ball", size_m: 0.06, dimension: "diameter" },
		uncertain: []
	}
	const r = validate("observe", obs, { images: 1 })
	assert.deepEqual(r.errors, [])
	assert.equal(r.value.objects[0].supports, "ramp")
	const bad = structuredClone(obs)
	bad.objects[1].label = "red ball"
	bad.objects[0].bbox = [0.5, 0.3, 0.2, 0.4]
	bad.objects[0].image = 3
	bad.objects[0].supports = "shelf of doom"
	bad.relations.push({ a: "ghost", rel: "on", b: "ramp" }, { a: "ramp", rel: "levitates", b: "x" })
	const e = validate("observe", bad, { images: 1 }).errors
	hasError(e, /the label "red ball" is used twice/) // the semantic checks still run when the structure is off
	hasError(e, /rel must be one of/)
	hasError(e, /supports "shelf of doom" is not an object label/)
	const bad2 = structuredClone(obs)
	bad2.objects[0].bbox = [0.5, 0.3, 0.2, 0.4]
	bad2.objects[0].image = 3
	bad2.objects[0].supports = "shelf of doom"
	bad2.relations.push({ a: "ghost", rel: "on", b: "ramp" })
	const e2 = validate("observe", bad2, { images: 1 }).errors
	hasError(e2, /bbox must be \[x0, y0, x1, y1\] with x0 < x1/)
	hasError(e2, /image 3 is not one of the 1 image/)
	hasError(e2, /supports "shelf of doom" is not an object label/)
	hasError(e2, /relations\[1\]\.a "ghost" is not an object label/)
})

test("refine: done with patches is contradictory; patches are checked against the plan", () => {
	const plan = validate("plan", goodPlan(), { catalog }).value
	assert.equal(validate("refine", { done: true, score_0_10: 9, issues: [], patches: [] }, { catalog, plan }).ok, true)
	hasError(errorsOf("refine", { done: true, score_0_10: 9, issues: [], patches: [{ op: "move", id: "pot", dx: 0.1 }] }, { plan }), /done is true but patches were given/)
	const ok = validate("refine", { done: false, score_0_10: 5, issues: [{ severity: "high", text: "short", ids: ["pot"] }], patches: [{ op: "move", id: "pot", dx: -0.12 }, { op: "set_props", id: "ramp", props: { friction: 0.3, legs: null } }] }, { catalog, plan })
	assert.deepEqual(ok.errors, [])
	const e = errorsOf("refine", { done: false, score_0_10: 5, issues: [], patches: [{ op: "move", id: "pot", dy: 0.1 }, { op: "move", id: "ghost", dx: 1 }, { op: "twist", id: "pot" }, { op: "set_props", id: "pot", props: { width: 5 } }] }, { plan })
	hasError(e, /"pot" rests on "table"; only an item in the air moves up or down/)
	hasError(e, /"ghost" is not an item of the scene/)
	hasError(e, /op "twist" is not a patch op/)
	hasError(e, /props\.width is 5 m, above its maximum 1\.5/)
})

test("patches: removing a support leaves a dangling reference; add/replace/set_place are checked; applyPatches applies them", () => {
	const plan = validate("plan", goodPlan(), { catalog }).value
	hasError(errorsOf("refine", { done: false, score_0_10: 4, issues: [], patches: [{ op: "remove", id: "ramp" }] }, { plan }), /after the patches, .*place\.on "ramp" is not an item/)
	hasError(errorsOf("refine", { done: false, score_0_10: 4, issues: [], patches: [{ op: "add", item: { id: "ball", type: "golf-ball", place: { on: "table", x: 2 } } }] }, { plan }), /an item "ball" already exists/)
	hasError(errorsOf("refine", { done: false, score_0_10: 4, issues: [], patches: [{ op: "replace_type", id: "ball", type: "unicorn" }] }, { plan }), /type "unicorn" is not in the catalog/)
	hasError(errorsOf("refine", { done: false, score_0_10: 4, issues: [], patches: [{ op: "move", id: "block", dx: 0.1 }] }, { plan }), /has no x of its own/)
	const patches = [
		{ op: "move", id: "pot", dx: -0.1 },
		{ op: "move", id: "box1", dx: 0.05 },
		{ op: "replace_type", id: "ball", type: "golf-ball" },
		{ op: "add", item: { id: "cup", type: "cup", place: { on: "table", x: 2.5 } } },
		{ op: "set_place", id: "block", place: { on: "table", x: 2.0 } },
		{ op: "set_item", id: "ball", name: "Golf ball" },
		{ op: "set_scene", seconds: 6 },
		{ op: "set_goals", goals: [{ label: "into the cup", item: "ball", container: "cup" }] },
		{ op: "remove", id: "marble" }
	]
	const r = validate("refine", { done: false, score_0_10: 4, issues: [], patches }, { catalog, plan })
	assert.deepEqual(r.errors, [])
	const out = applyPatches(plan, r.value.patches, catalog)
	const by = Object.fromEntries(out.items.map((i) => [i.id, i]))
	assert.equal(by.pot.place.x, 1.15)
	assert.equal(by.box1.place.left_of.gap_m, 0.05) // moving right towards the pot shrinks the gap
	assert.equal(by.ball.type, "golf-ball")
	assert.equal(by.ball.name, "Golf ball")
	assert.equal(by.block.place.on, "table")
	assert.equal(by.marble, undefined)
	assert.equal(out.seconds, 6)
	assert.equal(out.goals[0].container, "cup")
	assert.ok(!out.tune.some((k) => k.param === "diameter" && k.id === "ball") || catalog.types["golf-ball"].props.diameter)
})

test("edit: patch mode against a hand-made scene (no plan), plan mode with a whole plan, mode/fields consistency", () => {
	const scene = scenario("rube-goldberg")
	const ok = validate("edit", { mode: "patch", reply: "Moved the box.", patches: [{ op: "move", id: "box", dx: 0.1 }, { op: "move", id: "ball1", dy: 0.05 }] }, { catalog, scene })
	assert.deepEqual(ok.errors, [])
	const q = validate("edit", { mode: "patch", reply: "Nothing to change: the seesaw flings ball 2.", patches: [] }, { catalog, scene })
	assert.equal(q.ok, true)
	hasError(errorsOf("edit", { mode: "patch", reply: "x" }, { scene }), /needs patches/)
	hasError(errorsOf("edit", { mode: "plan", reply: "x" }, { scene }), /needs plan/)
	hasError(errorsOf("edit", { mode: "plan", reply: "x", plan: { ...goodPlan(), seconds: 99 } }, { scene }), /edit\.plan\.seconds is 99/)
	assert.equal(validate("edit", { mode: "plan", reply: "A new scene.", plan: goodPlan() }, { catalog, scene }).ok, true)
	hasError(errorsOf("edit", { mode: "patch", reply: "x", patches: [{ op: "remove", id: "ramp1" }, { op: "move", id: "ramp1", dx: 1 }] }, { scene }), /"ramp1" is not an item of the scene/)
})

test("planFromScene: every item kept exactly (on air at its anchor), the table left out, goals carried", () => {
	const scene = scenario("rube-goldberg")
	const p = planFromScene(scene, catalog)
	assert.equal(p.items.length, scene.items.length - 1)
	const b = p.items.find((i) => i.id === "ball1")
	assert.deepEqual(b.place, { on: "air", x: 0, y_m: 0.749, angle_deg: 0 })
	assert.equal(b.held, true)
	assert.equal(p.goals[0].container, "box")
	assert.equal(validate("plan", p, { catalog, stage: scene.stage }).ok, true)
})

test("the schema checker itself: types, enums, nullable, required, extra fields", () => {
	const errs = []
	checkSchema({ type: "object", required: ["a"], additionalProperties: false, properties: { a: { enum: [1, 2] }, b: { type: ["string", "null"] } } }, { a: 3, b: 4, c: 1 }, "v", errs)
	assert.equal(errs.length, 3)
	const ok = []
	checkSchema(planSchema.properties.items.items.properties.place, { on: "table", x: 1 }, "p", ok)
	assert.deepEqual(ok, [])
})

// ---------------------------------------------------------------- 2026-10-15 repair: goal kinds, ids, names, edits, covers
const dominoPlan = () => ({
	title: "Dominoes",
	seconds: 5,
	items: [
		{ id: "ramp", type: "plank", name: "Ramp", place: { lean: { from: { on: "air", x: -0.2, y: 0.35 }, to: { on: "table", x: 0.5 } } } },
		{ id: "ball", type: "glass-marble", name: "Glass marble", place: { on: "ramp", x: -0.15 }, held: true },
		{ id: "row", type: "domino-row", name: "Row of 12 dominoes", props: { count: 12 }, place: { on: "table", right_of: { id: "ramp", gap_m: 0.2 } } },
		{ id: "mug", type: "cup", name: "Coffee mug", place: { on: "table", x: 2.5 } },
		{ id: "b1", type: "brick", name: "Brick", place: { on: "table", x: 2.0 } },
		{ id: "b2", type: "brick", name: "Brick", place: { on: "b1" } },
		{ id: "big", type: "superball", name: "10 cm ball", props: { diameter: 0.1 }, place: { on: "table", x: 1.6 } },
		{ id: "pend", type: "pendulum", name: "Pendulum", place: { on: "air", x: 1.2, y_m: 0.8 } }
	],
	missing: [{ asked: "a dog", reason: "no animals", substitute_type: null }],
	goals: [],
	tune: [],
	notes: ""
})

test("goals: in, falls (item or items), hits and moves are checked by kind; a goal without a kind or a container is an error", () => {
	const p = dominoPlan()
	p.goals = [
		{ kind: "falls", label: "All the dominoes fall", item: "row" },
		{ label: "The bricks topple", items: ["b1", "b2"] },
		{ kind: "hits", item: "ball", target: "row", before_s: 3 },
		{ kind: "moves", item: "big", min_m: 0.2 },
		{ label: "Marble in the mug", item: "ball", container: "mug" }
	]
	const r = validate("plan", p, { catalog })
	assert.deepEqual(r.errors, [])
	assert.deepEqual(r.value.goals.map((g) => g.kind), ["falls", "falls", "hits", "moves", "in"])
	assert.equal(r.value.goals[2].label, "ball hits row by 3 s")
	const q = dominoPlan()
	q.goals = [{ label: "x", item: "ball" }, { kind: "falls", item: "ball" }, { kind: "falls", item: "pend" }, { kind: "hits", item: "ball" }, { kind: "moves", item: "ramp", min_m: 0.1 }, { kind: "in", item: "ball", container: "mug", target: "row" }]
	const e = errorsOf("plan", q)
	hasError(e, /goals\[0\] \(x\): say what kind of goal it is/)
	hasError(e, /"ball" is a ball: it rolls rather than tips over/)
	hasError(e, /"pend" \(pendulum\) turns on a fixed pivot or hangs/)
	hasError(e, /a "hits" goal needs item \(what moves\) and target/)
	hasError(e, /"ramp" is a plank, which never moves/)
	hasError(e, /a "in" goal has no target/)
})

test("patches: up to 150, and `ids` sends one move or set_props to many items (expanded to one patch each)", () => {
	const p = validate("plan", dominoPlan(), { catalog }).value
	const r = validate("refine", { done: false, score_0_10: 6, issues: [], patches: [{ op: "set_props", ids: ["b1", "b2"], props: { friction: 0.3 } }, { op: "move", ids: ["b1"], dx: 0.05 }] }, { catalog, plan: p })
	assert.deepEqual(r.errors, [])
	assert.deepEqual(r.value.patches.map((x) => [x.op, x.id, x.ids]), [["set_props", "b1", undefined], ["set_props", "b2", undefined], ["move", "b1", undefined]])
	hasError(errorsOf("refine", { done: false, score_0_10: 6, issues: [], patches: [{ op: "set_props", ids: ["b1", "nope"], props: { friction: 0.3 } }] }, { plan: p }), /"nope" is not an item of the scene/)
	hasError(errorsOf("refine", { done: false, score_0_10: 6, issues: [], patches: [{ op: "move", dx: 0.1 }] }, { plan: p }), /needs id \(or ids/)
	const many = Array.from({ length: 80 }, (_, i) => ({ op: "set_props", id: i % 2 ? "b1" : "b2", props: { friction: 0.3 } }))
	assert.deepEqual(errorsOf("refine", { done: false, score_0_10: 6, issues: [], patches: many }, { plan: p }), [])
	const applied = applyPatches(p, [{ op: "set_props", ids: ["b1", "b2"], props: { bounce: 0.1 } }], catalog)
	assert.deepEqual(applied.items.filter((i) => i.type === "brick").map((i) => i.props.bounce), [0.1, 0.1])
})

test("names that state a number the patches change follow it (a set_item is added); a billiard ball's number is not a count", () => {
	const p = validate("plan", dominoPlan(), { catalog }).value
	const r = validate("edit", { mode: "patch", reply: "15 now", patches: [{ op: "set_props", id: "row", props: { count: 15 } }, { op: "set_props", id: "big", props: { diameter: 0.15 } }] }, { catalog, plan: p })
	assert.deepEqual(r.errors, [])
	const names = r.value.patches.filter((x) => x.op === "set_item").map((x) => [x.id, x.name])
	assert.deepEqual(names, [["row", "Row of 15 dominoes"], ["big", "15 cm ball"]])
	const r2 = validate("edit", { mode: "patch", reply: "ok", patches: [{ op: "set_props", id: "row", props: { count: 15 } }, { op: "set_item", id: "row", name: "Long row" }] }, { catalog, plan: p })
	assert.equal(r2.value.patches.filter((x) => x.op === "set_item").length, 1, "the model's own rename wins")
})

test("edit: undo asks for no patches; notes and assumptions may come back; the scene's missing list is kept", () => {
	const p = validate("plan", dominoPlan(), { catalog }).value
	let r = validate("edit", { mode: "patch", reply: "Press Undo (⌘Z) to go back.", patches: [], undo: true }, { catalog, plan: p })
	assert.equal(r.ok, true)
	hasError(validate("edit", { mode: "patch", reply: "x", patches: [{ op: "remove", id: "big" }], undo: true }, { catalog, plan: p }).errors, /undo is true: the app goes back/)
	r = validate("edit", { mode: "patch", reply: "Bigger.", patches: [{ op: "set_props", id: "big", props: { diameter: 0.2 } }], notes: "A 20 cm ball now.", assumptions: ["bigger ball"] }, { catalog, plan: p })
	assert.equal(r.value.notes, "A 20 cm ball now.")
	assert.deepEqual(r.value.missing.map((m) => m.asked), ["a dog"])
	r = validate("edit", { mode: "patch", reply: "Which ball?", patches: [] }, { catalog, plan: p })
	assert.deepEqual(r.value.missing, [], "a question keeps its own (empty) list")
})

test("covers: without an observation only tidied (ids that are no item dropped); remove patches clean goals and covers", () => {
	const p = dominoPlan()
	p.covers = [{ label: "bricks", ids: ["b1", "b9"] }, { label: "hand", id: null, note: "no people" }]
	const r = validate("plan", p, { catalog })
	assert.equal(r.ok, true)
	assert.deepEqual(r.value.covers, [{ label: "bricks", ids: ["b1"] }, { label: "hand", ids: [], note: "no people" }])
	const q = validate("plan", { ...dominoPlan(), goals: [{ kind: "falls", items: ["b1", "b2"] }, { kind: "hits", item: "ball", target: "big" }], covers: [{ label: "bricks", ids: ["b1", "b2"] }] }, { catalog }).value
	const after = applyPatches(q, [{ op: "remove", id: "b2" }, { op: "remove", id: "big" }], catalog)
	assert.deepEqual(after.goals, [{ kind: "falls", items: ["b1"], label: q.goals[0].label }])
	assert.deepEqual(after.covers[0].ids, ["b1"])
})

test("soft checks: coverage, the depicted outcome, a requested thing's material, done with a failing goal (repaired once, never fatal)", () => {
	const p = validate("plan", dominoPlan(), { catalog }).value
	const obs = { objects: [{ label: "bricks", count: 5, bbox: [0, 0, 1, 1], est_size_m: { w: 0.21, h: 0.065 }, material: "", color: "", state: "resting", supports: "table" }], relations: [], motion_story: ["it rolls into the mug"], view: { camera: "side", plane: "x" }, scale_hint: null, uncertain: [] }
	const withObs = validate("plan", { ...p, covers: [{ label: "bricks", ids: ["b1", "b2"] }] }, { catalog, observation: obs, text: "make it work" })
	assert.equal(withObs.ok, true)
	assert.ok(withObs.soft.some((e) => /the pictures show 5; the plan builds 2/.test(e)))
	assert.ok(withObs.soft.some((e) => /the request says to make it work/.test(e)))
	const noted = validate("plan", { ...p, covers: [{ label: "bricks", ids: ["b1", "b2"], note: "two fit on the table" }], goals: [{ kind: "in", item: "ball", container: "mug" }] }, { catalog, observation: obs, text: "make it work" })
	assert.deepEqual(noted.soft, [])
	const mat = validate("refine", { done: false, score_0_10: 6, issues: [], patches: [{ op: "set_props", id: "mug", props: { material: "aluminium" } }] }, { catalog, plan: p, text: "the marble lands in the coffee mug" })
	assert.equal(mat.ok, true)
	assert.ok(mat.soft.some((e) => /"Coffee mug" is a thing the request asks for: keep its material \(cardboard\)/.test(e)))
	const named = validate("refine", { done: false, score_0_10: 6, issues: [], patches: [{ op: "set_props", id: "mug", props: { material: "aluminium" } }] }, { catalog, plan: p, text: "the marble lands in an aluminium coffee mug" })
	assert.deepEqual(named.soft, [])
	const gr = [{ label: "All dominoes fall", kind: "falls", ok: false, detail: "3 of 12 tipped over" }]
	const done = validate("refine", { done: true, score_0_10: 9, issues: [], patches: [] }, { catalog, plan: p, goalResults: gr })
	assert.equal(done.ok, true)
	assert.equal(done.value.score_0_10, 7)
	assert.ok(done.soft.some((e) => /done is true, but the run fails "All dominoes fall" \(3 of 12 tipped over\)/.test(e)))
	const tunable = validate("refine", { done: true, score_0_10: 9, issues: [], patches: [] }, { catalog, plan: { ...p, tune: [{ id: "mug", param: "x", min: 2, max: 2.8 }] }, goalResults: [{ label: "in the mug", kind: "in", ok: false }] })
	assert.deepEqual(tunable.soft, [], "an in goal the tuner can still make is left to it")
	assert.equal(tunable.value.score_0_10, 9)
})

test("soft checks give no false alarms: covers may name the table and the safety walls; a story that ends striking a container is no landing", () => {
	const p = validate("plan", dominoPlan(), { catalog }).value
	const obs = (story, extra = []) => ({ objects: [{ label: "bricks", count: 2, bbox: [0, 0, 1, 1], est_size_m: null, material: "", color: "", state: "resting", supports: "table" }, ...extra], relations: [], motion_story: story, view: { camera: "side", plane: "x" }, scale_hint: null, uncertain: [] })
	const table = { label: "wooden table", count: 1, bbox: [0, 0.8, 1, 1], est_size_m: null, material: "wood", color: "", state: "resting", supports: null }
	const covers = [{ label: "bricks", ids: ["b1", "b2"] }, { label: "wooden table", ids: ["table"] }]
	const t = validate("plan", { ...p, covers }, { catalog, observation: obs(["it rolls"], [table]), text: "make it work" })
	assert.deepEqual(t.errors, [])
	assert.deepEqual(t.soft, [], "the table is in every scene: no repair turn for naming it")
	const strikes = ["The car rolls forward into the paper cup and shoves it to the right", "the car crashes into the box"]
	for (const s of strikes) assert.deepEqual(validate("plan", { ...p, covers }, { catalog, observation: obs([s], [table]), text: "make it work the way it is meant to" }).soft, [], s)
	const lands = ["the last domino knocks the ball into the basket", "The ball hits the cup and falls into it", "it drops into the mug"]
	for (const s of lands) assert.ok(validate("plan", { ...p, covers, goals: [] }, { catalog, observation: obs([s], [table]), text: "make it work" }).soft.some((e) => /the request says to make it work/.test(e)), s)
})

// ---------------------------------------------------------------- round 2 (2026-10-15): stages, set_stages, the rate-only check, legs in the air
const chainPlan = () => ({
	title: "Chain",
	seconds: 5,
	items: [
		{ id: "ramp", type: "plank", place: { lean: { from: { on: "air", x: 0, y: 0.4 }, to: { on: "table", x: 0.6 } } } },
		{ id: "ball", type: "tennis-ball", place: { on: "ramp", x: 0.05 }, held: true },
		{ id: "dominoes", type: "domino-row", place: { on: "table", x: 0.9 } },
		{ id: "cup", type: "cup", place: { on: "table", x: 2 } },
		{ id: "marble", type: "glass-marble", place: { on: "table", x: 1.8 } }
	],
	missing: [],
	goals: [{ label: "Marble in the cup", item: "marble", container: "cup" }],
	tune: [{ id: "cup", param: "x", min: 1.8, max: 2.2 }],
	notes: "",
	stages: [
		{ label: "Ball rolls down", does: "leaves the ramp at about 2 m/s", items: ["ball", "ramp"], check: { kind: "hits", item: "ball", target: "dominoes", before_s: 2 }, tune: [{ id: "dominoes", param: "x", min: 0.8, max: 1.0 }] },
		{ label: "Dominoes fall", items: ["dominoes", "ghost"], check: { kind: "falls", item: "dominoes" } },
		{ label: "Bad check", check: { kind: "falls", item: "cup" }, tune: [{ id: "dominoes", param: "x", min: 0.8, max: 1.0 }, { id: "ball", param: "nope", min: 0, max: 1 }] },
		{ label: "Into the cup", check: { kind: "in", item: "marble", container: "cup" }, tune: [{ id: "cup", param: "x", min: 1.8, max: 2.2 }] }
	]
})

test("stages: kept and labelled; a check or knob that does not fit is dropped with a warning (never a repair); stage knobs join plan.tune", () => {
	const r = validate("plan", chainPlan(), { catalog })
	assert.deepEqual(r.errors, [])
	const st = r.value.stages
	assert.equal(st.length, 4)
	assert.equal(st[0].check.label, "Stage 1: Ball rolls down")
	assert.deepEqual(st[1].items, ["dominoes"])
	assert.ok(r.warnings.some((w) => /stages\[1\].*items: "ghost" dropped/.test(w)), r.warnings.join("\n"))
	assert.equal(st[2].check, undefined)
	assert.ok(r.warnings.some((w) => /stages\[2\].*check dropped: .*never moves/.test(w)), r.warnings.join("\n"))
	assert.deepEqual(st[2].tune, [])
	assert.ok(r.warnings.some((w) => /already an earlier stage's/.test(w)))
	assert.ok(r.warnings.some((w) => /param must be x, y, angle or a number prop/.test(w)))
	assert.deepEqual(r.value.tune.map((k) => `${k.id}.${k.param}`), ["cup.x", "dominoes.x"])
	// re-validating the result changes nothing (no stage field leaks into the knobs)
	const again = validate("plan", r.value, { catalog })
	assert.deepEqual(again.errors, [])
	assert.deepEqual(again.value.tune, r.value.tune)
})

test("stages: tidied instead of repaired (not a list, a stray field, ids/expect read, no label, long text)", () => {
	const p = chainPlan()
	p.stages = [{ ids: ["ball"], expect: "x".repeat(400), colour: "red", check: "falls" }, 7]
	const r = validate("plan", p, { catalog })
	assert.deepEqual(r.errors, [])
	assert.equal(r.value.stages.length, 1)
	assert.deepEqual(r.value.stages[0].items, ["ball"])
	assert.equal(r.value.stages[0].does.length, 300)
	assert.equal(r.value.stages[0].check, undefined)
	assert.ok(r.value.stages[0].label.length > 0)
	const q = chainPlan()
	q.stages = "first the ball, then the dominoes"
	const r2 = validate("plan", q, { catalog })
	assert.deepEqual(r2.errors, [])
	assert.equal(r2.value.stages, undefined)
})

test("patches: set_stages replaces the list (checked against the plan); remove and replace_type clean the stages", () => {
	const base = validate("plan", chainPlan(), { catalog }).value
	let r = validate("refine", { done: false, score_0_10: 5, issues: [], patches: [{ op: "set_stages", stages: [{ label: "Only", check: { kind: "falls", item: "dominoes" }, tune: [{ id: "ghost", param: "x", min: 0, max: 1 }] }] }] }, { catalog, plan: base })
	assert.deepEqual(r.errors, [])
	assert.equal(r.value.patches[0].stages.length, 1)
	assert.deepEqual(r.value.patches[0].stages[0].tune, [])
	const after = applyPatches(base, r.value.patches, catalog)
	assert.equal(after.stages.length, 1)
	const removed = applyPatches(base, [{ op: "remove", id: "dominoes" }], catalog)
	assert.equal(removed.stages[0].check, undefined) // its check hit the dominoes
	assert.equal(removed.stages[1].check, undefined)
	assert.deepEqual(removed.stages[0].tune, [])
	assert.deepEqual(removed.stages[1].items, [])
	const retyped = applyPatches(base, [{ op: "replace_type", id: "cup", type: "bucket" }], catalog)
	assert.deepEqual(retyped.stages[3].tune.map((k) => k.param), ["x"])
	const cleared = applyPatches(base, [{ op: "set_stages", stages: [] }], catalog)
	assert.equal(cleared.stages, undefined)
})

test("rate: {score_0_10, issues} only; done and patches are dropped with a warning; a failing goal caps the score at 7", () => {
	let r = validate("rate", { score_0_10: 9, issues: [{ severity: "low", text: "the cup is a bit far" }], done: true, patches: [{ op: "move", id: "cup", dx: 1 }] }, { catalog, plan: goodPlan() })
	assert.deepEqual(r.errors, [])
	assert.equal(r.value.done, undefined)
	assert.equal(r.value.patches, undefined)
	assert.ok(r.warnings.some((w) => /patches dropped/.test(w)))
	r = validate("rate", { score_0_10: 9, issues: [] }, { catalog, plan: goodPlan(), goalResults: [{ label: "Ball in the pot", kind: "in", ok: false }] })
	assert.equal(r.value.score_0_10, 7)
	r = validate("rate", { score: 8 }, { catalog })
	assert.equal(r.ok, true)
	assert.equal(r.value.score_0_10, 8)
	assert.deepEqual(r.value.issues, [])
	hasError(validate("rate", { issues: [] }, { catalog }).errors, /score_0_10 is missing/)
	hasError(validate("rate", { score_0_10: 12, issues: [] }, { catalog }).errors, /above the maximum 10/)
})

test("refine: legs stay on for a plank in mid-air (the rest of the patch is kept); legs off on a board resting on both ends is fine", () => {
	const p = goodPlan()
	p.items.push({ id: "shelf", type: "plank", place: { on: "air", x: 2.2, y_m: 0.4 } }, { id: "board", type: "plank", place: { lean: { from: { on: "table", x: 2.6 }, to: { on: "box1", x: 1.0 } } } })
	const base = validate("plan", p, { catalog }).value
	const r = validate("refine", { done: false, score_0_10: 5, issues: [], patches: [{ op: "set_props", id: "ramp", props: { legs: false } }, { op: "set_props", id: "shelf", props: { legs: false, length: 0.5 } }, { op: "set_props", id: "board", props: { legs: false } }] }, { catalog, plan: base })
	assert.deepEqual(r.errors, [])
	assert.deepEqual(r.value.patches.map((x) => [x.id, x.props]), [["shelf", { length: 0.5 }], ["board", { legs: false }]])
	assert.ok(r.warnings.some((w) => /legs stay on for "Ramp"/.test(w)))
})

test("stages: a malformed check or knob (a stray field, a wrong type, a missing bound) is dropped, never a repair turn", () => {
	const p = chainPlan()
	p.stages = [
		{ label: "A", check: { kind: "falls", item: "dominoes", stage: 1 }, tune: [{ id: "cup", param: "x", min: 1.8 }, { id: "cup", param: "x", min: 1.8, max: 2.2, stage: 1 }, { id: "dominoes", param: "x", min: 0.8, max: 1 }] },
		{ label: "B", check: { kind: "hits", item: "ball", target: "dominoes", before_s: "soon" } }
	]
	const r = validate("plan", p, { catalog })
	assert.deepEqual(r.errors, [])
	assert.equal(r.value.stages[0].check, undefined)
	assert.deepEqual(r.value.stages[0].tune.map((k) => k.param), ["x"])
	assert.equal(r.value.stages[0].tune[0].id, "dominoes")
	assert.equal(r.value.stages[1].check, undefined)
	assert.ok(r.warnings.filter((w) => /dropped/.test(w)).length >= 4, r.warnings.join("\n"))
})

test("reply and suggestions (§13.9): tidied, never a repair: at most 2 sentences, chips {label ≤ 6 words, prompt}, at most 3, no duplicates", () => {
	const p = goodPlan()
	p.reply = "I built a ramp. The ball rolls 1.2 m down it. It lands in the pot. Enjoy!"
	p.suggestions = ["Drop the ball from much higher up onto the ramp", { label: "Wider pot", prompt: "Make the pot 10 cm wider" }, { label: "Wider pot", prompt: "again" }, { title: "Add a bell", request: "Add a bell the ball rings on its way" }, { label: "Fourth", prompt: "x" }, 7]
	const r = validate("plan", p, { catalog })
	assert.deepEqual(r.errors, [])
	assert.equal(r.value.reply, "I built a ramp. The ball rolls 1.2 m down it.")
	assert.deepEqual(r.value.suggestions, [
		{ label: "Drop the ball from much higher", prompt: "Drop the ball from much higher up onto the ramp" },
		{ label: "Wider pot", prompt: "Make the pot 10 cm wider" },
		{ label: "Add a bell", prompt: "Add a bell the ball rings on its way" }
	])
	const e = validate("edit", { mode: "patch", reply: "I made the box 2 cm wider (26 → 28 cm).", patches: [], suggestions: "not a list" }, { catalog, plan: goodPlan() })
	assert.deepEqual(e.errors, [])
	assert.equal(e.value.suggestions, undefined)
	const n = validate("edit", { mode: "new", reply: "Building a new scene.", why: "start over", suggestions: [{ label: "Add a cup", prompt: "Add a cup at the end" }] }, { catalog, plan: goodPlan() })
	assert.equal(n.ok, true)
	assert.equal(n.value.suggestions.length, 1)
})
