// Can this page use the AI right now? Said up front, before anyone types (docs/ACCOUNTS.md §6, §14; ai/DESIGN.md §13.7):
//   "ok"       the AI answers here
//   "off"      this deployment has no AI (an /api/ai answer said not_configured, a static preview's 503, no function at all; or /api/scenes/me says so)
//   "sign_in"  this deployment's AI needs a signed-in person and nobody is (the accounts layer: window.sandboxLibrary.auth)
//   "quota"    today's (or this hour's) allowance is used up, until resetsAt (a 403 quota / site_quota answer, or /api/scenes/me's aiToday)
//   "access"   no access to it here (an invite link that ran out, an account that may not use it)
//   const access = aiAccess()            // one per page
//   access.state                         // {kind, title, text, resetsAt}
//   access.onChange(fn) -> unsubscribe   access.check() (once: what the deployment says)   access.note(aiError)   access.signIn(intent)
// Where it asks: on this machine (the local server: localhost, 127.x, [::1]) nothing, as the accounts layer does (?accounts=1 asks anyway). On a
// deploy: GET /api/scenes/me (with the person's token when signed in: aiToday), then one POST /api/ai/edit with an empty body, which the hosted
// function refuses before any model or queue: 400 means the AI is there, 503 not_configured / unavailable or 404 that it is not. That probe is never
// sent while sign-in is required and nobody is signed in (the sign-in sheet is the answer then). Kept for this tab (sessionStorage); a used-up
// allowance for this browser until it resets (localStorage). Both read and written in try/catch: the page works without them.
// (no imports: web/app.js loads this at start for the Edit with AI button, without the AI's own modules)

const LOCAL = typeof location !== "undefined" && /^((.+\.)?localhost|127(\.\d+){3}|\[::1\])$/i.test(location.hostname)
const PARAMS = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams()
const OFF_KEY = "sandbox:ai-off"
const QUOTA_KEY = "sandbox:ai-quota"
const OFF_TEXT = "This copy of the sandbox runs without the AI service, so Edit with AI and Build with AI are switched off here. Everything else works: add real objects from the catalog (/), or start from an example (New)."
const read = (store, k) => {
	try {
		return JSON.parse(store.getItem(k))
	} catch {
		return null
	}
}
const write = (store, k, v) => {
	try {
		if (v === null) store.removeItem(k)
		else store.setItem(k, JSON.stringify(v))
	} catch {}
}
const ss = () => (typeof sessionStorage !== "undefined" ? sessionStorage : null)
const ls = () => (typeof localStorage !== "undefined" ? localStorage : null)

export const SIGN_IN_WORDS = "Sign in with Google to use AI"
export const OFF_WORDS = "AI isn't available on this deployment"
/** When an allowance comes back, in the person's own clock: "7:00 PM", "tomorrow at 1:00 AM", "Fri at 7:00 PM". null without a usable time. */
export function resetWords(resetsAt, nowMs = Date.now()) {
	const t = Date.parse(resetsAt ?? "")
	if (!Number.isFinite(t)) return null
	const d = new Date(t)
	const n = new Date(nowMs)
	let time
	try {
		time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
	} catch {
		time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
	}
	time = time.replace(/\s+(?=[AaPp]\.?\s?[Mm]\.?$)/, "\u00a0") // ("10:58 PM" never splits across lines)
	const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
	const days = Math.round((day(d) - day(n)) / 86400000)
	if (days <= 0) return time
	if (days === 1) return `tomorrow at ${time}`
	try {
		return `${d.toLocaleDateString([], { weekday: "short" })} at ${time}`
	} catch {
		return time
	}
}
/** resetWords' answer after "resets" / "back": "at 7:00 PM", "tomorrow at 1:00 AM", "Fri at 7:00 PM". */
export const atWhen = (when) => (/\bat\b/.test(when) ? when : `at ${when}`)
/** A quota refusal in words: "You've used today's AI allowance — resets at 7:00 PM" (this hour's, or the site's, when that is the limit). */
export function quotaWords(body = {}, nowMs = Date.now()) {
	const when = resetWords(body?.resetsAt, nowMs)
	const site = body?.code === "site_quota" || body?.scope === "site"
	const hour = !site && (body?.scope === "hour" || /\bhour/i.test(String(body?.error ?? "")))
	const head = site ? "Today's AI allowance for this site is used up" : hour ? "You've used this hour's AI allowance" : "You've used today's AI allowance"
	return when ? `${head} — resets ${atWhen(when)}` : `${head} — it resets ${hour ? "on the hour" : "at midnight UTC"}`
}

let single = null
export function aiAccess() {
	return (single ??= create())
}

function create() {
	const listeners = new Set()
	let off = read(ss(), OFF_KEY) // {code, at}
	let quota = read(ls(), QUOTA_KEY) // {resetsAt, scope, code}
	let access = null // {text}
	let checked = null
	let timer = 0
	const auth = () => (typeof window !== "undefined" ? window.sandboxLibrary?.auth ?? null : null)
	const who = () => auth()?.user?.id ?? null
	const quotaLive = () => {
		if (!quota) return false
		// (someone else signed in on this browser: their allowance is their own)
		if ((quota.who ?? null) !== who()) return false
		const t = Date.parse(quota.resetsAt ?? "")
		if (Number.isFinite(t) && t <= Date.now()) {
			quota = null
			write(ls(), QUOTA_KEY, null)
			return false
		}
		return true
	}
	function state() {
		if (off) return { kind: "off", title: OFF_WORDS, text: OFF_TEXT }
		const a = auth()
		if (a?.aiSignInRequired && a.state !== "signed-in") return a.state === "unavailable" ? { kind: "sign_in", title: "AI is unavailable right now", text: "Signing in can’t be reached at the moment, and the AI on this site is for signed-in people. Everything else works: try again in a little while.", unavailable: true } : { kind: "sign_in", title: SIGN_IN_WORDS, text: "The AI on this site is for signed-in people. You’ll come right back, and what you typed is kept." }
		if (quotaLive()) return { kind: "quota", title: quotaWords(quota), text: "Everything else works as usual; the AI is back then.", resetsAt: quota.resetsAt ?? null, when: resetWords(quota.resetsAt) }
		if (access) return { kind: "access", title: "No access to the AI here", text: access.text }
		return { kind: "ok" }
	}
	let last = JSON.stringify(state())
	function emit() {
		const now = JSON.stringify(state())
		if (now === last) return
		last = now
		for (const f of listeners) {
			try {
				f(state())
			} catch (e) {
				console.warn("ai access:", e)
			}
		}
	}
	function armTimer() {
		clearTimeout(timer)
		const t = Date.parse(quota?.resetsAt ?? "")
		if (Number.isFinite(t)) timer = setTimeout(() => (quotaLive(), emit()), Math.min(2 ** 31 - 1, Math.max(1000, t - Date.now() + 500)))
	}
	if (quota) armTimer()
	// (the accounts layer comes up after the app: its sign-in state, as it settles and as it changes)
	let hooked = false
	function hookAuth() {
		const a = auth()
		if (!a || hooked) return
		hooked = true
		a.onChange?.(() => emit())
		Promise.resolve(a.ready).then(() => emit(), () => {})
	}
	hookAuth()

	/** What the deployment says, once per page (nothing is asked on this machine). */
	function check() {
		hookAuth()
		if (checked) return checked
		checked = (async () => {
			if ((LOCAL && !PARAMS.has("accounts")) || PARAMS.has("accountmock") || PARAMS.get("aimock") === "1") return
			const a = auth()
			try {
				await Promise.race([Promise.resolve(a?.ready), new Promise((r) => setTimeout(r, 6000))])
			} catch {}
			hookAuth()
			let me = null
			try {
				const token = a?.state === "signed-in" ? await a.getToken?.().catch(() => null) : null
				const r = await fetch("/api/scenes/me", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
				me = r.ok ? await r.json().catch(() => null) : null
			} catch {}
			const ai = me?.ai ?? null
			if (ai && (ai.available === false || ai.enabled === false || ai.configured === false || ai.state === "off" || ai.code === "not_configured")) return note({ kind: "off", code: "not_configured" })
			const today = me?.aiToday
			const used = (n, max) => Number.isFinite(n) && Number.isFinite(max) && n >= max
			if (today && (used(today.usd, today.maxUsd) || used(today.steps, today.maxSteps))) note({ kind: "quota", code: "quota", scope: "user", resetsAt: today.resetsAt ?? null })
			// (signed out where sign-in is required: the sign-in sheet answers; a probe would only open it unasked)
			if (a?.aiSignInRequired && a.state !== "signed-in") return
			try {
				const r = await fetch("/api/ai/edit", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", body: "{}" })
				const j = await r.json().catch(() => null)
				if (r.status === 404 || (r.status === 503 && (j?.code === "not_configured" || (j?.code === "unavailable" && j?.retryable === false)))) note({ kind: "off", code: j?.code ?? "not_found" })
				else if (r.status === 401 && j?.code === "unauthorized") note({ kind: "access", message: "This page has no access to the AI: open the invite link again" })
			} catch {}
		})()
		return checked
	}
	/** An AI answer that says something about access (an AiError of kind off / quota / sign_in / access). */
	function note(e) {
		if (!e) return
		if (e.kind === "off") {
			off = { code: e.code ?? "not_configured", at: Date.now() }
			write(ss(), OFF_KEY, off)
		} else if (e.kind === "quota") {
			quota = { resetsAt: e.resetsAt ?? null, scope: e.scope ?? (e.code === "site_quota" ? "site" : "user"), code: e.code ?? "quota", who: who() }
			// (no time given: an hour, so the box comes back by itself)
			if (!Number.isFinite(Date.parse(quota.resetsAt ?? ""))) quota.resetsAt = new Date(Date.now() + 3600e3).toISOString()
			write(ls(), QUOTA_KEY, quota)
			armTimer()
		} else if (e.kind === "access") access = { text: e.message ?? "The AI refused this page." }
		emit()
	}
	/** The accounts layer's sign-in sheet (Continue with Google; the person comes back where they were, with what they typed). */
	function signIn(intent = { kind: "edit" }) {
		const g = typeof window !== "undefined" ? window.sandboxLibrary?.aiSignIn : null
		if (g?.show) return (g.show(intent), true)
		return false
	}
	return {
		get state() {
			return state()
		},
		check,
		note,
		signIn,
		/** for tests: forget what was learnt */
		reset() {
			off = null
			quota = null
			access = null
			write(ss(), OFF_KEY, null)
			write(ls(), QUOTA_KEY, null)
			emit()
		},
		onChange(f) {
			listeners.add(f)
			return () => listeners.delete(f)
		}
	}
}
