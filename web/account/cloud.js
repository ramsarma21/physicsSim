// My scenes, kept in the signed-in person's account: the page's side of /api/scenes (docs/ACCOUNTS.md section 4), with the same interface as
// ./local-idb.js (see ./store.js). Written against that contract; the server (api/scenes/index.mjs) and the sign-in provider (./clerk.js) are
// the accounts build step's. Every call carries `Authorization: Bearer <session token>` (never a cookie); a 401 that says the token expired
// gets one fresh token and one retry. Errors are Errors with the server's own sentence, plus {status, code, retryable, current?}.
//   GET    /api/scenes                 -> {ok, scenes: [meta]}          meta: {id, name, items, bytes, version, createdAt, updatedAt, thumb: url | null}
//   POST   /api/scenes {name, scene, thumb?: data URL, savedAs?, copy?} -> 201 {ok, scene: meta}   (copy: "copy this browser's scenes", its own daily count)
//   GET    /api/scenes/:id             -> {ok, scene: meta, data: scene}
//   PUT    /api/scenes/:id {name?, scene?, thumb?: data URL | null, savedAs?} (If-Match: "v<version>")  -> {ok, scene: meta}  (412 {code: "conflict", current})
//   DELETE /api/scenes/:id             -> {ok, deleted, restoreUntil}
//   POST   /api/scenes/:id/restore     -> {ok, scene: meta}
//   GET    /api/scenes/:id/thumb?v=…   -> the picture's bytes
//   GET    /api/scenes/me              -> {ok, accounts, storage, user?, usage?: {scenes, bytes, maxScenes, maxBytes}, aiToday?}
//   DELETE /api/scenes/me {confirm: "delete my account"} -> {ok, deleted}   (the account, its scenes and its sign-in, for good)
// meta.savedAs: the app's scenario the scene was saved as with Save, so picking that scenario from the menu again continues the same scene.

const ms = (v) => (typeof v === "number" ? v : Date.parse(v))
/** the server's meta as the library's (dates as ms; the picture as {url, etag}) */
function toMeta(m) {
	const url = typeof m.thumb === "string" ? m.thumb : null
	return {
		id: m.id,
		name: m.name,
		items: m.items ?? 0,
		bytes: m.bytes ?? 0,
		version: m.version ?? 1,
		createdAt: ms(m.createdAt),
		updatedAt: ms(m.updatedAt),
		thumb: url ? { url, etag: new URL(url, location.href).searchParams.get("v") || url } : null,
		savedAs: m.savedAs ?? null,
		origin: m.origin ?? null
	}
}
const blobToDataURL = (blob) =>
	new Promise((resolve, reject) => {
		const r = new FileReader()
		r.onload = () => resolve(r.result)
		r.onerror = () => reject(r.error)
		r.readAsDataURL(blob)
	})

export function createCloudBackend({ getToken, base = "/api/scenes", fetch = globalThis.fetch.bind(globalThis), user = null } = {}) {
	const listeners = new Set()
	const emit = (ev) => {
		for (const f of listeners) {
			try {
				f(ev)
			} catch (e) {
				console.warn("My scenes:", e)
			}
		}
	}
	async function send(method, path = "", body, { headers = {}, raw = false, keepalive = false } = {}) {
		const text = body === undefined ? undefined : JSON.stringify(body)
		keepalive &&= (text?.length ?? 0) < 60000 // (a request that outlives the page may carry 64 KiB at most)
		const go = async (fresh) => {
			const token = await getToken?.(fresh ? { skipCache: true } : undefined)
			if (!token) throw Object.assign(new Error("Sign in to reach your scenes"), { status: 401, code: "sign_in" })
			return fetch(base + path, {
				method,
				cache: "no-store",
				credentials: "same-origin",
				keepalive,
				headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
				body: text
			})
		}
		let r = await go(false)
		if (r.status === 401) {
			const j = await r.clone().json().catch(() => ({}))
			if (j.expired) r = await go(true)
		}
		if (raw && r.ok) return r
		let j = null
		try {
			j = await r.json()
		} catch {}
		if (!r.ok || !j || j.ok === false) {
			const message = j?.error || (r.status >= 500 ? "Your scenes can’t be reached right now. Try again." : r.statusText || `HTTP ${r.status}`)
			throw Object.assign(new Error(message), { status: r.status, code: j?.code, retryable: !!j?.retryable || r.status >= 500, current: j?.current ? toMeta(j.current) : undefined, retryAfter: Number(r.headers.get("Retry-After")) || undefined })
		}
		return j
	}
	const thumbField = async (thumb) => (thumb === undefined ? {} : { thumb: thumb === null ? null : await blobToDataURL(thumb) })
	const changed = (ids) => emit({ type: "changed", ids })

	return {
		kind: "cloud",
		label: "In your account",
		persistent: true,
		ready: Promise.resolve(true),
		/** autosave writes one scene at most this often, and its picture at most every minThumbMs (the server allows 120 writes an hour in all:
		 *  an hour of non-stop editing is 80 + 20); local has no such limits */
		minWriteMs: 45000,
		minThumbMs: 180000,
		user,
		async list() {
			const j = await send("GET")
			return (j.scenes ?? []).map(toMeta).sort((a, b) => b.updatedAt - a.updatedAt)
		},
		async get(id) {
			const j = await send("GET", `/${encodeURIComponent(id)}`)
			return { meta: toMeta(j.scene), scene: j.data }
		},
		/** the server makes the id: a caller's `id` is ignored (the returned meta has the real one). copy: a scene copied in from this browser
		 *  (counted apart from the hour's writes the autosave needs) */
		async create({ name, scene, thumb, savedAs = null, copy = false } = {}) {
			const j = await send("POST", "", { name, scene, ...(await thumbField(thumb)), ...(typeof savedAs === "string" ? { savedAs } : {}), ...(copy ? { copy: true } : {}) })
			const m = toMeta(j.scene)
			changed([m.id])
			return m
		},
		async update(id, patch = {}, { ifVersion, keepalive = false } = {}) {
			const body = { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.scene !== undefined ? { scene: patch.scene } : {}), ...(await thumbField(patch.thumb)), ...(patch.savedAs !== undefined ? { savedAs: patch.savedAs } : {}) }
			if (!Object.keys(body).length) return (await this.get(id)).meta
			const j = await send("PUT", `/${encodeURIComponent(id)}`, body, { headers: ifVersion != null ? { "If-Match": `"v${ifVersion}"` } : {}, keepalive })
			const m = toMeta(j.scene)
			changed([id])
			return m
		},
		async remove(id) {
			const j = await send("DELETE", `/${encodeURIComponent(id)}`)
			changed([id])
			return { deleted: id, restoreUntil: ms(j.restoreUntil) }
		},
		async restore(id) {
			const j = await send("POST", `/${encodeURIComponent(id)}/restore`)
			changed([id])
			return toMeta(j.scene)
		},
		/** the card's picture: fetched with the token (an <img> can't send it), cached by the browser under its ?v= */
		async thumb(m) {
			if (!m?.thumb?.url) return null
			try {
				const token = await getToken?.()
				const r = await fetch(m.thumb.url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "same-origin" })
				return r.ok ? await r.blob() : null
			} catch {
				return null
			}
		},
		async usage() {
			const j = await send("GET", "/me")
			return j.usage ?? { scenes: 0, bytes: 0 }
		},
		async findSaved(savedAs) {
			return (await this.list()).find((m) => m.savedAs === savedAs) ?? null
		},
		/** Deletes the account: every scene in it and the sign-in itself, for good (the page signs out after). */
		async deleteAccount() {
			await send("DELETE", "/me", { confirm: "delete my account" })
			changed([])
		},
		onChange(f) {
			listeners.add(f)
			return () => listeners.delete(f)
		}
	}
}
