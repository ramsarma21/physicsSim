// 3D models for the everyday-b catalog group (see web/models3d.js for the frame and the kit): objects whose side outline is not a box.
// Each item is built from real shapes (lathes, lofts, extrusions) with printed and procedural textures; every model fills its physics outline
// (side view, x = width, y = height, z = front to back; the outlines are drawn in machines/catalog_everyday.py) to within a millimetre or two.
// Helpers: everyday-b-lib.js (noise, canvas drawing, lofts, lathes, and meshSDF: a surface-nets mesher for soft implicit shapes such as the duck).
// Items: everyday-b-bottles.js (water bottle with its water, party cup, glass jar with embossed glass and a two-piece lid, mug), everyday-b-small.js (egg,
// bowling pin, traffic cone, stapler, pencil, duck), everyday-b-shoe.js (sneaker). Where the real outline is not a box (the mug is an open cup, the stapler has a
// throat, the duck and the sneaker are organic) the physics pieces in machines/catalog_everyday.py follow the same outline.
import { makeLib } from "./everyday-b-lib.js"
import bottles from "./everyday-b-bottles.js"
import small from "./everyday-b-small.js"
import shoe from "./everyday-b-shoe.js"

export default function register({ addModel, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const safe = (name, fn) => {
		try {
			fn(addModel, L)
		} catch (e) {
			console.warn(`everyday-b (${name}) failed to register:`, e)
		}
	}
	safe("bottles", bottles)
	safe("small", small)
	safe("shoe", shoe)
}
