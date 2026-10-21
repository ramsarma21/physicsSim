/**
 * The circuits module's electromagnetism and light (tooling/src/sim/modules/circuits.ts uses these each step; pure math, SI units):
 *   - the flux a coil's turns link from the scene's permanent magnets (the magnetism module's records: Gilbert pole faces): a magnet's
 *     magnetized body by reciprocity, ∫ M·b dV with b the turn's own exact field per ampere (smooth wherever the magnet is, in the coil
 *     too); a pole that bounds no body by its field through the turn (magnetism.ts rectField); and the Earth's uniform field; the coil's
 *     EMF is then the change of that linkage, Faraday's law (EMF = −N·dΦ/dt);
 *   - the field of a straight current-carrying wire, Biot–Savart for its true length (B = μ0·I/(2π·r) when long), and the force it gives a
 *     magnet's poles (q·B on each face's charge q = σ·A: Oersted's compass);
 *   - a silicon cell's response to light, band by band of the optics module's 8 bands, for the current a solar panel makes.
 * Left out (said in web/CONTRACT.md "Circuits"): the coil's own field on the magnet (Lenz's push back: with a meter in the loop well under a
 * hundredth of a falling magnet's weight), soft iron's share of the flux (a nail in the coil), the coil's self-inductance (L/R under a step:
 * 0.9 mH / 6 Ω = 0.15 ms for the default coil), and one coil's field through another (a transformer).
 * Determinism: + − × ÷, Math.sqrt and the engine's own sin, cos, atan2 (tools/fdlibm.ts), and magnetism.ts's ln and atan.
 */
import { MU0, rectField } from "#sim/magnetism.ts"
import { BANDS, IR, NB, powerOf, type SourceRecord } from "#sim/optics.ts"

export interface Pose {
	readonly x: number
	readonly y: number
	readonly angle: number
}

/** A pole face of a permanent magnet (the magnetism module's FaceSpec): centre (x, y, z) in its solid's frame, outward normal in the plane at
 *  `angle`, `width` along the plane and `depth` across it (m), charge density σ (A/m; positive on a north face). */
export interface PoleFace {
	readonly x: number
	readonly y: number
	readonly z: number
	readonly angle: number
	readonly width: number
	readonly depth: number
	readonly sigma: number
}

/** A permanent magnet as the circuits module sees it: its solid, its faces, and its magnetized prisms (a north face and the opposite face it
 *  faces across the body: between them B = μ0·(H + M), M = σ along the north face's normal). */
export interface PoleMagnet {
	readonly solid: string
	readonly faces: readonly PoleFace[]
	readonly prisms: readonly { readonly north: number; readonly south: number }[]
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d)

/** The scene's permanent magnets (magnetism records of role "magnet") and the Earth's field (its first "earth" record), from the document's
 *  processes. */
export const magnetsOf = (processes: readonly { readonly kind: string; readonly [k: string]: unknown }[]): { magnets: PoleMagnet[]; earth: { x: number; y: number } } => {
	const magnets: PoleMagnet[] = []
	let earth: { x: number; y: number } | undefined
	for (const r of processes) {
		if (r.kind !== "magnetism") continue
		if (r.role === "earth" && earth === undefined) earth = { x: num(r.x), y: num(r.y) }
		if (r.role !== "magnet" || typeof r.solid !== "string" || !Array.isArray(r.faces)) continue
		const faces: PoleFace[] = (r.faces as Record<string, unknown>[]).map((f) => ({
			x: num(f.x),
			y: num(f.y),
			z: num(f.z),
			angle: num(f.angle),
			width: num(f.width),
			depth: num(f.depth),
			sigma: num(f.sigma)
		}))
		const prisms: { north: number; south: number }[] = []
		faces.forEach((f, i) => {
			if (!(f.sigma > 0)) return
			const nx = Math.cos(f.angle)
			const ny = Math.sin(f.angle)
			faces.forEach((o, j) => {
				if (j === i) return
				const c = nx * Math.cos(o.angle) + ny * Math.sin(o.angle)
				const along = (f.x - o.x) * nx + (f.y - o.y) * ny
				const side = -(f.x - o.x) * ny + (f.y - o.y) * nx
				if (c < -0.999 && along > 0 && Math.abs(side) < 1e-9 && Math.abs(f.z - o.z) < 1e-9 && Math.abs(f.width - o.width) < 1e-9 && Math.abs(f.depth - o.depth) < 1e-9)
					prisms.push({ north: i, south: j })
			})
		})
		magnets.push({ solid: r.solid, faces, prisms })
	}
	return { magnets, earth: earth ?? { x: 0, y: 0 } }
}

/** A face placed in the world: centre, outward normal, half width (along the tangent (−ny, nx)) and half depth (along z), σ. */
interface Placed {
	cx: number
	cy: number
	cz: number
	nx: number
	ny: number
	a: number
	b: number
	sigma: number
}
const place = (f: PoleFace, p: Pose, c: number, s: number): Placed => {
	const na = Math.cos(f.angle)
	const nb = Math.sin(f.angle)
	return { cx: p.x + f.x * c - f.y * s, cy: p.y + f.x * s + f.y * c, cz: f.z, nx: na * c - nb * s, ny: na * s + nb * c, a: f.width / 2, b: f.depth / 2, sigma: f.sigma }
}

const tmp = new Float64Array(3)
/** μ0·H (T) along the in-plane unit vector (ux, uy) at the world point (px, py, pz) from placed pole faces (outside the magnet). */
const bAlong = (faces: readonly Placed[], prisms: PoleMagnet["prisms"], px: number, py: number, pz: number, ux: number, uy: number): number => {
	let h = 0
	for (const f of faces) {
		if (f.sigma === 0) continue
		const dx = px - f.cx
		const dy = py - f.cy
		const W = dx * f.nx + dy * f.ny
		const U = -dx * f.ny + dy * f.nx
		rectField(f.a, f.b, U, pz - f.cz, W, tmp)
		const hu = tmp[0] as number
		const hw = tmp[2] as number
		// (world H per 4π: σ·(hw·n + hu·t), t = (−ny, nx))
		h += f.sigma * (hw * (f.nx * ux + f.ny * uy) + hu * (-f.ny * ux + f.nx * uy))
	}
	void prisms
	return (MU0 * h) / (4 * Math.PI)
}

/** Gauss–Legendre nodes and weights on [−1, 1]: 4 and 5 points. */
const G4 = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526]
const W4 = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538]
const G5 = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664]
const W5 = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891]
/** Points round each ring of a turn's disc (half a step turned, so no point lies on a symmetry line of a magnet in the plane). */
const ROUND = 12

/** A coil's turns as the flux is sampled: its bore's middle and axis in the world, the mean turn's radius, the winding's length. */
export interface CoilGeometry {
	readonly x: number
	readonly y: number
	readonly ux: number
	readonly uy: number
	readonly radius: number
	readonly length: number
}

/** The sample points (world) of a coil's turns and each one's weight: Σ w·B·u is the mean flux through one turn (Wb). Used for the poles that
 *  bound no magnetized prism (a horseshoe's tips), whose field is reckoned outside the magnet only. */
export const coilSamples = (g: CoilGeometry): { x: number; y: number; z: number; w: number }[] => {
	const out: { x: number; y: number; z: number; w: number }[] = []
	const vx = -g.uy
	const vy = g.ux
	for (let k = 0; k < G5.length; k++) {
		const s = ((G5[k] as number) * g.length) / 2
		const wk = (W5[k] as number) / 2
		for (let i = 0; i < G4.length; i++) {
			const rho = (g.radius * (1 + (G4[i] as number))) / 2
			const wi = ((W4[i] as number) * g.radius) / 2
			for (let j = 0; j < ROUND; j++) {
				const phi = ((j + 0.5) * 2 * Math.PI) / ROUND
				const c = Math.cos(phi)
				const sn = Math.sin(phi)
				out.push({ x: g.x + s * g.ux + rho * c * vx, y: g.y + s * g.uy + rho * c * vy, z: rho * sn, w: wk * wi * rho * ((2 * Math.PI) / ROUND) })
			}
		}
	}
	return out
}

/**
 * The complete elliptic integrals K(k) and E(k) (modulus k, 0 ≤ k < 1) by the arithmetic-geometric mean: K = π/(2·AGM(1, k′)), E = K·(1 − Σ
 * 2^(n−1)·c_n²) (Abramowitz & Stegun 17.6): only + − × ÷ and √, the same bits everywhere.
 */
export const ellipticKE = (k2: number): [number, number] => {
	let a = 1
	let b = Math.sqrt(Math.max(0, 1 - k2))
	let c = Math.sqrt(Math.max(0, k2))
	let sum = 0.5 * c * c
	let pow = 0.5
	for (let n = 0; n < 40 && Math.abs(c) > 1e-17 * a; n++) {
		const an = (a + b) / 2
		const bn = Math.sqrt(a * b)
		c = (a - b) / 2
		pow *= 2
		sum += pow * c * c
		a = an
		b = bn
	}
	const K = Math.PI / (2 * a)
	return [K, K * (1 - sum)]
}

/**
 * The field per ampere (T/A) of a circular loop of radius `a` at a point `z` along its axis from its middle and `rho` off the axis: its axial and
 * radial parts. Exact (Simpson, Lane, Immer & Youngquist, "Simple analytic expressions for the magnetic field of a circular current loop", NASA
 * 2001): with α² = (a − ρ)² + z², β² = (a + ρ)² + z², k² = 1 − α²/β², B_z = μ0/(2π α² β)·[(a² − r²)E + α²K], B_ρ = μ0 z/(2π α² β ρ)·[(a² + r²)E − α²K];
 * near the axis (ρ under a thousandth of a) B_ρ by its series 3μ0·a²·z·ρ/(4(a² + z²)^2.5). Within `core` of the wire it is held at core.
 */
export const loopField = (a: number, z: number, rho: number, core: number): [number, number] => {
	const r2 = rho * rho + z * z
	let alpha2 = (a - rho) * (a - rho) + z * z
	if (alpha2 < core * core) alpha2 = core * core
	const beta2 = (a + rho) * (a + rho) + z * z
	const beta = Math.sqrt(beta2)
	const [K, E] = ellipticKE(1 - alpha2 / beta2)
	const c = MU0 / (2 * Math.PI)
	const bz = (c / (alpha2 * beta)) * ((a * a - r2) * E + alpha2 * K)
	let br: number
	if (rho < 1e-3 * a) {
		const q = a * a + z * z
		br = (3 * MU0 * a * a * z * rho) / (4 * q * q * Math.sqrt(q))
	} else br = ((c * z) / (alpha2 * beta * rho)) * ((a * a + r2) * E - alpha2 * K)
	return [bz, br]
}

/** Gauss–Legendre on [−1, 1], 8 points: the coil's turns along its length (as eight loops, each carrying its share). */
const G8 = [-0.9602898564975363, -0.796666477413627, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.796666477413627, 0.9602898564975363]
const W8 = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763]
/** Gauss–Legendre on [−1, 1], 3 points. */
const G3 = [-0.7745966692414834, 0, 0.7745966692414834]
const W3 = [5 / 9, 8 / 9, 5 / 9]
/** m: the winding's wire, how near a magnet's sample may be reckoned to it (28 AWG: 0.32 mm across). */
const TURN_CORE = 0.00016

/**
 * The mean flux (Wb) through one turn of a coil from the magnets at their poses and the Earth.
 *   - A magnetized prism (a bar's body between its north and south faces) by reciprocity: the flux a magnetization M puts through a loop is
 *     ∫ M·b dV, b the loop's own field per ampere (a dipole m at r: m·b(r); Jackson, Classical Electrodynamics, §5.17), over the prism at
 *     5 × 3 × 3 Gauss points, the turns as 8 loops along the winding. Smooth wherever the magnet is, through the coil too.
 *   - A pole face that bounds no prism (a horseshoe's tips): its field μ0·H through each turn's disc (the Gauss points of `pts`), outside it.
 *   - The Earth's field: B·u·πR².
 */
export const fluxThrough = (
	g: CoilGeometry,
	pts: readonly { x: number; y: number; z: number; w: number }[],
	magnets: readonly PoleMagnet[],
	poseOf: (solid: string) => Pose | undefined,
	earth: { x: number; y: number }
): number => {
	const ux = g.ux
	const uy = g.uy
	let phi = (earth.x * ux + earth.y * uy) * Math.PI * g.radius * g.radius
	for (const m of magnets) {
		const p = poseOf(m.solid)
		if (p === undefined) continue
		const c = Math.cos(p.angle)
		const s = Math.sin(p.angle)
		const faces = m.faces.map((f) => place(f, p, c, s))
		const inPrism = new Set<number>()
		for (const pr of m.prisms) {
			inPrism.add(pr.north)
			inPrism.add(pr.south)
			const n = faces[pr.north] as Placed
			const o = faces[pr.south] as Placed
			// the prism: from the south face's plane to the north face's, n.a wide (along the tangent), n.b deep; M = σ along the north normal
			const len = (n.cx - o.cx) * n.nx + (n.cy - o.cy) * n.ny
			const mx = n.sigma * n.nx
			const my = n.sigma * n.ny
			const tx = -n.ny
			const ty = n.nx
			const vol = len * 2 * n.a * 2 * n.b
			let sum = 0
			for (let i = 0; i < G5.length; i++) {
				const along = ((G5[i] as number) - 1) * (len / 2)
				for (let j = 0; j < G3.length; j++) {
					const across = (G3[j] as number) * n.a
					for (let k = 0; k < G3.length; k++) {
						const z = n.cz + (G3[k] as number) * n.b
						const w = ((W5[i] as number) * (W3[j] as number) * (W3[k] as number)) / 8
						const px = n.cx + along * n.nx + across * tx
						const py = n.cy + along * n.ny + across * ty
						// M·b of each loop along the winding, the loops' mean
						let mb = 0
						for (let q = 0; q < G8.length; q++) {
							const sAx = ((G8[q] as number) * g.length) / 2
							const dx = px - (g.x + sAx * ux)
							const dy = py - (g.y + sAx * uy)
							const za = dx * ux + dy * uy
							// (the offset from the axis: in the plane across it, and out of the plane)
							const rx = dx - za * ux
							const ry = dy - za * uy
							const rz = z
							const rho = Math.sqrt(rx * rx + ry * ry + rz * rz)
							const [bz, br] = loopField(g.radius, za, rho, TURN_CORE)
							const mr = rho > 0 ? (mx * rx + my * ry) / rho : 0
							mb += ((W8[q] as number) / 2) * ((mx * ux + my * uy) * bz + mr * br)
						}
						sum += w * mb
					}
				}
			}
			phi += sum * vol
		}
		const loose = faces.filter((_, i) => !inPrism.has(i))
		if (loose.length) for (const q of pts) phi += q.w * bAlong(loose, [], q.x, q.y, q.z, ux, uy)
	}
	return phi
}

/** The field (T, world x, y, z) at (px, py, pz) of a straight wire from (ax, ay, az) to (bx, by, bz) carrying `amps` from a to b (Biot–Savart
 *  for its true length); within its own radius `core` it falls to zero at its middle, as inside a round wire. */
export const segmentField = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, amps: number, px: number, py: number, pz: number, core: number): [number, number, number] => {
	const lx = bx - ax
	const ly = by - ay
	const lz = bz - az
	const len = Math.sqrt(lx * lx + ly * ly + lz * lz)
	if (!(len > 0) || amps === 0) return [0, 0, 0]
	const ux = lx / len
	const uy = ly / len
	const uz = lz / len
	const r1x = px - ax
	const r1y = py - ay
	const r1z = pz - az
	const along = r1x * ux + r1y * uy + r1z * uz
	// the point's offset from the wire's line, and the angles its two ends are seen at
	const rx = r1x - along * ux
	const ry = r1y - along * uy
	const rz = r1z - along * uz
	const rho2 = rx * rx + ry * ry + rz * rz
	const d1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z)
	const r2x = px - bx
	const r2y = py - by
	const r2z = pz - bz
	const d2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z)
	if (!(rho2 > 0) || !(d1 > 0) || !(d2 > 0)) return [0, 0, 0]
	const cos1 = along / d1
	const cos2 = (r2x * ux + r2y * uy + r2z * uz) / d2
	const inside = rho2 < core * core ? rho2 / (core * core) : 1
	const k = ((MU0 * amps) / (4 * Math.PI)) * (cos1 - cos2) * (inside / rho2)
	// direction u × ρ
	return [k * (uy * rz - uz * ry), k * (uz * rx - ux * rz), k * (ux * ry - uy * rx)]
}

/** The pushes a wire's field gives a magnet's poles: each face's charge q = σ·w·d (A·m) at its centre feels q·B (N), in the plane. */
export const polePushes = (m: PoleMagnet, p: Pose, field: (x: number, y: number, z: number) => [number, number, number]): { x: number; y: number; fx: number; fy: number }[] => {
	const c = Math.cos(p.angle)
	const s = Math.sin(p.angle)
	const out: { x: number; y: number; fx: number; fy: number }[] = []
	for (const f of m.faces) {
		if (f.sigma === 0) continue
		const x = p.x + f.x * c - f.y * s
		const y = p.y + f.x * s + f.y * c
		const q = f.sigma * f.width * f.depth
		const [bx, by] = field(x, y, f.z)
		out.push({ x, y, fx: q * bx, fy: q * by })
	}
	return out
}

// ---------------------------------------------------------------- a silicon cell's response to light
/**
 * Crystalline silicon's responsivity (A per W of light), per band of the optics module's 8, R = QE·λ/1239.84 nm·A/W at each band's middle,
 * its external quantum efficiency [GREEN] Green M.A., Solar Cells (1982), typical: violet 0.70, blue 0.82, cyan 0.87, green 0.89, yellow 0.90,
 * orange 0.91, red 0.92; the infrared band (750 nm and beyond) only up to silicon's band edge near 1.1 µm, so its share depends on the light:
 * sunlight at the ground about 0.55 of its past-750 nm power below 1.1 µm (ASTM G173 AM1.5: water vapour takes much of the rest; provisional),
 * at a mean 0.59 A/W; a filament at 2856 K 0.236 (CIE illuminant A, Planck's law: 0.139 A/W of its infrared); a 3000 K halogen 0.259 (0.152 A/W).
 */
export const SI_RESPONSE = [0.2343, 0.3125, 0.3561, 0.3894, 0.4192, 0.4459, 0.5101] as const
export const SI_INFRARED: Readonly<Record<string, number>> = { sun: 0.325, incandescent: 0.139, halogen: 0.152, led: 0.325, white: 0.325 }
/** An infrared laser (808, 850, 980 nm) is all below the band edge: silicon's mean 0.59 A/W there. */
const SI_IR_LASER = 0.59

/** A watt of light of a source of this record, band b: the current (A) a silicon cell makes of it. */
export const siResponse = (src: SourceRecord | undefined, b: number): number => {
	if (b < IR) return SI_RESPONSE[b] as number
	if (src === undefined) return SI_INFRARED.sun as number
	if (src.kind === "laser") return SI_IR_LASER
	const kind = (src as { light?: unknown }).light
	return typeof kind === "string" && SI_INFRARED[kind] !== undefined ? (SI_INFRARED[kind] as number) : (SI_INFRARED.sun as number)
}

/** A silicon cell's current per W/m² of standard sunlight (AM1.5, 1000 W/m², as the optics module's sun gives it), per m² of its face: 0.347. */
export const SI_STC = (() => {
	const sun = powerOf({ id: "stc", item: "stc", solid: "", kind: "sun", x: 0, y: 0, dir: 0, spread: 0, out: 0, size: 0, blur: 0, irradiance: 1000, light: "sun" } as unknown as SourceRecord)
	let a = 0
	for (let b = 0; b < NB; b++) a += (sun[b] as number) * (b < IR ? (SI_RESPONSE[b] as number) : (SI_INFRARED.sun as number))
	return a / 1000
})()
void BANDS
