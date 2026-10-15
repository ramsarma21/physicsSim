// The rich scene digest for the edit step (the A/B's "rich" digest): the frozen ai/scene-digest.mjs rows + integrate/rich-digest.mjs.
//   const d = await richDigest(scene, { sim, plan, F, cat })   // {text, groups, rows, digest, hash}
import { richDigestFrom } from "../integrate/rich-digest.mjs"
export { looksOf } from "../integrate/rich-digest.mjs"

export async function richDigest(scene, { sim = null, plan = null, F, cat }) {
	const d = await F.sceneDigest.sceneDigest(scene, cat.index)
	return richDigestFrom(scene, d, { sim, plan, cat })
}
