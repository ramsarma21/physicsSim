// The physics sandbox: a scene of catalog items, run by the playground engine (in this page, or on the local Python server: see BROWSER),
// shown in realistic 3D. Click to select, drag to move, ⌫ to delete, / to add.
import { createEditor, startPoses } from "./editor.js"
import { createCatalog, placeholderPreview } from "./catalog-ui.js"
import { createInspector } from "./inspector.js"

const $ = (s, root = document) => root.querySelector(s)
const $$ = (s, root = document) => [...root.querySelectorAll(s)]
const clone = (o) => JSON.parse(JSON.stringify(o))
// ?profile=<name> keeps a tab's saved scene and settings apart from everyone else's (testers use it)
const PROFILE = new URLSearchParams(location.search).get("profile")
const nsKey = (k) => (PROFILE ? k.replace(/^sandbox:/, `sandbox@${PROFILE}:`) : k)
const store = {
	get(k) { try { return JSON.parse(localStorage.getItem(nsKey(k))) } catch { return null } },
	set(k, v) { try { localStorage.setItem(nsKey(k), JSON.stringify(v)) } catch {} },
}
const STARTER = "rube-goldberg"
// Where the catalog, the scenarios, the runs and the saves come from: this page itself (web/sim/api.js answers every request the server would,
// running the engine in a Web Worker; saves go to this browser's localStorage), or the Python server (web/server.py, which binds 127.0.0.1).
// The page picks by where it is served: from this machine (localhost, 127.x, [::1]) it is the server, from anywhere else (a static host) this page.
// ?engine=browser or ?engine=server overrides that.
const ENGINE = new URLSearchParams(location.search).get("engine")
const BROWSER = ENGINE === "browser" || (ENGINE !== "server" && !/^((.+\.)?localhost|127(\.\d+){3}|\[::1\])$/i.test(location.hostname))
// (started now, and the engine's worker as soon as its small module is here: it loads while the rest of the page does)
const localApi = BROWSER ? Promise.all([import("./sim/engine.js").then((m) => m.createEngine()), import("./sim/api.js")]).then(([engine, m]) => m.createLocalApi({ profile: PROFILE, engine })) : null
localApi?.catch(() => {}) // (a failure is reported where a request uses it)

const S = {
	catalog: null, types: {}, scenarios: [],
	scene: null, scenarioId: STARTER, loadedJSON: "", // the scenario as it was loaded: the menu says "Edited scene" once the scene differs
	backend: BROWSER ? "browser" : "server", quality: "auto", firstRunMs: null, // firstRunMs: when the first run landed (ms after the page began loading)
	sim: null, prev: null, layout: null, simSeq: 0,
	selected: null, editing: false,
	t: 0, playing: true, speed: 1, loop: true, hold: 0,
	cam: "wide",
	view: null, editor: null, catalogUI: null, inspector: null,
	history: [], hmeta: [], hi: -1, request: 0, keepCamera: false, // hmeta[i] = {id, json}: the scenario the scene of history[i] was (so undo puts the menu back too)
}
window.sandbox = S // for poking at it from the browser console
// My scenes (web/account/) keeps every scene made here, as it is made: lib() tells it what happened, sandboxApp lets it open and rename one
const lib = (what, ...a) => { try { window.sandboxLibrary?.[what]?.(...a) } catch (e) { console.warn("My scenes:", e) } }
window.sandboxApp = {
	open(scene) { S.scenarioId = ""; S.loadedJSON = JSON.stringify(scene); S.selected = null; setScene(scene, { commit: true, keepCamera: false }) }, // (one undo step, as an import is)
	rename(name) { if (S.scene && name !== S.scene.name) setScene({ ...clone(S.scene), name }, { commit: true }) },
}
const viewEl = () => $("#view-3d")

// ---------- server (or, with ?engine=browser, this page) ----------
async function api(path, body, signal) {
	if (localApi && !String(path).startsWith("/api/ai/")) return (await localApi)(path, body, signal) // rejects with the server's {error} text as an Error, as below (the AI steps always go to the server: web/ai/)
	const r = await fetch(path, body === undefined ? { signal } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal })
	let j
	try {
		j = await r.json()
	} catch (e) {
		if (e?.name === "AbortError" || r.ok) throw e
		throw Object.assign(new Error(r.statusText || `HTTP ${r.status}`), { status: r.status }) // an error page, not the server's {error}
	}
	if (!r.ok || j.error) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, body: j, retryAfter: Number(r.headers.get("Retry-After")) || undefined }) // (retryAfter: a busy AI server says when to come back)
	return j
}

// ---------- the scene ----------
const itemById = (id, sc = S.scene) => sc.items.find((i) => i.id === id)
const typeName = (it) => it.name || S.types[it.type]?.name || it.type

function newId(type) {
	const base = type.replace(/[^a-z0-9]+/gi, "-")
	let n = 1
	while (S.scene.items.some((i) => i.id === `${base}-${n}`)) n++
	return `${base}-${n}`
}
/** A name for another one of something: "Smartphone" → "Smartphone 2", "Ball 1" → "Ball 3" (the first free number). */
function copyName(base) {
	const stem = base.replace(/\s+\d+$/, "")
	const used = new Set(S.scene.items.map(typeName))
	let n = 2
	while (used.has(`${stem} ${n}`)) n++
	return `${stem} ${n}`
}

/** Props as the item stores them: only what differs from its type's defaults. */
function trimProps(it) {
	const d = S.types[it.type]?.defaults ?? {}
	const out = {}
	for (const [k, v] of Object.entries(it.props ?? {})) {
		const dv = d[k]
		if (typeof v === "number" && typeof dv === "number" ? Math.abs(v - dv) > 1e-9 : v !== dv) out[k] = v
	}
	it.props = out
	return it
}

function setScene(scene, { commit = true, keepCamera = true, firstRun = null } = {}) {
	S.scene = scene
	if (S.selected && !itemById(S.selected)) S.selected = null
	renderInspector()
	$("#scene-name").textContent = scene.name || "Untitled scene"
	if (commit) {
		S.editing = false // whatever drag or slider edit led here is over
		pushHistory()
		autosave()
		syncScenarioMenu()
		S.keepCamera = keepCamera
		if (firstRun) run(firstRun)
		else scheduleRun()
		if (!firstRun?.done) requestLayout() // the new scene's start shows at once; the physics follows (unless the boot's run already came back)
	} else {
		requestLayout()
	}
	S.editor?.refresh()
}

function autosave() {
	store.set("sandbox:scene", S.scene)
	store.set("sandbox:scenario", S.scenarioId)
	lib("changed", S)
}

// ---------- history ----------
const scenarioNow = () => ({ id: S.scenarioId, json: S.loadedJSON })
function pushHistory() {
	const snap = JSON.stringify(S.scene)
	if (S.hi >= 0 && S.history[S.hi] === snap) { S.hmeta[S.hi] = scenarioNow(); return }
	S.history = S.history.slice(0, S.hi + 1)
	S.hmeta = S.hmeta.slice(0, S.hi + 1)
	S.history.push(snap)
	S.hmeta.push(scenarioNow())
	if (S.history.length > 300) { S.history.shift(); S.hmeta.shift() }
	S.hi = S.history.length - 1
	syncUndo()
}
function syncUndo() {
	$("#undo").disabled = S.hi <= 0
	$("#redo").disabled = S.hi >= S.history.length - 1
}
function undo(step) {
	S.editor?.flush() // a run of arrow-key nudges counts as one change: settle it first
	const i = S.hi + step
	if (i < 0 || i >= S.history.length) return
	S.hi = i
	S.scene = JSON.parse(S.history[i])
	const m = S.hmeta[i] // the menu and the autosave name the scenario this step was
	if (m) { S.scenarioId = m.id; S.loadedJSON = m.json }
	S.editing = false
	S.simSeq++ // a layout still on its way is for the scene before this step
	if (S.selected && !itemById(S.selected)) S.selected = null
	renderInspector()
	$("#scene-name").textContent = S.scene.name || "Untitled scene"
	autosave()
	syncUndo()
	syncScenarioMenu()
	S.keepCamera = true
	S.editor?.refresh()
	scheduleRun(120) // a burst of undos and redos (key repeat is ~30 ms) becomes one run; the layout shows the step at once
	requestLayout()
}

// ---------- running ----------
let runTimer = 0
let pending = false // a run for the current scene is scheduled or on its way (a layout preview is worth showing until it lands)
let wantPlay = false // Play was pressed while that run was on its way: it plays when it lands
function scheduleRun(wait = 40) {
	clearTimeout(runTimer)
	S.request++ // a run on its way is for the scene before this change: drop its answer and stop the server working on it
	S.abort?.abort()
	pending = true
	$("#chain").classList.add("stale") // what happened belongs to the scene before this change
	runTimer = setTimeout(run, wait)
}
/** A drag, a slider drag or a run of nudges begins: the run that is scheduled or on its way is about to be replaced by this edit's commit. */
function beginEdit() {
	if (S.editing) return
	wantPlay = false // (a new edit replaces whatever was asked for before it)
	setPlaying(false)
	S.t = 0
	S.editing = true
	clearTimeout(runTimer)
	S.request++
	S.abort?.abort()
	if ($("#busy-bar").classList.contains("on")) { // the run that was showing as busy is gone: its commit runs again
		setBusy(false)
		setStatus("idle", "Editing…")
	}
}
/** Whether a layout preview answer is still wanted: while an edit is in progress, or until the run that follows a commit lands. */
const layoutWanted = () => S.editing || pending

/** pre = {promise, ctl}: a /api/simulate request the boot started already (so the engine worked while 3D was loading). */
async function run(pre) {
	const id = ++S.request
	S.abort?.abort() // one simulate request at a time: the newest wins, and the server stops working on the one left behind
	const ctl = (S.abort = pre?.ctl ?? new AbortController())
	pending = true
	setBusy(true)
	let dropped = false
	try {
		const sim = await (pre?.promise ?? api("/api/simulate", { scene: S.scene }, ctl.signal))
		if (id !== S.request) return
		if (S.editing) { // a drag began after this run started: its commit runs again, and the picture under the pointer must not change now
			dropped = true
			setBusy(false)
			return
		}
		if (S.sim && S.sim.key !== sim.key) S.prev = S.freshScene ? null : S.sim // (a whole new scene from the AI: its goals have no "was" in the one before)
		S.freshScene = false
		S.sim = sim
		pending = false
		S.simSeq++ // a layout still on its way is now out of date
		S.layout = null
		layoutError = false
		$("#error").hidden = true
		endAiDraft(false) // (the AI's draft, if one was showing, gives way to the scene's own run)
		S.view.load(sim, null, { keepCamera: S.keepCamera })
		S.keepCamera = true
		S.firstRunMs ??= Math.round(performance.now())
		qualityTip()
		$("#time").max = sim.doc.seconds
		S.t = 0
		S.hold = 0
		setPlaying($("#autoplay").checked || wantPlay) // off by default: a change re-runs and waits at the start (unless Play was pressed meanwhile)
		wantPlay = false
		renderInspector()
		renderResults()
		showWarnings(sim.warnings)
		draw()
		S.editor.refresh()
		setStatus("ok", sim.cached ? "Same run as before" : `Ran in ${(sim.ms / 1000).toFixed(1)} s`)
	} catch (e) {
		if (e?.name === "AbortError" || id !== S.request) return // somebody asked for a newer run (or a drag took over): nothing to report
		pending = false
		wantPlay = false
		layoutError = false
		$("#error").hidden = false
		$("#error").textContent = "Couldn’t run it: " + e.message
		setStatus("error", "Run failed")
	} finally {
		if (id === S.request && !dropped) {
			setBusy(false)
			$("#chain").classList.remove("stale")
		}
	}
}

/** While something is being dragged (or right after a change): where everything starts, without physics (a few ms). */
let layoutBusy = false
let layoutAgain = false
let layoutError = false // #error is showing a layout problem (the last good preview stays on screen)
async function requestLayout() {
	if (layoutBusy) { layoutAgain = true; return }
	if (!layoutWanted()) return
	layoutBusy = true
	const seq = S.simSeq
	try {
		const r = await api("/api/layout", { scene: S.scene })
		if (seq === S.simSeq && S.view && layoutWanted()) { // a run that finished meanwhile (or an edit that ended with no run to come) makes this answer out of date
			if (layoutError) { layoutError = false; $("#error").hidden = true }
			S.layout = r
			const sim = { key: "layout", doc: r.doc, track: { fps: 1, frames: [{ t: 0, placements: startPoses(r.doc) }] }, summary: S.sim?.summary, resolved: r.resolved }
			endAiDraft(false)
			S.view.load(sim, null, { keepCamera: true })
			S.view.render(0)
			S.editor?.draw()
			S.editor?.refresh()
			showWarnings(r.warnings)
		}
	} catch (e) {
		if (e?.name !== "AbortError" && seq === S.simSeq && layoutWanted()) { // the server's short reason, with the last good picture left as it was
			layoutError = true
			$("#error").hidden = false
			$("#error").textContent = "Can’t show that yet: " + e.message
		}
	}
	layoutBusy = false
	if (layoutAgain) { layoutAgain = false; requestLayout() }
}

function setBusy(on) {
	$("#busy-bar").classList.toggle("on", on)
	if (on) setStatus("busy", "Running the physics…")
}
function setStatus(state, text) {
	const el = $("#status")
	el.dataset.state = state
	$("b", el).textContent = text
}

// ---------- what happened ----------
/** The first event between a goal's two items: when the goal's thing happened. */
const goalEvent = (sum, g) => sum.events.find((e) => (e.a === g.item && e.b === g.container) || (e.a === g.container && e.b === g.item))
function renderResults(sim = S.sim) { // (sim: the AI's draft while one plays, so the strip under the view describes what the view shows)
	const ol = $("#chain")
	ol.innerHTML = ""
	const sum = sim?.summary
	if (!sum) return
	const before = sim === S.sim ? S.prev?.summary : null
	const jump = (t) => { setPlaying(false); seek(Math.max(0, t - 0.15)) }
	const goalAt = new Map() // event → the goal it meets
	for (const g of sum.goals) {
		const li = document.createElement("li")
		li.className = `goal ${g.ok ? "ok" : "bad"}`
		const was = before?.goals.find((b) => b.item === g.item && b.container === g.container)
		li.innerHTML = `<span class="k">Goal</span><span class="v">${esc(g.label)}</span>${was && was.ok !== g.ok ? `<span class="was">was ${was.ok ? "yes" : "no"}</span>` : ""}`
		const ev = goalEvent(sum, g)
		li.title = g.ok ? "Done" : "Not this time"
		if (ev) {
			goalAt.set(ev, g)
			li.classList.add("go")
			li.title += ` — click to see it at ${ev.t.toFixed(2)} s`
			li.onclick = () => jump(ev.t)
		}
		ol.append(li)
	}
	const evs = sum.events.slice(0, 9)
	for (const e of evs) {
		const li = document.createElement("li")
		li.className = "event go"
		li.innerHTML = `<span class="k">${e.t.toFixed(2)} s</span><span class="v">${esc(e.text)}</span>`
		li.title = `${e.text} at ${e.speed.toFixed(2)} m/s — click to see it`
		li.onclick = () => jump(e.t)
		ol.append(li)
	}
	if (sum.events.length > evs.length) {
		const li = document.createElement("li")
		li.className = "event"
		li.innerHTML = `<span class="k">and</span><span class="v">${sum.events.length - evs.length} more</span>`
		li.title = sum.events.slice(evs.length).map((e) => `${e.t.toFixed(2)} s  ${e.text}`).join("\n")
		ol.append(li)
	}
	if (!sum.goals.length && !sum.events.length) {
		const li = document.createElement("li")
		li.className = "event"
		// (one thing's own parts striking each other, a Newton's cradle's balls, are hits too: the summary lists only hits between things)
		const itemOf = new Map((sim.doc?.solids ?? []).map((s) => [s.id, s.item]))
		const own = (sim.track?.impacts ?? []).filter((h) => itemOf.get(h.a) != null && itemOf.get(h.a) === itemOf.get(h.b))
		const it = own.length ? (sim === S.sim ? S.scene : null)?.items?.find((i) => i.id === itemOf.get(own[0].a)) : null
		const nm = it ? it.name || S.catalog?.types?.find?.((t) => t.key === it.type)?.name || it.type : null
		if (own.length) {
			li.className = "event go"
			li.innerHTML = `<span class="k">${own[0].t.toFixed(2)} s</span><span class="v">${nm ? `${esc(nm)}: its parts` : "Its parts"} strike each other ${own.length} times</span>`
			li.onclick = () => jump(own[0].t)
		} else li.innerHTML = `<span class="k">Nothing hit anything yet</span><span class="v">Add something with / or the Add button</span>`
		ol.append(li)
	}
	const m = $("#marks")
	m.innerHTML = ""
	const T = sim.doc.seconds
	for (const e of sum.events) {
		const i = document.createElement("i")
		i.style.left = `${(e.t / T) * 100}%`
		i.title = e.text
		const g = goalAt.get(e)
		if (g) i.className = g.ok ? "ok" : "bad"
		m.append(i)
	}
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")

function showWarnings(list) {
	const box = $("#warnings")
	box.innerHTML = ""
	box.hidden = !list || !list.length
	for (const w of list || []) {
		const li = document.createElement("li")
		li.textContent = w.text ?? w
		box.append(li)
	}
}

// ---------- clock ----------
function setPlaying(on) {
	S.playing = on
	$("#play").classList.toggle("playing", on)
	$("#play").setAttribute("aria-label", on ? "Pause" : "Play")
}
function seek(t) {
	S.t = Math.max(0, Math.min((aiDraft ?? S.sim)?.doc.seconds ?? 0, t))
	S.hold = 0
	draw()
}
function draw() {
	if (S.view && S.sim && !S.layout) S.view.render(S.t)
	S.editor?.draw()
	if (S.sim) {
		$("#time").value = S.t
		$("#clock").textContent = `${S.t.toFixed(2)} / ${(aiDraft ?? S.sim).doc.seconds.toFixed(1)} s`
	}
}
let last = performance.now()
let litSelected // the selection the view was last told about (it draws a selected see-through wall as faint acrylic)
function frame(now) {
	const dt = Math.min(0.1, (now - last) / 1000)
	last = now
	if (S.view && S.selected !== litSelected) {
		litSelected = S.selected
		S.view.setHighlight?.({ selected: litSelected, hover: null })
	}
	if (S.sim && S.playing && !S.layout && !S.editing) {
		const T = (aiDraft ?? S.sim).doc.seconds
		if (S.t >= T) {
			S.hold += dt
			if (S.loop && S.hold > 0.8) { S.t = 0; S.hold = 0 }
			else if (!S.loop) setPlaying(false)
		} else {
			S.t = Math.min(T, S.t + dt * S.speed)
		}
		draw()
	} else if (S.view && !S.layout) {
		S.view.render(S.t) // keeps orbit damping alive while paused
		S.editor?.draw()
	}
	requestAnimationFrame(frame)
}

// ---------- the view and its editor ----------
async function startView(moduleP) {
	setStatus("busy", "Loading 3D…")
	const el = viewEl()
	try {
		const { createView3D } = await moduleP
		S.view = createView3D(el)
		S.view.setOptions({ looks: S.catalog.looks, catalog: S.catalog, camera: S.cam }) // (the catalog: the export's directed camera reads its categories and readouts)
		S.view.setQuality?.(S.quality)
		el.addEventListener("quality", qualityTip) // (the view says when its tier changes: Auto steps up and down as the device keeps up or not)
		qualityTip()
	} catch (e) {
		setStatus("error", "3D failed to load")
		$("#error").hidden = false
		$("#error").textContent = "The 3D view couldn’t start: " + e.message
		return false
	}
	S.editor = createEditor(el, S.view, {
		types: S.types,
		getScene: () => S.scene,
		getShown: () => ({ doc: S.layout?.doc ?? S.sim?.doc, track: S.layout ? null : S.sim?.track, t: S.t, layout: !!S.layout }),
		getSelected: () => S.selected,
		onSelect: (id) => select(id),
		onStart() { // (beginEdit also drops the run a commit just before this started: its picture would land under the pointer)
			if (S.editor?.dragging) S.editor.flush() // nudges still waiting for their 300 ms commit are committed now, not in the middle of this drag
			beginEdit()
		},
		onChange(scene) {
			S.scene = scene
			renderInspector()
			requestLayout()
		},
		onCommit(scene) {
			setScene(scene, { commit: true })
		},
		onCancel(scene) { // the drag was abandoned (Esc, or the browser took the gesture): back to how it was
			S.scene = scene
			S.editing = false
			S.simSeq++ // a layout of the abandoned position may still be on its way
			renderInspector()
			S.keepCamera = true
			run()
			requestLayout() // the item snaps back at once; the run follows
		},
	})
	S.views = { "3d": S.view } // aliases for scripts poking at the page
	S.editors = { "3d": S.editor }
	return true
}

// ---------- selection, adding, removing ----------
let panelAfterDrag = false
let panelHiddenByUser = false // hidden with its tab, \ or ☰: picking up or adding a part does not open it again until they do
const narrow = () => matchMedia("(max-width: 900px)").matches // phones: the panel is a sheet over the picture, so it opens only from the ☰ button
function select(id) {
	S.selected = id
	renderInspector()
	S.editor?.draw()
	S.editor?.refresh()
	if (id && document.body.classList.contains("panel-collapsed") && !narrow() && !panelHiddenByUser) panelAfterDrag = true
}

// ---- where a new item goes: on the tabletop, not mid-air and never under it ----
const tableTop = () => S.scene.items.find((i) => i.type === "table")?.y ?? null // the table's anchor is the middle of its top surface
/** The outline (m) of one solid at pose p as a convex polygon (a ball counts as the square around it). */
function solidPoly(s, p) {
	const b = s.body
	if (b.kind === "ball") return [[p.x - b.radius, p.y - b.radius], [p.x + b.radius, p.y - b.radius], [p.x + b.radius, p.y + b.radius], [p.x - b.radius, p.y + b.radius]]
	const c = Math.cos(p.angle)
	const n = Math.sin(p.angle)
	const pts = b.kind === "polygon" ? b.points.map((q) => [q.x, q.y]) : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [(i * b.width) / 2, (j * b.height) / 2])
	return pts.map(([x, y]) => [p.x + x * c - y * n, p.y + x * n + y * c])
}
const boxOf = (poly) => ({ x0: Math.min(...poly.map((q) => q[0])), x1: Math.max(...poly.map((q) => q[0])), y0: Math.min(...poly.map((q) => q[1])), y1: Math.max(...poly.map((q) => q[1])) })
/** Do two convex polygons overlap? (separating axis test) */
function overlaps(A, B) {
	for (const poly of [A, B]) {
		for (let i = 0; i < poly.length; i++) {
			const [x1, y1] = poly[i]
			const [x2, y2] = poly[(i + 1) % poly.length]
			const nx = y1 - y2
			const ny = x2 - x1
			const proj = (P) => P.map(([x, y]) => x * nx + y * ny)
			const a = proj(A)
			const b = proj(B)
			if (Math.max(...a) <= Math.min(...b) || Math.max(...b) <= Math.min(...a)) return false
		}
	}
	return true
}
const footprints = new Map()
/** One item type's box at its own origin: its lowest point and how wide it is. */
function footprint(key) {
	let f = footprints.get(key)
	if (f) return f
	const solids = S.types[key]?.preview?.solids ?? []
	const poses = startPoses({ solids })
	const boxes = solids.map((s) => boxOf(solidPoly(s, poses[s.id])))
	f = boxes.length
		? { x0: Math.min(...boxes.map((b) => b.x0)), x1: Math.max(...boxes.map((b) => b.x1)), y0: Math.min(...boxes.map((b) => b.y0)), y1: Math.max(...boxes.map((b) => b.y1)) }
		: { x0: -0.05, x1: 0.05, y0: -0.05, y1: 0.05 }
	footprints.set(key, f)
	return f
}
/** The y that stands this type's lowest point on the tabletop (1 mm clear of it so the new item doesn't start inside the table). */
const restY = (key, top) => Number((top - footprint(key).y0 + 0.001).toFixed(4))
/** A spot for a new item on the tabletop, as near x as it fits: slide sideways (right, left, right…) until it touches nothing already there;
 *  if the table is full, let it drop onto the pile from above. Returns {x, y}. */
function freeSpot(key, x, y) {
	const doc = S.layout?.doc ?? S.sim?.doc
	if (!doc) return { x, y }
	const f = footprint(key)
	const poses = startPoses(doc)
	const others = doc.solids.filter((s) => itemById(s.item)?.type !== "table" && poses[s.id]).map((s) => solidPoly(s, poses[s.id]))
	const step = Math.max(0.04, f.x1 - f.x0 + 0.02)
	const st = S.scene.stage
	const fits = (cx, cy) => {
		const me = [[cx + f.x0, cy + f.y0], [cx + f.x1, cy + f.y0], [cx + f.x1, cy + f.y1], [cx + f.x0, cy + f.y1]]
		if (st && (me[0][0] < st.x0 || me[1][0] > st.x1)) return false
		return !others.some((o) => overlaps(me, o))
	}
	for (let k = 0; k < 24; k++) {
		const cx = x + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step)
		if (fits(cx, y)) return { x: cx, y }
	}
	for (let k = 1; k < 20; k++) if (fits(x, y + k * (f.y1 - f.y0 + 0.02))) return { x, y: y + k * (f.y1 - f.y0 + 0.02) }
	return { x, y }
}

/** Pointer dropped a card at this world point (w, in the machine plane) at client (cx, cy). If the pointer is on the table (its top seen from above, or its front),
 *  stand the thing on the top; never inside it. */
function dropPoint(key, w, cx, cy) {
	const top = tableTop()
	if (top == null) return w
	const hit = S.view?.surfaceAt?.(cx, cy) // (the ray meets the machine plane above the top for anywhere on the back half of the top: w alone would leave it in mid-air)
	if (hit && itemById(hit.itemId)?.type === "table") return { x: hit.x, y: restY(key, top) }
	return w.y < restY(key, top) ? { x: w.x, y: restY(key, top) } : w
}
/** The Add button / a click on a card: on the tabletop near the middle of the view, clear of what is already there. */
function clickPoint(key) {
	const w = viewCenterWorld()
	const top = tableTop()
	if (top == null) return w
	return freeSpot(key, w.x, restY(key, top))
}

function addItem(type, world) {
	const t = S.types[type]
	if (!t) return
	if (!S.scene) return toast("Still starting up — try again in a moment")
	const sc = clone(S.scene)
	const it = { id: newId(type), type, x: Number(world.x.toFixed(4)), y: Number(world.y.toFixed(4)), angle: 0, props: {} }
	if (S.scene.items.some((i) => typeName(i) === t.name)) it.name = copyName(t.name) // "Smartphone 2": copies can be told apart
	sc.items.push(it)
	S.selected = it.id
	setScene(sc, { commit: true })
	toast(`Added ${typeName(it).toLowerCase()} — drag it where you want it`)
	if (document.body.classList.contains("panel-collapsed") && !narrow() && !panelHiddenByUser) setPanel(true)
}

function viewCenterWorld() {
	const r = viewEl().getBoundingClientRect()
	const w = S.view?.toWorld?.(r.left + r.width * 0.55, r.top + r.height * 0.45)
	return w ?? { x: 1.2, y: 0.6 }
}

function deleteItem(id) {
	const it = itemById(id)
	if (!it) return
	const sc = clone(S.scene)
	sc.items = sc.items.filter((i) => i.id !== id)
	sc.goals = (sc.goals || []).filter((g) => g.item !== id && g.container !== id)
	if (S.selected === id) S.selected = null
	setScene(sc, { commit: true })
	toast(`Deleted ${typeName(it).toLowerCase()} (⌘Z brings it back)`)
}

function duplicateItem(id) {
	const it = itemById(id)
	if (!it) return
	const sc = clone(S.scene)
	const copy = { ...clone(it), id: newId(it.type), name: copyName(typeName(it)), x: Number((it.x + 0.06).toFixed(4)), y: Number((it.y + 0.06).toFixed(4)) }
	sc.items.push(copy)
	S.selected = copy.id
	setScene(sc, { commit: true })
	toast(`Duplicated ${typeName(it).toLowerCase()} as “${copy.name}”`)
}

function patchItem(id, patch, commit) {
	const sc = clone(S.scene)
	const it = itemById(id, sc)
	if (!it) return
	for (const k of ["x", "y", "angle", "name", "held", "fixed"]) if (k in patch) it[k] = patch[k]
	if (patch.props) {
		it.props = { ...(it.props ?? {}), ...patch.props }
		trimProps(it)
	}
	if (!commit) {
		S.editor?.flush() // arrow-key nudges still waiting for their 300 ms commit are committed now, not in the middle of this slider drag
		beginEdit()
	}
	setScene(sc, { commit })
}

async function loadScenario(id, { keepCamera = false } = {}) {
	try {
		const sc = await api(`/api/scenarios/${encodeURIComponent(id)}`)
		lib("fresh", "scenario", id)
		S.scenarioId = id
		S.loadedJSON = JSON.stringify(sc)
		S.selected = null
		setScene(sc, { commit: true, keepCamera })
	} catch (e) { toast("Couldn’t load it: " + e.message); syncScenarioMenu() }
}

function clearScene() {
	const table = S.scene.items.find((i) => i.type === "table")
	const sc = { ...clone(S.scene), name: "Empty table", items: table ? [clone(table)] : [{ id: "table", type: "table", name: "Table", x: 1.3, y: 0, angle: 0, props: {} }], goals: [] }
	S.selected = null
	setScene(sc, { commit: true })
	toast("Cleared: just the table left (select it and press ⌫ for nothing at all)")
}

// ---------- panels ----------
/** The settings panel floats over the view (so opening it never re-frames the picture), on the side away from the selected item. */
function dockSide() {
	const it = S.selected && itemById(S.selected)
	const p = it && S.view?.toScreen?.(it.x, it.y)
	return p && p.x < viewEl().clientWidth * 0.45 ? "right" : "left"
}
function setPanel(open) {
	if (open) document.body.classList.toggle("panel-right", dockSide() === "right")
	document.body.classList.toggle("panel-collapsed", !open)
	$("#toggle-panel").setAttribute("aria-expanded", String(open))
	const tab = $("#panel-tab")
	if (tab) {
		const say = open ? "Hide the settings panel" : "Show the settings panel"
		tab.title = `${say} (\\)`
		tab.setAttribute("aria-label", say)
		tab.setAttribute("aria-expanded", String(open))
	}
	store.set("sandbox:panel", open)
}
/** The person shows or hides the panel (its tab, \, ☰): a hide sticks until they show it again. */
function togglePanel() {
	const open = document.body.classList.contains("panel-collapsed")
	panelHiddenByUser = !open
	setPanel(open)
}

function renderInspector() {
	S.inspector?.render(S.scene, S.selected, S.layout?.resolved ?? S.sim?.resolved ?? {}, S.sim?.summary?.readings ?? null)
}

/** A catalog card's picture: the item's 3D model, photographed (thumbs3d.js, loaded on first use); the flat drawing until then. */
let thumbs = null
let thumbsLoading = null
/** Is something moving that a thumbnail render (100 ms to 1.5 s of main thread each) would stutter? Playing, or a drag, slider or nudge in progress.
 *  With the catalog open the cards are what the person is looking at (and Space does not pause from there), so playback behind the drawer does not count. */
const somethingMoves = () => !!(S.sim && S.playing && !S.layout && !S.catalogUI?.isOpen()) || S.editing || !!S.editor?.dragging
function paintCard(m, canvas, preview, looks) {
	if (!m.hasShot(preview)) placeholderPreview(canvas, preview, looks) // never a blank card: the flat drawing shows until its own photo is ready
	m.drawPreview3D(canvas, preview, looks, null)
}
function drawCard(canvas, preview, looks) {
	if (thumbs) return paintCard(thumbs, canvas, preview, looks)
	placeholderPreview(canvas, preview, looks)
	thumbsLoading ??= import("./thumbs3d.js").then((m) => { thumbs = m; m.setCatalog(S.catalog); m.setVisibleOnly(true); m.setPause(somethingMoves); return m }).catch((e) => { console.warn("3D thumbnails unavailable:", e); return null })
	thumbsLoading.then((m) => m && paintCard(m, canvas, preview, looks))
}

// ---------- the scenario menu ----------
let scenarioList = []
async function loadScenarioList(listP = api("/api/scenarios")) {
	scenarioList = await listP
	const sel = $("#scenario")
	sel.innerHTML = `<option value="" hidden>Edited scene</option>` + scenarioList.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}${s.builtin ? "" : " (mine)"}</option>`).join("")
	syncScenarioMenu()
}
/** The menu names the scenario the scene still is, or "Edited scene" once it differs (so picking any scenario, even the one it began as, loads it). */
function syncScenarioMenu() {
	const sel = $("#scenario")
	if (!sel) return
	const same = S.scene && JSON.stringify(S.scene) === S.loadedJSON
	const v = same && scenarioList.some((s) => s.id === S.scenarioId) ? S.scenarioId : ""
	// a scene opened from elsewhere (an example, a file, My scenes) is named until it is changed
	const blank = sel.querySelector("option[value='']")
	if (blank) blank.textContent = v === "" && same && S.scene?.name ? S.scene.name : "Edited scene"
	if (sel.value !== v) sel.value = v
}

let toastTimer = 0
function toast(text) {
	const t = $("#toast")
	t.textContent = text
	t.hidden = false
	clearTimeout(toastTimer)
	toastTimer = setTimeout(() => (t.hidden = true), 2600)
}

async function saveScene() {
	const name = prompt("Save this scene as", S.scene.name || "My scene")?.trim()
	if (!name) return
	const clash = scenarioList.find((s) => !s.builtin && s.name.toLowerCase() === name.toLowerCase() && s.id !== S.scenarioId)
	if (clash && !confirm(`There is already a saved scene called “${clash.name}”. Replace it?`)) return
	try {
		const r = await api("/api/scenarios", { scene: { ...S.scene, name } })
		S.scene.name = r.name // the scene is now called that everywhere: header, inspector, and the history entry it sits on
		S.scenarioId = r.id
		S.loadedJSON = JSON.stringify(S.scene)
		if (S.hi >= 0) { S.history[S.hi] = S.loadedJSON; S.hmeta[S.hi] = scenarioNow() }
		$("#scene-name").textContent = r.name
		renderInspector()
		autosave()
		await loadScenarioList()
		toast(r.persisted === false ? "Saved for this visit only (the browser won’t keep it)" : BROWSER ? "Saved in this browser" : "Saved")
	} catch (e) { toast(e.message) }
}

/** Export: the scene as a .json file to keep (a Blob download, no server). */
function exportScene() {
	const file = ((S.scene.name || "").replace(/[^\p{L}\p{N}_\- ]+/gu, "").trim().replace(/\s+/g, "-").toLowerCase() || "scene") + ".json"
	const a = document.createElement("a")
	a.href = URL.createObjectURL(new Blob([JSON.stringify(S.scene, null, 1)], { type: "application/json" }))
	a.download = file
	document.body.append(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(a.href), 10000)
	toast(`Exported ${file}`)
}
/** Import: a scene from a .json file (an exported one, or any scene). The builder checks it first, so a file it can't use is refused with its reason
 *  and the scene on screen stays. It opens as an edited scene (not one of the menu's), Save keeps it. */
async function importScene(file) {
	if (!file) return
	try {
		if (file.size > 8 << 20) throw new Error("it is too big to be a scene (8 MB at most)")
		let sc
		try { sc = JSON.parse(await file.text()) } catch { throw new Error("it isn’t JSON") }
		if (!sc || typeof sc !== "object" || Array.isArray(sc) || !Array.isArray(sc.items)) throw new Error("it isn’t a scene (a scene has an items list)")
		await api("/api/layout", { scene: sc })
		// the builder reads "0.5" as a number (and a missing x, y or angle as 0), but the editor does arithmetic on them: make them numbers now
		for (const it of sc.items) {
			if (!S.types[it.type]) continue // (an item of a type this version doesn't have is left out by the builder anyway)
			for (const k of ["x", "y", "angle"]) {
				const n = it[k] == null ? 0 : Number(it[k])
				if (!Number.isFinite(n)) throw new Error(`${it.id}: ${k} must be a number`)
				it[k] = n
			}
		}
		S.scenarioId = ""
		S.loadedJSON = ""
		S.selected = null
		lib("fresh", "import")
		setScene(sc, { commit: true, keepCamera: false })
		toast(`Opened “${sc.name || file.name}”`)
	} catch (e) { toast("Couldn’t open that file: " + e.message) }
}

// ---------- picture quality (the view's setQuality / getQuality, where it has them) ----------
const QUALITIES = ["auto", "high", "low", "medium"] // (the control offers the first three; the view also has a medium tier, which ?quality=medium picks)
/** The control's tooltip says what the view is doing now (Auto changes the tier as the device keeps up or not). */
function qualityTip() {
	const el = $("#quality")
	if (!el) return
	let q = null
	try { q = S.view?.getQuality?.() } catch {}
	el.title = q ? `Picture quality: ${q.mode === "auto" ? `Auto, now ${q.tier}` : q.mode}${q.reason ? ` (${q.reason})` : ""}` : "Picture quality: Auto keeps it smooth on this device; High and Low fix it"
}
function setQuality(mode) {
	S.quality = mode
	for (const b of $$("#quality button")) b.setAttribute("aria-pressed", String(b.dataset.quality === mode))
	store.set("sandbox:quality", mode)
	S.view?.setQuality?.(mode)
	qualityTip()
}

// ---------- Build with AI (web/ai/panel.js: loaded when first opened, or once the page is idle) ----------
// The AI's draft: while it keeps checking and refining, its latest run plays in the view (a "Draft" badge says so). It is not the scene:
// no history, no autosave, and the view takes no pointer input meanwhile (body.ai-draft). The build lands as one undo step, as before.
let aiDraft = null
let aiDraftSeq = 0 // (a placed-scene preview still on its way is dropped once a newer draft, or the end of the draft, came)
let aiBefore = null // the clock before the first draft: a cancelled build puts it back as it was
/** While a draft shows, everything around the view says so: the status chip, the scene's name and the scenarios menu read "AI draft", and the
 *  strip under the view and the timeline's marks are the draft's own run (placed but not run yet: one line saying so). */
function aiDraftInfo(sim) {
	if (!aiBefore?.status) aiBefore = { ...aiBefore, status: { state: $("#status").dataset.state, text: $("#status b").textContent } }
	setStatus("busy", "AI draft · not applied yet")
	$("#scene-name").textContent = "AI draft (the AI is still working)"
	const opt = $("#scenario option[value='']")
	if (opt) { opt.textContent = "AI draft"; $("#scenario").value = "" }
	$("#chain").classList.remove("stale")
	if (sim.summary) return renderResults(sim)
	$("#chain").innerHTML = `<li class="event"><span class="k">AI draft</span><span class="v">Placed · the physics runs next</span></li>`
	$("#marks").innerHTML = ""
}
function showAiDraft(sim) {
	if (!S.view || !sim?.doc || S.editing || S.editor?.dragging) return false
	aiDraftSeq++
	const first = !aiDraft
	if (first) aiBefore = { t: S.t, playing: S.playing }
	aiDraft = sim
	document.body.classList.add("ai-draft")
	S.view.load(sim, null, { keepCamera: !first }) // (the first draft is framed; later ones keep the camera)
	$("#time").max = sim.doc.seconds
	S.t = 0
	S.hold = 0
	setPlaying(true)
	aiDraftInfo(sim)
	return true
}
/** The AI's placed scene before its run (one still frame, from /api/layout): shown at once; its run replaces it a moment later. */
function showAiDraftLayout(scene) {
	if (!S.view || !scene || S.editing || S.editor?.dragging) return false
	const seq = ++aiDraftSeq
	api("/api/layout", { scene }).then((r) => {
		if (seq !== aiDraftSeq || !S.view || S.editing || S.editor?.dragging) return
		if (!aiDraft) aiBefore = { t: S.t, playing: S.playing }
		aiDraft = { key: "ai-layout", doc: r.doc, track: { fps: 1, frames: [{ t: 0, placements: startPoses(r.doc) }] }, summary: null, resolved: r.resolved }
		document.body.classList.add("ai-draft")
		S.view.load(aiDraft, null, { keepCamera: false })
		S.t = 0
		S.hold = 0
		setPlaying(false)
		S.view.render(0)
		aiDraftInfo(aiDraft)
	}, () => {})
	return true
}
function endAiDraft(reload = true) {
	aiDraftSeq++
	if (!aiDraft) return
	aiDraft = null
	document.body.classList.remove("ai-draft")
	const was = aiBefore
	aiBefore = null
	// (the scene on the table speaks for itself again: what a run on its way says replaces this a moment later)
	if (was?.status) setStatus(was.status.state, was.status.text)
	$("#scene-name").textContent = S.scene?.name || "Untitled scene"
	const opt = $("#scenario option[value='']")
	if (opt) opt.textContent = "Edited scene"
	syncScenarioMenu()
	renderResults()
	$("#chain").classList.toggle("stale", pending)
	if (reload && S.sim && !pending) { // back to the scene on the table, at the moment it showed (a run on its way loads it anyway)
		S.view.load(S.sim, null, { keepCamera: false })
		$("#time").max = S.sim.doc.seconds
		S.t = Math.min(was?.t ?? 0, S.sim.doc.seconds)
		if (was) setPlaying(was.playing)
		draw()
	}
}
let aiPanel = null
let aiLoading = null
function withAI(then) {
	aiLoading ??= import("./ai/panel.js").then((m) => (aiPanel = m.mountAiPanel({
		api, profile: PROFILE, viewport: $(".viewport"), button: $("#ai"), toast, drawPreview: drawCard,
		getScene: () => S.scene, getCatalog: () => S.catalog,
		applyScene(scene, { label, play, fresh = false, verb = "Built" }) { // one undo step, named after the plan (the scene's name), framed and played from the start
			endAiDraft(false) // (the draft stays on screen until the new scene's own picture replaces it: no flash of the old scene)
			S.scenarioId = ""; S.loadedJSON = ""; S.selected = null
			if (play) wantPlay = true
			S.freshScene = fresh
			if (fresh) lib("fresh", "ai")
			const was = S.history[S.hi]
			setScene(clone(scene), { commit: true, keepCamera: false })
			const committed = S.history[S.hi] !== was // (the same scene again adds no history entry: there is nothing to undo)
			toast(committed ? `${verb} “${label}” (${matchMedia("(pointer: coarse)").matches ? "Undo takes it back" : "⌘Z undoes it"})` : `No change: “${label}” is the scene already on the table`)
			return committed
		},
		replay: () => { if (S.layout) $("#play").click(); else { seek(0); setPlaying(true) } },
		undo: () => undo(-1),
		historyIndex: () => S.hi, // (the panel offers Undo on its latest build only while that build is still this history entry)
		draft: (sim, scene) => (sim ? showAiDraft(sim) : scene ? showAiDraftLayout(scene) : (endAiDraft(true), false)), // (a scene alone: as placed, before its run)
		getSim: () => S.sim, // (an edit compares its run with this one: which goals worked before the change)
		openNew: (o) => openNew(o), // (a new scene is made in New → Build with AI, never by Edit with AI)
	}))).catch((e) => { aiLoading = null; toast("The AI panel couldn’t load: " + e.message); throw e })
	return aiLoading.then(() => then?.(aiPanel), () => {})
}
// New (key N): the "Create new project" dialog (web/ai/new-project.js): Blank, Build with AI, or Start from an example
let newDialog = null
function openNew(opts = {}) {
	if ($("#new")?.disabled) return
	newDialog ??= import("./ai/new-project.js").then((m) => m.mountNewProject({
		scenarios: () => scenarioList, toast, blank: () => (lib("fresh", "blank"), clearScene()), save: saveScene, download: exportScene,
		loadScenario: (id) => loadScenario(id),
		current: () => ({ name: S.scene?.name, dirty: !!S.scene?.items?.some((i) => i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d)) && JSON.stringify(S.scene) !== S.loadedJSON && !window.sandboxLibrary?.holds?.() }), // (a scene My scenes keeps needs no saving first)
		buildAI: (text, images) => withAI((p) => p.buildNew(text, images)),
		library: (el, done) => lib("renderRecent", el, done), // (the row of the person's recent scenes, and the way to all of them)
	})).catch((e) => { newDialog = null; toast("Couldn’t open New: " + e.message); throw e })
	newDialog.then((d) => d.open(opts), () => {})
}
S.openNew = openNew

// ---------- Export video (web/export/export-ui.js: the dialog, the E key and the top-bar button; it finds the renderer and the encoder itself) ----------
// Its Directed camera asks the AI step "direct" for a shot plan of the run (POST /api/ai/direct through the AI's own client: queue, progress,
// sign-in and allowance answers), where the AI can be used (web/ai/access.js); elsewhere it films the view's automatic directed camera.
let directAI = null
const directPlan = async (payload, signal, onEvent) => {
	directAI ??= import("./ai/orchestrator.js").then((m) => m.createOrchestrator({ api }))
	return (await directAI).call("direct", payload, signal, onEvent)
}
let aiAccessNow = null
import("./ai/access.js").then((m) => { const a = m.aiAccess(); aiAccessNow = () => (a.check?.(), a.state.kind) }).catch(() => { aiAccessNow = () => "off" }) // (asked once, when the dialog first wants to know)
import("./export/export-ui.js").then((m) => (S.exportUI = m.mountExportUI({
	button: $("#export-video"), store, toast, viewEl: viewEl(),
	get: () => ({ scene: S.scene, sim: S.sim, view: S.view, layout: S.layout, editing: S.editing || !!S.editor?.dragging, cam: S.cam, t: S.t, playing: S.playing }),
	pause: () => setPlaying(false),
	play: () => setPlaying(true),
	rerun: () => scheduleRun(0),
	direct: directPlan,
	aiState: () => (aiAccessNow ? aiAccessNow() : "ok"),
}))).catch((e) => console.warn("Video export unavailable:", e))

// ---------- wiring ----------
function setCam(cam) {
	S.cam = cam
	for (const o of $$("#cam button")) o.setAttribute("aria-pressed", String(o.dataset.cam === cam))
	S.view?.setOptions({ camera: cam })
	draw()
}

/** Until the first scene is up (the 3D module and the first physics run are still on their way) there is nothing for these to act on. */
const bootLock = (on) => { for (const sel of ["#add", "#ai", "#new", "#clear", "#reset", "#save", "#export", "#import", "#scenario"]) if ($(sel)) $(sel).disabled = on }

const NOT_TEXT = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"])
function wire() {
	bootLock(true)
	document.documentElement.dataset.engine = S.backend
	if (BROWSER) {
		$("#status").title = "The physics runs in this browser"
		$("#save").title = "Save this scene in this browser"
	}
	$("#play").onclick = () => {
		if (S.layout) { // the picture is a preview: Play means "run it and play it"
			if (pending) { wantPlay = true; return } // the run on its way plays when it lands; it is not thrown away and started over (pressing again changes nothing)
			S.layout = null; S.editing = false; clearTimeout(runTimer); wantPlay = true; run()
			return
		}
		if (!S.playing && S.sim && S.t >= S.sim.doc.seconds) S.t = 0
		setPlaying(!S.playing)
	}
	$("#restart").onclick = () => { seek(0); setPlaying(true) }
	$("#time").addEventListener("input", (e) => { setPlaying(false); seek(Number(e.target.value)) })
	for (const b of $$("#speed button")) b.onclick = () => {
		S.speed = Number(b.dataset.speed)
		for (const o of $$("#speed button")) o.setAttribute("aria-pressed", String(o === b))
	}
	$("#loop").onchange = (e) => (S.loop = e.target.checked)
	$("#autoplay").checked = store.get("sandbox:autoplay") === true
	$("#autoplay").onchange = (e) => store.set("sandbox:autoplay", e.target.checked)
	for (const b of $$("#cam button")) b.onclick = () => setCam(b.dataset.cam)
	$("#frame").onclick = () => {
		if (S.cam !== "wide") setCam("wide") // Fit re-frames the wide shot: show it
		S.view?.frame?.()
		draw()
	}
	$("#undo").onclick = () => undo(-1)
	$("#redo").onclick = () => undo(1)
	$("#toggle-panel").onclick = togglePanel
	$("#panel-tab").onclick = togglePanel
	$("#add").onclick = () => S.catalogUI?.toggle()
	$("#ai").onclick = () => withAI((p) => p.toggle())
	$("#new").onclick = () => openNew()
	$("#clear").onclick = clearScene
	$("#reset").onclick = () => { loadScenario(STARTER); toast("Back to the starter machine (⌘Z undoes)") }
	$("#scenario").onchange = (e) => {
		const id = e.target.value
		e.target.blur() // keep the keyboard shortcuts (⌘Z, Space, ⌫) working after a pick
		if (id) loadScenario(id)
	}
	$("#save").onclick = saveScene
	$("#export").onclick = exportScene
	$("#import").onclick = () => $("#import-file").click()
	$("#import-file").onchange = (e) => {
		const f = e.target.files?.[0]
		e.target.value = "" // (so the same file can be picked again)
		importScene(f)
	}
	// (a page opened with ?quality=… keeps what the view makes of it: the view reads that itself, so it is the first choice here too)
	const q = new URLSearchParams(location.search).get("quality") ?? store.get("sandbox:quality")
	S.quality = QUALITIES.includes(q) ? q : "auto"
	for (const b of $$("#quality button")) {
		b.setAttribute("aria-pressed", String(b.dataset.quality === S.quality))
		b.onclick = () => setQuality(b.dataset.quality)
	}
	for (const ev of ["pointerenter", "focusin"]) $("#quality").addEventListener(ev, qualityTip)
	window.addEventListener("pointerup", () => {
		if (!panelAfterDrag) return
		panelAfterDrag = false
		setTimeout(() => setPanel(true), 0)
	})
	window.addEventListener("resize", () => { S.view?.resize(); draw() })
	new ResizeObserver(() => { S.view?.resize(); draw() }).observe($(".viewport"))
	window.addEventListener("keydown", (e) => {
		const el = e.target
		const type = (el?.type || "").toLowerCase()
		const tag = el?.tagName
		// only real text fields own the keyboard: sliders, switches, buttons and menus keep the shortcuts (their own keys excepted)
		const textual = !!el && (el.isContentEditable || tag === "TEXTAREA" || (tag === "INPUT" && !NOT_TEXT.has(type)))
		const mod = e.metaKey || e.ctrlKey
		const key = e.key.toLowerCase()
		if (S.editor?.dragging) { // mid-drag: Esc puts the item back, nothing else may change the scene under the pointer
			if (e.key === "Escape") { e.preventDefault(); S.editor.cancel() }
			else if (mod && "zyd".includes(key) && !textual) e.preventDefault()
			return
		}
		if (mod && (key === "z" || key === "y" || key === "d")) {
			if (textual) return // the box's own undo
			e.preventDefault()
			if (key === "d") { if (S.selected) duplicateItem(S.selected) }
			else undo(key === "y" || e.shiftKey ? 1 : -1)
			return
		}
		if (textual) return
		if (S.catalogUI?.isOpen() && (e.key === "Escape" || el?.closest?.("#catalog"))) {
			if (e.key === "Escape") S.catalogUI.close()
			return
		}
		if (e.key === "/") { e.preventDefault(); S.catalogUI?.open(); return }
		if (e.key === "\\" && !mod && !e.altKey) { e.preventDefault(); togglePanel(); return }
		if (key === "a" && !mod && !e.altKey && !$("#ai").disabled) { e.preventDefault(); withAI((p) => p.open()); return }
		if (key === "n" && !mod && !e.altKey && !$("#new").disabled) { e.preventDefault(); openNew(); return }
		if ((e.key === "Backspace" || e.key === "Delete") && S.selected) { e.preventDefault(); deleteItem(S.selected); return }
		if (e.key === "Escape" && S.selected) { select(null); return }
		const owns = tag === "SELECT" || (tag === "INPUT" && (type === "range" || type === "radio")) // arrows work these
		if (e.code === "Space") {
			if (tag === "SELECT" || type === "checkbox" || type === "radio") return // Space opens or toggles these
			e.preventDefault()
			$("#play").click()
			return
		}
		const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
		if (arrows[e.key] && !owns) {
			e.preventDefault()
			if (S.selected) {
				const step = e.shiftKey ? 0.05 : 0.005
				S.editor?.nudge(arrows[e.key][0] * step, arrows[e.key][1] * step)
			} else if (arrows[e.key][1] === 0) { setPlaying(false); seek(S.t + arrows[e.key][0] / 30) }
		}
	})
	const vp = $(".viewport")
	S.dropOver = (on) => { vp.classList.toggle("dropping", on); $("#drop-hint").hidden = !on }
}

async function main() {
	wire()
	// The slow things start together: the catalog, the scenario list, the 3D module, and the scene with its first physics run
	// (the engine works while 3D loads, instead of starting only when the first picture has been built).
	const saved = store.get("sandbox:scene")
	S.scenarioId = store.get("sandbox:scenario") || STARTER
	const catalogP = api("/api/catalog")
	const listP = api("/api/scenarios")
	const moduleP = import("./view3d.js")
	for (const p of [catalogP, listP, moduleP]) p.catch(() => {}) // (each is reported where it is used)
	const firstP = (saved?.items ? Promise.resolve(saved) : api(`/api/scenarios/${encodeURIComponent(STARTER)}`)).then((scene) => {
		const ctl = new AbortController()
		const pre = { scene, ctl, done: false, promise: api("/api/simulate", { scene }, ctl.signal) }
		pre.promise.then(() => (pre.done = true), () => (pre.done = true))
		return pre
	})
	firstP.catch(() => {})
	try {
		S.catalog = await catalogP
	} catch (e) {
		setStatus("error", BROWSER ? "Engine not available" : "Server not reachable")
		$("#error").hidden = false
		$("#error").textContent = BROWSER ? "The in-browser engine couldn’t start: " + e.message : "Start the server: python3 web/server.py"
		return
	}
	S.types = Object.fromEntries(S.catalog.types.map((t) => [t.key, t]))
	S.inspector = createInspector($("#panel"), {
		catalog: S.catalog,
		drawPreview: drawCard,
		onSelect: (id) => select(id),
		onChange: (id, patch, commit) => patchItem(id, patch, commit),
		onScene: (patch, commit) => setScene({ ...clone(S.scene), ...patch }, { commit }),
		onDelete: (id) => deleteItem(id),
		onDuplicate: (id) => duplicateItem(id),
		onNotice: toast,
	})
	const vp = $(".viewport")
	const catHost = $("#catalog")
	S.catalogUI = createCatalog(catHost, {
		catalog: S.catalog,
		drawPreview: drawCard,
		onShow: (canvases) => thumbs?.prioritize(canvases), // what the chips or the search now show is photographed first
		onAdd: (key) => { S.catalogUI.close(); addItem(key, clickPoint(key)) },
		// over the picture (and not still over the drawer): show the "drop here" hint; null = the drag ended
		onDragOver: (cx, cy) => {
			if (cx == null) return S.dropOver(false)
			const vr = vp.getBoundingClientRect()
			const cr = catHost.getBoundingClientRect()
			const overDrawer = !catHost.hidden && cx >= cr.left && cx <= cr.right && cy >= cr.top && cy <= cr.bottom
			S.dropOver(cx >= vr.left && cx <= vr.right && cy >= vr.top && cy <= vr.bottom && !overDrawer)
		},
		onDrop: (key, cx, cy) => {
			S.dropOver(false)
			const vr = vp.getBoundingClientRect()
			const cr = catHost.getBoundingClientRect()
			const overDrawer = !catHost.hidden && cx >= cr.left && cx <= cr.right && cy >= cr.top && cy <= cr.bottom
			if (cx < vr.left || cx > vr.right || cy < vr.top || cy > vr.bottom || overDrawer) return
			const w = S.view?.toWorld?.(cx, cy)
			if (w) addItem(key, dropPoint(key, w, cx, cy))
		},
	})

	await loadScenarioList(listP).catch(() => {})
	setPanel(store.get("sandbox:panel") === true)
	if (!(await startView(moduleP))) return
	const pre = await firstP.catch(() => null) // the first run: already on its way or done
	if (saved?.items) {
		S.scene = saved
		$("#scene-name").textContent = saved.name || "Untitled scene"
		renderInspector()
		pushHistory()
		// is it still the scenario it began as? (the menu says so)
		const id = S.scenarioId
		api(`/api/scenarios/${encodeURIComponent(id)}`).then((sc) => {
			if (S.scenarioId !== id) return // another scenario was picked meanwhile
			S.loadedJSON = JSON.stringify(sc)
			for (const m of S.hmeta) if (m.id === id && !m.json) m.json = S.loadedJSON // (the boot's history entry was made before this answer came)
			syncScenarioMenu()
		}).catch(() => {})
		syncScenarioMenu()
		bootLock(false)
		const first = run(pre)
		if (!pre?.done) requestLayout() // (a run still on its way: the scene's start shows at once, as the starter's boot does; the physics follows)
		await first
	} else if (pre) {
		S.scenarioId = STARTER
		S.loadedJSON = JSON.stringify(pre.scene)
		S.selected = null
		setScene(pre.scene, { commit: true, keepCamera: false, firstRun: pre })
		bootLock(false)
	} else {
		await loadScenario(STARTER)
		bootLock(false)
	}
	requestAnimationFrame(frame)
	;(window.requestIdleCallback ?? ((f) => setTimeout(f, 1500)))(() => withAI(), { timeout: 4000 })
}
main()
