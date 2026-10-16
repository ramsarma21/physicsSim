// "Create new project" (the top bar's New, key N): the one place a new scene starts.
//   Blank                  just the table (the app's own Clear: one undo step)
//   Build with AI          words and/or a photo -> a brand-new scene, built in the AI drawer's thread (panel.js buildNew), one undo step
//   Start from an example  the built-in machines (and the ones saved here)
// The scene on screen stays one ⌘Z away whatever is picked; when it has changes no saved scene holds, the dialog offers to keep it first
// (Save, or download it as a file). "Edit with AI" (the drawer) only ever changes the scene on screen: a new scene is always made here.
//   import { mountNewProject } from "./ai/new-project.js"
//   const np = mountNewProject({ scenarios, current, blank, loadScenario, save, download, buildAI, toast })
//   np.open({ ai: true, text, files })   // (opens on Build with AI, with these words and pictures)
// Where the AI can't be used (./access.js), Build with AI says so before anything is typed: "needs an account" with Continue with Google (the
// accounts layer's sign-in sheet, which keeps what was typed), today's allowance used up and when it resets, or no AI on this deployment (no box).
// Styles: ai.css (.np-*), on ui.css's dialog card (.ui-dialog, .ui-card, .ui-start), so it looks like the intro and the help sheet.
// Build with AI has one setting under the box, "Concept sketch: Auto · Always · Off" (ai/research/round3-plan.md §5; Off until chosen): kept in
// this browser (conceptSetting(), read by panel.js's build too) and passed as `imagine` to the build; with a photo attached it shows as off (the photo is the
// reference). Start from an example opens with the gallery (web/gallery/index.json: machines built with AI, each with its start frame): one
// click opens that scene (window.sandboxApp.open), no AI and no account needed.
import { prepareImages, MAX_IMAGES } from "./orchestrator.js"
import { aiAccess, atWhen } from "./access.js"

// ---- the concept sketch setting: "auto" (a sketch for multi-step machines), "always", "off"; kept in this browser (try/catch: a private
// window or blocked storage keeps it for this page only). Off until chosen: on chains, Auto did not beat Off by the §8 D ship rule (judges
// +0.13 with a CI across 0, +81 s p50), so it stays a choice, not the default.
const CONCEPT_KEY = "sandbox:ai-concept"
export const CONCEPT_DEFAULT = "off"
const CONCEPT_MODES = [
	["auto", "Auto"],
	["always", "Always"],
	["off", "Off"]
]
const CONCEPT_HINTS = { auto: "Auto: for multi-step machines", always: "Always: an AI sketch before every new scene", off: "Off: built from your words alone" }
let conceptMem = null
/** The concept sketch setting as chosen ("auto" | "always" | "off"). */
export function conceptSetting() {
	try {
		const v = localStorage.getItem(CONCEPT_KEY)
		if (CONCEPT_MODES.some(([k]) => k === v)) return v
	} catch {}
	return conceptMem ?? CONCEPT_DEFAULT
}
function setConceptSetting(v) {
	conceptMem = v
	try {
		localStorage.setItem(CONCEPT_KEY, v)
	} catch {}
}

const EXAMPLES = [
	{ label: "A Rube Goldberg chain", text: "A Rube Goldberg chain reaction: a ball rolls down a ramp and knocks over a row of growing dominoes; the last domino knocks a second ball off a ledge so it drops into a box." },
	{ label: "A bowling ball knocks over 10 pins", text: "A bowling ball rolls down a long ramp and knocks over 10 bowling pins standing in a row." },
	{ label: "A toy car races into dominoes", text: "A toy car races down a steep ramp and crashes into a long row of dominoes that all fall." },
	{ label: "A pendulum topples a tower", text: "A heavy pendulum swings down and knocks over a tower of six wooden blocks." }
]
const ICONS = {
	blank: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18v2h-2v4h-2v-4H7v4H5v-4H3z"/><path d="M6 6h12v2H6z" opacity=".35"/></svg>`,
	lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0zm3 4a1.5 1.5 0 0 0-.75 2.8V18h1.5v-1.2A1.5 1.5 0 0 0 12 14z"/></svg>`,
	clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm1 3v4.6l3.4 2-1 1.7L11 12.7V7z"/></svg>`,
	off: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-2.4.8L8.4 2.1 10.1 8.1zM3.3 2 2 3.3l5.1 5.1L4.5 10l5.6 1.9L12 17.5l1.5-4.4L20.7 22l1.3-1.3z"/></svg>`,
	google: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>`,
	ai: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".75"/></svg>`,
	grid: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"/></svg>`,
	close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>`,
	image: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9.6l3.6-3.6 3 3 4.4-4.4L19 13.6V6zm3.5 1.5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5z"/></svg>`,
	save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-2zm2 2v4h8V5zm5 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>`,
	down: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>`
}
const isImageFile = (f) => f && (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|heic|heif|bmp|avif)$/i.test(f.name ?? ""))
const reduceMotion = () => {
	try {
		return matchMedia("(prefers-reduced-motion: reduce)").matches
	} catch {
		return false
	}
}
function h(tag, attrs = {}, ...kids) {
	const el = document.createElement(tag)
	for (const [k, v] of Object.entries(attrs ?? {})) {
		if (v === undefined || v === null || v === false) continue
		if (k === "class") el.className = v
		else if (k === "html") el.innerHTML = v
		else if (k === "text") el.textContent = v
		else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v)
		else el.setAttribute(k, v === true ? "" : v)
	}
	for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
	return el
}

export function mountNewProject(host) {
	const S = { pick: "ai", images: [], pending: 0, busy: false }
	const access = aiAccess()
	const dlg = h("dialog", { class: "ui-dialog np-dialog", "aria-labelledby": "np-title", "aria-describedby": "np-sub" })
	const close = (value = "") => {
		if (!dlg.open || dlg.classList.contains("ui-closing")) return
		if (reduceMotion()) return dlg.close(value)
		dlg.classList.add("ui-closing")
		setTimeout(() => (dlg.classList.remove("ui-closing"), dlg.close(value)), 150)
	}
	dlg.addEventListener("cancel", (e) => (e.preventDefault(), close("cancel")))
	dlg.addEventListener("click", (e) => e.target === dlg && close("backdrop"))
	// (the page under the dialog must not see its keys: Space would play, ⌫ delete the selected part, / open the catalog)
	dlg.addEventListener("keydown", (e) => e.stopPropagation())

	// ---- the scene on screen, kept if wanted
	const keepName = h("b", {}, "")
	const keep = h(
		"div",
		{ class: "np-keep", role: "note" },
		h("p", {}, keepName, " has changes that aren’t saved. Keep them first? (Whatever you pick, ⌘Z brings it back.)"),
		h("div", { class: "np-keep-acts" }, h("button", { type: "button", class: "np-btn", onclick: () => host.save?.() }, h("span", { class: "np-ic", html: ICONS.save }), "Save…"), h("button", { type: "button", class: "np-btn", onclick: () => host.download?.() }, h("span", { class: "np-ic", html: ICONS.down }), "Download file"))
	)

	// ---- the three ways to start
	const choice = (key, cls, iconKey, title, sub) => h("button", { type: "button", class: `ui-start np-choice ${cls}`, "data-pick": key, "aria-pressed": "false", onclick: () => pick(key, true) }, h("span", { class: "ui-start-ic", html: ICONS[iconKey], "aria-hidden": "true" }), h("b", {}, title), h("span", {}, sub))
	const choices = h("div", { class: "ui-starts np-choices", role: "group", "aria-label": "How to start" }, choice("blank", "", "blank", "Blank", "Just the table"), choice("ai", "ui-start-ai", "ai", "Build with AI", "Describe it, or add a photo"), choice("example", "", "grid", "Start from an example", "A ready-made machine"))

	// Blank
	const paneBlank = h("div", { class: "np-pane", "data-pane": "blank" }, h("p", { class: "np-lede" }, "An empty table to fill yourself: add real objects from the catalog (/), or ask Edit with AI to add things."), h("div", { class: "np-go" }, h("button", { type: "button", class: "np-primary", onclick: () => doBlank() }, "Create blank scene")))

	// Build with AI
	const attachRow = h("div", { class: "np-attach", hidden: true, "aria-label": "Pictures" })
	const input = h("textarea", { class: "np-input", rows: "3", maxlength: "8000", placeholder: "Describe a machine, or add a photo of one…", "aria-label": "Describe the new scene", spellcheck: "true", enterkeyhint: "go" })
	const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true })
	const btnPhoto = h("button", { type: "button", class: "np-btn", onclick: () => fileInput.click(), title: `Add up to ${MAX_IMAGES} photos (or drop / paste them here)` }, h("span", { class: "np-ic", html: ICONS.image }), "Add a photo")
	const btnBuild = h("button", { type: "button", class: "np-primary np-ai", onclick: () => doAI() }, h("span", { class: "np-ic", html: ICONS.ai }), "Build new scene")
	const examples = h("div", { class: "np-examples", role: "list", "aria-label": "Examples" }, EXAMPLES.map((ex) => h("div", { role: "listitem", class: "np-ex-li" }, h("button", { type: "button", class: "np-ex", title: ex.text, onclick: () => ((input.value = ex.text), syncAI(), input.focus()) }, ex.label))))
	const msg = h("p", { class: "np-msg", "aria-live": "polite" })
	const libRow = h("div", { class: "np-lib", hidden: true }) // (My scenes, web/account/: host.library(el, done) fills it with the person's recent scenes)
	// (why the AI can't be used here now, before anything is typed: ./access.js)
	const accessNote = h("div", { class: "np-access", role: "note", hidden: true })
	const npBox = h("div", { class: "np-box" }, attachRow, input)
	const npRow = h("div", { class: "np-row" }, btnPhoto, h("span", { class: "np-hint" }, "Enter builds · Shift+Enter for a new line"), btnBuild)
	const exTitle = h("p", { class: "np-ex-t" }, "Or start from one of these:")
	// the concept sketch setting: one line under the box
	const conceptBtns = CONCEPT_MODES.map(([v, label]) => h("button", { type: "button", role: "radio", "data-v": v, "aria-checked": "false", onclick: () => (setConceptSetting(v), syncConcept()) }, label))
	const conceptHint = h("span", { class: "np-concept-hint" })
	const conceptGroup = h("div", { class: "np-seg", role: "radiogroup", "aria-labelledby": "np-concept-k" }, conceptBtns)
	const conceptRow = h("div", { class: "np-concept", title: "Before planning, the AI can draw a concept sketch of your idea to plan from. The build always follows your words." }, h("span", { class: "np-concept-k", id: "np-concept-k" }, "Concept sketch"), conceptGroup, conceptHint)
	conceptGroup.addEventListener("keydown", (e) => {
		const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
		if (!d || S.images.length) return
		e.preventDefault()
		const i = CONCEPT_MODES.findIndex(([k]) => k === conceptSetting())
		const next = CONCEPT_MODES[(i + d + CONCEPT_MODES.length) % CONCEPT_MODES.length][0]
		setConceptSetting(next)
		syncConcept()
		conceptBtns.find((b) => b.dataset.v === next)?.focus()
	})
	function syncConcept() {
		const photo = S.images.length > 0
		const v = photo ? "off" : conceptSetting()
		for (const b of conceptBtns) {
			b.setAttribute("aria-checked", String(b.dataset.v === v))
			b.disabled = photo
			b.tabIndex = b.dataset.v === v ? 0 : -1
		}
		conceptHint.textContent = photo ? "Off: your photo is the reference" : CONCEPT_HINTS[v]
		conceptRow.classList.toggle("np-concept-photo", photo)
	}
	const paneAI = h("div", { class: "np-pane", "data-pane": "ai" }, accessNote, npBox, npRow, conceptRow, exTitle, examples, fileInput)

	// Start from an example: the gallery (machines built with AI, web/gallery/), then the built-in machines and the ones saved here
	const galleryTitle = h("p", { class: "np-ex-t np-gal-head", hidden: true }, "Examples")
	const gallery = h("div", { class: "np-gallery", role: "list", "aria-label": "Examples", hidden: true })
	const classicTitle = h("p", { class: "np-ex-t", hidden: true }, "Classic machines")
	const list = h("div", { class: "np-list", role: "list" })
	const paneEx = h("div", { class: "np-pane", "data-pane": "example" }, galleryTitle, gallery, classicTitle, list)

	const card = h(
		"div",
		{ class: "ui-card np-card", tabindex: "-1" },
		h("button", { type: "button", class: "ui-x", "aria-label": "Close", title: "Close (Esc)", html: ICONS.close, onclick: () => close("x") }),
		h("div", { class: "np-head" }, h("h2", { id: "np-title" }, "Create new project"), h("p", { id: "np-sub" }, "Start a fresh scene. What’s on the table now stays one undo away.")),
		h("div", { class: "np-body" }, keep, choices, paneBlank, paneAI, paneEx, msg, libRow)
	)
	dlg.append(card)
	document.body.append(dlg)

	function pick(key, focus = false) {
		S.pick = key
		for (const b of choices.querySelectorAll("[data-pick]")) b.setAttribute("aria-pressed", String(b.dataset.pick === key))
		for (const p of [paneBlank, paneAI, paneEx]) p.hidden = p.dataset.pane !== key
		msg.textContent = ""
		if (key === "example") (renderList(), renderGallery())
		if (focus) (key === "ai" ? input : key === "blank" ? paneBlank.querySelector("button") : paneEx.querySelector("button"))?.focus({ preventScroll: true })
	}
	// ---- the gallery (web/gallery/index.json): read once, shown at once when it is there; nothing if it can't be read
	let galleryP = null
	const loadGallery = () =>
		(galleryP ??= fetch("gallery/index.json")
			.then((r) => (r.ok ? r.json() : []))
			.then((all) => (Array.isArray(all) ? all : []).filter((e) => e && typeof e.slug === "string" && typeof e.title === "string" && (e.scene || /^[a-z0-9-]+$/.test(e.slug))))
			.catch(() => []))
	const sceneOf = new Map() // slug -> Promise<scene> (fetched on hover, so the click opens it at once)
	const fetchScene = (e) => {
		if (!sceneOf.has(e.slug)) {
			const p = fetch(e.scene ?? `gallery/${e.slug}.json`).then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`)
				return r.json()
			})
			sceneOf.set(e.slug, p)
			p.catch(() => sceneOf.delete(e.slug))
		}
		return sceneOf.get(e.slug)
	}
	async function renderGallery() {
		const all = await loadGallery()
		gallery.hidden = galleryTitle.hidden = !all.length
		classicTitle.hidden = !all.length
		if (gallery.childElementCount || !all.length) return
		for (const e of all) {
			const stages = Number.isInteger(e.stages) && e.stages > 2 ? `${e.stages} stages` : null
			gallery.append(
				h(
					"div",
					{ role: "listitem", class: "np-gal-li" },
					h(
						"button",
						{ type: "button", class: "np-gal", title: e.description ? `${e.title}: ${e.description}` : e.title, onclick: (ev) => doGallery(e, ev.currentTarget), onpointerenter: () => fetchScene(e), onfocus: () => fetchScene(e) },
						h("span", { class: "np-gal-img" }, e.thumb ? h("img", { src: e.thumb, alt: "", loading: "lazy", width: "640", height: "360" }) : null, stages ? h("small", { class: "np-gal-n" }, stages) : null),
						h("span", { class: "np-gal-t" }, h("b", {}, e.title), e.description ? h("span", {}, e.description) : null)
					)
				)
			)
		}
	}
	/** One click: the example's scene goes on the table (one undo step, played from the start). No AI, no account. */
	async function doGallery(e, btn) {
		if (btn.getAttribute("aria-busy") === "true") return
		btn.setAttribute("aria-busy", "true")
		try {
			const scene = await fetchScene(e)
			if (!Array.isArray(scene?.items)) throw new Error("it isn’t a scene")
			if (!window.sandboxApp?.open) throw new Error("this page can’t open scenes")
			close("example")
			try {
				window.sandboxLibrary?.fresh?.("example", scene.id)
			} catch {}
			window.sandboxApp.open(scene)
		} catch (err) {
			msg.textContent = `Couldn’t open “${e.title}”: ${err.message}`
		} finally {
			btn.removeAttribute("aria-busy")
		}
	}
	loadGallery() // (read while the dialog is first shown: the example tab has its cards at once)
	function renderList() {
		list.innerHTML = ""
		const all = (host.scenarios?.() ?? []).filter((s) => s.id !== "empty")
		const mine = all.filter((s) => !s.builtin)
		const add = (s) => list.append(h("div", { role: "listitem" }, h("button", { type: "button", class: "np-item", onclick: () => doExample(s) }, h("b", {}, s.name), h("span", {}, s.builtin ? `${s.items ?? "?"} items` : "saved here"))))
		for (const s of all.filter((x) => x.builtin)) add(s)
		if (mine.length) {
			list.append(h("p", { class: "np-ex-t" }, "Saved here"))
			for (const s of mine) add(s)
		}
		if (!all.length) list.append(h("p", { class: "np-lede" }, "The examples are still loading…"))
	}
	function renderAccess(st = access.state) {
		const kind = st.kind
		// (signed out where the AI needs an account: the box stays, and Build (or Continue) goes to Google and back with the words kept)
		const noBox = kind === "off" || kind === "quota" || kind === "access" || (kind === "sign_in" && st.unavailable)
		npBox.hidden = noBox
		npRow.hidden = noBox
		conceptRow.hidden = noBox
		exTitle.hidden = noBox
		examples.hidden = noBox
		accessNote.hidden = kind === "ok"
		accessNote.dataset.kind = kind
		accessNote.replaceChildren()
		const tile = choices.querySelector('[data-pick="ai"]')
		tile?.classList.toggle("np-off", kind === "off" || kind === "quota" || kind === "access")
		const sub = tile?.querySelector("span:last-child")
		if (sub) sub.textContent = kind === "off" ? "Not available here" : kind === "quota" ? (st.when ? `Back ${atWhen(st.when)}` : "Back later today") : kind === "sign_in" ? "Needs an account" : kind === "access" ? "No access here" : "Describe it, or add a photo"
		if (kind !== "ok") {
			const title = kind === "sign_in" && !st.unavailable ? "Build with AI needs an account" : st.title
			const text = kind === "sign_in" && !st.unavailable ? "Sign in with Google to use AI. You’ll come right back here, and what you type is kept." : kind === "off" ? "This copy of the sandbox runs without the AI service. Everything else works: start from an example or a blank table, and add real objects from the catalog (/)." : st.text
			accessNote.append(h("span", { class: "ai-access-ic", html: ICONS[kind === "sign_in" ? "lock" : kind === "quota" ? "clock" : "off"], "aria-hidden": "true" }), h("div", { class: "ai-access-t" }, h("b", {}, title), h("p", {}, text)))
			const acts = []
			if (kind === "sign_in" && !st.unavailable) acts.push(h("button", { type: "button", class: "ai-google", onclick: () => access.signIn({ kind: "new", text: input.value }) || (msg.textContent = "Sign-in isn’t available on this page.") }, h("span", { class: "ai-g", html: ICONS.google, "aria-hidden": "true" }), "Continue with Google"))
			if (noBox) acts.push(h("button", { type: "button", class: "np-btn", onclick: () => pick("example", true) }, h("span", { class: "np-ic", html: ICONS.grid }), "Start from an example"), h("button", { type: "button", class: "np-btn", onclick: () => doBlank() }, h("span", { class: "np-ic", html: ICONS.blank }), "Blank scene"))
			if (acts.length) accessNote.append(h("div", { class: "ai-access-acts" }, acts))
		}
		syncAI()
	}
	access.onChange(() => renderAccess())
	const aiBlocked = () => access.state.kind !== "ok" && !(access.state.kind === "sign_in" && !access.state.unavailable)
	function syncAI() {
		btnBuild.disabled = S.busy || (!input.value.trim() && !S.images.length) || S.pending > 0 || aiBlocked()
		input.placeholder = S.images.length ? "What should happen in this picture? (or just press Build)" : "Describe a machine, or add a photo of one…"
		syncConcept()
	}
	input.addEventListener("input", syncAI)
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) (e.preventDefault(), doAI())
	})
	fileInput.onchange = () => {
		const f = [...(fileInput.files ?? [])]
		fileInput.value = ""
		attach(f)
	}
	dlg.addEventListener("paste", (e) => {
		const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile)
		if (files.length) (e.preventDefault(), pick("ai"), attach(files))
	})
	dlg.addEventListener("dragover", (e) => [...(e.dataTransfer?.types ?? [])].includes("Files") && e.preventDefault())
	dlg.addEventListener("drop", (e) => {
		if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return
		e.preventDefault()
		pick("ai")
		attach(e.dataTransfer.files)
	})
	async function attach(files) {
		const all = [...(files ?? [])]
		const ok = all.filter(isImageFile)
		if (all.length > ok.length) msg.textContent = "Only pictures can be added."
		const room = MAX_IMAGES - S.images.length - S.pending
		const take = ok.slice(0, Math.max(0, room))
		if (ok.length > take.length) msg.textContent = `Up to ${MAX_IMAGES} pictures.`
		S.pending += take.length
		syncAI()
		for (const f of take) {
			try {
				const [im] = await prepareImages([f])
				if (S.images.length < MAX_IMAGES) S.images.push(im)
				if (Math.max(im.width, im.height) < 512) msg.textContent = `${im.name} is small (${im.width}×${im.height} px): counts and sizes read from it may be off.`
			} catch (e) {
				msg.textContent = /\.(heic|heif)$/i.test(f.name ?? "") ? `${f.name}: this browser can’t open HEIC photos. Export it as JPEG (or take a screenshot) and add that.` : e.message
			}
			S.pending--
		}
		renderThumbs()
		syncAI()
	}
	function renderThumbs() {
		attachRow.innerHTML = ""
		attachRow.hidden = !S.images.length
		S.images.forEach((im, i) => attachRow.append(h("div", { class: "np-thumb", title: `${im.name} · ${im.width}×${im.height}` }, h("img", { src: im.thumb, alt: im.name }), h("button", { type: "button", "aria-label": `Remove ${im.name}`, onclick: () => (S.images.splice(i, 1), renderThumbs(), syncAI()) }, "×"))))
	}

	function doBlank() {
		close("blank")
		host.blank?.()
	}
	function doExample(s) {
		close("example")
		host.loadScenario?.(s.id)
	}
	async function doAI() {
		const text = input.value.trim()
		if (S.busy || (!text && !S.images.length) || S.pending) return
		if (access.state.kind !== "ok") {
			// (the accounts layer catches Build first when sign-in is needed; this is the way in it doesn't see)
			if (access.state.kind === "sign_in" && !access.state.unavailable) access.signIn({ kind: "new", text: input.value })
			return renderAccess()
		}
		S.busy = true
		syncAI()
		try {
			// (the concept sketch setting goes with it; with a photo there is none: the photo is the reference. panel.js reads conceptSetting()
			// itself when the app's buildAI passes only the words and pictures)
			const ok = await host.buildAI?.(text, S.images.slice(), { imagine: S.images.length ? "off" : conceptSetting() })
			if (ok === false) {
				msg.textContent = "A build is running in Edit with AI: wait for it (or stop it), then build this."
				return
			}
			input.value = ""
			S.images = []
			renderThumbs()
			close("ai")
		} catch (e) {
			msg.textContent = `Couldn’t start the build: ${e.message}`
		} finally {
			S.busy = false
			syncAI()
		}
	}

	return {
		/** opts: {ai: open on Build with AI, text: words for it, files: pictures for it, pick: "blank" | "ai" | "example"} */
		open(opts = {}) {
			const cur = host.current?.() ?? {}
			keep.hidden = !cur.dirty
			host.library?.(libRow, () => close("library"))
			keepName.textContent = `“${cur.name || "This scene"}”`
			msg.textContent = ""
			if (typeof opts.text === "string" && opts.text) input.value = opts.text
			access.check()
			// (no AI here, or not today: New opens on the examples, unless Build with AI itself was asked for, which then says why)
			const away = ["off", "quota", "access"].includes(access.state.kind)
			pick(opts.pick ?? (opts.ai || opts.text || opts.files ? "ai" : away && S.pick === "ai" ? "example" : S.pick ?? "ai"))
			renderAccess()
			if (!dlg.open) {
				dlg.classList.remove("ui-closing")
				dlg.showModal()
			}
			syncAI()
			;(S.pick === "ai" ? input : card).focus({ preventScroll: true })
			if (opts.files?.length) attach(opts.files)
		},
		close,
		isOpen: () => dlg.open,
		/** for tests */
		_el: dlg
	}
}
