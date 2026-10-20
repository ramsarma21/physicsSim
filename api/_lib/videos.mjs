// The video pipeline's two writes and the team gallery (api/videos/upload.mjs, publish.mjs, gallery.mjs). docs/DEPLOY.md "Video gallery".
//   POST /api/videos/upload  {job, files: [{name, type, size}]}  (x-agent-key)
//     -> {ok, job, prefix, validUntil, uploads: [{name, pathname, contentType, maxBytes, url, token, put: {method, url, headers}}]}
//     One Blob CLIENT token per file, good for 15 minutes and for exactly videos/<VIDEO_GALLERY_ID>/jobs/<job>/<name>, that file's content type
//     and at most the size the caller declared (under the name's cap). The caller PUTs the bytes straight to Blob (put.url with put.headers;
//     no 4.5 MB function limit, no SDK needed); the read-write token never leaves this function. The first key to ask for a job owns it: another
//     key gets 409 conflict (the owner's master key may touch any job). A published job is final: 409 already_published (a new video is a new
//     job). Each key's daily caps (agent_keys.videos_per_day: new jobs; upload_mb_per_day: megabytes granted) are counted in counters as
//     vid:<name> (buckets jobs:<day>, mb:<day>, pub:<day>); over one: 403 quota {resetsAt}.
//   POST /api/videos/publish {job, batch?, title, request, lesson: {id?, grade?, concept?}, seconds, checks, cost_usd}  (x-agent-key)
//     -> {ok, job, video_url, poster_url, report_url, gallery_url, gallery_json_url, batch_url, batch_json_url, published_by, published_at, checks}
//     Checks that video.mp4 and poster.jpg (and whatever else of the job's allowed files) are in Blob and that every check passed (readChecks:
//     strict; an entry it can't read is 400, never skipped), records the publishing key's name and each file's size and etag, then rewrites
//     videos/<gallery>/index.json + index.html (and the batch's under batches/<batch>/) from the database: the same publish twice gives the same
//     indexes (an entry per job; its first publish time is kept). Publishes count too (pub:<day>, at most 3 a day per video of the key's cap).
//   GET /videos/<gallery>[/batches/<batch>] (vercel.json rewrites to /api/videos/gallery): the gallery as a page (Blob serves HTML as a download).
//   GET /videos/<gallery>/jobs/<job>/<file> (the same function): a published job's files. "report" (report_url) is its report.html as a page
//     with a strict CSP, captions.vtt is served from here too (a <track> must be same-origin), any other file redirects to its Blob URL, so the
//     report's own relative links (video.mp4, poster.jpg, audit.json, ../../index.html) all work.
// Answers: {ok: false, error, code, retryable} like the other functions; never a key, the Blob token or a database address.
import { createHash, timingSafeEqual } from "node:crypto"
import { HttpError, fail, failWith, header, logLine, readJson, scrubServerSecrets, send, urlOf } from "./http.mjs"
import { DbUnavailable, dbConfigured, getDb } from "./db.mjs"
import { VIDEO_DEFAULTS, requireAgent } from "./agent-keys.mjs"
import { blobConfigured, clientToken, headBlob, publicUrl, putBlob, readPublicBlob, uploadRequest } from "./blob.mjs"
import { renderGallery } from "./gallery.mjs"

const MB = 1048576
/** The files a job may have: name -> its one content type and its size cap. video.mp4 and poster.jpg must be there to publish. */
export const FILES = {
	"video.mp4": { type: "video/mp4", max: 200 * MB, required: true },
	"poster.jpg": { type: "image/jpeg", max: 5 * MB, required: true },
	"concept.jpg": { type: "image/jpeg", max: 10 * MB },
	"frames.jpg": { type: "image/jpeg", max: 15 * MB },
	"scene.json": { type: "application/json", max: 5 * MB },
	"audit.json": { type: "application/json", max: 5 * MB },
	"captions.vtt": { type: "text/vtt", max: 1 * MB },
	"report.html": { type: "text/html", max: 4 * MB }, // (served through the gallery function: Vercel answers at most 4.5 MB)
}
export const MAX_CHECKS = 500
export const JOB_RE = /^[a-z0-9][a-z0-9_-]{2,79}$/
export const UPLOAD_TOKEN_MS = 15 * 60 * 1000
const GALLERY_RE = /^[A-Za-z0-9_-]{16,64}$/
const INDEX_CACHE_S = 60 // (Blob's least: the gallery's index files are rewritten in place)
const MAX_ENTRIES = 5000

/** VIDEO_GALLERY_ID: the unguessable folder of the team's gallery (16-64 of A-Z a-z 0-9 _ -), or null. */
export function galleryId(env = process.env) {
	const g = String(env.VIDEO_GALLERY_ID ?? "").trim()
	return GALLERY_RE.test(g) ? g : null
}
const prefixOf = (g) => `videos/${g}`
const jobPrefix = (g, job) => `${prefixOf(g)}/jobs/${job}/`
/** A published job's file on this site: /videos/<gallery>/jobs/<job>/<file> ("report" is its report page). */
export const jobPagePath = (g, job, file) => `/videos/${g}/jobs/${encodeURIComponent(job)}/${file}`

/** The gallery's settings, or 503 not_configured naming what is missing (names only). */
function settings(env) {
	const g = galleryId(env)
	const missing = [!g && "VIDEO_GALLERY_ID", !blobConfigured(env) && "BLOB_READ_WRITE_TOKEN", !dbConfigured(env) && "DATABASE_URL"].filter(Boolean)
	if (missing.length) throw new HttpError(503, "not_configured", `video publishing is not set up on this deployment (missing ${missing.join(", ")})`)
	return { gallery: g }
}

/** Where this deployment is reached (for the gallery page's address): the request's own host, else the project's URL. */
export function siteOrigin(req, env = process.env) {
	const host = String(header(req, "x-forwarded-host") ?? header(req, "host") ?? "").split(",")[0].trim().toLowerCase()
	if (/^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) return `${/^(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:|$)/.test(host) ? "http" : "https"}://${host}`
	const v = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL
	return v ? `https://${String(v).replace(/^https?:\/\//, "")}` : ""
}
export const galleryPagePath = (g, batch) => `/videos/${g}${batch ? `/batches/${encodeURIComponent(batch)}` : ""}`
/** The address the gallery's stored indexes link to (the same bytes whichever deployment published): the production URL, else this request's. */
export function siteBase(req, env = process.env) {
	const v = env.VERCEL_PROJECT_PRODUCTION_URL
	return v ? `https://${String(v).replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : siteOrigin(req, env)
}

// ---------------------------------------------------------------- what a request may say
const text = (v, max, what, { required = true } = {}) => {
	if (v === undefined || v === null || v === "") {
		if (required) throw new HttpError(400, "bad_input", `${what} is missing`)
		return null
	}
	if (typeof v !== "string" && typeof v !== "number") throw new HttpError(400, "bad_input", `${what} must be text`)
	// eslint-disable-next-line no-control-regex
	const s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim()
	if (!s && required) throw new HttpError(400, "bad_input", `${what} is missing`)
	if (s.length > max) throw new HttpError(400, "bad_input", `${what} is too long (at most ${max} characters)`)
	return s || null
}
const jobOf = (v, what = "job") => {
	if (typeof v !== "string" || !JOB_RE.test(v)) throw new HttpError(400, "bad_input", `${what} must be 3-80 characters: lowercase letters, digits, "-" and "_", starting with a letter or digit`)
	return v
}

// A check that says its result any other way than ok: true | false (a string "false", result: "fail", passed: 0, ...) is refused, never read
// as passing or skipped: the gate fails closed on any format drift between the pipeline and this function.
const OTHER_RESULT_KEYS = ["pass", "passed", "result", "status", "outcome", "verdict", "fail", "failed", "error", "success"]
const CHECKS_FORMAT = "send checks as [{name, ok: true | false}, ...] (id may stand for name) or {name: true | false, ...}"

/**
 * The checks a publish sends, read strictly: [{name (or id), ok: boolean, ...anything descriptive}] or {name: boolean}. -> [{name, ok}] (all of
 * them, in order). 400 bad_input for any entry it can't read (no name, ok not a boolean, a result given another way, an empty list, any other
 * shape); 413 for more than MAX_CHECKS.
 */
export function readChecks(checks) {
	const bad = (what) => new HttpError(400, "bad_input", `${what}: ${CHECKS_FORMAT}`)
	const nameOf = (v, where) => {
		if (typeof v !== "string" || !v.trim()) throw bad(`${where} has no name`)
		return v.trim().slice(0, 120)
	}
	let list
	if (Array.isArray(checks)) {
		if (checks.length > MAX_CHECKS) throw new HttpError(413, "too_large", `too many checks (${checks.length}; at most ${MAX_CHECKS})`)
		list = checks.map((c, i) => {
			const where = `checks[${i}]`
			if (!c || typeof c !== "object" || Array.isArray(c)) throw bad(`${where} is not {name, ok}`)
			const other = OTHER_RESULT_KEYS.find((k) => Object.hasOwn(c, k))
			if (other) throw bad(`${where} gives a result as "${other}"; only ok: true | false counts`)
			if (typeof c.ok !== "boolean") throw bad(`${where}.ok must be true or false`)
			return { name: nameOf(Object.hasOwn(c, "name") ? c.name : Object.hasOwn(c, "id") ? c.id : c.check, where), ok: c.ok }
		})
	} else if (checks && typeof checks === "object") {
		const entries = Object.entries(checks)
		if (entries.length > MAX_CHECKS) throw new HttpError(413, "too_large", `too many checks (${entries.length}; at most ${MAX_CHECKS})`)
		list = entries.map(([k, v]) => {
			if (typeof v !== "boolean") throw bad(`checks["${String(k).slice(0, 60)}"] must be true or false`)
			return { name: nameOf(k, "a check"), ok: v }
		})
	} else throw bad("checks are missing")
	if (!list.length) throw bad("checks must list the checks that ran")
	return list
}

/**
 * For SHOWING a stored entry's checks (the gate is readChecks): {passed, total, items: [{name, ok}] (the first 200)}, counted over the whole
 * list. Reads what readChecks stores, and leniently what older publishes stored.
 */
export function checksSummary(checks) {
	const items = []
	const okOf = (c) => (c.ok ?? c.pass ?? c.passed) === true
	const has = (c) => c && typeof c === "object" && ("ok" in c || "pass" in c || "passed" in c)
	if (Array.isArray(checks)) {
		for (const c of checks) if (has(c)) items.push({ name: String(c.name ?? c.id ?? c.check ?? "").slice(0, 120), ok: okOf(c) })
	} else if (checks && typeof checks === "object") {
		if (Array.isArray(checks.items)) return checksSummary(checks.items)
		for (const [k, v] of Object.entries(checks)) {
			if (typeof v === "boolean") items.push({ name: k.slice(0, 120), ok: v })
			else if (has(v)) items.push({ name: k.slice(0, 120), ok: okOf(v) })
		}
	}
	return { passed: items.filter((i) => i.ok).length, total: items.length, items: items.slice(0, 200) }
}

// ---------------------------------------------------------------- the job's owner
const jobRow = async (db, gallery, job) => (await db.query("select owner, batch, (published_at is not null) as published from videos where gallery = $1 and job = $2", [gallery, job]))[0] ?? null
/** 409 when another key owns the job (the master key may touch any job). */
function ownJob(row, job, agent) {
	if (row.owner !== agent.name && !agent.master) throw new HttpError(409, "conflict", `the job "${job}" belongs to another agent key: pick another job name`)
	return row
}
/** The job's row for publishing: 404 when it was never uploaded, 409 when another key owns it. */
async function claimJob(db, gallery, job, agent) {
	const row = await jobRow(db, gallery, job)
	if (!row) throw new HttpError(404, "not_found", `nothing was uploaded for the job "${job}" (POST /api/videos/upload first)`)
	return ownJob(row, job, agent)
}
const alreadyPublished = (job) => new HttpError(409, "already_published", `the job "${job}" is published, so its files are final: make the new video under a new job name`)

// ---------------------------------------------------------------- each key's daily video caps (counters: key vid:<name>)
const dayOf = (t) => new Date(t).toISOString().slice(0, 10)
const nextDay = (t) => {
	const d = new Date(t)
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString()
}
/** Adds n to this key's counter `what` for today when the total stays at most cap (one statement: parallel requests line up). -> it did */
async function take(db, agent, what, n, cap, t) {
	const rows = await db.query(
		`insert into counters (key, bucket, n) select $1, $2, $3::int where $3::int <= $4::int
		on conflict (key, bucket) do update set n = counters.n + excluded.n where counters.n + excluded.n <= $4::int
		returning n`,
		[`vid:${agent.name}`, `${what}:${dayOf(t)}`, n, cap]
	)
	return rows.length > 0
}
const giveBack = (db, agent, what, n, t) => db.query("update counters set n = greatest(0, n - $3::int) where key = $1 and bucket = $2", [`vid:${agent.name}`, `${what}:${dayOf(t)}`, n])
const overCap = (agent, words, t) => new HttpError(403, "quota", `The agent key "${agent.name}" has used today's ${words}. It resets at 00:00 UTC.`, { resetsAt: nextDay(t) })
/** The key's caps (an agent from before the caps had none: the defaults). */
const capsOf = (agent) => ({ videos: Number(agent.videosPerDay) || VIDEO_DEFAULTS.videosPerDay, mb: Number(agent.uploadMbPerDay) || VIDEO_DEFAULTS.uploadMbPerDay })

// ---------------------------------------------------------------- POST /api/videos/upload
export async function upload(req, res, { env = process.env, now = () => Date.now() } = {}) {
	try {
		if (req.method !== "POST") throw new HttpError(405, "bad_input", "use POST", {}, { Allow: "POST" })
		const agent = await requireAgent(req, { env })
		const { gallery } = settings(env)
		const body = await readJson(req, 64 * 1024)
		const job = jobOf(body.job)
		if (!Array.isArray(body.files) || !body.files.length || body.files.length > Object.keys(FILES).length) throw new HttpError(400, "bad_input", `files must list 1-${Object.keys(FILES).length} files: [{name, type, size}]`)
		const seen = new Set()
		const want = body.files.map((f, i) => {
			if (!f || typeof f !== "object" || Array.isArray(f)) throw new HttpError(400, "bad_input", `files[${i}] must be {name, type, size}`)
			const spec = Object.hasOwn(FILES, f.name) ? FILES[f.name] : null
			if (!spec) throw new HttpError(400, "bad_input", `files[${i}].name must be one of ${Object.keys(FILES).join(", ")}`)
			if (seen.has(f.name)) throw new HttpError(400, "bad_input", `${f.name} is listed twice`)
			seen.add(f.name)
			if (String(f.type ?? "").trim().toLowerCase() !== spec.type) throw new HttpError(400, "bad_input", `${f.name} must have type ${spec.type}`)
			if (!Number.isSafeInteger(f.size) || f.size < 1) throw new HttpError(400, "bad_input", `${f.name}: size must be its length in bytes`)
			if (f.size > spec.max) throw new HttpError(413, "too_large", `${f.name} is too large (at most ${spec.max / MB} MB)`)
			return { name: f.name, type: spec.type, size: f.size }
		})
		const db = await getDb(env)
		const t = now()
		const row = await jobRow(db, gallery, job)
		if (row) ownJob(row, job, agent)
		if (row?.published) throw alreadyPublished(job)
		// today's caps: a new job counts as one of the key's videos; every grant counts its declared megabytes (asking again counts again)
		const caps = capsOf(agent)
		const mb = Math.max(1, Math.ceil(want.reduce((n, f) => n + f.size, 0) / MB))
		const fresh = !row
		if (fresh && !(await take(db, agent, "jobs", 1, caps.videos, t))) throw overCap(agent, `${caps.videos} new videos`, t)
		if (!(await take(db, agent, "mb", mb, caps.mb, t))) {
			if (fresh) await giveBack(db, agent, "jobs", 1, t)
			throw overCap(agent, `${caps.mb} MB of uploads (this asks for ${mb} MB)`, t)
		}
		if (fresh) {
			const made = await db.query("insert into videos (gallery, job, owner) values ($1, $2, $3) on conflict (gallery, job) do nothing returning owner", [gallery, job, agent.name])
			if (!made.length) {
				// another request made this job a moment ago (it counted the job): this one is a second ask for it
				await giveBack(db, agent, "jobs", 1, t)
				const now2 = await jobRow(db, gallery, job)
				try {
					ownJob(now2, job, agent)
					if (now2.published) throw alreadyPublished(job)
				} catch (e) {
					await giveBack(db, agent, "mb", mb, t)
					throw e
				}
			}
		}
		const validUntil = t + UPLOAD_TOKEN_MS
		const uploads = want.map((f) => {
			const pathname = `${jobPrefix(gallery, job)}${f.name}`
			const token = clientToken({ pathname, maximumSizeInBytes: f.size, allowedContentTypes: [f.type], validUntil, addRandomSuffix: false, allowOverwrite: true }, env)
			return { name: f.name, pathname, contentType: f.type, maxBytes: f.size, url: publicUrl(pathname, env), token, put: uploadRequest(pathname, token, f.type, env) }
		})
		logLine({ event: "video_upload", job, files: uploads.length, mb, agent: agent.name })
		return send(res, 200, { ok: true, job, prefix: jobPrefix(gallery, job), validUntil: new Date(validUntil).toISOString(), uploads }, {}, { scrub: scrubServerSecrets })
	} catch (e) {
		return answerError(res, e, "video_upload")
	}
}

// ---------------------------------------------------------------- POST /api/videos/publish
const COLS = `job, batch, title, request, lesson, seconds, checks, cost_usd::float8 as cost_usd, files, published_by, published_at, updated_at`
/**
 * One index entry (what index.json lists and the page shows) of a videos row. report_url is the job's report page on this site
 * (`${base}/videos/<gallery>/jobs/<job>/report`; base "" gives a path), files the raw Blob URLs.
 */
export function entryOf(r, { gallery, base = "" } = {}) {
	const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v)
	const files = asJson(r.files) ?? {}
	const urls = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.url]))
	const iso = (t) => (t instanceof Date ? t.toISOString() : new Date(t).toISOString())
	return {
		job: r.job,
		batch: r.batch ?? null,
		title: r.title,
		request: r.request,
		lesson: asJson(r.lesson) ?? {},
		seconds: Number(r.seconds),
		checks: checksSummary(asJson(r.checks)),
		cost_usd: r.cost_usd === null ? null : Number(r.cost_usd),
		published_by: r.published_by,
		published_at: iso(r.published_at),
		video_url: urls["video.mp4"] ?? null,
		poster_url: urls["poster.jpg"] ?? null,
		report_url: urls["report.html"] && gallery ? `${base}${jobPagePath(gallery, r.job, "report")}` : null,
		files: urls,
	}
}
async function publishedRows(db, gallery) {
	return db.query(`select ${COLS} from videos where gallery = $1 and published_at is not null order by published_at desc, job limit ${MAX_ENTRIES}`, [gallery])
}
const stampOf = (rows) => `${rows.length}:${rows.reduce((m, r) => Math.max(m, new Date(r.updated_at).getTime()), 0)}`

/** Rewrites the gallery's index.json and index.html (and these batches') from the database. Deterministic: the same rows give the same bytes. */
async function rewriteIndexes(db, env, gallery, batches, base) {
	const media = new URL(publicUrl(`${prefixOf(gallery)}/index.json`, env)).origin
	for (let round = 0; round < 3; round++) {
		const rows = await publishedRows(db, gallery)
		const entries = rows.map((r) => entryOf(r, { gallery, base }))
		const writes = []
		const add = (dir, list, batch) => {
			const updated = list.reduce((m, e) => (e.published_at > m ? e.published_at : m), null)
			const json = JSON.stringify({ version: 1, kind: "physics-sandbox-videos", ...(batch ? { batch } : {}), count: list.length, updated, videos: list }, null, 1)
			const html = renderGallery(list, batch ? { batch, homeHref: "../../index.html", batchHref: (b) => `../${encodeURIComponent(b)}/index.html`, mediaOrigin: media } : { mediaOrigin: media })
			writes.push([`${dir}/index.json`, json, "application/json"], [`${dir}/index.html`, html, "text/html; charset=utf-8"])
		}
		add(prefixOf(gallery), entries, null)
		for (const b of batches) add(`${prefixOf(gallery)}/batches/${b}`, entries.filter((e) => e.batch === b), b)
		for (let i = 0; i < writes.length; i += 4) await Promise.all(writes.slice(i, i + 4).map(([p, body, type]) => putBlob(p, body, { contentType: type, cacheControlMaxAge: INDEX_CACHE_S }, env)))
		// another publish that landed while these were written: write again from the newer rows (the last writer always writes the latest)
		if (stampOf(await publishedRows(db, gallery)) === stampOf(rows)) return
	}
}

export async function publish(req, res, { env = process.env, now = () => Date.now() } = {}) {
	try {
		if (req.method !== "POST") throw new HttpError(405, "bad_input", "use POST", {}, { Allow: "POST" })
		const agent = await requireAgent(req, { env })
		const { gallery } = settings(env)
		const body = await readJson(req, 128 * 1024)
		const job = jobOf(body.job)
		const batch = body.batch === undefined || body.batch === null || body.batch === "" ? null : jobOf(body.batch, "batch")
		const title = text(body.title, 200, "title")
		const request = text(body.request, 4000, "request")
		const l = body.lesson ?? {}
		if (typeof l !== "object" || Array.isArray(l)) throw new HttpError(400, "bad_input", "lesson must be {id?, grade?, concept?}")
		const lesson = Object.fromEntries(Object.entries({ id: text(l.id, 80, "lesson.id", { required: false }), grade: text(l.grade, 20, "lesson.grade", { required: false }), concept: text(l.concept, 200, "lesson.concept", { required: false }) }).filter(([, v]) => v !== null))
		const seconds = Number(body.seconds)
		if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw new HttpError(400, "bad_input", "seconds must be the video's length in seconds (more than 0, at most 3600)")
		const cost = Number(body.cost_usd)
		if (!Number.isFinite(cost) || cost < 0 || cost > 1000) throw new HttpError(400, "bad_input", "cost_usd must be what the video cost in dollars (0 to 1000)")
		if (JSON.stringify(body.checks ?? null).length > 64 * 1024) throw new HttpError(413, "too_large", "checks are too large (at most 64 KB)")
		// the gate: every check, the whole list, read strictly (an entry it can't read is 400, never skipped)
		const checks = readChecks(body.checks)
		const failed = checks.filter((c) => c.ok !== true).map((c) => c.name)
		const passed = checks.filter((c) => c.ok === true).length
		if (failed.length || passed !== checks.length) throw new HttpError(409, "checks_failed", `only a video whose checks all passed is published (${failed.length} of ${checks.length} failed: ${failed.slice(0, 5).join(", ")})`, { failed: failed.slice(0, 50) })

		const db = await getDb(env)
		const t = now()
		const before = await claimJob(db, gallery, job, agent)
		// what is in Blob for this job (the client tokens made sure each file has its name's type and size cap)
		const names = Object.keys(FILES)
		const heads = []
		for (let i = 0; i < names.length; i += 4) heads.push(...(await Promise.all(names.slice(i, i + 4).map((n) => headBlob(`${jobPrefix(gallery, job)}${n}`, env)))))
		const files = {}
		names.forEach((n, i) => {
			const h = heads[i]
			if (h && h.size > 0) files[n] = { url: h.url || publicUrl(`${jobPrefix(gallery, job)}${n}`, env), size: h.size, contentType: h.contentType, uploadedAt: h.uploadedAt, etag: h.etag }
		})
		const missing = names.filter((n) => FILES[n].required && !files[n])
		if (missing.length) throw new HttpError(409, "missing_files", `upload ${missing.join(" and ")} before publishing`, { missing })
		const wrong = names.filter((n) => files[n] && !String(files[n].contentType).toLowerCase().startsWith(FILES[n].type))
		if (wrong.length) throw new HttpError(409, "bad_files", `${wrong.join(", ")} ${wrong.length > 1 ? "are" : "is"} not of the right type`, { wrong })
		// (each publish rewrites 2-4 index files in Blob: a key publishes at most 3 times a day per video of its cap)
		const pubCap = capsOf(agent).videos * 3
		if (!(await take(db, agent, "pub", 1, pubCap, t))) throw overCap(agent, `${pubCap} publishes`, t)

		const row = (
			await db.query(
				`update videos set batch = $3, title = $4, request = $5, lesson = $6::json, seconds = $7, checks = $8::json, cost_usd = $9, files = $10::json,
					published_by = $11, published_at = coalesce(published_at, now()), updated_at = now()
				where gallery = $1 and job = $2 returning published_at`,
				[gallery, job, batch, title, request, JSON.stringify(lesson), seconds, JSON.stringify(checks), cost, JSON.stringify(files), agent.name]
			)
		)[0]
		await rewriteIndexes(db, env, gallery, [...new Set([batch, before.batch].filter(Boolean))], siteBase(req, env))
		const origin = siteOrigin(req, env)
		const at = (p) => publicUrl(`${prefixOf(gallery)}/${p}`, env)
		logLine({ event: "video_publish", job, batch, agent: agent.name, files: Object.keys(files).length })
		return send(res, 200, {
			ok: true,
			job,
			batch,
			video_url: files["video.mp4"].url,
			poster_url: files["poster.jpg"].url,
			report_url: files["report.html"] ? `${origin}${jobPagePath(gallery, job, "report")}` : null,
			gallery_url: `${origin}${galleryPagePath(gallery)}`,
			gallery_json_url: at("index.json"),
			gallery_html_url: at("index.html"),
			batch_url: batch ? `${origin}${galleryPagePath(gallery, batch)}` : null,
			batch_json_url: batch ? at(`batches/${batch}/index.json`) : null,
			published_by: agent.name,
			published_at: new Date(row.published_at).toISOString(),
			checks: { passed, total: checks.length },
		})
	} catch (e) {
		return answerError(res, e, "video_publish")
	}
}

// ---------------------------------------------------------------- GET /videos/<gallery>[/batches/<batch>] -> /api/videos/gallery
//                                                                  GET /videos/<gallery>/jobs/<job>/<file> -> the same, ?job=&file=
const sameId = (a, b) => timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest())
/** A page with a strict CSP: no script, pictures and video only from Blob (and, for a report, this site: its relative links redirect there). */
function page(res, status, html, mediaOrigin = "", { self = false } = {}) {
	const src = [self && "'self'", mediaOrigin].filter(Boolean).join(" ") || "'none'"
	res.statusCode = status
	res.setHeader("Content-Type", "text/html; charset=utf-8")
	res.setHeader("Cache-Control", "no-store")
	res.setHeader("Content-Security-Policy", `default-src 'none'; img-src ${src}; media-src ${src}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
	res.setHeader("X-Robots-Tag", "noindex, nofollow")
	res.setHeader("Referrer-Policy", "no-referrer")
	res.setHeader("X-Content-Type-Options", "nosniff")
	res.end(html)
}
const notice = (title, words) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:48px 16px;text-align:center;background:#f6f6f3;color:#1d1d1b}@media (prefers-color-scheme:dark){body{background:#141413;color:#ecebe6}}</style></head><body><h1 style="font-size:20px">${title}</h1><p>${words}</p></body></html>`
const unavailablePage = (res) => page(res, 503, notice("Not available right now", "The gallery can't be reached right now. Try again in a moment."))

export async function gallery(req, res, { env = process.env } = {}) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.setHeader("Allow", "GET")
		return page(res, 405, notice("Not allowed", "This page is read with GET."))
	}
	const { query } = urlOf(req)
	const g = galleryId(env)
	if (!g || !sameId(query.gallery ?? "", g)) return page(res, 404, notice("Not found", "There is no gallery at this address."))
	if (query.job !== undefined || query.file !== undefined) return jobFile(req, res, env, g, query.job, query.file)
	const batch = query.batch ? (JOB_RE.test(query.batch) ? query.batch : null) : null
	if (query.batch && !batch) return page(res, 404, notice("Not found", "There is no such batch."))
	try {
		if (!blobConfigured(env)) throw new HttpError(503, "not_configured", "no store")
		const db = await getDb(env)
		const entries = (await publishedRows(db, g)).map((r) => entryOf(r, { gallery: g })).filter((e) => !batch || e.batch === batch)
		const media = new URL(publicUrl(`${prefixOf(g)}/index.json`, env)).origin
		const html = renderGallery(entries, {
			batch,
			homeHref: galleryPagePath(g),
			batchHref: (b) => galleryPagePath(g, b),
			jsonHref: publicUrl(`${prefixOf(g)}/${batch ? `batches/${batch}/` : ""}index.json`, env),
			mediaOrigin: media,
		})
		return page(res, 200, req.method === "HEAD" ? "" : html, media)
	} catch (e) {
		logLine({ event: "video_gallery", code: e?.code ?? "error" })
		return unavailablePage(res)
	}
}

/**
 * A published job's file at /videos/<gallery>/jobs/<job>/<file>: "report" (or report.html) is the job's report as a page (Blob would hand it
 * out as a download), captions.vtt is served from here (a <track> loads same-origin only), any other of the job's files redirects (302) to its
 * Blob URL. A job not published, or a file it doesn't have: 404.
 */
async function jobFile(req, res, env, g, job, file) {
	const name = file === "report" ? "report.html" : String(file ?? "")
	if (!JOB_RE.test(String(job ?? "")) || !Object.hasOwn(FILES, name)) return page(res, 404, notice("Not found", "There is no such file."))
	try {
		if (!blobConfigured(env)) throw new HttpError(503, "not_configured", "no store")
		const db = await getDb(env)
		const row = (await db.query("select files from videos where gallery = $1 and job = $2 and published_at is not null", [g, job]))[0]
		const files = (row && (typeof row.files === "string" ? JSON.parse(row.files) : row.files)) || {}
		const f = Object.hasOwn(files, name) ? files[name] : null
		if (!f?.url) return page(res, 404, notice("Not found", "This video has no such file."))
		const media = new URL(publicUrl(`${prefixOf(g)}/index.json`, env)).origin
		if (name === "report.html" || name === "captions.vtt") {
			const got = await readPublicBlob(f.url, { maxBytes: FILES[name].max }, env)
			if (!got) return page(res, 404, notice("Not found", "This video has no such file."))
			const body = req.method === "HEAD" ? "" : got.body
			if (name === "report.html") return page(res, 200, body, media, { self: true })
			res.statusCode = 200
			res.setHeader("Content-Type", "text/vtt; charset=utf-8")
			res.setHeader("Cache-Control", "no-store")
			res.setHeader("X-Content-Type-Options", "nosniff")
			res.setHeader("X-Robots-Tag", "noindex, nofollow")
			return res.end(body)
		}
		if (new URL(f.url).origin !== media) throw new HttpError(503, "unavailable", "not this store's file")
		res.statusCode = 302
		res.setHeader("Location", f.url)
		res.setHeader("Cache-Control", "no-store")
		res.setHeader("Referrer-Policy", "no-referrer")
		res.setHeader("X-Robots-Tag", "noindex, nofollow")
		return res.end()
	} catch (e) {
		logLine({ event: "video_job_file", code: e?.code ?? "error" })
		return unavailablePage(res)
	}
}

function answerError(res, e, event) {
	if (e instanceof DbUnavailable) e = new HttpError(503, "unavailable", "The video gallery's database can't be reached right now. Try again in a moment.", { retryable: true }, { "Retry-After": "2" })
	if (e instanceof HttpError) {
		if (e.status >= 500 || e.status === 403) logLine({ event, status: e.status, code: e.code })
		return failWith(res, e)
	}
	logLine({ event, status: 500, error: String(e?.name ?? "error") })
	return fail(res, 500, "internal", "the request failed on the server")
}
