// Scoring helpers for the AI scene builder's eval set (ai/bench/). Deterministic and offline: the geometry, the overlaps and the physics come
// from the app's own browser builder and engine (web/sim, run in-process: same results as POST /api/simulate). The rubric judge (an LLM) is
// called by the benchmark runner, not here.
//
//   import { scoreCase, scoreAgainstGT, simulate, loadBench } from "./score.mjs"
//   const bench = loadBench()                                   // cases/text.json + images/index.json (+ groups)
//   const sim = await simulate(scene)                           // {doc, track, summary, warnings, resolved, ms} | {error}
//   const r = await scoreCase(bench.cases.get("s1-ball-ramp"), { plan, scene, sim })   // sim optional: simulated here when missing
//   const g = scoreAgainstGT(gtScene, scene)                    // for a ground-truth image case
//
// opts: {simulate: false (never run the engine here), alwaysSimulate (run it even without outcomes, for the sim-error check), validatePlan(plan)
// -> {ok, errors} (an extra schema check, added to the built-in one), groups (instead of the case file's), hardOutcomes (every outcome
// counts for pass, `soft` or not: a picture asked to "make it work" must show what it depicts), gt (a scoreAgainstGT result: its `hard`
// checks count for pass: fitted scale, each matched item's true size, the exact count of each type)}.
//
// The bench (ai/bench/):
//   cases/text.json       30 text cases (simple, chain, stacking, everyday, vehicles, mechanisms, sizes-materials, vague, impossible, edit)
//   images/index.json     40 image cases: 10 generated photos + 4 sketches (images/*.png), 26 renders of 18 ground-truth scenes (gt/)
//   gt/<id>.json          a ground-truth scene; gt/<id>.png (+ -b.png: a second angle) its render; gt/<id>.meta.json cameras + item boxes
//   reference/<id>.json   a hand-built answer {plan, scene} for every text case and 7 image cases (each passes its hard checks)
//   tools/                gen-images.mjs (gateway images), make-gt-scenes.mjs + render-gt.cjs (ground truth), make-reference.mjs,
//                         make-index.mjs, place.mjs (exact placement helpers), selftest.mjs (146 checks: references pass, mutations fail)
//
// CLI:  node ai/bench/score.mjs --case <id> --produced <file.json>      (file: {plan?, scene?, sim?, error?})
//       node ai/bench/score.mjs --gt <gt id> --scene <scene.json>
//       node ai/bench/score.mjs --check-cases                           (every spec and group in the case files resolves)
//
// ---- the case format (cases/text.json; images/index.json uses the same `expect`) ----
// case = {id, category, mode: "new"|"edit", prompt, base_scene?: "scenario:<id>" | "gt:<id>" | "reference:<id>" (a plan-built scene: the runner
// also hands its plan to the edit step) | scene, history?: [{role, text}] (edit: earlier chat turns), expect}
// A SPEC names catalog items: "golf-ball" (a type key), "@ball" (a group from the case file's `groups`), "#ball1" (an item id: edit cases,
// whose ids come from the base scene), or an array of specs (any of them).
// expect = {
//   must_types:  [spec]                      each must match ≥ 1 item of the result                         -> recall
//   forbid_types:[spec]                      none may match                                                 -> violations
//   must_missing:[{what, match: [word|regex]}]  each must be reported in plan.missing (asked/reason text)   -> honesty recall
//   may_missing: [{what, match}]             reporting these is fine (counts as a correct report)
//   not_missing: [word|regex]                reporting these as missing is wrong (they are in the library)   -> honesty precision
//   counts:      [{of: spec, eq?|min?|max?}] items counted in units (a domino row counts its dominoes, a Newton's cradle its balls)
//   relations:   [{rel, a, b?, c?, ..., all?, soft?}]   checked on the solved start geometry (see RELATIONS)
//   outcomes:    [{kind, ..., soft?}]        checked on the engine's track (see OUTCOMES)
//   prop_checks: [{of: spec, prop, eq?|min?|max?|in?, all?}]   on the built props (sim.resolved: defaults + own + auto)
//   items:       {min?, max?}                visible non-scenery items (table and walls left out)
//   min_families: n                          distinct families (the case file's `families` groups; else the type) among them
//   edit:        {preserve: [id], removed: [spec], replaced: [{id, by: spec, near_m?}], keep_others?: bool, max_new_items?: n, tol_m?: m,
//                 moved: [{id, dx?, dy?, dabs_angle?: {min?, max?}}], props: [{id, prop, delta?|ratio?: {min?, max?}, eq?|min?|max?}],
//                 added: [{of: spec, dx_from: id, dx: {min?, max?}}], scene: {seconds?: {min?, max?}}, reply_match: "regex"}
//                 (reply_match reads produced.reply, the edit step's chat reply)
//                 goals_kept: true — every goal the base scene had (its `goals`, of items still in the result) is met in the result's run, or the
//                 reply says plainly that it may no longer happen (an honest "the tuner may need another run" passes; silence does not)
//                 tol_m: how far an item that must stay may move (default 0.02 m; the round-2 cases use 0.005: "exactly")
//   rubric:      "free text for the LLM judge"
// }
// A check with `soft: true` counts in the score but not in `pass`.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const WEB = path.join(ROOT, "web")
const SIM = await import(pathToFileURL(path.join(WEB, "sim/index.js")).href)
const ITEMS = await import(pathToFileURL(path.join(WEB, "sim/items.js")).href)

const D2R = Math.PI / 180
const R2D = 180 / Math.PI
const CONTAINERS = new Set(["box", "cup", "bucket", "basket", "plastic-cup", "glass-jar"])
const SCENERY = new Set(["table", "wall"])
const SLOPED = new Set(["wedge"]) // a ramp by its own shape
const MULTI_UNIT = { "domino-row": "count", "newtons-cradle": "count" } // a type that stands for several things: the prop that says how many

// ------------------------------------------------------------------------------------------------ catalog + bench files
let _catalog = null
/** The catalog (web/sim catalog(), as GET /api/catalog) with lookups: {types: Map key -> type, names: Map normalized name -> key}. */
export function loadCatalog() {
	if (_catalog) return _catalog
	const c = SIM.catalog()
	const types = new Map(c.types.map((t) => [t.key, t]))
	const names = new Map()
	for (const t of c.types) {
		names.set(norm(t.key.replace(/-/g, " ")), t.key)
		names.set(norm(t.name), t.key)
		names.set(norm(t.name.replace(/\s*[,(].*$/, "")), t.key) // "Soda can, standing" -> "soda can"; "Steel weight (1 kg)" -> "steel weight"
	}
	_catalog = { raw: c, types, names }
	return _catalog
}

let _bench = null
/** cases/text.json and images/index.json: {groups, cases: Map id -> case (text and image cases), text: [case], images: [entry]}. */
export function loadBench(dir = HERE) {
	if (_bench && dir === HERE) return _bench
	const text = JSON.parse(fs.readFileSync(path.join(dir, "cases/text.json"), "utf8"))
	const idxFile = path.join(dir, "images/index.json")
	const images = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, "utf8")) : { images: [] }
	const cases = new Map()
	for (const c of text.cases) cases.set(c.id, { ...c, source: "text" })
	for (const e of images.images ?? []) cases.set(e.id, { ...e, mode: e.mode ?? "new", source: "image" })
	const out = { groups: text.groups, families: text.families ?? Object.keys(text.groups), cases, text: text.cases, images: images.images ?? [], dir }
	if (dir === HERE) _bench = out
	return out
}

/** A base scene for an edit case: "scenario:<id>" (web/scenarios), "gt:<id>" (ai/bench/gt) or the scene itself. */
export function baseSceneOf(c, dir = HERE) {
	const b = c.base_scene
	if (!b) return null
	if (typeof b === "object") return clone(b)
	const [kind, id] = String(b).split(":")
	if (kind === "scenario") return JSON.parse(fs.readFileSync(path.join(WEB, "scenarios", `${id}.json`), "utf8"))
	if (kind === "gt") return JSON.parse(fs.readFileSync(path.join(dir, "gt", `${id}.json`), "utf8"))
	if (kind === "reference") return JSON.parse(fs.readFileSync(path.join(dir, "reference", `${id}.json`), "utf8")).scene // a plan-built scene (its plan is in the same file)
	if (kind === "scene") return JSON.parse(fs.readFileSync(path.join(dir, "cases", "scenes", `${id}.json`), "utf8")) // a hand-made scene for an edit case (e.g. a broken one)
	throw new Error(`unknown base_scene ${b}`)
}

// ------------------------------------------------------------------------------------------------ small helpers
const clone = (o) => JSON.parse(JSON.stringify(o))
const norm = (s) => String(s ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim()
const num = (v) => typeof v === "number" && Number.isFinite(v)
const round = (v, d = 4) => (num(v) ? Math.round(v * 10 ** d) / 10 ** d : v)
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
function wordRe(p) {
	if (p instanceof RegExp) return p
	const s = String(p)
	if (s.startsWith("/") && s.lastIndexOf("/") > 0) return new RegExp(s.slice(1, s.lastIndexOf("/")), s.slice(s.lastIndexOf("/") + 1) || "i")
	return new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(es|s)?\\b`, "i")
}
const cmpOk = (v, c) =>
	v !== undefined && v !== null &&
	(c.eq === undefined || (typeof c.eq === "number" ? Math.abs(v - c.eq) <= (c.tol ?? 1e-9) : v === c.eq)) &&
	(c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max) && (c.in === undefined || c.in.includes(v))
const want = (c) => ["eq", "min", "max", "in"].filter((k) => c[k] !== undefined).map((k) => `${k} ${JSON.stringify(c[k])}`).join(", ")

// ------------------------------------------------------------------------------------------------ specs
/** Does item `it` ({id, type}) match spec? Throws on an unknown group (a broken case file). */
export function matches(spec, it, groups) {
	if (Array.isArray(spec)) return spec.some((s) => matches(s, it, groups))
	const s = String(spec)
	if (s.startsWith("#")) return it.id === s.slice(1)
	if (s.startsWith("@")) {
		const g = groups?.[s]
		if (!g) throw new Error(`unknown group ${s}`)
		return g.includes(it.type)
	}
	return it.type === s
}
/** Every type key a spec can stand for (ids give none). */
function specTypes(spec, groups) {
	if (Array.isArray(spec)) return spec.flatMap((s) => specTypes(s, groups))
	const s = String(spec)
	if (s.startsWith("#")) return []
	if (s.startsWith("@")) return groups?.[s] ?? []
	return [s]
}
const specText = (spec) => (Array.isArray(spec) ? spec.join("|") : String(spec))

// ------------------------------------------------------------------------------------------------ geometry
/** World outline of a solid at pose {x, y, angle}: a circle {c: true, x, y, r} or a convex polygon {pts: [[x, y]]}. */
function shapeOf(s, p) {
	const b = s.body
	if (b.kind === "ball") return { c: true, x: p.x, y: p.y, r: b.radius }
	let pts
	if (b.kind === "polygon") pts = b.points.map((q) => [q.x, q.y])
	else {
		const hw = b.width / 2
		const hh = b.height / 2
		const hb = hw * (b.taper ?? 1)
		pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
	}
	const c = Math.cos(p.angle ?? 0)
	const n = Math.sin(p.angle ?? 0)
	return { c: false, pts: pts.map(([x, y]) => [p.x + x * c - y * n, p.y + x * n + y * c]) }
}
function boxOf(sh) {
	if (sh.c) return { x0: sh.x - sh.r, x1: sh.x + sh.r, y0: sh.y - sh.r, y1: sh.y + sh.r }
	const xs = sh.pts.map((p) => p[0])
	const ys = sh.pts.map((p) => p[1])
	return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}
const centreOf = (sh) => (sh.c ? [sh.x, sh.y] : [mean(sh.pts.map((p) => p[0])), mean(sh.pts.map((p) => p[1]))])
function segPoint(px, py, ax, ay, bx, by) {
	const ex = bx - ax
	const ey = by - ay
	const L = ex * ex + ey * ey
	const u = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / L)) : 0
	return [ax + u * ex, ay + u * ey]
}
/** Closest point of a shape's outline (or the point itself when it is inside) to (px, py). */
function closestOn(sh, px, py) {
	if (sh.c) {
		const d = Math.hypot(px - sh.x, py - sh.y)
		if (d <= sh.r) return [px, py]
		return [sh.x + ((px - sh.x) / d) * sh.r, sh.y + ((py - sh.y) / d) * sh.r]
	}
	if (inPoly(sh.pts, px, py)) return [px, py]
	let best = null
	let bd = Infinity
	for (let i = 0; i < sh.pts.length; i++) {
		const [ax, ay] = sh.pts[i]
		const [bx, by] = sh.pts[(i + 1) % sh.pts.length]
		const q = segPoint(px, py, ax, ay, bx, by)
		const d = Math.hypot(q[0] - px, q[1] - py)
		if (d < bd) { bd = d; best = q }
	}
	return best
}
function inPoly(pts, x, y) {
	let inside = false
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const [xi, yi] = pts[i]
		const [xj, yj] = pts[j]
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
	}
	return inside
}
/** Signed gap between two shapes, m: > 0 apart, ≤ 0 touching or overlapping (minus the depth, for two polygons the SAT depth). */
function gap(a, b) {
	if (a.c && b.c) return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r
	if (a.c || b.c) {
		const [c, p] = a.c ? [a, b] : [b, a]
		const q = closestOn(p, c.x, c.y)
		const d = Math.hypot(q[0] - c.x, q[1] - c.y)
		if (d === 0) { // centre inside the polygon: depth = r + distance to the nearest side
			let m = Infinity
			for (let i = 0; i < p.pts.length; i++) {
				const s = segPoint(c.x, c.y, ...p.pts[i], ...p.pts[(i + 1) % p.pts.length])
				m = Math.min(m, Math.hypot(s[0] - c.x, s[1] - c.y))
			}
			return -(c.r + m)
		}
		return d - c.r
	}
	// two convex polygons: SAT overlap depth, else the smallest vertex-to-side distance
	let depth = Infinity
	for (const poly of [a.pts, b.pts]) {
		for (let i = 0; i < poly.length; i++) {
			const [x1, y1] = poly[i]
			const [x2, y2] = poly[(i + 1) % poly.length]
			let ax = -(y2 - y1)
			let ay = x2 - x1
			const m = Math.hypot(ax, ay) || 1
			ax /= m
			ay /= m
			const pa = a.pts.map(([x, y]) => x * ax + y * ay)
			const pb = b.pts.map(([x, y]) => x * ax + y * ay)
			const o = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb))
			if (o <= 0) { depth = 0; break }
			depth = Math.min(depth, o)
		}
		if (depth === 0) break
	}
	if (depth > 0) return -depth
	let d = Infinity
	for (const [P, Q] of [[a.pts, b.pts], [b.pts, a.pts]])
		for (const [px, py] of P)
			for (let i = 0; i < Q.length; i++) {
				const s = segPoint(px, py, ...Q[i], ...Q[(i + 1) % Q.length])
				d = Math.min(d, Math.hypot(s[0] - px, s[1] - py))
			}
	return d
}
/** Highest point of a shape on the vertical line x, or null. */
function topAt(sh, x) {
	if (sh.c) return Math.abs(x - sh.x) <= sh.r ? sh.y + Math.sqrt(sh.r * sh.r - (x - sh.x) ** 2) : null
	let top = null
	for (let i = 0; i < sh.pts.length; i++) {
		const [ax, ay] = sh.pts[i]
		const [bx, by] = sh.pts[(i + 1) % sh.pts.length]
		if ((x < Math.min(ax, bx)) || (x > Math.max(ax, bx))) continue
		const y = bx === ax ? Math.max(ay, by) : ay + ((x - ax) / (bx - ax)) * (by - ay)
		if (top === null || y > top) top = y
	}
	return top
}

/**
 * The scene's items as geometry: {items: [item], byId, tableTop, stage, doc, resolved, warnings}. item = {id, type, name, held, fixed, x, y,
 * angle, props (built), solids: [{sid, kind, hidden, shape, box}], box {x0, x1, y0, y1}, cx, cy, w, h, dynamic, visible, scenery, units}.
 * poses: a placements map {solid id: {x, y, angle}} (a track frame) to measure another moment than the start.
 */
export function geometry(scene, { poses = null, built = null } = {}) {
	const L = built ?? SIM.layout(scene) // {doc, resolved, warnings}
	const start = ITEMS._world_poses(L.doc)
	const pose = (sid) => poses?.[sid] ?? (() => { const w = start.get(sid); return { x: w[0], y: w[1], angle: w[2] } })()
	const sceneItems = new Map((scene.items ?? []).map((i) => [i.id, i]))
	const by = new Map()
	for (const s of L.doc.solids) {
		if (!by.has(s.item)) by.set(s.item, [])
		const shape = shapeOf(s, pose(s.id))
		by.get(s.item).push({ sid: s.id, kind: s.kind, hidden: !!s.hidden_3d, pivot: "pivot" in s, shape, box: boxOf(shape) })
	}
	const items = []
	for (const [id, solids] of by) {
		const it = sceneItems.get(id) ?? { id, type: "?" }
		const box = { x0: Math.min(...solids.map((s) => s.box.x0)), x1: Math.max(...solids.map((s) => s.box.x1)), y0: Math.min(...solids.map((s) => s.box.y0)), y1: Math.max(...solids.map((s) => s.box.y1)) }
		const props = L.resolved?.[id] ?? {}
		const unitProp = MULTI_UNIT[it.type]
		items.push({
			id, type: it.type, name: it.name ?? null, held: !!it.held, fixed: !!it.fixed, x: it.x, y: it.y, angle: it.angle ?? 0, props, solids, box,
			cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, w: box.x1 - box.x0, h: box.y1 - box.y0,
			dynamic: solids.some((s) => s.kind === "dynamic"), visible: solids.some((s) => !s.hidden), scenery: SCENERY.has(it.type),
			units: unitProp ? Math.max(1, Math.round(props[unitProp] ?? 1)) : 1,
		})
	}
	const table = items.find((i) => i.type === "table")
	return { items, byId: new Map(items.map((i) => [i.id, i])), tableTop: table ? table.box.y1 : 0, stage: scene.stage ?? null, doc: L.doc, resolved: L.resolved, warnings: L.warnings ?? [] }
}

/** Smallest gap between two items' solids (m) and the pair that has it. */
function itemGap(A, B) {
	let best = { d: Infinity, a: null, b: null }
	for (const sa of A.solids)
		for (const sb of B.solids) {
			if (sa.box.x0 > sb.box.x1 + 0.5 || sb.box.x0 > sa.box.x1 + 0.5 || sa.box.y0 > sb.box.y1 + 0.5 || sb.box.y0 > sa.box.y1 + 0.5) continue
			const d = gap(sa.shape, sb.shape)
			if (d < best.d) best = { d, a: sa, b: sb }
		}
	return best
}
/** The contact normal between two shapes, pointing from b to a (unit vector): for two polygons the separating axis of largest separation
 *  (SAT: an edge normal of either one), for a ball the direction from the nearest point of the other shape to its centre. */
function normalBA(a, b) {
	if (a.c && b.c) { const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; return [(a.x - b.x) / d, (a.y - b.y) / d] }
	if (a.c || b.c) {
		const [c, p, sign] = a.c ? [a, b, 1] : [b, a, -1]
		const q = closestOn(p, c.x, c.y)
		let d = Math.hypot(c.x - q[0], c.y - q[1])
		if (d > 1e-9) return [(sign * (c.x - q[0])) / d, (sign * (c.y - q[1])) / d]
		// the centre is inside the polygon: the outward normal of the side it is least deep behind
		let best = null
		let bd = Infinity
		for (let i = 0; i < p.pts.length; i++) {
			const [x1, y1] = p.pts[i]
			const [x2, y2] = p.pts[(i + 1) % p.pts.length]
			const L = Math.hypot(x2 - x1, y2 - y1) || 1
			const nx = (y2 - y1) / L
			const ny = -(x2 - x1) / L // outward for a counter-clockwise outline
			d = -((c.x - x1) * nx + (c.y - y1) * ny)
			if (d < bd) { bd = d; best = [nx, ny] }
		}
		const ccw = area(p.pts) > 0 ? 1 : -1
		return [sign * ccw * best[0], sign * ccw * best[1]]
	}
	let best = { sep: -Infinity, n: [0, 1] }
	for (const [P, Q, toA] of [[b.pts, a.pts, 1], [a.pts, b.pts, -1]]) {
		const ccw = area(P) > 0 ? 1 : -1
		for (let i = 0; i < P.length; i++) {
			const [x1, y1] = P[i]
			const [x2, y2] = P[(i + 1) % P.length]
			const L = Math.hypot(x2 - x1, y2 - y1) || 1
			const nx = (ccw * (y2 - y1)) / L
			const ny = (-ccw * (x2 - x1)) / L // P's outward normal of this side
			const sep = Math.min(...Q.map(([x, y]) => (x - x1) * nx + (y - y1) * ny))
			if (sep > best.sep) best = { sep, n: [toA * nx, toA * ny] }
		}
	}
	return best.n
}
const area = (pts) => pts.reduce((s, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return s + x * v - u * y }, 0) / 2
/** A rests on B: some solid of A within tol of a solid of B, pressed on it from above (the contact normal from B to A within 60° of straight up). */
function restsOn(A, B, tol = 0.012) {
	for (const sa of A.solids)
		for (const sb of B.solids) {
			if (sa.box.x0 > sb.box.x1 + tol || sb.box.x0 > sa.box.x1 + tol || sa.box.y0 > sb.box.y1 + tol || sb.box.y0 > sa.box.y1 + tol) continue
			const d = gap(sa.shape, sb.shape)
			if (d > tol || d < -0.02) continue
			if (normalBA(sa.shape, sb.shape)[1] >= 0.5) return true
		}
	return false
}
/** Height of B's top surface under x (the highest outline point on that vertical), or null. */
function surfaceAt(B, x) {
	let top = null
	for (const s of B.solids) {
		const y = topAt(s.shape, x)
		if (y !== null && (top === null || y > top)) top = y
	}
	return top
}
/** Inside a container: each of A's dynamic solids (all of them when A has none) has its centre between the walls, from the floor to the rim. */
function insideContainer(A, C) {
	if (!CONTAINERS.has(C.type)) return false
	const P = C.props ?? {}
	const w = P.width ?? 0.2
	const wall = P.wall ?? P.height ?? 0.1
	const t = P.thickness ?? 0.012
	const a = (C.angle ?? 0) * D2R
	const sol = A.solids.some((s) => s.kind === "dynamic") ? A.solids.filter((s) => s.kind === "dynamic") : A.solids
	for (const s of sol) {
		const [x, y] = centreOf(s.shape)
		const dx = x - C.x
		const dy = y - C.y
		const lx = dx * Math.cos(-a) - dy * Math.sin(-a)
		const ly = dx * Math.sin(-a) + dy * Math.cos(-a)
		const r = s.shape.c ? s.shape.r : 0
		if (!(-w / 2 + t <= lx && lx <= w / 2 - t && -0.005 <= ly - r && ly - r <= wall)) return false
	}
	return true
}
/** An item's tilt, degrees in (-90, 90]: negative = its right end lower ("down to the right"). */
function tilt(it) {
	let a = ((((it.angle ?? 0) + 180) % 360) + 360) % 360 - 180
	if (a > 90) a -= 180
	if (a <= -90) a += 180
	return a
}

// ------------------------------------------------------------------------------------------------ relations
// rel: on (a rests on b) · over (a's centre above b's top surface at that x: resting on it or held over it) · above / below (boxes, x-overlap) · left_of / right_of (box centres;
// gap_m: the boxes at least that far apart) · touching (gap ≤ tol, 0.01) · near (gap ≤ max_m) · inside (a in container b) · between (a's centre between
// b's and c's along x) · same_height (bottoms within tol 0.03) · height_above_table (a's bottom over the table top: min/max m) · held (a.held) ·
// angled (|tilt| in min_deg..max_deg; sign: "down_right" | "down_left") · stack (a chain of `min` items of spec a each resting on the one below) ·
// order_x (items matching specs[0], specs[1] … left to right) · opposite_sides (a and b on opposite sides of c's anchor x: a lever's pivot) ·
// on_table (a rests on the table) · upright (|tilt| ≤ max_deg, default 10) · x_near (|a.cx − b.cx| ≤ max_m, default 0.05).
// Quantifiers: by default some a (and some b ≠ a) satisfy it; all: true -> every a does (with some b).
const REL = {
	on: (a, b, r) => restsOn(a, b, r.tol ?? 0.012),
	over: (a, b, r) => a.cx >= b.box.x0 - 0.01 && a.cx <= b.box.x1 + 0.01 && (() => { const s = surfaceAt(b, a.cx); return s !== null && a.cy >= s - (r.tol ?? 0.005) })(),
	above: (a, b, r) => a.box.y0 >= b.box.y1 - (r.tol ?? 0.01) && a.box.x0 < b.box.x1 && b.box.x0 < a.box.x1,
	below: (a, b, r) => b.box.y0 >= a.box.y1 - (r.tol ?? 0.01) && a.box.x0 < b.box.x1 && b.box.x0 < a.box.x1,
	left_of: (a, b, r) => (r.gap_m !== undefined ? a.box.x1 + r.gap_m <= b.box.x0 + 1e-9 : a.cx < b.cx),
	right_of: (a, b, r) => (r.gap_m !== undefined ? b.box.x1 + r.gap_m <= a.box.x0 + 1e-9 : a.cx > b.cx),
	touching: (a, b, r) => itemGap(a, b).d <= (r.tol ?? 0.01),
	near: (a, b, r) => itemGap(a, b).d <= (r.max_m ?? 0.1),
	inside: (a, b) => insideContainer(a, b),
	x_near: (a, b, r) => Math.abs(a.cx - b.cx) <= (r.max_m ?? 0.05),
}
function evalRelation(rel, G, groups) {
	const pick = (spec) => G.items.filter((i) => matches(spec, i, groups))
	const A = rel.a !== undefined ? pick(rel.a) : []
	const out = { rel: rel.rel, a: rel.a !== undefined ? specText(rel.a) : undefined, b: rel.b !== undefined ? specText(rel.b) : undefined, soft: !!rel.soft, ok: false, detail: "" }
	if (rel.c !== undefined) out.c = specText(rel.c)
	const k = rel.rel
	const someOrAll = (pred) => (rel.all ? A.length > 0 && A.every(pred) : A.some(pred))
	if (k === "held") out.ok = someOrAll((a) => a.held)
	else if (k === "angled") out.ok = someOrAll((a) => {
		if (SLOPED.has(a.type) && Math.abs(tilt(a)) < 1) return true // a wedge's slope is its own shape (any side), lying flat
		const t = tilt(a)
		const m = Math.abs(t)
		return m >= (rel.min_deg ?? 2) && m <= (rel.max_deg ?? 60) && (!rel.sign || (rel.sign === "down_right" ? t < 0 : t > 0))
	})
	else if (k === "upright") out.ok = someOrAll((a) => Math.abs(tilt(a)) <= (rel.max_deg ?? 10))
	else if (k === "height_above_table") out.ok = someOrAll((a) => cmpOk(a.box.y0 - G.tableTop, rel))
	else if (k === "on_table") { const T = G.items.find((i) => i.type === "table"); out.ok = !!T && someOrAll((a) => restsOn(a, T, rel.tol ?? 0.012)) }
	else if (k === "stack") {
		// longest chain a1 on a2 on a3 … among the items of spec a
		const on = new Map(A.map((x) => [x.id, A.filter((y) => y !== x && restsOn(x, y, rel.tol ?? 0.012))]))
		const memo = new Map()
		const depth = (x, seen = new Set()) => {
			if (memo.has(x.id)) return memo.get(x.id)
			seen.add(x.id)
			let d = 1
			for (const y of on.get(x.id)) if (!seen.has(y.id)) d = Math.max(d, 1 + depth(y, seen))
			seen.delete(x.id)
			memo.set(x.id, d)
			return d
		}
		const h = A.length ? Math.max(...A.map((x) => depth(x))) : 0
		out.ok = h >= (rel.min ?? 2)
		out.detail = `tallest stack ${h}`
	} else if (k === "order_x") {
		let prev = -Infinity
		const used = new Set()
		out.ok = true
		for (const s of rel.specs) {
			const cand = G.items.filter((i) => matches(s, i, groups) && !used.has(i.id) && i.cx > prev).sort((p, q) => p.cx - q.cx)
			if (!cand.length) { out.ok = false; out.detail = `nothing of ${specText(s)} right of x=${round(prev, 3)}`; break }
			used.add(cand[0].id)
			prev = cand[0].cx
		}
		out.a = rel.specs.map(specText).join(" < ")
	} else if (k === "same_height") {
		const B = pick(rel.b)
		out.ok = A.some((a) => B.some((b) => b !== a && Math.abs(a.box.y0 - b.box.y0) <= (rel.tol ?? 0.03)))
	} else if (k === "between") {
		const B = pick(rel.b)
		const C = pick(rel.c)
		out.ok = someOrAll((a) => B.some((b) => C.some((c) => b !== a && c !== a && ((b.cx < a.cx && a.cx < c.cx) || (c.cx < a.cx && a.cx < b.cx)))))
	} else if (k === "opposite_sides") {
		const B = pick(rel.b)
		const C = pick(rel.c)
		out.ok = A.some((a) => B.some((b) => b !== a && C.some((c) => (a.cx - c.x) * (b.cx - c.x) < 0)))
	} else if (REL[k]) {
		const B = pick(rel.b)
		out.ok = someOrAll((a) => B.some((b) => b !== a && REL[k](a, b, rel)))
	} else {
		out.ok = false
		out.detail = `unknown relation ${k}`
	}
	if (!A.length && !["order_x"].includes(k)) out.detail ||= `no item matches ${specText(rel.a)}`
	return out
}

// ------------------------------------------------------------------------------------------------ outcomes (the engine's track)
// kind: in (an item of spec `item` ends inside a container of spec `container`; all: every one does) · lands_on (of ends resting on `on`) ·
// topples ({of, min_fraction (1), deg (20)}: the units of spec — each domino of a row — whose angle changed more than deg by the end; 20° is
// past a domino's tipping angle (atan(1/6) ≈ 9.5°), so it counts one that fell flat and one left leaning on the next, as a tight row leaves them;
// the app's own story text counts only those past 57°) ·
// displaced ({of, min_fraction, min_m 0.05}: units moved further than min_m by the end) · hits ({a, b}: a contact between them: the
// engine's impact log, else a touch (gap ≤ 4 mm) found in the track that was not there at the start) · moves ({of, min_m 0.01, all?}) · stays ({of, max_m 0.01, max_deg 5}: every unit never moves more) · rises ({of, min_m}:
// some part of it goes that much above where it started) · descends ({of, min_m}: ends that much lower) · swings ({of, min_deg 5}: a part turns
// at least that much) · reaches ({of, past: spec, side: "right"|"left"}: ends beyond the far side of `past`'s start box) · chain_events ({min}:
// distinct pairs of non-scenery items that touch during the run) · leaves ({of, from}: starts resting on `from`, ends off it) · sequence ({steps: [hits|moves …], slack_s 0.05}: each step happens, in order).
function trackTools(G, sim) {
	const fr = sim.track.frames
	const last = fr.length - 1
	const f0 = fr[0].placements
	const P = (k, sid) => fr[k].placements[sid] ?? f0[sid]
	const end = Object.fromEntries(Object.keys(f0).map((sid) => [sid, P(last, sid)]))
	const solidItem = new Map(G.doc.solids.map((s) => [s.id, s.item]))
	const unitsOf = (it) => {
		const dyn = it.solids.filter((s) => s.kind === "dynamic")
		if (it.type === "domino-row") return dyn.map((s) => [s.sid])
		return dyn.length ? [dyn.map((s) => s.sid)] : []
	}
	const disp = (sid, k) => { const a = P(k, sid); const b = f0[sid]; return Math.hypot(a.x - b.x, a.y - b.y) }
	const turn = (sid, k) => Math.abs(P(k, sid).angle - f0[sid].angle) * R2D
	const firstMove = (sids, m) => { for (let k = 0; k <= last; k++) if (sids.some((s) => disp(s, k) > m)) return fr[k].t; return null }
	const hitTimes = (A, B) => {
		const ids = (L) => new Set(L.map((i) => i.id))
		const a = ids(A)
		const b = ids(B)
		const t = []
		for (const h of sim.track.impacts ?? []) {
			const ia = solidItem.get(h.a)
			const ib = solidItem.get(h.b)
			if (ia === ib) continue
			if ((a.has(ia) && b.has(ib)) || (a.has(ib) && b.has(ia))) t.push(h.t)
		}
		for (const e of sim.summary?.events ?? []) if ((a.has(e.a) && b.has(e.b)) || (a.has(e.b) && b.has(e.a))) t.push(e.t)
		if (t.length) return Math.min(...t)
		// no impact logged (a soft or slow touch): a contact that was not there at the start, found in the track (gap ≤ 4 mm)
		const solidsOf = (L) => G.doc.solids.filter((s) => L.some((i) => i.id === s.item))
		const SA = solidsOf(A)
		const SB = solidsOf(B)
		const pairs = []
		for (const sa of SA) for (const sb of SB) if (sa.item !== sb.item && (sa.kind === "dynamic" || sb.kind === "dynamic")) pairs.push([sa, sb])
		const touch = (k, sa, sb) => gap(shapeOf(sa, P(k, sa.id)), shapeOf(sb, P(k, sb.id))) <= 0.004
		const live = pairs.filter(([sa, sb]) => !touch(0, sa, sb))
		for (let k = 1; k <= last && live.length; k++) for (const [sa, sb] of live) if (touch(k, sa, sb)) return fr[k].t
		return null
	}
	return { fr, last, f0, P, end, solidItem, unitsOf, disp, turn, firstMove, hitTimes }
}
function evalOutcome(o, G, sim, groups, Gend) {
	const out = { kind: o.kind, soft: !!o.soft, ok: false, detail: "" }
	for (const k of ["item", "container", "of", "on", "a", "b", "past", "from"]) if (o[k] !== undefined) out[k] = specText(o[k])
	if (!sim?.track?.frames?.length) return { ...out, ok: null, detail: "no track" }
	const T = trackTools(G, sim)
	const pick = (spec, g = G) => g.items.filter((i) => matches(spec, i, groups))
	const k = o.kind
	if (k === "in") {
		const items = pick(o.item, Gend)
		const conts = pick(o.container, Gend)
		const inAny = (it) => conts.some((c) => c.id !== it.id && insideContainer(it, c))
		const got = items.filter(inAny)
		out.ok = o.all ? items.length > 0 && got.length === items.length : got.length > 0
		out.detail = `${got.length} of ${items.length} end in ${conts.map((c) => c.id).join(", ") || "no container"}`
	} else if (k === "lands_on") {
		const items = pick(o.of, Gend)
		const sup = pick(o.on, Gend)
		const got = items.filter((it) => sup.some((s) => s.id !== it.id && restsOn(it, s, o.tol ?? 0.015)))
		out.ok = o.all ? items.length > 0 && got.length === items.length : got.length > 0
		out.detail = `${got.length} of ${items.length} end on ${specText(o.on)}`
	} else if (k === "topples" || k === "displaced") {
		const units = pick(o.of).flatMap(T.unitsOf)
		const fell = units.filter((u) => (k === "topples" ? u.some((s) => T.turn(s, T.last) > (o.deg ?? 20)) : u.some((s) => T.disp(s, T.last) > (o.min_m ?? 0.05))))
		const f = units.length ? fell.length / units.length : 0
		out.ok = units.length > 0 && f >= (o.min_fraction ?? 1) - 1e-9
		out.detail = `${fell.length} of ${units.length} ${k === "topples" ? "toppled" : "displaced"}`
	} else if (k === "leaves") {
		const items = pick(o.of, Gend)
		const from = pick(o.from)
		const fromEnd = pick(o.from, Gend)
		const startOn = pick(o.of).filter((it) => from.some((f) => f.id !== it.id && restsOn(it, f)))
		const got = items.filter((it) => startOn.some((s) => s.id === it.id) && !fromEnd.some((f) => f.id !== it.id && restsOn(it, f, 0.015)))
		out.ok = got.length > 0
		out.detail = `${startOn.length} start on ${specText(o.from)}, ${got.length} end off it`
	} else if (k === "hits") {
		const t = T.hitTimes(pick(o.a), pick(o.b))
		out.ok = t !== null
		out.detail = t === null ? "no contact" : `first contact at ${round(t, 3)} s`
		out.t = t
	} else if (k === "moves" || k === "stays") {
		const items = pick(o.of)
		const per = items.map((it) => {
			const sids = it.solids.filter((s) => s.kind === "dynamic").map((s) => s.sid)
			let d = 0
			let a = 0
			for (let f = 0; f <= T.last; f++) for (const s of sids) { d = Math.max(d, T.disp(s, f)); a = Math.max(a, T.turn(s, f)) }
			return { id: it.id, d, a }
		})
		if (k === "moves") {
			const got = per.filter((p) => p.d > (o.min_m ?? 0.01))
			out.ok = o.all ? per.length > 0 && got.length === per.length : got.length > 0
			out.detail = `${got.length} of ${per.length} move`
		} else {
			const bad = per.filter((p) => p.d > (o.max_m ?? 0.01) || p.a > (o.max_deg ?? 5))
			out.ok = per.length > 0 && bad.length === 0
			out.detail = bad.length ? `moved: ${bad.map((p) => `${p.id} ${round(p.d, 3)} m / ${round(p.a, 1)}°`).join(", ")}` : `${per.length} stay put`
		}
	} else if (k === "rises" || k === "descends") {
		const items = pick(o.of)
		let best = -Infinity
		for (const it of items)
			for (const s of it.solids.filter((x) => x.kind === "dynamic")) {
				const y0 = T.f0[s.sid].y
				if (k === "rises") for (let f = 0; f <= T.last; f++) best = Math.max(best, T.P(f, s.sid).y - y0)
				else best = Math.max(best, y0 - T.P(T.last, s.sid).y)
			}
		out.ok = best >= (o.min_m ?? 0.05)
		out.detail = items.length ? `${k === "rises" ? "rose" : "dropped"} ${round(best, 3)} m` : `no item matches ${specText(o.of)}`
	} else if (k === "swings") {
		const items = pick(o.of)
		let best = 0
		for (const it of items) for (const s of it.solids.filter((x) => x.kind === "dynamic")) for (let f = 0; f <= T.last; f++) best = Math.max(best, T.turn(s.sid, f))
		out.ok = best >= (o.min_deg ?? 5)
		out.detail = `turned ${round(best, 1)}°`
	} else if (k === "reaches") {
		const items = pick(o.of, Gend)
		const tgt = pick(o.past)
		const right = (o.side ?? "right") === "right"
		out.ok = items.some((it) => tgt.some((t) => t.id !== it.id && (right ? it.cx > t.box.x1 : it.cx < t.box.x0)))
		out.detail = items.map((it) => `${it.id} ends at x=${round(it.cx, 3)}`).join("; ")
	} else if (k === "chain_events") {
		const pairs = new Set()
		const scen = new Set(G.items.filter((i) => i.scenery).map((i) => i.id))
		for (const h of sim.track.impacts ?? []) {
			const a = T.solidItem.get(h.a)
			const b = T.solidItem.get(h.b)
			if (!a || !b || a === b || scen.has(a) || scen.has(b)) continue
			pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`)
		}
		out.ok = pairs.size >= (o.min ?? 3)
		out.detail = `${pairs.size} item pairs touch: ${[...pairs].slice(0, 12).join(", ")}`
	} else if (k === "sequence") {
		let prev = -Infinity
		out.ok = true
		const times = []
		for (const st of o.steps) {
			const t = st.kind === "hits" ? T.hitTimes(pick(st.a), pick(st.b)) : st.kind === "moves" ? (() => { const ts = pick(st.of).map((it) => T.firstMove(it.solids.filter((s) => s.kind === "dynamic").map((s) => s.sid), st.min_m ?? 0.01)).filter((x) => x !== null); return ts.length ? Math.min(...ts) : null })() : null
			times.push(t === null ? null : round(t, 3))
			if (t === null || t < prev - (o.slack_s ?? 0.05)) out.ok = false
			if (t !== null) prev = Math.max(prev, t)
		}
		out.detail = `step times ${JSON.stringify(times)}`
	} else {
		out.ok = false
		out.detail = `unknown outcome ${k}`
	}
	return out
}

// ------------------------------------------------------------------------------------------------ validation
/** Structural check of a plan (DESIGN.md step 2) against the catalog. -> {ok, errors[], unknown_types[], prop_issues[]} */
export function validatePlan(plan) {
	const cat = loadCatalog()
	const errors = []
	const unknown = []
	const propIssues = []
	if (!plan || typeof plan !== "object") return { ok: false, errors: ["plan is not an object"], unknown_types: [], prop_issues: [] }
	if (!Array.isArray(plan.items)) errors.push("items is not an array")
	const items = Array.isArray(plan.items) ? plan.items : []
	const ids = new Set()
	for (const [i, it] of items.entries()) {
		const at = `items[${i}]`
		if (!it || typeof it !== "object") { errors.push(`${at} is not an object`); continue }
		if (typeof it.id !== "string" || !it.id || it.id.length > 80 || it.id.includes("/")) errors.push(`${at}.id is not a valid id`)
		else if (ids.has(it.id)) errors.push(`${at}.id ${it.id} is used twice`)
		else ids.add(it.id)
		if (typeof it.type !== "string") errors.push(`${at}.type is missing`)
		else if (!cat.types.has(it.type)) unknown.push(it.type)
		if (it.props !== undefined && (typeof it.props !== "object" || Array.isArray(it.props) || it.props === null)) errors.push(`${at}.props is not an object`)
		const t = cat.types.get(it.type)
		if (t && it.props) propIssues.push(...propProblems(t, it.props, it.id))
		if (it.place !== undefined && (typeof it.place !== "object" || it.place === null)) errors.push(`${at}.place is not an object`)
	}
	const known = (id) => id === "table" || id === "air" || ids.has(id)
	for (const it of items) {
		const p = it?.place
		if (!p || typeof p !== "object") continue
		if (p.on !== undefined && (typeof p.on !== "string" || !known(p.on))) errors.push(`${it.id}.place.on refers to ${JSON.stringify(p.on)}`)
		for (const k of ["left_of", "right_of"]) if (p[k] !== undefined && !(p[k] && typeof p[k] === "object" && ids.has(p[k].id))) errors.push(`${it.id}.place.${k} refers to ${JSON.stringify(p[k]?.id ?? p[k])}`)
		if (p.inside !== undefined && !ids.has(p.inside)) errors.push(`${it.id}.place.inside refers to ${JSON.stringify(p.inside)}`)
		for (const k of ["x", "y_m", "angle_deg"]) if (p[k] !== undefined && !num(p[k])) errors.push(`${it.id}.place.${k} is not a number`)
		if (p.lean !== undefined) for (const e of ["from", "to"]) if (!p.lean?.[e] || !known(p.lean[e].on)) errors.push(`${it.id}.place.lean.${e} is not a support`)
	}
	if (plan.missing !== undefined && !Array.isArray(plan.missing)) errors.push("missing is not an array")
	for (const [i, m] of (Array.isArray(plan.missing) ? plan.missing : []).entries()) {
		if (!m || typeof m.asked !== "string" || !m.asked.trim()) errors.push(`missing[${i}].asked is missing`)
		if (m?.substitute_type != null && !cat.types.has(m.substitute_type)) unknown.push(m.substitute_type)
	}
	// goals of every kind (ai/goals.mjs): in {item, container}, falls {item | items}, hits {item, target}, moves {item, min_m}
	for (const [i, g] of (Array.isArray(plan.goals) ? plan.goals : []).entries()) {
		const kind = g?.kind ?? (g?.container ? "in" : g?.target ? "hits" : g?.min_m !== undefined ? "moves" : "falls")
		const refs = [...(Array.isArray(g?.items) && g.items.length ? g.items : [g?.item]), ...(kind === "in" ? [g?.container] : []), ...(kind === "hits" ? [g?.target] : [])]
		if (!["in", "falls", "hits", "moves"].includes(kind) || refs.some((id) => !ids.has(id))) errors.push(`goals[${i}] refers to an item that is not in the plan`)
	}
	for (const [i, k] of (Array.isArray(plan.tune) ? plan.tune : []).entries()) if (!ids.has(k?.id) || !(num(k?.min) && num(k?.max) && k.min <= k.max)) errors.push(`tune[${i}] is not a valid knob`)
	if (plan.seconds !== undefined && !(num(plan.seconds) && plan.seconds >= 0.5 && plan.seconds <= 20)) errors.push("seconds is not within 0.5…20")
	return { ok: errors.length === 0, errors, unknown_types: unknown, prop_issues: propIssues }
}
function propProblems(t, props, id) {
	const specs = new Map(t.props.map((p) => [p.key, p]))
	const out = []
	for (const [k, v] of Object.entries(props)) {
		const p = specs.get(k)
		if (!p) { out.push(`${id}: ${t.key} has no prop ${k}`); continue }
		if (p.kind === "number" || p.kind === "int") {
			if (!num(v)) out.push(`${id}.${k} is not a number`)
			else if ((p.min !== undefined && v < p.min - 1e-9) || (p.max !== undefined && v > p.max + 1e-9)) out.push(`${id}.${k}=${v} is outside ${p.min}…${p.max}`)
		} else if (p.kind === "bool" && typeof v !== "boolean") out.push(`${id}.${k} is not true/false`)
		else if (p.kind === "choice" && !(p.choices ?? []).includes(v)) out.push(`${id}.${k}=${JSON.stringify(v)} is not one of its choices`)
	}
	return out
}
/** A scene as the server would take it: shape, ids, known types, props; then clean() + build (the server's own checks). */
export function validateScene(scene) {
	const cat = loadCatalog()
	const errors = []
	const unknown = []
	const propIssues = []
	if (!scene || typeof scene !== "object" || !Array.isArray(scene.items)) return { ok: false, errors: ["scene has no items array"], unknown_types: [], prop_issues: [] }
	if (scene.version !== 2) errors.push("version is not 2")
	const ids = new Set()
	for (const it of scene.items) {
		if (typeof it.id !== "string" || !it.id || it.id.length > 80 || it.id.includes("/") || ids.has(it.id)) errors.push(`bad or repeated id ${JSON.stringify(it.id)}`)
		ids.add(it.id)
		if (!cat.types.has(it.type)) { unknown.push(it.type); continue }
		for (const k of ["x", "y"]) if (!num(it[k])) errors.push(`${it.id}.${k} is not a number`)
		if (it.angle !== undefined && !num(it.angle)) errors.push(`${it.id}.angle is not a number`)
		if (it.props) propIssues.push(...propProblems(cat.types.get(it.type), it.props, it.id))
	}
	for (const g of scene.goals ?? []) if (!ids.has(g.item) || !ids.has(g.container)) errors.push(`goal ${JSON.stringify(g.label ?? "")} refers to a missing item`)
	try {
		SIM.layout(scene)
	} catch (e) {
		errors.push(`the builder refuses it: ${e.message}`)
	}
	return { ok: errors.length === 0, errors, unknown_types: unknown, prop_issues: propIssues }
}

// ------------------------------------------------------------------------------------------------ simulation
let _engine = null
/** Runs a scene in-process exactly as POST /api/simulate does (web/sim prepare → engine → finish). -> sim | {error} */
export async function simulate(scene, { rate = 120 } = {}) {
	try {
		_engine ??= (await import(pathToFileURL(path.join(WEB, "sim/engine.js")).href)).createEngine({ prewarm: false })
		const t0 = Date.now()
		const { scene: s, doc, resolved } = SIM.prepare(scene)
		const track = await _engine.run(doc, rate)
		const meta = SIM.finish(s, doc, resolved, track)
		return { doc: meta.doc, track, summary: meta.summary, warnings: meta.warnings, resolved: meta.resolved, ms: Date.now() - t0 }
	} catch (e) {
		return { error: String(e?.message ?? e) }
	}
}

// ------------------------------------------------------------------------------------------------ missing-honesty
function missingHonesty(plan, ex) {
	const must = ex.must_missing ?? []
	const may = ex.may_missing ?? []
	const notm = (ex.not_missing ?? []).map(wordRe)
	if (!plan) return { skipped: "no plan" }
	const list = Array.isArray(plan.missing) ? plan.missing : []
	const cat = loadCatalog()
	const text = (m) => `${m?.asked ?? ""} ${m?.reason ?? ""}`
	const hit = (m, e) => e.match.some((p) => wordRe(p).test(m?.asked ?? "")) || e.match.some((p) => wordRe(p).test(text(m)))
	const matched = must.filter((e) => list.some((m) => hit(m, e)))
	const tp = []
	const fp = []
	const other = []
	for (const m of list) {
		if ([...must, ...may].some((e) => hit(m, e))) tp.push(m.asked)
		else if (notm.some((re) => re.test(m?.asked ?? "")) || cat.names.has(norm(String(m?.asked ?? "").replace(/^(an?|the|some|\d+)\s+/i, "")))) fp.push(m.asked)
		else other.push(m.asked)
	}
	return {
		recall: must.length ? matched.length / must.length : null,
		precision: tp.length + fp.length ? tp.length / (tp.length + fp.length) : 1,
		reported: list.length,
		matched: matched.map((e) => e.what),
		unreported: must.filter((e) => !matched.includes(e)).map((e) => e.what),
		false_reports: fp,
		unclassified: other,
		bad_substitutes: list.filter((m) => m?.substitute_type != null && !cat.types.has(m.substitute_type)).map((m) => m.substitute_type),
	}
}

// ------------------------------------------------------------------------------------------------ the case score
const WEIGHTS = { reply: 0.05, schema: 0.1, unknown: 0.05, must_types: 0.15, forbid: 0.05, missing: 0.15, counts: 0.1, relations: 0.15, props: 0.05, overlaps: 0.05, sim: 0.05, outcomes: 0.2, edit: 0.15, items: 0.03 }

/**
 * Score one produced result against a case. produced = {plan?, scene?, sim?, error?}: the plan (step 2's output), the solved scene (version 2)
 * and, optionally, its run (the simulate answer, with `track`; simulated here when absent and opts.simulate !== false).
 * -> {id, pass, score (0..1), parts: {name: 0..1}, checks: {...}, notes: []}
 */
export async function scoreCase(c, produced, opts = {}) {
	const bench = opts.bench ?? (opts.groups ? null : loadBench())
	const groups = opts.groups ?? bench.groups
	const ex = c.expect ?? {}
	const plan = produced?.plan ?? null
	const scene = produced?.scene ?? null
	const checks = {}
	const parts = {}
	const hard = []
	const notes = []
	if (produced?.error) notes.push(`producer error: ${produced.error}`)

	// schema + unknown types
	let pv = plan ? validatePlan(plan) : null
	if (pv && typeof opts.validatePlan === "function") {
		// a stricter schema check of the caller's own (e.g. ai/schemas.mjs): its errors are added to the built-in ones
		const extra = opts.validatePlan(plan) ?? { ok: true, errors: [] }
		pv = { ...pv, ok: pv.ok && !!extra.ok, errors: [...pv.errors, ...(extra.errors ?? []).map(String)] }
	}
	const sv = scene ? validateScene(scene) : null
	checks.schema = { plan: pv ? { ok: pv.ok, errors: pv.errors } : null, scene: sv ? { ok: sv.ok, errors: sv.errors } : null }
	const schemaOk = (!!scene || !!plan) && (scene ? sv.ok : true) && (plan ? pv.ok : true) // (a plan alone can be scored; relations and outcomes then fail)
	parts.schema = schemaOk ? 1 : 0
	hard.push(["schema", schemaOk])
	const unknownTypes = [...new Set([...(pv?.unknown_types ?? []), ...(sv?.unknown_types ?? [])])]
	checks.unknown_types = { count: unknownTypes.length, types: unknownTypes }
	parts.unknown = unknownTypes.length ? 0 : 1
	hard.push(["unknown_types", unknownTypes.length === 0])
	const propIssues = [...new Set([...(pv?.prop_issues ?? []), ...(sv?.prop_issues ?? [])])]
	checks.prop_issues = propIssues
	parts.props = propIssues.length ? Math.max(0, 1 - 0.25 * propIssues.length) : 1

	// what the result contains (the scene when there is one, else the plan's items)
	let G = null
	if (scene && sv?.ok) {
		try { G = geometry(scene) } catch (e) { notes.push(`geometry failed: ${e.message}`) }
	}
	const listed = G ? G.items : (plan?.items ?? []).filter((i) => i && typeof i.type === "string").map((i) => ({ id: i.id, type: i.type, props: i.props ?? {}, units: MULTI_UNIT[i.type] ? Math.round(i.props?.[MULTI_UNIT[i.type]] ?? loadCatalog().types.get(i.type)?.defaults?.[MULTI_UNIT[i.type]] ?? 1) : 1 }))
	const visible = listed.filter((i) => !SCENERY.has(i.type))

	// must / forbid types
	if (ex.must_types?.length) {
		const hit = ex.must_types.filter((s) => listed.some((i) => matches(s, i, groups)))
		checks.must_types = { recall: hit.length / ex.must_types.length, missing: ex.must_types.filter((s) => !hit.includes(s)).map(specText) }
		parts.must_types = checks.must_types.recall
		hard.push(["must_types", hit.length === ex.must_types.length])
	}
	if (ex.forbid_types?.length) {
		const bad = listed.filter((i) => ex.forbid_types.some((s) => matches(s, i, groups)))
		checks.forbid = { violations: bad.map((i) => `${i.id} (${i.type})`) }
		parts.forbid = bad.length ? 0 : 1
		hard.push(["forbid", bad.length === 0])
	}

	// missing honesty
	if (ex.must_missing?.length || ex.not_missing?.length || plan) {
		const mh = missingHonesty(plan, ex)
		checks.missing = mh
		if (!mh.skipped) {
			const r = mh.recall ?? 1
			parts.missing = ex.must_missing?.length ? (2 * r * mh.precision) / (r + mh.precision || 1) : mh.precision
			hard.push(["missing", (mh.recall ?? 1) === 1 && mh.precision === 1])
		} else if (ex.must_missing?.length) {
			parts.missing = 0
			hard.push(["missing", false])
		}
	}

	// counts
	if (ex.counts?.length) {
		checks.counts = ex.counts.map((k) => {
			const got = listed.filter((i) => matches(k.of, i, groups)).reduce((s, i) => s + (i.units ?? 1), 0)
			return { of: specText(k.of), want: want(k), got, ok: cmpOk(got, k), soft: !!k.soft }
		})
		parts.counts = mean(checks.counts.map((k) => (k.ok ? 1 : 0)))
		hard.push(["counts", checks.counts.every((k) => k.ok || k.soft)])
	}
	if (ex.min_families !== undefined) {
		const fams = new Set(visible.map((i) => familyOf(i.type, groups, bench?.families ?? Object.keys(groups))))
		checks.families = { count: fams.size, want: ex.min_families, list: [...fams], ok: fams.size >= ex.min_families }
		parts.items = Math.min(parts.items ?? 1, checks.families.ok ? 1 : fams.size / ex.min_families)
		hard.push(["families", checks.families.ok])
	}
	if (ex.items) {
		const n = visible.length
		const ok = (ex.items.min === undefined || n >= ex.items.min) && (ex.items.max === undefined || n <= ex.items.max)
		checks.items = { count: n, want: want(ex.items), ok }
		parts.items = ok ? 1 : 0
		hard.push(["items", ok])
	}

	// relations, overlaps, stage, props (need the solved scene)
	if (ex.relations?.length) {
		if (G) {
			checks.relations = ex.relations.map((r) => evalRelation(r, G, groups))
			parts.relations = mean(checks.relations.map((r) => (r.ok ? 1 : 0)))
			hard.push(["relations", checks.relations.every((r) => r.ok || r.soft)])
		} else { parts.relations = 0; hard.push(["relations", false]); checks.relations = "no solved scene" }
	}
	if (ex.prop_checks?.length) {
		if (G) {
			checks.prop_checks = ex.prop_checks.map((p) => {
				const its = G.items.filter((i) => matches(p.of, i, groups))
				const vals = its.map((i) => i.props?.[p.prop])
				const ok = p.all ? its.length > 0 && vals.every((v) => cmpOk(v, p)) : vals.some((v) => cmpOk(v, p))
				return { of: specText(p.of), prop: p.prop, want: want(p), got: vals.map((v) => round(v)), ok, soft: !!p.soft }
			})
			parts.props = Math.min(parts.props, mean(checks.prop_checks.map((p) => (p.ok ? 1 : 0))))
			hard.push(["prop_checks", checks.prop_checks.every((p) => p.ok || p.soft)])
		} else hard.push(["prop_checks", false])
	}
	if (G) {
		checks.overlaps = { count: G.warnings.length, list: G.warnings.map((w) => w.text) }
		parts.overlaps = G.warnings.length ? Math.max(0, 1 - 0.34 * G.warnings.length) : 1
		hard.push(["overlaps", G.warnings.length === 0])
		const st = G.stage
		const out = st ? G.items.filter((i) => !i.scenery && (i.box.x0 < st.x0 - 0.01 || i.box.x1 > st.x1 + 0.01 || i.box.y0 < st.y0 - 0.01 || i.box.y1 > st.y1 + 0.01)).map((i) => i.id) : []
		checks.out_of_stage = out
		const sunk = G.items.filter((i) => !i.scenery && i.box.y0 < G.tableTop - 0.005 && i.visible).map((i) => i.id)
		checks.below_table = sunk
	}

	// the run
	let sim = produced?.sim ?? null
	if (scene && sv?.ok && !sim && opts.simulate !== false && (ex.outcomes?.length || ex.edit?.goals_kept || opts.alwaysSimulate)) sim = await simulate(scene)
	if (sim) {
		const errs = sim.error ? [sim.error] : []
		checks.sim = { errors: errs.length, messages: errs, ms: sim.ms ?? null }
		parts.sim = errs.length ? 0 : 1
		hard.push(["sim", errs.length === 0])
		if (sim.summary?.goals) {
			const g = sim.summary.goals
			checks.goals = { declared: g.length, ok: g.filter((x) => x.ok).length, failed: g.filter((x) => !x.ok).map((x) => x.label) }
		}
	} else if (produced?.sim_error) {
		checks.sim = { errors: 1, messages: [produced.sim_error] }
		parts.sim = 0
		hard.push(["sim", false])
	}
	if (ex.outcomes?.length) {
		if (G && sim?.track) {
			const T = trackTools(G, sim)
			const Gend = geometry(scene, { poses: T.end, built: { doc: G.doc, resolved: G.resolved, warnings: [] } })
			checks.outcomes = ex.outcomes.map((o) => evalOutcome(o, G, sim, groups, Gend))
			if (opts.hardOutcomes) for (const o of checks.outcomes) if (o.soft) (o.soft = false), (o.made_hard = "make it work")
			parts.outcomes = mean(checks.outcomes.map((o) => (o.ok ? 1 : 0)))
			hard.push(["outcomes", checks.outcomes.every((o) => o.ok || o.soft)])
		} else { checks.outcomes = "no run"; parts.outcomes = 0; hard.push(["outcomes", false]) }
	}
	// ground truth (a picture rendered from a known scene): true scale, true sizes, exact counts are hard
	if (opts.gt?.hard) {
		const h = opts.gt.hard
		checks.gt_hard = h
		hard.push(["gt_scale", h.scale_ok], ["gt_size", h.size_ok], ["gt_counts", h.counts_ok])
	}

	// edits: what had to stay, go or change
	if (ex.edit) {
		const base = baseSceneOf(c, opts.dir ?? HERE)
		const r = editChecks(ex.edit, base, scene, G, groups, produced)
		// goals_kept: the base scene's goals still met in this run, or honestly reported as at risk in the reply
		if (ex.edit.goals_kept) {
			const goals = (base?.goals ?? []).filter((g) => g && g.item && g.container && scene?.items?.some((i) => i.id === g.item) && scene.items.some((i) => i.id === g.container))
			const said = SAID_RE.test(String(produced?.reply ?? ""))
			let T = null
			let Gend = null
			if (G && sim?.track?.frames?.length) {
				T = trackTools(G, sim)
				Gend = geometry(scene, { poses: T.end, built: { doc: G.doc, resolved: G.resolved, warnings: [] } })
			}
			const res = goals.map((g) => (Gend ? evalOutcome({ kind: "in", item: `#${g.item}`, container: `#${g.container}` }, G, sim, groups, Gend) : { ok: false, detail: "no run" }))
			const met = res.filter((o) => o.ok).length
			r.goals_kept = { goals: goals.length, met, said }
			const ok = met === goals.length || said
			if (!ok) r.problems.push(`${goals.length - met} of the scene's ${goals.length} goal(s) no longer happen, and the reply does not say so`)
			r.ok = r.ok && ok
			r.score = (r.score + (met === goals.length ? 1 : said ? 0.75 : 0)) / 2
		}
		checks.edit = r
		parts.edit = r.score
		hard.push(["edit", r.ok])
	}

	// the chat reply and the next-edit chips (ai/DESIGN.md §13.9), when the producer gave them: soft (in the score, never in pass)
	if (typeof produced?.reply === "string" || Array.isArray(produced?.suggestions)) {
		const r = replyStyle(produced.reply, produced.suggestions, scene, plan)
		checks.reply = r
		parts.reply = r.score
	}

	const w = Object.entries(parts).filter(([k]) => WEIGHTS[k] !== undefined)
	const score = w.reduce((s, [k, v]) => s + WEIGHTS[k] * v, 0) / (w.reduce((s, [k]) => s + WEIGHTS[k], 0) || 1)
	const failed = hard.filter(([, ok]) => !ok).map(([k]) => k)
	return { id: c.id, pass: failed.length === 0, score: round(score, 4), failed, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v, 3)])), checks, notes, rubric: ex.rubric ?? null }
}

/**
 * The chat reply and chips as the user sees them (§13.9): a reply is there; at most 2 sentences; no raw prop names (a catalog prop key with
 * "_", "default →", a bare decimal after an arrow) and no raw item ids; 2-3 suggestions, each label ≤ 6 words and each prompt naming
 * something in the scene (an item's name or type word): specific, not generic. -> {ok, score, problems}
 */
function replyStyle(reply, suggestions, scene, plan) {
	const problems = []
	let n = 0
	let good = 0
	const t = String(reply ?? "").trim()
	n++
	if (t) good++
	else problems.push("no reply")
	n++
	const sentences = t ? t.split(/(?<=[.!?])\s+(?=["“(]?[A-ZÀ-Þ¿¡])/).filter(Boolean).length : 0
	if (sentences <= 2) good++
	else problems.push(`${sentences} sentences (at most 2)`)
	n++
	const cat = loadCatalog()
	const propKeys = new Set()
	for (const T of cat.types.values()) for (const k of Object.keys(T.defaults ?? {})) if (k.includes("_")) propKeys.add(k)
	const ids = new Set((scene?.items ?? []).map((i) => i.id).filter((id) => /\d|[-_]/.test(id) && id !== "wall-left" && id !== "wall-right"))
	const raw = [...propKeys].filter((k) => t.includes(k))
	const rawIds = [...ids].filter((id) => new RegExp(`(^|[^\\w-])${id.replace(/[-]/g, "\\-")}([^\\w-]|$)`).test(t))
	const arrows = /\bdefault\b\s*(→|->)|(→|->)\s*-?\d+\.\d{3,}\b(?!\s*(m|cm|mm|kg|g|s|°|%|m\/s))/i.test(t)
	if (!raw.length && !rawIds.length && !arrows) good++
	else problems.push(`raw names in the reply: ${[...raw, ...rawIds, ...(arrows ? ["a raw value after an arrow"] : [])].join(", ")}`)
	const sug = Array.isArray(suggestions) ? suggestions : []
	n++
	if (sug.length >= 2 && sug.length <= 3) good++
	else problems.push(`${sug.length} suggestions (2-3 wanted)`)
	const words = new Set()
	for (const it of scene?.items ?? []) {
		if (it.type === "table" || it.type === "wall") continue
		for (const w of `${it.name ?? ""} ${String(it.type).replace(/-/g, " ")} ${cat.types.get(it.type)?.name ?? ""}`.toLowerCase().split(/[^a-z]+/)) if (w.length >= 3 && !["the", "and", "row"].includes(w)) words.add(w.replace(/s$/, ""))
	}
	for (const g of sug) {
		n++
		const labelOk = typeof g?.label === "string" && g.label.trim() && g.label.trim().split(/\s+/).length <= 6
		const specific = typeof g?.prompt === "string" && g.prompt.toLowerCase().split(/[^a-z]+/).some((w) => words.has(w.replace(/s$/, "")))
		if (labelOk && specific) good++
		else problems.push(`suggestion ${JSON.stringify(g?.label ?? g)}: ${!labelOk ? "label over 6 words or empty" : "names nothing in this scene"}`)
	}
	return { ok: problems.length === 0, score: n ? Math.round((good / n) * 1000) / 1000 : 1, problems, sentences, suggestions: sug.length }
}

/** A reply that says a stated outcome may no longer happen ("the tuner may need another run", "it may miss the box now"). */
const SAID_RE = /\b(may|might|could|probably|likely) (not|no longer|miss|fall short|overshoot|land short)|\b(won['’]t|will not|no longer|doesn['’]t|does not|didn['’]t|did not|isn['’]t|is not) (land|reach|make|work|end up|go in|drop in|fall in|happen)|\bmiss(es|ed)?\b|\btun(er|ing|e)\b|\b(another|a new) (run|tuning)\b|\bnot (sure|guaranteed)\b/i
function editChecks(e, base, scene, G, groups, produced = {}) {
	const out = { ok: true, problems: [] }
	if (!base || !scene) return { ok: false, score: 0, problems: ["no base scene or no result"] }
	const tol = e.tol_m ?? 0.02
	const now = new Map(scene.items.map((i) => [i.id, i]))
	const was = new Map(base.items.map((i) => [i.id, i]))
	const named = new Set([...(e.preserve ?? []), ...(e.replaced ?? []).map((r) => r.id), ...(e.changed ?? []), ...(e.moved ?? []).map((m) => m.id), ...(e.props ?? []).map((m) => m.id)])
	for (const s of e.removed ?? []) for (const b of base.items) if (matches(s, b, groups)) named.add(b.id)
	// props compared as the builder resolves them (the type's defaults filled in): the solver writes only the props that differ from the defaults
	const cat0 = loadCatalog()
	const eff = (it) => {
		const d = cat0.types.get(it.type)?.defaults ?? {}
		const o = { ...d, ...(it.props ?? {}) }
		return Object.fromEntries(Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== null).sort().map((k) => [k, typeof o[k] === "number" ? round(o[k], 6) : o[k]]))
	}
	const same = (a, b) => a && b && a.type === b.type && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs((a.angle ?? 0) - (b.angle ?? 0)) <= 2 && JSON.stringify(eff(a)) === JSON.stringify(eff(b))
	const keep = [...(e.preserve ?? []), ...(e.keep_others ? base.items.map((b) => b.id).filter((id) => !named.has(id)) : [])]
	let n = 0
	let good = 0
	for (const id of new Set(keep)) {
		n++
		if (same(now.get(id), was.get(id))) good++
		else out.problems.push(`${id} was changed or removed (it should stay as it was)`)
	}
	for (const s of e.removed ?? []) {
		n++
		const left = scene.items.filter((i) => matches(s, i, groups))
		if (!left.length) good++
		else out.problems.push(`${specText(s)} should be gone: ${left.map((i) => i.id).join(", ")}`)
	}
	for (const r of e.replaced ?? []) {
		n++
		const old = was.get(r.id)
		const cur = now.get(r.id)
		const bG = old ? geometry(base).byId.get(r.id) : null
		const cand = G ? G.items.filter((i) => matches(r.by, i, groups)) : []
		const near = bG ? cand.filter((i) => Math.hypot(i.cx - bG.cx, i.cy - bG.cy) <= (r.near_m ?? 0.15)) : []
		if ((!cur || matches(r.by, cur, groups)) && near.length) good++
		else out.problems.push(`${r.id} should be replaced by ${specText(r.by)} near where it was (${cand.length ? `nearest is ${round(Math.min(...cand.map((i) => Math.hypot(i.cx - bG.cx, i.cy - bG.cy))), 3)} m away` : "none in the result"})`)
	}
	if (e.max_new_items !== undefined) {
		n++
		// (the see-through safety walls the solver always puts at the table's ends are scenery, not items the edit added)
		const added = scene.items.filter((i) => !was.has(i.id) && !(i.type === "wall" && i.props?.invisible_in_3d)).length
		if (added <= e.max_new_items) good++
		else out.problems.push(`${added} new items (at most ${e.max_new_items})`)
	}
	// moved: [{id, dx?, dy?, dabs_angle?: {min?, max?}}] — how far the item's anchor (and |angle|) changed from the base scene
	const rng = (v, r) => r === undefined || (num(v) && (r.min === undefined || v >= r.min - 1e-9) && (r.max === undefined || v <= r.max + 1e-9))
	const rtxt = (r) => (r ? `${r.min ?? "…"}…${r.max ?? "…"}` : "")
	for (const m of e.moved ?? []) {
		n++
		const a = was.get(m.id)
		const b = now.get(m.id)
		if (!a || !b) { out.problems.push(`${m.id} should still be there (moved)`); continue }
		const dx = b.x - a.x
		const dy = b.y - a.y
		const da = Math.abs(b.angle ?? 0) - Math.abs(a.angle ?? 0)
		if (rng(dx, m.dx) && rng(dy, m.dy) && rng(da, m.dabs_angle)) good++
		else out.problems.push(`${m.id} moved dx ${round(dx, 3)} dy ${round(dy, 3)} d|angle| ${round(da, 1)} (wanted${m.dx ? ` dx ${rtxt(m.dx)}` : ""}${m.dy ? ` dy ${rtxt(m.dy)}` : ""}${m.dabs_angle ? ` d|angle| ${rtxt(m.dabs_angle)}` : ""})`)
	}
	// props: [{id, prop, delta?|ratio?: {min?, max?}, eq?|min?|max?}] — a prop's new value (defaults filled in from the catalog) against the base
	const cat = loadCatalog()
	const propOf = (it, k) => it?.props?.[k] ?? cat.types.get(it?.type)?.defaults?.[k]
	for (const m of e.props ?? []) {
		n++
		const a = was.get(m.id)
		const b = now.get(m.id)
		if (!b) { out.problems.push(`${m.id} should still be there (props)`); continue }
		const v = propOf(b, m.prop)
		const v0 = a ? propOf(a, m.prop) : undefined
		const okAbs = cmpOk(v, m)
		const okDelta = m.delta === undefined || (num(v) && num(v0) && rng(v - v0, m.delta))
		const okRatio = m.ratio === undefined || (num(v) && num(v0) && v0 !== 0 && rng(v / v0, m.ratio))
		if (okAbs && okDelta && okRatio) good++
		else out.problems.push(`${m.id}.${m.prop} is ${round(v, 4)} (was ${round(v0, 4)}; wanted${m.delta ? ` change ${rtxt(m.delta)}` : ""}${m.ratio ? ` ×${rtxt(m.ratio)}` : ""}${want(m) ? ` ${want(m)}` : ""})`)
	}
	// added: [{of: spec, dx_from: id, dx: {min?, max?}}] — a NEW item of that kind, its centre this far along x from a base item's centre
	for (const m of e.added ?? []) {
		n++
		const ref = G?.byId?.get(m.dx_from)
		const fresh = (G?.items ?? []).filter((i) => !was.has(i.id) && matches(m.of, i, groups))
		const got = fresh.filter((i) => !ref || rng(i.cx - ref.cx, m.dx))
		if (got.length) good++
		else out.problems.push(`a new ${specText(m.of)} ${m.dx_from ? `${rtxt(m.dx)} m right of ${m.dx_from}` : ""} (new: ${fresh.map((i) => `${i.id} at dx ${ref ? round(i.cx - ref.cx, 3) : "?"}`).join(", ") || "none"})`)
	}
	// scene: {seconds?: {min?, max?}} — the scene's own settings
	if (e.scene?.seconds) {
		n++
		if (rng(scene.seconds, e.scene.seconds)) good++
		else out.problems.push(`seconds is ${scene.seconds} (wanted ${rtxt(e.scene.seconds)})`)
	}
	// reply_match: the chat reply must say this (a question answered in words)
	if (e.reply_match) {
		n++
		if (new RegExp(e.reply_match, "i").test(String(produced?.reply ?? ""))) good++
		else out.problems.push(`the reply does not answer it (wanted /${e.reply_match}/; got ${JSON.stringify(String(produced?.reply ?? "").slice(0, 120))})`)
	}
	out.ok = out.problems.length === 0
	out.score = n ? good / n : 1
	return out
}

// ------------------------------------------------------------------------------------------------ ground-truth image cases
/** Hungarian assignment (min cost) for an n×m matrix. -> [[row, col]] */
export function assign(cost) {
	const n = cost.length
	const m = n ? cost[0].length : 0
	if (!n || !m) return []
	const N = Math.max(n, m)
	const BIG = 1e6
	const a = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i < n && j < m ? cost[i][j] : BIG)))
	const u = new Array(N + 1).fill(0)
	const v = new Array(N + 1).fill(0)
	const p = new Array(N + 1).fill(0)
	const way = new Array(N + 1).fill(0)
	for (let i = 1; i <= N; i++) {
		p[0] = i
		let j0 = 0
		const minv = new Array(N + 1).fill(Infinity)
		const used = new Array(N + 1).fill(false)
		do {
			used[j0] = true
			const i0 = p[j0]
			let delta = Infinity
			let j1 = 0
			for (let j = 1; j <= N; j++) {
				if (used[j]) continue
				const cur = a[i0 - 1][j - 1] - u[i0] - v[j]
				if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
				if (minv[j] < delta) { delta = minv[j]; j1 = j }
			}
			for (let j = 0; j <= N; j++) {
				if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta
			}
			j0 = j1
		} while (p[j0] !== 0)
		do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0)
	}
	const out = []
	for (let j = 1; j <= N; j++) if (p[j] && p[j] <= n && j <= m && a[p[j] - 1][j - 1] < BIG) out.push([p[j] - 1, j - 1])
	return out
}
/** The visible things of a scene as units: one per item, a domino row as its dominoes; scenery and see-through walls left out. */
export function unitsOf(scene) {
	const G = geometry(scene)
	const out = []
	for (const it of G.items) {
		if (it.scenery || !it.visible) continue
		if (it.type === "domino-row") {
			for (const s of it.solids.filter((x) => x.kind === "dynamic")) out.push({ id: `${it.id}/${s.sid.split("/").pop()}`, item: it.id, type: "domino", cx: (s.box.x0 + s.box.x1) / 2, cy: (s.box.y0 + s.box.y1) / 2, w: s.box.x1 - s.box.x0, h: s.box.y1 - s.box.y0 })
		} else out.push({ id: it.id, item: it.id, type: it.type, cx: it.cx, cy: it.cy, w: it.w, h: it.h })
	}
	return { G, units: out }
}
export function familyOf(type, groups, families) {
	for (const f of families) if (groups[f]?.includes(type)) return f
	return type
}
/** Hard limits of a ground-truth comparison: the fitted scale within ±20 % of 1 (the scene is built at true scale), each matched item's
 *  true size within 25 %, and every type's unit count exact. */
export const GT_LIMITS = { scale: 0.2, size: 0.25 }
/**
 * Compare a produced scene with a ground-truth scene (an image case built from catalog items).
 * -> {types: {precision, recall, f1}, families: {precision, recall, f1}, order: {kendall_tau, pairs}, position: {scale, offset, mean_m, rms_m,
 *     mean_rel}, size: {mean_rel_err, worst}, matched, unmatched_gt, unmatched_produced}
 */
export function scoreAgainstGT(gt, scene, opts = {}) {
	const bench = opts.groups ? null : loadBench()
	const groups = opts.groups ?? bench.groups
	const families = opts.families ?? bench.families
	const fam = (t) => familyOf(t, groups, families)
	const g = unitsOf(gt)
	const p = unitsOf(scene)
	const prf = (P, R, M) => ({ precision: round(P ? M / P : 0, 4), recall: round(R ? M / R : 0, 4), f1: round(P + R ? (2 * M) / (P + R) : 0, 4) })
	// exact types, item level (a domino row is one "domino-row")
	const tally = (G) => { const m = new Map(); for (const i of G.items) if (!i.scenery && i.visible) m.set(i.type, (m.get(i.type) ?? 0) + 1); return m }
	const tg = tally(g.G)
	const tp = tally(p.G)
	let mt = 0
	for (const [k, v] of tp) mt += Math.min(v, tg.get(k) ?? 0)
	const types = prf([...tp.values()].reduce((s, v) => s + v, 0), [...tg.values()].reduce((s, v) => s + v, 0), mt)
	// families, unit level (each domino counts)
	const ftally = (U) => { const m = new Map(); for (const u of U) m.set(fam(u.type), (m.get(fam(u.type)) ?? 0) + 1); return m }
	const fg = ftally(g.units)
	const fp = ftally(p.units)
	let mf = 0
	for (const [k, v] of fp) mf += Math.min(v, fg.get(k) ?? 0)
	const familiesScore = prf(p.units.length, g.units.length, mf)
	// matching + alignment (uniform scale + offset), iterated
	const ext = (U) => { const xs = U.map((u) => u.cx); const ys = U.map((u) => u.cy); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } }
	const eg = ext(g.units)
	const ep = ext(p.units)
	const span = Math.max(eg.x1 - eg.x0, eg.y1 - eg.y0, 0.1)
	const typeCost = (a, b) => (a.type === b.type ? 0 : fam(a.type) === fam(b.type) ? 0.3 : 1.5)
	let s = 1
	let tx = 0
	let ty = 0
	{ // first guess: line up the two sets' extents
		const sp = Math.max(ep.x1 - ep.x0, ep.y1 - ep.y0, 0.1)
		s = Math.min(4, Math.max(0.25, span / sp))
		tx = (eg.x0 + eg.x1) / 2 - s * (ep.x0 + ep.x1) / 2
		ty = eg.y0 - s * ep.y0
	}
	let pairs = []
	for (let iter = 0; iter < 4 && p.units.length && g.units.length; iter++) {
		const cost = p.units.map((a) => g.units.map((b) => typeCost(a, b) + Math.hypot(s * a.cx + tx - b.cx, s * a.cy + ty - b.cy) / span))
		pairs = assign(cost).filter(([i, j]) => typeCost(p.units[i], g.units[j]) < 1)
		if (pairs.length >= 2) {
			const P = pairs.map(([i]) => p.units[i])
			const Q = pairs.map(([, j]) => g.units[j])
			const px = mean(P.map((u) => u.cx)), py = mean(P.map((u) => u.cy)), qx = mean(Q.map((u) => u.cx)), qy = mean(Q.map((u) => u.cy))
			let num_ = 0
			let den = 0
			for (let k = 0; k < P.length; k++) { num_ += (P[k].cx - px) * (Q[k].cx - qx) + (P[k].cy - py) * (Q[k].cy - qy); den += (P[k].cx - px) ** 2 + (P[k].cy - py) ** 2 }
			s = den > 1e-9 ? Math.min(4, Math.max(0.25, num_ / den)) : 1
			tx = qx - s * px
			ty = qy - s * py
		} else if (pairs.length === 1) {
			const [i, j] = pairs[0]
			s = 1
			tx = g.units[j].cx - p.units[i].cx
			ty = g.units[j].cy - p.units[i].cy
		}
	}
	const err = pairs.map(([i, j]) => Math.hypot(s * p.units[i].cx + tx - g.units[j].cx, s * p.units[i].cy + ty - g.units[j].cy))
	// order along x (Kendall tau over matched pairs; ground-truth ties within 2 cm skipped)
	let con = 0
	let dis = 0
	for (let a = 0; a < pairs.length; a++)
		for (let b = a + 1; b < pairs.length; b++) {
			const dg = g.units[pairs[a][1]].cx - g.units[pairs[b][1]].cx
			if (Math.abs(dg) < 0.02) continue
			const dp = p.units[pairs[a][0]].cx - p.units[pairs[b][0]].cx
			if (dp * dg > 0) con++
			else dis++
		}
	// sizes: true metres (the catalog's sizes are real), not scaled
	const sizes = pairs.map(([i, j]) => {
		const a = p.units[i]
		const b = g.units[j]
		const ew = b.w > 1e-4 ? Math.abs(a.w / b.w - 1) : 0
		const eh = b.h > 1e-4 ? Math.abs(a.h / b.h - 1) : 0
		return { gt: b.id, produced: a.id, w_err: round(ew, 3), h_err: round(eh, 3), err: round((ew + eh) / 2, 3) }
	})
	const matchedG = new Set(pairs.map(([, j]) => j))
	const matchedP = new Set(pairs.map(([i]) => i))
	// hard checks: the scale fit, every matched size, the count of each type (units: a domino row's dominoes)
	const ug = new Map()
	const up = new Map()
	for (const u of g.units) ug.set(u.type, (ug.get(u.type) ?? 0) + 1)
	for (const u of p.units) up.set(u.type, (up.get(u.type) ?? 0) + 1)
	const countDiffs = [...new Set([...ug.keys(), ...up.keys()])].filter((k) => (ug.get(k) ?? 0) !== (up.get(k) ?? 0)).map((k) => `${k}: ${ug.get(k) ?? 0} in the picture, ${up.get(k) ?? 0} built`)
	const worstSize = sizes.reduce((m, z) => Math.max(m, z.w_err, z.h_err), 0)
	const hardChecks = {
		scale_dev: round(Math.abs(s - 1), 4),
		scale_ok: pairs.length >= 2 ? Math.abs(s - 1) <= GT_LIMITS.scale : true,
		worst_size_err: round(worstSize, 3),
		size_ok: worstSize <= GT_LIMITS.size,
		count_diffs: countDiffs,
		counts_ok: countDiffs.length === 0
	}
	hardChecks.ok = hardChecks.scale_ok && hardChecks.size_ok && hardChecks.counts_ok
	return {
		hard: hardChecks,
		types, families: familiesScore,
		order: { kendall_tau: con + dis ? round((con - dis) / (con + dis), 4) : null, pairs: con + dis },
		position: { scale: round(s, 4), offset: [round(tx, 4), round(ty, 4)], mean_m: round(mean(err) ?? NaN, 4), rms_m: round(Math.sqrt(mean(err.map((e) => e * e)) ?? NaN), 4), mean_rel: round((mean(err) ?? NaN) / span, 4) },
		size: { mean_rel_err: round(mean(sizes.map((z) => z.err)) ?? NaN, 4), worst: sizes.sort((a, b) => b.err - a.err).slice(0, 5) },
		matched: pairs.length, gt_units: g.units.length, produced_units: p.units.length,
		unmatched_gt: g.units.filter((_, j) => !matchedG.has(j)).map((u) => `${u.id} (${u.type})`),
		unmatched_produced: p.units.filter((_, i) => !matchedP.has(i)).map((u) => `${u.id} (${u.type})`),
	}
}

/** Every spec and group of the case files resolves, and every group's types are catalog types. -> [problem] */
export function checkCases(bench = loadBench()) {
	const cat = loadCatalog()
	const out = []
	for (const [g, types] of Object.entries(bench.groups)) for (const t of types) if (!cat.types.has(t)) out.push(`group ${g}: ${t} is not a catalog type`)
	for (const f of bench.families) if (!bench.groups[f]) out.push(`family ${f} is not a group`)
	const seen = new Set()
	const probe = { id: "?", type: "?" }
	const spec = (s, where) => {
		try {
			matches(s, probe, bench.groups)
			for (const t of specTypes(s, bench.groups)) if (!cat.types.has(t)) out.push(`${where}: ${t} is not a catalog type`)
		} catch (e) { out.push(`${where}: ${e.message}`) }
	}
	for (const [id, c] of bench.cases) {
		if (seen.has(id)) out.push(`duplicate id ${id}`)
		seen.add(id)
		const ex = c.expect ?? {}
		for (const s of ex.must_types ?? []) spec(s, `${id}.must_types`)
		for (const s of ex.forbid_types ?? []) spec(s, `${id}.forbid_types`)
		for (const k of ex.counts ?? []) spec(k.of, `${id}.counts`)
		for (const r of ex.relations ?? []) {
			for (const key of ["a", "b", "c"]) if (r[key] !== undefined) spec(r[key], `${id}.relations.${r.rel}`)
			for (const s of r.specs ?? []) spec(s, `${id}.relations.${r.rel}`)
			if (!REL[r.rel] && !["held", "angled", "upright", "height_above_table", "on_table", "stack", "order_x", "same_height", "between", "opposite_sides"].includes(r.rel)) out.push(`${id}: unknown relation ${r.rel}`)
		}
		for (const o of ex.outcomes ?? []) {
			for (const key of ["item", "container", "of", "on", "a", "b", "past", "from"]) if (o[key] !== undefined) spec(o[key], `${id}.outcomes.${o.kind}`)
			for (const st of o.steps ?? []) for (const key of ["a", "b", "of"]) if (st[key] !== undefined) spec(st[key], `${id}.outcomes.sequence`)
			if (!["in", "lands_on", "leaves", "topples", "displaced", "hits", "moves", "stays", "rises", "descends", "swings", "reaches", "chain_events", "sequence"].includes(o.kind)) out.push(`${id}: unknown outcome ${o.kind}`)
		}
		for (const p of ex.prop_checks ?? []) spec(p.of, `${id}.prop_checks`)
		for (const m of [...(ex.must_missing ?? []), ...(ex.may_missing ?? [])]) if (!m.what || !Array.isArray(m.match) || !m.match.length) out.push(`${id}: a missing entry needs what + match`)
		if (c.base_scene) try { baseSceneOf(c) } catch (e) { out.push(`${id}: base scene: ${e.message}`) }
		if (ex.edit && !c.base_scene) out.push(`${id}: edit checks without a base scene`)
		if (c.source === "image" && c.file && !fs.existsSync(path.join(bench.dir, c.file))) out.push(`${id}: image ${c.file} not found`)
		if (c.gt && !fs.existsSync(path.join(bench.dir, c.gt))) out.push(`${id}: ground truth ${c.gt} not found`)
	}
	return out
}

// ------------------------------------------------------------------------------------------------ CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
	const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"))
	if (process.argv.includes("--check-cases")) {
		const probs = checkCases()
		console.log(probs.length ? probs.join("\n") : `ok: ${loadBench().cases.size} cases`)
		process.exit(probs.length ? 1 : 0)
	} else if (arg("--case")) {
		const c = loadBench().cases.get(arg("--case"))
		if (!c) { console.error("no such case"); process.exit(2) }
		const r = await scoreCase(c, read(arg("--produced")))
		console.log(JSON.stringify(r, null, 1))
	} else if (arg("--gt")) {
		const gt = read(path.join(HERE, "gt", `${arg("--gt")}.json`))
		console.log(JSON.stringify(scoreAgainstGT(gt, read(arg("--scene"))), null, 1))
	} else {
		console.log("usage: node ai/bench/score.mjs --check-cases | --case <id> --produced <file.json> | --gt <id> --scene <scene.json>")
	}
	process.exit(0)
}
