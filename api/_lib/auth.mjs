// Who is calling: a Clerk session token (an RS256 JWT) from `Authorization: Bearer <token>`, verified with node:crypto alone, following
// Clerk's "manual JWT verification": RS256 only; the key by `kid` from the instance's public JWKS (https://<Frontend API>/.well-known/jwks.json,
// cached an hour; an unknown kid refetches at most once a minute) or CLERK_JWT_KEY (the PEM) when set; iss = https://<Frontend API>;
// exp and nbf with 5 s of leeway; azp (when present) one of this app's origins; sts (when present) "active". The Frontend API host is read
// from the publishable key (pk_test_/pk_live_ + base64("<host>$")). No cookie is ever read. docs/ACCOUNTS.md §1.4.
import { createPublicKey, verify as cryptoVerify } from "node:crypto"
import { HttpError, header } from "./http.mjs"
import { originAllowed } from "./origin.mjs"

const LEEWAY_S = 5
const JWKS_TTL_MS = 3600_000
const JWKS_REFETCH_MS = 60_000
const FETCH_TIMEOUT_MS = 3000
const MAX_TOKEN = 8192

/** {host, instance: "test" | "live"} of a Clerk publishable key, or null when it is not one. */
export function parsePublishableKey(pk) {
	const m = typeof pk === "string" ? pk.trim().match(/^pk_(test|live)_([A-Za-z0-9+/_-]+={0,2})$/) : null
	if (!m) return null
	let text
	try {
		text = Buffer.from(m[2].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
	} catch {
		return null
	}
	if (!text.endsWith("$")) return null
	const host = text.slice(0, -1).toLowerCase()
	if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/.test(host)) return null
	return { host, instance: m[1] }
}

/** The Clerk settings of this deployment, or null when it has no valid publishable key. */
export function clerkSettings(env = process.env) {
	const publishableKey = (env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || env.CLERK_PUBLISHABLE_KEY || "").trim()
	const parsed = parsePublishableKey(publishableKey)
	if (!parsed) return null
	const secretKey = /^sk_(test|live)_\S{8,}$/.test(env.CLERK_SECRET_KEY ?? "") ? env.CLERK_SECRET_KEY : null
	const jwtKey = /-----BEGIN PUBLIC KEY-----/.test(env.CLERK_JWT_KEY ?? "") ? env.CLERK_JWT_KEY.replace(/\\n/g, "\n") : null
	return { publishableKey, host: parsed.host, instance: parsed.instance, iss: `https://${parsed.host}`, jwks: `https://${parsed.host}/.well-known/jwks.json`, secretKey, jwtKey }
}

/** The bearer token of the request, or null. */
export function bearerToken(req) {
	const m = (header(req, "authorization") ?? "").match(/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/i)
	return m && m[1].length <= MAX_TOKEN ? m[1] : null
}

/** A token that does not let its holder in: 401 sign_in (expired: true asks the page to refresh its token once and try again). */
export class AuthError extends HttpError {
	constructor(reason, expired = false) {
		super(401, "sign_in", expired ? "Your sign-in has expired: sign in again" : "Sign in to continue", { expired })
		this.reason = reason
	}
}

// ---------------------------------------------------------------- the instance's public keys
const jwksCache = new Map() // jwks URL -> {keys: Map(kid -> KeyObject), at, tried}
export const _jwksCache = jwksCache // (tests)

async function fetchJwks(url, fetchImpl) {
	let r
	try {
		r = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" } })
	} catch {
		throw new HttpError(503, "unavailable", "Sign-in can't be checked right now (the sign-in service didn't answer). Try again.", { retryable: true })
	}
	if (!r.ok) throw new HttpError(503, "unavailable", "Sign-in can't be checked right now. Try again.", { retryable: true })
	const j = await r.json().catch(() => null)
	const keys = new Map()
	for (const k of Array.isArray(j?.keys) ? j.keys : []) {
		if (k?.kty !== "RSA" || typeof k.kid !== "string" || (k.use && k.use !== "sig") || (k.alg && k.alg !== "RS256")) continue
		try {
			keys.set(k.kid, createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e }, format: "jwk" }))
		} catch {}
	}
	return keys
}

async function keyFor(kid, settings, fetchImpl, now) {
	if (settings.jwtKey) {
		try {
			return createPublicKey(settings.jwtKey)
		} catch {
			throw new HttpError(503, "not_configured", "Sign-in is not set up correctly on this deployment (CLERK_JWT_KEY)")
		}
	}
	let c = jwksCache.get(settings.jwks)
	const stale = !c || now - c.at > JWKS_TTL_MS
	if (stale || (!c.keys.has(kid) && now - c.tried > JWKS_REFETCH_MS)) {
		const tried = now
		try {
			const keys = await fetchJwks(settings.jwks, fetchImpl)
			c = { keys, at: now, tried }
			jwksCache.set(settings.jwks, c)
		} catch (e) {
			if (!c) throw e
			c.tried = tried // (keep the keys we had; an unknown kid fails below)
		}
	}
	return c.keys.get(kid) ?? null
}

const b64json = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"))

/**
 * {iss, sub, sid} of a valid session token, else throws AuthError (401) — or HttpError 503 when the keys can't be fetched.
 * opts: {env, now (ms), fetch}
 */
export async function verifySessionToken(token, { env = process.env, now = Date.now(), fetch: fetchImpl = globalThis.fetch } = {}) {
	const settings = clerkSettings(env)
	if (!settings) throw new HttpError(503, "not_configured", "Accounts are not switched on for this deployment")
	if (typeof token !== "string" || token.length > MAX_TOKEN) throw new AuthError("no token")
	const parts = token.split(".")
	if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) throw new AuthError("not a JWT")
	let head, claims
	try {
		head = b64json(parts[0])
		claims = b64json(parts[1])
	} catch {
		throw new AuthError("unreadable")
	}
	if (!head || typeof head !== "object" || head.alg !== "RS256") throw new AuthError("algorithm")
	if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new AuthError("claims")
	if (!settings.jwtKey && typeof head.kid !== "string") throw new AuthError("no kid")
	const key = await keyFor(head.kid, settings, fetchImpl, now)
	if (!key) throw new AuthError("unknown kid")
	let ok = false
	try {
		ok = cryptoVerify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"))
	} catch {
		ok = false
	}
	if (!ok) throw new AuthError("signature")
	const t = now / 1000
	if (claims.iss !== settings.iss) throw new AuthError("issuer")
	if (typeof claims.exp !== "number" || claims.exp + LEEWAY_S <= t) throw new AuthError("expired", true)
	if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - LEEWAY_S > t)) throw new AuthError("not yet valid")
	if (typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(claims.sub)) throw new AuthError("subject")
	if (claims.azp !== undefined && claims.azp !== null && claims.azp !== "" && !originAllowed(claims.azp, env)) throw new AuthError("authorized party")
	if (claims.sts !== undefined && claims.sts !== null && claims.sts !== "active") throw new AuthError("session status")
	return { iss: claims.iss, sub: claims.sub, sid: typeof claims.sid === "string" ? claims.sid : null }
}
