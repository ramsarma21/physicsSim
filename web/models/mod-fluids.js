// 3D models of the liquids module (machines/mod_fluids.py): water tanks (aquarium, tub, trough), graduated cylinders, beakers, a measuring jug,
// a density column, toy sailboats, clay and foil boats, pennies, grapes, corks, beads, pebbles and a wind sock (the breeze).
// Each container is drawn on its floor part (its two end walls draw nothing: the floor's model draws the whole vessel). Its liquid is a
// see-through body whose top follows the engine's level every frame (frame hook "fluids:level": the container's level_mm reading, or layerN_mm
// for a column of several liquids), so the water rises as things go in and falls as it spills. The liquid is drawn with transmission (it
// bends what is behind it, tinted by its colour over its depth); the glass of the vessels is drawn as a faint, clear-coated pane (not a
// transmissive one), so the liquid behind it still shows through it.
// Frames (web/models3d.js): a container's floor slab is centred on its own origin, t thick: its inner floor is at y = t/2.
import { makeLib } from "./surfaces-lib.js"

// what each liquid looks like: its tint, and how far one sees into it before that tint is all one sees (m: the deeper the body of it, the
// stronger its colour), as an alpha-blended body, so what is in it (a glass marble, an ice cube, which are themselves see-through) shows
const LIQUID_LOOK = {
	water: { color: "#6db3e3", dist: 0.32 }, // (a classroom tank's water reads as water at 25 cm across: the old #9fcdea at 0.55 m looked like an empty pane)
	"salt water": { color: "#a6cfe4", dist: 0.5 },
	"sea water": { color: "#7fc3bd", dist: 0.35 },
	"vegetable oil": { color: "#e3b43a", dist: 0.07 },
	"corn syrup": { color: "#ead190", dist: 0.18 },
	honey: { color: "#c47a08", dist: 0.025 },
	"dish soap": { color: "#3fa54e", dist: 0.035 },
	"rubbing alcohol": { color: "#e0566a", dist: 0.12 } // (tinted, as a density column's alcohol is dyed to be seen)
}
const liquidName = (words) => Object.keys(LIQUID_LOOK).find((k) => words === k || words.startsWith(k)) ?? "water"
const COLORS = { blue: "#3f7fd0", white: "#eef0ec", grey: "#9aa0a6", green: "#4fa35a", red: "#c8443a", yellow: "#e8c13a", orange: "#e8823a", black: "#2a2a2a" }

export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const { T, TAU, M, V2, f5, mesh, put, clamp } = L
	const group = (...c) => kit.group(...c)

	// ------------------------------------------------------------- materials
	/** A vessel's glass: a faint pane with a clear coat (alpha-blended, no depth write), so a liquid drawn behind it still shows. */
	const pane = (tint = "#eef6f4", opacity = 0.14) =>
		M(`fl-pane|${tint}|${opacity}`, { color: tint, roughness: 0.03, metalness: 0, transparent: true, opacity, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.3, side: T.DoubleSide })
	/** A glass edge (seen end-on a pane is green-tinted and bright). */
	const edge = () => M("fl-glass-edge", { color: "#bfe0d2", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, clearcoat: 1 })
	/** A liquid: an alpha-blended, clear-coated body tinted by how deep it is (1 − e^(−depth/dist), at least 0.16 so a thin column still shows),
	 *  drawn after everything solid and see-through in it (no depth write). `tint` < 1 deepens it (a narrow vessel). */
	function liquidMat(name, thickness, tint = 1) {
		const lk = LIQUID_LOOK[name] ?? LIQUID_LOOK.water
		const opacity = clamp(1 - Math.exp(-thickness / (lk.dist * tint)), 0.16, 0.9)
		return M(`fl-liquid2|${name}|${f5(thickness)}|${tint}`, {
			color: lk.color, roughness: 0.05, metalness: 0, transparent: true, opacity, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03,
			specularIntensity: 1, envMapIntensity: 1.2, normalMap: ripples(), normalScale: V2(0.05)
		})
	}
	/** Gentle ripples on a liquid's top (a tiling normal map; the level hook drifts it with time). */
	function ripples() {
		return L.bake("fl-ripple1", 256, 256, (u, v, o) => {
			const a = Math.sin((u * 6 + 0.6 * Math.sin(v * TAU * 2)) * TAU) * 0.5
			const b = Math.sin((v * 5 + 0.5 * Math.sin(u * TAU * 3)) * TAU) * 0.5
			o.r = o.g = o.b = 255
			o.h = 0.5 + 0.25 * a + 0.25 * b + 0.15 * (L.pfbm(u, v, 4, 4, 911, 3) - 0.5)
			o.rough = 0.05
		}, { normal: 1.0, blur: 1 }).normalMap
	}
	const plastic = (hex, gloss = 0.4) => L.plasticMat(hex, gloss)
	const black = () => M("fl-trim", { color: "#1d1f22", roughness: 0.45, metalness: 0, clearcoat: 0.3 })

	// ------------------------------------------------------------- the level hook: a liquid body's top follows the reading
	// args: {key: "level_mm" | "layer2_mm" ..., below: "layer1_mm" | null, y0 (its floor in the part's frame), h0 (its depth as built), h1 (the
	// layer below's top as built, for a layer of a column)}
	addFrameHook("fluids:level", (obj, f, a) => {
		const top = Number.isFinite(f.state?.[a.key]) ? f.state[a.key] / 1000 : a.h0
		const bot = a.below ? (Number.isFinite(f.state?.[a.below]) ? f.state[a.below] / 1000 : a.h1) : 0
		const h = Math.max(1e-5, top - bot)
		obj.scale.y = h
		obj.position.y = a.y0 + bot + h / 2
		obj.visible = top - bot > 2e-5
		// (the ripples drift slowly: 2 cm a second, the same picture for the same t)
		const m = obj.material
		if (m?.normalMap && a.ripple) {
			const own = ownMaterial(obj)
			own.normalMap = own.normalMap.clone()
			own.normalMap.needsUpdate = true
			obj.userData.frame.ripple = false
			obj.userData.rippleMap = own.normalMap
		}
		if (obj.userData.rippleMap) obj.userData.rippleMap.offset.set((f.t * 0.02) % 1, (f.t * 0.013) % 1)
	})
	addFrameHook("fluids:surface", (obj, f, a) => {
		if (!Number.isFinite(f.state?.[a.key])) return
		obj.position.y = a.y0 + f.state[a.key] / 1000
		// (the meniscus of an empty vessel shows once liquid stands in it)
		obj.visible = f.state[a.key] > 0.02
	})
	/** A unit-high box of liquid (x0…x1 by z depth) on a floor at y0: the hook sets its height. `tint` < 1 deepens its colour (a narrow vessel). */
	function liquidBody(name, x0, x1, depth, y0, key, h0, { below = null, h1 = 0, round = false, tint = 1 } = {}) {
		const w = x1 - x0
		const g = round ? kit.geo(`fl-liqcyl|${f5(w)}`, () => new T.CylinderGeometry(w / 2, w / 2, 1, 64, 1)) : kit.geo(`fl-liqbox|${f5(w)}|${f5(depth)}`, () => new T.BoxGeometry(w, 1, depth))
		const m = mesh(g, liquidMat(name, Math.min(depth, w), tint), { cast: false })
		m.position.set((x0 + x1) / 2, y0 + h0 / 2, 0)
		m.scale.y = Math.max(1e-5, h0 - h1)
		if (below) m.position.y = y0 + h1 + (h0 - h1) / 2
		m.userData.frame = { hook: "fluids:level", key, below, y0, h0, h1, ripple: true }
		m.renderOrder = 1
		// (a container that starts empty has its body all the same, hidden until the level hook reads liquid in it: poured in by the flow module)
		m.visible = h0 - h1 > 2e-5
		return m
	}

	// ------------------------------------------------------------- water tank: aquarium, tub, trough
	function tank(ctx) {
		const P = ctx.props
		const style = P.style ?? "aquarium"
		const t = ctx.h // the floor slab's thickness = the wall's
		const Lin = P.length
		const H = P.height
		const D = P.depth
		const fill = Math.min(P.fill ?? 0, H - t)
		const y0 = t / 2 // the inner floor
		const wallH = H - t
		const parts = []
		const name = liquidName(P.liquid ?? "water")
		if (style === "aquarium") {
			const glass = pane()
			const g = 0.006
			// floor, end panes and the front and back panes (the front one faint, so the water shows)
			parts.push(put(mesh(kit.box(Lin + 2 * t, t, D, 0.001), pane("#e6f2ee", 0.3)), 0, 0, 0))
			for (const sx of [-1, 1]) parts.push(put(mesh(kit.box(t, wallH, D, 0.001), glass, { cast: false }), sx * (Lin / 2 + t / 2), y0 + wallH / 2, 0))
			for (const sz of [-1, 1]) parts.push(put(mesh(kit.box(Lin + 2 * t, wallH, g, 0.001), glass, { cast: false }), 0, y0 + wallH / 2, sz * (D / 2 - g / 2)))
			// black plastic trims round the top and the bottom (as a real aquarium's): 2 cm tall, a little proud of the glass
			const trim = black()
			const tw = 0.004
			// (the bottom one no taller than the floor's glass and 2 mm: what rests on the floor stays in sight)
			for (const [yy, hh] of [[H - t / 2 - 0.007, 0.014], [(t + 0.002) / 2 - t / 2, t + 0.002]]) {
				for (const sz of [-1, 1]) parts.push(put(mesh(kit.box(Lin + 2 * t + 2 * tw, hh, tw, 0.0015), trim), 0, yy, sz * (D / 2 + tw / 2 - 0.0005)))
				for (const sx of [-1, 1]) parts.push(put(mesh(kit.box(tw, hh, D + 2 * tw, 0.0015), trim), sx * (Lin / 2 + t + tw / 2 - 0.0005), yy, 0))
			}
			// the glass's faint shadow
			parts.push(put(L.lightShadow(kit.box(Lin + 2 * t, H, D, 0.001), 0.18), 0, H / 2 - t / 2, 0))
			// (built even when it starts empty: the level hook shows it once liquid is poured in)
			parts.push(liquidBody(name, -Lin / 2, Lin / 2, D - 2 * g, y0, "level_mm", Math.max(0, fill)))
		} else {
			const hex = COLORS[P.color] ?? (style === "trough" ? "#eef0ec" : "#3f7fd0")
			const skin = plastic(hex, style === "trough" ? 0.3 : 0.45)
			const r = style === "tub" ? Math.min(0.02, wallH / 4) : 0.002
			// floor, end walls, front and back walls (the tub's corners rounded); a rolled rim along the top
			parts.push(put(mesh(kit.box(Lin + 2 * t, t, D, 0.001), skin), 0, 0, 0))
			for (const sx of [-1, 1]) parts.push(put(mesh(kit.box(t, wallH, D, 0.001), skin), sx * (Lin / 2 + t / 2), y0 + wallH / 2, 0))
			for (const sz of [-1, 1]) parts.push(put(mesh(kit.box(Lin + 2 * t, wallH, t, 0.001), skin), 0, y0 + wallH / 2, sz * (D / 2 - t / 2)))
			const lip = style === "trough" ? 0.005 : 0.007
			for (const sz of [-1, 1]) {
				const rim = mesh(kit.geo(`fl-rim|${f5(Lin + 2 * t)}|${f5(lip)}`, () => new T.CylinderGeometry(lip, lip, Lin + 2 * t, 16, 1).rotateZ(Math.PI / 2)), skin)
				parts.push(put(rim, 0, H - t / 2 - lip * 0.4, sz * (D / 2 - t / 2 + lip * 0.35)))
			}
			for (const sx of [-1, 1]) {
				const rim = mesh(kit.geo(`fl-rimz|${f5(D)}|${f5(lip)}`, () => new T.CylinderGeometry(lip, lip, D, 16, 1).rotateX(Math.PI / 2)), skin)
				parts.push(put(rim, sx * (Lin / 2 + t / 2 + lip * 0.35), H - t / 2 - lip * 0.4, 0))
			}
			void r
			parts.push(liquidBody(name, -Lin / 2, Lin / 2, D - 2 * t, y0, "level_mm", Math.max(0, fill)))
		}
		return group(...parts)
	}
	addModel("water-tank", "floor", tank)
	addModel("water-tank", "wall-left", null)
	addModel("water-tank", "wall-right", null)

	// ------------------------------------------------------------- round vessels: graduated cylinder, beaker, measuring jug
	/** A scale of marks printed on a vessel's front: every `step` mL a short line, every 5th a longer one, every 10th with its number. */
	function scaleMat(key, area, h, stepMl, maxMl, color, { numbersEvery = 10, unit = "mL" } = {}) {
		const W = 256
		const Hpx = 1024
		return L.decalMat(`fl-scale|${key}|${f5(area)}|${f5(h)}|${stepMl}|${maxMl}|${color}`, W, Hpx, (g) => {
			g.clearRect(0, 0, W, Hpx)
			g.strokeStyle = color
			g.fillStyle = color
			g.font = "600 34px system-ui, sans-serif"
			g.textBaseline = "middle"
			const n = Math.round(maxMl / stepMl)
			for (let i = 1; i <= n; i++) {
				const ml = i * stepMl
				const y = Hpx - ((ml / 1e6 / area) / h) * Hpx
				if (y < 4) break
				const big = i % 10 === 0
				const mid = i % 5 === 0
				g.lineWidth = big ? 4 : 3
				g.beginPath()
				g.moveTo(8, y)
				g.lineTo(big ? 120 : mid ? 90 : 55, y)
				g.stroke()
				if (i % numbersEvery === 0) g.fillText(`${ml}`, 130, y)
			}
			g.font = "600 30px system-ui, sans-serif"
			g.fillText(unit, 130, Hpx - 30)
		}, { roughness: 0.4 })
	}
	function roundVessel(ctx, { glass = true, tint = "#ffffff", stepMl = 1, maxMl = 100, color = "#1f3c88", foot = "hex", handle = false, spout = false, numbersEvery = 10 }) {
		const P = ctx.props
		const fh = ctx.h // the floor slab: the foot (a cylinder's is 12 mm, its glass bottom on it)
		const t = P._glass ?? fh
		// the walls' slabs: their outer faces are the vessel's sides (x = ±(r + t)); the inner radius r. In the floor's frame its inside bottom is at fh/2.
		const r = P._inner_r
		const H = P._wall_h - fh / 2 - fh / 2 + t // (the tube from its inside bottom (fh/2) to its rim, as the shapes below are drawn: y0 + H − t = the rim)
		const y0 = fh / 2
		const parts = []
		const skin = glass ? pane(tint, 0.16) : pane(tint, 0.42) // (a kitchen jug is translucent plastic: its contents show)
		const tube = mesh(kit.geo(`fl-tube|${f5(r)}|${f5(t)}|${f5(H)}`, () => new T.CylinderGeometry(r + t * 0.5, r + t * 0.5, H - t, 64, 1, true)), skin, { cast: false })
		parts.push(put(tube, 0, y0 + (H - t) / 2, 0))
		// the rim's bead and (a cylinder) a pouring lip
		parts.push(put(mesh(kit.torus(r + t * 0.5, t * 0.6, 8, 64), glass ? edge() : skin), 0, y0 + H - t, 0, Math.PI / 2, 0, 0))
		// the base
		if (foot === "hex") {
			const fw = ctx.w
			const base = mesh(kit.geo(`fl-hexfoot|${f5(fw)}|${f5(fh)}`, () => new T.CylinderGeometry(fw / 2, fw / 2 + 0.002, fh * 0.75, 6, 1)), plastic("#2f5fb0", 0.5))
			parts.push(put(base, 0, -fh / 2 + (fh * 0.75) / 2, 0))
			parts.push(put(mesh(kit.geo(`fl-disc|${f5(r + t)}|${f5(fh * 0.3)}`, () => new T.CylinderGeometry(r + t, r + t * 1.6, fh * 0.3, 48)), edge()), 0, fh / 2 - fh * 0.15, 0))
		} else {
			parts.push(put(mesh(kit.geo(`fl-disc|${f5(r + t)}|${f5(t)}`, () => new T.CylinderGeometry(r + t, r + t, t, 48)), glass ? edge() : skin), 0, 0, 0))
		}
		if (spout) {
			const sp = mesh(kit.geo(`fl-spout|${f5(r)}|${f5(t)}`, () => new T.ConeGeometry(t * 2.5, t * 6, 12, 1, true).rotateZ(-Math.PI / 2)), glass ? edge() : skin)
			parts.push(put(sp, r + t * 2, y0 + H - 2 * t, 0))
		}
		if (handle) {
			const hd = mesh(kit.geo(`fl-handle|${f5(r)}|${f5(H)}`, () => new T.TorusGeometry(H * 0.28, 0.006, 10, 32, Math.PI)), skin)
			parts.push(put(hd, -(r + t), y0 + H * 0.55, 0, 0, 0, Math.PI / 2))
		}
		// the printed scale on the front of the wall (facing the camera)
		const area = Math.PI * r * r
		const sh = H - t
		const plane = L.decalPlane(Math.min(0.06, r * 1.4), sh, scaleMat(`${ctx.solid.itemType}`, area, sh, stepMl, maxMl, color, { numbersEvery }))
		parts.push(put(plane, -r * 0.05, y0 + sh / 2, r + t * 0.5 + 0.0004))
		// the liquid, and its meniscus: the line a reading is taken at (a thin bright-and-dark ring at the surface, on its own hook)
		// (both built even when it starts empty, fill_ml 0: hidden until the level hook reads liquid in it, as the flow module pours it in)
		const fill = Math.max(0, (P.fill_ml ?? 0) / 1e6 / area)
		parts.push(liquidBody(liquidName(P.liquid ?? "water"), -r * 0.995, r * 0.995, 2 * r * 0.995, y0, "level_mm", Math.min(fill, sh), { round: true, tint: 0.25 }))
		const ring = mesh(kit.torus(r * 0.985, Math.max(0.0005, r * 0.03), 8, 64), M("fl-meniscus", { color: "#4d7fa6", roughness: 0.2, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false }), { cast: false })
		ring.rotation.x = Math.PI / 2
		ring.position.y = y0 + Math.min(fill, sh)
		ring.visible = fill > 2e-5
		ring.userData.frame = { hook: "fluids:surface", key: "level_mm", y0 }
		parts.push(ring)
		return group(...parts)
	}
	const CYL = { "100 mL": [0.0285, 0.212, 0.0015, 1, 100], "250 mL": [0.037, 0.282, 0.0018, 2, 250], "1000 mL": [0.065, 0.382, 0.0025, 10, 1000] }
	addModel("graduated-cylinder", "floor", (ctx) => {
		const [d, H, t, step, max] = CYL[ctx.props.size] ?? CYL["100 mL"]
		return roundVessel({ ...ctx, props: { ...ctx.props, _inner_r: d / 2, _wall_h: H, _glass: t } }, { stepMl: step, maxMl: max, foot: "hex", spout: true })
	})
	const BEAK = { "250 mL": [0.067, 0.095, 0.0016, 25, 250], "600 mL": [0.087, 0.125, 0.0018, 50, 600], "1000 mL": [0.102, 0.145, 0.002, 50, 1000] }
	addModel("beaker", "floor", (ctx) => {
		const [d, H, t, step, max] = BEAK[ctx.props.size] ?? BEAK["600 mL"]
		return roundVessel({ ...ctx, props: { ...ctx.props, _inner_r: d / 2, _wall_h: H }, h: t }, { stepMl: step, maxMl: max, foot: "none", spout: true, color: "#f2f2f2", numbersEvery: 2 })
	})
	addModel("measuring-jug", "floor", (ctx) =>
		roundVessel({ ...ctx, props: { ...ctx.props, _inner_r: 0.0525, _wall_h: 0.155 }, h: 0.003 }, { glass: false, tint: "#e8f0f4", stepMl: 50, maxMl: 1000, foot: "none", spout: true, handle: true, color: "#c0392b", numbersEvery: 2 })
	)
	for (const k of ["graduated-cylinder", "beaker", "measuring-jug"]) {
		addModel(k, "wall-left", null)
		addModel(k, "wall-right", null)
	}

	// ------------------------------------------------------------- density column: a tall jar of layers
	const COLUMN_LAYERS = {
		"6 layers": ["honey", "corn syrup", "dish soap", "water", "vegetable oil", "rubbing alcohol"],
		"3 layers": ["corn syrup", "water", "vegetable oil"],
		"water and oil": ["water", "vegetable oil"],
		"honey, water, oil": ["honey", "water", "vegetable oil"]
	}
	addModel("density-column", "floor", (ctx) => {
		const P = ctx.props
		const t = 0.003
		const r = 0.03
		const H = 0.32
		const y0 = t / 2
		const parts = []
		parts.push(put(mesh(kit.geo(`fl-tube|${f5(r)}|${f5(t)}|${f5(H)}`, () => new T.CylinderGeometry(r + t * 0.5, r + t * 0.5, H - t, 64, 1, true)), pane(), { cast: false }), 0, y0 + (H - t) / 2, 0))
		parts.push(put(mesh(kit.torus(r + t * 0.5, t * 0.6, 8, 64), edge()), 0, H - t / 2, 0, Math.PI / 2, 0, 0))
		parts.push(put(mesh(kit.geo(`fl-disc|${f5(r + t)}|${f5(t)}`, () => new T.CylinderGeometry(r + t, r + t, t, 48)), edge()), 0, 0, 0))
		const order = (P.order ?? COLUMN_LAYERS[P.layers ?? "6 layers"].join(", ")).split(", ")
		const area = Math.PI * r * r
		const h = Math.min((P.layer_ml ?? 100) / 1e6 / area, (H - t) / order.length)
		order.forEach((name, i) => {
			parts.push(liquidBody(name, -r * 0.995, r * 0.995, 2 * r * 0.995, y0, `layer${i + 1}_mm`, h * (i + 1), { below: i ? `layer${i}_mm` : null, h1: h * i, round: true }))
		})
		return group(...parts)
	})
	addModel("density-column", "wall-left", null)
	addModel("density-column", "wall-right", null)

	// ------------------------------------------------------------- toy sailboat
	addModel("sailboat", "hull", (ctx) => {
		const pts = ctx.body.points.map((p) => [p.x, p.y])
		const B = ctx.body.depth
		const L0 = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]))
		const xs = Math.min(...pts.map((p) => p[0]))
		const g = kit.geo(`fl-hull|${JSON.stringify(pts)}|${f5(B)}`, () => {
			const shape = new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y)))
			const e = new T.ExtrudeGeometry(shape, { depth: B, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 3, curveSegments: 4 })
			e.translate(0, 0, -B / 2)
			// the hull narrows to a point at the bow in plan view (its side outline is the physics; its width is only the look)
			const pos = e.attributes.position
			for (let i = 0; i < pos.count; i++) {
				const x = pos.getX(i)
				const u = clamp((x - xs) / L0, 0, 1)
				const w = u < 0.55 ? 1 - 0.15 * Math.pow((0.55 - u) / 0.55, 2) : Math.max(0.12, 1 - Math.pow((u - 0.55) / 0.45, 1.6))
				pos.setZ(i, pos.getZ(i) * w)
			}
			e.computeVertexNormals()
			return e
		})
		const paint = M(`fl-hullpaint|${ctx.color}`, { color: ctx.color, roughness: 0.32, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1 })
		const hull = mesh(g, paint)
		// a pale wooden deck along the top, inset from the sides
		const top = Math.max(...pts.map((p) => p[1]))
		const deck = mesh(kit.geo(`fl-deck|${f5(L0)}|${f5(B)}`, () => {
			const s = new T.Shape()
			const n = 24
			for (let i = 0; i <= n; i++) {
				const u = i / n
				const w = u < 0.55 ? 1 - 0.15 * Math.pow((0.55 - u) / 0.55, 2) : Math.max(0.12, 1 - Math.pow((u - 0.55) / 0.45, 1.6))
				const x = xs + u * L0
				if (i === 0) s.moveTo(x, (B / 2 - 0.004) * w)
				else s.lineTo(x, (B / 2 - 0.004) * w)
			}
			for (let i = n; i >= 0; i--) {
				const u = i / n
				const w = u < 0.55 ? 1 - 0.15 * Math.pow((0.55 - u) / 0.55, 2) : Math.max(0.12, 1 - Math.pow((u - 0.55) / 0.45, 1.6))
				s.lineTo(xs + u * L0, -(B / 2 - 0.004) * w)
			}
			return new T.ShapeGeometry(s).rotateX(-Math.PI / 2)
		}), kit.wood("#d8b384", { roughness: 0.5, varnish: 0.7 }))
		deck.position.y = top + 0.0021
		// a white waterline stripe a little above where it floats
		const stripe = mesh(kit.geo(`fl-stripe|${f5(L0)}|${f5(B)}`, () => new T.PlaneGeometry(L0 * 0.8, 0.003)), M("fl-stripe", { color: "#f5f5f0", roughness: 0.4, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }))
		stripe.position.set(xs + L0 * 0.45, top * 0.45, B / 2 + 0.0019)
		return group(hull, deck, stripe)
	})
	addModel("sailboat", "keel", (ctx) => {
		const pts = ctx.body.points.map((p) => [p.x, p.y])
		return group(mesh(kit.extrude(pts, ctx.body.depth, { bevel: 0.0008, key: `fl-keel|${JSON.stringify(pts)}` }), plastic("#2a2a2a", 0.4)))
	})
	addModel("sailboat", "mast", (ctx) => {
		const wood = kit.wood("#c9a06a", { roughness: 0.5, varnish: 0.6 })
		const m = mesh(kit.cylinderY(0.002, ctx.h, 16), wood)
		// a small pennant at the top, streaming downwind (+x)
		const flag = mesh(kit.geo("fl-pennant", () => {
			const s = new T.Shape([new T.Vector2(0, 0), new T.Vector2(0.03, -0.006), new T.Vector2(0, -0.012)])
			return new T.ShapeGeometry(s)
		}), M("fl-pennant", { color: "#e8823a", roughness: 0.8, metalness: 0, side: T.DoubleSide }))
		flag.position.set(0.002, ctx.h / 2, 0)
		return group(m, flag)
	})
	addModel("sailboat", "sail", (ctx) => {
		const P = ctx.props
		const w = P.sail_width || 0.1
		const h = ctx.h
		const stuff = P.sail_material ?? "paper"
		const col = ctx.color
		const mat = M(`fl-sail|${stuff}|${col}`, {
			color: col, roughness: stuff === "plastic" ? 0.25 : stuff === "cloth" ? 0.95 : 0.8, metalness: 0, side: T.DoubleSide,
			sheen: stuff === "cloth" ? 1 : 0, sheenColor: new T.Color(col), clearcoat: stuff === "plastic" ? 0.6 : 0, transmission: stuff === "plastic" ? 0.3 : 0, thickness: 0.0005
		})
		// the sail let out 45° from the boat's line (as the catalog says), filled by the wind: a gentle belly downwind
		const g = kit.geo(`fl-sailsheet|${f5(w)}|${f5(h)}`, () => {
			const geo = new T.PlaneGeometry(w, h, 12, 12)
			const pos = geo.attributes.position
			for (let i = 0; i < pos.count; i++) {
				const u = (pos.getX(i) + w / 2) / w
				const v = (pos.getY(i) + h / 2) / h
				pos.setZ(i, 0.12 * w * Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.15 + 0.85 * v)))
			}
			geo.translate(-w / 2, 0, 0) // its luff (front edge) at the mast
			geo.computeVertexNormals()
			return geo
		})
		const sheet = mesh(g, mat)
		sheet.rotation.y = Math.PI / 4 // the leech swings out toward the camera, the sail's face toward the wind (+x)
		sheet.position.x = 0.0025
		// the boom along its foot
		const boom = mesh(kit.geo(`fl-boom|${f5(w)}`, () => new T.CylinderGeometry(0.0015, 0.0015, w, 10).rotateZ(Math.PI / 2).translate(-w / 2, 0, 0)), kit.wood("#c9a06a", { roughness: 0.5, varnish: 0.6 }))
		boom.rotation.y = Math.PI / 4
		boom.position.set(0.0025, -h / 2 - 0.002, 0)
		return group(sheet, boom)
	})

	// ------------------------------------------------------------- clay boat and foil boat (open trays)
	function openBoat(ctx, kind) {
		const P = ctx.props
		const t = ctx.h
		const Lb = ctx.w
		const D = ctx.d
		const sol = ctx.solid
		void sol
		// the boat's size from its props (the floor's solid is its bottom); a clay boat's length is worked out from its clay (its resolved
		// `length`), and where only the type's defaults are at hand (its catalog photo) from its bottom: L = Lb + 2 × 0.5 × 0.4 L, L = Lb / 0.6
		const flare = kind === "clay" ? 0.5 : 0
		const L = Number.isFinite(P.length) ? P.length : kind === "clay" ? Lb / (1 - 2 * flare * 0.4) : Lb
		const H = kind === "clay" ? 0.4 * L : P.height
		const mat = kind === "clay"
			? M("fl-clay", { color: "#5a9b4a", roughness: 0.78, metalness: 0, normalMap: L_clayNormal(), normalScale: V2(0.35) })
			: M("fl-foil", { color: "#dfe3e7", roughness: 0.28, metalness: 1, normalMap: L_foilNormal(), normalScale: V2(0.6) })
		const wall = kind === "clay" ? t : 0.0006
		const parts = []
		// bottom, two sloping ends, front and back sides (trapezoids)
		parts.push(put(mesh(kit.box(Lb, wall, D, wall * 0.4), mat), 0, -t / 2 + wall / 2, 0))
		const slope = Math.atan2(flare * H, H)
		for (const sx of [-1, 1]) {
			const len = Math.hypot(flare * H, H)
			const e = mesh(kit.box(wall, len, D, wall * 0.4), mat)
			e.position.set(sx * (Lb / 2 + (flare * H) / 2 - wall / 2), -t / 2 + H / 2, 0)
			e.rotation.z = -sx * slope
			parts.push(e)
		}
		const side = kit.geo(`fl-side|${kind}|${f5(Lb)}|${f5(L)}|${f5(H)}|${f5(wall)}`, () => {
			const s = new T.Shape([new T.Vector2(-Lb / 2, 0), new T.Vector2(Lb / 2, 0), new T.Vector2(L / 2, H), new T.Vector2(-L / 2, H)])
			const g = new T.ExtrudeGeometry(s, { depth: wall, bevelEnabled: false })
			return g
		})
		for (const sz of [-1, 1]) parts.push(put(mesh(side, mat), 0, -t / 2, sz > 0 ? D / 2 - wall : -D / 2))
		// the water that has come in over its rim (its water_ml reading), level from its bottom up, full when it has flooded
		const inner = mesh(kit.geo(`fl-inwater|${f5(L)}|${f5(D)}`, () => new T.BoxGeometry(1, 1, 1)), liquidMat("water", D))
		inner.scale.set(Math.max(0.001, (Lb + L) / 2 - 2 * wall), 0.001, Math.max(0.001, D - 2 * wall))
		inner.position.set(0, -t / 2 + wall, 0)
		inner.visible = false
		inner.userData.frame = { hook: "fluids:inwater", cap: P.inside_ml ?? 1, h: H - wall, y0: -t / 2 + wall }
		parts.push(inner)
		return group(...parts)
	}
	addFrameHook("fluids:inwater", (obj, f, a) => {
		const share = (f.state?.flooded ?? 0) >= 0.5 ? 1 : clamp((f.state?.water_ml ?? 0) / Math.max(1e-9, a.cap), 0, 1)
		obj.visible = share > 0.002
		const h = Math.max(0.0005, a.h * share)
		obj.scale.y = h
		obj.position.y = a.y0 + h / 2
	})
	let clayN = null
	let foilN = null
	function L_clayNormal() {
		return (clayN ??= L.bake("fl-clay1", 256, 256, (u, v, o) => {
			o.r = o.g = o.b = 255
			o.h = 0.5 + 0.35 * (L.pfbm(u, v, 6, 6, 931, 4) - 0.5) + 0.15 * (L.pn(u, v, 30, 30, 932) - 0.5)
			o.rough = 0.8
		}, { normal: 1.2, blur: 1 }).normalMap)
	}
	function L_foilNormal() {
		return (foilN ??= L.bake("fl-foil1", 256, 256, (u, v, o) => {
			o.r = o.g = o.b = 255
			const cr = Math.abs(Math.sin((u * 7 + 2 * L.pfbm(u, v, 3, 3, 941, 3)) * TAU)) + Math.abs(Math.sin((v * 5 + 2 * L.pfbm(u, v, 3, 3, 942, 3)) * TAU))
			o.h = 0.5 + 0.25 * (1 - cr / 2) + 0.2 * (L.pfbm(u, v, 8, 8, 943, 3) - 0.5)
			o.rough = 0.3
		}, { normal: 2.0, blur: 0 }).normalMap)
	}
	addModel("clay-boat", "floor", (ctx) => openBoat(ctx, "clay"))
	addModel("clay-boat", "wall-left", null)
	addModel("clay-boat", "wall-right", null)
	addModel("foil-boat", "floor", (ctx) => openBoat(ctx, "foil"))
	addModel("foil-boat", "wall-left", null)
	addModel("foil-boat", "wall-right", null)

	// ------------------------------------------------------------- small things
	addModel("penny", "coin", (ctx) => {
		// a penny, or a neat stack of them (count): each coin a disc with a raised rim, the stack a little uneven as a real one is
		const r = ctx.w / 2
		const n = Math.max(1, Math.round(ctx.props.count ?? 1))
		const h = ctx.h / n
		const cu = M("fl-copper", { color: "#b8693a", roughness: 0.38, metalness: 1, clearcoat: 0.1 })
		const coin = kit.geo(`fl-penny|${f5(r)}|${f5(h)}`, () => new T.CylinderGeometry(r, r, h * 0.92, 40))
		const rim = kit.torus(r - 0.0005, 0.0005, 5, 40)
		const parts = []
		for (let i = 0; i < n; i++) {
			const y = -ctx.h / 2 + (i + 0.5) * h
			const dx = n > 1 ? 0.0004 * Math.sin(i * 2.399) : 0
			const dz = n > 1 ? 0.0004 * Math.cos(i * 2.399) : 0
			parts.push(put(mesh(coin, cu), dx, y, dz))
			if (i === n - 1 || n <= 3) parts.push(put(mesh(rim, cu, { cast: false }), dx, y + h * 0.42, dz, Math.PI / 2, 0, 0))
		}
		return group(...parts)
	})
	addModel("grape", "grape", (ctx) => {
		const m = M("fl-grape", { color: "#5e2f6e", roughness: 0.42, metalness: 0, sheen: 0.6, sheenColor: new T.Color("#c9b6d8"), sheenRoughness: 0.5, clearcoat: 0.4 })
		const s = mesh(kit.sphere(ctx.r, 32, 20), m)
		const stem = mesh(kit.cylinderY(0.0008, 0.004, 8), M("fl-stem", { color: "#6b5a33", roughness: 0.8, metalness: 0 }))
		stem.position.y = ctx.r + 0.0015
		return group(s, stem)
	})
	addModel("cork", "cork", (ctx) => {
		const len = ctx.solid.length ?? 0.044
		const m = L.corkMat ? L.corkMat() : M("fl-cork", { color: "#c89a62", roughness: 0.9, metalness: 0 })
		return group(mesh(kit.cylinderZ(ctx.r, len, 40), m))
	})
	addModel("plastic-bead", "bead", (ctx) => {
		const r = ctx.r
		const g = kit.geo(`fl-bead|${f5(r)}`, () => {
			const s = new T.Shape()
			s.absarc(0, 0, r, 0, TAU, false)
			const hole = new T.Path()
			hole.absarc(0, 0, r * 0.38, 0, TAU, true)
			s.holes.push(hole)
			const e = new T.ExtrudeGeometry(s, { depth: r * 1.4, bevelEnabled: true, bevelThickness: r * 0.25, bevelSize: r * 0.22, bevelSegments: 4, curveSegments: 24 })
			e.translate(0, 0, -r * 0.7)
			return e
		})
		return group(mesh(g, M("fl-bead", { color: "#e2445c", roughness: 0.18, metalness: 0, clearcoat: 0.8 })))
	})
	addModel("pebble", "stone", (ctx) => {
		const pts = ctx.body.points.map((p) => [p.x, p.y])
		const d = ctx.body.depth
		const g = kit.geo(`fl-pebble|${JSON.stringify(pts)}|${f5(d)}`, () => {
			const shape = new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y)))
			const b = Math.min(d * 0.35, 0.012)
			const e = new T.ExtrudeGeometry(shape, { depth: Math.max(0.001, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: Math.min(b * 0.6, 0.004), bevelSegments: 6, curveSegments: 6 })
			e.translate(0, 0, -(d - 2 * b) / 2)
			return e
		})
		const m = M("fl-granite", {
			map: L.bake("fl-granite1", 256, 256, (u, v, o) => {
				const s = L.h3(Math.floor(u * 256), Math.floor(v * 256), 951)
				const k = 0.8 + 0.25 * (L.pfbm(u, v, 5, 5, 952, 3) - 0.5)
				const dark = s < 0.12 ? 0.45 : s > 0.93 ? 1.35 : 1
				o.r = clamp(140 * k * dark, 0, 255)
				o.g = clamp(137 * k * dark, 0, 255)
				o.b = clamp(130 * k * dark, 0, 255)
				o.h = 0.5 + 0.2 * (L.pfbm(u, v, 9, 9, 953, 3) - 0.5)
				o.rough = 0.8
			}, { normal: 0.6 }).map,
			roughness: 0.75, metalness: 0
		})
		return group(mesh(g, m))
	})

	// ------------------------------------------------------------- a lab stand under a fan raised to a sail's height (render only)
	// A fan aimed at a sailboat's sail stands higher than the table (and a raised lane's fan higher still): in a scene with a liquid, a fan whose
	// base hangs more than 1 cm over what is under it is drawn clamped to a retort stand, its rod 17 cm behind the fan (behind a trough of 12 cm
	// and a fan base of 20 cm), its foot on the tabletop, a boss and an arm into the back of the fan's motor.
	addViewPlugin({
		name: "fluids:fan-stands",
		load(ctx) {
			const doc = ctx.doc
			if (!(doc?.processes ?? []).some((p) => p.kind === "liquid")) return null
			const top = doc.solids.find((s) => s.itemType === "table" && s.part === "top")
			const tableTop = top ? top.at.y + top.body.height / 2 : 0
			const statics = doc.solids.filter((s) => s.kind === "static")
			const steel = kit.steel()
			const iron = M("fl-standfoot", { color: "#2b2e33", roughness: 0.55, metalness: 0.6 })
			let n = 0
			for (const base of doc.solids.filter((s) => s.itemType === "fan" && s.part === "base")) {
				const item = base.item
				const motor = doc.solids.find((s) => s.item === item && s.part === "motor")
				if (!motor) continue
				const bottom = base.at.y - base.body.height / 2
				const x0 = base.at.x - base.body.width / 2
				const x1 = base.at.x + base.body.width / 2
				// what is under the base: the table, or another item's static part within 1 cm under it
				let under = tableTop
				for (const s of statics) {
					if (s.item === item || s.body.kind === "ball") continue
					const w = (s.body.width ?? 0) / 2
					const h = (s.body.height ?? 0) / 2
					if (s.at.x + w < x0 || s.at.x - w > x1) continue
					const y = s.at.y + h
					if (y <= bottom + 1e-6 && y > under) under = y
				}
				if (bottom - under < 0.01 || bottom - tableTop < 0.01) continue
				const zr = -0.17
				const rodTop = motor.at.y + 0.02
				const rod = mesh(kit.cylinderY(0.0065, rodTop - tableTop, 20), steel)
				rod.position.set(motor.at.x, tableTop + (rodTop - tableTop) / 2, zr)
				const foot = mesh(kit.box(0.11, 0.012, 0.22, 0.003), iron)
				foot.position.set(motor.at.x, tableTop + 0.006, zr - 0.06)
				const boss = mesh(kit.box(0.03, 0.03, 0.03, 0.004), iron)
				boss.position.set(motor.at.x, motor.at.y, zr)
				const reach = -(motor.body.depth / 2) - zr
				const arm = mesh(kit.cylinderZ(0.005, reach, 16), steel)
				arm.position.set(motor.at.x, motor.at.y, zr + reach / 2)
				ctx.group.add(rod, foot, boss, arm)
				n++
			}
			return n ? { frame() {}, dispose() {} } : null
		}
	})

	// ------------------------------------------------------------- surface tension: capillary tubes, paper strips, a dropper of soap
	// (a liquid column in a tube, or the wet part of a paper strip, from the part's bottom end up to its column_mm reading)
	addFrameHook("fluids:column", (obj, f, a) => {
		const h = Math.min(a.max, Math.max(0, Number.isFinite(f.state?.column_mm) ? f.state.column_mm / 1000 : 0))
		obj.visible = h > 2e-4
		obj.scale.y = Math.max(1e-5, h)
		obj.position.y = a.y0 + h / 2
	})
	addModel("capillary-tube", "tube", (ctx) => {
		const r = (ctx.props.bore_mm ?? 1) / 2000
		const L = ctx.h
		const out = ctx.w / 2
		const tube = mesh(kit.geo(`fl-ctube|${f5(out)}|${f5(L)}`, () => new T.CylinderGeometry(out, out, L, 32, 1, true)), pane("#eef6f4", 0.24), { cast: false })
		const bore = mesh(kit.geo(`fl-cbore|${f5(r)}|${f5(L)}`, () => new T.CylinderGeometry(r, r, L, 24, 1, true)), pane("#e2f0ee", 0.18), { cast: false })
		const rims = [-1, 1].map((sy) => put(mesh(kit.torus((out + r) / 2, (out - r) / 2, 8, 32), edge()), 0, (sy * L) / 2, 0, Math.PI / 2, 0, 0))
		// the liquid in it (dyed blue, as a classroom's is, so a thin column shows), its top following the reading
		// (drawn at least 0.8 mm across, so a hair-thin column still reads at a classroom distance)
		const rv = Math.max(r * 0.97, 0.0008)
		const col = mesh(kit.geo(`fl-ccol|${f5(rv)}`, () => new T.CylinderGeometry(rv, rv, 1, 24, 1)), M("fl-column2", { color: "#1d64c8", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.95, depthWrite: false, clearcoat: 1 }), { cast: false })
		col.position.y = -L / 2
		col.visible = false
		col.renderOrder = 2
		col.userData.frame = { hook: "fluids:column", y0: -L / 2, max: L }
		return group(tube, bore, ...rims, col)
	})
	addModel("paper-strip", "strip", (ctx) => {
		const w = ctx.w
		const L = ctx.h
		const t = Math.max(0.0002, ctx.d)
		const kind = ctx.props.paper ?? "paper towel"
		const paper = M(`fl-paper|${kind}`, { color: kind === "printer paper" ? "#fbfbf8" : "#f3f0e8", roughness: 0.95, metalness: 0, normalMap: L_paperNormal(), normalScale: V2(kind === "paper towel" ? 0.5 : 0.15) })
		const strip = mesh(kit.box(w, L, t, 0.0001), paper)
		// the wet part: darker and a little grey-blue, from its lower end up to how far the liquid has climbed
		const wet = mesh(kit.box(w * 1.002, 1, t * 1.3, 0.0001), M("fl-wetpaper2", { color: "#6f93b4", roughness: 0.55, metalness: 0, transparent: true, opacity: 0.9 }), { cast: false })
		wet.position.y = -L / 2
		wet.visible = false
		wet.userData.frame = { hook: "fluids:column", y0: -L / 2, max: L }
		// a clip at its top
		const clip = put(mesh(kit.box(Math.min(0.03, w + 0.006), 0.012, 0.008, 0.001), kit.steel()), 0, L / 2 - 0.004, 0)
		return group(strip, wet, clip)
	})
	let paperN = null
	function L_paperNormal() {
		return (paperN ??= L.bake("fl-paper1", 256, 256, (u, v, o) => {
			o.r = o.g = o.b = 255
			o.h = 0.5 + 0.3 * (L.pfbm(u, v, 12, 12, 961, 4) - 0.5)
			o.rough = 0.95
		}, { normal: 0.8, blur: 1 }).normalMap)
	}
	addModel("soap-drop", "dropper", (ctx) => {
		// a glass dropper of green dish soap with a red rubber bulb, its tip at the item's anchor (the part's bottom)
		const L = ctx.h
		const r = ctx.w / 2
		const glass = pane("#eef6f4", 0.3)
		const barrel = mesh(kit.geo(`fl-pip|${f5(r)}|${f5(L)}`, () => new T.CylinderGeometry(r, r, L * 0.7, 24, 1, true)), glass, { cast: false })
		barrel.position.y = -L / 2 + L * 0.15 + L * 0.35
		const tip = mesh(kit.geo(`fl-piptip|${f5(r)}|${f5(L)}`, () => new T.CylinderGeometry(r, r * 0.3, L * 0.15, 24, 1, true)), glass, { cast: false })
		tip.position.y = -L / 2 + L * 0.075
		const soap = M("fl-soapliq", { color: "#3fae4e", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.8, depthWrite: false, clearcoat: 1 })
		const liq = mesh(kit.geo(`fl-pipliq|${f5(r)}|${f5(L)}`, () => new T.CylinderGeometry(r * 0.85, r * 0.85, L * 0.35, 20, 1)), soap, { cast: false })
		liq.position.y = -L / 2 + L * 0.15 + L * 0.175
		liq.renderOrder = 2
		const bulb = mesh(kit.geo(`fl-bulb|${f5(r)}`, () => new T.SphereGeometry(r * 1.5, 24, 16).scale(1, 1.4, 1)), M("fl-bulb", { color: "#c0392b", roughness: 0.55, metalness: 0, clearcoat: 0.2 }))
		bulb.position.y = L / 2 + r * 0.6
		return group(barrel, tip, liq, bulb)
	})
	// the drop of soap falling from its dropper, and the soap's film spreading over the water from where it lands
	addViewPlugin({
		name: "fluids:soap",
		load(ctx) {
			const recs = (ctx.doc?.processes ?? []).filter((p) => p.kind === "soap")
			if (!recs.length) return null
			const drops = recs.map((r) => {
				const drop = new T.Mesh(kit.sphere(0.0022, 16, 12), M("fl-soapdrop", { color: "#3fae4e", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85, clearcoat: 1 }))
				const liquid = (ctx.doc.processes ?? []).find((p) => p.kind === "liquid" && r.x >= p.x0 && r.x <= p.x1)
				const depth = liquid ? Math.max(0.01, liquid.area / Math.max(1e-6, liquid.x1 - liquid.x0) - 0.004) : 0.1
				const film = new T.Mesh(kit.box(1, 0.0008, depth, 0.0001), M("fl-soapfilm", { color: "#f2fbe8", roughness: 0.15, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.3 }))
				film.visible = false
				film.renderOrder = 3
				ctx.group.add(drop, film)
				return { r, drop, film, liquid }
			})
			return {
				frame(t) {
					for (const D of drops) {
						const landed = (ctx.stateAt(D.r.item, "landed", t) ?? 0) >= 0.5
						const fall = Math.max(0, t - D.r.at)
						D.drop.visible = !landed
						D.drop.position.set(D.r.x, D.r.y - 0.0025 - 0.5 * 9.81 * fall * fall, 0)
						const R = (ctx.stateAt(D.r.item, "spread_cm", t) ?? 0) / 100
						const y = ctx.stateAt(D.r.item, "surface_y", t)
						if (!landed || !(R > 0.002) || !Number.isFinite(y)) {
							D.film.visible = false
							continue
						}
						const x0 = D.liquid ? Math.max(D.liquid.x0, D.r.x - R) : D.r.x - R
						const x1 = D.liquid ? Math.min(D.liquid.x1, D.r.x + R) : D.r.x + R
						D.film.visible = x1 > x0
						D.film.scale.x = Math.max(1e-4, x1 - x0)
						D.film.position.set((x0 + x1) / 2, y + 0.0004, 0)
					}
				},
				dispose() {}
			}
		}
	})
	// a lab stand behind a tube, a strip or a dropper held over the liquid (render only): a rod from the table, an arm, a clamp at its top
	addViewPlugin({
		name: "fluids:clamps",
		load(ctx) {
			const doc = ctx.doc
			const held = (doc?.solids ?? []).filter((s) => ["capillary-tube", "paper-strip", "soap-drop"].includes(s.itemType) && ["tube", "strip", "dropper"].includes(s.part))
			if (!held.length) return null
			const top = doc.solids.find((s) => s.itemType === "table" && s.part === "top")
			const tableTop = top ? top.at.y + top.body.height / 2 : 0
			const steel = kit.steel()
			const iron = M("fl-standfoot", { color: "#2b2e33", roughness: 0.55, metalness: 0.6 })
			const liquids = (doc.processes ?? []).filter((p) => p.kind === "liquid")
			for (const s of held) {
				const y = s.at.y + s.body.height / 2 - 0.01
				// (the rod stands on the table behind the container it hangs over, never in its liquid: its front-to-back size from its liquid's)
				const over = liquids.find((p) => s.at.x >= p.x0 - 0.01 && s.at.x <= p.x1 + 0.01)
				const back = over ? over.area / Math.max(1e-6, over.x1 - over.x0) / 2 + 0.02 : 0.06
				const zr = -(back + 0.03)
				if (!(y - tableTop > 0.02)) continue
				const rod = mesh(kit.cylinderY(0.005, y + 0.03 - tableTop, 16), steel)
				rod.position.set(s.at.x, tableTop + (y + 0.03 - tableTop) / 2, zr)
				const foot = mesh(kit.box(0.09, 0.01, 0.16, 0.003), iron)
				foot.position.set(s.at.x, tableTop + 0.005, zr - 0.06)
				const arm = mesh(kit.cylinderZ(0.003, -zr, 12), steel)
				arm.position.set(s.at.x, y, zr / 2)
				const jaw = mesh(kit.box(0.014, 0.01, 0.012, 0.002), iron)
				jaw.position.set(s.at.x, y, -s.body.depth / 2 - 0.006)
				ctx.group.add(rod, foot, arm, jaw)
			}
			return { frame() {}, dispose() {} }
		}
	})

	// ------------------------------------------------------------- the breeze's wind sock
	addModel("breeze", "pole", (ctx) => group(mesh(kit.cylinderY(0.005, ctx.h, 16), kit.steel())))
	addModel("breeze", "base", (ctx) => {
		const P = ctx.props
		const speed = P.speed ?? 3
		const dir = P.direction === "to the left" ? -1 : 1
		const base = mesh(kit.geo("fl-sockbase", () => new T.CylinderGeometry(0.06, 0.06, 0.012, 32)), kit.steel())
		// the sock at the pole's top: a striped cone, lifted from hanging down (no wind) to straight out (10 m/s and more)
		const lift = clamp(speed / 10, 0, 1) * (Math.PI / 2) * 0.95
		const sock = mesh(kit.geo("fl-sock", () => new T.CylinderGeometry(0.035, 0.018, 0.22, 24, 5, true).translate(0, -0.11, 0)), M("fl-sock", {
			map: kit.tex("fl-sockstripes", 64, 256, (g, W, H) => {
				for (let i = 0; i < 5; i++) {
					g.fillStyle = i % 2 ? "#f4f4f0" : "#e8572a"
					g.fillRect(0, (i * H) / 5, W, H / 5)
				}
			}),
			roughness: 0.85, metalness: 0, side: T.DoubleSide
		}))
		sock.rotation.z = dir * lift
		sock.position.set(0, 0.506, 0) // the pole's top, in the stand's frame (its foot's middle is 6 mm up)
		const ring = mesh(kit.torus(0.035, 0.002, 8, 32), kit.steel())
		ring.rotation.x = Math.PI / 2
		ring.position.copy(sock.position)
		return group(base, sock, ring)
	})
}
