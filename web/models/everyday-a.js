// 3D models for everyday objects, part A (see web/models3d.js for the frame and the kit).
// Each item is built from a few real shapes (lofts, lathes, rounded boxes, plates) with printed and procedural textures;
// every model fills its physics outline (side view, x = width, y = height, z = front to back) to within a millimetre or two.
// Helpers: everyday-a-lib.js. Items: everyday-a-books.js (books and boxes), everyday-a-flat.js (flat things), everyday-a-small.js
// (small solids and the pillow), everyday-a-round.js (rolls, cans, fruit, candle).
import { makeLib } from "./everyday-a-lib.js"
import books from "./everyday-a-books.js"
import flat from "./everyday-a-flat.js"
import small from "./everyday-a-small.js"
import round from "./everyday-a-round.js"

export default function register({ addModel, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const safe = (name, fn) => {
		try {
			fn(addModel, L)
		} catch (e) {
			console.warn(`everyday-a (${name}) failed to register:`, e)
		}
	}
	safe("books", books)
	safe("flat", flat)
	safe("small", small)
	safe("round", round)
}
