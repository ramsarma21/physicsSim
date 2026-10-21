/**
 * Magnetism and static electricity in the machine plane (pure math, SI units: m, kg, s, A, C, T, N): what a magnet, a piece of soft
 * iron, a coil on a nail, a rubbed balloon and a scrap of paper do to one another. physics.ts asks it, before each (sub-)step, for the
 * force and the turning each of them gets, and applies those to their bodies; nothing here knows planck.
 *
 * Magnets are modelled as Gilbert (magnetic-charge) bodies: a uniformly magnetized block has no charge inside, only on the faces its
 * magnetization M crosses, σ = M·n (A/m), and the field of a uniformly charged rectangle is known exactly in closed form (the solid angle
 * and two logarithms: Furlani, Permanent Magnet and Electromechanical Devices, 2001, §2.7; Engel-Herbert & Hesjedal, J. Appl. Phys. 97,
 * 074504, 2005, eq. 9-11). B = μ0·H outside the magnets, the force on a face is ∫ σ·B dA (a pole of q A·m in B tesla feels q·B newtons),
 * so two touching faces pull with the Maxwell stress B_r²·A/(2μ0), and far apart the blocks act as the dipoles m = M·V they are.
 * - A permanent magnet (`MagnetSpec`): faces with fixed σ (σ = B_r/μ0 on its north face, −B_r/μ0 on its south one).
 * - Soft iron and steel (`SoftSpec`: paper clips, nails, steel balls, a coil's core): uniformly magnetized by the field around it,
 *   M = H/(N + 1/χ) along each of its own axes (N its demagnetizing factor along that axis: Aharoni's exact factors for a rectangular
 *   prism, J. Appl. Phys. 83, 3432, 1998; 1/3 for a ball), at most its saturation M_s. So it is pulled toward the stronger field whichever
 *   pole is near, a long thing turns to lie along the field, and the field it takes on is a source in its turn (a chain of clips hangs from
 *   a magnet). Solved by Gauss-Seidel sweeps each step, warm-started from the step before (the field changes little in 1/480 s).
 * - A coil (an electromagnet's winding, `SoftSpec.coil`): its own field n·I (A/m, n turns per metre) along its core, which the core
 *   multiplies, and outside it the field of a block magnetized n·I (a long solenoid's equivalent).
 * - The Earth (`FieldsSpec.earth`): a uniform field, which turns magnets (a compass needle) and pulls nothing.
 * Every pair of magnetic bodies is reckoned once: the smaller one (the target) is sampled over its faces in the larger one's exact field,
 * and the larger one gets exactly the opposite force and turning (taken about the target's centre), so no pair can push or spin itself.
 *
 * Static electricity: charges (`ChargeSpec`: a rubbed balloon, a charged rod or pith ball) pull and push by Coulomb's law, k·q₁q₂/r²
 * (a charge spread over a body of radius r acts as a point outside it); a neutral light thing (`PolarSpec`: a scrap of paper, a bit of
 * foil, a puffed rice grain) is polarized by the field, p = α·E with α = ε0·V·(ε_r − 1)/(1 + N(ε_r − 1)) along each of its axes
 * (a conductor: ε0·V/N), so it is pulled toward the stronger field and turned to stand along it, by F = (p·∇)E. Charges move between
 * bodies that touch (`touch`): two conductors share theirs in proportion to their capacitances, a conductor that touches a grounded one
 * loses all of its, an insulator only what sits where it touched; and a charged conductor sparks to a conductor near it once the
 * voltage across the gap passes air's breakdown voltage (Paschen's law).
 */

/** Vacuum permeability, T·m/A (CODATA 2018: 1.25663706212e-6; 4π·10⁻⁷ is within 6·10⁻¹⁰ of it). */
export const MU0 = 1.25663706212e-6
/** Vacuum permittivity, F/m (CODATA 2018). */
export const EPS0 = 8.8541878128e-12
/** Coulomb's constant 1/(4π ε0), N·m²/C². */
export const KE = 1 / (4 * Math.PI * EPS0)
/**
 * Air's breakdown in a uniform gap at 1 atm: Paschen's law V = B·p·d / (ln(A·p·d) − ln(ln(1 + 1/γ))) with A = 15 /(cm·Torr), B = 365 V/(cm·Torr)
 * (so, per metre at 760 Torr, A·p = 15 × 100 × 760 = 1.14e6 /m and B·p = 2.774e7 V/m) and γ = 0.01 (Lieberman & Lichtenberg, Principles of
 * Plasma Discharges, 2005, §14.3; Raizer, Gas Discharge Physics, 1991, table 4.1): 5.0 kV across 1 mm, 36 kV across 1 cm (measured: about
 * 4.5 and 31 kV; the law with these constants is a little high, so a spark here needs a little more than in air).
 */
const PASCHEN_AP = 15 * 760 * 100
const PASCHEN_BP = 365 * 760 * 100
const PASCHEN_GAMMA = 0.01

// ---------------------------------------------------------------- deterministic logarithm
// The bundle makes Math.sin, cos, atan2, exp, hypot and pow the same bits in every browser (tools/fdlibm.ts); Math.log is not among them,
// so this file has its own: fdlibm 5.3's e_log.c in plain IEEE arithmetic (no fused multiply-add), which every JavaScript engine computes
// the same, to within 1 ulp of the true logarithm (research/rw-validate-magnetism.ts `core` checks it against Math.log).
const f64 = new Float64Array(1)
const u32 = new Uint32Array(f64.buffer)
const HI = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 1 : 0
const LO = 1 - HI
const LN2_HI = 6.93147180369123816490e-1
const LN2_LO = 1.90821492927058770002e-10
const TWO54 = 1.80143985094819840000e16
const LG1 = 6.666666666666735130e-1
const LG2 = 3.999999999940941908e-1
const LG3 = 2.857142874366239149e-1
const LG4 = 2.222219843214978396e-1
const LG5 = 1.818357216161805012e-1
const LG6 = 1.531383769920937332e-1
const LG7 = 1.479819860511658591e-1

/** The natural logarithm, the same bits on every machine (fdlibm's __ieee754_log). */
export const ln = (x0: number): number => {
	let x = x0
	f64[0] = x
	let hx = u32[HI] | 0
	const lx = u32[LO] >>> 0
	let k = 0
	if (hx < 0x00100000) {
		if (((hx & 0x7fffffff) | lx) === 0) return Number.NEGATIVE_INFINITY
		if (hx < 0) return Number.NaN
		k -= 54
		x *= TWO54
		f64[0] = x
		hx = u32[HI] | 0
	}
	if (hx >= 0x7ff00000) return x + x
	k += (hx >> 20) - 1023
	hx &= 0x000fffff
	const i0 = (hx + 0x95f64) & 0x100000
	f64[0] = x
	u32[HI] = (hx | (i0 ^ 0x3ff00000)) >>> 0
	x = f64[0]
	k += i0 >> 20
	const f = x - 1.0
	if ((0x000fffff & (2 + hx)) < 3) {
		if (f === 0) {
			if (k === 0) return 0
			return k * LN2_HI + k * LN2_LO
		}
		const R = f * f * (0.5 - 0.33333333333333333 * f)
		if (k === 0) return f - R
		return k * LN2_HI - (R - k * LN2_LO - f)
	}
	const s = f / (2.0 + f)
	const dk = k
	const z = s * s
	let i = hx - 0x6147a
	const w = z * z
	const j = 0x6b851 - hx
	const t1 = w * (LG2 + w * (LG4 + w * LG6))
	const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)))
	i |= j
	const R = t2 + t1
	if (i > 0) {
		const hfsq = 0.5 * f * f
		if (k === 0) return f - (hfsq - s * (hfsq + R))
		return dk * LN2_HI - (hfsq - (s * (hfsq + R) + dk * LN2_LO) - f)
	}
	if (k === 0) return f - s * (f - R)
	return dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f)
}

const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.5707963267948965580]
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17]
const AT = [
	3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1, 9.09088713343650656196e-2,
	-7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.6531572744216915527e-2,
	1.62858201153657823623e-2
]
/**
 * The arctangent, the same bits on every machine (fdlibm 5.3's s_atan.c in plain IEEE arithmetic; Math.atan is not among the functions
 * the bundle makes alike, and tools/fdlibm.ts's atan2 copies V8's fused multiply-adds in software, ten times slower: this file calls it
 * millions of times a run).
 */
export const atan = (x0: number): number => {
	let x = x0
	f64[0] = x
	const hx = u32[HI] | 0
	const ix = hx & 0x7fffffff
	let id: number
	if (ix >= 0x44100000) {
		if (ix > 0x7ff00000 || (ix === 0x7ff00000 && u32[LO] !== 0)) return x + x
		return hx > 0 ? (ATANHI[3] as number) + (ATANLO[3] as number) : -(ATANHI[3] as number) - (ATANLO[3] as number)
	}
	if (ix < 0x3fdc0000) {
		if (ix < 0x3e400000) return x
		id = -1
	} else {
		x = x < 0 ? -x : x
		if (ix < 0x3ff30000) {
			if (ix < 0x3fe60000) {
				id = 0
				x = (2 * x - 1) / (2 + x)
			} else {
				id = 1
				x = (x - 1) / (x + 1)
			}
		} else if (ix < 0x40038000) {
			id = 2
			x = (x - 1.5) / (1 + 1.5 * x)
		} else {
			id = 3
			x = -1 / x
		}
	}
	let z = x * x
	const w = z * z
	const s1 = z * ((AT[0] as number) + w * ((AT[2] as number) + w * ((AT[4] as number) + w * ((AT[6] as number) + w * ((AT[8] as number) + w * (AT[10] as number))))))
	const s2 = w * ((AT[1] as number) + w * ((AT[3] as number) + w * ((AT[5] as number) + w * ((AT[7] as number) + w * (AT[9] as number)))))
	if (id < 0) return x - x * (s1 + s2)
	z = (ATANHI[id] as number) - (x * (s1 + s2) - (ATANLO[id] as number) - x)
	return hx < 0 ? -z : z
}

/** atan(y/x) for x ≥ 0 (the quadrant a rectangle's solid angle needs): ±π/2 at x = 0 (0 when y is too). */
const atanOver = (y: number, x: number) => (x > 0 ? atan(y / x) : y > 0 ? Math.PI / 2 : y < 0 ? -Math.PI / 2 : 0)

// ---------------------------------------------------------------- the field of a charged rectangle
/** No point is ever this close to the line of a face's edge (m²): the logarithm's singularity there is held finite. */
const EDGE_GUARD = 1e-24
/** Y + √(X² + Y² + W²), taken without cancelling where Y is large and negative: (X² + W²)/(R − Y). */
const sumOf = (y: number, r: number, rest: number) => (y >= 0 ? y + r : (rest > EDGE_GUARD ? rest : EDGE_GUARD) / (r - y))

/**
 * The field, per unit surface charge and 4π, of a uniformly charged rectangle u ∈ [−a, a], v ∈ [−b, b] in the plane w = 0, at the point
 * (U, V, W) of its frame: out[0] = H_u, out[1] = H_v, out[2] = H_w (multiply by σ/(4π) for A/m). Exact: H_w is the solid angle the
 * rectangle subtends, Σ ± atan(XY/(W·R)), H_u = Σ ∓ ln(Y + R) and H_v = Σ ∓ ln(X + R) over its corners (X = U ∓ a, Y = V ∓ b; each sum's
 * four logarithms taken as one, of their product's ratio). On the rectangle's own plane (W = 0) H_w is that of the side W > 0.
 */
export const rectField = (a: number, b: number, U: number, V: number, W: number, out: Float64Array | number[]) => {
	let hw = 0
	// the products of (Y + R) and of (X + R) over the corners whose sign is + (pu, pv) and − (nu, nv)
	let pu = 1
	let nu = 1
	let pv = 1
	let nv = 1
	const w2 = W * W
	const aw = W < 0 ? -W : W
	for (let i = 0; i < 2; i++) {
		const X = i === 0 ? U - a : U + a
		const x2 = X * X
		for (let j = 0; j < 2; j++) {
			const Y = j === 0 ? V - b : V + b
			const y2 = Y * Y
			const R = Math.sqrt(x2 + y2 + w2)
			const yr = sumOf(Y, R, x2 + w2)
			const xr = sumOf(X, R, y2 + w2)
			// the corner's sign: + for (X2, Y2) and (X1, Y1), − for the other two
			if (i === j) {
				hw += atanOver(X * Y, aw * R)
				pu *= yr
				pv *= xr
			} else {
				hw -= atanOver(X * Y, aw * R)
				nu *= yr
				nv *= xr
			}
		}
	}
	out[0] = -ln(pu / nu)
	out[1] = -ln(pv / nv)
	out[2] = W < 0 ? -hw : hw
	return out
}

// ---------------------------------------------------------------- demagnetizing factors
/**
 * The demagnetizing factor along c of a rectangular prism 2a × 2b × 2c (Aharoni, J. Appl. Phys. 83, 3432, 1998, eq. 1): the share of
 * its own magnetization by which a uniformly magnetized block's average field opposes it. The three axes' sum to 1; a cube's are 1/3.
 */
export const prismDemag = (a: number, b: number, c: number): number => {
	const abc = Math.sqrt(a * a + b * b + c * c)
	const ab = Math.sqrt(a * a + b * b)
	const bc = Math.sqrt(b * b + c * c)
	const ac = Math.sqrt(a * a + c * c)
	let s = 0
	s += ((b * b - c * c) / (2 * b * c)) * ln((abc - a) / (abc + a))
	s += ((a * a - c * c) / (2 * a * c)) * ln((abc - b) / (abc + b))
	s += (b / (2 * c)) * ln((ab + a) / (ab - a))
	s += (a / (2 * c)) * ln((ab + b) / (ab - b))
	s += (c / (2 * a)) * ln((bc - b) / (bc + b))
	s += (c / (2 * b)) * ln((ac - a) / (ac + a))
	s += 2 * atan((a * b) / (c * abc))
	s += (a * a * a + b * b * b - 2 * c * c * c) / (3 * a * b * c)
	s += ((a * a + b * b - 2 * c * c) / (3 * a * b * c)) * abc
	s += (c / (a * b)) * (ac + bc)
	s -= (ab * ab * ab + bc * bc * bc + ac * ac * ac) / (3 * a * b * c)
	return s / Math.PI
}

/** A block w × h × d's demagnetizing factors along its own x (w), y (h) and z (d); a ball's are 1/3 each. */
export const demagFactors = (w: number, h: number, d: number): [number, number, number] => {
	const a = w / 2
	const b = h / 2
	const c = d / 2
	const nx = prismDemag(b, c, a)
	const ny = prismDemag(c, a, b)
	return [nx, ny, 1 - nx - ny]
}

// ---------------------------------------------------------------- what the document says
/**
 * A charged face of a solid: its centre (x, y, z) in the solid's own frame (m; z across the machine plane, 0 by default), its outward
 * normal in the plane at `angle` (rad, the solid's frame), its extent `width` along the plane and `depth` across it (m), and its charge
 * density `sigma` (A/m: the magnetization's component along the normal; positive on a north face).
 */
export interface FaceSpec {
	readonly x: number
	readonly y: number
	readonly z?: number
	readonly angle: number
	readonly width: number
	readonly depth: number
	readonly sigma: number
}

/**
 * A permanent magnet: its faces (their σ never changes). `round`: a ball magnet (no turning from a pair's reckoning). `needle`: a compass
 * needle on its pivot, free to turn: pointing exactly against the field (an unstable balance a deterministic run would never leave, where a
 * real needle always starts a little off) it is turned as one NEEDLE_KICK off it would be (`needleKick`).
 */
export interface MagnetSpec {
	readonly solid: string
	readonly faces: readonly FaceSpec[]
	readonly round?: boolean
	readonly needle?: boolean
}

/** A piece of a coil's current: from `t` (s) on, `amps` (A) until the next. Before the first, none. */
export interface CurrentStep {
	readonly t: number
	readonly amps: number
}

/**
 * Soft iron or steel: magnetized by the field it is in. Its magnetization fills the block `w` × `h` × `d` centred at (x, y) of the
 * solid's frame, along its axes (a ball: a cube of its volume, along the world's axes, `round`); `volume` is the magnetic material in it
 * (m³: a paper clip's wire, less than its block), `ms` its saturation magnetization (A/m) and `chi` its initial susceptibility.
 * `coil`: a winding of `turns` over `length` (m) along its x axis carrying `current`: an electromagnet's core.
 */
export interface SoftSpec {
	readonly solid: string
	readonly x: number
	readonly y: number
	readonly w: number
	readonly h: number
	readonly d: number
	readonly round?: boolean
	readonly volume: number
	readonly ms: number
	readonly chi: number
	readonly coil?: { readonly turns: number; readonly length: number; readonly current?: readonly CurrentStep[] }
	/** false: never a sheet's grid, whatever its shape (the catalog's word for sheet metal no magnet faces at the start: a row is enough) */
	readonly grid?: boolean
}

/**
 * A charge on a solid: `q` coulombs at (x, y) of its frame, spread over a body of `radius` m (a point outside it). `conductor`: it shares
 * charge with conductors it touches; `capacitance` (F) is its share's weight (an isolated sphere's 4π·ε0·r). `grounded`: a conductor
 * joined to the Earth (it takes any charge away and has none).
 */
export interface ChargeSpec {
	readonly solid: string
	readonly x: number
	readonly y: number
	readonly q: number
	readonly radius: number
	readonly conductor?: boolean
	readonly capacitance: number
	readonly grounded?: boolean
}

/**
 * A neutral thing the field polarizes: the block `w` × `h` × `d` at (x, y) of its solid's frame (a ball: `round`), `volume` m³ of it,
 * relative permittivity `epsr` (0: a conductor, which damp paper is for a scrap's few seconds).
 */
export interface PolarSpec {
	readonly solid: string
	readonly x: number
	readonly y: number
	readonly w: number
	readonly h: number
	readonly d: number
	readonly round?: boolean
	readonly volume: number
	readonly epsr: number
}

/** Everything a scene has of magnetism and static electricity (doc.magnetism). */
export interface FieldsSpec {
	readonly magnets?: readonly MagnetSpec[]
	readonly soft?: readonly SoftSpec[]
	/** The Earth's field in the machine plane, T (x along the table, y up). */
	readonly earth?: { readonly x: number; readonly y: number }
	readonly charges?: readonly ChargeSpec[]
	readonly polar?: readonly PolarSpec[]
}

/** A solid's pose in the world: m, m, rad counterclockwise. */
export interface Pose {
	readonly x: number
	readonly y: number
	readonly angle: number
}

/**
 * A force (N) at a world point (m) and a turning (N·m, counterclockwise) on a solid's body; `stiffness` (N·m/rad): how fast that turning
 * grows as the body turns away from where the field would hold it (|m|·|B| at it), so the engine can take it implicitly where a light,
 * strongly magnetized thing would turn faster than its step can follow (a steel washer at a neodymium pole: 0.3 N·m/rad on 4e-8 kg·m²).
 */
export type Apply = (solid: string, fx: number, fy: number, px: number, py: number, torque: number, stiffness: number) => void

/** A spark: when (s), between which solids, where (the gap's middle, m), the voltage it broke down at (V) and the energy it let go (J). */
export interface Spark {
	readonly t: number
	readonly a: string
	readonly b: string
	readonly x: number
	readonly y: number
	readonly volts: number
	readonly joules: number
}

// ---------------------------------------------------------------- the world's faces, step by step
/** One face in the world, this step. */
interface Face {
	cx: number
	cy: number
	cz: number
	nx: number
	ny: number
	/** half its width along the plane (along the tangent (−ny, nx)) and half its depth across it; a face across the plane (`zn`): half its
	 *  size along (nx, ny) and along (−ny, nx) */
	a: number
	b: number
	/** 0: its normal lies in the plane, (nx, ny); ±1: its normal is across the plane, ±z (a sheet's piece's front and back) */
	zn: number
	sigma: number
	/** its charge, σ·area (A·m) */
	q: number
	/** half its diagonal (m): how far its charge reaches from its centre */
	reach: number
}

/** A magnetic body this step: a permanent magnet or a piece of soft iron, its faces in the world, and how far they reach from its centre. */
interface MagBody {
	readonly solid: string
	/** the field at it from every other body this step (T): its turning's stiffness is |m|·|B| */
	bx: number
	by: number
	readonly round: boolean
	readonly soft: number
	faces: Face[]
	cx: number
	cy: number
	/** its middle across the plane (a sheet's piece off the plane; 0 for every other body) */
	cz: number
	reach: number
	/** past this many times its reach it is reckoned as its dipole (FAR_BODY; a sheet's piece FAR_GRID) */
	readonly farK: number
	/** some face of it is charged, this step */
	live: boolean
	/** its dipole moment (A·m², world; mz across the plane: a sheet's piece) */
	mx: number
	my: number
	mz: number
}

const newFace = (): Face => ({ cx: 0, cy: 0, cz: 0, nx: 1, ny: 0, a: 0, b: 0, zn: 0, sigma: 0, q: 0, reach: 0 })

/** Gauss-Legendre rules on [−1, 1] (for a face's integral): 2, 3 and 5 points' nodes and weights. */
const G2 = [-0.5773502691896257, 0.5773502691896257]
const W2 = [1, 1]
const G3 = [-0.7745966692414834, 0, 0.7745966692414834]
const W3 = [5 / 9, 8 / 9, 5 / 9]
const G5 = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664]
const W5 = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891]

/**
 * Near a face its field is reckoned exactly; past FAR_FACE times its half-diagonal as a point charge with its quadrupole (the next term is
 * under (1/FAR_FACE)⁴ of it: within 0.5 %), blended over the next unit so the field is smooth.
 */
const FAR_FACE = 3
/**
 * A body seen from farther than FAR_BODY times its own reach is reckoned as the dipole it is, blended in over the next unit; two bodies
 * farther apart than FAR_BODY times their reaches together, as two dipoles. A long magnet's next term (its octupole) falls only as
 * (L/r)² behind the dipole's: 9 % at 4 reaches, 2 % at 12 (research/rw-validate-magnetism.ts `core`); nearer, each face is reckoned on its
 * own (a point charge and its quadrupole past FAR_FACE: within 0.5 %).
 */
const FAR_BODY = 12
/**
 * A sheet's grid piece (a block about as wide as it is deep, its faces' charges symmetric: no quadrupole) is reckoned as its dipole past
 * FAR_GRID times its reach (and a pair with one past FAR_GRID times their reaches): its next term, the octupole, is under 3 % of the dipole
 * there; a sheet is many such pieces, which face by face could not be reckoned at the 480 Hz step.
 */
const FAR_GRID = 4
/** A target face is sampled at one point past this many times its half-diagonal from the source (the rule's error is under 1 %), with 3 × 2
 * Gauss points nearer, and 5 × 3 within NEAR_FACE of it (two faces about to touch: the field changes fast near the source's edges). */
const ONE_POINT = 8
const NEAR_FACE = 1.5
/** sin 5°: a compass needle within 5° of pointing exactly against the field is turned as one 5° off would be (`needleKick`). */
const NEEDLE_KICK_SIN = 0.08715574274765817
/** A soft body's magnetization is updated in this many Gauss-Seidel sweeps a step (warm-started from the step before). */
const SWEEPS = 1
/** Sweeps at the first step (from no magnetization at all). */
const FIRST_SWEEPS = 40
/** A soft body's change of magnetization is relaxed by this much a sweep (the sweep's fixed point is the field's own). */
const RELAX = 0.7
/**
 * N and N·m: a pair of magnetic bodies whose dipoles, as far apart as they are, could pull with less than this and turn with less than
 * NEGLIGIBLE_TORQUE is not reckoned (a paper clip weighs 4 mN; a compass needle's 1e-10 N·m turns it 0.01 rad/s² against its bearing).
 */
const NEGLIGIBLE_FORCE = 1e-8
const NEGLIGIBLE_TORQUE = 1e-11

/** m: how far in front of a face a point that the skins carried a little behind it is met (`addFaceField`): the gap two resting faces keep. */
const FRONT = 1e-4

/** The field (A/m, per 4π: multiply by 1/(4π) at the end) of one face at a world point, added to out[0], out[1] (a point a little behind it,
 *  within its extent, met just in front of it), and with `withZ` its component across the plane to out[2] (a sheet's grid). */
const addFaceField = (f: Face, px: number, py: number, pz: number, out: Float64Array, tmp: Float64Array, withZ = false) => {
	if (f.sigma === 0) return
	if (f.zn !== 0) {
		addZFaceField(f, px, py, pz, out, tmp, withZ)
		return
	}
	let dx = px - f.cx
	let dy = py - f.cy
	const dz = pz - f.cz
	{
		// (a point a little behind the face, within its extent, is inside the body that carries it: never so in the world, only where the
		// contact skins (SKIN) and the solver's slop let two bodies' faces pass; it is met just in front of the face, where it pulls as
		// touching, never behind it, where the face's field turns round and would push where it should pull. A point well behind it, past
		// three skins, is behind it: the far side of a thin body)
		const W = dx * f.nx + dy * f.ny
		if (W < FRONT && W > -3 * SKIN) {
			const U = -dx * f.ny + dy * f.nx
			if (U < f.a && U > -f.a && dz < f.b && dz > -f.b) {
				dx += (FRONT - W) * f.nx
				dy += (FRONT - W) * f.ny
			}
		}
	}
	const r2 = dx * dx + dy * dy + dz * dz
	const far = FAR_FACE * f.reach
	if (r2 <= far * far) {
		rectExact(f, dx, dy, dz, tmp)
		out[0] += tmp[0]
		out[1] += tmp[1]
		if (withZ) out[2] += tmp[3] as number
		return
	}
	// a point charge and its quadrupole (the face's frame: W along the normal, U along the tangent, V across the plane); traceless
	// quadrupole of a uniformly charged a × b rectangle: Q_uu = q(2a² − b²)/3, Q_vv = q(2b² − a²)/3, Q_ww = −q(a² + b²)/3, so
	// H = q·x/r³ + (5/2)(xᵀQx)·x/r⁷ − Qx/r⁵
	const r = Math.sqrt(r2)
	const W = dx * f.nx + dy * f.ny
	const U = -dx * f.ny + dy * f.nx
	const a2 = f.a * f.a
	const b2 = f.b * f.b
	const quu = (f.q * (2 * a2 - b2)) / 3
	const qvv = (f.q * (2 * b2 - a2)) / 3
	const qww = (-f.q * (a2 + b2)) / 3
	const r5 = r2 * r2 * r
	const S = quu * U * U + qvv * dz * dz + qww * W * W
	const k = f.q / (r2 * r) + (2.5 * S) / (r5 * r2)
	const hw = k * W - (qww * W) / r5
	const hu = k * U - (quu * U) / r5
	const mx = hw * f.nx - hu * f.ny
	const my = hw * f.ny + hu * f.nx
	const mz = withZ ? k * dz - (qvv * dz) / r5 : 0
	const outer = (FAR_FACE + 1) * f.reach
	if (r >= outer) {
		out[0] += mx
		out[1] += my
		if (withZ) out[2] += mz
		return
	}
	const s = (r - far) / f.reach
	const blend = s * s * (3 - 2 * s)
	rectExact(f, dx, dy, dz, tmp)
	out[0] += blend * mx + (1 - blend) * (tmp[0] as number)
	out[1] += blend * my + (1 - blend) * (tmp[1] as number)
	if (withZ) out[2] += blend * mz + (1 - blend) * (tmp[3] as number)
}

/** addFaceField for a face across the plane (normal ±z: a sheet's piece's front or back): its frame U along (nx, ny), V along (−ny, nx), W along
 *  its normal; exact near, its charge and quadrupole far, blended. */
const addZFaceField = (f: Face, px: number, py: number, pz: number, out: Float64Array, tmp: Float64Array, withZ: boolean) => {
	const dx = px - f.cx
	const dy = py - f.cy
	const dz = pz - f.cz
	const U = dx * f.nx + dy * f.ny
	const V = -dx * f.ny + dy * f.nx
	const W = f.zn * dz
	const r2 = dx * dx + dy * dy + dz * dz
	const far = FAR_FACE * f.reach
	let ex = 0
	let ey = 0
	let ez = 0
	const exact = () => {
		rectField(f.a, f.b, U, V, W, tmp)
		const hu = tmp[0] as number
		const hv = tmp[1] as number
		const hw = tmp[2] as number
		ex = f.sigma * (hu * f.nx - hv * f.ny)
		ey = f.sigma * (hu * f.ny + hv * f.nx)
		ez = f.sigma * f.zn * hw
	}
	if (r2 <= far * far) {
		exact()
		out[0] += ex
		out[1] += ey
		if (withZ) out[2] += ez
		return
	}
	const r = Math.sqrt(r2)
	const a2 = f.a * f.a
	const b2 = f.b * f.b
	const quu = (f.q * (2 * a2 - b2)) / 3
	const qvv = (f.q * (2 * b2 - a2)) / 3
	const qww = (-f.q * (a2 + b2)) / 3
	const r5 = r2 * r2 * r
	const S = quu * U * U + qvv * V * V + qww * W * W
	const k = f.q / (r2 * r) + (2.5 * S) / (r5 * r2)
	const hu = k * U - (quu * U) / r5
	const hv = k * V - (qvv * V) / r5
	const hw = k * W - (qww * W) / r5
	const mx = hu * f.nx - hv * f.ny
	const my = hu * f.ny + hv * f.nx
	const mz = f.zn * hw
	const outer = (FAR_FACE + 1) * f.reach
	if (r >= outer) {
		out[0] += mx
		out[1] += my
		if (withZ) out[2] += mz
		return
	}
	const s = (r - far) / f.reach
	const blend = s * s * (3 - 2 * s)
	exact()
	out[0] += blend * mx + (1 - blend) * ex
	out[1] += blend * my + (1 - blend) * ey
	if (withZ) out[2] += blend * mz + (1 - blend) * ez
}

/** A face's exact field (per 4π) at the offset (dx, dy, dz) from its centre, in world x and y: tmp[0], tmp[1] (and z: tmp[3]). */
const rectExact = (f: Face, dx: number, dy: number, dz: number, tmp: Float64Array) => {
	// its frame: W along the normal, U along the tangent (−ny, nx), V across the plane
	const W = dx * f.nx + dy * f.ny
	const U = -dx * f.ny + dy * f.nx
	rectField(f.a, f.b, U, dz, W, tmp)
	const hu = tmp[0] as number
	const hv = tmp[1] as number
	const hw = tmp[2] as number
	tmp[0] = f.sigma * (hw * f.nx - hu * f.ny)
	tmp[1] = f.sigma * (hw * f.ny + hu * f.nx)
	tmp[3] = f.sigma * hv
}

/** A dipole m's field (per 4π, A/m) at the offset (dx, dy, dz) from it: (3(m·r̂)r̂ − m)/r³, added to out (and its z with `withZ`). */
const addDipoleField = (mx: number, my: number, dx: number, dy: number, out: Float64Array, weight: number, dz = 0, mz = 0, withZ = false) => {
	const r2 = dx * dx + dy * dy + dz * dz
	const r = Math.sqrt(r2)
	const r3 = r2 * r
	const md = (mx * dx + my * dy + mz * dz) / r2
	out[0] += (weight * (3 * md * dx - mx)) / r3
	out[1] += (weight * (3 * md * dy - my)) / r3
	if (withZ) out[2] += (weight * (3 * md * dz - mz)) / r3
}

/** Places a face given in a solid's frame into the world (`zn`: a face across the plane, its width along `angle`, its depth across that). */
const placeFace = (out: Face, spec: { x: number; y: number; z?: number; angle: number; width: number; depth: number; zn?: number }, pose: Pose, c: number, s: number, sigma: number) => {
	out.cx = pose.x + spec.x * c - spec.y * s
	out.cy = pose.y + spec.x * s + spec.y * c
	out.cz = spec.z ?? 0
	const na = Math.cos(spec.angle)
	const nb = Math.sin(spec.angle)
	out.nx = na * c - nb * s
	out.ny = na * s + nb * c
	out.a = spec.width / 2
	out.b = spec.depth / 2
	out.zn = spec.zn ?? 0
	out.sigma = sigma
	out.q = sigma * spec.width * spec.depth
	out.reach = Math.sqrt(out.a * out.a + out.b * out.b)
}

/**
 * A soft body's piece's state: its spec, its block (a long thin body is cut into up to MAX_SEGMENTS pieces along its length, each magnetized
 * on its own, so a clip under a small pole magnetizes most where the pole is: a clip, a nail magnetized uniformly would average the field
 * over its whole length), its demagnetizing factors, its magnetization (A/m, along its own axes) carried from step to step.
 */
interface SoftState {
	readonly spec: SoftSpec
	/** its piece's block: centre (x, y) in the solid's frame and its size */
	readonly x: number
	readonly y: number
	readonly w: number
	readonly h: number
	readonly d: number
	readonly nx: number
	readonly ny: number
	/** its own factor across the plane (a sheet's piece: it is magnetized across the plane too; 0 otherwise) */
	readonly nz: number
	/** the share of its block its material fills */
	readonly fill: number
	/** its magnetization along its own x and y (or the world's, round), A/m; and across the plane (a sheet's piece) */
	mx: number
	my: number
	mz: number
	/** where its block's centre is, and its axes, this step */
	px: number
	py: number
	c: number
	s: number
	/** its four faces' specs in its own frame (a skin out: SKIN), a sheet's piece's two across the plane too, and the scales of their charges
	 *  along x and y */
	readonly specs: readonly { x: number; y: number; z?: number; angle: number; width: number; depth: number; zn?: number }[]
	readonly scaleX: number
	readonly scaleY: number
	/** the points (block frame, z across the plane) its field is averaged over, their weights, and (a row's) where they are among its cells */
	readonly samples: readonly { x: number; y: number; z: number; w: number; at: number }[]
	/** a coil's current set from outside (another module's circuit: `setCurrent`), A; undefined: its own schedule */
	amps?: number
	/** its place among its body's pieces (along its length, and across the plane: a sheet's grid), and the body's pieces with their mutual
	 *  demagnetizing factors (`Pieces`) */
	readonly index: number
	readonly iz: number
	/** its block's middle across the plane (m: a sheet's grid; 0 otherwise) */
	readonly z: number
	readonly group: Pieces
	/** its body's row of pieces runs along its own x (else its y); the piece's length along the row and its two sizes across it (in the
	 *  plane, and across the plane) */
	readonly alongX: boolean
	readonly length: number
	readonly thick: number
	/** this step: the end pieces of other soft bodies touching one of its ends end-on (a chain of clips, a clip on a nail's point): `Link` */
	links: Link[]
	/** its body solved as a row (`Row`; undefined: a ball, a sheet's grid), and its middle's place along the row from its start (m) */
	readonly row?: Row
	readonly pos: number
}

/**
 * One end of a soft body's row touching another row's end piece end-on, lined up (a chain of clips, a clip hanging from an electromagnet's
 * point): the field the other's end piece makes in this row's cells is reckoned with the exact mutual factors of coaxial uniformly
 * magnetized prisms the gap apart (`coaxialIdentity`), not sampled at points (the field of a clip's 1 mm end face 0.1 mm away
 * changes within a fraction of a millimetre: no few points can average it, and too near they overstate it, so a chain fed itself).
 */
interface Link {
	/** the other row, its first piece's place among the soft pieces, and its pieces' bodies (left out of this row's sampled field) */
	readonly other: Row
	readonly soft: number
	readonly bodies: readonly MagBody[]
	/** which end of this row (−1 its start, 1 its end) and of the other's meet; the gap between their faces (m) */
	readonly end: number
	readonly otherEnd: number
	readonly gap: number
	/** the section the factors are reckoned for (the larger of the two), and the share of it the other's section is, for this row (≤ 1) */
	readonly thick: number
	readonly depth: number
	readonly share: number
	/** this row's direction in the world */
	readonly ux: number
	readonly uy: number
}

/**
 * A soft body cut into pieces along one of its axes: the pieces in order, and the average field one piece's uniform magnetization makes in
 * another `m` pieces away, per unit of it, along each axis (`nx[m]`, `ny[m]`, in the body's frame; m = 0: a piece's own demagnetizing
 * factors). Exact for uniformly magnetized pieces: from the self factors of the prisms k pieces long (Aharoni), since the average field of a
 * uniformly magnetized row of k pieces sums over every pair, k·N(k) = k·N₀ + 2·Σ_{m<k} (k − m)·N_m. (Sampled at points instead, a
 * neighbour's face touching the piece is too near any rule: a rod came out magnetized twice what it is.)
 */
interface Pieces {
	/** [a][b]: a pieces apart along the row, b across the plane (a sheet's grid; b is always 0 for a row) */
	readonly nx: readonly (readonly number[])[]
	readonly ny: readonly (readonly number[])[]
	/** across the plane: a sheet's grid only */
	readonly nz: readonly (readonly number[])[]
	readonly members: SoftState[]
}

/** The mutual factors N_m of a row of n pieces, from the self factors S(k) = N(k pieces as one prism) (see `Pieces`). */
const mutualFactors = (self: (k: number) => number, n: number): number[] => {
	const out: number[] = []
	for (let k = 1; k <= n; k++) {
		let rest = k * self(k) - k * (out[0] ?? self(1))
		for (let m = 1; m <= k - 2; m++) rest -= 2 * (k - m) * (out[m] as number)
		out.push(k === 1 ? self(1) : rest / 2)
	}
	return out
}

/**
 * The mutual factors N[a][b] of a grid of nL × nZ equal pieces (a sheet: along its length and across the plane), from the self factors
 * S(k, l) of the blocks k × l pieces big: every k × l block's own average field sums over its pairs of pieces, k·l·S(k, l) =
 * Σ_{|a|<k, |b|<l} (k − |a|)(l − |b|)·N[|a|][|b|], solved block by block (`mutualFactors` is the one-row case). The pieces lie side by side
 * across their magnetization's other axis, so the factors of each axis are exact on their own.
 */
const mutualFactors2D = (self: (k: number, l: number) => number, nL: number, nZ: number): number[][] => {
	if (nZ === 1) return mutualFactors((k) => self(k, 1), nL).map((v) => [v])
	const N = Array.from({ length: nL }, () => new Array<number>(nZ).fill(0))
	const mult = (a: number) => (a === 0 ? 1 : 2)
	for (let K = 1; K <= nL; K++)
		for (let L = 1; L <= nZ; L++) {
			let rest = K * L * self(K, L)
			for (let a = 0; a < K; a++)
				for (let b = 0; b < L; b++) if (a !== K - 1 || b !== L - 1) rest -= mult(a) * mult(b) * (K - a) * (L - b) * (N[a]?.[b] as number)
			;(N[K - 1] as number[])[L - 1] = rest / (mult(K - 1) * mult(L - 1))
		}
	return N
}

/**
 * `coaxialIdentity`: the mutual factor of two coaxial uniformly magnetized prisms of one section, a and b long, g apart (the average field
 * in the first along an axis, per unit of the second's magnetization, −N), from the prisms' own factors S(ℓ) [AHARONI]: with F(ℓ) = ℓ·S(ℓ),
 * N = [F(a + g + b) − F(a + g) − F(b + g) + F(g)]/(2a) (the pieces of one row are the case g = 0: `mutualFactors`). Used for a row's cells
 * (`rowModel`) and for the end pieces linked to a row's ends (`Link`).
 */
/** Solves A·x = b in place (Gaussian elimination, partial pivoting; A n × n). */
const solveDense = (A: number[][], b: number[]): number[] => {
	const n = b.length
	for (let c = 0; c < n; c++) {
		let p = c
		for (let r = c + 1; r < n; r++) if (Math.abs((A[r] as number[])[c] as number) > Math.abs((A[p] as number[])[c] as number)) p = r
		if (p !== c) {
			const t = A[c] as number[]
			A[c] = A[p] as number[]
			A[p] = t
			const tb = b[c] as number
			b[c] = b[p] as number
			b[p] = tb
		}
		const rc = A[c] as number[]
		for (let r = c + 1; r < n; r++) {
			const rr = A[r] as number[]
			const f = (rr[c] as number) / (rc[c] as number)
			if (f === 0) continue
			for (let k = c; k < n; k++) rr[k] = (rr[k] as number) - f * (rc[k] as number)
			b[r] = (b[r] as number) - f * (b[c] as number)
		}
	}
	const x = new Array<number>(n).fill(0)
	for (let r = n - 1; r >= 0; r--) {
		const rr = A[r] as number[]
		let v = b[r] as number
		for (let k = r + 1; k < n; k++) v -= (rr[k] as number) * (x[k] as number)
		x[r] = v / (rr[r] as number)
	}
	return x
}

/**
 * A soft body that is not a ball or a sheet is a row: its magnetization along its length and across it in the plane is solved on ROW_CELLS
 * cells of a Chebyshev partition (fine at its ends, where a rod's magnetic charge gathers) spanning its faces (the body and a skin, SKIN, at
 * each end), each uniformly magnetized, with the exact mutual factors of coaxial prisms of its section (`coaxialIdentity` [AHARONI]): a nail's
 * and a clip's moment in a uniform field within 1 % of the 120-cell volume-integral solve (research/rw-validate-magnetism.ts `soft`), and a
 * field gathered at one end (a clip's neighbour in a chain) answered as well. The field it is in is sampled at its coarse pieces' Gauss
 * points and interpolated to its cells. Its forces come from ROW_PIECES coarse pieces: two short end pieces (about as long as the body is
 * thick), which take their outermost cell's magnetization (what a contact there meets), and two halves, which take their cells' average.
 * (Four equal uniformly magnetized pieces, as before, took 0.56 of a nail's and 0.49 of a clip's true moment, so chains of clips and
 * electromagnets came out several times too weak: verify 20 Oct.)
 */
const ROW_CELLS = 24
/** The coarse pieces' boundaries among the cells: [0, 3, 12, 21, 24] (end pieces 3.8 % of the length each). */
const ROW_PIECES = [0, 3, 12, 21, 24]
/** A body shorter than ROW_LONG times its thickness is one coarse piece (its cells still solved: a washer, a cube). */
const ROW_LONG = 3
/** Gauss-Seidel sweeps of a row's cells once some are saturated. */
const ROW_SAT_SWEEPS = 12
/** The fine cells of a row, and their factor matrices along it and across it (N + 1/χ) and their inverses; cached by shape. */
interface RowModel {
	readonly bounds: readonly number[]
	readonly mid: readonly number[]
	readonly len: readonly number[]
	readonly A: readonly (readonly (readonly number[])[])[]
	readonly inv: readonly (readonly (readonly number[])[])[]
}
const ROW_MODELS = new Map<string, RowModel>()
const ROW_MODELS_MAX = 512
const rowModel = (long: number, thin: number, depth: number, chi: number): RowModel => {
	const key = `${long},${thin},${depth},${chi}`
	const known = ROW_MODELS.get(key)
	if (known !== undefined) return known
	const M = ROW_CELLS
	const b: number[] = []
	for (let k = 0; k <= M; k++) b.push((long / 2) * (1 - Math.cos((Math.PI * k) / M)))
	const mats: number[][][] = []
	const invs: number[][][] = []
	for (const axis of [0, 1] as const) {
		const F: number[][] = []
		for (let i = 0; i <= M; i++) {
			const row: number[] = []
			for (let j = 0; j <= M; j++) {
				const l = (b[j] as number) - (b[i] as number)
				row.push(j <= i || l <= 1e-12 ? 0 : l * (demagFactors(l, thin, depth)[axis] as number))
			}
			F.push(row)
		}
		const f = (i: number, j: number) => (j > i ? ((F[i] as number[])[j] as number) : 0)
		const A: number[][] = []
		for (let i = 0; i < M; i++) {
			const li = (b[i + 1] as number) - (b[i] as number)
			const row: number[] = []
			for (let j = 0; j < M; j++) {
				if (i === j) row.push((demagFactors(li, thin, depth)[axis] as number) + 1 / chi)
				else if (j > i) row.push((f(i, j + 1) - f(i, j) - f(i + 1, j + 1) + f(i + 1, j)) / (2 * li))
				else row.push((f(j, i + 1) - f(j + 1, i + 1) - f(j, i) + f(j + 1, i)) / (2 * li))
			}
			A.push(row)
		}
		const inv: number[][] = Array.from({ length: M }, () => new Array<number>(M).fill(0))
		for (let c = 0; c < M; c++) {
			const e = new Array<number>(M).fill(0)
			e[c] = 1
			const x = solveDense(A.map((r) => [...r]), e)
			for (let r = 0; r < M; r++) (inv[r] as number[])[c] = x[r] as number
		}
		mats.push(A)
		invs.push(inv)
	}
	const mid: number[] = []
	const len: number[] = []
	for (let i = 0; i < M; i++) {
		mid.push(((b[i] as number) + (b[i + 1] as number)) / 2)
		len.push((b[i + 1] as number) - (b[i] as number))
	}
	const model = { bounds: b, mid, len, A: mats, inv: invs }
	if (ROW_MODELS.size >= ROW_MODELS_MAX) ROW_MODELS.clear()
	ROW_MODELS.set(key, model)
	return model
}

/** A soft body solved as a row (`rowModel`): its coarse pieces in order, its cells' magnetizations along it and across it (A/m, carried). */
interface Row {
	readonly model: RowModel
	readonly pieces: SoftState[]
	/** each coarse piece's first and last cell + 1 */
	readonly cuts: readonly number[]
	readonly ma: Float64Array
	readonly mt: Float64Array
	/** its cells' field along it and across it (A/m, this sweep's: a buffer) */
	readonly ha: Float64Array
	readonly ht: Float64Array
}

const SOFT_EPS = 1e-9
/** The most pieces a long soft body is cut into (each magnetized on its own). */
const MAX_SEGMENTS = 4
/**
 * A flat sheet (sheet metal at most SHEET_THICK thick, thinner in the plane than SHEET_THIN of its length and of its depth, both at least
 * SHEET_MIN: a steel barrier sheet, a baking tray) is cut into a grid of pieces about SHEET_CELL square, along its length and across the plane, at most SHEET_MAX each way: the field
 * a pole sends into it then gathers where the pole faces it and runs off through the sheet to its edges, as in a real one (one uniformly
 * magnetized piece, or a row across the plane, could only take it in as a whole, so a sheet hardly shielded at all: verify 20 Oct).
 */
const SHEET_THIN = 0.2
const SHEET_MIN = 0.04
const SHEET_CELL = 0.0083
const SHEET_MAX = 12
/** m: only sheet metal is a sheet (a steel sheet 0.5-3 mm, a tray): a beam or a post 12 mm thick is a row. */
const SHEET_THICK = 0.005
/** Every sheet's grid of a run together has at most this many pieces (more sheets: coarser grids, fewer pieces each, alike). */
const GRID_BUDGET = 200
/**
 * Two soft bodies' ends link (`Link`) when their end points are within LINK_GAP along the row (the contact skins keep them 1.5 mm apart),
 * their rows within 25° of one line (cos 25° = 0.906) and their middles within half the thicker one's section of that line.
 */
const LINK_GAP = 0.003
/** m: a link's factors are reckoned for its gap to this step (`solveRow`), and kept for that gap (LINK_TABLES, at most LINK_TABLES_MAX) */
const LINK_GAP_STEP = 1e-7
const LINK_TABLES = new Map<string, [number[][], number[][]]>()
const LINK_TABLES_MAX = 4096
const LINK_COS = 0.9063077870366499
/**
 * m: the engine's contact skin keeps two resting flat solids about 1.5 mm apart (planck's polygon radius, 1 mm each, less its 0.5 mm slop:
 * web/CONTRACT.md "Polygons"), which would hold a clip resting on a magnet 1.5 mm off it, where a real one touches: every flat magnetic face
 * is reckoned SKIN further out than the body's outline, its charge scaled so the body's moment is unchanged (a ball has no skin: none for
 * round bodies). Two resting faces then meet 0.1 mm apart. Pressed nearer by the solver (as near as 1 mm: planck's slop) a face passes the
 * one it faces: it is then met as if just in front of it (`crossed`), never as behind it, which would push where they should pull.
 */
const SKIN = 0.0007
/** A soft body's pair of faces is left out where its charge is under this share of the other pair's. */
const SIDE_SHARE = 1e-3

/** The coil's current at time t, A. */
const currentAt = (steps: readonly CurrentStep[], t: number) => {
	let amps = 0
	for (const s of steps) if (t + 1e-12 >= s.t) amps = s.amps
	return amps
}

/** What the fields do, step by step (`createFields`). */
export interface Fields {
	/** Before a (sub-)step at time t: every force and turning, handed to `apply`. */
	step(t: number, poseOf: (solid: string) => Pose | undefined, apply: Apply): void
	/**
	 * The magnetization where everything stands at time t, with no forces (before the release, while held things wait: so the soft iron is
	 * magnetized as it should be the moment they are let go, not from nothing).
	 */
	settle(t: number, poseOf: (solid: string) => Pose | undefined): void
	/** Two solids began touching at time t: charge moves between them (when either holds one). */
	touch(t: number, a: string, b: string): void
	/**
	 * Two solids `gap` m apart at their nearest, whose gap's middle is (x, y): when both hold conductors' charge records (or one is grounded)
	 * and the voltage between them passes air's breakdown across the gap (Paschen's law), a spark carries the charge across (they come to
	 * one potential, as touching) and is returned; else undefined.
	 */
	spark(t: number, a: string, b: string, gap: number, x: number, y: number): Spark | undefined
	/** The solids that hold a conductor's charge record (grounded ones too). */
	readonly conductors: ReadonlySet<string>
	/** The magnetic flux density at a world point in the machine plane, T (from the last step's state). */
	fieldB(x: number, y: number, out?: Float64Array): Float64Array
	/** The electric field at a world point, V/m (from the last step's charges). */
	fieldE(x: number, y: number, out?: Float64Array): Float64Array
	/**
	 * The most a pair may push a solid with, N (undefined: no limit): a pair pushing harder pushes both its solids that much less, the same
	 * for both, so no pair gives momentum to the world (tooling/src/sim/modules/magnetism.ts PULL_CAP).
	 */
	setLimit(limit: ((solid: string) => number) | undefined): void
	/** Sets a coil's current from outside (a circuit another module solves), A, until set again; undefined returns it to its own schedule. */
	setCurrent(solid: string, amps: number | undefined): void
	/** Each soft body's magnetization (A/m, world x, y), each coil's current (A), each charge (C) now. */
	state(): { soft: Record<string, [number, number, number]>; coils: Record<string, number>; charges: Record<string, number> }
	/** The sparks so far. */
	readonly sparks: readonly Spark[]
	/** Every solid the fields act on (so the engine can tell a scene without any from one with). */
	readonly solids: ReadonlySet<string>
}

/** Sets up a scene's magnets, soft iron, coils, charges and polarizable things (doc.magnetism); see the file's comment. */
export const createFields = (spec: FieldsSpec): Fields => {
	const magnets = spec.magnets ?? []
	// (a sheet: thin sheet metal, wide both ways; its grid's pieces each way, within the run's GRID_BUDGET)
	const sheetOf = (s: SoftSpec) => {
		const alongX = s.w >= s.h
		const long = alongX ? s.w : s.h
		const thin = alongX ? s.h : s.w
		return s.round !== true && s.grid !== false && thin <= SHEET_THICK && thin <= SHEET_THIN * Math.min(long, s.d) && Math.min(long, s.d) >= SHEET_MIN ? [Math.max(1, Math.min(SHEET_MAX, Math.round(long / SHEET_CELL))), Math.max(1, Math.min(SHEET_MAX, Math.round(s.d / SHEET_CELL)))] : null
	}
	let gridPieces = 0
	for (const s of spec.soft ?? []) {
		const g = sheetOf(s)
		if (g) gridPieces += (g[0] as number) * (g[1] as number)
	}
	const gridScale = gridPieces > GRID_BUDGET ? Math.sqrt(GRID_BUDGET / gridPieces) : 1
	const softs: SoftState[] = (spec.soft ?? []).flatMap((s) => {
		const round = s.round === true
		// a ball: one piece; a flat sheet: a grid of pieces; anything else a row along its longer side in the plane (`Row`)
		const alongX = s.w >= s.h
		const long = alongX ? s.w : s.h
		const thin = alongX ? s.h : s.w
		const cross = Math.max(thin, s.d)
		const grid = sheetOf(s)
		const sheet = grid !== null
		// (a row's cells span its faces: the body and a skin at each end, SKIN, where its end faces are reckoned)
		const model = round || sheet ? undefined : rowModel(long + 2 * SKIN, thin, s.d, s.chi)
		const cuts = model === undefined ? [] : long < ROW_LONG * cross ? [0, ROW_CELLS] : ROW_PIECES
		const n = round ? 1 : grid !== null ? Math.max(1, Math.floor((grid[0] as number) * gridScale)) : cuts.length - 1
		const nZ = grid !== null ? Math.max(1, Math.floor((grid[1] as number) * gridScale)) : 1
		// the pieces' boundaries along the row (from its start): a row's in its cells' frame (its faces' span), less the skin, within the body
		const virt = model !== undefined ? cuts.map((c) => model.bounds[c] as number) : Array.from({ length: n + 1 }, (_, k) => (long * k) / n)
		const edges = model !== undefined ? virt.map((v) => Math.max(0, Math.min(long, v - SKIN))) : virt
		const d = s.d / nZ
		// (a sheet's grid and a ball: their mutual factors (`Pieces`); a row's pieces take theirs from its cells)
		const wk = alongX ? s.w / n : s.w
		const hk = alongX ? s.h : s.h / n
		// (a sheet's factors for its steel's own thickness: a thin sheet's pull along itself grows as it thins (N ∝ thickness), so 0.5 mm of
		// steel in a 1 mm body takes in what a 0.5 mm sheet does; its faces stay the body's and carry its share, `fill`)
		const fillOf = s.w * s.h * s.d > 0 ? Math.min(1, s.volume / (s.w * s.h * s.d)) : 0
		const thinK = sheet ? Math.max(fillOf, 0.01) : 1
		const prism = (k: number, l: number) => (round ? [1 / 3, 1 / 3, 1 / 3] : demagFactors(alongX ? k * wk : wk * thinK, alongX ? hk * thinK : k * hk, l * d))
		const group: Pieces = {
			nx: model === undefined ? mutualFactors2D((k, l) => prism(k, l)[0] as number, n, nZ) : [[0]],
			ny: model === undefined ? mutualFactors2D((k, l) => prism(k, l)[1] as number, n, nZ) : [[0]],
			nz: sheet ? mutualFactors2D((k, l) => prism(k, l)[2] as number, n, nZ) : [[0]],
			members: []
		}
		const row: Row | undefined = model === undefined ? undefined : { model, pieces: group.members, cuts, ma: new Float64Array(ROW_CELLS), mt: new Float64Array(ROW_CELLS), ha: new Float64Array(ROW_CELLS), ht: new Float64Array(ROW_CELLS) }
		for (let k = 0; k < n; k++) {
			const lk = (edges[k + 1] as number) - (edges[k] as number)
			const w = alongX ? lk : s.w
			const h = alongX ? s.h : lk
			const hw = w / 2
			const hh = h / 2
			const off = ((edges[k] as number) + (edges[k + 1] as number)) / 2 - long / 2
			// sampled along its longer side at three Gauss points (and across it too where it is over 1 cm; across the plane too, a sheet's pieces)
			const longHalf = alongX ? hw : hh
			const short = alongX ? hh : hw
			const across = !round && short > 0.005 ? G3 : [0]
			const acrossW = !round && short > 0.005 ? W3 : [2]
			const lengthwise = round ? [0] : G3
			const lengthW = round ? [2] : W3
			const deep = sheet ? G3 : [0]
			const deepW = sheet ? W3 : [2]
			// (a row's piece is sampled over its span among the cells, its skin too: `at`, where along the row's cells)
			const v0 = virt[k] as number
			const v1 = virt[k + 1] as number
			const samples: { x: number; y: number; z: number; w: number; at: number }[] = []
			lengthwise.forEach((u, i) =>
				across.forEach((v, j) =>
					deep.forEach((q, l) => {
						const wt = ((lengthW[i] as number) * (acrossW[j] as number) * (deepW[l] as number)) / 8
						const z = (q * d) / 2
						const at = model !== undefined ? (v0 + v1) / 2 + (u * (v1 - v0)) / 2 : 0
						const a = model !== undefined ? at - SKIN - ((edges[k] as number) + (edges[k + 1] as number)) / 2 : u * longHalf
						samples.push(alongX ? { x: a, y: v * short, z, w: wt, at } : { x: v * short, y: a, z, w: wt, at })
					})
				)
			)
			for (let l = 0; l < nZ; l++) {
				const z = nZ === 1 ? 0 : (l - (nZ - 1) / 2) * d
				group.members.push({
					spec: s,
					x: s.x + (alongX ? off : 0),
					y: s.y + (alongX ? 0 : off),
					w,
					h,
					d,
					nx: group.nx[0]?.[0] as number,
					ny: group.ny[0]?.[0] as number,
					nz: group.nz[0]?.[0] as number,
					fill: s.w * s.h * s.d > 0 ? Math.min(1, s.volume / (s.w * s.h * s.d)) : 0,
					mx: 0,
					my: 0,
					mz: 0,
					px: 0,
					py: 0,
					c: 1,
					s: 0,
					// (the body's outer faces a skin further out: its ends only at the first and last piece, the pieces' joins left where they meet;
					// a sheet's piece its front and back too, across the plane)
					specs: [
						{ x: hw + (round || (alongX && k < n - 1) ? 0 : SKIN), y: 0, z, angle: 0, width: h, depth: d },
						{ x: -hw - (round || (alongX && k > 0) ? 0 : SKIN), y: 0, z, angle: Math.PI, width: h, depth: d },
						{ x: 0, y: hh + (round || (!alongX && k < n - 1) ? 0 : SKIN), z, angle: Math.PI / 2, width: w, depth: d },
						{ x: 0, y: -hh - (round || (!alongX && k > 0) ? 0 : SKIN), z, angle: -Math.PI / 2, width: w, depth: d },
						...(sheet ? [{ x: 0, y: 0, z: z + d / 2, angle: 0, width: w, depth: h, zn: 1 }, { x: 0, y: 0, z: z - d / 2, angle: 0, width: w, depth: h, zn: -1 }] : [])
					],
					// the charge on the faces across the pieces' line (a skin out on both sides) scaled to keep the moment
					scaleX: round || alongX ? 1 : w / (w + 2 * SKIN),
					scaleY: round || !alongX ? 1 : h / (h + 2 * SKIN),
					samples,
					index: k,
					iz: l,
					z,
					group,
					alongX,
					length: lk,
					thick: thin,
					links: [],
					...(row === undefined ? {} : { row }),
					pos: off + long / 2
				})
			}
		}
		return group.members
	})
	const charges = (spec.charges ?? []).map((c) => ({ spec: c, q: c.grounded === true ? 0 : c.q, px: 0, py: 0 }))
	const polars = (spec.polar ?? []).map((p) => {
		const [nx, ny] = p.round === true ? [1 / 3, 1 / 3] : demagFactors(p.w, p.h, p.d)
		const alpha = (n: number) => (p.epsr <= 0 ? (EPS0 * p.volume) / n : (EPS0 * p.volume * (p.epsr - 1)) / (1 + n * (p.epsr - 1)))
		return { spec: p, ax: alpha(nx), ay: alpha(ny), px: 0, py: 0, c: 1, s: 0 }
	})
	const earthX = spec.earth?.x ?? 0
	const earthY = spec.earth?.y ?? 0
	const sparks: Spark[] = []
	const solids = new Set<string>([
		...magnets.map((m) => m.solid),
		...softs.map((s) => s.spec.solid),
		...charges.map((c) => c.spec.solid),
		...polars.map((p) => p.spec.solid)
	])

	// permanent magnets' faces a skin out along their normals (none for a ball magnet), each charge scaled by its face's thickness across to the
	// opposite face (t/(t + 2·SKIN): the moment kept); a face with no opposite one (a horseshoe's two tips face the same way) keeps its charge
	const magnetFaces = magnets.map((m) =>
		m.faces.map((f) => {
			if (m.round === true) return f
			const nx = Math.cos(f.angle)
			const ny = Math.sin(f.angle)
			let t = 0
			for (const o of m.faces) {
				const ox = Math.cos(o.angle)
				const oy = Math.sin(o.angle)
				const along = (f.x - o.x) * nx + (f.y - o.y) * ny
				const side = -(f.x - o.x) * ny + (f.y - o.y) * nx
				if (nx * ox + ny * oy < -0.999 && along > 0 && Math.abs(side) < 1e-9 && Math.abs((f.z ?? 0) - (o.z ?? 0)) < 1e-9) t = along
			}
			const scale = t > 0 ? t / (t + 2 * SKIN) : 1
			return { ...f, x: f.x + nx * SKIN, y: f.y + ny * SKIN, sigma: f.sigma * scale }
		})
	)

	// the bodies, made once; their faces are placed each step
	const bodies: MagBody[] = [
		...magnets.map((m) => ({ solid: m.solid, bx: 0, by: 0, round: m.round === true, soft: -1, faces: m.faces.map(newFace), cx: 0, cy: 0, cz: 0, reach: 0, farK: FAR_BODY, live: false, mx: 0, my: 0, mz: 0 })),
		...softs.map((s, i) => ({ solid: s.spec.solid, bx: 0, by: 0, round: s.spec.round === true, soft: i, faces: s.specs.map(newFace), cx: 0, cy: 0, cz: s.z, reach: 0, farK: s.nz !== 0 ? FAR_GRID : FAR_BODY, live: false, mx: 0, my: 0, mz: 0 }))
	]
	// (each body's solid's run of bodies ends before runEnd[i]: a sheet's hundreds of pieces are passed over at once)
	const runEnd: number[] = new Array<number>(bodies.length).fill(0)
	for (let i = bodies.length - 1; i >= 0; i--) runEnd[i] = i + 1 < bodies.length && (bodies[i + 1] as MagBody).solid === (bodies[i] as MagBody).solid ? (runEnd[i + 1] as number) : i + 1
	const tmp = new Float64Array(4)
	const acc = new Float64Array(3)
	let time = 0

	const blendAcc = new Float64Array(3)
	/** The field (per 4π) at a world point (z across the plane) from every magnetic body but the solid `skip`'s and the bodies `skipBodies`
	 *  (a piece's links: their field is reckoned exactly), into acc (a far body as its dipole). */
	const fieldFrom = (px: number, py: number, pz: number, skip: string | undefined, skipBodies?: readonly MagBody[], withZ = false) => {
		acc[0] = 0
		acc[1] = 0
		acc[2] = 0
		for (let bi = 0; bi < bodies.length; bi++) {
			const body = bodies[bi] as MagBody
			if (body.solid === skip) {
				bi = (runEnd[bi] as number) - 1
				continue
			}
			if (body.reach === 0) continue
			if (skipBodies !== undefined && skipBodies.includes(body)) continue
			const dx = px - body.cx
			const dy = py - body.cy
			const dz = pz - body.cz
			const r = Math.sqrt(dx * dx + dy * dy + dz * dz)
			const far = body.farK * body.reach
			if (r <= far) {
				for (const f of body.faces) addFaceField(f, px, py, pz, acc, tmp, withZ)
				continue
			}
			if (r >= far + body.reach) {
				addDipoleField(body.mx, body.my, dx, dy, acc, 1, dz, body.mz, withZ)
				continue
			}
			const u = (r - far) / body.reach
			const blend = u * u * (3 - 2 * u)
			blendAcc[0] = acc[0] as number
			blendAcc[1] = acc[1] as number
			blendAcc[2] = acc[2] as number
			acc[0] = 0
			acc[1] = 0
			acc[2] = 0
			for (const f of body.faces) addFaceField(f, px, py, pz, acc, tmp, withZ)
			const ex = acc[0] as number
			const ey = acc[1] as number
			const ez = acc[2] as number
			acc[0] = (blendAcc[0] as number) + (1 - blend) * ex
			acc[1] = (blendAcc[1] as number) + (1 - blend) * ey
			acc[2] = (blendAcc[2] as number) + (1 - blend) * ez
			addDipoleField(body.mx, body.my, dx, dy, acc, blend, dz, body.mz, withZ)
		}
	}

	/** Puts a soft body's faces where its block is, charged by its magnetization (and its coil's). */
	const placeSoft = (body: MagBody, st: SoftState, amps: number) => {
		const coil = st.spec.coil
		const nI = coil === undefined || coil.length <= 0 ? 0 : (coil.turns * amps) / coil.length
		const sx = (st.mx * st.fill + nI) * st.scaleX
		const sy = st.my * st.fill * st.scaleY
		const pose: Pose = { x: st.px, y: st.py, angle: 0 }
		// (a face whose charge is under a thousandth of the other pair's is left out: a clip magnetized along its length has next to none on its long sides)
		const qx = Math.abs(sx) * st.h
		const qy = Math.abs(sy) * st.w
		const ox = qx < SIDE_SHARE * qy ? 0 : sx
		const oy = qy < SIDE_SHARE * qx ? 0 : sy
		const sz = st.mz * st.fill
		const sigmas = [ox, -ox, oy, -oy, sz, -sz]
		st.specs.forEach((fs, k) => placeFace(body.faces[k] as Face, fs, pose, st.c, st.s, sigmas[k] as number))
		const hw = st.w / 2
		const hh = st.h / 2
		body.cx = st.px
		body.cy = st.py
		body.reach = Math.sqrt(hw * hw + hh * hh + (st.d / 2) * (st.d / 2))
		const box = st.w * st.h * st.d
		const mxl = (st.mx * st.fill + nI) * box
		const myl = st.my * st.fill * box
		body.mx = mxl * st.c - myl * st.s
		body.my = mxl * st.s + myl * st.c
		body.mz = st.mz * st.fill * box
	}

	/** Each row end piece's links this step (`Link`): the end pieces of other rows whose faces touch its end face end-on, lined up. */
	const ends = softs.filter((st) => st.row !== undefined && (st.index === 0 || st.index === st.row.pieces.length - 1))
	const linkEnds = (poseOf: (solid: string) => Pose | undefined) => {
		for (const st of softs) if (st.links.length > 0) st.links = []
		if (ends.length < 2) return
		// (an end's face: the body's end and a skin beyond it, the row's outward direction there, and the row's direction)
		const face = (st: SoftState, e: number) => {
			const p0 = (st.row as Row).pieces[0] as SoftState
			const ux = p0.alongX ? p0.c : -p0.s
			const uy = p0.alongX ? p0.s : p0.c
			const long = p0.alongX ? p0.spec.w : p0.spec.h
			const cx = p0.px + (long / 2 - p0.pos) * ux
			const cy = p0.py + (long / 2 - p0.pos) * uy
			const half = long / 2 + SKIN
			return { x: cx + e * half * ux, y: cy + e * half * uy, ux: e * ux, uy: e * uy, rx: ux, ry: uy }
		}
		for (let i = 0; i < ends.length; i++) {
			const a = ends[i] as SoftState
			if (poseOf(a.spec.solid) === undefined) continue
			for (let j = i + 1; j < ends.length; j++) {
				const b = ends[j] as SoftState
				if (b.spec.solid === a.spec.solid || poseOf(b.spec.solid) === undefined) continue
				const ra = a.row as Row
				const rb = b.row as Row
				for (const ea of ra.pieces.length === 1 ? [-1, 1] : [a.index === 0 ? -1 : 1])
					for (const eb of rb.pieces.length === 1 ? [-1, 1] : [b.index === 0 ? -1 : 1]) {
						const fa = face(a, ea)
						const fb = face(b, eb)
						// (their outward directions opposite, within 25° of one line)
						if (-(fa.ux * fb.ux + fa.uy * fb.uy) < LINK_COS) continue
						const dx = fb.x - fa.x
						const dy = fb.y - fa.y
						const along = dx * fa.ux + dy * fa.uy
						if (along < -LINK_GAP || along > LINK_GAP) continue
						const side = Math.abs(-dx * fa.uy + dy * fa.ux)
						if (side > Math.max(a.thick, b.thick) / 2) continue
						const areaA = a.thick * a.d
						const areaB = b.thick * b.d
						// (the factors of the larger section, the smaller one's share of it for the larger: reciprocal, and a small end on a big
						// face, a clip on a nail's point, meets the big face's field, not a small one's)
						const [t, dd] = areaA >= areaB ? [a.thick, a.d] : [b.thick, b.d]
						const gap = Math.max(0, along)
						const ia = softs.indexOf(a)
						const ib = softs.indexOf(b)
						const i0a = ia - a.index
						const i0b = ib - b.index
						const bodiesA = ra.pieces.map((_, k) => bodies[magnets.length + i0a + k] as MagBody)
						const bodiesB = rb.pieces.map((_, k) => bodies[magnets.length + i0b + k] as MagBody)
						a.links.push({ other: rb, soft: i0b, bodies: bodiesB, end: ea, otherEnd: eb, gap, thick: t, depth: dd, share: Math.min(1, areaB / areaA), ux: fa.rx, uy: fa.ry })
						b.links.push({ other: ra, soft: i0a, bodies: bodiesA, end: eb, otherEnd: ea, gap, thick: t, depth: dd, share: Math.min(1, areaA / areaB), ux: fb.rx, uy: fb.ry })
					}
			}
		}
	}

	/**
	 * A row's magnetization from the field at its pieces' sample points (from every other body, the Earth and its coil): the field along the
	 * row and across it, interpolated to its cells (`rowModel`), its cells' solve (their inverse factor matrix; past saturation, Gauss-Seidel
	 * sweeps of the cells held at M_s), and each coarse piece the average of its cells, relaxed (RELAX) as every soft piece is.
	 */
	const linkMine = new Float64Array(ROW_CELLS + 1)
	const linkTheirs = new Float64Array(ROW_CELLS + 1)
	const rowAt: number[] = []
	const rowA: number[] = []
	const rowT: number[] = []
	/** ℓ·S(ℓ) along a row and across it, for a prism ℓ × thick × depth (`coaxialIdentity`'s F); ℓ itself (and 0 across) for ℓ near 0 */
	const linkF = (l: number, thick: number, depth: number): [number, number] => {
		if (l <= 1e-9) return [l, 0]
		const f = demagFactors(l, thick, depth)
		return [l * (f[0] as number), l * (f[1] as number)]
	}
	const solveRow = (row: Row, i0: number, amps: number[]) => {
		const model = row.model
		const first = row.pieces[0] as SoftState
		const fourPi = 4 * Math.PI
		rowAt.length = 0
		rowA.length = 0
		rowT.length = 0
		const ua = first.alongX ? first.c : -first.s
		const ub = first.alongX ? first.s : first.c
		// (the end pieces linked to its ends are left out of the sampled field: their field is added exactly below)
		const links: Link[] = []
		for (const st of row.pieces) for (const l of st.links) links.push(l)
		const skipBodies = links.length > 0 ? links.flatMap((l) => l.bodies) : undefined
		row.pieces.forEach((st, k) => {
			const body = bodies[magnets.length + i0 + k] as MagBody
			let bx = 0
			let by = 0
			let at = Number.NaN
			let sw = 0
			let sa = 0
			let sb = 0
			const flush = () => {
				if (sw > 0) {
					rowAt.push(at)
					rowA.push(sa / sw)
					rowT.push(sb / sw)
				}
				sw = 0
				sa = 0
				sb = 0
			}
			for (const p of st.samples) {
				const wx = st.px + p.x * st.c - p.y * st.s
				const wy = st.py + p.x * st.s + p.y * st.c
				fieldFrom(wx, wy, st.z + p.z, st.spec.solid, skipBodies)
				const hx = (acc[0] as number) / fourPi + earthX / MU0
				const hy = (acc[1] as number) / fourPi + earthY / MU0
				bx += p.w * hx
				by += p.w * hy
				// (the samples across the piece at one place along it are averaged: one value per place)
				const here = p.at
				if (here !== at) flush()
				at = here
				sw += p.w
				sa += p.w * (hx * ua + hy * ub)
				sb += p.w * (-hx * ub + hy * ua)
			}
			flush()
			body.bx = MU0 * bx
			body.by = MU0 * by
		})
		const coil = first.spec.coil
		const nI = coil === undefined || coil.length <= 0 ? 0 : (coil.turns * (amps[i0] as number)) / coil.length
		const M = ROW_CELLS
		const ha = row.ha
		const ht = row.ht
		let j = 0
		for (let c = 0; c < M; c++) {
			const x = model.mid[c] as number
			while (j < rowAt.length - 2 && (rowAt[j + 1] as number) < x) j++
			const x0 = rowAt[j] as number
			const x1 = rowAt[Math.min(j + 1, rowAt.length - 1)] as number
			const u = x1 > x0 ? Math.max(0, Math.min(1, (x - x0) / (x1 - x0))) : 0
			const k1 = Math.min(j + 1, rowAt.length - 1)
			ha[c] = (rowA[j] as number) + u * ((rowA[k1] as number) - (rowA[j] as number)) + nI
			ht[c] = (rowT[j] as number) + u * ((rowT[k1] as number) - (rowT[j] as number))
		}
		// each linked end piece's field in every cell: coaxial prisms of the smaller section, the gap apart (its magnetization with its coil's,
		// along this row and across it)
		const Lv = model.bounds[M] as number
		for (const l of links) {
			const orow = l.other
			const o0 = orow.pieces[0] as SoftState
			const oc = o0.spec.coil
			const on = oc === undefined || oc.length <= 0 ? 0 : (oc.turns * (amps[l.soft] as number)) / oc.length
			const oux = o0.alongX ? o0.c : -o0.s
			const ouy = o0.alongX ? o0.s : o0.c
			const oLv = orow.model.bounds[ROW_CELLS] as number
			// (my cells' and the other's pieces' boundaries, as distances from the faces that meet)
			const mine = linkMine
			for (let c = 0; c <= M; c++) mine[c] = l.end < 0 ? (model.bounds[c] as number) : Lv - (model.bounds[M - c] as number)
			const theirs = linkTheirs
			const P = orow.pieces.length
			for (let k = 0; k <= P; k++) theirs[k] = l.otherEnd < 0 ? (orow.model.bounds[orow.cuts[k] as number] as number) : oLv - (orow.model.bounds[orow.cuts[P - k] as number] as number)
			// (the factors' F at every pair of boundaries: cached by the two rows' shapes and the gap to LINK_GAP_STEP, as a chain at rest keeps
			// its gaps to well under a micrometre from step to step)
			const gq = Math.round(l.gap / LINK_GAP_STEP)
			const key = `${model.bounds[M]},${l.end},${orow.model.bounds[ROW_CELLS]},${orow.cuts.join(":")},${l.otherEnd},${l.thick},${l.depth},${gq}`
			let tables = LINK_TABLES.get(key)
			if (tables === undefined) {
				const g = gq * LINK_GAP_STEP
				const Fa0: number[][] = []
				const Ft0: number[][] = []
				for (let c = 0; c <= M; c++) {
					const ra: number[] = []
					const rt: number[] = []
					for (let k = 0; k <= P; k++) {
						const f = linkF(g + (mine[c] as number) + (theirs[k] as number), l.thick, l.depth)
						ra.push(f[0])
						rt.push(f[1])
					}
					Fa0.push(ra)
					Ft0.push(rt)
				}
				tables = [Fa0, Ft0]
				if (LINK_TABLES.size >= LINK_TABLES_MAX) LINK_TABLES.clear()
				LINK_TABLES.set(key, tables)
			}
			const [Fa, Ft] = tables
			for (let k = 0; k < P; k++) {
				// (the other's piece k counted from the faces that meet; its magnetization with its coil's in the world, along my row and across it)
				const o = orow.pieces[l.otherEnd < 0 ? k : P - 1 - k] as SoftState
				const oa = (o.alongX ? o.mx : o.my) * o.fill + on
				const ot = (o.alongX ? o.my : -o.mx) * o.fill
				const wx = oa * oux - ot * ouy
				const wy = oa * ouy + ot * oux
				const pa = wx * l.ux + wy * l.uy
				const pt = -wx * l.uy + wy * l.ux
				if (pa === 0 && pt === 0) continue
				for (let c = 0; c < M; c++) {
					const len = (mine[c + 1] as number) - (mine[c] as number)
					const fa1 = Fa[c + 1] as number[]
					const fa0 = Fa[c] as number[]
					const ft1 = Ft[c + 1] as number[]
					const ft0 = Ft[c] as number[]
					const na = ((fa1[k + 1] as number) - (fa1[k] as number) - (fa0[k + 1] as number) + (fa0[k] as number)) / (2 * len)
					const nt = ((ft1[k + 1] as number) - (ft1[k] as number) - (ft0[k + 1] as number) + (ft0[k] as number)) / (2 * len)
					// (my cell c counted from the faces that meet is cell c of my start, cell M − 1 − c of my end)
					const cc = l.end < 0 ? c : M - 1 - c
					ha[cc] = (ha[cc] as number) - l.share * na * pa
					ht[cc] = (ht[cc] as number) - l.share * nt * pt
				}
			}
		}
		const ma = row.ma
		const mt = row.mt
		const ia = model.inv[0] as readonly (readonly number[])[]
		const it = model.inv[1] as readonly (readonly number[])[]
		const ms = first.spec.ms
		let over = false
		for (let r = 0; r < M; r++) {
			let va = 0
			let vt = 0
			const ra = ia[r] as readonly number[]
			const rt = it[r] as readonly number[]
			for (let c = 0; c < M; c++) {
				va += (ra[c] as number) * (ha[c] as number)
				vt += (rt[c] as number) * (ht[c] as number)
			}
			ma[r] = va
			mt[r] = vt
			if (va * va + vt * vt > ms * ms) over = true
		}
		if (over) {
			// (past saturation: the cells' own sweeps, each held at M_s)
			const Aa = model.A[0] as readonly (readonly number[])[]
			const At = model.A[1] as readonly (readonly number[])[]
			for (let r = 0; r < M; r++) {
				const m = Math.sqrt((ma[r] as number) * (ma[r] as number) + (mt[r] as number) * (mt[r] as number))
				if (m > ms) {
					ma[r] = ((ma[r] as number) * ms) / m
					mt[r] = ((mt[r] as number) * ms) / m
				}
			}
			for (let sweep = 0; sweep < ROW_SAT_SWEEPS; sweep++)
				for (let r = 0; r < M; r++) {
					const ra = Aa[r] as readonly number[]
					const rt = At[r] as readonly number[]
					let va = ha[r] as number
					let vt = ht[r] as number
					for (let c = 0; c < M; c++) {
						if (c === r) continue
						va -= (ra[c] as number) * (ma[c] as number)
						vt -= (rt[c] as number) * (mt[c] as number)
					}
					va /= ra[r] as number
					vt /= rt[r] as number
					const m = Math.sqrt(va * va + vt * vt)
					if (m > ms) {
						va = (va * ms) / m
						vt = (vt * ms) / m
					}
					ma[r] = va
					mt[r] = vt
				}
		}
		row.pieces.forEach((st, k) => {
			let sa = 0
			let sb = 0
			let sl = 0
			// (an end piece takes its outermost cell's: what a contact there meets; its few cells' own moment is a percent of the body's)
			const n = row.pieces.length
			const c0 = n > 1 && k === n - 1 ? M - 1 : (row.cuts[k] as number)
			const c1 = n > 1 && k === 0 ? 1 : (row.cuts[k + 1] as number)
			for (let c = c0; c < c1; c++) {
				const l = model.len[c] as number
				sa += (ma[c] as number) * l
				sb += (mt[c] as number) * l
				sl += l
			}
			const a = sa / sl
			const b = sb / sl
			const mx = st.alongX ? a : -b
			const my = st.alongX ? b : a
			st.mx += RELAX * (mx - st.mx)
			st.my += RELAX * (my - st.my)
			if (Math.abs(st.mx) < SOFT_EPS) st.mx = 0
			if (Math.abs(st.my) < SOFT_EPS) st.my = 0
			placeSoft(bodies[magnets.length + i0 + k] as MagBody, st, amps[i0 + k] as number)
		})
	}

	/** Places every magnetic body where it stands at time t and updates the soft iron's magnetization (`sweeps` Gauss-Seidel sweeps). */
	let settled = false
	const magnetize = (t: number, poseOf: (solid: string) => Pose | undefined, sweeps: number) => {
		time = t
		// permanent magnets' faces
		magnets.forEach((m, i) => {
			const body = bodies[i] as MagBody
			const pose = poseOf(m.solid)
			if (pose === undefined) {
				for (const f of body.faces) f.sigma = 0
				return
			}
			const c = Math.cos(pose.angle)
			const s = Math.sin(pose.angle)
			let reach = 0
			let mx = 0
			let my = 0
			;(magnetFaces[i] as FaceSpec[]).forEach((fs, k) => {
				const f = body.faces[k] as Face
				placeFace(f, fs, pose, c, s, fs.sigma)
				const dx = f.cx - pose.x
				const dy = f.cy - pose.y
				reach = Math.max(reach, Math.sqrt(dx * dx + dy * dy + f.cz * f.cz) + f.reach)
				mx += f.q * dx
				my += f.q * dy
			})
			body.cx = pose.x
			body.cy = pose.y
			body.reach = reach
			body.mx = mx
			body.my = my
		})
		// soft bodies: where they are, then their magnetization (Gauss-Seidel, warm-started)
		const amps: number[] = softs.map((st) => (st.spec.coil === undefined ? 0 : (st.amps ?? currentAt(st.spec.coil.current ?? [], t))))
		softs.forEach((st, i) => {
			const pose = poseOf(st.spec.solid)
			const body = bodies[magnets.length + i] as MagBody
			if (pose === undefined) {
				st.mx = 0
				st.my = 0
				for (const f of body.faces) f.sigma = 0
				return
			}
			const c = Math.cos(pose.angle)
			const s = Math.sin(pose.angle)
			st.px = pose.x + st.x * c - st.y * s
			st.py = pose.y + st.x * s + st.y * c
			// (a ball's block keeps the world's axes: it is magnetized alike whichever way it has rolled)
			st.c = st.spec.round === true ? 1 : c
			st.s = st.spec.round === true ? 0 : s
			placeSoft(body, st, amps[i] as number)
		})
		if (softs.length > 0) {
			const fourPi = 4 * Math.PI
			linkEnds(poseOf)
			for (let sweep = 0; sweep < sweeps; sweep++) {
				softs.forEach((st, i) => {
					const body = bodies[magnets.length + i] as MagBody
					if (body.faces.length === 0 || poseOf(st.spec.solid) === undefined) return
					// (a row: all its pieces at once, from its cells: `solveRow`)
					if (st.row !== undefined) {
						if (st.index === 0) solveRow(st.row, i, amps)
						return
					}
					let hx = 0
					let hy = 0
					// (a sheet's piece: the field across the plane too)
					const grid = st.nz !== 0
					let hz = 0
					for (const p of st.samples) {
						const wx = st.px + p.x * st.c - p.y * st.s
						const wy = st.py + p.x * st.s + p.y * st.c
						fieldFrom(wx, wy, st.z + p.z, st.spec.solid, undefined, grid)
						hx += p.w * (acc[0] as number)
						hy += p.w * (acc[1] as number)
						hz += p.w * (acc[2] as number)
					}
					hz = hz / fourPi
					hx = hx / fourPi + earthX / MU0
					hy = hy / fourPi + earthY / MU0
					body.bx = MU0 * hx
					body.by = MU0 * hy
					// along its own axes, with its coil's own field
					const coil = st.spec.coil
					const nI = coil === undefined || coil.length <= 0 ? 0 : (coil.turns * (amps[i] as number)) / coil.length
					let ux = hx * st.c + hy * st.s + nI
					let uy = -hx * st.s + hy * st.c
					let uz = hz
					// the body's other pieces' fields here (their mutual factors: they share its axes)
					for (const o of st.group.members) {
						if (o === st) continue
						const m = o.index > st.index ? o.index - st.index : st.index - o.index
						const b = o.iz > st.iz ? o.iz - st.iz : st.iz - o.iz
						ux -= (st.group.nx[m]?.[b] as number) * o.mx
						uy -= (st.group.ny[m]?.[b] as number) * o.my
						if (grid) uz -= (st.group.nz[m]?.[b] as number) * o.mz
					}
					const chi = st.spec.chi
					let mx = ux / (st.nx + 1 / chi)
					let my = uy / (st.ny + 1 / chi)
					let mz = grid ? uz / (st.nz + 1 / chi) : 0
					const m = Math.sqrt(mx * mx + my * my + mz * mz)
					if (m > st.spec.ms) {
						mx *= st.spec.ms / m
						my *= st.spec.ms / m
						mz *= st.spec.ms / m
					}
					st.mx += RELAX * (mx - st.mx)
					st.my += RELAX * (my - st.my)
					st.mz += RELAX * (mz - st.mz)
					if (Math.abs(st.mx) < SOFT_EPS) st.mx = 0
					if (Math.abs(st.my) < SOFT_EPS) st.my = 0
					if (Math.abs(st.mz) < SOFT_EPS) st.mz = 0
					placeSoft(body, st, amps[i] as number)
				})
			}
		}
	}

	const fields: Fields = {
		sparks,
		solids,
		settle(t, poseOf) {
			magnetize(t, poseOf, settled ? SWEEPS : FIRST_SWEEPS)
			settled = true
		},
		step(t, poseOf, apply) {
			magnetize(t, poseOf, settled ? SWEEPS : FIRST_SWEEPS)
			settled = true
			// the field at each magnet from every other body (its turning's stiffness)
			magnets.forEach((m, i) => {
				const body = bodies[i] as MagBody
				if (!live(body)) return
				fieldFrom(body.cx, body.cy, 0, m.solid)
				body.bx = (MU0 * (acc[0] as number)) / (4 * Math.PI) + earthX
				body.by = (MU0 * (acc[1] as number)) / (4 * Math.PI) + earthY
			})
			// every pair once: the smaller sampled in the larger's field, the larger given the opposite. (Held back and handed on in the same
			// order once all are reckoned: two solids' pieces' pulls on each other are capped together, as one pair: `pairShare`)
			for (const b of bodies) b.live = b.faces.some((f) => f.sigma !== 0)
			pending.length = 0
			const defer: Apply = (solid, fx, fy, px, py, torque, k) => {
				pending.push({ key: pairKey, solid, fx, fy, px, py, torque, k })
			}
			for (let i = 0; i < bodies.length; i++) {
				const A = bodies[i] as MagBody
				if (!A.live) continue
				for (let j = i + 1; j < bodies.length; j++) {
					const B = bodies[j] as MagBody
					// (two pieces of one soft body: their pulls on each other are inside one rigid body)
					if (B.solid === A.solid) {
						j = (runEnd[j] as number) - 1
						continue
					}
					if (!B.live) continue
					const [target, source] = B.reach <= A.reach ? [B, A] : [A, B]
					pairKey = A.solid < B.solid ? `${A.solid}\u0000${B.solid}` : `${B.solid}\u0000${A.solid}`
					pairWrench(target, source, defer)
				}
				// the Earth's field turns it (a uniform field pulls nothing)
				if ((earthX !== 0 || earthY !== 0) && !A.round) {
					const torque = A.mx * earthY - A.my * earthX
					pairKey = ""
					if (torque !== 0) defer(A.solid, 0, 0, A.cx, A.cy, torque, stiffness(A))
				}
			}
			// each pair of solids' pull on the first of them, and its share (1, or less past either solid's limit)
			if (limitOf !== undefined) {
				pairTotals.clear()
				for (const e of pending) {
					if (e.key === "") continue
					const first = e.key.slice(0, e.key.indexOf("\u0000"))
					if (e.solid !== first) continue
					const t = pairTotals.get(e.key) ?? [0, 0]
					t[0] += e.fx
					t[1] += e.fy
					pairTotals.set(e.key, t)
				}
				pairShares.clear()
				for (const [key, t] of pairTotals) {
					const cut = key.indexOf("\u0000")
					pairShares.set(key, pairShare(key.slice(0, cut), key.slice(cut + 1), Math.sqrt((t[0] as number) * (t[0] as number) + (t[1] as number) * (t[1] as number))))
				}
			}
			for (const e of pending) {
				const share = e.key === "" || limitOf === undefined ? 1 : (pairShares.get(e.key) ?? 1)
				if (share < 1) apply(e.solid, e.fx * share, e.fy * share, e.px, e.py, e.torque * share, e.k)
				else apply(e.solid, e.fx, e.fy, e.px, e.py, e.torque, e.k)
			}
			needleKick(apply)
			if (charges.length > 0) electric(poseOf, apply)
		},
		touch(t, a, b) {
			const ca = charges.filter((c) => c.spec.solid === a)
			const cb = charges.filter((c) => c.spec.solid === b)
			if (ca.length === 0 || cb.length === 0) return
			for (const x of ca)
				for (const y of cb) {
					if (x.q === 0 && y.q === 0) continue
					share(x, y)
				}
			time = t
		},
		spark(t, a, b, gap, x, y) {
			const ca = charges.find((c) => c.spec.solid === a && c.spec.conductor === true)
			const cb = charges.find((c) => c.spec.solid === b && c.spec.conductor === true)
			if (ca === undefined || cb === undefined) return undefined
			const va = ca.spec.grounded === true ? 0 : ca.q / ca.spec.capacitance
			const vb = cb.spec.grounded === true ? 0 : cb.q / cb.spec.capacitance
			const volts = Math.abs(va - vb)
			if (!(gap > 0) || volts < breakdownVolts(gap)) return undefined
			// the energy let go: what the two held less what they hold at one potential
			const before = energyOf(ca) + energyOf(cb)
			share(ca, cb)
			const joules = Math.max(0, before - energyOf(ca) - energyOf(cb))
			const out: Spark = { t, a, b, x, y, volts, joules }
			sparks.push(out)
			time = t
			return out
		},
		conductors: new Set(charges.filter((c) => c.spec.conductor === true).map((c) => c.spec.solid)),
		setLimit(fn) {
			limitOf = fn
		},
		setCurrent(solid, amps) {
			for (const st of softs) if (st.spec.solid === solid) st.amps = amps === undefined || !Number.isFinite(amps) ? undefined : amps
		},
		fieldB(x, y, out = new Float64Array(2)) {
			fieldFrom(x, y, 0, undefined)
			out[0] = (MU0 * (acc[0] as number)) / (4 * Math.PI) + earthX
			out[1] = (MU0 * (acc[1] as number)) / (4 * Math.PI) + earthY
			return out
		},
		fieldE(x, y, out = new Float64Array(2)) {
			out[0] = 0
			out[1] = 0
			for (const c of charges) {
				if (c.q === 0) continue
				const dx = x - c.px
				const dy = y - c.py
				const r2 = dx * dx + dy * dy
				const r = Math.sqrt(r2)
				const core = c.spec.radius
				const k = (KE * c.q) / (r >= core ? r2 * r : core * core * core)
				out[0] += k * dx
				out[1] += k * dy
			}
			return out
		},
		state() {
			const soft: Record<string, [number, number, number]> = {}
			const coils: Record<string, number> = {}
			// (a body's magnetization: its pieces' together, by their volume)
			const vol = new Map<string, number>()
			softs.forEach((st) => {
				const v = st.w * st.h * st.d
				const m = soft[st.spec.solid] ?? [0, 0, 0]
				const t = (vol.get(st.spec.solid) ?? 0) + v
				vol.set(st.spec.solid, t)
				m[0] += (st.mx * st.c - st.my * st.s) * v
				m[1] += (st.mx * st.s + st.my * st.c) * v
				m[2] += st.mz * v
				soft[st.spec.solid] = m
				if (st.spec.coil !== undefined) coils[st.spec.solid] = st.amps ?? currentAt(st.spec.coil.current ?? [], time)
			})
			for (const [id, m] of Object.entries(soft)) {
				const t = vol.get(id) ?? 1
				m[0] /= t
				m[1] /= t
				m[2] /= t
			}
			const out: Record<string, number> = {}
			for (const c of charges) out[c.spec.solid] = (out[c.spec.solid] ?? 0) + c.q
			return { soft, coils, charges: out }
		}
	}

	let limitOf: ((solid: string) => number) | undefined
	/** this step's pair contributions, held until every pair is reckoned (`step`), and each pair of solids' total pull and share */
	const pending: { key: string; solid: string; fx: number; fy: number; px: number; py: number; torque: number; k: number }[] = []
	let pairKey = ""
	const pairTotals = new Map<string, [number, number]>()
	const pairShares = new Map<string, number>()
	/** The share of a pair's push both its solids get: 1, or less where it would push either harder than its limit. */
	const pairShare = (a: string, b: string, f: number) => {
		if (limitOf === undefined || !(f > 0)) return 1
		const cap = Math.min(limitOf(a), limitOf(b))
		return f > cap ? cap / f : 1
	}
	const live = (b: MagBody) => b.faces.some((f) => f.sigma !== 0)
	/** A body's turning stiffness in the field, N·m/rad: |m|·|B| (a soft body's piece's own moment and field). */
	const stiffness = (b: MagBody) => Math.sqrt(b.mx * b.mx + b.my * b.my) * Math.sqrt(b.bx * b.bx + b.by * b.by)

	/** The force and turning on `target` from `source`'s field, and the opposite on `source`. */
	const pairWrench = (target: MagBody, source: MagBody, apply: Apply) => {
		const dx = target.cx - source.cx
		const dy = target.cy - source.cy
		const dz = target.cz - source.cz
		const r2 = dx * dx + dy * dy + dz * dz
		const r = Math.sqrt(r2)
		const far = Math.min(target.farK, source.farK) * (target.reach + source.reach)
		const band = target.reach + source.reach
		const k = MU0 / (4 * Math.PI)
		let fx = 0
		let fy = 0
		let torque = 0
		if (r > far) {
			// two dipoles: F = 3μ0/(4π r⁵)·[(m₁·r)m₂ + (m₂·r)m₁ + (m₁·m₂)r − 5(m₁·r)(m₂·r)r/r²], τ = m₂ × B₁
			const m1 = Math.sqrt(source.mx * source.mx + source.my * source.my + source.mz * source.mz)
			const m2 = Math.sqrt(target.mx * target.mx + target.my * target.my + target.mz * target.mz)
			const r3 = r2 * r
			if ((6 * k * m1 * m2) / (r3 * r) < NEGLIGIBLE_FORCE && (2 * k * m1 * m2) / r3 < NEGLIGIBLE_TORQUE) return
			const a = source.mx * dx + source.my * dy + source.mz * dz
			const b = target.mx * dx + target.my * dy + target.mz * dz
			const c = source.mx * target.mx + source.my * target.my + source.mz * target.mz
			const f = (3 * k) / (r3 * r2)
			fx = f * (a * target.mx + b * source.mx + c * dx - (5 * a * b * dx) / r2)
			fy = f * (a * target.my + b * source.my + c * dy - (5 * a * b * dy) / r2)
			const bx = (k * ((3 * a * dx) / r2 - source.mx)) / r3
			const by = (k * ((3 * a * dy) / r2 - source.my)) / r3
			torque = target.mx * by - target.my * bx
			if (r < far + band) {
				// (blended into the faces' own reckoning over a band as wide as the two reaches)
				const u = (r - far) / band
				const blend = u * u * (3 - 2 * u)
				facePair(target, source)
				fx = blend * fx + (1 - blend) * (pair[0] as number) * k
				fy = blend * fy + (1 - blend) * (pair[1] as number) * k
				torque = blend * torque + (1 - blend) * (pair[2] as number) * k
			}
		} else {
			facePair(target, source)
			fx = (pair[0] as number) * k
			fy = (pair[1] as number) * k
			torque = (pair[2] as number) * k
		}
		if (target.round) torque = 0
		if (fx === 0 && fy === 0 && torque === 0) return
		apply(target.solid, fx, fy, target.cx, target.cy, torque, stiffness(target))
		// the source: the opposite force at the same point and the opposite turning about it (no pair pushes or turns itself)
		apply(source.solid, -fx, -fy, target.cx, target.cy, source.round ? 0 : -torque, stiffness(source))
	}

	/**
	 * A compass needle within NEEDLE_KICK of pointing exactly against the field at it (its field from every other body and the Earth, this
	 * step) is turned as a needle NEEDLE_KICK off would be, the way it is already turning (counter-clockwise from exactly against): so it
	 * swings round as a real one does, never balancing on the unstable side (a needle started pointing right with north to the left, a magnet
	 * flipped level with it). Further off, nothing is added.
	 */
	const needleKick = (apply: Apply) => {
		magnets.forEach((m, i) => {
			if (m.needle !== true) return
			const body = bodies[i] as MagBody
			if (!live(body)) return
			const mm = Math.sqrt(body.mx * body.mx + body.my * body.my)
			const bb = Math.sqrt(body.bx * body.bx + body.by * body.by)
			if (!(mm > 0) || !(bb > 0)) return
			const dot = body.mx * body.bx + body.my * body.by
			const cross = body.mx * body.by - body.my * body.bx
			const most = NEEDLE_KICK_SIN * mm * bb
			if (dot >= 0 || Math.abs(cross) >= most) return
			const want = cross < 0 ? -most : most
			apply(m.solid, 0, 0, body.cx, body.cy, want - cross, 0)
		})
	}

	const pair = new Float64Array(3)
	/** The force and turning (per μ0/(4π)) on `target`'s faces in `source`'s faces' field, sampled over each target face: pair[0..2]. */
	const facePair = (target: MagBody, source: MagBody) => {
		let fx = 0
		let fy = 0
		let torque = 0
		for (const tf of target.faces) {
			if (tf.sigma === 0) continue
			// how finely the target face is sampled: by its size against its distance from the source's nearest face
			let near = Number.POSITIVE_INFINITY
			for (const sf of source.faces) {
				if (sf.sigma === 0) continue
				const dx = tf.cx - sf.cx
				const dy = tf.cy - sf.cy
				const dz = tf.cz - sf.cz
				near = Math.min(near, Math.sqrt(dx * dx + dy * dy + dz * dz) - sf.reach)
			}
			if (near === Number.POSITIVE_INFINITY) break
			// (the face's two directions its points are spread along: an in-plane face's tangent and z; a face across the plane, (nx, ny) and
			// its perpendicular in the plane)
			const across = tf.zn !== 0
			const tx = across ? tf.nx : -tf.ny
			const ty = across ? tf.ny : tf.nx
			const vx = across ? -tf.ny : 0
			const vy = across ? tf.nx : 0
			if (near > ONE_POINT * tf.reach) {
				acc[0] = 0
				acc[1] = 0
				for (const sf of source.faces) addFaceField(sf, tf.cx, tf.cy, tf.cz, acc, tmp)
				const ffx = tf.q * (acc[0] as number)
				const ffy = tf.q * (acc[1] as number)
				fx += ffx
				fy += ffy
				torque += (tf.cx - target.cx) * ffy - (tf.cy - target.cy) * ffx
				continue
			}
			// Gauss points over the face: 3 × 2 (along it × across the plane), 5 × 3 where it nearly touches the source
			const fine = near < NEAR_FACE * tf.reach
			const gu = fine ? G5 : G3
			const wu = fine ? W5 : W3
			const gv = fine ? G3 : G2
			const wv = fine ? W3 : W2
			const area = 4 * tf.a * tf.b
			for (let i = 0; i < gu.length; i++) {
				const u = (gu[i] as number) * tf.a
				for (let k = 0; k < gv.length; k++) {
					const v = (gv[k] as number) * tf.b
					const px = tf.cx + u * tx + v * vx
					const py = tf.cy + u * ty + v * vy
					const pz = across ? tf.cz : tf.cz + v
					acc[0] = 0
					acc[1] = 0
					for (const sf of source.faces) addFaceField(sf, px, py, pz, acc, tmp)
					const weight = (tf.sigma * area * (wu[i] as number) * (wv[k] as number)) / 4
					const ffx = weight * (acc[0] as number)
					const ffy = weight * (acc[1] as number)
					fx += ffx
					fy += ffy
					torque += (px - target.cx) * ffy - (py - target.cy) * ffx
				}
			}
		}
		pair[0] = fx
		pair[1] = fy
		pair[2] = torque
	}

	/** Coulomb's forces between charges, and what the field does to polarizable things (p = α·E: F = (p·∇)E, τ = p × E). */
	const electric = (poseOf: (solid: string) => Pose | undefined, apply: Apply) => {
		for (const c of charges) {
			const pose = poseOf(c.spec.solid)
			if (pose === undefined) continue
			const cs = Math.cos(pose.angle)
			const sn = Math.sin(pose.angle)
			c.px = pose.x + c.spec.x * cs - c.spec.y * sn
			c.py = pose.y + c.spec.x * sn + c.spec.y * cs
		}
		for (let i = 0; i < charges.length; i++) {
			const a = charges[i] as (typeof charges)[number]
			if (a.q === 0) continue
			for (let j = i + 1; j < charges.length; j++) {
				const b = charges[j] as (typeof charges)[number]
				if (b.q === 0 || b.spec.solid === a.spec.solid) continue
				const dx = b.px - a.px
				const dy = b.py - a.py
				const r2 = dx * dx + dy * dy
				const r = Math.sqrt(r2)
				const core = Math.max(a.spec.radius, b.spec.radius)
				const k0 = (KE * a.q * b.q) / (r >= core ? r2 * r : core * core * core)
				const k = k0 * pairShare(a.spec.solid, b.spec.solid, Math.abs(k0) * r)
				apply(b.spec.solid, k * dx, k * dy, b.px, b.py, 0, 0)
				apply(a.spec.solid, -k * dx, -k * dy, a.px, a.py, 0, 0)
			}
		}
		for (const p of polars) {
			const pose = poseOf(p.spec.solid)
			if (pose === undefined) continue
			const cs = Math.cos(pose.angle)
			const sn = Math.sin(pose.angle)
			const px = pose.x + p.spec.x * cs - p.spec.y * sn
			const py = pose.y + p.spec.x * sn + p.spec.y * cs
			// the field there, from every charge but its own body's
			let ex = 0
			let ey = 0
			for (const c of charges) {
				if (c.q === 0 || c.spec.solid === p.spec.solid) continue
				const dx = px - c.px
				const dy = py - c.py
				const r2 = dx * dx + dy * dy
				const r = Math.sqrt(r2)
				const core = c.spec.radius
				const k = (KE * c.q) / (r >= core ? r2 * r : core * core * core)
				ex += k * dx
				ey += k * dy
			}
			if (ex === 0 && ey === 0) continue
			// p = α·E along its own axes (a ball: along E)
			const round = p.spec.round === true
			const ux = round ? ex : ex * cs + ey * sn
			const uy = round ? ey : -ex * sn + ey * cs
			const qx = p.ax * ux
			const qy = p.ay * uy
			const dpx = round ? qx : qx * cs - qy * sn
			const dpy = round ? qy : qx * sn + qy * cs
			// F = (p·∇)E from each charge, and its reaction on that charge's body; τ = p × E
			for (const c of charges) {
				if (c.q === 0 || c.spec.solid === p.spec.solid) continue
				const dx = px - c.px
				const dy = py - c.py
				const r2 = dx * dx + dy * dy
				const r = Math.sqrt(r2)
				const core = c.spec.radius
				let fx: number
				let fy: number
				let ex1: number
				let ey1: number
				if (r >= core) {
					const r3 = r2 * r
					const pd = dpx * dx + dpy * dy
					fx = KE * c.q * (dpx / r3 - (3 * pd * dx) / (r3 * r2))
					fy = KE * c.q * (dpy / r3 - (3 * pd * dy) / (r3 * r2))
					ex1 = (KE * c.q * dx) / r3
					ey1 = (KE * c.q * dy) / r3
				} else {
					const c3 = core * core * core
					fx = (KE * c.q * dpx) / c3
					fy = (KE * c.q * dpy) / c3
					ex1 = (KE * c.q * dx) / c3
					ey1 = (KE * c.q * dy) / c3
				}
				const share = pairShare(p.spec.solid, c.spec.solid, Math.sqrt(fx * fx + fy * fy))
				fx *= share
				fy *= share
				const tq = (round ? 0 : dpx * ey1 - dpy * ex1) * share
				// (a scrap's turning stiffness: |p|·|E|)
				const kappa = Math.sqrt(dpx * dpx + dpy * dpy) * Math.sqrt(ex * ex + ey * ey)
				apply(p.spec.solid, fx, fy, px, py, tq, kappa)
				apply(c.spec.solid, -fx, -fy, px, py, -tq, 0)
			}
		}
	}

	/** The energy a conductor's charge holds, q²/(2C) (none grounded). */
	const energyOf = (c: (typeof charges)[number]) => (c.spec.grounded === true ? 0 : (c.q * c.q) / (2 * c.spec.capacitance))

	/** Charge moving between two charge records that touch (see the file's comment). */
	const share = (x: (typeof charges)[number], y: (typeof charges)[number]) => {
		const xc = x.spec.conductor === true
		const yc = y.spec.conductor === true
		if (x.spec.grounded === true || y.spec.grounded === true) {
			// the Earth takes what touches it: all of a conductor's, an insulator's patch (INSULATOR_PATCH)
			for (const z of [x, y]) {
				if (z.spec.grounded === true) continue
				z.q = z.spec.conductor === true ? 0 : z.q * (1 - INSULATOR_PATCH)
			}
			return
		}
		if (!xc && !yc) return
		const total = x.q + y.q
		if (xc && yc) {
			// equal potential: q ∝ C
			const qx = (total * x.spec.capacitance) / (x.spec.capacitance + y.spec.capacitance)
			x.q = qx
			y.q = total - qx
			return
		}
		// an insulator gives (or takes) only what is where it touched: the conductor comes to the potential of that patch
		const [ins, con] = xc ? [y, x] : [x, y]
		const patch = ins.q * INSULATOR_PATCH
		const moved = ((patch + con.q) * con.spec.capacitance) / (con.spec.capacitance + ins.spec.capacitance * INSULATOR_PATCH) - con.q
		con.q += moved
		ins.q -= moved
	}

	return fields
}

/**
 * The share of an insulator's charge that sits where it touches something (a rubbed balloon's charge stays where it was rubbed and
 * moves only from the patch that touches): provisional, a balloon touched once to a grounded pole keeps 80 % of its charge.
 */
export const INSULATOR_PATCH = 0.2

/** Air's breakdown voltage across a gap of d metres at 1 atm (Paschen's law, constants above); the minimum (327 V near 7.5 µm) below it. */
export const breakdownVolts = (d: number) => {
	const pd = PASCHEN_AP * d
	const denominator = ln(pd) - ln(ln(1 + 1 / PASCHEN_GAMMA))
	if (!(denominator > 0.5)) return 327
	return Math.max(327, (PASCHEN_BP * d) / denominator)
}
