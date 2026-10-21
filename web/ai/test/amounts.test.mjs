// Amounts and the words that name a setting (web/ai/amounts.js), and the edit's reading of the person's own choices with them
// (web/ai/orchestrator.js choicesOf): an amount in mL, L, s, rpm, °C, V or Hz holds the setting it is for, also said in a clause of its own ("use
// a thinner hose, only 6 mm wide inside"); a module's switch or pick-from-list setting the words name without a module word of its own ("light
// the candle", "close the switch", "fold it as a dart") is held; what was held before is still held the same way.
//   node --test web/ai/test/amounts.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { AMOUNT, EXPLICIT, unitFamily, amountsIn, unitAmount, bareAmount, propWords } from "../amounts.js"
import { choicesOf, namedIn } from "../orchestrator.js"
import { propSpec } from "../solver.js"

const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items) => ({ version: 2, id: "t", name: "t", seconds: 3, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals: [] })
/** The hard and forward choices of one thing, for words and the keys the edit set on it. */
const said = (text, item, keys, targets = null) => {
	const sc = scene([item])
	const c = choicesOf(text, new Map([[item.id, new Set(keys)]]), sc, namedIn(text, sc), null, targets)
	return { hard: [...(c.hard.get(item.id) ?? [])].sort(), forward: [...(c.forward.get(item.id) ?? [])].sort() }
}

test("the amount pattern holds mL, L, s, rpm, °C, V, Hz and the rest, each unit matched whole", () => {
	const amt = new RegExp(`^${AMOUNT}$`, "i")
	for (const t of ["200 mL", "200ml", "2 L", "1.5 litres", "20 mL/s", "2 L/min", "5 s", "30 seconds", "2 min", "300 rpm", "80 °C", "80°C", "80 degrees C", "9 V", "9 volts", "440 Hz", "60 W", "5 N", "40 kPa", "50 %", "5 cm", "30°", "200 g", "1.2 kg", "twice", "five times", "3 x", "0.5 m/s", "12 g/s", "20 turns"])
		assert.ok(amt.test(t), t)
	// (a unit is matched whole: no "200 m" in "200 mL", no "5 s" in "5 small balls", no "2 a" for amps)
	assert.equal(new RegExp(`\\b${AMOUNT}\\s+left`, "i").test("move it 200 mL left"), true)
	assert.equal(new RegExp(`^${AMOUNT}`, "i").exec("200 mL of water")[0], "200 mL")
	assert.equal(new RegExp(`^${AMOUNT}`, "i").exec("20 mL/s")[0], "20 mL/s")
	assert.equal(new RegExp(`^${AMOUNT}`, "i").test("5 small balls"), false)
	assert.equal(new RegExp(`^${AMOUNT}`, "i").test("2 apples"), false)
	assert.equal(EXPLICIT.test("fill it with 200 mL"), true)
	assert.equal(EXPLICIT.test("heat it to 80 °C"), true)
	assert.equal(EXPLICIT.test("put all 5 in the box"), false, "no amount in a count put in a box")
	assert.equal(EXPLICIT.test("make it work"), false)
	assert.equal(EXPLICIT.test("move the box 10 cm left"), true, "the old units still count")
})

test("units are read as what they measure, and an amount holds a setting by its unit only where no other setting the edit set shares it", () => {
	assert.equal(unitFamily("mL"), "volume")
	assert.equal(unitFamily("L"), "volume")
	assert.equal(unitFamily("mL/s"), "flow")
	assert.equal(unitFamily("L/min"), "flow")
	assert.equal(unitFamily("°C"), "temperature")
	assert.equal(unitFamily("°"), "angle")
	assert.equal(unitFamily("turns/min"), "rotation")
	assert.equal(unitFamily("rpm"), "rotation")
	assert.equal(unitFamily("V"), "voltage")
	assert.equal(unitFamily("Hz"), "frequency")
	assert.equal(unitFamily("s"), "time")
	assert.equal(unitFamily("h"), "time")
	assert.deepEqual(amountsIn("fill it with 200 mL at 2 s").map((a) => a.family), ["volume", "time"])
	const fill = { unit: "mL" }
	assert.equal(unitAmount("fill the pitcher with 200 mL", fill), true)
	assert.equal(unitAmount("fill the pitcher with 200 mL", fill, [{ unit: "mL" }]), false, "two settings in mL: the unit alone can't say which")
	assert.equal(unitAmount("make it 30 cm wide", { unit: "m" }), false, "a length is said for a move as often: its own words decide")
	assert.equal(unitAmount("heat the water to 80 degrees", { unit: "°C" }), true, "degrees with no C are a temperature's")
	assert.equal(unitAmount("tilt the lamp 30 degrees", { unit: "°C" }), false, "…but not where the clause turns something")
	assert.equal(bareAmount("set the friction to 0.5", "friction\\w*", { unit: "" }), true)
	assert.equal(bareAmount("use 3 cells", "cell\\w*", { unit: "" }), true)
	assert.equal(bareAmount("make it bounce 2 times", "bounc\\w*", { unit: "" }), false)
	assert.match(propWords({ label: "Lit", kind: "bool" }, "lit"), /light/)
	assert.match(propWords({ label: "Closed at the start", kind: "bool" }, "closed"), /open/)
	assert.match(propWords({ label: "Design", kind: "choice", choices: ["dart", "glider"] }, "design"), /dart/)
})

test("the person's own amount in mL, L, s, rpm, °C, V and Hz is held as theirs (never offered back by a fix)", () => {
	const cases = [
		["Fill the pitcher with 200 mL of water", { id: "p", type: "pitcher", name: "Pitcher", x: 0.5, y: 0.3, props: { fill_ml: 200 } }, ["fill_ml"]],
		["Make the tap pour 20 mL/s", { id: "t", type: "tap", name: "Tap", x: 0.5, y: 0.3, props: { flow_ml_s: 20 } }, ["flow_ml_s"]],
		["Turn the hot plate up to 300 W", { id: "hp", type: "hot-plate", name: "Hot plate", x: 0.5, y: 0, props: { power_w: 300 } }, ["power_w"]],
		["Heat the water in the beaker to 80 °C", { id: "bk", type: "beaker", name: "Beaker", x: 0.5, y: 0, props: { water_temp_c: 80 } }, ["water_temp_c"]],
		["Make the buzzer 9 V", { id: "bz", type: "buzzer", name: "Buzzer", x: 0.5, y: 0, props: { volts: 9 } }, ["volts"]],
		["Make the tuning fork 440 Hz", { id: "tf", type: "tuning-fork", name: "Tuning fork", x: 0.5, y: 0, props: { pitch: 440 } }, ["pitch"]],
		["Spin the gear train at 300 rpm", { id: "g", type: "gear-train", name: "Gear train", x: 0.5, y: 0.2, props: { rpm: 300 } }, ["rpm"]],
		["Pump the vacuum jar down in 5 s", { id: "v", type: "vacuum-jar", name: "Vacuum jar", x: 0.5, y: 0, props: { pump_s: 5 } }, ["pump_s"]],
		["Blow 2 L of air into the balloon", { id: "bl", type: "party-balloon", name: "Balloon", x: 0.5, y: 0.3, props: { fill_l: 2 } }, ["fill_l"]]
	]
	for (const [text, item, keys] of cases) {
		if (!propSpec(item.type, keys[0])) continue // (a catalog without that module)
		assert.deepEqual(said(text, item, keys), { hard: keys, forward: [] }, text)
	}
})

test("an amount in a clause of its own is the thing's that the clause before it names", () => {
	if (!propSpec("hose", "diameter_mm")) return
	assert.deepEqual(said("Use a thinner hose, only 6 mm wide inside", { id: "h", type: "hose", name: "Hose", x: 0.5, y: 0.3, props: { diameter_mm: 6 } }, ["diameter_mm"]), { hard: ["diameter_mm"], forward: [] })
	assert.deepEqual(said("Make the tap pour faster: 30 mL/s", { id: "t", type: "tap", name: "Tap", x: 0.5, y: 0.3, props: { flow_ml_s: 30 } }, ["flow_ml_s"]), { hard: ["flow_ml_s"], forward: [] })
	// (a move said after the thing, "then move it 10 cm left": its place is held, the way the weight went kept from going back)
	const r = said("Make the ball heavier, then move it 10 cm left", { id: "ball", type: "tennis-ball", name: "Ball", x: 0.5, y: 0.1, props: { mass: 0.1 } }, ["place", "mass"])
	assert.ok(r.hard.includes("place") && r.forward.includes("mass"), JSON.stringify(r))
})

test("a switch or a pick-from-list setting named by its own label, its verbs or its choice is held (no module word needed)", () => {
	const cases = [
		["Light the candle", { id: "c", type: "candle", name: "Candle", x: 0.5, y: 0, props: { lit: true } }, ["lit"]],
		["Blow out the candle", { id: "c", type: "candle", name: "Candle", x: 0.5, y: 0, props: { lit: false } }, ["lit"]],
		["Close the switch", { id: "s", type: "switch", name: "Switch", x: 0.5, y: 0, props: { closed: true } }, ["closed"]],
		["Fold the paper plane as a dart", { id: "p", type: "paper-airplane", name: "Paper plane", x: 0.5, y: 0.5, props: { design: "dart" } }, ["design"]],
		["Use 3 cells in the battery holder", { id: "bat", type: "battery", name: "Battery", x: 0.5, y: 0, props: { cells: 3 } }, ["cells"]],
		["Set the ball's friction to 0.5", { id: "ball", type: "tennis-ball", name: "Ball", x: 0.5, y: 0.1, props: { friction: 0.5 } }, ["friction"]]
	]
	for (const [text, item, keys] of cases) {
		if (!propSpec(item.type, keys[0])) continue
		assert.deepEqual(said(text, item, keys).hard, keys, text)
	}
	// ("put the cap on the deeper bottle": the edit step's own reading names the bottle)
	if (propSpec("leaky-bottle", "cap")) assert.deepEqual(said("Put the cap on the deeper bottle.", { id: "b", type: "leaky-bottle", name: "Bottle with 20 cm of water", x: 0.5, y: 0, props: { cap: true } }, ["cap"], [{ says: "the deeper bottle", ids: ["b"] }]).hard, ["cap"])
})

test("what was held before is held the same way: sizes by their words, places by their amounts, ways without one", () => {
	assert.deepEqual(said("Make the box 5 cm wider and 2 cm taller", { id: "box", type: "box", name: "Box", x: 0.5, y: 0, props: { width: 0.3, height: 0.12 } }, ["width", "height"]), { hard: ["height", "width"], forward: [] })
	assert.deepEqual(said("Move the box 10 cm left and make it heavier", { id: "box", type: "box", name: "Box", x: 0.5, y: 0, props: { mass: 1 } }, ["place", "mass"]), { hard: ["place"], forward: ["mass"] })
	assert.deepEqual(said("move the seesaw a bit to the right", { id: "seesaw", type: "seesaw", name: "Seesaw", x: 1, y: 0 }, ["place"]), { hard: [], forward: ["place"] })
	// (a length amount said for a move never holds a size the edit also set: "move the box 10 cm left" with its width changed too)
	assert.deepEqual(said("move the box 10 cm left", { id: "box", type: "box", name: "Box", x: 0.4, y: 0, props: { width: 0.3 } }, ["place", "width"]), { hard: ["place"], forward: [] })
})
