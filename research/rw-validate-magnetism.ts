// The magnetism module against real reference values (tooling/src/sim/magnetism.ts, modules/magnetism.ts; machines/mod_magnetism.py and its port
// web/sim/modules/magnetism.js build the scenes). The core's pieces are checked against closed forms and independent numerical integrals, the
// scenes (built through web/sim, run in the engine with the bundle's math) against textbook physics and the lesson demos:
//   math      its own ln and atan (Math.log and Math.atan are not the same on every machine) within 1 ulp of V8's, the same bits twice
//   rect      the exact field of a uniformly charged rectangle against a 400 × 400 numerical integral of Coulomb's law
//   demag     demagnetizing factors: a cube 1/3 each [AHARONI], N_x + N_y + N_z = 1, and the closed form against the volume average of the
//             faces' own field (an independent numerical integral) for 1:1:2 and 1:1:5 prisms and a paper clip's wire bundle
//   pair      two 10 mm N42 cubes (B_r 1.3 T [NdFeB]) coaxial: the engine's force against Akoun & Yonnet's closed form [AY] for its own model (faces
//             SKIN out, charge scaled to keep the moment) at 1.5-40 mm, and against the real cubes [AY] where the skin no longer matters (≥ 20 mm);
//             off axis (a sideways force too), and the force at the contact skins' resting gap against the real cubes touching [AY]
//   far       G8: the pull between two bars falls off as 1/distance⁴ far away (coaxial dipoles, F = 3µ0 m²/(2π z⁴) [GRIFFITHS])
//   third     G10: every pair pushes both its solids equally and oppositely (random poses of a bar, a horseshoe, a disc and a washer)
//   sphere    a small steel ball near a magnet: the engine's pull against the induced-dipole law F = ½µ0 χ_eff V ∇|H|², χ_eff = 1/(⅓ + 1/χ) for a
//             sphere [JACKSON §5.11, FURLANI]; long soft rods (a nail, a clip's wire, a 10 cm rod) in a uniform field against a volume-integral
//             solve (VIS: the rod in 120 uniformly magnetized cells), and a nail end-on to a pole: the engine's rows (24 cells, `rowModel`)
//   upright   an upright nail under a ceramic bar lying flat against a converged solve with both components of magnetization (VIS2): the engine
//             within 0.8-1.25; the bar stood on its end lifts it from 15 mm, not 20 mm; a flat nail past the pole's corner (known limit, said)
//   chain     clips end to end: two and four in a uniform field, and the electromagnet's nail (10, 50, 200 turns) with a chain under its point,
//             against the converged VIS of the whole chain (1 mm cells, every body's charge sheets): each body's magnetization, the pulls
//   nonmag    G3: plastic, aluminium foil, brass, wood and copper beside a neodymium magnet: no magnetism record at all, they never move; the steel
//             clip, washer and nail are pulled to it
//   barrier   G4: a held clip's pull through cardboard, paper, plastic, glass and aluminium sheets is exactly the pull with no sheet; a 0.5 mm
//             steel sheet 8 mm from a ceramic pole cuts it by 70 % or more (its grid takes the pole's field in and runs it off to its edges: a thin
//             permeable sheet passes about 2/(µ_r·t·k) of a field of wavenumber k [JACKSON §5.12]), from a neodymium pole less (it saturates)
//   lift      G1: the jump: a clip under a held bar magnet is lifted where its static pull passes its weight (0.45 g) and not where it does not;
//             a neodymium bar lifts it from farther than a ceramic one
//   rings     G6: floating ring magnets: each gap against the coaxial-dipole equilibrium 3µ0 m²/(2π z⁴) = the weight above [GRIFFITHS]
//   compass   G7: Earth's 20 µT [WMM] turns the needle north (0°); over a bar magnet it points from its north pole to its south (180°); with
//             north to the left alone it points left (180°); a bar flipped level with it on its axis turns it round (180°); a fixed compass turns
//   coulomb   G12: two −100 nC charges 30 cm apart push with k q²/r² [CODATA]; a small conducting ball by a charge is pulled with 2 k q² R³ / r⁵
//             (its induced dipole, α = 4πε0 R³ [JACKSON §4.4]); paper scraps jump to a rubbed balloon (G11); a pith ball is pulled, touches,
//             takes the rod's sign and is pushed away (P3)
//   coil      the electromagnet's current is Ohm's law with 24 AWG copper (84.2 mΩ/m [AWG]) and AA cells (1.5 V, 0.2 Ω [E91]); more turns hold more
//             clips (10, 50, 200 turns: 1, 2, 3 in a chain; MS-PS2-3); switched off it holds none
//   materials the other modules' steel and iron are magnetic (the matter module's steel density cube is lifted; its aluminium, brass, copper and
//             zinc cubes have no record and never move), their metals conductors (a penny, a stainless spoon get a polar record, ε 0); light
//             non-metal things are polarized as dielectrics (a ping-pong ball rolls to a rubbed balloon, paper and a feather get records); far
//             steel (beyond a magnet's reach: 2 µT) gets no record
//   demos     every lesson demo (tools/parity/fixtures/magnetism-demos.json) has its expected outcome
//   fuzz      random magnetism scenes (every type, random props, poses, held and free): no NaN, nothing faster than 15 m/s, the same track twice
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-magnetism.ts [section ...|all]     exits 1 on any failure
// Sources:
//   [AY]       G. Akoun, J.-P. Yonnet, "3D analytical calculation of the forces exerted between two cuboidal magnets", IEEE Trans. Magn. 20(5),
//              1962-1964 (1984)
//   [AHARONI]  A. Aharoni, "Demagnetizing factors for rectangular ferromagnetic prisms", J. Appl. Phys. 83, 3432 (1998)
//   [JACKSON]  J. D. Jackson, Classical Electrodynamics, 3rd ed. (1999): §4.4 (a conducting sphere in a field), §5.10-5.11 (magnetized spheres)
//   [FURLANI]  E. P. Furlani, Permanent Magnet and Electromechanical Devices (Academic Press, 2001), ch. 2-3 (the charge model)
//   [GRIFFITHS] D. J. Griffiths, Introduction to Electrodynamics, 4th ed. (2017), §6.1 and problem 6.3 (force between two dipoles)
//   [CODATA]   CODATA 2018: µ0 = 1.25663706212e-6 N/A², ε0 = 8.8541878128e-12 F/m
//   [NdFeB]    sintered N42 NdFeB: B_r 1.28-1.32 T (Arnold Magnetic Technologies N42 data sheet)
//   [WMM]      NOAA/BGS World Magnetic Model 2020: horizontal intensity about 20 µT over the contiguous United States
//   [AWG]      ASTM B258; NEC chapter 9 table 8: 24 AWG copper 0.511 mm, 84.2 mΩ/m at 20 °C
//   [E91]      Energizer E91 (AA alkaline) data sheet: 1.5 V, internal resistance 0.15-0.3 Ω
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { atan, createFields, demagFactors, ln, MU0, prismDemag, rectField, type FaceSpec } from "../tooling/src/sim/magnetism.ts"

const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
type Track = { frames: { t: number; placements: Record<string, { x: number; y: number; angle: number }> }[]; state?: Record<string, Record<string, number[]>>; events?: { t: number; text: string }[] }
type Summary = { goals: { ok: boolean; label: string; [k: string]: unknown }[]; readings?: Record<string, Record<string, number>>; happenings?: { t: number; text: string }[] }
type Doc = { solids: { id: string; item: string; kind: string; at: { x: number; y: number }; body: Record<string, unknown> }[]; processes?: { kind: string; role: string; item: string; solid?: string; faces?: FaceSpec[] }[] }
const web = (await import(pathToFileURL(`${PG}/web/sim/index.js`).href)) as {
	prepare: (s: unknown) => { scene: unknown; doc: Doc; resolved: unknown }
	finish: (s: unknown, d: unknown, r: unknown, t: unknown) => { summary: Summary }
	ready?: Promise<unknown>
}
if (web.ready) await web.ready
const { run } = (await import(pathToFileURL(`${PG}/tools/engine-worker-entry.ts`).href)) as { run: (doc: unknown, fps: number) => Track }

let failed = 0
let passed = 0
const check = (ok: boolean, what: string, detail = "") => {
	if (ok) passed++
	else failed++
	console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b))
const pct = (a: number, b: number) => `${((a / b - 1) * 100).toFixed(2)} %`
const g4 = (v: number) => Number(v).toPrecision(4)
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
type Item = { id: string; type: string; name?: string; x: number; y: number; angle?: number; props?: Record<string, unknown>; fixed?: boolean; held?: boolean }
const scene = (items: Item[], seconds = 2, goals: unknown[] = [], release = 0.3) => ({ version: 2, id: "v", name: "v", seconds, release, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })
const go = (s: unknown) => {
	const p = web.prepare(s)
	const track = JSON.parse(JSON.stringify(run(p.doc, 120))) as Track
	const { summary } = web.finish(p.scene, p.doc, p.resolved, track)
	const end = (item: string, key: string) => (track.state?.[item]?.[key] ?? []).at(-1) as number
	const pose = (sid: string, k = -1) => {
		const fr = track.frames
		const i = k < 0 ? fr.length + k : k
		for (let j = i; j >= 0; j--) if (fr[j].placements[sid]) return fr[j].placements[sid]
		return undefined
	}
	return { doc: p.doc, track, summary, end, pose, json: JSON.stringify(track) }
}
const DEMOS = JSON.parse(readFileSync(`${PG}/tools/parity/fixtures/magnetism-demos.json`, "utf8")) as (ReturnType<typeof scene> & { expect?: boolean[] })[]
const demo = (id: string) => JSON.parse(JSON.stringify(DEMOS.find((d) => d.id === id))) as ReturnType<typeof scene> & { expect?: boolean[] }
const K = 8.9875517923e9 // 1/(4π ε0) [CODATA]
const NAIL_LO = 0.8
const NAIL_HI = 1.25
const G = 9.81

// ---------------------------------------------------------------- sections
const sections: Record<string, () => void> = {
	math() {
		const f = new Float64Array(2)
		const b = new BigInt64Array(f.buffer)
		let seed = 12345
		const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648)
		let worstL = 0n
		let worstA = 0n
		for (let i = 0; i < 300000; i++) {
			const x = Math.exp((rnd() - 0.5) * 80) * (1 + rnd())
			f[0] = ln(x)
			f[1] = Math.log(x)
			const d = b[0] > b[1] ? b[0] - b[1] : b[1] - b[0]
			if (d > worstL) worstL = d
			const y = (rnd() - 0.5) * Math.exp((rnd() - 0.5) * 30)
			f[0] = atan(y)
			f[1] = Math.atan(y)
			const e = b[0] > b[1] ? b[0] - b[1] : b[1] - b[0]
			if (e > worstA) worstA = e
		}
		check(worstL <= 1n, "ln within 1 ulp of Math.log (300 000 values over 1e-35..1e35)", `worst ${worstL} ulp`)
		check(worstA <= 1n, "atan within 1 ulp of Math.atan (300 000 values)", `worst ${worstA} ulp`)
		check(ln(1) === 0 && ln(Math.E) === 1 && atan(1) === Math.PI / 4, "ln(1) = 0, ln(e) = 1, atan(1) = π/4 exactly")
	},
	rect() {
		const num = (a: number, bb: number, U: number, V: number, W: number) => {
			let hu = 0
			let hv = 0
			let hw = 0
			const n = 400
			for (let i = 0; i < n; i++)
				for (let j = 0; j < n; j++) {
					const u = -a + (2 * a * (i + 0.5)) / n
					const v = -bb + (2 * bb * (j + 0.5)) / n
					const dx = U - u
					const dy = V - v
					const R = Math.sqrt(dx * dx + dy * dy + W * W)
					const dA = (4 * a * bb) / (n * n)
					hu += (dx / R ** 3) * dA
					hv += (dy / R ** 3) * dA
					hw += (W / R ** 3) * dA
				}
			return [hu, hv, hw]
		}
		let worst = 0
		for (const [U, V, W] of [[0.03, 0.01, 0.02], [-0.01, 0.002, 0.005], [0.2, -0.1, 0.05], [0.004, 0.003, -0.01], [0.0, 0.0, 0.03]]) {
			const e = rectField(0.01, 0.005, U, V, W, new Float64Array(3))
			const n = num(0.01, 0.005, U, V, W)
			const scale = Math.hypot(n[0], n[1], n[2])
			for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(e[k] - n[k]) / scale)
		}
		check(worst < 1e-3, "a charged rectangle's exact field = the numerical integral of Coulomb's law (5 points, all components)", `worst ${(worst * 100).toFixed(4)} % of |H|`)
	},
	demag() {
		const [cx, cy, cz] = demagFactors(1, 1, 1)
		check(Math.abs(cx - 1 / 3) < 1e-12 && Math.abs(cy - 1 / 3) < 1e-12 && Math.abs(cz - 1 / 3) < 1e-12, "a cube's factors are 1/3 each [AHARONI]", `${cx}, ${cy}, ${cz}`)
		let sumWorst = 0
		for (const [a, b, c] of [[2, 1, 1], [5, 1, 1], [10, 10, 1], [0.075, 0.003, 0.003], [0.033, 0.008, 0.0009], [0.15, 0.019, 0.009]]) {
			const n = demagFactors(a, b, c)
			sumWorst = Math.max(sumWorst, Math.abs(n[0] + n[1] + n[2] - 1))
		}
		check(sumWorst < 1e-12, "N_x + N_y + N_z = 1 for six prisms (rods, a plate, a nail, a clip's bundle, a bar)", `worst ${sumWorst.toExponential(1)}`)
		// the magnetometric factor along x = −⟨H_x⟩/M over the volume: H from its two end faces (±M), averaged on a grid inside it
		const average = (L: number, h: number, d: number) => {
			const out = new Float64Array(3)
			let sum = 0
			const nx = 400
			const ny = 10
			const nz = 10
			for (let i = 0; i < nx; i++)
				for (let j = 0; j < ny; j++)
					for (let k = 0; k < nz; k++) {
						const x = -L / 2 + (L * (i + 0.5)) / nx
						const y = -h / 2 + (h * (j + 0.5)) / ny
						const z = -d / 2 + (d * (k + 0.5)) / nz
						rectField(h / 2, d / 2, y, z, x - L / 2, out) // the +M face at x = L/2 (its normal +x)
						let hx = out[2]
						rectField(h / 2, d / 2, y, z, x + L / 2, out) // the −M face at x = −L/2
						hx -= out[2]
						sum += hx / (4 * Math.PI)
					}
			return -sum / (nx * ny * nz)
		}
		let worst = 0
		const rows: string[] = []
		for (const [L, h, d] of [[2, 1, 1], [5, 1, 1], [0.033, 0.0019, 0.0019]]) {
			const closed = prismDemag(h, d, L)
			const avg = average(L, h, d)
			worst = Math.max(worst, rel(closed, avg))
			rows.push(`${L}:${h}:${d} ${g4(closed)} vs ${g4(avg)}`)
		}
		check(worst < 0.01, "Aharoni's closed form = the volume average of the faces' own field (an independent integral)", `${rows.join("; ")}; worst ${(worst * 100).toFixed(2)} %`)
	},
	pair() {
		// Akoun & Yonnet: two cuboids magnetized along z, the first 2a×2b×2c at the origin, the second 2A×2B×2C at (al, be, ga); J, J2 in T
		const ay = (a: number, b: number, c: number, A: number, B: number, C: number, al: number, be: number, ga: number, J: number, J2: number) => {
			let fx = 0
			let fy = 0
			let fz = 0
			const L = (x: number) => (x > 0 ? Math.log(x) : 0)
			const at = (x: number, y: number) => (y === 0 ? 0 : Math.atan(x / y))
			for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) for (const l of [0, 1]) for (const p of [0, 1]) for (const q of [0, 1]) {
				const u = al + (-1) ** j * A - (-1) ** i * a
				const v = be + (-1) ** l * B - (-1) ** k * b
				const w = ga + (-1) ** q * C - (-1) ** p * c
				const r = Math.sqrt(u * u + v * v + w * w)
				const s = (-1) ** (i + j + k + l + p + q)
				fx += s * (0.5 * (v * v - w * w) * L(r - u) + u * v * L(r - v) + v * w * at(u * v, r * w) + 0.5 * r * u)
				fy += s * (0.5 * (u * u - w * w) * L(r - v) + u * v * L(r - u) + u * w * at(u * v, r * w) + 0.5 * r * v)
				fz += s * (-u * w * L(r - u) - v * w * L(r - v) + u * v * at(u * v, r * w) - r * w)
			}
			const kk = (J * J2) / (4 * Math.PI * MU0)
			return [kk * fx, kk * fy, kk * fz]
		}
		const s = 0.01
		const Br = 1.3
		const M = Br / MU0
		const SKIN = 0.0007
		const cube = (sigma = M): FaceSpec[] => [
			{ x: s / 2, y: 0, angle: 0, width: s, depth: s, sigma },
			{ x: -s / 2, y: 0, angle: Math.PI, width: s, depth: s, sigma: -sigma }
		]
		// the engine: B's pose (x, y) with A at the origin, both magnetized along +x; the force on B (engine x ↔ AY z, engine y ↔ AY y)
		const engine = (x: number, y: number) => {
			const f = createFields({ magnets: [{ solid: "A", faces: cube() }, { solid: "B", faces: cube() }] })
			const got: Record<string, number[]> = {}
			f.step(0, (id) => (id === "A" ? { x: 0, y: 0, angle: 0 } : { x, y, angle: 0 }), (sid, fx, fy) => {
				const g = (got[sid] ??= [0, 0])
				g[0] += fx
				g[1] += fy
			})
			return got
		}
		// the model's cubes: their pole faces SKIN out, the charge scaled by s/(s + 2·SKIN)
		const t = s + 2 * SKIN
		const J = (Br * s) / t
		let worst = 0
		const rows: string[] = []
		for (const g of [0.0015, 0.002, 0.005, 0.01, 0.02, 0.04]) {
			const e = engine(s + g, 0).B[0]
			const ref = ay(s / 2, s / 2, t / 2, s / 2, s / 2, t / 2, 0, 0, s + g, J, J)[2]
			worst = Math.max(worst, rel(e, ref))
			rows.push(`${g * 1000} mm ${g4(e)} N vs ${g4(ref)} N`)
		}
		check(worst < 0.03, "coaxial cubes: the engine = Akoun & Yonnet for its model (faces 0.7 mm out, moment kept) [AY]", `${rows.join("; ")}; worst ${(worst * 100).toFixed(2)} %`)
		let worstReal = 0
		const real: string[] = []
		for (const g of [0.03, 0.05, 0.08]) {
			const e = engine(s + g, 0).B[0]
			const ref = ay(s / 2, s / 2, s / 2, s / 2, s / 2, s / 2, 0, 0, s + g, Br, Br)[2]
			worstReal = Math.max(worstReal, rel(e, ref))
			real.push(`${g * 1000} mm ${g4(e)} vs ${g4(ref)} N`)
		}
		check(worstReal < 0.03, "coaxial cubes 3-8 cm apart: the engine = the real N42 cubes [AY][NdFeB]", `${real.join("; ")}; worst ${(worstReal * 100).toFixed(2)} %`)
		// at the contact skins' resting gap (two 1 mm polygon skins + slop: 1.5 mm) the engine pulls nearly as the real cubes touching do
		// (without the skin it would pull as cubes 1.5 mm apart: 69 % of it)
		const rest = engine(s + 0.0015, 0).B[0]
		const touching = ay(s / 2, s / 2, s / 2, s / 2, s / 2, s / 2, 0, 0, s + 0.0001, Br, Br)[2]
		const apart = ay(s / 2, s / 2, s / 2, s / 2, s / 2, s / 2, 0, 0, s + 0.0015, Br, Br)[2]
		check(rest / touching > 0.75 && rest / touching < 1.05 && rest / touching > apart / touching, "resting 1.5 mm apart (the contact skins) the pull is near the real cubes' pull at contact", `${g4(rest)} N vs ${g4(touching)} N touching (${pct(rest, touching)}); real cubes 1.5 mm apart ${g4(apart)} N`)
		// off axis: 4 mm sideways, 3 mm gap: both components
		const off = engine(s + 0.003 + 2 * SKIN, 0.004).B
		const refOff = ay(s / 2, s / 2, t / 2, s / 2, s / 2, t / 2, 0, 0.004, s + 0.003 + 2 * SKIN, J, J)
		check(rel(off[0], refOff[2]) < 0.03 && rel(off[1], refOff[1]) < 0.05, "off axis (4 mm sideways): the pull and the sideways force [AY]", `along ${g4(off[0])} vs ${g4(refOff[2])} N, sideways ${g4(off[1])} vs ${g4(refOff[1])} N`)
	},
	far() {
		// two 10 cm × 1.9 × 0.9 cm bars coaxial 30-60 cm apart (centres): log F vs log z
		const bar = (L: number, sigma: number): FaceSpec[] => [
			{ x: L / 2, y: 0, angle: 0, width: 0.019, depth: 0.009, sigma },
			{ x: -L / 2, y: 0, angle: Math.PI, width: 0.019, depth: 0.009, sigma: -sigma }
		]
		const M = 0.39 / MU0
		const F = (z: number) => {
			const f = createFields({ magnets: [{ solid: "A", faces: bar(0.1, M) }, { solid: "B", faces: bar(0.1, M) }] })
			let fx = 0
			f.step(0, (id) => (id === "A" ? { x: 0, y: 0, angle: 0 } : { x: z, y: 0, angle: 0 }), (sid, x) => {
				if (sid === "B") fx += x
			})
			return Math.abs(fx)
		}
		const z1 = 0.6
		const z2 = 1.2
		const slope = Math.log(F(z2) / F(z1)) / Math.log(z2 / z1)
		check(Math.abs(slope + 4) < 0.15, "G8: far apart the pull falls off as 1/distance⁴ (dipoles) [GRIFFITHS]", `slope ${slope.toFixed(3)} between 60 cm and 1.2 m`)
		const m = M * 0.1 * 0.019 * 0.009
		const dip = (3 * MU0 * m * m) / (2 * Math.PI * z2 ** 4)
		check(rel(F(z2), dip) < 0.03, "at 1.2 m the pull is the coaxial dipoles' 3µ0 m²/(2π z⁴) [GRIFFITHS]", `${g4(F(z2))} N vs ${g4(dip)} N`)
	},
	third() {
		const M = 0.39 / MU0
		const bar: FaceSpec[] = [
			{ x: 0.075, y: 0, angle: 0, width: 0.019, depth: 0.009, sigma: M },
			{ x: -0.075, y: 0, angle: Math.PI, width: 0.019, depth: 0.009, sigma: -M }
		]
		const shoe: FaceSpec[] = [
			{ x: -0.02, y: -0.03, angle: -Math.PI / 2, width: 0.012, depth: 0.01, sigma: M * 2.5 },
			{ x: 0.02, y: -0.03, angle: -Math.PI / 2, width: 0.012, depth: 0.01, sigma: -M * 2.5 }
		]
		const disc: FaceSpec[] = [
			{ x: 0, y: 0.0025, angle: Math.PI / 2, width: 0.018, depth: 0.018, sigma: M },
			{ x: 0, y: -0.0025, angle: -Math.PI / 2, width: 0.018, depth: 0.018, sigma: -M }
		]
		let seed = 7
		const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648)
		let worst = 0
		let n = 0
		for (let k = 0; k < 60; k++) {
			const f = createFields({
				magnets: [{ solid: "bar", faces: bar }, { solid: "shoe", faces: shoe }, { solid: "disc", faces: disc }],
				soft: [{ solid: "washer", x: 0, y: 0, w: 0.016, h: 0.0016, d: 0.016, volume: 2.2e-7, ms: 1.6e6, chi: 1000 }]
			})
			const poses: Record<string, { x: number; y: number; angle: number }> = {}
			for (const id of ["bar", "shoe", "disc", "washer"]) poses[id] = { x: (rnd() - 0.5) * 0.4, y: (rnd() - 0.5) * 0.4, angle: rnd() * 6.283 }
			let sx = 0
			let sy = 0
			let mag = 0
			f.settle(0, (id) => poses[id])
			f.step(0, (id) => poses[id], (_, fx, fy) => {
				sx += fx
				sy += fy
				mag += Math.hypot(fx, fy)
			})
			if (mag > 0) {
				worst = Math.max(worst, Math.hypot(sx, sy) / mag)
				n++
			}
		}
		check(worst < 1e-9, "G10: the forces on all the solids add up to zero: each pull has its equal and opposite pull (60 random poses)", `${n} poses, worst |ΣF|/Σ|F| ${worst.toExponential(1)}`)
	},
	sphere() {
		const s = 0.01
		const M = 1.3 / MU0
		const cube: FaceSpec[] = [
			{ x: s / 2, y: 0, angle: 0, width: s, depth: s, sigma: M },
			{ x: -s / 2, y: 0, angle: Math.PI, width: s, depth: s, sigma: -M }
		]
		const r = 0.0025
		const V = (4 / 3) * Math.PI * r ** 3
		const side = Math.cbrt(V)
		const chi = 1000
		let worst = 0
		const rows: string[] = []
		for (const d of [0.008, 0.012, 0.02, 0.03]) {
			const f = createFields({ magnets: [{ solid: "A", faces: cube }], soft: [{ solid: "ball", x: 0, y: 0, w: side, h: side, d: side, round: true, volume: V, ms: 1.7e6, chi }] })
			const pose = (id: string) => (id === "A" ? { x: 0, y: 0, angle: 0 } : { x: s / 2 + 0.0007 + d, y: 0, angle: 0 })
			f.settle(0, pose)
			let fx = 0
			f.step(0, pose, (sid, x) => {
				if (sid === "ball") fx += x
			})
			const only = createFields({ magnets: [{ solid: "A", faces: cube }] })
			only.step(0, pose, () => {})
			const H = (x: number) => only.fieldB(x, 0)[0] / MU0
			const x0 = s / 2 + 0.0007 + d
			const h = 1e-5
			const grad = (H(x0 + h) ** 2 - H(x0 - h) ** 2) / (2 * h)
			const keff = 1 / (1 / 3 + 1 / chi)
			const ref = 0.5 * MU0 * keff * V * grad
			worst = Math.max(worst, rel(fx, ref))
			rows.push(`${d * 1000} mm ${g4(fx)} vs ${g4(ref)} N`)
		}
		check(worst < 0.03, "a 5 mm steel ball near an N42 cube: pulled as an induced dipole, χ_eff = 1/(⅓ + 1/χ) [JACKSON §5.11]", `${rows.join("; ")}; worst ${(worst * 100).toFixed(2)} %`)
		// soft rods against a volume-integral solve (VIS): the rod cut into cells along its length, each uniformly magnetized, every cell's field
		// from every charge sheet averaged over it (4 × 3 × 3 Gauss points), solved with saturation; its pull is the sheets' charge in the
		// magnet's field. The converged VIS (120 cells) is the real rod, which gathers its charge toward its ends; the engine's row (24 cells of
		// a Chebyshev partition with exact mutual factors) must give it
		const fine = (L: number, h: number, n: number, xc: number, Hext: (x: number, y: number, z: number) => number, Ms = Infinity) => {
			const out = new Float64Array(3)
			const gx = [-0.861136, -0.339981, 0.339981, 0.861136]
			const wx = [0.347855, 0.652145, 0.652145, 0.347855]
			const g3 = [-0.774597, 0, 0.774597]
			const w3 = [0.555556, 0.888889, 0.555556]
			const xs = Array.from({ length: n + 1 }, (_, k) => xc - L / 2 + (L * k) / n)
			const A = xs.map(() => new Float64Array(n))
			const H0 = new Float64Array(n)
			for (let i = 0; i < n; i++) {
				const c = (xs[i] + xs[i + 1]) / 2
				const hl = L / (2 * n)
				for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) for (let e = 0; e < 3; e++) H0[i] += (wx[a] * w3[b] * w3[e] * Hext(c + gx[a] * hl, (g3[b] * h) / 2, (g3[e] * h) / 2)) / 8
				for (let k = 0; k <= n; k++) {
					let sum = 0
					for (let a = 0; a < 4; a++)
						for (let b = 0; b < 3; b++)
							for (let e = 0; e < 3; e++) {
								rectField(h / 2, h / 2, (g3[b] * h) / 2, (g3[e] * h) / 2, c + gx[a] * hl - xs[k], out)
								sum += (wx[a] * w3[b] * w3[e] * out[2]) / (4 * Math.PI)
							}
					A[k][i] = sum / 8
				}
			}
			const M = new Float64Array(n)
			for (let it = 0; it < 6000; it++) {
				let delta = 0
				let big = 0
				for (let i = 0; i < n; i++) {
					let H = H0[i]
					for (let j = 0; j < n; j++) if (j !== i) H += (A[j + 1][i] - A[j][i]) * M[j]
					const self = A[i + 1][i] - A[i][i]
					let m = (chi * H) / (1 - chi * self)
					if (Math.abs(m) > Ms) m = Math.sign(m) * Ms
					const nm = M[i] + 0.8 * (m - M[i])
					delta = Math.max(delta, Math.abs(nm - M[i]))
					big = Math.max(big, Math.abs(nm))
					M[i] = nm
				}
				if (delta < 1e-7 * (1 + big)) break
			}
			let F = 0
			for (let k = 0; k <= n; k++) {
				const sig = (k > 0 ? M[k - 1] : 0) - (k < n ? M[k] : 0)
				let he = 0
				for (let b = 0; b < 3; b++) for (let e = 0; e < 3; e++) he += (w3[b] * w3[e] * Hext(xs[k], (g3[b] * h) / 2, (g3[e] * h) / 2)) / 4
				F += MU0 * sig * h * h * he
			}
			return { mean: M.reduce((q, v) => q + v, 0) / n, F }
		}
		const Hu = 1000
		const rr: string[] = []
		let worstRod = 0
		for (const [w, h] of [[0.051, 0.0029], [0.033, 0.0019], [0.1, 0.01]]) {
			const f = createFields({ soft: [{ solid: "r", x: 0, y: 0, w, h, d: h, volume: w * h * h, ms: 1.6e6, chi }], earth: { x: Hu * MU0, y: 0 } })
			for (let k = 0; k < 200; k++) f.step(k / 480, () => ({ x: 0, y: 0, angle: 0 }), () => {})
			const got = f.state().soft.r[0]
			const real = fine(w, h, 120, 0, () => Hu).mean
			worstRod = Math.max(worstRod, rel(got, real))
			rr.push(`${w * 1000}×${h * 1000} mm: ${g4(got)} vs VIS(120) ${g4(real)} A/m`)
		}
		check(worstRod < 0.03, "soft rods in a uniform field: the engine's rows = the converged volume-integral solve (120 cells) within 3 %", `${rr.join("; ")}; worst ${(worstRod * 100).toFixed(2)} %`)
		// a nail (51 × 2.9 mm) end-on to an N42 10 mm cube's pole, 2-20 mm away: the engine's pull against the converged solve
		const sC = 0.01
		const Mm = 1.3 / MU0
		const faces: FaceSpec[] = [{ x: sC / 2, y: 0, angle: 0, width: sC, depth: sC, sigma: Mm }, { x: -sC / 2, y: 0, angle: Math.PI, width: sC, depth: sC, sigma: -Mm }]
		const o = new Float64Array(3)
		const Hx = (x: number, y: number, z: number) => {
			rectField(sC / 2, sC / 2, y, z, x - sC / 2, o)
			let hx = (Mm * o[2]) / (4 * Math.PI)
			rectField(sC / 2, sC / 2, y, z, x + sC / 2, o)
			hx -= (Mm * o[2]) / (4 * Math.PI)
			return hx
		}
		const L = 0.051
		const hN = 0.0029
		const nail: string[] = []
		let lo = Infinity
		let hi = 0
		for (const g of [0.002, 0.005, 0.01, 0.02]) {
			const xc = sC / 2 + g + L / 2
			const ref = fine(L, hN, 120, xc, Hx, 1.6e6).F
			const f = createFields({ magnets: [{ solid: "A", faces }], soft: [{ solid: "rod", x: 0, y: 0, w: L, h: hN, d: hN, volume: L * hN * hN, ms: 1.6e6, chi }] })
			// (the engine reckons a magnet's pole face SKIN out: the nail stands that much farther for the same real gap)
			const pose = (id: string) => (id === "A" ? { x: 0, y: 0, angle: 0 } : { x: xc + 0.0007, y: 0, angle: 0 })
			f.settle(0, pose)
			let fx = 0
			f.step(0, pose, (sid, x) => {
				if (sid === "rod") fx += x
			})
			lo = Math.min(lo, fx / ref)
			hi = Math.max(hi, fx / ref)
			nail.push(`${g * 1000} mm ${g4(fx)} vs ${g4(ref)} N`)
		}
		check(lo > NAIL_LO && hi < NAIL_HI, `a nail end-on to an N42 pole 2-20 mm away: the engine's pull within ${NAIL_LO}-${NAIL_HI} × the converged solve`, `${nail.join("; ")}; ratio ${lo.toFixed(2)}-${hi.toFixed(2)}`)
	},
	upright() {
		// engine6 (2026-10-20, the FO-13 lesson's "an upright nail under the magnet"): the catalog's 51 × 2.9 mm nail (2.76 g) under a 15 cm ceramic bar
		// lying flat, in its true field, against a converged volume-integral solve with BOTH in-plane components of magnetization in every cell
		// (VIS2: 96 cells, each cell's axial sheets and side sheets, the sheets' field averaged at 4 × 3 × 3 Gauss points, χ 1000, M_s 1.6 MA/m;
		// its force µ0·σ·A·<H> over every sheet, the co-energy's derivative to the digit). Upright, its top 3-15 mm under the bar 4-15 mm in
		// from its end face: the engine = VIS2 within 0.8-1.25 (so the weak pull the bench saw is real: under a bar lying flat the field runs
		// along the bar, across the upright nail, and turns up into the pole face only at the corner). Stood on its end over the nail (its pole
		// face down, along the nail): VIS2 lifts the nail from 15 mm, not from 20 mm (the lesson's "a finger's width"). Known limit, said:
		// a flat nail along the bar with its end 10 mm past the pole's corner, where the field it lies in turns, is pulled 0.35-0.75 of VIS2
		// (a row's pull is reckoned on its four coarse pieces, which lump a charge that gathers within a few millimetres; its cells'
		// magnetization is right: VIS2's own, lumped the same way, gives the engine's number)
		const SIG = 0.39 / MU0
		const L = 0.051
		const A = 0.0029
		const VOL = Math.PI * (A / 2) * (A / 2) * (L - 0.00267)
		const MS = 1.6e6
		const chi = 1000
		// (its weight: the catalog's iron nail as web/sim builds it, its shank and head)
		const built = web.prepare(scene([{ id: "nail", type: "iron-nail", x: 1.3, y: 0.2, angle: 90 }])).doc as unknown as { solids: { item: string; material: string; body: { kind: string; points?: { x: number; y: number }[]; width?: number; height?: number; depth: number } }[]; materials: Record<string, { density: number }> }
		const W =
			G *
			built.solids
				.filter((x) => x.item === "nail")
				.reduce((m, x) => {
					const b = x.body
					const area = b.kind === "polygon" ? Math.abs((b.points ?? []).reduce((a, p, i, ps) => a + p.x * (ps[(i + 1) % ps.length] as { y: number }).y - (ps[(i + 1) % ps.length] as { x: number }).x * p.y, 0)) / 2 : (b.width ?? 0) * (b.height ?? 0)
					return m + (built.materials[x.material]?.density ?? 0) * area * b.depth
				}, 0)
		const o = new Float64Array(3)
		const magAt = { x: 0.15, y: 0.3 }
		let magA = 0
		const Hext = (x: number, y: number, z: number): [number, number] => {
			const c = Math.cos(magA)
			const n = Math.sin(magA)
			const lx = (x - magAt.x) * c + (y - magAt.y) * n
			const ly = -(x - magAt.x) * n + (y - magAt.y) * c
			let hx = 0
			let hy = 0
			for (const [cx, sg] of [[0.075, -SIG], [-0.075, SIG]] as const) {
				rectField(0.0095, 0.00475, ly, z, lx - cx, o)
				hx += (sg * (o[2] as number)) / (4 * Math.PI)
				hy += (sg * (o[0] as number)) / (4 * Math.PI)
			}
			return [hx * c - hy * n, hx * n + hy * c]
		}
		const gx = [-0.861136, -0.339981, 0.339981, 0.861136]
		const wx = [0.347855, 0.652145, 0.652145, 0.347855]
		const g3 = [-0.774597, 0, 0.774597]
		const w3 = [0.555556, 0.888889, 0.555556]
		/** VIS2: the rod (axis at angle th, middle (xc, yc)) in n cells, each (Mu, Mv); its force (N, world) and the same magnetization lumped
		 *  into the engine's four coarse pieces (0, 3.8 %, 50 %, 96.2 %, 100 % of its length) */
		const vis2 = (xc: number, yc: number, th: number, n: number) => {
			const cu = Math.cos(th)
			const su = Math.sin(th)
			const ext = (u: number, v: number, z: number): [number, number] => {
				const [hx, hy] = Hext(xc + u * cu - v * su, yc + u * su + v * cu, z)
				return [hx * cu + hy * su, -hx * su + hy * cu]
			}
			const l = L / n
			const us = Array.from({ length: n + 1 }, (_, k) => -L / 2 + l * k)
			const H0 = Array.from({ length: n }, () => [0, 0])
			const D = [0, 1, 2, 3].map(() => Array.from({ length: n }, () => new Float64Array(n)))
			for (let i = 0; i < n; i++) {
				const ci = (us[i] as number) + l / 2
				for (let a = 0; a < 4; a++)
					for (let b = 0; b < 3; b++)
						for (let e = 0; e < 3; e++) {
							const u = ci + ((gx[a] as number) * l) / 2
							const v = ((g3[b] as number) * A) / 2
							const z = ((g3[e] as number) * A) / 2
							const w = ((wx[a] as number) * (w3[b] as number) * (w3[e] as number)) / 8
							const [hu, hv] = ext(u, v, z)
							;(H0[i] as number[])[0] += w * hu
							;(H0[i] as number[])[1] += w * hv
							for (let j = 0; j < n; j++) {
								const cj = (us[j] as number) + l / 2
								let uu = 0
								let vu = 0
								for (const [kk, sg] of [[j + 1, 1], [j, -1]] as const) {
									rectField(A / 2, A / 2, v, z, u - (us[kk] as number), o)
									uu += (sg * (o[2] as number)) / (4 * Math.PI)
									vu += (sg * (o[0] as number)) / (4 * Math.PI)
								}
								let uv = 0
								let vv = 0
								for (const [yy, sg] of [[A / 2, 1], [-A / 2, -1]] as const) {
									rectField(l / 2, A / 2, u - cj, z, v - yy, o)
									vv += (sg * (o[2] as number)) / (4 * Math.PI)
									uv += (sg * (o[0] as number)) / (4 * Math.PI)
								}
								;(D[0] as Float64Array[])[i]![j] += w * uu
								;(D[1] as Float64Array[])[i]![j] += w * vu
								;(D[2] as Float64Array[])[i]![j] += w * uv
								;(D[3] as Float64Array[])[i]![j] += w * vv
							}
						}
			}
			const Mu = new Float64Array(n)
			const Mv = new Float64Array(n)
			for (let it = 0; it < 20000; it++) {
				let delta = 0
				let big = 0
				for (let i = 0; i < n; i++) {
					let hu = (H0[i] as number[])[0] as number
					let hv = (H0[i] as number[])[1] as number
					for (let j = 0; j < n; j++) {
						if (j === i) continue
						hu += D[0]![i]![j]! * Mu[j]! + D[2]![i]![j]! * Mv[j]!
						hv += D[1]![i]![j]! * Mu[j]! + D[3]![i]![j]! * Mv[j]!
					}
					const a11 = 1 / chi - D[0]![i]![i]!
					const a12 = -D[2]![i]![i]!
					const a21 = -D[1]![i]![i]!
					const a22 = 1 / chi - D[3]![i]![i]!
					const det = a11 * a22 - a12 * a21
					let mu = (a22 * hu - a12 * hv) / det
					let mv = (-a21 * hu + a11 * hv) / det
					const m = Math.hypot(mu, mv)
					if (m > MS) {
						mu *= MS / m
						mv *= MS / m
					}
					const nu = Mu[i]! + 0.7 * (mu - Mu[i]!)
					const nv = Mv[i]! + 0.7 * (mv - Mv[i]!)
					delta = Math.max(delta, Math.abs(nu - Mu[i]!), Math.abs(nv - Mv[i]!))
					big = Math.max(big, Math.abs(nu), Math.abs(nv))
					Mu[i] = nu
					Mv[i] = nv
				}
				if (delta < 1e-8 * (1 + big)) break
			}
			const force = (cuts: number[], mu: (q: number) => number, mv: (q: number) => number) => {
				let Fu = 0
				let Fv = 0
				const P = cuts.length - 1
				for (let q = 0; q <= P; q++) {
					const sig = (q > 0 ? mu(q - 1) : 0) - (q < P ? mu(q) : 0)
					if (sig !== 0)
						for (let b = 0; b < 3; b++)
							for (let e = 0; e < 3; e++) {
								const [hu, hv] = ext(cuts[q] as number, ((g3[b] as number) * A) / 2, ((g3[e] as number) * A) / 2)
								const w = ((w3[b] as number) * (w3[e] as number)) / 4
								Fu += MU0 * sig * A * A * w * hu
								Fv += MU0 * sig * A * A * w * hv
							}
				}
				for (let q = 0; q < P; q++) {
					const len = (cuts[q + 1] as number) - (cuts[q] as number)
					const c = ((cuts[q] as number) + (cuts[q + 1] as number)) / 2
					for (const [yy, sg] of [[A / 2, 1], [-A / 2, -1]] as const)
						for (let b = 0; b < 3; b++)
							for (let e = 0; e < 3; e++) {
								const [hu, hv] = ext(c + ((g3[b] as number) * len) / 2, yy, ((g3[e] as number) * A) / 2)
								const w = ((w3[b] as number) * (w3[e] as number)) / 4
								Fu += MU0 * sg * mv(q) * len * A * w * hu
								Fv += MU0 * sg * mv(q) * len * A * w * hv
							}
				}
				const k = VOL / (L * A * A)
				return { fx: k * (Fu * cu - Fv * su), fy: k * (Fu * su + Fv * cu) }
			}
			const exact = force(us, (q) => Mu[q] as number, (q) => Mv[q] as number)
			const cuts = [0, 0.03806, 0.5, 0.96194, 1].map((f) => -L / 2 + f * L)
			const mean = (q: number, M: Float64Array) => {
				let s = 0
				let c = 0
				for (let i = 0; i < n; i++) {
					const m = (us[i] as number) + l / 2
					if (m >= (cuts[q] as number) && m < (cuts[q + 1] as number)) {
						s += M[i] as number
						c++
					}
				}
				return c ? s / c : 0
			}
			return { ...exact, lumped: force(cuts, (q) => mean(q, Mu), (q) => mean(q, Mv)) }
		}
		const faces: FaceSpec[] = [{ x: 0.075, y: 0, angle: 0, width: 0.019, depth: 0.0095, sigma: -SIG }, { x: -0.075, y: 0, angle: Math.PI, width: 0.019, depth: 0.0095, sigma: SIG }]
		const engineFy = (xc: number, yc: number, th: number) => {
			const f = createFields({ magnets: [{ solid: "mag", faces }], soft: [{ solid: "nail", x: 0, y: 0, w: L, h: A, d: A, volume: VOL, ms: MS, chi }] })
			const pose = (id: string) => (id === "mag" ? { x: magAt.x, y: magAt.y, angle: magA } : { x: xc, y: yc, angle: th })
			f.settle(0, pose)
			let fy = 0
			f.step(0, pose, (sid, _x, y) => {
				if (sid === "nail") fy += y
			})
			return fy
		}
		const N = 96
		const bottom = magAt.y - 0.0095
		let lo = Infinity
		let hi = 0
		const rows: string[] = []
		for (const gap of [0.003, 0.008, 0.015])
			for (const dx of [0.004, 0.008, 0.015]) {
				const xc = magAt.x + 0.075 - dx
				const yc = bottom - gap - L / 2
				const e = engineFy(xc, yc, Math.PI / 2)
				const r = vis2(xc, yc, Math.PI / 2, N)
				lo = Math.min(lo, e / r.fy)
				hi = Math.max(hi, e / r.fy)
				rows.push(`${gap * 1000}/${dx * 1000} mm ${(e * 1000).toFixed(1)} vs ${(r.fy * 1000).toFixed(1)} mN`)
			}
		check(lo > NAIL_LO && hi < NAIL_HI, `an upright nail under a ceramic bar lying flat (its top 3-15 mm under the bar, 4-15 mm in from the end): the engine's pull within ${NAIL_LO}-${NAIL_HI} × VIS2`, `gap/in from the end: ${rows.join("; ")}; ratio ${lo.toFixed(2)}-${hi.toFixed(2)}; its weight ${(W * 1000).toFixed(1)} mN`)
		magA = Math.PI / 2
		const endOn = (gap: number) => vis2(magAt.x, magAt.y - 0.075 - gap - L / 2, Math.PI / 2, N).fy
		const e15 = endOn(0.015)
		const e20 = endOn(0.02)
		check(e15 > W && e20 < W, `the bar stood on its end over the upright nail (${(W / G * 1000).toFixed(2)} g; its pole face down, along the nail): VIS2 lifts it from 15 mm, not from 20 mm`, `${(e15 * 1000).toFixed(1)} and ${(e20 * 1000).toFixed(1)} mN against its weight ${(W * 1000).toFixed(1)} mN; the engine ${(engineFy(magAt.x, magAt.y - 0.075 - 0.015 - L / 2, Math.PI / 2) * 1000).toFixed(1)} mN at 15 mm (its contact skins: SKIN)`)
		magA = 0
		const flat: string[] = []
		for (const gap of [0.003, 0.008, 0.015]) {
			const yc = bottom - gap - A / 2
			const e = engineFy(0.21, yc, 0)
			const r = vis2(0.21, yc, 0, N)
			flat.push(`${gap * 1000} mm: ${(e * 1000).toFixed(1)} vs ${(r.fy * 1000).toFixed(1)} mN (${(e / r.fy).toFixed(2)}; lumped ${(r.lumped.fy * 1000).toFixed(1)})`)
		}
		console.log(`info  known limit: a flat nail along the bar, its end 10 mm past the pole's corner: the engine against VIS2 and VIS2 lumped into the engine's four coarse pieces: ${flat.join("; ")}`)
	},
	chain() {
		// clips end to end (0.1 mm between their faces, where the contact skins leave resting faces), and the electromagnet's 51 × 2.9 mm nail
		// with a chain under its point, against a volume-integral solve of the whole chain: every body cut into 1 mm cells along the chain,
		// each uniformly magnetized, every cell's two charged end faces' field averaged over every cell (4 × 3 × 3 Gauss points), χ 1000,
		// M_s 1.6 MA/m, the coil as n·I along the nail and its two end faces (the engine's model of a coil); a body's pull is the force on its
		// cells' charges from every other body's. Taken in the engine's convention, a round nail's block holds its own moment (its charge is
		// its block's magnetization × its fill) and is demagnetized as the block.
		const chi = 1000
		const Ms = 1.6e6
		const L = 0.051
		const dia = 0.0029
		const clipL = 0.033
		const cw = 0.0009
		const cd = 0.0019
		const gap = 0.0001
		const out = new Float64Array(3)
		const gx = [-0.861136, -0.339981, 0.339981, 0.861136]
		const wx = [0.347855, 0.652145, 0.652145, 0.347855]
		const g3 = [-0.774597, 0, 0.774597]
		const w3 = [0.555556, 0.888889, 0.555556]
		const vis = (turns: number, amps: number, clips: number, Hu: number) => {
			type Cell = { x0: number; x1: number; h: number; d: number; body: number; fill: number }
			const cells: Cell[] = []
			const add = (x0: number, len: number, h: number, d: number, body: number, fill: number) => {
				const n = Math.max(1, Math.round(len / 0.001))
				for (let k = 0; k < n; k++) cells.push({ x0: x0 + (len * k) / n, x1: x0 + (len * (k + 1)) / n, h, d, body, fill })
				return x0 + len
			}
			let x = turns > 0 ? add(0, L, dia, dia, 0, Math.PI / 4) : -gap
			for (let k = 0; k < clips; k++) x = add(x + gap, clipL, cw, cd, k + 1, 1)
			const n = cells.length
			const nI = turns > 0 ? (turns * amps) / (L - 0.01) : 0
			const coilFaces = turns > 0 ? ([[0, -nI], [L, nI]] as const) : ([] as const)
			const avg = (fx: number, fh: number, fd: number, c: Cell) => {
				let sum = 0
				const xc = (c.x0 + c.x1) / 2
				const hl = (c.x1 - c.x0) / 2
				for (let a = 0; a < 4; a++)
					for (let b = 0; b < 3; b++)
						for (let e = 0; e < 3; e++) {
							rectField(fh / 2, fd / 2, (g3[b] * c.h) / 2, (g3[e] * c.d) / 2, xc + gx[a] * hl - fx, out)
							sum += (wx[a] * w3[b] * w3[e] * out[2]) / (4 * Math.PI)
						}
				return sum / 8
			}
			const H0 = cells.map((c) => {
				let h = Hu + (c.body === 0 ? nI : 0)
				for (const [fx, q] of coilFaces) h += q * avg(fx, dia, dia, c)
				return h
			})
			const A = cells.map((ci) => cells.map((cj) => avg(cj.x1, cj.h, cj.d, ci) - avg(cj.x0, cj.h, cj.d, ci)))
			const M = new Float64Array(n)
			for (let it = 0; it < 4000; it++) {
				let delta = 0
				let big = 0
				for (let i = 0; i < n; i++) {
					let H = H0[i]
					for (let j = 0; j < n; j++) if (j !== i) H += A[i][j] * M[j] * (cells[j].body === cells[i].body ? 1 : cells[j].fill)
					let m = (chi * H) / (1 - chi * A[i][i])
					if (Math.abs(m) > Ms) m = Math.sign(m) * Ms
					const nm = M[i] + 0.7 * (m - M[i])
					delta = Math.max(delta, Math.abs(nm - M[i]))
					big = Math.max(big, Math.abs(nm))
					M[i] = nm
				}
				if (delta < 1e-7 * (1 + big)) break
			}
			const mean = (b: number) => {
				let sm = 0
				let v = 0
				cells.forEach((c, i) => {
					if (c.body === b) {
						sm += M[i] * (c.x1 - c.x0)
						v += c.x1 - c.x0
					}
				})
				return sm / v
			}
			// the pull on each clip along the chain (toward the nail: −x), from every other body's charges and the coil's
			const field = (fx: number, fh: number, fd: number, skip: number) => {
				let H = 0
				for (let b = 0; b < 3; b++)
					for (let e = 0; e < 3; e++) {
						const py = (g3[b] * fh) / 2
						const pz = (g3[e] * fd) / 2
						let h = Hu
						for (let j = 0; j < n; j++) {
							const c = cells[j]
							if (c.body === skip) continue
							const q = M[j] * c.fill
							rectField(c.h / 2, c.d / 2, py, pz, fx - c.x1, out)
							h += (q * out[2]) / (4 * Math.PI)
							rectField(c.h / 2, c.d / 2, py, pz, fx - c.x0, out)
							h -= (q * out[2]) / (4 * Math.PI)
						}
						for (const [cx, q] of coilFaces) {
							rectField(dia / 2, dia / 2, py, pz, fx - cx, out)
							h += (q * out[2]) / (4 * Math.PI)
						}
						H += (w3[b] * w3[e] * h) / 4
					}
				return H
			}
			const pulls: number[] = []
			for (let k = 1; k <= clips; k++) {
				let F = 0
				cells.forEach((c, i) => {
					if (c.body !== k) return
					const q = M[i] * c.fill * c.h * c.d
					F += MU0 * q * (field(c.x1 - 1e-7, c.h, c.d, k) - field(c.x0 + 1e-7, c.h, c.d, k))
				})
				pulls.push(-F)
			}
			return { means: Array.from({ length: clips + (turns > 0 ? 1 : 0) }, (_, k) => mean(turns > 0 ? k : k + 1)), pulls }
		}
		// the engine: the same bodies at rest (the nail point down, the clips under it, 1.5 mm between bodies as the skins hold them)
		const engine = (turns: number, amps: number, clips: number, Hu: number) => {
			const soft: Parameters<typeof createFields>[0]["soft"] & object = []
			const poses: Record<string, { x: number; y: number; angle: number }> = {}
			if (turns > 0) {
				;(soft as unknown[]).push({ solid: "nail", x: 0, y: 0, w: L, h: dia, d: dia, volume: Math.PI * (dia / 2) ** 2 * L, ms: Ms, chi, coil: { turns, length: L - 0.01, current: [{ t: 0, amps }] } })
				poses.nail = { x: 0, y: 0, angle: -Math.PI / 2 }
			}
			for (let k = 0; k < clips; k++) {
				;(soft as unknown[]).push({ solid: `c${k}`, x: 0, y: 0, w: clipL, h: cw, d: cd, volume: clipL * cw * cd, ms: Ms, chi })
				poses[`c${k}`] = { x: 0, y: -((turns > 0 ? L / 2 + 0.0015 : 0) + clipL / 2 + k * (clipL + 0.0015)), angle: -Math.PI / 2 }
			}
			const f = createFields({ soft, ...(Hu !== 0 ? { earth: { x: 0, y: -Hu * MU0 } } : {}) })
			const pose = (id: string) => poses[id]
			for (let k = 0; k < 300; k++) f.settle(k / 480, pose)
			const F: Record<string, number> = {}
			f.step(1, pose, (sid, _x, y) => {
				F[sid] = (F[sid] ?? 0) + y
			})
			const st = f.state().soft
			const ids = [...(turns > 0 ? ["nail"] : []), ...Array.from({ length: clips }, (_, k) => `c${k}`)]
			return { means: ids.map((id) => Math.hypot(st[id][0], st[id][1])), pulls: Array.from({ length: clips }, (_, k) => F[`c${k}`] ?? 0) }
		}
		const row = (a: number[], b: number[]) => a.map((v, k) => `${(v / 1000).toFixed(0)}/${(b[k] / 1000).toFixed(0)}`).join(" ")
		// in a uniform field along them (1 kA/m)
		for (const n of [2, 4]) {
			const E = engine(0, 0, n, 1000)
			const R = vis(0, 0, n, 1000)
			const worst = Math.max(...E.means.map((v, k) => rel(v, R.means[k])))
			check(worst < 0.1, `${n} clips end to end in a uniform field: each clip's magnetization within 10 % of the converged chain's`, `engine/VIS kA/m ${row(E.means, R.means)}`)
		}
		// under the electromagnet's point (2 AA: 10 turns 6.86 A, 50 turns 6.36 A, 200 turns 5.0 A, as the coil's Ohm's law gives)
		for (const [turns, amps] of [[10, 6.86], [50, 6.36], [200, 5.0]]) {
			const E = engine(turns, amps, 4, 0)
			const R = vis(turns, amps, 4, 0)
			const worstM = Math.max(...E.means.slice(0, 3).map((v, k) => rel(v, R.means[k])))
			check(worstM < 0.2, `${turns} turns, 4 clips under the point: the nail's and the first two clips' magnetization within 20 % of the converged chain's`, `engine/VIS kA/m ${row(E.means, R.means)}`)
			const r1 = E.pulls[0] / R.pulls[0]
			check(r1 > 0.8 && r1 < 1.5, `${turns} turns: the first clip's pull within 0.8-1.5 × the converged chain's (the end pieces' coarse charges overstate a contact a little)`, `${(E.pulls[0] * 1000).toFixed(1)} vs ${(R.pulls[0] * 1000).toFixed(1)} mN; further down ${E.pulls.slice(1).map((v, k) => `${(v * 1000).toFixed(1)}/${(R.pulls[k + 1] * 1000).toFixed(1)}`).join(" ")} mN`)
		}
	},
	materials() {
		const recs = (R: ReturnType<typeof go>, item: string) => (R.doc.processes ?? []).filter((p) => p.kind === "magnetism" && p.item === item) as unknown as Record<string, unknown>[]
		// the matter module's density-set cubes (1 inch) under a held neodymium bar, 8 mm above each
		const cube = (made_of: string) => {
			const R = go(scene([{ id: "m", type: "bar-magnet", x: 1.0, y: 0.0254 + 0.008 + 0.075, angle: -90, fixed: true, props: { material: "neodymium" } }, { id: "o", type: "density-cube", x: 1.0, y: 0.0127, props: { made_of } }], 1.5, [{ kind: "lifts", source: "m", item: "o" }]))
			const sid = R.doc.solids.find((x) => x.item === "o")!.id
			const a = R.pose(sid, 0)!
			const b = R.pose(sid)!
			return { roles: recs(R, "o").map((r) => r.role), lifted: R.summary.goals[0].ok, still: a.x === b.x && Math.abs(a.y - b.y) < 0.002 }
		}
		const st = cube("steel")
		check(st.roles.includes("soft") && st.lifted, "the matter module's steel density cube is soft iron: a neodymium bar 8 mm above lifts it", JSON.stringify(st))
		const others = ["aluminium", "brass", "copper", "zinc"].map((m) => [m, cube(m)] as const)
		check(others.every(([, r]) => r.roles.length === 0 && r.still && !r.lifted), "…its aluminium, brass, copper and zinc cubes have no magnetism record and never move", others.map(([m, r]) => `${m} ${JSON.stringify(r)}`).join("; "))
		// the other modules' metals near a rubbed balloon are conductors; a stainless spoon is not magnetic; light non-metal things are dielectrics
		const B = go(scene([
			{ id: "bal", type: "balloon", x: 1.0, y: 0.3, fixed: true, props: { rubbed: 10, on_thread: false } },
			{ id: "magnet", type: "bar-magnet", x: 2.6, y: 0.0095, fixed: true, props: {} },
			{ id: "penny", type: "penny", x: 0.8, y: 0.001, props: {} },
			{ id: "spoon", type: "spoon", x: 1.2, y: 0.005, props: {} },
			{ id: "pp", type: "ping-pong-ball", x: 1.5, y: 0.02, props: {} },
			{ id: "sheet", type: "paper-sheet", x: 0.5, y: 0.001, props: {} },
			{ id: "feather", type: "feather", x: 1.9, y: 0.003, props: {} }
		], 0.4))
		const role = (id: string) => recs(B, id).map((r) => `${r.role}${r.epsr !== undefined ? `(ε ${r.epsr})` : ""}`).join(",")
		check(recs(B, "penny").some((r) => r.role === "polar" && r.epsr === 0) && recs(B, "spoon").some((r) => r.role === "polar" && r.epsr === 0), "the fluids module's penny (copper-plated zinc) and the heat module's stainless spoon are conductors near a charge (ε 0)", `penny ${role("penny")}, spoon ${role("spoon")}`)
		check(!recs(B, "spoon").some((r) => r.role === "soft"), "…and the stainless (austenitic) spoon is not magnetic, a magnet in the scene or not", role("spoon"))
		const pp = recs(B, "pp").find((r) => r.role === "polar")
		// a 40 mm ping-pong ball: a thin celluloid shell (ε_s 3.5), polarized as the thin shell is, α = ε0·V_shell·(ε−1)(2ε+1)/(3ε)
		const e = 3.5
		const A = ((e - 1) * (2 * e + 1)) / (3 * e)
		const want = (3 + 2 * A) / (3 - A)
		check(pp !== undefined && Math.abs((pp.epsr as number) - want) < 1e-3, "a ping-pong ball near a charge is a dielectric shell: its record's ε is the thin shell's polarizability as a solid ball of its shell's volume", `ε ${pp?.epsr} vs ${want.toFixed(4)}`)
		check(recs(B, "sheet").some((r) => r.role === "polar" && (r.epsr as number) > 1) && recs(B, "feather").some((r) => r.role === "polar" && (r.epsr as number) > 1), "a sheet of paper and a feather (other modules') are dielectrics near a charge (ε > 1)", `paper ${role("sheet")}, feather ${role("feather")}`)
		// fixed steel far beyond a fixed magnet's reach (its dipole's field under 2 µT) gets no record; near, it does; steel that can move, or
		// near a magnet that can, keeps its record wherever it starts (a magnet cart may roll up to it); sheet metal no pole faces at the start
		// is a row (`grid: false`)
		const far = (dx: number, ballFixed: boolean, magnetFixed: boolean) => recs(go(scene([{ id: "m", type: "bar-magnet", x: 0.3, y: 0.0095, fixed: magnetFixed, props: {} }, { id: "b", type: "steel-ball", x: 0.3 + dx, y: 0.02, fixed: ballFixed, props: {} }], 0.2)), "b").length
		check(far(2.5, true, true) === 0 && far(0.4, true, true) > 0 && far(2.5, false, true) > 0 && far(2.5, true, false) > 0, "a fixed steel ball 2.5 m from a fixed ceramic bar is out of its reach (no record: it costs the run nothing); 40 cm away it is soft iron; a free ball, or a free magnet, keeps it", `${far(2.5, true, true)}, ${far(0.4, true, true)}, ${far(2.5, false, true)}, ${far(2.5, true, false)} records`)
		const tray = (dx: number) => recs(go(scene([{ id: "m", type: "bar-magnet", x: 0.3, y: 0.0095, fixed: true, props: {} }, { id: "s", type: "barrier-sheet", x: 0.375 + dx, y: 0, props: { material: "steel" } }], 0.2)), "s")
		check(tray(0.008).every((r) => r.grid === undefined), "a steel barrier sheet a pole faces keeps its grid (its own record never says grid: false)", JSON.stringify(tray(0.008).map((r) => r.grid)))
	},
	nonmag() {
		const R = go(demo("g3-what-it-attracts"))
		const recs = new Set((R.doc.processes ?? []).filter((p) => p.kind === "magnetism").map((p) => p.item))
		const non = ["plastic-clip", "foil", "brass-key", "bead", "copper"]
		check(non.every((id) => !recs.has(id)), "G3: plastic, aluminium foil, brass, wood and copper have no magnetism record (no pull of any size)", [...recs].filter((x) => !x.startsWith("m")).join(","))
		const still = non.every((id) => {
			const sid = R.doc.solids.find((s) => s.item === id)!.id
			const a = R.pose(sid, 0)!
			const b = R.pose(sid)!
			return a.x === b.x && Math.abs(a.y - b.y) < 0.002 && Math.abs(a.angle - b.angle) < 0.01
		})
		check(still, "G3: none of them moves toward its magnet (only settling on the table)")
		const pulled = ["steel-clip", "nail", "washer"].every((id) => R.summary.goals.find((g) => g.item === id)?.ok === true)
		check(pulled, "G3: the steel clip, the iron nail and the steel washer are pulled to their magnets", R.summary.goals.map((g) => `${g.item} ${g.ok}`).join(", "))
	},
	barrier() {
		const pull = (material: string | null) => {
			const items: Item[] = [
				{ id: "magnet", type: "bar-magnet", x: 1.0, y: 0.0095, fixed: true, props: { material: "neodymium", length: 0.1 } },
				{ id: "clip", type: "paper-clip", x: 1.097, y: 0.0005, fixed: true, props: {} }
			]
			if (material) items.push({ id: "sheet", type: "barrier-sheet", x: 1.056, y: 0, props: { material } })
			const R = go(scene(items, 0.6))
			return R.end("clip", "pull_mN")
		}
		const none = pull(null)
		const through = ["paper", "cardboard", "plastic", "glass", "aluminium"].map((m) => [m, pull(m)] as const)
		check(none > 0 && through.every(([, v]) => v === none), "G4: the pull through paper, cardboard, plastic, glass and aluminium is exactly the pull with no sheet [FURLANI]", `${g4(none)} mN; ${through.map(([m, v]) => `${m} ${g4(v)}`).join(", ")}`)
		// a 0.5 mm steel sheet (its 1 mm body) standing 8 mm from a 15 cm bar's north pole, a clip lying 15 mm from the pole behind it
		const cut = (grade: string) => {
			const at = (mat: string | null) => {
				const items: Item[] = [
					{ id: "m", type: "bar-magnet", x: 1.0, y: 0.0095, fixed: true, props: { material: grade } },
					{ id: "clip", type: "paper-clip", x: 1.075 + 0.015 + 0.0165, y: 0.0005, fixed: true, props: {} }
				]
				if (mat) items.push({ id: "s", type: "barrier-sheet", x: 1.075 + 0.008, y: 0, fixed: true, props: { material: mat } })
				return go(scene(items, 0.6)).end("clip", "pull_mN")
			}
			const free = at(null)
			const behind = at("steel")
			return { free, behind, cut: 1 - behind / free }
		}
		const C = cut("ceramic")
		const N = cut("neodymium")
		check(C.cut >= 0.7, "G4: a 0.5 mm steel sheet 8 mm from a ceramic pole cuts the pull on a clip behind it by 70 % or more (steel blocks it)", `${g4(C.behind)} vs ${g4(C.free)} mN: ${(C.cut * 100).toFixed(0)} % less`)
		check(N.cut > 0.4 && N.cut < C.cut, "…from a neodymium pole by less (the sheet saturates where the pole faces it), but still by over 40 %", `${g4(N.behind)} vs ${g4(N.free)} mN: ${(N.cut * 100).toFixed(0)} % less`)
	},
	lift() {
		// the static pull on a clip held under a bar magnet held pole-down, against the clip's weight (0.45 g)
		const W = 0.00045 * G * 1000
		const held = (material: string, gap: number) => {
			const L = 0.15
			const items: Item[] = [
				{ id: "magnet", type: "bar-magnet", x: 1.0, y: 0.001 + gap + L / 2, angle: -90, fixed: true, props: { material } },
				{ id: "clip", type: "paper-clip", x: 1.0, y: 0.0005, fixed: true, props: {} }
			]
			return go(scene(items, 0.5)).end("clip", "pull_mN")
		}
		const jump = (material: string, gap: number) => {
			const L = 0.15
			const R = go(scene([
				{ id: "magnet", type: "bar-magnet", x: 1.0, y: 0.001 + gap + L / 2, angle: -90, fixed: true, props: { material } },
				{ id: "clip", type: "paper-clip", x: 1.0, y: 0.0005, props: {} }
			], 2, [{ kind: "lifts", source: "magnet", item: "clip" }]))
			return R.summary.goals[0].ok
		}
		// the gap where the pull passes the weight, found on the static pull (5 mm steps)
		const reach = (material: string) => {
			let last = 0
			for (let g = 0.004; g <= 0.05; g += 0.002) {
				if (held(material, g) < W) return last
				last = g
			}
			return last
		}
		const rc = reach("ceramic")
		const rn = reach("neodymium")
		check(rc > 0.004 && rn > rc, "a neodymium bar's pull passes a clip's weight from farther than a ceramic bar's", `ceramic ${Math.round(rc * 1000)} mm, neodymium ${Math.round(rn * 1000)} mm (weight ${g4(W)} mN)`)
		check(jump("ceramic", rc - 0.002) && !jump("ceramic", rc + 0.006), "G1: the clip jumps where the static pull passes its weight, and stays down where it does not (ceramic)", `jumps from ${Math.round((rc - 0.002) * 1000)} mm, not from ${Math.round((rc + 0.006) * 1000)} mm`)
		check(jump("neodymium", rn - 0.002), "G1: a neodymium bar lifts it from its own reach", `${Math.round((rn - 0.002) * 1000)} mm`)
		check(rc >= 0.01 && rc <= 0.03 && jump("neodymium", 0.03), "G1: the reaches are a classroom's: a ceramic bar's 1-3 cm, a neodymium one lifts the clip from 3 cm [spec G1: 1-3 and 3-6 cm]", `ceramic ${Math.round(rc * 1000)} mm; neodymium jumps from 30 mm`)
	},
	rings() {
		const R = go(demo("g6-levitating-rings"))
		const recs = (R.doc.processes ?? []).filter((p) => p.kind === "magnetism" && p.role === "magnet" && p.item === "rings")
		const solids = recs.map((p) => p.solid as string)
		const mass = (sid: string) => {
			const s = R.doc.solids.find((x) => x.id === sid)!
			return s as unknown as { mass?: number }
		}
		void mass
		// each ring's moment from its record: σ × face area × the faces' distance apart
		const moment = (p: (typeof recs)[number]) => {
			const fs = p.faces as FaceSpec[]
			const top = fs.reduce((a, f) => (f.y > a.y ? f : a), fs[0])
			const bot = fs.reduce((a, f) => (f.y < a.y ? f : a), fs[0])
			return fs.filter((f) => f.y === top.y).reduce((a, f) => a + Math.abs(f.sigma) * f.width * f.depth, 0) * (top.y - bot.y)
		}
		const gaps = (R.summary.goals[0] as unknown as { gaps_mm: number[] }).gaps_mm
		const m = moment(recs[0])
		// each floating ring's weight from the ring's ferrite (4.9 g/cm³ [FURLANI]): the record's faces give its size
		const fs = recs[0].faces as FaceSpec[]
		const thick = Math.max(...fs.map((f) => f.y)) - Math.min(...fs.map((f) => f.y))
		const area = fs.filter((f) => f.y === Math.max(...fs.map((g) => g.y))).reduce((a, f) => a + f.width * f.depth, 0)
		const wRing = 4900 * area * thick * G
		const rows: string[] = []
		let worst = 0
		for (let k = 1; k < solids.length; k++) {
			const above = solids.length - k
			// the gap below ring k (from the bottom) holds the rings above it: k-th gap from the bottom carries (n - k) rings
			const zc = Math.sqrt(Math.sqrt((3 * MU0 * m * m) / (2 * Math.PI * above * wRing)))
			const gap = zc - thick
			const got = gaps[k] / 1000
			worst = Math.max(worst, rel(got, gap))
			rows.push(`gap ${k}: ${g4(got * 1000)} mm vs dipoles ${g4(gap * 1000)} mm`)
		}
		check(R.summary.goals[0].ok && worst < 0.3, "G6: the rings float where the coaxial dipoles' push equals the weight above (near-field: within 30 %) [GRIFFITHS]", `${rows.join("; ")}`)
	},
	compass() {
		const R = go(demo("g7-compass"))
		const far = R.end("far", "heading_deg")
		const above = R.end("above", "heading_deg")
		const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
		check(Math.abs(wrap(far)) < 2, "G7: far from the magnet the needle points north (0°) in Earth's 20 µT [WMM]", `${g4(far)}°`)
		check(Math.abs(wrap(above - 180)) < 4, "G7: over the bar the needle points from its north pole to its south (180°)", `${g4(above)}°`)
		const flipped = demo("g7-compass")
		;(flipped.items.find((i) => i.id === "magnet")!.props ??= {}).flip = true
		const F = go(flipped)
		check(Math.abs(wrap(F.end("above", "heading_deg"))) < 4, "G7: the bar turned round (flip): the needle over it turns round (0°)", `${g4(F.end("above", "heading_deg"))}°`)
		// north to the left, no magnet (it starts pointing north, and stays); a held compass's needle turns too
		const W = go(scene([{ id: "c", type: "compass", x: 1.0, y: 0.033, props: { north: "left" } }, { id: "h", type: "compass", x: 1.5, y: 0.2, fixed: true, angle: 10, props: { north: "left" } }], 3))
		check(Math.abs(wrap(W.end("c", "heading_deg") - 180)) < 2 && Math.abs(wrap(W.end("h", "heading_deg") - 180)) < 4, "G7: north to the left: the needle points left (180°), a fixed compass's needle too (it turned from 190°)", `${g4(W.end("c", "heading_deg"))}°, held ${g4(W.end("h", "heading_deg"))}°`)
		// a bar level with the compass on its axis, flipped: the field at the needle exactly against it (an unstable balance): it turns round
		const Lv = go(scene([{ id: "m", type: "bar-magnet", x: 1.0, y: 0.033, fixed: true, props: { flip: true } }, { id: "c", type: "compass", x: 1.175, y: 0.033, props: {} }], 3))
		check(Math.abs(wrap(Lv.end("c", "heading_deg") - 180)) < 5, "G7: a bar flipped level with the compass, south pole toward it: the needle turns round to point at it (180°)", `${g4(Lv.end("c", "heading_deg"))}°`)
	},
	coulomb() {
		const q = -100e-9
		const f = createFields({ charges: [{ solid: "a", x: 0, y: 0, q, radius: 0.036, capacitance: 1.4e-11 }, { solid: "b", x: 0, y: 0, q, radius: 0.036, capacitance: 1.4e-11 }] })
		let fb = 0
		f.step(0, (id) => (id === "a" ? { x: 0, y: 0, angle: 0 } : { x: 0.3, y: 0, angle: 0 }), (sid, fx) => {
			if (sid === "b") fb += fx
		})
		const ref = (K * q * q) / (0.3 * 0.3)
		check(rel(fb, ref) < 0.005, "G12: two −100 nC charges 30 cm apart push with k q²/r² [CODATA]", `${g4(fb * 1000)} mN vs ${g4(ref * 1000)} mN`)
		// a small conducting ball (R = 5 mm) 10-20 cm from a charge: F = 2 k q² R³ / r⁵ toward it
		const Rb = 0.005
		const V = (4 / 3) * Math.PI * Rb ** 3
		const rows: string[] = []
		let worst = 0
		for (const r of [0.1, 0.15, 0.2]) {
			const g = createFields({ charges: [{ solid: "a", x: 0, y: 0, q, radius: 0.01, capacitance: 1e-11 }], polar: [{ solid: "ball", x: 0, y: 0, w: 0.008, h: 0.008, d: 0.008, round: true, volume: V, epsr: 0 }] })
			let fx = 0
			g.step(0, (id) => (id === "a" ? { x: 0, y: 0, angle: 0 } : { x: r, y: 0, angle: 0 }), (sid, x) => {
				if (sid === "ball") fx += x
			})
			const want = (-2 * K * q * q * Rb ** 3) / r ** 5
			worst = Math.max(worst, rel(fx, want))
			rows.push(`${r * 100} cm ${g4(fx * 1e6)} vs ${g4(want * 1e6)} µN`)
		}
		check(worst < 0.03, "a neutral conducting ball is pulled by its induced dipole (α = 4πε0 R³) [JACKSON §4.4]", `${rows.join("; ")}; worst ${(worst * 100).toFixed(2)} %`)
		const B = go(demo("g11-balloon-paper"))
		check(B.summary.goals[0].ok, "G11: paper scraps jump up to a balloon rubbed 10 times held 8 mm above them", JSON.stringify(B.summary.goals[0]))
		const P = go(demo("p3-pith-ball"))
		const qp = P.end("pith", "charge_uC")
		const qr = P.end("rod", "charge_uC")
		check(P.summary.goals[0].ok && qp < 0 && qr < 0 && Math.abs(qp) < Math.abs(qr), "P3: the pith ball touches the rubbed rod, takes some of its (negative) charge and is pushed away", `rod ${g4(qr * 1000)} nC, ball ${g4(qp * 1000)} nC; ${JSON.stringify(P.summary.goals[0])}`)
	},
	coil() {
		const R = go(demo("em1-turns"))
		const want = (turns: number, cells = 2, dia = 0.0029) => {
			const wire = turns * Math.PI * (dia + 0.000511) + 0.3
			return (cells * 1.5) / (wire * 0.0842 + cells * 0.2)
		}
		let worst = 0
		const rows: string[] = []
		for (const [id, n] of [["em10", 10], ["em50", 50], ["em200", 200]] as const) {
			const got = R.end(id, "amps")
			worst = Math.max(worst, Math.abs(got - want(n)))
			rows.push(`${n} turns ${g4(got)} A (Ohm ${g4(want(n))})`)
		}
		check(worst < 1e-4, "the coil's current is Ohm's law: 1.5 V cells, 0.2 Ω each [E91], 24 AWG at 84.2 mΩ/m [AWG]", rows.join("; "))
		const held = R.summary.goals.map((g) => g.held as number)
		check(JSON.stringify(held) === "[1,2,3]", "MS-PS2-3: more turns hold more clips (10 turns: one, 50: two, 200: three, in a chain)", R.summary.goals.map((g) => `${g.label} ${g.ok} ${JSON.stringify(g.held)}`).join("; "))
		const off = demo("em1-turns")
		for (const it of off.items) if (it.type === "battery-electromagnet") (it.props ??= {}).on = false
		off.goals = [{ kind: "holds", magnet: "em200", count: 1, items: ["clips200"] }]
		const O = go(off)
		check(O.summary.goals[0].ok === false && O.end("em200", "amps") === 0, "switched off, the electromagnet is only soft iron: it holds no clip")
	},
	demos() {
		for (const d of DEMOS) {
			const R = go(d)
			const got = R.summary.goals.map((g) => g.ok)
			const want = d.goals.map((_, k) => d.expect?.[k] ?? true)
			check(JSON.stringify(got) === JSON.stringify(want), `demo ${d.id}: ${d.name}`, R.summary.goals.map((g) => `${g.ok ? "✓" : "✗"} ${g.label}`).join("; "))
		}
	},
	fuzz() {
		const types = ["bar-magnet", "horseshoe-magnet", "disc-magnet", "ring-magnets", "magnet-cart", "paper-clip", "iron-nail", "steel-washer", "steel-can", "battery-electromagnet", "can-on-side", "plastic-clip", "foil-ball", "copper-wire", "brass-key", "wooden-bead", "barrier-sheet", "clip-on-thread", "compass", "balloon", "paper-bits", "charged-rod", "pith-ball"]
		let seed = 99
		const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648)
		const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
		let bad = 0
		let fast = 0
		let differ = 0
		const n = 30
		for (let k = 0; k < n; k++) {
			const items: Item[] = []
			const m = 3 + Math.floor(rnd() * 5)
			for (let i = 0; i < m; i++) {
				const type = pick(types)
				items.push({ id: `i${i}`, type, x: 0.6 + rnd() * 1.2, y: rnd() * 0.25, ...(rnd() < 0.3 ? { angle: pick([-90, 90, 180, 30]) } : {}), ...(rnd() < 0.3 ? { fixed: true } : {}),
					props: type === "balloon" || type === "charged-rod" ? { rubbed: 10 } : type.includes("magnet") ? { material: pick(["ceramic", "alnico", "neodymium"]) } : {} })
			}
			const s = scene(items, 1.5)
			const A = go(s)
			const B = go(s)
			if (A.json !== B.json) differ++
			if (/NaN|null/.test(JSON.stringify(A.track.frames.map((f) => f.placements)))) bad++
			const fr = A.track.frames
			for (let j = 1; j < fr.length; j++) {
				const dt = fr[j].t - fr[j - 1].t
				if (dt <= 0) continue
				for (const id in fr[j].placements) {
					const p = fr[j].placements[id]
					const q = fr[j - 1].placements[id]
					if (q && Math.hypot(p.x - q.x, p.y - q.y) / dt > 15) {
						fast++
						j = fr.length
						break
					}
				}
			}
		}
		check(bad === 0, "fuzz: no NaN or lost placement in random magnetism scenes", `${n} scenes`)
		check(fast === 0, "fuzz: nothing flung faster than 15 m/s", `${fast} of ${n}`)
		check(differ === 0, "fuzz: the same scene gives the same track, byte for byte", `${differ} of ${n} differ`)
	}
}

const want = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const names = want.length === 0 || want.includes("all") ? Object.keys(sections) : want
for (const name of names) {
	if (!sections[name]) {
		check(false, `no section "${name}"`, Object.keys(sections).join(", "))
		continue
	}
	console.log(`\n== ${name}`)
	const t0 = Date.now()
	try {
		sections[name]()
	} catch (e) {
		check(false, `${name} threw`, String((e as Error)?.stack ?? e).slice(0, 600))
	}
	console.log(`   (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
