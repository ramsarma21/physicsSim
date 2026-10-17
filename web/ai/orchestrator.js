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
// A new scene is physics first (ai/DESIGN.md §13.2, the round-3 search experiment): right after its first run, every goal and stage check is made
// to happen in the engine stage by stage (./stage-tune.js, on the fix workers when the page has them), and the tuned plan, run on the app's own
// engine, is the version the critic first sees when every check works in it. The critic is shown the first stage that still fails, with what the tuner measured; a version
// that loses a check that passed is not taken; the final look at a version changed after the critic last saw it is a rate-only check (§13.3).
// Every model call goes to POST /api/ai/<step> {payload, client: {requestId}} -> {ok, result, model, ms, usage} (same URL on the local server and on
// Vercel). Nothing here holds a key: the server runs the fixed prompt for each step. Runs go through the app's normal /api/simulate.
// Refusals the person must act on are their own kinds (never "Try again"): sign_in (sign in with Google), quota (today's allowance, with
// resetsAt), off (this deployment has no AI), access (an invite link, or an account that may not use it).
import { solve, planFromScene, inspect, typeName, propKeys, propSpec, isStaticItem, holdsItselfUp, itemGeometry, shapesAt } from "./solver.js"
import { checkGoals, goalItems, goalRefs, goalKind as goalKindOf, goalLabel } from "./goals.js"
import { createStageTuner, judgeRun as judgeStages } from "./stage-tune.js"
import { quotaWords, resetWords, OFF_WORDS, SIGN_IN_WORDS } from "./access.js"
export { quotaWords, resetWords, OFF_WORDS, SIGN_IN_WORDS }
import { findFix as searchFix, restageFix, TIME_SCALE, probeRun, fixTargets, judge as judgeTargets, outcomeWords, FIX_MS, riderMap, groupNames, chainStop, tippers as fixerTippers, chainBreak, claimLabel, characterBreak, placeName, standardSized, containerKind, STD_SIZE, dimKeys, offRealSize, helperSizeBreak, farness, chainOf, frozenChanged } from "./fixer.js"
import { build as buildDoc, catalog as simCatalog, MATERIALS, layout as simLayout, inside as simInside } from "../sim/index.js"
import { conceptRoute, pickConcept, withDeadline, dropPictureLines, dropPictureSentences, mentionsPicture, CONCEPT_LABEL, CONCEPT_NOTE, IMAGINE_DEADLINE_MS } from "./imagine.js"
import { routeKind, REPLY_KINDS, cleanTargets, targetWords, overlapFeedback, fixFeedback, newOverlaps, headsUpLines, lastUserTurn, namedInTurn, aimReply } from "./edit-turns.js"
import { aimContainer } from "./aim.js"
import { kindNoun, aKindOf, weightOf, imperative, solidMass, clipLabel, changesLabel, tidyBrackets } from "./words.js"
export { isChainRequest, conceptPlan, conceptRoute, CONCEPT_NOTE, CONCEPT_LABEL, IMAGINE_MODES, imagineMode } from "./imagine.js"

export const MAX_IMAGES = 4
export const IMAGE_MAX_PX = 1536
export const IMAGE_QUALITY = 0.85
const MAX_BODY = 12 << 20
export const REFINE_ROUNDS = 3
export const TUNE_RUNS = 40
export const TUNE_MS = 20000
export const MAKE_IT_WORK_MS = 60000 // the background "make it work" after a change stopped a goal: the searches and the AI's reworks, in all (§16.2)
export const REWORKS = 2 // the AI's reworks tried side by side, each its own way (REWORK_ORDER), each answering once
export const AI_CALLS = 2 // the most model calls the AI's reworks may make for one broken edit, in all: a creative scene's rework call costs $0.04–0.11
// (measured live, 16 Oct: three calls came to $0.18–0.23, over the ≈ $0.15 a broken edit may spend in the background)
export const AI_USD = 0.15 // the most the AI's reworks may spend for one broken edit, in dollars: finished calls at their billed cost, calls still
// running at an estimate from what the model has thought and written so far (AI_IN_USD + tokens × AI_OUT_USD); past it, the youngest running
// call is stopped (V8820/VERIFY: two reworks cost $0.076–0.142, one call alone up to $0.086, so two of those would be ≈ $0.17)
export const AI_IN_USD = 0.03
export const AI_OUT_USD = 0.000025
// (a running call's input, from the size of what it sends: ≈ 4 characters a token at the uncached input price, never below AI_IN_USD, nor below
// the last billed call on this scene (`floor`): a big scene's rework call was billed $0.074–0.147 against the flat $0.03 it was counted at, and
// two of them ran past AI_USD (V8837 k3: $0.169, $0.220))
export const AI_IN_TOKEN_USD = 0.000004
export const AI_CALL_MARGIN = 1.3 // (a rework call is counted at the last billed call on this scene times this, at least, while it runs or before it
// starts: its reasons make its prompt longer than the edit's own (V8841 k3: $0.079 and $0.090 against the edit's $0.063); and another is started
// only when one more like that still fits)
/** One more "make it work" round fits its budget: what the edit calls cost so far, and one more like the last one, within `cap`; and time
 *  for the round and the fix search after it (30 s) before `deadline`. */
export function roundBudget(calls, { cap = AI_USD, deadline = null, now = Date.now() } = {}) {
	const edits = (Array.isArray(calls) ? calls : []).filter((c) => c?.step === "edit")
	const spent = edits.reduce((t, c) => t + (num(c?.usage?.costInUSD) ?? 0), 0)
	const last = num(edits.at(-1)?.usage?.costInUSD) ?? AI_IN_USD
	return spent + last <= cap + 1e-9 && (deadline === null || now < deadline - 30000)
}
export const inputUsd = (chars) => Math.max(AI_IN_USD, ((Number(chars) || 0) / 4) * AI_IN_TOKEN_USD)
// (a token written to the prompt cache costs this much more than one read from it (fitted on 445 billed edit calls: $5 against $0.2 a million):
// the first call after the cache expires was billed $0.25–0.28, a warm one $0.03 (V8843: 4 cold-cache calls in one bench))
export const AI_CACHE_WRITE_USD = 0.0000048
/** A call's cost as it would be billed with a warm prompt cache (its one-off cache write taken off): the floor a rework is counted from. */
export function warmUsd(usage) {
	const c = num(usage?.costInUSD)
	if (c === null) return null
	const made = num(usage?.cache_creation_input_tokens) ?? 0
	return Math.max(Math.min(c, AI_IN_USD), c - made * AI_CACHE_WRITE_USD)
}
export const AI_FLOOR_MAX = 0.6 * AI_USD // (the floor never above this: a bigger one leaves no room for any rework)
export const AI_REWORK_X = 2.2 // (a rework call is reserved at this many times the edit's own call: its reasons and its way make its prompt and its answer longer (V8842 y5: 2.15×))
export const AI_REWORK_TIME = 1.3 // (and it takes about this many times as long, plus its own search and check)
/** The least time left for a background rework: its call (AI_REWORK_TIME × the edit's own call on this scene, when measured), 8 s for its
 *  own search and check, never under REWORK_MIN_MS. */
export const reworkNeedMs = (editMs) => Math.max(REWORK_MIN_MS, num(editMs) !== null ? AI_REWORK_TIME * editMs + 8000 : 0)
export const REPAIR_MS = 18000 // the one repair turn after an edit that starts things inside each other: past this, the answer as it was stays
export const PHYS_FIRST_MS = 15000 // a typed "make it work": the physics' own search on the scene as it is, beside the AI's first answer
export const PHYS_FIRST_RUNS = 40 // (and at least this many runs, on a busy machine, up to the request's own deadline: V8842 x42d found its fix in 39)
export const AI_AFTER_MS = 20000 // the AI is asked once the physics has looked everywhere (both searches done), or found nothing in this long
export const SEARCH_MS = 30000 // the fix search's own budget in the background (its runs: SEARCH_RUNS)
export const SEARCH_RUNS = 1400
export const SEARCH_MIN_RUNS = 240 // a heavy scene's search goes on past SEARCH_MS (to SEARCH_HARD_MS) until it has run this many, while the AI works
export const SEARCH_HARD_MS = 45000
export const REWORK_MIN_MS = 28000 // the least time a background rework needs (its call, its own fix search, the check): with less left it isn't asked
export const RESTAGE_MS = 25000 // stage by stage: the chain's receivers set up again (./fixer.js restageFix)
const cap = (s) => String(s ?? "").replace(/^./, (c) => c.toUpperCase())
/** The stage tuner before the critic (a new scene): its most engine runs, per stage and in all, and its time. */
export const STAGE_RUNS = 150
export const STAGE_RUNS_PER = 30
export const STAGE_MS = 30000
const TUNE_PARALLEL = 3
/** Client-side ceiling per model step: above the server's own budgets (ai/models.json budgetMs + its 15 s margin), so this only stops a hung request. */
const STEP_TIMEOUT = { observe: 340000, plan: 460000, edit: 280000, refine: 340000, imagine: 170000 }
const RETRY_DELAY = 1500

export const STEP_LABELS = {
	observe: "Looking at your images",
	plan: "Planning the scene",
	edit: "Working out the change",
	solve: "Placing everything",
	simulate: "Running the physics",
	render: "Taking a picture",
	stagetune: "Tuning stage by stage",
	refine: "Checking and refining",
	tune: "Tuning to hit the goals",
	fix: "Finding a fix",
	reconcile: "Matching your picture",
	imagine: "Picturing the scene",
	apply: "Putting it on the table"
}

export class AiError extends Error {
	/** kind: "gateway" | "busy" | "timeout" | "invalid" | "nothing" | "engine" | "cancelled" | "input" | "sign_in" | "quota" | "off" | "access"
	 *  (quota: resetsAt (ISO time) and scope "user" | "hour" | "site") */
	constructor(kind, message, { retryable = false, step = null, cause = null, resetsAt = null, scope = null, code = null } = {}) {
		super(message)
		this.name = "AiError"
		this.kind = kind
		this.retryable = retryable
		this.step = step
		if (resetsAt) this.resetsAt = resetsAt
		if (scope) this.scope = scope
		if (code) this.code = code
		if (cause) this.cause = cause
	}
}
/** Kinds the person has to act on (sign in, wait for the allowance, another deployment): never offered "Try again". */
export const ACTION_KINDS = new Set(["sign_in", "quota", "off", "access"])

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
/**
 * The goals about an item that name it by what it was, named by what it is now (in place, plan.goals): olds -> now (a proper name, "Ball 2",
 * becomes "the egg" when the new name is a kind's: "The egg lands in the box"; "the 8-ball" becomes "the bowling ball", never "the Bowling
 * ball"); in a goal about several things, oldPlurals -> nowPlural ("All ten pins fall" -> "All ten water bottles fall").
 */
/** Words that link a name into a sentence ("bounces off pad 1", "lands in box"), never a word that describes it ("the bowling ball"). */
const LINK_WORDS = new Set(["off", "on", "onto", "into", "in", "at", "to", "from", "by", "with", "of", "over", "past", "under", "and", "or", "than", "hits", "hit", "strikes", "knocks", "reaches", "toward", "towards", "its", "their", "his", "her", "each", "every", "all", "both", "first", "last", "next", "then"])
export function relabelGoals(plan, id, olds, now, oldPlurals = [], nowPlural = null, oldHead = null, { any = false, short = null } = {}) {
	if (!Array.isArray(plan?.goals) || !now) return
	const proper = (w) => /\d/.test(w) || /^[A-Z][a-z'’]+ [A-Z]/.test(w)
	const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const swaps = [...new Set(olds.filter((w) => typeof w === "string" && w.trim() && w.toLowerCase() !== now.toLowerCase()))].map((o) => [o, now])
	// (the new thing's noun, without its number or what it is "on" or "with": "bowling ball" for "Bowling ball on a rope")
	const nowNoun = String(now).toLowerCase().split(/\s+(?:on|with|of|in|for|from)\s+/)[0].replace(/\s+\d+$/, "").trim().split(/\s+/).filter(Boolean)
	const oldWords = new Set(olds.filter((w) => typeof w === "string").join(" ").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
	const newOnly = new Set(nowNoun.filter((w) => !oldWords.has(w)))
	for (const g of plan.goals) {
		// (any: a goal that only mentions the thing, "…sails over the cone into the bucket", for a thing taken away and replaced)
		if (!isObj(g) || typeof g.label !== "string" || (!any && !goalRefs(g).includes(id))) continue
		// (a label that already says the new name, the AI's own "The tennis ball drops into the cup", is left as it is: never "the tennis tennis ball")
		if (new RegExp(`(^|[^\\p{L}])${esc(String(now))}([^\\p{L}]|$)`, "iu").test(g.label)) continue
		// (nor one that already says the new thing's noun: "The bowling ball hits…" for a "Bowling ball on a rope", never "The bowling bowling ball
		// on a rope"; "the barrel cup" for a "Wooden barrel cup", never "the barrel wooden barrel cup": V8817 m6, c04)
		if (nowNoun.length >= 2 && new RegExp(`(^|[^\\p{L}])${esc(nowNoun.slice(-2).join(" "))}([^\\p{L}]|$)`, "iu").test(g.label)) continue
		const many = goalItems(g).length > 1
		// (a goal about this one thing that says its kind's last word once, "the marble ends in the cup" for a glass marble, says the new one)
		const head = !many && oldHead && oldHead.length > 2 && new RegExp(`\\b${esc(oldHead)}\\b`, "gi").test(g.label) && (g.label.match(new RegExp(`\\b${esc(oldHead)}\\b`, "gi")) ?? []).length === 1 && !swaps.some(([o]) => new RegExp(`\\b${esc(o)}\\b`, "i").test(g.label)) ? [[oldHead, now]] : []
		const pairs = [...swaps, ...head, ...(many && nowPlural ? oldPlurals.filter((w) => typeof w === "string" && w.trim() && w.toLowerCase() !== String(nowPlural).toLowerCase()).map((o) => [o, nowPlural]) : [])].sort((x, y) => y[0].length - x[0].length)
		for (const [o, to] of pairs) {
			const label = g.label
			// (a number right after the old word is the thing's own number: "pad 1" -> "Trampoline 1", never "Trampoline 1 1" (c09, 16 Oct); a word
			// joined to the old one by a hyphen is part of its name: "the 8-ball" -> "the golf ball", never "the 8-golf ball")
			const toNum = /\s(\d+)$/.exec(String(to))?.[1] ?? null
			g.label = label.replace(new RegExp(`(\\b(?:the|a|an)\\s+)?(?<![\\p{L}\\p{N}-])(?:[\\p{L}\\p{N}]+-)?${esc(o)}(?![\\p{L}\\p{N}-])(\\s+\\d+\\b)?`, "giu"), (m, art, n, off) => {
				// (a word of the new name right before it: the label already names the new thing, "the barrel cup")
				const prev = /([\p{L}]+)\s+$/u.exec(label.slice(0, off))?.[1]?.toLowerCase()
				if (!art && prev && newOnly.has(prev)) return m
				// (the old kind's last word alone, "ball" of a wrecking ball, only after "the"/"a" or the old kind's own words: "the bowling ball"
				// is the AI's own word for the new thing, never "the bowling rope pendulum")
				if (o === oldHead && !art && prev && !oldWords.has(prev) && !LINK_WORDS.has(prev) && !/[:.!?]\s*$/.test(label.slice(0, off))) return m
				const start = off === 0 || /[:.!?]\s*$/.test(label.slice(0, off))
				let w = proper(to) ? to : lc(to)
				const tail = n && !(toNum && n.trim() === toNum) && !toNum ? n : ""
				if (art) return `${art}${w}${tail}`
				if (proper(o) && !proper(to)) w = `the ${w}`
				return (start ? w.replace(/^./, (c) => c.toUpperCase()) : w) + tail
			})
		}
		// (the old kind's word left in a goal about several things, "The bowling ball hits the head pin" for a pin that is now a water bottle: the
		// new kind's, its place word kept, "the first water bottle" (V8832 c03), when no other thing of the goal is still of that kind)
		if (short && oldHead && oldHead.length > 2 && goalRefs(g).includes(id)) {
			const others = goalRefs(g).filter((x) => x !== id).map((x) => (plan.items ?? []).find((i) => i?.id === x)).filter(Boolean)
			const stillOld = others.some((o) => new RegExp(`\\b${esc(oldHead)}\\b`, "i").test(`${o.name ?? ""} ${kindNoun(o.type, 1, { short: true }) ?? ""}`))
			const re = new RegExp(`\\b(the|a|an)\\s+(?:([\\p{L}]+)\\s+)?${esc(oldHead)}\\b(?!\\s*\\d|-)`, "giu")
			if (!stillOld && re.test(g.label)) {
				const PLACE = { head: "first", lead: "first", front: "first", leading: "first", first: "first", last: "last", end: "last", back: "last", rear: "last", top: "top", bottom: "bottom", second: "2nd", third: "3rd", middle: "middle" }
				g.label = g.label.replace(re, (m, art, mod, off) => {
					// (only a place word, "the head pin", or the old kind's own word: any other word before it is the AI's own name for the new thing,
					// "the bowling ball" of a rope pendulum, and stays)
					if (mod && !PLACE[mod.toLowerCase()] && !oldWords.has(mod.toLowerCase())) return m
					const word = mod ? PLACE[mod.toLowerCase()] ?? null : null
					const out = `${art.toLowerCase() === "the" || word ? "the" : art.toLowerCase()} ${word ? `${word} ` : ""}${String(short).toLowerCase()}`
					return off === 0 ? cap(out) : out
				})
			}
		}
	}
}
/** A goal label's words for a thing the request swapped away, "the giant" of "swap the giant domino for a stack of hardcover books", said as
 *  what took its place: "The stack of hardcover books knocks the bowling ball into the bucket" (V8832 c02: "The giant knocks …" after the giant
 *  was taken away). In place, plan.goals. */
const SWAP_PHRASE_RE = /\b(?:swap|replace|switch|exchange|trade)\s+(?:out\s+)?(?:the\s+)?([\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,2}?)\s+(?:for|with)\s+(?:a|an|the|some)?\s*(?:(stack|pile|tower|row|line|set)\s+of\s+)?(?:\d+\s+|one\s+|two\s+|three\s+|four\s+|five\s+|six\s+)?([\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2}?)(?=\s*(?:[,.;!?]|$)|\s+(?:and|then|so|but|on|in|next|by|to)\b)/giu
export function swapPhraseLabels(plan, text) {
	if (!Array.isArray(plan?.goals)) return
	const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const kinds = catalogKinds()
	for (const m of String(text ?? "").matchAll(SWAP_PHRASE_RE)) {
		const x = m[1].trim().toLowerCase()
		const y = `${m[2] ? `${m[2].toLowerCase()} of ` : ""}${m[3].trim().toLowerCase()}`
		if (!x || !y || x === y) continue
		// (the whole phrase, "the giant domino"; else its first word when it is no kind of its own, "the giant")
		const words = x.split(/\s+/)
		const forms = [x, ...(words.length > 1 && !kinds.has(words[0]) && !kinds.has(words[0].replace(/s$/, "")) && words[0].length > 3 ? [words[0]] : [])]
		// (a word of the phrase that, with the next one, names another thing on the table or in the catalog is that other thing: "the glass jar" is
		// never "the steel ball jar" after "swap the glass marble for a steel ball" (V8842 n3))
		const names = new Set([...kinds.keys(), ...(Array.isArray(plan.items) ? plan.items : []).flatMap((i) => [i?.name, kindNoun(i?.type, 1, { short: true }), kindNoun(i?.type, 2, { short: true })]).filter(Boolean).map((n) => String(n).toLowerCase())])
		const another = (f, rest) => {
			const next = /^\s+([\p{L}'’-]+)(?:\s+([\p{L}'’-]+))?/u.exec(rest)
			if (!next) return false
			const two = `${f} ${next[1]}`.toLowerCase()
			return names.has(two) || names.has(two.replace(/s$/, "")) || (!!next[2] && names.has(`${two} ${next[2].toLowerCase()}`))
		}
		for (const g of plan.goals) {
			if (!isObj(g) || typeof g.label !== "string") continue
			for (const f of forms) {
				const re = new RegExp(`\\bthe\\s+${esc(f)}\\b(?!\\s+(?:${words.slice(1).map(esc).join("|") || "\\u0000"})\\b)`, "giu")
				if (!re.test(g.label)) continue
				let hit = false
				const out = g.label.replace(re, (mm, off, all) => (another(f, all.slice(off + mm.length)) ? mm : ((hit = true), off === 0 ? `The ${y}` : `the ${y}`)))
				if (!hit) continue
				g.label = out
				break
			}
		}
	}
}
/**
 * Goals after a row was replaced (a = the scene before, b = after; goals changed in place; followed: Map old label -> new): a row swapped into
 * one thing of a kind, with more of that kind added, falls as all of them ("All the cereal boxes fall"); and once a growing row (its last one
 * "the giant") is gone, no label names the giant any more ("…, up to the giant" dropped; "The giant knocks the tennis ball into the bucket" ->
 * "The tennis ball lands in the bucket"). -> whether a goal changed.
 */
export function tidyGoneLabels(goals, a, b, followed = new Map()) {
	if (!Array.isArray(goals) || !a?.items || !b?.items) return false
	const at = new Map(b.items.map((i) => [i.id, i]))
	const was = new Map(a.items.map((i) => [i.id, i]))
	let changed = false
	const set = (g, label) => {
		if (!label || label === g.label) return
		followed.set(g.label, label)
		g.label = label
		changed = true
	}
	// (1) a row turned into one thing, its kind's others added beside it
	for (const g of goals) {
		if (!isObj(g) || goalKindOf(g) !== "falls") continue
		const ids = goalItems(g)
		if (ids.length !== 1) continue
		const r0 = was.get(ids[0])
		const r1 = at.get(ids[0])
		if (!r0 || !r1 || r0.type === r1.type || !/-row$/.test(r0.type) || /-row$/.test(r1.type)) continue
		const more = b.items.filter((i) => i.type === r1.type && i.id !== r1.id && !was.has(i.id))
		if (!more.length) continue
		g.items = [r1, ...more].sort((p, q) => (Number(p.x) || 0) - (Number(q.x) || 0)).map((i) => i.id)
		delete g.item
		set(g, `All the ${kindNoun(r1.type, 2, { short: true })} fall`)
	}
	// (2) a growing row gone (taken away or swapped into another kind): its giant with it
	const giantGone = a.items.some((i) => i.type === "domino-row" && (num(i.props?.growth) ?? 1) > 1.05 && at.get(i.id)?.type !== "domino-row")
	if (giantGone && !b.items.some((i) => i.type === "domino-row" && (num(i.props?.growth) ?? 1) > 1.05))
		for (const g of goals) {
			if (!isObj(g) || typeof g.label !== "string" || !/\bgiant\b/i.test(g.label)) continue
			let label = g.label.replace(/,?\s*(?:all the way |right )?up to (?:and including )?the giant(?: domino)?\b/i, "")
			if (goalKindOf(g) === "falls") label = label.replace(/\bgrowing\s+/i, "")
			if (/\bthe giant\b/i.test(label) && goalKindOf(g) === "in" && at.has(g.item) && at.has(g.container)) label = `${cap(theName(at.get(g.item)))} lands in ${theName(at.get(g.container))}`
			if (goalKindOf(g) === "falls" && /^the [\p{L} ]+ fall$/iu.test(label.trim())) label = `All ${label.trim().replace(/^The/, "the")}`
			set(g, label.trim())
		}
	return changed
}
/** Goal labels that name one of a row of things by a numbered name that is only its kind's ("It bounces off Trampoline 3"), said by its place
 *  as the lead and the offer say it: "It bounces off the last trampoline" (V8832 c09). items: the plan's things with where they stand. */
export function placeLabels(goals, items, text = "") {
	if (!Array.isArray(goals) || !Array.isArray(items)) return
	const scene = { items }
	const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	for (const it of items) {
		const nm = String(it?.name ?? "")
		if (!/\s\d+$/.test(nm) || !Number.isFinite(Number(it.x))) continue
		// (a name the person said themselves, "land in cup 3", stays as they said it)
		if (new RegExp(`\\b${esc(nm)}\\b`, "i").test(String(text ?? ""))) continue
		if (items.some((o) => o.type === it.type && !Number.isFinite(Number(o.x)))) continue
		const said = placeName(it, scene)
		if (!said || said.toLowerCase() === nm.toLowerCase() || !/^the /.test(said)) continue
		const re = new RegExp(`(\\bthe\\s+)?\\b${esc(nm)}\\b`, "gi")
		for (const g of goals) if (isObj(g) && typeof g.label === "string" && re.test(g.label)) g.label = g.label.replace(re, (mm, art, off) => (off === 0 ? cap(said) : said))
	}
}
export function applyPatches(planIn, patches, scene = null) {
	const plan = clone(planIn)
	plan.items = Array.isArray(plan.items) ? plan.items : []
	const changes = []
	const skipped = []
	// (the goal labels a swap or a rename changed: said again on goals a later set_goals puts back as they were, c12, 16 Oct: "…into the
	// bucket" after the bucket became a plastic cup)
	const relabels = []
	const relabel = (...a) => (relabels.push(a), relabelGoals(plan, ...a))
	const removedHere = []
	const addedHere = []
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
			addedHere.push(add)
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
			removedHere.push(it)
			changes.push(`Removed ${nameOf(it)}`)
		} else if (op === "replace_type") {
			if (!need() || !p.type) continue
			const was = nameOf(it)
			const wasType = typeName(it.type)
			const keys = propKeys(p.type)
			// (a kind with a real everyday size takes its own size and weight, never the old thing's: a basket's 35 cm width carried onto a plastic
			// cup made a 35 cm cup that nothing said (V8837 k5); a size the AI gives it is its own)
			let sized = new Set()
			try {
				if (standardSized(p.type)) sized = new Set([...dimKeys(p.type).len, ...dimKeys(p.type).kg])
				// (a container takes its usual size too, where what it carries over is more than ±20 % off it: a cup swapped for a basket was a
				// 12 cm basket, a box swapped for a bucket kept the box's 13 cm walls (V8842 k3 / n1, V8843 s-swap-box-cup: a 26 cm cup))
				else if (containerKind(p.type))
					for (const k of dimKeys(p.type).len) {
						const v = num(it.props?.[k])
						const d = num(propSpec(p.type, k)?.default)
						if (v !== null && d && (v < (1 - STD_SIZE) * d - 1e-9 || v > (1 + STD_SIZE) * d + 1e-9)) sized.add(k)
					}
			} catch {}
			const kept = Object.fromEntries(Object.entries(isObj(it.props) ? it.props : {}).filter(([k]) => keys?.has(k) && !sized.has(k)))
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
			// a goal about it that named what it was ("the bowling ball hits the head pin", "Ball 2 lands in the box") names what it is now ("the
			// tennis ball hits…", "The egg lands in the box"); a goal about many of them, by their kind ("All ten pins fall" -> "All ten water
			// bottles fall")
			relabel(it.id, [was, wasType, kindNoun(before.type, 1, { short: true })], String(p.name ?? kindNoun(p.type) ?? ""), [kindNoun(before.type, 2, { short: true }), String(kindNoun(before.type, 2, { short: true })).split(" ").at(-1)], kindNoun(p.type, 2, { short: true }), String(kindNoun(before.type, 1, { short: true })).split(" ").at(-1), { short: kindNoun(p.type, 1, { short: true }) })
			changes.push(`${was} → ${typeName(p.type)}`)
		} else if (op === "set_place" || op === "place") {
			if (!need() || !isObj(p.place)) continue
			changes.push(describePlace(nameOf(it), it.place, p.place, solvedOf(it.id)))
			it.place = clone(p.place)
		} else if (op === "set_item") {
			if (!need()) continue
			const bits = []
			if (typeof p.name === "string" && p.name.trim()) {
				const was = nameOf(it)
				it.name = p.name.trim()
				bits.push(`named “${it.name}”`)
				// (a goal that named it by its old name follows the new one: "Egg lands in the box" -> "The breakfast egg lands in the box")
				if (was !== it.name) relabel(it.id, [was], it.name)
			}
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
			if (Array.isArray(p.goals)) plan.goals = clone(p.goals)
			for (const r of relabels) relabelGoals(plan, ...r)
			changes.push("Goals updated")
		} else skipped.push(`unknown change “${op}”`)
	}
	// a thing taken away with things of one kind added in this change ("replace the cone with a row of three soda cans"): a goal that mentions it
	// by name or kind ("…sails over the cone into the bucket") mentions them instead
	const addKinds = [...new Set(addedHere.map((a) => a.type))]
	if (removedHere.length && addKinds.length === 1) {
		const n = addedHere.length
		const to = n > 1 ? kindNoun(addKinds[0], n, { short: true }) : kindNoun(addKinds[0], 1, { short: true })
		for (const r of removedHere) {
			const olds = [nameOf(r), typeName(r.type), kindNoun(r.type, 1, { short: true }), String(kindNoun(r.type, 1, { short: true })).split(" ").at(-1)].filter((w) => w && w.length > 2)
			relabelGoals(plan, r.id, olds, to, [kindNoun(r.type, 2, { short: true })], kindNoun(addKinds[0], 2, { short: true }), null, { any: true })
		}
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
/** Things that start inside each other (the run's start-up warnings) or pass through each other (the solver's) in a version. */
const rough = (v) => (v.sim?.warnings?.length ?? 0) + passIn(v).length
/** Is version a better than b: one where nothing starts inside or passes through anything wins (unless the other makes more of the goals
 *  happen); then the critic's score, then what happens in the run. */
const better = (a, b) => {
	if (!rough(a) !== !rough(b)) {
		const [clean, other] = rough(a) ? [b, a] : [a, b]
		if (goalsOk(clean.sim, clean.solved?.goals ?? null) >= goalsOk(other.sim, other.solved?.goals ?? null)) return clean === a
	}
	return (a.score ?? -1) !== (b.score ?? -1) ? (a.score ?? -1) > (b.score ?? -1) : physV(a) > physV(b)
}
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
const lc = (s) => (/^[A-Z][a-z]+['’]s\b/.test(String(s)) ? String(s) : String(s).replace(/^./, (c) => c.toLowerCase())) // ("Rubik's cube" keeps its capital)
const andList = (list, and = "and") => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} ${typeof and === "string" ? and : "and"} ${list.at(-1)}`)
/** What was tried, for inside a bracket: each line's own brackets said as a clause ("tilted the seesaw more, 12.5° → 20°"), and the lines
 *  joined with ";" when one has a comma of its own. */
export function triedWords(lines) {
	const flat = (lines ?? []).map((t) => {
		let x = String(t)
		// (a bracket in the middle closes with a comma, "moved the pedestal, with the bowling ball on it, 11 cm left"; one thing's own changes stay
		// together, "height 17.8 → 40 cm and 187 g → 420 g", never a weight that reads as another change (V8843 rw-books / rw-cupbox))
		for (let k = 0; k < 4 && /\([^()]*\)/.test(x); k++) x = x.replace(/\s*\(([^()]*)\)(\s+(?=\S))?/g, (m, inner, after) => `, ${inner.replace(/;\s*/g, " and ")}${after ? ", " : ""}`)
		return x.replace(/,\s*,/g, ",").trim()
	})
	return flat.some((t) => t.includes(",")) && flat.length > 1 ? `${flat.slice(0, -1).join("; ")}; and ${flat.at(-1)}` : andList(flat)
}
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
	// (a label with brackets of its own is said without them: "top width", never "width (top)" inside a line's bracket: V8838 a-m2-basket-bigger)
	const raw = /^how many$/i.test(sp?.label ?? "") ? "count" : /^front to back$/i.test(sp?.label ?? "") ? "depth" : lc(sp?.label ?? String(key).replace(/_/g, " "))
	const label = raw.replace(/^(.+?)\s*\(([^()]+)\)$/, "$2 $1").trim()
	if (sp?.kind === "bool" || typeof b === "boolean") return `${label}: ${b ? "on" : "off"}`
	// (a row's growth: "each one 1.19 → 1.21× the one before", never "each one bigger by 1.19 → 1.21 ×")
	if (typeof a === "number" && typeof b === "number" && (key === "growth" || /bigger by/i.test(raw))) return `each one ${sig(a)} → ${sig(b)}× the one before`
	if (typeof a === "number" && typeof b === "number") {
		const u = sp?.unit ?? ""
		if (u === "m") {
			// (each value in its own unit, "depth 10.3 cm → 1 m", never "depth 0.102 → 1 m": V8832 y5; one unit when both are in it, "5 → 8 cm")
			if (a > 0 && b > 0) {
				const u1 = (v) => (v < 0.01 ? ["mm", trimNum(v * 1000, 1)] : v < 1 ? ["cm", trimNum(v * 100, 1)] : ["m", trimNum(v, 3)])
				const [ua, fa] = u1(a)
				const [ub, fb] = u1(b)
				return ua === ub ? `${label} ${fa} → ${fb} ${ub}` : `${label} ${fa} ${ua} → ${fb} ${ub}`
			}
			const big = Math.max(Math.abs(a), Math.abs(b))
			return big < 0.01 ? `${label} ${trimNum(a * 1000, 1)} → ${trimNum(b * 1000, 1)} mm` : big < 1 ? `${label} ${trimNum(a * 100, 1)} → ${trimNum(b * 100, 1)} cm` : `${label} ${trimNum(a, 3)} → ${trimNum(b, 3)} m`
		}
		if (u === "°") return `${label} ${sig(a)}° → ${sig(b)}°`
		// (a weight in its own unit each, "514 g → 3 kg")
		if (u === "kg" && a > 0 && b > 0) return `${label} ${fmtMass(a)} → ${fmtMass(b)}`
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
let kindsCache = null
/** The catalog's kinds by the words for them: "bucket", "soda can", "standing soda can", "soda can, standing" -> type key. */
function catalogKinds() {
	if (kindsCache) return kindsCache
	kindsCache = new Map()
	try {
		for (const t of simCatalog().types) for (const w of [t.name, typeName(t.key), kindNoun(t.key, 1), kindNoun(t.key, 1, { short: true }), kindNoun(t.key, 2), kindNoun(t.key, 2, { short: true })]) if (w && !kindsCache.has(String(w).toLowerCase())) kindsCache.set(String(w).toLowerCase(), t.key)
	} catch {}
	return kindsCache
}
let factsCache = null
/** An item's weight in kg as the engine builds it (its solids' volumes × their own materials' densities in the built doc), or null when a
 *  shape can't be measured here; then geometry × the base material, checked against the catalog's own figure at its defaults. */
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
	// (the engine's own figure: each moving solid's volume × its own material's density in the built doc, a thing tuned to a measured weight
	// included: ./words.js)
	const exact = weightOf(type, props ?? {})
	if (exact) {
		massCache.set(key, exact)
		return exact
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
		[/grow|bigger by/, "grow faster", "grow more slowly"],
		[/compress|pulled back|pull back/, "pulled back further", "pulled back less"],
		[/start.?angle/, "pulled back further", "pulled back less"],
		[/tilt|angle|slope|lift/, "tilted more", "tilted less"],
		[/stiff|spring/, "stiffer", "softer"],
		[/speed|power|force/, "faster", "slower"],
		[/bounce/, "bouncier", "less bouncy"],
		[/friction|grip/, "grippier", "slicker"]
	]
	for (const [re, u, d] of pairs) if (re.test(label)) return up ? u : d
	return null
}
/** The lowest point of a thing of this kind below its anchor, at an angle: its bottom (a swap or a resize keeps it where it was). */
const lowOf = (type, props, fixed, angle = 0) => {
	try {
		const y = Math.min(...shapesAt(itemGeometry(type, props ?? {}, fixed === true), 0, 0, angle).map((q) => q.y0))
		return Number.isFinite(y) ? y : null
	} catch {
		return null
	}
}
const theName = (it) => {
	const n = nameOfItem(it) ?? "it"
	// (a number of its own, "Ball 2", or two capitalised words make a proper name; a number that is part of a word, "the 8-ball", does not)
	// ("Newton's cradle" keeps its capital: "the Newton's cradle")
	if (/^[A-Z][a-z]+['’]s\b/.test(n)) return `the ${n}`
	// (a name that starts with a number is a description, "5 kg steel weight": "the 5 kg steel weight" (V8842 n4))
	if (/^\d/.test(n)) return `the ${n}`
	return /(^|\s)\d+(\s|$)/.test(n) || /^[A-Z][a-z]+ [A-Z]/.test(n) ? n : `the ${lc(n)}`
}
/** "a tennis ball", "an egg", "a standing soda can" (the catalog's "Soda can, standing" as a person says it: ./words.js). */
const aKind = (type) => aKindOf(type)
/** A thing's outline at an angle: {w, h} (m), or null. */
const outlineOf = (type, props, fixed, angle = 0) => {
	try {
		const q = shapesAt(itemGeometry(type, props ?? {}, fixed === true), 0, 0, angle)
		const w = Math.max(...q.map((s) => s.x1)) - Math.min(...q.map((s) => s.x0))
		const h = Math.max(...q.map((s) => s.y1)) - Math.min(...q.map((s) => s.y0))
		return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null
	} catch {
		return null
	}
}
const mechCache = new Map()
/** A thing that is a mechanism: moving parts on a fixed mount, or joined by springs or hinges (a gate, a trampoline, a seesaw). */
function mechanism(it) {
	const key = `${it?.type}|${JSON.stringify(it?.props ?? {})}`
	if (mechCache.has(key)) return mechCache.get(key)
	let out = false
	try {
		const { doc } = buildDoc({ stage: { x0: -0.6, x1: 3.2, y0: -0.2, y1: 2.4 }, items: [{ id: "g", type: it.type, x: 0, y: 0.5, angle: 0, props: it.props ?? {} }] })
		const dyn = doc.solids.filter((x) => x.kind === "dynamic").length
		const fixedParts = doc.solids.length - dyn
		out = (dyn > 0 && fixedParts > 0) || ((doc.joints ?? []).length > 0 && fixedParts > 0)
	} catch {}
	mechCache.set(key, out)
	return out
}
/** "20 → 30 cm", "8 mm → 3 cm" (one unit when both are in it). */
const lenRange = (a, b) => {
	const fa = fmtLen(a)
	const fb = fmtLen(b)
	return fa.split(" ")[1] === fb.split(" ")[1] ? `${fa.split(" ")[0]} → ${fb}` : `${fa} → ${fb}`
}
const roundish = (type, props, fixed) => {
	try {
		return itemGeometry(type, props ?? {}, fixed === true).shapes.every((s) => s.k === "circle")
	} catch {
		return false
	}
}
/**
 * What changed between two scenes, as short first-person phrases a person would use (real units, never a prop's internal name):
 * ["swapped Ball 2 for a tennis ball", "made the tennis ball lighter (58 g → 20 g, thinner wall)", "moved the box 10 cm left", "added a golf ball"].
 */
export function humanChanges(a, b) {
	return humanChangeList(a, b).map((c) => c.text)
}
const CONTAINER_TYPES = new Set(["box", "cup", "bucket", "basket", "plastic-cup", "glass-jar"])
/** What a thing stands on or sits in, in a scene (the highest thing a few millimetres under it), or null (the table, or nothing). */
function supportIn(scene, ins, id) {
	let best = null
	let top = -Infinity
	for (const o of scene.items) {
		if (o.id === id || o.type === "table" || o.type === "wall") continue
		let g
		try {
			g = ins.gap(id, o.id)
		} catch {
			g = null
		}
		if (g === null || g > 0.004) continue
		const A = ins.box(id)
		const B = ins.box(o.id)
		if (!A || !B || A.x1 < B.x0 || A.x0 > B.x1) continue
		// (inside a container: its middle between the walls; resting on a thing: above its middle)
		const inside = CONTAINER_TYPES.has(o.type) && (A.x0 + A.x1) / 2 > B.x0 && (A.x0 + A.x1) / 2 < B.x1 && A.y0 >= B.y0 - 0.005
		if (!inside && (A.y0 + A.y1) / 2 < (B.y0 + B.y1) / 2) continue
		if (B.y1 > top) ((top = B.y1), (best = { id: o.id, inside }))
	}
	return best
}
/**
 * The same, each with the item it is about: [{text, id, name}] (id null for the scene's own: its run length). What rides on a moved thing and
 * moved with it, by the same amount and nothing else, is said with it: "moved the conveyor belt (with the golf balls on it) 20 cm left".
 * says: the edit's targets ([{says, ids}]): a thing the person named in words of their own is called that, with its name on screen
 * ("swapped the yellow ball (Ball 2) for a tennis ball (6.3 g → 58 g)"). why: Map id -> why the solver moved a thing the change swapped or
 * resized ("to clear Ten dominoes"): such a move beyond its re-seat (> 1 cm) is said, never hidden in the swap.
 * Things of one kind changed the same way are one line, counted, with "each" on their weights ("emptied the 6 soda cans (370 g → 15 g each)",
 * "swapped the 10 bowling pins for standing water bottles (1.59 kg → 512 g each)", "moved the 3 bowling pins 5 cm left"); what was added where
 * something was taken away is a replacement ("replaced the 7 dominoes with 6 standing soda cans (370 g each, 10 cm apart)"); an added thing that
 * sits in or on something says so ("added a rubber duck in the box"). massA / massB: Map id -> kg from the runs (the engine's own figure, for a
 * shape the weight can't be worked out from here).
 */
/** Number words a person uses for a count: "two" -> 2. */
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, both: 2 }
/** A target's words that are the person's own: in their request (text; null: not checked), with letters, never the AI's note to itself ("(neighbour
 *  moved to make room)": V8832 c09). For a group of n things: any count in the words is n, and a few of a kind more on the table are never
 *  called by the whole kind ("the 9 cardboard boxes" for the 2 made deeper: V8832 y15). -> the words, or null. */
export function personWords(says, text = null, { n = 1, all = n } = {}) {
	const w = String(says ?? "").trim().replace(/[.!?,;:]+$/, "")
	if (!w || /^[([{]/.test(w) || !/\p{L}/u.test(w) || w.length > 40) return null
	if (typeof text === "string") {
		const norm = (x) => ` ${String(x).toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").trim()} `
		const core = norm(w).replace(/^ (the|a|an|that|this|my|all|both) /, " ")
		if (core.trim().length < 2 || !norm(text).includes(core)) return null
	}
	const counts = [...w.toLowerCase().matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|both)\b/g)].map((m) => (/^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]]))
	if (counts.some((c) => c !== n)) return null
	if (n > 1 && all > n && !counts.length) return null
	return w
}
export function humanChangeList(a, b, { room = null, says = null, why = null, massA = null, massB = null, text = null, reasons = null, anchors = null } = {}) {
	if (!a?.items || !b?.items) return []
	// (the person's own words for a thing, when they say more than its name: "the yellow ball" for Ball 2, never "the box" for Box; and only
	// words that are theirs: in their request)
	const own = new Map()
	// (the first words for a thing are what the person called it; a later "the mug" for the cup made a coffee mug is what it became, never what
	// it was: "swapped the mug for a coffee mug" (V8842 k2 r1))
	const seenSay = new Set()
	for (const t of Array.isArray(says) ? says : []) {
		const ids = Array.isArray(t?.ids) ? t.ids : []
		const w = personWords(t?.says, text)
		if (ids.length !== 1 || !w || own.has(ids[0]) || seenSay.has(ids[0])) continue
		seenSay.add(ids[0])
		const it = a.items.find((i) => i.id === ids[0])
		if (!it) continue
		const bare = (x) => String(x ?? "").toLowerCase().replace(/^(the|a|an|that|this|my) /, "").trim()
		const n = bare(nameOfItem(it))
		if (!bare(w) || n.includes(bare(w)) || bare(w).includes(n) || /^(it|that|this|them|one|the one)$/.test(bare(w))) continue
		const now = b.items.find((i) => i.id === ids[0])
		// (its word is the new kind's and not the old one's: "the mug" for the cup made a coffee mug; never "the yellow ball" for a ball made a
		// tennis ball)
		const headW = bare(w).split(/\s+/).at(-1)
		const wordsOf = (type) => String(`${kindNoun(type, 1, { short: true }) ?? ""} ${typeName(type) ?? ""}`).toLowerCase().split(/[^\p{L}]+/u)
		if (now && now.type !== it.type && wordsOf(now.type).includes(headW) && !wordsOf(it.type).includes(headW) && !n.split(/\s+/).includes(headW)) continue
		// (the person's words pick it out: its name on screen is not said again, "the yellow ball", never "the yellow ball (Ball 2)")
		own.set(ids[0], `${/^(the|a|an|that|this|my) /i.test(w) ? lc(w[0]) + w.slice(1) : `the ${lc(w)}`}`)
	}
	// (a thing as it is called now: a swapped thing by its new kind, "the bowling ball", never "the yellow ball (Ball 2)" for what is no longer
	// yellow nor a plastic ball; one of several of a kind with a numbered name by where it stands, "the 2nd soda can", never "Soda can 2")
	const kindCount = new Map()
	for (const i of b.items) kindCount.set(i.type, (kindCount.get(i.type) ?? 0) + 1)
	const ORD = ["first", "2nd", "3rd"]
	const ordinal = (n) => ORD[n - 1] ?? `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`
	const callIt = (it) => {
		const wasIt = a.items.find((i) => i.id === it.id)
		if (wasIt && wasIt.type !== it.type && kindCount.get(it.type) === 1) return `the ${kindNoun(it.type)}`
		// (one of several swapped in, still named as what it was, "Brick 4": by its place among the new kind, never its old name: V8817 m6)
		if (wasIt && wasIt.type !== it.type && !String(nameOfItem(it) ?? "").toLowerCase().includes(String(kindNoun(it.type, 1, { short: true })).split(" ").at(-1).toLowerCase())) {
			const same = b.items.filter((i) => i.type === it.type)
			const xs = same.map((i) => Number(i.x) || 0)
			const stacked = Math.max(...xs) - Math.min(...xs) < 0.02
			const sorted = [...same].sort((p, q) => (stacked ? (Number(p.y) || 0) - (Number(q.y) || 0) : (Number(p.x) || 0) - (Number(q.x) || 0)))
			const k = sorted.findIndex((i) => i.id === it.id) + 1
			const noun = kindNoun(it.type, 1, { short: true })
			if (k > 0) return k === sorted.length ? `the ${stacked ? "top" : "last"} ${noun}` : `the ${ordinal(k)} ${noun}${stacked ? " from the bottom" : ""}`
		}
		if (own.has(it.id) && !(wasIt && wasIt.type !== it.type)) return own.get(it.id)
		const nm = String(nameOfItem(it) ?? "")
		// (a numbered name that is just its kind, "Soda can 2", "Bottle 3", "Trampoline 1": its words are the kind's; "Ramp 1" is a name of its own)
		const kindWords = new Set(`${typeName(it.type) ?? ""} ${kindNoun(it.type, 1, { short: true })} ${kindNoun(it.type, 1)}`.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean))
		const nm0 = /^(.+?)\s+\d+$/.exec(nm)?.[1] ?? null
		const generic = { test: () => !!nm0 && nm0.toLowerCase().split(/\s+/).every((w) => kindWords.has(w)) }
		if ((kindCount.get(it.type) ?? 0) > 1 && generic.test(nm)) {
			const same = b.items.filter((i) => i.type === it.type).sort((p, q) => (Number(p.x) || 0) - (Number(q.x) || 0))
			const k = same.findIndex((i) => i.id === it.id) + 1
			if (k > 0) return k === same.length ? `the last ${kindNoun(it.type, 1, { short: true })}` : `the ${ordinal(k)} ${kindNoun(it.type, 1, { short: true })}`
		}
		return theName(it)
	}
	const A = new Map(a.items.filter((i) => !isSafetyWall(i)).map((i) => [i.id, i]))
	const B = new Map(b.items.filter((i) => !isSafetyWall(i)).map((i) => [i.id, i]))
	// (what a thing weighs: a weight typed in is that weight; else what the engine builds; else the run's own figure)
	const weighs = (it, M) => (num(it?.props?.mass) !== null ? num(it.props.mass) : massOf(it.type, it.props) ?? num(M?.get?.(it.id)))
	const out = []
	const added = [...B.values()].filter((i) => !A.has(i.id))
	const removed = [...A.values()].filter((i) => !B.has(i.id))
	const entries = []
	// a change's words, with the names of the things it is about from `N` (the real ones; or markers, to see which changes are the same)
	const MARK = { callIt: () => "\u0001", theName: () => "\u0001", aKind: () => "\u0002", who: () => "\u0001" }
	const bitsOf = (ia, ib, N) => {
		const bits = []
		// ("Ball 2" says little: the kind it was goes with it)
		if (ia.type !== ib.type) {
			// (before → after in real units: what each weighs as built, else how big across: "(6.3 g → 58 g)"; and its size where that changed a
			// lot, the old thing's outline against the new one's: "20 → 30 cm wide")
			const ma = weighs(ia, massA)
			const mb = weighs(ib, massB)
			const balls = roundish(ia.type, ia.props, ia.fixed) && roundish(ib.type, ib.props, ib.fixed)
			const da = num(propValue(ia, "diameter"))
			const db = num(propValue(ib, "diameter"))
			const what = []
			if (ma && mb && Math.abs(mb - ma) / Math.max(ma, mb) > 0.02) what.push(`${fmtMass(ma)} → ${fmtMass(mb)}`)
			else if (ma && mb) what.push(`${fmtMass(mb)}, about the same weight`)
			else if (balls && da && db && Math.abs(db - da) > 0.002) what.push(`${fmtLen(da)} → ${fmtLen(db)} across`)
			// (a size only for a thing that is all loose or all fixed, a pin, a bottle, a bucket: a gate's or a trampoline's outline is its frame,
			// mount and swing, never its size)
			if (!balls && !mechanism(ia) && !mechanism(ib)) {
				const ang = Number(ia.angle) || 0
				const oa = outlineOf(ia.type, ia.props, ia.fixed, ang)
				const ob = outlineOf(ib.type, ib.props, ib.fixed, ang)
				if (oa && ob) {
					// (the size that changed most, when it changed a lot: "38 → 21 cm tall")
					const sw = Math.abs(ob.w - oa.w) / Math.max(oa.w, ob.w) > 0.3 && Math.abs(ob.w - oa.w) > 0.03 ? Math.abs(ob.w - oa.w) : 0
					const sh = Math.abs(ob.h - oa.h) / Math.max(oa.h, ob.h) > 0.3 && Math.abs(ob.h - oa.h) > 0.03 ? Math.abs(ob.h - oa.h) : 0
					if (sw > 0 && sw >= sh) what.push(`${lenRange(oa.w, ob.w)} wide`)
					else if (sh > 0) what.push(`${lenRange(oa.h, ob.h)} tall`)
				}
			}
			// (the person's words for it, unless they name the new kind: "swapped the basket for a basket" was the bucket: V8817 m5; else what it was,
			// from the scene before)
			const ownW = own.get(ia.id)
			const newW = String(kindNoun(ib.type, 1, { short: true })).toLowerCase()
			const ownOk = ownW && !new RegExp(`\\b${newW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(ownW)
			// (its kind without the catalog's own brackets or the word after a comma: "the heavy steel weight", never "the heavy steel weight (the
			// steel weight (1 kg))": V8820 n3)
			const kindW = lc(String(typeName(ia.type) ?? ia.type).replace(/\s*\([^)]*\)/g, "").replace(/,.*$/, "").trim())
			// (and no kind in brackets when its name already says what it is: "the plastic ball", "the 8-ball", "the cue ball", "the swing gate",
			// never "the cue ball (the billiard ball)"; a bare numbered name, "Ball 2", says little, so its kind goes with it: V8832 m2 / c02 / c13)
			const nameSays = (() => {
				const nm = String(nameOfItem(ia) ?? "").toLowerCase().trim()
				if (nm.includes(kindW.toLowerCase())) return true
				const head = (x) => (String(x).match(/\p{L}+/gu) ?? []).at(-1) ?? ""
				const words = nm.split(/\s+/).filter(Boolean)
				// ("Box" for an open box says what it is too; only a numbered name, "Ball 2", says too little)
				const numbered = words.length === 2 && /^\d+$/.test(words[1])
				return !numbered && head(nm) === head(kindW.toLowerCase())
			})()
			const who = N === MARK ? "\u0001" : ownOk ? ownW : `${theName(ia)}${nameSays ? "" : ` (the ${kindW})`}`
			// (a kind with a real size made another size is said so, never silently: "a plastic cup 35 cm wide (a real one is 9.5 cm)" (V8837 k5);
			// one bracket for all of it)
			let off = null
			try {
				off = offRealSize(ib.type, ib.props ?? {})
			} catch {}
			const sizeW = off ? ` ${off.words.replace(/ \(a (?:real|usual) one is .*\)$/, "")}` : ""
			const inBr = off ? [`${off.ref ?? "a real one"} is ${fmtLen(off.d)}`, ...what] : what
			bits.push(`swapped ${who} for ${N.aKind(ib.type)}${sizeW}${inBr.length ? ` (${inBr.join(off ? "; " : ", ")})` : ""}`)
			return bits
		}
		let keys = [...new Set([...Object.keys(ia.props ?? {}), ...Object.keys(ib.props ?? {})])].filter((k) => !sameValue(propValue(ia, k), propValue(ib, k)))
		// (a box taken off its cords, or hung on them: said in words, never a setting's name, and never left out (V8820 x3: the AI's checked fix
		// took the box off its cords and neither the offer nor the card said so))
		if (keys.includes("hung") && typeof propValue(ib, "hung") === "boolean") {
			let onTable = false
			if (!propValue(ib, "hung") && N !== MARK)
				try {
					const ins = inspect(b)
					const tb = b.items.find((i) => i.type === "table")
					onTable = !!tb && Math.abs((ins.box(ib.id)?.y0 ?? -9) - (ins.box(tb.id)?.y1 ?? 9)) < 0.02
				} catch {}
			bits.push(propValue(ib, "hung") ? `hung ${N.callIt(ib)} on cords` : `took ${N.callIt(ib)} off its cords${onTable ? " and stood it on the table" : ""}`)
			keys = keys.filter((k) => k !== "hung")
		}
		if (!keys.length) return bits
		const ma = weighs(ia, massA)
		const mb = weighs(ib, massB)
		const massMoved = ma && mb && Math.abs(mb - ma) / ma > 0.02
		// a setting that is about the inside of a thing (a ball's wall, its fill): what it does is its weight
		const inner = keys.every((k) => /wall|thick|fill|hollow|density/.test(String(propSpec(ib.type, k)?.label ?? k).toLowerCase()))
		// (a weight left to follow the size has no number of its own: it is what the thing weighs)
		const pv = (it, k) => (typeof propValue(it, k) !== "number" && /^mass$|weight/i.test(`${k} ${propSpec(it.type, k)?.label ?? ""}`) ? weighs(it, it === ia ? massA : massB) ?? propValue(it, k) : propValue(it, k))
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
			bits.push(`${nb > na ? "added" : "took away"} ${Math.abs(nb - na)} ${unit ?? `to ${N.callIt(ib)}`} (${na} → ${nb}${also.length ? `, ${andList(also)}` : ""})`)
		} else if (keys.length === 1 && keys[0] === "full" && typeof propValue(ib, "full") === "boolean") {
			// (a can or a bottle filled or emptied: what that does is its weight)
			bits.push(`${propValue(ib, "full") ? "filled" : "emptied"} ${N.callIt(ib)}${massMoved ? ` (${fmtMass(ma)} → ${fmtMass(mb)})` : ""}`)
		} else if (keys.length === 1 && keys[0] === "material" && typeof propValue(ib, "material") === "string") {
			// (what it is made of: "made the cup of varnished hardwood (was cardboard)", its weight with it when that changed)
			bits.push(`made ${N.callIt(ib)} of ${String(propValue(ib, "material")).toLowerCase()} (was ${String(propValue(ia, "material") ?? "its own").toLowerCase()}${massMoved ? `; ${fmtMass(ma)} → ${fmtMass(mb)}` : ""})`)
		} else if (keys.length === 1 && typeof propValue(ib, keys[0]) === "boolean") {
			const label = lc(propSpec(ib.type, keys[0])?.label ?? keys[0].replace(/_/g, " "))
			bits.push(`turned ${propValue(ib, keys[0]) ? "on" : "off"} “${label}” on ${N.callIt(ib)}`)
		} else if (inner && massMoved) bits.push(`made ${N.callIt(ib)} ${mb < ma ? "lighter" : "heavier"} (${fmtMass(ma)} → ${fmtMass(mb)}${words[0].w ? `, ${words[0].w}` : ""})`)
		else if (/^pulled back/.test(words[0].w ?? "") && typeof propValue(ia, words[0].k) === "number" && !(only && /start.?angle/i.test(`${only} ${propSpec(ib.type, only)?.label ?? ""}`))) {
			// ("pulled the spring launcher back less (4.6 → 3.5 cm)")
			bits.push(`pulled ${N.callIt(ib)} back ${/further/.test(words[0].w) ? "further" : "less"} (${words[0].c.replace(/^[^0-9-]*?(?=-?\d)/, "")})`)
		} else if (only && /start.?angle/i.test(`${only} ${propSpec(ib.type, only)?.label ?? ""}`)) {
			// a pendulum's start: how far it is pulled back, whichever side ("pulled the pendulum back less (55° → 20°)")
			bits.push(`pulled ${N.callIt(ib)} back ${Math.abs(vb) > Math.abs(va) ? "further" : "less"} (${sig(Math.abs(va))}° → ${sig(Math.abs(vb))}°)`)
		} else if (only === "tilt") bits.push(`tilted ${N.callIt(ib)} ${Math.abs(vb) > Math.abs(va) ? "more" : "less"} (${sig(Math.abs(va))}° → ${sig(Math.abs(vb))}°)`)
		else if (only === "spacing" && ib.type === "domino-row") {
			// (in domino heights: said as the first gap in cm)
			const h = num(propValue(ib, "first_height"))
			const ga = h ? fmtLen(va * h) : sig(va)
			const gb = h ? fmtLen(vb * h) : sig(vb)
			bits.push(`spaced ${N.callIt(ib)} ${vb > va ? "further apart" : "closer together"} (first gap ${ga.split(" ").at(-1) === gb.split(" ").at(-1) ? ga.replace(/ \S+$/, "") : ga} → ${gb})`)
		} else {
			const main = words.filter((x) => x.w).slice(0, 2)
			const how = main.length ? andList([...new Set(main.map((x) => x.w))]) : null
			// (a row of many things, the dominoes: its weight in all says little)
			// (a weight of its own already said, "bob weight 514 g → 3 kg", is never said twice: V8832 y15)
			const ownWeight = keys.some((k) => k === "mass" || propSpec(ib.type, k)?.unit === "kg")
			// (every setting it says gets its number: "shorter and tilted less (rope length 80 → 50 cm; start angle 40° → 30°)", never the first
			// alone; one with no word of its own is said by its setting, never "made the seesaw different" (V8842 y4 / a-m2 / x42c))
			const nums = [...new Set((main.length ? main : words.slice(0, 2)).map((x) => x.c).filter(Boolean))]
			const wt = massMoved && !ownWeight && !MULTI_UNIT[ib.type] ? `; ${fmtMass(ma)} → ${fmtMass(mb)}` : ""
			bits.push(how ? `made ${N.callIt(ib)} ${how} (${nums.join("; ")}${wt})` : `changed ${N.callIt(ib)} (${nums.join("; ")}${wt})`)
		}
		return bits
	}
	const REAL = { callIt, theName, aKind }
	for (const ib of B.values()) {
		const ia = A.get(ib.id)
		if (!ia) continue
		if (ib.type === "table") {
			const wa = propValue(ia, "width")
			const wb = propValue(ib, "width")
			if (num(wa) !== null && num(wb) !== null && Math.abs(wb - wa) > 0.005) entries.push({ it: ib, bits: [`${wb > wa ? "widened" : "narrowed"} the table to ${fmtLen(wb)} so everything fits`], marks: null, after: [], move: null, turn: null, riders: [] })
			continue
		}
		const bits = bitsOf(ia, ib, REAL)
		const marks = bitsOf(ia, ib, MARK)
		const dx = (Number(ib.x) || 0) - (Number(ia.x) || 0)
		const dy = (Number(ib.y) || 0) - (Number(ia.y) || 0)
		const swapped = ia.type !== ib.type
		// (a swapped or resized thing re-seated on its support moves a little, its bottom where it was: that is part of the change, said by its
		// own line. Past 1 cm along, or more up or down than its new size explains, it was put somewhere else: said, with the solver's why)
		const reshaped = swapped || bits.length > 0
		let seatDy = 0
		if (reshaped) {
			const l0 = lowOf(ia.type, ia.props, ia.fixed, Number(ia.angle) || 0)
			const l1 = lowOf(ib.type, ib.props, ib.fixed, Number(ia.angle) || 0)
			if (l0 !== null && l1 !== null) seatDy = l0 - l1
		}
		// (the re-seat explains a move only when it makes it smaller: a pendulum pulled back less changes its outline, not its anchor)
		const ry = Math.abs(dy - seatDy) < Math.abs(dy) ? dy - seatDy : dy
		const move = reshaped && Math.abs(dx) < 0.01 && Math.abs(ry) < 0.01 ? null : Math.abs(dx) >= 0.005 || Math.abs(ry) >= 0.005 ? { dx, dy: ry, why: reshaped ? why?.get?.(ib.id) ?? null : null } : null
		const after = []
		const aa = Number(ia.angle) || 0
		const ab = Number(ib.angle) || 0
		const turn = !swapped && Math.abs(ab - aa) >= 0.5 ? { aa, ab } : null
		if (!!ia.held !== !!ib.held) after.push(ib.held ? `made ${callIt(ib)} wait for the release` : `let ${callIt(ib)} go from the start`)
		if (!!ia.fixed !== !!ib.fixed) after.push(ib.fixed ? `fixed ${callIt(ib)} in place` : `let ${callIt(ib)} move freely`)
		if (!swapped && (ia.name ?? null) !== (ib.name ?? null)) after.push(`renamed ${theName(ia)} to ${ib.name ?? aKind(ib.type)}`)
		entries.push({ it: ib, was: ia, bits, marks, move, turn, after, riders: [] })
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
			if (!r || r.folded || r.after.length || (!r.move && !r.turn)) continue
			// (a thing made shorter or taller where it stands re-seats what rests on it: their moves straight up or down are part of that, never
			// "move the 2nd hardcover book 1.5 cm down" each: V8817 c08)
			if (!e.move && !e.turn && e.bits.length && r.move && !r.turn && Math.abs(r.move.dx) < 0.002) {
				r.move = null
				if (!r.bits.length) r.folded = true
				continue
			}
			const same = e.move && r.move && !r.turn && Math.abs(r.move.dx - e.move.dx) <= 0.003 && Math.abs(r.move.dy - e.move.dy) <= 0.003
			// (a rider swapped too keeps its own swap line; its ride with the carrier is said with the carrier: "moved the ledge (with the golf
			// ball on it) 91 cm right", never "moved the 8-ball 91 cm right" for what is now a golf ball)
			if (r.bits.length) {
				// (re-seated as the new kind on what carries it: within a centimetre or so of the carrier's move)
				const near = e.move && r.move && !r.turn && Math.abs(r.move.dx - e.move.dx) <= 0.015 && Math.abs(r.move.dy - e.move.dy) <= 0.015
				if (!near) continue
				r.move = null
				e.riders.push(r.it)
				continue
			}
			if (!same && !e.turn && !(e.bits.length && !e.move)) continue
			r.folded = true
			e.riders.push(r.it)
		}
	}
	// a stack or a row of things all swapped for one kind is one line, their re-seats on each other with it ("swapped the 9 bricks for a stack of
	// 9 tissue boxes (2.7 kg → 150 g each)"), never one swap and one "moved the 4th tissue box (with the tissue boxes on it) 1.5 cm up" each
	// with old names (V8817 c10, m6)
	const swapLines = []
	{
		const removedKinds = new Set(removed.map((i) => i.type))
		const groups = new Map()
		for (const e of entries) if (e.was && e.was.type !== e.it.type && !e.after.length && !e.folded) groups.set(`${e.was.type}>${e.it.type}`, [...(groups.get(`${e.was.type}>${e.it.type}`) ?? []), e])
		let insG = null
		try {
			insG = inspect(b)
		} catch {}
		for (const list of groups.values()) {
			if (list.length < 2) continue
			const W = list[0].was.type
			const V = list[0].it.type
			// (some of the old kind taken away and the rest swapped: the replacement says it, below)
			if (removedKinds.has(W) || added.some((i) => i.type === V)) continue
			const ids = new Set(list.map((e) => e.it.id))
			// (each one only re-seated on the others: up or down, under 1 cm along; nothing but the group riding on any of them; and only a group
			// the plain grouping below can't say as one, because they ride on each other or were re-seated)
			if (list.some((e) => (e.move && Math.abs(e.move.dx) >= 0.01) || e.turn || e.riders.some((r) => !ids.has(r.id)))) continue
			const onEach = insG ? list.filter((e) => ids.has(supportIn(b, insG, e.it.id)?.id)).length : 0
			if (!list.some((e) => e.riders.length || e.move) && onEach < list.length - 1) continue
			const n = list.length
			const ms = list.map((e) => [weighs(e.was, massA), weighs(e.it, massB)])
			const same = ms.every(([x, y]) => x && y && Math.abs(x - ms[0][0]) / ms[0][0] < 0.01 && Math.abs(y - ms[0][1]) / ms[0][1] < 0.01)
			const w = same && Math.abs(ms[0][1] - ms[0][0]) / Math.max(ms[0][0], ms[0][1]) > 0.02 ? ` (${fmtMass(ms[0][0])} → ${fmtMass(ms[0][1])} each)` : same ? ` (${fmtMass(ms[0][1])} each, about the same weight)` : ""
			const t = (Array.isArray(says) ? says : []).find((x) => Array.isArray(x?.ids) && x.ids.length === n && x.ids.every((id) => ids.has(id)) && personWords(x.says, text, { n }) && !/^(them|they|these|those|it)$/i.test(String(x.says).trim()))
			const theirWords = t ? personWords(t.says, text, { n }) : null
			const what = theirWords && !new RegExp(`\\b${kindNoun(V, 1, { short: true }).split(" ").at(-1)}`, "i").test(theirWords) ? (/^(the|a|an|my|all|both)\b/i.test(theirWords) ? lc(theirWords[0]) + theirWords.slice(1) : `the ${lc(theirWords)}`) : `the ${n} ${kindNoun(W, n, { short: true })}`
			swapLines.push({ text: `swapped ${what} for ${onEach >= n - 1 ? `a stack of ${n} ${kindNoun(V, n)}` : kindNoun(V, n)}${w}`, id: list[0].it.id, name: theName(list[0].it) })
			for (const e of list) e.folded = true
		}
	}
	// a thing swapped into the kind that was also added where it stood ("replace the cone with 3 soda cans": the cone made a can, and 2 more)
	// is part of that replacement: taken away, and counted with the added ones
	const addedTypes = new Set(added.map((i) => i.type))
	// (and things of a kind swapped while the rest of that kind was taken away, none of it left: "turn the brick tower into a stack of cereal
	// boxes" is one replacement, "replaced the 9 bricks with 2 cereal boxes", never a swap, two moves and a removal: c10, 16 Oct)
	const removedTypes = new Set(removed.map((i) => i.type))
	const remainsOf = (type) => [...B.values()].some((i) => i.type === type)
	const asAdded = []
	const asRemoved = []
	for (const e of entries) {
		if (!e.was || e.was.type === e.it.type || e.after.length || e.folded) continue
		const intoAdded = addedTypes.has(e.it.type) && !e.riders.length
		const restGone = removedTypes.has(e.was.type) && !remainsOf(e.was.type)
		if (!intoAdded && !restGone) continue
		e.folded = true
		asAdded.push(e.it)
		asRemoved.push(e.was)
	}
	// (a row made shorter with things added where its end stood: "replaced the last domino with a stack of 4 hardcover books", never "took away 1
	// domino (9 → 8)" and "added 4 hardcover books": c02, 16 Oct)
	const rowCuts = []
	{
		let iA = null
		let iB = null
		try {
			iA = inspect(a)
			iB = inspect(b)
		} catch {}
		const span = (list) => {
			const bs = list.map((it) => iB?.box?.(it.id)).filter(Boolean)
			return bs.length ? { x0: Math.min(...bs.map((q) => q.x0)), x1: Math.max(...bs.map((q) => q.x1)) } : null
		}
		const kinds = new Map()
		for (const it of added) kinds.set(it.type, [...(kinds.get(it.type) ?? []), it])
		for (const e of entries) {
			if (!iA || !iB || e.folded || !e.was || e.was.type !== e.it.type || e.it.type !== "domino-row" || e.move || e.turn || e.after.length) continue
			const na = Number(propValue(e.was, "count"))
			const nb = Number(propValue(e.it, "count"))
			if (!(na > nb) || e.bits.length !== 1 || !/^took away /.test(e.bits[0])) continue
			const ra = iA.box(e.it.id)
			const rb = iB.box(e.it.id)
			if (!ra || !rb) continue
			const cut = rb.x1 < ra.x1 - 0.005 ? { x0: rb.x1, x1: ra.x1, end: "last" } : rb.x0 > ra.x0 + 0.005 ? { x0: ra.x0, x1: rb.x0, end: "first" } : null
			if (!cut) continue
			const g = [...kinds.values()].find((list) => {
				const sb = span(list)
				return sb && Math.min(sb.x1, cut.x1 + 0.05) - Math.max(sb.x0, cut.x0 - 0.05) > 0
			})
			if (!g) continue
			e.folded = true
			kinds.delete(g[0].type)
			rowCuts.push({ e, g, n: na - nb, end: cut.end })
		}
	}
	const cutAdded = new Set(rowCuts.flatMap((r) => r.g.map((i) => i.id)))
	const moveWords = (m) => [Math.abs(m.dx) >= 0.005 ? `${fmtLen(m.dx)} ${m.dx > 0 ? "right" : "left"}` : null, Math.abs(m.dy) >= 0.005 ? `${fmtLen(m.dy)} ${m.dy > 0 ? "up" : "down"}` : null].filter(Boolean).join(" and ")
	/** One entry's lines, with names from `N` (REAL, or MARK to compare). */
	const linesOf = (e, N) => {
		const lines = []
		const keptOn = e.riders.length && !e.move && !e.turn ? `, with ${groupNames(e.riders)} still on it` : ""
		const bits = N === MARK ? e.marks ?? e.bits : e.bits
		bits.forEach((t, i) => lines.push(i === bits.length - 1 ? `${t}${keptOn}` : t))
		const withRiders = e.riders.length ? ` (with ${groupNames(e.riders)} ${CONTAINER_TYPES.has(e.it.type) ? "in" : "on"} it)` : ""
		// (a move beyond what was asked says why, when the run of its place shows it: "moved the box 30 cm left and 12 cm up, to clear the
		// dominoes": V8832 p3)
		const unasked = !e.move?.why && !(room?.has?.(e.it.id) && !e.bits.length) ? reasons?.get?.(e.it.id)?.reason ?? null : null
		if (e.move) lines.push(`moved ${N.callIt(e.it)}${e.turn ? "" : withRiders} ${moveWords(e.move)}${room?.has?.(e.it.id) && !e.bits.length ? " to make room" : ""}${e.move.why ? `: it didn't fit where it was (${e.move.why})` : ""}${unasked ? `, ${unasked}` : ""}`)
		if (e.turn) {
			const { aa, ab } = e.turn
			// (a ramp is steeper or flatter, from level; anything else is turned)
			if (e.it.type === "plank" && Math.sign(aa || ab) === Math.sign(ab || aa)) lines.push(`made ${N.callIt(e.it)}${withRiders} ${sig(Math.abs(Math.abs(ab) - Math.abs(aa)))}° ${Math.abs(ab) > Math.abs(aa) ? "steeper" : "flatter"} (${sig(Math.abs(aa))}° → ${sig(Math.abs(ab))}°)`)
			else lines.push(`turned ${N.callIt(e.it)}${withRiders} ${sig(Math.abs(ab - aa))}°`)
		}
		for (const t of e.after) lines.push(t)
		return lines
	}
	// a row of things of one kind set closer together or further apart, each moved along by its own amount: one line ("spaced the 6 soda cans
	// closer together (10 → 7 cm apart)"), never one "moved Soda can N" line each
	const rowLines = []
	{
		const kinds = new Map()
		for (const ib of B.values()) {
			const ia = A.get(ib.id)
			if (!ia || ia.type !== ib.type || ib.type === "table" || isStaticItem(ib.type, ib.fixed === true)) continue
			kinds.set(ib.type, [...(kinds.get(ib.type) ?? []), { ia, ib, e: byId.get(ib.id) }])
		}
		for (const [type, list] of kinds) {
			if (list.length < 3) continue
			// (only moved along, all at one height before and after; anything else changed about them changed the same way for all, "emptied
			// the 5 soda cans", and is said by its own line: c00, 16 Oct: "moved the 1st soda can 5.9 cm right", "the 2nd 1.9 cm right", …)
			const sameBits = list.every((m) => JSON.stringify(m.e?.marks ?? []) === JSON.stringify(list[0].e?.marks ?? []))
			if (list.some((m) => m.e && ((m.e.bits.length && !sameBits) || m.e.after.length || m.e.turn || m.e.riders.length || m.e.folded || (m.e.move && Math.abs(m.e.move.dy) > 0.002)))) continue
			if (!list.some((m) => m.e?.move)) continue
			const flat = (k) => list.every((m) => Math.abs((Number(m[k].y) || 0) - (Number(list[0][k].y) || 0)) < 0.005)
			if (!flat("ia") || !flat("ib")) continue
			const xs = (k) => list.map((m) => Number(m[k].x) || 0).sort((p, q) => p - q)
			const even = (v) => {
				const g = v.slice(1).map((x, i) => x - v[i])
				return g.every((d) => Math.abs(d - g[0]) < 0.005) && g[0] > 0.005 ? g.reduce((p, q) => p + q, 0) / g.length : null
			}
			const ga = even(xs("ia"))
			const gb = even(xs("ib"))
			if (ga === null || gb === null || Math.abs(gb - ga) < 0.004) continue
			const n = list.length
			const first = [...list].sort((p, q) => (Number(p.ia.x) || 0) - (Number(q.ia.x) || 0))[0]
			const d0 = (Number(first.ib.x) || 0) - (Number(first.ia.x) || 0)
			// (the moves are said by this line; what else changed about all of them, by their group's line)
			for (const m of list) if (m.e) m.e.bits.length ? (m.e.move = null) : (m.e.folded = true)
			rowLines.push({ id: first.ib.id, text: `spaced the ${n} ${kindNoun(type, n, { short: true })} ${gb < ga ? "closer together" : "further apart"} (${lenRange(ga, gb)} apart${Math.abs(d0) >= 0.005 ? `, starting ${fmtLen(d0)} further ${d0 > 0 ? "right" : "left"}` : ""})` })
		}
	}
	for (const l of rowLines) out.push({ text: l.text, id: l.id, name: theName(B.get(l.id)) })
	for (const l of swapLines) out.push(l)
	// things of one kind changed the same way are one line ("emptied the 6 soda cans (370 g → 15 g each)"); then, of what is left of each (its
	// move, its turn), the same again ("moved the 5 soda cans 2 cm left"): the cans emptied and five of them also moved are two lines, not one
	// per can
	const nameGroup = (list, lines) => {
		const n = list.length
		const ids = list.map((e) => e.it.id)
		// (five of six: "5 of the soda cans")
		const all = [...B.values()].filter((i) => i.type === list[0].it.type).length
		// (the person's words for the whole group, when a target names exactly these things: "the pins"; never words that count more of them)
		const t = (Array.isArray(says) ? says : []).find((x) => Array.isArray(x?.ids) && x.ids.length === n && x.ids.every((id) => ids.includes(id)) && personWords(x.says, text, { n, all }))
		const theGroup = all > n && list[0].was.type === list[0].it.type ? `${n} of the ${kindNoun(list[0].it.type, all, { short: true })}` : `the ${n} ${kindNoun(list[0].was.type, n, { short: true })}`
		const line = lines
			.join("\u0003")
			.replace(/\u0001/g, theGroup)
			.replace(/\u0002/g, kindNoun(list[0].it.type, n))
			.replace(/(→ [\d.]+ k?g)(?=[,;)])/g, "$1 each")
			.split("\u0003")
		if (t && !/^(them|they|these|those|it)$/i.test(String(t.says).trim())) {
			const w = personWords(t.says, text, { n, all })
			for (let i = 0; i < line.length; i++) line[i] = line[i].replace(theGroup, /^(the|a|an|my|all|both)\b/i.test(w) ? lc(w[0]) + w.slice(1) : `the ${lc(w)}`)
		}
		return line
	}
	const groupBy = (keyOf) => {
		const m = new Map()
		for (const e of entries) {
			const k = keyOf(e)
			if (k === null) continue
			if (!m.has(k)) m.set(k, [])
			m.get(k).push(e)
		}
		return [...m.values()].filter((l) => l.length >= 2)
	}
	const before = new Map() // entry -> lines said for its group, before its own
	const groupable = (e) => !e.folded && e.was && !e.riders.length && !e.after.length && e.marks !== null
	for (const list of groupBy((e) => (groupable(e) && e.bits.length ? `${e.was.type}>${e.it.type}|${e.marks.join("|")}` : null))) {
		before.set(list[0], [...(before.get(list[0]) ?? []), ...nameGroup(list, list[0].marks)])
		for (const e of list) e.bitsSaid = true
	}
	const restOf = (e, N) => linesOf({ ...e, bits: [], marks: [] }, N)
	for (const list of groupBy((e) => {
		if (!groupable(e) || (e.bits.length && !e.bitsSaid)) return null
		const ls = restOf(e, MARK)
		return ls.length ? `${e.was.type}>${e.it.type}|${ls.join("|")}` : null
	})) {
		before.set(list[0], [...(before.get(list[0]) ?? []), ...nameGroup(list, restOf(list[0], MARK))])
		for (const e of list) e.restSaid = true
	}
	for (const e of entries) {
		for (const t of before.get(e) ?? []) out.push({ text: t, id: e.it.id, name: theName(e.it) })
		if (e.folded) continue
		const own = e.bitsSaid ? (e.restSaid ? [] : restOf(e, REAL)) : e.restSaid ? e.bits : linesOf(e, REAL)
		for (const t of own) out.push({ text: t, id: e.it.id, name: theName(e.it) })
	}
	// what was added and taken away, by kind; what was added where something was taken away replaced it
	let insA = null
	let insB = null
	try {
		insA = inspect(a)
		insB = inspect(b)
	} catch {}
	const spanOf = (ins, list) => {
		let x0 = Infinity
		let x1 = -Infinity
		for (const it of list) {
			const bx = ins?.box?.(it.id)
			if (!bx) continue
			x0 = Math.min(x0, bx.x0)
			x1 = Math.max(x1, bx.x1)
		}
		return Number.isFinite(x0) ? { x0, x1 } : null
	}
	const byType = (list) => {
		const m = new Map()
		for (const it of list) m.set(it.type, [...(m.get(it.type) ?? []), it])
		return [...m.values()]
	}
	const addGroups = byType([...asAdded, ...added.filter((i) => !cutAdded.has(i.id))])
	const remGroups = byType([...asRemoved, ...removed])
	const countOf = (list) => (list.length === 1 && list[0].type === "domino-row" ? Number(propValue(list[0], "count")) || null : null)
	const remWords = (list) => {
		const rows = countOf(list)
		if (rows) return `the ${rows} dominoes`
		if (list.length === 1) return callIt(list[0])
		return `the ${list.length} ${kindNoun(list[0].type, list.length, { short: true })}`
	}
	const addWords = (list) => {
		const rows = countOf(list)
		if (rows) return `a row of ${rows} dominoes`
		if (list.length !== 1) return `${list.length} ${kindNoun(list[0].type, list.length)}`
		// (one made a size of its own says it: "a closed laptop 6 mm thick", as the offer said it: V8820 c11)
		const it = list[0]
		for (const k of Object.keys(it.props ?? {})) {
			const sp = propSpec(it.type, k)
			const v = num(it.props[k])
			const d = num(sp?.default)
			if (sp?.unit !== "m" || v === null || d === null || !(d > 0) || Math.abs(v - d) / d < 0.08 || !/^(diameter|width|height|length|depth|thickness)$/.test(k)) continue
			const word = k === "diameter" ? "across" : d < 0.03 ? "thick" : k === "height" ? "tall" : k === "length" ? "long" : k === "depth" ? "deep" : "wide"
			return `${aKind(it.type)} ${fmtLen(v)} ${word}`
		}
		return aKind(it.type)
	}
	// (several of a kind: what each weighs, and how far apart they stand when that is even: "(370 g each, 10 cm apart)")
	const detailOf = (list) => {
		if (list.length < 2) return ""
		const ws = list.map((it) => weighs(it, massB))
		const w = ws.every((x) => x && Math.abs(x - ws[0]) / ws[0] < 0.01) ? `${fmtMass(ws[0])} each` : null
		const xs = list.map((it) => Number(it.x) || 0).sort((p, q) => p - q)
		const gaps = xs.slice(1).map((x, i) => x - xs[i])
		const even = gaps.length && gaps.every((g) => Math.abs(g - gaps[0]) < 0.005) && gaps[0] > 0.005 && list.every((it) => Math.abs((Number(it.y) || 0) - (Number(list[0].y) || 0)) < 0.005)
		const parts = [w, even ? `${fmtLen(gaps[0])} apart` : null].filter(Boolean)
		return parts.length ? ` (${parts.join(", ")})` : ""
	}
	const whereOf = (list) => {
		// (one thing the person put by another, "next to the box": said with their words for where; one pinned in the air there says so: "pinned
		// in the air beside the box" (V8842 k1 r1: "added a sneaker next to the box" for a sneaker fixed 25 cm up))
		if (list.length === 1 && anchors?.get?.(list[0].id)) {
			const an = anchors.get(list[0].id)
			const it = list[0]
			let pinned = false
			if (it.fixed === true && insB)
				try {
					pinned = !supportIn(b, insB, it.id) && (insB.box(it.id)?.y0 ?? 0) > 0.02
				} catch {}
			return pinned ? ` pinned in the air ${String(an.words).replace(/^(?:on the table )?(?:next to|by|near|close to)\b/i, "beside")}` : ` ${an.words}`
		}
		// (a group put by one thing, all of them: "next to the pedestal", or "either side of the pedestal" when they stand on both sides of it)
		if (list.length > 1 && anchors && list.every((it) => anchors.get?.(it.id)?.anchor && anchors.get(it.id).anchor === anchors.get(list[0].id).anchor)) {
			const an = anchors.get(list[0].id)
			const A0 = B.get(an.anchor)
			let sides = new Set()
			try {
				const ab = insB?.box(an.anchor)
				if (ab) for (const it of list) {
					const bx = insB.box(it.id)
					if (bx) sides.add((bx.x0 + bx.x1) / 2 < (ab.x0 + ab.x1) / 2 ? -1 : 1)
				}
			} catch {}
			return sides.size > 1 && A0 && /^(?:on the table )?(?:next to|beside|by|near|close to)\b/i.test(an.words) ? ` either side of ${theName(A0)}` : ` ${an.words}`
		}
		if (!insB) return ""
		const sups = list.map((it) => supportIn(b, insB, it.id))
		if (sups[0] && sups.every((s) => s && s.id === sups[0].id && s.inside === sups[0].inside)) {
			const S = B.get(sups[0].id)
			// (a support added by this change too is called by its kind, as its own line says: "on the wooden plank", never "on the ping-pong
			// shelf" beside "added a wooden plank": V8817 c01)
			return S ? ` ${sups[0].inside ? "in" : "on"} ${A.has(S.id) ? theName(S) : `the ${kindNoun(S.type)}`}` : ""
		}
		// one thing on the table: how it stands ("on its edge") and between what ("between the soda cans and the seesaw")
		if (list.length !== 1 || sups[0]) return ""
		const it = list[0]
		const bx = insB.box(it.id)
		if (!bx) return ""
		const flat = outlineOf(it.type, it.props, it.fixed, 0)
		const edge = flat && flat.w > 2 * flat.h && Math.abs(Math.abs(Number(it.angle) || 0) - 90) < 2 ? ", on its edge," : ""
		const kinds = new Map()
		for (const o of B.values()) kinds.set(o.type, (kinds.get(o.type) ?? 0) + 1)
		// (under something that was there: a thing above it along the table, the lowest, says where it is before any neighbour does: "added a cup
		// under Ramp 1", never "next to Ramp 2" (V8838 s-add-cup-under))
		let overThing = null
		{
			let over = null
			for (const o of B.values()) {
				if (o.id === it.id || o.type === "table" || o.type === "wall" || !A.has(o.id)) continue
				const ob = insB.box(o.id)
				if (!ob || ob.y0 < bx.y1 - 0.002 || ob.y0 - bx.y1 > 0.8) continue
				const ov = Math.min(ob.x1, bx.x1) - Math.max(ob.x0, bx.x0)
				if (ov < 0.5 * Math.min(bx.x1 - bx.x0, ob.x1 - ob.x0)) continue
				if (!over || ob.y0 < over.y0) over = { o, y0: ob.y0 }
			}
			overThing = over?.o ?? null
		}
		const near = (side) => {
			let best = null
			for (const o of B.values()) {
				// (never another thing added by this change: "a wooden plank next to the fan" and "a fan next to the wooden planks", each by the other)
				if (o.id === it.id || o.type === "table" || o.type === "wall" || !A.has(o.id)) continue
				const ob = insB.box(o.id)
				if (!ob || ob.y0 > bx.y1 || ob.y1 < bx.y0) continue
				const d = side < 0 ? bx.x0 - ob.x1 : ob.x0 - bx.x1
				if (d < -0.002 || d > 0.3) continue
				if (!best || d < best.d) best = { d, o }
			}
			// (one of several of a kind is said as the row, "the soda cans", when they are only that kind's: "Ramp 2" has a name of its own)
			const generic = (o) => {
				const nm = String(o.name ?? "").toLowerCase().replace(/\s+\d+$/, "")
				return !nm || `${typeName(o.type) ?? ""} ${kindNoun(o.type, 1, { short: true })} ${kindNoun(o.type, 1)}`.toLowerCase().includes(nm)
			}
			return best ? (kinds.get(best.o.type) > 1 && [...B.values()].filter((o) => o.type === best.o.type).every(generic) ? `the ${kindNoun(best.o.type, 2, { short: true })}` : theName(best.o)) : null
		}
		const L = near(-1)
		const Rr = near(1)
		// (between two things of the chain it stands in a row; else under one above it says where it is before a neighbour does)
		if (!(L && Rr) && overThing) return `${edge} under ${theName(overThing)}`.replace(/,(?= under)/, "")
		return `${edge}${L && Rr ? ` between ${L} and ${Rr}` : L || Rr ? ` next to ${L ?? Rr}` : ""}`.replace(/,$/, "")
	}
	// (several of a kind standing on one another: "a stack of 4 hardcover books")
	const stackWords = (g) => {
		if (g.length < 2 || !insB) return null
		const ids = new Set(g.map((i) => i.id))
		const on = g.filter((it) => {
			const sp = supportIn(b, insB, it.id)
			return sp && !sp.inside && ids.has(sp.id)
		}).length
		return on === g.length - 1 ? `a stack of ${g.length} ${kindNoun(g[0].type, g.length)}` : null
	}
	for (const { e, g, n, end } of rowCuts) out.push({ text: `replaced the ${end} ${n === 1 ? "domino" : `${n} dominoes`} with ${stackWords(g) ?? addWords(g)}${detailOf(g)}`, id: e.it.id, name: theName(e.it) })
	// (what was added where something was taken away is paired by the best overlap over all of them, not first come in the patch's order, and
	// a kind the words name after "replace … with" goes first: "replaced the 7 dominoes with 6 paperback books", never "with a sneaker" because
	// the sneaker came first in the patch and stood over the old row (V8837 k1))
	const withKinds = (() => {
		const w = String(text ?? "").toLowerCase()
		const out = new Set()
		for (const m of w.matchAll(/\b(?:replace|swap|switch|exchange|trade)\b[^.;!?]*?\b(?:with|for)\s+([^.;!?]*?)(?=,|\band\b|\bthen\b|[.;!?]|$)/g))
			for (const g of addGroups) {
				const words = `${kindNoun(g[0].type, 1, { short: true })} ${kindNoun(g[0].type, 2, { short: true })} ${typeName(g[0].type) ?? ""}`.toLowerCase().split(/[^\p{L}]+/u).filter((x) => x.length > 2 && !["the", "and", "standing"].includes(x))
				if (words.some((x) => new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(m[1]))) out.add(g)
			}
		return out
	})()
	const pairs = []
	for (const g of addGroups) {
		const sb = spanOf(insB, g)
		if (!sb) continue
		for (const r of remGroups) {
			const sa = spanOf(insA, r)
			if (!sa) continue
			const ov = Math.min(sa.x1, sb.x1) - Math.max(sa.x0, sb.x0)
			const need = 0.4 * Math.min(sa.x1 - sa.x0, sb.x1 - sb.x0)
			if (!(ov > 0 && ov >= need)) continue
			// (how much of each the overlap covers, so a small thing over a long row never beats the row that took its place)
			const share = ov / Math.max(sa.x1 - sa.x0, sb.x1 - sb.x0, 1e-6)
			pairs.push({ g, r, named: withKinds.has(g) ? 1 : 0, share, ov })
		}
	}
	pairs.sort((p, q) => q.named - p.named || q.share - p.share || q.ov - p.ov)
	const usedRem = new Set()
	const pairOf = new Map()
	for (const pr of pairs) {
		if (usedRem.has(pr.r) || pairOf.has(pr.g)) continue
		usedRem.add(pr.r)
		pairOf.set(pr.g, pr.r)
	}
	for (const g of addGroups) {
		const pair = pairOf.get(g)
		if (pair) out.push({ text: `replaced ${remWords(pair)} with ${stackWords(g) ?? addWords(g)}${detailOf(g)}`, id: g[0].id, name: theName(g[0]) })
		// (where a group stands before what each weighs: "added 2 rubber ducks either side of the pedestal (40 g each)")
		else out.push({ text: g.length > 1 ? `added ${stackWords(g) ?? addWords(g)}${whereOf(g)}${detailOf(g)}` : `added ${stackWords(g) ?? addWords(g)}${detailOf(g)}${whereOf(g)}`, id: g[0].id, name: theName(g[0]) })
	}
	const rest = remGroups.filter((r) => !usedRem.has(r))
	if (rest.length) out.push({ text: `removed ${andList(rest.map(remWords))}`, id: rest[0][0].id, name: theName(rest[0][0]) })
	if (num(a.seconds) !== null && num(b.seconds) !== null && Math.abs(a.seconds - b.seconds) > 1e-6) out.push({ text: `made it run ${sig(b.seconds)} s instead of ${sig(a.seconds)} s`, id: null, name: "the run" })
	// (an invisible wall at a table's end taken away, so a thing can go off that end: said, never hidden)
	const tbl = b.items.find((i) => i.type === "table") ?? a.items.find((i) => i.type === "table")
	for (const w of a.items.filter((i) => isSafetyWall(i) && !b.items.some((x) => x.id === i.id))) out.push({ text: `took away the invisible wall at the table's ${tbl && (Number(w.x) || 0) > (Number(tbl.x) || 0) ? "right" : "left"} end`, id: w.id, name: "the end wall" })
	// (one bracket at a time: "Ramp 1 (top), with the ball on it, 16 cm up", "10 LEGO bricks (2 × 4; 2.3 g each)")
	for (const o of out) o.text = tidyBrackets(o.text)
	return out
}
/** "both" for two, "all 3" for more: "both goals happen ✓", never "all 2 goals". */
const allN = (n) => (n === 2 ? "both" : `all ${n}`)
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
		else outcome = mode === "new" ? `${allN(goals.length)} goals happen ✓` : kept ? `everything still works ✓` : `now ${allN(goals.length)} goals happen ✓`
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
 * An edit's reply, first sentence: what the run shows (the card lists each change right under it, in real units, so the lead never says them
 * again). When a goal (or a row that all fell before) now fails: "Done, but now the tennis ball hits the side of the box and drops outside ✗."
 * (the panel adds the offer of a checked fix: "Want me to …? (checked: … ✓)"). targets: [{label, ok, was?, implicit?, happened?}]; fixApplied:
 * the fix that went on the table with it (a request that stated the outcome); undid: what a "make it work" answer would have undone of the
 * person's choice ("putting the seesaw back"), when it was not used and nothing changed. changes: the change lines (only whether there are any).
 */
/** A line that starts with a thing's name on screen, as a clause says it: "Seesaw no longer turns" -> "the seesaw no longer turns", "Soda can 6
 *  hits …" -> "the last soda can hits …"; a proper name ("Ball 2", "Ramp 1") stays. */
export function clauseName(line, scene) {
	const t = String(line ?? "")
	const its = (scene?.items ?? []).filter((i) => i.name && i.type !== "table").sort((a, b) => String(b.name).length - String(a.name).length)
	for (const it of its) {
		const n = String(it.name)
		if (!t.startsWith(n) || /^[\p{L}\p{N}]/u.test(t.slice(n.length, n.length + 1))) continue
		const said = placeName(it, scene)
		return said === n ? t : `${said}${t.slice(n.length)}`
	}
	return t
}
/** A goal's label inside a sentence: lowercase only a leading article or quantifier ("The egg lands…" -> "the egg lands…"), never a name
 *  ("Ball 2 lands in the box" stays: V8820, "make it work again so that ball 2 lands in the box"). */
const inClause = (label) => {
	const t = String(label ?? "").replace(/[.!]+$/, "")
	return /^(The|A|An|All|Every|Each|Both)\b/.test(t) ? lc(t) : t
}
export function editLead({ changes = [], targets = [], noChange = false, fixApplied = null, undid = null, room = [], said = null, also = [] }) {
	const plain = (l) => {
		const t = String(l).replace(/[.!]+$/, "")
		return /^(The|A|An|All|Every|Each|Both)\b/.test(t) ? lc(t) : t
	}
	const failed = targets.filter((t) => t.ok === false)
	const explicit = targets.filter((t) => !t.implicit)
	// (the card lists each change right under the lead, in real units, before → after: the lead is what the run shows, and the fix that went
	// with the change; it never says the list a second time)
	if (!failed.length) {
		const kept = explicit.length > 0 && explicit.every((t) => t.was === true) && !fixApplied
		const implicitKept = !explicit.length && targets.length === 1 && targets[0].was === true ? `${plain(targets[0].label)}, as before ✓` : ""
		const outcome = explicit.length === 1 ? (kept ? `${plain(explicit[0].label)}, as before ✓` : `${plain(explicit[0].label)} ✓`) : explicit.length > 1 ? (kept ? "everything still works ✓" : `${allN(explicit.length)} goals happen ✓`) : implicitKept
		// (a "make it work" says what it changed in the lines the card lists, every one of them: never the fix's words alone while the list shows
		// the cans emptied too (V8832 y8))
		if (Array.isArray(said) && said.length) return `Done! I ${saidChanges(said.map((c) => c?.text ?? String(c)), said.map((c) => c?.name ?? null))}${outcome ? ` — ${outcome}` : "."}`
		if (fixApplied && (noChange || !changes.length)) return `Done! I ${fixApplied.did}${outcome ? ` — ${outcome}` : ""}`
		if (noChange || !changes.length) return `That’s already how it is, so nothing needed changing${outcome ? ` — ${outcome}` : ""}`
		return `Done${fixApplied ? `, and I ${fixApplied.did}${/ to line up with |, so /.test(fixApplied.did) ? "" : " so it works"}` : ""}${outcome ? ` — ${outcome}` : "."}`
	}
	const g = failed.find((t) => !t.implicit) ?? failed[0]
	const words = g.happened ? String(g.happened).replace(/\.$/, "") : `“${String(g.label).replace(/[.!]+$/, "")}” doesn’t happen`
	const others = failed.filter((t) => t !== g && !t.implicit).length
	// (never two colons in one sentence: "it still doesn’t work — Ball 2 never moves: only 6 of 7 dominoes fall": V8820)
	const what = `${g.was === false ? `it still doesn’t work${/:/.test(words) ? " —" : ":"} ${words}` : `now ${words}`}${others ? ` (and ${plural(others, "more goal")} fail${others === 1 ? "s" : ""})` : ""} ✗`
	// (a "make it work" whose answer would have undone what the person chose: said as such, never "nothing needed changing")
	if ((noChange || !changes.length) && undid) return `I couldn't make it work without undoing what you chose (${undid}), so I left it as it is — ${g.was === false ? words : what.replace(/ ✗$/, "")} ✗.`
	if (noChange || !changes.length) return `Nothing needed changing for that — ${what}.`
	// (a goal that worked, stopped after what was changed to make room for the asked change: that is said as the reason)
	if (room.length && g.was === true) return `Done, but to make room I ${andList(room.slice(0, 2))}, and ${what}.`
	// (a part of the change nobody asked for, made to clear something, is the reason too: "to clear the dominoes I also raised the box 12 cm, and
	// now Ball 2 tops out 8.6 mm too low" (V8832 p3))
	if (also.length && g.was === true) return `Done, but ${also[0]}, and ${what}.`
	return `Done, but ${what}.`
}
/** Suggestions from the AI: [{label, prompt}], short and usable, at most 3. */
const cleanSuggestions = (list) =>
	(Array.isArray(list) ? list : [])
		.filter((s) => isObj(s) && typeof s.label === "string" && s.label.trim() && typeof (s.prompt ?? s.label) === "string")
		.map((s) => ({ label: clipLabel(s.label, 48), prompt: String(s.prompt ?? s.label).trim().slice(0, 600) }))
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
	// (named as they are called now: a thing renamed is said by its new name)
	const nameIn = (M, id) => M.get(id)?.name ?? typeName(M.get(id)?.type) ?? id
	const nameNow = (id) => (B.has(id) ? nameIn(B, id) : nameIn(A, id))
	const ca = contactPairs(before, sceneA)
	const cb = contactPairs(after, sceneB)
	// (each with the things it is about, for the heads-up: not part of the answer's own shape)
	Object.defineProperty(out, "contactList", { value: [], enumerable: false, writable: true })
	for (const [k, e] of cb) if (!ca.has(k) && e.speed >= HIT_FIRM && same(e.a) && same(e.b)) out.contactList.push({ text: `${nameIn(B, e.a)} now hits ${nameIn(B, e.b)} (at ${Number(e.t).toFixed(2)} s)`, ids: [e.a, e.b] })
	for (const [k, e] of ca) if (!cb.has(k) && e.speed >= HIT_FIRM && same(e.a) && same(e.b)) out.contactList.push({ text: `${nameNow(e.a)} no longer hits ${nameNow(e.b)}`, ids: [e.a, e.b] })
	out.contactList = out.contactList.slice(0, 6)
	out.contacts = out.contactList.map((c) => c.text)
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
	return lostStageList(a, b, sceneB).map((x) => x.text)
}
/** The same, each with the item it is about ([{text, ids}]), named as it is called now (sceneB): a ball swapped for an egg is "Egg", never the
 *  "Ball 2" it was. */
export function lostStageList(a, b, sceneB = null) {
	const there = sceneB ? new Map(sceneB.items.map((i) => [i.id, i])) : null
	const B = new Map((b?.summary?.stories ?? []).map((st) => [st.item, st]))
	const out = []
	for (const st of a?.summary?.stories ?? []) {
		if (there && !there.has(st.item)) continue
		const pa = progressOf(st, a)
		if (pa <= 0) continue
		const nb = B.get(st.item)
		if (progressOf(nb, b) >= pa) continue
		const name = there?.get(st.item)?.name ?? nb?.name ?? st.name
		out.push({ text: /fall$/.test(nb?.text ?? "") ? `${name}: ${fallText(b, nb)} (was ${fallText(a, st)})` : `${name} no longer ${/^turns/.test(st.text) ? "turns" : "moves"}`, ids: [st.item] })
	}
	return out
}
/**
 * Groups that fell in run a and fall less in run b: things of one kind that can topple (2 or more, not round, not fixed: a stack of bricks, a
 * row of books), counted as a "falls" goal counts them, over the ones both scenes have: ["Bricks: 3 of 5 fall (was 4 of 5)"]. A scene with no
 * plan (a built-in one) has no stages, and its run's stories say only each brick's top speed: the stack knocked down less is told here.
 */
export function lostGroups(a, b, sceneA, sceneB) {
	return lostGroupList(a, b, sceneA, sceneB).map((x) => x.text)
}
/** The same, each with the things it is about ([{text, ids}]). */
export function lostGroupList(a, b, sceneA, sceneB) {
	if (!a?.doc?.solids || !a?.track?.frames?.length || !b?.doc?.solids || !b?.track?.frames?.length || !sceneA?.items || !sceneB?.items) return []
	const inB = new Map(sceneB.items.map((i) => [i.id, i]))
	const groups = new Map()
	for (const it of sceneA.items) {
		const now = inB.get(it.id)
		if (!now || now.type !== it.type || it.type === "domino-row" || it.type === "table" || isSafetyWall(it) || it.fixed === true) continue
		try {
			if (isStaticItem(it.type, false)) continue
			const g = itemGeometry(it.type, it.props ?? {}, false)
			if ((g.solids ?? 1) !== 1 || g.shapes.some((s) => s.k === "circle")) continue
		} catch {
			continue
		}
		groups.set(it.type, [...(groups.get(it.type) ?? []), it.id])
	}
	const out = []
	for (const [type, ids] of groups) {
		if (ids.length < 2) continue
		let ra, rb
		try {
			;[ra] = checkGoals([{ kind: "falls", items: ids, label: "x" }], a)
			;[rb] = checkGoals([{ kind: "falls", items: ids, label: "x" }], b)
		} catch {
			continue
		}
		if (!Number.isFinite(ra?.fallen) || !Number.isFinite(rb?.fallen) || !(ra.fallen > 0) || rb.fallen >= ra.fallen) continue
		const what = pluralWord(lc(typeName(type) ?? type), 2).replace(/^./, (c) => c.toUpperCase())
		out.push({ text: `${what}: ${rb.fallen === 0 ? "none" : `${rb.fallen} of ${rb.of}`} fall (was ${ra.fallen} of ${ra.of})`, ids })
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
/** The words of a request that state its outcome, from where that clause starts to the end of its sentence: "Swap …, and put a sponge in the
 *  basket so the apple lands softly." -> "so the apple lands softly". null when it states none. */
export function outcomeClause(text) {
	const t = String(text ?? "")
	const m = OUTCOME_RE.exec(t)
	if (!m) return null
	// (back to the clause's own start: "so", "until", "and make sure", "to make", a comma, or the sentence's start; the match itself when it
	// starts one, "so the apple lands")
	const head = t.slice(0, m.index)
	const starts = [...head.matchAll(/(?:\b(?:so that|so|until|and make sure|make sure|to make|then)\b|[,;:](?=\s)|[.!?](?=\s))/gi)]
	const opens = /^(so|until|make sure|then|to make)\b/i.test(m[0])
	const from = opens ? m.index : starts.length ? starts.at(-1).index + (/^[,;:.!?]$/.test(starts.at(-1)[0]) ? 1 : 0) : 0
	const end = t.slice(m.index).search(/[.;!?](\s|$)/)
	return t.slice(from, end < 0 ? t.length : m.index + end).trim() || null
}
/** Words that send a thing off the table (as ai/schemas.mjs OFF_WORDS_RE). */
const OFF_TEXT_RE = /\b(off (the |its |that |this )?(edge|table|end)|over the edge|onto the floor|to the floor|fall(s|ing)? off|fell off)\b/i

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
// ---- what a request says to leave as it is: "make it work without touching the box", "fix it but leave the box alone", "can you make it work
// with the box where it is?", "don't move the box", "is there another way besides moving the box?" (V8842 ql / qn / qo / qp: the physics' own
// fix lowered the box in 4 of 4, though the AI's answers had kept it)
const KEEP_VERB = "(?:touch(?:ing)?|mov(?:e|ing)|chang(?:e|ing)|shift(?:ing)?|lower(?:ing)?|rais(?:e|ing)|lift(?:ing)?|adjust(?:ing)?|nudg(?:e|ing)|disturb(?:ing)?|resiz(?:e|ing)|tilt(?:ing)?|swap(?:ping)?|replac(?:e|ing)|remov(?:e|ing)|mess(?:ing)? with|do(?:ing)? anything (?:to|with)|repositio\\w*)"
const KEEP_STAY = "(?:alone|as (?:it|they) (?:is|are|was|were|stands?)|as is|where (?:it|they) (?:is|are|stands?|was|were|sits?)|in (?:its|their) (?:place|spot)|in place|untouched|unchanged|the same|still|put|be|fixed|exactly as (?:it|they) (?:is|are))"
const KEEP_RES = [
	// (never "not" alone: "the dominoes are not touching the seesaw" says how it is, not what to keep)
	new RegExp(`\\b(?:without|besides|other than|apart from|except(?: for)?|instead of|rather than)\\s+${KEEP_VERB}\\s+([^.,;:!?]+)`, "gi"),
	new RegExp(`(?:^|[.,;:!?]\\s*|\\b(?:and|but|please|just|so)\\s+)(?:don['’]?t|do not|never)\\s+${KEEP_VERB}\\s+([^.,;:!?]+)`, "gi"),
	new RegExp(`\\b(?:leave|leaving|keep|keeping|let)\\s+([^.,;:!?]+?)\\s+${KEEP_STAY}(?=\\s|[.,;:!?]|$)`, "gi"),
	// ("with the box where it is", never "with the ball still on it": only the words that say where it stands)
	new RegExp(`\\bwith\\s+([^.,;:!?]+?)\\s+(?:where (?:it|they) (?:is|are|stands?|was|were|sits?)|as (?:it|they) (?:is|are|was|were)|in (?:its|their) (?:place|spot)|in place|untouched|unchanged)(?=\\s|[.,;:!?]|$)`, "gi"),
	new RegExp(`(?:^|[.,;:!?]\\s*|\\b(?:and|but|while|so)\\s+)([^.,;:!?]+?)\\s+(?:stays?|staying|remains?|remaining)\\s+${KEEP_STAY}(?=\\s|[.,;:!?]|$)`, "gi")
]
/** The lengths a text states, in metres: "a 45 cm basket", "moved 12 cm right", "12 → 45 cm wide" (both). */
export function lengthsIn(text) {
	const t = String(text ?? "")
	const out = []
	const m2 = (v, u) => (u === "mm" ? v / 1000 : u === "cm" ? v / 100 : v)
	for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*→\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/g)) out.push(m2(Number(m[1]), m[2] ?? m[4]), m2(Number(m[3]), m[4]))
	for (const m of t.replace(/(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*→\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/g, " ").matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|m)\b(?![²³\/])/g)) out.push(m2(Number(m[1]), m[2]))
	return out.filter((v) => Number.isFinite(v) && v > 0)
}
/** Does the AI's own account of an edit state a length the card's lines (what is on the table) don't have? Each length it gives must be one of
 *  theirs, give or take 6 % (or 6 mm). */
export function plannedOff(planned, lines = []) {
	const said = lengthsIn(planned)
	if (!said.length) return false
	const facts = lengthsIn((Array.isArray(lines) ? lines : []).join("; "))
	return said.some((v) => !facts.some((f) => Math.abs(f - v) <= Math.max(0.006, 0.06 * v)))
}
/** The words of a request that say to leave something as it is, as said: ["without moving the box"]. */
export function keepClauses(text) {
	const t = String(text ?? "")
	const out = []
	for (const re of KEEP_RES) {
		re.lastIndex = 0
		for (const m of t.matchAll(re)) out.push(m[0].replace(/^[.,;:!?\s]+|^(?:and|but|while|so)\s+/i, "").trim())
	}
	return [...new Set(out)].filter(Boolean)
}
/** The things a request says to leave as they are: Set of ids (each phrase cut at its first place word: "without touching the box on the seesaw"
 *  is the box). Whatever finds a fix for this request never changes them. */
export function keptByWords(text, scene) {
	const t = String(text ?? "")
	const out = new Set()
	if (!t.trim() || !scene?.items?.length) return out
	for (const re of KEEP_RES) {
		re.lastIndex = 0
		for (const m of t.matchAll(re)) {
			for (const part of String(m[1] ?? "").split(/\s*(?:\band\b|\bor\b|\bnor\b|&)\s*/i)) {
				// (the thing, not where it is: "the box on the seesaw", "the box at the end")
				const head = part.split(/\b(?:on|in|at|by|next to|near|under|over|beside|behind|above|below|of|so|to|that|which|while|because|when|if|but|either|anymore|any more|at all|please|for now)\b/i)[0].trim()
				if (!head || /^(it|them|this|that|everything|anything|things|the rest|everything else|all|the scene|the machine)$/i.test(head.replace(/\s+else$/i, "").trim())) continue
				for (const id of namedIn(head, scene)) out.add(id)
			}
		}
	}
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
	// ("a small orange" is the fruit, not a colour: "swap the 8-ball for a small orange" names things, it describes none (V8837 k3))
	const d = t.replace(/\b(an?|the|small|big|large|little|ripe|whole)\s+((?:\w+\s+)?)orange\b(?=\s*(?:[,.;!?]|$|\s+(?:and|then|so|on|in|for|with|to|next|by|instead)\b))/gi, "$1 $2fruit")
	if (!t.trim() || statesOutcome(t) || BEHAVIOR_RE.test(t) || DESCRIBE_RE.test(d)) return null
	const named = namedIn(t, scene)
	if (!named.size) return null
	let R = new Map()
	try {
		R = riderMap(scene)
	} catch {}
	return { named, asked: new Set([...named, ...[...named].flatMap((id) => R.get(id) ?? [])]), placeAsked: PLACE_RE.test(t), timeAsked: TIME_RE.test(t) }
}
/** A request's own "move …" (a verb that starts its clause: "and move the seesaw and the box along") whose things the answer left where they
 *  were (a = the scene before, b = after): ["moving the seesaw and the box along (the AI left it out: ask again)"]. */
const MOVE_ASK_RE = /(?:^|[,:;.!?]\s*|\b(?:and|then|also|please|just)\s+)(move|shift|slide|raise|lower|lift)\s+([^.;:!?]*)/gi
/** Where a move is to, or what it is measured by: "closer to the seesaw", "to the top of Ramp 1", "next to the dominoes", "under the end of Ramp
 *  2", "by making the table taller". What follows names the place, never a thing to move (V8833 AB: "Move the dominoes closer to the seesaw"
 *  said "Not done: moving the seesaw"). */
const MOVE_PLACE_RE = /\b(?:closer|nearer|further|farther|next|close|right|left|up|down|back|forward|away|over|across|along|past|towards?|to|onto|into|in|on|at|under(?:neath)?|beneath|below|above|beside|besides|behind|between|by|near|against|from|so|so that|to make|while|because|until|then|once|after|before|which|that|with|without|using|instead)\b|,/i
/** Does a thing still stand as it did, everything about it the same (its place, its turn, its settings, how it rests, held or fixed)? */
const sameThing = (x, y) => {
	if (!x || !y || x.type !== y.type) return false
	const n = (v) => Number(v) || 0
	if (Math.abs(n(x.x) - n(y.x)) >= 0.005 || Math.abs(n(x.y) - n(y.y)) >= 0.005 || Math.abs(n(x.angle) - n(y.angle)) >= 0.5) return false
	const rest = (it) => JSON.stringify({ props: it.props ?? {}, place: it.place ?? null, held: !!it.held, fixed: !!it.fixed, z: it.z ?? null })
	return rest(x) === rest(y)
}
export function unmovedAsks(text, a, b) {
	const out = []
	if (!a?.items || !b?.items) return out
	const B = new Map(b.items.map((i) => [i.id, i]))
	const A = new Map(a.items.map((i) => [i.id, i]))
	for (const m of String(text ?? "").matchAll(MOVE_ASK_RE)) {
		const whole = m[2]
		// (only what the verb moves: the words before where it is to go, or how)
		const cut = MOVE_PLACE_RE.exec(whole)
		const clause = cut ? whole.slice(0, cut.index) : whole
		const ids = [...namedIn(clause, a)].filter((id) => B.has(id) && !isSafetyWall(A.get(id)))
		if (!ids.length) continue
		// (a word that names one of several, "the top ramp" for Ramp 1 and Ramp 2, is answered when one of them changed)
		const still = ids.filter((id) => sameThing(A.get(id), B.get(id)))
		if (!still.length) continue
		const moved = ids.filter((id) => !still.includes(id))
		const heads = (id) => new Set([String(A.get(id)?.name ?? ""), typeName(A.get(id)?.type) ?? ""].join(" ").toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 2))
		const shared = still.filter((id) => moved.some((o) => [...heads(id)].some((w) => heads(o).has(w) && clause.toLowerCase().includes(w))))
		const left = still.filter((id) => !shared.includes(id))
		if (!left.length) continue
		const verb = { move: "moving", shift: "shifting", slide: "sliding", raise: "raising", lower: "lowering", lift: "lifting" }[m[1].toLowerCase()] ?? "moving"
		const along = /\b(along|aside|over|back|forward|out of the way)\b/i.exec(whole)?.[1]
		out.push(`${verb} ${andList(left.map((id) => theName(A.get(id))))}${along ? ` ${along.toLowerCase()}` : ""} (the AI left it out: ask again)`)
	}
	return out
}
/** Words that ask for a place along the table, and up or down. */
const X_ASK_RE = /\b(left|right|along|closer|nearer|further|farther|towards?|away|across|next to|beside|past|x\s*=?\s*\d)\b/i
const Y_ASK_RE = /\b(up|down|raise[sd]?|raising|lower(?:ed|s|ing)?|higher|lift(?:ed|s)?|drop(?:ped|s)?|above|below|onto|on top|height)\b/i
/**
 * What the answer moved of a thing beyond what was asked (a = before, b = after): a thing named for a swap or a size and moved too, or a move
 * asked one way that went another way as well ("move the box 30 cm left" that also raised it 11.5 cm), with why when the run of its place shows
 * it: without that part it would start inside something ("to clear the dominoes"), or it sits on the middle of what it stands on. -> Map id ->
 * {reason, words} ("to clear the dominoes", "raised the box 12 cm"): the card's line says the reason, and the lead says it when a goal that
 * worked then fails (V8832 p3 / m3 / c02).
 */
/** Which ways a request's own words ask a thing (id, in scene a) to go: {x, y}. In a clause that moves or puts it, the words before where it goes
 *  name it ("move the box 30 cm left": along the table; "put a rubber duck in the basket" asks nothing of the basket). */
export function askedWays(text, a, id) {
	const clauses = String(text ?? "").split(/[,;.!?]|\b(?:and|then|also)\b/i).map((c) => c.trim()).filter(Boolean)
	const BOTH_RE = /\b(onto|on top|next to|beside|under|underneath|below|above|over|into|between|behind|in front|to the (?:top|end|other|left|right)|where)\b/i
	let x = false
	let y = false
	for (const c of clauses) {
		const cut = MOVE_PLACE_RE.exec(c)
		const mover = cut ? c.slice(0, cut.index) : c
		if (!namedIn(mover, a).has(id)) continue
		if (X_ASK_RE.test(c) || BOTH_RE.test(c)) x = true
		if (Y_ASK_RE.test(c) || BOTH_RE.test(c)) y = true
	}
	return { x, y }
}
export function unaskedMoves(text, a, b) {
	const out = new Map()
	if (!a?.items || !b?.items) return out
	const t = String(text ?? "")
	const named = namedIn(t, a)
	const asks = (id) => askedWays(t, a, id)
	const B = new Map(b.items.map((i) => [i.id, i]))
	let base = null
	try {
		base = new Set(inspect(b).overlaps.map((o) => `${o.a}|${o.b}`))
	} catch {}
	for (const ia of a.items) {
		if (!named.has(ia.id) || ia.type === "table" || isSafetyWall(ia)) continue
		const ib = B.get(ia.id)
		if (!ib) continue
		const dx = (Number(ib.x) || 0) - (Number(ia.x) || 0)
		const dy = (Number(ib.y) || 0) - (Number(ia.y) || 0)
		// (the part of the move nobody asked for: the ways its own words didn't ask)
		const ask = asks(ia.id)
		const ux = Math.abs(dx) >= 0.005 && !ask.x ? dx : 0
		const uy = Math.abs(dy) >= 0.005 && !ask.y ? dy : 0
		// (a swapped or resized thing re-seated where it stands moves up or down by its new size: not a move of its own)
		const reshaped = ia.type !== ib.type || [...new Set([...Object.keys(ia.props ?? {}), ...Object.keys(ib.props ?? {})])].some((k) => !sameValue(propValue(ia, k), propValue(ib, k)))
		// (and its height then is its re-seat on what it stands on: only a move along is its own)
		const uy2 = reshaped ? 0 : uy
		if (!ux && !uy2) continue
		let reason = null
		try {
			const test = { ...b, items: b.items.map((i) => (i.id === ia.id ? { ...i, x: (Number(i.x) || 0) - ux, y: (Number(i.y) || 0) - uy2 } : i)) }
			const hit = inspect(test).overlaps.filter((o) => (o.a === ia.id || o.b === ia.id) && o.depth > 0.002 && !base?.has(`${o.a}|${o.b}`)).sort((p, q) => q.depth - p.depth)[0]
			const other = hit ? B.get(hit.a === ia.id ? hit.b : hit.a) : null
			if (other && other.type !== "table" && !isSafetyWall(other)) reason = `to clear ${placeName(other, b)}`
			// (raised onto what it would have started inside: said as where it went, "onto the 3 hardcover books", never "to clear the 2nd hardcover
			// book from the bottom" for a pillow put on top of the stack (V8837 c08))
			if (other && uy2 > 0) {
				const insB = inspect(b)
				const sp = supportIn(b, insB, ia.id)
				const S = sp && !sp.inside ? B.get(sp.id) : null
				if (S && S.type === other.type) {
					const stack = b.items.filter((i) => i.type === S.type && Math.abs((Number(i.x) || 0) - (Number(S.x) || 0)) < 0.05)
					reason = `onto ${stack.length > 1 ? `the ${stack.length} ${kindNoun(S.type, stack.length, { short: true })}` : placeName(S, b)}`
				}
			}
		} catch {}
		// (a thing swapped or resized and set on the middle of what it stands on, the bowling ball on the pedestal: said so (V8832 c02))
		if (!reason && ux && reshaped)
			try {
				const ins = inspect(b)
				const bx = ins.box(ia.id)
				for (const o of b.items) {
					if (o.id === ia.id || o.type === "table" || o.type === "wall") continue
					const g = ins.gap(ia.id, o.id)
					const ob = ins.box(o.id)
					if (g === null || g < -0.003 || g > 0.004 || !bx || !ob || bx.y0 < ob.y1 - 0.01) continue
					if (Math.abs((bx.x0 + bx.x1) / 2 - (ob.x0 + ob.x1) / 2) < 0.005) reason = `to sit on the middle of ${placeName(o, b)}`
				}
			} catch {}
		// (the AI's own reason is never said unchecked: "the wider trampoline would start inside trampoline 2" when it wouldn't, V8832 c09 r2)
		if (!reason) continue
		const nm = placeName(ib, b)
		const words = uy2 && !ux ? `${uy2 > 0 ? "raised" : "lowered"} ${nm} ${fmtLen(uy2)}` : `moved ${nm} ${[ux ? `${fmtLen(ux)} ${ux > 0 ? "right" : "left"}` : null, uy2 ? `${fmtLen(uy2)} ${uy2 > 0 ? "up" : "down"}` : null].filter(Boolean).join(" and ")}`
		out.set(ia.id, { reason, words })
	}
	return out
}
/** Where the person put a thing in words that place it over or under another ("under ramp 1", "on top of the box"): kept as their words for
 *  where it is on the card, never a place a fix slides it along. */
const UNDER_RE = /\b(under(?:neath)?|below|beneath|above|on top of)\s+(?:the\s+|a\s+|an\s+)?([\p{L}\p{N}'’ -]+?)(?=\s+(?:to|so|that|and|then|for|waiting|watching|as)\b|[,.;!?]|$)/iu
export function placeWordsOf(text, a, b) {
	const out = new Map()
	if (!a?.items || !b?.items) return out
	const had = new Set(a.items.map((i) => i.id))
	const added = b.items.filter((i) => !had.has(i.id) && i.type !== "table" && !isSafetyWall(i))
	if (!added.length) return out
	for (const c of String(text ?? "").split(/[,;.!?]|\b(?:and|then|also)\b(?=\s+(?:put|place|add|stand|set|lay|drop|swap|replace|make|move))/i)) {
		const m = UNDER_RE.exec(c)
		if (!m) continue
		const mover = c.slice(0, m.index).toLowerCase()
		const at = [...namedIn(m[2], a)]
		if (at.length !== 1) continue
		const A = a.items.find((i) => i.id === at[0])
		const mine = added.filter((it) => {
			const k = String(kindNoun(it.type, 1, { short: true }) ?? "").toLowerCase()
			const head = k.split(/\s+/).at(-1)
			return head && head.length > 2 && (mover.includes(k) || new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(mover))
		})
		// (several of one kind, "a stack of 3 hardcover books under the pillow": each of them (V8842: the place words were dropped for a group))
		if (!mine.length || mine.some((it) => it.type !== mine[0].type || out.has(it.id))) continue
		for (const it of mine) out.set(it.id, { anchor: A.id, words: `${m[1].toLowerCase()} ${theName(A)}`, ...(mine.length > 1 ? { group: true } : {}) })
	}
	return out
}
/** Where the person's words put a thing they added, by another thing: "put a sneaker next to the box", "a rubber duck on the table next to the
 *  box to watch" (a = before, b = after). -> Map id (the added thing) -> {anchor (its id), words ("on the table next to the box")}: the card's
 *  line says it so (never "next to the seesaw" for where the AI happened to put it: V8832 m1 / m2 / c13), and a thing only put there may be moved
 *  along its anchor, out of the chain's way. */
const ANCHOR_RE = /\b(next to|beside|by|near|in front of|behind|close to)\s+(?:the\s+|a\s+|an\s+)?([\p{L}\p{N}'’ -]+?)(?=\s+(?:to|so|that|and|then|for|waiting|watching|as)\b|[,.;!?]|$)/iu
export function anchorsOf(text, a, b) {
	const out = new Map()
	if (!a?.items || !b?.items) return out
	const had = new Set(a.items.map((i) => i.id))
	const added = b.items.filter((i) => !had.has(i.id) && i.type !== "table" && !isSafetyWall(i))
	if (!added.length) return out
	for (const c of String(text ?? "").split(/[,;.!?]|\b(?:and|then|also)\b(?=\s+(?:put|place|add|stand|set|lay|drop|swap|replace|make|move))/i)) {
		const m = ANCHOR_RE.exec(c)
		if (!m) continue
		const mover = c.slice(0, m.index).toLowerCase()
		// (by its name before, or by what it is now when the same request swapped it: "next to the mug" for the cup made a coffee mug (V8841 k2))
		let at = [...namedIn(m[2], a)]
		let A = at.length === 1 ? a.items.find((i) => i.id === at[0]) : null
		if (at.length !== 1) {
			at = [...namedIn(m[2], b)].filter((id) => had.has(id))
			A = at.length === 1 ? b.items.find((i) => i.id === at[0]) : null
		}
		if (!A) continue
		// (the added thing its clause names by its kind: "a sneaker", "a coffee mug", "a rubber duck"; only one of a kind)
		const mine = added.filter((it) => {
			const k = String(kindNoun(it.type, 1, { short: true }) ?? "").toLowerCase()
			const head = k.split(/\s+/).at(-1)
			return head && head.length > 2 && (mover.includes(k) || new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(mover))
		})
		// (several of one kind, "two rubber ducks next to the pedestal": each of them, said once for the group (V8842 n5))
		if (!mine.length || mine.some((it) => it.type !== mine[0].type || out.has(it.id))) continue
		const onTable = /\bon the table\b/i.test(c)
		for (const it of mine) out.set(it.id, { anchor: A.id, words: `${onTable ? "on the table " : ""}${m[1].toLowerCase()} ${theName(A)}`, ...(mine.length > 1 ? { group: true } : {}) })
	}
	return out
}
/** Words of a change of its own in a "make it work" request (it is then not the container alone that answers it). */
const OWN_CHANGE_RE = /\b(add|adds|remove|delete|replace|swap|change|instead|heavier|lighter|bigger|smaller|larger|taller|shorter|wider|narrower|longer|thicker|thinner|steeper|flatter)\b/i
/** A request that gives a number with a unit ("10 cm", "5°", "200 g"): what it set is exactly what was asked. */
const EXPLICIT_RE = /\d+(\.\d+)?\s*(mm|cm|m|meters?|metres?|°|deg(rees?)?|g|grams?|kg|%|percent|times|x)\b/i
/** An amount said in words or numbers: "5 cm", "30°", "twice", "five times", "double". */
const AMT = String.raw`(?:\d+(?:\.\d+)?\s*(?:mm|cm|m|meters?|metres?|°|deg(?:rees?)?|g|grams?|kg|%|percent|x|times|inch(?:es)?|in|ft|feet)|twice|double|triple|half|(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+times)`
/** An amount said for a place: "10 cm left", "5 cm higher", "20 cm further along". */
const PLACE_AMOUNT_RE = new RegExp(`${AMT}\\s+(?:(?:further|farther|more)\\s+)?(?:to\\s+the\\s+)?(?:left|right|up|down|higher|lower|along|back|forward|closer|nearer|further|farther|away|over|across)\\b|\\b(?:to|at)\\s+(?:x\\s*=?\\s*)?\\d`, "i")
/** A setting's key -> the words a person uses for it ("wide" for a width, "heavier" for a weight). */
const KEY_WORDS = [
	[/^width$/, "wide|wider|narrow|narrower|width|widen"],
	[/height/, "tall|taller|short|shorter|high|higher|height|low|lower"],
	[/length/, "long|longer|short|shorter|length"],
	[/^mass$/, "heav\\w*|light(?:er)?|weigh\\w*|mass"],
	[/^(diameter|radius|size|scale)$/, "big|bigger|small|smaller|size|diameter|across|large|larger|tiny|huge"],
	[/spacing/, "apart|spac\\w*|gaps?|closer|further|farther"],
	[/^(growth|first_height)$/, "grow\\w*"],
	[/^(tilt|angle|start_angle)$/, "tilt\\w*|angle|steep\\w*|flat\\w*|degrees?"],
	[/^(stiffness|compression|pull_back|speed)$/, "stiff\\w*|soft\\w*|spring\\w*|pull\\w*|fast\\w*|slow\\w*|speed"]
]
/** Is this setting given an amount in the clause ("5 cm wide", "five times heavier", "width 30 cm", "twice as long")? */
const keyAmount = (clause, words) => new RegExp(`${AMT}\\s+(?:as\\s+|more\\s+|less\\s+)?(?:\\w+\\s+)?(?:${words})\\b|\\b(?:${words})\\s+(?:of\\s+|to\\s+|at\\s+|=\\s*)?${AMT}`, "i").test(clause)
/**
 * What of an edit is the person's own choice, from their words: {hard: Map id -> Set (never changed by a fix or a rework), forward: Map id ->
 * Set (may go further the same way, never back)}. protect: what the edit set (Map id -> Set | "all"); named: the things the words name (and
 * what rides on them); earlier: [id, keys] hard choices of the turns before. Read clause by clause: an amount is the choice of the things its own
 * clause names, said with the setting it is for ("make the box 5 cm wide" holds the box's width; "make it twice as long: double the dominoes
 * and move the seesaw and the box along" holds the dominoes' count, and the seesaw and the box only from going back: c11, 16 Oct).
 */
export function choicesOf(text, protect, scene, named, earlier = null, targets = null) {
	const t = String(text ?? "")
	const hard = new Map()
	const forward = new Map()
	const add = (m, id, k) => (m.get(id) ?? m.set(id, new Set()).get(id)).add(k)
	// (the clauses, and the things each names: what rides on a named thing is named with it)
	let R = new Map()
	try {
		R = riderMap(scene)
	} catch {}
	const clauses = t.split(/[.;:!?]+|,\s*(?:and\s+|then\s+)?/).map((c) => c.trim()).filter(Boolean)
	// (and the edit step's own reading of the words: "the yellow ball" is Ball 2, which no name says)
	const said = (Array.isArray(targets) ? targets : []).filter((x) => typeof x?.says === "string" && x.says.trim() && Array.isArray(x.ids))
	const namesOf = (c) => {
		const n = namedIn(c, scene)
		for (const x of said) if (c.toLowerCase().includes(x.says.trim().toLowerCase().replace(/^(the|a|an) /, ""))) for (const id of x.ids) n.add(id)
		return new Set([...n, ...[...n].flatMap((id) => R.get(id) ?? [])])
	}
	const mineAll = new Set([...(named ?? []), ...said.flatMap((x) => x.ids)])
	const per = clauses.map((c) => ({ c, ids: namesOf(c) }))
	const clausesOf = (id) => per.filter((x) => x.ids.has(id)).map((x) => x.c)
	for (const [id, keys0] of protect ?? []) {
		const it = scene?.items?.find((i) => i.id === id)
		if (!it) continue
		const keys = keys0 === "all" ? ["place", ...(propKeys(it.type) ?? [])] : [...keys0]
		const mine = mineAll.has(id)
		const cs = clausesOf(id)
		const anyC = (re) => cs.some((c) => re.test(c))
		for (const k of keys) {
			if (/^place/.test(k)) {
				if (mine && cs.some((c) => PLACE_RE.test(c))) add(cs.some((c) => PLACE_AMOUNT_RE.test(c)) ? hard : forward, id, k)
				continue
			}
			const label = `${k} ${propSpec(it.type, k)?.label ?? ""}`
			if (/\bcount\b|how many/i.test(label)) add(hard, id, k)
			else if (k === "full") mine && anyC(/\b(full|empty|emptied|filled|fill)\b/i) && add(hard, id, k)
			else if (k === "material") mine && anyC(/\b(wood\w*|metal|steel|glass|plastic|rubber|material|made of|paper|cardboard|foam)\b/i) && add(hard, id, k)
			else {
				const kw = KEY_WORDS.find(([kr]) => kr.test(k))
				if (!kw || !mine) continue
				const said = cs.filter((c) => new RegExp(`\\b(?:${kw[1]})\\b`, "i").test(c))
				if (said.length) add(said.some((c) => keyAmount(c, kw[1])) ? hard : forward, id, k)
			}
		}
	}
	// (a word the person gave a thing without an amount, "a heavy steel weight", "a big box", "make the egg bigger": that setting never goes the
	// other way in a fix or a rework (V8820 x5: "a heavy steel weight" was offered as "make the steel weight lighter (1 → 0.1 kg)"). Kept with
	// the hard choices as "<key>:up:<word>" / "<key>:down:<word>", which ./fixer.js and judgeRework read)
	for (const id of protect?.keys?.() ?? []) {
		const it = scene?.items?.find((i) => i.id === id)
		if (!it || it.type === "table") continue
		for (const [k, w] of wordChoices(t, it, [...said.filter((x) => x.ids.includes(id)).map((x) => x.says)])) {
			if (hard.get(id)?.has?.(k.split(":")[0])) continue
			add(hard, id, `${k}:${w}`)
		}
	}
	for (const e of Array.isArray(earlier) ? earlier : []) if (Array.isArray(e) && Array.isArray(e[1])) for (const k of e[1]) add(hard, e[0], k)
	return { hard, forward }
}
/** Words that give a thing's setting a way without an amount: [word, keys ("size": every size setting it has), +1 | -1]. */
const WAY_WORDS = [
	[/^(heavy|heavier|weighty)$/, ["mass"], 1, "heavy"],
	[/^(light|lighter)$/, ["mass"], -1, "light"],
	[/^(big|bigger|large|larger|huge|giant|enormous|massive)$/, "size", 1, "big"],
	[/^(small|smaller|tiny|little|mini|miniature)$/, "size", -1, "small"],
	[/^(tall|taller)$/, ["height"], 1, "tall"],
	[/^(short|shorter)$/, ["height", "length"], -1, "short"],
	[/^(long|longer)$/, ["length"], 1, "long"],
	[/^(wide|wider|broad|broader)$/, ["width"], 1, "wide"],
	[/^(narrow|narrower|thin|thinner|slim|slimmer)$/, ["width"], -1, "thin"]
]
const WAY_RE = WAY_WORDS.map((w) => w[0].source.replace(/^\^\(|\)\$$/g, "")).join("|")
/** The ways a request's words give one thing without an amount: [["mass:up", "heavy"], ["diameter:up", "big"]] (an adjective right before
 *  what names it, "a heavy steel weight", or a comparative right after, "the egg bigger"; never "lower the box", a verb, nor one with an amount,
 *  "5 cm wider", which is a hard choice). */
export function wordChoices(text, it, says = []) {
	const t = ` ${String(text ?? "").toLowerCase().replace(/[“”"’]/g, "'")} `
	const kind = String(typeName(it.type) ?? "").toLowerCase().replace(/,.*$/, "").replace(/\s*\(.*\)$/, "").trim()
	const own = String(it.name ?? "").toLowerCase().replace(/\s+\d+$/, "").trim()
	const head = kind.split(/\s+/).at(-1)
	const phrases = [...new Set([own, kind, ...says.map((s) => String(s).toLowerCase().replace(/^(the|a|an) /, "").trim()), head && head.length >= 4 && !HEAD_SKIP.has(head) ? head : null].filter((p) => p && p.length >= 3))]
	const keysOf = (keys) => {
		if (keys !== "size") return keys.filter((k) => propSpec(it.type, k))
		const sk = []
		for (const k of propKeys(it.type) ?? []) if (/^(diameter|radius|size|scale|width|height|length|depth)$/.test(k)) sk.push(k)
		return sk
	}
	const out = new Map()
	for (const p of phrases) {
		const pe = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		const found = []
		// (an adjective right before it, with up to two other words between, never an article: "a heavy steel weight", "a big red box")
		for (const m of t.matchAll(new RegExp(`\\b(${WAY_RE})\\s+((?!(?:the|a|an|its|their|this|that|it|them|of|on|in|for|to|with|and|or)\\b)[\\w-]+\\s+){0,2}?${pe}(e?s)?\\b`, "g"))) found.push(m[1])
		// (a comparative right after it, "the egg bigger", "the weight a bit heavier": no amount said with it)
		for (const m of t.matchAll(new RegExp(`\\b${pe}(e?s)?\\s+(?:(?:a (?:bit|little|lot)|much|even|far|way)\\s+)?(${WAY_RE})\\b(?!\\s*(?:than|by))`, "g"))) {
			const before = t.slice(Math.max(0, m.index - 30), m.index)
			if (!new RegExp(`${AMT}\\s*(?:\\w+\\s+)?$`, "i").test(before)) found.push(m[2])
		}
		for (const w of found) {
			const ww = WAY_WORDS.find(([re]) => re.test(w))
			if (!ww) continue
			// (no amount for it in its clause: "make the box 5 cm wider" is a hard choice already)
			if (new RegExp(`${AMT}\\s+(?:as\\s+|more\\s+|less\\s+)?${w}\\b`, "i").test(t)) continue
			for (const k of keysOf(ww[1])) out.set(`${k}:${ww[2] > 0 ? "up" : "down"}`, ww[3])
		}
	}
	return [...out]
}
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
				// (what it was billed, as soon as it is: the background's dollars count it at once)
				if (num(r.usage?.costInUSD) !== null) onEvent?.({ type: "ai-cost", step, usd: num(r.usage.costInUSD) })
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
					// (a refusal the person has to act on: sign in, today's allowance, a deployment without the AI. Said as such, never tried again)
					const refused = timedOut ? null : refusalOf(e, step)
					if (refused) throw refused
					const retryable = timedOut || code === "timeout" || code === "budget" ? false : body?.retryable === true || ((status === 0 || status >= 500) && body?.retryable !== false)
					lastErr = timedOut || code === "timeout" || code === "budget" || status === 504
						? new AiError("timeout", `The ${step} step took too long and was stopped`, { step, retryable: true })
						: code === "bad_input" || status === 400 || status === 413
							? new AiError("input", plainError(e?.message ?? String(e), step, body), { step, retryable: false, cause: e })
							: new AiError(code === "invalid_output" || (!code && /invalid|schema/i.test(e?.message ?? "")) ? "invalid" : "gateway", plainError(e?.message ?? String(e), step, body), { step, retryable, cause: e })
					// (the imagine step is not tried again here: the server already tried every image route twice, and another try would run the
					// pre-pass and the image chain again, ~$0.02–0.03 and 11–20 s more before the words-only fallback)
					if (!retryable || tries >= 1 || step === "imagine") throw lastErr
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
	 * opts = {onEvent, refineRounds, tune: bool, finalCheck: bool, reconcile: bool (picture coverage fix, default on), quickEdits: bool (default on),
	 *         imagine: "off" (the default: round3-plan §8 D) | "auto" | "always" (| "observe" | "direct", the bench): a concept picture first for a
	 *         new scene from words (./imagine.js),
	 *         aimFirst: bool (default on: "make it work" aims the container first, ./aim.js)}
	 *   onEvent({type: "concept", image, cast, story}): the concept picture of a new scene, as soon as it arrives (never the user's picture);
	 *   onEvent({type: "concept-dropped", text}): reading it or planning from it failed, the build goes on from the words alone (take it down)
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

	async function run(request, { onEvent, signal, refineRounds, tune: doTune = true, finalCheck = true, reconcile: doReconcile = true, quickEdits = true, stageTune: doStage = true, imagine: imagineSetting = "off", aimFirst = true, physFirst: physFirstOn = true, physFirstMs = PHYS_FIRST_MS * TIME_SCALE }) {
		const T0 = now()
		const text = String(request.text ?? "").trim()
		// (the person's own words: a rework's text is the app's, so a target's words never pass for theirs there)
		const personText = request.rework === true ? "" : text
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
		/** One model call of a background rework, from its edit's allowance (request.aiBudget, shared by the reworks): false when none is left. */
		const spendCall = () => {
			const b = request.aiBudget
			if (!isObj(b)) return true
			if (!(b.left > 0)) return false
			// (nor once the edit's dollars are spent: AI_USD)
			if (num(b.usd) !== null && b.usd >= (num(b.cap) ?? AI_USD)) return false
			b.left--
			b.started = (b.started ?? 0) + 1
			// (the panel's line says "asking the AI" only from here, when a call has really started: V8820 c02, "asking the AI to rework it" with
			// no call made)
			try {
				b.onStart?.()
			} catch {}
			return true
		}

		// ---- 0. imagine-first (ai/research/round3-plan.md §4.1, ./imagine.js): a NEW scene from words alone that is a multi-step chain (or any,
		// with "Always") first gets a concept picture of the setup from the server's imagine step, observed and planned from with the words in
		// charge. It informs the plan only and is never the user's picture: its observation goes to the plan step alone (reconcile, coverage, the
		// critic, the rate-only check and the report never see it), plan.covers is dropped, and nothing on the card compares the scene with it.
		// Every failure on this path (no picture, observe failing, the plan from it failing) falls back to the words alone with one info line.
		let concept = null // {name, label, dataUrl, width, height}: the picture as the plan step gets it
		let conceptObs = null // (its observation: for the plan step only)
		report.concept = null // (an edit or a check never makes one)
		const conceptHow = conceptRoute({ mode, images, text, imagine: imagineSetting })
		// (a refusal the person has to act on (sign in, today's allowance, no AI here, no access) ends the build as such: the plan from the words
		// would be refused the same way, one more metered request for nothing)
		const refused = (e) => e instanceof AiError && ["sign_in", "quota", "off", "access"].includes(e.kind)
		const dropConcept = (words) => {
			say("info", "imagine_failed", words)
			if (concept) onEvent({ type: "concept-dropped", text: words })
			concept = null
			conceptObs = null
			report.concept = null
		}
		if (conceptHow) {
			try {
				// (the client's deadline: past 75 s the plan is made from the words; the server's own budget for the step is 150 s)
				const out = await timed("imagine", null, () => withDeadline((sg) => call("imagine", { text }, sg, report, onEvent), num(deps.imagineDeadlineMs) ?? IMAGINE_DEADLINE_MS, signal))
				const c = pickConcept(out)
				if (c) {
					concept = { name: CONCEPT_LABEL, label: CONCEPT_LABEL, dataUrl: c.image, width: c.width, height: c.height }
					report.concept = { image: c.image, cast: c.cast, story: c.story, how: conceptHow }
					onEvent({ type: "concept", image: c.image, cast: c.cast, story: c.story })
				} else dropConcept("No concept picture (none came back): planned from your words alone")
			} catch (e) {
				if (signal.aborted) throw e?.name === "AbortError" ? e : abortError()
				if (refused(e)) throw e
				dropConcept(`No concept picture (${whyFailed(e)}): planned from your words alone`)
			}
		} else onEvent({ type: "step", step: "imagine", state: "skipped" })
		check()
		const conceptText = () => `${text}\n\n${CONCEPT_NOTE}`
		const conceptRefs = () => (concept ? [wireImage(concept)] : [])

		// ---- 1. observe (a new scene from pictures; an edit sends its pictures to the edit step itself)
		let observation = null
		const refs = images.map((im) => wireImage(im))
		if (concept && conceptHow === "observe") {
			try {
				conceptObs = await timed("observe", "the concept picture", () => callStep("observe", { text: conceptText(), images: conceptRefs() }))
			} catch (e) {
				if (e?.name === "AbortError" || signal.aborted || refused(e)) throw e
				dropConcept(`The concept picture couldn't be read (${whyFailed(e)}): planned from your words alone`)
			}
		} else if (concept) onEvent({ type: "step", step: "observe", state: "skipped", label: "the plan reads the concept picture itself" })
		else if (images.length && mode === "new") {
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
		let editKind = null // (an edit: the answer's kind, read first: ./edit-turns.js routeKind)
		let fixKind = false // (an edit that is to work: kind "fix", or a request that states the outcome: it is made to work as part of the edit)
		let editPayload = null // (an edit: what the edit step was sent; the repair and "make it work" turns send it again with feedback)
		let firstPatch = null // (an edit: the first answer's plan, its changes and what couldn't be done)
		let scope = null // (a plain edit: the things it names, editScope)
		let leftAlone = [] // (what the edit step changed beyond them, put back)
		let madeRoom = new Set() // (what was moved only to make room for the change)
		let seatedIds = new Set() // (a swapped thing given its seat on its support: adjustEdit (0a))
		const planOnScreen = !!(request.plan && sameScene(request.planScene, request.scene))
		const basePlan = mode !== "new" ? (planOnScreen ? clone(request.plan) : planFromScene(request.scene)) : null
		// (what the person's words say to leave as it is, "make it work without touching the box": kept by every search, round and rework of this
		// request as a choice of theirs (request.keep / request.hard), and any fix that changes it thrown away (`frozen`): V8842 ql / qn / qo / qp)
		const frozen = mode === "edit" && personText ? keptByWords(personText, request.scene) : new Set()
		if (frozen.size) {
			const typeOf = new Map(request.scene.items.map((i) => [i.id, i.type]))
			request = {
				...request,
				keep: [...(Array.isArray(request.keep) ? request.keep.filter((k) => !(Array.isArray(k) && frozen.has(k[0]))) : []), ...[...frozen].map((id) => [id, "all"])],
				hard: [...(Array.isArray(request.hard) ? request.hard : []), ...[...frozen].map((id) => [id, ["place", ...(propKeys(typeOf.get(id)) ?? [])]])]
			}
			report.kept = [...frozen]
		}
		/** Does a scene change any thing the person said to leave as it is (frozen)? */
		const touchesFrozen = (sc) => {
			if (!frozen.size || !sc?.items) return false
			const at = new Map(sc.items.map((i) => [i.id, i]))
			for (const id of frozen) {
				const a = request.scene.items.find((i) => i.id === id)
				const b = at.get(id)
				if (!a) continue
				if (!b || b.type !== a.type || Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) > 1e-4 || Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) > 1e-4 || Math.abs((Number(a.angle) || 0) - (Number(b.angle) || 0)) > 0.01) return true
				for (const k of new Set([...Object.keys(a.props ?? {}), ...Object.keys(b.props ?? {})])) {
					const p = propValue(a, k)
					const q = propValue(b, k)
					if (typeof p === "number" && typeof q === "number" ? Math.abs(p - q) > 1e-6 * Math.max(1, Math.abs(p)) : JSON.stringify(p ?? null) !== JSON.stringify(q ?? null)) return true
				}
			}
			return false
		}
		// (a "make it work" typed in the open, nothing of its own to change: held to the background's budget, AI_USD and MAKE_IT_WORK_MS, and the
		// physics looks first (physFirst))
		const typedMake = physFirstOn && mode === "edit" && request.rework !== true && !request.background && statesOutcome(text) && !EXPLICIT_RE.test(text) && !PLACE_RE.test(text) && !OWN_CHANGE_RE.test(text) && !!request.sim?.track?.frames?.length
		const madeDeadline = Date.now() + MAKE_IT_WORK_MS
		let physFirst = null
		let physFix = null
		const physCtl = new AbortController()
		signal.addEventListener("abort", () => physCtl.abort(), { once: true })
		const startPhysFirst = () =>
			(async () => {
				let before = null
				if (isObj(request.reference) && Array.isArray(request.reference.items)) before = { scene: request.reference, sim: await simulate(request.reference, physCtl.signal) }
				const goals = Array.isArray(basePlan?.goals) ? basePlan.goals : null
				const targets = fixTargets({ goals, scene: request.scene, before, sim: request.sim })
				if (!judgeTargets(targets, request.sim).some((r) => r.ok === false)) return null
				const touchedK = new Map()
				for (const [id, keys] of (Array.isArray(request.keep) ? request.keep : []).filter(Array.isArray)) if (request.scene.items.some((i) => i.id === id)) touchedK.set(id, keys === "all" ? "all" : new Set(Array.isArray(keys) ? keys : []))
				const hard = Array.isArray(request.hard) ? new Map(request.hard.filter(Array.isArray).map(([id, ks]) => [id, ks === "all" ? "all" : new Set(Array.isArray(ks) ? ks : [])])) : null
				const fr = await findFix({ scene: request.scene, sim: request.sim, goals, before, touched: touchedK, swapped: new Set(), targets, ...(hard ? { hard } : {}), ...(frozen.size ? { frozen } : {}) }, { signal: physCtl.signal, budgetMs: physFirstMs, minRuns: PHYS_FIRST_RUNS, hardMs: Math.max(physFirstMs, madeDeadline - Date.now() - 16000) })
				// (a fix that changes what the person said to leave as it is is no fix for this request)
				return fr?.status === "found" && touchesFrozen(fr.fix?.scene) ? { ...fr, status: "none", fix: undefined } : fr
			})().catch(() => null)
		let physDone = null // (its answer, once it has one)
		let physT0 = Date.now()
		/** The physics' own search's answer when it is done within `ms`; else null (it goes on). */
		const physWait = async (ms) => {
			if (!physFirst) return null
			if (physDone) return physDone
			const r = await Promise.race([physFirst, sleep(ms, signal).then(() => null, () => null)])
			return r ?? physDone
		}
		const physFound = () => physDone?.status === "found" && !!physDone.fix?.sim
		/** Whether one more round of the typed "make it work" fits its budget (AI_USD, MAKE_IT_WORK_MS). */
		const roundFits = () => !typedMake || roundBudget(report.calls, { deadline: madeDeadline })
		const realIds = (request.scene?.items ?? []).filter((i) => i.type !== "table" && !isSafetyWall(i)).map((i) => i.id)
		/** Goal labels that name a thing the library doesn't have, said by its stand-in (plan.missing's substitute_type): in the version's plan,
		 *  its solved goals and its scene's goals alike. */
		const subLabels = (v, pl) => {
			const subs = (Array.isArray(pl?.missing) ? pl.missing : []).filter((m) => isObj(m) && typeof m.asked === "string" && (m.substitute_type || m.substitute))
			if (!subs.length) return
			const map = new Map()
			for (const g of [...(v.solved?.goals ?? []), ...(pl.goals ?? [])].filter(isObj)) {
				if (typeof g.label !== "string" || map.has(g.label)) continue
				let label = g.label
				for (const m of subs) {
					const S = m.substitute_type ?? m.substitute
					if (!goalRefs(g).some((id) => v.scene.items.some((i) => i.id === id && i.type === S))) continue
					const asked = String(m.asked).toLowerCase().replace(/^(a|an|the|some|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+/, "").replace(/\s+(in place of|instead of|for)\s+.*$/, "").trim()
					const one = asked.replace(/(?<=[^s])s$/, "")
					const words = [...new Set([asked, one, `${one}s`, one.split(/\s+/).at(-1), `${one.split(/\s+/).at(-1)}s`])].filter((w) => w.length >= 3).sort((p, q) => q.length - p.length)
					for (const w of words) {
						const plural = /s$/.test(w) && w !== one
						const to = kindNoun(S, plural ? 2 : 1, { short: true })
						if (new RegExp(`\\b${to}\\b`, "i").test(label)) continue
						// (a last word whose word before it is already one of the stand-in's own is the AI's name for it: "the first toilet roll" is
						// never "the first toilet toilet paper roll" (V8842 n2))
						const toW = new Set(to.toLowerCase().split(/\s+/))
						label = label.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), (x, off, all) => {
							const prev = /([\p{L}'’-]+)\s+$/u.exec(all.slice(0, off))?.[1]?.toLowerCase()
							if (!/\s/.test(w) && prev && toW.has(prev)) return x
							return off === 0 ? to.replace(/^./, (c) => c.toUpperCase()) : to
						})
					}
				}
				if (label !== g.label) map.set(g.label, label)
			}
			if (!map.size) return
			for (const list of [v.solved?.goals, pl.goals, v.plan?.goals, v.scene?.goals]) for (const g of Array.isArray(list) ? list : []) if (isObj(g) && map.has(g.label)) g.label = map.get(g.label)
		}
		/** An edit that changes nothing (ask: one question naming the candidates, a chip per reading; answer; undo: the app's own Undo does it). */
		const replyOnlyReport = (out, kind) => {
			const undo = kind === "undo"
			const reply = typeof out?.reply === "string" ? out.reply : typeof out?.summary === "string" ? out.summary : null
			if (report.edit) report.edit.reply = reply
			Object.assign(report, { replyOnly: true, undo, reply: reply ?? (undo ? "Use Undo to go back to the scene before." : "Nothing to change."), suggestions: cleanSuggestions(out?.suggestions), title: request.scene?.name ?? "", missing: Array.isArray(out?.missing) ? out.missing : [], totalMs: Math.round(now() - T0) })
			report.models = [...new Set(report.calls.map((c) => c.model).filter(Boolean))]
			return report
		}
		const keptOf = (pl) => realIds.filter((id) => pl.items.some((x) => isObj(x) && x.id === id)).length
		/** The scene's goals, each in the form a set_goals gives it when it is the same goal there (its kind, and its label or a thing it is about),
		 *  else as it was; goals that are new there are left out. */
		const carriedGoals = new Map() // (a scene goal's label -> the label of the AI's own form of it, carried over to what replaced its thing)
		const keptGoals = (was, set, { removed = new Set(), added = new Set() } = {}) => {
			const A = (Array.isArray(was) ? was : []).filter(isObj)
			const S = (Array.isArray(set) ? set : []).filter(isObj)
			const kindOf = (g) => goalKindOf(g)
			// (the same goal: its kind and every thing it is about, or its label; sharing the ball is not enough: "it bounces off pad 2" is never
			// "it bounces off trampoline 1", c09 live, 16 Oct: all three became pad 1's)
			const sameRefs = (x, g) => {
				const a = new Set(goalRefs(x))
				const b = new Set(goalRefs(g))
				return a.size === b.size && [...a].every((id) => b.has(id))
			}
			// (or the same goal carried over to what replaced its thing: "The big domino slams the seesaw" as "The last remote slams the seesaw" when
			// the dominoes gave way to remotes: the rest of what it is about the same (V8832 m2: it was dropped and "no longer checked" said instead)
			const carried = (x, g) => {
				const a = goalRefs(x)
				const b = goalRefs(g)
				if (!a.some((id) => added.has(id)) || !b.some((id) => removed.has(id))) return false
				const ka = new Set(a.filter((id) => !added.has(id)))
				const kb = new Set(b.filter((id) => !removed.has(id)))
				return ka.size === kb.size && [...ka].every((id) => kb.has(id))
			}
			const used = new Set()
			return A.map((g) => {
				const same = S.find((x) => !used.has(x) && kindOf(x) === kindOf(g) && (sameRefs(x, g) || (x.label && String(x.label).toLowerCase() === String(g.label ?? "").toLowerCase())))
				const m = same ?? S.find((x) => !used.has(x) && kindOf(x) === kindOf(g) && carried(x, g))
				if (m) used.add(m)
				if (m && !same && g.label) carriedGoals.set(g.label, m.label ?? goalLabel(m))
				return m ?? g
			})
		}
		// (the words ask for an outcome, or about the goals themselves: only then may an edit change the goals)
		const goalsAsked = statesOutcome(text) || /\b(goals?|targets?|aim|win|finish(es)? (in|on|at))\b/i.test(text)
		/** An edit answer -> the plan on screen with its patches applied (or its whole plan), the plan's changes and what couldn't be done. */
		const patchPlan = (out) => {
			let pl
			let planChanges = []
			let skipped = []
			if (isObj(out) && Array.isArray(out.items)) pl = out
			else if (isObj(out?.plan) && Array.isArray(out.plan.items)) pl = out.plan
			else if (Array.isArray(out?.patches) || Array.isArray(out)) {
				// (the goals are the person's: an edit changes them only when the words ask for an outcome or a goal. A goal the AI made up for a
				// plain change ("All the soda cans fall" for "replace the dominoes with soda cans") is an unasked change, and one the run can't
				// meet left the fix search nothing to offer (16 Oct); a "make it work" the app asks for keeps them as they are)
				let ps = Array.isArray(out) ? out : out.patches
				// (a "make it work" (kind fix) restores the scene's goals, never adds its own: "Ball 2 is launched" added to "fix it" made the run judged
				// by a goal nobody asked for, edit bench 16 Oct)
				const fixOnly = editKind === "fix" && !/\b(goals?|targets?)\b/i.test(text)
				const dropGoals = mode === "edit" && Array.isArray(ps) && ps.some((p) => isObj(p) && String(p.op ?? "").toLowerCase() === "set_goals") && (request.rework === true || !goalsAsked || fixOnly)
				// (a goal the scene had may still follow the change, "the whole tower falls" now covering the 4 new blocks, or a new name: kept in its
				// new form; a goal the AI made up is left out, and one it dropped is kept)
				const opOf = (p) => (isObj(p) ? String(p.op ?? "").toLowerCase() : "")
				const removedIds = new Set(ps.filter((p) => ["remove", "delete"].includes(opOf(p)) && p.id !== undefined).map((p) => String(p.id)))
				const addedIds = new Set(ps.filter((p) => opOf(p) === "add").map((p) => String((isObj(p.item) ? p.item : p).id ?? "")).filter(Boolean))
				if (dropGoals) ps = ps.map((p) => (opOf(p) === "set_goals" ? { ...p, goals: keptGoals(basePlan?.goals, p.goals, { removed: removedIds, added: addedIds }) } : p))
				const r = applyPatches(basePlan, ps, request.scene)
				pl = r.plan
				planChanges = r.changes
				skipped = r.skipped
				// (goal labels follow the change's words: what was swapped away by a word of its own, "the giant", is said as what took its place; one
				// of a row by its place, as the lead says it)
				if (mode === "edit" && Array.isArray(pl.goals))
					try {
						swapPhraseLabels(pl, text)
						const at = new Map((request.scene?.items ?? []).map((i) => [i.id, i]))
						placeLabels(pl.goals, pl.items.filter(isObj).map((it) => ({ id: it.id, type: it.type, name: it.name, x: at.get(it.id)?.x ?? (isObj(it.place) ? num(it.place.x) : null), y: at.get(it.id)?.y ?? 0 })), text)
					} catch {}
				for (const k of ["title", "missing", "notes", "goals", "tune", "assumptions", "differences"]) if (isObj(out) && out[k] !== undefined && !(k === "goals" && (dropGoals || (mode === "edit" && (request.rework === true || !goalsAsked || fixOnly))))) pl[k] = out[k]
				if (dropGoals && report.edit) report.edit.goalsKept = true
				// (words that send a new thing off the table make its goal an "off" goal, never "moves": the server's validator does it too, ai/schemas.mjs
				// offGoals; a ping-pong ball blown along the table "moved" 40 cm and the card said every goal happens: V8817 c01)
				if (goalsAsked && OFF_TEXT_RE.test(text) && Array.isArray(pl.goals)) {
					const had = new Set((basePlan?.items ?? []).filter(isObj).map((i) => i.id))
					pl.goals = pl.goals.map((g) => {
						if (!isObj(g) || goalKindOf(g) !== "moves" || typeof g.item !== "string" || had.has(g.item)) return g
						const l = typeof g.label === "string" && g.label.trim() ? g.label.trim().replace(/[.!]+$/, "") : null
						const said = l ? (/\boff\b/i.test(l) ? l.replace(/\boff (?:of )?(?:its|the|a|an|that|this) [\p{L}-]+(?: [\p{L}-]+)?(?= |$|[,;])/iu, "off the edge") : `${l}, off the edge`) : null
						return { kind: "off", item: g.item, ...(said ? { label: /\b(edge|table|end|floor)\b/i.test(said) ? said : `${said} off the edge` } : {}) }
					})
				}
			} else return null
			if (!pl.title) pl.title = basePlan.title
			// "fix it" / "make it work" on a scene whose plan has no knobs for a goal (a scene made by hand, the starter): the tuner gets the goal's
			// container to move (along the table; up and down too when it hangs or stands in the air), so it can find where the thing really lands
			if (CHECK_RE.test(text) && Array.isArray(pl.goals)) {
				pl.tune = Array.isArray(pl.tune) ? pl.tune : []
				for (const g of pl.goals) {
					if (!isObj(g) || (g.kind ?? "in") !== "in" || !g.container || pl.tune.some((k) => k.id === g.container)) continue
					const c = request.scene.items.find((i) => i.id === g.container)
					const pc = pl.items.find((i) => i.id === g.container)
					if (!c || !pc) continue
					pl.tune.push({ id: c.id, param: "x", min: Math.round(((Number(c.x) || 0) - 0.3) * 1000) / 1000, max: Math.round(((Number(c.x) || 0) + 0.3) * 1000) / 1000, why: "where the container stands decides whether it catches" })
					if (pc.place?.on === "air" && num(pc.place?.y_m) !== null) pl.tune.push({ id: c.id, param: "y", min: Math.max(0, pc.place.y_m - 0.15), max: pc.place.y_m + 0.15, why: "how high the hanging container is" })
				}
			}
			return { plan: pl, planChanges, skipped }
		}
		/** Patches that take most of the scene away and put other things in its place: a new scene, not a change of this one. */
		const replacesScene = (pl) => realIds.length >= 2 && pl.items.filter((x) => isObj(x) && !(basePlan.items ?? []).some((b) => b.id === x.id)).length > 0 && keptOf(pl) < Math.ceil(realIds.length * 0.4)
		if (mode === "check") {
			plan = basePlan
			if (!plan.title) plan.title = request.scene?.name ?? "Scene"
			onEvent({ type: "step", step: "plan", state: "skipped" })
		} else if (mode === "edit") {
			// (intent "edit": the scene on screen is changed, never replaced; an answer that it is a different scene comes back as such: ai/DESIGN.md §13.8)
			// (§14.2 (1): the scene exactly as on the table; the plan only while the scene is still that plan's result (else the server reads the
			// scene as made by hand, as measured); the last ≤ 20 turns, the replies as shown; no run: the server runs the scene itself, §14.1)
			editPayload = { text, scene: request.scene, ...(planOnScreen ? { plan: basePlan } : {}), images: refs, history: (request.history ?? []).slice(-20), intent: "edit" }
			// (a background rework spends from its edit's allowance of model calls, request.aiBudget: none left, it isn't asked)
			if (!spendCall()) throw new AiError("budget", "No AI calls are left for this change", { step: "edit", retryable: false })
			// (a typed "make it work" with nothing of its own to change: the physics looks for the smallest checked change on the scene as it is, side
			// by side with the AI's first answer, and is used when that answer doesn't work, before any more AI rounds (V8838 s-fix-user-swap: three
			// calls, $0.15–0.21 and 65–85 s, then nothing, where lowering the box 5 cm works))
			if (typedMake) {
				physT0 = Date.now()
				physFirst = startPhysFirst()
				physFirst.then((r) => (physDone = r), () => {})
			}
			// (a rework the app asks for in the background, after a change stopped a goal: the reasons the run shows go with the request, as the
			// measured "make it work" feedback does: ai/DESIGN.md §16)
			const out = await timed("edit", null, () => callStep("edit", typeof request.feedback === "string" && request.feedback.trim() ? { ...editPayload, feedback: request.feedback.slice(0, 7000) } : editPayload))
			editOut = isObj(out) ? out : {}
			// (§14.2 (2): the answer's kind first: ask / answer / undo / new change nothing; change / fix are applied)
			editKind = routeKind(out, text)
			fixKind = editKind === "fix" || statesOutcome(text)
			const reply = typeof out?.reply === "string" ? out.reply : typeof out?.summary === "string" ? out.summary : null
			const targets = cleanTargets(editOut.targets)
			report.edit = { kind: editKind, targets, targetWords: targetWords(targets, request.scene), why: typeof editOut.why === "string" && editOut.why.trim() ? editOut.why.trim() : null, changes: [], planChanges: [], reply, mode: out?.mode ?? (out?.plan ? "plan" : "patch") }
			// a different scene altogether ("start over with a catapult"): an edit never replaces the scene on screen. Nothing is changed; the
			// reply says so and the panel offers to build it as a new scene (New → Build with AI)
			const wholePlan = isObj(out?.plan) && Array.isArray(out.plan.items) ? out.plan : isObj(out) && Array.isArray(out.items) ? out : null
			const refuseNew = () => {
				report.edit.kind = "new"
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
			if (editKind === "new" || (isObj(out) && realIds.length && wholePlan && keptOf(wholePlan) < Math.ceil(realIds.length / 2))) return refuseNew()
			// a question (ask: one question naming the candidates, a chip per reading; answer), or "put it back" (undo: the app's own Undo does it):
			// the reply, and nothing rebuilt
			if (REPLY_KINDS.has(editKind)) return replyOnlyReport(out, editKind)
			firstPatch = patchPlan(out)
			if (!firstPatch) throw new AiError("invalid", "The AI's answer to that edit couldn't be used", { step: "edit", retryable: true })
			plan = firstPatch.plan
			// patches that take most of the scene away and put other things in its place build a new scene, not a change of this one
			if (replacesScene(plan)) return refuseNew()
			// a plain change does what it names and nothing else: what the edit step re-tuned beyond that (often to keep a goal working) is put back.
			// The run then shows what the change really does, and the panel offers a checked fix ("the edit isn't automatically supposed to work")
			scope = editScope(text, request.scene)
			Object.assign(report.edit, { changes: firstPatch.planChanges, planChanges: firstPatch.planChanges })
		} else {
			// (intent "new": a brand-new scene, whatever is on screen; the scene on screen is not sent)
			if (concept) {
				// (from the concept: the words with CONCEPT_NOTE, the picture, and (observe route) its observation)
				try {
					plan = await timed("plan", null, () => callStep("plan", { text: conceptText(), observation: conceptObs, images: conceptRefs(), intent: "new" }))
					if (isObj(plan?.plan)) plan = plan.plan
					if (!isObj(plan) || !Array.isArray(plan.items) || !plan.items.length) throw new AiError("invalid", "The plan that came back has no items", { step: "plan", retryable: true })
				} catch (e) {
					if (e?.name === "AbortError" || signal.aborted || refused(e)) throw e
					dropConcept(`The plan from the concept picture failed (${whyFailed(e)}): planned from your words alone`)
					plan = null
				}
			}
			if (!concept) plan = await timed("plan", null, () => callStep("plan", { text, observation, images: refs, intent: "new" }))
			if (isObj(plan?.plan)) plan = plan.plan
			// (the concept is not the user's picture: nothing downstream compares the scene with it)
			if (concept && isObj(plan)) delete plan.covers
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
		/** The start-up overlaps web/sim reports for a scene ([{text, items}]). */
		const layoutWarnings = (scene) => {
			try {
				return simLayout(scene).warnings ?? []
			} catch {
				return []
			}
		}
		let frameWarnings = null
		const freshOverlaps = (scene) => {
			frameWarnings ??= new Set(layoutWarnings(request.scene).map((w) => w.text))
			return layoutWarnings(scene).filter((w) => !frameWarnings.has(w.text))
		}
		/**
		 * The table, the stage and the safety walls stay as they were unless the change sets the table itself; a changed or new thing that would
		 * start inside a safety wall is slid off it (with what rests on it) instead of the table being widened for it (ai/DESIGN.md §14.2 (3);
		 * the replay of the stored edit answers, round3-plan §4.2 (3): the table was widened to 3.74–3.86 m in 8 of 8 replays of 4 cases, and
		 * "everything else exactly as it was" was then untrue). Only when that would leave more things starting inside each other than the
		 * wider table does (a thing the change pushed aside, slid back into it) is the solver's wider table kept, and the card says so.
		 */
		const holdFrame = (r, p) => {
			if (JSON.stringify(p?.table ?? null) !== JSON.stringify(basePlan?.table ?? null)) return
			const isFrame = (i) => i.type === "table" || isSafetyWall(i)
			const frame0 = request.scene.items.filter(isFrame)
			const same = frame0.length === r.scene.items.filter(isFrame).length && frame0.every((f) => JSON.stringify(r.scene.items.find((i) => i.id === f.id) ?? null) === JSON.stringify(f))
			if (same && JSON.stringify(r.scene.stage ?? null) === JSON.stringify(request.scene.stage ?? null)) return
			const S = clone(r.scene)
			const order = new Map(request.scene.items.map((i, k) => [i.id, k]))
			S.items = [...S.items.filter((i) => !isFrame(i)), ...frame0.map(clone)].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
			if (request.scene.stage) S.stage = clone(request.scene.stage)
			const slid = []
			const wallsNow = S.items.filter(isSafetyWall)
			for (let pass = 0; pass < 3 && wallsNow.length; pass++) {
				const fresh = freshOverlaps(S).filter((w) => (w.items ?? []).some((id) => wallsNow.some((x) => x.id === id)))
				if (!fresh.length) break
				const rows = digestScene(S).items
				const boxes = new Map(rows.map((q) => [q.id, q.box]))
				const tableX = Number(S.items.find((i) => i.type === "table")?.x ?? 1.3)
				const done = new Set()
				for (const w of fresh) {
					const wall = wallsNow.find((x) => (w.items ?? []).includes(x.id))
					const id = (w.items ?? []).find((x) => x !== wall.id)
					const it = S.items.find((i) => i.id === id)
					const b = boxes.get(id)
					const wb = boxes.get(wall.id)
					if (!it || !b || !wb || isFrame(it) || done.has(id) || r.exact?.has?.(id)) continue
					const left = (wb.x0 + wb.x1) / 2 < tableX
					const shift = left ? wb.x1 - b.x0 + 0.003 : -(b.x1 - wb.x0 + 0.003)
					// (with what rests on it, all the way up)
					const group = new Set([id])
					for (let grew = true; grew; ) {
						grew = false
						for (const q of rows) if (!group.has(q.id) && group.has(q.rests_on)) (group.add(q.id), (grew = true))
					}
					for (const gid of group) {
						const g = S.items.find((i) => i.id === gid)
						if (!g || isFrame(g)) continue
						g.x = r6((Number(g.x) || 0) + shift)
						done.add(gid)
					}
					slid.push(`${theName(it)} slid ${fmtLen(Math.abs(shift))} ${shift > 0 ? "right" : "left"}, off the ${left ? "left" : "right"} safety wall`)
				}
				if (!done.size) break
			}
			if (freshOverlaps(S).length > freshOverlaps(r.scene).length) return
			r.scene = S
			for (const f of frame0) r.exact?.add?.(f.id)
			for (const it of S.items) if (!isFrame(it) && JSON.stringify(it) !== JSON.stringify(request.scene.items.find((x) => x.id === it.id) ?? null)) r.exact?.delete?.(it.id)
			if (slid.length) r.slid = slid
		}
		/**
		 * A swapped thing given its seat (adjustEdit (0a), or a set_place of the server's at its old x) stays there: where the solver put it
		 * elsewhere (it pushed it aside to clear a neighbour it is now too big to stand beside), it goes back to its seat with its bottom where the
		 * old one's was, and what rests on it with it. The overlap that may leave is said, and the one repair turn is told (§14.2 (3) "exact",
		 * (4)); the solver's re-placement is never taken silently. -> r.seated
		 */
		const seatSwaps = (r, p) => {
			const at = new Map(r.scene.items.map((i) => [i.id, i]))
			let rows = null
			for (const it of p.items ?? []) {
				if (!isObj(it) || !isObj(it.place)) continue
				const s0 = request.scene.items.find((i) => i.id === it.id)
				const s1 = at.get(it.id)
				const pl = it.place
				if (!s0 || !s1 || s0.type === it.type || pl.on === "air" || pl.lean || num(pl.x) === null || Math.abs(pl.x - (Number(s0.x) || 0)) > 1e-6) continue
				// (only a thing pushed aside to clear a neighbour: one slid along its support to stand fully on it, an 80 cm skateboard down the ramp
				// the 20 cm car stood on, has its seat there)
				const pushed = r.issues.find((i) => i.item === it.id && i.code === "moved")
				const off = (Number(s0.x) || 0) - (Number(s1.x) || 0)
				if (!pushed || Math.abs(off) <= 0.002) continue
				const ang = Number(s0.angle) || 0
				const l0 = lowOf(s0.type, s0.props, s0.fixed, ang)
				const l1 = lowOf(s1.type, s1.props, s1.fixed, ang)
				if (l0 === null || l1 === null) continue
				const want = { x: Number(s0.x) || 0, y: r6((Number(s0.y) || 0) + l0 - l1) }
				const d = { dx: want.x - (Number(s1.x) || 0), dy: want.y - (Number(s1.y) || 0) }
				// (with what rests on it, all the way up)
				rows ??= (() => {
					try {
						return digestScene(r.scene).items
					} catch {
						return []
					}
				})()
				const group = new Set([it.id])
				for (let grew = true; grew; ) {
					grew = false
					for (const q of rows) if (!group.has(q.id) && group.has(q.rests_on)) (group.add(q.id), (grew = true))
				}
				r.scene = { ...r.scene, items: r.scene.items.map((x) => (!group.has(x.id) ? x : x.id === it.id ? { ...x, x: r6(want.x), y: want.y, angle: ang } : { ...x, x: r6((Number(x.x) || 0) + d.dx), y: r6((Number(x.y) || 0) + d.dy) })) }
				r.issues = r.issues.filter((i) => !(i.item === it.id && (i.code === "moved" || i.code === "kept_on")))
				r.issues.push({ level: "info", code: "seated", item: it.id, text: `${nameOfItem(s1) ?? it.id} kept its seat where ${nameOfItem(s0) ?? "the old one"} was${pushed ? ` (the solver would have moved it ${fmtLen(Math.abs(off))} ${off < 0 ? "right" : "left"}: ${String(pushed.text).replace(/^.*? to /, "to ")})` : ""}` })
				;(r.seated ??= []).push({ id: it.id, dx_m: r6(-off), why: pushed?.text ?? null })
			}
		}
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
			seatSwaps(r, p)
			holdFrame(r, p)
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
			// (an edit keeps every kind of goal the scene had in the scene it puts on the table: a built-in scene's "all ten pins fall" or "the
			// pendulum starts the run" is judged in every later run, shown with the results, and kept for the next edit; the solver writes only the
			// "in" goals the engine checks into a new scene)
			// (a scene that carried them: a built-in one, or one an edit kept them in; an AI-built scene's own goals stay where they are, in its plan)
			// (an "in" goal into a container the engine doesn't check, a plastic cup, stays out of them: ./goals.js judges it by the cup's walls)
			// (and an "off" goal an edit adds, "blows the ping-pong ball off the edge": the engine checks it too, so the results show it)
			if (mode === "edit" && ((request.scene?.goals ?? []).some((g) => (g?.kind ?? "in") !== "in") || (solved.goals ?? []).some((g) => g?.kind === "off")) && Array.isArray(solved.goals)) {
				const typeIn = new Map(solved.scene.items.map((i) => [i.id, i.type]))
				// (one into a cup, a jar or a mug is the engine's "walls" kind: judged by its own walls, and shown with the results too)
				solved.scene = { ...solved.scene, goals: solved.goals.filter((g) => (g.kind ?? "in") !== "in" || ["box", "cup", "bucket", "basket", "plastic-cup", "glass-jar", "coffee-mug"].includes(typeIn.get(g.container))).map((g) => ((g.kind ?? "in") === "in" && !["box", "cup", "bucket", "basket"].includes(typeIn.get(g.container)) ? { ...g, kind: "walls" } : { ...g })) }
			}
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
		// ---- the stage tuner (a new scene is physics first: ./stage-tune.js). Its candidates run on the page's fix workers when there are any
		// (several at once, off the page's thread; each sends back only its judgement), else on the app's own engine; the version it keeps is always
		// placed and run again on the app's own engine before anything is shown or judged.
		const physicsFirst = mode === "new" && doTune && doStage
		let pool = null
		if (physicsFirst)
			try {
				pool = deps.fixPool?.() ?? null
			} catch {}
		const judgeHere = async (scene, goals, checks, sg) => judgeStages(await simulate(scene, sg ?? signal), scene, goals, checks, goalDistance)
		const ST = createStageTuner({
			solve: (p) => solveV(p),
			simulate: (scene, sg) => simulate(scene, sg ?? signal),
			evalRun: pool
				? async (scene, goals, checks, sg) => {
						if (!pool.broken)
							try {
								return await pool.stage(scene, goals, checks, sg ?? signal)
							} catch (e) {
								if (e?.name === "AbortError" || signal.aborted) throw e
							}
						return judgeHere(scene, goals, checks, sg)
					}
				: null,
			goalDistance,
			setKnob,
			tune: (o) => tune({ ...o, solver: solveV, signal }),
			// (a height knob on a static thing that can't hold itself up turns what it stands on instead, or is left out: nothing is tuned into mid-air)
			safe: (knobs, ev) => safeKnobs({ items: ev.plan.items, tune: knobs }, ev.scene).knobs,
			parallel: pool && !pool.broken ? Math.max(2, pool.size) : TUNE_PARALLEL
		})
		/** A version's goals and stage checks on its run (kept on it); full: with the whole run (the critic's stage facts, the joint tuner). */
		const evOf = async (v, full = false) => (v.ev && (!full || v.ev.sim) ? v.ev : (v.ev = await ST.evaluate(v.plan, { pre: { solved: v.solved, sim: v.sim }, full, signal })))
		const passN = (ev) => (ev?.ok ? ev.f.goalsOk + ev.f.stagesOk : -1)
		const allPass = (ev) => !!ev?.ok && ev.f.goalsOk === ev.f.goals && ev.f.stagesOk === ev.f.stages
		const builtWorse = (a, b) => b.f.errors + b.f.through > a.f.errors + a.f.through
		/** Checks that passed in a and fail in b. A check b no longer has (the critic renamed or replaced a goal on purpose) counts only when b
		 *  passes fewer checks in all. */
		const lostIn = (a, b) => {
			const lost = ST.lostChecks(a, b)
			if (!b?.ok) return lost
			const there = new Set([...b.goals.map((g) => g.label), ...b.stages.filter((st) => st.check).map((st) => st.label)])
			return lost.filter((l) => there.has(l) || passN(b) < passN(a))
		}
		const ownStages = (p) => Array.isArray(p?.stages) && p.stages.some((st) => isObj(st?.check))
		const counts = (ev) => (ev?.ok ? { goals: `${ev.f.goalsOk}/${ev.f.goals}`, checks: `${ev.f.stagesOk}/${ev.f.stages}`, passed: allPass(ev) } : null)
		let stageLog = null // (what the stage tuner tried, stage by stage: the critic is told, for the stage it couldn't make work)
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
		/** An edit's plan made exactly the change: (1) – (4) below, each tried in a solve before it is kept. -> {plan, leftAlone, madeRoom} */
		let followRows = null
		const adjustEdit = (planIn, patches = []) => {
			let plan = planIn
			const leftAlone = []
			const madeRoom = new Set()
			// (0) what rests on, or is held at most 6 cm above, a thing the change moves (dx / dy) goes with it by exactly that much: its pose shifted,
			// never re-seated by the solver (ai/DESIGN.md §14.2 (3); the replay of the stored edit answers, round3-plan §4.2 (3): Ball 1, held
			// just above Ramp 1, was left inside the raised ramp; Ball 2 on a seesaw moved 3 cm came back 0.03 mm off and its run changed)
			const moves = new Map()
			const followers = new Set() // (what goes with a moved thing: part of the asked change, never "put back" below)
			const seated = new Set() // (a swapped thing given its seat (0a): its place is the app's, not the person's)
			const patchIds = (pt) => (Array.isArray(pt?.ids) ? pt.ids : [pt?.id ?? pt?.item?.id]).filter((id) => id !== undefined && id !== null)
			// (0a) a swap keeps its seat (ai/DESIGN.md §14.2 (3)): a thing whose kind the change swapped, resting on something, stays on that support
			// at the same x (its height follows its new size; solveV's seatSwaps holds it there). An AI-built scene's plan may place it "right of the
			// dominoes": a bigger kind that no longer fits there was put by the solver wherever it could stand (pend3, 15 Oct: the tennis ball 33 cm
			// left, in front of the first domino and in the pendulum's path, said nowhere). Where it doesn't fit at its seat, it starts inside its
			// neighbour, and the one repair turn (§14.2 (4)) is told so.
			if (mode === "edit") {
				const placedBy = new Set((Array.isArray(patches) ? patches : []).filter((pt) => isObj(pt) && ["move", "set_place", "place"].includes(String(pt.op ?? "").toLowerCase())).flatMap(patchIds))
				for (const pt of Array.isArray(patches) ? patches : []) {
					if (!isObj(pt) || String(pt.op ?? "").toLowerCase() !== "replace_type") continue
					for (const id of patchIds(pt)) {
						const s = request.scene.items.find((i) => i.id === id)
						const it = plan.items.find((x) => isObj(x) && x.id === id)
						const pl = isObj(it?.place) ? it.place : null
						if (!s || !it || !pl || pl.lean || pl.on === "air" || pl.inside) continue
						// (the answer placed it itself: kept, unless it named only what it stands on, "set_place {on: cup_post}" for "a cup on a post at
						// the same spot": then the same spot, never wherever the solver finds room (round 3's acceptance: the cup 30 cm left))
						if (placedBy.has(id) && (num(pl.x) !== null || pl.left_of || pl.right_of || pl.align)) continue
						if (num(pl.x) !== null && Math.abs(pl.x - (Number(s.x) || 0)) < 1e-6 && !pl.left_of && !pl.right_of && !pl.align) continue
						const seat = { ...clone(pl), on: typeof pl.on === "string" && pl.on ? pl.on : "table", x: r6(Number(s.x) || 0) }
						delete seat.left_of
						delete seat.right_of
						delete seat.align
						plan = { ...plan, items: plan.items.map((x) => (x === it ? { ...clone(x), place: seat } : x)) }
						seated.add(id)
					}
				}
			}
			for (const pt of Array.isArray(patches) ? patches : []) {
				if (!isObj(pt) || pt.op !== "move" || (num(pt.dx) === null && num(pt.dy) === null) || [pt.x, pt.y, pt.y_m, pt.angle_deg].some((v) => num(v) !== null)) continue
				for (const id of patchIds(pt)) moves.set(id, { dx: num(pt.dx) ?? 0, dy: num(pt.dy) ?? 0 })
			}
			if (mode === "edit" && moves.size) {
				const patched = new Set((Array.isArray(patches) ? patches : []).flatMap(patchIds))
				followRows ??= (() => {
					try {
						return digestScene(request.scene).items
					} catch {
						return []
					}
				})()
				const onScreen = new Map(request.scene.items.map((i) => [i.id, i]))
				const frame = (r) => r.type === "table" || isSafetyWall(onScreen.get(r.id))
				const under = new Map() // id -> what it rests on, or the thing it is held just above
				for (const r of followRows) {
					if (frame(r)) continue
					if (r.rests_on && !/^(nothing|held)/.test(r.rests_on)) {
						under.set(r.id, r.rests_on)
						continue
					}
					const it = onScreen.get(r.id)
					if (!r.box || !it || isStaticItem(it.type, it.fixed === true)) continue
					let best = null
					for (const o of followRows) {
						if (o.id === r.id || !o.box || frame(o) || o.box.x1 < r.box.x0 || o.box.x0 > r.box.x1 || o.box.y1 > r.box.y0 + 1e-4) continue
						if (!best || o.box.y1 > best.box.y1) best = o
					}
					if (best && r.box.y0 - best.box.y1 <= 0.06) under.set(r.id, best.id)
				}
				const top = Number(request.scene.items.find((i) => i.type === "table")?.y) || 0
				const shifted = new Map()
				for (let grew = true; grew; ) {
					grew = false
					for (const [id, on] of under) {
						if (moves.has(id) || patched.has(id) || !moves.has(on)) continue
						const s = onScreen.get(id)
						const pi = plan.items.find((x) => isObj(x) && x.id === id)
						if (!s || !pi) continue
						const d = moves.get(on)
						shifted.set(id, { on: "air", x: r6((Number(s.x) || 0) + d.dx), y_m: r6((Number(s.y) || 0) - top + d.dy), angle_deg: Number(s.angle) || 0, keep: true })
						moves.set(id, d)
						grew = true
					}
				}
				for (const id of shifted.keys()) followers.add(id)
				if (shifted.size) plan = { ...plan, items: plan.items.map((x) => (isObj(x) && shifted.has(x.id) ? { ...clone(x), place: shifted.get(x.id) } : x)) }
			}
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
					// (how much new trouble a version has: what starts inside what that the edit step's own version didn't have)
					const newTrouble = (p) => {
						try {
							const r = solveV(p)
							return [...trouble(r)].filter((k) => !refTrouble.has(k)).length + (poseOf(r).every((q, i) => near(q, refPose[i])) ? 0 : 0.5)
						} catch {
							return Infinity
						}
					}
					const midX = askedIds.length ? askedIds.map((id) => Number(ref.scene.items.find((i) => i.id === id)?.x) || 0).reduce((a, b) => a + b, 0) / askedIds.length : 0
					const decided = []
					for (const it of changed) {
						if (scope.asked.has(it.id) || followers.has(it.id)) continue
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
						if (JSON.stringify(a.place ?? null) !== JSON.stringify(it.place ?? null)) tries.push({ entry: { ...clone(a), place: clone(it.place) }, room: true, own: true })
						let ok = tries.find((t) => lands(withEntry(plan, it.id, t.entry)))
						if (!ok) {
							// (nothing lands cleanly: the edit step's own move of it is kept only when it starts inside nothing new; else whichever of
							// these starts the fewest things inside each other, putting it back when that ties (e3, 16 Oct: the dominoes moved 44.5 cm
							// "to make room", into Ramp 2, a start-up overlap the person never caused)
							const own = tries.find((t) => t.own)
							const cost = (t) => newTrouble(withEntry(plan, it.id, t.entry))
							const sideOf = (Number(request.scene.items.find((i) => i.id === it.id)?.x) || num(a.place?.x) || 0) < midX ? -1 : 1
							const keepOwn = !own || cost(own) === 0
							if (keepOwn) {
								if (own) decided.push({ id: it.id, a, it, how: "own", side: sideOf })
								continue
							}
							const ranked = tries.map((t, k) => ({ t, c: cost(t), k })).sort((p, q) => p.c - q.c || p.k - q.k)
							if (!ranked.length || !Number.isFinite(ranked[0].c) || ranked[0].t === own) {
								decided.push({ id: it.id, a, it, how: "own", side: sideOf })
								continue
							}
							ok = ranked[0].t
						}
						plan = withEntry(plan, it.id, ok.entry)
						if (ok.room) madeRoom.add(it.id)
						else leftAlone.push({ id: it.id, name })
						decided.push({ id: it.id, a, it, how: ok.own ? "own" : ok.room ? "room" : "back", side: (Number(request.scene.items.find((i) => i.id === it.id)?.x) || num(a.place?.x) || 0) < midX ? -1 : 1 })
					}
					// (the edit step's own make-room move of everything past the changed thing goes together, or not at all: c05, "slid the ledge and
					// cup 89 cm right" kept the ledge's move and put the cup back, so the golf ball flew 90 cm past it, an artificial break)
					// (each one's move as the edit step's own version places it: a set_place "right of the dominoes" moves the ledge as much as a dx)
					const xOf = (sc, id) => Number(sc.items.find((i) => i.id === id)?.x) || 0
					const dxOf = (d) => xOf(ref.scene, d.id) - xOf(request.scene, d.id)
					for (const d of decided.filter((x) => x.how === "back")) {
						const dx = dxOf(d)
						if (Math.abs(dx) < 0.01 || !decided.some((o) => o.how === "own" && o.side === d.side && Math.sign(dxOf(o)) === Math.sign(dx) && Math.abs(dxOf(o) - dx) < Math.max(0.03, 0.1 * Math.abs(dx)))) continue
						if (JSON.stringify(d.a.place ?? null) === JSON.stringify(d.it.place ?? null)) continue
						const entry = { ...clone(d.a), place: clone(d.it.place) }
						if (newTrouble(withEntry(plan, d.id, entry)) > 0) continue
						plan = withEntry(plan, d.id, entry)
						madeRoom.add(d.id)
						const k = leftAlone.findIndex((x) => x.id === d.id)
						if (k >= 0) leftAlone.splice(k, 1)
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
					if (!it || !a || JSON.stringify(a.place ?? null) === JSON.stringify(it.place ?? null)) continue
					// (only where it stands: a turn the edit gave it stays)
					const spot = (pl) => {
						const o = isObj(pl) ? clone(pl) : {}
						delete o.angle_deg
						return JSON.stringify(o)
					}
					if (spot(a.place) === spot(it.place)) continue
					const alt = clone(plan)
					// (a thing the words only swap, moved along the table too ("swap the cup for a basket" that also slid it 12 cm right, said with no
					// reason: V8837 k3): put back where it stood along the table, its new seat kept, when that runs into nothing; else that move made room)
					if (a.type !== it.type) {
						const x = alt.items.find((y) => isObj(y) && y.id === id)
						if (!isObj(a.place) || !isObj(x?.place) || a.place.on !== x.place.on || num(a.place.x) === null || num(x.place.x) === null || Math.abs(num(a.place.x) - num(x.place.x)) < 0.005) continue
						x.place = { ...x.place, x: a.place.x }
						for (const k of ["left_of", "right_of", "dx"]) delete x.place[k]
					} else for (const rid of [id, ...(R.get(id) ?? [])]) {
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
						const r0 = solveV(plan)
						const r1 = solveV(alt)
						const ta = trouble(r0)
						// (and never when the move made some room, even not all of it: a trampoline moved 4.5 cm left, still in the basket by less, was put
						// back into it (V8843 c09 r3); what is left is cleared further its own way, shiftAside)
						// (how far along the table it is into what it starts inside: the overlaps' own depth is no measure of that)
						const deep = (r) => {
							try {
								const ins = inspect(r.scene)
								const me = ins.box(id)
								return ins.overlaps.filter((o) => (o.a === id || o.b === id) && ![o.a, o.b].some((q) => r.scene.items.find((i) => i.id === q)?.type === "table")).reduce((t, o) => {
									const ob = ins.box(o.a === id ? o.b : o.a)
									return t + (me && ob ? Math.max(0, Math.min(me.x1, ob.x1) - Math.max(me.x0, ob.x0)) : o.depth ?? 0)
								}, 0)
							} catch {
								return 0
							}
						}
						ok = [...trouble(r1)].every((k) => ta.has(k)) && deep(r1) <= deep(r0) + 1e-4
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
			return { plan, leftAlone, madeRoom, seated }
		}
		// ---- the n7 edit turns (ai/DESIGN.md §14.2 (4), (6); ./edit-turns.js, ./aim.js): every version is placed exactly (adjustEdit), solved and
		// run once. A change that makes things start inside each other gets ONE more edit call told so (kept only when it has fewer); a "make it
		// work" (kind fix, or a request that states the outcome) first aims the goal's container at where the thing now comes down (never one the
		// person just changed), else ≤ 2 more edit calls told how the run went; the fix search (3c) finishes what still fails. A plain change is
		// never made to work: the run says what it does and the panel offers a checked fix.
		const baseWarnings = mode === "edit" ? layoutWarnings(request.scene) : []
		const overlapsOf = (scene) => newOverlaps(baseWarnings, layoutWarnings(scene))
		const beforeRun = request.sim?.doc && request.sim?.track?.frames?.length ? { scene: request.scene, sim: request.sim } : null
		/** What fails in a run: the goals, and the rows that all fell before (the fix search's targets, as the card shows them). */
		const failingIn = (v, sim = v.sim) => {
			const t = fixTargets({ goals: G(v), scene: v.scene, before: beforeRun, sim: v.sim })
			return judgeTargets(t, sim)
				.map((r, i) => ({ label: r.label, ok: r.ok, detail: r.detail ?? null, goal: t[i].goal, implicit: !!t[i].implicit }))
				.filter((r) => r.ok === false)
		}
		const bad = (A) => A.failing.length + A.overlaps.length
		// (a request that is nothing but "make it work": one that also asks for a change of its own ("move the box to x 1.9 so it still lands in
		// it") is that exact change, made to work by the checked fix search, which keeps what was asked; the container alone or the model's
		// further rounds are never its answer)
		// (the app's own "make it work" (request.rework: the background rework, and the "Ask the AI to rework it" button) is one, whatever words
		// it carries: D1, 16 Oct: "Change whatever else is needed" in the button's words turned the aim and the rounds off)
		const pureFix = request.rework === true || (!EXPLICIT_RE.test(text) && !PLACE_RE.test(text) && !OWN_CHANGE_RE.test(text))
		/**
		 * A "make it work" never undoes what the person chose: no kind swapped back, nothing their last turn removed put back, and what earlier
		 * turns set (request.keep) as it was. -> null, or what the answer would undo, in words ("putting the seesaw back").
		 */
		const undoesChoice = (A) => {
			const at = new Map(A.v.scene.items.map((i) => [i.id, i]))
			for (const a of request.scene.items) {
				const b = at.get(a.id)
				if (b && b.type !== a.type) return `turning ${theName(a)} into ${aKind(b.type)}`
			}
			// (what the person's change took away, by its kind, never comes back in a rework: "replace the dominoes with soda cans" is never
			// answered with dominoes)
			for (const b of A.v.scene.items) if (!request.scene.items.some((i) => i.id === b.id) && (request.removedTypes ?? []).includes(b.type)) return `putting ${aKind(b.type)} back`
			// (what the last turn took away, back again: "remove the seesaw" then "make it work again")
			const lastTurn = lastUserTurn(request.history)
			if (/\b(remove|delete|take (away|out|off)|get rid of)\b/i.test(lastTurn))
				for (const b of A.v.scene.items) {
					if (request.scene.items.some((i) => i.id === b.id) || b.type === "table" || isSafetyWall(b)) continue
					const words = [String(b.name ?? "").split(/\s+/).at(-1), String(typeName(b.type) ?? b.type).split(/\s+/).at(-1), String(b.id ?? "")].filter((w) => w && w.length >= 3)
					if (words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(lastTurn))) return `putting ${theName(b)} back`
				}
			for (const k of Array.isArray(request.keep) ? request.keep : []) {
				if (!Array.isArray(k)) continue
				const a = request.scene.items.find((i) => i.id === k[0])
				const b = at.get(k[0])
				if (!a) continue
				if (!b) return `removing ${theName(a)}`
				const keys = k[1] === "all" ? ["place", ...Object.keys({ ...(a.props ?? {}), ...(b.props ?? {}) })] : Array.isArray(k[1]) ? k[1] : []
				for (const key of keys) {
					if (/^place/.test(key)) {
						const ax = /^place-(y|angle)$/.test(key) ? null : Math.abs((Number(a.x) || 0) - (Number(b.x) || 0))
						const ay = /^place-(x|angle)$/.test(key) ? null : Math.abs((Number(a.y) || 0) - (Number(b.y) || 0))
						// (a thing that sits in or on another that moved, by the same amount, is still where it was put: the duck in the box)
						if (((ax ?? 0) > 0.001 || (ay ?? 0) > 0.001) && ridesAlong(a, b, at)) continue
						if ((ax ?? 0) > 0.001 || (ay ?? 0) > 0.001) return `moving ${theName(a)}`
					} else if (JSON.stringify(a.props?.[key] ?? null) !== JSON.stringify(b.props?.[key] ?? null)) return `changing ${theName(a)} back`
				}
			}
			return null
		}
		/** Did a (as it was) move with what it rests on in b's scene (at: id -> item), by the same amount? */
		function ridesAlong(a, b, at) {
			let RM = null
			try {
				RM = riderMap(request.scene)
			} catch {
				return false
			}
			for (const [sid, riders] of RM) {
				if (!riders.includes(a.id)) continue
				const s0 = request.scene.items.find((i) => i.id === sid)
				const s1 = at.get(sid)
				if (s0 && s1 && Math.abs((Number(s1.x) || 0) - (Number(s0.x) || 0) - ((Number(b.x) || 0) - (Number(a.x) || 0))) < 0.002 && Math.abs((Number(s1.y) || 0) - (Number(s0.y) || 0) - ((Number(b.y) || 0) - (Number(a.y) || 0))) < 0.002) return true
			}
			return false
		}
		const keepsChoices = (A) => !undoesChoice(A)
		/** An edit answer placed exactly and run: {out, plan, planChanges, skipped, leftAlone, madeRoom, v, overlaps, failing}, or null (no
		 *  patches, or a new scene in all but name). */
		const placeAnswer = async (out, label, preview = false, pp = patchPlan(out)) => {
			if (!pp || replacesScene(pp.plan)) return null
			const ad = adjustEdit(pp.plan, Array.isArray(out) ? out : out?.patches)
			const v = await attempt(ad.plan, label, preview)
			return { out: isObj(out) ? out : { patches: out }, ...pp, ...ad, v, overlaps: overlapsOf(v.scene), failing: failingIn(v) }
		}
		/** Another edit call with feedback (the scene, plan, history and pictures exactly as the first): its answer, or null when it failed. */
		const askAgain = async (feedback, detail, label, { ms = null } = {}) => {
			// (a background rework keeps its reasons in front of each round)
			if (typeof request.feedback === "string" && request.feedback.trim()) feedback = `${request.feedback.slice(0, 4500)}\n\n${feedback}`.slice(0, 8000)
			if (!spendCall()) return null
			// (a call held to `ms`: past it, it is stopped and the answer before it kept)
			const sub = ms ? new AbortController() : null
			const onAbort = () => sub?.abort()
			if (sub) signal.addEventListener("abort", onAbort, { once: true })
			const timer = sub ? setTimeout(() => sub.abort(), ms) : null
			try {
				return await timed("edit", detail, () => (sub ? call("edit", { ...editPayload, feedback }, sub.signal, report, onEvent) : callStep("edit", { ...editPayload, feedback })), label)
			} catch (e) {
				if (signal.aborted) throw e
				if (e?.name === "AbortError" && !sub?.signal.aborted) throw e
				say("info", "edit_again_failed", sub?.signal.aborted ? `${label} took too long: kept the first answer` : `${label} couldn't run (${whyFailed(e)}): kept the first answer`)
				return null
			} finally {
				clearTimeout(timer)
				if (sub) signal.removeEventListener("abort", onAbort)
			}
		}
		/** A thing the edit left as it was that the change now starts inside, moved along the table as a whole, the least that clears it (never
		 *  re-spaced or reshaped): the version, or null (V8837 plainmove: "move the box 30 cm left" had the repair turn re-space the dominoes,
		 *  which broke the chain, in a second 16 s call). */
		const shiftAside = async (A) => {
			let pairs
			let ins
			try {
				const had = new Set(inspect(request.scene).overlaps.flatMap((o) => [`${o.a}|${o.b}`, `${o.b}|${o.a}`]))
				ins = inspect(A.v.scene)
				pairs = ins.overlaps.filter((o) => o.depth > 0.002 && !had.has(`${o.a}|${o.b}`))
			} catch {
				return null
			}
			const same = (id) => {
				const x = A.plan.items.find((y) => isObj(y) && y.id === id)
				return !!x && was.has(id) && JSON.stringify(x) === JSON.stringify(was.get(id))
			}
			// (a thing this edit added, set down on the table where it starts inside another, is the AI's own placing unless the words give a number:
			// it moves aside the least that clears it (V8841 k2: a rubber duck "next to the mug" inside the bigger coffee mug, whose repair call was
			// stopped at REPAIR_MS))
			const placedFree = (id) => !was.has(id) && !EXPLICIT_RE.test(text)
			for (const o of pairs) {
				let [X, Y] = same(o.a) && !same(o.b) ? [o.b, o.a] : same(o.b) && !same(o.a) ? [o.a, o.b] : [null, null]
				// (only for a thing the change moved along the table into it: a swap or a resize that keeps its seat is the repair turn's, as before)
				const xi = X ? A.plan.items.find((i) => isObj(i) && i.id === X) : null
				if (!Y || !was.has(X) || !(Math.abs((num(xi?.place?.x) ?? 0) - (num(was.get(X)?.place?.x) ?? 0)) > 0.005)) [X, Y] = placedFree(o.a) && !placedFree(o.b) ? [o.b, o.a] : placedFree(o.b) && !placedFree(o.a) ? [o.a, o.b] : [null, null]
				if (!Y) continue
				let y = A.plan.items.find((i) => isObj(i) && i.id === Y)
				// (placed by its neighbour, "right of the mug": from where it stands now)
				if (isObj(y?.place) && num(y.place.x) === null && !was.has(Y)) {
					const at = num(A.v.scene.items.find((i) => i.id === Y)?.x)
					if (at !== null) {
						y = { ...clone(y), place: { ...clone(y.place), x: at } }
						for (const k of ["left_of", "right_of"]) delete y.place[k]
					}
				}
				// (only a thing standing on the table on its own: never what rests on the changed thing (it is re-seated), nor a goal's own thing)
				const goalIds = new Set((G(A.v) ?? []).filter(isObj).flatMap((g) => goalItems(g)))
				const bx = ins.box(X)
				const by = ins.box(Y)
				if (!bx || !by) continue
				if (!isObj(y?.place) || y.place.on !== "table" || num(y.place.x) === null || ["table", "wall"].includes(y.type) || isSafetyWall(y) || goalIds.has(Y) || (R.get(X) ?? []).includes(Y)) {
					// (the other one can't move (a goal's container, a fixed thing): the thing the change moved goes on further its own way, the least
					// that clears it, with no call (V8843 c09 r3: a trampoline moved 4.5 cm left still started inside the basket, and the repair call was
					// stopped at REPAIR_MS))
					const x0 = num(was.get(X)?.place?.x)
					const x1 = num(xi?.place?.x)
					if (!xi || !isObj(xi.place) || xi.place.lean || x0 === null || x1 === null || Math.abs(x1 - x0) <= 0.005 || EXPLICIT_RE.test(text) || (R.get(Y) ?? []).includes(X)) continue
					let t1
					try {
						t1 = trouble(solveV(A.plan))
					} catch {
						continue
					}
					// (it alone, then, when that runs into its other neighbour first, it and the other one (a thing the words don't name, set at the
					// least that clears it) each the other way, the smallest pair first: the trampoline 4 cm further left and the basket 6 cm right)
					const yMay = isObj(y?.place) && num(y.place.x) !== null && !y.place.lean && !isSafetyWall(y) && !["table", "wall"].includes(y.type) && !scope?.named?.has(Y) && !frozen.has(Y) && !(R.get(X) ?? []).includes(Y)
					const steps = [...ROOM.map((d) => [d, 0]), ...(yMay ? ROOM.slice(0, 9).flatMap((d1) => ROOM.slice(0, 11).map((d2) => [d1, d2])).sort((p, q) => p[0] + p[1] - (q[0] + q[1])) : [])]
					let solves = 0
					for (const [d1, d2] of steps) {
						if (solves++ > 150) break
						let p2 = withEntry(A.plan, X, shiftX(xi, Math.sign(x1 - x0) * d1))
						if (d2) p2 = withEntry(p2, Y, shiftX(y, -Math.sign(x1 - x0) * d2))
						let r
						try {
							r = solveV(p2)
						} catch {
							continue
						}
						if (![...trouble(r)].every((k) => t1.has(k)) || overlapsOf(r.scene).length >= A.overlaps.length) continue
						const v2 = await attempt(p2, "made room")
						const B = { ...A, plan: p2, v: v2, overlaps: overlapsOf(v2.scene), failing: failingIn(v2), ...(d2 ? { madeRoom: new Set([...(A.madeRoom ?? []), Y]) } : {}) }
						if (B.overlaps.length < A.overlaps.length && !(fixKind && B.failing.length > A.failing.length)) return B
						break
					}
					continue
				}
				const dir = (by.x0 + by.x1) / 2 < (bx.x0 + bx.x1) / 2 ? -1 : 1
				let t0
				try {
					t0 = trouble(solveV(A.plan))
				} catch {
					continue
				}
				for (const d of [...ROOM, 0.2, 0.25, 0.3]) {
					const p2 = withEntry(A.plan, Y, shiftX(y, dir * d))
					let r
					try {
						r = solveV(p2)
					} catch {
						continue
					}
					if (![...trouble(r)].every((k) => t0.has(k)) || overlapsOf(r.scene).length >= A.overlaps.length) continue
					const v2 = await attempt(p2, "made room")
					const B = { ...A, plan: p2, v: v2, overlaps: overlapsOf(v2.scene), failing: failingIn(v2), madeRoom: new Set([...(A.madeRoom ?? []), Y]) }
					if (B.overlaps.length < A.overlaps.length && !(fixKind && B.failing.length > A.failing.length)) return B
					break
				}
			}
			return null
		}
		const placeOrNull = async (out, label) => {
			try {
				return await placeAnswer(out, label)
			} catch (e) {
				if (e?.name === "AbortError" || signal.aborted) throw e
				return null
			}
		}
		/** (6a) "make it work": the goal's container alone, aimed at where the thing now comes down in the scene on screen (./aim.js). */
		const aimFirstTry = async (A) => {
			const ids = new Set(request.scene.items.map((i) => i.id))
			const ins = []
			for (const g of [...(request.scene.goals ?? []), ...(basePlan?.goals ?? [])])
				if (isObj(g) && goalKindOf(g) === "in" && ids.has(g.item) && ids.has(g.container) && !ins.some((x) => x.item === g.item && x.container === g.container)) ins.push({ kind: "in", item: g.item, container: g.container, label: String(g.label ?? `${g.item} lands in ${g.container}`) })
			if (!ins.length) return null
			// (the answer's own change of a thing the request names is the person's: never dropped for an aimed container)
			const named = namedIn(text, request.scene)
			const idsOf = (p) => (Array.isArray(p?.ids) ? p.ids : [p?.id ?? p?.item?.id]).filter(Boolean)
			if ((A.out.patches ?? []).some((p) => idsOf(p).some((id) => named.has(id) && !ins.some((g) => g.container === id)))) return null
			const sim0 = await simulate({ ...clone(request.scene), goals: ins }, signal)
			check()
			const failing0 = ins.filter((g) => (sim0.summary?.goals ?? []).some((x) => x.item === g.item && x.container === g.container && !x.ok))
			if (!failing0.length) return null
			// (never a container the person's last turn changed, or one an earlier turn's change keeps in place: that would undo what they asked for)
			const lastTurn = lastUserTurn(request.history)
			const kept = new Set((Array.isArray(request.keep) ? request.keep : []).filter((k) => Array.isArray(k) && (k[1] === "all" || (Array.isArray(k[1]) && k[1].some((x) => /^place/.test(x))))).map((k) => k[0]))
			const aimApply = (patches) => {
				const pp = patchPlan({ patches })
				if (!pp) return { error: "nothing to place" }
				try {
					const r = solveV(adjustEdit(pp.plan, patches).plan)
					return { scene: r.scene, overlaps: overlapsOf(r.scene) }
				} catch (e) {
					return { error: e?.message ?? String(e) }
				}
			}
			for (const g of failing0) {
				const box = request.scene.items.find((i) => i.id === g.container)
				if (!box || namedInTurn(box, lastTurn) || kept.has(box.id)) continue
				const r = await timed("fix", `aiming ${theName(box)}`, () => aimContainer({ scene: request.scene }, g, { simulate, apply: aimApply, isStaticItem, digestScene, signal }), `Aiming ${theName(box)}`)
				if (!r?.patches) continue
				const B = await placeOrNull({ kind: "fix", targets: A.out.targets, why: "aimed at where the thing now comes down", patches: r.patches, reply: aimReply(box.name ?? theName(box), r.patches[0], g.label), suggestions: A.out.suggestions }, "aimed")
				// (kept when the scene then fails less than it does now: what the run judges, not the aim's own run; and when it goes through the
				// machine, against the scene where the goals last worked when the panel sent it: never a container behind its launcher)
				if (B && !B.overlaps.length && B.failing.length < failingIn(B.v, sim0).length) {
					let ref = beforeRun
					if (isObj(request.reference) && Array.isArray(request.reference.items))
						try {
							ref = { scene: request.reference, sim: await simulate(request.reference, signal) }
						} catch (e) {
							if (e?.name === "AbortError" || signal.aborted) throw e
						}
					if (ref && chainBreak({ scene: request.scene, sim: sim0, before: ref }, B.v.scene, B.v.sim)) continue
					return { ...B, aim: { id: box.id, name: theName(box), dx_m: r.patches[0].dx ?? 0, dy_m: r.patches[0].dy ?? 0, runs: r.runs } }
				}
			}
			return null
		}
		/**
		 * The scene's goals about a thing the change took away and put others in its place follow those others, never dropped (V8817 c12: "The
		 * pendulum starts the run" and "All 24 dominoes of the run fall" were "No longer checked" when the run became paperback books): a "falls"
		 * goal is about all of them, a "hits" goal hits the nearest; the label says them. The version is placed and run again with them.
		 */
		const followed = new Map() // (the labels of goals that now follow what replaced their things -> their new labels: never "No longer checked")
		const followGoals = async (A) => {
			try {
				const was = (Array.isArray(basePlan?.goals) ? basePlan.goals : []).filter(isObj)
				const have = new Set(A.v.scene.items.map((i) => i.id))
				const lost = was.filter((g) => goalRefs(g).some((id) => !have.has(id)))
				if (!lost.length) {
					// (a row swapped into one thing of a kind, with more of that kind added beside it: its "falls" goal is about all of them (V8843 n5t:
					// "The cereal box fall, up to the giant · 0 of 1 fell" for a row of 5))
					const goals = clone(Array.isArray(A.plan.goals) ? A.plan.goals : [])
					if (!tidyGoneLabels(goals, request.scene, A.v.scene, followed)) return A
					const plan2 = { ...A.plan, goals }
					const v = await attempt(plan2, "goals followed", true)
					return { ...A, plan: plan2, v, overlaps: overlapsOf(v.scene), failing: failingIn(v) }
				}
				const real = (i) => i.type !== "table" && !isSafetyWall(i)
				const removed = request.scene.items.filter((i) => real(i) && !have.has(i.id))
				const added = A.v.scene.items.filter((i) => real(i) && !request.scene.items.some((x) => x.id === i.id))
				if (!removed.length || !added.length) return A
				const insA = inspect(request.scene)
				const insB = inspect(A.v.scene)
				const span = (ins, list) => {
					const bs = list.map((i) => ins.box(i.id)).filter(Boolean)
					return bs.length ? { x0: Math.min(...bs.map((q) => q.x0)), x1: Math.max(...bs.map((q) => q.x1)) } : null
				}
				const kinds = new Map()
				for (const it of added) kinds.set(it.type, [...(kinds.get(it.type) ?? []), it])
				const by = new Map()
				for (const r of removed) {
					const sa = span(insA, [r])
					let best = null
					for (const list of kinds.values()) {
						const sb = span(insB, list)
						const ov = sa && sb ? Math.min(sa.x1, sb.x1) - Math.max(sa.x0, sb.x0) : 0
						if (ov > 0.4 * Math.min(sa.x1 - sa.x0, sb.x1 - sb.x0) && (!best || ov > best.ov)) best = { ov, list }
					}
					if (best) by.set(r.id, best.list)
				}
				const goals = clone(Array.isArray(A.plan.goals) ? A.plan.goals : [])
				let changed = false
				for (const g of lost) {
					const gone = goalRefs(g).filter((id) => !have.has(id))
					// (one the AI already carried over to the new things in its own words is kept as it said it, never followed a second time)
					if (carriedGoals.has(g.label) && goals.some((x) => isObj(x) && x.label === carriedGoals.get(g.label))) {
						followed.set(g.label, carriedGoals.get(g.label))
						continue
					}
					if (!gone.length || gone.some((id) => !by.has(id)) || gone.includes(g.container)) continue
					const ng = clone(g)
					const R0 = request.scene.items.find((i) => i.id === gone[0])
					const G = by.get(gone[0])
					const k = goalKindOf(g)
					if (k === "falls") {
						ng.items = [...new Set(goalItems(g).flatMap((id) => (by.has(id) ? by.get(id).map((i) => i.id) : [id])))]
						delete ng.item
					} else if (k === "hits" && gone.length === 1 && g.target === gone[0]) {
						const hx = Number(A.v.scene.items.find((i) => i.id === g.item)?.x) || 0
						ng.target = [...G].sort((p, q) => Math.abs((Number(p.x) || 0) - hx) - Math.abs((Number(q.x) || 0) - hx))[0].id
					} else continue
					// (the label says what is there now: "All 24 dominoes of the run fall" -> "All 9 paperback books of the run fall")
					const n = G.length
					const many = kindNoun(G[0].type, n, { short: true })
					const one = kindNoun(G[0].type, 1, { short: true })
					const oldMany = R0.type === "domino-row" ? "dominoes" : kindNoun(R0.type, 2, { short: true })
					const oldOne = R0.type === "domino-row" ? "domino" : kindNoun(R0.type, 1, { short: true })
					let label = String(g.label ?? goalLabel(g))
					if (k === "falls") label = label.replace(new RegExp(`\\b(\\d+|all|the)\\s+${oldMany}\\b`, "i"), (m, q) => (/^\d+$/.test(q) ? `${n} ${many}` : `${q} ${many}`)).replace(new RegExp(`\\b${oldMany}\\b`, "i"), many)
					else label = label.replace(new RegExp(`\\bthe (first |last )?(${oldOne}|${oldMany})\\b`, "i"), `the ${n > 1 ? "first " : ""}${one}`)
					ng.label = label
					const at = goals.findIndex((x) => isObj(x) && x.label === g.label)
					if (at >= 0) goals[at] = ng
					else goals.push(ng)
					followed.set(g.label, ng.label)
					changed = true
				}
				// (and the labels that still name what is gone: "up to the giant", "The giant knocks the tennis ball into the bucket", once the growing
				// row and its giant were replaced (V8842 n5))
				if (tidyGoneLabels(goals, request.scene, A.v.scene, followed)) changed = true
				if (!changed) return A
				const plan2 = { ...A.plan, goals }
				const v = await attempt(plan2, "goals followed", true)
				return { ...A, plan: plan2, v, overlaps: overlapsOf(v.scene), failing: failingIn(v) }
			} catch (e) {
				if (e?.name === "AbortError" || signal.aborted) throw e
				return A
			}
		}
		/** The first answer placed and run, then (§14.2 (6)) a "make it work" made to work and (§14.2 (4)) ONE overlap repair. */
		const editTurns = async () => {
			let A = await placeAnswer(editOut, undefined, true, firstPatch)
			if (!A) throw new AiError("invalid", "The AI's answer to that edit couldn't be used", { step: "edit", retryable: true })
			A = await followGoals(A)
			draft(A.v, "first version")
			// (an older whole-plan answer gets the critic's rounds instead: these turns are for patch answers)
			const patchAnswer = Array.isArray(editOut.patches) && !isObj(editOut.plan) && !Array.isArray(editOut.items)
			if (!patchAnswer) return A
			if (fixKind) {
				const fx = (report.edit.fixFlow = { aimed: null, rounds: 0, fixer: false })
				// (a "make it work" answer that swaps a kind back or undoes what an earlier turn set is not taken: the scene as it is goes on to the
				// aim, the rounds and the fix search instead)
				const undid = pureFix ? undoesChoice(A) : null
				if (undid) {
					const B0 = await placeOrNull({ kind: "fix", targets: editOut.targets, patches: [], reply: null, suggestions: editOut.suggestions }, "as it was")
					if (B0) {
						A = B0
						fx.dropped = `the answer undid what you chose (${undid})`
						fx.undid = undid
					}
				}
				const aimed = aimFirst && pureFix ? await aimFirstTry(A) : null
				// (the physics' own search on the scene as it is, started beside the first answer: when that answer doesn't work and it found a checked
				// change, that change is used and no more AI rounds are asked)
				// (waited for up to PHYS_FIRST_MS from its start; on a busy machine it goes on beside the AI's rounds (it runs at least PHYS_FIRST_RUNS,
				// up to the request's own deadline) and is used whenever it is found: V8842 x42a–d, 8 of 12 under load, the search a few runs short)
				const pf = !aimed && physFirst && bad(A) > 0 ? await physWait(Math.max(0, physT0 + physFirstMs - Date.now())) : null
				if (aimed) {
					A = aimed
					fx.aimed = aimed.aim
					draft(A.v, "aimed")
				} else if (pf?.status === "found" && pf.fix?.sim) {
					physFix = pf
					fx.physics = true
				} else if (pureFix && !fx.dropped) {
					// (6b) ≤ 2 more edit calls, told how the last answer ran; the version with the fewest failing goals and overlaps is kept. A round
					// that got no closer ends them (the fix search starts at once: round 3's acceptance measured make-it-work p90 98.5 s against E0's
					// 33.7 s, mostly a second round that changed nothing); an answer that undid the person's choice skips them (asked again, it did so
					// again: 2 of 2)
					const howFar = (B) => {
						try {
							return goalDistance(B.v.scene, B.v.sim, G(B.v))
						} catch {
							return Infinity
						}
					}
					let last = A
					// (a background rework has a deadline: no round starts that the fix search after it would not have time for)
					for (let round = 1; round <= (num(request.maxRounds) ?? 2) && bad(A) > 0 && !(num(request.deadline) !== null && Date.now() > request.deadline - 22000); round++) {
						// (a typed "make it work" stops at its budget, as the background does, and says so)
						if (!roundFits()) {
							fx.capped = true
							break
						}
						// (the physics found its checked change meanwhile: that is used, no more rounds)
						if (physFound()) break
						const fb = fixFeedback({ patches: last.out.patches ?? [], diff: describeDiff(request.scene, last.v.scene), failing: last.failing, overlaps: last.overlaps, sim: last.v.sim })
						// (a typed "make it work" is held to its minute: a round's call that would run past it is stopped, the answer before it kept)
						const a2 = await askAgain(fb, `round ${round} of 2`, "Making it work", typedMake ? { ms: Math.max(6000, madeDeadline - Date.now() - 12000) } : {})
						if (!a2) break
						fx.rounds = round
						if (!Array.isArray(a2.patches) || !a2.patches.length) break
						let B = await placeOrNull(a2, `making it work ${round}`)
						if (B) B = await followGoals(B)
						if (!B || !keepsChoices(B)) break
						const closer = bad(B) < bad(last) || (bad(B) === bad(last) && howFar(B) < howFar(last) - 0.01)
						last = B
						if (bad(B) < bad(A) || (bad(B) === bad(A) && describeDiff(request.scene, B.v.scene).length < describeDiff(request.scene, A.v.scene).length)) {
							A = B
							draft(A.v, "making it work")
						}
						if (!closer) break
					}
				}
				// (the AI's rounds didn't make it work: the physics' own search, still running on a busy machine, is waited for up to the request's
				// deadline and used when it finds its checked change)
				if (!aimed && !physFix && physFirst && bad(A) > 0) {
					const r = physFound() ? physDone : await physWait(Math.max(0, madeDeadline - 14000 - Date.now()))
					if (r?.status === "found" && r.fix?.sim) {
						physFix = r
						fx.physics = true
					}
				}
				// (still nothing that works: what the fix search looks at is the scene as it was, never the AI's failed version with the search's change
				// on top of it (V8843 v43f5 s-fix-user-swap: the AI's longer table and faster-growing dominoes kept, and a laptop and two moves added,
				// 5 things changed), unless that version is closer: fewer goals fail in it)
				// (the answer's goals and title stay: only what it changed of the things is dropped)
				const keepOps = (A.out.patches ?? []).filter((q) => isObj(q) && ["set_goals", "set_scene"].includes(String(q.op ?? "").toLowerCase()))
				if (typedMake && pureFix && !aimed && !physFix && bad(A) > 0 && !fx.dropped && (A.out.patches ?? []).length > keepOps.length) {
					const B0 = await placeOrNull({ kind: "fix", targets: editOut.targets, patches: keepOps, reply: null, suggestions: editOut.suggestions }, "as it was")
					if (B0 && bad(B0) <= bad(A)) {
						// (what it tried is still said: "I couldn't make it work (I tried: …)")
						Object.defineProperty(fx, "droppedScene", { value: A.v.scene, enumerable: false, configurable: true, writable: true })
						A = B0
						fx.dropped = "the AI’s answers didn’t work in the physics"
						fx.unworked = true
					}
				}
			}
			// (4) ONE repair turn when the change makes things start inside each other (about 3 % of edits); never for an answer the physics' own
			// checked change replaces (physFix)
			// (first, what it starts inside, moved along as a whole, the least that clears it: no call)
			if (A.overlaps.length && !physFix) {
				const B = await shiftAside(A)
				if (B) {
					const rep = (report.edit.repair = { before: A.overlaps.length, after: B.overlaps.length, kept: true, by: "room" })
					Object.defineProperty(rep, "fromScene", { value: A.v.scene, enumerable: false, configurable: true, writable: true })
					A = B
					draft(A.v, "made room")
				}
			}
			if (A.overlaps.length && !physFix) {
				const rep = (report.edit.repair = { before: A.overlaps.length, after: A.overlaps.length, kept: false })
				const fb = overlapFeedback({ patches: A.out.patches ?? [], diff: describeDiff(request.scene, A.v.scene), overlaps: A.overlaps, fix: fixKind })
				// (held to REPAIR_MS: past it, the change as answered stays, and the card says what starts inside what)
				const a2 = await askAgain(fb, "things would start inside each other", "Making the change fit", { ms: REPAIR_MS })
				const k2 = a2 ? routeKind(a2, text) : null
				if (k2 === "ask" || k2 === "answer") return { replyOnly: a2, kind: k2 }
				if (a2 && (k2 === "change" || k2 === "fix") && Array.isArray(a2.patches) && a2.patches.length) {
					let B = await placeOrNull(a2, "made to fit")
					// (its goals follow what replaced their things too, as the first answer's did)
					if (B) B = await followGoals(B)
					if (B && B.overlaps.length < A.overlaps.length && !(fixKind && B.failing.length > A.failing.length)) {
						// (the version before it: what the repair turn changed beyond it is what made room, said in the lead when a goal stops)
						Object.defineProperty(rep, "fromScene", { value: A.v.scene, enumerable: false, configurable: true, writable: true })
						A = B
						Object.assign(rep, { after: B.overlaps.length, kept: true })
						draft(A.v, "made to fit")
					}
				}
			}
			return A
		}
		let cur
		let firstV = null // (an edit: the version that is exactly what was asked)
		let anchorsNow = new Map() // (an edit: the things the person put by another, "next to the box": id -> {anchor, words})
		/** Of `ids`, the things the chain strikes in a run (a firm hit after the release by anything but another of them or what rests on them). */
		const struckIn = (v, ids) => {
			const of = new Map((v.sim?.doc?.solids ?? []).map((x) => [x.id, x.item]))
			const typeOf = new Map(v.scene.items.map((i) => [i.id, i.type]))
			let R = new Map()
			try {
				R = riderMap(v.scene)
			} catch {}
			const out = new Set()
			for (const h of v.sim?.track?.impacts ?? []) {
				if ((h.speed ?? 0) < 0.1 || h.t <= (Number(v.scene.release) || 0) + 0.3) continue
				const p = of.get(h.a)
				const q = of.get(h.b)
				for (const [x, y] of [[p, q], [q, p]]) if (ids.has(x) && y && y !== x && !ids.has(y) && !["table", "wall"].includes(typeOf.get(y)) && !(R.get(x) ?? []).includes(y)) out.add(x)
			}
			return out
		}
		/** A thing as the card calls it now: a swapped one by its new kind ("the cup"), else its name. */
		const callNow = (it, scene) => {
			const was = request.scene.items.find((i) => i.id === it.id)
			return was && was.type !== it.type && scene.items.filter((i) => i.type === it.type).length === 1 ? `the ${kindNoun(it.type, 1, { short: true })}` : placeName(it, scene)
		}
		/** Things the chain strikes in a run that the person only put by another (anchorsNow): ids. */
		const inTheWay = (v) => {
			const of = new Map((v.sim?.doc?.solids ?? []).map((x) => [x.id, x.item]))
			const typeOf = new Map(v.scene.items.map((i) => [i.id, i.type]))
			const out = new Set()
			for (const h of v.sim?.track?.impacts ?? []) {
				if ((h.speed ?? 0) < 0.1 || h.t <= (Number(v.scene.release) || 0) + 0.3) continue
				const p = of.get(h.a)
				const q = of.get(h.b)
				for (const [x, y] of [[p, q], [q, p]]) if (anchorsNow.has(x) && y && y !== x && !["table", "wall"].includes(typeOf.get(y)) && !anchorsNow.has(y)) out.add(x)
			}
			return out
		}
		/** A version with a thing put by another moved along it, out of the chain's way, when that brings back what it broke; else null. */
		const outOfTheWay = async (v) => {
			const before = { scene: request.scene, sim: request.sim }
			const tg = fixTargets({ goals: G(v), scene: v.scene, before, sim: v.sim })
			const r0 = judgeTargets(tg, v.sim)
			if (!r0.some((r) => r.ok === false)) return null
			const okN = (rs) => rs.filter((r) => r.ok === true).length
			const ov0 = overlapsOf(v.scene).length
			let tries = 0
			for (const id of inTheWay(v)) {
				const an = anchorsNow.get(id)
				const ins = inspect(v.scene)
				const A = ins.box(an.anchor)
				const me = ins.box(id)
				const it = v.scene.items.find((i) => i.id === id)
				if (!A || !me || !it) continue
				const half = (me.x1 - me.x0) / 2
				const off = (Number(it.x) || 0) - (me.x0 + me.x1) / 2
				const cx = (A.x0 + A.x1) / 2
				const aw = (A.x1 - A.x0) / 2
				const xs = [0.02, 0.06, 0.12, 0.2].flatMap((g) => [cx + aw + half + g, cx - aw - half - g]).sort((p, q) => Math.abs(p - (Number(it.x) || 0)) - Math.abs(q - (Number(it.x) || 0)))
				for (const x of xs) {
					if (tries++ >= 6) return null
					const p2 = clone(v.plan)
					const pi = p2.items.find((i) => isObj(i) && i.id === id)
					if (!pi) break
					pi.place = { ...(isObj(pi.place) ? pi.place : { on: "table" }), x: Math.round((x + off) * 1e4) / 1e4 }
					delete pi.place.left_of
					delete pi.place.right_of
					let v2
					try {
						v2 = await attempt(p2, "out of the way")
					} catch (e) {
						if (e?.name === "AbortError" || signal.aborted) throw e
						continue
					}
					if (overlapsOf(v2.scene).length > ov0 || inTheWay(v2).has(id)) continue
					const r2 = judgeTargets(fixTargets({ goals: G(v2), scene: v2.scene, before, sim: v2.sim }), v2.sim)
					if (r2.length === r0.length && okN(r2) > okN(r0) && r0.every((r, i) => r.ok !== true || r2[i].ok === true)) return v2
				}
			}
			return null
		}
		if (mode === "edit") {
			let A
			try {
				A = await editTurns()
			} finally {
				// (the physics' own search of a typed "make it work" is used inside the turns, or not at all)
				if (physFix === null) physCtl.abort()
			}
			if (A.replyOnly) {
				// (the repair turn found the request a question after all: shown as such, nothing changed)
				report.edit.kind = A.kind
				return replyOnlyReport(A.replyOnly, A.kind)
			}
			;({ plan, leftAlone, madeRoom } = A)
			seatedIds = A.seated ?? new Set()
			editOut = A.out
			cur = A.v
			physCtl.abort()
			// (the physics found a checked change on the scene as it is: that goes on the table, the AI's own answer (which didn't work) does not)
			if (physFix) {
				cur = { id: nextId++, plan: planAfterFix(basePlan, physFix.fix.scene), solved: cur.solved, scene: physFix.fix.scene, sim: physFix.fix.sim, score: null, judged: false, fromRound: 0, parent: cur, fixed: true }
				plan = cur.plan
				leftAlone = []
				madeRoom = new Set()
				report.fixApplied = { say: physFix.fix.words.say, did: physFix.fix.words.did, label: physFix.fix.words.label, changes: physFix.fix.changes, runs: physFix.runs, ms: physFix.ms }
				report.quickNote = `${physFix.runs} runs in the physics engine found the smallest change that makes it work (${physFix.fix.words.did}); the AI didn’t look at pictures of it`
				if (report.edit) report.edit.fixFlow = { ...(report.edit.fixFlow ?? {}), fixer: true, physics: true }
				draft(cur, "fixed")
			}
			// (a goal that names what isn't in the library by what stands in for it: "All ten rolls fall" for ten cardboard boxes: V8817 m3)
			subLabels(cur, plan)
			// (a thing the person only put by another, "a sneaker next to the box", that the AI set down in the chain's way: moved along its anchor,
			// out of the way, when that gives back a goal it broke: where it stands was the AI's choice, "next to the box" theirs (V8832 m1))
			anchorsNow = anchorsOf(text, request.scene, cur.scene)
			if (request.rework !== true && anchorsNow.size && request.sim?.doc && request.sim?.track?.frames?.length)
				try {
					const v2 = await outOfTheWay(cur)
					if (v2) {
						cur = v2
						plan = v2.plan
						report.edit.outOfTheWay = true
					}
				} catch (e) {
					if (e?.name === "AbortError" || signal.aborted) throw e
				}
			// what the edit asked for and couldn't be done: the user is told
			for (const t of A.skipped) say("warn", "patch_skipped", `Not done: ${t}`)
			const reply = typeof editOut.reply === "string" ? editOut.reply : typeof editOut.summary === "string" ? editOut.summary : null
			Object.assign(report.edit, { changes: A.planChanges, planChanges: A.planChanges, reply, skipped: A.skipped.map(String), headsUp: [] })
			if (typeof editOut.why === "string" && editOut.why.trim()) report.edit.why = editOut.why.trim()
			if (leftAlone.length) report.edit.leftAlone = leftAlone.map((x) => x.name)
			if (madeRoom.size) report.edit.madeRoom = [...madeRoom]
			if (cur.solved?.slid?.length) report.edit.slid = [...cur.solved.slid]
		} else {
			cur = await attempt(plan, undefined, mode !== "check")
			if (mode !== "check") draft(cur, "first version") // (a check starts from the scene already on the table)
		}
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

		// ---- 3d. physics first (a new scene, ai/DESIGN.md §13.2): before the critic looks, every goal and stage check is made to happen in the engine,
		// stage by stage (each stage's own knobs, plus where its receiver stands, a gap, a held thing's height, a ramp's top), and the tuned plan, placed
		// and run on the app's own engine, is the version the critic sees first (kept only when it loses no check there). Measured on 26 requests:
		// plans that work before any critic 52 % → 88 %, success 0.87 → 0.92, build p50 51 → 44 s (fewer critic rounds), no model call.
		if (physicsFirst)
			try {
				await physicsFirstTune()
			} catch (e) {
				if (e?.name === "AbortError" || signal.aborted) throw e
				// (the tuner is a help, never a reason a build fails: the plan goes on as it was placed)
				say("info", "stage_tune_failed", `The stage tuner couldn't run: ${e?.message ?? e}`)
				console.warn?.("stage tune:", e)
			}
		async function physicsFirstTune() {
			const v0 = cur
			const ev0 = await evOf(v0, true)
			const n0 = ev0.ok ? ev0.f.goals + ev0.f.stages : 0
			if (!n0) onEvent({ type: "step", step: "stagetune", state: "skipped", label: ev0.ok ? "no goals to check" : "it didn't run" })
			else if (allPass(ev0)) {
				report.stageTune = { runs: 0, ms: 0, before: counts(ev0), after: counts(ev0), kept: false, already: true }
				onEvent({ type: "step", step: "stagetune", state: "skipped", label: `every ${ev0.f.stages > ev0.f.goals ? "stage" : "goal"} works in the first run` })
			} else {
				const t = await timed("stagetune", `${ev0.f.stages - ev0.f.stagesOk} of ${ev0.f.stages} failing`, () =>
					ST.stageTune(v0.plan, { from: ev0, signal, maxRuns: STAGE_RUNS, perStage: STAGE_RUNS_PER, maxMs: STAGE_MS, onProgress: (p) => onEvent({ type: "progress", step: "stagetune", ...p }) })
				)
				stageLog = t.log
				const st = { runs: t.runs, ms: Math.round(t.ms), before: counts(ev0), after: counts(ev0), kept: false, changes: [], stages: t.log.filter((l) => !l.joint).map((l) => ({ stage: l.stage, label: l.label, runs: l.runs, passed: l.passed, knobs: (l.knobs ?? []).length })), joint: t.log.find((l) => l.joint) ? { runs: t.log.find((l) => l.joint).runs, kept: t.log.find((l) => l.joint).kept } : null }
				report.stageTune = st
				// Only a version where EVERY goal and stage check works goes to the critic first. Measured on the real app (2 × 10 text builds × 2
				// engines, 15 Oct): versions adopted with everything working succeeded 17/17; still-failing versions the tuner had moved closer
				// succeeded 1/6 (the planned version, in the same cases without physics first: 5/6), the critic spending its rounds undoing the
				// tuner's moves. Then the critic starts from the plan as it was placed, told which stage fails and what the tuner tried.
				if (t.ev.ok && t.ev.plan !== v0.plan && !allPass(t.ev)) {
					st.partial = counts(t.ev)
					st.note = `It got ${t.ev.f.stages > t.ev.f.goals ? `${t.ev.f.stagesOk} of ${t.ev.f.stages} stages` : `${t.ev.f.goalsOk} of ${t.ev.f.goals} goals`} working, not all, so the AI started from the plan as it was (and was told what the tuner tried)`
				} else if (t.ev.ok && t.ev.plan !== v0.plan) {
					check()
					const v1 = await attempt(t.ev.plan, "tuned stage by stage")
					const ev1 = await evOf(v1, true)
					st.engine = counts(ev1)
					if (ev1.ok && allPass(ev1) && !builtWorse(ev0, ev1)) {
						st.kept = true
						st.after = counts(ev1)
						st.changes = describeDiff(v0.scene, v1.scene)
						cur = v1
						draft(cur, "tuned")
					} else st.note = "the tuned version didn't work in the app's own run of it, so the first version was kept"
				}
			}
			check()
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
				else if (JSON.stringify(a.place ?? null) !== JSON.stringify(it.place ?? null) && !seatedIds.has(it.id)) {
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
			// (a thing the person only put by another that the machine now runs into: said as the reason, "the sneaker is in the way: nothing
			// reaches the seesaw" (V8832 m1), never only "nothing reaches the seesaw")
			// (only when it really is: the run without it gets further. V8842 k1 r2: "the sneaker is in the way: nothing reaches the seesaw", and
			// without the sneaker the books reached nothing either)
			const inWayReally = async (v, id) => {
				try {
					// (it and what it holds up: a post taken away without its cup would drop the cup into the chain)
					let RM = new Map()
					try {
						RM = riderMap(v.scene)
					} catch {}
					const gone = new Set([id, ...(RM.get(id) ?? [])])
					try {
						const insV = inspect(v.scene)
						for (const o of v.scene.items) if (supportIn(v.scene, insV, o.id)?.id === id) gone.add(o.id)
					} catch {}
					const sc = { ...clone(v.scene), items: v.scene.items.filter((i) => !gone.has(i.id)) }
					const sm = await simulate(sc, signal)
					const there = (t) => goalItems(t.goal).every((gid) => sc.items.some((i) => i.id === gid))
					const tg1 = fixTargets({ goals: G(v), scene: sc, before: beforeRun, sim: sm }).filter(there)
					const tg0 = fixTargets({ goals: G(v), scene: v.scene, before: beforeRun, sim: v.sim }).filter(there)
					const r1 = judgeTargets(tg1, sm)
					const r0 = judgeTargets(tg0, v.sim)
					const okN = (rs) => rs.filter((r) => r.ok === true).length
					if (okN(r1) > okN(r0)) return true
					return farness(tg1, r1, sm, sc) < farness(tg0, r0, v.sim, v.scene) - 0.15
				} catch (e) {
					if (e?.name === "AbortError" || signal.aborted) throw e
					return true
				}
			}
			if (anchorsNow.size && report.targets.some((t) => t.ok === false))
				try {
					const way = [...inTheWay(cur)].map((id) => cur.scene.items.find((i) => i.id === id)).filter(Boolean)
					if (way.length && (await inWayReally(cur, way[0].id))) {
						const nm = placeName(way[0], cur.scene)
						const t = report.targets.find((x) => x.ok === false && !x.implicit) ?? report.targets.find((x) => x.ok === false)
						const h = String(t.happened ?? "").replace(/[.!]+$/, "")
						t.happened = new RegExp(`\\b${nm.replace(/^the /, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(h) ? h.replace(/ and it doesn't tip over/, ", which is in the way") : `${nm} is in the way: ${h || `“${String(t.label).replace(/[.!]+$/, "")}” doesn’t happen`}`
					}
				} catch {}
			// (a thing the edit added that nobody asked for (a post to stand the cup on) and that the machine now runs into: said as the reason, "the
			// post I added to hold the cup is in the way: nothing reaches the seesaw", never only "nothing reaches the seesaw" (V8838 s-swap-box-cup))
			if (report.targets.some((t) => t.ok === false && !/ is in the way/.test(t.happened ?? "")))
				try {
					const said = String(text ?? "").toLowerCase()
					const unasked = cur.scene.items.filter((it) => !request.scene.items.some((o) => o.id === it.id) && !["table", "wall"].includes(it.type) && !anchorsNow.has(it.id) && !`${kindNoun(it.type, 1, { short: true })} ${kindNoun(it.type, 2, { short: true })} ${it.name ?? ""}`.toLowerCase().split(/[^\p{L}]+/u).some((w) => w.length > 2 && new RegExp(`\\b${w}`).test(said)))
					// (in the way: struck, and it stays where it stands, a fixed post; a helper that tips over when struck is a link of the chain)
					const stays = (id) => {
						const it = cur.scene.items.find((i) => i.id === id)
						const st = (cur.sim?.summary?.stories ?? []).find((x) => x.item === id)
						return !!it && (isStaticItem(it.type, it.fixed === true) || it.fixed === true || !st || st.moved_at === null || st.moved_at === undefined)
					}
					const hit = new Set([...struckIn(cur, new Set(unasked.map((i) => i.id)))].filter(stays))
					// (or one that stands where a part of the chain used to strike the next: between them, at the striker's height (the post under the
					// cup, between the dominoes and the seesaw: the last domino leans on it too gently for the engine to log a hit))
					if (!hit.size && request.sim?.track?.frames?.length) {
						const failing = report.targets.filter((t) => t.ok === false)
						const C0 = chainOf(request.sim, request.scene)
						const ins = inspect(cur.scene)
						const steps = []
						for (const t of failing) {
							const g0 = (G(cur) ?? []).find((x) => isObj(x) && x.label === t.label)
							for (let p = g0 ? goalItems(g0)[0] : null, k = 0; p && C0.get(p)?.by && k < 12; p = C0.get(p).by, k++) steps.push([C0.get(p).by, p])
						}
						for (const it of unasked) {
							if (!stays(it.id)) continue
							const b = ins.box(it.id)
							if (!b) continue
							const cx = (b.x0 + b.x1) / 2
							for (const [D, L] of steps) {
								const bD = ins.box(D)
								const bL = ins.box(L)
								if (!bD || !bL) continue
								const right = (bD.x0 + bD.x1) / 2 < (bL.x0 + bL.x1) / 2
								const between = right ? cx > bD.x1 - 0.03 && cx < (bL.x0 + bL.x1) / 2 : cx < bD.x0 + 0.03 && cx > (bL.x0 + bL.x1) / 2
								if (between && b.y1 > bD.y0 + 0.01 && b.y0 < bD.y1) hit.add(it.id)
							}
						}
					}
					const it0 = hit.size ? unasked.find((i) => hit.has(i.id)) : null
					if (it0 && (await inWayReally(cur, it0.id))) {
						const it = it0
						const R = riderMap(cur.scene)
						const insC = inspect(cur.scene)
						// (what it holds up: placed on it in the version's plan ("on": the post), or resting on it)
						const onIt = new Set((cur.plan?.items ?? []).filter((o) => isObj(o) && isObj(o.place) && (o.place.on === it.id || o.place.inside === it.id)).map((o) => o.id))
						const held = [...(R.get(it.id) ?? []).map((id) => cur.scene.items.find((i) => i.id === id)), ...cur.scene.items.filter((o) => o.id !== it.id && (onIt.has(o.id) || supportIn(cur.scene, insC, o.id)?.id === it.id))].find((o) => o && request.scene.items.some((x) => x.id === o.id))
						const nm = placeName(it, cur.scene)
						const t = report.targets.find((x) => x.ok === false && !x.implicit) ?? report.targets.find((x) => x.ok === false)
						const h = String(t.happened ?? "").replace(/[.!]+$/, "")
						// (the AI's rework's own helper is "it added": the card says "The AI's rework didn't work either (it tried: …)")
						t.happened = `${nm} ${request.rework === true ? "it" : "I"} added${held ? ` to hold ${callNow(held, cur.scene)}` : ""} is in the way: ${h || `“${String(t.label).replace(/[.!]+$/, "")}” doesn’t happen`}`
					}
				} catch {}
			// (a change that still starts things inside each other (its repair turn ran out of time or found nothing): said as the reason, "the
			// dominoes now start inside the box: …", never only what follows from it)
			if (report.edit?.repair && !report.edit.repair.kept && report.targets.some((t) => t.ok === false))
				try {
					// (two things of the machine: a thing sunk a little into the table is its seat, never the reason)
					const real = (id) => { const it = cur.scene.items.find((i) => i.id === id); return it && !["table", "wall"].includes(it.type) ? it : null }
					// (and only a pair the failing goal's chain goes through: its own things, or what set them off in the run before, a duck inside the
					// mug beside a marble that misses the bottom ramp is no reason (V8841 k2))
					const chainIds = new Set()
					try {
						const C0 = request.sim?.track?.frames?.length ? chainOf(request.sim, request.scene) : new Map()
						for (const t of report.targets.filter((x) => x.ok === false)) {
							const g0 = (G(cur) ?? []).find((x) => isObj(x) && x.label === t.label)
							for (const id of g0 ? goalItems(g0) : []) for (let p = id, k = 0; p && k < 12; p = C0.get(p)?.by ?? null, k++) chainIds.add(p)
						}
					} catch {}
					const w = overlapsOf(cur.scene).find((x) => Array.isArray(x.items) && x.items.length === 2 && x.items.every(real) && x.items.some((id) => chainIds.has(id)))
					const [p, q] = (w?.items ?? []).map(real)
					if (p && q) {
						const t = report.targets.find((x) => x.ok === false && !x.implicit) ?? report.targets.find((x) => x.ok === false)
						const np = placeName(p, cur.scene)
						const h = String(t.happened ?? "").replace(/[.!]+$/, "")
						// (never two colons in a lead)
						const first = `${np} ${/s$/i.test(np) && !/\d/.test(np) ? "start" : "starts"} inside ${placeName(q, cur.scene)}`
						if (!/ starts? inside /.test(h)) t.happened = !h ? `${first}: “${String(t.label).replace(/[.!]+$/, "")}” doesn’t happen` : /:/.test(h) ? `${first}, and ${h}` : `${first}: ${h}`
					}
				} catch {}
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
			// (a rework the app asked for protects only what the person chose (request.keep): what its own answer set may be tuned further)
			const protect = request.rework === true ? new Map() : new Map([...touched].filter(([id]) => !mine || own.has(id) || !onScreen.has(id)).map(([id, keys]) => [id, axisOf(id, keys)]))
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
			// (a thing the person only put by another, "next to the box", may slide along: only its height stays (V8832 m1))
			for (const id of anchorsNow.keys()) {
				const k = protect.get(id)
				if (k && k !== "all" && k.has("place")) protect.set(id, new Set([...k].filter((x) => x !== "place").concat("place-y")))
			}
			if (report.edit) report.edit.touched = [...protect].map(([id, keys]) => [id, keys === "all" ? "all" : [...keys], ...(origin.has(id) ? [origin.get(id)] : [])])
			// what of the change is the person's own choice (§16; the user, 16 Oct: "keeping every item the user asked for"): hard (a fix or a rework
			// never changes it: a count, a size or a place their words give an amount for, a fill or a material they asked for) or forward (said
			// without an amount, "move the seesaw along", "make it heavier": a fix may go further that way, never back). The rest of what the edit set
			// is the AI's own way of doing it (the soda cans' fill, a row's growth, a trampoline's width) and may be tuned by a fix.
			const choice = choicesOf(text, protect, cur.scene, own, Array.isArray(request.hard) ? request.hard : null, report.edit?.targets ?? null)
			if (report.edit) Object.assign(report.edit, { hard: [...choice.hard].map(([id, ks]) => [id, [...ks]]), forward: [...choice.forward].map(([id, ks]) => [id, [...ks]]) })
			// (a change made while an earlier one still fails, "make the duck a bit bigger" after the breakfast: the scene where the goal last worked is
			// the "before" the fix search, the reasons and the AI's reworks compare with, never the already-broken one: V8814 s2, 16 Oct)
			let fixBefore = before
			let fixTargetsNow = targets
			if (isObj(request.reference) && Array.isArray(request.reference.items) && now0.some((r) => r.ok === false))
				try {
					const refSim = await simulate(request.reference, signal)
					const ref = { scene: request.reference, sim: refSim }
					const tg = fixTargets({ goals: G(cur), scene: cur.scene, before: ref, sim: cur.sim })
					const nowR = judgeTargets(tg, cur.sim)
					const refR = judgeTargets(tg.filter((t) => goalItems(t.goal).every((id) => ref.scene.items.some((i) => i.id === id))), refSim)
					const failingNow = tg.filter((t, i) => nowR[i].ok === false && !t.implicit)
					const there = tg.filter((t) => goalItems(t.goal).every((id) => ref.scene.items.some((i) => i.id === id)))
					if (failingNow.length && failingNow.every((t) => refR[there.indexOf(t)]?.ok === true)) {
						fixBefore = ref
						fixTargetsNow = tg
					}
				} catch (e) {
					if (e?.name === "AbortError" || signal.aborted) throw e
				}
			// (what the edit's own call was billed: the floor of what a rework call on this scene is counted at while it runs)
			// (as billed with a warm prompt cache: a cold cache's one-off write is no measure of a rework's call (V8843 rw-cradle); and how long it
			// took, for whether a background rework has the time it needs: reworkNeedMs)
			const editCalls = report.calls.filter((c) => c.step === "edit")
			const lastUsd = warmUsd(editCalls.at(-1)?.usage)
			const lastMs = num(editCalls.at(-1)?.ms)
			const fixCtx = { scene: cur.scene, sim: cur.sim, goals: G(cur), before: fixBefore, touched: protect, swapped, targets: fixTargetsNow, flex, origin, hard: choice.hard, forward: choice.forward, ...(lastUsd ? { lastUsd } : {}), ...(lastMs ? { lastMs } : {}), ...(frozen.size ? { frozen } : {}) }
			// (the person's own change puts a goal out of reach whatever else changes, a thing wider than the opening it must land in: the lead says
			// why, and nothing is searched or asked: V8817 h1 / h4, 237 runs, 3 reworks and $0.26 to find out)
			const reach = now0.some((r) => r.ok === false) ? reachOf(fixCtx) : null
			if (reach) {
				const t = (report.targets ?? []).find((x) => x.ok === false && x.label === reach.label)
				if (t) t.happened = `${reach.words}, and nothing else can change that`
				report.fix = { state: "none", outOfReach: true, why: reach.words, goal: reach.label, checked: null, runs: 0 }
			} else if (now0.some((r) => r.ok === false)) {
				// (a change that also states its outcome ("add a fan … that blows the ping-pong ball off the edge"): what goes on the table with it may
				// tune only what that outcome is about and the things the change put in; anything else of the machine is the card's checked offer,
				// never an applied change: V8817 c01, "Done, and I raised the conveyor belt 2 cm so it works")
				const outcomeEdit = fixKind && !pureFix
				let only = null
				if (outcomeEdit) {
					only = new Set()
					const had = new Set(request.scene.items.map((i) => i.id))
					for (const it of cur.scene.items) if (!had.has(it.id) || swapped.has(it.id)) only.add(it.id)
					const wasGoals = (Array.isArray(basePlan?.goals) ? basePlan.goals : []).filter(isObj)
					const sameGoal = (a, b) => goalKindOf(a) === goalKindOf(b) && goalRefs(a).join("|") === goalRefs(b).join("|")
					const fresh = (G(cur) ?? []).filter((g) => isObj(g) && !wasGoals.some((w) => sameGoal(w, g)))
					// (the outcome is a new one, "…blows the ping-pong ball off the edge": its things; else the scene's own goals the request names a thing
					// of, "move the box to x 1.9 so the ball still lands in it": the ball and the box)
					// (the goals the outcome clause itself names a thing of, "so the apple lands softly": the apple's goal, never every goal of a thing
					// the request names only to swap it: "the heavy steel weight for a heavy bowling ball" pulled in "the bowling ball hits the seesaw",
					// and the seesaw was moved 2 cm on the table as part of the edit (V8832 m6). Anything else is the card's checked offer)
					const clause = outcomeClause(text)
					const said = clause ? new Set([...namedIn(clause, cur.scene), ...namedIn(clause, request.scene)]) : new Set()
					const about = said.size ? said : named
					if (fresh.length) for (const g of fresh) for (const id of goalItems(g)) only.add(id)
					else for (const t of targets) if (t.goal && goalRefs(t.goal).some((id) => about.has(id))) for (const id of goalRefs(t.goal)) only.add(id)
					for (const id of [...only]) for (const r of R.get(id) ?? []) only.add(r)
					// (a thing that must go off the table may have the invisible wall at that end taken away)
					if ((G(cur) ?? []).some((g) => goalKindOf(g) === "off")) for (const w of cur.scene.items) if (isSafetyWall(w)) only.add(w.id)
				}
				if (fixKind) {
					let fr = null
					if (report.edit?.fixFlow) report.edit.fixFlow.fixer = true
					// (a typed "make it work" is held to MAKE_IT_WORK_MS in all, as the background is: a hard stop, never 41 s for a 12 s search on a
					// busy machine (V8843 v43f5: 77 s in all))
					const dl = num(request.deadline) ?? (typedMake ? madeDeadline : null)
					const stopCtl = dl !== null ? new AbortController() : null
					const onStop = () => stopCtl?.abort()
					if (stopCtl) signal.addEventListener("abort", onStop, { once: true })
					const stopTimer = stopCtl ? setTimeout(onStop, Math.max(1500, dl - Date.now() - 1500)) : null
					try {
						const left = dl !== null ? Math.max(2000, Math.min(FIX_MS, dl - Date.now() - 3000)) : FIX_MS
						fr = await timed("fix", null, () => findFix(only ? { ...fixCtx, only } : fixCtx, { signal: stopCtl?.signal ?? signal, budgetMs: left, ...(dl !== null ? { hardMs: left } : {}), onProgress: (pr) => onEvent({ type: "progress", step: "fix", ...pr }) }))
					} catch (e) {
						if (signal.aborted) throw e
						if (e?.name === "AbortError" && !stopCtl?.signal.aborted) throw e
						if (!stopCtl?.signal.aborted) say("warn", "fix_failed", `Couldn’t look for a fix: ${e?.message ?? e}`)
						else fr = { status: "none", runs: 0, targets: fixCtx.targets ?? [], results: [], timedOut: true }
					} finally {
						clearTimeout(stopTimer)
						if (stopCtl) signal.removeEventListener("abort", onStop)
					}
					// (nor anything that changes what the person said to leave as it is)
					if (fr?.status === "found" && touchesFrozen(fr.fix?.scene)) fr = { ...fr, status: "none", fix: undefined }
					if (outcomeEdit && fr?.status !== "found" && fr?.status !== "ok") {
						// (nothing of the outcome's own things makes it happen: the panel looks further, the AI's reworks too, and offers what works)
						report.fixNeeded = true
						Object.defineProperty(report, "fixCtx", { value: fixCtx, enumerable: false, configurable: true, writable: true })
					} else if (fr?.status === "found" && fr.fix.sim) {
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
			// a "make it work" never leaves the scene worse than it was before the request: when a goal that worked before it now fails, or fewer
			// work, nothing is applied and the reply says what already works (round 3's acceptance, 2 of 2: a question about "the dominoes twice as
			// far apart", then "make it work" spread 7 dominoes into 5 and Ball 2 no longer landed in the box, and the broken scene stayed)
			// (only a request that is nothing but "make it work": one that also asks for its own change, "move the box 15 cm right so Ball 2 still
			// lands in it", is that change, said honestly when it breaks something)
			if (fixKind && pureFix) {
				let beforeSim = before?.sim ?? null
				if (!beforeSim)
					try {
						beforeSim = await simulate(request.scene, signal)
					} catch (e) {
						if (e?.name === "AbortError" || signal.aborted) throw e
					}
				// (the goals of the scene before, judged in both runs: an answer that drops a goal, or what it is about, loses it too; only what the
				// scene before had counts)
				const t0 = beforeSim ? fixTargets({ goals: Array.isArray(basePlan?.goals) ? basePlan.goals : null, scene: request.scene, before: beforeSim.doc ? { scene: request.scene, sim: beforeSim } : null, sim: cur.sim }) : []
				const known = t0.map((t) => !!t.goal && goalItems(t.goal).every((id) => request.scene.items.some((x) => x.id === id)))
				const was0 = beforeSim && t0.length ? judgeTargets(t0, beforeSim) : null
				if (was0) {
					const nowF = judgeTargets(t0, cur.sim)
					const okN = (rs) => rs.filter((r, i) => known[i] && r.ok === true).length
					const lostT = t0.filter((t, i) => known[i] && was0[i]?.ok === true && nowF[i]?.ok !== true)
					if (lostT.length || okN(nowF) < okN(was0)) {
						const plain = (l) => {
							const t = String(l).replace(/[.!]+$/, "")
							return /^(The|A|An|All|Every|Each|Both)\b/.test(t) ? lc(t) : t
						}
						const worked = t0.filter((t, i) => known[i] && was0[i]?.ok === true && !t.implicit)
						const failing0 = t0.filter((t, i) => known[i] && was0[i]?.ok === false && !t.implicit)
						const words = !failing0.length
							? `It already works: ${andList((worked.length ? worked : lostT).map((t) => plain(t.label)))} ✓ — nothing changed.`
							: `I couldn't make it work without breaking what already works (${andList(lostT.map((t) => `“${String(t.label).replace(/[.!]+$/, "")}”`))}), so I left it as it is — “${String(failing0[0].label).replace(/[.!]+$/, "")}” still doesn't happen ✗.`
						report.edit.reverted = { lost: lostT.map((t) => t.label), tried: humanChangeList(request.scene, cur.scene, { says: report.edit.targets, text: personText }).map((c) => c.text) }
						report.edit.stillFails = failing0.map((t) => t.label)
						delete report.fixApplied
						delete report.fix
						delete report.fixNeeded
						return replyOnlyReport({ reply: words, suggestions: editOut?.suggestions }, "fix")
					}
				}
			}
		}
		// the tuner: a bounded search over the plan's knobs for the goals that fail
		const needsTune = (v) => (v.plan.tune?.length ?? 0) > 0 && goalResults(v.sim, G(v)).some((g) => g.ok !== true)
		const runTune = async (v) => {
			// (a new scene whose plan has stages: stage by stage, each stage's own knobs, then the joint tuner for what still fails: §13.2)
			if (physicsFirst && ownStages(v.plan))
				try {
					return await runStageTune(v)
				} catch (e) {
					if (e?.name === "AbortError" || signal.aborted) throw e
					say("info", "stage_tune_failed", `The stage tuner couldn't run: ${e?.message ?? e}`)
					return v
				}
			const tr = await timed("tune", null, () => tune({ plan: v.plan, scene: v.scene, sim: v.sim, goals: G(v), exclude: touched, simulate, signal, solver: solveV, onProgress: (p) => onEvent({ type: "progress", step: "tune", ...p }) }))
			report.tune = { changed: tr.changed, runs: tr.runs, ms: tr.ms, before: tr.before, after: tr.after, passed: tr.passed, knobs: tr.knobs, skipped: tr.skipped, notes: displaced, changes: [] }
			if (!tr.changed.length) return v
			const solved = solveV(tr.plan)
			const t = { id: nextId++, plan: tr.plan, solved, scene: solved.scene, sim: tr.sim, score: null, judged: false, tuned: true, parent: v, fromRound: v.fromRound }
			report.tune.changes = describeDiff(v.scene, t.scene)
			draft(t, "tuned")
			return t
		}
		/** The stage-aware tuner after the critic (a new scene with stages): a version that passes more checks and loses none, or v as it was. */
		const runStageTune = async (v) => {
			const ev = await evOf(v, true)
			const max = STAGE_RUNS_PER * 3
			const t = await timed("tune", "stage by stage", () => ST.stageTune(v.plan, { from: ev, signal, maxRuns: max, perStage: STAGE_RUNS_PER, maxMs: TUNE_MS, onProgress: (p) => onEvent({ type: "progress", step: "tune", runs: p.runs, max, passed: p.passed }) }))
			const r4 = (x) => Math.round(x * 1e4) / 1e4
			const changed = t.log.flatMap((l) => (l.changed ?? []).filter((c) => num(c.from) !== null && num(c.to) !== null).map((c) => ({ id: c.id, param: c.param, from: r4(c.from), to: r4(c.to) })))
			const ok0 = goalsOk(v.sim, G(v))
			report.tune = { changed: [], runs: t.runs, ms: Math.round(t.ms), before: ok0, after: ok0, passed: allPass(ev), knobs: [], skipped: [], notes: displaced, changes: [], stages: counts(ev) }
			if (!t.ev.ok || t.ev.plan === v.plan) return v
			check()
			const nv = await attempt(t.ev.plan, "tuned")
			const evn = await evOf(nv, true)
			if (!evn.ok || passN(evn) <= passN(ev) || ST.lostChecks(ev, evn).length || builtWorse(ev, evn)) {
				report.tune.note = "the tuned version did no better in the app's own run of it, so it wasn't kept"
				return v
			}
			Object.assign(nv, { tuned: true, parent: v, fromRound: v.fromRound })
			Object.assign(report.tune, { changed, after: goalsOk(nv.sim, G(nv)), passed: allPass(evn), stages: counts(evn), changes: describeDiff(v.scene, nv.scene) })
			draft(nv, "tuned")
			return nv
		}
		/** Is there something left for the tuner: a goal that fails (with knobs to turn), or, with stages, any check that fails. */
		const needsTuneNow = async (v) => {
			if (physicsFirst && ownStages(v.plan)) {
				const ev = await evOf(v)
				return ev.ok && !allPass(ev)
			}
			return needsTune(v)
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
		const judge = async (v, round, rounds, label, extra = [], rateOnly = false) => {
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
			// (ai/DESIGN.md §13.3: a rate-only look is {score_0_10, issues} and no patches, at lower effort, from the same cached prompt; "done" is a score of 8 or more)
			if (rateOnly) payload.rate_only = true
			const out = await timed("refine", null, () => callStep("refine", payload), label)
			return rateOnly && isObj(out) ? { ...out, done: (num(out.score_0_10) ?? 0) >= 8, patches: [] } : out
		}
		/** For the critic (a new scene): the first stage whose check fails in this version's run, with what the run shows of its things and what the
		 *  stage tuner already tried, so the critic fixes that stage first (the server lists every stage's check MET / FAILED beside it). */
		const stageFacts = async (v) => {
			if (!physicsFirst) return []
			let ev
			try {
				ev = await evOf(v, true)
			} catch (e) {
				if (e?.name === "AbortError" || signal.aborted) throw e
				return []
			}
			const k = ev?.ok ? ev.stages.findIndex((st) => st.check && st.res?.ok !== true) : -1
			if (k < 0) return []
			const tried = (stageLog ?? []).find((l) => !l.joint && l.stage === ev.stages[k].stage && !l.passed && l.knobs?.length) ?? null
			return [`A physics check of this version before your look (the app's own run). ${ST.stageFacts(ev, k, tried)}\nFix ${ev.stages[k].synthetic ? `“${ev.stages[k].label}”` : `stage ${ev.stages[k].stage}`} first: change its own things or the hand-off into it by enough to make it happen, and keep what works before it.`]
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
			// (ai/DESIGN.md §13.3 (2)) after a round whose patches made every stated goal (and stage check) pass, with nothing floating and the picture
			// covered: a rate-only look first; 8 or more is taken as done (no full critique); below 8 the full critique runs as before
			if (round >= 2 && cur.parent && !cur.judged && !feedback.length) {
				const gr = goalResults(cur.sim, G(cur))
				const covered = !observation || coverage(observation, cur.plan).gaps.length === 0
				let stagesOk = true
				if (physicsFirst && ownStages(cur.plan))
					try {
						stagesOk = allPass(await evOf(cur))
					} catch (e) {
						if (e?.name === "AbortError" || signal.aborted) throw e
					}
				if (gr.length && gr.every((g) => g.ok === true) && stagesOk && covered && !floatingIn(cur).length && !passIn(cur).length) {
					try {
						const quickLook = await judge(cur, round, rounds, `${label} (rating)`, runDiff(cur.parent.sim, cur.sim), true)
						if (num(quickLook?.score_0_10) !== null && quickLook.score_0_10 >= 8) critique = { ...quickLook, done: true, patches: [], rated: true }
					} catch (e) {
						if (e?.name === "AbortError" || signal.aborted) throw e
					}
				}
			}
			try {
				if (!critique) critique = await judge(cur, round, rounds, label, [...feedback, ...(await stageFacts(cur)), ...(cur.parent ? runDiff(cur.parent.sim, cur.sim) : [])])
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
			let lost = worse ? [] : lostStages(cur.sim, next.sim, next.scene)
			// (a new scene: a goal or stage check that passed and now fails is never traded away: the loop guard of the search experiment)
			let lostChecks = []
			if (!worse && physicsFirst)
				try {
					lostChecks = lostIn(await evOf(cur), await evOf(next))
				} catch (e) {
					if (e?.name === "AbortError" || signal.aborted) throw e
				}
			if (worse || lostChecks.length || (lost.length && goalsOk(next.sim, G(next)) <= goalsOk(cur.sim, G(cur)))) {
				if (lostChecks.length) lost = [...lostChecks.map((l) => `“${l}” no longer happens`), ...lost]
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
				if (tuneWanted && (await needsTuneNow(cur))) {
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
		if (tuneWanted && !tunedAlready && (await needsTuneNow(cur))) cur = await runTune(cur)
		else if (!tunedAlready) onEvent({ type: "step", step: "tune", state: "skipped", label: !goalResults(cur.sim, G(cur)).length ? "no goals to tune" : goalResults(cur.sim, G(cur)).every((g) => g.ok === true) ? "goals met" : !(cur.plan.tune?.length) ? "no knobs to tune" : mode === "edit" && !tuneWanted ? "the change didn't touch the goals" : "no knobs to tune" })
		check()

		// ---- 7. the final check: a version changed after the critic last saw it (its last patches, or the tuner) is rated as it is, so the score
		// shown is this scene's own. Its patches are not applied (no rounds are left); an earlier version it rates clearly better wins.
		if (finalCheck && rounds > 0 && !refineFailed && !cur.judged && report.refine.length) {
			let critique = null
			try {
				critique = await judge(cur, rounds, rounds, "Final check", cur.parent ? runDiff(cur.parent.sim, cur.sim) : [], true)
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
				if (best && best !== cur && best.judged && goalsOk(best.sim, G(best)) >= goalsOk(cur.sim, G(cur)) && (best.score ?? -1) > (cur.score ?? -1) && physV(best) >= physV(cur) && !(rough(best) && !rough(cur))) {
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
		// a goal the scene had that this version no longer checks is said on the card, with why: never dropped without a word (e2, 16 Oct: "a
		// mug can't be a landing goal, so I removed that goal" was not shown, while the card said "as before ✓")
		if (report.edit && Array.isArray(basePlan?.goals)) {
			const now1 = G(cur) ?? []
			const same = (a, b) => goalKindOf(a) === goalKindOf(b) && goalRefs(a).every((id) => goalRefs(b).includes(id)) && goalRefs(b).every((id) => goalRefs(a).includes(id))
			// (a goal that followed what replaced its things counts only while the version on the table still has it: a later turn's answer may
			// have dropped it again, V8820 n2: "All 24 dominoes of the run fall" went with the repair turn and nothing said so)
			const gone = basePlan.goals.filter((g) => isObj(g) && !(followed.has(g.label) && now1.some((x) => x.label === followed.get(g.label))) && !now1.some((x) => same(x, g) || (x.label && x.label === g.label)))
			if (gone.length)
				report.edit.goalsDropped = gone.map((g) => {
					const missing = goalRefs(g).map((id) => request.scene.items.find((i) => i.id === id)).filter((it) => it && !cur.scene.items.some((x) => x.id === it.id))
					// ("the dominoes were taken away": a row is many, never "the dominoes was")
					const many = missing.length > 1 || MULTI_UNIT[missing[0]?.type] || (/[^s]s$/i.test(theName(missing[0] ?? {})) && !/\d/.test(theName(missing[0] ?? {})))
					const why = missing.length ? `${andList(missing.map(theName))} ${many ? "were" : "was"} taken away` : "the change left it out"
					return `“${String(g.label ?? goalLabel(g)).replace(/[.!]+$/, "")}” (${why})`
				})
		}

		/** "Ask the AI to rework it", in the open, came back working: judged as the background's reworks are (judgeRework), against the scene
		 *  where the goals last worked (request.reference). -> null (it may go on the table), or why not in words. */
		async function judgeOpenRework(v) {
			let before = null
			if (isObj(request.reference) && Array.isArray(request.reference.items))
				try {
					before = { scene: request.reference, sim: await simulate(request.reference, signal) }
				} catch (e) {
					if (e?.name === "AbortError" || signal.aborted) throw e
				}
			let simNow = request.sim?.doc && request.sim?.track?.frames?.length ? request.sim : null
			if (!simNow)
				try {
					simNow = await simulate(request.scene, signal)
				} catch (e) {
					if (e?.name === "AbortError" || signal.aborted) throw e
				}
			const B0 = new Map((before?.scene?.items ?? []).map((i) => [i.id, i]))
			const keepIds = new Set((Array.isArray(request.keep) ? request.keep : []).filter(Array.isArray).map((k) => k[0]))
			const mine = request.scene.items.filter((i) => i.type !== "table" && !isSafetyWall(i) && (before ? !B0.has(i.id) || B0.get(i.id).type !== i.type : keepIds.has(i.id)))
			const ctxJ = { scene: request.scene, sim: simNow, goals: G(firstV ?? v), before, hard: null }
			const verdict = await judgeRework(ctxJ, { scene: v.scene, plan: v.plan }, { signal, mine, removedTypes: Array.isArray(request.removedTypes) ? request.removedTypes : [], targets: null, hard: Array.isArray(request.hard) ? request.hard : [] })
			return verdict.ok ? null : verdict.why
		}

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
		// (a stand-in is said only when it is there: "so I used a wooden plank" with no plank on the table is untrue (V8820 c04))
		const missing = [...(Array.isArray(finalPlan.missing) ? finalPlan.missing : [])].filter(isObj).map((m) => {
			const sub = m.substitute_type ?? m.substitute ?? null
			// (and, in an edit, only when this edit put one there: a plank that was on the table already stands in for nothing it added: "so I used
			// a wooden plank" with only the marble run's own planks was untrue (V8837 c04))
			const was = mode === "edit" ? new Map((request.scene?.items ?? []).map((i) => [i.id, i.type])) : null
			const there = !sub || scene.items.some((it) => it.type === sub && (!was || was.get(it.id) !== sub))
			return { asked: String(m.asked ?? m.what ?? "?"), reason: m.reason ? String(m.reason) : "", substitute_type: there ? sub : null, ...(there ? {} : { noSub: true }) }
		})
		for (const e of cur.solved.errors.filter((x) => x.code === "unknown_type")) missing.push({ asked: e.item ?? e.text, reason: "not in the library", substitute_type: null })
		// (a kind the catalog has is never "not in the library": the AI said so of a bucket and skipped the swap (V8817 m1), which is said as not
		// done instead; what is no thing at all, "blowing the ping-pong ball off the table's edge" (c01), is no missing thing either)
		if (mode === "edit" && report.edit) {
			const kinds = catalogKinds()
			for (let i = missing.length - 1; i >= 0; i--) {
				const m = missing[i]
				const w = String(m.asked).toLowerCase().replace(/\s+(in place of|instead of|to replace|as)\s+.*$/, "").replace(/^(a|an|the|some|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+/, "").trim()
				if (/^\w{3,}ing\s+(the|a|an|it|them|its|this|that)\b/.test(w) || w.split(/\s+/).length > 6) {
					missing.splice(i, 1)
					continue
				}
				const k = kinds.get(w) ?? kinds.get(w.replace(/(es|s)$/, "")) ?? kinds.get(w.replace(/s$/, ""))
				if (!k) continue
				missing.splice(i, 1)
				if (!scene.items.some((it) => it.type === k)) (report.edit.skipped ??= []).push(`${m.asked} (the AI left it out, though the library has ${aKind(k)}: ask again)`)
			}
		}
		// (a thing the words ask to move that the answer left where it was: "Not done: moving the seesaw and the box along", never a card that
		// says everything else is as it was without a word: V8820 c11 r2)
		if (mode === "edit" && report.edit && request.rework !== true)
			for (const w of unmovedAsks(text, request.scene, scene)) if (!(report.edit.skipped ?? []).includes(w)) (report.edit.skipped ??= []).push(w)
		// an edit or a check that did not write new notes or assumptions has none of its own: the old ones are not shown as this turn's
		const ownPlan = isObj(editOut?.plan) || Array.isArray(editOut?.items)
		const ownNotes = mode === "new" || (mode === "edit" && (editOut?.notes !== undefined || ownPlan))
		const ownAsm = mode === "new" || (mode === "edit" && (editOut?.assumptions !== undefined || ownPlan))
		// (a build from a concept picture: the plan's own differences are from that picture ("Ramp: about 20° instead of about 23°", measured
		// live 15 Oct), never from anything the person gave or asked: none are shown; the app's own lines (stands added) still are)
		const ownDiff = (mode === "new" && !concept) || (mode === "edit" && (editOut?.differences !== undefined || ownPlan))
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
		if (!concept) for (const a of assumptions) if (MIRROR_RE.test(a)) addDiff(a)
		if (ownNotes && !concept && typeof finalPlan.notes === "string") for (const sent of finalPlan.notes.split(/(?<=[.!?])\s+/)) if (MIRROR_RE.test(sent)) addDiff(sent)
		assumptions = assumptions.filter((a) => !differences.includes(a))
		// (a concept picture is the app's own: a line comparing the scene with "the picture" would read as if it were the user's)
		if (concept) assumptions = dropPictureLines(assumptions)
		const onScreen = new Set((request.scene?.items ?? []).map((i) => i.id))
		const newStands = new Set((cur.solved.supports ?? []).filter((st) => mode === "new" || !onScreen.has(st.id)).map((st) => st.for))
		for (const i of cur.solved.issues) if (i.code === "support_added" && (mode === "new" || newStands.has(i.item))) addDiff(i.text)
		if (report.coverage?.remaining?.length) addDiff(`Not as in your picture: ${andList(report.coverage.remaining)}`)
		report.differences = concept ? dropPictureLines(differences) : differences
		report.unsure = (Array.isArray(observation?.uncertain) ? observation.uncertain : []).map(String).filter(Boolean)
		if (images.length && images.some((im) => Math.max(im.width ?? 0, im.height ?? 0) > 0 && Math.max(im.width, im.height) < 512)) report.unsure.unshift("A low-resolution picture: counts and sizes may be off")
		// the plan's own account is what was MEANT to happen (written before any run); what happened comes from the run itself
		report.howItWorks = ownNotes && typeof finalPlan.notes === "string" && finalPlan.notes.trim() ? finalPlan.notes.trim() : null
		// (a concept build: the plan's own words never compare the scene with the concept, as if it were the person's picture)
		if (concept && report.howItWorks) report.howItWorks = dropPictureSentences(report.howItWorks)
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
		// things that start inside each other, or pass through each other, in the version on the table: said first, as a warning (the card's
		// heads-up), never only in the view's ⚠ or the critic's words (an edit: only what the change made new)
		{
			const said = (t) => String(t).replace(/^(.+) and (.+) overlap$/, "$1 and $2 start inside each other")
			const starts = (mode === "edit" ? overlapsOf(cur.scene).map((w) => w.text) : (cur.sim.warnings ?? []).map((w) => w?.text ?? String(w))).filter((t) => / overlap$| starts? inside /.test(String(t)))
			const through = mode === "edit" ? [] : passIn(cur).map((i) => i.text.replace(/ \(.*\)$/, ""))
			const lines = [...new Set([...starts.map(said), ...through])].filter(Boolean).slice(0, 3)
			if (lines.length) report.issues.unshift(...lines.map((t) => ({ level: "warn", code: through.includes(t) ? "pass_through" : "start_overlap", text: t })))
			if (through.length) report.problems = report.problems.filter((p) => !through.includes(p))
		}
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
		// the plan's stages, each checked on the run of the version on the table (ai/DESIGN.md §13.2: "Stage 2 · Dominoes fall ✗ 4 of 12 fell")
		if (mode !== "edit" && ownStages(cur.plan))
			try {
				const ev = await evOf(cur)
				if (ev.ok) report.stages = ev.stages.filter((st) => st.check && !st.synthetic).map((st) => ({ stage: st.stage, label: st.label, kind: goalKindOf(st.check), ok: st.res?.ok ?? null, ...(st.res?.detail ? { detail: st.res.detail } : {}) }))
			} catch (e) {
				if (e?.name === "AbortError" || signal.aborted) throw e
			}
		// (what was moved only to make room for the change says so: the edit's own trial, and what the solver let go because the change ran into it)
		const room = new Set([...madeRoom, ...(cur.solved?.freed ?? [])])
		// (why the solver put a swapped or resized thing somewhere else: "to clear Ten dominoes"; the person's own words for what they named)
		const whyMoved = (v) => new Map((v?.solved?.issues ?? []).filter((i) => i.code === "moved" && i.item).map((i) => [i.item, /\bto (clear|stand) .*$/.exec(String(i.text ?? ""))?.[0] ?? null]))
		const says = report.edit?.targets ?? null
		// (what things weigh in each run, where the engine says: a weight typed in or tuned)
		const massesOf = (sim) => new Map(Object.entries(isObj(sim?.resolved) ? sim.resolved : {}).filter(([, r]) => num(r?.mass) !== null).map(([id, r]) => [id, num(r.mass)]))
		const masses = { massA: massesOf(request.sim), massB: massesOf(cur.sim) }
		// (what the answer moved of a named thing beyond what was asked, and why: said on its line, and in the lead when a goal that worked stops)
		let unasked = new Map()
		if (mode === "edit" && request.rework !== true)
			try {
				unasked = unaskedMoves(text, request.scene, cur.scene)
			} catch {}
		// (where the person put an added thing in their words: "next to the box", "under ramp 1")
		const whereSaid = mode === "edit" ? new Map([...placeWordsOf(personText, request.scene, cur.scene), ...anchorsNow]) : anchorsNow
		let humanList = mode !== "new" ? humanChangeList(request.scene, cur.scene, { room, says, why: whyMoved(cur), text: personText, reasons: unasked, anchors: whereSaid, ...masses }) : []
		if (mode === "edit") {
			// (with a fix that went on the table too, the change is said first and the fix after it)
			if (report.fixApplied) report.targets = (report.targets ?? []).map((t) => ({ label: t.label, ok: true, implicit: t.implicit, ...(t.was !== undefined ? { was: t.was } : {}) }))
			// (what the request names first, then what had to make room for it, the run's length, the table last)
			const named = namedIn(text, request.scene)
			const rank = (c) => (cur.scene.items.find((i) => i.id === c.id)?.type === "table" ? 3 : c.id === null ? 2 : named.has(c.id) || !request.scene.items.some((i) => i.id === c.id) ? 0 : 1)
			const order = (list) => list.map((c, i) => ({ c, i, r: rank(c) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.c)
			humanList = order(humanList)
			// the app's own "make it work" asked in the open ("Ask the AI to rework it") that still doesn't work is never put on the table: it is said,
			// with what it tried, and the closest it got is offered as an unchecked "Try:" (V8814, 16 Oct: failing reworks emptied the bottles,
			// added a laptop, and were applied; the card then said "still doesn't work" twice)
			const stillFailing = (report.targets ?? []).filter((t) => t.ok === false)
			// (one that works is judged as the background's are before it goes on the table: nothing new held and let go on the clock, the release
			// time as it was, nothing the person took away back, their settings kept, what they put in a container still in it, no stage lost, and
			// the machine itself setting the goal's thing off: V8817 s3, a steel weight dropped on the seesaw at 0.68 s was put on the table)
			let refused = null
			if (request.rework === true && !request.background && !stillFailing.length)
				try {
					refused = await judgeOpenRework(cur)
				} catch (e) {
					if (e?.name === "AbortError" || signal.aborted) throw e
				}
			// (a "make it work" typed in the open is one too: one that still doesn't work leaves the scene as it was, never "Done, but it still
			// doesn't work" with a change that fixes nothing and a new paid button (V8832 y20: the seesaw moved 15 cm, $0.115))
			const openMake = !request.background && (request.rework === true || (fixKind && pureFix && !report.fixApplied))
			if (openMake && (stillFailing.length || refused)) {
				const g = stillFailing.find((t) => !t.implicit) ?? stillFailing[0] ?? (report.targets ?? []).find((t) => !t.implicit) ?? (report.targets ?? [])[0] ?? { label: "it" }
				const tried = humanList.map((c) => c.text)
				const what = refused ? refused : g.happened ? String(g.happened).replace(/[.!]+$/, "") : `“${String(g.label).replace(/[.!]+$/, "")}” still doesn’t happen`
				// (the AI's answers that didn't work were not kept, the scene as it was searched instead: what they tried is still said)
				let saidTried = tried
				const dropped = report.edit?.fixFlow?.droppedScene
				if (!tried.length && dropped)
					try {
						saidTried = humanChangeList(request.scene, dropped, { says, text: personText }).map((c) => c.text)
					} catch {}
				// (the list inside the brackets has none of its own: "(I tried: tilted the seesaw more, 12.5° → 20°; and moved the box 5 cm left)", never
				// "(I tried: tilted the seesaw more (12.5° → 20°) and …)": V8838 v38f2)
				const triedW = triedWords(saidTried)
				// (never two colons outside the brackets: "…): the cutting board it added is in the way, and the tennis ball moves only 8 mm")
				const whatW = /: /.test(what) ? what.replace(/: /, ", and ") : what
				// (a typed "make it work" stopped at its budget says so)
				const capped = !!report.edit?.fixFlow?.capped
				const words =
					request.rework === true
						? tried.length
							? `The AI’s rework didn’t work either (it tried: ${triedW}): ${whatW}. Your scene is as it was.`
							: `The AI’s rework didn’t find anything to change that works: ${whatW}. Your scene is as it was.`
						: saidTried.length
							? `I couldn’t make it work${capped ? " within the AI budget for one request" : ""} (I tried: ${triedW}): ${whatW}. Your scene is as it was.`
							: `I couldn’t find anything to change that makes it work${capped ? " within the AI budget for one request" : ""}: ${whatW}. Your scene is as it was.`
				// (a version refused for how it gets there is no idea to try either; nor one that makes the person's things something else, a cardboard
				// box 1 m deep, a pendulum's bob four times as heavy (V8832 y14 / y15): the closest miss goes through the same check as a fix)
				let charWhy = null
				try {
					const ref = isObj(request.reference) && Array.isArray(request.reference.items) ? request.reference : null
					const keepIds = new Set((Array.isArray(request.keep) ? request.keep : []).filter(Array.isArray).map((k) => k[0]))
					const mineBefore = ref ?? { items: request.scene.items.map((i) => (keepIds.has(i.id) ? { ...i, type: `${i.type}#theirs` } : i)) }
					charWhy = characterBreak(request.scene, cur.scene, mineBefore, Array.isArray(request.hard) ? request.hard : null) ?? helperSizeBreak(request.scene, cur.scene)
				} catch {}
				// (its label names every change it makes: "2 changes: move the seesaw and add a cutting board", never the first alone: V8837 y4)
				let near = tried.length && !refused && !charWhy
					? { say: imperative(andList(tried)), did: andList(tried), label: changesLabel(tried), happened: what, sceneJSON: JSON.stringify(cur.scene), planJSON: JSON.stringify(finalPlan), results: (report.targets ?? []).map((t) => ({ label: t.label, ok: t.ok, ...(t.implicit ? { implicit: true } : {}) })) }
					: null
				// (and it is offered only when it is closer than the scene as it is, by the margin the fix search asks of its own closest miss, and
				// closer than a "Try:" the card already offers: V8837 y19 / y4 / x5, a "closest" that was worse than the scene, 5.6 mm against 8.6 mm)
				const earlier = isObj(request.near) && typeof request.near.sceneJSON === "string" ? request.near : null
				if (near)
					try {
						const sim0 = beforeRun ? request.sim : await simulate(request.scene, signal)
						const tg = fixTargets({ goals: G(cur), scene: request.scene, before: { scene: request.scene, sim: sim0 }, sim: sim0 }).filter((t) => goalItems(t.goal).every((id) => cur.scene.items.some((i) => i.id === id)))
						const fOf = (sc, sm) => farness(tg, judgeTargets(tg, sm), sm, sc)
						const f0 = fOf(request.scene, sim0)
						const f1 = fOf(cur.scene, cur.sim)
						let fN = num(earlier?.f)
						if (earlier && fN === null) {
							const ns = JSON.parse(earlier.sceneJSON)
							fN = fOf(ns, await simulate(ns, signal))
						}
						near.f = f1
						if (!tg.length || !(f1 < f0 - 0.15) || (fN !== null && !(f1 < fN - 1e-6))) near = null
					} catch (e) {
						if (e?.name === "AbortError" || signal.aborted) throw e
						near = null
					}
				// (none closer: the "Try:" already offered stays the one offered)
				if (!near && earlier) near = earlier
				replyOnlyReport({ reply: words, suggestions: [] }, "answer")
				if (report.edit) report.edit.kind = "answer"
				// (nothing of it goes on the table: the scene it tried is only the "Try:" chip's)
				delete report.scene
				delete report.sim
				delete report.plan
				report.fix = { state: "none", goal: g.label, checked: null, runs: 0, reworked: true, ...(near ? { near } : {}) }
				report.reworkFailed = true
				return report
			}
			// (a fix that only went on adjusting what the change itself set, "the golf ball 20 cm left" then 1 cm more, is said as one change)
			const fixIds = (report.fixApplied?.changes ?? []).flatMap((c) => (Array.isArray(c.ids) ? c.ids : [c.id]))
			// (only a move of what the person's words moved: a thing they only swapped, moved 1 cm by the fix, is the fix's, said with "so it works"
			// (V8832 m6: "Done — everything still works ✓" over a move nobody asked for))
			const oneChange = report.fixApplied && fixIds.length > 0 && fixIds.every((id) => touched.has(id)) && (report.fixApplied.changes ?? []).every((c) => c.kind !== "move" || (Array.isArray(c.ids) ? c.ids : [c.id]).every((id) => { const w = askedWays(text, request.scene, id); return w.x || w.y }))
			const asked = report.fixApplied && firstV && !oneChange ? order(humanChangeList(request.scene, firstV.scene, { room, says, why: whyMoved(firstV), text: personText, reasons: unasked, anchors: whereSaid, ...masses })) : humanList
			if (report.fixApplied && report.edit) report.edit.noChange = false
			// (a change the scene shows, a rename too, is a change: never "that's already how it is")
			if (report.edit && humanList.length) report.edit.noChange = false
			// (what the one repair turn changed of things the words don't name, to make room: said in the lead when a goal that worked stops, as the
			// reason, "to make room I spaced the dominoes closer together, and now only 5 of the 7 dominoes fall": VERIFY plainmove)
			let roomLines = []
			if (report.edit?.repair?.kept && report.edit.repair.fromScene)
				try {
					const named = namedIn(text, request.scene)
					const was = report.edit.repair.fromScene
					roomLines = humanChangeList(was, cur.scene, { says, text: personText, ...masses }).filter((c) => c.id && !named.has(c.id) && request.scene.items.some((i) => i.id === c.id) && JSON.stringify(request.scene.items.find((i) => i.id === c.id)) === JSON.stringify(was.items.find((i) => i.id === c.id))).map((c) => c.text)
				} catch {}
			// (an unasked part of the change is the lead's reason only for the goal it is about: the box raised, "Ball 2 lands in the box")
			const alsoLines = () => {
				const failing = (report.targets ?? []).filter((t) => t.ok === false)
				const g = failing.find((t) => !t.implicit) ?? failing[0]
				// (never when the goal's own thing doesn't move at all: where its container stands is then no reason (k3: "to clear the orange I also
				// moved the basket 12 cm right, and now … don't move the orange"))
				if (g && /\b(never moves|never move|don['’]t move|doesn['’]t move|never touches|nothing launches)\b/i.test(String(g.happened ?? ""))) return []
				const goal = g ? (G(cur) ?? []).find((x) => isObj(x) && x.label === g.label) : null
				// (the goal's container or target moved: "Ball 2 lands in the box" with the box raised; never the goal's own thing re-seated)
				const refs = new Set(goal ? [goal.container, goal.target].filter(Boolean) : [])
				// (only what it was moved to clear: "to sit on the middle of the cup post" is no reason a goal fails)
				return [...unasked].filter(([id, u]) => refs.has(id) && /^to clear /.test(u.reason)).map(([, u]) => `${u.reason} I also ${u.words}`)
			}
			report.lead = editLead({ changes: asked.map((c) => c.text), targets: report.targets ?? [], noChange: !!report.edit?.noChange && !report.fixApplied, fixApplied: oneChange ? null : report.fixApplied, undid: report.edit?.fixFlow?.undid ?? null, room: roomLines, also: alsoLines(), said: fixKind && pureFix && report.fixApplied && humanList.length ? humanList : null })
			if (report.edit) {
				// a "make it work" that still fails says so (the lead says what happens instead); a plain change gets the heads-up (§14.2 (5)) only
				// for what the lead doesn't already say: stages that worked and no longer do, firm hits that no longer happen
				if (fixKind) report.edit.stillFails = (report.targets ?? []).filter((t) => t.ok === false).map((t) => t.label)
				else if (request.sim?.summary)
					try {
						const rc = beforeRun ? runChanges(request.sim, cur.sim, request.scene, cur.scene, G(cur)) : { contacts: [] }
						// (stages lost, and groups knocked down less: a built-in scene has no plan stages, so its stack of bricks is counted here)
						const lost = [...lostStageList(request.sim, cur.sim, cur.scene), ...lostGroupList(request.sim, cur.sim, request.scene, cur.scene)]
						// (never about the failing goal's own things, which the lead tells about, nor what the change swapped: "Ball 2 no longer moves"
						// for what is now the egg repeated the lead's "the egg never moves")
						const skip = new Set()
						try {
							const tg = fixTargets({ goals: G(cur), scene: cur.scene, before: beforeRun, sim: cur.sim })
							judgeTargets(tg, cur.sim).forEach((r, i) => r.ok === false && tg[i].goal && goalRefs(tg[i].goal).forEach((id) => skip.add(id)))
						} catch {}
						for (const it of cur.scene.items) if (request.scene.items.some((x) => x.id === it.id && x.type !== it.type)) skip.add(it.id)
						// (a line that starts with a thing's name says it as a sentence does: "the seesaw no longer turns", never "Seesaw no longer
						// turns" mid-sentence; a proper name, "Ball 1", stays: V8820)
						report.edit.headsUp = headsUpLines({ lost, contacts: rc.contactList ?? rc.contacts, said: report.lead, targets: report.targets ?? [], skip: [...skip] }).map((l) => clauseName(l, cur.scene))
					} catch {}
			}
		} else report.lead = leadSentence({ mode, title: report.title, changes: humanList.map((c) => c.text), who: humanList.map((c) => c.name), goals: report.goals, noChange: !!report.edit?.noChange, score: report.score })
		report.human = humanList.map((c) => c.text)
		report.planned = typeof editOut?.reply === "string" ? editOut.reply : typeof finalPlan.reply === "string" ? finalPlan.reply : null
		if (concept && report.planned) report.planned = dropPictureSentences(report.planned)
		// (the version on the table is the physics' own (the fix search changed the AI's answer, or aimed it), not what the AI said it planned:
		// its words would contradict the lead ("What I planned: I left the seesaw as it was…" under "I moved the seesaw 23 cm right": V8838
		// v38a s-fix-tennis), so they are not shown; the lines say what was done)
		if (report.edit?.fixFlow?.fixer) report.planned = ""
		// (nor when a size or a move it states isn't what is on the table: "a paper cup (8 cm wide)" over a 26 cm cup, "a 45 cm basket, moved 12 cm
		// right" over a 12 cm basket that stayed (V8842 k3, V8843 s-swap-box-cup))
		else if (mode === "edit" && report.planned && plannedOff(report.planned, report.human ?? [])) report.planned = ""
		report.suggestions = cleanSuggestions(editOut?.suggestions ?? finalPlan.suggestions ?? report.initialPlan?.suggestions)
		report.models = [...new Set(report.calls.map((c) => c.model).filter(Boolean))]
		return report
	}

	/**
	 * The fix search (./fixer.js) for an edit that stopped a goal: on the page's fix workers when there are any (deps.fixPool(): several runs at
	 * once, off the page's thread), each found fix checked once more on the app's own engine (simulate) before it is offered.
	 * ctx: an edit report's fixCtx. -> findFix's answer
	 */
	async function findFix(ctx, { signal, onProgress, budgetMs = FIX_MS, maxRuns, minRuns, hardMs } = {}) {
		let pool = null
		try {
			pool = deps.fixPool?.() ?? null
		} catch {}
		const usePool = !!pool && !pool.broken
		// (a heavy scene's run count and its hard stop go through too: SEARCH_MIN_RUNS, PHYS_FIRST_RUNS)
		return searchFix(ctx, { evaluate: usePool ? pool.evaluate : undefined, simulate, verify: simulate, parallel: usePool ? pool.size : 2, signal, onProgress, budgetMs, ...(maxRuns ? { maxRuns } : {}), ...(num(minRuns) ? { minRuns } : {}), ...(num(hardMs) ? { hardMs } : {}) })
	}
	/** Stage by stage (./fixer.js restageFix): on the fix workers when there are any, each candidate's path read there; checked on the app's engine. */
	async function restage(ctx, { signal, onProgress, budgetMs = RESTAGE_MS } = {}) {
		let pool = null
		try {
			pool = deps.fixPool?.() ?? null
		} catch {}
		const usePool = !!pool && !pool.broken
		const here = async (scene, targets, item, sg) => probeRun(targets, await simulate(scene, sg), scene, item)
		const probe = usePool
			? async (scene, targets, item, sg) => {
					if (!pool.broken)
						try {
							return await pool.probe(scene, targets, item, sg)
						} catch (e) {
							if (e?.name === "AbortError" || sg?.aborted) throw e
						}
					return here(scene, targets, item, sg)
				}
			: here
		return restageFix(ctx, { probe, verify: simulate, parallel: usePool ? pool.size : 2, signal, onProgress, budgetMs })
	}


	/**
	 * After an edit stopped a goal (ai/DESIGN.md §16; the user, 16 Oct: "it broke the whole scene … you need to fix all of these"): a change that
	 * makes it work again, CHECKED IN THE ENGINE, to offer; nothing here is put on the table. At once: (1) the fix search (./fixer.js: small
	 * moves and settings, the new things' fill and spacing as one), and (2) the reasons in words (each part of the change run alone, where the
	 * chain stops now, what strikes what) handed to a background AI rework: the edit step as a "make it work" (kind fix) that keeps every thing
	 * the person asked for and its kind, placed exactly and made to work as a "make it work" request is (the aim, ≤ 2 rounds told how it ran,
	 * the fix search), then run once more on the app's own engine and judged against every goal the scene had, the stages that worked before the
	 * change, and the person's choices. The search's fix wins when it finds one; else the rework's, when it passes. Time-boxed (budgetMs).
	 * ctx: an edit report's fixCtx. job: {text (the change's words), history, plan (the plan on the table), keep (report.edit.touched)}
	 * -> {status: "found", how: "search"|"ai", info (fixInfo's shape, + how / planJSON / changes)} | {status: "none", info (+ why, reworked)}
	 */
	let tippersCache = null
	async function makeItWork(ctx, { signal, onProgress, budgetMs = MAKE_IT_WORK_MS, job = {}, ai = true, physics = true } = {}) {
		if (physics) budgetMs *= TIME_SCALE // (1 in a page; a slow test machine's stretch for the physics search, ./fixer.js TIME_SCALE)
		const t0 = now()
		const until = Date.now() + budgetMs
		const ctl = new AbortController()
		const stop = () => ctl.abort()
		if (signal?.aborted) throw abortError()
		signal?.addEventListener?.("abort", stop, { once: true })
		const timer = setTimeout(stop, budgetMs)
		const ms = () => Math.round(now() - t0)
		let runsS = 0
		let runsR = 0
		let phase = "search"
		let staging = physics
		// (one line while the physics looks: both searches' runs, and "setting each part up again" while that one still runs, never one then the
		// other on every update: V8817)
		const say = (p) => onProgress?.({ ms: ms(), ...p, ...(p.phase === "search" || p.phase === "stage" ? { phase: "search", staging } : {}), runs: runsS + runsR })
		// (the AI's reworks share one allowance of model calls for this edit: AI_CALLS, every call counted when it starts, a stopped one too)
		// (floor: the edit's own call as billed with a warm prompt cache (warmUsd: never the cold cache's one-off write, V8843 rw-cradle: $0.16,
		// and the rework was started and stopped at once), at most AI_FLOOR_MAX; highest: the dearest rework call billed on this scene)
		const aiBudget = { left: num(job.aiCalls) ?? AI_CALLS, started: 0, answered: 0, usd: 0, cap: num(job.aiUsd) ?? AI_USD, floor: Math.min(AI_FLOOR_MAX, num(job.lastUsd) ?? num(ctx.lastUsd) ?? 0), highest: 0, flights: new Map(), onStart: () => ((phase = "ai"), say({ phase: "ai" })) }
		// (the dollars: finished calls as billed, running ones estimated from what they send (its size, never below the last billed call on this
		// scene) and what they have written so far; past AI_USD the youngest running rework is stopped)
		// (a flight: what its calls were billed as they came back (`billed`, from run()'s "ai-cost" event), and while one runs, or before its first
		// starts, at least AI_REWORK_X times the edit's own call, or the dearest rework billed on this scene: a rework's prompt carries its reasons
		// and its thinking isn't streamed, so what it writes says little while it runs (V8842 y5: $0.109 against the edit's $0.051, two side by
		// side came to $0.167))
		const reserve = (inUsd = AI_IN_USD) => Math.max(AI_REWORK_X * aiBudget.floor, aiBudget.highest ?? 0, inUsd)
		const flightUsd = (f) => (f.billed ?? 0) + (f.calling ? Math.max(reserve(f.inUsd), (f.inUsd ?? AI_IN_USD) + (f.tokens ?? 0) * AI_OUT_USD) : f.billed ? 0 : reserve(f.inUsd))
		aiBudget.estimate = () => aiBudget.usd + [...aiBudget.flights.values()].filter((f) => !f.done).reduce((t, f) => t + flightUsd(f), 0)
		// (one more call like the last one fits: the second rework starts only then, never to be stopped half-way through and billed for nothing)
		aiBudget.fitsAnother = (inUsd = AI_IN_USD) => aiBudget.estimate() + reserve(inUsd) <= aiBudget.cap + 1e-9
		const budgetTimer = setInterval(() => {
			const live = [...aiBudget.flights.values()].filter((f) => !f.done && f.calling)
			const est = aiBudget.estimate()
			if (est > aiBudget.cap + 0.002 && live.length) {
				const f = live.sort((a, b) => b.t0 - a.t0)[0]
				f.done = true
				f.capped = true
				aiBudget.capped = true
				f.ctl.abort()
			}
		}, 500)
		let aiCtl = null
		// (a stopped search's own rejection is the caller's, never an unhandled one: V8814 s4)
		const quiet = (p) => (p.catch(() => {}), p)
		// (the searches after a plain edit hold only what is the person's own choice, ctx.hard / ctx.forward, not all the edit set: §16)
		ctx = { ...ctx, relaxed: ctx.hard instanceof Map }
		try {
			// (1) the fix search (small moves and settings; the person's new things' fill, spacing and size; a row grown with what follows it; a
			// stand-in for a lost hit), and (2) stage by stage: the chain's receivers set up again for what reaches them now. Side by side, at once.
			// (physics: false, for tests of the AI's part alone: no search, no stage by stage)
			const none = Promise.resolve({ status: "none", runs: 0 })
			const search = !physics ? none : quiet(
				findFix(ctx, { signal: ctl.signal, budgetMs: Math.min(SEARCH_MS, budgetMs), hardMs: Math.min(SEARCH_HARD_MS, Math.max(0, budgetMs - 15000)), minRuns: SEARCH_MIN_RUNS, maxRuns: SEARCH_RUNS, onProgress: (p) => ((runsS = p.runs ?? runsS), phase === "search" && say({ phase: "search" })) }).catch((e) => {
					if (signal?.aborted) throw e
					return null
				})
			)
			const staged = !physics ? none : quiet(
				restage(ctx, { signal: ctl.signal, budgetMs: Math.min(RESTAGE_MS, budgetMs), onProgress: (p) => ((runsR = p.runs ?? runsR), phase === "search" && say({ phase: "stage" })) }).catch((e) => {
					if (signal?.aborted) throw e
					return null
				})
			)
			staged.then(() => (staging = false), () => (staging = false))
			let searchDone = null
			let stageDone = null
			search.then((fr) => (searchDone = fr), () => {})
			staged.then((fr) => (stageDone = fr), () => {})
			const foundIn = (fr) => fr?.status === "found" || fr?.status === "ok"
			// (3) the AI's reworks, each its own way, side by side: asked only when the physics has found nothing in its first seconds (most fixes
			// are found by then; a rework costs a model call or two), and never when the person's own change puts the goal out of reach (a ball
			// wider than the box: nothing but undoing it would do)
			aiCtl = new AbortController()
			ctl.signal.addEventListener("abort", () => aiCtl.abort(), { once: true })
			const reach = outOfReach(ctx)
			let rework = Promise.resolve(null)
			let diagDone = null
			if (ai && job.text && !reach && aiBudget.left > 0) {
				const diag = quiet(diagnose(ctx, { signal: aiCtl.signal, job }))
				diag.then((x) => (diagDone = x), () => {})
				// (asked once the physics has looked everywhere it can, or has found nothing in AI_AFTER_MS: at 8 s the search was often seconds from
				// its fix, and three calls were started and thrown away: V8818)
				// (a heavy scene's search, still short of its runs then, goes on and the AI waits for it: never started and then thrown away when the
				// search finds the fix after all (V8817 c02: two rework calls aborted at 50 s); with too little time left for a rework after it, the
				// AI isn't asked in the background: the button asks it, in the open)
				// (a rework needs its call (about AI_REWORK_TIME × the edit's own, measured on this scene), its own fix search and the check: with less
				// time left it isn't started in the background, the button asks it: V8842 k3 / n5 / c02, cut off at the minute with its cost spent)
				const needMs = reworkNeedMs(ctx.lastMs)
				const gate = quiet(
					(async () => {
						await Promise.race([Promise.all([search, staged]), sleep(Math.min(AI_AFTER_MS, Math.max(0, budgetMs - 25000)), aiCtl.signal)])
						if (!searchDone && runsS < SEARCH_MIN_RUNS) await Promise.race([search, sleep(Math.max(0, until - Date.now() - needMs), aiCtl.signal)])
						if (foundIn(searchDone) || foundIn(stageDone) || aiCtl.signal.aborted) throw abortError()
						if (until - Date.now() < needMs) throw abortError()
					})()
				)
				// (every rework, the first too, starts only when its call still fits AI_USD beside the ones running (never one started and stopped at once:
				// V8843 rw-cradle); a second one waits for the first to be billed when it doesn't yet fit; else it isn't asked: V8837 k3, V8842 y5)
				const roomFor = async (k) => {
					if (k > 0) await sleep(300, aiCtl.signal)
					while (!aiBudget.fitsAnother()) {
						if (k === 0 || ![...aiBudget.flights.values()].some((f) => !f.done)) return false
						await sleep(400, aiCtl.signal)
					}
					return until - Date.now() >= needMs
				}
				const tries = Array.from({ length: REWORKS }, (_, k) =>
					Promise.all([diag, gate])
						.then(async ([d]) => ((await roomFor(k)) ? reworkInBackground(ctx, { signal: aiCtl.signal, job, until, onProgress: (p) => ((phase = "ai"), say(p)), diag: d, variant: k, aiBudget }) : { skipped: true, capped: true }))
						.catch((e) => (e?.name === "AbortError" ? { aborted: true } : { error: String(e?.message ?? e) }))
				)
				// (every rework that passes is a candidate; the one that changes least is offered: the first to pass waits a little for the others)
				rework = new Promise((resolve) => {
					let left = tries.length
					let last = null
					const passed = []
					let grace = null
					const finish = () => {
						clearTimeout(grace)
						if (passed.length) resolve({ found: passed.sort((a, b) => (a.found.changes?.length ?? 9) - (b.found.changes?.length ?? 9))[0].found })
						else resolve(last)
					}
					for (const p of tries)
						p.then((r) => {
							if (r?.found) {
								passed.push(r)
								if (passed.length === 1 && left > 1) grace = setTimeout(finish, Math.max(0, Math.min(12000, until - Date.now() - 2000)))
							} else if (r && !r.aborted) last = last?.why ? last : r
							if (--left === 0) finish()
						})
				})
			}
			// the physics first: the search's fix (the smallest change) when it finds one; stage by stage when that finds one first (the search given
			// a few seconds more to find a smaller one); else the AI's
			const first = await Promise.race([search.then((fr) => ({ by: "search", fr })), staged.then((fr) => ({ by: "stage", fr }))])
			if (signal?.aborted) throw abortError()
			let fr = null
			let how = "search"
			if (first.by === "search" && foundIn(first.fr)) fr = first.fr
			else if (first.by === "stage" && first.fr?.status === "found") {
				const s2 = await Promise.race([search, sleep(4000, ctl.signal).then(() => null, () => null)])
				if (s2?.status === "found" || s2?.status === "ok") fr = s2
				else ((fr = first.fr), (how = "stage"))
			} else {
				const other = first.by === "search" ? await staged : await search
				if (signal?.aborted) throw abortError()
				const theSearch = first.by === "search" ? first.fr : other
				const theStage = first.by === "search" ? other : first.fr
				if (foundIn(theSearch)) fr = theSearch
				else if (theStage?.status === "found") ((fr = theStage), (how = "stage"))
				else if (theStage?.status === "ok") fr = theStage
			}
			if (fr?.status === "ok") {
				aiCtl.abort()
				return { status: "ok", info: null, aiCalls: aiBudget.started }
			}
			if (fr?.status === "found") {
				aiCtl.abort()
				return { status: "found", how, aiCalls: aiBudget.started, info: { ...fixInfo(fr, ctx.scene, fr.targets), how, runs: runsS + runsR, ms: ms() } }
			}
			// (the line says the AI is asked only when a call has really started: the gate may have let none start)
			if (!reach && aiBudget.started > 0) ((phase = "ai"), say({ phase: "ai" }))
			const rw = await rework
			if (signal?.aborted) throw abortError()
			if (rw?.found) return { status: "found", how: "ai", aiCalls: aiBudget.started, info: { ...rw.found, runs: runsS + runsR + (rw.found.runs ?? 0), ms: ms() } }
			// nothing works (or the time ran out): said honestly, with the reasons the run shows; the button asks the AI again, in the open
			const sfr = searchDone ?? (await search.catch(() => null))
			const base = sfr ? fixInfo(sfr, ctx.scene, sfr.targets) : fixInfo({ status: "none", runs: runsS }, ctx.scene, ctx.targets ?? null)
			base.runs = runsS + runsR
			// (out of reach: no "closest miss" either, nothing near it works)
			if (reach) delete base.near
			// (the reasons, for the button's rework: the ones already worked out, else worked out now held to a few seconds, never past the minute by
			// one engine run per part with no stop (V8843 c02: 64.7 s and 78.4 s))
			let d = rw?.diag ?? diagDone
			if (!d) {
				const dc = new AbortController()
				const onOut = () => dc.abort()
				signal?.addEventListener?.("abort", onOut, { once: true })
				const dt = setTimeout(onOut, Math.max(500, Math.min(4000, until - Date.now())))
				try {
					d = await diagnose(ctx, { signal: dc.signal })
				} catch {
					d = null
				} finally {
					clearTimeout(dt)
					signal?.removeEventListener?.("abort", onOut)
				}
				if (signal?.aborted) throw abortError()
			}
			// (a rework that started and was cut off at the minute with no answer: said as such, never "and the AI's reworks")
			const late = aiBudget.started > 0 && !aiBudget.answered && ctl.signal.aborted && !signal?.aborted
			let rq = null
			try {
				const q = reworkRequest(ctx, d ?? { lines: [] })
				rq = { text: q.text, keep: q.keep, removedTypes: q.removedTypes, feedback: q.feedback }
			} catch {}
			return {
				status: "none",
				aiCalls: aiBudget.started,
				info: { ...base, why: reach ?? d?.why ?? null, ...(reach ? { outOfReach: true } : {}), reworked: aiBudget.started > 0 && !!(rw && !rw.skipped && !rw.aborted && !rw.error), ...(aiBudget.started ? { aiCalls: aiBudget.started, aiAnswered: aiBudget.answered ?? 0, ...(late ? { reworkLate: true } : {}), ...(aiBudget.capped && !aiBudget.answered ? { reworkCapped: true } : {}) } : {}), timedOut: ctl.signal.aborted && !signal?.aborted, ...(rw?.tried ? { tried: rw.tried } : {}), ...(rq && !reach ? { rework: rq } : {}), ms: ms() }
			}
		} finally {
			clearTimeout(timer)
			clearInterval(budgetTimer)
			aiCtl?.abort()
			ctl.abort()
			signal?.removeEventListener?.("abort", stop)
		}
	}
	/**
	 * When the person's own change puts a goal out of reach whatever else changes, in words (the AI is not asked: only undoing their change would
	 * do): a thing wider than the container's opening it must land in ("the bowling ball (22 cm across) is wider than the box's 4 cm opening").
	 * Else null.
	 */
	function outOfReach(ctx) {
		return reachOf(ctx)?.words ?? null
	}
	/** outOfReach's finding: {words, label (the goal's), item, container} or null. Any loose thing, not only a ball (V8817 h4: a 5 kg steel
	 *  cube 8.6 cm across and an 8 cm box with a 5.6 cm opening took 237 runs, 3 reworks and $0.26 to find out): its narrowest width across. */
	function reachOf(ctx) {
		const { scene, sim, before } = ctx
		const targets = ctx.targets ?? fixTargets({ goals: ctx.goals, scene, before, sim })
		const res = judgeTargets(targets, sim)
		// (only when both are the person's: the thing they swapped in or sized, and the container they sized or swapped. "Make the box 5 cm wide"
		// alone leaves the ball free to be made smaller: V8814 s6 / s9)
		const was = new Map((before?.scene?.items ?? []).map((i) => [i.id, i]))
		const theirs = (it, keys) => !was.has(it.id) || was.get(it.id).type !== it.type || keys.some((k) => ctx.hard?.get?.(it.id)?.has?.(k))
		for (const [i, t] of targets.entries()) {
			if (res[i]?.ok !== false || goalKindOf(t.goal) !== "in" || !t.goal.container) continue
			const it = scene.items.find((x) => x.id === t.goal.item)
			const box = scene.items.find((x) => x.id === t.goal.container)
			if (!it || !box || !theirs(it, ["diameter", "radius", "size", "width", "height", "length", "mass"]) || !theirs(box, ["width", "wall", "thickness"])) continue
			const w = narrowest(sim, it.id)
			const C = (() => {
				const P = { ...(isObj(sim?.resolved?.[box.id]) ? sim.resolved[box.id] : {}), ...(box.props ?? {}) }
				const bw = num(P.width)
				const th = num(P.thickness) ?? 0.012
				return bw ? bw - 2 * th : null
			})()
			const bare = (x) => theName(x).replace(/ \([^)]*\)/g, "")
			if (w > 0 && C !== null && w >= C - 0.001) return { words: `${bare(it)} (${fmtLen(w)} across) can’t fit ${bare(box)}’s ${fmtLen(Math.max(0, C))} opening`, label: t.label, item: it.id, container: box.id }
		}
		return null
	}
	/** How narrow a loose thing can be turned to go through an opening: a ball its diameter; a block its smaller side; an outline its least
	 *  width over every turn (each moving part's; the widest of those). 0 when it can't be told. */
	function narrowest(sim, id) {
		let w = 0
		for (const so of sim?.doc?.solids ?? []) {
			if (so.item !== id || so.kind !== "dynamic") continue
			const b = so.body ?? {}
			let v = 0
			if (b.kind === "ball") v = 2 * (num(b.radius) ?? 0)
			else if (b.kind === "slab") v = Math.min(num(b.width) ?? 0, num(b.height) ?? 0)
			else if (b.kind === "polygon" && Array.isArray(b.points) && b.points.length > 2) {
				v = Infinity
				for (let a = 0; a < Math.PI; a += Math.PI / 36) {
					const xs = b.points.map((p) => p.x * Math.cos(a) - p.y * Math.sin(a))
					v = Math.min(v, Math.max(...xs) - Math.min(...xs))
				}
			}
			if (Number.isFinite(v)) w = Math.max(w, v)
		}
		return w
	}

	/** The things of a change, each alone: [{label, ids, apply(before scene) -> scene}] (a swap; what was added of one kind, with what it took the
	 *  place of; what was taken away; a thing moved or reset), at most 6. */
	function editParts(a, b) {
		const A = new Map(a.items.map((i) => [i.id, i]))
		const Bm = new Map(b.items.map((i) => [i.id, i]))
		const parts = []
		const real = (it) => it.type !== "table" && !isSafetyWall(it)
		const addedKinds = new Set(b.items.filter((i) => !A.has(i.id)).map((i) => i.type))
		const joined = [] // (a thing swapped into a kind that was also added, "the dominoes" made the first soda can: part of that group)
		for (const it of b.items) {
			const w = A.get(it.id)
			if (!w || !real(it)) continue
			if (w.type !== it.type && addedKinds.has(it.type)) joined.push(it)
			else if (w.type !== it.type) parts.push({ label: `the ${kindNoun(it.type)} in place of ${theName(w)}`, ids: [it.id], swap: [it.id] })
			else if (JSON.stringify(w) !== JSON.stringify(it)) parts.push({ label: theName(it), ids: [it.id], swap: [it.id] })
		}
		let insA = null
		let insB = null
		try {
			insA = inspect(a)
			insB = inspect(b)
		} catch {}
		const added = [...joined, ...b.items.filter((i) => !A.has(i.id) && real(i))]
		const removed = [...joined.map((i) => A.get(i.id)), ...a.items.filter((i) => !Bm.has(i.id) && real(i))]
		const byType = new Map()
		for (const it of added) byType.set(it.type, [...(byType.get(it.type) ?? []), it])
		const used = new Set()
		for (const [type, list] of byType) {
			// (what it took the place of: a removed thing whose span it overlaps)
			const span = (ins, l) => {
				const bs = l.map((i) => ins?.box?.(i.id)).filter(Boolean)
				return bs.length ? { x0: Math.min(...bs.map((q) => q.x0)), x1: Math.max(...bs.map((q) => q.x1)) } : null
			}
			const sb = span(insB, list)
			const took = removed.filter((r) => {
				const sa = span(insA, [r])
				return sb && sa && Math.min(sa.x1, sb.x1) - Math.max(sa.x0, sb.x0) > 0.4 * Math.min(sa.x1 - sa.x0, sb.x1 - sb.x0)
			})
			took.forEach((r) => used.add(r.id))
			const n = list.length
			parts.push({ label: `${n > 1 ? `the ${n} ${kindNoun(type, n)}` : `the ${kindNoun(type)}`}${took.length ? ` in place of ${andList([...new Set(took.map(theName))])}` : ""}`, ids: list.map((i) => i.id), add: list.map((i) => i.id), remove: took.map((r) => r.id) })
		}
		const rest = removed.filter((r) => !used.has(r.id))
		if (rest.length) parts.push({ label: `without ${andList(rest.map(theName))}`, ids: rest.map((r) => r.id), remove: rest.map((r) => r.id) })
		for (const p of parts)
			p.apply = (sc) => {
				const s = clone(sc)
				s.items = s.items.filter((i) => !(p.remove ?? []).includes(i.id) && !(p.add ?? []).includes(i.id)).map((i) => ((p.swap ?? []).includes(i.id) ? clone(Bm.get(i.id)) : i))
				for (const id of p.add ?? []) s.items.push(clone(Bm.get(id)))
				return s
			}
		return parts.slice(0, 6)
	}

	/**
	 * Why a change stopped a goal, from runs (never a guess): what happens instead; each part of the change alone (D1, 16 Oct: the soda cans
	 * alone stop the chain, the egg alone flies 7 cm too low); where the chain stops and what strikes what, now and before; a row's fill flipped
	 * once (empty cans are shoved along and hit the seesaw at 1.3 m/s: it turns 1°). -> {text (for the AI), why (one line for the card), facts}
	 */
	async function diagnose(ctx, { signal, searched = null, job = {} } = {}) {
		const { scene, sim, before } = ctx
		const targets = ctx.targets ?? fixTargets({ goals: ctx.goals, scene, before, sim })
		const res = judgeTargets(targets, sim)
		const failing = targets.map((t, i) => ({ t, r: res[i] })).filter((x) => x.r.ok === false)
		const facts = []
		const lines = []
		const plainL = (l) => String(l).replace(/[.!]+$/, "")
		const words0 = failing.map((f) => safeWords(f.r, f.t.goal, sim, scene, before)).filter(Boolean)
		for (const [i, f] of failing.slice(0, 3).entries()) lines.push(`- In the run now: “${plainL(f.t.label)}” FAILS${words0[i] ? `: ${words0[i]}` : ""}.`)
		// each part of the change alone, on the scene before it
		const partWords = []
		if (before?.scene && before?.sim)
			for (const p of editParts(before.scene, scene)) {
				if (signal?.aborted) throw abortError()
				let run
				let ps
				try {
					ps = p.apply(before.scene)
					run = await simulate(ps, signal)
				} catch (e) {
					if (e?.name === "AbortError" || signal?.aborted) throw e
					continue
				}
				const there = targets.filter((t) => goalItems(t.goal).every((id) => ps.items.some((i) => i.id === id)))
				const rs = judgeTargets(there, run)
				const bad = there.map((t, i) => ({ t, r: rs[i] })).filter((x) => x.r.ok === false)
				const w = bad.length ? safeWords(bad[0].r, bad[0].t.goal, run, ps, before) : null
				partWords.push({ part: p, ok: !bad.length, words: w })
				// (a row of the person's things that is never tipped over: once more with its fill the other way, where its kind has one)
				const kinds = [...new Set((p.add ?? []).map((id) => scene.items.find((i) => i.id === id)?.type))]
				if (bad.length && kinds.length === 1 && (p.add ?? []).length > 1 && propSpec(kinds[0], "full")) {
					const full = propValue(scene.items.find((i) => i.id === p.add[0]), "full")
					if (typeof full === "boolean") {
						const flipped = { ...ps, items: ps.items.map((i) => (p.add.includes(i.id) ? { ...i, props: { ...(i.props ?? {}), full: !full } } : i)) }
						try {
							const r2 = await simulate(flipped, signal)
							const rs2 = judgeTargets(there, r2)
							const bad2 = there.map((t, i) => ({ t, r: rs2[i] })).filter((x) => x.r.ok === false)
							const w2 = bad2.length ? safeWords(bad2[0].r, bad2[0].t.goal, r2, flipped, before) : null
							facts.push(`${cap(full ? "emptied" : "filled")} (${fmtMass(weightOf(kinds[0], { full: !full }) ?? 0)} each), ${p.label} ${bad2.length ? `still don't work: ${w2 ?? "the goal still fails"}` : "work"}.`)
						} catch (e) {
							if (e?.name === "AbortError" || signal?.aborted) throw e
						}
					}
				}
			}
		if (partWords.length > 1) lines.push(`- Each part of the change alone, on the scene before it: ${partWords.map((x) => `${x.part.label} ${x.ok ? "✓ works" : `✗ (${x.words ?? "the goal fails"})`}`).join("; ")}.`)
		// what strikes the first thing that does less than before, then and now (heavier, faster hits are what turn it)
		const strikes = (run, sc, id) => {
			const of = new Map((run?.doc?.solids ?? []).map((x) => [x.id, x]))
			const hs = (run?.track?.impacts ?? [])
				.map((h) => ({ t: h.t, speed: h.speed ?? 0, a: of.get(h.a), b: of.get(h.b) }))
				.filter((h) => h.a && h.b && h.a.item !== h.b.item && (h.a.item === id || h.b.item === id))
				.map((h) => ({ ...h, by: h.a.item === id ? h.b : h.a }))
				.filter((h) => !["table", "wall"].includes(sc.items.find((i) => i.id === h.by.item)?.type) && h.speed >= 0.1)
			const h = hs.sort((p, q) => q.speed - p.speed)[0]
			if (!h) return null
			const m = solidMass(run.doc, h.by)
			const who = sc.items.find((i) => i.id === h.by.item)
			return `${who ? nameOfItem(who) : h.by.item}${m ? ` (the part that hits weighs ${fmtMass(m)})` : ""} at ${trimNum(h.speed, 2)} m/s`
		}
		// (what threw the goal's thing before the change, and what struck that, how hard: "Before the change, Dominoes (the part that hits
		// weighs 1.3 kg) struck the seesaw at 0.65 m/s, and it threw Ball 2 (6.3 g) into the box")
		if (before?.sim && failing.length) {
			const g = failing.find((f) => !f.t.implicit)?.t.goal ?? failing[0].t.goal
			const item = goalItems(g)[0]
			const of = new Map((before.sim.doc?.solids ?? []).map((x) => [x.id, x]))
			const firstHit = (id) =>
				(before.sim.track?.impacts ?? [])
					.map((h) => ({ t: h.t, speed: h.speed ?? 0, a: of.get(h.a), b: of.get(h.b) }))
					.filter((h) => h.a && h.b && h.a.item !== h.b.item && (h.a.item === id || h.b.item === id))
					.map((h) => ({ ...h, by: h.a.item === id ? h.b : h.a }))
					.filter((h) => !["table", "wall"].includes(before.scene.items.find((i) => i.id === h.by.item)?.type) && h.by.item !== g.container && h.speed >= 0.1)
					.sort((p, q) => p.t - q.t)[0] ?? null
			const launch = item ? firstHit(item) : null
			const L = launch ? before.scene.items.find((i) => i.id === launch.by.item) : null
			const drive = L ? firstHit(L.id) : null
			const D = drive ? before.scene.items.find((i) => i.id === drive.by.item) : null
			const I = before.scene.items.find((i) => i.id === item)
			if (L && D && I && scene.items.some((i) => i.id === L.id)) {
				const m = solidMass(before.sim.doc, drive.by)
				const mi = massOf(I.type, I.props)
				facts.push(`Before the change, ${theName(D)}${m ? ` (the part that hits weighs ${fmtMass(m)})` : ""} struck ${theName(L)} at ${trimNum(drive.speed, 2)} m/s, and ${theName(L)} threw ${theName(I)}${mi ? ` (${fmtMass(mi)})` : ""} where it had to go. ${cap(theName(L))} needs a hit at least that hard${scene.items.find((i) => i.id === item)?.type !== I.type ? `, harder for a heavier ${kindNoun(scene.items.find((i) => i.id === item).type)}` : ""}.`)
			}
		}
		const stop = before?.sim ? chainStop(sim, scene, before, failing.flatMap((f) => goalRefs(f.t.goal))) : null
		if (stop?.ids?.length === 1 && before?.sim) {
			const id = stop.ids[0]
			const now0 = strikes(sim, scene, id)
			const was0 = strikes(before.sim, before.scene, id)
			const it = scene.items.find((i) => i.id === id)
			if (was0) facts.push(`Before the change, ${was0} struck ${theName(it)}${now0 ? `; now ${now0}` : "; now nothing does"}. ${cap(theName(it))} needs a hit like before to work: the new things alone are far too light or slow for it.`)
		}
		// a swapped thing much heavier or lighter than what it replaced
		for (const it of scene.items) {
			const w = before?.scene?.items?.find((i) => i.id === it.id)
			if (!w || w.type === it.type) continue
			const ma = massOf(w.type, w.props)
			const mb = massOf(it.type, it.props)
			if (ma && mb && (mb / ma > 2 || ma / mb > 2)) facts.push(`${cap(kindNoun(it.type))} weighs ${mb > ma ? `${trimNum(mb / ma, 1)}×` : `1/${trimNum(ma / mb, 1)} of`} what ${theName(w)} did (${fmtMass(ma)} → ${fmtMass(mb)}).`)
		}
		if (facts.length) lines.push(...facts.map((f) => `- ${f}`))
		if (searched) lines.push(`- The app's fix search tried ${searched} small changes in the physics (moves, tilts, settings, the new things' fill and spacing): none works.`)
		// what the card says when nothing works: the run's own words, and a part that fails on its own
		const failedParts = partWords.filter((x) => !x.ok)
		const why = words0[0] ? `${words0[0]}${failedParts.length > 1 ? `; and on its own, ${failedParts.filter((x) => x.words && x.words !== words0[0]).slice(0, 1).map((x) => `with ${x.part.label}, ${x.words}`).join("")}` : ""}` : null
		return { lines, why: why ? why.replace(/; and on its own, $/, "") : null, facts, failing: failing.map((f) => f.t.label), parts: partWords.map((x) => ({ label: x.part.label, ok: x.ok, words: x.words })) }
	}

	/** Things of the catalog that make a hard hit from a light push (./fixer.js tippers): "a closed laptop (1.24 kg, 30 cm tall and 1.1 cm thin
	 *  on its edge: angle_deg 90)". */
	function tippers() {
		if (tippersCache) return tippersCache
		return (tippersCache = fixerTippers().map((x) => ({ ...x, words: `${aKindOf(x.type)} (${fmtMass(x.kg)}, ${fmtLen(x.h)} tall and ${fmtLen(x.w)} thin${x.angle ? " on its edge: angle_deg 90" : ""})` })))
	}
	/**
	 * (2) The background rework: the edit step asked to make it work, told the reasons, keeping the person's things; made to work as a "make it
	 * work" request is (run()), then checked here on the app's own engine. -> {found: info} | {why, tried} | {skipped: true}
	 */
	async function reworkInBackground(ctx, { signal, job, until, onProgress, diag = null, variant = 0, aiBudget = null }) {
		const { scene, sim, before } = ctx
		const targets = ctx.targets ?? fixTargets({ goals: ctx.goals, scene, before, sim })
		const failing = judgeTargets(targets, sim)
			.map((r, i) => ({ r, t: targets[i] }))
			.filter((x) => x.r.ok === false)
		if (!failing.length) return { skipped: true }
		const d = diag ?? (await diagnose(ctx, { signal, job }))
		if (signal?.aborted) throw abortError()
		// (no call left of this edit's allowance: not asked)
		if (aiBudget && aiBudget.left <= 0) return { skipped: true }
		const way = REWORK_ORDER[variant % REWORK_ORDER.length]
		const { text, feedback, keep, removedTypes, mine, hard } = reworkRequest(ctx, d, way)
		// (two ways side by side find more than one way asked twice; each answers once, with no repair turn after it: at most AI_CALLS calls in
		// all, counted across both: V8818, 16 Oct, $0.20–0.49 for one unfixable edit; and at most AI_USD dollars: its own stop for that)
		const own = new AbortController()
		const onAbort = () => own.abort()
		signal?.addEventListener?.("abort", onAbort, { once: true })
		// (the shared allowance is the same object: its counts and dollars are kept across both reworks)
		const req = { text, mode: "edit", images: [], scene, sim, plan: job.plan ?? null, planScene: job.plan ? scene : null, history: Array.isArray(job.history) ? job.history.slice(-20) : [], keep, hard, rework: true, background: true, feedback, removedTypes, deadline: until, maxRounds: 0, ...(aiBudget ? { aiBudget } : {}) }
		// (its input counted from what it sends: the scene, its plan, the conversation, the reasons)
		let chars = 0
		try {
			chars = JSON.stringify({ text, scene, plan: job.plan ?? null, history: req.history, feedback }).length
		} catch {}
		const flight = { ctl: own, tokens: 0, t0: Date.now(), done: false, calling: false, inUsd: inputUsd(chars) }
		aiBudget?.flights?.set(variant, flight)
		const costOf = (r) => (r?.calls ?? []).reduce((t, c) => t + (num(c?.usage?.costInUSD) ?? 0), 0)
		let rep
		try {
			rep = await run(req, {
				onEvent: (e) => {
					if (e?.type === "ai-progress" && num(e.tokens) !== null) flight.tokens = e.tokens
					// (a call billed: counted at once, never only when the rework's own fix search is done too)
					if (e?.type === "ai-cost" && num(e.usd) !== null && aiBudget) {
						flight.billed = (flight.billed ?? 0) + e.usd
						aiBudget.highest = Math.max(aiBudget.highest ?? 0, e.usd)
						// (a rework call that came back: only those are "the AI's reworks" on the card, never one stopped half-way: V8843 rw-cradle)
						if (!flight.answered) ((flight.answered = true), (aiBudget.answered = (aiBudget.answered ?? 0) + 1))
					}
					if (e?.type === "step" && e.step === "edit" && e.state === "active") flight.calling = true
					if (e?.type === "step" && e.step === "edit" && e.state !== "active") flight.calling = false
					return e?.type === "step" && e.state === "active" && e.step !== "edit" ? onProgress?.({ phase: e.step === "fix" ? "ai-fix" : "ai-check" }) : null
				},
				signal: own.signal
			})
		} catch (e) {
			// (stopped: what was billed already is counted, and a call stopped while it ran at its estimate)
			if (aiBudget) aiBudget.usd += (flight.billed ?? 0) + (flight.calling ? Math.max(aiBudget.floor ?? 0, flight.inUsd + flight.tokens * AI_OUT_USD) : 0)
			flight.done = true
			if (flight.capped && !signal?.aborted) return { skipped: true, capped: true }
			throw e
		} finally {
			signal?.removeEventListener?.("abort", onAbort)
		}
		flight.done = true
		flight.calling = false
		if (aiBudget) {
			const billed = costOf(rep)
			aiBudget.usd += billed
			// (the last billed call on this scene is the floor of the next one's estimate)
			if (billed > 0) aiBudget.highest = Math.max(aiBudget.highest ?? 0, billed)
			if (billed > 0 && !flight.answered) ((flight.answered = true), (aiBudget.answered = (aiBudget.answered ?? 0) + 1))
		}
		if (signal?.aborted) throw abortError()
		onProgress?.({ phase: "ai-check" })
		const verdict = await judgeRework(ctx, rep, { signal, mine, removedTypes, targets, hard })
		if (!verdict.ok) {
			job.onTried?.({ scene: rep.scene, plan: rep.plan, why: verdict.why, fixFlow: rep.edit?.fixFlow ?? null })
			return { why: d.why, tried: verdict.why, diag: d }
		}
		return { found: offerOf(ctx, rep, verdict, failing) }
	}
	/** The ways the AI's reworks try, one each, side by side (the user's follow-up, 16 Oct: "several AI reworks in parallel with different
	 *  strategies"): the person's new things set otherwise; the chain's parts set up again for what reaches them now; one helper. */
	const REWORK_WAYS = [
		"This answer's way: change only how the person's new things are set (their fill, size, spacing, where each stands along the table) and the things right next to them; add nothing.",
		"This answer's way: set the chain up again for what reaches each part now. Move the parts that catch, bounce or launch (the next pad, ramp, seesaw, container) along the table to where things now arrive, or give them more room (the table may be made wider); add nothing.",
		"This answer's way: add the fewest helpers from the catalog: a heavier, taller thing the chain tips onto the part that needs a harder hit, or a higher start for more speed, and move what must make room for it."
	]
	// (the two the AI tries: helpers first (what the physics search tries least), then the person's new things set otherwise; stage by stage
	// already sets the chain's receivers up again in the physics)
	const REWORK_ORDER = [2, 0]
	/** The rework's request: its words, the reasons (the diagnosis), what it keeps (each thing the person's change added or swapped in, by its
	 *  kind, and every setting and place their words gave: ctx.hard) and what never comes back (the kinds it took away). The same request goes
	 *  with the "Ask the AI to rework it" button. */
	function reworkRequest(ctx, d, variant = null) {
		const { scene, sim, before } = ctx
		const targets = ctx.targets ?? fixTargets({ goals: ctx.goals, scene, before, sim })
		const failing = judgeTargets(targets, sim)
			.map((r, i) => ({ r, t: targets[i] }))
			.filter((x) => x.r.ok === false)
		// what the person chose: the things their change added or swapped in (each keeps its kind); what it took away never comes back
		const B0 = new Map((before?.scene?.items ?? []).map((i) => [i.id, i]))
		const mine = before?.scene ? scene.items.filter((i) => i.type !== "table" && !isSafetyWall(i) && (!B0.has(i.id) || B0.get(i.id).type !== i.type)) : []
		const removedTypes = [...new Set((before?.scene?.items ?? []).filter((i) => !scene.items.some((x) => x.id === i.id)).map((i) => i.type))].filter((t) => !mine.some((m) => m.type === t))
		const groups = new Map()
		for (const it of mine) groups.set(it.type, [...(groups.get(it.type) ?? []), it])
		const keepWords = [...groups.values()].map((l) => (l.length > 1 ? `the ${l.length} ${kindNoun(l[0].type, l.length)}` : `the ${kindNoun(l[0].type)}`))
		// (and every setting and place the person's words gave: "the box 5 cm wide", the row's count; c02 / e5, 16 Oct: a rework put the giant
		// domino back and made the 5 cm box 30 cm wide, and was offered as a fix)
		const hardMap = ctx.hard instanceof Map ? ctx.hard : new Map()
		const hardIds = [...hardMap.keys()].filter((id) => scene.items.some((i) => i.id === id))
		const setWords = []
		for (const id of hardIds) {
			const it = scene.items.find((i) => i.id === id)
			for (const k of hardMap.get(id)) {
				const way = /^(\w+):(up|down)(?::(\w+))?$/.exec(k)
				if (way) {
					// (a word they gave it: "the steel weight heavy (at least its 1 kg)")
					const v = way[1] === "mass" ? massOf(it.type, it.props ?? {}) : num(propValue(it, way[1]))
					if (v !== null && v !== undefined) setWords.push(`${theName(it)} ${way[3] ?? (way[2] === "up" ? "big" : "small")} (${way[2] === "up" ? "at least" : "at most"} its ${way[1] === "mass" ? fmtMass(v) : fmtLen(v)})`)
				} else if (/^place/.test(k)) setWords.push(`${theName(it)} where it stands`)
				else {
					const v = propValue(it, k)
					const sp = propSpec(it.type, k)
					setWords.push(`${theName(it)}'s ${lc(sp?.label ?? k)} at ${typeof v === "number" ? (sp?.unit === "m" ? fmtLen(v) : `${sig(v)}${sp?.unit && sp.unit !== "m" ? ` ${sp.unit}` : ""}`) : String(v)}`)
				}
			}
		}
		const goal = failing.find((x) => !x.t.implicit) ?? failing[0] ?? { t: targets[0] ?? { label: "it works again" } }
		const goalWords = inClause(goal.t.label)
		const text = `Make it work again so that ${goalWords}${keepWords.length ? `, keeping ${andList(keepWords)}` : ""}. Say what you changed.`
		const removedWords = removedTypes.map((t) => kindNoun(t, 2, { short: true }))
		const feedback = [
			"# Why it doesn't work now (the app ran these in the physics engine)",
			...d.lines,
			"# What a fix must do",
			`Make “${String(goal.t.label).replace(/[.!]+$/, "")}” happen again${targets.length > 1 ? ", with every other goal still met" : ""}. Keep ${keepWords.length ? andList(keepWords) : "what the person changed"} (each stays its kind and how many there are${removedWords.length ? `; never bring back ${andList(removedWords)}` : ""})${setWords.length ? `, and keep ${andList(setWords)}: the person set those` : ""}. Things the person added stay where they put them, give or take a few centimetres. You may change how the new things are set (fill, size, spacing), move or retune anything else, and add the fewest new things the run needs: a hit that is too weak needs something heavier that the chain knocks or tips onto it (tall and thin, so a light push tips it over${tippers().length ? `: ${andList(tippers().map((x) => x.words), "or")}` : ""}), or more speed from higher up; a thing that falls short needs a stronger launch or its target nearer. The machine must set everything off itself: nothing new held and let go on the clock, and the release time stays. Say each change in the reply. Give set_tune knobs (with ranges) on what you change.`,
			...(variant !== null && REWORK_WAYS[variant % REWORK_WAYS.length] ? [REWORK_WAYS[variant % REWORK_WAYS.length]] : [])
		].join("\n")
		const keepMap = new Map(mine.map((i) => [i.id, new Set()]))
		for (const id of hardIds) for (const k of hardMap.get(id)) (keepMap.get(id) ?? keepMap.set(id, new Set()).get(id)).add(k)
		return { text, feedback, keep: [...keepMap].map(([id, ks]) => [id, [...ks]]), removedTypes, mine, hard: hardIds.map((id) => [id, [...hardMap.get(id)]]) }
	}
	/** A rework that passed, as the offer: what it changes from the scene on the table now, grouped, in the person's words and real units, every
	 *  change said (never "and 1 more change": a closed laptop or a wider table is never added unseen, c11 / s3, 16 Oct), what it adds first. */
	function offerOf(ctx, rep, verdict, failing) {
		const { scene } = ctx
		const goal = failing.find((x) => !x.t.implicit) ?? failing[0]
		const all = humanChangeList(scene, rep.scene, {})
		// (what it adds first, then what it changes, the table last)
		const rank = (c) => (/^(added|stood|replaced)\b/.test(c.text) ? 0 : /\b(widened|narrowed) the table\b/.test(c.text) ? 2 : 1)
		const lines = all
			.map((c, i) => ({ c, i }))
			.sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
			.map((x) => x.c.text)
		const did = andList(lines)
		const tg = verdict.targets
		const explicit = tg.filter((t) => !t.implicit)
		const checked = claimLabel(String((explicit.length > 1 ? `${allN(explicit.length)} goals` : (explicit[0] ?? tg[0])?.label) ?? "it works"), rep.scene).replace(/[.!]+$/, "")
		// (the chip names the main change: what it adds, else the first change, never "(+3)")
		const main = lines[0] ?? "make it work"
		// (three changes or more: the chip says how many, never one of them standing for all: V8820 c01, "Move the box 1 cm down" for six)
		const label = clipLabel(lines.length >= 3 ? `Make ${lines.length} changes: ${imperative(main).replace(/ \([^)]*\)/g, "")}` : cap(imperative(main).replace(/ \([^)]*\)/g, "")), 46)
		return {
			state: "found",
			how: "ai",
			say: imperative(did),
			did,
			label,
			checked,
			goal: goal.t.label,
			sceneJSON: JSON.stringify(rep.scene),
			planJSON: rep.plan ? JSON.stringify(rep.plan) : null,
			changes: lines,
			results: tg.map((t) => ({ label: t.label, ok: true, ...(t.implicit ? { implicit: true } : {}) })),
			reply: rep.planned ?? null,
			runs: rep.fixApplied?.runs ?? 0
		}
	}

	/** Is a rework's version one to offer? Run once more on the app's own engine: every goal of the scene (and the rows that all fell before) met,
	 *  no new start-up warnings, every thing the person chose still there and its kind, every setting and place their words gave as they gave it
	 *  (hard), nothing they took away back, nothing they added moved off (more than 10 cm), and no stage that worked before the change lost.
	 *  -> {ok, why, targets} */
	async function judgeRework(ctx, rep, { signal, mine, removedTypes, targets, hard = [] }) {
		if (!rep || rep.replyOnly || !rep.scene) return { ok: false, why: "the AI changed nothing" }
		const sc = rep.scene
		for (const it of mine) if (!sc.items.some((i) => i.id === it.id && i.type === it.type)) return { ok: false, why: `it took away or swapped ${theName(it)}` }
		if (sc.items.some((i) => removedTypes.includes(i.type))) return { ok: false, why: "it brought back what you took away" }
		// (what the person said to leave as it is, "without touching the box": never changed)
		if (ctx.frozen instanceof Set && ctx.frozen.size && frozenChanged(ctx.scene, sc, ctx.frozen)) {
			const it = ctx.scene.items.find((i) => ctx.frozen.has(i.id) && frozenChanged(ctx.scene, sc, [i.id]))
			return { ok: false, why: `it changed ${it ? theName(it) : "what you said to leave as it is"}, which you said to leave as it is` }
		}
		// (what the person's words set stays as they set it: c02 "added 1 domino (8 → 9)", e5 "made the box wider (width 5 → 30 cm)")
		const at = new Map(sc.items.map((i) => [i.id, i]))
		for (const [id, keys] of Array.isArray(hard) ? hard : []) {
			const a = ctx.scene.items.find((i) => i.id === id)
			const b = at.get(id)
			if (!a) continue
			if (!b) return { ok: false, why: `it took away ${theName(a)}` }
			for (const k of keys) {
				if (/^place/.test(k)) {
					if (Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) > 0.002 || Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) > 0.002) return { ok: false, why: `it moved ${theName(a)}, which you placed` }
				} else if (JSON.stringify(propValue(a, k) ?? null) !== JSON.stringify(propValue(b, k) ?? null)) return { ok: false, why: `it changed ${theName(a)}'s ${lc(propSpec(a.type, k)?.label ?? k)} back` }
			}
		}
		// (what the person chose stays what they chose: a size or a weight of theirs never made absurd (the 7.3 kg bowling ball made a 151 g one, a
		// 4 cm ping-pong ball 10 cm across), nothing the other way from a word they gave it ("a heavy steel weight" made 100 g: V8820 x5))
		{
			const ch = characterBreak(ctx.scene, sc, ctx.before?.scene ?? null, ctx.hard instanceof Map ? ctx.hard : hard) ?? helperSizeBreak(ctx.scene, sc)
			if (ch) return { ok: false, why: ch }
		}
		// (what the person added stays where they put it, give or take 10 cm: c02's books parked 1.46 m away past the bucket were no fix; a row of
		// them may be spaced anew within its own stretch, in its order, as the search's own stand-in does: V8817 s3, "it moved Soda can 5 14 cm")
		const B0 = new Map((ctx.before?.scene?.items ?? []).map((i) => [i.id, i]))
		const addedMine = mine.filter((it) => !B0.has(it.id))
		const rowOk = new Set()
		for (const type of new Set(addedMine.map((i) => i.type))) {
			const was = addedMine.filter((i) => i.type === type).sort((p, q) => (Number(p.x) || 0) - (Number(q.x) || 0))
			const now = was.map((i) => at.get(i.id))
			if (was.length < 2 || now.some((b) => !b)) continue
			const xs0 = was.map((i) => Number(i.x) || 0)
			const xs1 = now.map((b) => Number(b.x) || 0)
			const inOrder = xs1.every((x, k) => k === 0 || x > xs1[k - 1])
			const level = now.every((b, k) => Math.abs((Number(b.y) || 0) - (Number(was[k].y) || 0)) < 0.02)
			const within = Math.abs(xs1[0] - xs0[0]) <= 0.3 && Math.abs(xs1.at(-1) - xs0.at(-1)) <= 0.3
			if (inOrder && level && within) was.forEach((i) => rowOk.add(i.id))
		}
		for (const it of addedMine) {
			if (rowOk.has(it.id)) continue
			const b = at.get(it.id)
			const d = b ? Math.hypot((Number(b.x) || 0) - (Number(it.x) || 0), (Number(b.y) || 0) - (Number(it.y) || 0)) : 0
			if (d > 0.1) return { ok: false, why: `it moved ${amongName(it, ctx.scene)} ${fmtLen(d)} from where you put it` }
		}
		// (a new thing held and let go on the clock does the machine's job: the chain must set it off)
		const held0 = new Set(ctx.scene.items.filter((i) => i.held).map((i) => i.id))
		if (sc.items.some((i) => i.held && !held0.has(i.id))) return { ok: false, why: "it dropped something on a timer instead of letting the machine set it off" }
		if (num(sc.release) !== null && num(ctx.scene.release) !== null && Math.abs(sc.release - ctx.scene.release) > 1e-6) return { ok: false, why: "it changed when things let go" }
		let run
		try {
			run = await simulate(sc, signal)
		} catch (e) {
			if (e?.name === "AbortError" || signal?.aborted) throw e
			return { ok: false, why: "it couldn't be run" }
		}
		// (every goal the scene had, as it has them now: the rework's own goals list may have dropped one)
		const goals = Array.isArray(ctx.goals) ? ctx.goals : null
		const tg = fixTargets({ goals, scene: sc, before: ctx.before, sim: run }).filter((t) => goalItems(t.goal).every((id) => sc.items.some((i) => i.id === id)))
		const rs = judgeTargets(tg, run)
		if (!tg.length || rs.some((r) => r.ok !== true)) return { ok: false, why: `“${String(tg[rs.findIndex((r) => r.ok !== true)]?.label ?? "the goal").replace(/[.!]+$/, "")}” still fails` }
		if ((run.warnings?.length ?? 0) > (ctx.sim?.warnings?.length ?? 0)) return { ok: false, why: "things would start inside each other" }
		// (through the machine: nothing starting on its own, the goal's thing set off by the chain, no end wall, no container behind its launcher)
		const br = chainBreak(ctx, sc, run, tg)
		if (br) return { ok: false, why: br }
		// (no stage that worked before the person's change, of a thing they didn't change, lost: a rework that skips the machine is no fix)
		if (ctx.before?.sim) {
			const changed = new Set(mine.map((i) => i.id))
			const lost = lostStageList(ctx.before.sim, run, sc).filter((l) => !l.ids.some((id) => changed.has(id)))
			// (no bracket inside the bracket: "(the growing dominoes, and 8 of 8 fall; was 9 of 9)", V8843 rw-books)
			if (lost.length) return { ok: false, why: `it skips a step that worked before (${tidyBrackets(inClause(clauseName(lost[0].text, sc))).replace(/\s*\((was [^()]*)\)/g, "; $1")})` }
		}
		// (what the person put in a container stays in it: "a rubber duck in the box waiting for its egg" is never knocked out by the fix)
		try {
			const ins0 = inspect(ctx.scene)
			const last = run.track?.frames?.at(-1)?.placements ?? null
			if (last) {
				const poses = new Map(Object.entries(last).map(([sid, p]) => [sid, [p.x, p.y]]))
				for (const it of mine) {
					const sup = supportIn(ctx.scene, ins0, it.id)
					if (!sup?.inside || !["box", "cup", "bucket", "basket"].includes(ctx.scene.items.find((i) => i.id === sup.id)?.type)) continue
					if (!simInside(sc, run.doc, poses, it.id, sup.id)) return { ok: false, why: `${theName(it)} doesn't stay in ${theName(ctx.scene.items.find((i) => i.id === sup.id))}` }
				}
			}
		} catch {}
		return { ok: true, targets: tg.map((t, i) => ({ label: t.label, ok: rs[i].ok, implicit: !!t.implicit })) }
	}

	return { build, call: (step, payload, signal) => call(step, payload, signal, { calls: [] }), findFix, restage, fixInfo, makeItWork, diagnose, outOfReach, reachOf, reworkRequest, judgeRework }
}
/** One of several things of a kind by its place among them, when its name is only its kind's with a number ("the 5th soda can", "the last
 *  soda can", never "Soda can 5"); else its name. */
function amongName(it, scene) {
	return placeName(it, scene)
}
/** The fix-search answer as the report keeps it (no runs; the scenes as JSON, so a reload can still apply them). */
export function fixInfo(fr, scene, targets = null, report = null) {
	const tg = targets ?? fr?.targets ?? []
	const explicit = tg.filter((t) => !t.implicit)
	const first = (explicit.length ? explicit : tg)[0]
	const checked = !tg.length ? null : tg.length === 1 || explicit.length === 1 ? first.label : explicit.length > 1 ? `${allN(explicit.length)} goals` : first.label
	// (a path phrase of the label, "sails over the cone", is claimed only when the scene has that thing to go over: chainBreak checks it then)
	const claim = (l) => (l && fr?.fix?.scene ? claimLabel(l, fr.fix.scene) : l)
	const out = { state: fr?.status === "found" ? "found" : "none", checked: checked ? String(claim(checked)).replace(/[.!]+$/, "") : null, goal: first?.label ?? null, runs: fr?.runs ?? 0, ms: fr?.ms ?? 0 }
	const res = (list) => (Array.isArray(list) ? list.map((r, i) => ({ label: r.label, ok: r.ok, ...(tg[i]?.implicit ? { implicit: true } : {}) })) : [])
	if (fr?.status === "found") {
		let { say, did } = fr.fix.words
		// (an offer that names three or more things one by one, "Book 1, Bowling pin 1, Bowling pin 2 and Bowling pin 3", is said by the grouped
		// lines of what it changes instead: V8817 c02)
		if ((String(say).match(/\b[A-Z][\p{L}'’-]*(?: [\p{L}'’-]+)? \d+(?=,| and )/gu) ?? []).length >= 2)
			try {
				const lines = humanChangeList(scene, fr.fix.scene).map((c) => c.text)
				if (lines.length) {
					did = andList(lines)
					say = imperative(did)
				}
			} catch {}
		Object.assign(out, { say, did, label: fr.fix.words.label, sceneJSON: JSON.stringify(fr.fix.scene), changes: fr.fix.changes, results: res(fr.fix.results), ...(fr.fix.fragile ? { fragile: true } : {}) })
	}
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
	// (a thing the solver stood on posts when the scene was built, "Nothing held Funnel up in mid-air, so 2 wooden posts … were put under it":
	// pinned without `keep`, so the solve puts the same posts back under it (keep would leave it without them: the replay of the stored edit
	// answers, round3-plan §4.2 (3), found every edit of such a scene deleting them)
	const stood = new Set()
	for (const r of ref?.items ?? []) {
		const m = /^(.+)-stand(?:-(?:left|right))?$/.exec(String(r?.id ?? ""))
		if (m && r.type === "wooden-block" && r.fixed === true && !P.has(r.id) && P.has(m[1])) stood.add(m[1])
	}
	const out = clone(plan)
	const pinned = new Set()
	for (const it of out.items ?? []) {
		if (!isObj(it) || !untouched(it.id)) continue
		const r = R.get(it.id)
		it.place = { on: "air", x: Number(r.x) || 0, y_m: (Number(r.y) || 0) - top, angle_deg: Number(r.angle) || 0, ...(stood.has(it.id) ? {} : { keep: true }) }
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

/** A plain sentence for what went wrong talking to the AI (body: the server's answer, whose code says it best). */
export function plainError(msg, step, body = null) {
	const code = body?.code ?? null
	if (code === "sign_in") return SIGN_IN_WORDS
	if (code === "quota" || code === "site_quota") return quotaWords(body)
	if (code === "not_configured") return OFF_WORDS
	if (code === "not_allowed") return String(body?.error ?? "AI is invite-only here for now").replace(/Build with AI/g, "The AI")
	const m = String(msg)
	if (/failed to fetch|networkerror|load failed/i.test(m)) return "Couldn't reach the AI service (network)"
	if (/rate|429|too many/i.test(m)) return "The AI service is busy right now (rate limited)"
	if (/key|auth|401|403/i.test(m)) return "The AI service refused the request (its key or access)"
	return `The ${step} step failed: ${m.replace(/^Error:\s*/, "").slice(0, 300)}`
}
/** A refusal the person has to act on, from an AI step's error (the app's api() error: status, body {code, error, resetsAt}), or null. */
export function refusalOf(e, step = null) {
	const body = e?.body ?? null
	const code = body?.code ?? null
	const status = e?.status ?? 0
	if (code === "sign_in" || (status === 401 && body?.signIn === true)) return new AiError("sign_in", SIGN_IN_WORDS, { step, code: "sign_in", cause: e })
	if (code === "quota" || code === "site_quota") {
		const scope = code === "site_quota" ? "site" : /\bhour/i.test(String(body?.error ?? "")) ? "hour" : "user"
		return new AiError("quota", quotaWords({ ...body, scope }), { step, code, resetsAt: typeof body?.resetsAt === "string" ? body.resetsAt : null, scope, cause: e })
	}
	// (no AI on this deployment: the hosted function's "not switched on", a static preview's /api/ai/* that has nothing behind it, or no route at all)
	if (code === "not_configured" || (code === "unavailable" && status === 503 && body?.retryable === false) || (status === 404 && code !== "bad_input")) return new AiError("off", OFF_WORDS, { step, code: code ?? "not_found", cause: e })
	if (code === "not_allowed") return new AiError("access", plainError("", step, body), { step, code, cause: e })
	if (code === "unauthorized") return new AiError("access", "This page has no access to the AI: open the invite link again", { step, code, cause: e })
	if (code === "forbidden" && status === 403) return new AiError("access", `The AI refused this page: ${String(body?.error ?? "no access").replace(/^./, (c) => c.toLowerCase())}`, { step, code, cause: e })
	return null
}
