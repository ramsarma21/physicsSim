// The lesson's kitchen grains and liquids (2026-10-20) against theory and measurements: sugar, salt and rice poured from funnels and from a
// tipped cup, grains kept inside jars, glasses, cups, bowls and boxes, and milk, chocolate milk and white and brown colouring
// (tooling/src/sim/granular.ts GRAINS, holderOf, heapIn, TipCup; tooling/src/sim/modules/granular.ts; tooling/src/sim/flow.ts seenOf;
// machines/mod_granular.py, mod_flow.py, mod_fluids.py and their ports). Every scene is built by web/sim (the exact port of the Python builder)
// and run by the server's engine (node, with the browser bundle's math), at 480 Hz, 120 frames a second. Exits 1 on any failure (a gate).
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-kitchen.ts [grains|glass|containers|cup|cupengine|conserve|liquids|color|determinism|fuzz|perf|all]
// Reference values (cited where they are used; the files' headers have them in full):
//   [CRC] sucrose 1587 kg/m³, sodium chloride 2165 kg/m³. [ETB-BULK] granulated sugar 800 kg/m³, clean rice 770 kg/m³. [SALT-SPEC] fine table
//   salt 1100-1300 kg/m³. [ETB-REPOSE] sugar, salt and rice 30-45° (35°, 32°, 32° used). [BEVERLOO61] W = 0.58·ρ_b·√g·(D − 1.4d)^2.5.
//   [ZURIGUEL05] an outlet under about 5 grains jams. The tipped cup: a heap at rest turns with its cup until its surface passes the angle of
//   repose φ; it holds what lies under the repose line through the lip: a cup w wide and h deep, filled to a share f, starts pouring at
//   φ + atan(2h(1 − f)/w) (f ≥ ½: the line leaves by the back wall) or φ + atan(h/(2fw)) (f < ½: by the floor); tipped to θ > φ (that line
//   leaving by the floor) it holds ½h²/tan(θ − φ) of its section. [MILK-RHO] whole milk 1030.5 kg/m³ at 20 °C; [MILK-MU] 2.1 mPa·s.
//   [KUBELKA31] R∞ = 1 + K/S − √((K/S)² + 2K/S), K = 2a.
const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const sim = (await import(`${PG}/web/sim/index.js`)) as {
	clean: (s: unknown) => Scene
	layout: (s: unknown) => { doc: Doc; resolved: Record<string, Record<string, unknown>> }
	finish: (s: unknown, d: Doc, r: unknown, t: Track) => { summary: { goals: { ok: boolean; label: string; color?: string }[]; readings?: Record<string, Record<string, number>>; happenings?: { t: number; text: string }[] } }
}
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: unknown } }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: unknown, fps: number) => Track }
await import(`${PG}/tooling/src/sim/modules/index.ts`)
const core = (await import(`${PG}/tooling/src/sim/granular.ts`)) as typeof import("../tooling/src/sim/granular.ts")
const optics = (await import(`${PG}/tooling/src/sim/flow.ts`)) as typeof import("../tooling/src/sim/flow.ts")
const plug = (await import(`${PG}/tooling/src/sim/plugins.ts`)) as { slimExtras: (t: Track, r: (v: number, d: number) => number) => Partial<Track> }

type Scene = { items: Item[]; [k: string]: unknown }
type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; held?: boolean; fixed?: boolean; name?: string }
type Doc = { solids: { id: string; item: string; kind: string; body: Record<string, unknown>; at: { x: number; y: number } }[]; processes?: { kind: string; item?: string; [k: string]: unknown }[] }
type Track = { frames: { t: number; placements: Record<string, { x: number; y: number; angle: number }> }[]; state?: Record<string, Record<string, number[]>>; events?: { t: number; text: string }[]; keyframes?: unknown }

const G = 9.81
const DEG = Math.PI / 180
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const want = process.argv[2] ?? "all"
let failures = 0
let checks = 0
const line = (ok: boolean, text: string) => {
	checks++
	if (!ok) failures++
	console.log(`${ok ? "PASS" : "FAIL"}  ${text}`)
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toPrecision(4))
const check = (label: string, got: number, ref: number, tol: number, unit = "", src = "") =>
	line(Number.isFinite(got) && Math.abs(got - ref) <= tol, `${label}: ${fmt(got)} ${unit} vs ${fmt(ref)} ${unit} (± ${fmt(tol)})${src ? `  [${src}]` : ""}`)
const within = (label: string, got: number, ref: number, rel: number, unit = "", src = "") => check(label, got, ref, Math.abs(ref) * rel, unit, src)
const claim = (label: string, ok: boolean) => line(ok, label)

const scene = (items: Item[], seconds = 4, extra: Record<string, unknown> = {}): Scene =>
	({ version: 2, name: "v", seconds, release: 0.5, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0 }, ...items], goals: [], ...extra }) as unknown as Scene
let cpuMs = 0
const run = (s: Scene) => {
	const c = sim.clean(s)
	const { doc, resolved } = sim.layout(c)
	const cpu0 = process.cpuUsage()
	const raw = simulate(admitDocument(doc).scene, 120)
	const ms = process.cpuUsage(cpu0).user / 1000
	cpuMs += ms
	const track = { ...raw, ...plug.slimExtras(raw, (v, d) => Number(v.toFixed(d))) } as Track
	const summary = sim.finish(c, doc, resolved, track).summary
	return { doc, resolved, track, summary, scene: c, ms }
}
const last = (track: Track, item: string, key: string) => {
	const v = track.state?.[item]?.[key]
	return v && v.length ? (v[v.length - 1] as number) : Number.NaN
}
const series = (track: Track, item: string, key: string) => track.state?.[item]?.[key] ?? []
const bulk = (g: string) => core.bulkDensity(core.GRAINS[g]!, "dry")
const beverloo = (g: string, D: number) => core.beverlooRate(core.GRAINS[g]!, "dry", D, G) * bulk(g)
const REPOSE: Record<string, number> = { sugar: 35, salt: 32, rice: 32, sand: 34, "coarse sand": 35, "fine sand": 32 }

// ---------------------------------------------------------------- the grains: their packing, their heaps, their flow
if (want === "all" || want === "grains") {
	console.log("\n# grains: sugar, salt and rice as packed beds [CRC] [ETB-BULK] [SALT-SPEC], their heaps at their angles of repose [ETB-REPOSE], Beverloo's flow")
	check("granulated sugar's bulk density", bulk("sugar"), 800, 1, "kg/m³", "ETB-BULK: 800")
	check("table salt's bulk density", bulk("salt"), 1200, 1, "kg/m³", "SALT-SPEC: 1100-1300")
	check("rice's bulk density", bulk("rice"), 770, 1, "kg/m³", "ETB-BULK: clean rice 770")
	check("sugar's crystals", core.GRAINS.sugar!.rhoS, 1587, 0, "kg/m³", "CRC")
	check("salt's crystals", core.GRAINS.salt!.rhoS, 2165, 0, "kg/m³", "CRC")
	for (const [grain, spout, kg] of [["sugar", 12, 0.3], ["salt", 12, 0.3], ["rice", 25, 0.25]] as const) {
		const W = beverloo(grain, spout / 1000) * 1000
		const R = run(scene([{ id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain, sand_kg: kg, outlet_mm: spout, height: 0.3 } }], (kg * 1000) / W + 3))
		within(`${grain}: all poured`, last(R.track, "f", "poured_g"), kg * 1000, 0.005, "g")
		check(`${grain}: its heap's slope on the table`, last(R.track, "f", "heap_deg"), REPOSE[grain]!, 3, "°", "ETB-REPOSE")
		const poured = series(R.track, "f", "poured_g")
		const frames = R.track.frames
		const ia = poured.findIndex((v) => v >= 0.2 * kg * 1000)
		const ib = poured.findIndex((v) => v >= 0.8 * kg * 1000)
		const rate = ia >= 0 && ib > ia ? ((poured[ib] as number) - (poured[ia] as number)) / ((frames[ib]?.t ?? 0) - (frames[ia]?.t ?? 0)) : Number.NaN
		within(`${grain} through ${spout} mm: its flow`, rate, W, 0.05, "g/s", "BEVERLOO61")
	}
	for (const [grain, spout, clogs] of [["rice", 12, true], ["rice", 20, false], ["sugar", 2, true], ["sugar", 4, false]] as const) {
		const R = run(scene([{ id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain, sand_kg: 0.05, outlet_mm: spout, height: 0.25 } }], 2.5))
		claim(`${grain} through a ${spout} mm spout ${clogs ? "clogs" : "pours"} (5 grains: ${fmt(5 * core.GRAINS[grain]!.d * 1000)} mm [ZURIGUEL05]; poured ${fmt(last(R.track, "f", "poured_g"))} g)`,
			clogs ? series(R.track, "f", "clogged").some((v) => v === 1) && last(R.track, "f", "poured_g") < 1 : last(R.track, "f", "poured_g") > 1)
	}
	// (salt's 2 mm is a funnel's narrowest spout: its jam is seen in a sand timer's neck)
	for (const [neck, jams] of [[1.5, true], [3, false]] as const) {
		const R = run(scene([{ id: "hg", type: "hourglass", x: 1.2, y: 0, props: { grain: "salt", neck_mm: neck, sand_kg: 0.03 } }], 3, { settings: { time_lapse: 4 } }))
		claim(`salt through a ${neck} mm timer neck ${jams ? "jams" : "runs"} (5 grains: 2 mm [ZURIGUEL05]; bottom ${fmt(last(R.track, "hg", "bottom_g"))} g)`,
			jams ? last(R.track, "hg", "clogged") === 1 && last(R.track, "hg", "bottom_g") < 0.5 : last(R.track, "hg", "bottom_g") > 1)
	}
}

// ---------------------------------------------------------------- 400 g of sand into a 6.5 cm glass: all of it stays in
if (want === "all" || want === "glass") {
	console.log("\n# glass: 400 g of sand poured into a glass 6.5 cm across (the lesson's tall glass): none of it outside; a level bed topped by a cone at the angle of repose")
	const R = run(scene([{ id: "glass", type: "glass-jar", x: 1.2, y: 0, props: { width: 0.065, depth: 0.065, wall: 0.16 } }, { id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain: "sand", sand_kg: 0.4, height: 0.3, outlet_mm: 15 } }], 8))
	check("grains outside the glass", last(R.track, "f", "outside_g"), 0, 0.5, "g")
	check("grains in the glass", last(R.track, "f", "heap_g"), 400, 0.5, "g")
	// (the inside: 65 mm less 3 mm of glass each side; the bed level V − the cone's, then the cone of its slope to the wall)
	const r = 0.0325 - 0.003
	const V = 0.4 / bulk("sand")
	const hc = r * Math.tan(34 * DEG)
	const apex = (V - (Math.PI * r * r * hc) / 3) / (Math.PI * r * r) + hc
	check("its height over the glass's floor", last(R.track, "f", "heap_mm"), apex * 1000, 3, "mm", "level bed + 34° cone")
	check("its cone's slope", last(R.track, "f", "heap_deg"), 34, 2, "°", "ETB-REPOSE")
}

// ---------------------------------------------------------------- every kind of container holds what is poured or heaped into it
if (want === "all" || want === "containers") {
	console.log("\n# containers: jars, a tapered plastic cup, a box, a bowl, a mug, a beaker and a wide dish keep their grains; the heap inside at its angle of repose")
	const cases: [string, string, Item[], string, number][] = [
		["sugar into the pint jar", "sugar", [{ id: "c", type: "glass-jar", x: 1.2, y: 0 }, { id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain: "sugar", sand_kg: 0.2, height: 0.25, outlet_mm: 12 } }], "f", 14],
		["sand into the jar made a 22 cm dish", "sand", [{ id: "c", type: "glass-jar", x: 1.2, y: 0, props: { width: 0.22, depth: 0.22, wall: 0.06 } }, { id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain: "sand", sand_kg: 0.3, height: 0.3, outlet_mm: 12 } }], "f", 13],
		["salt into a box on the table", "salt", [{ id: "c", type: "box", x: 1.4, y: 0, props: { hung: false } }, { id: "f", type: "sand-funnel", x: 1.4, y: 0, props: { grain: "salt", sand_kg: 0.3, height: 0.3 } }], "f", 20],
		["sand into a bowl", "sand", [{ id: "c", type: "bowl", x: 1.2, y: 0 }, { id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain: "sand", sand_kg: 0.3, height: 0.3, outlet_mm: 12 } }], "f", 13],
		["sugar into a mug", "sugar", [{ id: "c", type: "coffee-mug", x: 1.2, y: 0.0475 }, { id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain: "sugar", sand_kg: 0.1, height: 0.3, outlet_mm: 14 } }], "f", 8],
		["sugar into an empty beaker", "sugar", [{ id: "c", type: "beaker", x: 1.2, y: 0, props: { fill_ml: 0 } }, { id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain: "sugar", sand_kg: 0.15, height: 0.3, outlet_mm: 14 } }], "f", 10],
		["coarse sand into a bucket", "coarse sand", [{ id: "c", type: "bucket", x: 1.2, y: 0 }, { id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain: "coarse sand", sand_kg: 0.5, height: 0.45, outlet_mm: 15 } }], "f", 12]
	]
	for (const [label, grain, items, f, secs] of cases) {
		const R = run(scene(items, secs))
		const kg = (items[1]!.props!.sand_kg as number) * 1000
		check(`${label}: grains outside it`, last(R.track, f, "outside_g"), 0, 0.5, "g")
		check(`${label}: grains in it`, last(R.track, f, "heap_g"), kg, 0.5, "g")
		check(`${label}: its heap's slope`, last(R.track, f, "heap_deg"), REPOSE[grain]!, 3, "°", "ETB-REPOSE")
	}
	// a heap laid in a tapered cup (a sand-pile of rice put in a plastic cup): it stays in, at its angle
	const R = run(scene([{ id: "c", type: "plastic-cup", x: 1.0, y: 0 }, { id: "p", type: "sand-pile", x: 1.0, y: 0, props: { grain: "rice", sand_kg: 0.2 } }], 4))
	check("a rice heap laid in a plastic cup: spilled", last(R.track, "p", "spilled_g"), 0, 0.5, "g")
	check("a rice heap laid in a plastic cup: in it", last(R.track, "p", "mass_g"), 200, 0.5, "g")
	check("a rice heap laid in a plastic cup: its slope", last(R.track, "p", "angle_deg"), 32, 3, "°", "ETB-REPOSE")
	// a container that is not under the stream changes nothing: a funnel over the table beside a jar pours the heap it would without the jar
	const A = run(scene([{ id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { sand_kg: 0.2, height: 0.25 } }], 10))
	const B = run(scene([{ id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { sand_kg: 0.2, height: 0.25 } }, { id: "c", type: "glass-jar", x: 1.8, y: 0 }], 10))
	check("a jar 60 cm away: the funnel's heap the same", last(B.track, "f", "heap_mm"), last(A.track, "f", "heap_mm"), 0.5, "mm")
}

// ---------------------------------------------------------------- the tipped cup (TipCup on its own): when it starts, what it keeps, what it conserves
if (want === "all" || want === "cup") {
	console.log("\n# cup: a cup of grains turned slowly: it starts pouring where the repose line through its lip first leaves less than it holds")
	const w = 0.07
	const h = 0.095
	const D = (Math.PI / 4) * w
	const inside = [{ x: -w, y: -h }, { x: 0, y: -h }, { x: 0, y: 0 }, { x: -w, y: 0 }]
	const phi = 35
	const tanPhi = Math.tan(phi * DEG)
	const turn = (f: number, to: number) => {
		const cup = new core.TipCup(inside, D, f * w * h * D, tanPhi, 0.0005)
		const start = cup.volume()
		let first = Number.NaN
		let a = 0
		const dt = 1 / 480
		// (turned at 10°/s: slow enough to be still at every angle)
		while (a > -to * DEG) {
			a = Math.max(-to * DEG, a - 10 * DEG * dt)
			cup.step(a, dt, G)
			if (cup.out > 0 && !Number.isFinite(first)) first = -a / DEG
		}
		for (let k = 0; k < 2400; k++) cup.step(a, dt, G)
		return { first, cup, start }
	}
	for (const f of [0.3, 0.45, 0.55, 0.8, 0.97]) {
		const theory = f >= 0.5 ? phi + Math.atan((2 * h * (1 - f)) / w) / DEG : phi + Math.atan(h / (2 * f * w)) / DEG
		const { first, cup, start } = turn(f, 150)
		check(`filled ${Math.round(f * 100)} %: it starts to pour at`, first, theory, 1.5, "°", f >= 0.5 ? "φ + atan(2h(1 − f)/w)" : "φ + atan(h/(2fw))")
		claim(`filled ${Math.round(f * 100)} %, tipped to 150° (> 90° + φ): it empties (${fmt(cup.volume() * 1e6)} mL left)`, cup.volume() <= 1e-9 * start + 1e-15)
		check(`filled ${Math.round(f * 100)} %: what it held = what is in it + what it poured`, (cup.area + cup.poured) / cup.start, 1, 1e-12)
	}
	// tipped to 115° and held: what rests on its spout wall (now a 25° ramp, under φ): ½h²/tan(θ − φ) of its section, plus at most a layer of
	// two grains that does not flow
	const { cup } = turn(0.547, 115)
	const held = ((0.5 * h * h) / Math.tan((115 - phi) * DEG)) * D * bulk("sugar") * 1000
	const layer = 2 * 0.0005 * (h / Math.sin((115 - phi) * DEG)) * D * bulk("sugar") * 1000
	const got = cup.volume() * bulk("sugar") * 1000
	claim(`a cup 55 % full of sugar tipped to 115° keeps ${fmt(got)} g on its spout wall (theory ${fmt(held)} g, at most ${fmt(held + layer)} g with a two-grain layer)`, got >= held - 0.05 && got <= held + layer + 0.05)
	// a full cup tipped to just under the angle of repose keeps everything; just over, it pours
	const full = (to: number) => turn(0.999, to).cup.poured
	claim(`a full cup tipped to ${phi - 2}°: nothing pours (${fmt(full(phi - 2))} m² poured)`, full(phi - 2) === 0)
	claim(`a full cup tipped to ${phi + 4}°: it pours`, full(phi + 4) > 0)
	// turned as a hand tips it (90°/s, to 135°): past 90° + φ its spout wall stands steeper than repose and what rested on it slides out as a layer
	// no thicker than the grains over the line through the lip, at √(g·δ) (before: excess ÷ a chord the line only clipped at the corner, a
	// layer as thick as the cup is long, 69 mL at once at 1.8 m/s, a lump thrown 20 cm past the jar it was poured into)
	{
		const cup = new core.TipCup(inside, D, 0.547 * w * h * D, tanPhi, 0.0005)
		const dt = 1 / 480
		let most = 0
		let fastest = 0
		for (let k = 0; k < 2.5 * 480; k++) {
			const a = -Math.min(135, 90 * k * dt) * DEG
			const out = cup.step(a, dt, G)
			most = Math.max(most, out)
			fastest = Math.max(fastest, cup.speed)
		}
		const vmax = Math.sqrt(G * Math.hypot(w, h))
		claim(`a cup 55 % full turned to 135° at 90°/s: it empties (${fmt(cup.volume() * 1e6)} mL left), no step lets out more than 2 mL (most ${fmt(most * 1e6)} mL)`, cup.volume() <= 1e-12 && most <= 2e-6)
		claim(`... and its grains leave no faster than a layer as thick as the cup is wide and deep, √(g·√(w² + h²)) = ${fmt(vmax)} m/s (fastest ${fmt(fastest)} m/s)`, fastest <= vmax)
	}
}

// ---------------------------------------------------------------- the tipped cup in the engine: the flow module's hand tips it, its grains land in a jar
if (want === "all" || want === "cupengine") {
	console.log("\n# cupengine: a cup of sugar, salt or rice tipped by the hand into the pint jar: all of it lands in, none outside; mass kept exactly; no pillar under the stream")
	for (const grain of ["sugar", "salt", "rice"] as const) {
		const R = run(scene([{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "cup", type: "pitcher", x: 1.185, y: 0.15, props: { vessel: "cup", contents: "grains", grain, fill_ml: 200, tilt: 135, tip_s: 3, pour_at: 0.6 } }], 7))
		const kg = 200e-6 * bulk(grain) * 1000
		check(`${grain}: poured`, last(R.track, "cup", "poured_g"), kg, 0.01, "g", "200 mL × its bulk density")
		check(`${grain}: left in the cup`, last(R.track, "cup", "left_g"), 0, 0.01, "g")
		check(`${grain}: in the jar`, last(R.track, "cup", "heap_g"), kg, 0.5, "g")
		check(`${grain}: outside the jar`, last(R.track, "cup", "outside_g"), 0, 0.5, "g")
		const ev = (R.track.events ?? []).find((e) => /starts pouring its/.test(e.text))
		const tilt = ev ? Number(/tipped (\d+)°/.exec(ev.text)?.[1]) : Number.NaN
		const f = 200 / (0.07 * 0.095 * (Math.PI / 4) * 0.07 * 1e6)
		check(`${grain}: it starts to pour at`, tilt, REPOSE[grain]! + Math.atan((2 * 0.095 * (1 - f)) / 0.07) / DEG, 2, "°", "φ + atan(2h(1 − f)/w)")
		claim(`${grain}: the run says it is empty`, (R.track.events ?? []).some((e) => /is empty: all its/.test(e.text)))
		const lx = last(R.track, "cup", "lands_x")
		claim(`${grain}: its stream comes down in the jar's opening (lands_x ${fmt(lx)} m, the jar 1.1665…1.2335 m)`, lx > 1.1665 && lx < 1.2335)
		// a heap fed by a stream grows at its angle of repose: while the cup pours, its top stands no more than a few grains' layers over where
		// it ends (granular.ts Bed.rain: before it, the stream's grains stayed where they landed on the jar's 4 mm columns faster than the bed's
		// avalanches could carry them off, and a pillar stood up to 1.4 m tall in the 11 cm jar)
		const hm = series(R.track, "cup", "heap_mm")
		const top = hm.reduce((a, b) => Math.max(a, b), 0)
		claim(`${grain}: while it pours, its heap stands no more than 15 mm over its end (highest ${fmt(top)} mm, at the end ${fmt(last(R.track, "cup", "heap_mm"))} mm)`, top <= last(R.track, "cup", "heap_mm") + 15)
	}
	// the same for a cup of sugar poured onto the bare table (a bed of coarser columns: before, 0.19 m) and a wide funnel's stream into the jar
	// (a 20 mm spout, about 100 g of sugar a second: before, 0.55 m)
	for (const [label, items, src] of [
		["a cup of sugar onto the table", [{ id: "cup", type: "pitcher", x: 1.185, y: 0.15, props: { vessel: "cup", contents: "grains", grain: "sugar", fill_ml: 250, tilt: 115, tip_s: 3, pour_at: 0.5 } }], "cup"],
		["sugar through a 20 mm funnel into the pint jar", [{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain: "sugar", sand_kg: 0.2, height: 0.21, outlet_mm: 20 } }], "f"]
	] as const) {
		const R = run(scene(items as unknown as Item[], 7))
		const hm = series(R.track, src, "heap_mm")
		const top = hm.reduce((a, b) => Math.max(a, b), 0)
		claim(`${label}: while it pours, its heap stands no more than 15 mm over its end (highest ${fmt(top)} mm, at the end ${fmt(last(R.track, src, "heap_mm"))} mm)`, top <= last(R.track, src, "heap_mm") + 15)
	}
}

// ---------------------------------------------------------------- every gram a cup pours is read: in its container or outside it
if (want === "all" || want === "conserve") {
	console.log("\n# conserve: a cup of sugar held 0 to 15 cm over each container's rim: heap_g + outside_g = poured_g (within 1 g); a stream thrown past its landing bed is read outside")
	const kf = (R: ReturnType<typeof run>, item: string) => {
		const k = (R.track as unknown as { keyframes?: Record<string, Record<string, number[][]>> }).keyframes?.[item] ?? {}
		const key = Object.keys(k).find((q) => q.startsWith("holders:"))
		return key ? (k[key]?.[0] ?? null) : null
	}
	let worst = 0
	let n = 0
	for (const [type, y0, props] of [
		["glass-jar", 0, {}], ["plastic-cup", 0, {}], ["bowl", 0, {}], ["box", 0, { hung: false }], ["bucket", 0, {}], ["beaker", 0, { fill_ml: 0 }], ["coffee-mug", 0.0475, {}]
	] as const) {
		// (its rim and axis as the engine found them: the holders keyframe, [t, n, round, x, floor, r0, rb, ylo, rt, yhi, wall, rim, k, ring])
		const row = kf(run(scene([{ id: "c", type, x: 1.2, y: y0, props: { ...props } }, { id: "p", type: "pitcher", x: 1.185, y: 0.6, props: { vessel: "cup", contents: "grains", grain: "sugar", fill_ml: 100, tilt: 60 } }], 1)), "p")
		if (row === null) {
			claim(`${type}: the engine finds its inside`, false)
			continue
		}
		const [hx, rim] = [row[3] as number, row[11] as number]
		for (const d of [0, 0.05, 0.1, 0.15])
			for (const tilt of [125, 150]) {
				const R = run(scene([{ id: "c", type, x: 1.2, y: y0, props: { ...props } }, { id: "p", type: "pitcher", x: hx - 0.015, y: rim + d, props: { vessel: "cup", contents: "grains", grain: "sugar", fill_ml: 200, tilt, tip_s: 1.5, pour_at: 0.6 } }], 6))
				const miss = last(R.track, "p", "poured_g") - last(R.track, "p", "heap_g") - last(R.track, "p", "outside_g")
				worst = Number.isFinite(miss) ? Math.max(worst, Math.abs(miss)) : Number.POSITIVE_INFINITY
				n++
			}
	}
	check(`${n} pours over 7 containers (lip 0, 5, 10, 15 cm over the rim; tipped 125° and 150°): the worst |poured − heap − outside|`, worst, 0, 1, "g")
	// the AI's own build (V2 release, 2026-10-21): its lip 12.5 cm over the jar's rim, tipped 135°: every grain in the jar (before: 56 g missing)
	const ai = run(scene([{ id: "jar", type: "glass-jar", x: 1.4, y: 0.003 }, { id: "cup", type: "pitcher", x: 1.37, y: 0.24, props: { vessel: "cup", contents: "grains", fill_ml: 200, tilt: 135 } }], 6))
	check("the AI's sugar into a jar (lip 12.5 cm over the rim): in the jar", last(ai.track, "cup", "heap_g"), last(ai.track, "cup", "poured_g"), 1, "g")
	// a cup 1 m up tipped to 170°: much of its stream comes down past its landing bed and falls off it; all of that is read outside, and said
	const hi = run(scene([{ id: "jar", type: "glass-jar", x: 1.4, y: 0.003 }, { id: "cup", type: "pitcher", x: 1.37, y: 1.0, props: { vessel: "cup", contents: "grains", fill_ml: 200, tilt: 170 } }], 6))
	const hiMiss = last(hi.track, "cup", "poured_g") - last(hi.track, "cup", "heap_g") - last(hi.track, "cup", "outside_g")
	check(`a cup 1 m up tipped 170° (outside ${fmt(last(hi.track, "cup", "outside_g"))} g): poured − heap − outside`, hiMiss, 0, 1, "g")
	claim("... and the run says it spills outside the jar", (hi.track.events ?? []).some((e) => /^cup spills sugar outside jar$/.test(e.text)))
}

// ---------------------------------------------------------------- milk, chocolate milk, white and brown colouring
if (want === "all" || want === "liquids") {
	console.log("\n# liquids: milk and chocolate milk as the documents carry them; what a cup of each pours into a jar; what one sees of them; what floats in them")
	const L = sim.layout(sim.clean(scene([{ id: "cup", type: "pitcher", x: 1.185, y: 0.15, props: { vessel: "cup", liquid: "milk" } }, { id: "c2", type: "pitcher", x: 1.5, y: 0.15, props: { vessel: "cup", liquid: "chocolate milk" } }])))
	const liq = (id: string) => (L.doc.processes ?? []).find((p) => p.kind === "flow-pour" && p.item === id)?.liquid as { density: number; viscosity: number }
	check("milk's density", liq("cup").density, 1030.5, 0, "kg/m³", "MILK-RHO")
	check("milk's viscosity", liq("cup").viscosity * 1000, 2.1, 0, "mPa·s", "MILK-MU")
	check("chocolate milk's density", liq("c2").density, 1065, 0, "kg/m³", "provisional")
	for (const [liquid, dye, color] of [["milk", "none", "white"], ["chocolate milk", "none", "brown"], ["water", "white", "white"], ["water", "brown", "brown"], ["water", "blue", "blue"]] as const) {
		const s = scene([{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "cup", type: "pitcher", x: 1.165, y: 0.15, props: { vessel: "cup", liquid, dye, fill_ml: 200, tilt: 115, tip_s: 2, pour_at: 0.6 } }], 6, { goals: [{ kind: "mixes_to", container: "jar", color }] })
		const R = run(s)
		const ml = last(R.track, "jar", "liquid_ml")
		within(`${liquid}${dye !== "none" ? ` + ${dye}` : ""}: what the jar caught`, ml, 200, 0.02, "mL")
		// (the jar's inside 81 mm across: its level the volume over π/4·w²)
		check(`${liquid}${dye !== "none" ? ` + ${dye}` : ""}: its level`, last(R.track, "jar", "level_mm"), (ml * 1e-6) / ((Math.PI / 4) * 0.081 * 0.081) * 1000, 1, "mm")
		const goal = R.summary.goals[0]
		const o = last(R.track, "jar", "tint_o")
		claim(`${liquid}${dye !== "none" ? ` + ${dye}` : ""} in the jar is called "${goal?.color}" (want ${color}; ${Number.isFinite(o) ? `opacity ${fmt(o)}` : "clear: no tint_o"})`, goal?.ok === true)
	}
	// pouring speed: milk pours as water does (2 mPa·s is still a thin liquid); chocolate milk at 8 mPa·s no faster
	const half = (liquid: string) => {
		const R = run(scene([{ id: "b", type: "bucket", x: 1.2, y: 0 }, { id: "cup", type: "pitcher", x: 1.15, y: 0.45, props: { vessel: "cup", liquid, fill_ml: 200, tilt: 75, pour_at: 0.6 } }], 6))
		const v = series(R.track, "cup", "left_ml")
		const k = v.findIndex((x) => x <= 0.5 * (v[0] as number))
		return k >= 0 ? (R.track.frames[k]?.t ?? Number.NaN) : Number.NaN
	}
	const tw = half("water")
	const tm = half("milk")
	const tc = half("chocolate milk")
	within("a cup tipped 75°: milk pours half as soon as water does", tm, tw, 0.1, "s")
	claim(`a cup tipped 75°: chocolate milk pours half no sooner than water (${fmt(tc)} s against ${fmt(tw)} s)`, tc >= tw - 1e-9)
	// milk and chocolate milk MIX with water (2026-10-21; flow.ts WATERY): poured into a beaker of water (the liquids module's) or a jar of water
	// (the flow module's), or water into milk, they make one liquid, its density by volume, its viscosity by Arrhenius' rule (ln μ by volume),
	// its colour by volume (before: milk lay under the water as its own layer and the beaker read clear water); oil on water still layers
	{
		const fl = (await import(`${PG}/tooling/src/sim/modules/fluids.ts`)) as { liquidsIn: (s: unknown) => { regions: { region: { item: string; layers: { words: string; density: number; viscosity: number }[] }; volumes: number[] }[] } | undefined }
		const fw = (await import(`${PG}/tooling/src/sim/modules/flow.ts`)) as { flowIn: (s: unknown) => { basins: { item: string; basin: { layers: { liq: number; vol: number }[] }; liquids: { list: { words: string; density: number; viscosity: number }[] } }[] } | undefined }
		const runKept = (s: Scene) => {
			const c = sim.clean(s)
			const { doc, resolved } = sim.layout(c)
			const adm = admitDocument(doc).scene
			const raw = simulate(adm, 120)
			const track = { ...raw, ...plug.slimExtras(raw, (v, d) => Number(v.toFixed(d))) } as Track
			return { track, summary: sim.finish(c, doc, resolved, track).summary, adm, doc }
		}
		const W = { density: 998.2, viscosity: 0.001002 }
		const LIQ: Record<string, { density: number; viscosity: number }> = { milk: { density: 1030.5, viscosity: 0.0021 }, "chocolate milk": { density: 1065, viscosity: 0.008 } }
		const mixed = (a: { density: number; viscosity: number }, va: number, b: { density: number; viscosity: number }, vb: number) => ({
			density: (a.density * va + b.density * vb) / (va + vb),
			viscosity: Math.exp((Math.log(a.viscosity) * va + Math.log(b.viscosity) * vb) / (va + vb))
		})
		for (const [into, poured, color] of [["water", "milk", "white"], ["water", "chocolate milk", "brown"], ["milk", "water", "white"]] as const) {
			const R = runKept(scene([{ id: "g", type: "beaker", x: 1.2, y: 0, props: { liquid: into, fill_ml: 300 } }, { id: "p", type: "pitcher", x: 1.165, y: 0.2, props: { vessel: "cup", fill_ml: 150, liquid: poured, pour_to: "right", tilt: 110, pour_at: 0.5, tip_s: 2.5 } }], 6, { goals: [{ kind: "mixes_to", container: "g", color }] }))
			const st = fl.liquidsIn(R.adm)?.regions.find((r) => r.region.item === "g")
			const layers = st?.region.layers ?? []
			// (what it held, as built (its layer's height × its area: the 300 mL rounded to a micrometre of height), and what it caught: its liquid's
			// volume now less that, exactly; the received_ml reading is rounded)
			const rec = (R.doc.processes ?? []).find((q) => q.kind === "liquid" && q.item === "g") as { area: number; layers: { height: number }[] } | undefined
			const held = rec ? (rec.layers[0]?.height ?? 0) * rec.area * 1e6 : 300
			const got = (st?.volumes ?? []).reduce((a, b) => a + b, 0) * 1e6 - held
			const want = mixed(into === "water" ? W : LIQ[into]!, held, poured === "water" ? W : LIQ[poured]!, got)
			claim(`${poured} into a beaker of ${into}: one liquid (${layers.length} layer${layers.length === 1 ? "" : "s"}: ${layers.map((l) => l.words).join(", ")}; no layer2_mm: ${Number.isNaN(last(R.track, "g", "layer2_mm"))})`, layers.length === 1 && Number.isNaN(last(R.track, "g", "layer2_mm")))
			within(`${poured} into ${into}: its density by volume (${fmt(got)} mL into 300; off by ${((layers[0]?.density ?? Number.NaN) / want.density - 1).toExponential(1)})`, layers[0]?.density ?? Number.NaN, want.density, 1e-12, "kg/m³", "ρ by volume")
			within(`${poured} into ${into}: its viscosity, ln μ by volume (off by ${((layers[0]?.viscosity ?? Number.NaN) / want.viscosity - 1).toExponential(1)})`, (layers[0]?.viscosity ?? Number.NaN) * 1000, want.viscosity * 1000, 1e-12, "mPa·s", "ARRHENIUS87")
			claim(`${poured} into ${into}: the beaker is called "${R.summary.goals[0]?.color}" (want ${color}; opacity ${fmt(last(R.track, "g", "tint_o"))})`, R.summary.goals[0]?.ok === true && last(R.track, "g", "tint_o") >= 0.5)
		}
		// the flow module's own container: water from a tap into a glass jar, then a cup of milk: one liquid, white
		const J = runKept(scene([{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "tap", type: "tap", x: 1.2, y: 0.3, props: { flow_ml_s: 100, on_at: 0.2, off_at: 2.2 } }, { id: "cup", type: "pitcher", x: 1.165, y: 0.18, props: { vessel: "cup", liquid: "milk", fill_ml: 100, tilt: 115, tip_s: 1.5, pour_at: 2.6 } }], 7, { goals: [{ kind: "mixes_to", container: "jar", color: "white" }] }))
		const jb = fw.flowIn(J.adm)?.basins.find((b) => b.item === "jar")
		const jl = jb?.basin.layers ?? []
		claim(`water then milk into a glass jar: one liquid (${jl.length} layer${jl.length === 1 ? "" : "s"}, ${fmt(last(J.track, "jar", "liquid_ml"))} mL), called "${J.summary.goals[0]?.color}" (want white)`, jl.length === 1 && J.summary.goals[0]?.ok === true)
		const jd = jb && jl[0] ? (jb.liquids.list[jl[0].liq]?.density ?? Number.NaN) : Number.NaN
		claim(`... its density between water's and milk's (${fmt(jd)} kg/m³)`, jd > 998.2 && jd < 1030.5)
		// oil does not mix: 100 mL of vegetable oil poured onto a beaker of water stays a layer on top
		const O = runKept(scene([{ id: "g", type: "beaker", x: 1.2, y: 0, props: { liquid: "water", fill_ml: 300 } }, { id: "p", type: "pitcher", x: 1.165, y: 0.2, props: { vessel: "cup", fill_ml: 100, liquid: "vegetable oil", pour_to: "right", tilt: 120, pour_at: 0.5, tip_s: 2 } }], 8))
		const ol = fl.liquidsIn(O.adm)?.regions.find((r) => r.region.item === "g")?.region.layers ?? []
		claim(`oil onto a beaker of water: two layers, oil on top (${ol.map((l) => l.words).join(" under ")})`, ol.length === 2 && ol[1]?.words === "vegetable oil")
	}
	// floating: a grape (1060 kg/m³) sinks in milk (1030.5) and floats in chocolate milk (1065); an egg (1080) sinks in both
	for (const [liquid, thing, floats] of [["milk", "grape", false], ["chocolate milk", "grape", true], ["chocolate milk", "egg", false]] as const) {
		const R = run(scene([{ id: "tank", type: "water-tank", x: 1.2, y: 0, props: { liquid } }, { id: "it", type: thing, x: 1.2, y: 0.12 }], 4, { goals: [{ kind: floats ? "floats" : "sinks", item: "it" }] }))
		claim(`${/^[aeiou]/.test(thing) ? "an" : "a"} ${thing} ${floats ? "floats" : "sinks"} in ${liquid} (${floats ? "afloat" : "sunk"}: ${last(R.track, "it", floats ? "afloat" : "sunk")})`, R.summary.goals[0]?.ok === true)
	}
}

// ---------------------------------------------------------------- what one sees of a liquid that scatters light (flow.ts seenOf)
if (want === "all" || want === "color") {
	console.log("\n# color: a clear liquid looks as before (exactly e^(−a·5 cm)); a scattering one as a deep layer's Kubelka-Munk reflectance [KUBELKA31]")
	let same = 0
	for (let k = 0; k < 200; k++) {
		const a = [Math.abs(Math.sin(k * 1.7)) * 0.6, Math.abs(Math.sin(k * 2.3)) * 0.6, Math.abs(Math.sin(k * 3.1)) * 0.6] as [number, number, number]
		const t = optics.tintOf(a, 5)
		const s = optics.seenOf(a, 5)
		if (t[0] === s[0] && t[1] === s[1] && t[2] === s[2] && s[3] === 0) same++
	}
	check("200 clear dyes: seenOf equals tintOf bit for bit", same, 200, 0)
	let worst = 0
	for (const [k, s] of [[0.002, 25], [0.05, 25], [1, 25], [13.2, 25], [113, 25], [0.01, 5]] as const) {
		const R = optics.seenOf([k, k, k, s], 50)[0]
		// (deep: the light straight through is gone; the reflectance's own relation (1 − R)²/(2R) = K/S gives K back)
		const back = (1 - R) * (1 - R) / (2 * R)
		worst = Math.max(worst, Math.abs(back - (2 * k) / s) / ((2 * k) / s))
	}
	check("deep scattering layers: (1 − R∞)²/(2R∞) = K/S", worst, 0, 1e-9)
	const milk = optics.seenOf([0.002, 0.003, 0.006, 25], 5)
	claim(`milk seen through 5 cm: white (${milk.slice(0, 3).map(fmt).join(", ")}), opacity ${fmt(milk[3])}`, Math.min(milk[0], milk[1], milk[2]) >= 0.9 && milk[3] > 0.999)
	const choc = optics.seenOf([13.2, 45, 113, 25], 5)
	check("chocolate milk's red", choc[0], 0.26, 0.01)
	check("chocolate milk's green", choc[1], 0.11, 0.01)
	check("chocolate milk's blue", choc[2], 0.05, 0.01)
}

// ---------------------------------------------------------------- the same scene gives the same run
if (want === "all" || want === "determinism") {
	console.log("\n# determinism: a cup of rice into a jar and 400 g of sugar into a glass, twice each: the same tracks byte for byte")
	for (const items of [
		[{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "cup", type: "pitcher", x: 1.185, y: 0.15, props: { vessel: "cup", contents: "grains", grain: "rice", fill_ml: 200, tilt: 135, tip_s: 3, pour_at: 0.6 } }],
		[{ id: "glass", type: "glass-jar", x: 1.2, y: 0, props: { width: 0.065, depth: 0.065, wall: 0.16 } }, { id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain: "sugar", sand_kg: 0.25, height: 0.3, outlet_mm: 15 } }]
	] as Item[][]) {
		const a = JSON.stringify(run(scene(items, 5)).track)
		const b = JSON.stringify(run(scene(items, 5)).track)
		claim(`${items.map((i) => i.type).join(" + ")}: the same track (${a.length} bytes)`, a === b)
	}
}

// ---------------------------------------------------------------- random containers, grains and pourers: finite, conserved
if (want === "all" || want === "fuzz") {
	console.log("\n# fuzz: random containers (sizes, places), grains and pourers (funnels, cups, heaps): finite readings, nothing made or lost")
	let seed = 11
	const rnd = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648
		return seed / 2147483648
	}
	const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)] as T
	const N = Number(process.env.FUZZ_N ?? 16)
	let ok = 0
	for (let k = 0; k < N; k++) {
		const cx = 0.8 + rnd() * 1.0
		const type = pick(["glass-jar", "plastic-cup", "cup", "box", "bowl", "beaker", "bucket", "coffee-mug"] as const)
		const grain = pick(["sugar", "salt", "rice", "sand", "fine sand", "coarse sand"] as const)
		const props: Record<string, unknown> = type === "glass-jar" ? { width: 0.05 + rnd() * 0.2, depth: 0.05 + rnd() * 0.2, wall: 0.05 + rnd() * 0.15 } : type === "box" ? { hung: false } : {}
		const off = (rnd() - 0.5) * 0.08
		const pourer = pick(["funnel", "cup", "pile"] as const)
		const items: Item[] = [{ id: "c", type, x: cx, y: type === "coffee-mug" ? 0.0475 : 0, props }]
		if (pourer === "funnel") items.push({ id: "p", type: "sand-funnel", x: cx + off, y: 0, props: { grain, sand_kg: 0.05 + rnd() * 0.25, outlet_mm: grain === "rice" ? 25 : 12, height: 0.35 } })
		else if (pourer === "cup") items.push({ id: "p", type: "pitcher", x: cx + off - 0.02, y: 0.3, props: { vessel: pick(["cup", "measuring cup", "pitcher"]), contents: "grains", grain, fill_ml: 50 + rnd() * 250, tilt: 100 + rnd() * 60, tip_s: 1 + rnd() * 2 } })
		else items.push({ id: "p", type: "sand-pile", x: cx + off * 0.3, y: type === "coffee-mug" ? 0.0079 : 0, props: { grain, sand_kg: 0.02 + rnd() * 0.3 } })
		try {
			const R = run(scene(items, 5))
			if (/null|NaN|Infinity/.test(JSON.stringify(R.track.state ?? {}))) throw new Error("a reading is not finite")
			if (pourer !== "pile") {
				const total = last(R.track, "p", "left_g") + last(R.track, "p", "poured_g")
				const first = (R.track.state?.p?.left_g?.[0] ?? 0) + (R.track.state?.p?.poured_g?.[0] ?? 0)
				if (Math.abs(total - first) > 1e-6 * Math.max(1, first)) throw new Error(`grains made or lost: ${first} → ${total} g`)
			}
			ok++
		} catch (e) {
			console.log(`      scene ${k}: ${String((e as Error).message).slice(0, 200)}  ${JSON.stringify(items).slice(0, 300)}`)
		}
	}
	claim(`${ok} of ${N} random scenes ran with finite readings and their grains kept`, ok === N)
}

// ---------------------------------------------------------------- the budget
if (want === "all" || want === "perf") {
	console.log("\n# perf: CPU time of the lesson's scenes (node, this machine)")
	for (const [label, s] of [
		["a cup of sugar into the jar (7 s)", scene([{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "cup", type: "pitcher", x: 1.185, y: 0.15, props: { vessel: "cup", contents: "grains", grain: "sugar", fill_ml: 200, tilt: 135, tip_s: 3, pour_at: 0.6 } }], 7)],
		["400 g of sand into the 6.5 cm glass (8 s)", scene([{ id: "glass", type: "glass-jar", x: 1.2, y: 0, props: { width: 0.065, depth: 0.065, wall: 0.16 } }, { id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain: "sand", sand_kg: 0.4, height: 0.3, outlet_mm: 15 } }], 8)],
		["a cup of milk into the jar (6 s)", scene([{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "cup", type: "pitcher", x: 1.165, y: 0.15, props: { vessel: "cup", liquid: "milk", fill_ml: 200, tilt: 115, tip_s: 2, pour_at: 0.6 } }], 6)]
	] as const) {
		const R = run(s)
		// (GitHub's shared 4-core runners take up to about 2.7x the development Mac's CPU for the same run, so CI keeps a regression gate at
		// 2.5x the budget, as rw-validate-granular.ts' and rw-validate-optics.ts' perf checks do; a run by hand keeps 2000 ms)
		const budget = process.env.CI ? 5000 : 2000
		claim(`${label}: ${fmt(R.ms)} ms of CPU (under ${budget} ms)`, R.ms < budget)
	}
}

console.log(`\n${checks} checks, ${failures} failed (engine CPU ${fmt(cpuMs / 1000)} s)`)
process.exit(failures ? 1 : 0)
