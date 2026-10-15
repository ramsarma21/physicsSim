// Sign in with Google through Clerk (docs/ACCOUNTS.md 1.1, 1.3, 7.1). ./auth.js loads this only on a deployment whose /api/scenes/me names
// a Clerk publishable key; everywhere else (the local server, the static preview, a deploy without accounts) it is never imported.
//   import { createClerkProvider } from "./clerk.js"
//   const provider = await createClerkProvider({ provider: "clerk", publishableKey })   // a provider, or null where it cannot run
// The provider ./auth.js expects:
//   provider.name                         "clerk"
//   provider.user                         {id, name, email} of the person signed in, or null (initials are worked out by auth.js)
//   provider.signIn()                     Continue with Google: clerk.client.signIn.authenticateWithRedirect({strategy: "oauth_google",
//                                         redirectUrl: <this address>&auth=callback, redirectUrlComplete: <this address>}); the page leaves
//                                         (the table is autosaved first: ./autosave.js flushes on pagehide). A first-time Google sign-in
//                                         becomes a sign-up by itself.
//   provider.signOut()                    clerk.signOut() without leaving the page
//   provider.getToken({skipCache})        clerk.session.getToken(): the short-lived Bearer token for /api/scenes and /api/ai (null signed out)
//   provider.onChange(fn)                 clerk.addListener: sign-in, sign-out, a session that ended
//   provider.notice                       a sentence when the return from Google failed ("Couldn't finish signing in…"), else null
// Loading: the vendored, pinned @clerk/clerk-js 6.39.0 (its no-remotely-hosted-code build; tools/vendor-clerk.mjs) through the importmap
// ("clerk-js"), with telemetry off and Clerk's navigations kept inside this page (history.replaceState, never a reload). When the address has
// ?auth=callback (the way back from Google), clerk.handleRedirectCallback() finishes the sign-in first, then the address is put back as it
// was before leaving (kept in sessionStorage: ?profile= and the rest survive). No Clerk UI is loaded: the buttons and menus are the app's own.
// Build with AI: while someone is signed in, the page's POSTs to its own /api/ai/<step> carry `Authorization: Bearer <token>` (a small wrapper
// around window.fetch that touches nothing else), and a 401 that says the token expired is tried once more with a fresh one. The AI function
// (api/_lib/ai-gate.mjs) counts each step against that person's allowance.

const CALLBACK = "auth" // ?auth=callback
const BACK_KEY = "sandbox:auth-back"
const LOAD_TIMEOUT_MS = 6000

/** Clerk's navigations stay in this page: same origin -> the address bar only; elsewhere (Clerk's hosted pages) -> a real navigation. */
function navigate(to) {
	let u
	try {
		u = new URL(to, location.href)
	} catch {
		return
	}
	if (u.protocol !== "https:" && u.protocol !== "http:") return
	if (u.origin === location.origin) history.replaceState(history.state, "", u.pathname + u.search + u.hash)
	else location.assign(u.href)
}
/** This address without ?auth=callback. */
function withoutCallback(href = location.href) {
	const u = new URL(href)
	u.searchParams.delete(CALLBACK)
	return u.href
}
/** Where to come back to after Google: the address saved before leaving (same origin only), else this one. */
function backAddress() {
	let saved = null
	try {
		saved = sessionStorage.getItem(BACK_KEY)
	} catch {}
	try {
		if (saved && new URL(saved).origin === location.origin) return withoutCallback(saved)
	} catch {}
	return withoutCallback()
}
const timeout = (p, ms, what) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms))])

/** POSTs to this origin's /api/ai/* carry the signed-in person's token (installed once). */
function attachTokenToAi(getToken) {
	if (window.__sandboxAiAuth) return
	window.__sandboxAiAuth = true
	const original = window.fetch.bind(window)
	window.fetch = async function fetchWithAccount(input, init) {
		let headers = null
		try {
			const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? ""), location.href)
			const method = String(init?.method ?? "GET").toUpperCase()
			const ours = url.origin === location.origin && url.pathname.startsWith("/api/ai/") && method === "POST" && !(input instanceof Request)
			if (ours) {
				headers = new Headers(init?.headers)
				if (headers.has("authorization")) headers = null
			}
		} catch {
			headers = null
		}
		if (!headers) return original(input, init)
		const token = await getToken().catch(() => null)
		if (!token) return original(input, init)
		headers.set("Authorization", `Bearer ${token}`)
		let r = await original(input, { ...init, headers })
		if (r.status === 401 && typeof init?.body === "string") {
			const j = await r.clone().json().catch(() => null)
			if (j?.expired) {
				const fresh = await getToken({ skipCache: true }).catch(() => null)
				if (fresh) {
					headers.set("Authorization", `Bearer ${fresh}`)
					r = await original(input, { ...init, headers })
				}
			}
		}
		return r
	}
}

function say(text) {
	const t = document.querySelector("#toast")
	if (!t) return
	t.textContent = text
	t.hidden = false
	setTimeout(() => {
		if (t.textContent === text) t.hidden = true
	}, 5000)
}

export async function createClerkProvider(config) {
	const key = String(config?.publishableKey ?? "")
	if (config?.provider !== "clerk" || !/^pk_(test|live)_[A-Za-z0-9+/=_-]+$/.test(key)) return null
	const { Clerk } = await import("clerk-js") // (the vendored SDK: the importmap's "clerk-js"; a page without it stays local)
	const clerk = new Clerk(key)
	await timeout(clerk.load({ telemetry: false, routerPush: navigate, routerReplace: navigate }), LOAD_TIMEOUT_MS, "Loading sign-in")

	let notice = null
	if (new URL(location.href).searchParams.get(CALLBACK) === "callback") {
		const back = backAddress()
		try {
			await clerk.handleRedirectCallback({ signInFallbackRedirectUrl: back, signUpFallbackRedirectUrl: back, signInForceRedirectUrl: back, signUpForceRedirectUrl: back }, async (to) => navigate(to))
		} catch (e) {
			console.warn("account: the return from Google failed:", e?.errors?.[0]?.longMessage ?? e?.message ?? e)
		}
		if (new URL(location.href).searchParams.has(CALLBACK)) navigate(back) // (the address as it was before leaving)
		try {
			sessionStorage.removeItem(BACK_KEY)
		} catch {}
		if (!clerk.user) {
			notice = "Couldn’t finish signing in with Google. Try Sign in again."
			say(notice)
		}
	}

	const user = () => {
		const u = clerk.user
		if (!u) return null
		const name = u.fullName || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || null
		const email = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses?.[0]?.emailAddress ?? null
		return { id: u.id, name, email }
	}
	async function getToken(opts) {
		if (!clerk.session) return null
		try {
			return (await clerk.session.getToken(opts?.skipCache ? { skipCache: true } : undefined)) ?? null
		} catch (e) {
			throw new Error(`Your sign-in couldn’t be refreshed (${e?.message ?? "no answer"}). Check the connection and try again.`)
		}
	}
	attachTokenToAi(getToken)

	return {
		name: "clerk",
		get user() {
			return user()
		},
		get notice() {
			return notice
		},
		async signIn() {
			if (clerk.user) return
			const signIn = clerk.client?.signIn
			if (!signIn?.authenticateWithRedirect) throw new Error("Sign-in isn’t ready yet. Try again in a moment.")
			const here = withoutCallback()
			try {
				sessionStorage.setItem(BACK_KEY, here)
			} catch {}
			const callback = new URL(here)
			callback.searchParams.set(CALLBACK, "callback")
			callback.hash = ""
			await signIn.authenticateWithRedirect({ strategy: "oauth_google", redirectUrl: callback.href, redirectUrlComplete: here })
		},
		async signOut() {
			await clerk.signOut(() => {}) // (a callback instead of Clerk's navigation: the page stays as it is)
		},
		getToken,
		onChange(fn) {
			const off = clerk.addListener(() => fn())
			return typeof off === "function" ? off : () => {}
		},
	}
}
