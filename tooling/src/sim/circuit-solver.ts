/**
 * The DC circuit solver (nodal analysis) the engine runs every step for a scene's circuits (tooling/src/sim/circuits.ts drives it).
 *
 * A circuit is nodes joined by branches; every branch is one of
 *   - "g": a linear branch, current a→b  I_ab = g·(V_a − V_b − e): a resistor or a wire (e = 0), a cell (emf e, its + at a, g = 1/r_internal),
 *     a motor or a generator (e = its back-EMF, g = 1/R_winding);
 *   - "d": an ideal diode with a knee (piecewise linear): on, I_ab = g·(V_a − V_b − v0) ≥ 0; off, I_ab = 0 with V_a − V_b ≤ v0 (an LED, a solar
 *     cell's junction);
 *   - "j": a current source that drives i from b to a through itself (I_ab = −i: a solar cell's photocurrent).
 * Open branches (an open switch, a wire pulled off, a burnt-out bulb) are simply left out.
 *
 * Solving: the conducting branches split the nodes into connected components; each component's lowest-numbered node is its reference
 * (0 V), so a battery-and-bulb loop floating on the table is solved exactly, with no leak to an outside ground. Each component's
 * conductance matrix (a weighted graph Laplacian with one node removed: symmetric, positive definite) is solved by Gaussian elimination with
 * partial pivoting. The diodes' on/off states are found by the standard piecewise-linear iteration: solve, turn off every "on" diode whose
 * current came out negative and on every "off" diode whose voltage came out past its knee, repeat until nothing changes (at most MAX_ITERS
 * times; the last solve stands). The iteration starts from the states the caller keeps from the step before, so a steady circuit takes one
 * solve a step.
 *
 * Only + − × ÷ and comparisons: the same bits on every machine (no Math.log, no platform libm), in node and in every browser.
 */

export type Branch =
	| { readonly kind: "g"; readonly a: number; readonly b: number; readonly g: number; readonly e: number }
	| { readonly kind: "d"; readonly a: number; readonly b: number; readonly g: number; readonly v0: number }
	| { readonly kind: "j"; readonly a: number; readonly b: number; readonly i: number }

export interface Solution {
	/** Node voltages, each relative to its component's reference node (its lowest-numbered node). */
	readonly v: Float64Array
	/** Each branch's current a→b (A); 0 for an open one. */
	readonly current: Float64Array
	/** Each node's component (−1: a node no conducting branch reaches). */
	readonly component: Int32Array
	/** Diode states the solve settled on (for "d" branches; true for the others). */
	readonly on: boolean[]
	/** Solves it took (diode iterations). */
	readonly iterations: number
	/** Whether the diode states settled. */
	readonly settled: boolean
}

/** The most diode iterations a solve takes (each flips at least one diode; a circuit of a few LEDs settles in 1 to 3). */
export const MAX_ITERS = 24

/** Union-find over n nodes. */
const components = (n: number, branches: readonly Branch[], on: readonly boolean[]): Int32Array => {
	const parent = new Int32Array(n)
	for (let i = 0; i < n; i++) parent[i] = i
	const find = (x: number): number => {
		let r = x
		while (parent[r] !== r) r = parent[r] as number
		while (parent[x] !== r) {
			const next = parent[x] as number
			parent[x] = r
			x = next
		}
		return r
	}
	const touched = new Uint8Array(n)
	branches.forEach((br, k) => {
		if (br.kind === "j") return
		if (br.kind === "d" && !on[k]) return
		if (!(br.g > 0)) return
		if (br.a === br.b) return
		touched[br.a] = 1
		touched[br.b] = 1
		const ra = find(br.a)
		const rb = find(br.b)
		// (the smaller root wins, so a component's root is its lowest-numbered node)
		if (ra < rb) parent[rb] = ra
		else if (rb < ra) parent[ra] = rb
	})
	const out = new Int32Array(n)
	for (let i = 0; i < n; i++) out[i] = touched[i] ? find(i) : -1
	return out
}

/**
 * Solves A·x = b in place (A n×n row-major) by Gaussian elimination with partial pivoting. A pivot of exactly zero leaves that unknown at 0
 * (it cannot happen for a connected component's Laplacian; a guard, not a rule).
 */
const gauss = (A: Float64Array, b: Float64Array, n: number): Float64Array => {
	for (let c = 0; c < n; c++) {
		let p = c
		let best = Math.abs(A[c * n + c] as number)
		for (let r = c + 1; r < n; r++) {
			const v = Math.abs(A[r * n + c] as number)
			if (v > best) {
				best = v
				p = r
			}
		}
		if (best === 0) continue
		if (p !== c) {
			for (let k = c; k < n; k++) {
				const t = A[c * n + k] as number
				A[c * n + k] = A[p * n + k] as number
				A[p * n + k] = t
			}
			const t = b[c] as number
			b[c] = b[p] as number
			b[p] = t
		}
		const piv = A[c * n + c] as number
		for (let r = c + 1; r < n; r++) {
			const f = (A[r * n + c] as number) / piv
			if (f === 0) continue
			for (let k = c; k < n; k++) A[r * n + k] = (A[r * n + k] as number) - f * (A[c * n + k] as number)
			b[r] = (b[r] as number) - f * (b[c] as number)
		}
	}
	const x = new Float64Array(n)
	for (let r = n - 1; r >= 0; r--) {
		const piv = A[r * n + r] as number
		if (piv === 0) {
			x[r] = 0
			continue
		}
		let s = b[r] as number
		for (let k = r + 1; k < n; k++) s -= (A[r * n + k] as number) * (x[k] as number)
		x[r] = s / piv
	}
	return x
}

/** One linear solve with the diodes' states fixed. */
const solveLinear = (n: number, branches: readonly Branch[], on: readonly boolean[], comp: Int32Array): Float64Array => {
	const v = new Float64Array(n)
	// the unknowns of each component: its nodes but its root, in node order
	const roots: number[] = []
	const members = new Map<number, number[]>()
	for (let i = 0; i < n; i++) {
		const c = comp[i] as number
		if (c < 0) continue
		let list = members.get(c)
		if (list === undefined) {
			list = []
			members.set(c, list)
			roots.push(c)
		}
		if (i !== c) list.push(i)
	}
	const index = new Int32Array(n).fill(-1)
	for (const root of roots) {
		const list = members.get(root) as number[]
		const m = list.length
		if (m === 0) continue
		list.forEach((node, k) => {
			index[node] = k
		})
		const A = new Float64Array(m * m)
		const rhs = new Float64Array(m)
		const add = (r: number, c: number, val: number) => {
			const ir = index[r] as number
			const ic = index[c] as number
			if (ir >= 0 && ic >= 0) A[ir * m + ic] = (A[ir * m + ic] as number) + val
		}
		const inject = (node: number, val: number) => {
			const ir = index[node] as number
			if (ir >= 0) rhs[ir] = (rhs[ir] as number) + val
		}
		branches.forEach((br, k) => {
			if ((comp[br.a] as number) !== root && (comp[br.b] as number) !== root) return
			if (br.kind === "j") {
				// (only within one component: a source whose ends no conducting path joins drives nothing)
				if ((comp[br.a] as number) !== (comp[br.b] as number)) return
				inject(br.a, br.i)
				inject(br.b, -br.i)
				return
			}
			if (br.kind === "d" && !on[k]) return
			if (!(br.g > 0) || br.a === br.b) return
			const e = br.kind === "g" ? br.e : br.v0
			add(br.a, br.a, br.g)
			add(br.b, br.b, br.g)
			add(br.a, br.b, -br.g)
			add(br.b, br.a, -br.g)
			inject(br.a, br.g * e)
			inject(br.b, -br.g * e)
		})
		const x = gauss(A, rhs, m)
		list.forEach((node, k) => {
			v[node] = x[k] as number
		})
		for (const node of list) index[node] = -1
	}
	return v
}

const currentOf = (br: Branch, v: Float64Array, on: boolean, comp: Int32Array): number => {
	if (br.kind === "j") return (comp[br.a] as number) >= 0 && comp[br.a] === comp[br.b] ? -br.i : 0
	if (br.kind === "d" && !on) return 0
	if (!(br.g > 0) || br.a === br.b) return 0
	const e = br.kind === "g" ? br.e : br.v0
	return br.g * ((v[br.a] as number) - (v[br.b] as number) - e)
}

/**
 * Solves the circuit: n nodes, its branches, and the diodes' states to start from (the step before's; `start[k]` for branch k, ignored for
 * the others; missing = off).
 */
export const solve = (n: number, branches: readonly Branch[], start?: readonly boolean[], depth = 0): Solution => {
	const on = branches.map((br, k) => (br.kind === "d" ? (start?.[k] ?? false) : true))
	let comp = components(n, branches, on)
	let v = solveLinear(n, branches, on, comp)
	let iterations = 1
	let settled = false
	// (states seen: a cycle of flips ends the iteration at once, on the state first repeated)
	const seen = new Set<string>()
	const key = () => on.map((s) => (s ? "1" : "0")).join("")
	seen.add(key())
	for (; iterations <= MAX_ITERS; iterations++) {
		let changed = false
		branches.forEach((br, k) => {
			if (br.kind !== "d") return
			const dv = (v[br.a] as number) - (v[br.b] as number)
			// (a diode's two ends in different components: its voltage is meaningless while it is off; it stays off)
			const joined = (comp[br.a] as number) >= 0 && comp[br.a] === comp[br.b]
			if (on[k]) {
				const i = br.g * (dv - br.v0)
				if (i < 0) {
					on[k] = false
					changed = true
				}
			} else if (joined && dv > br.v0) {
				on[k] = true
				changed = true
			}
		})
		if (!changed) {
			settled = true
			break
		}
		const s = key()
		if (seen.has(s)) break
		seen.add(s)
		comp = components(n, branches, on)
		v = solveLinear(n, branches, on, comp)
	}
	// A diode off whose ends lie in different components: once it turns on, they are one component. The iteration above turns a diode on
	// only when its ends are joined; one bridging two otherwise separate parts of a circuit (an LED that alone closes a loop) is tried on:
	// on, if its current comes out forward.
	let bridged = false
	branches.forEach((br, k) => {
		if (depth > 0 || br.kind !== "d" || on[k]) return
		if ((comp[br.a] as number) >= 0 && comp[br.a] === comp[br.b]) return
		const trial = on.slice()
		trial[k] = true
		const c2 = components(n, branches, trial)
		const v2 = solveLinear(n, branches, trial, c2)
		const i = br.g * ((v2[br.a] as number) - (v2[br.b] as number) - br.v0)
		if (i > 0) {
			on[k] = true
			bridged = true
		}
	})
	if (bridged) {
		// settle again from the bridged states
		const again = solve(n, branches, on, depth + 1)
		return { ...again, iterations: again.iterations + iterations }
	}
	const current = new Float64Array(branches.length)
	branches.forEach((br, k) => {
		current[k] = currentOf(br, v, on[k] as boolean, comp)
	})
	return { v, current, component: comp, on, iterations, settled }
}

/**
 * The current through branch `k` as a line in its own source value: I_ab(e) = a − b·e for a "g" branch whose emf e alone changes (the rest
 * of the circuit, the diodes' states included, held): b = 1/(R_branch + R_Thevenin of what it is connected to), a = I_now + b·e_now. Used
 * for a motor (e its back-EMF) so the engine can drive it along its torque-speed line. b = 0 when nothing joins its two ends.
 */
export const lineOf = (n: number, branches: readonly Branch[], sol: Solution, k: number): { readonly a: number; readonly b: number } => {
	const br = branches[k]
	if (br === undefined || br.kind !== "g" || !(br.g > 0)) return { a: 0, b: 0 }
	const i0 = sol.current[k] as number
	const bumped = branches.map((x, j) => (j === k && x.kind === "g" ? { ...x, e: x.e + 1 } : x))
	const comp = components(n, bumped, sol.on)
	const v = solveLinear(n, bumped, sol.on, comp)
	const i1 = currentOf(bumped[k] as Branch, v, true, comp)
	const b = i0 - i1
	return { a: i0 + b * br.e, b: b > 0 ? b : 0 }
}
