// Accounts and "My scenes" (docs/ACCOUNTS.md): the top bar's My scenes button (key O) and account chip, the library dialog, and the autosave
// that keeps every scene the person makes. Loaded by web/index.html after app.js; it adds its own controls to the page and talks to the app
// only through window.sandbox (read) and the few calls web/app.js makes and offers:
//   window.sandboxLibrary   (installed here, at once)  changed(S), fresh(kind, scenarioId), holds(), open(), renderRecent(el, done)
//   window.sandboxApp       (web/app.js)              open(scene), rename(name)
// Where scenes are kept: ./store.js (this browser, or the signed-in person's account). Who is signed in: ./auth.js. Styles: ./account.css.
// On a deploy whose Build with AI needs sign-in: ./ai-signin.js (the "needs an account" sheet in front of the AI). The account menu also
// deletes the account (DELETE /api/scenes/me, after typing DELETE).
import { createAiSignIn } from "./ai-signin.js"
import { createAuth } from "./auth.js"
import { createAutosave } from "./autosave.js"
import { createLibrary } from "./library.js"
import { createStore } from "./store.js"
import { ago, h, icon, ICONS, isTextual, MAC, plural } from "./util.js"

const $ = (s, root = document) => root.querySelector(s)
const app = () => window.sandbox ?? null

// ---------------------------------------------------------------- toasts (the app's own #toast: ui/ui.js makes it speak and fade)
let toastTimer = 0
function toast(text) {
	const t = $("#toast")
	if (!t) return
	t.textContent = text
	t.hidden = false
	clearTimeout(toastTimer)
	toastTimer = setTimeout(() => (t.hidden = true), 2600)
}

const auth = createAuth()
const store = createStore({ auth })
const autosave = createAutosave({ store, toast, onState: (s) => syncButton(s) })
const library = createLibrary({ store, autosave, auth, toast, newScene: () => app()?.openNew?.() ?? $("#new")?.click() })

window.sandboxLibrary = {
	changed: (S) => autosave.changed(S),
	fresh: (kind, scenarioId) => autosave.fresh(kind, scenarioId),
	holds: () => autosave.holds(),
	open: () => library.open(),
	close: () => library.close(),
	renderRecent: (el, done) => library.renderRecent(el, done),
	// (for tests and the console)
	store,
	auth,
	autosave,
	library
}

// ---------------------------------------------------------------- the top bar
let btn = null
let chip = null
function buildButton() {
	if ($("#my-scenes")) return
	btn = h("button", { type: "button", id: "my-scenes", class: "ghost lib-btn", title: "My scenes (O): every scene you made", "aria-haspopup": "dialog", disabled: true, on: { click: () => library.open() } }, h("span", { class: "lib-btn-ic", html: ICONS.scenes, "aria-hidden": "true" }), h("span", { class: "lib-btn-t", text: "My scenes" }), h("i", { class: "lib-btn-state", "aria-hidden": "true" }))
	const anchor = $("#new")
	if (anchor?.parentElement) anchor.after(btn)
	else $(".top-right")?.prepend(btn)
}
let savedTimer = 0
function syncButton(s = autosave.state) {
	if (!btn) return
	const dot = btn.querySelector(".lib-btn-state")
	clearTimeout(savedTimer)
	dot.dataset.state = s.state
	if (s.state === "saved") savedTimer = setTimeout(() => (dot.dataset.state = "idle"), 1800)
	const where = store.kind === "cloud" ? "your account" : "this browser"
	const said = s.state === "saving" ? "saving…" : s.state === "error" ? "couldn’t save the last change (trying again)" : s.at ? `saved ${ago(s.at)} in ${where}` : `kept in ${where}`
	btn.title = `My scenes (O): every scene you made, ${said}`
}

/** The account chip at the end of the bar: nothing without accounts; "Sign in" (Google) signed out; the person's initials signed in. */
function syncChip() {
	const right = $(".top-right")
	if (!right) return
	if (!auth.configured) {
		chip?.remove()
		chip = null
		return
	}
	if (!chip) {
		chip = h("div", { class: "acct-chip" })
		right.append(chip)
	}
	chip.replaceChildren()
	if (auth.state === "signed-in") {
		const u = auth.user
		const b = h("button", { type: "button", class: "acct-avatar", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": `Account: ${u.name || u.email}`, title: `${u.name || ""}${u.email ? `\n${u.email}` : ""}`, text: u.initials, on: { click: () => (menu ? closeMenu() : openMenu(b)) } })
		chip.append(b)
	} else {
		const off = auth.state === "unavailable"
		chip.append(h("button", { type: "button", class: "acct-signin", disabled: off, title: off ? "Sign-in is unavailable right now" : "Sign in with Google: keep your scenes in your account and open them on any device", "aria-label": "Sign in with Google", on: { click: () => signIn() } }, h("span", { class: "acct-g", html: ICONS.google, "aria-hidden": "true" }), h("span", { class: "acct-signin-t", text: "Sign in" })))
	}
}
/** Google sign-in (the page goes to Google and comes back): the scene on the table is written first. Throws when it can't start. */
async function signInNow() {
	await autosave.flush({ now: true }) // (Google takes the page away for a moment: the scene is written first)
	await auth.signIn()
}
async function signIn() {
	try {
		await signInNow()
	} catch (e) {
		toast(`Couldn’t sign in: ${e.message}`)
	}
}
const aiSignIn = createAiSignIn({ auth, signIn: signInNow, toast })
window.sandboxLibrary.aiSignIn = aiSignIn // (for tests and the console)
let menu = null
let menuBtn = null
function openMenu(b) {
	closeMenu()
	const u = auth.user
	menuBtn = b
	const item = (ic, label, act) => h("button", { type: "button", role: "menuitem", tabindex: "-1", on: { click: () => (closeMenu(true), act()) } }, icon(ic, "ui-ic"), label)
	const del = store.backend().deleteAccount ? item("trash", "Delete account…", () => confirmDeleteAccount()) : null
	del?.classList.add("acct-danger-item")
	menu = h(
		"div",
		{ class: "ui-menu acct-menu", role: "menu", "aria-label": "Account" },
		h("div", { class: "acct-menu-who", role: "presentation" }, h("span", { class: "acct-avatar big", "aria-hidden": "true", text: u.initials }), h("span", {}, h("b", { text: u.name || "Signed in" }), h("small", { text: u.email || "" }))),
		h("hr", { "aria-hidden": "true" }),
		item("scenes", "My scenes", () => library.open()),
		item("signout", "Sign out", async () => {
			try {
				await autosave.flush({ now: true })
				await auth.signOut()
				toast("Signed out: My scenes is this browser’s again")
			} catch (e) {
				toast(`Couldn’t sign out: ${e.message}`)
			}
		}),
		del ? h("hr", { "aria-hidden": "true" }) : null,
		del
	)
	document.body.append(menu)
	const r = b.getBoundingClientRect()
	menu.style.top = `${Math.round(r.bottom + 6)}px`
	menu.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`
	b.setAttribute("aria-expanded", "true")
	menu.querySelector("button")?.focus()
	menu.addEventListener("keydown", (e) => {
		e.stopPropagation()
		const items = [...menu.querySelectorAll("button")]
		const i = items.indexOf(document.activeElement)
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault()
			items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus()
		} else if (e.key === "Escape") {
			e.preventDefault()
			closeMenu(true)
		} else if (e.key === "Tab") closeMenu()
	})
	setTimeout(() => document.addEventListener("pointerdown", outside, true), 0)
}
function outside(e) {
	if (menu && !menu.contains(e.target) && !menuBtn?.contains(e.target)) closeMenu()
}
function closeMenu(refocus = false) {
	if (!menu) return
	menu.remove()
	menu = null
	document.removeEventListener("pointerdown", outside, true)
	menuBtn?.setAttribute("aria-expanded", "false")
	if (refocus) menuBtn?.focus({ preventScroll: true })
}
addEventListener("resize", () => closeMenu())

// ---------------------------------------------------------------- Delete account… (typed confirmation; DELETE /api/scenes/me, then sign out)
const DELETED_KEY = "sandbox:account-deleted" // sessionStorage: said once after the reload that finishes a deletion
function confirmDeleteAccount() {
	const u = auth.user
	if (!u || document.querySelector("dialog.acct-del")) return
	const count = h("span", { text: "every scene in it" })
	const field = h("input", { type: "text", class: "acct-del-q", autocomplete: "off", spellcheck: "false", autocapitalize: "characters", "aria-describedby": "acct-del-p", enterkeyhint: "done" })
	const msg = h("p", { class: "acct-del-msg", role: "alert" })
	const cancel = h("button", { type: "button", class: "ghost", text: "Cancel", on: { click: () => done() } })
	const go = h("button", { type: "button", class: "acct-danger", text: "Delete account", disabled: true, on: { click: () => run() } })
	const dlg = h(
		"dialog",
		{ class: "ui-dialog acct-del", "aria-labelledby": "acct-del-t", "aria-describedby": "acct-del-p" },
		h(
			"div",
			{ class: "ui-card acct-del-card", tabindex: "-1" },
			h("button", { type: "button", class: "ui-x", "aria-label": "Close", title: "Close (Esc)", html: ICONS.close, on: { click: () => done() } }),
			h("span", { class: "acct-del-logo", html: ICONS.warn, "aria-hidden": "true" }),
			h("h2", { id: "acct-del-t", text: "Delete your account?" }),
			h("p", { id: "acct-del-p" }, "This deletes the account of ", h("b", { text: u.email || u.name || "this person" }), " and ", count, ", on every device, for good. It can’t be undone. Scenes kept in this browser stay here."),
			h("label", { class: "acct-del-l" }, h("span", { text: "Type DELETE to confirm" }), field),
			msg,
			h("div", { class: "acct-del-acts" }, cancel, go)
		)
	)
	let busy = false
	const done = () => {
		if (busy) return
		dlg.close()
		dlg.remove()
	}
	field.addEventListener("input", () => (go.disabled = field.value.trim().toUpperCase() !== "DELETE"))
	field.addEventListener("keydown", (e) => e.key === "Enter" && !go.disabled && (e.preventDefault(), run()))
	dlg.addEventListener("cancel", (e) => (e.preventDefault(), done()))
	dlg.addEventListener("keydown", (e) => e.stopPropagation())
	async function run() {
		if (busy) return
		busy = true
		go.disabled = cancel.disabled = field.disabled = true
		go.textContent = "Deleting…"
		msg.textContent = ""
		try {
			await autosave.flush({ now: true }) // (nothing still on its way to the account after it is gone)
			await store.backend().deleteAccount()
		} catch (e) {
			busy = false
			go.disabled = cancel.disabled = field.disabled = false
			go.textContent = "Delete account"
			msg.textContent = `Couldn’t delete the account: ${e.message}`
			return
		}
		busy = false
		done()
		try {
			await auth.signOut()
		} catch {}
		if (auth.state === "signed-in") {
			// (the sign-in is gone on the server, but this page couldn't tell the provider: a reload starts signed out)
			try {
				sessionStorage.setItem(DELETED_KEY, "1")
			} catch {}
			return location.reload()
		}
		toast("Your account and its scenes were deleted")
	}
	document.body.append(dlg)
	dlg.showModal()
	field.focus()
	store.backend().usage?.().then((x) => Number.isFinite(x?.scenes) && (count.textContent = x.scenes ? `its ${plural(x.scenes, "scene")}` : "everything in it (no scenes yet)"), () => {})
}

// ---------------------------------------------------------------- keys: O (or ⌘O) opens My scenes
addEventListener("keydown", (e) => {
	if (e.defaultPrevented || e.altKey || isTextual(e.target)) return
	const mod = MAC ? e.metaKey : e.ctrlKey
	if (e.key.toLowerCase() !== "o" || (e.metaKey || e.ctrlKey) !== mod || e.shiftKey) return
	if (!btn || btn.disabled || app()?.editor?.dragging || document.querySelector("dialog[open]")) return
	e.preventDefault()
	library.open()
})

// ---------------------------------------------------------------- start
function whenReady() {
	const ok = () => {
		const add = $("#add")
		return !!add && !add.disabled && !!app()?.scene && !!app()?.view
	}
	if (ok()) return Promise.resolve()
	return new Promise((resolve) => {
		const t = setInterval(() => ok() && (clearInterval(t), resolve()), 150)
	})
}
function main() {
	buildButton()
	syncButton()
	auth.onChange(() => {
		syncChip()
		syncButton()
	})
	auth.ready.then(syncChip)
	auth.ready.then(() => aiSignIn.install(), () => {})
	whenReady().then(async () => {
		await auth.ready.catch(() => {})
		await autosave.start()
		if (btn) btn.disabled = false
		syncButton()
		aiSignIn.resume() // (back from Google: the AI opens where the person left off)
		try {
			if (sessionStorage.getItem(DELETED_KEY)) (sessionStorage.removeItem(DELETED_KEY), toast("Your account and its scenes were deleted"))
		} catch {}
		const n = await autosave.adoptSaved()
		if (n) console.info(`My scenes: kept ${n} scene${n === 1 ? "" : "s"} saved before it existed`)
	})
	// the last change is written before the page goes (a reload, a closed tab, Google's sign-in page)
	const out = () => autosave.flush({ keepalive: true })
	addEventListener("pagehide", out)
	document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && out())
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, { once: true })
else main()
