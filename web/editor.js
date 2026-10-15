// Picks up, moves, turns and resizes scene items in the 3D view. The view supplies the geometry
// (pick / toWorld / toScreen / pxPerMeter); this owns hover, handles and what a drag changes.
// An overlay canvas draws the selection; pointer events are read on the container in the capture
// phase and stopped only when an item is grabbed, so a 3D orbit still gets empty-space drags.
import { placementsAt } from "./track.js"

const D2R = Math.PI / 180
const HANDLE_PX = 7
const MIN_DOT_PX = 16 // a radius or swing dot is never drawn closer than this to the item's centre

const clone = (o) => JSON.parse(JSON.stringify(o))

/** Each solid's world pose where it starts (a part fixed to a parent sits in the parent's frame). */
export function startPoses(doc) {
	const by = Object.fromEntries(doc.solids.map((s) => [s.id, s]))
	const out = {}
	for (const s of doc.solids) {
		let x = s.at.x
		let y = s.at.y
		let a = s.angle ?? 0
		if (s.parent) {
			const q = by[s.parent]
			const qa = q.angle ?? 0
			x = q.at.x + s.at.x * Math.cos(qa) - s.at.y * Math.sin(qa)
			y = q.at.y + s.at.x * Math.sin(qa) + s.at.y * Math.cos(qa)
			a += qa
		}
		out[s.id] = { x, y, angle: a }
	}
	return out
}

export function createEditor(container, view, opts) {
	// opts: { types: {key: catalog type}, getScene(), getShown() -> {doc, track, t, layout}, getSelected(), onSelect(id),
	//         onStart(), onChange(scene), onCommit(scene), onCancel(scene) }
	const overlay = document.createElement("canvas")
	overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3"
	container.append(overlay)
	const ctx = overlay.getContext("2d")
	let hover = null
	let hoverHandle = null
	let drag = null
	let pointer = null // the pointer in container px
	let lastClient = null // and in client px, for refresh()
	let nudgeTimer = 0

	const scene = () => opts.getScene()
	const itemById = (id) => scene().items.find((i) => i.id === id)
	const typeOf = (it) => opts.types[it.type]
	const propsOf = (it) => ({ ...(typeOf(it)?.defaults ?? {}), ...(it.props ?? {}) })
	const propSpec = (it, key) => typeOf(it)?.props.find((p) => p.key === key)
	/** The table and the see-through safety walls are the stage, not toys: a press on them is a camera drag, not a grab (unless already selected). */
	const isBackdrop = (it) => it.type === "table" || propsOf(it).invisible_in_3d === true

	// ---- item frame ----
	function toLocal(it, w) {
		const a = -(it.angle ?? 0) * D2R
		const dx = w.x - it.x
		const dy = w.y - it.y
		return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
	}
	function toWorldOf(it, l) {
		const a = (it.angle ?? 0) * D2R
		return { x: it.x + l.x * Math.cos(a) - l.y * Math.sin(a), y: it.y + l.x * Math.sin(a) + l.y * Math.cos(a) }
	}

	// ---- what is drawn where ----
	function shown() {
		const s = opts.getShown()
		if (!s?.doc) return null
		const at = s.layout || !s.track ? startPoses(s.doc) : placementsAt(s.track, s.t)
		return { doc: s.doc, at }
	}
	/** {id, sid}: the item (and the solid of it) drawn under this point, or null. */
	function pickAt(clientX, clientY) {
		const sh = shown()
		if (!sh) return null
		const sid = view.pick?.(clientX, clientY)
		if (!sid) return null
		const s = sh.doc.solids.find((x) => x.id === sid)
		const it = s?.item && itemById(s.item)
		if (!it || (isBackdrop(it) && it.id !== opts.getSelected())) return null
		return { id: it.id, sid }
	}

	// ---- handles: positions in the item's frame, from its values (so they follow the pointer at once) ----
	function extent(it) {
		const sh = shown()
		if (!sh) return 0.1
		let r = 0.05
		for (const s of sh.doc.solids) {
			if (s.item !== it.id) continue
			const p = sh.at[s.id]
			if (!p) continue
			const half =
				s.body.kind === "ball"
					? s.body.radius
					: s.body.kind === "polygon"
						? Math.max(...s.body.points.map((q) => Math.hypot(q.x, q.y))) // its farthest corner from its origin
						: Math.hypot(s.body.width, s.body.height) / 2
			r = Math.max(r, Math.hypot(p.x - it.x, p.y - it.y) + half)
		}
		return r
	}
	function seesawGeom(P) {
		const t = P.tilt * D2R
		const left = P.length / 2 + P.pivot_offset
		const right = P.length / 2 - P.pivot_offset
		const cy = right * Math.sin(t) + ((P.plank_thickness ?? 0.012) / 2) * Math.cos(t)
		return { t, left, right, cy, leftEnd: { x: -left * Math.cos(t), y: cy + left * Math.sin(t) }, rightEnd: { x: right * Math.cos(t), y: cy - right * Math.sin(t) } }
	}
	const rotatable = (it) => (typeOf(it)?.edit ?? []).some((e) => e.kind === "rotate")
	function handles(it) {
		const t = typeOf(it)
		if (!t) return []
		const P = propsOf(it)
		const out = []
		for (const e of t.edit ?? []) {
			if (e.kind === "length") {
				const L = P[e.prop]
				const tip = "Drag: stretch" + (rotatable(it) ? " and tilt" : "")
				out.push({ id: "end+", kind: e, l: { x: L / 2, y: 0 }, tip })
				out.push({ id: "end-", kind: e, l: { x: -L / 2, y: 0 }, tip })
			} else if (e.kind === "radius") out.push({ id: "radius", kind: e, l: { x: P[e.prop] / 2, y: 0 }, tip: "Drag: size" })
			else if (e.kind === "top") out.push({ id: "top", kind: e, l: { x: 0, y: P[e.prop] }, tip: "Drag: height" })
			else if (e.kind === "size") out.push({ id: "size", kind: e, l: { x: P[e.w] / 2, y: P[e.h] / 2 }, tip: "Drag: size" })
			else if (e.kind === "boxWidth") out.push({ id: "boxWidth", kind: e, l: { x: P[e.prop] / 2, y: (P.wall ?? P.height ?? 0.1) / 2 }, tip: "Drag: width" })
			else if (e.kind === "swing") {
				const L = P[e.length]
				const a = P[e.prop] * D2R
				out.push({ id: "swing", kind: e, l: { x: L * Math.sin(a), y: -L * Math.cos(a) }, tip: "Drag: pull it back" })
			} else if (e.kind === "tiltEnd") out.push({ id: "tiltEnd", kind: e, l: seesawGeom(P).leftEnd, tip: "Drag: tilt" })
			else if (e.kind === "armEnd") out.push({ id: "armEnd", kind: e, l: seesawGeom(P).rightEnd, tip: "Drag: length" })
			else if (e.kind === "rotate") out.push({ id: "rotate", kind: e, l: { x: 0, y: extent(it) + 0.06 }, tip: "Drag: turn (Shift: 15° steps)", rotate: true })
		}
		for (const h of out) h.owner = it.id
		return out
	}
	/** Where a handle's dot is drawn and grabbed (container px). A radius dot sits just outside the ball and a radius or swing dot is never
	 *  nearer the centre than MIN_DOT_PX, so on a small item the dot never covers the thing you want to pick up. `inner` = the true distance. */
	function dotAt(it, h) {
		const w = toWorldOf(it, h.l)
		const p = view.toScreen?.(w.x, w.y)
		if (!p) return null
		if (h.id !== "radius" && h.id !== "swing") return p
		const c = view.toScreen?.(it.x, it.y)
		if (!c) return p
		const d = Math.hypot(p.x - c.x, p.y - c.y)
		const want = Math.max(MIN_DOT_PX, h.id === "radius" ? d + 9 : d)
		if (d < 1e-6) return { x: c.x + want, y: c.y, inner: 0 }
		return { x: c.x + ((p.x - c.x) * want) / d, y: c.y + ((p.y - c.y) * want) / d, inner: d }
	}
	function handleAt(clientX, clientY) {
		const id = opts.getSelected()
		const it = id && itemById(id)
		if (!it) return null
		const r = container.getBoundingClientRect()
		const px = clientX - r.left
		const py = clientY - r.top
		for (const h of handles(it)) {
			const p = dotAt(it, h)
			if (p && Math.hypot(px - p.x, py - p.y) <= HANDLE_PX + 4) return h
		}
		return null
	}

	// ---- what a drag sets ----
	function clampProp(it, key, v, snap) {
		const spec = propSpec(it, key)
		const step = snap ? (spec?.unit === "°" ? 1 : 0.01) : spec?.step ?? 0.001
		v = Math.round(v / step) * step
		if (spec?.min !== undefined && spec?.min !== null) v = Math.max(spec.min, v)
		if (spec?.max !== undefined && spec?.max !== null) v = Math.min(spec.max, v)
		return Number(v.toFixed(6))
	}
	const snapPos = (v, snap) => Number((Math.round(v / (snap ? 0.01 : 0.001)) * (snap ? 0.01 : 0.001)).toFixed(6))
	function setProp(it, key, v, snap) {
		it.props = { ...(it.props ?? {}) }
		it.props[key] = clampProp(it, key, v, snap)
	}
	function apply(d, w, snap) {
		const sc = clone(d.scene0)
		const it = sc.items.find((i) => i.id === d.id)
		const it0 = d.scene0.items.find((i) => i.id === d.id)
		const P0 = { ...(typeOf(it0).defaults ?? {}), ...(it0.props ?? {}) }
		if (!d.handle) {
			it.x = snapPos(it0.x + w.x - d.w0.x, snap)
			it.y = snapPos(it0.y + w.y - d.w0.y, snap)
			return sc
		}
		const h = d.handle
		const e = h.kind
		const l = toLocal(it0, w)
		if (e.kind === "length") {
			const L0 = P0[e.prop]
			if (!rotatable(it0)) {
				setProp(it, e.prop, 2 * Math.abs(l.x), snap)
				return sc
			}
			const sign = h.id === "end+" ? 1 : -1
			const other = toWorldOf(it0, { x: -sign * L0 / 2, y: 0 }) // the end that stays put
			const v = { x: sign * (w.x - other.x), y: sign * (w.y - other.y) }
			let ang = Math.atan2(v.y, v.x) / D2R
			if (snap) ang = Math.round(ang)
			setProp(it, e.prop, Math.hypot(v.x, v.y), false)
			const L = it.props[e.prop]
			it.angle = Number(ang.toFixed(3))
			const u = { x: Math.cos(ang * D2R), y: Math.sin(ang * D2R) }
			it.x = Number((other.x + sign * u.x * L / 2).toFixed(6))
			it.y = Number((other.y + sign * u.y * L / 2).toFixed(6))
		} else if (e.kind === "radius") {
			// the dot is grabbed a little outside the ball's edge: keep that gap, so the dot stays under the pointer and the size doesn't jump
			const g = toLocal(it0, d.w0)
			const gap = Math.hypot(g.x, g.y) - P0[e.prop] / 2
			setProp(it, e.prop, 2 * (Math.hypot(l.x, l.y) - gap), snap)
		} else if (e.kind === "top") setProp(it, e.prop, l.y, snap)
		else if (e.kind === "size") { setProp(it, e.w, 2 * Math.abs(l.x), snap); setProp(it, e.h, 2 * Math.abs(l.y), snap) }
		else if (e.kind === "boxWidth") setProp(it, e.prop, 2 * Math.abs(l.x), snap)
		else if (e.kind === "swing") setProp(it, e.prop, Math.atan2(l.x, -l.y) / D2R, snap)
		else if (e.kind === "tiltEnd") { const g = seesawGeom(P0); setProp(it, e.prop, Math.atan2(l.y - g.cy, -l.x) / D2R, snap) }
		else if (e.kind === "armEnd") { const g = seesawGeom(P0); setProp(it, e.prop, 2 * (Math.hypot(l.x, l.y - g.cy) + P0.pivot_offset), snap) }
		else if (e.kind === "rotate") {
			let ang = Math.atan2(w.y - it0.y, w.x - it0.x) / D2R - 90
			ang = ((ang + 540) % 360) - 180
			ang = snap ? Math.round(ang / 15) * 15 : Math.round(ang * 10) / 10
			it.angle = ang
		}
		return sc
	}
	function readout(d, sc) {
		const it = sc.items.find((i) => i.id === d.id)
		const P = propsOf(it)
		const m = (v) => `${v.toFixed(3)} m`
		if (!d.handle) return `x ${m(it.x)}   y ${m(it.y)}`
		const e = d.handle.kind
		if (e.kind === "length") return rotatable(it) ? `length ${m(P[e.prop])}   angle ${(it.angle ?? 0).toFixed(1)}°` : `${propSpec(it, e.prop)?.label?.toLowerCase() ?? e.prop} ${m(P[e.prop])}`
		if (e.kind === "rotate") return `angle ${(it.angle ?? 0).toFixed(1)}°`
		if (e.kind === "size") return `${m(P[e.w])} × ${m(P[e.h])}`
		const key = e.prop
		const spec = propSpec(it, key)
		return `${spec?.label ?? key} ${Number(P[key]).toFixed(spec?.unit === "°" ? 1 : 3)} ${spec?.unit ?? ""}`
	}

	// ---- pointer ----
	const local = (e) => { const r = container.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
	function setHover(id, h) {
		hover = id
		hoverHandle = h
		container.style.cursor = h ? "crosshair" : id ? "grab" : ""
	}
	function hoverAt(clientX, clientY) {
		const h = handleAt(clientX, clientY)
		const id = h ? opts.getSelected() : pickAt(clientX, clientY)?.id ?? null
		if (id !== hover || (h?.id ?? null) !== (hoverHandle?.id ?? null)) setHover(id, h)
	}
	function onDown(e) {
		if (e.button !== 0) return
		const h = handleAt(e.clientX, e.clientY)
		const pk = h ? null : pickAt(e.clientX, e.clientY)
		const id = h ? opts.getSelected() : pk?.id
		if (!id) {
			// a click (not an orbit drag) on empty space deselects: decided on release
			if (opts.getSelected()) drag = { pending: true, x: e.clientX, y: e.clientY }
			return
		}
		const w = view.toWorld?.(e.clientX, e.clientY)
		if (!w) return
		e.preventDefault()
		e.stopPropagation()
		e.stopImmediatePropagation()
		try { container.setPointerCapture(e.pointerId) } catch {}
		if (opts.getSelected() !== id) opts.onSelect(id)
		// Grabbing a part partway through a run: the drag works on where it STARTS, so shift the grab point by how far the part has
		// travelled and its start position lands under the pointer instead of far from it.
		let w0 = w
		const s = opts.getShown()
		if (pk && s?.doc && s.track && !s.layout && s.t > 0) {
			const now = placementsAt(s.track, s.t)[pk.sid]
			const start = startPoses(s.doc)[pk.sid]
			if (now && start) w0 = { x: w.x - (now.x - start.x), y: w.y - (now.y - start.y) }
		}
		drag = { id, handle: h, scene0: clone(scene()), wDown: w, w0, moved: false, pointerId: e.pointerId }
		draw()
	}
	function onMove(e) {
		pointer = local(e)
		lastClient = { x: e.clientX, y: e.clientY }
		if (drag?.pending) return
		if (drag) {
			const w = view.toWorld?.(e.clientX, e.clientY)
			if (!w) return
			const ppm = view.pxPerMeter?.(w.x, w.y) ?? 400
			if (!drag.moved && Math.hypot(w.x - drag.wDown.x, w.y - drag.wDown.y) * ppm < 3) return
			if (!drag.moved) {
				drag.moved = true
				opts.onStart()
				view.setEditing?.(true)
				container.classList.add("editing")
			}
			drag.scene = apply(drag, w, e.shiftKey)
			opts.onChange(drag.scene)
			draw()
			return
		}
		hoverAt(e.clientX, e.clientY)
		draw()
	}
	function onUp(e) {
		if (!drag) return
		if (e.type === "pointercancel") { cancel(); return } // the browser took the gesture (a scroll, a call): nothing is committed
		const d = drag
		drag = null
		if (d.pending) {
			if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) opts.onSelect(null)
			return
		}
		container.classList.remove("editing")
		try { container.releasePointerCapture(d.pointerId) } catch {}
		view.setEditing?.(false)
		if (d.moved && d.scene) opts.onCommit(d.scene)
		draw()
	}
	/** Abandon the drag in progress: the scene goes back to how it was when the item was picked up. */
	function cancel() {
		const d = drag
		if (!d) return false
		drag = null
		if (d.pending) return false
		container.classList.remove("editing")
		try { container.releasePointerCapture(d.pointerId) } catch {}
		view.setEditing?.(false)
		if (d.moved) opts.onCancel?.(d.scene0)
		draw()
		return true
	}
	function onLeave() {
		if (drag) return
		pointer = null
		lastClient = null
		setHover(null, null)
		draw()
	}
	container.addEventListener("pointerdown", onDown, true)
	container.addEventListener("pointermove", onMove, true)
	container.addEventListener("pointerup", onUp, true)
	container.addEventListener("pointercancel", onUp, true)
	container.addEventListener("pointerleave", onLeave)

	/** Moves the selected item by (dx, dy) m (arrow keys). A run of presses is one change: it is committed 300 ms after the last. */
	function nudge(dx, dy) {
		if (drag) return false
		const id = opts.getSelected()
		const it = id && itemById(id)
		if (!it) return false
		const sc = clone(scene())
		const i = sc.items.find((x) => x.id === id)
		i.x = Number((i.x + dx).toFixed(6))
		i.y = Number((i.y + dy).toFixed(6))
		opts.onStart()
		opts.onChange(sc)
		clearTimeout(nudgeTimer)
		nudgeTimer = setTimeout(flush, 300)
		return true
	}
	/** Commit a pending run of nudges now. */
	function flush() {
		if (!nudgeTimer) return
		clearTimeout(nudgeTimer)
		nudgeTimer = 0
		opts.onCommit(scene())
	}
	/** Hover again from the last pointer position (after the picture or the scene changed under a resting pointer). */
	function refresh() {
		if (drag || !lastClient) return
		hoverAt(lastClient.x, lastClient.y)
		draw()
	}

	// ---- drawing ----
	function outline(id, color, width, sh) {
		ctx.strokeStyle = color
		ctx.lineWidth = width
		for (const s of sh.doc.solids) {
			if (s.item !== id) continue
			const p = sh.at[s.id]
			if (!p) continue
			ctx.beginPath()
			if (s.body.kind === "ball") {
				const c = view.toScreen(p.x, p.y)
				if (!c) continue
				ctx.arc(c.x, c.y, s.body.radius * (view.pxPerMeter?.(p.x, p.y) ?? 400) + 2, 0, 2 * Math.PI)
			} else {
				const hw = s.body.width / 2
				const hh = s.body.height / 2
				const ca = Math.cos(p.angle)
				const sa = Math.sin(p.angle)
				const corners = s.body.kind === "polygon" ? s.body.points.map((q) => [q.x, q.y]) : [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
				const pts = corners.map(([x, y]) => view.toScreen(p.x + x * ca - y * sa, p.y + x * sa + y * ca))
				if (pts.some((q) => !q)) continue
				pts.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
				ctx.closePath()
			}
			ctx.stroke()
		}
	}
	function label(text, x, y, strong) {
		ctx.font = `${strong ? 600 : 500} 12px ui-sans-serif, -apple-system, system-ui, sans-serif`
		const w = ctx.measureText(text).width + 14
		const bx = Math.min(Math.max(4, x), overlay.clientWidth - w - 4)
		const by = Math.min(Math.max(4, y), overlay.clientHeight - 26)
		ctx.fillStyle = "rgba(20, 24, 33, 0.88)"
		ctx.beginPath()
		ctx.roundRect(bx, by, w, 22, 6)
		ctx.fill()
		ctx.fillStyle = "#fff"
		ctx.fillText(text, bx + 7, by + 15)
	}
	function nameOf(id) {
		const it = itemById(id)
		return it ? it.name || typeOf(it)?.name || it.type : id
	}
	function draw() {
		const w = container.clientWidth
		const h = container.clientHeight
		const dpr = window.devicePixelRatio || 1
		if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
			overlay.width = Math.round(w * dpr)
			overlay.height = Math.round(h * dpr)
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		ctx.clearRect(0, 0, w, h)
		const sel = opts.getSelected()
		// a hover that outlived its item, or a handle that belonged to another selection, is dropped (the next pointer move redoes it)
		if (!drag && ((hover && !itemById(hover)) || (hoverHandle && hoverHandle.owner !== sel))) setHover(null, null)
		if (!w || !h || !view.toScreen) return
		const sh = shown()
		if (!sh) return
		if (hover && hover !== sel && !drag) outline(hover, "rgba(37, 87, 214, 0.55)", 1.5, sh)
		const it = sel && itemById(sel)
		if (it) {
			outline(sel, "#2557d6", 2, sh)
			const cur = drag?.scene ? drag.scene.items.find((i) => i.id === sel) : it
			for (const hd of handles(cur)) {
				const p = dotAt(cur, hd)
				if (!p) continue
				const active = (drag?.handle?.id ?? hoverHandle?.id) === hd.id
				if (hd.rotate) {
					const c = view.toScreen(cur.x, cur.y)
					if (c) {
						ctx.strokeStyle = "rgba(37, 87, 214, 0.5)"
						ctx.lineWidth = 1.5
						ctx.setLineDash([4, 3])
						ctx.beginPath()
						ctx.moveTo(c.x, c.y)
						ctx.lineTo(p.x, p.y)
						ctx.stroke()
						ctx.setLineDash([])
					}
				}
				ctx.beginPath()
				ctx.arc(p.x, p.y, HANDLE_PX, 0, 2 * Math.PI)
				ctx.fillStyle = active ? "#2557d6" : "#fff"
				ctx.fill()
				ctx.lineWidth = 2
				ctx.strokeStyle = "#2557d6"
				ctx.stroke()
				if (hd.rotate) {
					ctx.strokeStyle = active ? "#fff" : "#2557d6"
					ctx.lineWidth = 1.6
					ctx.beginPath()
					ctx.arc(p.x, p.y, 3.4, -0.3, Math.PI * 1.3)
					ctx.stroke()
				}
			}
		}
		if (!pointer) return
		if (drag?.moved && drag.scene) label(readout(drag, drag.scene), pointer.x + 14, pointer.y + 12, true)
		else if (hoverHandle) label(hoverHandle.tip, pointer.x + 14, pointer.y + 12)
		else if (hover && hover !== sel) label(`${nameOf(hover)}: click to select, drag to move`, pointer.x + 14, pointer.y + 12)
		else if (hover && hover === sel) label(`${nameOf(sel)}: drag to move · dots resize or turn · ⌫ deletes`, pointer.x + 14, pointer.y + 12)
	}

	return {
		draw,
		nudge,
		flush,
		cancel,
		refresh,
		get dragging() { return !!drag && !drag.pending },
		dispose() {
			clearTimeout(nudgeTimer)
			container.removeEventListener("pointerdown", onDown, true)
			container.removeEventListener("pointermove", onMove, true)
			container.removeEventListener("pointerup", onUp, true)
			container.removeEventListener("pointercancel", onUp, true)
			container.removeEventListener("pointerleave", onLeave)
			overlay.remove()
		},
	}
}
