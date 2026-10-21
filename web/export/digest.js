// The director's TIMELINE DIGEST (scratchpad design DIRECTOR.md section 2): what the engine knows about a run before a single frame is filmed
// (every body's path, every contact, every start and stop, every light ray's path, every reading over time), cut down to what a director
// names, each fact with the id a shot plan uses for it. A shot plan (web/export/shot-plan.schema.json) may name only what the digest lists: the
// validator (ai/shot-plan.mjs) resolves every id against it, and the plan's executor resolves the same ids the same way.
//
//   buildDigest({runs: [{lane, scene, run, hints?, recog?, moments?}], recognize?, catalog?, registry?, hints?}) -> digest
//     runs       one entry per run: lane "" for a plan filmed from one run, else the lane id each run is filmed for (a comparison filmed as
//                one run per lane: the lesson compositor's two scenes). run is the /api/simulate answer ({doc, track, summary}). recog: the
//                recognizer's answer when the caller has it already; moments: {index: {id: t}, what: {id: words}} from the plan's executor
//                (web/export/shots.js makeWorld's run.M), so the ids the director reads are exactly the ones the executor resolves.
//     recognize  web/export/subjects.js recognize() when the caller has it (the cast's ranks and roles, the moments it names, lanes found in
//                one scene); without it the digest ranks the cast itself (what moves or reads first) and finds starts and stops alone
//     catalog, registry, hints   recognize()'s own inputs (hints: subjects, roles, brief, cues, pairs, text, pauses)
//   digestText(digest) -> the compact text the director reads (ids first, one fact per line, metres and seconds)
//   momentTime(digest, moment, lane?) -> run seconds of a moment id ("contact:a+b#2", {at, plus}, "release@top"), or undefined
//
// Moment ids are made by the same rules as the shot-plan compiler's (the prototype tools/compile.mjs loadRun, which web/export's executor
// ports): start, release, result, end, pause:setup, pause:result; start:/stop:/exit:/landing:/apex: from the recognizer; contact:<a>+<b>[#n]
// for every impact of two items (both orders, numbered over all of that pair's impacts); event:<kind>:<item>[#n] for the modules'
// happenings; beam:<source>:on; turn:<item>[#n] where a moving thing turns back; cue:<n> from the hints; reading:<item>.<key>:<edge> on demand.
// Extents are physics outlines (a sail, a fan's guard, a lamp's head and a liquid are drawn larger). Pure: it reads only its arguments and
// returns the same digest for the same input (the run's track gets its static placements filled in, as every reader of a track does).
import { completeTrack, placementsAt } from "../track.js"
import * as Optics from "../sim/optics.js"

export const DIGEST_VERSION = 1
const HZ = 60 // samples a second for paths and boxes
const TURN_HZ = 120 // the compiler's rate for turn moments
const MOVE_M = 0.02 // a thing "starts" once its centre has moved this far
const REST_M = 0.005 // ... and is at rest once it stays this close to where it ends
const BEAM_CORE_M = 0.0016 // the optics drawing: core 1.6 mm, glow 7 mm (the safety net wants the core 1.5 px wide at the output width)

// ------------------------------------------------------------------------------------------------ small helpers
const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const r2 = (v) => Math.round(v * 100) / 100
const r3 = (v) => Math.round(v * 1000) / 1000
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const f2 = (v) => String(r2(v))
const f3 = (v) => String(r3(v))
const deg = (a) => (a * 180) / Math.PI

function outlineLocal(body) {
	if (!body) return []
	if (body.kind === "ball") return Array.from({ length: 16 }, (_, i) => [body.radius * Math.cos((i * Math.PI) / 8), body.radius * Math.sin((i * Math.PI) / 8)])
	if (body.kind === "polygon" && Array.isArray(body.points)) return body.points.map((p) => [p.x, p.y])
	const hw = (num(body.width, 0.05) / 2) * Math.max(1, num(body.taper, 1))
	const hh = num(body.height, 0.05) / 2
	return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
}
function worldPts(local, q) {
	const s = num(q.scale, 1)
	if (s <= 0.001) return []
	const c = Math.cos(num(q.angle)), n = Math.sin(num(q.angle))
	return local.map(([x, y]) => [q.x + (x * c - y * n) * s, q.y + (x * n + y * c) * s])
}
function boxOf(pts) {
	if (!pts.length) return null
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
	for (const [x, y] of pts) {
		if (x < x0) x0 = x
		if (x > x1) x1 = x
		if (y < y0) y0 = y
		if (y > y1) y1 = y
	}
	return [x0, x1, y0, y1]
}
const unionBox = (bs) => {
	const v = bs.filter(Boolean)
	return v.length ? [Math.min(...v.map((b) => b[0])), Math.max(...v.map((b) => b[1])), Math.min(...v.map((b) => b[2])), Math.max(...v.map((b) => b[3]))] : null
}
const centreOf = (b) => [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2]
const boxText = (b) => (b ? `x ${f2(b[0])}..${f2(b[1])} y ${f2(b[2])}..${f2(b[3])}` : "-")
const sizeText = (b) => (b ? `${fmtLen(b[1] - b[0])} x ${fmtLen(b[3] - b[2])}` : "-")
const fmtLen = (m) => (m >= 0.1 ? `${r2(m)} m` : `${Math.round(m * 1000) / 10} cm`)
/** The closest points of two outlines (point lists, closed polygons) and their distance: [[x, y], d]. */
function closest(A, B) {
	let best = null, bd = Infinity
	const segPt = (p, a, b) => {
		const dx = b[0] - a[0], dy = b[1] - a[1]
		const L = dx * dx + dy * dy
		const u = L > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0
		return [a[0] + dx * u, a[1] + dy * u]
	}
	const scan = (P, Q) => {
		for (const p of P)
			for (let i = 0; i < Q.length; i++) {
				const q = segPt(p, Q[i], Q[(i + 1) % Q.length])
				const d = Math.hypot(p[0] - q[0], p[1] - q[1])
				if (d < bd) [bd, best] = [d, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]]
			}
	}
	scan(A, B)
	scan(B, A)
	return [best, bd]
}
/** FNV-1a over a string, as 16 hex digits (two 32-bit lanes): the same in node and in a browser. */
export function hashText(s) {
	let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
		h2 = Math.imul(h2 ^ c ^ (i & 0xff), 0x01000193) >>> 0
	}
	return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
}

// ------------------------------------------------------------------------------------------------ one run
/**
 * The digest of one run. -> {key, name, seconds, release, time_lapse, table, cast, scenery, moments, index, contacts, events, readings, beams,
 * marks, instruments, found: {lanes, pairs, variable, readables, holds}}. index: every moment id -> run seconds (the moments list shows the ones
 * worth naming, the index has them all: both orders of every contact and every later contact).
 */
export function digestRun({ scene, run, recognize = null, recog = null, moments: given = null, catalog = null, registry = {}, hints = {} }) {
	if (!isObj(scene) || !isObj(run) || !isObj(run.doc) || !isObj(run.track)) throw new Error("digestRun needs a scene and its run ({doc, track})")
	const doc = run.doc
	const track = completeTrack(run.track)
	const dur = num(doc.seconds, num(scene.seconds, track.frames.at(-1)?.t ?? 0))
	const release = num(doc.release?.at, num(scene.release, 0))
	const key = String(scene.id ?? doc.id ?? scene.name ?? "scene")
	const named = new Map((scene.items ?? []).filter((i) => isObj(i) && typeof i.id === "string").map((i) => [i.id, i]))
	const solidsOf = new Map()
	for (const s of doc.solids ?? []) {
		if (!solidsOf.has(s.item)) solidsOf.set(s.item, [])
		solidsOf.get(s.item).push(s)
	}
	const partOf = (s) => (typeof s.id === "string" && s.id.startsWith(`${s.item}/`) ? s.id.slice(s.item.length + 1) : s.part ?? s.id)
	const local = new Map((doc.solids ?? []).map((s) => [s.id, outlineLocal(s.body)]))
	const poseOf = (P, s) => P[s.id] ?? { x: num(s.at?.x), y: num(s.at?.y), angle: num(s.angle) }
	const visible = (id) => (solidsOf.get(id) ?? []).filter((s) => !s.hidden_3d)
	const itemBoxAt = (id, P) => boxOf(visible(id).flatMap((s) => worldPts(local.get(s.id), poseOf(P, s))))
	const itemOfSolid = new Map((doc.solids ?? []).map((s) => [s.id, s.item]))

	// the recognizer (web/export/subjects.js), when the caller has it
	let R = isObj(recog) ? recog : null
	if (!R && typeof recognize === "function") {
		try {
			R = recognize({ scene, run, catalog: catalog ?? { types: [] }, registry: registry ?? {}, hints: hints ?? {} })
		} catch (e) {
			R = null
		}
	}

	// paths: each item's box per sample, its swept box, start, rest and top speed
	const n = Math.max(1, Math.ceil(dur * HZ)) + 1
	const P = Array.from({ length: n }, (_, k) => placementsAt(track, Math.min(dur, k / HZ)))
	const motion = new Map()
	for (const [id] of solidsOf) {
		const boxes = P.map((p) => itemBoxAt(id, p))
		const first = boxes.findIndex(Boolean)
		if (first < 0) continue
		const c0 = centreOf(boxes[first])
		let start = null, vmax = 0, prev = c0, swept = boxes[first]
		let scaleMin = 1, scaleMax = 1
		for (let k = 0; k < n; k++) {
			const b = boxes[k]
			for (const s of visible(id)) {
				const q = P[k][s.id]
				if (q && q.scale !== undefined) {
					scaleMin = Math.min(scaleMin, q.scale)
					scaleMax = Math.max(scaleMax, q.scale)
				}
			}
			if (!b) continue
			swept = unionBox([swept, b])
			const c = centreOf(b)
			if (start === null && Math.hypot(c[0] - c0[0], c[1] - c0[1]) > MOVE_M) start = k / HZ
			if (k > first) vmax = Math.max(vmax, Math.hypot(c[0] - prev[0], c[1] - prev[1]) * HZ)
			prev = c
		}
		let rest = null
		const lastK = boxes.findLastIndex(Boolean)
		if (start !== null) {
			const cf = centreOf(boxes[lastK])
			for (let k = lastK; k >= 0; k--) {
				const b = boxes[k]
				if (b && Math.hypot(centreOf(b)[0] - cf[0], centreOf(b)[1] - cf[1]) > REST_M) {
					rest = Math.min(dur, (k + 1) / HZ)
					break
				}
			}
			if (rest !== null && rest >= dur - 1 / HZ) rest = null // (still moving at the end)
		}
		// (its box ten times a second: the automatic plan frames a stretch of the run on where things are then)
		const coarse = []
		for (let k = 0; k < n; k += HZ / 10) if (boxes[k]) coarse.push([r3(k / HZ), ...boxes[k].map(r3)])
		if (boxes[lastK] && coarse.at(-1)?.[0] !== r3(lastK / HZ)) coarse.push([r3(lastK / HZ), ...boxes[lastK].map(r3)])
		motion.set(id, { box0: boxes[first], boxEnd: boxes[lastK], swept, start, rest, vmax, scaleMin, scaleMax, lowY: Math.min(...boxes.filter(Boolean).map((b) => b[3])), coarse })
	}

	// the cast: ranked by the recognizer, else what moves or reads first
	const state = isObj(track.state) ? track.state : {}
	const scenery = new Set()
	const typeOf = (id) => named.get(id)?.type ?? solidsOf.get(id)?.[0]?.itemType ?? ""
	const sceneryType = (id) => {
		const it = named.get(id)
		const t = typeOf(id)
		return t === "table" || t === "floor" || /^wall/.test(t) || it?.props?.invisible_in_3d === true || visible(id).length === 0 || (Array.isArray(catalog?.types) && catalog.types.find((c) => c.key === t)?.category === "Scenery")
	}
	const rankOf = new Map()
	const rolesOf = new Map()
	if (R) {
		for (const s of R.subjects ?? []) {
			rankOf.set(s.item, s.rank)
			rolesOf.set(s.item, Array.isArray(s.roles) ? s.roles : [])
		}
		for (const s of R.scenery ?? []) scenery.add(s.item ?? s)
		for (const s of R.others ?? []) if (!rankOf.has(s.item ?? s)) rankOf.set(s.item ?? s, "other")
	} else {
		for (const [id] of solidsOf) {
			if (sceneryType(id)) {
				scenery.add(id)
				continue
			}
			const m = motion.get(id)
			const reads = Object.keys(state[id] ?? {}).length > 0
			rankOf.set(id, (m && m.start !== null) || reads || (m && m.scaleMin < 0.95) ? "primary" : "context")
		}
	}
	const order = { primary: 0, context: 1, other: 2, scenery: 3 }
	const ground = (id) => {
		const t = typeOf(id)
		return t === "table" || t === "floor" || /^wall/.test(t) || named.get(id)?.props?.invisible_in_3d === true || visible(id).length === 0
	}
	const cast = []
	for (const [id] of solidsOf) {
		if (ground(id) || !motion.has(id)) continue
		if (scenery.has(id)) rankOf.set(id, "scenery")
		const m = motion.get(id)
		const it = named.get(id)
		const sols = solidsOf.get(id)
		const parts = sols.filter((s) => !s.hidden_3d).length > 1 ? sols.filter((s) => !s.hidden_3d).map(partOf) : []
		cast.push({
			id,
			name: String(it?.name ?? ""),
			type: typeOf(id),
			rank: rankOf.get(id) ?? "other",
			roles: rolesOf.get(id) ?? [],
			box0: m.box0.map(r3),
			size: [r3(m.box0[1] - m.box0[0]), r3(m.box0[3] - m.box0[2])],
			swept: m.start !== null || m.scaleMin < 0.95 ? m.swept.map(r3) : null,
			boxEnd: m.start !== null || m.scaleMin < 0.95 ? m.boxEnd.map(r3) : null,
			start: m.start === null ? null : r2(m.start),
			rest: m.rest === null ? null : r2(m.rest),
			top: r2(m.vmax),
			scale: m.scaleMin < 0.95 || m.scaleMax > 1.05 ? [r2(m.scaleMin), r2(m.scaleMax)] : null,
			parts,
			held: !!it?.held,
			fixed: !!it?.fixed
		})
	}
	cast.sort((a, b) => (order[a.rank] ?? 3) - (order[b.rank] ?? 3))
	const castIds = new Set(cast.map((c) => c.id))

	// moments, by id (the compiler's rules: the first time an id is put wins)
	const index = {}
	const what = {}
	const put = (id, t, w) => {
		if (index[id] === undefined && Number.isFinite(t)) {
			index[id] = r3(Math.max(0, Math.min(dur, t)))
			if (w) what[id] = w
		}
	}
	const counts = new Map()
	const putN = (base, t, w) => {
		const c = (counts.get(base) ?? 0) + 1
		counts.set(base, c)
		put(c === 1 ? base : `${base}#${c}`, t, w)
	}
	put("start", 0, "the run begins")
	put("release", release, release > 0 ? "what was held is let go" : "nothing is held")
	put("pause:setup", 0, "where a lesson asks about the setup")
	const cues = []
	if (R) {
		for (const m of R.moments ?? []) {
			if (m.kind === "result") put("result", m.t, "the outcome is there to see")
			else if (m.kind === "pause" && m.where === "result") put("pause:result", m.t, "where the lesson pauses")
			else if ((m.kind === "start" || m.kind === "stop" || m.kind === "exit") && m.item) put(`${m.kind}:${m.item}`, m.t, m.kind === "start" ? m.why ?? "it begins to move" : m.kind === "stop" ? m.why ?? "it comes to rest" : "it leaves for good")
			else if (m.kind === "event") {
				if (m.landing) put(`landing:${m.landing}`, m.t, `${m.landing} lands`)
				if (m.apex && m.items?.[0]) putN(`apex:${m.items[0]}`, m.t, "the top of its bounce")
			} else if (m.kind === "cue") cues.push(m)
		}
	} else {
		for (const cue of Array.isArray(hints?.cues) ? hints.cues : []) if (typeof cue?.at === "number") cues.push({ t: cue.at, step: cue.step })
		for (const c of cast) {
			const m = motion.get(c.id)
			if (c.start !== null && m.lowY < -0.3) {
				// (it fell off the table: gone for good)
				const k = P.findIndex((p) => {
					const b = itemBoxAt(c.id, p)
					return b && b[3] < -0.3
				})
				if (k >= 0) put(`exit:${c.id}`, k / HZ, "it leaves for good")
			}
		}
	}
	// (the cues by their order: cue:1, cue:2 ...; a chain step's cue also as step:<n>)
	cues.sort((a, b) => a.t - b.t)
	cues.forEach((c, i) => {
		put(`cue:${i + 1}`, c.t, "a caption cue")
		if (c.step !== undefined) put(`step:${c.step}`, c.t, `chain step ${c.step}`)
	})
	const results = [] // (filled below without the recognizer, before the run's end is the result)
	const cornersOf = (s, q) => {
		// (a solid's drawn box as the executor measures one: its outline's own box, turned with the solid; a ball's axis-aligned square)
		const k = num(q.scale, 1)
		if (!(k > 0.001)) return []
		const b = s.body ?? {}
		if (b.kind === "ball") {
			const R0 = num(b.radius, 0.02) * k
			return [[q.x - R0, q.y - R0], [q.x + R0, q.y + R0]]
		}
		const L = local.get(s.id)
		const bx = boxOf(L)
		if (!bx) return []
		const c = Math.cos(num(q.angle)), n = Math.sin(num(q.angle))
		return [[bx[0], bx[2]], [bx[1], bx[2]], [bx[1], bx[3]], [bx[0], bx[3]]].map(([x, y]) => [q.x + (x * c - y * n) * k, q.y + (x * n + y * c) * k])
	}
	// every moving thing's own path (its dynamic bodies' centre, 120 a second): its start, rest and turns
	const nT = Math.floor(dur * TURN_HZ) + 1
	const seriesOf = new Map()
	for (const [id, sols] of solidsOf) {
		const movers = sols.filter((q) => q.kind === "dynamic" && !q.hidden_3d)
		if (!movers.length) continue
		const cs = []
		for (let k = 0; k < nT; k++) {
			const Pk = placementsAt(track, Math.min(dur, k / TURN_HZ))
			const b = boxOf(movers.flatMap((s) => cornersOf(s, poseOf(Pk, s))))
			cs.push(b ? [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2] : [0, 0])
		}
		seriesOf.set(id, cs)
	}
	for (const [id, cs] of seriesOf) {
		const b0 = boxOf(visible(id).flatMap((s) => cornersOf(s, poseOf(P[0], s))))
		const size = b0 ? Math.max(b0[1] - b0[0], b0[3] - b0[2]) : 0.05
		const go = Math.min(0.02, 0.25 * (size || 0.05)), restM = Math.min(0.005, 0.1 * (size || 0.05))
		const c0 = cs[0]
		const k0 = cs.findIndex((c) => Math.hypot(c[0] - c0[0], c[1] - c0[1]) > go)
		if (k0 < 0) continue
		put(`start:${id}`, k0 / TURN_HZ, "it begins to move")
		const cf = cs[cs.length - 1]
		let k1 = cs.length - 1
		for (let k = cs.length - 1; k >= k0; k--) {
			if (Math.hypot(cs[k][0] - cf[0], cs[k][1] - cf[1]) > restM) break
			k1 = k
		}
		if (k1 < cs.length - 1 || (cs.length > 1 && Math.hypot(cs[cs.length - 2][0] - cf[0], cs[cs.length - 2][1] - cf[1]) < 1e-6)) {
			put(`stop:${id}`, k1 / TURN_HZ, "it comes to rest")
			if (castIds.has(id) && rankOf.get(id) === "primary") results.push(k1 / TURN_HZ)
		}
	}

	// contacts: every impact of two items, numbered per ordered pair over all of that pair's impacts (as the compiler numbers them)
	const nth = new Map()
	const pairs = new Map()
	for (const im of [...(track.impacts ?? [])].filter((x) => x && x.t >= 0).sort((x, y) => x.t - y.t)) {
		const a = itemOfSolid.get(im.a), b = itemOfSolid.get(im.b)
		if (!a || !b || a === b) continue
		for (const [x, y] of [[a, b], [b, a]]) {
			const k = `contact:${x}+${y}`
			const c = (nth.get(k) ?? 0) + 1
			nth.set(k, c)
			put(c === 1 ? k : `${k}#${c}`, im.t)
		}
		const pk = `${a}+${b}`
		const rk = `${b}+${a}`
		const key2 = pairs.has(rk) ? rk : pk
		if (!pairs.has(key2)) {
			const Pt = placementsAt(track, im.t)
			const sa = (doc.solids ?? []).find((s) => s.id === im.a), sb = (doc.solids ?? []).find((s) => s.id === im.b)
			let at = null
			if (sa && sb) {
				const [p] = closest(worldPts(local.get(sa.id), poseOf(Pt, sa)), worldPts(local.get(sb.id), poseOf(Pt, sb)))
				at = p ? [r3(p[0]), r3(p[1])] : null
			}
			pairs.set(key2, { a, b, t: r3(im.t), speed: r2(num(im.speed)), at, n: 0, later: [] })
		}
		const e = pairs.get(key2)
		e.n++
		if (e.n > 1 && num(im.speed) >= 0.12 && e.later.length < 4) e.later.push({ n: e.n, t: r3(im.t), speed: r2(num(im.speed)) })
	}
	const contacts = [...pairs.values()].map((c) => ({ id: `contact:${c.a}+${c.b}`, ...c })).sort((x, y) => x.t - y.t)
	for (const c of contacts) what[c.id] = `${c.b} meets ${c.a}${c.speed ? ` at ${c.speed} m/s` : ""}`

	// the modules' happenings
	const evN = new Map()
	const events = []
	for (const e of [...(track.events ?? [])].filter((x) => x && Number.isFinite(x.t)).sort((x, y) => x.t - y.t)) {
		for (const it of e.items ?? []) {
			const k = `event:${e.kind}:${it}`
			const c = (evN.get(k) ?? 0) + 1
			evN.set(k, c)
			const id = c === 1 ? k : `${k}#${c}`
			put(id, num(e.t), e.text)
			if (c <= 3) events.push({ id, kind: e.kind, item: it, items: e.items, t: r3(num(e.t)), text: String(e.text ?? "") })
		}
	}

	// readings: one value per track frame
	const frameT = (i) => track.frames[i]?.t ?? i / num(track.fps, 120)
	const readings = []
	const series = {}
	for (const [item, keys] of Object.entries(state)) {
		for (const [k, raw] of Object.entries(keys ?? {})) {
			if (!Array.isArray(raw) || !raw.length) continue
			const vs = []
			for (let i = 0; i < raw.length; i++) if (typeof raw[i] === "number" && Number.isFinite(raw[i])) vs.push([frameT(i), raw[i]])
			if (!vs.length) continue
			series[`${item}.${k}`] = vs
			const v0 = vs[0][1], v1 = vs[vs.length - 1][1]
			let lo = Infinity, hi = -Infinity, tLo = 0, tHi = 0
			for (const [t, v] of vs) {
				if (v > hi) [hi, tHi] = [v, t]
				if (v < lo) [lo, tLo] = [v, t]
			}
			const span = hi - lo || 1
			const starts = vs.find(([, v]) => Math.abs(v - v0) > 0.05 * span)?.[0]
			let settles = null
			for (let i = vs.length - 1; i >= 0; i--)
				if (Math.abs(vs[i][1] - v1) > 0.02 * span) {
					settles = vs[Math.min(vs.length - 1, i + 1)][0]
					break
				}
			const constant = hi - lo === 0
			const rd = { item, key: k, v0: +v0.toPrecision(4), end: +v1.toPrecision(4), min: +lo.toPrecision(4), max: +hi.toPrecision(4), constant }
			if (!constant) {
				rd.starts = starts === undefined ? null : r3(starts)
				rd.settles = settles === null ? 0 : r3(settles)
				rd.peak = r3(tHi)
				rd.lowest = r3(tLo)
			}
			readings.push(rd)
		}
	}

	// the result without the recognizer: when the last thing that matters has come to rest, happened or settled (a bulb's light, a cube's melt)
	if (!R) {
		const done = [
			...results,
			...events.filter((e) => castIds.has(e.item)).map((e) => e.t),
			...readings.filter((x) => !x.constant && castIds.has(x.item) && x.settles > 0).map((x) => x.settles)
		]
		if (done.length) {
			put("result", Math.min(dur, Math.max(...done) + 0.1), "the outcome is there to see")
			put("pause:result", Math.min(dur, Math.max(...done) + 0.1), "where a lesson asks about the outcome")
		}
	}
	put("result", dur, "the run ends")
	put("pause:result", index.result, "where a lesson asks about the outcome")
	put("end", dur, "the run ends")

	// optics: each light source's traced beam (the view's tracer and the compiler's choice of ray), when it is on and at the end
	const beams = []
	const rec = (doc.processes ?? []).find((p) => p && p.kind === "optics")
	if (rec && Array.isArray(rec.sources)) {
		const solidById = new Map((doc.solids ?? []).map((s) => [s.id, s]))
		let sc = null
		try {
			sc = Optics.sceneFromRecord(rec, (id) => solidById.get(id))
		} catch {
			sc = null
		}
		const stateAt = (item, key, t) => {
			const v = state?.[item]?.[key]
			if (!Array.isArray(v) || !v.length) return null
			const f = track.frames
			let i = 0
			while (i + 1 < f.length && f[i + 1].t <= t) i++
			const j = Math.min(i + 1, f.length - 1)
			const a = v[i] ?? v[v.length - 1], b = v[j] ?? a
			const span = f[j].t - f[i].t
			const u = span > 0 ? Math.min(1, Math.max(0, (t - f[i].t) / span)) : 0
			return typeof a === "number" && typeof b === "number" ? a + (b - a) * u : a
		}
		const levelAt = (i, t) => {
			const r = rec.sources[i]
			const item = sc?.sources?.[i]?.item ?? r?.item
			const on = stateAt(item, "on", t)
			let v = on === null || on === undefined ? Optics.switchedOn(r, t) : on > 0.5 ? 1 : 0
			if (v > 0 && r?.drive && typeof r.drive.item === "string") {
				const d = stateAt(r.drive.item, r.drive.key, t)
				v *= Math.max(0, typeof d === "number" ? d : 0) * (typeof r.drive.scale === "number" ? r.drive.scale : 1)
			}
			return v
		}
		;(sc?.sources ?? rec.sources).forEach((src, i) => {
			const id = src.item ?? rec.sources[i]?.item ?? rec.sources[i]?.id
			for (let k = 0; k <= Math.ceil(dur * TURN_HZ); k++) {
				const t = Math.min(dur, k / TURN_HZ)
				if (levelAt(i, t) > 0) {
					put(`beam:${id}:on`, t, `${id}'s light comes on`)
					break
				}
			}
		})
		if (sc)
			for (const [si, src] of sc.sources.entries()) {
				const item = src.item ?? src.id
				const onAt = num(rec.sources[si]?.on_at)
				const times = [...new Set([Math.min(dur, onAt + 0.05), num(index.result, dur), dur].map(r3))]
				const traces = []
				for (const t of times) {
					const b = traceBeam(sc, rec, si, track, t, solidById)
					if (!b || !b.pts.length) continue
					const same = traces.find((x) => JSON.stringify(x.pts) === JSON.stringify(b.pts))
					if (same) same.until = t
					else traces.push({ ...b, at: t, until: t })
				}
				beams.push({ source: item, kind: String(rec.sources[si]?.kind ?? src.kind ?? "light"), color: rec.sources[si]?.color ?? null, on: onAt, traces })
			}
	}

	// turn:<item>[#n]: a moving thing's motion along its main axis reverses (a pendulum's bob at each end of its swing)
	for (const [id, cs] of seriesOf) {
		const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1])
		const span = (a) => Math.max(...a) - Math.min(...a)
		const ax = span(xs) >= span(ys) ? xs : ys
		const sp = span(ax)
		if (!(sp > 0.01)) continue
		const dead = Math.max(0.001, 0.02 * sp)
		let dir = 0, ext = ax[0], extK = 0, count = 0
		for (let k = 1; k < ax.length; k++) {
			const v = ax[k]
			if (dir >= 0 && v > ext) [ext, extK] = [v, k]
			if (dir <= 0 && v < ext) [ext, extK] = [v, k]
			if (dir === 0 && Math.abs(v - ax[0]) > dead) dir = Math.sign(v - ax[0])
			else if (dir !== 0 && (ext - v) * dir > dead) {
				count++
				put(count === 1 ? `turn:${id}` : `turn:${id}#${count}`, extK / TURN_HZ, count % 2 ? "it turns back on the far side" : "it turns back where it started")
				dir = -dir
				ext = v
				extK = k
			}
		}
	}

	// the executor's own moments, when the caller has its world (web/export/shots.js makeWorld): the ids a plan names must be the ones it resolves
	if (isObj(given?.index)) {
		for (const k of Object.keys(index)) delete index[k]
		for (const k of Object.keys(what)) delete what[k]
		for (const [k, t] of Object.entries(given.index)) if (Number.isFinite(t)) index[k] = r3(t)
		for (const [k, w] of Object.entries(given.what ?? {})) if (typeof w === "string") what[k] = w
	}
	// (each thing's start and rest as the moments say them, so the cast's words and the moment ids agree)
	for (const c of cast) {
		if (index[`start:${c.id}`] !== undefined) c.start = r2(index[`start:${c.id}`])
		if (index[`stop:${c.id}`] !== undefined) c.rest = r2(index[`stop:${c.id}`])
	}
	// the regular swings (a pendulum, a spring): their turns are listed for the director
	const turnCount = {}
	for (const id of new Set(Object.keys(index).filter((k) => k.startsWith("turn:")).map((k) => k.slice(5).replace(/#\d+$/, "")))) {
		const ts = []
		for (let i = 1; index[i === 1 ? `turn:${id}` : `turn:${id}#${i}`] !== undefined; i++) ts.push(index[i === 1 ? `turn:${id}` : `turn:${id}#${i}`])
		if (!ts.length) continue
		const gaps = ts.slice(1).map((t, i) => t - ts[i])
		turnCount[id] = { n: ts.length, regular: ts.length >= 4 && Math.max(...gaps) < 1.3 * Math.min(...gaps) && Math.min(...gaps) >= 0.2 }
	}

	// lane and ruler marks, instruments
	const marks = (doc.processes ?? []).filter((p) => p && p.kind === "measure-mark").map((p) => ({ item: p.item, zero: num(p.zero), start: p.start ?? null, finish: p.finish ?? null }))
	const instruments = []
	for (const c of cast) {
		const face = (solidsOf.get(c.id) ?? []).find((s) => partOf(s) === "face")
		const keys = Object.keys(state[c.id] ?? {})
		const finals = isObj(run.summary?.readings?.[c.id]) ? run.summary.readings[c.id] : null
		if (face || (keys.length && c.roles.includes("instrument"))) {
			const fb = face ? boxOf(worldPts(local.get(face.id), poseOf(P[0], face))) : null
			instruments.push({ item: c.id, face: face ? "face" : null, faceSize: fb ? [r3(fb[1] - fb[0]), r3(fb[3] - fb[2])] : null, reads: keys, finals })
		}
	}

	// what the recognizer found
	const found = R
		? {
				lanes: Array.isArray(R.lanes) ? R.lanes.map((l) => ({ id: String(l.id), items: [...(l.items ?? [])] })) : null,
				pairs: Array.isArray(R.pairs) ? R.pairs : null,
				variable: Array.isArray(R.variable) ? R.variable : [],
				readables: Array.isArray(R.readables) ? R.readables.map((x) => ({ kind: x.kind, what: x.what, items: x.items })) : [],
				holds: {
					setup: (R.moments ?? []).find((m) => m.kind === "setup")?.hold ?? null,
					result: (R.moments ?? []).find((m) => m.kind === "result")?.hold ?? null
				}
			}
		: { lanes: null, pairs: null, variable: [], readables: [], holds: { setup: null, result: null } }

	const moments = Object.entries(index)
		.map(([id, t]) => ({ id, t, what: what[id] ?? "" }))
		.filter((m) => !/^(contact|event|turn):/.test(m.id) && !/^apex:.*#\d+$/.test(m.id))
		.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id))
	const tableItem = (scene.items ?? []).find((i) => i?.type === "table")
	const table = tableItem ? { y: 0, x0: r3(num(tableItem.x, 1.3) - num(tableItem.props?.width, 3.7) / 2), x1: r3(num(tableItem.x, 1.3) + num(tableItem.props?.width, 3.7) / 2) } : null
	const out = {
		key,
		name: String(scene.name ?? doc.id ?? key),
		seconds: r3(dur),
		release: r3(release),
		time_lapse: num(scene.settings?.time_lapse, 1),
		stage: isObj(scene.stage) ? scene.stage : null,
		table,
		cast,
		scenery: [...scenery].filter((id) => solidsOf.has(id) && ground(id)),
		moments,
		index,
		contacts,
		events,
		readings,
		beams,
		marks,
		instruments,
		turns: turnCount,
		found,
		items: Object.fromEntries([...solidsOf.keys()].map((id) => [id, { type: typeOf(id), parts: (solidsOf.get(id) ?? []).map(partOf), cast: castIds.has(id) }]))
	}
	Object.defineProperty(out, "series", { value: series, enumerable: false })
	Object.defineProperty(out, "recog", { value: R, enumerable: false })
	Object.defineProperty(out, "paths", { value: Object.fromEntries(cast.map((c) => [c.id, motion.get(c.id).coarse])), enumerable: false })
	return out
}

/** The beam of source si at run time t, as the compiler picks it: the central root's strongest chain from the source, each bounce with its
 *  point, item, face normal and angles in and out (degrees, from the normal). */
function traceBeam(sc, rec, si, track, t, solidById) {
	const P = placementsAt(track, t)
	const pose = (id) => P[id] ?? (solidById.get(id) ? { x: num(solidById.get(id).at?.x), y: num(solidById.get(id).at?.y), angle: num(solidById.get(id).angle) } : undefined)
	let res
	try {
		res = Optics.trace({ bodies: sc.bodies, sources: sc.sources, pose, level: (s) => Optics.switchedOn(rec.sources[sc.sources.indexOf(s)], t), segments: true })
	} catch {
		return null
	}
	const segs = (res.segments ?? []).filter((s) => s.src === si)
	if (!segs.length) return { pts: [], ends: [], bounces: [], lengths: [] }
	const w = (sg) => (sg.p ?? []).reduce((a, b) => a + b, 0)
	const roots = [...new Set(segs.map((s) => s.root))].sort((a, b) => a - b)
	const list = segs.filter((s) => s.root === roots[Math.floor(roots.length / 2)])
	const chain = []
	let cur = list.filter((s) => s.key === Math.min(...list.map((x) => x.key))).sort((a, b) => w(b) - w(a))[0]
	const used = new Set()
	while (cur && chain.length < 13) {
		chain.push(cur)
		used.add(cur)
		cur = list.filter((s) => !used.has(s) && Math.hypot(s.x0 - cur.x1, s.y0 - cur.y1) < 1e-6).sort((a, b) => w(b) - w(a))[0]
	}
	const itemOfBody = (i) => (i >= 0 ? sc.bodies[i]?.item ?? null : null)
	const cap = (s) => {
		const L = Math.hypot(s.x1 - s.x0, s.y1 - s.y0)
		const k = L > 3 ? 3 / L : 1
		return [r3(s.x0 + (s.x1 - s.x0) * k), r3(s.y0 + (s.y1 - s.y0) * k)]
	}
	const pts = [[r3(chain[0].x0), r3(chain[0].y0)], ...chain.map(cap)]
	const lengths = chain.map((s) => r3(Math.min(3, Math.hypot(s.x1 - s.x0, s.y1 - s.y0))))
	const ends = chain.map((s) => itemOfBody(s.end))
	const bounces = []
	for (let i = 0; i + 1 < chain.length; i++) {
		const a = chain[i], b = chain[i + 1]
		const dep = (res.deposits ?? []).find((d) => d.src === si && Math.hypot(d.x - a.x1, d.y - a.y1) < 1e-6)
		const ain = [a.x1 - a.x0, a.y1 - a.y0], aout = [b.x1 - b.x0, b.y1 - b.y0]
		const la = Math.hypot(...ain), lb = Math.hypot(...aout)
		const nrm = dep ? [dep.nx, dep.ny] : null
		const ang = (v, l) => (nrm ? r2(deg(Math.acos(Math.min(1, Math.abs((v[0] * nrm[0] + v[1] * nrm[1]) / l))))) : null)
		const turn = r2(deg(Math.acos(Math.max(-1, Math.min(1, (ain[0] * aout[0] + ain[1] * aout[1]) / (la * lb))))))
		bounces.push({ n: i + 1, at: [r3(a.x1), r3(a.y1)], item: itemOfBody(a.end), normal: nrm ? [r3(nrm[0]), r3(nrm[1])] : null, in: ang(ain, la), out: ang(aout, lb), turn })
	}
	const last = chain.at(-1)
	return { pts, ends, bounces, lengths, open: !(last && last.end >= 0) }
}

// ------------------------------------------------------------------------------------------------ the whole digest
/**
 * The digest of a video's run(s). runs: [{lane, scene, run}] (lane "" for one run). -> {version, hash, lanes (the lanes filmed as runs, or
 * null), runs: {lane: runDigest}, differs (what is not the same between the runs of a comparison)}.
 */
export function buildDigest({ runs, recognize = null, catalog = null, registry = {}, hints = {} } = {}) {
	if (!Array.isArray(runs) || !runs.length) throw new Error("buildDigest needs at least one run")
	const out = { version: DIGEST_VERSION, lanes: null, runs: {}, differs: null }
	for (const r of runs) {
		const lane = String(r.lane ?? "")
		const h = { ...(hints ?? {}), ...(isObj(r.hints) ? r.hints : {}) }
		out.runs[lane] = digestRun({ scene: r.scene, run: r.run, recognize, recog: r.recog ?? null, moments: r.moments ?? null, catalog, registry, hints: h })
	}
	const lanes = Object.keys(out.runs).filter((k) => k !== "")
	if (lanes.length) {
		out.lanes = lanes.map((id) => ({ id, run: out.runs[id].key }))
		out.differs = runDifferences(runs.filter((r) => String(r.lane ?? "") !== ""))
	}
	out.hash = hashText(JSON.stringify({ v: DIGEST_VERSION, runs: out.runs, lanes: out.lanes }))
	return out
}

/** What differs between the scenes of a comparison filmed one run per lane: each item by id (type, place, angle, props), and items in some
 *  runs only. -> [{item, what, values: {lane: text}}] */
function runDifferences(runs) {
	const per = runs.map((r) => ({ lane: String(r.lane), items: new Map((r.scene.items ?? []).filter((i) => isObj(i) && typeof i.id === "string").map((i) => [i.id, i])) }))
	const all = [...new Set(per.flatMap((p) => [...p.items.keys()]))]
	const out = []
	for (const id of all) {
		const has = per.filter((p) => p.items.has(id))
		if (has.length < per.length) {
			out.push({ item: id, what: "only in some lanes", values: Object.fromEntries(per.map((p) => [p.lane, p.items.has(id) ? "there" : "not there"])) })
			continue
		}
		const its = per.map((p) => p.items.get(id))
		const diffs = []
		const same = (f) => new Set(its.map((it) => JSON.stringify(f(it) ?? null))).size === 1
		if (!same((it) => it.type)) diffs.push(["type", (it) => it.type])
		for (const k of ["x", "y", "angle"]) {
			const vs = its.map((it) => num(it[k]))
			if (Math.max(...vs) - Math.min(...vs) > (k === "angle" ? 1 : 0.01)) diffs.push([k, (it) => r3(num(it[k]))])
		}
		const keys = [...new Set(its.flatMap((it) => Object.keys(it.props ?? {})))]
		for (const k of keys) if (!same((it) => it.props?.[k])) diffs.push([`props.${k}`, (it) => it.props?.[k]])
		for (const [what, f] of diffs) out.push({ item: id, what, values: Object.fromEntries(per.map((p, i) => [p.lane, JSON.stringify(f(its[i]) ?? null)])) })
	}
	return out
}

// ------------------------------------------------------------------------------------------------ moments, resolved
// (web/export/moments.js: pure and import-free, so the shot-plan validator can load it without the engine's modules)
export { momentTime, readingEdge } from "./moments.js"

// ------------------------------------------------------------------------------------------------ as text, for the director
const LIMITS = { cast: 40, moments: 70, contacts: 30, events: 24, readings: 32, beams: 6, differs: 30 }

/** The digest as the director reads it (DIRECTOR.md 2.2): compact, ids first, one fact per line, metres and seconds. */
export function digestText(digest) {
	const L = []
	const multi = Object.keys(digest.runs).length > 1 || !digest.runs[""]
	for (const [lane, r] of Object.entries(digest.runs)) {
		if (multi) L.push(`=== RUN for lane ${lane}: ${r.key}`)
		L.push(...runText(r))
		L.push("")
	}
	if (digest.lanes) {
		L.push(`LANES (each lane is its own run; a plan's lanes.list must use exactly these ids): ${digest.lanes.map((l) => `${l.id} = ${l.run}`).join(" | ")}`)
		if (digest.differs?.length) {
			L.push("DIFFERS between the lanes' runs (what the comparison varies; everything else is the same):")
			for (const d of digest.differs.slice(0, LIMITS.differs)) L.push(`  ${d.item} ${d.what}: ${Object.entries(d.values).map(([k, v]) => `${k} ${v}`).join(" | ")}`)
			if (digest.differs.length > LIMITS.differs) L.push(`  ... ${digest.differs.length - LIMITS.differs} more`)
		} else L.push("DIFFERS: nothing in the scenes differs (the runs are the same setup)")
	}
	return L.join("\n").trim()
}

function runText(r) {
	const L = []
	const tl = r.time_lapse && r.time_lapse !== 1 ? `, time-lapse x${r.time_lapse} (1 s of run = ${humanSeconds(r.time_lapse)} of real time; the whole run = ${humanSeconds(r.time_lapse * r.seconds)})` : ""
	L.push(`SCENE ${r.key} "${r.name}": ${r.seconds} s, release ${r.release}${tl}. Table top y = 0${r.table ? `, x ${r.table.x0}..${r.table.x1}` : ""}. Metres: x right, y up.`)
	L.push("CAST (boxes are physics outlines at the start; swept: the box over the whole run; drawn models are a little larger)")
	for (const c of r.cast.slice(0, LIMITS.cast)) {
		const bits = [`  ${c.id}`, c.rank, c.type, c.name ? `"${c.name}"` : null, `${boxText(c.box0)} (${sizeText(c.box0)})`]
		if (c.swept) bits.push(`swept ${boxText(c.swept)}`)
		if (c.start !== null) bits.push(`start ${c.start}${c.rest !== null ? ` rest ${c.rest}` : ""}, top ${c.top} m/s`)
		if (c.scale) bits.push(`scale ${c.scale[0]}..${c.scale[1]} (it changes size)`)
		if (c.held) bits.push("held until release")
		if (c.parts.length) bits.push(`parts: ${c.parts.slice(0, 8).join(", ")}${c.parts.length > 8 ? ` (+${c.parts.length - 8})` : ""}`)
		if (c.roles.length) bits.push(`roles: ${c.roles.join(",")}`)
		L.push(bits.filter(Boolean).join("  "))
	}
	if (r.cast.length > LIMITS.cast) L.push(`  ... ${r.cast.length - LIMITS.cast} more context items`)
	if (r.scenery.length) L.push(`  scenery (never frame for its own sake): ${r.scenery.join(", ")}`)
	if (r.found.lanes?.length > 1) {
		L.push(`LANES FOUND in this scene (one run; use them as a plan's lanes when the video compares them): ${r.found.lanes.map((l) => `${l.id}: ${l.items.join(", ")}`).join(" | ")}`)
		if (r.found.pairs?.length) L.push(`  paired across the lanes: ${r.found.pairs.map((p) => p.join("~")).join(", ")}`)
	}
	if (r.found.variable?.length) L.push(`VARIABLE (what the recognizer thinks differs or is tested): ${r.found.variable.join(", ")}`)
	const ms = r.moments.slice(0, LIMITS.moments)
	L.push(`MOMENTS ${ms.map((m) => `${m.id} ${m.t}`).join(" | ")}${r.moments.length > LIMITS.moments ? ` | ... ${r.moments.length - LIMITS.moments} more` : ""}`)
	const swings = Object.entries(r.turns ?? {}).filter(([, v]) => v.regular)
	if (swings.length) L.push(`TURNS (a regular swing: turn:<item>#n, odd n on the far side, even n back where it started): ${swings.map(([id, v]) => `${id} x${v.n}: ${Array.from({ length: Math.min(v.n, 10) }, (_, i) => `${i ? `#${i + 1}` : "turn:" + id} ${r.index[i ? `turn:${id}#${i + 1}` : `turn:${id}`]}`).join(", ")}`).join(" | ")}`)
	if (r.contacts.length) {
		L.push("CONTACTS (contact:<a>+<b> either order; #n is the pair's nth touch)")
		const shown = r.contacts.filter((c) => c.speed >= 0.12 || c.n === 1).slice(0, LIMITS.contacts)
		for (const c of shown) L.push(`  ${c.id} ${c.t} s${c.at ? ` at (${c.at.join(", ")})` : ""} ${c.speed} m/s${c.n > 1 ? `; ${c.n} touches in all${c.later.length ? ` (${c.later.map((x) => `#${x.n} ${x.t}`).join(", ")})` : ""}` : ""}`)
		if (r.contacts.length > shown.length) L.push(`  ... ${r.contacts.length - shown.length} more pairs`)
	}
	if (r.events.length) L.push(`EVENTS ${r.events.slice(0, LIMITS.events).map((e) => `${e.id} ${e.t} "${e.text}"`).join(" | ")}`)
	const rd = r.readings.filter((x) => !x.constant)
	if (rd.length) {
		L.push("READINGS (reading:<item>.<key>:<starts|settles|peak|min|max|crosses=v> names an edge)")
		for (const x of rd.slice(0, LIMITS.readings)) L.push(`  ${x.item}.${x.key} ${x.v0} -> ${x.end} [${x.min}..${x.max}] starts ${x.starts ?? "-"} settles ${x.settles} peak ${x.peak}`)
		if (rd.length > LIMITS.readings) L.push(`  ... ${rd.length - LIMITS.readings} more`)
	}
	const flat = r.readings.filter((x) => x.constant)
	if (flat.length) L.push(`STEADY READINGS ${flat.slice(0, 16).map((x) => `${x.item}.${x.key} ${x.v0}`).join(", ")}${flat.length > 16 ? ", ..." : ""}`)
	for (const b of r.beams.slice(0, LIMITS.beams)) {
		L.push(`BEAM ${b.source} (${b.kind}${b.color ? `, ${b.color}` : ""}): on from ${b.on} s; drawn ${BEAM_CORE_M * 1000} mm wide (its core reads in a window up to ${r2((1920 * BEAM_CORE_M) / 1.5)} m wide)`)
		for (const tr of b.traces) {
			const when = tr.at === tr.until ? `at ${tr.at} s` : `${tr.at}..${tr.until} s (the same path)`
			const seg = []
			let k = 0
			const parts = [`source (${tr.pts[0].join(", ")})`]
			for (const bo of tr.bounces) {
				parts.push(`bounce:${bo.n} on ${bo.item ?? "?"} at (${bo.at.join(", ")})${bo.normal ? `: normal (${bo.normal.join(", ")}), in ${bo.in} deg, out ${bo.out} deg` : ""}, turns ${bo.turn} deg`)
			}
			const lastEnd = tr.ends.at(-1)
			parts.push(lastEnd ? `hit:${lastEnd} at (${tr.pts.at(-1).join(", ")})` : `end (off at (${tr.pts.at(-1).join(", ")}))`)
			for (const len of tr.lengths) seg.push(`segment ${++k} ${len} m`)
			L.push(`  ${when}: ${parts.join(" -> ")}; ${seg.join(", ")}`)
		}
	}
	if (r.marks.length) L.push(`MARKS (target {mark: <item>, m}) ${r.marks.map((m) => `${m.item}: zero ${m.zero}${m.start !== null ? `, start ${m.start}` : ""}${m.finish !== null ? `, finish ${m.finish} m` : ""}`).join(" | ")}`)
	if (r.instruments.length) L.push(`INSTRUMENTS ${r.instruments.map((i) => `${i.item}${i.face ? ` face part "face" ${i.faceSize ? `${fmtLen(i.faceSize[0])} x ${fmtLen(i.faceSize[1])}` : ""}` : ""} reads ${i.reads.join(", ")}${i.finals ? ` (at the end: ${Object.entries(i.finals).filter(([, v]) => typeof v === "number").slice(0, 5).map(([k, v]) => `${k} ${+Number(v).toPrecision(4)}`).join(", ")})` : ""}`).join(" | ")}`)
	L.push("PATHS none published by the modules (hoses, wires): travel {through: [...]} the items along a route instead")
	return L
}

function humanSeconds(s) {
	if (s < 120) return `${r2(s)} s`
	if (s < 7200) return `${r2(s / 60)} min`
	return `${r2(s / 3600)} h`
}
