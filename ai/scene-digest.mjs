// A scene as the AI steps read it: every item with its anchor, angle, the props it sets, and its true outline box (built by web/sim's
// layout(), the exact port of the server's builder), what it rests on, and the builder's overlap warnings. Plain text for prompts.
//   const d = await sceneDigest(scene, catalogIndex)   // {text, items: [{id, type, x, y, angle, box, parts? ([{part, kind, w, h}]: each solid's own size, for items of 2-40 solids), rests_on, ghost? (every solid a ghost: display only), firm_box? (the box without its ghost solids), ...}], warnings, stage, table}
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { boundsOf, worldPoses, DEFAULT_STAGE } from "./catalog-digest.mjs"

const PG = dirname(dirname(fileURLToPath(import.meta.url)))
let simP = null
const sim = () => (simP ??= import(pathToFileURL(join(PG, "web", "sim", "index.js")).href))

const f3 = (v) => (Number.isFinite(v) ? (Math.abs(v) < 5e-4 ? "0" : v.toFixed(3).replace(/\.?0+$/, "")) : "?")
const fa = (v) => (Number.isFinite(v) ? (Math.abs(v) < 0.05 ? "0" : v.toFixed(1).replace(/\.0$/, "")) : "0")

/** Props an item sets that differ from its type's defaults (what the prompt needs to show). */
function ownProps(item, T) {
	const out = {}
	for (const [k, v] of Object.entries(item.props ?? {})) {
		if (v === null || v === undefined) continue
		const d = T?.props?.[k]?.default
		if (d !== undefined && d === v) continue
		out[k] = typeof v === "number" ? Number(v.toPrecision(5)) : v
	}
	return out
}

export async function sceneDigest(scene, catalog, { maxItems = 200 } = {}) {
	const stage = scene?.stage ?? DEFAULT_STAGE
	const items = (scene?.items ?? []).slice(0, maxItems)
	let doc = null
	let warnings = []
	let buildError = null
	try {
		const m = await sim()
		const r = m.layout(scene)
		doc = r.doc
		warnings = r.warnings ?? []
	} catch (e) {
		buildError = String(e?.message ?? e).slice(0, 300)
	}
	const poses = doc ? worldPoses(doc.solids) : null
	const byItem = new Map()
	if (doc) for (const s of doc.solids) (byItem.get(s.item) ?? byItem.set(s.item, []).get(s.item)).push(s)
	const rows = []
	for (const it of items) {
		const T = catalog?.types?.[it.type]
		const solids = byItem.get(it.id) ?? []
		const B = solids.length ? boundsOf(solids, poses) : null
		const kinds = new Set(solids.map((s) => s.kind))
		// each part's own size (a pendulum's bob and its hanger, each domino of a row): what a picture's object may be compared with
		const parts = []
		if (solids.length > 1 && solids.length <= 40)
			for (const s of solids) {
				const b = boundsOf([s], poses)
				if (b) parts.push({ part: s.part ?? s.id, kind: s.kind, w: b[2] - b[0], h: b[3] - b[1] })
			}
		rows.push({
			id: it.id,
			type: it.type,
			name: it.name ?? T?.name ?? it.type,
			x: Number(it.x) || 0,
			y: Number(it.y) || 0,
			angle: Number(it.angle) || 0,
			props: ownProps(it, T),
			held: !!it.held,
			fixed: !!it.fixed,
			moves: T ? (it.fixed ? false : kinds.size ? kinds.has("dynamic") : T.dynamic) : null,
			box: B ? { x0: B[0], y0: B[1], x1: B[2], y1: B[3] } : null,
			...(parts.length ? { parts } : {}),
			// (display only: every solid a ghost, which nothing ever touches (web/CONTRACT.md "Ghost solids"), a stopwatch's face or a trail's tag)
			...(solids.length && solids.every((s) => s.ghost) ? { ghost: true } : {}),
			// (some solids ghosts: the box of the others, what things can really rest on; a balance's pointer is drawn but holds nothing up)
			...(() => {
				if (!solids.some((s) => s.ghost) || solids.every((s) => s.ghost)) return {}
				const F = boundsOf(solids.filter((s) => !s.ghost), poses)
				return F ? { firm_box: { x0: F[0], y0: F[1], x1: F[2], y1: F[3] } } : {}
			})(),
			unknown: !T
		})
	}
	// what each item rests on: across its width, the other item whose surface is right under its underside (true outlines, not boxes)
	if (doc) {
		const outlines = new Map() // item id -> [outline] (world points, or a circle)
		for (const [id, solids] of byItem) outlines.set(id, solids.map((s) => outlineOf(s, poses.get(s.id))).filter(Boolean))
		// what can hold something up: the same outlines without ghost solids (nothing touches a ghost: a stopwatch's face holds no lane up)
		const firm = new Map()
		for (const [id, solids] of byItem) firm.set(id, solids.filter((s) => !s.ghost).map((s) => outlineOf(s, poses.get(s.id))).filter(Boolean))
		for (const r of rows) {
			if (!r.box || r.type === "table") continue
			const mine = outlines.get(r.id) ?? []
			const votes = new Map()
			const n = 9
			const xs = Array.from({ length: n }, (_, k) => r.box.x0 + ((k + 0.5) / n) * (r.box.x1 - r.box.x0))
			for (const o of mine) xs.push(o.c ? o.c[0] : o.pts.reduce((a, p) => (p[1] < a[1] ? p : a))[0] + 1e-4) // each part's lowest point (thin legs)
			for (const x of xs) {
				const bottom = Math.min(...mine.map((o) => spanAt(o, x)?.[0] ?? Infinity))
				if (!Number.isFinite(bottom)) continue
				let best = null
				for (const o of rows) {
					if (o === r) continue
					for (const ol of firm.get(o.id) ?? []) {
						const top = spanAt(ol, x)?.[1]
						if (top === undefined) continue
						const gap = bottom - top
						if (gap > -0.012 && gap < 0.01 && (!best || top > best.top)) best = { id: o.id, top }
					}
				}
				if (best) votes.set(best.id, (votes.get(best.id) ?? 0) + 1)
			}
			const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
			const table = rows.find((o) => o.type === "table")
			const frame = (byItem.get(r.id) ?? []).some((x) => x.kind === "static")
			r.rests_on = top ? (top[0] === table?.id ? "table" : top[0]) : r.moves && !frame ? "nothing (in the air)" : "nothing (fixed in place)"
		}
	}
	const table = rows.find((r) => r.type === "table")
	const tableText = table?.box ? `the table top is y = 0, from x ${f3(table.box.x0)} to ${f3(table.box.x1)}` : "the table top is y = 0"
	const lines = [`Stage: x ${f3(stage.x0)}…${f3(stage.x1)}, y ${f3(stage.y0)}…${f3(stage.y1)} m; ${tableText}. seconds ${scene?.seconds ?? 4.5}, release ${scene?.release ?? 0.5} s.`]
	lines.push(`Items (${rows.length}): id · type "name" · how it moves · anchor (x, y) · angle · outline box · rests on · props it sets`)
	for (const r of rows) {
		if (r.type === "table") continue
		const how = r.unknown ? "UNKNOWN TYPE (left out of the build)" : r.fixed ? "fixed" : r.moves ? (r.held ? "dynamic, held until the release" : "dynamic") : "static"
		const box = r.box ? `box x ${f3(r.box.x0)}…${f3(r.box.x1)}, y ${f3(r.box.y0)}…${f3(r.box.y1)}` : "no outline"
		const props = Object.keys(r.props).length ? Object.entries(r.props).map(([k, v]) => `${k} ${typeof v === "string" ? JSON.stringify(v) : v}`).join(", ") : "defaults"
		lines.push(`- ${r.id} · ${r.type} "${r.name}" · ${how} · (${f3(r.x)}, ${f3(r.y)}) · ${fa(r.angle)}° · ${box} · on ${r.rests_on ?? "?"} · ${props}`)
	}
	if (table && Object.keys(table.props).length) lines.push(`Table props: ${JSON.stringify(table.props)}`)
	const goals = (scene?.goals ?? []).filter((g) => g?.item && g?.container)
	if (goals.length) lines.push(`Goals: ${goals.map((g) => `"${g.label ?? ""}" (${g.item} in ${g.container})`).join("; ")}`)
	if (warnings.length) lines.push(`Overlaps at the start: ${warnings.map((w) => w.text).join("; ")}`)
	if (buildError) lines.push(`The builder could not lay this scene out: ${buildError}`)
	return { text: lines.join("\n"), items: rows, warnings, stage, table: table?.box ?? null, buildError }
}

/** A solid's outline in the world: {pts} (a convex polygon) or {c, r} (a ball). */
function outlineOf(s, pose) {
	if (!pose || !s.body) return null
	const [x, y, a] = pose
	const b = s.body
	if (b.kind === "ball") return { c: [x, y], r: b.radius }
	let pts
	if (b.kind === "polygon") pts = b.points.map((p) => [p.x, p.y])
	else if (b.kind === "slab") {
		const hw = b.width / 2
		const hh = b.height / 2
		const hb = hw * (b.taper ?? 1)
		pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
	} else return null
	const c = Math.cos(a)
	const n = Math.sin(a)
	return { pts: pts.map(([px, py]) => [x + px * c - py * n, y + px * n + py * c]) }
}
/** [lowest y, highest y] of an outline on the vertical line at x, or null when the line misses it. */
function spanAt(o, x) {
	if (o.r !== undefined) {
		const dx = x - o.c[0]
		if (Math.abs(dx) > o.r) return null
		const h = Math.sqrt(o.r * o.r - dx * dx)
		return [o.c[1] - h, o.c[1] + h]
	}
	let lo = Infinity
	let hi = -Infinity
	const P = o.pts
	for (let i = 0; i < P.length; i++) {
		const [x1, y1] = P[i]
		const [x2, y2] = P[(i + 1) % P.length]
		if ((x < Math.min(x1, x2)) || (x > Math.max(x1, x2))) continue
		const y = x1 === x2 ? null : y1 + ((x - x1) / (x2 - x1)) * (y2 - y1)
		for (const v of y === null ? [y1, y2] : [y]) {
			lo = Math.min(lo, v)
			hi = Math.max(hi, v)
		}
	}
	return Number.isFinite(lo) ? [lo, hi] : null
}

/** A run's summary (goals, stories, first hits) and warnings as short text. o.goals: the plan's goals checked (ai/goals.mjs checkGoals),
 *  shown instead of the summary's own (which has only the "in" goals the scene kept); o.stages: the plan's stage checks, checked. */
export function simText(sim, o = {}) {
	const checked = Array.isArray(o.goals) ? o.goals : null
	const verdict = (g) => (g.ok === true ? "MET" : g.ok === false ? "FAILED" : "NOT CHECKED")
	const goalLine = (list) =>
		`Goals: ${list.map((g) => `${verdict(g)}: ${g.label ?? `${g.item} in ${g.container}`}${g.kind && g.kind !== "in" ? ` [${g.kind}]` : ""}${g.detail && g.ok !== true ? ` (${g.detail})` : g.detail && g.kind !== "in" ? ` (${g.detail})` : ""}`).join("; ")}`
	const stages = Array.isArray(o.stages) ? o.stages.filter((g) => g && typeof g === "object") : []
	const firstFailing = stages.find((g) => g.ok === false)
	const stageLine = stages.length
		? `Stage checks (the plan's stages, in order): ${stages.map((g) => `${g.stage ?? "?"} ${verdict(g)}: ${g.label}${g.kind ? ` [${g.kind}]` : ""}${g.detail ? ` (${g.detail})` : ""}`).join("; ")}${firstFailing ? `. The first stage that fails is stage ${firstFailing.stage}: fix it first (its items and its knobs), and keep the stages before it as they are.` : "."}`
		: null
	if (!sim || typeof sim !== "object") return [checked?.length ? goalLine(checked) : null, stageLine, checked?.length || stageLine ? "No other run results were given." : "No run results were given."].filter(Boolean).join("\n")
	const s = sim.summary ?? sim
	const lines = []
	const goals = checked ?? (Array.isArray(s.goals) ? s.goals : [])
	if (goals.length) lines.push(goalLine(goals))
	else lines.push("Goals: none stated.")
	if (stageLine) lines.push(stageLine)
	const stories = Array.isArray(s.stories) ? s.stories : []
	if (stories.length) lines.push(`What each moving item did: ${stories.slice(0, 40).map((t) => `${t.item}: ${t.text}${t.moved_at != null ? ` (moves at ${Number(t.moved_at).toFixed(2)} s)` : ""}`).join("; ")}`)
	const events = Array.isArray(s.events) ? s.events : []
	if (events.length) lines.push(`First hits, in order: ${events.slice(0, 20).map((e) => `${Number(e.t).toFixed(2)} s ${e.text}${e.speed != null ? ` at ${Number(e.speed).toFixed(2)} m/s` : ""}`).join("; ")}`)
	else lines.push("First hits: nothing hit anything.")
	const warns = Array.isArray(sim.warnings) ? sim.warnings : []
	if (warns.length) lines.push(`Warnings: ${warns.slice(0, 20).map((w) => w.text ?? String(w)).join("; ")}`)
	if (Array.isArray(sim.final)) lines.push(`Where things ended: ${sim.final.slice(0, 40).map((p) => `${p.id} (${f3(p.x)}, ${f3(p.y)})`).join("; ")}`)
	if (sim.tuned) lines.push(`The tuner changed: ${typeof sim.tuned === "string" ? sim.tuned : JSON.stringify(sim.tuned).slice(0, 600)}`)
	return lines.join("\n")
}
