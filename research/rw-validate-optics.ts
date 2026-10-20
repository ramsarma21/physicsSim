/**
 * The optics module against real reference values (tooling/src/sim/optics.ts, tooling/src/sim/modules/optics.ts, machines/mod_optics.py).
 *   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-optics.ts [group ...|all]
 * Groups: snell fresnel mirror tir prism lens image inverse shadow materials seeing sun heat filter energy perf determinism fuzz liquids
 * lamps colour blink fuzzx.
 * Scenes are built the way the app builds them (web/sim: the exact port of machines/*.py) and run by the engine itself (tooling/src/sim with
 * every module registered); a few geometric checks call the tracer directly with a chosen wavelength. Every reference is cited:
 *   [SCHOTT] SCHOTT N-BK7 data sheet: nd 1.51680, nC 1.51432, nF 1.52238 (Abbe 64.17); F2 nd 1.62004.
 *   [CRC] CRC Handbook, index of refraction of water at 20 °C: nD 1.33299. [HEC] Hecht, Optics 5th ed.: Snell's law (§4.4), Fresnel
 *   normal-incidence reflectance ((n − 1)/(n + 1))² ≈ 4.2 % for glass (§4.6), mirrors (§4.3), critical angle asin(1/n) (§4.7), thin lens
 *   1/f = 1/d_o + 1/d_i and magnification −d_i/d_o (§5.2), minimum deviation n = sin((A + D)/2)/sin(A/2) (§5.5), inverse-square law (§3.3).
 *   [CIE] photopic V(λ), 683 lm/W; [ASTM] ASTM G173-03 AM1.5 global 1000 W/m² (≈ 100-120 klx in clear noon sun); [INC] Incropera A.12:
 *   solar absorptivity of white paint 0.2-0.26, black paint 0.95-0.98; [IES]/[DOE] a 60 W incandescent ≈ 800 lm, 10 % light 72 % infrared.
 *   The spec's demos (engine4 spec optics.md §5): O2 shadow 15.0 cm ± 2 %, O4 32.0° and 27.8°, O5 41.25°, O7 ratio 4.0 ± 2 %, O8 glass ≈ 92 %,
 *   O9 image at 15 cm, half size (± 2 % paraxial), O10 red 38.4°, blue 39.2°.
 *   Liquids (the liquids module's containers): water nD 1.33299 [CRC] (45° in the air → 32.04° in the water), saturated salt water ≈ 1.3787
 *   [CRC], soybean oil 1.4735 [CODEX]; n·sin θ kept through a glass wall and from layer to layer [HEC §4.4]. Circuit lamps: a bare bulb
 *   lights a sphere, E = Φ/(4π d²) [HEC §3.3]; a point light's shadow by similar triangles. Colour: one-colour LEDs [SCHUBERT]; balanced
 *   red, green and blue (ITU-R BT.2020 white: 0.2627, 0.6780, 0.0593 of the luminance) mix to white. Morse code: ITU-R M.1677-1.
 */
import "../tools/engine-math-node.mjs"

const PG = new URL("..", import.meta.url).pathname
const sim = await import(`${PG}web/sim/index.js`)
const O = await import(`${PG}tooling/src/sim/optics.ts`)
const { admitDocument } = await import(`${PG}tooling/src/sim/document.ts`)
const { simulate } = await import(`${PG}tooling/src/sim/physics.ts`)
await import(`${PG}tooling/src/sim/modules/index.ts`)
const view = await import(`${PG}web/sim/optics.js`)
const plug = (await import(`${PG}web/sim/modules/optics.js`)) as { colourWord: (b: number[]) => string | null }

type Item = { id: string; type: string; x: number; y: number; name?: string; angle?: number; fixed?: boolean; props?: Record<string, unknown> }
const D = Math.PI / 180
let pass = 0
let fail = 0
const check = (name: string, got: number, want: number, tol: number, unit = "") => {
	const ok = Number.isFinite(got) && Math.abs(got - want) <= tol
	if (ok) pass++
	else fail++
	console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${fmt(got)}${unit} (reference ${fmt(want)}${unit} ± ${fmt(tol)})`)
}
const truth = (name: string, ok: boolean, detail = "") => {
	if (ok) pass++
	else fail++
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`)
}
const fmt = (v: number) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toPrecision(5) : String(Math.round(v * 10000) / 10000))

/** A scene through the app's builder and the engine: its track's readings at the end and its events. */
const run = (items: Item[], seconds = 0.5) => {
	const scene = { version: 2, id: "v", name: "v", seconds, release: 0.5, stage: { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals: [] }
	const { doc } = sim.prepare(scene)
	const { scene: s } = admitDocument(doc)
	const t0 = performance.now()
	const track = simulate(s, 120) as { state?: Record<string, Record<string, number[]>>; events?: { t: number; items: string[]; text: string; kind?: string }[] }
	const ms = performance.now() - t0
	const end = (item: string, key: string) => {
		const v = track.state?.[item]?.[key]
		return Array.isArray(v) && v.length ? (v[v.length - 1] as number) : NaN
	}
	return { doc, track, end, ms, events: track.events ?? [] }
}
/** The tracer alone on one set of bodies and sources (geometric checks at a chosen wavelength). */
const laserSrc = (x: number, y: number, dir: number, nm: number, mw = 1): import("../tooling/src/sim/optics.ts").OpticSource => {
	const p = new Float64Array(O.NB)
	p[O.bandOf(nm)] = mw / 1000
	return { id: "L/light", item: "L", solid: "", kind: "laser", x, y, dir, spread: 0, outSpread: 0, size: 0.00075, blur: 0.0005, power: p, nm, rays: 1 }
}
const angleOf = (g: { x0: number; y0: number; x1: number; y1: number }) => Math.atan2(g.y1 - g.y0, g.x1 - g.x0)
const nOf = (medium: string, nm: number) => (O.MEDIA[medium] as { n: (u: number) => number }).n(nm / 1000)

const GROUPS: Record<string, () => void> = {
	snell() {
		// O4: a laser into water and into BK7 at 45° from the normal (589.3 nm): asin(sin 45°/n)
		for (const [medium, want] of [
			["water", Math.asin(Math.sin(45 * D) / 1.33299)],
			["crown glass", Math.asin(Math.sin(45 * D) / 1.5168)]
		] as const) {
			const block = { id: "B/b", item: "B", role: "glass" as const, prims: O.slabPrims(0.4, 0.2), halfDepth: 0.1, medium, absorb: [0, 0, 0, 0, 0, 0, 0, 0] }
			const r = O.trace({ bodies: [block], sources: [laserSrc(-0.3, 0.4, -45 * D, 589.3)], pose: () => ({ x: 0, y: 0, angle: 0 }), segments: true })
			const inside = r.segments.find((g) => Math.abs(g.y0 - 0.1) < 1e-9 && g.y1 < 0.1)
			const got = inside ? Math.atan2(inside.x1 - inside.x0, inside.y0 - inside.y1) : NaN
			check(`refraction into ${medium} at 45° (589.3 nm)`, got / D, want / D, 0.05, "°")
			// Snell exactly, with the engine's own indices: n1 sin θ1 = n2 sin θ2
			check(`  n1·sin θ1 − n2·sin θ2 into ${medium}`, O.N_AIR * Math.sin(45 * D) - nOf(medium, 589.3) * Math.sin(got), 0, 1e-12)
		}
		check("water's index at 589.3 nm [CRC]", nOf("water", 589.3), 1.33299, 3e-4)
		check("N-BK7 nd, nC, nF [SCHOTT]", nOf("crown glass", 587.56) + nOf("crown glass", 656.27) + nOf("crown glass", 486.13), 1.5168 + 1.51432 + 1.52238, 3e-4)
		check("F2 nd [SCHOTT]", nOf("flint glass", 587.56), 1.62004, 2e-4)
	},
	fresnel() {
		const n = nOf("crown glass", 589.3)
		const R0 = ((n - O.N_AIR) / (n + O.N_AIR)) ** 2
		check("normal-incidence reflectance of BK7 [HEC §4.6]", R0 * 100, 4.2, 0.1, " %")
		const block = { id: "B/b", item: "B", role: "glass" as const, prims: O.slabPrims(0.01, 0.2), halfDepth: 0.1, medium: "crown glass", absorb: [0, 0, 0, 0, 0, 0, 0, 0] }
		const r = O.trace({ bodies: [block], sources: [laserSrc(-0.3, 0, 0, 589.3)], pose: () => ({ x: 0, y: 0, angle: 0 }), segments: true })
		const out = r.segments.filter((g) => g.x0 >= 0.005 - 1e-9 && g.x1 > 1).reduce((a, g) => a + g.p.reduce((x, y) => x + y, 0), 0)
		// (its light twice reflected inside, R² = 0.18 %, is under the tracer's 0.2 % cutoff: (1 − R)² e^(−αL) is what passes, α 0.2/m [SCHOTT])
		check("a 1 cm pane passes (1 − R)²·e^(−αL) of a laser", out / 0.001, (1 - R0) ** 2 * Math.exp(-0.2 * 0.01), 0.0005)
		// O8 through the app: a flashlight's meter behind clear glass reads ≈ 92 % of one with nothing in the way
		const lanes = (sample: string | null, y: number, k: string): Item[] => [
			{ id: `t${k}`, type: "flashlight", x: 0, y, props: { beam_angle: 10 } },
			...(sample ? [{ id: `p${k}`, type: "material-panel", x: 0.55, y, props: { sample } }] : []),
			{ id: `m${k}`, type: "light-meter", x: 0.645, y, props: {} }
		]
		const res = run([...lanes(null, 0.2, "0"), ...lanes("clear glass", 0.6, "1")])
		check("O8: a glass panel lets ≈ 92 % through (two 4 % reflections)", (res.end("m1", "lux") / res.end("m0", "lux")) * 100, 100 * (1 - R0) ** 2, 1.0, " %")
	},
	mirror() {
		for (const turn of [0, 5, 15, 30, 44]) {
			const m = { id: "M/m", item: "M", role: "mirror" as const, prims: O.slabPrims(0.004, 0.3), halfDepth: 0.05, faces: [2], absorb: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9], reflect: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.92] }
			const r = O.trace({ bodies: [m], sources: [laserSrc(0, 0, 0, 650)], pose: (id) => (id === "M/m" ? { x: 0.6, y: 0, angle: turn * D } : undefined), segments: true })
			const g = r.segments[1]
			const inc = Math.abs(turn) // the angle of incidence (from the mirror's normal)
			const refl = g ? Math.abs(Math.atan2(Math.sin(angleOf(g) - (Math.PI + 2 * turn * D)), Math.cos(angleOf(g) - (Math.PI + 2 * turn * D)))) : NaN
			check(`O3: angle out = angle in (${inc}°)`, refl, 0, 1e-9, " rad")
		}
		// O3 through the app: a laser 30° to a mirror's normal reaches a target placed 30° on the other side
		const out = 120 * D
		const res = run([
			{ id: "laser", type: "laser-pointer", x: 0.2, y: 0.25, props: {} },
			{ id: "mirror", type: "mirror", x: 0.8, y: 0.25, props: { aim: 150 } },
			{ id: "target", type: "light-sensor", x: 0.8 + 0.5 * Math.cos(out), y: 0.25 + 0.5 * Math.sin(out), props: { size: 0.01 } }
		])
		truth("O3 in the app: the beam reaches a 1 cm target placed by the law of reflection", res.events.some((e) => e.kind === "light" && e.items[0] === "laser" && e.items[1] === "target"))
		check("  and 90 % of the laser lands on it (the mirror's reflectance)", res.end("target", "mw"), 0.9, 0.005, " mW")
	},
	tir() {
		const crit = Math.asin(O.N_AIR / nOf("crown glass", 589.3)) / D
		check("critical angle of BK7 at 589 nm (asin 1/n) [HEC §4.7]", crit, Math.asin(1 / 1.5168) / D, 0.02, "°")
		// a laser through a semicircular block's round side onto the middle of its flat face, just below and above the critical angle
		const semi = { id: "S/s", item: "S", role: "glass" as const, prims: [{ k: "disk" as const, cx: 0, cy: 0, r: 0.05 }, { k: "half" as const, nx: 1, ny: 0, d: 0 }], halfDepth: 0.01, medium: "crown glass", absorb: [0, 0, 0, 0, 0, 0, 0, 0] }
		for (const [deg, want] of [[crit - 0.3, false], [crit + 0.3, true], [40, false], [43, true]] as const) {
			const r = O.trace({ bodies: [semi], sources: [laserSrc(-0.3 * Math.cos(deg * D), -0.3 * Math.sin(deg * D), deg * D, 589.3)], pose: () => ({ x: 0, y: 0, angle: 0 }), segments: true })
			truth(`O5: ${deg.toFixed(2)}° on the flat face: ${want ? "totally reflected" : "gets out"}`, (r.tir[0] as number) > 0 === want)
		}
	},
	prism() {
		// O10: a 60° BK7 prism at minimum deviation: D = 2·asin(n·sin 30°) − 60° for C (656.3 nm) and F (486.1 nm) [HEC §5.5]
		const s = 0.05
		const h = (s * Math.sqrt(3)) / 2
		const prism = { id: "P/p", item: "P", role: "glass" as const, prims: O.polygonPrims([{ x: -s / 2, y: -h / 3 }, { x: s / 2, y: -h / 3 }, { x: 0, y: (2 * h) / 3 }]), halfDepth: 0.025, medium: "crown glass", absorb: [0, 0, 0, 0, 0, 0, 0, 0] }
		const dev = (nm: number) => {
			const n = nOf("crown glass", nm) / O.N_AIR
			const Dm = 2 * Math.asin(n * Math.sin(30 * D)) - 60 * D
			const dir = 150 * D + Math.PI + (60 * D + Dm) / 2
			const r = O.trace({ bodies: [prism], sources: [laserSrc(-s / 4 - 0.3 * Math.cos(dir), h / 6 - 0.3 * Math.sin(dir), dir, nm)], pose: () => ({ x: 0, y: 0, angle: 0 }), segments: true })
			const out = r.segments.filter((g) => g.x0 > 0 && g.x1 > g.x0).sort((a, b) => b.p.reduce((x, y) => x + y, 0) - a.p.reduce((x, y) => x + y, 0))[0]
			return out ? Math.atan2(Math.sin(dir - angleOf(out)), Math.cos(dir - angleOf(out))) / D : NaN
		}
		check("O10: red (C, 656.3 nm) deviated", dev(656.27), 38.43, 0.05, "°")
		check("O10: blue (F, 486.1 nm) deviated", dev(486.13), 39.13, 0.05, "°")
		check("O10: the spectrum's spread C → F", dev(486.13) - dev(656.27), 0.7, 0.05, "°")
		// the app: a slit of sunlight through a flint prism gives all 7 colours on a screen, violet and red apart
		const nd = 1.62004
		const th = Math.asin(nd * Math.sin(30 * D))
		const dv = 2 * th - 60 * D
		const res = run([
			{ id: "sun", type: "sunlight", x: 0.8 - Math.cos(-dv / 2), y: 0.4 - Math.sin(-dv / 2), props: { elevation: dv / 2 / D, width: 0.005 } },
			{ id: "prism", type: "prism", x: 0.8, y: 0.4, props: { glass: "flint glass", edge: 0.06, aim: 180 } },
			{ id: "screen", type: "screen", x: 1.3, y: 0.4 + 0.5 * Math.tan(dv / 2), props: { height: 0.4 } }
		])
		check("O10 in the app: colours on the screen", res.end("screen", "colors"), 7, 0)
		truth("  violet and red land apart (spread > 10 mm at 0.5 m)", res.end("screen", "spread_mm") > 10, `${fmt(res.end("screen", "spread_mm"))} mm`)
	},
	lens() {
		// a convex lens brings sunlight to its focus: the thick lens's back focal length (paraxial) [HEC]
		const f = 0.1
		const n = nOf("crown glass", 587.56)
		const dia = 0.03
		const { R, t } = O.lensShape(f, 1.5168, dia, 0.0015)
		const lens = { id: "L/l", item: "L", role: "glass" as const, prims: [{ k: "disk" as const, cx: R - t / 2, cy: 0, r: R, sph: true }, { k: "disk" as const, cx: -(R - t / 2), cy: 0, r: R, sph: true }, { k: "half" as const, nx: 0, ny: 1, d: dia / 2 }, { k: "half" as const, nx: 0, ny: -1, d: dia / 2 }], halfDepth: dia / 2, medium: "crown glass", absorb: [0, 0, 0, 0, 0, 0, 0, 0], aperture: { cx: 0, cy: 0, ax: 1, ay: 0, r: dia / 2 } }
		const p = new Float64Array(O.NB)
		p[3] = 1000
		const sun = { id: "S/s", item: "S", solid: "", kind: "sun" as const, x: -0.3, y: 0, dir: 0, spread: 0, outSpread: 0, size: 0.002, blur: 0, power: p, nm: 587.56, rays: 9 }
		const r = O.trace({ bodies: [lens], sources: [sun], pose: () => ({ x: 0, y: 0, angle: 0 }), segments: true })
		const xs: number[] = []
		for (const g of r.segments) if (g.x0 > 0 && g.x1 > g.x0 && Math.sign(g.y0) !== Math.sign(g.y1) && Math.abs(g.y0) > 1e-6) xs.push(g.x0 + ((g.x1 - g.x0) * -g.y0) / (g.y1 - g.y0))
		const ft = 1 / ((n - 1) * (2 / R - ((n - 1) * t) / (n * R * R)))
		const bfl = ft * (1 - ((n - 1) * t) / (n * R))
		check("a convex lens (f 10 cm) focuses near-axis sunlight at its back focal length", Math.max(...xs) - t / 2, bfl, 0.001, " m")
		check("  its focal length is what the lensmaker's equation gives the record", ft, f, 0.0005, " m")
	},
	image() {
		// O9: convex f = 10 cm, a lit arrow 30 cm in front: a sharp image 15 cm behind, upside down, half size (each point's light fills the lens)
		const res = run([
			{ id: "arrow", type: "lit-arrow", x: 1.0 - 0.3 - 0.016, y: 0.3, props: { height: 0.02 } },
			{ id: "lens", type: "convex-lens", x: 1.0, y: 0.3, props: { focal_length: 0.1, diameter: 0.05 } },
			{ id: "screen", type: "screen", x: 1.0 + 0.15 + 0.0025, y: 0.3, props: { height: 0.3 } }
		])
		check("O9: the image's size (−½ × 2 cm: upside down, half size)", res.end("screen", "image_cm"), -1.0, 0.02, " cm")
		truth("O9: it is sharp at 15 cm (blur under 2 mm: an f/2 lens's own aberrations and colours)", res.end("screen", "blur_mm") < 2, `blur ${fmt(res.end("screen", "blur_mm"))} mm`)
		const far = run([
			{ id: "arrow", type: "lit-arrow", x: 1.0 - 0.3 - 0.016, y: 0.3, props: { height: 0.02 } },
			{ id: "lens", type: "convex-lens", x: 1.0, y: 0.3, props: { focal_length: 0.1, diameter: 0.05 } },
			{ id: "screen", type: "screen", x: 1.0 + 0.25 + 0.0025, y: 0.3, props: { height: 0.3 } }
		])
		truth("O9: blurred at 25 cm (past the image)", far.end("screen", "blur_mm") > 3 * res.end("screen", "blur_mm"), `blur ${fmt(far.end("screen", "blur_mm"))} mm`)
	},
	inverse() {
		// O7: a lamp's light meters at 0.5 m and 1.0 m: 4:1 (1/d²) [HEC §3.3]
		const bulb = { x: 0.12 + 0.03 * Math.cos(45 * D), y: 0.6 + 0.03 * Math.sin(45 * D) }
		const at = (d: number, a: number) => ({ x: bulb.x + (d + 0.015) * Math.cos(a * D), y: bulb.y + (d + 0.015) * Math.sin(a * D) })
		const res = run([
			{ id: "lamp", type: "lamp", x: 0, y: 0, props: { aim: 45, beam_angle: 60, head_height: 0.6 } },
			{ id: "near", type: "light-meter", ...at(0.5, 50), props: { aim: 230 } },
			{ id: "far", type: "light-meter", ...at(1.0, 40), props: { aim: 220 } }
		])
		check("O7: near / far meter (0.5 m / 1.0 m)", res.end("near", "lux") / res.end("far", "lux"), 4.0, 0.08)
		// the absolute illuminance: E = I/d², I = the lamp's beam lumens over its cone's solid angle (60 W × 0.8 × 0.7 shade [heat module], 10/82 visible [IES])
		const beamW = 60 * 0.8 * 0.7
		const vis = (beamW * 10) / 82
		const lm = O.lumens(O.sourceSpectrum({ kind: "incandescent", visible: vis }), 0)
		const I = lm / (2 * Math.PI * (1 - Math.cos(30 * D)))
		check("O7: the 1 m meter reads I/d² (I from the lamp's lumens and its 60° cone)", res.end("far", "lux"), I, 0.03 * I, " lx")
		// a flashlight on axis at 0.5, 1, 2 m: E = Φ/(2π(1 − cos θ))/d²
		const fl = [0.5, 1, 2].map((d) => run([{ id: "t", type: "flashlight", x: 0, y: 0.3, props: { lumens: 150, beam_angle: 20 } }, { id: "m", type: "light-meter", x: 0.076 + d + 0.015, y: 0.3, props: {} }]).end("m", "lux"))
		const If = 150 / (2 * Math.PI * (1 - Math.cos(10 * D)))
		check("a 150 lm 20° flashlight at 1 m: I/d²", fl[1] as number, If, 0.03 * If, " lx")
		check("  0.5 m / 1 m", (fl[0] as number) / (fl[1] as number), 4, 0.08)
		check("  1 m / 2 m", (fl[1] as number) / (fl[2] as number), 4, 0.08)
	},
	shadow() {
		// O2: a 5 cm card 20 cm (and 40 cm) from a small light, the screen 60 cm away: 5 × 60/20 = 15 cm (7.5 cm)
		for (const [d, want] of [[0.2, 15], [0.4, 7.5]] as const) {
			const res = run([
				{ id: "torch", type: "flashlight", x: 0, y: 0.3, props: { beam_angle: 30 } },
				{ id: "card", type: "material-panel", x: 0.076 + d + 0.001, y: 0.3, props: { sample: "white card", size: 0.05 } },
				{ id: "screen", type: "screen", x: 0.076 + 0.6 + 0.0025, y: 0.3, props: { height: 0.6 } }
			])
			check(`O2: the shadow of a 5 cm card ${d * 100} cm from the light`, res.end("screen", "shadow_cm"), want, 0.02 * want, " cm")
			truth("  the card is named as casting it", res.events.some((e) => e.kind === "shadow" && e.items[0] === "card" && e.items[1] === "screen"))
		}
	},
	materials() {
		const lane = (sample: string, y: number, k: string): Item[] => [
			{ id: `t${k}`, type: "flashlight", x: 0, y, props: { beam_angle: 10 } },
			{ id: `p${k}`, type: "material-panel", x: 0.55, y, props: { sample } },
			{ id: `m${k}`, type: "light-meter", x: 0.645, y, props: {} }
		]
		const res = run([{ id: "t0", type: "flashlight", x: 0, y: 0.15, props: { beam_angle: 10 } }, { id: "m0", type: "light-meter", x: 0.645, y: 0.15, props: {} }, ...lane("wax paper", 0.45, "1"), ...lane("cardboard", 0.75, "2"), ...lane("aluminium foil", 1.05, "3"), ...lane("frosted glass", 1.35, "4")])
		const ref = res.end("m0", "lux")
		truth("O8: wax paper lets some light through (translucent)", res.end("m1", "lux") > 0.01 * ref && res.end("m1", "lux") < 0.7 * ref, `${fmt((100 * res.end("m1", "lux")) / ref)} % at the meter`)
		check("O8: cardboard lets none through", res.end("m2", "lux"), 0, 0.5, " lx")
		check("O8: foil lets none through (it reflects)", res.end("m3", "lux"), 0, 0.5, " lx")
		truth("  frosted glass passes more than wax paper", res.end("m4", "lux") > res.end("m1", "lux"))
		truth("  the foil sends light back toward its flashlight", res.events.some((e) => e.kind === "light" && e.items[0] === "t3" && e.items[1] === "t3") || res.end("t3", "light_w") > 0)
	},
	seeing() {
		const scene = (on: boolean): Item[] => [
			{ id: "torch", type: "flashlight", x: 0, y: 0.35, props: { aim: -20, beam_angle: 30, on } },
			{ id: "book", type: "hardcover-book", x: 0.6, y: 0.11, props: {} },
			{ id: "eye", type: "eye", x: 1.1, y: 0.3, props: { aim: 195 } }
		]
		const lit = run(scene(true))
		truth("O6: the eye sees the lit book", lit.events.some((e) => e.kind === "sees" && e.items[0] === "eye" && e.items[1] === "book"))
		const dark = run(scene(false))
		check("O6: in the dark it sees nothing", dark.end("eye", "sees"), 0, 0)
		const hidden = run([...scene(true), { id: "card", type: "material-panel", x: 0.85, y: 0.2, props: { sample: "cardboard", size: 0.4 } }])
		truth("O6: a book behind a card is not seen", !hidden.events.some((e) => e.kind === "sees" && e.items[1] === "book"))
	},
	sun() {
		// clear noon sun: 1000 W/m² [ASTM] ≈ 100-120 klx; our bands hold 380-2500 nm (96.5 % of it)
		const res = run([{ id: "sun", type: "sunlight", x: 1, y: 1.5, props: { elevation: 90, irradiance: 1000 } }, { id: "m", type: "light-meter", x: 1, y: 0.3, props: { aim: 90 } }])
		check("sunlight on a meter facing it (W/m²)", res.end("m", "wm2"), 965, 10, " W/m²")
		truth("  ≈ 100-120 klx [ASTM]", res.end("m", "lux") > 95000 && res.end("m", "lux") < 125000, `${fmt(res.end("m", "lux"))} lx`)
		const low = run([{ id: "sun", type: "sunlight", x: 1, y: 1.5, props: { elevation: 30, irradiance: 1000 } }, { id: "m", type: "light-meter", x: 1, y: 0.3, props: { aim: 90 } }])
		check("  on flat ground at 30° elevation: × sin 30°", low.end("m", "wm2") / res.end("m", "wm2"), 0.5, 0.01)
	},
	heat() {
		// O11: black and white under the same sun: black takes in ≈ 0.95, white ≈ 0.2-0.26 [INC A.12]
		const res = run([
			{ id: "sun", type: "sunlight", x: 1.0, y: 1.5, props: { elevation: 90 } },
			{ id: "white", type: "material-panel", x: 0.6, y: 0.002, props: { sample: "white card", aim: 90 } },
			{ id: "black", type: "material-panel", x: 1.2, y: 0.002, props: { sample: "black cloth", aim: 90 } }
		])
		const inW = 0.965 * 1000 * 0.1 * 0.1
		check("O11: black cloth absorbs (share of the light on it)", res.end("black", "light_w") / inW, 0.96, 0.03)
		truth("O11: white card absorbs 0.1-0.3 of it", res.end("white", "light_w") / inW > 0.1 && res.end("white", "light_w") / inW < 0.3, fmt(res.end("white", "light_w") / inW))
		// the heat module's lamp: the same beam irradiance as the heat module's own model for an unobstructed beam: P_beam/(Ω d²)
		const lamp = run([{ id: "lamp", type: "lamp", x: 0, y: 0, props: { aim: 0, beam_angle: 60, head_height: 0.4 } }, { id: "m", type: "light-meter", x: 0.15 + 0.5 + 0.015, y: 0.4, props: {} }])
		const P = 60 * 0.8 * 0.7
		check("the lamp's beam on a meter at 0.5 m: P_beam/(Ω d²) (the heat module's model)", lamp.end("m", "wm2"), P / (2 * Math.PI * (1 - Math.cos(30 * D)) * 0.25), 0.03 * (P / (2 * Math.PI * (1 - Math.cos(30 * D)) * 0.25)), " W/m²")
		const ice = run([{ id: "cube", type: "ice-cube", x: 0.8, y: 0.0125, props: {} }, { id: "lamp", type: "lamp", x: 0.4, y: 0, props: { target: "cube" } }])
		truth("an ice cube in a lamp's beam takes in its infrared (water and ice drink it, Beer-Lambert)", ice.end("cube", "light_w") > 0.05, `${fmt(ice.end("cube", "light_w"))} W`)
	},
	filter() {
		const res = run([
			{ id: "laser", type: "laser-pointer", x: 0, y: 0.3, props: { color: "red" } },
			{ id: "f", type: "color-filter", x: 0.4, y: 0.3, props: { color: "red" } },
			{ id: "t", type: "light-sensor", x: 0.8, y: 0.3, props: {} },
			{ id: "laser2", type: "laser-pointer", x: 0, y: 0.7, props: { color: "green" } },
			{ id: "f2", type: "color-filter", x: 0.4, y: 0.7, props: { color: "red" } },
			{ id: "t2", type: "light-sensor", x: 0.8, y: 0.7, props: {} }
		])
		check("a red filter passes red laser light (0.88)", res.end("t", "mw"), 0.88, 0.01, " mW")
		check("a red filter stops green laser light (0.02)", res.end("t2", "mw"), 0.02, 0.002, " mW")
	},
	energy() {
		// every ray's power is accounted for: what is absorbed, what lands, what leaves the scene = what was sent (to 1e-12 of it)
		let seed = 99
		const rnd = () => {
			seed = (Math.imul(seed, 1103515245) + 12345) | 0
			return ((seed >>> 0) % 1000003) / 1000003
		}
		let worst = 0
		for (let k = 0; k < 200; k++) {
			const bodies = [
				{ id: "a/a", item: "a", role: "glass" as const, prims: O.slabPrims(0.05 + rnd() * 0.2, 0.05 + rnd() * 0.2), halfDepth: 1, medium: ["crown glass", "water", "flint glass"][k % 3], absorb: [0, 0, 0, 0, 0, 0, 0, 0] },
				{ id: "b/b", item: "b", role: "mirror" as const, prims: O.slabPrims(0.004, 0.3), halfDepth: 1, faces: [2], absorb: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], reflect: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9] }
			]
			const poses: Record<string, { x: number; y: number; angle: number }> = { "a/a": { x: 0.3, y: rnd() * 0.1, angle: rnd() * 6 }, "b/b": { x: 0.8, y: rnd() * 0.2, angle: rnd() * 6 } }
			const src = laserSrc(-0.3, 0, (rnd() - 0.5) * 0.4, [415, 532, 650][k % 3] as number)
			// (a laser is a beam: its partial reflections are followed; the cutoff drops branches under 0.2 %: count those as leaving)
			const r = O.trace({ bodies, sources: [src], pose: (id) => poses[id], segments: true })
			let absorbed = 0
			let landed = 0
			for (const d of r.deposits) for (let b = 0; b < O.NB; b++) absorbed += (d.absorbed[b] as number) + (d.scattered[b] as number)
			// light that leaves: the segments that end on nothing
			for (const g of r.segments) if (g.end < 0) for (let b = 0; b < O.NB; b++) landed += g.p[b] as number
			// light lost to the cutoff and the absorption along the last segments is small: accounted for by the deposits' volume terms
			const sent = 0.001
			worst = Math.max(worst, Math.abs(sent - absorbed - landed) / sent)
		}
		truth("energy: sent = absorbed + scattered + leaving, over 200 random laser paths (branches under 0.2 % dropped: at most a few of them)", worst < 0.01, `worst ${fmt(worst * 100)} %`)
		// one ray, one interface: reflected + transmitted = incident to 1e-12
		const block = { id: "B/b", item: "B", role: "glass" as const, prims: O.slabPrims(0.4, 0.2), halfDepth: 1, medium: "crown glass", absorb: [0, 0, 0, 0, 0, 0, 0, 0] }
		const r = O.trace({ bodies: [block], sources: [laserSrc(-0.3, 0.4, -45 * D, 589.3)], pose: () => ({ x: 0, y: 0, angle: 0 }), segments: true })
		const first = r.segments[0]
		const inc = first?.p.reduce((a, b) => a + b, 0) ?? NaN
		const at = (g: { x0: number; y0: number }) => first !== undefined && Math.abs(g.x0 - first.x1) < 1e-12 && Math.abs(g.y0 - first.y1) < 1e-12
		const tr = r.segments.find((g) => at(g) && g.y1 < g.y0)?.p.reduce((a, b) => a + b, 0) ?? NaN
		const rf = r.segments.find((g) => at(g) && g.y1 > g.y0)?.p.reduce((a, b) => a + b, 0) ?? NaN
		check("energy: reflected + transmitted − incident at one surface", rf + tr - inc, 0, 1e-12 * inc, " W")
	},
	perf() {
		// the spec's budget: ≤ 2 ms per traced frame for 3 sources × 256 rays × 50 solids on a laptop
		let seed = 5
		const rnd = () => {
			seed = (Math.imul(seed, 1103515245) + 12345) | 0
			return ((seed >>> 0) % 1000003) / 1000003
		}
		const bodies: import("../tooling/src/sim/optics.ts").OpticBody[] = []
		const poses: Record<string, { x: number; y: number; angle: number }> = {}
		for (let i = 0; i < 50; i++) {
			const id = `b${i}/p`
			bodies.push({ id, item: `b${i}`, role: "opaque", prims: i % 2 ? O.slabPrims(0.03 + rnd() * 0.1, 0.03 + rnd() * 0.1) : [{ k: "disk", cx: 0, cy: 0, r: 0.02 + rnd() * 0.05 }], halfDepth: 0.05, absorb: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] })
			poses[id] = { x: 0.4 + rnd() * 2.5, y: rnd() * 1.5, angle: rnd() * 6 }
		}
		const sources = [0, 1, 2].map((k) => ({ id: `s${k}/light`, item: `s${k}`, solid: "", kind: "flashlight" as const, x: 0, y: 0.3 + 0.5 * k, dir: 0, spread: 25 * D, outSpread: 25 * D, round: true, size: 0.01, blur: 0, power: O.sourceSpectrum({ kind: "led", lumens: 200 }), nm: 0, rays: 256 }))
		O.trace({ bodies, sources, pose: (id) => poses[id] })
		const t0 = performance.now()
		const N = 20
		for (let i = 0; i < N; i++) O.trace({ bodies, sources, pose: (id) => poses[id] })
		const ms = (performance.now() - t0) / N
		truth("perf: 3 sources × 256 rays × 50 solids per traced frame (spec ≤ 2 ms)", ms <= 2, `${fmt(ms)} ms`)
	},
	determinism() {
		// the view's tracer (web/sim/optics.js) gives the engine's bits; the same scene twice gives the same track
		let seed = 17
		const rnd = () => {
			seed = (Math.imul(seed, 1103515245) + 12345) | 0
			return ((seed >>> 0) % 1000003) / 1000003
		}
		let same = 0
		for (let k = 0; k < 60; k++) {
			const bodies = [0, 1, 2, 3].map((i) => ({ id: `b${i}/p`, item: `b${i}`, role: (["glass", "mirror", "opaque", "screen"] as const)[i], prims: O.slabPrims(0.02 + rnd() * 0.2, 0.02 + rnd() * 0.2), halfDepth: 0.05, medium: "crown glass", faces: [0, 2], absorb: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] }))
			const poses: Record<string, { x: number; y: number; angle: number }> = {}
			for (const b of bodies) poses[b.id] = { x: 0.3 + rnd(), y: rnd(), angle: rnd() * 7 }
			const src = { id: "s/light", item: "s", solid: "", kind: "flashlight" as const, x: 0, y: 0.4, dir: rnd() - 0.5, spread: 0.3, outSpread: 0.3, round: true, size: 0.01, blur: 0, power: O.sourceSpectrum({ kind: "white", lumens: 300 }), nm: 0, rays: 64 }
			const a = O.trace({ bodies, sources: [src], pose: (id) => poses[id], segments: true })
			const b = view.trace({ bodies, sources: [src], pose: (id: string) => poses[id], segments: true })
			if (JSON.stringify([...a.absorbed]) === JSON.stringify([...b.absorbed]) && JSON.stringify(a.segments.map((g) => [g.x1, g.y1])) === JSON.stringify(b.segments.map((g: { x1: number; y1: number }) => [g.x1, g.y1]))) same++
		}
		check("determinism: the view's tracer (web/sim/optics.js) = the engine's, bit for bit (60 random scenes)", same, 60, 0)
		const items: Item[] = [{ id: "laser", type: "laser-pointer", x: 0.2, y: 0.25, props: {} }, { id: "m", type: "mirror", x: 0.8, y: 0.25, props: { aim: 150 } }, { id: "b", type: "tennis-ball", x: 0.5, y: 0.5, props: {} }]
		const r1 = run(items, 1.5)
		const r2 = run(items, 1.5)
		truth("determinism: the same scene twice gives the same track (a ball falling through the beam)", JSON.stringify(r1.track) === JSON.stringify(r2.track))
	},
	fuzz() {
		let seed = 2026
		const rnd = () => {
			seed = (Math.imul(seed, 1103515245) + 12345) | 0
			return ((seed >>> 0) % 1000003) / 1000003
		}
		const types = ["flashlight", "laser-pointer", "mirror", "curved-mirror", "convex-lens", "concave-lens", "prism", "glass-block", "semicircle-block", "color-filter", "material-panel", "screen", "light-meter", "light-sensor", "eye", "sunlight", "lit-arrow", "tennis-ball", "lamp", "ice-cube"]
		let bad = 0
		let worstMs = 0
		const N = Number(process.env.FUZZ_N ?? 120)
		for (let k = 0; k < N; k++) {
			const items: Item[] = []
			const n = 2 + Math.floor(rnd() * 8)
			for (let i = 0; i < n; i++) {
				const type = types[Math.floor(rnd() * types.length)] as string
				const props: Record<string, unknown> = {}
				if (rnd() < 0.7) props.aim = Math.round(rnd() * 720 - 360)
				items.push({ id: `i${i}`, type, x: rnd() * 2.8 - 0.3, y: rnd() * 1.2 + 0.02, props })
			}
			try {
				const res = run(items, 1)
				worstMs = Math.max(worstMs, res.ms)
				for (const keys of Object.values(res.track.state ?? {})) for (const v of Object.values(keys)) if (v.some((x) => !Number.isFinite(x))) bad++
			} catch (e) {
				bad++
				console.log("  fuzz scene", k, String(e).slice(0, 200))
			}
		}
		truth(`fuzz: ${N} random light scenes, no exceptions or non-finite readings`, bad === 0, `${bad} bad; slowest run ${fmt(worstMs)} ms`)
	}
,
	liquids() {
		// light into the liquids module's water: the tank's water is a refracting body whose top is its live surface [CRC][HEC §4.4]
		const tank = run([{ id: "tank", type: "water-tank", x: 1.0, y: 0, props: {} }, { id: "L", type: "laser-pointer", x: 0.85, y: 0.5, props: { aim: -45 } }])
		const liveBodies = (r: ReturnType<typeof run>) => {
			const rec = r.doc.processes.find((p: { kind: string }) => p.kind === "optics")
			const solids = new Map(r.doc.solids.map((s: { id: string }) => [s.id, s]))
			const sc = O.sceneFromRecord(rec, (id: string) => solids.get(id) as never)
			const pose = (id: string) => {
				const s = solids.get(id) as { at: { x: number; y: number }; angle?: number } | undefined
				return s ? { x: s.at.x, y: s.at.y, angle: s.angle ?? 0 } : undefined
			}
			return { sc, bodies: O.withLevels(sc.bodies, (i: string, k: string) => r.end(i, k)), pose }
		}
		const top = 0.006 + tank.end("tank", "level_mm") / 1000
		const lb = liveBodies(tank)
		const water = lb.bodies.filter((b) => b.liquid !== undefined)
		truth("the aquarium's water is a refracting body (water) whose top is its level", water.length === 1 && water[0]?.medium === "water", `top ${fmt(top)} m`)
		const under = (g: { y0: number; y1: number }) => Math.abs(g.y0 - top) < 1e-6 && g.y1 < top
		for (const [nm, want] of [[589.3, Math.asin(Math.sin(45 * D) / 1.33299)], [650, Math.asin((O.N_AIR * Math.sin(45 * D)) / nOf("water", 650))]] as const) {
			const r = O.trace({ bodies: lb.bodies, sources: [laserSrc(0.9, 0.45, -45 * D, nm)], pose: lb.pose, segments: true })
			const g = r.segments.find(under)
			const got = g ? Math.atan2(g.x1 - g.x0, g.y0 - g.y1) : NaN
			if (nm === 589.3) check("a laser into an aquarium at 45° (589.3 nm): in the water [CRC nD 1.33299]", got / D, want / D, 0.05, "°")
			else check("  the app's red laser (650 nm): Snell with the engine's index", got / D, want / D, 1e-7, "°")
		}
		// the app's own laser goes the same way: its light lands where Snell puts it, not where the straight line would
		const aperture = { x: 0.7 + 0.071 * Math.cos(-45 * D), y: 0.4 + 0.071 * Math.sin(-45 * D) }
		const xs = aperture.x + (aperture.y - top)
		const tw = Math.asin((O.N_AIR * Math.sin(45 * D)) / nOf("water", 650))
		const bent = xs + (top - 0.06) * Math.tan(tw)
		const straight = xs + (top - 0.06)
		const hit = run([
			{ id: "tank", type: "water-tank", x: 1.0, y: 0, props: {} },
			{ id: "L", type: "laser-pointer", x: 0.7, y: 0.4, props: { aim: -45 } },
			{ id: "bent", type: "light-sensor", x: bent, y: 0.06, props: { size: 0.03, aim: 90 } },
			{ id: "straight", type: "light-sensor", x: straight, y: 0.06, props: { size: 0.03, aim: 90 } }
		])
		truth("  the beam reaches a target on the tank's floor where Snell's law puts it", hit.end("bent", "hit") === 1, `${fmt(hit.end("bent", "mw"))} mW at x ${fmt(bent)}`)
		truth("  and not the target where the unbent line would land", hit.end("straight", "hit") === 0, `x ${fmt(straight)}`)
		// through the glass side wall: n sin θ is kept through the glass (air → glass → water)
		{
			const r = O.trace({ bodies: lb.bodies, sources: [laserSrc(0.5, 0.05, 20 * D, 589.3)], pose: lb.pose, segments: true })
			const inWater = r.segments.find((g) => g.x0 > 0.7499 && g.x0 < 0.751 && g.x1 > 0.76 && g.y1 < top + 1e-9 && g.y1 > 0)
			const inGlass = r.segments.find((g) => g.x0 > 0.743 && g.x0 < 0.745 && g.x1 > 0.749)
			const aw = inWater ? angleOf(inWater) : NaN
			const ag = inGlass ? angleOf(inGlass) : NaN
			check("through the aquarium's glass wall at 20°: n_air sin 20° − n_water sin θ_water", O.N_AIR * Math.sin(20 * D) - nOf("water", 589.3) * Math.sin(aw), 0, 1e-9)
			check("  and in the glass, n_glass sin θ_glass", nOf("crown glass", 589.3) * Math.sin(ag) - O.N_AIR * Math.sin(20 * D), 0, 1e-9)
			check("  the angle in the water", aw / D, Math.asin(Math.sin(20 * D) / 1.33299) / D, 0.05, "°")
		}
		// salt water (saturated, 26 %): nD ≈ 1.3787 [CRC]
		{
			const salty = run([{ id: "tank", type: "water-tank", x: 1.0, y: 0, props: { liquid: "salt water", salt_pct: 26 } }, { id: "L", type: "laser-pointer", x: 0.85, y: 0.5, props: { aim: -45 } }])
			const sb = liveBodies(salty)
			const t2 = 0.006 + salty.end("tank", "level_mm") / 1000
			const r = O.trace({ bodies: sb.bodies, sources: [laserSrc(0.9, 0.45, -45 * D, 589.3)], pose: sb.pose, segments: true })
			const g = r.segments.find((s) => Math.abs(s.y0 - t2) < 1e-6 && s.y1 < t2)
			check("into saturated salt water at 45° (589.3 nm): nD 1.3787 [CRC]", g ? Math.atan2(g.x1 - g.x0, g.y0 - g.y1) / D : NaN, Math.asin(Math.sin(45 * D) / 1.3787) / D, 0.05, "°")
		}
		// oil on water (a density column): each layer bends by its own index; n sin θ is kept layer to layer
		{
			const col = run([{ id: "col", type: "density-column", x: 1.0, y: 0, props: { layers: "water and oil" } }, { id: "L", type: "laser-pointer", x: 0.9, y: 0.25, props: { aim: -60 } }])
			const cb = liveBodies(col)
			const tops = [0.003 + col.end("col", "layer1_mm") / 1000, 0.003 + col.end("col", "layer2_mm") / 1000]
			const r = O.trace({ bodies: cb.bodies, sources: [laserSrc(0.9, 0.25, -60 * D, 589.3)], pose: cb.pose, segments: true })
			const inOil = r.segments.find((s) => Math.abs(s.y0 - (tops[1] as number)) < 1e-6 && s.y1 < (tops[1] as number))
			const inWater = r.segments.find((s) => Math.abs(s.y0 - (tops[0] as number)) < 1e-4 && s.y1 < (tops[0] as number) - 1e-4)
			check("a beam into oil at 30° from the vertical: in the oil [CODEX nD 1.4735]", inOil ? Math.atan2(inOil.x1 - inOil.x0, inOil.y0 - inOil.y1) / D : NaN, Math.asin(Math.sin(30 * D) / 1.4735) / D, 0.05, "°")
			check("  then in the water under it (n sin θ kept)", inWater ? Math.atan2(inWater.x1 - inWater.x0, inWater.y0 - inWater.y1) / D : NaN, Math.asin(Math.sin(30 * D) / 1.33299) / D, 0.05, "°")
		}
		// the coin that appears: an opaque jug, a coin on its bottom just hidden behind the rim from an eye, a torch lighting it from above
		const coin = (ml: number) =>
			run([
				{ id: "jug", type: "measuring-jug", x: 1.0, y: 0, props: { fill_ml: ml } },
				{ id: "coin", type: "penny", x: 1.0, y: 0.006, props: {} },
				{ id: "torch", type: "flashlight", x: 1.0, y: 0.45, props: { aim: -90, beam_angle: 20 } },
				{ id: "eye", type: "eye", x: 0.8875, y: 0.29, props: { aim: -66.1 } }
			], 1)
		const seesCoin = (r: ReturnType<typeof run>) => r.events.some((e) => e.kind === "sees" && e.items[0] === "eye" && e.items[1] === "coin")
		truth("the coin: an empty jug's rim hides the coin from the eye", !seesCoin(coin(0)))
		truth("  with 500 mL of water in it, the eye sees the coin (light from it bends over the rim)", seesCoin(coin(500)))
		// a straw or pencil looks broken: light from its tip under water leaves the surface bent away from the vertical (reverse path)
		{
			const r = O.trace({ bodies: lb.bodies, sources: [laserSrc(1.0, 0.1, (90 - 20) * D, 589.3)], pose: lb.pose, segments: true })
			const out = r.segments.find((s) => Math.abs(s.y0 - top) < 1e-6 && s.y1 > top)
			const got = out ? Math.atan2(out.x1 - out.x0, out.y1 - out.y0) : NaN
			check("a pencil's tip under water: its light leaves the surface at asin(n sin 20°) (it looks shallower: bent)", got / D, Math.asin(1.33299 * Math.sin(20 * D)) / D, 0.05, "°")
			const tipX = 1.0
			const seenX = top - 0.1
			// (where an eye looking back down that ray thinks the tip is at the tip's own depth: shifted toward the eye)
			const apparent = (out?.x0 ?? NaN) - seenX * Math.tan(got)
			truth("  the tip seems displaced toward the eye (the pencil looks broken at the surface)", Math.abs(apparent - tipX) > 0.01, `${fmt((apparent - tipX) * 100)} cm`)
		}
		// a glass block of water (the glass-block's water choice)
		{
			const wb = run([{ id: "b", type: "glass-block", x: 0.8, y: 0.3, props: { glass: "water", width: 0.2 } }, { id: "L", type: "laser-pointer", x: 0.45, y: 0.63, props: { aim: -45 } }])
			const rec = wb.doc.processes.find((p: { kind: string }) => p.kind === "optics")
			const solids = new Map(wb.doc.solids.map((s: { id: string }) => [s.id, s]))
			const sc = O.sceneFromRecord(rec, (id: string) => solids.get(id) as never)
			const pose = (id: string) => {
				const s = solids.get(id) as { at: { x: number; y: number }; angle?: number } | undefined
				return s ? { x: s.at.x, y: s.at.y, angle: s.angle ?? 0 } : undefined
			}
			const r = O.trace({ bodies: sc.bodies, sources: [laserSrc(0.6, 0.45, -45 * D, 589.3)], pose, segments: true })
			const g = r.segments.find((s) => Math.abs(s.y0 - 0.33) < 1e-6 && s.y1 < 0.33)
			check("a block of water (glass-block, glass water) at 45°", g ? Math.atan2(g.x1 - g.x0, g.y0 - g.y1) / D : NaN, Math.asin(Math.sin(45 * D) / 1.33299) / D, 0.05, "°")
		}
		// a scene without light items is as before: the tank alone makes no optics record
		const alone = run([{ id: "tank", type: "water-tank", x: 1.0, y: 0, props: {} }])
		truth("a water tank without any light item: no optics record (the document as before)", !alone.doc.processes.some((p: { kind: string }) => p.kind === "optics"))
	},
	lamps() {
		// the circuits module's bulbs and LEDs shine: their light follows the circuit's `light` reading
		const loop = (k: string, x: number, cells: number, meterY = 0.15): Item[] => [
			{ id: `bat${k}`, type: "battery", x, y: 0, props: { cells } },
			{ id: `bulb${k}`, type: "bulb", x: x + 0.2, y: 0, props: {} },
			{ id: `wa${k}`, type: "wire", x: x + 0.1, y: 0, props: { a: `bat${k}`, a_end: "+", b: `bulb${k}`, b_end: "+" } },
			{ id: `wb${k}`, type: "wire", x: x + 0.1, y: 0, props: { a: `bulb${k}`, a_end: "-", b: `bat${k}`, b_end: "-" } },
			{ id: `m${k}`, type: "light-meter", x: x + 0.2, y: meterY, props: { aim: -90 } }
		]
		const r = run([...loop("1", 0.3, 1), ...loop("2", 1.3, 2)], 0.8)
		const rec = r.doc.processes.find((p: { kind: string }) => p.kind === "optics")
		const src = rec?.sources?.find((s: { item: string }) => s.item === "bulb1")
		truth("a circuit bulb is a light source driven by its circuit's light reading", src?.kind === "lamp" && src?.drive?.key === "light", JSON.stringify(src?.drive ?? null))
		const l1 = r.end("bulb1", "light")
		const l2 = r.end("bulb2", "light")
		truth("a bulb on 2 cells reads more lux than one on 1 cell (brighter)", r.end("m2", "lux") > r.end("m1", "lux"), `${fmt(r.end("m2", "lux"))} lx against ${fmt(r.end("m1", "lux"))} lx`)
		check("  the meters' ratio is the bulbs' light ratio (light ∝ the circuit's reading)", r.end("m2", "lux") / r.end("m1", "lux"), l2 / l1, 0.01 * (l2 / l1))
		// the absolute illuminance of a bare bulb: E = Φ·light/(4π d²), Φ = 8.4 lm/W × 0.75 W (the module's rating), d from its glow (where
		// its base rests on the table) to the sensor
		const frames = (r.track as { frames: { placements: Record<string, { y: number }> }[] }).frames
		const base = frames[frames.length - 1]?.placements[src.solid]
		const gy = (base?.y ?? 0) + src.y
		const d = 0.15 - 0.015 - gy
		check("  a bare bulb's illuminance Φ·light/(4π d²) (a sphere of light)", r.end("m1", "lux"), (src.lumens * l1) / (4 * Math.PI * d * d), 0.1 * ((src.lumens * l1) / (4 * Math.PI * d * d)), " lx")
		// 1/d²: the same bulb, meters at d and 2d
		const near = run(loop("1", 0.3, 2, gy + 0.015 + 0.1), 0.6)
		const far = run(loop("1", 0.3, 2, gy + 0.015 + 0.2), 0.6)
		check("  twice as far from a bulb: a quarter of the light (1/d²)", near.end("m1", "lux") / far.end("m1", "lux"), 4, 0.2)
		// a circuit lamp casts a shadow: a ball 25 cm from the bulb and 8 cm above it, a screen 50 cm from it: where the two tangent lines from
		// the glow to the ball meet the screen (a point light)
		const ball = { x: 0.75, y: gy + 0.08 }
		const sx = 1.0
		const sh = run([...loop("1", 0.3, 2).slice(0, 4), { id: "ball", type: "tennis-ball", x: ball.x, y: ball.y, fixed: true, props: {} }, { id: "screen", type: "screen", x: sx + 0.0025, y: gy + 0.17, props: { height: 0.3 } }], 0.6)
		truth("a circuit lamp's shadow falls on a screen", sh.events.some((e) => e.kind === "shadow" && e.items[0] === "ball" && e.items[1] === "screen"))
		const rb = 0.0335
		const phi = Math.atan2(ball.y - gy, ball.x - 0.5)
		const half = Math.asin(rb / Math.hypot(ball.y - gy, ball.x - 0.5))
		const want = (Math.tan(phi + half) - Math.tan(phi - half)) * (sx - 0.5) * 100
		check("  its size where the tangent lines from the glow past the ball meet the screen", sh.end("screen", "shadow_cm"), want, 0.04 * want, " cm")
		// an LED: lit with a resistor in its loop; dark when the loop is open
		const led = (closed: boolean) =>
			run([
				{ id: "bat", type: "battery", x: 0.3, y: 0, props: { cells: 2 } },
				{ id: "res", type: "resistor", x: 0.45, y: 0, props: {} },
				{ id: "led", type: "led", x: 0.6, y: 0, props: { color: "green" } },
				{ id: "w1", type: "wire", x: 0.4, y: 0, props: { a: "bat", a_end: "+", b: "res", b_end: "+" } },
				{ id: "w2", type: "wire", x: 0.5, y: 0, props: { a: "res", a_end: "-", b: "led", b_end: "+" } },
				...(closed ? [{ id: "w3", type: "wire", x: 0.45, y: 0, props: { a: "led", a_end: "-", b: "bat", b_end: "-" } }] : []),
				{ id: "m", type: "light-meter", x: 0.6, y: 0.12, props: { aim: -90 } }
			], 0.6)
		const on = led(true)
		truth("a green LED in a closed loop lights a meter above it", on.end("m", "lux") > 10, `${fmt(on.end("m", "lux"))} lx at light ${fmt(on.end("led", "light"))}`)
		check("  with the loop open it stays dark", led(false).end("m", "lux"), 0, 1e-9, " lx")
	},
	colour() {
		// one-colour torches: their light in their own bands [SCHUBERT]
		const share = (light: string, bands: number[]) => {
			const s = O.sourceSpectrum({ kind: light as never, lumens: 100 })
			let all = 0
			let mine = 0
			for (let b = 0; b < 7; b++) {
				all += s[b] as number
				if (bands.includes(b)) mine += s[b] as number
			}
			return mine / all
		}
		truth("a red torch's light is red and orange (590-750 nm)", share("led-red", [5, 6]) > 0.98, fmt(share("led-red", [5, 6])))
		truth("a green torch's light is cyan to yellow (495-590 nm)", share("led-green", [2, 3, 4]) > 0.95, fmt(share("led-green", [2, 3, 4])))
		truth("a blue torch's light is violet to cyan (380-520 nm)", share("led-blue", [0, 1, 2]) > 0.95, fmt(share("led-blue", [0, 1, 2])))
		// the balanced torches (red 40, green 100, blue 10 lm: BT.2020's white balance) mix to white; pairs to yellow, magenta, cyan
		const mix = (...ls: [string, number][]) => {
			const out = [0, 0, 0, 0, 0, 0, 0]
			for (const [light, lm] of ls) {
				const s = O.sourceSpectrum({ kind: light as never, lumens: lm })
				for (let b = 0; b < 7; b++) out[b] += s[b] as number
			}
			return plug.colourWord(out)
		}
		truth("red + green + blue torches (40, 100, 10 lm) look white", mix(["led-red", 40], ["led-green", 100], ["led-blue", 10]) === "white", mix(["led-red", 40], ["led-green", 100], ["led-blue", 10]))
		truth("  red + green look yellow", mix(["led-red", 40], ["led-green", 100]) === "yellow", mix(["led-red", 40], ["led-green", 100]))
		truth("  red + blue look magenta", mix(["led-red", 40], ["led-blue", 10]) === "magenta", mix(["led-red", 40], ["led-blue", 10]))
		truth("  green + blue look cyan", mix(["led-green", 100], ["led-blue", 10]) === "cyan", mix(["led-green", 100], ["led-blue", 10]))
		truth("  a white torch looks white; an incandescent lamp warm white", mix(["led", 150]) === "white" && mix(["incandescent", 800]) === "warm white", `${mix(["led", 150])}, ${mix(["incandescent", 800])}`)
		// colour filters on coloured torches
		const lane = (color: string, filter: string | null, y: number, k: string): Item[] => [
			{ id: `t${k}`, type: "flashlight", x: 0, y, props: { color, beam_angle: 10 } },
			...(filter ? [{ id: `f${k}`, type: "color-filter", x: 0.4, y, props: { color: filter } }] : []),
			{ id: `m${k}`, type: "light-meter", x: 0.645, y, props: {} }
		]
		const res = run([...lane("red", null, 0.2, "0"), ...lane("red", "red", 0.5, "1"), ...lane("red", "green", 0.8, "2")])
		truth("a red torch through a red filter: most of it gets through (≈ 0.88 in red)", res.end("m1", "lux") / res.end("m0", "lux") > 0.7, fmt(res.end("m1", "lux") / res.end("m0", "lux")))
		truth("  through a green filter: almost nothing (≈ 0.02-0.05)", res.end("m2", "lux") / res.end("m0", "lux") < 0.06, fmt(res.end("m2", "lux") / res.end("m0", "lux")))
		// coloured shadows: a red and a green torch from two sides of a ball: where the red light is shadowed the green still lands
		const aimAt = Math.atan2(0.1, 0.4 - 0.076) / D
		const items: Item[] = [
			{ id: "red", type: "flashlight", x: 0.1, y: 0.22, props: { color: "red", beam_angle: 50, aim: aimAt } },
			{ id: "green", type: "flashlight", x: 0.1, y: 0.42, props: { color: "green", beam_angle: 50, aim: -aimAt } },
			{ id: "ball", type: "tennis-ball", x: 0.5, y: 0.32, fixed: true, props: {} },
			{ id: "screen", type: "screen", x: 1.0, y: 0.32, props: { height: 0.6 } }
		]
		const both = run(items)
		const rec = both.doc.processes.find((p: { kind: string }) => p.kind === "optics")
		const solids = new Map(both.doc.solids.map((s: { id: string }) => [s.id, s]))
		const sc = O.sceneFromRecord(rec, (id: string) => solids.get(id) as never)
		const pose = (id: string) => {
			const s = solids.get(id) as { at: { x: number; y: number }; angle?: number } | undefined
			return s ? { x: s.at.x, y: s.at.y, angle: s.angle ?? 0 } : undefined
		}
		// the red light's shadow of the ball on the screen (its face toward the torches): where the tangent lines from the red torch's lens meet it
		const lens = { x: 0.1 + 0.076 * Math.cos(aimAt * D), y: 0.22 + 0.076 * Math.sin(aimAt * D) }
		const ph = Math.atan2(0.32 - lens.y, 0.5 - lens.x)
		const hf = Math.asin(0.0335 / Math.hypot(0.32 - lens.y, 0.5 - lens.x))
		const face = 1.0 - 0.0025
		const lo = lens.y + Math.tan(ph - hf) * (face - lens.x)
		const hi = lens.y + Math.tan(ph + hf) * (face - lens.x)
		const all = O.trace({ bodies: sc.bodies, sources: sc.sources, pose })
		const onScreen = all.deposits.filter((d) => !d.volume && sc.bodies[d.body]?.item === "screen" && Math.abs(d.x - face) < 1e-6)
		const inShadow = onScreen.filter((d) => d.y > lo + 0.003 && d.y < hi - 0.003)
		truth("coloured shadows: the ball's shadow in the red light is lit only by the green torch (a green shadow)", inShadow.length > 0 && inShadow.every((d) => sc.sources[d.src]?.item === "green"), `${inShadow.length} spots between y ${fmt(lo)} and ${fmt(hi)} m, from ${[...new Set(inShadow.map((d) => sc.sources[d.src]?.item))].join(", ")}`)
		truth("  and the red light lands beside it (above and below)", onScreen.some((d) => sc.sources[d.src]?.item === "red" && d.y < lo) && onScreen.some((d) => sc.sources[d.src]?.item === "red" && d.y > hi))
		truth("  the ball casts a shadow on the screen", both.events.some((e) => e.kind === "shadow" && e.items[0] === "ball"))
	},
	blink() {
		// a blinking torch: Morse code (ITU-R M.1677-1) sent and read back by a light target
		const sos = O.blinkOn as (b: number[], r: boolean, t: number) => number
		const pat = [0.2, 0.2, 0.2, 0.2, 0.2, 0.6, 0.6, 0.2, 0.6, 0.2, 0.6, 0.6, 0.2, 0.2, 0.2, 0.2, 0.2, 2]
		truth("blink pattern: on in its first dot, off between dots, on in a dash, off in the 10-dot gap, on again when repeated", sos(pat, true, 0.1) === 1 && sos(pat, true, 0.3) === 0 && sos(pat, true, 1.7) === 1 && sos(pat, true, 6.3) === 0 && sos(pat, true, 7.5) === 1 && sos(pat, false, 7.5) === 0)
		const send = (pattern: string, seconds: number, block = false, receiver = "light-sensor") => {
			const scene = { version: 2, id: "v", name: "v", seconds, release: 0.5, stage: { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} },
				{ id: "torch", type: "flashlight", x: 0.2, y: 0.3, props: { pattern, beam_angle: 10 } }, { id: "rx", type: receiver, x: 1.2, y: 0.3, props: {} },
				...(block ? [{ id: "card", type: "material-panel", x: 0.7, y: 0.3, props: { sample: "cardboard", size: 0.2 } }] : [])], goals: [{ kind: "receives", sensor: "rx", light: "torch" }] }
			const { scene: s0, doc, resolved } = sim.prepare(scene)
			const { scene: s } = admitDocument(doc)
			const track = simulate(s, 120) as never
			return { track: track as { state: Record<string, Record<string, number[]>>; frames: { t: number }[] }, goal: sim.finish(s0, doc, resolved, track).summary.goals[0] }
		}
		const a = send("SOS", 6)
		truth("SOS from a torch 1 m away reads back as SOS at a light target (receives)", a.goal?.ok === true && a.goal?.got === "SOS", JSON.stringify(a.goal))
		const hit = a.track.state.rx?.hit ?? []
		const pulses = a.track.state.rx?.pulses ?? []
		check("  the target counts 9 flashes (3 dots, 3 dashes, 3 dots)", pulses[pulses.length - 1] as number, 9, 0)
		// the on-times it saw: each within a frame (1/120 s) of the code's (a dot 0.2 s, a dash 0.6 s)
		const ons: number[] = []
		let start = -1
		hit.forEach((v, i) => {
			const t = a.track.frames[i]?.t ?? 0
			if (v === 1 && start < 0) start = t
			if (v !== 1 && start >= 0) {
				ons.push(t - start)
				start = -1
			}
		})
		const want = [0.2, 0.2, 0.2, 0.6, 0.6, 0.6, 0.2, 0.2, 0.2]
		check("  each flash as long as its sign (worst error, s)", Math.max(...want.map((w, i) => Math.abs((ons[i] ?? 0) - w))), 0, 1 / 120 + 1e-9, " s")
		truth("1s and 0s (1100101) read back the same", send("1100101", 3).goal?.got === "1100101")
		truth("a light meter reads it back too", send("HI", 3, false, "light-meter").goal?.ok === true)
		const blocked = send("SOS", 6, true)
		truth("with cardboard in the way nothing gets through (not received)", blocked.goal?.ok === false && (blocked.track.state.rx?.pulses ?? [0]).every((v) => v === 0))
	},
	fuzzx() {
		// random scenes of light items with liquids, circuit lamps and blinking torches: no exceptions, no non-finite readings
		let seed = 4242
		const rnd = () => {
			seed = (Math.imul(seed, 1103515245) + 12345) | 0
			return ((seed >>> 0) % 1000003) / 1000003
		}
		const types = ["flashlight", "laser-pointer", "mirror", "light-meter", "light-sensor", "eye", "screen", "glass-block", "water-tank", "beaker", "graduated-cylinder", "measuring-jug", "density-column", "penny", "pebble", "chopstick", "bulb", "led", "battery", "wire"]
		const N = Number(process.env.FUZZ_N ?? 80)
		let bad = 0
		let worstMs = 0
		for (let k = 0; k < N; k++) {
			const items: Item[] = []
			const n = 3 + Math.floor(rnd() * 7)
			for (let i = 0; i < n; i++) {
				const type = types[Math.floor(rnd() * types.length)] as string
				const props: Record<string, unknown> = {}
				if (rnd() < 0.6) props.aim = Math.round(rnd() * 720 - 360)
				if (type === "flashlight") Object.assign(props, { color: ["white", "red", "green", "blue"][Math.floor(rnd() * 4)], pattern: ["steady", "SOS", "101", "x y", ""][Math.floor(rnd() * 5)], dot_s: 0.05 + rnd() })
				if (type === "water-tank") Object.assign(props, { style: ["aquarium", "tub", "trough"][Math.floor(rnd() * 3)], liquid: ["water", "salt water", "vegetable oil", "honey"][Math.floor(rnd() * 4)], fill: rnd() * 0.3 })
				if (type === "wire") Object.assign(props, { a: `i${Math.floor(rnd() * n)}`, b: `i${Math.floor(rnd() * n)}`, a_end: rnd() < 0.5 ? "+" : "-", b_end: rnd() < 0.5 ? "+" : "-" })
				items.push({ id: `i${i}`, type, x: rnd() * 2.8 - 0.3, y: type === "water-tank" || type === "beaker" || type === "battery" || type === "bulb" ? 0 : rnd() * 1.0 + 0.02, props })
			}
			try {
				const res = run(items, 0.7)
				worstMs = Math.max(worstMs, res.ms)
				for (const keys of Object.values(res.track.state ?? {})) for (const v of Object.values(keys)) if (v.some((x) => x !== null && !Number.isFinite(x))) bad++
			} catch (e) {
				bad++
				console.log("  fuzz scene", k, String(e).slice(0, 200))
			}
		}
		truth(`fuzz: ${N} random scenes with liquids, circuit lamps and blinking torches, no exceptions or non-finite readings`, bad === 0, `${bad} bad; slowest run ${fmt(worstMs)} ms`)
	}
}

const want = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const names = want.length === 0 || want.includes("all") ? Object.keys(GROUPS) : want
for (const g of names) {
	const fn = GROUPS[g]
	if (!fn) {
		console.log(`no group ${g} (groups: ${Object.keys(GROUPS).join(" ")})`)
		process.exit(2)
	}
	console.log(`---- ${g}`)
	fn()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
