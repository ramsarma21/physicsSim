// The scene on the table, kept in My scenes as the person works. Each scene they make is one library entry (a "project"): every change to it
// is written there a moment later, with a picture once its run has landed, so nothing is ever lost and nothing has to be saved by hand.
// A project starts when a new scene does: New → Blank, Build with AI (a new scene), an example, a scenario from the menu, an imported file,
// or opening another one from My scenes. Edits (by hand, Edit with AI, undo and redo) go on writing the project they belong to; undoing back
// past the start of a new scene goes back to the project before it. An example that is only opened and run is not kept: a project is made
// the first time something is changed (or straight away for an AI build, an import, or a scene saved with Save).
//
// The app tells it what happened through window.sandboxLibrary (web/app.js, a few lines):
//   changed(S)              after every committed change, undo, redo or Save (the app's own autosave() of the table)
//   fresh(kind, scenarioId) right before a new scene replaces the table: "scenario" (an example or the menu), "blank", "import", "ai"
// and opens a project through window.sandboxApp.open(scene) (one undo step, as an import is). Which project each step of the app's
// undo history belongs to is written on that step's own history record (S.hmeta[i].project), so undo and redo find it again.
// Two tabs or two devices on one scene: every write says which version of it this page last wrote or read (If-Match), so a scene changed
// elsewhere meanwhile is never overwritten. This page's changes are then kept as a scene of their own ("<name> (other copy)"), and the
// table goes on as that copy. A refusal that waiting won't fix (the account or the site is full) is said once and not retried by itself:
// the next change, or opening My scenes, tries again.
import { captureThumb, canCapture } from "./thumb.js"
import { nameFor, newId, prefs, thingsIn } from "./util.js"

const WRITE_DELAY_MS = 900 // after the last change, the scene is written
const THUMB_DELAY_MS = 1200 // after a write, the picture is taken once the run has landed and the page has been left alone this long
const IDLE_MS = 1200 // no pointer or key input for this long before a picture (the canvas holds still for the few ms a picture takes)
const RETRY_MS = [2000, 5000, 15000, 30000]

/** cyrb53: a quick fingerprint of the table's JSON (is the table at boot still the scene this project last saw?) */
function sig(text) {
	let h1 = 0xdeadbeef
	let h2 = 0x41c6ce57
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i)
		h1 = Math.imul(h1 ^ c, 2654435761)
		h2 = Math.imul(h2 ^ c, 1597334677)
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)
}

export function createAutosave({ store, onState = () => {}, toast = () => {} }) {
	const app = () => window.sandbox ?? null
	const builtins = new Set(["rube-goldberg", "empty"]) // (the full list arrives from scenario-list.json)
	let metas = new Map() // id -> meta: the library as this page last listed or wrote it
	const alias = new Map() // an id this page made -> the id the account gave it (cloud: the server picks ids)
	let current = null // {id}: the project the table belongs to
	let pendingFresh = null // a new scene is about to replace the table: {kind, scenarioId?, project?}
	let lastEntry = null // the app's history record the table was on at the last change
	const pending = new Map() // id -> {json, savedAs?, origin, backend}: a change waiting to be written
	let written = new Map() // id -> the JSON this page last wrote (or read) for it
	let sceneNames = new Map() // id -> the scene's own name when last written (a new name on the table renames the project)
	let based = new Map() // id -> the version this page last wrote or read (its next write is refused if the scene has moved on elsewhere)
	let lastRefusal = { text: "", at: 0 }
	const lastWriteAt = new Map()
	const lastThumbAt = new Map()
	const thumbWanted = new Set() // ids whose picture is older than their scene
	let thumbFails = 0
	let timer = 0
	let thumbTimer = 0
	let chain = Promise.resolve() // writes, one at a time
	let ready = false
	let lastInput = 0
	let st = { state: "idle", at: 0, error: null }
	let carry = null // after a sign-in: {from: the browser's project the table was, to: the id the table has in the account until it is made}
	const markCopied = (localId) => {
		const k = `copied@${store.owner}`
		prefs.set(k, [...new Set([...(prefs.get(k) ?? []), localId])])
	}
	const setState = (state, error = null) => {
		st = { state, at: Date.now(), error }
		try {
			onState(st)
		} catch {}
	}
	const resolve = (id) => alias.get(id) ?? id
	const pointerKey = () => (store.owner ? `project@${store.owner}` : "project")
	const remember = (json) => current && prefs.set(pointerKey(), { id: current.id, sig: json ? sig(json) : null })

	for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) addEventListener(ev, () => (lastInput = performance.now()), { capture: true, passive: true })

	// ---------------------------------------------------------------- what to keep
	/** A table worth a library entry: something on it, and not an example exactly as it ships. */
	function worthKeeping(S, json) {
		if (!thingsIn(S.scene)) return false
		return !(S.loadedJSON && json === S.loadedJSON && builtins.has(S.scenarioId))
	}
	/** After the app's Save, the table is that saved scenario: the project remembers it (picking it from the menu later continues this project). */
	const savedAsOf = (S, json) => (S.scenarioId && !builtins.has(S.scenarioId) && S.loadedJSON === json ? S.scenarioId : undefined)

	function projectForFresh(f) {
		if (f.project) return f.project
		if (f.kind === "scenario" && f.scenarioId && !builtins.has(f.scenarioId)) {
			// (a Save not yet written counts too: the account spaces one scene's writes 45 s apart)
			for (const [id, p] of pending) if (p.savedAs === f.scenarioId) return id
			for (const m of metas.values()) if (m.savedAs === f.scenarioId) return m.id
		}
		return newId()
	}

	// ---------------------------------------------------------------- the app's calls
	function changed(S = app()) {
		if (!S?.scene || !ready) return
		const entry = S.hmeta?.[S.hi] ?? null
		if (lastEntry && lastEntry !== entry && lastEntry.project === undefined && current) lastEntry.project = current.id // (the step being left: it was the current project)
		let id
		let origin = null
		if (pendingFresh) {
			id = projectForFresh(pendingFresh)
			origin = pendingFresh.kind
			pendingFresh = null
		} else if (entry?.project) id = entry.project // (undo or redo onto a step of a known project)
		else id = current?.id ?? newId()
		id = resolve(id)
		if (entry) entry.project = id
		lastEntry = entry
		switchTo(id)
		note(S, origin)
		if (thumbWanted.has(id)) scheduleThumb() // (an undo or redo onto a project still waiting for its picture)
	}
	function fresh(kind, scenarioId = null) {
		if (!ready) return
		pendingFresh = { kind, scenarioId }
	}
	function switchTo(id) {
		if (current?.id === id) return
		if (current) flushSoon(current.id, 0) // (the project being left: written now, before anything else)
		current = { id }
		if (!metas.get(id)?.thumb) thumbWanted.add(id)
	}
	function note(S, origin = null) {
		const id = current.id
		const json = JSON.stringify(S.scene)
		remember(json)
		const savedAs = savedAsOf(S, json)
		if (written.get(id) === json && (savedAs === undefined || metas.get(id)?.savedAs === savedAs)) {
			pending.delete(id) // (back to what is already written: undo to the saved state)
			return
		}
		// an example exactly as it ships, or a bare table, is never written: not as a new project, and not over one (undoing back past the
		// start of a scene leaves the project as it last was worth keeping)
		if (!worthKeeping(S, json)) return void pending.delete(id)
		const was = pending.get(id)
		// (a Save not written yet stays linked when a newer change replaces it: the account spaces one scene's writes 45 s apart)
		pending.set(id, { json, savedAs: savedAs ?? was?.savedAs, origin: origin ?? was?.origin ?? null, backend: store.backend(), ...(was?.name ? { name: was.name } : {}) })
		flushSoon(id)
	}

	// ---------------------------------------------------------------- writing
	function flushSoon(id, wait = WRITE_DELAY_MS) {
		clearTimeout(timer)
		if (wait === 0) return flush(id)
		timer = setTimeout(() => flushAll(), wait)
	}
	/** now: write even inside the backend's least gap between writes (the library is being opened, the page is going); keepalive: the page is going */
	function flushAll({ keepalive = false, now = keepalive } = {}) {
		for (const id of [...pending.keys()]) flush(id, { keepalive, now })
		return chain
	}
	function flush(id, { keepalive = false, now = false } = {}) {
		chain = chain.then(() => write(id, { keepalive, now })).catch((e) => console.warn("My scenes:", e))
		return chain
	}
	async function write(id, { keepalive, now }) {
		const p = pending.get(id)
		if (!p) return
		const b = p.backend
		if (b !== store.backend()) return void pending.delete(id) // (signed in or out since: the table goes on in the new library)
		const gap = (b.minWriteMs ?? 0) - (Date.now() - (lastWriteAt.get(id) ?? 0))
		if (gap > 0 && !now) {
			clearTimeout(timer)
			timer = setTimeout(() => flushAll(), gap)
			return
		}
		pending.delete(id)
		const scene = JSON.parse(p.json)
		setState("saving")
		try {
			let m = metas.get(id)
			if (!m) {
				m = await b.create({ id, name: p.name ?? nameFor(scene), scene, origin: p.origin, savedAs: p.savedAs ?? null })
				if (m.id !== id) {
					alias.set(id, m.id)
					written.set(m.id, p.json)
					if (current?.id === id) current = { id: m.id }
					const S = app()
					for (const e of S?.hmeta ?? []) if (e?.project === id) e.project = m.id
					remember(p.json)
				}
			} else {
				const patch = { scene }
				if ((scene.name ?? "") !== (sceneNames.get(id) ?? "")) patch.name = nameFor(scene) // (renamed on the table: the inspector, Save, the AI)
				if (p.savedAs !== undefined && p.savedAs !== m.savedAs) patch.savedAs = p.savedAs
				m = await b.update(id, patch, { keepalive, ifVersion: based.get(id) ?? m.version })
			}
			metas.set(m.id, m)
			based.set(m.id, m.version)
			if (carry && (carry.to === id || carry.to === m.id)) {
				markCopied(carry.from) // (the browser's scene the table was is in the account now: not offered for copying)
				carry = null
			}
			written.set(m.id, p.json)
			sceneNames.set(m.id, scene.name ?? "")
			lastWriteAt.set(m.id, Date.now())
			thumbWanted.add(m.id)
			scheduleThumb()
			setState("saved")
		} catch (e) {
			if (e?.status === 404 && metas.has(id)) {
				// deleted meanwhile (in My scenes, or another tab) while it is still on the table and being changed: it comes back as it is now
				metas.delete(id)
				based.delete(id)
				if (!pending.has(id)) pending.set(id, p)
				return void flushSoon(id, 0) // (queued behind this write: never awaited from inside the chain, which would wait on itself)
			}
			if (e?.status === 412) return keepAsCopy(id, p, scene, e)
			if (!pending.has(id)) pending.set(id, p) // (a newer change waiting replaces this one anyway)
			if (refused(e)) {
				// (waiting won't fix it: the account or the site is full, or the scene is refused. Said once; the next change tries again)
				setState("error", e)
				if (e.message !== lastRefusal.text || Date.now() - lastRefusal.at > 60000) toast(e.message)
				lastRefusal = { text: e.message, at: Date.now() }
				return
			}
			const n = Math.min(RETRY_MS.length - 1, (p.tries = (p.tries ?? 0) + 1) - 1)
			setState("error", e)
			if (p.tries === 2) toast(store.kind === "cloud" ? "Couldn’t save to your account; trying again" : "Couldn’t save to My scenes; trying again")
			clearTimeout(timer)
			timer = setTimeout(() => flushAll(), e?.retryAfter ? e.retryAfter * 1000 : RETRY_MS[n])
		}
	}

	/** A refusal that trying again in a moment won't change (400 / 403 / 413: a full account or site, a scene the server can't use). */
	const refused = (e) => [400, 403, 413].includes(e?.status)
	/** "<name> (other copy)" */
	const copyNameOf = (name) => `${String(name || "Untitled scene").slice(0, 46).trim()} (other copy)`
	/**
	 * The scene was changed in another tab or on another device since this page last wrote it (412). Nothing is overwritten: this page's
	 * version is kept as a new scene, "<name> (other copy)", and the table goes on as that copy (its history steps too, so undo stays with it).
	 */
	function keepAsCopy(id, p, scene, e) {
		if (e.current) metas.set(id, e.current)
		based.delete(id)
		written.delete(id)
		const name = copyNameOf(scene.name ? nameFor(scene) : metas.get(id)?.name)
		const to = newId()
		pending.set(to, { json: p.json, origin: "copy", backend: p.backend, name })
		sceneNames.set(to, scene.name ?? "")
		if (current?.id === id) {
			const S = app()
			for (const en of S?.hmeta ?? []) if (en?.project === id) en.project = to
			current = { id: to }
			thumbWanted.add(to)
			const pend = pending.get(id)
			if (pend) (pending.delete(id), pending.set(to, { ...pend, origin: "copy", name }))
			remember(S?.scene ? JSON.stringify(S.scene) : null)
		}
		toast(`“${metas.get(id)?.name ?? nameFor(scene)}” was also changed in another tab or device, so your changes here are kept as “${name}”`)
		flushSoon(to, 0) // (queued behind this write, not awaited from inside the chain)
	}

	// ---------------------------------------------------------------- the picture
	function scheduleThumb(wait = THUMB_DELAY_MS) {
		clearTimeout(thumbTimer)
		thumbTimer = setTimeout(takeThumb, wait)
	}
	/** a finished run of the scene on the table is on screen, nothing is moving under the person's hand, and nothing else has the page */
	function pictureTime(S) {
		if (!S?.view || !S.sim || S.layout || S.editing || S.editor?.dragging) return false
		const b = document.body
		if (b.classList.contains("ai-draft") || document.visibilityState !== "visible") return false
		if (document.querySelector("#status")?.dataset.state !== "ok" || document.querySelector("#chain")?.classList.contains("stale")) return false
		if ([...document.querySelectorAll("dialog[open]")].some((d) => !d.classList.contains("lib-dialog"))) return false // (the video export, New, help…)
		return performance.now() - lastInput > (S.playing ? IDLE_MS * 3 : IDLE_MS)
	}
	let thumbBusy = false
	async function takeThumb() {
		const S = app()
		const id = current?.id
		if (thumbBusy) return scheduleThumb()
		if (!id || !thumbWanted.has(id) || !metas.has(id)) return
		if (!canCapture(S?.view)) return scheduleThumb(4000) // (a layout preview, a video export, or no WebGL: later)
		if (!pictureTime(S)) return scheduleThumb(800)
		const json = JSON.stringify(S.scene)
		if (written.get(id) !== json) return // (a write is on its way: it asks for the picture again)
		const wait = (store.backend().minThumbMs ?? 0) - (Date.now() - (lastThumbAt.get(id) ?? 0))
		if (wait > 0 && metas.get(id)?.thumb) return scheduleThumb(wait) // (the account's write allowance: a newer picture a little later)
		thumbBusy = true
		try {
			const blob = await captureThumb(S.view)
			if (!blob) return scheduleThumb(4000)
			if (current?.id !== id || JSON.stringify(app()?.scene) !== json) return scheduleThumb() // (changed while the picture was taken)
			const b = store.backend()
			let m
			try {
				m = await b.update(id, { thumb: blob }, { ifVersion: based.get(id) })
			} catch (e) {
				if (e?.status !== 412) throw e
				thumbWanted.delete(id) // (the scene moved on elsewhere: this table's picture isn't its picture; the next write here asks again)
				return
			}
			metas.set(id, m)
			thumbWanted.delete(id)
			lastThumbAt.set(id, Date.now())
			thumbFails = 0
		} catch (e) {
			if (++thumbFails <= 3) scheduleThumb(3000 * thumbFails)
			else console.warn("My scenes: no picture for this scene:", e?.message ?? e)
		} finally {
			thumbBusy = false
		}
	}

	// ---------------------------------------------------------------- start, and the library's own actions
	async function loadBuiltins() {
		try {
			const r = await fetch(new URL("../scenario-list.json", import.meta.url))
			const l = r.ok ? await r.json() : []
			for (const s of l) if (s?.builtin !== false && s?.id) builtins.add(s.id)
		} catch {}
	}
	async function refresh() {
		const list = await store.list()
		metas = new Map(list.map((m) => [m.id, m]))
		return list
	}
	/** Once the app's first scene is up: which project the table is (the one this page saved last, if the table is still that scene). */
	async function start() {
		await Promise.all([loadBuiltins(), store.ready])
		await refresh().catch(() => {})
		const S = app()
		const json = S?.scene ? JSON.stringify(S.scene) : ""
		const ptr = prefs.get(pointerKey())
		if (ptr?.id && metas.has(ptr.id) && json && ptr.sig === sig(json)) {
			current = { id: ptr.id }
			try {
				const { meta, scene } = await store.get(ptr.id)
				written.set(ptr.id, JSON.stringify(scene))
				sceneNames.set(ptr.id, scene.name ?? "")
				based.set(ptr.id, meta.version)
			} catch {}
		} else {
			current = { id: newId() }
			// back from signing in (the page was reloaded): the table is the browser's scene it was, which goes on in the account as one scene
			const lp = store.kind === "cloud" ? prefs.get("project") : null
			if (lp?.id && json && lp.sig === sig(json)) {
				carry = { from: lp.id, to: current.id }
				written.set(current.id, json)
			}
		}
		if (!metas.get(current.id)?.thumb) thumbWanted.add(current.id)
		ready = true
		const entry = S?.hmeta?.[S.hi]
		if (entry && entry.project === undefined) entry.project = current.id
		lastEntry = entry ?? null
		if (S?.scene) note(S, metas.has(current.id) ? null : "table")
		scheduleThumb()
	}
	/** Signed in or out: the table goes on in the other library (as a new scene there, the first time it changes). */
	function switchBackend() {
		// the table's scene goes on in the other library as one scene: made there by its first change, or by "copy this browser's scenes",
		// whichever comes first (`carry` links the two, so the copy offer never makes a second one)
		const from = current && metas.has(current.id) && store.kind === "cloud" ? current.id : null
		metas = new Map()
		written = new Map()
		sceneNames = new Map()
		based = new Map()
		alias.clear()
		pendingFresh = null
		const S = app()
		current = { id: newId() }
		carry = from ? { from, to: current.id } : null
		if (S?.scene) {
			written.set(current.id, JSON.stringify(S.scene)) // (nothing is written until it changes)
			const entry = S.hmeta?.[S.hi]
			for (const e of S.hmeta ?? []) if (e) e.project = undefined
			if (entry) entry.project = current.id
			lastEntry = entry ?? null
		}
		refresh().catch(() => {})
	}
	store.onChange((ev) => {
		if (ev.type === "backend") return switchBackend()
		if (ev.remote) refresh().catch(() => {}) // (another tab wrote: keep the names and dates this page knows up to date)
	})

	/** Opens a project from My scenes: the table becomes it (one undo step), and edits go on writing it. */
	async function open(id) {
		const S = app()
		if (!window.sandboxApp?.open || !S?.view) throw new Error("the sandbox is still starting")
		if (current?.id === id) return { already: true }
		const { meta, scene } = await store.get(id)
		scene.name = meta.name
		flushAll()
		metas.set(id, meta)
		based.set(id, meta.version)
		written.set(id, JSON.stringify(scene))
		sceneNames.set(id, scene.name)
		if (!meta.thumb) thumbWanted.add(id)
		pendingFresh = { kind: "open", project: id }
		window.sandboxApp.open(scene)
		if (pendingFresh) {
			pendingFresh = null // (the app's hook didn't run: the page is older than this module)
			current = { id }
		}
		return { meta }
	}
	return {
		start,
		changed,
		fresh,
		open,
		refresh,
		flush: (o) => flushAll(o),
		/** The table is kept in My scenes (so the New dialog need not offer to save it first). */
		holds: () => ready && store.persistent && st.state !== "error",
		get currentId() {
			return current?.id ?? null
		},
		get state() {
			return st
		},
		get ready() {
			return ready
		},
		/** My scenes renamed a project: the table's scene takes the name too when it is that one (one undo step, as the inspector's rename) */
		renamed(id, name, meta) {
			if (meta) {
				if (meta.version === (based.get(id) ?? 0) + 1) based.set(id, meta.version) // (this page's own rename: the scene is still what it wrote)
				metas.set(id, meta)
			}
			if (current?.id === id && app()?.scene && app().scene.name !== name) {
				sceneNames.set(id, name)
				window.sandboxApp?.rename?.(name)
			}
		},
		/** My scenes deleted a project. If it is the one on the table, the table goes on as a new scene (made when it next changes).
		 *  -> true when it was the scene on the table */
		deleted(id) {
			const onTable = current?.id === id
			metas.delete(id)
			pending.delete(id)
			based.delete(id)
			if (onTable) {
				const S = app()
				current = { id: newId() }
				if (S?.scene) written.set(current.id, JSON.stringify(S.scene))
				const entry = S?.hmeta?.[S.hi]
				if (entry) entry.project = current.id
				remember(null)
			}
			return onTable
		},
		/** …and brought it back: the table is that project again if it still shows it */
		restored(meta) {
			metas.set(meta.id, meta)
			if (!based.has(meta.id)) based.set(meta.id, meta.version)
			const S = app()
			const json = S?.scene ? JSON.stringify(S.scene) : null
			if (json && written.get(meta.id) === json && current && !metas.has(current.id)) {
				written.delete(current.id)
				current = { id: meta.id }
				const entry = S.hmeta?.[S.hi]
				if (entry) entry.project = meta.id
				remember(json)
			}
		},
		/** "Copy this browser's scenes" made `meta` in the account from the browser's scene `localId`: if that is the scene on the table
		 *  (signed in since, not changed yet), the table goes on as that copy instead of becoming another one */
		link(localId, meta) {
			if (!carry || carry.from !== localId || metas.has(carry.to)) return
			const to = carry.to
			carry = null
			alias.set(to, meta.id)
			metas.set(meta.id, meta)
			based.set(meta.id, meta.version)
			const w = written.get(to)
			if (w) written.set(meta.id, w)
			const p = pending.get(to)
			if (p) (pending.delete(to), pending.set(meta.id, p))
			const S = app()
			for (const e of S?.hmeta ?? []) if (e?.project === to) e.project = meta.id
			if (current?.id === to) {
				current = { id: meta.id }
				remember(S?.scene ? JSON.stringify(S.scene) : null)
			}
			if (!meta.thumb) {
				thumbWanted.add(meta.id) // (copied before it had a picture: it gets one now)
				scheduleThumb()
			}
		},
		/** Scenes saved with the app's Save before My scenes existed (this browser's, or the local server's web/saved): kept in the library once. */
		async adoptSaved() {
			if (store.kind !== "local" || prefs.get("library-adopted")) return 0
			let n = 0
			try {
				const saved = await readSaved()
				const have = new Set([...metas.values()].map((m) => m.savedAs).filter(Boolean))
				for (const [sid, scene] of saved) {
					if (have.has(sid) || !scene || !Array.isArray(scene.items)) continue
					const m = await store.local.create({ name: nameFor(scene), scene, savedAs: sid, origin: "saved" })
					metas.set(m.id, m)
					n++
				}
				prefs.set("library-adopted", true)
			} catch (e) {
				console.warn("My scenes: couldn’t bring in the saved scenes:", e?.message ?? e)
			}
			return n
		},
		_debug: { get pending() { return pending }, get metas() { return metas }, get written() { return written }, get based() { return based }, takeThumb, pictureTime: () => pictureTime(app()) }
	}

	/** [[id, scene]] of the scenes saved with Save: localStorage (the page's own engine) or the local server's list */
	async function readSaved() {
		if (document.documentElement.dataset.engine !== "server") {
			const all = prefs.get("saved")
			return all && typeof all === "object" ? Object.entries(all).filter(([id]) => !builtins.has(id)) : []
		}
		const r = await fetch("/api/scenarios", { cache: "no-store" })
		const list = r.ok ? await r.json() : []
		const mine = list.filter((s) => s && !s.builtin && s.id)
		const out = []
		for (const s of mine) {
			const q = await fetch(`/api/scenarios/${encodeURIComponent(s.id)}`, { cache: "no-store" })
			if (q.ok) out.push([s.id, await q.json()])
		}
		return out
	}
}

// (exported for tests)
export { sig as _sig }
