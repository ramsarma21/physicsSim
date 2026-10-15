// My scenes, kept in this browser: IndexedDB (one database per ?profile), with the same interface as the account's library (./cloud.js).
// See ./store.js for the interface every backend has. Database "sandbox-scenes" ("sandbox-scenes@<profile>" with ?profile=), version 1:
//   meta    {id, name, items, bytes, version, createdAt, updatedAt, thumb: {etag, type, bytes} | null, savedAs, origin, deletedAt}   (keyPath id)
//   data    id -> the scene as JSON text (exactly what was on the table)
//   thumbs  id -> the card's picture (a Blob: WebP, or JPEG where the browser can't make WebP)
// Where IndexedDB can't be opened (some private windows, blocked site data) the same interface keeps the scenes in memory for this visit
// (persistent: false, and the library says so). Every change is announced to the page's other tabs (BroadcastChannel), so an open
// library in another tab refreshes by itself.
import { newId } from "./util.js"

const DB_VERSION = 1
const KEEP_DELETED_MS = 30 * 24 * 3600e3 // a deleted scene can be brought back for 30 days (then it is removed the next time the list is read)
const notFound = (id) => Object.assign(new Error("That scene isn’t in this browser any more"), { status: 404, code: "not_found", id })
const req = (r) => new Promise((resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(r.error))))

/** A key-value store over IndexedDB's three object stores (or Maps, when IndexedDB is not available). */
function idbKV(name) {
	let dbP = null
	const open = () =>
		(dbP ??= new Promise((resolve, reject) => {
			let r
			try {
				r = indexedDB.open(name, DB_VERSION)
			} catch (e) {
				return reject(e)
			}
			r.onupgradeneeded = () => {
				const db = r.result
				if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" })
				if (!db.objectStoreNames.contains("data")) db.createObjectStore("data")
				if (!db.objectStoreNames.contains("thumbs")) db.createObjectStore("thumbs")
			}
			r.onsuccess = () => {
				const db = r.result
				db.onversionchange = () => {
					db.close() // (a newer version of the page wants the database: let it, and open it again on the next call)
					dbP = null
				}
				resolve(db)
			}
			r.onerror = () => reject(r.error)
			r.onblocked = () => reject(new Error("the scenes database is blocked by another tab"))
		}).catch((e) => {
			dbP = null
			throw e
		}))
	/** one transaction over `stores`; fn(stores by name) may return a promise of its result; resolves when the transaction has committed */
	async function tx(stores, mode, fn) {
		const db = await open()
		return new Promise((resolve, reject) => {
			const t = db.transaction(stores, mode)
			const os = Object.fromEntries(stores.map((s) => [s, t.objectStore(s)]))
			let out
			Promise.resolve(fn(os)).then((v) => (out = v), (e) => {
				try {
					t.abort()
				} catch {}
				reject(e)
			})
			t.oncomplete = () => resolve(out)
			t.onerror = () => reject(t.error)
			t.onabort = () => reject(t.error ?? new Error("aborted"))
		})
	}
	return {
		open,
		allMeta: () => tx(["meta"], "readonly", (s) => req(s.meta.getAll())),
		getMeta: (id) => tx(["meta"], "readonly", (s) => req(s.meta.get(id))),
		getData: (id) => tx(["data"], "readonly", (s) => req(s.data.get(id))),
		getThumb: (id) => tx(["thumbs"], "readonly", (s) => req(s.thumbs.get(id))),
		/** writes: {meta?, data?: text, thumb?: Blob | null (null deletes)} for one id, in one transaction */
		put: (id, w) =>
			tx(["meta", "data", "thumbs"], "readwrite", (s) => {
				if (w.meta) s.meta.put(w.meta)
				if (w.data !== undefined) s.data.put(w.data, id)
				if (w.thumb === null) s.thumbs.delete(id)
				else if (w.thumb) s.thumbs.put(w.thumb, id)
			}),
		drop: (ids) =>
			tx(["meta", "data", "thumbs"], "readwrite", (s) => {
				for (const id of ids) for (const k of ["meta", "data", "thumbs"]) s[k].delete(id)
			})
	}
}
function memoryKV() {
	const m = { meta: new Map(), data: new Map(), thumbs: new Map() }
	const copy = (v) => (v && typeof v === "object" && !(v instanceof Blob) ? structuredClone(v) : v)
	return {
		open: async () => null,
		allMeta: async () => [...m.meta.values()].map(copy),
		getMeta: async (id) => copy(m.meta.get(id)),
		getData: async (id) => m.data.get(id),
		getThumb: async (id) => m.thumbs.get(id),
		put: async (id, w) => {
			if (w.meta) m.meta.set(id, copy(w.meta))
			if (w.data !== undefined) m.data.set(id, w.data)
			if (w.thumb === null) m.thumbs.delete(id)
			else if (w.thumb) m.thumbs.set(id, w.thumb)
		},
		drop: async (ids) => {
			for (const id of ids) for (const k of ["meta", "data", "thumbs"]) m[k].delete(id)
		}
	}
}

/** a short fingerprint of a picture's bytes (its "etag": a card shows a new picture only when this changes) */
async function etagOf(blob) {
	try {
		const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
		return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")
	} catch {
		return `${blob.size}-${Date.now().toString(36)}`
	}
}
const byteLength = (text) => new Blob([text]).size

export function createLocalBackend({ profile = null, things = () => 0 } = {}) {
	const dbName = profile ? `sandbox-scenes@${profile}` : "sandbox-scenes"
	let kv = idbKV(dbName)
	let persistent = true
	const listeners = new Set()
	let channel = null
	try {
		channel = new BroadcastChannel(`${dbName}:changes`)
		channel.onmessage = (e) => emit({ ...e.data, remote: true })
	} catch {}
	function emit(ev) {
		for (const f of listeners) {
			try {
				f(ev)
			} catch (e) {
				console.warn("My scenes:", e)
			}
		}
	}
	const changed = (ids) => {
		emit({ type: "changed", ids })
		try {
			channel?.postMessage({ type: "changed", ids })
		} catch {}
	}
	// IndexedDB that won't open: the scenes live in memory for this visit (said by `persistent`)
	const ready = kv.open().then(
		() => true,
		(e) => {
			console.warn("My scenes: this browser won’t keep scenes (IndexedDB unavailable), so they last for this visit only:", e?.message ?? e)
			kv = memoryKV()
			persistent = false
			return false
		}
	)
	const run = async (f) => (await ready, f())

	async function list() {
		return run(async () => {
			const all = await kv.allMeta()
			const now = Date.now()
			const old = all.filter((m) => m.deletedAt && now - m.deletedAt > KEEP_DELETED_MS).map((m) => m.id)
			if (old.length) kv.drop(old).catch(() => {})
			return all.filter((m) => !m.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt)
		})
	}
	async function meta(id, { deleted = false } = {}) {
		const m = await run(() => kv.getMeta(id))
		if (!m || (m.deletedAt && !deleted)) throw notFound(id)
		return m
	}
	async function get(id) {
		const m = await meta(id)
		const text = await kv.getData(id)
		if (typeof text !== "string") throw notFound(id)
		return { meta: m, scene: JSON.parse(text) }
	}
	async function thumbPatch(thumb) {
		if (thumb === undefined) return {}
		if (thumb === null) return { thumb: null, info: null }
		if (!(thumb instanceof Blob)) throw Object.assign(new Error("a picture must be a Blob"), { status: 400, code: "bad_input" })
		return { thumb, info: { etag: await etagOf(thumb), type: thumb.type || "image/webp", bytes: thumb.size } }
	}
	/** {id?, name, scene, thumb?, savedAs?, origin?, createdAt?, updatedAt?} → meta (a new scene; `id` may be chosen by the caller) */
	async function create({ id = newId(), name, scene, thumb, savedAs = null, origin = null, createdAt, updatedAt } = {}) {
		await ready
		const text = JSON.stringify(scene)
		const now = Date.now()
		const t = await thumbPatch(thumb)
		const m = {
			id,
			name: String(name || "Untitled scene"),
			items: things(scene),
			bytes: byteLength(text),
			version: 1,
			createdAt: createdAt ?? now,
			updatedAt: updatedAt ?? now,
			thumb: t.info ?? null,
			savedAs,
			origin,
			deletedAt: null
		}
		await kv.put(id, { meta: m, data: text, ...(t.thumb ? { thumb: t.thumb } : {}) })
		changed([id])
		return { ...m }
	}
	/** patch: {name?, scene?, thumb? (Blob | null), savedAs?}. A new name or scene counts as an edit (version + 1, updatedAt now); a picture alone does not. */
	async function update(id, patch = {}, { ifVersion } = {}) {
		const m = await meta(id)
		if (ifVersion != null && m.version !== ifVersion) throw Object.assign(new Error("This scene was changed in another tab"), { status: 412, code: "conflict", current: m })
		const w = {}
		let edit = false
		if (patch.name !== undefined && String(patch.name) !== m.name) {
			m.name = String(patch.name || "Untitled scene")
			edit = true
		}
		if (patch.scene !== undefined) {
			const text = JSON.stringify(patch.scene)
			if (text !== (await kv.getData(id))) {
				w.data = text
				m.items = things(patch.scene)
				m.bytes = byteLength(text)
				edit = true
			}
		}
		if (patch.savedAs !== undefined) m.savedAs = patch.savedAs
		const t = await thumbPatch(patch.thumb)
		if ("info" in t) {
			m.thumb = t.info
			w.thumb = t.thumb
		}
		if (edit) {
			m.version += 1
			m.updatedAt = Date.now()
		}
		await kv.put(id, { ...w, meta: m })
		changed([id])
		return { ...m }
	}
	async function remove(id) {
		const m = await meta(id)
		m.deletedAt = Date.now()
		await kv.put(id, { meta: m })
		changed([id])
		return { deleted: id, restoreUntil: m.deletedAt + KEEP_DELETED_MS }
	}
	async function restore(id) {
		const m = await meta(id, { deleted: true })
		m.deletedAt = null
		await kv.put(id, { meta: m })
		changed([id])
		return { ...m }
	}
	async function thumb(m) {
		if (!m?.thumb) return null
		const b = await run(() => kv.getThumb(m.id)).catch(() => null)
		return b instanceof Blob ? b : null
	}
	async function usage() {
		const all = await list()
		return { scenes: all.length, bytes: all.reduce((n, m) => n + (m.bytes || 0) + (m.thumb?.bytes || 0), 0) }
	}
	return {
		kind: "local",
		get label() {
			return persistent ? "In this browser" : "In this tab only"
		},
		get persistent() {
			return persistent
		},
		ready,
		list,
		get,
		create,
		update,
		remove,
		restore,
		thumb,
		usage,
		/** the scene that a scenario saved with the app's Save (POST /api/scenarios) became, if any */
		async findSaved(savedAs) {
			return (await list()).find((m) => m.savedAs === savedAs) ?? null
		},
		onChange(f) {
			listeners.add(f)
			return () => listeners.delete(f)
		},
		/** tests: forget everything (the database is deleted) */
		async _wipe() {
			const all = await run(() => kv.allMeta())
			await kv.drop(all.map((m) => m.id))
			changed(all.map((m) => m.id))
		}
	}
}
