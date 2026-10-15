// Answers and request bodies for the account functions (api/scenes/index.mjs, and the AI gate's refusals), in the AI endpoint's shape:
// {ok: true, ...} or {ok: false, error (plain words), code, retryable}. Every JSON answer is Cache-Control: no-store and goes through
// scrubSecrets(), so a secret value can never leave in an answer even if one ended up in an error message. Contract: docs/ACCOUNTS.md §4.
// Files in api/_lib/ are not functions (Vercel skips paths that start with "_").

/** The secrets that exist in a function's environment (each is replaced wherever it appears in an answer or a log line). */
const SECRET_VARS = ["CLERK_SECRET_KEY", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL", "POSTGRES_PASSWORD", "PGPASSWORD", "TRUEFOUNDRY_API_KEY", "AI_SESSION_SECRET", "AI_ACCESS_TOKEN"]

/** text with every secret value of the environment, any connection string and any bearer token replaced. */
export function scrubSecrets(text, env = process.env) {
	let t = String(text ?? "")
	for (const k of SECRET_VARS) {
		const v = env[k]
		if (typeof v === "string" && v.length >= 8) t = t.split(v).join("[redacted]")
	}
	return t
		.replace(/\b(postgres(?:ql)?|mysql|redis|rediss):\/\/[^\s"'`]+/gi, "[database]")
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g, "Bearer [redacted]")
		.replace(/\bsk_(?:test|live)_[A-Za-z0-9]{8,}/g, "[redacted]")
}

export const header = (req, k) => {
	const v = req.headers?.[k]
	return Array.isArray(v) ? v[0] : typeof v === "string" ? v : undefined
}

/** A refusal with its status, code and plain words (thrown by the helpers, answered by the function). */
export class HttpError extends Error {
	constructor(status, code, message, extra = {}, headers = {}) {
		super(message)
		this.status = status
		this.code = code
		this.extra = extra
		this.headers = headers
	}
}

export function send(res, status, obj, headers = {}) {
	const text = scrubSecrets(JSON.stringify(obj))
	res.statusCode = status
	res.setHeader("Content-Type", "application/json; charset=utf-8")
	res.setHeader("Cache-Control", "no-store")
	for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
	res.end(text)
}
export const fail = (res, status, code, error, extra = {}, headers = {}) => send(res, status, { ok: false, error, code, retryable: false, ...extra }, headers)
export const failWith = (res, e) => fail(res, e.status, e.code, e.message, e.extra, e.headers)

/** The request's path and query, whether Vercel's helpers parsed them (req.query) or not. */
export function urlOf(req) {
	const u = new URL(req.url ?? "/", "http://x")
	const query = { ...Object.fromEntries(u.searchParams), ...(req.query && typeof req.query === "object" ? req.query : {}) }
	for (const [k, v] of Object.entries(query)) query[k] = Array.isArray(v) ? String(v[0]) : String(v)
	return { pathname: u.pathname, query }
}

/** A JSON object body of at most `max` bytes (415 not JSON, 413 too big, 400 not an object). Works with Vercel's parsed req.body or a raw stream. */
export async function readJson(req, max) {
	const ctype = (header(req, "content-type") ?? "").split(";")[0].trim().toLowerCase()
	if (ctype !== "application/json") throw new HttpError(415, "bad_input", "the body must be JSON (Content-Type: application/json)")
	const len = Number(header(req, "content-length") ?? 0)
	if (len > max) throw new HttpError(413, "too_large", `the request is too large (at most ${(max / 1048576).toFixed(1)} MB)`)
	let value
	try {
		let parsed
		try {
			parsed = req.body // (Vercel's helper: a getter that parses JSON, and throws on JSON that isn't)
		} catch {
			throw new HttpError(400, "bad_input", "the body is not valid JSON")
		}
		if (parsed !== undefined && parsed !== null) {
			if (typeof parsed === "string" || Buffer.isBuffer(parsed)) {
				const s = parsed.toString()
				if (Buffer.byteLength(s) > max) throw new HttpError(413, "too_large", `the request is too large (at most ${(max / 1048576).toFixed(1)} MB)`)
				value = JSON.parse(s)
			} else {
				if (Buffer.byteLength(JSON.stringify(parsed)) > max) throw new HttpError(413, "too_large", `the request is too large (at most ${(max / 1048576).toFixed(1)} MB)`)
				value = parsed
			}
		} else {
			const chunks = []
			let n = 0
			for await (const c of req) {
				n += c.length
				if (n > max) throw new HttpError(413, "too_large", `the request is too large (at most ${(max / 1048576).toFixed(1)} MB)`)
				chunks.push(c)
			}
			value = n ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
		}
	} catch (e) {
		if (e instanceof HttpError) throw e
		throw new HttpError(400, "bad_input", "the body is not valid JSON")
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "bad_input", "the body must be a JSON object")
	return value
}

/** One log line without secrets, emails, tokens or scene contents: route, status, ms and the first 6 characters of the account id. */
export function logLine(fields) {
	try {
		console.log(scrubSecrets(JSON.stringify({ at: "accounts", ...fields })))
	} catch {}
}
