// 3D models for the vehicles catalog group (see web/models3d.js for the frame and the kit).
// Toy car and motor car (cars), truck, cart, skateboard, the stand-alone wheel and bicycle wheel, the pinball flipper.
// Every model fills its part's physics outline (side view, x = length, y = height, z = front to back) to within a millimetre or two;
// the outlines are the polygons of machines/catalog_mechanisms.py (a car's body and cabin, a skateboard's deck, kicktails and trucks...).
// Helpers: vehicles-lib.js (outlines, sculpts, lathes, textures), vehicles-loft.js (a car body lofted from its outline: plan taper, crown, wheel arches, bumper bands),
// vehicles-glasshouse.js (frames, roof and real glass of a cabin), vehicles-parts.js (lamps, grille, mirrors, seats), vehicles-turned.js (one-piece wheels: wood, steel, rubber...),
// vehicles-wheelkit.js (tyres, alloy plates). Items: vehicles-cars.js, vehicles-truck.js, vehicles-cart.js, vehicles-board.js, vehicles-wheels.js, vehicles-flipper.js.
import { makeLib } from "./vehicles-lib.js"
import cars from "./vehicles-cars.js"
import truck from "./vehicles-truck.js"
import cart from "./vehicles-cart.js"
import board from "./vehicles-board.js"
import wheels from "./vehicles-wheels.js"
import flipper from "./vehicles-flipper.js"

export default function register({ addModel, kit: baseKit, THREE }) {
	// The vehicle models see the kit with a guarded box(): a NaN or zero size (a part sized from a missing prop) becomes a 0.1 mm sliver instead of a RoundedBoxGeometry full of NaN positions
	// (which broke a catalog card's whole photograph).
	const fin = (v) => (Number.isFinite(v) ? Math.max(1e-4, v) : 1e-4)
	const kit = Object.create(baseKit)
	kit.box = (w, h, d, r, segments) => baseKit.box(fin(w), fin(h), fin(d), Number.isFinite(r) ? r : undefined, segments)
	const L = makeLib(kit, THREE)
	const safe = (name, fn) => {
		try {
			fn(addModel, L, kit)
		} catch (e) {
			console.warn(`vehicles (${name}) failed to register:`, e)
		}
	}
	safe("cars", cars)
	safe("truck", truck)
	safe("cart", cart)
	safe("board", board)
	safe("wheels", wheels)
	safe("flipper", flipper)
}
