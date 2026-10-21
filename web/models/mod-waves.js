// 3D models and view plugins of the waves module (machines/mod_waves.py, web/sim/modules/waves.js, tooling/src/sim/modules/waves.ts).
// Models fill their parts' physics outlines (see web/models3d.js); what moves without a body of its own is drawn from the run's readings:
//   frame hooks   waves:lcd (a sound meter's display), waves:ruler (a plucked ruler's blur), waves:string (a string's or band's blur),
//                 waves:clap (a clapper's boards), waves:driver (a wave driver's arm), waves:beater (a drum's beater)
//   view plugins  waves:sound-lines  faint arcs spreading from each sounding source (spacing ∝ its wavelength, scaled to be seen; fading with
//                                    its level; a picture of sound spreading, not a pressure map)
//                 waves:lines        a wave rope and a Slinky, shaped by the readings d0 … dK every frame, with the ribbon
//                 waves:tank         a ripple tank's water surface (the module's linear wave field, recomputed here for the picture), its
//                                    dipper and its floater (moved by its readings floater_x / floater_y)
//                 waves:labels       a big reading over each sound meter, legible in a wide shot (drawn in exports too)
//   string telephone (engine6 crossmod): two paper cups lying along the picture, their mouths outward, the string between their bottoms
//                 hanging in its sag (the string solid's `sag`), a clothes peg on it when pinched; the sound lines also spread from
//                 the far cup while the string carries the voice (0.7 as strong as the talking cup's: a picture, not its level)
export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const T = THREE
	const MAT = (key, p) => {
		const m = new T.MeshPhysicalMaterial(p)
		m.name = key
		return m
	}
	const cache = new Map()
	const once = (key, make) => {
		if (!cache.has(key)) cache.set(key, make())
		return cache.get(key)
	}
	const mesh = (g, m, cast = true) => kit.mesh(g, m, { cast })
	const box = (w, h, d, r = 0.0015) => kit.box(w, h, d, Math.min(r, w / 2.2, h / 2.2, d / 2.2))
	const polished = () => kit.metal("#d9dde2", { roughness: 0.12, key: "waves-polished" })
	const darkSteel = () => kit.metal("#5d636b", { roughness: 0.35, key: "waves-dark" })
	const lightWood = () => kit.wood("#c99a62", { roughness: 0.5, varnish: 0.5 })
	const darkWood = () => kit.wood("#6b4426", { roughness: 0.45, varnish: 0.7 })
	const blackPlastic = () => kit.plastic("#1d1f22", { gloss: 0.4, key: "waves-black" })
	/** When a source is struck by its own settings (strike_at, hits × every): what moves its beater. */
	const strikeTimes = (props) => Array.from({ length: Math.max(1, Math.trunc(props.hits ?? 1)) }, (_, k) => (props.strike_at ?? 0.5) + k * (props.every ?? 1))
	/**
	 * A beater on a small stand (render only: the strike itself is the module's; this shows what struck it): a stick from `pivot` to `tip` (in the
	 * part's frame) with a head, held up `rest` radians before a strike, swung down onto the tip point at each strike time and back up after it.
	 * The stand is a thin rod from `foot` (on the table, in the part's frame) up to the pivot, behind the item (z < 0).
	 */
	const beater = ({ pivot, tip, foot, rest, head = "felt", times, z = -0.04 }) => {
		const g = new T.Group()
		const len = Math.hypot(tip[0] - pivot[0], tip[1] - pivot[1])
		const ang = Math.atan2(tip[1] - pivot[1], tip[0] - pivot[0])
		const post = mesh(kit.cylinderY(0.004, Math.max(0.01, pivot[1] - foot[1]), 12), darkSteel())
		post.position.set(pivot[0], (pivot[1] + foot[1]) / 2, z)
		g.add(post)
		const base = mesh(kit.cylinderY(0.03, 0.008, 24), darkSteel())
		base.position.set(pivot[0], foot[1] + 0.004, z)
		g.add(base)
		const arm = new T.Group()
		arm.position.set(pivot[0], pivot[1], z)
		const stick = mesh(kit.cylinderY(0.0035, len, 12).clone().rotateZ(-Math.PI / 2).translate(len / 2, 0, 0), lightWood())
		arm.add(stick)
		const knob = head === "rubber" ? mesh(kit.cylinderZ(0.011, 0.02, 20), kit.rubber("#2b2b2b")) : mesh(kit.sphere(0.012, 20, 14), kit.fabric(head === "felt" ? "#ece6d6" : "#8a1c1c"))
		knob.position.set(len, 0, 0)
		arm.add(knob)
		arm.rotation.z = ang + rest
		arm.userData.frame = { hook: "waves:beater", ang, rest, times }
		g.add(arm)
		return g
	}
	addFrameHook("waves:beater", (obj, f, a) => {
		// raised by `rest` before; swung down over 0.15 s onto the strike (accelerating), back up over 0.35 s
		let lift = a.rest
		for (const ts of a.times) {
			const u = f.t - ts
			if (u >= -0.15 && u < 0) lift = Math.min(lift, a.rest * (1 - ((u + 0.15) / 0.15) ** 2))
			else if (u >= 0 && u < 0.35) lift = Math.min(lift, a.rest * Math.sin((Math.PI / 2) * (u / 0.35)))
		}
		obj.rotation.z = a.ang + lift
	})

	// ============================================================== tuning fork
	addModel("tuning-fork", "box", ({ w, h, d, props }) => {
		if (!props.box) return mesh(box(w, h, d, 0.003), lightWood())
		// a quarter-wave resonance box: five thin walls, open at its right end (dark inside), a block on top that the stem plugs into
		const t = 0.006
		const wood = lightWood()
		const g = kit.group(
			mesh(box(w, t, d), wood).translateY(h / 2 - t / 2),
			mesh(box(w, t, d), wood).translateY(-h / 2 + t / 2),
			mesh(box(w, h, t), wood).translateZ(d / 2 - t / 2),
			mesh(box(w, h, t), wood).translateZ(-d / 2 + t / 2),
			mesh(box(t, h, d), wood).translateX(-w / 2 + t / 2)
		)
		const inside = mesh(box(0.002, h - 2 * t, d - 2 * t), kit.mat("waves-dark-inside", { color: "#120b06", roughness: 1 }), false)
		inside.position.x = w / 2 - 0.02
		g.add(inside)
		const block = mesh(box(0.03, 0.012, 0.03), darkWood())
		block.position.y = h / 2 - 0.006
		g.add(block)
		return g
	})
	addModel("tuning-fork", "stem", ({ h }) => {
		const g = kit.group(mesh(kit.cylinderY(0.004, h, 24), polished()))
		const ball = mesh(kit.sphere(0.0048, 24, 12), polished())
		ball.position.y = -h / 2 + 0.003
		g.add(ball)
		return g
	})
	addModel("tuning-fork", "yoke", ({ w, h }) => {
		// the U-bend joining the prongs: half a torus through the prongs' middles
		const R = w / 2 - 0.003
		const tor = new T.TorusGeometry(R, 0.0032, 12, 32, Math.PI)
		tor.rotateZ(Math.PI)
		const m = mesh(kit.geo(`waves-yoke|${R.toFixed(5)}`, () => tor), polished())
		m.position.y = h / 2
		return m
	})
	const prong = ({ w, h, d }) => {
		const m = mesh(box(w, h, d, 0.0025), polished())
		return m
	}
	addModel("tuning-fork", "prong-left", prong)
	addModel("tuning-fork", "prong-right", (ctx) => {
		const g = kit.group(prong(ctx))
		const { w, h, props } = ctx
		const base = (props.box ? 0.075 : 0.025) + 0.055 + 0.008
		// a rubber mallet on a stand to the right, swung up and over onto the prong's outer face near its tip
		g.add(beater({ pivot: [0.13, h / 2 - 0.02], tip: [w / 2 + 0.012, h / 2 - 0.015], foot: [0.13, -h / 2 - base], rest: -0.7, head: "rubber", times: strikeTimes(props), z: 0 }))
		return g
	})

	// ============================================================== plucked ruler
	const rulerMat = (kind) =>
		once(`ruler|${kind}`, () => {
			const map = kit.tex(`waves-ruler-${kind}`, 2048, 128, (g, W, H) => {
				g.fillStyle = kind === "plastic" ? "rgba(200,230,250,0.0)" : kind === "steel" ? "#c8cdd3" : "#d9b07a"
				g.fillRect(0, 0, W, H)
				g.fillStyle = kind === "plastic" ? "#0c2b45" : "#1a1a1a"
				g.font = "600 30px Helvetica, Arial, sans-serif"
				g.textAlign = "center"
				for (let mm = 0; mm <= 300; mm++) {
					const x = (mm / 300) * W
					const len = mm % 10 === 0 ? 0.42 : mm % 5 === 0 ? 0.3 : 0.18
					g.fillRect(x - 1, 0, 2, H * len)
					if (mm % 10 === 0 && mm > 0 && mm < 300) g.fillText(String(mm / 10), x, H * 0.78)
				}
			}, { wrap: false })
			if (kind === "plastic") return MAT("waves-ruler-plastic", { map, transparent: true, color: "#bfe3f7", roughness: 0.08, metalness: 0, transmission: 0.55, thickness: 0.003, ior: 1.49, clearcoat: 1 })
			if (kind === "steel") return MAT("waves-ruler-steel", { map, color: "#ffffff", roughness: 0.22, metalness: 0.9 })
			return MAT("waves-ruler-wood", { map, color: "#ffffff", roughness: 0.5, metalness: 0, clearcoat: 0.4 })
		})
	addModel("plucked-ruler", "ruler", ({ w, h, d, props }) => {
		const kind = props.ruler ?? "plastic"
		const g = kit.group(mesh(box(w, h, d, 0.0008), rulerMat(kind)))
		// two ghosts of the overhang, swung up and down by the vibration's amplitude (a blur, as the eye sees a buzzing ruler)
		const L = props.overhang ?? 0.15
		const side = props.edge === "left" ? -1 : 1
		const edge = side * (w / 2 - L)
		for (const sgn of [1, -1]) {
			const pivot = new T.Group()
			pivot.position.x = edge
			const ghost = mesh(box(L, h, d * 0.98, 0.0006), rulerMat(kind), false)
			ghost.position.x = (side * L) / 2
			ghost.visible = false
			pivot.add(ghost)
			pivot.userData.frame = { hook: "waves:ruler", sgn, L }
			g.add(pivot)
		}
		return g
	})
	addFrameHook("waves:ruler", (obj, f, args) => {
		const amp = (f.state.amp_mm ?? 0) / 1000
		const ghost = obj.children[0]
		if (!ghost) return
		if (amp < 0.0003) {
			ghost.visible = false
			return
		}
		ghost.visible = true
		obj.rotation.z = args.sgn * Math.atan(amp / args.L)
		const m = ownMaterial(ghost)
		m.transparent = true
		m.opacity = Math.min(0.45, 0.12 + (amp / 0.02) * 0.3)
		m.depthWrite = false
	})
	addModel("plucked-ruler", "clamp", ({ w, h, d }) => {
		// a red C-clamp's jaw pressing the ruler down; its frame curls under the table's edge out of sight
		const red = kit.plastic("#c62828", { gloss: 0.6, key: "waves-clamp" })
		const g = kit.group(mesh(box(w, h * 0.45, d), red).translateY(h * 0.275))
		const screw = mesh(kit.cylinderY(0.004, h * 0.6, 16), polished())
		screw.position.y = -h * 0.15
		g.add(screw)
		const pad = mesh(kit.cylinderY(0.009, 0.003, 24), darkSteel())
		pad.position.y = -h / 2 + 0.0015
		g.add(pad)
		return g
	})

	// ============================================================== drum
	addModel("drum", "shell", ({ w, h, props, color }) => {
		const R = w / 2
		// lacquered red, or the colour the item is painted (the catalog-wide `color`)
		const paint = props.color && props.color !== "none" ? color : "#9c1c22"
		const lacquer = kit.mat(`waves-drum-shell|${paint}`, { color: paint, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 })
		const g = kit.group(mesh(kit.cylinderY(R - 0.002, h - 0.01, 64), lacquer))
		// the bottom hoop and the tension lugs round the shell
		const hoop = mesh(kit.torus(R - 0.001, 0.005, 10, 64).rotateX(Math.PI / 2), polished())
		hoop.position.y = -h / 2 + 0.005
		g.add(hoop)
		const n = Math.max(6, Math.round((2 * Math.PI * R) / 0.11))
		for (let i = 0; i < n; i++) {
			const a = (i / n) * Math.PI * 2
			const lug = mesh(box(0.012, Math.min(0.06, h * 0.4), 0.014, 0.004), polished())
			lug.position.set(Math.cos(a) * (R + 0.002), h * 0.1, Math.sin(a) * (R + 0.002))
			lug.rotation.y = -a
			g.add(lug)
			const rod = mesh(kit.cylinderY(0.0015, h * 0.45, 8), polished())
			rod.position.set(Math.cos(a) * (R + 0.004), h * 0.27, Math.sin(a) * (R + 0.004))
			g.add(rod)
		}
		return g
	})
	const headTex = () =>
		kit.tex("waves-drumhead", 512, 512, (g, W, H) => {
			g.fillStyle = "#f1ece0"
			g.fillRect(0, 0, W, H)
			for (let i = 0; i < 3000; i++) {
				const x = (Math.sin(i * 12.9898) * 43758.5453) % 1
				const y = (Math.sin(i * 78.233) * 12345.6789) % 1
				g.fillStyle = `rgba(${200 + (i % 30)},${190 + (i % 25)},${170 + (i % 20)},0.25)`
				g.fillRect(Math.abs(x) * W, Math.abs(y) * H, 2, 2)
			}
			g.strokeStyle = "rgba(120,110,90,0.35)"
			g.lineWidth = 3
			g.beginPath()
			g.arc(W / 2, H / 2, W * 0.47, 0, Math.PI * 2)
			g.stroke()
		})
	addModel("drum", "head", ({ w, h, props }) => {
		const g = kit.group(mesh(kit.cylinderY(w / 2 - 0.003, h, 64), MAT("waves-head", { map: headTex(), roughness: 0.7, metalness: 0 })))
		const R = w / 2
		const at = { middle: 0, halfway: -R / 2, "near the rim": -0.8 * R }[props.strike_where ?? "halfway"] ?? -R / 2
		// a drumstick on a stand behind the drum, its tip coming down on the head where it is struck
		g.add(beater({ pivot: [-R - 0.06, 0.16], tip: [at, h / 2 + 0.012], foot: [-R - 0.06, -(props.height ?? 0.16) + 0.001], rest: 0.5, head: "wood", times: strikeTimes(props), z: -R * 0.6 }))
		return g
	})
	addModel("drum", "rim-left", ({ props }) => {
		const R = (props.diameter ?? 0.3) / 2
		const m = mesh(kit.torus(R - 0.006, 0.006, 12, 72).rotateX(Math.PI / 2), polished())
		// (this part's origin is at the rim's left end: the hoop's middle is the drum's axis, R − 6 mm to the right)
		m.position.x = R - 0.006
		return m
	})
	addModel("drum", "rim-right", null)

	// ============================================================== rice
	const riceMat = () => kit.mat("waves-rice", { color: "#f4eedc", roughness: 0.45, metalness: 0, clearcoat: 0.3, transmission: 0.15, thickness: 0.002 })
	addModel("rice", "*", ({ r }) => {
		const g = kit.geo(`waves-grain|${r.toFixed(5)}`, () => new T.SphereGeometry(r, 16, 10).scale(1.5, 0.85, 0.85))
		return mesh(g, riceMat())
	})

	// ============================================================== sound level meter
	addModel("sound-meter", "tripod", ({ w, h }) => {
		const g = new T.Group()
		const legM = darkSteel()
		const col = mesh(kit.cylinderY(0.006, h, 16), legM)
		g.add(col)
		for (let i = 0; i < 3; i++) {
			const a = (i / 3) * Math.PI * 2 + 0.4
			const foot = new T.Vector3(Math.cos(a) * (w / 2 - 0.004), -h / 2, Math.sin(a) * (w / 2 - 0.004))
			const top = new T.Vector3(0, -h / 2 + Math.min(0.08, h * 0.6), 0)
			const len = foot.distanceTo(top)
			const leg = mesh(kit.cylinderY(0.003, len, 10), legM)
			leg.position.copy(foot).add(top).multiplyScalar(0.5)
			leg.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), top.clone().sub(foot).normalize())
			g.add(leg)
		}
		const head = mesh(kit.cylinderY(0.012, 0.012, 16), blackPlastic())
		head.position.y = h / 2 - 0.006
		g.add(head)
		return g
	})
	addModel("sound-meter", "body", ({ w, h, d }) => {
		const shell = kit.plastic("#f2c230", { gloss: 0.5, key: "waves-meter" })
		const g = kit.group(mesh(box(w, h, d, 0.006), shell))
		const bezel = mesh(box(w * 0.82, h * 0.4, 0.002, 0.002), blackPlastic())
		bezel.position.set(0, h * 0.18, d / 2)
		g.add(bezel)
		// the display: its own canvas (the reading changes every frame), drawn by the waves:lcd hook
		const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 128) : document.createElement("canvas")
		canvas.width = 256
		canvas.height = 128
		const tex = new T.CanvasTexture(canvas)
		tex.colorSpace = T.SRGBColorSpace
		const lcd = new T.Mesh(new T.PlaneGeometry(w * 0.74, h * 0.33), new T.MeshBasicMaterial({ map: tex, toneMapped: false }))
		lcd.position.set(0, h * 0.18, d / 2 + 0.0012)
		lcd.userData.frame = { hook: "waves:lcd" }
		g.add(lcd)
		for (const [x, c] of [[-0.018, "#c62828"], [0, "#2e7d32"], [0.018, "#1565c0"]]) {
			const b = mesh(kit.cylinderZ(0.0045, 0.003, 16), kit.plastic(c, { gloss: 0.6, key: `waves-btn${c}` }))
			b.position.set(x, -h * 0.22, d / 2 + 0.0015)
			g.add(b)
		}
		const neck = mesh(kit.cylinderY(0.007, 0.03, 16), blackPlastic())
		neck.position.y = h / 2 + 0.012
		g.add(neck)
		return g
	})
	// A display's own canvas: a model's instances are clones of one prototype (web/models3d.js) sharing its materials and textures, so two
	// meters with the same settings would show one reading between them. Each display gets its own canvas and texture on its first frame
	// (the texture let go with its display: when the run's parts are dropped and collected).
	const ownDisplays = new WeakMap()
	const dropTexture = typeof FinalizationRegistry !== "undefined" ? new FinalizationRegistry((tex) => tex.dispose()) : null
	const ownCanvas = (obj) => {
		let tex = ownDisplays.get(obj)
		if (!tex) {
			const src = obj.material.map.image
			const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(src.width, src.height) : document.createElement("canvas")
			cv.width = src.width
			cv.height = src.height
			tex = new T.CanvasTexture(cv)
			tex.colorSpace = T.SRGBColorSpace
			const m = ownMaterial(obj)
			m.map = tex
			m.needsUpdate = true
			ownDisplays.set(obj, tex)
			dropTexture?.register(obj, tex)
		}
		return tex
	}
	const lcdText = (obj, text, sub) => {
		const tex = ownCanvas(obj)
		const canvas = tex.image
		if (obj.userData.shown === text + sub) return
		obj.userData.shown = text + sub
		const g = canvas.getContext("2d")
		g.fillStyle = "#b9c7a3"
		g.fillRect(0, 0, 256, 128)
		g.fillStyle = "#1f2a17"
		g.font = "bold 70px 'Courier New', monospace"
		g.textAlign = "right"
		g.textBaseline = "middle"
		g.fillText(text, 200, 56)
		g.font = "bold 26px Helvetica, Arial, sans-serif"
		g.fillText(sub, 248, 106)
		tex.needsUpdate = true
	}
	addFrameHook("waves:lcd", (obj, f) => {
		const db = f.state.level
		lcdText(obj, Number.isFinite(db) ? db.toFixed(1) : "--.-", "dB")
	})
	addModel("sound-meter", "mic", ({ r }) => mesh(kit.sphere(r, 24, 16), kit.fabric("#5a5d61")))

	// ============================================================== hydrophone: a probe on its cable from a lab stand's arm, its meter box at the foot
	addModel("hydrophone", "rod", ({ w, h }) => {
		const g = kit.group(mesh(kit.cylinderY(w / 2, h, 16), polished()))
		const foot = mesh(box(0.12, 0.012, 0.09, 0.003), darkSteel())
		foot.position.y = -h / 2 + 0.006
		g.add(foot)
		return g
	})
	addModel("hydrophone", "arm", ({ w, h, props }) => {
		const g = kit.group(mesh(kit.cylinderX ? kit.cylinderX(h / 2, w, 12) : new T.CylinderGeometry(h / 2, h / 2, w, 12).rotateZ(Math.PI / 2), polished()))
		const boss = mesh(box(0.03, 0.03, 0.03, 0.004), darkSteel())
		boss.position.x = -w / 2
		g.add(boss)
		// the probe's cable, from the arm's end down to the probe
		const drop = Math.max(0.01, (Math.max((props.probe_height ?? 0.08) + 0.12, props.arm_height ?? 0.4) - 0.005) - (props.probe_height ?? 0.08) - 0.008)
		const cable = mesh(kit.cylinderY(0.0016, drop, 8), kit.rubber("#111"))
		cable.position.set(w / 2, -drop / 2, 0)
		g.add(cable)
		return g
	})
	addModel("hydrophone", "probe", ({ r }) => {
		const g = kit.group(mesh(kit.cylinderY(r, r * 3, 20), kit.rubber("#1b1d20")))
		const tip = mesh(kit.sphere(r, 20, 12), kit.rubber("#1b1d20"))
		tip.position.y = -r * 1.5
		g.add(tip)
		return g
	})
	addModel("hydrophone", "display", ({ w, h, d }) => {
		const g = kit.group(mesh(box(w, h, d, 0.006), kit.plastic("#2c5d8f", { gloss: 0.5, key: "waves-hydro" })))
		const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 128) : document.createElement("canvas")
		canvas.width = 256
		canvas.height = 128
		const tex = new T.CanvasTexture(canvas)
		tex.colorSpace = T.SRGBColorSpace
		const lcd = new T.Mesh(new T.PlaneGeometry(w * 0.8, h * 0.6), new T.MeshBasicMaterial({ map: tex, toneMapped: false }))
		lcd.position.set(0, 0, d / 2 + 0.0012)
		lcd.userData.frame = { hook: "waves:lcd" }
		g.add(lcd)
		return g
	})

	// ============================================================== oscilloscope: a bench scope whose screen draws the microphone's sound wave
	// (10 × 8 squares; the trace from the microphone's readings by the waves:scope hook: height ∝ the sound pressure, waves across ∝ the pitch)
	const SCOPE_W = 512
	const SCOPE_H = 410
	const scopeTime = (props) => (parseFloat(props.time_base ?? "1 ms a square") || 1) / 1000 // (seconds a square, from its choice's words)
	const scopePa = (props) => parseFloat(props.scale ?? "0.1 Pa a square") || 0.1 // (pascals a square)
	/** The screen: its graticule and the trace, `amp` squares high (up from the middle line) with `cycles` waves across its 10 squares. */
	const drawScope = (g, amp, cycles, tb, pa, f0) => {
		const W = SCOPE_W
		const H = SCOPE_H
		const sq = W / 10
		g.fillStyle = "#07130d"
		g.fillRect(0, 0, W, H)
		g.strokeStyle = "rgba(120, 200, 150, 0.28)"
		g.lineWidth = 1.5
		g.beginPath()
		for (let i = 1; i < 10; i++) {
			g.moveTo(i * sq, 0)
			g.lineTo(i * sq, H)
		}
		for (let j = 1; j < 8; j++) {
			g.moveTo(0, j * sq)
			g.lineTo(W, j * sq)
		}
		g.stroke()
		g.strokeStyle = "rgba(140, 220, 170, 0.5)"
		g.beginPath()
		g.moveTo(0, H / 2)
		g.lineTo(W, H / 2)
		g.moveTo(W / 2, 0)
		g.lineTo(W / 2, H)
		g.stroke()
		const a = Math.max(-4.15, Math.min(4.15, amp)) * sq // (a trace taller than the screen runs off its edges)
		g.strokeStyle = "#7dffa8"
		g.fillStyle = "rgba(125, 255, 168, 0.55)"
		g.lineWidth = 4
		g.shadowColor = "#3dff7a"
		g.shadowBlur = 10
		if (cycles > 80) g.fillRect(0, H / 2 - Math.abs(a), W, 2 * Math.abs(a) + 2) // (too many waves to tell apart: a band, as a real scope shows)
		else {
			g.beginPath()
			const n = 600
			for (let k = 0; k <= n; k++) {
				const x = (k / n) * W
				const y = H / 2 - a * Math.sin(2 * Math.PI * cycles * (k / n))
				if (k === 0) g.moveTo(x, y)
				else g.lineTo(x, y)
			}
			g.stroke()
		}
		g.shadowBlur = 0
		g.fillStyle = "rgba(170, 240, 190, 0.85)"
		g.font = "bold 22px Helvetica, Arial, sans-serif"
		g.textBaseline = "bottom"
		g.textAlign = "left"
		g.fillText(`${tb >= 0.001 ? tb * 1000 : tb * 1e6} ${tb >= 0.001 ? "ms" : "µs"}/sq   ${pa} Pa/sq`, 10, H - 6)
		g.textAlign = "right"
		g.textBaseline = "top"
		if (f0 > 0) g.fillText(`${f0 >= 100 ? f0.toFixed(0) : f0.toFixed(1)} Hz`, W - 10, 8)
	}
	addModel("oscilloscope", "body", ({ w, h, d, props }) => {
		const g = kit.group(mesh(box(w, h, d, 0.01), kit.plastic("#cfd4d8", { gloss: 0.35, key: "waves-scope-case" })))
		const face = mesh(box(w - 0.016, h - 0.016, 0.004, 0.002), kit.plastic("#2a2e33", { gloss: 0.45, key: "waves-scope-face" }))
		face.position.z = d / 2 + 0.001
		g.add(face)
		// the screen (10 × 8 squares, 1.5 cm each) on the left of the face; its own canvas, redrawn by the waves:scope hook
		const sw = 0.15
		const sh = 0.12
		const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(SCOPE_W, SCOPE_H) : document.createElement("canvas")
		canvas.width = SCOPE_W
		canvas.height = SCOPE_H
		const tb = scopeTime(props)
		const pa = scopePa(props)
		drawScope(canvas.getContext("2d"), 0, 0, tb, pa, 0)
		const tex = new T.CanvasTexture(canvas)
		tex.colorSpace = T.SRGBColorSpace
		const screen = new T.Mesh(new T.PlaneGeometry(sw, sh), new T.MeshBasicMaterial({ map: tex, toneMapped: false }))
		screen.position.set(-w / 2 + 0.014 + sw / 2, 0.004, d / 2 + 0.0034)
		screen.userData.frame = { hook: "waves:scope", tb, pa }
		g.add(screen)
		const rim = mesh(box(sw + 0.008, sh + 0.008, 0.003, 0.0015), blackPlastic())
		rim.position.set(screen.position.x, screen.position.y, d / 2 + 0.0018)
		g.add(rim)
		// its knobs (time a square, pressure a square, position) and the microphone's socket, right of the screen
		const kx = -w / 2 + 0.014 + sw + 0.035
		for (const [x, y, r] of [[kx, 0.035, 0.011], [kx + 0.045, 0.035, 0.011], [kx, -0.01, 0.008], [kx + 0.045, -0.01, 0.008]]) {
			const k = mesh(kit.cylinderZ(r, 0.012, 24), kit.plastic("#e8e8e4", { gloss: 0.5, key: "waves-scope-knob" }))
			k.position.set(x, y, d / 2 + 0.009)
			g.add(k)
		}
		const bnc = mesh(kit.cylinderZ(0.006, 0.012, 16), polished())
		bnc.position.set(kx + 0.022, -0.045, d / 2 + 0.009)
		g.add(bnc)
		for (const sx of [-1, 1]) {
			const foot = mesh(box(0.03, 0.008, d * 0.8, 0.002), kit.rubber("#1b1b1b"))
			foot.position.set(sx * (w / 2 - 0.03), -h / 2 + 0.004, 0)
			g.add(foot)
		}
		return g
	})
	addFrameHook("waves:scope", (obj, f, a) => {
		// the wave's height: the microphone's level as a pressure (20 µPa · 10^(L/20) rms, × √2 at a sine's peak) in squares; its waves
		// across: the pitch × the screen's 10 squares of time. Nothing over the quiet room: a flat line.
		const L = f.state.level
		const f0 = f.state.pitch
		const on = Number.isFinite(L) && Number.isFinite(f0) && f0 > 0
		const amp = on ? (Math.SQRT2 * 2e-5 * Math.pow(10, L / 20)) / a.pa : 0
		const cycles = on ? f0 * 10 * a.tb : 0
		const key = `${amp.toFixed(3)}|${cycles.toFixed(3)}`
		const tex = ownCanvas(obj)
		if (obj.userData.shown === key) return
		obj.userData.shown = key
		drawScope(tex.image.getContext("2d"), amp, cycles, a.tb, a.pa, on ? f0 : 0)
		tex.needsUpdate = true
	})
	addModel("oscilloscope", "stand", ({ w, h, props }) => {
		const g = kit.group(mesh(kit.cylinderY(w / 2, h, 12), darkSteel()))
		const base = mesh(kit.cylinderY(0.025, 0.008, 24), darkSteel())
		base.position.y = -h / 2 + 0.004
		g.add(base)
		// the microphone's cable, along the table to the scope's side (the scope's middle is 21 cm away, its side 6 cm)
		const toward = (props.mic_side ?? "right") === "right" ? -1 : 1
		const cable = mesh(kit.cylinderX ? kit.cylinderX(0.002, 0.06, 8) : new T.CylinderGeometry(0.002, 0.002, 0.06, 8).rotateZ(Math.PI / 2), kit.rubber("#111"))
		cable.position.set(toward * 0.03, -h / 2 + 0.002, 0.02)
		g.add(cable)
		return g
	})
	addModel("oscilloscope", "mic", ({ r }) => mesh(kit.sphere(r, 24, 16), kit.fabric("#3d4045")))

	// ============================================================== sound panel
	addModel("sound-panel", "panel", ({ w, h, d, props }) => {
		const s = props.surface ?? "foam"
		if (s === "foam") {
			// wedge foam: a grey board with rows of wedges facing the room (both faces)
			const foam = kit.mat("waves-foam", { color: "#3b4148", roughness: 1, metalness: 0, sheen: 0.4, sheenColor: "#59606a" })
			const g = kit.group(mesh(box(w * 0.5, h, d, 0.003), foam))
			const rows = Math.max(2, Math.round(h / 0.05))
			for (const side of [-1, 1]) {
				const prism = kit.geo(`waves-wedge|${(w * 0.25).toFixed(4)}|${(h / rows).toFixed(4)}|${d.toFixed(3)}`, () => {
					const sh = new T.Shape()
					const hw = h / rows
					sh.moveTo(0, -hw / 2)
					sh.lineTo(w * 0.25, 0)
					sh.lineTo(0, hw / 2)
					sh.closePath()
					return new T.ExtrudeGeometry(sh, { depth: d * 0.98, bevelEnabled: false }).translate(0, 0, -d * 0.49)
				})
				for (let i = 0; i < rows; i++) {
					const m = mesh(prism, foam)
					m.position.set(side * w * 0.25, -h / 2 + (i + 0.5) * (h / rows), 0)
					if (side < 0) m.rotation.y = Math.PI
					g.add(m)
				}
			}
			return g
		}
		if (s === "curtain") {
			const cloth = kit.fabric("#6d1d2b")
			const g = new T.Group()
			const folds = Math.max(4, Math.round(d / 0.06))
			for (let i = 0; i < folds; i++) {
				const m = mesh(kit.cylinderY(w / 2, h, 12), cloth)
				m.scale.z = d / folds / w
				m.position.z = -d / 2 + (i + 0.5) * (d / folds)
				g.add(m)
			}
			return g
		}
		if (s === "cork board") return mesh(box(w, h, d, 0.003), kit.mat("waves-cork", { color: "#b9875a", roughness: 0.95, metalness: 0 }))
		return mesh(box(w, h, d, 0.003), kit.fabric("#5b6b7a"))
	})

	// ============================================================== monochord
	addModel("monochord", "box", ({ w, h, d }) => {
		const g = kit.group(mesh(box(w, h, d, 0.004), lightWood()))
		const hole = mesh(kit.cylinderZ(0.022, 0.002, 40), kit.mat("waves-hole", { color: "#140c06", roughness: 1 }), false)
		hole.position.set(0, 0, d / 2 + 0.0006)
		g.add(hole)
		const peg = mesh(kit.cylinderZ(0.006, 0.05, 16), darkSteel())
		peg.position.set(w / 2 - 0.03, h / 2 + 0.008, 0)
		g.add(peg)
		const pin = mesh(kit.cylinderY(0.004, 0.02, 12), polished())
		pin.position.set(-w / 2 + 0.03, h / 2 + 0.008, 0)
		g.add(pin)
		return g
	})
	const bridge = ({ body }) => {
		const pts = body.points.map((p) => [p.x, p.y])
		return mesh(kit.extrude(pts, 0.05, { bevel: 0.001, key: `waves-bridge|${JSON.stringify(pts)}` }), darkWood())
	}
	addModel("monochord", "bridge-left", bridge)
	addModel("monochord", "bridge-right", bridge)
	const stringModel = ({ w, h, props }, kind) => {
		// (drawn at least 0.6 mm thick, 1.5 mm for a band: a real string is that thin, but a hair would vanish in a wide shot)
		const r = Math.max(kind === "rubber" ? 0.0015 : 0.0006, h / 2)
		const mat = kind === "rubber" ? kit.rubber("#c0392b") : props.string === "nylon" ? kit.plastic("#f3f0e6", { gloss: 0.8, key: "waves-nylon" }) : polished()
		const g = kit.group(mesh(kit.cylinderX ? kit.cylinderX(r, w, 12) : new T.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2), mat))
		// its blur: the string bowed up and down by its amplitude (a half sine), faint
		for (const sgn of [1, -1]) {
			const ghost = mesh(new T.TubeGeometry(new T.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => new T.Vector3(-w / 2 + (w * i) / 16, Math.sin((Math.PI * i) / 16), 0))), 32, r, 6, false), mat, false)
			ghost.visible = false
			// (flat until the hook bows it: its unit bow would otherwise count in the item's size, and a catalog photo, which frames every
			// mesh drawn or not, would show the string's box far away)
			ghost.scale.y = 1e-4
			ghost.userData.frame = { hook: "waves:string", sgn }
			g.add(ghost)
		}
		return g
	}
	addModel("monochord", "string", (ctx) => stringModel(ctx, "steel"))
	addFrameHook("waves:string", (obj, f, args) => {
		const amp = (f.state.amp_mm ?? 0) / 1000
		if (amp < 0.0002) {
			obj.visible = false
			return
		}
		obj.visible = true
		obj.scale.y = args.sgn * amp
		const m = ownMaterial(obj)
		m.transparent = true
		m.opacity = Math.min(0.5, 0.15 + amp / 0.004)
		m.depthWrite = false
	})

	// ============================================================== rubber band on a shoebox
	addModel("rubber-band", "box", ({ w, h, d }) => {
		const card = kit.cardboard("#b98d5c")
		const t = 0.003
		const g = kit.group(
			mesh(box(w, t, d), card).translateY(-h / 2 + t / 2),
			mesh(box(w, h, t), card).translateZ(d / 2 - t / 2),
			mesh(box(w, h, t), card).translateZ(-d / 2 + t / 2),
			mesh(box(t, h, d), card).translateX(-w / 2 + t / 2),
			mesh(box(t, h, d), card).translateX(w / 2 - t / 2)
		)
		const label = mesh(new T.PlaneGeometry(w * 0.4, h * 0.3), kit.printed("waves-shoebox", (gg, W, H) => {
			gg.fillStyle = "#f6efe2"
			gg.fillRect(0, 0, W, H)
			gg.fillStyle = "#7b4a2a"
			gg.font = "bold 150px Helvetica, Arial, sans-serif"
			gg.textAlign = "center"
			gg.textBaseline = "middle"
			gg.fillText("SIZE 6", W / 2, H / 2)
		}), false)
		label.position.set(0, 0, d / 2 + 0.0008)
		g.add(label)
		return g
	})
	addModel("rubber-band", "band", (ctx) => {
		const g = stringModel({ ...ctx, h: ctx.h }, "rubber")
		g.scale.z = Math.max(1, ctx.d / ctx.h)
		return g
	})

	// ============================================================== xylophone bar
	addModel("xylophone-bar", "frame", ({ w, h, d }) => {
		const g = new T.Group()
		for (const z of [-d / 2 + 0.008, d / 2 - 0.008]) g.add(mesh(box(w, h, 0.016, 0.003), darkWood()).translateZ(z))
		for (const x of [-w / 2 + 0.01, w / 2 - 0.01]) g.add(mesh(box(0.02, h * 0.8, d, 0.003), darkWood()).translateX(x).translateY(-h * 0.1))
		return g
	})
	const felt = ({ w, h, d }) => mesh(box(w, h, d, 0.003), kit.fabric("#7a1f2b"))
	addModel("xylophone-bar", "felt-left", felt)
	addModel("xylophone-bar", "felt-right", felt)
	addModel("xylophone-bar", "bar", ({ w, h, d, props }) => {
		const metal = props.metal ?? "aluminium"
		const mat = metal === "rosewood" ? darkWood() : metal === "steel" ? polished() : kit.metal("#c8d3e0", { roughness: 0.2, key: "waves-bar" })
		const g = kit.group(mesh(box(w, h, d, 0.0012), mat))
		// a felt mallet on a stand behind the bar, coming down on its middle
		g.add(beater({ pivot: [-w / 2 - 0.05, 0.12], tip: [0, h / 2 + 0.012], foot: [-w / 2 - 0.05, -0.04 - h / 2], rest: 0.45, head: "felt", times: strikeTimes(props), z: 0 }))
		for (const sgn of [-1, 1]) {
			const pin = mesh(kit.cylinderY(0.0018, h + 0.002, 10), darkSteel())
			pin.position.x = sgn * (0.5 - 0.224) * w
			g.add(pin)
		}
		return g
	})

	// ============================================================== glass bottle with water: one lathe of glass (body, shoulder, neck: its three physics parts), the water inside
	addModel("glass-bottle", "body", ({ w, h, props }) => {
		const R = w / 2
		const neckR = 0.0095 + 0.004
		const neckL = { "330 ml": 0.06, "500 ml": 0.07, "750 ml": 0.09 }[props.size ?? "500 ml"] ?? 0.07
		const prof = [[0, -h / 2], [R - 0.004, -h / 2], [R, -h / 2 + 0.006], [R, h / 2], [neckR + 0.002, h / 2 + 0.04], [neckR, h / 2 + 0.045], [neckR, h / 2 + 0.04 + neckL - 0.004], [neckR + 0.0015, h / 2 + 0.04 + neckL - 0.002], [neckR + 0.0015, h / 2 + 0.04 + neckL], [neckR - 0.002, h / 2 + 0.04 + neckL]]
		const g = kit.group(mesh(kit.lathe(prof, 48, `waves-bottle|${props.size}`), kit.glass("#cfe8d2", { thickness: 0.003, roughness: 0.03 })))
		const fill = props.fill ?? 0.3
		if (fill > 0.005) {
			const water = mesh(kit.cylinderY(R - 0.004, h * fill - 0.004, 40), kit.mat("waves-bottle-water", { color: "#6fb6d9", roughness: 0.05, transmission: 0.7, thickness: 0.05, transparent: true, opacity: 0.85 }))
			water.position.y = -h / 2 + 0.003 + (h * fill - 0.004) / 2
			g.add(water)
		}
		return g
	})
	addModel("glass-bottle", "shoulder", null)
	addModel("glass-bottle", "neck", null)

	// ============================================================== speaker
	addModel("speaker", "box", ({ w, h, d }) => {
		const g = kit.group(mesh(box(w, h, d, 0.006), darkWood()))
		const baffle = mesh(box(w * 0.94, h * 0.94, 0.003, 0.003), blackPlastic())
		baffle.position.z = d / 2
		g.add(baffle)
		const cone = mesh(kit.latheZ([[0.0, 0.0], [0.012, 0.004], [0.05, 0.018], [0.058, 0.02]], 48, "waves-cone"), kit.mat("waves-cone", { color: "#2a2b2e", roughness: 0.8 }))
		cone.position.set(0, -h * 0.05 + h * 0.05, d / 2 - 0.018)
		g.add(cone)
		const surround = mesh(kit.torus(0.058, 0.004, 10, 48), kit.rubber("#151515"))
		surround.position.set(0, h * 0.0, d / 2 + 0.002)
		g.add(surround)
		const cap = mesh(kit.sphere(0.014, 24, 12).clone().scale(1, 1, 0.5), kit.mat("waves-cap", { color: "#38393d", roughness: 0.4 }))
		cap.position.set(0, 0, d / 2 - 0.004)
		g.add(cap)
		const tw = mesh(kit.cylinderZ(0.016, 0.006, 32), polished())
		tw.position.set(0, h * 0.33, d / 2 + 0.001)
		g.add(tw)
		return g
	})

	// ============================================================== clapper
	addModel("clapper", "handle", ({ w, h, d }) => mesh(kit.cylinderY(Math.min(w, d) / 2, h, 20), darkWood()))
	addModel("clapper", "boards", ({ w, h, d, props }) => {
		// two boards hinged at their bottom: open before each clap, snapped shut at the clap
		const g = new T.Group()
		const wood = lightWood()
		const hingeY = -h / 2
		for (const sgn of [-1, 1]) {
			const pivot = new T.Group()
			pivot.position.set(sgn * w * 0.25, hingeY, 0)
			const b = mesh(box(w * 0.48, h, d, 0.002), wood)
			b.position.y = h / 2
			pivot.add(b)
			pivot.userData.frame = { hook: "waves:clap", sgn, at: props.strike_at ?? 0.5, n: props.hits ?? 1, every: props.every ?? 1 }
			g.add(pivot)
		}
		return g
	})
	addFrameHook("waves:clap", (obj, f, a) => {
		// open 20° from 0.25 s before a clap, shut at it, opening again over the next 0.3 s
		let open = 0.14
		for (let k = 0; k < a.n; k++) {
			const tc = a.at + k * a.every
			const u = f.t - tc
			if (u >= -0.25 && u < 0) open = Math.min(open, 0.14 * Math.min(1, -u / 0.06))
			else if (u >= 0 && u < 0.3) open = Math.min(open, 0.14 * (u / 0.3))
		}
		obj.rotation.z = a.sgn * open
	})

	// ============================================================== bell in a jar
	addModel("bell-jar", "plate", ({ w, h, d }) => {
		const g = kit.group(mesh(kit.cylinderY(Math.min(w, d) / 2, h, 48), darkSteel()))
		const gasket = mesh(kit.torus(0.105, 0.004, 10, 64).rotateX(Math.PI / 2), kit.rubber("#111"))
		gasket.position.y = h / 2
		g.add(gasket)
		const hose = mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(w / 2 - 0.01, 0, 0), new T.Vector3(w / 2 + 0.04, -0.005, 0.02), new T.Vector3(w / 2 + 0.08, -h / 2 + 0.004, 0.06)]), 16, 0.005, 8), kit.rubber("#222"))
		g.add(hose)
		return g
	})
	addModel("bell-jar", "bell-post", ({ w, h }) => mesh(kit.cylinderY(w / 2, h, 12), polished()))
	addModel("bell-jar", "gong", ({ r }) => {
		const brass = kit.metal("#d4a64a", { roughness: 0.2, key: "waves-brass" })
		const dome = mesh(new T.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), brass)
		const g = kit.group(dome)
		const ham = mesh(kit.sphere(0.006, 16, 10), darkSteel())
		ham.position.set(r * 0.9, -r * 0.2, 0)
		g.add(ham)
		return g
	})
	addModel("bell-jar", "glass-left", ({ props }) => {
		// the whole glass bell jar (its three physics parts are its walls and top): a dome with a knob, centred on the plate
		const glass = kit.glass("#f4fbff", { thickness: 0.004, roughness: 0.02 })
		const R = 0.11
		const prof = [[R, 0], [R, 0.2], [R * 0.95, 0.23], [R * 0.8, 0.255], [R * 0.5, 0.272], [0.02, 0.276], [0.018, 0.29], [0.0, 0.292]]
		const m = mesh(kit.lathe(prof, 64, "waves-jar"), glass)
		// (this part's origin is the left wall's middle: the jar's axis is R − 2 mm to the right, its rim 13 cm down)
		m.position.set(R - 0.002, -0.13, 0)
		void props
		return m
	})
	addModel("bell-jar", "glass-right", null)
	addModel("bell-jar", "glass-top", null)

	// ============================================================== wave rope and Slinky: the driver and the post
	const driver = ({ w, h, d, props }) => {
		const g = new T.Group()
		const post = mesh(box(0.03, h - 0.04, 0.03, 0.003), darkWood())
		post.position.y = -0.02
		g.add(post)
		const foot = mesh(box(w * 1.4, 0.015, d * 1.4, 0.003), darkWood())
		foot.position.y = -h / 2 + 0.0075
		g.add(foot)
		const head = mesh(box(w, 0.06, d, 0.006), blackPlastic())
		head.position.y = h / 2 - 0.03
		g.add(head)
		const arm = mesh(box(0.06, 0.008, 0.012, 0.002), polished())
		arm.position.set(0.04 + 0.03, h / 2 - 0.04, 0)
		const along = props.push === "push and pull"
		const flat = props.lying === "on the floor"
		arm.userData.frame = { hook: "waves:driver", x0: 0.07, y0: h / 2 - 0.04, dir: along ? "x" : flat ? "z" : "y" }
		g.add(arm)
		return g
	}
	addFrameHook("waves:driver", (obj, f, a) => {
		const d0 = Number.isFinite(f.state.d0) ? f.state.d0 : 0
		obj.position.set(a.x0 + (a.dir === "x" ? d0 : 0), a.y0 + (a.dir === "y" ? d0 : 0), a.dir === "z" ? d0 : 0)
	})
	const post = ({ w, h, d }) => {
		const g = kit.group(mesh(box(w, h, d, 0.003), darkWood()))
		const foot = mesh(box(0.1, 0.015, 0.1, 0.003), darkWood())
		foot.position.y = -h / 2 + 0.0075
		g.add(foot)
		const eye = mesh(kit.torus(0.008, 0.002, 8, 20), polished())
		eye.position.set(-w / 2 - 0.006, h / 2 - 0.06, 0)
		g.add(eye)
		return g
	}
	/**
	 * The rope (or the Slinky) at rest, drawn with its far post until a run's readings move it: the "waves:lines" view plugin then draws the
	 * line itself and this one hides (hook "waves:rest-line"). So a catalog photo, which has no run, and a scene not yet run show the line,
	 * hanging as the plugin's first frame does (the same sag: μ·g·x·(L − x)/2T tied, μ·g·x·(2L − x)/2T otherwise; none lying on the floor).
	 * In the post's frame: the line runs from the driver end (x0, y0) to the post's near face (x0 + L).
	 */
	const restLine = ({ h, props }, slinky) => {
		const L = props.length ?? (slinky ? 3 : 4)
		const flat = (props.lying ?? (slinky ? "on the floor" : "held up")) === "on the floor"
		const mu = slinky ? (props.spring_mass ?? 0.2) / L : (props.weight ?? 0.1)
		const tension = slinky ? (props.stiffness ?? 1) * (L - 0.06) : (props.tension ?? 10)
		const fixed = (props.far_end ?? "tied to the post") === "tied to the post"
		const x0 = -(L + 0.02)
		const y0 = h - 0.06 - h / 2 // (the post stands 6 cm above the line; its centre is half its height up)
		// (lying on the table where the sag would take it below it, as the engine's line does: the post's foot is the table)
		const floor = -h / 2 + (slinky ? 0.0335 : 0.006)
		const sag = (x) => (flat || !(tension > 0) ? 0 : Math.max(floor - y0, (-mu * 9.81 * x * (fixed ? L - x : 2 * L - x)) / (2 * tension)))
		const g = new T.Group()
		g.userData.frame = { hook: "waves:rest-line" }
		if (slinky) {
			const ring = new T.TorusGeometry(0.0335, 0.0018, 6, 28).rotateY(Math.PI / 2)
			const metal = kit.metal("#cfd3d8", { roughness: 0.25, key: "waves-slinky" })
			for (let j = 0; j <= 80; j++) {
				const x = (j / 80) * L
				const r = mesh(ring, metal)
				r.position.set(x0 + x, y0 + sag(x), 0)
				g.add(r)
			}
		} else {
			const pts = Array.from({ length: 25 }, (_, i) => new T.Vector3(x0 + (L * i) / 24, y0 + sag((L * i) / 24), 0))
			g.add(mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 96, 0.006, 8, false), kit.mat("waves-rope", { color: "#c9a26b", roughness: 0.85, metalness: 0 })))
		}
		return g
	}
	addFrameHook("waves:rest-line", (obj, f) => {
		obj.visible = !Number.isFinite(f.state?.d0)
	})
	const postWithLine = (slinky) => (ctx) => {
		const g = post(ctx)
		g.add(restLine(ctx, slinky))
		return g
	}
	addModel("wave-rope", "driver", driver)
	addModel("wave-rope", "post", postWithLine(false))
	addModel("slinky", "driver", driver)
	addModel("slinky", "post", postWithLine(true))

	// ============================================================== ripple tank
	addModel("ripple-tank", "base", ({ w, h, d }) => {
		const frame = darkSteel()
		const g = kit.group(mesh(box(w, h, d, 0.001), kit.glass("#e8f6ff", { thickness: 0.006, roughness: 0.04 })))
		for (const z of [-d / 2, d / 2]) g.add(mesh(box(w, 0.012, 0.008, 0.002), frame).translateZ(z).translateY(0.004))
		return g
	})
	const tankEnd = ({ w, h, d }) => mesh(box(w, h, d, 0.002), kit.plastic("#2f6fae", { gloss: 0.5, key: "waves-tank-end" }))
	addModel("ripple-tank", "end-left", tankEnd)
	addModel("ripple-tank", "end-right", tankEnd)
	const tankLeg = ({ w, h, d }) => mesh(box(w, h, d, 0.003), darkSteel())
	addModel("ripple-tank", "leg-left", tankLeg)
	addModel("ripple-tank", "leg-right", tankLeg)

	// ============================================================== string telephone (engine6 crossmod)
	// a 9 oz paper cup lying along x, its bottom at -H/2 and its mouth at +H/2 (the right, listening cup; the left one turned round): a thin
	// paper shell (up the outside, over the rolled rim, down the inside to the recessed bottom) and a printed band (red: talk, blue: listen)
	const CUP_H = 0.09
	const CUP_RB = 0.0265
	const CUP_RM = 0.038
	const cupShell = () =>
		kit.latheX(
			[[0, 0], [CUP_RB - 0.0004, 0], [CUP_RB, 0.0025], [CUP_RM, CUP_H - 0.0015], [CUP_RM + 0.0012, CUP_H - 0.0004], [CUP_RM + 0.0008, CUP_H + 0.0008],
				[CUP_RM - 0.0006, CUP_H + 0.0006], [CUP_RM - 0.0008, CUP_H - 0.0016], [CUP_RB - 0.0008, 0.0048], [0, 0.0048]],
			48,
			"waves-paper-cup"
		)
	const cupBand = () => {
		const r = (y) => CUP_RB + ((CUP_RM - CUP_RB) * y) / CUP_H + 0.0004
		return kit.latheX([[r(0.5 * CUP_H), 0.5 * CUP_H], [r(0.78 * CUP_H), 0.78 * CUP_H]], 48, "waves-paper-cup-band")
	}
	const paperCup = () => kit.mat("waves-paper-cup", { color: "#f3efe6", roughness: 0.82, metalness: 0 })
	const cupModel = (mouthRight, band) => () => {
		const g = kit.group(mesh(cupShell(), paperCup()), mesh(cupBand(), kit.plastic(band, { gloss: 0.2, key: "waves-cup-band" })))
		g.position.x = -CUP_H / 2
		const o = new T.Group()
		o.add(g)
		if (!mouthRight) o.rotation.y = Math.PI
		return o
	}
	addModel("string-telephone", "cup-talk", cupModel(false, "#c8443a"))
	addModel("string-telephone", "cup-listen", cupModel(true, "#3f7fd0"))
	addModel("string-telephone", "string", ({ w, solid, props }) => {
		// the string from bottom to bottom, hanging in its parabola (render only; the physics is the module's), thicker than life to be seen
		const sag = Number.isFinite(solid?.sag) ? Math.max(0, solid.sag) : 0
		const kind = props?.string ?? "cotton string"
		const r = kind === "wire" ? 0.0012 : kind === "fishing line" ? 0.0012 : 0.0016
		const key = `waves-phone-string|${w.toFixed(4)}|${sag.toFixed(4)}|${r}`
		const geo = kit.geo(key, () => {
			const pts = []
			for (let i = 0; i <= 48; i++) {
				const u = i / 48
				const x = -w / 2 + u * w
				pts.push(new T.Vector3(x, -sag * (1 - (2 * x / w) * (2 * x / w)), 0))
			}
			return new T.TubeGeometry(new T.CatmullRomCurve3(pts), 96, r, 6, false)
		})
		const mat = kind === "wire" ? kit.steel() : kind === "fishing line" ? kit.plastic("#dfe6ea", { gloss: 0.8, key: "waves-line" }) : kit.fabric("#e9dfc6")
		const g = kit.group(mesh(geo, mat))
		if (props?.pinched) {
			// a wooden clothes peg clamped on the string at its middle (what pinches it), its jaws on the string and its legs up
			const wood = lightWood()
			const peg = new T.Group()
			for (const side of [-1, 1]) {
				const jaw = mesh(box(0.008, 0.07, 0.01, 0.002), wood)
				jaw.position.set(side * 0.0045, 0.03, 0)
				jaw.rotation.z = side * -0.06
				peg.add(jaw)
			}
			const spring = mesh(kit.torus(0.006, 0.0012, 8, 20), darkSteel())
			spring.position.set(0, 0.035, 0)
			peg.add(spring)
			peg.position.set(0, -sag, 0)
			g.add(peg)
		}
		return g
	})

	// ============================================================== view plugins
	const recordsOf = (doc, kind) => (doc.processes ?? []).filter((p) => p.kind === kind)
	const poseOf = (ctx, solid, t) => ctx.placementAt(solid, t)
	const worldOf = (pose, at) => {
		if (!pose) return at
		const c = Math.cos(pose.angle)
		const s = Math.sin(pose.angle)
		return { x: pose.x + at.x * c - at.y * s, y: pose.y + at.x * s + at.y * c }
	}

	// ---- sound lines: arcs spreading from every sounding source (a shader draws them on one quad per source)
	// (the table's mirror draws the scene from a camera under the table top: the arcs leave that picture out, and never show below the top)
	const ARC_VERT = `varying vec2 vP; varying float vY; void main() { vP = position.xy; vY = (modelMatrix * vec4(position, 1.0)).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
	const ARC_FRAG = `varying vec2 vP; varying float vY; uniform float uPhase; uniform float uSpace; uniform float uAlpha; uniform float uMaxR; uniform float uInner; uniform vec3 uColor; uniform float uFloor;
		void main() {
			if (cameraPosition.y < uFloor || vY < uFloor) discard;
			float r = length(vP);
			if (r > uMaxR || r < uInner) discard;
			float a = abs(atan(vP.y, abs(vP.x)));
			float sector = 1.0 - smoothstep(0.75, 0.95, a);
			float k = fract((r - uPhase) / uSpace);
			float w = 0.035 + 0.004 / uSpace;
			float band = smoothstep(0.0, w, k) * (1.0 - smoothstep(w, 2.0 * w, k));
			float fade = (1.0 - smoothstep(uMaxR * 0.55, uMaxR, r)) * smoothstep(uInner, uInner + 0.02, r);
			float al = band * sector * fade * uAlpha;
			if (al < 0.004) discard;
			gl_FragColor = vec4(uColor, al);
		}`
	addViewPlugin({
		name: "waves:sound-lines",
		load(ctx) {
			const srcs = recordsOf(ctx.doc, "sound").filter((p) => (p.role === "source" || p.role === "buzzer") && p.show !== false)
			// (a string telephone that carries its own voice: the same arcs from its far cup's mouth, as loud as the voice there: its loss_db fainter)
			for (const tl of recordsOf(ctx.doc, "sound").filter((p) => p.role === "telephone")) {
				const voice = srcs.find((p) => p.role === "source" && p.item === tl.item)
				if (voice && ctx.stateAt(tl.item, "carries", 0) === 1) srcs.push({ ...voice, solid: tl.solid, at: tl.b, far: tl.item })
			}
			if (!srcs.length || !ctx.track?.state) return null
			const C = 343.2
			const arcs = srcs.map((p) => {
				const lambda = C / p.f0
				// spacing ∝ wavelength, scaled to be seen on a table (×0.05, between 1.2 and 12 cm); three or four arcs out to 3.5 spacings
				const space = Math.min(0.12, Math.max(0.012, lambda * 0.05))
				const maxR = Math.min(0.45, Math.max(0.12, space * 3.5))
				const mat = new T.ShaderMaterial({
					vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false,
					uniforms: { uPhase: { value: 0 }, uSpace: { value: space }, uAlpha: { value: 0 }, uMaxR: { value: maxR }, uInner: { value: 0.03 }, uColor: { value: new T.Color("#4a78b8") }, uFloor: { value: -0.0005 } }
				})
				const quad = new T.Mesh(new T.PlaneGeometry(2 * maxR, 2 * maxR), mat)
				quad.renderOrder = 5
				quad.castShadow = false
				quad.receiveShadow = false
				quad.frustumCulled = false
				ctx.group.add(quad)
				return { p, quad, mat, space }
			})
			return {
				frame(t) {
					for (const a of arcs) {
						const db = a.p.role === "buzzer" ? ctx.stateAt(a.p.item, "sound_db", t) : ctx.stateAt(a.p.item, "sounding", t)
						// (the far cup's arcs: 0.7 of the talking cup's while the voice sounds, a picture of the sound coming out there, not its level)
						const on = (Number.isFinite(db) ? Math.max(0, Math.min(1, (db - 25) / 60)) : 0) * (a.p.far ? 0.7 : 1)
						a.quad.visible = on > 0.01
						if (!a.quad.visible) continue
						const at = worldOf(poseOf(ctx, a.p.solid, t), a.p.at ?? { x: 0, y: 0 })
						a.quad.position.set(at.x, at.y, 0.0)
						// the arcs drift outward at 0.8 spacing a second: a picture, far slower than sound's 343 m/s
						a.mat.uniforms.uPhase.value = (t * 0.8 * a.space) % a.space
						a.mat.uniforms.uAlpha.value = 0.1 + 0.4 * on
					}
				},
				dispose() {
					for (const a of arcs) {
						a.quad.geometry.dispose()
						a.mat.dispose()
					}
				}
			}
		}
	})

	// ---- ropes and Slinkies, from their readings
	addViewPlugin({
		name: "waves:lines",
		load(ctx) {
			const recs = recordsOf(ctx.doc, "wave-line")
			if (!recs.length || !ctx.track?.state) return null
			// (the run's gravity: the engine's line sags under it, and its readings are offsets from that sag)
			const G = typeof ctx.doc?.settings?.gravity === "number" ? Math.max(0, ctx.doc.settings.gravity) : 9.81
			const lines = recs.map((p) => {
				const L = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y)
				const ux = (p.b.x - p.a.x) / L
				const uy = (p.b.y - p.a.y) / L
				const n = Math.max(2, Math.round(p.n))
				const keep = Math.max(2, Math.min(80, Math.round(p.keep ?? 40)))
				const stride = Math.max(1, Math.round(n / keep))
				const idx = []
				for (let i = 0; i <= n; i += stride) idx.push(i)
				if (n % stride !== 0) idx.push(n)
				const mu = p.mass / L
				const gv = p.plane === "vertical" ? -G * ux : 0
				const sag = (i) => {
					if (gv === 0 || !(p.tension > 0)) return 0
					const x = (i * L) / n
					return p.end === "fixed" ? (mu * gv * x * (L - x)) / (2 * p.tension) : (mu * gv * x * (2 * L - x)) / (2 * p.tension)
				}
				const slinky = p.line === "slinky"
				const along = slinky && p.drive?.dir === "along"
				const flat = p.plane === "flat"
				const group = new T.Group()
				ctx.group.add(group)
				const o = { p, L, ux, uy, n, idx, sag, slinky, along, flat, group, mesh: null, rings: null, ribbon: null }
				if (slinky) {
					// the Slinky's coils: 80 flat rings of 1.2 mm wire (one instanced mesh), stood across the line
					const ring = new T.TorusGeometry(0.0335, 0.0018, 6, 28)
					const metal = kit.metal("#cfd3d8", { roughness: 0.25, key: "waves-slinky" })
					o.rings = new T.InstancedMesh(ring, metal, 81)
					o.rings.castShadow = true
					o.rings.frustumCulled = false
					group.add(o.rings)
				}
				if (p.ribbon !== undefined) {
					const rib = new T.Mesh(new T.PlaneGeometry(0.03, 0.07), new T.MeshStandardMaterial({ color: "#e53935", side: T.DoubleSide, roughness: 0.6 }))
					rib.geometry.translate(0, -0.035, 0)
					o.ribbon = rib
					group.add(rib)
				}
				return o
			})
			const ropeMat = kit.mat("waves-rope", { color: "#c9a26b", roughness: 0.85, metalness: 0 })
			const _m = new T.Matrix4()
			const _q = new T.Quaternion()
			const _s = new T.Vector3(1, 1, 1)
			const _v = new T.Vector3()
			return {
				frame(t) {
					for (const o of lines) {
						const { p, L, ux, uy, n, idx } = o
						const off = idx.map((_, k) => ctx.stateAt(p.item, `d${k}`, t) ?? 0)
						// the kept points' world places: along the line, plus their offsets (across: up/down, or toward the viewer on the floor)
						const pts = idx.map((i, k) => {
							const u = (i * L) / n + (o.along ? off[k] : 0)
							const v = o.along ? o.sag(i) : o.sag(i) + off[k]
							if (o.flat) return new T.Vector3(p.a.x + ux * u, p.a.y + uy * u, v)
							return new T.Vector3(p.a.x + ux * u - uy * v, p.a.y + uy * u + ux * v, 0)
						})
						const curve = new T.CatmullRomCurve3(pts)
						if (o.slinky) {
							// coil j sits at its own along-place (between the kept points' offsets)
							for (let j = 0; j <= 80; j++) {
								const s = j / 80
								curve.getPointAt(Math.min(1, Math.max(0, s)), _v)
								if (o.along) {
									// (its place along: the kept points' offsets between them; across: its sag there, the line hanging under its own weight)
									const kf = s * (idx.length - 1)
									const k0 = Math.floor(kf)
									const k1 = Math.min(idx.length - 1, k0 + 1)
									const du = off[k0] + (off[k1] - off[k0]) * (kf - k0)
									const sv = o.sag(s * n)
									_v.set(p.a.x + ux * (s * L + du) - uy * sv, p.a.y + uy * (s * L + du) + ux * sv, 0)
								}
								_q.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(ux, uy, 0))
								_m.compose(_v, _q, _s)
								o.rings.setMatrixAt(j, _m)
							}
							o.rings.instanceMatrix.needsUpdate = true
						} else {
							const g = new T.TubeGeometry(curve, Math.min(400, idx.length * 6), 0.006, 8, false)
							if (o.mesh) {
								o.mesh.geometry.dispose()
								o.mesh.geometry = g
							} else {
								o.mesh = new T.Mesh(g, ropeMat)
								o.mesh.castShadow = true
								o.mesh.frustumCulled = false
								o.group.add(o.mesh)
							}
						}
						if (o.ribbon) {
							curve.getPointAt(Math.min(1, Math.max(0, p.ribbon)), _v)
							o.ribbon.position.copy(_v)
						}
					}
				},
				dispose() {
					for (const o of lines) {
						o.mesh?.geometry.dispose()
						o.rings?.geometry.dispose()
						o.ribbon?.geometry.dispose()
					}
				}
			}
		}
	})

	// ---- ripple tanks: the water's surface (the module's linear wave field, recomputed for the picture), the dipper and the floater
	const tanhJ = (x) => Math.tanh(x)
	const ripplesOf = (p, lambda, cg) => {
		const k = (2 * Math.PI) / lambda
		const w = 2 * Math.PI * p.f
		const decay = (2 * 1e-6 * k * k) / cg
		const coth = 1 / tanhJ(k * p.depth)
		const L = p.x1 - p.x0
		const W = p.width
		const along = [{ x: p.sx, gain: 1 }]
		let a = p.sx
		let b = p.sx
		const reach = Math.min(40, Math.ceil(4.6 / Math.max(1e-6, decay * L)) + 1)
		for (let r = 1; r <= reach; r++) {
			const ra = r % 2 === 1 ? p.far === "wall" : p.near === "wall"
			const rb = r % 2 === 1 ? p.near === "wall" : p.far === "wall"
			a = 2 * (r % 2 === 1 ? p.x1 : p.x0) - a
			b = 2 * (r % 2 === 1 ? p.x0 : p.x1) - b
			if (ra) along.push({ x: a, gain: 1 })
			if (rb) along.push({ x: b, gain: 1 })
			if (!ra && !rb) break
		}
		const acrossN = p.source === "point" ? Math.min(6, Math.ceil(4.6 / Math.max(1e-6, decay * W)) + 1) : 0
		const images = []
		for (const q of along) {
			images.push({ x: q.x, z: 0 })
			for (let r = 1; r <= acrossN; r++) images.push({ x: q.x, z: r * W }, { x: q.x, z: -r * W })
		}
		const r0 = lambda / 4
		return (x, z, t) => {
			if (t <= p.at) return 0
			let eta = 0
			const run = cg * (t - p.at)
			for (const im of images) {
				const dx = x - im.x
				const dz = z - im.z
				const r = p.source === "point" ? Math.hypot(dx, dz) : Math.abs(dx)
				const e = (run - r) / lambda
				const ease = e >= 1 ? 1 : e <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * e)
				if (ease === 0) continue
				const spread = p.source === "point" ? Math.sqrt(r0 / Math.max(r, r0)) : 1
				eta += p.amp * spread * Math.exp(-decay * r) * ease * Math.cos(k * r - w * (t - p.at))
			}
			return eta
		}
	}
	const duckModel = () => {
		const yellow = kit.plastic("#ffd21f", { gloss: 0.7, key: "waves-duck" })
		const g = new T.Group()
		const body = mesh(kit.sphere(0.02, 24, 16), yellow)
		body.scale.set(1.25, 0.8, 1)
		g.add(body)
		const head = mesh(kit.sphere(0.012, 20, 14), yellow)
		head.position.set(0.016, 0.02, 0)
		g.add(head)
		const beak = mesh(new T.ConeGeometry(0.005, 0.012, 12).rotateZ(-Math.PI / 2), kit.plastic("#ff7a00", { gloss: 0.6, key: "waves-beak" }))
		beak.position.set(0.031, 0.019, 0)
		g.add(beak)
		for (const z of [-0.007, 0.007]) {
			const eye = mesh(kit.sphere(0.0022, 10, 8), blackPlastic())
			eye.position.set(0.024, 0.025, z)
			g.add(eye)
		}
		return g
	}
	addViewPlugin({
		name: "waves:tank",
		load(ctx) {
			const recs = recordsOf(ctx.doc, "ripples")
			if (!recs.length || !ctx.track?.state) return null
			const tanks = recs.map((p) => {
				const lambda = ctx.stateAt(p.item, "wavelength", 0) ?? 0.05
				const speed = ctx.stateAt(p.item, "speed", 0) ?? 0.3
				const cg = ctx.stateAt(p.item, "group", 0) ?? speed
				const field = ripplesOf(p, lambda, cg)
				const L = p.x1 - p.x0
				const nx = Math.min(360, Math.max(60, Math.round((L / lambda) * 14)))
				const nz = p.source === "point" ? Math.min(200, Math.max(24, Math.round((p.width / lambda) * 12))) : 8
				const geo = new T.PlaneGeometry(L, p.width, nx, nz).rotateX(-Math.PI / 2)
				const pos = geo.attributes.position
				const water = new T.MeshPhysicalMaterial({ color: "#7fb8d8", roughness: 0.05, metalness: 0, transmission: 0.85, thickness: p.depth, ior: 1.333, transparent: true, opacity: 0.95, clearcoat: 1 })
				const surf = new T.Mesh(geo, water)
				surf.position.set((p.x0 + p.x1) / 2, p.y, 0)
				surf.receiveShadow = true
				surf.frustumCulled = false
				ctx.group.add(surf)
				// the water's body under its surface (a still slab of its depth, a little bluer)
				const body = new T.Mesh(new T.BoxGeometry(L, p.depth, p.width), new T.MeshPhysicalMaterial({ color: "#5e9fc4", roughness: 0.1, transmission: 0.8, thickness: p.depth, transparent: true, opacity: 0.6 }))
				body.position.set((p.x0 + p.x1) / 2, p.y - p.depth / 2 - 0.0005, 0)
				ctx.group.add(body)
				// the dipper: a ball (point) or a bar on an arm from a little motor over the water
				const dip = new T.Group()
				const tip = p.source === "point" ? mesh(kit.sphere(0.008, 20, 14), blackPlastic()) : mesh(box(0.012, 0.012, p.width * 0.9, 0.003), blackPlastic())
				dip.add(tip)
				const arm = mesh(kit.cylinderY(0.0025, 0.08, 10), polished())
				arm.position.y = 0.045
				dip.add(arm)
				const motor = mesh(box(0.05, 0.035, 0.04, 0.005), darkSteel())
				motor.position.y = 0.1
				dip.add(motor)
				ctx.group.add(dip)
				let floater = null
				if (p.floater !== undefined) {
					floater = p.floater_kind === "cork" ? mesh(kit.cylinderY(0.012, 0.018, 20), kit.mat("waves-cork2", { color: "#b5844f", roughness: 0.95 })) : duckModel()
					ctx.group.add(floater)
				}
				return { p, field, geo, pos, surf, dip, floater, nx, nz, L, lambda }
			})
			return {
				frame(t) {
					for (const o of tanks) {
						const { p, field, pos } = o
						for (let i = 0; i < pos.count; i++) {
							const x = pos.getX(i) + (p.x0 + p.x1) / 2
							const z = pos.getZ(i)
							pos.setY(i, field(x, z, t))
						}
						pos.needsUpdate = true
						o.geo.computeVertexNormals()
						const bob = t > p.at ? p.amp * Math.sin(2 * Math.PI * p.f * (t - p.at)) : 0
						o.dip.position.set(p.sx, p.y + 0.004 + bob, 0)
						if (o.floater) {
							const fx = ctx.stateAt(p.item, "floater_x", t) ?? 0
							const fy = ctx.stateAt(p.item, "floater_y", t) ?? 0
							o.floater.position.set(p.floater + fx, p.y + fy + 0.004, 0)
							// it rocks with the water's slope under it
							const s = (field(p.floater + 0.005, 0, t) - field(p.floater - 0.005, 0, t)) / 0.01
							o.floater.rotation.z = Math.atan(s)
						}
					}
				},
				dispose() {
					for (const o of tanks) o.geo.dispose()
				}
			}
		}
	})

	// ---- a big reading over every sound meter (legible in a wide shot; drawn in exports too)
	addViewPlugin({
		name: "waves:labels",
		load(ctx) {
			const meters = recordsOf(ctx.doc, "sound").filter((p) => p.role === "meter")
			if (!meters.length || !ctx.track?.state) return null
			const labels = meters.map((p) => {
				const lab = ctx.label({ text: "", height: 0.05 })
				lab.sprite.renderOrder = 6
				ctx.group.add(lab.sprite)
				return { p, lab }
			})
			return {
				frame(t) {
					for (const { p, lab } of labels) {
						const at = worldOf(poseOf(ctx, p.solid, t), { x: 0, y: (p.at?.y ?? 0) + 0.11 })
						lab.sprite.position.set(at.x, at.y, 0.02)
						const db = ctx.stateAt(p.item, "level", t)
						const hz = ctx.stateAt(p.item, "pitch", t)
						lab.set(`${Number.isFinite(db) ? db.toFixed(0) : "--"} dB${hz > 0 ? ` · ${hz >= 1000 ? (hz / 1000).toFixed(2) + " kHz" : hz.toFixed(0) + " Hz"}` : ""}`)
					}
				},
				dispose() {
					for (const { lab } of labels) lab.dispose()
				}
			}
		}
	})
}
