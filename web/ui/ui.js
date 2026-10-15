// The product layer over the sandbox: a first-run intro (once per profile), the help and shortcuts sheet (? or the top bar's ? button), the
// empty-table starts, the loading state before the first picture, toasts that fade and speak, keyboard access to the results strip, and the
// phone's "more" menu. It changes nothing in the app's state itself: it presses the app's own buttons (so every action is the app's, with its
// undo, toasts and checks) and reads window.sandbox (web/app.js) and the page's DOM. Styles: ui.css (next to this file).
//
// ?intro=1 shows the intro again (also when it was seen); ?intro=0 never shows it. A browser driven by automation (navigator.webdriver: tests,
// screenshots) does not get it unless ?intro=1, so scripted runs see the app as they always have. Seen is stored under the app's own key scheme:
// sandbox:intro (sandbox@<profile>:intro with ?profile=).
import { heroSvg, playHero } from "./hero.js"

const PARAMS = new URLSearchParams(location.search)
const PROFILE = PARAMS.get("profile")
const nsKey = (k) => (PROFILE ? `sandbox@${PROFILE}:${k}` : `sandbox:${k}`) // nsKey("intro"): the app's scheme (web/app.js), ?profile= keeps a tester's state apart
const store = {
	get(k) { try { return JSON.parse(localStorage.getItem(nsKey(k))) } catch { return null } },
	set(k, v) { try { localStorage.setItem(nsKey(k), JSON.stringify(v)) } catch {} },
}
const STARTER = "rube-goldberg"
const $ = (s, root = document) => root.querySelector(s)
const app = () => window.sandbox ?? null
const reduceMotion = () => {
	try { return matchMedia("(prefers-reduced-motion: reduce)").matches } catch { return false }
}
const MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "")
const MOD = MAC ? "⌘" : "Ctrl"
const SHIFT = MAC ? "⇧" : "Shift"

/** h("div", {class, text, html, on: {click}}, ...children) */
function h(tag, attrs = {}, ...kids) {
	const e = document.createElement(tag)
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue
		if (k === "class") e.className = v
		else if (k === "text") e.textContent = v
		else if (k === "html") e.innerHTML = v
		else if (k === "on") for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f)
		else e.setAttribute(k, v === true ? "" : v)
	}
	for (const c of kids.flat()) if (c != null && c !== false) e.append(c)
	return e
}
const ic = (name) => h("span", { class: "ui-ic", "aria-hidden": "true", html: ICONS[name] })
const ICONS = {
	ai: `<svg viewBox="0 0 24 24"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".75"/></svg>`,
	play: `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
	grid: `<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 3h3v-3h2v3h3v2h-3v3h-2v-3h-3z"/></svg>`,
	help: `<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 11.5h2V18h-2zM12 6a3.5 3.5 0 0 1 1.6 6.6c-.4.2-.6.5-.6.9v.5h-2v-.5c0-1.2.6-2.2 1.7-2.7A1.5 1.5 0 1 0 10.5 9.5h-2A3.5 3.5 0 0 1 12 6z"/></svg>`,
	more: `<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
	close: `<svg viewBox="0 0 24 24"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>`,
	keys: `<svg viewBox="0 0 24 24"><path d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm1 2v8h16V8zm2 1h2v2H6zm3 0h2v2H9zm3 0h2v2h-2zm3 0h3v2h-3zM6 12h2v2H6zm3 0h6v2H9zm7 0h2v2h-2z"/></svg>`,
	edit: `<svg viewBox="0 0 24 24"><path d="M4 16.5V20h3.5L18 9.5 14.5 6zM20.7 6.8a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0l-1.6 1.6 3.5 3.5z"/></svg>`,
	film: `<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2.5v2h1.8v-2zm12.2 0v2H19v-2zM5 9.5v2h1.8v-2zm12.2 0v2H19v-2zM5 13.5v2h1.8v-2zm12.2 0v2H19v-2zM5 17.5v1.5h1.8v-1.5zm12.2 0v1.5H19v-1.5zM8.6 5v14h6.8V5z"/></svg>`,
	save: `<svg viewBox="0 0 24 24"><path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h14V9l-4-4H5zm2 1h7v4H7zm5 7a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/></svg>`,
	down: `<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>`,
	up: `<svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zM5 18h14v2H5z"/></svg>`,
	clear: `<svg viewBox="0 0 24 24"><path d="M3 18h18v2H3zM16.2 3.6l4.2 4.2-8.5 8.5H7.7l-3.6-3.6zM13 7l-6.3 6.3 1.8 1.8h2.6l5-5z"/></svg>`,
	reset: `<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>`,
}
const kbd = (...keys) => keys.map((k) => h("kbd", { text: k }))

// ---------------------------------------------------------------- the app, when it is ready
/** Resolves once the first scene is up (the app unlocks Add, Build with AI and the rest then). */
function whenReady() {
	const ok = () => { const add = $("#add"); return !!add && !add.disabled && !!app()?.scene }
	if (ok()) return Promise.resolve()
	return new Promise((resolve) => {
		const t = setInterval(() => ok() && (clearInterval(t), resolve()), 150)
	})
}
/** The three ways to start. Each presses the app's own control, once the app can take it. */
const start = {
	async ai() {
		await whenReady()
		// (a new scene from words or a photo: New → Build with AI; the top bar's Edit with AI changes the scene on screen)
		if (app()?.openNew) return app().openNew({ ai: true })
		const b = document.body
		if (b.classList.contains("ai-open") && !b.classList.contains("ai-folded")) return $(".ai-drawer .ai-input")?.focus()
		$("#ai")?.click()
	},
	async starter() {
		await whenReady()
		const S = app()
		const showing = S.scenarioId === STARTER && JSON.stringify(S.scene) === S.loadedJSON // (the starter, unedited: it only has to play)
		const before = S.sim
		if (!showing) $("#reset")?.click() // (the app's own Reset: the starter, as one undo step, with its toast)
		const t0 = performance.now()
		const play = () => {
			const s = app()
			const landed = s?.sim && (showing || s.sim !== before) && $("#status")?.dataset.state === "ok" && !document.body.classList.contains("ai-draft")
			if (landed) return $("#restart")?.click() // from the start, playing
			if (performance.now() - t0 < 20000) setTimeout(play, 120)
		}
		play()
	},
	async catalog() {
		await whenReady()
		const c = app()?.catalogUI
		if (c) { if (!c.isOpen()) c.open() }
		else $("#add")?.click()
	},
}
const itemCount = () => app()?.catalog?.types?.length ?? 113

// ---------------------------------------------------------------- dialogs
/** Opens a modal dialog with a soft entrance; closing plays a short exit first (none with reduced motion). */
function openDialog(dlg, focusEl) {
	if (dlg.open) return
	if (!dlg.isConnected) document.body.append(dlg)
	dlg.classList.remove("ui-closing")
	dlg.showModal()
	;(focusEl ?? dlg.querySelector(".ui-card"))?.focus({ preventScroll: true })
}
function closeDialog(dlg, value = "") {
	if (!dlg.open || dlg.classList.contains("ui-closing")) return
	if (reduceMotion()) return dlg.close(value)
	dlg.classList.add("ui-closing")
	setTimeout(() => { dlg.classList.remove("ui-closing"); dlg.close(value) }, 150)
}
function makeDialog(cls, label) {
	const dlg = h("dialog", { class: `ui-dialog ${cls}`, "aria-labelledby": label })
	dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(dlg, "cancel") }) // (Esc: the same exit as the buttons)
	dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(dlg, "backdrop") }) // a click on the scrim
	// the page under the dialog must not see its keys (Space would play, ⌫ delete the selected part, / open the catalog…)
	dlg.addEventListener("keydown", (e) => {
		e.stopPropagation()
		if (e.key === "?" && dlg === help) { e.preventDefault(); closeDialog(dlg) }
	})
	return dlg
}

// ---------------------------------------------------------------- the first-run intro
let intro = null
let heroStop = null
/** The little machine over the intro: its motion is worked out by ./hero.js (real mechanics, played slowed down), not keyframed by hand. */
function heroArt() {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
	svg.setAttribute("viewBox", "0 0 560 168")
	svg.setAttribute("preserveAspectRatio", "xMidYMax meet")
	svg.setAttribute("aria-hidden", "true")
	svg.innerHTML = heroSvg()
	return svg
}
function heroPlay(on) {
	heroStop?.()
	heroStop = null
	const svg = intro?.querySelector(".ui-hero svg")
	if (!on || !svg || reduceMotion() || typeof svg.animate !== "function") return // (reduced motion: the machine stands still, ready)
	try { heroStop = playHero(svg) } catch (e) { console.warn("intro picture:", e) }
}
function buildIntro() {
	const startBtn = (key, cls, icon, title, sub, keys) =>
		h("button", { type: "button", class: `ui-start ${cls}`, "data-start": key, on: { click: () => choose(key) } },
			h("span", { class: "ui-start-ic", html: ICONS[icon], "aria-hidden": "true" }), keys ? kbd(keys) : null, h("b", { text: title }), h("span", { text: sub }), h("span", { class: "ui-wait", text: "Getting ready…" }))
	const dlg = makeDialog("ui-intro", "ui-intro-t")
	dlg.setAttribute("aria-describedby", "ui-intro-d")
	const card = h("div", { class: "ui-card", tabindex: "-1" },
		h("button", { type: "button", class: "ui-x", "aria-label": "Skip the introduction", title: "Skip (Esc)", html: ICONS.close, on: { click: () => closeDialog(dlg, "skip") } }),
		h("div", { class: "ui-hero" }, heroArt()),
		h("div", { class: "ui-intro-body" },
			h("p", { class: "ui-eyebrow" }, h("span", { class: "logo", "aria-hidden": "true" }), "Physics Sandbox"),
			h("h2", { id: "ui-intro-t", html: "Physics-true scenes <em>and videos</em>" }),
			h("p", { id: "ui-intro-d", class: "ui-lede", text: "Describe a machine, or drop a photo of one. Every object has its real size and weight, and a real physics engine decides what happens: nothing is animated by hand. Then export it as a video." }),
			h("ul", { class: "ui-facts", "aria-label": "What makes it different" },
				h("li", { text: `${itemCount()} real objects` }), h("li", { text: "True sizes, weights and materials" }), h("li", { text: "MP4 export, up to 4K" })),
			h("div", { class: "ui-starts", role: "group", "aria-label": "Start" },
				startBtn("ai", "ui-start-ai", "ai", "Build with AI", "Type what it should do, or drop a photo", "A"),
				startBtn("starter", "", "play", "Starter machine", "A Rube Goldberg chain, ready to play"),
				startBtn("catalog", "", "grid", "Browse the catalog", `${itemCount()} objects to drop on the table`, "/"))),
		h("div", { class: "ui-intro-foot" },
			h("button", { type: "button", class: "ui-link", text: "Skip", on: { click: () => closeDialog(dlg, "skip") } }),
			h("span", {}, "Press ", ...kbd("?"), " any time for shortcuts and help")))
	dlg.append(card)
	dlg.addEventListener("close", () => { store.set("intro", true); heroPlay(false) }) // (seen: once per profile, however it was closed)
	// the keys on the cards work here too (A: Build with AI, /: the catalog), and ? goes on to the shortcuts
	dlg.addEventListener("keydown", (e) => {
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
		if (e.key === "?") { e.preventDefault(); closeDialog(dlg, "help"); setTimeout(openHelp, reduceMotion() ? 0 : 170); return }
		const key = e.key === "/" ? "catalog" : e.key === "a" || e.key === "A" ? "ai" : null
		if (!key) return
		e.preventDefault()
		choose(key)
	})
	async function choose(key) {
		const btn = dlg.querySelector(`[data-start="${key}"]`)
		btn?.classList.add("waiting") // (the app may still be loading: the button says so until it can act)
		await whenReady()
		btn?.classList.remove("waiting")
		closeDialog(dlg, key)
		setTimeout(() => start[key](), reduceMotion() ? 0 : 170) // (after the exit, so the drawer or the catalog opens onto a clear page)
	}
	return dlg
}
function openIntro() {
	intro ??= buildIntro()
	// the counts come from the catalog, which may have arrived since the intro was built
	for (const [sel, text] of [[".ui-facts li", `${itemCount()} real objects`], ['[data-start="catalog"] > span:not([class])', `${itemCount()} objects to drop on the table`]]) {
		const e = intro.querySelector(sel)
		if (e) e.textContent = text
	}
	openDialog(intro)
	heroPlay(true)
}
function maybeIntro() {
	const want = PARAMS.get("intro")
	if (want === "0") return
	if (want !== "1" && (store.get("intro") || navigator.webdriver)) return
	openIntro()
}

// ---------------------------------------------------------------- help and shortcuts
let help = null
function buildHelp() {
	const dlg = makeDialog("ui-help", "ui-help-t")
	const row = (keys, what) => h("div", { class: "row" }, h("dt", {}, ...keys.map((k) => (typeof k === "string" ? h("kbd", { text: k }) : k))), h("dd", { text: what }))
	const group = (title, ...rows) => h("section", {}, h("h3", { text: title }), h("dl", {}, ...rows))
	const how = (icon, title, ...text) => h("section", {}, h("h3", {}, ic(icon), title), h("p", {}, ...text))
	// words that differ by device: a pointer and a keyboard, or a touch screen (CSS shows one: ui.css); a wide bar, or one with a ⋯ menu
	const touch = (pointer, finger) => [h("span", { class: "ui-hover", text: pointer }), h("span", { class: "ui-touch", text: finger })]
	const narrow = (wide, small) => [h("span", { class: "ui-wide", text: wide }), h("span", { class: "ui-narrow", text: small })]
	const card = h("div", { class: "ui-card", tabindex: "-1" },
		h("button", { type: "button", class: "ui-x", "aria-label": "Close help", title: "Close (Esc)", html: ICONS.close, on: { click: () => closeDialog(dlg) } }),
		h("div", { class: "ui-help-head" },
			h("span", { class: "ui-start-ic", html: ICONS.keys, "aria-hidden": "true" }),
			h("div", {}, h("h2", { id: "ui-help-t", text: "Shortcuts and help" }), h("p", {}, ...touch("Everything you can do from the keyboard, and how the main parts work.", "How the main parts work.")))),
		h("div", { class: "ui-help-body" },
			h("div", { class: "ui-how" },
				how("edit", "Edit", ...touch("Click", "Tap"), " any part to pick it up: drag to move, the dots resize or turn it. The ☰ panel shows its real sizes, weight and material. Every change runs the physics again."),
				how("ai", "Edit with AI, or New", "Edit with AI changes the scene on screen: only what you ask changes. New starts a scene: blank, built with AI from words or a photo, or an example. ", ...touch(`${MAC ? "⌘Z" : "Ctrl+Z"} undoes either.`, "Undo (↶ at the top) takes either back.")),
				how("film", "Export", "Export video makes an MP4 (up to 4K, 60 fps) with impact sounds, from any camera. ", ...narrow("↓ saves the scene as a file and ↑ opens one.", "Download scene file and Open a scene file are in the ⋯ menu."))),
			h("div", { class: "ui-keys" },
				h("div", {},
					group("Playback",
						row(["Space"], "Play or pause"),
						row(["←", "→"], "Step through time (nothing selected)"),
						row([h("span", { text: "click an event" })], "Jump to that moment")),
					group("Open",
						row(["/"], "Add an item from the catalog"),
						row(["A"], "Edit this scene with AI"),
						row(["N"], "New: blank, Build with AI, or an example"),
						row(["E"], "Export video"),
						row(["?"], "This sheet")),
					group("Camera",
						row([h("span", { text: "Wide · Follow · Orbit" })], "Pick a camera (top right of the picture)"),
						row([h("span", { text: "drag, scroll" })], "Orbit: look around and zoom"),
						row([h("span", { text: "Fit" })], "Frame everything again"))),
				h("div", {},
					group("Editing",
						row([h("span", { text: "click" })], "Select a part"),
						row([h("span", { text: "drag" })], "Move it"),
						row([SHIFT, h("span", { text: "+ drag" })], "Snap: 1 cm moves, 15° turns"),
						row(["←", "↑", "→", "↓"], "Nudge 5 mm"),
						row([SHIFT, h("span", { text: "+ arrows" })], "Nudge 5 cm"),
						row(["⌫"], "Delete it"),
						row([MOD, "D"], "Duplicate it"),
						row(["Esc"], "Deselect, or put a drag back")),
					group("History",
						row([MOD, "Z"], "Undo"),
						row([SHIFT, MOD, "Z", h("span", { text: "or" }), MOD, "Y"], "Redo"))))),
		h("div", { class: "ui-help-foot" },
			h("button", { type: "button", class: "ui-link", text: "Show the introduction again", on: { click: () => { closeDialog(dlg); setTimeout(openIntro, reduceMotion() ? 0 : 170) } } }),
			h("span", {}, "Press ", ...kbd("?"), " to open this again")))
	dlg.append(card)
	return dlg
}
function openHelp() {
	help ??= buildHelp()
	if (help.open) return closeDialog(help)
	openDialog(help)
}

// ---------------------------------------------------------------- the top bar: help, and "more" (the actions a narrower bar has no room for)
let menu = null
let moreBtn = null
function buildTopBar() {
	const right = $(".top-right")
	if (!right) return
	const helpBtn = h("button", { type: "button", id: "ui-help-btn", class: "ghost icon-btn ui-help-btn", title: "Shortcuts and help (?)", "aria-label": "Shortcuts and help", "aria-haspopup": "dialog", html: ICONS.help, on: { click: openHelp } })
	moreBtn = h("button", { type: "button", id: "ui-more", class: "ghost icon-btn ui-more", title: "More", "aria-label": "More actions", "aria-haspopup": "menu", "aria-expanded": "false", html: ICONS.more, on: { click: () => (menu ? closeMenu() : openMenu()) } })
	const video = $("#export-video")
	if (video?.parentElement === right) right.insertBefore(moreBtn, video)
	else right.append(moreBtn)
	right.append(helpBtn)
}
// [the button it presses, label, icon], in groups; the menu lists the ones the bar is not showing at this width (ui.css hides them)
const MENU = [
	[["#save", "Save scene", "save"], ["#export", "Download scene file", "down"], ["#import", "Open a scene file", "up"]],
	[["#ui-help-btn", "Shortcuts and help", "help", () => openHelp()]],
]
function openMenu() {
	closeMenu()
	menu = h("div", { class: "ui-menu", role: "menu", "aria-label": "More actions" })
	const groups = MENU.map((g) => g.filter(([sel]) => { const b = $(sel); return !!b && !b.getClientRects().length })).filter((g) => g.length)
	groups.forEach((g, i) => {
		if (i) menu.append(h("hr", { "aria-hidden": "true" }))
		for (const [sel, label, icon, act] of g) {
			const real = $(sel)
			menu.append(h("button", { type: "button", role: "menuitem", tabindex: "-1", disabled: !!real.disabled, on: { click: () => { closeMenu(true); act ? act() : real.click() } } }, ic(icon), label))
		}
	})
	document.body.append(menu)
	const r = moreBtn.getBoundingClientRect()
	menu.style.top = `${Math.round(r.bottom + 6)}px`
	menu.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`
	moreBtn.setAttribute("aria-expanded", "true")
	menu.querySelector("button:not(:disabled)")?.focus()
	menu.addEventListener("keydown", (e) => {
		e.stopPropagation() // (the arrows here move through the menu: they don't nudge a part or step the clock)
		const items = [...menu.querySelectorAll("button:not(:disabled)")]
		const i = items.indexOf(document.activeElement)
		if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus() }
		else if (e.key === "Home" || e.key === "End") { e.preventDefault(); items[e.key === "Home" ? 0 : items.length - 1]?.focus() }
		else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true) }
		else if (e.key === "Tab") closeMenu()
	})
	setTimeout(() => document.addEventListener("pointerdown", outside, true), 0)
}
function outside(e) {
	if (menu && !menu.contains(e.target) && !moreBtn.contains(e.target)) closeMenu()
}
function closeMenu(refocus = false) {
	if (!menu) return
	menu.remove()
	menu = null
	document.removeEventListener("pointerdown", outside, true)
	moreBtn?.setAttribute("aria-expanded", "false")
	if (refocus) moreBtn?.focus({ preventScroll: true })
}
addEventListener("resize", () => closeMenu())

// ---------------------------------------------------------------- the empty table
let empty = null
function buildEmpty() {
	const chip = (key, cls, icon, label) => h("button", { type: "button", class: `ui-chip ${cls}`, on: { click: () => start[key]() } }, ic(icon), label)
	return h("div", { class: "ui-empty", role: "region", "aria-label": "Empty table" },
		h("div", { class: "ui-empty-card" },
			h("h2", { text: "An empty table" }),
			h("p", { text: "Describe a machine, open a ready-made one, or pick real objects from the catalog." }),
			h("div", { class: "ui-empty-acts" },
				chip("ai", "ai", "ai", "Build with AI"),
				chip("starter", "", "play", "Starter machine"),
				chip("catalog", "", "grid", "Browse the catalog")),
			h("p", { class: "ui-tip", text: "Tip: drag any card from the catalog straight onto the table." })))
}
function syncEmpty() {
	const S = app()
	const b = document.body
	const bare = !!S?.scene && !S.scene.items.some((i) => i.type !== "table")
	const busy = b.classList.contains("ai-draft") || b.classList.contains("ai-open") || !!S?.catalogUI?.isOpen() || !!S?.editor?.dragging || !!(intro?.open)
	const show = bare && !busy && !!S?.sim
	if (show && !empty?.isConnected) {
		empty ??= buildEmpty()
		$(".viewport")?.append(empty)
	} else if (!show && empty?.isConnected) empty.remove()
}

// ---------------------------------------------------------------- before the first picture
let boot = null
function buildBoot() {
	const vp = $(".viewport")
	if (!vp) return
	// (the studio's own wall and table colours, whatever the theme: the first picture fades in over the same colours; the status pill above
	// already says what is going on, so this only says what it is for)
	boot = h("div", { class: "ui-boot", "aria-hidden": "true" }, h("div", { class: "ui-boot-in" }, h("span", { class: "ui-dots" }, h("i"), h("i"), h("i")), h("b", { text: "Setting up the table…" })))
	vp.append(boot)
	const status = $("#status")
	const sync = () => {
		const state = status?.dataset.state
		const failed = state === "error" || ($("#error") && !$("#error").hidden)
		if (failed || (state === "ok" && app()?.sim)) finish()
	}
	const mo = new MutationObserver(sync)
	if (status) mo.observe(status, { attributes: true, childList: true, subtree: true, characterData: true })
	const err = $("#error")
	if (err) mo.observe(err, { attributes: true, attributeFilter: ["hidden"] })
	const t = setInterval(sync, 400)
	function finish() {
		mo.disconnect()
		clearInterval(t)
		if (!boot) return
		const b = boot
		boot = null
		b.classList.add("gone")
		setTimeout(() => b.remove(), reduceMotion() ? 0 : 400)
	}
	sync()
}

// ---------------------------------------------------------------- toasts: spoken, and they fade instead of vanishing
function wireToast() {
	const t = $("#toast")
	if (!t) return
	t.setAttribute("role", "status")
	t.setAttribute("aria-live", "polite")
	t.setAttribute("aria-atomic", "true")
	let wasShown = !t.hidden
	new MutationObserver(() => {
		const shown = !t.hidden
		if (wasShown && !shown && !reduceMotion() && t.textContent) {
			const ghost = t.cloneNode(true)
			ghost.removeAttribute("id")
			ghost.removeAttribute("role")
			ghost.removeAttribute("aria-live")
			ghost.hidden = false
			ghost.classList.add("ui-toast-out")
			ghost.setAttribute("aria-hidden", "true")
			document.body.append(ghost)
			setTimeout(() => ghost.remove(), 220)
		}
		wasShown = shown
	}).observe(t, { attributes: true, attributeFilter: ["hidden"] })
}

// ---------------------------------------------------------------- accessibility touches on the app's own markup
function wireA11y() {
	// the camera, speed and quality controls are toggle buttons (aria-pressed) in a group, not radios
	for (const sel of ["#cam", "#speed", "#quality"]) $(sel)?.setAttribute("role", "group")
	const view = $("#view-3d")
	if (view) {
		view.setAttribute("role", "img")
		view.setAttribute("aria-label", "The scene in 3D. Click a part to select it; the ? key lists the keyboard shortcuts.")
	}
	// the time slider says the time in words, kept up with the app's clock (it changes while playing, and with each run's length)
	const time = $("#time")
	if (time) {
		const say = () => {
			const v = `${Number(time.value).toFixed(2)} seconds of ${Number(time.max).toFixed(1)}`
			if (time.getAttribute("aria-valuetext") !== v) time.setAttribute("aria-valuetext", v)
		}
		for (const ev of ["input", "focus"]) time.addEventListener(ev, say)
		const clock = $("#clock")
		if (clock) new MutationObserver(say).observe(clock, { childList: true, characterData: true, subtree: true })
		say()
	}
	// the results strip: an event or a goal with a moment to jump to holds a real button (the item stays a list item; the app's click on the
	// item still does the jump). The app rebuilds the list on every run.
	const chain = $("#chain")
	if (chain) {
		const mark = () => {
			for (const li of chain.querySelectorAll(":scope > li.go")) {
				if (li.querySelector(":scope > .chain-go")) continue
				const b = h("button", { type: "button", class: "chain-go" })
				b.append(...li.childNodes)
				li.append(b)
			}
		}
		new MutationObserver(mark).observe(chain, { childList: true })
		chain.addEventListener("keydown", (e) => {
			if (e.code === "Space" && e.target.closest?.(".chain-go")) e.stopPropagation() // (Space presses this button, it does not play)
		})
		mark()
	}
}

// ---------------------------------------------------------------- a run that failed: a way on from the banner
function wireError() {
	const err = $("#error")
	if (!err) return
	const undoBtn = h("button", { type: "button", class: "ui-err-btn", text: "Undo last change", on: { click: () => $("#undo")?.click() } })
	const acts = h("span", { class: "ui-err-acts" }, h("button", { type: "button", class: "ui-err-btn", text: "Try again", on: { click: retry } }), undoBtn)
	const sync = () => {
		const failed = !err.hidden && /^Couldn.t run it/.test(err.firstChild?.textContent ?? "") // (a run that failed; not a layout or start-up problem)
		undoBtn.hidden = !!$("#undo")?.disabled
		if (failed && !acts.isConnected) err.append(acts)
		else if (!failed && acts.isConnected) acts.remove()
	}
	new MutationObserver(sync).observe(err, { attributes: true, attributeFilter: ["hidden"], childList: true })
	sync()
}
/** The same scene, run again: the app's own undo and redo (one run, nothing changed, history kept); with no history yet, a reload (the scene is saved). */
function retry() {
	const u = $("#undo"), r = $("#redo")
	if (u && !u.disabled) { u.click(); r?.click() }
	else if (r && !r.disabled) { r.click(); u?.click() }
	else location.reload()
}

// ---------------------------------------------------------------- keys: ? opens help
const NOT_TEXT = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"])
addEventListener("keydown", (e) => {
	if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
	if (e.key !== "?" && e.key !== "F1") return
	const el = e.target
	const tag = el?.tagName
	if (el && (el.isContentEditable || tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !NOT_TEXT.has((el.type || "").toLowerCase())))) return
	const other = [...document.querySelectorAll("dialog[open]")].some((d) => d !== help)
	if (other) return // (another dialog, the video export, has the page)
	e.preventDefault()
	openHelp()
})

// ---------------------------------------------------------------- start
function main() {
	buildTopBar()
	wireToast()
	wireA11y()
	wireError()
	buildBoot()
	maybeIntro()
	// the empty-table starts follow the scene, the drawers and the AI's draft (cheap checks; no hook in the app is needed)
	const sync = () => syncEmpty()
	const mo = new MutationObserver(sync)
	mo.observe(document.body, { attributes: true, attributeFilter: ["class"] })
	for (const sel of ["#catalog", "#status", "#chain", "#scene-name"]) {
		const e = $(sel)
		if (e) mo.observe(e, { attributes: true, childList: true, subtree: sel !== "#chain", characterData: true })
	}
	intro?.addEventListener("close", sync)
	setInterval(sync, 700)
	sync()
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, { once: true })
else main()

export { openHelp, openIntro, start }
