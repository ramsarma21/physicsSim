// Shared helpers for the views: placements at any moment, and parts by kind. Plain ES module.

const complete = new WeakSet()

/** The server lists a static solid that never moves only in frames[0] (a quarter of the payload otherwise). This gives every later
 *  frame that same placement, shared, once per track and in place, so any reader can look any solid up in any frame. Every function
 *  here calls it first; code that reads track.frames directly gets static solids only after one of them has run for that track. */
export function completeTrack(track) {
	if (complete.has(track)) return track
	complete.add(track)
	const f = track.frames
	if (!f.length) return track
	const first = f[0].placements
	for (let k = 1; k < f.length; k++) {
		const pl = f[k].placements
		for (const id in first) if (!(id in pl)) pl[id] = first[id]
	}
	return track
}

/** Index of the last frame at or before t (binary search; frames may be unevenly spaced near impacts). */
export function frameIndex(track, t) {
	completeTrack(track)
	const f = track.frames
	if (t <= f[0].t) return 0
	if (t >= f[f.length - 1].t) return f.length - 1
	let lo = 0
	let hi = f.length - 1
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1
		if (f[mid].t <= t) lo = mid
		else hi = mid
	}
	return lo
}

/** Every solid's world placement {x, y, angle, squash?} at time t (s), linear between engine samples. */
export function placementsAt(track, t) {
	completeTrack(track)
	const f = track.frames
	const i = frameIndex(track, t)
	const a = f[i]
	const b = f[Math.min(i + 1, f.length - 1)]
	const span = b.t - a.t
	const u = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0
	const out = {}
	for (const id in a.placements) {
		const p = a.placements[id]
		const q = b.placements[id] ?? p
		out[id] = {
			x: p.x + (q.x - p.x) * u,
			y: p.y + (q.y - p.y) * u,
			angle: p.angle + (q.angle - p.angle) * u,
			...(p.squash !== undefined ? { squash: p.squash } : {}),
		}
	}
	return out
}

/** The path a part takes: [{t, x, y}] at every engine sample. */
export function pathOf(track, id) {
	completeTrack(track)
	return track.frames.map((f) => ({ t: f.t, x: f.placements[id].x, y: f.placements[id].y }))
}

/** The hand's pose at time t: "holding" until the release, then each `via` pose for its seconds, then the final pose. */
export function handPose(doc, t) {
	const h = doc.release.holder
	if (!h) return null
	if (t < doc.release.at) return h.from
	let at = doc.release.at
	for (const v of h.via ?? []) {
		at += v.seconds
		if (t < at) return v.pose
	}
	return h.to
}

export const isBall = (s) => s.body.kind === "ball"
export const isDomino = (s) => s.id.startsWith("domino")
