// The real free room under things in the air, for the edit step (ai/steps.mjs edit(): appended to "# The current scene").
// The digest's "where" line gives the gap between outline BOXES ("in the air; 3.7 cm above seesaw"), and edit.md tells the model to read
// gaps that way. Under a sloped or round thing that is too small: the starter's box hangs 3.7 cm above the seesaw's box, but the plank
// right under the box is 6.8 cm below it (the seesaw's top is its raised end, off to the side). Told 3.7 cm, the model lowered the box
// 2.7 or 3.6 cm instead of the 5 cm asked, or asked first (round 3, §8 B, s-box-lower5: 3 of 4 samples). This measures the room between
// the shapes themselves (each solid's true outline in the built scene, as ai/scene-digest.mjs reads what rests on what) and lists it where
// it is at least 1 cm more than the boxes say, in place of the boxes' gap in that thing's "where" line (just the number: see withRoom).
// Only for things that are not held and do not move (a box hung on cords, a shelf): a held or dynamic thing just above another rides with
// it when that moves (the app's rule, by the boxes' gap), and that rule must keep reading the same numbers.
//   import { roomUnder, withRoom } from "./room.mjs"
//   const r = await roomUnder(scene, d)    // d = sceneDigest(scene); -> {items: [{id, best (the digest's thing under it), below, boxGap, room}]}
//   const text = withRoom(rich.text, r)    // the digest with the real gap in each listed thing's "where" line
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { worldPoses } from "./catalog-digest.mjs"

const PG = dirname(dirname(fileURLToPath(import.meta.url)))
let simP = null
const sim = () => (simP ??= import(pathToFileURL(join(PG, "web", "sim", "index.js")).href))
const len = (m) => (m >= 1 ? `${+m.toFixed(2)} m` : `${+(m * 100).toFixed(1)} cm`)
const safety = (i) => i?.type === "wall" && i.props?.invisible_in_3d === true

/** A solid's outline in the world: {pts} (a convex polygon) or {c, r} (a ball); null for a body kind without one. */
function outlineOf(s, pose) {
	if (!pose || !s.body) return null
	const [x, y, a] = pose
	const b = s.body
	if (b.kind === "ball") return { c: [x, y], r: b.radius }
	let pts
	if (b.kind === "polygon") pts = b.points.map((p) => [p.x, p.y])
	else if (b.kind === "slab") {
		const hw = b.width / 2
		const hh = b.height / 2
		const hb = hw * (b.taper ?? 1)
		pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
	} else return null
	const c = Math.cos(a)
	const n = Math.sin(a)
	return { pts: pts.map(([px, py]) => [x + px * c - py * n, y + px * n + py * c]) }
}
/** [low, high] of an outline on the vertical line at x, or null when the line misses it. */
function spanAt(o, x) {
	if (o.c) {
		const dx = x - o.c[0]
		if (Math.abs(dx) > o.r) return null
		const h = Math.sqrt(o.r * o.r - dx * dx)
		return [o.c[1] - h, o.c[1] + h]
	}
	let lo = Infinity
	let hi = -Infinity
	const P = o.pts
	for (let i = 0; i < P.length; i++) {
		const [ax, ay] = P[i]
		const [bx, by] = P[(i + 1) % P.length]
		if ((x < Math.min(ax, bx) - 1e-9) || (x > Math.max(ax, bx) + 1e-9)) continue
		const y = Math.abs(bx - ax) < 1e-12 ? null : ay + ((x - ax) / (bx - ax)) * (by - ay)
		for (const v of y === null ? [ay, by] : [y]) {
			lo = Math.min(lo, v)
			hi = Math.max(hi, v)
		}
	}
	return lo <= hi ? [lo, hi] : null
}
const xsOf = (o) => (o.c ? [o.c[0]] : o.pts.map((p) => p[0]))

/**
 * For each thing in the air that is not held and never moves: the thing right under it as the digest picks it (the highest outline-box top
 * under its outline box), the boxes' gap, and the real room: the least vertical distance between its own shapes' undersides and the tops of
 * every other thing's shapes under it. Listed when the real room is at least 1 cm more than the boxes' gap.
 */
export async function roomUnder(scene, d) {
	const out = { items: [] }
	const candidates = (d?.items ?? []).filter((r) => r.box && r.type !== "table" && !r.held && r.moves === false && /^nothing/.test(r.rests_on ?? ""))
	if (!candidates.length) return out
	const byId = new Map((scene?.items ?? []).map((i) => [i.id, i]))
	const m = await sim()
	const { doc } = m.layout(scene)
	const poses = worldPoses(doc.solids)
	const outlines = new Map()
	for (const s of doc.solids) {
		const o = outlineOf(s, poses.get(s.id))
		if (o) (outlines.get(s.item) ?? outlines.set(s.item, []).get(s.item)).push(o)
	}
	for (const r of candidates) {
		if (safety(byId.get(r.id))) continue
		let best = null
		for (const o of d.items) {
			if (o.id === r.id || !o.box || safety(byId.get(o.id))) continue
			if (o.box.x1 < r.box.x0 || o.box.x0 > r.box.x1 || o.box.y1 > r.box.y0 + 0.02) continue
			if (!best || o.box.y1 > best.box.y1) best = o
		}
		if (!best || best.type === "table") continue
		const boxGap = r.box.y0 - best.box.y1
		if (boxGap <= 0.02 || boxGap >= 0.2) continue // (it stands on it, as the digest says; or it is so high that a move is not cut short)
		const mine = outlines.get(r.id) ?? []
		if (!mine.length) continue
		// every vertical line through its outline box: sampled, plus every corner's x (the gap between two convex outlines is least at one)
		const xs = new Set(Array.from({ length: 41 }, (_, k) => r.box.x0 + (k / 40) * (r.box.x1 - r.box.x0)))
		const others = d.items.filter((o) => o.id !== r.id && o.box && !safety(byId.get(o.id)) && o.box.x1 >= r.box.x0 && o.box.x0 <= r.box.x1 && o.box.y0 < r.box.y0)
		for (const ol of [...mine, ...others.flatMap((o) => outlines.get(o.id) ?? [])]) for (const x of xsOf(ol)) if (x >= r.box.x0 && x <= r.box.x1) for (const e of [-1e-6, 0, 1e-6]) xs.add(x + e)
		let room = Infinity
		let below = null
		for (const x of xs) {
			const bottom = Math.min(...mine.map((ol) => spanAt(ol, x)?.[0] ?? Infinity))
			if (!Number.isFinite(bottom)) continue
			for (const o of others)
				for (const ol of outlines.get(o.id) ?? []) {
					const top = spanAt(ol, x)?.[1]
					if (top === undefined || top > bottom + 0.02) continue // (a thing beside it, not under it)
					if (bottom - top < room) {
						room = bottom - top
						below = o
					}
				}
		}
		if (!below || !Number.isFinite(room) || room - boxGap < 0.01) continue
		out.items.push({ id: r.id, best: best.id, below: below.type === "table" ? "the table" : below.id, boxGap, room })
	}
	return out
}

/**
 * The rich digest's text (ai/rich-digest.mjs) with each listed thing's "where" gap ("in the air; 3.7 cm above seesaw;", the outline boxes'
 * gap) replaced by the real one ("in the air; 6.8 cm above seesaw;"), and nothing else. Measured same-time A/Bs on the live drawer (6
 * samples an arm): "lower the box by 5 cm" 6/6 and 6/6 against 1/6 and 3/6 without it. Saying more did harm: a section of its own about
 * the room under hung things, or "(the real gap right under it; the outline boxes are 3.7 cm apart)" after the number, made the model put a
 * swapped-in cup on a post beside the seesaw ("swap the box for a cup" 2/6 against 6/6); the bare number keeps it at 6/6. A line it cannot
 * find (the digest's wording changed) is left as it is (ai/test/steps.test.mjs pins the wording).
 */
export function withRoom(text, r) {
	let out = String(text ?? "")
	for (const x of r?.items ?? []) {
		const start = out.indexOf(`\n- ${x.id} · `)
		if (start < 0) continue
		const next = out.slice(start + 1).search(/\n(- |## )/)
		const end = next < 0 ? out.length : start + 1 + next
		const block = out.slice(start, end)
		const was = `in the air; ${len(x.boxGap)} above ${x.best};`
		if (!block.includes(was)) continue
		const now = `in the air; ${len(x.room)} above ${x.below};`
		out = out.slice(0, start) + block.replace(was, now) + out.slice(end)
	}
	return out
}
