// 3D models of the air module (machines/mod_air.py): latex party balloons (with a pump, a string and a weight), a tissue-paper hot-air balloon
// on its launch stand over a heat gun, an incense stick and its smoke, a cup anemometer, a bell jar on a vacuum pump, an upside-down glass of
// water with a card, a suction cup holding slotted masses, a soda can on a camping stove crushed in a dish of cold water, paper airplanes and a
// balsa glider, and a diamond kite with its tail. Readings drive what moves (web/view-plugins.js): the anemometer's cups (turns), the jar's
// gauge (pressure_kpa), the hot-air balloon's glow (inside_c) and heat gun (heating_w), the card's water (water), the can's crush (crushed),
// steam (steaming) and tongs (tongs); the smoke is drawn from the engine's particles (track.series[item].smoke), a popped balloon's shreds
// from its `popped` reading, a kite's sail roll and its tail by the "air:kites" plugin (what is under it, the wind_ms reading). Frames (web/models3d.js): a slab's centre, a ball's centre, a polygon's own origin; +z toward the camera.
import { makeLib } from "./surfaces-lib.js"
import { frameIndex } from "../track.js"

const PAINT = { red: "#d62828", blue: "#1f5fbf", yellow: "#f2c230", green: "#2e9e44", orange: "#f07f1a", purple: "#7b3fb0", pink: "#ec6fa5", white: "#f4f4f0", silver: "#c9ced3", black: "#222222" }
const STRIPES = { "red and yellow": ["#d8342a", "#f2c230"], "blue and white": ["#1f5fbf", "#f4f4f0"], "green and white": ["#2e9e44", "#f4f4f0"], rainbow: ["#d62828", "#f07f1a", "#f2c230", "#2e9e44", "#1f5fbf", "#7b3fb0"] }
// (machines/mod_air.py DESIGNS: span, each surface's aerodynamic centre from the balance point, chord; the outline's centroid is worked out here)
const DESIGNS = {
	dart: { span: 0.13, wing: [0.0113, 0.16], tail: [-0.11, 0.048], outline: [[0.132, 0.0015], [-0.148, 0.004], [-0.148, -0.006], [0.0, -0.022]] },
	glider: { span: 0.22, wing: [0.0138, 0.15], tail: [-0.12, 0.05], outline: [[0.13, 0.0015], [-0.15, 0.004], [-0.15, -0.006], [0.02, -0.018]] },
	"balsa glider": { span: 0.30, wing: [0.01155, 0.05], tail: [-0.17, 0.035], outline: [[0.12, 0.002], [-0.16, 0.004], [-0.16, -0.004], [0.10, -0.008]] }
}
// The kite's sail: drawn rolled KITE_ROLL (35°) about its spine toward the camera while it has room under it; its sail sits KITE_SAIL_Y below the
// spine, inside its 8 mm plank. Its tail (machines/mod_air.py: a 3 cm ribbon, C_d 0.1 on tail_m × 0.03 m², the engine's own numbers) weighs
// about 1.4 g a metre: a 3 cm strip of ripstop nylon at about 40 g/m² (the kite material's own source) and its bows.
const KITE_ROLL = 0.61
const KITE_SAIL_Y = -0.0025
const TAIL_WIDTH = 0.03
const TAIL_CD = 0.1
const TAIL_KG_M = 0.0014
const ROOM_FLOOR = -0.75 // web/view3d.js: the room's floor (y), under the tabletop's cabinet
const centroidX = (pts) => {
	let a = 0
	let cx = 0
	for (let k = 0; k < pts.length; k++) {
		const [x1, y1] = pts[k]
		const [x2, y2] = pts[(k + 1) % pts.length]
		const c = x1 * y2 - x2 * y1
		a += c
		cx += (x1 + x2) * c
	}
	return cx / (3 * a)
}

export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const { T, TAU, M, f5, mesh, put, clamp } = L
	const group = (...c) => kit.group(...c)
	const steel = () => kit.steel()
	const plastic = (hex, gloss = 0.5) => L.plasticMat(hex, gloss)
	const wood = (hex = "#b98a55") => kit.wood(hex)
	const glass = (opacity = 0.16, tint = "#eef6f4") =>
		M(`air-glass|${tint}|${opacity}`, { color: tint, roughness: 0.03, metalness: 0, transparent: true, opacity, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.3, side: T.DoubleSide })
	const water = () => M("air-water2", { color: "#8cc8ee", roughness: 0.04, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03 })
	/** A drinking glass: a faint front-facing shell with a bright clear coat (so what is in it shows). */
	const tumblerGlass = () => M("air-tumbler", { color: "#f4fbff", roughness: 0.02, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.4 })
	const latex = (hex) =>
		hex === PAINT.silver
			? M(`air-foil|${hex}`, { color: "#d9dde2", roughness: 0.12, metalness: 1, envMapIntensity: 1.4 })
			: M(`air-latex|${hex}`, { color: hex, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new T.Color(hex), specularIntensity: 0.9 })

	// ------------------------------------------------------------- party balloon
	addModel("party-balloon", "balloon", (ctx) => {
		const r = ctx.r
		const hex = ctx.color ?? PAINT.red
		// On a pump its neck is stretched down over the pump's nozzle (below its ball, into its own nozzle) and it has no knot. Otherwise the whole
		// balloon, neck and knot, stays inside its ball (its physics), so it never sinks into what it rests on: round on top and at its widest, its
		// lower half tapering to the neck (an inflated latex balloon's inverted teardrop), the knot's bottom at the ball's bottom; an untied one
		// has an open neck, no knot.
		const pumped = (ctx.props?.pump_lps ?? 0) > 0
		const knotted = !pumped && ctx.props?.tied !== false
		const lift = pumped ? 0 : 0.125 * r // (the old neck and knot reached 0.125 r below the ball)
		const low = pumped ? 1 : 1 - lift / r // the lower half's height, a share of r
		const prof = []
		for (let i = 0; i <= 32; i++) {
			const a = -Math.PI / 2 + (Math.PI * i) / 32
			const c = Math.cos(a)
			const rr = r * (a < 0 && !pumped ? Math.pow(c, 1.25) : c)
			prof.push([i === 0 ? (pumped ? 0.08 : 0.04) * r : rr, r * Math.sin(a) * (a < 0 ? low : 1)])
		}
		const body = mesh(kit.lathe(prof, 64, `air-bal|${pumped ? "p" : "t"}|${f5(r)}`), latex(hex))
		const neck = mesh(kit.lathe([[0.0001, -r - 0.11 * r + lift], [0.05 * r, -r - 0.1 * r + lift], [0.045 * r, -r - 0.02 * r + lift], [0.1 * r, -r + 0.012 * r + lift]], 24, `air-neck|${f5(r)}|${f5(lift)}`), latex(hex))
		const knot = knotted ? put(mesh(kit.torus(0.05 * r, 0.025 * r, 10, 20), latex(hex)), 0, -r - 0.1 * r + lift, 0, Math.PI / 2, 0, 0) : null
		const g = group(body, neck, knot)
		g.userData.frame = { hook: "air:balloon" }
		return g
	})
	addModel("party-balloon", "weight", (ctx) => {
		const w = ctx.w
		const h = ctx.h
		const g = group(put(mesh(kit.lathe([[0.0001, -h / 2], [w / 2, -h / 2], [w / 2.4, h / 2 - 0.004], [0.004, h / 2]], 32, `air-bw|${f5(w)}|${f5(h)}`), ctx.solid.kind === "static" ? steel() : plastic("#c9ced3", 0.8)), 0, 0, 0))
		return g
	})
	addModel("party-balloon", "nozzle", (ctx) => put(mesh(kit.cylinderY(ctx.w / 2, ctx.h, 24, ctx.w / 3), plastic("#2f6db5", 0.6)), 0, 0, 0))
	addModel("party-balloon", "pump", (ctx) => {
		const w = ctx.w
		const h = ctx.h
		const barrel = mesh(kit.cylinderY(w / 2, h, 32), M("air-pumpbarrel", { color: "#f2f6fb", roughness: 0.2, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 0.8, depthWrite: false }))
		const rod = put(mesh(kit.cylinderY(0.004, h * 0.9, 12), steel()), 0, -0.02, 0)
		const piston = put(mesh(kit.cylinderY(w / 2 - 0.004, 0.02, 32), kit.rubber("#2a2a2a")), 0, h * 0.15, 0)
		const cap = put(mesh(kit.cylinderY(w / 2 + 0.003, 0.02, 32), plastic("#2f6db5", 0.6)), 0, h / 2 - 0.01, 0)
		return group(barrel, rod, piston, cap)
	})
	addModel("party-balloon", "foot", (ctx) => mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.004), plastic("#2f6db5", 0.6)))
	// (a popped balloon's body is resized to nothing by the engine: the hook hides it; the "air:pops" plugin throws its shreds)
	addFrameHook("air:balloon", (obj, f) => {
		obj.visible = !(f.state?.popped >= 1)
	})

	// ------------------------------------------------------------- hot-air balloon
	function gores(names) {
		const cols = STRIPES[names] ?? STRIPES["red and yellow"]
		return L.bake(`air-gores|${names}`, 512, 256, (u, v, o) => {
			const k = Math.floor(u * 16) % cols.length
			const c = new T.Color(cols[k])
			const seam = Math.abs(((u * 16) % 1) - 0.5) > 0.47 ? 0.8 : 1
			const fib = 0.94 + 0.06 * L.pfbm(u, v, 24, 12, 31, 3)
			o.r = c.r * 255 * seam * fib
			o.g = c.g * 255 * seam * fib
			o.b = c.b * 255 * seam * fib
			o.h = 0.5 + 0.1 * (L.pfbm(u, v, 40, 20, 77, 3) - 0.5)
			o.rough = 0.85
		}, { normal: 0.6 })
	}
	addModel("hot-air-balloon", "envelope", (ctx) => {
		const R = ctx.r
		const D = ctx.props?.size ?? 2 * R
		const a = 0.18 * D
		const below = Math.sqrt(Math.max(0, R * R - a * a))
		// the classic shape: the sphere above its middle, then a smooth taper down to its mouth ring
		const prof = []
		for (let i = 0; i <= 20; i++) {
			const y = -below + ((below + 0.25 * R) * i) / 20
			const u = i / 20
			const rr = a + (Math.sqrt(Math.max(0, R * R - 0.0625 * R * R)) - a) * Math.sin((u * Math.PI) / 2)
			prof.push([Math.min(rr, Math.sqrt(Math.max(0, R * R - y * y))), y])
		}
		for (let i = 1; i <= 24; i++) {
			const ang = Math.asin(0.25) + ((Math.PI / 2 - Math.asin(0.25)) * i) / 24
			prof.push([i === 24 ? 0.0001 : R * Math.cos(ang), R * Math.sin(ang)])
		}
		const t = gores(ctx.props?.color ?? "red and yellow")
		const m = M(`air-envelope|${ctx.props?.color}`, { map: t.map, normalMap: t.normalMap, normalScale: new T.Vector2(0.3, 0.3), roughness: 0.85, metalness: 0, side: T.DoubleSide, emissive: new T.Color("#ff8a3a"), emissiveIntensity: 0 })
		const env = mesh(kit.lathe(prof, 64, `air-env|${f5(R)}|${f5(a)}`), m)
		env.userData.frame = { hook: "air:warm" }
		return group(env)
	})
	addFrameHook("air:warm", (obj, f) => {
		const T0 = f.state?.inside_c
		if (!Number.isFinite(T0)) return
		const own = ownMaterial(obj)
		if (own) own.emissiveIntensity = clamp((T0 - 40) / 80, 0, 0.35)
	})
	addModel("hot-air-balloon", "ring", (ctx) => {
		const a = ctx.w / 2 - 0.01
		return put(mesh(kit.torus(a, 0.0025, 10, 48), steel()), 0, 0, 0, Math.PI / 2, 0, 0)
	})
	addModel("hot-air-balloon", "base", (ctx) => mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.003), wood("#a8743f")))
	for (const p of ["post-left", "post-right"]) addModel("hot-air-balloon", p, (ctx) => mesh(kit.cylinderY(0.003, ctx.h, 12), steel()))
	addModel("hot-air-balloon", "gun", (ctx) => {
		// a heat gun standing on its end: its body (a tapered barrel), a pistol grip sticking out behind, a switch
		const body = mesh(kit.cylinderY(0.032, ctx.h, 32, 0.026), plastic("#d4541c", 0.5))
		const grip = put(mesh(kit.box(0.03, 0.1, 0.035, 0.008), plastic("#2a2a2a", 0.3)), 0, -0.02, -0.05, 0.35, 0, 0)
		const vent = put(mesh(kit.cylinderY(0.033, 0.03, 32), plastic("#2a2a2a", 0.3)), 0, -ctx.h / 2 + 0.02, 0)
		return group(body, grip, vent)
	})
	addModel("hot-air-balloon", "gun-nozzle", (ctx) => {
		const n = mesh(kit.cylinderY(0.02, ctx.h, 32, 0.016), M("air-gun-nozzle", { color: "#b9bec5", roughness: 0.35, metalness: 1, emissive: new T.Color("#ff5a1a"), emissiveIntensity: 0 }))
		n.userData.frame = { hook: "air:gun" }
		return group(n)
	})
	addFrameHook("air:gun", (obj, f) => {
		const own = ownMaterial(obj)
		if (own) own.emissiveIntensity = clamp((f.state?.heating_w ?? 0) / 900, 0, 1) * (0.8 + 0.2 * Math.sin(f.t * 23))
	})

	// ------------------------------------------------------------- incense stick
	addModel("incense-stick", "holder", (ctx) => {
		const w = ctx.w
		const h = ctx.h
		return mesh(kit.extrude([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2 - 0.006, h / 2], [-w / 2 + 0.006, h / 2]], ctx.d, { bevel: 0.002, key: `air-holder|${f5(w)}` }), wood("#6b4a2b"))
	})
	addModel("incense-stick", "stick", (ctx) => {
		const h = ctx.h
		const stick = mesh(kit.cylinderY(0.0011, h * 0.62, 10), M("air-bamboo", { color: "#c9a46a", roughness: 0.8, metalness: 0 }))
		stick.position.y = -h * 0.19
		const coat = put(mesh(kit.cylinderY(0.0016, h * 0.36, 12), M("air-incense", { color: "#5a3a26", roughness: 0.95, metalness: 0 })), 0, h * 0.3, 0)
		const ember = put(mesh(kit.sphere(0.0018, 12, 8), M("air-ember", { color: "#ff6a2a", emissive: new T.Color("#ff4a10"), emissiveIntensity: 2.2, roughness: 0.9 })), 0, h / 2 - 0.001, 0)
		const ash = put(mesh(kit.cylinderY(0.0016, 0.004, 12), M("air-ash", { color: "#b8b3ac", roughness: 1 })), 0, h / 2 - 0.004, 0)
		return group(stick, coat, ash, ember)
	})
	// the smoke: soft puffs at the engine's particles, growing and fading with their age (the same picture for the same t)
	function puffTexture() {
		const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(64, 64) : Object.assign(document.createElement("canvas"), { width: 64, height: 64 })
		const g = c.getContext("2d")
		const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31)
		grd.addColorStop(0, "rgba(255,255,255,0.9)")
		grd.addColorStop(0.45, "rgba(255,255,255,0.45)")
		grd.addColorStop(1, "rgba(255,255,255,0)")
		g.fillStyle = grd
		g.fillRect(0, 0, 64, 64)
		const t = new T.CanvasTexture(c)
		t.colorSpace = T.SRGBColorSpace
		return t
	}
	let PUFF = null
	addViewPlugin({
		name: "air:smoke",
		load(ctx) {
			const sticks = ctx.itemsOfType("incense-stick").filter((id) => ctx.track?.series?.[id]?.smoke)
			if (!sticks.length) return null
			PUFF ??= puffTexture()
			const pools = sticks.map((id) => {
				const list = []
				for (let i = 0; i < 64; i++) {
					const m = new T.SpriteMaterial({ map: PUFF, color: "#8a857f", transparent: true, depthWrite: false, opacity: 0 })
					const s = new T.Sprite(m)
					s.visible = false
					s.renderOrder = 3
					ctx.group.add(s)
					list.push(s)
				}
				return { id, list }
			})
			return {
				frame(t) {
					const i = frameIndex(ctx.track, t)
					for (const { id, list } of pools) {
						const v = ctx.track.series[id].smoke[i] ?? []
						let k = 0
						for (let j = 0; j + 2 < v.length && k < list.length; j += 3, k++) {
							const s = list[k]
							const age = v[j + 2]
							// (big, dense puffs near the tip that spread and thin out as they age: legible at a video's export size)
							const size = 0.026 + 0.034 * Math.min(age, 4)
							s.position.set(v[j], v[j + 1], 0.01 * Math.sin(j * 1.7))
							s.scale.set(size, size, 1)
							s.material.opacity = clamp(0.95 * (1 - age / 5.5), 0, 0.95) * clamp(age * 25, 0, 1)
							s.visible = true
						}
						for (; k < list.length; k++) list[k].visible = false
					}
				},
				dispose() {
					for (const { list } of pools) for (const s of list) s.material.dispose()
				}
			}
		}
	})

	// ------------------------------------------------------------- anemometer
	addModel("anemometer", "base", (ctx) => mesh(kit.cylinderY(ctx.w / 2, ctx.h, 40), M("air-iron", { color: "#2b2e33", roughness: 0.55, metalness: 0.6 })))
	addModel("anemometer", "pole", (ctx) => mesh(kit.cylinderY(ctx.w / 2, ctx.h, 16), steel()))
	addModel("anemometer", "head", (ctx) => {
		const hub = mesh(kit.cylinderY(0.014, ctx.h, 24), plastic("#f2f2ee", 0.6))
		const spin = new T.Group()
		const cupM = M("air-cupblue", { color: "#1f5fbf", roughness: 0.3, metalness: 0, clearcoat: 0.3, side: T.DoubleSide })
		for (let k = 0; k < 3; k++) {
			const a = (k * TAU) / 3
			const arm = put(mesh(kit.cylinderY(0.0018, 0.06, 8), steel()), Math.cos(a) * 0.03, ctx.h / 2 - 0.004, Math.sin(a) * 0.03, 0, -a, Math.PI / 2)
			// a hemispherical cup facing across its arm
			const cup = mesh(kit.geo(`air-cup`, () => new T.SphereGeometry(0.016, 20, 10, 0, TAU, 0, Math.PI / 2).rotateZ(Math.PI / 2)), cupM)
			put(cup, Math.cos(a) * 0.06, ctx.h / 2 - 0.004, Math.sin(a) * 0.06, 0, -a, 0)
			spin.add(arm, cup)
		}
		spin.userData.frame = { hook: "air:cups" }
		return group(hub, spin)
	})
	addFrameHook("air:cups", (obj, f) => {
		obj.rotation.y = -TAU * (f.state?.turns ?? 0)
	})

	// ------------------------------------------------------------- wind tunnel
	addModel("wind-tunnel", "floor", (ctx) => mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.002), wood("#b98a55")))
	addModel("wind-tunnel", "roof", (ctx) => {
		// its clear top and, from it down to the floor, the clear front and back panes (the duct the stream runs through)
		const H = ctx.props?.height ?? 0.3
		const top = mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.001), glass(0.18, "#e6f2ee"), { cast: false })
		const sides = [-1, 1].map((sz) => {
			const m = put(mesh(kit.box(ctx.w, H, 0.004, 0.001), glass(sz > 0 ? 0.08 : 0.14, "#e6f2ee"), { cast: false }), 0, -H / 2 - 0.003, sz * (ctx.d / 2 - 0.002))
			m.renderOrder = 2
			return m
		})
		const rails = [-1, 1].map((sz) => put(mesh(kit.box(ctx.w, 0.01, 0.01, 0.002), steel()), 0, 0, sz * (ctx.d / 2)))
		return group(top, ...sides, ...rails)
	})
	addModel("wind-tunnel", "fan-box", (ctx) => {
		const s = ctx.props?.blows === "to the left" ? -1 : 1
		const box = mesh(kit.box(ctx.w, ctx.h, ctx.d + 0.04, 0.01), plastic("#2f6db5", 0.5))
		const R = Math.min(ctx.h, ctx.d) * 0.42
		const ring = put(mesh(kit.torus(R, 0.006, 10, 48), steel()), (s * ctx.w) / 2 + s * 0.002, 0, 0, 0, Math.PI / 2, 0)
		const blades = new T.Group()
		for (let k = 0; k < 5; k++) {
			const b = put(mesh(kit.box(0.004, R * 0.9, 0.05, 0.002), M("air-blade", { color: "#d9dde2", roughness: 0.3, metalness: 0.5 })), 0, (R * 0.9) / 2, 0, 0.35, 0, 0)
			const arm = new T.Group()
			arm.add(b)
			arm.rotation.x = (k * TAU) / 5
			blades.add(arm)
		}
		blades.position.set((s * ctx.w) / 2 - s * 0.02, 0, 0)
		// (it turns with the clock while the fan runs: a model's own spin, web/view3d.js)
		blades.userData.spin = { axis: "x", rps: (ctx.props?.speed ?? 5) > 0 ? 12 : 0, from: ctx.props?.on_at ?? 0 }
		// a honeycomb straightener over the outlet
		const comb = put(mesh(kit.box(0.02, ctx.h * 0.9, ctx.d * 0.9, 0.002), M("air-honeycomb", { color: "#c9ced3", roughness: 0.5, metalness: 0.6, transparent: true, opacity: 0.35, depthWrite: false })), (s * ctx.w) / 2 + s * 0.012, 0, 0)
		return group(box, ring, blades, comb)
	})

	// ------------------------------------------------------------- vacuum jar
	addModel("vacuum-jar", "plate", (ctx) => {
		const w = ctx.w
		const plate = mesh(kit.cylinderY(w / 2, ctx.h, 64), M("air-plate", { color: "#cfd3d8", roughness: 0.25, metalness: 1 }))
		const gasket = put(mesh(kit.torus(w / 2 - 0.04, 0.004, 10, 64), kit.rubber("#202020")), 0, ctx.h / 2, 0, Math.PI / 2, 0, 0)
		// the pump beside it and a gauge on a pipe
		const pump = put(mesh(kit.box(0.12, 0.1, 0.1, 0.01), plastic("#2f6db5", 0.5)), w / 2 + 0.08, -ctx.h / 2 + 0.05, 0)
		const pipe = put(mesh(kit.geo("air-pipe", () => new T.CylinderGeometry(0.006, 0.006, 0.08, 12).rotateZ(Math.PI / 2)), steel()), w / 2 + 0.0, 0, 0)
		const dial = put(mesh(kit.cylinderZ(0.032, 0.012, 40), M("air-dial", { color: "#f7f6f1", roughness: 0.4 })), w / 2 + 0.08, 0.06, 0.05)
		const rim = put(mesh(kit.torus(0.032, 0.004, 10, 40), steel()), w / 2 + 0.08, 0.06, 0.056)
		const needle = put(mesh(kit.box(0.0025, 0.026, 0.002, 0.0005), M("air-needle", { color: "#c81e1e", roughness: 0.4 })), 0, 0.012, 0)
		const pivot = put(new T.Group(), w / 2 + 0.08, 0.06, 0.06)
		pivot.add(needle)
		pivot.userData.frame = { hook: "air:gauge" }
		return group(plate, gasket, pump, pipe, dial, rim, pivot)
	})
	addFrameHook("air:gauge", (obj, f) => {
		const p = f.state?.pressure_kpa
		if (Number.isFinite(p)) obj.rotation.z = 2.2 - (4.4 * clamp(p / 101.325, 0, 1.05)) // full scale: 1 atm at the right
	})
	for (const p of ["glass-left", "glass-right"]) addModel("vacuum-jar", p, () => null)
	addModel("vacuum-jar", "glass-top", (ctx) => {
		// the whole bell jar, drawn from its top: a glass cylinder with a domed top and a knob, down to the plate
		const R = ctx.d / 2 + 0.004
		const H = ctx.props?.height ?? 0.35
		const prof = [[R, -H - 0.004], [R, -0.02]]
		for (let i = 1; i <= 8; i++) {
			const a = (i / 8) * (Math.PI / 2)
			prof.push([R * Math.cos(a) * (i === 8 ? 0.0001 : 1), -0.02 + 0.03 * Math.sin(a)])
		}
		const jar = mesh(kit.lathe(prof, 64, `air-jar|${f5(R)}|${f5(H)}`), glass(0.15))
		jar.renderOrder = 2
		const knob = put(mesh(kit.sphere(0.014, 20, 12), glass(0.3)), 0, 0.016, 0)
		const shadow = put(L.lightShadow(kit.cylinderY(R, H, 32), 0.12), 0, -H / 2, 0)
		return group(jar, knob, shadow)
	})

	// ------------------------------------------------------------- vacuum tube (coin and feather)
	addModel("vacuum-tube", "base", (ctx) => {
		const w = ctx.w
		const base = mesh(kit.cylinderY(w / 2, ctx.h, 64), M("air-plate", { color: "#cfd3d8", roughness: 0.25, metalness: 1 }))
		const gasket = put(mesh(kit.torus(w / 2 - 0.045, 0.004, 10, 64), kit.rubber("#202020")), 0, ctx.h / 2, 0, Math.PI / 2, 0, 0)
		// its valve and hose to the pump beside it, and a gauge
		const valve = put(mesh(kit.cylinderZ(0.014, 0.03, 24), M("air-brass", { color: "#c9a24a", roughness: 0.3, metalness: 1 })), w / 2 - 0.02, 0, 0.0)
		const hose = put(mesh(kit.geo("air-hose", () => new T.CylinderGeometry(0.007, 0.007, 0.12, 12).rotateZ(Math.PI / 2)), kit.rubber("#2a2a2a")), w / 2 + 0.05, -ctx.h / 2 + 0.01, 0)
		const pump = put(mesh(kit.box(0.12, 0.1, 0.1, 0.01), plastic("#2f6db5", 0.5)), w / 2 + 0.16, -ctx.h / 2 + 0.05, 0)
		const dial = put(mesh(kit.cylinderZ(0.03, 0.012, 40), M("air-dial", { color: "#f7f6f1", roughness: 0.4 })), w / 2 + 0.16, 0.08, 0.05)
		const rim = put(mesh(kit.torus(0.03, 0.004, 10, 40), steel()), w / 2 + 0.16, 0.08, 0.056)
		const needle = put(mesh(kit.box(0.0025, 0.024, 0.002, 0.0005), M("air-needle", { color: "#c81e1e", roughness: 0.4 })), 0, 0.011, 0)
		const pivot = put(new T.Group(), w / 2 + 0.16, 0.08, 0.06)
		pivot.add(needle)
		pivot.userData.frame = { hook: "air:gauge" }
		return group(base, gasket, valve, hose, pump, dial, rim, pivot)
	})
	for (const p of ["wall-left", "wall-right"]) addModel("vacuum-tube", p, () => null)
	addModel("vacuum-tube", "cap", (ctx) => {
		// the whole clear tube, drawn from its cap: a tall acrylic cylinder down to the base, and the cap's metal ring
		const R = ctx.d / 2 + 0.003
		const H = ctx.props?.length ?? 1.5
		const tube = put(mesh(kit.geo(`air-tube|${f5(R)}|${f5(H)}`, () => new T.CylinderGeometry(R, R, H, 64, 1, true)), glass(0.13)), 0, -ctx.h / 2 - H / 2, 0)
		tube.renderOrder = 2
		const cap = mesh(kit.cylinderY(R + 0.004, ctx.h, 64), M("air-plate", { color: "#cfd3d8", roughness: 0.25, metalness: 1 }))
		const shadow = put(L.lightShadow(kit.cylinderY(R, H, 32), 0.05), 0, -ctx.h / 2 - H / 2, 0)
		return group(tube, cap, shadow)
	})

	// ------------------------------------------------------------- upside-down glass and card
	addModel("card-glass", "base", (ctx) => mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.003), wood("#a8743f")))
	addModel("card-glass", "post", (ctx) => mesh(kit.cylinderY(0.006, ctx.h, 16), steel()))
	addModel("card-glass", "clamp", (ctx) => group(mesh(kit.box(ctx.w, 0.01, 0.012, 0.002), steel()), put(mesh(kit.torus(0.006, 0.002, 8, 20), steel()), -ctx.w / 2, 0, 0, Math.PI / 2, 0, 0)))
	for (const p of ["glass-left", "glass-right"]) addModel("card-glass", p, () => null)
	addModel("card-glass", "glass-top", (ctx) => {
		// the tumbler upside down (its bottom on top, at this part), and its water: a column from the mouth up, as full as the reading says
		const D = ctx.w
		const Hg = ctx.props?.height ?? 0.12
		const R = D / 2
		const tumbler = mesh(kit.lathe([[R - 0.003, 0.003 - Hg], [R, 0.003 - Hg], [R, 0.003], [0.0001, 0.003]], 64, `air-tumbler|${f5(R)}|${f5(Hg)}`), tumblerGlass(), { cast: false })
		tumbler.renderOrder = 2
		const lip = put(mesh(kit.torus(R - 0.0015, 0.0015, 8, 48), M("air-glass-lip", { color: "#e9f4f0", roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false })), 0, 0.003 - Hg, 0, Math.PI / 2, 0, 0)
		const foot = put(mesh(kit.cylinderY(R, 0.006, 48), M("air-glass-foot", { color: "#e9f4f0", roughness: 0.05, transparent: true, opacity: 0.3, depthWrite: false })), 0, 0, 0)
		const col = (Hg - 0.006) * (ctx.props?.water ?? 0.8)
		const wtr = mesh(kit.cylinderY(R - 0.003, 1, 48), water())
		wtr.scale.y = Math.max(1e-5, col)
		wtr.position.y = -Hg + 0.003 + col / 2
		wtr.visible = col > 1e-4
		wtr.userData.frame = { hook: "air:water", col, y0: -Hg + 0.003 }
		wtr.renderOrder = 1
		return group(tumbler, lip, foot, wtr)
	})
	addFrameHook("air:water", (obj, f, a) => {
		const k = Number.isFinite(f.state?.water) ? f.state.water : 1
		const h = a.col * k
		obj.visible = h > 1e-4
		obj.scale.y = Math.max(1e-5, h)
		obj.position.y = a.y0 + h / 2
	})
	addModel("card-glass", "card", (ctx) => {
		const m = kit.printed("air-indexcard", (g, w, h) => {
			g.fillStyle = "#fff6d8"
			g.fillRect(0, 0, w, h)
			g.strokeStyle = "rgba(90,140,210,0.55)"
			g.lineWidth = 3
			for (let y = 60; y < h; y += 46) {
				g.beginPath()
				g.moveTo(0, y)
				g.lineTo(w, y)
				g.stroke()
			}
			g.strokeStyle = "rgba(220,60,60,0.6)"
			g.beginPath()
			g.moveTo(0, 36)
			g.lineTo(w, 36)
			g.stroke()
		}, { w: 512, h: 512, roughness: 0.85 })
		return mesh(kit.box(ctx.w, Math.max(0.0005, ctx.h * 0.5), ctx.d, 0.0002), m)
	})

	// ------------------------------------------------------------- suction cup
	addModel("suction-cup", "base", (ctx) => mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.003), wood("#a8743f")))
	addModel("suction-cup", "post", (ctx) => mesh(kit.cylinderY(ctx.w / 2, ctx.h, 20), steel()))
	addModel("suction-cup", "panel", (ctx) => {
		const look = ctx.solid.look
		const m = look === "glass" ? glass(0.3, "#e4f2ee") : look === "ceramic" ? kit.ceramic("#eef1f2") : look === "paperboard" ? M("air-paint", { color: "#e9e4d6", roughness: 0.7 }) : wood("#b98a55")
		return mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.001), m)
	})
	addModel("suction-cup", "cup", (ctx) => {
		const D = ctx.d
		const R = D / 2
		const vinyl = M("air-cupvinyl2", { color: "#9fc6d8", roughness: 0.25, metalness: 0, transparent: true, opacity: 0.88, clearcoat: 0.8 })
		const dome = mesh(kit.lathe([[0.0001, -0.38 * D], [0.1 * D, -0.38 * D], [0.18 * D, -0.3 * D], [0.3 * D, -0.2 * D], [0.46 * D, -0.04 * D], [R, -0.002], [R, 0], [0.0001, 0]], 48, `air-cup|${f5(D)}`), vinyl)
		const hook = put(mesh(kit.torus(0.006, 0.0015, 8, 20, Math.PI * 1.5), steel()), 0, -0.38 * D - 0.006, 0, 0, 0, Math.PI / 2)
		// the 12 cm string down to the weight's hanger (the weight hangs from it rigidly in the physics: machines/mod_air.py)
		const string = put(mesh(kit.cylinderY(0.0008, 0.12, 6), M("air-cupstring", { color: "#d8d0b8", roughness: 0.9 })), 0, -0.38 * D - 0.06, 0)
		return group(dome, hook, string)
	})
	addModel("suction-cup", "weight", (ctx) => {
		// a stack of slotted masses on a hanger
		const w = ctx.w
		const h = ctx.h
		const n = Math.max(1, Math.min(8, Math.round(h / 0.012)))
		const parts = [put(mesh(kit.cylinderY(0.002, h + 0.02, 10), steel()), 0, 0.01, 0)]
		const brass = M("air-brass", { color: "#c8a24a", roughness: 0.3, metalness: 1 })
		for (let i = 0; i < n; i++) parts.push(put(mesh(kit.cylinderY(w / 2, (h / n) * 0.94, 40), i % 2 ? brass : M("air-iron2", { color: "#3a3d42", roughness: 0.45, metalness: 0.7 })), 0, -h / 2 + (h / n) * (i + 0.5), 0))
		return group(...parts)
	})

	// ------------------------------------------------------------- the steam can
	addModel("steam-can", "stove", (ctx) => {
		const body = mesh(kit.box(ctx.w, ctx.h * 0.8, ctx.d, 0.01), M("air-stove", { color: "#2d2f33", roughness: 0.5, metalness: 0.6 }))
		body.position.y = -ctx.h * 0.1
		const grate = put(mesh(kit.torus(0.06, 0.003, 8, 40), steel()), 0, ctx.h / 2 - 0.003, 0, Math.PI / 2, 0, 0)
		const burner = put(mesh(kit.cylinderY(0.03, 0.01, 32), steel()), 0, ctx.h * 0.3 + 0.005, 0)
		const flame = put(mesh(kit.geo("air-flame", () => new T.ConeGeometry(0.028, 0.03, 24, 1, true)), M("air-flame", { color: "#3a7bff", emissive: new T.Color("#2f6dff"), emissiveIntensity: 2, transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide })), 0, ctx.h * 0.3 + 0.022, 0)
		flame.userData.frame = { hook: "air:flame" }
		return group(body, grate, burner, flame)
	})
	addFrameHook("air:flame", (obj, f) => {
		obj.scale.set(1, 0.85 + 0.15 * Math.sin(f.t * 31) * Math.sin(f.t * 7.3), 1)
	})
	addModel("steam-can", "can", (ctx) => {
		const R = ctx.w / 2
		const H = ctx.h
		// (its wall in 24 rings, so the crushing folds have vertices to move)
		const wall = []
		for (let i = 0; i <= 24; i++) wall.push([R, -H / 2 + 0.012 + ((H - 0.028) * i) / 24])
		const prof = [[0.0001, -H / 2 + 0.004], [R * 0.7, -H / 2 + 0.002], [R * 0.86, -H / 2], ...wall, [R * 0.82, H / 2 - 0.002], [R * 0.84, H / 2], [0.0001, H / 2 - 0.002]]
		// the can as it is and three stages of crushing (the body pinched in with folds, its ends kept): the hook shows the one nearest the reading
		const geoAt = (k) =>
			kit.geo(`air-can|${f5(R)}|${f5(H)}|${k}`, () => {
				const g = new T.LatheGeometry(prof.map(([x, y]) => new T.Vector2(x, y)), 48)
				const pos = g.attributes.position
				for (let i = 0; i < pos.count; i++) {
					const x = pos.getX(i)
					const y = pos.getY(i)
					const z = pos.getZ(i)
					const a = Math.atan2(z, x)
					const mid = clamp(1 - Math.abs(y) / (H / 2 - 0.012), 0, 1) * k
					const fold = 1 - mid * (0.55 + 0.18 * Math.sin(a * 5 + y * 60))
					pos.setXYZ(i, x * fold, y * (1 - 0.18 * mid), z * fold * (1 - 0.15 * mid))
				}
				g.computeVertexNormals()
				return g
			})
		const paint = kit.printed("air-canlabel", (g, w, h) => {
			g.fillStyle = "#c8202a"
			g.fillRect(0, 0, w, h)
			g.fillStyle = "#f4f4f0"
			g.font = "bold 120px system-ui, sans-serif"
			g.textAlign = "center"
			g.fillText("FIZZ", w / 2, h * 0.62)
			g.strokeStyle = "#f4f4f0"
			g.lineWidth = 10
			g.beginPath()
			for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.78 + 14 * Math.sin(x / 40))
			g.stroke()
		}, { w: 1024, h: 512, roughness: 0.28, metalness: 0.55, clearcoat: 0.8 })
		const stages = [0, 0.35, 0.7, 1].map((k, i) => {
			const m = mesh(geoAt(k), paint)
			m.visible = i === 0
			m.userData.frame = { hook: "air:crush", k }
			return m
		})
		const can = group(...stages)
		// steam over its mouth while it boils, and the tongs once they hold it
		const steam = new T.Group()
		PUFF ??= puffTexture()
		for (let k = 0; k < 5; k++) {
			const s = new T.Sprite(new T.SpriteMaterial({ map: PUFF, color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }))
			s.userData.k = k
			steam.add(s)
		}
		steam.userData.frame = { hook: "air:steam", H }
		return group(can, steam)
	})
	addFrameHook("air:crush", (obj, f, a) => {
		const c = clamp((Number.isFinite(f.state?.crushed) ? f.state.crushed : 0) / 0.7, 0, 1)
		const near = [0, 0.35, 0.7, 1].reduce((best, k) => (Math.abs(k - c) < Math.abs(best - c) ? k : best), 0)
		obj.visible = near === a.k
	})
	addFrameHook("air:steam", (obj, f, a) => {
		const on = f.state?.steaming >= 1
		for (const s of obj.children) {
			const u = ((f.t * 0.9 + s.userData.k * 0.2) % 1 + 1) % 1
			s.visible = on
			if (!on) continue
			if (!s.userData.own) {
				s.material = s.material.clone()
				s.userData.own = true
			}
			s.position.set(0.01 * Math.sin(s.userData.k * 2.1 + f.t), a.H / 2 + 0.01 + 0.12 * u, 0)
			const sz = 0.02 + 0.05 * u
			s.scale.set(sz, sz, 1)
			s.material.opacity = 0.35 * (1 - u)
		}
	})
	// the tongs that carry the can over and hold it under the water: two steel arms from above, gripping its sides, whatever way it is turned
	addViewPlugin({
		name: "air:tongs",
		load(ctx) {
			const cans = ctx.itemsOfType("steam-can").map((id) => ({ id, s: ctx.solidsOf(id).find((x) => x.part === "can") })).filter((c) => c.s)
			if (!cans.length) return null
			const sets = cans.map(({ id, s }) => {
				const R = s.body.width / 2
				const g = new T.Group()
				const arm = (side) => put(mesh(kit.box(0.007, 0.32, 0.014, 0.002), steel()), side * (R + 0.006), 0.15, 0, 0, 0, -side * 0.05)
				const pad = (side) => put(mesh(kit.box(0.004, 0.05, 0.03, 0.001), kit.rubber("#2a2a2a")), side * (R + 0.003), 0, 0)
				const hinge = put(mesh(kit.cylinderZ(0.008, 0.02, 16), steel()), 0, 0.31, 0)
				g.add(arm(1), arm(-1), pad(1), pad(-1), hinge)
				g.visible = false
				ctx.group.add(g)
				return { id, s, g }
			})
			return {
				frame(t) {
					for (const { id, s, g } of sets) {
						const on = ctx.stateAt(id, "tongs", t) >= 0.5
						const p = on ? ctx.placementAt(s.id, t) : null
						g.visible = !!p
						if (p) g.position.set(p.x, p.y, 0)
					}
				}
			}
		}
	})
	addModel("steam-can", "bowl", (ctx) => {
		// the whole glass dish (its sides draw nothing) and its cold water, 6 cm deep
		const w = ctx.w
		const d = ctx.d
		const dish = group(
			mesh(kit.box(w, ctx.h, d, 0.003), glass(0.35, "#e2f0ec")),
			put(mesh(kit.box(0.006, 0.09, d, 0.002), glass(0.22, "#e2f0ec")), -w / 2 + 0.003, 0.05, 0),
			put(mesh(kit.box(0.006, 0.09, d, 0.002), glass(0.22, "#e2f0ec")), w / 2 - 0.003, 0.05, 0),
			put(mesh(kit.box(w, 0.09, 0.004, 0.001), glass(0.12, "#e2f0ec"), { cast: false }), 0, 0.05, d / 2 - 0.002),
			put(mesh(kit.box(w, 0.09, 0.004, 0.001), glass(0.12, "#e2f0ec"), { cast: false }), 0, 0.05, -d / 2 + 0.002)
		)
		const wtr = put(mesh(kit.box(w - 0.012, 0.06, d - 0.008, 0.001), M("air-coldwater", { color: "#cfe8f6", roughness: 0.04, transparent: true, opacity: 0.45, depthWrite: false, clearcoat: 1 })), 0, ctx.h / 2 + 0.03, 0)
		wtr.renderOrder = 1
		const ice = M("air-ice", { color: "#f4fbff", roughness: 0.1, transparent: true, opacity: 0.7, clearcoat: 1 })
		// (ice cubes only in an ice bath: a warm dish has none)
		const bath = Number.isFinite(ctx.props?.bath_c) ? ctx.props.bath_c : 2
		const cubes = bath > 5 ? [] : [-0.08, 0.07, 0.1].map((x, i) => put(mesh(kit.box(0.025, 0.022, 0.025, 0.004), ice), x, ctx.h / 2 + 0.058, (i - 1) * 0.05, 0, i, 0))
		for (const p of ["bowl-left", "bowl-right"]) void p
		return group(dish, wtr, ...cubes)
	})
	for (const p of ["bowl-left", "bowl-right"]) addModel("steam-can", p, () => null)

	// ------------------------------------------------------------- paper airplanes
	addModel("paper-airplane", "plane", (ctx) => {
		const P = ctx.props ?? {}
		const design = DESIGNS[P.design] ?? DESIGNS.dart
		const face = P.facing === "left" ? -1 : 1
		const pts = ctx.body.points.map((p) => [p.x, p.y])
		const xs = pts.map((p) => p[0])
		const x0 = Math.min(...xs)
		const x1 = Math.max(...xs)
		const half = design.span / 2
		if (P.design === "balsa glider") {
			const balsa = M("air-balsa", { color: "#ead9ad", roughness: 0.8, metalness: 0 })
			const cx = centroidX(design.outline.map(([x, y]) => [x, y]))
			const fus = mesh(kit.extrude(pts, ctx.d, { key: `air-fus|${pts.join()}` }), balsa)
			const wx = face * (cx + design.wing[0])
			const tx = face * (cx + design.tail[0])
			const wing = put(mesh(kit.box(design.wing[1], 0.002, design.span, 0.0008), balsa), wx, 0.004, 0)
			const stab = put(mesh(kit.box(design.tail[1], 0.0016, design.span * 0.4, 0.0006), balsa), tx, 0.0035, 0)
			const fin = put(mesh(kit.extrude([[-0.03, 0], [0.005, 0], [-0.025, 0.035]], 0.0016, { key: "air-fin" }), balsa), tx - face * 0.005, 0.004, 0, 0, face < 0 ? Math.PI : 0, 0)
			const clay = put(mesh(kit.sphere(0.006, 16, 10), M("air-noseclay", { color: "#c0573e", roughness: 0.7 })), (face > 0 ? x1 : x0) - face * 0.012, 0, 0)
			return group(fus, wing, stab, fin, clay)
		}
		// a folded paper dart or glider: the keel (its side outline, a folded double sheet) and two wings from its top edge, a slight V
		const paper = M(`air-paper|${ctx.color}`, { color: ctx.color ?? "#f4f4f0", roughness: 0.88, metalness: 0, side: T.DoubleSide })
		const keel = mesh(kit.extrude(pts, ctx.d, { key: `air-keel|${pts.join()}` }), paper)
		const nose = face > 0 ? x1 : x0
		const tail = face > 0 ? x0 : x1
		const wingGeo = (s) =>
			kit.geo(`air-wing|${P.design}|${face}|${s}|${f5(nose)}|${f5(tail)}`, () => {
				const g = new T.BufferGeometry()
				const span = s * half
				const lift = 0.12 * half // dihedral: the tips a little higher
				const v =
					P.design === "glider"
						? [nose, 0.003, 0, tail, 0.004, 0, tail + face * 0.03, 0.004 + lift, span, nose - face * 0.06, 0.003 + lift * 0.6, span]
						: [nose, 0.003, 0, tail, 0.004, 0, tail, 0.004 + lift, span]
				const idx = P.design === "glider" ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]
				g.setAttribute("position", new T.Float32BufferAttribute(v, 3))
				g.setIndex(idx)
				g.computeVertexNormals()
				return g
			})
		const crease = M("air-crease", { color: "#d8d6cf", roughness: 0.9 })
		const lines = [-1, 1].map((s) => put(mesh(kit.box(Math.abs(nose - tail) * 0.9, 0.0005, 0.0006, 0.0001), crease), (nose + tail) / 2, 0.0036, s * half * 0.45))
		return group(keel, mesh(wingGeo(1), paper), mesh(wingGeo(-1), paper), ...lines)
	})
	addModel("paper-airplane", "clips", (ctx) => {
		const pts = [[-0.014, -0.001, 0], [0.012, -0.001, 0], [0.014, 0.001, 0], [-0.01, 0.0015, 0], [-0.012, 0.0005, 0], [0.008, 0.0005, 0]]
		return mesh(L.tube("air-clip", pts, 0.0005, { seg: 6 }), kit.metal("#cfd5dc", { roughness: 0.2 }))
	})

	// ------------------------------------------------------------- kite
	addModel("kite", "stake", (ctx) => mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.001), wood("#8a6a45")))
	addModel("kite", "kite", (ctx) => {
		// its spine along its own x (nose at +x), the sail spread across z: a diamond, widest a quarter of its height from the nose
		const pts = ctx.body.points.map((p) => [p.x, p.y])
		const xs = pts.map((p) => p[0])
		const L0 = Math.max(...xs) - Math.min(...xs)
		const W = 0.85 * L0
		const nose = L0 / 2
		const cross = nose - 0.25 * L0
		// (sail and spars inside its 8 mm plank, whichever face it lies on: the sail 2.5 mm under the spine, the spars on its back)
		const sail = kit.geo(`air-kite2|${f5(L0)}`, () => {
			const g = new T.BufferGeometry()
			const v = [nose, KITE_SAIL_Y, 0, cross, KITE_SAIL_Y, W / 2, -nose, KITE_SAIL_Y, 0, cross, KITE_SAIL_Y, -W / 2]
			g.setAttribute("position", new T.Float32BufferAttribute(v, 3))
			g.setAttribute("uv", new T.Float32BufferAttribute([1, 0.5, 0.75, 1, 0, 0.5, 0.75, 0], 2))
			g.setIndex([0, 1, 2, 0, 2, 3])
			g.computeVertexNormals()
			return g
		})
		const hex = ctx.color ?? PAINT.red
		const ripM = M(`air-ripstop|${hex}`, { color: hex, roughness: 0.6, metalness: 0, side: T.DoubleSide, sheen: 0.4, sheenColor: new T.Color("#ffffff") })
		const spar = M("air-spar", { color: "#c9a46a", roughness: 0.6 })
		const spine = put(mesh(kit.cylinderY(0.003, L0, 8), spar), 0, 0.001, 0, 0, 0, Math.PI / 2)
		const crossSpar = put(mesh(kit.cylinderY(0.0025, W, 8), spar), cross, 0.001, 0, Math.PI / 2, 0, 0)
		// (the physics is the plane of the picture, where a kite is seen edge-on: its sail is drawn rolled 35° about its spine toward the camera so its
		// face shows, as a kite flying a little toward you would; the "air:kites" plugin lowers the roll as it nears what is under it, flat when it
		// lies there, and draws its tail, which hangs, streams in the wind and lies on what it meets)
		const k = group(mesh(sail, ripM), spine, crossSpar)
		k.name = "air-kite-roll"
		k.rotation.x = -KITE_ROLL
		return group(k)
	})
	// ------------------------------------------------------------- kites: the sail's roll by what is under it, and the tail
	// The tail is worked out once for the whole run, from the track (so scrubbing and the export draw the very same tail at every t): a thread of
	// pieces of at most 2.5 cm hung from the kite's trailing end, stepped at 960 Hz with its weight (TAIL_KG_M), the air's drag on it
	// (½ρ·C_d·w·|u|·u a metre, u the wind at the kite less the piece's own velocity: the kite's own C_d 0.1 and 3 cm width), resting and sliding on
	// the static things under it (Coulomb friction μ 0.4, nylon on wood) and over their edges to the room's floor; it hardly stretches (each piece
	// held to its length by position-based constraints, Müller et al. 2007: within 0.2 % for a 1 m tail) but can bunch up.
	addViewPlugin({
		name: "air:kites",
		load(ctx) {
			const ids = ctx.itemsOfType("kite")
			if (!ids.length) return null
			const S = ctx.doc?.settings ?? {}
			const rho = S.air === false ? 0 : (S.airDensity ?? 1.2) // (tooling/src/sim/physics.ts: the run's air)
			const grav = S.gravity ?? 9.81
			const KD = (0.5 * rho * TAIL_CD * TAIL_WIDTH) / TAIL_KG_M // the drag's acceleration over |u|·u
			const MU = 0.4
			const release = Number(typeof ctx.doc?.release === "number" ? ctx.doc.release : ctx.doc?.release?.at) || 0
			// what a tail can lie on: the outlines of the static things (the tabletop, a block, a ramp, a stake), else the room's floor; binned along x
			const pieces = []
			for (const s of ctx.doc.solids) {
				if (s.kind !== "static" || s.ghost || !s.body || ctx.resolved?.[s.item]?.invisible_in_3d) continue
				const p = ctx.placementAt(s.id, 0)
				if (!p) continue
				const b = s.body
				if (b.kind === "ball") {
					pieces.push({ cx: p.x, cy: p.y, r: b.radius, x0: p.x - b.radius, x1: p.x + b.radius })
					continue
				}
				const loc = b.kind === "polygon" ? b.points.map((q) => [q.x, q.y]) : b.kind === "slab" ? [[-b.width / 2, -b.height / 2], [b.width / 2, -b.height / 2], [b.width / 2, b.height / 2], [-b.width / 2, b.height / 2]] : null
				if (!loc) continue
				const c = Math.cos(p.angle)
				const sn = Math.sin(p.angle)
				const P = loc.map(([u, v]) => [p.x + u * c - v * sn, p.y + u * sn + v * c])
				for (let k = 0; k < P.length; k++) {
					const [x1, y1] = P[k]
					const [x2, y2] = P[(k + 1) % P.length]
					if (x1 !== x2) pieces.push({ x1, y1, x2, y2, x0: Math.min(x1, x2), x1b: Math.max(x1, x2) })
				}
			}
			let bx0 = Infinity
			let bx1 = -Infinity
			for (const e of pieces) {
				bx0 = Math.min(bx0, e.x0)
				bx1 = Math.max(bx1, e.x1b ?? e.x1)
			}
			const NB = pieces.length ? Math.min(4000, Math.max(1, Math.ceil((bx1 - bx0) / 0.05))) : 0
			const BW = NB ? (bx1 - bx0) / NB || 1 : 1
			const bins = Array.from({ length: NB }, () => [])
			for (const e of pieces) {
				const a = Math.max(0, Math.min(NB - 1, Math.floor((e.x0 - bx0) / BW)))
				const z = Math.max(0, Math.min(NB - 1, Math.floor(((e.x1b ?? e.x1) - bx0) / BW)))
				for (let i = a; i <= z; i++) bins[i].push(e)
			}
			let topmost = ROOM_FLOOR
			for (const e of pieces) topmost = Math.max(topmost, e.r !== undefined ? e.cy + e.r : Math.max(e.y1, e.y2))
			/** The top of what is under x at or below y: the highest surface a falling thread there would land on. */
			const groundAt = (x, y) => {
				let g = ROOM_FLOOR
				if (!NB || !(x >= bx0 && x <= bx1)) return g
				for (const e of bins[Math.min(NB - 1, Math.floor((x - bx0) / BW))]) {
					let yy
					if (e.r !== undefined) {
						const dx = x - e.cx
						if (Math.abs(dx) >= e.r) continue
						yy = e.cy + Math.sqrt(e.r * e.r - dx * dx)
					} else {
						if (x < e.x0 || x > e.x1b) continue
						yy = e.y1 + ((e.y2 - e.y1) * (x - e.x1)) / (e.x2 - e.x1)
					}
					if (yy <= y + 0.005 && yy > g) g = yy
				}
				return g
			}
			const R = 0.0007 // the thread's radius: it lies this far over a surface
			const stringM = M("air-tailstring", { color: "#333", roughness: 0.9 })
			const bowM = M("air-bow", { color: "#f2c230", roughness: 0.6, side: T.DoubleSide })
			const segGeo = new T.CylinderGeometry(R, R, 1, 6, 1, true) // (a unit piece, stretched between two points)
			const bowGeo = new T.BoxGeometry(0.05, 0.0008, 0.012) // a bow: 5 cm along the tail, 1.2 cm across
			const fr = ctx.track?.frames ?? []
			const kites = []
			for (const id of ids) {
				const solid = ctx.solidsOf(id).find((s) => s.part === "kite")
				if (!solid || solid.body?.kind !== "polygon") continue
				const P = ctx.resolved?.[id] ?? {}
				const xs = solid.body.points.map((q) => q.x)
				const L = Math.max(...xs) - Math.min(...xs)
				const len = Math.max(0, Number(P.tail_m ?? 1) || 0)
				const n = len > 0 ? Math.min(80, Math.max(4, Math.ceil(len / 0.025))) : 0 // pieces of 2.5 cm at most
				const nb = len > 0 ? Math.round(len / 0.12) : 0
				const k = { id, solid, L, W: 0.85 * L, cross: 0.25 * L, len, n, nb, toward: P.toward === "left" ? -1 : 1, holder: null, px: new Float64Array(n + 1), py: new Float64Array(n + 1), rec: null }
				if (n) {
					k.seg = new T.InstancedMesh(segGeo, stringM, n)
					k.bows = nb ? new T.InstancedMesh(bowGeo, bowM, nb) : null
					for (const m of [k.seg, k.bows]) {
						if (!m) continue
						m.castShadow = true
						m.receiveShadow = true
						m.frustumCulled = false // (its pieces move every frame)
						m.instanceMatrix.setUsage(T.DynamicDrawUsage)
						ctx.group.add(m)
					}
				}
				kites.push(k)
			}
			if (!kites.length) return null
			/** Its trailing end (its own -x end) at t, or null. */
			const endAt = (k, t) => {
				const p = ctx.placementAt(k.solid.id, t)
				return p ? [p.x - (k.L / 2) * Math.cos(p.angle), p.y - (k.L / 2) * Math.sin(p.angle), p.angle] : null
			}
			// (a held kite gets no air forces, so the engine reads its wind only from the release: while held, the wind just after it, blowing toward
			// its downwind side as it must to fly it)
			const windAt = (k, t) => {
				const w = ctx.stateAt(k.id, "wind_ms", Math.max(t, release + 0.02))
				return k.toward * (Number.isFinite(w) ? w : 0)
			}
			/** The tail laid out at one moment as it would hang still: straight along its weight plus the drag of the wind past it, along the top of what it
			 *  meets, over its edges (the run's first moment, and a run without a track). */
			const layOut = (k, ex, ey, angle, wx) => {
				const us = Math.abs(wx)
				let tx = KD * us * wx
				let ty = -grav
				const tl = Math.hypot(tx, ty) || 1
				tx /= tl
				ty /= tl
				const c = Math.cos(angle)
				const hx = Math.abs(tx) > 1e-3 ? Math.sign(tx) : Math.abs(c) > 1e-3 ? -Math.sign(c) : k.toward // (lying: the way the wind or its spine sends it)
				const ds = k.len / k.n
				let x = ex
				let y = Math.max(ey, groundAt(ex, ey) + R)
				k.px[0] = x
				k.py[0] = y
				for (let i = 1; i <= k.n; i++) {
					let nx = x + tx * ds
					let ny = y + ty * ds
					if (ny < groundAt(nx, y) + R) {
						nx = x + hx * ds
						const g = groundAt(nx, y) + R
						if (g > y + ds) {
							nx = x // a wall in the way: it bunches up against it
							ny = y
						} else ny = g >= y - ds ? g : y // along the surface, or just over its edge
					}
					x = nx
					y = ny
					k.px[i] = x
					k.py[i] = y
				}
			}
			/** The tail through the whole run: k.rec[f] = its points at frame f. */
			const simulate = (k) => {
				const n = k.n
				const ds = k.len / n
				const X = Float64Array.from(k.px)
				const Y = Float64Array.from(k.py)
				const VX = new Float64Array(n + 1)
				const VY = new Float64Array(n + 1)
				const PX = new Float64Array(n + 1)
				const PY = new Float64Array(n + 1)
				const step = (h, ex, ey, wx) => {
					for (let i = 1; i <= n; i++) {
						const ux = wx - VX[i]
						const uy = -VY[i]
						const us = Math.hypot(ux, uy)
						VX[i] += KD * us * ux * h
						VY[i] += (KD * us * uy - grav) * h
						let px = X[i] + VX[i] * h
						let py = Y[i] + VY[i] * h
						const g = py > topmost + R ? -Infinity : groundAt(px, Y[i]) + R // (higher than everything: it touches nothing)
						if (py < g) {
							// on a surface: held there, its slide along it resisted by friction (μ times how hard it presses)
							const pen = g - py
							py = g
							const dx = px - X[i]
							px = Math.abs(dx) <= MU * pen ? X[i] : px - Math.sign(dx) * MU * pen
						}
						PX[i] = px
						PY[i] = py
					}
					// no piece longer than ds (it hardly stretches; it may bunch): four Gauss-Seidel passes from its pinned end
					PX[0] = ex
					PY[0] = ey
					for (let it = 0; it < 4; it++)
						for (let i = 0; i < n; i++) {
							const dx = PX[i + 1] - PX[i]
							const dy = PY[i + 1] - PY[i]
							const d = Math.hypot(dx, dy)
							if (d <= ds) continue
							const c = (d - ds) / d
							if (i === 0) {
								PX[1] -= dx * c
								PY[1] -= dy * c
							} else {
								PX[i] += (dx * c) / 2
								PY[i] += (dy * c) / 2
								PX[i + 1] -= (dx * c) / 2
								PY[i + 1] -= (dy * c) / 2
							}
						}
					for (let i = 1; i <= n; i++) {
						if (PY[i] > topmost + R) continue
						const g = groundAt(PX[i], Math.max(PY[i], Y[i])) + R
						if (PY[i] < g) PY[i] = g
					}
					for (let i = 1; i <= n; i++) {
						VX[i] = (PX[i] - X[i]) / h
						VY[i] = (PY[i] - Y[i]) / h
						X[i] = PX[i]
						Y[i] = PY[i]
					}
					X[0] = ex
					Y[0] = ey
				}
				const e0 = endAt(k, fr[0].t)
				if (!e0) return null
				// settled first in the air of its first moment (1.5 s, the kite held where it starts)
				const w0 = windAt(k, fr[0].t)
				for (let s = 0; s < 1440; s++) step(1 / 960, e0[0], e0[1], w0)
				const rec = new Float32Array(fr.length * (n + 1) * 2)
				const put = (f) => {
					const o = f * (n + 1) * 2
					for (let i = 0; i <= n; i++) {
						rec[o + 2 * i] = X[i]
						rec[o + 2 * i + 1] = Y[i]
					}
				}
				put(0)
				for (let f = 1; f < fr.length; f++) {
					const t0 = fr[f - 1].t
					const span = fr[f].t - t0
					const m = Math.min(64, Math.max(1, Math.ceil(span * 960)))
					const h = span / m
					for (let s = 1; s <= m && h > 0; s++) {
						const tt = t0 + s * h
						const e = endAt(k, tt)
						if (e) step(h, e[0], e[1], windAt(k, tt))
					}
					put(f)
				}
				return rec
			}
			for (const k of kites) {
				if (!k.n) continue
				const e = endAt(k, fr[0]?.t ?? 0)
				if (!e) continue
				layOut(k, e[0], e[1], e[2], windAt(k, fr[0]?.t ?? 0))
				if (fr.length > 1) k.rec = simulate(k)
			}
			const mat = new T.Matrix4()
			const q = new T.Quaternion()
			const zAxis = new T.Vector3(0, 0, 1)
			const xAxis = new T.Vector3(1, 0, 0)
			const qx = new T.Quaternion()
			const at = new T.Vector3()
			const sc = new T.Vector3()
			/** Its roll toward the camera: the most (up to KITE_ROLL) that keeps its lower sail corner and cross spar's end clear of what is under
			 *  them, by bisection. */
			const SPAR_YS = [KITE_SAIL_Y, 0.001 - 0.0025, 0.001 + 0.0025] // (the sail, the cross spar's two sides: the model above)
			const rollOf = (k, p, c, s) => {
				const corner = (r) => {
					let lx = 0
					let ly = Infinity
					for (const y0 of SPAR_YS)
						for (const sg of [-1, 1]) {
							const yl = y0 * Math.cos(r) + sg * (k.W / 2) * Math.sin(r)
							const Y = p.y + (k.L / 2 - k.cross) * s + yl * c
							if (Y < ly) {
								ly = Y
								lx = p.x + (k.L / 2 - k.cross) * c - yl * s
							}
						}
					return [lx, ly]
				}
				const top = corner(0)[1]
				const clear = (r) => {
					const [x, y] = corner(r)
					return y >= groundAt(x, top) + 0.001
				}
				if (clear(KITE_ROLL)) return KITE_ROLL
				if (!clear(0)) return 0
				let a = 0
				let b = KITE_ROLL
				for (let i = 0; i < 14; i++) {
					const m = (a + b) / 2
					if (clear(m)) a = m
					else b = m
				}
				return a
			}
			return {
				frame(t) {
					for (const k of kites) {
						const p = ctx.placementAt(k.solid.id, t)
						if (k.seg) k.seg.visible = !!p
						if (k.bows) k.bows.visible = !!p
						if (!p) continue
						const c = Math.cos(p.angle)
						const s = Math.sin(p.angle)
						// the sail's roll (the model's own group: web/view3d.js names each part's holder by its solid's id)
						k.holder ??= ctx.group.parent?.getObjectByName(k.solid.id) ?? null
						const rg = k.holder?.getObjectByName("air-kite-roll")
						if (rg) rg.rotation.x = -rollOf(k, p, c, s)
						if (!k.n) continue
						if (k.rec) {
							// the run's tail at t, between its two frames
							const i = frameIndex(ctx.track, t)
							const j = Math.min(i + 1, fr.length - 1)
							const span = fr[j].t - fr[i].t
							const u = span > 0 ? Math.min(1, Math.max(0, (t - fr[i].t) / span)) : 0
							const oi = i * (k.n + 1) * 2
							const oj = j * (k.n + 1) * 2
							for (let m = 0; m <= k.n; m++) {
								k.px[m] = k.rec[oi + 2 * m] + (k.rec[oj + 2 * m] - k.rec[oi + 2 * m]) * u
								k.py[m] = k.rec[oi + 2 * m + 1] + (k.rec[oj + 2 * m + 1] - k.rec[oi + 2 * m + 1]) * u
							}
						} else layOut(k, p.x - (k.L / 2) * c, p.y - (k.L / 2) * s, p.angle, windAt(k, t))
						for (let i = 0; i < k.n; i++) {
							const dx = k.px[i + 1] - k.px[i]
							const dy = k.py[i + 1] - k.py[i]
							const d = Math.hypot(dx, dy)
							at.set((k.px[i] + k.px[i + 1]) / 2, (k.py[i] + k.py[i + 1]) / 2, 0)
							q.setFromAxisAngle(zAxis, Math.atan2(-dx, dy))
							sc.set(1, Math.max(1e-4, d), 1)
							k.seg.setMatrixAt(i, mat.compose(at, q, sc))
						}
						k.seg.instanceMatrix.needsUpdate = true
						if (k.bows) {
							// a bow every 12 cm along it, lying along it
							const ds = k.len / k.n
							let j = 0
							let run = 0
							for (let b = 0; b < k.nb; b++) {
								const want = Math.min(k.len, (b + 1) * 0.12)
								while (j < k.n - 1 && run + ds < want - 1e-9) {
									run += ds
									j++
								}
								const u = Math.min(1, Math.max(0, (want - run) / ds))
								const dx = k.px[j + 1] - k.px[j]
								const dy = k.py[j + 1] - k.py[j]
								const bx = k.px[j] + dx * u
								const by = k.py[j] + dy * u
								at.set(bx, by, 0)
								q.setFromAxisAngle(zAxis, Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : 0)
								// (in the air its face turned toward the camera as the sail is; flat as it comes down on something)
								const lift = Math.min(1, Math.max(0, (by - R - groundAt(bx, by)) / 0.01))
								if (lift > 0) q.multiply(qx.setFromAxisAngle(xAxis, -KITE_ROLL * lift))
								sc.set(1, 1, 1)
								k.bows.setMatrixAt(b, mat.compose(at, q, sc))
							}
							k.bows.instanceMatrix.needsUpdate = true
						}
					}
				},
				dispose() {
					segGeo.dispose()
					bowGeo.dispose()
					for (const k of kites) {
						k.seg?.dispose?.()
						k.bows?.dispose?.()
					}
				}
			}
		}
	})
	// ------------------------------------------------------------- popped balloons: their shreds fly out and fall
	addViewPlugin({
		name: "air:pops",
		load(ctx) {
			const ids = ctx.itemsOfType("party-balloon")
			const pops = []
			for (const id of ids) {
				const v = ctx.track?.state?.[id]?.popped
				if (!Array.isArray(v)) continue
				const i = v.findIndex((x) => x >= 1)
				if (i < 0) continue
				const t0 = ctx.track.frames[i].t
				const solid = ctx.solidsOf(id).find((s) => s.part === "balloon")
				if (!solid) continue
				const before = ctx.placementAt(solid.id, Math.max(0, t0 - 0.01))
				const r = solid.body.radius * (before?.scale ?? 1)
				const hex = solid.color ?? PAINT.red
				const bits = []
				for (let k = 0; k < 9; k++) {
					const m = mesh(kit.box(0.02 + 0.01 * (k % 3), 0.0012, 0.012, 0.0004), latex(hex))
					m.visible = false
					ctx.group.add(m)
					const a = (k * TAU) / 9 + 0.3
					bits.push({ m, vx: Math.cos(a) * 1.4, vy: Math.sin(a) * 1.4 + 0.6, spin: 3 + k })
				}
				pops.push({ t0, at: before, r, bits })
			}
			if (!pops.length) return null
			return {
				frame(t) {
					for (const p of pops) {
						const u = t - p.t0
						for (const b of p.bits) {
							b.m.visible = u >= 0 && u < 1.2 && !!p.at
							if (!b.m.visible) continue
							// thrown out and slowed by the air quickly (light shreds), then fluttering down at about 0.5 m/s
							const k = 1 - Math.exp(-u / 0.12)
							b.m.position.set(p.at.x + b.vx * 0.12 * k * (0.5 + p.r * 4), p.at.y + b.vy * 0.12 * k * (0.5 + p.r * 4) - 0.5 * Math.max(0, u - 0.15), 0.03 * Math.sin(b.spin))
							b.m.rotation.set(b.spin * u, b.spin * 0.7 * u, 0)
						}
					}
				}
			}
		}
	})

	// ------------------------------------------------------------- readouts the measuring things show (drawn in exports too)
	addViewPlugin({
		name: "air:readouts",
		load(ctx) {
			const shown = []
			for (const id of ctx.itemsOfType("anemometer")) {
				const head = ctx.solidsOf(id).find((s) => s.part === "head")
				if (!head) continue
				const l = ctx.label({ text: "0.0 m/s", height: 0.045 })
				l.sprite.position.set(head.at.x, head.at.y + 0.08, 0.05)
				ctx.group.add(l.sprite)
				shown.push({ l, id, key: "wind_ms", fmt: (v) => `${v.toFixed(1)} m/s` })
			}
			for (const id of ctx.itemsOfType("vacuum-jar")) {
				const top = ctx.solidsOf(id).find((s) => s.part === "glass-top")
				if (!top) continue
				const l = ctx.label({ text: "101 kPa", height: 0.045 })
				l.sprite.position.set(top.at.x, top.at.y + 0.08, 0.05)
				ctx.group.add(l.sprite)
				shown.push({ l, id, key: "pressure_kpa", fmt: (v) => `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} kPa` })
			}
			if (!shown.length) return null
			return {
				frame(t) {
					for (const s of shown) {
						const v = ctx.stateAt(s.id, s.key, t)
						if (Number.isFinite(v)) s.l.set(s.fmt(v))
					}
				},
				dispose() {
					for (const s of shown) s.l.dispose?.()
				}
			}
		}
	})
	void group
}
