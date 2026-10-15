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
import { createOrchestrator, prepareImages, STEP_LABELS, MAX_IMAGES, AiError } from "./orchestrator.js"
import { createShot } from "./shot.js"

const TIMELINE = ["observe", "plan", "solve", "simulate", "reconcile", "refine", "tune", "apply"]
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
	cancelled: "Stopped"
}
const HISTORY_TURNS = 16
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
	const s = String(t ?? "").trim()
	if (!s) return false
	if (/\b(just tell me|tell me|don['’]t change|do not change|without changing|no changes|don['’]t build|do not build)\b/i.test(s)) return true
	if (BUILD_ASK.test(s) || BUILD_WORDS.test(s)) return false
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
/** Undo asked for in words, and nothing else: "undo", "undo that", "go back", "put it back the way it was", "revert". */
export const isUndoAsk = (t) => /^\s*(please\s+)?(undo( (that|it|this|the last (change|build|one)))?|go back|revert( (that|it|this))?|put (it|everything) back( the way it was| as it was)?|restore the (old|previous|last) (scene|version))[\s.!]*$/i.test(String(t ?? ""))

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
	const getShot = () => (shot ??= createShot({ looks: () => host.getCatalog()?.looks }))
	// ?aimock=1 (development only): the AI steps are answered by ./dev-mock.js, everything else is the real thing
	const mockP = new URLSearchParams(location.search).get("aimock") === "1" ? import("./dev-mock.js").then((m) => m.withMock(host.api)) : null
	const api = mockP ? async (...a) => (await mockP)(...a) : host.api
	const ai = createOrchestrator({ api, shot: { render: (sim, opts) => getShot().render(sim, opts) } })

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
	scroll.append(hero, thread)
	const live = h("div", { class: "ai-sr", "aria-live": "polite", "aria-atomic": "true" })

	// what the drawer works on, said up front: the scene on screen (it is changed, never replaced)
	const editingName = h("b", {}, "")
	const editing = h("div", { class: "ai-editing", role: "note" }, h("span", { class: "ai-editing-k" }, "Editing"), editingName, h("button", { type: "button", class: "ai-link", onclick: () => host.openNew?.({ ai: true }), title: "A brand-new scene: New → Build with AI (N)" }, "New scene…"))
	const attachRow = h("div", { class: "ai-attach-row", "aria-label": "Attached images" })
	const input = h("textarea", { class: "ai-input", rows: "3", maxlength: String(MAX_TEXT), placeholder: "Change this scene… e.g. swap the red ball for a basketball", "aria-label": "Ask for a change to the scene", spellcheck: "true", enterkeyhint: "send" })
	const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true })
	const btnAttach = h("button", { type: "button", class: "ai-icon-btn ai-attach", title: "Add images (or drop / paste them)", "aria-label": "Add images" }, icon("image"))
	const btnSend = h("button", { type: "submit", class: "ai-send", title: "Change it (Enter)", "aria-label": "Change it" }, icon("send"))
	const hint = h("span", { class: "ai-hint" }, "Enter to change it · Shift+Enter for a new line")
	const counter = h("span", { class: "ai-count", hidden: true, "aria-live": "polite" })
	const box = h("div", { class: "ai-box" }, attachRow, input, h("div", { class: "ai-box-bar" }, btnAttach, hint, counter, btnSend))
	const composer = h("form", { class: "ai-composer", novalidate: true }, editing, box, fileInput)
	const dropZone = h("div", { class: "ai-drop", hidden: true }, h("div", { class: "ai-drop-in" }, icon("image", "ai-ic ai-drop-ic"), h("b", {}, "Drop images for this change"), h("span", {}, `The AI sees them with your words · up to ${MAX_IMAGES}`)))
	// the folded drawer: one line at the view's corner (what is happening, or the result), Stop while building, Show to open it again
	const miniTitle = h("b", {}, "")
	const miniSub = h("span", {}, "")
	const miniOrb = h("span", { class: "ai-orb", "aria-hidden": "true" })
	const btnMiniStop = h("button", { type: "button", class: "ai-chip-btn", onclick: () => cancel() }, icon("stop"), "Stop")
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
		const out = []
		const ball = its.find((i) => /ball|marble/.test(i.type) && i.type !== "basketball")
		if (ball) out.push({ icon: "pins", text: `Swap ${/^ball \d/i.test(nm(ball)) ? nm(ball) : `the ${lcFirst(nm(ball))}`} for a basketball` })
		if (its.some((i) => i.type === "domino-row")) out.push({ icon: "chain", text: "Make the dominoes taller" })
		const box = its.find((i) => /box|cup|bucket|basket/.test(i.type))
		if (box) out.push({ icon: "car", text: `Move the ${lcFirst(nm(box))} 10 cm left` })
		if (its.some((i) => i.type === "domino-row")) out.push({ icon: "chain", text: "Add 5 more dominoes" })
		const plank = its.find((i) => i.type === "plank")
		if (plank && out.length < 4) out.push({ icon: "car", text: `Make ${/^ramp \d/i.test(nm(plank)) ? nm(plank) : `the ${lcFirst(nm(plank))}`} steeper` })
		if (out.length < 3) out.push({ icon: "pins", text: "Add a tennis ball that rolls into it" }, { icon: "chain", text: "Make it work" })
		return out.slice(0, 4)
	}
	function renderHero() {
		hero.innerHTML = ""
		hero.hidden = S.turns.length > 0
		if (hero.hidden) return
		const n = host.getCatalog()?.types?.length ?? 113
		const has = realItems().length > 0
		hero.append(
			h("div", { class: "ai-hero-art", "aria-hidden": "true", html: ICONS.sparkle }),
			h("h3", {}, has ? "Say what to change." : "Describe it. Watch it work."),
			h(
				"p",
				{},
				has
					? "Only what you ask for changes: everything else stays exactly where it is. Each change is run in the physics engine, and one ⌘Z takes it back."
					: `The table is empty: say what should happen and it is built here from ${n} real objects at their true sizes and weights, run in the physics engine and refined until it works.`
			),
			has
				? h("div", { class: "ai-examples", role: "list" }, editExamples().map((ex) => h("div", { class: "ai-ex-li", role: "listitem" }, h("button", { type: "button", class: "ai-ex", onclick: () => ((input.value = ex.text), autosize(), syncSend(), input.focus()), title: "Put this in the box (Enter changes it)" }, icon(ex.icon, "ai-ic ai-ex-ic"), h("span", {}, ex.text)))))
				: null,
			h("p", { class: "ai-hero-new" }, "A whole new scene? ", h("button", { type: "button", class: "ai-link", onclick: () => host.openNew?.({ ai: true }) }, "New → Build with AI"), host.openNew ? null : "")
		)
	}

	// ---------------------------------------------------------------- what it works on, attachments, input
	/** The drawer changes the scene on screen; on an empty table it builds what is described there (there is nothing to keep). */
	function syncMode() {
		const has = realItems().length > 0
		S.mode = has ? "edit" : "new"
		const name = host.getScene()?.name || "this scene"
		editingName.textContent = has ? name : "an empty table"
		editingName.title = has ? `Changes to “${name}” keep everything you don't mention exactly as it is` : ""
		headSub.textContent = has ? "Only what you ask changes" : "Builds on the empty table"
		input.placeholder = has ? "Change this scene… e.g. swap the red ball for a basketball" : "Describe a machine to build on the empty table…"
		hint.textContent = has ? "Enter to change it · Shift+Enter for a new line" : "Enter to build · Shift+Enter for a new line"
		if (!S.job) btnSend.title = has ? "Change it (Enter)" : "Build (Enter)"
		if (!hero.hidden && hero.dataset.has !== String(has)) ((hero.dataset.has = String(has)), renderHero())
	}

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
		btnSend.disabled = !running && !input.value.trim() && !S.images.length
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
		const turns = S.turns.filter((t) => t.state !== "running").slice(-HISTORY_TURNS).map((t) => ({ ...slimTurn(t), ...(kept.has(t.id) ? { sceneJSON: t.sceneJSON, plan: t.plan ?? null } : {}) }))
		const extra = { gone: S.gone, since: S.since }
		// (out of room in this browser's storage: the conversation is kept without the older versions)
		if (!store.set({ turns, lastBuild: S.lastBuild, ...extra })) store.set({ turns: turns.map((t) => (t.id === S.lastBuild?.turnId ? t : { ...t, sceneJSON: undefined, plan: undefined })), lastBuild: S.lastBuild, ...extra })
	}
	// another tab of this profile saved its conversation: its turns show here too (after this tab's build, if one is running)
	addEventListener("storage", (e) => {
		if (e.key !== KEY || S.job) return
		if (mergeStored()) (renderThread(), syncUndoButtons())
	})
	function slimTurn(t) {
		if (t.role === "user") return { id: t.id, at: t.at, role: "user", text: t.text, images: (t.images ?? []).map((im) => ({ name: im.name, thumb: im.thumb })), mode: t.mode, ...(t.asked ? { asked: true } : {}) }
		const r = t.report
		return {
			id: t.id,
			at: t.at,
			role: "ai",
			state: t.state,
			error: t.error,
			request: t.request ? { text: t.request.text, mode: t.request.mode, images: [], hadImages: (t.request.images ?? []).length || t.request.hadImages || 0, ...(t.request.asked ? { asked: true } : {}) } : null,
			report: r
				? {
						replyOnly: r.replyOnly, reply: r.reply, howItWorks: r.howItWorks, happened: r.happened, problems: r.problems, unsure: r.unsure, title: r.title, mode: r.mode, used: r.used, missing: r.missing,
						assumptions: r.assumptions, goals: r.goals, refine: r.refine, tune: r.tune, edit: r.edit, timings: r.timings, totalMs: r.totalMs, models: r.models,
						score: r.score, scoreState: r.scoreState, staleScore: r.staleScore, scoreNote: r.scoreNote, steps: r.steps,
						differences: r.differences, coverage: r.coverage, quick: r.quick, quickNote: r.quickNote, undo: r.undo, noChange: r.noChange, version: r.version, ratedBy: r.ratedBy, sceneBefore: r.sceneBefore, suggestNew: r.suggestNew,
						lead: r.lead, human: r.human, planned: r.planned, suggestions: r.suggestions, concept: typeof r.concept === "string" && r.concept.length < 400000 ? r.concept : undefined,
						// what went wrong while building (a check that couldn't run, changes that couldn't be made): shown, never dropped
						issues: (r.issues ?? []).filter((i) => i.level === "warn" || i.level === "error").slice(0, 8),
						solverNotes: (r.solverIssues ?? []).filter((i) => i.level !== "info" || ["moved", "kept_on", "lean_length", "shifted", "table_widened", "default_x", "air_height"].includes(i.code)).slice(0, 20),
						items: r.scene?.items?.length ?? 0
					}
				: null
		}
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
				h("div", { class: "ai-bubble" }, h("span", { class: `ai-tag${t.mode === "new" ? " ai-tag-new" : ""}` }, t.mode === "check" ? "Check" : t.mode === "new" ? "New scene" : t.asked ? "Question" : "Change"), t.text ? h("p", {}, t.text) : null, t.images?.length ? h("div", { class: "ai-bubble-imgs" }, t.images.map((im) => h("img", { src: im.thumb, alt: im.name ?? "image" }))) : null)
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

	// ---- the live progress card
	function renderProgress(t) {
		const rows = new Map()
		const list = h("ol", { class: "ai-steps" })
		const pics = (t.request.images ?? []).length > 0
		const steps = TIMELINE.filter((s) => (s !== "observe" || pics) && (s !== "reconcile" || (pics && t.request.mode === "new")) && (s !== "plan" || t.request.mode !== "check"))
		for (const s of steps) {
			const label = s === "plan" && t.request.mode === "edit" ? STEP_LABELS.edit : STEP_LABELS[s]
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
			v.now = `${STEP_LABELS[step === "plan" && t.request.mode === "edit" ? "edit" : step] ?? "Working"}${e.state === "waiting" ? " · waiting for a slot" : e.tokens ? ` · ${tokensWord(e.tokens)}` : ""}`
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
				else if (e.label === "tuned") v.draft = "tuned"
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
		if (step === "observe" || step === "plan" || step === "tune") {
			if (e.state === "active") announce(e.label)
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
		const rf = view.rows.get("refine")
		const failed = (report?.issues ?? []).find((i) => i.code === "refine_failed" || i.code === "final_check_failed")
		const scoreWords = report?.score != null ? ` · ${report.score}/10` : report?.scoreState === "stale" ? " · not re-checked" : ""
		if (rf && failed) setRow(view, "refine", "error", { sub: `${failed.code === "final_check_failed" ? "final check failed" : "check failed"} · ${/busy/.test(failed.text) ? "the AI was busy" : /too long/.test(failed.text) ? "it took too long" : "not checked"}` })
		else if (rf && rf.state === "active") setRow(view, "refine", "done", { sub: report?.refine?.length ? `${plural(report.refine.length, "check")}${scoreWords}` : "" })
		else if (rf && rf.state === "pending") setRow(view, "refine", "skipped", { sub: report?.quick ? "a simple change: checked by the physics" : undefined })
		const rc = view.rows.get("reconcile")
		if (rc && rc.state === "active") setRow(view, "reconcile", report?.coverage?.fixed?.length ? "done" : "error", { sub: report?.coverage?.fixed?.length ? `matched: ${report.coverage.fixed.slice(0, 2).join(", ")}` : "not matched" })
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

	// ---- the result card
	/** What a step is doing, in a few words (the folded chip shows it). */
	const stepWords = (e, v) => (v.phase === "refine" && ["solve", "simulate", "render"].includes(e.step) ? `Checking · ${v.round || "refining"}` : String(e.label ?? STEP_LABELS[e.step] ?? "Working").replace(/ \d+\/\d+$/, ""))
	const draftWords = (v) => (v?.draft ? `the AI is still working · ${v.draft}` : "the AI is still working on it")
	/** The latest build's Undo is offered only while that build is still the scene's current history entry (never on older cards, never after a reload). */
	const canUndo = (t) => t.id === S.lastAppliedId && t.hi != null && host.historyIndex?.() === t.hi
	/** A result that was not (fully) checked by the AI offers one more check, on the latest card only. */
	const wantsCheck = (t) =>
		t.id === S.lastBuild?.turnId && t.state === "done" && !t.report?.replyOnly && ((t.report?.issues ?? []).some((i) => i.code === "refine_failed" || i.code === "final_check_failed") || ["stale", "unchecked", "quick"].includes(t.report?.scoreState))
	function renderReport(t) {
		const r = t.report
		if (r.replyOnly) {
			const latest = S.turns.find((x) => x.id === S.lastAppliedId)
			const undoIt = r.undo && latest && canUndo(latest) ? h("button", { type: "button", class: "ai-chip-btn ai-primary", onclick: (ev) => (ev.currentTarget.remove(), undoTurn(latest, h("button"))) }, icon("undo"), `Undo “${latest.report?.title ?? "the last build"}”`) : null
			// a different scene was asked for: nothing changed here; one click takes the same words to New → Build with AI
			const asNew = r.suggestNew && host.openNew ? h("button", { type: "button", class: "ai-chip-btn ai-primary", onclick: () => host.openNew({ ai: true, text: t.request?.text ?? "" }) }, icon("sparkle"), "Build it as a new scene…") : null
			return h("div", { class: "ai-card ai-reply" }, h("p", {}, r.reply), r.missing?.length ? h("ul", { class: "ai-missing" }, r.missing.map((m) => h("li", {}, h("span", { class: "ai-miss-asked" }, m.asked ?? "?"), h("span", { class: "ai-miss-none" }, "not in the library")))) : null, undoIt || asNew ? h("div", { class: "ai-res-actions" }, undoIt, asNew) : null, r.suggestNew ? null : chipsFor(t))
		}
		const types = new Map((host.getCatalog()?.types ?? []).map((ty) => [ty.key, ty]))
		// the card is a chat reply: one short first-person sentence (the change in a person's words and what the run really shows), a heads-up
		// when something is off, a few next edits to try, and everything else under "Details"
		const card = h("div", { class: "ai-more-body", hidden: !t.detailsOpen })
		if (t.sumEl) card.append(t.sumEl)
		const okGoals = (r.goals ?? []).filter((g) => g.ok).length
		const nItems = (r.used ?? []).reduce((a, u) => a + u.count, 0)
		const checks = (r.refine ?? []).length
		const verb = r.mode === "edit" ? "changed" : r.mode === "check" ? "checked" : "built"
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
		const kind = r.mode === "edit" ? `Edited: ${r.sceneBefore ?? r.title ?? "the scene"}` : r.mode === "check" ? `Checked: ${r.sceneBefore ?? r.title ?? "the scene"}` : "New scene"
		card.append(h("div", { class: "ai-res-head" }, h("div", {}, h("p", { class: `ai-res-kind ${r.mode === "new" ? "new" : "edit"}` }, kind), h("h3", { class: "ai-res-title" }, r.title ?? "Your scene"), h("p", { class: "ai-res-stats" }, stats)), badge))
		// what went wrong while building: plain, at the top, never folded away
		const notices = (r.issues ?? []).filter((i) => i.level === "warn" || i.level === "error")
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
		if (shownChanges.length || sameLine) card.append(section("What changed", h("ul", { class: "ai-list ai-changes" }, shownChanges.slice(0, 8).map((c) => h("li", {}, c)), shownChanges.length > 8 ? h("li", { title: shownChanges.slice(8).join("\n") }, `and ${shownChanges.length - 8} more`) : null, sameLine)))
		if (r.goals?.length)
			card.append(
				section(
					`Goal${r.goals.length === 1 ? "" : "s"} · ${okGoals}/${r.goals.length}`,
					h("ul", { class: "ai-goals" }, r.goals.map((g) => h("li", { class: g.ok === true ? "g-ok" : g.ok === false ? "g-bad" : "g-unk", title: g.ok == null ? "This couldn’t be told from the run" : null }, icon(g.ok === true ? "check" : "cross", "ai-ic ai-goal-ic"), h("span", {}, g.label, g.detail ? h("small", { class: "ai-goal-detail" }, ` · ${g.detail}`) : null))))
				)
			)
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
								m.substitute_type ? h("span", { class: "ai-miss-sub" }, types.get(m.substitute_type)?.name ?? m.substitute_type) : h("span", { class: "ai-miss-none" }, "left out")
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
		// a check of a version that is not on the table and did not lead to it (an undone version, or one an earlier version beat): its remarks are
		// about that version. (A check whose changes were kept judged the version before them: read in order, that is plain.)
		const offTable = (x) => r.version != null && x.version != null && x.version !== r.version && !((x.changes?.length ?? 0) > 0 && !x.reverted && !x.rejected)
		if (rounds.length || tuned) {
			const ul = h("ul", { class: "ai-rounds" })
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
						h("span", { class: "ai-round-n" }, r.tune.runs ? "Tuned" : "Not tuned", r.tune.runs ? h("small", {}, ` · ${plural(r.tune.runs, "run")}, ${secs(r.tune.ms)}`) : null, r.tune.reverted ? h("span", { class: "ai-tag-undone" }, "undone") : null),
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
		const heads = headsUp(r)
		return h(
			"div",
			{ class: "ai-card ai-result ai-chat" },
			h("p", { class: "ai-lead" }, ...marks(r.lead ?? fallbackLead(r))),
			heads ? h("p", { class: "ai-heads" }, heads) : null,
			r.concept ? h("img", { class: "ai-concept", src: r.concept, alt: "How the AI pictured it" }) : null,
			chipsFor(t),
			h(
				"div",
				{ class: "ai-foot" },
				detailsBtn,
				undoBtn,
				restoreBtn,
				wantsCheck(t) ? h("button", { type: "button", class: "ai-link-btn", onclick: () => checkAgain(t), title: "Have the AI look at this scene again (one round of checking and fixing)" }, icon("retry"), t.report?.scoreState === "quick" ? "Check it" : "Check again") : null,
				r.score != null ? h("span", { class: `ai-foot-score ${r.score >= 8 ? "good" : r.score >= 5 ? "mid" : "low"}`, title: "How well the AI judged this scene matches what you asked" }, `${r.score}/10`) : null
			),
			card
		)
	}
	/** ✓ and ✗ in a reply, coloured. */
	const marks = (text) => String(text).split(/(✓|✗)/).map((p) => (p === "✓" ? h("span", { class: "ai-ok-mark", "aria-label": "works" }, "✓") : p === "✗" ? h("span", { class: "ai-bad-mark", "aria-label": "doesn't work yet" }, "✗") : p))
	/** A reply for a turn saved before replies were written. */
	const fallbackLead = (r) => `${r.mode === "edit" ? "Changed" : r.mode === "check" ? "Checked" : "Built"} “${r.title ?? "the scene"}”.${(r.goals ?? []).length ? ` ${(r.goals ?? []).filter((g) => g.ok).length} of ${r.goals.length} goals happen ${(r.goals ?? []).every((g) => g.ok) ? "✓" : "✗"}` : ""}`
	/** One line when something is off that the person should know at once (a check that couldn't run, a thing not in the library, the picture's
	 *  differences); the rest is in Details. */
	function headsUp(r) {
		const types = new Map((host.getCatalog()?.types ?? []).map((ty) => [ty.key, ty]))
		const warn = (r.issues ?? []).find((i) => i.level === "warn" || i.level === "error")
		const miss = (r.missing ?? [])[0]
		const more = (n) => (n > 1 ? ` (and ${n - 1} more: see Details)` : "")
		if (warn) return `Heads-up: ${warn.text}`
		if (miss) return `Heads-up: there’s no ${String(miss.asked).replace(/^(a|an|the) /i, "")} in the library, so ${miss.substitute_type ? `I used ${/^[aeiou]/i.test(types.get(miss.substitute_type)?.name ?? miss.substitute_type) ? "an" : "a"} ${String(types.get(miss.substitute_type)?.name ?? miss.substitute_type).toLowerCase()}` : "I left it out"}${more(r.missing.length)}.`
		if (r.differences?.length) return `Heads-up: ${String(r.differences[0]).replace(/\.$/, "")}${more(r.differences.length)}.`
		return null
	}
	/** Next edits to try, for this scene: a fix first when a goal fails, then the AI's own ideas, then ones read off the scene. A click asks for it. */
	function chipsFor(t) {
		const r = t.report ?? {}
		const list = []
		const failed = (r.goals ?? []).filter((g) => g.ok === false)
		if (failed.length && !r.replyOnly) {
			const g = String(failed[0].label).replace(/[.!]+$/, "")
			const lab = /^(The|A|An|All|Every|Each|Both)\b/.test(g) ? g[0].toLowerCase() + g.slice(1) : g
			list.push({ label: `Fix it so ${lab}`, prompt: `Fix it so this happens in the run: ${g}. Change only what is needed for that (say what you moved), and keep everything else as it is.`, fix: true })
		}
		for (const s of r.suggestions ?? []) if (!list.some((x) => x.label.toLowerCase() === s.label.toLowerCase())) list.push(s)
		if (list.length < 2 && t.id === S.turns.filter((x) => x.role === "ai" && x.state === "done").at(-1)?.id) {
			const asked = String(t.request?.text ?? "").toLowerCase()
			for (const ex of editExamples()) if (list.length < 3 && !asked.includes(ex.text.toLowerCase().slice(0, 12)) && !list.some((x) => x.prompt === ex.text)) list.push({ label: ex.text, prompt: ex.text })
		}
		if (!list.length) return null
		return h(
			"div",
			{ class: "ai-chips", role: "group", "aria-label": "Try next" },
			list.slice(0, 3).map((s) => h("button", { type: "button", class: `ai-sugg${s.fix ? " fix" : ""}`, title: s.prompt, onclick: () => suggest(s) }, s.fix ? icon("retry") : icon("sparkle"), h("span", {}, s.label)))
		)
	}
	/** A suggestion clicked: asked as an edit of the scene on screen, as if typed. */
	function suggest(s) {
		if (S.job) return note("Wait for this build to finish (or press Stop) first")
		input.value = s.prompt
		autosize()
		submit()
	}
	/** Undo the latest build (the app's own undo: one step), if it is still the scene's current history entry; otherwise say why not. */
	function undoTurn(t, btn) {
		if (!canUndo(t)) {
			btn.hidden = true
			return note("The scene has changed since this build: use the top bar’s undo (⌘Z) to step back")
		}
		host.undo?.()
		btn.hidden = true
		S.lastAppliedId = null
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
	const canRestore = (t) => !!t.sceneJSON && !canUndo(t) && t.state === "done" && !t.report?.replyOnly && JSON.stringify(host.getScene() ?? null) !== t.sceneJSON
	/** Put a kept version back on the table: one undo step; follow-up changes start from its plan. */
	function restoreTurn(t) {
		if (S.job) return note("Stop the current build first")
		if (!t.sceneJSON) return
		let scene
		try {
			scene = JSON.parse(t.sceneJSON)
		} catch {
			return
		}
		if (JSON.stringify(host.getScene() ?? null) === t.sceneJSON) return note("That version is already on the table")
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
		const card = h("div", { class: `ai-card ai-error ai-k-${kind}`, role: kind === "cancelled" ? null : "alert" })
		card.append(h("div", { class: "ai-err-head" }, icon(kind === "cancelled" ? "stop" : "cross", "ai-ic ai-err-ic"), h("b", {}, ERROR_TITLES[kind] ?? "Something went wrong")))
		if (t.error?.message && kind !== "cancelled") card.append(h("p", { class: "ai-err-msg" }, t.error.message))
		if (t.error?.missing?.length) card.append(h("ul", { class: "ai-missing" }, t.error.missing.map((m) => h("li", {}, h("span", { class: "ai-miss-asked" }, m.asked), h("span", { class: "ai-miss-none" }, "not in the library")))))
		if (t.request)
			card.append(
				h(
					"div",
					{ class: "ai-res-actions" },
					h("button", { type: "button", class: "ai-chip-btn ai-primary", onclick: () => retry(t) }, icon("retry"), kind === "cancelled" ? "Run again" : "Try again"),
					t.error?.step ? h("span", { class: "ai-res-meta" }, `at: ${t.error.step}`) : null
				)
			)
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
		// the scene on screen is changed (never replaced); on an empty table what is described is built there
		syncMode()
		const mode = S.mode
		// "undo that", "put it back": the app's own undo, at once, when the AI's latest build is still the scene's current step
		if (!S.images.length && isUndoAsk(text) && S.lastAppliedId && canUndo(S.turns.find((t) => t.id === S.lastAppliedId) ?? {})) return undoByAsking(text)
		// (a plain question is answered by the edit step with no change: the bubble says it is a question)
		const asked = mode === "edit" && !S.images.length && isQuestion(text)
		const request = { text: text || (mode === "edit" ? "Change the scene to match this picture." : "Recreate this picture as a working machine."), images: S.images.slice(), mode, ...(asked ? { asked: true } : {}) }
		const user = { id: `u${nextId++}`, at: Date.now(), role: "user", text, images: request.images.map((im) => ({ name: im.name, thumb: im.thumb })), mode, ...(asked ? { asked: true } : {}) }
		S.turns.push(user)
		thread.append(renderTurn(user))
		input.value = ""
		S.images = []
		renderAttachments()
		syncMode() // (the box's hint follows: no picture is attached any more)
		autosize()
		syncCount()
		start(request)
	}
	/** A brand-new scene, asked for in New → Build with AI: the thread shows it as such ("New scene"), and it lands as one undo step. */
	function buildNew(text, images = []) {
		if (S.job) {
			note("Wait for this build to finish (or press Stop) before starting a new scene")
			return false
		}
		open()
		setMini(false, true)
		const request = { text: String(text ?? "").trim() || "Recreate this picture as a working machine.", images: images.slice(0, MAX_IMAGES), mode: "new" }
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
		const reply = { id: `a${nextId++}`, at: Date.now(), role: "ai", state: "done", request: { text, mode: "edit", images: [] }, report: { replyOnly: true, reply: `Undone: the scene is back to how it was before “${t?.report?.title ?? "the last build"}”. (⌘⇧Z brings it back.)` } }
		S.turns.push(reply)
		thread.append(renderTurn(reply))
		syncUndoButtons()
		persist()
		announce(reply.report.reply)
		scrollToEnd()
	}
	function retry(t) {
		if (S.job) return
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
	function start(request, replacing = null) {
		const turn = { id: `a${nextId++}`, at: Date.now(), role: "ai", state: "running", request }
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
		scrollToEnd()
		const scene = host.getScene()
		const lb = S.lastBuild
		const history = S.turns
			.filter((x) => x !== turn && (x.role === "user" || x.state === "done"))
			.slice(-8)
			.map((x) => (x.role === "user" ? { role: "user", text: x.text || "(pictures)" } : { role: "assistant", text: x.report?.replyOnly ? x.report.reply : `${x.report?.mode === "check" ? "Checked" : "Built"} “${x.report?.title}”${x.report?.edit?.reply ? `: ${x.report.edit.reply}` : ""}` }))
		const job = ai.build(
			{ ...request, scene, sim: request.mode === "edit" ? host.getSim?.() ?? null : null, plan: lb?.plan ?? null, planScene: lb?.sceneJSON ? JSON.parse(lb.sceneJSON) : null, history },
			{ onEvent: (e) => onEvent(turn, e), ...(request.mode === "check" ? { refineRounds: 1 } : {}) }
		)
		S.job = job
		S.jobStarted = performance.now()
		S.running = turn
		// the critic's camera (a hidden second view) is made while the AI plans, so its first picture doesn't stall the page later
		if (request.mode !== "edit") (window.requestIdleCallback ?? ((f) => setTimeout(f, 1500)))(() => S.job === job && getShot().prewarm?.(), { timeout: 4000 })
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
		if (report.replyOnly) {
			// an answer, not a change: nothing is applied
			if (v) clearInterval(v.timer)
			endDraft(true)
			turn.state = "done"
			turn.report = slimTurn({ ...turn, report }).report
			li.className = "ai-turn ai-bot ai-s-done"
			li.replaceChildren(renderReport(turn))
			S.job = null
			S.running = null
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
		turn.state = "done"
		turn.hi = changed ? host.historyIndex?.() ?? null : null // (not saved: after a reload the app's history is new, so no Undo is offered)
		if (changed) S.lastAppliedId = turn.id
		turn.report = slimTurn({ ...turn, report: changed ? report : { ...report, noChange: true } }).report
		// the timeline folds into a one-line summary, under the reply's Details
		turn.sumEl = h("details", { class: "ai-timeline-sum" }, h("summary", {}, `How it was built · ${secs(report.totalMs)}`), v?.root.querySelector(".ai-steps") ?? "")
		const card = renderReport(turn)
		li.className = "ai-turn ai-bot ai-s-done"
		li.replaceChildren(card)
		S.job = null
		S.running = null
		syncMode()
		syncSend()
		syncUndoButtons()
		persist()
		const goalWords = report.goals.length ? `${report.goals.filter((g) => g.ok).length} of ${report.goals.length} goals met` : ""
		announce(turn.report.lead ?? `${!changed ? "No change" : report.mode === "check" ? "Checked" : "Built"}: ${report.title}. ${goalWords}`)
		miniTitle.textContent = report.title
		miniSub.textContent = [report.score != null ? `${report.score}/10` : report.scoreState === "stale" || report.scoreState === "unchecked" ? "not re-checked" : null, goalWords || null, (report.issues ?? []).some((i) => i.level === "warn" || i.level === "error") ? "see notes" : null].filter(Boolean).join(" · ") || `${report.mode === "check" ? "checked" : "built"} in ${secs(report.totalMs)}`
		if (!S.open) {
			S.unseen = true
			host.button?.classList.add("unseen")
			if (typeof committed !== "boolean") host.toast?.(changed ? `Built “${report.title}” — ⌘Z undoes it` : `No change: “${report.title}” is as it was`) // (the app's applyScene says it itself)
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
		turn.state = cancelled ? "cancelled" : "error"
		turn.error = { kind: cancelled ? "cancelled" : err instanceof AiError ? err.kind : "gateway", message: cancelled ? "" : err?.message ?? String(err), step: err?.step ?? null, retryable: !!err?.retryable }
		if (err?.kind === "nothing") turn.error.missing = []
		li.className = `ai-turn ai-bot ai-s-${turn.state}`
		li.replaceChildren(renderError(turn))
		S.job = null
		S.running = null
		syncSend()
		persist()
		announce(cancelled ? "Stopped" : `${ERROR_TITLES[turn.error.kind] ?? "Error"}: ${turn.error.message}`)
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
		btnMiniStop.hidden = !S.job
		miniOrb.classList.toggle("still", !S.job)
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
			scrollToEnd(false)
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
		const top = document.querySelector("header.top")?.getBoundingClientRect().bottom
		if (top > 0) drawer.style.setProperty("--ai-top", `${Math.round(top + 10)}px`)
		drawer.hidden = false
		document.body.classList.add("ai-open")
		host.button?.setAttribute("aria-expanded", "true")
		host.button?.classList.remove("unseen")
		S.unseen = false
		syncMode()
		void drawer.offsetWidth // (the start of the transition is laid out first, so this works in a background tab too, where animation frames wait)
		drawer.classList.add("in")
		if (!matchMedia("(max-width: 900px)").matches) input.focus({ preventScroll: true })
		if (S.turns.length) scrollToEnd(false)
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
		run(text, { mode = "edit", images = null } = {}) {
			if (mode === "new") buildNew(text, images ?? [])
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
