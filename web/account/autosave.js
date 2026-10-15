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
	const lastWriteAt = new Map()
	const thumbWanted = new Set() // ids whose picture is older than their scene
	let thumbFails = 0
	let timer = 0
	let thumbTimer = 0
	let chain = Promise.resolve() // writes, one at a time
	let ready = false
	let lastInput = 0
	let st = { state: "idle", at: 0, error: null }
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
		pending.set(id, { json, savedAs, origin: origin ?? pending.get(id)?.origin ?? null, backend: store.backend() })
		flushSoon(id)
	}

	// ---------------------------------------------------------------- writing
	function flushSoon(id, wait = WRITE_DELAY_MS) {
		clearTimeout(timer)
		if (wait === 0) return flush(id)
		timer = setTimeout(() => flushAll(), wait)
	}
	function flushAll({ keepalive = false } = {}) {
		for (const id of [...pending.keys()]) flush(id, { keepalive })
		return chain
	}
	function flush(id, { keepalive = false } = {}) {
		chain = chain.then(() => write(id, { keepalive })).catch((e) => console.warn("My scenes:", e))
		return chain
	}
	async function write(id, { keepalive }) {
		const p = pending.get(id)
		if (!p) return
		const b = p.backend
		if (b !== store.backend()) return void pending.delete(id) // (signed in or out since: the table goes on in the new library)
		const gap = (b.minWriteMs ?? 0) - (Date.now() - (lastWriteAt.get(id) ?? 0))
		if (gap > 0 && !keepalive) {
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
				m = await b.create({ id, name: nameFor(scene), scene, origin: p.origin, savedAs: p.savedAs ?? null })
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
				m = await b.update(id, patch, { keepalive })
			}
			metas.set(m.id, m)
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
				if (!pending.has(id)) pending.set(id, p)
				return flushSoon(id, 0)
			}
			if (!pending.has(id)) pending.set(id, p) // (a newer change waiting replaces this one anyway)
			const n = Math.min(RETRY_MS.length - 1, (p.tries = (p.tries ?? 0) + 1) - 1)
			setState("error", e)
			if (p.tries === 2) toast(store.kind === "cloud" ? "Couldn’t save to your account; trying again" : "Couldn’t save to My scenes; trying again")
			clearTimeout(timer)
			timer = setTimeout(() => flushAll(), e?.retryAfter ? e.retryAfter * 1000 : RETRY_MS[n])
		}
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
		if (!id || !thumbWanted.has(id) || !metas.has(id) || thumbBusy) return
		if (!canCapture(S?.view)) return scheduleThumb(4000) // (a layout preview, a video export, or no WebGL: later)
		if (!pictureTime(S)) return scheduleThumb(800)
		const json = JSON.stringify(S.scene)
		if (written.get(id) !== json) return // (a write is on its way: it asks for the picture again)
		thumbBusy = true
		try {
			const blob = await captureThumb(S.view)
			if (!blob) return scheduleThumb(4000)
			if (current?.id !== id || JSON.stringify(app()?.scene) !== json) return scheduleThumb() // (changed while the picture was taken)
			const b = store.backend()
			const m = await b.update(id, { thumb: blob })
			metas.set(id, m)
			thumbWanted.delete(id)
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
				const { scene } = await store.get(ptr.id)
				written.set(ptr.id, JSON.stringify(scene))
				sceneNames.set(ptr.id, scene.name ?? "")
			} catch {}
		} else current = { id: newId() }
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
		metas = new Map()
		written = new Map()
		sceneNames = new Map()
		alias.clear()
		pendingFresh = null
		const S = app()
		current = { id: newId() }
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
			if (meta) metas.set(id, meta)
			if (current?.id === id && app()?.scene && app().scene.name !== name) {
				sceneNames.set(id, name)
				window.sandboxApp?.rename?.(name)
			}
		},
		/** My scenes deleted a project. If it is the one on the table, the table goes on as a new scene (made when it next changes). */
		deleted(id) {
			metas.delete(id)
			pending.delete(id)
			if (current?.id === id) {
				const S = app()
				current = { id: newId() }
				if (S?.scene) written.set(current.id, JSON.stringify(S.scene))
				const entry = S?.hmeta?.[S.hi]
				if (entry) entry.project = current.id
				remember(null)
			}
		},
		/** …and brought it back: the table is that project again if it still shows it */
		restored(meta) {
			metas.set(meta.id, meta)
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
		_debug: { get pending() { return pending }, get metas() { return metas }, get written() { return written }, takeThumb, pictureTime: () => pictureTime(app()) }
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
