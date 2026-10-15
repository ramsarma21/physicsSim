// The AI scene builder's pipeline (ai/DESIGN.md "Steps"): observe (images) → plan (or edit) → solve → simulate → render → refine (≤ 3) → tune →
// final check (when the version to apply changed after the critic last saw it) → apply.
// An edit is different (2026-10-15, the user: "the edit isn't automatically supposed to have it work - that's not how physics works"): the
// change asked for, solved and run ONCE, and applied as it is, with no critic and no tuner. When that stops a goal (or a row that all fell
// before), the reply says what happens instead, and ai.findFix(report.fixCtx) (./fixer.js) looks for the smallest change, checked in the real
// engine, that makes every goal happen again; the panel offers it ("Want me to lower the box 4 cm? (checked: … ✓)"). A request that states the
// outcome itself ("…so it still lands in it", "make it work") gets that search as part of the edit, and the fix goes on the table with it.
//   import { createOrchestrator, prepareImages } from "./ai/orchestrator.js"
//   const ai = createOrchestrator({ api, shot })                // api = the app's api(path, body, signal) (both backends); shot = createShot(...) or null
//   const job = ai.build({ text, images, mode: "new" | "edit" | "check", scene, plan }, { onEvent })
//   job.cancel()                                                // aborts every request and engine run of this build
//   const report = await job.result                            // {title, scene, plan, sim, missing, assumptions, goals, refine, tune, timings, ...}
// Every model call goes to POST /api/ai/<step> {payload, client: {requestId}} -> {ok, result, model, ms, usage} (same URL on the local server and on
// Vercel). Nothing here holds a key: the server runs the fixed prompt for each step. Runs go through the app's normal /api/simulate.
import { solve, planFromScene, inspect, typeName, propKeys, propSpec, isStaticItem, holdsItselfUp, itemGeometry, shapesAt } from "./solver.js"
import { checkGoals, goalItems, goalRefs } from "./goals.js"
import { findFix as searchFix, fixTargets, judge as judgeTargets, outcomeWords, FIX_MS, riderMap, groupNames } from "./fixer.js"
import { build as buildDoc, catalog as simCatalog, MATERIALS } from "../sim/index.js"

export const MAX_IMAGES = 4
export const IMAGE_MAX_PX = 1536
export const IMAGE_QUALITY = 0.85
const MAX_BODY = 12 << 20
export const REFINE_ROUNDS = 3
export const TUNE_RUNS = 40
export const TUNE_MS = 20000
const TUNE_PARALLEL = 3
/** Client-side ceiling per model step: above the server's own budgets (ai/models.json budgetMs + its 15 s margin), so this only stops a hung request. */
const STEP_TIMEOUT = { observe: 340000, plan: 460000, edit: 280000, refine: 340000 }
const RETRY_DELAY = 1500

export const STEP_LABELS = {
	observe: "Looking at your images",
	plan: "Planning the scene",
	edit: "Working out the change",
	solve: "Placing everything",
	simulate: "Running the physics",
	render: "Taking a picture",
	refine: "Checking and refining",
	tune: "Tuning to hit the goals",
	fix: "Finding a fix",
	reconcile: "Matching your picture",
	apply: "Putting it on the table"
}

export class AiError extends Error {
	/** kind: "gateway" | "busy" | "timeout" | "invalid" | "nothing" | "engine" | "cancelled" | "input" */
	constructor(kind, message, { retryable = false, step = null, cause = null } = {}) {
		super(message)
		this.name = "AiError"
		this.kind = kind
		this.retryable = retryable
		this.step = step
		if (cause) this.cause = cause
	}
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null)
const rid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
const abortError = () => (typeof DOMException !== "undefined" ? new DOMException("Cancelled", "AbortError") : Object.assign(new Error("Cancelled"), { name: "AbortError" }))
const sleep = (ms, signal) =>
	new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(abortError())
		const t = setTimeout(resolve, ms)
		signal?.addEventListener("abort", () => (clearTimeout(t), reject(abortError())), { once: true })
	})
const fmtM = (v) => (Math.abs(v) >= 1 ? `${v.toFixed(2)} m` : `${(v * 100).toFixed(1)} cm`)

// ================================================================ images: ≤ 1536 px JPEG q≈0.85, the right way up
/**
 * Files / Blobs / data URLs -> [{name, mime: "image/jpeg", width, height, dataUrl, bytes, thumb}] (at most MAX_IMAGES; the first ones win).
 * EXIF orientation is applied (createImageBitmap's imageOrientation: "from-image", else an <img>, which browsers draw upright), transparency
 * goes on white, and the longest side is scaled down to IMAGE_MAX_PX.
 */
export async function prepareImages(inputs, { maxPx = IMAGE_MAX_PX, quality = IMAGE_QUALITY } = {}) {
	const out = []
	for (const input of [...inputs].slice(0, MAX_IMAGES)) out.push(await prepareImage(input, { maxPx, quality }))
	return out
}
export async function prepareImage(input, { maxPx = IMAGE_MAX_PX, quality = IMAGE_QUALITY } = {}) {
	let blob = input
	let name = input?.name ?? "image"
	if (typeof input === "string") {
		blob = await (await fetch(input)).blob()
		name = "image"
	}
	if (!(blob instanceof Blob)) throw new AiError("input", "That isn't an image")
	if (blob.type && !/^image\//.test(blob.type)) throw new AiError("input", `${name} isn't an image`)
	if (blob.size > 40 << 20) throw new AiError("input", `${name} is too large (over 40 MB)`)
	let src
	let w
	let h
	try {
		src = await createImageBitmap(blob, { imageOrientation: "from-image" })
		w = src.width
		h = src.height
	} catch {
		const url = URL.createObjectURL(blob)
		try {
			src = await new Promise((resolve, reject) => {
				const img = new Image()
				img.onload = () => resolve(img)
				img.onerror = () => reject(new AiError("input", `${name} couldn't be read as an image`))
				img.src = url
			})
			w = src.naturalWidth
			h = src.naturalHeight
		} finally {
			setTimeout(() => URL.revokeObjectURL(url), 1000)
		}
	}
	if (!(w > 0 && h > 0)) throw new AiError("input", `${name} has no pixels`)
	const k = Math.min(1, maxPx / Math.max(w, h))
	const W = Math.max(1, Math.round(w * k))
	const H = Math.max(1, Math.round(h * k))
	const draw = (cw, ch) => {
		const c = document.createElement("canvas")
		c.width = cw
		c.height = ch
		const g = c.getContext("2d")
		g.fillStyle = "#fff"
		g.fillRect(0, 0, cw, ch)
		g.imageSmoothingEnabled = true
		g.imageSmoothingQuality = "high"
		g.drawImage(src, 0, 0, cw, ch)
		return c
	}
	const big = draw(W, H)
	const dataUrl = big.toDataURL("image/jpeg", quality)
	const tk = Math.min(1, 160 / Math.max(W, H))
	const thumb = draw(Math.max(1, Math.round(W * tk)), Math.max(1, Math.round(H * tk))).toDataURL("image/jpeg", 0.8)
	src.close?.()
	return { name, mime: "image/jpeg", width: W, height: H, dataUrl, bytes: Math.round(((dataUrl.length - 23) * 3) / 4), thumb }
}
/** What the server gets for an image (ai/steps.mjs): {data: "data:image/jpeg;base64,...", name, label} (no thumbnails, no object URLs). */
const wireImage = (im, label) => ({ data: String(im.dataUrl), name: im.name ?? "image", label: label ?? im.label ?? im.name ?? "" })

// ================================================================ the scene in words for the model (positions, sizes, supports, what happened)
/** A compact digest of a solved scene (and its run): every item's pose and box, what it rests on, its own props; the run's goals and events. */
export function digestScene(scene, sim = null) {
	let ins = null
	try {
		ins = inspect(scene)
	} catch {}
	const r4 = (v) => Math.round(v * 1e4) / 1e4
	const items = scene.items.map((it) => {
		const d = { id: it.id, type: it.type, name: it.name ?? typeName(it.type), x: r4(it.x), y: r4(it.y), angle: Math.round((it.angle ?? 0) * 100) / 100 }
		if (it.props && Object.keys(it.props).length) d.props = it.props
		if (it.held) d.held = true
		if (it.fixed) d.fixed = true
		const b = ins?.box(it.id)
		if (b) d.box = { x0: r4(b.x0), x1: r4(b.x1), y0: r4(b.y0), y1: r4(b.y1) }
		return d
	})
	if (ins) {
		// what each rests on: the highest thing within 4 mm under it
		for (const d of items) {
			if (d.type === "table") continue
			let best = null
			for (const o of items) {
				if (o === d) continue
				const g = ins.gap(d.id, o.id)
				if (g !== null && g > -0.002 && g < 0.004 && (!best || o.box.y1 > best.box.y1)) best = o
			}
			d.rests_on = best ? best.id : d.held ? "held in the air" : "nothing (in the air)"
		}
	}
	const out = { title: scene.name, seconds: scene.seconds, release: scene.release, table_top: scene.items.find((i) => i.type === "table")?.y ?? 0, stage: scene.stage, items, goals: scene.goals ?? [] }
	if (sim) out.run = summarizeRun(sim)
	return out
}
/** The run in brief: goals, the first events, each mover's story, start-up warnings. */
export function summarizeRun(sim) {
	const s = sim.summary ?? {}
	return {
		goals: (s.goals ?? []).map((g) => ({ label: g.label, ok: g.ok, item: g.item, container: g.container })),
		events: (s.events ?? []).slice(0, 16).map((e) => ({ t: e.t, text: e.text, speed: Math.round((e.speed ?? 0) * 100) / 100 })),
		stories: (s.stories ?? []).map((st) => ({ item: st.item, text: st.text, moved_at: st.moved_at })),
		warnings: (sim.warnings ?? []).map((w) => w.text ?? String(w))
	}
}

// ================================================================ patches (refine and edit): change the plan, never the coordinates
/**
 * Apply refine/edit patches to a plan. -> {plan, changes: [words], skipped: [words]}
 * ops: move {id, dx?, dy?, x?, y_m?} · set_props {id, props} · add {item} · remove {id} · replace_type {id, type, props?} · set_place {id, place}
 *      (also tolerated: set_scene {title?, seconds?, release?}, set_goals {goals}, set_held {id, held}, set_fixed {id, fixed})
 * `scene` (the solved scene the patches were written against) gives a relative move its starting point.
 */
export function applyPatches(planIn, patches, scene = null) {
	const plan = clone(planIn)
	plan.items = Array.isArray(plan.items) ? plan.items : []
	const changes = []
	const skipped = []
	const find = (id) => plan.items.find((i) => i.id === id)
	const nameOf = (it) => it?.name ?? typeName(it?.type) ?? it?.id
	const solvedOf = (id) => scene?.items?.find((i) => i.id === id)
	const tableTop = Number(scene?.items?.find((i) => i.type === "table")?.y) || 0
	for (const p of Array.isArray(patches) ? patches : []) {
		if (!isObj(p)) continue
		const op = String(p.op ?? "").toLowerCase()
		const it = p.id !== undefined ? find(p.id) : null
		const need = () => {
			if (!it) skipped.push(`“${p.id ?? "?"}” isn't in the scene (it was to be ${{ move: "moved", set_props: "changed", remove: "removed", replace_type: "swapped", set_place: "placed", set_item: "changed", set_held: "changed", set_fixed: "changed" }[op] ?? "changed"})`)
			return !!it
		}
		if (op === "move") {
			if (!need()) continue
			it.place = isObj(it.place) ? it.place : {}
			const pl = it.place
			const dx = num(p.dx)
			const dy = num(p.dy)
			if (num(p.x) !== null || dx !== null) {
				if ((pl.left_of || pl.right_of) && dx !== null && num(p.x) === null) {
					const side = pl.left_of ? "left_of" : "right_of"
					pl[side] = isObj(pl[side]) ? pl[side] : { id: pl[side] }
					const g = Math.max(0, (num(pl[side].gap_m) ?? 0.02) + (side === "left_of" ? -dx : dx))
					pl[side].gap_m = Math.round(g * 1e4) / 1e4
					delete pl.align
					changes.push(`${nameOf(it)}: gap to ${pl[side].id} now ${fmtM(g)}`)
				} else if (pl.lean && dx !== null) {
					for (const e of [pl.lean.from, pl.lean.to]) if (isObj(e) && num(e.x) !== null) e.x = Math.round((e.x + dx) * 1e4) / 1e4
					changes.push(`${nameOf(it)} moved ${fmtM(Math.abs(dx))} ${dx > 0 ? "right" : "left"}`)
				} else {
					const from = num(pl.x) ?? solvedOf(it.id)?.x ?? 0
					const to = num(p.x) ?? from + dx
					pl.x = Math.round(to * 1e4) / 1e4
					delete pl.left_of
					delete pl.right_of
					changes.push(`${nameOf(it)} moved ${fmtM(Math.abs(to - from))} ${to > from ? "right" : "left"}`)
				}
			}
			if (num(p.angle_deg) !== null && !pl.lean) {
				const was = num(pl.angle_deg) ?? solvedOf(it.id)?.angle ?? 0
				pl.angle_deg = num(p.angle_deg)
				changes.push(`${nameOf(it)}: angle ${Math.round(was * 10) / 10}° → ${Math.round(pl.angle_deg * 10) / 10}°`)
			}
			if (num(p.y_m) !== null || dy !== null) {
				const solvedY = solvedOf(it.id)?.y
				const cur = num(pl.y_m) ?? (solvedY !== undefined ? solvedY - tableTop : 0)
				const to = num(p.y_m) ?? cur + dy
				if (pl.on === "air" || !pl.on || num(p.y_m) !== null) {
					pl.on = "air"
					pl.y_m = Math.round(to * 1e4) / 1e4
					changes.push(`${nameOf(it)} ${to > cur ? "raised" : "lowered"} ${fmtM(Math.abs(to - cur))}`)
				} else skipped.push(`${nameOf(it)} rests on ${pl.on}: its height follows that`)
			}
		} else if (op === "set_props" || op === "props") {
			if (!need()) continue
			const props = isObj(p.props) ? p.props : isObj(p.set) ? p.set : {}
			it.props = { ...(isObj(it.props) ? it.props : {}), ...props }
			for (const [k, v] of Object.entries(props)) if (v === null) delete it.props[k]
			changes.push(`${nameOf(it)}: ${Object.entries(props).map(([k, v]) => `${k} ${v === null ? "back to default" : `→ ${typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v}`}`).join(", ")}`)
		} else if (op === "add") {
			const item = isObj(p.item) ? p.item : p
			if (!item.type) {
				skipped.push("add: no type")
				continue
			}
			const add = { id: item.id ?? `${item.type}-${plan.items.length + 1}`, type: item.type, name: item.name, props: item.props ?? {}, place: item.place ?? { on: "table" } }
			if (item.held) add.held = true
			if (item.fixed) add.fixed = true
			if (item.why) add.why = item.why
			plan.items.push(add)
			changes.push(`Added ${nameOf(add)}`)
		} else if (op === "remove" || op === "delete") {
			if (!need()) continue
			plan.items = plan.items.filter((i) => i !== it)
			// what rested on it now rests on what it rested on
			const below = it.place?.on && it.place.on !== "air" ? it.place.on : "table"
			for (const o of plan.items) {
				const pl = o.place
				if (!isObj(pl)) continue
				if (pl.on === it.id) pl.on = below
				if (pl.inside === it.id) (delete pl.inside, (pl.on = below))
				for (const side of ["left_of", "right_of"]) if (pl[side] && (pl[side] === it.id || pl[side].id === it.id)) delete pl[side]
				if (pl.lean) for (const e of ["from", "to"]) if (pl.lean[e]?.on === it.id) pl.lean[e].on = below
			}
			if (Array.isArray(plan.goals)) plan.goals = plan.goals.filter((g) => g.item !== it.id && g.container !== it.id)
			if (Array.isArray(plan.tune)) plan.tune = plan.tune.filter((k) => k.id !== it.id)
			changes.push(`Removed ${nameOf(it)}`)
		} else if (op === "replace_type") {
			if (!need() || !p.type) continue
			const was = nameOf(it)
			const wasType = typeName(it.type)
			const keys = propKeys(p.type)
			const kept = Object.fromEntries(Object.entries(isObj(it.props) ? it.props : {}).filter(([k]) => keys?.has(k)))
			const before = { type: it.type, props: isObj(it.props) ? it.props : {}, fixed: it.fixed === true }
			it.type = p.type
			it.props = { ...kept, ...(isObj(p.props) ? p.props : {}) }
			// a thing held at its exact height in the air (a ball waiting at the top of a ramp) keeps its LOWEST point where it was: a bigger
			// one sits higher (not sunk into what is under it), a smaller one lower; it keeps its place and its role
			const pl = isObj(it.place) ? it.place : null
			if (pl && pl.on === "air" && num(pl.y_m) !== null && num(pl.bottom_m) === null) {
				try {
					const ang = num(pl.angle_deg) ?? 0
					const low = (g) => Math.min(...shapesAt(g, 0, 0, ang).map((q) => q.y0))
					const dy = low(itemGeometry(before.type, before.props, before.fixed)) - low(itemGeometry(it.type, it.props, it.fixed === true))
					if (Math.abs(dy) > 1e-6) {
						pl.y_m = Math.round((pl.y_m + dy) * 1e6) / 1e6
						changes.push(`${typeName(p.type)} put ${fmtM(Math.abs(dy))} ${dy > 0 ? "higher" : "lower"} than ${was} was, so its bottom stays where ${was}'s was`)
					}
				} catch {}
			}
			if (p.name) it.name = p.name
			else delete it.name
			// a goal about it that named what it was ("the bowling ball hits the head pin") names what it is now ("the tennis ball hits…")
			const now = String(p.name ?? typeName(p.type) ?? "")
			const olds = [...new Set([was, wasType].filter((w) => typeof w === "string" && w.trim() && w !== now))].sort((x, y) => y.length - x.length)
			if (now && olds.length && Array.isArray(plan.goals))
				for (const g of plan.goals)
					if (isObj(g) && typeof g.label === "string" && goalRefs(g).includes(it.id))
						for (const o of olds) g.label = g.label.replace(new RegExp(`\\b${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), (m) => (m[0] === m[0].toUpperCase() ? now : now.toLowerCase()))
			changes.push(`${was} → ${typeName(p.type)}`)
		} else if (op === "set_place" || op === "place") {
			if (!need() || !isObj(p.place)) continue
			changes.push(describePlace(nameOf(it), it.place, p.place, solvedOf(it.id)))
			it.place = clone(p.place)
		} else if (op === "set_item") {
			if (!need()) continue
			const bits = []
			if (typeof p.name === "string" && p.name.trim()) ((it.name = p.name.trim()), bits.push(`named “${it.name}”`))
			if (p.held !== undefined) ((it.held = !!p.held), bits.push(it.held ? "held until the release" : "not held"))
			if (p.fixed !== undefined) ((it.fixed = !!p.fixed), bits.push(it.fixed ? "fixed in place" : "free to move"))
			if (bits.length) changes.push(`${nameOf(it)}: ${bits.join(", ")}`)
		} else if (op === "set_tune") {
			if (Array.isArray(p.tune)) plan.tune = p.tune
			changes.push("Tuning knobs updated")
		} else if (op === "set_held") {
			if (!need()) continue
			it.held = !!p.held
			changes.push(`${nameOf(it)} ${it.held ? "held until the release" : "no longer held"}`)
		} else if (op === "set_fixed") {
			if (!need()) continue
			it.fixed = !!p.fixed
			changes.push(`${nameOf(it)} ${it.fixed ? "fixed in place" : "free to move"}`)
		} else if (op === "set_scene") {
			for (const k of ["title", "seconds", "release"]) if (p[k] !== undefined) plan[k] = p[k]
			changes.push(`Scene: ${["title", "seconds", "release"].filter((k) => p[k] !== undefined).map((k) => `${k} → ${p[k]}`).join(", ")}`)
		} else if (op === "set_goals") {
			if (Array.isArray(p.goals)) plan.goals = p.goals
			changes.push("Goals updated")
		} else skipped.push(`unknown change “${op}”`)
	}
	return { plan, changes, skipped }
}

// ================================================================ the tuner: a bounded search over plan.tune knobs to make the goals happen
/** Set one knob on a plan (x / y / angle / a prop, or a dotted place path like "lean.to.x"). */
export function setKnob(plan, knob, value) {
	const it = plan.items.find((i) => i.id === knob.id)
	if (!it) return
	it.place = isObj(it.place) ? it.place : {}
	const p = String(knob.param)
	if (p === "x") {
		it.place.x = value
		delete it.place.left_of
		delete it.place.right_of
	} else if (p === "y" || p === "y_m") {
		it.place.y_m = value
		if (!it.place.on || it.place.on !== "air") it.place.on = "air"
	} else if (p === "angle" || p === "angle_deg") it.place.angle_deg = value
	else if (p === "gap" || p === "gap_m") {
		const side = it.place.left_of ? "left_of" : it.place.right_of ? "right_of" : null
		if (side) it.place[side] = { ...(isObj(it.place[side]) ? it.place[side] : { id: it.place[side] }), gap_m: value }
	} else if (p.includes(".")) {
		const path = p.replace(/^place\./, "").split(".")
		let o = it.place
		for (const k of path.slice(0, -1)) o = o[k] = isObj(o[k]) ? o[k] : {}
		o[path.at(-1)] = value
	} else it.props = { ...(it.props ?? {}), [p]: value }
}
function getKnob(plan, scene, knob) {
	const it = plan.items.find((i) => i.id === knob.id)
	const s = scene?.items?.find((i) => i.id === knob.id)
	const p = String(knob.param)
	if (p === "x") return s?.x ?? num(it?.place?.x)
	if (p === "y" || p === "y_m") return s?.y ?? num(it?.place?.y_m)
	if (p === "angle" || p === "angle_deg") return s?.angle ?? num(it?.place?.angle_deg) ?? 0
	if (p === "gap" || p === "gap_m") return num(it?.place?.left_of?.gap_m ?? it?.place?.right_of?.gap_m)
	if (p.includes(".")) return p.replace(/^place\./, "").split(".").reduce((o, k) => o?.[k], it?.place) ?? null
	return num(it?.props?.[p]) ?? num(s?.props?.[p])
}
/**
 * The plan's tune knobs, made safe to turn. A height knob on a static thing that cannot hold itself up (a cup, a funnel, a bucket: no legs, no
 * cords, no stand) would lift it off what it stands on into mid-air (J01: a cup "tuned" down to 15 cm with nothing under it). Such a knob turns
 * the height of the support it stands on instead, when that support is itself in the air (a shelf); otherwise it is left out, and said.
 * -> {knobs, notes}
 */
export function safeKnobs(plan, scene = null) {
	const knobs = []
	const notes = []
	const name = (it) => it?.name ?? typeName(it?.type) ?? it?.id
	for (const k of Array.isArray(plan?.tune) ? plan.tune : []) {
		if (!isObj(k)) continue
		const it = plan.items.find((i) => i.id === k.id)
		if (!it) continue
		const p = String(k.param)
		// (in the air on its own it is safe: the solver stands it on a stand of the right height wherever the knob puts it)
		const inAir = isObj(it.place) && (it.place.on === "air" || (it.place.on === undefined && num(it.place.y_m) !== null)) && !it.place.lean
		if ((p === "y" || p === "y_m") && !inAir && isStaticItem(it.type, it.fixed) && !holdsItselfUp(it.type, it.props ?? {}, it.fixed)) {
			const on = isObj(it.place) && typeof it.place.on === "string" && !["table", "air"].includes(it.place.on) ? it.place.on : null
			const sup = on ? plan.items.find((i) => i.id === on) : null
			const si = scene?.items?.find((i) => i.id === it.id)
			const ss = sup ? scene?.items?.find((i) => i.id === sup.id) : null
			if (sup && isObj(sup.place) && sup.place.on === "air" && !sup.place.lean && si && ss && num(k.min) !== null && num(k.max) !== null) {
				const d = ss.y - si.y
				knobs.push({ ...k, id: sup.id, param: "y", min: num(k.min) + d, max: num(k.max) + d, via: it.id })
				notes.push(`${name(it)}'s height was tuned by moving ${name(sup)}, which it stands on`)
			} else notes.push(`${name(it)}'s height was left alone: moved off what holds it up, it would float`)
			continue
		}
		knobs.push(k)
	}
	return { knobs, notes }
}
const goalCache = new WeakMap()
/**
 * The goals' results in a run: [{label, kind, ok: true | false | null (can't tell), detail, ...}]. `goals` are the plan's goals as solved (solve()
 * .goals: every kind, checked by ./goals.js on the run's own track); without them, the engine's own ("in" goals in the scene). Cached per run.
 */
export function goalResults(sim, goals = null) {
	if (!sim) return []
	if (!Array.isArray(goals)) return (sim.summary?.goals ?? []).map((g) => ({ label: g.label, kind: "in", ok: !!g.ok, item: g.item, container: g.container, detail: g.ok ? "it ends inside" : "it does not end inside" }))
	const key = JSON.stringify(goals)
	let m = goalCache.get(sim)
	if (!m) goalCache.set(sim, (m = new Map()))
	if (!m.has(key)) {
		let r
		try {
			r = checkGoals(goals, sim)
		} catch {
			r = goals.map((g) => ({ label: g.label, kind: g.kind ?? "in", ok: null, detail: "could not be checked" }))
		}
		m.set(key, r)
	}
	return m.get(key)
}
/** How far the goals are from happening: failing goals count 1 each, plus how near each failing goal got (an "in" goal: its item to its
 *  container's inside, m; "falls": the share still standing; "moves": the share of the distance missing). Lower is better. */
export function goalDistance(scene, sim, goals = null) {
	if (Array.isArray(goals) && goals.some((g) => (g.kind ?? "in") !== "in")) {
		let f = 0
		const inOnly = []
		for (const r of goalResults(sim, goals)) {
			if (r.ok === true) continue
			if (r.kind === "in") {
				inOnly.push(r)
				continue
			}
			f += 1
			if (r.kind === "falls" && r.of > 0) f += 0.9 * (1 - (r.fallen ?? 0) / r.of)
			else if (r.kind === "moves" && Number.isFinite(r.moved_m)) {
				const g = goals.find((x) => x.label === r.label)
				f += 0.9 * Math.max(0, Math.min(1, 1 - r.moved_m / (num(g?.min_m) ?? 0.05)))
			} else f += 0.9
		}
		if (!inOnly.length) return f
		const sumIn = { ...sim, summary: { ...(sim?.summary ?? {}), goals: (sim?.summary?.goals ?? []).filter((g) => inOnly.some((r) => r.item === g.item && r.container === g.container)) } }
		return f + goalDistance(scene, sumIn)
	}
	const goalsIn = sim?.summary?.goals ?? []
	let f = 0
	for (const g of goalsIn) {
		if (g.ok) continue
		f += 1
		const c = scene.items.find((i) => i.id === g.container)
		if (!c) continue
		const wall = num(c.props?.wall) ?? 0.1
		const tx = c.x
		const ty = c.y + wall / 2
		const frames = sim.track?.frames ?? []
		const ids = (sim.doc?.solids ?? []).filter((s) => s.item === g.item && s.kind === "dynamic").map((s) => s.id)
		if (!frames.length || !ids.length) continue
		let dmin = Infinity
		let dend = Infinity
		for (let k = 0; k < frames.length; k += 2) {
			const pl = frames[k].placements
			let n = 0
			let x = 0
			let y = 0
			for (const id of ids) if (pl[id]) (x += pl[id].x, (y += pl[id].y), n++)
			if (!n) continue
			const d = Math.hypot(x / n - tx, y / n - ty)
			dmin = Math.min(dmin, d)
			if (k >= frames.length - 3) dend = d
		}
		const last = frames.at(-1).placements
		let n = 0
		let x = 0
		let y = 0
		for (const id of ids) if (last[id]) (x += last[id].x, (y += last[id].y), n++)
		if (n) dend = Math.hypot(x / n - tx, y / n - ty)
		f += Math.min(1, 0.5 * (Number.isFinite(dend) ? dend : 1) + 0.5 * (Number.isFinite(dmin) ? dmin : 1)) * 0.9
	}
	return f
}
const goalsOk = (sim, goals = null) => goalResults(sim, goals).filter((g) => g.ok === true).length
/** What happens in a run, as one number: goals met count most, then the movers whose story came true (a domino row all down, a lever that turned). */
const physics = (sim, goals = null) => 100 * goalsOk(sim, goals) + (sim?.summary?.stories ?? []).filter((s) => s.ok).length - 10 * (sim?.warnings?.length ?? 0)
/** A version's run in one number (its own goals, as solved). */
const physV = (v) => physics(v.sim, v.solved?.goals ?? null)
/** Is version a better than b: the critic's score first, then what happens in the run. */
const better = (a, b) => ((a.score ?? -1) !== (b.score ?? -1) ? (a.score ?? -1) > (b.score ?? -1) : physV(a) > physV(b))
const allOk = (sim, goals = null) => {
	const r = goalResults(sim, goals)
	return r.length > 0 && r.every((g) => g.ok === true)
}

/**
 * Tune: plan.tune knobs (made safe by safeKnobs; ≤ 4 used), ≤ maxRuns engine runs and ≤ maxMs. Coarse samples first, then a pattern search around
 * the best; once the goals pass, a one-knob tune looks for the middle of the passing range (a sturdier answer).
 * -> {plan, scene, sim, changed: [{id, param, from, to}], runs, ms, before, after, passed, knobs, skipped: [words]}
 */
export async function tune({ plan, scene, sim, goals = null, exclude = null, simulate, signal, maxRuns = TUNE_RUNS, maxMs = TUNE_MS, onProgress, solver = solve }) {
	const t0 = now()
	const safe = safeKnobs(plan, scene)
	// (exclude: what the person just changed on purpose, which an edit's tuning never undoes. A Map: item id -> the knobs the edit set itself, "place"
	// (x, y, angle) and/or prop keys, or "all"; a Set of ids: every knob of those items. A cup made bigger may still be moved; a moved one stays put)
	const knobKey = (k) => (["x", "y", "angle"].includes(String(k.param)) || /^(lean|place)\./.test(String(k.param)) ? "place" : String(k.param))
	const setBy = (id) => (exclude instanceof Map ? exclude.get(id) : exclude?.has?.(id) ? "all" : null)
	const heldBy = (k) => {
		const own = setBy(k.id)
		if (own === "all" || own?.has?.(knobKey(k))) return k.id
		const via = k.via ? setBy(k.via) : null
		return via === "all" || via?.has?.("place") ? k.via : null
	}
	const held = safe.knobs.filter((k) => heldBy(k))
	const heldItems = new Map()
	for (const k of held) {
		const id = heldBy(k)
		const key = k.via && id === k.via ? "place" : knobKey(k)
		;(heldItems.get(id) ?? heldItems.set(id, new Set()).get(id)).add(key)
	}
	const placedIds = [...heldItems].filter(([, keys]) => keys.has("place")).map(([id]) => id)
	if (placedIds.length) safe.notes.push(`${andList(placedIds.map((id) => nameOfItem(plan.items.find((i) => i.id === id))))} kept where you put ${placedIds.length === 1 ? "it" : "them"}`)
	for (const [id, keys] of heldItems) {
		const it = plan.items.find((i) => i.id === id)
		const props = [...keys].filter((k) => k !== "place").map((k) => lc(propSpec(it?.type, k)?.label ?? k.replace(/_/g, " ")))
		if (props.length) safe.notes.push(`${nameOfItem(it)}'s ${andList(props)} kept as you set ${props.length === 1 ? "it" : "them"}`)
	}
	const knobs = safe.knobs
		.filter((k) => !held.includes(k))
		.filter((k) => isObj(k) && plan.items.some((i) => i.id === k.id) && num(k.min) !== null && num(k.max) !== null && num(k.max) > num(k.min))
		.slice(0, 4)
		.map((k) => ({ id: k.id, param: String(k.param), min: num(k.min), max: num(k.max), ...(k.via ? { via: k.via } : {}) }))
	const before = goalsOk(sim, goals)
	const result = { plan, scene, sim, goals, changed: [], runs: 0, ms: 0, before, after: before, passed: allOk(sim, goals), knobs, skipped: safe.notes }
	if (!knobs.length || !goalResults(sim, goals).length || allOk(sim, goals)) return result
	const start = knobs.map((k) => {
		const v = getKnob(plan, scene, k)
		return v === null ? (k.min + k.max) / 2 : Math.min(k.max, Math.max(k.min, v))
	})
	const cache = new Map()
	let best = { v: start, f: goalDistance(scene, sim, goals), plan, scene, sim, goals }
	cache.set(JSON.stringify(start.map((x) => Math.round(x * 1e5))), best)
	const budgetLeft = () => result.runs < maxRuns && now() - t0 < maxMs && !signal?.aborted
	async function evaluate(v) {
		v = v.map((x, i) => Math.min(knobs[i].max, Math.max(knobs[i].min, x)))
		const key = JSON.stringify(v.map((x) => Math.round(x * 1e5)))
		if (cache.has(key)) return cache.get(key)
		if (!budgetLeft()) return null
		const p = clone(plan)
		knobs.forEach((k, i) => setKnob(p, k, Math.round(v[i] * 1e5) / 1e5))
		let e
		try {
			const r = solver(p)
			result.runs++
			const s = await simulate(r.scene, signal)
			const g = goals ? r.goals : null
			e = { v, f: goalDistance(r.scene, s, g) + (r.ok ? 0 : 0.5), plan: p, scene: r.scene, sim: s, goals: g, ok: allOk(s, g) && r.ok }
		} catch (err) {
			if (err?.name === "AbortError") throw err
			e = { v, f: Infinity, plan: p, ok: false }
		}
		cache.set(key, e)
		if (e.f < best.f) best = e
		onProgress?.({ runs: result.runs, max: maxRuns, best: best.f, passed: !!best.ok })
		return e
	}
	// coarse: an even grid for one knob, a 3×3 grid for two, Halton points for more
	const n = knobs.length
	const span = knobs.map((k) => k.max - k.min)
	let coarse = []
	if (n === 1) coarse = Array.from({ length: 9 }, (_, i) => [knobs[0].min + (span[0] * i) / 8])
	else if (n === 2) for (const a of [0.15, 0.5, 0.85]) for (const b of [0.15, 0.5, 0.85]) coarse.push([knobs[0].min + span[0] * a, knobs[1].min + span[1] * b])
	else {
		const halton = (i, b) => {
			let f = 1
			let r = 0
			while (i > 0) {
				f /= b
				r += f * (i % b)
				i = Math.floor(i / b)
			}
			return r
		}
		const P = [2, 3, 5, 7]
		for (let i = 1; i <= 12; i++) coarse.push(knobs.map((k, j) => k.min + span[j] * halton(i, P[j])))
	}
	// near the start first (the plan's own guess is usually close), then the rest
	coarse.sort((a, b) => dist(a, start, span) - dist(b, start, span))
	// three at a time (the server runs them side by side; the in-page engine queues them), nearest first
	for (let i = 0; i < coarse.length && budgetLeft() && !best.ok; i += TUNE_PARALLEL) await Promise.all(coarse.slice(i, i + TUNE_PARALLEL).map((v) => evaluate(v)))
	// local: a pattern search around the best, halving the step
	let step = span.map((s) => s / (n === 1 ? 16 : 8))
	while (budgetLeft() && !best.ok && step.some((s, i) => s > span[i] / 400)) {
		let moved = false
		for (let i = 0; i < n && budgetLeft() && !best.ok; i++) {
			for (const sgn of [1, -1]) {
				const v = [...best.v]
				v[i] += sgn * step[i]
				const was = best
				await evaluate(v)
				if (best !== was) {
					moved = true
					break
				}
				if (!budgetLeft() || best.ok) break
			}
		}
		if (!moved) step = step.map((s) => s / 2)
	}
	// a passing one-knob answer: widen to the middle of the passing range (both sides, a few probes each)
	if (best.ok && n === 1 && budgetLeft()) {
		const edge = async (dir) => {
			let lo = best.v[0]
			let hi = dir > 0 ? knobs[0].max : knobs[0].min
			for (let k = 0; k < 4 && budgetLeft(); k++) {
				const mid = (lo + hi) / 2
				const e = await evaluate([mid])
				if (!e) break
				if (e.ok) lo = mid
				else hi = mid
			}
			return lo
		}
		const okBest = best
		const a = await edge(-1)
		const b = await edge(1)
		const mid = (a + b) / 2
		if (Math.abs(mid - okBest.v[0]) > 1e-6 && budgetLeft()) {
			const e = await evaluate([mid])
			best = e?.ok ? e : okBest
		} else best = okBest
	}
	result.ms = Math.round(now() - t0)
	if (best.plan !== plan && best.f < goalDistance(scene, sim, goals)) {
		Object.assign(result, { plan: best.plan, scene: best.scene, sim: best.sim, goals: best.goals, after: goalsOk(best.sim, best.goals), passed: allOk(best.sim, best.goals) })
		result.changed = knobs
			.map((k, i) => ({ id: k.id, param: k.param, from: Math.round(start[i] * 1e4) / 1e4, to: Math.round(best.v[i] * 1e4) / 1e4 }))
			.filter((c) => Math.abs(c.to - c.from) > 1e-6)
	}
	return result
}
const dist = (a, b, span) => Math.hypot(...a.map((x, i) => (x - b[i]) / (span[i] || 1)))

// ================================================================ the report in words: changes with their units, what the run shows
const trimNum = (v, d) => String(Number(Number(v).toFixed(d)))
const sig = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Number(Number(v).toPrecision(3))))
const lc = (s) => String(s).replace(/^./, (c) => c.toLowerCase())
const andList = (list) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`)
const nameOfItem = (it) => it?.name ?? typeName(it?.type) ?? it?.id
const isSafetyWall = (it) => it?.type === "wall" && it.props?.invisible_in_3d === true
const sameValue = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-6) : JSON.stringify(a ?? null) === JSON.stringify(b ?? null))
/** A length in words: "8 mm", "4.5 cm", "35 cm", "1.25 m". */
export function fmtLen(v) {
	const a = Math.abs(v)
	// (by the figure it shows: 9.99 mm is "1 cm", never "10 mm"; 99.96 cm is "1 m")
	if (Number(trimNum(a * 1000, 1)) < 10) return `${trimNum(a * 1000, 1)} mm`
	if (Number(trimNum(a * 100, 1)) < 10) return `${trimNum(a * 100, 1)} cm`
	if (Number(trimNum(a * 100, 0)) < 100) return `${trimNum(a * 100, 0)} cm`
	return `${trimNum(a, 2)} m`
}
/** A prop's change in words with its unit: "diameter 10 → 20 cm", "stiffness 800 → 1200 N/m", "tilt 20° → 31°", "legs under it: off". */
export function propChange(type, key, a, b) {
	const sp = propSpec(type, key)
	const label = /^how many$/i.test(sp?.label ?? "") ? "count" : /^front to back$/i.test(sp?.label ?? "") ? "depth" : lc(sp?.label ?? String(key).replace(/_/g, " "))
	if (sp?.kind === "bool" || typeof b === "boolean") return `${label}: ${b ? "on" : "off"}`
	if (typeof a === "number" && typeof b === "number") {
		const u = sp?.unit ?? ""
		if (u === "m") {
			const big = Math.max(Math.abs(a), Math.abs(b))
			return big < 0.01 ? `${label} ${trimNum(a * 1000, 1)} → ${trimNum(b * 1000, 1)} mm` : big < 1 ? `${label} ${trimNum(a * 100, 1)} → ${trimNum(b * 100, 1)} cm` : `${label} ${trimNum(a, 3)} → ${trimNum(b, 3)} m`
		}
		if (u === "°") return `${label} ${sig(a)}° → ${sig(b)}°`
		if (u === "kg" && Math.max(Math.abs(a), Math.abs(b)) < 1) return `${label} ${trimNum(a * 1000, 0)} → ${trimNum(b * 1000, 0)} g`
		return `${label} ${sig(a)} → ${sig(b)}${u ? ` ${u}` : ""}`
	}
	return `${label} ${a ?? "default"} → ${b ?? "default"}`
}
const propValue = (it, k) => (it.props?.[k] !== undefined ? it.props[k] : propSpec(it.type, k)?.default)
/**
 * What changed between two scenes (before and after a step), in words with units, leaving out anything under 1 mm or 0.1°:
 * ["Added Golf ball", "Cup moved 35 cm right and 15 cm down", "Ramp: angle -18° → -27°", "Steel ball: diameter 10 → 20 cm", "Runs 5 s → 7 s"].
 * Things moved by the same amount (a stack moved as one) share a line. This is what the scene shows, not what was asked of the plan.
 */
export function describeDiff(a, b) {
	if (!a?.items || !b?.items) return []
	const A = new Map(a.items.filter((i) => !isSafetyWall(i)).map((i) => [i.id, i]))
	const B = new Map(b.items.filter((i) => !isSafetyWall(i)).map((i) => [i.id, i]))
	const lines = []
	const added = [...B.values()].filter((i) => !A.has(i.id)).map(nameOfItem)
	const removed = [...A.values()].filter((i) => !B.has(i.id)).map(nameOfItem)
	if (added.length) lines.push(`Added ${andList(added)}`)
	if (removed.length) lines.push(`Removed ${andList(removed)}`)
	// a shift of the whole layout (the solver keeps it on the table) is said once; what moved otherwise is said on its own
	const shifts = new Map()
	const common = [...B.values()].filter((i) => A.has(i.id) && i.type !== "table")
	for (const ib of common) {
		const ia = A.get(ib.id)
		const dx = (Number(ib.x) || 0) - (Number(ia.x) || 0)
		const dy = (Number(ib.y) || 0) - (Number(ia.y) || 0)
		if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) continue
		const key = `${Math.round(dx * 2000)}|${Math.round(dy * 2000)}`
		shifts.set(key, (shifts.get(key) ?? 0) + 1)
	}
	const [shiftKey, shiftN] = [...shifts].sort((p, q) => q[1] - p[1])[0] ?? [null, 0]
	const shifted = shiftN >= 3 && shiftN >= 0.6 * common.length ? shiftKey : null
	const groups = new Map()
	for (const [id, ib] of B) {
		const ia = A.get(id)
		if (!ia) continue
		const nm = nameOfItem(ib)
		const bits = []
		if (ia.type !== ib.type) bits.push(`now ${typeName(ib.type).toLowerCase()} (was ${typeName(ia.type).toLowerCase()})`)
		const dx = (Number(ib.x) || 0) - (Number(ia.x) || 0)
		const dy = (Number(ib.y) || 0) - (Number(ia.y) || 0)
		const mv = []
		if (Math.abs(dx) >= 0.001) mv.push(`${fmtLen(dx)} ${dx > 0 ? "right" : "left"}`)
		if (Math.abs(dy) >= 0.001) mv.push(`${fmtLen(dy)} ${dy > 0 ? "up" : "down"}`)
		const aa = Number(ia.angle) || 0
		const ab = Number(ib.angle) || 0
		if (Math.abs(ab - aa) >= 0.1) bits.push(`angle ${sig(aa)}° → ${sig(ab)}°`)
		if (ia.type === ib.type)
			for (const k of new Set([...Object.keys(ia.props ?? {}), ...Object.keys(ib.props ?? {})])) {
				const va = propValue(ia, k)
				const vb = propValue(ib, k)
				if (!sameValue(va, vb)) bits.push(propChange(ib.type, k, va, vb))
			}
		if (!!ia.held !== !!ib.held) bits.push(ib.held ? "held until the release" : "no longer held")
		if (!!ia.fixed !== !!ib.fixed) bits.push(ib.fixed ? "fixed in place" : "free to move")
		if (ia.name && ib.name && ia.name !== ib.name) bits.push(`renamed from “${ia.name}”`)
		const key = `${Math.round(dx * 2000)}|${Math.round(dy * 2000)}`
		if (shifted && key === shifted) mv.length = 0 // (part of the shift of everything: said once, below)
		if (mv.length && !bits.length) {
			let g = groups.get(key)
			if (!g) {
				g = { names: [], text: mv.join(" and ") }
				groups.set(key, g)
				lines.push(g)
			}
			g.names.push(nm)
			continue
		}
		if (!mv.length && !bits.length) continue
		lines.push(mv.length ? `${nm} moved ${mv.join(" and ")}; ${bits.join(", ")}` : `${nm}: ${bits.join(", ")}`)
	}
	if (shifted) {
		const [kx, ky] = shifted.split("|").map((v) => Number(v) / 2000)
		const mv = [Math.abs(kx) >= 0.001 ? `${fmtLen(kx)} ${kx > 0 ? "right" : "left"}` : null, Math.abs(ky) >= 0.001 ? `${fmtLen(ky)} ${ky > 0 ? "up" : "down"}` : null].filter(Boolean).join(" and ")
		lines.push(`${shiftN === common.length ? "Everything" : "Everything else"} moved ${mv} (the layout was shifted to stay on the table)`)
	}
	if (num(a.seconds) !== null && num(b.seconds) !== null && Math.abs(a.seconds - b.seconds) > 1e-6) lines.push(`Runs ${sig(a.seconds)} s → ${sig(b.seconds)} s`)
	if (num(a.release) !== null && num(b.release) !== null && Math.abs(a.release - b.release) > 1e-6) lines.push(`Lets go at ${sig(a.release)} s → ${sig(b.release)} s`)
	// goals by what they are about (a renamed goal is the same goal; one that now covers more things is the same goal, grown)
	lines.push(...goalDiffLines(a.goals, b.goals, B))
	return lines.map((l) => (typeof l === "string" ? l : `${andList(l.names)} moved ${l.text}`))
}
/**
 * Goals added, dropped or changed between two lists, paired by what they are about: the same kind and refs is the same goal (a new label is a
 * rename, not news); the same kind with the same label, or sharing an item, is one goal that changed ("“The whole tower falls” now covers 10
 * wooden blocks (was 6)"), never a "New goal" and a "Goal dropped" with one name. items: Map id -> scene item (for the words).
 */
function goalDiffLines(listA, listB, items = new Map()) {
	const norm = (g) => ({ ...g, kind: g.kind ?? "in" })
	const A = (Array.isArray(listA) ? listA : []).filter(isObj).map(norm)
	const B = (Array.isArray(listB) ? listB : []).filter(isObj).map(norm)
	const key = (g) => `${g.kind}|${goalRefs(g).join(",")}`
	const lbl = (g) => String(g.label ?? "").trim().toLowerCase()
	const added = B.filter((g) => !A.some((x) => key(x) === key(g)))
	const dropped = A.filter((g) => !B.some((x) => key(x) === key(g)))
	const out = []
	for (const g of added) {
		const i = dropped.findIndex((x) => x.kind === g.kind && ((lbl(x) && lbl(x) === lbl(g)) || goalItems(x).some((id) => goalItems(g).includes(id))))
		if (i < 0) {
			out.push(`New goal: ${g.label ?? g.kind}`)
			continue
		}
		const was = dropped.splice(i, 1)[0]
		const na = goalItems(was).length
		const nb = goalItems(g).length
		const types = new Set(goalItems(g).map((id) => items.get?.(id)?.type).filter(Boolean))
		const what = (n) => (types.size === 1 ? `${n} ${pluralWord(String(typeName([...types][0]) ?? "thing").toLowerCase(), n)}` : `${n} ${n === 1 ? "thing" : "things"}`)
		if (na !== nb) out.push(`Goal “${g.label ?? was.label}” now covers ${what(nb)} (was ${na})`)
		else if (lbl(was) !== lbl(g)) out.push(`Goal “${was.label}” is now “${g.label}”`)
		else out.push(`Goal “${g.label}” now about ${andList(goalRefs(g).map((id) => items.get?.(id)?.name ?? id))}`)
	}
	for (const g of dropped) out.push(`Goal dropped: ${g.label ?? g.kind}`)
	return out
}
/** "wooden block" -> "wooden blocks" (n ≠ 1), "box" -> "boxes". */
const pluralWord = (w, n) => (n === 1 ? w : /(s|x|z|ch|sh)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`)
// ================================================================ the reply: what changed, in the words a person would use
const massCache = new Map()
let factsCache = null
/** An item's weight in kg as the engine builds it, or null when this type's weight isn't plain geometry × density (a full can, a book with
 *  pages: those are tuned to measured weights, so no number is claimed for them). Checked against the catalog's own figure at its defaults. */
export function massOf(type, props = {}) {
	const key = `${type}|${JSON.stringify(props ?? {})}`
	if (massCache.has(key)) return massCache.get(key)
	const geom = (pr) => {
		const { doc } = buildDoc({ stage: { x0: -0.6, x1: 3.2, y0: -0.2, y1: 2.4 }, items: [{ id: "g", type, x: 0, y: 0.5, angle: 0, props: pr }] })
		let m = 0
		for (const s of doc.solids) {
			if (s.kind !== "dynamic") continue
			const mat = MATERIALS[String(s.material ?? "").replace(/ \[[^\]]*\]$/, "")]
			const b = s.body
			if (!mat || !b) return null
			let v
			if (b.kind === "ball") v = (4 / 3) * Math.PI * (b.radius ** 3 - (b.wall > 0 && b.wall < b.radius ? (b.radius - b.wall) ** 3 : 0))
			else if (b.kind === "slab") v = b.width * b.height * (Number(b.depth) || 0) * (((b.taper ?? 1) + 1) / 2)
			else if (b.kind === "polygon") {
				let a = 0
				const p = b.points
				for (let i = 0; i < p.length; i++) a += p[i].x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * p[i].y
				v = Math.abs(a / 2) * (Number(b.depth) || 0)
			} else return null
			m += v * mat.density
		}
		return m > 0 ? m : null
	}
	let out = null
	try {
		factsCache ??= new Map(simCatalog().types.map((t) => [t.key, t.facts ?? ""]))
		const f = /([\d.]+) (g|kg)\b/.exec(factsCache.get(type) ?? "")
		const at = geom({})
		if (f && at && Math.abs(at - Number(f[1]) * (f[2] === "kg" ? 1 : 0.001)) / at < 0.03) out = geom(props ?? {})
	} catch {}
	massCache.set(key, out)
	return out
}
const fmtMass = (kg) => (kg >= 1 ? `${trimNum(kg, kg >= 10 ? 0 : 1)} kg` : `${trimNum(kg * 1000, kg < 0.01 ? 1 : 0)} g`)
/** A setting's change as a word: "taller", "thinner wall", "more", "steeper". */
function propWord(type, key, a, b) {
	const label = String(propSpec(type, key)?.label ?? key).toLowerCase()
	// (an angle is how far it is from straight down or level, whichever side: a start angle of -55° → -20° is less)
	const angle = /angle|tilt|pull/.test(`${label} ${key}`)
	const up = angle && typeof a === "number" && typeof b === "number" ? Math.abs(b) > Math.abs(a) : b > a
	const pairs = [
		[/wall|thick/, "thicker wall", "thinner wall"],
		[/how many|count|number/, "more", "fewer"],
		[/depth|deep|front to back/, "deeper", "shallower"],
		[/height|tall/, "taller", "shorter"],
		[/length|long/, "longer", "shorter"],
		[/width|wide|across/, "wider", "narrower"],
		[/diameter|size|radius|scale/, "bigger", "smaller"],
		[/mass|weight|heavy/, "heavier", "lighter"],
		[/spacing|gap|apart/, "further apart", "closer together"],
		[/grow|bigger by/, "growing faster", "growing more slowly"],
		[/compress|pulled back|pull back/, "pulled back further", "pulled back less"],
		[/tilt|angle|slope|lift/, "tilted more", "tilted less"],
		[/stiff|spring/, "stiffer", "softer"],
		[/speed|power|force/, "faster", "slower"],
		[/bounce/, "bouncier", "less bouncy"],
		[/friction|grip/, "grippier", "slicker"]
	]
	for (const [re, u, d] of pairs) if (re.test(label)) return up ? u : d
	return null
}
const theName = (it) => {
	const n = nameOfItem(it) ?? "it"
	return /\d/.test(n) || /^[A-Z][a-z]+ [A-Z]/.test(n) ? n : `the ${lc(n)}`
}
const aKind = (type) => {
	const n = lc(typeName(type) ?? type)
	return `${/^[aeiou]/.test(n) ? "an" : "a"} ${n}`
}
/**
 * What changed between two scenes, as short first-person phrases a person would use (real units, never a prop's internal name):
 * ["swapped Ball 2 for a tennis ball", "made the tennis ball lighter (58 g → 20 g, thinner wall)", "moved the box 10 cm left", "added a golf ball"].
 */
export function humanChanges(a, b) {
	return humanChangeList(a, b).map((c) => c.text)
}
/**
 * The same, each with the item it is about: [{text, id, name}] (id null for the scene's own: its run length). What rides on a moved thing and
 * moved with it, by the same amount and nothing else, is said with it: "moved the conveyor belt (with the golf balls on it) 20 cm left".
 */
export function humanChangeList(a, b, { room = null } = {}) {
	if (!a?.items || !b?.items) return []
	const A = new Map(a.items.filter((i) => !isSafetyWall(i)).map((i) => [i.id, i]))
	const B = new Map(b.items.filter((i) => !isSafetyWall(i)).map((i) => [i.id, i]))
	const out = []
	const added = [...B.values()].filter((i) => !A.has(i.id))
	const removed = [...A.values()].filter((i) => !B.has(i.id))
	const entries = []
	for (const ib of B.values()) {
		const ia = A.get(ib.id)
		if (!ia) continue
		if (ib.type === "table") {
			const wa = propValue(ia, "width")
			const wb = propValue(ib, "width")
			if (num(wa) !== null && num(wb) !== null && Math.abs(wb - wa) > 0.005) entries.push({ it: ib, bits: [`${wb > wa ? "widened" : "narrowed"} the table to ${fmtLen(wb)} so everything fits`], after: [], move: null, turn: null, riders: [] })
			continue
		}
		const bits = []
		// ("Ball 2" says little: the kind it was goes with it)
		if (ia.type !== ib.type) {
			// (and what it was given beyond the new kind's own settings: "a tennis ball (lighter: 58 → 8 g)")
			const set = Object.keys(ib.props ?? {}).filter((k) => !sameValue(propValue(ib, k), propSpec(ib.type, k)?.default))
			// (a setting whose default follows the size, like a weight: compared with what the new kind weighs by itself)
			const base = (k) => {
				const sp = propSpec(ib.type, k)
				if (num(sp?.default) !== null) return num(sp.default)
				return /weight|mass/i.test(`${sp?.label ?? k}`) ? massOf(ib.type, {}) : null
			}
			const extra = set.slice(0, 2).map((k) => {
				const a = base(k)
				const b = propValue(ib, k)
				if (a === null || typeof b !== "number") return propChange(ib.type, k, propSpec(ib.type, k)?.default, b)
				const w = propWord(ib.type, k, a, b)
				const c = propChange(ib.type, k, a, b)
				return w ? `${w}: ${c.replace(/^[^0-9-]*?(?=-?\d)/, "")}` : c
			})
			bits.push(`swapped ${theName(ia)}${String(nameOfItem(ia) ?? "").toLowerCase().includes(lc(typeName(ia.type) ?? ia.type).toLowerCase()) ? "" : ` (the ${lc(typeName(ia.type) ?? ia.type)})`} for ${aKind(ib.type)}${extra.length ? ` (${extra.join(", ")})` : ""}`)
		}
		else {
			const keys = [...new Set([...Object.keys(ia.props ?? {}), ...Object.keys(ib.props ?? {})])].filter((k) => !sameValue(propValue(ia, k), propValue(ib, k)))
			if (keys.length) {
				// (a weight typed in is that weight; one that follows the size is what the engine builds)
				const weighs = (it) => (num(it.props?.mass) !== null ? num(it.props.mass) : massOf(it.type, it.props))
				const ma = weighs(ia)
				const mb = weighs(ib)
				const massMoved = ma && mb && Math.abs(mb - ma) / ma > 0.02
				// a setting that is about the inside of a thing (a ball's wall, its fill): what it does is its weight
				const inner = keys.every((k) => /wall|thick|fill|hollow|density/.test(String(propSpec(ib.type, k)?.label ?? k).toLowerCase()))
				// (a weight left to follow the size has no number of its own: it is what the thing weighs)
				const pv = (it, k) => (typeof propValue(it, k) !== "number" && /^mass$|weight/i.test(`${k} ${propSpec(it.type, k)?.label ?? ""}`) ? weighs(it) ?? propValue(it, k) : propValue(it, k))
				const words = keys.map((k) => ({ k, w: propWord(ib.type, k, pv(ia, k), pv(ib, k)), c: propChange(ib.type, k, pv(ia, k), pv(ib, k)) }))
				const only = keys.length === 1 && typeof propValue(ia, keys[0]) === "number" && typeof propValue(ib, keys[0]) === "number" ? keys[0] : null
				const va = only ? propValue(ia, only) : null
				const vb = only ? propValue(ib, only) : null
				// a count: "added 5 dominoes (7 → 12)"
				const countK = keys.find((k) => /how many|count/i.test(String(propSpec(ib.type, k)?.label ?? k)))
				if (countK) {
					const na = Number(propValue(ia, countK))
					const nb = Number(propValue(ib, countK))
					const unit = { "domino-row": Math.abs(nb - na) === 1 ? "domino" : "dominoes", "newtons-cradle": Math.abs(nb - na) === 1 ? "ball" : "balls" }[ib.type]
					words.splice(words.findIndex((x) => x.k === countK), 1)
					const also = [...new Set(words.map((x) => x.w).filter(Boolean))]
					bits.push(`${nb > na ? "added" : "took away"} ${Math.abs(nb - na)} ${unit ?? `to ${theName(ib)}`} (${na} → ${nb}${also.length ? `, ${andList(also)}` : ""})`)
				} else if (inner && massMoved) bits.push(`made ${theName(ib)} ${mb < ma ? "lighter" : "heavier"} (${fmtMass(ma)} → ${fmtMass(mb)}${words[0].w ? `, ${words[0].w}` : ""})`)
				else if (/^pulled back/.test(words[0].w ?? "") && typeof propValue(ia, words[0].k) === "number") {
					// ("pulled the spring launcher back less (4.6 → 3.5 cm)")
					bits.push(`pulled ${theName(ib)} back ${/further/.test(words[0].w) ? "further" : "less"} (${words[0].c.replace(/^[^0-9-]*?(?=-?\d)/, "")})`)
				} else if (only && /start.?angle/i.test(`${only} ${propSpec(ib.type, only)?.label ?? ""}`)) {
					// a pendulum's start: how far it is pulled back, whichever side ("pulled the pendulum back less (55° → 20°)")
					bits.push(`pulled ${theName(ib)} back ${Math.abs(vb) > Math.abs(va) ? "further" : "less"} (${sig(Math.abs(va))}° → ${sig(Math.abs(vb))}°)`)
				} else if (only === "tilt") bits.push(`tilted ${theName(ib)} ${Math.abs(vb) > Math.abs(va) ? "more" : "less"} (${sig(Math.abs(va))}° → ${sig(Math.abs(vb))}°)`)
				else if (only === "spacing" && ib.type === "domino-row") {
					// (in domino heights: said as the first gap in cm)
					const h = num(propValue(ib, "first_height"))
					const ga = h ? fmtLen(va * h) : sig(va)
					const gb = h ? fmtLen(vb * h) : sig(vb)
					bits.push(`spaced ${theName(ib)} ${vb > va ? "further apart" : "closer together"} (first gap ${ga.split(" ").at(-1) === gb.split(" ").at(-1) ? ga.replace(/ \S+$/, "") : ga} → ${gb})`)
				} else {
					const main = words.filter((x) => x.w).slice(0, 2)
					const how = main.length ? andList([...new Set(main.map((x) => x.w))]) : "different"
					bits.push(`made ${theName(ib)} ${how} (${words[0].c}${massMoved && !keys.includes("mass") ? `; ${fmtMass(ma)} → ${fmtMass(mb)}` : ""})`)
				}
			}
		}
		const dx = (Number(ib.x) || 0) - (Number(ia.x) || 0)
		const dy = (Number(ib.y) || 0) - (Number(ia.y) || 0)
		const swapped = ia.type !== ib.type
		// (a swapped thing re-seated on its support moves a little: that is part of the swap)
		const move = !swapped && (Math.abs(dx) >= 0.005 || Math.abs(dy) >= 0.005) ? { dx, dy } : null
		const after = []
		const aa = Number(ia.angle) || 0
		const ab = Number(ib.angle) || 0
		const turn = !swapped && Math.abs(ab - aa) >= 0.5 ? { aa, ab } : null
		if (!!ia.held !== !!ib.held) after.push(ib.held ? `made ${theName(ib)} wait for the release` : `let ${theName(ib)} go from the start`)
		if (!!ia.fixed !== !!ib.fixed) after.push(ib.fixed ? `fixed ${theName(ib)} in place` : `let ${theName(ib)} move freely`)
		if (!swapped && (ia.name ?? null) !== (ib.name ?? null)) after.push(`renamed ${theName(ia)} to ${ib.name ?? aKind(ib.type)}`)
		entries.push({ it: ib, was: ia, bits, move, turn, after, riders: [] })
	}
	// what rode on a moved thing and moved with it (by the same amount, and nothing else about it changed) is said with it
	let R = null
	try {
		R = riderMap(a)
	} catch {}
	const byId = new Map(entries.map((e) => [e.it.id, e]))
	// (a thing turned carries what rests on it round with it: that rider's own move and turn are part of the turn)
	// (and a thing made shorter or longer keeps what rests on it: "made the seesaw shorter (…), with Ball 2 still on it")
	for (const e of entries) {
		if ((!e.move && !e.turn && !e.bits.length) || !R || !e.riders) continue
		for (const rid of R.get(e.it.id) ?? []) {
			const r = byId.get(rid)
			if (!r || r.folded || r.bits.length || r.after.length || (!r.move && !r.turn)) continue
			const same = e.move && r.move && !r.turn && Math.abs(r.move.dx - e.move.dx) <= 0.003 && Math.abs(r.move.dy - e.move.dy) <= 0.003
			if (!same && !e.turn && !(e.bits.length && !e.move)) continue
			r.folded = true
			e.riders.push(r.it)
		}
	}
	for (const e of entries) {
		if (e.folded) continue
		const say = (text) => out.push({ text, id: e.it.id, name: theName(e.it) })
		const keptOn = e.riders.length && !e.move && !e.turn ? `, with ${groupNames(e.riders)} still on it` : ""
		e.bits.forEach((t, i) => say(i === e.bits.length - 1 ? `${t}${keptOn}` : t))
		const withRiders = e.riders.length ? ` (with ${groupNames(e.riders)} on it)` : ""
		if (e.move) {
			const { dx, dy } = e.move
			say(`moved ${theName(e.it)}${e.turn ? "" : withRiders} ${[Math.abs(dx) >= 0.005 ? `${fmtLen(dx)} ${dx > 0 ? "right" : "left"}` : null, Math.abs(dy) >= 0.005 ? `${fmtLen(dy)} ${dy > 0 ? "up" : "down"}` : null].filter(Boolean).join(" and ")}${room?.has?.(e.it.id) && !e.bits.length ? " to make room" : ""}`)
		}
		if (e.turn) {
			const { aa, ab } = e.turn
			// (a ramp is steeper or flatter, from level; anything else is turned)
			if (e.it.type === "plank" && Math.sign(aa || ab) === Math.sign(ab || aa)) say(`made ${theName(e.it)}${withRiders} ${sig(Math.abs(Math.abs(ab) - Math.abs(aa)))}° ${Math.abs(ab) > Math.abs(aa) ? "steeper" : "flatter"} (${sig(Math.abs(aa))}° → ${sig(Math.abs(ab))}°)`)
			else say(`turned ${theName(e.it)}${withRiders} ${sig(Math.abs(ab - aa))}°`)
		}
		for (const t of e.after) say(t)
	}
	if (added.length) out.push({ text: `added ${andList(added.map((i) => aKind(i.type)))}`, id: added[0].id, name: theName(added[0]) })
	if (removed.length) out.push({ text: `removed ${andList(removed.map(theName))}`, id: removed[0].id, name: theName(removed[0]) })
	if (num(a.seconds) !== null && num(b.seconds) !== null && Math.abs(a.seconds - b.seconds) > 1e-6) out.push({ text: `made it run ${sig(b.seconds)} s instead of ${sig(a.seconds)} s`, id: null, name: "the run" })
	return out
}
/**
 * A list of changes in one breath: "swapped Ball 2 for a tennis ball and Ball 1 for a basketball" (a verb shared with the one before is said
 * once, but never when what follows is "it …": "made it run 8 s"). Past three, the rest are named by what they changed (who: the item's name
 * for each change), never hidden in "and 1 more change": "moved the seesaw 10 cm left, the dominoes 3 cm left and changed the box too".
 */
function saidChanges(list, who = []) {
	const strip = (arr) => arr.map((t, i, a) => (i && t.split(" ")[0] === a[i - 1].split(" ")[0] && t.split(" ")[1] !== "it" ? t.slice(t.indexOf(" ") + 1) : t))
	if (list.length <= 3) return andList(strip(list))
	const shown = new Set(who.slice(0, 2))
	const rest = [...new Set(who.slice(2).filter((n) => n && !shown.has(n)))]
	if (who.length < list.length || !rest.length) return `${andList(strip(list.slice(0, 3)))}, and ${plural(list.length - 3, "more change")}`
	return andList([...strip(list.slice(0, 2)), `changed ${andList(rest)} too`])
}
/**
 * The reply's first sentence(s): the change in a person's words and what the run really shows (never what was only meant to happen).
 * goals: [{label, ok, was?}]; fixable: a "fix it" suggestion will be offered.
 */
export function leadSentence({ mode, title, changes = [], goals = [], noChange = false, score = null, who = [] }) {
	const failed = goals.filter((g) => g.ok === false)
	// "swapped Ball 2 for a tennis ball and swapped Ball 1 for a basketball" -> "swapped Ball 2 for a tennis ball and Ball 1 for a basketball"
	const said = (list) => saidChanges(list, who)
	const plain = (l) => {
		const t = String(l).replace(/[.!]+$/, "")
		return /^(The|A|An|All|Every|Each|Both)\b/.test(t) ? lc(t) : t
	}
	const q = (l) => `“${String(l).replace(/[.!]+$/, "")}”`
	let outcome = ""
	if (goals.length && !failed.length) {
		const kept = mode !== "new" && goals.every((g) => g.was === true)
		if (goals.length === 1) outcome = mode === "new" ? `${plain(goals[0].label)} ✓` : kept ? `${plain(goals[0].label)}, as before ✓` : `now ${plain(goals[0].label)} ✓`
		else outcome = mode === "new" ? `all ${goals.length} goals happen ✓` : kept ? `everything still works ✓` : `now all ${goals.length} goals happen ✓`
	} else if (failed.length) {
		const g = failed[0]
		outcome = mode !== "new" && g.was === true ? `but now ${q(g.label)} fails ✗` : `but ${q(g.label)} doesn’t happen yet ✗`
		if (failed.length > 1) outcome = outcome.replace(" ✗", ` (and ${plural(failed.length - 1, "more goal")}) ✗`)
	}
	const tail = failed.length ? " Want me to fix it?" : ""
	let out
	if (mode === "new") out = `Here’s ${q(title ?? "your scene")}${outcome ? ` — ${outcome}` : ""}.${tail}`
	else if (noChange || !changes.length) out = mode === "check" ? `I looked at it again${score != null ? ` (${score}/10)` : ""}${outcome ? ` — ${outcome}` : ""}.${tail}` : `That’s already how it is, so nothing needed changing${outcome ? ` — ${outcome}` : ""}.${tail}`
	else out = `${failed.length ? "I" : "Done! I"} ${said(changes)}${outcome ? ` — ${outcome}` : ""}.${tail}`
	return out.replace(/ (✓|✗)\.(?= |$)/g, " $1")
}
/**
 * An edit's reply, first sentence: the change in a person's words and what the run shows. When a goal (or a row that all fell before) now fails:
 * "I swapped Ball 2 for a tennis ball — now the tennis ball hits the side of the box and drops outside ✗." (the panel adds the offer of a checked
 * fix: "Want me to …? (checked: … ✓)"). targets: [{label, ok, was?, implicit?, happened?}]; fixApplied: the fix that went on the table with it
 * (a request that stated the outcome).
 */
export function editLead({ changes = [], targets = [], noChange = false, fixApplied = null, who = [] }) {
	const said = (list) => saidChanges(list, who)
	const plain = (l) => {
		const t = String(l).replace(/[.!]+$/, "")
		return /^(The|A|An|All|Every|Each|Both)\b/.test(t) ? lc(t) : t
	}
	const failed = targets.filter((t) => t.ok === false)
	const explicit = targets.filter((t) => !t.implicit)
	if (!failed.length) {
		const kept = explicit.length > 0 && explicit.every((t) => t.was === true) && !fixApplied
		const implicitKept = !explicit.length && targets.length === 1 && targets[0].was === true ? `${plain(targets[0].label)}, as before ✓` : ""
		const outcome = explicit.length === 1 ? (kept ? `${plain(explicit[0].label)}, as before ✓` : `${plain(explicit[0].label)} ✓`) : explicit.length > 1 ? (kept ? "everything still works ✓" : `all ${explicit.length} goals happen ✓`) : implicitKept
		if (fixApplied && (noChange || !changes.length)) return `Done! I ${fixApplied.did}${outcome ? ` — ${outcome}` : ""}`
		if (noChange || !changes.length) return `That’s already how it is, so nothing needed changing${outcome ? ` — ${outcome}` : ""}`
		return `Done! I ${said(changes)}${fixApplied ? `, and ${fixApplied.did}${/ to line up with /.test(fixApplied.did) ? "" : " so it works"}` : ""}${outcome ? ` — ${outcome}` : ""}`
	}
	const g = failed.find((t) => !t.implicit) ?? failed[0]
	const words = g.happened ? String(g.happened).replace(/\.$/, "") : `“${String(g.label).replace(/[.!]+$/, "")}” doesn’t happen`
	const others = failed.filter((t) => t !== g && !t.implicit).length
	const what = `${g.was === false ? `it still doesn’t work: ${words}` : `now ${words}`}${others ? ` (and ${plural(others, "more goal")} fail${others === 1 ? "s" : ""})` : ""} ✗`
	if (noChange || !changes.length) return `Nothing needed changing for that — ${what}.`
	return `I ${said(changes)} — ${what}.`
}
/** Suggestions from the AI: [{label, prompt}], short and usable, at most 3. */
const cleanSuggestions = (list) =>
	(Array.isArray(list) ? list : [])
		.filter((s) => isObj(s) && typeof s.label === "string" && s.label.trim() && typeof (s.prompt ?? s.label) === "string")
		.map((s) => ({ label: s.label.trim().slice(0, 48), prompt: String(s.prompt ?? s.label).trim().slice(0, 600) }))
		.slice(0, 3)
/** Plan changes a scene does not show (the tuner's knobs; goals and timing show in the scene): kept beside the scene's diff. */
const unseenChanges = (planChanges) => (planChanges ?? []).filter((c) => /^Tuning knobs/.test(c))

/**
 * The run in one or two plain sentences, from its own events (never from the plan): "In the run: Red ball hits Ramp (0.61 s) → … 7 of 7 fall."
 * The hits a goal is about are always named (never folded into "N more hits"), and an item whose own parts strike each other (a Newton's
 * cradle's balls) says so: such a run never reads "hits nothing". `goals`: the plan's goals as solved.
 */
export function describeRun(sim, scene = null, goals = null) {
	const s = sim?.summary ?? {}
	const typeOf = new Map((scene?.items ?? []).map((i) => [i.id, i.type]))
	const nameOf = new Map((scene?.items ?? []).map((i) => [i.id, i.name ?? typeName(i.type) ?? i.id]))
	const scenery = (id) => id === "table" || /^wall-/.test(String(id ?? "")) || ["table", "wall"].includes(typeOf.get(id))
	const all = Array.isArray(s.events) ? s.events : []
	const events = all.filter((e) => !scenery(e.a) && !scenery(e.b))
	const pool = events.length ? events : all
	// the hits a goal depends on: a "hits" goal's item and target, an "in" goal's item and container
	const pairOf = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)
	const wanted = new Set()
	for (const g of Array.isArray(goals) ? goals : s.goals ?? []) {
		const kind = g?.kind ?? "in"
		if (kind === "hits" && g.target) for (const it of goalItems(g)) wanted.add(pairOf(it, g.target))
		if (kind === "in" && g.container) for (const it of goalItems(g)) wanted.add(pairOf(it, g.container))
	}
	const keyed = pool.filter((e) => wanted.has(pairOf(e.a, e.b)))
	const shown = [...new Set([...pool.slice(0, Math.max(2, 4 - keyed.length)), ...keyed])].sort((a, b) => a.t - b.t).slice(0, 6)
	const more = pool.length - shown.length
	const stories = Array.isArray(s.stories) ? s.stories : []
	const moved = stories.filter((st) => st.moved_at !== null && st.moved_at !== undefined)
	const inner = [...innerHits(sim)].filter(([id, h]) => h.n >= 2 && typeOf.get(id) !== "domino-row" && !scenery(id))
	const innerWords = inner.slice(0, 2).map(([id, h]) => `${nameOf.get(id) ?? id}: its ${typeOf.get(id) === "newtons-cradle" ? "balls" : "parts"} strike each other ${h.n} times (first at ${Number(h.t).toFixed(2)} s)`)
	if (!moved.length && !all.length && !inner.length) return "In the run nothing moves: everything stays where it was put."
	const parts = []
	if (shown.length) parts.push(`In the run: ${shown.map((e) => `${e.text} (${Number(e.t).toFixed(2)} s)`).join(" → ")}${more > 0 ? ` → ${more} more hit${more === 1 ? "" : "s"}` : ""}.`)
	else if (inner.length) parts.push(`In the run: ${innerWords.join("; ")}.`)
	else parts.push(`In the run: ${andList(moved.slice(0, 3).map((st) => st.name))} ${moved.length === 1 ? "moves but hits" : "move but hit"} nothing.`)
	const extra = [...(shown.length ? innerWords : []), ...stories.filter((st) => /^\d+ of \d+ fall$/.test(st.text ?? "")).map((st) => `${st.name}: ${fallText(sim, st)}`), ...stories.filter((st) => /^turns /.test(st.text ?? "") && st.ok).map((st) => `${st.name} ${st.text}`)]
	if (extra.length) parts.push(`${extra.slice(0, 4).join("; ")}.`)
	return parts.join(" ")
}
/** An item's own parts striking each other in a run (a Newton's cradle's balls; the engine's summary leaves these out): Map item -> {n, t (the first)}. */
export function innerHits(sim) {
	const out = new Map()
	const itemOf = new Map((sim?.doc?.solids ?? []).map((s) => [s.id, s.item]))
	for (const h of Array.isArray(sim?.track?.impacts) ? sim.track.impacts : []) {
		const a = itemOf.get(h.a)
		if (a === undefined || a === null || a !== itemOf.get(h.b)) continue
		const e = out.get(a) ?? out.set(a, { n: 0, t: h.t }).get(a)
		e.n++
		if (h.t < e.t) e.t = h.t
	}
	return out
}
/** The run's contacts between different items, from every impact the engine logged (not only the first 16 pairs the summary keeps; the table,
 *  the walls and an item's own parts left out): Map "a|b" -> {a, b, t (the first), speed (the hardest)}. */
export function contactPairs(sim, scene = null) {
	const out = new Map()
	const typeOf = new Map((scene?.items ?? []).map((i) => [i.id, i.type]))
	const scenery = (id) => id === undefined || id === null || id === "table" || /^wall-/.test(String(id)) || ["table", "wall"].includes(typeOf.get(id))
	const add = (a, b, t, speed) => {
		if (a === b || scenery(a) || scenery(b)) return
		const k = a < b ? `${a}|${b}` : `${b}|${a}`
		const e = out.get(k)
		if (!e) out.set(k, { a, b, t, speed: num(speed) ?? 0 })
		else ((e.t = Math.min(e.t, t)), (e.speed = Math.max(e.speed, num(speed) ?? 0)))
	}
	const itemOf = new Map((sim?.doc?.solids ?? []).map((s) => [s.id, s.item]))
	if (Array.isArray(sim?.track?.impacts) && itemOf.size) for (const h of sim.track.impacts) add(itemOf.get(h.a), itemOf.get(h.b), h.t, h.speed)
	else for (const e of sim?.summary?.events ?? []) add(e.a, e.b, e.t, e.speed)
	// (said the engine's way: the thing that moves strikes the one that stands; of two movers, the one that was moving first)
	const moves = new Set((sim?.doc?.solids ?? []).filter((s) => s.kind === "dynamic").map((s) => s.item))
	const startAt = new Map((sim?.summary?.stories ?? []).map((st) => [st.item, st.moved_at ?? Infinity]))
	for (const e of out.values()) {
		const ma = moves.has(e.a) ? startAt.get(e.a) ?? 1e9 : Infinity
		const mb = moves.has(e.b) ? startAt.get(e.b) ?? 1e9 : Infinity
		if (mb < ma) [e.a, e.b] = [e.b, e.a]
	}
	return out
}
/** Contacts at least this hard (m/s) count as a hit that is new or gone after an edit (the engine logs from 0.2 m/s: a graze at the edge is noise). */
const HIT_FIRM = 0.3
/**
 * How an edit changed the run beyond what it changed itself (a quick edit must change none of it): for the things the edit left as they were
 * (same type, settings and place, a shift of the whole layout aside), hits that are new or gone; and the goals whose measure got worse or better
 * ("All ten pins fall: 9 → 0 of 10 fell"). before/after: runs with doc + track; sceneA/B: the scenes they ran; goals: the plan's goals as solved.
 * -> {contacts: [words], worse: [words], better: [words]}
 */
export function runChanges(before, after, sceneA, sceneB, goals = null) {
	const out = { contacts: [], worse: [], better: [] }
	if (!before || !after) return out
	const A = new Map((sceneA?.items ?? []).map((i) => [i.id, i]))
	const B = new Map((sceneB?.items ?? []).map((i) => [i.id, i]))
	// (the solver may shift the whole layout to keep it on the table: an item moved by that same amount is as it was)
	const shifts = new Map()
	for (const [id, b] of B) {
		const a = A.get(id)
		if (!a || a.type === "table") continue
		const k = `${Math.round(((Number(b.x) || 0) - (Number(a.x) || 0)) * 2000)}|${Math.round(((Number(b.y) || 0) - (Number(a.y) || 0)) * 2000)}`
		shifts.set(k, (shifts.get(k) ?? 0) + 1)
	}
	const shift = [...shifts].sort((p, q) => q[1] - p[1])[0]?.[0] ?? "0|0"
	const [sx, sy] = shift.split("|").map((v) => Number(v) / 2000)
	const same = (id) => {
		const a = A.get(id)
		const b = B.get(id)
		if (!a || !b || a.type !== b.type || !!a.held !== !!b.held || !!a.fixed !== !!b.fixed) return false
		// (a prop left out is its default: the app and the solver may write the same item's props differently)
		for (const k of new Set([...Object.keys(a.props ?? {}), ...Object.keys(b.props ?? {})])) if (!sameValue(propValue(a, k), propValue(b, k))) return false
		if (Math.abs((Number(a.angle) || 0) - (Number(b.angle) || 0)) > 0.05) return false
		const dx = (Number(b.x) || 0) - (Number(a.x) || 0)
		const dy = (Number(b.y) || 0) - (Number(a.y) || 0)
		return (Math.abs(dx) < 0.0005 && Math.abs(dy) < 0.0005) || (Math.abs(dx - sx) < 0.0005 && Math.abs(dy - sy) < 0.0005)
	}
	const nameIn = (M, id) => M.get(id)?.name ?? typeName(M.get(id)?.type) ?? id
	const ca = contactPairs(before, sceneA)
	const cb = contactPairs(after, sceneB)
	for (const [k, e] of cb) if (!ca.has(k) && e.speed >= HIT_FIRM && same(e.a) && same(e.b)) out.contacts.push(`${nameIn(B, e.a)} now hits ${nameIn(B, e.b)} (at ${Number(e.t).toFixed(2)} s)`)
	for (const [k, e] of ca) if (!cb.has(k) && e.speed >= HIT_FIRM && same(e.a) && same(e.b)) out.contacts.push(`${nameIn(A, e.a)} no longer hits ${nameIn(A, e.b)}`)
	if (Array.isArray(goals)) {
		const ra = goalResults(before, goals)
		const rb = goalResults(after, goals)
		for (const g of rb) {
			const w = ra.find((x) => x.label === g.label)
			if (!w) continue
			if (g.kind === "falls" && Number.isFinite(w.fallen) && Number.isFinite(g.fallen) && g.fallen !== w.fallen)
				(g.fallen < w.fallen ? out.worse : out.better).push(`${g.label}: ${w.fallen} → ${g.fallen} of ${g.of} fell`)
			else if (g.kind === "moves" && Number.isFinite(w.moved_m) && Number.isFinite(g.moved_m) && Math.abs(g.moved_m - w.moved_m) > Math.max(0.02, 0.2 * Math.abs(w.moved_m)))
				(g.moved_m < w.moved_m ? out.worse : out.better).push(`${g.label}: ends ${fmtLen(w.moved_m)} → ${fmtLen(g.moved_m)} from its start`)
			else if (w.ok !== g.ok && (w.ok === true || g.ok === true)) (g.ok === true ? out.better : out.worse).push(`${g.label}: ${g.ok === true ? "now met" : "no longer met"}`)
		}
	}
	out.contacts = out.contacts.slice(0, 6)
	return out
}
/** What the run shows did not work: goals not met (with what the run shows: "4 of 40 tipped over"), rows that stop part way. */
export function runProblems(sim, goals = null) {
	const s = sim?.summary ?? {}
	const out = []
	for (const g of goalResults(sim, goals)) if (g.ok === false) out.push(`Not met: ${g.label}${g.kind !== "in" && g.detail ? ` (${g.detail})` : ""}`)
	for (const st of s.stories ?? []) {
		const c = fallCount(sim, st)
		if (c && c.k < c.n) out.push(`${st.name}: only ${c.k} of ${c.n} fall`)
	}
	return out
}
/**
 * How many of a row's parts fell, counted the way a "falls" goal counts them (./goals.js on the whole run: tipped past 45° or knocked down), so
 * the story, "What didn't work" and the goal never disagree (the engine's own story count, a domino turned past 57°, called a cascade of
 * dominoes leaning on each other at 50° "1 of 8 fall" next to a met goal "8 of 8"); the story's count only when the run has no track.
 * -> {k, n} or null (not a row).
 */
function fallCount(sim, st) {
	const m = /^(\d+) of (\d+) fall$/.exec(st?.text ?? "")
	if (!m) return null
	if (sim?.doc?.solids && sim?.track?.frames?.length && st.item) {
		try {
			const [g] = checkGoals([{ kind: "falls", items: [st.item], label: "x" }], sim)
			if (g && Number.isFinite(g.fallen) && Number.isFinite(g.of) && g.of > 0) return { k: g.fallen, n: g.of }
		} catch {}
	}
	return { k: Number(m[1]), n: Number(m[2]) }
}
/** The run's summary with each row's "N of M fall" counted as the goals count it (fallCount): the critic is never told two numbers for one row. */
function reconciledSummary(sim) {
	const s = sim?.summary
	if (!s || !Array.isArray(s.stories)) return s
	return {
		...s,
		stories: s.stories.map((st) => {
			const c = fallCount(sim, st)
			return c && `${c.k} of ${c.n} fall` !== st.text ? { ...st, text: `${c.k} of ${c.n} fall`, ok: c.k === c.n } : st
		})
	}
}
const fallText = (sim, st) => {
	const c = fallCount(sim, st)
	return c ? `${c.k} of ${c.n} fall` : st?.text
}
/** How far each mover got (a row: how many fell; anything else: moved or turned or not). */
const progressOf = (st, sim = null) => {
	const c = fallCount(sim, st)
	return c ? c.k : st?.ok ? 1 : 0
}
/** Stages that worked in run a and no longer do in run b (items removed in b don't count): ["Dominoes: 3 of 12 fall (was 12 of 12)", "Car no longer moves"]. */
export function lostStages(a, b, sceneB = null) {
	const there = sceneB ? new Set(sceneB.items.map((i) => i.id)) : null
	const B = new Map((b?.summary?.stories ?? []).map((st) => [st.item, st]))
	const out = []
	for (const st of a?.summary?.stories ?? []) {
		if (there && !there.has(st.item)) continue
		const pa = progressOf(st, a)
		if (pa <= 0) continue
		const nb = B.get(st.item)
		if (progressOf(nb, b) >= pa) continue
		out.push(/fall$/.test(nb?.text ?? "") ? `${st.name}: ${fallText(b, nb)} (was ${fallText(a, st)})` : `${st.name} no longer ${/^turns/.test(st.text) ? "turns" : "moves"}`)
	}
	return out
}
/** For the critic: how the run changed with the last changes (hits lost and new, goals that flipped). [] when nothing changed. */
export function runDiff(a, b) {
	const key = (e) => `${e.a}>${e.b}`
	const ea = new Map((a?.summary?.events ?? []).map((e) => [key(e), e]))
	const eb = new Map((b?.summary?.events ?? []).map((e) => [key(e), e]))
	const lost = [...ea].filter(([k]) => !eb.has(k)).map(([, e]) => `${e.text} (was at ${Number(e.t).toFixed(2)} s)`)
	const gained = [...eb].filter(([k]) => !ea.has(k)).map(([, e]) => `${e.text} (at ${Number(e.t).toFixed(2)} s)`)
	const gA = new Map((a?.summary?.goals ?? []).map((g) => [g.label, g.ok]))
	const flips = (b?.summary?.goals ?? []).filter((g) => gA.has(g.label) && gA.get(g.label) !== g.ok).map((g) => `${g.label}: now ${g.ok ? "MET" : "FAILED"}`)
	const parts = []
	if (lost.length) parts.push(`no longer happens: ${lost.slice(0, 6).join("; ")}`)
	if (gained.length) parts.push(`new: ${gained.slice(0, 6).join("; ")}`)
	if (flips.length) parts.push(`goals: ${flips.join("; ")}`)
	return parts.length ? [`compared with the version before the last changes: ${parts.join(". ")}`] : []
}
// ================================================================ picture fidelity: is everything the pictures show accounted for?
const MULTI_UNIT = { "domino-row": "count", "newtons-cradle": "count" }
/** One word's singular, roughly ("dominoes" → "domino", "boxes" → "box", "bricks" → "brick"). */
const stem = (w) => (/ies$/.test(w) ? w.slice(0, -3) + "y" : /(oes|xes|ses|ches|shes)$/.test(w) ? w.slice(0, -2) : /[^s]s$/.test(w) ? w.slice(0, -1) : w)
const normLabel = (t) => String(t ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").map(stem).join(" ")
const LOOSE = new Set(["the", "a", "an", "of", "on", "in", "with", "and", "small", "large", "big", "little", "tall", "short", "long", "wide", "thin", "red", "blue", "green", "yellow", "white", "black", "brown", "grey", "gray", "orange", "pink", "purple", "wooden", "wood", "metal", "plastic", "glass", "steel", "paper", "left", "right", "top", "bottom", "front", "back", "upper", "lower", "first", "second", "third", "one", "two", "three"])
const words = (t) => normLabel(t).split(" ").filter((w) => w.length > 2 && !LOOSE.has(w))
/** How many things an item makes (a domino row: its count; anything else: 1). */
function unitsOf(it) {
	const k = MULTI_UNIT[it?.type]
	if (!k) return 1
	const v = num(it.props?.[k]) ?? num(propSpec(it.type, k)?.default)
	return v !== null ? Math.max(1, Math.round(v)) : 1
}
/**
 * The observation's objects against the plan, deterministically: each object must be built (plan.covers names the items, else an item whose
 * name, type or reason shares a word with it), listed as missing, or explained by a covers note; a seen count must be the count built.
 * -> {checked, objects, gaps: [{kind: "absent" | "count", label, seen, built?, ids?}]}
 */
export function coverage(observation, plan) {
	const objs = (Array.isArray(observation?.objects) ? observation.objects : []).filter((o) => isObj(o) && typeof o.label === "string" && o.label.trim())
	if (!objs.length || !Array.isArray(plan?.items)) return { checked: false, objects: 0, gaps: [] }
	const items = new Map(plan.items.filter(isObj).map((it) => [it.id, it]))
	const covers = new Map((Array.isArray(plan.covers) ? plan.covers : []).filter(isObj).map((c) => [normLabel(c.label), c]))
	const missingText = (Array.isArray(plan.missing) ? plan.missing : []).filter(isObj).map((m) => normLabel(`${m.asked ?? ""} ${m.reason ?? ""}`))
	const mentioned = (label) => {
		const n = normLabel(label)
		return missingText.some((m) => m.includes(n) || words(label).some((w) => m.includes(w)))
	}
	const gaps = []
	for (const o of objs) {
		const seen = Number.isInteger(o.count) && o.count > 0 ? o.count : 1
		const c = covers.get(normLabel(o.label))
		const note = typeof c?.note === "string" && c.note.trim() !== ""
		let ids
		if (c && Array.isArray(c.ids)) ids = c.ids.filter((id) => items.has(id))
		else {
			// no covers entry: an item whose name, type or reason shares a meaningful word with the label
			const ws = words(o.label)
			ids = ws.length ? [...items.values()].filter((it) => ws.some((w) => normLabel(`${it.name ?? ""} ${it.type} ${typeName(it.type)} ${it.why ?? ""} ${it.id}`).split(" ").includes(w))).map((it) => it.id) : []
		}
		if (!ids.length) {
			if (!note && !mentioned(o.label)) gaps.push({ kind: "absent", label: o.label, seen })
			continue
		}
		// a count is checked only where the items that build it are known (covers): a loose word match can't count
		if (c && !note && seen > 1) {
			const built = ids.reduce((n, id) => n + unitsOf(items.get(id)), 0)
			if (built !== seen) gaps.push({ kind: "count", label: o.label, seen, built, ids })
		}
	}
	return { checked: true, objects: objs.length, gaps }
}
/** The gaps as one plain request for the edit step (it answers with patches against the plan). */
const reconcileRequest = (gaps) =>
	`Correction (not a new request): make the scene match the reference picture. ${gaps
		.map((g) =>
			g.kind === "absent"
				? `The picture shows ${g.seen > 1 ? `${g.seen} × ` : ""}"${g.label}", which nothing in the scene builds: build it from the catalog where the picture shows it, or, if the library has nothing for it, say so in "missing".`
				: `The picture shows ${g.seen} "${g.label}" but the scene builds ${g.built} (${g.ids.join(", ")}): build ${g.seen}, as separate items (or a group type of that count), at the places the picture shows.`
		)
		.join(" ")} Keep everything else exactly as it is. Reply in one short sentence saying what you changed.`
/** The gaps in words for the report: "the inclined board was not built", "3 of the 5 bricks were built". */
const gapWords = (g) => (g.kind === "absent" ? `“${g.label}”${g.seen > 1 ? ` (×${g.seen})` : ""} was not built` : `${g.built} of the ${g.seen} “${g.label}” were built`)
/** Words in the plan that say it was laid out mirror-image to the picture (the one difference a viewer sees first). */
// (only words about the layout being turned over: "a row falls left to right" is how a chain runs, not a mirrored picture)
const MIRROR_RE = /\b(mirror(ed|s|ing)?|flipped( (left|over|round|around|horizontally))?|reversed (left|the (layout|picture|photo|scene|order))|the other way round|swapped (sides|left and right)|(laid out|built|placed|set up|arranged) (from )?right[- ]to[- ]left)\b/i

/** Things the solver says float, or are pierced by a leg (a static cup, funnel or ramp in mid-air): the picture shows them. */
const floatingIn = (v) => v.solved.issues.filter((i) => FLOAT_CODES.includes(i.code))
/** An edit that asks for the result to be checked (or made to work) gets the critic even when it is simple. */
const CHECK_RE = /\b(check|verify|make sure|make (it|this|that|them) work|does (it|this) work|fix|so that|until|still works?|goal)\b/i
/**
 * A request that states an outcome ("…so it still lands in the box", "make it work", "fix it", "add a ball that rolls into the cup"): its edit is
 * made to work too (the fix search runs as part of it). Any other edit does exactly what was asked, and when that stops a goal the reply says
 * so and offers a checked fix.
 */
export const OUTCOME_RE = /\b(make (it|this|that|them|everything|the \w+( \w+)?) (work|happen|land|go)|make (all|every|both)( of)?( the)? \w+( \w+)? (fall|land|topple|work|go in)|works? (again|still)|still (works?|working|lands?|landing|goes|going|falls?|falling|hits?|catch(es)?|knocks?)|so (that )?(it|they|the \w+( \w+)?|ball \d+) (still )?(lands?|goes|ends?|falls?|hits?|works?|reach(es)?|knocks?|catch(es)?|rolls?)|keep (it|them|everything|the \w+( \w+)?) (working|landing|going in|falling|hitting)|without breaking|fix( it| this| that)?\b(?!( (the |a |an )?\w+( \w+)?)? (to|onto|in place|on|down)\b)|until (it|they)|lands? in(to)?|landing in|land in|goes in(to)?|ends? (up )?in|rolls? into|drops? into|falls? into|make sure (that )?(it|they|everything|the \w+( \w+)?)( all| both)?( still)? (lands?|land|goes|go|falls?|fall|works?|work|hits?|hit|ends?|end|reach(es)?|knocks?|catch(es)?|rolls?|drops?)|catch(es)? (it|the))/i
export const statesOutcome = (text) => OUTCOME_RE.test(String(text ?? ""))

// ---- what a plain edit is about (the user, 2026-10-15: "the edit isn't automatically supposed to have it work - that's not how physics works.
// the assistant is supposed to tell you ok hey i made the change but it doesn't work now, want me to fix it?"): the things it names, and what
// rides on them. The edit step sometimes re-tunes other things to keep a goal working; that is put back, and the app offers a checked fix.
const HEAD_SKIP = new Set(["ball", "wall", "item", "thing", "part", "piece", "side", "end", "top", "one", "the"])
/** The things a request names, by name, kind or id ("the launcher" for the spring launcher, "the dominoes" for the row): Set of ids. A word
 *  that names one of several ("ramp", beside "ramp 1") counts only when no fuller name in the request already says which. */
export function namedIn(text, scene) {
	const t = ` ${normLabel(text)} `
	const has = (p) => !!p && t.includes(` ${p} `)
	const items = (scene?.items ?? []).filter((i) => i.type !== "table" && !isSafetyWall(i))
	const full = new Map()
	const heads = new Map()
	for (const it of items) {
		const ph = [it.name, typeName(it.type), String(it.id ?? "").replace(/[-_]+/g, " ")].map(normLabel).filter(Boolean)
		full.set(it.id, ph)
		heads.set(it.id, [...new Set(ph.map((p) => p.split(" ").filter((w) => /^\p{L}{3,}$/u.test(w) && !HEAD_SKIP.has(w)).at(-1)).filter(Boolean))])
	}
	const out = new Set(items.filter((it) => full.get(it.id).some(has)).map((i) => i.id))
	const said = new Set([...out].flatMap((id) => heads.get(id)))
	for (const it of items) if (!out.has(it.id) && heads.get(it.id).some((h) => has(h) && !said.has(h))) out.add(it.id)
	return out
}
// (words that pick a thing out some other way, by its colour or its place in the chain, or that ask about everything: the request can't be
// held to the names in it)
const DESCRIBE_RE = /\b(red|orange|yellow|green|blue|purple|violet|pink|white|black|grey|gray|brown|silver|golden|first|second|third|fourth|fifth|last|other|both|each|every|all|everything|whole|machine|layout|things|stuff)\b/i
// (a request for a behaviour, "make Ball 2 fly higher", is about how the run goes: whatever does that may change)
const BEHAVIOR_RE = /\b(fly|flies|flying|roll|rolls|rolling|bounce|bounces|travel|travels|reach|reaches|launch(es)?|spin|spins|land|lands|go|goes|hit|hits|knock|knocks|topple|topples|swing|swings|fall|falls|arrive|arrives)\b[^.;,]{0,30}\b(higher|lower|further|farther|faster|slower|harder|softer|more|less|longer|shorter|earlier|later|sooner|gentl[ey]r?)\b/i
// (words that ask for a thing's place: a named thing's move is then asked for)
const PLACE_RE = /\b(move[sd]?|moving|shift(s|ed)?|slide|raise[sd]?|lower(s|ed)?|lift|drop|higher|up|down|left|right|nearer|closer to|(further|farther) (from|away|left|right|up|down|along|back)|position|put|place|push|cent(er|re)|align|line (it |them )?up|rotate|turn|tilt(ed)?|steep(er)?|flat(ter)?|slope|incline|angle|level|upright|flip|mirror|over|under|above|below|next to|beside|onto|on top)\b/i
// (words that ask for the run's length)
const TIME_RE = /\b(seconds?|secs?|\d+(\.\d+)?\s*s|duration|run(s|ning)? (for|longer|shorter)|(longer|shorter) (run|time|simulation)|run ?time|run length|time)\b/i
/** A plain edit's scope: {named, asked (named and what rides on them), placeAsked, timeAsked}, or null when the request can't be held to its
 *  names (it states an outcome or a behaviour, picks things out by colour or order, or names nothing in the scene). */
export function editScope(text, scene) {
	const t = String(text ?? "")
	if (!t.trim() || statesOutcome(t) || BEHAVIOR_RE.test(t) || DESCRIBE_RE.test(t)) return null
	const named = namedIn(t, scene)
	if (!named.size) return null
	let R = new Map()
	try {
		R = riderMap(scene)
	} catch {}
	return { named, asked: new Set([...named, ...[...named].flatMap((id) => R.get(id) ?? [])]), placeAsked: PLACE_RE.test(t), timeAsked: TIME_RE.test(t) }
}
/** A request that gives a number with a unit ("10 cm", "5°", "200 g"): what it set is exactly what was asked. */
const EXPLICIT_RE = /\d+(\.\d+)?\s*(mm|cm|m|meters?|metres?|°|deg(rees?)?|g|grams?|kg|%|percent|times|x)\b/i
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`
/** A list in a short phrase: all of it up to three, else the first two and how many more. */
const brief = (list) => (list.length <= 3 ? andList(list) : `${list.slice(0, 2).join("; ")} and ${list.length - 2} more`)
/** The highest score shown for a version whose run fails a stated goal (as the critic is told to score it). */
const GOAL_CAP = 7
/** The highest score shown for a version where things pass through each other (a leg through a ramp, a stand's pole through a shelf, posts
 *  among a cradle's balls): said by the solver, or by the critic itself (which tends to call it cosmetic and still say done). */
const PASS_CAP = 6
/** The solver's warnings for things placed through each other (the solver's own overlap check, web/sim's, a stand's pole or a held thing's post). */
const PASS_CODES = ["overlap", "stand_through"]
const passIn = (v) => v.solved.issues.filter((i) => i.level !== "info" && PASS_CODES.includes(i.code))
/** A critic's remark that something passes through something else, or that stray parts stand where they don't belong (not motion: "the
 *  marble passes through the funnel" is how it works, so a part that holds things up has to be named, or a word that only means it). */
const PASS_RE = /\b(legs?|poles?|posts?|rods?|stands?|dowels?|supports?|brackets?|frames?|pins?|uprights?)\b[^.;:]{0,50}\bthrough\b|\b(stick(s|ing)?|poke(s|d|ing)?|clip(s|ping)?) (up |down |out |straight |right )?(through|into)\b|\b(intersect(s|ing)?|interpenetrat\w*|embedded in|inside each other|through each other)\b|\boverlap(s|ping)? (with )?(the|each|one)\b|\bstray (parts?|posts?|dowels?|pieces?|rods?|legs?)\b/i
const PASS_NOT_RE = /\b(no|nothing|none|never|not|without|doesn['’]t|don['’]t|isn['’]t|aren['’]t|no longer)\b[^.;]{0,40}\b(through|overlap|intersect|inside each other|stray)/i
const passSaid = (issues) => issues.filter((t) => PASS_RE.test(t) && !PASS_NOT_RE.test(t))
/** Goals of a kind the scene does not carry itself (falls, hits, moves) that an edit added or dropped (the "in" ones show in describeDiff). */
function goalChanges(a, b, scene = null) {
	const other = (p) => (Array.isArray(p?.goals) ? p.goals : []).filter((g) => isObj(g) && g.kind && g.kind !== "in")
	return goalDiffLines(other(a), other(b), new Map((scene?.items ?? []).map((i) => [i.id, i])))
}
/** Where each moving item ends (the mean of its moving parts in the last frame): the critic is told, so it need not guess from impact times. */
function finalPositions(sim) {
	const frames = sim?.track?.frames
	if (!frames?.length || !sim.doc?.solids) return undefined
	const by = new Map()
	for (const s of sim.doc.solids) if (s.kind === "dynamic") (by.get(s.item) ?? by.set(s.item, []).get(s.item)).push(s.id)
	const out = []
	for (const [id, sids] of by) {
		let n = 0
		let x = 0
		let y = 0
		for (const sid of sids) {
			for (let k = frames.length - 1; k >= 0; k--) {
				const p = frames[k].placements?.[sid]
				if (p) {
					x += p.x
					y += p.y
					n++
					break
				}
			}
		}
		if (n) out.push({ id, x: Math.round((x / n) * 1000) / 1000, y: Math.round((y / n) * 1000) / 1000 })
		if (out.length >= 60) break
	}
	return out
}
/** After a picture fix: the items it added are counted under the objects they were added for (same type as that object's items, or a
 *  shared word), so the coverage check sees them. */
function extendCovers(plan, before, gaps) {
	const had = new Set((before?.items ?? []).map((i) => i.id))
	const added = (plan.items ?? []).filter((i) => isObj(i) && !had.has(i.id))
	if (!added.length) return
	plan.covers = (Array.isArray(plan.covers) ? plan.covers : []).map((c) => ({ ...c, ids: Array.isArray(c.ids) ? [...c.ids] : [] }))
	for (const g of gaps) {
		let c = plan.covers.find((x) => normLabel(x.label) === normLabel(g.label))
		const types = new Set((g.ids ?? []).map((id) => plan.items.find((i) => i.id === id)?.type).filter(Boolean))
		const ws = words(g.label)
		const mine = added.filter((it) => types.has(it.type) || ws.some((w) => normLabel(`${it.name ?? ""} ${it.type} ${typeName(it.type)} ${it.id}`).split(" ").includes(w)))
		if (!mine.length) continue
		if (!c) plan.covers.push((c = { label: g.label, ids: [] }))
		for (const it of mine) if (!c.ids.includes(it.id)) c.ids.push(it.id)
	}
}
const SEVERITY = { high: 3, medium: 2, low: 1 }
/** The solver's warnings for things the picture shows unsupported: floating in mid-air, an end hanging, a leg through something. */
const FLOAT_CODES = ["floats", "floats_end", "leg_through"]
const secsWords = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60000)} min${ms % 60000 >= 1000 ? ` ${Math.round((ms % 60000) / 1000)} s` : ""}`)
/** Why a model step failed, in a few words for a notice: "the AI was busy", "it took too long". */
const whyFailed = (e) => (e?.kind === "busy" ? "the AI was busy" : e?.kind === "timeout" ? "it took too long" : e?.kind === "invalid" ? "the AI's answer didn't fit" : "the AI service failed")

// ================================================================ the pipeline
/** Waits between tries while every AI slot on the server is taken (429 busy: the server has already queued the step for up to 90 s), unless
 *  the server says how long (Retry-After). A build is never failed for being busy: it waits until a slot is free or it is cancelled. */
const BUSY_WAITS = [2000, 4000, 8000, 15000, 20000, 30000]
const PROGRESS_EVERY = 1500
/**
 * deps: {api(path, body, signal), shot?: {render(sim, opts) -> [{label, t, dataUrl, width, height}]}, simulate?(scene, signal), log?,
 *        progress? (poll GET /api/ai/progress?id= while a step runs: default on in a browser), busyLimitMs? (default: no limit)}
 */
export function createOrchestrator(deps) {
	const api = deps.api
	const simulate = deps.simulate ?? ((scene, signal) => api("/api/simulate", { scene }, signal))
	const pollProgress = deps.progress ?? (typeof document !== "undefined")
	const busyLimit = num(deps.busyLimitMs) ?? Infinity
	let progressWorks = null // null: not known yet; false: this server has no progress endpoint (a static deploy)
	let progressMisses = 0 // failed asks in a row (across steps) while it is not known to work

	/**
	 * Where a running step is, from the server (GET /api/ai/progress?id=<requestId>, every 1.5 s): its place in the queue for an AI slot, or
	 * the model's attempt and how much it has thought and written so far. -> stop()
	 */
	function watch(step, requestId, onEvent, t0) {
		if (!pollProgress || progressWorks === false || !onEvent) return () => {}
		let stopped = false
		let timer = 0
		const tick = async () => {
			if (stopped) return
			try {
				const p = await api(`/api/ai/progress?id=${encodeURIComponent(requestId)}`)
				if (stopped) return
				if (p && p.ok !== false && p.state) {
					progressWorks = true
					progressMisses = 0
					onEvent({ type: "ai-progress", step, state: p.state, position: num(p.position), model: p.model ?? null, attempt: num(p.attempt), repair: !!p.repair, phase: p.phase ?? null, tokens: num(p.tokens), elapsedMs: Math.round(now() - t0) })
				}
			} catch (e) {
				// the server's own "no such AI request": the step is not registered yet (its upload is still on its way) or just finished: ask again.
				// Anything else a few times in a row (a static deploy has no such endpoint): stop, and don't ask again this session.
				if (/no such AI request/i.test(e?.body?.error ?? "")) progressWorks = progressWorks ?? true
				else if (++progressMisses >= (progressWorks ? 6 : 3)) {
					if (!progressWorks) progressWorks = false
					return
				}
			}
			if (!stopped) timer = setTimeout(tick, PROGRESS_EVERY)
		}
		timer = setTimeout(tick, 900)
		return () => {
			stopped = true
			clearTimeout(timer)
		}
	}

	/**
	 * One model step: POST /api/ai/<step>. While the server's AI slots are all busy (429) it waits and tries again (the server's Retry-After, else
	 * 2, 4, 8, 15, 20, 30 s), telling onEvent ({type: "wait", step, state: "start" | "end", ms, attempt, waitedMs}); cancel stops the wait at once.
	 * Busy never fails the build (unless deps.busyLimitMs says so). Any other failure worth retrying gets one more try after a short wait; a step
	 * that ran out of its whole budget on the server is not tried again (it would take as long again).
	 */
	async function call(step, payload, signal, report, onEvent = null) {
		const size = JSON.stringify(payload).length
		if (size > MAX_BODY) throw new AiError("input", `The request is too large (${(size / 1048576).toFixed(1)} MB; 12 MB at most): use fewer or smaller images`, { step })
		let lastErr
		let busyN = 0
		let busyMs = 0
		let tries = 0
		const t00 = now()
		for (let attempt = 0; ; attempt++) {
			const ctl = new AbortController()
			const onAbort = () => ctl.abort()
			signal?.addEventListener("abort", onAbort, { once: true })
			const timer = setTimeout(() => ctl.abort(new AiError("timeout", "timed out")), STEP_TIMEOUT[step] ?? 180000)
			const t = now()
			const requestId = rid()
			const stopWatch = watch(step, requestId, onEvent, t00)
			let wait = 0
			try {
				const r = await raceAbort(api(`/api/ai/${step}`, { payload, client: { requestId, attempt } }, ctl.signal), ctl.signal)
				if (!r || r.ok === false) throw Object.assign(new Error(r?.error ?? "no answer"), { body: r })
				report.calls.push({ step, model: r.model ?? null, ms: r.ms ?? Math.round(now() - t), usage: r.usage ?? null, attempt, waitedMs: busyMs || undefined })
				return r.result ?? r
			} catch (e) {
				if (signal?.aborted) throw abortError()
				const body = e?.body
				const timedOut = ctl.signal.aborted
				const status = e?.status ?? 0
				const code = body?.code
				if (!timedOut && (code === "busy" || status === 429)) {
					// (the server's own estimate first: retryAfterMs from its step timings, ai/DESIGN.md §13.1; else Retry-After)
					const ra = num(body?.retryAfterMs) !== null ? num(body.retryAfterMs) / 1000 : num(e?.retryAfter ?? body?.retryAfter ?? body?.retry_after)
					wait = Math.min(60000, ra !== null ? Math.max(500, ra * 1000) * (busyN >= 3 ? 2 : 1) : BUSY_WAITS[Math.min(busyN, BUSY_WAITS.length - 1)])
					wait = Math.round(wait * (0.85 + Math.random() * 0.3)) // (jitter: builds that were turned away together don't all come back at once)
					if (busyMs + wait > busyLimit) throw new AiError("busy", `Every AI slot stayed busy for ${secsWords(busyMs)} (other builds are using them): try again in a minute`, { step, retryable: true, cause: e })
				} else {
					const retryable = timedOut || code === "timeout" || code === "budget" ? false : body?.retryable === true || ((status === 0 || status >= 500) && body?.retryable !== false)
					lastErr = timedOut || code === "timeout" || code === "budget" || status === 504
						? new AiError("timeout", `The ${step} step took too long and was stopped`, { step, retryable: true })
						: code === "bad_input" || status === 400 || status === 413
							? new AiError("input", plainError(e?.message ?? String(e), step), { step, retryable: false, cause: e })
							: status === 404
								? new AiError("gateway", "The AI service isn't available on this server yet", { step, retryable: false, cause: e })
								: new AiError(code === "invalid_output" || (!code && /invalid|schema/i.test(e?.message ?? "")) ? "invalid" : "gateway", plainError(e?.message ?? String(e), step), { step, retryable, cause: e })
					if (!retryable || tries >= 1) throw lastErr
					tries++
				}
			} finally {
				stopWatch()
				clearTimeout(timer)
				signal?.removeEventListener("abort", onAbort)
			}
			if (wait) {
				busyN++
				busyMs += wait
				onEvent?.({ type: "wait", step, state: "start", ms: wait, attempt: busyN, waitedMs: busyMs })
				await sleep(wait, signal)
				onEvent?.({ type: "wait", step, state: "end" })
			} else await sleep(RETRY_DELAY, signal)
		}
	}

	/**
	 * request = {text, images: prepared images (prepareImages), mode: "new" | "edit" | "check", scene (the scene on screen, for edit and check),
	 *            plan (the plan that made it, when the scene is still as the AI left it), planScene, history: [{role, text}] (earlier turns, for edit),
	 *            sim (the run of the scene on screen, for edit: which goals worked before the change)}
	 *   "check": no planning; the scene on screen is checked again (refineRounds rounds, 1 by default) and the final version rated.
	 * opts = {onEvent, refineRounds, tune: bool, finalCheck: bool, reconcile: bool (picture coverage fix, default on), quickEdits: bool (default on)}
	 *   onEvent({type: "step", step, state: "active" | "done" | "skipped" | "error" | "cancelled", label, ms, detail})
	 *   onEvent({type: "draft", scene, sim: null, stage: "layout", label}): the first version is placed (shown at once, before its run)
	 *   onEvent({type: "draft", sim, scene, label}): a version that ran (the first one, each one a check kept, the tuned one): show it while the rest works
	 *   onEvent({type: "wait", step, state: "start" | "end", ms, attempt, waitedMs}): waiting for a free AI slot (turned away: tries again after ms)
	 *   onEvent({type: "ai-progress", step, state: "waiting" | "running" | "done", position, model, attempt, phase, tokens, elapsedMs}): the server's
	 *     word on a running step (its place in the queue, or how much the model has thought and written)
	 *   onEvent({type: "progress", step: "tune", runs, max, passed})
	 */
	function build(request, opts = {}) {
		const ctl = new AbortController()
		const signal = ctl.signal
		const onEvent = opts.onEvent ?? (() => {})
		const result = run(request, { ...opts, onEvent, signal })
		return { cancel: () => ctl.abort(), result, signal }
	}

	async function run(request, { onEvent, signal, refineRounds, tune: doTune = true, finalCheck = true, reconcile: doReconcile = true, quickEdits = true }) {
		const T0 = now()
		const text = String(request.text ?? "").trim()
		const images = (request.images ?? []).slice(0, MAX_IMAGES)
		const mode = request.mode === "check" && request.scene ? "check" : request.mode === "edit" && request.scene ? "edit" : "new"
		refineRounds = Math.max(0, Math.round(num(refineRounds) ?? (mode === "check" ? 1 : REFINE_ROUNDS)))
		if (!text && !images.length && mode !== "check") throw new AiError("input", "Describe the scene, or add a picture of it")
		const report = { id: rid(), request: text, images: images.map((im) => ({ name: im.name, thumb: im.thumb, width: im.width, height: im.height })), mode, startedAt: Date.now(), timings: {}, calls: [], steps: [], refine: [], tune: null, issues: [] }
		const timed = async (step, detail, fn, label) => {
			const t = now()
			onEvent({ type: "step", step, state: "active", label: label ?? STEP_LABELS[step], detail })
			try {
				const out = await fn()
				const ms = Math.round(now() - t)
				report.timings[step] = (report.timings[step] ?? 0) + ms
				report.steps.push({ step, label: label ?? STEP_LABELS[step], ms })
				onEvent({ type: "step", step, state: "done", label: label ?? STEP_LABELS[step], ms })
				return out
			} catch (e) {
				onEvent({ type: "step", step, state: signal.aborted ? "cancelled" : "error", label: label ?? STEP_LABELS[step], ms: Math.round(now() - t), error: e?.message })
				throw e
			}
		}
		const check = () => {
			if (signal.aborted) throw abortError()
		}
		const say = (level, code, words) => report.issues.push({ level, code, text: words })
		// (`as`: the timeline step a call belongs to, when it is not its own: the picture fix is an edit call shown as "reconcile")
		const callStep = (step, payload, as = step) => call(step, payload, signal, report, as === step ? onEvent : (e) => onEvent(e.step === step ? { ...e, step: as } : e))
		const G = (v) => v.solved?.goals ?? null // a version's goals, as solved (every kind)

		// ---- 1. observe (a new scene from pictures; an edit sends its pictures to the edit step itself)
		let observation = null
		const refs = images.map((im) => wireImage(im))
		if (images.length && mode === "new") {
			observation = await timed("observe", `${images.length} image${images.length === 1 ? "" : "s"}`, () => callStep("observe", { text, images: refs }))
			report.observation = observation
			// what the picture shows, said at once (planning takes a while longer): "3 × domino, ramp, steel ball"
			const seen = (Array.isArray(observation?.objects) ? observation.objects : []).filter((o) => isObj(o) && typeof o.label === "string").map((o) => (Number.isInteger(o.count) && o.count > 1 ? `${o.count} × ${o.label}` : o.label))
			if (seen.length) onEvent({ type: "observed", objects: seen, summary: typeof observation?.summary === "string" ? observation.summary : null })
		} else onEvent({ type: "step", step: "observe", state: "skipped" })
		check()

		// ---- 2. plan, the edit of the plan on screen, or (check) the plan on screen as it is
		let plan
		let editOut = null
		let scope = null // (a plain edit: the things it names, editScope)
		const leftAlone = [] // (what the edit step changed beyond them, put back)
		const madeRoom = new Set() // (what was moved only to make room for the change)
		const basePlan = mode !== "new" ? (request.plan && sameScene(request.planScene, request.scene) ? clone(request.plan) : planFromScene(request.scene)) : null
		if (mode === "check") {
			plan = basePlan
			if (!plan.title) plan.title = request.scene?.name ?? "Scene"
			onEvent({ type: "step", step: "plan", state: "skipped" })
		} else if (mode === "edit") {
			// (intent "edit": the scene on screen is changed, never replaced; an answer that it is a different scene comes back as such: ai/DESIGN.md §13.8)
			// (with the run of the scene on screen: which goals happen now and where things end, which "make it work again" needs: §13.8 (5))
			const simNow = request.sim?.summary ? { summary: reconciledSummary(request.sim), warnings: (request.sim.warnings ?? []).slice(0, 24), final: finalPositions(request.sim) } : undefined
			const out = await timed("edit", null, () => callStep("edit", { text, scene: request.scene, plan: basePlan, images: refs, history: (request.history ?? []).slice(-20), intent: "edit", ...(simNow ? { sim: simNow } : {}) }))
			editOut = isObj(out) ? out : {}
			const reply = typeof out?.reply === "string" ? out.reply : typeof out?.summary === "string" ? out.summary : null
			// a different scene altogether ("start over with a catapult"): an edit never replaces the scene on screen. Nothing is changed; the
			// reply says so and the panel offers to build it as a new scene (New → Build with AI)
			const realIds = (request.scene.items ?? []).filter((i) => i.type !== "table" && !isSafetyWall(i)).map((i) => i.id)
			const wholePlan = isObj(out?.plan) && Array.isArray(out.plan.items) ? out.plan : isObj(out) && Array.isArray(out.items) ? out : null
			const keptOf = (pl) => realIds.filter((id) => pl.items.some((x) => isObj(x) && x.id === id)).length
			const refuseNew = () => {
				Object.assign(report, {
					replyOnly: true,
					suggestNew: true,
					reply: "That sounds like a whole new scene, so I left this one as it is: Edit with AI only changes the scene on screen. Want me to build it as a new scene?",
					planned: reply,
					title: request.scene?.name ?? "",
					missing: [],
					totalMs: Math.round(now() - T0)
				})
				report.models = [...new Set(report.calls.map((c) => c.model).filter(Boolean))]
				return report
			}
			if (isObj(out) && realIds.length && (out.mode === "new" || (wholePlan && keptOf(wholePlan) < Math.ceil(realIds.length / 2)))) return refuseNew()
			// a question that needs no change, or "put it back": the answer, and nothing rebuilt (undo: the app's own Undo does it)
			if (isObj(out) && !out.plan && !Array.isArray(out.items) && ((Array.isArray(out.patches) && !out.patches.length) || out.undo === true)) {
				Object.assign(report, { replyOnly: true, undo: out.undo === true, reply: reply ?? (out.undo ? "Use Undo to go back to the scene before." : "Nothing to change."), title: request.scene?.name ?? "", missing: Array.isArray(out.missing) ? out.missing : [], totalMs: Math.round(now() - T0) })
				report.models = [...new Set(report.calls.map((c) => c.model).filter(Boolean))]
				return report
			}
			let planChanges = []
			if (isObj(out) && Array.isArray(out.items)) plan = out
			else if (isObj(out?.plan) && Array.isArray(out.plan.items)) plan = out.plan
			else if (Array.isArray(out?.patches) || Array.isArray(out)) {
				const r = applyPatches(basePlan, Array.isArray(out) ? out : out.patches, request.scene)
				plan = r.plan
				planChanges = r.changes
				// what the edit asked for and couldn't be done: the user is told
				if (r.skipped.length) for (const t of r.skipped) say("warn", "patch_skipped", `Not done: ${t}`)
				for (const k of ["title", "missing", "notes", "goals", "tune", "assumptions", "differences"]) if (out[k] !== undefined) plan[k] = out[k]
			} else throw new AiError("invalid", "The AI's answer to that edit couldn't be used", { step: "edit", retryable: true })
			if (!plan.title) plan.title = basePlan.title
			// "fix it" / "make it work" on a scene whose plan has no knobs for a goal (a scene made by hand, the starter): the tuner gets the goal's
			// container to move (along the table; up and down too when it hangs or stands in the air), so it can find where the thing really lands
			if (CHECK_RE.test(text) && Array.isArray(plan.goals)) {
				plan.tune = Array.isArray(plan.tune) ? plan.tune : []
				for (const g of plan.goals) {
					if (!isObj(g) || (g.kind ?? "in") !== "in" || !g.container || plan.tune.some((k) => k.id === g.container)) continue
					const c = request.scene.items.find((i) => i.id === g.container)
					const pc = plan.items.find((i) => i.id === g.container)
					if (!c || !pc) continue
					plan.tune.push({ id: c.id, param: "x", min: Math.round(((Number(c.x) || 0) - 0.3) * 1000) / 1000, max: Math.round(((Number(c.x) || 0) + 0.3) * 1000) / 1000, why: "where the container stands decides whether it catches" })
					if (pc.place?.on === "air" && num(pc.place?.y_m) !== null) plan.tune.push({ id: c.id, param: "y", min: Math.max(0, pc.place.y_m - 0.15), max: pc.place.y_m + 0.15, why: "how high the hanging container is" })
				}
			}
			// patches that take most of the scene away and put other things in its place build a new scene, not a change of this one
			const addedN = plan.items.filter((x) => isObj(x) && !(basePlan.items ?? []).some((b) => b.id === x.id)).length
			if (realIds.length >= 2 && addedN > 0 && keptOf(plan) < Math.ceil(realIds.length * 0.4)) return refuseNew()
			// a plain change does what it names and nothing else: what the edit step re-tuned beyond that (often to keep a goal working) is put back.
			// The run then shows what the change really does, and the panel offers a checked fix ("the edit isn't automatically supposed to work")
			scope = editScope(text, request.scene)
			report.edit = { changes: planChanges, planChanges, reply, mode: out?.mode ?? (out?.plan ? "plan" : "patch") }
		} else {
			// (intent "new": a brand-new scene, whatever is on screen; the scene on screen is not sent)
			plan = await timed("plan", null, () => callStep("plan", { text, observation, images: refs, intent: "new" }))
			if (isObj(plan?.plan)) plan = plan.plan
		}
		if (!isObj(plan) || !Array.isArray(plan.items)) throw new AiError("invalid", "The plan that came back has no items", { step: mode === "edit" ? "edit" : "plan", retryable: true })
		check()
		report.initialPlan = clone(plan)

		// ---- 3. solve, 4. simulate (each version of the scene: {id, plan, solved, scene, sim, score, judged, fromRound, parent, tuned})
		// An edit or a check of the scene on the table changes what was asked and nothing else: what the change did not touch is solved at its
		// exact pose and comes back byte for byte (pinUntouched, restoreExact); a table too short for the change is widened, nothing is shifted.
		// An untouched thing the change now runs into (ten dominoes reaching the ball beside them) is let go and placed again by the solver, which
		// moves it the least it can and says so: the least change that makes room. (What overlapped already in the scene on screen stays as it was.)
		const exactEdit = mode !== "new" && Array.isArray(request.scene?.items)
		const THROUGH = ["overlap", "leg_through", "stand_through"]
		const hitIds = (r, among) => {
			const ids = new Set()
			for (const i of r.issues) if (i.level !== "info" && THROUGH.includes(i.code) && among.has(i.item)) ids.add(i.item)
			for (const w of r.warnings ?? []) for (const id of w.items ?? []) if (among.has(id)) ids.add(id)
			return ids
		}
		let baseline = null
		let ridersOnScreen = null
		const r6 = (v) => Math.round(v * 1e6) / 1e6
		// (the invisible walls at the table's ends: an edit of a scene that has none adds none, so nothing new stops a ball that flies off the end)
		const walls = exactEdit && !request.scene.items.some(isSafetyWall) ? { safetyWalls: false } : {}
		const solveV = (p, opts0 = {}) => {
			const opts = { ...opts0, ...walls }
			if (!exactEdit) return solve(p, opts)
			if (!baseline) {
				const b = pinUntouched(basePlan, basePlan, request.scene)
				try {
					baseline = hitIds(solve(b.plan, { ...opts, noShift: true }), b.pinned)
				} catch {
					baseline = new Set()
				}
			}
			const free = new Set()
			let r
			let ref = request.scene
			let pp = p
			let carried = false
			for (let k = 0; k < 5; k++) {
				const pin = pinUntouched(pp, basePlan, ref, free)
				r = solve(pin.plan, { ...opts, noShift: true })
				const hit = [...hitIds(r, pin.pinned)].filter((id) => !baseline.has(id))
				if (hit.length) {
					for (const id of hit) free.add(id)
					continue
				}
				// (what rests on a thing that was moved to make room goes with it, once: the seesaw moved aside carries its ball)
				if (carried || !free.size) break
				carried = true
				ridersOnScreen ??= (() => {
					try {
						return riderMap(request.scene)
					} catch {
						return new Map()
					}
				})()
				const at = new Map(r.scene.items.map((i) => [i.id, i]))
				const moves = new Map()
				for (const id of free) {
					const a = request.scene.items.find((i) => i.id === id)
					const b = at.get(id)
					if (!a || !b) continue
					const dx = (Number(b.x) || 0) - (Number(a.x) || 0)
					const dy = (Number(b.y) || 0) - (Number(a.y) || 0)
					if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) continue
					for (const rid of ridersOnScreen.get(id) ?? []) if (!free.has(rid)) moves.set(rid, { dx, dy })
				}
				if (!moves.size) break
				// (held at its pose: that pose moves; resting on it at a place along it: that place moves)
				ref = { ...request.scene, items: request.scene.items.map((i) => (moves.has(i.id) ? { ...i, x: r6((Number(i.x) || 0) + moves.get(i.id).dx), y: r6((Number(i.y) || 0) + moves.get(i.id).dy) } : i)) }
				const base = new Map((basePlan?.items ?? []).filter(isObj).map((i) => [i.id, JSON.stringify(i)]))
				pp = { ...pp, items: pp.items.map((i) => (isObj(i) && moves.has(i.id) && base.get(i.id) === JSON.stringify(i) && isObj(i.place) && typeof i.place.on === "string" && i.place.on !== "air" && num(i.place.x) !== null ? { ...i, place: { ...i.place, x: r6(i.place.x + moves.get(i.id).dx) } } : i)) }
			}
			r.exact = restoreExact(r.scene, request.scene)
			r.freed = [...free]
			return r
		}
		let nextId = 0
		const attempt = async (p, label, preview = false) => {
			const solved = await timed("solve", label, async () => {
				try {
					return solveV(p)
				} catch (e) {
					throw new AiError("invalid", `The plan couldn't be placed: ${e.message}`, { step: "solve", retryable: true, cause: e })
				}
			})
			const real = solved.scene.items.filter((i) => i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d))
			if (!real.length) throw new AiError("nothing", "Nothing in that could be built from the library", { step: "solve" })
			check()
			// the placed scene is shown at once (its run follows in a moment)
			if (preview) onEvent({ type: "draft", scene: solved.scene, sim: null, stage: "layout", label: "placed" })
			const sim = await timed("simulate", label, () =>
				simulate(solved.scene, signal).catch((e) => {
					if (e?.name === "AbortError") throw e
					throw new AiError("engine", `The physics couldn't run it: ${e.message}`, { step: "simulate", retryable: false })
				})
			)
			check()
			return { id: nextId++, plan: p, solved, scene: solved.scene, sim, score: null, judged: false, fromRound: 0, parent: null }
		}
		const draft = (v, label) => onEvent({ type: "draft", sim: v.sim, scene: v.scene, label })
		// ---- an edit does exactly what was asked (the user, 2026-10-15: "the edit isn't automatically supposed to have it work - that's not how
		// physics works"). Every step below is tried in a solve before it is kept.
		const was = new Map((basePlan?.items ?? []).filter(isObj).map((i) => [i.id, i]))
		const trouble = (r) => new Set([...(r.freed ?? []), ...r.issues.filter((i) => i.level !== "info" && i.item).map((i) => `${i.code}|${i.item}`)])
		let R = new Map()
		if (mode === "edit")
			try {
				R = riderMap(request.scene)
			} catch {}
		const shiftX = (x, d) => ({ ...clone(x), place: { ...clone(x.place), x: Math.round((x.place.x + d) * 1e5) / 1e5 } })
		// (what rides on a thing moved along goes with it, unless the edit placed it itself)
		const withEntry = (p, id, entry) => {
			const d = (num(entry.place?.x) ?? 0) - (num(was.get(id)?.place?.x) ?? num(entry.place?.x) ?? 0)
			const riders = new Set(Math.abs(d) > 1e-9 ? R.get(id) ?? [] : [])
			return { ...p, items: p.items.map((x) => (!isObj(x) ? x : x.id === id ? entry : riders.has(x.id) && JSON.stringify(x) === JSON.stringify(was.get(x.id)) && num(x.place?.x) !== null ? shiftX(x, d) : x)) }
		}
		const ROOM = [0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15]
		if (mode === "edit") {
			// (1) a thing moved along the table carries what rests on it: "the yellow ball on it moves with it", as the edit step itself says)
			for (const it of plan.items) {
				const a = isObj(it) ? was.get(it.id) : null
				if (!a || a.type !== it.type || !isObj(a.place) || !isObj(it.place) || num(a.place.x) === null || num(it.place.x) === null) continue
				const rest = (pl) => JSON.stringify({ ...pl, x: 0 })
				if (rest(a.place) !== rest(it.place) || Math.abs(it.place.x - a.place.x) < 1e-9) continue
				plan = withEntry(plan, it.id, it)
			}
		}
		// (2) a plain change does what it names and nothing else: what the edit step changed beyond the things the request names (and what rides on
		// them), often re-tuned to keep a goal working, is put back as it was; the run then shows what the change really does and the panel offers
		// a checked fix. A thing in the way of the change is moved instead, the least that makes room (and the reply says so); only when nothing
		// smaller works does the edit step's own change of it stay. The things asked about must land as the edit step's version puts them.
		if (mode === "edit" && scope) {
			const changed = plan.items.filter((it) => isObj(it) && was.has(it.id) && JSON.stringify(was.get(it.id)) !== JSON.stringify(it))
			let ref = null
			if (changed.some((it) => scope.named.has(it.id)))
				try {
					ref = solveV(plan)
				} catch {}
			if (ref) {
				const refTrouble = trouble(ref)
				const askedIds = [...scope.asked].filter((id) => ref.scene.items.some((i) => i.id === id))
				const poseOf = (r) => askedIds.map((id) => r.scene.items.find((i) => i.id === id))
				const refPose = poseOf(ref)
				const near = (a, b) => !!a && !!b && Math.abs((a.x ?? 0) - (b.x ?? 0)) <= 0.002 && Math.abs((a.y ?? 0) - (b.y ?? 0)) <= 0.002 && Math.abs((a.angle ?? 0) - (b.angle ?? 0)) <= 0.2
				const lands = (p) => {
					try {
						const r = solveV(p)
						return poseOf(r).every((q, i) => near(q, refPose[i])) && [...trouble(r)].every((k) => refTrouble.has(k))
					} catch {
						return false
					}
				}
				const midX = askedIds.length ? askedIds.map((id) => Number(ref.scene.items.find((i) => i.id === id)?.x) || 0).reduce((a, b) => a + b, 0) / askedIds.length : 0
				for (const it of changed) {
					if (scope.asked.has(it.id)) continue
					const a = was.get(it.id)
					if (a.type !== it.type) continue // (a swap is never a side effect)
					const name = theName(request.scene.items.find((i) => i.id === it.id) ?? a)
					const tries = [{ entry: clone(a), room: false }]
					// in the way: moved along the table, away from what changed, the least that makes room
					const x0 = num(a.place?.x)
					if (x0 !== null) {
						const dir = (Number(request.scene.items.find((i) => i.id === it.id)?.x) || x0) < midX ? -1 : 1
						for (const d of ROOM) tries.push({ entry: shiftX(a, dir * d), room: true })
					}
					// (or where the edit step moved it, with its own settings back)
					if (JSON.stringify(a.place ?? null) !== JSON.stringify(it.place ?? null)) tries.push({ entry: { ...clone(a), place: clone(it.place) }, room: true })
					const ok = tries.find((t) => lands(withEntry(plan, it.id, t.entry)))
					if (!ok) continue // (nothing less works: the edit step's change of it stays)
					plan = withEntry(plan, it.id, ok.entry)
					if (ok.room) madeRoom.add(it.id)
					else leftAlone.push({ id: it.id, name })
				}
			}
			// the run's length, unless asked
			if (!scope.timeAsked && num(basePlan?.seconds) !== null && num(plan.seconds) !== null && Math.abs(plan.seconds - basePlan.seconds) > 1e-9) {
				leftAlone.push({ name: `the run’s length (${sig(basePlan.seconds)} s)` })
				plan = { ...plan, seconds: basePlan.seconds }
			}
		}
		// (3) a thing the request names that the edit step also moved, though no move was asked for ("make the box 16 cm wide" that slid it 6 cm
		// left to stay under the ball): its place (and that of what rides on it) is put back when that runs into nothing the edit step's version
		// didn't; otherwise that move made room, and it stays
		if (mode === "edit" && scope && !scope.placeAsked) {
			for (const id of scope.named) {
				const it = plan.items.find((x) => isObj(x) && x.id === id)
				const a = was.get(id)
				if (!it || !a || a.type !== it.type || JSON.stringify(a.place ?? null) === JSON.stringify(it.place ?? null)) continue
				// (only where it stands: a turn the edit gave it stays)
				const spot = (pl) => {
					const o = isObj(pl) ? clone(pl) : {}
					delete o.angle_deg
					return JSON.stringify(o)
				}
				if (spot(a.place) === spot(it.place)) continue
				const alt = clone(plan)
				for (const rid of [id, ...(R.get(id) ?? [])]) {
					const x = alt.items.find((y) => isObj(y) && y.id === rid)
					const b = was.get(rid)
					if (!x || !b || b.type !== x.type) continue
					const ang = isObj(x.place) ? x.place.angle_deg : undefined
					x.place = clone(b.place)
					if (ang !== undefined && isObj(x.place)) x.place.angle_deg = ang
					else if (isObj(x.place)) delete x.place.angle_deg
				}
				let ok = false
				try {
					const ta = trouble(solveV(plan))
					ok = [...trouble(solveV(alt))].every((k) => ta.has(k))
				} catch {}
				if (!ok) continue
				plan = alt
				const nm = theName(request.scene.items.find((i) => i.id === id) ?? a)
				leftAlone.push({ id, name: `${nm}${/s$/.test(nm) ? "’" : "’s"} place` })
			}
		}
		// (4) a thing the edit moved that the solver would push aside, because it runs into something the edit left alone ("move the seesaw 10 cm
		// left" into the last domino): it goes where it was asked, and the thing in the way moves the least that makes room (and is said)
		if (mode === "edit") {
			let r0 = null
			try {
				r0 = solveV(plan)
			} catch {}
			const nameToIds = new Map()
			for (const x of plan.items.filter(isObj)) {
				const n = String(x.name ?? typeName(x.type) ?? x.id)
				nameToIds.set(n, [...(nameToIds.get(n) ?? []), x.id])
			}
			const placedByEdit = (id) => {
				const x = plan.items.find((y) => isObj(y) && y.id === id)
				const a = was.get(id)
				return !!x && (!a || JSON.stringify(a.place ?? null) !== JSON.stringify(x.place ?? null))
			}
			for (const iss of r0 ? r0.issues.filter((i) => i.code === "moved" && i.item && placedByEdit(i.item)) : []) {
				const m = /to clear (.+)$/.exec(iss.text ?? "")
				const blockers = (m ? m[1].split(/, /) : []).flatMap((n) => nameToIds.get(n) ?? []).filter((id) => id !== iss.item && !scope?.named?.has(id) && JSON.stringify(plan.items.find((y) => isObj(y) && y.id === id)) === JSON.stringify(was.get(id)) && num(was.get(id)?.place?.x) !== null)
				const D = plan.items.find((y) => isObj(y) && y.id === iss.item)
				const dx0 = num(D?.place?.x) ?? 0
				const t0 = trouble(r0)
				for (const bid of blockers) {
					const b = was.get(bid)
					const dir = num(b.place.x) < dx0 ? -1 : 1
					const fits = (p) => {
						try {
							const r = solveV(p)
							return !r.issues.some((i) => i.code === "moved" && i.item === iss.item) && [...trouble(r)].every((k) => t0.has(k))
						} catch {
							return false
						}
					}
					const d = ROOM.find((dd) => fits(withEntry(plan, bid, shiftX(b, dir * dd))))
					if (d === undefined) continue
					plan = withEntry(plan, bid, shiftX(b, dir * d))
					madeRoom.add(bid)
					break
				}
			}
		}
		if (report.edit && leftAlone.length) report.edit.leftAlone = leftAlone.map((x) => x.name)
		if (report.edit && madeRoom.size) report.edit.madeRoom = [...madeRoom]
		let cur = await attempt(plan, undefined, mode !== "check")
		let firstV = null // (an edit: the version that is exactly what was asked)
		if (mode !== "check") draft(cur, "first version") // (a check starts from the scene already on the table)
		if (mode === "edit") {
			// what the edit did to the scene on screen, as the scene shows it (a plan change with no effect is not a change)
			const seen = describeDiff(request.scene, cur.scene)
			const goalsSaid = goalChanges(basePlan, plan, cur.scene)
			report.edit.changes = [...seen, ...unseenChanges(report.edit.planChanges), ...goalsSaid.filter((g) => !seen.includes(g))]
			if (!report.edit.changes.length && report.edit.planChanges.length) report.edit.noChange = true
			report.edit.firstScene = cur.scene
			firstV = cur
		}

		// ---- 3b. the pictures: is every object they show built (and as many as they show)? One targeted fix before the critic, said in the report
		if (mode === "new" && observation && doReconcile) {
			const cov = coverage(observation, cur.plan)
			report.coverage = { checked: cov.checked, objects: cov.objects, gaps: cov.gaps.map(gapWords), fixed: [], remaining: [], changes: [] }
			if (cov.gaps.length) {
				try {
					const out = await timed("reconcile", `${plural(cov.gaps.length, "difference")}`, () => callStep("edit", { text: reconcileRequest(cov.gaps), scene: cur.scene, plan: cur.plan, images: refs, history: [] }, "reconcile"))
					const patches = Array.isArray(out?.patches) ? out.patches : Array.isArray(out) ? out : []
					const r = applyPatches(cur.plan, patches, cur.scene)
					if (isObj(out) && Array.isArray(out.missing)) r.plan.missing = out.missing
					if (r.changes.length) {
						extendCovers(r.plan, cur.plan, cov.gaps)
						const next = await attempt(r.plan, "matching your picture")
						const worse = next.solved.errors.length > cur.solved.errors.length || (next.sim.warnings?.length ?? 0) > (cur.sim.warnings?.length ?? 0)
						const left = coverage(observation, next.plan).gaps
						if (!worse && left.length < cov.gaps.length) {
							report.coverage.changes = describeDiff(cur.scene, next.scene)
							report.coverage.fixed = cov.gaps.filter((g) => !left.some((l) => l.label === g.label)).map(gapWords)
							report.coverage.remaining = left.map(gapWords)
							next.parent = cur
							cur = next
							draft(cur, "matching your picture")
						} else report.coverage.remaining = cov.gaps.map(gapWords)
					} else report.coverage.remaining = cov.gaps.map(gapWords)
				} catch (e) {
					if (e?.name === "AbortError" || signal.aborted) throw e
					report.coverage.remaining = cov.gaps.map(gapWords)
					say("warn", "reconcile_failed", `Couldn't match the scene to your picture (${whyFailed(e)}): ${andList(cov.gaps.map(gapWords))}`)
				}
			} else onEvent({ type: "step", step: "reconcile", state: "skipped", label: cov.checked ? "everything in the picture is built" : "nothing to compare" })
		}
		check()

		// an edit answered with a whole new plan is a new scene in all but name: it gets the critic's full rounds, never the quick path
		const wholePlan = mode === "edit" && (report.edit?.mode === "plan" || isObj(editOut?.plan) || Array.isArray(editOut?.items))
		// what an edit set on purpose, item by item: "place" (it was moved: x, y, angle) and the prop keys it changed ("all" for a swapped type's props
		// and a new item's place). The tuner leaves exactly those as the person set them: a cup made bigger may still be moved, a moved one stays put.
		const touched = new Map()
		// (and, for the fix search, which way it was moved when that is one way only: "raise the box 12 cm" set its height, so a fix may still slide
		// it along; "move the box 15 cm right" set where it is along the table, so a fix may still raise or lower it)
		const placeAxis = new Map() // id -> "place-x" | "place-y" | "place-angle"
		if (mode === "edit") {
			const was = new Map((basePlan?.items ?? []).filter(isObj).map((i) => [i.id, i]))
			const without = (pl, k) => JSON.stringify(Object.fromEntries(Object.entries(isObj(pl) ? pl : {}).filter(([key]) => key !== k)))
			for (const it of plan.items.filter(isObj)) {
				const a = was.get(it.id)
				const keys = new Set()
				if (!a) keys.add("place")
				else if (JSON.stringify(a.place ?? null) !== JSON.stringify(it.place ?? null)) {
					keys.add("place")
					const axis = [["x", "place-x"], ["y_m", "place-y"], ["angle_deg", "place-angle"]].find(([k]) => isObj(a.place) && isObj(it.place) && a.place.on === it.place.on && without(a.place, k) === without(it.place, k))
					if (axis) placeAxis.set(it.id, axis[1])
				}
				const pa = a && a.type === it.type ? a.props ?? {} : {}
				for (const k of new Set([...Object.keys(pa), ...Object.keys(it.props ?? {})])) if (!a || a.type !== it.type || JSON.stringify(pa[k] ?? null) !== JSON.stringify(it.props?.[k] ?? null)) keys.add(k)
				if (a && a.type !== it.type) for (const k of propKeys(it.type) ?? []) keys.add(k)
				if (keys.size) touched.set(it.id, keys)
			}
		}
		// the solver had to move something the edit only changed in size or kind (a cup made bigger, moved off a ramp's legs): said, and the tuner may move it
		const displaced = mode === "edit" ? cur.solved.issues.filter((i) => i.code === "moved" && touched.has(i.item) && !touched.get(i.item).has("place")).map((i) => `${i.text} (so the tuner may move it too)`) : []

		// ---- 3c. a simple edit is applied straight after its run when the physics shows it changed nothing else: no goal stopped or got worse, no
		// stage that worked stopped, no new or lost hit between things the edit left alone. The critic is not asked (its "Check it" is offered).
		let quick = false
		let tuneWanted = doTune
		let editRunNotes = [] // how the run changed beyond the edit itself, for the critic (when it looks)
		const runChangedBy = (v) => {
			const hadRun = !!(request.sim?.doc && request.sim?.track)
			const lost = request.sim?.summary ? lostStages(request.sim, v.sim, v.scene) : []
			const rc = hadRun ? runChanges(request.sim, v.sim, request.scene, v.scene, G(v)) : { contacts: [], worse: [], better: [] }
			return { hadRun, lost, ...rc, all: [...lost, ...rc.worse, ...rc.contacts] }
		}
		// ---- 3c. an edit does exactly what was asked and runs the physics once: no critic, no tuner. When that stops a goal (or a row that all
		// fell before), the reply says what happens instead and the panel looks for a checked fix (./fixer.js) to offer; a request that states the
		// outcome itself ("…so it still lands in the box", "make it work") gets that search as part of the edit, and the fix goes on the table too.
		if (mode === "edit") {
			quick = true
			tuneWanted = false
			report.quick = true
			report.quickNote = "Run in the physics engine once, exactly as asked; the AI didn’t look at pictures of it"
			const ch = runChangedBy(cur)
			editRunNotes = ch.all
			// the things whose kind the edit swapped (their weight may be tuned: they stay that kind)
			const swapped = new Set(plan.items.filter((it) => isObj(it) && (basePlan?.items ?? []).some((b) => isObj(b) && b.id === it.id && b.type !== it.type)).map((it) => it.id))
			const before = request.sim?.doc && request.sim?.track?.frames?.length ? { scene: request.scene, sim: request.sim } : null
			const targets = fixTargets({ goals: G(cur), scene: cur.scene, before, sim: cur.sim })
			const now0 = judgeTargets(targets, cur.sim)
			const was = before ? judgeTargets(targets, before.sim) : null
			report.targets = now0.map((r, i) => ({ label: r.label, ok: r.ok, implicit: !!targets[i].implicit, ...(was && typeof was[i]?.ok === "boolean" && targets[i].goal && goalItems(targets[i].goal).every((id) => request.scene.items.some((x) => x.id === id)) ? { was: was[i].ok } : {}), ...(r.ok === false ? { happened: safeWords(r, targets[i].goal, cur.sim, cur.scene, before) } : {}) }))
			// (a request that only states an outcome, with no number of its own, lets the search go on adjusting what the edit set for it)
			const flex = statesOutcome(text) && !EXPLICIT_RE.test(text)
			// what the fix search must leave as it is: what this edit set, and what the person changed in the turns this one follows up (request.keep:
			// "make it work" after "move the box 10 cm left" never moves the box back)
			// (only what the request names, and what rides on it, is the person's change: anything else the edit step changed may be moved back by
			// the search. When it names nothing that was changed, all of it is kept)
			const named = namedIn(text, request.scene)
			let R = new Map()
			try {
				R = riderMap(request.scene)
			} catch {}
			const own = new Set([...named, ...[...named].flatMap((id) => R.get(id) ?? [])])
			const onScreen = new Set(request.scene.items.map((i) => i.id))
			const mine = [...touched.keys()].some((id) => own.has(id))
			const axisOf = (id, keys) => (placeAxis.has(id) && keys !== "all" && keys.has("place") ? new Set([...keys].map((k) => (k === "place" ? placeAxis.get(id) : k))) : keys)
			const protect = new Map([...touched].filter(([id]) => !mine || own.has(id) || !onScreen.has(id)).map(([id, keys]) => [id, axisOf(id, keys)]))
			// (where a thing the person moved stood before they first moved it, carried turn to turn: a later fix may still line the rest up with it)
			const origin = new Map()
			for (const [id] of protect) {
				const r0 = request.scene.items.find((i) => i.id === id)
				const r1 = cur.scene.items.find((i) => i.id === id)
				if (r0 && r1 && (Math.abs((Number(r0.x) || 0) - (Number(r1.x) || 0)) > 1e-6 || Math.abs((Number(r0.y) || 0) - (Number(r1.y) || 0)) > 1e-6)) origin.set(id, { x: Number(r0.x) || 0, y: Number(r0.y) || 0 })
			}
			for (const [id, keys, from] of Array.isArray(request.keep) ? request.keep : []) {
				if (!cur.scene.items.some((i) => i.id === id)) continue
				const had = protect.get(id)
				protect.set(id, had === "all" || keys === "all" ? "all" : new Set([...(had ?? []), ...(Array.isArray(keys) ? keys : [])]))
				if (isObj(from) && num(from.x) !== null && num(from.y) !== null && !origin.has(id)) origin.set(id, { x: from.x, y: from.y })
			}
			if (report.edit) report.edit.touched = [...protect].map(([id, keys]) => [id, keys === "all" ? "all" : [...keys], ...(origin.has(id) ? [origin.get(id)] : [])])
			const fixCtx = { scene: cur.scene, sim: cur.sim, goals: G(cur), before, touched: protect, swapped, targets, flex, origin }
			if (now0.some((r) => r.ok === false)) {
				if (statesOutcome(text)) {
					let fr = null
					try {
						fr = await timed("fix", null, () => findFix(fixCtx, { signal, onProgress: (pr) => onEvent({ type: "progress", step: "fix", ...pr }) }))
					} catch (e) {
						if (e?.name === "AbortError" || signal.aborted) throw e
						say("warn", "fix_failed", `Couldn’t look for a fix: ${e?.message ?? e}`)
					}
					if (fr?.status === "found" && fr.fix.sim) {
						const fixed = { id: nextId++, plan: planAfterFix(cur.plan, fr.fix.scene), solved: cur.solved, scene: fr.fix.scene, sim: fr.fix.sim, score: null, judged: false, fromRound: 0, parent: cur, fixed: true }
						report.fixApplied = { say: fr.fix.words.say, did: fr.fix.words.did, label: fr.fix.words.label, changes: fr.fix.changes, runs: fr.runs, ms: fr.ms }
						report.quickNote = `Run in the physics engine as asked, then ${fr.runs} more runs found the smallest change that makes it work (${fr.fix.words.did}); the AI didn’t look at pictures of it`
						cur = fixed
						draft(cur, "fixed")
					} else if (fr) report.fix = fixInfo(fr, cur.scene, targets, report)
				} else {
					// (the panel runs the search once the change is on the table: report.fixCtx is for it, never saved)
					report.fixNeeded = true
					Object.defineProperty(report, "fixCtx", { value: fixCtx, enumerable: false, configurable: true, writable: true })
				}
			}
		}
		// the tuner: a bounded search over the plan's knobs for the goals that fail
		const needsTune = (v) => (v.plan.tune?.length ?? 0) > 0 && goalResults(v.sim, G(v)).some((g) => g.ok !== true)
		const runTune = async (v) => {
			const tr = await timed("tune", null, () => tune({ plan: v.plan, scene: v.scene, sim: v.sim, goals: G(v), exclude: touched, simulate, signal, solver: solveV, onProgress: (p) => onEvent({ type: "progress", step: "tune", ...p }) }))
			report.tune = { changed: tr.changed, runs: tr.runs, ms: tr.ms, before: tr.before, after: tr.after, passed: tr.passed, knobs: tr.knobs, skipped: tr.skipped, notes: displaced, changes: [] }
			if (!tr.changed.length) return v
			const solved = solveV(tr.plan)
			const t = { id: nextId++, plan: tr.plan, solved, scene: solved.scene, sim: tr.sim, score: null, judged: false, tuned: true, parent: v, fromRound: v.fromRound }
			report.tune.changes = describeDiff(v.scene, t.scene)
			draft(t, "tuned")
			return t
		}
		// an edit that broke a goal: the tuner first (a second or so, and the physics itself says whether it worked); when that wins the goal back
		// and nothing else broke, the change is applied without the critic too (its "Check it" is offered); otherwise the critic looks (≤ 2 rounds)
		let tunedEarly = false
		if (mode === "edit" && !wholePlan && !quick && tuneWanted && needsTune(cur)) {
			cur = await runTune(cur)
			tunedEarly = true
			const fixed = goalResults(cur.sim, G(cur)).every((g) => g.ok === true)
			const broken = cur.solved.errors.length > 0 || (cur.sim.warnings?.length ?? 0) > (request.sim?.warnings?.length ?? 0) || floatingIn(cur).length > 0 || passIn(cur).length > 0
			const ch = runChangedBy(cur)
			if (cur.tuned) editRunNotes = ch.all
			if (quickEdits && fixed && !broken && !ch.all.length && !CHECK_RE.test(text)) {
				quick = true
				report.quick = true
				report.quickTuned = true
				report.quickNote = `The change stopped a goal; the tuner made it work again (${brief(report.tune?.changes?.length ? report.tune.changes : ["it adjusted the scene"])}) and nothing else in the run changed: checked by the physics, not by the AI’s picture check`
			}
		}
		const rounds = quick ? 0 : mode === "edit" && !wholePlan ? Math.min(refineRounds, 2) : refineRounds
		if (quick) onEvent({ type: "step", step: "refine", state: "skipped", label: report.quickTuned ? "the tuner made the goal work again" : "a simple change: checked by the physics" })

		const shoot = async (v, label) => {
			if (v.shots) return v.shots
			if (!deps.shot) return (v.shots = [])
			try {
				v.shots = await timed("render", label, () => deps.shot.render(v.sim, { scene: v.scene, signal }))
			} catch (e) {
				if (e?.name === "AbortError") throw e
				say("info", "render", `No picture for the critique: ${e.message}`)
				v.shots = []
			}
			return v.shots
		}
		const PLACING = ["moved", "kept_on", "lean_length", "lean_raised", "shifted", "table_widened", "support_added"]
		/** The critic's look at a version: the request, the plan, the solved scene and its run (plus what the solver had to do, where things ended,
		 *  the picture's objects as a checklist, and `extra` lines). */
		const judge = async (v, round, rounds, label, extra = []) => {
			const shots = await shoot(v, label)
			const notes = v.solved.issues.filter((i) => i.level !== "info" || PLACING.includes(i.code)).map((i) => ({ text: `placing: ${i.text}` }))
			// (the summary's events are hits between different things: a Newton's cradle's balls striking each other are told here, or the critic reads "no hits")
			const own = new Map(v.scene.items.map((i) => [i.id, i]))
			for (const [id, h] of innerHits(v.sim)) if (h.n >= 2 && own.get(id) && own.get(id).type !== "domino-row") notes.push({ text: `in the run: ${nameOfItem(own.get(id))}'s own parts strike each other ${h.n} times (first at ${Number(h.t).toFixed(2)} s; the events list only hits between different things)` })
			const payload = {
				text,
				round,
				rounds,
				plan: v.plan,
				scene: v.scene,
				sim: { summary: reconciledSummary(v.sim), warnings: [...extra.map((t) => ({ text: t })), ...(v.sim.warnings ?? []), ...notes].slice(0, 24), final: finalPositions(v.sim), ...(v.tuned ? { tuned: true } : {}) },
				renders: shots.map((s) => wireImage(s, `the solved scene, ${s.label === "close-up" ? "close-up at the end" : `at ${s.t.toFixed(1)} s (${s.label})`}`)),
				images: refs
			}
			if (observation) payload.observation = observation
			return timed("refine", null, () => callStep("refine", payload), label)
		}
		const issueText = (i) => (typeof i === "string" ? i : isObj(i) ? `${i.text ?? ""}`.trim() : String(i))
		/** A critic's verdict on version v. Its score is at most 7 while a goal of the request fails in v's run (the critic's own rule, ai/DESIGN.md:
		 *  a 9/10 beside a failed goal is not a true report), and said so. */
		const verdict = (critique, round, v, extraFields = {}) => {
			const failing = goalResults(v.sim, G(v)).filter((g) => g.ok === false)
			const raw = num(critique?.score_0_10)
			// things passing through each other (the critic says so, or the solver does) are not done, and not better than 6/10, however small they look
			const said = passSaid(Array.isArray(critique?.issues) ? critique.issues.map(issueText).filter(Boolean) : [])
			const placed = passIn(v).map((i) => i.text)
			const through = [...said, ...placed]
			const cap = through.length ? PASS_CAP : failing.length ? GOAL_CAP : null
			const capped = raw !== null && cap !== null && raw > cap
			const why = through.length ? `${through.length === 1 ? "something passes" : "things pass"} through each other (${String(through[0]).replace(/\.$/, "")})` : `${failing.length === 1 ? "a goal fails" : `${failing.length} goals fail`} in the run`
			return verdictOf(critique, round, v, { ...(capped ? { capped: `the AI scored it ${raw}/10, but ${why}, so it shows at most ${cap}/10`, rawScore: raw } : {}), ...(through.length ? { through, done: false } : {}), ...extraFields }, capped ? cap : raw)
		}
		const verdictOf = (critique, round, v, extraFields, score) => ({
			round,
			score,
			done: !!critique?.done,
			issues: Array.isArray(critique?.issues) ? critique.issues.map(issueText).filter(Boolean) : [],
			severities: Array.isArray(critique?.issues) ? critique.issues.map((i) => i?.severity ?? null) : [],
			notes: typeof critique?.notes === "string" ? critique.notes : null,
			changes: [],
			skipped: [],
			version: v.id,
			...extraFields
		})
		/** Refine patches that would leave something floating which was held up before (a ramp's legs switched off in the air, a cup lowered off
		 *  its stand into the air) are not applied; the rest are. -> applyPatches' {plan, changes, skipped} */
		const guardPatches = (v, patches) => {
			const r = applyPatches(v.plan, patches, v.scene)
			if (!r.changes.length) return r
			let s
			// (judged as planned, without the stands the solver would add: a patch that takes away what held something up is refused)
			const floating = (solved) => new Set(solved.issues.filter((i) => i.code === "floats" || i.code === "floats_end").map((i) => i.item))
			let before
			try {
				s = solve(r.plan, { supports: false })
				before = floating(solve(v.plan, { supports: false }))
			} catch {
				return r
			}
			const bad = new Set([...floating(s)].filter((id) => !before.has(id)))
			if (!bad.size) return r
			const target = (p) => (isObj(p) ? p.id ?? p.item?.id : undefined)
			const r2 = applyPatches(v.plan, patches.filter((p) => !bad.has(target(p))), v.scene)
			for (const id of bad) {
				const it = r.plan.items.find((i) => i.id === id)
				r2.skipped.push(`${nameOfItem(it) ?? id}: not changed, the change would have left it floating with nothing under it`)
			}
			return r2
		}

		// ---- 5. refine (≤ rounds): the critic judges a version; its patches make the next. A version that builds worse or loses a stage that worked
		// is not taken, and the critic hears why in its next round. Every score belongs to the version it judged (v.score, v.judged).
		let best = null
		let refineFailed = null
		let feedback = []
		const floatNoted = new Set() // things the critic was told float (once each)
		const goalNoted = new Set() // goals the critic was told fail after it said done (once each)
		// an edit: the critic knows what the person just changed (the tuner leaves those where they are, so it should too)
		if (mode === "edit" && touched.size) {
			const nm = (id) => nameOfItem(plan.items.find((i) => i.id === id)) ?? id
			const moved = [...touched].filter(([, k]) => k.has("place")).map(([id]) => nm(id))
			const set = [...touched].filter(([, k]) => !k.has("place")).map(([id]) => nm(id))
			feedback.push(`The person just changed ${andList([...moved, ...set])} on purpose: keep ${moved.length ? `${andList(moved)} where ${moved.length === 1 ? "it is" : "they are"}` : ""}${moved.length && set.length ? ", and " : ""}${set.length ? `${andList(set)} as ${set.length === 1 ? "it is" : "they are"} now (size and kind; ${set.length === 1 ? "it" : "they"} may move if it must)` : ""}; make anything else work around ${touched.size === 1 ? "it" : "them"}.`)
		}
		// and how the run changed beyond the edit itself (a lid that now tips into the box, pins that no longer fall)
		if (mode === "edit" && editRunNotes.length) feedback.push(`Compared with the run before this edit: ${editRunNotes.join("; ")}.`)
		for (let round = 1; round <= rounds; round++) {
			check()
			const label = `${STEP_LABELS.refine} ${round}/${rounds}`
			let critique
			try {
				critique = await judge(cur, round, rounds, label, [...feedback, ...(cur.parent ? runDiff(cur.parent.sim, cur.sim) : [])])
			} catch (e) {
				if (e?.name === "AbortError" || signal.aborted) throw e
				// a critic that fails leaves the scene as it is (it ran, it is placed exactly): the user is told it was not checked
				refineFailed = e
				say("warn", "refine_failed", cur.judged || round === 1 ? `The picture check couldn't run (${whyFailed(e)}): this scene was not checked by the AI` : `The check after the last changes couldn't run (${whyFailed(e)}): this is the last version that ran, not checked again`)
				break
			}
			feedback = []
			const entry = verdict(critique, round, cur)
			report.refine.push(entry)
			const prev = best
			cur.score = entry.score
			cur.judged = true
			cur.verdict = entry
			if (!best || better(cur, best)) best = cur
			const patches = Array.isArray(critique?.patches) ? critique.patches : []
			if (entry.done || !patches.length) {
				// "done" while a goal fails in the run is not done while rounds are left (and no patches came): the critic is told, once
				const failing = goalResults(cur.sim, G(cur)).filter((g) => g.ok === false && !goalNoted.has(g.label))
				if (round < rounds && failing.length && (!needsTune(cur) || tunedEarly)) {
					for (const g of failing) goalNoted.add(g.label)
					entry.continued = "a goal still fails in the run, so it was asked to look again"
					feedback.push(`Not done yet: ${failing.map((g) => `the goal “${g.label}” FAILS in this run${g.kind !== "in" && g.detail ? ` (${g.detail})` : ""}`).join("; ")}. Fix it with patches (move or resize what decides it) without breaking what works, and without moving what the person just changed.`)
					continue
				}
				// "done" with something still floating in mid-air (or a leg through it) is not done while rounds are left: the critic is told, once
				const left = floatingIn(cur).filter((i) => !floatNoted.has(`${i.code}|${i.item}`))
				if (round < rounds && left.length) {
					for (const i of left) floatNoted.add(`${i.code}|${i.item}`)
					entry.continued = "something still floats with nothing under it, so it was checked again"
					feedback.push(`Not done yet: ${left.map((i) => i.text.replace(/ \(.*\)$/, "")).join("; ")}. A static thing must stand on something (a fixed block or brick stack, a box, books, a shelf plank with legs) or hold itself up (legs, a hung box's cords): fix it with patches (add a support under it, or move it onto one) without breaking what works.`)
					continue
				}
				// nor with things passing through each other (a leg through a ramp, a stand's pole through a shelf): the critic is told, once each
				const through = (entry.through ?? []).filter((t) => !floatNoted.has(`through|${t}`))
				if (round < rounds && through.length) {
					for (const t of through) floatNoted.add(`through|${t}`)
					entry.continued = "something passes through something else, so it was asked to fix that"
					feedback.push(`Not done yet: ${through.map((t) => String(t).replace(/\.$/, "")).join("; ")}. Nothing may pass through anything else, not even a leg, a stand's pole or a post: move one of them clear (set_place with a new x or y_m), shorten or turn it, or stand the thing on what is under it instead of over it. Keep what works.`)
					continue
				}
				break
			}
			// rounds that stop helping (the critic's score and what happens in the run both no better than before) end the loop: the best one stays
			if (round >= 2 && prev && prev !== cur && (entry.score ?? -1) <= (prev.score ?? -1) && physV(cur) <= physV(prev)) {
				entry.stopped = "no better than the round before, so refining stopped and the best version was kept"
				break
			}
			const r = guardPatches(cur, patches)
			entry.planChanges = r.changes
			entry.skipped = r.skipped
			if (!r.changes.length) break
			const next = await attempt(r.plan, `round ${round}`)
			const seen = describeDiff(cur.scene, next.scene)
			entry.changes = [...seen, ...unseenChanges(r.changes)]
			if (r.skipped.length) feedback.push(`These changes of yours were not applied: ${r.skipped.join("; ")}.`)
			if (!entry.changes.length) {
				// patches that change nothing in the scene are not a new version (and not reported as changes)
				entry.noEffect = "its changes left the scene exactly as it was"
				feedback.push(`Your last patches (${r.changes.slice(0, 4).join("; ")}) changed nothing in the scene: the solver places things from the plan, so use other ops (set_place with a new x or y_m, set_props) or say done.`)
				continue
			}
			const worse = next.solved.errors.length > cur.solved.errors.length || (next.sim.warnings?.length ?? 0) > (cur.sim.warnings?.length ?? 0)
			const lost = worse ? [] : lostStages(cur.sim, next.sim, next.scene)
			if (worse || (lost.length && goalsOk(next.sim, G(next)) <= goalsOk(cur.sim, G(cur)))) {
				entry.rejected = worse ? "it built worse (new errors or things starting inside each other), so it was undone" : `it stopped what worked before (${lost.join("; ")}), so it was undone`
				feedback.push(`Your last changes (${entry.changes.slice(0, 4).join("; ")}) were tried and undone: ${worse ? "the scene built worse (new placement errors or things starting inside each other)" : `they stopped what worked before: ${lost.join("; ")}`}. Keep what works and fix the problem another way.`)
				continue
			}
			next.parent = cur
			next.fromRound = round
			cur = next
			draft(cur, `after check ${round}`)
		}
		check()

		// ---- 6. tune: the goals that still fail (an edit: only when it broke a goal, or asks for one; it ran already, before the critic)
		let tunedAlready = tunedEarly
		if (best && best !== cur) {
			if (!cur.judged && physV(best) > physV(cur)) {
				// the critic's last change lost something the best checked version had: the tuner may win it back; otherwise the best version stays
				if (tuneWanted && needsTune(cur)) {
					const t = await runTune(cur)
					tunedAlready = true
					if (physV(t) >= physV(best)) cur = t
					else {
						cur = best
						report.refine.at(-1).rejected = "its last change lost what an earlier version had (and tuning didn't win it back), so the earlier version was kept"
						if (report.tune) report.tune.reverted = true
					}
				} else {
					cur = best
					const last = report.refine.at(-1)
					if (last && !last.rejected) last.rejected = "its last change lost what an earlier version had, so the earlier version was kept"
				}
				draft(cur, "the better version")
			} else if (cur.judged && better(best, cur)) {
				cur = best
				draft(cur, "the better version")
			}
		}
		check()
		if (tuneWanted && !tunedAlready && needsTune(cur)) cur = await runTune(cur)
		else if (!tunedAlready) onEvent({ type: "step", step: "tune", state: "skipped", label: !goalResults(cur.sim, G(cur)).length ? "no goals to tune" : goalResults(cur.sim, G(cur)).every((g) => g.ok === true) ? "goals met" : !(cur.plan.tune?.length) ? "no knobs to tune" : mode === "edit" && !tuneWanted ? "the change didn't touch the goals" : "no knobs to tune" })
		check()

		// ---- 7. the final check: a version changed after the critic last saw it (its last patches, or the tuner) is rated as it is, so the score
		// shown is this scene's own. Its patches are not applied (no rounds are left); an earlier version it rates clearly better wins.
		if (finalCheck && rounds > 0 && !refineFailed && !cur.judged && report.refine.length) {
			let critique = null
			try {
				critique = await judge(cur, rounds, rounds, "Final check", cur.parent ? runDiff(cur.parent.sim, cur.sim) : [])
			} catch (e) {
				if (e?.name === "AbortError" || signal.aborted) throw e
				refineFailed = e
				say("warn", "final_check_failed", `The final check couldn't run (${whyFailed(e)}): the last ${cur.tuned ? "tuning" : "changes"} weren't checked by the AI`)
			}
			if (critique) {
				const entry = verdict(critique, report.refine.length + 1, cur, { final: true })
				report.refine.push(entry)
				cur.score = entry.score
				cur.judged = true
				cur.verdict = entry
				if (best && best !== cur && best.judged && goalsOk(best.sim, G(best)) >= goalsOk(cur.sim, G(cur)) && (best.score ?? -1) > (cur.score ?? -1) && physV(best) >= physV(cur)) {
					entry.rejected = `it rated this version lower than an earlier one (${best.score}/10), so the earlier one was kept`
					if (cur.tuned && report.tune) report.tune.reverted = true
					cur = best
					draft(cur, "the better version")
				}
			}
		}
		check()
		// an edit changes what was asked and nothing else: the AI's further changes (the critic's, the tuner's) stay only when they make more of
		// the goals happen; otherwise the version that is exactly what was asked goes on the table (unless it is worse built), and the reply
		// offers to fix it
		if (mode === "edit" && firstV && cur !== firstV && !cur.fixed) {
			const gain = goalsOk(cur.sim, G(cur)) > goalsOk(firstV.sim, G(firstV))
			const firstWorse = firstV.solved.errors.length > cur.solved.errors.length || passIn(firstV).length > passIn(cur).length || floatingIn(firstV).length > floatingIn(cur).length || (firstV.sim.warnings?.length ?? 0) > (cur.sim.warnings?.length ?? 0)
			if (!gain && !firstWorse) {
				cur = firstV
				report.keptAsAsked = true
				draft(cur, "the better version")
			}
		}
		// changes that are not in the version put on the table (an earlier version won) are marked undone
		for (const e of report.refine) if (!e.final && e.changes?.length && !e.rejected && e.round > cur.fromRound) e.reverted = true
		if (report.tune?.changes?.length && !cur.tuned) report.tune.reverted = true

		// an edit's headline is what changed from the scene before it to the scene put on the table (the critic's or the tuner's later changes
		// included: their own lists say which were theirs)
		if (mode === "edit" && cur.scene !== report.edit.firstScene) {
			const net = describeDiff(request.scene, cur.scene)
			report.edit.changes = [...net, ...unseenChanges(report.edit.planChanges), ...goalChanges(basePlan, cur.plan, cur.scene).filter((g) => !net.includes(g))]
			report.edit.noChange = !report.edit.changes.length && report.edit.planChanges.length > 0
		}
		if (report.edit) delete report.edit.firstScene
		// what was not changed: the items of the scene before that are byte for byte as they were ("everything else is exactly as it was")
		if (report.edit) report.edit.unchanged = unchangedItems(request.scene, cur.scene)

		// ---- the report: every number and word about the version put on the table
		const finalPlan = cur.plan
		const scene = cur.scene
		scene.name = (finalPlan.title ?? scene.name ?? "AI scene").toString().slice(0, 80)
		const used = new Map()
		for (const it of scene.items) {
			if (it.type === "table" || (it.type === "wall" && it.props?.invisible_in_3d)) continue
			const u = used.get(it.type) ?? { type: it.type, name: typeName(it.type), count: 0, ids: [] }
			u.count++
			u.ids.push(it.id)
			used.set(it.type, u)
		}
		const missing = [...(Array.isArray(finalPlan.missing) ? finalPlan.missing : [])].filter(isObj).map((m) => ({ asked: String(m.asked ?? m.what ?? "?"), reason: m.reason ? String(m.reason) : "", substitute_type: m.substitute_type ?? m.substitute ?? null }))
		for (const e of cur.solved.errors.filter((x) => x.code === "unknown_type")) missing.push({ asked: e.item ?? e.text, reason: "not in the library", substitute_type: null })
		// an edit or a check that did not write new notes or assumptions has none of its own: the old ones are not shown as this turn's
		const ownPlan = isObj(editOut?.plan) || Array.isArray(editOut?.items)
		const ownNotes = mode === "new" || (mode === "edit" && (editOut?.notes !== undefined || ownPlan))
		const ownAsm = mode === "new" || (mode === "edit" && (editOut?.assumptions !== undefined || ownPlan))
		const ownDiff = mode === "new" || (mode === "edit" && (editOut?.differences !== undefined || ownPlan))
		const asm = !ownAsm ? [] : Array.isArray(finalPlan.assumptions) ? finalPlan.assumptions : typeof finalPlan.assumptions === "string" ? [finalPlan.assumptions] : []
		const notesArr = ownNotes && Array.isArray(finalPlan.notes) ? finalPlan.notes : []
		let assumptions = [...asm, ...notesArr].map(String).filter(Boolean)
		// what differs from the request or the picture, up front: the plan's own list, a mirrored layout (the plan says so in its notes),
		// the stands added so nothing floats, and what of the picture is still not built
		const differences = []
		const addDiff = (t) => {
			t = String(t ?? "").trim()
			if (t && !differences.includes(t)) differences.push(t)
		}
		if (ownDiff) for (const d of Array.isArray(finalPlan.differences) ? finalPlan.differences : []) addDiff(d)
		for (const a of assumptions) if (MIRROR_RE.test(a)) addDiff(a)
		if (ownNotes && typeof finalPlan.notes === "string") for (const sent of finalPlan.notes.split(/(?<=[.!?])\s+/)) if (MIRROR_RE.test(sent)) addDiff(sent)
		assumptions = assumptions.filter((a) => !differences.includes(a))
		const onScreen = new Set((request.scene?.items ?? []).map((i) => i.id))
		const newStands = new Set((cur.solved.supports ?? []).filter((st) => mode === "new" || !onScreen.has(st.id)).map((st) => st.for))
		for (const i of cur.solved.issues) if (i.code === "support_added" && (mode === "new" || newStands.has(i.item))) addDiff(i.text)
		if (report.coverage?.remaining?.length) addDiff(`Not as in your picture: ${andList(report.coverage.remaining)}`)
		report.differences = differences
		report.unsure = (Array.isArray(observation?.uncertain) ? observation.uncertain : []).map(String).filter(Boolean)
		if (images.length && images.some((im) => Math.max(im.width ?? 0, im.height ?? 0) > 0 && Math.max(im.width, im.height) < 512)) report.unsure.unshift("A low-resolution picture: counts and sizes may be off")
		// the plan's own account is what was MEANT to happen (written before any run); what happened comes from the run itself
		report.howItWorks = ownNotes && typeof finalPlan.notes === "string" && finalPlan.notes.trim() ? finalPlan.notes.trim() : null
		report.happened = describeRun(cur.sim, scene, G(cur))
		const v = cur.verdict
		const top = v && v.issues.length ? v.issues.map((t, i) => ({ t, s: SEVERITY[v.severities[i]] ?? 0, i })).sort((a, b) => b.s - a.s || a.i - b.i)[0].t : null
		const fromRun = runProblems(cur.sim, G(cur))
		const unheld = [...floatingIn(cur), ...passIn(cur)].map((i) => i.text.replace(/ \(.*\)$/, ""))
		// the critic's worst remark about this very version, when it is not happy with it or the run shows a failure; then what the run and the solver
		// show. Beside a goal the run says failed, a remark of the critic's about that goal is left out here: it is the critic's reading of the same
		// run (it may say the goal happened while the count says not: "the whole tower is demolished" next to "5 of 6 fell"); the list of checks has it.
		const failedGoals = goalResults(cur.sim, G(cur)).filter((g) => g.ok === false)
		const aboutFailed = (t) => /\bgoal\b/i.test(t) || failedGoals.some((g) => String(g.label ?? "").length > 3 && String(t).toLowerCase().includes(String(g.label).toLowerCase()))
		const critics = top && ((v && (v.score ?? 10) < 8) || fromRun.length) && !(failedGoals.length && aboutFailed(top)) ? [top] : []
		report.problems = [...critics, ...fromRun, ...unheld].filter((t, i, a) => a.indexOf(t) === i).slice(0, 4)
		let stale = null
		for (let p = cur; p && stale === null; p = p.parent) if (p.judged) stale = p.score
		Object.assign(report, {
			title: scene.name,
			plan: finalPlan,
			scene,
			sim: { key: cur.sim.key, ms: cur.sim.ms, summary: cur.sim.summary, warnings: cur.sim.warnings },
			used: [...used.values()],
			missing,
			assumptions,
			// (an "in" goal's ✓ or ✗ says it all; the other kinds say what the run shows: "4 of 40 fell", "first touch at 0.72 s")
			goals: goalResults(cur.sim, G(cur)).map((g) => ({ label: g.label, ok: g.ok, kind: g.kind ?? "in", ...(g.detail && (g.kind ?? "in") !== "in" ? { detail: g.detail } : {}) })),
			solverIssues: cur.solved.issues,
			// the critic's score of THIS scene, or none: a score of an earlier version is never shown as this one's
			score: cur.judged ? cur.score : null,
			scoreState: cur.judged ? "checked" : quick ? "quick" : report.refine.length ? "stale" : refineFailed ? "unchecked" : "none",
			staleScore: cur.judged ? null : stale,
			// which check gave the score shown (the list's entry for the version on the table): "Check 2", "Final check"
			ratedBy: cur.judged && cur.verdict ? (cur.verdict.final ? "Final check" : `Check ${cur.verdict.round}`) : null,
			// the scene this edit or check started from (the card says "Edited: <its name>")
			sceneBefore: mode !== "new" ? request.scene?.name ?? null : null,
			// the version put on the table (each check's entry says which version it looked at: report.refine[i].version)
			version: cur.id,
			scoreNote: cur.judged ? null : report.quickTuned ? "the change stopped a goal; the tuner made it work again (checked by the physics, not looked at by the AI)" : quick ? "a simple change: applied right after its physics run, not looked at by the AI" : refineFailed && !report.refine.length ? "not checked: the check couldn't run" : cur.tuned ? "rated before tuning; not checked again after it" : report.refine.length ? "rated before its last changes; not checked again after them" : null,
			totalMs: Math.round(now() - T0)
		})
		// the reply: what changed in a person's words, what the run shows (each goal now, and before the change), and what to try next
		const beforeRes = mode !== "new" && request.sim?.doc && request.sim?.track ? goalResults(request.sim, G(cur)) : null
		report.goals = report.goals.map((g) => {
			const w = beforeRes?.find((b) => b.label === g.label)
			return w && typeof w.ok === "boolean" ? { ...g, was: w.ok } : g
		})
		// (what was moved only to make room for the change says so: the edit's own trial, and what the solver let go because the change ran into it)
		const room = new Set([...madeRoom, ...(cur.solved?.freed ?? [])])
		let humanList = mode !== "new" ? humanChangeList(request.scene, cur.scene, { room }) : []
		if (mode === "edit") {
			// (with a fix that went on the table too, the change is said first and the fix after it)
			if (report.fixApplied) report.targets = (report.targets ?? []).map((t) => ({ label: t.label, ok: true, implicit: t.implicit, ...(t.was !== undefined ? { was: t.was } : {}) }))
			// (what the request names first, then what had to make room for it, the run's length, the table last)
			const named = namedIn(text, request.scene)
			const rank = (c) => (cur.scene.items.find((i) => i.id === c.id)?.type === "table" ? 3 : c.id === null ? 2 : named.has(c.id) || !request.scene.items.some((i) => i.id === c.id) ? 0 : 1)
			const order = (list) => list.map((c, i) => ({ c, i, r: rank(c) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.c)
			humanList = order(humanList)
			// (a fix that only went on adjusting what the change itself set, "the golf ball 20 cm left" then 1 cm more, is said as one change)
			const fixIds = (report.fixApplied?.changes ?? []).flatMap((c) => (c.kind === "move" ? c.ids : [c.id]))
			const oneChange = report.fixApplied && fixIds.length > 0 && fixIds.every((id) => touched.has(id))
			const asked = report.fixApplied && firstV && !oneChange ? order(humanChangeList(request.scene, firstV.scene, { room })) : humanList
			if (report.fixApplied && report.edit) report.edit.noChange = false
			// (a change the scene shows, a rename too, is a change: never "that's already how it is")
			if (report.edit && humanList.length) report.edit.noChange = false
			report.lead = editLead({ changes: asked.map((c) => c.text), who: asked.map((c) => c.name), targets: report.targets ?? [], noChange: !!report.edit?.noChange && !report.fixApplied, fixApplied: oneChange ? null : report.fixApplied })
		} else report.lead = leadSentence({ mode, title: report.title, changes: humanList.map((c) => c.text), who: humanList.map((c) => c.name), goals: report.goals, noChange: !!report.edit?.noChange, score: report.score })
		report.human = humanList.map((c) => c.text)
		report.planned = typeof editOut?.reply === "string" ? editOut.reply : typeof finalPlan.reply === "string" ? finalPlan.reply : null
		report.suggestions = cleanSuggestions(editOut?.suggestions ?? finalPlan.suggestions ?? report.initialPlan?.suggestions)
		const concept = [finalPlan.concept_image, finalPlan.conceptImage, report.initialPlan?.concept_image].find((u) => typeof u === "string" && /^data:image\/|^https?:\/\//.test(u))
		if (concept) report.concept = concept
		report.models = [...new Set(report.calls.map((c) => c.model).filter(Boolean))]
		return report
	}

	/**
	 * The fix search (./fixer.js) for an edit that stopped a goal: on the page's fix workers when there are any (deps.fixPool(): several runs at
	 * once, off the page's thread), each found fix checked once more on the app's own engine (simulate) before it is offered.
	 * ctx: an edit report's fixCtx. -> findFix's answer
	 */
	async function findFix(ctx, { signal, onProgress, budgetMs = FIX_MS } = {}) {
		let pool = null
		try {
			pool = deps.fixPool?.() ?? null
		} catch {}
		const usePool = !!pool && !pool.broken
		return searchFix(ctx, { evaluate: usePool ? pool.evaluate : undefined, simulate, verify: simulate, parallel: usePool ? pool.size : 2, signal, onProgress, budgetMs })
	}

	return { build, call: (step, payload, signal) => call(step, payload, signal, { calls: [] }), findFix, fixInfo }
}
/** The fix-search answer as the report keeps it (no runs; the scenes as JSON, so a reload can still apply them). */
export function fixInfo(fr, scene, targets = null, report = null) {
	const tg = targets ?? fr?.targets ?? []
	const explicit = tg.filter((t) => !t.implicit)
	const first = (explicit.length ? explicit : tg)[0]
	const checked = !tg.length ? null : tg.length === 1 || explicit.length === 1 ? first.label : explicit.length > 1 ? `all ${explicit.length} goals` : first.label
	const out = { state: fr?.status === "found" ? "found" : "none", checked: checked ? String(checked).replace(/[.!]+$/, "") : null, goal: first?.label ?? null, runs: fr?.runs ?? 0, ms: fr?.ms ?? 0 }
	const res = (list) => (Array.isArray(list) ? list.map((r, i) => ({ label: r.label, ok: r.ok, ...(tg[i]?.implicit ? { implicit: true } : {}) })) : [])
	if (fr?.status === "found") Object.assign(out, { say: fr.fix.words.say, did: fr.fix.words.did, label: fr.fix.words.label, sceneJSON: JSON.stringify(fr.fix.scene), changes: fr.fix.changes, results: res(fr.fix.results), ...(fr.fix.fragile ? { fragile: true } : {}) })
	if (fr?.near) out.near = { say: fr.near.words.say, did: fr.near.words.did, label: fr.near.words.label, happened: fr.near.happened ?? null, sceneJSON: JSON.stringify(fr.near.scene), results: res(fr.near.results) }
	return out
}
/** What happens instead of a failed goal, in words, or null (never throws). */
function safeWords(r, goal, sim, scene, before = null) {
	try {
		return outcomeWords(r, goal, sim, scene, before)
	} catch {
		return null
	}
}
/** The plan of a scene a fix changed: read from the scene itself (so a later edit starts from where things are now), keeping the old plan's
 *  goals (every kind), knobs, stages and words. */
export function planAfterFix(plan, scene) {
	let p
	try {
		p = planFromScene(scene)
	} catch {
		return plan
	}
	for (const k of ["title", "goals", "tune", "stages", "missing", "notes", "assumptions", "differences", "seconds", "release", "covers"]) if (plan?.[k] !== undefined) p[k] = clone(plan[k])
	return p
}

/** The promise, or an AbortError as soon as the signal fires (whether or not the request itself listens to it). */
const raceAbort = (p, signal) =>
	new Promise((resolve, reject) => {
		if (signal.aborted) return reject(abortError())
		const onAbort = () => reject(abortError())
		signal.addEventListener("abort", onAbort, { once: true })
		p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort))
	})
/** A placement change in words: "Ramp: angle −18° → −27°", "Ball: now on the box", "Cup: x 1.20 → 1.45 m". */
function describePlace(name, a, b, solved) {
	a = isObj(a) ? a : {}
	const parts = []
	const deg = (v) => `${Math.round(v * 10) / 10}°`
	const ang = (pl) => num(pl.angle_deg) ?? (pl === a ? solved?.angle : null)
	if (num(b.angle_deg) !== null && ang(a) !== num(b.angle_deg)) parts.push(ang(a) !== null && ang(a) !== undefined ? `angle ${deg(ang(a))} → ${deg(b.angle_deg)}` : `angle ${deg(b.angle_deg)}`)
	const xa = num(a.x) ?? solved?.x
	if (num(b.x) !== null && (xa === undefined || xa === null || Math.abs(xa - b.x) > 1e-4)) parts.push(xa !== undefined && xa !== null ? `x ${xa.toFixed(2)} → ${b.x.toFixed(2)} m` : `at x ${b.x.toFixed(2)} m`)
	if (num(b.y_m) !== null && num(a.y_m) !== num(b.y_m)) parts.push(`height ${b.y_m.toFixed(2)} m`)
	if (b.on !== undefined && b.on !== a.on) parts.push(b.on === "air" ? "now in the air" : `now on ${b.on === "table" ? "the table" : b.on}`)
	if (b.inside !== undefined && b.inside !== a.inside) parts.push(`now inside ${b.inside}`)
	if (b.lean && JSON.stringify(b.lean) !== JSON.stringify(a.lean)) {
		const end = (e) => (!isObj(e) ? "?" : e.on === "air" ? `${num(e.y) !== null ? `${fmtM(num(e.y))} up` : "in the air"} at x ${num(e.x)?.toFixed(2) ?? "?"}` : `${e.on === "table" ? "the table" : e.on}${num(e.x) !== null ? ` at x ${num(e.x).toFixed(2)}` : ""}`)
		parts.push(`now runs from ${end(b.lean.from)} to ${end(b.lean.to)}`)
	}
	for (const side of ["left_of", "right_of"]) if (b[side] && JSON.stringify(b[side]) !== JSON.stringify(a[side])) parts.push(`${side.replace("_", " ")} ${b[side].id ?? b[side]}${num(b[side].gap_m) !== null ? ` (${fmtM(b[side].gap_m)} gap)` : ""}`)
	return parts.length ? `${name}: ${parts.join(", ")}` : `${name} placed anew`
}
const sameScene = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

// ================================================================ an edit changes what was asked, and nothing else
/** What an item's place depends on: the ids it rests on, sits in, leans on or is placed beside. */
const placeRefs = (it) => {
	const p = isObj(it?.place) ? it.place : {}
	const out = []
	for (const r of [p.on, p.inside, p.lean?.from?.on, p.lean?.to?.on, isObj(p.left_of) ? p.left_of.id : p.left_of, isObj(p.right_of) ? p.right_of.id : p.right_of]) if (typeof r === "string" && r !== "air") out.push(r)
	return out
}
/** Two items' settings, a prop left out being its default. */
const sameProps = (a, b) => {
	for (const k of new Set([...Object.keys(a?.props ?? {}), ...Object.keys(b?.props ?? {})])) if (!sameValue(propValue(a, k), propValue(b, k))) return false
	return true
}
const sameKind = (a, b) => !!a && !!b && a.type === b.type && !!a.held === !!b.held && !!a.fixed === !!b.fixed && sameProps(a, b)
/**
 * The plan to solve for an edit (or a check) of the scene on the table: every item the change did not touch (the same entry as in the plan the
 * scene was built from, and everything it rests on untouched too) is held at its exact pose in `ref` (on "air", keep), so the solver puts it back
 * where it was to the last digit, and what was changed rests on the very same supports. -> {plan (a copy), pinned: Set of ids}
 */
export function pinUntouched(plan, basePlan, ref, free = new Set()) {
	const R = new Map((ref?.items ?? []).map((i) => [i.id, i]))
	const B = new Map((basePlan?.items ?? []).filter(isObj).map((i) => [i.id, i]))
	const P = new Map((plan?.items ?? []).filter(isObj).map((i) => [i.id, i]))
	const tableSame = JSON.stringify(plan?.table ?? null) === JSON.stringify(basePlan?.table ?? null)
	const memo = new Map()
	const untouched = (id, path = new Set()) => {
		if (id === "table") return tableSame
		if (memo.has(id)) return memo.get(id)
		if (path.has(id)) return false
		path.add(id)
		const it = P.get(id)
		const b = B.get(id)
		const r = R.get(id)
		const ok = !free.has(id) && !!(it && b && r) && sameKind(it, b) && sameKind(it, r) && JSON.stringify(it.place ?? null) === JSON.stringify(b.place ?? null) && placeRefs(it).every((x) => untouched(x, path))
		memo.set(id, ok)
		return ok
	}
	const top = Number(ref?.items?.find((i) => i.type === "table")?.y) || 0
	const out = clone(plan)
	const pinned = new Set()
	for (const it of out.items ?? []) {
		if (!isObj(it) || !untouched(it.id)) continue
		const r = R.get(it.id)
		it.place = { on: "air", x: Number(r.x) || 0, y_m: (Number(r.y) || 0) - top, angle_deg: Number(r.angle) || 0, keep: true }
		pinned.add(it.id)
	}
	return { plan: out, pinned }
}
/**
 * After the solve: each item that came back where it was, the same kind, gets its exact entry from `ref` (byte for byte: name, props as written,
 * key order), the items keep their order in the scene (the engine builds them in that order), and the scene keeps its id, stage and goals when
 * they are the same. Returns the ids that are exactly as they were.
 */
export function restoreExact(scene, ref) {
	const R = new Map((ref?.items ?? []).map((i, k) => [i.id, { i, k }]))
	const same = new Set()
	const near = (a, b, tol) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol
	scene.items = scene.items.map((it) => {
		const r = R.get(it.id)?.i
		if (!r || !sameKind(it, r) || (it.name ?? typeName(it.type)) !== (r.name ?? typeName(r.type))) return it
		if (!near(it.x, r.x, 1e-6) || !near(it.y, r.y, 1e-6) || !near(it.angle, r.angle, 1e-6)) return it
		same.add(it.id)
		return clone(r)
	})
	const order = (it) => R.get(it.id)?.k ?? Infinity
	scene.items = scene.items.map((it, k) => ({ it, k })).sort((a, b) => order(a.it) - order(b.it) || a.k - b.k).map((x) => x.it)
	if (ref?.id) scene.id = ref.id
	if (isObj(ref?.stage) && ["x0", "x1", "y0", "y1"].every((k) => near(scene.stage?.[k], ref.stage[k], 1e-9))) scene.stage = clone(ref.stage)
	const gk = (g) => `${g.item}|${g.container}|${g.label ?? ""}`
	if (Array.isArray(ref?.goals) && Array.isArray(scene.goals) && ref.goals.length === scene.goals.length && ref.goals.every((g, i) => gk(g) === gk(scene.goals[i]))) scene.goals = clone(ref.goals)
	return same
}
/** The items of `ref` (but the table and the safety walls) that are exactly the same in `scene`, and how many there were. */
export function unchangedItems(ref, scene) {
	const S = new Map((scene?.items ?? []).map((i) => [i.id, JSON.stringify(i)]))
	const real = (ref?.items ?? []).filter((i) => i.type !== "table" && !isSafetyWall(i))
	const same = real.filter((i) => S.get(i.id) === JSON.stringify(i))
	return { same: same.length, of: real.length, ids: same.map((i) => i.id) }
}

/** A plain sentence for what went wrong talking to the AI. */
function plainError(msg, step) {
	const m = String(msg)
	if (/failed to fetch|networkerror|load failed/i.test(m)) return "Couldn't reach the AI service (network)"
	if (/rate|429|too many/i.test(m)) return "The AI service is busy right now (rate limited)"
	if (/key|auth|401|403/i.test(m)) return "The AI service refused the request (its key or access)"
	return `The ${step} step failed: ${m.replace(/^Error:\s*/, "").slice(0, 300)}`
}
