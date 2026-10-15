// Who may run an AI step on the hosted site, and how much (called by api/ai/[step].mjs). docs/ACCOUNTS.md §6.
//   1. Who: a valid Clerk session token -> that account; else the AI function's own rules (accessProblem: the invite cookie, the preview token);
//      else, when sign-in is required (both Clerk keys set, AI_REQUIRE_SIGN_IN not "0"), 401 {code: "sign_in"}; otherwise its own 401 / 503.
//   2. Allowed: AI_ALLOWED_EMAILS (addresses and @domain entries) makes Build with AI invite-only for signed-in people (403 not_allowed).
//   3. Limits, checked atomically in the database when a step is about to run (gate.charge(), after the function's queue gave it a slot, so
//      a "busy" retry costs nothing): this caller's steps this hour and today, this caller's dollars today, and the whole site's dollars today.
//      Over a limit: 403 {code: "quota" | "site_quota"} - never 429, which web/ai/orchestrator.js treats as "busy" and retries.
//   4. After the step (gate.run(fn) wraps it): its usage.costInUSD, from the answer or the error, is added to the caller's day and the site's.
// Without accounts configured (no publishable key) this is exactly the function's old access check.
import { HttpError, logLine } from "./http.mjs"
import { bearerToken, clerkSettings, verifySessionToken } from "./auth.mjs"
import { dbConfigured, getDb } from "./db.mjs"
import { accountFor } from "./accounts.mjs"

const num = (v, d, lo = 0) => {
	const x = Number(v)
	return v !== undefined && v !== "" && Number.isFinite(x) && x >= lo ? x : d
}
export function aiLimits(env = process.env) {
	return {
		stepsPerHour: Math.floor(num(env.AI_USER_STEPS_PER_HOUR, 40, 1)),
		stepsPerDay: Math.floor(num(env.AI_USER_STEPS_PER_DAY, 200, 1)),
		userUsdPerDay: num(env.AI_USER_USD_PER_DAY, 3),
		siteUsdPerDay: num(env.AI_SITE_USD_PER_DAY, 30),
	}
}
/** Is sign-in required for Build with AI on this deployment? (both Clerk keys set, and AI_REQUIRE_SIGN_IN is not "0") */
export function signInRequired(env = process.env) {
	const s = clerkSettings(env)
	return !!s?.secretKey && env.AI_REQUIRE_SIGN_IN !== "0" && (env.ACCOUNTS ?? "").toLowerCase() !== "off"
}

/** Does this email match AI_ALLOWED_EMAILS ("a@b.c,@example.com")? true when the list is empty. */
export function emailAllowed(email, env = process.env) {
	const list = (env.AI_ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
	if (!list.length) return true
	const e = String(email ?? "").toLowerCase()
	if (!e) return false
	return list.some((x) => (x.startsWith("@") ? e.endsWith(x) : e === x))
}

const cookieValue = (req, name) => {
	const raw = req.headers?.cookie
	for (const part of String(Array.isArray(raw) ? raw[0] : raw ?? "").split(";")) {
		const i = part.indexOf("=")
		if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
	}
	return undefined
}
/** The counter key of a caller the function's own access check let in: the invite cookie's nonce, or the preview token. */
function accessKey(req) {
	const v = cookieValue(req, "ai_session")
	if (v) {
		try {
			const n = JSON.parse(Buffer.from(String(v).split(".")[0], "base64url").toString("utf8"))?.n
			if (typeof n === "string" && /^[0-9a-f]{8,32}$/.test(n)) return `inv_${n}`
		} catch {}
	}
	return req.headers?.["x-ai-access"] ? "tok" : "open"
}

const day = (now) => now.toISOString().slice(0, 10)
const resetsAt = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
const NO_LIMITS = { ok: true, who: null, charge: async () => null, run: (fn) => fn() }

/**
 * -> {ok: true, who: {key, account?}, charge() -> null | {status, code, error, extra}, run(fn) -> fn()} or {ok: false, status, code, error, extra}.
 * opts: {accessProblem (the function's own check), env, now, fetch}
 */
export async function aiGate(req, step, { accessProblem, env = process.env, now = () => new Date(), fetch: fetchImpl } = {}) {
	const deps = { env, ...(fetchImpl ? { fetch: fetchImpl } : {}) }
	const accounts = clerkSettings(env) && (env.ACCOUNTS ?? "").toLowerCase() !== "off"
	const token = accounts ? bearerToken(req) : null
	let key = null
	let account = null
	if (token) {
		let who
		try {
			who = await verifySessionToken(token, deps)
		} catch (e) {
			const h = e instanceof HttpError ? e : new HttpError(503, "unavailable", "Sign-in can't be checked right now. Try again.", { retryable: true })
			return { ok: false, status: h.status, code: h.code, error: h.message, extra: h.extra }
		}
		if (!dbConfigured(env)) {
			if (env.VERCEL) return { ok: false, status: 503, code: "not_configured", error: "Build with AI's limits need the database, which this deployment doesn't have yet", extra: {} }
			return { ...NO_LIMITS, who: { key: `sub_${who.sub}` } } // (off Vercel, a local `vercel dev` without a database: no limits)
		}
		try {
			account = await accountFor(await getDb(env), who, deps)
		} catch (e) {
			const h = e instanceof HttpError ? e : new HttpError(503, "unavailable", "Your account can't be reached right now. Try again.", { retryable: true })
			return { ok: false, status: h.status, code: h.code, error: h.message, extra: h.extra }
		}
		if (account.disabled) return { ok: false, status: 403, code: "forbidden", error: "This account can't use Build with AI", extra: {} }
		if (!emailAllowed(account.emailVerified ? account.email : null, env)) return { ok: false, status: 403, code: "not_allowed", error: "Build with AI is invite-only for now", extra: {} }
		key = account.id
	} else {
		const denied = accessProblem ? accessProblem(req, env) : null
		if (denied) {
			if (signInRequired(env)) return { ok: false, status: 401, code: "sign_in", error: "Sign in with Google to use Build with AI", extra: { signIn: true } }
			return { ok: false, status: denied[0], code: denied[1], error: denied[2], extra: {} }
		}
		if (!dbConfigured(env)) return NO_LIMITS
		key = accessKey(req)
		if (key === "open") return NO_LIMITS // (off Vercel with no access configured: tests and local runs)
	}

	const lim = aiLimits(env)
	const userUsd = account?.aiUsdPerDay ?? lim.userUsdPerDay
	let charged = null
	/** Counts this step against the limits; null when it may run, else the refusal. */
	async function charge() {
		const t = now()
		const d = day(t)
		const hour = `ai:h:${t.toISOString().slice(0, 13)}`
		const dayB = `ai:d:${d}`
		let db
		try {
			db = await getDb(env)
			const r = (
				await db.query(
					`with up as (
						insert into counters (key, bucket, n) values ($1, $2, 1), ($1, $3, 1)
						on conflict (key, bucket) do update set n = counters.n + 1
						returning bucket, n
					)
					select (select n from up where bucket = $2) as hour_n, (select n from up where bucket = $3) as day_n,
						coalesce((select usd from counters where key = $1 and bucket = $3), 0)::float8 as user_usd,
						coalesce((select usd from counters where key = '*' and bucket = $3), 0)::float8 as site_usd`,
					[key, hour, dayB]
				)
			)[0]
			let refusal = null
			if (r.site_usd >= lim.siteUsdPerDay) refusal = { code: "site_quota", error: `Build with AI has reached today's limit for this site. It resets at 00:00 UTC.` }
			else if (r.user_usd >= userUsd || r.day_n > lim.stepsPerDay) refusal = { code: "quota", error: `You've used today's Build with AI allowance. It resets at 00:00 UTC.` }
			else if (r.hour_n > lim.stepsPerHour) refusal = { code: "quota", error: `You've used this hour's Build with AI allowance. Try again after the hour.`, hourly: true }
			if (!refusal) {
				charged = { key, day: dayB }
				return null
			}
			await db.query("update counters set n = greatest(0, n - 1) where key = $1 and bucket in ($2, $3)", [key, hour, dayB]) // (a refused step doesn't count)
			logLine({ event: "ai_quota", code: refusal.code, who: String(key).slice(0, 6) })
			const resets = refusal.hourly ? new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours() + 1)).toISOString() : resetsAt(t)
			return { status: 403, code: refusal.code, error: refusal.error, extra: { resetsAt: resets } }
		} catch (e) {
			const h = e instanceof HttpError ? e : new HttpError(503, "unavailable", "Build with AI's limits can't be checked right now. Try again.", { retryable: true })
			return { status: h.status, code: h.code, error: h.message, extra: h.extra }
		}
	}
	/** Adds what this step cost to the caller's day and to the site's. */
	async function record(usage) {
		const usd = Number(usage?.costInUSD)
		if (!charged || !(usd > 0) || !Number.isFinite(usd)) return
		try {
			const db = await getDb(env)
			await db.query("insert into counters (key, bucket, usd) values ($1, $2, $3), ('*', $2, $3) on conflict (key, bucket) do update set usd = counters.usd + excluded.usd", [charged.key, charged.day, Math.min(usd, 100)])
		} catch {
			logLine({ event: "ai_usage_lost", usd })
		}
	}
	/** Runs the step and records what it cost (from its answer, or its error's usage) before the answer goes out. */
	async function run(fn) {
		let out
		try {
			out = await fn()
		} catch (e) {
			await record(e?.usage)
			throw e
		}
		await record(out?.usage)
		return out
	}
	return { ok: true, who: { key, account: account ? { id: account.id } : null }, charge, run }
}
