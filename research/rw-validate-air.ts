// The air module against theory and measurements (tooling/src/sim/air.ts, tooling/src/sim/modules/air.ts, machines/mod_air.py and its port
// web/sim/modules/air.js). Every scene is built by web/sim (the exact port of the Python builder) and run by the server's engine (node, with the
// browser bundle's math), at 480 Hz, 120 frames a second. Exits 1 on any failure (a gate).
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-air.ts [gas|lift|pop|rocket|hotair|jar|card|cup|can|steam|flight|kite|wind|smoke|repair|determinism|fuzz|all]
// Reference values (cited where they are used):
//   [CODATA] R = 8.314462618 J/(mol·K); [ISO2533] 1 atm = 101325 Pa; [USSA76] dry air 28.9644 g/mol → 1.2041 kg/m³ at 20 °C; [IUPAC] He 4.0026 g/mol;
//   [BOYLE]/[CHARLES] PV = const at constant T, V ∝ T at constant P; [MW78] Merritt & Weinhaus, Am. J. Phys. 46, 976 (1978): the rubber balloon's
//   pressure curve (a peak near λ 1.38, then nearly flat: 2-4 kPa for party balloons); [IAPWS] water's vapour pressure 0.6112 kPa at 0 °C, 2.3393 at
//   20 °C, 12.352 at 50 °C, 101.42 at 100 °C (Wagner & Pruss 2002); [WT34] Windenburg & Trilling, Trans. ASME 56, 819 (1934): a thin cylinder
//   buckles under 2.42E(t/D)^2.5/((1−ν²)^0.75 (L/D − 0.45√(t/D))); [ISO5167] a sharp orifice's contraction 0.60-0.62; [HOE] Hoerner, Fluid-Dynamic
//   Drag (1965): a flat plate square to the flow C_D 1.17, a sphere 0.47; [ANDERSON] Helmbold's lift slope; [SIMONS] Simons, Model Aircraft
//   Aerodynamics (4th ed. 1999): hand-launched balsa gliders glide at 1:6 to 1:10; paper darts 1:3 to 1:5 (provisional, school measurements);
//   [MTT] Morton, Taylor & Turner (1956): a point-source plume's centreline speed 3.4·F^(1/3)·z^(−1/3) (entrainment 0.1); [RAJ] Rajaratnam,
//   Turbulent Jets (1976): a round jet keeps its outlet speed for 6.2 diameters, then ∝ 1/x; [PIAB] vacuum-gripper handbooks: holding force Δp·A.
import { pathToFileURL } from "node:url"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const sim = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as Any
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as Any
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as Any
await import(`${PG}/tooling/src/sim/modules/index.ts`)
const core = (await import(`${PG}/tooling/src/sim/air.ts`)) as typeof import("../tooling/src/sim/air.ts")
const plug = (await import(`${PG}/tooling/src/sim/plugins.ts`)) as Any

const G = 9.81
const RHO = 1.2
const ATM = 101325
const R = 8.314462618
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const want = process.argv[2] ?? "all"
let failures = 0
let checks = 0
const line = (ok: boolean, text: string) => {
	checks++
	if (!ok) failures++
	console.log(`${ok ? "PASS" : "FAIL"}  ${text}`)
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(2) : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(5))
const check = (label: string, got: number, ref: number, tol: number, unit = "", src = "") =>
	line(Math.abs(got - ref) <= tol, `${label}: ${fmt(got)} ${unit} vs ${fmt(ref)} ${unit} (± ${fmt(tol)})${src ? `  [${src}]` : ""}`)
const within = (label: string, got: number, lo: number, hi: number, unit = "", src = "") =>
	line(got >= lo && got <= hi, `${label}: ${fmt(got)} ${unit} within ${fmt(lo)}…${fmt(hi)}${src ? `  [${src}]` : ""}`)
const claim = (label: string, ok: boolean) => line(ok, label)

const scene = (items: Any[], seconds = 3, release = 0.5, goals: Any[] = [], extra: Any = {}) => ({
	version: 2, name: "v", seconds, release, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: { width: 3.7 } }, ...items], goals, ...extra
})
const run = (s: Any) => {
	const c = sim.clean(s)
	const { doc, resolved } = sim.layout(c)
	const raw = simulate(admitDocument(doc).scene, 120)
	const track = { ...raw, ...plug.slimExtras(raw, (v: number, d: number) => Number(v.toFixed(d))) }
	const summary = sim.finish(c, doc, resolved, track).summary
	return { doc, resolved, track, summary, scene: c, raw }
}
const series = (r: Any, item: string, key: string): number[] => r.track.state?.[item]?.[key] ?? []
const last = (r: Any, item: string, key: string) => series(r, item, key).at(-1) as number
const frameAt = (r: Any, t: number) => r.track.frames.reduce((b: number, f: Any, i: number) => (Math.abs(f.t - t) < Math.abs(r.track.frames[b].t - t) ? i : b), 0)
const valueAt = (r: Any, item: string, key: string, t: number) => series(r, item, key)[frameAt(r, t)] as number
const pose = (r: Any, id: string, t: number) => r.track.frames[frameAt(r, t)].placements[id]
const firstTime = (r: Any, item: string, key: string, test: (v: number) => boolean) => {
	const v = series(r, item, key)
	const i = v.findIndex(test)
	return i < 0 ? null : (r.track.frames[i].t as number)
}
const on = (name: string) => want === "all" || want === name
const moles = (litres: number) => (ATM * litres) / 1000 / (R * 293.15)

// ---------------------------------------------------------------- the gas law in a balloon
if (on("gas")) {
	console.log("\n# gas: a balloon's size from PV = nRT with its rubber's pressure")
	const r = run(scene([{ id: "b", type: "party-balloon", x: 1.2, y: 0.14, props: { fill_l: 8 } }], 1))
	const V = last(r, "b", "volume_l") / 1000
	const dp = last(r, "b", "pressure_kpa") * 1000
	check("8 L of air (at 20 °C, 1 atm) in an 11-inch balloon: (P + Δp)·V = nRT", (ATM + dp) * V, moles(8) * R * 293.15, 0.002, "J", "CODATA, ISO2533")
	within("its over-pressure", dp / 1000, 2, 4, "kPa", "MW78: party balloons 2-4 kPa")
	within("its diameter", last(r, "b", "diameter_cm"), 23, 27, "cm", "an 11-inch balloon blown up most of the way")
	// Charles: the same air in a −18 °C freezer and a 40 °C car
	const cold = run(scene([{ id: "b", type: "party-balloon", x: 1.2, y: 0.14, props: { fill_l: 8 } }], 0.5, 0.5, [], { settings: { room_temp: -18 } }))
	const hot = run(scene([{ id: "b", type: "party-balloon", x: 1.2, y: 0.14, props: { fill_l: 8 } }], 0.5, 0.5, [], { settings: { room_temp: 40 } }))
	const pv = (x: Any) => (ATM + last(x, "b", "pressure_kpa") * 1000) * (last(x, "b", "volume_l") / 1000)
	check("Charles: P·V at −18 °C over P·V at 20 °C = T ratio", pv(cold) / pv(r), 255.15 / 293.15, 1e-4, "", "CHARLES")
	check("Charles: P·V at 40 °C over P·V at 20 °C = T ratio", pv(hot) / pv(r), 313.15 / 293.15, 1e-4, "", "CHARLES")
	claim(`a colder room shrinks it (${fmt(last(cold, "b", "diameter_cm"))} < ${fmt(last(r, "b", "diameter_cm"))} cm), a warmer one swells it (${fmt(last(hot, "b", "diameter_cm"))} cm)`,
		last(cold, "b", "diameter_cm") < last(r, "b", "diameter_cm") && last(hot, "b", "diameter_cm") > last(r, "b", "diameter_cm"))
	// the rubber's own curve
	check("rubber at its rated stretch", core.skinPressure(6), 3000, 1e-9, "Pa", "calibration")
	let peak = 0
	let at = 0
	for (let l = 1.01; l < 3; l += 0.001) if (core.skinPressure(l) > peak) ((peak = core.skinPressure(l)), (at = l))
	within("the first-breath peak's stretch", at, 1.3, 1.5, "", "MW78: λ ≈ 1.38")
}

// ---------------------------------------------------------------- what floats up and what sinks
if (on("lift")) {
	console.log("\n# lift: helium rises, air sinks, at the speeds the sphere's drag allows")
	const r = run(scene([
		{ id: "he", type: "party-balloon", x: 0.8, y: 0.4, props: { gas: "helium", fill_l: 10 } },
		{ id: "air", type: "party-balloon", x: 2.0, y: 2.0, props: { fill_l: 10 } }
	], 3, 0.2))
	const sphere = (x: Any, id: string) => {
		const V = last(x, id, "volume_l") / 1000
		const rr = Math.cbrt((3 * V) / (4 * Math.PI))
		return { V, A: Math.PI * rr * rr }
	}
	const he = sphere(r, "he")
	const rubber = 0.003
	const netHe = RHO * he.V - rubber - moles(10) * 0.0040026
	check("helium balloon's net lift (ρ_air·V − rubber − helium)", last(r, "he", "lift_g") / 1000, netHe, 1e-6, "kg", "USSA76, IUPAC")
	const vHe = Math.sqrt((2 * netHe * G) / (RHO * 0.47 * he.A))
	const p1 = pose(r, "he/balloon", 1.8)
	const p2 = pose(r, "he/balloon", 2.2)
	check("it rises at its terminal speed √(2F/(ρ·C_d·A))", (p2.y - p1.y) / 0.4, vHe, 0.03 * vHe, "m/s", "HOE: sphere C_D 0.47")
	const ai = sphere(r, "air")
	const netAir = rubber + moles(10) * 0.0289644 - RHO * ai.V
	// it sinks slowly: its weight beyond its buoyancy is a few grams, while it moves its rubber, its air and the air it drags along (½ρV): m·dv/dt =
	// F − ½ρ·C_d·A·v², integrated here and compared with where the engine has it after 2.3 s (its terminal speed is far off: several seconds away)
	const mEff = rubber + moles(10) * 0.0289644 + 0.5 * RHO * ai.V
	let v = 0
	let y = 0
	for (let k = 0; k < 1.3 * 4800; k++) {
		const a = (netAir * G - 0.5 * RHO * 0.47 * ai.A * v * v) / mEff
		v += a / 4800
		y += v / 4800
	}
	check("an air balloon sinks as m·dv/dt = F − ½ρC_dAv² says (1.3 s after letting go)", pose(r, "air/balloon", 0.2).y - pose(r, "air/balloon", 1.5).y, y, 0.03 * y, "m", "HOE")
	within("its terminal speed √(2F/(ρC_dA))", Math.sqrt((2 * netAir * G) / (RHO * 0.47 * ai.A)), 0.8, 2, "m/s", "a dropped party balloon falls about 1 m/s")
	within("the air balloon's compressed air outweighs the air it pushes aside by", netAir * 1000 - rubber * 1000, 0.1, 1, "g", "air has mass: Δp/P × ρV")
	// on a string: a 20 g weight holds it, a 3 g one is carried away
	const t = run(scene([
		{ id: "a", type: "party-balloon", x: 0.8, y: 0.66, props: { gas: "helium", string_m: 0.5, weight_g: 20 } },
		{ id: "b", type: "party-balloon", x: 1.8, y: 0.66, props: { gas: "helium", string_m: 0.5, weight_g: 3 } }
	], 3, 0.2))
	claim(`20 g holds a 5 g-lift balloon down (the weight rose ${fmt(Math.max(0, pose(t, "a/weight", 3).y - pose(t, "a/weight", 0).y))} m)`, pose(t, "a/weight", 3).y - pose(t, "a/weight", 0).y < 0.002)
	claim(`3 g is carried away (weight rose ${fmt(pose(t, "b/weight", 3).y - pose(t, "b/weight", 0).y)} m)`, pose(t, "b/weight", 3).y - pose(t, "b/weight", 0).y > 0.5)
}

// ---------------------------------------------------------------- popping
if (on("pop")) {
	console.log("\n# pop: past 1.3 × its rated size, pricked, or with no air outside")
	const r = run(scene([{ id: "b", type: "party-balloon", x: 1.2, y: 0.5, props: { pump_lps: 2, fill_l: 8 } }], 10))
	// it bursts where the gas would need more room than the rubber at stretch 7.8 gives: n_burst = (P + Δp(7.8))·V(7.8)/(RT)
	const r0 = 0.14 / 6
	const Vb = (4 / 3) * Math.PI * (r0 * 7.8) ** 3
	const nb = ((ATM + core.skinPressure(7.8)) * Vb) / (R * 293.15)
	const tPop = (nb - moles(8)) / (moles(2))
	check("a 2 L/s pump pops it when its gas fills it to stretch 7.8", firstTime(r, "b", "popped", (v) => v >= 1) as number, tPop, 0.01, "s", "calibration: 1.3 × the rated diameter")
	check("its diameter just before", valueAt(r, "b", "diameter_cm", tPop - 0.02), 200 * r0 * 7.8, 0.3, "cm")
	const p = run(scene([{ id: "b", type: "party-balloon", x: 1.2, y: 0.14, props: { prick_at: 1 } }], 2))
	check("a pin pops it when it pricks it", firstTime(p, "b", "popped", (v) => v >= 1) as number, 1, 0.009, "s")
	const v = run(scene([{ id: "b", type: "party-balloon", x: 1.2, y: 0.5, props: {} }], 1, 0.5, [], { settings: { air: false } }))
	// (nothing outside holds the gas in: it bursts as soon as it is let go, swelling for SWELL_S = 0.3 s so a video shows it; the first frame after it)
	check("in a vacuum it bursts once let go (the release 0.5 s + its 0.3 s swell)", firstTime(v, "b", "popped", (x) => x >= 1) as number, 0.5 + core.SWELL_S, 1 / 120 + 1e-9, "s")
}

// ---------------------------------------------------------------- an untied balloon's jet
if (on("rocket")) {
	console.log("\n# rocket: thrust 2·C_c·Δp·A from its neck, the momentum it gives")
	const r = run(scene([{ id: "b", type: "party-balloon", x: 0.0, y: 1.2, angle: -90, props: { tied: false, fill_l: 10 } }], 2, 0.5))
	const A = Math.PI * 0.004 * 0.004
	for (const t of [0.6, 1.0, 1.5]) check(`thrust at ${t} s = 2·0.62·Δp·A`, valueAt(r, "b", "thrust_n", t), 2 * 0.62 * valueAt(r, "b", "pressure_kpa", t) * 1000 * A, 0.01 * valueAt(r, "b", "thrust_n", t) + 2e-5, "N", "ISO5167: C_c 0.62")
	within("it shoots off to the right", pose(r, "b/balloon", 2).x - pose(r, "b/balloon", 0).x, 1.5, 8, "m", "a balloon rocket travels several metres (spec: 3-6 m on a string)")
	claim("it shrinks as it empties", valueAt(r, "b", "volume_l", 2) < valueAt(r, "b", "volume_l", 0.4) - 2)
}

// ---------------------------------------------------------------- hot air rises
if (on("hotair")) {
	console.log("\n# hotair: lift (ρ_room − ρ_in)·g·V, lift-off temperature, cooling through its skin")
	// tissue 0.9 m: envelope 0.0498 kg + ring 3 g; V 0.3816 m³ → lifts off above T = 293.15·1.2/(1.2 − m/V)
	const dry = 4 * Math.PI * 0.45 * 0.45 * 0.017 * 1.15 + 0.003
	const V = (4 / 3) * Math.PI * 0.44996 ** 3
	const Tlift = (293.15 * 1.2) / (1.2 - dry / V) - 273.15
	within("lift-off temperature for a 0.9 m tissue envelope", Tlift, 55, 62, "°C", "ideal gas at constant pressure")
	const below = run(scene([{ id: "h", type: "hot-air-balloon", x: 1.2, y: 0, props: { heater_w: 0, start_c: Tlift - 3 } }], 2))
	const above = run(scene([{ id: "h", type: "hot-air-balloon", x: 1.2, y: 0, props: { heater_w: 0, start_c: Tlift + 6 } }], 2))
	claim(`3 °C under it, it stays on its stand (rose ${fmt(Math.max(...series(below, "h", "height_m")))} m)`, Math.max(...series(below, "h", "height_m")) < 0.01)
	claim(`6 °C over it, it lifts off (rose ${fmt(Math.max(...series(above, "h", "height_m")))} m in 2 s, cooling as it goes)`, Math.max(...series(above, "h", "height_m")) > 0.05)
	const T0 = Tlift + 6
	check("its lift at the start (1.2 − 1.2·T_room/T)·g·V", valueAt(above, "h", "lift_n", 0), (1.2 - (1.2 * 293.15) / (T0 + 273.15)) * G * V, 1e-4, "N")
	// cooling with no heat gun: dT/dt = −U·A·(T − T_room)/(ρ_in·V·c_p) (ρ_in follows T): integrate it and compare at 2 s
	let T = T0 + 273.15
	const UA = 3.5 * 4 * Math.PI * 0.45 * 0.45
	for (let k = 0; k < 2 * 4800; k++) T -= ((UA * (T - 293.15)) / ((1.2 * 293.15) / T * V * 1007)) * (1 / 4800)
	check("it cools through its skin (U·A·ΔT)", valueAt(above, "h", "inside_c", 2), T - 273.15, 0.05, "°C", "Incropera: free convection 2-25 W/(m²·K), U 3.5 provisional")
	const heated = run(scene([{ id: "h", type: "hot-air-balloon", x: 1.2, y: 0, props: { start_c: 54, tether_m: 0.6 } }], 10))
	const lift = firstTime(heated, "h", "inside_c", (v) => v >= Tlift)
	const off = firstTime(heated, "h", "height_m", (v) => v > 0.01)
	claim(`a 1500 W heat gun under its mouth heats it past ${fmt(Tlift)} °C (${fmt(lift ?? -1)} s): it lifts off then (${fmt(off ?? -1)} s) and rises to its tether`,
		lift !== null && off !== null && off >= lift && off - lift < 1 && Math.max(...series(heated, "h", "height_m")) > 0.55)
}

// ---------------------------------------------------------------- the vacuum jar
if (on("jar")) {
	console.log("\n# jar: P = P_low + (P_room − P_low)·e^(−t/τ); a balloon inside swells by Boyle's law")
	const r = run(scene([
		{ id: "jar", type: "vacuum-jar", x: 1.2, y: 0, props: { pump_at: 0.5, pump_s: 2, lowest_kpa: 2 } },
		{ id: "b", type: "party-balloon", x: 1.2, y: 0.08, props: { size: 0.12, fill_l: 0.3 } }
	], 8, 0.3))
	for (const t of [1, 2, 3]) check(`jar pressure at ${t} s`, valueAt(r, "jar", "pressure_kpa", t), 2 + 99.325 * Math.exp(-(t - 0.5) / 2), 1e-4, "kPa", "a pumped-down volume")
	const pv = (t: number) => (valueAt(r, "jar", "pressure_kpa", t) * 1000 + valueAt(r, "b", "pressure_kpa", t) * 1000) * valueAt(r, "b", "volume_l", t)
	check("Boyle: (P_jar + Δp)·V at 3 s = at 0 s", pv(3), pv(0.2), pv(0.2) * 1e-3, "J", "BOYLE")
	claim(`it swells (${fmt(valueAt(r, "b", "diameter_cm", 0.2))} → ${fmt(valueAt(r, "b", "diameter_cm", 4))} cm) and pops (${fmt(firstTime(r, "b", "popped", (v) => v >= 1) ?? -1)} s)`,
		valueAt(r, "b", "diameter_cm", 4) > 1.5 * valueAt(r, "b", "diameter_cm", 0.2) && firstTime(r, "b", "popped", (v) => v >= 1) !== null)
}

// ---------------------------------------------------------------- the card under a glass of water
if (on("card")) {
	console.log("\n# card: the air's push holds the water up until the seal breaks")
	const r = run(scene([{ id: "g", type: "card-glass", x: 1.2, y: 0 }], 2))
	const A = (Math.PI * 0.064 * 0.064) / 4
	check("the air's push on the card P·A", last(r, "g", "push_n"), ATM * A, 0.01, "N", "ISO2533")
	claim("at room pressure the card holds", last(r, "g", "holding") === 1)
	// in a jar the card falls where the trapped air would stretch past the water's 2 mm seal: P = Δ·(1 + V_air/(A·δ)), Δ = ρ_w·g·h + w_card/A
	const h = 0.114 * 0.8
	const Vair = 0.114 * 0.2 * A
	const delta = 998.2 * G * h + (0.002 * G) / A
	const Pfall = delta * (1 + Vair / (A * 0.002))
	const j = run(scene([
		{ id: "jar", type: "vacuum-jar", x: 1.2, y: 0, props: { pump_at: 0.5, pump_s: 2, lowest_kpa: 1 } },
		{ id: "g", type: "card-glass", x: 1.25, y: 0.02, props: { stand_height: 0.1 } }
	], 12, 0.3))
	const tf = firstTime(j, "g", "holding", (v) => v < 0.5)
	claim(`in a vacuum jar the card falls (${fmt(tf ?? -1)} s)`, tf !== null)
	if (tf !== null) check("the jar's pressure when it falls", valueAt(j, "jar", "pressure_kpa", tf), Pfall / 1000, 0.035 * (Pfall / 1000) + 0.2, "kPa", "P·V of the trapped air; 2 mm seal provisional")
	const e = run(scene([{ id: "g", type: "card-glass", x: 1.2, y: 0, props: { water: 0 } }], 1))
	check("with no water nothing seals it: it falls at the release", firstTime(e, "g", "holding", (v) => v < 0.5) as number, 0.5, 0.01, "s")
}

// ---------------------------------------------------------------- the suction cup
if (on("cup")) {
	console.log("\n# cup: it holds while the load's pull is under Δp·A")
	const hold = 35000 * Math.PI * 0.025 * 0.025
	const kg = hold / G - 0.05 - 0.005
	const a = run(scene([{ id: "c", type: "suction-cup", x: 1.2, y: 0, props: { load_kg: Math.floor(kg * 10) / 10 } }], 1.5))
	const b = run(scene([{ id: "c", type: "suction-cup", x: 1.2, y: 0, props: { load_kg: Math.ceil(kg * 10) / 10 + 0.1 } }], 1.5))
	check("a 5 cm cup on glass holds Δp·A", last(a, "c", "hold_n"), hold, 1e-3, "N", "PIAB: F = Δp·A, Δp 35 kPa provisional")
	claim(`${Math.floor(kg * 10) / 10} kg (under ${fmt(kg)}) holds`, last(a, "c", "holding") === 1)
	claim(`${Math.ceil(kg * 10) / 10 + 0.1} kg (over it) lets go`, last(b, "c", "holding") === 0)
	check("the pull it feels is the weight's own", last(a, "c", "pull_n"), (Math.floor(kg * 10) / 10 + 0.055) * G, 0.02, "N")
	const v = run(scene([{ id: "c", type: "suction-cup", x: 1.2, y: 0, props: { load_kg: 0.5 } }], 1, 0.5, [], { settings: { air: false } }))
	claim("in a vacuum it lets go of even 0.5 kg", last(v, "c", "holding") === 0)
}

// ---------------------------------------------------------------- the can crushed by the air
if (on("can")) {
	console.log("\n# can: condensing steam leaves a few kPa inside; the wall buckles past 8.7 kPa below the room")
	const pcr = core.bucklingPressure(69e9, 0.33, 0.000097, 0.066, 0.115)
	within("a soda can's buckling pressure", pcr / 1000, 8, 9.5, "kPa", "WT34 with E 69 GPa, t 0.097 mm")
	const r = run(scene([{ id: "hot", type: "steam-can", x: 0.3, y: 0 }, { id: "cold", type: "steam-can", x: 1.8, y: 0, props: { boil_s: 0 } }], 4))
	const inside = 0.03 * ATM * (275.15 / 373.15) + core.steamPressure(2)
	check("inside a boiled can cooled to 2 °C", last(r, "hot", "inside_kpa"), inside / 1000, 0.01, "kPa", "IAPWS, Dalton's law")
	claim(`the boiled can is crushed (${fmt(last(r, "hot", "crushed"))} of its volume)`, last(r, "hot", "crushed") > 0.5)
	check("the unheated can's air cooled 20 → 2 °C", last(r, "cold", "inside_kpa"), (ATM * (275.15 / 293.15)) / 1000, 0.01, "kPa", "CHARLES (Gay-Lussac)")
	claim(`the unheated can (only ${fmt((ATM - last(r, "cold", "inside_kpa") * 1000) / 1000)} kPa below the room, under ${fmt(pcr / 1000)}) is not crushed`, last(r, "cold", "crushed") === 0)
	const v = run(scene([{ id: "hot", type: "steam-can", x: 0.3, y: 0 }], 3, 0.5, [], { settings: { air: false } }))
	claim("with no air outside nothing crushes it", last(v, "hot", "crushed") === 0)
}

if (on("steam")) {
	console.log("\n# steam: water's vapour pressure (Buck) against the steam tables")
	for (const [tc, kpa] of [[0, 0.6112], [20, 2.3393], [50, 12.352], [100, 101.42]] as const) check(`at ${tc} °C`, core.steamPressure(tc) / 1000, kpa, 0.006 * kpa, "kPa", "IAPWS")
}

// ---------------------------------------------------------------- flight
if (on("flight")) {
	console.log("\n# flight: gliders trim and glide as their flat-plate wings say")
	// the trim of each design from its surfaces as the builder makes them (the pitching moment about its balance point zero, flying straight), and
	// its glide ratio there, L/D = C_L/C_D: then a long glide from 20 m (its phugoid averaged out over 8 s) must follow it
	for (const [design, lo, hi] of [["balsa glider", 6, 10], ["glider", 3, 6], ["dart", 2.5, 5]] as const) {
		const s0 = scene([{ id: "p", type: "paper-airplane", x: 0, y: 20, props: { design, launch_angle: 0, launch_speed: 4 } }], 12, 0.2, [], { stage: { x0: -0.5, x1: 80, y0: -0.2, y1: 25 } })
		const R0 = run(s0)
		const rec = R0.doc.processes.find((p: Any) => p.role === "glider")
		const plane = R0.doc.solids.find((x: Any) => x.id === "p/plane")
		const pts = plane.body.points
		let A2 = 0
		let cx = 0
		for (let k = 0; k < pts.length; k++) {
			const a = pts[k]
			const b = pts[(k + 1) % pts.length]
			const c = a.x * b.y - b.x * a.y
			A2 += c
			cx += (a.x + b.x) * c
		}
		cx /= 3 * A2
		const coef = (alpha: number) => {
			let L = 0
			let D = 0
			let M = 0
			for (const sf of rec.surfaces) {
				const a = alpha + sf.ang
				const cn = core.normalCoefficient(a, sf.AR)
				// (flying along +x, level: the normal force's lift and drag shares, and its moment about the balance point from where it acts)
				L += (sf.S * cn * Math.cos(a)) / 0.01
				D += (sf.S * (cn * Math.sin(a) + sf.cd0)) / 0.01
				const xcp = sf.lx - sf.c * core.pressureCentre(a)
				M += ((sf.S * cn) / 0.01) * (xcp - cx)
			}
			return { L, D, M }
		}
		let lo2 = -0.1
		let hi2 = 0.4
		for (let k = 0; k < 60; k++) {
			const mid = (lo2 + hi2) / 2
			if (coef(mid).M > 0) lo2 = mid
			else hi2 = mid
		}
		const alpha = (lo2 + hi2) / 2
		const trim = coef(alpha)
		within(`${design}: trimmed at ${fmt(alpha * 57.2958)}°, its wings' glide ratio L/D`, trim.L / trim.D, lo, hi, ":1", "SIMONS (provisional ranges)")
		// its folded keel (the side outline) meets the air too, the engine's flat-plate drag on its outline: 1.05 × depth × its height across the flow
		let y0 = Infinity
		let y1 = -Infinity
		for (const q of pts) {
			const y = q.x * Math.sin(alpha) + q.y * Math.cos(alpha)
			y0 = Math.min(y0, y)
			y1 = Math.max(y1, y)
		}
		const keel = (1.05 * plane.body.depth * (y1 - y0)) / 0.01
		const a = pose(R0, "p/plane", 3)
		const b = pose(R0, "p/plane", 11)
		check(`${design}: its long glide from 20 m (3 to 11 s) follows its trim, keel drag included`, (b.x - a.x) / (a.y - b.y), trim.L / (trim.D + keel), 0.08 * (trim.L / (trim.D + keel)), ":1")
	}
	// a flat plate square to the flow: C_N 1.2 (Hoerner 1.17); the slope of lift at small angles: Helmbold's
	check("flat plate broadside", core.normalCoefficient(Math.PI / 2, 1), 1.17, 0.04, "", "HOE")
	check("lift slope of a 6:1 wing", (core.normalCoefficient(0.01, 6) - core.normalCoefficient(-0.01, 6)) / 0.02, (2 * Math.PI * 6) / (2 + Math.sqrt(40)), 0.05, "/rad", "ANDERSON")
	// in a vacuum it has no lift: it falls as g
	const v = run(scene([{ id: "p", type: "paper-airplane", x: 0.5, y: 1.8, props: { launch_speed: 0 } }], 0.8, 0.2, [], { settings: { air: false } }))
	check("in a vacuum it drops as a stone (0.4 s: ½gt²)", pose(v, "p/plane", 0.2).y - pose(v, "p/plane", 0.6).y, 0.5 * G * 0.16, 0.01, "m")
}

// ---------------------------------------------------------------- kites
if (on("kite")) {
	console.log("\n# kite: it flies in a breeze; its line lines up with the air's push and its weight")
	const r = run(scene([{ id: "w", type: "breeze", x: -0.45, y: 0, props: { speed: 5 } }, { id: "k", type: "kite", x: 0.4, y: 0, props: {} }], 6, 0.3))
	within("it flies high on its 1.5 m line", last(r, "k", "height_m"), 1.0, 1.5, "m")
	within("its line's angle", last(r, "k", "line_angle_deg"), 40, 80, "°", "kites fly at 40-70° in a steady breeze")
	const still = run(scene([{ id: "k", type: "kite", x: 0.4, y: 0, props: {} }], 3, 0.3))
	claim(`with no wind it falls (${fmt(last(still, "k", "height_m"))} m)`, last(still, "k", "height_m") < 0.2)
	const strong = run(scene([{ id: "w", type: "breeze", x: -0.45, y: 0, props: { speed: 8 } }, { id: "k", type: "kite", x: 0.4, y: 0, props: {} }], 6, 0.3))
	within("pull at 8 m/s over pull at 5 m/s (∝ v² when the kite's weight is small)", last(strong, "k", "pull_n") / last(r, "k", "pull_n"), 1.8, 2.8, "", "lift ∝ ½ρv²")
}

// ---------------------------------------------------------------- the wind meter and the smoke
if (on("wind")) {
	console.log("\n# wind: the anemometer reads the fan's jet (Rajaratnam)")
	const r = run(scene([
		{ id: "fan", type: "fan", x: -0.2, y: 0.215, props: { speed: 5, diameter: 0.3 } },
		{ id: "near", type: "anemometer", x: 0.4, y: 0, props: { height: 0.17 } },
		{ id: "far", type: "anemometer", x: 2.9, y: 0, props: { height: 0.17 } }
	], 1.5, 0.3))
	check("inside the jet's core it reads the fan's speed", last(r, "near", "wind_ms"), 5, 0.01, "m/s", "RAJ")
	// at 3.1 m - 0.02 from the outlet, on its axis (the cups 0.015 m under it): 5·6.2·0.27/x and a Gaussian of half-width 0.094·x
	const x = 2.9 - (-0.2 + 0.02)
	const centre = (5 * 6.2 * 0.27) / x
	const half = 0.094 * x
	check("past the core it reads 5·6.2·d/x", last(r, "far", "wind_ms"), centre * Math.exp(-Math.LN2 * (0.0 / half) ** 2), 0.02, "m/s", "RAJ")
}

if (on("wind")) {
	console.log("\n# wind tunnel: an even stream through its duct (the jet 2 × its height across)")
	const r = run(scene([
		{ id: "t", type: "wind-tunnel", x: 1.3, y: 0, props: { speed: 4 } },
		{ id: "a", type: "anemometer", x: 1.0, y: 0, props: { height: 0.12 } },
		{ id: "b", type: "anemometer", x: 1.8, y: 0, props: { height: 0.2 } }
	], 1.5, 0.3))
	// the inlet at x 0.7, 0.15 m up; the cups 0.165 and 0.245 m up at 0.3 and 1.1 m along: centre 4·min(1, 6.2·0.6/x), half-width max(0.3, 0.094·x)
	for (const [id, along, cy] of [["a", 0.3, 0.165], ["b", 1.1, 0.245]] as const) {
		const centre = 4 * Math.min(1, (6.2 * 0.6) / along)
		const half = Math.max(0.3, 0.094 * along)
		check(`a wind meter ${along} m in (cups ${fmt(cy - 0.15)} m off its axis)`, last(r, id, "wind_ms"), centre * Math.exp(-Math.LN2 * ((cy - 0.15) / half) ** 2), 0.01, "m/s", "RAJ")
	}
	within("the stream's speed at the duct's walls over its middle", Math.exp(-Math.LN2 * (0.15 / 0.3) ** 2), 0.8, 1, "", "even within 16 %")
}

if (on("smoke")) {
	console.log("\n# smoke: its own plume and a breeze carry it")
	const F = core.buoyancyFlux(1.5, G, 293.15)
	within("an incense stick's plume 10 cm up", core.plumeSpeed(F, 0.1), 0.15, 0.35, "m/s", "MTT")
	const r = run(scene([{ id: "s", type: "incense-stick", x: 1.2, y: 0 }], 6, 0.3))
	within("in still air its smoke rises", last(r, "s", "rise_m"), 0.2, 0.8, "m")
	within("and hardly drifts", last(r, "s", "drift_m"), -0.06, 0.06, "m")
	const w = run(scene([{ id: "wind", type: "breeze", x: -0.45, y: 0, props: { speed: 1 } }, { id: "s", type: "incense-stick", x: -0.2, y: 0 }], 4, 0.3))
	// a puff's mean age over the stream (0.5 s and older, up to 4 s): its mean drift is the breeze's speed × that age, about 2.3 s
	const v = run(scene([{ id: "wind", type: "breeze", x: -0.45, y: 0, props: { speed: 1 } }, { id: "s", type: "incense-stick", x: -0.2, y: 0 }], 2, 0.3))
	within("in a 1 m/s breeze its smoke drifts downwind", last(w, "s", "drift_m"), 1.5, 3.0, "m")
	claim("drifting farther as the puffs age", last(w, "s", "drift_m") > last(v, "s", "drift_m"))
	// convection: warm air rises over a pan of 95 °C water (the heat module's reading), carrying the smoke of a stick beside it up faster
	const h = run(scene([
		{ id: "pan", type: "saucepan", x: 1.2, y: 0, props: { water_temp_c: 95 } },
		{ id: "near", type: "incense-stick", x: 1.3, y: 0 },
		{ id: "far", type: "incense-stick", x: 2.6, y: 0 }
	], 5, 0.3))
	claim(`over hot water warm air rises: the smoke beside the pan climbs ${fmt(last(h, "near", "rise_m"))} m, the far stick's ${fmt(last(h, "far", "rise_m"))} m`, last(h, "near", "rise_m") > 1.8 * last(h, "far", "rise_m"))
	const vac = run(scene([{ id: "s", type: "incense-stick", x: 1.2, y: 0 }], 1, 0.3, [], { settings: { air: false } }))
	check("no air: no smoke", last(vac, "s", "puffs"), 0, 0, "puffs")
}

// ---------------------------------------------------------------- the same bits every run
if (on("determinism")) {
	console.log("\n# determinism: every air item twice")
	const s = scene([
		{ id: "b", type: "party-balloon", x: 0.2, y: 0.6, angle: -90, props: { tied: false } },
		{ id: "h", type: "hot-air-balloon", x: 0.9, y: 0, props: { tether_m: 0.5 } },
		{ id: "s", type: "incense-stick", x: 1.5, y: 0 },
		{ id: "k", type: "kite", x: 1.6, y: 0 },
		{ id: "w", type: "breeze", x: -0.45, y: 0, props: { speed: 4 } },
		{ id: "c", type: "steam-can", x: 2.2, y: 0 },
		{ id: "p", type: "paper-airplane", x: 0, y: 1.8 }
	], 3)
	const a = JSON.stringify(run(s).track)
	const b = JSON.stringify(run(s).track)
	claim(`the same track twice (${a.length} bytes)`, a === b)
}

// ---------------------------------------------------------------- random scenes: never NaN, never an exception
// ---------------------------------------------------------------- the 2026-10-20 review's repairs
if (on("repair")) {
	console.log("\n# repair: a jar's thin air (buoyancy, drag), bursting in view, local heat, airless worlds, the bell jar, planes on one lane, events")
	const evOf = (r: Any) => (r.summary.happenings ?? []).map((e: Any) => e.text as string)
	// a balloon in a jar pumped to 12.5 kPa: its outside air is 0.149 kg/m³, so it sinks (it rests on the jar's floor), lift = ρ_jar·V − rubber − gas
	{
		const r = run(scene([
			{ id: "jar", type: "vacuum-jar", x: 1.2, y: 0, props: { pump_at: 0.5, pump_s: 1, lowest_kpa: 12.5 } },
			{ id: "b", type: "party-balloon", x: 1.2, y: 0.08, props: { size: 0.12, fill_l: 0.3 } }
		], 8, 0.3))
		const rec = r.doc.processes.find((p: Any) => p.item === "b")
		const V = last(r, "b", "volume_l") / 1000
		const p = last(r, "jar", "pressure_kpa") * 1000
		const lift = (RHO * (p / ATM) * V - rec.rubber - rec.moles * rec.molar) * 1000
		check("its net lift in the jar's thin air (ρ_jar·V − rubber − gas)", last(r, "b", "lift_g"), lift, 1e-5, "g", "ISO2533, ideal gas (the reading to 5 decimals)")
		claim(`it sinks there: lift ${fmt(last(r, "b", "lift_g"))} g < 0`, last(r, "b", "lift_g") < 0)
		const sid = "b/balloon"
		const bottom = (t: number) => pose(r, sid, t).y - valueAt(r, "b", "diameter_cm", t) / 200
		within("it stays on the jar's floor (its bottom over the plate's top, 2 cm) at 3, 5 and 8 s", Math.max(bottom(3), bottom(5), bottom(8)), 0.0185, 0.026, "m", "it cannot float in 0.15 kg/m³ air")
		claim(`it swelled ${fmt(valueAt(r, "b", "diameter_cm", 0.2))} → ${fmt(last(r, "b", "diameter_cm"))} cm and the run says so`, evOf(r).some((t: string) => /swelled from/.test(t)))
	}
	// a feather and a coin in a jar pumped to 0.1 kPa fall together as in a vacuum; in the open (and in a control jar) the coin wins
	{
		const r = run(scene([
			{ id: "jar", type: "vacuum-jar", x: 1.2, y: 0, props: { width: 0.4, height: 0.8, pump_at: 0, pump_s: 0.3, lowest_kpa: 0.1 } },
			{ id: "f", type: "feather", x: 1.1, y: 0.7, held: true, props: { kind: "craft" } }, { id: "c", type: "coin-flat", x: 1.3, y: 0.7, held: true },
			{ id: "f2", type: "feather", x: 2.2, y: 0.7, held: true, props: { kind: "craft" } }, { id: "c2", type: "coin-flat", x: 2.5, y: 0.7, held: true }
		], 5, 2.5, [{ kind: "lands_together", a: "f", b: "c" }, { kind: "lands_first", a: "c2", b: "f2" }]))
		const [g1, g2] = r.summary.goals
		claim(`in the jar (0.1 kPa) the feather and the coin land together (${g1.ta} / ${g1.tb} s)`, g1.ok)
		claim(`in the open the coin lands first (${g2.ta} / ${g2.tb} s)`, g2.ok)
		// free fall from rest: the feather's bottom 0.698 m over the plate's top, t = √(2h/g)
		const h = 0.7 - 0.002 - 0.02
		check("the feather's fall in the pumped jar against free fall √(2h/g)", g1.ta - 2.5, Math.sqrt((2 * h) / G), 0.012, "s", "Galileo: no air, no drag")
	}
	// the vacuum tube: pumped, a feather keeps up with the coin; with its air, the feather is far behind
	{
		const r = run(scene([
			{ id: "tube", type: "vacuum-tube", x: 0.6, y: 0 }, { id: "f1", type: "feather", x: 0.53, y: 1.35, held: true, props: { kind: "craft" } }, { id: "c1", type: "coin-flat", x: 0.69, y: 1.35, held: true },
			{ id: "tube2", type: "vacuum-tube", x: 1.9, y: 0, props: { pumped: false } }, { id: "f2", type: "feather", x: 1.83, y: 1.35, held: true, props: { kind: "craft" } }, { id: "c2", type: "coin-flat", x: 1.99, y: 1.35, held: true }
		], 5, 2.5, [{ kind: "lands_together", a: "f1", b: "c1" }, { kind: "lands_first", a: "c2", b: "f2" }]))
		check("the tube's pressure at the drop", valueAt(r, "tube", "pressure_kpa", 2.5), 0.1 + 101.225 * Math.exp(-2.5 / 0.4), 1e-3, "kPa", "a pumped-down volume")
		claim(`pumped tube: they land together; the control's coin first (${r.summary.goals.map((g: Any) => `${g.ta}/${g.tb}`).join(", ")} s)`, r.summary.goals.every((g: Any) => g.ok))
		check("the control tube keeps the room's air", last(r, "tube2", "pressure_kpa"), 101.325, 1e-9, "kPa")
	}
	// bursting in view: no air (settings), over-filled, pricked at 0 s: drawn as filled while held, then gone within 0.3 s of the release, with its event
	for (const [name, props, extra] of [["in no air", { gas: "helium" }, { settings: { air: false } }], ["over-filled (40 L in a 12 cm balloon)", { fill_l: 40, size: 0.12 }, {}], ["pricked at 0 s", { prick_at: 0 }, {}]] as const) {
		const r = run(scene([{ id: "b", type: "party-balloon", x: 1.2, y: 1.0, props }], 2, 0.5, [], extra))
		const t = firstTime(r, "b", "popped", (v) => v >= 1) ?? -1
		const shown = valueAt(r, "b", "diameter_cm", 0.25)
		const late = name === "pricked at 0 s" ? 0 : 0.3
		claim(`${name}: shown ${fmt(shown)} cm across while held, popped at ${fmt(t)} s (the release 0.5 s + ${late}), "${evOf(r).find((e: string) => /popped/.test(e)) ?? "no event"}"`,
			shown > 10 && Math.abs(t - (0.5 + late)) <= 0.02 && evOf(r).some((e: string) => /popped \(/.test(e)))
	}
	// an airless world named by its gravity alone: the Moon has no air, so a helium balloon does not float (it bursts)
	{
		const r = run(scene([{ id: "b", type: "party-balloon", x: 1.2, y: 1.0, props: { gas: "helium" } }], 2, 0.3, [], { settings: { gravity: "moon" } }))
		claim(`gravity "moon" alone: doc.settings ${JSON.stringify(r.doc.settings)}, the balloon popped (${firstTime(r, "b", "popped", (v) => v >= 1)} s) and never rose`,
			r.doc.settings?.air === false && firstTime(r, "b", "popped", (v) => v >= 1) !== null && Math.max(...r.track.frames.map((f: Any) => f.placements["b/balloon"].y)) <= 1.0 + 1e-9)
		const r2 = run(scene([{ id: "b", type: "party-balloon", x: 1.2, y: 1.0, props: { gas: "helium" } }], 2, 0.3, [], { settings: { gravity: "moon", air: true } }))
		claim("gravity moon with air: true kept (a scene that says so)", r2.doc.settings?.air === undefined && last(r2, "b", "popped") === 0)
	}
	// Charles from local heat: a balloon held over a pan of 90 °C water warms toward its plume's air; its volume follows its gas's temperature
	{
		const r = run(scene([{ id: "pan", type: "saucepan", x: 1.2, y: 0, props: { water_temp_c: 90 } }, { id: "b", type: "party-balloon", x: 1.2, y: 0.35, held: true }], 10, 10))
		const T0 = 293.15
		const T1 = valueAt(r, "b", "gas_c", 9.9) + 273.15
		const pv = (t: number) => (ATM + valueAt(r, "b", "pressure_kpa", t) * 1000) * valueAt(r, "b", "volume_l", t)
		claim(`its gas warmed: ${fmt(T0 - 273.15)} → ${fmt(T1 - 273.15)} °C over the pan`, T1 > T0 + 1)
		check("Charles: (P + Δp)·V ∝ T (at 9.9 s)", pv(9.9) / pv(0), T1 / T0, 1e-4, "", "CHARLES")
		const r2 = run(scene([{ id: "hp", type: "hot-plate", x: 1.2, y: 0, props: { power_w: 1500 } }, { id: "b", type: "party-balloon", x: 1.2, y: 0.4, held: true }], 6, 3, [], { settings: { time_lapse: 60 } }))
		claim(`let down onto a 250 °C hot plate it pops on touching it: "${evOf(r2).find((e: string) => /popped/.test(e))}"`, evOf(r2).some((e: string) => /touched hp at \d+ °C/.test(e)))
	}
	// the waves module's bell jar: a balloon in it follows its straight-line pump-down (Boyle) and pops when it is nearly empty
	{
		const r = run(scene([{ id: "jar", type: "bell-jar", x: 1.3, y: 0 }, { id: "b", type: "party-balloon", x: 1.235, y: 0.071, props: { size: 0.12, fill_l: 0.3 } }], 8, 0.3))
		check("the bell jar's pressure at 3 s (100 % → 0 % air from 1 s to 5 s)", valueAt(r, "jar", "pressure_kpa", 3), 101.325 * 0.5, 0.2, "kPa", "its own pump-down")
		const pv = (t: number) => (valueAt(r, "jar", "pressure_kpa", t) * 1000 + valueAt(r, "b", "pressure_kpa", t) * 1000) * valueAt(r, "b", "volume_l", t)
		check("Boyle in the bell jar: (P_jar + Δp)·V at 3 s = at 0.2 s", pv(3), pv(0.2), pv(0.2) * 2e-3, "J", "BOYLE")
		claim(`it pops as the bell jar empties (${firstTime(r, "b", "popped", (v) => v >= 1)} s)`, firstTime(r, "b", "popped", (v) => v >= 1) !== null)
	}
	// a speaker inside a pumped vacuum jar is heard less and less (the waves module's jar law, given by this module's build hook)
	{
		const r = run(scene([
			{ id: "jar", type: "vacuum-jar", x: 1.0, y: 0, props: { pump_at: 1, pump_s: 1, lowest_kpa: 0.1 } }, { id: "spk", type: "speaker", x: 1.0, y: 0.02 },
			{ id: "m", type: "sound-meter", x: 2.0, y: 0 }
		], 6, 0.3))
		const src = r.doc.processes.find((p: Any) => p.kind === "sound" && p.item === "spk")
		const at = (t: number) => valueAt(r, "m", "level", t)
		claim(`the speaker's record gets the jar's pump-down (${JSON.stringify(src?.jar)}) and the meter falls ${fmt(at(0.9))} → ${fmt(at(5.5))} dB (the quiet room's floor)`, src?.jar?.t1 === 4 && at(5.5) < at(0.9) - 10)
	}
	// a paper plane stops where it lands; two planes on one lane pass through each other (each flies as alone)
	{
		const lane = { stage: { x0: -0.6, x1: 14, y0: -0.2, y1: 3 } }
		const floor = { id: "table", type: "table", x: 6.5, y: 0, props: { width: 14 } }
		const alone = (design: string, x: number) => run(scene([], 6, 0.3, [], { ...lane, items: [floor, { id: "p", type: "paper-airplane", x, y: 1.5, props: { design } }] }))
		const two = run(scene([], 6, 0.3, [{ kind: "glides_farther", a: "g", b: "d" }],
			{ ...lane, items: [floor, { id: "g", type: "paper-airplane", x: 0, y: 1.5, props: { design: "glider" } }, { id: "d", type: "paper-airplane", x: 0.3, y: 1.5, props: { design: "dart" } }] }))
		const d1 = alone("dart", 0.3)
		const g1 = alone("glider", 0)
		check("the dart thrown beside the glider flies as far as alone", last(two, "d", "distance_m"), last(d1, "p", "distance_m"), 1e-9, "m")
		check("the glider beside the dart flies as far as alone", last(two, "g", "distance_m"), last(g1, "p", "distance_m"), 1e-9, "m")
		const xEnd = two.track.frames.at(-1).placements["d/plane"].x
		const xLand = 0.3 + last(two, "d", "distance_m")
		within("the landed dart lies within 30 cm of where it touched down", Math.abs(xEnd - xLand), 0, 0.3, "m", "paper skids a hand's width")
		claim(`glides_farther: ${two.summary.goals[0].label} (${two.summary.goals[0].distance_a} vs ${two.summary.goals[0].distance_b} m)`, two.summary.goals[0].ok)
	}
	// the run says what the air showed (smoke, a wind meter, a card, a cup, a can that was not crushed, a kite)
	{
		const r = run(scene([
			{ id: "fan", type: "fan", x: 0.2, y: 0.2, props: { speed: 3 } }, { id: "s", type: "incense-stick", x: 0.8, y: 0 }, { id: "a", type: "anemometer", x: 1.2, y: 0, props: { height: 0.16 } },
			{ id: "g", type: "card-glass", x: 1.7, y: 0 }, { id: "c", type: "suction-cup", x: 2.3, y: 0 }, { id: "k", type: "steam-can", x: 2.8, y: 0, props: { boil_s: 0 } }
		], 4, 0.3))
		const ev = evOf(r)
		for (const re of [/^smoke from .* drifts right/, /reads 3\.0 m\/s/, /card stays up/, / holds \(the load pulls/, /is not crushed/])
			claim(`the run's story says /${re.source}/`, ev.some((e: string) => re.test(e)))
	}
	// the new goal kinds on real runs: jets (untied only), swells, rises_faster (two identical sticks never "rise faster")
	{
		const r = run(scene([
			{ id: "u", type: "party-balloon", x: 0.3, y: 1.0, angle: -90, props: { tied: false, fill_l: 10 } }, { id: "t", type: "party-balloon", x: 0.3, y: 1.8, angle: -90, props: { fill_l: 10 } },
			{ id: "s1", type: "incense-stick", x: 1.5, y: 0 }, { id: "s2", type: "incense-stick", x: 2.5, y: 0 }
		], 6, 0.3, [{ kind: "jets", item: "u", toward: "right", at_least_m: 1 }, { kind: "jets", item: "t", toward: "right" }, { kind: "rises_faster", a: "s1", b: "s2" }, { kind: "rises_faster", a: "s2", b: "s1" }, { kind: "shrinks", item: "u", at_least_x: 1.2 }]))
		const ok = r.summary.goals.map((g: Any) => g.ok)
		claim(`jets: the untied balloon passes, the tied one fails; two identical sticks: neither rises faster; the untied balloon shrinks (${ok.join(", ")})`, JSON.stringify(ok) === JSON.stringify([true, false, false, false, true]))
	}
}

if (on("fuzz")) {
	console.log("\n# fuzz: random air scenes")
	let seed = 20261019
	const rnd = () => {
		seed ^= seed << 13
		seed >>>= 0
		seed ^= seed >>> 17
		seed ^= seed << 5
		seed >>>= 0
		return seed / 4294967296
	}
	const cat = sim.catalog()
	const air = cat.types.filter((t: Any) => t.module === "air")
	let bad = 0
	const N = 150
	for (let k = 0; k < N; k++) {
		const items: Any[] = []
		for (let i = 0; i < 1 + Math.floor(rnd() * 4); i++) {
			const t = air[Math.floor(rnd() * air.length)]
			const props: Any = {}
			for (const p of t.props) {
				if (p.common || ["material", "bounce", "friction", "rolling", "side"].includes(p.key) || rnd() < 0.5) continue
				props[p.key] = p.kind === "choice" ? p.choices[Math.floor(rnd() * p.choices.length)] : p.kind === "bool" ? rnd() < 0.5 : p.kind === "int" ? Math.round(p.min + rnd() * (p.max - p.min)) : p.min + rnd() * (p.max - p.min)
			}
			items.push({ id: `i${i}`, type: t.key, x: -0.3 + rnd() * 3.2, y: rnd() * 1.6, angle: rnd() < 0.3 ? rnd() * 360 - 180 : 0, props })
		}
		if (rnd() < 0.3) items.push({ id: "w", type: "breeze", x: -0.45, y: 0, props: { speed: 2 + rnd() * 10 } })
		const extra = rnd() < 0.2 ? { settings: [{ air: false }, { room_temp: -30 }, { room_temp: 50 }, { gravity: "moon" }][Math.floor(rnd() * 4)] } : {}
		try {
			const r = run(scene(items, 1.5, 0.3, [], extra))
			for (const f of r.track.frames) for (const p of Object.values(f.placements) as Any[]) if (![p.x, p.y, p.angle].every(Number.isFinite)) throw new Error("non-finite placement")
			for (const keys of Object.values(r.track.state ?? {}) as Any[]) for (const v of Object.values(keys) as number[][]) if (!v.every(Number.isFinite)) throw new Error("non-finite reading")
		} catch (e) {
			bad++
			console.log("   ", (e as Error).message, JSON.stringify(items).slice(0, 300))
		}
	}
	check(`${N} random scenes without an exception or a NaN`, bad, 0, 0, "bad")
}

console.log(`\n${checks - failures} of ${checks} checks pass${failures ? `; ${failures} FAIL` : ""}`)
process.exit(failures ? 1 : 0)
