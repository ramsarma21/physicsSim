// Each item's box in metres (the builder's outlines at t = 0), for the ground-truth meta files (render-gt.cjs).
import { geometry } from "../score.mjs"
const r5 = (v) => Math.round(v * 1e5) / 1e5
export async function geometryOf(scene) {
	const G = geometry(scene)
	return Object.fromEntries(G.items.map((i) => [i.id, { x0: r5(i.box.x0), y0: r5(i.box.y0), x1: r5(i.box.x1), y1: r5(i.box.y1), w: r5(i.w), h: r5(i.h) }]))
}
