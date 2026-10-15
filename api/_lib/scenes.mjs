// A person's scenes in the database: every query is scoped by owner_id (another person's scene, a deleted one or a made-up id are all "not
// found"), the server makes every id, scenes are web/sim's clean() output kept as text, pictures are WebP / JPEG / PNG checked by their first
// bytes. Limits: docs/ACCOUNTS.md §3.2. The routes that call these: api/scenes/index.mjs.
// Storage is bounded three ways, so one person can never fill the shared database (Neon's free plan blocks every write past 1 GB):
//   - a scene is at most MAX_SCENE_BYTES (a 200-item scene is about 60 KB);
//   - a person's bytes count their deleted scenes too, while those can still be restored (the 30-day bin). When a save needs room, the oldest
//     deleted scenes are removed for good first (a bin that empties itself), so deleting always frees room and creating and deleting in a loop
//     never grows the database;
//   - the whole site's bytes (SCENES_SITE_MAX_BYTES, default 700 MB of the 1 GB): past it every save that grows is refused with 403
//     storage_full until room is made (expired bin rows are removed first).
import { createHash } from "node:crypto"
import { HttpError } from "./http.mjs"
import { newId } from "./accounts.mjs"

export const ID_RE = /^s_[a-z2-7]{16}$/
export const RESTORE_DAYS = 30
export const MAX_SCENE_BYTES = 256 * 1024
export const MAX_THUMB_BYTES = 150 * 1024

/** The limits of this deployment (SCENES_MAX_PER_USER, SCENES_MAX_BYTES_PER_USER, SCENES_WRITES_PER_HOUR, SCENES_COPIES_PER_DAY, SCENES_SITE_MAX_BYTES). */
export function limits(env = process.env) {
	const n = (k, d, lo, hi) => {
		const v = Number(env[k])
		return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= lo ? Math.min(hi, Math.floor(v)) : d
	}
	return {
		maxScenes: n("SCENES_MAX_PER_USER", 500, 1, 100000),
		maxBytes: n("SCENES_MAX_BYTES_PER_USER", 10 << 20, 1 << 20, 1 << 30),
		writesPerHour: n("SCENES_WRITES_PER_HOUR", 120, 1, 100000),
		copiesPerDay: n("SCENES_COPIES_PER_DAY", 600, 1, 100000),
		siteMaxBytes: n("SCENES_SITE_MAX_BYTES", 700 << 20, 1 << 20, 2 ** 40),
	}
}

// ---------------------------------------------------------------- input
/** The characters a scene's name keeps (the same rule as web/account/util.js cleanName): letters, digits, spaces and ordinary punctuation
 *  (_ - ' ’ . , : ; ( ) & ! ? + #). Names are only ever shown as text, never as HTML, so this is about tidiness, not safety. */
const NAME_DROP = /[^\p{L}\p{N}_\-'\u2019.,:;()&!?+# ]/gu
/** A scene's name: those characters, spaces collapsed, trimmed, 60 characters; empty (or no letter or digit at all): "Scene HHMMSS". */
export function normName(name, now = new Date()) {
	const kept = String(name ?? "").replace(/\s+/g, " ").replace(NAME_DROP, "").replace(/ {2,}/g, " ").trim()
	const cut = [...kept].slice(0, 60).join("").trim()
	return /[\p{L}\p{N}]/u.test(cut) ? cut : `Scene ${now.toISOString().slice(11, 19).replaceAll(":", "")}` // (punctuation alone is no name)
}
/** The app's scenario a scene was saved as with Save (its id: the name lower-cased, - for spaces), so picking it from the menu again continues
 *  the same scene. null clears it. */
const SAVED_AS_RE = /^[\p{L}\p{N}_'\-]{1,80}$/u
export function normSavedAs(v) {
	if (v === null) return null
	if (typeof v !== "string" || !SAVED_AS_RE.test(v)) throw new HttpError(400, "bad_input", "savedAs must be a scenario id (letters, digits, _ - ', at most 80) or null")
	return v
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
const COLS = `id, name, item_count, version, scene_bytes + coalesce(octet_length(thumb), 0) as bytes, thumb_etag, saved_as,
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
	savedAs: r.saved_as ?? null,
})

// ---------------------------------------------------------------- queries
const SIZE = "scene_bytes + coalesce(octet_length(thumb), 0)"
const IN_BIN = `deleted_at > now() - interval '${RESTORE_DAYS} days'`
/** {scenes, bytes} this account shows (deleted ones not counted), and `held`: those bytes plus its deleted scenes still in the bin. */
export async function usageOf(db, owner) {
	const r = (
		await db.query(
			`select count(*) filter (where deleted_at is null)::int as n,
				coalesce(sum(${SIZE}) filter (where deleted_at is null), 0)::float8 as bytes,
				coalesce(sum(${SIZE}), 0)::float8 as held
			from scenes where owner_id = $1 and (deleted_at is null or ${IN_BIN})`,
			[owner]
		)
	)[0]
	return { scenes: r?.n ?? 0, bytes: Number(r?.bytes ?? 0), held: Number(r?.held ?? 0) }
}
/** Every byte of every scene on the site (deleted ones too: they take room until they are removed). */
export async function siteBytes(db) {
	return Number((await db.query(`select coalesce(sum(${SIZE}), 0)::float8 as b from scenes`, []))[0]?.b ?? 0)
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
	what === "site"
		? new HttpError(403, "storage_full", "Saving to accounts is paused: this site's storage is full. Your scenes are safe; try again later.", { quota: "site" })
		: new HttpError(403, "quota", what === "scenes" ? `You've reached ${lim.maxScenes} saved scenes. Delete some to save more.` : `Your scenes have reached ${Math.round(lim.maxBytes / 1048576)} MB. Delete some to save more.`, { quota: what })

/**
 * Makes room for `need` more bytes in this account: removes the site's expired bin rows when the site is over its limit, then this account's
 * oldest deleted scenes (the bin empties itself, oldest first) until the account and the site fit. -> true when anything was removed.
 */
async function makeRoom(db, owner, need, lim) {
	let freed = false
	let site = await siteBytes(db)
	if (site + need > lim.siteMaxBytes) {
		const gone = await db.query(`delete from scenes where deleted_at is not null and not (${IN_BIN}) returning id`, [])
		if (gone.length) ((freed = true), (site = await siteBytes(db)))
	}
	const u = await usageOf(db, owner)
	const excess = Math.max(u.held + need - lim.maxBytes, site + need - lim.siteMaxBytes)
	if (excess > 0 && u.held > u.bytes) {
		const gone = await db.query(
			`delete from scenes where id in (
				select id from (select id, ${SIZE} as b, sum(${SIZE}) over (order by deleted_at, id) as cum from scenes where owner_id = $1 and deleted_at is not null) t
				where t.cum - t.b < $2
			) and owner_id = $1 and deleted_at is not null returning id`,
			[owner, excess]
		)
		if (gone.length) freed = true
	}
	return freed
}
/** The refusal for a write of `need` bytes that doesn't fit: scenes (count), the site's storage, or this account's bytes. */
async function refusal(db, owner, need, lim, counting = true) {
	const u = await usageOf(db, owner)
	if (counting && u.scenes >= lim.maxScenes) return quotaError("scenes", lim)
	if ((await siteBytes(db)) + need > lim.siteMaxBytes) return quotaError("site", lim)
	return quotaError("bytes", lim)
}

/** A new scene ({id?, name, text, items, thumb?, savedAs?}); 403 quota / storage_full when the account or the site is full. -> meta */
export async function createScene(db, owner, s, lim) {
	const id = s.id ?? newId("s")
	const need = Buffer.byteLength(s.text) + (s.thumb?.bytes.length ?? 0)
	for (let attempt = 0; attempt < 2; attempt++) {
		const rows = await db.query(
			`insert into scenes (id, owner_id, name, scene, scene_bytes, item_count, thumb, thumb_type, thumb_etag, saved_as)
			select $1::text, $2::text, $3::text, $4::json, $5::int, $6::int, decode($7::text, 'hex'), $8::text, $9::text, $13::text
			where (select count(*) from scenes where owner_id = $2::text and deleted_at is null) < $10::int
			  and (select coalesce(sum(${SIZE}), 0) from scenes where owner_id = $2::text and (deleted_at is null or ${IN_BIN})) + $11::bigint <= $12::bigint
			  and (select coalesce(sum(${SIZE}), 0) from scenes) + $11::bigint <= $14::bigint
			returning ${COLS}`,
			[id, owner, s.name, s.text, Buffer.byteLength(s.text), s.items, s.thumb ? s.thumb.bytes.toString("hex") : null, s.thumb?.type ?? null, s.thumb?.etag ?? null, lim.maxScenes, need, lim.maxBytes, s.savedAs ?? null, lim.siteMaxBytes]
		)
		if (rows.length) return metaOf(rows[0])
		const u = await usageOf(db, owner)
		if (u.scenes >= lim.maxScenes || attempt > 0 || !(await makeRoom(db, owner, need, lim))) break
	}
	throw await refusal(db, owner, need, lim)
}

/**
 * Changes a scene: any of {name, text + items, thumb (null removes it), savedAs (null clears it)}. A name or scene change adds 1 to version
 * and moves updatedAt; a picture or savedAs alone changes neither. ifMatch (a version) that is stale: 412 conflict with the current meta.
 * -> meta, or null when not found. known: the scene as just read (getScene), so it is not read twice.
 */
export async function updateScene(db, owner, id, patch, ifMatch, lim, known = null) {
	const cur = known ?? (await getScene(db, owner, id))
	if (!cur) return null
	if (ifMatch != null && cur.meta.version !== ifMatch) throw new HttpError(412, "conflict", "This scene was changed somewhere else since it was opened", { current: cur.meta })
	const content = patch.name !== undefined || patch.text !== undefined
	const oldText = Buffer.byteLength(cur.text)
	const newBytes = patch.text !== undefined ? Buffer.byteLength(patch.text) : null
	const grow = (newBytes !== null ? newBytes - oldText : 0) + (patch.thumb !== undefined ? (patch.thumb?.bytes.length ?? 0) - (cur.meta.bytes - oldText) : 0)
	if (grow > 0) {
		const fits = async () => {
			const u = await usageOf(db, owner)
			return u.held + grow <= lim.maxBytes && (await siteBytes(db)) + grow <= lim.siteMaxBytes
		}
		if (!(await fits()) && !((await makeRoom(db, owner, grow, lim)) && (await fits()))) throw await refusal(db, owner, grow, lim, false)
	}
	const setThumb = patch.thumb !== undefined
	const setSaved = patch.savedAs !== undefined
	const rows = await db.query(
		`update scenes set
			name = coalesce($3::text, name),
			scene = coalesce($4::json, scene),
			scene_bytes = coalesce($5::int, scene_bytes),
			item_count = coalesce($6::int, item_count),
			thumb = case when $7::boolean then decode($8::text, 'hex') else thumb end,
			thumb_type = case when $7::boolean then $9::text else thumb_type end,
			thumb_etag = case when $7::boolean then $10::text else thumb_etag end,
			saved_as = case when $13::boolean then $14::text else saved_as end,
			version = version + $11::int,
			updated_at = case when $11::int = 1 then now() else updated_at end
		where id = $1 and owner_id = $2 and deleted_at is null and ($12::int is null or version = $12)
		returning ${COLS}`,
		[id, owner, patch.name ?? null, patch.text ?? null, newBytes, patch.items ?? null, setThumb, patch.thumb ? patch.thumb.bytes.toString("hex") : null, patch.thumb?.type ?? null, patch.thumb?.etag ?? null, content ? 1 : 0, ifMatch ?? null, setSaved, patch.savedAs ?? null]
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
	await db.query(`delete from scenes where owner_id = $1 and deleted_at is not null and not (${IN_BIN})`, [owner])
	return iso(r.deleted_ms + RESTORE_DAYS * 86400_000)
}

/** Brings back a scene deleted in the last RESTORE_DAYS (403 quota when the account has its most scenes; its bytes are already counted while
 *  it is in the bin). -> meta, or null (never deleted by this account, or removed from the bin since). */
export async function restoreScene(db, owner, id, lim) {
	const r = (await db.query(`select ${COLS} from scenes where id = $1 and owner_id = $2`, [id, owner]))[0]
	if (!r) return null
	if (r.deleted_ms === null || r.deleted_ms === undefined) return metaOf(r) // (not deleted: nothing to do)
	if (Date.now() - r.deleted_ms > RESTORE_DAYS * 86400_000) return null
	const u = await usageOf(db, owner)
	if (u.scenes >= lim.maxScenes) throw quotaError("scenes", lim)
	const rows = await db.query(`update scenes set deleted_at = null where id = $1 and owner_id = $2 and deleted_at is not null returning ${COLS}`, [id, owner])
	return rows.length ? metaOf(rows[0]) : null
}

/** {bytes, type, etag} of a scene's picture, or null. */
export async function getThumb(db, owner, id) {
	const r = (await db.query("select encode(thumb, 'base64') as b64, thumb_type, thumb_etag from scenes where id = $1 and owner_id = $2 and deleted_at is null and thumb is not null", [id, owner]))[0]
	return r ? { bytes: Buffer.from(String(r.b64).replace(/\s+/g, ""), "base64"), type: r.thumb_type, etag: r.thumb_etag } : null
}

/**
 * Counts one write; 429 rate_limited (Retry-After) over the limit. Ordinary writes (autosave, rename, delete, restore): SCENES_WRITES_PER_HOUR
 * an hour. "Copy this browser's scenes to my account" (copy: true on a create) has a bucket of its own, SCENES_COPIES_PER_DAY a day, so copying
 * a whole library never uses up the hour's writes the autosave needs (and the account's bytes still bound what a copy can add).
 */
export async function countWrite(db, owner, lim, now = new Date(), { copy = false } = {}) {
	const bucket = copy ? `c:d:${now.toISOString().slice(0, 10)}` : `w:h:${now.toISOString().slice(0, 13)}`
	const max = copy ? lim.copiesPerDay : lim.writesPerHour
	const n = (await db.query("insert into counters (key, bucket, n) values ($1, $2, 1) on conflict (key, bucket) do update set n = counters.n + 1 returning n", [owner, bucket]))[0]?.n ?? 0
	if (n > max) {
		const s = Math.floor(now.getTime() / 1000)
		const wait = Math.max(1, copy ? 86400 - (s % 86400) : 3600 - (s % 3600))
		const words = copy
			? `That's a lot of copying: ${max} scenes a day at most. The rest can be copied tomorrow.`
			: `That's a lot of saving: ${max} changes an hour at most. Try again in ${Math.ceil(wait / 60)} min.`
		throw new HttpError(429, "rate_limited", words, { retryable: true, retryAfter: wait, ...(copy ? { copy: true } : {}) }, { "Retry-After": String(wait) })
	}
}

/** Removes the account and everything it holds (its identities and scenes go with it; its counters too). */
export async function deleteAccount(db, owner) {
	await db.query("delete from counters where key = $1", [owner])
	await db.query("delete from accounts where id = $1", [owner])
}
