// Books and boxes: hardcover, paperback, cereal box, tissue box. (see everyday-a-lib.js for the helpers)
export default function register(addModel, L) {
	const { THREE, kit, TAU, rng, vnoise, fbm, clamp, mix, shade, blend, rich, normalTex, dataTex, mat, colorTex, withRepeat, loftX, ribbonX, rr, fibres, pixels, spaced, plate, rrect, rrectHole, decal } = L
	/** A hex colour made deeper (the scene's tone mapping lifts and greys colours, so cloth and card want more body than the nominal colour). */
	const deepen = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getStyle()
	const SERIF = "Georgia, 'Times New Roman', serif"
	const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"

	// ------------------------------------------------------------- cloth (book cloth weave) and paper edges
	const weaveN = () =>
		normalTex("weave", 128, 128, (g, W, H) => {
			pixels(g, W, H, (x, y) => {
				const warp = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) === 0
				const t = warp ? 0.5 + 0.5 * Math.cos(((x % 8) / 8) * TAU) : 0.5 + 0.5 * Math.cos(((y % 8) / 8) * TAU)
				const v = clamp(0.2 + 0.6 * t + (vnoise(x * 0.375, y * 0.375, 3, 48) - 0.5) * 0.25)
				const c = v * 255
				return [c, c, c]
			})
		}, { strength: 2.2 })
	/** Book cloth: matte with a soft sheen and a fine weave (rx, ry = weave tiles per metre of the face, ~3 mm a tile). `extra` may carry a bumpMap. */
	const cloth = (color, rx, ry, extra = {}, tag = "") =>
		mat(`cloth|${color}|${rx}|${ry}|${tag}`, {
			color, roughness: 0.92, metalness: 0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: shade(color, 1.25),
			normalMap: withRepeat(weaveN(), rx, ry), normalScale: new THREE.Vector2(0.9, 0.9), ...extra,
		})
	/** Cut paper edges: thin lines of sheets (tile is 1.6 mm tall); `tone` the paper colour. */
	const pageTile = (tone) =>
		colorTex(`pages|${tone}`, 64, 256, (g, W, H) => {
			const r = rng(11)
			g.fillStyle = tone
			g.fillRect(0, 0, W, H)
			for (let y = 0; y < H; y += 2) {
				g.fillStyle = `rgba(95,72,38,${0.14 + 0.34 * r()})`
				g.fillRect(0, y, W, 1 + (r() < 0.3 ? 1 : 0))
			}
			for (let i = 0; i < 40; i++) { // the odd tinted leaf
				g.fillStyle = `rgba(255,252,240,${0.22 + 0.2 * r()})`
				g.fillRect(0, r() * H, W, 1 + (r() < 0.5 ? 1 : 0))
			}
			fibres(g, W, H, 3, { n: 120, alpha: 0.06, len: 3 })
		}, { wrap: true })
	const pagesMat = (tone, rx, ry, tag) =>
		mat(`pagemat|${tone}|${rx}|${ry}|${tag}`, { map: withRepeat(pageTile(tone), rx, ry), roughness: 0.95, metalness: 0, sheen: 0.3, sheenRoughness: 0.9, sheenColor: "#fff4dc" })

	/** Rotates the drawing so a portrait cover reads upright on a landscape face whose canvas is W x H: (cover top = canvas left). */
	const rotCover = (g, W, H, draw) => {
		g.save()
		g.translate(0, H)
		g.rotate(-Math.PI / 2)
		draw(g, H, W)
		g.restore()
	}
	/** A material from drawers: paint(g, W, H, layer) draws the picture for each layer (colour, metal, rough). uvT maps a picture onto the plate's plan uv. */
	function foilMat(key, W, H, { paint, rx, ry, color, tag = "", uvT = (t) => t, bump = null }) {
		const map = uvT(colorTex(`${key}|c`, W, H, (g) => paint(g, W, H, "color")))
		const metal = uvT(dataTex(`${key}|m`, W, H, (g) => paint(g, W, H, "metal")))
		const rough = uvT(dataTex(`${key}|r`, W, H, (g) => paint(g, W, H, "rough")))
		return mat(`foil|${key}|${rx}|${ry}|${tag}`, {
			map, metalnessMap: metal, roughnessMap: rough, metalness: 1, roughness: 1, color: "#ffffff",
			normalMap: withRepeat(weaveN(), rx, ry), normalScale: new THREE.Vector2(0.8, 0.8),
			sheen: 0.3, sheenRoughness: 0.6, sheenColor: shade(color, 1.25), ...(bump ? { bumpMap: uvT(bump), bumpScale: 2.5 } : {}),
		})
	}
	const GOLD = { color: "#c8952f", metal: "#ffffff", rough: "#585858" } // fill for foil in each layer
	const inkOf = (layer, clothTone) => (layer === "color" ? clothTone : layer === "metal" ? "#000000" : "#e6e6e6") // the cloth itself in each layer

	// ------------------------------------------------------------- a generic case: two boards, a rounded spine, a block of leaves
	/** A groove picture (height map, white = high) across the board: a pressed channel `at` m from the spine joint, `gw` wide, on a canvas as tall as the board is deep. */
	const grooveBump = (key, bz, at, gw) =>
		dataTex(`groove|${key}`, 32, 1024, (g, W, H) => {
			g.fillStyle = "#c8c8c8"
			g.fillRect(0, 0, W, H)
			const py = (m) => H * (1 - m / bz) // canvas y of a distance m from the spine joint
			for (let y = Math.floor(py(at + 3 * gw)); y < py(at - 3 * gw); y++) {
				const m = (1 - (y + 0.5) / H) * bz - at
				const t = m / gw
				const v = 200 - 150 * Math.exp(-(t * t) * 5) + 22 * Math.exp(-((Math.abs(t) - 0.95) ** 2) * 14) // the channel with a pressed shoulder either side
				g.fillStyle = `rgb(${v},${v},${v})`
				g.fillRect(0, y, W, 1)
			}
		})
	function book(ctx, o) {
		const { w, h, d } = ctx
		const sq = Math.min(o.sq, w * 0.05, d * 0.05)
		const tb = Math.min(o.tb, h * 0.22)
		const bulge = Math.min(o.bulge, h * 0.3, d * 0.2)
		const R = (h * h / 4 + bulge * bulge) / (2 * bulge)
		const cl = Math.min(o.cl, (R - h / 2) * 0.9, h * 0.1)
		const cz = d / 2 - R
		const Ri = R - cl
		const Rp = Ri - 0.00025
		const zOut = (y) => cz + Math.sqrt(R * R - y * y)
		const zIn = (y) => cz + Math.sqrt(Ri * Ri - y * y)
		const zP = (y) => cz + Math.sqrt(Rp * Rp - y * y)
		const hb = h / 2 - tb - 0.0003
		const group = kit.group()

		// the spine: a thin curved shell the full length of the book
		const N = 18
		const outer = []
		const inner = []
		for (let k = 0; k <= N; k++) {
			const y = -h / 2 + (h * k) / N
			outer.push([y, zOut(y)])
		}
		for (let k = N; k >= 0; k--) {
			const y = -h / 2 + (h * k) / N
			inner.push([y, zIn(y)])
		}
		const nOuter = outer.length
		const sp = loftX([{ x: -w / 2, pts: [...outer, ...inner] }, { x: w / 2, pts: [...outer, ...inner] }])
		{
			const uv = sp.attributes.uv
			const m = outer.length + inner.length
			for (let i = 0; i < 2; i++) {
				for (let j = 0; j <= m; j++) uv.setY(i * (m + 1) + j, j < nOuter ? j / (nOuter - 1) : 0)
			}
		}
		group.add(kit.mesh(sp, [o.spine, o.edge]))

		// boards: rounded plates (plan corners rounded, edges bevelled); the printed cover maps onto the plan in metres
		const zB = zIn(h / 2) + 0.0004
		const bz = zB + d / 2
		const zc = (zB - d / 2) / 2
		const uvT = (t) => withRepeat(t, 1 / w, 1 / bz, 0.5, 0.5)
		const topM = o.top(uvT, bz)
		const botM = o.bottom(uvT, bz)
		const bev = Math.min(o.bev ?? 0.0007, tb / 2.4)
		const rc = o.corner ?? 0.0008
		const board = (y0, y1) => L.rrPlate(w, bz, rc, y0, y1, { bevel: bev }).translate(0, 0, zc)
		group.add(kit.mesh(board(h / 2 - tb, h / 2), [topM, o.edge]), kit.mesh(board(-h / 2, -h / 2 + tb), [botM, o.edge]))

		// the block of leaves: cut faces at head, tail and fore-edge; its back follows the spine
		const zf = -d / 2 + sq
		const bx = w / 2 - sq
		const pts = [[-hb, zf], [hb, zf], [hb, zP(hb)]]
		for (let k = 1; k < N; k++) {
			const y = hb - (2 * hb * k) / N
			pts.push([y, zP(y)])
		}
		pts.push([-hb, zP(-hb)])
		// a hair of chamfer at the sharp corners keeps their shading crisp
		const cham = []
		const e = 0.00018
		const hard = new Set([0, 1, 2, pts.length - 1])
		pts.forEach((p, i) => {
			if (!hard.has(i)) { cham.push(p); return }
			const a = pts[(i + pts.length - 1) % pts.length]
			const b = pts[(i + 1) % pts.length]
			const la = Math.hypot(a[0] - p[0], a[1] - p[1])
			const lb = Math.hypot(b[0] - p[0], b[1] - p[1])
			cham.push([p[0] + ((a[0] - p[0]) / la) * e, p[1] + ((a[1] - p[1]) / la) * e], [p[0] + ((b[0] - p[0]) / lb) * e, p[1] + ((b[1] - p[1]) / lb) * e])
		})
		const blk = loftX([{ x: -bx, pts: cham }, { x: bx, pts: cham }])
		let per = 0
		for (let i = 0; i < cham.length; i++) per += Math.hypot(cham[(i + 1) % cham.length][0] - cham[i][0], cham[(i + 1) % cham.length][1] - cham[i][1])
		const block = kit.mesh(blk, [pagesMat(o.paper, 1, per / 0.0016, "side"), pagesMat(o.paper, 1, (2 * hb) / 0.0016, "cap")])
		group.add(block)

		// headbands: a striped cord bent along the back of the block at head and tail (it follows the spine's curve, so it never meets the cloth)
		if (o.headband) {
			const rad = 0.0011
			const stripe = colorTex(`headband|${o.headband}`, 32, 64, (g, W, H) => {
				g.fillStyle = "#efe6cf"
				g.fillRect(0, 0, W, H)
				g.fillStyle = o.headband
				g.fillRect(0, 0, W, H / 2)
				for (let y = 0; y < H; y += 3) { g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(0, y, W, 1) }
			}, { wrap: true })
			const yh = hb * 0.94
			const cpts = []
			for (let k = 0; k <= 16; k++) {
				const y = -yh + (2 * yh * k) / 16
				cpts.push(new THREE.Vector3(0, y, zP(y) - rad - 0.0002))
			}
			const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cpts), 32, rad, 12, false)
			{ // tube uv is (along, around); the stripes want (around, along)
				const uv = tg.attributes.uv
				for (let i = 0; i < uv.count; i++) { const u = uv.getX(i); uv.setXY(i, uv.getY(i), u) }
			}
			const hm = mat(`headband|${o.headband}`, { map: withRepeat(stripe, 1, (2 * yh) / 0.0026), roughness: 0.85, sheen: 0.5, sheenColor: "#fff" })
			for (const s of [-1, 1]) {
				const hbm = kit.mesh(tg, hm)
				hbm.position.set(s * (bx + 0.0004), 0, 0)
				group.add(hbm)
			}
		}
		return group
	}

	// ------------------------------------------------------------- hardcover
	addModel("hardcover-book", "body", (ctx) => {
		const { w, h, d } = ctx
		const color = rich(ctx.color || "#7a2e2e", 1.1, 0.55)
		const tb = 0.0032
		const bulge = 0.0048
		const T = Math.round(1 / 0.0032) // weave tiles per metre of a board face
		const edge = cloth(color, T, T, {}, "edge")
		const GROOVE_AT = 0.0076 // the French groove: 7.6 mm from the spine joint, 1.5 mm wide, ~0.6 mm deep
		const GROOVE_W = 0.0015
		// front cover: cloth with a pressed hinge groove, a blind border and gold-stamped title
		const topMat = (uvT, bz) => {
			const CWpx = 1280
			const CHpx = Math.round((CWpx * bz) / w)
			return foilMat(`hc-cover|${color}|${w.toFixed(4)}|${bz.toFixed(5)}`, CWpx, CHpx, {
				rx: T, ry: T, color, uvT, bump: grooveBump(`hc|${bz.toFixed(5)}`, bz, GROOVE_AT, GROOVE_W),
				paint: (g, W, H, layer) => {
					const cloth0 = inkOf(layer, color)
					const gold = GOLD[layer]
					g.fillStyle = cloth0
					g.fillRect(0, 0, W, H)
					if (layer === "color") { // the cloth is mottled
						const r = rng(21)
						for (let i = 0; i < 700; i++) {
							g.fillStyle = `rgba(0,0,0,${0.02 + 0.04 * r()})`
							g.fillRect(r() * W, r() * H, 2 + r() * 40, 1 + r() * 3)
						}
					}
					rotCover(g, W, H, (g2, cw, ch) => {
						// the hinge groove near the spine edge (cover left): a darker pressed channel with a soft lip either side
						if (layer === "color") {
							const gx = (GROOVE_AT / bz) * cw, gw = (GROOVE_W / bz) * cw
							const gr = g2.createLinearGradient(gx - gw * 1.6, 0, gx + gw * 1.6, 0)
							gr.addColorStop(0, "rgba(0,0,0,0)")
							gr.addColorStop(0.28, "rgba(255,255,255,0.05)")
							gr.addColorStop(0.5, "rgba(0,0,0,0.46)")
							gr.addColorStop(0.72, "rgba(255,255,255,0.05)")
							gr.addColorStop(1, "rgba(0,0,0,0)")
							g2.fillStyle = gr
							g2.fillRect(gx - gw * 1.6, 0, gw * 3.2, ch)
						}
						g2.strokeStyle = layer === "color" ? "rgba(0,0,0,0.28)" : layer === "metal" ? "#000" : "#e6e6e6"
						g2.lineWidth = 3
						g2.strokeRect(cw * 0.16, ch * 0.05, cw * 0.78, ch * 0.9)
						g2.fillStyle = gold
						g2.strokeStyle = gold
						g2.textAlign = "center"
						g2.textBaseline = "middle"
						g2.font = `700 ${ch * 0.056}px ${SERIF}`
						spaced(g2, "MOMENTUM", cw * 0.55, ch * 0.3, ch * 0.012)
						g2.fillRect(cw * 0.3, ch * 0.36, cw * 0.5, 4)
						g2.font = `italic ${ch * 0.026}px ${SERIF}`
						g2.fillText("a story of things in motion", cw * 0.55, ch * 0.405)
						// a small stamped emblem: ring and a pendulum
						g2.lineWidth = 5
						g2.beginPath(); g2.arc(cw * 0.55, ch * 0.62, cw * 0.15, 0, TAU); g2.stroke()
						g2.lineWidth = 3
						g2.beginPath(); g2.arc(cw * 0.55, ch * 0.62, cw * 0.125, 0, TAU); g2.stroke()
						g2.lineWidth = 4
						g2.beginPath(); g2.moveTo(cw * 0.55, ch * 0.54); g2.lineTo(cw * 0.55 - cw * 0.05, ch * 0.66); g2.stroke()
						g2.beginPath(); g2.arc(cw * 0.55 - cw * 0.05, ch * 0.66, cw * 0.02, 0, TAU); g2.fill()
						g2.font = `600 ${ch * 0.02}px ${SERIF}`
						spaced(g2, "SANDBOX PRESS", cw * 0.55, ch * 0.9, ch * 0.006)
					})
				},
			})
		}
		const spineMat = foilMat(`hc-spine|${color}`, 2048, 256, {
			rx: Math.round(w / 0.0032), ry: 10, color,
			paint: (g, W, H, layer) => {
				g.fillStyle = inkOf(layer, color)
				g.fillRect(0, 0, W, H)
				g.fillStyle = GOLD[layer]
				for (const x of [0.07, 0.092, 0.908, 0.93]) g.fillRect(W * x, 0, x < 0.5 ? (x === 0.07 ? 5 : 3) : x === 0.93 ? 5 : 3, H) // bands across the spine
				for (const x of [0.2, 0.78]) { g.save(); g.translate(W * x, H * 0.5); g.rotate(Math.PI / 4); g.fillRect(-9, -9, 18, 18); g.restore() }
				g.textAlign = "center"
				g.textBaseline = "middle"
				g.font = `700 ${H * 0.34}px ${SERIF}`
				spaced(g, "MOMENTUM", W * 0.5, H * 0.5, H * 0.05)
				g.font = `600 ${H * 0.085}px ${SERIF}`
				spaced(g, "SANDBOX", W * 0.86, H * 0.5, H * 0.012)
			},
		})
		const bottomMat = () => cloth(color, T, T, {}, "bottom")
		return book(ctx, { tb, sq: 0.0032, bulge, cl: 0.0011, top: topMat, bottom: bottomMat, edge, spine: spineMat, paper: "#f0e7d0", headband: "#b3262e", corner: 0.0009, bev: 0.0008 })
	})

	// ------------------------------------------------------------- paperback
	addModel("paperback-book", "body", (ctx) => {
		const { w, h, d } = ctx
		const color = ctx.color || "#d9c7a0"
		const spineBg = "#1c3b50"
		const coverPaint = (g, cw, ch) => {
			// portrait cover: a night sky, a pale sun and a Newton's cradle swinging
			const sky = g.createLinearGradient(0, 0, 0, ch)
			sky.addColorStop(0, "#14283a")
			sky.addColorStop(0.55, "#2b5d73")
			sky.addColorStop(1, "#d9a35b")
			g.fillStyle = sky
			g.fillRect(0, 0, cw, ch)
			const sun = g.createRadialGradient(cw * 0.5, ch * 0.66, 4, cw * 0.5, ch * 0.66, cw * 0.55)
			sun.addColorStop(0, "rgba(255,236,190,0.95)")
			sun.addColorStop(0.35, "rgba(255,214,140,0.55)")
			sun.addColorStop(1, "rgba(255,200,120,0)")
			g.fillStyle = sun
			g.fillRect(0, 0, cw, ch)
			// the cradle
			const r = cw * 0.072
			const topY = ch * 0.43
			const L = ch * 0.17
			g.strokeStyle = "#e9dcc0"
			g.lineWidth = 4
			g.beginPath(); g.moveTo(cw * 0.17, topY); g.lineTo(cw * 0.93, topY); g.stroke() // the cradle sits toward the fore-edge, so the swung ball stays well inside the frame and clear of the hinge crease
			for (let i = 0; i < 5; i++) {
				const px = cw * 0.56 + (i - 2) * 2 * r
				const th = i === 0 ? 0.4 : 0
				const bx = px - L * Math.sin(th)
				const by = topY + L * Math.cos(th)
				g.strokeStyle = "rgba(240,230,205,0.85)"
				g.lineWidth = 2
				g.beginPath(); g.moveTo(px, topY); g.lineTo(bx, by); g.stroke()
				// a chrome ball: sky above a hard horizon line, warm ground below, a dark rim and one small hard highlight
				g.save()
				g.beginPath(); g.arc(bx, by, r, 0, TAU); g.clip()
				const hz = by + r * 0.08
				const sky = g.createLinearGradient(0, by - r, 0, hz)
				sky.addColorStop(0, "#f4f8fc")
				sky.addColorStop(1, "#8da3b8")
				g.fillStyle = sky
				g.fillRect(bx - r, by - r, 2 * r, hz - (by - r))
				const grd = g.createLinearGradient(0, hz, 0, by + r)
				grd.addColorStop(0, "#3b3027")
				grd.addColorStop(0.55, "#9a7a52")
				grd.addColorStop(1, "#e3cfa6")
				g.fillStyle = grd
				g.fillRect(bx - r, hz, 2 * r, by + r - hz)
				const rim = g.createRadialGradient(bx, by, r * 0.62, bx, by, r)
				rim.addColorStop(0, "rgba(8,14,24,0)")
				rim.addColorStop(1, "rgba(8,14,24,0.72)")
				g.fillStyle = rim
				g.fillRect(bx - r, by - r, 2 * r, 2 * r)
				g.fillStyle = "#ffffff"
				g.beginPath(); g.ellipse(bx - r * 0.38, by - r * 0.46, r * 0.14, r * 0.09, -0.6, 0, TAU); g.fill()
				g.restore()
				g.strokeStyle = "rgba(20,28,38,0.75)"
				g.lineWidth = 2
				g.beginPath(); g.arc(bx, by, r, 0, TAU); g.stroke()
			}
			// the title
			g.fillStyle = "#f2e6c9"
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.font = `700 ${cw * 0.125}px ${SERIF}`
			spaced(g, "MOMENTUM", cw * 0.5, ch * 0.16, cw * 0.012)
			g.fillRect(cw * 0.18, ch * 0.215, cw * 0.64, 3)
			g.font = `italic ${cw * 0.06}px ${SERIF}`
			g.fillText("a novel", cw * 0.5, ch * 0.26)
			g.font = `600 ${cw * 0.06}px ${SERIF}`
			spaced(g, "ADA SANDBOX", cw * 0.5, ch * 0.93, cw * 0.012)
			g.strokeStyle = "rgba(242,230,201,0.6)"
			g.lineWidth = 3
			g.strokeRect(cw * 0.04, ch * 0.025, cw * 0.92, ch * 0.95)
		}
		const backPaint = (g, cw, ch) => {
			g.fillStyle = "#1c3b50"
			g.fillRect(0, 0, cw, ch)
			g.fillStyle = "#f2e6c9"
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.font = `italic ${cw * 0.062}px ${SERIF}`
			g.fillText("“A gripping story of force,", cw * 0.5, ch * 0.14)
			g.fillText("motion and what happens next.”", cw * 0.5, ch * 0.18)
			g.font = `${cw * 0.04}px ${SANS}`
			const r = rng(8)
			for (let i = 0; i < 12; i++) {
				g.fillStyle = "rgba(242,230,201,0.55)"
				g.fillRect(cw * 0.1, ch * (0.28 + i * 0.03), cw * (0.62 + 0.28 * r()), 3)
			}
			g.fillStyle = "#f2e6c9"
			g.fillRect(cw * 0.16, ch * 0.76, cw * 0.36, ch * 0.14)
			g.fillStyle = "#14283a"
			for (let i = 0; i < 40; i++) g.fillRect(cw * 0.18 + i * (cw * 0.32 / 40), ch * 0.775, 1 + (r() < 0.4 ? 2 : 0), ch * 0.1)
			g.fillStyle = "#f2e6c9"
			g.font = `700 ${cw * 0.06}px ${SANS}`
			g.fillText("$9.99", cw * 0.8, ch * 0.83)
		}
		const spinePaint = (g, W, H) => {
			g.fillStyle = spineBg
			g.fillRect(0, 0, W, H)
			g.fillStyle = "#f2e6c9"
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.font = `700 ${H * 0.4}px ${SERIF}`
			spaced(g, "MOMENTUM", W * 0.45, H * 0.5, H * 0.04)
			g.font = `600 ${H * 0.18}px ${SERIF}`
			g.fillText("A. SANDBOX", W * 0.12, H * 0.5)
			g.fillText("●", W * 0.92, H * 0.5)
		}
		// covers: satin card (a light varnish), the plan uv scaled to the cover; a hinge crease pressed in near the spine of both covers
		const CREASE_AT = 0.0062
		const crease = (g, cw, ch, bz, layer) => { // in cover drawing space (cw across, spine edge at left)
			const gx = (CREASE_AT / bz) * cw
			const gw = Math.max(2, (0.0009 / bz) * cw)
			g.fillStyle = "rgba(0,0,0,0.30)"
			g.fillRect(gx - gw / 2, 0, gw, ch)
			g.fillStyle = "rgba(255,246,225,0.20)" // the whitened ridge beside the crease
			g.fillRect(gx + gw / 2, 0, gw * 0.8, ch)
			g.fillStyle = "rgba(255,246,225,0.10)"
			g.fillRect(gx - gw * 1.8, 0, gw * 0.8, ch)
		}
		const coverMat = (key, paint, bump) => (uvT, bz) => {
			const W = 1024
			const H = Math.round((W * bz) / w)
			const t = colorTex(`pb|${key}|${w.toFixed(4)}|${bz.toFixed(5)}`, W, H, (g, W2, H2) => {
				paint(g, W2, H2)
				g.save()
				g.translate(0, H2); g.rotate(-Math.PI / 2)
				crease(g, H2, W2, bz) // drawing space: x = along z (cw = H2), y = along x (ch = W2)
				g.restore()
			})
			return mat(`pb|${key}|${w.toFixed(4)}|${bz.toFixed(5)}`, {
				map: uvT(t), roughness: 0.55, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4,
				bumpMap: uvT(grooveBump(`pb|${bz.toFixed(5)}`, bz, CREASE_AT, 0.0009)), bumpScale: 1.6,
			})
		}
		const satin = (key, W, H, paint) => mat(`pb|${key}`, { map: colorTex(`pb|${key}`, W, H, paint), roughness: 0.55, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4 })
		const top = coverMat("front", (g, W, H) => { g.fillStyle = "#1c3b50"; g.fillRect(0, 0, W, H); rotCover(g, W, H, coverPaint); fibres(g, W, H, 2, { n: 2500, alpha: 0.04 }) })
		const bottom = coverMat("back", (g, W, H) => { rotCover(g, W, H, backPaint); fibres(g, W, H, 4, { n: 2500, alpha: 0.04 }) })
		const spine = satin("spine", 1536, 192, spinePaint)
		const edge = mat("pb|edge", { color: "#f0e6cf", roughness: 0.85, metalness: 0 })
		return book(ctx, { tb: 0.0005, sq: 0, bulge: 0.0012, cl: 0.0004, top, bottom, edge, spine, paper: "#efe2c2", corner: 0.0007, bev: 0.0002 })
	})

	// ------------------------------------------------------------- cereal box
	addModel("cereal-box", "body", ({ w, h, d, color }) => {
		const base = color || "#e0a030"
		const prn = (key, W, H, paint) => mat(`cb|${key}|${base}`, { map: colorTex(`cb|${key}|${base}`, W, H, (g) => { paint(g, W, H); fibres(g, W, H, 7, { n: 1800, alpha: 0.03 }) }), roughness: 0.48, metalness: 0, clearcoat: 0.28, clearcoatRoughness: 0.32 })
		const flake = (g, x, y, s, rot, seed) => {
			const r = rng(seed)
			g.save()
			g.translate(x, y)
			g.rotate(rot)
			g.beginPath()
			const n = 8
			for (let i = 0; i < n; i++) {
				const a = (i / n) * TAU
				const rr0 = s * (0.7 + 0.45 * r())
				const px = Math.cos(a) * rr0 * 1.25
				const py = Math.sin(a) * rr0 * 0.85
				if (i === 0) g.moveTo(px, py)
				else g.lineTo(px, py)
			}
			g.closePath()
			const gr = g.createLinearGradient(-s, -s, s, s)
			gr.addColorStop(0, "#f7cb62")
			gr.addColorStop(1, "#c4801f")
			g.fillStyle = gr
			g.fill()
			g.strokeStyle = "rgba(120,60,0,0.55)"
			g.lineWidth = Math.max(1, s * 0.07)
			g.stroke()
			g.fillStyle = "rgba(140,70,0,0.3)"
			for (let i = 0; i < 5; i++) g.fillRect((r() - 0.5) * s, (r() - 0.5) * s * 0.7, s * 0.14, s * 0.1)
			g.restore()
		}
		const frontPaint = (g, W, H) => {
			const bg = g.createLinearGradient(0, 0, 0, H)
			bg.addColorStop(0, "#f9d04a")
			bg.addColorStop(0.55, base)
			bg.addColorStop(1, "#d9731c")
			g.fillStyle = bg
			g.fillRect(0, 0, W, H)
			// sunburst
			g.save()
			g.translate(W * 0.5, H * 0.52)
			for (let i = 0; i < 24; i++) {
				g.rotate(TAU / 24)
				g.fillStyle = i % 2 ? "rgba(255,248,200,0.22)" : "rgba(255,255,255,0)"
				g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 1.2, -W * 0.07); g.lineTo(W * 1.2, W * 0.07); g.closePath(); g.fill()
			}
			g.restore()
			// title band
			g.fillStyle = "#c62a1c"
			g.fillRect(0, 0, W, H * 0.04)
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.font = `900 ${W * 0.2}px 'Arial Black', Impact, ${SANS}`
			g.lineJoin = "round"
			g.lineWidth = W * 0.035
			g.strokeStyle = "#8b1b12"
			g.strokeText("SUNNY", W * 0.5, H * 0.14)
			g.fillStyle = "#fffbe8"
			g.fillText("SUNNY", W * 0.5, H * 0.14)
			g.font = `900 ${W * 0.16}px 'Arial Black', Impact, ${SANS}`
			g.strokeText("FLAKES", W * 0.5, H * 0.25)
			g.fillText("FLAKES", W * 0.5, H * 0.25)
			// the bowl: a blue bowl with a rim, milk in it, a heap of flakes breaking over the rim, a spoon
			const bx = W * 0.5
			const by = H * 0.6
			const rimY = by - H * 0.045
			const rimRx = W * 0.32
			const rimRy = H * 0.042
			// spoon: its handle rests on the rim at the left, the bowl of the spoon dips in the milk
			g.save()
			g.lineCap = "round"
			g.strokeStyle = "#8f98a3"
			g.lineWidth = W * 0.026
			g.beginPath(); g.moveTo(bx - W * 0.08, rimY - H * 0.01); g.lineTo(bx - W * 0.4, rimY - H * 0.15); g.stroke()
			g.strokeStyle = "#dfe5ea"
			g.lineWidth = W * 0.012
			g.beginPath(); g.moveTo(bx - W * 0.08, rimY - H * 0.012); g.lineTo(bx - W * 0.4, rimY - H * 0.152); g.stroke()
			g.restore()
			// the bowl body
			const bowl = g.createLinearGradient(bx - rimRx, 0, bx + rimRx, 0)
			bowl.addColorStop(0, "#2a6fb8")
			bowl.addColorStop(0.35, "#62a9ec")
			bowl.addColorStop(0.7, "#2f78c4")
			bowl.addColorStop(1, "#1a4f8c")
			g.fillStyle = bowl
			g.beginPath()
			g.moveTo(bx - rimRx, rimY)
			g.bezierCurveTo(bx - W * 0.3, by + H * 0.17, bx + W * 0.3, by + H * 0.17, bx + rimRx, rimY)
			g.ellipse(bx, rimY, rimRx, rimRy, 0, 0, Math.PI, true)
			g.fill()
			// inside of the far wall, the milk surface, and a thin light rim line
			g.fillStyle = "#245f9f"
			g.beginPath(); g.ellipse(bx, rimY, rimRx, rimRy, 0, 0, TAU); g.fill()
			const milk = g.createLinearGradient(0, rimY - rimRy, 0, rimY + rimRy)
			milk.addColorStop(0, "#e9eef5")
			milk.addColorStop(1, "#ffffff")
			g.fillStyle = milk
			g.beginPath(); g.ellipse(bx, rimY + rimRy * 0.12, rimRx * 0.9, rimRy * 0.74, 0, 0, TAU); g.fill()
			g.strokeStyle = "rgba(210,232,252,0.9)"
			g.lineWidth = Math.max(3, W * 0.008)
			g.beginPath(); g.ellipse(bx, rimY, rimRx, rimRy, 0, 0.05, Math.PI - 0.05); g.stroke()
			// the heap of flakes, spilling a few over the front rim
			for (let i = 0; i < 70; i++) {
				const r = rng(100 + i)
				const a = r() * TAU
				const rad = Math.sqrt(r()) * W * 0.25
				flake(g, bx + Math.cos(a) * rad, rimY - H * 0.012 + Math.sin(a) * rad * 0.2 - Math.max(0, 1 - rad / (W * 0.25)) * H * 0.04, W * 0.034, r() * TAU, i)
			}
			for (const [fx, fy, fr] of [[-0.2, 0.012, 0.3], [0.04, 0.026, -0.4], [0.17, 0.014, 0.9], [-0.07, 0.034, 0.1]]) flake(g, bx + W * fx, rimY + H * fy, W * 0.032, fr, 600 + fx * 100)
			g.fillStyle = "rgba(255,255,255,0.3)"
			g.beginPath(); g.ellipse(bx - W * 0.16, by + H * 0.045, W * 0.05, H * 0.03, -0.5, 0, TAU); g.fill()
			// flying flakes
			for (let i = 0; i < 9; i++) {
				const r = rng(300 + i)
				flake(g, W * (0.12 + 0.76 * r()), H * (0.34 + 0.12 * r()), W * (0.03 + 0.02 * r()), r() * TAU, 300 + i)
			}
			// badge and small print
			g.fillStyle = "#2f8f3a"
			g.beginPath(); g.arc(W * 0.83, H * 0.42, W * 0.105, 0, TAU); g.fill()
			g.strokeStyle = "#fffbe8"
			g.lineWidth = 4
			g.beginPath(); g.arc(W * 0.83, H * 0.42, W * 0.09, 0, TAU); g.stroke()
			g.fillStyle = "#fffbe8"
			g.font = `800 ${W * 0.034}px ${SANS}`
			g.fillText("WHOLE", W * 0.83, H * 0.405)
			g.fillText("GRAIN", W * 0.83, H * 0.435)
			g.fillStyle = "#7a2410"
			g.font = `700 ${W * 0.05}px ${SANS}`
			g.fillText("Crunchy golden flakes", W * 0.5, H * 0.855)
			g.font = `600 ${W * 0.035}px ${SANS}`
			g.fillText("NET WT 18 OZ (510 g)", W * 0.5, H * 0.955)
		}
		const backPaint = (g, W, H) => {
			g.fillStyle = "#1c4f8a"
			g.fillRect(0, 0, W, H)
			g.fillStyle = "#f9d04a"
			g.fillRect(0, 0, W, H * 0.04)
			g.fillStyle = "#fffbe8"
			g.textAlign = "center"
			g.textBaseline = "middle"
			fit(g, "START YOUR DAY RIGHT", W * 0.9, W * 0.09, "900")
			g.fillText("START YOUR DAY RIGHT", W * 0.5, H * 0.09)
			// nutrition panel
			const px = W * 0.12, py = H * 0.17, pw = W * 0.76, ph = H * 0.6
			g.fillStyle = "#ffffff"
			g.fillRect(px, py, pw, ph)
			g.fillStyle = "#111"
			g.textAlign = "left"
			g.font = `900 ${pw * 0.13}px ${SANS}`
			g.fillText("Nutrition Facts", px + pw * 0.04, py + ph * 0.06)
			g.font = `${pw * 0.05}px ${SANS}`
			g.fillText("about 15 servings per box", px + pw * 0.04, py + ph * 0.12)
			g.fillRect(px + pw * 0.04, py + ph * 0.15, pw * 0.92, ph * 0.015)
			g.font = `800 ${pw * 0.06}px ${SANS}`
			g.fillText("Serving size  1 cup (30 g)", px + pw * 0.04, py + ph * 0.2)
			g.fillRect(px + pw * 0.04, py + ph * 0.23, pw * 0.92, ph * 0.03)
			g.font = `900 ${pw * 0.15}px ${SANS}`
			g.fillText("Calories", px + pw * 0.04, py + ph * 0.32)
			g.textAlign = "right"
			g.fillText("120", px + pw * 0.96, py + ph * 0.32)
			g.fillRect(px + pw * 0.04, py + ph * 0.36, pw * 0.92, ph * 0.015)
			const rows = ["Total Fat 1 g", "Sodium 160 mg", "Total Carbohydrate 26 g", "Dietary Fiber 3 g", "Total Sugars 4 g", "Protein 3 g", "Iron 30%"]
			g.textAlign = "left"
			g.font = `${pw * 0.055}px ${SANS}`
			rows.forEach((s, i) => {
				g.fillText(s, px + pw * 0.04, py + ph * (0.42 + i * 0.075))
				g.fillRect(px + pw * 0.04, py + ph * (0.455 + i * 0.075), pw * 0.92, 1.5)
			})
			g.fillStyle = "#fffbe8"
			g.textAlign = "center"
			g.font = `600 ${W * 0.03}px ${SANS}`
			g.fillText("INGREDIENTS: WHOLE GRAIN CORN, SUGAR, SALT,", W * 0.5, H * 0.82)
			g.fillText("MALT FLAVORING, IRON, VITAMIN C.", W * 0.5, H * 0.845)
			g.font = `700 ${W * 0.034}px ${SANS}`
			g.fillText("Please recycle this carton", W * 0.5, H * 0.93)
		}
		const sideA = (g, W, H) => { // narrow side: big title running up
			g.fillStyle = base
			g.fillRect(0, 0, W, H)
			g.fillStyle = "#c62a1c"
			g.fillRect(0, 0, W * 0.12, H)
			g.fillRect(W * 0.88, 0, W * 0.12, H)
			g.save()
			g.translate(W * 0.5, H * 0.5)
			g.rotate(-Math.PI / 2)
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.font = `900 ${W * 0.46}px 'Arial Black', Impact, ${SANS}`
			g.strokeStyle = "#8b1b12"
			g.lineWidth = W * 0.06
			g.lineJoin = "round"
			g.strokeText("SUNNY FLAKES", 0, 0)
			g.fillStyle = "#fffbe8"
			g.fillText("SUNNY FLAKES", 0, 0)
			g.restore()
		}
		const fit = (g, str, maxW, size, weight = "") => { // a line of text never wider than maxW: the font shrinks to fit
			g.font = `${weight} ${size}px ${SANS}`
			const tw = g.measureText(str).width
			if (tw > maxW) g.font = `${weight} ${size * (maxW / tw)}px ${SANS}`
		}
		const sideB = (g, W, H) => { // the other narrow side: serving info (every line fitted inside the panel)
			g.fillStyle = "#fff4d6"
			g.fillRect(0, 0, W, H)
			g.fillStyle = "#c62a1c"
			g.fillRect(0, 0, W * 0.06, H)
			g.fillRect(W * 0.94, 0, W * 0.06, H)
			g.fillStyle = "#7a2410"
			g.textAlign = "center"
			g.textBaseline = "middle"
			const MW = W * 0.78
			fit(g, "ENJOY", MW, W * 0.34, "800")
			g.fillText("ENJOY", W * 0.5, H * 0.075)
			fit(g, "WITH MILK", MW, W * 0.2, "800")
			g.fillText("WITH MILK", W * 0.5, H * 0.115)
			g.fillRect(W * 0.14, H * 0.14, W * 0.72, 3)
			const lines = ["Pour 1 cup (30 g)", "of flakes into a", "bowl. Add cold milk.", "", "Keep the bag folded", "to keep the crunch.", "", "Best before:", "see top of box"]
			lines.forEach((t, i) => { if (!t) return; fit(g, t, MW, W * 0.1, "600"); g.fillText(t, W * 0.5, H * (0.18 + i * 0.04)) })
		}
		const topPaint = (g, W, H) => {
			g.fillStyle = base
			g.fillRect(0, 0, W, H)
			g.fillStyle = "rgba(0,0,0,0.25)"
			g.fillRect(0, H * 0.5 - 1, W, 2)
			g.fillRect(W * 0.03, 0, 2, H)
			g.fillRect(W * 0.97 - 2, 0, 2, H)
			g.fillStyle = "#7a2410"
			g.font = `700 ${H * 0.2}px ${SANS}`
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.fillText("▲  OPEN HERE", W * 0.5, H * 0.25)
			g.font = `600 ${H * 0.12}px ${SANS}`
			g.fillText("BEST BEFORE  14 OCT 2027   L2284", W * 0.5, H * 0.75)
		}
		const f = L.faces({
			px: prn("sideA", 252, 1200, sideA), nx: prn("sideB", 252, 1200, sideB),
			py: prn("top", 760, 252, topPaint), ny: mat("cb|bottom", { color: "#b99669", roughness: 0.9 }),
			pz: prn("front", 760, 1200, frontPaint), nz: prn("back", 760, 1200, backPaint),
		})
		const body = kit.mesh(kit.box(w, h, d, 0.0013, 3), f)
		return kit.group(body)
	})

	// ------------------------------------------------------------- tissue box
	addModel("tissue-box", "body", ({ w, h, d, color }) => {
		const base = rich(color || "#7fb3d5", 1.2, 0.88)
		const dark = blend(base, "#16324a", 0.35)
		const light = blend(base, "#ffffff", 0.6)
		const mid = blend(base, "#ffffff", 0.28)
		const vein = blend(base, "#16324a", 0.18)
		const capH = 0.0103 // the top band (a ring with the oval opening); the opening is a real well this deep
		const h1 = h - capH
		const prn = (key, W, H, paint) => mat(`tb3|${key}|${base}`, { map: colorTex(`tb3|${key}|${base}`, W, H, (g) => { paint(g, W, H); fibres(g, W, H, 9, { n: 1500, alpha: 0.03 }) }), roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.35 }) // the print runs the whole height of the wall, up to the top edge
		/** One printed leaf: an almond with a pointed tip, a midrib, side veins and a short stalk (lying along +x from the stalk end at the origin). */
		const leaf = (g, x, y, s0, rot, tone) => {
			g.save()
			g.translate(x, y)
			g.rotate(rot)
			g.fillStyle = tone
			g.beginPath()
			g.moveTo(0, 0)
			g.bezierCurveTo(s0 * 0.3, -s0 * 0.62, s0 * 1.05, -s0 * 0.5, s0 * 1.7, 0)
			g.bezierCurveTo(s0 * 1.05, s0 * 0.5, s0 * 0.3, s0 * 0.62, 0, 0)
			g.fill()
			g.strokeStyle = vein
			g.globalAlpha = 0.55
			g.lineWidth = Math.max(1, s0 * 0.05)
			g.beginPath(); g.moveTo(-s0 * 0.28, 0); g.lineTo(s0 * 1.5, 0); g.stroke()
			g.lineWidth = Math.max(0.8, s0 * 0.028)
			for (let i = 1; i <= 4; i++) {
				const px = s0 * (0.22 + i * 0.26)
				const ext = s0 * 0.3 * Math.sin((Math.PI * i) / 5.2)
				g.beginPath(); g.moveTo(px, 0); g.lineTo(px + s0 * 0.2, -ext); g.moveTo(px, 0); g.lineTo(px + s0 * 0.2, ext); g.stroke()
			}
			g.restore()
		}
		const leaves = (g, W, H, seed, n) => {
			const r = rng(seed)
			for (let i = 0; i < n; i++) {
				const s0 = Math.min(W, H) * (0.045 + 0.035 * r())
				leaf(g, r() * W, r() * H, s0, r() * TAU, i % 3 === 0 ? light : mid)
			}
		}
		const sidePaint = (g, W, H) => {
			g.fillStyle = base
			g.fillRect(0, 0, W, H)
			leaves(g, W, H, 4, 34)
			g.fillStyle = "#ffffff"
			rr(g, W * 0.18, H * 0.2, W * 0.64, H * 0.6, H * 0.12)
			g.fill()
			g.fillStyle = dark
			g.textAlign = "center"
			g.textBaseline = "middle"
			const title = "SOFT TISSUES"
			const sp = H * 0.02
			g.font = `800 ${H * 0.3}px ${SANS}`
			const tw = g.measureText(title).width + sp * (title.length - 1)
			const room = W * 0.64 * 0.86 // inside the white panel, with a margin each side
			const fitK = Math.min(1, room / tw)
			g.font = `800 ${H * 0.3 * fitK}px ${SANS}`
			spaced(g, title, W * 0.5 + (sp * fitK) / 2, H * 0.42, sp * fitK)
			g.font = `600 ${H * 0.13}px ${SANS}`
			g.fillText("2-PLY  \u00B7  100 SHEETS", W * 0.5, H * 0.67)
		}
		const endPaint = (g, W, H) => { g.fillStyle = base; g.fillRect(0, 0, W, H); leaves(g, W, H, 6, 12) }
		const topPaint = (g, W, H) => {
			g.fillStyle = base
			g.fillRect(0, 0, W, H)
			leaves(g, W, H, 3, 60)
			g.strokeStyle = light
			g.lineWidth = 5
			g.strokeRect(W * 0.03, H * 0.06, W * 0.94, H * 0.88)
		}
		const bodyMats = L.faces({
			px: prn("end", 480, 280, endPaint), nx: prn("end", 480, 280, endPaint),
			py: mat("tb3|notop", { visible: false }), ny: mat("tb|bottom", { color: "#b99669", roughness: 0.9 }),
			pz: prn("side", 960, 280, sidePaint), nz: prn("side", 960, 280, sidePaint),
		})
		const group = kit.group()
		const body = kit.mesh(kit.box(w - 0.0001, h, d - 0.0001, 0.0012, 2), bodyMats) // the wall is one printed piece up to the top edge; its top face is left out (the band below covers it)
		group.add(body)
		// the top band: a printed ring with the oval opening cut through it, its edge flush with the box wall
		const a = w * 0.34
		const b = d * 0.27
		const oval = new THREE.Path()
		oval.absellipse(0, 0, a, b, 0, TAU, true)
		const ringGeo = plate(rrect(w - 0.0014, d - 0.0014, 0.0012), h / 2 - capH, h / 2, { bevel: 0.0003, holes: [oval], curve: 24 }) // its side (0.4 mm inside the walls) is hidden, its top edge meets the walls' rounded edge
		const topTex = colorTex(`tb2|topface|${base}`, 960, 480, (g, W, H) => { topPaint(g, W, H); fibres(g, W, H, 9, { n: 1500, alpha: 0.03 }) })
		const topMat = mat(`tb2|topmat|${base}|${w.toFixed(4)}|${d.toFixed(4)}`, { map: withRepeat(topTex, 1 / w, 1 / d, 0.5, 0.5), roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.35 })
		group.add(kit.mesh(ringGeo, [topMat, mat(`tb2|ringside|${base}`, { color: blend(base, "#ffffff", 0.04), roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.35 })]))
		// the well: a dark liner round the opening and down to the floor of the box
		const wellH = capH - 0.002 - 0.0008
		const well = new THREE.CylinderGeometry(1, 1, wellH, 80, 1, true).scale(a - 0.0007, 1, b - 0.0007).translate(0, h / 2 - 0.0008 - wellH / 2, 0)
		group.add(kit.mesh(well, mat("tb2|well", { color: "#2a2f36", roughness: 0.9, side: THREE.BackSide })))
		// the tissue: lies in the well, pleated and pulled up into one fin along the opening that peaks 1.8 mm above the top
		const RS = 28
		const AS = 96
		const pos = []
		const uv = []
		const idx = []
		const col = []
		const rimY = h / 2 - 0.0036
		const peakY = h / 2 + 0.0017
		const finW = 0.0062
		for (let i = 0; i <= RS; i++) {
			const rho = i / RS
			for (let j = 0; j <= AS; j++) {
				const th = (j / AS) * TAU
				const x = (a - 0.0009) * rho * Math.cos(th)
				const z = (b - 0.0009) * rho * Math.sin(th)
				const t = 1 - rho * rho
				const wob = 0.0014 * (fbm(x * 40, 3.7, 2, 8) - 0.5) // the fin meanders a little
				const fin = Math.exp(-(((z - wob) / (finW * (0.8 + 0.5 * fbm(x * 30, 1.9, 2, 4)))) ** 2)) * Math.pow(Math.max(0, 1 - (x / (a * 0.8)) ** 2), 0.8)
				const puff = 0.4 * Math.pow(t, 0.7)
				const pl = Math.sin((z / 0.0062) * Math.PI + 5 * fbm(x * 25, z * 25, 2, 3))
				const pleat = 0.0011 * pl * (0.3 + 0.7 * Math.min(1, t * 2))
				const crumple = 0.0005 * (1 - Math.abs(2 * fbm(x * 110, z * 110, 3, 31) - 1)) * (0.25 + 0.75 * Math.min(1, t * 3))
				const yy = Math.min(peakY, rimY + (peakY - rimY) * (puff + 0.6 * fin) + pleat + crumple)
				pos.push(x, yy, z)
				uv.push(0.5 + (rho * Math.cos(th)) / 2, 0.5 + (rho * Math.sin(th)) / 2)
				const k = clamp(0.8 + 0.2 * clamp((yy - rimY) / (peakY - rimY)) + 0.06 * pl * Math.min(1, t * 2), 0, 1)
				col.push(k, k, k)
			}
		}
		for (let i = 0; i < RS; i++) {
			for (let j = 0; j < AS; j++) {
				const p = i * (AS + 1) + j
				idx.push(p, p + 1, p + AS + 1, p + 1, p + AS + 2, p + AS + 1)
			}
		}
		const tg = new THREE.BufferGeometry()
		tg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		tg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
		tg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
		tg.setIndex(idx)
		tg.computeVertexNormals()
		// the sheet's look: soft folds running along the opening, fine crumple
		const folds = (g, W, H, mode) => {
			const rg = rng(515)
			g.fillStyle = mode === "h" ? "#808080" : "#fbfbfa"
			g.fillRect(0, 0, W, H)
			g.filter = "blur(4px)"
			for (let k = 0; k < 46; k++) {
				const y0 = rg() * H
				const w0 = 8 + rg() * 20
				const ph = rg() * 6
				const amp = 3 + rg() * 12
				for (const pass of mode === "h" ? [[0, "rgba(255,255,255,0.5)"], [1, "rgba(0,0,0,0.45)"]] : [[0, "rgba(120,125,135,0.07)"]]) {
					g.strokeStyle = pass[1]
					g.lineWidth = w0 * (pass[0] ? 0.8 : 1)
					g.lineCap = "round"
					g.beginPath()
					for (let x = 0; x <= W; x += 16) g[x === 0 ? "moveTo" : "lineTo"](x, y0 + pass[0] * w0 * 1.1 + Math.sin(x * 0.012 + ph) * amp)
					g.stroke()
				}
			}
			g.filter = "none"
			for (let k = 0; k < 500; k++) {
				const x = rg() * W, y = rg() * H, l = 10 + rg() * 40, a2 = (rg() - 0.5) * 0.9
				g.strokeStyle = mode === "h" ? (rg() < 0.5 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)") : "rgba(120,125,135,0.04)"
				g.lineWidth = 1 + rg() * 2
				g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a2) * l, y + Math.sin(a2) * l); g.stroke()
			}
		}
		const tc = colorTex("tb2|tissue-c", 1024, 512, (g, W, H) => folds(g, W, H, "c"))
		const tn = normalTex("tb2|tissue-n", 1024, 512, (g, W, H) => folds(g, W, H, "h"), { strength: 2.4, wrap: false, blur: 1.2 })
		group.add(kit.mesh(tg, mat("tb2|tissue", { map: tc, color: "#ffffff", vertexColors: true, roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.5, sheenColor: "#ffffff", normalMap: tn, normalScale: new THREE.Vector2(1.0, 1.0), emissive: "#ffffff", emissiveIntensity: 0.05 })))
		// the clear film over the opening, with a slit the tissue comes through
		const film = new THREE.Shape()
		film.absellipse(0, 0, a - 0.0008, b - 0.0008, 0, TAU, false)
		const slit = new THREE.Path()
		slit.absellipse(0, 0, a * 0.6, 0.0062, 0, TAU, true)
		film.holes.push(slit)
		const filmGeo = new THREE.ShapeGeometry(film, 64).rotateX(-Math.PI / 2).translate(0, h / 2 - 0.0007, 0)
		const filmMesh = kit.mesh(filmGeo, mat("tb2|film", { color: "#ffffff", transparent: true, opacity: 0.1, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide, depthWrite: false }), { cast: false })
		filmMesh.renderOrder = 2
		group.add(filmMesh)
		return group
	})
}
