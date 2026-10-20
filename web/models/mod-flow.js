// 3D models and drawing of the flow module (machines/mod_flow.py): pitchers, jugs and cups that tip to pour, a wall tap, a 2 L bottle with
// holes, a hose (siphon) and a waterwheel; and the moving liquid itself (a view plugin, from the run's keyframes, tooling/src/sim/modules/flow.ts):
// - the particles (track.keyframes[<first flow item>].p: id, x mm, y mm, look per particle, 60 a second, interpolated by id): a particle in
//   flight is drawn stretched along its motion to meet the next one of its stream, as thick as the stream's flow allows (continuity: a
//   particle of volume V spaced ℓ from the next is a piece of a round stream of radius √(V/(πℓ))), so a pour or a jet reads as one stream;
//   a particle that has landed is a round drop;
// - the liquid standing in each container (.b: each layer's top y and look; .i: the inside, in its frame) as a body that fills the inside up to
//   its level (a lathe for a round container standing upright, an extrusion of the inside cut at the level when it is tipped), in its colour;
// - puddles on the table (.d) as thin discs, hoses (.h: their path) as clear tubing with the liquid in it while it flows, and the colour of a
//   fluids-module container that coloured water was poured into (a tint over its liquid).
import { makeLib } from "./surfaces-lib.js"

const VESSELS = {
	// inner width, inner height, wall, spout width (machines/mod_flow.py VESSELS)
	pitcher: [0.1, 0.17, 0.003, 0.035],
	jug: [0.13, 0.22, 0.0025, 0.04],
	"measuring cup": [0.095, 0.12, 0.0025, 0.025],
	cup: [0.07, 0.095, 0.002, 0.03]
}
const BOTTLE_W = 0.102
const BOTTLE_H = 0.23
const BOTTLE_T = 0.002
const S = 0.005 // the particles' spacing (tooling/src/sim/modules/flow.ts SPACING)
const FLOW_KINDS = ["flow-pour", "flow-tap", "flow-vessel", "flow-basin", "flow-hose", "flow-wheel"]
// catching containers whose models are real (transmissive) glass: their liquid is drawn opaque so it shows through (liquidMat "solid")
const THROUGH_GLASS = new Set(["glass-jar"])

/** A 12-bit look (4 bits per channel of what shows through the liquid) as 0…1 r, g, b. */
const look3 = (c) => [((c >> 8) & 15) / 15, ((c >> 4) & 15) / 15, (c & 15) / 15]

/** The keyframe rows around t: {a, b, u} (b may be a). rows = [[t, ...values]]. */
function around(rows, t) {
	if (!Array.isArray(rows) || rows.length === 0) return null
	if (t <= rows[0][0]) return { a: rows[0], b: rows[0], u: 0, i: 0 }
	let lo = 0
	let hi = rows.length - 1
	if (t >= rows[hi][0]) return { a: rows[hi], b: rows[hi], u: 0, i: hi }
	while (hi - lo > 1) {
		const m = (lo + hi) >> 1
		if (rows[m][0] <= t) lo = m
		else hi = m
	}
	const a = rows[lo]
	const b = rows[hi]
	const span = b[0] - a[0]
	return { a, b, u: span > 0 ? Math.min(1, Math.max(0, (t - a[0]) / span)) : 0, i: lo }
}

export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const { T, M, put, mesh, f5 } = L
	const TAU = Math.PI * 2

	// ------------------------------------------------------------- materials
	/** Glass or clear plastic: a faint clear-coated pane (alpha-blended, no depth write), so the liquid inside shows through. */
	const pane = (tint = "#eef6f4", opacity = 0.16) =>
		M(`flow-pane|${tint}|${opacity}`, { color: tint, roughness: 0.03, metalness: 0, transparent: true, opacity, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.3, side: T.DoubleSide })
	const chrome = () => M("flow-chrome", { color: "#e4e8ec", roughness: 0.08, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.05, envMapIntensity: 1.4 })
	const darkMetal = () => M("flow-dark", { color: "#3a3d40", roughness: 0.4, metalness: 0.8 })
	const plastic = (hex, gloss = 0.45) => kit.plastic(hex, { gloss, key: "flow" })
	const tubing = () => M("flow-tubing", { color: "#e9f4f6", roughness: 0.2, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false, clearcoat: 0.8, side: T.DoubleSide })
	/** A liquid of a colour (0…1 rgb of what shows through it): alpha-blended and clear-coated, deeper colours more opaque. */
	function liquidMat(rgb, kind = "body") {
		const q = rgb.map((v) => Math.round(v * 15))
		const dark = 1 - (rgb[0] + rgb[1] + rgb[2]) / 3
		const col = new T.Color(0.62 + 0.38 * rgb[0], 0.74 + 0.26 * rgb[1], 0.86 + 0.14 * rgb[2])
		// (a clear liquid is a pale water-blue; a dyed one takes its colour)
		if (dark > 0.06) col.setRGB(Math.max(0.02, rgb[0]) ** 1.2, Math.max(0.02, rgb[1]) ** 1.2, Math.max(0.02, rgb[2]) ** 1.2)
		const opacity = kind === "drop" ? Math.min(0.92, 0.62 + 0.6 * dark) : Math.min(0.9, 0.42 + 0.7 * dark)
		if (kind === "solid") {
			// (inside real glass, three's transmission pass sees only opaque things: the liquid in a glass jar is drawn opaque, a clear one a
			// light water-blue, and the jar's glass refracts and tints it)
			if (dark <= 0.06) col.setRGB(0.6, 0.78, 0.86)
			return M(`flow-liquid|solid|${q.join(",")}`, { color: col, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.3 })
		}
		return M(`flow-liquid|${kind}|${q.join(",")}`, {
			color: col, roughness: 0.04, metalness: 0, transparent: true, opacity, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03,
			specularIntensity: 1, envMapIntensity: 1.3, side: kind === "body" ? T.FrontSide : T.FrontSide
		})
	}

	/** A puddle: a thin wet film (darker where it lies, glossy), tinted by its colour. */
	function wetMat(rgb) {
		const q = rgb.map((v) => Math.round(v * 15))
		const dark = 1 - (rgb[0] + rgb[1] + rgb[2]) / 3
		// (a wet patch darkens what it lies on and shines: a clear one is a dark glossy film, never a pale disc)
		const col = dark > 0.06 ? new T.Color(rgb[0] * 0.6, rgb[1] * 0.6, rgb[2] * 0.6) : new T.Color(0.16, 0.14, 0.12)
		return M(`flow-wet|${q.join(",")}`, { color: col, roughness: 0.04, metalness: 0, transparent: true, opacity: dark > 0.06 ? 0.5 : 0.36, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 0.8, envMapIntensity: 0.9 })
	}

	// ------------------------------------------------------------- pitcher (the whole vessel on its root part, the pour lip)
	// (its root is a static solid that the hand turns about the lip: the view places statics once, so frame hook "flow:tip" turns the model
	// by the run's tilt_deg reading, toward pour_to: clockwise for the right, as the engine turns the solid)
	addFrameHook("flow:tip", (obj, f, a) => {
		if (obj.userData.tipBase === undefined) obj.userData.tipBase = obj.rotation.z
		const deg = f.state?.tilt_deg
		const ang = obj.userData.tipBase + (Number.isFinite(deg) ? a.sign * deg * (Math.PI / 180) : 0)
		if (obj.rotation.z === ang) return
		obj.rotation.z = ang
		if (!obj.matrixAutoUpdate) obj.updateMatrix()
	})
	addModel("pitcher", "lip", ({ props }) => {
		const P = props ?? {}
		const [w, h, t, lip] = VESSELS[P.vessel] ?? VESSELS.pitcher
		const side = P.pour_to === "left" ? -1 : 1
		const R = w / 2 + t
		const g = kit.group()
		const glassy = P.vessel === "pitcher"
		const wallMat = glassy ? pane("#eef6f4", 0.18) : P.vessel === "cup" ? pane("#f4f7fa", 0.22) : pane("#f7f7f2", 0.42)
		// the vessel: an open cylinder (its outside, rim and inside), centred half its width behind the lip
		const prof = [[0, -h - t], [R, -h - t], [R, -0.0004], [R - 0.0006, 0], [w / 2 + 0.0004, 0], [w / 2, -0.0006], [w / 2, -h], [0, -h]]
		g.add(put(mesh(kit.lathe(prof, 64, `flow-vessel|${f5(w)}|${f5(h)}|${f5(t)}`), wallMat, { cast: false }), -side * w / 2, 0, 0))
		// its glass foot (a thicker base) and rim highlight
		g.add(put(mesh(kit.cylinderY(R, t * 1.6, 48), pane("#e2efea", glassy ? 0.35 : 0.5), { cast: false }), -side * w / 2, -h - t * 0.2, 0))
		// the spout: a little pulled-out lip at the top on the pour side
		const sp = [[0, 0.0005], [side * 0.011, 0.0035], [side * 0.004, -0.014], [0, -0.016]]
		const spoutPts = side > 0 ? sp : sp.slice().reverse()
		g.add(mesh(kit.extrude(spoutPts, lip * 0.9, { key: `flow-spout|${side}|${f5(lip)}` }), wallMat, { cast: false }))
		// the handle: a loop on the back
		if (P.vessel !== "cup") {
			const hr = 0.3 * h
			const tube = glassy ? 0.0055 : 0.006
			const loop = mesh(kit.torus(hr, tube, 12, 32, Math.PI), glassy ? pane("#e6f1ee", 0.45) : plastic(P.vessel === "jug" ? "#f2f2f2" : "#f6f6f2", 0.4))
			loop.rotation.z = side > 0 ? Math.PI / 2 : -Math.PI / 2
			loop.position.set(-side * (w + t), -0.45 * h, 0)
			g.add(loop)
		}
		// a measuring cup's red marks (every 100 mL of its inside: π/4·w² per metre of height)
		if (P.vessel === "measuring cup" || P.vessel === "jug") {
			const per = 100e-6 / ((Math.PI / 4) * w * w)
			const red = plastic("#c8302c", 0.2)
			for (let y = -h + per; y < -0.012; y += per) g.add(put(mesh(kit.box(0.012, 0.0012, 0.0008, 0.0003), red, { cast: false }), -side * w / 2 + side * 0.0, y, R + 0.0004))
		}
		g.userData.frame = { hook: "flow:tip", sign: -side, scaled: false }
		return g
	})
	for (const part of ["floor", "wall-spout", "wall-back", "handle"]) addModel("pitcher", part, () => null)

	// ------------------------------------------------------------- tap
	addModel("tap", "outlet", ({ w, h }) => {
		const g = kit.group()
		g.add(mesh(kit.cylinderY(w / 2, h, 32), chrome()))
		// the aerator's mesh face, darker, at its mouth
		g.add(put(mesh(kit.cylinderY(w / 2 - 0.0015, 0.004, 32), darkMetal()), 0, -h / 2 + 0.0015, 0))
		return g
	})
	addModel("tap", "spout", ({ w, h }) => {
		const r = h / 2
		const g = kit.group()
		g.add(mesh(kit.geo(`flow-spout-tube|${f5(w)}|${f5(r)}`, () => new T.CapsuleGeometry(r, Math.max(0.001, w - 2 * r), 8, 24).rotateZ(Math.PI / 2)), chrome()))
		return g
	})
	addModel("tap", "plate", ({ h, d }) => {
		const g = kit.group()
		g.add(mesh(kit.geo(`flow-plate|${f5(h)}`, () => new T.CylinderGeometry(Math.min(h, d) / 2, Math.min(h, d) / 2, 0.012, 40).rotateZ(Math.PI / 2)), chrome()))
		return g
	})
	addModel("tap", "handle", ({ w, h, d }) => mesh(kit.box(w, h, d, Math.min(h, d) / 2 - 0.0005), chrome()))

	// ------------------------------------------------------------- the bottle with holes (drawn on its floor; a frame hook peels the tape)
	addFrameHook("flow:tape", (obj, f, a) => {
		obj.visible = f.t < a.open
	})
	addModel("leaky-bottle", "floor", ({ props, h: t }) => {
		const P = props ?? {}
		const w = BOTTLE_W
		const H = BOTTLE_H
		const R = w / 2 + t
		const top = t / 2 + H
		const g = kit.group()
		const prof = [[0, -t / 2], [R - 0.008, -t / 2], [R, -t / 2 + 0.008], [R, top], [0.0125, top + 0.06], [0.0125, top + 0.085], [0.0105, top + 0.085], [0.0105, top + 0.062], [w / 2, top + 0.002], [w / 2, t / 2], [0, t / 2]]
		g.add(mesh(kit.lathe(prof, 64, `flow-bottle|${f5(t)}`), pane("#eaf4f6", 0.2), { cast: false }))
		// a label band round its middle
		const label = kit.printed("flow-bottle-label", (c, W, Hh) => {
			c.fillStyle = "#1f6fb2"
			c.fillRect(0, 0, W, Hh)
			c.fillStyle = "#ffffff"
			c.font = "bold 150px system-ui, sans-serif"
			c.textAlign = "center"
			c.textBaseline = "middle"
			c.fillText("2 L", W / 2, Hh / 2)
		}, { w: 1024, h: 256, roughness: 0.35, clearcoat: 0.4 })
		const band = mesh(kit.geo(`flow-band|${f5(R)}`, () => new T.CylinderGeometry(R + 0.0006, R + 0.0006, 0.05, 64, 1, true, Math.PI * 0.62, Math.PI * 0.76)), label, { cast: false })
		band.position.y = top - 0.035
		g.add(band)
		// the holes (dark rings) and the tape over them until they open
		const side = P.facing === "left" ? -1 : 1
		const hs = String(P.hole_heights_cm ?? "")
			.split(",")
			.map((v) => Number.parseFloat(v))
			.filter(Number.isFinite)
		const ring = darkMetal()
		for (const hc of hs) {
			const hole = mesh(kit.geo(`flow-hole|${f5((P.hole_mm ?? 4) / 2000)}`, () => new T.TorusGeometry(Math.max(0.0012, (P.hole_mm ?? 4) / 2000), 0.0006, 8, 20).rotateY(Math.PI / 2)), ring, { cast: false })
			hole.position.set(side * (R + 0.0003), t / 2 + hc / 100, 0)
			g.add(hole)
		}
		if (hs.length) {
			const y0 = t / 2 + Math.min(...hs) / 100 - 0.01
			const y1 = t / 2 + Math.max(...hs) / 100 + 0.01
			const tape = mesh(kit.box(0.0015, y1 - y0, 0.024, 0.0005), M("flow-tape", { color: "#b9bec4", roughness: 0.45, metalness: 0.6 }))
			tape.position.set(side * (R + 0.0008), (y0 + y1) / 2, 0)
			tape.userData.frame = { hook: "flow:tape", open: P.open_at ?? 0.5, scaled: false }
			g.add(tape)
		}
		return g
	})
	for (const part of ["wall-left", "wall-right", "shoulder-left", "shoulder-right"]) addModel("leaky-bottle", part, () => null)
	addModel("leaky-bottle", "stand", ({ w, h, d }) => mesh(kit.box(w, h, d, 0.003), kit.wood("#b98a55", { roughness: 0.45, varnish: 0.5 })))
	addModel("leaky-bottle", "cap", ({ w, h }) => {
		const g = kit.group()
		g.add(mesh(kit.cylinderY(w / 2, h, 32), plastic("#d23a2c", 0.5)))
		for (let k = 0; k < 18; k++) {
			const a = (k / 18) * TAU
			g.add(put(mesh(kit.box(0.0012, h * 0.8, 0.0012, 0.0003), plastic("#b82e22", 0.4)), Math.cos(a) * (w / 2), 0, Math.sin(a) * (w / 2)))
		}
		return g
	})

	// ------------------------------------------------------------- hose: the tube itself is the plugin's, along its path in a run; until then
	// (the catalog's photo, the editor before the first run) a coil of the same clear tubing lies at its item position (frame hook "flow:coil":
	// hidden once the run has the hose's readings)
	addFrameHook("flow:coil", (obj, f) => {
		obj.visible = !(f.state && Object.keys(f.state).length > 0)
	})
	addModel("hose", "end", ({ props }) => {
		const g = kit.group()
		const r = Math.max(0.002, (props?.diameter_mm ?? 10) / 2000) + 0.0015
		const coil = M("flow-coil", { color: "#dcecef", roughness: 0.18, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false, clearcoat: 0.9, side: T.DoubleSide })
		for (let k = 0; k < 3; k++) {
			const loop = mesh(kit.torus(0.045 - k * 0.004, r, 12, 64), coil, { cast: false })
			loop.position.set(k * 0.004, 0.045 - k * 0.004, (k - 1) * r * 2.1)
			g.add(loop)
		}
		const tail = mesh(kit.geo(`flow-coil-tail|${f5(r)}`, () => new T.CylinderGeometry(r, r, 0.05, 16, 1, true).rotateZ(Math.PI / 2)), coil, { cast: false })
		tail.position.set(0.065, r, r * 2.1)
		g.add(tail)
		g.userData.frame = { hook: "flow:coil", scaled: false }
		return g
	})

	// ------------------------------------------------------------- waterwheel
	addModel("waterwheel", "hub", ({ r, d, props }) => {
		const g = kit.group()
		const R = (props?.diameter ?? 0.24) / 2
		g.add(mesh(kit.cylinderZ(r, d, 40), plastic("#2f6fb5", 0.4)))
		g.add(mesh(kit.cylinderZ(r * 0.35, d + 0.03, 24), kit.steel()))
		// a rim on its back face holding the paddles' tips (it turns with the hub)
		const ring = mesh(kit.torus(R - 0.004, 0.003, 10, 72), plastic("#2f6fb5", 0.4))
		ring.position.z = -d / 2 + 0.003
		g.add(ring)
		return g
	})
	addModel("waterwheel", "*", ({ solid, w, h, d }) => {
		if (!String(solid.part).startsWith("paddle")) return undefined
		return mesh(kit.box(w, h, d, Math.min(h / 2 - 1e-4, 0.001)), plastic("#e8b13c", 0.5))
	})
	addModel("waterwheel", "stand", ({ props }) => {
		const D = props?.paddle_depth ?? 0.06
		const g = kit.group()
		// a bracket behind the wheel: a plate and an arm to the axle
		g.add(put(mesh(kit.box(0.05, 0.14, 0.008, 0.002), kit.steel()), 0, -0.03, -(D / 2 + 0.02)))
		g.add(put(mesh(kit.cylinderZ(0.006, 0.02, 16), kit.steel()), 0, 0, -(D / 2 + 0.01)))
		return g
	})

	// ------------------------------------------------------------- the moving liquid
	addViewPlugin({
		name: "flow",
		load(ctx) {
			const recs = (ctx.doc?.processes ?? []).filter((p) => FLOW_KINDS.includes(p.kind))
			if (!recs.length) return null
			const K = ctx.track?.keyframes ?? {}
			const owner = recs[0].item
			const g = ctx.group
			const disposers = []

			// --- particles: one instanced mesh of unit spheres, each scaled into a drop or a piece of stream
			const pRows = K[owner]?.p ?? null
			let inst = null
			let cap = 0
			if (pRows) for (const r of pRows) cap = Math.max(cap, (r.length - 1) / 4)
			const dropMat = M("flow-drops", { color: "#ffffff", roughness: 0.03, metalness: 0, transparent: true, opacity: 0.86, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.3 })
			if (cap > 0) {
				const geo = new T.SphereGeometry(1, 14, 10)
				inst = new T.InstancedMesh(geo, dropMat, Math.ceil(cap))
				inst.instanceMatrix.setUsage(T.DynamicDrawUsage)
				inst.count = 0
				inst.castShadow = false
				inst.receiveShadow = false
				inst.frustumCulled = false
				inst.renderOrder = 3
				g.add(inst)
				disposers.push(() => geo.dispose())
			}
			const m4 = new T.Matrix4()
			const q = new T.Quaternion()
			const sc = new T.Vector3()
			const pos = new T.Vector3()
			const ex = new T.Vector3(1, 0, 0)
			const dir = new T.Vector3()
			const col = new T.Color()
			let pairKey = -1
			let bIndex = null
			// --- the streams' tubes: one geometry for all of them, refilled each frame (12 sides; rows of a chain joined)
			const SIDES = 12
			let tubeCap = 0
			let tubeGeo = null
			let tubeMesh = null
			let tv = 0
			let ti = 0
			let tPos = null
			let tNor = null
			let tCol = null
			let tIdx = null
			const tubeMat = M("flow-stream", { color: "#ffffff", vertexColors: true, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.86, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.35 })
			const tubeEnsure = (verts) => {
				if (verts <= tubeCap) return
				tubeCap = Math.max(verts, 2 * tubeCap, 4096)
				if (tubeMesh) {
					g.remove(tubeMesh)
					tubeGeo.dispose()
				}
				tubeGeo = new T.BufferGeometry()
				tPos = new Float32Array(tubeCap * 3)
				tNor = new Float32Array(tubeCap * 3)
				tCol = new Float32Array(tubeCap * 3)
				tIdx = new Uint32Array(tubeCap * 6)
				tubeGeo.setAttribute("position", new T.BufferAttribute(tPos, 3).setUsage(T.DynamicDrawUsage))
				tubeGeo.setAttribute("normal", new T.BufferAttribute(tNor, 3).setUsage(T.DynamicDrawUsage))
				tubeGeo.setAttribute("color", new T.BufferAttribute(tCol, 3).setUsage(T.DynamicDrawUsage))
				tubeGeo.setIndex(new T.BufferAttribute(tIdx, 1).setUsage(T.DynamicDrawUsage))
				tubeMesh = new T.Mesh(tubeGeo, tubeMat)
				tubeMesh.frustumCulled = false
				tubeMesh.renderOrder = 3
				g.add(tubeMesh)
				disposers.push(() => tubeGeo?.dispose())
			}
			const tubeStart = () => {
				tv = 0
				ti = 0
			}
			const tubeAdd = (pts) => {
				// (a round end at each end of the chain: two extra rings shrinking to nothing)
				const n = pts.length
				const rings = n + 4
				tubeEnsure(tv + rings * SIDES + 64)
				const first = tv
				const ring = (x, y, tx, ty, r, look) => {
					const nx = -ty
					const ny = tx
					const [cr, cg, cb] = look3(look)
					const dark = 1 - (cr + cg + cb) / 3
					const c3 = dark > 0.06 ? [Math.max(0.02, cr) ** 1.2, Math.max(0.02, cg) ** 1.2, Math.max(0.02, cb) ** 1.2] : [0.6, 0.78, 0.95]
					for (let k = 0; k < SIDES; k++) {
						const a = (k / SIDES) * TAU
						const ca = Math.cos(a)
						const sa = Math.sin(a)
						const ox = nx * ca
						const oy = ny * ca
						const oz = sa
						tPos[3 * tv] = x + r * ox
						tPos[3 * tv + 1] = y + r * oy
						tPos[3 * tv + 2] = r * oz
						tNor[3 * tv] = ox
						tNor[3 * tv + 1] = oy
						tNor[3 * tv + 2] = oz
						tCol[3 * tv] = c3[0]
						tCol[3 * tv + 1] = c3[1]
						tCol[3 * tv + 2] = c3[2]
						tv++
					}
				}
				const tan = (j) => {
					const a = pts[Math.max(0, j - 1)]
					const b = pts[Math.min(n - 1, j + 1)]
					const dx = b.x - a.x
					const dy = b.y - a.y
					const l = Math.hypot(dx, dy) || 1
					return [dx / l, dy / l]
				}
				const [t0x, t0y] = tan(0)
				const p0 = pts[0]
				ring(p0.x - t0x * p0.r * 0.9, p0.y - t0y * p0.r * 0.9, t0x, t0y, p0.r * 0.15, p0.look)
				ring(p0.x - t0x * p0.r * 0.55, p0.y - t0y * p0.r * 0.55, t0x, t0y, p0.r * 0.8, p0.look)
				for (let j = 0; j < n; j++) {
					const [tx, ty] = tan(j)
					ring(pts[j].x, pts[j].y, tx, ty, pts[j].r, pts[j].look)
				}
				const [t1x, t1y] = tan(n - 1)
				const p1 = pts[n - 1]
				ring(p1.x + t1x * p1.r * 0.55, p1.y + t1y * p1.r * 0.55, t1x, t1y, p1.r * 0.8, p1.look)
				ring(p1.x + t1x * p1.r * 0.9, p1.y + t1y * p1.r * 0.9, t1x, t1y, p1.r * 0.15, p1.look)
				for (let rr = 0; rr + 1 < rings; rr++)
					for (let k = 0; k < SIDES; k++) {
						const a = first + rr * SIDES + k
						const b = first + rr * SIDES + ((k + 1) % SIDES)
						const c2 = a + SIDES
						const d2 = b + SIDES
						tIdx[ti++] = a
						tIdx[ti++] = b
						tIdx[ti++] = c2
						tIdx[ti++] = b
						tIdx[ti++] = d2
						tIdx[ti++] = c2
					}
			}
			const tubeEnd = () => {
				if (!tubeGeo) return
				tubeGeo.setDrawRange(0, ti)
				for (const k of ["position", "normal", "color"]) tubeGeo.attributes[k].needsUpdate = true
				tubeGeo.index.needsUpdate = true
				tubeMesh.visible = ti > 0
			}
			const drawParticles = (t) => {
				if (!inst) return
				const w = around(pRows, t)
				if (!w) {
					inst.count = 0
					return
				}
				const A = w.a
				const B = w.b
				const span = Math.max(1e-6, B[0] - A[0])
				if (pairKey !== w.i) {
					pairKey = w.i
					bIndex = new Map()
					for (let k = 1; k + 3 < B.length; k += 4) bIndex.set(B[k], k)
				}
				const n = (A.length - 1) / 4
				let c = 0
				// each particle where it is now (interpolated by id) and how it moves
				const px = new Float64Array(n)
				const py = new Float64Array(n)
				const pvx = new Float64Array(n)
				const pvy = new Float64Array(n)
				const live = new Uint8Array(n)
				for (let i = 0; i < n; i++) {
					const k = 1 + 4 * i
					let x = A[k + 1] / 1000
					let y = A[k + 2] / 1000
					const kb = bIndex.get(A[k])
					if (kb !== undefined && B !== A) {
						const xb = B[kb + 1] / 1000
						const yb = B[kb + 2] / 1000
						pvx[i] = (xb - x) / span
						pvy[i] = (yb - y) / span
						x += (xb - x) * w.u
						y += (yb - y) * w.u
					} else if (B !== A && w.u > 0.5) continue // (gone into a container or a puddle by the next keyframe)
					px[i] = x
					py[i] = y
					live[i] = 1
				}
				const laneOf = (i) => Math.floor(Math.floor(A[1 + 4 * i + 3] / 4096) / 1000) % 1048576
				const touchOf = (i) => Math.floor(Math.floor(Math.floor(A[1 + 4 * i + 3] / 4096) / 1000) / 1048576)
				const volOf = (i) => ((Math.floor(A[1 + 4 * i + 3] / 4096) % 1000) / 1000) * S * S
				// a stream's rows: the particles a source let go together (consecutive ids, one emitter, across-places 0, 1, 2...), in flight
				const rowOf = new Int32Array(n).fill(-1)
				const rows = []
				for (let i = 0; i < n; i++) {
					if (!live[i] || touchOf(i) || (laneOf(i) & 7) !== 0) continue
					const em = laneOf(i) >> 3
					const members = [i]
					for (let j = i + 1; j < n && j - i < 8; j++) {
						if (!live[j] || touchOf(j) || A[1 + 4 * j] !== A[1 + 4 * i] + (j - i) || laneOf(j) >> 3 !== em || (laneOf(j) & 7) !== j - i) break
						members.push(j)
					}
					let x = 0
					let y = 0
					let vx = 0
					let vy = 0
					let vol = 0
					for (const m of members) {
						x += px[m] / members.length
						y += py[m] / members.length
						vx += pvx[m] / members.length
						vy += pvy[m] / members.length
						vol += volOf(m)
						rowOf[m] = rows.length
					}
					rows.push({ em, x, y, vx, vy, vol, look: A[1 + 4 * i + 3] % 4096, next: -1 })
				}
				const lastOf = new Map()
				for (let r = rows.length - 1; r >= 0; r--) {
					const R = rows[r]
					if (lastOf.has(R.em)) R.next = lastOf.get(R.em)
					lastOf.set(R.em, r)
				}
				const place = (x, y, vx, vy, len, rad, flat, look) => {
					const sp = Math.hypot(vx, vy)
					if (sp > 1e-6 && len > rad) dir.set(vx / sp, vy / sp, 0)
					else dir.set(1, 0, 0)
					q.setFromUnitVectors(ex, dir)
					pos.set(x, y, 0)
					sc.set(len, rad * flat, rad)
					m4.compose(pos, q, sc)
					inst.setMatrixAt(c, m4)
					const [r, gg, b] = look3(look)
					const dark = 1 - (r + gg + b) / 3
					if (dark > 0.06) col.setRGB(Math.max(0.02, r) ** 1.2, Math.max(0.02, gg) ** 1.2, Math.max(0.02, b) ** 1.2)
					else col.setRGB(0.6, 0.78, 0.95)
					inst.setColorAt(c, col)
					c++
				}
				// streams: chains of rows each no more than 6 cm from the next, drawn as one tube whose radius at each row is continuity's
				// (V = π r² ℓ: a falling stream thins as it speeds up); a row alone is a drop
				const prevOf = new Int32Array(rows.length).fill(-1)
				rows.forEach((R, r) => {
					if (R.next >= 0) {
						const N = rows[R.next]
						// (a slow row close behind the next is joined too: honey oozing off a lip hangs as one thread, never beads)
						const gap = Math.hypot(N.x - R.x, N.y - R.y)
						if (gap < 0.06 && (Math.hypot(R.vx, R.vy) > 0.1 || gap < 0.035)) prevOf[R.next] = r
					}
				})
				tubeStart()
				for (let r = 0; r < rows.length; r++) {
					if (prevOf[r] >= 0) continue
					const chain = [r]
					let k = r
					while (rows[k].next >= 0 && prevOf[rows[k].next] === k) {
						k = rows[k].next
						chain.push(k)
					}
					if (chain.length < 2) {
						const R = rows[r]
						const sp = Math.hypot(R.vx, R.vy)
						const rad = Math.min(0.009, Math.max(0.002, Math.cbrt((3 * R.vol) / (4 * Math.PI))))
						place(R.x, R.y, R.vx, R.vy, rad * (sp > 0.3 ? 1.3 : 1), rad, 1, R.look)
						continue
					}
					const pts = chain.map((i, j) => {
						const R = rows[i]
						const N = rows[chain[Math.min(j + 1, chain.length - 1)]]
						const P = rows[chain[Math.max(j - 1, 0)]]
						const ell = Math.max(S * 0.6, (Math.hypot(N.x - R.x, N.y - R.y) + Math.hypot(R.x - P.x, R.y - P.y)) / (j === 0 || j === chain.length - 1 ? 1 : 2))
						return { x: R.x, y: R.y, r: Math.min(0.014, Math.max(0.0013, Math.sqrt(R.vol / (Math.PI * ell)))), look: R.look }
					})
					tubeAdd(pts)
				}
				tubeEnd()
				for (let i = 0; i < n; i++) {
					if (!live[i] || rowOf[i] >= 0) continue
					// a drop that has landed (or split from its stream): round, a little flattened when it rests on something
					const vol = volOf(i)
					const rad = Math.min(0.009, Math.max(0.0025, Math.cbrt((3 * vol) / (4 * Math.PI))))
					const sp = Math.hypot(pvx[i], pvy[i])
					place(px[i], py[i], pvx[i], pvy[i], rad * (sp > 0.3 ? 1.3 : 1), rad, touchOf(i) ? 0.75 : 1, A[1 + 4 * i + 3] % 4096)
				}
				inst.count = c
				inst.instanceMatrix.needsUpdate = true
				if (inst.instanceColor) inst.instanceColor.needsUpdate = true
			}

			// --- the liquid in each container this module works (pitchers, bottles, the catalog's cups and buckets)
			const basins = []
			for (const r of recs) {
				if (!["flow-pour", "flow-vessel", "flow-basin"].includes(r.kind)) continue
				const rows = K[r.item]?.b
				const inside = K[r.item]?.i?.[0]
				if (!rows || !inside) continue
				const local = []
				for (let k = 0; k < 4; k++) local.push([inside[1 + 2 * k], inside[2 + 2 * k]])
				const frame = r.kind === "flow-basin" ? r.floor : r.solid
				const round = r.kind !== "flow-basin" || r.round === true
				const holder = new T.Group()
				g.add(holder)
				const glass = r.kind === "flow-basin" && THROUGH_GLASS.has(ctx.doc.solids?.find((s) => s.id === frame)?.itemType)
				basins.push({ rows, local, frame, round, holder, key: "", meshes: [], kind: glass ? "solid" : "body" })
			}
			const clipY = (pts, Y, keepBelow) => {
				const out = []
				for (let i = 0; i < pts.length; i++) {
					const a = pts[i]
					const b = pts[(i + 1) % pts.length]
					const ain = keepBelow ? a[1] <= Y : a[1] >= Y
					const bin = keepBelow ? b[1] <= Y : b[1] >= Y
					if (ain) out.push(a)
					if (ain !== bin) {
						const u = (Y - a[1]) / (b[1] - a[1])
						out.push([a[0] + u * (b[0] - a[0]), Y])
					}
				}
				return out
			}
			const drawBasin = (B, t) => {
				const w = around(B.rows, t)
				const pl = ctx.placementAt(B.frame, t)
				if (!w || !pl) return
				// layer tops interpolated where the two keyframes have the same layers
				const A = w.a
				const Bb = w.b
				const layers = []
				for (let k = 1; k + 1 < A.length; k += 2) {
					const top = Bb.length === A.length ? A[k] + (Bb[k] - A[k]) * w.u : A[k]
					layers.push([top, A[k + 1]])
				}
				const c = Math.cos(pl.angle)
				const s = Math.sin(pl.angle)
				const world = B.local.map(([x, y]) => [pl.x + x * c - y * s, pl.y + x * s + y * c])
				const width = (B.local[1][0] - B.local[0][0] + B.local[2][0] - B.local[3][0]) / 2
				const key = `${layers.map(([y, l]) => `${Math.round(y * 2000)}:${l}`).join(",")}|${Math.round(pl.x * 2000)},${Math.round(pl.y * 2000)},${Math.round(pl.angle * 600)}`
				if (key === B.key) return
				B.key = key
				for (const m of B.meshes) {
					B.holder.remove(m)
					m.geometry.dispose()
				}
				B.meshes = []
				let below = -Infinity
				const upright = Math.abs(pl.angle) < 0.004
				for (const [top, look] of layers) {
					const rgb = look3(look)
					if (upright && B.round) {
						// a round container standing up: its liquid a lathe between its walls' radii at the two heights
						const y0 = Math.max(below, Math.min(world[0][1], world[1][1]))
						const y1 = Math.min(top, Math.max(world[2][1], world[3][1]))
						if (y1 - y0 > 1e-4) {
							const rAt = (y) => {
								const u = (y - world[0][1]) / Math.max(1e-9, world[3][1] - world[0][1])
								return (world[1][0] - world[0][0] + u * (world[2][0] - world[3][0] - (world[1][0] - world[0][0]))) / 2
							}
							const cx = (world[0][0] + world[1][0]) / 2
							const geo = new T.LatheGeometry([new T.Vector2(0, 0), new T.Vector2(rAt(y0) - 0.0005, 0), new T.Vector2(rAt(y1) - 0.0005, y1 - y0), new T.Vector2(0, y1 - y0)], 48)
							const m = new T.Mesh(geo, liquidMat(rgb, B.kind))
							m.position.set(cx, y0, 0)
							m.renderOrder = 2
							B.holder.add(m)
							B.meshes.push(m)
						}
					} else {
						let poly = clipY(world, top, true)
						if (below > -Infinity) poly = clipY(poly, below, false)
						if (poly.length >= 3) {
							const shape = new T.Shape(poly.map(([x, y]) => new T.Vector2(x, y)))
							const depth = Math.max(0.004, width - 0.001)
							const geo = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
							geo.translate(0, 0, -depth / 2)
							const m = new T.Mesh(geo, liquidMat(rgb, B.kind))
							m.renderOrder = 2
							B.holder.add(m)
							B.meshes.push(m)
						}
					}
					below = top
				}
			}

			// --- a fluids-module container that dyed liquid was poured into: its colour over its liquid
			const tints = []
			for (const r of ctx.doc.processes ?? []) {
				if (r.kind !== "liquid") continue
				const rows = K[r.item]?.b
				if (!rows) continue
				const dyed = rows.some((row) => row[2] !== 0xfff && row[2] !== undefined)
				if (!dyed) continue
				const depth = Math.max(0.004, r.area / Math.max(1e-6, r.x1 - r.x0) - 0.004)
				const m = new T.Mesh(kit.box(r.x1 - r.x0 - 0.002, 1, depth, 0.0005), liquidMat([1, 1, 1]))
				m.renderOrder = 2
				g.add(m)
				tints.push({ rows, r, m, look: -1 })
			}
			const drawTint = (Tn, t) => {
				const w = around(Tn.rows, t)
				if (!w) return
				const top = w.a[1] + (w.b[1] - w.a[1]) * w.u
				const look = w.a[2]
				const h = top - Tn.r.floor
				Tn.m.visible = look !== 0xfff && h > 0.001
				Tn.m.scale.y = Math.max(1e-4, h - 0.001)
				Tn.m.position.set((Tn.r.x0 + Tn.r.x1) / 2, Tn.r.floor + h / 2, 0)
				if (look !== Tn.look) {
					Tn.look = look
					Tn.m.material = liquidMat(look3(look))
				}
			}

			// --- puddles: thin discs as wide as their volume spreads at their depth
			const dRows = K[owner]?.d ?? null
			const puddles = []
			const drawPuddles = (t) => {
				if (!dRows) return
				const w = around(dRows, t)
				const A = w.a
				// (8 numbers a puddle: its middle x, surface y, mL, the span its drops lie over, look, depth mm, the surface's slope; 7 in a run
				// made before the slope was kept)
				const S = (A.length - 1) % 8 === 0 ? 8 : 7
				const n = Math.floor((A.length - 1) / S)
				while (puddles.length < n) {
					const m = new T.Mesh(kit.cylinderY(1, 1, 48), wetMat([1, 1, 1]))
					m.renderOrder = 2
					m.receiveShadow = true
					g.add(m)
					puddles.push({ m, look: -1 })
				}
				for (let k = 0; k < puddles.length; k++) {
					const P = puddles[k]
					if (k >= n) {
						P.m.visible = false
						continue
					}
					const o = 1 + S * k
					const same = w.b.length === A.length
					const ml = same ? A[o + 2] + (w.b[o + 2] - A[o + 2]) * w.u : A[o + 2]
					const cx = same ? A[o] + (w.b[o] - A[o]) * w.u : A[o]
					const deep = A[o + 6] / 1000
					const area = ml / 1e6 / deep
					// (as wide as its volume spreads at its depth, never much wider than where its drops lie: a few drops on a jar's
					// shoulder stay a small wet patch there)
					const R = Math.min(Math.sqrt(area / Math.PI), Math.max(0.008, (A[o + 4] - A[o + 3]) / 2 + 0.01))
					const thick = Math.min(deep, (ml / 1e6) / (Math.PI * R * R))
					P.m.visible = ml > 0.05
					P.m.scale.set(R, Math.max(0.0005, thick), R)
					// (laid along the surface it lies on: a level table, or a shelf a few degrees off)
					const ang = S === 8 && Number.isFinite(A[o + 7]) ? A[o + 7] : 0
					const up = Math.max(0.0005, thick) / 2 + 0.0003
					P.m.rotation.set(0, 0, ang)
					P.m.position.set(cx - Math.sin(ang) * up, A[o + 1] + Math.cos(ang) * up, 0)
					if (A[o + 5] !== P.look) {
						P.look = A[o + 5]
						P.m.material = wetMat(look3(P.look))
					}
				}
			}

			// --- hoses: clear tubing along their path, with the liquid inside while it flows
			const hoses = []
			for (const r of recs) {
				if (r.kind !== "flow-hose") continue
				const rows = K[r.item]?.h
				if (!rows) continue
				hoses.push({ r, rows, key: "", tube: null, core: null })
			}
			const drawHose = (H, t) => {
				const w = around(H.rows, t)
				if (!w) return
				const p = w.a.slice(1)
				const key = p.map((v) => Math.round(v * 2000)).join(",")
				const d = H.r.d
				if (key !== H.key) {
					H.key = key
					for (const m of [H.tube, H.core]) {
						if (m) {
							g.remove(m)
							m.geometry.dispose()
						}
					}
					// rounded corners: a Catmull-Rom curve through the path's points and points just before and after each corner
					const pts = []
					for (let k = 0; k + 1 < p.length; k += 2) pts.push(new T.Vector3(p[k], p[k + 1], 0))
					const smooth = [pts[0]]
					for (let k = 1; k < pts.length - 1; k++) {
						const a = pts[k - 1]
						const b = pts[k]
						const c = pts[k + 1]
						const rr = Math.min(0.025, a.distanceTo(b) / 2.5, b.distanceTo(c) / 2.5)
						smooth.push(b.clone().add(a.clone().sub(b).setLength(rr)), b.clone().add(c.clone().sub(b).setLength(rr)))
					}
					smooth.push(pts[pts.length - 1])
					const curve = new T.CatmullRomCurve3(smooth, false, "centripetal")
					H.tube = new T.Mesh(new T.TubeGeometry(curve, 96, d / 2 + 0.0015, 16, false), tubing())
					H.tube.renderOrder = 3
					H.core = new T.Mesh(new T.TubeGeometry(curve, 96, d / 2 * 0.92, 12, false), liquidMat([0.9, 0.95, 1]))
					H.core.renderOrder = 2
					g.add(H.core, H.tube)
				}
				const flow = ctx.stateAt(H.r.item, "flow_ml_s", t) ?? 0
				const moved = ctx.stateAt(H.r.item, "moved_ml", t) ?? 0
				// (a siphon's hose is full while it runs and after; it shows empty before it starts)
				H.core.visible = flow > 0.05 || moved > 0.5
			}

			return {
				frame(t) {
					drawParticles(t)
					for (const B of basins) drawBasin(B, t)
					for (const Tn of tints) drawTint(Tn, t)
					drawPuddles(t)
					for (const H of hoses) drawHose(H, t)
				},
				dispose() {
					for (const f of disposers) f()
					for (const B of basins) for (const m of B.meshes) m.geometry.dispose()
					for (const H of hoses) for (const m of [H.tube, H.core]) m?.geometry.dispose()
				}
			}
		}
	})
}
