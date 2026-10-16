// "Build with AI needs an account": on a deploy whose AI function requires sign-in (/api/scenes/me's ai.signInRequired, kept by ./auth.js),
// someone signed out who reaches for the AI gets a small sheet with Continue with Google, never the AI panel's error card. docs/ACCOUNTS.md §6.
//   const gate = createAiSignIn({ auth, signIn, toast })   // signIn(): account.js's own (the table is written first, then Google)
//   gate.install()   (once auth.ready has settled) catches the ways in, in the capture phase, before the app sees them:
//                    Edit with AI (#ai, and its key A), and New → Build with AI's Build button (and Enter in its box)
//   gate.resume()    after the way back from Google: the AI is opened where the person left off (the drawer, or New with their words)
// A backstop for every other way in: a POST to this origin's /api/ai/* answered 401 {code: "sign_in"} dispatches `sandbox:sign-in-needed`,
// and that shows the same sheet (signed in, it says the sign-in needs renewing). The sheet itself: .acct-sheet in ./account.css.
import { h, icon, ICONS, isTextual } from "./util.js"

const AFTER_KEY = "sandbox:ai-after-sign-in" // sessionStorage: {kind: "edit" | "new" | "ai", text?, at}: what the AI was about to do
const AFTER_MS = 15 * 60e3 // (a way back from Google older than this doesn't reopen anything)
const $ = (s) => document.querySelector(s)

export function createAiSignIn({ auth, signIn, toast = () => {} }) {
	const app = () => window.sandbox ?? null
	/** the AI can't be used by this person here until they sign in */
	const blocked = () => auth.aiSignInRequired && auth.state !== "signed-in"
	let dlg = null

	function close() {
		if (!dlg) return
		const d = dlg
		dlg = null
		if (d.open) d.close()
		d.remove()
	}
	/** intent: {kind: "edit" | "new" | "ai", text?}; renew: signed in, but the AI function said the sign-in is no longer good */
	function show(intent, { renew = false } = {}) {
		if (dlg) return
		const off = auth.state === "unavailable"
		const what = intent.kind === "edit" ? "Edit with AI" : "Build with AI"
		const title = renew ? "Sign in again to use the AI" : off ? `${what} is unavailable right now` : `${what} needs an account`
		const lede = renew
			? "Your sign-in has run out on this device. Sign in again with Google and carry on where you were."
			: off
				? "Signing in can’t be reached at the moment, and the AI on this site is for signed-in people. Everything else works as usual: try again in a little while."
				: "Sign in with Google to build and change scenes with AI. Your scenes are kept in your account too, so they open on any device."
		const go = async () => {
			try {
				sessionStorage.setItem(AFTER_KEY, JSON.stringify({ ...intent, at: Date.now() }))
			} catch {}
			close()
			try {
				if (renew) await auth.signOut().catch(() => {})
				await signIn()
			} catch (e) {
				forget()
				return toast(`Couldn’t sign in: ${e.message}`)
			}
			if (auth.state === "signed-in") resume() // (signed in without leaving the page: carry on at once)
		}
		const google = h("button", { type: "button", class: "acct-google acct-sheet-go", disabled: off, on: { click: go } }, h("span", { class: "acct-g", html: ICONS.google, "aria-hidden": "true" }), h("span", { text: renew ? "Sign in again with Google" : "Continue with Google" }))
		const later = h("button", { type: "button", class: "ui-link acct-sheet-later", text: off ? "OK" : "Not now", on: { click: () => close() } })
		dlg = h(
			"dialog",
			{ class: "ui-dialog acct-sheet", "aria-labelledby": "acct-sheet-t", "aria-describedby": "acct-sheet-p" },
			h(
				"div",
				{ class: "ui-card acct-sheet-card", tabindex: "-1" },
				h("button", { type: "button", class: "ui-x", "aria-label": "Close", title: "Close (Esc)", html: ICONS.close, on: { click: () => close() } }),
				h("span", { class: "acct-sheet-logo", html: ICONS.ai, "aria-hidden": "true" }),
				h("h2", { id: "acct-sheet-t", text: title }),
				h("p", { id: "acct-sheet-p", text: lede }),
				off ? null : google,
				off ? null : h("p", { class: "acct-sheet-note" }, icon("check", "acct-sheet-note-ic"), "You’ll come right back. The scene on the table is kept."),
				later
			)
		)
		dlg.addEventListener("cancel", (e) => (e.preventDefault(), close()))
		dlg.addEventListener("click", (e) => e.target === dlg && close())
		dlg.addEventListener("keydown", (e) => e.stopPropagation()) // (the page under the sheet must not see its keys)
		document.body.append(dlg)
		dlg.showModal()
		;(off ? later : google).focus({ preventScroll: true })
	}

	function forget() {
		try {
			sessionStorage.removeItem(AFTER_KEY)
		} catch {}
	}
	/** Back from Google (or signed in in place): the AI opens where the person left off. Nothing is built by itself: they press Build. */
	function resume() {
		let intent = null
		try {
			intent = JSON.parse(sessionStorage.getItem(AFTER_KEY))
		} catch {}
		forget()
		if (!intent || auth.state !== "signed-in" || !(Date.now() - (intent.at ?? 0) < AFTER_MS)) return false
		if (intent.kind === "new") {
			const box = $("dialog.np-dialog[open] .np-input")
			if (box) {
				if (intent.text && !box.value) box.value = intent.text
				box.focus()
			} else app()?.openNew?.({ ai: true, ...(intent.text ? { text: intent.text } : {}) })
			toast(intent.text ? "Signed in. Press Build new scene to go on." : "Signed in: Build with AI is ready")
		} else {
			const b = $("#ai")
			if (b && !b.disabled && b.getAttribute("aria-expanded") !== "true") b.click()
			toast("Signed in: Edit with AI is ready")
		}
		return true
	}

	// ---------------------------------------------------------------- the ways in
	const npText = () => $("dialog.np-dialog[open] .np-input")?.value ?? ""
	function onClick(e) {
		if (!blocked()) return
		const t = e.target instanceof Element ? e.target : null
		const edit = t?.closest("#ai")
		const build = t?.closest("dialog.np-dialog .np-ai")
		if ((!edit && !build) || edit?.disabled || build?.disabled || edit?.getAttribute("aria-expanded") === "true") return // (closing the drawer is always fine)
		e.preventDefault()
		e.stopImmediatePropagation()
		show(build ? { kind: "new", text: npText() } : { kind: "edit" })
	}
	function onKey(e) {
		if (!blocked() || e.defaultPrevented || e.isComposing || e.keyCode === 229) return
		const t = e.target instanceof Element ? e.target : null
		if (e.key === "Enter" && !e.shiftKey && t?.matches("dialog.np-dialog .np-input")) {
			if (!t.value.trim() && !$("dialog.np-dialog .np-thumb")) return // (nothing to build yet: the dialog's own rule)
			e.preventDefault()
			e.stopImmediatePropagation()
			return show({ kind: "new", text: t.value })
		}
		// A: the app's key for Edit with AI (web/app.js), with the same exceptions: typing, a dialog or the catalog has the keys, a drag
		if (String(e.key ?? "").toLowerCase() !== "a" || e.metaKey || e.ctrlKey || e.altKey || isTextual(t) || t?.closest("dialog, #catalog") || document.querySelector("dialog[open]")) return
		if ($("#ai")?.disabled || app()?.editor?.dragging) return
		e.preventDefault()
		e.stopImmediatePropagation()
		show({ kind: "edit" })
	}
	/** The backstop: whatever path a POST to /api/ai/* took, a final 401 sign_in brings up the sheet (wraps the outermost fetch, so the
	 *  sign-in provider's one retry with a fresh token has already happened). */
	function watch() {
		if (window.__sandboxAiSignInWatch) return
		window.__sandboxAiSignInWatch = true
		const inner = window.fetch.bind(window)
		window.fetch = async function fetchWatchingAi(input, init) {
			const r = await inner(input, init)
			if (r.status === 401) {
				try {
					const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? ""), location.href)
					const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
					if (url.origin === location.origin && url.pathname.startsWith("/api/ai/") && method === "POST")
						r.clone().json().then((j) => j?.code === "sign_in" && dispatchEvent(new CustomEvent("sandbox:sign-in-needed", { detail: { error: j.error ?? null } })), () => {})
				} catch {}
			}
			return r
		}
	}

	let installed = false
	return {
		install() {
			if (installed || !auth.configured) return
			installed = true
			document.addEventListener("click", onClick, true)
			addEventListener("keydown", onKey, true)
			watch()
			addEventListener("sandbox:sign-in-needed", () => show({ kind: "ai" }, { renew: auth.state === "signed-in" }))
		},
		resume,
		show,
		close,
		get open() {
			return !!dlg
		}
	}
}
