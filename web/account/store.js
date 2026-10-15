// Where "My scenes" lives: one interface, two backends. Signed out (and everywhere without accounts: the local server, the static preview, a
// deploy without sign-in) it is this browser (./local-idb.js, IndexedDB, per ?profile); signed in, it is the person's account (./cloud.js,
// /api/scenes). The library, the autosave and the New dialog's recent row only ever talk to this.
//   const store = createStore({ auth })            // auth: ./auth.js (or null: always local)
//   store.kind              "local" | "cloud"        store.label  "In this browser" | "In your account" | "In this tab only"
//   store.persistent        false when this browser won't keep anything (the scenes last for this visit)
//   await store.list()                              -> [meta], newest first (deleted ones left out)
//   await store.get(id)                             -> {meta, scene}
//   await store.create({id?, name, scene, thumb?})  -> meta        (cloud: the server picks the id; use the returned one)
//   await store.update(id, {name?, scene?, thumb?}, {ifVersion?}) -> meta   (a new picture alone is not an edit)
//   await store.remove(id)  -> {restoreUntil}       await store.restore(id) -> meta   (deleted scenes come back for 30 days)
//   await store.thumb(meta) -> Blob | null          await store.usage() -> {scenes, bytes, maxScenes?, maxBytes?}
//   store.onChange(fn)      fn({type: "changed", ids, remote?}) after any write (also another tab's), or {type: "backend"} after a sign-in or out
//   store.local             the browser's library, always (for "copy this browser's scenes to my account")
// meta: {id, name, items (things on the table), bytes, version, createdAt, updatedAt (ms), thumb: {etag, …} | null, savedAs?, origin?}
// Errors are Errors with plain words, plus {status, code}: 404 not_found, 412 conflict (with `current`), 401 sign_in, 403 quota, 5xx.
import { createCloudBackend } from "./cloud.js"
import { createLocalBackend } from "./local-idb.js"
import { PROFILE, thingsIn } from "./util.js"

export function createStore({ auth = null } = {}) {
	const local = createLocalBackend({ profile: PROFILE, things: thingsIn })
	let cloud = null
	let cloudUser = null
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
	local.onChange((ev) => backend() === local && emit(ev))
	function backend() {
		const u = auth?.state === "signed-in" ? auth.user : null
		if (!u) return local
		if (!cloud || cloudUser !== u.id) {
			cloud = createCloudBackend({ getToken: (o) => auth.getToken(o), user: u })
			cloud.onChange((ev) => backend() === cloud && emit(ev))
			cloudUser = u.id
		}
		return cloud
	}
	let lastKind = backend().kind
	auth?.onChange(() => {
		const b = backend()
		if (b.kind !== lastKind || (b === cloud && cloudUser !== auth.user?.id)) {
			lastKind = b.kind
			emit({ type: "backend", kind: b.kind })
		}
	})
	const on = (name) => (...a) => backend()[name](...a)
	return {
		get kind() {
			return backend().kind
		},
		get label() {
			return backend().label
		},
		get persistent() {
			return backend().persistent
		},
		/** autosave's least gap between two writes to one scene, in ms */
		get minWriteMs() {
			return backend().minWriteMs ?? 0
		},
		/** who the account library belongs to (null: this browser's) */
		get owner() {
			return backend() === cloud ? cloudUser : null
		},
		get ready() {
			return backend().ready
		},
		backend,
		local,
		list: on("list"),
		get: on("get"),
		create: on("create"),
		update: on("update"),
		remove: on("remove"),
		restore: on("restore"),
		thumb: on("thumb"),
		usage: on("usage"),
		findSaved: on("findSaved"),
		onChange(f) {
			listeners.add(f)
			return () => listeners.delete(f)
		}
	}
}
