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
	if (fx.state === "stopped" && fx.movedOn) return { text: "I stopped looking for a fix when the scene changed.", button: null }
	// (stopped because the scene went, and it is back: the same, with what can be asked again: V8832 y7)
	if (fx.state === "stopped") return { text: fx.back ? "I stopped looking for a fix when the scene changed." : "I stopped looking for a fix.", button }
	if (fx.state === "error") return { text: "I couldn’t look for a fix just now.", button }
	// (the person's own change puts it out of reach, a ball wider than the box: nothing else can fix it, so nothing is offered: the lead says
	// why and that nothing else can change it, so nothing more is said here)
	if (fx.outOfReach) return { text: "", button: null }
	const tried = fx.runs ? ` (I tried ${fx.runs} in the physics${fx.reworked ? " and the AI’s reworks" : ""}${fx.timedOut ? ", for a minute" : ""})` : fx.reworked ? " (the AI’s reworks too)" : ""
	if (fx.quiet) return { text: "", button }
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
export function editChips(r = {}, { rework = false, examples = [], asked = "", isOutcome = (t) => FIX_RE.test(t), mine = null, scene = undefined } = {}) {
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
	else if (fx && ["none", "stopped", "error"].includes(fx.state)) {
		if (fx.near?.sceneJSON) list.push({ label: `Try: ${fx.near.label}`, prompt: `${capFirst(fx.near.say)}: the closest I found${fx.near.happened ? `, but ${inSentence(fx.near.happened)}` : " (it still misses)"}`, apply: "near" })
		// (on an edit's card the button sits right after the words that say nothing works: a chip here would say it twice)
		if (!rework && r.replyOnly) list.push({ label: "Ask the AI to rework it", prompt: fx.rework?.text ?? "", fix: true, rework: true })
	} else if (fx?.state === "searching") {
		// (the checked fix is on its way: no other fix is offered meanwhile)
	} else if (r.fixNeeded && !fx && !rework) list.push({ label: "Ask the AI to rework it", prompt: "", fix: true, rework: true })
	else if (failed.length && !r.replyOnly && r.mode !== "fix" && !rework) {
		const g = String(failed[0].label).replace(/[.!]+$/, "")
		list.push({ label: `Fix it so ${inSentence(g)}`, prompt: `Fix it so this happens in the run: ${g}. Change only what is needed for that (say what you moved), and keep everything else as it is.`, fix: true })
	}
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
	const ideas = broken ? [] : r.suggestions ?? []
	for (const s of ideas) {
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
