// Robot keys: how the video pipeline (an agent with no Google sign-in) calls /api/ai/* and /api/videos/*. docs/DEPLOY.md "Robot keys".
//   Header: x-agent-key: <key>. Keys: the owner's master key (env AI_AGENT_KEY, caller "agent:owner") and per-person keys in Neon
//   (agent_keys: only each key's sha256 is stored; the owner issues and revokes them with tools/video-agent/keys.mjs, no redeploy).
//   A match: caller {kind: "agent", id: "agent:<name>"} with that key's own caps (dollars per day, steps per hour, outside the site-wide cap;
//   and for /api/videos/*, new videos and megabytes of uploads per day).
//   A wrong, unknown or revoked key: 403 {code: "forbidden"}. No header: nothing here applies (the callers' old rules).
// Comparison: the given key is hashed (sha256) and compared to the master key's hash with crypto.timingSafeEqual (fixed 32-byte digests, so
// neither the length nor a shared prefix of the master key shows in the time taken); a per-person key is looked up by its hash, which tells
// a caller nothing about any key (a hash's prefix says nothing about the key's), and the found hash is compared again with timingSafeEqual.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { HttpError, header } from "./http.mjs"
import { dbConfigured, getDb } from "./db.mjs"
import { newId } from "./accounts.mjs"

export const AGENT_HEADER = "x-agent-key"
export const OWNER = "owner" // the master key's name (reserved)
export const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/
const MAX_KEY_LEN = 256
const MASTER_MIN_LEN = 32

const sha256 = (s) => createHash("sha256").update(String(s), "utf8").digest()
/** The hex sha256 a key is stored under. */
export const keyHash = (key) => sha256(key).toString("hex")
/** A new per-person key: psk_ + 43 base64url characters (256 random bits). */
export const newAgentKey = () => `psk_${randomBytes(32).toString("base64url")}`

/** The x-agent-key header's value (trimmed), or null when the request has none. An empty header counts as a (wrong) key. */
export function agentKeyOf(req) {
	const v = header(req, AGENT_HEADER)
	return v === undefined ? null : String(v).trim()
}

const num = (v, d, lo, hi) => {
	const x = Number(v)
	return v !== undefined && v !== "" && Number.isFinite(x) && x >= lo && x <= hi ? x : d
}
/** A new per-person key's video caps (and the database's column defaults, api/_lib/db.mjs): new videos a day, megabytes of uploads a day. */
export const VIDEO_DEFAULTS = { videosPerDay: 50, uploadMbPerDay: 2000 }
/**
 * The master key's caps: AI_AGENT_USD_PER_DAY (25), AI_AGENT_STEPS_PER_HOUR (120), AI_AGENT_VIDEOS_PER_DAY (50) and AI_AGENT_UPLOAD_MB_PER_DAY
 * (2000); the first two are also a new per-person key's defaults.
 */
export function agentDefaults(env = process.env) {
	return {
		usdPerDay: num(env.AI_AGENT_USD_PER_DAY, 25, 0, 10000),
		stepsPerHour: Math.floor(num(env.AI_AGENT_STEPS_PER_HOUR, 120, 1, 100000)),
		videosPerDay: Math.floor(num(env.AI_AGENT_VIDEOS_PER_DAY, VIDEO_DEFAULTS.videosPerDay, 1, 100000)),
		uploadMbPerDay: Math.floor(num(env.AI_AGENT_UPLOAD_MB_PER_DAY, VIDEO_DEFAULTS.uploadMbPerDay, 1, 1000000)),
	}
}

const FORBIDDEN = { ok: false, status: 403, code: "forbidden", error: "This agent key is not valid (wrong, unknown or revoked)" }

/**
 * Who this key is. -> {ok: true, agent: {kind: "agent", name, id: "agent:<name>", usdPerDay, stepsPerHour, videosPerDay, uploadMbPerDay, master}}
 * or {ok: false, status, code, error}
 * (403 forbidden for any key that is not a live one; 503 unavailable when the keys can't be read).
 */
export async function verifyAgentKey(given, { env = process.env } = {}) {
	const key = String(given ?? "")
	const h = sha256(key)
	const master = String(env.AI_AGENT_KEY ?? "").trim()
	// (always computed, whatever the key looks like, so a refusal takes the same time for every wrong key)
	const isMaster = timingSafeEqual(h, sha256(master.length >= MASTER_MIN_LEN ? master : randomBytes(32).toString("hex"))) && master.length >= MASTER_MIN_LEN
	if (!key || key.length > MAX_KEY_LEN) return FORBIDDEN
	if (isMaster) return { ok: true, agent: { kind: "agent", name: OWNER, id: `agent:${OWNER}`, ...agentDefaults(env), master: true } }
	if (!dbConfigured(env)) return FORBIDDEN
	let row
	try {
		const db = await getDb(env)
		row = (await db.query("select name, key_sha256, usd_per_day::float8 as usd, steps_per_hour, videos_per_day, upload_mb_per_day from agent_keys where key_sha256 = $1 and revoked_at is null", [h.toString("hex")]))[0]
	} catch (e) {
		const x = e instanceof HttpError ? e : new HttpError(503, "unavailable", "Agent keys can't be checked right now. Try again.", { retryable: true })
		return { ok: false, status: x.status, code: x.code, error: "Agent keys can't be checked right now. Try again.", extra: { retryable: true } }
	}
	if (!row || !/^[0-9a-f]{64}$/.test(row.key_sha256) || !timingSafeEqual(Buffer.from(row.key_sha256, "hex"), h)) return FORBIDDEN
	return { ok: true, agent: { kind: "agent", name: row.name, id: `agent:${row.name}`, usdPerDay: Number(row.usd), stepsPerHour: Number(row.steps_per_hour), videosPerDay: Number(row.videos_per_day), uploadMbPerDay: Number(row.upload_mb_per_day), master: false } }
}

/** The calling agent of a request that must carry a key (the video functions): throws 401 (no header), 403 (not a live key) or 503. */
export async function requireAgent(req, { env = process.env } = {}) {
	const given = agentKeyOf(req)
	if (given === null) throw new HttpError(401, "unauthorized", `this needs an agent key (the ${AGENT_HEADER} header)`)
	const v = await verifyAgentKey(given, { env })
	if (!v.ok) throw new HttpError(v.status, v.code, v.error, v.extra ?? {})
	return v.agent
}

// ---------------------------------------------------------------- the owner's tool (tools/video-agent/keys.mjs)
const checkName = (name) => {
	if (!NAME_RE.test(String(name ?? ""))) throw new Error(`a key's name is 2-40 characters: lowercase letters, digits, "-" and "_", starting with a letter or digit (got "${String(name ?? "").slice(0, 40)}")`)
	if (name === OWNER) throw new Error(`"${OWNER}" is the master key's name (AI_AGENT_KEY); pick another`)
}
const checkCaps = ({ usd, steps, videos, mb }) => {
	if (!(Number.isFinite(usd) && usd > 0 && usd <= 1000)) throw new Error("--usd is dollars per day, more than 0 and at most 1000")
	if (!(Number.isInteger(steps) && steps >= 1 && steps <= 10000)) throw new Error("--steps is AI steps per hour, a whole number from 1 to 10000")
	if (!(Number.isInteger(videos) && videos >= 1 && videos <= 10000)) throw new Error("--videos is new videos per day, a whole number from 1 to 10000")
	if (!(Number.isInteger(mb) && mb >= 1 && mb <= 1000000)) throw new Error("--mb is megabytes of uploads per day, a whole number from 1 to 1000000")
}

/** Issues a key for `name` (a revoked name is reissued with a new key; an active one must be revoked first). -> the key, shown once. */
export async function issueAgentKey(db, name, { usd = 25, steps = 120, videos = VIDEO_DEFAULTS.videosPerDay, mb = VIDEO_DEFAULTS.uploadMbPerDay } = {}) {
	checkName(name)
	checkCaps({ usd, steps, videos, mb })
	const key = newAgentKey()
	const h = keyHash(key)
	const old = (await db.query("select revoked_at from agent_keys where name = $1", [name]))[0]
	if (old && !old.revoked_at) throw new Error(`"${name}" already has an active key: revoke it first (keys.mjs revoke ${name}), then issue a new one`)
	if (old) await db.query("update agent_keys set key_sha256 = $2, usd_per_day = $3, steps_per_hour = $4, videos_per_day = $5, upload_mb_per_day = $6, created_at = now(), revoked_at = null where name = $1", [name, h, usd, steps, videos, mb])
	else await db.query("insert into agent_keys (id, name, key_sha256, usd_per_day, steps_per_hour, videos_per_day, upload_mb_per_day) values ($1, $2, $3, $4, $5, $6, $7)", [newId("ak"), name, h, usd, steps, videos, mb])
	return key
}
/** Revokes `name`'s key at once (the next request with it is refused). -> true when there was an active key. */
export async function revokeAgentKey(db, name) {
	checkName(name)
	const r = await db.query("update agent_keys set revoked_at = now() where name = $1 and revoked_at is null returning name", [name])
	return r.length > 0
}
/**
 * Every key (never the key itself) with today's use: [{name, usdPerDay, stepsPerHour, videosPerDay, uploadMbPerDay, createdAt, revokedAt,
 * usdToday, stepsToday, stepsThisHour, videosToday, uploadMbToday}] (the master key's caps are null: they come from Vercel's environment).
 */
export async function listAgentKeys(db, now = new Date()) {
	const d = now.toISOString().slice(0, 10)
	const rows = await db.query(
		`select k.name, k.usd_per_day::float8 as usd, k.steps_per_hour, k.videos_per_day, k.upload_mb_per_day, k.created_at, k.revoked_at,
			coalesce(d.usd, 0)::float8 as usd_today, coalesce(d.n, 0) as steps_today, coalesce(h.n, 0) as steps_hour,
			coalesce(vj.n, 0) as videos_today, coalesce(vm.n, 0) as mb_today
		from (select name, usd_per_day, steps_per_hour, videos_per_day, upload_mb_per_day, created_at, revoked_at from agent_keys
			union all select '${OWNER}', null, null, null, null, null, null) k
		left join counters d on d.key = 'agent:' || k.name and d.bucket = $1
		left join counters h on h.key = 'agent:' || k.name and h.bucket = $2
		left join counters vj on vj.key = 'vid:' || k.name and vj.bucket = $3
		left join counters vm on vm.key = 'vid:' || k.name and vm.bucket = $4
		order by (k.name = '${OWNER}') desc, k.revoked_at is not null, k.name`,
		[`ai:d:${d}`, `ai:h:${now.toISOString().slice(0, 13)}`, `jobs:${d}`, `mb:${d}`]
	)
	const n = (v) => (v === null || v === undefined ? null : Number(v))
	return rows.map((r) => ({
		name: r.name,
		usdPerDay: r.usd,
		stepsPerHour: r.steps_per_hour,
		videosPerDay: n(r.videos_per_day),
		uploadMbPerDay: n(r.upload_mb_per_day),
		createdAt: r.created_at,
		revokedAt: r.revoked_at,
		usdToday: Number(r.usd_today),
		stepsToday: Number(r.steps_today),
		stepsThisHour: Number(r.steps_hour),
		videosToday: Number(r.videos_today),
		uploadMbToday: Number(r.mb_today),
	}))
}
