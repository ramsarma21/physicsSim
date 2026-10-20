// The edit step's scene digest (ai/DESIGN.md §14; measured in ai/experiments/edit, arm n7): everything a user might call an item by (its
// colour and look from the catalog's "Looks:" line, its kind, its size, where it is in words: left / middle / right third, what it rests on,
// how high above what it hovers), what it holds up, its part in the LAST RUN (when it starts moving, what it hits and is hit by, with times and
// speeds, its story, where it ends), the groups of look-alikes that make "the ball" ambiguous, and the run's goals and order of events. Exact
// numbers stay for the patches.
//   import { sceneDigest } from "./scene-digest.mjs"
//   const d = await sceneDigest(scene, cat.index)
//   const sim = await runScene(scene)                      // steps.mjs: the same run as /api/simulate (~0.2-0.4 s); + layout(scene).resolved
//   const r = richDigestFrom(scene, d, { sim: { ...sim, resolved }, plan, cat, goalResults })   // {text, groups, rows, hash}
// steps.mjs edit() uses r.text as "# The current scene". The one change from the measured module: `goalResults` (the plan's goals of the
// other kinds, falls / hits / moves, checked on the same run: ai/goals.mjs checkGoals) shows those goals as MET / FAILED too, where the
// experiment listed them as "label [kind]" (§13.8: the edit model sees which goals happen now, every kind).
import { createHash } from "node:crypto"

const f2 = (v) => (Number.isFinite(v) ? (Math.abs(v) < 5e-3 ? "0" : v.toFixed(2).replace(/\.?0+$/, "")) : "?")
const f3 = (v) => (Number.isFinite(v) ? (Math.abs(v) < 5e-4 ? "0" : v.toFixed(3).replace(/\.?0+$/, "")) : "?")
const fa = (v) => (Number.isFinite(v) ? (Math.abs(v) < 0.05 ? "0" : v.toFixed(1).replace(/\.0$/, "")) : "0")
const len = (m) => (m >= 1 ? `${+m.toFixed(2)} m` : `${+(m * 100).toFixed(1)} cm`)
const mass = (kg) => (kg >= 1 ? `${+kg.toPrecision(3)} kg` : kg >= 0.001 ? `${+(kg * 1000).toPrecision(3)} g` : `${+(kg * 1e6).toPrecision(3)} mg`)
const safety = (i) => i?.type === "wall" && i.props?.invisible_in_3d === true
const COLOURS = ["yellow-green", "off-white", "red-brown", "paper", "cardboard", "red", "yellow", "green", "blue", "white", "black", "orange", "brown", "grey", "gray", "silver", "pink", "purple", "clear", "cream", "tan", "beige", "dark", "striped", "wooden", "wood", "steel", "glass"]

let LOOKS = null
/** Each type's "Looks:" line from the catalog digest (what colour and kind of thing the view draws). */
export function looksOf(cat) {
	if (LOOKS?.fp === cat.fingerprint) return LOOKS.map
	const map = {}
	for (const sec of cat.text.split(/\n### /).slice(1)) {
		const key = /^([\w-]+) —/.exec(sec)?.[1]
		const looks = /\nLooks: ([^\n]+)/.exec(sec)?.[1]
		if (key && looks) map[key] = looks.replace(/\.$/, "")
	}
	LOOKS = { fp: cat.fingerprint, map }
	return map
}
// (a pool ball's colour follows its number, as web/models/balls.js draws it: 0 the white cue ball, 8 black, 9-15 striped)
const POOL = ["white", "yellow", "blue", "red", "purple", "orange", "green", "maroon", "black"]
const poolColour = (n) => {
	const k = Math.max(0, Math.min(15, Math.round(Number(n))))
	return k > 8 ? `${POOL[k - 8]}-striped` : POOL[k]
}
const colourOf = (looks, item = null, T = null) => {
	// (an item's own colour first: a ball's `color` prop, a pool ball's number)
	if (typeof item?.props?.color === "string" && item.props.color.trim()) return item.props.color.trim().toLowerCase()
	if (item?.type === "billiard-ball") {
		const n = Number(item.props?.number ?? T?.props?.number?.default)
		if (Number.isFinite(n)) return poolColour(n)
	}
	// (what it looks like by default: "a tapered paper cup (its other materials, aluminium, glass or wood, change its look)" is paper; the
	// colour of its parts is not its colour: "a toy car on black rubber wheels" is not black, nor "yellow-green felt with the white seam" white)
	const t = String(looks ?? "")
		.toLowerCase()
		.replace(/\([^)]*\)/g, " ")
		.replace(/\b(on|with|and|in)\b[^,;:]*?\b(wheels?|legs?|seams?|stitch(es|ed)?|frame|spine|edges?|tyres?|tires?|cords?)\b/g, " ")
	let best = null
	for (const c of COLOURS) {
		const i = t.search(new RegExp(`\\b${c}\\b`))
		if (i >= 0 && (best === null || i < best.i)) best = { c, i }
	}
	// ("a dark red hardcover" is dark red, not dark)
	if (best && (best.c === "dark" || best.c === "light")) {
		const next = new RegExp(`^${best.c}\\s+([a-z-]+)`).exec(t.slice(best.i))?.[1]
		if (next && COLOURS.includes(next) && !["dark", "wooden", "wood", "steel", "glass", "paper", "cardboard", "striped"].includes(next)) return `${best.c} ${next}`
	}
	return best?.c ?? null
}
const an = (w) => (/^[aeiou]/i.test(String(w)) ? "an" : "a")
/** A kind word that is already a plural ("scraps", "clips", "magnets": a type that is a set of things), not "glass", "bus" or "physics". */
const plural = (w) => /[^su]s$/i.test(String(w)) && !/(ics|is)$/i.test(String(w))
/** The word a person would use for its kind ("ball", "ramp", "cup", "dominoes"): its type name's last word, before "on …" or "with …" and
 *  without anything in brackets ("Clip on a thread" is a clip, "Ring magnets on a dowel" magnets, "Electromagnet (nail and battery)" an
 *  electromagnet). */
function kindOf(item, T) {
	if (!T) return item.type
	if (T.category === "Balls") return "ball"
	if (item.type === "domino-row" || item.type === "domino") return item.type === "domino-row" ? "dominoes" : "domino"
	if (T.category === "Surfaces & ramps" && ["plank", "steel-beam", "ice-sheet", "glass-sheet", "rubber-mat", "carpet-strip", "concrete-slab", "cutting-board"].includes(item.type)) return Math.abs(Number(item.angle) || 0) > 3 ? "ramp" : "plank"
	const name = String(T.name ?? item.type).replace(/\s*\(.*\)\s*/g, "").replace(/\s+(?:on|with)\s+(?:a|an|its|the)\s+.*$/i, "").trim().toLowerCase()
	return name.split(/\s+/).at(-1)
}

/**
 * The goals' moving things in a run, measured on its whole track (V8842: answers said "it rises barely 2 cm" and "flicks it up at 0.56 m/s"
 * where the run had the ball rise 27 cm and leave at 1.7 m/s): for each goal's own thing, where its centre starts, when it starts moving and
 * how fast it leaves (its top speed in the 0.3 s after that), and how high its centre rises (and when). -> [{item, goal, container, y0,
 * moved_t, launch, peak_y, peak_t}]. The digest adds each container's rim from the outlines.
 */
export function goalFacts(run, goals) {
	const frames = Array.isArray(run?.track?.frames) ? run.track.frames : []
	if (frames.length < 2) return []
	const keys = Object.keys(frames[0].placements ?? {})
	const out = []
	const seen = new Set()
	for (const g of Array.isArray(goals) ? goals : []) {
		if (!g || typeof g !== "object") continue
		const item = typeof g.item === "string" ? g.item : Array.isArray(g.items) && g.items.length === 1 ? g.items[0] : null
		if (!item || seen.has(item)) continue
		const sid = keys.find((k) => k.split("/")[0] === item)
		if (!sid) continue
		seen.add(item)
		const P = frames.map((f) => ({ t: f.t, p: f.placements?.[sid] })).filter((q) => Number.isFinite(q.p?.x) && Number.isFinite(q.p?.y))
		if (P.length < 2) continue
		const s0 = P[0].p
		// (it starts moving when it first goes faster than 0.25 m/s: never a settle of a few millimetres at the release)
		const v = P.map((q, k) => (k && q.t > P[k - 1].t ? Math.hypot(q.p.x - P[k - 1].p.x, q.p.y - P[k - 1].p.y) / (q.t - P[k - 1].t) : 0))
		const k0 = v.findIndex((x) => x > 0.25)
		let launch = null
		if (k0 > 0) for (let k = k0; k < P.length && P[k].t <= P[k0].t + 0.3; k++) launch = Math.max(launch ?? 0, v[k])
		let peak = P[0]
		for (const q of P) if (q.p.y > peak.p.y) peak = q
		out.push({ item, goal: String(g.label ?? "").slice(0, 160), container: typeof g.container === "string" ? g.container : null, y0: s0.y, moved_t: k0 > 0 ? P[k0].t : null, launch, peak_y: peak.p.y, peak_t: peak.t })
	}
	return out
}

/** Where each dynamic item ended (its first solid's pose in the last frame), how far that solid went (dx, dy), and whether all its solids went
 *  the same way (`together`: a toy car's chassis, cabin and wheels; never a row of dominoes that each tipped on their own). */
function finalPoses(sim) {
	const out = new Map()
	const frames = sim?.track?.frames
	if (!frames?.length) return out
	const last = frames.at(-1).placements ?? {}
	const first = frames[0].placements ?? {}
	const moves = new Map()
	for (const [sid, p] of Object.entries(last)) {
		const id = sid.split("/")[0]
		const p0 = first[sid]
		if (p0) (moves.get(id) ?? moves.set(id, []).get(id)).push({ dx: p.x - p0.x, dy: p.y - p0.y })
		if (out.has(id)) continue
		out.set(id, { x: p.x, y: p.y, moved: p0 ? Math.hypot(p.x - p0.x, p.y - p0.y) : null, dx: p0 ? p.x - p0.x : null, dy: p0 ? p.y - p0.y : null })
	}
	for (const [id, fp] of out) {
		const ms = moves.get(id) ?? []
		const d0 = ms[0]
		fp.together = !!d0 && ms.every((m) => Math.hypot(m.dx - d0.dx, m.dy - d0.dy) <= Math.max(0.03, 0.1 * Math.hypot(d0.dx, d0.dy)))
	}
	return out
}

/**
 * A physics module's lines for an item (web/sim/plugins.js, read from its registry on globalThis): its readings in the run, start → end with
 * their units and when they changed most ("temperature 20.0 → 58.0 °C; melted 0.00 → 1.00 (reaches its end value at 1.30 s)"), and whatever
 * the module adds (its `digest`). [] for an item without readings (every item of a scene without modules).
 */
function moduleLines(r, it, Ty, sim) {
	const out = []
	const state = sim?.track?.state?.[r.id]
	const frames = sim?.track?.frames ?? []
	// (a time-lapse run's frames are run seconds: what a teacher asks about is lesson time, "what does it read at 20 minutes?")
	const lapse = Number.isFinite(sim?.doc?.settings?.timeLapse) && sim.doc.settings.timeLapse > 1 ? sim.doc.settings.timeLapse : 1
	const when = (t) => (lapse > 1 ? `${clock(t * lapse)} of lesson time` : `${Number(t).toFixed(2)} s`)
	if (state && typeof state === "object") {
		const specs = new Map((Ty?.readouts ?? []).map((x) => [x.key, x]))
		const bits = []
		const series = []
		for (const [k, v] of Object.entries(state)) {
			if (!Array.isArray(v) || !v.length) continue
			const sp = specs.get(k)
			const d = Number.isInteger(sp?.digits) ? sp.digits : 2
			// (a state code with its word, "in pieces (2)": the readout's words, never a bare "broken 0 → 2")
			const fmt = (x) => (typeof x === "number" ? (sp?.words?.[String(Math.round(x))] ? `${sp.words[String(Math.round(x))]} (${x.toFixed(d)})` : x.toFixed(d)) : String(x))
			const end = v[v.length - 1]
			const at = v.findIndex((x) => x === end)
			// (when it settles: never for one still changing at the run's end)
			const reach = v[0] !== end && at > 0 && at < v.length - 1 && frames[at] ? ` (reaches its end value at ${when(frames[at].t)})` : ""
			const name = sp?.label ? sp.label.toLowerCase() : k
			bits.push(`${name} ${v[0] === end ? fmt(end) : `${fmt(v[0])} → ${fmt(end)}`}${sp?.unit ? ` ${sp.unit}` : ""}${reach}`)
			// (a measured quantity that changes, through the run: the readings at six times, so "what does it read at 10 minutes?" has its answer
			// (vfy-ai5 T2, 20 Oct: "the run summary I have doesn't include the exact readings"); a state code or a 0/1 flag is said start → end only)
			const n = Math.min(v.length, frames.length)
			if (sp?.unit && !sp.words && n > 2 && series.length < 4 && v.slice(0, n).every((x) => typeof x === "number" && Number.isFinite(x)) && v.slice(0, n).some((x) => x !== v[0]))
				series.push(`${name} (${sp.unit}): ${[...new Set([0, 1, 2, 3, 4, 5].map((j) => Math.round((j * (n - 1)) / 5)))].map((j) => `${fmt(v[j])} at ${lapse > 1 ? clock(frames[j].t * lapse) : `${Number(frames[j].t).toFixed(2)} s`}`).join(", ")}`)
		}
		if (bits.length) out.push(`  readings in the last run: ${bits.join("; ")}`)
		if (series.length) out.push(`  through the run${lapse > 1 ? " (lesson time)" : ""}: ${series.join("; ")}`)
	}
	const S = globalThis[Symbol.for("sandbox.plugins")]
	if (S && S.modules.size) {
		for (const m of [...S.modules.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
			if (typeof m.digest !== "function") continue
			try {
				const lines = m.digest(it ?? r, sim, { type: Ty })
				if (Array.isArray(lines)) for (const l of lines) if (typeof l === "string" && l) out.push(`  ${l}`)
			} catch {} // (a module's digest never stops the step)
		}
	}
	return out
}
/** Lesson time in a teacher's words: "45 s", "12 min", "1 h 5 min". */
function clock(s) {
	const v = Math.max(0, Number(s) || 0)
	if (v < 120) return `${+v.toFixed(v < 10 ? 2 : 1)} s`
	if (v < 3570) {
		const m = Math.floor(v / 60)
		const r = Math.round(v - m * 60)
		return r && m < 20 ? `${m} min ${r} s` : `${Math.round(v / 60)} min`
	}
	const mins = Math.round(v / 60)
	const h = Math.floor(mins / 60)
	return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`
}

/**
 * Each item's physics-module lines (moduleLines) read off a whole run, for a run that is kept without its track: the edit step's run cache
 * (ai/steps.mjs digestPart) keeps only the first and last frames, and every module reads its readings over the whole track (its state series)
 * and the run's document. -> {item id: [line]} (an item without lines is left out). richDigestFrom takes them from `sim.moduleLines`.
 */
export function moduleLinesOf(scene, sim, cat) {
	const out = {}
	const T = cat?.index?.types ?? {}
	for (const it of Array.isArray(scene?.items) ? scene.items : []) {
		if (!it || typeof it !== "object" || typeof it.id !== "string") continue
		const lines = moduleLines({ id: it.id, type: it.type }, it, T[it.type], sim)
		if (lines.length) out[it.id] = lines
	}
	return out
}

export function richDigestFrom(scene, d, { sim = null, plan = null, cat, goalResults = null, facts = null }) {
	const T = cat.index.types
	const looks = looksOf(cat)
	const rows = d.items.filter((r) => r.type !== "table" && !safety(scene.items.find((i) => i.id === r.id)))
	const table = d.table ?? { x0: -0.55, x1: 3.15 }
	const third = (x) => {
		const w = table.x1 - table.x0
		return x < table.x0 + w / 3 ? "left third" : x < table.x0 + (2 * w) / 3 ? "middle third" : "right third"
	}
	const byId = new Map(scene.items.map((i) => [i.id, i]))
	const planOf = new Map((plan?.items ?? []).map((i) => [i.id, i]))
	const resolved = sim?.resolved ?? {}
	const fin = finalPoses(sim)
	const events = Array.isArray(sim?.summary?.events) ? sim.summary.events : []
	const stories = new Map((sim?.summary?.stories ?? []).map((s) => [s.item, s]))
	const nameOf = (id) => (id === "table" ? "the table" : byId.get(id)?.name ? `${id} (“${byId.get(id).name}”)` : id)
	const kinds = new Map()
	const info = []
	for (const r of rows) {
		const it = byId.get(r.id)
		const Ty = T[r.type]
		const kind = kindOf(it, Ty)
		const colour = colourOf(looks[r.type], it, Ty)
		;(kinds.get(kind) ?? kinds.set(kind, []).get(kind)).push(r.id)
		const w = r.box ? r.box.x1 - r.box.x0 : null
		const h = r.box ? r.box.y1 - r.box.y0 : null
		const res = resolved[r.id] ?? {}
		const size = Ty?.category === "Balls" && res.diameter ? `${len(res.diameter)} across` : w !== null ? `${len(w)} wide × ${len(h)} tall` : "?"
		const m = typeof res.mass === "number" ? `, ${mass(res.mass)}` : ""
		const keyProps = Object.entries(r.props).filter(([k]) => !["material", "bounce", "friction", "rolling", "side", "invisible_in_3d"].includes(k))
		// what is right under it (when it is not resting on anything): the nearest top below its bottom, across its width
		// (a bottom within 2 cm of a top, not held up for a release, stands on it: "in the air; -1.2 cm above the table" was a box on a belt)
		// (on a thread from a hook or a stand: a rope from a fixed point to one of its solids, above it (hung) or below it (tied down): never
		// "standing on" whatever is under it: a balloon hung 8 mm over paper scraps (magnetism M3, 20 Oct))
		const rope = (sim?.doc?.joints ?? []).find((j) => j?.kind === "rope" && j.a == null && typeof j.b === "string" && j.b.startsWith(`${r.id}/`))
		const ropeAt = rope ? (sim?.doc?.solids ?? []).find((x) => x.id === rope.b) : null
		const hung = rope && ropeAt ? (rope.anchorA?.y > ropeAt.at?.y ? "hanging on a thread" : "tied down by a thread") : null
		let under = ""
		let standsOn = null
		if (r.box && /^nothing/.test(r.rests_on ?? "")) {
			let best = null
			// (a display-only item, every solid a ghost, holds nothing up, and a ghost part (a balance's pointer) is left out of its box: scene-digest.mjs)
			for (const o of d.items) {
				if (o.id === r.id || !o.box || o.ghost || safety(scene.items.find((i) => i.id === o.id))) continue
				const ob = o.firm_box ?? o.box
				if (ob.x1 < r.box.x0 || ob.x0 > r.box.x1 || ob.y1 > r.box.y0 + 0.02) continue
				if (!best || ob.y1 > (best.firm_box ?? best.box).y1) best = o
			}
			const gap = best ? r.box.y0 - (best.firm_box ?? best.box).y1 : r.box.y0
			if (Math.abs(gap) <= 0.02 && !r.held && !hung) standsOn = best && best.type !== "table" ? best.id : "table"
			else under = `; ${gap < 0 ? `its bottom ${len(-gap)} below the top of` : `${len(gap)} above`} ${!best || best.type === "table" ? "the table" : best.id}`
		}
		const holds = rows.filter((o) => o.rests_on === r.id).map((o) => o.id)
		const how = r.unknown ? "UNKNOWN TYPE" : r.fixed ? "fixed in place" : r.moves ? (r.held ? `dynamic, held (on a pull pin) until the release at ${scene.release ?? 0.5} s` : "dynamic (free to move)") : "static (never moves)"
		// its part in the last run
		const mine = events.filter((e) => e.a === r.id || e.b === r.id)
		const st = stories.get(r.id)
		const fp = fin.get(r.id)
		const run = []
		if (st?.moved_at != null) run.push(`starts moving at ${Number(st.moved_at).toFixed(2)} s`)
		if (mine.length) run.push(mine.slice(0, 6).map((e) => `${e.a === r.id ? `hits ${nameOf(e.b)}` : `is hit by ${nameOf(e.a)}`} at ${e.t.toFixed(2)} s${e.speed != null ? ` (${e.speed.toFixed(2)} m/s)` : ""}`).join(", "))
		if (st?.text) run.push(st.text)
		// (and how far it went: "which car went farther?" (vfy-ai5 R-L1, A-K2, 20 Oct: a toy car of four solids had no end at all, so the answer
		// had "I don't have the empty car's stopping point"); a thing of several solids that all went together is said by its first one)
		if (fp && r.moves && fp.moved > 0.01 && (!(r.parts?.length > 1) || fp.together)) {
			const went = [Math.abs(fp.dx) >= 0.005 ? `${len(Math.abs(fp.dx))} ${fp.dx > 0 ? "right" : "left"}` : null, Math.abs(fp.dy) >= 0.005 ? `${len(Math.abs(fp.dy))} ${fp.dy > 0 ? "up" : "down"}` : null].filter(Boolean)
			run.push(`ends at x ${f2(fp.x)}, y ${f2(fp.y)}${went.length ? ` (it went ${went.join(" and ")} from its start)` : ""}`)
		}
		if (r.moves && (!st || st.moved_at == null) && !mine.length && !/\b(doesn['’]t|does not|never) move/i.test(st?.text ?? "")) run.push("does not move")
		const pi = planOf.get(r.id)
		// (a run kept without its track carries its module lines as read off the whole run: ai/steps.mjs digestPart)
		const kept = sim?.moduleLines && typeof sim.moduleLines === "object" ? sim.moduleLines : null
		const extra = kept ? (Array.isArray(kept[r.id]) ? kept[r.id] : []) : moduleLines(r, it, Ty, sim)
		info.push({ r, it, kind, colour, lines: [
			`- ${r.id} · “${r.name}” · ${plural(kind) ? "a set of" : an(colour ?? kind)} ${colour ? `${colour} ` : ""}${kind}: ${r.type} (${Ty?.name ?? "?"}; looks: ${looks[r.type] ?? "—"}) · ${size}${m}`,
			`  where: ${third((r.box?.x0 + r.box?.x1) / 2)} of the table, ${hung ? (/^nothing/.test(r.rests_on ?? "") || !r.rests_on ? hung : `${hung} just over ${nameOf(r.rests_on)}`) : r.rests_on === "table" || standsOn === "table" ? "standing on the table" : standsOn ? `standing on ${nameOf(standsOn)}` : /^nothing/.test(r.rests_on ?? "") ? `in the air` : `resting on ${nameOf(r.rests_on)}`}${under}; ${how}${holds.length ? `; holds up ${holds.map(nameOf).join(", ")}` : ""}`,
			`  in the last run: ${run.length ? run.join("; ") : "—"}`,
			`  exact: anchor (${f3(r.x)}, ${f3(r.y)}), angle ${fa(r.angle)}°, outline x ${f3(r.box?.x0)}…${f3(r.box?.x1)}, y ${f3(r.box?.y0)}…${f3(r.box?.y1)}; props ${keyProps.length ? keyProps.map(([k, v]) => `${k} ${typeof v === "string" ? JSON.stringify(v) : v}`).join(", ") : "defaults"}${pi?.why ? `; the plan's reason for it: ${String(pi.why).slice(0, 160)}` : ""}`,
			...extra
		] })
	}
	const lines = []
	lines.push(`Stage x ${f3(d.stage.x0)}…${f3(d.stage.x1)}; the table top is y = 0 from x ${f3(table.x0)} to ${f3(table.x1)} (left third ends at x ${f2(table.x0 + (table.x1 - table.x0) / 3)}, right third starts at x ${f2(table.x0 + (2 * (table.x1 - table.x0)) / 3)}). The scene runs ${scene.seconds ?? 4.5} s; held things are let go at ${scene.release ?? 0.5} s. Two see-through safety walls at the table's ends are not listed.`)
	const st = scene.settings
	if (st && typeof st === "object" && Object.keys(st).length) lines.push(`Settings: ${Object.entries(st).map(([k, v]) => `${k} ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ")} (gravity, air, room temperature °C, time-lapse ×; the rest standard).`)
	lines.push(`## The items (${info.length})`)
	for (const x of info) lines.push(...x.lines)
	// look-alikes: the words a request may use for more than one item
	const groups = [...kinds.entries()].filter(([, ids]) => ids.length > 1)
	if (groups.length) {
		lines.push("## Look-alikes (a request that names only the kind does not say which one)")
		for (const [kind, ids] of groups) {
			const desc = ids.map((id) => {
				const x = info.find((q) => q.r.id === id)
				const where = third((x.r.box?.x0 + x.r.box?.x1) / 2)
				return `${id} (${x.colour ? `${x.colour}, ` : ""}${x.r.type}, ${where}${x.r.held ? ", held" : ""}${x.r.rests_on && !/^nothing/.test(x.r.rests_on) ? `, on ${x.r.rests_on}` : ""})`
			})
			lines.push(`- ${ids.length} ${kind === "dominoes" ? "domino rows" : plural(kind) ? `sets of ${kind}` : `${kind}${/s$/.test(kind) ? "es" : "s"}`}: ${desc.join("; ")}`)
		}
	}
	// the last run
	const goals = Array.isArray(sim?.summary?.goals) ? sim.summary.goals : []
	const planGoals = (plan?.goals ?? []).filter((g) => g && (g.kind ?? "in") !== "in")
	lines.push("## The last run (before this request)")
	// (the other kinds' results, when checked on this run: [{label, ok, detail?}] in the order of planGoals; else "label [kind]" as measured)
	const other = (g, i) => {
		const r = Array.isArray(goalResults) ? goalResults[i] : null
		return r && typeof r.ok === "boolean" ? `${r.ok ? "MET" : "FAILED"}: ${g.label}${!r.ok && r.detail ? ` (${String(r.detail).slice(0, 160)})` : ""}` : `${g.label} [${g.kind}]`
	}
	if (goals.length || planGoals.length) lines.push(`Goals: ${[...goals.map((g) => `${g.ok ? "MET" : "FAILED"}: ${g.label}`), ...planGoals.map(other)].join("; ")}`)
	if (events.length) lines.push(`What happened, in order: ${events.slice(0, 24).map((e) => `${e.t.toFixed(2)} s ${e.text}${e.speed != null ? ` (${e.speed.toFixed(2)} m/s)` : ""}`).join("; ")}`)
	const happen = Array.isArray(sim?.summary?.happenings) ? sim.summary.happenings : []
	if (happen.length) lines.push(`What else happened (the physics modules): ${happen.slice(0, 16).map((e) => `${Number(e.t).toFixed(2)} s ${e.text}`).join("; ")}`)
	// (the goals' own things, measured on the whole track: the only heights and speeds an answer quotes about them)
	if (Array.isArray(facts) && facts.length) {
		lines.push("## The goals' moving things in the last run (measured; quote heights and speeds of these things only from here)")
		for (const f of facts.slice(0, 6)) {
			const c = f.container ? d.items.find((r) => r.id === f.container) : null
			const bits = [`its centre starts at y ${f2(f.y0)} m`]
			if (f.moved_t != null) bits.push(`starts moving at ${f.moved_t.toFixed(2)} s${f.launch != null ? ` and leaves at ${f.launch.toFixed(2)} m/s (its own top speed in the next 0.3 s)` : ""}`)
			else bits.push("never moves")
			bits.push(`its centre rises highest to y ${f2(f.peak_y)} m${f.peak_y > f.y0 + 0.005 ? ` at ${f.peak_t.toFixed(2)} s` : " (it never rises)"}`)
			if (c?.box) bits.push(`${nameOf(c.id)}'s rim (the top of its walls) is at y ${f2(c.box.y1)} m, its opening x ${f2(c.box.x0)}…${f2(c.box.x1)}`)
			lines.push(`- ${nameOf(f.item)}${f.goal ? ` (goal: ${f.goal})` : ""}: ${bits.join("; ")}`)
		}
	}
	else if (sim) lines.push("Nothing hit anything.")
	else lines.push("(not run yet)")
	if (plan?.stages?.length) lines.push(`The plan's stages: ${plan.stages.map((s, i) => `${i + 1}. ${s.label}${s.items?.length ? ` (${s.items.join(", ")})` : ""}`).join("; ")}`)
	if (plan?.notes) lines.push(`The plan's notes: ${String(plan.notes).slice(0, 600)}`)
	if (d.warnings?.length) lines.push(`Overlaps at the start: ${d.warnings.map((w) => w.text).join("; ")}`)
	const text = lines.join("\n")
	return { text, groups: Object.fromEntries(groups), rows: info.map((x) => ({ id: x.r.id, kind: x.kind, colour: x.colour, rests_on: x.r.rests_on, box: x.r.box, type: x.r.type, held: x.r.held, moves: x.r.moves })), digest: d, hash: createHash("sha1").update(text).digest("hex").slice(0, 10) }
}
