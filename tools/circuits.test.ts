// Unit tests of the circuit physics core: tooling/src/sim/circuit-solver.ts (nodal analysis, piecewise-linear diodes, a branch's line) and
// tooling/src/sim/circuits.ts (the parts: cells, wires, filaments, LEDs, switches, dimmers, buzzers, motors, probes, solar panels, meters).
//   node --test --no-warnings --import ./tools/engine-math-node.mjs tools/circuits.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"
import { type Branch, lineOf, solve } from "../tooling/src/sim/circuit-solver.ts"
import { CircuitSim, type CircuitsDoc, filamentLight, filamentOf, LIT, ROOM_K, W_MELT } from "../tooling/src/sim/circuits.ts"

const close = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`)
const R = (a: number, b: number, r: number): Branch => ({ kind: "g", a, b, g: 1 / r, e: 0 })
const E = (a: number, b: number, emf: number, r: number): Branch => ({ kind: "g", a, b, g: 1 / r, e: emf })

test("series: a 3 V source with 0.3 Ω inside, through 10 Ω and 20 Ω", () => {
	// nodes: 0 = −, 1 = +, 2 = between the resistors
	const s = solve(3, [E(1, 0, 3, 0.3), R(1, 2, 10), R(2, 0, 20)])
	const I = 3 / 30.3
	close(s.current[1] as number, I, 1e-12, "I")
	close(s.current[0] as number, -I, 1e-12, "battery I (a→b inside is −I)")
	close((s.v[1] as number) - (s.v[0] as number), 3 - 0.3 * I, 1e-12, "terminal V")
	assert.equal(s.settled, true)
})

test("parallel: two equal bulbs in parallel take twice the current of one", () => {
	const one = solve(2, [E(1, 0, 1.5, 0.15), R(1, 0, 5)])
	const two = solve(2, [E(1, 0, 1.5, 0.15), R(1, 0, 5), R(1, 0, 5)])
	close(-(two.current[0] as number), 1.5 / (0.15 + 2.5), 1e-12)
	close(-(one.current[0] as number), 1.5 / 5.15, 1e-12)
	// each bulb in parallel gets almost the full voltage (bright); in series they would share it (dim)
	const series = solve(3, [E(1, 0, 1.5, 0.15), R(1, 2, 5), R(2, 0, 5)])
	assert.ok((two.current[1] as number) > 1.8 * (series.current[1] as number))
})

test("Wheatstone bridge: balanced, no current through the middle; unbalanced, the textbook value", () => {
	// 0 = −, 1 = +, 2 = left mid, 3 = right mid
	const bridge = (rx: number) => solve(4, [E(1, 0, 10, 1e-6), R(1, 2, 100), R(2, 0, 200), R(1, 3, 100), R(3, 0, rx), R(2, 3, 50)])
	close(bridge(200).current[5] as number, 0, 1e-12, "balanced")
	// Thevenin across the middle: Vth = 10·(200/300 − 100/200) = 1.6667, Rth = 100‖200 + 100‖100 = 66.667 + 50 → I = 1.6667/166.667
	close(bridge(100).current[5] as number, (10 * (2 / 3 - 1 / 2)) / (200 / 3 + 50 + 50), 1e-6, "unbalanced")
})

test("floating circuits are solved each on its own, with no leak between them", () => {
	const s = solve(5, [E(1, 0, 1.5, 0.1), R(1, 0, 10), E(3, 2, 9, 1), R(3, 2, 100), R(4, 4, 1)])
	close(s.current[1] as number, 1.5 / 10.1, 1e-12)
	close(s.current[3] as number, 9 / 101, 1e-12)
	assert.equal(s.component[4], -1, "an unconnected node is in no component")
})

test("LED: only forward, from its knee; reversed it stays dark", () => {
	// red LED 2.0 V at 20 mA, 10 Ω: knee 1.8 V; 3 V through 100 Ω
	const led = (a: number, b: number): Branch => ({ kind: "d", a, b, g: 1 / 10, v0: 1.8 })
	const fwd = solve(3, [E(1, 0, 3, 0.3), R(1, 2, 100), led(2, 0)])
	close(fwd.current[2] as number, (3 - 1.8) / (0.3 + 100 + 10), 1e-12, "forward")
	const rev = solve(3, [E(1, 0, 3, 0.3), R(1, 2, 100), led(0, 2)])
	assert.equal(rev.current[2], 0)
	assert.equal(rev.on[2], false)
	// below the knee: off
	const low = solve(3, [E(1, 0, 1.5, 0.15), R(1, 2, 100), led(2, 0)])
	assert.equal(low.current[2], 0)
	// starting from the wrong states settles to the same answer
	const fwd2 = solve(3, [E(1, 0, 3, 0.3), R(1, 2, 100), led(2, 0)], [true, true, false])
	close(fwd2.current[2] as number, fwd.current[2] as number, 1e-15)
})

test("two LEDs in parallel, different colours: the lower knee takes it all (a red LED hogs a blue one's current)", () => {
	const s = solve(3, [E(1, 0, 4.5, 0.45), R(1, 2, 100), { kind: "d", a: 2, b: 0, g: 0.1, v0: 1.8 }, { kind: "d", a: 2, b: 0, g: 1 / 15, v0: 3.0 }])
	assert.ok((s.current[2] as number) > 0.02)
	assert.equal(s.current[3], 0)
	assert.equal(s.settled, true)
})

test("a current source with only a diode to go through turns the diode on (a solar cell with nothing on it)", () => {
	const s = solve(2, [{ kind: "j", a: 1, b: 0, i: 0.1 }, { kind: "d", a: 1, b: 0, g: 0.1, v0: 5 }])
	close((s.v[1] as number) - (s.v[0] as number), 5 + 0.1 / 0.1, 1e-12)
})

test("a branch's line: a motor's current falls with its back-EMF as 1/(R + R_Thevenin)", () => {
	// 3 V, 0.3 Ω cell, a 1.4 Ω motor with 1 V of back-EMF
	const br: Branch[] = [E(1, 0, 3, 0.3), { kind: "g", a: 1, b: 0, g: 1 / 1.4, e: 1 }]
	const s = solve(2, br)
	const line = lineOf(2, br, s, 1)
	close(line.b, 1 / 1.7, 1e-12, "b")
	close(line.a, 3 / 1.7, 1e-12, "a")
	close(s.current[1] as number, (3 - 1) / 1.7, 1e-12)
})

test("determinism: the same circuit gives the same bits", () => {
	const make = () => {
		const br: Branch[] = []
		for (let k = 0; k < 30; k++) br.push(R(k, k + 1, 1 + ((k * 7) % 11)), R(k, (k * 5) % 31, 3 + (k % 4)))
		br.push(E(30, 0, 6, 0.6), { kind: "d", a: 3, b: 17, g: 0.1, v0: 1.8 })
		return solve(31, br)
	}
	const a = make()
	const b = make()
	assert.deepEqual([...a.v], [...b.v])
	assert.deepEqual([...a.current], [...b.current])
})

test("a big circuit is quick (60 nodes, 120 branches, 1000 solves)", () => {
	const br: Branch[] = []
	for (let k = 0; k < 60; k++) br.push(R(k, (k + 1) % 60, 1 + (k % 5)), R(k, (k * 7 + 3) % 60, 2 + (k % 3)))
	br.push(E(10, 0, 4.5, 0.45))
	const t0 = performance.now()
	for (let k = 0; k < 1000; k++) solve(60, br)
	const ms = performance.now() - t0
	assert.ok(ms < 3000, `${ms} ms`)
})

// ---------------------------------------------------------------- the parts
const run = (doc: CircuitsDoc, seconds: number, input: Parameters<CircuitSim["step"]>[2] = {}, h = 1 / 480) => {
	const sim = new CircuitSim(doc)
	const n = Math.round(seconds / h)
	for (let k = 0; k <= n; k++) sim.step(k * h, k === 0 ? 0 : h, input)
	return sim
}

test("filament from a 2.5 V 0.3 A rating: a real flashlight bulb's wire, cold resistance about a thirteenth of hot", () => {
	const f = filamentOf(2.5, 0.3)
	assert.ok(f.d > 20e-6 && f.d < 50e-6, `diameter ${f.d}`)
	assert.ok(f.length > 0.005 && f.length < 0.02, `length ${f.length}`)
	const tau = (f.heat * f.tRated) / (4 * f.pRated)
	assert.ok(tau > 0.01 && tau < 0.05, `time constant ${tau}`)
	close(filamentLight(f, 2500), 1, 1e-12)
	assert.ok(filamentLight(f, ROOM_K) === 0)
})

const bulbLoop = (emf: number, r: number, extra: Partial<CircuitsDoc> = {}): CircuitsDoc => ({
	parts: [
		{ kind: "battery", id: "bat", a: "bat/+", b: "bat/-", emf, r },
		{ kind: "wire", id: "w1", a: "bat/+", b: "bulb/a", r: 0.02 },
		{ kind: "bulb", id: "bulb", a: "bulb/a", b: "bulb/b", v_rated: 2.5, i_rated: 0.3 },
		{ kind: "wire", id: "w2", a: "bulb/b", b: "bat/-", r: 0.02 }
	],
	...extra
})

test("a bulb on its rated voltage: full light within 0.1 s; the 'lights' event (a tenth of full light) within 50 ms of switching on", () => {
	// 2 AA (3 V, 0.3 Ω) + wires: the bulb gets about its 2.5 V
	const sim = run(bulbLoop(3, 0.3), 0.5)
	const r = sim.sample().get("bulb")
	assert.ok(r !== undefined)
	assert.ok((r.light ?? 0) > 0.7 && (r.light ?? 0) < 2, `light ${r.light}`)
	close(r.i, 0.3, 0.05, "about its rated current")
	const lit = sim.events.find((e) => e.kind === "lights")
	assert.ok(lit !== undefined && lit.t < 0.05, `lights at ${lit?.t}`)
})

test("one cell (1.5 V) lights the 2.5 V bulb dimly; three cells (4.5 V) brightly; 9 V burns it out", () => {
	const light = (emf: number, r: number) => run(bulbLoop(emf, r), 0.4).sample().get("bulb")?.light ?? 0
	const one = light(1.5, 0.15)
	const two = light(3, 0.3)
	const three = light(4.5, 0.45)
	assert.ok(one > LIT && one < 0.3, `one cell ${one}`)
	assert.ok(three > two * 1.5, `three ${three} two ${two}`)
	const nine = run(bulbLoop(9, 1.7), 0.4)
	assert.ok(nine.sample().get("bulb")?.broken === true, "9 V burns out a 2.5 V bulb")
	assert.ok(nine.events.some((e) => e.kind === "burns-out" && e.t < 0.1))
	assert.ok((nine.temp.get("bulb") as number) >= W_MELT)
})

test("two bulbs in series are dimmer than one; in parallel each is as bright as one alone", () => {
	const series: CircuitsDoc = {
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "-", emf: 3, r: 0.3 },
			{ kind: "bulb", id: "b1", a: "+", b: "m", v_rated: 2.5, i_rated: 0.3 },
			{ kind: "bulb", id: "b2", a: "m", b: "-", v_rated: 2.5, i_rated: 0.3 }
		]
	}
	const parallel: CircuitsDoc = {
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "-", emf: 3, r: 0.3 },
			{ kind: "bulb", id: "b1", a: "+", b: "-", v_rated: 2.5, i_rated: 0.3 },
			{ kind: "bulb", id: "b2", a: "+", b: "-", v_rated: 2.5, i_rated: 0.3 }
		]
	}
	const one = run(bulbLoop(3, 0.3), 0.4).sample().get("bulb")?.light ?? 0
	const s = run(series, 0.4).sample().get("b1")?.light ?? 0
	const p = run(parallel, 0.4).sample().get("b1")?.light ?? 0
	assert.ok(s < one * 0.2, `series ${s} vs one ${one}`)
	assert.ok(p > one * 0.6, `parallel ${p} vs one ${one} (the cell's 0.3 Ω takes a little)`)
})

test("switch: open, nothing; closed at 1 s by its flip, the bulb lights then; press switch closes under a 0.5 N push", () => {
	const doc: CircuitsDoc = {
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "-", emf: 3, r: 0.3 },
			{ kind: "switch", id: "sw", a: "+", b: "s", closed: false, r: 0.02, flips: [1] },
			{ kind: "bulb", id: "bulb", a: "s", b: "-", v_rated: 2.5, i_rated: 0.3 }
		]
	}
	const sim = run(doc, 1.5)
	const lit = sim.events.find((e) => e.kind === "lights")
	assert.ok(lit !== undefined && lit.t >= 1 && lit.t < 1.05, `lights at ${lit?.t}`)
	assert.ok(sim.events.some((e) => e.kind === "closes" && Math.abs(e.t - 1) < 0.003))
	const press: CircuitsDoc = {
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "-", emf: 3, r: 0.3 },
			{ kind: "switch", id: "sw", a: "+", b: "s", closed: false, r: 0.02, press: { solid: "sw/button", force: 0.5 } },
			{ kind: "bulb", id: "bulb", a: "s", b: "-", v_rated: 2.5, i_rated: 0.3 }
		]
	}
	assert.equal(run(press, 0.3, { press: () => 0.3 }).sample().get("bulb")?.light ?? 0, 0, "0.3 N is not enough")
	assert.ok((run(press, 0.3, { press: () => 0.6 }).sample().get("bulb")?.light ?? 0) > 0.5)
})

test("LED: lights with a resistor; reversed it stays dark; with no resistor on 4.5 V it burns out", () => {
	const led = (flip: boolean, r: number, emf = 3): CircuitsDoc => ({
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "-", emf, r: emf / 10 },
			{ kind: "resistor", id: "res", a: "+", b: "m", r },
			{ kind: "led", id: "led", a: flip ? "-" : "m", b: flip ? "m" : "-", vf: 2.0, i_rated: 0.02, rs: 10, i_max: 0.1 }
		]
	})
	const ok = run(led(false, 47), 0.3).sample().get("led")
	assert.ok(ok !== undefined && (ok.light ?? 0) > 0.8 && (ok.light ?? 0) < 1.3, `light ${ok?.light}`)
	assert.equal(run(led(true, 47), 0.3).sample().get("led")?.light, 0)
	const blown = run(led(false, 0.01, 4.5), 0.3)
	assert.equal(blown.sample().get("led")?.broken, true)
})

test("dimmer: turning it up from 0.5 Ω to 30 Ω over 1 s dims the bulb to dark", () => {
	const doc: CircuitsDoc = {
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "-", emf: 3, r: 0.3 },
			{ kind: "resistor", id: "dim", a: "+", b: "m", r: 0.5, turn: { r: 30, from: 0.5, to: 1.5 } },
			{ kind: "bulb", id: "bulb", a: "m", b: "-", v_rated: 2.5, i_rated: 0.3 }
		]
	}
	const sim = new CircuitSim(doc)
	const lights: number[] = []
	for (let k = 0; k <= 960; k++) {
		sim.step(k / 480, k === 0 ? 0 : 1 / 480, {})
		if (k % 96 === 0) lights.push(sim.sample().get("bulb")?.light ?? 0)
	}
	for (let k = 3; k < lights.length; k++) assert.ok((lights[k] as number) <= (lights[k - 1] as number) + 1e-9, `${lights}`)
	assert.ok(sim.events.some((e) => e.kind === "goes-out"))
})

test("buzzer sounds from its minimum voltage", () => {
	const doc = (emf: number): CircuitsDoc => ({
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "-", emf, r: 0.3 },
			{ kind: "buzzer", id: "bz", a: "+", b: "-", r: 100, v_min: 2, v_rated: 3, pitch: 2300 }
		]
	})
	assert.equal(run(doc(1.5), 0.1).sample().get("bz")?.sound, 0)
	const on = run(doc(3), 0.1)
	assert.ok((on.sample().get("bz")?.sound ?? 0) > 0.9)
	assert.ok(on.events.some((e) => e.kind === "sounds" && e.text.includes("2300")))
})

test("motor: its line gives the stall current at rest and the no-load speed where it crosses zero; loaded by the shaft's speed", () => {
	// a 130-size motor (k 2.9e-3 V·s/rad, 1.4 Ω) on 3 V with 0.3 Ω inside: stall I = 3/1.7, no-load ω = 3/k
	const doc: CircuitsDoc = {
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "-", emf: 3, r: 0.3 },
			{ kind: "motor", id: "m", a: "+", b: "-", k: 2.9e-3, r: 1.4, rotor: "m/paddle" }
		]
	}
	const sim = new CircuitSim(doc)
	sim.step(0, 0, { omega: () => 0 })
	const l0 = sim.line("m")
	assert.ok(l0 !== undefined)
	close(l0.a, 3 / 1.7, 1e-12, "stall current")
	close(l0.b, 1 / 1.7, 1e-12, "1/(R + r)")
	close(l0.a / (l0.b * 2.9e-3), 3 / 2.9e-3, 1e-6, "no-load speed")
	sim.step(1 / 480, 1 / 480, { omega: () => 500 })
	close(sim.sample().get("m")?.i ?? 0, (3 - 2.9e-3 * 500) / 1.7, 1e-12, "current at 500 rad/s")
	// reversed battery: the current (and so the torque) the other way
	const rev = new CircuitSim({ parts: [{ kind: "battery", id: "bat", a: "-", b: "+", emf: 3, r: 0.3 }, doc.parts[1] as CircuitsDoc["parts"][number]] })
	rev.step(0, 0, { omega: () => 0 })
	assert.ok((rev.line("m")?.a ?? 0) < 0)
	// an open circuit: no line at all
	const open = new CircuitSim({ parts: [{ kind: "battery", id: "bat", a: "+", b: "-", emf: 3, r: 0.3 }, { kind: "switch", id: "sw", a: "+", b: "x", closed: false, r: 0.02 }, { kind: "motor", id: "m", a: "x", b: "-", k: 2.9e-3, r: 1.4 }] })
	open.step(0, 0, {})
	assert.equal(open.line("m")?.b, 0)
})

test("generator: turned at 9.4 rad/s with k 0.4 V·s/rad and 6 Ω, it lights a 2.5 V bulb", () => {
	const doc: CircuitsDoc = {
		parts: [
			{ kind: "generator", id: "gen", a: "+", b: "-", k: 0.4, r: 6, speed: 9.4, from: 0 },
			{ kind: "bulb", id: "bulb", a: "-", b: "+", v_rated: 2.5, i_rated: 0.3 }
		]
	}
	const sim = run(doc, 0.4, { omega: () => 9.4 })
	assert.ok((sim.sample().get("bulb")?.light ?? 0) > 0.2, `light ${sim.sample().get("bulb")?.light}`)
	const still = run(doc, 0.4, { omega: () => 0 })
	assert.equal(still.sample().get("bulb")?.light, 0)
})

test("tester probes: a coin (cupronickel) conducts, an eraser (rubber) does not", () => {
	const doc: CircuitsDoc = {
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "-", emf: 3, r: 0.3 },
			{ kind: "bulb", id: "bulb", a: "+", b: "p", v_rated: 2.5, i_rated: 0.3 },
			{ kind: "probe", id: "t", a: "p", b: "-", contacts: ["t/left", "t/right"] }
		],
		resistivity: { cupronickel: 3.8e-7, "solid rubber": 1e13 }
	}
	const coin = run(doc, 0.3, { bridge: () => ({ item: "coin", material: "cupronickel", length: 0.02, area: 1.75e-3 * 0.024 }) })
	assert.ok((coin.sample().get("bulb")?.light ?? 0) > 0.5)
	assert.ok(coin.events.some((e) => e.kind === "conducts"))
	const eraser = run(doc, 0.3, { bridge: () => ({ item: "eraser", material: "solid rubber", length: 0.02, area: 0.01 * 0.02 }) })
	assert.equal(eraser.sample().get("bulb")?.light, 0)
	assert.ok(eraser.events.some((e) => e.kind === "insulates"))
	const nothing = run(doc, 0.3, {})
	assert.equal(nothing.sample().get("bulb")?.light, 0)
})

test("solar panel: full sun runs a buzzer; a tenth of the sun gives a tenth of the current into a short", () => {
	const panel = (load: CircuitsDoc["parts"][number]): CircuitsDoc => ({
		parts: [
			{ kind: "solar", id: "pv", a: "+", b: "-", isc: 0.11, v_knee: 5, g_d: 0.1, rsh: 500, rs: 1, face: { solid: "pv/face", at: { x: 0, y: 0 }, normal: { x: 0, y: 1 }, width: 0.08 } },
			load
		]
	})
	const short = (irr: number) => run(panel({ kind: "meter", id: "A", a: "+", b: "-", mode: "amps", r: 0.1 }), 0.05, { irradiance: () => irr }).sample().get("A")?.reads ?? 0
	close(short(1000), 0.11 * (500 / 501.1), 1e-4, "short-circuit current")
	close(short(100) / short(1000), 0.1, 1e-6, "proportional")
	const open = run(panel({ kind: "meter", id: "V", a: "+", b: "-", mode: "volts", r: 1e7 }), 0.05, { irradiance: () => 1000 }).sample().get("V")?.reads ?? 0
	close(open, (0.11 + 0.1 * 5) / (0.1 + 1 / 500 + 1 / 1e7), 1e-6, "open-circuit voltage")
	const dark = run(panel({ kind: "meter", id: "V", a: "+", b: "-", mode: "volts", r: 1e7 }), 0.05, { irradiance: () => 0 }).sample().get("V")?.reads ?? 1
	close(dark, 0, 1e-9)
})

test("a wire pulled longer than itself comes off: the bulb goes out and the event says so", () => {
	const doc: CircuitsDoc = {
		...bulbLoop(3, 0.3),
		parts: bulbLoop(3, 0.3).parts.map((p) => (p.id === "w1" ? { ...p, length: 0.3 } : p))
	}
	let x = 0.1
	const sim = new CircuitSim(doc)
	for (let k = 0; k <= 480; k++) {
		if (k > 240) x += 0.002
		sim.step(k / 480, k === 0 ? 0 : 1 / 480, { terminal: (name) => (name === "bat/+" ? { x: 0, y: 0 } : name === "bulb/a" ? { x, y: 0 } : undefined) })
	}
	assert.ok(sim.events.some((e) => e.kind === "pulled-off"))
	assert.ok(sim.events.some((e) => e.kind === "goes-out"))
	assert.equal(sim.sample().get("w1")?.broken, true)
})

test("a short circuit is reported", () => {
	const doc: CircuitsDoc = { parts: [{ kind: "battery", id: "bat", a: "+", b: "-", emf: 1.5, r: 0.15 }, { kind: "wire", id: "w", a: "+", b: "-", r: 0.02 }] }
	const sim = run(doc, 0.05)
	assert.ok(sim.events.some((e) => e.kind === "short"))
})

test("nothing in the solve is NaN for odd values (zero-length loops, huge and tiny resistances, all open)", () => {
	const doc: CircuitsDoc = {
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "+", emf: 9, r: 1e-6 },
			{ kind: "resistor", id: "r1", a: "+", b: "-", r: 1e12 },
			{ kind: "resistor", id: "r2", a: "-", b: "x", r: 1e-9 },
			{ kind: "switch", id: "sw", a: "x", b: "+", closed: false, r: 0.02 },
			{ kind: "led", id: "led", a: "x", b: "y", vf: 2, i_rated: 0.02, rs: 10, i_max: 0.1 }
		]
	}
	const sim = run(doc, 0.1)
	for (const [, r] of sim.sample()) {
		assert.ok(Number.isFinite(r.i) && Number.isFinite(r.v))
	}
})

test("a bulb's life: far over its rated voltage it wears through in seconds; at 1.5 times it lasts minutes", () => {
	const loop = (rating: [number, number], emf: number, r: number): CircuitsDoc => ({
		parts: [
			{ kind: "battery", id: "bat", a: "+", b: "-", emf, r },
			{ kind: "bulb", id: "bulb", a: "+", b: "-", v_rated: rating[0], i_rated: rating[1] }
		]
	})
	// a 3.8 V bulb on a fresh 9 V battery (about 2.2 times its voltage): burns out within a few seconds, not at once
	const hot = run(loop([3.8, 0.3], 9.48, 1.7), 6)
	const out = hot.events.find((e) => e.kind === "burns-out")
	assert.ok(out !== undefined && out.t > 0.2 && out.t < 6, `burns out at ${out?.t}`)
	// a 6 V 0.06 A bulb on it (about 1.55 times): lasts the run
	const ok = run(loop([6, 0.06], 9.48, 1.7), 6)
	assert.equal(ok.sample().get("bulb")?.broken, undefined)
	// at its rated voltage it wears a few millionths of its life in a second
	const fine = run(loop([2.5, 0.3], 2.5, 1e-6), 1)
	assert.ok((fine.wear.get("bulb") ?? 1) < 1e-4, `${fine.wear.get("bulb")}`)
})

test("a coil: its EMF (+ at a) drives current against the change; a conductor and a galvanometer are admitted and conduct", async () => {
	const { admitCircuits } = await import("../tooling/src/sim/circuits.ts")
	const doc: CircuitsDoc = {
		parts: [
			{ kind: "coil", id: "k", a: "k/+", b: "k/-", r: 6, turns: 200 },
			{ kind: "meter", id: "g", a: "k/+", b: "k/-", mode: "galvanometer", r: 50, fs: 0.0005 }
		]
	}
	const sim = new CircuitSim(doc)
	// (an EMF of +0.56 V with + at a: the loop's current flows out of a, through the galvanometer a→b, back into b: against the coil a→b)
	sim.step(0, 0, { emf: () => 0.56 })
	const k = sim.sample().get("k")
	const g = sim.sample().get("g")
	close(k?.i ?? 0, -0.56 / 56, 1e-12, "coil current a→b")
	close(g?.reads ?? 0, 0.56 / 56, 1e-12, "galvanometer reading")
	close(k?.emf ?? 0, 0.56, 0, "its EMF reading")
	const c = new CircuitSim({ parts: [{ kind: "battery", id: "b", a: "+", b: "-", emf: 3, r: 0.5 }, { kind: "conductor", id: "s", a: "+", b: "-", r: 0.0025, field: { solid: "s", from: { x: 0, y: 0, z: 0.15 }, to: { x: 0, y: 0, z: -0.15 } } }] })
	c.step(0, 0, {})
	close(c.sample().get("s")?.i ?? 0, 3 / 0.5025, 1e-9, "a straight wire across a battery")
	assert.doesNotThrow(() => admitCircuits({ parts: [...doc.parts, { kind: "conductor", id: "s", a: "x", b: "y", r: 0.0025, field: { solid: "w", from: { x: 0, y: 0, z: 0.1 }, to: { x: 0, y: 0, z: -0.1 } } }] }, new Set(["w"])))
	assert.throws(() => admitCircuits({ parts: [{ kind: "coil", id: "k", a: "a", b: "b", r: 0, turns: 10 }] }, new Set()), /r is 0/)
	assert.throws(() => admitCircuits({ parts: [{ kind: "coil", id: "k", a: "a", b: "b", r: 1, turns: 10, induce: { solid: "nope", at: { x: 0, y: 0 }, axis: 0, radius: 0.02, length: 0.06 } }] }, new Set()), /induce.solid/)
	assert.throws(() => admitCircuits({ parts: [{ kind: "meter", id: "m", a: "a", b: "b", r: 1, mode: "ohms" }] } as unknown as CircuitsDoc, new Set()), /mode must be/)
})
