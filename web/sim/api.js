// The local API: what web/server.py answers over HTTP, answered in the page instead (the app's `?engine=browser` mode; no server).
//   import { createLocalApi } from "./sim/api.js"
//   const api = createLocalApi({ profile })               // starts the engine's Web Worker now, so the first run doesn't wait for it to load
//   await api("/api/catalog")                              // GET  -> the catalog (the types web/sim has registered)
//   await api("/api/scenarios")                            // GET  -> [{id, name, builtin, items}]: web/scenario-list.json + the scenes saved in this browser
//   await api("/api/scenarios/<id>")                       // GET  -> one scene (web/scenarios/<id>.json, or the saved one)
//   await api("/api/scenarios", {scene})                   // POST -> {id, name}: saves the scene in this browser (localStorage "sandbox:saved", per ?profile)
//   await api("/api/simulate", {scene}, signal)            // POST -> {cached, key, doc, summary, warnings, resolved, ms, track}
//   await api("/api/layout", {scene})                      // POST -> {doc, resolved, warnings}
// The same call shape as the app's api(path, body, signal): no body = GET. A run goes clean -> build -> engine (a Web Worker) -> summarize,
// step by step as web/server.py's simulate() and layout() do. Errors reject with an Error whose message is the server's {error} text (status 400 for
// a scene the builder can't use, 404 for a scenario that isn't there, 500 otherwise); an aborted run rejects with the signal's AbortError.
// A small LRU cache answers a scene run before (with cached: true, as the server does); it is kept to a size budget.
import { ArithmeticError, ValueError, hasOwn, pyLower, pySlice, pyStrip, setOwn } from "./pymath.js"
import { BadScene, TYPES, build, catalog, clean, finish, layout } from "./index.js"
import { createEngine } from "./engine.js"

export const RATE = 120 // frames per second the app asks the engine for (server.py: run_track(doc, 120, ...))
const CACHE_BYTES = 48 << 20 // budget for cached results (estimated: a placement counts for about 100 bytes)
const CACHE_ENTRIES = 100
const STARTER_ORDER = new Map([["rube-goldberg", 0], ["empty", 1]]) // the menu's first two, as server.py's scenarios() puts them (a Map: a saved scene may be called "constructor")

// ---------------------------------------------------------------- keys
/** JSON text with the object keys in order, so equal scenes have equal text (server.py: sha1 of json.dumps(sort_keys=True)). */
function canon(v) {
	if (v === null || typeof v !== "object") return Object.is(v, -0) ? "-0" : JSON.stringify(v)
	if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`
	return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
}
/** 12 hex digits of a 53-bit hash of the text (cyrb53). The cache itself is keyed by the whole text, so a clash could only blur `key`. */
function keyOf(text) {
	let h1 = 0xdeadbeef
	let h2 = 0x41c6ce57
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i)
		h1 = Math.imul(h1 ^ c, 2654435761)
		h2 = Math.imul(h2 ^ c, 1597334677)
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return ((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")).slice(0, 12)
}

// ---------------------------------------------------------------- the result cache
function createCache(maxBytes, maxEntries) {
	const map = new Map() // text -> {out, bytes}; the oldest first (a hit moves its entry to the end)
	let bytes = 0
	/** About how much memory a result takes: the document, plus every placement of the track. */
	const cost = (out) => {
		let n = 0
		for (const f of out.track.frames) n += Object.keys(f.placements).length
		return 50_000 + 100 * n
	}
	return {
		get(text) {
			const e = map.get(text)
			if (!e) return undefined
			map.delete(text)
			map.set(text, e)
			return e.out
		},
		put(text, out) {
			const old = map.get(text)
			if (old) bytes -= old.bytes
			const e = { out, bytes: cost(out) }
			map.delete(text)
			map.set(text, e)
			bytes += e.bytes
			while ((bytes > maxBytes || map.size > maxEntries) && map.size > 1) {
				const [k, v] = map.entries().next().value
				map.delete(k)
				bytes -= v.bytes
			}
		},
		clear() {
			map.clear()
			bytes = 0
		},
		stats: () => ({ entries: map.size, bytes })
	}
}
const deepClone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)))

// ---------------------------------------------------------------- errors
const httpError = (message, status) => Object.assign(new Error(message), { status })
/** What a caller sees: the server's {error} text as an Error (an abort stays the AbortError it is). */
function asError(e) {
	if (e?.name === "AbortError") return e
	if (e?.status) return e
	return httpError(e?.message ?? String(e), e instanceof BadScene ? 400 : 500)
}
const isDict = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

/** clean() leaves out an item whose type this version doesn't have (an imported or saved scene can have any type; the built-in scenarios use only registered ones).
 *  Not silently: a warning for the app to show over the picture. [] when nothing was left out, so a scene of known types answers exactly as the server does. */
function leftOut(scene) {
	const gone = (Array.isArray(scene?.items) ? scene.items : []).filter((i) => isDict(i) && (typeof i.type !== "string" || !(i.type in TYPES)))
	if (!gone.length) return []
	const types = [...new Set(gone.map((i) => String(i.type)))]
	const shown = types.length > 5 ? `${types.slice(0, 5).join(", ")} and ${types.length - 5} more` : types.join(", ")
	const n = gone.length
	return [{ items: gone.map((i) => i.id).filter((id) => typeof id === "string"), text: `${n} item${n === 1 ? "" : "s"} (${shown}) can’t be shown in the browser version yet, so ${n === 1 ? "it was" : "they were"} left out` }]
}

/** the default way to read a file that ships with the page (web/<path>, from wherever this module was served) */
async function fetchJSON(path) {
	const r = await fetch(new URL(`../${path}`, import.meta.url))
	if (!r.ok) throw httpError(r.statusText || `HTTP ${r.status}`, r.status)
	try {
		return await r.json()
	} catch {
		throw httpError(`${path} isn't JSON`, 404) // (a host that answers a missing file with its home page)
	}
}

/** The scenarios' order in the menu (server.py's scenarios()): the built-in ones first, the starter and the empty table at the top, then by name. */
const byMenu = (a, b) => {
	const ka = [!a.builtin, STARTER_ORDER.get(a.id) ?? 9, a.name.toLowerCase()]
	const kb = [!b.builtin, STARTER_ORDER.get(b.id) ?? 9, b.name.toLowerCase()]
	for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1
	return 0
}

// ---------------------------------------------------------------- the API
/** profile: the page's ?profile (its saved scenes are kept apart, as the app's own settings are). engine: a createEngine() to use (default: a new one).
 *  loadJSON(path): reads a file that ships with the page (default: fetch). storage: where saved scenes live (default: localStorage, or memory if the browser won't let it). */
export function createLocalApi({ profile = null, engine = createEngine(), loadJSON = fetchJSON, storage = null } = {}) {
	const SAVED_KEY = profile ? `sandbox@${profile}:saved` : "sandbox:saved"
	const cache = createCache(CACHE_BYTES, CACHE_ENTRIES)
	let unsaved = {} // saved scenes the browser's storage refused (kept for this visit)
	let listP = null

	// ---- saved scenes: {id: scene} under one storage key
	const store = () => {
		try {
			return storage ?? globalThis.localStorage
		} catch {
			return null // (access to localStorage itself can throw)
		}
	}
	function readSaved() {
		let all = {}
		try {
			const v = JSON.parse(store().getItem(SAVED_KEY))
			if (isDict(v)) all = v
		} catch {}
		return { ...all, ...unsaved }
	}
	function writeSaved(all) {
		try {
			store().setItem(SAVED_KEY, JSON.stringify(all))
			unsaved = {}
			return true
		} catch {
			return false
		}
	}

	// ---- scenarios
	/** the built-in scenarios, as web/scenario-list.json (made by tools/gen-scenarios.mjs) lists them */
	const builtinList = () =>
		(listP ??= loadJSON("scenario-list.json").then(
			(l) => {
				if (!Array.isArray(l)) throw httpError("scenario-list.json isn't a list", 500)
				return l
			},
			(e) => {
				listP = null // (tried again next time)
				throw e
			}
		))
	async function scenarios() {
		const built = await builtinList()
		const saved = Object.entries(readSaved()).map(([id, s]) => ({ id, name: String(s?.name ?? id), builtin: false, items: Array.isArray(s?.items) ? s.items.length : 0 }))
		return [...built.map((s) => ({ ...s })), ...saved].sort(byMenu)
	}
	async function scenario(id) {
		id = id.split("/").pop() // (os.path.basename)
		const saved = readSaved()
		if (hasOwn(saved, id) && !(await builtinList()).some((s) => s.id === id)) return deepClone(saved[id])
		try {
			return await loadJSON(`scenarios/${encodeURIComponent(id)}.json`)
		} catch (e) {
			if (e?.status === 404 || e?.status === 403) throw httpError(`no scenario ${id}`, 404)
			throw e
		}
	}
	async function saveScenario(scene) {
		const s = clean(scene)
		const name = pySlice(pyStrip((s.name ?? "").replace(/[^\p{L}\p{N}_\-' ]/gu, "")), 60) || `Scene ${new Date().toTimeString().slice(0, 8).replaceAll(":", "")}`
		let sid = pyLower(name).replace(/\s+/g, "-")
		if ((await builtinList()).some((b) => b.id === sid)) sid += "-mine"
		s.name = name
		s.id = sid
		const all = setOwn(readSaved(), sid, s) // (setOwn: the name may be "__proto__")
		const persisted = writeSaved(all)
		if (!persisted) setOwn(unsaved, sid, s)
		return persisted ? { id: sid, name } : { id: sid, name, persisted: false }
	}

	// ---- runs
	/** items.build() for a cleaned scene: a builder error that is the scene's fault is a BadScene, as server.py's simulate() and layout() make it */
	function built(s) {
		try {
			return build(s)
		} catch (e) {
			if (e instanceof ValueError || e instanceof ArithmeticError) throw new BadScene(`can't build this scene: ${e.message}`)
			throw e
		}
	}
	async function simulate(scene, signal) {
		const s = clean(scene)
		const text = canon({ scene: Object.fromEntries(Object.entries(s).filter(([k]) => k !== "name" && k !== "id")), rate: RATE })
		const hit = cache.get(text)
		if (hit) return { ...deepClone(hit), cached: true } // (the answer of the first run, ms and all; a copy, as every reply was fresh JSON)
		const t0 = performance.now()
		const { doc, resolved } = built(s)
		const track = await engine.run(doc, RATE, signal)
		const meta = finish(s, doc, resolved, track)
		const out = { cached: false, key: keyOf(text), doc: meta.doc, summary: meta.summary, warnings: [...meta.warnings, ...leftOut(scene)], resolved: meta.resolved, ms: Math.floor(performance.now() - t0), track }
		cache.put(text, deepClone(out)) // (the cache keeps its own copy: the app completes the track it gets in place, and a later hit must be as the server's answer)
		return out
	}

	/** (path, body, signal): body undefined = GET, else POST, as the app's api() */
	async function request(path, body, signal) {
		try {
			if (signal?.aborted) throw signal.reason // (as fetch does)
			const route = String(path).split("?")[0]
			if (body === undefined) {
				if (route === "/api/catalog") return catalog()
				if (route === "/api/scenarios") return await scenarios()
				if (route.startsWith("/api/scenarios/")) {
					const raw = route.slice("/api/scenarios/".length)
					let id
					try {
						id = decodeURIComponent(raw)
					} catch {
						throw httpError(`no scenario ${raw.split("/").pop()}`, 404) // (text that isn't percent-encoding is no scenario's name, as the server says)
					}
					return await scenario(id)
				}
			} else {
				if (!isDict(body)) throw new BadScene("the request body must be a JSON object")
				const scene = body.scene === undefined ? {} : body.scene
				if (route === "/api/simulate") return await simulate(scene, signal)
				if (route === "/api/layout") {
					const r = layout(scene)
					return { ...r, warnings: [...r.warnings, ...leftOut(scene)] }
				}
				if (route === "/api/scenarios") return await saveScenario(scene)
			}
			throw httpError("not found", 404)
		} catch (e) {
			throw asError(e)
		}
	}
	request.engine = engine
	request.cache = cache
	return request
}
