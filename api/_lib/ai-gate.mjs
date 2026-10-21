// Who may run an AI step on the hosted site, and how much (called by api/ai/[step].mjs). docs/ACCOUNTS.md §6.
//   1. Who: a valid Clerk session token -> that account; else the AI function's own rules (accessProblem: the invite cookie, the preview token);
//      else, when sign-in is required (both Clerk keys set, AI_REQUIRE_SIGN_IN not "0"), 401 {code: "sign_in"}; otherwise its own 401 / 503.
//   2. Allowed: AI_ALLOWED_EMAILS (addresses and @domain entries) makes Build with AI invite-only for signed-in people (403 not_allowed).
//   3. Limits, checked atomically in the database when a step is about to run (gate.charge(), after the function's queue gave it a slot, so
//      a "busy" retry costs nothing): this caller's steps this hour and today, this caller's dollars today, and the whole site's dollars today.
//      The dollars are RESERVED, not just compared: the step's estimate (STEP_USD, about its 99th-percentile cost) is added to the caller's day
//      and the site's in the same statement that checks the caps, so steps running side by side can't all pass a cap they'd break together.
//      Over a limit: 403 {code: "quota" | "site_quota"} - never 429, which web/ai/orchestrator.js treats as "busy" and retries.
//   4. After the step (gate.run(fn) wraps it): the reservation becomes its real usage.costInUSD (from the answer or the error; none known: the
//      reservation is given back). A cap can be passed only by what steps already running cost beyond their estimates. A request the step
//      refused as bad input (400) before any model call is not counted as a step either.
// Without accounts configured (no publishable key, or no database) this is exactly the function's old access check.
// Robot keys (api/_lib/agent-keys.mjs, docs/DEPLOY.md "Robot keys"): a request with the header x-agent-key is the video pipeline's agent. A
// live key -> caller "agent:<name>" (no sign-in, no invite cookie, no Origin needed) with that key's own caps: its dollars per day (the key's
// usd_per_day; the master key AI_AGENT_KEY: AI_AGENT_USD_PER_DAY, 25) and steps per hour (steps_per_hour; AI_AGENT_STEPS_PER_HOUR, 120),
// reserved and settled the same way, but NOT counted in the site-wide AI_SITE_USD_PER_DAY (so a batch of videos never shuts Build with AI
// for people, nor people's use a batch). A wrong, unknown or revoked key -> 403 forbidden. Requests without the header: unchanged.
import { HttpError, logLine } from "./http.mjs"
import { bearerToken, clerkSettings, verifySessionToken } from "./auth.mjs"
import { dbConfigured, getDb } from "./db.mjs"
import { accountFor } from "./accounts.mjs"
import { agentKeyOf, verifyAgentKey } from "./agent-keys.mjs"

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
/** What each step reserves of the dollar caps before it runs (about the 99th percentile of its measured cost, ai/bench/results: plan p99
 *  $0.34, observe $0.19, refine $0.13, edit $0.24 with a long tail but p90 $0.04; imagine about $0.06 for the picture (an estimate from its
 *  tokens, in its usage.costInUSD) + $0.03-0.06 for the pre-pass, $0.08-0.11 in all on the first route, and $0.19-0.22 measured when the
 *  picture falls back to Gemini, whose tokens cost 3x: so $0.25); direct, a shot plan with up to 2 repair turns at high effort, $0.06-0.47 over
 *  24 live runs on 20 Oct (the prompt cache read makes the warm ones cheap; three turns cold is about $0.5): $0.75. The real cost replaces it
 *  once the step is done. */
export const STEP_USD = { observe: 0.2, plan: 0.35, refine: 0.15, edit: 0.1, imagine: 0.25, direct: 0.75 }
const DEFAULT_STEP_USD = 0.35
/** Accounts are on for the AI gate: a publishable key and a database (the same rule as the scenes function's accountsOn), not switched off. */
const accountsOn = (env) => !!clerkSettings(env) && dbConfigured(env) && (env.ACCOUNTS ?? "").toLowerCase() !== "off"
/** Is sign-in required for Build with AI on this deployment? (both Clerk keys and the database set, and AI_REQUIRE_SIGN_IN is not "0".
 *  Clerk connected without the database leaves the AI function's own access check in place: nobody could be counted.) */
export function signInRequired(env = process.env) {
	const s = clerkSettings(env)
	return !!s?.secretKey && accountsOn(env) && env.AI_REQUIRE_SIGN_IN !== "0"
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
/** The counter key of a caller the function's own access check let in: the preview token, or the invite cookie's nonce. (The token first: a
 *  caller holding it could otherwise pick any nonce in an unchecked cookie beside it and dodge its own count.) */
function accessKey(req) {
	if (req.headers?.["x-ai-access"]) return "tok"
	const v = cookieValue(req, "ai_session")
	if (v) {
		try {
			const n = JSON.parse(Buffer.from(String(v).split(".")[0], "base64url").toString("utf8"))?.n
			if (typeof n === "string" && /^[0-9a-f]{8,32}$/.test(n)) return `inv_${n}`
		} catch {}
	}
	return "open"
}

const day = (now) => now.toISOString().slice(0, 10)
const resetsAt = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
const NO_LIMITS = { ok: true, who: null, charge: async () => null, run: (fn) => fn() }

/**
 * -> {ok: true, who: {key, account?}, charge() -> null | {status, code, error, extra}, run(fn) -> fn()} or {ok: false, status, code, error, extra}.
 * opts: {accessProblem (the function's own check), env, now, fetch}
 */
export async function aiGate(req, step, { accessProblem, env = process.env, now = () => new Date(), fetch: fetchImpl } = {}) {
	const agentKey = agentKeyOf(req)
	if (agentKey !== null) return agentGate(agentKey, step, { env, now })
	const deps = { env, ...(fetchImpl ? { fetch: fetchImpl } : {}) }
	const token = accountsOn(env) ? bearerToken(req) : null
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
	const { charge, run } = limiter({ key, step, env, now, caps: { stepsPerHour: lim.stepsPerHour, stepsPerDay: lim.stepsPerDay, usdPerDay: userUsd, siteUsdPerDay: lim.siteUsdPerDay } })
	return { ok: true, who: { key, account: account ? { id: account.id } : null }, charge, run }
}

/** A robot key's gate: the key decides who (api/_lib/agent-keys.mjs), its own caps how much; never the site's cap. */
async function agentGate(given, step, { env, now }) {
	const v = await verifyAgentKey(given, { env })
	if (!v.ok) {
		logLine({ event: "ai_agent_refused", code: v.code })
		return { ok: false, status: v.status, code: v.code, error: v.error, extra: v.extra ?? {} }
	}
	const a = v.agent
	const who = { key: a.id, account: null, agent: { name: a.name } }
	if (!dbConfigured(env)) return { ...NO_LIMITS, who } // (the master key off Vercel with no database: local runs; nothing can be counted)
	const { charge, run } = limiter({ key: a.id, step, env, now, caps: { stepsPerHour: a.stepsPerHour, stepsPerDay: a.stepsPerHour * 24, usdPerDay: a.usdPerDay, siteUsdPerDay: null }, agent: a.name })
	return { ok: true, who, charge, run }
}

/**
 * The counting for one step of one caller: charge() reserves the step's estimate against the caps (null: it may run, else the refusal),
 * run(fn) runs it and settles the reservation to its real cost. caps.siteUsdPerDay null: the site's row ('*') is neither checked nor touched.
 */
function limiter({ key, step, env, now, caps, agent = null }) {
	const site = caps.siteUsdPerDay !== null && caps.siteUsdPerDay !== undefined
	const est = STEP_USD[step] ?? DEFAULT_STEP_USD
	let charged = null // {key, day, hour, est}: what this step reserved
	/** Counts this step against the limits and reserves its estimated cost; null when it may run, else the refusal. */
	async function charge() {
		const t = now()
		const d = day(t)
		const hour = `ai:h:${t.toISOString().slice(0, 13)}`
		const dayB = `ai:d:${d}`
		let db
		try {
			db = await getDb(env)
			// one statement, three guarded upserts, each only if the one before it went through: the site's dollars, then this caller's steps
			// and dollars today, then this caller's steps this hour. A row is returned only for a guard that held (the row lock of the upsert
			// makes each check-and-add atomic, so parallel steps line up instead of all reading the same old total). An agent: no site guard.
			const r = (
				site
					? await db.query(
							`with site as (
						insert into counters (key, bucket, n, usd) select '*', $3, 0, $4::numeric where $4::numeric <= $7::numeric
						on conflict (key, bucket) do update set usd = counters.usd + excluded.usd where counters.usd + excluded.usd <= $7::numeric
						returning 1 as ok
					), usr as (
						insert into counters (key, bucket, n, usd) select $1, $3, 1, $4::numeric where exists (select 1 from site) and $4::numeric <= $6::numeric
						on conflict (key, bucket) do update set n = counters.n + 1, usd = counters.usd + excluded.usd
							where counters.usd + excluded.usd <= $6::numeric and counters.n < $8::int
						returning 1 as ok
					), hr as (
						insert into counters (key, bucket, n) select $1, $2, 1 where exists (select 1 from usr)
						on conflict (key, bucket) do update set n = counters.n + 1 where counters.n < $5::int
						returning 1 as ok
					)
					select (select count(*) from site)::int as site_ok, (select count(*) from usr)::int as user_ok, (select count(*) from hr)::int as hour_ok`,
							[key, hour, dayB, est, caps.stepsPerHour, caps.usdPerDay, caps.siteUsdPerDay, caps.stepsPerDay]
						)
					: await db.query(
							`with usr as (
						insert into counters (key, bucket, n, usd) select $1, $3, 1, $4::numeric where $4::numeric <= $6::numeric
						on conflict (key, bucket) do update set n = counters.n + 1, usd = counters.usd + excluded.usd
							where counters.usd + excluded.usd <= $6::numeric and counters.n < $7::int
						returning 1 as ok
					), hr as (
						insert into counters (key, bucket, n) select $1, $2, 1 where exists (select 1 from usr)
						on conflict (key, bucket) do update set n = counters.n + 1 where counters.n < $5::int
						returning 1 as ok
					)
					select 1 as site_ok, (select count(*) from usr)::int as user_ok, (select count(*) from hr)::int as hour_ok`,
							[key, hour, dayB, est, caps.stepsPerHour, caps.usdPerDay, caps.stepsPerDay]
						)
			)[0]
			let refusal = null
			const whose = agent ? `The agent key "${agent}" has used` : "You've used"
			if (!r.site_ok) refusal = { code: "site_quota", error: `Build with AI has reached today's limit for this site. It resets at 00:00 UTC.` }
			else if (!r.user_ok) refusal = { code: "quota", error: `${whose} today's Build with AI allowance. It resets at 00:00 UTC.` }
			else if (!r.hour_ok) refusal = { code: "quota", error: `${whose} this hour's Build with AI allowance. Try again after the hour.`, hourly: true }
			if (!refusal) {
				charged = { key, day: dayB, hour, est }
				return null
			}
			// (a refused step doesn't count: what the guards before the refusing one added is given back)
			if (r.user_ok) await db.query("update counters set n = greatest(0, n - 1), usd = greatest(0, usd - $3::numeric) where key = $1 and bucket = $2", [key, dayB, est])
			if (site && r.site_ok) await db.query("update counters set usd = greatest(0, usd - $2::numeric) where key = '*' and bucket = $1", [dayB, est])
			logLine({ event: "ai_quota", code: refusal.code, who: agent ? `agent:${agent}` : String(key).slice(0, 6) })
			const resets = refusal.hourly ? new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours() + 1)).toISOString() : resetsAt(t)
			return { status: 403, code: refusal.code, error: refusal.error, extra: { resetsAt: resets } }
		} catch (e) {
			const h = e instanceof HttpError ? e : new HttpError(503, "unavailable", "Build with AI's limits can't be checked right now. Try again.", { retryable: true })
			return { status: h.status, code: h.code, error: h.message, extra: h.extra }
		}
	}
	/**
	 * The step is done: its reservation becomes what it really cost (none known: the reservation is given back), for the caller and the site.
	 * refused: the step turned the request down before any model call (a 400 from its payload's checks, e.g. a picture sent to imagine): with
	 * nothing spent, it does not count as one of the caller's steps this hour or today either.
	 */
	async function record(usage, { refused = false } = {}) {
		if (!charged) return
		const c = charged
		charged = null
		const usd = Number(usage?.costInUSD)
		const actual = Number.isFinite(usd) && usd > 0 ? Math.min(usd, 100) : 0
		const delta = Math.round((actual - c.est) * 1e4) / 1e4
		const uncount = refused && actual === 0
		if (!delta && !uncount) return
		try {
			const db = await getDb(env)
			if (delta) {
				if (site) await db.query("update counters set usd = greatest(0, usd + $3::numeric) where bucket = $2 and key in ($1, '*')", [c.key, c.day, delta])
				else await db.query("update counters set usd = greatest(0, usd + $3::numeric) where bucket = $2 and key = $1", [c.key, c.day, delta])
			}
			if (uncount) await db.query("update counters set n = greatest(0, n - 1) where key = $1 and bucket in ($2, $3)", [c.key, c.day, c.hour])
		} catch {
			logLine({ event: "ai_usage_lost", usd: actual })
		}
	}
	/** Runs the step and records what it cost (from its answer, or its error's usage) before the answer goes out. */
	async function run(fn) {
		let out
		try {
			out = await fn()
		} catch (e) {
			await record(e?.usage, { refused: e?.code === "bad_input" })
			throw e
		}
		await record(out?.usage)
		return out
	}
	return { charge, run }
}
