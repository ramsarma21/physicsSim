// Edit with AI, the n7 browser half (ai/DESIGN.md §14.2; ai/research/round3-plan.md §4.2): how an edit answer is read (kind first), the exact
// feedback texts of the measured repair and "make it work" turns (ai/experiments/edit/arms.mjs, arm n7), and the heads-up for what stopped
// happening in the run. Pure helpers; ./orchestrator.js makes the calls and runs.
//   import { routeKind, overlapFeedback, fixFeedback, headsUpLines } from "./edit-turns.js"

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const and = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)

export const EDIT_KINDS = ["change", "fix", "ask", "answer", "undo", "new"]
/** Kinds that change nothing: the reply (and chips) only. */
export const REPLY_KINDS = new Set(["ask", "answer", "undo", "new"])
// (what the experiment read as "make it work" when an answer carried no kind)
const FIX_RE = /\b(make (it|this|them|everything) work|works? again|fix|so (that|it)|get it (to )?work|still work)\b/i

/**
 * The edit step's answer -> its kind, read first (§14.2 (2)): "ask" (one question, chips for the readings), "answer", "undo", "new" (a
 * different scene: offer New), "change" / "fix" (apply). An answer without a kind (an older server): mode "new" -> new, undo -> undo,
 * patches [] -> answer, else fix when the request states it ("make it work", "fix"), else change. A whole plan (an older server's answer)
 * is a change.
 */
export function routeKind(out, text = "") {
	if (!isObj(out)) return Array.isArray(out) && out.length ? (FIX_RE.test(text) ? "fix" : "change") : "answer"
	if (out.mode === "new" || out.kind === "new") return Array.isArray(out.patches) && out.patches.length && out.mode !== "new" ? "change" : "new"
	const k = typeof out.kind === "string" ? out.kind.trim().toLowerCase() : ""
	const hasPatches = Array.isArray(out.patches) && out.patches.length > 0
	const wholePlan = (isObj(out.plan) && Array.isArray(out.plan.items)) || Array.isArray(out.items)
	if (k === "undo" || out.undo === true) return "undo"
	if (EDIT_KINDS.includes(k)) {
		// (a question never changes the scene, even if changes came with it: the server refuses that answer, so this is only a guard)
		if ((k === "change" || k === "fix") && !hasPatches && !wholePlan) return "answer"
		return k
	}
	if (wholePlan) return FIX_RE.test(text) ? "fix" : "change"
	if (!hasPatches) return "answer"
	return FIX_RE.test(text) ? "fix" : "change"
}

/** The server's targets, tidied: [{says, ids, because?}] (≤ 20). */
export function cleanTargets(list) {
	return (Array.isArray(list) ? list : [])
		.filter(isObj)
		.map((t) => ({ says: String(t.says ?? "").trim(), ids: (Array.isArray(t.ids) ? t.ids : t.id !== undefined ? [t.id] : typeof t.ids === "string" ? [t.ids] : []).map(String), ...(typeof t.because === "string" && t.because.trim() ? { because: t.because.trim() } : {}) }))
		.filter((t) => t.says || t.ids.length)
		.slice(0, 20)
}
/** For Details: "“the yellow ball” → Ball 2" (names as on screen; an id not on screen as it is). */
export function targetWords(targets, scene) {
	const nameOf = new Map((scene?.items ?? []).map((i) => [i.id, String(i.name ?? i.id)]))
	return cleanTargets(targets).map((t) => `${t.says ? `“${t.says}”` : "(the request)"} → ${t.ids.length ? and(t.ids.map((id) => nameOf.get(id) ?? id)) : "nothing on the table"}`)
}

/**
 * §14.2 (4), as measured (arms.mjs): one repair turn when the applied change makes things start inside each other. patches: the answer's
 * patches; diff: what it changed in the scene (describeDiff lines); overlaps: [{text}] or strings; fix: the request is a "make it work".
 */
export function overlapFeedback({ patches, diff = [], overlaps = [], fix = false }) {
	const problems = overlaps.map((w) => `${typeof w === "string" ? w : w?.text ?? ""}: they must not start inside each other. Make the asked change fit (e.g. its spacing, size or place) or move the neighbour the least that makes room, and say so.`)
	return `# A check of your last answer found problems\nYou sent: ${JSON.stringify(patches ?? [])}\nWhat it changed in the scene: ${diff.join("; ") || "nothing"}\nProblems:\n${problems.map((p) => `- ${p}`).join("\n")}\nAnswer again: the WHOLE set of patches against the scene above (the scene before your first answer), doing exactly what the request asks${fix ? " (and making it work)" : ""}. If the request is a question or truly ambiguous, change nothing.`
}

/** The run's hits in order, for the model: "0.61 s Red ball hits Ramp 2 (1.20 m/s); …" (≤ 16). */
export function hitsInOrder(sim, max = 16) {
	return (sim?.summary?.events ?? [])
		.slice(0, max)
		.map((e) => `${Number(e.t ?? 0).toFixed(2)} s ${e.text}${typeof e.speed === "number" && Number.isFinite(e.speed) ? ` (${e.speed.toFixed(2)} m/s)` : ""}`)
		.join("; ")
}
/**
 * §14.2 (6b), as measured (arms.mjs): a "make it work" round, told how the last answer ran. failing: [{label, detail?}]; overlaps: [{text}].
 */
export function fixFeedback({ patches, diff = [], failing = [], overlaps = [], sim = null }) {
	const runText = hitsInOrder(sim)
	const ov = overlaps.map((w) => (typeof w === "string" ? w : w?.text ?? ""))
	return `# Your last answer was applied and run\nYou sent: ${JSON.stringify(patches ?? [])}\nWhat changed: ${diff.join("; ") || "nothing"}\nIn its run: ${failing.map((g) => `FAILED: ${g.label}${g.detail ? ` (${g.detail})` : ""}`).join("; ") || "every goal met"}.${ov.length ? ` At the start: ${ov.join("; ")} (not allowed: things must not start inside each other).` : ""} Hits in order: ${runText || "none"}.\nIt still does not work. Answer again with the WHOLE set of patches against the scene above (the scene before your first answer), changing what the run shows is wrong, by enough to make it work; keep the things the user chose. Give set_tune knobs (with ranges) on what you change, so a tuner can finish the job.`
}

/** Start-up overlaps of `after` that `before` did not have (sim/layout warnings: [{text, items}]). */
export function newOverlaps(beforeWarnings, afterWarnings) {
	const had = new Set((beforeWarnings ?? []).map((w) => w?.text))
	return (afterWarnings ?? []).filter((w) => isObj(w) && w.text && !had.has(w.text))
}

/**
 * The heads-up (§14.2 (5)), only for what the fixer's lead does not already say: stages that worked and no longer do, and firm hits (≥ 0.3
 * m/s, between things the edit left as they were) that no longer happen. lost: lostStages lines; contacts: runChanges' contact lines (the
 * "no longer hits" ones are taken); said: the lead's own words (a line it already tells is left out). -> ≤ max lines.
 */
export function headsUpLines({ lost = [], contacts = [], said = "", targets = [], skip = [], max = 3 }) {
	const lead = ` ${String(said ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `
	// (a line may come with the things it is about, {text, ids}: one about a thing in `skip` (the failing goal's own things, which the lead
	// already tells about, and what the change swapped or replaced) is left out, whatever it is called)
	const skipIds = new Set(skip)
	const textOf = (l) => String(typeof l === "string" ? l : l?.text ?? "")
	const about = (l) => (typeof l === "string" ? [] : Array.isArray(l?.ids) ? l.ids : [])
	// (the line's subject: "Dominoes: 3 of 7 fall (was 7 of 7)", "Seesaw no longer turns", "Ball 1 no longer hits Ramp 2": a thing the lead
	// already tells about is left out: the lead says what it does instead)
	const subject = (line) => String(line).split(/:| no longer | now /)[0].trim().toLowerCase().replace(/^the /, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
	const told = (l) => {
		const line = textOf(l)
		const sub = subject(line)
		if (about(l).some((id) => skipIds.has(id))) return true
		return (sub.length >= 3 && lead.includes(` ${sub} `)) || targets.some((t) => t?.ok === false && String(t.label ?? "").length > 3 && String(line).toLowerCase().includes(String(t.label).toLowerCase().replace(/[.!]+$/, "")))
	}
	const out = []
	for (const l of lost) if (textOf(l) && !told(l) && !out.includes(textOf(l))) out.push(textOf(l))
	for (const c of contacts) if (/ no longer hits /.test(textOf(c)) && !told(c) && !out.includes(textOf(c))) out.push(textOf(c))
	return out.slice(0, max)
}
export const headsUpText = (lines) => (lines?.length ? `Heads-up, in the new run: ${and(lines)}.` : "")

/** A physics module's happenings that are a thing going wrong (their `kind`): a lead pulled off, a bulb or an LED burnt out, a short circuit, a
 *  thing that breaks. */
export const MISHAP_KINDS = new Set(["pulled-off", "burns-out", "short", "breaks"])
/**
 * What went wrong in the new run to the things a change ADDED (ids the scene before it did not have): they ran into an invisible wall at the
 * table's end (they drove or rolled off its end: one line for the things that hit one wall together; not when a goal names that wall), or a
 * module says one went wrong (MISHAP_KINDS: "Black lead 2 pulled off"; not for a thing a goal names, `skip`: every id the goals name, whose goal
 * may want it so). -> [{text, t, ids}] in time order. The edit's lead never says "everything still works" over them (V2 release: a second
 * battery car added "so the two race" hit the table's end at 3.85 s, its battery thrown off and both its leads pulled off, under "Done —
 * everything still works ✓").
 */
export function mishapLines({ after = null, beforeScene = null, afterScene = null, skip = [], say = null } = {}) {
	const old = new Set((beforeScene?.items ?? []).filter(isObj).map((i) => i.id))
	const items = new Map((afterScene?.items ?? []).filter(isObj).map((i) => [i.id, i]))
	const skipped = new Set(skip)
	const added = (id) => typeof id === "string" && items.has(id) && !old.has(id)
	const fresh = (id) => added(id) && !skipped.has(id)
	const endWall = (id) => items.get(id)?.type === "wall" && items.get(id)?.props?.invisible_in_3d === true && !skipped.has(id)
	// (`say`: how a sentence names a thing, "the hobby-motor car", "Battery 2"; else its name on screen)
	const nameOf = (id) => String((typeof say === "function" ? say(id) : null) ?? items.get(id)?.name ?? id)
	const out = []
	// (into a table end's wall: the first thing added to hit it, and those that hit it within 0.2 s of it)
	const walls = new Map()
	for (const e of Array.isArray(after?.summary?.events) ? after.summary.events : []) {
		const who = added(e?.a) && endWall(e?.b) ? e.a : added(e?.b) && endWall(e?.a) ? e.b : null
		if (!who || !Number.isFinite(e.t)) continue
		const w = endWall(e.a) ? e.a : e.b
		const hit = walls.get(w) ?? walls.set(w, { t: e.t, ids: [] }).get(w)
		if (e.t <= hit.t + 0.2 && !hit.ids.includes(who)) hit.ids.push(who)
	}
	for (const { t, ids } of walls.values()) out.push({ text: `${and(ids.map(nameOf))} ${ids.length > 1 ? "run" : "runs"} into the end of the table`, t, ids })
	const said = new Set()
	for (const e of Array.isArray(after?.summary?.happenings) ? after.summary.happenings : []) {
		if (!MISHAP_KINDS.has(e?.kind)) continue
		const ids = Array.isArray(e.items) ? e.items.map(String) : []
		const text = String(e.text ?? "").replace(/[.!]+$/, "").trim()
		if (!text || !ids.some(fresh) || ids.some((id) => skipped.has(id)) || said.has(text)) continue
		said.add(text)
		out.push({ text, t: Number(e.t) || 0, ids })
	}
	return out.sort((p, q) => p.t - q.t)
}

/** The user's turn before this one (history: [{role, text}]). */
export const lastUserTurn = (history) => [...(Array.isArray(history) ? history : [])].reverse().find((h) => h?.role === "user")?.text ?? ""
/** Did that turn name the thing (by its name's first word, or its id)? A container the user just changed is never aimed. */
export function namedInTurn(item, turn) {
	if (!item || !turn) return false
	const words = [String(item.name ?? "").split(/\s+/)[0], String(item.id ?? "")].filter((w) => w.length >= 2)
	return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(turn))
}

/** "I moved the box 12 cm right (and 3 cm up), to where the ball now comes down, so “…” works again. Nothing else changed." */
export function aimReply(name, patch, label) {
	const nm = String(name ?? "the container")
	const words = [patch?.dx ? `${Math.abs(patch.dx * 100).toFixed(0)} cm ${patch.dx > 0 ? "right" : "left"}` : null, patch?.dy ? `${Math.abs(patch.dy * 100).toFixed(0)} cm ${patch.dy > 0 ? "up" : "down"}` : null].filter(Boolean).join(" and ")
	return `I moved ${nm.toLowerCase().startsWith("the ") ? nm : `the ${nm.toLowerCase()}`} ${words}, to where the ball now comes down, so “${String(label ?? "").replace(/[.!]+$/, "")}” works again. Nothing else changed.`
}
/** The honest ending of a "make it work" that still fails. */
export const stillFailsText = (labels) => (labels?.length ? `It still doesn't fully work: ${and(labels.map((l) => String(l).replace(/[.!]+$/, "")))} ${labels.length > 1 ? "fail" : "fails"} in the run.` : "")

// ---------------------------------------------------------------- the offer after a change that stopped a goal (ai/DESIGN.md §16)
const capFirst = (s) => String(s ?? "").replace(/^./, (c) => c.toUpperCase())
const lcFirst = (s) => String(s ?? "").replace(/^(AI\b)?./, (c, ai) => (ai ? c : c.toLowerCase()))
/** A goal's label inside a sentence: "The egg lands in the box" -> "the egg lands in the box" (a name, "Ball 2 lands…", stays). */
export const inSentence = (label) => {
	const t = String(label ?? "").replace(/[.!]+$/, "")
	return /^(The|A|An|All|Every|Each|Both)\b/.test(t) ? lcFirst(t) : t
}
/**
 * What the card says after the search for a fix: found -> {before: "Want me to ", say, checked} ("Want me to lower the box 4 cm? (checked:
 * Ball 2 lands in the box ✓)"); nothing works -> {text, button} (said plainly, how much was tried, and the button that asks the AI to rework
 * it, never a question without one; after a rework that still doesn't work, no button: it is not offered again). null while it looks.
 */
export function offerWords(fx, { rework = false } = {}) {
	if (!fx || fx.state === "searching") return null
	if (fx.state === "found") return { before: "Want me to ", say: fx.say, checked: inSentence(fx.checked ?? "it works") }
	const button = rework ? null : "Ask the AI to rework it"
	// (stopped because the person moved on: nothing is offered for a scene that is gone; stopped by its Stop: the rework is still theirs to ask)
	if (fx.state === "stopped" && fx.movedOn === "undo") return { text: "You undid this change, so I stopped looking for a fix.", button: null }
	// (a new request stopped it, never the person's Stop: said so, and the free "Look again" stays (V8842 qj))
	if (fx.state === "stopped" && fx.movedOn === "new") return { text: "I stopped looking for a fix when you sent a new change.", button }
	if (fx.state === "stopped" && fx.movedOn) return { text: "I stopped looking for a fix when the scene changed.", button: null }
	// (stopped because the scene went, and it is back: the same, with what can be asked again: V8832 y7)
	if (fx.state === "stopped") return { text: fx.back ? "I stopped looking for a fix when the scene changed." : "I stopped looking for a fix.", button }
	if (fx.state === "error") return { text: "I couldn’t look for a fix just now.", button }
	// (the person's own change puts it out of reach, a ball wider than the box: nothing else can fix it, so nothing is offered: the lead says
	// why and that nothing else can change it, so nothing more is said here)
	if (fx.outOfReach) return { text: "", button: null }
	// (the AI's reworks are said when one came back with an answer (fx.aiAnswered; before it was counted, any call that started): never for a
	// call stopped as it started (V8843 rw-cradle: "and the AI's reworks", and the AI never reworked it). One that started and ran out of time,
	// or was stopped at the AI budget, is said as such (V8842 k3 / n5 / c02))
	const answered = fx.aiAnswered === undefined ? null : Number(fx.aiAnswered) || 0
	const started = Number(fx.aiCalls) || 0
	const aiTried = !!fx.reworked || (answered === null ? started > 0 : answered > 0)
	const aiW = aiTried ? ` and the AI’s ${answered === 1 && started <= 1 ? "rework" : "reworks"}` : ""
	const lateW = !aiTried && started > 0 ? (fx.reworkLate ? "; the AI’s rework ran out of time" : fx.reworkCapped ? "; the AI’s rework was stopped at the AI budget" : "") : ""
	const tried = fx.runs ? ` (I tried ${fx.runs} in the physics${aiW}${fx.timedOut ? ", for a minute" : ""}${lateW})` : aiTried ? " (the AI’s reworks too)" : lateW ? ` (${lateW.slice(2)})` : ""
	if (fx.quiet) return { text: "", button }
	// (only undoing the person's own on/off or pick-from-list choice would make it work, "take the cap off": said honestly, never offered)
	if (fx.undoOnly?.say) {
		const why = fx.undoOnly.why ? `: ${String(fx.undoOnly.why).replace(/[.!]+$/, "")}` : ""
		return { text: `Only undoing your change would make it work (${lcFirst(String(fx.undoOnly.say).replace(/[.!?]+$/, ""))}${why}), so I left it as you asked${tried}. Change the goal, or undo the change?`, button }
	}
	return { text: rework ? `It still doesn’t work, and I couldn’t find a change that does${tried}.` : `I couldn’t find a change that works${tried}.`, button }
}
/** The "Looking for a fix…" line's detail, from the search's progress ({phase, runs}). */
export function progressWords(p) {
	if (p?.phase === "ai") return ` · asking the AI to rework it${p?.runs ? ` (after ${p.runs} physics runs)` : ""}`
	if (p?.phase === "ai-check") return " · checking the AI’s version in the physics"
	if (p?.phase === "ai-fix") return " · fine-tuning the AI’s version"
	// (one line for both searches, while setting each part up again still runs: never one phrasing, then the other, on every update)
	if (p?.phase === "stage" || p?.staging) return p?.runs ? ` · ${p.runs} physics runs, setting each part up again` : " · setting each part up again"
	return p?.runs ? ` · ${p.runs} physics runs` : ""
}
/** What "Ask the AI to rework it" asks when the search left no words of its own: the goal to win back, keeping what was just changed (never
 *  "change whatever else": the app marks it a "make it work" itself, request.rework). */
export function reworkWords(goal, human = []) {
	const what = (Array.isArray(human) ? human : []).slice(0, 2).map((x) => String(x).replace(/ \([^)]*\)/g, "")).join(" and ")
	return `Make it work again so that ${inSentence(goal ?? "it works again")}${what ? `, keeping what I just changed (${what})` : ""}. Say what you changed.`
}
/**
 * An idea of the AI's that names a thing by its kind ("Swap the hollow plastic ball for a basketball") while the card calls it by its name on
 * screen ("Ball 2"): said as the screen says it; when several things are of that kind, which one is meant can't be told, so it is dropped
 * (-> null). items: the things on the table; kindOf(type): the catalog's name for a kind ("Hollow plastic ball", "Soda can, standing").
 */
export function nameAsShown(s, items = [], kindOf = () => "") {
	let label = String(s?.label ?? "")
	let prompt = String(s?.prompt ?? "")
	const byType = new Map()
	for (const it of items) byType.set(it.type, [...(byType.get(it.type) ?? []), it])
	for (const [type, list] of byType) {
		const kind = String(kindOf(type) ?? "").replace(/,.*$/, "").replace(/\s*\(.*\)$/, "").trim().toLowerCase()
		if (!kind || kind.split(/\s+/).length < 2) continue
		const src = `\\bthe ${escRe(kind)}\\b`
		if (!new RegExp(src, "i").test(`${label} ${prompt}`)) continue
		if (!list.some((it) => !String(it.name ?? "").toLowerCase().includes(kind))) continue
		if (list.length > 1) return null
		const re = new RegExp(src, "gi")
		label = label.replace(re, String(list[0].name))
		prompt = prompt.replace(re, String(list[0].name))
	}
	// (a thing whose name on screen is only its kind's word, "Dominoes", is said as a group is, by its kind: "add 3 more dominoes to the
	// dominoes", never "to Dominoes" (V8832 swap / button / p3))
	for (const it of items) {
		const nm = String(it.name ?? "")
		if (!/^[A-Z][a-z]+$/.test(nm)) continue
		const stem = nm.toLowerCase().replace(/(oes|ies|es|s)$/, "")
		if (stem.length < 3 || !`${String(it.type ?? "").replace(/-/g, " ")} ${kindOf(it.type) ?? ""}`.toLowerCase().includes(stem)) continue
		const re = new RegExp(`\\b(to|of|on|onto|into|in|before|after|with|from|by|past|over|near|behind|beside|hits?|knocks?|reach(?:es)?) ${escRe(nm)}\\b`, "g")
		label = label.replace(re, (m, w) => `${w} the ${nm.toLowerCase()}`)
		prompt = prompt.replace(re, (m, w) => `${w} the ${nm.toLowerCase()}`)
	}
	return label === s.label && prompt === (s.prompt ?? "") ? s : { ...s, label: capFirst(label), prompt }
}
/** A chip that asks for an outcome without saying "make it work": "Land the apple in the bucket", "Knock all the cans over". */
const OUTCOME_IDEA = /^(land|get|send|drop|knock|topple|tip|reach|fling|launch|make)\b.*\b(in|into|over|down|off|onto|land|lands|fall|falls)\b/i
/** Words that change a thing: an idea with one of them about a failing goal's own things is a fix ("Bigger box to catch: make the box above
 *  the seesaw 1.5 times wider", "Lower the box a bit"). */
const CHANGE_W = /\b(swap|replace|use|move[sd]?|lower|raise|shift|slide|tilt|turn|widen|narrow|resize|lift|drop|nudge|angle|space|bigger|smaller|wider|narrower|taller|shorter|higher|closer|further|farther|steeper|flatter|times (wider|bigger|taller|longer))\b/i
/** An idea that is a fix in other words: it says what it is for ("so they topple easily", "so the tennis ball bounces higher") or tunes how
 *  things go ("heavier", "stiffer trampolines", "use empty cans", "… instead"). Beside a goal that fails, a fix offered or looked for, or on a
 *  fix's own card, it is an unchecked fix next to the checked one (V8820, 24 of 44 broken cards), so it is never shown there. */
export const FIX_IDEA = /\bso (that )?(it|they|the|its|their)\b|\b(heav(y|ier)|light(er)?|stiff(er)?|soft(er)?|bounc(y|ier)|tipp(y|ier)|wobbl(y|ier)|topples?|toppling|tips? (it |them )?over|knocks? (it |them )?over|more easily|easier|reliabl[ey]|bounces? higher|higher|farther|further|faster|slower|stronger|weaker|harder|full|fuller|empty|emptier|filled|instead)\b/i
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** Does an idea swap, replace or take away one of the kinds the person's change put in (kinds: their names, "orange", "soda can")? "Swap the
 *  orange for an apple" after "swap the bowling ball for an orange" undoes their choice (V8820 x8: the orange became an apple). */
export function undoesKinds(text, kinds = []) {
	const t = String(text ?? "")
	for (const k0 of kinds) {
		const k = String(k0 ?? "").trim().toLowerCase()
		if (k.length < 3) continue
		const kr = `${escRe(k)}(e?s)?`
		if (new RegExp(`\\b(swap|swapping|swapped|replace|replacing|replaced|remove|removing|take (away|out|off)|get rid of|delete|lose|ditch|trade)\\b[^.;:]{0,40}\\b${kr}\\b|\\b(instead of|in place of|rather than)\\s+(the\\s+|a\\s+|an\\s+)?(\\w+\\s+){0,2}${kr}\\b|\\b(turn|change|make)\\s+(the\\s+)?(\\w+\\s+){0,2}${kr}\\s+(into|to)\\s+(a|an|the|some)\\b|\\b${kr}\\s+(becomes?|turns? into)\\b`, "i").test(t)) return true
	}
	return false
}
const CHIP_STOP = new Set(["the", "and", "with", "from", "into", "onto", "make", "made", "move", "moved", "swap", "swapped", "more", "less", "left", "right", "down", "than", "them", "that", "this", "each", "it's", "its"])
const chipWords = (t) => new Set(String(t ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !CHIP_STOP.has(w) && !/^\d/.test(w)))
/**
 * The chips under an edit's card (r: its report): the checked fix first (one click puts it on the table), or, when nothing works, the AI's
 * rework (once: never after a rework, opts.rework); then the AI's own next edits, never one that asks to make it work (the offer or the
 * button says that, checked) and never one when it already works; then examples read off the scene (opts.examples, the latest card only),
 * never one about what a fix just moved. opts.isOutcome: words that state an outcome ("make it land in the box").
 */
const COUNT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, twenty: 20 }
const countOf = (w) => (/^\d+$/.test(w) ? Number(w) : COUNT_WORDS[String(w).toLowerCase()] ?? null)
/** The counts a request states for things on the table ("double the dominoes" with 7 of them: 14; "six soda cans": 6). counts: Map of a kind's
 *  words ("dominoes") -> how many there are now. -> Map word -> the count asked. */
/** A kind's words, plural and singular, as a regex alternation: "dominoes|domino", "soda cans|soda can", "boxes|box". */
const kindForms = (w) => {
	const p = String(w).toLowerCase()
	const one = p.replace(/(ch|sh|x|ss|o)es$/, "$1").replace(/ies$/, "y").replace(/(?<![su])s$/, "")
	return [...new Set([p, one])].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
}
export function statedCounts(text, counts = new Map()) {
	const out = new Map()
	const t = String(text ?? "").toLowerCase()
	for (const [w, n] of counts) {
		const k = `(?:${kindForms(w)})`
		const m = new RegExp(`\\b(?:(add|remove|take away)\\s+)?(double|twice as many|triple|half|halve|(\\d+|${Object.keys(COUNT_WORDS).join("|")}))\\s+(more\\s+|fewer\\s+|less\\s+)?(?:(?:of\\s+)?the\\s+)?(?:\\w+\\s+){0,2}?${k}\\b`).exec(t)
		if (!m) continue
		const c = countOf(m[2])
		const v = /^double|^twice/.test(m[2]) ? 2 * n : /^triple/.test(m[2]) ? 3 * n : /^hal/.test(m[2]) ? Math.round(n / 2) : c === null ? null : m[4] && /more/.test(m[4]) ? n + c : m[4] ? n - c : m[1] === "add" ? n + c : m[1] ? n - c : c
		if (v) out.set(w, v)
	}
	return out
}
/** Does an idea give a count of a kind other than the one the request states ("Add 3 more dominoes" after "double the dominoes": 10, not 14)? */
export function contradictsCount(idea, wanted, counts = new Map()) {
	const t = String(idea ?? "").toLowerCase()
	for (const [w, v] of wanted) {
		// (both words for the kind, "1 more domino" too; and "a second row of 7", "another 7", "7 extra": as many again, added (V8843 counts.mjs))
		const k = `(?:${kindForms(w)})`
		const m = new RegExp(`\\b(?:(add|remove|take away)\\s+)?(?:(a second row of|a second set of|another row of|another|an extra)\\s+)?(\\d+|${Object.keys(COUNT_WORDS).join("|")})\\s+(more\\s+|fewer\\s+|less\\s+|extra\\s+)?(?:\\w+\\s+){0,2}?${k}\\b`).exec(t)
		if (!m) continue
		const n = countOf(m[3])
		if (n === null) continue
		const now = counts.get(w) ?? 0
		const total = m[2] || (m[4] && /more|extra/.test(m[4])) ? now + n : m[4] ? now - n : m[1] === "add" ? now + n : /remove|take/.test(m[1] ?? "") ? now - n : n
		if (total !== v) return true
	}
	return false
}
/** A question the AI asked because what was asked doesn't fit on the table: the way that keeps all of it is to make the table longer. */
const NO_ROOM_RE = /\b(?:(?:past|off|beyond|over) the (?:table(?:['’]s)?(?: (?:end|edge))?|end|edge)|(?:table|table’s|table's) end|end of the table|no room|not enough room|no space|not enough space|(?:doesn|don|won)[’']?t fit|too long for the table|out of room|run(?:s|ning)? into|would (?:hit|crash into|overlap)|can['’]?t (?:move|go|fit|shift) (?:any )?(?:further|farther)|(?:no|any) further (?:right|left))\b/i
/** A question's own chips (each a reading of the request): never one that gives another count than the request states, and, when it asks for
 *  want of room, the table made longer first (V8841 c11 r2: "Space out the 7 dominoes" after "double the dominoes"). -> [{label, prompt}] */
export function askChips(r = {}, { asked = "", counts = null } = {}) {
	const wanted = counts instanceof Map && asked ? statedCounts(asked, counts) : new Map()
	const out = (r.suggestions ?? []).filter((s) => s?.label && s?.prompt && !(wanted.size && contradictsCount(`${s.label} ${s.prompt}`, wanted, counts)))
	if (asked && NO_ROOM_RE.test(String(r.reply ?? "")) && !out.some((s) => /\btable\b/i.test(`${s.label} ${s.prompt}`))) out.unshift({ label: "Make the table longer", prompt: `${String(asked).trim().replace(/[.!?\s]+$/, "")}, and make the table longer so everything fits.` })
	return out.slice(0, 4)
}
const clipChip = (t) => (String(t).length > 48 ? `${String(t).slice(0, 47).trimEnd()}…` : String(t))
export function editChips(r = {}, { rework = false, examples = [], asked = "", isOutcome = (t) => FIX_RE.test(t), mine = null, scene = undefined, sceneLive = false, counts = null } = {}) {
	const list = []
	const fx = r.fix
	const failed = (r.goals ?? []).filter((g) => g.ok === false)
	const works = (r.goals ?? []).length > 0 && !failed.length && !(r.targets ?? []).some((t) => t.ok === false)
	// (a reply that changed nothing is about the scene of the card before it (opts.scene: that card's report; null: no card put the scene on
	// the table): its ideas and examples follow that scene's goals and fix, never "Move the box 10 cm left" right after the egg landed ✓, nor
	// "Move the basket 10 cm left" beside a goal that fails (V8832 y2 / y19). With no such card, no example at all)
	const sc = r.replyOnly && scene !== undefined ? scene : null
	const scFailed = !!sc && ((sc.goals ?? []).some((g) => g.ok === false) || (sc.targets ?? []).some((t) => t.ok === false))
	const scFixing = !!sc && (!!sc.fix || !!sc.fixNeeded)
	const scJustFixed = !!sc && (sc.mode === "fix" || !!sc.fixApplied)
	const noExamples = r.replyOnly && scene !== undefined && (!sc || scFailed || scFixing || scJustFixed || !(sc.goals ?? []).length)
	// (the kinds the person's change put in: an idea never swaps, replaces or takes one away; opts.mine, else what the report keeps)
	const kinds = Array.isArray(mine) ? mine : Array.isArray(r.mineKinds) ? r.mineKinds : []
	if (fx?.state === "found" && fx.sceneJSON) list.push({ label: fx.label, prompt: `${capFirst(fx.say)} (checked: ${inSentence(fx.checked)} ✓)`, fix: true, go: true, apply: "fix" })
	// (a plain answer said after a card whose checked fix is still on offer for the scene on the table (opts.sceneLive): that fix, applied from
	// that card, so a question never takes the way back away: V8838 Q, "why does the tennis ball miss the box?" left no chip at all)
	else if (!fx && !r.fixNeeded && r.replyOnly && sceneLive && sc?.fix?.state === "found" && sc.fix.sceneJSON)
		list.push({ label: sc.fix.label, prompt: `${capFirst(sc.fix.say)} (checked: ${inSentence(sc.fix.checked)} ✓)`, fix: true, go: true, apply: "fix", sceneFix: true })
	else if (fx && ["none", "stopped", "error"].includes(fx.state)) {
		if (fx.near?.sceneJSON) list.push({ label: /^\d+ changes: /.test(fx.near.label ?? "") ? `Try ${fx.near.label}` : `Try: ${fx.near.label}`, prompt: `${capFirst(fx.near.say)}: the closest I found${fx.near.happened ? `, but ${inSentence(fx.near.happened)}` : " (it still misses)"}`, apply: "near" })
		// (on an edit's card the button sits right after the words that say nothing works: a chip here would say it twice)
		if (!rework && r.replyOnly) list.push({ label: "Ask the AI to rework it", prompt: fx.rework?.text ?? "", fix: true, rework: true })
	} else if (fx?.state === "searching") {
		// (the checked fix is on its way: no other fix is offered meanwhile)
	} else if (r.fixNeeded && !fx && !rework) list.push({ label: "Ask the AI to rework it", prompt: "", fix: true, rework: true })
	else if (failed.length && !r.replyOnly && r.mode !== "fix" && !rework) {
		const g = String(failed[0].label).replace(/[.!]+$/, "")
		list.push({ label: `Fix it so ${inSentence(g)}`, prompt: `Fix it so this happens in the run: ${g}. Change only what is needed for that (say what you moved), and keep everything else as it is.`, fix: true })
	}
	// (a goal an answer wanted lower, kept as the person set it, that still fails: the lower goal is offered, the person's last resort to choose,
	// never taken for them: ./goal-targets.js, V8956 F5)
	if (r.edit?.goalOffer?.label && r.edit.goalOffer.prompt && fx?.state !== "found" && (failed.length || r.reworkFailed || ["none", "stopped", "error"].includes(fx?.state)) && !list.some((x) => x.label === r.edit.goalOffer.label))
		list.push({ label: clipChip(r.edit.goalOffer.label), prompt: r.edit.goalOffer.prompt, fix: true })
	const outcome = (s) => isOutcome(s) || FIX_RE.test(s)
	// (out of reach: only ideas about the things that can't fit, never one that tries to win the goal some other way: "Heavier hit on the
	// seesaw" beside "the bowling ball can't fit the box's 5 cm opening": V8817 h1)
	const reachW = fx?.outOfReach ? chipWords(fx.why ?? "") : null
	const offReach = (t) => !!reachW && ![...chipWords(t)].some((w) => reachW.has(w) && !["can", "fit", "opening", "across"].includes(w))
	// (what a fix just changed: an idea about it would move it back)
	const fixed = r.mode === "fix" ? chipWords((r.human ?? []).join(" ")) : new Set()
	const aboutFixed = (t) => fixed.size > 0 && [...chipWords(t)].some((w) => fixed.has(w))
	// (an idea that is an outcome in other words, "Land the apple in the bucket", beside a checked fix or while one is being looked for, is a second,
	// unchecked "make it work": c06, 16 Oct)
	const fixing = list.some((x) => x.fix) || !!fx || !!r.fixNeeded
	// (a goal that fails, a fix offered or looked for, or a fix's own card: an idea that is a fix in other words is unchecked, never shown;
	// right after a fix that works, no idea at all: each would change the machine again (c00; V8820 swaps: "Add more dominoes" after "the
	// tennis ball lands in the box ✓"))
	// (an edit that went on the table with its fix, "Done, and I moved the bowling ball 1 cm left so it works", is a fix that just worked too)
	const broken = failed.length > 0 || (r.targets ?? []).some((t) => t.ok === false) || fixing || r.mode === "fix" || !!r.fixApplied || scFailed || scFixing || scJustFixed
	// (the words of the goals that fail: an idea that changes one of their things is a fix in other words)
	const failW = chipWords([...failed, ...(r.targets ?? []).filter((t) => t.ok === false)].map((g) => g.label).join(" "))
	// (while a goal fails, or a fix is offered, looked for or asked of the AI, or right after a fix: no idea of the AI's at all. Each is a tuning of
	// the machine nobody checked, and word lists kept letting them through beside the checked fix: "Use more soda cans", "Let dominoes grow
	// slightly", "Switch the fan on later", "Use real-size boxes" (V8832 P7))
	// (a question about a request that states a count: no idea that gives another count ("Add 3 more dominoes" after "double the dominoes"), and
	// when the question is for want of room, the way that keeps all of it, the table made longer, is offered first (V8837 c11 r1))
	const wanted = counts instanceof Map && asked ? statedCounts(asked, counts) : new Map()
	if (r.replyOnly && r.edit?.kind === "ask" && asked && NO_ROOM_RE.test(String(r.reply ?? "")) && !list.length)
		list.push({ label: "Make the table longer", prompt: `${String(asked).trim().replace(/[.!?\s]+$/, "")}, and make the table longer so everything fits.` })
	const ideas = broken ? [] : r.suggestions ?? []
	for (const s of ideas) {
		if (wanted.size && contradictsCount(`${s.label} ${s.prompt ?? ""}`, wanted, counts)) continue
		if (!s?.label || list.some((x) => x.label.toLowerCase() === String(s.label).toLowerCase())) continue
		const both = `${s.label} ${s.prompt ?? ""}`
		if (outcome(both) || aboutFixed(both) || offReach(both)) continue
		if (fixing && OUTCOME_IDEA.test(String(s.label))) continue
		if (undoesKinds(both, kinds)) continue
		if (broken && FIX_IDEA.test(both)) continue
		// (nor one that changes what a failing goal is about, "Lower the box a bit" beside "Ball 2 never lands in the box": a fix, unchecked)
		if (!reachW && failW.size && CHANGE_W.test(both) && [...chipWords(both)].some((w) => failW.has(w))) continue
		// (out of reach: only an idea that changes the size of what can't fit or of its opening: moving the box changes nothing)
		if (reachW && !/\b(wid\w*|narrow\w*|bigg?\w*|larg\w*|small\w*|tiny|size|resize|opening|fit)\b/i.test(both)) continue
		list.push(s)
	}
	// (right after a fix that works, no example that changes the machine again: "Make Ramp 1 steeper" beside "the egg lands in the box ✓", c00;
	// and beside a goal that fails none either: "Make the ramp steeper" next to the checked fix reads as another, unchecked one)
	if (list.length < 2 && !(r.mode === "fix" && works) && !broken && !noExamples) {
		const said = String(asked ?? "").toLowerCase()
		// (while it works, never an example that moves a goal's own thing: "Move the box 10 cm left" right after "the egg lands in the box ✓")
		const goalW = chipWords((r.goals ?? []).map((g) => g.label).join(" "))
		for (const ex of examples) {
			if (list.length >= 3) break
			if (said.includes(String(ex).toLowerCase().slice(0, 12)) || list.some((x) => x.prompt === ex)) continue
			// (a "make it work" example beside the card's own offer or its "Ask the AI to rework it" button would be a second, unchecked one that
			// keeps nothing the person chose)
			if (outcome(ex) && (works || list.some((x) => x.fix) || !!fx || r.fixNeeded)) continue
			if (aboutFixed(ex) || offReach(ex) || undoesKinds(ex, kinds)) continue
			if (reachW && !/\b(wid\w*|narrow\w*|bigg?\w*|larg\w*|small\w*|tiny|size|resize|opening|fit)\b/i.test(ex)) continue
			if (works && /^move\b/i.test(ex) && [...chipWords(ex)].some((w) => goalW.has(w))) continue
			// (beside a goal that fails, an example about that goal's own things reads as a fix, and it is unchecked: "Move the box 10 cm left" beside
			// "the egg never lands in the box", next to the checked one)
			if (broken && [...chipWords(ex)].some((w) => goalW.has(w))) continue
			list.push({ label: ex, prompt: ex })
		}
	}
	return list
}
