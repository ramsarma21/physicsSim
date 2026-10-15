// "Create new project" (the top bar's New, key N): the one place a new scene starts.
//   Blank                  just the table (the app's own Clear: one undo step)
//   Build with AI          words and/or a photo -> a brand-new scene, built in the AI drawer's thread (panel.js buildNew), one undo step
//   Start from an example  the built-in machines (and the ones saved here)
// The scene on screen stays one ⌘Z away whatever is picked; when it has changes no saved scene holds, the dialog offers to keep it first
// (Save, or download it as a file). "Edit with AI" (the drawer) only ever changes the scene on screen: a new scene is always made here.
//   import { mountNewProject } from "./ai/new-project.js"
//   const np = mountNewProject({ scenarios, current, blank, loadScenario, save, download, buildAI, toast })
//   np.open({ ai: true, text, files })   // (opens on Build with AI, with these words and pictures)
// Styles: ai.css (.np-*), on ui.css's dialog card (.ui-dialog, .ui-card, .ui-start), so it looks like the intro and the help sheet.
import { prepareImages, MAX_IMAGES } from "./orchestrator.js"

const EXAMPLES = [
	{ label: "A Rube Goldberg chain", text: "A Rube Goldberg chain reaction: a ball rolls down a ramp and knocks over a row of growing dominoes; the last domino knocks a second ball off a ledge so it drops into a box." },
	{ label: "A bowling ball knocks over 10 pins", text: "A bowling ball rolls down a long ramp and knocks over 10 bowling pins standing in a row." },
	{ label: "A toy car races into dominoes", text: "A toy car races down a steep ramp and crashes into a long row of dominoes that all fall." },
	{ label: "A pendulum topples a tower", text: "A heavy pendulum swings down and knocks over a tower of six wooden blocks." }
]
const ICONS = {
	blank: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18v2h-2v4h-2v-4H7v4H5v-4H3z"/><path d="M6 6h12v2H6z" opacity=".35"/></svg>`,
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
	const paneAI = h(
		"div",
		{ class: "np-pane", "data-pane": "ai" },
		h("div", { class: "np-box" }, attachRow, input),
		h("div", { class: "np-row" }, btnPhoto, h("span", { class: "np-hint" }, "Enter builds · Shift+Enter for a new line"), btnBuild),
		h("p", { class: "np-ex-t" }, "Or start from one of these:"),
		examples,
		fileInput
	)

	// Start from an example
	const list = h("div", { class: "np-list", role: "list" })
	const paneEx = h("div", { class: "np-pane", "data-pane": "example" }, list)

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
		if (key === "example") renderList()
		if (focus) (key === "ai" ? input : key === "blank" ? paneBlank.querySelector("button") : list.querySelector("button"))?.focus({ preventScroll: true })
	}
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
	function syncAI() {
		btnBuild.disabled = S.busy || (!input.value.trim() && !S.images.length) || S.pending > 0
		input.placeholder = S.images.length ? "What should happen in this picture? (or just press Build)" : "Describe a machine, or add a photo of one…"
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
		S.busy = true
		syncAI()
		try {
			const ok = await host.buildAI?.(text, S.images.slice())
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
			pick(opts.pick ?? (opts.ai || opts.text || opts.files ? "ai" : S.pick ?? "ai"))
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
