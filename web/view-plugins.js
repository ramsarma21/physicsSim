// The physics modules' view hooks (web/view3d.js calls these; web/models3d.js hands addViewPlugin and addFrameHook to every model file):
//   addFrameHook(name, fn)     a model marks a part `obj.userData.frame = {hook: name, ...args}` (data only: three.js clones userData through
//                              JSON, so a function there would be lost); every drawn moment the view calls fn(obj, f, args) with
//                              f = {t, item, solid, state (the item's readings at t: {key: value}), scale (its body's scale at t, 1 if never resized)}.
//                              A hook that changes a material must take its own copy first: ownMaterial(obj) (models share their materials).
//   addViewPlugin({name, load(ctx) -> {frame?(t), dispose?(), environment?} | null})
//                              environment (optional, the first plugin's that has one wins; web/view3d.js applyEnvironment): how the world round the
//                              machine looks for this run: {room: false (no room walls, floor or cabinet), table: false (the table top not drawn: it
//                              still collides), background: a THREE.Color or texture, key, fill, envIntensity (the room light's strengths: 4, 0.3, 0.5)}
//                              once per run: beams, field lines, glows, a HUD clock or a graph board; ctx (below) gives the run, a group to add
//                              its objects to (drawn, shadowed and exported like the models), the readings and placements at any t, and
//                              label(): a camera-facing text sprite (readouts, clocks) that the MP4 export draws too; beam(): a glowing ray or
//                              field-line segment; graph(): a reading's curve on a small board; series(item, key): a reading's points [{t, v}].
// Nothing here runs for a scene without module readings, hooks or plugins (the view draws as before).
import * as THREE from "three"
import { completeTrack, frameIndex } from "./track.js"

/** The layer labels are drawn on: view3d.js's PANE_LAYER (3), which the real cameras and the MP4 export draw and the table's mirror and the chrome
 *  balls' cube maps never do (a readout is not a thing in the room: it has no reflection). Put a plugin's other overlay objects on it too. */
export const HUD_LAYER = 3
const HOOKS = new Map()
const PLUGINS = []

export function addFrameHook(name, fn) {
	if (typeof name !== "string" || typeof fn !== "function") throw new Error("addFrameHook(name, fn)")
	HOOKS.set(name, fn)
}
export function addViewPlugin(p) {
	if (!p || typeof p.name !== "string" || typeof p.load !== "function") throw new Error("addViewPlugin({name, load})")
	const i = PLUGINS.findIndex((q) => q.name === p.name)
	if (i >= 0) PLUGINS[i] = p
	else PLUGINS.push(p)
}
export const viewPlugins = () => PLUGINS

/** This mesh's own material (a copy made once), so a hook can change its colour or glow without touching the shared model's. */
export function ownMaterial(obj) {
	if (!obj.material) return null
	if (!obj.userData._ownMat) {
		obj.material = Array.isArray(obj.material) ? obj.material.map((m) => m.clone()) : obj.material.clone()
		obj.userData._ownMat = true
	}
	return obj.material
}

/** An item's reading at time t, linear between the track's frames (null when the run has none). */
export function stateAt(track, item, key, t) {
	const v = track?.state?.[item]?.[key]
	if (!Array.isArray(v) || !v.length) return null
	const f = track.frames
	const i = frameIndex(track, t)
	const j = Math.min(i + 1, f.length - 1)
	const a = v[i] ?? v[v.length - 1]
	const b = v[j] ?? a
	const span = f[j].t - f[i].t
	const u = span > 0 ? Math.min(1, Math.max(0, (t - f[i].t) / span)) : 0
	return typeof a === "number" && typeof b === "number" ? a + (b - a) * u : a
}
/** Every reading of an item at t: {key: value}. */
export function readingsAt(track, item, t) {
	const keys = track?.state?.[item]
	const out = {}
	if (keys) for (const k of Object.keys(keys)) out[k] = stateAt(track, item, k, t)
	return out
}
/** A solid's placement at t (as track.js placementsAt, for one solid), with its scale. */
export function placementAt(track, id, t) {
	completeTrack(track)
	const f = track.frames
	const i = frameIndex(track, t)
	const a = f[i].placements[id]
	if (!a) return null
	const b = f[Math.min(i + 1, f.length - 1)].placements[id] ?? a
	const span = f[Math.min(i + 1, f.length - 1)].t - f[i].t
	const u = span > 0 ? Math.min(1, Math.max(0, (t - f[i].t) / span)) : 0
	const s0 = a.scale ?? 1
	const s1 = b.scale ?? s0
	return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, angle: a.angle + (b.angle - a.angle) * u, scale: s0 + (s1 - s0) * u }
}

/** A text label that faces the camera: {sprite, set(text, opts?)}. height: its height in metres; colours CSS. */
export function makeLabel({ text = "", height = 0.05, color = "#111", background = "rgba(255,255,255,0.88)", font = "600 64px system-ui, sans-serif" } = {}) {
	const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(512, 128) : document.createElement("canvas")
	canvas.width = 512
	canvas.height = 128
	const tex = new THREE.CanvasTexture(canvas)
	tex.colorSpace = THREE.SRGBColorSpace
	const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true })
	const sprite = new THREE.Sprite(mat)
	sprite.scale.set(height * 4, height, 1)
	sprite.castShadow = false
	sprite.layers.set(HUD_LAYER)
	let shown = null
	const set = (t, o = {}) => {
		const s = String(t)
		if (s === shown) return
		shown = s
		const g = canvas.getContext("2d")
		g.clearRect(0, 0, 512, 128)
		g.fillStyle = o.background ?? background
		const r = 28
		g.beginPath()
		g.roundRect ? g.roundRect(4, 4, 504, 120, r) : g.rect(4, 4, 504, 120)
		g.fill()
		g.fillStyle = o.color ?? color
		g.font = o.font ?? font
		g.textAlign = "center"
		g.textBaseline = "middle"
		g.fillText(s, 256, 68, 480)
		tex.needsUpdate = true
	}
	set(text)
	return { sprite, set, dispose: () => (tex.dispose(), mat.dispose()) }
}

/** A glowing straight beam (a light ray, a field line's segment, a laser): {mesh, set(a, b, opacity?), dispose()}; a and b world points {x, y, z?}.
 *  Unlit (it shines whatever the lights), no shadow. radius in metres. */
export function makeBeam({ color = "#ffe27a", radius = 0.0015, opacity = 0.9 } = {}) {
	const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true)
	const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false })
	const mesh = new THREE.Mesh(geo, mat)
	mesh.castShadow = false
	mesh.receiveShadow = false
	const up = new THREE.Vector3(0, 1, 0)
	const dir = new THREE.Vector3()
	const set = (a, b, o) => {
		dir.set(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0))
		const len = dir.length()
		mesh.visible = len > 1e-6
		if (!mesh.visible) return
		mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, ((a.z ?? 0) + (b.z ?? 0)) / 2)
		mesh.quaternion.setFromUnitVectors(up, dir.divideScalar(len))
		mesh.scale.set(radius, len, radius)
		if (o !== undefined) {
			mat.opacity = o
			mat.transparent = o < 1
		}
	}
	return { mesh, set, dispose: () => (geo.dispose(), mat.dispose()) }
}

/** A small graph board (a reading over time: a temperature, a level, a current) on HUD_LAYER: {mesh, draw(points [{t, v}], tNow), dispose()}.
 *  width/height in metres; tmax and ymin/ymax fix the axes (else from the points). */
export function makeGraph({ width = 0.36, height = 0.22, title = "", unit = "", tmax = null, ymin = null, ymax = null, color = "#d9480f" } = {}) {
	const W = 640
	const Hpx = Math.round((W * height) / width)
	const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, Hpx) : Object.assign(document.createElement("canvas"), { width: W, height: Hpx })
	const tex = new THREE.CanvasTexture(canvas)
	tex.colorSpace = THREE.SRGBColorSpace
	const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat)
	mesh.layers.set(HUD_LAYER)
	let last = ""
	const draw = (points, tNow = Infinity) => {
		const pts = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.t <= tNow)
		const key = `${pts.length}|${pts.at(-1)?.v}`
		if (key === last) return
		last = key
		const g = canvas.getContext("2d")
		g.clearRect(0, 0, W, Hpx)
		g.fillStyle = "rgba(255,255,255,0.92)"
		g.fillRect(0, 0, W, Hpx)
		g.strokeStyle = "#333"
		g.lineWidth = 3
		const L = 70
		const B = Hpx - 50
		g.beginPath()
		g.moveTo(L, 30)
		g.lineTo(L, B)
		g.lineTo(W - 20, B)
		g.stroke()
		g.fillStyle = "#111"
		g.font = "600 30px system-ui, sans-serif"
		g.fillText(`${title}${unit ? ` (${unit})` : ""}`, L + 10, 34)
		const all = points.filter((p) => Number.isFinite(p.v))
		const t1 = tmax ?? Math.max(1e-6, ...all.map((p) => p.t))
		const y0 = ymin ?? Math.min(...all.map((p) => p.v), 0)
		const y1 = ymax ?? Math.max(...all.map((p) => p.v), y0 + 1e-6)
		g.strokeStyle = color
		g.lineWidth = 5
		g.beginPath()
		pts.forEach((p, i) => {
			const x = L + ((W - 20 - L) * p.t) / t1
			const y = B - ((B - 50) * (p.v - y0)) / (y1 - y0 || 1)
			if (i) g.lineTo(x, y)
			else g.moveTo(x, y)
		})
		g.stroke()
		tex.needsUpdate = true
	}
	return { mesh, draw, dispose: () => (tex.dispose(), mat.dispose(), mesh.geometry.dispose()) }
}

/** A model part's hook, if it has one: pushed onto `list` for the run ({obj, fn, args, solid, item}). */
export function collectHooks(obj, solidId, list) {
	const f = obj.userData?.frame
	if (!f || typeof f.hook !== "string") return
	const fn = HOOKS.get(f.hook)
	if (!fn) return
	const item = solidId.includes("/") ? solidId.slice(0, solidId.indexOf("/")) : solidId
	list.push({ obj, fn, args: f, solid: solidId, item })
}

/** The view plugins of a run (after its group is built): [{name, frame?, dispose?, group}]. */
export function startPlugins(run) {
	const out = []
	if (!PLUGINS.length) return out
	for (const p of PLUGINS) {
		const group = new THREE.Group()
		group.name = `plugin:${p.name}`
		const ctx = {
			THREE,
			group,
			sim: run.sim,
			doc: run.doc,
			track: run.track,
			resolved: run.sim?.resolved ?? {},
			stateAt: (item, key, t) => stateAt(run.track, item, key, t),
			readings: (item, t) => readingsAt(run.track, item, t),
			placementAt: (id, t) => placementAt(run.track, id, t),
			solidsOf: (item) => run.doc.solids.filter((s) => s.item === item),
			itemsOfType: (type) => [...new Set(run.doc.solids.filter((s) => s.itemType === type).map((s) => s.item))],
			/** What holds a held item until the release, as the view drew it: "hand" | "fork" | "gate" | "hanger" | "hidden" | "post", or null (not
			 *  held, or no view that says: web/view3d.js buildRun's heldHow). */
			heldBy: (item) => run.heldHow?.get(item) ?? null,
			label: (o) => makeLabel(o),
			beam: (o) => makeBeam(o),
			graph: (o) => makeGraph(o),
			/** A reading's points over the run, [{t, v}] (for a graph). */
			series: (item, key) => (run.track?.state?.[item]?.[key] ?? []).map((v, i) => ({ t: run.track.frames[i]?.t, v })),
			ownMaterial,
			HUD_LAYER // (obj.layers.set(ctx.HUD_LAYER): an overlay the table does not mirror)
		}
		let inst = null
		try {
			inst = p.load(ctx)
		} catch (e) {
			console.warn(`view plugin ${p.name} failed to load:`, e)
		}
		if (!inst) continue
		run.group.add(group)
		out.push({ name: p.name, group, frame: inst.frame, dispose: inst.dispose, environment: inst.environment ?? null })
	}
	return out
}

/** Every hook and plugin at moment t (the view calls it after it has posed the parts). */
export function framePlugins(run, t) {
	for (const h of run.frameHooks ?? []) {
		try {
			const sc = h.args.scaled === false ? 1 : (placementAt(run.track, h.solid, t)?.scale ?? 1)
			h.fn(h.obj, { t, item: h.item, solid: h.solid, state: readingsAt(run.track, h.item, t), scale: sc }, h.args)
		} catch (e) {
			if (!h.warned) console.warn(`frame hook ${h.args.hook} failed:`, e)
			h.warned = true
		}
	}
	for (const p of run.plugins ?? []) {
		try {
			p.frame?.(t)
		} catch (e) {
			if (!p.warned) console.warn(`view plugin ${p.name} failed:`, e)
			p.warned = true
		}
	}
}

/** The run's plugins go with it. */
export function stopPlugins(run) {
	for (const p of run.plugins ?? []) {
		try {
			p.dispose?.()
		} catch {}
	}
}

/** Whether the run has anything that changes with the clock besides the bodies (the view then redraws every frame while it plays). */
export const animates = (run) => (run.frameHooks?.length ?? 0) > 0 || (run.plugins?.length ?? 0) > 0 || !!run.track?.state
