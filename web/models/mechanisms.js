// 3D models for the mechanisms catalog group (see web/models3d.js for the frame and the kit; helpers in mechanisms-lib.js).
// Every model fills its part's physics outline (x-y, the side view) and stays inside its depth; the small hardware on top
// (screws, eyes, grommets, rivets) stays within ~2 mm of it, and the few eyes, hooks and hinge barrels that carry a rope, spring or
// gate reach a little further into free air. The springs, ropes, pulley wheels and hinge pins are drawn by the view.
//   mechanisms-parts.js    the mounting beam, spring seats, screws, the hooked lab mass
//   mechanisms-springs.js  spring launcher, bounce pad, spring bumper, spring gate, spring catapult
//   mechanisms-tramp.js    trampoline (end frames and mat)
//   mechanisms-ropes.js    rope pendulum, wrecking ball, swing, hanging chain
//   mechanisms-pulleys.js  Atwood machine, pulley lift (the aluminium pail and its bail)
//   (here)                 hanging spring, motor spinner
// A bob's eye is drawn when the physics solid carries `eye` (the catalog turns the ball along the rope and ties the rope to the eye); the pail of the pulley lift is round,
// its wire bail seven welded pieces; the trampoline's end frames are tube frames with a hook for every spring row (render.rows).
// Nothing here bakes a texture whose key holds a size or a value (the sliders drag through hundreds of them and nothing evicts a texture): the trampoline mat is one tileable
// fabric tile, one tileable hem and one centre decal; the lab masses' numerals come from one glyph atlas; a long thin hanging chain is drawn as ribbons on one tile.
import { makeLib } from "./mechanisms-lib.js"
import { makeParts } from "./mechanisms-parts.js"
import pulleys from "./mechanisms-pulleys.js"
import tramp from "./mechanisms-tramp.js"
import ropes from "./mechanisms-ropes.js"
import springs from "./mechanisms-springs.js"

export default function register({ addModel, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const P = makeParts(kit, THREE, L)
	const T = THREE
	const { f5, put, faces } = L
	const { mesh, group, HALF, sideOf, seedOf, beam, screwEye, seat, screwOn, hookedMass, grams } = P
	const safe = (name, fn) => {
		try {
			fn({ addModel, kit, THREE, L, P })
		} catch (e) {
			console.warn(`mechanisms (${name}) failed to register:`, e)
		}
	}
	safe("pulleys", pulleys)
	safe("trampoline", tramp)
	safe("ropes", ropes)
	safe("springs", springs)

	// ============================================================== hanging spring
	addModel("hanging-spring", "hanger", (ctx) => beam(ctx, { eyes: [0] }))
	addModel("hanging-spring", "weight", (ctx) => hookedMass(ctx, grams(ctx.props.weight)))

	// ============================================================== motor spinner
	// a hazard-striped tip: diagonal black and yellow paint with the wood grain showing through it
	const hazardPaint = () => {
		const map = kit.tex("spinnerHazard2", 256, 256, (g, W, H) => {
			g.clearRect(0, 0, W, H)
			for (let k = -2; k < 3; k++) {
				g.fillStyle = "rgba(247,190,18,0.86)"
				g.beginPath()
				g.moveTo(k * W, 0); g.lineTo(k * W + W / 2, 0); g.lineTo(k * W + W / 2 - H, H); g.lineTo(k * W - H, H)
				g.fill()
				g.fillStyle = "rgba(20,21,24,0.93)"
				g.beginPath()
				g.moveTo(k * W + W / 2, 0); g.lineTo(k * W + W, 0); g.lineTo(k * W + W - H, H); g.lineTo(k * W + W / 2 - H, H)
				g.fill()
			}
		})
		return L.MAT("spinnerHazardMat", { map, transparent: true, roughness: 0.42, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
	}
	addModel("motor-spinner", "paddle", (ctx) => {
		const { w, h, d } = ctx
		const sk = L.skin(ctx)
		const out = []
		if (sk.kind === "metal") {
			// a bare metal blade with black safety bands painted round each end
			out.push(mesh(L.rbox(w, h, d, Math.min(0.003, h * 0.3), { grain: 0, seed: 21 }), sk.main))
			const black = L.paint("#1c1d20", 0.5)
			for (const sx of [-1, 1]) for (const [a, b] of [[0.03, 0.075], [0.105, 0.15]]) {
				const bw = (b - a) * w
				out.push(put(mesh(L.rbox(bw, h + 0.0006, d + 0.0006, 0.0005), black), sx * (w / 2 - ((a + b) / 2) * w), 0, 0))
			}
		} else {
			// a varnished blade, grain along its length, hazard stripes painted over the wood at each tip
			out.push(mesh(L.rbox(w, h, d, Math.min(0.003, h * 0.3), { grain: 0, seed: 21 }), faces(sk.side, sk.end, 0)))
			const bl = Math.min(0.13 * w, 0.06)
			const eps = 0.0002
			const band = L.rbox(bl, h + 2 * eps, d + 2 * eps, Math.min(0.003, h * 0.3), { grain: 0, tu: 0.04, tv: 0.04, te: 0.04, seed: 4 })
			for (const sx of [-1, 1]) out.push(put(mesh(band, hazardPaint(), { cast: false }), sx * (w / 2 - bl / 2 - 0.0004), 0, 0))
		}
		// the hub: a steel plate let into each face (flush: 0.2 mm proud, so the paddle stays within its depth) with four countersunk cap screws and a set screw flush on its rim
		// (the shaft passes through its middle). A fixed spinner (a static paddle: a plank on its own stand, no motor or shaft) has none
		const hubR = Math.min(0.0095, h / 2 - 0.0004)
		for (const sz of ctx.solid.kind === "static" ? [] : [-1, 1]) {
			const hub = kit.lathe([[0.0042, 0], [hubR - 0.0005, 0], [hubR, 0.0003], [hubR, 0.0008], [hubR - 0.0004, 0.0011], [0.0052, 0.0011], [0.0052, 0.0008], [0.0042, 0.0008]], 40, `spinnerHub2|${f5(hubR)}`).clone().rotateX(HALF)
			out.push(put(mesh(hub, L.steel("#aab0b6")), 0, 0, sz * (d / 2 - 0.0009)).rotateY(sz < 0 ? Math.PI : 0))
			for (let k = 0; k < 4; k++) {
				const a = (k * HALF) + 0.78
				out.push(screwOn(0.0071 * Math.cos(a), 0.0071 * Math.sin(a) * (hubR < 0.007 ? 0.5 : 1), sz * (d / 2 + 0.0002), 0.0011, sz > 0 ? "+z" : "-z", k, true))
			}
			out.push(put(mesh(kit.cylinderY(0.0012, 0.0016, 10), L.darkSteel()), hubR + 0.0004, 0, sz * (d / 2 - 0.0013)).rotateZ(-HALF))
		}
		return group(out)
	})
	// the gear motor the paddle is keyed on (the catalog's "hub": the motor's shaft, a static 6 mm ball inside the paddle that carries the driven hinge). Its
	// depth (depth3d) reaches from the motor's back, MOTOR_BACK (66 mm) behind the paddle's back face, as far in front of the paddle, so the view's retort stand
	// puts its arm into the motor's back. Drawn from the front: a domed cap nut and washer on the shaft's end (round, so it looks the same however the shaft
	// turns), and behind the paddle the shaft's coupling, a 32 mm gearbox with two mounting screws, the 31 mm motor can and its black end cap with two solder tabs.
	// The motor stands out of the paddle's outline (16 mm round a 20 mm paddle) only behind its back face, where nothing moves.
	addModel("motor-spinner", "hub", (ctx) => {
		const D = ctx.props.depth ?? 0.1
		const zf = D / 2 + 0.0002 // the paddle's front face (its hub plate stands 0.2 mm proud)
		const zb = -D / 2 - 0.0002 // its back face
		const out = []
		const nut = kit.latheZ([[0, 0], [0.0075, 0], [0.0075, 0.0008], [0.0052, 0.0009], [0.0052, 0.0032], [0.0044, 0.0043], [0.0026, 0.005], [0, 0.0052]], 40, "spinMotorNut")
		out.push(put(mesh(nut, L.steel("#c3c8cd")), 0, 0, zf))
		// behind the paddle, from the back face going back: the shaft and its flanged coupling, the gearbox, the can, the end cap
		const z0 = zb - 0.006 // the gearbox's front face
		const coupling = kit.latheZ([[0, -0.006], [0.009, -0.006], [0.009, -0.0047], [0.0066, -0.0042], [0.0066, -0.0016], [0.004, -0.0013], [0.004, 0], [0, 0]], 40, "spinMotorCoupling")
		out.push(put(mesh(coupling, L.steel("#b4bac0")), 0, 0, zb))
		const gear = kit.latheZ([[0, -0.022], [0.0155, -0.022], [0.016, -0.0215], [0.016, -0.0006], [0.0154, 0], [0.0062, 0], [0.0062, 0.0008], [0, 0.0008]], 48, "spinMotorGear")
		out.push(put(mesh(gear, L.zinc()), 0, 0, z0))
		for (const sx of [-1, 1]) out.push(screwOn(sx * 0.0112, 0, z0 + 0.0001, 0.0016, "+z", sx, true))
		const can = kit.latheZ([[0, -0.032], [0.0148, -0.032], [0.0155, -0.0313], [0.0155, -0.0007], [0.0148, 0], [0, 0]], 48, "spinMotorCan")
		out.push(put(mesh(can, L.steel("#aeb3b8")), 0, 0, z0 - 0.022))
		const cap = kit.latheZ([[0, -0.006], [0.0128, -0.006], [0.0138, -0.0048], [0.0138, 0], [0, 0]], 40, "spinMotorCap")
		const zc = z0 - 0.054
		out.push(put(mesh(cap, L.plasticMat("#1d1e21")), 0, 0, zc))
		for (const sx of [-1, 1]) out.push(put(mesh(L.rbox(0.0024, 0.0006, 0.004, 0.0002), L.brass()), sx * 0.0075, 0.004, zc - 0.006 - 0.0012))
		return group(out)
	})
}
