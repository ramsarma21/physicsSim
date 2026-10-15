// A person's scenes in the database: every query is scoped by owner_id (another person's scene, a deleted one or a made-up id are all "not
// found"), the server makes every id, scenes are web/sim's clean() output kept as text, pictures are WebP / JPEG / PNG checked by their first
// bytes. Limits: docs/ACCOUNTS.md §3.2. The routes that call these: api/scenes/index.mjs.
import { createHash } from "node:crypto"
import { HttpError } from "./http.mjs"
import { newId } from "./accounts.mjs"

export const ID_RE = /^s_[a-z2-7]{16}$/
export const RESTORE_DAYS = 30
export const MAX_SCENE_BYTES = 1 << 20
export const MAX_THUMB_BYTES = 150 * 1024

/** The limits of this deployment (SCENES_MAX_PER_USER, SCENES_MAX_BYTES_PER_USER, SCENES_WRITES_PER_HOUR). */
export function limits(env = process.env) {
	const n = (k, d, lo, hi) => {
		const v = Number(env[k])
		return Number.isFinite(v) && v >= lo ? Math.min(hi, Math.floor(v)) : d
	}
	return { maxScenes: n("SCENES_MAX_PER_USER", 500, 1, 100000), maxBytes: n("SCENES_MAX_BYTES_PER_USER", 50 << 20, 1 << 20, 1 << 30), writesPerHour: n("SCENES_WRITES_PER_HOUR", 120, 1, 100000) }
}

// ---------------------------------------------------------------- input
/** A scene's name, as the in-page save makes it (web/sim/api.js): letters, digits, spaces, _ - ', trimmed, 60 characters; empty: "Scene HHMMSS". */
export function normName(name, now = new Date()) {
	const kept = String(name ?? "").replace(/[^\p{L}\p{N}_\-' ]/gu, "").trim()
	const cut = [...kept].slice(0, 60).join("")
	return cut || `Scene ${now.toISOString().slice(11, 19).replaceAll(":", "")}`
}

const SNIFF = [
	["image/png", (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a],
	["image/jpeg", (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
	["image/webp", (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP"],
]
/** A picture from a data URL: {bytes, type, etag}, or throws 400/413. Only WebP, JPEG or PNG, by their first bytes (never SVG). */
export function parseThumb(dataUrl) {
	if (typeof dataUrl !== "string") throw new HttpError(400, "bad_input", "thumb must be a data URL (data:image/webp;base64,...) or null")
	const m = dataUrl.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/)
	if (!m) throw new HttpError(400, "bad_input", "thumb must be a WebP, JPEG or PNG data URL")
	if ((m[2].length * 3) / 4 > MAX_THUMB_BYTES + 3) throw new HttpError(413, "too_large", `the picture is too large (at most ${MAX_THUMB_BYTES >> 10} KB)`)
	const bytes = Buffer.from(m[2], "base64")
	if (bytes.length > MAX_THUMB_BYTES) throw new HttpError(413, "too_large", `the picture is too large (at most ${MAX_THUMB_BYTES >> 10} KB)`)
	const type = SNIFF.find(([, is]) => is(bytes))?.[0]
	if (!type || type !== m[1]) throw new HttpError(400, "bad_input", "the picture is not the WebP, JPEG or PNG it says it is")
	return { bytes, type, etag: createHash("sha256").update(bytes).digest("hex").slice(0, 16) }
}

// ---------------------------------------------------------------- answers
const COLS = `id, name, item_count, version, scene_bytes + coalesce(octet_length(thumb), 0) as bytes, thumb_etag,
	(extract(epoch from created_at) * 1000)::float8 as created_ms, (extract(epoch from updated_at) * 1000)::float8 as updated_ms,
	(extract(epoch from deleted_at) * 1000)::float8 as deleted_ms`
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null)
/** A scene's meta as answers carry it. */
export const metaOf = (r) => ({
	id: r.id,
	name: r.name,
	items: r.item_count,
	bytes: Number(r.bytes),
	version: r.version,
	createdAt: iso(r.created_ms),
	updatedAt: iso(r.updated_ms),
	thumb: r.thumb_etag ? `/api/scenes/${r.id}/thumb?v=${r.thumb_etag}` : null,
})

// ---------------------------------------------------------------- queries
/** {scenes, bytes} this account holds (deleted ones not counted). */
export async function usageOf(db, owner) {
	const r = (await db.query("select count(*)::int as n, coalesce(sum(scene_bytes + coalesce(octet_length(thumb), 0)), 0)::float8 as bytes from scenes where owner_id = $1 and deleted_at is null", [owner]))[0]
	return { scenes: r?.n ?? 0, bytes: Number(r?.bytes ?? 0) }
}

export async function listScenes(db, owner, max = 500) {
	const rows = await db.query(`select ${COLS} from scenes where owner_id = $1 and deleted_at is null order by updated_at desc, id limit $2`, [owner, max])
	return rows.map(metaOf)
}

/** {meta, text} of one of this account's scenes (the scene JSON as stored), or null. */
export async function getScene(db, owner, id) {
	const r = (await db.query(`select ${COLS}, scene::text as scene_text from scenes where id = $1 and owner_id = $2 and deleted_at is null`, [id, owner]))[0]
	return r ? { meta: metaOf(r), text: r.scene_text } : null
}

const quotaError = (what, lim) =>
	new HttpError(403, "quota", what === "scenes" ? `You've reached ${lim.maxScenes} saved scenes. Delete some to save more.` : `Your scenes have reached ${Math.round(lim.maxBytes / 1048576)} MB. Delete some to save more.`, { quota: what })

/** A new scene ({id?, name, text, items, thumb?}); 403 quota when the account is full. -> meta */
export async function createScene(db, owner, s, lim) {
	const id = s.id ?? newId("s")
	const tb = s.thumb?.bytes.length ?? 0
	const rows = await db.query(
		`insert into scenes (id, owner_id, name, scene, scene_bytes, item_count, thumb, thumb_type, thumb_etag)
		select $1::text, $2::text, $3::text, $4::json, $5::int, $6::int, decode($7::text, 'hex'), $8::text, $9::text
		where (select count(*) from scenes where owner_id = $2::text and deleted_at is null) < $10::int
		  and (select coalesce(sum(scene_bytes + coalesce(octet_length(thumb), 0)), 0) from scenes where owner_id = $2::text and deleted_at is null) + $5::int + $11::int <= $12::bigint
		returning ${COLS}`,
		[id, owner, s.name, s.text, Buffer.byteLength(s.text), s.items, s.thumb ? s.thumb.bytes.toString("hex") : null, s.thumb?.type ?? null, s.thumb?.etag ?? null, lim.maxScenes, tb, lim.maxBytes]
	)
	if (rows.length) return metaOf(rows[0])
	const u = await usageOf(db, owner)
	throw quotaError(u.scenes >= lim.maxScenes ? "scenes" : "bytes", lim)
}

/**
 * Changes a scene: any of {name, text + items, thumb (null removes it)}. A name or scene change adds 1 to version and moves updatedAt; a
 * picture alone changes neither. ifMatch (a version) that is stale: 412 conflict with the current meta. -> meta, or null when not found.
 * known: the scene as just read (getScene), so it is not read twice.
 */
export async function updateScene(db, owner, id, patch, ifMatch, lim, known = null) {
	const cur = known ?? (await getScene(db, owner, id))
	if (!cur) return null
	if (ifMatch != null && cur.meta.version !== ifMatch) throw new HttpError(412, "conflict", "This scene was changed somewhere else since it was opened", { current: cur.meta })
	const content = patch.name !== undefined || patch.text !== undefined
	const newBytes = (patch.text !== undefined ? Buffer.byteLength(patch.text) : null)
	if (newBytes !== null || patch.thumb) {
		const u = await usageOf(db, owner)
		const grow = (newBytes !== null ? newBytes - Buffer.byteLength(cur.text) : 0) + (patch.thumb ? patch.thumb.bytes.length : 0)
		if (grow > 0 && u.bytes + grow > lim.maxBytes) throw quotaError("bytes", lim)
	}
	const setThumb = patch.thumb !== undefined
	const rows = await db.query(
		`update scenes set
			name = coalesce($3::text, name),
			scene = coalesce($4::json, scene),
			scene_bytes = coalesce($5::int, scene_bytes),
			item_count = coalesce($6::int, item_count),
			thumb = case when $7::boolean then decode($8::text, 'hex') else thumb end,
			thumb_type = case when $7::boolean then $9::text else thumb_type end,
			thumb_etag = case when $7::boolean then $10::text else thumb_etag end,
			version = version + $11::int,
			updated_at = case when $11::int = 1 then now() else updated_at end
		where id = $1 and owner_id = $2 and deleted_at is null and ($12::int is null or version = $12)
		returning ${COLS}`,
		[id, owner, patch.name ?? null, patch.text ?? null, newBytes, patch.items ?? null, setThumb, patch.thumb ? patch.thumb.bytes.toString("hex") : null, patch.thumb?.type ?? null, patch.thumb?.etag ?? null, content ? 1 : 0, ifMatch ?? null]
	)
	if (rows.length) return metaOf(rows[0])
	const now = await getScene(db, owner, id) // (changed between the read and the write)
	if (!now) return null
	throw new HttpError(412, "conflict", "This scene was changed somewhere else since it was opened", { current: now.meta })
}

/** Marks a scene deleted (restorable for RESTORE_DAYS); removes this account's scenes deleted longer ago than that. -> restoreUntil ISO, or null. */
export async function deleteScene(db, owner, id) {
	const r = (await db.query("update scenes set deleted_at = now() where id = $1 and owner_id = $2 and deleted_at is null returning (extract(epoch from deleted_at) * 1000)::float8 as deleted_ms", [id, owner]))[0]
	if (!r) return null
	await db.query(`delete from scenes where owner_id = $1 and deleted_at < now() - interval '${RESTORE_DAYS} days'`, [owner])
	return iso(r.deleted_ms + RESTORE_DAYS * 86400_000)
}

/** Brings back a scene deleted in the last RESTORE_DAYS (403 quota when the account is full). -> meta, or null. */
export async function restoreScene(db, owner, id, lim) {
	const r = (await db.query(`select ${COLS} from scenes where id = $1 and owner_id = $2`, [id, owner]))[0]
	if (!r) return null
	if (r.deleted_ms === null || r.deleted_ms === undefined) return metaOf(r) // (not deleted: nothing to do)
	if (Date.now() - r.deleted_ms > RESTORE_DAYS * 86400_000) return null
	const u = await usageOf(db, owner)
	if (u.scenes >= lim.maxScenes) throw quotaError("scenes", lim)
	if (u.bytes + Number(r.bytes) > lim.maxBytes) throw quotaError("bytes", lim)
	const rows = await db.query(`update scenes set deleted_at = null where id = $1 and owner_id = $2 and deleted_at is not null returning ${COLS}`, [id, owner])
	return rows.length ? metaOf(rows[0]) : null
}

/** {bytes, type, etag} of a scene's picture, or null. */
export async function getThumb(db, owner, id) {
	const r = (await db.query("select encode(thumb, 'base64') as b64, thumb_type, thumb_etag from scenes where id = $1 and owner_id = $2 and deleted_at is null and thumb is not null", [id, owner]))[0]
	return r ? { bytes: Buffer.from(String(r.b64).replace(/\s+/g, ""), "base64"), type: r.thumb_type, etag: r.thumb_etag } : null
}

/** Counts one write this hour; 429 rate_limited (Retry-After: seconds to the next hour) over the limit. */
export async function countWrite(db, owner, lim, now = new Date()) {
	const bucket = `w:h:${now.toISOString().slice(0, 13)}`
	const n = (await db.query("insert into counters (key, bucket, n) values ($1, $2, 1) on conflict (key, bucket) do update set n = counters.n + 1 returning n", [owner, bucket]))[0]?.n ?? 0
	if (n > lim.writesPerHour) {
		const wait = Math.max(1, 3600 - Math.floor((now.getTime() / 1000) % 3600))
		throw new HttpError(429, "rate_limited", `That's a lot of saving: ${lim.writesPerHour} changes an hour at most. Try again in ${Math.ceil(wait / 60)} min.`, { retryable: true, retryAfter: wait }, { "Retry-After": String(wait) })
	}
}

/** Removes the account and everything it holds (its identities and scenes go with it; its counters too). */
export async function deleteAccount(db, owner) {
	await db.query("delete from counters where key = $1", [owner])
	await db.query("delete from accounts where id = $1", [owner])
}
