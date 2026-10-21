// What a video of a run is about: the subjects the export's directed cameras keep big, whole and readable (web/export/shots.js: the digest a
// director reads and the plan with no director, autoPlan; web/view3d.js films them). Universal: from any scene the sandbox can build and
// whatever the caller knows about the video.
//
// recognize({scene, run, catalog, registry, hints}) ->
//   {subjects: [{item, rank: "primary"|"context", roles, extent, when?, why}], scenery: [...], others: [...], primary: [ids], context: [ids],
//    groups: [[ids]], lanes, pairs, variable: [ids], readables: [...], moments: [{kind, t, ...}], evidence: {id: [kinds]}}
//
//   scene    the scene JSON (items with ids, types, names, props, held/fixed; goals; settings; release; seconds); sceneFromSim(sim) when a caller
//            has only the run (the lesson compositor loads runs into the view directly)
//   run      the /api/simulate answer, or the view's loaded run: {doc, track, summary}
//   catalog  {types: [{key, name, category, tags, dynamic, module, links, readouts}]} (GET /api/catalog; the app hands the view its own)
//   registry {goalKind: {fields: {field: "item"|"items"|...}, subject?, compares?, module?}} (the physics modules' goal kinds: registryOf(), from
//            web/sim/plugins.js's registry on globalThis when the page has loaded web/sim; {} otherwise, and every goal field naming an item counts)
//   hints    all optional, the most trusted first:
//     subjects {primary: [ids], context: [ids]}     a caller's or a person's own choice (wins over everything but invisibility)
//     roles    {role: [ids], "role@left": [...], "role@right": [...]}   the physics-lesson-video skill's binding.roles
//     brief    {items: [{role, why}], comparison: {change: {role}}, chain: [{step, roles, notice}], goals: [{kind, item, a, b, container, target, surface, metric}]}
//     cues     [{step, at, start, end, anchor}]     the binding's caption cues (moments the captions are tied to)
//     pairs    [{scene}]                           the other lane(s) of a lesson segment filmed as separate runs: what differs is the variable
//     text     [strings]                           the lesson's question and screen words, the request's nouns, the captions
//     pauses   [{where: "setup"|"result", t?}]      where a lesson stops to ask
// The order of evidence, the decision rules, the moments and the numbers are the ones of the focus scout's SUBJECTS.md (20 Oct 2026), measured on
// its labelled test set of 180 scenes (web/export/test/subjects.test.mjs scores this file on it). Pure: it reads only its arguments, imports
// nothing and returns the same answer for the same input. Extents here are physics outlines; the view measures the drawn models instead.

export const VERSION = 2

// ------------------------------------------------------------------------------------------------ vocabulary
const GROUND_TYPES = new Set(["table", "floor"])
const STOP_RE = /\b(stop|stops|curb|kerb|backstop|bumper|buffer|end stop)\b/i
const INSTRUMENT_WORDS = /\b(instrument|measure|meter|gauge|sensor|thermometer|stopwatch|timer|scale|balance|tape|protractor|speedometer|oscilloscope|anemometer|compass)\b/i
const CONTAINER_TYPES = new Set(["cup", "box", "bucket", "basket", "glass-jar", "plastic-cup", "beaker", "graduated-cylinder", "measuring-jug", "sand-tray", "water-tank", "bowl", "plate", "drink-cup", "saucepan", "evaporating-dish", "density-column", "candle-jar", "vacuum-jar", "bell-jar", "ripple-tank", "stream-table"])
const MEASURED_LINKS = new Set(["watch", "hook", "watch2", "watch3", "watch4"])
const VISIBLE_PROPS = /^(diameter|length|width|height|size|thickness|depth|sail|blocks|cells|turns|count|design|solute|liquid|material|grain|neck_mm|mass_g|grams|salt_pct|style|vessel|strength|overhang|band_turns|band_size|range|tilt|aim|fill_ml|gas|surface|wheel_diameter|lit|on|closed|shape|pattern|sample|strands|teeth|plunger|load|start_temp_c|ball_temp_c|water_temp_c|temp_c|power_w|beam_angle|head_height|outlet_mm|stand_cm|holes|kind|drives)$/
const GENERIC = new Set("a an the and or of on in at to from with is are be it its this that each both same now top bottom left right big bigger small smaller tiny more less than test tests testing tested valid experiment question our does do make makes look where what which who how picture gets has have sit sits only one two three four five six ten first second next other another so if farther faster higher lower slower roll rolls rolled stopped stop moves move moved goes go red blue green yellow gray grey white black orange purple pink brown watch see shows show there here then when after before time seconds metres meters meter metre cm mm lesson video screen item items thing things near far high low heavy light new old same just very much many some any all every let lets letting put puts same gentle steep long short wide narrow hard soft".split(" "))

// ------------------------------------------------------------------------------------------------ helpers
const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const uniq = (a) => [...new Set(a)]
const words = (s) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const stem = (w) => w.replace(/ies$/, "y").replace(/(ches|shes|xes|sses)$/, (m) => m.slice(0, -2)).replace(/s$/, "")
const key2 = (a, b) => [a, b].sort().join("\u0000")

function outlineLocal(body) {
	if (body.kind === "ball") {
		const out = []
		for (let i = 0; i < 16; i++) out.push([body.radius * Math.cos((i * Math.PI) / 8), body.radius * Math.sin((i * Math.PI) / 8)])
		return out
	}
	if (body.kind === "polygon") return body.points.map((p) => [p.x, p.y])
	const hw = (num(body.width, 0.05) / 2) * Math.max(1, num(body.taper, 1))
	const hh = num(body.height, 0.05) / 2
	return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
}
function worldPts(local, pose) {
	const s = num(pose.scale, 1), c = Math.cos(num(pose.angle)), n = Math.sin(num(pose.angle))
	return local.map(([x, y]) => [pose.x + (x * c - y * n) * s, pose.y + (x * n + y * c) * s])
}
function boxOf(pts) {
	if (!pts.length) return null
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
	for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
	return { x0, x1, y0, y1 }
}
const union = (bs) => { const v = bs.filter(Boolean); return v.length ? { x0: Math.min(...v.map((b) => b.x0)), x1: Math.max(...v.map((b) => b.x1)), y0: Math.min(...v.map((b) => b.y0)), y1: Math.max(...v.map((b) => b.y1)) } : null }
const sizeOf = (b) => (b ? Math.max(b.x1 - b.x0, b.y1 - b.y0) : 0)
const centre = (b) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 })
const gapBetween = (a, b) => (a && b ? Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1)) : Infinity)
function topAt(pts, x) {
	let best = null
	for (let i = 0; i < pts.length; i++) {
		const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]
		if (x < Math.min(ax, bx) - 1e-9 || x > Math.max(ax, bx) + 1e-9) continue
		const y = Math.abs(bx - ax) < 1e-9 ? Math.max(ay, by) : ay + ((by - ay) * (x - ax)) / (bx - ax)
		if (best === null || y > best) best = y
	}
	return best
}
/** The bottom of a world outline at x (the lowest point of its edges over x), or null. */
function bottomAt(pts, x) {
	let best = null
	for (let i = 0; i < pts.length; i++) {
		const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]
		if (x < Math.min(ax, bx) - 1e-9 || x > Math.max(ax, bx) + 1e-9) continue
		const y = Math.abs(bx - ax) < 1e-9 ? Math.min(ay, by) : ay + ((by - ay) * (x - ax)) / (bx - ax)
		if (best === null || y < best) best = y
	}
	return best
}
function bottomOf(pts) {
	let y = Infinity
	for (const p of pts) y = Math.min(y, p[1])
	const xs = pts.filter((p) => p[1] <= y + 0.01).map((p) => p[0])
	return { y, x0: Math.min(...xs), x1: Math.max(...xs) }
}
function isInstrument(t) {
	if (!(t?.readouts ?? []).length) return false
	if (/measur/i.test(t.category ?? "")) return true
	if ((t.tags ?? []).some((g) => INSTRUMENT_WORDS.test(g))) return true
	return INSTRUMENT_WORDS.test(t.name ?? "") || /\b(graph|board)\b/i.test(t.name ?? "")
}

// ------------------------------------------------------------------------------------------------ the run, item by item
function analyze(scene, run, catalog) {
	const types = new Map((catalog?.types ?? []).map((t) => [t.key, t]))
	const doc = run.doc, track = run.track
	const frames = []
	let last = {}
	for (const fr of track.frames ?? []) { last = { ...last, ...fr.placements }; frames.push({ t: fr.t, p: last }) }
	const T = frames.map((f) => f.t)
	const dur = num(doc.seconds, num(scene.seconds, T[T.length - 1] ?? 0))
	const release = num(scene.release, num(doc.release?.at, 0.5))
	const step = Math.max(1, Math.round(num(track.fps, 120) / 60))
	const K = []
	for (let k = 0; k < frames.length; k += step) K.push(k)
	if (K[K.length - 1] !== frames.length - 1) K.push(frames.length - 1)
	const items = new Map()
	for (const it of scene.items ?? []) {
		const t = types.get(it.type) ?? {}
		items.set(it.id, { id: it.id, it, type: it.type, t, name: it.name ?? "", cat: t.category ?? "", props: it.props ?? {}, solids: [] })
	}
	for (const s of doc.solids ?? []) items.get(s.item)?.solids.push(s)
	for (const I of items.values()) {
		const vis = I.solids.filter((s) => !s.hidden_3d)
		const local = new Map(vis.map((s) => [s.id, outlineLocal(s.body)]))
		const poseAt = (k, s) => frames[k]?.p[s.id] ?? frames[0]?.p[s.id] ?? { x: num(s.at?.x), y: num(s.at?.y), angle: num(s.angle) }
		const ptsAt = (k) => vis.flatMap((s) => { const q = poseAt(k, s); return num(q.scale, 1) <= 0.001 ? [] : worldPts(local.get(s.id), q) })
		const dyn = vis.filter((s) => s.kind === "dynamic")
		const roots = dyn.filter((s) => !(s.parent && !s.pivot))
		const area = (s) => { const b = boxOf(outlineLocal(s.body)); return (b.x1 - b.x0) * (b.y1 - b.y0) }
		const main = roots.length ? roots.reduce((a, b) => (area(b) > area(a) ? b : a)) : null
		const half = (s) => (s.body.kind === "ball" ? 0 : Math.max(...outlineLocal(s.body).map(([x, y]) => Math.hypot(x, y))))
		const bodySize = (s) => (s.body.kind === "ball" ? 2 * s.body.radius : 2 * half(s))
		Object.assign(I, { vis, poseAt, ptsAt, dyn, roots, main, frames, K })
		I.box0 = boxOf(ptsAt(0))
		I.finalBox = boxOf(ptsAt(frames.length - 1))
		I.pathBox = dyn.length ? union(K.filter((_, j) => j % 6 === 0).map((k) => boxOf(ptsAt(k)))) : I.box0
		I.size = sizeOf(I.box0)
		// visible motion of each root body: its centre's travel plus (not for a ball) its turn times its half size
		let vdisp = 0
		for (const s of roots) {
			const q0 = poseAt(0, s), h = half(s)
			for (const k of K) { const q = poseAt(k, s); vdisp = Math.max(vdisp, Math.hypot(q.x - q0.x, q.y - q0.y) + Math.abs(num(q.angle) - num(q0.angle)) * h) }
		}
		I.vdisp = vdisp
		I.movedAt = null
		I.restT = null
		if (main) {
			const q0 = poseAt(0, main), qf = poseAt(frames.length - 1, main), h = half(main), sz = bodySize(main)
			for (const k of K) {
				const q = poseAt(k, main)
				const v = Math.hypot(q.x - q0.x, q.y - q0.y) + Math.abs(num(q.angle) - num(q0.angle)) * h
				if (I.movedAt === null && v > Math.min(0.02, 0.25 * sz)) I.movedAt = frames[k].t
				if (Math.hypot(q.x - qf.x, q.y - qf.y) + Math.abs(num(q.angle) - num(qf.angle)) * h > Math.min(0.005, 0.1 * sz)) I.restT = frames[k].t
			}
			if (I.restT === null) I.restT = 0
		}
		// resizing (melting, dissolving, popping, breaking into pieces) and pieces that appear
		let minS = 1, maxS = 1, appeared = false, scaleSettle = null
		const sc0 = new Map(dyn.map((s) => [s.id, num(poseAt(0, s).scale, 1)]))
		const scf = new Map(dyn.map((s) => [s.id, num(poseAt(frames.length - 1, s).scale, 1)]))
		const changing = new Set()
		for (const k of K) for (const s of dyn) {
			const v = num(poseAt(k, s).scale, 1)
			if (Math.abs(v - sc0.get(s.id)) > 0.1) changing.add(s.id)
			if (sc0.get(s.id) <= 0.001 && v > 0.5) appeared = true
			if (Math.abs(v - scf.get(s.id)) > 0.02) scaleSettle = frames[k].t
		}
		for (const k of K) for (const s of dyn) if (changing.has(s.id)) { const v = num(poseAt(k, s).scale, 1); minS = Math.min(minS, v); maxS = Math.max(maxS, v) }
		Object.assign(I, { minScale: minS, maxScale: maxS, appeared, resized: minS < 0.9 || maxS > 1.1, scaleSettle })
		// readings
		I.readings = {}
		for (const [key, raw] of Object.entries(track.state?.[I.id] ?? {})) {
			let series = raw
			if (/(deg|angle|heading)/.test(key)) { series = []; let prev = null, off = 0; for (const v of raw) { if (typeof v === "number" && prev !== null) { const d = v - prev; if (d > 180) off -= 360; else if (d < -180) off += 360 } if (typeof v === "number") prev = v; series.push(typeof v === "number" ? v + off : v) } }
			const vals = series.filter((v) => typeof v === "number" && Number.isFinite(v))
			if (!vals.length) continue
			const lo = Math.min(...vals), hi = Math.max(...vals), v0 = vals[0], vl = vals[vals.length - 1]
			let tChange = null, tSettle = null
			if (hi - lo > 1e-9) {
				for (let j = 0; j < series.length; j++) if (Math.abs(series[j] - v0) > 0.02 * (hi - lo)) { tChange = T[Math.min(j, T.length - 1)]; break }
				for (let j = series.length - 1; j >= 0; j--) if (Math.abs(series[j] - vl) > 0.02 * (hi - lo)) { tSettle = T[Math.min(j + 1, T.length - 1)]; break }
			}
			let tPeak = null, dPeak = -1
			for (let j = 0; j < series.length; j++) { const d = Math.abs(series[j] - v0); if (Number.isFinite(d) && d > dPeak + 1e-12) { dPeak = d; tPeak = T[Math.min(j, T.length - 1)] } }
			// it has come back from its peak (a sound fading), not kept a new value; never an angle (a needle swinging round past 360 settles)
			const transient = hi - lo > 1e-9 && !/(deg|angle|heading|tilt)/.test(key) && Math.abs(vl - v0) < 0.6 * dPeak
			I.readings[key] = { v0, vl, lo, hi, tChange, tSettle, tPeak, transient }
		}
		const mainKey = (I.t.readouts ?? []).map((r) => r.key).find((k) => I.readings[k])
		I.mainReading = mainKey ? { key: mainKey, ...I.readings[mainKey] } : null
		I.links = Object.fromEntries((I.t.links ?? []).map((l) => [l.key, I.props[l.key]]).filter(([, v]) => typeof v === "string" && v))
		I.invisible = !!I.props.invisible_in_3d || (I.solids.length > 0 && I.solids.every((s) => s.hidden_3d) && !(I.t.links ?? []).length && !(I.t.readouts ?? []).length)
		I.instrument = isInstrument(I.t)
	}
	// impacts by item pair: the first time, the top speed
	const byId = new Map((doc.solids ?? []).map((s) => [s.id, s]))
	const pairs = new Map()
	for (const im of track.impacts ?? []) {
		if (!(im.speed >= 0.12)) continue
		const a = byId.get(im.a)?.item ?? im.a, b = byId.get(im.b)?.item ?? im.b
		if (a === b) continue
		const k = key2(a, b)
		if (pairs.has(k)) { const e = pairs.get(k); e.n++; e.speed = Math.max(e.speed, im.speed) }
		else pairs.set(k, { a, b, t: im.t, speed: im.speed, n: 1 })
	}
	const impacts = [...pairs.values()].sort((x, y) => x.t - y.t)
	const events = (track.events ?? []).map((e) => ({ t: num(e.t), items: (e.items ?? []).filter((i) => items.has(i)), text: e.text ?? "", kind: e.kind ?? "" }))
	return { types, doc, track, frames, T, dur, release, items, impacts, events, summary: run.summary ?? {} }
}

// ------------------------------------------------------------------------------------------------ recognize
export function recognize({ scene, run, catalog, registry = {}, hints = {} }) {
	const R = analyze(scene, run, catalog)
	const { items } = R
	const ids = [...items.keys()]
	const H = hints ?? {}
	const ev = new Map(ids.map((id) => [id, []]))
	const add = (id, kind, why, extra = {}) => { if (ev.has(id)) ev.get(id).push({ kind, why, ...extra }) }
	const has = (id, ...k) => (ev.get(id) ?? []).some((e) => k.includes(e.kind))
	const I = (id) => items.get(id)

	// A. what an item is: invisible, the ground, the room
	const gate = new Map()
	for (const id of ids) {
		const it = I(id)
		if (it.invisible) gate.set(id, { kind: "invisible", why: "hidden in 3D (a safety wall)" })
		else if (GROUND_TYPES.has(it.type)) gate.set(id, { kind: "ground", why: `the ${it.type}: what everything stands on` })
		else if (it.cat === "Scenery") gate.set(id, { kind: "room", why: `a ${it.t.name ?? it.type}: scenery in the catalog` })
	}

	// B. explicit: the caller's choice, the skill's roles and brief
	for (const id of H.subjects?.primary ?? []) add(id, "explicit", "the caller named it primary")
	for (const id of H.subjects?.context ?? []) add(id, "explicit-context", "the caller named it context")
	const brief = H.brief
	const uses = new Map()
	const use = (role, u) => { const r = String(role ?? "").replace(/@(left|right)$/, ""); if (r) { if (!uses.has(r)) uses.set(r, new Set()); uses.get(r).add(u) } }
	if (brief) {
		if (brief.comparison?.change?.role) use(brief.comparison.change.role, "variable")
		for (const g of brief.goals ?? []) {
			for (const f of ["item", "a", "b"]) if (g[f]) use(g[f], g.kind === "compare" || g.kind === "same" ? "compare" : "goal")
			for (const f of ["container", "target"]) if (g[f] && g[f] !== "table") use(g[f], "target")
			if (g.surface && g.surface !== "table") use(g.surface, "surface")
			for (const r of g.items ?? []) use(r, "goal")
		}
		for (const st of brief.chain ?? []) for (const r of st.roles ?? []) use(r, "chain")
	}
	const bound = new Set()
	if (H.roles) {
		const roleIds = (r) => uniq([...(H.roles[r] ?? []), ...(H.roles[`${r}@left`] ?? []), ...(H.roles[`${r}@right`] ?? [])])
		for (const role of uniq(Object.keys(H.roles).map((r) => r.replace(/@(left|right)$/, "")))) {
			const u = uses.get(role) ?? new Set()
			for (const id of roleIds(role)) {
				if (!items.has(id)) continue
				bound.add(id)
				if (u.has("variable")) add(id, "variable", `the compared role "${role}"`)
				if (u.has("compare")) add(id, "compare", `role "${role}" is compared by a goal`)
				if (u.has("goal")) add(id, "goal", `role "${role}" is what a goal measures`)
				if (u.has("target")) add(id, "target", `role "${role}" is a goal's container or target`)
				if (u.has("surface")) add(id, "support-goal", `role "${role}" is what a goal says things rest on`)
				if (u.has("chain")) add(id, "chain", `role "${role}" takes part in a chain step`)
				if (!u.size) add(id, "bound-only", `role "${role}" is bound, but no goal, step or comparison uses it`)
			}
		}
	}

	// the scene's goals: every item field the registry declares (a line or a track is a reference, not a subject)
	const goals = [...(scene.goals ?? [])]
	for (const g of R.summary.goals ?? []) if (!goals.some((x) => x.label && x.label === g.label && x.kind === g.kind)) goals.push(g)
	const comparePairs = []
	for (const g of goals) {
		const spec = registry[g.kind]
		// a registered kind says which fields name items; any other goal (the core "in", a kind this registry lacks) names items wherever
		// a field holds an item id or a list of them
		const fields = spec ? Object.entries(spec.fields ?? {}).filter(([, t]) => String(t).startsWith("item")).map(([f]) => f)
			: Object.keys(g).filter((f) => f !== "label" && f !== "kind" && [].concat(g[f] ?? []).some((v) => typeof v === "string" && items.has(v)))
		for (const f of fields) {
			for (const id of [].concat(g[f] ?? [])) {
				if (!items.has(id)) continue
				if (["line", "track", "around", "toward"].includes(f)) add(id, "reference", `the ${f} of goal "${g.label ?? g.kind}"`)
				else if (["container", "target", "into", "screen", "to"].includes(f)) add(id, "target", `the ${f} of goal "${g.label ?? g.kind}"`)
				else add(id, "goal", `named by goal "${g.label ?? g.kind}"`)
			}
		}
		if (g.a && g.b && items.has(g.a) && items.has(g.b) && spec?.compares !== false) comparePairs.push([g.a, g.b])
	}
	for (const [a, b] of comparePairs) { add(a, "compare", "one side of a comparison goal"); add(b, "compare", "the other side of a comparison goal") }

	// C. words: a lesson's questions and screens, the request's nouns, the captions; a bare scene's own name and goal labels.
	// An item is named by the words of its type and its name's last word (its noun), never by an adjective of its name.
	const text = [...(H.text ?? [])]
	if (!H.roles && !(H.text ?? []).length) { text.push(scene.name ?? ""); for (const g of goals) if (g.label) text.push(g.label) }
	const stems = new Set(text.flatMap(words).filter((w) => !GENERIC.has(w) && w.length > 2).map(stem))
	const hasWords = stems.size > 0
	if (hasWords) for (const id of ids) {
		if (bound.has(id)) continue // the brief already read the request into roles
		const it = I(id)
		const vocab = new Set(), tagWords = new Set()
		for (const w of [...words(it.type.replace(/-/g, " ")), ...words(it.t.name)]) if (!GENERIC.has(w) && w.length > 2) vocab.add(stem(w))
		for (const tag of it.t.tags ?? []) { const ws = words(tag); if (ws.length === 1 && !GENERIC.has(ws[0]) && ws[0].length > 2) tagWords.add(stem(ws[0])) }
		const nameWords = words(it.name).filter((w) => !GENERIC.has(w) && w.length > 2)
		if (nameWords.length) vocab.add(stem(nameWords[nameWords.length - 1]))
		const hit = [...vocab].filter((w) => stems.has(w))
		const tagHit = [...tagWords].filter((w) => stems.has(w) && !vocab.has(w))
		if (hit.length) add(id, "named", `the words name it ("${hit.join('", "')}")`)
		else if (tagHit.length) add(id, "named-weak", `the words use a synonym of it ("${tagHit.join('", "')}")`)
	}

	// D. the run: what moves, what changes, the instruments, the modules' happenings, links, light, air
	for (const id of ids) {
		const it = I(id)
		if (gate.get(id)?.kind === "invisible") continue
		if (it.main && it.vdisp >= Math.min(0.05, Math.max(0.02, 0.15 * it.size))) add(id, "mover", `moves (${it.vdisp.toFixed(2)} m)`)
		if (it.resized) add(id, "changer", `changes size (${it.minScale.toFixed(2)}..${it.maxScale.toFixed(2)})`)
		if (it.instrument) {
			const r = it.mainReading
			if (r && r.hi - r.lo > 1e-6 * Math.max(1, Math.abs(r.hi))) add(id, "instrument", `an instrument whose reading changes (${r.key})`)
			else add(id, "instrument-still", "an instrument whose reading stays")
		}
		for (const [key, other] of Object.entries(it.links)) {
			if (!items.has(other)) continue
			if (it.instrument && MEASURED_LINKS.has(key)) { add(id, "instrument-link", `measures ${other}`); add(other, "measured", `${id} measures it`) }
			else if (it.instrument) add(other, "reference", `${id}'s ${key}`)
			else if (it.type === "motion-trail") add(id, "trail", `the motion trail of ${other}`)
			else if (it.type === "wire") { add(id, "connector", `a wire to ${other}`); add(other, "wired", `wired by ${id}`) }
			else { add(id, "actor-link", `${key} -> ${other}`); add(other, "acted-on", `${id}'s ${key}`) }
		}
	}
	for (const e of R.events) {
		if (e.kind === "light" || e.kind === "shadow" || e.kind === "tir") {
			const [src, dst] = e.items
			if (src && dst) { add(src, "light", `its light reaches ${dst}`, { to: dst }); add(dst, "lit", `lit by ${src}`, { by: src }) }
			continue
		}
		if (e.kind === "dew") continue
		if (e.t >= R.dur - 0.01) { for (const id of e.items) add(id, "summary", `${e.kind || "event"}: ${e.text}`); continue }
		for (const id of e.items) add(id, "event", `${e.kind || "event"}: ${e.text}`, { t: e.t, n: e.items.length })
	}
	for (const a of R.doc.animated ?? []) {
		if (!a.airflow || !items.has(a.item)) continue
		const at = { x: num(a.at?.x) + num(a.airflow.at?.x), y: num(a.at?.y) + num(a.airflow.at?.y) }
		const dir = num(a.airflow.direction), D = num(a.airflow.diameter, 0.1)
		for (const id of ids) {
			if (!has(id, "mover")) continue
			const b = I(id).box0
			if (!b) continue
			const c = centre(b)
			const along = (c.x - at.x) * Math.cos(dir) + (c.y - at.y) * Math.sin(dir)
			const across = Math.abs(-(c.x - at.x) * Math.sin(dir) + (c.y - at.y) * Math.cos(dir))
			if (along > 0 && along < 30 * D && across < D / 2 + 0.22 * along + (b.y1 - b.y0) / 2) { add(a.item, "blows", `its air pushes ${id}`, { on: id }); add(id, "blown", `pushed by ${a.item}'s air`) }
		}
	}

	// E. geometry: what each candidate stands on or in at the start, what movers travel on, what holds those up, the stops, the hits
	const isCand = (id) => !gate.has(id) && (has(id, "explicit", "goal", "target", "compare", "variable", "named", "mover", "changer", "event", "instrument", "measured", "chain"))
	const startSupport = new Map() // item -> [ids it rests on or stands in at the start]
	const supportsOf = (m) => startSupport.get(m) ?? []
	for (const m of ids.filter((id) => !gate.has(id) && I(id).vis.length)) {
		const quiet = !isCand(m) // a thing with no evidence of its own: what it rests on is noted, but that makes nothing a support
		const pts = I(m).ptsAt(0)
		if (!pts.length) continue
		const bot = bottomOf(pts)
		for (const id of ids) {
			if (id === m || gate.get(id)?.kind === "invisible") continue
			const S = I(id)
			if (!S.vis.length || has(id, "mover") && I(m).box0.y0 < S.box0.y0) continue
			const xs = [bot.x0, (bot.x0 + bot.x1) / 2, bot.x1]
			const touch = S.vis.some((s) => { const sp = worldPts(outlineLocal(s.body), S.poseAt(0, s)); return xs.some((x) => { const top = topAt(sp, x); return top !== null && Math.abs(top - bot.y) < 0.006 }) })
			if (touch) { startSupport.set(m, [...supportsOf(m), id]); if (!quiet) add(id, "start-support", `${m} starts on it`, { of: m }) }
			else if (CONTAINER_TYPES.has(S.type) && S.box0 && I(m).box0) {
				const c = centre(I(m).box0)
				if (c.x > S.box0.x0 && c.x < S.box0.x1 && I(m).box0.y0 >= S.box0.y0 - 0.01 && I(m).box0.y0 <= S.box0.y1) { startSupport.set(m, [...supportsOf(m), id]); if (!quiet) add(id, "start-container", `${m} starts in it`, { of: m }) }
			}
		}
	}
	const movers = ids.filter((id) => has(id, "mover") && !gate.has(id))
	const pathOf = new Map()
	for (const m of movers) {
		const M = I(m)
		const found = new Set()
		for (const k of M.K.filter((_, j) => j % 4 === 0)) {
			const pts = M.ptsAt(k)
			if (!pts.length) continue
			const bot = bottomOf(pts)
			for (const id of ids) {
				if (id === m || found.has(id) || has(id, "mover") || gate.get(id)?.kind === "invisible") continue
				const S = I(id)
				if (!S.vis.length) continue
				if (S.vis.some((s) => { const top = topAt(worldPts(outlineLocal(s.body), S.poseAt(k, s)), (bot.x0 + bot.x1) / 2); return top !== null && Math.abs(top - bot.y) < 0.02 })) found.add(id)
			}
		}
		pathOf.set(m, found)
		for (const id of found) add(id, "path-support", `${m} travels on it`, { of: m })
	}
	// holders: a fixed thing that a support (or a candidate) rests on, which no mover touches
	for (const id of ids) {
		if (gate.has(id) || has(id, "mover", "path-support", "start-support", "start-container")) continue
		const S = I(id)
		if (!S.box0) continue
		for (const oid of ids) {
			if (oid === id || !(has(oid, "start-support", "path-support"))) continue
			const O = I(oid)
			if (!O.box0 || O.box0.y1 < S.box0.y1 - 0.005) continue // O must reach above S's top somewhere
			const lo = Math.max(S.box0.x0, O.box0.x0), hi = Math.min(S.box0.x1, O.box0.x1)
			if (hi < lo - 0.005) continue
			const Sp = S.vis.map((s) => worldPts(outlineLocal(s.body), S.poseAt(0, s))), Op = O.vis.map((s) => worldPts(outlineLocal(s.body), O.poseAt(0, s)))
			const touching = [lo, (lo + hi) / 2, hi].some((x) => Sp.some((sp) => { const top = topAt(sp, x); return top !== null && Op.some((op) => { const b = bottomAt(op, x); return b !== null && Math.abs(b - top) < 0.015 && b > S.box0.y0 + 0.5 * (S.box0.y1 - S.box0.y0) }) }))
			if (touching) { add(id, "holder", `it holds up ${oid}`, { of: oid }); break }
		}
	}
	// stops: named as one, or bound to a role nothing uses whose words say "stop"
	for (const id of ids) {
		const S = I(id)
		if (has(id, "mover")) continue
		if (STOP_RE.test(S.name) || STOP_RE.test(S.t.name ?? "")) add(id, "stop", `a stop ("${S.name || S.t.name}")`)
	}
	// hits: what a mover strikes that it did not start on, travel on, and that is not the ground
	const hits = []
	for (const im of R.impacts) {
		for (const [a, b] of [[im.a, im.b], [im.b, im.a]]) {
			if (!movers.includes(a) || !items.has(b)) continue
			if (gate.get(b)?.kind === "ground" || gate.get(b)?.kind === "invisible") continue
			if (supportsOf(a).includes(b)) continue
			if (pathOf.get(a)?.has(b)) {
				if (im.speed >= 1.0) { add(b, "landing", `${a} lands on it at ${im.speed.toFixed(1)} m/s`, { t: im.t, by: a }); hits.push({ by: a, on: b, t: im.t }) }
				continue
			}
			add(b, "hit", `${a} hits it at ${im.t.toFixed(2)} s`, { t: im.t, by: a })
			hits.push({ by: a, on: b, t: im.t })
		}
	}
	// riders: a mover that keeps its place on another mover (clay on a car)
	for (const a of movers) for (const b of movers) {
		if (a >= b) continue
		const A = I(a), B = I(b)
		if (!A.main || !B.main || gapBetween(A.box0, B.box0) > 0.02) continue
		const pa = A.poseAt(0, A.main), pb = B.poseAt(0, B.main)
		let worst = 0
		for (const k of A.K) { const qa = A.poseAt(k, A.main), qb = B.poseAt(k, B.main); worst = Math.max(worst, Math.hypot(qa.x - qb.x - (pa.x - pb.x), qa.y - qb.y - (pa.y - pb.y))); if (worst > 0.06) break }
		if (worst <= 0.06) { const [big, small] = A.size >= B.size ? [a, b] : [b, a]; add(small, "rider", `rides on ${big}`, { on: big }) }
	}
	// a container a mover ends inside (not the one it started in)
	for (const m of movers) {
		const M = I(m)
		if (!M.finalBox) continue
		const c = centre(M.finalBox)
		for (const id of ids) {
			const C = I(id)
			if (id === m || !CONTAINER_TYPES.has(C.type) || !C.box0 || supportsOf(m).includes(id)) continue
			if (c.x > C.box0.x0 && c.x < C.box0.x1 && M.finalBox.y0 >= C.box0.y0 - 0.01 && M.finalBox.y0 <= C.box0.y1) add(id, "target", `${m} ends inside it`)
		}
	}
	// contents: a loose thing resting on or in an instrument (a balance's pans, a scale's platform)
	for (const id of ids) {
		const S = I(id)
		if (!S.instrument || !S.box0) continue
		for (const oid of ids) {
			const O = I(oid)
			if (oid === id || gate.has(oid) || !O.box0 || !O.dyn.length) continue
			const c = centre(O.box0)
			if (c.x > S.box0.x0 && c.x < S.box0.x1 && O.box0.y0 >= S.box0.y0 - 0.005 && O.box0.y0 <= S.box0.y1 + 0.02 && O.size < 1.2 * S.size) add(oid, "content", `it rests on ${id}`)
		}
	}

	// F. lanes, and what differs between them; the other lanes of a lesson segment
	const laneOut = findLanes(R, H, gate, has, isCand)
	const namedOrBare = (id) => !hasWords || has(id, "named", "explicit", "goal")
	for (const d of laneOut.diffs) for (const id of d.items) if (items.has(id)) add(id, d.visible ? "variable" : "variable-hidden", d.why)
	for (const P of H.pairs ?? []) {
		const D = diffScenes(scene, P.scene, R)
		const differs = new Set(D.flatMap((d) => d.items))
		const kept = D.filter((d) => !(d.pose && d.items.every((id) => supportsOf(id).some((sp) => differs.has(sp)) && !D.some((o) => o !== d && !o.pose && o.items.includes(id)))))
		for (const d of D) if (!kept.includes(d)) for (const id of d.items) add(id, "follows", `${d.why}, because what it rests on differs`)
		for (const d of kept) for (const id of d.items) if (items.has(id)) add(id, d.visible ? "variable" : "variable-hidden", d.why)
	}

	// G. decide
	const rank = new Map()
	const recs = new Map()
	// a scene whose goals are about light (an eye that must see, a target the beam must hit, a shadow on a screen): the optical parts the
	// light reaches are its path
	const opticsGoal = goals.some((g) => registry[g.kind]?.module === "mod_optics")
	for (const id of ids) {
		const it = I(id)
		const E = ev.get(id)
		const k = new Set(E.map((e) => e.kind))
		const g = gate.get(id)
		const support = k.has("start-support") || k.has("path-support") || k.has("start-container") || k.has("support-goal")
		const moverish = k.has("mover") || k.has("changer")
		const long = (it.box0 && it.box0.x1 - it.box0.x0 > 1.2) || it.size > 1.2
		const named = k.has("named") || (k.has("named-weak") && (moverish || k.has("event") || k.has("instrument") || k.has("hit")))
		const told = k.has("explicit") || k.has("goal") || k.has("target") || k.has("compare") || k.has("landing")
		const variable = k.has("variable") && (!support || namedOrBare(id) || k.has("explicit") || (H.roles && bound.has(id)))
		let r, why = []
		if (g?.kind === "invisible" || g?.kind === "ground") { r = "scenery"; why = [g.why] }
		else if (k.has("explicit")) r = "primary"
		else if (k.has("explicit-context")) r = "context"
		else if (g?.kind === "room" && !told && !named) { r = "scenery"; why = [g.why] }
		else if (k.has("stop") && !told && !(named && !H.roles)) { r = "scenery"; why = ["a stop at the end of the way: it only stops what reaches it"] }
		else if (k.has("bound-only") && !moverish && !k.has("hit")) { r = STOP_RE.test(it.name) || k.has("holder") ? "scenery" : "other"; why = ["bound to a role that nothing uses"] }
		else if (k.has("holder") && !support && !told && !variable && !named) { r = "scenery"; why = ["it only holds something up"] }
		else if (told || variable || k.has("measured") || k.has("content") || k.has("rider")) r = "primary"
		else if (support && !moverish && !k.has("event")) r = "context"
		else if (named && !support) r = "primary"
		else if (k.has("instrument")) r = "primary"
		else if (moverish || (k.has("event") && !k.has("lit"))) r = "primary"
		else if (k.has("lit")) r = /Light & optics/.test(it.cat) && (E.some((e) => e.kind === "lit" && rankHint(e.by)) || opticsGoal) ? "primary" : "context"
		else if (k.has("light") || k.has("blows") || k.has("actor-link")) r = "context"
		else if (k.has("hit")) r = "context"
		else if (k.has("chain") || k.has("trail") || k.has("connector") || k.has("wired") || k.has("reference") || k.has("instrument-still") || k.has("acted-on") || k.has("variable-hidden") || k.has("blown")) r = "context"
		else r = "other"
		if (r === "primary" && long && !(told || variable || moverish || k.has("instrument"))) r = "context"
		if (r === "primary" && !it.vis.length) r = "context" // no body to frame (sunlight, a wire, a trail): its effect is shown elsewhere
		rank.set(id, r)
		recs.set(id, { item: id, rank: r, roles: tagsOf(k), why: why.length ? why : uniq(E.map((e) => e.why)).slice(0, 6), long })
	}
	function rankHint(src) { const e = ev.get(src) ?? []; return e.some((x) => ["goal", "target", "explicit", "named", "variable", "compare"].includes(x.kind)) }
	// second pass: the light a primary source sends and the air a primary fan blows make their targets subjects; a fan or a lamp that acts on a
	// primary is itself primary when the lesson names it or it is the variable; riders take their carrier's rank
	for (const id of ids) {
		const E = ev.get(id)
		for (const e of E) {
			if (e.kind === "rider" && rank.get(e.on) === "primary") rank.set(id, "primary")
			if (e.kind === "lit" && rank.get(e.by) === "primary" && rank.get(id) === "other") rank.set(id, "context")
		}
		if (rank.get(id) === "context" && has(id, "blows", "light", "actor-link") && (has(id, "named", "variable") || E.some((e) => e.kind === "blows" && rank.get(e.on) === "primary") && has(id, "variable", "named"))) rank.set(id, "primary")
		if (rank.get(id) === "context" && has(id, "hit") && has(id, "event")) rank.set(id, "primary")
		if (rank.get(id) === "other" && has(id, "wired") && E.some((e) => e.kind === "wired") && ids.some((w) => I(w).type === "wire" && Object.values(I(w).links).includes(id) && Object.values(I(w).links).some((o) => rank.get(o) === "primary"))) rank.set(id, "context")
	}
	// an actor whose light, air or link reaches a thing a goal names is primary: the cause of the outcome (a torch whose light makes the
	// measured shadow; never a lamp that only lights the room)
	const goalNamed = (id) => rank.get(id) === "primary" && has(id, "goal", "target", "compare", "explicit")
	for (const id of ids) {
		if (rank.get(id) !== "context") continue
		const E = ev.get(id)
		const reaches = E.filter((e) => e.kind === "light").map((e) => e.to).concat(E.filter((e) => e.kind === "blows").map((e) => e.on))
			.concat(Object.values(I(id).links).filter((o) => E.some((e) => e.kind === "actor-link")))
		if (reaches.some(goalNamed) && I(id).vis.length) rank.set(id, "primary")
	}
	for (const id of ids) {
		if (rank.get(id) === "primary" || gate.has(id) || !I(id).dyn.length || !I(id).vis.length) continue
		const on = supportsOf(id).filter((s) => rank.get(s) === "primary")
		const holdsUp = ids.some((o) => supportsOf(o).includes(id) && rank.get(o) === "primary")
		if (on.length && !holdsUp) { rank.set(id, "primary"); add(id, "load", `it rests on ${on[0]}, a subject`) }
	}
	// a chain role that the run shows moving or being struck is primary (a seesaw that tips only 14 degrees)
	for (const id of ids) if (rank.get(id) === "context" && has(id, "chain") && has(id, "hit", "mover", "changer")) rank.set(id, "primary")
	for (const id of ids) recs.get(id).rank = rank.get(id)

	// H. outputs
	const primary = ids.filter((id) => rank.get(id) === "primary")
	const context = ids.filter((id) => rank.get(id) === "context")
	const groups = []
	for (const id of ids) for (const e of ev.get(id)) if (e.kind === "rider") { const g = groups.find((x) => x.includes(e.on)); if (g) g.push(id); else groups.push([e.on, id]) }
	const extentOf = (id) => {
		const it = I(id), k = new Set(ev.get(id).map((e) => e.kind))
		if (it.appeared) return "local" // it breaks into pieces that fly: its place, not its pieces
		if (recs.get(id).long && !k.has("mover")) return "local"
		if ((k.has("path-support") || k.has("start-container")) && !k.has("mover") && it.size > 0.6) return "local"
		if (!k.has("mover") && (k.has("light") || k.has("blows") || k.has("actor-link")) && it.box0) {
			const E = ev.get(id)
			const targets = uniq([...E.filter((e) => e.kind === "light").map((e) => e.to), ...E.filter((e) => e.kind === "blows").map((e) => e.on), ...Object.values(it.links)]).filter((t) => rank.get(t) === "primary" && I(t)?.box0)
			const U = union(targets.map((t) => I(t).box0))
			if (U) {
				const both = union([U, it.box0])
				const area = (b) => Math.max(1e-6, (b.x1 - b.x0) * (b.y1 - b.y0))
				if (area(both) > 2.5 * area(U) && (it.box0.y1 - it.box0.y0) > 2 * (U.y1 - U.y0)) return "local"
			}
		}
		return "whole"
	}
	const subjects = ids.filter((id) => rank.get(id) === "primary" || rank.get(id) === "context").map((id) => ({ ...recs.get(id), extent: extentOf(id) }))
	const variable = ids.filter((id) => has(id, "variable") && rank.get(id) === "primary")
	const moments = findMoments(R, H, primary, ev, rank, hits, comparePairs, bound, laneOut, goals)
	const readables = findReadables(R, primary, variable, ev, rank, laneOut.lanes)
	for (const s of subjects) {
		const w = whenOf(R, s.item, ev, moments)
		if (w) s.when = w
	}
	return {
		version: VERSION,
		subjects,
		scenery: ids.filter((id) => rank.get(id) === "scenery").map((id) => recs.get(id)),
		others: ids.filter((id) => rank.get(id) === "other").map((id) => recs.get(id)),
		primary, context, groups,
		lanes: laneOut.lanes, pairs: laneOut.pairs,
		variable, readables, moments,
		evidence: Object.fromEntries([...ev].map(([k, v]) => [k, uniq(v.map((e) => e.kind))])),
	}
}

function tagsOf(k) {
	const out = []
	if (k.has("mover")) k = new Set([...k].filter((x) => x !== "start-support" && x !== "path-support" && x !== "start-container"))
	for (const [t, list] of [["mover", ["mover"]], ["changer", ["changer"]], ["rider", ["rider"]], ["variable", ["variable"]], ["target", ["target", "hit"]], ["instrument", ["instrument", "instrument-link", "instrument-still"]], ["actor", ["blows", "light", "actor-link"]], ["support", ["start-support", "path-support", "start-container"]], ["measured", ["measured", "content"]], ["holder", ["holder"]], ["stop", ["stop"]]]) if (list.some((x) => k.has(x))) out.push(t)
	return out
}

// ------------------------------------------------------------------------------------------------ lanes and differences
function findLanes(R, H, gate, has, isCand) {
	const { items } = R
	const out = { lanes: null, pairs: null, diffs: [] }
	if (H.roles && Object.keys(H.roles).some((r) => /@(left|right)$/.test(r))) {
		const L = [], Rr = [], pairs = []
		for (const [role, list] of Object.entries(H.roles)) {
			if (role.endsWith("@left")) { L.push(...list); const right = H.roles[role.replace("@left", "@right")] ?? []; list.forEach((id, i) => right[i] && pairs.push([id, right[i]])) }
			if (role.endsWith("@right")) Rr.push(...list)
		}
		out.lanes = [{ id: "left", items: uniq(L) }, { id: "right", items: uniq(Rr) }]
		out.pairs = pairs
		return out
	}
	const cand = [...items.values()].filter((it) => !gate.has(it.id) && it.box0 && !has(it.id, "holder", "stop") && isCand(it.id))
	const byType = new Map()
	for (const it of cand) { if (!byType.has(it.type)) byType.set(it.type, []); byType.get(it.type).push(it) }
	// a repeated type makes lanes only when its copies stand apart (a stack of touching blocks is one thing, not three lanes)
	const apart = (l) => l.every((a, i) => l.every((b, j) => j <= i || gapBetween(a.box0, b.box0) >= 0.01))
	const outcome = (it) => has(it.id, "mover", "changer", "event", "instrument", "goal", "compare", "measured", "target", "explicit")
	// copies that strike one another are links of one chain (a domino row knocking the next, pins knocking pins), not lanes
	const hitPairs = new Set(R.impacts.map((im) => key2(im.a, im.b)))
	const touching = (l) => l.some((a, i) => l.some((b, j) => j > i && hitPairs.has(key2(a.id, b.id))))
	const joiners = []
	for (const [t, l] of [...byType]) if (l.length >= 2 && (!apart(l) || !l.every(outcome) || touching(l))) { if (!touching(l)) joiners.push(...l); byType.delete(t) }
	const counts = new Map()
	for (const [, l] of byType) if (l.length >= 2) counts.set(l.length, (counts.get(l.length) ?? 0) + 1)
	if (!counts.size) return out
	const k = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
	const rep = [...byType.entries()].filter(([, l]) => l.length === k)
	const cx = (it) => (it.box0.x0 + it.box0.x1) / 2, cy = (it) => (it.box0.y0 + it.box0.y1) / 2
	const spread = (f) => rep.reduce((s, [, l]) => s + (Math.max(...l.map(f)) - Math.min(...l.map(f))), 0)
	const axis = spread(cy) > spread(cx) * 1.2 ? cy : cx
	const lanes = Array.from({ length: k }, (_, i) => ({ id: `lane ${i + 1}`, items: [] }))
	const pairs = []
	for (const [, l] of rep) { const s = [...l].sort((a, b) => axis(a) - axis(b)); s.forEach((it, i) => lanes[i].items.push(it.id)); pairs.push(s.map((it) => it.id)) }
	// supports repeated once per lane (each lane's ramp, tank, plate) join their lanes in order, and are compared too
	const jt = new Map()
	for (const it of joiners) { if (!jt.has(it.type)) jt.set(it.type, []); jt.get(it.type).push(it) }
	for (const [, l] of jt) if (l.length === k && apart(l)) { const s = [...l].sort((a, b) => axis(a) - axis(b)); s.forEach((it, i) => lanes[i].items.push(it.id)); pairs.push(s.map((it) => it.id)) }
	const mid = lanes.map((ln) => ln.items.reduce((s, id) => s + axis(items.get(id)), 0) / ln.items.length)
	const spacing = k > 1 ? Math.min(...mid.slice(1).map((c, i) => Math.abs(c - mid[i]))) : 1
	for (const it of [...cand, ...joiners]) {
		if (lanes.some((ln) => ln.items.includes(it.id))) continue
		const d = mid.map((c) => Math.abs(axis(it) - c))
		const i = d.indexOf(Math.min(...d)), second = [...d].sort((a, b) => a - b)[1] ?? Infinity
		if (d[i] < 0.35 * spacing && second > 0.65 * spacing) lanes[i].items.push(it.id)
	}
	out.lanes = lanes
	out.pairs = pairs
	const inside = (a, b) => { const A = items.get(a).box0, B = items.get(b).box0; const c = centre(A); return c.x > B.x0 && c.x < B.x1 && c.y > B.y0 - 0.02 && c.y < B.y1 + 0.3 }
	for (const P of pairs) {
		const Is = P.map((id) => items.get(id))
		const keys = uniq(Is.flatMap((it) => Object.keys(it.props)))
		const diff = keys.filter((kk) => new Set(Is.map((it) => JSON.stringify(it.props[kk] ?? null))).size > 1)
		const vis = diff.filter((kk) => VISIBLE_PROPS.test(kk))
		if (vis.length) out.diffs.push({ items: P, visible: true, why: `differs between the lanes in ${vis.join(", ")}` })
		else if (diff.filter((kk) => !/^(color|colour|name)$/.test(kk)).length) out.diffs.push({ items: P, visible: false, why: `differs between the lanes in ${diff.join(", ")} (not visible)` })
		const ys = Is.map((it) => it.box0.y0), angs = Is.map((it) => num(it.it.angle))
		if (axis === cx && Math.max(...ys) - Math.min(...ys) > 0.03 && Is.every((it) => it.dyn.length)) out.diffs.push({ items: P, visible: true, why: "starts at a different height in each lane" })
		if (Math.max(...angs) - Math.min(...angs) > 2) out.diffs.push({ items: P, visible: true, why: "tilted differently in each lane" })
	}
	for (const ln of lanes) for (const id of ln.items) {
		const it = items.get(id)
		if (pairs.some((p) => p.includes(id))) continue
		if (!lanes.every((o) => o === ln || o.items.some((oid) => items.get(oid).type === it.type))) out.diffs.push({ items: [id], visible: true, why: "in one lane only" })
	}
	for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
		const P1 = pairs[i], P2 = pairs[j]
		if (P1.length !== P2.length) continue
		if (P1.some((a, n) => inside(a, P2[n]) || inside(P2[n], a))) continue // one stands in the other (a boat in its tank)
		const d = P1.map((a, n) => { const A = items.get(a), B = items.get(P2[n]); return Math.hypot(cx(A) - cx(B), cy(A) - cy(B)) })
		if (Math.max(...d) - Math.min(...d) > 0.1 && Math.max(...d) > 1.3 * Math.min(...d)) out.diffs.push({ items: [...P1, ...P2], visible: true, why: "the distance between them differs between the lanes" })
	}
	return out
}

function diffScenes(A, B, R) {
	const out = []
	if (!B) return out
	const bi = new Map((B.items ?? []).map((i) => [i.id, i]))
	const cA = new Map(), cB = new Map()
	for (const i of A.items ?? []) cA.set(i.type, (cA.get(i.type) ?? 0) + 1)
	for (const i of B.items ?? []) cB.set(i.type, (cB.get(i.type) ?? 0) + 1)
	for (const a of A.items ?? []) {
		const it = R.items.get(a.id)
		if (!it || it.invisible || GROUND_TYPES.has(a.type) || it.cat === "Scenery") continue
		if ((cA.get(a.type) ?? 0) !== (cB.get(a.type) ?? 0)) { out.push({ items: [a.id], visible: true, why: `the other lane has ${cB.get(a.type) ?? 0} of these (${a.type}), this one ${cA.get(a.type)}` }); continue }
		const b = bi.get(a.id) && bi.get(a.id).type === a.type ? bi.get(a.id) : (B.items ?? []).find((x) => x.type === a.type) ?? bi.get(a.id)
		if (!b) continue
		if (b.type !== a.type) { out.push({ items: [a.id], visible: true, why: `a ${a.type} here, a ${b.type} in the other lane` }); continue }
		const keys = uniq([...Object.keys(a.props ?? {}), ...Object.keys(b.props ?? {})])
		const diff = keys.filter((k) => JSON.stringify((a.props ?? {})[k] ?? null) !== JSON.stringify((b.props ?? {})[k] ?? null))
		const vis = diff.filter((k) => VISIBLE_PROPS.test(k))
		if (vis.length) out.push({ items: [a.id], visible: true, why: `the other lane's differs in ${vis.join(", ")}` })
		else if (diff.filter((k) => !/^(color|colour)$/.test(k)).length) out.push({ items: [a.id], visible: false, why: `the other lane's differs in ${diff.join(", ")} (not visible)` })
		const dx = Math.abs(num(a.x) - num(b.x)), dy = Math.abs(num(a.y) - num(b.y)), da = Math.abs(num(a.angle) - num(b.angle))
		if ((dx > 0.03 || dy > 0.03 || da > 2) && !STOP_RE.test(a.name ?? "")) out.push({ items: [a.id], visible: true, pose: true, why: `it stands elsewhere in the other lane (${dx.toFixed(2)}, ${dy.toFixed(2)} m, ${da.toFixed(1)} degrees)` })
	}
	return out
}

// ------------------------------------------------------------------------------------------------ moments
function settleOf(R, id, ev, exits) {
	const it = R.items.get(id)
	const E = ev.get(id) ?? []
	const k = new Set(E.map((e) => e.kind))
	let t = 0
	if (k.has("mover")) return exits.has(id) ? exits.get(id) : (it.restT ?? R.dur)
	{
		if (k.has("changer") && it.scaleSettle !== null) t = Math.max(t, it.scaleSettle)
		for (const e of E) if (e.kind === "event" && e.t !== undefined) t = Math.max(t, e.t)
		const mr = it.mainReading
		if (mr && mr.tSettle !== null && (it.instrument || k.has("compare") || k.has("target") || k.has("goal"))) t = Math.max(t, mr.transient ? mr.tPeak : mr.tSettle)
	}
	return Number.isFinite(t) ? t : 0
}

function findMoments(R, H, primary, ev, rank, hits, comparePairs, bound, laneOut, goals = []) {
	const M = []
	const rel = R.release
	const setupCtx = uniq(primary.flatMap((id) => [...ev.entries()].filter(([o, E]) => rank.get(o) === "context" && E.some((e) => (e.kind === "start-support" || e.kind === "start-container") && e.of === id)).map(([o]) => o)))
	M.push({ kind: "setup", t: 0, t_end: rel, hold: primary, context: setupCtx })
	if (rel > 0) M.push({ kind: "release", t: rel })
	const isP = (id) => primary.includes(id)
	const moverP = primary.filter((id) => (ev.get(id) ?? []).some((e) => e.kind === "mover"))
	// exits: a primary mover that falls far below the table or ends far from every other primary after its last interaction
	const exits = new Map()
	const others = (id) => union(primary.filter((o) => o !== id).map((o) => (exits.has(o) ? R.items.get(o).box0 : R.items.get(o).pathBox)))
	for (const id of moverP) {
		const it = R.items.get(id)
		const region = others(id)
		if (!it.main || it.appeared) continue // a thing broken into pieces stays where it broke (its pieces may fly)
		for (const k of it.K) {
			const q = it.poseAt(k, it.main)
			const far = region ? gapBetween({ x0: q.x, x1: q.x, y0: q.y, y1: q.y }, region) > Math.max(1.0, sizeOf(region)) : false
			if (q.y < -0.3 || (far && moverP.length > 1 && hits.some((h) => h.by === id && h.t < it.frames[k].t))) { exits.set(id, it.frames[k].t); M.push({ kind: "exit", item: id, t: it.frames[k].t }); break }
		}
	}
	// starts: a primary begins to move, or (for one that does not move) its main reading or its size begins to change
	for (const id of primary) {
		const it = R.items.get(id)
		const E = ev.get(id) ?? []
		if (E.some((e) => e.kind === "mover") && it.movedAt !== null) M.push({ kind: "start", item: id, t: it.movedAt, why: "it begins to move" })
		const poseLike = Object.entries(it.readings).filter(([k, r]) => /(tilt|angle|heading|_deg$)/.test(k) && r.tChange !== null && r.tChange > 0.05).map(([, r]) => r.tChange)
		const mainC = it.mainReading?.tChange
		const cands = [...poseLike, ...(mainC !== null && mainC !== undefined && mainC > 0.05 ? [mainC] : [])]
		const c = cands.length ? Math.min(...cands) : null
		if (c !== null && (!E.some((e) => e.kind === "mover") || it.movedAt === null || Math.abs(c - it.movedAt) > 0.3)) M.push({ kind: "start", item: id, t: c, why: "its reading begins to change" })
	}
	// meetings: first impacts between subjects, a primary reaching a stop, a primary landing on the ground after a fall
	for (const im of R.impacts) {
		const A = R.items.get(im.a), B = R.items.get(im.b)
		if (!A || !B) continue
		const pa = isP(im.a), pb = isP(im.b)
		const ground = (it) => it && (it.type === "table" || it.type === "floor")
		const stop = (id) => (ev.get(id) ?? []).some((e) => e.kind === "stop")
		if ((pa && pb) || (pa && (rank.get(im.b) === "context" || stop(im.b)) && !ground(B)) || (pb && (rank.get(im.a) === "context" || stop(im.a)) && !ground(A))) M.push({ kind: "event", what: `${im.a} meets ${im.b}`, t: im.t, items: [im.a, im.b] })
		else if ((pa && ground(B)) || (pb && ground(A))) {
			const id = pa ? im.a : im.b
			const it = R.items.get(id)
			const onGround = (ev.get(pa ? im.b : im.a) ?? []).some((e) => e.kind === "start-support" && e.of === id)
			if (!onGround && !M.some((x) => x.landing === id)) M.push({ kind: "event", what: `${id} lands`, t: im.t, items: [id], landing: id })
		}
	}
	// the modules' happenings that name a primary, and the goals' own times
	for (const e of R.events) {
		if (["light", "tir", "dew", "shadow"].includes(e.kind)) continue
		if (e.items.some(isP)) M.push({ kind: "event", what: e.text, t: e.t, items: e.items })
	}
	for (const g of R.summary.goals ?? []) {
		if (typeof g.t !== "number" || !(g.t > 0)) continue
		const its = ["item", "a", "b", "container", "scale", "meter", "compass"].map((f) => g[f]).filter((x) => typeof x === "string")
		if (its.some(isP) && !M.some((m) => m.kind === "event" && Math.abs(m.t - g.t) < 0.05)) M.push({ kind: "event", what: `goal: ${g.label}`, t: g.t, items: its })
	}
	// instruments: a stopwatch's stop, a reading settling
	for (const id of primary) {
		const it = R.items.get(id)
		if (!it.instrument) continue
		const r = it.readings
		for (const [key, v] of Object.entries(r)) if (/^(start|enter|entered|exit|exited|hit|landed|crossed)_s$/.test(key) && v.vl > 0.01 && v.vl < R.dur - 0.01) M.push({ kind: "event", what: `${id}: ${key} at ${v.vl.toFixed(2)} s`, t: v.vl, items: [id, ...Object.values(it.links)] })
		if (r.stop_s && r.stop_s.vl > 0 && r.stop_s.vl < R.dur) M.push({ kind: "event", what: `${id} stops at ${(r.stop_s.vl - num(r.start_s?.vl)).toFixed(2)} s`, t: r.stop_s.vl, items: [id] })
		else if (it.mainReading?.tSettle) M.push({ kind: "event", what: `${id}'s ${it.mainReading.key} settles`, t: it.mainReading.tSettle, items: [id], settle: true })
	}
	// bounces: the top of the first bounce of a primary that falls and comes back up 5 cm or more
	for (const id of moverP) {
		const a = apex(R, id)
		if (a) M.push({ kind: "event", what: `${id}'s first bounce peaks`, t: a.t, items: [id], apex: true })
	}
	// rests: a primary mover at rest, a primary's change over
	for (const id of moverP) { const it = R.items.get(id); if (it.restT !== null && it.restT < R.dur - 1e-6 && !exits.has(id)) M.push({ kind: "stop", item: id, t: it.restT }) }
	for (const id of primary) { const it = R.items.get(id); if (it.resized && it.scaleSettle !== null && it.scaleSettle < R.dur - 0.05 && !moverP.includes(id)) M.push({ kind: "stop", item: id, t: it.scaleSettle, why: "its change is over" }) }
	// the result: when what the video compares or shows is decided
	// who carries the outcome: what a comparison compares (and its counterparts in the other lanes), else the things paired across the
	// lanes, else what the goals, events and instruments are about, else every primary
	let carriers = []
	let holdHint = null
	const metric = (H.brief?.goals ?? []).find((g) => (g.kind === "compare" || g.kind === "same") && g.metric)?.metric
	const cmpRoles = (H.brief?.goals ?? []).filter((g) => g.kind === "compare" || g.kind === "same").flatMap((g) => [g.a, g.b]).filter(Boolean)
	const lanePairs = (laneOut.pairs ?? []).filter((p) => p.length > 1 && p.every(isP))
	const targets = primary.filter((id) => (ev.get(id) ?? []).some((e) => e.kind === "target"))
	if (cmpRoles.length && H.roles) carriers = uniq([...cmpRoles.flatMap((r) => H.roles[r] ?? []), ...targets])
	else if (comparePairs.length) carriers = uniq([...comparePairs.flat(), ...targets, ...lanePairs.flat()])
	else if (lanePairs.length) carriers = uniq(lanePairs.flat())
	else {
		const outcome = primary.filter((id) => (ev.get(id) ?? []).some((e) => ["goal", "target", "changer", "event", "instrument", "measured", "compare"].includes(e.kind)))
		const movingP = primary.filter((id) => (ev.get(id) ?? []).some((e) => e.kind === "mover" || e.kind === "rider"))
		carriers = outcome.length ? outcome : movingP.length ? movingP : primary
		// the story's last goal says what the result is (goals are written in the order things happen): a thing ending in a container
		// first of all, else the last goal's things
		const idsOfGoal = (g) => ["item", "container", "target", "a", "b", "items"].flatMap((f) => [].concat(g[f] ?? [])).filter((x) => typeof x === "string" && isP(x))
		const withIds = goals.filter((g) => idsOfGoal(g).length)
		const inGoal = [...withIds].reverse().find((g) => g.container && (g.kind === "in" || !g.kind))
		const lastGoal = inGoal ?? withIds[withIds.length - 1]
		// ... but only for a chain of causes (each link set going by a hit from the one before), never for goals that are parallel facts
		// (four things that sink or float, a tap that fills a tank)
		const links = new Set(hits.filter((h) => moverP.includes(h.by) && isP(h.on) && R.items.get(h.on).movedAt !== null && R.items.get(h.on).movedAt >= h.t - 0.05 && R.items.get(h.on).movedAt <= h.t + 0.5).map((h) => h.on))
		if (links.size >= 2 && withIds.length > 1 && lastGoal && idsOfGoal(lastGoal).length < carriers.length) holdHint = idsOfGoal(lastGoal)
	}
	carriers = carriers.filter(isP)
	const pairsOfCarriers = [...comparePairs, ...lanePairs].filter((p) => p.every((id) => carriers.includes(id)))
	let result
	if (metric === "bounce" || metric === "rise") { const a = carriers.map((id) => apex(R, id)?.t).filter((x) => x !== undefined); result = a.length ? Math.max(...a) : null }
	else if (metric === "drop" || metric === "max_speed") { const l = M.filter((m) => m.landing && carriers.includes(m.landing)).map((m) => m.t); result = l.length ? Math.max(...l) : null }
	if (result === undefined || result === null) {
		// a carrier that is used up (melts away, dissolves to nothing) takes its evidence with it: the comparison shows best the moment the
		// first one is gone while the others are still there
		const asym = []
		for (const p of pairsOfCarriers) {
			const v = p.map((id) => vanishOf(R, id))
			for (let i = 0; i < p.length; i++) if (v[i] !== null && p.some((_, j) => j !== i && (v[j] === null || v[j] > v[i] + 0.1 * R.dur))) asym.push(v[i])
		}
		if (asym.length) result = Math.min(...asym)
		else {
			let st = carriers.map((id) => settleOf(R, id, ev, exits)).filter((x) => x > 0)
			if (!st.length) st = primary.map((id) => settleOf(R, id, ev, exits)).filter((x) => x > 0)
			result = st.length ? Math.max(...st) : Math.min(R.dur, Math.max(rel, 0.5))
		}
	}
	// a chain's result is its last link: the brief's last step, or (bare) the movers set going last and what they end in
	let chainEnd = null
	if (!comparePairs.length && !lanePairs.length) {
		const steps = H.brief?.chain ?? []
		if (steps.length >= 2 && H.roles) chainEnd = uniq(steps[steps.length - 1].roles.flatMap((r) => [...(H.roles[r] ?? []), ...(H.roles[`${r}@left`] ?? []), ...(H.roles[`${r}@right`] ?? [])])).filter(isP)
		else if (!goals.length) {
			const starts = moverP.map((id) => ({ id, t: R.items.get(id).movedAt })).filter((x) => x.t !== null).sort((a, b) => a.t - b.t)
			if (starts.length >= 3 && starts[starts.length - 1].t - starts[0].t > 0.5) {
				const last = starts[starts.length - 1].t
				chainEnd = uniq([...starts.filter((x) => x.t >= last - 0.6).map((x) => x.id), ...targets])
			}
		}
	}
	const holdR = (chainEnd?.length ? chainEnd : holdHint?.length ? holdHint : carriers.length ? carriers : primary).filter((id) => !exits.has(id))
	if ((chainEnd?.length || holdHint?.length) && !metric) {
		// the result is there once the things it is about have settled (the pins down, though the ball rolls on)
		const st = holdR.map((id) => settleOf(R, id, ev, exits)).filter((x) => x > 0)
		if (st.length) result = Math.max(...st)
	}
	const ctxR = uniq([...primary.filter((id) => !holdR.includes(id) && !exits.has(id)), ...holdR.flatMap((id) => (ev.get(id) ?? []).filter((e) => e.kind === "rider").map((e) => e.on))]).filter((id) => !holdR.includes(id))
	M.push({ kind: "result", t: Math.min(R.dur, result), hold: holdR, context: ctxR })
	for (const c of H.cues ?? []) if (typeof c.at === "number") M.push({ kind: "cue", t: c.at, step: c.step })
	for (const p of H.pauses ?? []) M.push({ kind: "pause", where: p.where, t: p.where === "setup" ? 0 : num(p.t, result) })
	M.push({ kind: "end", t: R.dur })
	return M.sort((a, b) => a.t - b.t)
}

/** When a thing is used up: its bodies shrink to nothing (and stay so), or null. */
function vanishOf(R, id) {
	const it = R.items.get(id)
	if (!it?.dyn?.length || it.minScale > 0.05 || it.appeared) return null // (a thing broken into pieces is not used up: its pieces stay)
	let t = null
	for (const k of it.K) {
		const alive = it.dyn.some((s) => num(it.poseAt(k, s).scale, 1) > 0.05)
		if (!alive && t === null) t = it.frames[k].t
		if (alive) t = null
	}
	return t
}

function apex(R, id) {
	const it = R.items.get(id)
	if (!it?.main) return null
	const hit = R.impacts.find((im) => (im.a === id || im.b === id) && R.items.get(im.a === id ? im.b : im.a) && ["table", "floor"].includes(R.items.get(im.a === id ? im.b : im.a).type))
	if (!hit) return null
	let best = null, bestY = -Infinity, y0 = null
	for (const k of it.K) {
		const t = it.frames[k].t
		if (t < hit.t) continue
		const q = it.poseAt(k, it.main)
		if (y0 === null) y0 = q.y
		if (q.y > bestY) { bestY = q.y; best = t }
		else if (q.y < bestY - 0.01) break
	}
	return best !== null && bestY - y0 >= 0.05 ? { t: best, y: bestY } : null
}

function whenOf(R, id, ev, moments) {
	const own = moments.filter((m) => m.item === id || (m.items ?? []).includes(id)).map((m) => m.t)
	if (!own.length) return null
	return [Math.max(0, Math.min(...own) - 0.35), Math.min(R.dur, Math.max(...own) + 0.35)]
}

// ------------------------------------------------------------------------------------------------ readables
function findReadables(R, primary, variable, ev, rank, lanes) {
	const out = []
	const E = (id) => ev.get(id) ?? []
	const has = (id, k) => E(id).some((e) => e.kind === k)
	for (const id of primary) {
		const it = R.items.get(id)
		if (it.instrument) out.push({ what: `${it.name || it.t.name}: its ${it.mainReading?.key ?? "reading"} (the face large enough to read)`, kind: "face", items: [id, ...Object.values(it.links).filter((o) => R.items.has(o))], when: ["run", "result"] })
	}
	if (variable.length) out.push({ what: "what differs between the lanes (or what the lesson tests): every copy at the same scale", kind: "variable", items: variable, when: ["setup", "result"] })
	for (const id of primary) {
		const it = R.items.get(id)
		if (has(id, "mover") && !has(id, "rider")) {
			const from = R.items.get(id) && [...ev.entries()].filter(([o, list]) => list.some((e) => (e.kind === "start-support") && e.of === id) && rank.get(o) !== "scenery").map(([o]) => o)
			out.push({ what: from.length ? `where ${id} ends, against where it started (${from.join(", ")})` : `where ${id} ends`, kind: "position", items: [id, ...from], when: ["result"] })
		}
		if (has(id, "changer")) out.push({ what: `how much ${id} has changed (its size)`, kind: "size", items: [id], when: ["setup", "result"] })
		if (has(id, "target") && !has(id, "mover")) {
			const by = [...new Set(E(id).filter((e) => e.kind === "target" || e.kind === "landing").map((e) => e.by).filter(Boolean))]
			out.push({ what: by.length ? `${by.join(", ")} in or on ${id}` : `what ends in or on ${id}`, kind: "state", items: [id, ...by], when: ["result"] })
		}
		const st = E(id).find((e) => e.kind === "event" && /break|crack|smash|shatter|pop|melt|dissolv|light|sound|boil|crush|collaps/i.test(e.why))
		if (st) out.push({ what: `${id}'s change of state (${st.why.replace(/^[^:]*:\s*/, "").slice(0, 80)})`, kind: "state", items: [id], when: ["run", "result"], t: st.t })
	}
	if (lanes?.length > 1) out.push({ what: "the lanes side by side, one scale for all (a fair comparison)", kind: "lanes", items: lanes.flatMap((l) => l.items.filter((id) => primary.includes(id))), when: ["setup", "result"] })
	return out
}

// ------------------------------------------------------------------------------------------------ for callers that have only a run
/** A scene as far as a run tells it, for a caller that loaded a run without its scene (the lesson compositor's lanes): the items from the
 *  document's solids (their item ids and types, the props they were built with, where their first solid stands at the start, the names the
 *  run's stories give), the goals from the run's summary (with their item fields), the release and the length. Names are what it lacks: the
 *  words a name adds (its noun, "stop") are then the type's and the catalog's. */
export function sceneFromSim(sim) {
	const doc = sim?.doc ?? {}
	const f0 = sim?.track?.frames?.[0]?.placements ?? {}
	const names = new Map((sim?.summary?.stories ?? []).filter((s) => s && typeof s.item === "string" && typeof s.name === "string").map((s) => [s.item, s.name]))
	const items = new Map()
	for (const s of doc.solids ?? []) {
		if (typeof s.item !== "string" || items.has(s.item)) continue
		const p = f0[s.id] ?? { x: num(s.at?.x), y: num(s.at?.y), angle: num(s.angle) }
		items.set(s.item, { id: s.item, type: s.itemType ?? s.item, name: names.get(s.item) ?? "", x: num(p.x), y: num(p.y), angle: (num(p.angle) * 180) / Math.PI, props: sim?.resolved?.[s.item] ?? {} })
	}
	return { name: String(doc.id ?? "").replace(/[-_]+/g, " "), items: [...items.values()], goals: [], release: num(doc.release?.at, 0.5), seconds: num(doc.seconds, 0) }
}

/** The physics modules' goal kinds as recognize() reads them, from web/sim/plugins.js's registry (its `goals` Map), or {} without one. */
export function registryOf(reg) {
	const out = {}
	const goals = reg?.goals
	if (!goals || typeof goals.entries !== "function") return out
	for (const [kind, k] of goals.entries()) out[kind] = { module: k?.module ?? null, fields: k?.fields ?? {}, subject: k?.subject ?? null, compares: k?.compares ?? null }
	return out
}
