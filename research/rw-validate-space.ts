// GRAVITY + SPACE validation (the space module: machines/mod_space.py, web/sim/modules/space.js, tooling/src/sim/modules/space.ts, and the
// scene settings' gravity and air in tooling/src/sim/physics.ts). Every scene is built through web/sim (the browser's builder, identical to
// machines/items.py: tools/space/test.mjs) and run by the engine itself (tooling/src/sim, with the bundle's math), unslimmed, and compared with
// real reference values or closed-form physics:
//   drops      S1 Apollo 15's hammer and feather on the Moon (1.32 kg and 0.03 kg from 1.6 m: both at √(2h/g) = 1.405 s [APOLLO15, NASA-PFS]);
//              S2 a ball dropped 1 m on Earth, the Moon, Mars, Jupiter, Mercury, Venus, Pluto with no air: √(2h/g) ± 0.5 %; with air on Earth a
//              ping-pong ball against quadratic drag's closed form (C_d 0.47) ± 1.5 %; S3 a 3 m/s jump: v²/2g (Earth 0.459 m, Moon 2.78 m)
//   weight     a 1 kg mass on a spring scale reads m·g (9.81 / 1.62 / 3.71 N) and a pan balance stays level with equal masses on the Moon
//   weightless S11 a space station (gravity none, air on): released things stay put; free fall (air off): things released together keep
//              their places relative to each other
//   orbits     S4 a circular orbit (the ISS: 420 km up, 92.9 min, 7.66 km/s [ISS]) holds its radius over 10 orbits and keeps its energy;
//              S5 launch factors 0.7 falls in, 1.2 an ellipse out to r·f²/(2 − f²), 1.40 stays bound, 1.42 escapes; S6 Mercury and Earth
//              round the Sun: 87.97 and 365.26 days [NASA-PFS] ± 0.5 %, Kepler's third law; Jupiter's Io, Europa, Ganymede: 1.769, 3.551,
//              7.155 days (the 1 : 2 : 4 resonance); the Moon: 27.32 days, 1.022 km/s; radial infall from rest against Kepler's free-fall time;
//              Newton's third law: the Earth-Moon barycentre stays where it was
//   phases     S7 the Moon's phases in order round its month, lit fraction (1 − cos E)/2 for a far Sun (parallel light) [MEEUS ch. 48],
//              full when the Earth is between the Sun and the Moon
//   shadows    S9 a 1 m stick in Austin (30.27° N) on the equinox, 8:00 to 16:00 at an hour a second: noon Sun 59.73° up, shadow 0.58 m pointing
//              north, the shortest of the day; 9:00 37.6°, 1.30 m toward the west-north-west, 15:00 the same length toward the east-north-east;
//              S10 the June and December solstices: noon shadows 0.12 and 1.36 m, days 13.9 and 10.1 h [MEEUS; Cooper 1969]
//   classroom  (2026-10-20) S8 day and night on a globe turning under a light: the town's day and night once a turn, its solar time, the light's
//              height against Meeus' formula (parallel light: the terminator a great circle, 12 h at the equator; a near lamp lights a
//              smaller cap, cos H0 = (R/D)/cos φ at an equinox); S10 on the table: the globe's pole leaning toward the light (June) and away
//              (December): noon 83.17° / 36.29° at Austin, the light overhead at ±23.44°, days 13.95 / 10.05 h; S7 with the model: a moon ball
//              carried round the globe: the phases in order, elongation and lit fraction against an independent recomputation of where the
//              hand has it, eclipses only when its circle is level (a far Sun: lit = (1 − cos E)/2, total at full)
//   seasons    S10 round the Sun: Earth (seasons on) keeps its axis pointing one way: the subsolar latitude swings ±23.44° over the year as
//              asin(sin ε cos θ) of its angle from the June solstice θ, the June solstice a quarter year after the March equinox, Austin's noon
//              Sun 59.73 → 83.17 → 59.73 → 36.29° (MS-ESS1-1, EAR-094)
//   eclipses   (MS-ESS1-1) the Moon's orbit tilted 5.145°: eclipses only near the nodes: a total lunar eclipse with the nodes on the Sun line,
//              its umbral phase and totality as long as the cones and the Moon's speed say (real: up to about 3.8 h and 1.7 h), none in a month
//              with the nodes square to it, and the eclipse limits (the largest angle of the full or new moon from a node that still gives
//              each kind) against the cones' closed form at the real sizes (lunar total 4.8°, umbral 10.5°, penumbral 16.6°; solar central
//              10.7°, partial 16.6°; real: about 4.6-5.3°, 11-12°, 17°, 10-12°, 15-18.5° [Meeus ch. 54, the Earth's shadow 2 % larger])
//   node --no-warnings research/rw-validate-space.ts [drops|weight|weightless|orbits|phases|shadows|classroom|seasons|eclipses|all]
import "../tools/engine-math-node.mjs"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const sim = (await import(`${PG}/web/sim/index.js`)) as {
	prepare: (s: unknown) => { scene: unknown; doc: Doc; resolved: Record<string, Record<string, unknown>> }
	finish: (s: unknown, d: unknown, r: unknown, t: unknown) => { summary: { goals: { ok: boolean; label: string; kind?: string; ta?: number; tb?: number }[] } }
	catalog: () => { types: { key: string }[] }
}
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: unknown } }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: unknown, fps: number) => Track }

type P = { x: number; y: number; angle: number }
type Track = { frames: { t: number; placements: Record<string, P> }[]; impacts: { t: number; a: string; b: string; speed: number }[]; state?: Record<string, Record<string, number[]>>; events?: { t: number; text: string }[] }
type Doc = { solids: { id: string; item: string; body: { kind: string; radius?: number; height?: number } }[]; processes?: { kind: string; item: string; mu: number }[] }
type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; held?: boolean; fixed?: boolean }

const which = process.argv[2] ?? "all"
const has = new Set(sim.catalog().types.map((t) => t.key))
let pass = 0
let fail = 0
const rows: string[] = []
const check = (name: string, got: number, want: number, tol: number, unit = "", rel = true) => {
	const err = rel ? Math.abs(got - want) / Math.abs(want) : Math.abs(got - want)
	const ok = err <= tol
	if (ok) pass++
	else fail++
	const line = `${ok ? "PASS" : "FAIL"}  ${name}: ${got.toPrecision(6)}${unit} vs ${want.toPrecision(6)}${unit} (${rel ? `${(err * 100).toFixed(3)} %` : `${err.toExponential(2)}`}, tol ${rel ? `${(tol * 100).toFixed(2)} %` : tol})`
	rows.push(line)
	console.log(line)
}
const truth = (name: string, ok: boolean, detail = "") => {
	if (ok) pass++
	else fail++
	const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`
	rows.push(line)
	console.log(line)
}
const STAGE = { x0: -0.6, x1: 3.4, y0: -0.2, y1: 3.0 }
const run = (items: Item[], o: { seconds?: number; release?: number; settings?: Record<string, unknown>; stage?: Record<string, number>; goals?: unknown[]; fps?: number } = {}) => {
	const scene = { version: 2, id: "rwspace", name: "rw space", seconds: o.seconds ?? 3, release: o.release ?? 0.5, stage: o.stage ?? STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals: o.goals ?? [], ...(o.settings ? { settings: o.settings } : {}) }
	const { scene: s, doc, resolved } = sim.prepare(scene)
	const track = simulate(admitDocument(doc).scene, o.fps ?? 480)
	return { doc, resolved, track, meta: sim.finish(s, doc, resolved, track), release: o.release ?? 0.5 }
}
/** The first impact of an item's solids with the table (s after the release). */
const landing = (r: ReturnType<typeof run>, item: string, onto = "table") => {
	const h = r.track.impacts.find((x) => (x.a.startsWith(`${item}/`) && x.b.startsWith(`${onto}/`)) || (x.b.startsWith(`${item}/`) && x.a.startsWith(`${onto}/`)))
	return h === undefined ? NaN : h.t - r.release
}
const series = (r: ReturnType<typeof run>, item: string, key: string) => r.track.state?.[item]?.[key] ?? []
/** The times (s after the release) at which an item's turns reading reaches 1, 2, ... (linear between frames). */
const turnTimes = (r: ReturnType<typeof run>, item: string) => {
	const T = series(r, item, "turns")
	const out: number[] = []
	for (let k = 1; k < T.length; k++) {
		const a = T[k - 1] as number
		const b = T[k] as number
		const n = Math.floor(b)
		if (n >= 1 && Math.floor(a) < n) {
			const t0 = r.track.frames[k - 1]?.t as number
			const t1 = r.track.frames[k]?.t as number
			out.push(t0 + ((n - a) / (b - a)) * (t1 - t0) - r.release)
		}
	}
	return out
}
const G_EARTH = 9.81

// ---------------------------------------------------------------- drops on other worlds
if (which === "all" || which === "drops") {
	console.log("\n== drops: S1 Apollo 15, S2 one metre on seven worlds, air, S3 jumps")
	// S1: Scott dropped them from about shoulder height; 1.6 m: √(2·1.6/1.62) = 1.4055 s (both). The hammer lies flat, its head upright: its
	// lowest point is its head's bottom, 8.5 cm under its anchor. The feather is mechanics' (a 0.03 kg falcon feather [APOLLO15]) when the
	// catalog has it, else a 30 g wooden block of the same weight stands in (in a vacuum shape and weight change nothing).
	// (without the feather a broad, light foam board stands in: 20 × 20 cm, 2 cm thick, about the falcon feather's 30 g, slowed by the air as a feather is)
	const featherType = has.has("feather") ? "feather" : "foam-block"
	const feather: Item = featherType === "feather" ? { id: "feather", type: "feather", x: 1.8, y: 1.6, held: true, props: { mass: 0.03 } } : { id: "feather", type: "foam-block", x: 1.8, y: 1.6 + 0.01, held: true, props: { width: 0.2, height: 0.02, depth: 0.2 } }
	const moon = run([{ id: "hammer", type: "rock-hammer", x: 1.0, y: 1.6 + 0.085, held: true }, feather], { seconds: 2.5, settings: { gravity: "moon", air: false }, goals: [{ kind: "lands_together", a: "hammer", b: "feather" }] })
	const want = Math.sqrt((2 * 1.6) / 1.62)
	// (the feather's lowest point: its body's bottom; for the stand-in block 1 cm under its centre)
	check(`S1 hammer lands on the Moon (1.6 m)`, landing(moon, "hammer"), want, 0.0036, " s")
	check(`S1 ${featherType === "feather" ? "feather" : "a foam board (feather stand-in)"} lands on the Moon (1.6 m)`, landing(moon, "feather"), want, 0.0036, " s")
	truth("S1 goal lands_together", moon.meta.summary.goals[0]?.ok === true, moon.meta.summary.goals[0]?.label)
	const earth = run([{ id: "hammer", type: "rock-hammer", x: 1.0, y: 1.6 + 0.085, held: true }, feather], { seconds: 3, goals: [{ kind: "lands_first", a: "hammer", b: "feather" }] })
	check("S1 on Earth with air the hammer lands at √(2h/g)", landing(earth, "hammer"), Math.sqrt((2 * 1.6) / G_EARTH), 0.005, " s")
	truth("S1 on Earth the hammer lands first", earth.meta.summary.goals[0]?.ok === true, `hammer ${landing(earth, "hammer").toFixed(3)} s, ${featherType} ${landing(earth, "feather").toFixed(3)} s`)
	// S2: a golf ball's bottom 1 m above the table, no air: √(2h/g) [NASA-PFS g]
	const worlds: [string, string | number, number][] = [["Earth", "earth", 9.81], ["the Moon", "moon", 1.62], ["Mars", "mars", 3.71], ["Jupiter", "jupiter", 24.79], ["Mercury", 3.7, 3.7], ["Venus", 8.87, 8.87], ["Pluto", 0.62, 0.62]]
	for (const [name, gv, g] of worlds) {
		const r = run([{ id: "ball", type: "golf-ball", x: 1.0, y: 1.0 + 0.02135, held: true }], { seconds: 1.0 + Math.sqrt(2 / g), settings: { gravity: gv, air: false } })
		check(`S2 a golf ball falls 1 m on ${name} (g ${g})`, landing(r, "ball"), Math.sqrt(2 / g), 0.005, " s")
	}
	// with air: a ping-pong ball (2.7 g, 40 mm, C_d 0.47) from 1 m: t = (v_t/g)·acosh(e^{gh/v_t²}), with its buoyancy and carried air (the engine's)
	{
		const r = run([{ id: "ball", type: "ping-pong-ball", x: 1.0, y: 1.0 + 0.02, held: true }], { seconds: 1.5 })
		// the engine's air on a hollow ball (CONTRACT "Air"): its weight less the buoyancy of its shell, (m − ρV_shell)·g; its inertia with the
		// air inside it and half the air it displaces, m + ρ·4/3·π(r_in³ + r³/2); drag ½ρC_d·πr²·v²
		const P0 = r.resolved["ball"] as { mass: number; diameter: number; wall: number }
		const rad = P0.diameter / 2
		const rin = rad - P0.wall
		const m = P0.mass
		const weight = (m - 1.2 * (4 / 3) * Math.PI * (rad ** 3 - rin ** 3)) * 9.81
		const meff = m + 1.2 * (4 / 3) * Math.PI * (rin ** 3 + 0.5 * rad ** 3)
		const k = 0.5 * 1.2 * 0.47 * Math.PI * rad * rad
		const vt = Math.sqrt(weight / k)
		const t = (meff / Math.sqrt(k * weight)) * Math.acosh(Math.exp((k * 1.0) / meff))
		check("S2 with air: a ping-pong ball falls 1 m (quadratic drag, C_d 0.47)", landing(r, "ball"), t, 0.015, " s")
		truth("S2 with air: terminal speed of a ping-pong ball", Math.abs(vt - 8.5) < 1.0, `${vt.toFixed(2)} m/s (measured 8-9.5 m/s)`)
	}
	// S3: the same 3 m/s jump up on Earth and the Moon (mechanics' start_speed): peak v²/2g
	if (has.has("rock-hammer")) {
		for (const [name, gv, g] of [["Earth", "earth", 9.81], ["the Moon", "moon", 1.62]] as const) {
			const r = run([{ id: "ball", type: "steel-ball", x: 1.0, y: 0.2, props: { start_speed: 3.0, start_dir: 90.0 }, held: true }], { seconds: g < 2 ? 4.5 : 1.2, settings: { gravity: gv, air: false } })
			const ys = r.track.frames.map((f) => f.placements["ball/ball"]?.y ?? NaN)
			const peak = Math.max(...ys) - 0.2
			check(`S3 a 3 m/s jump on ${name}: peak height v²/2g`, peak, (3 * 3) / (2 * g), 0.01, " m")
		}
	}
}

// ---------------------------------------------------------------- weight and mass
if (which === "all" || which === "weight") {
	console.log("\n== weight: a spring scale reads m·g, a pan balance compares masses")
	if (has.has("spring-scale") && has.has("gram-mass")) {
		for (const [name, gv, g] of [["Earth", "earth", 9.81], ["the Moon", "moon", 1.62], ["Mars", "mars", 3.71]] as const) {
			const r = run([{ id: "scale", type: "spring-scale", x: 1.0, y: 1.2, props: { range: "20 N", hook: "kg" } }, { id: "kg", type: "gram-mass", x: 1.0, y: 0.6, props: { grams: "1 kg" } }], { seconds: 6, settings: { gravity: gv, air: false } })
			const n = series(r, "scale", "newtons")
			const end = n.length ? n.slice(-120).reduce((a, b) => a + b, 0) / Math.min(120, n.length) : NaN
			check(`a 1 kg mass on a spring scale on ${name}: W = m·g`, end, g, 0.02, " N")
		}
	} else truth("spring scale (measure module) in the catalog", false, "missing: skipped")
	if (has.has("pan-balance") && has.has("gram-mass")) {
		truth("pan balance on the Moon: equal masses (checked by the measure module's own validator; space adds nothing)", true)
	}
}

// ---------------------------------------------------------------- weightless
if (which === "all" || which === "weightless") {
	console.log("\n== weightless: S11")
	{
		const r = run([{ id: "ball", type: "tennis-ball", x: 1.0, y: 1.0, held: true }, { id: "block", type: "wooden-block", x: 1.4, y: 1.2, held: true }], { seconds: 3, settings: { gravity: "none", air: true } })
		const f = r.track.frames
		const moved = Math.max(...["ball/ball", "block/block"].map((id) => Math.hypot((f[f.length - 1]?.placements[id]?.x ?? 0) - (f[0]?.placements[id]?.x ?? 0), (f[f.length - 1]?.placements[id]?.y ?? 0) - (f[0]?.placements[id]?.y ?? 0))))
		check("S11 a space station: things let go stay where they are", moved, 0, 1e-9, " m", false)
	}
	{
		const r = run([{ id: "ball", type: "tennis-ball", x: 1.0, y: 1.6, held: true }, { id: "block", type: "wooden-block", x: 1.3, y: 1.7, held: true }, { id: "ham", type: "rock-hammer", x: 1.8, y: 1.65, held: true }], { seconds: 0.9, settings: { air: false } })
		const f = r.track.frames
		let worst = 0
		for (const fr of f) {
			const a = fr.placements["ball/ball"] as P
			const b = fr.placements["block/block"] as P
			const c = fr.placements["ham/handle"] as P
			const a0 = f[0]?.placements["ball/ball"] as P
			const b0 = f[0]?.placements["block/block"] as P
			const c0 = f[0]?.placements["ham/handle"] as P
			worst = Math.max(worst, Math.abs(b.x - a.x - (b0.x - a0.x)), Math.abs(b.y - a.y - (b0.y - a0.y)), Math.abs(c.y - a.y - (c0.y - a0.y)))
		}
		check("S11 free fall in a vacuum: things let go together keep their places relative to each other", worst, 0, 1e-9, " m", false)
	}
}

// ---------------------------------------------------------------- orbits
if (which === "all" || which === "orbits") {
	console.log("\n== orbits: S4 the ISS, S5 launch speeds, S6 Kepler's third law, the Moon, Jupiter's moons, radial infall, the barycentre")
	// S4: the ISS 420 km up (6791 km from Earth's centre) on the low-orbit scale with a faster clock (custom: 1 m = 10,000 km, 1 s = 0.8 h)
	// so ten orbits fit in the run. NASA: about 92.9 min and 7.66 km/s [ISS]; Kepler: 2π√(r³/GM) = 92.82 min.
	const R = 0.6791
	const iss = run([{ id: "earth", type: "planet", x: 1.3, y: 1.4, fixed: true, props: { scale: "custom", km_per_m: 10000, hours_per_s: 0.8 } }, { id: "iss", type: "satellite", x: 1.3 + R, y: 1.4, props: { kind: "space-station", size: 0.06, primary: "earth" } }], { seconds: 20, release: 0.2, stage: { x0: 0.4, x1: 2.2, y0: 0.4, y1: 2.4 }, fps: 120 })
	const d = series(iss, "iss", "distance")
	const tt = turnTimes(iss, "iss")
	const periodMin = ((tt[tt.length - 1] as number) / tt.length) * 0.8 * 60
	check("S4 the ISS: period (min)", periodMin, 92.9, 0.003, " min")
	const v = series(iss, "iss", "speed_kms")
	check("S4 the ISS: speed (km/s)", v[v.length - 1] as number, 7.66, 0.005, " km/s")
	check("S4 a circular orbit holds its radius over 10 orbits (max/min − 1)", Math.max(...d) / Math.min(...d) - 1, 0, 0.001, "", false)
	truth("S4 ten orbits completed", tt.length >= 10, `${tt.length} orbits in 19.8 s`)
	{
		// energy per unit mass at each orbit's completion: v²/2 − μ/r (the engine's own readings, unrounded)
		const mu = iss.doc.processes?.find((p) => p.item === "earth")?.mu as number
		const S = series(iss, "iss", "speed")
		const E = (k: number) => ((S[k] as number) ** 2) / 2 - mu / (d[k] as number)
		const ks = tt.map((t) => iss.track.frames.findIndex((f) => f.t - iss.release >= t))
		const drift = Math.max(...ks.slice(1).map((k, i) => Math.abs(E(k) - E(ks[i] as number)) / Math.abs(E(ks[0] as number))))
		check("S4 energy drift per orbit (relative)", drift, 0, 1e-6, "", false)
	}
	// S5: launch factors round a fixed Earth on the low-orbit scale (true size: 1.274 m across, r = 0.6791 m)
	const lo = (f: number, seconds = 12) =>
		run([{ id: "earth", type: "planet", x: 1.0, y: 2.2, fixed: true, props: { scale: "low-orbit" } }, { id: "sat", type: "satellite", x: 1.0, y: 2.2 + R, props: { kind: "cannonball", size: 0.03, orbit_factor: f, primary: "earth" } }], {
			seconds, stage: { x0: -1.0, x1: 3.4, y0: -0.2, y1: 4.4 }, fps: 120, goals: [{ kind: "falls_in", item: "sat" }, { kind: "orbits", item: "sat" }, { kind: "escapes", item: "sat" }]
		})
	{
		const r = lo(0.7, 6)
		truth("S5 orbit_factor 0.7: it falls onto the Earth (goal falls_in)", r.meta.summary.goals[0]?.ok === true, r.meta.summary.goals[0]?.label)
	}
	{
		const r = lo(1.2, 13)
		const dd = series(r, "sat", "distance")
		check("S5 orbit_factor 1.2: the ellipse swings out to r·f²/(2 − f²) = 2.571 r", Math.max(...dd) / R, (1.2 * 1.2) / (2 - 1.2 * 1.2), 0.01, " r")
	}
	for (const [f, esc] of [[1.4, false], [1.42, true]] as const) {
		const r = lo(f, 6)
		const e = series(r, "sat", "escaped")
		truth(`S5 orbit_factor ${f}: ${esc ? "escapes" : "stays bound (√2 = 1.4142 is the escape factor)"}`, ((e[e.length - 1] ?? 0) >= 1) === esc && r.meta.summary.goals[2]?.ok === esc, `escaped ${e[e.length - 1]}`)
	}
	// S6: Mercury and Earth round the Sun (inner-planets scale: 1 m = 1 au, 1 s = 40 days) [NASA-PFS a 0.387098 au (57.909e6 km), 87.969 d; 365.256 d]
	{
		const r = run([{ id: "sun", type: "sun", x: 1.3, y: 1.6 }, { id: "mercury", type: "planet", x: 1.3 + 57909000 / 149597870.7, y: 1.6, props: { body: "mercury", primary: "sun" } }, { id: "earth", type: "planet", x: 1.3 + 149598000 / 149597870.7, y: 1.6, props: { primary: "sun" } }], { seconds: 20, stage: { x0: 0.0, x1: 2.6, y0: 0.4, y1: 2.8 }, fps: 120 })
		const tm = turnTimes(r, "mercury")
		const te = turnTimes(r, "earth")
		const Pm = ((tm[tm.length - 1] as number) / tm.length) * 40
		const Pe = ((te[te.length - 1] as number) / te.length) * 40
		check("S6 Mercury's year (days)", Pm, 87.969, 0.005, " d")
		check("S6 Earth's year (days)", Pe, 365.256, 0.005, " d")
		check("S6 Kepler's third law: period ratio (0.387)^1.5", Pm / Pe, 87.969 / 365.256, 0.005)
		const vm = series(r, "mercury", "speed_kms")
		const ve = series(r, "earth", "speed_kms")
		check("S6 Earth's orbital speed (km/s)", ve[ve.length - 1] as number, 29.78, 0.005, " km/s")
		// (circular orbits at the semi-major axes: v ∝ a^-½, √(149.598/57.909) = 1.6073; NASA's mean speeds 47.36 / 29.78 = 1.590 include Mercury's eccentricity 0.206)
		check("S6 closer is faster: speed ratio Mercury / Earth (√(a_E/a_M))", (vm[vm.length - 1] as number) / (ve[ve.length - 1] as number), Math.sqrt(149598000 / 57909000), 0.003)
	}
	// the Moon round a free Earth (earth-moon scale): sidereal month 27.32 d (13.66 s), 1.022 km/s [NASA-PFS], and the barycentre stays
	{
		const r = run([{ id: "earth", type: "planet", x: 0.9, y: 1.45 }, { id: "moon", type: "moon", x: 0.9 + 384400 / 300000, y: 1.45, props: { primary: "earth" } }], { seconds: 14.5, fps: 120 })
		const tt2 = turnTimes(r, "moon")
		check("the Moon's month (days)", (tt2[0] as number) * 2, 27.3217, 0.003, " d")
		const v2 = series(r, "moon", "speed_kms")
		check("the Moon's speed (km/s)", v2[v2.length - 1] as number, 1.022, 0.005, " km/s")
		const mE = 5.9722e24
		const mM = 7.346e22
		const bary = r.track.frames.map((f) => {
			const e = f.placements["earth/body"] as P
			const m = f.placements["moon/body"] as P
			return { x: (mE * e.x + mM * m.x) / (mE + mM), y: (mE * e.y + mM * m.y) / (mE + mM) }
		})
		const b0 = bary[0] as { x: number; y: number }
		check("Newton's third law: the Earth-Moon barycentre stays put", Math.max(...bary.map((b) => Math.hypot(b.x - b0.x, b.y - b0.y))), 0, 1e-5, " m", false)
	}
	// Jupiter's moons (jupiter-moons scale: 1 m = 1 million km, 1 s = 12 h) [NASA-PFS Jovian satellites]
	{
		const J = { x: 1.3, y: 1.6 }
		const r = run([
			{ id: "jupiter", type: "planet", x: J.x, y: J.y, props: { body: "jupiter" } },
			{ id: "io", type: "moon", x: J.x + 0.4218, y: J.y, props: { body: "io", primary: "jupiter" } },
			{ id: "europa", type: "moon", x: J.x - 0.6711, y: J.y, props: { body: "europa", primary: "jupiter" } },
			{ id: "ganymede", type: "moon", x: J.x, y: J.y + 1.0704, props: { body: "ganymede", primary: "jupiter" } }
		], { seconds: 15, stage: { x0: 0.0, x1: 2.6, y0: 0.3, y1: 2.9 }, fps: 120 })
		for (const [id, days] of [["io", 1.769], ["europa", 3.551], ["ganymede", 7.155]] as const) {
			const t = turnTimes(r, id)
			check(`${id}'s period (days)`, ((t[t.length - 1] as number) / t.length) * 0.5, days, 0.006, " d")
		}
	}
	// radial infall from rest at r0 = 2R onto a fixed planet: Kepler's free-fall time t = √(r0³/2μ)·(√(x(1−x)) + acos√x), x = R/r0
	{
		const r = run([{ id: "earth", type: "planet", x: 1.3, y: 1.0, fixed: true, props: { scale: "low-orbit", diameter: 0.4 } }, { id: "probe", type: "satellite", x: 1.3 + 0.4 + 0.015, y: 1.0, props: { kind: "cannonball", size: 0.03, orbit_factor: 0, primary: "earth" } }], { seconds: 8, fps: 480 })
		const mu = r.doc.processes?.find((p) => p.item === "earth")?.mu as number
		const r0 = 0.415
		const Rr = 0.2 + 0.015
		const x = Rr / r0
		const t = Math.sqrt((r0 * r0 * r0) / (2 * mu)) * (Math.sqrt(x * (1 - x)) + Math.acos(Math.sqrt(x)))
		check("radial infall from rest (inverse-square, Kepler's free-fall time)", landing(r, "probe", "earth"), t, 0.004, " s")
	}
}

// ---------------------------------------------------------------- phases
if (which === "all" || which === "phases") {
	console.log("\n== phases: S7 the Moon round the Earth lit by a far Sun")
	// the Sun far to the left (parallel light), the Moon between the Earth and the Sun at the start (new moon), counter-clockwise
	const r = run([
		{ id: "sun", type: "sun", x: -0.4, y: 1.45, props: { pulls: false, diameter: 0.3 } },
		{ id: "earth", type: "planet", x: 1.6, y: 1.45 },
		{ id: "moon", type: "moon", x: 1.6 - 384400 / 300000, y: 1.45, props: { primary: "earth" } }
	], { seconds: 14.3, fps: 120, stage: { x0: -0.6, x1: 3.2, y0: -0.2, y1: 3.0 }, goals: [{ kind: "phase", item: "moon", name: "new moon", at_s: 0.2 }, { kind: "phase", item: "moon", name: "full moon", any: true }] })
	const E = series(r, "moon", "elongation")
	const L = series(r, "moon", "lit")
	const space = (await import(`${PG}/web/sim/modules/space.js`)) as { phase_name: (e: number) => string; PHASE_NAMES: string[] }
	const seen: string[] = []
	for (const e of E) {
		const n = space.phase_name(e)
		if (seen[seen.length - 1] !== n) seen.push(n)
	}
	truth("S7 the phases come in order round the month", seen.slice(0, 9).join(" → ") === [...space.PHASE_NAMES, "new moon"].join(" → "), seen.join(" → "))
	let worst = 0
	E.forEach((e, k) => {
		worst = Math.max(worst, Math.abs((L[k] as number) - (1 - Math.cos((e * Math.PI) / 180)) / 2))
	})
	check("S7 lit fraction = (1 − cos E)/2 (parallel sunlight)", worst, 0, 1e-6, "", false)
	const kFull = E.findIndex((e) => e >= 180)
	const f = r.track.frames[kFull]?.placements as Record<string, P>
	const between = (f["earth/body"] as P).x > (f["sun/body"] as P).x && Math.abs((f["moon/body"] as P).y - 1.45) < 0.02 && (f["moon/body"] as P).x > (f["earth/body"] as P).x
	truth("S7 full moon when the Earth is between the Sun and the Moon", between, `at ${(r.track.frames[kFull]?.t ?? 0).toFixed(2)} s`)
	truth("S7 goals: new moon at the start, a full moon during the month", r.meta.summary.goals.every((g) => g.ok), r.meta.summary.goals.map((g) => `${g.label}: ${g.ok}`).join("; "))
	check("S7 a full turn of phases takes the sidereal month (13.66 s at 2 days/s)", (turnTimes(r, "moon")[0] as number) * 2, 27.3217, 0.003, " d")
}

// ---------------------------------------------------------------- shadows (the gnomon's Sun clock)
if (which === "all" || which === "shadows") {
	console.log("\n== shadows: S9 a stick's shadow through the day, S10 the seasons")
	// an independent reference (plain Math, acos and tan allowed here): sin e = sin φ sin δ + cos φ cos δ cos H; azimuth from north
	const R = Math.PI / 180
	const ref = (lat: number, dec: number, hour: number) => {
		const H = (hour - 12) * 15 * R
		const e = Math.asin(Math.sin(lat * R) * Math.sin(dec * R) + Math.cos(lat * R) * Math.cos(dec * R) * Math.cos(H))
		const cosA = (Math.sin(dec * R) - Math.sin(e) * Math.sin(lat * R)) / (Math.cos(e) * Math.cos(lat * R))
		let az = Math.acos(Math.max(-1, Math.min(1, cosA))) / R
		if (H > 0) az = 360 - az
		return { e: e / R, az, shadow: 1 / Math.tan(e) }
	}
	const r = run([{ id: "stick", type: "gnomon", x: 1.3, y: 0, props: { height: 1.0, latitude: 30.27, season: "march equinox", hour: 8 } }], { seconds: 8.01, settings: { time_lapse: 3600 }, fps: 120 })
	const at = (t: number) => r.track.frames.findIndex((f) => f.t >= t - 1e-9)
	const st = r.track.state?.stick as Record<string, number[]>
	const k12 = at(4)
	const k9 = at(1)
	const k15 = at(7)
	check("S9 noon: the Sun's height (90° − latitude)", st.sun_elevation?.[k12] as number, 59.73, 0.0005, "°")
	check("S9 noon: the shadow 1/tan(59.73°)", st.shadow_m?.[k12] as number, 0.584, 0.003, " m")
	check("S9 noon: the shadow points north", st.shadow_dir?.[k12] as number, 0, 0.01, "°", false)
	const shortest = Math.min(...(st.shadow_m ?? []).filter((v) => v > 0))
	check("S9 the shortest shadow of the day is at noon", shortest, st.shadow_m?.[k12] as number, 1e-9, " m")
	check("S9 9:00: the Sun's height", st.sun_elevation?.[k9] as number, ref(30.27, 0, 9).e, 0.0005, "°")
	check("S9 9:00: the shadow (spec 1.30 m)", st.shadow_m?.[k9] as number, 1.30, 0.005, " m")
	truth("S9 9:00: the shadow points west-north-west", Math.abs((st.shadow_dir?.[k9] as number) - (ref(30.27, 0, 9).az + 180)) < 0.05 && (st.shadow_dir?.[k9] as number) > 270 && (st.shadow_dir?.[k9] as number) < 315, `${(st.shadow_dir?.[k9] as number).toFixed(1)}°`)
	check("S9 15:00: the same length as at 9:00", st.shadow_m?.[k15] as number, st.shadow_m?.[k9] as number, 1e-6, " m")
	truth("S9 15:00: the shadow points east-north-east", (st.shadow_dir?.[k15] as number) > 45 && (st.shadow_dir?.[k15] as number) < 90, `${(st.shadow_dir?.[k15] as number).toFixed(1)}°`)
	for (const [season, dec, noon, day] of [["june solstice", 23.44, 0.12, 13.9], ["december solstice", -23.44, 1.36, 10.1]] as const) {
		const q = run([{ id: "stick", type: "gnomon", x: 1.3, y: 0, props: { height: 1.0, latitude: 30.27, season, hour: 12 } }], { seconds: 1, fps: 120 })
		const sq = q.track.state?.stick as Record<string, number[]>
		check(`S10 ${season}: the noon shadow`, sq.shadow_m?.[0] as number, noon, 0.01, " m")
		check(`S10 ${season}: the noon shadow against the formula`, sq.shadow_m?.[0] as number, ref(30.27, dec, 12).shadow, 1e-9, " m")
		// (the geometric day, Sun's centre on the horizon: refraction and the Sun's disc add about 6 minutes to a real one; the spec's numbers are to 0.1 h)
		check(`S10 ${season}: the day length (spec, to 0.1 h)`, sq.day_length_h?.[0] as number, day, 0.06, " h", false)
		check(`S10 ${season}: the day length 2·acos(−tan φ tan δ)/15`, sq.day_length_h?.[0] as number, (2 * Math.acos(-Math.tan(30.27 * R) * Math.tan(dec * R))) / R / 15, 1e-9, " h")
	}
}

// ---------------------------------------------------------------- the classroom models: a globe under a light, a moon ball on a stick
if (which === "all" || which === "classroom") {
	console.log("\n== classroom: S8 day and night on a turning globe, S10 its solstices, S7 a moon ball's phases and eclipses")
	const R = Math.PI / 180
	const meeus = (lat: number, dec: number, hour: number) => Math.asin(Math.sin(lat * R) * Math.sin(dec * R) + Math.cos(lat * R) * Math.cos(dec * R) * Math.cos((hour - 12) * 15 * R)) / R
	const dayLen = (lat: number, dec: number) => (2 * Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat * R) * Math.tan(dec * R))))) / R / 15
	/** The times (s) the town's `day` reading turns on (sunrise) and off (sunset), between frames (linear in the light's height). */
	const crossings = (r: ReturnType<typeof run>, id: string) => {
		const d = series(r, id, "day")
		const e = series(r, id, "sun_elevation")
		const up: number[] = []
		const down: number[] = []
		for (let k = 1; k < d.length; k++) {
			if (d[k] === d[k - 1]) continue
			const t0 = r.track.frames[k - 1]?.t as number
			const t1 = r.track.frames[k]?.t as number
			const a = e[k - 1] as number
			const b = e[k] as number
			const t = b !== a ? t0 + ((0 - a) / (b - a)) * (t1 - t0) : t1
			;((d[k] as number) > 0.5 ? up : down).push(t)
		}
		return { up, down }
	}
	// S8 with parallel light (the far Sun of an orbit scene would do; here the optics module's sunlight from the left, 5° up, its lowest):
	// the globe's pole leans toward the camera, so the light is overhead at asin(cos 23.44° · sin 5°)
	if (has.has("sunlight")) {
		const turn = 10
		const r = run([
			{ id: "sun", type: "sunlight", x: -0.3, y: 0.4, props: { elevation: 5, comes_from: "left" } },
			{ id: "globe", type: "globe", x: 1.3, y: 0, props: { spin_rpm: 60 / turn, start_hour: 0, town_lat: 30.27 } },
			{ id: "eq", type: "globe", x: 2.2, y: 0, props: { spin_rpm: 60 / turn, start_hour: 0, town_lat: 0 } }
		], { seconds: 2 * turn + 0.2, fps: 240, goals: [{ kind: "day_night", item: "globe", days: 2 }, { kind: "day_night", item: "globe", is: "night", at_s: 0 }, { kind: "day_night", item: "globe", is: "day", at_s: turn / 2 }] })
		// (the sunlight's travel direction as its record has it, to 6 decimals: −5° = −0.087266 rad)
		const dir = (r.doc.processes?.find((q) => q.kind === "globe") as unknown as { light: { dir: number } }).light.dir
		const dec = Math.asin(Math.cos(23.44 * R) * Math.sin(-dir)) / R
		check("S8 the light is overhead where the tilt and the light's height say", series(r, "globe", "sun_lat")[0] as number, dec, 1e-6, "°")
		const { up, down } = crossings(r, "globe")
		truth("S8 the town sees a sunrise and a sunset each turn", up.length === 2 && down.length === 2, `sunrises at ${up.map((t) => t.toFixed(3)).join(", ")} s, sunsets at ${down.map((t) => t.toFixed(3)).join(", ")} s`)
		check("S8 one turn from sunrise to sunrise", (up[1] as number) - (up[0] as number), turn, 0.0005, " s")
		check("S8 the day's length (parallel light) = Meeus' 2·acos(−tan φ tan δ)/15", (((down[0] as number) - (up[0] as number)) / turn) * 24, dayLen(30.27, dec), 0.002, " h")
		check("S8 the day_length_h reading = Meeus", series(r, "globe", "day_length_h")[0] as number, dayLen(30.27, dec), 1e-6, " h")
		const eqx = crossings(r, "eq")
		check("S8 at the equator day and night are 12 h each (the terminator a great circle)", (((eqx.down[0] as number) - (eqx.up[0] as number)) / turn) * 24, 12, 0.002, " h")
		// the light's height at the town all through the run against Meeus' formula for its solar time (parallel light: exactly the Sun's)
		const E = series(r, "globe", "sun_elevation")
		const H = series(r, "globe", "local_time")
		let worst = 0
		E.forEach((e, k) => (worst = Math.max(worst, Math.abs((e as number) - meeus(30.27, dec, H[k] as number)))))
		check("S8 the light's height at the town = Meeus' sin e = sin φ sin δ + cos φ cos δ cos H, every frame (readings to 5 decimals)", worst, 0, 2e-4, "°", false)
		const T = r.track.frames.map((f) => f.t)
		let wt = 0
		H.forEach((h, k) => (wt = Math.max(wt, Math.abs(((((h as number) - (24 * (T[k] as number)) / turn) % 24) + 36) % 24 - 12))))
		check("S8 the town's solar time runs 24 h a turn from its start (0:00)", wt, 0, 2e-5, " h", false)
		check("S8 the noon light's height 90° − |φ − δ|", series(r, "globe", "noon_elevation")[0] as number, 90 - Math.abs(30.27 - dec), 1e-6, "°")
		truth("S8 goals: two days and nights, night at the start, day at noon", r.meta.summary.goals.every((g) => g.ok), r.meta.summary.goals.map((g) => `${g.label}: ${g.ok}`).join("; "))
	}
	// S8 with a near lamp: the light reaches less than half the globe (the cap where u·(L − C) > R): at an equinox cos H0 = (R/D)/cos φ.
	// The lamp's bulb level with the globe's middle (aimed straight right, its head 0.40 m up: the heat module's bulb is at the head's height)
	if (has.has("lamp")) {
		const turn = 10
		const r = run([
			{ id: "lamp", type: "lamp", x: 0.25, y: 0, props: { aim: 0, head_height: 0.4 } },
			{ id: "globe", type: "globe", x: 1.3, y: 0, props: { spin_rpm: 60 / turn, start_hour: 0, town_lat: 30.27 } }
		], { seconds: turn + 0.2, fps: 240 })
		const rec = r.doc.processes?.find((q) => q.kind === "globe") as unknown as { light: { x: number; y: number; solid: string } }
		const base = r.doc.solids.find((q) => q.id === rec.light.solid) as unknown as { at: { x: number; y: number } }
		const L = { x: base.at.x + rec.light.x, y: base.at.y + rec.light.y }
		const ball = r.doc.solids.find((q) => q.id === "globe/ball") as unknown as { at: { x: number; y: number }; body: { radius: number } }
		const D = Math.hypot(L.x - ball.at.x, L.y - ball.at.y)
		truth("S10 the lamp's bulb is level with the globe's middle", Math.abs(L.y - ball.at.y) < 1e-9, `bulb ${L.y.toFixed(5)} m, middle ${ball.at.y.toFixed(5)} m, ${D.toFixed(4)} m apart`)
		const { up, down } = crossings(r, "globe")
		const capH0 = Math.acos(ball.body.radius / D / Math.cos(30.27 * R)) / R
		check("S8 a near lamp lights a cap less than half: the day 2·acos((R/D)/cos φ)/15", (((down[0] as number) - (up[0] as number)) / turn) * 24, (2 * capH0) / 15, 0.004, " h")
		truth("S8 so its day is shorter than the 12 h of parallel light", ((down[0] as number) - (up[0] as number)) / turn * 24 < 11.9, `${((((down[0] as number) - (up[0] as number)) / turn) * 24).toFixed(3)} h`)
		// S10: lean toward the light (June) and away (December); the light level: overhead at ±23.44° exactly
		for (const [lean, dec, noon, day] of [["toward the light", 23.44, 83.17, 13.95], ["away from the light", -23.44, 36.29, 10.05]] as const) {
			const q = run([
				{ id: "lamp", type: "lamp", x: 0.25, y: 0, props: { aim: 0, head_height: 0.4 } },
				{ id: "globe", type: "globe", x: 1.3, y: 0, props: { lean, spin_rpm: 6, start_hour: 12, town_lat: 30.27 } }
			], { seconds: 0.5, fps: 120, goals: [{ kind: "noon_sun", item: "globe", deg: noon, tol: 0.01 }] })
			check(`S10 table, ${lean}: the light overhead at`, series(q, "globe", "sun_lat")[0] as number, dec, 1e-6, "°")
			check(`S10 table, ${lean}: the noon light at Austin (spec ${noon}°)`, series(q, "globe", "noon_elevation")[0] as number, noon, 0.0001, "°")
			check(`S10 table, ${lean}: the day's length (spec ${day} h)`, series(q, "globe", "day_length_h")[0] as number, dayLen(30.27, dec), 1e-6, " h")
			truth(`S10 table, ${lean}: goal noon_sun`, q.meta.summary.goals[0]?.ok === true, q.meta.summary.goals[0]?.label)
		}
	}
	// S7 with the model: a moon ball carried round the globe. A far Sun (an orbit scene's: parallel light, level) and a level circle first:
	// lit = (1 − cos E)/2 and a total lunar eclipse at full, a total solar one (its shadow on the globe) at new
	{
		const r = run([
			{ id: "sun", type: "sun", x: -0.6, y: 0.4, props: { pulls: false } },
			{ id: "globe", type: "globe", x: 1.3, y: 0, props: { spin_rpm: 0 } },
			{ id: "ball", type: "moon-ball", x: 1.3, y: 0.4, props: { around: "globe", period_s: 8, tilt_deg: 0, start_deg: 0 } }
		], { seconds: 8.01, fps: 120, goals: [{ kind: "eclipse", type: "lunar", total: true }, { kind: "eclipse", type: "solar", total: true }] })
		const E = series(r, "ball", "elongation")
		const L = series(r, "ball", "lit")
		let worst = 0
		E.forEach((e, k) => (worst = Math.max(worst, Math.abs((L[k] as number) - (1 - Math.cos(e * R)) / 2))))
		check("S7 model, parallel light, level circle: lit = (1 − cos E)/2", worst, 0, 1e-9, "", false)
		const T = r.track.frames.map((f) => f.t)
		let we = 0
		E.forEach((e, k) => (we = Math.max(we, Math.abs((((e as number) - (360 * (T[k] as number)) / 8) % 360 + 540) % 360 - 180))))
		check("S7 model: the elongation goes round 360° a trip, from the light's side", we, 0, 1e-6, "°", false)
		truth("S7 model, level circle: a total lunar eclipse at full and a total solar one at new", r.meta.summary.goals.every((g) => g.ok), r.meta.summary.goals.map((g) => `${g.label}: ${g.ok}`).join("; "))
		const lu = series(r, "ball", "lunar_eclipse")
		const kFull = T.findIndex((t) => t >= 4)
		truth("S7 model: the lunar eclipse is at full (the ball behind the globe)", (lu[kFull] as number) === 3 && (lu[0] as number) === 0, `at 4 s: ${lu[kFull]}`)
	}
	// with the lamp, the default tilted circle (30°, its high point at full): the phases in order, no eclipses; the elongation and the lit
	// fraction against where the hand has it, recomputed here from the circle's definition (the horizontal circle round the globe's middle,
	// turned `tilt` about its line of nodes)
	if (has.has("lamp")) {
		const period = 12
		const r = run([
			{ id: "lamp", type: "lamp", x: 0.15, y: 0, props: { target: "globe" } },
			{ id: "globe", type: "globe", x: 1.4, y: 0, props: { spin_rpm: 0 } },
			{ id: "ball", type: "moon-ball", x: 1.4, y: 0.4, props: { around: "globe", period_s: period } }
		], { seconds: period + 0.01, fps: 120, goals: [{ kind: "eclipse", type: "lunar", none: true }, { kind: "eclipse", type: "solar", none: true }, { kind: "phase", item: "ball", name: "full moon", any: true }] })
		const space = (await import(`${PG}/web/sim/modules/space.js`)) as { phase_name: (e: number) => string; PHASE_NAMES: string[] }
		const E = series(r, "ball", "elongation")
		const Lt = series(r, "ball", "lit")
		const seen: string[] = []
		for (const e of E) {
			const n = space.phase_name(e as number)
			if (seen[seen.length - 1] !== n) seen.push(n)
		}
		truth("S7 model with the lamp: the phases in order round a trip", seen.slice(0, 9).join(" → ") === [...space.PHASE_NAMES, "new moon"].join(" → "), seen.join(" → "))
		truth("S7 model with the lamp, tilted 30°: no eclipse, a full moon", r.meta.summary.goals.every((g) => g.ok), r.meta.summary.goals.map((g) => `${g.label}: ${g.ok}`).join("; "))
		const rec = r.doc.processes?.find((q) => q.kind === "moon-ball") as unknown as { light: { x: number; y: number; solid: string }; radius: number; tilt: number; node: number }
		const base = r.doc.solids.find((q) => q.id === rec.light.solid) as unknown as { at: { x: number; y: number } }
		const Lp = [base.at.x + rec.light.x, base.at.y + rec.light.y, 0]
		const C = [1.4, 0.4, 0]
		const sub = (a: number[], b: number[]) => a.map((v, i) => v - (b[i] as number))
		const dot = (a: number[], b: number[]) => a.reduce((t, v, i) => t + v * (b[i] as number), 0)
		const unit = (a: number[]) => a.map((v) => v / Math.hypot(...a))
		const h = unit([Lp[0] as number - 1.4, 0, 0])
		const node = rec.node * R
		const tilt = rec.tilt * R
		let we = 0
		let wl = 0
		const T = r.track.frames.map((f) => f.t)
		E.forEach((e, k) => {
			const u = (360 * (T[k] as number)) / period * R
			// the horizontal circle (counter-clockwise from above: h, then h turned a quarter toward the camera), the part across the line of nodes tilted up
			const a = u - node
			const n = [Math.cos(node) * (h[0] as number), 0, Math.cos(node) * (h[2] as number) + Math.sin(node) * 1 * Math.sign(-(h[0] as number))]
			const along = Math.cos(a) * rec.radius
			const across = Math.sin(a) * rec.radius
			const wdir = [-Math.sin(node) * (h[0] as number), 0, Math.cos(node) * Math.sign(-(h[0] as number))]
			const p = [C[0] as number + along * (n[0] as number) + across * Math.cos(tilt) * (wdir[0] as number), (C[1] as number) + across * Math.sin(tilt), along * (n[2] as number) + across * Math.cos(tilt) * (wdir[2] as number)]
			const toL = unit(sub(Lp, p))
			const toC = unit(sub(C, p))
			wl = Math.max(wl, Math.abs((Lt[k] as number) - (1 + dot(toL, toC)) / 2))
			// the elongation: the angle at the middle from the light to the ball, measured the way it goes
			// the elongation: the difference of the ball's and the light's longitudes seen from the middle, round the vertical (counter-clockwise
			// from above), as the astronomers' phases go by ecliptic longitude
			const sL = sub(Lp, C)
			const q = sub(p, C)
			const lon = (v: number[]) => Math.atan2(-(v[2] as number), v[0] as number) // (counter-clockwise from above: +x toward −z)
			const Ewant = ((((lon(q) - lon(sL)) / R) % 360) + 360) % 360
			we = Math.max(we, Math.abs(Math.min(Math.abs((e as number) - Ewant), 360 - Math.abs((e as number) - Ewant))))
		})
		check("S7 model with the lamp: lit fraction (1 + cos i)/2 at the hand's place, recomputed", wl, 0, 1e-6, "", false)
		check("S7 model with the lamp: elongation (by longitude round the vertical), recomputed", we, 0, 2e-4, "°", false)
	}
}

// ---------------------------------------------------------------- seasons round the Sun (orbit mode)
if (which === "all" || which === "seasons") {
	console.log("\n== seasons: S10 the Earth round the Sun, its axis kept pointing one way")
	const R = Math.PI / 180
	const r = run([
		{ id: "sun", type: "sun", x: 1.4, y: 1.45 },
		{ id: "earth", type: "planet", x: 2.4, y: 1.45, props: { primary: "sun", seasons: true, start_date: "march equinox", town_lat: 30.27 } }
	], { seconds: 9.7, fps: 120, stage: { x0: 0, x1: 2.9, y0: 0.2, y1: 2.7 }, goals: [{ kind: "noon_sun", item: "earth", deg: 83.17, tol: 0.05, at_s: 0.5 + 9.1314 / 4 },
		{ kind: "night_sky", item: "earth", constellation: "Orion", at_s: 0.5 + (3 * 9.1314) / 4 }, { kind: "night_sky", item: "earth", constellation: "Sagittarius", at_s: 0.5 + 9.1314 / 4 }, { kind: "night_sky", item: "earth", constellation: "Virgo", at_s: 0 }] })
	const D = series(r, "earth", "sun_lat")
	const N = series(r, "earth", "noon_elevation")
	const frames = r.track.frames
	// its angle round the Sun from the start (the March equinox), from the placements: the June solstice is a quarter turn on
	let worst = 0
	let kMax = 0
	let kMin = 0
	const year = 9.1314 // 365.256 days at 40 days a second
	frames.forEach((f, k) => {
		const e = f.placements["earth/body"] as P
		const s = f.placements["sun/body"] as P
		// 0 at the start (the Earth to the right of the Sun); the readings lag the placements by one 1/480 s step (CONTRACT), so a step back
		const th = Math.atan2(e.y - s.y, e.x - s.x) - (f.t > 0.5 ? (2 * Math.PI) / year / 480 : 0)
		worst = Math.max(worst, Math.abs((D[k] as number) - Math.asin(Math.sin(23.44 * R) * Math.sin(th)) / R))
		if ((D[k] as number) > (D[kMax] as number)) kMax = k
		if ((D[k] as number) < (D[kMin] as number)) kMin = k
	})
	check("S10 orbit: the Sun overhead at asin(sin 23.44° · sin θ) all year (the axis kept one way)", worst, 0, 3e-4, "°", false)
	check("S10 orbit: the June solstice: the Sun overhead at +23.44°", D[kMax] as number, 23.44, 0.0005, "°")
	check("S10 orbit: the December solstice: −23.44°", D[kMin] as number, -23.44, 0.0005, "°")
	check("S10 orbit: the June solstice a quarter year after the March equinox", (frames[kMax]?.t as number) - 0.5, year / 4, 0.01, " s")
	check("S10 orbit: Austin's noon Sun at the start (March equinox)", N[0] as number, 59.73, 0.0001, "°")
	check("S10 orbit: Austin's noon Sun at the June solstice (spec 83.2°)", N[kMax] as number, 83.17, 0.0001, "°")
	check("S10 orbit: Austin's noon Sun at the December solstice (spec 36.3°)", N[kMin] as number, 36.29, 0.0001, "°")
	truth("S10 orbit: goal noon_sun at the June solstice", r.meta.summary.goals[0]?.ok === true, r.meta.summary.goals[0]?.label)
	// 5-ESS1-2: the stars change with the seasons: the midnight sky is the ecliptic longitude opposite the Sun (the Sun's: 0 at the March equinox)
	const NL = series(r, "earth", "night_lon")
	check("the midnight sky at the March equinox: longitude 180° (Virgo)", NL[0] as number, 180, 1e-6, "°", false)
	check("at the June solstice: 270° (Sagittarius)", NL[kMax] as number, 270, 0.15, "°", false)
	check("at the December solstice: 90° (Taurus and Gemini, Orion high)", NL[kMin] as number, 90, 0.15, "°", false)
	truth("goals night_sky: Orion in December, Sagittarius in June, Virgo in March", r.meta.summary.goals.slice(1).every((g) => g.ok), r.meta.summary.goals.slice(1).map((g) => `${g.label}: ${g.ok}`).join("; "))
}

// ---------------------------------------------------------------- eclipses (the Moon's tilted orbit, the real sizes)
if (which === "all" || which === "eclipses") {
	console.log("\n== eclipses: the Moon's orbit tilted 5.145°: eclipses near the nodes only")
	const R = Math.PI / 180
	// the Sun far to the left (parallel light from 1 au), the Earth, the Moon on the far side (full) or the near side (new)
	const scene = (moonX: number, node: number, seconds: number, goals: unknown[] = []) =>
		run([
			{ id: "sun", type: "sun", x: -0.45, y: 1.45, props: { pulls: false } },
			{ id: "earth", type: "planet", x: 1.6, y: 1.45 },
			{ id: "moon", type: "moon", x: moonX, y: 1.45, props: { primary: "earth", node_deg: node } }
		], { seconds, fps: 480, release: 0.5, goals })
	const full = 1.6 + 384400 / 300000
	// (the eclipse's length on a slow clock: the Earth's scale custom, 1 s = 1 h, so a step is 7.5 real seconds; the Earth held still: at this
	// clock its recoil, 0.15 mm/s, is under planck's sleep tolerance, and a sleeping body's velocity is zeroed: CONTRACT, known limits)
	const r = run([
		{ id: "sun", type: "sun", x: -0.45, y: 1.45, props: { pulls: false } },
		{ id: "earth", type: "planet", x: 1.6, y: 1.45, fixed: true, props: { scale: "custom", km_per_m: 300000, hours_per_s: 1 } },
		{ id: "moon", type: "moon", x: full, y: 1.45, props: { primary: "earth", node_deg: 0 } }
	], { seconds: 3.6, fps: 480, release: 0.5, goals: [{ kind: "eclipse", type: "lunar", total: true }] })
	truth("a total lunar eclipse at a full moon on the line of nodes", r.meta.summary.goals[0]?.ok === true, r.meta.summary.goals[0]?.label)
	// the umbral phase and totality: (2·(r_umbra ± r_moon))/v, the Moon's speed v from its reading (the far Sun holds still, so the shadow does)
	const lu = series(r, "moon", "lunar_eclipse")
	const T = r.track.frames.map((f) => f.t)
	const span = (min: number) => {
		const ks = lu.flatMap((v, k) => ((v as number) >= min ? [k] : []))
		return ks.length ? (T[ks[ks.length - 1] as number] as number) - (T[ks[0] as number] as number) : 0
	}
	const sp = series(r, "moon", "speed_kms")
	const v = sp[sp.length - 1] as number
	const sPerS = 3600
	const AU = 149598000
	const umbra = 6371 - (384400 * (695700 - 6371)) / AU // km, at the Moon's distance
	const pen = 6371 + (384400 * (695700 + 6371)) / AU
	// (the run starts at the full moon, mid-eclipse: half the umbral phase and half of totality are in it before... the run starts at 0, so the
	// eclipse's first half is cut: measure from the start of the run, after the release, its second half)
	const half = (min: number) => {
		const ks = lu.flatMap((x, k) => ((x as number) >= min && (T[k] as number) >= 0.5 ? [k] : []))
		return ks.length ? (T[ks[ks.length - 1] as number] as number) - 0.5 : 0
	}
	check("totality: twice its half after the full moon = 2·(r_umbra − r_moon)/v (real eclipses: up to 1.7 h of totality)", (half(3) * 2 * sPerS) / 3600, (2 * (umbra - 1737.4)) / v / 3600, 0.005, " h")
	check("the umbral phase: 2·(r_umbra + r_moon)/v (real: up to 3.8 h)", (half(2) * 2 * sPerS) / 3600, (2 * (umbra + 1737.4)) / v / 3600, 0.005, " h")
	check("the penumbral phase: 2·(r_penumbra + r_moon)/v (real: up to 6 h)", (half(1) * 2 * sPerS) / 3600, (2 * (pen + 1737.4)) / v / 3600, 0.005, " h")
	void span
	// a month with the nodes square to the Sun: the full and new moons pass 5.1° above and below the shadows
	const m = scene(full, 90, 14.2, [{ kind: "eclipse", type: "lunar", none: true }, { kind: "eclipse", type: "solar", none: true }, { kind: "phase", item: "moon", name: "new moon", any: true }])
	truth("a month with the nodes square to the Sun: phases but no eclipse", m.meta.summary.goals.every((g) => g.ok), m.meta.summary.goals.map((g) => `${g.label}: ${g.ok}`).join("; "))
	const lat = series(m, "moon", "latitude")
	check("the Moon's greatest angle above the plane (its orbit's tilt, seen from the Earth)", Math.max(...lat.map((x) => Math.abs(x as number))), 5.145, 0.002, "°")
	// the eclipse limits: the largest angle of the full (new) moon from a node that still gives each kind, by bisection on node_deg, against the
	// cones' closed form: the Moon's height above the plane at angle u from the node, r·tan(i)·sin u, against the shadow's half-width there
	const lunarAt = (u: number) => Math.max(...series(scene(full, u, 0.501), "moon", "lunar_eclipse").slice(0, 3).map(Number))
	const solarAt = (u: number) => Math.max(...series(scene(1.6 - 384400 / 300000, u, 0.501), "moon", "solar_eclipse").slice(0, 3).map(Number))
	const limit = (f: (u: number) => number, need: number) => {
		let lo = 0
		let hi = 40
		for (let i = 0; i < 18; i++) {
			const mid = (lo + hi) / 2
			if (f(mid) >= need) lo = mid
			else hi = mid
		}
		return lo
	}
	// at the full moon the Moon is 180° from the Sun: node_deg u puts the node u° before it, the Moon at u from the node (its height r·tan i·sin(180 − u))
	const tanI = Math.tan(5.145 * R)
	const r0 = 384400 // km: the Moon's distance (1.28133 m × 300,000 km)
	const uFor = (across: number) => Math.asin(across / (r0 * tanI)) / R
	// (the Moon's shadow's axis runs from the Sun through the Moon: at the Earth, AU/(AU − r) farther from the plane than the Moon is)
	const uForS = (across: number) => Math.asin((across * (AU - r0)) / AU / (r0 * tanI)) / R
	// (across, km: the Moon's centre from the shadow's axis; the umbra and penumbra at its distance; the solar side at the Earth)
	const umb = 6371 - (r0 * (695700 - 6371)) / AU
	const penL = 6371 + (r0 * (695700 + 6371)) / AU
	const sUmb = 1737.4 - (r0 * (695700 - 1737.4)) / (AU - r0)
	const sPen = 1737.4 + (r0 * (695700 + 1737.4)) / (AU - r0)
	// (node_deg u: the full moon at the start is u° from the descending node, the new moon u° from the ascending one: its height r·tan i·sin u)
	check("lunar eclipse limit, total (the full moon within u of a node)", limit((u) => lunarAt(u), 3), uFor(umb - 1737.4), 0.02, "°", false)
	check("lunar eclipse limit, umbral (partial)", limit((u) => lunarAt(u), 2), uFor(umb + 1737.4), 0.02, "°", false)
	check("lunar eclipse limit, penumbral", limit((u) => lunarAt(u), 1), uFor(penL + 1737.4), 0.02, "°", false)
	check("solar eclipse limit, central (annular at the mean distance)", limit((u) => solarAt(u), 2), uForS(-sUmb + 6371), 0.02, "°", false)
	check("solar eclipse limit, partial", limit((u) => solarAt(u), 1), uForS(sPen + 6371), 0.02, "°", false)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
