// Pictures of a solved scene for the AI's critique, without touching the view the user is looking at.
//   import { createShot } from "./ai/shot.js"
//   const shot = createShot({ looks: () => catalog.looks })
//   const pics = await shot.render(sim, { scene })   // [{label: "start" | "end" | "items close-up" | "close-up", t, dataUrl (JPEG), width, height}]
//   shot.prewarm()                                    // make the hidden view ahead of time (idle time during a build), so the first picture is quicker
//   shot.dispose()
// A second 3D view (web/view3d.js, the same renderer and models as the user's) lives in a hidden 1024×576 box off screen: it is loaded with the run,
// forced to the high quality tier, built in full (not progressively: this module is not app.js, so the view builds every model before load()
// returns), drawn at the moments wanted with the Wide camera, and read back at once (the drawing buffer is still intact in the same task).
// What would be cleaner (view3d.js is not changed here): a view.snapshot({width, height, t, camera, region}) that draws into an off-screen render
// target of the view on screen, so no second WebGL context and no second build of the models would be needed.
export const SHOT_W = 1024
export const SHOT_H = 576
const IDLE_DISPOSE_MS = 120000

export function createShot({ looks = () => null, width = SHOT_W, height = SHOT_H, quality = 0.85 } = {}) {
	let host = null
	let view = null
	let viewP = null
	let idleTimer = 0
	let busy = Promise.resolve()

	async function ensure() {
		if (view) return view
		viewP ??= (async () => {
			const { createView3D } = await import("../view3d.js")
			host = document.createElement("div")
			host.setAttribute("aria-hidden", "true")
			host.dataset.aiShot = ""
			// off screen but laid out (the view needs a real size), never in the way of the pointer or of assistive tech
			host.style.cssText = `position:fixed;left:-${width * 4}px;top:0;width:${width}px;height:${height}px;pointer-events:none;opacity:0;z-index:-1;contain:strict`
			document.body.append(host)
			const v = createView3D(host)
			v.setOptions({ looks: looks() ?? undefined, camera: "wide", reflections: true })
			v.setQuality?.("high")
			view = v
			return v
		})()
		try {
			return await viewP
		} catch (e) {
			viewP = null
			throw e
		}
	}

	/** Copy the view's canvas (drawn just now) into a width × height JPEG, optionally only a region of it (container px). */
	function grab(region = null) {
		const src = host.querySelector("canvas")
		if (!src || !src.width) throw new Error("the 3D view has no picture")
		const c = document.createElement("canvas")
		c.width = width
		c.height = height
		const g = c.getContext("2d")
		g.imageSmoothingQuality = "high"
		const kx = src.width / width
		const ky = src.height / height
		if (region) g.drawImage(src, region.x * kx, region.y * ky, region.w * kx, region.h * ky, 0, 0, width, height)
		else g.drawImage(src, 0, 0, width, height)
		return c.toDataURL("image/jpeg", quality)
	}

	/** The container-px box around these world boxes, padded and widened to the picture's aspect, inside the picture; null if it can't be seen. */
	function regionOf(boxes, pad = 0.12) {
		let x0 = Infinity
		let y0 = Infinity
		let x1 = -Infinity
		let y1 = -Infinity
		for (const b of boxes)
			for (const [x, y] of [[b.x0 - pad, b.y0 - pad], [b.x1 + pad, b.y0 - pad], [b.x1 + pad, b.y1 + pad], [b.x0 - pad, b.y1 + pad]]) {
				const p = view.toScreen?.(x, y)
				if (!p) return null
				x0 = Math.min(x0, p.x)
				x1 = Math.max(x1, p.x)
				y0 = Math.min(y0, p.y)
				y1 = Math.max(y1, p.y)
			}
		let w = x1 - x0
		let h = y1 - y0
		if (!(w > 4 && h > 4)) return null
		const aspect = width / height
		if (w / h < aspect) w = h * aspect
		else h = w / aspect
		w = Math.min(width, Math.max(w, width * 0.25))
		h = w / aspect
		const cx = (x0 + x1) / 2
		const cy = (y0 + y1) / 2
		const x = Math.min(width - w, Math.max(0, cx - w / 2))
		const y = Math.min(height - h, Math.max(0, cy - h / 2))
		return w >= width * 0.95 ? null : { x, y, w, h }
	}

	/**
	 * sim = a run (/api/simulate's answer: doc, track, resolved, summary). opts: {scene (for a close-up of the goal), times: [{label, t}], signal}
	 * Default moments: the start, the end, a close-up of the whole machine at the start (cropped to all its items with a margin, when they are
	 * small on the long table), and a close-up of the first goal's container at the end (when it is small in the wide shot).
	 */
	function render(sim, opts = {}) {
		const job = busy.then(() => renderNow(sim, opts))
		busy = job.catch(() => {})
		return job
	}
	async function renderNow(sim, { scene = null, times = null, signal = null } = {}) {
		clearTimeout(idleTimer)
		const v = await ensure()
		if (signal?.aborted) throw new DOMException("Cancelled", "AbortError")
		const T = sim.doc?.seconds ?? 4.5
		const moments = times ?? [{ label: "start", t: 0 }, { label: "end", t: T }]
		v.setOptions({ looks: looks() ?? undefined, camera: "wide" })
		v.setQuality?.("high")
		v.load(sim, null, { keepCamera: false, progressive: false, rebuild: true })
		await v._debug?.settled?.()
		const out = []
		for (const m of moments) {
			if (signal?.aborted) throw new DOMException("Cancelled", "AbortError")
			v.render(Math.min(T, Math.max(0, m.t)))
			out.push({ label: m.label, t: m.t, width, height, dataUrl: grab() })
			await new Promise((r) => setTimeout(r, 0)) // (let the page breathe between pictures)
		}
		// the machine itself at the start, cropped to all its items (a small machine on a 3.7 m table is a few hundred pixels wide otherwise)
		if (!times && sim.track?.frames?.length) {
			const real = new Set((scene?.items ?? []).filter((i) => i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d)).map((i) => i.id))
			const first = sim.track.frames[0].placements
			const boxes = sim.doc.solids
				.filter((s) => (real.size ? real.has(s.item) : s.item !== "table" && !s.hidden_3d))
				.map((s) => {
					const p = first[s.id]
					const r = s.body?.kind === "ball" ? s.body.radius : Math.max(s.body?.width ?? 0.05, s.body?.height ?? 0.05) / 2
					return p && Number.isFinite(r) ? { x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r } : null
				})
				.filter(Boolean)
			if (boxes.length) {
				const ex = Math.max(...boxes.map((b) => b.x1)) - Math.min(...boxes.map((b) => b.x0))
				v.render(0)
				const region = regionOf(boxes, Math.max(0.04, ex * 0.1))
				if (region) out.push({ label: "items close-up", t: 0, width, height, dataUrl: grab(region) })
			}
		}
		// a close-up of the first goal's container and its item at the end, when they are small in the wide picture
		const g = scene?.goals?.[0]
		if (!times && g && sim.track?.frames?.length) {
			const solids = sim.doc.solids.filter((s) => s.item === g.container || s.item === g.item)
			const last = sim.track.frames.at(-1).placements
			const first = sim.track.frames[0].placements
			const boxes = solids.map((s) => {
				const p = last[s.id] ?? first[s.id]
				const r = s.body.kind === "ball" ? s.body.radius : Math.max(s.body.width ?? 0.05, s.body.height ?? 0.05) / 2
				return p ? { x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r } : null
			}).filter(Boolean)
			v.render(T)
			const region = boxes.length ? regionOf(boxes) : null
			if (region) out.push({ label: "close-up", t: T, width, height, dataUrl: grab(region) })
		}
		idleTimer = setTimeout(dispose, IDLE_DISPOSE_MS)
		return out
	}

	function dispose() {
		clearTimeout(idleTimer)
		try {
			view?.dispose()
		} catch {}
		host?.remove()
		view = null
		viewP = null
		host = null
	}

	/** Make the hidden view now (in idle time), so the first critique picture doesn't stall the page. */
	function prewarm() {
		if (view || viewP) return
		clearTimeout(idleTimer)
		ensure()
			.then(() => (idleTimer = setTimeout(dispose, IDLE_DISPOSE_MS)))
			.catch(() => {})
	}

	return { render, dispose, prewarm, get ready() { return !!view } }
}
