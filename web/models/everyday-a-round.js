// Round things: paper rolls, tube, soda can (standing and on its side), apple, orange, candle. (helpers: everyday-a-lib.js)
export default function register(addModel, L) {
	const { THREE, kit, TAU, rng, vnoise, fbm, clamp, mix, shade, blend, rich, C, normalTex, normalFromField, dataTex, mat, colorTex, withRepeat, rr, fibres, pixels, spaced, plate, rrect, latheLin } = L
	const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
	const deepen = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getStyle()
	const sm = (t) => t * t * (3 - 2 * t)
	/** Turn a group built along y (centred) so its axis runs along z (toward the camera). */
	const alongZ = (g) => {
		g.rotation.x = Math.PI / 2
		return kit.group(g)
	}
	const length = (solid, props, fallback) => solid.depth3d ?? solid.length ?? props.length ?? fallback

	// ------------------------------------------------------------- paper rolls and the cardboard tube
	/** A roll of paper, axis along y (centred): layered end faces, an embossed outside, a cardboard core. */
	function makeRoll(o) {
		const { R, Ly, rh, wall = 0.0009, f = 0.0012, tone = "#f7f7f4", emboss, print, tag } = o
		const rc = rh + wall
		const group = kit.group()
		const wrapN = normalTex(`roll-emboss|${emboss}`, 128, 128, (g, W, H) => {
			g.fillStyle = "#707070"
			g.fillRect(0, 0, W, H)
			g.strokeStyle = "#d8d8d8"
			g.fillStyle = "#e8e8e8"
			if (emboss === "diamond") {
				g.lineWidth = 3
				for (let i = -8; i <= 16; i++) { g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + 128, 128); g.stroke(); g.beginPath(); g.moveTo(i * 16, 128); g.lineTo(i * 16 + 128, 0); g.stroke() }
				for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.beginPath(); g.arc(i * 16 + 8, j * 16 + 8, 2.5, 0, TAU); g.fill() }
			} else {
				for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.beginPath(); g.arc(i * 16 + (j % 2) * 8 + 4, j * 16 + 8, 4.5, 0, TAU); g.fill() }
			}
		}, { strength: 1.5, blur: 0.8 })
		const circ = TAU * R
		const outerCol = colorTex(`roll-out|${tag}|${tone}`, 1024, 256, (g, W, H) => {
			g.fillStyle = tone
			g.fillRect(0, 0, W, H)
			fibres(g, W, H, 4, { n: 3000, alpha: 0.025, len: 5 })
			if (print) print(g, W, H)
			// where the last sheet ends: a faint step in the shading around u = 0.62
			const x = W * 0.62
			const gr = g.createLinearGradient(x - 8, 0, x + 8, 0)
			gr.addColorStop(0, "rgba(0,0,0,0)")
			gr.addColorStop(0.5, "rgba(0,0,0,0.2)")
			gr.addColorStop(0.52, "rgba(255,255,255,0.35)")
			gr.addColorStop(1, "rgba(255,255,255,0)")
			g.fillStyle = gr
			g.fillRect(x - 8, 0, 16, H)
		})
		const embN = withRepeat(wrapN, Math.round(circ / 0.0125), Math.round(Ly / 0.0125))
		const outer = mat(`roll-outer|${tag}|${tone}|${emboss}`, { map: outerCol, normalMap: embN, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.93, metalness: 0, sheen: 0.6, sheenRoughness: 0.7, sheenColor: "#ffffff" })
		group.add(kit.mesh(new THREE.CylinderGeometry(R, R, Ly - 2 * f, 128, 1, true), outer))
		// rounded shoulders
		const pts = []
		for (let k = 6; k >= 0; k--) { const a = (k / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(R - f + f * Math.sin(a), Ly / 2 - f + f * Math.cos(a))) }
		const shoulder = new THREE.LatheGeometry(pts, 128)
		const sTop = kit.mesh(shoulder, outer)
		const sBot = kit.mesh(shoulder, outer)
		sBot.scale.y = -1
		group.add(sTop, sBot)
		// the layered end faces: a spiral of sheet edges
		const ri = rc / (R - f)
		const endTex = colorTex(`roll-end|${tag}|${tone}|${ri.toFixed(3)}`, 1024, 1024, (g, W, H) => {
			g.fillStyle = shade(tone, 0.96)
			g.fillRect(0, 0, W, H)
			const r0 = (ri * W) / 2
			const r1 = W / 2
			const turns = Math.round((R - rc) / 0.00023)
			const rg = rng(12)
			g.lineWidth = Math.max(1, (r1 - r0) / turns * 0.9)
			g.beginPath()
			g.strokeStyle = `rgba(110,105,95,${0.14 + 0.22 * rg()})`
			const steps = turns * 48
			for (let i = 0; i <= steps; i++) {
				const t = i / steps
				const rad = r0 + (r1 - r0) * t
				const a = t * turns * TAU
				const x = W / 2 + Math.cos(a) * rad
				const y = H / 2 + Math.sin(a) * rad
				if (i === 0) g.moveTo(x, y)
				else g.lineTo(x, y)
				if (i % 48 === 0 && i > 0) { // end this turn at the point the next one starts from: no gap, so no wedge
					g.stroke()
					g.beginPath()
					g.moveTo(x, y)
					g.strokeStyle = `rgba(110,105,95,${0.14 + 0.22 * rg()})`
				}
			}
			g.stroke()
			// a little shade toward the hole and the rim
			const sh = g.createRadialGradient(W / 2, H / 2, r0, W / 2, H / 2, r1)
			sh.addColorStop(0, "rgba(0,0,0,0.22)")
			sh.addColorStop(0.08, "rgba(0,0,0,0)")
			sh.addColorStop(0.95, "rgba(0,0,0,0)")
			sh.addColorStop(1, "rgba(0,0,0,0.12)")
			g.fillStyle = sh
			g.fillRect(0, 0, W, H)
		})
		const endMat = mat(`roll-endmat|${tag}|${tone}|${ri.toFixed(3)}`, { map: endTex, roughness: 0.95, metalness: 0, sheen: 0.5, sheenRoughness: 0.8, sheenColor: "#ffffff" })
		const card = mat("roll-core", { color: "#b58a58", roughness: 0.95, metalness: 0, side: THREE.DoubleSide })
		const ringTop = new THREE.RingGeometry(rc, R - f, 128, 1).rotateX(-Math.PI / 2).translate(0, Ly / 2, 0)
		const coreTop = new THREE.RingGeometry(rh, rc, 96, 1).rotateX(-Math.PI / 2).translate(0, Ly / 2, 0)
		group.add(kit.mesh(ringTop, endMat), kit.mesh(coreTop, card))
		const ringBot = kit.mesh(ringTop, endMat)
		const coreBot = kit.mesh(coreTop, card)
		ringBot.scale.y = coreBot.scale.y = -1
		group.add(ringBot, coreBot)
		group.add(kit.mesh(new THREE.CylinderGeometry(rh, rh, Ly, 64, 1, true), card)) // the bore
		return group
	}

	addModel("toilet-paper-roll", "body", ({ r, solid, props }) => {
		const Ly = length(solid, props, 0.1)
		const rh = Math.min(props.hole ?? 0.04, 1.96 * r * 0.7) / 2
		return alongZ(makeRoll({ R: r, Ly, rh, tone: "#f8f8f5", emboss: "diamond", tag: "tp" }))
	})
	addModel("paper-towel-roll", "body", ({ r, solid, props }) => {
		const Ly = length(solid, props, 0.28)
		const rh = Math.min(props.hole ?? 0.045, 1.96 * r * 0.7) / 2
		const print = (g, W, H) => {
			// drawn in millimetres: u runs round the roll, v along it. A sheet is 150 mm round the roll; perforations run along the axis between sheets
			const Lmm = Ly * 1000
			const circ = TAU * r * 1000
			const nSheets = Math.max(1, Math.round(circ / 150))
			const sw = circ / nSheets
			g.save()
			g.scale(W / circ, H / Lmm)
			g.strokeStyle = "rgba(95,105,115,0.45)"
			g.lineWidth = 0.3
			g.setLineDash([1.3, 1.1])
			for (let k = 0; k < nSheets; k++) { g.beginPath(); g.moveTo(k * sw, 0); g.lineTo(k * sw, Lmm); g.stroke() }
			g.setLineDash([])
			const leaf = (x, y, ang, len) => {
				g.save(); g.translate(x, y); g.rotate(ang)
				g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, -len * 0.34, len, 0); g.quadraticCurveTo(len * 0.5, len * 0.34, 0, 0); g.fill()
				g.restore()
			}
			const sprig = (cx, cy, ang) => { // a stem with three pairs of small leaves and a terminal leaf
				g.save(); g.translate(cx, cy); g.rotate(ang); g.scale(1.9, 1.9)
				g.strokeStyle = "rgba(95,150,195,0.8)"; g.lineWidth = 0.35
				g.beginPath(); g.moveTo(-7, 0); g.lineTo(6, 0); g.stroke()
				g.fillStyle = "rgba(95,150,195,0.75)"
				for (let i = 0; i < 3; i++) { const x = -5 + i * 3.6; leaf(x, 0, -0.75, 4.2 - i * 0.5); leaf(x, 0, 0.75, 4.2 - i * 0.5) }
				leaf(5.5, 0, 0, 4.4)
				g.restore()
			}
			for (let k = 0; k < nSheets; k++) {
				const cx = (k + 0.5) * sw
				for (const y0 of [20, Lmm - 20]) { sprig(cx - 38, y0, 0); sprig(cx + 38, y0, Math.PI) }
				for (const y of [Lmm * 0.18, Lmm * 0.5, Lmm * 0.82]) sprig(cx, y, y === Lmm * 0.5 ? Math.PI / 2 : -Math.PI / 2)
			}
			g.fillStyle = "rgba(120,170,205,0.5)"
			g.fillRect(0, 34, circ, 0.5)
			g.fillRect(0, Lmm - 34.5, circ, 0.5)
			g.restore()
		}
		return alongZ(makeRoll({ R: r, Ly, rh, tone: "#fbfbf8", emboss: "dots", print, tag: "pt" }))
	})

	addModel("cardboard-tube", "body", ({ r, solid, props }) => {
		const Ly = length(solid, props, 0.3)
		const rIn = Math.min(props.hole ?? 0.051, 2 * r - 0.0008) / 2
		const group = kit.group()
		const strip = 0.085 // metres of axis one turn of the winding advances
		const kraft = "#b8895a"
		// one tile = one turn of the winding (a full circumference across, one 85 mm pitch along the axis), made once and repeated along the tube, so a new
		// length or diameter only re-uses it (the seam runs corner to corner of the tile and carries on into the next one)
		const colTile = colorTex("tube-col-tile", 512, 512, (g, W, H) => {
			const lo = document.createElement("canvas")
			lo.width = lo.height = 256
			pixels(lo.getContext("2d"), 256, 256, (x, y) => {
				const n = fbm((x / 256) * 7, (y / 256) * 7, 3, 9, 7)
				const m = fbm((x / 256) * 48, (y / 256) * 48, 2, 13, 48)
				return [(0.62 + 0.14 * n + 0.03 * m) * 255, (0.46 + 0.11 * n + 0.025 * m) * 255, (0.28 + 0.08 * n + 0.02 * m) * 255]
			})
			g.imageSmoothingEnabled = true
			g.drawImage(lo, 0, 0, W, H)
			fibres(g, W, H, 5, { n: 7000, alpha: 0.06, len: 9 })
			g.strokeStyle = "rgba(55,32,12,0.5)" // the butt seam of the winding: a thin dark line, nothing raised
			g.lineWidth = 1.3
			for (const ox of [-W, 0, W]) { g.beginPath(); g.moveTo(ox, 0); g.lineTo(ox + W, H); g.stroke() }
		})
		const nrmTile = normalTex("tube-n-tile", 256, 256, (g, W, H) => {
			g.fillStyle = "#808080"
			g.fillRect(0, 0, W, H)
			g.strokeStyle = "#202020" // a narrow recessed V (0.3 mm), no ridge beside it
			g.lineWidth = 2
			for (const ox of [-W, 0, W]) { g.beginPath(); g.moveTo(ox, 0); g.lineTo(ox + W, H); g.stroke() }
		}, { strength: 2, wrap: true, blur: 0.8 })
		const rep = Ly / strip
		const outer = mat(`tube-outer2|${Ly.toFixed(3)}|${r.toFixed(4)}`, { map: withRepeat(colTile, 1, rep), normalMap: withRepeat(nrmTile, 1, rep), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.9, metalness: 0 })
		group.add(kit.mesh(new THREE.CylinderGeometry(r, r, Ly, 128, 1, true), outer))
		const inner = mat("tube-inner", { color: "#8a6540", roughness: 0.95, side: THREE.BackSide })
		group.add(kit.mesh(new THREE.CylinderGeometry(rIn, rIn, Ly, 96, 1, true), inner))
		// the cut ends: the plies of the wall show as thin layers
		const edgeTex = colorTex("tube-end", 512, 512, (g, W, H) => {
			g.fillStyle = "#c79b66"
			g.fillRect(0, 0, W, H)
			g.strokeStyle = "rgba(90,55,25,0.5)"
			g.lineWidth = 1
			for (let k = 1; k < 4; k++) { g.beginPath(); g.arc(W / 2, H / 2, (W / 2) * (rIn / r + ((1 - rIn / r) * k) / 4), 0, TAU); g.stroke() }
			fibres(g, W, H, 7, { n: 2500, alpha: 0.12, len: 3 })
		})
		const endMat = mat("tube-end", { map: edgeTex, roughness: 0.95, metalness: 0 })
		const ring = new THREE.RingGeometry(rIn, r, 128, 1).rotateX(-Math.PI / 2).translate(0, Ly / 2, 0)
		const top = kit.mesh(ring, endMat)
		const bot = kit.mesh(ring, endMat)
		bot.scale.y = -1
		group.add(top, bot)
		return alongZ(group)
	})

	// ------------------------------------------------------------- soda can
	function makeCan({ D, H, tone, neck = 0.0026 }) {
		const R = D / 2
		const Rn = R - neck // the neck, inset (a 12 oz can narrows to about 54 mm at the seam; the standing one keeps to its 2.6 mm outline)
		const yw0 = 0.0046 // where the straight wall starts
		const yn = H - 0.0182 // where the shoulder starts
		const yt = H - 0.0058 // where the neck starts
		const yl = H - 0.0041 // the lid panel
		const Rl = Rn - 0.0034
		const group = kit.group()
		const base = rich(tone, 1.15, 0.72)
		const W = 2048
		const Hh = 1024
		const wrap = colorTex(`can-wrap6|${base}`, W, Hh, (g) => {
			const bg = g.createLinearGradient(0, 0, 0, Hh)
			bg.addColorStop(0, shade(base, 0.9))
			bg.addColorStop(0.5, shade(base, 1.02))
			bg.addColorStop(1, shade(base, 0.82))
			g.fillStyle = bg
			g.fillRect(0, 0, W, Hh)
			// a bright swoosh and a dark one across the label
			g.save()
			g.fillStyle = "rgba(255,255,255,0.96)"
			g.beginPath()
			g.moveTo(0, Hh * 0.62)
			g.bezierCurveTo(W * 0.25, Hh * 0.45, W * 0.45, Hh * 0.8, W * 0.7, Hh * 0.6)
			g.bezierCurveTo(W * 0.85, Hh * 0.48, W * 0.95, Hh * 0.52, W, Hh * 0.55)
			g.lineTo(W, Hh * 0.6)
			g.bezierCurveTo(W * 0.95, Hh * 0.57, W * 0.85, Hh * 0.53, W * 0.7, Hh * 0.65)
			g.bezierCurveTo(W * 0.45, Hh * 0.86, W * 0.25, Hh * 0.52, 0, Hh * 0.68)
			g.closePath()
			g.fill()
			g.restore()
			// the name and its lines, 22 degrees left of the middle (u = 0.5 faces the camera): the catalog card looks at a can from 32 degrees to the left, and the
			// wordmark (about 95 degrees across) then shows whole, from the front as well
			const lx = W * 0.5 - W * 0.06
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.font = `italic 900 ${Hh * 0.23}px 'Arial Black', Impact, ${SANS}`
			g.lineJoin = "round"
			g.lineWidth = Hh * 0.03
			g.strokeStyle = shade(base, 0.55)
			const kx = Math.min(1, (W * 0.26) / g.measureText("COLA").width)
			g.save()
			g.translate(lx, Hh * 0.32)
			g.scale(kx, 1)
			g.strokeText("COLA", 0, 0)
			g.fillStyle = "#fffaf0"
			g.fillText("COLA", 0, 0)
			g.restore()
			g.fillStyle = "#fffaf0"
			g.font = `italic 700 ${Hh * 0.052}px ${SANS}`
			spaced(g, "CLASSIC TASTE", lx, Hh * 0.55, Hh * 0.007)
			g.font = `700 ${Hh * 0.045}px ${SANS}`
			g.fillText("12 FL OZ (355 mL)", lx, Hh * 0.9)
			// a second small mark on the far side, bands near the top and bottom
			g.fillStyle = "rgba(255,255,255,0.9)"
			g.fillRect(0, Hh * 0.035, W, Hh * 0.012)
			g.fillRect(0, Hh * 0.953, W, Hh * 0.012)
			g.font = `800 ${Hh * 0.07}px ${SANS}`
			g.fillText("COLA", W * 0.0, Hh * 0.5)
			g.fillText("COLA", W * 1.0, Hh * 0.5)
			g.font = `600 ${Hh * 0.03}px ${SANS}`
			g.fillText("PLEASE RECYCLE", W * 0.0, Hh * 0.8)
			g.fillText("PLEASE RECYCLE", W * 1.0, Hh * 0.8)
		})
		const wallMat = mat(`can-wall2|${base}`, { map: wrap, metalness: 0.78, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.12, color: "#ffffff" })
		const bare = mat("can-bare", { color: "#cfd3d8", metalness: 1, roughness: 0.28 })
		// the printed wall and shoulder
		const wall = []
		wall.push([R - 0.00005, yw0])
		wall.push([R, yw0 + 0.0002])
		wall.push([R, yn])
		const NS = 16
		for (let k = 1; k <= NS; k++) {
			const t = k / NS
			wall.push([R - (R - Rn) * sm(t), mix(yn, yt, t)])
		}
		group.add(kit.mesh(latheLin(wall, 128, yw0, yt), wallMat))
		// the bare bottom: dome inside, a bead to stand on, curving up into the wall
		const bottom = [[0, 0.0078], [0.0105, 0.0072], [0.0185, 0.0052], [0.0232, 0.0022], [0.0252, 0.0006], [0.0270, 0], [0.0289, 0.0002], [0.0304, 0.0010], [0.0318, 0.0024], [R - 0.0003, yw0 - 0.0006], [R - 0.00005, yw0]]
		group.add(kit.mesh(new THREE.LatheGeometry(bottom.map(([r, y]) => new THREE.Vector2(r, y)), 96), bare))
		// the neck, the double-seam rim and the inner wall down to the lid
		const top = [[Rn, yt], [Rn + 0.0002, H - 0.0046], [Rn + 0.0008, H - 0.0038], [Rn + 0.0012, H - 0.0027], [Rn + 0.0012, H - 0.0013], [Rn + 0.0006, H - 0.0003], [Rn - 0.0002, H], [Rn - 0.0011, H - 0.0001], [Rn - 0.0017, H - 0.0010], [Rn - 0.0019, H - 0.0024], [Rl + 0.0010, yl + 0.0004], [Rl, yl]]
		group.add(kit.mesh(new THREE.LatheGeometry(top.map(([r, y]) => new THREE.Vector2(r, y)), 96), bare))
		// the lid: a flat disc with a bead ring and the score of the opening (a teardrop, its point toward the rivet) in a normal map
		const tear = (g, cx, cy, L, Wd) => {
			g.beginPath()
			g.moveTo(cx + L * 0.5, cy)
			g.bezierCurveTo(cx + L * 0.12, cy - Wd, cx - L * 0.5, cy - Wd * 1.1, cx - L * 0.5, cy)
			g.bezierCurveTo(cx - L * 0.5, cy + Wd * 1.1, cx + L * 0.12, cy + Wd, cx + L * 0.5, cy)
			g.closePath()
		}
		const lidH = (g, Wc, Hc) => {
			g.fillStyle = "#808080"
			g.fillRect(0, 0, Wc, Hc)
			const c = Wc / 2
			g.strokeStyle = "#e0e0e0"
			g.lineWidth = Wc * 0.025
			g.beginPath(); g.arc(c, c, c * 0.9, 0, TAU); g.stroke()
			g.strokeStyle = "#202020"
			g.lineWidth = Wc * 0.012
			tear(g, c - c * 0.45, c, c * 0.8, c * 0.25); g.stroke()
			g.fillStyle = "#505050"
			tear(g, c - c * 0.45, c, c * 0.72, c * 0.21); g.fill()
		}
		const lidCol = colorTex("can-lid|c", 512, 512, (g, Wc, Hc) => {
			const c = Wc / 2
			g.fillStyle = "#d5d9de"
			g.fillRect(0, 0, Wc, Hc)
			fibres(g, Wc, Hc, 3, { n: 1500, alpha: 0.05, len: 8 })
			g.fillStyle = "rgba(120,126,134,0.55)" // the opening, a shade lower
			tear(g, c - c * 0.45, c, c * 0.72, c * 0.21); g.fill()
			// the tab's soft shadow on the lid
			const k = c / Rl
			const tx = 0.0036 * k, hl = 0.01175 * k, hw = 0.00675 * k
			g.save()
			g.shadowColor = "rgba(0,0,0,0.6)"
			g.shadowBlur = 12
			g.shadowOffsetX = 5
			g.shadowOffsetY = 6
			g.fillStyle = "#d5d9de"
			rr(g, c + tx - hl, c - hw, 2 * hl, 2 * hw, hw)
			g.fill()
			g.restore()
		})
		const lidMat = mat("can-lid", { map: lidCol, color: "#ffffff", metalness: 1, roughness: 0.3, normalMap: normalTex("can-lid", 512, 512, lidH, { strength: 2.2, wrap: false, blur: 1 }), normalScale: new THREE.Vector2(1, 1) })
		const lid = new THREE.CircleGeometry(Rl, 64).rotateX(-Math.PI / 2).translate(0, yl, 0)
		group.add(kit.mesh(lid, lidMat))
		// the pull tab: a 0.4 mm stamped plate with a real finger hole and a rolled edge, riveted at the middle with a domed rivet
		const tabShape = rrect(0.0235, 0.0135, 0.0067)
		const hole = new THREE.Path()
		hole.absellipse(0.0058, 0, 0.0052, 0.0034, 0, TAU, true)
		const tabGeo = plate(tabShape, 0, 0.0004, { bevel: 0.00018, holes: [hole] })
		const tab = kit.mesh(tabGeo, [bare, bare])
		tab.position.set(0.0036, yl + 0.00045, 0)
		group.add(tab)
		const riv = new THREE.LatheGeometry([[0, 0], [0.0019, 0], [0.0019, 0.0003], [0.0014, 0.0008], [0.0006, 0.00105], [0, 0.0011]].map(([r, y]) => new THREE.Vector2(r, y)), 20)
		const rivet = kit.mesh(riv, bare)
		rivet.position.set(-0.0028 + 0.0036, yl + 0.00045 + 0.0002, 0)
		group.add(rivet)
		return group
	}
	addModel("soda-can", "body", ({ body, w, h, color }) => {
		// a slab outline (the can's 2.6 mm neck is all it can allow) or, once the catalog gives the can a polygon outline, the real tapered neck: the width of the outline 2.7 mm below the top
		// is where the rolled rim is widest, which fixes how far the neck is drawn in
		let D = w, H = h, neck = 0.0026
		if (body.kind === "polygon") {
			const xs = body.points.map((p) => p.x), ys = body.points.map((p) => p.y)
			D = Math.max(...xs) - Math.min(...xs)
			H = Math.max(...ys) - Math.min(...ys)
			const y = Math.max(...ys) - 0.0027
			const hi = []
			for (let i = 0; i < body.points.length; i++) {
				const a = body.points[i], b = body.points[(i + 1) % body.points.length]
				if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) { const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x); hi.push(Math.abs(x)) }
			}
			if (hi.length) neck = clamp(D / 2 - (Math.max(...hi) - 0.0012), 0.0005, 0.012)
		}
		const g = makeCan({ D, H, tone: color || "#c0392b", neck })
		g.position.y = -H / 2
		return kit.group(g)
	})
	addModel("soda-can-side", "body", ({ r, solid, props, color }) => {
		const Ly = length(solid, props, 0.1224)
		const g = makeCan({ D: 2 * r, H: Ly, tone: color || "#c0392b", neck: 0.0055 }) // lying down, the neck runs along z, which the circle outline does not limit
		g.position.y = -Ly / 2
		return alongZ(kit.group(g))
	})

	// ------------------------------------------------------------- apple
	addModel("apple", "ball", ({ r, color }) => {
		const tone = color || "#c0392b"
		const group = kit.group()
		const SEG = 112
		const RING = 72
		const geo = new THREE.SphereGeometry(r, SEG, RING)
		{
			const p = geo.attributes.position
			const v = new THREE.Vector3()
			for (let i = 0; i < p.count; i++) {
				v.fromBufferAttribute(p, i)
				const rho = v.length()
				const th = Math.acos(clamp(v.y / rho, -1, 1))
				const ph = Math.atan2(v.z, v.x)
				let f = 1
				// shoulders a touch wider than the base: the apple narrows toward the foot (at most 2.8% of r, well inside the ball's outline)
				f -= 0.028 * sm(clamp((th - 1.45) / 1.4))
				// the stem cavity (top): about 14 mm wide and 6.5 mm deep, steep-sided; the calyx basin (bottom)
				const t0 = 0.2
				if (th < t0) f -= (0.0065 / r) * Math.pow(1 - (th / t0) ** 2, 1.6)
				const b0 = 0.2
				const tb = Math.PI - th
				if (tb < b0) f -= (0.0045 / r) * Math.pow(1 - (tb / b0) ** 2, 1.6)
				// five lobes round the calyx, strongest at the bottom
				const low = sm(clamp((th - 1.5) / 1.1))
				const lobes = 0.5 + 0.5 * Math.cos(5 * ph + 0.5)
				f -= 0.014 * low * (1 - lobes) * (1 + 0.8 * sm(clamp((th - 2.3) / 0.5)))
				f += 0.006 * (fbm(Math.cos(ph) * 2 + 3, Math.sin(ph) * 2 + th * 2.2, 3, 17) - 0.5)
				p.setXYZ(i, (v.x / rho) * r * f, (v.y / rho) * r * f, (v.z / rho) * r * f)
			}
			{ // pin the extremes: the lowest lobe tips at exactly -r and the shoulders at +r, so it rests where the ball does
				let lo = 0, hi = 0
				for (let i = 0; i < p.count; i++) { lo = Math.min(lo, p.getY(i)); hi = Math.max(hi, p.getY(i)) }
				for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setY(i, y < 0 ? (y * r) / -lo : (y * r) / hi) }
			}
			geo.computeVertexNormals()
		}
		const skin = colorTex(`apple-skin2|${tone}`, 768, 384, (g) => {
			const SW = 768, SH = 384
			const rg = rng(2024)
			const redc = C(rich(tone, 1.25, 0.55)).convertLinearToSRGB()
			const red = [redc.r * 255, redc.g * 255, redc.b * 255]
			const base = [208, 190, 78] // the yellow-green ground that shows near the cavity, the base and on the shaded side
			const cov = (u) => sm(clamp(((0.5 + 0.5 * Math.cos(u * TAU - 1.1)) * 1.2 - 0.05) / 0.45)) // how red the skin is round the apple
			// the colour field at a quarter of the resolution (smooth, so it is cheap), scaled up
			const LW = 192, LH = 96
			const lo = document.createElement("canvas")
			lo.width = LW
			lo.height = LH
			pixels(lo.getContext("2d"), LW, LH, (x, y) => {
				const u = x / LW, v = y / LH
				const m = fbm(u * 5, v * 5, 2, 5, 5)
				let t = clamp(cov(u) * (0.8 + 0.4 * m) + 0.04)
				t *= 1 - 0.8 * sm(clamp((Math.abs(v - 0.5) - 0.34) / 0.16))
				return [mix(base[0], red[0], t), mix(base[1], red[1], t), mix(base[2], red[2], t)]
			})
			g.imageSmoothingEnabled = true
			g.drawImage(lo, 0, 0, SW, SH)
			// fine striations: thin meridian strokes, darker red and a few orange, densest where the red gives way to the ground
			g.lineCap = "round"
			const dark = red.map((v) => Math.round(v * 0.5))
			const warm = [Math.round(mix(red[0], 235, 0.45)), Math.round(mix(red[1], 120, 0.45)), Math.round(mix(red[2], 40, 0.45))]
			for (let i = 0; i < 7000; i++) {
				const x = rg() * SW
				const y0 = SH * (0.07 + 0.8 * rg())
				const len = SH * (0.04 + 0.12 * rg())
				const cv = cov(x / SW)
				if (rg() > 0.25 + 1.6 * cv * (1 - cv) + 0.5 * cv) continue
				const c = rg() < 0.85 ? dark : warm
				g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.04 + 0.14 * rg()) * (0.5 + cv)})`
				g.lineWidth = 0.55 + 0.7 * rg()
				const dx1 = (rg() - 0.5) * 5, dx2 = (rg() - 0.5) * 7
				for (const ox of x < 12 ? [0, SW] : x > SW - 12 ? [0, -SW] : [0]) {
					g.beginPath()
					g.moveTo(x + ox, y0)
					g.quadraticCurveTo(x + ox + dx1, y0 + len / 2, x + ox + dx2, y0 + len)
					g.stroke()
				}
			}
			// lenticels: small pale freckles, stretched where the surface is
			for (let i = 0; i < 900; i++) { // small, faint and denser toward the calyx
				const y = SH * (0.1 + 0.8 * Math.pow(rg(), 0.65))
				g.fillStyle = `rgba(255,238,180,${0.1 + 0.15 * rg()})`
				const sz = 0.4 + rg() * 0.6
				g.beginPath(); g.ellipse(rg() * SW, y, (sz * 1.4) / Math.max(0.35, Math.sin(Math.PI * y / SH)), sz, 0, 0, TAU); g.fill()
			}
			// russet in the stem cavity and the calyx
			const ru = g.createLinearGradient(0, 0, 0, SH * 0.1)
			ru.addColorStop(0, "rgba(100,70,30,0.95)")
			ru.addColorStop(1, "rgba(100,70,30,0)")
			g.fillStyle = ru
			g.fillRect(0, 0, SW, SH * 0.1)
			const rb = g.createLinearGradient(0, SH, 0, SH * 0.93)
			rb.addColorStop(0, "rgba(60,40,15,0.95)")
			rb.addColorStop(1, "rgba(60,40,15,0)")
			g.fillStyle = rb
			g.fillRect(0, SH * 0.93, SW, SH * 0.07)
		})
		const bumpN = normalTex("apple-pits2", 256, 128, (g, W2, H2) => pixels(g, W2, H2, (x, y) => { const v = 120 + 90 * fbm(x / 3.5, y / 3.5, 2, 21, 73); return [v, v, v] }), { strength: 0.9 })
		const appleMat = mat(`apple-skin2|${tone}`, { map: skin, normalMap: bumpN, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.4, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.25 })
		group.add(kit.mesh(geo, appleMat))
		// stem: short, woody, bent a little; its tip at most 1.6 mm above the apple's outline (a sold apple has no leaf)
		const stemPts = [[0, r - 0.0068, 0], [0.0004, r - 0.0038, 0.0002], [0.0010, r - 0.0010, 0.0003], [0.0017, r + 0.0014, 0.0004]].map((a) => new THREE.Vector3(...a))
		const stemGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stemPts), 10, 0.00095, 8, false)
		const wood = mat("apple-stem", { color: "#5a3c24", roughness: 0.85, metalness: 0 })
		group.add(kit.mesh(stemGeo, wood))
		const cut = kit.mesh(new THREE.CircleGeometry(0.00095, 8).rotateX(-Math.PI / 2).translate(0.0017, r + 0.0014, 0.0004), mat("apple-stem-cut", { color: "#8a6a44", roughness: 0.9 }))
		group.add(cut)
		return group
	})

	// the orange's pore height field, W x H texels over the sphere (u around, v from the stem to the navel): the pits of a 67 mm orange, made once and shared by every orange
	let poreCache = null
	function poreField(PW, PH) {
		if (poreCache) return poreCache
		const r = 0.0335
		const f = new Float32Array(PW * PH)
		const rg = rng(909)
		const spacing = 0.0009
		const dth = spacing / r
		const nb = Math.max(8, Math.round(Math.PI / dth))
		for (let j = 0; j < nb; j++) {
			const th0 = ((j + 0.5) / nb) * Math.PI
			const n = Math.max(1, Math.round((TAU * r * Math.sin(th0)) / spacing))
			const off = rg()
			for (let k = 0; k < n; k++) {
				const phi = ((k + off + (rg() - 0.5) * 0.8) / n) * TAU
				const th = th0 + (rg() - 0.5) * 0.8 * (Math.PI / nb)
				const Rm = (0.00032 + 0.00012 * rg()) // pit radius, m
				const depth = 0.55 + 0.45 * rg()
				const cy = (th / Math.PI) * PH, cx = (phi / TAU) * PW
				const ry = (Rm / (Math.PI * r)) * PH
				const rx = Math.min(14, (Rm / (TAU * r * Math.max(0.12, Math.sin(th)))) * PW)
				const wy = Math.ceil(ry * 1.6), wx = Math.ceil(rx * 1.6)
				const icx = Math.round(cx), icy = Math.round(cy)
				const fx = (cx - icx) / rx, fy = (cy - icy) / ry, ix = 1 / rx, iy = 1 / ry
				for (let dy = -wy; dy <= wy; dy++) {
					const y = icy + dy
					if (y < 0 || y >= PH) continue
					const b = (dy * iy - fy) * (dy * iy - fy)
					for (let dx = -wx; dx <= wx; dx++) {
						const a = dx * ix - fx
						const rho2 = a * a + b // the pit's radius squared (1 = its edge)
						if (rho2 >= 2.56) continue
						let h = 0
						if (rho2 < 1) { const q = 1 - rho2; h = -depth * q * q }
						if (rho2 > 0.64) { const t = (Math.sqrt(rho2) - 1.15) / 0.35; if (t > -1 && t < 1) { const u = 1 - t * t; h += 0.22 * depth * u * u } } // the faint raised rim
						let x = icx + dx
						x = x < 0 ? x + PW : x >= PW ? x - PW : x
						f[y * PW + x] += h
					}
				}
			}
		}
		poreCache = f
		return f
	}

	// ------------------------------------------------------------- orange
	addModel("orange", "ball", ({ r, color }) => {
		const tone = color || "#f07c12"
		const group = kit.group()
		const geo = new THREE.SphereGeometry(r, 128, 80)
		{
			const p = geo.attributes.position
			const v = new THREE.Vector3()
			for (let i = 0; i < p.count; i++) {
				v.fromBufferAttribute(p, i)
				const rho = v.length()
				const th = Math.acos(clamp(v.y / rho, -1, 1))
				let f = 1
				if (th < 0.16) f -= (0.0016 / r) * Math.pow(1 - (th / 0.16) ** 2, 2) // the stem scar
				const tb = Math.PI - th
				// the navel, about 4 mm across: a small dimple with a puckered ring round it and a little nub in the middle
				if (tb < 0.075) f -= (0.0012 / r) * Math.pow(1 - (tb / 0.075) ** 2, 2)
				f += (0.0007 / r) * Math.exp(-(((tb - 0.058) / 0.011) ** 2)) * (0.6 + 0.4 * Math.cos(11 * Math.atan2(v.z, v.x)))
				f += (0.0009 / r) * Math.exp(-((tb / 0.02) ** 2))
				f += 0.0045 * (fbm(v.x / rho * 2.5 + 7, v.y / rho * 2.5 + v.z / rho * 3, 3, 3) - 0.5) // centred on 0: it does not shrink the ball
				p.setXYZ(i, (v.x / rho) * r * f, (v.y / rho) * r * f, (v.z / rho) * r * f)
			}
			{ // the extremes at exactly +-r so it rests where the ball does
				let lo = 0, hi = 0
				for (let i = 0; i < p.count; i++) { lo = Math.min(lo, p.getY(i)); hi = Math.max(hi, p.getY(i)) }
				for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setY(i, y < 0 ? (y * r) / -lo : (y * r) / hi) }
			}
			geo.computeVertexNormals()
		}
		const W = 2048, Hh = 1024
		// the oil glands: small sunken pits on a jittered grid about 0.9 mm apart (even, as on a real peel), each with a faint raised rim; one float height field (no 8-bit steps), made once and
		// shared by the colour map (a darker orange in the pits) and the normal map
		const PW = 1536, PH = 768
		const pits = poreField(PW, PH) // laid out for the 67 mm orange and scaled with the ball (the pits grow with it), so a resize does not redo it
		const peelC = colorTex(`orange-peel|${tone}`, W, Hh, (g) => {
			const base = rich(tone, 1.35, 0.8)
			g.fillStyle = base
			g.fillRect(0, 0, W, Hh)
			const rg = rng(7)
			for (let i = 0; i < 260; i++) { // large soft patches of lighter and deeper orange
				const x = rg() * W, y = rg() * Hh, s = 80 + rg() * 220
				const gr = g.createRadialGradient(x, y, 0, x, y, s)
				gr.addColorStop(0, rg() < 0.5 ? "rgba(255,170,60,0.035)" : "rgba(200,60,0,0.08)")
				gr.addColorStop(1, "rgba(0,0,0,0)")
				g.fillStyle = gr
				g.fillRect(x - s, y - s, 2 * s, 2 * s)
			}
			{ // the pits: a darker, redder orange where the glands sink in (the height field, scaled up to this map)
				const ov = document.createElement("canvas")
				ov.width = PW
				ov.height = PH
				const og = ov.getContext("2d")
				const im = og.createImageData(PW, PH)
				const px = new Uint32Array(im.data.buffer)
				for (let i = 0; i < pits.length; i++) {
					const dd = pits[i]
					if (dd < 0) px[i] = (Math.min(255, -dd * 190) << 24) | 0x00003c96 // rgb(150, 60, 0) with the depth as alpha
				}
				og.putImageData(im, 0, 0)
				g.drawImage(ov, 0, 0, W, Hh)
			}
			// the stem scar (top) and the navel (bottom): green-brown dots
			g.fillStyle = "rgba(90,100,30,0.8)"
			g.fillRect(0, 0, W, Hh * 0.02)
			g.fillStyle = "rgba(120,70,10,0.6)"
			g.fillRect(0, Hh * 0.975, W, Hh * 0.025)
			const rgN = rng(31) // the puckered navel: uneven wrinkles running out from the middle
			for (let i = 0; i < 46; i++) { const x = (i + rgN()) * (W / 46); g.strokeStyle = `rgba(95,50,5,${0.22 + 0.3 * rgN()})`; g.lineWidth = 1.5 + rgN() * 2; g.beginPath(); g.moveTo(x, Hh * (0.962 + 0.02 * rgN())); g.lineTo(x + Math.sin(i * 1.7) * 3, Hh * 0.995); g.stroke() }
			g.fillStyle = "rgba(150,110,30,0.55)"
			g.fillRect(0, Hh * 0.99, W, Hh * 0.01)
		})
		const peelN = normalFromField("orange-pores4", PW, PH, pits, { strength: 2.6, wrap: true })
		const m = mat(`orange-peel3|${tone}`, { map: peelC, normalMap: peelN, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.46, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4 })
		group.add(kit.mesh(geo, m))
		// the little button where it hung from the tree, in the scar
		const button = kit.mesh(new THREE.CylinderGeometry(0.0016, 0.0019, 0.0009, 12), mat("orange-button", { color: "#6a7a2a", roughness: 0.8 }))
		button.position.y = r - 0.0014 + 0.0004
		group.add(button)
		return group
	})

	// ------------------------------------------------------------- candle: a taper of ivory wax, a rounded shoulder, a shallow melt cup, a cotton wick with a charred tip
	addModel("candle", "body", ({ body, w, h, d }) => {
		// a slab outline (a straight rod that narrows 0.6 mm toward the top) or, once the catalog gives the candle a polygon outline, the real taper: the wall follows the outline 0.3 mm inside it
		let R = Math.min(w, d) / 2
		let Rt = R - 0.0006 // a dinner candle narrows a little toward the top (kept inside 1 mm of the outline)
		let footY = -h / 2 // where the foot of the candle is in the solid's frame
		if (body.kind === "polygon") {
			const ys = body.points.map((p) => p.y)
			h = Math.max(...ys) - Math.min(...ys)
			footY = Math.min(...ys)
		}
		const topY = h - 0.001 // where the rim of the melt cup stands: 1 mm under the top of the outline (the wick, in a 3.3 mm deep cup, still shows 4 mm)
		const cupD = 0.0033
		let wallAt = null // the wall's radius at a height above the foot (polygon outline only)
		if (body.kind === "polygon") {
			const y0 = Math.min(...body.points.map((p) => p.y))
			wallAt = (y) => {
				let hi = 0
				for (let i = 0; i < body.points.length; i++) {
					const a = body.points[i], b = body.points[(i + 1) % body.points.length]
					if ((a.y - (y + y0)) * (b.y - (y + y0)) <= 0 && a.y !== b.y) hi = Math.max(hi, Math.abs(a.x + (((y + y0) - a.y) / (b.y - a.y)) * (b.x - a.x)))
				}
				return hi - 0.0003
			}
			R = wallAt(0.0006)
			Rt = wallAt(topY)
		}
		const group = kit.group()
		const waxC = colorTex("candle-wax3", 256, 512, (g, W, H) => {
			// near-uniform ivory with faint, low-frequency mottling (wax scatters light: no streaks, no seam)
			pixels(g, W, H, (x, y) => {
				const n = fbm(x / 70, y / 140, 3, 11, 4)
				const m = fbm(x / 20, y / 40, 2, 17, 13)
				const k = 0.975 + 0.05 * (n - 0.5) + 0.02 * (m - 0.5) + 0.035 * (1 - sm(clamp(y / (0.05 * H)))) // the rim of the melt cup (the top of the map) is a little lighter
				return [244 * k, 236 * k, 216 * k]
			})
		})
		// wax scatters light: a little of it passes through (warm where it is thin), so the candle glows softly instead of reading as a matt white pipe
		const wax = mat("candle-wax3", { map: waxC, roughness: 0.5, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.45, sheen: 0.8, sheenRoughness: 0.4, sheenColor: "#fff1d6", emissive: "#ffe3b0", emissiveIntensity: 0.03,
			transmission: 0.22, thickness: 0.012, ior: 1.45, attenuationColor: new THREE.Color("#f3e0b4"), attenuationDistance: 0.02 })
		// the body: a straight foot, a long gentle taper, a rounded shoulder, then a shallow cup round the wick
		const prof = [[0, 0], [R - 0.0006, 0], [R, 0.0006]]
		if (wallAt) for (let k = 1; k <= 14; k++) { const y = mix(0.0006, topY - 0.0018, k / 14); prof.push([wallAt(y), y]) } // the outline's straight taper
		else {
			prof.push([R, 0.05])
			for (let k = 1; k <= 12; k++) { const t = k / 12; prof.push([mix(R, Rt, sm(t)), mix(0.05, topY - 0.0018, t)]) }
		}
		for (let k = 1; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); prof.push([Rt - 0.0009 * (1 - Math.cos(a)), topY - 0.0018 + 0.0018 * Math.sin(a)]) } // the shoulder, rounded over 0.9 mm
		prof.push([Rt - 0.0017, topY - 0.0003]) // the rim of the cup
		for (let k = 1; k <= 6; k++) { const t = k / 6; prof.push([(Rt - 0.0017) * (1 - t) + 0.0005 * t, topY - 0.0003 - cupD * Math.sin(t * Math.PI / 2)]) } // the cup floor
		group.add(kit.mesh(latheLin(prof, 64, 0, topY), wax))
		// the wick: cotton-white cord with a bend, charred black at the tip
		const wy = topY - 0.0003 - cupD - 0.0001
		const wickPts = [[0, wy, 0], [0.0001, wy + 0.0015, 0], [0.0003, wy + 0.003, 0.0001], [0.0008, h - 0.0001, 0.0001]].map((a) => new THREE.Vector3(...a))
		const wickGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wickPts), 12, 0.0006, 6, false)
		const wickTex = colorTex("candle-wick2", 8, 64, (g, W, H) => {
			const gr = g.createLinearGradient(0, 0, 0, H)
			gr.addColorStop(0, "#0a0806") // canvas top = the tip of the cord: charred
			gr.addColorStop(0.16, "#1a1511")
			gr.addColorStop(0.28, "#6b5a46")
			gr.addColorStop(0.45, "#e7ddc6")
			gr.addColorStop(1, "#f0e8d6")
			g.fillStyle = gr
			g.fillRect(0, 0, W, H)
		})
		{ // the tube's uv: u along, v around: turn it so the gradient runs along the cord
			const uv = wickGeo.attributes.uv
			for (let i = 0; i < uv.count; i++) { const u = uv.getX(i); uv.setXY(i, uv.getY(i), u) }
		}
		group.add(kit.mesh(wickGeo, mat("candle-wick2", { map: wickTex, roughness: 0.9, metalness: 0 })))
		group.position.y = footY
		return kit.group(group)
	})
}
