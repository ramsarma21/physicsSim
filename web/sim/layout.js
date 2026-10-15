// What web/server.py's /api/layout and /api/simulate do around the builder, without the engine and the HTTP: clean the scene, build the
// document, find the overlaps, and (given the engine's track) summarize. Plain ES module.
import { BadScene, clean } from "./clean.js"
import { build, overlaps, summarize } from "./items.js"
import { ArithmeticError, ValueError } from "./pymath.js"

/** clean() then build(): the cleaned scene, the engine document and what each item was built with. A builder error that is the scene's
 *  fault (a ValueError or ArithmeticError) becomes a BadScene, as the server's 400 "can't build this scene: ..."; others pass through. */
export function prepare(scene) {
	const s = clean(scene)
	try {
		const { doc, resolved } = build(s)
		return { scene: s, doc, resolved }
	} catch (e) {
		if (e instanceof ValueError || e instanceof ArithmeticError) throw new BadScene(`can't build this scene: ${e.message}`)
		throw e
	}
}

/** POST /api/layout: where everything starts, no physics. -> {doc, resolved, warnings} */
export function layout(scene) {
	const { scene: s, doc, resolved } = prepare(scene)
	return { doc, resolved, warnings: overlaps(s, doc) }
}

/** summarize() looks at every solid in the first and last frame and at the dynamic ones in all; the track lists static solids
 *  that never move only in frame 0, so the last frame gets them back. (Returns a new track; the input is not changed.) */
export function with_statics(track) {
	const fr = track.frames
	if (fr.length < 2) return track
	const last = { ...fr[fr.length - 1], placements: { ...fr[0].placements, ...fr[fr.length - 1].placements } }
	return { ...track, frames: [...fr.slice(0, -1), last] }
}

/** What /api/simulate answers apart from the track and the cache bits: {doc, summary, warnings, resolved} for a cleaned scene and its track. */
export function finish(scene, doc, resolved, track) {
	return { doc, summary: summarize(scene, doc, with_statics(track)), warnings: overlaps(scene, doc), resolved }
}
