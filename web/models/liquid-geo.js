// The shapes of a liquid standing in a round container (web/models/mod-flow.js): its top is a flat level surface and is shaded as one.
// A lathe of the liquid's whole outline (axis, floor, wall, level, axis) shares each outline point's normal between the wall and the top, so the
// top's normals tipped out toward the rim, 45° at the wall, and a narrow glass's flat water was lit as a dome (the five-lesson benchmark,
// MA-50's screens 6, 8 and 10). Here the wall, the level and the floor each have their own vertices and normals: the level straight up, the
// floor straight down, the wall square to the wall. Plain functions of three.js (passed in), no state: node tests them
// (tools/staging/liquid.test.mjs).

/**
 * A liquid's column in an upright round container: a frustum from radius r0 at its floor (y = 0) to r1 at its level (y = h), about the y
 * axis, `seg` segments round (u = 0 at +z, as three's LatheGeometry). Its level and its floor are flat discs. -> BufferGeometry
 */
export function liquidColumn(T, r0, r1, h, seg = 48) {
	const pos = []
	const nor = []
	const uv = []
	const idx = []
	// the wall: its normal square to it, (h, r0 − r1) in (radial, y), normalized
	const len = Math.hypot(h, r0 - r1) || 1
	const nr = h / len
	const ny = (r0 - r1) / len
	for (let i = 0; i <= seg; i++) {
		const phi = (i / seg) * Math.PI * 2
		const s = Math.sin(phi)
		const c = Math.cos(phi)
		pos.push(r0 * s, 0, r0 * c, r1 * s, h, r1 * c)
		nor.push(nr * s, ny, nr * c, nr * s, ny, nr * c)
		uv.push(i / seg, 0, i / seg, 1)
	}
	for (let i = 0; i < seg; i++) {
		const a = 2 * i
		const b = 2 * (i + 1)
		idx.push(a, b, a + 1, b, b + 1, a + 1)
	}
	// the level (normals up) and the floor (normals down): a fan from the middle
	const disc = (r, y, up) => {
		const mid = pos.length / 3
		pos.push(0, y, 0)
		nor.push(0, up ? 1 : -1, 0)
		uv.push(0.5, 0.5)
		for (let i = 0; i <= seg; i++) {
			const phi = (i / seg) * Math.PI * 2
			const s = Math.sin(phi)
			const c = Math.cos(phi)
			pos.push(r * s, y, r * c)
			nor.push(0, up ? 1 : -1, 0)
			uv.push(0.5 + 0.5 * s, 0.5 + 0.5 * c)
		}
		for (let i = 0; i < seg; i++) {
			const a = mid + 1 + i
			const b = mid + 2 + i
			if (up) idx.push(mid, a, b)
			else idx.push(mid, b, a)
		}
	}
	disc(r1, h, true)
	disc(r0, 0, false)
	const g = new T.BufferGeometry()
	g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
	g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3))
	g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2))
	g.setIndex(idx)
	return g
}

/**
 * A liquid in a round container that is tipped (one that is not seen through: milk): the container's round inside, its frame `local` (the
 * inside's corners bottom-left, bottom-right, top-right, top-left) at the pose `pl` {x, y, angle}, cut between the world heights yLo (the layer
 * under it, or -Infinity) and yHi (its level). A grid over the cut: its top surface (the level), its bottom (the floor, or the layer under it)
 * and its two sides where the round inside meets them, each with its own vertices, so the level is shaded as the flat surface it is and never
 * rounded into the sides. -> BufferGeometry in world coordinates, or null when nothing lies between the two heights
 */
export function liquidCut(T, local, pl, yLo, yHi, { nx: NX = 22, nz: NZ = 12 } = {}) {
	const ax = (local[0][0] + local[1][0]) / 2
	const rad = Math.max(0.002, (local[1][0] - local[0][0]) / 2 - 0.0005)
	const yb = local[0][1] + 0.0004
	const yt = local[3][1]
	const c = Math.cos(pl.angle)
	const sn = Math.sin(pl.angle)
	// (a level world height Y in the frame: the line sn·x + c·y = Y − pl.y)
	const spanAt = (x) => {
		let lo = yb
		let hi = yt
		const cut = (Y, keepBelow) => {
			if (!Number.isFinite(Y)) return
			const k = Y - pl.y - sn * x
			if (Math.abs(c) < 1e-9) {
				if (keepBelow ? 0 > k : 0 < k) lo = hi
				return
			}
			const yy = k / c
			if (keepBelow === c > 0) hi = Math.min(hi, yy)
			else lo = Math.max(lo, yy)
		}
		cut(yHi, true)
		if (yLo > -Infinity) cut(yLo, false)
		return hi > lo ? [lo, hi] : null
	}
	let xa = ax - rad
	let xb = ax + rad
	const ok = (x) => spanAt(x) !== null
	let any = -1
	for (let q = 0; q <= 24; q++) if (ok(xa + ((xb - xa) * q) / 24)) any = q
	if (any < 0) return null
	const inner = xa + ((xb - xa) * any) / 24
	const fit = (out, inn) => {
		let a = out
		let b = inn
		for (let it = 0; it < 30; it++) {
			const mid = 0.5 * (a + b)
			if (ok(mid)) b = mid
			else a = mid
		}
		return b
	}
	if (!ok(xa)) xa = fit(xa, inner)
	if (!ok(xb)) xb = fit(xb, inner)
	const nvz = NZ + 1
	const cnt = (NX + 1) * nvz
	// four sets of vertices: the top grid, the bottom grid, and the two sides' strips (each a copy of their grid rows at j = 0 and j = NZ)
	const pos = new Float32Array((2 * cnt + 4 * (NX + 1)) * 3)
	const idx = []
	const top = (i, j) => i * nvz + j
	const bot = (i, j) => cnt + i * nvz + j
	const side = (s, i, up) => 2 * cnt + (s * 2 + (up ? 1 : 0)) * (NX + 1) + i
	const put = (v, x, y, z) => {
		pos[v * 3] = pl.x + x * c - y * sn
		pos[v * 3 + 1] = pl.y + x * sn + y * c
		pos[v * 3 + 2] = z
	}
	for (let i = 0; i <= NX; i++) {
		const x = xa + ((xb - xa) * i) / NX
		const sp = spanAt(Math.min(xb, Math.max(xa, x))) ?? [yb, yb]
		const zmax = Math.sqrt(Math.max(0, rad * rad - (x - ax) * (x - ax)))
		for (let j = 0; j <= NZ; j++) {
			const z = -zmax + (2 * zmax * j) / NZ
			put(top(i, j), x, sp[1], z)
			put(bot(i, j), x, sp[0], z)
		}
		put(side(0, i, true), x, sp[1], -zmax)
		put(side(0, i, false), x, sp[0], -zmax)
		put(side(1, i, true), x, sp[1], zmax)
		put(side(1, i, false), x, sp[0], zmax)
	}
	for (let i = 0; i < NX; i++) {
		for (let j = 0; j < NZ; j++) {
			idx.push(top(i, j), top(i, j + 1), top(i + 1, j), top(i + 1, j), top(i, j + 1), top(i + 1, j + 1))
			idx.push(bot(i, j), bot(i + 1, j), bot(i, j + 1), bot(i + 1, j), bot(i + 1, j + 1), bot(i, j + 1))
		}
		idx.push(side(0, i, false), side(0, i + 1, false), side(0, i, true), side(0, i + 1, false), side(0, i + 1, true), side(0, i, true))
		idx.push(side(1, i, false), side(1, i, true), side(1, i + 1, false), side(1, i + 1, false), side(1, i, true), side(1, i + 1, true))
	}
	const geo = new T.BufferGeometry()
	geo.setAttribute("position", new T.BufferAttribute(pos, 3))
	geo.setIndex(idx)
	geo.computeVertexNormals()
	return geo
}
