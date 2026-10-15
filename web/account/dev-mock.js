// DEVELOPMENT ONLY (never in the build: DEV_ONLY in tools/build-static.mjs; ./auth.js imports it only with ?accountmock): a pretend Google
// sign-in and a pretend /api/scenes answered inside the page, so the signed-in screens (the account chip and its menu, My scenes "in your
// account", the copy-this-browser offer) can be tried and tested on the local server with no accounts, keys or network.
//   ?accountmock=1          signed out first; "Sign in" signs in at once as a made-up person
//   ?accountmock=signedin   signed in from the start
// The pretend account's scenes are kept in sessionStorage ("sandbox-mock-cloud"), so a reload keeps them for this tab. The API follows
// docs/ACCOUNTS.md section 4 (the same shapes, status codes and If-Match rule), with a little latency.

const KEY = "sandbox-mock-cloud"
const PERSON = { id: "user_mock_ada", name: "Ada Lovelace", email: "ada@example.com" }
const LATENCY_MS = 160
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function load() {
	try {
		return JSON.parse(sessionStorage.getItem(KEY)) ?? { user: null, scenes: {} }
	} catch {
		return { user: null, scenes: {} }
	}
}
function save(db) {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(db))
	} catch {}
}
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } })
const fail = (status, code, error, extra = {}) => json(status, { ok: false, code, error, retryable: status >= 500, ...extra })
const things = (scene) => (Array.isArray(scene?.items) ? scene.items.filter((i) => i && i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d)).length : 0)
const newId = () => "s_" + [...crypto.getRandomValues(new Uint8Array(16))].map((x) => "abcdefghijklmnopqrstuvwxyz234567"[x & 31]).join("")
const etag = (s) => {
	let h = 2166136261
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
	return (h >>> 0).toString(16).padStart(8, "0")
}
function metaOf(r) {
	return { id: r.id, name: r.name, items: things(r.scene), bytes: JSON.stringify(r.scene).length + (r.thumb?.length ?? 0), version: r.version, createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(r.updatedAt).toISOString(), thumb: r.thumb ? `/api/scenes/${r.id}/thumb?v=${etag(r.thumb)}` : null }
}

let installed = false
function installServer(getUser) {
	if (installed) return
	installed = true
	const real = window.fetch.bind(window)
	window.fetch = async (input, init = {}) => {
		const url = new URL(typeof input === "string" ? input : input.url, location.href)
		if (url.origin !== location.origin || !url.pathname.startsWith("/api/scenes")) return real(input, init)
		await sleep(LATENCY_MS)
		const method = (init.method || "GET").toUpperCase()
		const headers = new Headers(init.headers || {})
		const db = load()
		const who = getUser()
		const parts = url.pathname.split("/").filter(Boolean).slice(2) // after api/scenes
		if (parts[0] === "me" && method === "GET") {
			const out = { ok: true, accounts: { provider: "mock" }, storage: true }
			if (who && headers.get("Authorization") === `Bearer mock.${who.id}`) {
				const live = Object.values(db.scenes).filter((r) => !r.deletedAt)
				Object.assign(out, { user: who, usage: { scenes: live.length, bytes: live.reduce((n, r) => n + metaOf(r).bytes, 0), maxScenes: 500, maxBytes: 52428800 } })
			}
			return json(200, out)
		}
		if (!who || headers.get("Authorization") !== `Bearer mock.${who.id}`) return fail(401, "sign_in", "Sign in to reach your scenes", { expired: false })
		const body = init.body ? JSON.parse(init.body) : {}
		const [id, part] = parts
		if (!id) {
			if (method === "GET") return json(200, { ok: true, scenes: Object.values(db.scenes).filter((r) => !r.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt).map(metaOf) })
			if (method === "POST") {
				if (!body.scene || !Array.isArray(body.scene.items)) return fail(400, "bad_input", "That isn’t a scene")
				const now = Date.now()
				const r = { id: newId(), name: String(body.name || "Untitled scene").slice(0, 60), scene: { ...body.scene }, thumb: body.thumb ?? null, version: 1, createdAt: now, updatedAt: now, deletedAt: null }
				r.scene.name = r.name
				r.scene.id = r.id
				db.scenes[r.id] = r
				save(db)
				return json(201, { ok: true, scene: metaOf(r) }, { Location: `/api/scenes/${r.id}` })
			}
			return fail(405, "bad_input", "Not here")
		}
		const r = db.scenes[id]
		if (!r || (r.deletedAt && part !== "restore")) return fail(404, "not_found", "That scene isn’t in your account")
		if (part === "thumb" && method === "GET") {
			if (!r.thumb) return fail(404, "not_found", "No picture")
			return real(r.thumb) // (a data: URL: the picture's bytes)
		}
		if (part === "restore" && method === "POST") {
			r.deletedAt = null
			save(db)
			return json(200, { ok: true, scene: metaOf(r) })
		}
		if (part) return fail(404, "not_found", "Not here")
		if (method === "GET") return json(200, { ok: true, scene: metaOf(r), data: r.scene }, { ETag: `"v${r.version}"` })
		if (method === "PUT") {
			const want = headers.get("If-Match")
			if (want && want !== `"v${r.version}"`) return fail(412, "conflict", "This scene was changed on another device since you opened it", { current: metaOf(r) })
			let edit = false
			if (body.name !== undefined && body.name !== r.name) ((r.name = String(body.name).slice(0, 60)), (edit = true))
			if (body.scene !== undefined && JSON.stringify(body.scene) !== JSON.stringify(r.scene)) ((r.scene = { ...body.scene }), (edit = true))
			if (body.thumb !== undefined) r.thumb = body.thumb
			r.scene.name = r.name
			if (edit) ((r.version += 1), (r.updatedAt = Date.now()))
			save(db)
			return json(200, { ok: true, scene: metaOf(r) })
		}
		if (method === "DELETE") {
			r.deletedAt = Date.now()
			save(db)
			return json(200, { ok: true, deleted: id, restoreUntil: new Date(r.deletedAt + 30 * 864e5).toISOString() })
		}
		return fail(405, "bad_input", "Not here")
	}
}

export async function createMockProvider({ signedIn = false } = {}) {
	const db = load()
	if (signedIn && !db.user) {
		db.user = PERSON
		save(db)
	}
	let user = db.user
	const listeners = new Set()
	const emit = () => listeners.forEach((f) => f())
	installServer(() => user)
	console.info("account: ?accountmock — a pretend sign-in and a pretend /api/scenes (development only)")
	return {
		name: "mock",
		get user() {
			return user
		},
		async signIn() {
			await sleep(400) // (Google's page would be here)
			user = PERSON
			save({ ...load(), user })
			emit()
		},
		async signOut() {
			user = null
			save({ ...load(), user })
			emit()
		},
		async getToken() {
			return user ? `mock.${user.id}` : null
		},
		onChange(f) {
			listeners.add(f)
			return () => listeners.delete(f)
		}
	}
}
