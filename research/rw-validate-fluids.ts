// The liquids module against theory and measurements (tooling/src/sim/fluids.ts, tooling/src/sim/modules/fluids.ts, machines/mod_fluids.py and
// its port web/sim/modules/fluids.js). Every scene is built by web/sim (the exact port of the Python builder) and run by the server's engine
// (node, with the browser bundle's math), at 480 Hz, 120 frames a second. Exits 1 on any failure (a gate).
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-fluids.ts [archimedes|float|ice|sink|stokes|rise|displace|clay|egg|pennies|sails|column|spill|vessel|surface|capillary|soapboat|determinism|fuzz|all]
// Reference values (cited where they are used):
//   [IAPWS-95] water at 20 °C 998.2 kg/m³, 1.002 mPa·s; [SHARQAWY] sea water 1024.8 kg/m³; [CRC] NaCl solutions (12 % 1085.7 kg/m³), ice 917 kg/m³;
//   [LAMB] Hydrodynamics §92: a sphere's added mass ½ρV; [CLIFT] Clift, Grace & Weber, Bubbles, Drops and Particles (1978): the sphere drag curve
//   (Clift & Gauvin's fit, within 6 % of measurements to Re 3·10⁵); [STOKES] F = 6πμrv for Re ≪ 1 (Stokes 1851); [HAMILTON] a fresh egg 1.065-1.100
//   (1.08 used); [USMINT] a cent 2.500 g; [ORTIZ]/[HOE] the sail's push 0.8 × ½ρAv² set 45° to the wind (1.17 square to it); [RAJ] Rajaratnam's
//   round jet (the engine's fan: full speed for 6.2 jet diameters, then ∝ 1/x).
import { pathToFileURL } from "node:url"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const sim = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as {
	clean: (s: unknown) => Scene
	layout: (s: unknown) => { doc: Doc; resolved: Record<string, Record<string, unknown>> }
	finish: (s: unknown, d: Doc, r: unknown, t: Track) => { summary: { goals: { ok: boolean; label: string }[]; readings?: Record<string, Record<string, number>> } }
	plugins: { floatHeight: (t: unknown, c: unknown) => number | null; containerInterior: (t: string, p: unknown) => { x0: number; x1: number; floor: number; rim: number } | null }
}
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: unknown } }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: unknown, fps: number) => Track }
await import(`${PG}/tooling/src/sim/modules/index.ts`)
const core = (await import(`${PG}/tooling/src/sim/fluids.ts`)) as typeof import("../tooling/src/sim/fluids.ts")
const FL = (await import(pathToFileURL(`${PG}/web/sim/modules/fluids.js`).href)) as { restingY: (t: unknown, c: unknown) => number | null }
const plug = (await import(`${PG}/tooling/src/sim/plugins.ts`)) as { slimExtras: (t: Track, r: (v: number, d: number) => number) => { state?: Track["state"] } }

type Scene = { items: Item[]; [k: string]: unknown }
type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; held?: boolean; fixed?: boolean; name?: string }
type Doc = { solids: { id: string; item: string; kind: string; body: { kind: string; radius?: number; width?: number; height?: number; depth?: number; points?: { x: number; y: number }[] }; material: string; at: { x: number; y: number } }[]; materials: Record<string, { density: number }>; processes?: { kind: string; item?: string; [k: string]: unknown }[] }
type Track = { frames: { t: number; placements: Record<string, { x: number; y: number; angle: number }> }[]; state?: Record<string, Record<string, number[]>> }

const G = 9.81
const AIR = 1.2
const WATER = 998.2
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const want = process.argv[2] ?? "all"
let failures = 0
let checks = 0
const line = (ok: boolean, text: string) => {
	checks++
	if (!ok) failures++
	console.log(`${ok ? "PASS" : "FAIL"}  ${text}`)
}
const check = (label: string, got: number, ref: number, tol: number, unit = "", src = "") =>
	line(Math.abs(got - ref) <= tol, `${label}: ${fmt(got)} ${unit} vs ${fmt(ref)} ${unit} (± ${fmt(tol)})${src ? `  [${src}]` : ""}`)
const claim = (label: string, ok: boolean) => line(ok, label)
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(2) : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(5))

const scene = (items: Item[], seconds = 4, release = 0.5, goals: unknown[] = []): Scene => ({ version: 2, name: "v", seconds, release, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0 }, ...items], goals }) as unknown as Scene
const run = (s: Scene) => {
	const c = sim.clean(s)
	const { doc, resolved } = sim.layout(c)
	const raw = simulate(admitDocument(doc).scene, 120)
	const track = { ...raw, ...plug.slimExtras(raw, (v, d) => Number(v.toFixed(d))) } as Track
	const summary = sim.finish(c, doc, resolved, track).summary
	return { doc, resolved, track, summary, scene: c }
}
const at = (track: Track, t: number) => track.frames.reduce((a, f) => (Math.abs(f.t - t) < Math.abs(a.t - t) ? f : a), track.frames[0] as Track["frames"][0])
const reading = (track: Track, item: string, key: string, t?: number) => {
	const v = track.state?.[item]?.[key]
	if (!v) return Number.NaN
	if (t === undefined) return v[v.length - 1] as number
	const i = track.frames.indexOf(at(track, t))
	return v[i] as number
}
const tank = (id: string, x: number, props: Record<string, unknown> = {}, y = 0): Item => ({ id, type: "water-tank", x, y, props: { style: "aquarium", ...props } })
/** A thing put into a container at its floating height (the module's own placement rule, as the AI's solver uses it), or where given. */
const into = (thing: Item, c: Item): Item => {
	const y = sim.plugins.floatHeight({ type: thing.type, props: thing.props ?? {}, x: thing.x, angle: thing.angle ?? 0 }, { type: c.type, props: c.props ?? {}, x: c.x, y: c.y })
	// (one that sinks starts resting on the inner floor)
	const ry = y ?? FL.restingY({ type: thing.type, props: thing.props ?? {}, x: thing.x, angle: thing.angle ?? 0 }, { type: c.type, props: c.props ?? {}, x: c.x, y: c.y })
	return { ...thing, y: ry ?? thing.y }
}
const area = (pts: { x: number; y: number }[]) => {
	let a = 0
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i] as { x: number; y: number }
		const q = pts[(i + 1) % pts.length] as { x: number; y: number }
		a += p.x * q.y - q.x * p.y
	}
	return Math.abs(a) / 2
}
const surfaceOf = (c: Item) => {
	const inner = sim.plugins.containerInterior(c.type, c.props ?? {}) as { floor: number }
	const { resolved } = sim.layout(sim.clean(scene([c])))
	return c.y + inner.floor + (resolved[c.id]?.fill as number)
}

// ---------------------------------------------------------------- Archimedes, exact
if (want === "all" || want === "archimedes") {
	console.log("\n== archimedes: the liquid's push is ρ·g·V of the part under the surface [Archimedes; IAPWS-95 water]")
	// core: a 6 × 4 × 5 cm block held with its bottom 2.7 cm under a 20 cm surface in 998.2 water: the lift is (ρ − ρ_air)·g·V exactly (the air's is the engine's)
	const region = { id: "t", item: "t", x0: -0.2, x1: 0.2, floor: 0, rim: 0.4, area: 0.4 * 0.2, layers: [{ words: "water", density: WATER, viscosity: 0.001002, height: 0.2 }] }
	const st = core.regionState(region)
	const pts = (y: number) => [{ x: -0.03, y }, { x: 0.03, y }, { x: 0.03, y: y + 0.04 }, { x: -0.03, y: y + 0.04 }]
	const body = { key: 1, mass: 0.1, inertia: 1e-4, com: { x: 0, y: 0.193 }, v: { x: 0, y: 0 }, w: 0, free: false, force: { x: 0, y: 0 }, torque: 0, parts: [{ kind: "prism" as const, points: pts(0.173), depth: 0.05 }] }
	core.updateLevels(st, [body], [])
	const top = st.tops[0] as number
	const vsub = 0.06 * (top - 0.173) * 0.05
	const p = core.fluidPushes([st], [body], 1 / 480).get(1)
	check("core: buoyancy (ρ − ρ_air)·g·V_sub", p?.fy ?? 0, (WATER - AIR) * G * vsub, 1e-12 * WATER * G * vsub, "N", "exact")
	check("core: the level rose by V_sub / area", top - 0.2, vsub / region.area, 1e-12, "m", "volume conserved")
	// engine: an aquarium, a block held 3 cm deep until 3 s: its buoyancy reading against ρ·g·V
	const T = tank("tank", 1.2)
	const surf = surfaceOf(T)
	const r = run(scene([T, { id: "b", type: "wooden-block", x: 1.2, y: surf - 0.03 + 0.025, props: { width: 0.1, height: 0.05, depth: 0.05 }, held: true }], 2, 3))
	const lvl = reading(r.track, "tank", "level_mm", 1) / 1000
	const floor = sim.plugins.containerInterior("water-tank", { style: "aquarium" })?.floor as number
	const sub = 0.1 * 0.05 * (floor + lvl - (surf - 0.03))
	check("engine: a held block's buoyancy reading", reading(r.track, "b", "buoyancy_n", 1), WATER * G * sub, 2e-5, "N", "ρgV, the reading to 5 decimals")
}

// ---------------------------------------------------------------- F1 floating depth and bobbing
if (want === "all" || want === "float") {
	console.log("\n== float (F1): a 10 × 5 × 5 cm hardwood block (700 kg/m³) floats with 0.70 × 5 cm under; it bobs at 2π√((m + m_a)/k)")
	const T = tank("tank", 1.2)
	const b = into({ id: "b", type: "wooden-block", x: 1.2, y: 0, props: { width: 0.1, height: 0.05, depth: 0.05 } }, T)
	const r = run(scene([T, b], 4))
	const rho = r.doc.materials[r.doc.solids.find((s) => s.item === "b")?.material as string]?.density as number
	check("draft at rest", reading(r.track, "b", "draft_mm"), ((rho - AIR) / (WATER - AIR)) * 50, 0.5, "mm", "Archimedes: (ρ_b − ρ_air)/(ρ_w − ρ_air) × 50 mm; spec 35.0 ± 0.5")
	claim(`it floats (afloat ${reading(r.track, "b", "afloat")}) and starts at rest at its floating height (moved ${(Math.abs(at(r.track, 4).placements["b/block"].y - at(r.track, 0).placements["b/block"].y) * 1000).toFixed(2)} mm)`, reading(r.track, "b", "afloat") === 1 && Math.abs(at(r.track, 4).placements["b/block"].y - at(r.track, 0).placements["b/block"].y) < 0.0005)
	// bobbing: pushed 8 mm under its rest and let go; its upward zero crossings
	const r2 = run(scene([T, { ...b, y: b.y - 0.008 }], 3, 0.0))
	const ys = r2.track.frames.map((f) => ({ t: f.t, y: f.placements["b/block"].y }))
	const ups: number[] = []
	for (let i = 2; i < ys.length; i++) {
		const v0 = (ys[i - 1].y - ys[i - 2].y) / (ys[i - 1].t - ys[i - 2].t)
		const v1 = (ys[i].y - ys[i - 1].y) / (ys[i].t - ys[i - 1].t)
		if (v0 < 0 && v1 >= 0) ups.push(ys[i - 1].t)
	}
	const m = rho * 0.1 * 0.05 * 0.05
	const A = 0.1 * 0.05
	const area = 0.5 * (0.25 - 0.012)
	const k = WATER * G * A * (1 + A / area) // (the level falls as it rises: the waterplane's stiffness grows by A/area)
	const ma = 0.5 * WATER * (m / WATER) // the module's block added mass (½ρV_sub, provisional; DNV gives 0.67 for a cube)
	const Tth = 2 * Math.PI * Math.sqrt((m + ma) / k)
	check("bobbing period", (ups[1] ?? 0) - (ups[0] ?? 0), Tth, 0.1 * Tth, "s", "2π√((m + m_a)/(ρgA)); spec within 10 %")
	const amp = (i: number) => Math.max(...ys.filter((p) => p.t > i && p.t < i + Tth).map((p) => p.y)) - Math.min(...ys.filter((p) => p.t > i && p.t < i + Tth).map((p) => p.y))
	claim(`the waves damp it: swing ${((amp(0) / 2) * 1000).toFixed(2)} mm → ${((amp(2) / 2) * 1000).toFixed(3)} mm after 2 s`, amp(2) < 0.25 * amp(0))
}

// ---------------------------------------------------------------- F2 ice
if (want === "all" || want === "ice") {
	console.log("\n== ice (F2): a 4 cm ice cube floats 917/998.2 = 91.9 % under in fresh water, 917/1024.8 = 89.5 % in sea water [CRC; SHARQAWY]")
	for (const [liq, rhoL] of [["water", WATER], ["sea water", 1024.8]] as const) {
		const T = tank("tank", 1.2, { liquid: liq })
		const r = run(scene([T, into({ id: "ice", type: "ice-cube", x: 1.2, y: 0 }, T)], 3))
		check(`share under in ${liq}`, reading(r.track, "ice", "submerged") * 100, ((917 - AIR) / (rhoL - AIR)) * 100, 0.5, "%", "spec ± 0.5 %")
	}
}

// ---------------------------------------------------------------- F4 a steel ball sinks: arrival time against the drag ODE
if (want === "all" || want === "sink") {
	console.log("\n== sink (F4): a 1 in steel ball let go at the surface of a 30 cm aquarium reaches the floor when the drag ODE says [CLIFT; LAMB]")
	const T = tank("tank", 1.2)
	const surf = surfaceOf(T)
	const R = 0.0127
	const r = run(scene([T, { id: "ball", type: "steel-ball", x: 1.2, y: surf, props: { diameter: 2 * R } }], 3, 0.2))
	const floor = (sim.plugins.containerInterior("water-tank", { style: "aquarium" })?.floor as number) + R
	const ys = r.track.frames.map((f) => ({ t: f.t, y: f.placements["ball/ball"].y }))
	const hit = ys.find((p) => p.y <= floor + 0.0005)?.t ?? Number.NaN
	// the ODE: (m + ½ρV)·dv/dt = (m − ρV)·g − ½ρ·C_d(Re)·πR²·v² (from the surface: half under at first, the cap's buoyancy growing as it sinks)
	const rho = r.doc.materials[r.doc.solids.find((s) => s.item === "ball")?.material as string]?.density as number
	const Vb = (4 / 3) * Math.PI * R ** 3
	const m = rho * Vb
	const mu = 0.001002
	const cap = (h: number) => { const d = Math.max(0, Math.min(2 * R, h)); return (Math.PI * d * d * (3 * R - d)) / 3 }
	let y = surf
	let v = 0
	let t = 0.2
	const dt = 1e-5
	const deriv = (yy: number, vv: number) => {
		const Vs = cap(surf - (yy - R))
		const u = Math.abs(vv)
		const re = (WATER * u * 2 * R) / mu
		const cd = re > 0 ? (24 / re) * (1 + 0.15 * re ** 0.687) + 0.42 / (1 + 42500 * re ** -1.16) : 0
		const drag = 0.5 * WATER * cd * Math.PI * R * R * (Vs / Vb) * u * vv
		return (-(m - (WATER - AIR) * Vs - AIR * Vb) * G - drag) / (m + 0.5 * WATER * Vs + 0.5 * AIR * Vb)
	}
	while (y > floor && t < 2) {
		const k1 = deriv(y, v)
		const k2 = deriv(y + (dt / 2) * v, v + (dt / 2) * k1)
		const k3 = deriv(y + (dt / 2) * (v + (dt / 2) * k1), v + (dt / 2) * k2)
		const k4 = deriv(y + dt * (v + (dt / 2) * k2), v + dt * k3)
		y += dt * (v + (dt / 6) * (k1 + k2 + k3))
		v += (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
		t += dt
	}
	check("time to reach the floor", hit, t, 0.05 * (t - 0.2), "s", "RK4 of the drag ODE (Clift–Gauvin, added mass ½ρV); spec within 5 %")
	claim(`it sinks to the floor and rests there (sunk ${reading(r.track, "ball", "sunk")})`, reading(r.track, "ball", "sunk") === 1)
}

// ---------------------------------------------------------------- Stokes: a small steel ball through honey
if (want === "all" || want === "stokes") {
	console.log("\n== stokes: a 5 mm steel ball falls through honey (1420 kg/m³, 10 Pa·s) at Stokes' speed (2/9)·Δρ·g·r²/μ [STOKES]")
	const T: Item = { id: "jar", type: "beaker", x: 1.2, y: 0, props: { size: "1000 mL", fill_ml: 1000, liquid: "honey" } }
	const r = run(scene([T, { id: "ball", type: "steel-ball", x: 1.2, y: 0.11, props: { diameter: 0.005 } }], 4, 0.2))
	const ys = r.track.frames.map((f) => ({ t: f.t, y: f.placements["ball/ball"].y }))
	const a = ys.find((p) => p.t >= 1.5)
	const b = ys.find((p) => p.t >= 3.5)
	const v = a && b ? (a.y - b.y) / (b.t - a.t) : Number.NaN
	const d = r.doc.solids.find((s) => s.item === "ball")
	const rho = r.doc.materials[d?.material as string]?.density as number
	const rr = d?.body.radius as number
	const re = (1420 * ((2 / 9) * (rho - 1420) * G * rr ** 2) / 10 * 2 * rr) / 10
	const vs = (((2 / 9) * (rho - 1420) * G * rr ** 2) / 10) / (1 + 0.15 * re ** 0.687)
	check("terminal speed", v * 1000, vs * 1000, 0.03 * vs * 1000, "mm/s", "Stokes (Re 0.001; walls not modelled); within 3 %")
}

// ---------------------------------------------------------------- a ping-pong ball rises with its added mass
if (want === "all" || want === "rise") {
	console.log("\n== rise: a ping-pong ball let go under water starts up at (ρV − m)·g / (m + ½ρV) [LAMB §92], not (ρV/m − 1)·g")
	const T = tank("tank", 1.2)
	const r = run(scene([T, { id: "pp", type: "ping-pong-ball", x: 1.2, y: 0.08 }], 0.6, 0.2))
	const f = r.track.frames
	const i0 = f.findIndex((x) => x.t >= 0.2)
	const y0 = f[i0]?.placements["pp/ball"].y as number
	const y1 = f[i0 + 1]?.placements["pp/ball"].y as number
	// (the engine's step is semi-implicit Euler: after n steps of 1/480 s from rest, y = a·h²·n(n+1)/2; the first frame is 4 steps)
	const h = 1 / 480
	const acc = (y1 - y0) / ((h * h * 4 * 5) / 2)
	const d = r.doc.solids.find((s) => s.item === "pp")
	const R = d?.body.radius as number
	const V = (4 / 3) * Math.PI * R ** 3
	const rho = r.doc.materials[d?.material as string]?.density as number
	const wall = (d?.body as { wall?: number }).wall
	const m = rho * (4 / 3) * Math.PI * (R ** 3 - Math.max(0, R - (wall ?? R)) ** 3)
	const air = AIR * (4 / 3) * Math.PI * (Math.max(0, R - (wall ?? R)) ** 3 + 0.5 * R ** 3)
	const ref = (((WATER - AIR) * V + AIR * V - m) * G) / (m + air + 0.5 * WATER * V)
	check("first acceleration (its first 8 ms)", acc, ref, 0.02 * ref, "m/s²", "added mass ½ρV, before drag counts")
}

// ---------------------------------------------------------------- F5 displacement
if (want === "all" || want === "displace") {
	console.log("\n== displace (F5): 60 mL in a 100 mL cylinder + 5 glass marbles of 16 mm (2.14 mL each) reads 70.7 mL; a pebble reads its volume")
	const cyl: Item = { id: "cyl", type: "graduated-cylinder", x: 1.2, y: 0, props: { size: "100 mL", fill_ml: 60 } }
	const marbles = [0, 1, 2, 3, 4].map((i) => ({ id: `m${i}`, type: "glass-marble", x: 1.2 + (i % 2 ? 0.002 : -0.002), y: 0.22 + i * 0.03 }))
	const r = run(scene([cyl, ...marbles], 4))
	const d = r.doc.solids.find((s) => s.item === "m0")?.body.radius as number
	check("reading with 5 marbles", reading(r.track, "cyl", "volume_ml"), 60 + 5 * (4 / 3) * Math.PI * d ** 3 * 1e6, 0.25, "mL", "60 + 5 × V_marble; spec 70.7 ± 0.25")
	const r2 = run(scene([cyl, { id: "stone", type: "pebble", x: 1.2, y: 0.24, props: { width: 0.022, height: 0.014 } }], 3))
	const s = r2.doc.solids.find((x) => x.item === "stone")
	let area = 0
	const pts = s?.body.points as { x: number; y: number }[]
	for (let i = 0; i < pts.length; i++) area += (pts[i] as { x: number }).x * (pts[(i + 1) % pts.length] as { y: number }).y - (pts[(i + 1) % pts.length] as { x: number }).x * (pts[i] as { y: number }).y
	check("reading − 60 mL = the pebble's volume", reading(r2.track, "cyl", "volume_ml") - 60, (Math.abs(area) / 2) * (s?.body.depth as number) * 1e6, 0.01, "mL", "displacement measures volume")
}

// ---------------------------------------------------------------- F6 clay
if (want === "all" || want === "clay") {
	console.log("\n== clay (F6): 50 g of modelling clay (1570 kg/m³) sinks as a ball and floats as a boat; the boat's draft by Archimedes")
	const T = tank("tank", 1.2, { length: 0.6 })
	const boat = into({ id: "boat", type: "clay-boat", x: 1.35, y: 0, props: { mass: 0.05 } }, T)
	const r = run(scene([T, into({ id: "ball", type: "clay-ball", x: 1.02, y: 0, props: { diameter: 0.0393 } }, T), boat], 4))
	claim(`the ball sinks (sunk ${reading(r.track, "ball", "sunk")}), the boat floats (afloat ${reading(r.track, "boat", "afloat")}, flooded ${reading(r.track, "boat", "flooded")})`, reading(r.track, "ball", "sunk") === 1 && reading(r.track, "boat", "afloat") === 1 && reading(r.track, "boat", "flooded") === 0)
	// its hull: a trapezoid L long at the top, 0.6 L at the bottom, 0.4 L high, 0.64 L wide; draft d where ρ_w·V(d) = 50 g (+ the air's share)
	const L = r.resolved.boat?.length as number
	const V = (d: number) => (0.6 * L + d / 2) * d * 0.64 * L // (its ends slope out 0.5 per unit of height: at height d it is 0.6 L + d long)
	let lo = 0
	let hi = 0.4 * L
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2
		if ((WATER - AIR) * V(mid) < 0.05 - AIR * (0.05 / 1570)) lo = mid
		else hi = mid
	}
	check("the boat's draft", reading(r.track, "boat", "draft_mm"), lo * 1000, 0.5, "mm", "Archimedes on its hull")
}

// ---------------------------------------------------------------- F7 egg
if (want === "all" || want === "egg") {
	console.log("\n== egg (F7): a fresh egg (1.08 [HAMILTON]) sinks in tap water and in 6 % brine (1041.3), floats in 12 % brine (1085.7 [CRC])")
	for (const [pct, floats] of [[0, false], [6, false], [12, true]] as const) {
		const T = tank("tank", 1.2, { length: 0.25, height: 0.2, depth: 0.15, liquid: pct ? "salt water" : "water", salt_pct: pct })
		const r = run(scene([T, into({ id: "egg", type: "egg", x: 1.2, y: 0.02 }, T)], 4))
		claim(`${pct} % salt: ${floats ? "floats" : "sinks"} (afloat ${reading(r.track, "egg", "afloat")}, sunk ${reading(r.track, "egg", "sunk")}, ${(reading(r.track, "egg", "submerged") * 100).toFixed(1)} % under)`, floats ? reading(r.track, "egg", "afloat") === 1 : reading(r.track, "egg", "sunk") === 1)
	}
}

// ---------------------------------------------------------------- F8 pennies in a foil boat
if (want === "all" || want === "pennies") {
	console.log("\n== pennies (F8): a 7 × 7 × 1.5 cm foil boat holds (ρV − m)/2.5 g ≈ 29 pennies [USMINT]; past that it floods and sinks")
	for (const [n, floats] of [[22, true], [32, false]] as const) {
		const T = tank("tank", 1.2, { length: 0.3, height: 0.2, depth: 0.2 })
		const per = [Math.ceil(n / 3), Math.ceil((n - Math.ceil(n / 3)) / 2), n - Math.ceil(n / 3) - Math.ceil((n - Math.ceil(n / 3)) / 2)]
		// the boat at its LOADED floating height (the solver's rule for a boat with cargo; for one that sinks loaded, its empty height)
		const fy = sim.plugins.floatHeight({ type: "foil-boat", props: {}, x: 1.2, angle: 0 }, { type: T.type, props: T.props, x: T.x, y: T.y }, per.map((c) => ({ type: "penny", props: { count: c } }))) ?? into({ id: "boat", type: "foil-boat", x: 1.2, y: 0 }, T).y
		const boat: Item = { id: "boat", type: "foil-boat", x: 1.2, y: fy }
		// (resting on its 1 mm bottom from the start, so their weight is on it at the release)
		const stacks = per.map((c, i) => ({ id: `s${i}`, type: "penny", x: 1.2 - 0.022 + i * 0.022, y: boat.y + 0.001 + (0.00152 * c) / 2 - 0.0001, props: { count: c } }))
		const r = run(scene([T, boat, ...stacks], 4))
		claim(`${n} pennies: ${floats ? "floats" : "floods and sinks"} (afloat ${reading(r.track, "boat", "afloat")}, flooded ${reading(r.track, "boat", "flooded")}, freeboard ${reading(r.track, "boat", "freeboard_mm").toFixed(1)} mm)`, floats ? reading(r.track, "boat", "afloat") === 1 && reading(r.track, "boat", "flooded") === 0 : reading(r.track, "boat", "flooded") === 1)
	}
}

// ---------------------------------------------------------------- F9-F11 sails
if (want === "all" || want === "sails") {
	console.log("\n== sails (F9-F11): the push on a sail; a nearer fan and a bigger sail send a boat farther [RAJ; ORTIZ; HOE]")
	const lane = (id: string, y: number, boatX: number, gap: number, sail: string, fanD = 0.12): Item[] => {
		const T: Item = { id: `${id}-tank`, type: "water-tank", x: 1.55, y, props: { style: "trough" } }
		const boat = into({ id: `${id}-boat`, type: "sailboat", x: boatX, y: 0, props: { sail } }, T)
		const mid = sim.layout(sim.clean(scene([boat]))).resolved[boat.id]?.sail_middle as number
		return [T, boat, { id: `${id}-fan`, type: "fan", x: boatX - 0.1 - gap, y: boat.y + mid, props: { diameter: fanD, speed: 5 } }]
	}
	const moved = (r: ReturnType<typeof run>, id: string) => at(r.track, 4).placements[`${id}/hull`].x - at(r.track, 0).placements[`${id}/hull`].x
	const f9 = run(scene([...lane("near", 0, 0.45, 0.15, "small"), ...lane("far", 0.35, 1.2, 0.9, "small")], 4))
	const ratio = moved(f9, "near-boat") / moved(f9, "far-boat")
	claim(`F9 near fan (0.15 m) vs far fan (0.9 m), 12 cm fans: ${moved(f9, "near-boat").toFixed(3)} m vs ${moved(f9, "far-boat").toFixed(3)} m in 3.5 s, ratio ${ratio.toFixed(2)} (spec ≥ 1.25)`, ratio >= 1.25)
	check("F9 the air at the far sail at the start", reading(f9.track, "far-boat", "air_ms", 0), 5 * Math.min(1, (6.2 * 0.108) / (0.9 + 0.1 - 0.02 - 0.05 - 0.0025 + 0.05 + 0.0025 + 0.0)), 0.25, "m/s", "Rajaratnam: 5 × 6.2·D/x past the core")
	const f10 = run(scene([...lane("big", 0, 0.45, 0.2, "big"), ...lane("small", 0.35, 0.45, 0.2, "small")], 4))
	const r10 = moved(f10, "big-boat") / moved(f10, "small-boat")
	claim(`F10 big sail (320 cm²) vs small (120 cm²): ${moved(f10, "big-boat").toFixed(3)} m vs ${moved(f10, "small-boat").toFixed(3)} m, ratio ${r10.toFixed(2)} (spec ≥ 1.15)`, r10 >= 1.15)
	const f10b = run(scene([...lane("small", 0, 0.45, 0.2, "small"), ...lane("tiny", 0.35, 0.45, 0.2, "tiny")], 4))
	const r10b = moved(f10b, "tiny-boat") / moved(f10b, "small-boat")
	claim(`F10 tiny sail (48 cm²) vs small: ratio ${r10b.toFixed(2)} (spec ≈ 0.75)`, r10b > 0.6 && r10b < 0.9)
	// F11: the sail's slab carries exactly the push of the real sail: ½ρ·1.05·h·depth = 0.8·½ρ·A
	for (const sail of ["tiny", "small", "big"]) {
		const r = sim.layout(sim.clean(scene([{ id: "b", type: "sailboat", x: 1, y: 0.1, props: { sail } }])))
		const s = r.doc.solids.find((x) => x.id === "b/sail")
		const A = ({ tiny: 48, small: 120, big: 320 } as Record<string, number>)[sail] / 1e4
		check(`F11 ${sail} sail: the engine's flat-side drag area 1.05·h·depth = 0.8·A`, 1.05 * (s?.body.height as number) * (s?.body.depth as number), 0.8 * A, 0.0002 * A, "m²", "its slab is the real sail set 45° (rounded to 0.01 mm)")
	}
	check("F11 the push reading at the start = 0.8·½ρ·A·v²", reading(f10.track, "big-boat", "push_n", 0), 0.8 * 0.5 * 1.2 * 0.032 * reading(f10.track, "big-boat", "air_ms", 0) ** 2, 2e-5, "N", "within the reading's 5 decimals")
	// (in 2D the sail's push pitches the boat bow-down; the waterplane's righting, ρ·g·I_L ≈ 998 × 9.81 × 0.06 × 0.16³/12 = 0.12 N·m a radian, holds it:
	// a 320 cm² sail in a full 5 m/s jet pushes 0.38 N at about 0.17 m over the boat's middle, 0.065 N·m, so it dips its bow about 17° until it gets
	// going, and about 3° once it sails with the wind (its push falls as it speeds up and leaves the jet's core); it never capsizes)
	const pitch = Math.min(...f10.track.frames.map((f) => f.placements["big-boat/hull"].angle)) * (180 / Math.PI)
	const late = at(f10.track, 3.5).placements["big-boat/hull"].angle * (180 / Math.PI)
	claim(`the big-sailed boat pitches bow-down at most ${pitch.toFixed(1)}° (statics: about 30° held still, less as it gets going; ≥ −22°), ${late.toFixed(1)}° once sailing (≥ −4°), and stays afloat`, pitch > -22 && late > -4 && reading(f10.track, "big-boat", "afloat") === 1)
}

// ---------------------------------------------------------------- F12 density column
if (want === "all" || want === "column") {
	console.log("\n== column (F12): each thing rests where the layers bracket its density (honey 1420, syrup 1380, soap 1050, water 998, oil 920, alcohol 880)")
	const r = run(scene([{ id: "jar", type: "density-column", x: 1.2, y: 0 }, { id: "grape", type: "grape", x: 1.2, y: 0.345 }, { id: "bead", type: "plastic-bead", x: 1.196, y: 0.375 }, { id: "cork", type: "cork", x: 1.204, y: 0.4 }], 8))
	const tops = [1, 2, 3, 4, 5, 6].map((i) => 0.003 + reading(r.track, "jar", `layer${i}_mm`) / 1000)
	const y = (id: string, part: string) => at(r.track, 8).placements[`${id}/${part}`].y
	claim(`the grape (1060) rests on the syrup under the soap: ${y("grape", "grape").toFixed(4)} m, the syrup's top ${(tops[1] as number).toFixed(4)} m`, Math.abs(y("grape", "grape") - (tops[1] as number)) < 0.012)
	claim(`the bead (950) rests where the oil meets the water: ${y("bead", "bead").toFixed(4)} m, the water's top ${(tops[3] as number).toFixed(4)} m`, Math.abs(y("bead", "bead") - (tops[3] as number)) < 0.005)
	claim(`the cork (200) floats on top: ${y("cork", "cork").toFixed(4)} m, the top surface ${(tops[5] as number).toFixed(4)} m`, Math.abs(y("cork", "cork") - (tops[5] as number)) < 0.012 && reading(r.track, "cork", "afloat") === 1)
}

// ---------------------------------------------------------------- level and spilling
if (want === "all" || want === "spill") {
	console.log("\n== spill: what does not fit under the rim spills, and the level stays at the rim; the liquid's volume is kept")
	const T = tank("tank", 1.2, { length: 0.3, height: 0.3, depth: 0.2, fill: 0.288 })
	const r = run(scene([T, { id: "brick", type: "brick", x: 1.2, y: 0.36 }], 3))
	const inner = sim.plugins.containerInterior("water-tank", T.props ?? {}) as { floor: number; rim: number }
	const d = r.doc.solids.find((s) => s.item === "brick")?.body as { width: number; height: number; depth: number }
	const area = 0.3 * (0.2 - 0.012)
	const room = area * (inner.rim - inner.floor - 0.288)
	check("spilled", reading(r.track, "tank", "spilled_ml"), (d.width * d.height * d.depth - room) * 1e6, 0.01, "mL", "the brick's volume less the room left")
	check("level at the rim", reading(r.track, "tank", "level_mm"), (inner.rim - inner.floor) * 1000, 1e-4, "mm", "")
	claim(`an overflow event (${JSON.stringify((r.summary as { happenings?: { text: string }[] }).happenings?.map((h) => h.text))})`, ((r.summary as { happenings?: { text: string }[] }).happenings ?? []).some((h) => /overflows/.test(h.text)))
}

// ---------------------------------------------------------------- determinism
if (want === "all" || want === "determinism") {
	console.log("\n== determinism: the same scene twice gives the same track, bit for bit")
	const T = tank("tank", 1.2)
	const s = scene([T, { id: "b", type: "wooden-block", x: 1.15, y: 0.3, angle: 20 }, { id: "c", type: "cork", x: 1.25, y: 0.35 }, { id: "e", type: "egg", x: 1.3, y: 0.32 }], 3)
	claim("two runs identical", JSON.stringify(run(s).track) === JSON.stringify(run(s).track))
}

// ---------------------------------------------------------------- open vessels (a mug, a bowl) float as hollow hulls
// [ADAMSON] surface tension; [IAPWS-ST] water 72.74 mN/m at 20 °C; a frustum's volume πh(D² + Db + b²)/12
if (want === "all" || want === "vessel") {
	console.log("\n== vessel: a mug's and a bowl's envelope is a frustum's volume; a bowl floats upright on it (buoyancy = weight); a hose fills it until its rim reaches the water, then it floods and sinks")
	const T = tank("tank", 1.45)
	for (const [type, props] of [["coffee-mug", {}], ["bowl", { material: "melamine" }]] as [string, Record<string, unknown>][]) {
		const { doc } = sim.layout(sim.clean(scene([T, { id: "v", type, x: 1.45, y: 0.25, props }])))
		const h = (doc.processes ?? []).find((p) => p.kind === "hull" && p.item === "v") as unknown as { points: { x: number; y: number }[]; depth: number; rim: number[] }
		const ys = h.points.map((p) => p.y)
		const H = Math.max(...ys) - Math.min(...ys)
		const top = h.points.filter((p) => p.y >= Math.max(...ys) - 1e-6).map((p) => p.x)
		const bot = h.points.filter((p) => p.y <= Math.min(...ys) + 1e-6).map((p) => p.x)
		const D = Math.max(...top) - Math.min(...top)
		const b = Math.max(...bot) - Math.min(...bot)
		let a = 0
		for (let i = 0; i < h.points.length; i++) {
			const p = h.points[i] as { x: number; y: number }
			const q = h.points[(i + 1) % h.points.length] as { x: number; y: number }
			a += p.x * q.y - q.x * p.y
		}
		// (the mug's envelope has a corner cut by its narrower right wall: its outline is not quite a trapezoid, so a looser tolerance)
		check(`${type}: envelope volume (outline × depth)`, ((Math.abs(a) / 2) * h.depth) * 1e6, ((Math.PI * H * (D * D + D * b + b * b)) / 12) * 1e6, type === "bowl" ? 0.05 : 3, "mL", "frustum")
	}
	const bowl = into({ id: "bowl", type: "bowl", x: 1.45, y: 0.3, props: { material: "melamine" } }, T)
	const r = run(scene([T, bowl], 2, 0.2))
	const m = (sim.layout(sim.clean(scene([T, bowl]))).doc.solids.filter((s) => s.item === "bowl").reduce((acc, s) => acc + 0, 0), 0)
	void m
	const mass = r.doc.solids.filter((s) => s.item === "bowl" && s.kind === "dynamic").reduce((acc, s) => acc + (r.doc.materials[s.material]?.density ?? 0) * (s.body.kind === "slab" ? (s.body.width as number) * (s.body.height as number) * (s.body.depth as number) : area(s.body.points ?? []) * (s.body.depth as number)), 0)
	check("melamine bowl at rest: buoyancy ρgV against its weight (in air less the air's lift)", reading(r.track, "bowl", "buoyancy_n"), mass * G, 0.002 * mass * G + 0.001, "N", "Archimedes")
	claim(`it floats upright: ${(reading(r.track, "bowl", "freeboard_mm")).toFixed(1)} mm of freeboard, turned ${Math.abs(at(r.track, 2).placements["bowl/base"]?.angle ?? 9).toFixed(4)} rad`, reading(r.track, "bowl", "afloat") === 1 && Math.abs(at(r.track, 2).placements["bowl/base"]?.angle ?? 9) < 0.01)
	// (a beaker on a shelf, a plank on legs 30 cm up, a hose from it into the bowl)
	const items = [T, bowl, { id: "shelf", type: "plank", x: 0.8, y: 0.3, props: { length: 0.3 } }, { id: "src", type: "beaker", x: 0.8, y: 0.311, props: { size: "1000 mL", fill_ml: 900 } }, { id: "hose", type: "hose", x: 1.45, y: 0.32, props: { from: "src", to: "bowl", diameter_mm: 10 } }]
	const f = run(scene(items, 12, 0.2, [{ kind: "floats_then_sinks", item: "bowl" }]))
	// (when its rim first reaches the surface: the weir over it then fills the rest)
	const fb = f.track.state?.bowl?.freeboard_mm ?? []
	const k = fb.findIndex((v) => v <= 0)
	const held = k >= 0 ? (f.track.state?.bowl?.liquid_ml?.[k] ?? Number.NaN) : Number.NaN
	const env = ((f.doc.processes ?? []).find((p) => p.kind === "hull" && p.item === "bowl") as unknown as { points: { x: number; y: number }[]; depth: number })
	const envMl = (area(env.points) * env.depth) * 1e6
	// floods when what it holds and weighs reaches what its whole outside displaces: m + ρ·V_in = ρ·V_envelope (its rim at the surface)
	check("the hose's water in the bowl when its rim reaches the water", held, envMl - (mass / WATER) * 1e6, 0.01 * envMl, "mL", "ρ·V_envelope = m + ρ·V_water")
	claim(`floats_then_sinks: ${JSON.stringify(f.summary.goals[0])}`, f.summary.goals[0]?.ok === true)
	const foam = run(scene([T, into({ id: "bowl", type: "bowl", x: 1.45, y: 0.3, props: { material: "foam" } }, T), ...items.slice(2)], 12, 0.2, [{ kind: "floats_then_sinks", item: "bowl" }, { kind: "floats", item: "bowl" }]))
	claim(`a foam bowl (30 kg/m³) filled by the same hose never sinks: ${foam.summary.goals.map((g) => `${g.ok ? "✓" : "✗"} ${g.label}`).join("; ")}`, foam.summary.goals[0]?.ok === false && foam.summary.goals[1]?.ok === true)
	const sank = run(scene([T, { id: "stone", type: "pebble", x: 1.45, y: 0.15 }], 2, 0.2, [{ kind: "floats_then_sinks", item: "stone" }, { kind: "sinks", item: "stone" }]))
	claim(`a pebble that sinks at once never 'floats, then sinks': ${sank.summary.goals.map((g) => `${g.ok ? "✓" : "✗"} ${g.label}`).join("; ")}`, sank.summary.goals[0]?.ok === false && sank.summary.goals[1]?.ok === true)
}

// ---------------------------------------------------------------- surface tension: the paper clip, soap
if (want === "all" || want === "surface") {
	console.log("\n== surface: a steel paper clip laid on water floats in a dent (the surface's pull γ·sinφ per metre of contact line + buoyancy = its weight); dropped, on oil, or once soap reaches it, it sinks")
	for (const u of [0.1, 0.3, 0.6]) {
		const lc = Math.sqrt(0.0728 / ((WATER - AIR) * G))
		const d = 2 * lc * u
		check(`meniscus pushed down ${(d * 1000).toFixed(2)} mm: pull per metre`, core.meniscusPull(d, 0.0728, WATER - AIR, G, 80).pull, 0.0728 * Math.sin(2 * Math.asin(u)), 1e-12, "N/m", "γ·sin φ, d = 2·l_c·sin(φ/2)")
	}
	const lc = Math.sqrt(0.0728 / ((WATER - AIR) * G))
	claim(`past 2·l_c·sin(θ/2) = ${(2 * lc * Math.sin((40 * Math.PI) / 180) * 1000).toFixed(2)} mm (θ 80°) the surface lets go`, core.meniscusPull(2 * lc * Math.sin((40 * Math.PI) / 180) * 1.001, 0.0728, WATER - AIR, G, 80).broken && !core.meniscusPull(2 * lc * Math.sin((40 * Math.PI) / 180) * 0.999, 0.0728, WATER - AIR, G, 80).broken)
	const T = tank("tank", 1.2)
	const clip = into({ id: "clip", type: "paper-clip", x: 1.1, y: 0.3 }, T)
	const r = run(scene([T, clip], 2, 0.2, [{ kind: "floats", item: "clip" }]))
	const w = 0.00045 * G
	const lift = reading(r.track, "clip", "buoyancy_n")
	check("laid gently: the surface's pull + buoyancy against its weight", reading(r.track, "clip", "surface_mn") / 1000 + lift, w, 0.01 * w, "N", "statics")
	const level = (reading(r.track, "tank", "level_mm") / 1000) + 0.006
	const bottom = (at(r.track, 2).placements["clip/clip1"]?.y ?? 0) - 0.0005
	const need = w - lift
	const uq = (() => {
		let lo = 0
		let hi = Math.SQRT1_2
		for (let k = 0; k < 60; k++) {
			const mid = (lo + hi) / 2
			if (0.0728 * 0.194 * 2 * mid * Math.sqrt(1 - mid * mid) < need) lo = mid
			else hi = mid
		}
		return lo
	})()
	check("its dent: how far its underside is under the water's level", (level - bottom) * 1000, 2 * lc * uq * 1000, 0.01, "mm", "d = 2·l_c·sin(φ/2)")
	claim(`it floats: ${JSON.stringify(r.summary.goals[0])}`, r.summary.goals[0]?.ok === true && reading(r.track, "clip", "on_surface") === 1)
	const dropped = run(scene([T, { id: "clip", type: "paper-clip", x: 1.1, y: 0.25 }], 2, 0.2, [{ kind: "sinks", item: "clip" }]))
	claim(`dropped from 3.8 cm above the water it breaks through and sinks: ${JSON.stringify(dropped.summary.goals[0])}`, dropped.summary.goals[0]?.ok === true)
	const To = tank("tank", 1.2, { liquid: "vegetable oil" })
	const oil = run(scene([To, { ...clip, y: (into({ id: "clip", type: "paper-clip", x: 1.1, y: 0.3 }, T).y as number) }], 2, 0.2, [{ kind: "sinks", item: "clip" }]))
	claim(`on vegetable oil (32 mN/m, it wets steel) the surface cannot hold it: ${JSON.stringify(oil.summary.goals[0])}`, oil.summary.goals[0]?.ok === true)
	const soap = { id: "soap", type: "soap-drop", x: 1.3, y: 0.27, props: { at_s: 1 } }
	const s = run(scene([T, clip, soap], 5, 0.2, [{ kind: "floats_then_sinks", item: "clip" }]))
	const lv = (s.track.state?.tank?.level_mm?.[0] ?? 0) / 1000 + 0.006
	const land = 1 + Math.sqrt((2 * (0.27 - lv)) / G)
	const on = s.track.state?.clip?.on_surface ?? []
	const broke = s.track.frames[on.findIndex((v, i) => i > 0 && v === 0 && on[i - 1] === 1)]?.t ?? Number.NaN
	// the soap's edge reaches the clip's far quarter (its contact line's nearest sample to the soap holds out last)
	const reach = (dist: number) => land + Math.pow(dist / 0.12, 4 / 3)
	claim(`soap lands at ${land.toFixed(3)} s; the clip is let go at ${broke.toFixed(3)} s, as its film reaches it (${reach(0.2 - 0.033 * 0.375).toFixed(2)}-${reach(0.2 + 0.033 * 0.375).toFixed(2)} s, 0.12·t^(3/4) m)`, broke >= reach(0.2 - 0.0124) - 0.02 && broke <= reach(0.2 + 0.0124) + 0.02)
	claim(`it floats, then sinks: ${JSON.stringify(s.summary.goals[0])}`, s.summary.goals[0]?.ok === true)
}

// ---------------------------------------------------------------- capillary rise and wicking
if (want === "all" || want === "capillary") {
	console.log("\n== capillary: water climbs a tube to Jurin's height 2γ/(ρgr), at Washburn's rate; paper wicks as h² = D·t")
	const T = tank("tank", 1.2)
	const tubes = [0.5, 1, 2, 4].map((b, i) => ({ id: `t${i}`, type: "capillary-tube", x: 1.02 + i * 0.12, y: 0.19, props: { bore_mm: b } }))
	// (8 s: the 0.5 mm tube's Washburn time is about a second)
	const r = run(scene([T, ...tubes], 8, 0.2))
	const level = reading(r.track, "tank", "level_mm") / 1000 + 0.006
	for (const [i, b] of [0.5, 1, 2, 4].entries()) check(`${b} mm tube: rise`, reading(r.track, `t${i}`, "rise_mm"), core.jurinRise(0.0728, 0, WATER, G, b / 2000) * 1000, 0.005 * core.jurinRise(0.0728, 0, WATER, G, b / 2000) * 1000, "mm", "Jurin")
	// Washburn with gravity, the immersed length L under the column: t(z) = 8μ/(r²ρg)·[−(h + L)·ln(1 − z/h) − z]
	const r1 = 0.0005
	const h = core.jurinRise(0.0728, 0, WATER, G, r1)
	const L = level - 0.19
	const t90 = ((8 * 0.001002) / (r1 * r1 * WATER * G)) * (-(h + L) * Math.log(1 - 0.9) - 0.9 * h)
	const z = r.track.state?.t1?.rise_mm ?? []
	const k90 = z.findIndex((v) => v >= 0.9 * h * 1000)
	check("1 mm tube: time to 90 % of its height", (r.track.frames[k90]?.t ?? Number.NaN), t90, 0.05 * t90 + 0.01, "s", "Washburn")
	const soap = run(scene([T, tubes[1] as Item, { id: "soap", type: "soap-drop", x: tubes[1]?.x as number, y: 0.26, props: { at_s: 1 } }], 3, 0.2))
	check("in soapy water (30 mN/m) the 1 mm tube's rise", reading(soap.track, "t1", "rise_mm"), core.jurinRise(0.03, 0, WATER, G, r1) * 1000, 0.01 * core.jurinRise(0.03, 0, WATER, G, r1) * 1000, "mm", "Jurin")
	const Ts = tank("tank", 1.2, { liquid: "corn syrup" })
	const syr = run(scene([Ts, { ...(tubes[1] as Item), y: 0.19 }], 3, 0.2))
	const hs = core.jurinRise(0.075, 0, 1380, G, r1) * 1000
	claim(`corn syrup (2.5 Pa·s) creeps up the 1 mm tube: ${reading(syr.track, "t1", "rise_mm").toFixed(2)} mm in 3 s of its ${hs.toFixed(1)} mm`, reading(syr.track, "t1", "rise_mm") > 0.2 && reading(syr.track, "t1", "rise_mm") < 0.5 * hs)
	const strips = ["paper towel", "filter paper", "printer paper"].map((p, i) => ({ id: `s${i}`, type: "paper-strip", x: 1.05 + i * 0.15, y: 0.19, props: { paper: p } }))
	const w = run(scene([T, ...strips], 6, 0.2))
	for (const [i, D] of [4.0e-5, 1.1e-5, 3.0e-7].entries()) {
		const t = w.track.frames[w.track.frames.length - 1]?.t as number
		const hmax = [0.15, 0.25, 0.04][i] as number
		// h² ≈ h0² + D·t, slowed by (1 − h/hmax): a small correction over 6 s
		const ref = Math.sqrt(1e-6 + D * t) * (1 - Math.sqrt(D * t) / (3 * hmax))
		check(`${strips[i]?.props.paper}: wet height after ${t.toFixed(1)} s`, reading(w.track, `s${i}`, "wet_mm"), ref * 1000, 0.04 * ref * 1000 + 0.05, "mm", "Lucas-Washburn h² = D·t")
	}
}

// ---------------------------------------------------------------- a soap-powered boat
if (want === "all" || want === "soapboat") {
	console.log("\n== soapboat: soap behind a foil boat: the clean surface ahead pulls it, (γ − γ_soap)·width, until the soap catches up")
	const T = tank("tub", 1.2, { style: "tub" })
	const boat = into({ id: "boat", type: "foil-boat", x: 0.98, y: 0.3 }, T)
	const soap = { id: "soap", type: "soap-drop", x: 0.94, y: 0.2, props: { at_s: 0.5 } }
	const r = run(scene([T, boat, soap], 5, 0.2, [{ kind: "moves", item: "boat", min_m: 0.15 }]))
	const still = run(scene([T, boat], 5, 0.2, [{ kind: "moves", item: "boat", min_m: 0.01 }]))
	const lv = (r.track.state?.tub?.level_mm?.[0] ?? 0) / 1000 + 0.004
	const land = 0.5 + Math.sqrt((2 * (0.2 - lv)) / G)
	const x = (t: number) => at(r.track, t).placements["boat/floor"]?.x ?? Number.NaN
	// just after it lands: a = (72.8 − 30) mN/m × 7 cm over its mass and added mass, before the drag counts
	const m = 2700 * 0.000016 * (0.07 * 0.07 + 4 * 0.015 * 0.07) * 1.1
	const dt = 0.05
	const a = (2 * (x(land + dt) - x(land))) / (dt * dt)
	const F = (0.0728 - 0.03) * 0.07
	claim(`soap lands at ${land.toFixed(3)} s; the boat starts at ${a.toFixed(2)} m/s² (the pull ${(F * 1000).toFixed(2)} mN on ${(m * 1000).toFixed(2)} g: ${(F / m).toFixed(1)} m/s² at most, less its added mass and drag)`, a > 0.2 * (F / m) && a <= 1.02 * (F / m))
	claim(`it moves ${JSON.stringify(r.summary.goals[0])}; without soap it stays: ${JSON.stringify(still.summary.goals[0])}`, r.summary.goals[0]?.ok === true && still.summary.goals[0]?.ok === false)
	const v = (x(4.5) - x(3.5)) / 1
	const front = (t: number) => 0.12 * 0.75 * Math.pow(t - land, -0.25)
	check("it keeps pace with the soap's edge (its speed over 3.5-4.5 s)", v, front(4), 0.35 * front(4), "m/s", "0.12·t^(3/4) [JENSEN]")
}

// ---------------------------------------------------------------- fuzz
if (want === "all" || want === "fuzz") {
	const N = Number(process.env.FUZZ_N ?? 60)
	console.log(`\n== fuzz: ${N} random scenes of things dropped into random containers of random liquids: no exception, nothing not a number, levels under the rims`)
	let seed = 20261019
	const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
	const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)] as T
	const things = ["wooden-block", "ice-cube", "clay-ball", "ping-pong-ball", "egg", "steel-ball", "apple", "cork", "grape", "plastic-bead", "pebble", "penny", "sailboat", "clay-boat", "foil-boat", "rubber-duck", "coffee-mug", "bowl", "paper-clip", "soda-can", "lego-brick", "tennis-ball", "foam-block", "brick"]
	const liquids = ["water", "salt water", "sea water", "vegetable oil", "corn syrup", "honey", "dish soap", "rubbing alcohol"]
	let bad = 0
	let worst = ""
	const t0 = performance.now()
	for (let k = 0; k < N; k++) {
		const style = pick(["aquarium", "tub", "trough"])
		const C: Item = { id: "c", type: "water-tank", x: 1.2, y: rnd() < 0.2 ? 0.3 : 0, props: { style, liquid: pick(liquids), salt_pct: Math.round(rnd() * 26), length: style === "trough" ? 1.5 : 0.3 + rnd() * 0.5 } }
		const items: Item[] = [C]
		const n = 1 + Math.floor(rnd() * 5)
		for (let i = 0; i < n; i++) items.push({ id: `t${i}`, type: pick(things), x: 1.2 + (rnd() - 0.5) * 0.25, y: C.y + 0.05 + rnd() * 0.4, angle: Math.round(rnd() * 90 - 45) })
		// (and the surface's things: soap, a capillary tube, a paper strip, dipped at random heights)
		if (rnd() < 0.3) items.push({ id: "soap", type: "soap-drop", x: 1.2 + (rnd() - 0.5) * 0.2, y: C.y + 0.3, props: { at_s: rnd() } })
		if (rnd() < 0.3) items.push({ id: "tube", type: "capillary-tube", x: 1.2 + (rnd() - 0.5) * 0.2, y: C.y + rnd() * 0.15, props: { bore_mm: 0.3 + rnd() * 3.7 } })
		if (rnd() < 0.3) items.push({ id: "strip", type: "paper-strip", x: 1.2 + (rnd() - 0.5) * 0.2, y: C.y + rnd() * 0.15, props: { paper: pick(["paper towel", "filter paper", "printer paper"]) } })
		try {
			const r = run(scene(items, 2.5))
			const finite = r.track.frames.every((f) => Object.values(f.placements).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle)))
			const inner = sim.plugins.containerInterior("water-tank", C.props ?? {}) as { floor: number; rim: number }
			const lv = r.track.state?.c?.level_mm ?? []
			const under = lv.every((v) => v <= (inner.rim - inner.floor) * 1000 + 1e-6 && v >= 0)
			const spill = r.track.state?.c?.spilled_ml ?? []
			const growing = spill.every((v, i) => i === 0 || v >= (spill[i - 1] as number) - 1e-9)
			if (!finite || !under || !growing) {
				bad++
				worst = `scene ${k}: finite ${finite}, under the rim ${under}, spill never shrinks ${growing}`
			}
		} catch (e) {
			bad++
			worst = `scene ${k}: ${String(e).slice(0, 200)}`
		}
	}
	claim(`fuzz: ${N - bad} of ${N} clean (${((performance.now() - t0) / N).toFixed(0)} ms a scene)${bad ? `; e.g. ${worst}` : ""}`, bad === 0)
}

console.log(`\n${checks} checks: ${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
