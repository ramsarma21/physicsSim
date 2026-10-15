// The edit step's scene digest (drop into ai/ next to scene-digest.mjs; measured in ai/experiments/edit): everything a user might call an
// item by (its colour and look from the catalog's "Looks:" line, its kind, its size, where it is in words: left / middle / right third,
// what it rests on, how high above what it hovers), what it holds up, its part in the LAST RUN (when it starts moving, what it hits and is hit
// by, with times and speeds, its story, where it ends), the groups of look-alikes that make "the ball" ambiguous, and the run's goals and
// order of events. Exact numbers stay for the patches.
//   import { sceneDigest } from "./scene-digest.mjs"
//   const d = await sceneDigest(scene, cat.index)
//   const sim = await runScene(scene)                      // steps.mjs: the same run as /api/simulate (~0.2-0.4 s); + layout(scene).resolved
//   const r = richDigestFrom(scene, d, { sim: { ...sim, resolved }, plan, cat })   // {text, groups, rows, hash}
// The edit step uses r.text where it used d.text (steps.mjs edit(): "# The current scene").
import { createHash } from "node:crypto"

const f2 = (v) => (Number.isFinite(v) ? (Math.abs(v) < 5e-3 ? "0" : v.toFixed(2).replace(/\.?0+$/, "")) : "?")
const f3 = (v) => (Number.isFinite(v) ? (Math.abs(v) < 5e-4 ? "0" : v.toFixed(3).replace(/\.?0+$/, "")) : "?")
const fa = (v) => (Number.isFinite(v) ? (Math.abs(v) < 0.05 ? "0" : v.toFixed(1).replace(/\.0$/, "")) : "0")
const len = (m) => (m >= 1 ? `${+m.toFixed(2)} m` : `${+(m * 100).toFixed(1)} cm`)
const mass = (kg) => (kg >= 1 ? `${+kg.toPrecision(3)} kg` : kg >= 0.001 ? `${+(kg * 1000).toPrecision(3)} g` : `${+(kg * 1e6).toPrecision(3)} mg`)
const safety = (i) => i?.type === "wall" && i.props?.invisible_in_3d === true
const COLOURS = ["yellow-green", "off-white", "red-brown", "red", "yellow", "green", "blue", "white", "black", "orange", "brown", "grey", "gray", "silver", "pink", "purple", "clear", "cream", "tan", "beige", "dark", "striped", "wooden", "wood", "steel", "glass"]

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
const colourOf = (looks) => {
	const t = String(looks ?? "").toLowerCase()
	let best = null
	for (const c of COLOURS) {
		const i = t.search(new RegExp(`\\b${c}\\b`))
		if (i >= 0 && (best === null || i < best.i)) best = { c, i }
	}
	return best?.c ?? null
}
/** The word a person would use for its kind ("ball", "ramp", "cup", "dominoes"). */
function kindOf(item, T) {
	if (!T) return item.type
	if (T.category === "Balls") return "ball"
	if (item.type === "domino-row" || item.type === "domino") return item.type === "domino-row" ? "dominoes" : "domino"
	if (T.category === "Surfaces & ramps" && ["plank", "steel-beam", "ice-sheet", "glass-sheet", "rubber-mat", "carpet-strip", "concrete-slab", "cutting-board"].includes(item.type)) return Math.abs(Number(item.angle) || 0) > 3 ? "ramp" : "plank"
	const name = String(T.name ?? item.type).replace(/\s*\(.*\)\s*/g, "").trim().toLowerCase()
	return name.split(/\s+/).at(-1)
}

/** Where each dynamic item ended (its first solid's pose in the last frame). */
function finalPoses(sim) {
	const out = new Map()
	const frames = sim?.track?.frames
	if (!frames?.length) return out
	const last = frames.at(-1).placements ?? {}
	const first = frames[0].placements ?? {}
	for (const [sid, p] of Object.entries(last)) {
		const id = sid.split("/")[0]
		if (out.has(id)) continue
		const p0 = first[sid]
		out.set(id, { x: p.x, y: p.y, moved: p0 ? Math.hypot(p.x - p0.x, p.y - p0.y) : null })
	}
	return out
}

export function richDigestFrom(scene, d, { sim = null, plan = null, cat }) {
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
		const colour = colourOf(looks[r.type])
		;(kinds.get(kind) ?? kinds.set(kind, []).get(kind)).push(r.id)
		const w = r.box ? r.box.x1 - r.box.x0 : null
		const h = r.box ? r.box.y1 - r.box.y0 : null
		const res = resolved[r.id] ?? {}
		const size = Ty?.category === "Balls" && res.diameter ? `${len(res.diameter)} across` : w !== null ? `${len(w)} wide × ${len(h)} tall` : "?"
		const m = typeof res.mass === "number" ? `, ${mass(res.mass)}` : ""
		const keyProps = Object.entries(r.props).filter(([k]) => !["material", "bounce", "friction", "rolling", "side", "invisible_in_3d"].includes(k))
		// what is right under it (when it is not resting on anything): the nearest top below its bottom, across its width
		let under = ""
		if (r.box && /^nothing/.test(r.rests_on ?? "")) {
			let best = null
			for (const o of d.items) {
				if (o.id === r.id || !o.box) continue
				if (o.box.x1 < r.box.x0 || o.box.x0 > r.box.x1 || o.box.y1 > r.box.y0 + 1e-4) continue
				if (!best || o.box.y1 > best.box.y1) best = o
			}
			under = best ? `; ${len(r.box.y0 - best.box.y1)} above ${best.type === "table" ? "the table" : best.id}` : `; ${len(r.box.y0)} above the table`
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
		if (fp && r.moves && fp.moved > 0.01 && !(r.parts?.length > 1)) run.push(`ends at x ${f2(fp.x)}, y ${f2(fp.y)}`)
		if (r.moves && (!st || st.moved_at == null) && !mine.length) run.push("does not move")
		const pi = planOf.get(r.id)
		info.push({ r, it, kind, colour, lines: [
			`- ${r.id} · “${r.name}” · a ${colour ? `${colour} ` : ""}${kind}: ${r.type} (${Ty?.name ?? "?"}; looks: ${looks[r.type] ?? "—"}) · ${size}${m}`,
			`  where: ${third((r.box?.x0 + r.box?.x1) / 2)} of the table, ${r.rests_on === "table" ? "standing on the table" : /^nothing/.test(r.rests_on ?? "") ? `in the air` : `resting on ${nameOf(r.rests_on)}`}${under}; ${how}${holds.length ? `; holds up ${holds.map(nameOf).join(", ")}` : ""}`,
			`  in the last run: ${run.length ? run.join("; ") : "—"}`,
			`  exact: anchor (${f3(r.x)}, ${f3(r.y)}), angle ${fa(r.angle)}°, outline x ${f3(r.box?.x0)}…${f3(r.box?.x1)}, y ${f3(r.box?.y0)}…${f3(r.box?.y1)}; props ${keyProps.length ? keyProps.map(([k, v]) => `${k} ${typeof v === "string" ? JSON.stringify(v) : v}`).join(", ") : "defaults"}${pi?.why ? `; the plan's reason for it: ${String(pi.why).slice(0, 160)}` : ""}`
		] })
	}
	const lines = []
	lines.push(`Stage x ${f3(d.stage.x0)}…${f3(d.stage.x1)}; the table top is y = 0 from x ${f3(table.x0)} to ${f3(table.x1)} (left third ends at x ${f2(table.x0 + (table.x1 - table.x0) / 3)}, right third starts at x ${f2(table.x0 + (2 * (table.x1 - table.x0)) / 3)}). The scene runs ${scene.seconds ?? 4.5} s; held things are let go at ${scene.release ?? 0.5} s. Two see-through safety walls at the table's ends are not listed.`)
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
			lines.push(`- ${ids.length} ${kind === "dominoes" ? "domino rows" : `${kind}${/s$/.test(kind) ? "es" : "s"}`}: ${desc.join("; ")}`)
		}
	}
	// the last run
	const goals = Array.isArray(sim?.summary?.goals) ? sim.summary.goals : []
	const planGoals = (plan?.goals ?? []).filter((g) => g && (g.kind ?? "in") !== "in")
	lines.push("## The last run (before this request)")
	if (goals.length || planGoals.length) lines.push(`Goals: ${[...goals.map((g) => `${g.ok ? "MET" : "FAILED"}: ${g.label}`), ...planGoals.map((g) => `${g.label} [${g.kind}]`)].join("; ")}`)
	if (events.length) lines.push(`What happened, in order: ${events.slice(0, 24).map((e) => `${e.t.toFixed(2)} s ${e.text}${e.speed != null ? ` (${e.speed.toFixed(2)} m/s)` : ""}`).join("; ")}`)
	else if (sim) lines.push("Nothing hit anything.")
	else lines.push("(not run yet)")
	if (plan?.stages?.length) lines.push(`The plan's stages: ${plan.stages.map((s, i) => `${i + 1}. ${s.label}${s.items?.length ? ` (${s.items.join(", ")})` : ""}`).join("; ")}`)
	if (plan?.notes) lines.push(`The plan's notes: ${String(plan.notes).slice(0, 600)}`)
	if (d.warnings?.length) lines.push(`Overlaps at the start: ${d.warnings.map((w) => w.text).join("; ")}`)
	const text = lines.join("\n")
	return { text, groups: Object.fromEntries(groups), rows: info.map((x) => ({ id: x.r.id, kind: x.kind, colour: x.colour, rests_on: x.r.rests_on, box: x.r.box, type: x.r.type, held: x.r.held, moves: x.r.moves })), digest: d, hash: createHash("sha1").update(text).digest("hex").slice(0, 10) }
}
