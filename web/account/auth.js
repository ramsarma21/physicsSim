// Who is signed in, if this deployment has accounts at all. The account chip and My scenes read only this; the sign-in itself is the
// provider's (./clerk.js on a deploy with Clerk; ./dev-mock.js with ?accountmock=1 for tests and demos of the signed-in screens).
//   const auth = createAuth()
//   await auth.ready
//   auth.state      "loading" | "local" (no accounts here: nothing about signing in shows) | "signed-out" | "signed-in" | "unavailable"
//   auth.user       {id, name, email, initials} | null
//   auth.signIn()   (Google: the page goes to Google and comes back)   auth.signOut()   auth.getToken({skipCache}) -> session token | null
//   auth.onChange(fn) -> unsubscribe
//   auth.aiSignInRequired   this deployment's Build with AI needs a signed-in person (/api/scenes/me's ai.signInRequired)
// Where accounts are looked for: only off this machine (a deploy). There, GET /api/scenes/me answers {accounts: {provider, publishableKey} | null,
// storage, ai: {signInRequired}} (docs/ACCOUNTS.md 4.2); no answer, 404 or 503 means "local", and so does storage: false (sign-in with nowhere
// to keep the scenes would only break My scenes: the server says accounts: null then too). On localhost (the Python server, the static preview) nothing is asked, so the
// local server never sees a request it doesn't have. ?accounts=1 asks anyway (testing a local stand-in of the function).
// A provider: {name, user, signIn(), signOut(), getToken(opts), onChange(fn)}; createXProvider(config) resolves to one, or to null when it
// cannot run here (the page then stays local).
import { LOCAL_HOST, PARAMS } from "./util.js"

const PROVIDER_TIMEOUT_MS = 6000

function initialsOf(name, email) {
	const words = String(name || "").trim().split(/\s+/).filter(Boolean)
	if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
	return String(email || "?")[0].toUpperCase()
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms))])

export function createAuth() {
	let state = "loading"
	let provider = null
	let reason = ""
	let config = null // what /api/scenes/me said (or the mock's stand-in)
	const listeners = new Set()
	const emit = () => {
		for (const f of listeners) {
			try {
				f(api)
			} catch (e) {
				console.warn("account:", e)
			}
		}
	}
	const set = (s) => {
		if (s !== state) {
			state = s
			emit()
		}
	}
	function sync() {
		set(provider?.user ? "signed-in" : "signed-out")
	}

	async function start() {
		try {
			if (PARAMS.has("accountmock")) {
				const m = await import("./dev-mock.js") // (development only: not in the build; on a deploy this import fails and the page stays local)
				provider = await m.createMockProvider({ signedIn: PARAMS.get("accountmock") === "signedin" })
				config = provider.config ?? { storage: true, ai: { signInRequired: true } }
			} else {
				if (LOCAL_HOST && !PARAMS.has("accounts")) return set("local")
				const r = await fetch("/api/scenes/me", { cache: "no-store", headers: { Accept: "application/json" }, credentials: "same-origin" }).catch(() => null)
				const j = r?.ok ? await r.json().catch(() => null) : null
				const accounts = j?.accounts
				if (!accounts) return set("local")
				if (j.storage === false) {
					reason = "accounts need the database (storage: false)"
					return set("local")
				}
				if (accounts.provider !== "clerk") {
					reason = `unknown sign-in provider ${accounts.provider}`
					return set("local")
				}
				config = j
				const m = await import("./clerk.js")
				provider = await withTimeout(m.createClerkProvider(accounts), PROVIDER_TIMEOUT_MS, "Sign-in")
				if (!provider) return set("local") // (the provider isn't built into this version yet)
			}
			provider.onChange?.(sync)
			sync()
		} catch (e) {
			reason = e?.message ?? String(e)
			console.warn("account: sign-in is unavailable:", reason)
			set(provider || !LOCAL_HOST ? "unavailable" : "local")
		}
	}

	const api = {
		get state() {
			return state
		},
		/** the sign-in is available (whether or not someone is signed in) */
		get configured() {
			return state === "signed-out" || state === "signed-in" || state === "unavailable"
		},
		get user() {
			const u = state === "signed-in" ? provider?.user : null
			return u ? { ...u, initials: u.initials || initialsOf(u.name, u.email) } : null
		},
		get reason() {
			return reason
		},
		get providerName() {
			return provider?.name ?? null
		},
		/** Build with AI needs a signed-in person here (a deploy with accounts whose AI function requires sign-in) */
		get aiSignInRequired() {
			return !!config?.ai?.signInRequired && (state === "signed-out" || state === "signed-in" || state === "unavailable")
		},
		ready: null,
		async signIn() {
			if (!provider) throw new Error("Sign-in isn’t available here")
			await provider.signIn()
			sync()
		},
		async signOut() {
			await provider?.signOut()
			sync()
		},
		async getToken(opts) {
			return state === "signed-in" ? ((await provider?.getToken?.(opts)) ?? null) : null
		},
		onChange(f) {
			listeners.add(f)
			return () => listeners.delete(f)
		}
	}
	api.ready = start()
	return api
}
