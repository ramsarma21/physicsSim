// The child's hand that web/hands.js draws: web/models/hand.glb (built by tools/hands/build_hand.py; web/CONTRACT.md "Hands"), loaded once, as
// the page loads. This module only starts the load: web/hands.js waits for it (a top-level await), so by the time the view module has loaded the
// hand is in, before any picture or export frame. It has no import that waits on anything else, so the file is fetched while the model groups
// load (web/models3d.js), not after them.
//   handModel   a Promise of {scene (the glTF's scene: the "hand" node, its skinned meshes and bones), url} or null when the file cannot be
//               loaded or read (the hands are then drawn with the procedural capsule hand, as before the mesh)
// In node (the tests) the file is read from disk; in a page it is fetched next to this module.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

export const HAND_URL = new URL("./models/hand.glb", import.meta.url)

async function bytes(url) {
	// (node: no fetch of file: URLs; the built-in modules come by process.getBuiltinModule, so the page's code imports nothing that is not there)
	const node = globalThis.process?.versions?.node && typeof globalThis.process.getBuiltinModule === "function" && url.protocol === "file:"
	if (node) {
		const fs = globalThis.process.getBuiltinModule("node:fs")
		const { fileURLToPath } = globalThis.process.getBuiltinModule("node:url")
		const b = fs.readFileSync(fileURLToPath(url))
		return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
	}
	const r = await fetch(url)
	if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
	return r.arrayBuffer()
}

async function load() {
	try {
		const data = await bytes(HAND_URL)
		const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(data, "", resolve, reject))
		const scene = gltf.scene
		let skinned = 0
		let bones = 0
		scene.traverse((o) => {
			if (o.isSkinnedMesh) skinned++
			if (o.isBone) bones++
		})
		if (!skinned || bones < 18) throw new Error(`no skinned hand in it (${skinned} skinned meshes, ${bones} bones)`)
		return { scene, url: HAND_URL.href }
	} catch (e) {
		console.warn(`hands: ${HAND_URL.pathname.split("/").pop()} could not be loaded, so the hands are drawn with the procedural hand:`, e?.message ?? e)
		return null
	}
}

export const handModel = load()
