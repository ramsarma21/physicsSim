// The fracture module's 3D models (machines/mod_fracture.py's types) and its view plug-ins (web/view-plugins.js):
//   raw-egg        a smooth hen's egg (its physics outline is an 8-sided prism round the curve; the model is the curve itself), a dark hairline crack
//                  when it has cracked; its pieces: two half shells (white inside) and a spill (a pool of white with the yolk in it)
//   drinking-glass a clear tumbler with a thick base; its shards: curved slivers of glass
//   ceramic-plate  a glazed dinner plate with a foot ring, a well and a blue-lined rim; its sherds
//   cushion        by its material: a foam pad, packing foam (beads), bubble wrap, cotton balls, a fiberfill pillow, crumpled paper, a folded towel,
//                  carpet; it squashes while something that hit it presses into it (its `squash` reading)
//   egg-drop-box   a cardboard box cut away at the front so its padding and the egg inside show; the egg cracks or stains it when it breaks;
//                  its parachute (a plastic canopy on four lines) is the "fracture:chutes" plug-in
//   snap-bridge    two wooden blocks and the beam across them: strands of spaghetti, white chalk sticks, birch craft sticks or a chocolate bar;
//                  the beam bows by its `sag` reading (drawn up to 4 mm: the things on it stay on its straight top) and its pieces fall when it snaps
//   block-tower    wooden blocks, with the tape, glue line or tack between them that holds them
//   window-pane    a clear glass sheet in a varnished wooden frame (sill, head and the two side stiles the side view does not see), or loose;
//                  its shards: jagged slabs of window glass
// A piece of something breakable is hidden until it is let go (the "fracture:piece" hook: its body's scale is 1 once it replaced the whole
// thing; parked inside it, the engine keeps it at 0), so the editor, the catalog's photos and the run before the break show only the whole thing.
const SAG_DRAWN = 0.004

/** The egg's curve: its half-width at x (blunt end at −L/2), as machines/mod_fracture.py builds the outline round it. */
const eggR = (x, L, W) => {
	const c = Math.max(-1, Math.min(1, (2 * x) / L))
	return (W / 2) * Math.sqrt(Math.max(0, 1 - c * c)) * (1 - 0.08 * c)
}

export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const f5 = (v) => Number(v).toFixed(5)
	const at = (o, x, y, z) => {
		o.position.set(x, y, z)
		return o
	}
	const shellMat = kit.mat("fracture|shell", { color: "#f3e7d3", roughness: 0.62, metalness: 0, clearcoat: 0.08, sheen: 0.2, sheenColor: new THREE.Color("#fff6e8") })
	const shellIn = kit.mat("fracture|shell-in", { color: "#fbf8f1", roughness: 0.8, metalness: 0, side: THREE.DoubleSide })
	const crackMat = kit.mat("fracture|crack", { color: "#5b4632", roughness: 0.9, metalness: 0 })
	const whiteMat = kit.mat("fracture|albumen", { color: "#f4f1e4", roughness: 0.08, metalness: 0, transmission: 0.55, thickness: 0.003, ior: 1.36, transparent: true, clearcoat: 1 })
	const yolkMat = kit.mat("fracture|yolk", { color: "#f2a81d", roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 })
	const glassMat = kit.glass("#eef6f6", { thickness: 0.003, roughness: 0.02 })
	const shardMat = kit.mat("fracture|shard", { color: "#d7eef0", roughness: 0.12, metalness: 0, transmission: 0.55, thickness: 0.006, ior: 1.5, transparent: true, opacity: 0.9, clearcoat: 1, specularIntensity: 1 })
	const ceramic = kit.ceramic("#f6f4ef")
	const blueLine = kit.mat("fracture|plate-line", { color: "#2e5aa8", roughness: 0.25, metalness: 0, clearcoat: 0.8 })
	const card = kit.cardboard("#c49a6c")
	const cardIn = kit.mat("fracture|card-in", { color: "#b58b5e", roughness: 0.95, metalness: 0, side: THREE.DoubleSide })
	const wood = kit.wood("#e2bf8a", { roughness: 0.55, varnish: 0.25 })

	// ============================================================== the egg
	const eggProfile = (L, W, x0 = -L / 2, x1 = L / 2, n = 40) => {
		const pts = []
		for (let i = 0; i <= n; i++) {
			const x = x0 + ((x1 - x0) * i) / n
			pts.push([eggR(x, L, W), x])
		}
		return pts
	}
	const eggMesh = (L, W) => kit.mesh(kit.latheX(eggProfile(L, W), 48, `fracture-egg|${f5(L)}|${f5(W)}`), shellMat)
	/** A jagged crack round the egg's waist (hidden until it cracks). */
	const crackOf = (L, W) => {
		const pts = []
		const n = 40
		for (let i = 0; i <= n; i++) {
			const a = (i / n) * Math.PI * 2
			const x = (i % 2 ? 0.006 : -0.004) * (L / 0.057) + 0.003 * Math.sin(a * 3)
			const r = eggR(x, L, W) + 0.0002
			pts.push(new THREE.Vector3(x, r * Math.cos(a), r * Math.sin(a)))
		}
		const geo = kit.geo(`fracture-crack|${f5(L)}|${f5(W)}`, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.00045, 5, true))
		const m = kit.mesh(geo, crackMat, { cast: false })
		m.name = "crack"
		m.visible = false
		return m
	}
	const egg = ({ props }) => {
		const L = Number(props?.length) || 0.057
		const W = Number(props?.width) || 0.044
		const g = kit.group(eggMesh(L, W), crackOf(L, W))
		g.userData.frame = { hook: "fracture:crack" }
		return g
	}
	addModel("raw-egg", "egg", egg)
	addFrameHook("fracture:crack", (obj, f) => {
		const b = Number(f.state?.broken) || 0
		const crack = obj.getObjectByName("crack")
		if (crack) crack.visible = b >= 0.5
		const stain = obj.getObjectByName("stain")
		if (stain) stain.visible = b >= 1.5
	})
	addFrameHook("fracture:piece", (obj, f) => {
		obj.visible = (f.scale ?? 0) > 0.5
	})
	const piece = (g) => {
		const p = kit.group(g)
		p.visible = false
		p.userData.frame = { hook: "fracture:piece", scaled: true }
		return p
	}
	/** Half an eggshell, open where it broke: the blunt half (side -1) or the pointed half (+1). */
	const halfShell = (side) => ({ props }) => {
		const L = Number(props?.length) || 0.057
		const W = Number(props?.width) || 0.044
		const outer = side < 0 ? eggProfile(L, W, -L / 2, 0.002, 24) : eggProfile(L, W, -0.002, L / 2, 24)
		const geo = kit.latheX(outer, 40, `fracture-half|${side}|${f5(L)}|${f5(W)}`)
		const g = kit.group(kit.mesh(geo, [shellMat]))
		const inner = kit.mesh(kit.latheX(outer.map(([r, x]) => [Math.max(0, r - 0.0004), x]), 40, `fracture-half-in|${side}|${f5(L)}|${f5(W)}`), shellIn, { cast: false })
		g.add(inner)
		// (a lathe is open at its cut: the shell is seen from inside there, white)
		g.children[0].material = kit.mat("fracture|shell-2s", { color: "#f3e7d3", roughness: 0.62, metalness: 0, side: THREE.DoubleSide })
		return piece(g)
	}
	addModel("raw-egg", "shell-1", halfShell(-1))
	addModel("raw-egg", "shell-2", halfShell(1))
	addModel("raw-egg", "spill", ({ props }) => {
		const L = Number(props?.length) || 0.057
		// a pool of egg white wider than its thin collider (it is a liquid: nothing rests on its rim) and the yolk, a low dome
		const pool = kit.mesh(kit.cylinderY(L * 0.85, 0.0026, 48), whiteMat, { cast: false })
		pool.scale.set(1, 1, 0.82)
		at(pool, 0, -0.0027, 0)
		const yolk = kit.mesh(kit.sphere(0.013, 32, 16), yolkMat)
		yolk.scale.set(1, 0.42, 1)
		at(yolk, L * 0.08, -0.0012, 0.004)
		return piece(kit.group(pool, yolk))
	})

	// ============================================================== drinking glass and its shards
	addModel("drinking-glass", "glass", ({ props }) => {
		const d = Number(props?.diameter) || 0.075
		const h = Number(props?.height) || 0.1
		const ro = d / 2
		const rb = (0.84 * d) / 2
		const wall = 0.0025
		const base = 0.007
		const rAt = (y) => rb + ((ro - rb) * y) / h
		const prof = [[0, 0], [rb - 0.002, 0], [rb, 0.002], [rAt(h), h], [rAt(h) - wall, h], [rAt(base) - wall, base + 0.002], [rAt(base) - wall - 0.003, base], [0, base]]
		const geo = kit.lathe(prof, 64, `fracture-glass|${f5(d)}|${f5(h)}`)
		return kit.group(kit.mesh(geo, glassMat))
	})
	const sliver = (part) => ({ solid }) => {
		const pts = (solid.body?.points ?? []).map((p) => [p.x, p.y])
		if (pts.length < 3) return null
		const geo = kit.extrude(pts, 0.004, { bevel: 0.0008, key: `fracture-sliver|${part}|${JSON.stringify(pts)}` })
		const m = kit.mesh(geo, shardMat)
		at(m, 0, 0, (solid.body?.depth ?? 0.07) * 0.32)
		return piece(kit.group(m))
	}
	for (let k = 1; k <= 5; k++) addModel("drinking-glass", `shard-${k}`, sliver(`shard-${k}`))

	// ============================================================== ceramic plate and its sherds
	const plateProfile = (d, h) => {
		const R = d / 2
		const f = 0.36 * R
		return [[0, 0.003], [f * 0.9, 0.003], [f, 0], [f + 0.003, 0], [f + 0.006, 0.004], [R * 0.6, 0.0045], [R * 0.86, 0.45 * h], [R, 0.7 * h], [R * 0.985, 0.8 * h], [R * 0.95, h], [R * 0.92, h * 0.95], [R * 0.82, 0.62 * h], [R * 0.6, 0.0085], [0, 0.0085]]
	}
	addModel("ceramic-plate", "plate", ({ props }) => {
		const d = Number(props?.diameter) || 0.26
		const h = Number(props?.height) || 0.025
		const R = d / 2
		const g = kit.group(kit.mesh(kit.lathe(plateProfile(d, h), 72, `fracture-plate|${f5(d)}|${f5(h)}`), ceramic))
		const line = kit.mesh(kit.torus(R * 0.965, 0.0011, 6, 96), blueLine, { cast: false })
		line.rotation.x = Math.PI / 2
		at(line, 0, h * 0.93, 0)
		g.add(line)
		return g
	})
	const sherd = (part) => ({ solid }) => {
		const pts = (solid.body?.points ?? []).map((p) => [p.x, p.y])
		if (pts.length < 3) return null
		const dd = (solid.body?.depth ?? 0.26) * 0.4
		const m = kit.mesh(kit.extrude(pts, dd, { bevel: 0.0008, key: `fracture-sherd|${part}|${JSON.stringify(pts)}|${f5(dd)}` }), ceramic)
		return piece(kit.group(m))
	}
	for (let k = 1; k <= 4; k++) addModel("ceramic-plate", `sherd-${k}`, sherd(`sherd-${k}`))

	// ============================================================== padding
	const padLooks = {
		foam: () => kit.mat("fracture|pu-foam", { color: "#e9d27a", roughness: 0.96, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color("#fff0b0") }),
		"packing foam": () => kit.mat("fracture|eps", { color: "#f5f5f0", roughness: 0.9, metalness: 0, map: beads() }),
		"bubble wrap": () => kit.mat("fracture|bubble", { color: "#e8f3f6", roughness: 0.12, metalness: 0, transmission: 0.7, thickness: 0.004, ior: 1.45, transparent: true, clearcoat: 1 }),
		"cotton balls": () => kit.mat("fracture|cotton", { color: "#fcfcf8", roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color("#ffffff") }),
		"pillow stuffing": () => kit.fabric("#eef2f6"),
		"crumpled paper": () => kit.mat("fracture|newsprint", { color: "#e8e3d4", roughness: 0.95, metalness: 0, map: newsprint() }),
		"folded towel": () => kit.fabric("#6fa8cf"),
		carpet: () => kit.fabric("#7a5a4a")
	}
	function beads() {
		return kit.tex("fracture-eps", 256, 256, (g, w, h) => {
			g.fillStyle = "#f4f4ef"
			g.fillRect(0, 0, w, h)
			let s = 7
			const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
			for (let i = 0; i < 420; i++) {
				const x = r() * w
				const y = r() * h
				const rad = 5 + r() * 6
				g.strokeStyle = "rgba(170,170,160,0.45)"
				g.beginPath()
				g.arc(x, y, rad, 0, Math.PI * 2)
				g.stroke()
			}
		})
	}
	function newsprint() {
		return kit.tex("fracture-news", 256, 256, (g, w, h) => {
			g.fillStyle = "#ebe6d6"
			g.fillRect(0, 0, w, h)
			g.fillStyle = "rgba(60,60,60,0.35)"
			for (let y = 6; y < h; y += 7) for (let x = 4; x < w; x += 46) g.fillRect(x, y, 36 + ((x * 7 + y) % 9), 2)
		})
	}
	/** Padding as it looks: a block of it, or a layer of what it is made of (bubbles, balls). w, h, d: its box; key: the cache key. */
	const paddingOf = (material, w, h, d, key) => {
		const look = (padLooks[material] ?? padLooks.foam)()
		const g = kit.group()
		const r = Math.min(h / 2, Math.min(w, d) / 8, 0.01)
		if (material === "cotton balls" || material === "crumpled paper") {
			// a heap of balls filling the box (the outline's box is its collider)
			const rad = material === "cotton balls" ? Math.min(0.012, h / 2) : Math.min(0.02, h / 2)
			const nx = Math.max(1, Math.floor(w / (1.6 * rad)))
			const nz = Math.max(1, Math.floor(d / (1.6 * rad)))
			const ny = Math.max(1, Math.round(h / (1.5 * rad)))
			const geos = []
			let s = 11
			const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
			const sph = material === "cotton balls" ? new THREE.IcosahedronGeometry(rad, 2) : new THREE.IcosahedronGeometry(rad, 1)
			for (let iy = 0; iy < ny; iy++)
				for (let ix = 0; ix < nx; ix++)
					for (let iz = 0; iz < nz; iz++) {
						const x = -w / 2 + rad + ((w - 2 * rad) * (ix + 0.5)) / nx - ((w - 2 * rad) * 0.5) / nx + (rnd() - 0.5) * rad * 0.5
						const y = -h / 2 + rad + (ny > 1 ? ((h - 2 * rad) * iy) / (ny - 1) : (h - 2 * rad) / 2)
						const z = -d / 2 + rad + ((d - 2 * rad) * (iz + 0.5)) / nz - ((d - 2 * rad) * 0.5) / nz + (rnd() - 0.5) * rad * 0.5
						const q = sph.clone()
						const k = 0.85 + rnd() * 0.3
						q.scale(k, Math.min(k, (h / 2) / rad), k)
						q.rotateY(rnd() * 3)
						q.translate(x, Math.min(h / 2 - rad * 0.6, Math.max(-h / 2 + rad * 0.6, y)), z)
						geos.push(q)
						if (geos.length > 600) break
					}
			const base = kit.mesh(kit.box(w * 0.98, h * 0.55, d * 0.98, r * 0.5), look)
			at(base, 0, -h * 0.2, 0)
			g.add(base, kit.mesh(kit.merge(geos, `fracture-heap|${material}|${key}`), look))
			return g
		}
		if (material === "bubble wrap") {
			const layers = Math.max(1, Math.round(h / 0.005))
			const film = kit.mesh(kit.box(w, h * 0.9, d, 0.002), look)
			g.add(film)
			const geos = []
			const rad = 0.0045
			for (let x = -w / 2 + rad * 1.4; x < w / 2 - rad; x += rad * 2.6) for (let z = -d / 2 + rad * 1.4; z < d / 2 - rad; z += rad * 2.6) geos.push(new THREE.SphereGeometry(rad, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(x, h / 2 - 0.0026, z))
			if (geos.length) g.add(kit.mesh(kit.merge(geos.slice(0, 1500), `fracture-bubbles|${key}`), look))
			void layers
			return g
		}
		if (material === "pillow stuffing") {
			// a fiberfill pillow: a puffy, rounded case
			const geo = kit.geo(`fracture-pillow|${key}`, () => {
				const b = new THREE.BoxGeometry(w, h, d, 16, 6, 16)
				const p = b.attributes.position
				for (let i = 0; i < p.count; i++) {
					const x = p.getX(i) / (w / 2)
					const y = p.getY(i) / (h / 2)
					const z = p.getZ(i) / (d / 2)
					const puff = (1 - x * x * x * x) * (1 - z * z * z * z)
					p.setY(i, (y * h) / 2 * (0.55 + 0.45 * puff))
					p.setX(i, (x * w) / 2 * (1 - 0.04 * (1 - y * y)))
					p.setZ(i, (z * d) / 2 * (1 - 0.04 * (1 - y * y)))
				}
				b.computeVertexNormals()
				return b
			})
			g.add(kit.mesh(geo, look))
			return g
		}
		g.add(kit.mesh(kit.box(w, h, d, material === "folded towel" ? Math.min(h / 2.2, 0.012) : r), look))
		if (material === "folded towel") for (let k = 1; k < 3; k++) g.add(at(kit.mesh(kit.box(w * 0.995, 0.0012, d * 0.995, 0.0005), kit.fabric("#5d95bb"), { cast: false }), 0, -h / 2 + (h * k) / 3, 0))
		return g
	}
	addModel("cushion", "pad", ({ w, h, d, props }) => {
		const mat = props?.material ?? "foam"
		const inner = paddingOf(mat, w, h, d, `${mat}|${f5(w)}|${f5(h)}|${f5(d)}`)
		inner.name = "squash"
		const g = kit.group(inner)
		inner.userData.frame = { hook: "fracture:squash", h }
		return g
	})
	addFrameHook("fracture:squash", (obj, f, a) => {
		const s = Math.max(0, Number(f.state?.squash) || 0)
		const h = Number(a.h) || 0.05
		const k = Math.max(0.15, 1 - s / h)
		obj.scale.y = k
		obj.position.y = -(h * (1 - k)) / 2
	})

	// ============================================================== egg-drop box
	addModel("egg-drop-box", "box", ({ w, props }) => {
		const s = w
		const t = 0.003
		const g = kit.group()
		// five walls of corrugated board (the front is cut away to show the inside)
		const wallBox = (bw, bh, bd, x, y, z) => g.add(at(kit.mesh(kit.box(bw, bh, bd, 0.0008), [card, card, card, card, cardIn, card]), x, y, z))
		wallBox(s, t, s, 0, -s / 2 + t / 2, 0)
		wallBox(s, t, s, 0, s / 2 - t / 2, 0)
		wallBox(t, s, s, -s / 2 + t / 2, 0, 0)
		wallBox(t, s, s, s / 2 - t / 2, 0, 0)
		wallBox(s, s, t, 0, 0, -s / 2 + t / 2)
		// a cut edge round the opening
		const edge = kit.mat("fracture|card-edge", { color: "#8e6a44", roughness: 1, metalness: 0 })
		for (const [bw, bh, x, y] of [[s, 0.004, 0, s / 2 - 0.002], [s, 0.004, 0, -s / 2 + 0.002], [0.004, s, -s / 2 + 0.002, 0], [0.004, s, s / 2 - 0.002, 0]]) g.add(at(kit.mesh(kit.box(bw, bh, 0.002, 0.0005), edge, { cast: false }), x, y, s / 2 - 0.001))
		// the padding: filling the back half and lining the floor and lid round the egg
		const pad = props?.padding ?? "cotton balls"
		const pt = Number(props?.padding_thickness)
		if (pad !== "none" && pt > 0) {
			const inner = s - 2 * t
			const back = paddingOf(pad, inner, inner, inner * 0.45, `box-back|${pad}|${f5(inner)}`)
			at(back, 0, 0, -inner / 2 + (inner * 0.45) / 2)
			g.add(back)
			const lay = Math.min(pt, inner / 2 - 0.023)
			if (lay > 0.002) {
				const floor = paddingOf(pad, inner, lay, inner * 0.55, `box-floor|${pad}|${f5(inner)}|${f5(lay)}`)
				at(floor, 0, -inner / 2 + lay / 2, inner * 0.225)
				const lid = paddingOf(pad, inner, lay, inner * 0.55, `box-floor|${pad}|${f5(inner)}|${f5(lay)}`)
				at(lid, 0, inner / 2 - lay / 2, inner * 0.225)
				g.add(floor, lid)
			}
		}
		// a "FRAGILE" label on the side
		const label = kit.mesh(new THREE.PlaneGeometry(s * 0.6, s * 0.16), kit.mat("fracture|fragile", { map: kit.text("fracture-fragile", "FRAGILE", { bg: "#c49a6c", fg: "#b3261e", font: "800 90px Helvetica, Arial, sans-serif", w: 512, h: 128 }), roughness: 0.9, metalness: 0 }), { cast: false })
		label.rotation.y = Math.PI / 2
		at(label, s / 2 + 0.0004, s * 0.28, 0)
		g.add(label)
		return g
	})
	addModel("egg-drop-box", "egg", () => {
		const L = 0.057
		const W = 0.044
		const stain = kit.mesh(kit.sphere(0.03, 24, 12), kit.mat("fracture|stain", { color: "#e9a52a", roughness: 0.3, metalness: 0, transparent: true, opacity: 0.85, clearcoat: 0.6 }), { cast: false })
		stain.scale.set(1.4, 0.18, 1.1)
		at(stain, 0.004, -W / 2 + 0.002, 0)
		stain.name = "stain"
		stain.visible = false
		const g = kit.group(eggMesh(L, W), crackOf(L, W), stain)
		g.userData.frame = { hook: "fracture:crack" }
		return g
	})
	// the parachutes: a dome of plastic on four lines over the box, swaying with it
	addViewPlugin({
		name: "fracture:chutes",
		load(ctx) {
			const boxes = ctx.itemsOfType("egg-drop-box").filter((id) => Number(ctx.resolved?.[id]?.parachute) > 0)
			if (!boxes.length) return null
			const canopyMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#e2453c"), roughness: 0.4, metalness: 0, side: THREE.DoubleSide, sheen: 0.4, clearcoat: 0.3 })
			const lineMat = new THREE.LineBasicMaterial({ color: "#3b3b3b" })
			const made = []
			for (const id of boxes) {
				const P = ctx.resolved[id]
				const D = Number(P.parachute)
				const s = Number(P.size) || 0.15
				const lift = s / 2 + 0.6 * D
				const dome = new THREE.Mesh(new THREE.SphereGeometry(D / 2, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), canopyMat)
				dome.scale.set(1, 0.55, 1)
				dome.castShadow = true
				const rim = (D / 2) * Math.sin(Math.PI * 0.42)
				const rimY = lift + (D / 2) * Math.cos(Math.PI * 0.42) * 0.55 - (D / 2) * 0.55
				dome.position.y = lift - (D / 2) * 0.55 + 0.0
				const pos = []
				for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
					pos.push((cx * s) / 2, s / 2, (cz * s) / 2, (cx * rim) / Math.SQRT2, rimY, (cz * rim) / Math.SQRT2)
				}
				const lg = new THREE.BufferGeometry()
				lg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
				const lines = new THREE.LineSegments(lg, lineMat)
				const holder = new THREE.Group()
				holder.add(dome, lines)
				ctx.group.add(holder)
				made.push({ id, holder, lines, dome, domeY: dome.position.y, D, s, lift, sid: `${id}/box`, geos: [dome.geometry, lg] })
			}
			// (when each box lands: its first stop after falling; the canopy then sinks onto it and slumps to one side)
			for (const m of made) {
				const f = ctx.track?.frames ?? []
				let fell = false
				m.land = Infinity
				for (let k = 1; k < f.length; k++) {
					const a = f[k - 1].placements[m.sid]
					const b = f[k].placements[m.sid]
					if (!a || !b) continue
					const vy = (b.y - a.y) / Math.max(1e-6, f[k].t - f[k - 1].t)
					if (vy < -0.5) fell = true
					else if (fell && vy > -0.05) {
						m.land = f[k].t
						break
					}
				}
			}
			return {
				frame(t) {
					for (const m of made) {
						const p = ctx.placementAt(m.sid, t)
						if (!p) continue
						const u = Math.min(1, Math.max(0, (t - m.land) / 0.7))
						// (slumped: the canopy beside the box, lying flat on what the box landed on)
						m.holder.position.set(p.x, p.y, 0)
						m.holder.rotation.z = p.angle * (1 - u)
						m.dome.position.set(u * (m.D * 0.55 + m.s / 2), m.domeY * (1 - u) + (-m.s / 2 + 0.003) * u, 0)
						m.dome.scale.set(1, 0.55 * (1 - 0.85 * u), 1)
						m.lines.visible = u < 0.4
						m.holder.visible = (p.scale ?? 1) > 0.5
					}
				},
				dispose() {
					for (const m of made) for (const g of m.geos) g.dispose()
					canopyMat.dispose()
					lineMat.dispose()
				}
			}
		}
	})

	// ============================================================== snapping bridge
	addModel("snap-bridge", "support-left", ({ w, h, d }) => kit.group(kit.mesh(kit.box(w, h, d, 0.002), wood)))
	addModel("snap-bridge", "support-right", ({ w, h, d }) => kit.group(kit.mesh(kit.box(w, h, d, 0.002), wood)))
	const strandLooks = {
		spaghetti: () => kit.mat("fracture|pasta", { color: "#eccb75", roughness: 0.45, metalness: 0, clearcoat: 0.25, transmission: 0.15, thickness: 0.002 }),
		chalk: () => kit.mat("fracture|chalk", { color: "#f8f7f2", roughness: 1, metalness: 0 }),
		"craft sticks": () => kit.wood("#e3cb98", { roughness: 0.7, varnish: 0 }),
		"chocolate bar": () => kit.mat("fracture|choc", { color: "#5c3820", roughness: 0.42, metalness: 0, clearcoat: 0.3 })
	}
	/** The strands of a beam, length `len`, in a box h tall and d deep (centred on the origin), x segments for bending. */
	const strandsOf = (made, n, len, h, d, key) => {
		const look = (strandLooks[made] ?? strandLooks.spaghetti)()
		const segs = Math.max(2, Math.round(len / 0.004))
		if (made === "chocolate bar") {
			const geos = []
			const cell = 0.03
			const k = Math.max(1, Math.round(len / cell))
			for (let j = 0; j < Math.max(1, n); j++)
				for (let i = 0; i < k; i++)
					geos.push(new THREE.BoxGeometry(len / k - 0.0015, h * 0.98, Math.min(0.035, d / Math.max(1, n)) - 0.002, 2, 2, 2).translate(-len / 2 + (len / k) * (i + 0.5), 0, -d / 2 + (d / Math.max(1, n)) * (j + 0.5)))
			return kit.mesh(kit.merge(geos, `fracture-choc|${key}`), look)
		}
		if (made === "craft sticks") {
			const geos = []
			const sw = Math.min(0.01, d / Math.max(1, n))
			for (let j = 0; j < n; j++) geos.push(new THREE.BoxGeometry(len, 0.002, sw * 0.96, segs, 1, 1).translate(0, 0, -d / 2 + sw * (j + 0.5)))
			return kit.mesh(kit.merge(geos, `fracture-sticks|${key}`), look)
		}
		const dia = made === "chalk" ? 0.01 : 0.00175
		const geos = []
		for (let j = 0; j < n; j++) {
			const z = -d / 2 + (d / n) * (j + 0.5)
			const c = new THREE.CylinderGeometry(dia / 2, dia / 2, len, made === "chalk" ? 16 : 8, segs).rotateZ(Math.PI / 2)
			c.translate(0, ((j * 7919) % 5) * 0.00008 - 0.00016, z)
			geos.push(c)
		}
		return kit.mesh(kit.merge(geos, `fracture-strands|${made}|${key}`), look)
	}
	addModel("snap-bridge", "beam", ({ w, h, d, props }) => {
		const made = props?.made_of ?? "spaghetti"
		const n = Math.max(1, Math.round(Number(props?.strands) || 5))
		const m = strandsOf(made, n, w, h, d, `${made}|${n}|${f5(w)}|${f5(h)}|${f5(d)}`)
		m.name = "strands"
		const span = Number(props?.span) || w - 0.04
		m.userData.frame = { hook: "fracture:sag", half: span / 2 + 0.01, scaled: false }
		return kit.group(m)
	})
	addFrameHook("fracture:sag", (obj, f, a) => {
		const sag = Math.min(SAG_DRAWN, Math.max(0, Number(f.state?.sag) || 0))
		if (!obj.userData._bent) {
			if (sag === 0) return
			obj.geometry = obj.geometry.clone()
			obj.userData._bent = { base: obj.geometry.attributes.position.array.slice(), shown: -1 }
		}
		const b = obj.userData._bent
		if (Math.abs(b.shown - sag) < 1e-5) return
		b.shown = sag
		const p = obj.geometry.attributes.position
		const half = Number(a.half) || 0.1
		for (let i = 0; i < p.count; i++) {
			const x = b.base[3 * i]
			const u = Math.min(1, Math.abs(x) / half)
			p.setY(i, b.base[3 * i + 1] - sag * (1 - u * u))
		}
		p.needsUpdate = true
	})
	for (let k = 1; k <= 6; k++)
		addModel("snap-bridge", `piece-${k}`, ({ w, h, d, props }) => {
			const made = props?.made_of ?? "spaghetti"
			const n = Math.max(1, Math.round(Number(props?.strands) || 5))
			return piece(kit.group(strandsOf(made, n, w, h, d, `${made}|${n}|${f5(w)}|${f5(h)}|${f5(d)}|piece`)))
		})

	// ============================================================== block tower
	const tapeMat = kit.mat("fracture|tape", { color: "#efe2b6", roughness: 0.75, metalness: 0 })
	const glueMat = kit.mat("fracture|glue", { color: "#fbfbf7", roughness: 0.2, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.8 })
	const tackMat = kit.mat("fracture|tack", { color: "#3d8fd6", roughness: 0.6, metalness: 0 })
	for (let k = 1; k <= 20; k++)
		addModel("block-tower", `block${k}`, ({ w, h, d, props }) => {
			const g = kit.group(kit.mesh(kit.box(w, h, d, 0.0015), wood))
			const n = Math.round(Number(props?.blocks) || 6)
			const glue = props?.glue ?? "none"
			if (k < n && glue !== "none") {
				// (what holds it to the block above, drawn at its top face)
				if (glue === "tape") for (const z of [d / 2 + 0.0003, -d / 2 - 0.0003]) for (const x of [-w * 0.28, w * 0.28]) g.add(at(kit.mesh(kit.box(0.019, Math.min(0.04, h * 0.9), 0.0005, 0.0002), tapeMat, { cast: false }), x, h / 2, z))
				else if (glue === "sticky tack") for (const x of [-w * 0.3, w * 0.3]) g.add(at(kit.mesh(kit.sphere(0.004, 12, 8), tackMat, { cast: false }), x, h / 2, d / 2 - 0.004))
				else g.add(at(kit.mesh(kit.box(w * 0.98, 0.0012, d * 0.98, 0.0004), glueMat, { cast: false }), 0, h / 2, 0))
			}
			return g
		})

	// ============================================================== window pane and its shards
	const paneMat = kit.mat("fracture|pane", { color: "#eef7f7", roughness: 0.02, metalness: 0, transmission: 0.92, thickness: 0.003, ior: 1.52, transparent: true, opacity: 0.55, clearcoat: 1, specularIntensity: 1 })
	const extent = (solid) => {
		const pts = solid?.body?.points ?? []
		if (!pts.length) return null
		const xs = pts.map((p) => p.x)
		const ys = pts.map((p) => p.y)
		return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), d: solid.body?.depth ?? 0.6 }
	}
	addModel("window-pane", "pane", ({ solid }) => {
		const e = extent(solid)
		if (!e) return null
		const m = kit.mesh(kit.box(e.x1 - e.x0, e.y1 - e.y0, e.d, 0.0004), paneMat, { cast: false })
		return kit.group(at(m, (e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2, 0))
	})
	// (the frame's sill carries the two side stiles up to its head: the side view sees only the sill and the head)
	addModel("window-pane", "frame-bottom", ({ w, h, d, props }) => {
		const H = Number(props?.height) || 0.6
		const g = kit.group(kit.mesh(kit.box(w, h, d, 0.002), wood))
		const tall = h + H + 0.04
		for (const z of [d / 2 - 0.02, -(d / 2 - 0.02)]) g.add(at(kit.mesh(kit.box(w, tall, 0.04, 0.002), wood), 0, -h / 2 + tall / 2, z))
		return g
	})
	addModel("window-pane", "frame-top", ({ w, h, d }) => kit.group(kit.mesh(kit.box(w, h, d, 0.002), wood)))
	const jag = (k, n) => {
		// (a fixed, jagged break line across the pane's width: the same for the shard above and below it)
		const pts = []
		for (let i = 0; i <= n; i++) pts.push((((k * 7 + i * 13) % 11) / 11 - 0.5) * 0.05)
		return pts
	}
	for (let k = 1; k <= 5; k++)
		addModel("window-pane", `shard-${k}`, ({ solid }) => {
			const e = extent(solid)
			if (!e) return null
			const n = 6
			const lo = k > 1 ? jag(k - 1, n) : new Array(n + 1).fill(0)
			const hi = k < 5 ? jag(k, n) : new Array(n + 1).fill(0)
			const W = e.d
			const outline = []
			for (let i = 0; i <= n; i++) outline.push([-W / 2 + (W * i) / n, e.y0 + lo[i]])
			for (let i = n; i >= 0; i--) outline.push([-W / 2 + (W * i) / n, e.y1 + hi[i]])
			const geo = kit.extrude(outline, Math.max(0.002, e.x1 - e.x0), { key: `fracture-pane-shard|${k}|${f5(W)}|${f5(e.y0)}|${f5(e.y1)}|${f5(e.x1 - e.x0)}` })
			const m = kit.mesh(geo, shardMat)
			m.rotation.y = Math.PI / 2
			at(m, (e.x0 + e.x1) / 2, 0, 0)
			return piece(kit.group(m))
		})
}
