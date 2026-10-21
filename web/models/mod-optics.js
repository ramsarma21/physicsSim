// The optics module's 3D models and its view plug-in (web/view-plugins.js): realistic flashlights, laser pointers, mirrors, lenses, prisms,
// glass blocks, filters, material panels, screens, light meters, light targets, an eye, the sun and a lit arrow; and the light itself:
// the run's beams traced at every drawn moment by the engine's own tracer (web/sim/optics.js, the same bits as the engine), drawn as glowing
// sheets of light "through dusty air" (a laser as a bright thin line), with pools of light where it lands and real three.js lights from
// each source for the room's shading and shadows (a look only: the traced beams are what the goals read).
// Every model fills its part's physics outline (x-y, the side view) and stays inside its depth, as web/models3d.js asks.
import * as O from "../sim/optics.js"

// band colours (linear RGB) that add up to white over the 7 visible bands, so a white beam draws white and a split one its colours
const BAND_RGB = [
	[0.15, 0, 0.25],
	[0, 0.1, 0.45],
	[0, 0.2, 0.2],
	[0.05, 0.4, 0.05],
	[0.2, 0.2, 0],
	[0.2, 0.1, 0],
	[0.4, 0, 0.05]
]
/** A wavelength's colour (Bruton's approximation of the spectral colours, max channel 1). */
function nmRGB(nm) {
	if (nm < 440) return [Math.max(0, (440 - nm) / 60) * 0.7 + 0.3, 0, 1]
	if (nm < 490) return [0, (nm - 440) / 50, 1]
	if (nm < 510) return [0, 1, (510 - nm) / 20]
	if (nm < 580) return [(nm - 510) / 70, 1, 0]
	if (nm < 645) return [1, (645 - nm) / 65, 0]
	if (nm <= 780) return [1, 0, 0]
	return [1, 0.5, 0.35]
}
/** A beam's display colour (max channel 1) from its band powers, or from its one wavelength. */
function colourOf(p, nm) {
	let r = 0
	let g = 0
	let b = 0
	if (nm > 0) {
		;[r, g, b] = nmRGB(nm)
	} else {
		let vis = 0
		for (let k = 0; k < 7; k++) vis += p[k]
		if (!(vis > 0)) return [1, 0.85, 0.7] // infrared only: a faint warm glow
		for (let k = 0; k < 7; k++) {
			const f = (7 * p[k]) / vis
			r += f * BAND_RGB[k][0] / 1
			g += f * BAND_RGB[k][1] / 1
			b += f * BAND_RGB[k][2] / 1
		}
		r /= 7 * 0.2
		g /= 7 * 0.2
		b /= 7 * 0.2
	}
	const m = Math.max(r, g, b, 1e-9)
	return [r / m, g / m, b / m]
}

/** machines/mod_optics.py lens_shape (for drawing the lens's true faces). */
function lensShape(f, n, diameter, minimum) {
	const h = diameter / 2
	let R = 2 * (n - 1) * f
	let t = minimum
	for (let i = 0; i < 60; i++) {
		const r = Math.abs(R)
		const sag = r > h ? r - Math.sqrt(r * r - h * h) : r
		t = f > 0 ? minimum + 2 * sag : minimum
		const a = 1 / f
		const b = -2 * (n - 1)
		const cc = ((n - 1) * (n - 1) * t) / n
		const disc = b * b - 4 * a * cc
		const nxt = disc >= 0 ? (-b + Math.sqrt(disc)) / (2 * a) : R
		if (Math.abs(nxt - R) < 1e-15) {
			R = nxt
			break
		}
		R = nxt
	}
	return [R, t]
}
const ND = { "crown glass": 1.5168, "flint glass": 1.62004, acrylic: 1.4917, water: 1.333 }
// a torch's LED as it glows: white, or one colour (its `color` prop: machines/mod_optics.py TORCH_LIGHT)
const TORCH_RGB = { white: "#fff6e6", red: "#ff3020", green: "#30ff4a", blue: "#3a62ff" }
const FILTER_COLOR = { red: "#d81e1e", orange: "#f07818", yellow: "#f2d21b", green: "#1fa83a", cyan: "#1cb8c8", blue: "#2348d8", violet: "#7a2bd0", magenta: "#d42aa8" }
const LASER_RGB = { red: "#ff2a1a", green: "#3dff3a", violet: "#9a4dff" }

export default function register({ addModel, addThumb, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const T = THREE
	const { mesh, group } = kit
	const f5 = (v) => Number(v).toFixed(5)
	const darkMetal = () => kit.metal("#2b2f36", { roughness: 0.42, key: "optics-anodised" })
	const chrome = () => kit.metal("#eef1f4", { roughness: 0.02, key: "optics-chrome" })
	const blackPlastic = () => kit.plastic("#1d2024", { gloss: 0.4, key: "optics" })
	const glassOf = (glass, t = 0.01) =>
		kit.mat(`optics-glass|${glass}|${f5(t)}`, { color: glass === "flint glass" ? "#f4fbff" : glass === "water" ? "#e6f4fb" : "#ffffff", roughness: 0.02, metalness: 0, transmission: 1, thickness: t, ior: ND[glass] ?? 1.52, transparent: true, clearcoat: glass === "water" ? 0.6 : 1 })
	const emissive = (key, color, intensity = 0) => kit.mat(`optics-emit|${key}|${color}`, { color: "#ffffff", emissive: new T.Color(color), emissiveIntensity: intensity, roughness: 0.3, metalness: 0 })

	// ---- the glow of a light's lens, bulb or arrow (its `on` reading)
	addFrameHook("optics:glow", (obj, f, a) => {
		const on = Number(f.state?.on ?? 1) > 0.5
		obj.traverse((o) => {
			if (o.name !== "glow" || !o.material) return
			const m = ownMaterial(o)
			m.emissiveIntensity = on ? (a.strength ?? 3) : 0
		})
	})

	// ============================================================== flashlight: a dark anodised torch, its LED behind a lens in a chrome reflector
	addModel("flashlight", "body", (ctx) => {
		const L = ctx.w
		const R = ctx.h / 2
		const x0 = -L / 2
		const prof = [
			[0, x0], [R * 0.74, x0], [R * 0.78, x0 + 0.0015], [R * 0.78, x0 + 0.011], [R * 0.7, x0 + 0.013], [R * 0.7, L * 0.18], [R * 0.84, L * 0.3], [R * 0.99, L * 0.39],
			[R, L / 2 - 0.0035], [R * 0.93, L / 2 - 0.0008], [R * 0.86, L / 2 - 0.0008], [R * 0.86, L / 2 - 0.004], [0, L / 2 - 0.004]
		]
		const body = mesh(kit.latheX(prof, 48, `torch|${f5(L)}|${f5(R)}`), darkMetal())
		// knurled grip rings
		const rings = []
		for (let k = 0; k < 7; k++) {
			const r = mesh(kit.torus(R * 0.7, 0.0006, 8, 40), darkMetal())
			r.rotation.y = Math.PI / 2
			r.position.x = x0 + 0.02 + k * 0.007
			rings.push(r)
		}
		// the reflector cone, the LED (it glows) and the lens
		const refl = mesh(kit.latheX([[R * 0.84, L / 2 - 0.0045], [R * 0.28, L / 2 - 0.016], [0, L / 2 - 0.016]], 40, `torchRefl|${f5(L)}|${f5(R)}`), chrome())
		const tint = TORCH_RGB[ctx.props.color] ?? TORCH_RGB.white
		const led = mesh(kit.sphere(R * 0.18, 20, 12), emissive(`led-${tint}`, tint, 3))
		led.name = "glow"
		led.position.x = L / 2 - 0.0145
		const lens = mesh(kit.latheX([[0, L / 2 - 0.0042], [R * 0.86, L / 2 - 0.0042], [R * 0.86, L / 2 - 0.0012], [0, L / 2 - 0.0012]], 40, `torchLens|${f5(L)}|${f5(R)}`), glassOf("acrylic", 0.003))
		// the switch on top
		const sw = mesh(kit.box(0.012, 0.004, 0.008, 0.0015), kit.rubber("#3a3f47"))
		sw.position.set(x0 + 0.045, R * 0.7 + 0.0016, 0)
		const g = group(body, ...rings, refl, led, lens, sw)
		g.userData.frame = { hook: "optics:glow", strength: 3 }
		return g
	})

	// ============================================================== laser pointer: a brushed aluminium pen, its aperture glowing the laser's colour
	addModel("laser-pointer", "body", (ctx) => {
		const L = ctx.w
		const R = ctx.h / 2
		const x0 = -L / 2
		const prof = [[0, x0], [R * 0.75, x0], [R * 0.9, x0 + 0.003], [R * 0.9, L * 0.3], [R * 0.83, L * 0.42], [R * 0.62, L / 2 - 0.001], [R * 0.4, L / 2], [0, L / 2]]
		const body = mesh(kit.latheX(prof, 32, `laser|${f5(L)}|${f5(R)}`), kit.metal("#c7ccd2", { roughness: 0.28, key: "optics-brushed" }))
		const clip = mesh(kit.box(0.045, 0.0012, 0.003, 0.0005), kit.metal("#c7ccd2", { roughness: 0.28, key: "optics-brushed" }))
		clip.position.set(x0 + 0.03, R * 0.9 + 0.0007, 0)
		const btn = mesh(kit.cylinderY(0.0018, 0.0014, 16), kit.rubber("#c4271f"))
		btn.position.set(L * 0.12, R * 0.9 + 0.0005, 0)
		const col = LASER_RGB[ctx.props.color] ?? LASER_RGB.red
		const ap = mesh(kit.latheX([[0, L / 2 - 0.0006], [R * 0.35, L / 2 - 0.0006], [R * 0.35, L / 2], [0, L / 2]], 16, `laserAp|${f5(L)}|${f5(R)}`), emissive(`laser-${ctx.props.color}`, col, 4))
		ap.name = "glow"
		const g = group(body, clip, btn, ap)
		g.userData.frame = { hook: "optics:glow", strength: 4 }
		return g
	})

	// ============================================================== flat mirror: silvered glass in a dark frame (the shiny face at +x)
	addModel("mirror", "glass", (ctx) => {
		const { w, h, d } = ctx
		const back = mesh(kit.box(w * 0.66, h, d, 0.001), kit.plastic("#2a2c31", { gloss: 0.2, key: "optics-mirror-back" }))
		back.position.x = -w * 0.17
		const face = mesh(kit.box(w * 0.34, h - 0.004, d - 0.004, 0.0006), chrome())
		face.position.x = w / 2 - w * 0.17
		return group(back, face)
	})

	// ============================================================== curved mirror: a spherical chrome cap, its shell 4 mm
	addModel("curved-mirror", "mirror", (ctx) => {
		const f = Number(ctx.props.focal_length) || 0.15
		const R = 2 * f
		const h = Math.min((Number(ctx.props.diameter) || 0.1) / 2, 0.9 * R)
		const th = 0.004
		const n = 24
		const prof = []
		const concave = ctx.props.curve !== "convex"
		if (concave) {
			for (let k = 0; k <= n; k++) {
				const y = (h * k) / n
				prof.push([y, R - Math.sqrt(R * R - y * y)])
			}
			for (let k = n; k >= 0; k--) {
				const y = (h * k) / n
				prof.push([y, R - Math.sqrt((R + th) * (R + th) - y * y)])
			}
		} else {
			for (let k = 0; k <= n; k++) {
				const y = (h * k) / n
				prof.push([y, -(R - Math.sqrt(R * R - y * y))])
			}
			for (let k = n; k >= 0; k--) {
				const y = (h * k) / n
				prof.push([y, -R + Math.sqrt((R - th) * (R - th) - y * y)])
			}
		}
		return group(mesh(kit.latheX(prof, 64, `cmirror|${concave}|${f5(R)}|${f5(h)}`), chrome()))
	})

	// ============================================================== lenses: their true spherical faces in clear glass, a thin black rim
	const lensModel = (ctx, convex) => {
		const glass = ctx.props.glass ?? "crown glass"
		const n = ND[glass] ?? 1.5168
		const f = Number(ctx.props.focal_length) || 0.1
		const D = Math.min(Number(ctx.props.diameter) || 0.05, 3 * (n - 1) * f)
		const h = D / 2
		const prof = []
		const m = 20
		if (convex) {
			const [R, t] = lensShape(f, n, D, 0.0015)
			for (let k = 0; k <= m; k++) {
				const y = (h * k) / m
				prof.push([y, t / 2 - (R - Math.sqrt(R * R - y * y))])
			}
			for (let k = m; k >= 0; k--) {
				const y = (h * k) / m
				prof.push([y, -(t / 2 - (R - Math.sqrt(R * R - y * y)))])
			}
		} else {
			const [R0] = lensShape(-f, n, D, 0.002)
			const r = Math.abs(R0)
			for (let k = 0; k <= m; k++) {
				const y = (h * k) / m
				prof.push([y, 0.001 + (r - Math.sqrt(r * r - y * y))])
			}
			for (let k = m; k >= 0; k--) {
				const y = (h * k) / m
				prof.push([y, -(0.001 + (r - Math.sqrt(r * r - y * y)))])
			}
		}
		const lens = mesh(kit.latheX(prof, 64, `lens|${convex}|${glass}|${f5(f)}|${f5(D)}`), glassOf(glass, 0.006))
		lens.castShadow = false
		const edge = prof[m][1]
		const rim = mesh(kit.latheX([[h, -edge - 0.0004], [h + 0.0009, -edge - 0.0004], [h + 0.0009, edge + 0.0004], [h, edge + 0.0004]], 64, `lensRim|${f5(h)}|${f5(edge)}`), blackPlastic())
		return group(lens, rim)
	}
	addModel("convex-lens", "lens", (ctx) => lensModel(ctx, true))
	addModel("concave-lens", "lens", (ctx) => lensModel(ctx, false))

	// ============================================================== prism, glass block, semicircular block: clear glass with crisp bevels
	addModel("prism", "glass", (ctx) => {
		const pts = ctx.body.points.map((p) => [p.x, p.y])
		const m = mesh(kit.extrude(pts, ctx.body.depth, { bevel: 0.0004, key: `prism|${JSON.stringify(pts)}` }), glassOf(ctx.props.glass ?? "crown glass", 0.02))
		m.castShadow = false
		return group(m)
	})
	addModel("glass-block", "glass", (ctx) => {
		const m = mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0008), glassOf(ctx.props.glass ?? "crown glass", 0.02))
		m.castShadow = false
		return group(m)
	})
	addModel("semicircle-block", "glass", (ctx) => {
		const r = Number(ctx.props.radius) || 0.05
		const pts = [[0, -r]]
		const n = 40
		for (let k = 0; k <= n; k++) {
			const a = Math.PI / 2 + (Math.PI * k) / n
			pts.push([r * Math.cos(a), r * Math.sin(a)])
		}
		pts[pts.length - 1] = [0, -r]
		pts.splice(1, 0, [0, r])
		const outline = [[0, -r], [0, r]]
		for (let k = 1; k < n; k++) {
			const a = Math.PI / 2 + (Math.PI * k) / n
			outline.push([r * Math.cos(a), r * Math.sin(a)])
		}
		const m = mesh(kit.extrude(outline, 0.02, { bevel: 0.0004, key: `semi|${f5(r)}` }), glassOf(ctx.props.glass ?? "crown glass", 0.02))
		m.castShadow = false
		return group(m)
	})

	// ============================================================== colour filter: a gel in a black card frame
	addModel("color-filter", "gel", (ctx) => {
		const { w, h, d } = ctx
		const b = Math.min(0.008, h * 0.12)
		const card = blackPlastic()
		const bars = [
			[w, b, d, 0, h / 2 - b / 2, 0], [w, b, d, 0, -h / 2 + b / 2, 0],
			[w, h - 2 * b, b, 0, 0, d / 2 - b / 2], [w, h - 2 * b, b, 0, 0, -d / 2 + b / 2]
		].map(([a, c, e, x, y, z]) => {
			const m = mesh(kit.box(a, c, e, 0.0003), card)
			m.position.set(x, y, z)
			return m
		})
		const col = FILTER_COLOR[ctx.props.color] ?? "#d81e1e"
		const gel = mesh(kit.box(w * 0.4, h - 2 * b, d - 2 * b, 0.0001), kit.mat(`optics-gel|${col}`, { color: col, roughness: 0.12, metalness: 0, transmission: 0.75, thickness: 0.0005, ior: 1.45, transparent: true, opacity: 0.85, attenuationColor: col, attenuationDistance: 0.0004 }))
		gel.castShadow = false
		return group(...bars, gel)
	})

	// ============================================================== material panel: a 10 cm sample sheet of its material
	const panelMat = (sample) => {
		switch (sample) {
			case "clear glass":
				return glassOf("crown glass", 0.003)
			case "clear plastic":
				return kit.mat("optics-panel-pmma", { color: "#f2fbff", roughness: 0.05, metalness: 0, transmission: 1, thickness: 0.003, ior: 1.49, transparent: true })
			case "frosted glass":
				return kit.mat("optics-panel-frosted", { color: "#f4f8fa", roughness: 0.55, metalness: 0, transmission: 0.95, thickness: 0.003, ior: 1.52, transparent: true })
			case "wax paper":
				return kit.mat("optics-panel-wax", { color: "#f1ead2", roughness: 0.45, metalness: 0, transmission: 0.55, thickness: 0.0005, transparent: true, opacity: 0.92 })
			case "tissue paper":
				return kit.mat("optics-panel-tissue", { color: "#fbfaf6", roughness: 0.95, metalness: 0, transmission: 0.45, thickness: 0.0003, transparent: true, opacity: 0.9 })
			case "white card":
				return kit.paper("#ecebe4")
			case "cardboard":
				return kit.cardboard("#c49a6c")
			case "aluminium foil":
				return kit.metal("#d4d8dc", { roughness: 0.22, key: "optics-foil" })
			case "black cloth":
				return kit.fabric("#151515")
			case "wood":
				return kit.wood("#c8955a")
			default:
				return kit.paper("#ecebe4")
		}
	}
	addModel("material-panel", "panel", (ctx) => {
		const m = mesh(kit.box(ctx.w, ctx.h, ctx.d, Math.min(0.0006, ctx.w / 3)), panelMat(ctx.props.sample))
		if (["clear glass", "clear plastic", "frosted glass", "wax paper", "tissue paper"].includes(ctx.props.sample)) m.castShadow = false
		return group(m)
	})

	// ============================================================== screen: a white card (light pools and shadows are drawn on it by the plug-in)
	addModel("screen", "card", (ctx) => group(mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0008), kit.paper(ctx.props.color ?? "#e8e6df"))))

	// ============================================================== light meter: a black meter head, a white diffuser facing +x, an LCD on its front
	addFrameHook("optics:lcd", (obj, f) => {
		const lux = Number(f.state?.lux)
		const lcd = obj.getObjectByName("lcd")
		if (!lcd) return
		const text = Number.isFinite(lux) ? (lux >= 100000 ? `${Math.round(lux / 1000)}k` : lux >= 100 ? String(Math.round(lux)) : lux >= 10 ? lux.toFixed(1) : lux.toFixed(2)) : "----"
		if (lcd.userData.shown === text) return
		lcd.userData.shown = text
		let c = lcd.userData.canvas
		if (!c) {
			c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 128) : document.createElement("canvas")
			c.width = 256
			c.height = 128
			lcd.userData.canvas = c
			const m = ownMaterial(lcd)
			m.map = new T.CanvasTexture(c)
			m.map.colorSpace = T.SRGBColorSpace
			m.emissiveMap = m.map
			m.needsUpdate = true
		}
		const g = c.getContext("2d")
		g.fillStyle = "#b8c7a4"
		g.fillRect(0, 0, 256, 128)
		g.fillStyle = "#1c2416"
		g.font = "700 64px ui-monospace, Menlo, monospace"
		g.textAlign = "right"
		g.textBaseline = "middle"
		g.fillText(text, 236, 58)
		g.font = "600 26px ui-sans-serif, Helvetica, sans-serif"
		g.fillText("lux", 236, 108)
		lcd.material.map.needsUpdate = true
	})
	addModel("light-meter", "head", (ctx) => {
		const { w, h, d } = ctx
		const body = mesh(kit.box(w, h, d, 0.004), blackPlastic())
		const dome = mesh(kit.latheX([[0, w / 2 - 0.0035], [0.0085, w / 2 - 0.0035], [0.0085, w / 2 - 0.0005], [0.006, w / 2 + 0.0], [0, w / 2 + 0.0003]], 32, `meterDome|${f5(w)}`), kit.mat("optics-diffuser", { color: "#f6f6f2", roughness: 0.6, metalness: 0, transmission: 0.2, thickness: 0.003 }))
		dome.castShadow = false
		const lcd = mesh(new T.PlaneGeometry(w * 0.86, h * 0.5), kit.mat("optics-lcd", { color: "#b8c7a4", emissive: new T.Color("#9fb08b"), emissiveIntensity: 0.25, roughness: 0.3, metalness: 0 }))
		lcd.name = "lcd"
		lcd.position.set(0, -h * 0.12, d / 2 + 0.0003)
		const g = group(body, dome, lcd)
		g.userData.frame = { hook: "optics:lcd" }
		return g
	})

	// ============================================================== light target: a printed bullseye board; its middle glows when light reaches it
	addFrameHook("optics:hit", (obj, f) => {
		const hit = Number(f.state?.hit) > 0.5
		const dot = obj.getObjectByName("hitglow")
		if (dot) {
			const m = ownMaterial(dot)
			m.emissiveIntensity = hit ? 2.5 : 0
		}
	})
	addModel("light-sensor", "board", (ctx) => {
		const { w, h } = ctx
		const r = h / 2
		const face = kit.printed("optics-bullseye", (g, W, H) => {
			const cols = ["#f5f2ea", "#c62828"]
			for (let k = 5; k >= 1; k--) {
				g.fillStyle = cols[k % 2]
				g.beginPath()
				g.arc(W / 2, H / 2, (k / 5) * (W / 2 - 4), 0, Math.PI * 2)
				g.fill()
			}
		}, { w: 512, h: 512, roughness: 0.7 })
		const disc = new T.CircleGeometry(r, 64)
		const front = mesh(disc, face)
		front.rotation.y = Math.PI / 2
		front.position.x = w / 2 + 0.0002
		const back = mesh(disc, face)
		back.rotation.y = -Math.PI / 2
		back.position.x = -w / 2 - 0.0002
		const rim = mesh(kit.latheX([[0, -w / 2], [r, -w / 2], [r, w / 2], [0, w / 2]], 64, `targetRim|${f5(r)}|${f5(w)}`), kit.paper("#d9d4c6"))
		const glow = mesh(new T.CircleGeometry(r * 0.2, 32), emissive("target", "#ff4a2a", 0))
		glow.name = "hitglow"
		glow.rotation.y = Math.PI / 2
		glow.position.x = w / 2 + 0.0005
		const g = group(rim, front, back, glow)
		g.userData.frame = { hook: "optics:hit" }
		return g
	})

	// ============================================================== eye: a white eyeball, its iris and pupil looking along its aim
	addModel("eye", "eye", (ctx) => {
		const r = ctx.r
		const ball = mesh(kit.sphere(r, 40, 24), kit.ceramic("#f4f1ea"))
		const aim = ((Number(ctx.props.aim) || 0) * Math.PI) / 180
		const iris = mesh(kit.sphere(r * 1.001, 40, 24), kit.mat("optics-iris", { color: "#4a7a9b", roughness: 0.3, metalness: 0, clearcoat: 1 }))
		// (a cap of the sphere: scale a sphere into a lens-shaped iris at the front)
		iris.scale.set(0.18, 0.5, 0.5)
		iris.position.x = r * 0.86
		const pupil = mesh(kit.sphere(r * 1.002, 24, 16), kit.mat("optics-pupil", { color: "#050505", roughness: 0.2, metalness: 0, clearcoat: 1 }))
		pupil.scale.set(0.1, 0.24, 0.24)
		pupil.position.x = r * 0.93
		const look = group(iris, pupil)
		look.rotation.z = aim
		return group(ball, look)
	})

	// ============================================================== the sun: a glowing disc
	addModel("sunlight", "disc", (ctx) => {
		const s = mesh(kit.sphere(ctx.r, 32, 16), emissive("sun", "#ffd34d", 2.2))
		s.name = "glow"
		s.castShadow = false
		const g = group(s)
		g.userData.frame = { hook: "optics:glow", strength: 2.2 }
		return g
	})
	// its catalog photo (in a scene the plug-in lights everything with it, and its disc is hidden in the sky): the glowing disc, and three of
	// its parallel rays coming down at its elevation from its side to the table
	addThumb?.("sunlight", ({ props }) => {
		const el = (Math.min(89, Math.max(5, Number(props.elevation) || 45)) * Math.PI) / 180
		const sx = props.comes_from === "right" ? -1 : 1 // (the way its light travels along x)
		// (a warm disc that reads as the sun on a light card too: the scene's own glow, 2.2 over white, photographs nearly white)
		const sun = mesh(kit.sphere(0.05, 32, 16), kit.mat("optics-sunthumb", { color: "#ffb21f", emissive: new T.Color("#ff9d00"), emissiveIntensity: 0.55, roughness: 0.55, metalness: 0 }))
		sun.castShadow = false
		const top = 0.3
		const start = { x: -sx * (top / Math.tan(el)) * 0.5, y: top }
		sun.position.set(start.x - sx * 0.07 * Math.cos(el), start.y + 0.07 * Math.sin(el), 0)
		const ray = kit.mat("optics-sunray", { color: "#ffc22e", emissive: new T.Color("#ffab00"), emissiveIntensity: 0.45, roughness: 0.5, metalness: 0 })
		const g = group(sun)
		for (const off of [-0.035, 0, 0.035]) {
			const ox = start.x + off * Math.sin(el)
			const oy = start.y + sx * off * Math.cos(el)
			const len = oy / Math.sin(el)
			const r = mesh(kit.box(len, 0.005, 0.005, 0.0008), ray, { cast: false })
			r.position.set(ox + (sx * len * Math.cos(el)) / 2, oy / 2, 0)
			r.rotation.z = sx > 0 ? -el : el
			g.add(r)
		}
		return g
	})

	// ============================================================== lit arrow: a light box with a glowing arrow cut into its front (+x)
	addModel("lit-arrow", "box", (ctx) => {
		const { w, h, d } = ctx
		const box = mesh(kit.box(w, h, d, 0.002), blackPlastic())
		const ah = h - 0.02
		const shape = new T.Shape()
		const sw = Math.min(0.004, d * 0.08)
		shape.moveTo(-sw / 2, -ah / 2)
		shape.lineTo(sw / 2, -ah / 2)
		shape.lineTo(sw / 2, ah / 2 - 0.012)
		shape.lineTo(sw * 2.4, ah / 2 - 0.012)
		shape.lineTo(0, ah / 2)
		shape.lineTo(-sw * 2.4, ah / 2 - 0.012)
		shape.lineTo(-sw / 2, ah / 2 - 0.012)
		shape.closePath()
		const arrow = mesh(new T.ShapeGeometry(shape), emissive("arrow", "#fff4dc", 3))
		arrow.name = "glow"
		arrow.rotation.y = Math.PI / 2
		arrow.position.x = w / 2 + 0.0003
		const g = group(box, arrow)
		g.userData.frame = { hook: "optics:glow", strength: 3 }
		return g
	})

	// ============================================================== the light: beams, pools and lights (one plug-in per run)
	addViewPlugin({
		name: "optics:light",
		load(ctx) {
			const rec = (ctx.doc?.processes ?? []).find((p) => p && p.kind === "optics")
			if (!rec) return null
			const solids = new Map(ctx.doc.solids.map((s) => [s.id, s]))
			const sc = O.sceneFromRecord(rec, (id) => solids.get(id))
			const watched = [...new Set([...sc.bodies.map((b) => b.id), ...sc.sources.map((s) => s.solid).filter((s) => s !== "")])]
			const g = ctx.group
			// materials: additive, unlit, no depth writes (light adds to what is behind it)
			const sheetMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false })
			const poolMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
			const laserMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, side: T.DoubleSide })
			const haloMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, side: T.DoubleSide })
			const sheets = new T.Mesh(new T.BufferGeometry(), sheetMat)
			const pools = new T.Mesh(new T.BufferGeometry(), poolMat)
			const lasers = new T.Mesh(new T.BufferGeometry(), laserMat)
			const halos = new T.Mesh(new T.BufferGeometry(), haloMat)
			for (const m of [sheets, pools, lasers, halos]) {
				m.frustumCulled = false
				m.castShadow = false
				m.receiveShadow = false
				m.renderOrder = 10
				g.add(m)
			}
			// three.js lights for the look of the room (spots for the cones, a directional for the sun)
			const lights = []
			let shadows = 0
			sc.sources.forEach((s, i) => {
				let L = null
				const src = rec.sources[i]
				const P = O.powerOf(src)
				let vis = 0
				for (let k = 0; k < 7; k++) vis += P[k]
				const lm = O.lumens(P, s.nm)
				if (s.kind === "sun") {
					L = new T.DirectionalLight(0xfff3e0, Math.min(5, 1.2 + 0.0035 * (src.irradiance ?? 1000)))
					L.castShadow = shadows < 2
					if (L.castShadow) {
						shadows++
						L.shadow.mapSize.set(2048, 2048)
						Object.assign(L.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 40 })
						L.shadow.bias = -0.0004
					}
					g.add(L.target)
				} else if ((s.kind === "flashlight" || s.kind === "lamp") && s.spread > 1.6) {
					// a bare bulb (a circuit's) lights all round: no room light of its own (a torch bulb is a candela or two); the traced pools of
					// its light on what it reaches, and its haze, show it (its own glow is the circuits model's)
				} else if (s.kind === "flashlight" || s.kind === "lamp") {
					const cone = Math.min(Math.PI / 2 - 0.01, Math.max(0.02, s.spread))
					const I = lm / (2 * Math.PI * (1 - Math.cos(cone)) || 1)
					// (its colour: a white torch's warm white, a red, green or blue torch's or LED's own)
					const [cr, cg, cb] = colourOf(P, s.nm)
					L = new T.SpotLight(src.light === "led" || src.light === "incandescent" || src.light === "halogen" || src.light === undefined ? 0xfff5e8 : new T.Color(cr, cg, cb), Math.min(40, 0.008 * I), 0, cone, 0.5, 2)
					L.castShadow = shadows < 2
					if (L.castShadow) {
						shadows++
						L.shadow.mapSize.set(1024, 1024)
						L.shadow.camera.near = 0.02
						L.shadow.camera.far = 12
						L.shadow.bias = -0.0005
					}
					g.add(L.target)
				}
				if (L) {
					L.userData.src = i
					g.add(L)
					lights.push(L)
				}
			})
			// each source's reference brightness: its light 30 cm out along its axis (the sun: its irradiance), so every beam shows as a soft haze
			// whatever its power, fading as its light spreads (1/d²)
			const refE = sc.sources.map((s, i) => {
				const P = O.powerOf(rec.sources[i])
				let w = 0
				for (let k = 0; k < 8; k++) w += P[k]
				if (s.kind === "sun") return Math.max(1e-9, w)
				const cone = s.round ? 2 * Math.PI * (1 - Math.cos(Math.max(0.02, s.spread))) : 2 * Math.max(0.02, s.spread) * 2 * Math.sin(Math.min(Math.PI / 2, Math.max(0.02, s.outSpread)))
				// (a bare bulb lights the whole room, dimly: its reference is its light 10 cm out, so its haze and pools fade within a hand's
				// width or two, as a torch bulb's glow does, instead of washing the scene)
				const bare = s.outSpread > 1.2 && s.round !== true && s.spread > 1.6
				return Math.max(1e-9, w / cone / (bare ? 0.01 : 0.09))
			})
			const laserP = sc.sources.map((s, i) => {
				const P = O.powerOf(rec.sources[i])
				let w = 0
				for (let k = 0; k < 8; k++) w += P[k]
				return Math.max(1e-12, w)
			})
			// the sun: a glowing disc where its marker is (its solid is not drawn)
			let sunTex = null
			sc.sources.forEach((s, i) => {
				if (s.kind !== "sun") return
				const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(128, 128) : document.createElement("canvas")
				c.width = 128
				c.height = 128
				const q = c.getContext("2d")
				const grd = q.createRadialGradient(64, 64, 6, 64, 64, 64)
				grd.addColorStop(0, "rgba(255,250,225,1)")
				grd.addColorStop(0.28, "rgba(255,226,120,0.95)")
				grd.addColorStop(0.5, "rgba(255,190,60,0.35)")
				grd.addColorStop(1, "rgba(255,170,40,0)")
				q.fillStyle = grd
				q.fillRect(0, 0, 128, 128)
				sunTex = new T.CanvasTexture(c)
				sunTex.colorSpace = T.SRGBColorSpace
				const sp = new T.Sprite(new T.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, toneMapped: false }))
				sp.scale.set(0.22, 0.22, 1)
				const src = rec.sources[i]
				sp.position.set(src.x, src.y, 0)
				sp.renderOrder = 11
				g.add(sp)
			})
			let lastKey = ""
			const posAt = (t) => {
				const m = new Map()
				for (const id of watched) {
					const p = ctx.placementAt(id, t)
					if (p) m.set(id, { x: p.x, y: p.y, angle: p.angle })
					else {
						const s = solids.get(id)
						if (s) m.set(id, { x: s.at.x, y: s.at.y, angle: s.angle ?? 0 })
					}
				}
				return m
			}
			// a source's level: its `on` reading (blinks included), times its drive (a circuit bulb's `light` against rated)
			const levelAt = (t) =>
				sc.sources.map((s, i) => {
					const r = rec.sources[i]
					const on = ctx.stateAt(s.item, "on", t)
					let v = on === null || on === undefined ? O.switchedOn(r, t) : on > 0.5 ? 1 : 0
					if (v > 0 && r.drive && typeof r.drive.item === "string") {
						const d = ctx.stateAt(r.drive.item, r.drive.key, t)
						v *= Math.max(0, typeof d === "number" ? d : 0) * (typeof r.drive.scale === "number" ? r.drive.scale : 1)
					}
					return v
				})
			// liquids: their surfaces where the liquids module's level readings put them at a time
			const hasLevels = sc.bodies.some((b) => b.level !== undefined)
			const readAt = (t) => (item, key) => {
				const v = ctx.stateAt(item, key, t)
				return typeof v === "number" ? v : undefined
			}
			const draw = (res, poses, levels) => {
				// sheets between neighbouring rays of a fan; laser lines; pools on what the light lands on
				const sp = []
				const sc_ = []
				const pp = []
				const pc = []
				const lp = []
				const lc = []
				const hp = []
				const hc = []
				const bySrc = new Map()
				for (const sg of res.segments) {
					if (!bySrc.has(sg.src)) bySrc.set(sg.src, new Map())
					const roots = bySrc.get(sg.src)
					if (!roots.has(sg.root)) roots.set(sg.root, [])
					roots.get(sg.root).push(sg)
				}
				// (a ray that leaves the scene is drawn 50 m along its own direction: clipped along the line, never per coordinate, which would
				// bend it toward a 45° corner)
				const endOf = (sg) => {
					const dx = sg.x1 - sg.x0
					const dy = sg.y1 - sg.y0
					const L = Math.hypot(dx, dy)
					const k = L > 50 ? 50 / L : 1
					return [sg.x0 + dx * k, sg.y0 + dy * k]
				}
				for (const [si, roots] of bySrc) {
					const src = sc.sources[si]
					if (src.kind === "laser") {
						for (const list of roots.values())
							for (const sg of list) {
								const pw = sg.p.reduce((a, b) => a + b, 0)
								// (its strength against the laser's own: a 4 % reflection shows faint)
								const a = Math.min(1, Math.max(0.12, Math.pow(pw / laserP[si], 0.5)))
								const [r, gg, b] = colourOf(sg.p, sg.nm)
								const [x1, y1] = endOf(sg)
								const dx = x1 - sg.x0
								const dy = y1 - sg.y0
								const l = Math.hypot(dx, dy) || 1
								for (const [w, P, C, k0] of [[0.0008, lp, lc, a], [0.0035, hp, hc, 0.35 * a]]) {
									const nx = (-dy / l) * w
									const ny = (dx / l) * w
									for (const z of [0, 1]) {
										// two crossed ribbons (in the plane and across it) so the line shows from any side
										const q = z === 0 ? [[sg.x0 + nx, sg.y0 + ny, 0], [sg.x0 - nx, sg.y0 - ny, 0], [x1 - nx, y1 - ny, 0], [x1 + nx, y1 + ny, 0]] : [[sg.x0, sg.y0, w], [sg.x0, sg.y0, -w], [x1, y1, -w], [x1, y1, w]]
										for (const k of [0, 1, 2, 0, 2, 3]) {
											P.push(...q[k])
											// (the core is the colour itself, dimmed toward the background as it weakens; the halo adds light)
											C.push(r * k0 + (P === lp ? (1 - k0) * 0.75 : 0), gg * k0 + (P === lp ? (1 - k0) * 0.75 : 0), b * k0 + (P === lp ? (1 - k0) * 0.75 : 0))
										}
									}
								}
								// the spot where it lands
								if (sg.end >= 0) {
									const s = 0.004
									const q = [[x1 - s, y1 - s, 0.0015], [x1 + s, y1 - s, 0.0015], [x1 + s, y1 + s, 0.0015], [x1 - s, y1 + s, 0.0015]]
									for (const k of [0, 1, 2, 0, 2, 3]) {
										pp.push(...q[k])
										pc.push(r * a, gg * a, b * a)
									}
								}
							}
						continue
					}
					const ids = [...roots.keys()].sort((a, b) => a - b)
					// white light split into its colours at a refracting surface that stay together (a flat panel, a block, a lens: the bands
					// leave the same point and land within a hair of each other) is drawn as the one white beam it looks like; colours drawn
					// apart are the ones a prism really spreads
					const mergeBands = (list) => {
						const out = []
						for (const sg of list) {
							if (!(sg.nm > 0)) {
								out.push(sg)
								continue
							}
							const L = Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0)
							const tol = Math.max(1e-3, 2e-3 * Math.min(L, 50))
							const m = out.find((r) => r.bands && r.end === sg.end && Math.abs(r.x0 - sg.x0) <= 5e-4 && Math.abs(r.y0 - sg.y0) <= 5e-4 && Math.abs(r.x1 - sg.x1) <= tol && Math.abs(r.y1 - sg.y1) <= tol)
							if (m) {
								for (let k = 0; k < 8; k++) m.p[k] += sg.p[k]
								m.key = Math.min(m.key, sg.key)
								m.bands++
								m.nm = 0
							} else out.push({ ...sg, p: Array.from(sg.p), bands: 1 })
						}
						return out
					}
					const keyed = (list) => {
						const m = new Map()
						const count = new Map()
						for (const sg of list) {
							const n = count.get(sg.key) ?? 0
							count.set(sg.key, n + 1)
							m.set(`${sg.key}|${n}`, sg)
						}
						return m
					}
					let prev = null
					for (const ri of ids) {
						const cur = keyed(mergeBands(roots.get(ri)))
						if (prev) {
							for (const [k, a] of prev) {
								const b = cur.get(k)
								if (!b) continue
								// the sheet's brightness: the light per metre across the fan per metre of height out of the plane (W/m²), as dusty air shows it
								const pa = a.p.reduce((x, y) => x + y, 0)
								const pb = b.p.reduce((x, y) => x + y, 0)
								const w0 = Math.hypot(a.x0 - b.x0, a.y0 - b.y0)
								const w1 = Math.hypot(a.x1 - b.x1, a.y1 - b.y1)
								// (a bare bulb's tube spreads out of the plane up to 90°: the tracer's heights take tan ψ at most 1e6, so its light per metre
								// of height at the plane is that of ψ = 45°, the height ÷ 1e6)
								const bare = src.outSpread > 1.2 && src.round !== true
								const hh0 = Number.isFinite(a.h0) ? Math.max(0.003, bare ? a.h0 * 1e-6 : a.h0) : 1
								const hh1 = Number.isFinite(a.h1) ? Math.max(0.003, bare ? a.h1 * 1e-6 : a.h1) : 1
								const sun = src.kind === "sun"
								const e0 = (pa + pb) / 2 / Math.max(w0, 0.002) / (sun ? 1 : 2 * hh0)
								const e1 = (pa + pb) / 2 / Math.max(w1, 0.002) / (sun ? 1 : 2 * hh1)
								const al = (e) => (src.kind === "object" ? 0.012 : 0.12) * Math.min(1, Math.pow(e / refE[si], 0.7))
								const [r, gg, bb] = colourOf(a.p, a.nm)
								const A0 = al(e0)
								let A1 = al(e1)
								let [bx1, by1] = endOf(b)
								let [ax1, ay1] = endOf(a)
								if (bare) {
									// (a bare bulb's haze: a glow that fades out within GLOW m of where its light starts, never a sheet across the room)
									const GLOW = 0.3
									const cut = (sg, x1, y1) => {
										const L = Math.hypot(x1 - sg.x0, y1 - sg.y0)
										const k = L > GLOW ? GLOW / L : 1
										return [sg.x0 + (x1 - sg.x0) * k, sg.y0 + (y1 - sg.y0) * k, k < 1]
									}
									const ca = cut(a, ax1, ay1)
									const cb = cut(b, bx1, by1)
									;[ax1, ay1] = ca
									;[bx1, by1] = cb
									if (ca[2] || cb[2]) A1 = 0
								}
								const q = [[a.x0, a.y0, A0], [b.x0, b.y0, A0], [bx1, by1, A1], [ax1, ay1, A1]]
								for (const k of [0, 1, 2, 0, 2, 3]) {
									sp.push(q[k][0], q[k][1], -0.0005)
									sc_.push(r * q[k][2], gg * q[k][2], bb * q[k][2])
								}
								// a pool where both land on the same face of a thing, for light the room's three.js lights cannot show (reflected, bent,
								// filtered or split): a strip across its depth, as tall out of the plane as the light is there
								if (a.end >= 0 && a.end === b.end && (a.key !== 1 || !lights.some((L) => L.userData.src === si))) {
									const body = sc.bodies[a.end]
									const za = Math.min(body.halfDepth * 0.98, Math.max(0.003, Number.isFinite(a.h1) ? a.h1 : body.halfDepth))
									const zb = Math.min(body.halfDepth * 0.98, Math.max(0.003, Number.isFinite(b.h1) ? b.h1 : body.halfDepth))
									// (a bare bulb's tube is spread up to 90° out of the plane: only the share within the body's depth lands on it)
									const share = bare && Number.isFinite(a.h1) ? Math.min(1, (za + zb) / 2 / Math.max(1e-6, a.h1 * 1e-6)) : 1
									const E = (share * (pa + pb)) / 2 / Math.max(w1, 0.001) / (sun ? 1 : za + zb)
									const A = (src.kind === "object" ? 0.2 : 1) * Math.min(0.5, 0.35 * Math.sqrt(E / refE[si]))
									const pts = [[a.x1, a.y1, -za], [b.x1, b.y1, -zb], [b.x1, b.y1, zb], [a.x1, a.y1, za]]
									for (const k of [0, 1, 2, 0, 2, 3]) {
										pp.push(...pts[k])
										pc.push(r * A, gg * A, bb * A)
									}
								}
							}
						}
						prev = cur
					}
				}
				const set = (mesh_, pos, col) => {
					const geo = new T.BufferGeometry()
					geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
					geo.setAttribute("color", new T.Float32BufferAttribute(col, 3))
					mesh_.geometry.dispose()
					mesh_.geometry = geo
				}
				set(sheets, sp, sc_)
				set(pools, pp, pc)
				set(lasers, lp, lc)
				set(halos, hp, hc)
				// the three.js lights follow their sources
				for (const L of lights) {
					const i = L.userData.src
					const s = sc.sources[i]
					const on = levels[i] > 0
					L.visible = on
					const pose = s.solid === "" ? { x: 0, y: 0, angle: 0 } : poses.get(s.solid)
					if (!pose) continue
					const c = Math.cos(pose.angle)
					const sn = Math.sin(pose.angle)
					const px = pose.x + c * s.x - sn * s.y
					const py = pose.y + sn * s.x + c * s.y
					const d = s.dirVec ? [s.dirVec.x, s.dirVec.y] : [Math.cos(s.dir), Math.sin(s.dir)]
					const ux = c * d[0] - sn * d[1]
					const uy = sn * d[0] + c * d[1]
					if (s.kind === "sun") {
						L.position.set(px - ux * 6, py - uy * 6, 2.5)
						L.target.position.set(px, py, 0)
					} else {
						L.position.set(px, py, 0)
						L.target?.position.set(px + ux, py + uy, 0)
					}
					L.target?.updateMatrixWorld()
				}
			}
			return {
				frame(t) {
					const poses = posAt(t)
					const levels = levelAt(t)
					let key = levels.map((v) => v.toFixed(3)).join(",")
					for (const [id, p] of poses) key += `|${id}:${p.x.toFixed(4)},${p.y.toFixed(4)},${p.angle.toFixed(4)}`
					const read = hasLevels ? readAt(t) : null
					if (read) key += `|${O.levelReadings(sc.bodies, read).map((v) => (Number.isFinite(v) ? v.toFixed(2) : "-")).join(",")}`
					if (key === lastKey) return
					lastKey = key
					let res
					try {
						const bodies = read ? O.withLevels(sc.bodies, read) : sc.bodies
						res = O.trace({ bodies, sources: sc.sources, pose: (id) => poses.get(id), level: (s) => levels[sc.sources.indexOf(s)] ?? 0, segments: true })
					} catch (e) {
						console.warn("optics: trace failed", e)
						return
					}
					draw(res, poses, levels)
				},
				dispose() {
					for (const m of [sheets, pools, lasers, halos]) m.geometry.dispose()
					sheetMat.dispose()
					poolMat.dispose()
					laserMat.dispose()
					haloMat.dispose()
					sunTex?.dispose()
					for (const L of lights) L.dispose?.()
				}
			}
		}
	})
}
