// "Edit with AI": the drawer where the scene on screen is changed by chatting (only what is asked changes: every other item stays exactly as it
// was), built step by step in view and reported. A brand-new scene comes from New → Build with AI (./new-project.js), which hands its request to
// buildNew() here, so its progress and report show in the same thread. On an empty table the drawer builds what is described.
//   import { mountAiPanel } from "./ai/panel.js"
//   const ai = mountAiPanel({ api, getScene, getSim, getCatalog, drawPreview, applyScene, replay, undo, historyIndex, draft, toast, viewport, button, profile })
//   ai.open() / ai.close() / ai.toggle() / ai.isOpen() / ai.attach(files)
// Desktop: a drawer on the right, over the picture (the 3D view is never resized, so it never re-frames). As soon as the plan is placed, the scene
// shows in the view as a draft (host.draft(null, scene): as placed; then host.draft(sim): its run), updated in place as checks and tuning go on
// ("Draft · Refining 1/3…"), and the drawer folds to a small chip at the view's corner so the scene can be watched; the chip opens it again. The
// result still lands as one undo step; Stop puts the view back exactly as it was. Long model steps show the server's word on them (a place in the
// queue, the model's thinking and writing in tokens). After a build it folds the same way (unless it was opened during the build). Phone: a bottom
// sheet that gets out of the way. Older result cards offer "Restore this version" (the last 6 builds keep their scene); only the latest has Undo.
// The pipeline is ./orchestrator.js; the critique pictures come from ./shot.js. Conversation turns are kept per ?profile in this browser.
// After an edit that stops a goal, the reply says what happens instead and "Looking for a fix…" while ./fixer.js searches (on ./fix-pool.js's
// workers); then it offers the checked fix as the first chip ("Want me to lower the box 4 cm? (checked: Ball 2 lands in the box ✓)"). A click (or
// "yes") puts that exact scene on the table at once, as its own undo step: "Done — I lowered the box 4 cm. Ball 2 lands in the box ✓". With no
// checked fix in the budget it says so, and offers the closest miss and "Ask the AI to rework it".
// Round 3 (ai/research/round3-plan.md §5): a new scene from words gets the "Picturing the scene" row and, the moment it arrives, the concept
// sketch in the progress card (labelled AI-generated, with what it is built from and the idea step by step); the result card keeps it as a small
// thumbnail that opens it next to the scene's start. An edit is answered with one card per kind (./edit-turns.js): a question with a chip per
// reading, an answer, an undo, "Build it as a new scene…", or the edit card: exactly what changed in real units, "Everything else is exactly as
// it was (N items untouched)", a heads-up and the pre-checked fix chip (Details: what it understood, why, time, model). Never a concept there.
import { createOrchestrator, prepareImages, STEP_LABELS, MAX_IMAGES, AiError, ACTION_KINDS, statesOutcome, planAfterFix, fixInfo, humanChangeList, goalResults, keptByWords, keepClauses } from "./orchestrator.js"
// (the fix search's own progress words, "· 42 physics runs": named apart from this file's progressWords, a model step's progress, which
// shadowed it, so "Looking for a fix…" never said what it was doing: V8814, 16 Oct)
import { editChips, askChips as askChipsOf, offerWords, progressWords as fixProgressWords, reworkWords, nameAsShown } from "./edit-turns.js"
import { kindNoun } from "./words.js"
import { createShot } from "./shot.js"
import { createFixPool } from "./fix-pool.js"
import { aiAccess, atWhen } from "./access.js"
import { conceptRoute } from "./imagine.js"
import { conceptSetting } from "./new-project.js"

const TIMELINE = ["imagine", "observe", "plan", "solve", "simulate", "reconcile", "stagetune", "refine", "tune", "fix", "apply"]
const ICONS = {
	sparkle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".75"/></svg>`,
	close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>`,
	image: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9.6l3.6-3.6 3 3 4.4-4.4L19 13.6V6zm3.5 1.5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5z"/></svg>`,
	send: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l7 7-1.4 1.4-4.6-4.6V20h-2V7.8l-4.6 4.6L5 11z"/></svg>`,
	stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>`,
	check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>`,
	cross: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5.6 12 10.6l5-5 1.4 1.4-5 5 5 5-1.4 1.4-5-5-5 5L5.6 17l5-5-5-5z"/></svg>`,
	replay: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>`,
	undo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5v-3.5h6a3.5 3.5 0 0 1 0 7h-2v2h2a5.5 5.5 0 0 0 0-11H9z"/></svg>`,
	retry: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4z"/></svg>`,
	newchat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h11v2H6v11h11v-9h2v11H4zM18 2h2v3h3v2h-3v3h-2V7h-3V5h3z"/></svg>`,
	chain: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="7" r="2.5"/><path d="M8 10l9 6-1 1.6-9-6zM15.5 9h2v9h-2zM19 9h2v9h-2z"/></svg>`,
	pins: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="16" r="4"/><path d="M14 6a1.5 1.5 0 0 1 3 0c0 1-.6 1.6-.6 2.6 0 1.4 1.6 2.6 1.6 5.4 0 3-1.1 5-2.5 5s-2.5-2-2.5-5c0-2.8 1.6-4 1.6-5.4 0-1-.6-1.6-.6-2.6z"/></svg>`,
	car: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l12-5 .6 1.8L3.6 10.8z" opacity=".55"/><path d="M5 14h3l2-3h5l3 3h1a1 1 0 0 1 1 1v2h-2a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H4v-2a1 1 0 0 1 1-1z"/></svg>`,
	lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0zm3 4a1.5 1.5 0 0 0-.75 2.8V18h1.5v-1.2A1.5 1.5 0 0 0 12 14z"/></svg>`,
	clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm1 3v4.6l3.4 2-1 1.7L11 12.7V7z"/></svg>`,
	off: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-2.4.8L8.4 2.1 10.1 8.1zM3.3 2 2 3.3l5.1 5.1L4.5 10l5.6 1.9L12 17.5l1.5-4.4L20.7 22l1.3-1.3z"/></svg>`,
	google: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>`,
	photo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l1.5 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5zm3 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>`
}
const ERROR_TITLES = {
	gateway: "Couldn’t reach the AI",
	busy: "The AI is busy",
	apply: "Couldn’t put it on the table",
	timeout: "That took too long",
	invalid: "The AI’s answer didn’t fit",
	nothing: "Nothing to build",
	engine: "The physics couldn’t run it",
	input: "Something’s missing",
	cancelled: "Stopped",
	sign_in: "Sign in with Google to use AI",
	quota: "You’ve used today’s AI allowance",
	off: "AI isn’t available on this deployment",
	access: "No access to the AI here"
}
const HISTORY_TURNS = 20 // (kept, and sent with an edit: the last ≤ 20 turns, the replies as shown, questions included: round3-plan §4.2 (1))
/** What a concept sketch is, said with it everywhere it shows. */
const CONCEPT_TAG = "Concept sketch · AI-generated"
const CONCEPT_CAPTION = "An AI picture of the idea, made from your words. The build follows your words, not the picture."
const KEEP_CONCEPTS = 3 // turns whose concept sketch (and start frame) are kept in this browser's storage
const CONCEPT_MAX = 400000 // a kept concept's data URL, in characters (a bigger one, like the Gemini fallback's ~0.7 M, is drawn again smaller first)
const num0 = (v) => (Number.isFinite(v) ? v : 0)
const MAX_TEXT = 8000 // the server's limit for a request's words

// ---------------------------------------------------------------- tiny DOM helpers
function h(tag, attrs = {}, ...kids) {
	const el = document.createElement(tag)
	for (const [k, v] of Object.entries(attrs ?? {})) {
		if (v === undefined || v === null || v === false) continue
		if (k === "class") el.className = v
		else if (k === "html") el.innerHTML = v
		else if (k === "text") el.textContent = v
		else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v)
		else if (k === "style" && typeof v === "object") Object.assign(el.style, v)
		else el.setAttribute(k, v === true ? "" : v)
	}
	for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
	return el
}
const icon = (name, cls = "ai-ic") => h("span", { class: cls, html: ICONS[name] ?? "" })
const secs = (ms) => (ms == null ? "" : ms < 1000 ? `${Math.max(0.1, ms / 1000).toFixed(1)} s` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`)
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`
const isImageFile = (f) => f && (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|heic|heif|bmp|avif)$/i.test(f.name ?? ""))
const reduceMotion = () => matchMedia?.("(prefers-reduced-motion: reduce)").matches
/** A plain question (it asks, it does not ask for anything to be built or changed): "what is the ball made of?", "how heavy is the box?" */
const BUILD_WORDS = /\b(build|make|create|add|put|place|set up|setup|recreate|construct|design|replace|remove|delete|move|change|swap|turn|raise|lower|use|give|let|show me)\b|^\s*(show|try)\b/i
/** A request worded as a question or a wish ("can you show a pendulum…?", "how about a bowling ball…?", "what if…", "I want…", "let's…"): build it. */
const BUILD_ASK = /^\s*(please\s+)?(can|could|would|will) you\b|\b(how|what) about\b|\bwhat if\b|\bi['’]?d (like|love)\b|\bi (want|would like|need)\b|\blet['’]?s\b/i
export const isQuestion = (t) => {
	// ("and what does the seesaw do?", "so why does it miss?": a question all the same (V8842: tagged CHANGE))
	const s = String(t ?? "").trim().replace(/^(?:and|but|so|ok(?:ay)?|also|then|hmm+|um+|oh|right|well)\b[\s,]*/i, "")
	if (!s) return false
	if (/\b(just tell me|tell me|don['’]t change|do not change|without changing|no changes|don['’]t build|do not build)\b/i.test(s)) return true
	if (BUILD_ASK.test(s)) return false
	// ("why doesn't the egg move?", "what happens if the box moves?": a wh-question is a question whatever verb it has (V8842 qj: tagged a change,
	// and it stopped the search))
	if (/\?\s*$/.test(s) && /^(why|what|how|where|when|which|who|whose)\b/i.test(s) && !/^how (?:do|can|could|would|should) (?:i|we|you) (?:make|build|add|put|get)\b/i.test(s)) return true
	if (BUILD_WORDS.test(s)) return false
	return (/\?/.test(s) && /^(what|which|how|why|where|when|who|whose|is|are|was|were|does|do|did|will|would|could|can|should|has|have)\b/i.test(s)) || /^(explain|describe what)\b/i.test(s)
}
const SCENE_WORDS_LOOSE = new Set(["the", "and", "with", "small", "large", "big", "little", "tall", "short", "long", "wide", "thin", "left", "right", "top", "bottom", "first", "second", "third", "last", "row", "wooden", "metal", "steel", "plastic", "glass", "red", "blue", "green", "yellow", "white", "black", "table", "wall"])
/** Does a question speak of the scene on the table: "it", "this scene", or one of its things by name or kind ("how heavy is the ramp?")? */
export function aboutScene(text, scene, typeNames = new Map()) {
	const s = String(text ?? "").toLowerCase()
	if (/\b(it|its|it['’]s|they|them|this|that|these|those)\b|\b(the|this|my) (scene|machine|set ?up|build|contraption|chain|thing)\b/.test(s)) return true
	// (what goes on in the run on the table: "what happens next?", "why does nothing move?", "how long does it take?")
	if (/\b(happen\w*|going on|next|work(s|ing|ed)?|nothing|everything|anything|how long|how fast|how far|how high)\b/.test(s)) return true
	const said = new Set(s.split(/[^\p{L}\p{N}]+/u).filter(Boolean).flatMap((w) => [w, w.replace(/(es|s)$/, "")]))
	for (const it of scene?.items ?? []) {
		if (it.type === "table" || it.type === "wall") continue
		for (const w of `${it.name ?? ""} ${typeNames.get(it.type) ?? ""} ${String(it.type ?? "").replace(/-/g, " ")}`.toLowerCase().split(/[^\p{L}\p{N}]+/u))
			if (w.length > 2 && !SCENE_WORDS_LOOSE.has(w) && !/^\d+$/.test(w) && (said.has(w) || said.has(w.replace(/(es|s)$/, "")))) return true
	}
	return false
}
/** Words that ask for another way than the one on offer: "…instead?", "besides moving the box", "is there another way", "without moving the box". */
export const ALT_RE = /\b(instead|besides|other than|another way|other ways?|rather than|without|apart from|except|different way|alternative)\b/i
/** A reply's last sentence that proposes a change of its own: it asks back, or offers one ("Want me to…?", "I could…", "…would fling it higher",
 *  "try a steeper tilt"). */
export const PROPOSES_RE = /\?\s*$|\b(want me to|should I|shall I|I could|I can(?!['’]t|not)|would you like|you could|try (?:a|an|the|making|moving|tilting|raising|lowering|adding|swapping|using)|would (?:fling|send|make|help|work|give|launch|lift|push|throw|carry|let|get))\b/i
/** A text's last sentence. */
export const lastSentence = (t) => String(t ?? "").trim().split(/(?<=[.!?])\s+(?=[A-Z“"(])/).filter(Boolean).at(-1) ?? ""
/** A yes to the reply's offer: "yes", "yes please", "do it", "sure", "go ahead". */
export const YES_RE = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|please( do)?|do it|go ahead|yes,? (please|do it)|sounds good|let'?s do (it|that)|do that|apply it|fix it)[\s.!]*$/i
/** A bare "make it work (again)" / "fix it" / "get it working": what the live card offers, checked, answers it before any AI call (V8832 y8:
 *  typed beside the checked laptop chip, two model calls and 22 s found the same laptop). */
export const MAKE_WORK_RE = /^\s*(please\s+)?(can you\s+|could you\s+)?(make (it|this|that|everything) (work|go)( again| now)?|fix (it|this|that)( again| now)?|get (it|this) (to )?work(ing)?( again)?|make it work again please)(,?\s*please)?[\s.!?]*$/i
const capFirst = (s) => String(s ?? "").replace(/^./, (c) => c.toUpperCase())
const lcFirstWord = (s) => String(s ?? "").replace(/^(AI\b)?./, (c, ai) => (ai ? c : c.toLowerCase()))
/** A phone or a tablet has no ⌘Z: the words say Undo / Redo there. */
const touchScreen = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
const lcFirst = (s) => {
	const t = String(s ?? "")
	return /^(The|A|An|All|Every|Each|Both|Only|None|It|Its|Now)\b/.test(t) ? t[0].toLowerCase() + t.slice(1) : t
}
/** Undo asked for in words, and nothing else: "undo", "undo that", "go back", "put it back the way it was", "revert". */
export const isUndoAsk = (t) => /^\s*(please\s+)?(undo( (that|it|this|the last (change|build|one)))?|go back|revert( (that|it|this))?|put (it|everything) back( the way it was| as it was)?|restore the (old|previous|last) (scene|version))[\s.!]*$/i.test(String(t ?? ""))
/** The words of a "start over" request, for New → Build with AI's box: "start over with a catapult…" -> "A catapult…" (also "from scratch",
 *  "instead,", "scrap this and …"). */
export function newSceneWords(text) {
	let s = String(text ?? "").trim()
	for (let i = 0; i < 3; i++) {
		const was = s
		s = s
			.replace(/^(please\s+)?(can you\s+|let['’]?s\s+)?(start (over|again|afresh|fresh)|begin again|scrap (this|that|it)|throw (this|that|it) away)\s*(and|with|:|,|-|—)?\s*/i, "")
			.replace(/^(and\s+)?(from scratch|instead)\s*[,:—-]?\s*/i, "")
			.replace(/^(and\s+)?(build|make|create)\s+(me\s+)?a new scene\s*(with|of|:)?\s*/i, "")
			.replace(/,?\s*(from scratch|instead)\s*([.!]*)$/i, "$2")
			.trim()
		if (s === was) break
	}
	return s ? s[0].toUpperCase() + s.slice(1) : String(text ?? "").trim()
}
/** An edit's first change line as a phrase to quote: "Made the dominoes closer together" -> "made the dominoes closer together" (a name
 *  like "Ball 2 …" keeps its capital). */
const changePhrase = (s) =>
	String(s ?? "")
		.replace(/\s*\([^)]*\)/g, "")
		.trim()
		.replace(/[.!]+$/, "")
		.replace(/^([A-Z][a-z]+)\b(?!\s+\d)/, (w) => w.toLowerCase())

// ================================================================ the panel
export function mountAiPanel(host) {
	const PROFILE = host.profile ?? null
	const KEY = PROFILE ? `sandbox@${PROFILE}:ai` : "sandbox:ai"
	const store = {
		get() {
			try {
				return JSON.parse(localStorage.getItem(KEY)) ?? null
			} catch {
				return null
			}
		},
		set(v) {
			try {
				localStorage.setItem(KEY, JSON.stringify(v))
				return true
			} catch {
				return false
			}
		}
	}
	let shot = null
	const conceptSmall = new Map() // a concept picture over the guard -> {p, url}: its smaller copy for keeping (shrinkConcept)
	const getShot = () => (shot ??= createShot({ looks: () => host.getCatalog()?.looks }))
	// ?aimock=1 (development only): the AI steps are answered by ./dev-mock.js, everything else is the real thing
	const mockP = new URLSearchParams(location.search).get("aimock") === "1" ? import("./dev-mock.js").then((m) => m.withMock(host.api)) : null
	const api = mockP ? async (...a) => (await mockP)(...a) : host.api
	// the fix search's workers (./fix-pool.js): made on the first edit, let go when idle
	let fixPool = null
	const getFixPool = () => (fixPool ??= createFixPool())
	const ai = createOrchestrator({ api, shot: { render: (sim, opts) => getShot().render(sim, opts) }, fixPool: getFixPool })

	// ---- state
	const saved = store.get()
	const S = {
		open: false,
		mode: "new", // "new" | "edit"
		images: [], // prepared images waiting to be sent
		turns: Array.isArray(saved?.turns) ? saved.turns.slice(-HISTORY_TURNS) : [],
		lastBuild: saved?.lastBuild ?? null, // {plan, sceneJSON, title}: what the last build put on the table (edits start from its plan while the scene is unchanged)
		job: null,
		running: null, // the turn being built
		unseen: false,
		mini: false, // the drawer is folded to its chip (desktop)
		keepOpen: false, // the drawer was opened during this build: it is not folded again until the next one
		lastAppliedId: null, // the turn whose build is on the table (its Undo is offered while that is still the current history entry)
		gone: Array.isArray(saved?.gone) ? saved.gone.slice(-60) : [], // turns removed (a failed one tried again): kept out of merges with other tabs
		since: num0(saved?.since) // "Start over" happened then: older turns are gone
	}
	S.mode = "edit" // (what the drawer does: syncMode() says, from the scene on screen)
	S.fixJob = null // the fix search running after an edit ({ctl, turnId})
	S.reworkOfNext = null // (the card whose "Ask the AI to rework it" sent the next request)
	const fixCtxs = new Map() // turn id -> the fix search's context (this page's life only: "Look again" after its Stop)
	for (const t of S.turns) if (t.report?.fix?.state === "searching") t.report.fix = { ...t.report.fix, state: "stopped" } // (it stopped with the page)
	/** The scene on the table, as JSON (what a turn's sceneJSON is compared with). */
	const tableJSON = () => {
		try {
			return JSON.stringify(host.getScene() ?? null)
		} catch {
			return null
		}
	}
	/** The same scene on the table, but for its name (V8820 x10: renaming the scene by hand took the checked offer away, and "yes" said there
	 *  was nothing to say yes to): what a turn's scene is compared with. The name-free form of each JSON is kept for the few last ones seen. */
	const keyCache = new Map()
	const sceneKey = (json) => {
		if (typeof json !== "string") return json ?? null
		let k = keyCache.get(json)
		if (k !== undefined) return k
		try {
			const o = JSON.parse(json)
			if (o && typeof o === "object" && !Array.isArray(o)) delete o.name
			k = JSON.stringify(o)
		} catch {
			k = json
		}
		if (keyCache.size >= 48) keyCache.delete(keyCache.keys().next().value)
		keyCache.set(json, k)
		return k
	}
	const sameTable = (a, b) => a === b || (typeof a === "string" && typeof b === "string" && sceneKey(a) === sceneKey(b))
	/** The last done card that put this scene (JSON) on the table, never a reply said after it: its goals, its fix and its kept scenes. */
	function sceneCard(json = tableJSON()) {
		return [...S.turns].reverse().find((x) => x.role === "ai" && x.state === "done" && !x.report?.replyOnly && x.sceneJSON && sameTable(x.sceneJSON, json)) ?? null
	}
	/** The card that is about the scene on the table: the last done turn that put this very scene there (after an Undo of a fix, the edit card it
	 *  came from), else the last done turn. Its chips, its offer and a "yes" are the live ones (V8814 s1, 16 Oct). */
	function activeTurn() {
		const done = S.turns.filter((x) => x.role === "ai" && x.state === "done")
		const now = tableJSON()
		const on = [...done].reverse().find((x) => !x.report?.replyOnly && x.sceneJSON && sameTable(x.sceneJSON, now))
		// (no card put this scene there, an Undo back past them all, a change by hand, another scene: no card is live, so no chip, offer or
		// "yes" acts on a scene that is gone (V8817 s3e / s7a: the undone edit's checked offer and ideas stayed, and an idea chip sent "…the
		// egg's flight…" for a scene with no egg). A reply asked about the scene on the table, after that, is still live)
		if (!on) {
			const last = done.at(-1)
			return last?.report?.replyOnly && last.baseJSON && sameTable(last.baseJSON, now) ? last : null
		}
		// (a reply that changed nothing, said after it, is still about this scene: it is the one to answer; never one that said the AI stopped
		// because the scene was undone or changed: that was about another scene, and after a Redo the card whose scene is back is the live one,
		// its button and "Look again" with it: V8832 y9)
		const after = done.slice(done.indexOf(on) + 1).filter((x) => !x.report?.movedOn)
		return after.length && after.every((x) => x.report?.replyOnly) ? after.at(-1) : on
	}
	/** A reply that changed nothing and offers nothing of its own (an answer to a question) leaves the card whose scene is on the table as the
	 *  one that offers: its checked fix, its "Try:", its button. -> that card, else null (V8838 Q: after "why does the tennis ball miss the box?"
	 *  the swap card went stale with its checked chip, the answer had none, and "yes" said there was nothing to say yes to). */
	const plainReply = (x) => !!x?.report?.replyOnly && !x.report.movedOn && !x.report.fix && !x.report.fixNeeded && !ownsOffer(x)
	/** The person's words a reply answers: the last thing they typed before it. */
	const askedBefore = (x) => {
		const i = S.turns.indexOf(x)
		return (i > 0 ? [...S.turns.slice(0, i)].reverse().find((y) => y.role === "user") : null)?.text ?? ""
	}
	/**
	 * A reply of the AI's that a "yes" can't mean the card before it for (V8842 qa / qq / qr, V8843 Q3 / Q4: "yes" lowered the box the person
	 * had just ruled out): a question back with choices of its own (kind ask), an answer to a question that asks for another way ("…instead?",
	 * "besides moving the box", "without moving the box"), or an answer whose last sentence proposes a change of its own ("…would fling it
	 * higher", "Want me to…?"). -> "ask" | "proposal" | "other" | null.
	 */
	function ownOffer(x) {
		const r = x?.report
		if (!r?.replyOnly || !r.edit || r.movedOn) return null
		if (r.edit.kind === "ask" && (r.suggestions ?? []).length) return "ask"
		if (r.edit.kind !== "answer") return null
		if (PROPOSES_RE.test(lastSentence(r.reply))) return "proposal"
		return ALT_RE.test(askedBefore(x)) ? "other" : null
	}
	const ownsOffer = (x) => !!ownOffer(x)
	/** The card whose checked fix a reply that owns an offer may still show: never one whose fix changes what the question said to keep. */
	function offerBeside(x) {
		if (!ownOffer(x) || ownOffer(x) === "ask") return null
		const sc = sceneCard(x.baseJSON && sameTable(x.baseJSON, tableJSON()) ? x.baseJSON : tableJSON())
		if (!sc || !sameTable(sc.sceneJSON, tableJSON()) || sc.report?.fix?.state !== "found") return null
		const done = S.turns.filter((y) => y.role === "ai" && y.state === "done")
		if (!done.slice(done.indexOf(sc) + 1).every((y) => y.report?.movedOn || plainReply(y) || y === x)) return null
		return fixKeeps(sc, askedBefore(x)) ? sc : null
	}
	/** A local reply that names a card's checked fix as one of the choices ("Which change do you mean? The checked one is …"): that card, while its
	 *  fix is still on offer for the scene on the table. */
	function offerFromOf(x) {
		const id = x?.report?.offerFrom
		const sc = id ? S.turns.find((y) => y.id === id) : null
		return sc && sc.report?.fix?.state === "found" && sameTable(sc.sceneJSON, tableJSON()) ? sc : null
	}
	/** Does a card's checked fix leave alone what `words` say to keep ("without moving the box")? */
	function fixKeeps(sc, words) {
		try {
			const kept = keptByWords(words, JSON.parse(sc.sceneJSON))
			if (!kept.size) return true
			const ch = sc.report?.fix?.changes ?? []
			const ids = new Set(ch.flatMap((c) => (Array.isArray(c?.ids) ? c.ids : c?.id !== undefined ? [c.id] : [])))
			if ([...kept].some((id) => ids.has(id))) return false
			// (and what rides on it: compared on the fix's own scene)
			const a = JSON.parse(sc.sceneJSON)
			const b = sc.report?.fix?.sceneJSON ? JSON.parse(sc.report.fix.sceneJSON) : null
			if (!b) return true
			return ![...kept].some((id) => {
				const p = a.items.find((i) => i.id === id)
				const q = b.items.find((i) => i.id === id)
				return !p || !q || Math.abs((p.x ?? 0) - (q.x ?? 0)) > 1e-4 || Math.abs((p.y ?? 0) - (q.y ?? 0)) > 1e-4 || JSON.stringify(p.props ?? {}) !== JSON.stringify(q.props ?? {})
			})
		} catch {
			return true
		}
	}
	function offeringCard(act = activeTurn()) {
		if (!plainReply(act)) return null
		const sc = sceneCard(act.baseJSON && sameTable(act.baseJSON, tableJSON()) ? act.baseJSON : tableJSON())
		if (!sc || !sameTable(sc.sceneJSON, tableJSON())) return null
		const done = S.turns.filter((x) => x.role === "ai" && x.state === "done")
		// (every card after it is a plain reply: one that offers something of its own, a rework's reply, a "yes" that waited, is the live one)
		return done.slice(done.indexOf(sc) + 1).every((x) => x.report?.movedOn || plainReply(x)) ? sc : null
	}
	// the app's history moved (⌘Z, the top bar's Undo, another scene, a change by hand): the cards follow it (Undo / Restore, which card is live,
	// the folded chip's words). The app gives the panel no event for it: its history index is read a few times a second (a number compare)
	let seenHi = host.historyIndex?.() ?? null
	setInterval(() => {
		const hi = host.historyIndex?.() ?? null
		// (an edit or a check the AI works on is for the scene it started from: when that is gone, by an Undo or a change by hand, it stops)
		if (hi === seenHi) return void (S.job && S.running && watchJob())
		seenHi = hi
		onHistory()
	}, 400)

	// ---- DOM
	const drawer = h("aside", { class: "ai-drawer", id: "ai-drawer", role: "dialog", "aria-modal": "false", "aria-labelledby": "ai-title", hidden: true })
	const grip = h("div", { class: "ai-grip", "aria-hidden": "true" })
	const btnNew = h("button", { type: "button", class: "ai-icon-btn", title: "Start over (a new conversation)", "aria-label": "Start a new conversation" }, icon("newchat"))
	const btnClose = h("button", { type: "button", class: "ai-icon-btn", title: "Close (Esc)", "aria-label": "Close the AI panel" }, icon("close"))
	const headSub = h("p", { class: "ai-sub" }, "Only what you ask changes")
	const head = h(
		"header",
		{ class: "ai-head" },
		h("span", { class: "ai-mark", "aria-hidden": "true", html: ICONS.sparkle }),
		h("div", { class: "ai-head-t" }, h("h2", { id: "ai-title" }, "Edit with AI"), headSub),
		btnNew,
		btnClose
	)
	const scroll = h("div", { class: "ai-scroll" })
	const hero = h("section", { class: "ai-hero" })
	const thread = h("ol", { class: "ai-thread", "aria-label": "Conversation" })
	// (next edits and the rework button are the latest reply's only: the older cards are marked by turn (.ai-stale), never by being followed by
	// something (a bubble, another tab's turn merged in), which hid the latest card's buttons too: D1, 16 Oct)
	// (and the latest is the card whose scene is on the table: after the fix card's Undo, the edit card it came from is the live one again, its
	// checked chip with it; a card whose scene was undone is stale, never "Done" with buttons for a scene that is gone: V8814 s1, 16 Oct)
	const markLatest = () => {
		const bots = [...thread.querySelectorAll(":scope > li.ai-bot")]
		const act = activeTurn()
		const at = act ? bots.findIndex((li) => li.dataset.id === act.id) : -1
		// (a plain answer after the card whose scene is on the table keeps that card live: its checked offer is still the one to take)
		const offering = offeringCard(act)
		const stateOf = (li) => S.turns.find((x) => x.id === li.dataset.id)?.state
		bots.forEach((li, i) => {
			const t = S.turns.find((x) => x.id === li.dataset.id)
			// (a reply that changed nothing after the live card stays live: its chips are about the scene on the table; a card still being built
			// is never stale; with no live card at all, every card is stale)
			// (a card that was stopped or failed is live only until a later card is done: its "Run again" never sends another rework after one
			// has already answered: V8832 y15, a cancelled rework's "Run again" pressed after the button's second rework failed, $0.13 more and a
			// result with the person's boxes made 1.5 m deep)
			const busy = !t || t.state === "running"
			const ended = !!t && t.state !== "done" && t.state !== "running"
			const live = busy || (ended ? !bots.slice(i + 1).some((x) => stateOf(x) === "done") : (at >= 0 && (i === at || (i > at && !!t?.report?.replyOnly && i === bots.length - 1))) || (!!offering && t?.id === offering.id))
			li.classList.toggle("ai-stale", !live)
			// (the checked chip shows once, on the newest live card: the answer after it shows it, so the card it came from doesn't as well (V8842:
			// the same green chip twice at once))
			li.classList.toggle("ai-offer-moved", live && !!offering && t?.id === offering.id && !!act && act.id !== offering.id)
		})
	}
	if (typeof MutationObserver === "function") new MutationObserver(markLatest).observe(thread, { childList: true })
	// a card's buttons act once per click: the second click of a double click, or any click a moment after one that changed the table, is
	// dropped (V8817 s5b: a double click on the fix chip put the fix on the table, its card's chips folded away, and the second click landed on
	// the Restore that slid under the pointer, undoing it)
	let shieldUntil = 0
	const shield = (ms = 450) => (shieldUntil = performance.now() + ms)
	thread.addEventListener(
		"click",
		(e) => {
			if (!e.target?.closest?.("button")) return
			if (e.detail > 1 || performance.now() < shieldUntil) {
				e.stopImmediatePropagation()
				e.preventDefault()
			}
		},
		true
	)
	thread.addEventListener("dblclick", (e) => e.target?.closest?.("button") && (e.stopImmediatePropagation(), e.preventDefault()), true)
	scroll.append(hero, thread)
	const live = h("div", { class: "ai-sr", "aria-live": "polite", "aria-atomic": "true" })

	// what the drawer works on, said up front: the scene on screen (it is changed, never replaced)
	const editingName = h("b", {}, "")
	const editingK = h("span", { class: "ai-editing-k" }, "Editing")
	const editingNew = h("button", { type: "button", class: "ai-link", onclick: () => host.openNew?.({ ai: true }), title: "A brand-new scene: New → Build with AI (N)" }, "New scene…")
	const editing = h("div", { class: "ai-editing", role: "note" }, editingK, editingName, editingNew)
	const attachRow = h("div", { class: "ai-attach-row", "aria-label": "Attached images" })
	const input = h("textarea", { class: "ai-input", rows: "3", maxlength: String(MAX_TEXT), placeholder: "Change this scene… e.g. swap the red ball for a basketball", "aria-label": "Ask for a change to the scene", spellcheck: "true", enterkeyhint: "send" })
	const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true })
	const btnAttach = h("button", { type: "button", class: "ai-icon-btn ai-attach", title: "Add images (or drop / paste them)", "aria-label": "Add images" }, icon("image"))
	const btnSend = h("button", { type: "submit", class: "ai-send", title: "Change it (Enter)", "aria-label": "Change it" }, icon("send"))
	const hint = h("span", { class: "ai-hint" }, "Enter to change it · Shift+Enter for a new line")
	const counter = h("span", { class: "ai-count", hidden: true, "aria-live": "polite" })
	const box = h("div", { class: "ai-box" }, attachRow, input, h("div", { class: "ai-box-bar" }, btnAttach, hint, counter, btnSend))
	// can the AI be used here (./access.js): when not, the box gives way to why, and what to do (sign in, wait for the allowance, or nothing here)
	const accessBox = h("div", { class: "ai-access", role: "note", hidden: true })
	const composer = h("form", { class: "ai-composer", novalidate: true }, editing, accessBox, box, fileInput)
	const dropZone = h("div", { class: "ai-drop", hidden: true }, h("div", { class: "ai-drop-in" }, icon("image", "ai-ic ai-drop-ic"), h("b", {}, "Drop images for this change"), h("span", {}, `The AI sees them with your words · up to ${MAX_IMAGES}`)))
	// the folded drawer: one line at the view's corner (what is happening, or the result), Stop while building, Show to open it again
	const miniTitle = h("b", {}, "")
	const miniSub = h("span", {}, "")
	const miniOrb = h("span", { class: "ai-orb", "aria-hidden": "true" })
	// (Stop: the build running, else the search for a fix after an edit: V8814 s4, the mini bar's Stop did nothing while it looked)
	const btnMiniStop = h("button", { type: "button", class: "ai-chip-btn", onclick: () => (S.job ? cancel() : stopFixSearch("user")) }, icon("stop"), "Stop")
	const btnMiniShow = h("button", { type: "button", class: "ai-chip-btn ai-primary", onclick: () => setMini(false, true) }, "Show")
	const miniBar = h("div", { class: "ai-mini", role: "status", "aria-live": "polite" }, miniOrb, h("div", { class: "ai-mini-t", onclick: () => setMini(false, true), title: "Open the AI panel" }, miniTitle, miniSub), btnMiniStop, btnMiniShow)
	drawer.append(grip, head, scroll, composer, live, dropZone, miniBar)
	document.body.append(drawer)
	// over the view while a draft plays: it is the AI's work in progress, not the scene yet
	const draftSub = h("span", {}, "")
	const draftBadge = h("div", { class: "ai-draft-badge", hidden: true, role: "status" }, h("span", { class: "ai-orb", "aria-hidden": "true" }), h("b", {}, "Draft"), draftSub)
	host.viewport?.append(draftBadge)

	// the view's drop overlay (a photo dropped on the 3D picture: New → Build with AI, with the photo)
	const viewDrop = host.viewport ? h("div", { class: "ai-view-drop", hidden: true }, h("div", {}, icon("sparkle", "ai-ic"), h("b", {}, "Drop a photo to build it as a new scene"))) : null
	if (viewDrop) host.viewport.append(viewDrop)

	// ---------------------------------------------------------------- hero (changes this scene could take)
	/** Things on the table (not the table, not the invisible safety walls). */
	const realItems = () => (host.getScene()?.items ?? []).filter((i) => i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d))
	/** A few changes the scene on screen could take, from what is in it ("Make the dominoes taller", "Swap Ball 1 for a basketball"). */
	function editExamples() {
		const its = realItems()
		const types = new Map((host.getCatalog()?.types ?? []).map((ty) => [ty.key, ty]))
		const nm = (it) => it.name || types.get(it.type)?.name || it.type
		const lcFirst = (s) => (/^[A-Z][a-z]/.test(s) && !/\d/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
		// (a name with a number of its own is said as it is, "Ball 2"; one of several of a kind by its kind's name, "the tissue box", never "the
		// Tissue box 1": V8817 b3)
		const callIt = (it) => {
			const n = nm(it)
			if (!/\d/.test(n)) return `the ${lcFirst(n)}`
			const kind = String(types.get(it.type)?.name ?? it.type).replace(/,.*$/, "")
			return /^[A-Z][a-z]+ \d+$/.test(n) && !kind.toLowerCase().includes(n.split(" ")[0].toLowerCase()) ? n : its.filter((i) => i.type === it.type).length > 1 ? `the first ${lcFirst(kind)}` : `the ${lcFirst(kind)}`
		}
		const out = []
		const ball = its.find((i) => /ball|marble/.test(i.type) && i.type !== "basketball")
		if (ball) out.push({ icon: "pins", text: `Swap ${callIt(ball)} for a basketball` })
		if (its.some((i) => i.type === "domino-row")) out.push({ icon: "chain", text: "Make the dominoes taller" })
		// (a container: a box, a cup, a bucket or a basket, never a tissue box or a cereal box)
		const box = its.find((i) => ["box", "cup", "bucket", "basket", "plastic-cup", "glass-jar"].includes(i.type))
		if (box) out.push({ icon: "car", text: `Move ${callIt(box)} 10 cm left` })
		if (its.some((i) => i.type === "domino-row")) out.push({ icon: "chain", text: "Add 5 more dominoes" })
		const plank = its.find((i) => i.type === "plank")
		if (plank && out.length < 4) out.push({ icon: "car", text: `Make ${callIt(plank)} steeper` })
		if (out.length < 3) out.push({ icon: "pins", text: "Add a tennis ball that rolls into it" }, { icon: "chain", text: "Make it work" })
		return out.slice(0, 4)
	}
	function renderHero() {
		hero.innerHTML = ""
		hero.hidden = S.turns.length > 0
		syncAccessBox()
		if (hero.hidden) return
		// (where the AI can't be used, the empty drawer says so first, in place of the welcome that says what it does: ./access.js)
		if (away()) {
			const st = access.state
			hero.append(
				...[
					h("div", { class: "ai-hero-art ai-hero-art-off", "aria-hidden": "true", html: ICONS[st.kind === "quota" ? "clock" : "off"] }),
					h("h3", {}, st.title),
					h("p", {}, st.text),
					st.kind === "off" && host.openNew ? h("button", { type: "button", class: "ai-chip-btn", onclick: () => host.openNew({ pick: "example" }) }, "Start from an example") : null
				].filter(Boolean)
			)
			return
		}
		const n = host.getCatalog()?.types?.length ?? 113
		const has = realItems().length > 0
		hero.append(
			...[
			h("div", { class: "ai-hero-art", "aria-hidden": "true", html: ICONS.sparkle }),
			h("h3", {}, has ? "Say what to change." : "Describe it. Watch it work."),
			h(
				"p",
				{},
				has
					? "Only what you ask for changes: everything else stays exactly where it is. Each change is run in the physics engine, and one ⌘Z takes it back."
					: `The table is empty: say what should happen and it is built here from ${n} real objects at their true sizes and weights, run in the physics engine and refined until it works.`
			),
			has && access.state.kind === "ok"
				? h("div", { class: "ai-examples", role: "list" }, editExamples().map((ex) => h("div", { class: "ai-ex-li", role: "listitem" }, h("button", { type: "button", class: "ai-ex", onclick: () => ((input.value = ex.text), autosize(), syncSend(), input.focus()), title: "Put this in the box (Enter changes it)" }, icon(ex.icon, "ai-ic ai-ex-ic"), h("span", {}, ex.text)))))
				: null,
			h("p", { class: "ai-hero-new" }, "A whole new scene? ", h("button", { type: "button", class: "ai-link", onclick: () => host.openNew?.({ ai: true }) }, "New → Build with AI"), host.openNew ? null : "")
			].filter(Boolean) // (append() would write a null as the word "null")
		)
	}

	// ---------------------------------------------------------------- what it works on, attachments, input
	/** The drawer changes the scene on screen; on an empty table it builds what is described there (there is nothing to keep). */
	function syncMode() {
		const has = realItems().length > 0
		S.mode = has ? "edit" : "new"
		const name = host.getScene()?.name || "this scene"
		// (while a new scene is built, the composer says so: it is not an edit of the scene still on the table)
		const building = S.running?.request?.mode === "new" ? String(S.running.request.text ?? "").trim() : null
		editingK.textContent = building !== null ? "New scene" : "Editing"
		editingName.textContent = building !== null ? building || "from your picture" : has ? name : "an empty table"
		editingName.title = building !== null ? building : has ? `Changes to “${name}” keep everything you don't mention exactly as it is` : ""
		editingNew.hidden = building !== null
		headSub.textContent = has ? "Only what you ask changes" : "Builds on the empty table"
		input.placeholder = has ? "Change this scene… e.g. swap the red ball for a basketball" : "Describe a machine to build on the empty table…"
		hint.textContent = has ? "Enter to change it · Shift+Enter for a new line" : "Enter to build · Shift+Enter for a new line"
		if (!S.job) btnSend.title = has ? "Change it (Enter)" : "Build (Enter)"
		if (!hero.hidden && hero.dataset.has !== String(has)) ((hero.dataset.has = String(has)), renderHero())
	}

	// ---------------------------------------------------------------- whether the AI can be used here, said before anything is typed
	const access = aiAccess()
	const blocked = () => access.state.kind !== "ok"
	/** The AI can't be used here at all (no AI on this deployment, the allowance used up, no access): nothing to type, only why. */
	const away = () => ["off", "quota", "access"].includes(access.state.kind)
	/** The notice in place of the box: hidden when the AI can be used, or when the empty drawer's hero already says why. */
	const syncAccessBox = () => (accessBox.hidden = access.state.kind === "ok" || (away() && !hero.hidden))
	function renderAccess(st = access.state) {
		const off = st.kind !== "ok"
		box.hidden = off
		editing.hidden = off && st.kind !== "sign_in"
		syncAccessBox()
		accessBox.dataset.kind = st.kind
		accessBox.replaceChildren()
		host.button?.classList.toggle("ai-off", st.kind === "off")
		if (host.button) {
			host.button.dataset.title ??= host.button.title
			host.button.title = st.kind === "off" || st.kind === "quota" ? `Edit with AI: ${lcFirstWord(st.title)}` : host.button.dataset.title
		}
		if (off) {
			// (the allowance used up: the card in the thread already says it in full; here only when the AI is back)
			const back = st.kind === "quota" ? (st.when ? atWhen(st.when) : /resets (.+)$/.exec(st.title ?? "")?.[1]?.replace(/^it /, "") ?? "later") : null
			accessBox.append(icon(st.kind === "sign_in" ? "lock" : st.kind === "quota" ? "clock" : "off", "ai-ic ai-access-ic"), h("div", { class: "ai-access-t" }, back ? h("b", {}, `AI is back ${back}`) : [h("b", {}, st.title), h("p", {}, st.text)]))
			const acts = []
			if (st.kind === "sign_in" && !st.unavailable) acts.push(h("button", { type: "button", class: "ai-google", onclick: () => (saveDraft(), access.signIn({ kind: "edit" }) || note("Sign-in isn’t available on this page")) }, h("span", { class: "ai-g", html: ICONS.google, "aria-hidden": "true" }), "Continue with Google"))
			if (st.kind === "off" && host.openNew) acts.push(h("button", { type: "button", class: "ai-chip-btn", onclick: () => host.openNew({ pick: "example" }) }, "Start from an example"))
			if (acts.length) accessBox.append(h("div", { class: "ai-access-acts" }, acts))
		}
		if (!hero.hidden) renderHero()
		syncSend()
	}
	access.onChange(() => renderAccess())
	// (what is typed in the box is kept for this tab: a trip to Google to sign in, or a reload, doesn't lose it)
	const DRAFT_KEY = `${KEY}:draft`
	function saveDraft() {
		try {
			if (input.value.trim()) sessionStorage.setItem(DRAFT_KEY, input.value)
			else sessionStorage.removeItem(DRAFT_KEY)
		} catch {}
	}
	input.addEventListener("input", saveDraft)
	try {
		const d = sessionStorage.getItem(DRAFT_KEY)
		if (d && !input.value) input.value = d
	} catch {}

	function autosize() {
		input.style.height = "auto"
		const min = S.turns.length ? 48 : 84
		input.style.height = `${Math.min(220, Math.max(min, input.scrollHeight))}px`
	}
	input.addEventListener("input", () => (autosize(), syncSend(), syncCount()))
	/** Near the limit, how many characters are left. */
	function syncCount() {
		const n = input.value.length
		counter.hidden = n < MAX_TEXT * 0.85
		counter.textContent = `${MAX_TEXT - n} left`
	}
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
			e.preventDefault()
			submit()
		}
		// ⌘Z with nothing typed is the scene's Undo (as the toast and the Undo button say); ⌘⇧Z / ⌘Y its Redo. With words in the box it is the box's own.
		const key = e.key.toLowerCase()
		if ((e.metaKey || e.ctrlKey) && !e.altKey && (key === "z" || key === "y") && !input.value) {
			e.preventDefault()
			if (key === "z" && !e.shiftKey) host.undo?.()
			else if (host.redo) host.redo()
			else window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", shiftKey: true, metaKey: e.metaKey, ctrlKey: e.ctrlKey })) // (the app's own ⌘⇧Z)
			syncUndoButtons()
		}
	})
	composer.addEventListener("submit", (e) => {
		e.preventDefault()
		// the Build button turns into Stop while building: a second click of a double-click (or an impatient one) must not stop what it just started
		if (S.job) {
			if (performance.now() - S.jobStarted > 1200) cancel()
		} else submit()
	})
	function syncSend() {
		const running = !!S.job
		btnSend.classList.toggle("stop", running)
		btnSend.innerHTML = ""
		btnSend.append(icon(running ? "stop" : "send"))
		btnSend.title = running ? "Stop building" : "Build (Enter)"
		btnSend.setAttribute("aria-label", running ? "Stop building" : "Build")
		btnSend.disabled = !running && ((!input.value.trim() && !S.images.length) || blocked())
		host.button?.classList.toggle("busy", running)
	}

	let pendingImages = 0 // slots taken by images still being read (a second batch dropped meanwhile counts them)
	async function attach(files) {
		const all = [...(files ?? [])]
		const list = all.filter(isImageFile)
		const skipped = all.filter((f) => !isImageFile(f))
		if (skipped.length) note(`${skipped.map((f) => f.name).slice(0, 2).join(", ")}${skipped.length > 2 ? "…" : ""} ${skipped.length === 1 ? "isn't a picture" : "aren't pictures"}: only images can be added`)
		if (!list.length) return
		const room = MAX_IMAGES - S.images.length - pendingImages
		if (room <= 0) return note(`Up to ${MAX_IMAGES} images`)
		if (list.length > room) note(`Only the first ${room} more image${room === 1 ? "" : "s"} were added (up to ${MAX_IMAGES})`)
		const take = list.slice(0, room)
		pendingImages += take.length
		// (pictures here go with the change being asked for: "make it look like this")
		const placeholders = take.map((f) => {
			const chip = h("div", { class: "ai-thumb loading", title: f.name }, h("span", { class: "ai-spin", "aria-hidden": "true" }))
			attachRow.append(chip)
			return chip
		})
		attachRow.hidden = false
		for (let i = 0; i < placeholders.length; i++) {
			try {
				const [im] = await prepareImages([take[i]])
				if (S.images.length < MAX_IMAGES) {
					S.images.push(im)
					// a small picture: counts and sizes read from it may be off (said now, and kept with the image)
					if (Math.max(im.width, im.height) < 512) ((im.lowRes = true), note(`${im.name} is small (${im.width}×${im.height} px): counts and sizes read from it may be off`))
				}
			} catch (e) {
				note(/\.(heic|heif)$/i.test(take[i]?.name ?? "") ? `${take[i].name}: this browser can’t open HEIC photos. Export it as JPEG (or take a screenshot) and add that` : e.message)
			}
			pendingImages--
			placeholders[i].remove()
		}
		renderAttachments()
		syncMode()
		syncSend()
	}
	function renderAttachments() {
		attachRow.innerHTML = ""
		attachRow.hidden = !S.images.length
		S.images.forEach((im, i) =>
			attachRow.append(
				h(
					"div",
					{ class: "ai-thumb", title: `${im.name} · ${im.width}×${im.height}` },
					h("img", { src: im.thumb, alt: im.name }),
					h("button", { type: "button", class: "ai-thumb-x", "aria-label": `Remove ${im.name}`, onclick: () => (S.images.splice(i, 1), renderAttachments(), syncMode(), syncSend()) }, "×")
				)
			)
		)
	}
	btnAttach.onclick = () => fileInput.click()
	fileInput.onchange = () => {
		const f = [...(fileInput.files ?? [])]
		fileInput.value = ""
		attach(f)
	}
	drawer.addEventListener("paste", (e) => {
		const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile)
		if (files.length) {
			e.preventDefault()
			attach(files)
		}
	})

	// drag & drop: onto the drawer, or onto the 3D view (which opens the drawer)
	const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files")
	let dragDepth = 0
	drawer.addEventListener("dragenter", (e) => {
		if (!hasFiles(e)) return
		e.preventDefault()
		dragDepth++
		dropZone.hidden = false
	})
	drawer.addEventListener("dragover", (e) => {
		if (!hasFiles(e)) return
		e.preventDefault()
		e.dataTransfer.dropEffect = "copy"
	})
	drawer.addEventListener("dragleave", () => {
		if (--dragDepth <= 0) ((dragDepth = 0), (dropZone.hidden = true))
	})
	drawer.addEventListener("drop", (e) => {
		if (!hasFiles(e)) return
		e.preventDefault()
		dragDepth = 0
		dropZone.hidden = true
		attach(e.dataTransfer.files)
	})
	if (host.viewport) {
		let vd = 0
		host.viewport.addEventListener("dragenter", (e) => {
			if (!hasFiles(e)) return
			e.preventDefault()
			vd++
			viewDrop.hidden = false
		})
		host.viewport.addEventListener("dragover", (e) => {
			if (!hasFiles(e)) return
			e.preventDefault()
			e.dataTransfer.dropEffect = "copy"
		})
		host.viewport.addEventListener("dragleave", () => {
			if (--vd <= 0) ((vd = 0), (viewDrop.hidden = true))
		})
		host.viewport.addEventListener("drop", (e) => {
			if (!hasFiles(e)) return
			e.preventDefault()
			vd = 0
			viewDrop.hidden = true
			// a photo dropped on the picture is a scene to build: New → Build with AI, with it (without that dialog: the change's pictures)
			if (host.openNew) return host.openNew({ ai: true, files: [...e.dataTransfer.files] })
			open()
			attach(e.dataTransfer.files)
		})
	}

	// ---------------------------------------------------------------- the thread
	function note(text) {
		live.textContent = text
		host.toast?.(text)
	}
	const KEEP_VERSIONS = 6 // builds whose scene (and plan) are saved so "Restore this version" works after a reload
	/** When a turn was made (older saved turns have no time: their id was the time the panel opened, near enough). */
	const turnAt = (t) => t?.at ?? (Number(String(t?.id ?? "").slice(1)) || 0)
	/** Turns another tab of this profile saved meanwhile join this tab's (each tab's own turns win for its own ids; a turn either tab removed, or
	 *  one from before "Start over", stays out). -> whether any came in */
	function mergeStored(stored = store.get()) {
		const gone = new Set([...(Array.isArray(stored?.gone) ? stored.gone : []), ...S.gone])
		S.gone = [...gone].slice(-60)
		S.since = Math.max(num0(stored?.since), num0(S.since))
		const mine = new Set(S.turns.map((t) => t.id))
		const theirs = (Array.isArray(stored?.turns) ? stored.turns : []).filter((t) => t?.id && !mine.has(t.id) && !gone.has(t.id) && turnAt(t) >= S.since)
		const before = S.turns.length
		S.turns = S.turns.filter((t) => !gone.has(t.id) && (t.state === "running" || turnAt(t) >= S.since))
		if (!theirs.length && S.turns.length === before) return false
		S.turns = [...S.turns, ...theirs].sort((a, b) => turnAt(a) - turnAt(b))
		return true
	}
	function persist() {
		// (another tab of this profile may have saved turns since this one last looked: they are kept, not written over)
		if (mergeStored() && !S.job) (renderThread(), syncUndoButtons())
		const kept = new Set(S.turns.filter((t) => t.sceneJSON).slice(-KEEP_VERSIONS).map((t) => t.id))
		// (a concept sketch is 100–300 KB: only the last few are kept in this browser; older cards lose their thumbnail after a reload)
		const keptConcepts = new Set(S.turns.filter((t) => t.report?.concept).slice(-KEEP_CONCEPTS).map((t) => t.id))
		const noConcept = (t) => (t.report?.concept || t.report?.startFrame ? { ...t, report: { ...t.report, concept: undefined, startFrame: undefined } } : t)
		const turns = S.turns
			.filter((t) => t.state !== "running")
			.slice(-HISTORY_TURNS)
			.map((t) => ({ ...slimTurn(t), ...(kept.has(t.id) ? { sceneJSON: t.sceneJSON, plan: t.plan ?? null } : {}) }))
			.map((t) => (keptConcepts.has(t.id) ? t : noConcept(t)))
		const extra = { gone: S.gone, since: S.since }
		// (out of room in this browser's storage: the conversation is kept without the older versions and sketches; then without any sketch)
		if (!store.set({ turns, lastBuild: S.lastBuild, ...extra })) {
			const lean = turns.map((t) => (t.id === S.lastBuild?.turnId ? t : noConcept({ ...t, sceneJSON: undefined, plan: undefined })))
			if (!store.set({ turns: lean, lastBuild: S.lastBuild, ...extra })) store.set({ turns: lean.map(noConcept), lastBuild: S.lastBuild, ...extra })
		}
	}
	// another tab of this profile saved its conversation: its turns show here too (after this tab's build, if one is running)
	addEventListener("storage", (e) => {
		if (e.key !== KEY || S.job) return
		if (mergeStored()) (renderThread(), syncUndoButtons())
	})
	function slimTurn(t) {
		if (t.role === "user") return { id: t.id, at: t.at, role: "user", text: t.text, ...(t.sent ? { sent: t.sent } : {}), images: (t.images ?? []).map((im) => ({ name: im.name, thumb: im.thumb })), mode: t.mode, ...(t.asked ? { asked: true } : {}) }
		const r = t.report
		return {
			id: t.id,
			at: t.at,
			role: "ai",
			state: t.state,
			error: t.error,
			...(t.reworkAsked ? { reworkAsked: true } : {}),
			...(t.reworkOf ? { reworkOf: t.reworkOf } : {}),
			request: t.request ? { text: t.request.text, mode: t.request.mode, images: [], hadImages: (t.request.images ?? []).length || t.request.hadImages || 0, ...(t.request.asked ? { asked: true } : {}), ...(t.request.imagine ? { imagine: t.request.imagine } : {}), ...(t.request.rework ? { rework: true } : {}) } : null,
			report: r
				? {
						replyOnly: r.replyOnly, reply: r.reply, howItWorks: r.howItWorks, happened: r.happened, problems: r.problems, unsure: r.unsure, title: r.title, mode: r.mode, used: r.used, missing: r.missing,
						assumptions: r.assumptions, goals: r.goals, refine: r.refine, tune: r.tune, edit: r.edit, timings: r.timings, totalMs: r.totalMs, models: r.models, reworkFailed: r.reworkFailed,
						score: r.score, scoreState: r.scoreState, staleScore: r.staleScore, scoreNote: r.scoreNote, steps: r.steps,
						differences: r.differences, coverage: r.coverage, quick: r.quick, quickNote: r.quickNote, undo: r.undo, noChange: r.noChange, version: r.version, ratedBy: r.ratedBy, sceneBefore: r.sceneBefore, suggestNew: r.suggestNew,
						lead: r.lead, human: r.human, planned: r.planned, suggestions: r.suggestions, mineKinds: r.mineKinds, movedOn: r.movedOn,
						// the concept sketch of a new scene (never an edit's): kept with the turn while its picture is under the 400 KB guard; the scene's
						// start frame, once rendered for the side-by-side view
						concept: r.mode === "new" ? slimConcept(r.concept) : undefined,
						startFrame: r.mode === "new" && typeof r.startFrame === "string" && r.startFrame.length < 200000 ? r.startFrame : undefined,
						// (why there is no concept sketch, when one was tried: the info line under Details)
						infos: r.infos ?? (r.issues ?? []).filter((i) => i.level === "info" && /^imagine/.test(i.code ?? "")).map((i) => i.text).slice(0, 2),
						targets: r.targets, fix: r.fix, fixNeeded: r.fixNeeded, fixApplied: r.fixApplied, stageTune: r.stageTune, stages: r.stages,
						// what went wrong while building (a check that couldn't run, changes that couldn't be made): shown, never dropped
						issues: (r.issues ?? []).filter((i) => i.level === "warn" || i.level === "error").slice(0, 8),
						solverNotes: (r.solverIssues ?? []).filter((i) => i.level !== "info" || ["moved", "kept_on", "lean_length", "shifted", "table_widened", "default_x", "air_height"].includes(i.code)).slice(0, 20),
						items: r.scene?.items?.length ?? 0
					}
				: null
		}
	}
	/** A concept for keeping: {image, cast, story, how} with its picture under the 400 KB guard (an older turn's bare data URL reads as one). */
	function slimConcept(c) {
		if (typeof c === "string") c = { image: c, cast: [], story: [] }
		if (!c || typeof c.image !== "string" || !/^data:image\//.test(c.image)) return undefined
		// (a picture over the guard is kept as its smaller copy, once drawn: shrinkConcept)
		const image = c.image.length < CONCEPT_MAX ? c.image : conceptSmall.get(c.image)?.url
		if (!image) return undefined
		return { image, cast: (Array.isArray(c.cast) ? c.cast : []).slice(0, 12), story: (Array.isArray(c.story) ? c.story : []).map(String).slice(0, 6), ...(c.how ? { how: c.how } : {}) }
	}
	/** A concept picture over the 400 KB guard (the Gemini fallback's 1408×768 JPEG is ~0.7 M characters) drawn again for keeping: ≤ 1536 px
	 *  wide as a JPEG at 0.85, smaller only if it is still over. -> Promise<data URL | null>; started when the sketch arrives. */
	function shrinkConcept(src) {
		if (typeof src !== "string" || src.length < CONCEPT_MAX) return Promise.resolve(src ?? null)
		const had = conceptSmall.get(src)
		if (had) return had.p
		const entry = { url: null, p: null }
		entry.p = (async () => {
			for (const [w, q] of [[1536, 0.85], [1280, 0.8], [1024, 0.75]]) {
				const url = await redrawJpeg(src, w, q).catch(() => null)
				if (url && url.length < CONCEPT_MAX) return (entry.url = url)
			}
			return null
		})()
		conceptSmall.set(src, entry)
		return entry.p
	}
	/** A data URL drawn again at most maxW px wide (its own shape kept) as a JPEG. */
	function redrawJpeg(src, maxW, q) {
		return new Promise((resolve, reject) => {
			const im = new Image()
			im.onload = () => {
				const k = Math.min(1, maxW / (im.naturalWidth || maxW))
				const c = document.createElement("canvas")
				c.width = Math.max(1, Math.round((im.naturalWidth || maxW) * k))
				c.height = Math.max(1, Math.round((im.naturalHeight || maxW) * k))
				const g = c.getContext("2d")
				g.imageSmoothingQuality = "high"
				g.drawImage(im, 0, 0, c.width, c.height)
				resolve(c.toDataURL("image/jpeg", q))
			}
			im.onerror = () => reject(new Error("The picture couldn’t be read"))
			im.src = src
		})
	}
	function renderThread() {
		thread.innerHTML = ""
		for (const t of S.turns) thread.append(renderTurn(t))
		renderHero()
		autosize()
	}
	function renderTurn(t) {
		if (t.role === "user") {
			return h(
				"li",
				{ class: "ai-turn ai-user", "data-id": t.id },
				h("div", { class: "ai-bubble" }, h("span", { class: `ai-tag${t.mode === "new" ? " ai-tag-new" : t.mode === "fix" ? " ai-tag-fix" : ""}` }, t.mode === "check" ? "Check" : t.mode === "new" ? "New scene" : t.mode === "fix" ? "Fix" : t.asked ? "Question" : "Change"), t.text ? h("p", {}, t.text) : null, t.images?.length ? h("div", { class: "ai-bubble-imgs" }, t.images.map((im) => h("img", { src: im.thumb, alt: im.name ?? "image" }))) : null)
			)
		}
		const li = h("li", { class: `ai-turn ai-bot ai-s-${t.state}`, "data-id": t.id })
		if (t.state === "running") li.append(t.view?.root ?? renderProgress(t).root)
		else if (t.state === "done") li.append(renderReport(t)) // (the timeline of a build made in this page is in its Details)
		else li.append(renderError(t))
		return li
	}
	function scrollToEnd(smooth = true) {
		requestAnimationFrame(() => scroll.scrollTo({ top: scroll.scrollHeight, behavior: smooth && !reduceMotion() ? "smooth" : "auto" }))
	}
	/** Back in view after the drawer opens or unfolds: the end of the thread, or, while a build shows its concept sketch, the step working now. */
	const scrollToNow = (smooth = true) => (S.running?.view?.conceptEl ? revealConcept(S.running.view) : scrollToEnd(smooth))

	// ---- the live progress card
	function renderProgress(t) {
		const rows = new Map()
		const list = h("ol", { class: "ai-steps" })
		const pics = (t.request.images ?? []).length > 0
		const edit = t.request.mode === "edit"
		// (a new scene from words that gets a concept sketch first: "Picturing the scene", and on the observe route "Reading the sketch")
		const route = t.request.mode === "new" ? conceptRoute({ mode: "new", images: t.request.images ?? [], text: t.request.text, imagine: t.request.imagine ?? "off" }) : null
		const steps = TIMELINE.filter((s) => (s !== "imagine" || route) && (s !== "observe" || pics || route === "observe") && (s !== "reconcile" || (pics && t.request.mode === "new")) && (s !== "plan" || t.request.mode !== "check") && (!edit || (s !== "refine" && s !== "tune")) && (s !== "fix" || (edit && statesOutcome(t.request.text))) && (s !== "stagetune" || t.request.mode === "new"))
		for (const s of steps) {
			const label = s === "plan" && t.request.mode === "edit" ? STEP_LABELS.edit : s === "imagine" ? STEP_LABELS.imagine ?? "Picturing the scene" : s === "observe" && !pics ? "Reading the sketch" : STEP_LABELS[s]
			const row = { el: null, state: "pending", t0: 0, ms: null, label, sub: "" }
			row.badge = h("span", { class: "ai-step-ic", "aria-hidden": "true" })
			row.text = h("span", { class: "ai-step-l" }, label)
			row.subEl = h("span", { class: "ai-step-sub" })
			row.time = h("span", { class: "ai-step-t" })
			row.el = h("li", { class: "ai-step st-pending" }, row.badge, h("span", { class: "ai-step-body" }, row.text, row.subEl), row.time)
			rows.set(s, row)
			list.append(row.el)
		}
		const total = h("span", { class: "ai-total" }, "0.0 s")
		const btnCancel = h("button", { type: "button", class: "ai-chip-btn", onclick: () => cancel() }, "Cancel")
		const root = h(
			"div",
			{ class: "ai-card ai-progress", "aria-busy": "true" },
			h("div", { class: "ai-card-head" }, h("span", { class: "ai-orb", "aria-hidden": "true" }), h("b", {}, t.request.mode === "edit" ? (t.request.asked ? "Answering your question" : "Changing the scene") : t.request.mode === "check" ? "Checking the scene again" : "Building your scene"), total, btnCancel),
			list,
			h("div", { class: "ai-shimmer", "aria-hidden": "true" })
		)
		const view = { root, rows, total, t0: performance.now(), phase: "start", timer: 0, now: t.request.mode === "check" ? "Checking the scene again" : "Starting" }
		view.timer = setInterval(() => tick(view), 100)
		t.view = view
		return view
	}
	function tick(view) {
		const n = performance.now()
		view.total.textContent = secs(n - view.t0)
		for (const row of view.rows.values()) {
			if (row.state !== "active") continue
			row.time.textContent = secs(n - row.t0)
			// no word from the server for a while on a long step (a static host has no progress to give): say honestly that it is still going
			if ((row === view.rows.get("plan") || row === view.rows.get("observe")) && n - row.t0 > 25000 && n - (row.beat ?? row.t0) > 12000 && !row.waitSub && !/still working/.test(row.subEl.textContent))
				row.subEl.textContent = "still working: a detailed scene can take a minute or two"
			// (the sketch: about 25 s; the build goes on from the words alone if it isn't there in 75 s)
			if (row === view.rows.get("imagine") && n - row.t0 > 30000 && n - (row.beat ?? row.t0) > 12000 && !row.waitSub && !/still drawing/.test(row.subEl.textContent)) row.subEl.textContent = "still drawing: a sketch takes up to a minute"
		}
		if (S.mini && S.running?.view === view) {
			miniTitle.textContent = view.now
			miniSub.textContent = secs(n - view.t0)
		}
	}
	function setRow(view, step, state, { ms, sub } = {}) {
		const row = view.rows.get(step)
		if (!row) return
		if (state === "active" && row.state !== "active") row.t0 = performance.now()
		row.state = state
		row.el.className = `ai-step st-${state}`
		row.badge.innerHTML = state === "done" ? ICONS.check : state === "error" ? ICONS.cross : ""
		if (sub !== undefined) row.subEl.textContent = sub
		if (state === "done") row.time.textContent = secs(ms ?? performance.now() - row.t0)
		else if (state === "skipped") ((row.time.textContent = ""), (row.subEl.textContent = sub ?? "not needed"))
		else if (state !== "active") row.time.textContent = ""
	}
	/** Which timeline row a model step belongs to (an edit is the plan row; the picture fix's edit call is the reconcile row). */
	const rowOf = (v, step) => (step === "edit" ? (v.phase === "reconcile" ? "reconcile" : "plan") : step)
	/** "2nd", "3rd": a place in the queue. */
	const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`
	const kTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)))
	const tokensWord = (n) => `${kTokens(n)} token${Math.round(n) === 1 ? "" : "s"}`
	/** The server's word on a running model step, in a few words: where it waits, or how far the model has got. */
	function progressWords(e) {
		if (e.state === "waiting") return e.position ? `waiting for a free AI slot (${ordinal(e.position)} in line)…` : "waiting for a free AI slot…"
		if (e.state !== "running") return null
		const bits = []
		if (e.repair) bits.push("fixing its answer")
		else if (e.attempt > 1) bits.push(`try ${e.attempt}`)
		if (e.phase === "writing") bits.push(e.tokens ? `writing · ${tokensWord(e.tokens)}` : "writing the answer")
		else if (e.phase === "thinking") bits.push(e.tokens ? `thinking · ${tokensWord(e.tokens)}` : "thinking")
		else if (e.tokens) bits.push(tokensWord(e.tokens))
		else bits.push("the AI is working")
		return bits.join(" · ")
	}
	/** Pipeline events -> the timeline: the first placing and run have rows of their own; after the critique starts, re-placing and re-running are its sub-steps. */
	function onEvent(t, e) {
		const v = t.view
		if (!v) return
		if (e.type === "concept") return showConcept(t, e)
		if (e.type === "concept-dropped") {
			// (reading the sketch or planning from it failed: it is taken down, and the build goes on from the words alone)
			v.conceptEl?.remove()
			v.conceptEl = null
			const row = v.rows.get("imagine")
			if (row) row.subEl.textContent = "not used: planning from your words"
			return
		}
		if (e.type === "progress" && e.step === "fix") {
			setRow(v, "fix", "active", { sub: `${e.runs} physics run${e.runs === 1 ? "" : "s"}${e.found ? " · found one" : ""}` })
			v.now = `Finding a fix · ${e.runs} runs`
			return
		}
		if (e.type === "progress" && e.step === "stagetune") {
			// (a new scene, physics first: each stage's check made to happen in the engine before the AI looks)
			const which = e.of > 1 ? `stage ${e.stage} of ${e.of}` : "the goal"
			setRow(v, "stagetune", "active", { sub: `${which} · ${plural(e.runs, "physics run")}${e.passed ? " · it works" : ""}` })
			v.now = `Tuning ${which} · ${e.runs} runs`
			v.draft = "tuning it stage by stage"
			draftSub.textContent = draftWords(v)
			return
		}
		if (e.type === "progress" && e.step === "tune") {
			setRow(v, "tune", "active", { sub: `run ${e.runs} of ${e.max}${e.passed ? " · goal met" : ""}` })
			v.now = `Tuning · run ${e.runs} of ${e.max}`
			v.draft = "tuning it"
			draftSub.textContent = draftWords(v)
			return
		}
		if (e.type === "ai-progress") {
			// the heartbeat of a long model step: its place in the server's queue, then how much the model has thought and written
			const step = rowOf(v, e.step)
			const row = v.rows.get(step)
			const words = progressWords(e)
			if (!row || !words || row.state !== "active") return
			const base = step === "refine" && v.round ? `${v.round} · ` : ""
			row.subEl.textContent = `${base}${words}`
			row.beat = performance.now()
			row.el.classList.add("beat")
			setTimeout(() => row.el.classList.remove("beat"), 450)
			v.now = `${(step === "observe" || step === "imagine" ? row.label : null) ?? STEP_LABELS[step === "plan" && t.request.mode === "edit" ? "edit" : step] ?? "Working"}${e.state === "waiting" ? " · waiting for a slot" : e.tokens ? ` · ${tokensWord(e.tokens)}` : ""}`
			if (e.state === "waiting") announce(words)
			return
		}
		if (e.type === "draft") {
			// the AI's latest version shows in the view while it keeps working (first as placed, then its run); the drawer folds out of its way
			// (desktop) unless it was opened again
			if (S.job && S.running === t && host.draft?.(e.sim ?? null, e.sim ? null : e.scene)) {
				draftBadge.hidden = false
				// (the badge names the version the view shows: the orchestrator's label says which one it is)
				if (!e.sim) v.draft = "placed · running the physics…"
				else if (e.label === "tuned") v.draft = v.phase === "stagetune" ? "tuned stage by stage" : "tuned"
				else if (e.label === "fixed") v.draft = "fixed so it works"
				else if (e.label === "the better version") v.draft = "the better version"
				else if (e.label === "matching your picture" || v.phase === "reconcile") v.draft = "matched to your picture"
				else if (/^after check (\d+)/.test(e.label ?? "")) v.draft = `changed by check ${/^after check (\d+)/.exec(e.label)[1]}`
				else if (v.phase !== "refine") v.draft = "first run"
				draftSub.textContent = draftWords(v)
				if (!S.keepOpen) fold()
			}
			return
		}
		if (e.type === "observed") {
			// what the AI saw in the picture shows while it plans (the longest wait of a picture build)
			const row = v.rows.get("observe")
			if (row) row.subEl.textContent = `seen: ${e.objects.slice(0, 6).join(", ")}${e.objects.length > 6 ? ` and ${e.objects.length - 6} more` : ""}`
			return
		}
		if (e.type === "wait") {
			// every AI slot on the server is taken and it turned the step away: it tries again in a moment (and can still be cancelled)
			const step = rowOf(v, e.step)
			const row = v.rows.get(step)
			if (!row) return
			if (e.state === "start") {
				if (row.waitSub === undefined) row.waitSub = row.subEl.textContent
				setRow(v, step, "active", { sub: `the AI is full: waiting for a slot, trying again in ${Math.max(1, Math.round(e.ms / 1000))} s${e.waitedMs > e.ms ? ` (${secs(e.waitedMs - e.ms)} so far)` : ""}…` })
				v.now = "Waiting for a slot…"
				announce("Waiting for a free AI slot")
			} else {
				setRow(v, step, "active", { sub: row.waitSub ?? "" })
				row.waitSub = undefined
			}
			return
		}
		if (e.type !== "step") return
		if (e.state === "active") v.now = stepWords(e, v)
		const step = rowOf(v, e.step)
		if (step === "reconcile") {
			if (e.state === "active") {
				v.phase = "reconcile"
				v.draft = "matching your picture…"
				draftSub.textContent = draftWords(v)
				announce(STEP_LABELS.reconcile)
				setRow(v, "reconcile", "active", { sub: e.detail ? `${e.detail} to fix` : "" })
			} else if (e.state === "skipped") setRow(v, "reconcile", "skipped", { sub: e.label && e.label !== STEP_LABELS.reconcile ? e.label : "everything in the picture is built" })
			else if (e.state === "done") setRow(v, "reconcile", "active", { sub: "placing what was fixed" })
			else setRow(v, "reconcile", e.state === "cancelled" ? "error" : e.state)
			return
		}
		if (step === "stagetune") {
			if (e.state === "active") {
				v.phase = "stagetune"
				v.draft = "tuning it stage by stage"
				draftSub.textContent = draftWords(v)
				announce(e.label)
				return setRow(v, "stagetune", "active", { sub: e.detail ?? "" })
			}
			if (e.state === "skipped") return setRow(v, "stagetune", "skipped", { sub: e.label && e.label !== STEP_LABELS.stagetune ? e.label : undefined })
			if (e.state === "done") return setRow(v, "stagetune", "done", { ms: e.ms, sub: "checking it in the app’s own run" })
			return setRow(v, "stagetune", e.state === "cancelled" ? "error" : e.state)
		}
		// (the tuned version placed and run on the app's own engine: part of the stage tuning row)
		if (v.phase === "stagetune" && (step === "solve" || step === "simulate")) {
			const row = v.rows.get("stagetune")
			if (row && e.state === "active") row.subEl.textContent = step === "solve" ? "placing the tuned version" : "running the tuned version"
			return
		}
		if (step === "imagine") {
			const row = v.rows.get("imagine")
			// (no sketch for this build: no row for it)
			if (e.state === "skipped") return row && (row.el.remove(), v.rows.delete("imagine"))
			if (e.state === "active") {
				announce(e.label ?? STEP_LABELS.imagine)
				return setRow(v, "imagine", "active", { sub: "an AI sketch of your idea, to plan from" })
			}
			if (e.state === "done") return setRow(v, "imagine", "done", { ms: e.ms, sub: "" })
			// (no sketch came: the build goes on from the words alone; why is under Details)
			return setRow(v, "imagine", e.state === "cancelled" ? "error" : "skipped", { sub: "no sketch: planning from your words" })
		}
		if (step === "observe" || step === "plan" || step === "tune" || step === "fix") {
			if (e.state === "active") announce(step === "observe" ? v.rows.get("observe")?.label ?? e.label : e.label)
			if (step === "tune" && e.state === "skipped") return setRow(v, "tune", "skipped", { sub: e.label && e.label !== STEP_LABELS.tune ? e.label : undefined })
			if (step === "tune" && e.state === "active") ((v.draft = "tuning it"), (draftSub.textContent = draftWords(v)))
			setRow(v, step, e.state === "cancelled" ? "error" : e.state, { ms: e.ms, sub: e.state === "done" ? "" : undefined })
			return
		}
		if (v.phase === "reconcile" && (step === "solve" || step === "simulate")) {
			if (e.state === "active") setRow(v, "reconcile", "active", { sub: step === "solve" ? "placing what was fixed" : "running the physics again" })
			else if (e.state === "done" && step === "simulate") setRow(v, "reconcile", "done", { ms: performance.now() - (v.rows.get("reconcile")?.t0 ?? performance.now()), sub: "" })
			return
		}
		const inRefine = v.phase === "refine"
		if (step === "refine") {
			if (e.state === "skipped") {
				setRow(v, "refine", "skipped", { sub: e.label && e.label !== STEP_LABELS.refine ? e.label : undefined })
				return
			}
			v.phase = "refine"
			if (e.state === "active") {
				const m = /(\d+)\/(\d+)/.exec(e.label ?? "")
				v.round = m ? `round ${m[1]} of ${m[2]}` : /final/i.test(e.label ?? "") ? "final check" : ""
				v.draft = m ? `Refining ${m[1]}/${m[2]}…` : /final/i.test(e.label ?? "") ? "final check…" : "refining…"
				v.now = m ? `Refining ${m[1]}/${m[2]}…` : `Checking${v.round ? ` · ${v.round}` : ""}`
				draftSub.textContent = draftWords(v)
				setRow(v, "refine", "active", { sub: `${v.round} · the AI is looking at the pictures` })
				announce(`Checking and refining, ${v.round}`)
			} else if (e.state === "done") setRow(v, "refine", "active", { sub: `${v.round} · done` })
			else setRow(v, "refine", "error")
			return
		}
		if (step === "render") {
			if (v.phase !== "refine") setRow(v, "refine", "active", { sub: "taking pictures of the scene" })
			else if (e.state === "active") setRow(v, "refine", "active", { sub: `${v.round} · taking pictures` })
			return
		}
		if (inRefine) {
			if (e.state === "active") setRow(v, "refine", "active", { sub: `${v.round} · ${step === "solve" ? "placing the changes" : "running the physics again"}` })
			return
		}
		if (e.state === "active") announce(e.label)
		setRow(v, step, e.state === "cancelled" ? "error" : e.state, { ms: e.ms, sub: step === "solve" && e.state === "done" ? "" : undefined })
	}
	function finishRows(view, report) {
		const im = view.rows.get("imagine")
		if (im && (im.state === "pending" || im.state === "active")) setRow(view, "imagine", "skipped", { sub: "no sketch: planned from your words" })
		const rf = view.rows.get("refine")
		const failed = (report?.issues ?? []).find((i) => i.code === "refine_failed" || i.code === "final_check_failed")
		const scoreWords = report?.score != null ? ` · ${report.score}/10` : report?.scoreState === "stale" ? " · not re-checked" : ""
		if (rf && failed) setRow(view, "refine", "error", { sub: `${failed.code === "final_check_failed" ? "final check failed" : "check failed"} · ${/busy/.test(failed.text) ? "the AI was busy" : /too long/.test(failed.text) ? "it took too long" : "not checked"}` })
		else if (rf && rf.state === "active") setRow(view, "refine", "done", { sub: report?.refine?.length ? `${plural(report.refine.length, "check")}${scoreWords}` : "" })
		else if (rf && rf.state === "pending") setRow(view, "refine", "skipped", { sub: report?.quick ? "a simple change: checked by the physics" : undefined })
		const rc = view.rows.get("reconcile")
		if (rc && rc.state === "active") setRow(view, "reconcile", report?.coverage?.fixed?.length ? "done" : "error", { sub: report?.coverage?.fixed?.length ? `matched: ${report.coverage.fixed.slice(0, 2).join(", ")}` : "not matched" })
		const sr = view.rows.get("stagetune")
		const stt = report?.stageTune
		if (sr && stt?.runs) setRow(view, "stagetune", "done", { ms: stt.ms, sub: `${plural(stt.runs, "run")} · ${stt.kept ? `${stt.after?.checks ?? stt.after?.goals} work${stt.after?.passed ? " ✓" : ""}` : stt.partial ? "not all working: left to the AI" : "nothing better"}` })
		else if (sr && sr.state === "pending") setRow(view, "stagetune", "skipped", { sub: stt?.already ? "everything works in the first run" : undefined })
		const tn = view.rows.get("tune")
		if (tn && tn.state === "pending") setRow(view, "tune", "skipped", { sub: (report?.goals ?? []).length ? "goals met, nothing to tune" : "no goals to tune" })
		// (a tune that made no run was not a tune: what stopped it is said instead)
		if (tn && report?.tune) {
			if (!report.tune.runs) setRow(view, "tune", "skipped", { sub: report.tune.skipped?.[0] ?? "nothing it may move" })
			else setRow(view, "tune", "done", { ms: report.tune.ms, sub: report.tune.changed.length ? `${plural(report.tune.runs, "run")} · ${report.tune.passed ? "goal met" : "closer"}` : `${plural(report.tune.runs, "run")} · nothing better` })
		}
	}
	let lastAnnounce = ""
	function announce(text) {
		if (!text || text === lastAnnounce) return
		lastAnnounce = text
		live.textContent = text
	}

	// ---- the concept sketch (a new scene from words): shown in the progress card the moment it arrives, labelled as the AI's picture of the idea
	/** "10 × domino · 5 cm" (the size phrase's largest length: "0.8 cm wide × 5 cm tall" -> 5 cm; "2.5 cm across" -> 2.5 cm) */
	function castWords(x, types) {
		const name = String(types.get(x.type)?.name ?? String(x.type ?? "").replace(/-/g, " ")).replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())
		const s = String(x.size ?? "").trim()
		const lens = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/g)].map((m) => ({ t: `${m[1]} ${m[2]}`, m: Number(m[1]) * { mm: 0.001, cm: 0.01, m: 1 }[m[2]] }))
		const size = lens.length ? lens.sort((a, b) => b.m - a.m)[0].t : s.length <= 12 ? s : ""
		return { text: `${x.count > 1 ? `${x.count} × ` : ""}${name}${size ? ` · ${size}` : ""}`, title: [x.role ? capFirst(x.role) : null, s || null].filter(Boolean).join(" · ") }
	}
	function conceptFigure(c) {
		const types = new Map((host.getCatalog()?.types ?? []).map((ty) => [ty.key, ty]))
		const cast = (c.cast ?? []).filter((x) => x?.type).slice(0, 10).map((x) => castWords(x, types))
		const story = (c.story ?? []).map(String).filter(Boolean).slice(0, 6)
		return h(
			"figure",
			{ class: "ai-concept-fig" },
			h("div", { class: "ai-concept-frame" }, h("img", { src: c.image, alt: "Concept sketch of your idea, drawn by AI from your words" }), h("span", { class: "ai-concept-tag" }, icon("sparkle"), CONCEPT_TAG)),
			h("figcaption", { class: "ai-concept-cap" }, CONCEPT_CAPTION),
			cast.length ? h("ul", { class: "ai-cast", "aria-label": "What it is built from" }, cast.map((x) => h("li", { title: x.title || null }, x.text))) : null,
			story.length ? h("ol", { class: "ai-story", "aria-label": "The idea, step by step" }, story.map((s) => h("li", {}, s))) : null
		)
	}
	function showConcept(t, e) {
		const v = t.view
		if (!v || typeof e.image !== "string" || t.request?.mode !== "new") return
		v.conceptEl?.remove()
		v.conceptEl = conceptFigure(e)
		v.root.querySelector(".ai-steps")?.after(v.conceptEl)
		shrinkConcept(e.image) // (a picture too big to keep is drawn again smaller now, while the build goes on)
		const row = v.rows.get("imagine")
		if (row && row.state === "active") row.subEl.textContent = "here it is: planning from it, your words decide"
		announce("A concept sketch of the idea is ready, made by AI from your words. Planning the scene now.")
		if (S.running === t && !S.mini) revealConcept(v)
	}
	/** The sketch comes in under the steps: the step working now goes just under the card's (sticky) header with Cancel and the timer, and the
	 *  sketch below it as far as there is room. The card is never scrolled to its end: that would leave only the last pending row in view. */
	function revealConcept(v) {
		requestAnimationFrame(() => {
			const row = v.root.querySelector(".ai-step.st-active") ?? v.root.querySelector(".ai-step.st-pending")
			if (!row || !v.root.isConnected) return
			const sr = scroll.getBoundingClientRect()
			const headH = v.root.querySelector(".ai-card-head")?.getBoundingClientRect().height ?? 0
			const want = scroll.scrollTop + (row.getBoundingClientRect().top - sr.top) - headH - 10
			const top = Math.max(0, Math.min(want, scroll.scrollHeight - scroll.clientHeight))
			scroll.scrollTo({ top, behavior: reduceMotion() ? "auto" : "smooth" })
		})
	}

	// ---- the result card
	/** What a step is doing, in a few words (the folded chip shows it). */
	const stepWords = (e, v) => (v.phase === "refine" && ["solve", "simulate", "render"].includes(e.step) ? `Checking · ${v.round || "refining"}` : e.step === "observe" && v.rows.get("observe")?.label === "Reading the sketch" ? "Reading the sketch" : String(e.label ?? STEP_LABELS[e.step] ?? "Working").replace(/ \d+\/\d+$/, ""))
	const draftWords = (v) => (v?.draft ? `the AI is still working · ${v.draft}` : "the AI is still working on it")
	/** The latest build's Undo is offered only while that build is still the scene's current history entry (never on older cards, never after a reload). */
	const canUndo = (t) => t.id === S.lastAppliedId && t.hi != null && host.historyIndex?.() === t.hi
	/** A result that was not (fully) checked by the AI offers one more check, on the latest card only. */
	const wantsCheck = (t) =>
		t.id === S.lastBuild?.turnId &&
		t.state === "done" &&
		!t.report?.replyOnly &&
		// (never beside a checked fix or while one is looked for, nor while a goal fails: the offer or the rework button is the way on, and a
		// critic's round there threw the checked fix away for a change that still failed: V8817 s6)
		!["found", "searching"].includes(t.report?.fix?.state) &&
		!t.report?.fixNeeded &&
		!(t.report?.goals ?? []).some((g) => g.ok === false) &&
		!(t.report?.targets ?? []).some((g) => g.ok === false) &&
		((t.report?.issues ?? []).some((i) => i.code === "refine_failed" || i.code === "final_check_failed") || ["stale", "unchecked", "quick"].includes(t.report?.scoreState))
	function renderReport(t) {
		const r = t.report
		if (r.replyOnly) {
			// an edit that changes nothing, one card per kind (./edit-turns.js): ask (one question naming the candidates, a chip per reading),
			// answer, undo (the app's Undo), new ("Build it as a new scene…")
			const kind = r.edit?.kind ?? (r.suggestNew ? "new" : r.undo ? "undo" : "answer")
			const latest = S.turns.find((x) => x.id === S.lastAppliedId)
			let undoIt = r.undo && latest && canUndo(latest) ? h("button", { type: "button", class: "ai-chip-btn ai-primary", onclick: (ev) => (ev.currentTarget.remove(), undoTurn(latest, h("button"))) }, icon("undo"), `Undo “${clip(turnWords(latest).words, 44)}”`) : null
			// (no build of the AI's to take back: the app's own Undo, one step, while this is the latest reply)
			if (!undoIt && r.undo && kind === "undo" && t.id === S.turns.filter((x) => x.role === "ai").at(-1)?.id && (host.historyIndex?.() ?? 0) > 0)
				undoIt = h("button", { type: "button", class: "ai-chip-btn ai-primary", onclick: (ev) => (ev.currentTarget.remove(), host.undo?.(), (S.lastAppliedId = null), syncUndoButtons()) }, icon("undo"), touchScreen() ? "Undo" : "Undo (⌘Z)")
			// a different scene was asked for: nothing changed here; one click takes the same words to New → Build with AI
			// (the words go without "start over with": "start over with a catapult…" fills the box with "A catapult…")
			const asNew = r.suggestNew && host.openNew ? h("button", { type: "button", class: "ai-chip-btn ai-primary", onclick: () => host.openNew({ ai: true, text: newSceneWords(t.request?.text ?? "") }) }, icon("sparkle"), "Build it as a new scene…") : null
			// (a question back: each reading is a chip that sends the whole request; nothing else is offered beside them)
			// (never one that drops a count the request states; the table made longer first when it asks for want of room: §16.5)
			const asks = kind === "ask" ? askChipsOf(r, { asked: t.request?.text ?? "", counts: tableCounts() }) : []
			const askChips = asks.length ? h("div", { class: "ai-chips ai-ask-chips", role: "group", "aria-label": "Which one?" }, asks.map((s) => h("button", { type: "button", class: "ai-sugg", title: s.prompt, onclick: () => suggest(s) }, icon("sparkle"), h("span", {}, s.label)))) : null
			return h(
				"div",
				{ class: `ai-card ai-reply ai-k-${kind}` },
				h("p", {}, r.reply),
				r.missing?.length ? h("ul", { class: "ai-missing" }, r.missing.map((m) => h("li", {}, h("span", { class: "ai-miss-asked" }, m.asked ?? "?"), h("span", { class: "ai-miss-none" }, "not in the library")))) : null,
				undoIt || asNew ? h("div", { class: "ai-res-actions" }, undoIt, asNew) : null,
				kind === "ask" ? askChips : kind === "answer" ? chipsFor(t) : null
			)
		}
		const types = new Map((host.getCatalog()?.types ?? []).map((ty) => [ty.key, ty]))
		// the card is a chat reply: one short first-person sentence (the change in a person's words and what the run really shows), a heads-up
		// when something is off, a few next edits to try, and everything else under "Details"
		const card = h("div", { class: "ai-more-body", hidden: !t.detailsOpen })
		// (an edit's card says what changed itself; its Details start with what the AI understood, why, how long and which model)
		// (a fix put on the table is a change like an edit's: its card lists each change too, never "and 1 more change" with nothing under it)
		const editCard = (r.mode === "edit" || r.mode === "fix") && !r.replyOnly
		if (editCard) card.append(editFacts(r))
		if (t.sumEl) card.append(t.sumEl)
		const okGoals = (r.goals ?? []).filter((g) => g.ok).length
		const nItems = (r.used ?? []).reduce((a, u) => a + u.count, 0)
		const checks = (r.refine ?? []).length
		const verb = r.mode === "edit" ? "changed" : r.mode === "check" ? "checked" : r.mode === "fix" ? "fixed" : "built"
		const stats = [plural(nItems, "item"), checks ? plural(checks, "check") : null, r.tune?.runs ? plural(r.tune.runs, "tuning run") : null, r.totalMs ? `${verb} in ${secs(r.totalMs)}` : null].filter(Boolean).join(" · ")
		// the score is the critic's verdict on THIS scene; one given to an earlier version is never shown as this one's
		const badge =
			r.score != null
				? h("span", { class: `ai-score ${r.score >= 8 ? "good" : r.score >= 5 ? "mid" : "low"}`, title: "How well the AI judged this scene matches the request (it looked at pictures of it and at what happened in the run)" }, h("b", {}, String(r.score)), h("small", {}, "/10"))
				: r.scoreState === "stale" || r.scoreState === "unchecked"
					? h("span", { class: "ai-score none", title: `${r.scoreNote ?? "Not checked by the AI"}${r.staleScore != null ? ` (an earlier version was rated ${r.staleScore}/10)` : ""}` }, h("small", {}, "not re-checked"))
					: r.scoreState === "quick"
						? h("span", { class: "ai-score none quick", title: `${r.quickNote ?? "A simple change: applied right after its physics run, not looked at by the AI"}. “Check it” has the AI look at it.` }, h("small", {}, "physics-checked"))
						: null
		// what this was, first: an edit of the scene that was on screen, or a new scene
		const kind = r.mode === "edit" ? `Edited: ${r.sceneBefore ?? r.title ?? "the scene"}` : r.mode === "check" ? `Checked: ${r.sceneBefore ?? r.title ?? "the scene"}` : r.mode === "fix" ? `Fixed: ${r.sceneBefore ?? r.title ?? "the scene"}` : "New scene"
		if (!editCard) card.append(h("div", { class: "ai-res-head" }, h("div", {}, h("p", { class: `ai-res-kind ${r.mode === "new" ? "new" : "edit"}` }, kind), h("h3", { class: "ai-res-title" }, r.title ?? "Your scene"), h("p", { class: "ai-res-stats" }, stats)), badge))
		// (no concept sketch where one was tried: why, in one line)
		for (const line of r.infos ?? []) card.append(h("p", { class: "ai-info" }, line))
		// what went wrong while building: plain, at the top, never folded away (an edit's "Not done" lines are on its card)
		const notices = (r.issues ?? []).filter((i) => (i.level === "warn" || i.level === "error") && !(editCard && i.code === "patch_skipped"))
		if (notices.length || (r.scoreState === "stale" && r.scoreNote))
			card.append(
				h(
					"div",
					{ class: "ai-notice", role: "note" },
					h("span", { class: "ai-notice-ic", "aria-hidden": "true" }, "!"),
					h("div", {}, notices.length ? notices.slice(0, 4).map((i) => h("p", {}, i.text)) : h("p", {}, `This version was not checked again by the AI${r.staleScore != null ? ` (it rated an earlier one ${r.staleScore}/10)` : ""}.`))
				)
			)
		if (r.differences?.length)
			card.append(
				h(
					"div",
					{ class: "ai-diffs", role: "note" },
					h("b", {}, r.mode === "new" && (r.coverage || (t.request?.hadImages ?? 0) > 0 || (t.request?.images ?? []).length) ? "Differences from your picture" : "Differences from what you asked"),
					h("ul", {}, r.differences.slice(0, 8).map((d) => h("li", {}, d)), r.differences.length > 8 ? h("li", { title: r.differences.slice(8).join("\n") }, `and ${r.differences.length - 8} more`) : null)
				)
			)
		if (r.planned ?? r.edit?.reply) card.append(h("p", { class: "ai-reply-text", title: "What the AI meant to do, before the physics ran (the reply above is what the run shows)" }, h("b", {}, "What I planned: "), r.planned ?? r.edit.reply))
		// (what the AI also changed, beyond what was asked, to keep a goal working: put back, so the change is exactly what was asked)
		const kept = r.edit?.leftAlone ?? []
		if (kept.length) card.append(h("p", { class: "ai-reply-text ai-left-alone", title: "An edit changes only what you asked for: the app runs it and offers a checked fix when a goal stops" }, h("b", {}, "Left as it was: "), `${kept.length > 1 ? `${kept.slice(0, -1).join(", ")} and ${kept.at(-1)}` : kept[0]} (you didn’t ask to change ${kept.length > 1 ? "those" : "that"}).`))
		const noChange = r.noChange || r.edit?.noChange
		if (noChange) card.append(h("p", { class: "ai-how" }, r.mode === "check" ? "The check changed nothing: the scene on the table is as it was." : r.mode === "edit" ? "Nothing in the scene changed: what was asked for left it as it was." : "This is the scene that was already on the table: nothing changed."))
		// a quick edit says what its physics run showed changed (never just "nothing broke"); the AI did not look at it
		else if (r.scoreState === "quick") card.append(h("p", { class: "ai-quick-note" }, `${r.quickNote ?? "A simple change: it was run in the physics engine and applied without the AI’s picture check"}. “Check it” asks for one.`))
		// what the run shows (from the physics, not the plan)
		if (r.happened) card.append(h("p", { class: "ai-how" }, r.happened))
		else if (r.howItWorks) card.append(h("p", { class: "ai-how" }, r.howItWorks)) // (a turn saved before this report existed)
		if (r.problems?.length) card.append(h("div", { class: "ai-problems" }, h("b", {}, "What didn’t work"), h("ul", {}, r.problems.map((p) => h("li", {}, p)))))
		// (what the tuner may adjust is the plan's business, not a change anyone sees: left out)
		const cap = (s) => String(s).replace(/^./, (c) => c.toUpperCase())
		const shownChanges = noChange ? [] : r.human?.length ? r.human.map(cap) : (r.edit?.changes ?? []).filter((c) => !/^Tuning knobs/.test(c))
		// an edit: exactly what changed, and that everything else is as it was (counted on the scene itself, byte for byte)
		const un = r.edit?.unchanged
		const sameLine = un && un.of > 0 && !noChange ? h("li", { class: "ai-same" }, un.same === un.of ? "Everything is exactly as it was" : un.same ? `Everything else is exactly as it was (${plural(un.same, "item")} untouched)` : "Every item was changed") : null
		if (!editCard && (shownChanges.length || sameLine)) card.append(section("What changed", h("ul", { class: "ai-list ai-changes" }, shownChanges.slice(0, 8).map((c) => h("li", {}, c)), shownChanges.length > 8 ? h("li", { title: shownChanges.slice(8).join("\n") }, `and ${shownChanges.length - 8} more`) : null, sameLine)))
		if (r.goals?.length)
			card.append(
				section(
					`Goal${r.goals.length === 1 ? "" : "s"} · ${okGoals}/${r.goals.length}`,
					h("ul", { class: "ai-goals" }, r.goals.map((g) => h("li", { class: g.ok === true ? "g-ok" : g.ok === false ? "g-bad" : "g-unk", title: g.ok == null ? "This couldn’t be told from the run" : null }, icon(g.ok === true ? "check" : "cross", "ai-ic ai-goal-ic"), h("span", {}, g.label, g.detail ? h("small", { class: "ai-goal-detail" }, ` · ${g.detail}`) : null))))
				)
			)
		// the plan's stages, each checked on the run of the scene on the table (ai/DESIGN.md §13.2)
		if (r.stages?.length) {
			const okS = r.stages.filter((x) => x.ok === true).length
			card.append(
				section(
					`Stages · ${okS}/${r.stages.length}`,
					h("ul", { class: "ai-goals ai-stages" }, r.stages.map((x) => h("li", { class: x.ok === true ? "g-ok" : x.ok === false ? "g-bad" : "g-unk", title: x.ok == null ? "This couldn’t be told from the run" : null }, icon(x.ok === true ? "check" : "cross", "ai-ic ai-goal-ic"), h("span", {}, h("b", { class: "ai-stage-n" }, `Stage ${x.stage} · `), String(x.label ?? "").replace(/^Stage \d+:\s*/i, ""), x.detail && x.kind !== "in" ? h("small", { class: "ai-goal-detail" }, ` · ${x.detail}`) : null))))
				)
			)
		}
		if (r.used?.length) {
			const grid = h("div", { class: "ai-used" })
			for (const u of r.used) {
				const ty = types.get(u.type)
				const cv = h("canvas", { width: 112, height: 84, "aria-hidden": "true" })
				grid.append(h("div", { class: "ai-used-card", title: ty?.description ?? u.name }, h("span", { class: "ai-used-prev" }, cv), h("span", { class: "ai-used-name" }, u.name), u.count > 1 ? h("span", { class: "ai-used-n" }, `×${u.count}`) : null))
				if (ty?.preview) requestAnimationFrame(() => host.drawPreview?.(cv, ty.preview, host.getCatalog()?.looks ?? {}))
			}
			card.append(section("Built from", grid))
		}
		if (r.missing?.length)
			card.append(
				section(
					"Not in the library",
					h(
						"ul",
						{ class: "ai-missing" },
						r.missing.map((m) =>
							h(
								"li",
								{ title: m.reason || "" },
								h("span", { class: "ai-miss-asked" }, m.asked),
								m.substitute_type ? h("span", { class: "ai-miss-arrow", "aria-label": "replaced by" }, "→") : null,
								m.substitute_type ? h("span", { class: "ai-miss-sub" }, types.get(m.substitute_type)?.name ?? m.substitute_type) : h("span", { class: "ai-miss-none" }, m.noSub ? "not in the library" : "left out")
							)
						)
					)
				)
			)
		if (r.coverage?.fixed?.length)
			card.append(section(`Matched to your picture`, h("ul", { class: "ai-list ai-changes" }, h("li", {}, `Fixed after planning: ${r.coverage.fixed.join("; ")}`), (r.coverage.changes ?? []).filter((c) => !/^No visible change/.test(c)).slice(0, 5).map((c) => h("li", {}, c))), { collapsed: false }))
		// the plan's own account is what was MEANT to happen, written before any run: labelled so, and folded
		if (r.happened && r.howItWorks) card.append(section("The plan (written before the run)", h("p", { class: "ai-plan-notes" }, r.howItWorks), { collapsed: true }))
		if (r.assumptions?.length) card.append(section("Assumptions", h("ul", { class: "ai-list" }, r.assumptions.slice(0, 8).map((a) => h("li", {}, a))), { collapsed: r.assumptions.length > 3 }))
		if (r.unsure?.length) card.append(section(`Unsure in the picture (${r.unsure.length})`, h("ul", { class: "ai-list" }, r.unsure.slice(0, 10).map((a) => h("li", {}, a))), { collapsed: true }))
		const realChanges = (x) => (x.changes ?? []).filter((c) => !/^No visible change|^Tuning knobs/.test(c))
		// every check that gave a score is listed (the badge's own check included, even when it found nothing to change)
		const rounds = (r.refine ?? []).map((x) => ({ ...x, changes: realChanges(x) })).filter((x) => x.changes.length || x.issues?.length || x.skipped?.length || x.final || x.score != null)
		const tuned = r.tune && (r.tune.changes?.length || r.tune.changed?.length || r.tune.skipped?.length || r.tune.notes?.length)
		const staged = r.stageTune && r.stageTune.runs > 0
		// a check of a version that is not on the table and did not lead to it (an undone version, or one an earlier version beat): its remarks are
		// about that version. (A check whose changes were kept judged the version before them: read in order, that is plain.)
		const offTable = (x) => r.version != null && x.version != null && x.version !== r.version && !((x.changes?.length ?? 0) > 0 && !x.reverted && !x.rejected)
		if (rounds.length || tuned || staged) {
			const ul = h("ul", { class: "ai-rounds" })
			// (physics first: what the stage tuner did before the AI looked)
			if (staged) {
				const st = r.stageTune
				const lines = (st.changes ?? []).filter((c) => !/^No visible change/.test(c))
				const what = (x) => (x?.checks && x.checks !== x.goals ? `${x.checks} checks` : `${x?.goals ?? "?"} goals`)
				ul.append(
					h(
						"li",
						{ class: st.kept ? null : "undone" },
						h("span", { class: "ai-round-n" }, "Tuned stage by stage", h("small", {}, ` · ${plural(st.runs, "run")}, ${secs(st.ms)}`), st.kept ? null : h("span", { class: "ai-tag-undone" }, "not kept")),
						h("p", { class: "ai-round-issues" }, st.kept ? `Before the AI looked: ${what(st.before)} → ${what(st.after)} working in the physics` : st.note ?? `Nothing it tried did better (${what(st.before)} working)`),
						st.kept && lines.length ? h("p", { class: "ai-round-changes", title: lines.join("\n") }, brief(lines)) : null
					)
				)
			}
			for (const x of rounds) {
				const undone = x.reverted || (x.rejected && x.changes?.length)
				const other = offTable(x)
				ul.append(
					h(
						"li",
						{ class: undone ? "undone" : other ? "other" : null },
						h("span", { class: "ai-round-n" }, x.final ? "Final check" : `Check ${x.round}`, x.score != null ? h("small", {}, ` · ${x.score}/10`) : null, x.reverted ? h("span", { class: "ai-tag-undone" }, "undone") : other ? h("span", { class: "ai-tag-undone" }, "not this version") : null),
						x.issues?.length ? h("p", { class: "ai-round-issues" }, `${other ? "About a version that is not on the table: " : ""}${x.issues.slice(0, 3).join(" · ")}`) : !x.changes.length && x.done ? h("p", { class: "ai-round-issues" }, other ? "No problems found (in a version that is not on the table)" : "No problems found") : null,
						x.changes?.length ? h("p", { class: "ai-round-changes", title: x.changes.join("\n") }, brief(x.changes)) : null,
						x.skipped?.length ? h("p", { class: "ai-round-rej" }, `Not applied: ${x.skipped.slice(0, 3).join(" · ")}`) : null,
						x.reverted ? h("p", { class: "ai-round-rej" }, "Undone: an earlier version was kept, so these changes are not in the scene") : null,
						x.rejected ? h("p", { class: "ai-round-rej" }, x.rejected) : null,
						x.stopped ? h("p", { class: "ai-round-rej" }, x.stopped) : null,
						x.continued ? h("p", { class: "ai-round-rej" }, `It said done, but ${String(x.continued).replace(/^it said done, but /i, "")}`) : null,
						x.capped ? h("p", { class: "ai-round-rej" }, `Score: ${x.capped}`) : null
					)
				)
			}
			if (tuned) {
				const lines = r.tune.changes?.length ? r.tune.changes : (r.tune.changed ?? []).map((c) => `${c.id} ${c.param} ${c.from} → ${c.to}`)
				ul.append(
					h(
						"li",
						{ class: r.tune.reverted ? "undone" : null },
						h("span", { class: "ai-round-n" }, r.tune.runs ? (r.tune.stages ? "Tuned stage by stage" : "Tuned") : "Not tuned", r.tune.runs ? h("small", {}, ` · ${plural(r.tune.runs, "run")}, ${secs(r.tune.ms)}`) : null, r.tune.reverted ? h("span", { class: "ai-tag-undone" }, "undone") : null),
						lines.length ? h("p", { class: "ai-round-changes", title: lines.join("\n") }, brief(lines)) : null,
						r.tune.skipped?.length ? h("p", { class: "ai-round-rej" }, r.tune.skipped.join(" · ")) : null,
						r.tune.notes?.length ? h("p", { class: "ai-round-issues" }, r.tune.notes.join(" · ")) : null,
						lines.length ? h("p", { class: "ai-round-issues" }, r.tune.reverted ? "Undone: the version before tuning was kept." : r.tune.passed ? "The goal now happens in the physics." : "Closer, but the goal still isn't met.") : null
					)
				)
			}
			card.append(section("Checked and refined", ul, { collapsed: false }))
		}
		const notes = (r.solverNotes ?? []).filter((n) => n.level !== "info" || n.code !== "default_x")
		const warned = notes.filter((n) => n.level !== "info").length
		if (notes.length) card.append(section(`Placement notes (${notes.length})`, h("ul", { class: "ai-list ai-notes" }, notes.map((n) => h("li", { class: `lv-${n.level}` }, n.text))), { collapsed: !warned }))
		const timing = r.steps?.length ? r.steps.reduce((m, s) => ((m[s.step] = (m[s.step] ?? 0) + s.ms), m), {}) : r.timings ?? {}
		const timeLine = Object.entries(timing).map(([k, ms]) => `${k} ${secs(ms)}`).join(" · ")
		const undoBtn = h("button", { type: "button", class: "ai-link-btn ai-undo", hidden: !canUndo(t), onclick: () => undoTurn(t, undoBtn), title: "Undo this (⌘Z)" }, icon("undo"), "Undo")
		const restoreBtn = h("button", { type: "button", class: "ai-link-btn ai-restore", hidden: !canRestore(t), onclick: () => restoreTurn(t), title: "Put this version back on the table (one undo step)" }, icon("replay"), "Restore")
		card.append(h("div", { class: "ai-res-actions" }, h("button", { type: "button", class: "ai-chip-btn", onclick: () => host.replay?.() }, icon("replay"), "Replay"), h("span", { class: "ai-res-meta", title: timeLine }, r.models?.length ? `${shortModel(r.models)} · ${secs(r.totalMs)}` : secs(r.totalMs))))
		const detailsBtn = h("button", { type: "button", class: "ai-link-btn ai-details", "aria-expanded": String(!!t.detailsOpen), onclick: () => {
			t.detailsOpen = !t.detailsOpen
			card.hidden = !t.detailsOpen
			detailsBtn.setAttribute("aria-expanded", String(t.detailsOpen))
		} }, "Details")
		const heads = headsUp(r, { editCard })
		// (an edit: what stopped happening in the new run that the reply does not already say: lost stages, firm hits that are gone)
		const runHeads = editCard && r.edit?.headsUp?.length ? `Heads-up, in the new run: ${andJoin(r.edit.headsUp.slice(0, 3).map((x) => lcFirst(String(x).replace(/[.!]+$/, ""))))}.` : null
		const lead = h("p", { class: "ai-lead" }, ...marks(r.lead ?? fallbackLead(r)), ...fixOffer(r, t))
		// (a new scene planned from a concept sketch: the sketch as a small thumbnail beside the reply; a click shows it next to the scene's start)
		const cimg = r.mode === "new" ? (typeof r.concept === "string" ? r.concept : r.concept?.image) : null
		const leadRow = cimg
			? h(
					"div",
					{ class: "ai-lead-row" },
					lead,
					h("button", { type: "button", class: "ai-cthumb", title: `${CONCEPT_TAG}: compare it with your scene`, "aria-label": "Compare the concept sketch with your scene", onclick: () => openCompare(t), onpointerenter: () => startFrame(t).catch(() => {}) }, h("img", { src: cimg, alt: "" }), h("span", {}, "Concept"))
				)
			: lead
		return h(
			"div",
			{ class: `ai-card ai-result ai-chat${editCard ? " ai-editcard" : ""}` },
			editCard ? h("p", { class: "ai-res-kind edit" }, `${r.mode === "fix" ? "Fixed" : "Edited"}: ${r.sceneBefore ?? r.title ?? "the scene"}`) : null,
			leadRow,
			editCard ? editDelta(r) : null,
			// (what it is doing while it looks, and a Stop: up to a minute and a half of runs and the AI's reworks is never a wait without one)
			r.fix?.state === "searching" ? h("p", { class: "ai-fixline", role: "status" }, h("span", { class: "ai-spin", "aria-hidden": "true" }), h("span", { class: "ai-fixline-t" }, "Looking for a fix…", h("span", { class: "ai-fixline-n" }, "")), h("button", { type: "button", class: "ai-link-btn ai-fixstop", title: "Stop looking for a fix (nothing on the table changes)", onclick: () => stopFixSearch("user") }, icon("stop"), "Stop")) : null,
			heads ? h("p", { class: "ai-heads" }, heads) : null,
			runHeads ? h("p", { class: "ai-heads" }, runHeads) : null,
			chipsFor(t),
			h(
				"div",
				{ class: "ai-foot" },
				detailsBtn,
				undoBtn,
				restoreBtn,
				wantsCheck(t) ? h("button", { type: "button", class: "ai-link-btn ai-check", onclick: () => checkAgain(t), title: "Have the AI look at this scene again (one round of checking and fixing)" }, icon("retry"), t.report?.scoreState === "quick" ? "Check it" : "Check again") : null,
				r.score != null ? h("span", { class: `ai-foot-score ${r.score >= 8 ? "good" : r.score >= 5 ? "mid" : "low"}`, title: "How well the AI judged this scene matches what you asked" }, `${r.score}/10`) : null
			),
			card
		)
	}
	/** "a, b and c" */
	const andJoin = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] ?? "")
	/** What a turn did, to quote in "Undone: … before “…”" and on an Undo button: an edit's (or a fix's) first change line, "made the dominoes
	 *  closer together", with how many more there were; a new scene's name. */
	function turnWords(t) {
		const r = t?.report ?? {}
		const lines = r.mode === "new" || r.mode === "check" ? [] : (r.human ?? []).filter(Boolean)
		if (lines.length) return { words: changePhrase(lines[0]), more: lines.length - 1 }
		if (r.mode === "edit" && t?.request?.text) return { words: changePhrase(t.request.text), more: 0 }
		return { words: r.title ?? "the last build", more: 0 }
	}
	const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s))
	/** The edit card's own list: one line per change in real units (before → after), what could not be done, and how much is exactly as it was. */
	function editDelta(r) {
		const noChange = r.noChange || r.edit?.noChange
		const lines = noChange ? [] : r.human?.length ? r.human.map(capFirst) : (r.edit?.changes ?? []).filter((c) => !/^Tuning knobs/.test(c)).map(capFirst)
		const skipped = (r.edit?.skipped ?? (r.issues ?? []).filter((i) => i.code === "patch_skipped").map((i) => i.text)).map((x) => String(x).replace(/^Not done:\s*/i, "")).filter(Boolean)
		const un = r.edit?.unchanged
		const items = [
			...lines.slice(0, 8).map((c) => h("li", {}, c)),
			lines.length > 8 ? h("li", { title: lines.slice(8).join("\n") }, `and ${lines.length - 8} more`) : null,
			...skipped.slice(0, 3).map((x) => h("li", { class: "skip" }, `Not done: ${x}`)),
			...(r.edit?.goalsDropped ?? []).slice(0, 3).map((x) => h("li", { class: "skip" }, `No longer checked: ${x}`)),
			noChange ? h("li", { class: "same" }, "Nothing in the scene changed") : un && un.of > 0 ? h("li", { class: "same" }, un.same ? `Everything else is exactly as it was (${plural(un.same, "item")} untouched)` : "Every item was changed") : null
		].filter(Boolean)
		return items.length ? h("ul", { class: "ai-delta", "aria-label": "What changed" }, items) : null
	}
	/** An edit's Details, first: what the AI took the words to mean, why, how long it took and with which model (and the repair or fix rounds). */
	function editFacts(r) {
		const e = r.edit ?? {}
		const rows = []
		if (e.targetWords?.length) rows.push(["Understood", e.targetWords.join(" · ")])
		if (e.why) rows.push(["Why", e.why])
		const ff = e.fixFlow
		if (ff) {
			const aim = ff.aimed ? `moved ${ff.aimed.name ?? ff.aimed.id} ${[moveWords(ff.aimed.dx_m, "right", "left"), moveWords(ff.aimed.dy_m, "up", "down")].filter(Boolean).join(" and ") || "into place"} (${plural(ff.aimed.runs ?? 0, "physics run")})` : null
			rows.push(["Made it work", [aim, ff.rounds ? `${plural(ff.rounds, "more AI round")}` : null, ff.fixer ? "then the fix search" : null].filter(Boolean).join(" · ") || "nothing needed"])
		}
		if (e.repair) rows.push(["Overlaps", `fixed in one more turn: ${e.repair.before} → ${e.repair.after} at the start${e.repair.kept ? "" : " (not kept: no better)"}`])
		rows.push(["Time", [r.totalMs ? secs(r.totalMs) : null, r.models?.length ? shortModel(r.models) : null].filter(Boolean).join(" · ") || "—"])
		return h("dl", { class: "ai-kv" }, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))
	}
	// ---- the concept sketch next to the scene's start (the result card's thumbnail): the difference between the idea and what was built
	const frames = new Map() // turn id -> Promise<data URL of the scene's start>
	/** The scene a turn put on the table, at its start, as a small JPEG: from the run on the table when it is still that scene, else run again
	 *  from the kept version. Rendered once (the critic's hidden camera, ./shot.js) and kept with the turn. */
	function startFrame(t) {
		if (t.report?.startFrame) return Promise.resolve(t.report.startFrame)
		if (frames.has(t.id)) return frames.get(t.id)
		const p = (async () => {
			if (!t.sceneJSON) throw new Error("This version of the scene isn’t kept any more.")
			const live = host.getSim?.()
			const onTable = JSON.stringify(host.getScene() ?? null) === t.sceneJSON
			const sim = onTable && live?.doc && live?.track && (!t.simKey || live.key === t.simKey) ? live : await api("/api/simulate", { scene: JSON.parse(t.sceneJSON) })
			const [pic] = await getShot().render(sim, { times: [{ label: "start", t: 0 }] })
			const url = await shrinkJpeg(pic.dataUrl, 768, 432)
			if (t.report) t.report.startFrame = url
			persist()
			return url
		})()
		frames.set(t.id, p)
		p.catch(() => frames.delete(t.id))
		return p
	}
	/** A data URL drawn again at w × h as a JPEG (a start frame for keeping: ~40 KB). */
	function shrinkJpeg(src, w, hgt, q = 0.8) {
		return new Promise((resolve, reject) => {
			const im = new Image()
			im.onload = () => {
				const c = document.createElement("canvas")
				c.width = w
				c.height = hgt
				const g = c.getContext("2d")
				g.imageSmoothingQuality = "high"
				g.drawImage(im, 0, 0, w, hgt)
				resolve(c.toDataURL("image/jpeg", q))
			}
			im.onerror = () => reject(new Error("The picture couldn’t be read"))
			im.src = src
		})
	}
	let cmp = null
	function compareDialog() {
		if (cmp) return cmp
		const left = h("img", { alt: "Concept sketch of your idea, drawn by AI from your words" })
		const right = h("div", { class: "ai-cmp-pic" })
		const title = h("h2", { id: "ai-cmp-t" }, "")
		const dlg = h(
			"dialog",
			{ class: "ai-cmp", "aria-labelledby": "ai-cmp-t" },
			h("div", { class: "ai-cmp-head" }, title, h("button", { type: "button", class: "ai-icon-btn", "aria-label": "Close", title: "Close (Esc)", onclick: () => dlg.close() }, icon("close"))),
			h(
				"div",
				{ class: "ai-cmp-body" },
				h("figure", {}, h("div", { class: "ai-cmp-pic" }, left), h("figcaption", {}, h("b", {}, CONCEPT_TAG), "Drawn from your words before planning, to plan from. It is not the result.")),
				h("figure", {}, right, h("figcaption", {}, h("b", {}, "Your scene · at the start"), "What was built from your words, as the physics engine starts it. Press play to watch it run."))
			)
		)
		dlg.addEventListener("click", (e) => e.target === dlg && dlg.close())
		// (the page under the dialog must not see its keys: Space would play, ⌫ delete the selected part)
		dlg.addEventListener("keydown", (e) => e.stopPropagation())
		document.body.append(dlg)
		return (cmp = { dlg, left, right, title, for: null })
	}
	function openCompare(t) {
		const c = t.report?.concept
		const img = typeof c === "string" ? c : c?.image
		if (!img) return
		const d = compareDialog()
		d.for = t.id
		d.left.src = img
		d.title.textContent = t.report?.title ? `“${t.report.title}”: the sketch and the scene` : "The sketch and the scene"
		d.right.classList.add("wait")
		d.right.replaceChildren(h("span", { class: "ai-spin", role: "status", "aria-label": "Drawing the scene’s start" }))
		if (!d.dlg.open) d.dlg.showModal()
		startFrame(t).then(
			(url) => d.for === t.id && (d.right.classList.remove("wait"), d.right.replaceChildren(h("img", { src: url, alt: `${t.report?.title ?? "Your scene"} at the start` }))),
			(e) => d.for === t.id && d.right.replaceChildren(h("p", {}, e?.message ?? "The scene’s start couldn’t be drawn."))
		)
	}
	/** 0.04 m -> "4 cm right" (null when it did not move that way). */
	const moveWords = (m, pos, neg) => (Number.isFinite(m) && Math.abs(m) >= 0.0005 ? `${Math.abs(m) >= 1 ? `${(Math.abs(m)).toFixed(2)} m` : `${Math.round(Math.abs(m) * 1000) / 10} cm`} ${m > 0 ? pos : neg}` : null)
	/** ✓ and ✗ in a reply, coloured. */
	const marks = (text) => String(text).split(/(✓|✗)/).map((p) => (p === "✓" ? h("span", { class: "ai-ok-mark", "aria-label": "works" }, "✓") : p === "✗" ? h("span", { class: "ai-bad-mark", "aria-label": "doesn't work yet" }, "✗") : p))
	/** A reply for a turn saved before replies were written. */
	const fallbackLead = (r) => `${r.mode === "edit" ? "Changed" : r.mode === "check" ? "Checked" : "Built"} “${r.title ?? "the scene"}”.${(r.goals ?? []).length ? ` ${(r.goals ?? []).filter((g) => g.ok).length} of ${r.goals.length} goals happen ${(r.goals ?? []).every((g) => g.ok) ? "✓" : "✗"}` : ""}`
	/** One line when something is off that the person should know at once (a check that couldn't run, a thing not in the library, the picture's
	 *  differences); the rest is in Details. */
	function headsUp(r, { editCard = false } = {}) {
		const types = new Map((host.getCatalog()?.types ?? []).map((ty) => [ty.key, ty]))
		const warn = (r.issues ?? []).find((i) => (i.level === "warn" || i.level === "error") && !(editCard && i.code === "patch_skipped"))
		const miss = (r.missing ?? [])[0]
		const more = (n) => (n > 1 ? ` (and ${n - 1} more: see Details)` : "")
		if (warn) return `Heads-up: ${warn.text}`
		// (a stand-in that isn't on the table is never said: V8820 c04)
		if (miss) {
			// ("there are no standing toilet paper rolls in the library, so I used toilet paper rolls", never "there’s no … rolls" (V8842 n2))
			const asked = String(miss.asked).replace(/^(a|an|the|some) /i, "")
			const many = (/s$/i.test(asked.split(/\s+(?:in place of|instead of|for)\s+/)[0]) && !/ss$/i.test(asked)) || /^(\d+|two|three|four|five|six|seven|eight|nine|ten|several|many)\b/i.test(asked)
			const sub = miss.substitute_type
			let used = "I left it out"
			if (sub) {
				let subW = String(types.get(sub)?.name ?? sub).toLowerCase()
				try {
					if (many) subW = String(kindNoun(sub, 2) ?? subW).toLowerCase()
				} catch {}
				used = `I used ${many ? "" : /^[aeiou]/i.test(subW) ? "an " : "a "}${subW}`
			}
			return `Heads-up: ${many ? "there are no" : "there’s no"} ${asked} in the library${miss.noSub ? "" : `, so ${used}`}${more(r.missing.length)}.`
		}
		if (r.differences?.length) return `Heads-up: ${String(r.differences[0]).replace(/\.$/, "")}${more(r.differences.length)}.`
		return null
	}
	/** Next edits to try, for this scene: a fix first when a goal fails, then the AI's own ideas, then ones read off the scene. A click asks for it.
	 *  (./edit-turns.js editChips: never a second "make it work" beside the offer or the rework button, never one when it already works, never
	 *  one that moves back what a fix just moved.) */
	/** Does a chip's request name a kind of thing that isn't on the table ("Move the bucket 10 cm left" with no bucket: V8817 b1)? */
	function namesAbsent(text) {
		const its = realItems()
		const types = host.getCatalog()?.types ?? []
		const typeName = new Map(types.map((ty) => [ty.key, String(ty.name ?? "").toLowerCase()]))
		for (const ty of types) {
			const head = String(ty.name ?? "").toLowerCase().replace(/,.*$/, "").replace(/\(.*\)/g, "").trim().split(/\s+/).at(-1)
			if (!head || head.length < 3 || !new RegExp(`\\bthe ${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(text)) continue
			if (!its.some((i) => String(i.name ?? "").toLowerCase().includes(head) || (typeName.get(i.type) ?? i.type).includes(head))) return true
		}
		return false
	}
	/** The kinds a change put on the table (each thing it added or swapped in, by its kind's name and its own): an idea chip never swaps,
	 *  replaces or takes one away (V8820: "Swap orange for apple" after the person's orange). A fix's card keeps its edit's. */
	function personKinds(t) {
		const r = t?.report
		if (!r) return []
		if (Array.isArray(r.mineKinds)) return r.mineKinds
		// (a reply about the scene on the table, a rework that didn't work among them: the kinds of the change it is about, the card before it)
		if (r.replyOnly) {
			const i = S.turns.indexOf(t)
			const prev = [...S.turns.slice(0, i < 0 ? S.turns.length : i)].reverse().find((x) => x.role === "ai" && x.state === "done" && !x.report?.replyOnly)
			return prev ? personKinds(prev) : []
		}
		// (and what the person put in with the changes before it, on this scene's line: the orange of an earlier edit is still theirs)
		const prev = t.baseJSON ? S.turns.find((x) => x !== t && x.role === "ai" && x.state === "done" && !x.report?.replyOnly && x.sceneJSON && sameTable(x.sceneJSON, t.baseJSON) && S.turns.indexOf(x) < S.turns.indexOf(t)) : null
		const own = kindsPut(t.baseJSON, t.sceneJSON)
		const earlier = prev && Array.isArray(prev.report?.mineKinds) ? prev.report.mineKinds : []
		return (r.mineKinds = [...new Set([...own, ...earlier])].slice(0, 16))
	}
	function kindsPut(beforeJSON, afterJSON) {
		try {
			const a = beforeJSON ? JSON.parse(beforeJSON) : null
			const b = afterJSON ? JSON.parse(afterJSON) : null
			if (!a?.items || !b?.items) return []
			const was = new Map(a.items.map((i) => [i.id, i.type]))
			const types = new Map((host.getCatalog()?.types ?? []).map((ty) => [ty.key, ty]))
			const out = new Set()
			for (const it of b.items) {
				if (it.type === "table" || it.type === "wall" || was.get(it.id) === it.type) continue
				const kind = String(types.get(it.type)?.name ?? it.type.replace(/-/g, " ")).replace(/,.*$/, "").replace(/\s*\(.*\)$/, "").trim().toLowerCase()
				if (kind) out.add(kind)
				const own = String(it.name ?? "").replace(/\s+\d+$/, "").trim().toLowerCase()
				if (own && own.length >= 3 && !/^(ball|item|thing)$/.test(own)) out.add(own)
			}
			return [...out].slice(0, 12)
		} catch {
			return []
		}
	}
	/** An idea of the AI's names a thing by its kind ("the hollow plastic ball") while the card calls it by its name on screen ("Ball 2"): said
	 *  as the screen says it, or dropped when it can't be told which (./edit-turns.js nameAsShown: V8820). */
	function nameShown(s) {
		const types = new Map((host.getCatalog()?.types ?? []).map((ty) => [ty.key, ty]))
		return nameAsShown(s, realItems(), (type) => types.get(type)?.name ?? "")
	}
	/** How many of each kind are on the table, by the words a person counts them with: "dominoes" -> 7 (a row's count), "soda cans" -> 6. */
	function tableCounts() {
		const out = new Map()
		for (const it of realItems()) {
			const n = it.type === "domino-row" ? Number(it.props?.count ?? 7) || 0 : 1
			let w = "dominoes"
			if (it.type !== "domino-row")
				try {
					w = String(kindNoun(it.type, 2, { short: true }) ?? "").toLowerCase()
				} catch {
					continue
				}
			if (w) out.set(w, (out.get(w) ?? 0) + n)
		}
		return out
	}
	function chipsFor(t) {
		const r = t.report ?? {}
		const latest = t.id === activeTurn()?.id
		// (a reply that changed nothing: its chips follow the card whose scene is on the table, its goals and its fix: V8832 y2 / y19)
		const sc = r.replyOnly ? sceneCard(t.baseJSON && sameTable(t.baseJSON, tableJSON()) ? t.baseJSON : tableJSON()) : null
		// (a plain answer after a card with a checked fix shows that fix too, applied from that card: V8838 Q)
		const offer = r.replyOnly && latest ? offeringCard(t) ?? offerBeside(t) ?? offerFromOf(t) : null
		// (the question's own request: the person's words before it, for the counts it states)
		const askedText = t.request?.text || (r.replyOnly ? [...S.turns.slice(0, S.turns.indexOf(t))].reverse().find((x) => x.role === "user")?.text : "") || ""
		const list = editChips(r, { rework: !!t.request?.rework || !!r.reworkFailed, examples: latest ? editExamples().map((ex) => ex.text) : [], asked: askedText, isOutcome: statesOutcome, mine: personKinds(t), counts: latest ? tableCounts() : null, ...(r.replyOnly ? { scene: sc?.report ?? null, sceneLive: !!offer } : {}) })
			.filter((s) => !(s.rework && t.reworkAsked))
			.map((s) => (s.fix || s.apply || s.rework ? s : nameShown(s)))
			.filter((s) => s && (s.fix || s.apply || s.rework || !latest || !namesAbsent(`${s.label} ${s.prompt ?? ""}`)))
		if (!list.length) return null
		return h(
			"div",
			{ class: "ai-chips", role: "group", "aria-label": "Try next" },
			// (a fix chip's request is long and written for the AI: the bubble shows the chip's own words, and the request goes as sent)
			list.slice(0, 3).map((s) => h("button", { type: "button", class: `ai-sugg${s.fix ? " fix" : ""}${s.go ? " go" : ""}`, title: s.prompt, onclick: () => (s.apply ? applyFix(s.sceneFix && offer ? offer : t, s.apply) : s.rework ? askRework(t) : suggest(s, s.fix ? s.label : null)) }, s.go ? icon("check") : s.fix ? icon("retry") : icon("sparkle"), h("span", {}, s.label)))
		)
	}
	/** The offer after an edit's reply, from the search for a fix: "Want me to lower the box 4 cm? (checked: Ball 2 lands in the box ✓)"; when
	 *  nothing works, said so, with the button that asks the AI to rework it right there (never a question without a button). */
	function fixOffer(r, t = null) {
		const fx = r?.fix
		const words = offerWords(fx, { rework: !!t?.request?.rework || !!r?.reworkFailed })
		if (!words) return []
		if (fx.state === "found") {
			const ok = h("span", { class: "ai-ok-mark", "aria-label": "works" }, "✓")
			// (a fix that works only at its exact value says so: "only just")
			return [` ${words.before}`, h("b", {}, words.say), "? ", h("span", { class: "ai-checked", title: `I ran it in the physics engine: ${words.checked} happens${fx.fragile ? " (but a few millimetres either way and it misses)" : ""}` }, "(checked: ", words.checked, " ", ok, fx.fragile ? ", only just" : "", ")")]
		}
		// (once asked from this card, never again: the paid rework is one press, and its own reply says how it went)
		const btn = t && words.button && !t.reworkAsked ? h("button", { type: "button", class: "ai-offer-btn", onclick: () => askRework(t) }, icon("retry"), words.button) : null
		// (stopped by its Stop: the physics search may go on from the start, which costs nothing: "Look again")
		const again = t && fx.state === "stopped" && (!fx.movedOn || fx.movedOn === "new") && fixCtxs.has(t.id) && !t.reworkAsked ? h("button", { type: "button", class: "ai-again-btn", title: "Run the physics search for a fix again (no AI call)", onclick: () => lookAgain(t) }, icon("replay"), "Look again") : null
		return [` ${words.text}`, ...(again ? [" ", again] : []), ...(btn ? [" ", btn] : [])]
	}
	/** "Ask the AI to rework it": the same rework the background tried (its words, what it keeps, what never comes back, the reasons the run
	 *  showed), now in the open, made to work as a "make it work" request is. Never offered again after it, when it still doesn't work. */
	function askRework(t) {
		if (S.job) return note("Wait for this build to finish (or press Stop) first")
		const rw = t.report?.fix?.rework
		t.reworkAsked = true
		S.reworkOfNext = t.id
		suggest({ prompt: rw?.text ?? reworkPrompt(t), keep: rw?.keep ?? t.report?.edit?.touched ?? null, hard: t.report?.edit?.hard ?? null, rework: { removedTypes: rw?.removedTypes ?? [], feedback: rw?.feedback ?? null } }, "Ask the AI to rework it")
		// (it didn't start, signing in first, say: the button stays the card's)
		if (S.running?.reworkOf !== t.id) {
			t.reworkAsked = false
			S.reworkOfNext = null
		}
		rerenderTurn(t)
	}
	/** The background search stopped by its Stop, asked again from the card ("Look again"): the physics first, as it was (V8820 s3: the laptop
	 *  is found in about 5 s, but after Stop only the paid rework was offered). */
	function lookAgain(t) {
		if (S.job) return note("Wait for this build to finish (or press Stop) first")
		const ctx = fixCtxs.get(t.id)
		if (!ctx || !sameTable(t.sceneJSON, tableJSON())) return note("The scene has changed since: ask me again (for example “make it work”)")
		shield()
		t.report.fix = { state: "searching" }
		rerenderTurn(t)
		persist()
		// (the physics only: "Look again" asks nothing of the AI, whatever it found or didn't)
		startFixSearch(t, ctx, { ai: false })
	}
	/** What "Ask the AI to rework it" asks: the goal to win back, keeping the change that was just made. */
	function reworkPrompt(t) {
		const r = t.report ?? {}
		const g = r.fix?.goal ?? (r.targets ?? []).find((x) => x.ok === false && !x.implicit)?.label ?? (r.targets ?? []).find((x) => x.ok === false)?.label ?? (r.goals ?? []).find((x) => x.ok === false)?.label ?? "it works again"
		return reworkWords(g, r.human ?? [])
	}
	/**
	 * A fix chip clicked (or "yes"): the scene the search ran is put on the table at once, as its own undo step, and the reply says so ("Done — I
	 * lowered the box 4 cm. Ball 2 lands in the box ✓"). which: "fix" (the checked fix) or "near" (the closest miss, said as such).
	 */
	function applyFix(t, which = "fix", said = null, { bubble = true } = {}) {
		if (S.job) return note("Wait for this build to finish (or press Stop) first")
		shield()
		const fx = t.report?.fix
		const data = which === "near" ? fx?.near : fx
		if (!data?.sceneJSON) return
		if (!sameTable(t.sceneJSON, tableJSON())) return (note("The scene has changed since I found that: ask me again (for example “make it work”)"), false)
		let scene
		try {
			scene = JSON.parse(data.sceneJSON)
		} catch {
			return false
		}
		// (a name given by hand since stays: the fix changes the machine, not what the scene is called)
		const nameNow = host.getScene()?.name
		if (typeof nameNow === "string" && nameNow) scene.name = nameNow
		stopFixSearch()
		if (bubble) userBubble(said ?? data.label, "fix")
		const before = host.getScene()
		const committed = host.applyScene(scene, { label: capFirst(data.label.replace(/^Try: /, "")), play: true, verb: "Fixed" })
		const sceneNow = JSON.stringify(host.getScene() ?? scene)
		const okAll = which === "fix"
		const results = data.results ?? []
		// (a fix that works gets no ideas: each would change the machine again; a closest miss keeps the edit's, filtered as a fix card's are)
		const rest = okAll ? [] : (t.report?.suggestions ?? []).slice(0, 3)
		const report = {
			mode: "fix",
			title: t.report?.title,
			sceneBefore: t.report?.title,
			lead: okAll ? `Done — I ${data.did}. ${capFirst(fx.checked ?? "it works")} ✓` : `Done — I ${data.did}, but ${lcFirst(data.happened ?? "it still doesn’t work")} ✗.`,
			// (each change on its own line, grouped, in real units, read off the two scenes: what was added (a closed laptop), every move, the table
			// made wider; never "and 1 more change" with nothing under it: V8814 c11 / s3)
			human: changeLinesOf(before, scene) ?? (Array.isArray(data.changes) && typeof data.changes[0] === "string" ? data.changes : [data.did]),
			goals: (t.report?.goals ?? []).map((g) => ({ ...g, ok: okAll ? true : results.find((x) => x.label === g.label)?.ok ?? g.ok, was: g.ok })),
			targets: okAll ? (t.report?.targets ?? []).map((x) => ({ label: x.label, ok: true, implicit: x.implicit })) : results,
			fix: okAll ? null : { state: "none", goal: fx.goal, checked: fx.checked },
			suggestions: rest,
			mineKinds: personKinds(t),
			used: t.report?.used,
			edit: { unchanged: unchangedOf(before, scene), ...(t.report?.edit?.touched ? { touched: t.report.edit.touched } : {}) },
			items: scene.items?.length ?? 0,
			totalMs: fx.ms ?? null
		}
		fx.used = which
		const turn = { id: `a${nextId++}`, at: Date.now(), role: "ai", state: "done", request: { text: said ?? data.label, mode: "fix", images: [] }, report, baseJSON: JSON.stringify(before ?? null) }
		turn.sceneJSON = sceneNow
		if (okAll) turn.goodJSON = sceneNow
		// (the AI's rework comes with its own plan: what it added has its place in it)
		let own = null
		try {
			own = data.planJSON ? JSON.parse(data.planJSON) : null
		} catch {}
		turn.plan = own ?? planAfterFix(t.plan ?? S.lastBuild?.plan ?? null, scene)
		const changed = committed !== false
		turn.hi = changed ? host.historyIndex?.() ?? null : null
		if (changed) S.lastAppliedId = turn.id
		S.lastBuild = { plan: turn.plan, sceneJSON: sceneNow, title: report.title, turnId: turn.id }
		S.turns.push(turn)
		thread.append(renderTurn(turn))
		syncMode()
		syncUndoButtons()
		persist()
		announce(report.lead)
		scrollToEnd()
		return true
	}
	/** A change's lines from one scene to another, grouped, in a person's words (null when they can't be said). */
	function changeLinesOf(a, b) {
		try {
			// (what it added first, the table made wider last)
			const rank = (t) => (/^(added|stood|replaced)\b/.test(t) ? 0 : /\b(widened|narrowed) the table\b/.test(t) ? 2 : 1)
			const lines = humanChangeList(a, b)
				.map((c, i) => ({ t: c.text, i }))
				.sort((p, q) => rank(p.t) - rank(q.t) || p.i - q.i)
				.map((x) => x.t)
			return lines.length ? lines : null
		} catch {
			return null
		}
	}
	/** The items of a scene that are byte for byte the same in another (not the table or the safety walls). */
	function unchangedOf(a, b) {
		const B = new Map((b?.items ?? []).map((i) => [i.id, JSON.stringify(i)]))
		const real = (a?.items ?? []).filter((i) => i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d))
		const same = real.filter((i) => B.get(i.id) === JSON.stringify(i))
		return { same: same.length, of: real.length }
	}
	/** After an edit stopped a goal: the search for a fix runs while the change plays (./orchestrator.js makeItWork: the fix search, and side by
	 *  side the AI's rework in the background, each checked in the physics; ≈ 60 s at most). The reply shows "Looking for a fix…" with what it
	 *  is doing, then offers the checked fix, or says plainly that nothing works, with the button that asks the AI in the open. A new request
	 *  stops it. */
	function startFixSearch(turn, ctx, { ai: aiOk = true } = {}) {
		stopFixSearch()
		const ctl = new AbortController()
		const job = { ctl, turnId: turn.id, stopped: null }
		S.fixJob = job
		const goal = (turn.report?.targets ?? []).find((x) => x.ok === false && !x.implicit)?.label ?? (turn.report?.targets ?? []).find((x) => x.ok === false)?.label ?? null
		const line = (words) => {
			const el = thread.querySelector(`[data-id="${turn.id}"] .ai-fixline-n`)
			if (el) el.textContent = words
			// (one line in the drawer, cut short with "…" when narrow: the whole of it on hover)
			if (el?.parentElement) el.parentElement.title = `Looking for a fix…${words}`
		}
		// (the person moved on: an undo, another scene, a change by hand. The search and the AI's reworks are for the scene this turn put on the
		// table, so they stop at once: nothing more is spent on a scene that is gone, and nothing is offered for it: V8814 / VERIFY, 16 Oct)
		const watch = setInterval(() => {
			if (S.fixJob !== job) return clearInterval(watch)
			if (turn.sceneJSON && !sameTable(tableJSON(), turn.sceneJSON)) stopFixSearch(movedOnWhy(turn))
		}, 300)
		ai.makeItWork(ctx, {
			signal: ctl.signal,
			ai: aiOk && !turn.aiSpent && !turn.aiTried,
			job: { text: turn.request?.text ?? "", history: historyFor(turn), plan: turn.plan ?? null, keep: turn.report?.edit?.touched ?? null, hard: turn.report?.edit?.hard ?? null },
			// (once the AI's reworks have started for this scene, a follow-up change on it never starts another set: turn.aiSpent)
			onProgress: (p) => (/^ai/.test(String(p?.phase ?? "")) && (turn.aiTried = true), line(fixProgressWords(p)))
		}).then(
			(r) => {
				clearInterval(watch)
				if (S.fixJob !== job) return
				S.fixJob = null
				// (the scene changed while the last runs finished: what was found is for a scene that is gone)
				if (turn.sceneJSON && !sameTable(tableJSON(), turn.sceneJSON)) {
					turn.report.fix = { state: "stopped", goal, movedOn: movedOnWhy(turn) }
					rerenderTurn(turn)
					persist()
					refreshMini()
					return
				}
				// (with how many model calls the AI's reworks started for it, a stopped one too: Details and the measurements read it)
				turn.report.fix = r.status === "ok" ? null : { ...r.info, ...(r.aiCalls ? { aiCalls: r.aiCalls } : {}) }
				rerenderTurn(turn)
				// (a question asked while it looked was answered meanwhile: that answer is the live card, and shows the offer now)
				const act = activeTurn()
				if (act && act !== turn && act.report?.replyOnly && act.state === "done") rerenderTurn(act)
				persist()
				const fx = turn.report.fix
				// a "yes" typed while it looked: the fix goes on the table now (or the reply says plainly that there is none)
				if (job.applyOnFound) {
					if (fx?.state === "found") {
						if (applyFix(turn, "fix", job.applyOnFound, { bubble: false }) !== true) replyTurn("The scene changed while I looked, so I didn’t apply it — ask me again (for example “make it work”).")
					} else noFixReply(turn, `${offerWords(fx)?.text ?? "I couldn’t find a change that works."}`)
					return
				}
				announce(fx?.state === "found" ? `Found a fix: ${fx.say}` : "No fix found that works")
				// (a phone: the sheet got out of the way while the change played; it comes back with the question, which is the point of the reply)
				if (!S.open && !wide() && !S.job) {
					open()
					setMini(false)
					scrollToEnd()
				} else if (!S.open) {
					S.unseen = true
					host.button?.classList.add("unseen")
					host.toast?.(fx?.state === "found" ? `Fix found: ${lcFirst(fx.label)}. Open Edit with AI to apply it` : "No fix found that works: open Edit with AI to see")
				} else if (S.mini) {
					miniTitle.textContent = fx?.state === "found" ? "Found a fix" : "No fix found"
					miniSub.textContent = fx?.state === "found" ? fx.label : "open to see"
					btnMiniStop.hidden = true
				}
			},
			(e) => {
				clearInterval(watch)
				const mine = S.fixJob === job
				if (mine) S.fixJob = null
				const why = job.stopped ?? (turn.sceneJSON && !sameTable(tableJSON(), turn.sceneJSON) ? movedOnWhy(turn) : null)
				if (turn.report?.fix?.state === "searching") turn.report.fix = e?.name === "AbortError" ? { state: "stopped", goal, ...(why && why !== "user" ? { movedOn: why } : {}) } : { state: "error", goal, error: String(e?.message ?? e) }
				rerenderTurn(turn)
				persist()
				refreshMini()
				if (mine && job.applyOnFound && e?.name !== "AbortError") noFixReply(turn, "I couldn’t look for a fix just now.")
			}
		)
	}
	/** What a reply says when the AI stopped (or kept nothing) because the scene it worked on went off the table while it worked. */
	const movedOnWords = (turn) => (turn.undone === "undo" ? "You undid the change while I worked, so I stopped. Nothing else changed." : "The scene changed while I worked, so I stopped and left it as it is. Nothing else changed.")
	/** Stop the background search (and the AI's reworks with it). why: "user" (its Stop), "undo" (the change was undone), "changed" (another
	 *  scene, a change by hand), or nothing (a new request: its own card follows). */
	function stopFixSearch(why = null) {
		if (!S.fixJob) return
		S.fixJob.stopped ??= why
		S.fixJob.ctl.abort()
	}
	/** Why the scene a search was for is not on the table: undone (the table shows the scene from before that change), or changed otherwise. */
	const movedOnWhy = (turn) => {
		if (turn.baseJSON && sameTable(tableJSON(), turn.baseJSON)) return "undo"
		// (an edit the AI is still working on: its own scene isn't on the table yet, so the table being one the person had before it is an Undo)
		if (turn.state === "running" && S.turns.some((x) => x !== turn && x.role === "ai" && x.state === "done" && (sameTable(x.baseJSON, tableJSON()) || sameTable(x.sceneJSON, tableJSON())))) return "undo"
		return "changed"
	}
	/** The history moved: Undo / Restore buttons, the live card and the folded chip follow; a search for a scene that is gone stops, and so does
	 *  an edit (or a check, or "Ask the AI to rework it") the AI is working on for it. */
	function onHistory() {
		const ft = S.fixJob ? S.turns.find((x) => x.id === S.fixJob.turnId) : null
		if (ft?.sceneJSON && !sameTable(tableJSON(), ft.sceneJSON)) stopFixSearch(movedOnWhy(ft))
		// (a search stopped because the scene went off the table, and that scene is back (an Undo or a Redo back to it): its card says it stopped
		// and offers the free "Look again" and the rework button again, never a dead end with nothing offered (V8832 y7))
		const now = tableJSON()
		for (const t of S.turns) {
			const fx = t.report?.fix
			if (t.role !== "ai" || t.state !== "done" || fx?.state !== "stopped" || !fx.movedOn || fx.movedOn === "new" || !t.sceneJSON || !sameTable(t.sceneJSON, now)) continue
			t.report.fix = { ...fx, movedOn: null, back: true }
			rerenderTurn(t)
			persist()
		}
		watchJob()
		syncUndoButtons()
		markLatest()
		refreshMini()
	}
	/** An edit, a check or a rework the AI is working on started from the scene then on the table: an Undo (the card's or the top bar's), another
	 *  scene or a change by hand while it works stops it at once, its calls aborted, and nothing it made goes on the table (V8820 x13: "make the
	 *  box 2 cm wider" landed on the undone scene and put the undone 5 cm move back; x12: an undone rework made a second call 57 s later). */
	function watchJob() {
		const t = S.running
		if (!S.job || !t || t.undone || !["edit", "check"].includes(t.request?.mode) || !t.baseJSON) return
		if (sameTable(tableJSON(), t.baseJSON)) return
		t.undone = movedOnWhy(t)
		S.job.cancel()
	}
	/** The folded chip says what is on the table now (never "0 of 1 goals met" for a build that was undone). */
	function refreshMini() {
		if (S.job) return
		btnMiniStop.hidden = !S.fixJob
		const t = activeTurn()
		const r = t?.report
		if (!t || !r || r.replyOnly || !sameTable(t.sceneJSON, tableJSON())) {
			miniTitle.textContent = host.getScene()?.name ?? "Your scene"
			miniSub.textContent = S.fixJob ? "looking for a fix…" : "open to ask for a change"
			return
		}
		const goals = r.targets?.length ? r.targets.filter((g) => !g.implicit) : r.goals ?? []
		const ok = goals.filter((g) => g.ok === true).length
		miniTitle.textContent = r.title ?? host.getScene()?.name ?? "Your scene"
		miniSub.textContent = S.fixJob && S.fixJob.turnId === t.id ? "looking for a fix…" : r.fix?.state === "found" ? `fix found: ${r.fix.label}` : goals.length ? `${ok} of ${goals.length} goal${goals.length === 1 ? "" : "s"} met` : "done"
	}
	/** The person's words in the thread (mode: the bubble's tag). */
	function userBubble(text, mode = "edit", extra = {}) {
		const user = { id: `u${nextId++}`, at: Date.now(), role: "user", text, images: [], mode, ...extra }
		S.turns.push(user)
		thread.append(renderTurn(user))
		return user
	}
	/** A reply that changes nothing (its chips from `report`). */
	function replyTurn(reply, report = {}) {
		const turn = { id: `a${nextId++}`, at: Date.now(), role: "ai", state: "done", request: { text: "", mode: "edit", images: [] }, report: { replyOnly: true, reply, ...report } }
		S.turns.push(turn)
		thread.append(renderTurn(turn))
		persist()
		announce(reply)
		scrollToEnd()
		return turn
	}
	/** After a "yes" that waited for the search: there was no checked fix. The reply offers the AI's rework (keeping what the person changed). */
	function noFixReply(t, words) {
		const r = t.report ?? {}
		// (nothing can fix it, the person's own change puts it out of reach: said, and nothing offered)
		if (r.fix?.outOfReach) return replyTurn(words, { suggestions: [] })
		replyTurn(words, { fixNeeded: true, edit: r.edit?.touched ? { touched: r.edit.touched } : undefined, human: r.human, targets: r.targets, goals: r.goals, fix: r.fix?.rework ? { state: "none", goal: r.fix.goal, rework: r.fix.rework, quiet: true } : undefined, suggestions: [] })
	}
	/**
	 * A "yes" typed to the latest reply does what it offered: its checked fix goes on the table (while the search still runs, the moment it is
	 * found); "want the AI to rework it?" asks the AI; "Want me to fix it?" asks for the fix. With nothing offered it says so: a bare yes never goes
	 * to the AI as a change. -> false when the words are a request after all ("fix it" with nothing offered: the AI makes it work)
	 */
	/** The latest reply, when it owns an offer of its own (ownOffer) and is about the scene on the table: {turn, kind}; else null. */
	function ownOfferNow() {
		const act = activeTurn()
		const last = [...S.turns].reverse().find((x) => x.role === "ai" && x.state === "done")
		if (!act || act !== last) return null
		const kind = ownOffer(act)
		return kind ? { turn: act, kind } : null
	}
	/**
	 * A "yes" (or "make it work") to a reply that owns its offer: a question back is answered by its choices ("Which one?", nothing spent); an
	 * answer that proposes a change goes to the AI as that change, the conversation with it ("Yes, do that: …"), and what the question said to
	 * keep goes with it ("without moving the box"); an answer that proposes nothing asks which change is meant. -> true (handled)
	 */
	function yesToOwn(own, text, { make = false } = {}) {
		const x = own.turn
		const r = x.report ?? {}
		input.value = ""
		autosize()
		syncCount()
		const asked = askedBefore(x)
		const kept = keepClauses(asked)
		const keepW = kept.length ? `, ${kept.join(" and ")}` : ""
		if (own.kind === "ask") {
			userBubble(text)
			replyTurn("Which one? Pick one of these.", { edit: { kind: "ask" }, suggestions: (r.suggestions ?? []).slice(0, 4) })
			return true
		}
		// (the question asked for it to work with something kept, "is there a way to fix it without touching the box?": a yes is that, a "make it
		// work" with the box kept, which the physics looks at first (V8842 ql / qa: "Yes, do that: try a steeper tilt" cost $0.20 and didn't work,
		// where the physics finds a smaller tilt in seconds))
		if (kept.length && statesOutcome(asked)) {
			suggest({ prompt: `make it work${keepW}` }, text)
			return true
		}
		if (own.kind === "proposal") {
			const idea = lastSentence(r.reply).replace(/^(?:or|and|so|but)\s+/i, "").trim()
			suggest({ prompt: `${make ? "Make it work that way" : "Yes, do that"}: ${idea}${keepW && !/\b(without|besides|instead|keep|leave)\b/i.test(idea) ? ` (${kept.join(" and ")})` : ""}` }, text)
			return true
		}
		// (it asked for another way, and the answer proposed none: a "make it work" goes to the AI with what to keep; a "yes" to a question that
		// itself names the way, "could I fix it by tilting the seesaw more instead?", is that way asked for (V8843 Q3); else it asks which change)
		if (make) {
			suggest({ prompt: `${String(text).trim().replace(/[.!?\s]+$/, "")}${keepW}` }, text)
			return true
		}
		const way = /\bby\s+\w+ing\b/i.test(asked) && statesOutcome(asked) ? String(asked).trim().replace(/^(?:so\s+|and\s+)?(?:could|can|would|should|shall|may|might)\s+(?:i|we|you)\s+/i, "").replace(/[?.!\s]+$/, "") : null
		if (way) {
			suggest({ prompt: `Yes: ${way}` }, text)
			return true
		}
		userBubble(text)
		const sc = offerBeside(x)
		replyTurn(sc ? `Which change do you mean? The checked one is “${capFirst(sc.report.fix.label)}”, or tell me what to change instead.` : "Which change do you mean? Tell me what to change, and I’ll do it.", sc ? { offerFrom: sc.id } : {})
		return true
	}
	function answerYes(text) {
		// (the latest reply asked back with choices of its own, or answered a question that asked for another way, or proposed a change of its own:
		// a "yes" is to that, never to the checked fix of the card before it: V8842 qa / qq / qr, V8843 Q3 / Q4)
		const own = ownOfferNow()
		if (own) return yesToOwn(own, text)
		// (the card about the scene on the table: after an Undo of a fix, the edit card it came from, whose checked fix a "yes" puts back; after
		// a plain answer to a question, the card before it, whose offer is still the one on screen: V8838 Q)
		const t = (S.fixJob && S.turns.find((x) => x.id === S.fixJob.turnId && sameTable(x.sceneJSON, tableJSON()))) || offeringCard() || activeTurn()
		const r = t?.report ?? {}
		const fx = r.fix
		const clear = () => {
			input.value = ""
			autosize()
			syncCount()
		}
		if (S.fixJob && t && S.fixJob.turnId === t.id) {
			clear()
			userBubble(text, "fix")
			S.fixJob.applyOnFound = text
			announce("I’ll put the fix on the table as soon as I’ve checked it")
			scrollToEnd()
			return true
		}
		if (fx?.state === "found" && fx.sceneJSON) {
			clear()
			applyFix(t, "fix", text)
			return true
		}
		// (out of reach: nothing but undoing the change would do, so a "yes" asks nothing of the AI)
		if (fx?.outOfReach) {
			clear()
			userBubble(text)
			replyTurn(`Nothing else can fix that: ${String(fx.why ?? "your change puts it out of reach").replace(/[.!]+$/, "")}. Undo the change to get it back.`)
			return true
		}
		// (a search stopped by its Stop, or because the scene went and came back: nothing was offered, so a "yes" spends nothing. The free
		// physics search runs again, its checked fix offered when found; with no search to run again, it asks before any AI call (V8832 y7))
		if (fx?.state === "stopped" && !t?.request?.rework) {
			clear()
			userBubble(text)
			// (a "yes" is a yes to the fix: put on the table as soon as it is found, as a typed "make it work" is (V8837 x9 / z2 / y7: it was only
			// offered again, so a second "yes" was needed))
			if (fixCtxs.has(t.id) && sameTable(t.sceneJSON, tableJSON())) {
				lookAgain(t)
				if (S.fixJob?.turnId === t.id) S.fixJob.applyOnFound = text
			} else noFixReply(t, "I stopped looking for a fix, so there’s nothing checked to say yes to yet. Want the AI to rework it? That asks the AI (a paid call), so press the button if you do.")
			return true
		}
		if (!t?.request?.rework && !t?.reworkAsked && ((fx && ["none", "error"].includes(fx.state)) || (r.fixNeeded && !fx))) {
			clear()
			const rw = fx?.rework
			suggest({ prompt: rw?.text ?? reworkPrompt(t), keep: rw?.keep ?? r.edit?.touched ?? null, hard: r.edit?.hard ?? null, rework: { removedTypes: rw?.removedTypes ?? [], feedback: rw?.feedback ?? null } }, text)
			return true
		}
		const failed = (r.goals ?? []).filter((g) => g.ok === false)
		if (failed.length && !r.replyOnly && r.mode !== "fix" && /\?\s*$/.test(r.lead ?? "")) {
			clear()
			const g = String(failed[0].label).replace(/[.!]+$/, "")
			suggest({ prompt: `Fix it so this happens in the run: ${g}. Change only what is needed for that (say what you moved), and keep everything else as it is.` }, text)
			return true
		}
		if (statesOutcome(text)) return false
		clear()
		userBubble(text)
		// (a fix was offered, but the scene has changed since (by hand, or another scene), not back to before that change: said, never "nothing
		// to say yes to" (V8820 x10))
		const lastCard = !t ? [...S.turns].reverse().find((x) => x.role === "ai" && x.state === "done" && !x.report?.replyOnly) : null
		if (lastCard?.report?.fix?.state === "found" && !lastCard.report.fix.used && !sameTable(tableJSON(), lastCard.baseJSON)) {
			replyTurn("The scene changed since I offered that, so I didn’t apply it — say “make it work” to look again.")
			return true
		}
		replyTurn("There’s nothing to say yes to yet — what would you like to change?")
		return true
	}
	/** The goals of the scene on the table when every one happens, as labels; else null (no goals, one fails, or no run yet). The card whose
	 *  scene is on the table says it; else the engine's own verdict on the scene's goals. */
	function tableWorks() {
		const card = sceneCard()
		const r = card && sameTable(card.sceneJSON, tableJSON()) ? card.report ?? {} : null
		if (r && (r.goals ?? []).length) return r.goals.every((g) => g.ok === true) && !(r.targets ?? []).some((x) => x.ok === false) ? r.goals.map((g) => g.label) : null
		try {
			const sim = host.getSim?.()
			const sc = host.getScene?.()
			if (!sim?.summary || !sc || !(sc.goals ?? []).length) return null
			const rs = goalResults(sim, sc.goals)
			return rs.length && rs.every((g) => g.ok === true) ? rs.map((g) => g.label) : null
		} catch {
			return null
		}
	}
	/** "make it work" typed: the live card's checked fix goes on the table at once (while it is still being looked for, when it is found);
	 *  stopped, the free search runs again and its fix goes on when found; with no fix found yet and the rework button on the card, that rework
	 *  (it is what the button offers). Else (false) it goes to the AI as a "make it work" request. */
	function answerMakeItWork(text) {
		const own = ownOfferNow()
		if (own) return yesToOwn(own, text, { make: true })
		const t = (S.fixJob && S.turns.find((x) => x.id === S.fixJob.turnId && sameTable(x.sceneJSON, tableJSON()))) || offeringCard() || activeTurn()
		const fx = t?.report?.fix
		const clear = () => {
			input.value = ""
			autosize()
			syncCount()
		}
		// (it already works: said, and nothing is asked of the AI (V8837 z5: $0.03 to be told "It already works"))
		const works = !(S.fixJob && t && S.fixJob.turnId === t.id) ? tableWorks() : null
		if (works) {
			clear()
			userBubble(text)
			const plain = (l) => String(l).replace(/[.!]+$/, "").replace(/^(The|A|An|All|Every|Each|Both)\b/, (w) => w.toLowerCase())
			replyTurn(`It already works: ${works.length > 2 ? `all ${works.length} goals happen` : works.map(plain).join(" and ")} ✓`)
			return true
		}
		if (!t) return false
		if (S.fixJob && S.fixJob.turnId === t.id) {
			clear()
			userBubble(text, "fix")
			S.fixJob.applyOnFound = text
			announce("I’ll put the fix on the table as soon as I’ve checked it")
			scrollToEnd()
			return true
		}
		if (fx?.state === "found" && fx.sceneJSON && sameTable(t.sceneJSON, tableJSON())) {
			clear()
			applyFix(t, "fix", text)
			return true
		}
		if (fx?.outOfReach) {
			clear()
			userBubble(text)
			replyTurn(`Nothing else can fix that: ${String(fx.why ?? "your change puts it out of reach").replace(/[.!]+$/, "")}. Undo the change to get it back.`)
			return true
		}
		if (fx?.state === "stopped" && !t.request?.rework && fixCtxs.has(t.id) && sameTable(t.sceneJSON, tableJSON())) {
			clear()
			userBubble(text, "fix")
			lookAgain(t)
			if (S.fixJob?.turnId === t.id) S.fixJob.applyOnFound = text
			return true
		}
		if (!t.request?.rework && !t.reworkAsked && !t.report?.replyOnly && fx && ["none", "stopped", "error"].includes(fx.state) && sameTable(t.sceneJSON, tableJSON())) {
			clear()
			const rw = fx.rework
			t.reworkAsked = true
			S.reworkOfNext = t.id
			suggest({ prompt: rw?.text ?? reworkPrompt(t), keep: rw?.keep ?? t.report?.edit?.touched ?? null, hard: t.report?.edit?.hard ?? null, rework: { removedTypes: rw?.removedTypes ?? [], feedback: rw?.feedback ?? null } }, text)
			if (S.running?.reworkOf !== t.id) {
				t.reworkAsked = false
				S.reworkOfNext = null
			}
			rerenderTurn(t)
			return true
		}
		// (the AI's rework of this very scene just didn't work: said again, with the closest it got, and nothing is asked of the AI again; new
		// words of the person's own still go to it (V8837 z7 / y5 / y20: $0.06 to be told the same))
		if ((t.report?.reworkFailed || (t.request?.rework && fx?.state === "none")) && t.report?.replyOnly && sameTable(t.baseJSON, tableJSON())) {
			clear()
			userBubble(text)
			const near = fx?.near?.sceneJSON ? fx.near : null
			const what = near?.happened ? `: ${String(near.happened).replace(/[.!]+$/, "")}` : ""
			const turn = replyTurn(`The AI already tried to rework this, and it didn’t work${what}. Your scene is as it was.${near ? " The closest it got is below." : " Undo the change, or tell me what to change instead."}`, { reworkFailed: true, ...(near ? { fix: { state: "none", goal: fx.goal, near, quiet: true, reworked: true } } : {}), suggestions: [] })
			// (said about the scene on the table: a second "make it work" is answered the same way)
			turn.baseJSON = tableJSON()
			if (near) {
				turn.sceneJSON = tableJSON()
				rerenderTurn(turn)
			}
			return true
		}
		return false
	}
	function rerenderTurn(turn) {
		const li = thread.querySelector(`li.ai-bot[data-id="${turn.id}"]`)
		if (li && turn.state === "done") li.replaceChildren(renderReport(turn))
		// (a card drawn anew inside its own <li> is no change the thread's observer sees: which card is live is marked again here, or an older
		// card keeps its rework button and chips beside a reply that changed nothing: VERIFY regress-r2, a second paid rework)
		markLatest()
	}
	/** A suggestion clicked: asked as an edit of the scene on screen, as if typed. */
	function suggest(s, shown = null) {
		if (S.job) return note("Wait for this build to finish (or press Stop) first")
		shield()
		S.pendingKeep = s.keep ?? null
		S.pendingHard = s.hard ?? null
		S.pendingShown = shown
		S.pendingRework = s.rework ?? null
		input.value = s.prompt
		autosize()
		submit()
	}
	/** Undo the latest build (the app's own undo: one step), if it is still the scene's current history entry; otherwise say why not. */
	function undoTurn(t, btn) {
		shield()
		if (!canUndo(t)) {
			btn.hidden = true
			return note(`The scene has changed since this build: use the top bar’s Undo${touchScreen() ? "" : " (⌘Z)"} to step back`)
		}
		host.undo?.()
		btn.hidden = true
		S.lastAppliedId = null
		// (the cards follow at once: the undone card's search stops, the card now on the table is the live one, Restore shows where it applies)
		onHistory()
	}
	/** The Undo buttons follow the history: only the latest build's, only while it is the current entry. Every other kept version offers
	 *  "Restore this version" while the table shows something else. */
	function syncUndoButtons() {
		for (const li of thread.querySelectorAll("li.ai-bot")) {
			const t = S.turns.find((x) => x.id === li.dataset.id)
			const b = li.querySelector(".ai-undo")
			if (t && b) b.hidden = !canUndo(t)
			const rb = li.querySelector(".ai-restore")
			if (t && rb) rb.hidden = !canRestore(t)
		}
	}
	/** A kept version can be put back when it is not what the table shows now (and its own Undo isn't the way back). */
	const canRestore = (t) => !!t.sceneJSON && !canUndo(t) && t.state === "done" && !t.report?.replyOnly && !sameTable(tableJSON(), t.sceneJSON)
	/** Put a kept version back on the table: one undo step; follow-up changes start from its plan. */
	function restoreTurn(t) {
		if (S.job) return note("Stop the current build first")
		if (!t.sceneJSON) return
		shield()
		let scene
		try {
			scene = JSON.parse(t.sceneJSON)
		} catch {
			return
		}
		if (sameTable(tableJSON(), t.sceneJSON)) return note("That version is already on the table")
		host.applyScene(scene, { label: `${t.report?.title ?? "AI scene"} (restored)`, play: true })
		t.hi = host.historyIndex?.() ?? null
		S.lastAppliedId = t.id
		S.lastBuild = { plan: t.plan ?? null, sceneJSON: JSON.stringify(host.getScene() ?? scene), title: t.report?.title, turnId: t.id }
		syncMode()
		syncUndoButtons()
		persist()
		announce(`Restored ${t.report?.title ?? "that version"}`)
	}
	function section(title, body, { collapsed = false } = {}) {
		const d = h("details", { class: "ai-sec", open: !collapsed }, h("summary", {}, title), body)
		return d
	}
	/** A change list in a line: the first three, then how many more (all of them in the tooltip). */
	const brief = (list) => (list.length <= 4 ? list.join(" · ") : `${list.slice(0, 3).join(" · ")} · and ${list.length - 3} more`)
	const shortModel = (models) => models.map((m) => String(m).split("/").pop()).filter((m, i, a) => a.indexOf(m) === i).slice(0, 2).join(", ")

	// ---- the error card
	function renderError(t) {
		const kind = t.error?.kind ?? "gateway"
		// a refusal to act on (sign in, the day's allowance, a deployment without the AI): said as such, with what to do, and never "Try again"
		if (ACTION_KINDS.has(kind)) return renderRefusal(t, kind)
		const card = h("div", { class: `ai-card ai-error ai-k-${kind}`, role: kind === "cancelled" ? null : "alert" })
		card.append(h("div", { class: "ai-err-head" }, icon(kind === "cancelled" ? "stop" : "cross", "ai-ic ai-err-ic"), h("b", {}, ERROR_TITLES[kind] ?? "Something went wrong")))
		const words = kind === "cancelled" ? null : errorWords(t.error)
		if (words) card.append(h("p", { class: "ai-err-msg" }, words))
		if (t.error?.missing?.length) card.append(h("ul", { class: "ai-missing" }, t.error.missing.map((m) => h("li", {}, h("span", { class: "ai-miss-asked" }, m.asked), h("span", { class: "ai-miss-none" }, "not in the library")))))
		// (what the service said and at which step: for whoever looks into it, under Details)
		const facts = [t.error?.step ? `Step: ${t.error.step}` : null, t.error?.message && t.error.message !== words ? t.error.message : null].filter(Boolean)
		const more = facts.length && kind !== "cancelled" ? h("details", { class: "ai-err-more" }, h("summary", {}, "Details"), facts.map((f) => h("p", {}, f))) : null
		// (a rework asked from a card's button, stopped or failed, is asked again from that card's own button, which comes back with it: never a
		// second button here that sends it without the card's scene and what it keeps (V8832 y14 / y15))
		if (t.request && !t.request.rework) card.append(h("div", { class: "ai-res-actions ai-retry" }, h("button", { type: "button", class: "ai-chip-btn ai-primary", onclick: () => retry(t) }, icon("retry"), kind === "cancelled" ? "Run again" : "Try again")))
		else if (t.request?.rework && kind === "cancelled") card.append(h("p", { class: "ai-err-msg" }, "Nothing was changed."))
		if (more) card.append(more)
		return card
	}
	/** What went wrong in plain words, and that nothing was changed: "The AI service didn’t answer (502). Nothing was changed — try again." The
	 *  service's own wording and the step stay under Details. */
	function errorWords(err = {}) {
		const m = String(err.message ?? "")
		const same = "Nothing was changed"
		const code = err.status ?? /\b([45]\d\d)\b/.exec(m)?.[1] ?? null
		switch (err.kind) {
			case "gateway":
				if (/\(network\)/.test(m)) return `Couldn’t reach the AI service (no connection). ${same} — try again.`
				if (/rate limited|busy/i.test(m)) return `The AI service is busy right now. ${same} — try again in a minute.`
				if (/its key or access/.test(m)) return `The AI service refused the request. ${same}.`
				return `The AI service didn’t answer${code ? ` (${code})` : ""}. ${same} — try again.`
			case "busy":
				return `Every AI slot stayed taken. ${same} — try again in a minute.`
			case "timeout":
			case "invalid":
			case "apply":
				return `${same} — try again.`
			case "engine":
				return `${same} — try again, or ask for it another way.`
			default:
				return m || null
		}
	}

	function renderRefusal(t, kind) {
		const isNew = t.request?.mode === "new"
		const card = h("div", { class: `ai-card ai-error ai-refusal ai-k-${kind}`, role: "alert" })
		const title = kind === "quota" ? t.error?.message ?? ERROR_TITLES.quota : ERROR_TITLES[kind]
		card.append(h("div", { class: "ai-err-head" }, icon(kind === "sign_in" ? "lock" : kind === "quota" ? "clock" : "off", "ai-ic ai-err-ic"), h("b", {}, title)))
		const words =
			kind === "sign_in"
				? `What you asked is kept: once you’re signed in, ${isNew ? "press Build new scene again" : "send it again"}.`
				: kind === "quota"
					? "Nothing was changed. Everything else works as usual; the AI is back then."
					: kind === "off"
						? "This copy of the sandbox runs without the AI service. Everything else works: add real objects from the catalog (/), or start from an example (New)."
						: t.error?.message ?? ""
		card.append(h("p", { class: "ai-err-msg" }, words))
		if (kind === "sign_in" && t.request) card.append(h("div", { class: "ai-res-actions" }, h("button", { type: "button", class: "ai-google", onclick: () => access.signIn(isNew ? { kind: "new", text: t.request.text ?? "" } : (saveDraft(), { kind: "edit" })) || note("Sign-in isn’t available on this page") }, h("span", { class: "ai-g", html: ICONS.google, "aria-hidden": "true" }), "Continue with Google")))
		return card
	}

	// ---------------------------------------------------------------- building
	let nextId = Date.now() * 1000 + Math.floor(Math.random() * 1000) // (unique across tabs of one profile, whose turns are merged)
	function submit() {
		if (S.job) {
			// (Enter while a build runs: nothing is sent, and the words stay in the box for when it is done)
			if (input.value.trim() || S.images.length) note("Wait for this build to finish (or press Stop): your text is kept")
			return
		}
		const text = input.value.trim()
		if (!text && !S.images.length) {
			input.focus()
			return
		}
		// (the AI can't be used here now: why is shown in place of the box; what was typed stays)
		if (blocked()) {
			saveDraft()
			renderAccess()
			if (access.state.kind === "sign_in" && !access.state.unavailable) access.signIn({ kind: "edit" })
			else note(access.state.title)
			return
		}
		// the scene on screen is changed (never replaced); on an empty table what is described is built there
		syncMode()
		const mode = S.mode
		// "undo that", "put it back": the app's own undo, at once, when the AI's latest build is still the scene's current step
		if (!S.images.length && isUndoAsk(text) && S.lastAppliedId && canUndo(S.turns.find((t) => t.id === S.lastAppliedId) ?? {})) return undoByAsking(text)
		// "stop" while it looks for a fix: the search stops, as its Stop does (never a model call, and nothing changes: V8814 s4)
		if (!S.images.length && S.fixJob && /^\s*(stop|cancel|never ?mind|forget it|don['’]?t bother)\b[\s.!]*$/i.test(text)) {
			input.value = ""
			autosize()
			syncCount()
			userBubble(text)
			stopFixSearch("user")
			return
		}
		// "yes" / "do it" to the latest reply's offer: what it offered (a checked fix at once; while it is still being looked for, when it is found)
		if (!S.images.length && YES_RE.test(text) && !S.pendingShown && answerYes(text) !== false) return
		// ("make it work" beside a checked fix is that fix, as a "yes" is; with nothing checked yet it goes to the AI as before)
		if (!S.images.length && MAKE_WORK_RE.test(text) && !S.pendingShown && answerMakeItWork(text) !== false) return
		// (a plain question is answered by the edit step with no change: the bubble says it is a question)
		const asked = mode === "edit" && !S.images.length && isQuestion(text)
		// (every edit that follows the AI's last change on the table keeps what the person changed there, and before: a fix offered for this one
		// never moves that back. "move the box 10 cm left" then "make the box 2 cm wider" never offers the box back where it was)
		const lastT = S.turns.find((x) => x.id === S.lastBuild?.turnId)
		const lastOn = !!lastT && sameTable(lastT.sceneJSON, tableJSON())
		const keep = S.pendingKeep ?? (lastT?.report?.edit?.touched && lastOn ? lastT.report.edit.touched : null)
		// (and what of it was the person's own choice, said with an amount: a later fix never changes that: §16)
		const hard = S.pendingHard ?? (lastOn && Array.isArray(lastT?.report?.edit?.hard) && lastT.report.edit.hard.length ? lastT.report.edit.hard : null)
		const shown = S.pendingShown
		// (the app's own "make it work", from the rework button: a pure "make it work" whatever its words, with the reasons the run showed,
		// never bringing back what the person took away: ai/DESIGN.md §16)
		// (one round of the AI's: the background tried three ways already, and the button is asked once: V8814, 16 Oct, 6–8 model calls for an edit
		// nothing could fix)
		const rework = mode === "edit" && S.pendingRework ? { rework: true, maxRounds: 1, ...(Array.isArray(S.pendingRework.removedTypes) && S.pendingRework.removedTypes.length ? { removedTypes: S.pendingRework.removedTypes } : {}), ...(typeof S.pendingRework.feedback === "string" && S.pendingRework.feedback ? { feedback: S.pendingRework.feedback } : {}) } : {}
		S.pendingKeep = null
		S.pendingHard = null
		S.pendingShown = null
		S.pendingRework = null
		const request = { text: text || (mode === "edit" ? "Change the scene to match this picture." : "Recreate this picture as a working machine."), images: S.images.slice(), mode, ...(asked ? { asked: true } : {}), ...(keep ? { keep } : {}), ...(hard ? { hard } : {}), ...rework, ...(mode === "new" ? { imagine: S.images.length ? "off" : conceptSetting() } : {}) }
		const user = { id: `u${nextId++}`, at: Date.now(), role: "user", text: shown ?? text, ...(shown ? { sent: text } : {}), images: request.images.map((im) => ({ name: im.name, thumb: im.thumb })), mode, ...(asked ? { asked: true } : {}) }
		S.turns.push(user)
		thread.append(renderTurn(user))
		input.value = ""
		saveDraft()
		S.images = []
		renderAttachments()
		syncMode() // (the box's hint follows: no picture is attached any more)
		autosize()
		syncCount()
		start(request)
	}
	/** A brand-new scene, asked for in New → Build with AI: the thread shows it as such ("New scene"), and it lands as one undo step. */
	function buildNew(text, images = [], opts = {}) {
		if (S.job) {
			note("Wait for this build to finish (or press Stop) before starting a new scene")
			return false
		}
		if (blocked()) {
			if (access.state.kind === "sign_in" && !access.state.unavailable) access.signIn({ kind: "new", text: String(text ?? "") })
			throw new Error(access.state.title)
		}
		open()
		setMini(false, true)
		// (New → Build with AI's "Concept sketch" setting: passed in, else read where New keeps it; a photo is the reference, so no sketch)
		const imagine = images.length ? "off" : opts.imagine ?? conceptSetting()
		const request = { text: String(text ?? "").trim() || "Recreate this picture as a working machine.", images: images.slice(0, MAX_IMAGES), mode: "new", imagine }
		const user = { id: `u${nextId++}`, at: Date.now(), role: "user", text: String(text ?? "").trim(), images: request.images.map((im) => ({ name: im.name, thumb: im.thumb })), mode: "new" }
		S.turns.push(user)
		thread.append(renderTurn(user))
		start(request)
		return true
	}
	/** Undo asked for in words: the latest build is undone (one step), and the thread says so; nothing goes to the AI. */
	function undoByAsking(text) {
		const t = S.turns.find((x) => x.id === S.lastAppliedId)
		const user = { id: `u${nextId++}`, at: Date.now(), role: "user", text, images: [], mode: "edit" }
		S.turns.push(user)
		thread.append(renderTurn(user))
		input.value = ""
		autosize()
		host.undo?.()
		S.lastAppliedId = null
		const w = turnWords(t)
		const reply = { id: `a${nextId++}`, at: Date.now(), role: "ai", state: "done", request: { text, mode: "edit", images: [] }, report: { replyOnly: true, reply: `Undone: the scene is back to how it was before “${w.words}”${w.more ? ` (and ${plural(w.more, "more change")})` : ""}. (${touchScreen() ? "Redo" : "⌘⇧Z"} brings it back.)` } }
		S.turns.push(reply)
		thread.append(renderTurn(reply))
		onHistory()
		persist()
		announce(reply.report.reply)
		scrollToEnd()
	}
	function retry(t) {
		if (S.job) return
		// (a card the thread has moved past since: never sent again, whatever its button showed)
		const at = S.turns.indexOf(t)
		if (at >= 0 && S.turns.slice(at + 1).some((x) => x.role === "ai" && x.state === "done")) return note("That was before the latest reply: ask again from the latest card")
		// (a rework is asked again through the card it was for, so it keeps what that card keeps, is judged against the same scene, and is
		// asked once: V8832 y15)
		if (t.request?.rework) {
			const from = t.reworkOf ? S.turns.find((x) => x.id === t.reworkOf) : null
			if (!from || from.state !== "done" || !sameTable(from.sceneJSON, tableJSON())) return note("The scene has changed since: ask me again (for example “make it work”)")
			if (from.reworkAsked) return note("The AI already reworked it once for that card")
			return askRework(from)
		}
		const req = { ...t.request, images: t.request.images ?? [] }
		if (req.hadImages && !req.images.length) {
			// the pictures of a turn are not kept after a reload: the request goes back where it was typed, waiting for them
			const words = `The ${req.hadImages === 1 ? "picture isn’t" : "pictures aren’t"} kept after a reload: add ${req.hadImages === 1 ? "it" : "them"} again`
			if (req.mode === "new" && host.openNew) return (host.openNew({ ai: true, text: req.text ?? "" }), note(words))
			input.value = req.text ?? ""
			syncMode()
			autosize()
			syncSend()
			input.focus()
			return note(`${words}, then press Enter`)
		}
		start(req, t)
	}
	/** One more round of checking (and fixing) on the scene on the table, against the request that built it. */
	function checkAgain(t) {
		if (S.job) return note("Stop the current build first")
		// the critic checks against what was asked: the request that built the scene, and the changes asked for since (an edit's own words alone
		// say little: "make it steeper")
		const i = S.turns.indexOf(t)
		const asks = S.turns.slice(0, i < 0 ? S.turns.length : i).filter((x) => x.role === "user" && x.mode !== "check" && !x.asked)
		const from = asks.map((x) => x.mode).lastIndexOf("new")
		const chain = from >= 0 ? asks.slice(from) : asks.slice(-1)
		const text = chain.length > 1 ? `${chain[0].text || "Recreate the picture as a working machine."} (Changes asked for since: ${chain.slice(1).map((x) => x.text).filter(Boolean).join("; ")}.)` : t.request?.text ?? chain[0]?.text ?? ""
		const user = { id: `u${nextId++}`, at: Date.now(), role: "user", text: t.report?.scoreState === "quick" ? "Check this change" : "Check this scene again", images: [], mode: "check" }
		S.turns.push(user)
		thread.append(renderTurn(user))
		start({ text, images: [], mode: "check" })
	}
	/** The conversation as the edit step reads it: the last ≤ 20 turns, the replies as shown. upTo: the turn whose own reply counts (a background
	 *  rework of it); else (false) up to before `turn`. */
	function historyFor(turn, upTo = true) {
		const at = S.turns.indexOf(turn)
		return S.turns
			.filter((x, i) => (upTo ? at < 0 || i <= at : x !== turn) && (x.role === "user" || x.state === "done"))
			.slice(-HISTORY_TURNS)
			.map((x) => (x.role === "user" ? { role: "user", text: x.sent || x.text || "(pictures)" } : { role: "assistant", text: x.report?.replyOnly ? x.report.reply : x.report?.lead ? `${x.report.lead}${x.report.human?.length ? ` Changes: ${x.report.human.join("; ")}.` : ""}${x.report.fix?.state === "found" ? ` I offered to ${x.report.fix.say} (checked in the physics).` : ""}` : `${x.report?.mode === "check" ? "Checked" : "Built"} “${x.report?.title}”${x.report?.edit?.reply ? `: ${x.report.edit.reply}` : ""}` }))
	}
	function start(request, replacing = null) {
		// (a plain question changes nothing on the table: the search for a fix goes on, and its offer shows when found (V8842 qj: "why doesn't
		// the egg move?" stopped it, and the card said "I stopped looking for a fix" with no Stop pressed). Any other request stops it, and the
		// card says why)
		if (!(request.mode === "edit" && request.asked && !(request.images ?? []).length)) stopFixSearch("new")
		const turn = { id: `a${nextId++}`, at: Date.now(), role: "ai", state: "running", request, baseJSON: tableJSON() }
		// (a rework asked from a card's button: that card's own, so an answer that never came lets it be asked again)
		if (request.rework && S.reworkOfNext) turn.reworkOf = S.reworkOfNext
		S.reworkOfNext = null
		if (replacing) {
			const i = S.turns.indexOf(replacing)
			if (i >= 0) S.turns.splice(i, 1)
			S.gone.push(replacing.id) // (a merge with another tab's saved turns must not bring it back)
			thread.querySelector(`[data-id="${replacing.id}"]`)?.remove()
		}
		S.turns.push(turn)
		renderProgress(turn)
		const li = renderTurn(turn)
		thread.append(li)
		hero.hidden = true
		syncAccessBox()
		scrollToEnd()
		const scene = host.getScene()
		const lb = S.lastBuild
		const history = historyFor(turn, false)
		// (an edit of a scene whose goals an earlier change broke: the scene where they last worked goes with it, for the fix it may need)
		// (it is the card that put this scene on the table, never a reply said after it, which has no scene of its own; a rework, the card its
		// button is on: a rework asked again is judged exactly as the first one was: V8832 y15)
		const from = turn.reworkOf ? S.turns.find((x) => x.id === turn.reworkOf) : null
		const act = request.mode === "edit" ? (from && from.sceneJSON && sameTable(from.sceneJSON, turn.baseJSON) ? from : sceneCard(turn.baseJSON)) : null
		let reference = null
		if (act && act !== turn && sameTable(act.sceneJSON, turn.baseJSON) && act.goodJSON && !sameTable(act.goodJSON, turn.baseJSON))
			try {
				reference = JSON.parse(act.goodJSON)
				// (the AI's reworks already tried to win those goals back from that scene and failed: a follow-up change gets the physics' search
				// and the rework button, never another set of background reworks: V8818, about $0.19 more per follow-up)
				turn.aiSpent = !!(act.aiSpent || (act.report?.fix?.state !== "found" && (act.aiTried || act.report?.fix?.reworked)))
			} catch {}
		// (the "Try:" this card already offers, when the AI is asked to make it work: a rework that fails offers its own closest only when it is
		// closer than that one, else that one stays: V8837 y4 / x5)
		const nearNow = request.mode === "edit" && act && act !== turn && sameTable(act.sceneJSON, turn.baseJSON) && act.report?.fix?.near?.sceneJSON ? act.report.fix.near : null
		const job = ai.build(
			{ ...request, scene, sim: request.mode === "edit" || request.mode === "check" ? host.getSim?.() ?? null : null, plan: lb?.plan ?? null, planScene: lb?.sceneJSON ? JSON.parse(lb.sceneJSON) : null, history, ...(reference ? { reference } : {}), ...(nearNow ? { near: nearNow } : {}) },
			// (a concept sketch only for a new scene from words, as the setting says; never for an edit or a check, never with a photo)
			{ onEvent: (e) => onEvent(turn, e), imagine: request.mode === "new" && !(request.images ?? []).length ? request.imagine ?? conceptSetting() : "off", ...(request.mode === "check" ? { refineRounds: 1 } : {}) }
		)
		S.job = job
		S.jobStarted = performance.now()
		S.running = turn
		syncMode() // (a new scene being built: the composer says "New scene", not "Editing" the scene still on the table)
		// the critic's camera (a hidden second view) is made while the AI plans, so its first picture doesn't stall the page later
		// (and a new scene's stage tuner runs its candidates on the fix workers: they load while the AI plans)
		if (request.mode !== "edit") (window.requestIdleCallback ?? ((f) => setTimeout(f, 1500)))(() => S.job === job && (getShot().prewarm?.(), request.mode === "new" && getFixPool().prewarm?.()), { timeout: 4000 })
		// (and an edit's fix workers load while the AI works out the change: a search after it starts at once)
		else (window.requestIdleCallback ?? ((f) => setTimeout(f, 500)))(() => S.job === job && getFixPool().prewarm?.(), { timeout: 3000 })
		S.keepOpen = false
		syncSend()
		job.result.then(
			(report) => done(turn, li, report),
			(err) => fail(turn, li, err)
		)
	}
	function cancel() {
		S.job?.cancel()
	}
	/** The draft is over: the view goes back to the scene on the table (unless the build's own scene is replacing it), the badge goes. */
	function endDraft(reload) {
		draftBadge.hidden = true
		if (reload) host.draft?.(null)
	}
	function done(turn, li, report) {
		const v = turn.view
		// (the scene it worked on is no longer on the table, an Undo or a change by hand while it worked: nothing it made goes on the table, and a
		// "Try:" would put it back on whatever is there now: V8820 x12 / x13)
		if (["edit", "check"].includes(turn.request?.mode) && turn.baseJSON && !sameTable(tableJSON(), turn.baseJSON)) {
			turn.undone ??= movedOnWhy(turn)
			report = { replyOnly: true, movedOn: true, mode: report.mode, reply: movedOnWords(turn), suggestions: [], edit: { kind: "answer" }, totalMs: report.totalMs }
			// (a rework asked from a card that never got its answer: that card may ask it again once its scene is back (V8832 y9))
			const from = turn.reworkOf ? S.turns.find((x) => x.id === turn.reworkOf) : null
			if (from?.reworkAsked) (from.reworkAsked = false), rerenderTurn(from)
		}
		// a check ("Check it") keeps its changes only when every goal still happens: one that stops a goal that worked (or, on an edit's card,
		// leaves one failing) is said and not put on the table (V8817 s6: two refine calls emptied the cans and moved one 4 cm, and that went on
		// the table with the goal still failing, the checked fix gone)
		if (report.mode === "check" && !report.replyOnly && report.scene && JSON.stringify(report.scene) !== turn.baseJSON) {
			const lost = (report.goals ?? []).filter((g) => g.was === true && g.ok !== true)
			const from = S.turns.find((x) => x.role === "ai" && x.state === "done" && !x.report?.replyOnly && sameTable(x.sceneJSON, turn.baseJSON))
			const failsNow = (report.goals ?? []).filter((g) => g.ok === false)
			if (lost.length || (failsNow.length && ["edit", "fix"].includes(from?.report?.mode))) {
				const g = lost[0] ?? failsNow[0]
				const tried = (report.human ?? []).slice(0, 3)
				report = { replyOnly: true, mode: "check", reply: `I checked it${tried.length ? ` and tried this: ${andJoin(tried)}` : ""}, but then “${String(g.label).replace(/[.!]+$/, "")}” didn’t happen, so I left the scene as it was.`, suggestions: [], edit: { kind: "answer" }, totalMs: report.totalMs }
			}
		}
		if (report.replyOnly) {
			// an answer, not a change: nothing is applied
			if (v) clearInterval(v.timer)
			endDraft(true)
			turn.state = "done"
			turn.report = slimTurn({ ...turn, report }).report
			// (a rework that didn't work offers the closest it got as "Try: …": it applies against the scene on the table now, which is the scene it
			// started from (else it was answered above))
			if (report.fix?.near?.sceneJSON) turn.sceneJSON = tableJSON()
			li.className = "ai-turn ai-bot ai-s-done"
			li.replaceChildren(renderReport(turn))
			S.job = null
			S.running = null
			markLatest()
			syncMode()
			syncSend()
			persist()
			announce(report.reply)
			setMini(false)
			scrollToEnd()
			return
		}
		// apply: one undo step named after the plan, then play it from the start
		if (v) setRow(v, "apply", "active")
		const hiBefore = host.historyIndex?.() ?? null
		const sceneBefore = JSON.stringify(host.getScene() ?? null)
		let committed
		try {
			committed = host.applyScene(report.scene, { label: report.title, play: true, fresh: report.mode === "new", verb: report.mode === "edit" ? "Changed" : report.mode === "check" ? "Checked" : "Built" })
		} catch (e) {
			// it could not be put on the table: an error card, not a result
			endDraft(true)
			if (v) {
				finishRows(v, report)
				setRow(v, "apply", "error")
			}
			return fail(turn, li, new AiError("apply", `The scene was built but couldn't be put on the table: ${e.message}`, { step: "apply", retryable: true }))
		}
		endDraft(false)
		if (v) {
			finishRows(v, report)
			setRow(v, "apply", "done")
			clearInterval(v.timer)
		}
		const sceneNow = JSON.stringify(host.getScene() ?? report.scene)
		// the same scene as before (an edit or a check that changed nothing): no history entry was made, so this turn has nothing to undo, and
		// the build before it keeps its Undo (an Undo here would take back that earlier build)
		const changed = typeof committed === "boolean" ? committed : sceneNow !== sceneBefore || (host.historyIndex?.() ?? null) !== hiBefore
		S.lastBuild = { plan: report.plan, sceneJSON: sceneNow, title: report.title, turnId: turn.id }
		turn.sceneJSON = S.lastBuild.sceneJSON
		turn.plan = report.plan
		turn.simKey = report.sim?.key ?? null // (the run of this version: the side-by-side view draws its start from the app's run when it is this one)
		turn.state = "done"
		// (the last scene in which its goals worked: this one, or the one before the change that broke them, or the one that turn kept: a later
		// change's fix compares with it: V8814 s2)
		{
			const tg = report.targets ?? []
			const prev = S.turns.find((x) => x !== turn && x.sceneJSON && sameTable(x.sceneJSON, turn.baseJSON) && !x.report?.replyOnly)
			turn.goodJSON = !tg.some((x) => x.ok === false) ? turn.sceneJSON : tg.some((x) => x.ok === false && x.was === true) ? turn.baseJSON ?? null : prev?.goodJSON ?? null
		}
		turn.hi = changed ? host.historyIndex?.() ?? null : null // (not saved: after a reload the app's history is new, so no Undo is offered)
		if (changed) S.lastAppliedId = turn.id
		turn.report = slimTurn({ ...turn, report: changed ? report : { ...report, noChange: true } }).report
		// an edit that stopped a goal: the search for a checked fix starts now, while the change plays (the reply says so)
		const searching = changed && report.fixNeeded && !!report.fixCtx
		if (searching) turn.report.fix = { state: "searching" }
		const asking = searching || !!turn.report.fix
		// a new scene planned from a concept sketch: the result card's thumbnail (the sketch next to the scene's start) stays in view
		const conceptImg = report.mode === "new" ? (typeof report.concept === "string" ? report.concept : report.concept?.image) : null
		// (a picture too big to keep is kept as its smaller copy: if that wasn't drawn yet, the card gets it the moment it is)
		if (conceptImg && !turn.report.concept)
			shrinkConcept(conceptImg).then((small) => {
				if (!small || turn.report?.concept || turn.state !== "done") return
				turn.report.concept = slimConcept(typeof report.concept === "string" ? { image: small } : { ...report.concept, image: small })
				rerenderTurn(turn)
				persist()
			})
		// the timeline folds into a one-line summary, under the reply's Details
		turn.sumEl = h("details", { class: "ai-timeline-sum" }, h("summary", {}, `How it was built · ${secs(report.totalMs)}`), v?.root.querySelector(".ai-steps") ?? "")
		// (the person's kinds, kept with the card: its ideas never swap one away, and a fix's card carries them on)
		if (report.mode === "edit") personKinds(turn)
		const card = renderReport(turn)
		li.className = "ai-turn ai-bot ai-s-done"
		li.replaceChildren(card)
		S.job = null
		S.running = null
		markLatest()
		syncMode()
		syncSend()
		syncUndoButtons()
		persist()
		// (the search's context is kept for this page's life: after its Stop, "Look again" runs it once more)
		if (searching) {
			fixCtxs.set(turn.id, report.fixCtx)
			if (fixCtxs.size > 6) fixCtxs.delete(fixCtxs.keys().next().value)
			startFixSearch(turn, report.fixCtx)
		}
		const goalWords = report.goals.length ? `${report.goals.filter((g) => g.ok).length} of ${report.goals.length} goals met` : ""
		announce(turn.report.lead ?? `${!changed ? "No change" : report.mode === "check" ? "Checked" : "Built"}: ${report.title}. ${goalWords}`)
		miniTitle.textContent = report.title
		miniSub.textContent = [report.score != null ? `${report.score}/10` : report.scoreState === "stale" || report.scoreState === "unchecked" ? "not re-checked" : null, goalWords || null, (report.issues ?? []).some((i) => i.level === "warn" || i.level === "error") ? "see notes" : null].filter(Boolean).join(" · ") || `${report.mode === "check" ? "checked" : "built"} in ${secs(report.totalMs)}`
		if (!S.open) {
			S.unseen = true
			host.button?.classList.add("unseen")
			if (typeof committed !== "boolean") host.toast?.(changed ? `Built “${report.title}” — ${touchScreen() ? "Undo takes it back" : "⌘Z undoes it"}` : `No change: “${report.title}” is as it was`) // (the app's applyScene says it itself)
		} else if (asking || conceptImg) {
			// (the reply asks something: "Want me to …?"; or it has the concept sketch to compare with the scene. It stays in view)
			setMini(false)
		} else if (matchMedia("(max-width: 900px)").matches) {
			// on a phone the sheet covers the picture: fold it away so the new scene is seen playing (the button reopens the report)
			setTimeout(() => {
				if (S.open && !S.job && !S.keepOpen) {
					close()
					S.unseen = true
					host.button?.classList.add("unseen")
				}
			}, 900)
		} else if (!S.keepOpen) fold() // desktop: the chip shows the result; the whole scene can be seen playing
		scrollToEnd()
	}
	function fail(turn, li, err) {
		const v = turn.view
		if (v) clearInterval(v.timer)
		endDraft(true)
		const cancelled = err?.name === "AbortError"
		// (a rework asked from a card that didn't get to answer: the card may ask it again)
		// (and one stopped by an Undo too: its card is stale while its scene is gone, and asks again once a Redo brings it back: V8832 y9)
		const from = turn.reworkOf ? S.turns.find((x) => x.id === turn.reworkOf) : null
		if (from && from.reworkAsked) {
			from.reworkAsked = false
			rerenderTurn(from)
		}
		// (stopped because the person undid the change, or changed the scene, while it worked: said so, as a reply; nothing changed)
		if (cancelled && turn.undone) {
			turn.state = "done"
			turn.report = { replyOnly: true, movedOn: true, mode: turn.request?.mode, reply: movedOnWords(turn), suggestions: [], edit: { kind: "answer" } }
			li.className = "ai-turn ai-bot ai-s-done"
			li.replaceChildren(renderReport(turn))
			S.job = null
			S.running = null
			markLatest()
			syncMode()
			syncSend()
			persist()
			announce(turn.report.reply)
			setMini(false)
			scrollToEnd()
			return
		}
		turn.state = cancelled ? "cancelled" : "error"
		turn.error = { kind: cancelled ? "cancelled" : err instanceof AiError ? err.kind : "gateway", message: cancelled ? "" : err?.message ?? String(err), step: err?.step ?? null, retryable: !!err?.retryable, ...(err?.resetsAt ? { resetsAt: err.resetsAt } : {}), ...(Number.isInteger(err?.cause?.status) && err.cause.status >= 400 ? { status: err.cause.status } : {}) }
		if (err?.kind === "nothing") turn.error.missing = []
		if (err instanceof AiError && ACTION_KINDS.has(err.kind)) {
			access.note(err)
			// (an edit's words go back in the box, for after signing in or when the allowance is back)
			if (turn.request?.mode === "edit" && turn.request?.text && !input.value.trim()) {
				input.value = turn.request.text
				saveDraft()
				autosize()
			}
		}
		li.className = `ai-turn ai-bot ai-s-${turn.state}`
		li.replaceChildren(renderError(turn))
		S.job = null
		S.running = null
		markLatest()
		syncMode()
		syncSend()
		persist()
		announce(cancelled ? "Stopped" : `${ERROR_TITLES[turn.error.kind] ?? "Error"}: ${ACTION_KINDS.has(turn.error.kind) ? turn.error.message : errorWords(turn.error) ?? turn.error.message}`)
		setMini(false) // (what went wrong is shown in full)
		scrollToEnd()
		if (!cancelled) console.warn("AI build failed:", err)
	}

	// ---------------------------------------------------------------- folding (desktop): the drawer as a chip at the view's corner
	const wide = () => !matchMedia("(max-width: 900px)").matches
	/** Fold the drawer to its chip so the scene in the view can be seen (desktop; on a phone the sheet closes instead, once, during a build). */
	function fold() {
		if (!S.open) return
		if (wide()) setMini(true)
		else if (S.job && !S.keepOpen) {
			close()
			S.unseen = true
		}
	}
	/** The chip docks in the band along the top of the view that the wide camera keeps clear for the view's own buttons, left of them: it never
	 *  covers the machine. */
	function placeMini() {
		const r = host.viewport?.getBoundingClientRect()
		if (!r || !r.width) return
		// (the view's buttons slide back to the right when the drawer folds: until they are there, reckon from the view's edge)
		const tools = host.viewport.querySelector(".view-tools")?.getBoundingClientRect()
		const settled = tools?.width && !S.toolsMoving
		const right = settled ? tools.left - 8 : r.right - 10 - (tools?.width ?? 0) - 8
		drawer.style.setProperty("--ai-mini-top", `${Math.round(r.top + 8)}px`)
		drawer.style.setProperty("--ai-mini-right", `${Math.max(10, Math.round(innerWidth - right))}px`)
		drawer.style.setProperty("--ai-mini-w", `${Math.max(240, Math.min(420, Math.round(right - r.left - 12)))}px`)
	}
	/** on: fold to the chip; off: open in full (byUser: the person opened it, so it stays open until the next build). */
	function setMini(on, byUser = false) {
		on = on && S.open && wide()
		if (byUser && !on && S.job) S.keepOpen = true
		btnMiniStop.hidden = !S.job && !S.fixJob
		miniOrb.classList.toggle("still", !S.job && !S.fixJob)
		if (S.mini === on) return
		S.mini = on
		if (on) {
			const v = S.running?.view
			if (v) {
				miniTitle.textContent = v.now
				miniSub.textContent = secs(performance.now() - v.t0)
			}
		}
		drawer.classList.toggle("mini", on)
		document.body.classList.toggle("ai-folded", on)
		if (on) {
			S.toolsMoving = true
			placeMini()
			setTimeout(() => {
				S.toolsMoving = false
				if (S.mini) placeMini()
			}, 260)
		}
		if (!on) {
			if (byUser) input.focus({ preventScroll: true })
			scrollToNow(false)
		}
	}
	addEventListener("resize", () => S.mini && placeMini())

	// ---------------------------------------------------------------- open / close
	function open() {
		if (S.open) {
			if (S.mini) setMini(false, true)
			return
		}
		S.open = true
		// (the toast that said "open Edit with AI to apply it" has done its job; on a phone any toast would sit over the box and its send button)
		const toastEl = document.getElementById("toast")
		if (toastEl && !toastEl.hidden && (/Edit with AI/.test(toastEl.textContent ?? "") || matchMedia("(max-width: 900px)").matches)) toastEl.hidden = true
		const top = document.querySelector("header.top")?.getBoundingClientRect().bottom
		if (top > 0) drawer.style.setProperty("--ai-top", `${Math.round(top + 10)}px`)
		drawer.hidden = false
		document.body.classList.add("ai-open")
		host.button?.setAttribute("aria-expanded", "true")
		host.button?.classList.remove("unseen")
		S.unseen = false
		syncMode()
		access.check()
		renderAccess()
		void drawer.offsetWidth // (the start of the transition is laid out first, so this works in a background tab too, where animation frames wait)
		drawer.classList.add("in")
		if (!matchMedia("(max-width: 900px)").matches) input.focus({ preventScroll: true })
		if (S.turns.length) scrollToNow(false)
		else scroll.scrollTop = 0
		if (S.job) S.keepOpen = true // (opened during a build: it stays open)
		syncUndoButtons()
		host.onOpenChange?.(true)
	}
	function close() {
		if (!S.open) return
		setMini(false)
		S.open = false
		drawer.classList.remove("in")
		document.body.classList.remove("ai-open")
		host.button?.setAttribute("aria-expanded", "false")
		const done = () => {
			if (!S.open) drawer.hidden = true
		}
		if (reduceMotion()) done()
		else setTimeout(done, 220)
		if (drawer.contains(document.activeElement)) host.button?.focus({ preventScroll: true })
		host.onOpenChange?.(false)
	}
	btnClose.onclick = close
	btnNew.onclick = () => {
		if (S.job) return note("Stop the current build first")
		stopFixSearch()
		S.turns = []
		S.lastBuild = null
		S.since = Date.now() // (turns from before this, in any tab of this profile, stay out)
		persist()
		renderThread()
		syncMode()
		input.focus()
	}
	drawer.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.stopPropagation()
			e.preventDefault()
			close()
		}
		// (the app's single-key shortcuts must not fire while typing here; ⌘Z inside the box is the box's own undo)
		e.stopPropagation()
	})
	// phone: drag the grip down to close the sheet
	{
		let y0 = null
		grip.addEventListener("pointerdown", (e) => ((y0 = e.clientY), grip.setPointerCapture(e.pointerId)))
		grip.addEventListener("pointermove", (e) => {
			if (y0 === null) return
			drawer.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`
		})
		const end = (e) => {
			if (y0 === null) return
			const dy = e.clientY - y0
			y0 = null
			drawer.style.transform = ""
			if (dy > 90) close()
		}
		grip.addEventListener("pointerup", end)
		grip.addEventListener("pointercancel", end)
	}

	renderThread()
	renderAttachments()
	syncMode()
	renderAccess()
	access.check()
	syncSend()
	return {
		open,
		close,
		toggle: () => (!S.open ? open() : S.mini ? setMini(false, true) : close()),
		isOpen: () => S.open,
		attach: (files) => (open(), setMini(false, true), attach(files)),
		get busy() {
			return !!S.job
		},
		/** A brand-new scene (New → Build with AI): built in this drawer's thread, applied as one undo step. -> false when a build is running */
		buildNew,
		/** for tests: this text now, as typed in the drawer (an edit of the scene on screen), or with mode "new" as New → Build with AI */
		run(text, { mode = "edit", images = null, imagine } = {}) {
			if (mode === "new") buildNew(text, images ?? [], imagine ? { imagine } : {})
			else {
				open()
				if (images) S.images = images
				input.value = text
				submit()
			}
			return new Promise((resolve) => {
				const t = setInterval(() => {
					if (!S.job) {
						clearInterval(t)
						resolve(S.turns.at(-1))
					}
				}, 100)
			})
		},
		_state: S
	}
}
