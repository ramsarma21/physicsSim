// Builds the ground-truth scenes for the image cases: the built-in scenarios (web/scenarios, all but the empty table) and hand-designed
// arrangements of catalog items, each item set exactly onto its support with the app's own builder geometry (web/sim layout), with a seeded
// jitter in gaps and orders so they are not all tidy. Every scene must build with zero overlap warnings. Writes ai/bench/gt/<id>.json.
//   node ai/bench/tools/make-gt-scenes.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH = path.resolve(HERE, "..")
const ROOT = path.resolve(BENCH, "../..")
const { geometry, SIM, r5, rng, scene, itemOf, extent, topOver, GAP, put, at, leanRamp, check, STAGE } = await import(pathToFileURL(path.join(HERE, "place.mjs")).href)

const OUT = path.join(BENCH, "gt")
fs.mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------- arrangements
const scenes = []
const descriptions = {}

{ // everyday desk objects, standing and lying
	const R = rng(11)
	const sc = scene("desk-objects", "Desk objects", STAGE(0.55, 2.05, 0.9))
	let x = 0.62
	const g = () => 0.04 + R() * 0.05
	let p = put(sc, { id: "bottle", type: "water-bottle", name: "Water bottle" }, { left: x }); x = p.x1 + g()
	const book = put(sc, { id: "book", type: "hardcover-book", name: "Hardcover book" }, { left: x }); x = book.x1 + g()
	put(sc, { id: "phone", type: "smartphone", name: "Smartphone" }, { x: book.x + 0.01, on: "book" })
	p = put(sc, { id: "mug", type: "coffee-mug", name: "Coffee mug" }, { left: x }); x = p.x1 + g()
	p = put(sc, { id: "can", type: "soda-can", name: "Soda can" }, { left: x }); x = p.x1 + g()
	p = put(sc, { id: "tissues", type: "tissue-box", name: "Tissue box" }, { left: x }); x = p.x1 + g()
	p = put(sc, { id: "cube", type: "rubiks-cube", name: "Rubik's cube" }, { left: x }); x = p.x1 + g()
	p = put(sc, { id: "apple", type: "apple", name: "Apple" }, { left: x }); x = p.x1 + g()
	p = put(sc, { id: "candle", type: "candle", name: "Candle" }, { left: x })
	scenes.push(check(sc))
	descriptions[sc.id] = "Everyday things standing in a row on the table, left to right: a water bottle, a hardcover book lying flat with a smartphone on it, a coffee mug, a soda can, a tissue box, a Rubik's cube, an apple and a tall candle."
}
{ // books, a ramp leaning on them, a ball on the ramp, a cup at the bottom
	const sc = scene("book-ramp-ball", "Book ramp and cup", STAGE(0.45, 2.1, 1.0))
	const b1 = put(sc, { id: "book1", type: "hardcover-book", name: "Book 1" }, { left: 0.55 })
	put(sc, { id: "book2", type: "hardcover-book", name: "Book 2" }, { x: b1.x + 0.006, on: "book1" })
	put(sc, { id: "book3", type: "paperback-book", name: "Book 3" }, { x: b1.x - 0.01, on: "book2" })
	const ramp = leanRamp(sc, { id: "ramp", type: "plank", name: "Ramp", props: { length: 0.8 } }, "book3", -8.5)
	const [px, py] = ramp.along(0.09)
	const rb = 0.067 / 2
	at(sc, { id: "ball", type: "tennis-ball", name: "Tennis ball" }, px + rb * ramp.normal[0], py + rb * ramp.normal[1] + GAP)
	const G = geometry(sc)
	put(sc, { id: "cup", type: "plastic-cup", name: "Plastic cup" }, { left: G.byId.get("ramp").box.x1 + 0.12 })
	scenes.push(check(sc))
	descriptions[sc.id] = "Three books stacked flat at the left (two hardcovers, a paperback on top); a wooden plank ramp leans from the top book down to the table on the right; a tennis ball rests near the top of the ramp; a plastic cup stands on the table a little past the ramp's low end."
}
{ // stacks and standing things
	const sc = scene("stacks", "Stacks and standing things", STAGE(0.5, 2.1, 1.0))
	const b = put(sc, { id: "brick1", type: "brick", name: "Brick 1" }, { left: 0.6 })
	put(sc, { id: "brick2", type: "brick", name: "Brick 2" }, { x: b.x, on: "brick1" })
	put(sc, { id: "brick3", type: "brick", name: "Brick 3" }, { x: b.x + 0.01, on: "brick2" })
	const box = put(sc, { id: "box", type: "cardboard-box", name: "Cardboard box" }, { left: b.x1 + 0.1 })
	put(sc, { id: "cube", type: "rubiks-cube", name: "Rubik's cube" }, { x: box.x - 0.04, on: "box" })
	const pin = put(sc, { id: "pin", type: "bowling-pin", name: "Bowling pin" }, { left: box.x1 + 0.08 })
	const cone = put(sc, { id: "cone", type: "traffic-cone", name: "Traffic cone" }, { left: pin.x1 + 0.08 })
	put(sc, { id: "soccer", type: "soccer-ball", name: "Soccer ball" }, { left: cone.x1 + 0.06 })
	scenes.push(check(sc))
	descriptions[sc.id] = "Left to right on the table: a stack of three bricks, a cardboard box with a Rubik's cube on top, a standing bowling pin, an orange traffic cone and a soccer ball."
}
{ // seesaw catapult: ball on the low end, weight held above the high end, basket
	const sc = scene("seesaw-catapult", "Seesaw catapult", STAGE(0.5, 2.1, 1.0))
	at(sc, { id: "seesaw", type: "seesaw", name: "Seesaw" }, 0.95, 0)
	let G = geometry(sc)
	const S = G.byId.get("seesaw")
	// the low (right) end: the ping-pong ball sits on the plank there; the weight hangs above the high (left) end
	const r = 0.02
	const bx = S.box.x1 - 0.05
	at(sc, { id: "ball", type: "ping-pong-ball", name: "Ping-pong ball" }, bx, 0) // placed properly below
	const ballIt = itemOf(sc, "ball")
	sc.items.pop()
	ballIt.y = r5(topOver(sc, "seesaw", bx - 0.002, bx + 0.002) + r + GAP)
	sc.items.push(ballIt)
	const wx = S.box.x0 + 0.04
	at(sc, { id: "weight", type: "steel-weight-1kg", name: "Steel weight", held: true }, wx, topOver(sc, "seesaw", wx - 0.03, wx + 0.03) + 0.32)
	put(sc, { id: "basket", type: "basket", name: "Basket" }, { left: S.box.x1 + 0.2 })
	scenes.push(check(sc))
	descriptions[sc.id] = "A wooden seesaw near the left: its right end is down with a ping-pong ball resting on it; a 1 kg steel weight is held about 30 cm above the raised left end; a wide woven basket stands on the table to the right."
}
{ // balls of many sizes in a shuffled row
	const R = rng(7)
	const sc = scene("balls-lineup", "Ball line-up", STAGE(0.4, 2.3, 0.9))
	const types = [["basketball", "Basketball"], ["soccer-ball", "Soccer ball"], ["bowling-ball", "Bowling ball"], ["tennis-ball", "Tennis ball"], ["baseball", "Baseball"], ["billiard-ball", "Billiard ball"], ["golf-ball", "Golf ball"], ["ping-pong-ball", "Ping-pong ball"], ["glass-marble", "Glass marble"], ["steel-ball", "Steel ball"]]
	for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [types[i], types[j]] = [types[j], types[i]] }
	let x = 0.48
	for (const [t, n] of types) { const p = put(sc, { id: t, type: t, name: n }, { left: x }); x = p.x1 + 0.035 + R() * 0.04 }
	scenes.push(check(sc))
	descriptions[sc.id] = `Ten balls resting in one row on the table, left to right: ${types.map(([, n]) => n.toLowerCase()).join(", ")}.`
}
{ // Newton's cradle, a rope pendulum and five dominoes
	const sc = scene("cradle-pendulum", "Cradle, pendulum and dominoes", STAGE(0.45, 2.15, 1.0))
	put(sc, { id: "cradle", type: "newtons-cradle", name: "Newton's cradle" }, { left: 0.52 })
	at(sc, { id: "pendulum", type: "rope-pendulum", name: "Rope pendulum", props: { length: 0.45, start_angle: -40 } }, 1.62, 0.51)
	let x = 1.67
	for (let k = 1; k <= 5; k++) { const p = put(sc, { id: `d${k}`, type: "domino", name: `Domino ${k}` }, { left: x }); x = p.x1 + 0.028 }
	scenes.push(check(sc))
	descriptions[sc.id] = "A Newton's cradle on the left; in the middle a rope pendulum hangs from a fixed point, its steel bob pulled back to the left; to its right five dominoes stand in a short row on the table."
}
{ // vehicles: a toy car at the top of a ramp leaning on a box, a truck and a skateboard
	const sc = scene("vehicles", "Vehicles", STAGE(0.3, 3.1, 1.0))
	put(sc, { id: "box", type: "cardboard-box", name: "Cardboard box" }, { left: 0.4 })
	const ramp = leanRamp(sc, { id: "ramp", type: "plank", name: "Ramp", props: { length: 0.92 } }, "box", -14)
	const [cx, cy] = ramp.along(0.14)
	at(sc, { id: "car", type: "toy-car", name: "Toy car", angle: ramp.angle }, cx, cy + GAP)
	const G = geometry(sc)
	const tr = put(sc, { id: "truck", type: "truck", name: "Truck" }, { left: G.byId.get("ramp").box.x1 + 0.12 })
	put(sc, { id: "skateboard", type: "skateboard", name: "Skateboard" }, { left: tr.x1 + 0.1 })
	scenes.push(check(sc))
	descriptions[sc.id] = "A cardboard box at the left with a wooden plank ramp leaning from its top down to the right; a small toy car sits near the top of the ramp, pointing down it; on the table to the right: a toy truck and then a skateboard."
}

// ---------------------------------------------------------------- the built-in scenarios
const SCEN = {
	"rube-goldberg": "The starter Rube Goldberg machine: a held superball at the top left above a short ramp, a long second ramp sloping down to the right, a row of seven growing dominoes, a seesaw with a plastic ball on its low right end, and an open box hanging above the seesaw (left and right see-through walls at the ends).",
	"car-ramp-dominoes": "A toy car at the top of a wooden ramp sloping down to the right, and a row of seven growing dominoes on the table past the ramp's end.",
	"pendulum-dominoes": "A pendulum on a hanger pulled back to the left and a row of seven growing dominoes starting just right of its lowest point.",
	"wrecking-ball": "A wrecking ball on a crane pulled back to the left, and a tower of five bricks stacked on the table to its right.",
	"conveyor-delivery": "A conveyor belt carrying three golf balls towards an open box on the table at its right end.",
	"spring-launch": "A spring launcher aimed up and to the right on a 45° support plank with a golf ball on it, and a cup on the table far to the right.",
	"ball-drop": "Six balls held 1 m above the table in a row: superball, tennis ball, basketball, ping-pong ball, clay ball and bowling ball.",
	"newtons-cradle": "A Newton's cradle with five steel balls, the first pulled out to the left.",
	"plinko": "A peg board between two see-through walls, a held golf ball above it, and nine cups in a row on the table under it.",
	"trampoline": "A wide trampoline with a basketball, a tennis ball and a superball held above it at different heights.",
	"atwood": "An Atwood machine: one pulley with two hanging weights of different masses.",
}
for (const [id, d] of Object.entries(SCEN)) {
	const sc = JSON.parse(fs.readFileSync(path.join(ROOT, "web/scenarios", `${id}.json`), "utf8"))
	scenes.push(sc)
	descriptions[id] = d
}

for (const sc of scenes) fs.writeFileSync(path.join(OUT, `${sc.id}.json`), JSON.stringify(sc, null, 1) + "\n")
fs.writeFileSync(path.join(HERE, "gt-descriptions.json"), JSON.stringify(descriptions, null, 1) + "\n")
console.log(scenes.map((s) => `${s.id}: ${s.items.length} items, ${SIM.layout(s).warnings.length} warnings`).join("\n"))
