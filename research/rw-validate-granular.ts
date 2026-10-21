// The granular module against theory and measurements (tooling/src/sim/granular.ts, tooling/src/sim/modules/granular.ts, machines/mod_granular.py
// and its port web/sim/modules/granular.js). Every scene is built by web/sim (the exact port of the Python builder) and run by the server's engine
// (node, with the browser bundle's math), at 480 Hz, 120 frames a second. Exits 1 on any failure (a gate).
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-granular.ts [repose|beverloo|jam|hourglass|timerjam|collapse|cohesion|support|crater|bodies|erosion|determinism|fuzz|perf|all]
// Reference values (cited where they are used):
//   [ETB-REPOSE] Engineering ToolBox, Angle of Repose: sand dry 34°; [AH18] Al-Hashemi & Al-Amoudi, Powder Technol. 330, 397 (2018): dry sands 30-35°,
//   gravels 35-40°; wheat flour 45° [ETB-REPOSE]. [BEVERLOO61] Beverloo, Leniger & van de Velde, Chem. Eng. Sci. 15, 260 (1961): W = C·ρ_b·√g·(D − k·d)^2.5,
//   C 0.58, k 1.4 [NEDDERMAN92], independent of the head. [ZURIGUEL05] Zuriguel et al., Phys. Rev. E 71, 051303 (2005): jamming below ≈ 5 grains.
//   [JENIKE64] cohesive arching. [LUBE04] Lube et al., J. Fluid Mech. 508, 175 (2004): an axisymmetric column collapses in ≈ 3√(H/g).
//   [CULMANN1866]/Terzaghi (1943): a cohesive face stands vertical to H_c = (4c/γ)·tan(45° + φ/2). [UEHARA03] Uehara, Ambroso, Ojha & Durian, Phys.
//   Rev. Lett. 90, 194301 (2003): d = (0.14/μ)(ρ_b/ρ_g)^½ D_b^⅔ H^⅓, D_c = 0.90 (ρ_b/(ρ_g μ²))^¼ D_b^¾ H^¼ (H the total drop, h + d). [VESIC73] bearing
//   capacity. [WP06] Wong & Parker's bed load; [SOULSBY97] Shields' threshold; [FISCHENICH01] grass on banks.
import { pathToFileURL } from "node:url"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const sim = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as {
	clean: (s: unknown) => Scene
	layout: (s: unknown) => { doc: Doc; resolved: Record<string, Record<string, unknown>> }
	finish: (s: unknown, d: Doc, r: unknown, t: Track) => { summary: { goals: { ok: boolean; label: string }[]; readings?: Record<string, Record<string, number>>; happenings?: { t: number; text: string }[] } }
	catalog: () => { types: { key: string; module?: string; props: { key: string; kind: string; min?: number; max?: number; step?: number; choices?: string[] }[] }[] }
}
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: unknown } }
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: unknown, fps: number) => Track }
await import(`${PG}/tooling/src/sim/modules/index.ts`)
const core = (await import(`${PG}/tooling/src/sim/granular.ts`)) as typeof import("../tooling/src/sim/granular.ts")
const plug = (await import(`${PG}/tooling/src/sim/plugins.ts`)) as { slimExtras: (t: Track, r: (v: number, d: number) => number) => Partial<Track> }

type Scene = { items: Item[]; [k: string]: unknown }
type Item = { id: string; type: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; held?: boolean; fixed?: boolean; name?: string }
type Doc = { solids: { id: string; item: string; kind: string; body: { kind: string; radius?: number }; at: { x: number; y: number } }[]; processes?: { kind: string; item?: string; [k: string]: unknown }[] }
type Track = { frames: { t: number; placements: Record<string, { x: number; y: number; angle: number }> }[]; state?: Record<string, Record<string, number[]>>; events?: { t: number; text: string }[]; keyframes?: unknown }

const G = 9.81
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
const bulk = (g: string, w: "dry" | "damp" | "soaked" = "dry") => core.bulkDensity(core.GRAINS[g]!, w)
const beverloo = (g: string, D: number) => core.beverlooRate(core.GRAINS[g]!, "dry", D, G) * bulk(g)

// ---------------------------------------------------------------- the angle of repose of heaps poured from a funnel
if (want === "all" || want === "repose") {
	console.log("\n# repose: heaps poured from a funnel stand at the grains' angle of repose [ETB-REPOSE] [AH18]")
	for (const [grain, deg, spout, kg] of [["sand", 34, 12, 0.4], ["fine sand", 32, 10, 0.3], ["coarse sand", 35, 12, 0.4], ["gravel", 38, 45, 0.6], ["flour", 45, 35, 0.15]] as const) {
		const R = run(scene([{ id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain, sand_kg: kg, outlet_mm: spout, height: 0.3 } }], kg / (beverloo(grain, spout / 1000) || 1) + 3))
		// (the heap's slope from the landing bed's own readings: the funnel's landing region is read as the heap under it)
		const doc = R.doc
		void doc
		// the heap is measured from the run's keyframes: its height and footprint over the table
		const heap = heapOf(R.track, "f")
		check(`${grain} heap slope (atan of height over its footprint's radius)`, heap.slope, deg, 3, "°", "ETB-REPOSE/AH18")
		within(`${grain} all poured`, last(R.track, "f", "poured_g"), kg * 1000, 0.01, "g")
		// (the funnel's own readings of its heap, what piles/steeper on a funnel judge: the same heap)
		check(`${grain}: the funnel's heap_deg reading`, last(R.track, "f", "heap_deg"), deg, 3, "°", "ETB-REPOSE/AH18")
		within(`${grain}: the funnel's heap_g reading is what it poured`, last(R.track, "f", "heap_g"), last(R.track, "f", "poured_g"), 0.01, "g")
	}
	// (three funnels side by side, as a lesson pours them: flour heaps steeper than gravel, gravel than sand)
	const R = run(scene([
		{ id: "s", type: "sand-funnel", x: 0.6, y: 0, props: { grain: "sand", sand_kg: 0.25, outlet_mm: 15 } },
		{ id: "g", type: "sand-funnel", x: 1.3, y: 0, props: { grain: "gravel", sand_kg: 0.25, outlet_mm: 40 } },
		{ id: "f", type: "sand-funnel", x: 2.0, y: 0, props: { grain: "flour", sand_kg: 0.2, outlet_mm: 25 } }
	], 6))
	const a = { s: last(R.track, "s", "heap_deg"), g: last(R.track, "g", "heap_deg"), f: last(R.track, "f", "heap_deg") }
	claim(`three poured heaps: flour ${fmt(a.f)}° > gravel ${fmt(a.g)}° > sand ${fmt(a.s)}° (45°, 38°, 34° [ETB-REPOSE])`, a.f > a.g + 1 && a.g > a.s + 1)
}

/** A heap's height and slope from a run's keyframes (the landing bed under item `item`): its thickest column, and its footprint as a disc. */
function heapOf(track: Track, item: string) {
	const K = (track.keyframes as Record<string, Record<string, number[][]>> | undefined)?.[item] ?? {}
	const gridKey = Object.keys(K).find((k) => k.startsWith("grid:bed"))
	if (!gridKey) return { top: 0, slope: 0 }
	const id = gridKey.slice(5)
	const grid = K[gridKey]![0]!
	const dx = grid[3] as number
	const nx = grid[4] as number
	const nz = grid[5] as number
	const h = new Float64Array(nx * nz)
	for (const row of K[`h:${id}`] ?? []) {
		const i0 = row[1] as number
		const j0 = row[2] as number
		const ni = row[3] as number
		const nj = row[4] as number
		const mode = row[5] as number
		let q = 6
		if (mode === 2) {
			const count = row[q++] as number
			for (let k = 0; k < count; k++) {
				const off = row[q++] as number
				const v = row[q++] as number
				h[(j0 + Math.floor(off / ni)) * nx + i0 + (off % ni)] = v / 1e4
			}
			continue
		}
		let left = 0
		let val = 0
		for (let j = j0; j < j0 + nj; j++)
			for (let i = i0; i < i0 + ni; i++) {
				if (mode === 1) {
					if (left === 0) {
						val = row[q++] as number
						left = row[q++] as number
					}
					left--
					h[j * nx + i] = val / 1e4
				} else h[j * nx + i] = (row[q++] as number) / 1e4
			}
	}
	let top = 0
	let cells = 0
	for (const v of h) {
		if (v > top) top = v
		if (v > 0.001) cells++
	}
	const r = Math.sqrt((cells * dx * dx) / Math.PI)
	return { top, slope: r > 0 ? (Math.atan2(top - 0.001, r) * 180) / Math.PI : 0 }
}

// ---------------------------------------------------------------- Beverloo's rate, steady whatever the head
if (want === "all" || want === "beverloo") {
	console.log("\n# beverloo: a funnel pours at W = 0.58·ρ_b·√g·(D − 1.4d)^2.5, the same full or nearly empty [BEVERLOO61] [NEDDERMAN92]")
	for (const [grain, spout] of [["sand", 8], ["sand", 10], ["sand", 15], ["sand", 20], ["fine sand", 6], ["coarse sand", 12]] as const) {
		const W = beverloo(grain, spout / 1000) * 1000
		const kg = Math.min(1.5, (W * 6) / 1000)
		const R = run(scene([{ id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain, sand_kg: kg, outlet_mm: spout, height: 0.3, funnel_cm: 16 } }], 8))
		const flow = series(R.track, "f", "flow_gs")
		const poured = series(R.track, "f", "poured_g")
		// (the rate between a fifth and four fifths poured: a time difference of the poured mass)
		const frames = R.track.frames
		const ia = poured.findIndex((v) => v >= 0.2 * kg * 1000)
		const ib = poured.findIndex((v) => v >= 0.8 * kg * 1000)
		const rate = ia >= 0 && ib > ia ? (((poured[ib] as number) - (poured[ia] as number)) / ((frames[ib]?.t ?? 0) - (frames[ia]?.t ?? 0))) : Number.NaN
		within(`${grain} through ${spout} mm`, rate, W, 0.05, "g/s", "BEVERLOO61")
		const early = flow[Math.floor((ia + (ib - ia) * 0.25) | 0)] as number
		const late = flow[Math.floor((ia + (ib - ia) * 0.85) | 0)] as number
		within(`${grain} ${spout} mm: the rate near the end as at the start (no head dependence)`, late, early, 0.04, "g/s")
	}
}

if (want === "all" || want === "jam") {
	console.log("\n# jam: grains jam in a spout narrower than about 5 grains [ZURIGUEL05]; flour arches over a small spout [JENIKE64]")
	for (const [grain, spout, clogs] of [["gravel", 12, true], ["gravel", 25, true], ["gravel", 40, false], ["flour", 12, true], ["flour", 30, false], ["sand", 3, false]] as const) {
		const R = run(scene([{ id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { grain, sand_kg: 0.05, outlet_mm: spout, height: 0.25 } }], 3))
		claim(`${grain} through ${spout} mm ${clogs ? "clogs" : "pours"} (clogged ${last(R.track, "f", "clogged")}, poured ${fmt(last(R.track, "f", "poured_g"))} g)`, clogs ? series(R.track, "f", "clogged").some((v) => v === 1) && last(R.track, "f", "poured_g") < 1 : last(R.track, "f", "poured_g") > 0)
	}
}

// ---------------------------------------------------------------- the hourglass keeps time
if (want === "all" || want === "hourglass") {
	console.log("\n# hourglass: it runs out at its sand's mass ÷ Beverloo's rate through the neck [BEVERLOO61]; the time-lapse clock agrees")
	for (const [g, neck, lapse] of [[0.066, 3, 4], [0.04, 3, 4], [0.066, 4, 4], [0.03, 2.5, 4], [0.012, 3, 1]] as const) {
		const W = beverloo("fine sand", neck / 1000)
		const T = g / W
		const R = run(scene([{ id: "hg", type: "hourglass", x: 1.2, y: 0, props: { sand_kg: g, neck_mm: neck } }], Math.min(20, T / lapse + 2), lapse > 1 ? { settings: { time_lapse: lapse } } : {}))
		claim(`${g * 1000} g through ${neck} mm (time-lapse ${lapse}) runs out`, last(R.track, "hg", "empty") === 1)
		// (within 4 %: the last grains slide down the bulb's walls after the column over the neck is gone, a tail real timers have too)
		within(`${g * 1000} g through ${neck} mm: run time`, last(R.track, "hg", "run_s"), T, 0.04, "s", "BEVERLOO61")
	}
}

// ---------------------------------------------------------------- a sand timer whose neck is too narrow for its grains
if (want === "all" || want === "timerjam") {
	console.log("\n# timerjam: an hourglass neck under about 5 grains jams [ZURIGUEL05]: it reads clogged, its clock stops, and the run says so")
	for (const [grain, neck, jams] of [["coarse sand", 3, true], ["coarse sand", 6, false], ["fine sand", 0.8, true], ["fine sand", 1.2, false], ["gravel", 12, true], ["flour", 5, true], ["sand", 2.5, false]] as const) {
		const R = run(scene([{ id: "hg", type: "hourglass", x: 1.2, y: 0, props: { grain, neck_mm: neck, sand_kg: 0.03 } }], 4, { settings: { time_lapse: 4 } }))
		const said = (R.summary.happenings ?? []).some((h) => /^hg jams: its grains arch over the/.test(h.text))
		const clog = last(R.track, "hg", "clogged") === 1
		const ran = last(R.track, "hg", "run_s")
		claim(`${grain} through a ${neck} mm neck ${jams ? "jams" : "runs"} (clogged ${clog ? 1 : 0}, said ${said}, run_s ${fmt(ran)} s, top ${fmt(last(R.track, "hg", "top_g"))} g)`, jams ? clog && said && ran === 0 && last(R.track, "hg", "top_g") > 29 : !clog && !said && ran > 0)
	}
}

// ---------------------------------------------------------------- a column's collapse
if (want === "all" || want === "collapse") {
	console.log("\n# collapse: a dry sand tower slumps to its angle of repose in about 3√(H/g) [LUBE04]")
	for (const H of [0.08, 0.14, 0.22]) {
		const R = run(scene([{ id: "c", type: "sand-pile", x: 1.2, y: 0, props: { shape: "castle", width: 0.08, height: H } }], 2))
		const hs = series(R.track, "c", "height_mm")
		const end = hs[hs.length - 1] as number
		// (the time from the release until the height has done 90 % of its drop)
		const k = hs.findIndex((v) => v <= end + 0.1 * (H * 1000 - end))
		const t = (R.track.frames[k]?.t ?? 99) - 0.5
		const ref = 3 * Math.sqrt(H / G)
		claim(`H ${H} m: slumps in ${fmt(t)} s, between 0.5 and 2.5 × 3√(H/g) = ${fmt(ref)} s [LUBE04]`, t >= 0.5 * ref && t <= 2.5 * ref)
		check(`H ${H} m: its slope after`, last(R.track, "c", "angle_deg"), 33, 3.5, "°", "ETB-REPOSE")
		within(`H ${H} m: its mass kept`, last(R.track, "c", "mass_g"), (Math.PI * 0.04 * 0.04 * H) * bulk("sand") * 1000, 0.06, "g")
	}
}

// ---------------------------------------------------------------- cohesion: damp sand stands, to Culmann's height
if (want === "all" || want === "cohesion") {
	console.log("\n# cohesion: damp sand stands in walls up to (4c/γ)·tan(45° + φ/2) [CULMANN1866]; soaked sand slumps flatter than dry [ETB-REPOSE]")
	const s = core.GRAINS.sand!
	// a free tower crushes at its unconfined strength over its weight: H = 2c·tan(45° + φ/2)/γ (half Culmann's supported vertical cut)
	const Hc = ((2 * s.cohesionDamp) / (bulk("sand", "damp") * G)) * Math.tan(Math.PI / 4 + (s.repose * Math.PI) / 360)
	console.log(`      (damp sand: c ${s.cohesionDamp} Pa, a free tower crushes above ${fmt(Hc)} m)`)
	for (const [H, stands] of [[0.12, true], [0.2, true], [0.32, false]] as const) {
		const R = run(scene([{ id: "c", type: "sand-pile", x: 1.2, y: 0, props: { shape: "castle", wetness: "damp", width: 0.1, height: H } }], 2.5))
		const share = last(R.track, "c", "height_mm") / (H * 1000)
		claim(`a damp tower ${H} m tall ${stands ? "stands" : "crushes"} (keeps ${fmt(share * 100)} % of its height; crushes above ${fmt(Hc)} m)`, stands ? share > 0.98 : share < 0.8)
	}
	const coarse = run(scene([{ id: "c", type: "sand-pile", x: 1.2, y: 0, props: { shape: "castle", wetness: "damp", grain: "coarse sand", width: 0.1, height: 0.15 } }], 2.5))
	claim(`a damp coarse-sand tower 15 cm tall crushes (weaker bridges between bigger grains [RUMPF58]: keeps ${fmt((last(coarse.track, "c", "height_mm") / 150) * 100)} %)`, last(coarse.track, "c", "height_mm") < 0.8 * 150)
	const dry = run(scene([{ id: "c", type: "sand-pile", x: 1.2, y: 0, props: { shape: "castle", height: 0.12 } }], 2))
	const soaked = run(scene([{ id: "c", type: "sand-pile", x: 1.2, y: 0, props: { shape: "castle", wetness: "soaked", height: 0.12 } }], 2))
	check("a soaked tower's slope after", last(soaked.track, "c", "angle_deg"), 24, 4, "°", "ETB-REPOSE: water filled 15-30°")
	claim("soaked slumps flatter than dry", last(soaked.track, "c", "angle_deg") < last(dry.track, "c", "angle_deg") - 4)
}

// ---------------------------------------------------------------- craters
if (want === "all" || want === "crater") {
	console.log("\n# crater: a ball dropped into sand goes in and makes a crater as Uehara et al. measured [UEHARA03]")
	const rhoG = bulk("sand")
	const mu = Math.tan((34 * Math.PI) / 180)
	const diam: number[] = []
	const heights = [0.1, 0.3, 1.0]
	for (const [type, D, rho, H] of [["steel-ball", 0.0254, 7850, 0.1], ["steel-ball", 0.0254, 7850, 0.3], ["steel-ball", 0.0254, 7850, 1.0], ["steel-ball", 0.05, 7850, 0.4], ["glass-marble", 0.016, 2500, 0.5]] as const) {
		const trayTop = 0.012 + 0.08
		const R = run(scene([{ id: "tray", type: "sand-tray", x: 1.2, y: 0, props: { length: 0.4, width: 0.3, sand_depth: 0.08, wall: 0.1 } }, { id: "ball", type, x: 1.2, y: trayTop + H + D / 2, held: true, props: { diameter: D } }], 2))
		const sid = R.doc.solids.find((s) => s.item === "ball")!.id
		const f = R.track.frames[R.track.frames.length - 1]!
		const bottom = f.placements[sid]!.y - D / 2
		const pen = trayTop - bottom
		const mass = (Object.values((R.resolved as Record<string, { mass?: number }>).ball ?? {}) && (R.resolved.ball as { mass?: number }).mass) || rho * (Math.PI / 6) * D ** 3
		const rhoB = (mass as number) / ((Math.PI / 6) * D ** 3)
		const Ht = H + pen
		const d = (0.14 / mu) * Math.sqrt(rhoB / rhoG) * D ** (2 / 3) * Ht ** (1 / 3)
		const Dc = 0.9 * ((rhoB / rhoG) / (mu * mu)) ** 0.25 * D ** 0.75 * Ht ** 0.25
		within(`${type} ${D * 100} cm (${fmt(rhoB)} kg/m³) from ${H} m: penetration`, pen, d, 0.35, "m", "UEHARA03")
		within(`${type} ${D * 100} cm from ${H} m: crater`, last(R.track, "tray", "crater_mm") / 1000, Dc, 0.3, "m", "UEHARA03")
		if (type === "steel-ball" && D === 0.0254) diam.push(last(R.track, "tray", "crater_mm"))
	}
	// D_c ∝ H^(1/4): the exponent from the three heights
	const ex = Math.log((diam[2] as number) / (diam[0] as number)) / Math.log(heights[2]! / heights[0]!)
	check("crater width's power of the drop height", ex, 0.25, 0.12, "", "UEHARA03: 1/4")
	// light balls (a ping-pong ball, ρ_b/ρ_g ≈ 0.05) and the others of a lesson, in sand and in flour: Uehara's law, never a step of the grid
	const drop = (type: string, grain: string, depth: number, H: number) => {
		const top = 0.012 + depth
		const T = sim.catalog().types.find((t) => t.key === type)!
		const D = (T.props.find((p) => p.key === "diameter") as unknown as { default: number }).default
		const R = run(scene([{ id: "tray", type: "sand-tray", x: 1.2, y: 0, props: { length: 0.4, width: 0.3, sand_depth: depth, wall: Math.max(0.08, depth + 0.02), grain } }, { id: "ball", type, x: 1.2, y: top + H + D / 2, held: true, props: {} }], 2))
		const m = (R.resolved.ball as { mass?: number }).mass ?? (T.props.find((p) => p.key === "mass") as unknown as { default: number }).default
		const rhoB = m / ((Math.PI / 6) * D ** 3)
		const g = grain === "flour" ? bulk("flour") : bulk("sand")
		const u = grain === "flour" ? 1 : mu
		const Dc = 0.9 * ((rhoB / g) / (u * u)) ** 0.25 * D ** 0.75 * H ** 0.25
		return { got: last(R.track, "tray", "crater_mm") / 1000, Dc }
	}
	for (const [type, grain, H] of [["ping-pong-ball", "sand", 0.3], ["ping-pong-ball", "sand", 0.6], ["ping-pong-ball", "sand", 1.0], ["ping-pong-ball", "flour", 0.6], ["golf-ball", "sand", 0.6], ["wooden-ball", "sand", 0.6], ["tennis-ball", "sand", 0.5], ["steel-ball", "flour", 0.6]] as const) {
		const r = drop(type, grain, 0.05, H)
		// (within 30 %, as the steel balls above: a light ball barely goes in, and its dent's rim, about its own width, is a little wider than the law's at low drops)
		within(`${type} into ${grain} from ${H} m: crater`, r.got, r.Dc, 0.3, "m", "UEHARA03")
	}
	const pp = [0.2, 0.6, 1.0].map((H) => drop("ping-pong-ball", "sand", 0.05, H).got)
	const st = [0.2, 0.6, 1.0].map((H) => drop("steel-ball", "sand", 0.05, H).got)
	claim(`a higher drop, a wider crater (ping-pong ${pp.map((v) => fmt(v * 1000)).join(" < ")} mm; steel ${st.map((v) => fmt(v * 1000)).join(" < ")} mm)`, pp[0]! < pp[1]! && pp[1]! < pp[2]! && st[0]! < st[1]! && st[1]! < st[2]!)
	claim(`a heavy ball, a wider crater: steel over ping-pong at every height (${st.map((v, i) => `${fmt(v * 1000)} vs ${fmt(pp[i]! * 1000)}`).join(", ")} mm)`, st.every((v, i) => v > pp[i]! * 1.3))
	// (sand thinner than the ball goes: it hits the floor, the crater is smaller, and still wider for the heavier ball)
	const thinS = drop("steel-ball", "flour", 0.01, 0.6).got
	const thinP = drop("ping-pong-ball", "flour", 0.01, 0.6).got
	const deepS = drop("steel-ball", "flour", 0.05, 0.6).got
	claim(`1 cm of flour: steel ${fmt(thinS * 1000)} mm > ping-pong ${fmt(thinP * 1000)} mm, and under the 5 cm crater ${fmt(deepS * 1000)} mm`, thinS > thinP + 0.002 && thinS < deepS)
}

// ---------------------------------------------------------------- bodies resting on and rolling into sand
// ---------------------------------------------------------------- heaps on what they stand on: never grains from nothing
if (want === "all" || want === "support") {
	console.log("\n# support: a heap laid on a shelf, a plank or a tipped board holds exactly its grains; one wider than its support runs off its edge (spilled_g) and the run says so")
	const cases: [string, Item[], number][] = [
		["300 g on a 12 cm plank shelf 0.4 m up", [{ id: "p", type: "plank", x: 1.2, y: 0.4, props: { length: 0.6, legs: false } }, { id: "h", type: "sand-pile", x: 1.2, y: 0.422, props: { sand_kg: 0.3 } }], 0.3],
		["2 kg on a flat plank 0.4 m up", [{ id: "p", type: "plank", x: 1.2, y: 0.4, props: { length: 0.8, legs: false } }, { id: "h", type: "sand-pile", x: 1.2, y: 0.422, props: { sand_kg: 2 } }], 2],
		["2 kg on a plank on the table", [{ id: "p", type: "plank", x: 1.2, y: 0.011, props: { length: 0.8, legs: false } }, { id: "h", type: "sand-pile", x: 1.2, y: 0.022, props: { sand_kg: 2 } }], 2],
		["500 g on a board tipped 20°", [{ id: "p", type: "plank", x: 1.2, y: 0.15, angle: 20, props: { length: 0.8, legs: false } }, { id: "h", type: "sand-pile", x: 1.2, y: 0.161, props: { sand_kg: 0.5 } }], 0.5],
		["500 g on a board tipped 5°", [{ id: "p", type: "plank", x: 1.2, y: 0.05, angle: 5, props: { length: 0.8, legs: false } }, { id: "h", type: "sand-pile", x: 1.2, y: 0.061, props: { sand_kg: 0.5 } }], 0.5],
		["1 kg on the table", [{ id: "h", type: "sand-pile", x: 1.2, y: 0, props: { sand_kg: 1 } }], 1]
	]
	for (const [label, items, kg] of cases) {
		const R = run(scene(items, 2))
		const m0 = series(R.track, "h", "mass_g")[0] as number
		const sp0 = series(R.track, "h", "spilled_g")[0] as number
		const m1 = last(R.track, "h", "mass_g")
		const sp1 = last(R.track, "h", "spilled_g")
		const told = (R.summary.happenings ?? []).some((h) => /^h does not fit on /.test(h.text))
		within(`${label}: its grains, on it and spilled, at the start`, m0 + sp0, kg * 1000, 0.003, "g")
		within(`${label}: and at the end`, m1 + sp1, kg * 1000, 0.01, "g")
		claim(`${label}: ${sp0 > 1 ? `${fmt(sp0)} g ran off its edge, and the run says so` : "it fits: nothing spilled, nothing said"} (slope ${fmt(last(R.track, "h", "angle_deg"))}°, under 40°)`, (sp0 > 1 ? told : !told) && last(R.track, "h", "angle_deg") < 40)
	}
}

if (want === "all" || want === "bodies") {
	console.log("\n# bodies: a brick rests on sand, sinking a few millimetres (bearing [VESIC73]); a ball rolled into a sand pit ploughs and stops")
	const R = run(scene([{ id: "tray", type: "sand-tray", x: 1.2, y: 0, props: { length: 0.5, width: 0.3, sand_depth: 0.05 } }, { id: "b", type: "brick", x: 1.2, y: 0.15, props: {} }], 2))
	const bs = R.doc.solids.find((s) => s.item === "b")!
	const half = ((bs.body as { height?: number }).height ?? 0.065) / 2
	const y1 = R.track.frames[R.track.frames.length - 1]!.placements[bs.id]!.y
	const sink = 0.062 - (y1 - half)
	claim(`a brick dropped 5 cm onto sand ends ${fmt(sink * 1000)} mm in it (under 8 mm: sand bears ½N_γγB ≈ 30 kPa, a brick presses about 2 kPa [VESIC73])`, sink >= -0.001 && sink < 0.008)
	// (a 60 cm plank at 15° whose low end lies inside the pit, on its sand; the ball held at its top)
	const roll = run(scene([{ id: "pit", type: "sand-tray", x: 1.6, y: 0, props: { length: 0.8, width: 0.4, sand_depth: 0.05, wall: 0.05 } }, { id: "ramp", type: "plank", x: 1.0, y: 0.15, angle: -15, props: { length: 0.6 } }, { id: "ball", type: "tennis-ball", x: 0.78, y: 0.26, held: true, props: {} }], 5))
	const bid = roll.doc.solids.find((s) => s.item === "ball")
	if (bid) {
		const f = roll.track.frames
		const xEnd = f[f.length - 1]!.placements[bid.id]!.x
		const v = Math.abs(xEnd - f[f.length - 13]!.placements[bid.id]!.x) * 10
		claim(`a tennis ball rolled into a sand pit stops in it (ends at x ${fmt(xEnd)} m, moving ${fmt(v)} m/s)`, xEnd > 1.2 && xEnd < 2.0 && v < 0.05)
	} else claim("a tennis ball type exists for the rolling check", false)
}

// ---------------------------------------------------------------- erosion
if (want === "all" || want === "erosion") {
	console.log("\n# erosion: running water carries sand from a slope and drops it in the pool [WP06] [SOULSBY97]; more slope or water, more erosion; gravel and grass resist [FISCHENICH01]")
	const er = (props: Record<string, unknown>) => {
		const R = run(scene([{ id: "st", type: "stream-table", x: 1.2, y: 0.1, props }], 12, { settings: { time_lapse: 20 } }))
		return { e: last(R.track, "st", "eroded_g"), d: last(R.track, "st", "delta_cm"), c: last(R.track, "st", "channel_mm"), R }
	}
	const base = er({ tilt_deg: 6 })
	claim(`1 L/min on 6° for ${fmt(11.5 * 20 / 60)} lesson minutes carries ${fmt(base.e)} g (tens to a few thousand grams, as classroom stream tables do [EMRIVER])`, base.e > 20 && base.e < 5000)
	claim(`a delta forms at the pool (${fmt(base.d)} cm past the toe)`, base.d >= 1)
	claim(`a channel is cut (${fmt(base.c)} mm deep)`, base.c >= 3)
	const steep = er({ tilt_deg: 12 })
	const gentle = er({ tilt_deg: 3 })
	claim(`steeper erodes more: 3° ${fmt(gentle.e)} g < 6° ${fmt(base.e)} g < 12° ${fmt(steep.e)} g`, gentle.e < base.e && base.e < steep.e)
	const more = er({ tilt_deg: 6, flow_lpm: 2 })
	const less = er({ tilt_deg: 6, flow_lpm: 0.5 })
	claim(`more water erodes more: 0.5 L/min ${fmt(less.e)} g < 1 ${fmt(base.e)} g < 2 ${fmt(more.e)} g`, less.e < base.e && base.e < more.e)
	const gravel = er({ tilt_deg: 6, grain: "gravel" })
	claim(`gravel hardly moves: ${fmt(gravel.e)} g (under a fifth of sand's: Shields' threshold for 6 mm is ≈ 4 Pa [SOULSBY97])`, gravel.e < 0.2 * base.e)
	const grass = er({ tilt_deg: 6, plants: "all" })
	claim(`grass holds the slope: ${fmt(grass.e)} g (under a fifth of bare sand's) [FISCHENICH01]`, grass.e < 0.2 * base.e)
	// bed load against Wong & Parker at a Shields number of 0.2 (the formula, as the engine evaluates it)
	const s = core.GRAINS.sand!
	const R = s.rhoS / core.RHO_WATER - 1
	within("bed load at θ = 0.2", core.bedLoad(s, 0.2, 0.0495), 3.97 * (0.2 - 0.0495) ** 1.5 * Math.sqrt(R * G * s.d ** 3), 1e-12, "m²/s", "WP06")
}

// ---------------------------------------------------------------- determinism
if (want === "all" || want === "determinism") {
	console.log("\n# determinism: the same scene twice gives the same track, byte for byte")
	const s = scene([
		{ id: "f", type: "sand-funnel", x: 0.6, y: 0, props: { sand_kg: 0.06 } },
		{ id: "tray", type: "sand-tray", x: 1.3, y: 0, props: { length: 0.35 } },
		{ id: "ball", type: "steel-ball", x: 1.3, y: 0.4, held: true, props: { diameter: 0.025 } },
		{ id: "c", type: "sand-pile", x: 2.0, y: 0, props: { shape: "castle" } }
	], 3)
	const a = JSON.stringify(run(s).track)
	const b = JSON.stringify(run(s).track)
	claim(`two runs identical (${a.length} bytes)`, a === b)
}

// ---------------------------------------------------------------- fuzz: random granular scenes never break
if (want === "all" || want === "fuzz") {
	console.log("\n# fuzz: random props of every granular type, with balls and blocks among them: no exceptions, finite readings, no grains made")
	let seed = 20261019
	const rnd = () => {
		seed = (seed * 1103515245 + 12345) >>> 0
		return seed / 4294967296
	}
	const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)] as T
	const types = sim.catalog().types.filter((t) => t.module === "granular")
	let ok = 0
	const N = Number(process.env.FUZZ_N ?? 30)
	for (let k = 0; k < N; k++) {
		const items: Item[] = []
		const n = 1 + Math.floor(rnd() * 3)
		for (let q = 0; q < n; q++) {
			const t = pick(types)
			const props: Record<string, unknown> = {}
			for (const p of t.props) {
				if (rnd() > 0.5) continue
				if (p.kind === "choice") props[p.key] = pick(p.choices ?? [])
				else if (p.kind === "number" && p.min !== undefined && p.max !== undefined) props[p.key] = Number((p.min + rnd() * (p.max - p.min)).toFixed(4))
			}
			if (t.key === "stream-table") props.length = Math.min(1.2, (props.length as number) ?? 0.9)
			items.push({ id: `g${q}`, type: t.key, x: -0.3 + q * 1.2 + rnd() * 0.3, y: t.key === "stream-table" ? 0.15 : 0, props })
		}
		if (rnd() < 0.6) items.push({ id: "ball", type: pick(["steel-ball", "tennis-ball", "golf-ball", "brick"]), x: items[0]!.x, y: 0.3 + rnd() * 0.5, held: true, props: {} })
		const s = scene(items, 2 + rnd() * 3, rnd() < 0.3 ? { settings: { time_lapse: 10 } } : {})
		try {
			const R = run(s)
			const bad = JSON.stringify(R.track.state ?? {}).match(/null|NaN|Infinity/)
			if (bad) throw new Error("a reading is not finite")
			ok++
		} catch (e) {
			console.log(`      scene ${k}: ${String((e as Error).message).slice(0, 200)}  ${JSON.stringify(items).slice(0, 300)}`)
		}
	}
	claim(`${ok} of ${N} random scenes ran with finite readings`, ok === N)
}

// ---------------------------------------------------------------- the budget
if (want === "all" || want === "perf") {
	console.log("\n# perf: CPU time of each type's lesson scene (node, this machine; the run's own seconds in brackets)")
	for (const [label, s] of [
		["heap of 1 kg poured (12 s)", scene([{ id: "f", type: "sand-funnel", x: 1.2, y: 0, props: { sand_kg: 0.3, height: 0.25 } }], 12)],
		["two castles (3 s)", scene([{ id: "a", type: "sand-pile", x: 0.9, y: 0, props: { shape: "castle", wetness: "damp" } }, { id: "b", type: "sand-pile", x: 1.5, y: 0, props: { shape: "castle" } }], 3)],
		["two crater trays (2.5 s)", scene([{ id: "a", type: "sand-tray", x: 0.9, y: 0, props: { length: 0.4 } }, { id: "b", type: "sand-tray", x: 1.6, y: 0, props: { length: 0.4 } }, { id: "p", type: "steel-ball", x: 0.9, y: 0.7, held: true, props: { diameter: 0.03 } }, { id: "q", type: "steel-ball", x: 1.6, y: 0.3, held: true, props: { diameter: 0.03 } }], 2.5)],
		["a one-minute hourglass at time-lapse 4 (16 s)", scene([{ id: "h", type: "hourglass", x: 1.2, y: 0 }], 16, { settings: { time_lapse: 4 } })],
		["a stream table, 5 lesson minutes (16 s)", scene([{ id: "st", type: "stream-table", x: 1.2, y: 0.1 }], 16, { settings: { time_lapse: 20 } })],
		["three funnels: sand, gravel, flour (8 s)", scene([{ id: "s", type: "sand-funnel", x: 0.6, y: 0, props: { grain: "sand" } }, { id: "g", type: "sand-funnel", x: 1.3, y: 0, props: { grain: "gravel", outlet_mm: 40 } }, { id: "f", type: "sand-funnel", x: 2.0, y: 0, props: { grain: "flour", outlet_mm: 25 } }], 8)],
		["two sand timers at time-lapse 4 (16 s)", scene([{ id: "a", type: "hourglass", x: 0.9, y: 0 }, { id: "b", type: "hourglass", x: 1.6, y: 0, props: { neck_mm: 4 } }], 16, { settings: { time_lapse: 4 } })]
	] as const) {
		const R = run(s)
		// (the budget: a lesson scene in about 1.5 s of CPU at most, so a build's runs stay quick on a loaded machine. GitHub's shared 4-core
		// runners take up to twice as long for the same run (two sand timers: 0.89-1.71 s of CPU there, the module's whole check 21.6 s on one
		// runner and 40.9 s on another), so CI keeps a regression gate at 2.5x the budget, as rw-validate-optics.ts' perf check does)
		const budget = process.env.CI ? 3750 : 1500
		claim(`${label}: ${fmt(R.ms)} ms of CPU (under ${budget} ms)`, R.ms < budget)
	}
}

console.log(`\n${checks} checks, ${failures} failed (engine CPU ${fmt(cpuMs / 1000)} s)`)
process.exit(failures ? 1 : 0)
