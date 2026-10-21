// What holds a held thing until the release, besides the real look's pull pin on its post, and what holds a fixed part up in the lesson look
// (web/view3d.js uses these; doc.view.release_stand, machines/mod_staging.py settings.release_stand; web/lesson-look.js):
//   "post"     the pull pin on its post behind the machine (the real look's default; drawn by web/view3d.js): the pin slides out, the post stays.
//   "hidden"   the same pin and post until the release; then the pin slides out as ever and the pin and post fade out in 0.12 s, drawing
//              back 6 cm (RETREAT; short, so a slow-motion clip of the release shows no holder wandering off): nothing is left standing where
//              the thing was let go (retreatAt).
//   "hanger"   a holder from ABOVE (makeHanger): a slim rod coming down just behind the thing (behind whatever is over it too: a magnet over a
//              clip), an arm reaching forward over it, ending in a rubber pad pressing on its top (a floater held under water: the run shows it
//              rising once let go) or in two jaws round its top half (anything else: an apple over the water, a grape in it, a ball held up). At
//              the release the jaws open (24 degrees in 0.05 s) and the holder draws back off the thing along the depth (0.04 s), then lifts
//              straight up at 12 m/s², never lower than the thing's own top while it was over it (a cork that rises at once pushes nothing: the
//              pad goes up ahead of it); it is gone once it is 2 m up. A thing that snaps up or flies off passes in front of it.
//   "auto"     the lesson look's choice (standModeFor): a hanger where the thing is in or over a liquid (a post would stand in the water, and under a
//              floater a pin reads as a peg it rests on) or held up in mid-air (a post behind a falling thing looks like a stick it slides down),
//              else hidden (a thing that rests on something: a car at the top of a ramp).
// mountHanger: the lesson look's support for a static part held in mid-air (a fixed magnet, a pendulum's bar), in place of a retort stand or a
// wall bracket: a slim rod from 3 m up down to a small collar on the part's top.
// Render only: the engine holds a held thing exactly still until the release and lets it go from rest; none of this touches a body.
import * as THREE from "three"
import { placementAt } from "./view-plugins.js"

export const RETREAT = { delay: 0.06, seconds: 0.12, back: 0.06 } // after the pin is out (the view slides it out in 0.07 s from release - 0.01 s)
export const HANGER = { rod: 0.0025, openS: 0.05, openDeg: 24, accel: 12, gone: 2, length: 3, backS: 0.04, behind: 0.015 }

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const smooth = (u) => u * u * (3 - 2 * u)

/** The highest point of solid s at pose q ({x, y, angle}) and its half-width there: {top, hw}. */
export function topOf(s, q) {
	const b = s.body
	const a = q.angle ?? 0
	if (b.kind === "ball") return { top: q.y + b.radius, hw: b.radius, x: q.x }
	const c = Math.cos(a)
	const sn = Math.sin(a)
	const pts = b.kind === "polygon" ? b.points : [{ x: -b.width / 2, y: -b.height / 2 }, { x: b.width / 2, y: -b.height / 2 }, { x: b.width / 2, y: b.height / 2 }, { x: -b.width / 2, y: b.height / 2 }]
	let top = -Infinity
	let x0 = Infinity
	let x1 = -Infinity
	let tx = q.x
	for (const p of pts) {
		const wx = q.x + p.x * c - p.y * sn
		const wy = q.y + p.x * sn + p.y * c
		if (wy > top) {
			top = wy
			tx = wx
		}
		x0 = Math.min(x0, wx)
		x1 = Math.max(x1, wx)
	}
	// (a slab lying level, or tilted less than 6 degrees: its top is a face, held at its middle)
	if (Math.abs(sn) < 0.1 || b.kind === "polygon") tx = (x0 + x1) / 2
	return { top, hw: (x1 - x0) / 2, x: tx }
}

/** Is the point (x, y) in a liquid's container or over it (within 15 cm above its rim)? doc.processes "liquid" (the liquids module's tanks
 *  and vessels: x0, x1, floor, rim) and the pouring module's catching vessels (flow-vessel / flow-basin records with the same box). */
export function overLiquid(doc, x, y) {
	for (const p of doc?.processes ?? []) {
		if (!p || (p.kind !== "liquid" && p.kind !== "flow-vessel" && p.kind !== "flow-basin")) continue
		if (!Number.isFinite(p.x0) || !Number.isFinite(p.x1)) continue
		const rim = Number.isFinite(p.rim) ? p.rim : null
		if (x > p.x0 && x < p.x1 && (rim === null || y < rim + 0.15)) return true
	}
	return false
}

/** Would solid s float in the liquid it is held in or over (its density, a hollow ball's over its whole volume, under the liquid's; a part over no
 *  liquid: no)? For a run that ends before its release, when the track cannot say. */
export function floats(doc, s, q) {
	const rho = doc?.materials?.[s.material]?.density
	if (!Number.isFinite(rho)) return false
	const b = s.body
	let eff = rho
	if (b.kind === "ball" && Number.isFinite(b.wall) && b.wall > 0 && b.wall < b.radius) eff = rho * (1 - ((b.radius - b.wall) / b.radius) ** 3)
	for (const p of doc?.processes ?? []) {
		if (p?.kind !== "liquid" || !(q.x > p.x0 && q.x < p.x1)) continue
		const liq = p.layers?.[0]?.density
		return Number.isFinite(liq) && eff < liq
	}
	return false
}

/** What holds a held item: "post" | "hidden" | "hanger" (want: the style's release stand, "auto" resolved here for the item's held part s at pose
 *  q: a holder from above in or over a liquid, or for a thing held up in mid-air (airborne: more than 1 cm over whatever is under it) with room
 *  over it (roomAbove: no static thing within 5 cm over it, as a magnet just over a clip), else the pin and post that go (a thing that rests on
 *  something, a car at the top of a ramp, is held from behind; so is one with a magnet just over it). Decided per scene: a lesson whose screens
 *  differ in what is over the thing names one release stand for all of them. */
export function standModeFor(want, doc, s, q, { airborne = false, roomAbove = true } = {}) {
	if (want === "post" || want === "hidden" || want === "hanger") return want
	return overLiquid(doc, q.x, q.y) || (airborne && roomAbove) ? "hanger" : "hidden"
}

/** The lesson look's pin and post: slim and plain (a 10 mm grey rod, a 6 mm pin; the real look's are 24 mm and 8 mm wooden dowels), so the
 *  holder does not outweigh what it holds (a 1 mm paper clip). postR, pinR: the view's dowels' radii. */
export const LESSON_POST = { post: 0.005, pin: 0.003 }
export function lessonPost(pin, post, postR, pinR) {
	const M = hangerMats()
	post.scale.x = post.scale.z = LESSON_POST.post / postR
	pin.scale.x = pin.scale.z = LESSON_POST.pin / pinR
	post.material = M.rod
	pin.material = M.jaw
}

/** The pin and post of a held item going away after the release ("hidden"): their materials are copies this makes of what they wear (the
 *  view's shared ones are never changed), drawn opaque until the retreat starts. e = {pin, post, blob, mats}; call retreatAt after the view
 *  has slid the pin out for moment t. */
export function makeRetreat(pin, post, blob) {
	const copy = (m) => {
		const c = m.clone()
		c.onBeforeCompile = m.onBeforeCompile // (clone() drops the view's grading hook: kept, so the post looks as every other post does)
		c.customProgramCacheKey = m.customProgramCacheKey
		return c
	}
	const mats = [copy(pin.material), copy(post.material)]
	pin.material = mats[0]
	post.material = mats[1]
	return { pin, post, blob, mats, blobOpacity: blob?.material?.opacity ?? 0, k: 0 }
}
export function retreatAt(e, t, tRelease) {
	const u = clamp((t - tRelease - RETREAT.delay) / RETREAT.seconds, 0, 1)
	const k = smooth(u)
	const gone = u >= 1
	e.post.visible = e.pin.visible = !gone
	if (e.blob) {
		e.blob.visible = !gone && e.blobOpacity > 0.01
		e.blob.material.opacity = e.blobOpacity * (1 - k)
	}
	const z0 = e.post.userData.z0 ?? e.post.position.z
	e.post.position.z = z0 - RETREAT.back * k
	e.post.updateMatrix()
	e.pin.position.z -= RETREAT.back * k
	if (k !== e.k) {
		for (const m of e.mats) {
			const tr = k > 0
			if (m.transparent !== tr) {
				m.transparent = tr
				m.needsUpdate = true
			}
			m.opacity = 1 - k
		}
		e.k = k
	}
	return gone
}
/** The blob's opacity as the view set it (it is placed again when posts are fitted). */
export const retreatRefit = (e) => {
	if (e.blob) e.blobOpacity = e.blob.material.opacity
}

let mats = null
function hangerMats() {
	mats ??= {
		rod: new THREE.MeshStandardMaterial({ color: new THREE.Color("#7e848c"), roughness: 0.45, metalness: 0.35 }),
		pad: new THREE.MeshStandardMaterial({ color: new THREE.Color("#2b2d31"), roughness: 0.85, metalness: 0 }),
		jaw: new THREE.MeshStandardMaterial({ color: new THREE.Color("#5d636b"), roughness: 0.4, metalness: 0.4 }),
	}
	return mats
}
const unitRod = new THREE.CylinderGeometry(1, 1, 1, 20, 1)
const unitBox = new THREE.BoxGeometry(1, 1, 1)

/** A holder from above for one held item (list: its held solids, in the doc). addMesh(group, geo, mat, {castShadow}) as the view's. */
export function makeHanger({ list, addMesh, doc = null }) {
	const M = hangerMats()
	const root = new THREE.Group()
	root.name = `hanger-${list[0].item}`
	root.userData.stand = true
	const rod = addMesh(root, unitRod, M.rod, { castShadow: false }) // (a 3 m rod's shadow would cross the whole picture)
	const arm = addMesh(root, unitBox, M.rod, { castShadow: false }) // (from the rod, behind the machine, forward to the holder over the thing)
	const pad = addMesh(root, unitRod, M.pad)
	const yoke = addMesh(root, unitBox, M.jaw)
	const jawL = new THREE.Group()
	const jawR = new THREE.Group()
	root.add(jawL, jawR)
	const jl = addMesh(jawL, unitBox, M.jaw)
	const jr = addMesh(jawR, unitBox, M.jaw)
	const meshes = [rod, arm, pad, yoke, jl, jr]
	for (const m of meshes) m.userData.stand = true
	const st = { part: list[0], x: 0, tip: 0, hw: 0.01, pad: false, track: null, tRelease: 0.5, gap: 0, zr: 0, back: 0, rise: null }
	return {
		root,
		meshes,
		/** Where it holds the item standing at its start poses pf, and how (a pad on a floater, the run says, else jaws). above: how deep (m, half
		 *  its depth) the deepest static thing over the item is (a magnet just over a clip): the rod comes down behind it, and an arm reaches forward. */
		layout(pf, track, tRelease, above = 0) {
			let best = null
			for (const o of list) {
				const T = topOf(o, pf(o))
				if (!best || T.top > best.T.top) best = { o, T }
			}
			const { o, T } = best
			st.part = o
			st.x = T.x
			st.tip = T.top
			st.track = track
			st.tRelease = tRelease
			const q0 = pf(o)
			// a floater (it rises once let go): a pad pressing on its top; anything else: jaws round its top half. The run says which when it goes on past
			// the release; else (a still of it held, a layout) its density against the liquid's does
			let rise = null
			const fr = track?.frames ?? []
			if (fr.length > 1 && fr[fr.length - 1].t > tRelease + 0.05) {
				const q1 = placementAt(track, o.id, Math.min(tRelease + 0.25, fr[fr.length - 1].t))
				if (q1) rise = q1.y - q0.y
			}
			// (a pad, a suction cup, also on a thing too flat or too wide for jaws: under 6 mm high, over 5 cm wide; a ball always gets jaws)
			const flat = o.body.kind !== "ball" && (T.top - (q0.y - (T.top - q0.y)) < 0.006 || 2 * T.hw > 0.05)
			st.pad = (rise !== null ? rise > 0.003 : floats(doc, o, q0)) || flat
			const r = o.body.kind === "ball" ? o.body.radius : null
			const jaw = r !== null ? Math.min(r, 0.04) : clamp(T.hw, 0.004, 0.04) // how far down the jaws reach
			const reach = r !== null ? Math.sqrt(Math.max(0, r * r - (r - jaw) * (r - jaw))) : T.hw // the thing's half-width where the jaws end
			st.hw = Math.max(0.004, reach)
			st.gap = st.pad ? 0 : 0.002
			const padR = clamp(0.6 * T.hw, 0.003, 0.012)
			const padH = 0.004
			pad.visible = st.pad
			pad.scale.set(padR, padH, padR)
			pad.position.set(0, padH / 2, 0)
			const w = 0.003 // a jaw's thickness
			const d = 0.007 // its depth (front to back)
			const yokeH = 0.004
			yoke.visible = jl.visible = jr.visible = !st.pad
			yoke.scale.set(2 * (st.hw + 0.002 + w), yokeH, d)
			yoke.position.set(0, st.gap + yokeH / 2, 0)
			for (const [g, m, sx] of [[jawL, jl, -1], [jawR, jr, 1]]) {
				g.position.set(sx * (st.hw + 0.002 + w / 2), st.gap, 0)
				m.scale.set(w, jaw + st.gap, d)
				m.position.set(0, -(jaw + st.gap) / 2, 0)
			}
			const base = st.pad ? padH : st.gap + yokeH
			// the rod stands behind the thing (and behind whatever is over it), an arm reaching forward over the thing to the holder: the holder can
			// draw back off the thing along the depth at the release, out of the way of a thing that rises or flies off, before it lifts
			let half = 0
			for (const q of list) half = Math.max(half, (q.body.kind === "ball" ? (q.depth3d ?? 2 * q.body.radius) : (q.body.depth ?? 0.1)) / 2)
			st.back = half + (st.pad ? padR : d / 2) + 0.004 // (how far it draws back: clear of the thing's own depth)
			st.zr = -(Math.max(half, above) + HANGER.behind)
			const armH = 0.004
			arm.scale.set(HANGER.rod * 2, armH, -st.zr + HANGER.rod)
			arm.position.set(0, base + armH / 2, st.zr / 2)
			rod.scale.set(HANGER.rod, HANGER.length, HANGER.rod)
			rod.position.set(0, base + HANGER.length / 2, st.zr)
			// how much higher than its lift the holder must be at each moment so it is never below the thing's top while over it (a cork rising at once):
			// the most it had to be at any moment up to then, from the track (a pure function of t: an export frame is the same in any order)
			st.rise = null
			if (fr.length > 1) {
				const need = []
				let most = 0
				for (const f of fr) {
					if (f.t <= tRelease) continue
					const q = f.placements[o.id]
					const tau = f.t - tRelease
					if (q) {
						const Tq = topOf(o, q)
						// (only while it is still over the thing: once drawn back, the thing passes in front of it)
						if (Math.abs(Tq.x - st.x) < st.hw + 0.02 && tau < HANGER.backS) most = Math.max(most, Tq.top - (st.tip + this.lift(tau)))
					}
					need.push([f.t, Math.max(0, most)])
				}
				st.rise = need
			}
			root.visible = true
			this.at(-1, tRelease)
		},
		/** How far it has lifted tau s after the release (m). */
		lift(tau) {
			const u = tau - HANGER.backS / 2
			return u > 0 ? 0.5 * HANGER.accel * u * u : 0
		},
		/** The holder at the run's time t: closed and still until the release, then open, lifted, gone. */
		at(t, tRelease = st.tRelease) {
			const tau = t - tRelease
			const open = st.pad ? 0 : smooth(clamp(tau / HANGER.openS, 0, 1))
			jawL.rotation.z = -((HANGER.openDeg * Math.PI) / 180) * open
			jawR.rotation.z = ((HANGER.openDeg * Math.PI) / 180) * open
			const lift = tau > 0 ? this.lift(tau) : 0
			let extra = 0
			if (tau > 0 && st.rise?.length) {
				// (never below the thing's top while over it: the most it had to rise by up to now, between the track's frames)
				const R = st.rise
				let lo = 0
				let hi = R.length - 1
				if (t >= R[hi][0]) extra = R[hi][1]
				else if (t > R[0][0]) {
					while (hi - lo > 1) {
						const m = (lo + hi) >> 1
						if (R[m][0] <= t) lo = m
						else hi = m
					}
					const u = (t - R[lo][0]) / (R[hi][0] - R[lo][0])
					extra = R[lo][1] + (R[hi][1] - R[lo][1]) * u
				} else extra = R[0][1] * clamp(tau / Math.max(1e-6, R[0][0] - tRelease), 0, 1)
			}
			if (tau > 0 && tau < HANGER.backS && st.track) {
				// (while it is still over the thing: exactly at the thing's top, between the track's frames too)
				const q = placementAt(st.track, st.part.id, t)
				if (q) {
					const Tq = topOf(st.part, q)
					if (Math.abs(Tq.x - st.x) < st.hw + 0.02) extra = Math.max(extra, Tq.top - (st.tip + lift))
				}
			}
			const back = tau > 0 ? -st.back * smooth(clamp(tau / HANGER.backS, 0, 1)) : 0 // (it draws back off the thing first)
			root.position.set(st.x, st.tip + lift + extra, back)
			root.visible = lift < HANGER.gone
		},
		hide() {
			root.visible = false
		},
	}
}

/** The lesson look's mount for a static part in mid-air (instead of a retort stand or a wall bracket): a slim rod down from 3 m to a small collar
 *  on the part's top, one in the middle (two near the ends of a bar wider than 26 cm). h = the view's mount helpers: {mountMesh, putAt,
 *  boxOf(s) -> {x0, x1, y0, y1}, rodsOf(s) -> [x]}. Sets inst.fit. */
export function mountHanger(inst, h) {
	const M = hangerMats()
	const s = inst.members[0]
	const xs = h.rodsOf(s)
	const parts = xs.map(() => ({ rod: h.mountMesh(inst, unitRod, M.rod), collar: h.mountMesh(inst, unitBox, M.jaw) }))
	for (const p of parts) p.rod.castShadow = false
	inst.fit = () => {
		const b = h.boxOf(s)
		const xr = h.rodsOf(s)
		parts.forEach((p, k) => {
			const x = xr[k] ?? xr[0]
			const top = b.y1
			p.collar.scale.set(0.014, 0.008, 0.012)
			h.putAt(p.collar, x, top + 0.004, 0)
			p.rod.scale.set(HANGER.rod * 1.4, HANGER.length, HANGER.rod * 1.4)
			h.putAt(p.rod, x, top + 0.008 + HANGER.length / 2, 0)
		})
	}
}
