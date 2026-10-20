/**
 * A deterministic 2-D particle system: the molecules of the particle model of matter (a gas, a liquid, a solid, two gases mixing) and real
 * grains (sand, gravel, iron filings, salt or sugar crystals in water). It runs inside the engine's 480 Hz step in sub-steps of its own and
 * touches nothing else of the engine: the host (matter/host.ts) moves its walls, reads its walls' impulses (pressure, a piston's push) and
 * draws its positions into the track.
 *
 * Model (Cundall & Strack 1979, the discrete element method): each particle is a disc (a sphere's section: its mass, volume, buoyancy and
 * drag are a sphere's) that touches others and the walls through a spring and dashpot along the line of centres, whose damping gives the
 * pair's coefficient of restitution exactly for a linear contact (the damping ratio ζ = −ln e / √(π² + ln² e), solved here from e by
 * bisection on exp, so no log is needed), and a Coulomb friction along the contact (a capped viscous slip). A LIQUID particle is held to its
 * LIQUID neighbours by a short-range pull (a smooth well 4·s·(1−s) wide `cohesionRange` beyond touching) with a pair damping that makes the
 * liquid flow like one (dissipative particle dynamics' drag); a SOLID particle is bonded to its SOLID neighbours by springs at their
 * starting distances. A FREE particle has neither (a gas molecule, a loose grain).
 *
 * Determinism: only + − × ÷ and √ in the loops, plus Math.exp and Math.pow (the engine's own deterministic versions in the bundle and in
 * the server's node, tools/fdlibm.ts and tools/crpow.ts); every loop runs in index order (a cell list sorted by counting, never by a
 * hash), so the server and every browser get the same bits.
 */

/** Phases of a particle (`phase`): free (a gas molecule or a loose grain), liquid (held to its neighbours, flowing), solid (bonded). */
export const FREE = 0
export const LIQUID = 1
export const SOLID = 2

/** One kind of particle. */
export interface Kind {
	/** Its radius, m: the contact size and the drawn size. */
	readonly radius: number
	/** Its mass, kg. */
	readonly mass: number
	/** Coefficient of restitution of a head-on impact with another particle (the lower of the two applies) or a wall (with the wall's). */
	readonly restitution: number
	/** Coulomb friction coefficient (√ of the two). */
	readonly friction: number
	/**
	 * Its magnetic pull factor, m³/(μ0) = A·m²/T per tesla of field: in a field B (T) it is pulled up the gradient of B² with a force
	 * magnetic · ∇(B²) / 2 (a soft magnetic particle magnetised in proportion to the field: F = (χ_eff·V/μ0)·(B·∇)B, Jiles, Introduction
	 * to Magnetism and Magnetic Materials, ch. 2). 0: not magnetic.
	 */
	readonly magnetic: number
	/** Its volume as a sphere, m³ (buoyancy in a liquid). */
	readonly volume: number
}

/** A wall: a capsule from (ax, ay) to (bx, by) with half-thickness r, m, in the system's frame; it moves with its group's offset. */
export interface Wall {
	readonly ax: number
	readonly ay: number
	readonly bx: number
	readonly by: number
	readonly r: number
	/** Its group (a box's floor, its sides, a piston, a sieve's mesh): the host moves a group and reads its impulse. */
	readonly group: number
	/** Restitution and friction against particles. */
	readonly restitution: number
	readonly friction: number
}

/** A fixed or moving round obstacle (a sieve's wire seen end on, a peg), m, in the system's frame, moving with its group. */
export interface Disc {
	readonly x: number
	readonly y: number
	readonly r: number
	readonly group: number
	readonly restitution: number
	readonly friction: number
}

/**
 * A convex outline of another body (a magnet, a spoon, a block dropped in), its points counter-clockwise in the system's frame at this
 * sub-step, with its rigid motion (velocity of `cx, cy` and spin w, rad/s) so a particle it strikes takes its motion. Particles are pushed
 * out of it; the push on it is added up in `push` (N·s, x and y, and the moment about (cx, cy)) for the host.
 */
export interface Outline {
	readonly points: readonly number[] // x0, y0, x1, y1, ... counter-clockwise
	readonly cx: number
	readonly cy: number
	readonly vx: number
	readonly vy: number
	readonly w: number
	readonly restitution: number
	readonly friction: number
	/** A round body instead (points empty): its radius. */
	readonly radius?: number
	push: { x: number; y: number; m: number }
}

/** A liquid the particles may be in (a glass of water): below `level` they are buoyed and dragged toward its flow. */
export interface Bath {
	/** Its surface height in the system's frame, m. */
	level: number
	/** Its density, kg/m³, and dynamic viscosity, Pa·s. */
	density: number
	viscosity: number
	/** Its flow at a point (stirring), m/s; none = still. */
	flow?: (x: number, y: number, out: { x: number; y: number }) => void
}

/**
 * The restitution of a linear spring-dashpot contact of damping ratio ζ that never pulls (Schwager & Pöschel, Phys. Rev. E 75, 051304,
 * 2007): the overlap x(t) = (v0/ω_d)·e^(−ζω0 t)·sin(ω_d t) ends when the force k·x + c·ẋ falls to zero, at ω_d·t* = π − atan2(2ζ√(1−ζ²), 1 − 2ζ²),
 * and the particles part at e = e^(−ζω0 t*)·(ζ/√(1−ζ²)·sin(ω_d t*) − cos(ω_d t*)).
 */
export const noPullRestitution = (z: number): number => {
	if (!(z > 0)) return 1
	if (!(z < 1)) return 0
	const q = Math.sqrt(1 - z * z)
	const th = Math.PI - Math.atan2(2 * z * q, 1 - 2 * z * z)
	return Math.exp((-z * th) / q) * ((z / q) * Math.sin(th) - Math.cos(th))
}

/** The damping ratio that gives that contact the restitution e (0 < e ≤ 1), by bisection on noPullRestitution (no log needed). */
export const dampingRatio = (e: number): number => {
	if (!(e < 1)) return 0
	if (!(e > 1e-6)) return 0.9999
	let lo = 0
	let hi = 0.9999
	for (let k = 0; k < 64; k++) {
		const z = (lo + hi) / 2
		if (noPullRestitution(z) > e) lo = z
		else hi = z
	}
	return (lo + hi) / 2
}

/** Settings of a particle system. */
export interface SystemSpec {
	readonly kinds: readonly Kind[]
	/**
	 * Contact stiffness, N/m, of two particles of radius `refRadius`; a pair of others has stiffness × (R/refRadius)², R = 2·ri·rj/(ri + rj)
	 * (a wall: R = ri), so a heap of big grains and one of small ones press in by the same share of their size (k ∝ R² against weight ∝ R³),
	 * and small light grains stay soft enough for the sub-step. One size only (a gas): every contact has `stiffness`.
	 */
	readonly stiffness: number
	readonly refRadius?: number
	/** Gravity, m/s² (x, y), and each phase's share of it (a model's molecules: none for a gas, its condensed phases some). */
	readonly gravity: { readonly x: number; readonly y: number }
	readonly gravityByPhase: readonly [number, number, number]
	/** Liquid pull: the well's reach beyond touching, as a fraction of the two radii, and its peak force, N. */
	readonly cohesionRange: number
	readonly cohesionForce: number
	/** Liquid pair damping (along the line of centres, within reach), N·s/m. */
	readonly liquidDamping: number
	/** Solid bonds: stiffness N/m and damping ratio. */
	readonly bondStiffness: number
	readonly bondDamping: number
	/** Bounds of where particles may be (the cell grid), m: a particle outside is kept in the edge cells. */
	readonly bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
	/** The longest sub-step, s (the host picks the count from it). */
	readonly maxSubStep: number
	/** A wall's restitution and friction against a particle of each phase instead of the wall's own (a gas bounces off the walls, a liquid or a solid settles on them). */
	readonly wallByPhase?: readonly [readonly [number, number] | null, readonly [number, number] | null, readonly [number, number] | null]
}

export class Particles {
	readonly spec: SystemSpec
	n = 0
	x: Float64Array
	y: Float64Array
	vx: Float64Array
	vy: Float64Array
	fx: Float64Array
	fy: Float64Array
	/** Each particle's kind (index into spec.kinds), phase and whether it is still there (a dissolved grain is gone). */
	kind: Uint8Array
	phase: Uint8Array
	alive: Uint8Array
	/** Its radius now (a dissolving grain shrinks), m, and its mass now, kg. */
	r: Float64Array
	m: Float64Array
	walls: Wall[] = []
	discs: Disc[] = []
	outlines: Outline[] = []
	/** Each wall group's offset and velocity (the host moves them), and the impulse particles gave it (N·s, along x and y) since `clearImpulses`. */
	groupOffset: { x: number; y: number }[] = []
	groupVelocity: { x: number; y: number }[] = []
	impulse: { x: number; y: number; normal: number; hits: number; all: number }[] = []
	/** Solid bonds: pairs and rest lengths. */
	bondA: number[] = []
	bondB: number[] = []
	bondRest: number[] = []
	bath: Bath | undefined
	/** Which phases' hits the wall groups' impulses count (a bit mask, 1 << phase): a gas gauge counts only the gas's. */
	impulseMask = 7
	/** An outside force per particle (a magnet's pull): adds to fx, fy. */
	field: ((p: Particles, i: number) => void) | undefined
	private zeta: Float64Array // damping ratio per kind pair
	private zetaWall = new Map<number, number>()
	private cell: Float64Array // cell size (1 value)
	private cols = 1
	private rows = 1
	private head: Int32Array = new Int32Array(1)
	private next: Int32Array
	private order: Int32Array
	private reach: Int32Array
	private cellX: Int32Array
	private cellY: Int32Array
	private flowAt = { x: 0, y: 0 }
	private boxes = new Float64Array(0)
	private kick = new Float64Array(0)

	constructor(spec: SystemSpec, capacity: number) {
		this.spec = spec
		this.x = new Float64Array(capacity)
		this.y = new Float64Array(capacity)
		this.vx = new Float64Array(capacity)
		this.vy = new Float64Array(capacity)
		this.fx = new Float64Array(capacity)
		this.fy = new Float64Array(capacity)
		this.kind = new Uint8Array(capacity)
		this.phase = new Uint8Array(capacity)
		this.alive = new Uint8Array(capacity)
		this.r = new Float64Array(capacity)
		this.m = new Float64Array(capacity)
		this.next = new Int32Array(capacity)
		this.order = new Int32Array(capacity)
		this.reach = new Int32Array(capacity)
		this.cellX = new Int32Array(capacity)
		this.cellY = new Int32Array(capacity)
		const nk = spec.kinds.length
		this.zeta = new Float64Array(nk * nk)
		for (let a = 0; a < nk; a++)
			for (let b = 0; b < nk; b++) {
				const ka = spec.kinds[a] as Kind
				const kb = spec.kinds[b] as Kind
				this.zeta[a * nk + b] = dampingRatio(Math.min(ka.restitution, kb.restitution))
			}
		this.cell = new Float64Array(1)
		this.setupGrid()
	}

	/** Adds a particle; returns its index. */
	add(kind: number, x: number, y: number, vx = 0, vy = 0, phase = FREE): number {
		const i = this.n++
		const k = this.spec.kinds[kind] as Kind
		this.kind[i] = kind
		this.x[i] = x
		this.y[i] = y
		this.vx[i] = vx
		this.vy[i] = vy
		this.phase[i] = phase
		this.alive[i] = 1
		this.r[i] = k.radius
		this.m[i] = k.mass
		return i
	}

	/** A wall group's index (made on first use). */
	group(g: number) {
		while (this.groupOffset.length <= g) {
			this.groupOffset.push({ x: 0, y: 0 })
			this.groupVelocity.push({ x: 0, y: 0 })
			this.impulse.push({ x: 0, y: 0, normal: 0, hits: 0, all: 0 })
		}
		return g
	}

	addWall(w: Wall) {
		this.group(w.group)
		this.walls.push(w)
	}

	addDisc(d: Disc) {
		this.group(d.group)
		this.discs.push(d)
	}

	clearImpulses() {
		for (const q of this.impulse) {
			q.x = 0
			q.y = 0
			q.normal = 0
			q.hits = 0
			q.all = 0
		}
	}

	private setupGrid() {
		const s = this.spec
		let small = Infinity
		for (const k of s.kinds) small = Math.min(small, k.radius)
		// a cell holds the smallest kind's reach (two radii and the liquid pull's reach): a larger particle looks further (its `reach`)
		this.cell[0] = 2 * small * (1 + s.cohesionRange)
		const c = this.cell[0] as number
		this.cols = Math.max(1, Math.min(4096, Math.ceil((s.bounds.x1 - s.bounds.x0) / c)))
		this.rows = Math.max(1, Math.min(4096, Math.ceil((s.bounds.y1 - s.bounds.y0) / c)))
		this.head = new Int32Array(this.cols * this.rows)
	}

	private cellOf(x: number, y: number) {
		const s = this.spec.bounds
		const c = this.cell[0] as number
		let cx = Math.floor((x - s.x0) / c)
		let cy = Math.floor((y - s.y0) / c)
		if (!(cx >= 0)) cx = 0
		if (cx >= this.cols) cx = this.cols - 1
		if (!(cy >= 0)) cy = 0
		if (cy >= this.rows) cy = this.rows - 1
		return cy * this.cols + cx
	}

	/** Builds the cell list: every live particle in the cell of its centre, each cell's list in index order. */
	private bin() {
		this.head.fill(-1)
		const c = this.cell[0] as number
		const range = 1 + this.spec.cohesionRange
		// (walk backwards so each cell's list comes out in increasing index order)
		for (let i = this.n - 1; i >= 0; i--) {
			if (this.alive[i] === 0) continue
			const k = this.cellOf(this.x[i] as number, this.y[i] as number)
			this.cellX[i] = k % this.cols
			this.cellY[i] = (k - (k % this.cols)) / this.cols
			this.next[i] = this.head[k] as number
			this.head[k] = i
			this.reach[i] = Math.max(1, Math.ceil((2 * (this.r[i] as number) * range) / c))
		}
	}

	/** Bonds every pair of SOLID particles closer than `range` × the sum of their radii, at their distance now (a lattice frozen in place). */
	bondSolids(range: number) {
		this.bin()
		const have = new Set<number>()
		for (let k = 0; k < this.bondA.length; k++) have.add((this.bondA[k] as number) * 65536 + (this.bondB[k] as number))
		for (let i = 0; i < this.n; i++) {
			if (this.alive[i] === 0 || this.phase[i] !== SOLID) continue
			this.scan(i, (j) => {
				if (j <= i || this.phase[j] !== SOLID) return
				const dx = (this.x[j] as number) - (this.x[i] as number)
				const dy = (this.y[j] as number) - (this.y[i] as number)
				const d = Math.sqrt(dx * dx + dy * dy)
				if (d < range * ((this.r[i] as number) + (this.r[j] as number)) && !have.has(i * 65536 + j)) {
					this.bondA.push(i)
					this.bondB.push(j)
					this.bondRest.push(d)
					have.add(i * 65536 + j)
				}
			})
		}
	}

	/** Drops the bonds of particles that are no longer SOLID (or gone). */
	pruneBonds() {
		let w = 0
		for (let k = 0; k < this.bondA.length; k++) {
			const a = this.bondA[k] as number
			const b = this.bondB[k] as number
			if (this.phase[a] !== SOLID || this.phase[b] !== SOLID || this.alive[a] === 0 || this.alive[b] === 0) continue
			this.bondA[w] = a
			this.bondB[w] = b
			this.bondRest[w] = this.bondRest[k] as number
			w++
		}
		this.bondA.length = w
		this.bondB.length = w
		this.bondRest.length = w
	}

	/** Calls f(j) for every live particle j in the cells within particle i's reach, cell by cell in row order, each cell in index order. */
	private scan(i: number, f: (j: number) => void) {
		const s = this.spec.bounds
		const c = this.cell[0] as number
		const reach = this.reach[i] as number
		let cx = Math.floor(((this.x[i] as number) - s.x0) / c)
		let cy = Math.floor(((this.y[i] as number) - s.y0) / c)
		if (!(cx >= 0)) cx = 0
		if (cx >= this.cols) cx = this.cols - 1
		if (!(cy >= 0)) cy = 0
		if (cy >= this.rows) cy = this.rows - 1
		const y0 = Math.max(0, cy - reach)
		const y1 = Math.min(this.rows - 1, cy + reach)
		const x0 = Math.max(0, cx - reach)
		const x1 = Math.min(this.cols - 1, cx + reach)
		for (let gy = y0; gy <= y1; gy++)
			for (let gx = x0; gx <= x1; gx++) for (let j = this.head[gy * this.cols + gx] as number; j >= 0; j = this.next[j] as number) f(j)
	}

	/** The stiffness of a contact whose effective radius is R. */
	private stiffnessAt(R: number) {
		const ref = this.spec.refRadius
		if (ref === undefined) return this.spec.stiffness
		const q = R / ref
		return this.spec.stiffness * q * q
	}

	private wallZeta(e: number) {
		let z = this.zetaWall.get(e)
		if (z === undefined) {
			z = dampingRatio(e)
			this.zetaWall.set(e, z)
		}
		return z
	}

	/** One sub-step of length h: forces, then velocities and positions (symplectic Euler). */
	step(h: number) {
		const s = this.spec
		const n = this.n
		const { x, y, vx, vy, fx, fy, r, m, phase, alive, kind } = this
		const nk = s.kinds.length
		this.bin()
		const head = this.head
		const next = this.next
		const cols = this.cols
		const rows = this.rows
		for (let i = 0; i < n; i++) {
			fx[i] = 0
			fy[i] = 0
		}
		// pairs: each once, from the larger particle (or the lower index of two the same size), whose reach covers the pair
		const range = s.cohesionRange
		for (let i = 0; i < n; i++) {
			if (alive[i] === 0) continue
			const xi = x[i] as number
			const yi = y[i] as number
			const ri = r[i] as number
			const ki = kind[i] as number
			const pi = phase[i] as number
			const reach = this.reach[i] as number
			const ci = this.cellX[i] as number
			const cj = this.cellY[i] as number
			const gx0 = ci - reach < 0 ? 0 : ci - reach
			const gy1 = cj + reach >= rows ? rows - 1 : cj + reach
			const gx1 = ci + reach >= cols ? cols - 1 : ci + reach
			for (let gy = cj - reach < 0 ? 0 : cj - reach; gy <= gy1; gy++) {
				for (let gx = gx0; gx <= gx1; gx++) {
					for (let j = head[gy * cols + gx] as number; j >= 0; j = next[j] as number) {
						const rj = r[j] as number
						if (j === i || rj > ri || (rj === ri && j < i)) continue
						const dx = (x[j] as number) - xi
						const dy = (y[j] as number) - yi
						const sum = ri + rj
						const reachD = sum * (1 + range)
						const d2 = dx * dx + dy * dy
						if (d2 >= reachD * reachD || d2 === 0) continue
						const d = Math.sqrt(d2)
						const nx = dx / d
						const ny = dy / d
						const rvx = (vx[j] as number) - (vx[i] as number)
						const rvy = (vy[j] as number) - (vy[i] as number)
						const vn = rvx * nx + rvy * ny
						let f = 0 // along n, positive pushes j away from i
						const pj = phase[j] as number
						if (d < sum) {
							const mi = m[i] as number
							const mj = m[j] as number
							const mu = (mi * mj) / (mi + mj)
							const zeta = this.zeta[ki * nk + (kind[j] as number)] as number
							const kk = this.stiffnessAt((2 * ri * rj) / sum)
						const fn = kk * (sum - d) - 2 * zeta * Math.sqrt(kk * mu) * vn
							if (fn > 0) {
								f += fn
								// friction: a viscous slip capped at μ·N, against the tangential motion at the contact (spin is not tracked)
								const tvx = rvx - vn * nx
								const tvy = rvy - vn * ny
								const vt = Math.sqrt(tvx * tvx + tvy * tvy)
								if (vt > 1e-12) {
									const mu2 = Math.sqrt((s.kinds[ki] as Kind).friction * (s.kinds[kind[j] as number] as Kind).friction)
									const ft = Math.min(mu2 * fn, (mu * vt) / h / 2)
									const tx = (ft * tvx) / vt
									const ty = (ft * tvy) / vt
									fx[i] = (fx[i] as number) + tx
									fy[i] = (fy[i] as number) + ty
									fx[j] = (fx[j] as number) - tx
									fy[j] = (fy[j] as number) - ty
								}
							}
						}
						if (pi === LIQUID && (pj === LIQUID || pj === SOLID) || (pi === SOLID && pj === LIQUID)) {
							// the liquid's pull: a smooth well from touching out to its reach, peak cohesionForce (half against a solid: wetting)
							const sDist = (d - sum) / (sum * range)
							const peak = pi === pj ? s.cohesionForce : s.cohesionForce / 2
							if (sDist > 0) f -= peak * 4 * sDist * (1 - sDist)
							f -= s.liquidDamping * vn
						}
						if (f !== 0) {
							fx[i] = (fx[i] as number) - f * nx
							fy[i] = (fy[i] as number) - f * ny
							fx[j] = (fx[j] as number) + f * nx
							fy[j] = (fy[j] as number) + f * ny
						}
					}
				}
			}
		}
		// solid bonds
		for (let b = 0; b < this.bondA.length; b++) {
			const i = this.bondA[b] as number
			const j = this.bondB[b] as number
			const dx = (x[j] as number) - (x[i] as number)
			const dy = (y[j] as number) - (y[i] as number)
			const d = Math.sqrt(dx * dx + dy * dy)
			if (d === 0) continue
			const nx = dx / d
			const ny = dy / d
			const vn = ((vx[j] as number) - (vx[i] as number)) * nx + ((vy[j] as number) - (vy[i] as number)) * ny
			const mu = ((m[i] as number) * (m[j] as number)) / ((m[i] as number) + (m[j] as number))
			const f = s.bondStiffness * (d - (this.bondRest[b] as number)) + 2 * s.bondDamping * Math.sqrt(s.bondStiffness * mu) * vn
			fx[i] = (fx[i] as number) + f * nx
			fy[i] = (fy[i] as number) + f * ny
			fx[j] = (fx[j] as number) - f * nx
			fy[j] = (fy[j] as number) - f * ny
		}
		// walls, discs, outlines, gravity, the bath, the field (each wall and disc first by its box, as it stands this sub-step)
		const bath = this.bath
		const walls = this.walls
		const discs = this.discs
		const nw = walls.length
		const nd = discs.length
		if (this.boxes.length < 4 * (nw + nd)) this.boxes = new Float64Array(4 * (nw + nd))
		const box = this.boxes
		for (let w = 0; w < nw; w++) {
			const wl = walls[w] as Wall
			const off = this.groupOffset[wl.group] as { x: number; y: number }
			box[4 * w] = Math.min(wl.ax, wl.bx) + off.x - wl.r
			box[4 * w + 1] = Math.max(wl.ax, wl.bx) + off.x + wl.r
			box[4 * w + 2] = Math.min(wl.ay, wl.by) + off.y - wl.r
			box[4 * w + 3] = Math.max(wl.ay, wl.by) + off.y + wl.r
		}
		for (let d = 0; d < nd; d++) {
			const dc = discs[d] as Disc
			const off = this.groupOffset[dc.group] as { x: number; y: number }
			const b = 4 * (nw + d)
			box[b] = dc.x + off.x - dc.r
			box[b + 1] = dc.x + off.x + dc.r
			box[b + 2] = dc.y + off.y - dc.r
			box[b + 3] = dc.y + off.y + dc.r
		}
		for (let i = 0; i < n; i++) {
			if (alive[i] === 0) continue
			const ri = r[i] as number
			const mi = m[i] as number
			const kd = s.kinds[kind[i] as number] as Kind
			const g = s.gravityByPhase[phase[i] as number] as number
			fx[i] = (fx[i] as number) + mi * s.gravity.x * g
			fy[i] = (fy[i] as number) + mi * s.gravity.y * g
			const px = x[i] as number
			const py = y[i] as number
			for (let w = 0; w < nw; w++) {
				if (px + ri < (box[4 * w] as number) || px - ri > (box[4 * w + 1] as number) || py + ri < (box[4 * w + 2] as number) || py - ri > (box[4 * w + 3] as number)) continue
				this.touchWall(i, walls[w] as Wall, ri, mi, kd, h)
			}
			for (let d = 0; d < nd; d++) {
				const b = 4 * (nw + d)
				if (px + ri < (box[b] as number) || px - ri > (box[b + 1] as number) || py + ri < (box[b + 2] as number) || py - ri > (box[b + 3] as number)) continue
				this.touchDisc(i, discs[d] as Disc, ri, mi, kd, h)
			}
			for (const o of this.outlines) this.touchOutline(i, o, ri, mi, kd, h)
			if (bath !== undefined && (y[i] as number) < bath.level + ri) {
				// buoyancy on the part under the surface (a sphere's cap, by its depth in, linear: enough for grains a few mm across)
				const sub = Math.min(1, ((bath.level - (y[i] as number)) / ri + 1) / 2)
				const vol = ((kd.volume * (ri * ri * ri)) / (kd.radius * kd.radius * kd.radius)) * sub
				fx[i] = (fx[i] as number) - bath.density * vol * s.gravity.x
				fy[i] = (fy[i] as number) - bath.density * vol * s.gravity.y
			}
			if (this.field !== undefined && kd.magnetic > 0) this.field(this, i)
		}
		// velocities and positions; a bath's drag is taken implicitly (steady at any viscosity and size)
		for (let i = 0; i < n; i++) {
			if (alive[i] === 0) continue
			const mi = m[i] as number
			let ux = (vx[i] as number) + (h * (fx[i] as number)) / mi
			let uy = (vy[i] as number) + (h * (fy[i] as number)) / mi
			if (bath !== undefined && (y[i] as number) < bath.level) {
				const ri = r[i] as number
				let ax = 0
				let ay = 0
				if (bath.flow !== undefined) {
					bath.flow(x[i] as number, y[i] as number, this.flowAt)
					ax = this.flowAt.x
					ay = this.flowAt.y
				}
				// Schiller-Naumann drag on a sphere: F = 3π μ d (1 + 0.15 Re^0.687) (u − v) (Clift, Grace & Weber, Bubbles, Drops and Particles, 1978)
				const rel = Math.sqrt((ux - ax) * (ux - ax) + (uy - ay) * (uy - ay))
				const re = (bath.density * rel * 2 * ri) / bath.viscosity
				const beta = (3 * Math.PI * bath.viscosity * 2 * ri * (1 + 0.15 * Math.pow(re, 0.687))) / mi
				ux = (ux + h * beta * ax) / (1 + h * beta)
				uy = (uy + h * beta * ay) / (1 + h * beta)
			}
			vx[i] = ux
			vy[i] = uy
			x[i] = (x[i] as number) + h * ux
			y[i] = (y[i] as number) + h * uy
		}
	}

	/** A wall's push on particle i (spring-dashpot and friction against the wall's motion). */
	private touchWall(i: number, w: Wall, ri: number, mi: number, kd: Kind, h: number) {
		const off = this.groupOffset[w.group] as { x: number; y: number }
		const ax = w.ax + off.x
		const ay = w.ay + off.y
		const ex = w.bx - w.ax
		const ey = w.by - w.ay
		const px = (this.x[i] as number) - ax
		const py = (this.y[i] as number) - ay
		const len2 = ex * ex + ey * ey
		let u = len2 > 0 ? (px * ex + py * ey) / len2 : 0
		if (u < 0) u = 0
		else if (u > 1) u = 1
		const dx = px - u * ex
		const dy = py - u * ey
		const reach = ri + w.r
		const d2 = dx * dx + dy * dy
		if (d2 >= reach * reach || d2 === 0) return
		const d = Math.sqrt(d2)
		const nx = dx / d
		const ny = dy / d
		const gv = this.groupVelocity[w.group] as { x: number; y: number }
		const own = this.spec.wallByPhase?.[this.phase[i] as number]
		const e = own ? own[0] : Math.min(kd.restitution, w.restitution)
		const mu = own ? own[1] : Math.sqrt(kd.friction * w.friction)
		this.contact(i, nx, ny, reach - d, gv.x, gv.y, mi, kd, e, mu, h, this.impulse[w.group])
	}

	private touchDisc(i: number, dsc: Disc, ri: number, mi: number, kd: Kind, h: number) {
		const off = this.groupOffset[dsc.group] as { x: number; y: number }
		const dx = (this.x[i] as number) - (dsc.x + off.x)
		const dy = (this.y[i] as number) - (dsc.y + off.y)
		const reach = ri + dsc.r
		const d2 = dx * dx + dy * dy
		if (d2 >= reach * reach || d2 === 0) return
		const d = Math.sqrt(d2)
		const gv = this.groupVelocity[dsc.group] as { x: number; y: number }
		this.contact(i, dx / d, dy / d, reach - d, gv.x, gv.y, mi, kd, Math.min(kd.restitution, dsc.restitution), Math.sqrt(kd.friction * dsc.friction), h, this.impulse[dsc.group])
	}

	private touchOutline(i: number, o: Outline, ri: number, mi: number, kd: Kind, h: number) {
		const px = this.x[i] as number
		const py = this.y[i] as number
		let nx = 0
		let ny = 0
		let depth = 0
		if (o.points.length === 0) {
			const R = o.radius ?? 0
			const dx = px - o.cx
			const dy = py - o.cy
			const d2 = dx * dx + dy * dy
			if (d2 >= (R + ri) * (R + ri) || d2 === 0) return
			const d = Math.sqrt(d2)
			nx = dx / d
			ny = dy / d
			depth = R + ri - d
		} else {
			// the nearest side: inside all sides' lines = inside the outline (pushed out through the side it is least deep behind)
			const pts = o.points
			const nv = pts.length / 2
			let inside = true
			let best = Infinity
			let bx = 0
			let by = 0
			let leastIn = Infinity
			let inNx = 0
			let inNy = 0
			for (let a = 0; a < nv; a++) {
				const x1 = pts[2 * a] as number
				const y1 = pts[2 * a + 1] as number
				const x2 = pts[(2 * a + 2) % pts.length] as number
				const y2 = pts[(2 * a + 3) % pts.length] as number
				const ex = x2 - x1
				const ey = y2 - y1
				const len = Math.sqrt(ex * ex + ey * ey)
				if (len === 0) continue
				// outward normal of a counter-clockwise side
				const onx = ey / len
				const ony = -ex / len
				const out = (px - x1) * onx + (py - y1) * ony
				if (out > 0) inside = false
				if (-out < leastIn) {
					leastIn = -out
					inNx = onx
					inNy = ony
				}
				let u = ((px - x1) * ex + (py - y1) * ey) / (len * len)
				if (u < 0) u = 0
				else if (u > 1) u = 1
				const qx = x1 + u * ex
				const qy = y1 + u * ey
				const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy)
				if (d2 < best) {
					best = d2
					bx = qx
					by = qy
				}
			}
			if (inside) {
				nx = inNx
				ny = inNy
				depth = leastIn + ri
			} else {
				if (best >= ri * ri) return
				const d = Math.sqrt(best)
				if (d === 0) return
				nx = (px - bx) / d
				ny = (py - by) / d
				depth = ri - d
			}
		}
		// the outline's velocity where it touches
		const cxp = px - nx * ri - o.cx
		const cyp = py - ny * ri - o.cy
		const ovx = o.vx - o.w * cyp
		const ovy = o.vy + o.w * cxp
		const before = { x: 0, y: 0, normal: 0, hits: 0, all: 0 }
		this.contact(i, nx, ny, depth, ovx, ovy, mi, kd, Math.min(kd.restitution, o.restitution), Math.sqrt(kd.friction * o.friction), h, before)
		o.push.x += before.x
		o.push.y += before.y
		o.push.m += cxp * before.y - cyp * before.x
	}

	/**
	 * A contact of particle i with something of infinite mass moving at (wx, wy): its normal n points from it to the particle; depth, m.
	 * The impulse the particle gives it over the sub-step (N·s) is added to `acc`.
	 */
	private contact(
		i: number,
		nx: number,
		ny: number,
		depth: number,
		wx: number,
		wy: number,
		mi: number,
		_kd: Kind,
		e: number,
		mu: number,
		h: number,
		acc: { x: number; y: number; normal: number; hits: number; all: number } | undefined
	) {
		const rvx = (this.vx[i] as number) - wx
		const rvy = (this.vy[i] as number) - wy
		const vn = rvx * nx + rvy * ny
		const kk = this.stiffnessAt(this.r[i] as number)
		const fn = kk * depth - 2 * this.wallZeta(e) * Math.sqrt(kk * mi) * vn
		if (!(fn > 0)) return
		let tx = 0
		let ty = 0
		const tvx = rvx - vn * nx
		const tvy = rvy - vn * ny
		const vt = Math.sqrt(tvx * tvx + tvy * tvy)
		if (vt > 1e-12 && mu > 0) {
			const ft = Math.min(mu * fn, (mi * vt) / h / 2)
			tx = (-ft * tvx) / vt
			ty = (-ft * tvy) / vt
		}
		const gx = fn * nx + tx
		const gy = fn * ny + ty
		this.fx[i] = (this.fx[i] as number) + gx
		this.fy[i] = (this.fy[i] as number) + gy
		if (acc !== undefined) {
			acc.all += fn * h
			if (((1 << (this.phase[i] as number)) & this.impulseMask) !== 0) {
				acc.x -= gx * h
				acc.y -= gy * h
				acc.normal += fn * h
				acc.hits++
			}
		}
	}

	/** The kinetic energy of the particles chosen (live, of those phases: a bit mask 1 << phase), J, about their own mean motion, and their count. */
	thermal(mask: number): { energy: number; count: number; mvx: number; mvy: number } {
		let mass = 0
		let px = 0
		let py = 0
		let count = 0
		for (let i = 0; i < this.n; i++) {
			if (this.alive[i] === 0 || ((1 << (this.phase[i] as number)) & mask) === 0) continue
			const mi = this.m[i] as number
			mass += mi
			px += mi * (this.vx[i] as number)
			py += mi * (this.vy[i] as number)
			count++
		}
		if (count === 0) return { energy: 0, count: 0, mvx: 0, mvy: 0 }
		const mvx = px / mass
		const mvy = py / mass
		let energy = 0
		for (let i = 0; i < this.n; i++) {
			if (this.alive[i] === 0 || ((1 << (this.phase[i] as number)) & mask) === 0) continue
			const ux = (this.vx[i] as number) - mvx
			const uy = (this.vy[i] as number) - mvy
			energy += 0.5 * (this.m[i] as number) * (ux * ux + uy * uy)
		}
		return { energy, count, mvx, mvy }
	}

	/**
	 * A Langevin thermostat (the exact Ornstein-Uhlenbeck step: v ← a·v + √((1 − a²)·kT/m)·ξ, a = e^(−h/τ), ξ standard normal; Allen &
	 * Tildesley, Computer Simulation of Liquids, 2nd ed., §12.2): every live particle is drawn toward the motion of a bath at kT (J per particle:
	 * ½m⟨v²⟩ = kT in two dimensions), each phase with its own coupling time τ. Unlike rescaling it never drives a solid's bulk motion (the
	 * "flying ice cube" of velocity rescaling, Harvey et al., J. Comput. Chem. 19, 726, 1998): the block's own motion settles to kT/M.
	 */
	langevin(kT: number, tau: readonly [number, number, number], h: number, rnd: () => number, pinned = 0) {
		const a = [Math.exp(-h / tau[0]), Math.exp(-h / tau[1]), Math.exp(-h / tau[2])]
		if (this.kick.length < 2 * this.n) this.kick = new Float64Array(2 * this.x.length)
		const kick = this.kick
		// the kicks; those of the `pinned` phases (a bit mask, 1 << phase) without their mean momentum, so they never move such a body as a
		// whole (its own motion only dies away: a solid resting on the floor stays where it is)
		let px = 0
		let py = 0
		let pm = 0
		for (let i = 0; i < this.n; i++) {
			if (this.alive[i] === 0) continue
			const ai = a[this.phase[i] as number] as number
			const mi = this.m[i] as number
			const sd = Math.sqrt(((1 - ai * ai) * kT) / mi)
			const kx = sd * gauss(rnd)
			const ky = sd * gauss(rnd)
			kick[2 * i] = kx
			kick[2 * i + 1] = ky
			if (((1 << (this.phase[i] as number)) & pinned) !== 0) {
				px += mi * kx
				py += mi * ky
				pm += mi
			}
		}
		const mx = pm > 0 ? px / pm : 0
		const my = pm > 0 ? py / pm : 0
		for (let i = 0; i < this.n; i++) {
			if (this.alive[i] === 0) continue
			const ai = a[this.phase[i] as number] as number
			const pin = ((1 << (this.phase[i] as number)) & pinned) !== 0
			this.vx[i] = ai * (this.vx[i] as number) + (kick[2 * i] as number) - (pin ? mx : 0)
			this.vy[i] = ai * (this.vy[i] as number) + (kick[2 * i + 1] as number) - (pin ? my : 0)
		}
	}

	/**
	 * Berendsen's thermostat (Berendsen et al., J. Chem. Phys. 81, 3684, 1984) on the particles chosen: their motion about their mean is
	 * scaled by λ = √(1 + (h/τ)(E_target/E − 1)) each sub-step, so their kinetic energy relaxes to `energyPer` per particle with time τ.
	 */
	thermostat(mask: number, energyPer: number, tau: number, h: number) {
		const t = this.thermal(mask)
		if (t.count === 0 || !(t.energy > 0)) return
		const want = energyPer * t.count
		const lam2 = 1 + (h / tau) * (want / t.energy - 1)
		const lam = Math.sqrt(Math.max(0.25, Math.min(4, lam2)))
		for (let i = 0; i < this.n; i++) {
			if (this.alive[i] === 0 || ((1 << (this.phase[i] as number)) & mask) === 0) continue
			this.vx[i] = t.mvx + ((this.vx[i] as number) - t.mvx) * lam
			this.vy[i] = t.mvy + ((this.vy[i] as number) - t.mvy) * lam
		}
	}
}

/** A standard normal number from four uniforms (Irwin-Hall: mean 0, variance 1, tails cut at ±3.46): arithmetic only, so deterministic. */
export const gauss = (rnd: () => number) => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7320508075688772

/** A deterministic random stream (mulberry32: 32-bit integer steps, the same in every JavaScript engine), uniform in [0, 1). */
export const random = (seed: number) => {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** A random direction (unit vector) without sin or cos: a point of the unit disc (rejection), normalised. */
export const randomDirection = (rnd: () => number): { x: number; y: number } => {
	for (let k = 0; k < 64; k++) {
		const x = 2 * rnd() - 1
		const y = 2 * rnd() - 1
		const d2 = x * x + y * y
		if (d2 > 0.0001 && d2 <= 1) {
			const d = Math.sqrt(d2)
			return { x: x / d, y: y / d }
		}
	}
	return { x: 1, y: 0 }
}
