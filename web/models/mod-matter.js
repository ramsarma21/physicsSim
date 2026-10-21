// 3D models of the matter module (machines/mod_matter.py): the particle model box on its hot plate, a sealed syringe, a balloon in a water bath,
// a drinking glass of water with crystals, a zip bag, a chocolate bar, a fizz bottle, a pumped ball's pump, a dish of a mixture, a sieve over a
// tray, and density cubes.
// What moves by the engine's own particle systems (tooling/src/sim/matter: the model's particles, a glass's crystals, a mixture's grains) is drawn
// by the view plugin "matter:particles" from the run's series (track.series[item].p, .k), interpolated between frames; a piston, a plunger, a
// stirring spoon, a balloon, foam and bubbles follow the item's readings (track.state). The particle drawings are a MODEL (a label says so).
// Frames (web/models3d.js): a slab part is centred on its own origin; this file's parts know their item's resolved props (ctx.props).
import { frameIndex } from "../track.js"
import { makeLib } from "./surfaces-lib.js"
import { atomModel } from "../sim/modules/matter.js"

const SUBSTANCE_COLOR = { water: "#3a7bd5", wax: "#e8d9a8", iron: "#8a8f96", gallium: "#b8c2cc", "carbon dioxide": "#d9e6ee", air: "#8fb7d9", nitrogen: "#7fa6d6", helium: "#f2c84b", bromine: "#a5401c" }
const SECOND_COLOR = "#e0533c" // (the other side's colour when one substance is shown in two)
// a mixture's grains: [size m, spread, colour, shape] (matter/grains.ts GRAINS: the same sizes and spreads)
const GRAIN_LOOK = {
	sand: [0.002, 0.2, "#d9b97c", "stone"], gravel: [0.007, 0.25, "#8d8a83", "stone"], "iron-filings": [0.0015, 0.25, "#3d3f42", "needle"],
	salt: [0.0015, 0.2, "#f4f4f2", "cube"], pepper: [0.0015, 0.3, "#2b2622", "stone"], rice: [0.003, 0.1, "#f3eee0", "grain"],
	beans: [0.011, 0.15, "#7a2e24", "bean"], "paper-clips": [0.008, 0.05, "#c7ccd1", "clip"]
}
const SOLUTE_LOOK = { salt: ["#f6f6f3", "cube"], sugar: ["#fbfbf7", "cube"], sand: ["#d8b77a", "stone"], chalk: ["#f7f7f2", "stone"] }

export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const T = THREE
	const M = (key, params) => kit.mat(`mt|${key}`, params)
	const mesh = (g, m, o) => kit.mesh(g, m, o)
	const group = (...c) => kit.group(...c)
	const at = (o, x = 0, y = 0, z = 0) => (o.position.set(x, y, z), o)

	// ------------------------------------------------------------- materials
	const pane = (tint = "#f2f8fb", opacity = 0.16) =>
		M(`pane|${tint}|${opacity}`, { color: tint, roughness: 0.03, metalness: 0, transparent: true, opacity, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.3, side: T.DoubleSide })
	const edge = (tint = "#cfe3ea") => M(`edge|${tint}`, { color: tint, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false, clearcoat: 1 })
	// (thickness: the screen-space refraction's reach; a thin one, so the surface seen from just above does not show a second, lifted picture of
	// the crystals on the bottom, which reads as salt floating at the top)
	const water = (att = "#9cc9ea", dist = 0.9, thick = 0.05) =>
		M(`water|${att}|${dist}|${thick}`, { color: "#f4fbff", roughness: 0.03, metalness: 0, transmission: 1, thickness: thick, ior: 1.333, attenuationColor: new T.Color(att), attenuationDistance: dist, specularIntensity: 1, envMapIntensity: 1.1 })
	const plastic = (hex, gloss = 0.5) => L.plasticMat(hex, gloss)
	const enamel = () => M("enamel", { color: "#ecebe6", roughness: 0.32, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.15 })
	const ceramicTop = () => M("hotplate-top", { color: "#1c1d20", roughness: 0.25, metalness: 0.1, clearcoat: 0.8, emissive: "#000000" })
	const black = () => M("black", { color: "#1d1f22", roughness: 0.45, metalness: 0, clearcoat: 0.3 })
	const rubber = (hex = "#222326") => M(`rubber|${hex}`, { color: hex, roughness: 0.8, metalness: 0 })
	const steel = () => kit.steel()
	// (opaque: three.js draws only opaque things into what a transmissive glass or water shows behind it)
	const latex = (hex = "#d93a3a") => M(`latex|${hex}`, { color: hex, roughness: 0.38, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 })
	const chocolate = (hex) => M(`choc|${hex}`, { color: hex, roughness: 0.38, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3 })
	const paperMat = () => kit.paper("#f2eee4")
	const foamMat = () => M("foam", { color: "#fbf8f0", roughness: 0.85, metalness: 0, transparent: true, opacity: 0.92 })

	// ------------------------------------------------------------- the particle model box (on its hot plate)
	addModel("particle-box", "base", (c) => {
		const { w, h, d } = c
		const body = at(mesh(kit.box(w, h * 0.86, d, 0.006), enamel()), 0, -h * 0.07, 0)
		const top = at(mesh(kit.box(w * 0.82, h * 0.14, d * 0.82, 0.002), ceramicTop()), 0, h / 2 - h * 0.07, 0)
		top.userData.frame = { hook: "matter:glow", scaled: false }
		const knob = at(mesh(kit.cylinderZ(0.009, 0.012, 24), black()), w / 2 - 0.035, -h * 0.1, d / 2 + 0.006)
		const lamp = at(mesh(kit.sphere(0.003, 16, 8), M("lamp-off", { color: "#5a1a14", roughness: 0.3, emissive: "#000000" })), w / 2 - 0.06, -h * 0.1, d / 2 + 0.001)
		lamp.userData.frame = { hook: "matter:glow", scaled: false, lamp: true }
		return group(body, top, knob, lamp)
	})
	addFrameHook("matter:glow", (obj, f, a) => {
		// the hot plate glows while it heats (its heat put in still rising) and holds when it has cut out
		const kj = f.state?.heat_kj
		const on = Number.isFinite(kj) && kj > 0
		const m = ownMaterial(obj)
		if (!m) return
		const k = on ? 1 : 0
		if (a.lamp) m.emissive?.set(on ? "#ff3b1f" : "#000000")
		else m.emissive?.set(new T.Color("#ff4a12").multiplyScalar(0.35 * k))
	})
	for (const part of ["floor", "left", "right", "lid"]) {
		addModel("particle-box", part, (c) => {
			const { w, h, d } = c
			const parts = [mesh(kit.box(w, h, d, 0.0008), pane("#eef6fa", 0.22), { cast: false })]
			if (part === "floor") {
				// the cell's front and back faces: two clear sheets the size of the box (they hold the particles in one plane)
				const W = c.props.width ?? 0.2
				const H = c.props.height ?? 0.2
				for (const z of [-d / 2, d / 2]) parts.push(at(mesh(kit.box(W + 2 * 0.006, H + 0.006, 0.003), pane("#f4f9fb", 0.1), { cast: false }), 0, h / 2 + H / 2, z))
			}
			return group(...parts)
		})
	}

	// ------------------------------------------------------------- the syringe
	addModel("syringe", "foot", (c) => {
		const { w, h, d } = c
		const base = mesh(kit.box(w, h, d, 0.003), M("stand-iron", { color: "#2b2e33", roughness: 0.55, metalness: 0.6 }))
		const rod = at(mesh(kit.cylinderY(0.004, 0.16, 16), steel()), 0, h / 2 + 0.08, -0.024)
		const clamp = at(mesh(kit.torus(0.0155, 0.0022, 10, 32), steel()), 0, h / 2 + 0.07, 0)
		clamp.rotation.x = Math.PI / 2
		const arm = at(mesh(kit.box(0.004, 0.004, 0.026, 0.001), steel()), 0, h / 2 + 0.07, -0.012)
		return group(base, rod, clamp, arm)
	})
	addModel("syringe", "tip", (c) => {
		const cap = at(mesh(kit.cylinderY(0.006, 0.012, 24), plastic("#e86d1f", 0.6)), 0, -0.002, 0)
		const cone = at(mesh(kit.cylinderY(0.014, 0.006, 32, 0.006), M("barrel-pp", { color: "#f4f6f7", roughness: 0.2, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 0.6, depthWrite: false })), 0, 0.003, 0)
		return group(cap, cone)
	})
	addModel("syringe", "left", (c) => {
		// the whole barrel (both wall parts): a clear polypropylene tube with millilitre marks every 5 mL, numbered every 10
		const R = 0.0267 / 2 + 0.0015
		const H = c.h
		const marks = kit.printed("syringe-marks", (g, W2, H2) => {
			g.clearRect(0, 0, W2, H2)
			g.fillStyle = "rgba(20,20,20,0.85)"
			g.font = "bold 22px system-ui, sans-serif"
			for (let ml = 0; ml <= 60; ml += 5) {
				const y = H2 - (H2 * (ml / 60) * 0.1072) / (0.1072 * 1.05)
				g.fillRect(W2 * 0.46, y - 1, ml % 10 === 0 ? 70 : 40, 3)
				if (ml % 10 === 0 && ml) g.fillText(String(ml), W2 * 0.46 + 76, y + 8)
			}
		}, { w: 512, h: 1024, roughness: 0.25 })
		const tubeMat = M("barrel", { color: "#f7fafb", roughness: 0.15, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false, side: T.DoubleSide })
		const tube = at(mesh(kit.cylinderY(R, H, 48), tubeMat, { cast: false }), 0.0267 / 2 + 0.00075, 0, 0)
		const scaleMat = M("barrel-marks", { map: marks.map, transparent: true, roughness: 0.4, metalness: 0, depthWrite: false })
		const scale = at(mesh(new T.CylinderGeometry(R + 0.0002, R + 0.0002, H, 48, 1, true, -0.6, 1.2), scaleMat, { cast: false }), 0.0267 / 2 + 0.00075, 0, 0)
		const flange = at(mesh(kit.box(0.055, 0.003, 0.03, 0.001), M("barrel-flange", { color: "#f4f6f7", roughness: 0.2, transparent: true, opacity: 0.6, depthWrite: false })), 0.0267 / 2 + 0.00075, H / 2, 0)
		return group(tube, scale, flange)
	})
	addModel("syringe", "right", () => null)

	// ------------------------------------------------------------- the balloon in a water bath
	addModel("balloon-bath", "floor", (c) => {
		const D = c.props.bowl_d ?? 0.24
		const H = 0.18
		const t = 0.004
		const prof = [[0, -t / 2], [D / 2 - 0.01, -t / 2], [D / 2 + t, 0.01], [D / 2 + t, H], [D / 2, H], [D / 2 - 0.004, 0.012], [0, t / 2]]
		const bowl = mesh(kit.lathe(prof, 64, `bath|${D}`), pane("#eef6f4", 0.18), { cast: false })
		const hot = (c.props.water_temp_c ?? 60) > 40
		const wat = at(mesh(kit.cylinderY(D / 2 - 0.004, 0.155, 64), water(hot ? "#b9d6ec" : "#a8d3f0", 1.0), { cast: false }), 0, t / 2 + 0.0775, 0)
		// the wire frame that holds the balloon down: two hoops over it, to the rim
		const wire = kit.steel()
		const hoopA = at(mesh(kit.torus(D * 0.36, 0.0012, 8, 48, Math.PI), wire), 0, 0.075, 0)
		const hoopB = at(mesh(kit.torus(D * 0.36, 0.0012, 8, 48, Math.PI), wire), 0, 0.075, 0)
		hoopB.rotation.y = Math.PI / 2
		return group(bowl, wat, hoopA, hoopB)
	})
	addModel("balloon-bath", "left", () => null)
	addModel("balloon-bath", "right", () => null)

	// ------------------------------------------------------------- the glass of water
	addModel("dissolving-glass", "base", (c) => {
		const R = 0.035
		const t = 0.0025
		const b = 0.006
		const H = 0.1
		const y0 = -b / 2
		// a tumbler: a thick base, straight walls, a rounded rim (lathe profile, outside up then inside down)
		const prof = [[0, y0], [R + t - 0.002, y0], [R + t, y0 + 0.002], [R + t, y0 + b + H - 0.0008], [R + t / 2, y0 + b + H], [R, y0 + b + H - 0.0008], [R, y0 + b + 0.001], [R - 0.002, y0 + b], [0, y0 + b]]
		const glass = mesh(kit.lathe(prof, 72, "tumbler"), pane("#eef7f4", 0.2), { cast: false })
		const foot = at(mesh(kit.cylinderY(R + t - 0.001, b * 0.9, 72), M("tumbler-foot", { color: "#e3f1ec", roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false })), 0, 0, 0)
		const parts = [glass, foot]
		const depth = ((c.props.water_ml ?? 200) / 1e6) / (Math.PI * R * R)
		if (depth > 0.001) parts.push(at(mesh(kit.cylinderY(R - 0.0004, Math.min(H - 0.005, depth), 72), water("#9cc9ea", 0.9, 0.01), { cast: false }), 0, b / 2 + Math.min(H - 0.005, depth) / 2, 0))
		return group(...parts)
	})
	for (const part of ["wall-left", "wall-right", "water", "ballast"]) addModel("dissolving-glass", part, () => null)
	addModel("dissolving-glass", "dish", (c) => {
		// a little pleated paper cup holding the crystals; it is lifted and tipped over the glass when they are poured (frame hook)
		const cup = mesh(kit.lathe([[0, -0.0125], [0.016, -0.0125], [0.02, 0.0125], [0.0195, 0.0125], [0.0155, -0.0115], [0, -0.0115]], 36, "paper-cup"), paperMat())
		const heap = at(mesh(kit.sphere(0.012, 24, 12), M("heap", { color: "#f4f4f1", roughness: 0.9 })), 0, -0.006, 0)
		heap.scale.set(1, 0.45, 1)
		const g = group(cup, heap)
		g.userData.frame = { hook: "matter:pour", pourAt: c.props.pour_at_s ?? 0.5, dx: -(0.035 + 0.0025 + 0.028), scaled: false }
		return g
	})
	addFrameHook("matter:pour", (obj, f, a) => {
		// lifted over the glass's middle and tipped in the half second before the pour, held there half a second, put back
		const u = (f.t - (a.pourAt - 0.5)) / 0.5
		const k = u <= 0 ? 0 : u >= 2.4 ? 0 : u < 1 ? u * u * (3 - 2 * u) : u < 1.6 ? 1 : 1 - ((u - 1.6) / 0.8) ** 2
		obj.position.set(a.dx * k, 0.11 * k, 0)
		obj.rotation.z = 1.9 * k
		const heap = obj.children[1]
		if (heap) heap.visible = f.t < a.pourAt
	})

	// ------------------------------------------------------------- the zip bag
	addModel("zip-bag", "floor", (c) => {
		const { w, d } = c
		const puff = c.props.puff ?? 0.06
		const film = M("bag-film", { color: "#f6fbfd", roughness: 0.12, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false, side: T.DoubleSide })
		// a pillow of film over what it holds: a flat ellipsoid, and its flat bottom sheet
		const pillow = at(mesh(kit.geo("mt-hemi", () => new T.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2)), film, { cast: false }), 0, 0.0005, 0)
		pillow.scale.set(w / 2, puff, d / 2)
		const sheet = mesh(kit.box(w * 0.98, 0.0006, d * 0.98, 0.0002), film, { cast: false })
		const zip = at(mesh(kit.box(0.003, Math.min(0.012, puff * 0.4), d * 0.96, 0.001), plastic("#2f7fd0", 0.6)), w / 2 - 0.008, Math.min(0.012, puff * 0.4) / 2 + 0.002, 0)
		const strip = at(mesh(kit.box(0.0012, Math.min(0.011, puff * 0.38), d * 0.95, 0.0005), plastic("#d23c3c", 0.6)), w / 2 - 0.011, Math.min(0.011, puff * 0.38) / 2 + 0.002, 0)
		// the water that has melted in it lies on its bottom (frame hook: its grams over the bag's floor)
		const wat = at(mesh(kit.box(w * 0.94, 1, d * 0.92, 0.0004), water("#a7d3ee", 0.6), { cast: false }), 0, 0, 0)
		wat.userData.frame = { hook: "matter:bagwater", area: w * 0.94 * d * 0.92, scaled: false }
		return group(sheet, pillow, zip, strip, wat)
	})
	addFrameHook("matter:bagwater", (obj, f, a) => {
		const g = f.state?.water_g
		const h = Number.isFinite(g) && g > 0.05 ? g / 1000 / 998 / a.area : 0
		obj.visible = h > 0
		obj.scale.y = Math.max(1e-5, h)
		obj.position.y = 0.001 + h / 2
	})
	for (const part of ["side-left", "side-right", "ballast"]) addModel("zip-bag", part, () => null)

	// ------------------------------------------------------------- the chocolate bar's squares
	addModel("chocolate-bar", "*", (c) => {
		const { w, h, d } = c
		const hex = c.props.color ?? "#5a3422"
		const m = chocolate(hex)
		const parts = []
		// each piece is two squares deep, each a slab with a raised, bevelled top (the moulded square)
		for (const z of [-d / 4, d / 4]) {
			parts.push(at(mesh(kit.box(w - 0.0006, h * 0.55, d / 2 - 0.0006, 0.0006), m), 0, -h * 0.225, z))
			parts.push(at(mesh(kit.box(w - 0.004, h * 0.45, d / 2 - 0.004, 0.0018), m), 0, h * 0.27, z))
		}
		return group(...parts)
	})

	// ------------------------------------------------------------- the fizz bottle
	addModel("reaction-bottle", "base", (c) => {
		const R = 0.0325
		const b = 0.004
		const H = 0.2
		const y0 = -b / 2
		// a 500 mL PET bottle: petaloid foot, straight body, a shoulder up to a 2.2 cm neck with a thread ring
		const prof = [[0, y0 + 0.002], [R * 0.6, y0], [R - 0.002, y0 + 0.002], [R, y0 + 0.01], [R, y0 + H * 0.72], [R * 0.86, y0 + H * 0.8], [R * 0.5, y0 + H * 0.92], [0.0125, y0 + H * 0.97],
			[0.0125, y0 + H + 0.025], [0.0118, y0 + H + 0.025], [0.0118, y0 + H * 0.97 + 0.001], [R * 0.49, y0 + H * 0.92 - 0.0005], [R * 0.85, y0 + H * 0.8 - 0.0005], [R - 0.0004, y0 + H * 0.72], [R - 0.0004, y0 + 0.01], [0, y0 + 0.003]]
		const bottle = mesh(kit.lathe(prof, 72, "pet-bottle"), M("pet", { color: "#eef8fb", roughness: 0.06, metalness: 0, transparent: true, opacity: 0.26, clearcoat: 1, depthWrite: false, side: T.DoubleSide }), { cast: false })
		const ring = at(mesh(kit.torus(0.0135, 0.0012, 8, 36), M("pet-ring", { color: "#dbeef4", roughness: 0.1, transparent: true, opacity: 0.6, depthWrite: false })), 0, y0 + H + 0.008, 0)
		ring.rotation.x = Math.PI / 2
		const vin = ((c.props.vinegar_ml ?? 100) / 1e6) / (Math.PI * (R - 0.0004) ** 2)
		const liquid = at(mesh(kit.cylinderY(R - 0.0008, vin, 64), water("#e9dfb0", 0.5), { cast: false }), 0, b / 2 + vin / 2, 0)
		const foam = at(mesh(kit.cylinderY(R - 0.001, 1, 48), foamMat(), { cast: false }), 0, 0, 0)
		foam.userData.frame = { hook: "matter:foam", y: b / 2 + vin, scaled: false }
		const parts = [bottle, ring, liquid, foam]
		const closure = c.props.closure ?? "open"
		if (closure === "cap") {
			const cap = at(mesh(kit.cylinderY(0.0145, 0.016, 32), plastic("#f2f2f2", 0.6)), 0, y0 + H + 0.03, 0)
			// (past 900 kPa it pops off: it flies up and away, spinning: the popped reading)
			cap.userData.frame = { hook: "matter:cap", y: y0 + H + 0.03, scaled: false }
			parts.push(cap)
		}
		if (closure === "balloon") {
			const neck = at(mesh(kit.cylinderY(0.0135, 0.02, 32), latex()), 0, y0 + H + 0.02, 0)
			const ball = at(mesh(kit.sphere(1, 40, 24), latex()), 0, y0 + H + 0.03, 0)
			ball.userData.frame = { hook: "matter:balloon", y: y0 + H + 0.03, scaled: false }
			parts.push(neck, ball)
		}
		// the sachet of baking soda hanging in the neck until it drops in
		const sachet = at(mesh(kit.box(0.014, 0.03, 0.006, 0.001), paperMat()), 0, y0 + H * 0.9, 0)
		sachet.userData.frame = { hook: "matter:sachet", mixAt: c.props.mix_at_s ?? 1, y: y0 + H * 0.9, floor: b / 2 + vin, scaled: false }
		parts.push(sachet)
		// bubbles rising while it fizzes (a fixed pattern climbing with the clock)
		const bub = new T.InstancedMesh(kit.sphere(0.0016, 10, 6), M("bubble", { color: "#ffffff", roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false }), 40)
		bub.userData.frame = { hook: "matter:bubbles", y0: b / 2, y1: b / 2 + vin, r: R - 0.004, scaled: false }
		bub.castShadow = false
		parts.push(bub)
		return group(...parts)
	})
	for (const part of ["wall-left", "wall-right", "vinegar", "ballast"]) addModel("reaction-bottle", part, () => null)
	addFrameHook("matter:foam", (obj, f, a) => {
		const z = Number.isFinite(f.state?.fizz) ? f.state.fizz : 0
		const h = 0.002 + 0.05 * z
		obj.visible = z > 0.02
		obj.scale.y = h
		obj.position.y = a.y + h / 2
	})
	addFrameHook("matter:cap", (obj, f, a) => {
		const popped = Number.isFinite(f.state?.popped) && f.state.popped >= 0.5
		if (!popped || obj.userData.popAt === undefined || f.t < obj.userData.popAt) obj.userData.popAt = popped ? f.t : undefined
		const u = popped ? f.t - obj.userData.popAt : 0
		// a thrown cap: up at 3 m/s and sideways at 0.8 m/s, falling at g, turning 3 times a second; gone after 0.7 s
		obj.position.set(0.8 * u, a.y + 3 * u - 4.9 * u * u, 0)
		obj.rotation.z = 6 * Math.PI * u
		obj.visible = u < 0.7
	})
	addFrameHook("matter:balloon", (obj, f, a) => {
		const ml = Number.isFinite(f.state?.balloon_ml) ? f.state.balloon_ml : 0
		const r = Math.max(0.012, Math.cbrt((3 * (ml / 1e6 + 6e-6)) / (4 * Math.PI)))
		obj.scale.set(r, r * 1.08, r)
		obj.position.y = a.y + r * 1.05
	})
	addFrameHook("matter:sachet", (obj, f, a) => {
		const u = Math.max(0, f.t - a.mixAt)
		const y = a.y - 4.9 * u * u
		obj.position.y = Math.max(a.floor + 0.004, y)
		obj.visible = u < 0.6
	})
	const bubM = new T.Matrix4()
	addFrameHook("matter:bubbles", (obj, f, a) => {
		const z = Number.isFinite(f.state?.fizz) ? f.state.fizz : 0
		const n = Math.round(40 * Math.min(1, z * 1.5))
		obj.count = n
		for (let i = 0; i < n; i++) {
			const ph = ((i * 0.6180339887) % 1 + f.t * 0.9) % 1
			const ang = i * 2.39996
			const rr = a.r * Math.sqrt(((i * 0.3819660113) % 1) * 0.9)
			bubM.makeTranslation(rr * Math.cos(ang), a.y0 + (a.y1 - a.y0) * ph, rr * Math.sin(ang))
			obj.setMatrixAt(i, bubM)
		}
		obj.instanceMatrix.needsUpdate = true
	})

	// ------------------------------------------------------------- the mixture dish and the sieve's tray
	addModel("mixture-dish", "floor", (c) => {
		const W = c.props.width ?? 0.15
		const H = 0.035
		const t = 0.004
		const R = W / 2
		const prof = [[0, -t / 2], [R + t - 0.003, -t / 2], [R + t, -t / 2 + 0.003], [R + t, t / 2 + H], [R, t / 2 + H], [R, t / 2 + 0.002], [R - 0.002, t / 2], [0, t / 2]]
		return mesh(kit.lathe(prof, 72, `dish|${W}`), pane("#eef7f4", 0.24), { cast: false })
	})
	for (const part of ["wall-left", "wall-right", "ballast"]) addModel("mixture-dish", part, () => null)
	addModel("sieve", "tray", (c) => {
		const W = 0.2
		const H = 0.035
		const t = 0.004
		const m = M("tray-steel", { color: "#c9ced3", roughness: 0.28, metalness: 1 })
		const floor = mesh(kit.box(c.w, c.h, c.d, 0.001), m)
		const wallF = at(mesh(kit.box(W + 2 * t, H, t, 0.001), m), 0, t / 2 + H / 2, c.d / 2 - t / 2)
		const wallB = at(mesh(kit.box(W + 2 * t, H, t, 0.001), m), 0, t / 2 + H / 2, -c.d / 2 + t / 2)
		// the sieve: a round kitchen sieve (a wire-mesh floor in a steel rim, a handle) on a wire stand over the tray; its frame hook shakes it
		const hs = c.props.sieve_height ?? 0.1
		const ap = c.props.aperture_mm ?? 4
		const y = t / 2 + hs
		const meshTex = kit.printed(`sieve-mesh|${ap}`, (g, W2, H2) => {
			g.clearRect(0, 0, W2, H2)
			g.strokeStyle = "rgba(160,166,172,1)"
			g.lineWidth = 3
			const step = Math.max(5, Math.round((W2 * ap) / 1000 / 0.16))
			for (let x = 0; x < W2; x += step) (g.beginPath(), g.moveTo(x, 0), g.lineTo(x, H2), g.stroke())
			for (let yy = 0; yy < H2; yy += step) (g.beginPath(), g.moveTo(0, yy), g.lineTo(W2, yy), g.stroke())
		}, { w: 512, h: 512, roughness: 0.3, metalness: 0.8 })
		const disc = mesh(kit.geo(`sieve-disc`, () => new T.CircleGeometry(0.081, 64).rotateX(-Math.PI / 2)), M(`sieve-mesh|${ap}`, { map: meshTex.map, transparent: true, alphaTest: 0.3, metalness: 0.8, roughness: 0.3, side: T.DoubleSide }))
		const rim = mesh(kit.torus(0.082, 0.0025, 10, 64), steel())
		rim.rotation.x = Math.PI / 2
		// (its side is wire mesh too, as a kitchen sieve's: the grains in it show through)
		const wallMap = meshTex.map.clone()
		wallMap.wrapS = wallMap.wrapT = T.RepeatWrapping
		wallMap.repeat.set((2 * Math.PI * 0.0825) / 0.16, 0.04 / 0.16)
		wallMap.needsUpdate = true
		const wall = at(mesh(kit.geo("sieve-wall", () => new T.CylinderGeometry(0.084, 0.081, 0.04, 64, 1, true)), M(`sieve-wall-mesh|${ap}`, { map: wallMap, transparent: true, alphaTest: 0.3, metalness: 0.8, roughness: 0.3, side: T.DoubleSide }), { cast: false }), 0, 0.02, 0)
		const lip = at(mesh(kit.torus(0.084, 0.002, 8, 64), steel()), 0, 0.04, 0)
		lip.rotation.x = Math.PI / 2
		const handle = at(mesh(kit.box(0.11, 0.006, 0.014, 0.002), black()), -0.14, 0.036, 0)
		handle.rotation.z = 0.25
		const sieve = at(group(disc, rim, wall, lip, handle), 0, y, 0)
		sieve.userData.frame = { hook: "matter:sieve", x: 0, scaled: false }
		// its stand: four wire legs from the tray's floor to the sieve's rim
		const legs = []
		for (const [lx, lz] of [[-0.075, -0.03], [0.075, -0.03], [-0.075, 0.03], [0.075, 0.03]]) legs.push(at(mesh(kit.cylinderY(0.0015, hs, 8), steel()), lx, t / 2 + hs / 2, lz))
		return group(floor, wallF, wallB, sieve, ...legs)
	})
	addFrameHook("matter:sieve", (obj, f) => {
		obj.position.x = Number.isFinite(f.state?.sieve_x) ? f.state.sieve_x : 0
	})
	for (const part of ["tray-left", "tray-right"]) addModel("sieve", part, (c) => mesh(kit.box(c.w, c.h, c.d, 0.001), M("tray-steel", { color: "#c9ced3", roughness: 0.28, metalness: 1 })))

	// ------------------------------------------------------------- the filter funnel: a ring stand, a glass funnel lined with filter paper, a beaker
	// (item frame: the beaker's bottom middle; the funnel's apex 13.5 cm up; tooling/src/sim/matter/separate.ts: the 60° cone, FULL 0.615 × its rim)
	const TAN30 = 0.5773502691896257
	const FILTER_APEX = 0.135
	const unitCone = () => kit.cylinderY(0, 1, 40, TAN30) // (a cone 1 high, its top TAN30 across: scaled by a height it is the liquid's cone)
	const filtrateMat = (cloudy) => (cloudy ? M("filtrate-cloudy", { color: "#e9e4d6", roughness: 0.5, metalness: 0, transparent: true, opacity: 0.85 }) : water("#b4d7ee", 0.7, 0.02))
	addModel("filter-funnel", "beaker", (c) => {
		// a 250 mL low-form glass beaker with a pouring lip and white graduations; its filtrate rises in it (frame hook)
		const R = 0.035
		const y0 = -c.h / 2
		const prof = [[0, y0], [R - 0.0015, y0], [R, y0 + 0.0015], [R, y0 + 0.093], [R + 0.0016, y0 + 0.0945], [R - 0.0002, y0 + 0.095], [R - 0.0015, y0 + 0.093], [R - 0.0015, y0 + 0.0035], [R - 0.003, y0 + 0.0025], [0, y0 + 0.0025]]
		const glass = mesh(kit.lathe(prof, 64, "beaker-250"), pane("#eef7f4", 0.2), { cast: false })
		const parts = [glass]
		const marks = M("beaker-marks", { color: "#ffffff", roughness: 0.6, metalness: 0, transparent: true, opacity: 0.85 })
		for (let ml = 50; ml <= 200; ml += 50) {
			const h = ml / 1e6 / (Math.PI * (R - 0.0015) * (R - 0.0015))
			parts.push(at(mesh(kit.box(0.012, 0.0008, 0.0004, 0.0001), marks, { cast: false }), 0, y0 + 0.0025 + h, R + 0.0002))
		}
		const cloudy = (c.props.solid ?? "sand") !== "none" && ((c.props.paper ?? "filter paper") === "none" || ((c.props.solid ?? "sand") === "chalk" && c.props.paper === "coffee filter"))
		const liquid = at(mesh(kit.cylinderY(R - 0.0018, 1, 48), filtrateMat(cloudy), { cast: false }), 0, 0, 0)
		liquid.userData.frame = { hook: "matter:filtrate", y: y0 + 0.0025, area: Math.PI * (R - 0.0018) * (R - 0.0018), scaled: false }
		liquid.visible = false
		liquid.scale.y = 1e-5
		parts.push(liquid)
		return group(...parts)
	})
	addFrameHook("matter:filtrate", (obj, f, a) => {
		const ml = Number.isFinite(f.state?.filtrate_ml) ? f.state.filtrate_ml : 0
		const h = ml / 1e6 / a.area
		obj.visible = h > 0.0003
		obj.scale.y = Math.max(1e-5, h)
		obj.position.y = a.y + h / 2
	})
	for (const part of ["beaker-left", "beaker-right"]) addModel("filter-funnel", part, () => null)
	addModel("filter-funnel", "foot", (c) => mesh(kit.box(c.w, c.h, c.d, 0.003), M("stand-iron", { color: "#2b2e33", roughness: 0.55, metalness: 0.6 })))
	addModel("filter-funnel", "rod", (c) => {
		// the stand's rod, a boss head and the ring that holds the funnel just under its rim
		const D = (c.props.funnel_mm ?? 75) / 1000
		const rim = FILTER_APEX + D / 2 / TAN30
		const ringY = rim - 0.012 - (0.012 + c.h / 2) // (in the rod's frame: its middle is 0.162 m up)
		const ringR = (rim - 0.012 - FILTER_APEX) * TAN30 + 0.002
		const rod = mesh(kit.cylinderY(0.005, c.h, 20), steel())
		const boss = at(mesh(kit.box(0.022, 0.022, 0.022, 0.003), M("boss", { color: "#3a3d42", roughness: 0.5, metalness: 0.7 })), 0, ringY, 0)
		const arm = at(mesh(kit.cylinderY(0.003, 0.17 - ringR, 12), steel()), (0.17 - ringR) / 2, ringY, 0)
		arm.rotation.z = Math.PI / 2
		const ring = at(mesh(kit.torus(ringR, 0.0025, 10, 48), steel()), 0.17, ringY, 0)
		ring.rotation.x = Math.PI / 2
		return group(rod, boss, arm, ring)
	})
	addModel("filter-funnel", "funnel", (c) => {
		const D = (c.props.funnel_mm ?? 75) / 1000
		const R = D / 2
		const rim = FILTER_APEX + R / TAN30
		// the glass cone (a thin shell: out up its side, back down inside)
		const prof = [[0.0036, FILTER_APEX - 0.0004], [R + 0.0012, rim], [R + 0.0024, rim + 0.0016], [R - 0.0006, rim + 0.0014], [0.0024, FILTER_APEX + 0.0016]]
		const cone = mesh(kit.lathe(prof, 64, `funnel|${D}`), pane("#eef7f4", 0.22), { cast: false })
		// the filter paper: a 12.5 cm circle (for a 7.5 cm funnel) folded in quarters, its cone inside the glass's, ending 0.8 cm under the rim
		// (drawn a little see-through, as wet paper is: the liquid and the sand in it show)
		const slant = 0.0625 * (D / 0.075)
		const ph = slant * 0.8660254037844386
		const paper = mesh(kit.lathe([[0.0012, FILTER_APEX + 0.003], [0.0012 + ph * TAN30, FILTER_APEX + 0.003 + ph]], 48, `paper-cone|${D}`), M("filter-paper", { color: "#fbfaf5", roughness: 0.95, metalness: 0, side: T.DoubleSide, transparent: true, opacity: 0.62, depthWrite: false }))
		// its fold: one side three layers (a ridge)
		const fold = at(mesh(kit.box(0.0008, ph * 1.02, 0.0008, 0.0002), M("filter-paper", { color: "#fbfaf5", roughness: 0.95, metalness: 0, side: T.DoubleSide, transparent: true, opacity: 0.62, depthWrite: false })), (ph * TAN30) / 2 - 0.0004, FILTER_APEX + 0.003 + ph / 2, 0.0006)
		fold.rotation.z = -Math.atan(TAN30)
		const solid = c.props.solid ?? "sand"
		const kept = solid !== "none" && (c.props.paper ?? "filter paper") !== "none" && !(solid === "chalk" && c.props.paper === "coffee filter")
		const muddy = solid !== "none" && !kept
		const liquid = mesh(unitCone(), muddy ? filtrateMat(true) : water("#b9d9ee", 0.6, 0.02), { cast: false })
		liquid.userData.frame = { hook: "matter:funnelliquid", y: FILTER_APEX + 0.003, scaled: false }
		liquid.visible = false
		liquid.scale.setScalar(1e-5)
		const cakeMat = solid === "chalk" ? M("cake-chalk", { color: "#f1efe6", roughness: 0.95, metalness: 0 }) : M("cake-sand", { color: "#cfae74", roughness: 1, metalness: 0 })
		const cake = mesh(unitCone(), cakeMat)
		cake.userData.frame = { hook: "matter:cake", y: FILTER_APEX + 0.003, density: solid === "chalk" ? 2710 : 2650, porosity: solid === "chalk" ? 0.5 : 0.4, scaled: false }
		cake.visible = false
		cake.scale.setScalar(1e-5)
		// the cup the mixture is poured from: held over the funnel's right side, tipped while it pours (frame hook)
		const cupMat = M("pour-cup", { color: "#f6f8f9", roughness: 0.15, metalness: 0, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false, side: T.DoubleSide })
		const cupBody = mesh(kit.lathe([[0, -0.04], [0.026, -0.04], [0.032, 0.04], [0.031, 0.04], [0.0245, -0.0388], [0, -0.0388]], 40, "pour-cup"), cupMat, { cast: false })
		const total = (c.props.water_ml ?? 100) / 1e6
		const mix = mesh(kit.cylinderY(0.026, 1, 32, 0.031), muddy || solid !== "none" ? M("cup-mix", { color: solid === "chalk" ? "#ecebe4" : "#c9b48a", roughness: 0.6, metalness: 0, transparent: true, opacity: 0.8 }) : water("#b9d9ee", 0.6, 0.02), { cast: false })
		mix.userData.level = 0.07 * Math.min(1, total / 2.5e-4)
		mix.scale.y = Math.max(1e-5, mix.userData.level)
		mix.position.y = -0.0388 + mix.userData.level / 2
		const cup = group(cupBody, mix)
		cup.position.set(R + 0.022, rim + 0.05, 0)
		cup.userData.frame = { hook: "matter:pourcup", x: R + 0.022, y: rim + 0.05, pourAt: c.props.pour_at_s ?? 0.5, total: ((c.props.water_ml ?? 100) + (c.props.rinse_ml ?? 10)) * 1, water: c.props.water_ml ?? 100, cap: 0.349 * Math.pow(0.615 * D, 3) * 1e6, scaled: false }
		const stream = mesh(kit.cylinderY(0.0018, 1, 12), muddy ? filtrateMat(true) : water("#c5e1f2", 0.5, 0.01), { cast: false })
		stream.visible = false
		stream.userData.frame = { hook: "matter:pourstream", x: R * 0.45, top: rim + 0.03, bottom: FILTER_APEX + 0.003, pourAt: c.props.pour_at_s ?? 0.5, total: (c.props.water_ml ?? 100) + (c.props.rinse_ml ?? 10), cap: 0.349 * Math.pow(0.615 * D, 3) * 1e6, scaled: false }
		return group(cone, paper, fold, liquid, cake, cup, stream)
	})
	addFrameHook("matter:funnelliquid", (obj, f, a) => {
		const h = Number.isFinite(f.state?.level_mm) ? f.state.level_mm / 1000 : 0
		obj.visible = h > 0.0008
		obj.scale.setScalar(Math.max(1e-5, h))
		obj.position.y = a.y + h / 2
	})
	addFrameHook("matter:cake", (obj, f, a) => {
		// the solid kept on the paper: a cone in the paper's tip of the cake's volume (its grains and their pores)
		const g = Number.isFinite(f.state?.kept_g) ? f.state.kept_g : 0
		const V = g / 1000 / a.density / (1 - a.porosity)
		const h = V > 0 ? Math.cbrt(V / ((Math.PI * TAN30 * TAN30) / 3)) : 0
		obj.visible = h > 0.0005
		obj.scale.setScalar(Math.max(1e-5, h))
		obj.position.y = a.y + h / 2
	})
	addFrameHook("matter:pourcup", (obj, f, a) => {
		// held upright beside the funnel, tipped over it while the cup still holds some of the mixture or the rinse
		const poured = Number.isFinite(f.state?.poured_ml) ? f.state.poured_ml : 0
		const left = Math.max(0, a.total - poured)
		const started = f.t >= a.pourAt - 0.3
		const tip = started && left > 0.05 ? Math.min(1, (f.t - (a.pourAt - 0.3)) / 0.3) : 0
		obj.position.set(a.x, a.y, 0)
		obj.rotation.z = 1.25 * tip
		const mix = obj.children[1]
		if (mix) {
			const k = a.total > 0 ? left / a.total : 0
			const h = Math.max(1e-5, mix.userData.level * k)
			mix.visible = k > 0.002
			mix.scale.y = h
			mix.position.y = -0.0388 + h / 2
		}
		obj.visible = f.t < a.pourAt - 0.3 || left > 0.05 || f.t < a.pourAt + 0.2
	})
	addFrameHook("matter:pourstream", (obj, f, a) => {
		const poured = Number.isFinite(f.state?.poured_ml) ? f.state.poured_ml : 0
		const inFunnel = Number.isFinite(f.state?.in_funnel_ml) ? f.state.in_funnel_ml : 0
		const pouring = f.t >= a.pourAt && a.total - poured > 0.05 && inFunnel < a.cap - 0.3
		const lvl = Number.isFinite(f.state?.level_mm) ? f.state.level_mm / 1000 : 0
		const bottom = a.bottom + lvl
		const len = Math.max(0.001, a.top - bottom)
		obj.visible = pouring
		obj.scale.y = len
		obj.position.set(a.x, bottom + len / 2, 0)
	})
	addModel("filter-funnel", "stem", (c) => {
		// the funnel's stem (its tip against the beaker's inside) and the drops falling from it while the filtrate runs
		const stem = mesh(kit.cylinderY(0.0035, c.h, 20), pane("#eef7f4", 0.3), { cast: false })
		const drops = new T.InstancedMesh(kit.sphere(0.0018, 12, 8), water("#c5e1f2", 0.5, 0.01), 6)
		drops.castShadow = false
		drops.frustumCulled = false // (its instances move: a bounding sphere made while none showed would hide them all)
		drops.count = 0
		drops.userData.frame = { hook: "matter:drips", tip: -c.h / 2, stemY: FILTER_APEX - 0.028, floor: 0.0025, area: Math.PI * 0.0332 * 0.0332, scaled: false }
		return group(stem, drops)
	})
	const dripM = new T.Matrix4()
	addFrameHook("matter:drips", (obj, f, a) => {
		// drops fall from the stem's tip to the filtrate's surface, as many at a time as the flow: about a drop (0.05 mL) per ...
		const flow = Number.isFinite(f.state?.flow_ml_min) ? f.state.flow_ml_min : 0
		const ml = Number.isFinite(f.state?.filtrate_ml) ? f.state.filtrate_ml : 0
		const surface = a.floor + ml / 1e6 / a.area - a.stemY // (in the stem's frame)
		const fall = Math.max(0.002, a.tip - surface)
		const n = flow > 0.05 ? Math.min(6, 1 + Math.floor(flow / 2)) : 0
		obj.count = n
		for (let i = 0; i < n; i++) {
			const ph = ((f.t * 2.2 + i / n) % 1 + 1) % 1
			dripM.makeTranslation(0, a.tip - fall * ph * ph, 0)
			obj.setMatrixAt(i, dripM)
		}
		obj.instanceMatrix.needsUpdate = true
	})

	// ------------------------------------------------------------- the evaporating dish (on its hot plate, or on its own)
	const DISH_RIM = 0.045
	const DISH_DEPTH = 0.035
	const DISH_SPHERE = (DISH_RIM * DISH_RIM + DISH_DEPTH * DISH_DEPTH) / (2 * DISH_DEPTH)
	addModel("evaporating-dish", "plate", (c) => {
		const { w, h, d } = c
		const body = at(mesh(kit.box(w, h * 0.86, d, 0.006), enamel()), 0, -h * 0.07, 0)
		const top = at(mesh(kit.box(w * 0.86, h * 0.14, d * 0.86, 0.002), M("dish-plate-top", { color: "#1c1d20", roughness: 0.25, metalness: 0.1, clearcoat: 0.8, emissive: "#000000" })), 0, h / 2 - h * 0.07, 0)
		top.userData.frame = { hook: "matter:plateon", from: c.props.heat_from_s ?? 1, on: (c.props.heater_w ?? 300) > 0, scaled: false }
		const knob = at(mesh(kit.cylinderZ(0.009, 0.012, 24), black()), w / 2 - 0.035, -h * 0.1, d / 2 + 0.006)
		const lamp = at(mesh(kit.sphere(0.003, 16, 8), M("dish-lamp", { color: "#5a1a14", roughness: 0.3, emissive: "#000000" })), w / 2 - 0.06, -h * 0.1, d / 2 + 0.001)
		lamp.userData.frame = { hook: "matter:plateon", from: c.props.heat_from_s ?? 1, on: (c.props.heater_w ?? 300) > 0, lamp: true, scaled: false }
		return group(body, top, knob, lamp)
	})
	addFrameHook("matter:plateon", (obj, f, a) => {
		const on = a.on && f.t >= a.from && !(f.state?.dry >= 0.5 && f.state?.temp_c >= 340)
		const m = ownMaterial(obj)
		if (!m) return
		if (a.lamp) m.emissive?.set(on ? "#ff3b1f" : "#000000")
		else m.emissive?.set(new T.Color("#ff4a12").multiplyScalar(on ? 0.3 : 0))
	})
	addModel("evaporating-dish", "base", (c) => {
		// a clear borosilicate glass bowl (a spherical bowl 9 cm across, 3.5 cm deep, 3 mm thick) on a short foot ring, with a pouring lip
		const y0 = -c.h / 2
		const floor = y0 + c.h // (its inside's lowest point: the foot's top)
		const cy = floor + DISH_SPHERE
		const out = []
		const inn = []
		const th = Math.asin(DISH_RIM / DISH_SPHERE)
		for (let k = 0; k <= 16; k++) {
			const a = (th * k) / 16
			inn.push([DISH_SPHERE * Math.sin(a), cy - DISH_SPHERE * Math.cos(a)])
			out.push([(DISH_SPHERE + 0.003) * Math.sin(a), cy - (DISH_SPHERE + 0.003) * Math.cos(a)])
		}
		const prof = [[0, y0], [0.024, y0], [0.0245, y0 + 0.0008], ...out.filter(([r]) => r > 0.0245), [DISH_RIM + 0.004, cy - DISH_SPHERE * Math.cos(th) + 0.0015], ...inn.slice().reverse()]
		const bowl = mesh(kit.lathe(prof, 72, "evap-dish"), pane("#eef7f4", 0.22), { cast: false })
		const foot = at(mesh(kit.cylinderY(0.0245, c.h, 48), pane("#e6f2ee", 0.3), { cast: false }), 0, 0, 0)
		const lip = at(mesh(kit.box(0.012, 0.003, 0.01, 0.0012), pane("#eef7f4", 0.3), { cast: false }), DISH_RIM + 0.004, cy - DISH_SPHERE * Math.cos(th) + 0.0016, 0)
		// the water: a spherical cap up to its level (frame hook: a cached geometry per quarter millimetre), its flat top
		// (every geometry drawn here is of its real size, even before a hook scales it: the wide camera frames what the models' meshes span)
		const wat = group(mesh(kit.sphere(0.01, 8, 4), water("#a9d2ee", 0.5, 0.01), { cast: false }), mesh(kit.geo("evap-top", () => new T.CircleGeometry(0.01, 48).rotateX(-Math.PI / 2)), water("#a9d2ee", 0.5, 0.01), { cast: false }))
		wat.userData.frame = { hook: "matter:dishwater", floor, cy, scaled: false }
		// the crystals: white cubes on the bottom and a crust round where the water's edge was
		const N = 140
		const xt = new T.InstancedMesh(kit.box(0.0015, 0.0015, 0.0015, 0.0001, 1), M("salt-crystal", { color: (c.props.solute ?? "salt") === "sugar" ? "#fbf7ec" : "#ffffff", roughness: 0.25, metalness: 0, clearcoat: 0.6, emissive: "#1e1e1e" }), N)
		xt.castShadow = false
		xt.frustumCulled = false
		const water0 = (c.props.water_ml ?? 50) / 1e6
		let h0 = DISH_DEPTH / 2
		for (let i = 0; i < 20; i++) h0 -= ((Math.PI * h0 * h0 * (3 * DISH_SPHERE - h0)) / 3 - water0) / (Math.PI * (2 * DISH_SPHERE * h0 - h0 * h0))
		const r0 = Math.sqrt(Math.max(0, 2 * DISH_SPHERE * h0 - h0 * h0))
		xt.userData.frame = { hook: "matter:dishcrystals", floor, cy, r0, total: c.props.solute_g ?? 5, n: N, scaled: false }
		xt.count = 0
		// (before a run: the water as it starts)
		dishWater(wat, h0, floor, cy)
		// steam over it while it boils
		const steam = new T.InstancedMesh(kit.sphere(0.01, 12, 8), M("steam", { color: "#ffffff", roughness: 1, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false }), 14)
		steam.castShadow = false
		steam.frustumCulled = false
		steam.count = 0
		steam.userData.frame = { hook: "matter:steam", y: cy - DISH_SPHERE * Math.cos(th), scaled: false }
		return group(bowl, foot, lip, wat, xt, steam)
	})
	/** The dish's water drawn h m deep: a spherical cap (a cached geometry per quarter millimetre) and its flat top. */
	function dishWater(obj, h, floor, cy) {
		const hq = Math.round(h * 4000) / 4000
		obj.visible = hq > 0.0002
		if (!obj.visible) return
		const R = DISH_SPHERE - 0.0003
		const th = Math.acos(Math.min(1, Math.max(-1, (R - hq) / R)))
		const cap = obj.children[0]
		const top = obj.children[1]
		cap.geometry = kit.geo(`evap-cap|${hq}`, () => new T.SphereGeometry(R, 48, 10, 0, Math.PI * 2, Math.PI - th, th))
		cap.position.set(0, cy, 0)
		const r = Math.sqrt(Math.max(0, 2 * R * hq - hq * hq))
		top.scale.setScalar(Math.max(1e-5, r / 0.01))
		top.position.set(0, floor + 0.0003 + hq, 0)
	}
	addFrameHook("matter:dishwater", (obj, f, a) => {
		const h = Number.isFinite(f.state?.level_mm) ? f.state.level_mm / 1000 : null
		if (h !== null) dishWater(obj, h, a.floor, a.cy)
	})
	const xtM = new T.Matrix4()
	const xtQ = new T.Quaternion()
	const xtP = new T.Vector3()
	const xtS = new T.Vector3()
	addFrameHook("matter:dishcrystals", (obj, f, a) => {
		const g = Number.isFinite(f.state?.crystals_g) ? f.state.crystals_g : 0
		const n = a.total > 0 ? Math.min(a.n, Math.round((a.n * g) / a.total)) : 0
		obj.count = n
		for (let i = 0; i < n; i++) {
			// the first two-thirds a crust round the old water line, the rest scattered on the bottom (a fixed pattern)
			const ring = i % 3 !== 2
			const ang = i * 2.39996
			const r = ring ? a.r0 * (0.93 + 0.06 * (((i * 0.618) % 1) - 0.5)) : a.r0 * 0.8 * Math.sqrt(((i * 0.381966) % 1))
			const y = a.cy - Math.sqrt(Math.max(0, DISH_SPHERE * DISH_SPHERE - r * r)) + 0.0006
			// (salt crystals 1-3 mm: a crust of little cubes)
			const s = (0.0012 + 0.0018 * ((i * 0.7548) % 1)) / 0.0015
			xtP.set(r * Math.cos(ang), y, r * Math.sin(ang))
			xtQ.setFromAxisAngle(new T.Vector3(0.4, 1, 0.2).normalize(), i * 1.3)
			xtS.setScalar(s)
			xtM.compose(xtP, xtQ, xtS)
			obj.setMatrixAt(i, xtM)
		}
		obj.instanceMatrix.needsUpdate = true
	})
	addFrameHook("matter:steam", (obj, f, a) => {
		const on = f.state?.boiling >= 0.5
		const n = on ? 14 : 0
		obj.count = n
		for (let i = 0; i < n; i++) {
			const ph = ((f.t * 0.6 + i / n) % 1 + 1) % 1
			const ang = i * 2.39996
			const r = 0.02 * Math.sqrt((i * 0.381966) % 1)
			xtP.set(r * Math.cos(ang) + 0.01 * Math.sin(f.t * 1.7 + i), a.y + 0.005 + 0.09 * ph, r * Math.sin(ang))
			xtS.setScalar((0.006 + 0.016 * ph) / 0.01)
			xtQ.identity()
			xtM.compose(xtP, xtQ, xtS)
			obj.setMatrixAt(i, xtM)
		}
		obj.instanceMatrix.needsUpdate = true
	})
	for (const part of ["wall-left", "wall-right", "ballast"]) addModel("evaporating-dish", part, () => null)

	// ------------------------------------------------------------- density cubes
	const CUBE_MAT = {
		aluminium: () => kit.metal("#d4d8dd", { roughness: 0.32, key: "cube-al" }), brass: () => kit.metal("#c9a447", { roughness: 0.3, key: "cube-brass" }),
		copper: () => kit.metal("#c46a3c", { roughness: 0.3, key: "cube-cu" }), steel: () => kit.metal("#9aa1a8", { roughness: 0.35, key: "cube-steel" }),
		zinc: () => kit.metal("#b9bfc4", { roughness: 0.45, key: "cube-zn" }), oak: () => kit.wood("#b8854f"), pine: () => kit.wood("#e2c08a"),
		acrylic: () => M("cube-acrylic", { color: "#eaf6fb", roughness: 0.04, metalness: 0, transmission: 0.9, thickness: 0.025, ior: 1.49 }),
		nylon: () => plastic("#efe9dc", 0.3), PVC: () => plastic("#e9ecef", 0.4), polypropylene: () => plastic("#f2f0e6", 0.35), polyethylene: () => plastic("#f4f1e8", 0.25)
	}
	for (const type of ["density-cube", "equal-mass-block"])
		addModel(type, "block", (c) => mesh(kit.box(c.w, c.h, c.d, Math.min(0.0012, c.w * 0.05)), (CUBE_MAT[c.props.made_of] ?? CUBE_MAT.aluminium)()))

	// ------------------------------------------------------------- the run's particles, crystals and grains, pistons, spoons, balloons, labels
	const sphereGeo = (seg = 12) => kit.sphere(1, seg, Math.max(6, seg / 2))
	const cubeGeo = () => kit.box(1, 1, 1, 0.12, 1)
	const stoneGeo = () => kit.geo("mt-stone", () => {
		const g = new T.IcosahedronGeometry(1, 1)
		const p = g.attributes.position
		for (let i = 0; i < p.count; i++) {
			const k = 0.82 + 0.3 * (((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1)
			p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k)
		}
		g.computeVertexNormals()
		return g
	})
	const needleGeo = () => kit.box(1, 0.35, 0.35, 0.08, 1)
	const geoOf = (shape) => (shape === "cube" ? cubeGeo() : shape === "needle" ? needleGeo() : shape === "stone" ? stoneGeo() : sphereGeo(10))
	const tmp = new T.Matrix4()
	const quat = new T.Quaternion()
	const scl = new T.Vector3()
	const pos = new T.Vector3()
	const color = new T.Color()

	/** The series of an item at moment t: its list at the frame before and after, and the share between them. */
	function seriesAt(track, item, key, t) {
		const v = track?.series?.[item]?.[key]
		if (!Array.isArray(v) || !v.length) return null
		const i = Math.min(frameIndex(track, t), v.length - 1)
		const j = Math.min(i + 1, v.length - 1)
		const f = track.frames
		const span = (f[j]?.t ?? 0) - (f[i]?.t ?? 0)
		const u = span > 0 ? Math.min(1, Math.max(0, (t - f[i].t) / span)) : 0
		return { a: v[i], b: v[j], u }
	}
	const lerp = (a, b, u) => a + (b - a) * u

	addViewPlugin({
		name: "matter:particles",
		load(ctx) {
			const recs = (ctx.doc?.processes ?? []).filter((r) => r.kind === "matter")
			if (!recs.length) return null
			const track = ctx.track
			const parts = []
			const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "–")
			for (const r of recs) {
				const item = r.item
				const props = ctx.resolved?.[item] ?? {}
				if (r.role === "box") {
					// the model's particles: spheres of the record's radius, coloured by substance and side, in the box's plane; a solid's bonds as sticks
					const n = Math.round(r.count)
					const m = M(`particle|${r.substance}`, { color: "#ffffff", roughness: 0.35, metalness: 0, clearcoat: 0.5 })
					const inst = new T.InstancedMesh(sphereGeo(16), m, n)
					inst.castShadow = true
					const sticks = new T.InstancedMesh(kit.cylinderY(1, 1, 6), M("bond", { color: "#9aa3ab", roughness: 0.4, metalness: 0.3 }), Math.min(4 * n, 600))
					sticks.castShadow = false
					const base = new T.Color(SUBSTANCE_COLOR[r.substance] ?? "#3a7bd5")
					const other = new T.Color(r.second ? (SUBSTANCE_COLOR[r.second] ?? SECOND_COLOR) : SECOND_COLOR)
					const label = ctx.label({ text: "", height: 0.022 })
					label.sprite.position.set(r.origin.x, r.origin.y + r.height - 0.018, 0.03)
					// a piston (a plate on a rod, with its load) or a syringe's plunger, at the reading's height
					const isSyringe = props.push_to_ml !== undefined
					let piston = null
					if (r.piston) {
						const W = r.width
						piston = group(
							mesh(kit.box(W - 0.001, isSyringe ? 0.008 : 0.01, isSyringe ? W - 0.001 : 0.036, 0.002), isSyringe ? rubber() : M("piston", { color: "#b8bec5", roughness: 0.3, metalness: 1 })),
							at(mesh(kit.cylinderY(isSyringe ? 0.004 : 0.003, 0.16, 16), isSyringe ? plastic("#f4f4f2", 0.4) : steel()), 0, 0.085, 0),
							at(mesh(kit.box(isSyringe ? 0.045 : 0.03, 0.004, isSyringe ? 0.03 : 0.03, 0.0015), isSyringe ? plastic("#f4f4f2", 0.4) : steel()), 0, 0.165, 0)
						)
						if (!isSyringe && r.load > 0) {
							const discs = Math.max(1, Math.min(8, Math.round(r.load)))
							for (let k = 0; k < discs; k++) piston.add(at(mesh(kit.cylinderY(0.03, 0.009, 32), M("weight", { color: "#6f7378", roughness: 0.4, metalness: 1 })), 0, 0.172 + 0.0095 * k, 0))
						}
						ctx.group.add(piston)
					}
					// the divider: a clear sheet down the middle, lifted out at open_at_s
					let divider = null
					if (r.divider) {
						divider = mesh(kit.box(0.004, r.height, 0.036, 0.001), pane("#e6f2f8", 0.35), { cast: false })
						ctx.group.add(divider)
					}
					ctx.group.add(inst, sticks, label.sprite)
					parts.push({ kind: "box", r, inst, sticks, base, other, label, piston, divider, isSyringe, n })
				} else if (r.role === "glass") {
					const n = Math.round(r.specks)
					const [hex, shape] = SOLUTE_LOOK[r.solute] ?? SOLUTE_LOOK.salt
					// (opaque crystals: a transmissive water only shows opaque things through it)
					const m = M(`crystal|${r.solute}`, { color: hex, roughness: r.solute === "salt" || r.solute === "sugar" ? 0.22 : 0.8, metalness: 0, clearcoat: r.solute === "sand" ? 0 : 0.7, clearcoatRoughness: 0.1, emissive: r.solute === "sand" ? "#000000" : "#2a2a2a" })
					const inst = new T.InstancedMesh(geoOf(r.grain > 0.01 ? "cube" : shape), m, n)
					inst.castShadow = true
					const spoon = group(
						at(mesh(kit.box(0.006, 0.13, 0.002, 0.0008), steel()), 0, 0.065, 0),
						at(mesh(kit.sphere(0.011, 24, 12), steel()), 0, 0, 0)
					)
					spoon.children[1].scale.set(1, 0.35, 0.7)
					ctx.group.add(inst, spoon)
					const label = ctx.label({ text: "", height: 0.018 })
					ctx.group.add(label.sprite)
					parts.push({ kind: "glass", r, inst, spoon, label, n, props, cube: r.grain > 0.01 || shape === "cube" })
				} else if (r.role === "grains") {
					const comps = (r.components ?? []).map((c) => GRAIN_LOOK[c.key] ?? GRAIN_LOOK.sand)
					const kinds = comps.length * 3
					const insts = []
					for (let k = 0; k < kinds; k++) {
						const [size, spread, hex, shape] = comps[Math.floor(k / 3)]
						const radius = (size * (1 + (((k % 3) - 1) * spread) / 1.5)) / 2
						const m = M(`grain|${hex}|${shape}`, { color: hex, roughness: shape === "clip" || shape === "needle" ? 0.4 : 0.85, metalness: shape === "clip" || shape === "needle" ? 0.7 : 0 })
						const im = new T.InstancedMesh(geoOf(shape === "clip" ? "needle" : shape === "bean" || shape === "grain" ? "sphere" : shape), m, 6 * Math.round(r.grains))
						im.userData.radius = radius
						im.userData.shape = shape
						im.castShadow = true
						insts.push(im)
						ctx.group.add(im)
					}
					// the wand: a plastic rod with a nickel-plated magnet in its tip (drawn where its readings put it)
					let wand = null
					if (r.wand) {
						const rodLen = 0.16
						wand = group(
							at(mesh(kit.cylinderY(r.wand.rod ?? 0.008, rodLen, 24), plastic("#e53935", 0.6)), 0, (r.wand.length ?? 0.025) + rodLen / 2, 0),
							at(mesh(kit.cylinderY((r.wand.radius ?? 0.00635) + 0.0015, r.wand.length ?? 0.025, 32), M("wand-tip", { color: "#d9dde2", roughness: 0.18, metalness: 1 })), 0, (r.wand.length ?? 0.025) / 2, 0)
						)
						ctx.group.add(wand)
					}
					const sieve = null
					parts.push({ kind: "grains", r, insts, sieve, wand, comps })
				} else if (r.role === "balloon") {
					const floor = ctx.doc.solids.find((s) => s.item === item && s.part === "floor")
					const ball = mesh(kit.sphere(1, 48, 32), latex("#d6402f"))
					const knot = mesh(kit.cylinderY(0.004, 0.012, 12, 0.002), latex("#c23628"))
					const label = ctx.label({ text: "", height: 0.02 })
					ctx.group.add(ball, knot, label.sprite)
					parts.push({ kind: "balloon", r, ball, knot, label, floor })
				} else if (r.role === "ball") {
					// a stirrup pump beside the ball, its hose to the valve; its handle goes up and down while it pumps
					const sid = r.solid
					const body = group(
						mesh(kit.cylinderY(0.016, 0.3, 24), plastic("#2c6bd1", 0.6)),
						at(mesh(kit.box(0.09, 0.006, 0.04, 0.002), black()), 0, -0.15, 0)
					)
					const handle = group(at(mesh(kit.cylinderY(0.004, 0.16, 12), steel()), 0, 0.08, 0), at(mesh(kit.box(0.1, 0.014, 0.022, 0.006), black()), 0, 0.16, 0))
					// its hose: from the pump's foot round to the ball's valve (a needle in its side)
					const R0 = (ctx.doc.solids.find((s) => s.id === sid)?.body?.radius) ?? 0.11
					const b0 = ctx.doc.solids.find((s) => s.id === sid)?.at ?? { x: 0, y: 0 }
					const px = b0.x - R0 - 0.08
					const py = b0.y - R0
					const curve = new T.CatmullRomCurve3([new T.Vector3(px + 0.02, py + 0.02, -0.02), new T.Vector3(px + 0.05, py + 0.01, 0.03), new T.Vector3(b0.x - R0 * 0.9, b0.y - R0 * 0.2, 0.05), new T.Vector3(b0.x - R0 * 0.97, b0.y, 0.02)])
					const hose = mesh(new T.TubeGeometry(curve, 40, 0.003, 8, false), black())
					ctx.group.add(body, handle, hose)
					parts.push({ kind: "pump", r, sid, body, handle })
				} else if (r.role === "filter" || r.role === "evaporate") {
					const label = ctx.label({ text: "", height: 0.018 })
					ctx.group.add(label.sprite)
					parts.push({ kind: r.role, r, label })
				}
			}
			const frame = (t) => {
				for (const p of parts) {
					if (p.kind === "box") frameBox(p, t)
					else if (p.kind === "glass") frameGlass(p, t)
					else if (p.kind === "grains") frameGrains(p, t)
					else if (p.kind === "balloon") frameBalloon(p, t)
					else if (p.kind === "pump") framePump(p, t)
					else if (p.kind === "filter") frameFilter(p, t)
					else if (p.kind === "evaporate") frameDish(p, t)
				}
			}
			const lapse = () => (ctx.sim?.doc?.settings?.timeLapse ?? ctx.doc?.settings?.timeLapse ?? 1) > 1
			function frameFilter(p, t) {
				const { r } = p
				const st = ctx.readings(r.item, t)
				const sol = ctx.doc.solids.find((s) => s.id === `${r.item}/funnel`)
				const x = sol?.at?.x ?? 0
				const y = (sol?.at?.y ?? 0) + 0.135 + r.funnel / 2 / 0.5773502691896257
				p.label.set(`${fmt(st.filtrate_ml, 0)} mL through${(r.undissolvedMass ?? 0) > 0 ? ` · ${fmt(st.kept_g, 1)} g on the paper` : ""}${lapse() ? ` · ${clock(st.clock_s)}` : ""}`)
				p.label.sprite.position.set(x, y + 0.035, 0.05)
			}
			function frameDish(p, t) {
				const { r } = p
				const st = ctx.readings(r.item, t)
				const b = ctx.placementAt(r.solid, t)
				if (!b) return
				const water = Number.isFinite(st.water_g) ? st.water_g : 0
				const words = water > 0 ? `${fmt(water, 1)} g water · ${fmt(st.temp_c, 0)} °C${st.crystals_g > 0.005 ? ` · ${fmt(st.crystals_g, 1)} g crystals` : ""}` : `dry · ${fmt(st.crystals_g, 1)} g of crystals`
				p.label.set(`${words}${lapse() ? ` · ${longClock(st.clock_s)}` : ""}`)
				// (on its hot plate: on the plate's front, left of its knob; on its own: just over its rim)
				if (r.heat === "hot plate") p.label.sprite.position.set(b.x - 0.025, b.y - 0.05, 0.095)
				else p.label.sprite.position.set(b.x, b.y + 0.044, 0.07)
			}
			function longClock(s) {
				if (!Number.isFinite(s)) return ""
				if (s < 3600) return clock(s)
				if (s < 86400 * 2) return `${(s / 3600).toFixed(1)} h`
				return `${(s / 86400).toFixed(1)} days`
			}
			function frameBox(p, t) {
				const { r, inst, sticks } = p
				const s = seriesAt(track, r.item, "p", t)
				const k = seriesAt(track, r.item, "k", t)
				const n = p.n
				const xs = new Float64Array(n)
				const ys = new Float64Array(n)
				for (let i = 0; i < n; i++) {
					let x
					let y
					if (s) {
						x = lerp(s.a[2 * i], s.b[2 * i], s.u)
						y = lerp(s.a[2 * i + 1], s.b[2 * i + 1], s.u)
						// (a particle that crossed a wall between two frames is drawn where it ended: no streak through the wall)
						if (Math.abs(s.b[2 * i] - s.a[2 * i]) > r.width * 0.5) x = s.b[2 * i]
					} else {
						// (a layout preview, before a run: a still spread of the particles)
						const cols = Math.ceil(Math.sqrt(n))
						x = -r.width / 2 + r.radius + ((i % cols) + 0.5) * ((r.width - 2 * r.radius) / cols)
						y = r.radius + (Math.floor(i / cols) + 0.5) * ((r.height * (r.piston ? r.pistonAt : 1) - 2 * r.radius) / cols)
					}
					xs[i] = x
					ys[i] = y
					pos.set(r.origin.x + x, r.origin.y + y, 0)
					scl.setScalar(r.radius)
					tmp.compose(pos, quat, scl)
					inst.setMatrixAt(i, tmp)
					const code = k ? k.b[i] : 0
					const side = code >= 3 ? 1 : 0
					color.copy(side ? p.other : p.base)
					const phase = code % 3
					if (phase === 2) color.multiplyScalar(0.8)
					inst.setColorAt(i, color)
				}
				inst.instanceMatrix.needsUpdate = true
				if (inst.instanceColor) inst.instanceColor.needsUpdate = true
				// a solid's bonds: sticks between neighbouring solid particles
				let b = 0
				if (k) {
					const reach = 2.25 * r.radius
					for (let i = 0; i < n && b < sticks.count; i++) {
						if (k.b[i] % 3 !== 2) continue
						for (let j = i + 1; j < n && b < sticks.count; j++) {
							if (k.b[j] % 3 !== 2) continue
							const dx = xs[j] - xs[i]
							const dy = ys[j] - ys[i]
							const d = Math.hypot(dx, dy)
							if (d > reach || d === 0) continue
							pos.set(r.origin.x + (xs[i] + xs[j]) / 2, r.origin.y + (ys[i] + ys[j]) / 2, 0)
							quat.setFromAxisAngle(new T.Vector3(0, 0, 1), Math.atan2(dy, dx) - Math.PI / 2)
							scl.set(r.radius * 0.18, d, r.radius * 0.18)
							tmp.compose(pos, quat, scl)
							sticks.setMatrixAt(b++, tmp)
						}
					}
					quat.identity()
				}
				sticks.count = b
				sticks.instanceMatrix.needsUpdate = true
				const st = ctx.readings(r.item, t)
				if (p.piston) {
					const h = Number.isFinite(st.piston_m) ? st.piston_m : r.height * r.pistonAt
					p.piston.position.set(r.origin.x, r.origin.y + h + (p.isSyringe ? 0.004 : 0.005), 0)
				}
				if (p.divider) {
					const u = Math.min(1, Math.max(0, (t - r.openAt) / 0.4))
					p.divider.position.set(r.origin.x, r.origin.y + r.height / 2 + u * (r.height + 0.02), 0)
					p.divider.visible = u < 1
				}
				const words = p.isSyringe
					? `${fmt(st.volume_ml, 1)} mL · ${fmt(st.pressure_kpa, 0)} kPa`
					: `${fmt(st.temp_c, 1)} °C · ${st.solid_pct >= 99.5 ? "solid" : st.liquid_pct >= 99.5 ? "liquid" : st.gas_pct >= 99.5 ? "gas" : st.solid_pct > 0 ? "melting" : "boiling"}${st.gas_pct > 0 ? ` · ${fmt(st.pressure_kpa, 0)} kPa` : ""}${r.divider ? ` · ${fmt(st.mixed_pct, 0)} % mixed` : ""} · model`
				p.label.set(words)
				if (p.isSyringe) p.label.sprite.position.set(r.origin.x + 0.06, r.origin.y + r.height * 0.6, 0)
			}
			function frameGlass(p, t) {
				const { r, inst } = p
				const base = ctx.placementAt(r.solid, t)
				if (!base) return
				const s = seriesAt(track, r.item, "p", t)
				const ca = Math.cos(base.angle)
				const sa = Math.sin(base.angle)
				for (let i = 0; i < p.n; i++) {
					const g = (q) => (s ? lerp(s.a[4 * i + q], s.b[4 * i + q], s.u) : 0)
					const lx = g(0)
					const ly = g(1)
					const lz = g(2)
					const rr = s ? Math.min(s.a[4 * i + 3], s.b[4 * i + 3]) : 0
					pos.set(base.x + lx * ca - ly * sa, base.y + lx * sa + ly * ca, lz)
					// (a cube's side is the speck's diameter; a stone's radius its radius)
					scl.setScalar(rr > 0 ? (p.cube ? 1.6 * rr : rr) : 1e-6)
					quat.setFromAxisAngle(new T.Vector3(0.3, 1, 0.2).normalize(), i * 1.7)
					tmp.compose(pos, quat, scl)
					inst.setMatrixAt(i, tmp)
				}
				quat.identity()
				inst.instanceMatrix.needsUpdate = true
				// the spoon: going round the glass while it is stirred; held over the glass with the crystals before a spoon pour, then tipped
				const st = ctx.readings(r.item, t)
				const stirring = r.stir > 0 && t >= r.stirFrom && t < r.stirUntil
				const sp = p.spoon
				if (stirring) {
					const a = 2 * Math.PI * (st.stir_turns ?? 0)
					const lx = 0.6 * r.radius * Math.cos(a)
					const lz = 0.6 * r.radius * Math.sin(a)
					sp.visible = true
					sp.position.set(base.x + lx * ca - (r.floor + 0.012) * sa, base.y + lx * sa + (r.floor + 0.012) * ca, lz)
					sp.rotation.set(0, -a, 0.15)
				} else if (r.startIn === "spoon" && t < r.pourAt + 0.6) {
					const u = Math.min(1, Math.max(0, (t - (r.pourAt - 0.3)) / 0.5))
					sp.visible = true
					const y = r.height + 0.025
					sp.position.set(base.x - y * sa, base.y + y * ca, 0)
					sp.rotation.set(0, 0, Math.PI / 2 - 0.15 + u * 1.2)
				} else sp.visible = false
				const words = r.solubility > 0 ? `${fmt(st.dissolved_g, 1)} g dissolved · ${fmt(st.left_g, 1)} g left${st.saturated >= 0.5 ? " · saturated" : ""}` : `${fmt(st.left_g, 1)} g · does not dissolve`
				p.label.set(`${words}${(ctx.sim?.doc?.settings?.timeLapse ?? 1) > 1 ? ` · ${clock(st.clock_s)}` : ""}`)
				p.label.sprite.position.set(base.x, base.y + r.height - 0.012, 0.045)
			}
			function clock(s) {
				if (!Number.isFinite(s)) return ""
				const m = Math.floor(s / 60)
				const ss = Math.floor(s % 60)
				return `${m}:${String(ss).padStart(2, "0")} min`
			}
			function frameGrains(p, t) {
				const { r, insts } = p
				const floor = ctx.placementAt(r.solid, t)
				if (!floor) return
				const s = seriesAt(track, r.item, "p", t)
				const k = track?.series?.[r.item]?.k?.[0] ?? null
				const counts = insts.map(() => 0)
				const ca = Math.cos(floor.angle)
				const sa = Math.sin(floor.angle)
				const n = s ? s.a.length / 2 : 0
				const rim = r.aperture > 0 ? r.sieveHeight + 0.04 : r.wall
				const depth = r.aperture > 0 ? 0.14 : r.width * 0.85
				// the slice the model follows, drawn six deep across the container (the same grains at six depths, each a little shifted)
				for (let i = 0; i < n; i++) {
					const kind = k ? k[i] : 0
					const im = insts[kind]
					if (!im) continue
					const x = lerp(s.a[2 * i], s.b[2 * i], s.u)
					const y = lerp(s.a[2 * i + 1], s.b[2 * i + 1], s.u)
					// (a grain held up by a magnet, or above a dish's floor, is drawn near the middle plane: it hangs on the wand)
					const out = r.aperture === 0 && y > 0.012 ? 0.12 : 1
					const R = r.aperture > 0 ? 0.08 : r.width / 2
					for (let c = 0; c < 6; c++) {
						const h1 = Math.sin((i + 1) * 12.9898 + c * 78.233) * 43758.5453
						const jx = (h1 - Math.floor(h1) - 0.5) * 2 * im.userData.radius
						let z = ((c + 0.5) / 6 - 0.5) * depth * out
						// inside the round dish or sieve: no copy outside its circle
						const xr = x + (c === 2 ? 0 : jx)
						const room = Math.sqrt(Math.max(0, R * R - xr * xr)) - im.userData.radius
						if (Math.abs(z) > room) z = Math.sign(z) * Math.max(0, room)
						const lx = r.origin.x + xr
						const ly = r.origin.y + y
						pos.set(floor.x + lx * ca - ly * sa, floor.y + lx * sa + ly * ca, z)
						const rr = im.userData.radius
						if (im.userData.shape === "needle") {
							quat.setFromAxisAngle(new T.Vector3(0, 0, 1), (i * 0.7 + c) % Math.PI)
							scl.set(rr * 2.2, rr * 0.9, rr * 0.9)
						} else if (im.userData.shape === "bean" || im.userData.shape === "grain") {
							quat.setFromAxisAngle(new T.Vector3(0, 1, 0), i + c)
							scl.set(rr * 1.6, rr * 0.9, rr)
						} else {
							quat.setFromAxisAngle(new T.Vector3(0.3, 1, 0.5).normalize(), i * 1.3 + c)
							scl.setScalar(rr)
						}
						tmp.compose(pos, quat, scl)
						im.setMatrixAt(counts[kind]++, tmp)
					}
				}
				quat.identity()
				insts.forEach((im, j) => {
					im.count = counts[j]
					im.instanceMatrix.needsUpdate = true
				})
				if (p.wand) {
					const st = ctx.readings(r.item, t)
					const wx = Number.isFinite(st.wand_x) ? st.wand_x : -r.width / 2
					const wy = Number.isFinite(st.wand_y) ? st.wand_y : r.wand.lift ?? 0.085
					const lx = r.origin.x + wx
					const ly = r.origin.y + wy
					p.wand.position.set(floor.x + lx * ca - ly * sa, floor.y + lx * sa + ly * ca, 0)
				}
			}
			function frameBalloon(p, t) {
				const st = ctx.readings(p.r.item, t)
				const d = Number.isFinite(st.diameter_cm) ? st.diameter_cm / 100 : 0.124
				const fl = p.floor
				const x = fl?.at?.x ?? 0
				const y = (fl?.at?.y ?? 0) + 0.002 + 0.072
				p.ball.scale.set(d / 2, (d / 2) * 1.12, d / 2)
				p.ball.position.set(x, y, 0)
				p.knot.position.set(x, y - (d / 2) * 1.12 - 0.004, 0)
				p.label.set(`${fmt(st.volume_l, 3)} L · air ${fmt(st.temp_c, 1)} °C`)
				p.label.sprite.position.set(x, y + 0.12, 0.13)
			}
			function framePump(p, t) {
				const b = ctx.placementAt(p.sid, t)
				if (!b) return
				const R = (ctx.doc.solids.find((s) => s.id === p.sid)?.body?.radius) ?? 0.11
				const x = b.x - R - 0.08
				const y0 = b.y - R
				p.body.position.set(x, y0 + 0.15 + 0.006, -0.02)
				const pumping = t >= p.r.pumpAt && t < p.r.pumpAt + p.r.pumpFor
				const u = pumping ? 0.5 - 0.5 * Math.cos(2 * Math.PI * 1.5 * (t - p.r.pumpAt)) : 0
				p.handle.position.set(x, y0 + 0.31 + 0.12 * u, -0.02)
			}
			const dispose = () => {
				for (const p of parts) p.label?.dispose?.()
			}
			return { frame, dispose }
		}
	})

	// ------------------------------------------------------------- chemical changes: packs, steel wool, the red cabbage and precipitate beakers
	const pouchMat = (hex, rough = 0.45, coat = 0.3) => M(`pouch|${hex}|${rough}|${coat}`, { color: hex, roughness: rough, metalness: 0, clearcoat: coat, clearcoatRoughness: 0.35 })
	const band = (w, h, d, hex, y) => at(mesh(kit.box(w, Math.max(0.0006, h * 0.08), d, 0.0003), pouchMat(hex, 0.35, 0.5), { cast: false }), 0, y, 0)
	addModel("cold-pack", "pouch", (c) => {
		// a soft white pouch, its edges rounded right off; a printed band across it (blue on a cold pack, orange on a hot one)
		const { w, h, d } = c
		const hot = c.props.chemical === "calcium chloride"
		const body = mesh(kit.box(w, h, d, Math.min(h * 0.48, 0.012), 5), pouchMat("#f4f6f8", 0.42, 0.45))
		body.userData.frame = { hook: "matter:frost", scaled: false }
		const stripe = at(mesh(kit.box(w * 0.36, h * 0.3, d * 0.92, Math.min(h * 0.14, 0.004)), pouchMat(hot ? "#e8742a" : "#2f74c9", 0.38, 0.5), { cast: false }), 0, h * 0.36, 0)
		const seam = at(mesh(kit.box(w * 0.02, h * 0.7, d * 0.96, 0.0004), pouchMat("#e4e8ec", 0.5)), w / 2 - w * 0.03, 0, 0)
		return group(body, stripe, seam)
	})
	addFrameHook("matter:frost", (obj, f) => {
		// cold, it frosts over a little (the dew the heat module condenses on it, then rime): a paler, wetter, bluer white
		const tc = f.state?.temp_c
		const m = ownMaterial(obj)
		if (!m || !Number.isFinite(tc)) return
		const k = Math.max(0, Math.min(1, (10 - tc) / 10))
		m.color.set("#f4f6f8").lerp(new T.Color("#e3eef8"), k)
		m.clearcoat = 0.45 + 0.5 * k
	})
	addModel("hand-warmer", "pouch", (c) => {
		// a non-woven fabric pouch (beige, a fine quilted grid) with the iron powder's lumps showing through
		const { w, h, d } = c
		const body = mesh(kit.box(w, h, d, Math.min(h * 0.48, 0.008), 5), M("warmer-fabric", { color: "#d8ccb3", roughness: 0.92, metalness: 0, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new T.Color("#fff6e4") }))
		const parts = [body]
		const quilt = M("warmer-quilt", { color: "#c4b697", roughness: 0.95, metalness: 0 })
		for (let k = 1; k < 4; k++) parts.push(at(mesh(kit.box(w * 0.006, h * 1.01, d * 0.9, 0.0002), quilt, { cast: false }), -w / 2 + (w * k) / 4, 0, 0))
		parts.push(band(w * 0.5, h, d * 0.5, "#d9452b", h * 0.47))
		return group(...parts)
	})
	for (const part of ["ballast"]) {
		addModel("hand-warmer", part, () => null)
		addModel("steel-wool", part, () => null)
		addModel("indicator-cup", part, () => null)
		addModel("reaction-cup", part, () => null)
	}
	addModel("steel-wool", "pad", (c) => {
		// a loose pad of fine steel fibres: a lumpy blob filling the pad's outline, many fine strands over it; it rusts orange-brown (frame hook)
		const { w, h, d } = c
		const blob = kit.geo("mt-wool", () => {
			const g = new T.IcosahedronGeometry(1, 5)
			const p = g.attributes.position
			for (let i = 0; i < p.count; i++) {
				const x = p.getX(i)
				const y = p.getY(i)
				const z = p.getZ(i)
				const n = 0.86 + 0.08 * Math.sin(x * 23.1 + y * 7.3) * Math.cos(z * 19.7 - x * 5.1) + 0.05 * Math.sin((x + y + z) * 41.3)
				p.setXYZ(i, x * n, y * n, z * n)
			}
			g.computeVertexNormals()
			return g
		})
		const wool = M("steel-wool", { color: "#a9adb2", roughness: 0.62, metalness: 0.85 })
		const pad = mesh(blob, wool)
		pad.scale.set(w / 2, h / 2, d / 2)
		pad.userData.frame = { hook: "matter:rust", scaled: false }
		const strands = new T.InstancedMesh(kit.torus(1, 0.012, 4, 24), M("steel-strand", { color: "#b4b8bd", roughness: 0.4, metalness: 0.9 }), 60)
		const mm = new T.Matrix4()
		const q = new T.Quaternion()
		const e = new T.Euler()
		for (let i = 0; i < 60; i++) {
			const u = (i * 0.6180339887) % 1
			const v = (i * 0.7548776662) % 1
			e.set(u * 6.283, v * 6.283, (u + v) * 3.14)
			q.setFromEuler(e)
			const r = 0.006 + 0.006 * ((i * 0.381966) % 1)
			mm.compose(new T.Vector3((u - 0.5) * w * 0.8, (v - 0.5) * h * 0.6, (((i * 0.2) % 1) - 0.5) * d * 0.8), q, new T.Vector3(r, r, r))
			strands.setMatrixAt(i, mm)
		}
		strands.userData.frame = { hook: "matter:rust", scaled: false }
		return group(pad, strands)
	})
	addFrameHook("matter:rust", (obj, f) => {
		const r = f.state?.rust_pct
		const m = ownMaterial(obj)
		if (!m) return
		const k = Number.isFinite(r) ? Math.max(0, Math.min(1, r / 25)) : 0
		m.color.set(obj.isInstancedMesh ? "#b4b8bd" : "#a9adb2").lerp(new T.Color("#9a4a1e"), k)
		m.metalness = 0.85 - 0.7 * k
		m.roughness = 0.62 + 0.3 * k
	})

	// the 250 mL beaker both cups stand in (machines/mod_matter.py BEAKER_*): its glass, its liquid (frame hooks colour it), bubbles
	const B_R = 0.033
	const B_T = 0.002
	const B_B = 0.004
	const B_H = 0.095
	const beakerGlass = () => {
		const y0 = -B_B / 2
		const R = B_R + B_T
		const prof = [[0, y0], [R - 0.0015, y0], [R, y0 + 0.0015], [R, y0 + B_B + B_H - 0.002], [R + 0.0016, y0 + B_B + B_H - 0.0005], [R - 0.0002, y0 + B_B + B_H], [B_R, y0 + B_B + B_H - 0.002],
			[B_R, y0 + B_B + 0.001], [B_R - 0.0015, y0 + B_B], [0, y0 + B_B]]
		const glass = mesh(kit.lathe(prof, 64, "beaker-chem"), pane("#eef7f4", 0.2), { cast: false })
		const marks = M("beaker-marks", { color: "#ffffff", roughness: 0.6, metalness: 0, transparent: true, opacity: 0.85 })
		const parts = [glass]
		for (let ml = 50; ml <= 200; ml += 50) parts.push(at(mesh(kit.box(0.012, 0.0008, 0.0004, 0.0001), marks, { cast: false }), 0, B_B / 2 + ml / 1e6 / (Math.PI * B_R * B_R), R + 0.0002))
		return parts
	}
	const depthOf = (ml) => Math.min(B_H - 0.01, (ml ?? 100) / 1e6 / (Math.PI * B_R * B_R))
	const bubbles = (depth) => {
		const bub = new T.InstancedMesh(kit.sphere(0.0013, 10, 6), M("bubble", { color: "#ffffff", roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false }), 40)
		bub.userData.frame = { hook: "matter:bubbles", y0: B_B / 2, y1: B_B / 2 + depth, r: B_R - 0.004, scaled: false }
		bub.castShadow = false
		return bub
	}
	// red cabbage's colours by pH (approximate, as widely published: red, pink, purple, blue, blue-green, green, yellow)
	const CABBAGE = [[1, "#d11a3a"], [2.5, "#e23358"], [4, "#ec5f9c"], [5.5, "#b45cc2"], [7, "#7e55c9"], [8.3, "#4f6ee0"], [9.5, "#2f93e0"], [10.5, "#22b8a4"], [11.5, "#4cc25a"], [12.5, "#a6d24a"], [13.5, "#f0dc45"]]
	const cabbage = (ph, out) => {
		const p = Number.isFinite(ph) ? ph : 7
		let k = 1
		while (k < CABBAGE.length - 1 && p > CABBAGE[k][0]) k++
		const [p0, c0] = CABBAGE[k - 1]
		const [p1, c1] = CABBAGE[k]
		const u = Math.max(0, Math.min(1, (p - p0) / (p1 - p0)))
		return out.set(c0).lerp(new T.Color(c1), u)
	}
	addModel("indicator-cup", "base", (c) => {
		const depth = depthOf(c.props.water_ml)
		const juice = M("cabbage-juice", { color: "#f4f0fb", roughness: 0.04, metalness: 0, transmission: 1, thickness: 0.04, ior: 1.333, attenuationColor: new T.Color("#7a4fc0"), attenuationDistance: 0.045, specularIntensity: 1 })
		const liquid = at(mesh(kit.cylinderY(B_R - 0.0005, depth, 64), juice, { cast: false }), 0, B_B / 2 + depth / 2, 0)
		liquid.userData.frame = { hook: "matter:cabbage", scaled: false }
		return group(...beakerGlass(), liquid, bubbles(depth))
	})
	const tint = new T.Color()
	addFrameHook("matter:cabbage", (obj, f) => {
		const m = ownMaterial(obj)
		if (!m) return
		cabbage(f.state?.ph, tint)
		m.attenuationColor?.copy(tint)
		m.color.copy(tint).lerp(new T.Color("#ffffff"), 0.55)
	})
	addModel("reaction-cup", "base", (c) => {
		const depth = depthOf(c.props.water_ml)
		const liquid = at(mesh(kit.cylinderY(B_R - 0.0005, depth, 64), water("#cfe5f2", 1.2, 0.03), { cast: false }), 0, B_B / 2 + depth / 2, 0)
		liquid.userData.frame = { hook: "matter:clearwater", scaled: false }
		// the white solid: a milky cloud through the liquid while it is suspended (frame hook: its opacity; the clear water's transmission would hide
		// it, so the cloud stands in for the liquid while it is cloudy), and a layer settled on the bottom
		const cloud = at(mesh(kit.cylinderY(B_R - 0.0012, depth * 0.98, 48), M("chalk-cloud", { color: "#f7f6f2", roughness: 0.9, metalness: 0, transparent: true, opacity: 0, depthWrite: false }), { cast: false }), 0, B_B / 2 + depth / 2, 0)
		cloud.userData.frame = { hook: "matter:cloud", scaled: false }
		const layer = at(mesh(kit.cylinderY(B_R - 0.0008, 1, 48), M("chalk-layer", { color: "#f4f2ec", roughness: 0.95, metalness: 0 })), 0, 0, 0)
		layer.userData.frame = { hook: "matter:settled", y: B_B / 2, area: Math.PI * (B_R - 0.0008) * (B_R - 0.0008), scaled: false }
		layer.visible = false
		return group(...beakerGlass(), liquid, cloud, layer, bubbles(depth))
	})
	addFrameHook("matter:cloud", (obj, f) => {
		const m = ownMaterial(obj)
		const k = Number.isFinite(f.state?.cloudy) ? f.state.cloudy : 0
		obj.visible = k > 0.03
		if (m) m.opacity = 0.3 + 0.62 * k
	})
	addFrameHook("matter:clearwater", (obj, f) => {
		const k = Number.isFinite(f.state?.cloudy) ? f.state.cloudy : 0
		obj.visible = k <= 0.03
	})
	addFrameHook("matter:settled", (obj, f, a) => {
		// (loose chalk sediment about 0.6 g/cm³)
		const g = Number.isFinite(f.state?.settled_g) ? f.state.settled_g : 0
		const h = g / 0.6 / 1e6 / a.area
		obj.visible = h > 0.0001
		obj.scale.y = Math.max(1e-5, h)
		obj.position.y = a.y + h / 2
	})
	for (const type of ["indicator-cup", "reaction-cup"]) {
		for (const part of ["wall-left", "wall-right", "water"]) addModel(type, part, () => null)
		for (const k of [1, 2]) {
			addModel(type, `cup${k}`, (c) => {
				// a little paper cup of what is poured in: lifted over the beaker and tipped at its time (matter:pour)
				const cup = mesh(kit.lathe([[0, -0.015], [0.0115, -0.015], [0.015, 0.015], [0.0145, 0.015], [0.011, -0.014], [0, -0.014]], 32, "paper-cup-30"), paperMat())
				const what = type === "reaction-cup" ? "calcium chloride" : k === 1 ? c.props.add : c.props.then_add
				const liquid = what === "vinegar" || what === "lemon juice"
				const fill = liquid
					? at(mesh(kit.cylinderY(0.0128, 0.016, 24, 0.0138), M(`cup-liquid|${what}`, { color: what === "vinegar" ? "#efe6c4" : "#f5ec9a", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85 }), { cast: false }), 0, -0.004, 0)
					: at(mesh(kit.sphere(0.0095, 20, 10), M("heap", { color: "#f4f4f1", roughness: 0.9 })), 0, -0.007, 0)
				if (!liquid) fill.scale.set(1, 0.45, 1)
				const pourAt = type === "reaction-cup" ? (c.props.mix_at_s ?? 1.2) : k === 1 ? (c.props.add_at_s ?? 1.2) : (c.props.then_at_s ?? 4)
				const g = group(cup, fill)
				g.userData.frame = { hook: "matter:pour", pourAt, dx: -(B_R + B_T + 0.02 + 0.035 * (k - 1)), scaled: false }
				return g
			})
		}
	}

	// ------------------------------------------------------------- molecule and crystal models: the whole model on its root atom (the others draw nothing)
	const ELEMENT_LOOK = { H: "#f2f2f2", C: "#2d2d2d", N: "#3a5fd9", O: "#e0312b", Na: "#9b5fd4", Cl: "#3fbf4f" }
	const atomMat = (el) => M(`atom|${el}`, { color: ELEMENT_LOOK[el] ?? "#cccccc", roughness: el === "C" ? 0.35 : 0.28, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.12 })
	const stickMat = () => M("atom-stick", { color: "#c9ccd0", roughness: 0.3, metalness: 0.15, clearcoat: 0.6 })
	const hbondMat = () => M("atom-hbond", { color: "#9fc3e6", roughness: 0.5, metalness: 0, transparent: true, opacity: 0.8 })
	const yAxis = new T.Vector3(0, 1, 0)
	const buildAtoms = (type, c) => {
		const model = atomModel(type, c.props)
		if (!model) return null
		const A = model.atoms
		const [, x0, y0] = A[model.root]
		const scale = (Number.isFinite(c.props.scale_cm) ? c.props.scale_cm : type === "molecule" ? 2.5 : 1.2) / 100
		const filling = c.props.style === "space-filling"
		const parts = []
		// atoms, one instanced mesh per element and size
		const groups = new Map()
		A.forEach(([el, x, y, z, r], i) => {
			const key = `${el}|${r.toFixed(5)}`
			if (!groups.has(key)) groups.set(key, { el, r, list: [] })
			groups.get(key).list.push([x - x0, y - y0, z])
		})
		const mm = new T.Matrix4()
		const v = new T.Vector3()
		const q = new T.Quaternion()
		const s = new T.Vector3()
		for (const { el, r, list } of groups.values()) {
			const im = new T.InstancedMesh(kit.sphere(1, A.length > 60 ? 20 : 36, A.length > 60 ? 12 : 20), atomMat(el), list.length)
			list.forEach(([x, y, z], k) => {
				mm.compose(v.set(x, y, z), q.identity(), s.set(r, r, r))
				im.setMatrixAt(k, mm)
			})
			im.castShadow = true
			parts.push(im)
		}
		// bonds: sticks (a double bond two, a triple three, side by side); hydrogen bonds dotted
		if (!filling) {
			const sticks = []
			const dots = []
			const rs = 0.12 * scale // (a stick 0.12 Å thick, at the model's scale)
			for (const [i, j, order] of model.bonds) {
				const a = A[i]
				const b = A[j]
				const pa = new T.Vector3(a[1] - x0, a[2] - y0, a[3])
				const pb = new T.Vector3(b[1] - x0, b[2] - y0, b[3])
				if (order === 0) {
					const n = 4
					for (let k = 1; k <= n; k++) dots.push(pa.clone().lerp(pb, k / (n + 1)))
					continue
				}
				const dir = pb.clone().sub(pa)
				const len = dir.length()
				const side = new T.Vector3(-dir.y, dir.x, 0)
				if (side.lengthSq() < 1e-12) side.set(1, 0, 0)
				side.normalize().multiplyScalar(rs * 1.6)
				const offs = order === 2 ? [-0.5, 0.5] : order === 3 ? [-1, 0, 1] : [0]
				for (const o of offs) sticks.push({ mid: pa.clone().add(pb).multiplyScalar(0.5).addScaledVector(side, o), dir: dir.clone().normalize(), len, r: order > 1 ? rs * 0.75 : rs })
			}
			if (sticks.length) {
				const im = new T.InstancedMesh(kit.cylinderY(1, 1, 12), stickMat(), sticks.length)
				sticks.forEach((st, k) => {
					q.setFromUnitVectors(yAxis, st.dir)
					mm.compose(st.mid, q, s.set(st.r, st.len, st.r))
					im.setMatrixAt(k, mm)
				})
				parts.push(im)
			}
			if (dots.length) {
				const im = new T.InstancedMesh(kit.sphere(1, 8, 6), hbondMat(), dots.length)
				dots.forEach((p, k) => {
					mm.compose(p, q.identity(), s.set(rs * 0.7, rs * 0.7, rs * 0.7))
					im.setMatrixAt(k, mm)
				})
				im.castShadow = false
				parts.push(im)
			}
		}
		return group(...parts)
	}
	for (const type of ["molecule", "crystal"]) addModel(type, "*", (c) => (c.solid.part === "a1" ? buildAtoms(type, c) : null))
	addViewPlugin({
		name: "matter:atomlabels",
		load(ctx) {
			const recs = (ctx.doc?.processes ?? []).filter((r) => r.kind === "matter" && r.role === "atoms")
			if (!recs.length) return null
			const shown = []
			for (const r of recs) {
				const props = ctx.resolved?.[r.item] ?? {}
				if (props.labels === false) continue
				const type = props.molecule !== undefined ? "molecule" : "crystal"
				const model = atomModel(type, props)
				if (!model) continue
				const rootId = `${r.item}/a1`
				const [, x0, y0] = model.atoms[model.root]
				let top = -Infinity
				for (const a of model.atoms) top = Math.max(top, a[2] + a[4] - y0)
				const words = type === "molecule" ? `${props.formula ?? ""}  ${props.molecule ?? ""} (a model)` : `${props.formula ?? ""}  ${props.lattice ?? ""} crystal (a model): ${r.atoms} atoms`
				const title = ctx.label({ text: words.trim(), height: 0.018 })
				const letters = []
				ctx.group.add(title.sprite)
				for (const { l } of letters) ctx.group.add(l.sprite)
				shown.push({ rootId, x0, y0, top, title, letters })
			}
			if (!shown.length) return null
			return {
				frame(t) {
					for (const p of shown) {
						const b = ctx.placementAt(p.rootId, t)
						if (!b) continue
						const ca = Math.cos(b.angle)
						const sa = Math.sin(b.angle)
						p.title.sprite.position.set(b.x, b.y + p.top + 0.025, 0.05)
						for (const { a, l } of p.letters) {
							const lx = a[1] - p.x0
							const ly = a[2] - p.y0
							l.sprite.position.set(b.x + lx * ca - ly * sa, b.y + lx * sa + ly * ca, a[3] + a[4] + 0.004)
						}
					}
				},
				dispose() {
					for (const p of shown) {
						p.title.dispose?.()
						for (const { l } of p.letters) l.dispose?.()
					}
				}
			}
		}
	})
}
