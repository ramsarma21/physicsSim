// 3D models of the circuits module (machines/mod_circuits.py): batteries in their holders, torch bulbs in batten holders, LEDs, knife, toggle and
// push switches, buzzers, DC motors (a propeller, a paddle or a disc on the shaft), resistors with their colour bands, a dimmer, a conductor
// tester, a multimeter, a mini solar panel, a hand generator, and (view plugins) the wires and the upright circuit board.
// Every part model fills its physics outline (x-y) within its depth; frames as web/models3d.js says (a slab centred on its origin).
// What changes with the run is drawn by frame hooks from the circuit's readings (track.state[item]): a bulb's filament glows with its light and
// its colour follows its temperature (dull red at 700 °C, orange, yellow-white at 2200 °C); an LED glows its colour with its current; a knife
// switch's blade drops into its clip as it closes; a push button sinks; a propeller, a crank and a dimmer's knob turn; a buzzer shows faint sound
// arcs while it sounds; a multimeter's display shows its reading. Wires are cables between their terminals (sagging, lying on the table, behind
// the parts they pass), redrawn as the parts move, a pulled-off end dropping. Lights are lit by point lights (at most 4 bulbs a run).
const DEG = Math.PI / 180

/** A filament's colour at a temperature (K): a black body, the usual fit (Tanner Helland's) to the CIE colours of black bodies. */
function blackbody(T) {
	const t = Math.max(800, Math.min(6500, T)) / 100
	let r
	let g
	let b
	if (t <= 66) {
		r = 255
		g = 99.4708025861 * Math.log(t) - 161.1195681661
		b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
	} else {
		r = 329.698727446 * (t - 60) ** -0.1332047592
		g = 288.1221695283 * (t - 60) ** -0.0755148492
		b = 255
	}
	const c = (v) => Math.max(0, Math.min(255, v)) / 255
	return [c(r), c(g), c(b)]
}

// the 4-band colour code (IEC 60062): digits, multiplier
const BANDS = ["#1b1b1b", "#7a4a26", "#d22b20", "#f08a1b", "#f3d21b", "#2c9a3a", "#2a5bd6", "#7b3fb5", "#8d8d8d", "#f4f4f4"]
function bandsFor(ohms) {
	let v = Math.max(1, Math.round(ohms))
	let e = 0
	while (v >= 100) {
		v = Math.round(v / 10)
		e++
	}
	if (v < 10) {
		v *= 10
		e--
	}
	const d1 = Math.floor(v / 10)
	const d2 = v % 10
	const mult = e < 0 ? "#c9a640" : BANDS[Math.min(9, e)] // (gold: × 0.1)
	return [BANDS[d1], BANDS[d2], mult, "#c9a640"] // (gold: ±5 %)
}

export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const T = THREE
	const put = (o, x = 0, y = 0, z = 0) => (o.position.set(x, y, z), o)
	const mesh = (g, m, opt) => kit.mesh(g, m, opt)
	const group = (...c) => kit.group(...c)
	const f5 = (v) => Number(v).toFixed(5)
	const M = (key, p) => kit.mat(`circ|${key}`, p)
	const brass = () => M("brass", { color: "#d1aa4a", roughness: 0.28, metalness: 1 })
	const copper = () => M("copper", { color: "#d07a45", roughness: 0.3, metalness: 1, clearcoat: 0.2 })
	const nickel = () => M("nickel", { color: "#cfd3d8", roughness: 0.22, metalness: 1 })
	const blackPlastic = () => M("black", { color: "#1d1f23", roughness: 0.42, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.3 })
	const plywood = () => kit.wood("#d2a46c", { roughness: 0.6, varnish: 0.35 })
	const paint = (hex, gloss = 0.4) => kit.plastic(hex, { gloss, key: "circ" })

	// ------------------------------------------------------------------ the base board and its brass screw terminals
	const boardModel = (ctx) => {
		const { w, h, d } = ctx
		return group(mesh(kit.box(w, h, d, Math.min(0.002, h * 0.3)), plywood()))
	}
	// a terminal post: a knurled brass nut on a threaded stud, a washer under it (fills its 8 x 10 mm outline)
	const postModel = (ctx) => {
		const { w, h } = ctx
		const r = w / 2
		const prof = [[0, -h / 2], [r * 0.95, -h / 2], [r * 0.95, -h / 2 + 0.0012], [r * 0.6, -h / 2 + 0.0016], [r * 0.6, -h / 2 + 0.0035], [r, -h / 2 + 0.004], [r, h / 2 - 0.0012], [r * 0.85, h / 2], [0, h / 2]]
		return group(mesh(kit.lathe(prof, 24, `circPost|${f5(w)}|${f5(h)}`), brass()))
	}
	const BOARD_TYPES = ["bulb", "led", "switch", "buzzer", "motor", "resistor", "dimmer", "solar-panel", "hand-generator"]
	for (const t of BOARD_TYPES) {
		addModel(t, "base", boardModel)
		addModel(t, "post_plus", postModel)
		addModel(t, "post_minus", postModel)
	}
	addModel("tester", "base", boardModel)

	// ------------------------------------------------------------------ battery
	addModel("battery", "body", (ctx) => {
		const { w, h, d } = ctx
		const kind = ctx.props.kind ?? "AA"
		const out = []
		if (kind === "AA" || kind === "D") {
			// a black ABS holder (an open tray) with the cells lying in it, + to the right; the front wall low so the cells show
			const wall = 0.0015
			out.push(put(mesh(kit.box(w, 0.002, d, 0.0006), blackPlastic()), 0, -h / 2 + 0.001, 0))
			for (const sz of [-1, 1]) out.push(put(mesh(kit.box(w, h * (sz > 0 ? 0.45 : 1), wall, 0.0005), blackPlastic()), 0, -h / 2 + (h * (sz > 0 ? 0.45 : 1)) / 2, sz * (d / 2 - wall / 2)))
			for (const sx of [-1, 1]) out.push(put(mesh(kit.box(0.003, h, d, 0.0006), blackPlastic()), sx * (w / 2 - 0.0015), 0, 0))
			const n = Math.max(1, Math.round((d - 0.004) / (kind === "AA" ? 0.0145 : 0.0342)))
			const cr = (kind === "AA" ? 0.0145 : 0.0342) / 2 - 0.0002
			const cl = w - 0.009
			const label = kit.printed(`circ-cell-${kind}`, (g, W, H) => {
				const grd = g.createLinearGradient(0, 0, W, 0)
				grd.addColorStop(0, "#1a1c20")
				grd.addColorStop(0.7, "#1a1c20")
				grd.addColorStop(0.7, "#c88b2c")
				grd.addColorStop(1, "#e3a63c")
				g.fillStyle = grd
				g.fillRect(0, 0, W, H)
				g.fillStyle = "#f2f2f2"
				g.font = `700 ${Math.round(H * 0.32)}px system-ui, sans-serif`
				g.textAlign = "center"
				g.textBaseline = "middle"
				g.fillText(`${kind}  1.5 V  ALKALINE`, W * 0.36, H * 0.5)
				g.fillStyle = "#1a1c20"
				g.fillText("+", W * 0.9, H * 0.5)
			}, { w: 512, h: 128, roughness: 0.35, clearcoat: 0.6 })
			for (let k = 0; k < n; k++) {
				const z = -d / 2 + 0.002 + cr + 0.0002 + k * 2 * (cr + 0.0002)
				const body = mesh(kit.latheX([[0, -cl / 2 + 0.001], [cr, -cl / 2 + 0.001], [cr, cl / 2 - 0.0015], [cr * 0.35, cl / 2 - 0.0015], [cr * 0.35, cl / 2], [0, cl / 2]], 40, `circCell|${kind}`), nickel())
				out.push(put(body, 0, -h / 2 + 0.002 + cr, z))
				const sleeve = mesh(kit.cylinderY(cr + 0.0001, cl - 0.004, 40).clone().rotateZ(-Math.PI / 2), label)
				out.push(put(sleeve, -0.001, -h / 2 + 0.002 + cr, z))
			}
			// the spring (−) and the plate (+) at the ends
			out.push(put(mesh(kit.box(0.0008, h * 0.7, d * 0.6, 0.0002), nickel()), w / 2 - 0.0034, 0, 0))
			out.push(put(mesh(kit.torus(Math.min(0.004, cr * 0.6), 0.0004, 8, 24).clone().rotateY(Math.PI / 2), nickel()), -w / 2 + 0.0035, -h / 2 + 0.002 + cr, 0))
		} else if (kind === "9V") {
			const sk = kit.printed("circ-9v", (g, W, H) => {
				g.fillStyle = "#1f3c8a"
				g.fillRect(0, 0, W, H)
				g.fillStyle = "#e8b236"
				g.fillRect(0, H * 0.72, W, H * 0.28)
				g.fillStyle = "#ffffff"
				g.font = `800 ${Math.round(H * 0.3)}px system-ui, sans-serif`
				g.textAlign = "center"
				g.textBaseline = "middle"
				g.save()
				g.translate(W / 2, H * 0.38)
				g.fillText("9V", 0, 0)
				g.restore()
			}, { w: 256, h: 512, roughness: 0.35, clearcoat: 0.6 })
			out.push(mesh(kit.box(w, h, d, 0.002), sk))
		} else {
			// a lantern battery: a square card-and-steel case with two coil-spring terminals on top
			const sk = kit.printed("circ-lantern", (g, W, H) => {
				g.fillStyle = "#c62a2a"
				g.fillRect(0, 0, W, H)
				g.fillStyle = "#1b1b1b"
				g.fillRect(0, 0, W, H * 0.12)
				g.fillStyle = "#ffffff"
				g.font = `800 ${Math.round(W * 0.22)}px system-ui, sans-serif`
				g.textAlign = "center"
				g.fillText("6 V", W / 2, H * 0.55)
			}, { w: 256, h: 512, roughness: 0.5 })
			out.push(mesh(kit.box(w, h, d, 0.003), sk))
		}
		return group(out)
	})
	addModel("battery", "post_plus", (ctx) => group(mesh(kit.cylinderY(ctx.w / 2, ctx.h, 20), M("redcap", { color: "#c8241c", roughness: 0.4 })), put(mesh(kit.cylinderY(ctx.w * 0.25, ctx.h * 0.2, 12), brass()), 0, ctx.h / 2, 0)))
	addModel("battery", "post_minus", (ctx) => group(mesh(kit.cylinderY(ctx.w / 2, ctx.h, 20), blackPlastic()), put(mesh(kit.cylinderY(ctx.w * 0.25, ctx.h * 0.2, 12), brass()), 0, ctx.h / 2, 0)))

	// ------------------------------------------------------------------ bulb: a black batten holder, a brass E10 cap, an 11 mm glass globe with its filament
	addModel("bulb", "holder", (ctx) => {
		const { w, h, d } = ctx
		const out = [mesh(kit.box(w, h * 0.55, d, 0.0015), blackPlastic())]
		out[0].position.y = -h / 2 + h * 0.275
		out.push(put(mesh(kit.cylinderY(w * 0.32, h * 0.45, 32), blackPlastic()), 0, h / 2 - h * 0.225, 0))
		return group(out)
	})
	addModel("bulb", "cap", (ctx) => {
		const { w, h } = ctx
		const r = w / 2
		const prof = [[0, -h / 2], [r * 0.4, -h / 2], [r * 0.45, -h / 2 + 0.0008]]
		for (let k = 0; k < 6; k++) {
			const y = -h / 2 + 0.0012 + k * ((h - 0.0016) / 6)
			prof.push([r * 0.92, y], [r, y + (h - 0.0016) / 12])
		}
		prof.push([r * 0.92, h / 2], [0, h / 2])
		return group(mesh(kit.lathe(prof, 32, `circCap|${f5(w)}|${f5(h)}`), brass()))
	})
	addFrameHook("circuits:glow", (obj, f, a) => {
		const light = Math.max(0, Number(f.state?.light) || 0)
		const tK = (Number(f.state?.temp_c) || 20) + 273.15
		const broken = (Number(f.state?.broken) || 0) > 0.5
		const fil = obj.getObjectByName("filament")
		const halo = obj.getObjectByName("halo")
		const k = broken ? 0 : Math.min(1, light) // (the glow's strength; light beyond full only whitens it)
		const visible = !broken && tK > 750
		if (fil) {
			const m = ownMaterial(fil)
			const [r, g, b] = blackbody(tK)
			m.color.setRGB(visible ? r : 0.25, visible ? g : 0.22, visible ? b : 0.2)
			m.emissive.setRGB(r, g, b)
			m.emissiveIntensity = visible ? 0.4 + 6 * Math.sqrt(k) + 2 * Math.max(0, Math.min(2, light - 1)) : 0
		}
		if (halo) {
			const m = ownMaterial(halo)
			const [r, g, b] = blackbody(tK)
			m.color.setRGB(r, g, b)
			m.opacity = visible ? Math.min(0.75, 0.1 + 0.6 * Math.sqrt(k)) : 0
			const s = a.size * (0.6 + 0.6 * Math.sqrt(Math.min(2, light)))
			halo.scale.set(s, s, 1)
			halo.visible = visible && light > 0.02
		}
		const inner = obj.getObjectByName("inner")
		if (inner) {
			const m = ownMaterial(inner)
			const [r, g, b] = blackbody(tK)
			m.color.setRGB(r, g, b)
			m.opacity = visible ? Math.min(0.85, 0.08 + 0.7 * Math.sqrt(k)) : 0
			inner.visible = visible && light > 0.01
		}
		const pl = obj.getObjectByName("bulb-light")
		if (pl) pl.intensity = visible ? 0.01 * Math.min(4, light) : 0
	})
	/** A soft round glow (an additive sprite: its colour is set by the hook). */
	const haloTex = () =>
		kit.tex("circ-halo", 128, 128, (g, W, H) => {
			const grd = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2)
			grd.addColorStop(0, "rgba(255,255,255,1)")
			grd.addColorStop(0.25, "rgba(255,255,255,0.55)")
			grd.addColorStop(1, "rgba(255,255,255,0)")
			g.fillStyle = grd
			g.fillRect(0, 0, W, H)
		}, { wrap: false })
	const halo = (size) => {
		const m = new T.SpriteMaterial({ map: haloTex(), color: 0xffcc88, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })
		const s = new T.Sprite(m)
		s.name = "halo"
		s.scale.set(size, size, 1)
		s.castShadow = false
		s.visible = false
		return s
	}
	addModel("bulb", "glass", (ctx) => {
		const r = ctx.r
		const out = []
		// the globe (clear glass, a little neck into the cap), its two support wires and a coiled filament between them
		const globe = mesh(kit.lathe([[0, -r], [r * 0.45, -r * 1.0], [r * 0.62, -r * 0.82], [r * 0.95, -r * 0.35], [r, 0], [r * 0.92, r * 0.42], [r * 0.6, r * 0.82], [0, r]], 40, `circGlobe|${f5(r)}`), kit.glass("#ffffff", { thickness: 0.0006 }), { cast: false })
		out.push(globe)
		const wire = M("leadwire", { color: "#9aa0a6", roughness: 0.3, metalness: 1 })
		for (const sx of [-1, 1]) out.push(put(mesh(kit.cylinderY(0.00018, r * 1.1, 6), wire, { cast: false }), sx * r * 0.32, -r * 0.4, 0))
		const coil = []
		const turns = 7
		for (let i = 0; i <= turns * 12; i++) {
			const u = i / (turns * 12)
			const a = u * turns * Math.PI * 2
			coil.push(new T.Vector3(-r * 0.32 + u * r * 0.64, r * 0.12 + 0.0004 * Math.cos(a), 0.0004 * Math.sin(a)))
		}
		const fil = mesh(new T.TubeGeometry(new T.CatmullRomCurve3(coil), 64, 0.00012, 5, false), new T.MeshStandardMaterial({ color: 0x403830, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.5, metalness: 0.3 }), { cast: false })
		fil.name = "filament"
		out.push(fil)
		// (a warm glow filling the globe when lit, and a soft halo round it: both additive, coloured by the filament's temperature)
		const inner = mesh(kit.sphere(r * 0.8, 24, 12), new T.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }), { cast: false })
		inner.name = "inner"
		inner.visible = false
		out.push(inner)
		const h = halo(r * 4)
		h.position.y = r * 0.12
		out.push(h)
		const pl = new T.PointLight(0xffc887, 0, 0.6, 2)
		pl.name = "bulb-light"
		pl.castShadow = false
		pl.position.y = r * 0.12
		out.push(pl)
		const g = group(out)
		g.userData.frame = { hook: "circuits:glow", size: r * 4 }
		return g
	})

	// ------------------------------------------------------------------ LED: a coloured epoxy body and dome, glowing with its current
	addModel("led", "holder", (ctx) => group(mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0012), blackPlastic())))
	const ledMat = (hex) => new T.MeshPhysicalMaterial({ color: new T.Color(hex).multiplyScalar(0.7), emissive: new T.Color(hex), emissiveIntensity: 0, roughness: 0.15, metalness: 0, transmission: 0.0, transparent: true, opacity: 0.88, clearcoat: 1, clearcoatRoughness: 0.05 })
	const LED_HEX = { red: "#ff2a1a", yellow: "#ffc81a", green: "#2aff3a", blue: "#2a6aff", white: "#f4f6ff" }
	addFrameHook("circuits:led", (obj, f, a) => {
		const light = (Number(f.state?.broken) || 0) > 0.5 ? 0 : Math.max(0, Number(f.state?.light) || 0)
		obj.traverse((o) => {
			if (o.isMesh && o.userData.ledGlow) ownMaterial(o).emissiveIntensity = 0.05 + 3.5 * Math.min(1.5, light)
		})
		const h = obj.getObjectByName("halo")
		if (h) {
			ownMaterial(h).opacity = Math.min(0.85, 0.7 * Math.sqrt(Math.min(1.5, light)))
			h.visible = light > 0.02
			const s = a.size * (1 + Math.sqrt(Math.min(2, light)))
			h.scale.set(s, s, 1)
		}
	})
	addModel("led", "body", (ctx) => {
		const hex = LED_HEX[ctx.props.color] ?? ctx.color
		const { w, h, d } = ctx
		const m = mesh(kit.cylinderY(w / 2, h, 32), ledMat(hex), { cast: false })
		m.userData.ledGlow = true
		const rim = put(mesh(kit.cylinderY(w / 2 + 0.0004, 0.001, 32), ledMat(hex), { cast: false }), 0, -h / 2 + 0.0005, 0)
		rim.userData.ledGlow = true
		const g = group(m, rim)
		g.userData.frame = { hook: "circuits:led", size: 0.02 }
		return g
	})
	addModel("led", "dome", (ctx) => {
		const hex = LED_HEX[ctx.props.color] ?? ctx.color
		const m = mesh(kit.sphere(ctx.r, 32, 16), ledMat(hex), { cast: false })
		m.userData.ledGlow = true
		const g = group(m, halo(0.02))
		g.userData.frame = { hook: "circuits:led", size: 0.02 }
		return g
	})

	// ------------------------------------------------------------------ switches
	addModel("switch", "hinge", (ctx) => {
		const { w, h, d } = ctx
		const out = [mesh(kit.box(w, h, d * 0.5, 0.0008), brass())]
		out[0].position.z = 0
		// the blade: a brass strip from this hinge to the clip (0.042 m away), a black handle at its far end; it turns about the hinge pin
		const blade = group(put(mesh(kit.box(0.046, 0.002, 0.004, 0.0005), brass()), 0.023, 0, 0), put(mesh(kit.cylinderY(0.0035, 0.014, 16).clone().rotateZ(Math.PI / 2), blackPlastic()), 0.05, 0.002, 0))
		blade.name = "blade"
		blade.position.set(0, h / 2 - 0.002, 0)
		out.push(blade)
		out.push(put(mesh(kit.cylinderZ(0.0012, d * 0.6, 12), nickel()), 0, h / 2 - 0.002, 0))
		const g = group(out)
		g.userData.frame = { hook: "circuits:knife", open: 55 }
		return g
	})
	addFrameHook("circuits:knife", (obj, f, a) => {
		const closed = Math.max(0, Math.min(1, Number(f.state?.closed) || 0))
		const b = obj.getObjectByName("blade")
		if (b) b.rotation.z = (1 - closed) * a.open * DEG
	})
	addModel("switch", "clip", (ctx) => {
		const { w, h, d } = ctx
		return group(put(mesh(kit.box(w, h * 0.35, d * 0.5, 0.0006), brass()), 0, -h / 2 + h * 0.175, 0), ...[-1, 1].map((sz) => put(mesh(kit.box(w * 0.8, h, 0.0012, 0.0004), brass()), 0, 0, sz * 0.0028)))
	})
	addModel("switch", "toggle", (ctx) => {
		const { w, h, d } = ctx
		const lever = put(mesh(kit.cylinderY(0.0016, 0.012, 12), nickel()), 0, h / 2 + 0.004, 0)
		lever.name = "lever"
		const g = group(mesh(kit.box(w, h, d, 0.0015), blackPlastic()), put(mesh(kit.cylinderY(0.004, 0.002, 24), nickel()), 0, h / 2, 0), lever)
		g.userData.frame = { hook: "circuits:toggle" }
		return g
	})
	addFrameHook("circuits:toggle", (obj, f) => {
		const closed = Math.max(0, Math.min(1, Number(f.state?.closed) || 0))
		const l = obj.getObjectByName("lever")
		if (l) l.rotation.z = (closed - 0.5) * -50 * DEG
	})
	addModel("switch", "housing", (ctx) => group(mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0015), blackPlastic())))
	addModel("switch", "button", (ctx) => {
		const cap = mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.002), M("redbutton", { color: "#d02020", roughness: 0.35, clearcoat: 0.6 }))
		cap.name = "cap"
		const g = group(cap)
		g.userData.frame = { hook: "circuits:push", travel: 0.002 }
		return g
	})
	addFrameHook("circuits:push", (obj, f, a) => {
		const c = obj.getObjectByName("cap")
		if (c) c.position.y = -a.travel * Math.max(0, Math.min(1, Number(f.state?.closed) || 0))
	})
	addModel("switch", "body", (ctx) => group(mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0015), blackPlastic())))

	// ------------------------------------------------------------------ buzzer: a black can with a sound hole; faint arcs while it sounds
	addModel("buzzer", "body", (ctx) => {
		const { w, h } = ctx
		const out = [mesh(kit.cylinderY(w / 2, h, 40), blackPlastic())]
		out.push(put(mesh(kit.cylinderY(w * 0.12, 0.0004, 20), M("hole", { color: "#050505", roughness: 0.9 })), 0, h / 2, 0))
		const arcs = new T.Group()
		arcs.name = "arcs"
		for (let k = 0; k < 3; k++) {
			const m = new T.MeshBasicMaterial({ color: 0x5a6b80, transparent: true, opacity: 0, depthWrite: false })
			const a = mesh(new T.TorusGeometry(1, 0.03, 6, 32, Math.PI * 0.55).rotateZ(Math.PI * 0.225), m, { cast: false })
			a.userData.k = k
			arcs.add(a)
		}
		arcs.position.y = h / 2 + 0.004
		out.push(arcs)
		const g = group(out)
		g.userData.frame = { hook: "circuits:buzz" }
		return g
	})
	addFrameHook("circuits:buzz", (obj, f) => {
		const s = Math.max(0, Number(f.state?.sound) || 0)
		const arcs = obj.getObjectByName("arcs")
		if (!arcs) return
		for (const a of arcs.children) {
			const u = ((f.t * 1.6 + a.userData.k / 3) % 1 + 1) % 1 // (each arc grows outward and fades, one after another)
			const r = 0.006 + 0.016 * u
			a.scale.set(r, r, r)
			ownMaterial(a).opacity = s > 0 ? 0.55 * (1 - u) * Math.min(1, s) : 0
			a.visible = s > 0
		}
	})

	// ------------------------------------------------------------------ motor
	addModel("motor", "bracket", (ctx) => group(mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0006), M("bracket", { color: "#9aa1a8", roughness: 0.35, metalness: 1 }))))
	const canModelX = (L, D) => {
		// a 130-size can lying along x: a nickel can, its black end cap with two solder tabs, a shaft out of its right end
		const r = D / 2
		const out = [mesh(kit.latheX([[0, -L / 2], [r * 0.92, -L / 2], [r, -L / 2 + 0.0015], [r, L / 2 - 0.002], [r * 0.85, L / 2], [0, L / 2]], 40, `circCan|${f5(L)}|${f5(D)}`), nickel())]
		out.push(put(mesh(kit.cylinderY(r * 0.98, 0.006, 32).clone().rotateZ(Math.PI / 2), blackPlastic()), -L / 2 + 0.003, 0, 0))
		for (const sz of [-1, 1]) out.push(put(mesh(kit.box(0.004, 0.003, 0.0008, 0.0002), brass()), -L / 2 - 0.001, r * 0.5, sz * r * 0.45))
		out.push(put(mesh(kit.cylinderY(0.001, 0.008, 12).clone().rotateZ(Math.PI / 2), nickel()), L / 2 + 0.004, 0, 0))
		return out
	}
	addModel("motor", "can", (ctx) => {
		if (ctx.solid.body.kind === "slab") {
			// the propeller motor: the can along x, the propeller on its shaft (turned by the hook from the rotor's angle)
			const { w, h } = ctx
			const out = canModelX(w, h)
			const size = ctx.props.size ?? 0.12
			const prop = new T.Group()
			prop.name = "prop"
			const bladeShape = (sgn) => {
				const g = kit.extrude([[0, -0.006], [size * 0.48, -0.011], [size * 0.5, 0.0], [size * 0.47, 0.007], [0, 0.004]], 0.0012, { bevel: 0.0004, key: `circBlade|${f5(size)}` }).clone()
				g.rotateY(Math.PI / 2) // (the blade in the y-z plane)
				const m = mesh(g, M("propblade", { color: "#2b84d6", roughness: 0.35, clearcoat: 0.4 }))
				m.rotation.x = sgn > 0 ? 0 : Math.PI
				m.rotation.y = 0.35 * sgn // (pitched)
				return m
			}
			prop.add(bladeShape(1), bladeShape(-1), mesh(kit.cylinderY(0.006, 0.008, 24).clone().rotateZ(Math.PI / 2), M("prophub", { color: "#2b84d6", roughness: 0.35 })))
			const blur = mesh(kit.cylinderY(size / 2, 0.0006, 48).clone().rotateZ(Math.PI / 2), new T.MeshBasicMaterial({ color: 0x2b84d6, transparent: true, opacity: 0, depthWrite: false }), { cast: false })
			blur.name = "blur"
			prop.add(blur)
			prop.position.x = w / 2 + 0.006
			out.push(prop)
			const g = group(out)
			g.userData.frame = { hook: "circuits:prop" }
			return g
		}
		// a shaft motor seen end on: the can behind the attachment (along z), its shaft and nut in front
		const L = (ctx.d ?? 0.07) - 0.03
		const D = 0.024
		const out = []
		const can = kit.latheZ([[0, -L], [D / 2 * 0.92, -L], [D / 2, -L + 0.0015], [D / 2, -0.002], [D / 2 * 0.85, 0], [0, 0]], 40, `circCanZ|${f5(L)}`)
		out.push(put(mesh(can, nickel()), 0, 0, -0.008))
		out.push(put(mesh(kit.cylinderZ(0.0012, 0.03, 12), nickel()), 0, 0, 0.004))
		out.push(put(mesh(kit.cylinderZ(0.0035, 0.004, 6), nickel()), 0, 0, 0.012))
		return group(out)
	})
	addFrameHook("circuits:prop", (obj, f) => {
		const p = obj.getObjectByName("prop")
		if (!p) return
		const ang = Number(f.state?.angle) || 0
		const rpm = Math.abs(Number(f.state?.rpm) || 0)
		// (above about 600 rpm the eye sees a disc: the blades fade into a blur disc, turning at a slower apparent rate)
		const fast = Math.max(0, Math.min(1, (rpm - 600) / 1800))
		p.rotation.x = fast > 0.95 ? ang * 0.02 : ang
		const blur = p.getObjectByName("blur")
		if (blur) ownMaterial(blur).opacity = 0.35 * fast
		for (const c of p.children) if (c !== blur && c.isMesh) c.visible = fast < 0.98
	})
	addModel("motor", "rotor", (ctx) => {
		if (ctx.solid.body.kind === "slab") {
			// a wooden paddle with a red tip, so its turning shows
			const { w, h, d } = ctx
			return group(mesh(kit.box(w, h, d, Math.min(0.002, h * 0.3)), kit.wood("#c8955a")), put(mesh(kit.box(w * 0.12, h + 0.0004, d + 0.0004, 0.001), M("tip", { color: "#d22b20", roughness: 0.4, clearcoat: 0.4 })), w / 2 - w * 0.06, 0, 0))
		}
		// a disc: white with coloured sectors (a colour wheel), so its turning shows
		const r = ctx.r
		const map = kit.tex("circ-wheel", 256, 256, (g, W, H) => {
			const cols = ["#d22b20", "#f08a1b", "#f3d21b", "#2c9a3a", "#2a5bd6", "#7b3fb5"]
			for (let k = 0; k < 6; k++) {
				g.fillStyle = cols[k]
				g.beginPath()
				g.moveTo(W / 2, H / 2)
				g.arc(W / 2, H / 2, W / 2, (k * Math.PI) / 3, ((k + 1) * Math.PI) / 3)
				g.fill()
			}
		}, { wrap: false })
		const faceMat = kit.mat("circ-wheel-face", { map, roughness: 0.45, clearcoat: 0.3 })
		const disc = mesh(kit.cylinderZ(r, ctx.d ?? 0.004, 64), [M("discEdge", { color: "#e8e8e8", roughness: 0.5 }), faceMat, faceMat])
		return group(disc)
	})

	// ------------------------------------------------------------------ resistor (colour bands by its value) and dimmer
	addModel("resistor", "body", (ctx) => {
		const { w, h } = ctx
		const r = h / 2
		const out = [mesh(kit.latheX([[0, -w / 2], [r * 0.85, -w / 2], [r, -w / 2 + 0.002], [r * 0.8, -w / 2 + 0.004], [r * 0.8, w / 2 - 0.004], [r, w / 2 - 0.002], [r * 0.85, w / 2], [0, w / 2]], 32, `circRes|${f5(w)}|${f5(h)}`), M("resbody", { color: "#d8c49a", roughness: 0.45, clearcoat: 0.4 }))]
		const bands = bandsFor(ctx.props.ohms ?? 100)
		bands.forEach((c, k) => {
			const x = -w / 2 + 0.0035 + k * (k < 3 ? 0.0022 : 0.0032)
			out.push(put(mesh(kit.cylinderY(r * 0.83, 0.0011, 24).clone().rotateZ(Math.PI / 2), M(`band|${c}`, { color: c, roughness: 0.45, clearcoat: 0.4 })), x, 0, 0))
		})
		const lead = M("leadwire", { color: "#9aa0a6", roughness: 0.3, metalness: 1 })
		for (const sx of [-1, 1]) out.push(put(mesh(kit.cylinderY(0.0003, 0.012, 6).clone().rotateZ(Math.PI / 2), lead), sx * (w / 2 + 0.006), 0, 0))
		return group(out)
	})
	addModel("dimmer", "body", (ctx) => {
		const { w, h, d } = ctx
		const knob = put(group(mesh(kit.cylinderZ(0.009, 0.008, 32), blackPlastic()), put(mesh(kit.box(0.0015, 0.007, 0.0012, 0.0003), M("white", { color: "#f2f2f2", roughness: 0.4 })), 0, 0.004, 0.0042)), 0, 0, d / 2 - 0.004)
		knob.name = "knob"
		const g = group(mesh(kit.box(w, h, d - 0.008, 0.0015), M("dimbody", { color: "#3a3d44", roughness: 0.45, clearcoat: 0.3 })), knob)
		g.children[0].position.z = -0.004
		g.userData.frame = { hook: "circuits:knob", max: ctx.props.max_ohms ?? 50 }
		return g
	})
	addFrameHook("circuits:knob", (obj, f, a) => {
		const ohms = Number(f.state?.ohms)
		const k = Number.isFinite(ohms) ? Math.max(0, Math.min(1, (ohms - 0.5) / a.max)) : 0
		const kn = obj.getObjectByName("knob")
		if (kn) kn.rotation.z = (135 - 270 * k) * DEG
	})

	// ------------------------------------------------------------------ tester: two copper plates with brass screws
	const plateModel = (ctx) => {
		const { w, h, d } = ctx
		const out = [mesh(kit.box(w, h, d, 0.0006), copper())]
		for (const sx of [-1, 1]) out.push(put(mesh(kit.cylinderY(0.002, 0.0008, 16), brass()), sx * (w / 2 - 0.004), h / 2 + 0.0002, 0))
		return group(out)
	}
	addModel("tester", "probe_plus", plateModel)
	addModel("tester", "probe_minus", plateModel)

	// ------------------------------------------------------------------ multimeter: a yellow-cased meter standing up, its display reading the run
	addFrameHook("circuits:lcd", (obj, f, a) => {
		const v = Number(f.state?.reading)
		const txt = Number.isFinite(v) ? (a.mode === "amps" ? `${Math.abs(v) < 1 ? (v * 1000).toFixed(1) : v.toFixed(3)} ${Math.abs(v) < 1 ? "mA" : "A"}` : `${v.toFixed(2)} V`) : "----"
		if (obj.userData.shown === txt) return
		obj.userData.shown = txt
		// (the canvas is made per drawn meter, on its first frame: a model's userData is cloned through JSON, which a canvas does not survive)
		if (!obj.__lcd) {
			const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 96) : Object.assign(document.createElement("canvas"), { width: 256, height: 96 })
			const m0 = ownMaterial(obj)
			m0.map = new T.CanvasTexture(canvas)
			m0.map.colorSpace = T.SRGBColorSpace
			m0.color.set(0xffffff)
			obj.__lcd = canvas
		}
		const canvas = obj.__lcd
		const g = canvas.getContext("2d")
		g.fillStyle = "#b7c2a6"
		g.fillRect(0, 0, canvas.width, canvas.height)
		g.fillStyle = "#1b2016"
		g.font = `700 ${Math.round(canvas.height * 0.55)}px ui-monospace, Menlo, monospace`
		g.textAlign = "right"
		g.textBaseline = "middle"
		g.fillText(txt, canvas.width - 14, canvas.height * 0.55)
		obj.material.map.needsUpdate = true
	})
	// ------------------------------------------------------------------ galvanometer: a centre-zero needle meter in a wooden box, its needle the run's reading
	addFrameHook("circuits:galvo", (obj, f) => {
		const n = obj.getObjectByName("needle")
		if (n) n.rotation.z = -(Number(f.state?.needle) || 0) * (45 * DEG)
	})
	const galvanometer = (ctx) => {
		const { w, h, d } = ctx
		const out = [mesh(kit.box(w, h, d, 0.004), plywood())]
		// the dial: a white card behind glass with a scale from − through 0 to +, its needle pivoted at the bottom middle
		const dw = w - 0.016
		const dh = h - 0.03
		const face = kit.printed("circ-galvo-face", (g, W, H) => {
			g.fillStyle = "#f4f1e8"
			g.fillRect(0, 0, W, H)
			g.strokeStyle = "#1b1b1b"
			g.fillStyle = "#1b1b1b"
			const cx = W / 2
			const cy = H * 0.95
			const R = H * 0.78
			g.lineWidth = 3
			g.beginPath()
			g.arc(cx, cy, R, -Math.PI / 2 - Math.PI / 4, -Math.PI / 2 + Math.PI / 4)
			g.stroke()
			for (let k = -10; k <= 10; k++) {
				const a = -Math.PI / 2 + (k / 10) * (Math.PI / 4)
				const l = k % 5 === 0 ? 0.12 : 0.06
				g.lineWidth = k % 5 === 0 ? 3 : 2
				g.beginPath()
				g.moveTo(cx + R * Math.cos(a), cy + R * Math.sin(a))
				g.lineTo(cx + R * (1 - l) * Math.cos(a), cy + R * (1 - l) * Math.sin(a))
				g.stroke()
			}
			g.font = `700 ${Math.round(H * 0.11)}px ui-sans-serif, Helvetica, Arial, sans-serif`
			g.textAlign = "center"
			g.textBaseline = "middle"
			for (const [k, t] of [[-10, "−"], [0, "0"], [10, "+"]]) {
				const a = -Math.PI / 2 + (k / 10) * (Math.PI / 4)
				g.fillText(t, cx + R * 0.74 * Math.cos(a), cy + R * 0.74 * Math.sin(a))
			}
			g.font = `600 ${Math.round(H * 0.07)}px ui-sans-serif, Helvetica, Arial, sans-serif`
			g.fillText("GALVANOMETER", cx, H * 0.7)
			g.fillText("0.5 mA full scale", cx, H * 0.79)
		}, { w: 512, h: 384, roughness: 0.6 })
		const dial = mesh(new T.PlaneGeometry(dw, dh), face, { cast: false })
		dial.position.set(0, 0.006, d / 2 + 0.0006)
		out.push(dial)
		const glass = mesh(new T.PlaneGeometry(dw, dh), M("galvoGlass", { color: "#ffffff", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12 }), { cast: false })
		glass.position.set(0, 0.006, d / 2 + 0.004)
		out.push(glass)
		const needle = new T.Group()
		needle.name = "needle"
		needle.add(put(mesh(kit.box(0.0012, dh * 0.74, 0.0006, 0.0002), M("galvoNeedle", { color: "#1b1b1b", roughness: 0.4 })), 0, (dh * 0.74) / 2, 0))
		needle.add(mesh(kit.cylinderZ(0.003, 0.0016, 20), brass()))
		needle.position.set(0, 0.006 - dh / 2 + dh * 0.05, d / 2 + 0.0018)
		out.push(needle)
		// its two binding posts at the bottom front: red + on the right, black − on the left
		for (const [sx, m] of [[1, M("redjack", { color: "#c8241c", roughness: 0.4 })], [-1, blackPlastic()]]) out.push(put(mesh(kit.cylinderZ(0.004, 0.006, 20), m), sx * 0.035, -h / 2 + 0.012, d / 2 + 0.003))
		const g = group(out)
		g.userData.frame = { hook: "circuits:galvo" }
		return g
	}
	addModel("meter", "body", (ctx) => {
		if ((ctx.props?.mode ?? "volts") === "galvanometer") return galvanometer(ctx)
		const { w, h, d } = ctx
		const out = [mesh(kit.box(w, h, d, 0.006), M("meterCase", { color: "#f2c230", roughness: 0.55, clearcoat: 0.2 }))]
		out.push(put(mesh(kit.box(w - 0.012, h - 0.02, 0.002, 0.003), blackPlastic()), 0, 0, d / 2 - 0.0005))
		// the display: a canvas the hook writes the reading on
		const lcd = mesh(new T.PlaneGeometry(w - 0.02, 0.026), new T.MeshStandardMaterial({ color: 0xb7c2a6, roughness: 0.6, metalness: 0 }), { cast: false })
		lcd.position.set(0, h / 2 - 0.03, d / 2 + 0.0008)
		lcd.userData.frame = { hook: "circuits:lcd", mode: ctx.props.mode ?? "volts" }
		out.push(lcd)
		// the dial and the two jacks (red + on the right, black COM on the left)
		out.push(put(mesh(kit.cylinderZ(0.016, 0.004, 40), M("dial", { color: "#2a2c31", roughness: 0.4 })), 0, -0.005, d / 2 + 0.001))
		out.push(put(mesh(kit.box(0.004, 0.014, 0.003, 0.001), M("white", { color: "#f2f2f2", roughness: 0.4 })), 0, 0.002, d / 2 + 0.003).rotateZ(ctx.props.mode === "amps" ? -0.9 : 0.9))
		out.push(put(mesh(kit.cylinderZ(0.0035, 0.003, 20), M("redjack", { color: "#c8241c", roughness: 0.4 })), 0.022, -0.06, d / 2 + 0.001))
		out.push(put(mesh(kit.cylinderZ(0.0035, 0.003, 20), blackPlastic()), -0.022, -0.06, d / 2 + 0.001))
		const label = mesh(new T.PlaneGeometry(w - 0.02, 0.008), kit.mat(`circ-meter-label2-${ctx.props.mode}`, { map: kit.text("circ-meter-label2", ctx.props.mode === "amps" ? "AMMETER  A" : "VOLTMETER  V", { bg: "#1d1f23", fg: "#f2c230", w: 512, h: 64, font: "700 40px ui-sans-serif, Helvetica, Arial, sans-serif" }), roughness: 0.5 }), { cast: false })
		label.position.set(0, h / 2 - 0.052, d / 2 + 0.0008)
		out.push(label)
		return group(out)
	})

	// ------------------------------------------------------------------ solar panel: dark blue cells, silver fingers and busbars, an aluminium frame
	addModel("solar-panel", "panel", (ctx) => {
		const { w, h, d } = ctx
		const map = kit.tex("circ-pv", 512, 340, (g, W, H) => {
			g.fillStyle = "#c9ced4"
			g.fillRect(0, 0, W, H)
			const cw = (W - 30) / 4
			for (let k = 0; k < 4; k++) {
				const x = 12 + k * (cw + 2)
				g.fillStyle = "#1b2f6b"
				g.fillRect(x, 12, cw, H - 24)
				g.strokeStyle = "rgba(220,225,235,0.45)"
				g.lineWidth = 1
				for (let y = 18; y < H - 12; y += 6) {
					g.beginPath()
					g.moveTo(x, y)
					g.lineTo(x + cw, y)
					g.stroke()
				}
				g.fillStyle = "#d8dde4"
				g.fillRect(x + cw * 0.3, 12, 3, H - 24)
				g.fillRect(x + cw * 0.7, 12, 3, H - 24)
			}
		}, { wrap: false })
		const top = kit.mat("circ-pv-top2", { map, roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.35 })
		const frame = M("pvframe", { color: "#c2c7cd", roughness: 0.3, metalness: 1 })
		// (a box whose top face, +y, is the cells)
		const geo = new T.BoxGeometry(w, h, d)
		return group(mesh(geo, [frame, frame, top, frame, frame, frame]))
	})
	addModel("solar-panel", "post", (ctx) => group(mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.001), blackPlastic())))

	// ------------------------------------------------------------------ hand generator: a blue gearbox with a crank on its front that turns
	addModel("hand-generator", "body", (ctx) => {
		const { w, h, d } = ctx
		const out = [mesh(kit.box(w, h, d, 0.005), M("genbody", { color: "#2a7bd0", roughness: 0.42, clearcoat: 0.3 }))]
		const crank = new T.Group()
		crank.name = "crank"
		crank.add(put(mesh(kit.box(0.03, 0.006, 0.004, 0.0015), nickel()), 0.012, 0, 0))
		crank.add(put(mesh(kit.cylinderZ(0.004, 0.018, 16), M("knob", { color: "#d22b20", roughness: 0.4 })), 0.025, 0, 0.011))
		crank.add(mesh(kit.cylinderZ(0.005, 0.006, 20), nickel()))
		crank.position.set(0, 0, d / 2 + 0.003)
		out.push(crank)
		const g = group(out)
		g.userData.frame = { hook: "circuits:crank" }
		return g
	})
	addFrameHook("circuits:crank", (obj, f) => {
		const c = obj.getObjectByName("crank")
		if (c) c.rotation.z = Number(f.state?.angle) || 0
	})

	// ------------------------------------------------------------------ electromagnetism: the wired electromagnet, the induction coil, the straight wire
	const enamel = (key, R) =>
		kit.printed(`circ-enamel-${key}-${Math.round(R * 1e5)}`, (gc, cw, ch) => {
			gc.fillStyle = "#a9481b"
			gc.fillRect(0, 0, cw, ch)
			for (let i = 0; i < 200; i++) {
				gc.fillStyle = i % 2 ? "#c9672d" : "#8d3a14"
				gc.fillRect((i * cw) / 200, 0, cw / 400, ch)
			}
		}, { w: 512, h: 64, roughness: 0.22, metalness: 0.6, clearcoat: 0.8 })
	// the electromagnet: a steel nail (point at +x of its own frame, the item's point down) with layers of 0.51 mm enamelled wire, and its head
	addModel("electromagnet", "core", (ctx) => {
		const P = ctx.props ?? {}
		const pts = ctx.body?.points ?? []
		const xs = pts.map((q) => q.x)
		const L = xs.length ? Math.max(...xs) - Math.min(...xs) : 0.051
		const r = (ctx.body?.depth ?? 0.0029) / 2
		const p = Math.min(0.004, L / 6)
		const prof = [[0, L / 2], [r * 0.12, L / 2 - 0.0002], [r, L / 2 - p], [r, -L / 2 + 0.0004], [r * 0.9, -L / 2], [0, -L / 2]]
		const nail = mesh(kit.geo(`circ|nail|${f5(L)}|${f5(r)}`, () => new T.LatheGeometry(prof.map(([a, b]) => new T.Vector2(a, b)), 32).rotateZ(-Math.PI / 2)), kit.steel())
		const turns = Math.max(1, Number(P.turns) || 50)
		const len = Math.max(0.005, L - 0.01)
		const layers = Math.max(1, Math.ceil(turns / Math.max(1, Math.floor(len / 0.00051))))
		const R = r + layers * 0.00051
		const coil = mesh(kit.geo(`circ|emcoil|${f5(len)}|${f5(R)}`, () => new T.CylinderGeometry(R, R, len, 48, 1, false).rotateZ(Math.PI / 2)), enamel("em", R))
		const head = mesh(kit.geo(`circ|nailhead|${f5(r)}`, () => new T.CylinderGeometry(r * 2.2, r * 2.2, 0.001, 32).rotateZ(Math.PI / 2)), kit.steel())
		// its two leads' ends by the head, + and − (where the wires clip)
		const leads = [1, -1].map((sy) => put(mesh(kit.cylinderY(0.0004, 0.004, 8), copper()), -L / 2 + 0.004, sy * (r + 0.0005 + 0.0015), 0))
		return group(nail, put(coil, -0.0005, 0, 0), put(head, -L / 2 - 0.0005, 0, 0), ...leads)
	})
	// the induction coil: a cardboard tube wound with enamelled wire; each wall part draws its half of the tube (the bore between them clear,
	// as the physics has it), cut by the plane through the axis and the camera
	const coilHalf = (ctx, side) => {
		const P = ctx.props ?? {}
		const vertical = (P.axis ?? "vertical") === "vertical"
		const D = Number(P.diameter) || 0.04
		const Lc = Number(P.length) || 0.06
		const t = vertical ? ctx.w : ctx.h
		const rIn = D / 2
		const rTube = D / 2 + 0.002
		const rOut = D / 2 + t
		// (three.js cylinders go round y from +z: sin ≥ 0 is the +x half; laid along x for a horizontal coil, the half that ends up on this wall's side)
		const start = vertical ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI : 0
		const shell = (r0, r1, key, m) => {
			const k = `${key}|${f5(r0)}|${f5(r1)}|${f5(Lc)}|${start}|${vertical}`
			const lay = (g) => (vertical ? g : g.rotateZ(-Math.PI / 2))
			const parts = [
				kit.geo(`circ|coilout|${k}`, () => lay(new T.CylinderGeometry(r1, r1, Lc, 48, 1, true, start, Math.PI))),
				kit.geo(`circ|coilin|${k}`, () => lay(new T.CylinderGeometry(r0, r0, Lc, 48, 1, true, start, Math.PI))),
				...[1, -1].map((sy) =>
					kit.geo(`circ|coilend|${k}|${sy}`, () => {
						// (a half ring in the x-z plane at the tube's end: the same half as the shell's, θ round y from +z ↔ φ = θ − π/2 from +x)
						// (its top faces up, its bottom down: turned about x either way, the bottom's angles mirrored so it is the same half)
						const ring = new T.RingGeometry(r0, r1, 24, 1, sy > 0 ? start - Math.PI / 2 : -start - Math.PI / 2, Math.PI)
						ring.rotateX(sy > 0 ? -Math.PI / 2 : Math.PI / 2)
						ring.translate(0, (sy * Lc) / 2, 0)
						return lay(ring)
					})
				)
			]
			return group(...parts.map((g) => mesh(g, m)))
		}
		const cardboard = M("coilCard", { color: "#b98a52", roughness: 0.8, side: T.DoubleSide })
		const g = group(shell(rIn, rTube, "card", cardboard), shell(rTube, rOut, "wind", enamel("coil", rOut)))
		// (the axis is at the bore's middle: from this wall's own origin, across the bore)
		const off = D / 2 + t / 2
		if (vertical) g.position.x = -side * off
		else g.position.y = -side * off
		return group(g)
	}
	addModel("coil", "wall_plus", (ctx) => coilHalf(ctx, 1))
	addModel("coil", "wall_minus", (ctx) => coilHalf(ctx, -1))
	// the straight wire: insulated wooden clamps with a brass binding post each, the bare copper wire between them in front of the picture
	// (runs over), or the wire straight through the picture with a binding post at each end (runs through)
	const clampModel = (ctx, withWire) => {
		const P = ctx.props ?? {}
		const out = [mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0015), plywood())]
		out.push(put(mesh(kit.cylinderY(0.0035, 0.004, 16), brass()), 0, ctx.h / 2 + 0.002, 0))
		if (withWire) {
			const L = Number(P.length) || 0.3
			const z = Number(P.in_front) || 0.012
			const wire = mesh(kit.geo(`circ|straight|${f5(L)}`, () => new T.CylinderGeometry(0.000814, 0.000814, L, 12).rotateZ(Math.PI / 2)), copper())
			out.push(put(wire, -L / 2, 0, z))
			// (a short brass peg from each clamp's face out to the wire, where it stands further out than the clamp)
			if (z > ctx.d / 2) for (const x of [0, -L]) out.push(put(mesh(kit.cylinderZ(0.0012, z - ctx.d / 2, 8), brass()), x, 0, (z + ctx.d / 2) / 2))
		}
		return group(out)
	}
	addModel("straight-wire", "clamp_plus", (ctx) => clampModel(ctx, true))
	addModel("straight-wire", "clamp_minus", (ctx) => clampModel(ctx, false))
	addModel("straight-wire", "wire", (ctx) => {
		const L = ctx.d
		const out = [mesh(kit.cylinderZ(ctx.r, L, 12), copper())]
		for (const sz of [1, -1]) out.push(put(mesh(kit.cylinderZ(0.0035, 0.006, 16), brass()), 0, 0, sz * (L / 2 - 0.003)))
		return group(out)
	})

	// ------------------------------------------------------------------ the wires and the circuit board (one view plugin for the run)
	const WIRE_HEX = { red: "#c8241c", black: "#1d1f23", blue: "#2a5bd6", yellow: "#e8c13a", green: "#2c9a3a", white: "#eeeeee" }
	addViewPlugin({
		name: "circuits",
		load(ctx) {
			const rec = (ctx.doc?.processes ?? []).find((p) => p?.kind === "circuit")
			if (!rec) return null
			const G = ctx.group
			const T3 = ctx.THREE
			const solids = new Map(ctx.doc.solids.map((s) => [s.id, s]))
			const termAt = (name, t) => {
				const term = rec.terminals?.[name]
				if (!term) return null
				const p = ctx.placementAt(term.solid, t)
				if (!p) return null
				const c = Math.cos(p.angle)
				const s = Math.sin(p.angle)
				return { x: p.x + term.at.x * c - term.at.y * s, y: p.y + term.at.x * s + term.at.y * c, z: Number(term.z) || 0, solid: term.solid }
			}
			const depthOf = (sid) => {
				const s = solids.get(sid)
				if (!s) return 0.05
				return s.body.kind === "ball" ? (s.depth3d ?? 2 * s.body.radius) : (s.body.depth ?? 0.05)
			}
			// ---- the upright boards
			for (const b of rec.boards ?? []) {
				const W = b.width
				const H = b.height
				const z = -0.06
				const map = kit.tex("circ-pegboard", 512, 512, (g, w, h) => {
					g.fillStyle = "#c7a77c"
					g.fillRect(0, 0, w, h)
					g.fillStyle = "rgba(60,40,20,0.85)"
					for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) {
						g.beginPath()
						g.arc(x, y, 4.2, 0, Math.PI * 2)
						g.fill()
					}
				})
				const m = new T3.MeshPhysicalMaterial({ map, roughness: 0.75, metalness: 0 })
				m.map = map.clone()
				m.map.needsUpdate = true
				m.map.wrapS = m.map.wrapT = T3.RepeatWrapping
				m.map.repeat.set(W / 0.4, H / 0.4)
				const panel = new T3.Mesh(new T3.BoxGeometry(W, H, 0.006), m)
				panel.position.set(b.x, b.y, z)
				panel.castShadow = panel.receiveShadow = true
				G.add(panel)
				const frameM = new T3.MeshPhysicalMaterial({ color: 0x8a6239, roughness: 0.55, clearcoat: 0.4 })
				for (const [w2, h2, x2, y2] of [[W + 0.03, 0.015, 0, H / 2 + 0.0075], [W + 0.03, 0.015, 0, -H / 2 - 0.0075], [0.015, H, -W / 2 - 0.0075, 0], [0.015, H, W / 2 + 0.0075, 0]]) {
					const f = new T3.Mesh(new T3.BoxGeometry(w2, h2, 0.012), frameM)
					f.position.set(b.x + x2, b.y + y2, z)
					f.castShadow = f.receiveShadow = true
					G.add(f)
				}
				// two feet on the table, behind
				const bottom = b.y - H / 2 - 0.015
				if (bottom > 0.005)
					for (const sx of [-1, 1]) {
						const leg = new T3.Mesh(new T3.BoxGeometry(0.03, bottom, 0.03), frameM)
						leg.position.set(b.x + sx * (W / 2 - 0.05), bottom / 2, z - 0.01)
						leg.castShadow = leg.receiveShadow = true
						G.add(leg)
					}
			}
			// ---- the wires
			const wires = rec.parts.filter((p) => p.kind === "wire")
			const live = []
			const R = 0.0011 // (a 22 AWG lead in its insulation: about 2.2 mm across)
			wires.forEach((w, k) => {
				const mat = new T3.MeshPhysicalMaterial({ color: new T3.Color(WIRE_HEX[w.color] ?? "#c8241c"), roughness: 0.45, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3 })
				const tube = new T3.Mesh(new T3.BufferGeometry(), mat)
				tube.castShadow = true
				tube.receiveShadow = true
				const clipMat = new T3.MeshPhysicalMaterial({ color: new T3.Color(WIRE_HEX[w.color] ?? "#c8241c"), roughness: 0.4, clearcoat: 0.3 })
				// a crocodile clip at each end: its steel jaws on the terminal, its rubber boot leaning out along the lead
				const clips = [0, 1].map(() => {
					const c = new T3.Group()
					const jaw = new T3.Mesh(new T3.BoxGeometry(0.0032, 0.009, 0.0045), new T3.MeshPhysicalMaterial({ color: 0xc3c8ce, roughness: 0.28, metalness: 1 }))
					jaw.position.y = 0.0045
					const boot = new T3.Mesh(new T3.CylinderGeometry(0.0017, 0.0026, 0.012, 14), clipMat)
					boot.position.y = 0.0145
					c.add(jaw, boot)
					c.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)))
					return c
				})
				G.add(tube, ...clips)
				live.push({ w, k, tube, clips, key: "" })
			})
			const hidden = (w) => /\/loose-[ab]$/.test(w.a) && /\/loose-[ab]$/.test(w.b)
			const offAt = (w, t) => (Number(ctx.stateAt(w.item, "off", t)) || 0) > 0.5
			const frame = (t) => {
				for (const L of live) {
					const { w, tube, clips } = L
					if (hidden(w)) {
						tube.visible = false
						for (const c of clips) c.visible = false
						continue
					}
					let a = /\/loose-/.test(w.a) ? null : termAt(w.a, t)
					let b = /\/loose-/.test(w.b) ? null : termAt(w.b, t)
					const off = offAt(w, t)
					// a free end hangs down near the other: on the table a few centimetres away; a pulled-off end drops from where it was
					if (!a && b) a = { x: b.x + 0.06, y: 0.003, free: true }
					if (!b && a) b = { x: a.x - 0.06, y: 0.003, free: true }
					if (!a || !b) continue
					if (off) b = { x: b.x + 0.025, y: 0.003, free: true }
					const key = `${a.x.toFixed(4)}|${a.y.toFixed(4)}|${(a.z ?? 0).toFixed(4)}|${b.x.toFixed(4)}|${b.y.toFixed(4)}|${(b.z ?? 0).toFixed(4)}`
					if (key === L.key) continue
					L.key = key
					// which lane: straight between neighbours; behind the parts it passes (another circuit part between its ends along x)
					const lo = Math.min(a.x, b.x)
					const hi = Math.max(a.x, b.x)
					let deepest = 0
					for (const s of ctx.doc.solids) {
						if (s.itemType === "table" || s.itemType === "wall") continue
						const p = ctx.placementAt(s.id, t)
						if (!p || p.x <= lo + 0.01 || p.x >= hi - 0.01) continue
						if (s.id === a.solid || s.id === b.solid) continue
						deepest = Math.max(deepest, depthOf(s.id))
					}
					const lane = deepest > 0 ? -(deepest / 2 + 0.012 + 0.006 * (L.k % 3)) : 0.004 * ((L.k % 3) - 1)
					// each clip leans 35° toward the other end; the lead leaves its boot's tip
					const tilt = 35 * (Math.PI / 180)
					const dir = Math.sign(b.x - a.x) || 1
					const tipOf = (q, s2) => (q.free ? { x: q.x, y: q.y, z: q.z ?? 0 } : { x: q.x + s2 * Math.sin(tilt) * 0.02, y: q.y + Math.cos(tilt) * 0.02, z: q.z ?? 0 })
					const A = tipOf(a, dir)
					const B = tipOf(b, -dir)
					const chord = Math.hypot(B.x - A.x, B.y - A.y)
					const len = Math.max(chord, (w.length ?? chord * 1.3 + 0.05) - 0.04)
					// a hanging lead: a parabola of the right length (s = √(3c(L − c)/8)), lying on the table where it would reach below it
					const sag = Math.sqrt(Math.max(0, (3 * Math.max(chord, 0.01) * Math.max(0, len - chord)) / 8))
					const pts = []
					const N = 32
					for (let i = 0; i <= N; i++) {
						const u = i / N
						const x = A.x + (B.x - A.x) * u
						let y = A.y + (B.y - A.y) * u - 4 * sag * u * (1 - u)
						y = Math.max(R + 0.0005, y)
						// (an end on a terminal out of the picture's plane, a straight wire's front or back end: the lead runs out to it)
						const zz = lane * Math.min(1, Math.min(u, 1 - u) * 5) + A.z * (1 - u) + B.z * u
						pts.push(new T3.Vector3(x, y, zz))
					}
					// (out of each boot along its lean before it falls away)
					pts.splice(1, 0, new T3.Vector3(A.x + (a.free ? 0 : dir * Math.sin(tilt) * 0.006), A.y + (a.free ? 0 : Math.cos(tilt) * 0.006), A.z))
					pts.splice(pts.length - 1, 0, new T3.Vector3(B.x - (b.free ? 0 : dir * Math.sin(tilt) * 0.006), B.y + (b.free ? 0 : Math.cos(tilt) * 0.006), B.z))
					tube.geometry.dispose()
					tube.geometry = new T3.TubeGeometry(new T3.CatmullRomCurve3(pts), 96, R, 7, false)
					clips[0].position.set(a.x, a.y, a.z ?? 0)
					clips[1].position.set(b.x, b.y, b.z ?? 0)
					clips[0].rotation.z = a.free ? (Math.PI / 2) * dir : -dir * tilt
					clips[1].rotation.z = b.free ? -(Math.PI / 2) * dir : dir * tilt
				}
			}
			frame(0)
			return {
				frame,
				dispose() {
					for (const L of live) L.tube.geometry.dispose()
				}
			}
		}
	})
}
