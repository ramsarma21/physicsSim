// The two stand-alone wheels: the solid wheel (a turned wooden toy wheel; steel, rubber, aluminium or concrete when the material is changed)
// and the bicycle wheel (a 622 mm alloy rim, 32 laced spokes, a hub with quick release and a road tyre with a valve).
// Both are built about the z axis (a rolling wheel's side view is its circle), so what you see is the physics circle exactly.
import { makeTurned } from "./vehicles-turned.js"

export default function register(addModel, L, kit) {
	const T = L.THREE
	const tw = makeTurned(L, kit)
	const { TAU, mix, rng, fbm, hash, shade, put, mat, decalMat, normalMap, M, revolveZ, roundedProfile, rod, merged } = L

	// ----------------------------------------------------------------- the solid wheel
	// A turned wheel (vehicles-turned.js): wood with end grain and long grain on the tread, machined steel with lathe rings, bead-blasted aluminium, grooved rubber on a steel hub, concrete;
	// every kind has an open axle bore with a sleeve in it and a chamfer ring round it.
	const KINDS = {
		"varnished hardwood": "wood",
		"dark wood": "darkwood",
		steel: "steel",
		aluminium: "alu",
		"solid rubber": "rubber",
		concrete: "concrete",
	}
	function solidWheel(ctx) {
		const kind = KINDS[ctx.props.material] ?? "wood"
		return tw.turnedWheel(kind, ctx.r, ctx.d, { color: ctx.solid.color ?? undefined, key: "solid", blocks: kind === "rubber" ? 40 : 0 })
	}

	const RIM_NEAR = "rot"
	const RIM_FAR = "none"
	// ----------------------------------------------------------------- the bicycle wheel
	function bikeWheel(ctx) {
		const R = ctx.r
		const k = R / 0.34
		const g = kit.group()
		const rt = 0.0145 * k // tyre section radius
		const Rs = R - 2 * rt // the bead seat
		const wr = 0.0105 * k // half the rim's width
		const Ri = Rs - 0.0215 * k // the rim's inner radius
		const zf = 0.029 * k // hub flange offset
		const rf = 0.0225 * k // hub flange radius
		const axleHalf = ctx.d / 2

		// ---- tyre: a near-round section, tread texture, lettering on the sidewalls
		const prof = []
		const N = 36
		const a0 = (-150 * Math.PI) / 180
		const a1 = (150 * Math.PI) / 180
		for (let i = 0; i <= N; i++) {
			const a = mix(a0, a1, i / N)
			prof.push([R - rt + rt * Math.cos(a), rt * Math.sin(a)])
		}
		const tyreGeo = revolveZ(prof, { segments: 160, key: `biketyre|${R.toFixed(5)}`, creaseDeg: 70 })
		const tex = kit.tex(`veh|biketyre|${rt.toFixed(5)}`, 4096, 256, (c, W4, H) => {
			// drawn on a virtual 8192 x 256 canvas (0.25 mm per pixel along the tread), squeezed to 4096 wide: the GPU's guaranteed texture size is 4096 (letter height lives on the 256 axis)
			const W = 2 * W4
			c.scale(0.5, 1)
			c.fillStyle = "#1a1b1d"
			c.fillRect(0, 0, W, H)
			// tread band in the middle of the profile: fine diamonds
			c.fillStyle = "#222426"
			for (let x = 0; x < W; x += 22) c.fillRect(x, H * 0.38, 12, H * 0.24)
			c.fillStyle = "#101112"
			c.fillRect(0, H * 0.495, W, H * 0.01)
			// sidewall lettering
			c.fillStyle = "#c9ccd1"
			c.font = "800 30px ui-sans-serif, Helvetica, Arial, sans-serif"
			c.textBaseline = "middle"
			const label = "ROADSTER  700 x 28C  (28-622)  MAX 120 PSI   "
			// the letters' tops face the tread on both sidewalls and read right from outside: the near (+z) wall (v about 0.19 on this canvas) is turned half a turn
			c.textAlign = "center"
			const lw = c.measureText(label).width
			for (const [v, rot] of [[0.19, true], [0.81, false]]) {
				for (let x = 200; x < W; x += lw * 1.1 + 1300) { // three runs of lettering per side, as on a real tyre
					c.save()
					c.translate(x + lw / 2, H * v)
					if (rot) c.rotate(Math.PI)
					c.fillText(label, 0, 0)
					c.restore()
				}
			}
			c.strokeStyle = "#7d8187"
			c.lineWidth = 3
			for (const v of [0.1, 0.3, 0.7, 0.9]) {
				c.beginPath()
				c.moveTo(0, H * v)
				c.lineTo(W, H * v)
				c.stroke()
			}
		}, { wrap: true })
		const nrm = normalMap("biketyre-n", 512, 128, (x, y) => 0.55 + 0.1 * (fbm(x / 4, y / 4, 2, 41, 0) - 0.5), { strength: 1.2 })
		const tyreMat = mat("biketyre", { map: tex, roughness: 0.78, metalness: 0, normalMap: nrm, normalScale: new T.Vector2(0.8, 0.8) })
		tyreMat.map.anisotropy = 16
		g.add(put(tyreGeo, tyreMat))

		// ---- rim: a brushed alloy box section with a printed label, spoke holes and brass nipples
		const rimProf = roundedProfile([[Ri, -wr], [Rs - 0.0006, -wr, 0.0016 * k], [Rs - 0.0006, wr, 0.0016 * k], [Ri, wr]], 5)
		const rimTex = kit.tex("veh|rimlabel", 4096, 128, (c, W, H) => {
			c.fillStyle = "#c4c9cf"
			c.fillRect(0, 0, W, H)
			c.fillStyle = "#2a2d32"
			c.font = "800 21px ui-sans-serif, Helvetica, Arial, sans-serif" // a real rim carries one or two small decals per side, not a printed band
			c.textBaseline = "middle"
			c.textAlign = "left"
			const L2 = "SANDBOX   622 x 19C   32H   "
			// the label on both side walls of the rim (the walls, not the seat under the tyre), tops toward the tyre, reading right on each side seen from outside
			c.textAlign = "center"
			for (const [yy, mode] of [[H * 0.17, RIM_NEAR], [H * 0.83, RIM_FAR]]) {
				const wl = c.measureText(L2).width
				for (const x of [W * 0.25 - wl / 2, W * 0.75 - wl / 2]) { // two decals, half a turn apart
					c.save()
					c.translate(x + wl / 2, yy)
					if (mode === "rot") c.rotate(Math.PI)
					else if (mode === "mx") c.scale(-1, 1)
					else if (mode === "my") c.scale(1, -1)
					c.fillText(L2, 0, 0)
					c.restore()
				}
			}
			const r = rng(8)
			for (let i = 0; i < 4000; i++) {
				c.fillStyle = `rgba(${r() < 0.5 ? 255 : 90},${r() < 0.5 ? 255 : 90},${r() < 0.5 ? 255 : 90},0.05)`
				c.fillRect(r() * W, r() * H, 3 + r() * 40, 1)
			}
		}, { wrap: true })
		const rimMat = mat("bikerim", { map: rimTex, roughness: 0.3, metalness: 0.9 })
		g.add(put(revolveZ(rimProf, { segments: 160, key: `bikerim|${R.toFixed(5)}`, creaseDeg: 55 }), rimMat))
		// nipples and holes round the inner radius
		const nipples = merged(`bikenipples|${k.toFixed(4)}`, () => {
			const list = []
			for (let i = 0; i < 32; i++) {
				const a = (i / 32) * TAU
				const cs = Math.cos(a)
				const sn = Math.sin(a)
				list.push(rod([(Ri - 0.0042 * k) * cs, (Ri - 0.0042 * k) * sn, 0], [(Ri + 0.0004) * cs, (Ri + 0.0004) * sn, 0], 0.0025 * k, 8))
			}
			return list
		})
		g.add(put(nipples, mat("nipple-brass", { color: "#c49a3a", roughness: 0.32, metalness: 1 })))

		// ---- spokes: 32, three-cross lacing, from the hub flanges to the rim
		const spokeGeo = merged(`bikespokes|${k.toFixed(4)}`, () => {
			const list = []
			const per = 16
			for (const s of [1, -1]) {
				for (let j = 0; j < per; j++) {
					const phi = (j / per) * TAU + (s > 0 ? 0 : TAU / (2 * per))
					const dir = (j + (s > 0 ? 0 : 1)) % 2 ? 1 : -1
					const phiRim = phi + dir * 3.3 * (TAU / per) // three-cross: each spoke runs across three of its neighbours
					const a = [(rf - 0.003 * k) * Math.cos(phi), (rf - 0.003 * k) * Math.sin(phi), s * (zf + 0.0008 * k)] // from a hole in the flange, not its edge
					const b = [(Ri - 0.0035 * k) * Math.cos(phiRim), (Ri - 0.0035 * k) * Math.sin(phiRim), 0]
					list.push(rod(a, b, 0.00095 * k, 6))
				}
			}
			return list
		})
		g.add(put(spokeGeo, M.steel("#b9bec5", 0.28)))
		// sixteen holes round each flange, a spoke head (a small elbow) in each
		const holes = merged(`bikeholes|${k.toFixed(4)}`, () => {
			const list = []
			for (const sg of [1, -1]) for (let j = 0; j < 16; j++) {
				const phi = (j / 16) * TAU + (sg > 0 ? 0 : TAU / 32)
				list.push(new T.CylinderGeometry(0.0017 * k, 0.0017 * k, 0.0003, 10).rotateX(Math.PI / 2).translate((rf - 0.003 * k) * Math.cos(phi), (rf - 0.003 * k) * Math.sin(phi), sg * (zf + 0.0016 * k + 0.00005)))
			}
			return list
		})
		g.add(put(holes, mat("flange-hole", { color: "#101113", roughness: 0.6, metalness: 0.3 })))
		const heads = merged(`bikeheads|${k.toFixed(4)}`, () => {
			const list = []
			for (const sg of [1, -1]) for (let j = 0; j < 16; j++) {
				if ((j + (sg > 0 ? 0 : 1)) % 2) continue // the spokes that pull the other way have their heads on the far side
				const phi = (j / 16) * TAU + (sg > 0 ? 0 : TAU / 32)
				list.push(new T.CylinderGeometry(0.0013 * k, 0.0013 * k, 0.0008, 8).rotateX(Math.PI / 2).translate((rf - 0.003 * k) * Math.cos(phi), (rf - 0.003 * k) * Math.sin(phi), sg * (zf + 0.0016 * k + 0.0004)))
			}
			return list
		})
		g.add(put(heads, M.steel("#b9bec5", 0.28)))

		// ---- hub: barrel, flanges, axle, nuts and a quick-release lever
		const alu = mat("bikehub", { color: "#c9ced4", roughness: 0.28, metalness: 1 })
		const hubProf = roundedProfile([
			[0.0075 * k, -0.0405 * k], [0.0092 * k, -0.0405 * k, 0.001 * k], [0.0092 * k, -zf - 0.0016 * k], [rf, -zf - 0.0016 * k, 0.0006 * k], [rf, -zf + 0.0016 * k, 0.0006 * k], [0.0128 * k, -zf + 0.0016 * k],
			[0.0112 * k, -0.01 * k], [0.0112 * k, 0.01 * k], [0.0128 * k, zf - 0.0016 * k], [rf, zf - 0.0016 * k, 0.0006 * k], [rf, zf + 0.0016 * k, 0.0006 * k], [0.0092 * k, zf + 0.0016 * k],
			[0.0092 * k, 0.0405 * k, 0.001 * k], [0.0075 * k, 0.0405 * k],
		], 4)
		g.add(put(revolveZ(hubProf, { segments: 48, key: `bikehub|${k.toFixed(4)}`, creaseDeg: 55 }), alu))
		const dark = M.steel("#4a4e55", 0.4)
		g.add(put(kit.cylinderZ(0.0046 * k, 2 * axleHalf - 0.0006, 20), M.steel("#9aa0a8", 0.28)))
		for (const s of [1, -1]) {
			g.add(put(new T.CylinderGeometry(0.0072 * k, 0.0072 * k, 0.007 * k, 6).rotateX(Math.PI / 2), M.steel("#aeb4bb", 0.25), 0, 0, s * (0.0405 * k + 0.0035 * k)))
		}
		// the skewer's cam and lever on the +z side: lying flat against the nut
		const cam = put(kit.cylinderZ(0.0068 * k, 0.0042 * k, 24), M.steel("#2d3035", 0.35), 0, 0, axleHalf - 0.0021 * k)
		g.add(cam)
		const lever = put(kit.box(0.034 * k, 0.0062 * k, 0.0026 * k, 0.0012 * k, 2), M.steel("#2d3035", 0.35), 0.0175 * k, 0, axleHalf - 0.0013 * k)
		lever.rotation.z = 0.9
		lever.position.set(0.0175 * k * Math.cos(0.9), 0.0175 * k * Math.sin(0.9), axleHalf - 0.0013 * k)
		g.add(lever)

		// ---- valve: a presta stem pointing at the hub from the rim, with its lock ring
		const va = Math.PI * 0.5
		const stem = put(kit.cylinderY(0.0024 * k, 0.034 * k, 12), M.steel("#aab0b8", 0.3), (Ri - 0.012 * k) * Math.cos(va), (Ri - 0.012 * k) * Math.sin(va), 0.0)
		stem.rotation.z = va - Math.PI / 2
		g.add(stem)
		return g
	}

	addModel("wheel", "wheel", solidWheel)
	addModel("bicycle-wheel", "wheel", bikeWheel)
}
