// One function per AI step: check the payload, build the messages (the step's fixed prompt + the catalog digest as the system prompt,
// the request as the user turn), call the model (ai/core.mjs), and return {result, model, servedModel, ms, usage, attempts, warnings, prompt}.
//   import { runStep } from "./steps.mjs"
//   const out = await runStep("plan", { text: "a ball rolls down a ramp into a cup" }, { signal })
// Payloads (all fields optional unless marked):
//   observe {text, images*: [img] (1-4)}
//   plan    {text* (or observation), observation, scene (the scene on screen: with things in it, the step first decides whether the request
//            changes it: §13.8), intent ("auto" default | "new": a new scene whatever is on screen), plan (the scene's plan), history, images}
//   refine  {text, plan*, scene* (the solved scene), sim ({summary, warnings} of its run), renders ([img], 0-4: pictures of the solved
//            scene), images (reference pictures, 0-4), round (1-based), rounds (the most there will be), observation (the observe step's
//            answer, when there are reference pictures: its objects become the critic's checklist; plan.covers carries it too)}
//            Every goal of the plan (ai/goals.mjs kinds) is checked here: "in" from the run's summary, the others on a run of the solved scene
//            made here (web/sim + the engine bundle, the same run as /api/simulate), and the critic sees MET / FAILED with the numbers; so is
//            each of the plan's stages' own check (plan.stages[].check), in the same run (out.stages).
//            rate_only: true -> the final check: the same look at the scene, answered as {score_0_10, issues, notes?} only (no patches), at
//            the lower effort of models.json "rate" (ai/DESIGN.md §13).
//   edit    {text*, scene* (the current scene), plan (its plan, when it has one), history ([{role: "user"|"assistant", text}], ≤ 20), images,
//            feedback (text ≤ 8000: the client's repair turn or "make it work" round, placed just before the request: ai/DESIGN.md §14),
//            sim ({summary, warnings, final?}: the client's run of the scene on screen; only used when the step cannot run it itself),
//            intent ("auto" default: an answer of mode "new" goes on to plan the new scene | "edit": it comes back as {mode: "new", reply, why})}
//   imagine {text*} (words only: pictures are a 400) -> a concept picture of a NEW scene and its catalog cast (ai/imagine.mjs, ai/DESIGN.md §15)
//            The step runs the scene itself (the same run as /api/simulate) and gives the model the rich digest (ai/rich-digest.mjs: looks,
//            sizes, places in words, supports, the last run's hits and goals, look-alikes); the answer carries kind (change | ask | answer |
//            fix | undo | new) and targets ([{says, ids, because}]): §14.
//   img = "data:image/jpeg;base64,..." or {data: "data:image/...", name?, label?}
import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { AIError, callModel, loadRouting } from "./core.mjs"
import { DEFAULT_STAGE, detailFor, getCatalog, promptCatalog, SURFACE_NOTE } from "./catalog-digest.mjs"
import { checkGoals, goalKind } from "./goals.mjs"
import { applyPatches, planFromScene, unitsOfItem, validateObservation, VALIDATORS } from "./schemas.mjs"
import { richDigestFrom, goalFacts, moduleLinesOf } from "./rich-digest.mjs"
import { roomUnder, withRoom } from "./room.mjs"
import { sceneDigest, simText } from "./scene-digest.mjs"
import { imagine } from "./imagine.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const PROMPTS = process.env.AI_PROMPTS_DIR || join(HERE, "prompts")
export const STEPS = ["observe", "plan", "refine", "edit", "imagine"]
export const MAX_IMAGES = 4
const MAX_IMAGE_CHARS = 8 << 20
const MAX_TEXT = 8000
const DATA_URL = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i

// ---------------------------------------------------------------- prompts
/**
 * The physics modules' lines for a step's system prompt (web/sim/plugins.js, read from its registry on globalThis: web/sim is loaded by the time a
 * step builds its prompt): each module's fixed text for this step, and for refine (whose catalog is the brief one) the modules' goal kinds too.
 * "" without modules, so every prompt is what it was. Appended at the end of the system prompt: fixed per deployment, so it stays cached.
 */
export function moduleSnippets(step) {
	const S = globalThis[Symbol.for("sandbox.plugins")]
	if (!S || !S.modules.size) return ""
	const mods = [...S.modules.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
	const parts = []
	for (const m of mods) {
		const t = typeof m.prompt?.[step] === "string" ? m.prompt[step].trim() : ""
		const goals = step === "refine" ? (m.goals ?? []).map((k) => `- goal ${k.about ?? k.kind}`) : []
		if (t || goals.length) parts.push(`### ${m.title ?? m.name}\n${[t, ...goals].filter(Boolean).join("\n")}`)
	}
	return parts.length ? `\n\n## Physics modules\n${parts.join("\n\n")}` : ""
}

/** moduleSnippets once web/sim (and with it the modules' registry) is loaded in this process; "" when it cannot be. */
async function snippetsFor(step) {
	try {
		await sim()
	} catch {
		return ""
	}
	return moduleSnippets(step)
}

/** A prompt file with its {{include:file}} lines expanded (one level deep is enough; includes may include). */
export function loadPrompt(name, depth = 0) {
	const text = readFileSync(join(PROMPTS, name), "utf8")
	if (depth > 4) return text
	return text.replace(/\{\{include:([\w.-]+)\}\}/g, (_, f) => loadPrompt(f, depth + 1).trim())
}
const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10)

// ---------------------------------------------------------------- payload checks
const bad = (msg) => new AIError("bad_input", msg)
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

function text(p, field, { required = false, max = MAX_TEXT } = {}) {
	const v = p[field]
	if (v === undefined || v === null) {
		if (required) throw bad(`${field} is missing`)
		return ""
	}
	if (typeof v !== "string") throw bad(`${field} must be text`)
	if (v.length > max) throw bad(`${field} is too long (${v.length} characters; at most ${max})`)
	if (required && !v.trim()) throw bad(`${field} is empty`)
	return v.trim()
}

function images(p, field, { required = false } = {}) {
	const v = p[field]
	if (v === undefined || v === null) {
		if (required) throw bad(`${field} is missing: attach 1 to ${MAX_IMAGES} pictures`)
		return []
	}
	if (!Array.isArray(v)) throw bad(`${field} must be a list of pictures`)
	if (required && !v.length) throw bad(`${field} is empty: attach 1 to ${MAX_IMAGES} pictures`)
	if (v.length > MAX_IMAGES) throw bad(`${field} has ${v.length} pictures; at most ${MAX_IMAGES}`)
	return v.map((img, i) => {
		const data = typeof img === "string" ? img : isObj(img) ? img.data ?? img.url : null
		if (typeof data !== "string" || !DATA_URL.test(data)) throw bad(`${field}[${i}] must be a picture as a data URL (data:image/jpeg;base64,...: JPEG, PNG, WebP or GIF)`)
		if (data.length > MAX_IMAGE_CHARS) throw bad(`${field}[${i}] is too large (${(data.length / 1048576).toFixed(1)} MB; downscale it to at most 1536 px)`)
		const b64 = data.slice(data.indexOf(",") + 1)
		if (!/^[A-Za-z0-9+/=\s]*$/.test(b64.slice(0, 4096)) || b64.length < 16) throw bad(`${field}[${i}] is not valid base64 picture data`)
		const label = isObj(img) ? String(img.label ?? img.name ?? "").slice(0, 120) : ""
		return { data, label }
	})
}

let simP = null
const sim = () => (simP ??= import(pathToFileURL(join(dirname(HERE), "web", "sim", "index.js")).href))
let engineP = null
const engine = () => (engineP ??= import(pathToFileURL(join(dirname(HERE), "web", "sim", "engine-worker.js")).href))
/** A run of a scene in this process, as POST /api/simulate answers it ({doc, track, summary, warnings}); the engine bundle is web/sim's. */
export async function runScene(scene, rate = 120) {
	const m = await sim()
	const e = await engine()
	const { scene: s, doc, resolved } = m.prepare(scene)
	const msg = e.handle({ id: 1, doc, rate })
	if (msg.error !== undefined) throw new Error(String(msg.error).split("\n").at(-1))
	const meta = m.finish(s, doc, resolved, msg.track)
	return { doc: meta.doc, track: msg.track, summary: meta.summary, warnings: meta.warnings, resolved: meta.resolved ?? resolved }
}

/** A scene the builder accepts (web/sim clean(): the server's own checks), or a 400. */
async function scene(p, field, { required = false } = {}) {
	const v = p[field]
	if (v === undefined || v === null) {
		if (required) throw bad(`${field} is missing`)
		return null
	}
	if (!isObj(v)) throw bad(`${field} must be a scene object`)
	if (!Array.isArray(v.items)) throw bad(`${field}.items must be a list`)
	try {
		const m = await sim()
		return m.clean(v)
	} catch (e) {
		if (e?.name === "BadScene" || e?.constructor?.name === "BadScene") throw bad(`${field}: ${e.message}`)
		throw e
	}
}

function planArg(p, field, { required = false } = {}) {
	const v = p[field]
	if (v === undefined || v === null) {
		if (required) throw bad(`${field} is missing`)
		return null
	}
	if (!isObj(v) || !Array.isArray(v.items)) throw bad(`${field} must be a plan object with items`)
	if (v.items.length > 200) throw bad(`${field} has too many items`)
	return v
}

const stageAndTable = (s) => {
	const stage = s?.stage ?? DEFAULT_STAGE
	const t = s?.items?.find((i) => i.type === "table")
	const w = Number(t?.props?.width ?? 3.7)
	const x = Number(t?.x ?? 1.3)
	return { stage, left: x - w / 2, right: x + w / 2, width: w }
}
const f3 = (v) => Number(v).toFixed(3).replace(/\.?0+$/, "")
function stageText(s) {
	const { stage, left, right, width } = stageAndTable(s)
	return `The stage runs x ${f3(stage.x0)}…${f3(stage.x1)} and y ${f3(stage.y0)}…${f3(stage.y1)} m. The table top is y = 0 and runs from x ${f3(left)} to ${f3(right)} (${f3(width)} m long).`
}
/** A plan without its chat fields (the last turn's reply and chips are not part of the scene). */
const withoutChat = (pl) => (isObj(pl) ? Object.fromEntries(Object.entries(pl).filter(([k]) => k !== "reply" && k !== "suggestions")) : pl)
/** The plan as the edit step shows it: without the build's chat and its "not in the library" list (the build's, not this request's: an
 *  edit that copied it told the user again about things they did not ask for now; the scene keeps it, see validateEdit's plan_missing). */
const forEdit = (pl) => (isObj(pl) ? Object.fromEntries(Object.entries(withoutChat(pl)).filter(([k]) => k !== "missing")) : pl)
const fenced = (label, s) => `${label}:\n"""\n${s}\n"""`
const pictureList = (list, what) => list.map((im, i) => `picture ${i}${im.label ? ` (${im.label})` : ""}: ${what}`)

// ---------------------------------------------------------------- the steps
async function observe(p, o) {
	const t = text(p, "text")
	const imgs = images(p, "images", { required: true })
	const system = loadPrompt("observe.md")
	// a sketch or a drawing (the request says so) is observed at the lower effort of models.json observe.simpleParams: on the bench's sketches
	// it built as well (4 of 4 passed at both efforts) in about half the time (ai/research/benchmark.md §13)
	const simple = SKETCH_RE.test(t) ? (o.routing ?? safeRouting())?.steps?.observe?.simpleParams : null
	if (simple && typeof simple === "object") o = { ...o, params: { ...simple, ...(o.params ?? {}) } }
	const user = [
		fenced("The user's request (it may say what should happen; the pictures show the setup)", t || "(no text)"),
		`There ${imgs.length === 1 ? "is 1 picture" : `are ${imgs.length} pictures`}, in this order: ${pictureList(imgs, "reference").join("; ")}.`,
		"Describe them as asked, as one JSON object."
	].join("\n\n")
	return call("observe", { system, user, imgs, ctx: { images: imgs.length } }, o)
}

/** Items a person put in the scene (not the table and not the solver's see-through safety walls). */
const realItems = (sc) => (sc?.items ?? []).filter((i) => i && i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d))
const sumUsage = (...us) => {
	const t = {}
	for (const u of us)
		for (const [k, v] of Object.entries(u ?? {}))
			if (typeof v === "number" && Number.isFinite(v)) t[k] = (t[k] ?? 0) + v
			else if (isObj(v)) t[k] = sumUsage(t[k], v)
	return t
}
/** A signal that aborts with the parent's, or on its own (abort()). */
function childSignal(parent) {
	const ac = new AbortController()
	const stop = () => ac.abort(parent.reason)
	if (parent?.aborted) ac.abort(parent.reason)
	else parent?.addEventListener?.("abort", stop, { once: true })
	return { signal: ac.signal, abort: (why) => ac.abort(why ?? new Error("not needed")), done: () => parent?.removeEventListener?.("abort", stop) }
}

/**
 * plan: a NEW scene from the request (and pictures). With a current scene that has things in it (payload.scene) the step decides first
 * whether the request changes that scene (ai/DESIGN.md §13.8, "auto"): the edit step (low effort) and a fresh plan start together; when the
 * edit step says it is a change, the fresh plan is dropped and the answer is the current plan with the change applied (intent "edit", the edit
 * answer in `edit`): untouched items stay exactly as they are. When it says the user wants a different scene, the fresh plan is the answer
 * (intent "new"). payload.intent "new" skips the check (the scene is not used).
 */
async function plan(p, o) {
	if (p.intent !== undefined && !["auto", "new"].includes(p.intent)) throw bad('intent must be "auto" or "new"')
	const cur = await scene(p, "scene")
	// (pictures already looked at, an observation: a build from a picture is a new scene; to add a pictured thing to the scene on screen,
	// the client sends the picture to the edit step)
	if (!cur || !realItems(cur).length || p.intent === "new" || p.observation != null) return freshPlan({ ...p, scene: cur && !realItems(cur).length ? p.scene : undefined }, o)
	text(p, "text", { required: !p.observation })
	const signal = o.signal
	const ePart = childSignal(signal)
	const pPart = childSignal(signal)
	const editP = edit({ text: p.text ?? "", scene: p.scene, plan: p.plan, images: p.images, history: p.history }, { ...o, signal: ePart.signal, onProgress: undefined, noEscalate: true })
	const freshP = freshPlan({ ...p, scene: undefined }, { ...o, signal: pPart.signal })
	freshP.catch(() => {}) // (dropped when the request is a change)
	try {
		let e
		try {
			e = await editP
		} catch (err) {
			// the decision failed: never fall back to a whole new scene over the one on screen (that is the bug this guards against)
			pPart.abort(err)
			throw err
		}
		const ans = e.result
		if (ans.mode === "new") {
			const f = await freshP
			if (!f.result.reply && ans.reply) f.result.reply = ans.reply
			return { ...f, ms: Math.max(f.ms, e.ms), usage: sumUsage(f.usage, e.usage), attempts: [...e.attempts, ...f.attempts], intent: "new", why: ans.why ?? null, edit: { mode: "new", kind: "new", reply: ans.reply, why: ans.why ?? null } }
		}
		pPart.abort()
		const cat = await getCatalog()
		const base = p.plan && isObj(p.plan) && Array.isArray(p.plan.items) ? JSON.parse(JSON.stringify(p.plan)) : planFromScene(cur, cat.index)
		let result
		if (ans.mode === "plan" && isObj(ans.plan)) result = { ...ans.plan, reply: ans.plan.reply || ans.reply }
		else {
			result = applyPatches(base, Array.isArray(ans.patches) ? ans.patches : [], cat.index)
			for (const k of ["missing", "notes", "assumptions"]) if (ans[k] !== undefined) result[k] = ans[k]
			// (the scene's own "not in the library" list stays with its plan; edit.missing is this request's)
			if (Array.isArray(ans.plan_missing)) result.missing = ans.plan_missing
		}
		// (the chat reply and the next-edit chips of this change, where the client reads a plan's: §13.9)
		result.reply = ans.reply
		if (Array.isArray(ans.suggestions)) result.suggestions = ans.suggestions
		else delete result.suggestions
		// (kind: change | ask | answer | fix | undo; targets: what each thing the request names is: §14. ask / answer / undo carry no patches,
		// so the result is the scene's plan as it is and the reply is the question or the answer)
		const editInfo = { mode: ans.mode, kind: ans.kind, targets: ans.targets ?? [], reply: ans.reply, why: ans.why ?? null, patches: ans.patches ?? [], missing: ans.missing ?? [], suggestions: ans.suggestions ?? [], ...(ans.notes !== undefined ? { notes: ans.notes } : {}), ...(ans.assumptions !== undefined ? { assumptions: ans.assumptions } : {}), ...(ans.undo ? { undo: true } : {}) }
		return { ...e, result, intent: "edit", why: ans.why ?? null, edit: editInfo }
	} finally {
		ePart.done()
		pPart.done()
	}
}

async function freshPlan(p, o) {
	const cat = await getCatalog()
	const t = text(p, "text")
	let obs = p.observation ?? null
	if (!t && !obs) throw bad("text is missing (or give an observation of the pictures)")
	if (obs !== null) {
		const r = validateObservation(obs, { images: 8 })
		if (!r.ok) throw bad(`observation is not valid: ${r.errors.slice(0, 5).join("; ")}`)
		obs = r.value
	}
	const cur = await scene(p, "scene")
	const imgs = images(p, "images")
	const parts = [fenced("# The request", t || "(no text: build what the pictures show)"), `# The stage\n${stageText(cur)}`]
	if (obs) parts.push(`# What the reference pictures show (written by a vision model; trust the request where they differ)\n${JSON.stringify(obs)}`)
	if (imgs.length) parts.push(`# Reference pictures\n${pictureList(imgs, "attached below").join("; ")}.`)
	if (cur && (cur.items ?? []).some((i) => i.type !== "table")) {
		const d = await sceneDigest(cur, cat.index)
		parts.push(`# The current scene (the request may change it: your plan describes the whole new scene)\n${d.text}`)
	}
	if (obs?.objects?.length) parts.push(`# Account for every observed object\nList each of the observation's objects in "covers", by its exact label (${obs.objects.map((x) => `"${x.label}"${(x.count ?? 1) > 1 ? ` ×${x.count}` : ""}`).join(", ")}), with the ids of the plan items that build it, or ids [] and a note saying why it is not built.`)
	// (a catalog with many module types: the cached prompt has its core, and the modules this request or scene uses come in full here)
	const pc = promptCatalog(cat, { text: [t, ...(obs?.objects ?? []).map((x) => x.label)].join(" "), types: (cur?.items ?? []).map((i) => i.type) })
	if (pc.extra) parts.push(pc.extra)
	parts.push("Write the plan as one JSON object.")
	const system = loadPrompt("plan.md").replace("{{CATALOG}}", pc.system) + (await snippetsFor("plan"))
	return call("plan", { system, user: parts.join("\n\n"), imgs, ctx: { catalog: cat.index, stage: cur?.stage, observation: obs ?? undefined, text: t } }, o, cat)
}

const safeRouting = () => {
	try {
		return loadRouting()
	} catch {
		return null
	}
}
const SKETCH_RE = /\b(sketch|sketches|sketched|drawing|drawings|drawn|doodle|diagram|cartoon|illustration|whiteboard|hand-drawn|line art)\b/i
const fm = (v) => (v >= 1 ? `${+v.toFixed(2)} m` : `${+(v * 100).toFixed(1)} cm`)
const hasSize = (z) => !!z && Number.isFinite(z.w) && Number.isFinite(z.h) && Math.max(z.w, z.h) > 0
const boxWH = (b) => ({ w: b.x1 - b.x0, h: b.y1 - b.y0 })
/**
 * The critic's checklist for reference pictures: each observed object (plan.covers, else the observation) with its count and size as seen,
 * and what the plan built for it (from the solved scene's true outlines), with the differences named: a count that is not the one seen, or a
 * size off by more than 25 % (the observation's sizes are estimates: the critic checks them against the pictures). A false alarm here makes
 * the critic break a good scene, so a difference is only named when the comparison is clear:
 *  - Several observed objects built by the same items are compared together, once: parts of ONE item (a ramp and its legs, a pendulum's bob
 *    and its stand) have no count to compare; a group seen one by one (seven dominoes, one row of seven) is counted in all.
 *  - A size is compared with the closest of: the whole (all the entry's items together); the bob of a thing hung on a stand (observe sizes a
 *    thing "without its stand"; the item's outline also spans its swing); and, for a row or a group seen one by one, each single part. An
 *    observed object that is only a part of one item (legs, a stand) is compared only with a matching part of the outline, never the whole.
 */
function referenceChecklist(pl, obs, digest, catalog, { sketch = false } = {}) {
	const covers = Array.isArray(pl?.covers) ? pl.covers.filter((c) => c && typeof c.label === "string") : []
	const objs = Array.isArray(obs?.objects) ? obs.objects : []
	if (!covers.length && !objs.length) return null
	const rows = new Map(digest.items.map((r) => [r.id, r]))
	const seenOf = new Map(objs.map((x) => [x.label.toLowerCase(), x]))
	const entries = covers.length
		? covers.map((c) => ({ label: c.label, count: c.count ?? seenOf.get(c.label.toLowerCase())?.count ?? 1, size: c.size_m ?? seenOf.get(c.label.toLowerCase())?.est_size_m ?? null, ids: Array.isArray(c.ids) ? c.ids : null, note: c.note }))
		: objs.map((x) => ({ label: x.label, count: x.count ?? 1, size: x.est_size_m ?? null, ids: null }))
	for (const e of entries) if (!Number.isInteger(e.count) || e.count < 1) e.count = 1
	const keyOf = (e) => (e.ids?.length ? [...new Set(e.ids)].sort().join(",") : null)
	const groups = new Map()
	for (const e of entries) {
		const k = keyOf(e)
		if (k) (groups.get(k) ?? groups.set(k, []).get(k)).push(e)
	}
	const bigOf = (e) => (hasSize(e.size) ? Math.max(e.size.w, e.size.h) : 0)
	const hungBob = (r) => {
		const parts = r.parts ?? []
		const bobs = parts.filter((q) => /^bob\d*$/.test(String(q.part)) && q.kind === "dynamic")
		return bobs.length === 1 && parts.some((q) => q.kind === "static") ? bobs[0] : null
	}
	const lines = []
	for (const e of entries) {
		const seen = `"${e.label}" ×${e.count}${hasSize(e.size) ? `, seen ≈${fm(e.size.w)} × ${fm(e.size.h)}` : ""}`
		if (e.ids === null) {
			lines.push(`- ${seen} → (the plan does not say which items build it: find them yourself)`)
			continue
		}
		if (!e.ids.length) {
			lines.push(`- ${seen} → nothing built${e.note ? ` (${e.note})` : ""}`)
			continue
		}
		const built = e.ids.map((id) => rows.get(id)).filter(Boolean)
		const gone = e.ids.filter((id) => !rows.has(id))
		const units = built.reduce((n, r) => n + unitsOfItem({ type: r.type, props: r.props }, catalog), 0)
		const group = groups.get(keyOf(e)) ?? [e]
		const partsOfOne = group.length > 1 && units === 1
		const diffs = []
		let tag = ""
		if (group.length === 1) {
			if (e.count !== units) diffs.push(`COUNT DIFFERS: ${e.count} seen, ${units} built`)
		} else if (!partsOfOne && group[0] === e) {
			const seenN = group.reduce((n, x) => n + x.count, 0)
			if (seenN !== units && Math.max(...group.map((x) => x.count)) !== units) diffs.push(`COUNT DIFFERS: ${seenN} seen in all (${group.map((x) => `"${x.label}"`).join(", ")}), ${units} built`)
		}
		let size = ""
		const boxes = built.filter((r) => r.box)
		if (boxes.length) {
			const whole = boxes.length === 1 ? boxWH(boxes[0].box) : boxWH({ x0: Math.min(...boxes.map((r) => r.box.x0)), y0: Math.min(...boxes.map((r) => r.box.y0)), x1: Math.max(...boxes.map((r) => r.box.x1)), y1: Math.max(...boxes.map((r) => r.box.y1)) })
			size = `: built ${fm(whole.w)} × ${fm(whole.h)}${boxes.length > 1 ? " in all" : ""}`
			if (hasSize(e.size)) {
				// the largest single object of several built by one item stands for the whole item (the ramp, not its pair of legs), unless the
				// item hangs on a stand (its outline also spans the swing); the others are compared only with a part their label names (the bob)
				const ones = group.filter((x) => x.count === 1 && bigOf(x) > 0)
				const pool = ones.length ? ones : group
				const main = partsOfOne && pool.includes(e) && bigOf(e) >= Math.max(...pool.map(bigOf)) && pool.find((x) => bigOf(x) === Math.max(...pool.map(bigOf))) === e && !boxes.some(hungBob)
				const words = new Set(String(e.label).toLowerCase().split(/[^a-z]+/).filter(Boolean))
				const nth = /(\d+)\s*$/.exec(String(e.label))?.[1]
				const named = (q) => words.has(String(q.part).toLowerCase().replace(/[^a-z]+/g, ""))
				const cands = !partsOfOne || main ? [{ what: "", ...whole }] : []
				for (const r of boxes) {
					const own = boxes.length > 1 ? `${r.id}'s ` : "its "
					const parts = r.parts ?? []
					if (boxes.length > 1 && !partsOfOne) cands.push({ what: r.id, ...boxWH(r.box) })
					// "domino 7" is the row's 7th domino; "pendulum bob" its bob
					const exact = nth ? parts.find((q) => String(q.part).replace(/^\D+/, "") === nth && named(q)) : null
					if (exact) {
						cands.length = 0
						cands.push({ what: `${own}${exact.part}`, w: exact.w, h: exact.h })
						break
					}
					const bob = hungBob(r)
					if (bob && (!partsOfOne || named(bob))) cands.push({ what: `${own}bob${partsOfOne ? "" : " (without its stand)"}`, w: bob.w, h: bob.h })
					for (const q of parts) {
						if (q === bob) continue
						if ((units > 1 && !partsOfOne) || (partsOfOne && !main && named(q))) cands.push({ what: `${own}${q.part}`, w: q.w, h: q.h })
					}
				}
				const big = bigOf(e)
				const ratio = (c) => Math.max(c.w, c.h, 1e-4) / big
				const best = cands.length ? cands.reduce((a, c) => (Math.abs(Math.log(ratio(c))) < Math.abs(Math.log(ratio(a))) ? c : a)) : null
				const q = best ? ratio(best) : NaN
				if (partsOfOne && !main && !best) tag = ` (a part of ${boxes.map((r) => r.id).join(", ")}: its size is not compared)`
				else if (best) {
					if (best.what) size += ` (closest: ${best.what}, ${fm(best.w)} × ${fm(best.h)})`
					// a sketch is not drawn to scale: its sizes are no measure of a real-sized catalog object
					if (!sketch && (q > 1.25 || q < 0.8)) diffs.push(`SIZE DIFFERS: ${q > 1 ? "+" : "−"}${Math.round(Math.abs(q - 1) * 100)} % by its largest side`)
				}
			}
		}
		const what = built.map((r) => `${r.id} (${r.type}${units > 1 && built.length === 1 ? ` of ${units}` : ""})`).join(", ")
		lines.push(`- ${seen} → ${what || "?"}${gone.length ? `; ${gone.join(", ")} not in the scene` : ""}${size}${tag}${e.note ? ` (note: ${e.note})` : ""}${diffs.length ? ` — ${diffs.join("; ")}` : ""}`)
	}
	return lines.join("\n")
}

/** The plan's stage checks as goals, each labelled with its stage ("Stage 2: Dominoes fall"), in order; null for a stage with no check. */
export function stageChecks(pl) {
	return (Array.isArray(pl?.stages) ? pl.stages : []).map((st, i) =>
		isObj(st) && isObj(st.check) ? { ...st.check, label: typeof st.check.label === "string" && st.check.label.trim() ? st.check.label : `Stage ${i + 1}: ${st.label ?? ""}`.trim(), stage: i + 1 } : null
	)
}
/**
 * The plan's goals and its stages' checks in the run being judged: "in" goals from the client's summary (its scene's goals), the rest (and
 * any "in" the summary does not have) on a run made here of the solved scene, with every "in" check added to its goals so the engine
 * checks it. -> {results (the goals), stages: [{stage, label, kind, ok, detail}], ran}
 */
async function goalResults(pl, solved, given) {
	const goals = (Array.isArray(pl?.goals) ? pl.goals : []).filter((g) => g && typeof g === "object")
	const stages = stageChecks(pl).filter(Boolean)
	if (!goals.length && !stages.length) return { results: [], stages: [], ran: false }
	const summary = given?.summary ?? null
	if (!stages.length && goals.every((g) => goalKind(g) === "in") && summary) return { results: checkGoals(goals, { summary }), stages: [], ran: false }
	try {
		const sceneGoals = Array.isArray(solved.goals) ? [...solved.goals] : []
		for (const g of [...goals, ...stages])
			if (goalKind(g) === "in" && typeof g.item === "string" && typeof g.container === "string" && !sceneGoals.some((x) => x?.item === g.item && x?.container === g.container))
				sceneGoals.push({ item: g.item, container: g.container, label: String(g.label ?? "").slice(0, 200) })
		const run = await runScene({ ...solved, goals: sceneGoals })
		const own = { doc: run.doc, track: run.track, summary: run.summary }
		// "in" goals: the summary the client sent (its scene's goals) when it has them, else this run's own
		const given1 = summary?.goals?.length ? checkGoals(goals, { ...own, summary }) : null
		const mine = checkGoals(goals, own)
		const results = given1 ? given1.map((r, i) => (r.ok === null && mine[i].ok !== null ? mine[i] : r)) : mine
		const st = checkGoals(stages, own).map((r, i) => ({ stage: stages[i].stage, ...r }))
		return { results, stages: st, ran: true }
	} catch (e) {
		return { results: checkGoals(goals, { summary }), stages: stages.map((g) => ({ stage: g.stage, label: g.label, kind: goalKind(g), ok: null, detail: "the run could not be made" })), ran: false, error: String(e?.message ?? e).slice(0, 200) }
	}
}

async function refine(p, o) {
	const cat = await getCatalog()
	const t = text(p, "text")
	const pl = planArg(p, "plan", { required: true })
	const solved = await scene(p, "scene", { required: true })
	const refs = images(p, "images")
	const renders = images(p, "renders")
	if (p.sim !== undefined && p.sim !== null && !isObj(p.sim)) throw bad("sim must be an object ({summary, warnings})")
	let obs = null
	if (p.observation !== undefined && p.observation !== null) {
		const r = validateObservation(p.observation, { images: 8 })
		if (!r.ok) throw bad(`observation is not valid: ${r.errors.slice(0, 5).join("; ")}`)
		obs = r.value
	}
	const round = Number.isInteger(p.round) && p.round >= 1 && p.round <= 10 ? p.round : 1
	const rounds = Number.isInteger(p.rounds) && p.rounds >= round && p.rounds <= 10 ? p.rounds : Math.max(3, round)
	const d = await sceneDigest(solved, cat.index)
	const types = [...new Set([...(pl.items ?? []).map((i) => i?.type), ...(solved.items ?? []).map((i) => i?.type)].filter((k) => typeof k === "string"))]
	const imgs = [...refs, ...renders]
	const pics = [...pictureList(refs, "the user's reference picture"), ...renders.map((im, i) => `picture ${refs.length + i}${im.label ? ` (${im.label})` : ""}: a render of the solved scene`)]
	const rateOnly = p.rate_only === true
	if (p.rate_only !== undefined && typeof p.rate_only !== "boolean") throw bad("rate_only must be true or false")
	const goals = await goalResults(pl, solved, p.sim)
	// the app's solver keeps only "in" goals in the scene and says so for the others ("... left out"): those are checked here, so the note goes
	const otherLabels = new Set((pl.goals ?? []).filter((g) => g && goalKind(g) !== "in").map((g) => String(g.label ?? "")))
	const simIn = isObj(p.sim) ? { ...p.sim, warnings: (Array.isArray(p.sim.warnings) ? p.sim.warnings : []).filter((w) => !(/^placing: The goal “(.*)” (names something|needs .* to be a box)/.test(w?.text ?? "") && otherLabels.has(/“(.*)”/.exec(w.text)[1]))) } : p.sim
	// a sketch or a drawing (the request or the observation says so) is not to scale: its checklist compares counts, not sizes
	const sketch = SKETCH_RE.test(t) || SKETCH_RE.test(`${obs?.summary ?? ""} ${obs?.view?.notes ?? ""} ${obs?.view?.camera ?? ""}`)
	const checklist = refs.length || obs || pl.covers?.length ? referenceChecklist(pl, obs, d, cat.index, { sketch }) : null
	const parts = [
		fenced("# The request", t || "(no text)"),
		rateOnly ? "# The final check: this version is what the user gets; nothing will be changed after it" : `# Round ${round} of at most ${rounds}${round >= rounds ? " (the last: change only what is clearly wrong)" : ""}`,
		`# The plan\n${JSON.stringify(withoutChat(pl))}`,
		// (what the user was told about it before any run: rewritten as `planned` when this version no longer fits it, refine.md "# Answer")
		...(typeof pl.reply === "string" && pl.reply.trim() ? [`# What the user was told about the plan (its reply, written before any run)\n${pl.reply.trim().slice(0, 1200)}`] : []),
		`# The solved scene (what the solver built from the plan)\n${d.text}`,
		`# The types in this scene\n${SURFACE_NOTE}\n${detailFor(cat, types)}`,
		`# What happened in the run\n${simText(simIn, { goals: goals.results, stages: goals.stages })}`
	]
	if (checklist) parts.push(`# The reference checklist (each object the observation saw in the pictures, and what the plan built for it; ${sketch ? "the reference is a sketch, not drawn to scale: its sizes are not compared, only what is there and how many" : "the sizes seen are estimates: check them against the pictures"})\n${checklist}`)
	parts.push(
		pics.length ? `# Pictures\n${pics.join("; ")}.` : "# Pictures\nNone were given: judge from the scene and the run.",
		rateOnly
			? 'Rate it only: score it as "How to judge" says, and list the issues the user would see (most important first, at most 5, one sentence each). Answer as one JSON object {"score_0_10": n, "issues": [{"severity", "text", "ids"}], "notes": "one sentence, optional", "planned": "optional: as # Answer says"}: no done, no patches.'
			: "Judge the result and answer as one JSON object."
	)
	// (the same system prompt as a critique, so a rate-only check reads it from the prompt cache)
	const system = loadPrompt("refine.md").replace("{{CATALOG_BRIEF}}", cat.brief) + (await snippetsFor("refine"))
	// the rate-only check runs on models.json "rate" (lower effort, a short answer); a routing without it uses refine's route at low effort
	const rateRoute = rateOnly ? ((o.routing ?? safeRouting())?.steps?.rate ? "rate" : "refine") : undefined
	const oo = rateOnly && rateRoute === "refine" ? { ...o, params: { reasoning_effort: "low", ...(o.params ?? {}) } } : o
	const out = await call(rateOnly ? "rate" : "refine", { system, user: parts.join("\n\n"), imgs, ctx: { catalog: cat.index, plan: pl, stage: solved.stage, text: t, goalResults: goals.results }, route: rateRoute }, oo, cat)
	out.goals = goals.results
	if (goals.stages.length) out.stages = goals.stages
	if (rateOnly) out.result = { ...out.result, rate_only: true }
	return out
}

// ---------------------------------------------------------------- the edit step's run, kept per scene
// What the edit digest takes from a run depends only on the scene run (with the plan's "in" goals), the plan's other goals and the engine
// (web/sim: the catalog's fingerprint), so a repeated or undone scene (the client's repair turn and "make it work" rounds send the same scene
// again; Undo then a new request) is not run twice. Kept in this process (Vercel's warm instances, the bench) and on disk under
// AI_CACHE_DIR/edit-runs (the local server runs every step in a process of its own), when that is writable; only what the digest reads is
// kept: each item's resolved size and mass, the run's summary, its first and last frames, each item's physics-module lines (read off the whole
// run before it is dropped) and the other goals' results.
const RUN_CACHE_V = 3 // (2: the goals' moving things measured on the whole track, `facts`; 3: each item's physics-module lines, `moduleLines`)
const RUN_MEM = new Map() // key -> Promise<{sim, goalResults}> (LRU)
const RUN_MEM_MAX = 64
const RUN_DISK_MAX = 400
const runDir = () => join(process.env.AI_CACHE_DIR || join(HERE, ".cache"), "edit-runs")
/** The parts of a run the edit digest reads (ai/rich-digest.mjs: resolved, summary, the first and last frames' placements), and each item's
 *  physics-module lines read off the whole run here (its readings over the track and the run's document, which are not kept: moduleLinesOf;
 *  vfy-ai5, 20 Oct: the kept run had none, so "what does each thermometer read?" got "the run summary I have doesn't include the readings"). */
function digestPart(run, scene, cat) {
	const f = Array.isArray(run?.track?.frames) ? run.track.frames : []
	let moduleLines = {}
	try {
		moduleLines = moduleLinesOf(scene, run, cat)
	} catch {} // (a module's lines never stop the step: the digest is then without them)
	return { resolved: run?.resolved ?? {}, summary: run?.summary ?? null, track: { frames: f.length ? [f[0], f.at(-1)] : [] }, moduleLines }
}
function diskGet(key) {
	try {
		const v = JSON.parse(readFileSync(join(runDir(), `${key}.json`), "utf8"))
		return v?.v === RUN_CACHE_V && isObj(v.sim) ? { sim: v.sim, goalResults: v.goalResults ?? null, facts: Array.isArray(v.facts) ? v.facts : null } : null
	} catch {
		return null
	}
}
function diskPut(key, val) {
	try {
		const dir = runDir()
		mkdirSync(dir, { recursive: true })
		const f = join(dir, `${key}.json`)
		writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify({ v: RUN_CACHE_V, ...val }))
		renameSync(`${f}.${process.pid}.tmp`, f)
		const names = readdirSync(dir).filter((n) => n.endsWith(".json"))
		if (names.length > RUN_DISK_MAX)
			for (const { n } of names.map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => a.t - b.t).slice(0, names.length - RUN_DISK_MAX + 50))
				unlinkSync(join(dir, n))
	} catch {} // (a read-only disk, as on Vercel: the process's own cache still serves)
}

/**
 * The run the edit step's digest describes (ai/DESIGN.md §14): the scene on screen run here (the same run as /api/simulate, ~0.2-0.4 s), with
 * the plan's "in" goals added to its goals so the engine checks them, each item's resolved size and mass, and the plan's goals of the other
 * kinds checked on it (ai/goals.mjs); from the cache above when this scene was run before. A scene this process cannot run falls back to the
 * client's `sim` (its summary), else to none. -> {sim, goalResults, ms (this lookup or run), cached}
 */
async function editRun(cur, pl, given, cat) {
	const t0 = Date.now()
	const others = (Array.isArray(pl?.goals) ? pl.goals : []).filter((g) => isObj(g) && goalKind(g) !== "in")
	try {
		const ids = new Set(cur.items.map((i) => i.id))
		const goals = Array.isArray(cur.goals) ? [...cur.goals] : []
		for (const g of Array.isArray(pl?.goals) ? pl.goals : [])
			if (isObj(g) && goalKind(g) === "in" && ids.has(g.item) && ids.has(g.container) && !goals.some((x) => x?.item === g.item && x?.container === g.container))
				goals.push({ item: g.item, container: g.container, label: String(g.label ?? "").slice(0, 200) })
		const toRun = goals.length !== (cur.goals?.length ?? 0) ? { ...cur, goals } : cur
		const key = createHash("sha1").update(JSON.stringify([RUN_CACHE_V, cat?.fingerprint ?? "", toRun, others])).digest("hex")
		let cached = true
		let p = RUN_MEM.get(key)
		if (p) RUN_MEM.delete(key) // (moved to the newest end)
		else {
			const onDisk = diskGet(key)
			if (onDisk) p = Promise.resolve(onDisk)
			else {
				cached = false
				p = (async () => {
					const run = await runScene(toRun)
					const val = { sim: digestPart(run, toRun, cat), goalResults: others.length ? checkGoals(others, { doc: run.doc, track: run.track, summary: run.summary }) : null, facts: goalFacts(run, [...goals, ...others]) }
					diskPut(key, val)
					return val
				})()
			}
		}
		RUN_MEM.set(key, p)
		while (RUN_MEM.size > RUN_MEM_MAX) RUN_MEM.delete(RUN_MEM.keys().next().value)
		let val
		try {
			val = await p
		} catch (e) {
			RUN_MEM.delete(key)
			throw e
		}
		return { ...val, ms: Date.now() - t0, cached }
	} catch {
		return { sim: isObj(given) && isObj(given.summary) ? given : null, goalResults: null, facts: null, ms: Date.now() - t0, cached: false }
	}
}

/** What the edit request tells the model when the user pressed "Edit with AI" (intent "edit": the scene on screen is changed, never replaced). */
const PRESSED_EDIT = '# The user pressed "Edit"\nThey change the scene on screen: answer mode "patch" (every kind but "new"), even when the words say "new" or "build" about what is on screen (remove, add and change items with patches). Keep every item the request does not name exactly as it is. Only a request to throw this scene away and build a different one ("start over: …", "clear it and build …", "from scratch") is kind "new" (mode "new", no patches): the app then offers to build it as a new scene.'

async function edit(p, o) {
	// intent "edit" (the client's "Edit with AI", which never builds a new scene from there): an answer of mode "new" comes back as it is,
	// {mode: "new", reply, why}, without planning the new scene (the client offers to build it with plan {intent: "new"})
	if (p.intent !== undefined && !["auto", "edit"].includes(p.intent)) throw bad('intent must be "auto" or "edit"')
	const cat = await getCatalog()
	const t = text(p, "text", { required: true })
	const cur = await scene(p, "scene", { required: true })
	const pl = planArg(p, "plan")
	const imgs = images(p, "images")
	const fb = text(p, "feedback")
	const hist = p.history ?? []
	if (!Array.isArray(hist) || hist.length > 20) throw bad("history must be a list of at most 20 turns")
	const turns = hist.map((h, i) => {
		if (!isObj(h) || !["user", "assistant"].includes(h.role) || typeof h.text !== "string") throw bad(`history[${i}] must be {role: "user"|"assistant", text}`)
		return `${h.role === "user" ? "User" : "You"}: ${h.text.slice(0, 2000)}`
	})
	if (p.sim !== undefined && p.sim !== null && !isObj(p.sim)) throw bad("sim must be an object ({summary, warnings, final?}) of the scene on screen's run")
	// the scene as the user sees it (ai/rich-digest.mjs), from a run of it made here: what each thing looks like, where it is in words, what
	// it did in the last run and which goals happen now; the exact numbers stay for the patches (§14, measured as arm n7)
	const tDigest = Date.now()
	const d = await sceneDigest(cur, cat.index)
	const run = await editRun(cur, pl, p.sim, cat)
	const rich = richDigestFrom(cur, d, { sim: run.sim, plan: pl, cat, goalResults: run.goalResults, facts: run.facts })
	// the real gap under a hung thing where the outline boxes show less (ai/room.mjs: the box over the starter's sloped seesaw plank;
	// AI_EDIT_ROOM=0 leaves the boxes' gap, for an A/B)
	const room = process.env.AI_EDIT_ROOM === "0" ? null : await roomUnder(cur, d).catch(() => null)
	const digestMs = Date.now() - tDigest
	const parts = [`# The current scene\n${withRoom(rich.text, room)}`, `# The stage\n${stageText(cur)}`]
	parts.push(
		pl
			? `# Its plan (patches change this plan; the scene above is what it builds)\n${JSON.stringify(forEdit(pl))}`
			: "# Its plan\nThis scene was made by hand and has no plan: patches refer to its items by id, and each item's place is where it is now (on \"air\" at its anchor's x and y_m, so give x / y_m / dx / dy, or set_place to rest it on something)."
	)
	if (turns.length) parts.push(`# The conversation so far\n${turns.join("\n")}`)
	if (imgs.length) parts.push(`# Pictures\n${pictureList(imgs, "attached by the user").join("; ")}.`)
	if (p.intent === "edit") parts.push(PRESSED_EDIT)
	// the client's repair turn ("Ball 1 starts inside Ramp 1 ...") or "make it work" round ("In its run: FAILED: ..."), as measured
	if (fb) parts.push(fb)
	// (a catalog with many module types: the cached prompt has its core, and the modules this request, the conversation or the scene use in full)
	const pc = promptCatalog(cat, { text: [t, ...turns].join(" "), types: [...(cur.items ?? []), ...(pl?.items ?? [])].map((i) => i.type) })
	if (pc.extra) parts.push(pc.extra)
	parts.push(fenced("# The user's request now", t), "Answer as one JSON object.")
	const system = loadPrompt("edit.md").replace("{{CATALOG}}", pc.system) + (await snippetsFor("edit"))
	const out = await call("edit", { system, user: parts.join("\n\n"), imgs, ctx: { catalog: cat.index, plan: pl ?? undefined, scene: cur, stage: cur.stage, intent: p.intent === "edit" ? "edit" : undefined, text: t } }, o, cat)
	// (how long the scene's digest took here, its run of the scene included, and whether that run came from the cache: the step's own CPU
	// work, which grows on a busy machine; `ms` stays the model's time, as for every step)
	out.prompt.digest = { ms: digestMs, runMs: run.ms, cached: run.cached }
	const ans = out.result
	out.intent = ans.mode === "patch" ? "edit" : "new"
	if (ans.mode !== "new" || o.noEscalate || p.intent === "edit") return out
	// a different scene: the plan step builds it (at its own effort), from the request alone; the answer keeps the edit's shape (mode "plan")
	const t0 = Date.now()
	const left = Number.isFinite(o.budgetMs) ? o.budgetMs - out.ms : undefined
	const f = await freshPlan({ text: t, images: p.images }, { ...o, ...(left !== undefined ? { budgetMs: Math.max(1000, left) } : {}) })
	return {
		...f,
		ms: out.ms + (Date.now() - t0),
		usage: sumUsage(out.usage, f.usage),
		attempts: [...out.attempts, ...f.attempts],
		warnings: [...out.warnings, ...f.warnings],
		intent: "new",
		why: ans.why ?? null,
		result: { mode: "plan", kind: "new", targets: ans.targets ?? [], reply: f.result.reply || ans.reply, why: ans.why ?? null, plan: f.result, missing: f.result.missing ?? [], suggestions: f.result.suggestions ?? ans.suggestions ?? [] }
	}
}

async function call(step, { system, user, imgs, ctx, route }, o = {}, cat = null) {
	const out = await callModel(route ?? step, {
		system,
		content: user,
		images: imgs.map((i) => i.data),
		validate: (v) => VALIDATORS[step](v, ctx),
		signal: o.signal,
		routing: o.routing,
		env: o.env,
		fetch: o.fetch,
		log: o.log,
		backoffScale: o.backoffScale,
		params: o.params,
		budgetMs: o.budgetMs,
		onProgress: o.onProgress
	})
	out.prompt = { system: hash(system), chars: system.length + user.length }
	if (cat) out.catalog = { fingerprint: cat.fingerprint, source: cat.source, ...(cat.stale ? { stale: true } : {}) }
	return out
}

const RUNNERS = { observe, plan, refine, edit, imagine }

/** Run one step: {result, model, servedModel, ms, usage, attempts, warnings, prompt, catalog?}; throws AIError. */
export async function runStep(step, payload, o = {}) {
	if (!STEPS.includes(step)) throw new AIError("bad_input", `unknown step "${step}" (one of ${STEPS.join(", ")})`)
	if (!isObj(payload)) throw new AIError("bad_input", "payload must be an object")
	return RUNNERS[step](payload, o)
}
