// 3D models and view hooks of the heat module (machines/mod_heat.py): salt piles, plates and bowls, a desk lamp (with a real spot light), glass
// and digital thermometers (their column or display shows the reading every frame), a hot plate (its top glows when hot), a saucepan and cups of
// water (the water's level follows the run; bubbles while it boils, steam over hot water, dew on a cold glass), spoons, butter, chocolate or wax
// pieces and puddles; and two view plugins: melt-water puddles under melting ice cubes and dabs, and the time-lapse clock.
// Frames (web/models3d.js): a slab is centred on its own origin; a polygon's origin is where the builder put it (the item's anchor here).
// A melting body's mesh is scaled by the view already (placements carry `scale`). Every hook is a pure function of the run's time t (bubbles and
// steam from fixed hashes), so an exported frame is the same whatever was drawn before it.
import { makeLib } from "./surfaces-lib.js"

const COLORS = { white: "#f2f0ea", blue: "#3f6fc2", red: "#c8443a", green: "#4f9a5a", yellow: "#e8c13a", black: "#2a2a2a", grey: "#9aa0a6", orange: "#e8823a", pink: "#e58fae", brown: "#7a5236" }
const fin = (v) => typeof v === "number" && Number.isFinite(v)
/** A number from 0 to 1 that depends only on i (and a salt): the bubbles' and the steam's places. */
const hash = (i, s = 0) => {
	let x = Math.imul((i + 1) * 374761393 + s * 668265263, 1274126177) >>> 0
	x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0
	return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}
/** Lesson time as the clock shows it: 0:45, 12:30, 1:05:00 (h:min:s). */
export function lessonClock(s) {
	const S = Math.max(0, Math.floor(s))
	const h = Math.floor(S / 3600)
	const m = Math.floor((S - 3600 * h) / 60)
	const r = S - 3600 * h - 60 * m
	const two = (n) => `${n < 10 ? "0" : ""}${n}`
	return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`
}

export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const T = THREE
	const { M, mesh, put, bake } = L
	const group = (...c) => kit.group(...c)
	const f5 = (v) => Number(v).toFixed(5)

	// ------------------------------------------------------------- materials
	const glazed = (hex) => M(`heat-glaze|${hex}`, { color: hex, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 })
	/** A bowl's glaze: satin, its clear coat softened. A mirror glaze on a bowl's curved far wall drew the room's light as one sharp upright
	 *  streak, right above what sat in the bowl, that read as steam; a satin glaze spreads it into a soft sheen. */
	const satinGlazed = (hex) => M(`heat-glaze-satin|${hex}`, { color: hex, roughness: 0.38, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.42, envMapIntensity: 0.9 })
	const stainless = () => M("heat-stainless", { color: "#dfe3e8", metalness: 1, roughness: 0.17, envMapIntensity: 1.3 })
	const brushedAlu = () => M("heat-alu", { color: "#d4d8dd", metalness: 1, roughness: 0.32, envMapIntensity: 1.1 })
	const copperMat = () => M("heat-copper", { color: "#c9774a", metalness: 1, roughness: 0.28, envMapIntensity: 1.2 })
	const enamel = () => M("heat-enamel", { color: "#26282b", roughness: 0.38, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.2 })
	const whiteEnamel = () => M("heat-white-enamel", { color: "#f4f2ec", roughness: 0.3, metalness: 0, clearcoat: 0.4 })
	const plastic = (hex, gloss = 0.4) => L.plasticMat(hex, gloss)
	const glassClear = () => L.glassMat("#ffffff", { thickness: 0.003, attenuation: "#eaf6f2", dist: 0.6 })
	const waterMat = (thickness) =>
		thickness < 0.004
			? M(`heat-film|${f5(thickness)}`, { color: "#ffffff", roughness: 0.04, metalness: 0, transmission: 1, thickness, ior: 1.333, attenuationColor: new T.Color("#eef7fb"), attenuationDistance: 5, specularIntensity: 0.7, envMapIntensity: 0.45, transparent: true, opacity: 0.9 })
			: M(`heat-water|${f5(thickness)}`, { color: "#f4fbff", roughness: 0.03, metalness: 0, transmission: 1, thickness, ior: 1.333, attenuationColor: new T.Color("#8cc4e4"), attenuationDistance: 1.2, specularIntensity: 1, envMapIntensity: 1.1 })
	const foamCup = () => L.foamMat("#f6f5f0")
	const paperMat = (hex) => M(`heat-paper|${hex}`, { color: hex, roughness: 0.82, metalness: 0 })
	/** Salt: white, rough, with sharp little glints (a fine bumpy normal map). */
	function saltMat() {
		const maps = bake("heat-salt-grain", 256, 256, (u, v, o) => {
			const n = L.pfbm(u, v, 48, 48, 731, 2)
			o.r = o.g = o.b = 248 - 26 * Math.max(0, n - 0.55)
			o.h = n
			o.rough = 0.55 + 0.3 * n
		}, { normal: 2.2, orm: true, blur: 0 })
		return M("heat-salt", { color: "#ffffff", roughness: 0.7, metalness: 0, normalMap: maps.normalMap, normalScale: L.V2(1.2), map: maps.map, clearcoat: 0.35, clearcoatRoughness: 0.15, envMapIntensity: 1.3 })
	}

	// ------------------------------------------------------------- salt pile: a cone at salt's angle of repose (its outline: a triangle)
	addModel("salt-pile", "pile", (ctx) => {
		const pts = ctx.body?.points ?? []
		const r = Math.max(...pts.map((p) => p.x))
		const h = Math.max(...pts.map((p) => p.y))
		// a cone with a softly rounded top and a little skirt of grains at the foot
		const prof = [[0, 0], [r, 0], [r * 0.985, h * 0.03], [r * 0.6, h * 0.42], [r * 0.18, h * 0.86], [r * 0.06, h * 0.97], [0, h]]
		return mesh(kit.lathe(prof, 48, `heat-salt|${f5(r)}|${f5(h)}`), saltMat())
	})

	// ------------------------------------------------------------- plates and bowls: one lathe on the base part (the rims and walls draw nothing)
	const dishLook = (P, bowl = false) => {
		const mat = P.material ?? "ceramic"
		if (mat === "aluminium") return brushedAlu()
		if (mat === "glass") return L.glassMat("#ffffff", { thickness: 0.005, attenuation: "#dcefe8", dist: 0.5 })
		if (mat === "foam") return L.foamMat(COLORS[P.color] ?? COLORS.white)
		if (mat === "paperboard") return paperMat(COLORS[P.color] ?? COLORS.white)
		if (mat === "melamine") return plastic(COLORS[P.color] ?? COLORS.white, 0.6)
		return bowl ? satinGlazed(COLORS[P.color] ?? COLORS.white) : glazed(COLORS[P.color] ?? COLORS.white)
	}
	const THICK = { ceramic: 0.005, glass: 0.005, melamine: 0.003, aluminium: 0.001, foam: 0.002, paperboard: 0.0012 }
	addModel("plate", "base", (ctx) => {
		const P = ctx.props ?? {}
		const D = P.diameter ?? 0.27
		const t = THICK[P.material ?? "ceramic"] ?? 0.005
		const well = 0.62 * D
		const rise = (0.02 * D) / 0.27
		const y = (v) => v - t / 2 // (the base solid's middle is t/2 above the plate's foot)
		const prof = [[0, y(0)], [well / 2, y(0)], [D / 2 - 0.004, y(rise)], [D / 2, y(rise + t * 0.6)], [D / 2 - 0.002, y(rise + t)], [well / 2 - 0.003, y(t)], [0, y(t)]]
		return mesh(L.lathe(`heat-plate|${f5(D)}|${f5(t)}`, prof, { seg: 96, tile: 0.2, crease: 1.2 }), dishLook(P))
	})
	for (const part of ["rim-left", "rim-right"]) addModel("plate", part, null)
	addModel("bowl", "base", (ctx) => {
		const P = ctx.props ?? {}
		const D = P.diameter ?? 0.15
		const H = P.height ?? 0.065
		const t = THICK[P.material ?? "ceramic"] ?? 0.005
		const b = 0.55 * D
		const y = (v) => v - t / 2
		const prof = [[0, y(0)], [b / 2, y(0)], [b / 2 + (D / 2 - b / 2) * 0.35, y(H * 0.3)], [D / 2, y(H)], [D / 2 - t * 0.5, y(H + t * 0.4)], [D / 2 - t, y(H)], [b / 2 - t + (D / 2 - b / 2) * 0.35, y(H * 0.3 + t * 0.4)], [b / 2 - t, y(t)], [0, y(t)]]
		const dish = mesh(L.lathe(`heat-bowl|${f5(D)}|${f5(H)}|${f5(t)}`, prof, { seg: 96, tile: 0.2, crease: 1.2 }), dishLook(P, true))
		// (water in it when it holds some: its level follows the run's "level"; liquid a pitcher pours in is drawn by the flow module)
		if (P.contents !== "water") return dish
		return group(dish, waterBody(b / 2 - t - 0.0004, D / 2 - t - 0.0006, H - t, y(t), "level"))
	})
	for (const part of ["wall-left", "wall-right"]) addModel("bowl", part, null)

	// ------------------------------------------------------------- desk lamp: base, arm, shade and bulb (the spot light is the plugin below)
	addModel("lamp", "base", () => {
		const g = group()
		g.add(put(mesh(kit.cylinderY(0.075, 0.022, 64, 0.07), enamel()), 0, -0.0015, 0))
		g.add(put(mesh(kit.cylinderY(0.016, 0.008, 32), M("heat-lamp-switch", { color: "#b8bcc2", metalness: 1, roughness: 0.25 })), 0.045, 0.013, 0.03))
		return g
	})
	addModel("lamp", "arm", (ctx) => {
		const p = ctx.body?.points ?? []
		if (p.length < 4) return null
		const a = { x: (p[0].x + p[3].x) / 2, y: (p[0].y + p[3].y) / 2 }
		const b = { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 }
		const g = group()
		const len = Math.hypot(b.x - a.x, b.y - a.y)
		const rod = mesh(kit.cylinderY(0.006, len, 24), stainless())
		rod.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0)
		rod.rotation.z = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2
		g.add(rod)
		for (const q of [a, b]) g.add(put(mesh(kit.sphere(0.009, 24, 12), enamel()), q.x, q.y, 0))
		return g
	})
	addModel("lamp", "shade", (ctx) => {
		const p = ctx.body?.points ?? []
		if (p.length < 4) return null
		const back = { x: (p[0].x + p[3].x) / 2, y: (p[0].y + p[3].y) / 2 }
		const mouth = { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 }
		const len = Math.hypot(mouth.x - back.x, mouth.y - back.y)
		const g = group()
		// a cone open at its mouth: dark enamel outside, white inside; the bulb in it
		const outer = mesh(kit.lathe([[0.026, 0], [0.03, 0.004], [0.065, len], [0.0655, len]], 64, `heat-shade-o|${f5(len)}`), enamel())
		const innerMat = M("heat-shade-in", { color: "#f7f3ea", roughness: 0.35, metalness: 0, side: T.BackSide })
		const inner = mesh(kit.lathe([[0.025, 0.002], [0.0635, len - 0.0005]], 64, `heat-shade-i|${f5(len)}`), innerMat, { cast: false })
		const cap = mesh(kit.cylinderY(0.027, 0.006, 32), enamel())
		cap.position.y = 0.001
		const bulb = mesh(kit.sphere(0.024, 32, 16), M("heat-bulb-off", { color: "#f6f2e6", roughness: 0.15, metalness: 0, transmission: 0.3, thickness: 0.002 }), { cast: false })
		bulb.position.y = 0.05
		bulb.scale.set(1, 1.15, 1)
		bulb.userData.frame = { hook: "heat:bulb", scaled: false }
		const holder = group(outer, inner, cap, bulb)
		holder.position.set(back.x, back.y, 0)
		holder.rotation.z = Math.atan2(mouth.y - back.y, mouth.x - back.x) - Math.PI / 2
		g.add(holder)
		return g
	})
	addFrameHook("heat:bulb", (obj, f) => {
		const on = (f.state?.on ?? 0) > 0.5
		if (obj.userData._on === on) return
		obj.userData._on = on
		const m = ownMaterial(obj)
		m.emissive = new T.Color(on ? "#ffd59a" : "#000000")
		m.emissiveIntensity = on ? 3.5 : 0
		m.toneMapped = !on
		m.needsUpdate = true
	})

	// ------------------------------------------------------------- thermometers
	/** A glass thermometer's scale: ticks every 2 °C, numbers every 10 °C, −10 to 110 °C, on a white strip. */
	function scaleMat(units) {
		return kit.printed(`heat-thermo-scale|${units}`, (g, W, H) => {
			g.fillStyle = "#fbfbf7"
			g.fillRect(0, 0, W, H)
			g.strokeStyle = "#202020"
			g.fillStyle = "#202020"
			const y = (c) => H - ((c + 10) / 120) * H
			for (let c = -10; c <= 110; c += 2) {
				g.lineWidth = c % 10 === 0 ? 5 : 2.5
				g.beginPath()
				g.moveTo(0, y(c))
				g.lineTo(c % 10 === 0 ? W * 0.45 : W * 0.25, y(c))
				g.stroke()
				if (c % 10 === 0 && c > -10 && c < 110) {
					g.font = `700 ${Math.round(W * 0.34)}px system-ui, sans-serif`
					g.textAlign = "right"
					g.textBaseline = "middle"
					const label = units === "F" ? Math.round((c * 9) / 5 + 32) : c
					g.fillText(String(label), W * 0.97, y(c))
				}
			}
		}, { w: 128, h: 2048, roughness: 0.6 })
	}
	addModel("thermometer", "stem", (ctx) => {
		const P = ctx.props ?? {}
		const g = group()
		const len = ctx.h ?? 0.3
		// the glass rod (rounded ends), its bulb at the bottom, the red alcohol column and the scale strip behind it
		const rod = mesh(kit.lathe([[0, -len / 2 + 0.012], [0.0034, -len / 2 + 0.014], [0.0035, len / 2 - 0.003], [0.0025, len / 2 - 0.0005], [0, len / 2]], 32, `heat-thermo-rod|${f5(len)}`), glassClear(), { cast: false })
		const bulbGlass = put(mesh(kit.sphere(0.0034, 32, 16), glassClear(), { cast: false }), 0, -len / 2 + 0.006, 0)
		bulbGlass.scale.set(1, 1.9, 1)
		const red = M("heat-alcohol", { color: "#d8212a", roughness: 0.25, metalness: 0, emissive: new T.Color("#3a0204"), emissiveIntensity: 0.3 })
		const bulb = put(mesh(kit.sphere(0.0026, 24, 12), red, { cast: false }), 0, -len / 2 + 0.006, 0)
		bulb.scale.set(1, 1.9, 1)
		const span = len - 0.045
		const column = mesh(kit.geo("heat-thermo-col", () => new T.CylinderGeometry(0.0008, 0.0008, 1, 12).translate(0, 0.5, 0)), red, { cast: false })
		column.position.set(0, -len / 2 + 0.011, 0)
		column.userData.frame = { hook: "heat:column", base: 0.0, span, scaled: false }
		const strip = put(mesh(kit.geo(`heat-thermo-strip|${f5(span)}`, () => new T.PlaneGeometry(0.0055, span)), scaleMat(P.units === "F" ? "F" : "C"), { cast: false }), 0.0005, -len / 2 + 0.02 + span / 2, -0.0014)
		g.add(rod, bulbGlass, bulb, column, strip)
		return g
	})
	addFrameHook("heat:column", (obj, f, a) => {
		const c = fin(f.state?.reading) ? f.state.reading : 20
		// the column reaches the scale's mark for the reading (−10 °C at the bottom of the strip, 110 °C at its top), never below the bulb's neck
		const h = 0.009 + Math.max(0, Math.min(1, (c + 10) / 120)) * a.span
		obj.scale.y = h
	})
	addModel("thermometer", "probe", (ctx) => {
		const len = ctx.h ?? 0.12
		const g = group()
		g.add(mesh(kit.lathe([[0, -len / 2], [0.0012, -len / 2 + 0.003], [0.00175, -len / 2 + 0.01], [0.00175, len / 2]], 24, `heat-probe|${f5(len)}`), stainless()))
		return g
	})
	addModel("thermometer", "display", (ctx) => {
		const g = group()
		const body = mesh(kit.box(0.05, 0.08, 0.02, 0.006), plastic("#f1f1ec", 0.5))
		const bezel = put(mesh(kit.box(0.04, 0.03, 0.002, 0.002), M("heat-bezel", { color: "#2e3134", roughness: 0.4 })), 0, 0.015, 0.0101)
		const lcd = put(mesh(kit.geo("heat-lcd-plane", () => new T.PlaneGeometry(0.036, 0.026)), M("heat-lcd", { color: "#ffffff", roughness: 0.35, metalness: 0, clearcoat: 0.6 }), { cast: false }), 0, 0.015, 0.0113)
		lcd.userData.frame = { hook: "heat:lcd", units: (ctx.props ?? {}).units === "F" ? "F" : "C", scaled: false }
		const btn = put(mesh(kit.cylinderZ(0.006, 0.003, 24), plastic("#d23b2f", 0.6)), 0, -0.02, 0.0105)
		g.add(body, bezel, lcd, btn)
		return g
	})
	addFrameHook("heat:lcd", (obj, f, a) => {
		const sc = screenOf(obj, 384, 280)
		const c = fin(f.state?.reading) ? f.state.reading : null
		const units = a.units ?? "C"
		const v = c === null ? "--.-" : (units === "F" ? (c * 9) / 5 + 32 : c).toFixed(1)
		if (sc.shown === v) return
		sc.shown = v
		const { g, W, H } = sc
		const grd = g.createLinearGradient(0, 0, 0, H)
		grd.addColorStop(0, "#cfdbc9")
		grd.addColorStop(1, "#b5c4ae")
		g.fillStyle = grd
		g.fillRect(0, 0, W, H)
		g.fillStyle = "#141a16"
		g.textAlign = "right"
		g.textBaseline = "middle"
		// the digits fill the window to the left of the unit, whatever their count ("-5.0" or "100.0")
		let size = Math.round(H * 0.5)
		g.font = `700 ${size}px ui-monospace, Menlo, monospace`
		const room = W * 0.74
		const wide = g.measureText(v).width
		if (wide > room) {
			size = Math.floor((size * room) / wide)
			g.font = `700 ${size}px ui-monospace, Menlo, monospace`
		}
		g.fillText(v, W * 0.79, H * 0.52)
		g.font = `700 ${Math.round(H * 0.22)}px system-ui, sans-serif`
		g.fillText(`°${units}`, W * 0.97, H * 0.35)
		sc.tex.needsUpdate = true
	})
	/** A per-instance canvas texture on a mesh's own material (made on the first frame). */
	function screenOf(obj, W, H) {
		if (!obj.userData._screen) {
			const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H })
			const tex = new T.CanvasTexture(canvas)
			tex.colorSpace = T.SRGBColorSpace
			tex.anisotropy = 8
			const m = ownMaterial(obj)
			m.map = tex
			m.needsUpdate = true
			obj.userData._screen = { canvas, tex, g: canvas.getContext("2d"), shown: null, W, H }
		}
		return obj.userData._screen
	}

	// ------------------------------------------------------------- hot plate: an enamel body with a knob and a pilot light; its top glows when hot
	addModel("hot-plate", "body", () => {
		const g = group()
		g.add(mesh(kit.box(0.2, 0.08, 0.2, 0.006), enamel()))
		const knob = put(mesh(kit.cylinderZ(0.014, 0.012, 32), plastic("#1a1b1d", 0.5)), 0.05, -0.01, 0.106)
		const tick = put(mesh(kit.box(0.002, 0.009, 0.002), whiteEnamel()), 0.05, -0.002, 0.1125)
		const pilot = put(mesh(kit.sphere(0.004, 16, 8), M("heat-pilot", { color: "#401a08", roughness: 0.3 }), { cast: false }), -0.05, -0.01, 0.1)
		pilot.userData.frame = { hook: "heat:pilot", scaled: false }
		const label = put(mesh(kit.geo("heat-hp-label", () => new T.PlaneGeometry(0.06, 0.014)), kit.printed("heat-hp-label", (c, W, H) => {
			c.fillStyle = "#2a2c2f"
			c.fillRect(0, 0, W, H)
			c.fillStyle = "#e8e8e2"
			c.font = `700 ${Math.round(H * 0.62)}px system-ui, sans-serif`
			c.textAlign = "center"
			c.textBaseline = "middle"
			c.fillText("HOT PLATE", W / 2, H / 2)
		}, { w: 512, h: 120 }), { cast: false }), 0, 0.022, 0.1005)
		g.add(knob, tick, pilot, label)
		return g
	})
	addFrameHook("heat:pilot", (obj, f) => {
		const on = (f.state?.power ?? 0) > 0
		if (obj.userData._on === on) return
		obj.userData._on = on
		const m = ownMaterial(obj)
		m.emissive = new T.Color(on ? "#ff7a1a" : "#000000")
		m.emissiveIntensity = on ? 2.5 : 0
		m.needsUpdate = true
	})
	addModel("hot-plate", "top", () => {
		const g = group()
		const plate = mesh(kit.box(0.18, 0.006, 0.18, 0.0015), M("heat-hp-top", { color: "#c9cdd2", metalness: 1, roughness: 0.38, emissive: new T.Color("#000000") }))
		plate.userData.frame = { hook: "heat:glow", scaled: false }
		// a coiled burner ring pattern under the surface shows as darker circles
		const ring = put(mesh(kit.torus(0.055, 0.0012, 8, 64), M("heat-hp-ring", { color: "#8b9096", metalness: 1, roughness: 0.5 }), { cast: false }), 0, 0.0031, 0)
		ring.rotation.x = Math.PI / 2
		g.add(plate, ring)
		return g
	})
	/** The colour a hot surface glows (dull red from about 500 °C, the Draper point; orange by 900 °C), and how strongly. */
	const glowOf = (c) => {
		const k = Math.max(0, Math.min(1, (c - 450) / 400))
		return { k, color: new T.Color().setRGB(1, 0.18 + 0.35 * k, 0.04 + 0.1 * k) }
	}
	addFrameHook("heat:glow", (obj, f) => {
		const c = fin(f.state?.temp) ? f.state.temp : 20
		const { k, color } = glowOf(c)
		const key = Math.round(k * 50)
		if (obj.userData._glow === key) return
		obj.userData._glow = key
		const m = ownMaterial(obj)
		m.emissive = k > 0 ? color : new T.Color("#000000")
		m.emissiveIntensity = 3 * k * k
		m.needsUpdate = true
	})

	// ------------------------------------------------------------- saucepans and cups: a lathe vessel on the floor part, its water following the level
	/** The water in a vessel: a frustum whose top ring follows the level each frame (its own geometry, so each cup's water is its own). */
	function waterBody(rBottom, rTop, Hfull, y0, key) {
		const seg = 48
		const geo = new T.CylinderGeometry(rTop, rBottom, 1, seg, 1, false)
		geo.translate(0, 0.5, 0)
		const m = mesh(geo, waterMat(Math.max(0.02, rBottom)), { cast: false })
		m.position.y = y0
		m.userData.frame = { hook: "heat:water", key, rb: rBottom, rt: rTop, H: Hfull, y0, scaled: false }
		m.userData.ownGeometry = true
		m.renderOrder = 1
		return m
	}
	addFrameHook("heat:water", (obj, f, a) => {
		const level = fin(f.state?.[a.key]) ? f.state[a.key] : 0
		const lv = Math.max(0, Math.min(a.H, level))
		const key = Math.round(lv * 20000)
		if (obj.userData._lv === key) return
		obj.userData._lv = key
		obj.visible = lv > 0.0004
		if (!obj.visible) return
		// (a geometry of its own, made on the first frame: the model's is shared by every clone; its first positions kept)
		if (!obj.userData._orig) {
			obj.geometry = obj.geometry.clone()
			obj.userData._orig = obj.geometry.attributes.position.array.slice()
		}
		const o = obj.userData._orig
		const k = (a.rb + ((a.rt - a.rb) * lv) / a.H) / a.rt
		const pos = obj.geometry.attributes.position
		for (let i = 0; i < pos.count; i++) {
			// the top ring and cap (first made at height 1): at the level, as wide as the vessel is there
			if (o[3 * i + 1] > 0.5) pos.setXYZ(i, o[3 * i] * k, lv, o[3 * i + 2] * k)
		}
		pos.needsUpdate = true
		obj.geometry.computeBoundingSphere()
	})
	/** Bubbles rising in boiling water (shown while the run says it boils) and steam over hot water: fixed hashes and t, nothing random. */
	function boilAndSteam(rIn, y0, key) {
		const g = group()
		const N = 28
		const bubbleMat = M("heat-bubble", { color: "#ffffff", roughness: 0.05, metalness: 0, transmission: 0.9, thickness: 0.002, ior: 1.0, transparent: true, opacity: 0.7 })
		const geo = kit.sphere(1, 12, 8)
		const bubbles = new T.InstancedMesh(geo, bubbleMat, N)
		bubbles.castShadow = false
		bubbles.userData.frame = { hook: "heat:bubbles", rIn, y0, key, N, scaled: false }
		bubbles.frustumCulled = false
		bubbles.count = 0
		const steamMat = M("heat-steam", { color: "#ffffff", roughness: 1, metalness: 0, transparent: true, opacity: 0.0, depthWrite: false, map: steamTex() })
		const steam = group()
		for (let i = 0; i < 6; i++) {
			const p = mesh(kit.geo("heat-steam-plane", () => new T.PlaneGeometry(1, 1)), steamMat, { cast: false })
			p.userData.i = i
			steam.add(p)
		}
		steam.userData.frame = { hook: "heat:steam", rIn, y0, key, scaled: false }
		g.add(bubbles, steam)
		return g
	}
	function steamTex() {
		return kit.tex("heat-steam-puff", 128, 128, (c, W, H) => {
			const grd = c.createRadialGradient(W / 2, H / 2, 2, W / 2, H / 2, W / 2)
			grd.addColorStop(0, "rgba(255,255,255,0.55)")
			grd.addColorStop(0.5, "rgba(255,255,255,0.18)")
			grd.addColorStop(1, "rgba(255,255,255,0)")
			c.fillStyle = grd
			c.fillRect(0, 0, W, H)
		})
	}
	const dummy = new T.Object3D()
	addFrameHook("heat:bubbles", (obj, f, a) => {
		const boiling = (f.state?.boiling ?? 0) > 0.5
		const level = fin(f.state?.level) ? f.state.level : 0
		if (!boiling || level < 0.003) {
			if (obj.count !== 0) obj.count = 0
			return
		}
		obj.count = a.N
		for (let i = 0; i < a.N; i++) {
			// each bubble rises from a fixed spot on the floor at 0.25 m/s, starting at its own phase
			const r = a.rIn * 0.85 * Math.sqrt(hash(i, 1))
			const th = 6.2832 * hash(i, 2)
			const phase = (f.t * 0.25 + hash(i, 3)) % 1
			const y = a.y0 + phase * level
			const size = 0.0015 + 0.0025 * phase * hash(i, 4)
			dummy.position.set(r * Math.cos(th), y, r * Math.sin(th))
			dummy.scale.setScalar(size)
			dummy.updateMatrix()
			obj.setMatrixAt(i, dummy.matrix)
		}
		obj.instanceMatrix.needsUpdate = true
	})
	addFrameHook("heat:steam", (obj, f, a) => {
		const c = fin(f.state?.water_temp) ? f.state.water_temp : 20
		const level = fin(f.state?.level) ? f.state.level : 0
		const k = level > 0.002 ? Math.max(0, Math.min(1, (c - 55) / 45)) : 0
		obj.visible = k > 0.02
		if (!obj.visible) return
		for (const p of obj.children) {
			// puffs drift up from the surface and fade, each on its own cycle (2.5 s), facing the camera roughly (the view's camera looks along −z)
			const i = p.userData.i
			const u = (f.t / 2.5 + hash(i, 7)) % 1
			p.position.set((hash(i, 8) - 0.5) * a.rIn, a.y0 + level + 0.01 + u * 0.12, (hash(i, 9) - 0.5) * a.rIn * 0.5)
			const s = 0.03 + 0.06 * u
			p.scale.set(s, s, 1)
			const m = ownMaterial(p)
			m.opacity = k * 0.8 * Math.sin(Math.PI * u)
		}
	})
	/** Dew on a cold cup: a droplet film just outside its wall, as visible as the dew on it (wet_g over its area). */
	function dewFilm(rBottom, rTop, H, y0) {
		const tex = bake("heat-dew-drops", 256, 256, (u, v, o) => {
			// droplets: bright round domes at hashed cells
			const cx = Math.floor(u * 24)
			const cy = Math.floor(v * 24)
			let h = 0
			for (let dx = -1; dx <= 1; dx++)
				for (let dy = -1; dy <= 1; dy++) {
					const i = ((cx + dx + 24) % 24) * 31 + ((cy + dy + 24) % 24)
					const px = (cx + dx + hash(i, 11)) / 24
					const py = (cy + dy + hash(i, 12)) / 24
					const rr = (0.25 + 0.5 * hash(i, 13)) / 24
					const d = Math.hypot(u - px, v - py) / rr
					if (d < 1) h = Math.max(h, Math.sqrt(1 - d * d))
				}
			o.r = o.g = o.b = 255
			o.h = h
			o.a = h > 0 ? 255 : 0
			o.rough = 0.05
		}, { normal: 3, blur: 0 })
		const m = M(`heat-dew|${f5(rTop)}`, { color: "#ffffff", roughness: 0.05, metalness: 0, transparent: true, opacity: 0, depthWrite: false, normalMap: tex.normalMap, normalScale: L.V2(1.5), alphaMap: tex.map, clearcoat: 1, envMapIntensity: 1.4 })
		const film = mesh(kit.lathe([[rBottom + 0.0006, y0], [rTop + 0.0006, y0 + H]], 64, `heat-dewfilm|${f5(rBottom)}|${f5(rTop)}|${f5(H)}`), m, { cast: false })
		film.userData.frame = { hook: "heat:dew", area: Math.PI * (rBottom + rTop) * H, scaled: false }
		film.visible = false
		return film
	}
	addFrameHook("heat:dew", (obj, f, a) => {
		const wet = fin(f.state?.wet_g) ? f.state.wet_g / 1000 : 0
		const k = Math.max(0, Math.min(1, wet / (a.area * 0.03)))
		const key = Math.round(k * 40)
		if (obj.userData._k === key) return
		obj.userData._k = key
		obj.visible = k > 0.01
		const m = ownMaterial(obj)
		m.opacity = 0.9 * k
	})

	/** A round vessel in its floor's frame (the floor slab's middle is its origin, t thick): walls, floor, water, bubbles and steam, dew, a lid. */
	function vessel({ top, bottom, H, t, wall, material, waterKey = "level", handle = null, lid = false, lidMat = null, rim = null }) {
		const g = group()
		const y0 = -t / 2
		const ri0 = bottom / 2
		const ri1 = top / 2
		const ro0 = ri0 + wall
		const ro1 = ri1 + wall
		const prof = [[0, y0], [ro0 - 0.002, y0], [ro0, y0 + 0.002], [ro1, y0 + t + H - 0.001], [ro1 - wall * 0.3, y0 + t + H], [ri1 + wall * 0.2, y0 + t + H], [ri1, y0 + t + H - 0.001], [ri0, y0 + t], [0, y0 + t]]
		g.add(mesh(L.lathe(`heat-vessel|${f5(top)}|${f5(bottom)}|${f5(H)}|${f5(t)}|${f5(wall)}`, prof, { seg: 80, tile: 0.2, crease: 1.2 }), material))
		if (rim) g.add(put(mesh(kit.torus(ri1 + wall / 2, Math.max(0.0012, wall * 0.6), 10, 80), rim), 0, y0 + t + H, 0).rotateX(Math.PI / 2))
		g.add(waterBody(ri0 - 0.0004, ri1 - 0.0004, H, y0 + t, waterKey))
		g.add(boilAndSteam(ri0, y0 + t, waterKey))
		g.add(dewFilm(ro0, ro1, H, y0))
		if (handle === "pot") {
			const hand = mesh(kit.box(0.12, 0.012, 0.02, 0.005), M("heat-pot-handle", { color: "#1c1d1f", roughness: 0.6 }))
			hand.position.set(ro1 + 0.06, y0 + t + H - 0.01, 0)
			g.add(hand)
		}
		if (handle === "mug") {
			const tor = mesh(kit.torus(0.026, 0.0055, 16, 48, Math.PI), material)
			tor.rotation.z = -Math.PI / 2
			tor.position.set(ro1 - 0.004, y0 + t + H * 0.52, 0)
			g.add(tor)
		}
		if (lid) {
			const lidM = lidMat ?? material
			const disc = mesh(kit.cylinderY(ro1 + 0.002, 0.004, 64), lidM)
			disc.position.y = y0 + t + H + 0.002
			g.add(disc)
			const knob = mesh(kit.cylinderY(0.009, 0.012, 32), M("heat-pot-handle", {}))
			knob.position.y = y0 + t + H + 0.01
			if (handle === "pot") g.add(knob)
		}
		return g
	}
	addModel("saucepan", "floor", (ctx) => {
		const P = ctx.props ?? {}
		const D = P.diameter ?? 0.18
		const H = P.height ?? 0.1
		return vessel({ top: D, bottom: D, H, t: 0.003, wall: 0.0015, material: stainless(), handle: "pot", lid: !!P.lid, rim: stainless() })
	})
	// (a lid cut where a thermometer or spoon goes through it has more parts, lid-2 …: the floor's model draws the lid whole)
	const LID_PARTS = ["lid", "lid-2", "lid-3", "lid-4", "lid-5", "lid-6"]
	for (const part of ["wall-left", "wall-right", "handle", ...LID_PARTS]) addModel("saucepan", part, null)
	const CUPS = {
		foam: [0.085, 0.055, 0.105, 0.0025], paper: [0.085, 0.055, 0.105, 0.0008], plastic: [0.085, 0.055, 0.105, 0.0008], glass: [0.07, 0.065, 0.11, 0.003],
		steel: [0.07, 0.065, 0.11, 0.0009], mug: [0.073, 0.073, 0.088, 0.0043], flask: [0.06, 0.06, 0.18, 0.006]
	}
	const PHYS_T = { foam: 0.0025, paper: 0.002, plastic: 0.002, glass: 0.003, steel: 0.002, mug: 0.0043, flask: 0.004 }
	addModel("drink-cup", "floor", (ctx) => {
		const P = ctx.props ?? {}
		const style = P.style ?? "foam"
		const [top, bottom, H, wall] = CUPS[style] ?? CUPS.foam
		const t = PHYS_T[style] ?? 0.0025
		const color = COLORS[P.color] ?? COLORS.white
		const material =
			style === "foam" ? foamCup()
				: style === "paper" ? paperMat(color)
					: style === "plastic" ? L.glassMat(color === COLORS.white ? "#f4f6f8" : color, { thickness: 0.001, attenuation: color, dist: 0.2 })
						: style === "glass" ? L.glassMat("#ffffff", { thickness: 0.003, attenuation: "#d8eee6", dist: 0.5 })
							: style === "steel" ? stainless()
								: style === "mug" ? glazed(color)
									: stainless()
		const rim = style === "paper" ? paperMat(color) : style === "plastic" ? null : null
		return vessel({ top, bottom, H, t, wall, material, handle: style === "mug" ? "mug" : null, lid: !!P.lid, lidMat: style === "flask" ? plastic("#26282b", 0.4) : plastic("#f3f3ef", 0.3), rim })
	})
	for (const part of ["wall-left", "wall-right", "handle", ...LID_PARTS]) addModel("drink-cup", part, null)

	// ------------------------------------------------------------- spoons: a bowl at the left end, a tapering handle (inside the thin slab's outline)
	addModel("spoon", "spoon", (ctx) => {
		const P = ctx.props ?? {}
		const Lsp = ctx.w ?? 0.15
		const th = ctx.h ?? 0.002
		const wz = ctx.d ?? 0.012
		const mat = P.material ?? "stainless steel"
		const m = mat === "stainless steel" ? stainless() : mat === "aluminium" ? brushedAlu() : mat === "copper" ? copperMat() : mat === "polypropylene" ? plastic("#f4f2ec", 0.5) : kit.wood("#c99a62")
		const g = group()
		const bowlL = Lsp * 0.3
		const bowl = mesh(kit.sphere(1, 40, 20), m)
		bowl.scale.set(bowlL / 2, th / 2, Math.min(wz * 2.6, bowlL * 0.7) / 2)
		bowl.position.x = -Lsp / 2 + bowlL / 2
		const handle = mesh(kit.box(Lsp - bowlL * 0.85, th * 0.9, wz, Math.min(th, wz) * 0.45), m)
		handle.position.x = -Lsp / 2 + bowlL * 0.85 + (Lsp - bowlL * 0.85) / 2
		g.add(bowl, handle)
		return g
	})

	// ------------------------------------------------------------- butter, chocolate, wax
	addModel("meltable", "piece", (ctx) => {
		const P = ctx.props ?? {}
		const mat = P.material ?? "butter"
		const m =
			mat === "chocolate" ? M("heat-choc", { color: "#4a2a19", roughness: 0.35, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 })
				: mat === "wax" ? M("heat-wax", { color: "#f3ead6", roughness: 0.45, metalness: 0, transmission: 0.15, thickness: 0.01 })
					: M("heat-butter", { color: "#f4dc78", roughness: 0.5, metalness: 0, clearcoat: 0.25 })
		return mesh(kit.box(ctx.w, ctx.h, ctx.d, Math.min(ctx.w, ctx.h, ctx.d) * 0.15, 3), m)
	})

	// ------------------------------------------------------------- a puddle of water: a thin disc with a rounded edge
	// On a table it reads as a wet patch: the wood darkened under a glossy skin of water (a clear film alone hardly shows); it fades as it thins.
	addModel("puddle", "water", (ctx) => {
		const r = (ctx.w ?? 0.2) / 2
		const h = ctx.h ?? 0.0015
		const prof = [[0, -h / 2], [r - h, -h / 2], [r, -h / 2 + h * 0.3], [r - h * 0.6, h / 2], [0, h / 2]]
		const m = M("heat-wet-patch", { color: "#2f2a25", roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.2, transparent: true, opacity: 0.38, depthWrite: false })
		const disc = mesh(kit.lathe(prof, 64, `heat-puddle|${f5(r)}|${f5(h)}`), m, { cast: false })
		disc.userData.frame = { hook: "heat:puddle", area: Math.PI * r * r, scaled: true }
		return disc
	})
	addFrameHook("heat:puddle", (obj, f, a) => {
		// its depth: what water it has over its area now (its edge pinned until 0.2 mm, then drawing in: the body's scale)
		const g = fin(f.state?.liquid_g) ? f.state.liquid_g : null
		if (g === null) return
		const area = a.area * (f.scale ?? 1) * (f.scale ?? 1)
		const deep = area > 0 ? g / 1000 / 998 / area : 0
		const k = Math.max(0, Math.min(1, deep / 0.0015))
		const key = Math.round(k * 50)
		if (obj.userData._k === key) return
		obj.userData._k = key
		obj.visible = g > 0.01
		ownMaterial(obj).opacity = 0.14 + 0.24 * Math.sqrt(k)
	})

	// ------------------------------------------------------------- view plugins
	// Melt-water puddles: under each melting ice cube or dab, on what it stands on, as wide as its melt water spread 1.5 mm deep.
	addViewPlugin({
		name: "heat-puddles",
		load(ctx) {
			const items = [...ctx.itemsOfType("ice-cube"), ...ctx.itemsOfType("meltable")].filter((id) => ctx.track?.state?.[id]?.puddle_g !== undefined)
			if (!items.length) return null
			const puddles = []
			const frames = ctx.track.frames
			for (const id of items) {
				const solid = ctx.solidsOf(id)[0]
				if (!solid || solid.body.kind !== "slab") continue
				const mat = ctx.resolved?.[id]?.material
				const look = mat === "chocolate" ? { color: "#4a2a19", rough: 0.15 } : mat === "butter" ? { color: "#f6e08a", rough: 0.1 } : mat === "wax" ? { color: "#f3ead6", rough: 0.2 } : null
				const material = look
					? new THREE.MeshPhysicalMaterial({ color: look.color, roughness: look.rough, metalness: 0, clearcoat: 1 })
					: new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.04, metalness: 0, transmission: 1, thickness: 0.0015, ior: 1.333, attenuationColor: new THREE.Color("#eef7fb"), attenuationDistance: 5, specularIntensity: 0.7, envMapIntensity: 0.45, transparent: true, opacity: 0.9 })
				const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 64, 1), material)
				disc.receiveShadow = true
				disc.renderOrder = 1
				disc.visible = false
				ctx.group.add(disc)
				// its area at each frame as the engine has it (heat.ts puddleArea): spread 1.5 mm deep while it grows, its edge pinned while it
				// dries until it is 0.2 mm thin
				const S = ctx.track.state[id]
				const rho = look ? 900 : 998
				const areas = []
				let pinned = 0
				for (let k = 0; k < frames.length; k++) {
					const v = ((S.puddle_g?.[k] ?? 0) + (S.liquid_g?.[k] ?? 0)) / 1000 / rho
					pinned = Math.max(pinned, v / 0.0015)
					areas.push(Math.min(pinned, v / 0.0002))
				}
				puddles.push({ id, solid, disc, material, areas, rho })
			}
			return {
				frame(t) {
					// (the frame at or before t)
					let lo = 0
					let hi = frames.length - 1
					while (lo < hi) {
						const mid = (lo + hi + 1) >> 1
						if (frames[mid].t <= t) lo = mid
						else hi = mid - 1
					}
					for (const p of puddles) {
						const grams = (ctx.stateAt(p.id, "puddle_g", t) ?? 0) + (ctx.stateAt(p.id, "liquid_g", t) ?? 0)
						const at = ctx.placementAt(p.solid.id, t)
						if (!at || grams < 0.15) {
							p.disc.visible = false
							continue
						}
						const area = p.areas[lo] ?? 0
						const r = Math.sqrt(area / Math.PI)
						const s = at.scale ?? 1
						// on the surface under its foot (its centre less half its scaled height), 1.5 mm deep
						const foot = at.y - (p.solid.body.height * s) / 2
						p.disc.visible = true
						const deep = Math.max(0.0002, Math.min(0.0015, area > 0 ? grams / 1000 / p.rho / area : 0.0015))
						p.disc.position.set(at.x, foot + deep / 2 + 0.00005, 0)
						p.disc.scale.set(r, deep, r)
					}
				},
				dispose() {
					for (const p of puddles) {
						p.disc.geometry.dispose()
						p.material.dispose()
					}
				}
			}
		}
	})

	// The desk lamps' light: a warm spot light from each bulb along its beam while it is on (the beam's cone and its pool of light on the table).
	addViewPlugin({
		name: "heat-lamps",
		load(ctx) {
			const lamps = ctx.itemsOfType("lamp")
			if (!lamps.length) return null
			const lights = []
			for (const id of lamps) {
				const rec = (ctx.doc.processes ?? []).find((p) => p.kind === "heat" && p.item === id && p.role === "lamp")
				const base = ctx.doc.solids.find((s) => s.id === rec?.solid)
				if (!rec || !base) continue
				const P = ctx.resolved?.[id] ?? {}
				const bulb = P.bulb ?? "incandescent"
				const color = bulb === "led" ? "#fff2df" : bulb === "halogen" ? "#ffd2a0" : "#ffbf7a"
				// a 60 W incandescent gives about 800 lm, an LED about as much from 9 W: its brightness in the picture follows its light, not its heat
				const lumens = bulb === "led" ? (P.power_w ?? 9) * 90 : (P.power_w ?? 60) * (bulb === "halogen" ? 16 : 13.5)
				const spread = rec.spread ?? 0.87
				// (its pool: a little firmer at its edge and short of white on a white plate, so the plate, the cube and the salt on it read and the
				// glow past the plate's rim stays a glow: penumbra 0.2, 0.6 of the brightness that blew a white plate out to pure white)
				const light = new THREE.SpotLight(color, (lumens / 800) * 18 * 0.6, 4, spread, 0.2, 2)
				light.castShadow = true
				light.shadow.mapSize.set(512, 512)
				light.shadow.bias = -0.0005
				const ax = base.at.x + rec.at.x
				const ay = base.at.y + rec.at.y
				const dx = rec.dir?.x ?? 0
				const dy = rec.dir?.y ?? -1
				light.position.set(ax, ay, 0)
				light.target.position.set(ax + dx, ay + dy, 0)
				light.visible = false
				ctx.group.add(light, light.target)
				lights.push({ id, light })
			}
			if (!lights.length) return null
			return {
				frame(t) {
					for (const l of lights) l.light.visible = (ctx.stateAt(l.id, "on", t) ?? 0) > 0.5
				},
				dispose() {
					for (const l of lights) l.light.dispose?.()
				}
			}
		}
	})

	// The time-lapse clock: when the scene runs time-lapsed (doc.settings.timeLapse > 1), the lesson time on a label over the machine's top left.
	addViewPlugin({
		name: "heat-clock",
		load(ctx) {
			const lapse = ctx.doc?.settings?.timeLapse
			if (!(typeof lapse === "number" && lapse > 1)) return null
			const solids = ctx.doc.solids.filter((s) => s.itemType !== "table" && s.itemType !== "wall")
			if (!solids.length) return null
			let x0 = Infinity
			let y0 = Infinity
			let y1 = -Infinity
			let x1 = -Infinity
			for (const s of solids) {
				const r = s.body.kind === "ball" ? s.body.radius : s.body.kind === "slab" ? Math.max(s.body.width, s.body.height) / 2 : Math.max(...s.body.points.map((p) => Math.hypot(p.x, p.y)))
				// (a welded part's `at` is from its parent's)
				const pa = s.parent ? ctx.doc.solids.find((q) => q.id === s.parent)?.at : undefined
				const at = pa ? { x: pa.x + s.at.x, y: pa.y + s.at.y } : s.at
				x0 = Math.min(x0, at.x - r)
				x1 = Math.max(x1, at.x + r)
				y0 = Math.min(y0, at.y - r)
				y1 = Math.max(y1, at.y + r)
			}
			// (what moves takes the shot with it: the movers' room over the whole run, as the wide camera frames them)
			for (const fr of ctx.track?.frames ?? []) {
				for (const s of solids) {
					if (s.kind === "static") continue
					const q = fr.placements?.[s.id]
					if (!q) continue
					const r = (s.body.kind === "ball" ? s.body.radius : s.body.kind === "slab" ? Math.max(s.body.width, s.body.height) / 2 : Math.max(...s.body.points.map((p) => Math.hypot(p.x, p.y)))) * (q.scale ?? 1)
					x0 = Math.min(x0, q.x - r)
					x1 = Math.max(x1, q.x + r)
					y0 = Math.min(y0, q.y - r)
					y1 = Math.max(y1, q.y + r)
				}
			}
			// the picture the camera frames (web/view3d.js frameWide: the machine fills a 16:9 picture less ~10 % at the sides, ~10 % top and bottom;
			// a fixed camera, doc.view.camera, spans x0..x1 at height y): the label goes inside it, at its top, over the middle or the free side
			const lo = Math.max(0, y0)
			const fixed = ctx.doc?.view?.camera
			let fx0
			let fx1
			let fy1
			if (fixed && Number.isFinite(fixed.x0) && Number.isFinite(fixed.x1)) {
				fx0 = fixed.x0
				fx1 = fixed.x1
				fy1 = (fixed.y ?? (lo + y1) / 2) + ((fixed.x1 - fixed.x0) / 16) * 9 * 0.5
			} else {
				const halfW = Math.max((x1 - x0) / 2, ((y1 - lo) / 2) * (16 / 9) * (0.9 / 0.84))
				const halfH = Math.max((y1 - lo) / 2, (((x1 - x0) / 2) * (9 / 16) * 0.84) / 0.9)
				const cx = (x0 + x1) / 2
				const cy = (lo + y1) / 2
				fx0 = cx - halfW
				fx1 = cx + halfW
				fy1 = cy + halfH
			}
			const span = fx1 - fx0
			const h = Math.max(0.008, Math.min(0.07, span * 0.035))
			const label = ctx.label({ text: "", height: h, color: "#16181b", background: "rgba(255,255,255,0.9)" })
			// (its sprite is 4 h wide; kept 6 % of the picture's width inside its edges (the estimate of the camera's frame is rough) and just under its
			// top: over the middle of the machine when there is room above it, else beside it on the side with room)
			const halfL = 2 * h
			const top = fy1 - h * 0.9 - 0.04 * span
			const above = top - y1 > h * 0.3
			const inset = (above ? 0.06 : 0.1) * span
			const cxL = above ? (x0 + x1) / 2 : x1 + halfL + h * 0.4 <= fx1 - inset - halfL ? x1 + halfL + h * 0.4 : fx0 + inset + halfL
			label.sprite.position.set(Math.min(fx1 - inset - halfL, Math.max(fx0 + inset + halfL, cxL)), above ? top : Math.min(top, (lo + y1) / 2 + h), 0)
			label.sprite.layers?.set?.(ctx.HUD_LAYER ?? 0)
			ctx.group.add(label.sprite)
			const room = ctx.doc?.settings?.roomTemperature
			const tail = typeof room === "number" ? ` · room ${Math.round(room)} °C` : ""
			return {
				frame(t) {
					label.set(`⏱ ${lessonClock(t * lapse)}${tail}`)
				},
				dispose() {
					label.dispose()
				}
			}
		}
	})

	// ------------------------------------------------------------- a jar over a candle: an upside-down glass jar (open at the bottom) on its top part
	addModel("candle-jar", "top", (ctx) => {
		const t = ctx.h ?? 0.003
		const W = ctx.w ?? 0.1
		const ro = W / 2
		const ri = ro - t
		// (its walls' height: the walls are children of the top, so the jar stands from the top's underside down to its rim on the table)
		const H = Math.max(0.03, ((ctx.props?.volume_ml ?? 1000) / 1e6 / (Math.PI * ri * ri)))
		const y1 = t / 2
		const y0 = -t / 2 - H
		const prof = [[ri, y0], [ro, y0], [ro, y1 - 0.004], [ro - 0.004, y1], [0, y1], [0, y1 - t], [ri - 0.003, y1 - t], [ri, y1 - t - 0.003], [ri, y0]]
		// (clear glass drawn as a thin see-through shell, not a refracting one: what stands inside it, a candle's wax and its flame, shows through;
		// a transmission material would hide other see-through things behind it)
		const glassShell = M("heat-jar-glass", { color: "#f4fbfa", roughness: 0.02, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: T.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4, specularIntensity: 1 })
		const jar = mesh(L.lathe(`heat-jar|${f5(ro)}|${f5(H)}|${f5(t)}`, prof, { seg: 96, tile: 0.2, crease: 1.2 }), glassShell, { cast: false })
		jar.renderOrder = 2
		return jar
	})
	for (const part of ["wall-left", "wall-right"]) addModel("candle-jar", part, null)

	// ------------------------------------------------------------- ball and ring: the ring (a steel annulus round its hole) on its left jaw
	addModel("ball-and-ring", "ring-left", (ctx) => {
		const P = ctx.props ?? {}
		const hole = (P.hole_mm ?? 25.45) / 1000
		const jaw = ctx.w ?? 0.01
		const t = ctx.h ?? 0.006
		const ro = hole / 2 + jaw
		const ri = hole / 2
		const prof = [[ri, -t / 2], [ro - 0.0008, -t / 2], [ro, -t / 2 + 0.0008], [ro, t / 2 - 0.0008], [ro - 0.0008, t / 2], [ri, t / 2]]
		const ring = mesh(L.lathe(`heat-ring|${f5(ri)}|${f5(ro)}|${f5(t)}`, prof, { seg: 96, tile: 0.1, crease: 1.2 }), stainless())
		// (the ring's middle is the hole's: half the hole and half a jaw to the right of this jaw's middle)
		ring.position.x = ri + jaw / 2
		return ring
	})
	addModel("ball-and-ring", "ring-right", null)

	// ------------------------------------------------------------- bimetal strip: brass over steel, curling as the run's bend_mm says
	addModel("bimetal-strip", "strip-top", (ctx) => {
		const P = ctx.props ?? {}
		const L0 = ctx.w ?? 0.1
		const t = ctx.h ?? 0.0006
		const d = ctx.d ?? 0.01
		const [topLook, bottomLook] = P.layers === "steel on brass" ? ["steel", "brass"] : ["brass", "steel"]
		const brass = M("heat-brass", { color: "#d2a64b", metalness: 1, roughness: 0.3, envMapIntensity: 1.2 })
		const steelM = M("heat-steel", { color: "#a9adb2", metalness: 1, roughness: 0.35, envMapIntensity: 1.1 })
		const g = group()
		for (const [k, look] of [[0, topLook], [1, bottomLook]]) {
			const geo = new T.BoxGeometry(L0, t, d, 40, 1, 1)
			geo.translate(0, k === 0 ? 0 : -t, 0)
			const m = mesh(geo, look === "brass" ? brass : steelM)
			m.userData.ownGeometry = true
			m.userData.frame = { hook: "heat:bimetal", L: L0, scaled: false }
			g.add(m)
		}
		return g
	})
	addModel("bimetal-strip", "strip-bottom", null)
	addFrameHook("heat:bimetal", (obj, f, a) => {
		// its tip moves bend_mm (positive: toward its lower layer); along it the drop grows as the square of the distance from the clamp
		const tip = fin(f.state?.bend_mm) ? f.state.bend_mm / 1000 : 0
		const key = Math.round(tip * 1e5)
		if (obj.userData._bend === key) return
		obj.userData._bend = key
		if (!obj.userData._orig) {
			obj.geometry = obj.geometry.clone()
			obj.userData._orig = obj.geometry.attributes.position.array.slice()
		}
		const o = obj.userData._orig
		const pos = obj.geometry.attributes.position
		for (let i = 0; i < pos.count; i++) {
			const u = Math.max(0, Math.min(1, (o[3 * i] + a.L / 2) / a.L))
			pos.setXYZ(i, o[3 * i], o[3 * i + 1] - tip * u * u, o[3 * i + 2])
		}
		pos.needsUpdate = true
		obj.geometry.computeVertexNormals()
		obj.geometry.computeBoundingSphere()
	})

	// The lit candles' flames: a soft teardrop of flame over each wick while the run says it burns (it flickers from a fixed table, the same in
	// every export), with a little warm light; it goes out when the run says so (a jar's oxygen used up).
	const FLICKER = Array.from({ length: 64 }, (_, i) => hash(i, 7))
	const flicker = (t, s) => {
		const u = (t * 9 + s * 13.7) % 64
		const i = Math.floor(u)
		const w = u - i
		const a = FLICKER[i]
		const b = FLICKER[(i + 1) % 64]
		const e = w * w * (3 - 2 * w)
		return a + (b - a) * e
	}
	addViewPlugin({
		name: "heat-flames",
		load(ctx) {
			const candles = ctx.itemsOfType("candle").filter((id) => ctx.track?.state?.[id]?.flame !== undefined)
			if (!candles.length) return null
			const flames = []
			const flameGeo = (k) => new THREE.LatheGeometry([[0, 0], [0.0035 * k, 0.003 * k], [0.005 * k, 0.009 * k], [0.0042 * k, 0.016 * k], [0.0018 * k, 0.023 * k], [0, 0.027 * k]].map(([x, y]) => new THREE.Vector2(x, y)), 24)
			for (const id of candles) {
				const solid = ctx.solidsOf(id).find((s) => s.id.endsWith("/body"))
				if (!solid) continue
				const top = solid.body.kind === "polygon" ? Math.max(...solid.body.points.map((p) => p.y)) : (solid.body.height ?? 0) / 2
				const outer = new THREE.Mesh(flameGeo(1), new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
				const core = new THREE.Mesh(flameGeo(0.62), new THREE.MeshBasicMaterial({ color: "#fff4cf", transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
				const base = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 12, 8), new THREE.MeshBasicMaterial({ color: "#4a74ff", transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
				// (the candle's own model draws its wick; the flame stands on it)
				base.position.y = 0.003
				outer.position.y = 0.004
				core.position.y = 0.004
				const light = new THREE.PointLight("#ffb46b", 0.05, 1.5, 2)
				light.position.y = 0.015
				light.castShadow = false
				const g = new THREE.Group()
				g.add(base, outer, core, light)
				g.visible = false
				for (const o of [base, outer, core]) o.castShadow = false
				ctx.group.add(g)
				flames.push({ id, solid, top, g, outer, core, light, seed: hash(flames.length, 3) * 64 })
			}
			if (!flames.length) return null
			return {
				frame(t) {
					for (const fl of flames) {
						const on = (ctx.stateAt(fl.id, "flame", t) ?? 0) >= 0.5
						const at = ctx.placementAt(fl.solid.id, t)
						fl.g.visible = on && !!at
						if (!fl.g.visible) continue
						const s = at.scale ?? 1
						const c = Math.cos(at.angle ?? 0)
						const sn = Math.sin(at.angle ?? 0)
						const ty = fl.top * s
						fl.g.position.set(at.x - ty * sn, at.y + ty * c, 0)
						// (a flame stands up whatever the candle's tilt; it flickers in height and sways a little)
						const k = 0.88 + 0.24 * flicker(t, fl.seed)
						const sway = (flicker(t * 0.7, fl.seed + 31) - 0.5) * 0.12
						fl.outer.scale.set(1, k, 1)
						fl.core.scale.set(1, 0.9 + 0.2 * flicker(t * 1.3, fl.seed + 7), 1)
						fl.outer.rotation.z = sway
						fl.core.rotation.z = sway * 0.6
						fl.light.intensity = 0.04 + 0.03 * k
					}
				},
				dispose() {
					for (const fl of flames) fl.g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
				}
			}
		}
	})

	// Focused light's hot spots (a magnifying glass's focus on paper): a glowing dot where the run's spot_x, spot_y say, darkening to a char mark
	// once it has scorched, with a thin wisp of smoke over it (fixed hashes and t: the same frame whatever was drawn before it).
	addViewPlugin({
		name: "heat-spots",
		load(ctx) {
			const items = Object.keys(ctx.track?.state ?? {}).filter((id) => ctx.track.state[id]?.spot_temp !== undefined && ctx.track.state[id]?.spot_x !== undefined)
			if (!items.length) return null
			const marks = []
			for (const id of items) {
				const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshBasicMaterial({ color: "#ffd27a", transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
				const charM = new THREE.MeshStandardMaterial({ color: "#2a1a0e", roughness: 1, transparent: true, opacity: 0.85, depthWrite: false })
				const char = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.0002, 24), charM)
				const smokeM = new THREE.MeshBasicMaterial({ color: "#d8d4cf", transparent: true, opacity: 0.0, depthWrite: false })
				const smoke = new THREE.Group()
				for (let i = 0; i < 5; i++) {
					const p = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), smokeM)
					p.userData.i = i
					smoke.add(p)
				}
				for (const o of [glow, char]) o.castShadow = false
				const g = new THREE.Group()
				g.add(char, glow, smoke)
				g.visible = false
				ctx.group.add(g)
				marks.push({ id, g, glow, char, smoke, smokeM })
			}
			return {
				frame(t) {
					for (const m of marks) {
						const T = ctx.stateAt(m.id, "spot_temp", t)
						const x = ctx.stateAt(m.id, "spot_x", t)
						const y = ctx.stateAt(m.id, "spot_y", t)
						m.g.visible = fin(T) && fin(x) && fin(y) && T > 60
						if (!m.g.visible) continue
						m.g.position.set(x, y + 0.0003, 0)
						const k = Math.max(0, Math.min(1, (T - 60) / 400))
						m.glow.scale.setScalar(0.0008 + 0.0022 * k)
						m.glow.material.opacity = 0.35 + 0.6 * k
						const burnt = (ctx.stateAt(m.id, "scorched", t) ?? 0) >= 1
						m.char.visible = burnt
						m.char.scale.set(0.0035, 1, 0.0035)
						m.smokeM.opacity = burnt ? 0.35 : 0
						for (const p of m.smoke.children) {
							const i = p.userData.i
							const ph = (t * 0.6 + hash(i, 11)) % 1
							p.position.set((hash(i, 12) - 0.5) * 0.004 + 0.003 * Math.sin(6.28 * (ph + hash(i, 13))), 0.002 + ph * 0.05, 0)
							p.scale.setScalar(0.0015 + 0.005 * ph)
						}
					}
				},
				dispose() {
					for (const m of marks) m.g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
				}
			}
		}
	})
}
