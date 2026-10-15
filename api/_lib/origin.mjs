// Which origins are this app's own: the same rules as api/ai/[step].mjs (ALLOWED_ORIGINS plus, on Vercel, this deployment's own URLs).
// Used for the writes' Origin check and for the session token's `azp` (the origin Clerk issued it to). docs/ACCOUNTS.md §1.4, §4.1.
import { header } from "./http.mjs"

const norm = (s) => String(s ?? "").trim().replace(/\/+$/, "").toLowerCase()

/** The origins allowed to call: ALLOWED_ORIGINS plus, on Vercel, this deployment's own URLs. */
export function allowedOrigins(env = process.env) {
	const list = (env.ALLOWED_ORIGINS ?? "").split(",").map(norm).filter(Boolean)
	for (const k of ["VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) if (env[k]) list.push(`https://${norm(env[k]).replace(/^https?:\/\//, "")}`)
	return [...new Set(list)]
}

/** A page on this machine (tests, `vercel dev`, the static preview): accepted only off Vercel. */
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d{1,5})?$/

/** Is this origin one of the app's own? (an empty origin is not) */
export function originAllowed(origin, env = process.env) {
	const o = norm(origin)
	if (!o) return false
	if (allowedOrigins(env).includes(o)) return true
	return !env.VERCEL && LOCAL.test(o)
}

/** Why a write from this caller is refused (403), or null. On Vercel: an Origin of the app's own, and Sec-Fetch-Site same-origin when sent. */
export function writeOriginProblem(req, env = process.env) {
	const origin = norm(header(req, "origin"))
	const site = (header(req, "sec-fetch-site") ?? "").toLowerCase()
	if (site && site !== "same-origin" && site !== "none") return "only this app's own page may change scenes"
	if (!origin) return env.VERCEL ? "only this app's own page may change scenes (no Origin)" : null
	return originAllowed(origin, env) || (!env.VERCEL && !(env.ALLOWED_ORIGINS ?? "").trim()) ? null : "this origin may not change scenes"
}
