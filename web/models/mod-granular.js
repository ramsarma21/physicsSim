// 3D models of the granular module (machines/mod_granular.py): sand piles and castles, a sand tray, a funnel on a ring stand, an hourglass and a
// stream table, and the run's sand itself (view plugin "granular"): every bed of columns the engine worked (tooling/src/sim/modules/granular.ts)
// is a heightfield mesh of grains following the run's keyframes (track.keyframes[item]["grid:<bed>"], "h:<bed>", "mix:<bed>", "water:<bed>",
// interpolated between them), its running water a see-through sheet over it, and the falling grains (the "air" keyframes: x, y, z, vx, vy, vz,
// grain per parcel) short streaks of grains along their flight, so a funnel's or an hourglass's stream is continuous and a crater's splash flies.
// The items' own models draw their vessels (the tray's walls, the funnel and its stand, the timer's glass and posts, the stream table's sides,
// hose and books) and their sand as it starts (for the editor's layout picture); in a run the plugin's beds take over that sand (frame hook
// "granular:start": a starting-sand part hides once the run has the bed's keyframes).
import { makeLib } from "./surfaces-lib.js"

// tooling/src/sim/granular.ts GRAIN_KEYS (the keyframes' grain indices) and their colours (looks of machines/mod_granular.py)
const GRAIN_KEYS = ["fine sand", "sand", "coarse sand", "gravel", "pebbles", "soil", "flour"]
const WET_KEYS = ["dry", "damp", "soaked"]
const GRAIN_COLOR = { "fine sand": "#e6d3a3", sand: "#d9b97c", "coarse sand": "#c8a26a", gravel: "#9b948a", pebbles: "#8a8178", soil: "#6e5136", flour: "#f3eee2" }
// what a grain looks like in the air (m: drawn a little larger than a sand grain, so a stream reads at a classroom distance)
const GRAIN_SIZE = { "fine sand": 0.0012, sand: 0.0014, "coarse sand": 0.0018, gravel: 0.005, pebbles: 0.012, soil: 0.0014, flour: 0.0012 }
const TINTS = { red: "#c8443a", blue: "#3f7fd0", green: "#4fa35a", yellow: "#e8c13a", purple: "#8a5cc0", white: "#f2f0ea", black: "#2c2a28", pink: "#e889a8", orange: "#e8823a" }
// [grain density, porosity, tan(repose)] for the starting shapes (machines/mod_granular.py GRAINS)
const GRAIN_DATA = {
	sand: [2650, 0.4, 0.674509], "fine sand": [2650, 0.42, 0.624869], "coarse sand": [2650, 0.38, 0.700208], gravel: [2650, 0.38, 0.781286],
	pebbles: [2650, 0.38, 0.8391], soil: [2600, 0.5, 0.700208], flour: [1450, 0.59, 1.0]
}
/** m: a column thinner than this is bare (drawn as its floor); water shallower than WATER_MIN is not drawn. */
const SAND_MIN = 0.0003
const WATER_MIN = 0.0003
const bulkOf = (grain, wet) => {
	const [rho, por] = GRAIN_DATA[grain] ?? GRAIN_DATA.sand
	return rho * (1 - por) + (wet === "damp" ? 998.2 * Math.min(0.08, por) : wet === "soaked" ? 998.2 * por : 0)
}
/** A bed's floor and kinds from its "grid" keyframe from index p: base, the floor's steps as runs (tenths of a mm), the kinds as runs. */
function unpackGrid(grid, p, n) {
	const base = grid[p++]
	const floor = new Float32Array(n)
	const kind = new Uint8Array(n)
	let nr = grid[p++]
	let c = 0
	let v = 0
	for (let r = 0; r < nr; r++) {
		const step = grid[p++]
		const cnt = grid[p++]
		for (let k = 0; k < cnt && c < n; k++) {
			v += step
			floor[c++] = base + v / 1e4
		}
	}
	nr = grid[p++]
	c = 0
	for (let r = 0; r < nr; r++) {
		const kv = grid[p++]
		const cnt = grid[p++]
		for (let k = 0; k < cnt && c < n; k++) kind[c++] = kv
	}
	return { floor, kind }
}
/** A keyframe's rectangle [t, i0, j0, ni, nj, mode, ...] into `into` (values × scale): mode 0 the values, 1 runs (value, count). */
function unpackRect(row, nx, into, scale) {
	const i0 = row[1]
	const j0 = row[2]
	const ni = row[3]
	const nj = row[4]
	const mode = row[5]
	let q = 6
	if (mode === 2) {
		// (only the changed columns: offsets in the rectangle)
		const count = row[q++]
		for (let k = 0; k < count; k++) {
			const off = row[q++]
			const v = row[q++]
			const i = i0 + (off % ni)
			const j = j0 + Math.floor(off / ni)
			into[j * nx + i] = v * scale
		}
		return
	}
	let left = 0
	let val = 0
	for (let j = j0; j < j0 + nj; j++)
		for (let i = i0; i < i0 + ni; i++) {
			if (mode === 1) {
				if (left === 0) {
					val = row[q++]
					left = row[q++]
				}
				left--
				into[j * nx + i] = val * scale
			} else into[j * nx + i] = row[q++] * scale
		}
}
/** A grain's colour, darkened when wet (damp sand is darker; soaked darker still), or the item's tint. */
function grainColor(THREE, grain, wet, tint) {
	const c = new THREE.Color(tint && TINTS[tint] ? TINTS[tint] : (GRAIN_COLOR[grain] ?? GRAIN_COLOR.sand))
	if (wet === "damp") c.multiplyScalar(0.78)
	else if (wet === "soaked") c.multiplyScalar(0.62)
	return c
}

export default function register({ addModel, addViewPlugin, addFrameHook, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const { T, M, V2, put, mesh, f5 } = L
	const TAU = Math.PI * 2

	// ------------------------------------------------------------- materials
	/** Fine grains: a speckled colour (grains of slightly different tones) and a fine bumpy normal map; tiled 4 cm. */
	const fineMaps = () =>
		L.bake("gr-fine2", 256, 256, (u, v, o) => {
			const n = L.pfbm(u, v, 32, 32, 71, 3)
			const s = L.h3(Math.floor(u * 256), Math.floor(v * 256), 13)
			const k = 0.86 + 0.22 * n + (s > 0.93 ? 0.18 : s < 0.06 ? -0.2 : 0)
			o.r = o.g = o.b = Math.max(0, Math.min(255, 255 * k * 0.92))
			o.h = 0.5 + 0.35 * (L.pfbm(u, v, 64, 64, 5, 2) - 0.5) + 0.25 * (s - 0.5)
			o.rough = 0.96
		}, { normal: 2.2, blur: 0 })
	/** Gravel and pebbles: rounded stones (a Worley pattern) in the colour and the normal map; tiled by the stones' size. */
	const stoneMaps = () =>
		L.bake("gr-stone2", 256, 256, (u, v, o) => {
			const w = {}
			L.worley(u, v, 10, 10, 37, w)
			const edge = L.clamp((w.f2 - w.f1) * 6)
			const tone = 0.75 + 0.35 * w.id
			o.r = o.g = o.b = Math.max(0, Math.min(255, 255 * tone * (0.55 + 0.45 * edge)))
			o.h = edge
			o.rough = 0.8
		}, { normal: 3, blur: 1 })
	const sandMat = (key, stony = false, repeat = 1) => {
		const maps = stony ? stoneMaps() : fineMaps()
		return M(`gr-sand|${key}|${stony}|${f5(repeat)}`, {
			color: "#ffffff", vertexColors: true, roughness: 0.97, metalness: 0, map: L.withRepeat(maps.map, repeat, repeat), normalMap: L.withRepeat(maps.normalMap, repeat, repeat),
			normalScale: V2(stony ? 0.9 : 0.55)
		})
	}
	/** A solid-coloured sand material for the starting shapes (no vertex colours). */
	const startMat = (grain, wet, tint) => {
		const stony = grain === "gravel" || grain === "pebbles"
		const maps = stony ? stoneMaps() : fineMaps()
		const c = grainColor(T, grain, wet, tint)
		const rep = stony ? 6 : 12
		return M(`gr-start|${grain}|${wet}|${tint}`, { color: c, roughness: 0.97, metalness: 0, map: L.withRepeat(maps.map, rep, rep), normalMap: L.withRepeat(maps.normalMap, rep, rep), normalScale: V2(stony ? 0.9 : 0.55) })
	}
	const waterMat = () =>
		M("gr-water2", { color: "#5fa8dc", roughness: 0.04, metalness: 0, transparent: true, opacity: 0.68, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.3, side: T.DoubleSide })
	const glass = () => M("gr-glass", { color: "#f4fbfd", roughness: 0.02, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.4, side: T.DoubleSide })
	const wood = (hex = "#b98a55") => kit.wood(hex, { roughness: 0.45, varnish: 0.6 })
	const trayBlue = () => kit.plastic("#4f8fd8", { gloss: 0.35, key: "granular" })
	const clearPane = () => M("gr-acrylic", { color: "#f2f8fb", roughness: 0.03, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, side: T.DoubleSide })
	const funnelMat = () => M("gr-funnel", { color: "#e9edf0", roughness: 0.3, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 0.6, side: T.DoubleSide, depthWrite: false })

	// ------------------------------------------------------------- the starting sand hides once the run has the bed
	addFrameHook("granular:start", (obj, f) => {
		obj.visible = !(f.state && Object.keys(f.state).length > 0)
	})
	addFrameHook("granular:flowing", (obj, f) => {
		obj.visible = (f.state?.water_lpm ?? 0) > 0
	})
	const startPart = (o) => {
		o.userData.frame = { hook: "granular:start", scaled: false }
		return o
	}

	// ------------------------------------------------------------- sand pile: a cone or a castle (as it starts)
	addModel("sand-pile", "sand", ({ props, h }) => {
		const P = props ?? {}
		const grain = P.grain ?? "sand"
		const wet = P.wetness ?? "dry"
		const mat = startMat(grain, wet, P.sand_color)
		const base = -h / 2 // (the ghost's centre is half its height over the base)
		if (P.shape === "castle") {
			const r = (P.width ?? 0.08) / 2
			const H = P.height ?? 0.12
			const g = kit.group()
			// a bucket-moulded tower: slightly tapered, a ring of battlements on top
			const prof = [[0, 0], [r, 0], [r * 0.93, H * 0.86], [r * 0.95, H * 0.86], [r * 0.95, H], [r * 0.8, H], [r * 0.8, H * 0.92], [0, H * 0.92]]
			g.add(startPart(put(mesh(kit.lathe(prof, 48, `gr-castle|${f5(r)}|${f5(H)}`), mat), 0, base, 0)))
			const n = 8
			for (let k = 0; k < n; k++) {
				const a = (k / n) * TAU
				const b = mesh(kit.box(r * 0.32, H * 0.12, r * 0.22, 0.001), mat)
				b.position.set(Math.cos(a) * r * 0.86, base + H + H * 0.05, Math.sin(a) * r * 0.86)
				b.rotation.y = -a
				g.add(startPart(b))
			}
			return g
		}
		const [rho0, por, tn] = GRAIN_DATA[grain] ?? GRAIN_DATA.sand
		void rho0
		void por
		const vol = (P.sand_kg ?? 1) / bulkOf(grain, wet)
		const R = Math.cbrt((3 * vol) / (Math.PI * tn))
		const H = R * tn
		// a cone with a softly rounded top and foot
		const pts = []
		const n = 24
		for (let k = 0; k <= n; k++) {
			const u = k / n
			const rr = R * (1 - u)
			const y = H * u - (u > 0.9 ? (u - 0.9) * (u - 0.9) * H * 4 : 0)
			pts.push([rr, Math.max(0, y)])
		}
		pts.unshift([R * 1.02, 0])
		// (in a group: the starting sand hides in a run, the item's root stays for the camera's framing and picking)
		return kit.group(startPart(put(mesh(kit.lathe(pts, 64, `gr-cone|${f5(R)}|${f5(H)}`), mat), 0, base, 0)))
	})

	// ------------------------------------------------------------- sand tray: front and back walls, and its sand as it starts
	addModel("sand-tray", "sand", ({ props, w, h, d }) => {
		const P = props ?? {}
		const L0 = P.length ?? 0.5
		const W = P.width ?? 0.35
		const wall = P.wall ?? 0.08
		const t = 0.012
		const g = kit.group()
		const wm = wood()
		// (the ghost's centre is at the sand's middle height over the floor: its floor's top at −h/2)
		const floorTop = -h / 2
		for (const sz of [-1, 1]) g.add(put(mesh(kit.box(L0 + 2 * t, wall + t, t, 0.0015), wm), 0, floorTop - t + (wall + t) / 2, sz * (W / 2 - t / 2)))
		g.add(startPart(put(mesh(kit.box(w, h, d, 0.0005), startMat(P.grain ?? "sand", P.wetness ?? "dry", P.sand_color)), 0, 0, 0)))
		return g
	})

	// ------------------------------------------------------------- funnel on a ring stand
	addModel("sand-funnel", "funnel", ({ props, h }) => {
		const P = props ?? {}
		const R = (P.funnel_cm ?? 12) / 200
		const rOut = Math.min((P.outlet_mm ?? 10) / 2000, R * 0.8)
		const height = P.height ?? 0.2
		const g = kit.group()
		// (the ghost's centre: half the cone's height over the spout's tip; the stand's foot is `height` below the tip)
		const tip = -h / 2
		const coneH = h
		const fm = funnelMat()
		const wallT = 0.0015
		// the cone (open, thin-walled) and its spout (a short tube under it)
		const spoutL = Math.min(0.03, Math.max(0.01, height * 0.15))
		const prof = [[rOut + wallT, -spoutL], [rOut + wallT, 0], [R + wallT, coneH], [R + wallT + 0.004, coneH + 0.003], [R, coneH + 0.003], [R - 0.0005, coneH], [rOut, 0.0008], [rOut, -spoutL]]
		g.add(put(mesh(kit.lathe(prof, 64, `gr-funnel|${f5(R)}|${f5(rOut)}|${f5(coneH)}|${f5(spoutL)}`), fm, { cast: true }), 0, tip, 0))
		// the ring stand: a foot plate behind and to the left, a rod, a ring round the cone
		const steel = kit.steel()
		const foot = -h / 2 - height
		const rodX = -(R + 0.06)
		const rodZ = -0.02
		g.add(put(mesh(kit.box(0.14, 0.012, 0.1, 0.003), kit.metal("#2f3338", { roughness: 0.5, key: "granular-foot" })), rodX, foot + 0.006, rodZ - 0.01))
		const rodH = height + coneH + 0.08
		g.add(put(mesh(kit.cylinderY(0.006, rodH, 24), steel), rodX, foot + rodH / 2, rodZ))
		const ringY = tip + coneH * 0.62
		const ringR = rOut + (R - rOut) * 0.62 + 0.004
		const ring = mesh(kit.torus(ringR, 0.003, 12, 64), steel)
		g.add(put(ring, 0, ringY, 0, Math.PI / 2))
		g.add(put(mesh(kit.box(Math.abs(rodX) - ringR, 0.006, 0.008, 0.002), steel), (rodX - ringR) / 2, ringY, rodZ / 2))
		g.add(put(mesh(kit.cylinderY(0.011, 0.02, 16), kit.metal("#4a4f55", { roughness: 0.4, key: "granular-clamp" })), rodX, ringY, rodZ))
		// its grains as they start: a level fill of the cone
		const grain = P.grain ?? "sand"
		const wet = P.wetness ?? "dry"
		const vol = (P.sand_kg ?? 0.3) / bulkOf(grain, wet)
		const tw = 1.732051
		// (level y over the tip: the cone's volume below y is π/3·(r(y)³ − rOut³)/tw, r(y) = rOut + y/tw)
		const rFill = Math.min(R, Math.cbrt(rOut ** 3 + (3 * vol * tw) / Math.PI))
		const yFill = (rFill - rOut) * tw
		if (vol > 0 && yFill > 0.001) g.add(startPart(put(mesh(kit.lathe([[0, 0], [rOut, 0], [rFill * 0.985, yFill], [0, yFill]], 48, `gr-funfill|${f5(rOut)}|${f5(rFill)}|${f5(yFill)}`), startMat(grain, wet, P.sand_color)), 0, tip + 0.001, 0)))
		return g
	})

	// (the funnel's stand foot is drawn with the funnel)
	addModel("sand-funnel", "foot", () => null)

	// ------------------------------------------------------------- hourglass: turned wooden ends and posts, glass bulbs, its sand as it starts
	const disc = ({ w, h }) => mesh(kit.lathe([[0, -h / 2], [w / 2 - 0.003, -h / 2], [w / 2, -h / 2 + 0.003], [w / 2, h / 2 - 0.003], [w / 2 - 0.003, h / 2], [0, h / 2]], 48, `gr-disc|${f5(w)}|${f5(h)}`), wood("#8a5a33"))
	addModel("hourglass", "base", disc)
	addModel("hourglass", "cap", disc)
	addModel("hourglass", "glass", ({ props, h }) => {
		const P = props ?? {}
		const R = (P.bulb_cm ?? 5) / 200
		const neck = Math.max(0.0008, (P.neck_mm ?? 3) / 1000)
		const g = kit.group()
		const bot = -h / 2
		const bulbH = 2.2 * R
		const yNeck = bot + bulbH
		// one glass: two bulbs joined at the neck (a smooth profile, bottom to top)
		const pts = []
		const n = 40
		for (let k = 0; k <= n; k++) {
			const u = k / n
			const y = u * 2 * bulbH
			const s = Math.abs(y - bulbH) / bulbH // 0 at the neck, 1 at the ends
			const r = neck / 2 + 0.0012 + (R - neck / 2) * Math.sin(Math.min(1, s * 1.15) * Math.PI / 2) ** 1.4 * (s > 0.92 ? 1 - (s - 0.92) * 3 : 1)
			pts.push([r, y])
		}
		g.add(put(mesh(kit.lathe(pts, 64, `gr-hg|${f5(R)}|${f5(neck)}|${f5(bulbH)}`), glass(), { cast: false }), 0, bot, 0))
		// three turned posts between the ends
		const wm = wood("#8a5a33")
		for (let k = 0; k < 3; k++) {
			const a = (k / 3) * TAU + Math.PI / 2
			const post = mesh(kit.lathe([[0.0035, 0], [0.005, 0.01], [0.0035, 0.02], [0.004, h * 0.5], [0.0035, h - 0.02], [0.005, h - 0.01], [0.0035, h]], 16, `gr-post|${f5(h)}`), wm)
			g.add(put(post, Math.cos(a) * (R + 0.008), bot, Math.sin(a) * (R + 0.008)))
		}
		// its sand as it starts: a level fill of the top bulb's funnel-shaped bottom
		const grain = P.grain ?? "fine sand"
		const vol = (P.sand_kg ?? 0.066) / bulkOf(grain, "dry")
		const tw = Math.tan((55 * Math.PI) / 180)
		const r0 = neck / 2
		const rFill = Math.min(R, Math.cbrt(r0 ** 3 + (3 * vol * tw) / Math.PI))
		const yFill = (rFill - r0) * tw
		if (vol > 0) g.add(startPart(put(mesh(kit.lathe([[0, 0], [r0, 0], [rFill * 0.97, yFill], [0, yFill]], 48, `gr-hgfill|${f5(r0)}|${f5(rFill)}|${f5(yFill)}`), startMat(grain, "dry", P.sand_color)), 0, yNeck + 0.0005, 0)))
		return g
	})

	// ------------------------------------------------------------- stream table: its sides, hose, outlet and the books under its high end
	addModel("stream-table", "sand", ({ props, w, h, d }) => {
		const P = props ?? {}
		const Lt = P.length ?? 0.9
		const W = P.width ?? 0.4
		const tilt = ((P.tilt_deg ?? 6) * Math.PI) / 180
		const ca = Math.cos(tilt)
		const sa = Math.sin(tilt)
		const g = kit.group()
		// (frame: the ghost's centre is over the sand's middle; the anchor (the floor's middle) is at (ax, ay) here)
		const share = P.sand_share ?? 0.6
		const ax = Lt / 2 * ca - (share * Lt * ca) / 2
		const ay = -(Lt / 2) * sa + (share * Lt * ca * Math.tan(tilt)) / 2 - h / 2
		const blue = trayBlue()
		const wall = 0.1
		// the two long sides (tipped with the floor)
		// (the back side blue plastic; the front one clear acrylic, so the sand's slope, its channel and the water show from the side)
		for (const sz of [-1, 1]) {
			const side = mesh(kit.box(Lt + 0.012, wall + 0.006, 0.006, 0.0015), sz > 0 ? clearPane() : blue, { cast: sz < 0 })
			g.add(put(side, ax, ay + wall / 2 - 0.003, sz * (W / 2 - 0.003), 0, 0, -tilt))
		}
		// books under the high end (as a classroom props one up): a stack as tall as the high end's rise over the table
		const xl = ax - (Lt / 2) * ca
		const yl = ay + (Lt / 2) * sa
		// (the low end rests on the table: the books stand from there)
		const tableTop = ay - (Lt / 2) * sa - 0.006
		const rise = yl - tableTop
		const bookCols = ["#a3352e", "#2f5d8a", "#3d7a46", "#c99a2e", "#6b4a8a"]
		let yb = tableTop
		let k = 0
		// (the stack's top under the tray's floor where the books end: the floor falls along the tray)
		const bookW = 0.12
		const under = yl - (bookW + 0.01) * Math.tan(tilt) - 0.007
		while (rise > 0.01 && yb < under - 0.002 && k < 12) {
			const th = Math.min(0.035, under - yb)
			if (th < 0.004) break
			const bk = mesh(kit.box(bookW, th, 0.22, 0.002), kit.plastic(bookCols[k % bookCols.length], { gloss: 0.2, key: "granular-book" }))
			g.add(put(bk, xl + bookW / 2 + 0.005 + (k % 2) * 0.004, yb + th / 2, 0))
			yb += th
			k++
		}
		// the hose over the high end: a green garden hose arching in, its nozzle over the sand
		const hose = kit.plastic("#2e8b3a", { gloss: 0.45, key: "granular-hose" })
		const nx = xl + 0.04
		const ny = yl + (P.sand_depth ?? 0.05) + 0.03
		const curve = new T.CatmullRomCurve3([new T.Vector3(xl - 0.25, ny + 0.02, -0.12), new T.Vector3(xl - 0.08, ny + 0.06, -0.06), new T.Vector3(nx - 0.01, ny + 0.03, 0), new T.Vector3(nx, ny, 0)])
		g.add(mesh(kit.geo(`gr-hose|${f5(nx)}|${f5(ny)}|${f5(xl)}`, () => new T.TubeGeometry(curve, 40, 0.008, 12, false)), hose))
		g.add(put(mesh(kit.cylinderY(0.0095, 0.02, 16), kit.metal("#b8a14a", { roughness: 0.35, key: "granular-brass" })), nx, ny - 0.008, 0))
		// the hose's stream, from the nozzle to the sand, while the water runs (frame hook: the table's water_lpm reading)
		const fall = ny - 0.018 - (yl + (P.sand_depth ?? 0.05))
		if (fall > 0.002) {
			const jet = mesh(kit.cylinderY(0.003, fall, 12, 0.0045), waterMat(), { cast: false })
			jet.userData.frame = { hook: "granular:flowing", scaled: false }
			jet.visible = false
			g.add(put(jet, nx, ny - 0.018 - fall / 2, 0))
		}
		// its sand and its pool as they start (the editor's picture; a run's bed takes over): a slab parallel to the floor from the high end to the
		// toe, then the toe at the angle of repose; the pool a wedge of water up to its level at the low end
		{
			const floorY = (x) => ay - (x - ax) * Math.tan(tilt)
			const depth = P.sand_depth ?? 0.05
			const xToe = xl + share * Lt * ca
			const run = depth / (GRAIN_DATA[P.grain ?? "sand"] ?? GRAIN_DATA.sand)[2]
			const across = W - 0.012
			const pts = [[xl, floorY(xl)], [xToe + run, floorY(xToe + run)], [xToe, floorY(xToe) + depth], [xl, floorY(xl) + depth]]
			const sandMesh = mesh(kit.extrude(pts.map(([x, y]) => [x, y]), across, { key: `gr-stsand|${f5(xl)}|${f5(xToe)}|${f5(depth)}|${f5(tilt)}|${f5(across)}` }), startMat(P.grain ?? "sand", P.wetness ?? "damp", null))
			g.add(startPart(put(sandMesh, 0, 0.0005, 0)))
			const xr0 = ax + (Lt / 2) * ca
			const level = floorY(xr0) + (P.lake_cm ?? 2) / 100
			const x0 = ax + (ay - level) / Math.tan(tilt || 1e-6)
			if ((P.lake_cm ?? 2) > 0 && x0 < xr0 - 0.01) {
				const pool = mesh(kit.extrude([[Math.max(x0, xl), level], [Math.max(x0, xl), floorY(Math.max(x0, xl))], [xr0, floorY(xr0)], [xr0, level]].reverse(), across, { key: `gr-stpool|${f5(x0)}|${f5(level)}|${f5(xr0)}|${f5(across)}` }), waterMat(), { cast: false })
				g.add(startPart(put(pool, 0, 0.0005, 0)))
			}
		}
		// the outlet at the low end: a short spout through its wall at the pool's level
		const xr = ax + (Lt / 2) * ca
		const yr = ay - (Lt / 2) * sa
		const lake = (P.lake_cm ?? 2) / 100
		const spout = mesh(kit.cylinderY(0.007, 0.05, 16), kit.plastic("#d9dcdf", { gloss: 0.4, key: "granular-spout" }))
		g.add(put(spout, xr + 0.03, yr + lake, 0, 0, 0, Math.PI / 2))
		void w
		void d
		return g
	})

	// ============================================================== the run's sand: beds, water, falling grains
	addViewPlugin({
		name: "granular",
		load(ctx) {
			const K = ctx.track?.keyframes
			if (!K) return null
			const beds = []
			for (const [item, keys] of Object.entries(K)) {
				for (const key of Object.keys(keys)) {
					if (!key.startsWith("grid:")) continue
					const id = key.slice(5)
					// (a vessel's bed, a funnel's or an hourglass bulb's, is named by its record "item/part": round, drawn as a turned body of sand)
					beds.push(id.includes("/") ? makeVessel(ctx, item, id, keys) : makeBed(ctx, item, id, keys))
				}
			}
			let air = null
			for (const [item, keys] of Object.entries(K)) if (keys.air) air = makeAir(ctx, keys.air)
			if (!beds.length && !air) return null
			return {
				frame(t) {
					for (const b of beds) b.frame(t)
					air?.frame(t)
				},
				dispose() {
					for (const b of beds) b.dispose()
					air?.dispose()
				}
			}
		}
	})

	/** Interpolation between rows [t, ...] of a keyframe list: {k, u} with row k at or before t, u toward row k+1. */
	const locate = (times, t) => {
		let lo = 0
		let hi = times.length - 1
		if (t <= times[0]) return { k: 0, u: 0 }
		if (t >= times[hi]) return { k: hi, u: 0 }
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1
			if (times[mid] <= t) lo = mid
			else hi = mid
		}
		const span = times[lo + 1] - times[lo]
		return { k: lo, u: span > 0 ? (t - times[lo]) / span : 0 }
	}

	/** A bed's grid and its keyframed thickness fields: {x0, z0, dx, nx, nz, n, K, gi, wi, floor, kind, times, fields}. */
	function readBed(keys, id) {
		const grid = keys[`grid:${id}`][0]
		let p = 1
		const x0 = grid[p++]
		const z0 = grid[p++]
		const dx = grid[p++]
		const nx = grid[p++]
		const nz = grid[p++]
		const K = grid[p++]
		const gi = grid.slice(p, p + K)
		p += K
		const wi = grid.slice(p, p + K)
		p += K
		const n = nx * nz
		const { floor, kind } = unpackGrid(grid, p, n)
		const times = []
		const fields = []
		let cur = new Float32Array(n)
		for (const row of keys[`h:${id}`] ?? []) {
			cur = cur.slice()
			unpackRect(row, nx, cur, 1e-4)
			times.push(row[0])
			fields.push(cur)
		}
		if (!fields.length) {
			times.push(0)
			fields.push(new Float32Array(n))
		}
		return { x0, z0, dx, nx, nz, n, K, gi, wi, floor, kind, times, fields }
	}

	/** A round vessel's sand (a funnel's, an hourglass bulb's): the run's surface averaged round its axis, as a turned body that fills the vessel's
	 *  floor up to it (the sand seen through the glass is solid against it). */
	function makeVessel(ctx, item, id, keys) {
		const B = readBed(keys, id)
		const { dx, nx, nz, n, floor, kind, times, fields } = B
		const cx = B.x0 + (nx * dx) / 2
		const tint = ctx.resolved?.[item]?.sand_color
		const color = grainColor(T, GRAIN_KEYS[B.gi[0]] ?? "sand", WET_KEYS[B.wi[0]] ?? "dry", tint === "natural" ? null : tint)
		const rings = Math.ceil(nx / 2) + 1
		const ringOf = new Int32Array(n)
		const ringFloor = new Float32Array(rings).fill(Number.POSITIVE_INFINITY)
		let rMax = 0
		for (let j = 0; j < nz; j++)
			for (let i = 0; i < nx; i++) {
				const c = j * nx + i
				const ex = B.x0 + (i + 0.5) * dx - cx
				const ez = B.z0 + (j + 0.5) * dx
				const r = Math.floor(Math.hypot(ex, ez) / dx + 0.5)
				ringOf[c] = kind[c] ? -1 : r
				if (!kind[c]) {
					ringFloor[r] = Math.min(ringFloor[r], floor[c])
					rMax = Math.max(rMax, r)
				}
			}
		const sum = new Float32Array(rings)
		const cnt = new Float32Array(rings)
		const mat = M(`gr-vessel|${color.getHexString()}`, { color, roughness: 0.97, metalness: 0, map: L.withRepeat(fineMaps().map, 30, 6), normalMap: L.withRepeat(fineMaps().normalMap, 30, 6), normalScale: V2(0.5) })
		const holder = new T.Group()
		ctx.group.add(holder)
		let mesh0 = null
		let shown = -1
		return {
			frame(t) {
				const { k, u } = locate(times, t)
				const key = k + u
				if (key === shown) return
				shown = key
				const a = fields[k]
				const b = fields[Math.min(k + 1, fields.length - 1)]
				sum.fill(0)
				cnt.fill(0)
				for (let c = 0; c < n; c++) {
					const r = ringOf[c]
					if (r < 0) continue
					sum[r] += a[c] + (b[c] - a[c]) * u
					cnt[r]++
				}
				// the surface (r, y) out to where the sand ends, then back along the floor to the axis
				const top = []
				let edge = -1
				for (let r = 0; r <= rMax; r++) {
					if (!cnt[r]) continue
					const h = sum[r] / cnt[r]
					if (h > SAND_MIN) edge = r
					top.push([r * dx, ringFloor[r] + h])
				}
				if (mesh0) {
					holder.remove(mesh0)
					mesh0.geometry.dispose()
					mesh0 = null
				}
				if (edge < 0) return
				const pts = [[0, ringFloor[0] - 0.0004]]
				for (let r = 1; r <= edge + 1 && r <= rMax; r++) pts.push([Math.min(r, edge + 0.5) * dx, (ringFloor[r] ?? ringFloor[edge]) - 0.0004])
				for (let q = Math.min(edge + 1, top.length - 1); q >= 0; q--) pts.push([Math.min(top[q][0], (edge + 0.5) * dx), top[q][1]])
				pts.push([0, top[0][1]])
				const g = new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(Math.max(0, r), y)), 48)
				mesh0 = new T.Mesh(g, mat)
				mesh0.position.set(cx, 0, 0)
				mesh0.castShadow = false
				mesh0.receiveShadow = true
				holder.add(mesh0)
			},
			dispose() {
				mesh0?.geometry.dispose()
			}
		}
	}

	function makeBed(ctx, item, id, keys) {
		const grid = keys[`grid:${id}`][0]
		let p = 1
		const x0 = grid[p++]
		const z0 = grid[p++]
		const dx = grid[p++]
		const nx = grid[p++]
		const nz = grid[p++]
		const K = grid[p++]
		const gi = grid.slice(p, p + K)
		p += K
		const wi = grid.slice(p, p + K)
		p += K
		const n = nx * nz
		const { floor, kind } = unpackGrid(grid, p, n)
		const tint = ctx.resolved?.[item]?.sand_color
		const classColors = gi.map((g, k) => grainColor(T, GRAIN_KEYS[g] ?? "sand", WET_KEYS[wi[k]] ?? "dry", tint === "natural" ? null : tint))
		const stony = gi.some((g) => GRAIN_KEYS[g] === "gravel" || GRAIN_KEYS[g] === "pebbles") && gi.every((g) => ["gravel", "pebbles"].includes(GRAIN_KEYS[g]))
		// every keyframe's whole field (h, mm → m), built once
		const hRows = keys[`h:${id}`] ?? []
		const times = []
		const fields = []
		let cur = new Float32Array(n)
		for (const row of hRows) {
			cur = cur.slice()
			unpackRect(row, nx, cur, 1e-4)
			times.push(row[0])
			fields.push(cur)
		}
		if (!fields.length) {
			times.push(0)
			fields.push(new Float32Array(n))
		}
		// the class shares, per keyframe (null: one class for the bed, `one`)
		const mixRows = keys[`mix:${id}`] ?? []
		const mixTimes = []
		const mixes = []
		let mcur = null
		for (const row of mixRows) {
			const t = row[0]
			if (row[1] === -1) mcur = { one: row[2] }
			else {
				const [, i0, j0, ni, nj] = row
				const prev = mcur && !mcur.one && mcur.one !== 0 ? mcur.shares : new Uint8Array(n * Math.max(1, K - 1))
				const shares = prev.slice()
				let q = 5
				for (let j = j0; j < j0 + nj; j++) for (let i = i0; i < i0 + ni; i++) for (let k = 1; k < K; k++) shares[(j * nx + i) * (K - 1) + (k - 1)] = row[q++]
				mcur = { shares }
			}
			mixTimes.push(t)
			mixes.push(mcur)
		}
		// the water's depth per keyframe (m)
		const wRows = keys[`water:${id}`] ?? []
		const wTimes = []
		const wFields = []
		for (const row of wRows) {
			const f = new Float32Array(n)
			unpackRect(row, nx, f, 1e-4)
			wTimes.push(row[0])
			wFields.push(f)
		}
		// the mesh: a vertex at every column's middle; triangles only between columns that hold grains (not walls or edges)
		const pos = new Float32Array(n * 3)
		const col = new Float32Array(n * 3)
		for (let j = 0; j < nz; j++)
			for (let i = 0; i < nx; i++) {
				const c = j * nx + i
				pos[c * 3] = x0 + (i + 0.5) * dx
				pos[c * 3 + 1] = floor[c]
				pos[c * 3 + 2] = z0 + (j + 0.5) * dx
			}
		const idx = []
		const quadList = []
		for (let j = 0; j < nz - 1; j++)
			for (let i = 0; i < nx - 1; i++) {
				const a = j * nx + i
				const b = a + 1
				const c = a + nx
				const d = c + 1
				if (kind[a] || kind[b] || kind[c] || kind[d]) continue
				idx.push(a, c, b, b, c, d)
				quadList.push(a, b, c, d)
			}
		const quads = Uint32Array.from(quadList)
		// (a quad across a cliff in the floor, a shelf's or a plank's edge over the table: its sand is two surfaces, the heap on top and what spilled
		// below, never a curtain of sand hung between them; joined again only where the sand bridges the step)
		const CLIFF = Math.max(2.5 * dx, 0.015)
		const cliffy = new Uint8Array(quads.length / 4)
		for (let q = 0; q < quads.length; q += 4) {
			const f = [floor[quads[q]], floor[quads[q + 1]], floor[quads[q + 2]], floor[quads[q + 3]]]
			if (Math.max(...f) - Math.min(...f) > CLIFF) cliffy[q / 4] = 1
		}
		const apart = (p, r) => Math.abs(pos[p * 3 + 1] - pos[r * 3 + 1]) > CLIFF
		const torn = (p, r, w) => apart(p, r) || apart(p, w) || apart(r, w)
		const live = new Uint32Array(idx.length)
		const geo = new T.BufferGeometry()
		geo.setAttribute("position", new T.BufferAttribute(pos, 3))
		geo.setAttribute("color", new T.BufferAttribute(col, 3))
		const uv = new Float32Array(n * 2)
		const setUV = () => {
			// (x and z, with the height mixed in: a steep face (a castle's wall) is not one smeared texel)
			for (let c = 0; c < n; c++) {
				uv[c * 2] = (pos[c * 3] + 0.7 * pos[c * 3 + 1]) / 0.04
				uv[c * 2 + 1] = (pos[c * 3 + 2] + 0.7 * pos[c * 3 + 1]) / 0.04
			}
		}
		setUV()
		geo.setAttribute("uv", new T.BufferAttribute(uv, 2))
		geo.setIndex(new T.BufferAttribute(live, 1))
		const sand = new T.Mesh(geo, sandMat(`${item}|${id}`, stony, stony ? 0.25 : 1))
		sand.castShadow = true
		sand.receiveShadow = true
		sand.frustumCulled = false
		ctx.group.add(sand)
		// water: the same grid over the sand where it stands or runs
		let water = null
		let wpos = null
		const wNow = new Float32Array(n)
		const wlive = new Uint32Array(idx.length)
		// the skirt: the sand's side along the bed's edges (seen through a clear wall), from its floor up to its surface
		// (in each column across x, the front-most and the back-most cells that hold grains: a tray's walls are beyond them)
		const edgeCells = []
		const firstHolding = (i, from, step) => {
			for (let j = from; j >= 0 && j < nz; j += step) if (!kind[j * nx + i]) return j * nx + i
			return from * nx + i
		}
		for (let i = 0; i < nx; i++) edgeCells.push([firstHolding(i, nz - 1, -1), 0, 1])
		for (let i = nx - 1; i >= 0; i--) edgeCells.push([firstHolding(i, 0, 1), 0, -1])
		const spos = new Float32Array(edgeCells.length * 2 * 3)
		const scol = new Float32Array(edgeCells.length * 2 * 3)
		const sidx = []
		for (let e = 0; e < edgeCells.length - 1; e++) {
			if (e === nx - 1) continue
			const a0 = e * 2
			const b0 = (e + 1) * 2
			sidx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1)
		}
		const sgeo = new T.BufferGeometry()
		sgeo.setAttribute("position", new T.BufferAttribute(spos, 3))
		sgeo.setAttribute("color", new T.BufferAttribute(scol, 3))
		sgeo.setIndex(sidx)
		const skirt = new T.Mesh(sgeo, M(`gr-skirt|${item}|${id}`, { color: "#ffffff", vertexColors: true, roughness: 0.98, metalness: 0, side: T.DoubleSide }))
		skirt.frustumCulled = false
		skirt.receiveShadow = true
		ctx.group.add(skirt)
		const updateSkirt = () => {
			edgeCells.forEach(([c, , side], e) => {
				const x = pos[c * 3]
				const z = pos[c * 3 + 2] + (side * dx) / 2
				const bare = !(hNow[c] > SAND_MIN) || kind[c]
				const top = bare ? floor[c] - 0.002 : floor[c] + hNow[c]
				spos.set([x, floor[c] - 0.002, z, x, top, z], e * 6)
				const r = col[c * 3] * 0.82
				const g2 = col[c * 3 + 1] * 0.82
				const b2 = col[c * 3 + 2] * 0.82
				scol.set([r * 0.8, g2 * 0.8, b2 * 0.8, r, g2, b2], e * 6)
			})
			sgeo.attributes.position.needsUpdate = true
			sgeo.attributes.color.needsUpdate = true
			sgeo.computeVertexNormals()
		}
		if (wFields.length) {
			wpos = new Float32Array(n * 3)
			wpos.set(pos)
			const wg = new T.BufferGeometry()
			wg.setAttribute("position", new T.BufferAttribute(wpos, 3))
			wg.setIndex(new T.BufferAttribute(wlive, 1))
			water = new T.Mesh(wg, waterMat())
			water.renderOrder = 2
			water.frustumCulled = false
			ctx.group.add(water)
		}
		const hNow = new Float32Array(n)
		let shown = -1
		const c3 = new T.Color()
		const colorAt = (c, mix) => {
			if (K <= 1 || !mix) return classColors[0]
			if (mix.one !== undefined) return classColors[mix.one] ?? classColors[0]
			let rest = 100
			c3.setRGB(0, 0, 0)
			for (let k = 1; k < K; k++) {
				const s = mix.shares[c * (K - 1) + (k - 1)]
				rest -= s
				c3.r += classColors[k].r * s
				c3.g += classColors[k].g * s
				c3.b += classColors[k].b * s
			}
			rest = Math.max(0, rest)
			c3.r = (c3.r + classColors[0].r * rest) / 100
			c3.g = (c3.g + classColors[0].g * rest) / 100
			c3.b = (c3.b + classColors[0].b * rest) / 100
			return c3
		}
		return {
			frame(t) {
				const { k, u } = locate(times, t)
				const a = fields[k]
				const b = fields[Math.min(k + 1, fields.length - 1)]
				const key = k + u
				if (key === shown) return
				shown = key
				const mi = mixTimes.length ? locate(mixTimes, t).k : -1
				const mix = mi >= 0 ? mixes[mi] : null
				// (wetter where water runs: darker)
				let wa = null
				let wb = null
				let wu = 0
				if (wFields.length) {
					const w = locate(wTimes, t)
					wa = wFields[w.k]
					wb = wFields[Math.min(w.k + 1, wFields.length - 1)]
					wu = w.u
				}
				for (let c = 0; c < n; c++) hNow[c] = a[c] + (b[c] - a[c]) * u
				for (let c = 0; c < n; c++) {
					const hh = hNow[c]
					// (bare floor: the vertex sinks a hair under it, and never above the sand beside it (a bowl's or a funnel's steep wall): the
					// sand's edge meets its floor without teeth)
					if (hh > SAND_MIN) pos[c * 3 + 1] = floor[c] + hh
					else {
						let low = floor[c]
						const i = c % nx
						// (never pulled down to sand across a cliff, what spilled onto the table under a shelf's edge)
						const by = (q) => hNow[q] > SAND_MIN && floor[q] > floor[c] - CLIFF
						if (i > 0 && by(c - 1)) low = Math.min(low, floor[c - 1] + hNow[c - 1])
						if (i < nx - 1 && by(c + 1)) low = Math.min(low, floor[c + 1] + hNow[c + 1])
						if (c >= nx && by(c - nx)) low = Math.min(low, floor[c - nx] + hNow[c - nx])
						if (c + nx < n && by(c + nx)) low = Math.min(low, floor[c + nx] + hNow[c + nx])
						pos[c * 3 + 1] = low - 0.0015
					}
					const cc = colorAt(c, mix)
					let dk = 1
					if (wa) {
						const wd = wa[c] + (wb[c] - wa[c]) * wu
						if (wd > 0.0002) dk = 0.7
					}
					col[c * 3] = cc.r * dk
					col[c * 3 + 1] = cc.g * dk
					col[c * 3 + 2] = cc.b * dk
				}
				// only the triangles that touch some sand
				let m = 0
				for (let q = 0; q < quads.length; q += 4) {
					const qa = quads[q]
					const qb = quads[q + 1]
					const qc = quads[q + 2]
					const qd = quads[q + 3]
					const sa = hNow[qa] > SAND_MIN
					const sb = hNow[qb] > SAND_MIN
					const sc = hNow[qc] > SAND_MIN
					const sd = hNow[qd] > SAND_MIN
					const cl = cliffy[q / 4] === 1
					if ((sa || sc || sb) && !(cl && torn(qa, qc, qb))) {
						live[m++] = qa
						live[m++] = qc
						live[m++] = qb
					}
					if ((sb || sc || sd) && !(cl && torn(qb, qc, qd))) {
						live[m++] = qb
						live[m++] = qc
						live[m++] = qd
					}
				}
				geo.index.needsUpdate = true
				geo.setDrawRange(0, m)
				setUV()
				geo.attributes.uv.needsUpdate = true
				geo.attributes.position.needsUpdate = true
				geo.attributes.color.needsUpdate = true
				geo.computeVertexNormals()
				if (!water) updateSkirt()
				if (water) {
					for (let c = 0; c < n; c++) wNow[c] = wa[c] + (wb[c] - wa[c]) * wu
					for (let c = 0; c < n; c++) {
						const top = floor[c] + hNow[c]
						if (wNow[c] > WATER_MIN) wpos[c * 3 + 1] = top + wNow[c] + 0.0004
						else {
							// (a dry column beside water: under that water's surface, so the sheet ends at its shore)
							let low = top
							const i = c % nx
							for (const o of [i > 0 ? -1 : 0, i < nx - 1 ? 1 : 0, c >= nx ? -nx : 0, c + nx < n ? nx : 0]) {
								if (!o || !(wNow[c + o] > WATER_MIN)) continue
								low = Math.min(low, floor[c + o] + hNow[c + o] + wNow[c + o])
							}
							wpos[c * 3 + 1] = low - 0.002
						}
					}
					let m = 0
					for (let q = 0; q < quads.length; q += 4) {
						const qa = quads[q]
						const qb = quads[q + 1]
						const qc = quads[q + 2]
						const qd = quads[q + 3]
						const wa1 = wNow[qa] > WATER_MIN
						const wb1 = wNow[qb] > WATER_MIN
						const wc1 = wNow[qc] > WATER_MIN
						const wd1 = wNow[qd] > WATER_MIN
						if (wa1 || wb1 || wc1) {
							wlive[m++] = qa
							wlive[m++] = qc
							wlive[m++] = qb
						}
						if (wb1 || wc1 || wd1) {
							wlive[m++] = qb
							wlive[m++] = qc
							wlive[m++] = qd
						}
					}
					water.geometry.index.needsUpdate = true
					water.geometry.setDrawRange(0, m)
					water.geometry.attributes.position.needsUpdate = true
					water.geometry.computeVertexNormals()
					updateSkirt()
				}
			},
			dispose() {
				geo.dispose()
				sgeo.dispose()
				water?.geometry.dispose()
			}
		}
	}

	/** The falling grains: each parcel a short streak of grains along its flight (its length one keyframe's flight: consecutive parcels join up). */
	function makeAir(ctx, rows) {
		const times = rows.map((r) => r[0])
		let most = 0
		for (const r of rows) most = Math.max(most, (r.length - 1) / 7)
		const PER = 22
		const cap = Math.min(6000, Math.max(1, most * PER))
		const geo = new T.IcosahedronGeometry(1, 0)
		const mat = M("gr-airgrain", { color: "#ffffff", roughness: 0.9, metalness: 0 })
		const inst = new T.InstancedMesh(geo, mat, cap)
		inst.castShadow = true
		inst.frustumCulled = false
		inst.count = 0
		ctx.group.add(inst)
		const m4 = new T.Matrix4()
		const q = new T.Quaternion()
		const s = new T.Vector3()
		const v = new T.Vector3()
		const colors = GRAIN_KEYS.map((k) => new T.Color(GRAIN_COLOR[k]))
		// (a fixed scatter of the grains in a streak: the same picture for the same moment)
		const jit = Array.from({ length: PER }, (_, k) => [L.h3(k, 1, 7) - 0.5, L.h3(k, 2, 7) - 0.5, L.h3(k, 3, 7) - 0.5, L.h3(k, 4, 7)])
		let shown = -1
		const g = 9.81
		return {
			frame(t) {
				const { k } = locate(times, t)
				const row = rows[k]
				const dt = Math.max(0, Math.min(1 / 15, t - row[0]))
				const key = `${k}|${dt.toFixed(4)}`
				if (key === shown) return
				shown = key
				let m = 0
				for (let p = 1; p + 6 < row.length && m + PER <= cap; p += 7) {
					const x = row[p] + row[p + 3] * dt
					const y = row[p + 1] + row[p + 4] * dt - 0.5 * g * dt * dt
					const z = row[p + 2] + row[p + 5] * dt
					const vx = row[p + 3]
					const vy = row[p + 4] - g * dt
					const vz = row[p + 5]
					const grain = GRAIN_KEYS[row[p + 6]] ?? "sand"
					const size = GRAIN_SIZE[grain] ?? 0.0014
					const sp = Math.hypot(vx, vy, vz)
					const len = sp / 30
					for (const [a, b, c, e] of jit) {
						// along the flight (behind the parcel: where it was) and a little across (a stream a few grains wide)
						v.set(x - (vx / (sp || 1)) * len * e + a * size * 4, y - (vy / (sp || 1)) * len * e + b * size * 2, z - (vz / (sp || 1)) * len * e + c * size * 4)
						const sz = size * (0.7 + 0.6 * e)
						s.set(sz, sz, sz)
						m4.compose(v, q, s)
						inst.setMatrixAt(m, m4)
						inst.setColorAt(m, colors[GRAIN_KEYS.indexOf(grain)] ?? colors[1])
						m++
					}
				}
				inst.count = m
				inst.instanceMatrix.needsUpdate = true
				if (inst.instanceColor) inst.instanceColor.needsUpdate = true
			},
			dispose() {
				geo.dispose()
				inst.dispose()
			}
		}
	}
}
