// The magnetism module's 3D models (machines/mod_magnetism.py's types) and its view plug-in (web/view-plugins.js):
//   bar-magnet        a painted bar: north half red with a white N, south half blue with a white S (a neodymium bar: nickel, its north end red)
//   horseshoe-magnet  a red alnico U with ground steel pole tips, N and S on the tips
//   disc-magnet       a nickel-plated disc, a red dot on its north face
//   ring-magnets      a wooden base and dowel, charcoal ferrite rings (nickel for neodymium) with their north faces marked
//   magnet-cart       the catalog's cart (its own model) with the bar magnet on its deck
//   paper-clip, plastic-clip   a Gem clip: two and a half loops of round wire (steel, vinyl-coated colours, or plastic)
//   iron-nail, battery-electromagnet   a common nail (head, shank, point); the electromagnet's coil of enamelled copper on it, two AA cells in a holder
//                     beside it and the red and black leads
//   steel-washer, steel-can, can-on-side, foil-ball, copper-wire, brass-key, wooden-bead, barrier-sheet, clip-on-thread (a lump of putty)
//   compass           a round case standing face-on: its dial (N E S W, degrees), the red-and-white needle (the physics part), glass, a black foot
//   balloon           a glossy latex balloon with its knot (and minus signs on its rubbed side when charged), a wooden hook
//   paper-bits, charged-rod (minus or plus signs on its rubbed half), pith-ball
// Plug-in "magnetism:field": the field lines of every magnet whose `show_field` is on, traced in the machine plane through the field of all the
// scene's magnets (their pole faces, as the engine reckons them: tooling/src/sim/magnetism.ts), redrawn when a magnet moves, with arrows from
// north to south.
const NORTH = "#d0312d"
const SOUTH = "#2f5fae"
const COLOURS = { silver: null, red: "#c0392b", blue: "#2e6fc4", green: "#2f9a4c", yellow: "#e2b52a", black: "#2a2a2a" }
const BALLOON = { red: "#d62f3a", blue: "#2f62d6", yellow: "#f2c230", green: "#2fa54a", pink: "#ec6fa8", orange: "#f08a24", purple: "#8a4fc8", white: "#f2f2f2" }
const MU0 = 1.25663706212e-6

export default function register({ addModel, addViewPlugin, kit, THREE }) {
	let modelForRef = null
	// (the catalog's own cart model, for the magnet cart: models3d.js is still loading while this registers)
	import("../models3d.js").then((m) => (modelForRef = m.modelFor)).catch(() => {})
	const at = (o, x, y, z = 0) => {
		o.position.set(x, y, z)
		return o
	}
	const paint = (color, key = "") => kit.mat(`mag|paint|${color}|${key}`, { color, roughness: 0.38, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.2 })
	const nickel = kit.mat("mag|nickel", { color: "#c9ccd1", roughness: 0.16, metalness: 1 })
	const zinc = kit.mat("mag|zinc", { color: "#c4c8cd", roughness: 0.28, metalness: 1 })
	const ferrite = kit.mat("mag|ferrite", { color: "#3a3b3e", roughness: 0.6, metalness: 0.15 })
	const groundSteel = kit.mat("mag|ground", { color: "#b7bcc2", roughness: 0.22, metalness: 1 })
	const copper = kit.mat("mag|copper", { color: "#c46a3c", roughness: 0.25, metalness: 1 })
	const enamel = kit.mat("mag|enamel", { color: "#b5531f", roughness: 0.2, metalness: 0.6, clearcoat: 0.8, clearcoatRoughness: 0.1 })
	const brass = kit.mat("mag|brass", { color: "#c9a640", roughness: 0.26, metalness: 1 })
	const letter = (ch, color, size) =>
		kit.mat(`mag|letter|${ch}|${color}`, { map: kit.text(`mag-${ch}-${color}`, ch, { bg: color, fg: "#ffffff", font: `800 ${Math.round(size)}px Helvetica, Arial, sans-serif`, w: 128, h: 128 }), roughness: 0.4, metalness: 0 })
	const plane = (w, h) => kit.geo(`mag|plane|${w.toFixed(5)}|${h.toFixed(5)}`, () => new THREE.PlaneGeometry(w, h))
	/** A square label on the front (+z) and back faces of a part at (x, y), size s. */
	const labels = (g, ch, color, x, y, s, d) => {
		const m = letter(ch, color, 96)
		const f = kit.mesh(plane(s, s), m, { cast: false })
		at(f, x, y, d / 2 + 0.0002)
		const b = kit.mesh(plane(s, s), m, { cast: false })
		b.rotation.y = Math.PI
		at(b, x, y, -d / 2 - 0.0002)
		g.add(f, b)
	}

	// ============================================================== bar magnets
	const barMagnet = (w, h, d, P) => {
		const neo = P.material === "neodymium"
		const flip = P.flip === true
		const g = kit.group()
		const nMat = neo ? nickel : paint(NORTH, "bar")
		const sMat = neo ? nickel : paint(SOUTH, "bar")
		const half = w / 2
		const r = Math.min(0.0015, h / 4, d / 4)
		const right = kit.mesh(kit.box(half, h, d, r), flip ? sMat : nMat)
		const left = kit.mesh(kit.box(half, h, d, r), flip ? nMat : sMat)
		g.add(at(right, half / 2, 0), at(left, -half / 2, 0))
		if (neo) {
			// (a nickel bar: its north end dipped in red)
			const cap = kit.mesh(kit.box(Math.min(0.006, half / 3), h + 0.0004, d + 0.0004, r), paint(NORTH, "neo"))
			g.add(at(cap, (flip ? -1 : 1) * (half - Math.min(0.006, half / 3) / 2), 0))
		}
		const s = Math.min(h, d, half) * 0.75
		if (s > 0.004) {
			labels(g, "N", neo ? "#9aa0a6" : NORTH, (flip ? -1 : 1) * half * 0.55, 0, s, d)
			labels(g, "S", neo ? "#9aa0a6" : SOUTH, (flip ? 1 : -1) * half * 0.55, 0, s, d)
		}
		return g
	}
	addModel("bar-magnet", "magnet", ({ w, h, d, props }) => barMagnet(w, h, d, props ?? {}))

	// ============================================================== horseshoe
	const hsMat = (P) => (P.material === "neodymium" ? nickel : P.material === "ceramic" ? ferrite : paint(NORTH, "horseshoe"))
	addModel("horseshoe-magnet", "bend", ({ w, h, d, props }) => kit.mesh(kit.box(w, h, d, Math.min(0.002, h / 4)), hsMat(props ?? {})))
	for (const side of ["left", "right"]) {
		addModel("horseshoe-magnet", side, ({ w, h, d, props }) => {
			const P = props ?? {}
			const g = kit.group()
			const tip = Math.min(0.01, h * 0.25)
			const arm = kit.mesh(kit.box(w, h - tip, d, Math.min(0.002, w / 4)), hsMat(P))
			const ground = kit.mesh(kit.box(w, tip, d, 0.0008), groundSteel)
			g.add(at(arm, 0, tip / 2), at(ground, 0, -h / 2 + tip / 2))
			const north = (side === "left") !== (P.flip === true)
			const s = Math.min(w, d) * 0.7
			if (s > 0.004) labels(g, north ? "N" : "S", north ? NORTH : SOUTH, 0, -h / 2 + tip + s / 2 + 0.002, s, d)
			return g
		})
	}

	// ============================================================== disc magnet
	addModel("disc-magnet", "magnet", ({ w, h, props }) => {
		const P = props ?? {}
		const r = w / 2
		const g = kit.group(kit.mesh(kit.lathe([[0, -h / 2], [r - 0.0003, -h / 2], [r, -h / 2 + 0.0003], [r, h / 2 - 0.0003], [r - 0.0003, h / 2], [0, h / 2]], 64), P.material === "ceramic" ? ferrite : nickel))
		const dot = kit.mesh(kit.cylinderY(Math.min(0.0025, r * 0.35), 0.0002, 24), paint(NORTH, "dot"), { cast: false })
		g.add(at(dot, 0, (P.flip ? -1 : 1) * (h / 2 + 0.0001)))
		return g
	})

	// ============================================================== ring magnets on a dowel
	addModel("ring-magnets", "base", ({ w, h, d }) => kit.mesh(kit.box(w, h, d, 0.002), kit.wood("#b98a57")))
	addModel("ring-magnets", "dowel", ({ h, props }) => {
		const P = props ?? {}
		const r = Math.max(0.0015, (Number(P.hole) || 0.009) / 2 - 0.0007)
		return kit.mesh(kit.cylinderY(r, h, 32), kit.wood("#d9b07a", { varnish: 0.3 }))
	})
	addModel("ring-magnets", "*", ({ solid, w, h, props }) => {
		// each ring is drawn whole from its left half (its right half draws nothing): centred where the ring's middle is
		if (!/^ring\d+$/.test(solid.part)) return null
		const P = props ?? {}
		const OD = Number(P.outer) || 0.025
		const ID = Math.min(Number(P.hole) || 0.009, OD - 0.006)
		const R = OD / 2
		const rr = ID / 2
		const t = h
		const mat = P.material === "neodymium" ? nickel : ferrite
		const ring = kit.mesh(kit.lathe([[rr, -t / 2], [R, -t / 2], [R, t / 2], [rr, t / 2], [rr, -t / 2]], 72), mat)
		const g = kit.group(at(ring, (R + rr) / 2, 0))
		// a red dot on the north face (which face is north: the engine's record says; marked on the face that reads "up" in the builder's order)
		const i = Number(solid.part.slice(4)) - 1
		const up = (i % 2 === 0 || P.alternate === false) !== (P.flip === true)
		const dot = kit.mesh(kit.cylinderY(0.0018, 0.0002, 20), paint(NORTH, "ringdot"), { cast: false })
		g.add(at(dot, R + rr, up ? t / 2 + 0.0001 : -t / 2 - 0.0001, 0))
		return g
	})

	// ============================================================== magnet cart
	for (const part of ["chassis", "front", "rear"]) {
		addModel("magnet-cart", part, (ctx) => {
			const build = modelForRef?.({ itemType: "cart", part })
			if (typeof build !== "function") return part === "chassis" ? kit.mesh(kit.box(ctx.w ?? 0.2, ctx.h ?? 0.012, ctx.d ?? 0.08, 0.002), kit.wood("#b07a45")) : undefined
			try {
				return build({ ...ctx, props: { ...(ctx.props ?? {}), material: "dark wood" } })
			} catch {
				return undefined
			}
		})
	}
	addModel("magnet-cart", "magnet", ({ w, h, d, props }) => barMagnet(w, h, d, props ?? {}))

	// ============================================================== paper clips
	/** A Gem clip's wire path, lying in the x-z plane (33 × 8 mm), as a tube. */
	const clipGeo = (L, W, wire) =>
		kit.geo(`mag|clip|${L}|${W}|${wire}`, () => {
			const a = L / 2 - W / 2
			const pts = []
			const arc = (cx, r, from, to, n = 10) => {
				for (let k = 0; k <= n; k++) {
					const u = from + ((to - from) * k) / n
					pts.push(new THREE.Vector3(cx + r * Math.cos(u), 0, r * Math.sin(u)))
				}
			}
			const r1 = W / 2 - wire / 2
			const r2 = r1 * 0.72
			const r3 = r1 * 0.48
			// outer loop: from the inner leg's end, around the right end, back along the bottom, around the left end, then the inner loops
			pts.push(new THREE.Vector3(-a + L * 0.22, 0, r3))
			pts.push(new THREE.Vector3(a, 0, r1))
			arc(a, r1, Math.PI / 2, -Math.PI / 2)
			pts.push(new THREE.Vector3(-a, 0, -r1))
			arc(-a, r1, -Math.PI / 2, -Math.PI * 1.5)
			pts.push(new THREE.Vector3(a - L * 0.12, 0, r1 - (r1 - r2)))
			arc(a - L * 0.12, r2, Math.PI / 2, -Math.PI / 2)
			pts.push(new THREE.Vector3(-a + L * 0.1, 0, -r2))
			const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.4)
			return new THREE.TubeGeometry(curve, 220, wire / 2, 8, false)
		})
	const clipMesh = (props, plastic = false) => {
		const P = props ?? {}
		const c = COLOURS[P.color] ?? null
		const mat = plastic ? kit.plastic(c ?? COLOURS.blue, { gloss: 0.5, key: "clip" }) : c ? kit.plastic(c, { gloss: 0.6, key: "vinyl" }) : zinc
		return kit.mesh(clipGeo(0.033, 0.008, plastic ? 0.0012 : 0.0009), mat)
	}
	addModel("paper-clip", "*", ({ props }) => clipMesh(props))
	addModel("plastic-clip", "clip", ({ props }) => clipMesh(props, true))
	addModel("clip-on-thread", "clip", ({ props }) => clipMesh(props))
	addModel("clip-on-thread", "anchor", ({ w, h, d }) => {
		const g = kit.sphere(Math.min(w, d) / 2, 24, 12)
		const m = kit.mesh(g, kit.mat("mag|putty", { color: "#e9e2c8", roughness: 0.85, metalness: 0 }))
		m.scale.set(1, h / Math.min(w, d), 1)
		return m
	})

	// ============================================================== nails and the electromagnet
	const nailGeo = (L, r) =>
		kit.geo(`mag|nail|${L.toFixed(5)}|${r.toFixed(5)}`, () => {
			const p = Math.min(0.004, L / 6)
			const prof = [[0, L / 2], [r * 0.12, L / 2 - 0.0002], [r, L / 2 - p], [r, -L / 2 + 0.0004], [r * 0.9, -L / 2], [0, -L / 2]]
			// (a lathe about y, laid along x: its point at +x)
			return new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 32).rotateZ(-Math.PI / 2)
		})
	const nailMesh = (ctx) => {
		const pts = ctx.body?.points ?? []
		const xs = pts.map((q) => q.x)
		const L = xs.length ? Math.max(...xs) - Math.min(...xs) : 0.05
		const r = (ctx.body?.depth ?? 0.003) / 2
		return kit.mesh(nailGeo(L, r), kit.steel())
	}
	const headMesh = ({ w, h }) => kit.mesh(kit.geo(`mag|nailhead|${w}|${h}`, () => new THREE.CylinderGeometry(h / 2, h / 2, w, 32).rotateZ(Math.PI / 2)), kit.steel())
	addModel("iron-nail", "shank", nailMesh)
	addModel("iron-nail", "head", headMesh)
	addModel("battery-electromagnet", "core", (ctx) => {
		const P = ctx.props ?? {}
		const g = kit.group(nailMesh(ctx))
		const pts = ctx.body?.points ?? []
		const xs = pts.map((q) => q.x)
		const L = xs.length ? Math.max(...xs) - Math.min(...xs) : 0.05
		const r = (ctx.body?.depth ?? 0.003) / 2
		// the coil: layers of 0.51 mm enamelled wire over all but 5 mm at each end (as many layers as the turns need)
		const turns = Math.max(1, Number(P.turns) || 50)
		const len = Math.max(0.005, L - 0.01)
		const perLayer = Math.max(1, Math.floor(len / 0.00051))
		const layers = Math.max(1, Math.ceil(turns / perLayer))
		const R = r + layers * 0.00051
		const coil = kit.mesh(kit.geo(`mag|coil|${len.toFixed(4)}|${R.toFixed(5)}|${r.toFixed(5)}`, () => new THREE.CylinderGeometry(R, R, len, 48, 1, false).rotateZ(Math.PI / 2)), kit.printed(`mag-coil-${Math.round(R * 1e5)}`, (gc, cw, ch) => {
			gc.fillStyle = "#a9481b"
			gc.fillRect(0, 0, cw, ch)
			for (let i = 0; i < 160; i++) {
				gc.fillStyle = i % 2 ? "#c9672d" : "#8d3a14"
				gc.fillRect((i * cw) / 160, 0, cw / 320, ch)
			}
		}, { w: 512, h: 64, roughness: 0.22, metalness: 0.6, clearcoat: 0.8 }))
		g.add(at(coil, -0.0005, 0))
		// the nail's head (1 mm thick, 2.2 shanks wide: drawn only, the physics has the shank)
		g.add(at(headMesh({ w: 0.001, h: 2 * r * 2.2 }), -L / 2 - 0.0005, 0))
		// (the battery holder on the table beside it and the leads to the coil's ends: the view plug-in "magnetism:battery" below)
		return g
	})

	// ============================================================== washers, cans, test objects
	addModel("steel-washer", "washer", ({ w, h }) => {
		const R = w / 2
		const rr = R * 0.525
		return kit.mesh(kit.lathe([[rr, -h / 2], [R, -h / 2], [R, h / 2], [rr, h / 2], [rr, -h / 2]], 48), zinc)
	})
	const canProfile = (r, H) => [[0, -H / 2], [r * 0.82, -H / 2], [r * 0.98, -H / 2 + 0.002], [r, -H / 2 + 0.004], [r, H / 2 - 0.004], [r * 0.98, H / 2 - 0.002], [r * 0.82, H / 2], [0, H / 2]]
	addModel("steel-can", "can", ({ w, h }) => {
		const r = w / 2
		const g = kit.group(kit.mesh(kit.lathe(canProfile(r, h), 64, `mag-can-${r}-${h}`), kit.mat("mag|tin", { color: "#c8ccd0", roughness: 0.3, metalness: 1 })))
		// the ribs pressed round its side
		for (let k = -3; k <= 3; k++) g.add(at(kit.mesh(kit.torus(r - 0.0004, 0.0009, 8, 64), kit.mat("mag|tin", { color: "#c8ccd0", roughness: 0.3, metalness: 1 })), 0, k * (h / 9)))
		g.children.slice(1).forEach((c) => (c.rotation.x = Math.PI / 2))
		return g
	})
	addModel("can-on-side", "can", ({ r, d, props }) => {
		const steel = (props ?? {}).material === "steel"
		const L = d
		const prof = steel ? canProfile(r, L) : [[0, -L / 2], [r * 0.78, -L / 2], [r, -L / 2 + 0.006], [r, L / 2 - 0.016], [r * 0.82, L / 2 - 0.004], [r * 0.8, L / 2], [0, L / 2]]
		const body = kit.mesh(kit.latheZ(prof, 64, `mag-canside-${steel}-${r}-${L}`), steel ? kit.mat("mag|tin", { color: "#c8ccd0", roughness: 0.3, metalness: 1 }) : kit.aluminium())
		const g = kit.group(body)
		if (!steel) {
			const band = kit.mesh(kit.geo(`mag|canband|${r}|${L}`, () => new THREE.CylinderGeometry(r + 0.0002, r + 0.0002, L * 0.55, 64, 1, true).rotateX(Math.PI / 2)), paint("#c0392b", "soda"))
			g.add(band)
		}
		return g
	})
	addModel("foil-ball", "ball", ({ r }) =>
		kit.mesh(
			kit.geo(`mag|foil|${r}`, () => {
				const geo = new THREE.IcosahedronGeometry(r, 3)
				const p = geo.attributes.position
				for (let i = 0; i < p.count; i++) {
					const x = p.getX(i)
					const y = p.getY(i)
					const z = p.getZ(i)
					const k = 0.88 + 0.12 * Math.abs(Math.sin(x * 900) * Math.cos(y * 700 + z * 500))
					p.setXYZ(i, x * k, y * k, z * k)
				}
				geo.computeVertexNormals()
				return geo
			}),
			kit.mat("mag|foil", { color: "#d9dcdf", roughness: 0.32, metalness: 1, flatShading: true })
		)
	)
	addModel("copper-wire", "coil", ({ w, h }) =>
		kit.mesh(
			kit.geo(`mag|cuwire|${w}|${h}`, () => {
				const pts = []
				const turns = 7
				for (let k = 0; k <= 280; k++) {
					const u = (k / 280) * turns * Math.PI * 2
					pts.push(new THREE.Vector3(-w / 2 + 0.001 + ((w - 0.002) * k) / 280, (h / 2 - 0.0008) * Math.cos(u), (h / 2 - 0.0008) * Math.sin(u)))
				}
				return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, 0.0007, 8, false)
			}),
			copper
		)
	)
	addModel("brass-key", "key", ({ w, h, d }) => {
		// a key lying flat: its outline in the x-z plane, h thick
		const L = w
		const bow = d / 2
		const shape = [[-L / 2 + bow, 0.0035], [L / 2 - 0.002, 0.0035], [L / 2, 0.0015], [L / 2 - 0.003, -0.002], [L / 2 - 0.006, -0.0005], [L / 2 - 0.009, -0.003], [L / 2 - 0.012, -0.0008], [L / 2 - 0.015, -0.0035], [-L / 2 + bow, -0.0035]]
		const blade = kit.mesh(kit.extrude(shape, h, { bevel: 0.0002, key: `mag-keyblade-${L}` }), brass)
		blade.rotation.x = -Math.PI / 2
		const head = kit.mesh(kit.geo(`mag|keybow|${bow}|${h}`, () => {
			const s = new THREE.Shape()
			s.absarc(0, 0, bow, 0, Math.PI * 2, false)
			const hole = new THREE.Path()
			hole.absarc(-bow * 0.35, 0, bow * 0.28, 0, Math.PI * 2, true)
			s.holes.push(hole)
			const g2 = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 32 })
			g2.translate(0, 0, -h / 2)
			return g2
		}), brass)
		head.rotation.x = -Math.PI / 2
		at(head, -L / 2 + bow, 0)
		return kit.group(blade, head)
	})
	addModel("wooden-bead", "bead", ({ r }) => kit.mesh(kit.sphere(r, 32, 16), kit.wood("#c99a62", { varnish: 0.7 })))
	addModel("barrier-sheet", "sheet", ({ w, h, d, props }) => {
		const kind = (props ?? {}).material ?? "cardboard"
		const m = {
			paper: kit.paper("#f6f3ec"),
			cardboard: kit.cardboard("#c49a6c"),
			plastic: kit.mat("mag|acrylic", { color: "#eef6fb", roughness: 0.06, metalness: 0, transmission: 0.85, thickness: 0.002, ior: 1.49, transparent: true }),
			glass: kit.glass("#f4fbff", { thickness: 0.003 }),
			aluminium: kit.aluminium(),
			steel: kit.steel()
		}[kind] ?? kit.cardboard()
		const real = { paper: 0.0002, cardboard: 0.002, plastic: 0.002, glass: 0.003, aluminium: 0.001, steel: 0.0006 }[kind] ?? w
		return kit.mesh(kit.box(Math.min(w, real), h, d, 0.0001), m)
	})

	// ============================================================== compass
	addModel("compass", "foot", ({ w, h, d, props }) => {
		const P = props ?? {}
		const D = Number(P.size) || 0.05
		const g = kit.group(kit.mesh(kit.box(w, h, d, 0.002), kit.plastic("#2b2b2b", { gloss: 0.4, key: "compass" })))
		// the case standing face-on, its centre at the needle's pivot (D/2 + 4 mm above the foot's middle)
		const cy = D / 2 + h / 2
		const R = D / 2
		const rim = kit.mesh(kit.geo(`mag|rim|${R}`, () => new THREE.TorusGeometry(R, 0.003, 12, 64)), kit.plastic("#2b2b2b", { gloss: 0.5, key: "compass" }))
		at(rim, 0, cy, 0)
		const dial = kit.mesh(kit.geo(`mag|dial|${R}`, () => new THREE.CircleGeometry(R - 0.002, 64)), kit.printed(`mag-dial-${P.north ?? "right"}`, (gc, cw, ch) => {
			gc.fillStyle = "#f7f4ec"
			gc.fillRect(0, 0, cw, ch)
			gc.translate(cw / 2, ch / 2)
			gc.strokeStyle = "#333"
			for (let k = 0; k < 72; k++) {
				const u = (k * Math.PI) / 36
				const r0 = k % 2 ? 0.42 : 0.4
				gc.lineWidth = k % 9 === 0 ? 4 : 2
				gc.beginPath()
				gc.moveTo(Math.cos(u) * cw * r0, Math.sin(u) * ch * r0)
				gc.lineTo(Math.cos(u) * cw * 0.46, Math.sin(u) * ch * 0.46)
				gc.stroke()
			}
			gc.font = `800 ${Math.round(cw * 0.1)}px Helvetica, Arial`
			gc.textAlign = "center"
			gc.textBaseline = "middle"
			const east = P.north === "left" ? -1 : 1
			const marks = [["N", east * 0.31, 0, "#c0392b"], ["S", -east * 0.31, 0, "#222"], ["E", 0, 0.31, "#222"], ["W", 0, -0.31, "#222"]]
			for (const [t, x, y, c] of marks) {
				gc.fillStyle = c
				gc.fillText(t, x * cw, y * ch)
			}
		}, { w: 512, h: 512, roughness: 0.5 }))
		at(dial, 0, cy, -0.004)
		const back = kit.mesh(kit.geo(`mag|cback|${R}`, () => new THREE.CylinderGeometry(R, R, 0.004, 64).rotateX(Math.PI / 2)), kit.plastic("#2b2b2b", { gloss: 0.4, key: "compass" }))
		at(back, 0, cy, -0.0065)
		const glass = kit.mesh(kit.geo(`mag|cglass|${R}`, () => new THREE.CircleGeometry(R - 0.001, 64)), kit.glass("#ffffff", { thickness: 0.001 }))
		at(glass, 0, cy, 0.004)
		g.add(rim, dial, back, glass)
		return g
	})
	addModel("compass", "needle", ({ body }) => {
		const pts = body?.points ?? []
		const L = pts.length ? Math.max(...pts.map((p) => p.x)) * 2 : 0.04
		const w = pts.length ? Math.max(...pts.map((p) => p.y)) * 2 : 0.004
		const north = kit.mesh(kit.extrude([[L / 2, 0], [0, w / 2], [0, -w / 2]], 0.0008, { key: `mag-needleN-${L}` }), paint(NORTH, "needle"))
		const south = kit.mesh(kit.extrude([[0, w / 2], [-L / 2, 0], [0, -w / 2]], 0.0008, { key: `mag-needleS-${L}` }), kit.plastic("#f2f2f2", { gloss: 0.4, key: "needle" }))
		const cap = kit.mesh(kit.cylinderZ(0.0016, 0.0014, 20), groundSteel)
		return kit.group(north, south, cap)
	})

	// ============================================================== static electricity
	/** Minus (or plus) signs on a sphere's surface around a direction (ux, uy) of its frame, facing the camera. */
	const signs = (g, R, ux, uy, sign, n = 7) => {
		const m = kit.mat(`mag|sign|${sign}`, { color: sign < 0 ? "#1d3fbf" : "#c0392b", roughness: 0.5, metalness: 0 })
		const base = Math.atan2(uy, ux)
		for (let k = 0; k < n; k++) {
			const a = base + (k - (n - 1) / 2) * 0.28
			const ring = k % 2 ? 0.86 : 0.72
			const x = R * ring * Math.cos(a)
			const y = R * ring * Math.sin(a)
			const z = Math.sqrt(Math.max(0, R * R - x * x - y * y)) + 0.0006
			const bar = kit.mesh(kit.box(R * 0.14, R * 0.035, 0.0006, 0.0002), m, { cast: false })
			at(bar, x, y, z)
			g.add(bar)
			if (sign > 0) {
				const v = kit.mesh(kit.box(R * 0.035, R * 0.14, 0.0006, 0.0002), m, { cast: false })
				at(v, x, y, z + 0.0001)
				g.add(v)
			}
		}
	}
	addModel("balloon", "balloon", ({ r, props }) => {
		const P = props ?? {}
		const color = BALLOON[P.color] ?? BALLOON.red
		const latex = kit.mat(`mag|latex|${color}`, { color, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: "#ffffff" })
		// a balloon is a little longer toward its knot; the knot at its top (+y), where the thread is tied
		const body = kit.mesh(
			kit.geo(`mag|balloon|${r}`, () => {
				const prof = []
				for (let k = 0; k <= 40; k++) {
					const u = -Math.PI / 2 + (k / 40) * Math.PI
					const s = Math.sin(u)
					prof.push([r * Math.cos(u) * (1 - 0.06 * Math.max(0, s) * s), r * s * (1 + 0.04 * Math.max(0, s))])
				}
				return new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(Math.max(0, a), b)), 64)
			}),
			latex
		)
		const knot = kit.mesh(kit.geo(`mag|knot|${r}`, () => new THREE.CylinderGeometry(0.0025, 0.004, 0.009, 16)), latex)
		const g = kit.group(body, at(knot, 0, r * 1.04 + 0.004))
		const strokes = Math.min(10, Math.max(0, Math.trunc(Number(P.rubbed) || 0)))
		if (strokes > 0) {
			const dir = { bottom: [0, -1], top: [0, 1], left: [-1, 0], right: [1, 0], "lower right": [0.7071, -0.7071], "lower left": [-0.7071, -0.7071] }[P.rubbed_side] ?? [0, -1]
			signs(g, r, dir[0], dir[1], -1, Math.max(3, strokes))
		}
		return g
	})
	const hook = ({ w, h, d }) => kit.group(kit.mesh(kit.box(w, h, d, 0.002), kit.wood("#a87444")), at(kit.mesh(kit.torus(0.004, 0.0009, 8, 24), kit.steel()), 0, -h / 2 - 0.003))
	addModel("balloon", "hook", hook)
	addModel("pith-ball", "hook", hook)
	addModel("pith-ball", "ball", ({ r }) => kit.mesh(kit.sphere(r, 32, 16), kit.mat("mag|pith", { color: "#e2e5e8", roughness: 0.3, metalness: 1 })))
	addModel("paper-bits", "*", ({ w, h, d, props }) => {
		const tissue = (props ?? {}).paper !== "printer paper"
		const t = tissue ? 0.00004 : 0.0001
		const m = kit.box(w, Math.max(0.0002, t), d, 0.00005)
		const mesh = kit.mesh(m, kit.paper(tissue ? "#fbfaf6" : "#f4f1ea"))
		return at(mesh, 0, -h / 2 + Math.max(0.0002, t) / 2)
	})
	addModel("charged-rod", "rod", ({ w, h, props }) => {
		const P = props ?? {}
		const plastic = P.material !== "glass"
		const rod = kit.mesh(kit.geo(`mag|rod|${w}|${h}`, () => new THREE.CylinderGeometry(h / 2, h / 2, w, 32).rotateZ(Math.PI / 2)), plastic ? kit.plastic("#2b2b2b", { gloss: 0.7, key: "rod" }) : kit.glass("#f2faff", { thickness: h }))
		const g = kit.group(rod)
		const strokes = Math.min(10, Math.max(0, Math.trunc(Number(P.rubbed) || 0)))
		if (strokes > 0) {
			const m = kit.mat(`mag|sign|${plastic ? -1 : 1}`, { color: plastic ? "#1d3fbf" : "#c0392b", roughness: 0.5, metalness: 0 })
			for (let k = 0; k < Math.max(3, Math.round(strokes * 0.8)); k++) {
				const x = w * 0.06 + (k * (w * 0.4)) / Math.max(3, Math.round(strokes * 0.8))
				const bar = kit.mesh(kit.box(h * 0.6, h * 0.14, 0.0006, 0.0002), m, { cast: false })
				g.add(at(bar, x, h * 0.85, 0))
				if (!plastic) g.add(at(kit.mesh(kit.box(h * 0.14, h * 0.6, 0.0006, 0.0002), m, { cast: false }), x, h * 0.85, 0.0001))
			}
		}
		return g
	})

	// ============================================================== the electromagnet's cells and leads
	// A holder of AA cells lying on the table beside each electromagnet (on what is under the holder's place, a little behind the machine plane, so
	// nothing that falls meets it), its red lead from the far (+) end to the coil's upper end and its black lead from the near end to the lower end.
	// Scenery only: the physics has the coil's current, not the holder.
	const cellGeo = () => kit.geo("mag|aa", () => new THREE.CylinderGeometry(0.007, 0.007, 0.05, 32).rotateZ(Math.PI / 2))
	const cellMat = () =>
		kit.printed("mag-aa", (gc, cw, ch) => {
			gc.fillStyle = "#1b1b1b"
			gc.fillRect(0, 0, cw, ch)
			gc.fillStyle = "#c9a640"
			gc.fillRect(cw * 0.72, 0, cw * 0.28, ch)
			gc.fillStyle = "#ffffff"
			gc.font = `700 ${Math.round(ch * 0.4)}px Helvetica, Arial`
			gc.fillText("1.5V AA", cw * 0.1, ch * 0.62)
		}, { w: 256, h: 64, roughness: 0.35 })
	addViewPlugin({
		name: "magnetism:battery",
		load(ctx) {
			const items = ctx.itemsOfType("battery-electromagnet")
			if (!items.length) return null
			const solids = ctx.doc.solids
			const objs = []
			const tubes = []
			const HW = 0.03 // the holder's half length (6 cm: two AA cells end to end)
			const Z = -0.026 // its middle's depth: behind the machine plane (its front 1 cm behind it)
			for (const item of items) {
				const id = item.id ?? item
				const core = solids.find((s) => s.id === `${id}/core`)
				if (!core || core.body?.kind !== "polygon") continue
				const P = (ctx.resolved ?? {})[id] ?? {}
				const q = { x: core.at.x, y: core.at.y, angle: core.angle ?? 0 }
				const c = Math.cos(q.angle)
				const sn = Math.sin(q.angle)
				const W = (lx, ly) => [q.x + lx * c - ly * sn, q.y + lx * sn + ly * c]
				const xs = core.body.points.map((p) => p.x)
				const L = Math.max(...xs) - Math.min(...xs)
				const r = (core.body.depth ?? 0.003) / 2
				const turns = Math.max(1, Number(P.turns) || 50)
				const len = Math.max(0.005, L - 0.01)
				const layers = Math.max(1, Math.ceil(turns / Math.max(1, Math.floor(len / 0.00051))))
				const R = r + layers * 0.00051
				// the coil's two ends on the side that faces the holder (world +x), upper and lower
				const ends = [-len / 2 - 0.0005, len / 2 - 0.0005].map((lx) => {
					const a = W(lx, R)
					const b = W(lx, -R)
					return a[0] >= b[0] ? a : b
				})
				ends.sort((m, n) => n[1] - m[1])
				const lowest = Math.min(...core.body.points.map((p) => W(p.x, p.y)[1]))
				const right = Math.max(...core.body.points.map((p) => W(p.x, p.y)[0]))
				const cx = right + 0.035 + HW
				// what the holder lies on: the highest level static top under it, below the electromagnet
				let floor = 0
				for (const s of solids) {
					if (s.kind !== "static" || s.body?.kind !== "slab" || Math.abs(s.angle ?? 0) > 1e-6 || s.parent || s.item === id) continue
					const top = s.at.y + s.body.height / 2
					if (s.at.x - s.body.width / 2 <= cx - HW && s.at.x + s.body.width / 2 >= cx + HW && top <= lowest + 0.001 && top > floor) floor = top
				}
				const g = kit.group()
				g.add(kit.mesh(kit.box(2 * HW, 0.016, 0.032, 0.002), kit.plastic("#1d1f22", { gloss: 0.3, key: "holder" })))
				const n = Math.max(1, Math.min(4, Number(P.cells) || 2))
				for (let k = 0; k < n; k++) {
					// side by side across the holder, each 5 cm along it
					const cell = kit.mesh(cellGeo(), cellMat())
					at(cell, 0, 0.008, n > 1 ? -0.009 + (0.018 * k) / (n - 1) : 0)
					g.add(cell)
				}
				g.position.set(cx, floor + 0.008, Z)
				ctx.group.add(g)
				objs.push(g)
				const lead = (color, from, to) => {
					const mid = new THREE.Vector3((from.x + to.x) / 2, Math.min(from.y, to.y) + 0.25 * Math.abs(from.y - to.y), (from.z + to.z) / 2 + 0.004)
					const curve = new THREE.CatmullRomCurve3([from, new THREE.Vector3(from.x + 0.006, from.y, from.z), mid, to])
					const geo = new THREE.TubeGeometry(curve, 40, 0.0009, 8, false)
					tubes.push(geo)
					const m = kit.mesh(geo, kit.plastic(color, { gloss: 0.5, key: "lead" }))
					ctx.group.add(m)
					objs.push(m)
				}
				const ty = floor + 0.014
				lead("#c62828", new THREE.Vector3(ends[0][0], ends[0][1], 0), new THREE.Vector3(cx + HW - 0.004, ty, Z))
				lead("#1b1b1b", new THREE.Vector3(ends[1][0], ends[1][1], 0), new THREE.Vector3(cx - HW + 0.004, ty, Z))
			}
			if (!objs.length) return null
			return {
				frame() {},
				dispose() {
					for (const o of objs) ctx.group.remove(o)
					for (const geo of tubes) geo.dispose()
				}
			}
		}
	})

	// ============================================================== field lines (show_field)
	addViewPlugin({
		name: "magnetism:field",
		load(ctx) {
			const recs = (ctx.doc.processes ?? []).filter((p) => p.kind === "magnetism" && p.role === "magnet")
			const shown = new Set(Object.entries(ctx.resolved ?? {}).filter(([, P]) => P && P.show_field === true).map(([id]) => id))
			const lit = recs.filter((r) => shown.has(r.item))
			if (!lit.length) return null
			const solidOf = new Map(ctx.doc.solids.map((s) => [s.id, s]))
			const mat = new THREE.MeshBasicMaterial({ color: "#3d6fd6", transparent: true, opacity: 0.85, toneMapped: false })
			const arrowMat = new THREE.MeshBasicMaterial({ color: "#3d6fd6", toneMapped: false })
			const arrowGeo = new THREE.ConeGeometry(0.0035, 0.009, 10)
			let meshes = []
			let lastKey = ""
			const poseOf = (id, t) => ctx.placementAt(id, t) ?? (() => {
				const s = solidOf.get(id)
				return s ? { x: s.at.x, y: s.at.y, angle: s.angle ?? 0 } : null
			})()
			/** Every magnet face in the world at t: {cx, cy, nx, ny, a, b, sigma, z}. */
			const facesAt = (t) => {
				const out = []
				for (const r of recs) {
					const q = poseOf(r.solid, t)
					if (!q) continue
					const c = Math.cos(q.angle)
					const s = Math.sin(q.angle)
					for (const f of r.faces) {
						const na = Math.cos(f.angle)
						const nb = Math.sin(f.angle)
						out.push({ cx: q.x + f.x * c - f.y * s, cy: q.y + f.x * s + f.y * c, z: f.z ?? 0, nx: na * c - nb * s, ny: na * s + nb * c, a: f.width / 2, b: f.depth / 2, sigma: f.sigma, item: r.item })
					}
				}
				return out
			}
			const lnSum = (y, R, rest) => (y >= 0 ? Math.log(y + R) : Math.log(Math.max(rest, 1e-24) / (R - y)))
			/** B in the plane z = 0 (T), from the faces (exact rectangles: tooling/src/sim/magnetism.ts rectField). */
			const fieldAt = (faces, x, y) => {
				let bx = 0
				let by = 0
				for (const f of faces) {
					const dx = x - f.cx
					const dy = y - f.cy
					const W = dx * f.nx + dy * f.ny
					const U = -dx * f.ny + dy * f.nx
					const V = -f.z
					let hu = 0
					let hw = 0
					for (let i = 0; i < 2; i++) {
						const X = i === 0 ? U - f.a : U + f.a
						for (let j = 0; j < 2; j++) {
							const Y = j === 0 ? V - f.b : V + f.b
							const R = Math.sqrt(X * X + Y * Y + W * W)
							const sg = i === j ? 1 : -1
							hw += sg * Math.atan2(X * Y, Math.abs(W) * R)
							hu -= sg * lnSum(Y, R, X * X + W * W)
						}
					}
					if (W < 0) hw = -hw
					const k = (MU0 * f.sigma) / (4 * Math.PI)
					bx += k * (hw * f.nx - hu * f.ny)
					by += k * (hw * f.ny + hu * f.nx)
				}
				return [bx, by]
			}
			/** A field line through (x0, y0): traced along B (dir 1, to a south face) or against it (dir -1, to a north face), 2 mm to 1 cm steps
			 *  (midpoint rule), at most 700 of them and 60 cm from where it began; the points after the start. */
			const trace = (faces, x0, y0, dir, ends) => {
				const pts = []
				let x = x0
				let y = y0
				for (let s = 0; s < 700; s++) {
					const [bx, by] = fieldAt(faces, x, y)
					const m = Math.hypot(bx, by)
					if (!(m > 1e-9)) break
					// (2 mm steps near a face, longer farther out: a fifth of the way to the nearest face, at most 1 cm)
					let near = Infinity
					for (const f of faces) near = Math.min(near, Math.hypot(x - f.cx, y - f.cy) - f.a)
					const step = Math.min(0.01, Math.max(0.002, 0.2 * near)) * dir
					const [cx2, cy2] = fieldAt(faces, x + (bx / m) * step * 0.5, y + (by / m) * step * 0.5)
					const m2 = Math.hypot(cx2, cy2)
					if (!(m2 > 1e-9)) break
					x += (cx2 / m2) * step
					y += (cy2 / m2) * step
					pts.push(new THREE.Vector3(x, y, 0))
					// ends at a face of the other kind (within 2 mm of it, inside its width)
					let done = false
					for (const sf of ends) {
						const W = (x - sf.cx) * sf.nx + (y - sf.cy) * sf.ny
						const U = -(x - sf.cx) * sf.ny + (y - sf.cy) * sf.nx
						if (W < 0.002 && W > -0.02 && Math.abs(U) < sf.a + 0.001) done = true
					}
					if (done || Math.hypot(x - x0, y - y0) > 0.6) break
				}
				return pts
			}
			const draw = (pts, arrowAt) => {
				if (pts.length < 3) return
				const curve = new THREE.CatmullRomCurve3(pts)
				const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(600, pts.length * 2), 0.0007, 6, false), mat)
				tube.layers.set(ctx.HUD_LAYER)
				ctx.group.add(tube)
				meshes.push(tube)
				// an arrow along the line (north to south outside the magnet)
				const i = Math.max(0, Math.min(pts.length - 2, arrowAt))
				const p = pts[i]
				const q = pts[i + 1]
				const arrow = new THREE.Mesh(arrowGeo, arrowMat)
				arrow.position.copy(p)
				arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(q.x - p.x, q.y - p.y, 0).normalize())
				arrow.layers.set(ctx.HUD_LAYER)
				ctx.group.add(arrow)
				meshes.push(arrow)
			}
			const build = (t) => {
				for (const m of meshes) {
					ctx.group.remove(m)
					m.geometry !== arrowGeo && m.geometry.dispose()
				}
				meshes = []
				const faces = facesAt(t)
				const souths = faces.filter((f) => f.sigma < 0)
				const norths = faces.filter((f) => f.sigma > 0)
				for (const r of lit) {
					const mine = faces.filter((f) => f.item === r.item && Math.abs(f.z) < 1e-9)
					const north = mine.filter((f) => f.sigma > 0)
					const south = mine.filter((f) => f.sigma < 0)
					if (!north.length) continue
					// (1) lines out of the north pole: five across each north face, out to a south face or 60 cm away
					for (const f of north) {
						const n = 5
						for (let k = 0; k < n; k++) {
							const u = ((k + 0.5) / n - 0.5) * 2 * f.a * 0.9
							const x = f.cx - f.ny * u + f.nx * 0.0015
							const y = f.cy + f.nx * u + f.ny * 0.0015
							const pts = [new THREE.Vector3(x, y, 0), ...trace(faces, x, y, 1, souths)]
							draw(pts, Math.floor(pts.length / 3))
						}
					}
					// (2) the loops round the magnet: lines through points beside it, on the line across its middle between its poles, each
					// traced both ways (back to a north face, on to a south face): nested loops from its north pole round to its south pole
					if (!south.length) continue
					const mid = (list) => {
						let w = 0
						let x = 0
						let y = 0
						for (const f of list) {
							const k = f.a * f.b
							w += k
							x += f.cx * k
							y += f.cy * k
						}
						return [x / w, y / w]
					}
					const [nx0, ny0] = mid(north)
					const [sx0, sy0] = mid(south)
					const span = Math.hypot(nx0 - sx0, ny0 - sy0)
					if (!(span > 0.002)) continue
					const px = -(ny0 - sy0) / span
					const py = (nx0 - sx0) / span
					const mx = (nx0 + sx0) / 2
					const my = (ny0 + sy0) / 2
					// clear of the magnet's own body: its widest face's half width (a bar's half thickness) plus steps of a sixth of the span
					const base = Math.max(...mine.map((f) => f.a)) + 0.004
					const gap = Math.max(0.006, span / 6)
					// (a horseshoe's poles face the same way: only the side they face, not round through its arms)
					const same = north[0].nx * south[0].nx + north[0].ny * south[0].ny > 0.5
					const facing = north[0].nx * px + north[0].ny * py >= 0 ? 1 : -1
					for (const side of same ? [facing] : [1, -1]) {
						for (let k = 0; k < 4; k++) {
							const d = base + k * gap
							const x = mx + px * d * side
							const y = my + py * d * side
							const back = trace(faces, x, y, -1, norths).reverse()
							const on = trace(faces, x, y, 1, souths)
							draw([...back, new THREE.Vector3(x, y, 0), ...on], back.length)
						}
					}
				}
			}
			return {
				frame(t) {
					// (redrawn only when a magnet has moved a millimetre or turned a degree)
					const key = recs.map((r) => {
						const q = poseOf(r.solid, t)
						return q ? `${Math.round(q.x * 1000)},${Math.round(q.y * 1000)},${Math.round((q.angle * 180) / Math.PI)}` : ""
					}).join("|")
					if (key === lastKey) return
					lastKey = key
					build(t)
				},
				dispose() {
					for (const m of meshes) if (m.geometry !== arrowGeo) m.geometry.dispose()
					arrowGeo.dispose()
					mat.dispose()
					arrowMat.dispose()
				}
			}
		}
	})
}
