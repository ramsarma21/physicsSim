// The circuits module against real reference values (tooling/src/sim/circuits.ts, circuit-solver.ts, modules/circuits.ts; machines/mod_circuits.py
// and its port web/sim/modules/circuits.js build the scenes). Each section builds scenes through web/sim (the exact port of the Python builder),
// runs them in the engine (the server's: the bundle's math in node) and checks what the circuit does against textbook physics and data sheets:
//   loop      a complete loop lights the bulb; an open one carries exactly no current (4-PS3-4, ENE4-060/061)
//   cells     one AA vs two on a 2.5 V 0.3 A bulb; a run-down battery (ENE5-003/004)
//   lamp      the filament against the IES lamp law: I ∝ V^0.55, P ∝ V^1.55, light ∝ V^3.4 near its rating; cold/hot resistance; warm-up time;
//             its life (∝ V^-13): far over its voltage it burns out
//   materials conductors and insulators across a tester (ENE4-066): metals light the bulb, rubber, wood, glass and plastic carry < 1 nA
//   kirchhoff series and parallel bulbs: one current round a series loop, branch currents adding up, voltages round each loop (ENE-054..056)
//   ohm       a 10 Ω resistor on 2 x AA with an ammeter: I = emf / (R + r + R_meter + R_wires); doubling R halves I (ENE-051..053)
//   doorbell  a push switch pressed for half a second sounds the buzzer for that half second, at about 25 mA (ENE5-014)
//   motor     a hobby motor's no-load speed and stall current against Mabuchi FA-130 data; a geared motor turning a disc spins up with the time
//             constant J·R/(η·k²) of DC-motor theory; swapping the wires reverses it (ENE4-071)
//   fan       a battery fan's propeller blows a ping-pong ball along the table
//   short     a wire across one AA: I = emf / (r + R_wire), and the event says so
//   led       a red LED on 2 x AA with 68 Ω: (V − Vf)/R ≈ 17 mA, lit; with no resistor it burns out; reversed it stays dark
//   solar     a panel's current ∝ the light on it: a lamp at 15 cm and at 40 cm (1/d²); shaded, it stops
//   generator a hand generator's EMF ∝ its speed (Faraday)
//   wire      a wire's resistance is 0.053 Ω/m (22 AWG copper); pulled farther apart than its length, it comes off
//   fuzz      random netlists (opens, shorts, parallel LEDs, reversed parts, 0-6 cells): no NaN, Kirchhoff's current law at every node to 1e-9 A,
//             the same answer twice
//   lamplight a desk lamp shining on a solar panel indoors (sun 0) runs a solar motor: the light the optics module traces, band by band as
//             silicon takes it; the optics sun at 1000 W/m² overhead reads 1000 W/m² of sunlight; wires named by item only close the loop
//   oersted   a straight wire's field: 40 µT 1 cm from 2 A (μ0·I/2πr, Biot–Savart for its length); a compass behind it swings to where the
//             wire's field at its poles and the Earth's balance (tan θ = B_wire/B_earth), and back the other way with the current reversed
//   induction a coil's flux from a small magnet on its axis against the dipole's exact Φ = μ0·m·R²/(2(R² + z²)^1.5); its EMF against dλ/dt
//             of that formula for a magnet moving at a steady speed (Faraday); a magnet dropped through a coil: ∫EMF dt = Δλ, the current
//             against the change (Lenz), twice the turns twice the voltage, a galvanometer's needle swings and settles at I/I_full
//   magnetize a wired electromagnet: the circuit's current is the magnetism module's coil current; it holds paper clips while switched on and
//             lets them go when the switch opens
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-circuits.ts [section ...|all]     exits 1 on any failure
import { pathToFileURL } from "node:url"
import { solve, type Branch } from "../tooling/src/sim/circuit-solver.ts"
import { CircuitSim, type CircuitsDoc } from "../tooling/src/sim/circuits.ts"
import { coilSamples, fluxThrough, magnetsOf, segmentField } from "../tooling/src/sim/circuits-em.ts"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
type Sim = { doc: { processes?: { kind: string; parts: { id: string; kind: string; r?: number; length?: number }[] }[] }; track: { frames: { t: number }[]; state?: Record<string, Record<string, number[]>> }; summary: { goals: { ok: boolean; label: string }[]; happenings?: { t: number; text: string; kind?: string; items: string[] }[] } }
const web = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as {
	prepare: (s: unknown) => { scene: unknown; doc: unknown; resolved: unknown }
	finish: (s: unknown, d: unknown, r: unknown, t: unknown) => { summary: Sim["summary"] }
	modulesReady?: Promise<unknown>
}
const { run } = (await import(pathToFileURL(`${PG}/tools/engine-worker-entry.ts`).href)) as { run: (doc: unknown, fps: number) => Sim["track"] }

let failed = 0
let passed = 0
const check = (ok: boolean, what: string, detail = "") => {
	if (ok) passed++
	else failed++
	console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
}
const near = (a: number, b: number, rel: number) => Math.abs(a - b) <= rel * Math.abs(b)
const f3 = (v: number | undefined) => (v === undefined || v === null ? "—" : Number(v).toPrecision(4))

const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
type Item = { id: string; type: string; name?: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; fixed?: boolean; held?: boolean }
const W = (id: string, a: string | null, ae: string, b: string | null, be: string, extra: Record<string, unknown> = {}): Item => ({ id, type: "wire", name: id, x: 0, y: 0, props: { ...(a ? { a } : {}), a_end: ae, ...(b ? { b } : {}), b_end: be, ...extra } })
const scene = (items: Item[], seconds = 2, goals: unknown[] = []) => ({ version: 2, id: "v", name: "v", seconds, release: 0.5, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })
const go = (s: ReturnType<typeof scene>) => {
	const p = web.prepare(s)
	const track = JSON.parse(JSON.stringify(run(p.doc, 120))) as Sim["track"]
	const { summary } = web.finish(p.scene, p.doc, p.resolved, track)
	const at = (item: string, key: string) => track.state?.[item]?.[key] ?? []
	const end = (item: string, key: string) => at(item, key).at(-1) as number
	return { doc: p.doc as Sim["doc"], track, summary, at, end }
}
const BAT = (id: string, x: number, props: Record<string, unknown> = {}): Item => ({ id, type: "battery", name: id, x, y: 0.01025, props })
const PART = (id: string, type: string, x: number, props: Record<string, unknown> = {}, y = 0.006): Item => ({ id, type, name: id, x, y, props })

const sections: Record<string, () => void> = {
	loop() {
		const closed = go(scene([BAT("bat", 0.8, { cells: 1 }), PART("bulb", "bulb", 1.0), W("w1", "bat", "+", "bulb", "+"), W("w2", "bulb", "-", "bat", "-")]))
		check(closed.end("bulb", "light") >= 0.1 && closed.end("bulb", "current") > 0.1, "C1 a complete loop: one AA lights the 2.5 V bulb", `light ${f3(closed.end("bulb", "light"))}, ${f3(closed.end("bulb", "current"))} A`)
		const open = go(scene([BAT("bat", 0.8, { cells: 1 }), PART("bulb", "bulb", 1.0), W("w1", "bat", "+", "bulb", "+"), W("w2", "bulb", "-", null, "-")]))
		check(open.end("bulb", "current") === 0 && open.end("bulb", "light") === 0 && open.at("bulb", "current").every((v) => v === 0), "C1 one wire end off the battery: exactly no current, the bulb dark", `${open.end("bulb", "current")} A`)
	},
	cells() {
		// [ENR] alkaline AA: 1.58 V fresh, about 0.2 Ω; [IES] I ∝ V^0.55, light ∝ V^3.4 (2.5 V 0.3 A bulb)
		const one = go(scene([BAT("bat", 0.8, { cells: 1 }), PART("bulb", "bulb", 1.0), W("w1", "bat", "+", "bulb", "+"), W("w2", "bulb", "-", "bat", "-")]))
		const v1 = one.end("bulb", "voltage")
		check(v1 > 1.4 && v1 < 1.58, "C2 one AA: the bulb gets about 1.45-1.55 V (the cell's 0.2 Ω takes a little)", `${f3(v1)} V`)
		check(near(one.end("bulb", "current"), 0.3 * (v1 / 2.5) ** 0.55, 0.08), "C2 one AA: its current is the lamp law's 0.3 A x (V/2.5)^0.55 within 8 %", `${f3(one.end("bulb", "current"))} A vs ${f3(0.3 * (v1 / 2.5) ** 0.55)}`)
		check(near(one.end("bulb", "light"), (v1 / 2.5) ** 3.4, 0.3) && one.end("bulb", "light") >= 0.1, "C2 one AA: a dull glow, the lamp law's (V/2.5)^3.4 within 30 %", `${f3(one.end("bulb", "light"))} vs ${f3((v1 / 2.5) ** 3.4)}`)
		const two = go(scene([BAT("bat", 0.8, { cells: 2 }), PART("bulb", "bulb", 1.0), W("w1", "bat", "+", "bulb", "+"), W("w2", "bulb", "-", "bat", "-")]))
		const v2 = two.end("bulb", "voltage")
		check(v2 > 2.8 && v2 < 3.16 && two.end("bulb", "light") > 1.2, "C2 two AA: about 2.9-3.1 V and brighter than rated", `${f3(v2)} V, light ${f3(two.end("bulb", "light"))}`)
		check(two.end("bulb", "light") > 5 * one.end("bulb", "light"), "C2 two cells light it far more than one", `${f3(two.end("bulb", "light"))} vs ${f3(one.end("bulb", "light"))}`)
		// [ENR] a run-down AA: 1.1 V near empty (10 %), r about doubled: the torch dims steeply (spec C8: light × about 0.3)
		const flat = go(scene([BAT("bat", 0.8, { cells: 2, charge_pct: 10 }), PART("bulb", "bulb", 1.0), W("w1", "bat", "+", "bulb", "+"), W("w2", "bulb", "-", "bat", "-")]))
		const ratio = flat.end("bulb", "light") / two.end("bulb", "light")
		check(ratio > 0.15 && ratio < 0.4, "C8 a run-down battery (10 %): the bulb's light falls to about a quarter or a third", `x ${f3(ratio)}`)
	},
	lamp() {
		// a 2.5 V 0.3 A bulb on an ideal source at 0.6-1.4 x its voltage: the IES exponents (current 0.55-0.6, power 1.55-1.6, light 3.4)
		const pts: { v: number; i: number; light: number }[] = []
		for (const k of [0.7, 0.85, 1.0, 1.15, 1.3]) {
			const sim = new CircuitSim({ parts: [{ kind: "battery", id: "src", a: "+", b: "-", emf: 2.5 * k, r: 1e-6 }, { kind: "bulb", id: "b", a: "+", b: "-", v_rated: 2.5, i_rated: 0.3 }] })
			for (let s = 0; s <= 480; s++) sim.step(s / 480, s ? 1 / 480 : 0, {})
			const r = sim.sample().get("b")
			pts.push({ v: r?.v ?? 0, i: r?.i ?? 0, light: r?.light ?? 0 })
		}
		const slope = (f: (p: (typeof pts)[number]) => number) => {
			const xs = pts.map((p) => Math.log(p.v))
			const ys = pts.map((p) => Math.log(f(p)))
			const mx = xs.reduce((a, b) => a + b) / xs.length
			const my = ys.reduce((a, b) => a + b) / ys.length
			return xs.reduce((a, x, i) => a + (x - mx) * ((ys[i] as number) - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0)
		}
		const si = slope((p) => p.i)
		const sp = slope((p) => p.i * p.v)
		const sl = slope((p) => p.light)
		check(si > 0.5 && si < 0.62, "lamp law: current ∝ V^0.55-0.6 (IES)", `exponent ${f3(si)}`)
		check(sp > 1.5 && sp < 1.62, "lamp law: power ∝ V^1.55-1.6 (IES)", `exponent ${f3(sp)}`)
		check(sl > 3.0 && sl < 4.2, "lamp law: light ∝ V^3.4 (IES; the model 3.4 x the filament's own law, about 3.5-3.9 here)", `exponent ${f3(sl)}`)
		check(near(pts[2]?.i ?? 0, 0.3, 0.02) && near(pts[2]?.light ?? 0, 1, 0.05), "the bulb at its rated 2.5 V takes 0.30 A and gives its full light", `${f3(pts[2]?.i)} A, light ${f3(pts[2]?.light)}`)
		// cold resistance: tungsten's ρ rises about 13 x from 293 K to 2500 K (CRC; Desai 1984), so the inrush is about 10-15 x the running current
		const sim = new CircuitSim({ parts: [{ kind: "battery", id: "src", a: "+", b: "-", emf: 2.5, r: 1e-6 }, { kind: "bulb", id: "b", a: "+", b: "-", v_rated: 2.5, i_rated: 0.3 }] })
		sim.step(0, 0, {})
		const inrush = sim.sample().get("b")?.i ?? 0
		check(inrush / 0.3 > 10 && inrush / 0.3 < 16, "a cold filament takes 10-15 x its running current (tungsten: hot R / cold R about 13)", `inrush ${f3(inrush)} A, ${f3(inrush / 0.3)} x`)
		let t90 = -1
		for (let s = 1; s <= 480 && t90 < 0; s++) {
			sim.step(s / 480, 1 / 480, {})
			if ((sim.sample().get("b")?.light ?? 0) >= 0.9) t90 = s / 480
		}
		check(t90 > 0.01 && t90 < 0.12, "warm-up: a torch bulb reaches 90 % of its light in a few hundredths of a second", `${f3(t90)} s`)
		// life: far over its voltage a bulb burns out; a 3.8 V bulb on a 9 V battery within seconds, a 6 V one lasts (life ∝ V^-13, IES)
		const life = (rating: string) => go(scene([BAT("bat", 0.8, { kind: "9V" }), PART("bulb", "bulb", 1.0, { rating }), W("w1", "bat", "+", "bulb", "+"), W("w2", "bulb", "-", "bat", "-")], 6))
		const a = life("3.8V 0.3A")
		const b = life("6V 0.06A")
		const c = life("2.5V 0.3A")
		check(a.end("bulb", "broken") === 1 && (a.summary.happenings ?? []).some((e) => e.kind === "burns-out" && e.t > 0.5 && e.t < 6), "a 3.8 V bulb on a 9 V battery wears through within seconds", (a.summary.happenings ?? []).filter((e) => e.kind === "burns-out").map((e) => `${e.t} s ${e.text}`).join("; "))
		check(b.end("bulb", "broken") === 0 && b.end("bulb", "light") > 1, "a 6 V 0.06 A bulb on the 9 V battery lasts the run, bright", `light ${f3(b.end("bulb", "light"))}`)
		check(c.end("bulb", "broken") === 1 && (c.summary.happenings ?? []).some((e) => e.kind === "burns-out" && e.t < 0.6), "a 2.5 V bulb on 9 V burns out at once (its filament melts: 3695 K)", (c.summary.happenings ?? []).filter((e) => e.kind === "burns-out").map((e) => `${e.t} s`).join("; "))
	},
	materials() {
		// [CRC] metals 1e-8-1e-6 Ω·m conduct; rubber, wood, glass and plastics (1e10-1e16) are insulators: under 1 nA through the tester
		// (a ball sits in the gap between the probes, touching both edges: a 12 mm gap for a 16 mm marble or a 25 mm steel ball; flat things lie across 15 mm)
		const test = (type: string, props: Record<string, unknown> = {}, gap = 0.015, y = 0.06) =>
			go(scene([BAT("bat", 0.6), PART("bulb", "bulb", 0.8), PART("t", "tester", 1.05, { gap }), { id: "obj", type, name: type, x: 1.05, y, props }, W("w1", "bat", "+", "bulb", "+"), W("w2", "bulb", "-", "t", "+"), W("w3", "t", "-", "bat", "-")], 2.5))
		const ref = go(scene([BAT("bat", 0.6), PART("bulb", "bulb", 0.8), W("w1", "bat", "+", "bulb", "+"), W("w2", "bulb", "-", "bat", "-")], 2.5)).end("bulb", "light")
		for (const type of ["coin-flat", "steel-ball", "steel-weight-1kg"]) {
			const r = test(type)
			check(r.end("t", "conducts") === 1 && r.end("bulb", "light") > 0.9 * ref, `C3 ${type} (metal) across the tester lights the bulb fully`, `light ${f3(r.end("bulb", "light"))} vs ${f3(ref)} with a plain wire`)
		}
		for (const type of ["eraser", "wooden-block", "glass-marble", "lego-brick", "ruler"]) {
			const r = type === "glass-marble" ? test(type, {}, 0.012, 0.03) : test(type)
			const touched = (r.summary.happenings ?? []).some((e) => e.kind === "insulates")
			check(r.end("t", "conducts") === 0 && r.end("bulb", "light") === 0 && Math.max(...r.at("t", "current")) < 1e-9 && touched, `C3 ${type} (insulator) across the tester: under 1 nA, the bulb dark`, `${f3(Math.max(...r.at("t", "current")))} A${touched ? "" : " (it never lay across both probes)"}`)
		}
	},
	kirchhoff() {
		const s = go(scene([BAT("bat", 0.6), PART("b1", "bulb", 0.8), PART("b2", "bulb", 1.0), W("w1", "bat", "+", "b1", "+"), W("w2", "b1", "-", "b2", "+"), W("w3", "b2", "-", "bat", "-")]))
		const i1 = s.end("b1", "current")
		const i2 = s.end("b2", "current")
		const ib = s.end("bat", "current")
		check(Math.abs(i1 - i2) < 2e-5 && Math.abs(i1 - ib) < 2e-5, "C4 series: one current round the loop (to the track's 1e-5)", `${i1} ${i2} ${ib} A`)
		// Kirchhoff's voltage law round the loop: the battery's terminal voltage = the bulbs' voltages + I × each wire's resistance
		const rec = s.doc.processes?.find((x) => x.kind === "circuit")
		const wiresR = (rec?.parts ?? []).filter((x) => x.kind === "wire").reduce((acc, x) => acc + (x.r ?? 0), 0)
		const vs = s.end("b1", "voltage") + s.end("b2", "voltage") + i1 * wiresR
		check(Math.abs(vs - s.end("bat", "voltage")) < 5e-5, "C4 series: round the loop, the bulbs' voltages and the wires' drops add up to the battery's (to the track's 1e-5)", `${f3(vs)} vs ${f3(s.end("bat", "voltage"))} V`)
		const one = go(scene([BAT("bat", 0.6), PART("b1", "bulb", 0.8), W("w1", "bat", "+", "b1", "+"), W("w2", "b1", "-", "bat", "-")]))
		check(s.end("b1", "light") < 0.3 * one.end("b1", "light"), "C4 series: each bulb far dimmer than one alone", `${f3(s.end("b1", "light"))} vs ${f3(one.end("b1", "light"))}`)
		const p = go(scene([BAT("bat", 0.6), PART("p1", "bulb", 0.8), PART("p2", "bulb", 1.0), W("w1", "bat", "+", "p1", "+"), W("w2", "p1", "-", "bat", "-"), W("w3", "bat", "+", "p2", "+"), W("w4", "p2", "-", "bat", "-")]))
		const sum = p.end("p1", "current") + p.end("p2", "current")
		check(Math.abs(sum - p.end("bat", "current")) < 3e-5, "C4 parallel: the battery's current is the branches' sum", `${f3(sum)} vs ${f3(p.end("bat", "current"))} A`)
		check(p.end("p1", "voltage") > 2.7 && p.end("p1", "light") > 0.6 * one.end("b1", "light"), "C4 parallel: each bulb gets nearly the full voltage and is about as bright as one alone", `${f3(p.end("p1", "voltage"))} V, light ${f3(p.end("p1", "light"))}`)
	},
	ohm() {
		const run2 = (ohms: number) => go(scene([BAT("bat", 0.6), PART("r", "resistor", 0.8, { ohms }), { id: "A", type: "meter", name: "A", x: 1.0, y: 0.075, props: { mode: "amps" } }, W("w1", "bat", "+", "r", "+"), W("w2", "r", "-", "A", "+"), W("w3", "A", "-", "bat", "-")]))
		const a = run2(10)
		const rec = a.doc.processes?.find((x) => x.kind === "circuit")
		const wires = (rec?.parts ?? []).filter((x) => x.kind === "wire").reduce((acc, x) => acc + (x.r ?? 0), 0)
		const expect = 3.16 / (10 + 0.4 + 0.1 + wires)
		check(near(a.end("A", "reading"), expect, 1e-4), "C5 Ohm's law: I = 3.16 V / (10 Ω + 0.4 Ω inside + 0.1 Ω meter + the wires)", `${f3(a.end("A", "reading"))} vs ${f3(expect)} A`)
		const b = run2(20)
		check(near(b.end("A", "reading") / a.end("A", "reading"), 0.5, 0.03), "C5 doubling the resistance about halves the current", `x ${f3(b.end("A", "reading") / a.end("A", "reading"))}`)
	},
	doorbell() {
		const s = go(scene([BAT("bat", 0.6), PART("push", "switch", 0.8, { style: "push", press_from: 1.0, press_to: 1.5 }), PART("bz", "buzzer", 1.0), W("w1", "bat", "+", "push", "+"), W("w2", "push", "-", "bz", "+"), W("w3", "bz", "-", "bat", "-")]))
		const T = s.track.frames.map((f) => f.t)
		const on = s.at("bz", "sound").map((v, i) => [T[i] as number, v] as const)
		check(on.every(([t, v]) => (t >= 1.0 && t < 1.5 ? v > 0 : v === 0)), "C6 doorbell: it sounds exactly while pressed (1.0-1.5 s)")
		const i = Math.max(...s.at("bz", "current"))
		check(i > 0.02 && i < 0.032, "C6 its current is about 25 mA (a 3 V active buzzer: 15-30 mA)", `${f3(i * 1000)} mA`)
		check((s.summary.happenings ?? []).some((e) => e.text.includes("sounds (2700 Hz)") && Math.abs(e.t - 1) < 0.01), "C6 the event: the buzzer sounds at 1.00 s")
	},
	motor() {
		// [MAB] FA-130 at 3 V: 9100 rpm, 0.2 A with no load; 2.2 A stalled. On a stiff 3 V source (a 3 V lantern-like cell bank with 1e-3 Ω is not a
		// catalog item: an ideal source in the engine's own circuit)
		const k = 0.0028617
		const R = 1.3636
		const sim = new CircuitSim({ parts: [{ kind: "battery", id: "s", a: "+", b: "-", emf: 3, r: 1e-6 }, { kind: "motor", id: "m", a: "+", b: "-", k, r: R }] })
		// a free shaft: J dω/dt = k·I − friction, friction = k·0.2 A
		let w = 0
		const J = 5e-7
		for (let s = 0; s <= 480 * 3; s++) {
			sim.step(s / 480, s ? 1 / 480 : 0, { omega: () => w })
			const i = sim.sample().get("m")?.i ?? 0
			w += (1 / 480) * ((k * i - k * 0.2 * Math.sign(w || 1)) / J)
		}
		const rpm = (w * 60) / (2 * Math.PI)
		check(near(rpm, 9100, 0.03), "FA-130 no-load speed on 3 V: 9100 rpm (Mabuchi data) within 3 %", `${f3(rpm)} rpm`)
		const stall = new CircuitSim({ parts: [{ kind: "battery", id: "s", a: "+", b: "-", emf: 3, r: 1e-6 }, { kind: "motor", id: "m", a: "+", b: "-", k, r: R }] })
		stall.step(0, 0, { omega: () => 0 })
		check(near(stall.sample().get("m")?.i ?? 0, 2.2, 0.01), "FA-130 stall current on 3 V: 2.2 A (Mabuchi data)", `${f3(stall.sample().get("m")?.i)} A`)
		// a geared motor turning a 10 cm plastic disc (in the engine, a real body on its shaft): ω(t) = ω∞ (1 − e^(−t/τ)) after it breaks away,
		// τ = J·R_total/(η k²) (DC motor theory, e.g. Hughes, Electric Motors and Drives, ch. 3)
		const d = go(scene([BAT("bat", 0.6), PART("m", "motor", 0.9, { kind: "geared", drives: "disc", size: 0.1 }), W("w1", "bat", "+", "m", "+"), W("w2", "m", "-", "bat", "-")], 3))
		const rpmT = d.at("m", "rpm")
		const T = d.track.frames.map((f) => f.t)
		const wEnd = rpmT.at(-1) as number
		check(wEnd > 80 && wEnd < 130, "a 48:1 gear motor turns a light disc at about 100 rpm on 3 V", `${f3(wEnd)} rpm`)
		const i0 = rpmT.findIndex((v) => Math.abs(v) > 0.5)
		const i63 = rpmT.findIndex((v) => Math.abs(v) >= 0.632 * Math.abs(wEnd))
		const tau = (T[i63] as number) - (T[Math.max(0, i0 - 1)] as number)
		// the disc: hollow plastic 950 kg/m³, r 5 cm, 4 mm thick: J = ½ m r²; the gear motor: k 0.26, R 2.5 + 0.4 Ω (2 AA) + wires, η 0.6
		const m = 950 * Math.PI * 0.05 * 0.05 * 0.004
		const Jd = 0.5 * m * 0.05 * 0.05
		const tauTh = (Jd * (2.5 + 0.4 + 0.02)) / (0.6 * 0.26 * 0.26)
		check(near(tau, tauTh, 0.35) || (tauTh < 2 / 120 && tau <= 2 / 120 + 1e-9), "its spin-up time constant is J·R/(η k²) (resolved to the track's 120 frames a second)", `${f3(tau)} s vs ${f3(tauTh)} s`)
		// a heavier disc (a 30 cm one: J × 81) spins up visibly, with that time constant
		const big = go(scene([BAT("bat", 0.6), PART("m", "motor", 0.9, { kind: "geared", drives: "disc", size: 0.3 }), W("w1", "bat", "+", "m", "+"), W("w2", "m", "-", "bat", "-")], 3))
		const rb = big.at("m", "rpm")
		const eb = rb.at(-1) as number
		const j0 = rb.findIndex((v) => Math.abs(v) > 0.5)
		const j63 = rb.findIndex((v) => Math.abs(v) >= 0.632 * Math.abs(eb))
		const tauB = (T[j63] as number) - (T[Math.max(0, j0 - 1)] as number)
		const Jb = 0.5 * (950 * Math.PI * 0.15 * 0.15 * 0.004) * 0.15 * 0.15
		// (the motor's friction, 0.004 N·m at its output, is a Coulomb torque: the speed it reaches is a little under the no-load speed, the time
		// constant the same)
		const tauBTh = (Jb * (2.5 + 0.4 + 0.02)) / (0.6 * 0.26 * 0.26)
		check(near(tauB, tauBTh, 0.15), "a 30 cm disc on it spins up with the time constant J·R/(η k²) (DC motor theory) within 15 %", `${f3(tauB)} s vs ${f3(tauBTh)} s, ${f3(eb)} rpm`)
		const rev = go(scene([BAT("bat", 0.6), PART("m", "motor", 0.9, { kind: "geared", drives: "disc", size: 0.1 }), W("w1", "bat", "+", "m", "-"), W("w2", "m", "+", "bat", "-")], 3))
		check(Math.sign(rev.end("m", "rpm")) === -Math.sign(wEnd) && Math.abs(rev.end("m", "rpm")) > 80, "C7 swapping the motor's wires reverses its turning", `${f3(rev.end("m", "rpm"))} vs ${f3(wEnd)} rpm`)
	},
	fan() {
		const s = go(scene([BAT("bat", 0.5), PART("fan", "motor", 0.8, { drives: "propeller" }), { id: "ball", type: "ping-pong-ball", name: "ball", x: 1.0, y: 0.02, props: {} }, W("w1", "bat", "+", "fan", "+"), W("w2", "fan", "-", "bat", "-")], 3))
		check(s.end("fan", "rpm") > 3000 && s.end("fan", "air") > 2, "C7 a battery fan: its propeller spins up and blows", `${f3(s.end("fan", "rpm"))} rpm, ${f3(s.end("fan", "air"))} m/s`)
		const g = go({ ...scene([BAT("bat", 0.5), PART("fan", "motor", 0.8, { drives: "propeller" }), { id: "ball", type: "ping-pong-ball", name: "ball", x: 1.0, y: 0.02, props: {} }, W("w1", "bat", "+", "fan", "+"), W("w2", "fan", "-", "bat", "-")], 3, [{ kind: "moves", item: "ball", min_m: 0.1 }]) })
		check(g.summary.goals[0]?.ok === true, "C7 its air blows a ping-pong ball along the table", g.summary.goals.map((x) => x.label).join("; "))
	},
	short() {
		const s = go(scene([BAT("bat", 0.6, { cells: 1 }), W("w1", "bat", "+", "bat", "-")], 1))
		const rec = s.doc.processes?.find((x) => x.kind === "circuit")
		const rw = rec?.parts.find((x) => x.kind === "wire")?.r ?? 0
		check(near(s.end("bat", "current"), 1.58 / (0.2 + rw), 1e-4), "C9 a short circuit: I = emf / (r + R_wire)", `${f3(s.end("bat", "current"))} vs ${f3(1.58 / (0.2 + rw))} A`)
		check((s.summary.happenings ?? []).some((e) => e.kind === "short"), "C9 the event says the battery is short-circuited")
	},
	led() {
		const led = (ohms: number | null, flip = false) =>
			go(scene([
				BAT("bat", 0.6),
				...(ohms === null ? [] : [PART("r", "resistor", 0.8, { ohms })]),
				PART("led", "led", 1.0),
				...(ohms === null ? [W("w1", "bat", "+", "led", flip ? "-" : "+")] : [W("w1", "bat", "+", "r", "+"), W("w2", "r", "-", "led", flip ? "-" : "+")]),
				W("w3", "led", flip ? "+" : "-", "bat", "-")
			]))
		const a = led(68)
		check(a.end("led", "current") > 0.014 && a.end("led", "current") < 0.019 && a.end("led", "light") > 0.6, "C11 a red LED on 2 x AA with 68 Ω: (3.16 − 1.9)/68 ≈ 16-18 mA, lit", `${f3(a.end("led", "current") * 1000)} mA`)
		const b = led(null)
		check(b.end("led", "broken") === 1 && (b.summary.happenings ?? []).some((e) => e.kind === "burns-out" && /mA is over its 30 mA/.test(e.text)), "C11 with no resistor it burns out (and says how far over its 30 mA)", (b.summary.happenings ?? []).map((e) => e.text).join("; "))
		const c = led(68, true)
		check(c.end("led", "light") === 0 && c.end("led", "current") === 0, "C11 reversed it stays dark (no current)")
	},
	solar() {
		// a panel's short-circuit current ∝ the light on it: a lamp (50 W of radiation) at 15 cm and at 40 cm (1/d²); in the dark, nothing
		const doc = (d: number): CircuitsDoc => ({
			parts: [
				{ kind: "solar", id: "pv", a: "+", b: "-", isc: 0.2, v_knee: 1.8, g_d: 0.9, rsh: 100, rs: 0.5, face: { solid: "pv/panel", at: { x: 0, y: 0 }, normal: { x: 0, y: 1 }, width: 0.09 } },
				{ kind: "meter", id: "A", a: "+", b: "-", mode: "amps", r: 0.1 }
			]
		})
		const isc = (d: number) => {
			const sim = new CircuitSim(doc(d))
			sim.step(0, 0, { irradiance: () => (50 * 0.3) / (4 * Math.PI * d * d) })
			return sim.sample().get("A")?.reads ?? 0
		}
		const r = isc(0.15) / isc(0.4)
		check(near(r, (0.4 / 0.15) ** 2, 0.02), "C12 a lamp at 15 cm against 40 cm: (40/15)² ≈ 7.1 times the current", `x ${f3(r)}`)
		const sun = go(scene([PART("pv", "solar-panel", 0.8), { id: "A", type: "meter", name: "A", x: 1.0, y: 0.075, props: { mode: "amps" } }, W("w1", "pv", "+", "A", "+"), W("w2", "A", "-", "pv", "-")]))
		check(near(sun.end("A", "reading"), 0.2 * (100 / 100.6), 0.02), "full sun: the mini panel's 0.2 A into a short", `${f3(sun.end("A", "reading"))} A`)
		const shade = go(scene([PART("pv", "solar-panel", 0.8), { id: "card", type: "cardboard-box", name: "card", x: 0.8, y: 0.25, props: {}, fixed: true }, { id: "A", type: "meter", name: "A", x: 1.0, y: 0.075, props: { mode: "amps" } }, W("w1", "pv", "+", "A", "+"), W("w2", "A", "-", "pv", "-")]))
		check(shade.end("pv", "irradiance") === 0 && Math.abs(shade.end("A", "reading")) < 1e-6, "shaded from above by a box, it makes no current", `${f3(shade.end("pv", "irradiance"))} W/m², ${f3(shade.end("A", "reading"))} A`)
	},
	generator() {
		const g = (rpm: number) => go(scene([PART("g", "hand-generator", 0.8, { rpm, start_at: 0 }), { id: "V", type: "meter", name: "V", x: 1.0, y: 0.075, props: {} }, W("w1", "g", "+", "V", "+"), W("w2", "V", "-", "g", "-")]))
		const a = g(60).end("V", "reading")
		const b = g(120).end("V", "reading")
		check(near(b / a, 2, 0.002), "a generator's EMF ∝ its speed (Faraday): twice as fast, twice the voltage", `${f3(a)} V at 60 rpm, ${f3(b)} V at 120`)
		check(near(b, 6, 0.01), "a classroom hand generator: about 6 V on open circuit at 2 turns a second", `${f3(b)} V`)
	},
	wire() {
		const s = go(scene([BAT("bat", 0.6), PART("bulb", "bulb", 1.0), W("w1", "bat", "+", "bulb", "+", { length: 0.5 }), W("w2", "bulb", "-", "bat", "-")]))
		const w = s.doc.processes?.find((x) => x.kind === "circuit")?.parts.find((x) => x.id === "w1/wire")
		check(near(w?.r ?? 0, 0.053 * 0.5, 1e-9), "a 50 cm lead of 22 AWG copper is 0.0265 Ω (0.053 Ω/m, ASTM B258)", `${w?.r} Ω`)
		const sim = new CircuitSim({
			parts: [
				{ kind: "battery", id: "b", a: "b/+", b: "b/-", emf: 3.16, r: 0.4 },
				{ kind: "wire", id: "w", a: "b/+", b: "l/+", r: 0.01, length: 0.3 },
				{ kind: "bulb", id: "l", a: "l/+", b: "b/-", v_rated: 2.5, i_rated: 0.3 }
			]
		})
		let x = 0.1
		for (let s2 = 0; s2 <= 480; s2++) {
			if (s2 > 240) x += 0.002
			sim.step(s2 / 480, s2 ? 1 / 480 : 0, { terminal: (n) => (n === "b/+" ? { x: 0, y: 0 } : n === "l/+" ? { x, y: 0 } : undefined) })
		}
		check(sim.events.some((e) => e.kind === "pulled-off") && sim.events.some((e) => e.kind === "goes-out") && (sim.sample().get("l")?.light ?? 1) < 0.01 && Math.abs(sim.sample().get("l")?.i ?? 1) < 1e-12, "a wire pulled farther apart than its 30 cm comes off; the bulb goes out", sim.events.map((e) => `${e.t.toFixed(3)} ${e.kind}`).join("; "))
	},
	fuzz() {
		// random netlists: every node's currents sum to zero (Kirchhoff's current law) to 1e-9 A, nothing is NaN, and the same answer twice
		let seed = 2026
		const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
		let worst = 0
		let nan = 0
		let same = true
		const N = Number(process.env.FUZZ_N ?? 3000)
		for (let n = 0; n < N; n++) {
			const nodes = 2 + Math.floor(rnd() * 8)
			const br: Branch[] = []
			const m = 1 + Math.floor(rnd() * 12)
			for (let k = 0; k < m; k++) {
				const a = Math.floor(rnd() * nodes)
				const b = Math.floor(rnd() * nodes)
				const u = rnd()
				if (u < 0.25) br.push({ kind: "g", a, b, g: 1 / (0.15 * (1 + Math.floor(rnd() * 6))), e: 1.58 * Math.floor(rnd() * 7) })
				else if (u < 0.55) br.push({ kind: "g", a, b, g: 1 / (10 ** (-2 + rnd() * 9)), e: 0 })
				else if (u < 0.75) br.push({ kind: "d", a, b, g: 1 / (5 + rnd() * 20), v0: 1.6 + rnd() * 1.5 })
				else if (u < 0.85) br.push({ kind: "j", a, b, i: rnd() * 0.2 })
				else br.push({ kind: "g", a, b, g: 0, e: 0 })
			}
			const s = solve(nodes, br)
			const s2 = solve(nodes, br)
			for (let i = 0; i < s.current.length; i++) if (!Number.isFinite(s.current[i] as number) || !Number.isFinite(s.v[i] ?? 0)) nan++
			if (![...s.current].every((v, i) => Object.is(v, s2.current[i]))) same = false
			// KCL: at each node, the branch currents leaving it sum to zero (a node that no conducting branch reaches has none)
			const out = new Float64Array(nodes)
			let scale = 1
			br.forEach((x, k) => {
				const i = s.current[k] as number
				out[x.a] = (out[x.a] as number) + i
				out[x.b] = (out[x.b] as number) - i
				scale = Math.max(scale, Math.abs(i))
			})
			for (let i = 0; i < nodes; i++) worst = Math.max(worst, Math.abs(out[i] as number) / scale)
		}
		check(nan === 0, `fuzz: ${N} random netlists, no NaN`)
		check(worst < 1e-9, `fuzz: Kirchhoff's current law at every node (relative to the largest current) to 1e-9`, `worst ${worst.toExponential(2)}`)
		check(same, "fuzz: the same netlist gives the same bits twice")
	}
}

const MU0 = 1.25663706212e-6
Object.assign(sections, {
	lamplight() {
		// a 150 W halogen desk lamp 20-30 cm from the panel, aimed at it; the panel indoors (sun 0); the wires name only their items
		const lamp = (x: number) =>
			go(scene([
				{ id: "lamp", type: "lamp", name: "Desk lamp", x: 0.55, y: 0, props: { bulb: "halogen", power_w: 150, head_height: 0.25, target: "panel" } },
				PART("panel", "solar-panel", x, { sun: 0 }), PART("motor", "motor", x + 0.3, { kind: "solar", drives: "propeller" }),
				{ id: "w1", type: "wire", name: "Red wire", x: 0, y: 0, props: { a: "panel", b: "motor" } }, { id: "w2", type: "wire", name: "Black wire", x: 0, y: 0, props: { a: "motor", b: "panel" } }
			], 3))
		const near1 = lamp(0.85)
		const w = near1.doc.processes?.find((x) => x.kind === "circuit")?.parts.filter((x) => x.kind === "wire").map((x) => `${(x as unknown as { a: string }).a}→${(x as unknown as { b: string }).b}`)
		check(JSON.stringify(w) === JSON.stringify(["panel/+→motor/+", "motor/-→panel/-"]), "wires that name only their items are joined as current flows: panel + → motor +, motor − → panel −", JSON.stringify(w))
		const irr = near1.end("panel", "irradiance")
		check(irr > 50 && near1.end("panel", "current") > 0.01, "the lamp's light on the panel (indoors, sun 0) is real sunlight's worth and makes current", `${f3(irr)} W/m², ${f3(near1.end("panel", "current") * 1000)} mA`)
		check(near1.end("motor", "rpm") > 300, "lamp → solar panel → solar motor: the motor turns", `${f3(near1.end("motor", "rpm"))} rpm`)
		check(!(near1.summary.happenings ?? []).some((e) => /floats/.test(e.text)), "no happening says a wire floats")
		const far = lamp(1.25)
		check(far.end("panel", "irradiance") < irr, "the panel further from the lamp gets less light", `${f3(far.end("panel", "irradiance"))} vs ${f3(irr)} W/m²`)
		// the optics module's sun (1000 W/m² straight down, ASTM AM1.5) on the panel's face: 1000 W/m² of sunlight's worth, so 0.2 A into a short
		const sun = go(scene([
			{ id: "sun", type: "sunlight", name: "Sunlight", x: 0.8, y: 1.2, props: { elevation: 90 } } as Item,
			PART("panel", "solar-panel", 0.8, { sun: 0 }), { id: "A", type: "meter", name: "A", x: 1.0, y: 0.075, props: { mode: "amps" } }, W("w1", "panel", "+", "A", "+"), W("w2", "A", "-", "panel", "-")
		], 1))
		const si = sun.end("panel", "irradiance")
		check(near(si, 1000, 0.05), "the optics sun at 1000 W/m² overhead: the panel reads 1000 W/m² of sunlight (silicon's response band by band, AM1.5)", `${f3(si)} W/m²; ${f3(sun.end("A", "reading"))} A`)
	},
	oersted() {
		// [Biot–Savart] B = μ0·I/(2π·r) beside a long straight wire: 2 A at 1 cm is 40 µT
		const b = segmentField(0, 0, 0.5, 0, 0, -0.5, 2, 0.01, 0, 0, 0.0008)
		check(near(Math.abs(b[1]), 4e-5, 0.002) && b[0] === 0, "a long straight wire's field 1 cm from 2 A is 40 µT (μ0·I/2πr)", `${f3(Math.abs(b[1]) * 1e6)} µT`)
		const b5 = segmentField(0, 0, 0.5, 0, 0, -0.5, 2, 0.05, 0, 0, 0.0008)
		check(near(Math.abs(b5[1]) / Math.abs(b[1]), 0.2, 0.01), "five times as far, a fifth of the field (∝ 1/r)", `x ${f3(Math.abs(b5[1]) / Math.abs(b[1]))}`)
		const run1 = (flip: boolean) =>
			go(scene([
				BAT("bat", 0.6, { cells: 2 }), PART("sw", "switch", 0.8, { flip_at: 1.0 }), PART("res", "resistor", 1.0, { ohms: 1 }),
				{ id: "wire", type: "straight-wire", name: "Straight wire", x: 1.5, y: 0.06, props: {} }, { id: "compass", type: "compass", name: "Compass", x: 1.5, y: 0.06, props: {} },
				W("w1", "bat", "+", "sw", "+"), W("w2", "sw", "-", "res", "+"), W("w3", "res", "-", "wire", flip ? "-" : "+"), W("w4", "wire", flip ? "+" : "-", "bat", "-")
			], 4))
		const a = run1(false)
		const I = a.end("wire", "current")
		const heading = a.end("compass", "heading_deg")
		const theta = ((heading + 540) % 360) - 180
		// the poles 1 cm either side of the pivot, the wire 1.2 cm in front: at the needle's angle θ the field at a pole is B0·h²/(h² + (L/4·sin θ)²)
		const h = 0.012
		const solveAngle = () => {
			let lo = 0
			let hi = Math.PI / 2
			for (let k = 0; k < 60; k++) {
				const m = (lo + hi) / 2
				const bw = ((MU0 * Math.abs(I)) / (2 * Math.PI * h)) * ((h * h) / (h * h + (0.01 * Math.sin(m)) ** 2))
				if (Math.tan(m) < bw / 2e-5) lo = m
				else hi = m
			}
			return (lo * 180) / Math.PI
		}
		const want = solveAngle()
		check(Math.abs(Math.abs(theta) - want) < 2.5, "Oersted: the compass behind the wire swings to where the wire's field and the Earth's balance", `${f3(theta)}° (${f3(I)} A) vs ${f3(want)}°`)
		check(Math.abs(a.at("compass", "heading_deg")[60] ?? 0) < 0.5 || Math.abs((a.at("compass", "heading_deg")[60] ?? 0) - 360) < 0.5, "before the switch closes it points north (no current, no field)", `${f3(a.at("compass", "heading_deg")[60])}°`)
		const r = run1(true)
		const t2 = ((r.end("compass", "heading_deg") + 540) % 360) - 180
		check(Math.sign(t2) === -Math.sign(theta) && Math.abs(Math.abs(t2) - Math.abs(theta)) < 2.5, "the current reversed, it swings the other way", `${f3(t2)}° vs ${f3(theta)}°`)
		const goal = a.summary.goals.find((g) => (g as { kind?: string }).kind === "deflects")
		check(goal === undefined || goal.ok, "the deflects goal sees the swing")
	},
	induction() {
		// a small magnet (a 2 mm NdFeB cube, m = M·V) on a thin coil's axis: Φ = μ0·m·R²/(2(R² + z²)^1.5) through each turn (the dipole's exact flux)
		const M = 1.3 / MU0
		const a = 0.002
		const mag = magnetsOf([{ kind: "magnetism", role: "magnet", solid: "m", faces: [{ x: a / 2, y: 0, angle: 0, width: a, depth: a, sigma: M }, { x: -a / 2, y: 0, angle: Math.PI, width: a, depth: a, sigma: -M }] }]).magnets
		const R = 0.02
		const geo = { x: 0, y: 0, ux: 1, uy: 0, radius: R, length: 0.0005 }
		const pts = coilSamples(geo)
		const m = M * a * a * a
		const phiAt = (z: number) => fluxThrough(geo, pts, mag, () => ({ x: -z, y: 0, angle: 0 }), { x: 0, y: 0 })
		const exact = (z: number) => (MU0 * m * R * R) / (2 * (R * R + z * z) ** 1.5)
		let worst = 0
		for (const z of [0.03, 0.05, 0.1]) worst = Math.max(worst, Math.abs(phiAt(z) / exact(z) - 1))
		check(worst < 0.01, "the flux of a small magnet on a coil's axis is the dipole's exact μ0·m·R²/(2(R² + z²)^1.5)", `worst ${(worst * 100).toFixed(3)} %`)
		// in the turn's own plane, the flux through it is the magnet's: what the dipole's formula gives at z = 0 (a small magnet: its own field's
		// flux through the turn, all of it but what returns outside the turn), m·μ0/(2R)
		const inside = phiAt(0)
		check(near(inside, exact(0), 0.01), "with a small magnet in the middle of the turn, the flux through it is μ0·m/(2R) (all its flux less what returns outside the turn)", `${f3(inside * 1e6)} vs ${f3(exact(0) * 1e6)} µWb`)
		// a long magnet in a coil: the flux at its middle is nearly all its own body's, B·A with B = μ0·M·(1 − N) (its demagnetizing factor along it)
		const L2 = 0.06
		const bar = magnetsOf([{ kind: "magnetism", role: "magnet", solid: "b", faces: [{ x: L2 / 2, y: 0, angle: 0, width: 0.019, depth: 0.0095, sigma: M }, { x: -L2 / 2, y: 0, angle: Math.PI, width: 0.019, depth: 0.0095, sigma: -M }] }]).magnets
		const geoB = { x: 0, y: 0, ux: 1, uy: 0, radius: 0.0222, length: 0.0005 }
		const flb = fluxThrough(geoB, coilSamples(geoB), bar, () => ({ x: 0, y: 0, angle: 0 }), { x: 0, y: 0 })
		const own = 1.3 * 0.019 * 0.0095
		check(flb > 0.5 * own && flb < own, "a bar magnet's middle in the turn: about its own body's flux B_r·A less its demagnetizing and the return outside it", `${f3(flb * 1e6)} µWb vs B_r·A ${f3(own * 1e6)} µWb`)
		// a steady 1 m/s along the axis: EMF = dλ/dt = N·dΦ/dz·v against the formula's derivative
		const N = 200
		const v = 1
		const hh = 1 / 480
		let wst = 0
		for (const z of [0.04, 0.06, 0.08]) {
			const emf = (N * (phiAt(z - v * hh) - phiAt(z))) / hh
			const want = (N * (exact(z - v * hh) - exact(z))) / hh
			wst = Math.max(wst, Math.abs(emf / want - 1))
		}
		check(wst < 0.02, "a magnet moving at 1 m/s along the axis: EMF = N·dΦ/dt as the dipole's formula gives (Faraday)", `worst ${(wst * 100).toFixed(2)} %`)
		// a neodymium bar dropped through the coil with a galvanometer across it
		const drop = (turns: number, galvo = true) =>
			go({ ...scene([
				{ id: "coil", type: "coil", name: "Coil", x: 1.3, y: 0.2, props: { turns } },
				{ id: "mag", type: "bar-magnet", name: "Bar magnet", x: 1.3, y: 0.42, angle: 90, held: true, props: { length: 0.06, material: "neodymium" } },
				{ id: "g", type: "meter", name: "G", x: 1.7, y: 0.045, props: { mode: galvo ? "galvanometer" : "volts" } },
				W("w1", "coil", "+", "g", "+"), W("w2", "g", "-", "coil", "-")
			], 1.5), release: 0.5 })
		const d = drop(200)
		// (the track at the engine's own 480 Hz: each step's EMF is that step's change of linkage over the step, so they add up to its change)
		const fine = run((web.prepare({ ...scene([
			{ id: "coil", type: "coil", name: "Coil", x: 1.3, y: 0.2, props: { turns: 200 } },
			{ id: "mag", type: "bar-magnet", name: "Bar magnet", x: 1.3, y: 0.42, angle: 90, held: true, props: { length: 0.06, material: "neodymium" } },
			{ id: "g", type: "meter", name: "G", x: 1.7, y: 0.045, props: { mode: "galvanometer" } },
			W("w1", "coil", "+", "g", "+"), W("w2", "g", "-", "coil", "-")
		], 1.5), release: 0.5 }) as { doc: unknown }).doc, 480)
		const emf = fine.state?.coil?.emf_mv ?? []
		const flux = fine.state?.coil?.flux_uwb ?? []
		let integral = 0
		for (let k = 1; k < emf.length; k++) integral += (emf[k] as number) / 480
		const dLam = (((flux.at(-1) as number) - (flux[0] as number)) * 200) / 1000 // µWb·turns → mV·s
		const swing = (Math.max(...flux) - Math.min(...flux)) * 0.2
		check(Math.abs(integral - dLam) < 0.01 * swing, "a dropped magnet: the EMF over the run adds up to the change of the flux linkage (∫EMF dt = Δλ, to 1 % of its swing)", `${f3(integral)} vs ${f3(dLam)} mV·s (the linkage swings ${f3(swing)} mV·s)`)
		let jump = 0
		for (let k = 2; k < emf.length; k++) jump = Math.max(jump, Math.abs((emf[k] as number) - 2 * (emf[k - 1] as number) + (emf[k - 2] as number)))
		check(jump < 0.6 * Math.max(...emf.map(Math.abs)), "the EMF is smooth step to step (no spike from a pole crossing a sample)", `largest second difference ${f3(jump)} mV of a ${f3(Math.max(...emf.map(Math.abs)))} mV peak`)
		const peakAt = emf.reduce((b, x, i) => (Math.abs(x) > Math.abs(emf[b] as number) ? i : b), 0)
		const cur = (fine.state?.coil?.current ?? [])[peakAt] as number
		check(Math.sign(cur) === -Math.sign(emf[peakAt] as number) && Math.abs(cur) > 0, "Lenz: the induced current flows against the change (its own field opposes it)", `EMF ${f3(emf[peakAt])} mV, current ${f3(cur * 1000)} mA`)
		check(Math.max(...d.at("g", "needle").map(Math.abs)) > 0.5 && Math.abs(d.end("g", "needle")) < 0.1, "the galvanometer flicks and comes back to zero once the magnet lies still", `peak ${f3(Math.max(...d.at("g", "needle").map(Math.abs)))}, end ${f3(d.end("g", "needle"))}`)
		const pk = (x: ReturnType<typeof go>) => Math.max(...x.at("coil", "emf_mv").map(Math.abs))
		const d2 = drop(400, false)
		const d1 = drop(200, false)
		check(near(pk(d2) / pk(d1), 2, 0.1), "twice the turns, twice the voltage (open circuit: a voltmeter across it)", `x ${f3(pk(d2) / pk(d1))}`)
		// a steady current through a galvanometer: its needle settles at I / 0.5 mA
		const steady = go(scene([BAT("bat", 0.6, { cells: 1 }), PART("r", "resistor", 0.9, { ohms: 4000 }), { id: "g", type: "meter", name: "G", x: 1.3, y: 0.045, props: { mode: "galvanometer" } }, W("w1", "bat", "+", "r", "+"), W("w2", "r", "-", "g", "+"), W("w3", "g", "-", "bat", "-")], 3))
		const I = steady.end("g", "reading")
		check(near(steady.end("g", "needle"), I / 0.0005, 0.01) && I > 0.0003, "a steady current: the galvanometer's needle settles at I/I_full", `${f3(I * 1000)} mA, needle ${f3(steady.end("g", "needle"))}`)
	},
	magnetize() {
		const em = (closed: boolean, flip: number) =>
			go({ ...scene([
				BAT("bat", 0.6, { cells: 2 }), PART("sw", "switch", 0.8, { closed, flip_at: flip }), { id: "amm", type: "meter", name: "Ammeter", x: 1.0, y: 0.075, props: { mode: "amps" } },
				{ id: "em", type: "electromagnet", name: "Electromagnet", x: 1.4, y: 0.244, props: { turns: 50 } },
				{ id: "clips", type: "paper-clip", name: "Clips", x: 1.4, y: 0.11425, angle: -90, held: true, props: { count: 6, spacing: 0.0345 } },
				W("w1", "bat", "+", "sw", "+"), W("w2", "sw", "-", "amm", "+"), W("w3", "amm", "-", "em", "+"), W("w4", "em", "-", "bat", "-")
			], 2, [{ kind: "holds", magnet: "em", count: 1, items: ["clips"] }]), release: 0.3 })
		const on = em(true, 0)
		const I = on.end("em", "current")
		check(near(on.end("em", "amps"), I, 1e-6) && I > 3, "a wired electromagnet: its coil's current is the circuit's (the magnetism module's coil reads it)", `${f3(I)} A in the circuit, ${f3(on.end("em", "amps"))} A in its coil`)
		check(on.summary.goals[0]?.ok === true, "switched on, it holds the clips", JSON.stringify(on.summary.goals[0]))
		const off = em(true, 1.0)
		check(off.summary.goals[0]?.ok === false && off.end("em", "amps") === 0, "the switch opened, its current stops and it lets them go", JSON.stringify(off.summary.goals[0]))
	}
})

const want = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const run1 = want.length === 0 || want.includes("all") ? Object.keys(sections) : want
for (const name of run1) {
	const fn = sections[name]
	if (!fn) {
		console.log(`no section "${name}" (have: ${Object.keys(sections).join(", ")})`)
		failed++
		continue
	}
	console.log(`---- ${name}`)
	try {
		fn()
	} catch (e) {
		failed++
		console.log(`FAIL  ${name} threw: ${e instanceof Error ? e.stack : e}`)
	}
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
