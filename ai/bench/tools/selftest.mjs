// Self-test of the bench: the case files resolve, every reference answer passes its case, and the checks catch broken answers (each mutation
// below must fail the check it targets). Then the ground-truth comparison: a scene against itself is perfect, and moved / swapped / resized /
// re-typed copies lose exactly what they should.
//   node ai/bench/tools/selftest.mjs        (exit code 1 on any failure)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH = path.resolve(HERE, "..")
const { scoreCase, scoreAgainstGT, checkCases, loadBench, validatePlan } = await import(pathToFileURL(path.join(BENCH, "score.mjs")).href)

const bench = loadBench()
const clone = (o) => JSON.parse(JSON.stringify(o))
const results = []
const ok = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail })
const ref = (id) => JSON.parse(fs.readFileSync(path.join(BENCH, "reference", `${id}.json`), "utf8"))
const item = (sc, id) => sc.items.find((i) => i.id === id)

// ---- 1. the case files
const probs = checkCases(bench)
ok("case files resolve (specs, groups, base scenes, image files)", probs.length === 0, probs.slice(0, 8).join("; "))

// ---- 2. every reference passes
const refs = fs.readdirSync(path.join(BENCH, "reference")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
const textIds = bench.text.map((c) => c.id)
ok(`a reference answer for every text case (${refs.length}/${textIds.length})`, textIds.every((id) => refs.includes(id)), textIds.filter((id) => !refs.includes(id)).join(", "))
for (const id of refs) {
	const r0 = ref(id)
	const r = await scoreCase(bench.cases.get(id), { plan: r0.plan, scene: r0.scene, reply: r0.reply })
	const softMiss = [...(Array.isArray(r.checks.outcomes) ? r.checks.outcomes : []), ...(Array.isArray(r.checks.relations) ? r.checks.relations : []), ...(r.checks.prop_checks ?? [])].filter((x) => x.soft && !x.ok).map((x) => x.kind ?? x.rel ?? x.prop)
	ok(`reference ${id} passes`, r.pass, `${r.failed.join(",")}${softMiss.length ? ` (soft misses: ${softMiss.join(", ")})` : ""} score ${r.score}`)
	ok(`reference ${id} has no prop out of range and no overlap`, !r.checks.prop_issues.length && !(r.checks.overlaps?.count ?? 0), JSON.stringify([r.checks.prop_issues, r.checks.overlaps]))
}

// ---- 3. mutations: each must fail what it breaks
async function mutant(id, label, mutate, expectFail, extra) {
	const r0 = clone(ref(id))
	mutate(r0)
	const r = await scoreCase(bench.cases.get(id), { plan: r0.plan, scene: r0.scene, reply: r0.reply })
	const hit = expectFail.every((k) => r.failed.includes(k))
	const more = extra ? extra(r) : true
	ok(`mutation caught: ${id} — ${label}`, !r.pass && hit && more, `failed: ${r.failed.join(",")}`)
}
await mutant("s1-ball-ramp", "a plan item of a type not in the catalog", (x) => x.plan.items.push({ id: "cat", type: "cat", place: { on: "table", x: 1 } }), ["unknown_types"], (r) => r.checks.unknown_types.count === 1)
await mutant("i1-cat-water", "the cat silently left out of `missing`", (x) => (x.plan.missing = x.plan.missing.filter((m) => !/cat/.test(m.asked))), ["missing"], (r) => r.checks.missing.recall === 0.5)
await mutant("s1-ball-ramp", "a library item reported as missing", (x) => x.plan.missing.push({ asked: "a ball", reason: "none", substitute_type: null }), ["missing"], (r) => r.checks.missing.precision === 0)
await mutant("k1-book-stack", "two books overlapping", (x) => (item(x.scene, "b2").y -= 0.02), ["overlaps"])
await mutant("k1-book-stack", "one book short", (x) => (x.scene.items = x.scene.items.filter((i) => i.id !== "b4")), ["counts"])
await mutant("e2-tallest-to-shortest", "candle and mug swapped", (x) => { const a = item(x.scene, "candle"); const b = item(x.scene, "mug"); [a.x, b.x] = [b.x, a.x] }, ["relations"])
await mutant("e2-tallest-to-shortest", "the can lying on its side (a forbidden type)", (x) => { const c = item(x.scene, "can"); c.type = "soda-can-side"; c.y = c.y - 0.0281 }, ["forbid"])
await mutant("m1-pendulum-golf", "the pendulum not pulled back", (x) => (item(x.scene, "pendulum").props.start_angle = 0), ["outcomes"])
await mutant("m1-pendulum-golf", "a 50 cm string instead of 40 cm", (x) => (item(x.scene, "pendulum").props.length = 0.5), ["prop_checks"])
await mutant("s2-five-dominoes", "nothing tips the first domino", (x) => { const d = item(x.scene, "d1"); d.angle = 0; d.y = 0.0015 }, ["outcomes"])
await mutant("e3-balance-can-book", "the ball 1 cm off centre", (x) => (item(x.scene, "ball").x += 0.01), ["relations"])
await mutant("d4-car-dog", "an unrelated change to the base scene", (x) => (item(x.scene, "car").x += 0.1), ["edit"])
await mutant("d2-wrecking-cardboard", "a brick left behind", (x) => x.scene.items.push({ id: "brick9", type: "brick", x: 1.8, y: 0.034, angle: 0, props: {} }), ["forbid", "edit"])
await mutant("d3-trampoline-bowling", "the bowling ball dropped at the side", (x) => (item(x.scene, "bowling").x = 1.62), ["relations"])
await mutant("m6-spring-launcher-cup", "the cup moved 25 cm", (x) => (item(x.scene, "cup").x += 0.25), ["outcomes"])
await mutant("z1-steel-rubber-drop", "balls at different heights", (x) => (item(x.scene, "rubber").y += 0.2), ["relations"])
await mutant("k1-book-stack", "duplicate ids (schema)", (x) => (item(x.scene, "b2").id = "b1"), ["schema"])
// the edit checks added for d6-d19 (moved / props / added / scene / reply_match), and the safety walls never count as added items
await mutant("d6-raise-bowling", "the bowling ball raised only 10 cm", (x) => (item(x.scene, "bowling").y -= 0.29), ["edit"])
await mutant("d6-raise-bowling", "the tennis ball moved too", (x) => (item(x.scene, "tennis").x += 0.1), ["edit"])
await mutant("d7-longer-pendulum", "the string 10 cm longer instead of 20", (x) => (item(x.scene, "pendulum").props.length = 0.7), ["edit"])
await mutant("d8-faster-belt", "the belt 1.5x instead of 2x", (x) => (item(x.scene, "belt").props.speed = 1.5), ["edit"])
await mutant("d9-cradle-question", "the question answered wrongly", (x) => (x.reply = "It has seven balls."), ["edit"])
await mutant("d10-second-cup", "the new cup 80 cm away", (x) => (item(x.scene, "cup2").x += 0.5), ["edit"])
await mutant("d12-ten-seconds", "the run left at 6 s", (x) => (x.scene.seconds = 6), ["edit"])
await mutant("d15-ball-on-books", "an extra visible wall added", (x) => x.scene.items.push({ id: "w9", type: "wall", x: 2.5, y: 0, angle: 0, props: {} }), ["edit"])
// the validators fix the small slips the benchmark measured instead of spending a repair turn on them (ai/schemas.mjs tidyObservation and
// normaliseItem): over-long free text, a size with a null side, a null material, "attached_to" as a state, "y" for y_m, an item-level angle_deg
{
	const S = await import(pathToFileURL(path.join(BENCH, "..", "schemas.mjs")).href)
	const { getCatalog } = await import(pathToFileURL(path.join(BENCH, "..", "catalog-digest.mjs")).href)
	const cat = await getCatalog()
	const obs = { summary: "x", objects: [{ label: "ball", count: 1, bbox: [0.1, 0.2, 0.2, 0.3], est_size_m: { w: null, h: 0.06 }, material: null, color: "a very long colour description that goes on and on and on and on", state: "attached_to", supports: null }], relations: [], motion_story: ["a"], view: { camera: "side", plane: "p", notes: "n".repeat(450) }, scale_hint: null, uncertain: ["u".repeat(350)] }
	const r = S.validate("observe", obs, { images: 1 })
	ok("observation slips are fixed in place, not repaired (long text cut, null size and material, state word)", r.ok && r.value.objects[0].est_size_m === null && r.value.objects[0].color.length <= 60 && r.value.objects[0].state === "resting" && r.warnings.length >= 5, r.errors.join("; "))
	const bad = S.validate("observe", { ...obs, objects: [{ ...obs.objects[0], bbox: [597, 100, 700, 300] }] }, { images: 1 })
	ok("an observation box on another scale is still an error (the repair fixes it)", !bad.ok && bad.errors.some((e) => /bbox/.test(e)))
	const plan = { title: "t", seconds: 3, items: [{ id: "ball", type: "golf-ball", place: { on: "air", x: 1, y: 0.5 } }, { id: "ramp", type: "plank", angle_deg: -10, place: { on: "table", x: 0.5 } }], missing: [], goals: [], tune: [], notes: "" }
	const p = S.validate("plan", plan, { catalog: cat.index })
	ok("plan slips are fixed in place: place.y read as y_m in the air, an item-level angle_deg moved into its place", p.ok && p.value.items[0].place.y_m === 0.5 && p.value.items[1].place.angle_deg === -10, p.errors.join("; "))
}
// the solver's planFromScene round trip (an edit must not move what it does not touch): every built-in scenario and ground-truth scene
{
	const { solve, planFromScene } = await import(pathToFileURL(path.join(BENCH, "..", "..", "web", "ai", "solver.js")).href)
	const dirs = [path.join(BENCH, "..", "..", "web", "scenarios"), path.join(BENCH, "gt")]
	for (const dir of dirs)
		for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && !x.includes(".meta"))) {
			const sc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))
			if (!Array.isArray(sc.items) || !sc.items.length) continue
			const out = new Map(solve(planFromScene(sc)).scene.items.map((i) => [i.id, i]))
			const drift = sc.items.map((i) => [i, out.get(i.id)]).filter(([a, b]) => !b || Math.abs(b.x - a.x) > 0.0015 || Math.abs(b.y - a.y) > 0.005 || Math.abs((b.angle ?? 0) - (a.angle ?? 0)) > 0.1)
			ok(`planFromScene round trip keeps every item of ${path.basename(dir)}/${f} in place`, !drift.length, drift.map(([a, b]) => `${a.id}: ${b ? `${(Math.hypot(b.x - a.x, b.y - a.y) * 1000).toFixed(1)} mm` : "gone"}`).join("; "))
		}
}
{
	const v = validatePlan({ items: [{ id: "p", type: "plank", props: { length: 9, colour: "red" }, place: { on: "nowhere" } }], missing: [{ reason: "x" }], seconds: 99 })
	ok("plan validator: bad support, missing `asked`, seconds out of range; prop out of range and unknown prop", !v.ok && v.errors.length === 3 && v.prop_issues.length === 2, JSON.stringify(v))
}

// ---- 4. ground truth
const gtIds = fs.readdirSync(path.join(BENCH, "gt")).filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json")).map((f) => f.replace(/\.json$/, ""))
const gtOf = (id) => JSON.parse(fs.readFileSync(path.join(BENCH, "gt", `${id}.json`), "utf8"))
for (const id of gtIds) {
	const g = gtOf(id)
	const r = scoreAgainstGT(g, g)
	const perfect = r.types.f1 === 1 && r.families.f1 === 1 && (r.order.kendall_tau === null || r.order.kendall_tau === 1) && r.position.mean_m < 1e-6 && Math.abs(r.position.scale - 1) < 1e-6 && r.size.mean_rel_err < 1e-9
	ok(`GT ${id} against itself is perfect`, perfect, JSON.stringify({ types: r.types, order: r.order, position: r.position, size: r.size.mean_rel_err }))
}
{
	const g = gtOf("desk-objects")
	const moved = clone(g)
	for (const it of moved.items) if (it.type !== "table") { it.x = 0.3 + (it.x - 0.3) * 1.25; it.y = it.y } // spread out 25 % along x
	const r = scoreAgainstGT(g, moved)
	ok("GT: a spread-out copy aligns back (scale found, small residual, order kept)", r.types.f1 === 1 && r.order.kendall_tau === 1 && Math.abs(r.position.scale - 0.8) < 0.08 && r.position.mean_rel < 0.05, JSON.stringify(r.position))
	const swapped = clone(g)
	const a = item(swapped, "bottle")
	const b = item(swapped, "candle");
	[a.x, b.x] = [b.x, a.x]
	const r2 = scoreAgainstGT(g, swapped)
	ok("GT: two items swapped end to end lowers the order score", r2.order.kendall_tau < 0.8, JSON.stringify(r2.order))
	const retyped = clone(g)
	item(retyped, "can").type = "water-bottle"
	const r3 = scoreAgainstGT(g, retyped)
	ok("GT: a different type lowers type precision and recall", r3.types.precision < 1 && r3.types.recall < 1, JSON.stringify(r3.types))
	const fewer = clone(g)
	fewer.items = fewer.items.filter((i) => i.id !== "apple" && i.id !== "cube")
	const r4 = scoreAgainstGT(g, fewer)
	ok("GT: two of nine items left out: recall 7/9, precision 1", Math.abs(r4.families.recall - 7 / 9) < 1e-3 && r4.families.precision === 1, JSON.stringify(r4.families))
}
{
	const g = gtOf("balls-lineup")
	const resized = clone(g)
	item(resized, "basketball").props = { diameter: 0.484 }
	item(resized, "basketball").y = 0.2435
	const r = scoreAgainstGT(g, resized)
	ok("GT: a ball at twice its size shows as a size error", r.size.worst[0].gt === "basketball" && r.size.worst[0].err > 0.9, JSON.stringify(r.size.worst[0]))
	const fam = clone(g)
	item(fam, "tennis-ball").type = "superball"
	const r2 = scoreAgainstGT(g, fam)
	ok("GT: a same-family substitute keeps family recall 1 but not exact types", r2.families.f1 === 1 && r2.types.f1 < 1, JSON.stringify([r2.families, r2.types]))
}
{
	const g = gtOf("pendulum-dominoes")
	const singles = clone(g)
	const row = item(singles, "dominoes")
	singles.items = singles.items.filter((i) => i.id !== "dominoes")
	// the same seven dominoes as separate items (a domino row counts as its dominoes)
	const { geometry } = await import(pathToFileURL(path.join(BENCH, "score.mjs")).href)
	const G = geometry(g)
	for (const s of G.byId.get("dominoes").solids) {
		const h = s.box.y1 - s.box.y0
		singles.items.push({ id: s.sid.replace("/", "-"), type: "domino", x: (s.box.x0 + s.box.x1) / 2, y: 0, angle: 0, props: { height: Math.round(h * 1e4) / 1e4, thickness: Math.round((s.box.x1 - s.box.x0) * 1e4) / 1e4 } })
	}
	void row
	const r = scoreAgainstGT(g, singles)
	ok("GT: seven single dominoes match a seven-domino row (families 1, positions ~0)", r.families.f1 === 1 && r.position.mean_m < 0.01 && r.order.kendall_tau === 1, JSON.stringify({ fam: r.families, pos: r.position, order: r.order }))
}

// ---- 4b. the hard ground-truth checks (scale fit, each true size, exact counts), and pass with them
for (const id of gtIds) {
	const g = gtOf(id)
	const h = scoreAgainstGT(g, g).hard
	ok(`GT ${id}: its own scene passes the hard checks`, h?.ok === true, JSON.stringify(h))
}
{
	const g = gtOf("wrecking-ball")
	const fewer = clone(g)
	const bricks = fewer.items.filter((i) => i.type === "brick").map((i) => i.id)
	fewer.items = fewer.items.filter((i) => !bricks.slice(3).includes(i.id))
	const h = scoreAgainstGT(g, fewer).hard
	ok("GT hard: 3 bricks for 5 fails the counts", bricks.length === 5 && !h.counts_ok && h.count_diffs.some((d) => /^brick: 5 in the picture, 3 built/.test(d)), JSON.stringify(h))
	const big = clone(gtOf("car-ramp-dominoes"))
	const car = big.items.find((i) => i.type === "toy-car")
	if (car) car.props = { ...(car.props ?? {}), length: 0.35 }
	const h2 = scoreAgainstGT(gtOf("car-ramp-dominoes"), big).hard
	ok("GT hard: a 35 cm car for a 20 cm one fails the size check", !!car && !h2.size_ok && h2.worst_size_err > 0.5, JSON.stringify(h2))
	const spread = clone(gtOf("desk-objects"))
	for (const it of spread.items) if (it.type !== "table") it.x = 0.3 + (it.x - 0.3) * 1.5
	const h3 = scoreAgainstGT(gtOf("desk-objects"), spread).hard
	ok("GT hard: a layout spread 1.5× fails the scale check", !h3.scale_ok && h3.scale_dev > 0.2, JSON.stringify(h3))
	const c = bench.cases.get("gt-wrecking-ball")
	const r = await scoreCase(c, { scene: fewer }, { simulate: false, gt: scoreAgainstGT(g, fewer) })
	ok("GT hard checks count for pass when given (gt-wrecking-ball with 3 bricks fails gt_counts)", !r.pass && r.failed.includes("gt_counts"), r.failed.join(","))
}

// ---- 4c. the bench's plan check knows every goal kind (in, falls, hits, moves) and still catches a goal naming nothing
{
	const items = [{ id: "a", type: "domino" }, { id: "b", type: "brick" }, { id: "c", type: "cup" }]
	const good = validatePlan({ items, goals: [{ kind: "falls", item: "a" }, { kind: "falls", items: ["a", "b"] }, { kind: "hits", item: "a", target: "b" }, { kind: "moves", item: "a", min_m: 0.1 }, { item: "a", container: "c" }] })
	const bad = validatePlan({ items, goals: [{ kind: "hits", item: "a", target: "zz" }, { item: "a", container: "nope" }] })
	ok("plan check: goals of every kind pass; a goal naming nothing fails", good.ok && !bad.ok && bad.errors.length === 2, JSON.stringify([good.errors, bad.errors]))
}

// ---- 5. every ground-truth render case passes its own derived checks on its own scene (and its hard ground-truth checks)
for (const e of bench.images.filter((i) => i.kind === "gt-render")) {
	const sc = JSON.parse(fs.readFileSync(path.join(BENCH, e.gt), "utf8"))
	const r = await scoreCase(bench.cases.get(e.id), { scene: sc }, { simulate: false, gt: scoreAgainstGT(sc, sc) })
	ok(`image case ${e.id} passes on its ground-truth scene`, r.pass, r.failed.join(","))
}
// ---- 5b. "make it work" pictures: their depicted outcomes count for pass (opts.hardOutcomes)
{
	const withRef = bench.images.filter((i) => i.kind !== "gt-render" && (i.expect?.outcomes ?? []).some((o) => o.soft) && fs.existsSync(path.join(BENCH, "reference", `${i.id}.json`)))
	for (const e of withRef) {
		const r0 = ref(e.id)
		const soft = await scoreCase(bench.cases.get(e.id), { plan: r0.plan, scene: r0.scene })
		const hard = await scoreCase(bench.cases.get(e.id), { plan: r0.plan, scene: r0.scene }, { hardOutcomes: true })
		const missed = (Array.isArray(soft.checks.outcomes) ? soft.checks.outcomes : []).filter((o) => !o.ok)
		ok(`image reference ${e.id}: hard outcomes fail exactly when a depicted outcome misses`, hard.pass === (soft.pass && missed.length === 0), JSON.stringify({ soft: soft.failed, hard: hard.failed, missed: missed.map((o) => o.kind) }))
	}
}
ok("image files: 10 photos, 4 sketches, every gt render on disk", bench.images.filter((i) => i.kind === "photo").length === 10 && bench.images.filter((i) => i.kind === "sketch").length === 4 && bench.images.every((i) => fs.existsSync(path.join(BENCH, i.file))))

// ---- report
const bad = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.detail && (!r.ok || /soft/.test(r.detail)) ? "  — " + r.detail : ""}`)
console.log(`\n${results.length - bad.length}/${results.length} checks pass`)
process.exit(bad.length ? 1 : 0)
