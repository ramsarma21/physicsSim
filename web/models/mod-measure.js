// The measure module's 3D models (machines/mod_measure.py's types) and its view plug-ins (web/view-plugins.js):
//   lane          a long painted board: white edge lines, a tick at every mark, a full-width tick and a big upright number card at every metre,
//                 a white start line and a chequered finish line; the supports under it are the "measure:supports" plug-in's
//   start-line / finish-line   the painted band, a sign, light-gate posts
//   stopwatch     a round digital stopwatch with an LCD face (7-segment digits drawn every frame from its readings: start_s, stop_s)
//   measuring-tape a yellow steel tape with cm ticks, numbered metres on little upright tabs, its case at the far end, a flag at the reading
//   speed-gate    a U photogate with a red emitter and an LED read-out on top
//   speedometer   a radar speed sign ("YOUR SPEED", orange LED digits)
//   spring-scale  a clear tube with a newton scale, a ring on top; the hook (moves with the physics) with a red pointer
//   kitchen-scale digital (white body, LCD grams) or mechanical (a dial whose needle turns with the reading)
//   pan-balance   wooden base, steel post with a reading plate, aluminium beam, needle, brass pans
//   gram-mass     a brass mass with a knob and its value engraved
//   protractor    clear acrylic 180° with degree marks; a red arc to the watched thing's angle
//   plumb-line, metre-stick, motion-sensor, graph-board, data-table, motion-trail (drawn by plug-ins)
// Plug-ins: "measure:supports" (legs under lanes and poles under floating displays, down to the table or the room's floor),
// "measure:trails" (motion trails: a line, dots or ghosts), "measure:boards" (the graph board's and data table's charts, drawn as the run plays).
// Digits are drawn as 7-segment shapes (no fonts): the same picture on every machine and in every export.
const ROOM_FLOOR = -0.75 // web/view3d.js: the room's floor (y), under the tabletop's cabinet
const PAINT = { "pale gray": "#d7dadd", "pale blue": "#cfe0ef", "pale green": "#d2e7cf", "pale yellow": "#f0e8c8", white: "#f3f3f0", tan: "#d8c09b" }
const TRAIL = { red: "#e0312b", blue: "#2a62d8", green: "#2f9e44", orange: "#f08c00", purple: "#8b45c9", yellow: "#f2c200", black: "#1b1b1b", white: "#f4f4f4" }

// ---------------------------------------------------------------- 7-segment digits on a canvas
const SEG = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g", " ": "", E: "afged", r: "eg", o: "cdeg", L: "fed", P: "abfge", S: "afgcd", t: "fged", n: "ceg", h: "fecg", m: "ceg", A: "abcefg" }
/** Draws text (digits, '.', ':', '-', a few letters) as 7-segment characters in the box (x, y, w, h); `ghost` draws the unlit segments faintly. */
function sevenSeg(g, text, x, y, w, h, { on = "#1c2320", off = null, slant = 0.08 } = {}) {
	const chars = [...String(text)]
	const narrow = (c) => c === "." || c === ":"
	const units = chars.reduce((n, c) => n + (narrow(c) ? 0.35 : 1), 0)
	const cw = w / Math.max(1, units)
	const dw = cw * 0.8
	const th = Math.max(1, dw * 0.2)
	let cx = x
	const seg = (px, py, horizontal, len, lit) => {
		g.fillStyle = lit ? on : off
		if (!lit && !off) return
		g.beginPath()
		const k = th / 2
		if (horizontal) {
			g.moveTo(px, py)
			g.lineTo(px + k, py - k)
			g.lineTo(px + len - k, py - k)
			g.lineTo(px + len, py)
			g.lineTo(px + len - k, py + k)
			g.lineTo(px + k, py + k)
		} else {
			g.moveTo(px, py)
			g.lineTo(px + k, py + k)
			g.lineTo(px + k, py + len - k)
			g.lineTo(px, py + len)
			g.lineTo(px - k, py + len - k)
			g.lineTo(px - k, py + k)
		}
		g.closePath()
		g.fill()
	}
	for (const c of chars) {
		if (narrow(c)) {
			g.fillStyle = on
			const r = th * 0.62
			if (c === ".") g.fillRect(cx + cw * 0.12, y + h - r * 1.6, r * 1.6, r * 1.6)
			else {
				g.fillRect(cx + cw * 0.1, y + h * 0.3, r * 1.6, r * 1.6)
				g.fillRect(cx + cw * 0.1, y + h * 0.65, r * 1.6, r * 1.6)
			}
			cx += cw * 0.35
			continue
		}
		const segs = SEG[c] ?? ""
		g.save()
		g.translate(cx + (cw - dw) / 2, y)
		g.transform(1, 0, -slant, 1, slant * h, 0)
		const L = dw - th
		const half = (h - th) / 2
		const lit = (s) => segs.includes(s)
		seg(th / 2, th / 2, true, L, lit("a"))
		seg(th / 2, th / 2 + half, true, L, lit("g"))
		seg(th / 2, h - th / 2, true, L, lit("d"))
		seg(th / 2, th / 2, false, half, lit("f"))
		seg(th / 2 + L, th / 2, false, half, lit("b"))
		seg(th / 2, th / 2 + half, false, half, lit("e"))
		seg(th / 2 + L, th / 2 + half, false, half, lit("c"))
		g.restore()
		cx += cw
	}
}

/** A per-instance canvas texture on a mesh's own material (made on the first frame). */
function screenOf(obj, ownMaterial, THREE, W, H) {
	if (!obj.userData._screen) {
		const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H })
		const tex = new THREE.CanvasTexture(canvas)
		tex.colorSpace = THREE.SRGBColorSpace
		tex.anisotropy = 8
		const m = ownMaterial(obj)
		m.map = tex
		m.needsUpdate = true
		obj.userData._screen = { canvas, tex, g: canvas.getContext("2d"), shown: null, W, H }
	}
	return obj.userData._screen
}
const fin = (v) => typeof v === "number" && Number.isFinite(v)

/** The stopwatch's time at t from its readings (start_s and stop_s are set once, when known: every frame of the track carries them). */
function stopwatchShows(st, t) {
	if (!fin(st.start_s)) return { s: 0, state: "ready" }
	const end = fin(st.stop_s) ? st.stop_s : Infinity
	const s = Math.max(0, Math.min(t, end) - st.start_s)
	return { s, state: t < st.start_s ? "ready" : t >= end ? "stopped" : "running" }
}
function clockText(s) {
	if (s < 60) return s.toFixed(2)
	const m = Math.floor(s / 60)
	const r = s - 60 * m
	return `${m}:${r < 10 ? "0" : ""}${r.toFixed(2)}`
}
function lessonText(s) {
	if (s < 60) return { big: s.toFixed(0), unit: "s" }
	if (s < 3600) return { big: `${Math.floor(s / 60)}`, unit: "min" }
	const h = Math.floor(s / 3600)
	const m = Math.floor((s - 3600 * h) / 60)
	return { big: `${h}:${m < 10 ? "0" : ""}${m}`, unit: "h:min" }
}

export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
	const black = kit.plastic("#1d2024", { gloss: 0.5, key: "measure" })
	const darkGray = kit.plastic("#3a3f46", { gloss: 0.4, key: "measure" })
	const white = kit.plastic("#f4f4f2", { gloss: 0.35, key: "measure" })
	const steel = kit.steel()
	const alu = kit.aluminium()
	const brass = kit.mat("measure|brass", { color: "#c9a24a", roughness: 0.28, metalness: 1 })
	const acrylic = kit.mat("measure|acrylic", { color: "#f2f8fb", roughness: 0.04, metalness: 0, transmission: 0.92, thickness: 0.003, ior: 1.49, transparent: true, clearcoat: 1 })
	const screenMat = (key) => kit.mat(`measure|screen|${key}`, { color: "#ffffff", roughness: 0.35, metalness: 0, clearcoat: 0.6 })
	const glowMat = (key) => kit.mat(`measure|glow|${key}`, { color: "#ffffff", roughness: 0.5, metalness: 0, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.9 })
	const planeZ = (w, h) => kit.geo(`measure|plane|${w.toFixed(4)}|${h.toFixed(4)}`, () => new THREE.PlaneGeometry(w, h))
	const textCard = (key, str, { fg = "#111", bg = "#ffffff", w = 512, h = 256, font = 700 } = {}) =>
		kit.mat(`measure|card|${key}|${str}|${fg}|${bg}`, {
			map: kit.text(`measure-${key}`, str, { bg, fg, font: `${font} ${Math.round(h * 0.72)}px ${SANS}`, w, h }),
			roughness: 0.6, metalness: 0
		})
	const at = (o, x, y, z) => {
		o.position.set(x, y, z)
		return o
	}

	// ============================================================== lane
	addModel("lane", "floor", ({ w, h, d, props }) => {
		const P = props ?? {}
		const L = Number(P.length) || 10
		const m = Number(P.margin)
		const x0 = -w / 2 + (Number.isFinite(m) ? m : 1) // the 0 m mark, in the board's frame
		const top = h / 2
		const paint = PAINT[P.color] ?? PAINT["pale gray"]
		const surface = P.surface ?? "gym floor"
		const side =
			surface === "gym floor" ? kit.wood("#c9955c", { roughness: 0.45, varnish: 0.7 })
				: surface === "carpet" ? kit.fabric("#6b6f78")
					: surface === "asphalt" ? kit.mat("measure|asphalt", { color: "#3b3c3e", roughness: 0.95 })
						: surface === "concrete" ? kit.mat("measure|concrete", { color: "#a9a6a0", roughness: 0.9 })
							: kit.plastic("#8d8f92", { gloss: 0.2, key: "vinyl" })
		const topMat = kit.mat(`measure|lanepaint|${paint}|${surface}`, { color: paint, roughness: surface === "gym floor" || surface === "vinyl" ? 0.45 : 0.85, metalness: 0, clearcoat: surface === "gym floor" ? 0.5 : 0.1 })
		const g = kit.group()
		g.add(kit.mesh(kit.box(w, h, d, 0.002), [side, side, topMat, side, side, side]))
		// the painted lines: white edges, a tick at every mark, a full-width bar every metre, start and finish
		const every = { "10 cm": 0.1, "50 cm": 0.5, "1 m": 1, "2 m": 2, "5 m": 5 }[P.marks_every] ?? 1
		const lineGeo = []
		const bar = (x, len, width, z) => lineGeo.push(new THREE.BoxGeometry(width, 0.0008, len).translate(x, top + 0.0004, z))
		lineGeo.push(new THREE.BoxGeometry(w - 0.004, 0.0008, 0.015).translate(0, top + 0.0004, d / 2 - 0.02))
		lineGeo.push(new THREE.BoxGeometry(w - 0.004, 0.0008, 0.015).translate(0, top + 0.0004, -d / 2 + 0.02))
		const n = Math.round(L / every)
		for (let i = 0; i <= n; i++) {
			const v = i * every
			if (v > L + 1e-6) break
			const metre = Math.abs(v - Math.round(v)) < 1e-6
			if (metre) bar(x0 + v, d - 0.05, 0.02, 0)
			else {
				bar(x0 + v, d * 0.22, 0.008, d / 2 - 0.03 - d * 0.11)
				bar(x0 + v, d * 0.22, 0.008, -d / 2 + 0.03 + d * 0.11)
			}
		}
		const sa = Number(P.start_at) || 0
		bar(x0 + sa, d - 0.05, 0.05, 0)
		g.add(kit.mesh(kit.merge(lineGeo, `lane-lines|${w.toFixed(3)}|${d.toFixed(3)}|${L}|${every}|${sa}`), kit.mat("measure|white-paint", { color: "#fbfbf8", roughness: 0.5, metalness: 0 }), { cast: false }))
		// the finish line: a chequered band 10 cm wide (two rows of squares along it)
		const fa = Number.isFinite(Number(P.finish_at)) ? Number(P.finish_at) : L
		const sq = 0.05
		const nz = Math.max(2, Math.round((d - 0.05) / sq))
		const checker = []
		for (let r = 0; r < 2; r++) for (let k = 0; k < nz; k++) if ((r + k) % 2 === 0) checker.push(new THREE.BoxGeometry(sq, 0.0009, (d - 0.05) / nz).translate(x0 + fa - sq / 2 + r * sq, top + 0.00045, -(d - 0.05) / 2 + (k + 0.5) * ((d - 0.05) / nz)))
		g.add(kit.mesh(kit.merge([new THREE.BoxGeometry(2 * sq, 0.0006, d - 0.05).translate(x0 + fa, top + 0.0003, 0)], `lane-finish-base|${w.toFixed(3)}|${d.toFixed(3)}|${fa}|${L}`), kit.mat("measure|white-paint", {}), { cast: false }))
		if (checker.length) g.add(kit.mesh(kit.merge(checker, `lane-finish|${w.toFixed(3)}|${d.toFixed(3)}|${fa}|${L}`), kit.mat("measure|black-paint", { color: "#121212", roughness: 0.5 }), { cast: false }))
		// big upright number cards at every metre, standing on the board's back edge, facing the camera
		if (P.labels !== false) {
			const ch = Math.max(0.05, (Number(P.label_cm) || 20) / 100)
			const step = Math.max(1, Math.round(every))
			for (let v = 0; v <= L + 1e-6; v += step) {
				const str = String(Math.round(v))
				const cw = ch * (0.5 + 0.42 * str.length)
				const card = kit.mesh(planeZ(cw, ch), textCard("lane", str, { w: 128 * (1 + str.length), h: 256 }), { cast: true })
				const holder = kit.group(card)
				at(holder, x0 + v, top + ch / 2 + 0.01, -d / 2 + 0.012)
				// a thin black stand behind the card
				const foot = kit.mesh(kit.box(cw * 0.6, 0.01, 0.02), black)
				at(foot, x0 + v, top + 0.005, -d / 2 + 0.006)
				g.add(holder, foot)
			}
		}
		return g
	})

	// the foam bumper on the lane's far end: a padded block in a gym mat's blue vinyl with a yellow band
	addModel("lane", "stop", ({ w, h, d }) => {
		const g = kit.group(kit.mesh(kit.box(w, h, d, Math.min(0.012, w / 3)), kit.plastic("#2c5ea8", { gloss: 0.15, key: "bumper" })))
		g.add(at(kit.mesh(kit.box(w + 0.002, h * 0.18, d + 0.002, 0.003), kit.plastic("#f2c418", { gloss: 0.2, key: "bumperband" }), { cast: false }), 0, h * 0.18, 0))
		return g
	})

	// ============================================================== start and finish lines
	// (the line's solid is a 2 mm slab whose top, at y = +1 mm in its frame, is the floor's top: its paint is drawn 1.4 to 2.4 mm above that, clear of
	// the 1 mm the view grows every drawn surface by, so it shows on a table, a floor, a lane or a ramp alike; the view lays it on whatever it lies on:
	// the builder's `paint` flag, web/view3d.js paintOn)
	const LINE_Y = 0.001 + 0.0019
	const linePaint = (hex, key) => kit.mat(`measure|line-${key}`, { color: hex, roughness: 0.5, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
	for (const kind of ["start-line", "finish-line"]) {
		const build = ({ d, props }) => {
			const P = props ?? {}
			const fin_ = kind === "finish-line"
			const g = kit.group()
			const band = kit.mesh(kit.box(fin_ ? 0.1 : 0.05, 0.001, d, 0.0003), linePaint("#fbfbf8", "white"), { cast: false })
			at(band, 0, LINE_Y, 0)
			g.add(band)
			if (fin_) {
				const list = []
				const nz = Math.max(2, Math.round(d / 0.05))
				for (let r = 0; r < 2; r++) for (let k = 0; k < nz; k++) if ((r + k) % 2 === 0) list.push(new THREE.BoxGeometry(0.05, 0.001, d / nz).translate(-0.025 + r * 0.05, LINE_Y + 0.0002, -d / 2 + (k + 0.5) * (d / nz)))
				g.add(kit.mesh(kit.merge(list, `finish-line2|${d.toFixed(3)}`), linePaint("#121212", "black"), { cast: false }))
			}
			if (P.sign !== false) {
				const word = fin_ ? "FINISH" : "START"
				const sign = kit.mesh(planeZ(0.36, 0.12), textCard("sign", word, { fg: "#ffffff", bg: fin_ ? "#111111" : "#1f7a35", w: 768, h: 256 }))
				const board = kit.group(sign, at(kit.mesh(kit.box(0.38, 0.14, 0.012), white), 0, 0, -0.007))
				at(board, 0, 0.32, -d / 2 - 0.02)
				const post = at(kit.mesh(kit.cylinderY(0.008, 0.25), steel), 0, 0.125, -d / 2 - 0.03)
				g.add(board, post)
			}
			if (P.gate) {
				for (const z of [d / 2 + 0.03, -d / 2 - 0.03]) {
					g.add(at(kit.mesh(kit.box(0.025, 0.3, 0.025, 0.003), black), 0, 0.15, z))
					g.add(at(kit.mesh(kit.sphere(0.006), glowMat("red")), 0, 0.03, z - Math.sign(z) * 0.014))
				}
			}
			return g
		}
		build.paint = true // (web/view3d.js: drawn on the top face of what it lies on)
		addModel(kind, "line", build)
	}

	// ============================================================== stopwatch (a big LCD stopwatch)
	const stopwatchModel = ({ w, d, solid }) => {
		const R = w / 2
		const D = Math.max(0.01, d)
		const body = kit.latheZ([[0, -D / 2], [R * 0.9, -D / 2], [R, -D / 2 + D * 0.25], [R, D / 2 - D * 0.3], [R * 0.94, D / 2 - D * 0.05], [R * 0.86, D / 2], [0, D / 2]], 72, `stopwatch-body|${R.toFixed(4)}|${D.toFixed(4)}`)
		const g = kit.group(kit.mesh(body, kit.plastic(solid?.color ?? "#d8282b", { gloss: 0.6, key: "stopwatch" }))) // (its case takes a paint the item sets: a red and a blue racer's watches)
		// the dark face, the LCD window, the buttons, the ring
		const face = kit.mesh(kit.cylinderZ(R * 0.86, 0.002, 72), darkGray)
		at(face, 0, 0, D / 2 + 0.0005)
		const lcd = kit.mesh(planeZ(R * 1.36, R * 0.62), screenMat("lcd"), { cast: false })
		at(lcd, 0, -R * 0.05, D / 2 + 0.0018)
		lcd.userData.frame = { hook: "measure:stopwatch" }
		const label = kit.mesh(planeZ(R * 0.9, R * 0.16), textCard("swlabel", "STOPWATCH", { fg: "#e9edf1", bg: "#3a3f46", w: 1024, h: 180, font: 600 }), { cast: false })
		at(label, 0, R * 0.48, D / 2 + 0.0016)
		const crown = at(kit.mesh(kit.cylinderY(R * 0.12, R * 0.16), steel), 0, R + R * 0.06, 0)
		const ring = at(kit.mesh(kit.torus(R * 0.11, R * 0.025, 12, 32), steel), 0, R + R * 0.22, 0)
		const side = (a) => {
			const b = kit.mesh(kit.cylinderY(R * 0.07, R * 0.1), black)
			b.position.set(Math.sin(a) * R * 1.02, Math.cos(a) * R * 1.02, 0)
			b.rotation.z = -a
			return b
		}
		g.add(face, lcd, label, crown, ring, side(0.75), side(-0.75))
		return g
	}
	addModel("stopwatch", "face", stopwatchModel)
	addModel("stopwatch", "body", ({ w, h, d, solid }) => {
		const g = stopwatchModel({ w: Math.min(w, h), d, solid })
		g.scale.setScalar(1)
		return g
	})
	addFrameHook("measure:stopwatch", (obj, f) => {
		const sc = screenOf(obj, ownMaterial, THREE, 512, 232)
		const shows = stopwatchShows(f.state, f.t)
		const lesson = fin(f.state.lesson_s)
		let txt
		let unit = "s"
		if (lesson) {
			const k = fin(f.state.seconds) && f.state.seconds > 0 ? f.state.lesson_s / f.state.seconds : 1
			const l = lessonText(shows.s * k)
			txt = l.big
			unit = l.unit
		} else txt = clockText(shows.s)
		const key = `${txt}|${shows.state}|${unit}`
		if (sc.shown === key) return
		sc.shown = key
		const { g, W, H } = sc
		const grd = g.createLinearGradient(0, 0, 0, H)
		grd.addColorStop(0, "#cfdbc9")
		grd.addColorStop(1, "#b5c4ae")
		g.fillStyle = grd
		g.fillRect(0, 0, W, H)
		// the digits fill the window (right-aligned in a fixed number of cells, as an LCD's are)
		const cells = Math.max(4, txt.replace(/[.:]/g, "").length)
		const pad = " ".repeat(Math.max(0, cells - txt.replace(/[.:]/g, "").length))
		sevenSeg(g, pad + txt, W * 0.03, H * 0.1, W * 0.82, H * 0.8, { on: "#151b17", off: "rgba(21,27,23,0.06)", slant: 0.1 })
		g.fillStyle = "#151b17"
		g.textAlign = "left"
		g.textBaseline = "alphabetic"
		g.font = `800 ${Math.round(H * 0.26)}px ${SANS}`
		g.fillText(unit, W * 0.86, H * 0.88)
		g.font = `700 ${Math.round(H * 0.12)}px ${SANS}`
		g.fillText(shows.state === "running" ? "RUN" : shows.state === "stopped" ? "STOP" : "", W * 0.855, H * 0.22)
		sc.tex.needsUpdate = true
	})

	// ============================================================== measuring tape
	addModel("measuring-tape", "tape", ({ w, d, props }) => {
		const P = props ?? {}
		const L = w
		const g = kit.group()
		const dir = P.from === "right end" ? -1 : 1
		// lay it in front of the motion plane, on the floor (z: 0.12 in front)
		const z = 0.12
		const tapeTex = kit.tex(`measure-tape|${L.toFixed(2)}`, Math.min(16384, Math.max(256, Math.round(L * 400))), 64, (g2, W, H) => {
			g2.fillStyle = "#f3c419"
			g2.fillRect(0, 0, W, H)
			g2.fillStyle = "#151515"
			const px = W / L
			for (let cm = 0; cm <= Math.round(L * 100); cm++) {
				const x = cm * (px / 100)
				const big = cm % 100 === 0
				const mid = cm % 10 === 0
				g2.fillRect(x - (big ? 1.5 : 0.5), 0, big ? 3 : 1, big ? H * 0.8 : mid ? H * 0.5 : H * 0.25)
			}
			g2.font = `700 ${Math.round(H * 0.42)}px ${SANS}`
			g2.textBaseline = "bottom"
			for (let dm = 1; dm < Math.round(L * 10); dm++) if (dm % 10) g2.fillText(String(dm % 10 ? (dm * 10) % 100 : ""), dm * (px / 10) + 2, H - 2)
			g2.fillStyle = "#c81e1e"
			for (let m = 1; m <= Math.floor(L); m++) g2.fillText(`${m}m`, m * px + 3, H - 2)
		}, { wrap: false })
		const strip = kit.mesh(kit.geo(`measure|tape|${L.toFixed(3)}`, () => new THREE.PlaneGeometry(L, 0.025).rotateX(-Math.PI / 2)), kit.mat(`measure|tapemat|${L.toFixed(2)}`, { map: tapeTex, roughness: 0.35, metalness: 0.25 }), { cast: false })
		at(strip, 0, 0.0004, z)
		if (dir < 0) strip.rotation.y = Math.PI
		g.add(strip)
		// upright number tabs every metre (a wide shot cannot read the tape itself)
		const tabH = Math.max(0.01, (Number(P.label_cm) || 4) / 100)
		for (let m = 0; m <= Math.floor(L + 1e-6); m++) {
			const str = `${m}`
			const card = kit.mesh(planeZ(tabH * (0.5 + 0.42 * str.length), tabH), textCard("tape", str, { fg: "#151515", bg: "#f3c419", w: 128 * (1 + str.length), h: 256 }))
			at(card, dir * (-L / 2 + m), tabH / 2 + 0.003, z - 0.014)
			g.add(card)
		}
		// the case at the far end
		const kase = kit.mesh(kit.box(0.075, 0.075, 0.04, 0.012), kit.plastic("#f2c418", { gloss: 0.5, key: "tape" }))
		at(kase, dir * (L / 2 + 0.04), 0.0375, z)
		const grip = at(kit.mesh(kit.box(0.077, 0.03, 0.042, 0.006), black), dir * (L / 2 + 0.04), 0.02, z)
		g.add(kase, grip)
		// the reading flag (moved by its hook to where the watched thing's point is)
		const flag = kit.group(at(kit.mesh(kit.cylinderY(0.003, 0.12), steel), 0, 0.06, 0), at(kit.mesh(planeZ(0.16, 0.06), screenMat("tapeflag"), { cast: false }), 0.08, 0.1, 0))
		flag.children[1].userData.frame = { hook: "measure:tapeflag", L, dir, z }
		at(flag, 0, 0, z)
		flag.visible = false
		flag.userData.tapeFlag = true
		g.add(flag)
		return g
	})
	addFrameHook("measure:tapeflag", (obj, f, args) => {
		const v = f.state.meters
		const flag = obj.parent
		if (!fin(v) || !flag) return
		flag.visible = true
		flag.position.x = args.dir * (-args.L / 2 + v)
		const sc = screenOf(obj, ownMaterial, THREE, 256, 96)
		const txt = `${v.toFixed(2)} m`
		if (sc.shown === txt) return
		sc.shown = txt
		sc.g.fillStyle = "#ffffff"
		sc.g.fillRect(0, 0, 256, 96)
		sc.g.fillStyle = "#c81e1e"
		sc.g.font = `700 60px ${SANS}`
		sc.g.textAlign = "center"
		sc.g.textBaseline = "middle"
		sc.g.fillText(txt, 128, 50)
		sc.tex.needsUpdate = true
	})

	// ============================================================== speed gate and speed sign
	const ledPanel = (w, h, hook, args = {}) => {
		const scr = kit.mesh(planeZ(w * 0.88, h * 0.7), screenMat(`led|${hook}`), { cast: false })
		scr.userData.frame = { hook, ...args }
		at(scr, 0, -h * 0.06, 0.0125)
		return kit.group(kit.mesh(kit.box(w, h, 0.024, 0.004), black), scr)
	}
	const drawLED = (sc, txt, unit, head, color = "#ff8a1c") => {
		const { g, W, H } = sc
		g.fillStyle = "#0b0b0c"
		g.fillRect(0, 0, W, H)
		sevenSeg(g, txt, W * 0.05, H * (head ? 0.26 : 0.14), W * 0.68, H * (head ? 0.62 : 0.72), { on: color, off: "rgba(255,140,40,0.06)" })
		g.fillStyle = color
		g.font = `700 ${Math.round(H * 0.18)}px ${SANS}`
		g.textAlign = "left"
		g.textBaseline = "alphabetic"
		g.fillText(unit, W * 0.76, H * 0.84)
		if (head) {
			g.font = `700 ${Math.round(H * 0.15)}px ${SANS}`
			g.fillText(head, W * 0.05, H * 0.19)
		}
		sc.tex.needsUpdate = true
	}
	addModel("speed-gate", "gate", ({ h, props }) => {
		const P = props ?? {}
		const beam = Number(P.beam_height) || 0.03
		const g = kit.group()
		const y0 = -h / 2 // the floor, in the part's frame
		const post = (z) => at(kit.mesh(kit.box(0.022, beam + 0.05, 0.022, 0.003), black), 0, y0 + (beam + 0.05) / 2, z)
		g.add(post(0.07), post(-0.07), at(kit.mesh(kit.box(0.022, 0.02, 0.162, 0.004), black), 0, y0 + beam + 0.06, 0))
		g.add(at(kit.mesh(kit.sphere(0.005), glowMat("red")), 0.012, y0 + beam, 0.06))
		const face = Math.max(0.04, (Number(P.face_cm) || 12) / 100)
		const panel = ledPanel(face, face * 0.55, "measure:gate")
		at(panel, 0, y0 + beam + 0.07 + face * 0.3, -0.08)
		g.add(panel)
		return g
	})
	addFrameHook("measure:gate", (obj, f) => {
		const sc = screenOf(obj, ownMaterial, THREE, 384, 192)
		const done = fin(f.state.exit_s) && f.t >= f.state.exit_s && fin(f.state.speed)
		const txt = done ? f.state.speed.toFixed(2) : "--.--"
		if (sc.shown === txt) return
		sc.shown = txt
		drawLED(sc, txt, "m/s", null, "#ff3b2f")
	})
	addModel("speedometer", "sign", ({ w, h, props }) => {
		const g = kit.group()
		const panel = ledPanel(w, h, "measure:radar", { kmh: props?.units === "km/h" })
		g.add(panel)
		const head = kit.mesh(planeZ(w * 0.7, h * 0.14), textCard("radar", "YOUR SPEED", { fg: "#111", bg: "#f4f4f2", w: 1024, h: 160, font: 800 }))
		at(head, 0, h / 2 + h * 0.1, 0.006)
		g.add(head, at(kit.mesh(kit.box(w * 0.76, h * 0.2, 0.012, 0.003), white), 0, h / 2 + h * 0.1, -0.002))
		return g
	})
	addFrameHook("measure:radar", (obj, f, args) => {
		const sc = screenOf(obj, ownMaterial, THREE, 384, 224)
		const v = fin(f.state.speed) ? f.state.speed : 0
		const txt = (args.kmh ? v * 3.6 : v).toFixed(1)
		if (sc.shown === txt) return
		sc.shown = txt
		drawLED(sc, txt, args.kmh ? "km/h" : "m/s", null)
	})

	// ============================================================== spring scale
	addModel("spring-scale", "case", ({ w, h, props }) => {
		const P = props ?? {}
		const rng = parseFloat(String(P.range ?? "10 N")) || 10
		const g = kit.group()
		const tube = kit.mesh(kit.cylinderY(w / 2, h, 40), acrylic)
		const capT = at(kit.mesh(kit.cylinderY(w / 2 + 0.002, 0.012, 32), kit.plastic("#2f6fd0", { gloss: 0.5, key: "nm" })), 0, h / 2 - 0.006, 0)
		const capB = at(kit.mesh(kit.cylinderY(w / 2 + 0.002, 0.012, 32), kit.plastic("#2f6fd0", { gloss: 0.5, key: "nm" })), 0, -h / 2 + 0.006, 0)
		const ring = at(kit.mesh(kit.torus(0.012, 0.0022, 10, 32), steel), 0, h / 2 + 0.014, 0)
		// the newton scale on the tube's front: 0 at the pointer's rest, full scale 10 cm lower
		const scaleTex = kit.tex(`measure-nm|${rng}`, 128, 512, (g2, W, H) => {
			g2.fillStyle = "#ffffff"
			g2.fillRect(0, 0, W, H)
			g2.fillStyle = "#111"
			const top = H * 0.08
			const span = H * 0.8
			const steps = rng <= 5 ? rng * 10 : rng <= 20 ? rng * 2 : rng
			for (let i = 0; i <= steps; i++) {
				const y = top + (i / steps) * span
				const major = steps <= 25 || i % (steps / 10) === 0
				g2.fillRect(W * 0.08, y - 1, major ? W * 0.32 : W * 0.18, 2)
			}
			g2.font = `700 ${Math.round(W * 0.2)}px ${SANS}`
			g2.textBaseline = "middle"
			for (let i = 0; i <= 5; i++) g2.fillText(String(+((rng * i) / 5).toFixed(1)), W * 0.46, top + (i / 5) * span)
			g2.font = `800 ${Math.round(W * 0.22)}px ${SANS}`
			g2.fillText("N", W * 0.5, H * 0.95)
		})
		const strip = kit.mesh(planeZ(w * 0.7, 0.125), kit.mat(`measure|nmscale|${rng}`, { map: scaleTex, roughness: 0.5 }), { cast: false })
		// (the spring's top is the case's bottom; the pointer rests 2 cm below: the 0 mark is 2.5 cm above the case's bottom end... drawn on the lower part)
		at(strip, 0, -h / 2 + 0.07, w / 2 + 0.0015)
		g.add(tube, capT, capB, ring, strip)
		return g
	})
	addModel("spring-scale", "hook", ({ h }) => {
		const g = kit.group()
		g.add(at(kit.mesh(kit.cylinderY(0.0018, h * 0.7), steel), 0, h * 0.1, 0))
		const hookArc = kit.mesh(kit.torus(0.008, 0.0018, 8, 24, Math.PI * 1.3), steel)
		hookArc.rotation.z = Math.PI * 0.85
		at(hookArc, 0.004, -h / 2 + 0.006, 0)
		g.add(hookArc, at(kit.mesh(kit.cylinderY(0.009, 0.004, 24), kit.plastic("#e02b2b", { gloss: 0.5, key: "nm" })), 0, h / 2, 0))
		return g
	})

	// ============================================================== kitchen scale
	addModel("kitchen-scale", "base", ({ w, h, d, props }) => {
		const P = props ?? {}
		const g = kit.group()
		if (P.style === "mechanical") {
			g.add(kit.mesh(kit.box(w, h, d, 0.012), kit.plastic("#e6e1d6", { gloss: 0.4, key: "kscale" })))
			const dial = kit.mesh(kit.cylinderZ(h * 0.36, 0.006, 64), screenMat("dial"))
			dial.userData.frame = { hook: "measure:dial", cap: Number(P.capacity_kg) || 5 }
			at(dial, 0, 0.004, d / 2 + 0.003)
			const bezel = at(kit.mesh(kit.torus(h * 0.37, 0.004, 10, 48), steel), 0, 0.004, d / 2 + 0.004)
			const needle = kit.mesh(kit.box(0.0025, h * 0.3, 0.0015), kit.plastic("#d01818", { gloss: 0.4, key: "needle" }))
			needle.geometry = kit.geo("measure|needle", () => new THREE.BoxGeometry(0.0025, 0.03, 0.0015).translate(0, 0.012, 0))
			needle.userData.frame = { hook: "measure:needle", cap: Number(P.capacity_kg) || 5 }
			at(needle, 0, 0.004, d / 2 + 0.008)
			g.add(dial, bezel, needle)
		} else {
			g.add(kit.mesh(kit.box(w, h, d, 0.006), kit.plastic("#f2f2ef", { gloss: 0.6, key: "kscale" })))
			const lcd = kit.mesh(planeZ(w * 0.5, h * 0.62), screenMat("kscale"), { cast: false })
			lcd.userData.frame = { hook: "measure:kscale" }
			at(lcd, -w * 0.12, 0, d / 2 + 0.0012)
			const btn = (x) => at(kit.mesh(kit.cylinderZ(h * 0.16, 0.003, 20), darkGray), x, 0, d / 2 + 0.0015)
			g.add(lcd, btn(w * 0.27), btn(w * 0.38))
		}
		return g
	})
	addModel("kitchen-scale", "platform", ({ w, h, d }) => kit.group(kit.mesh(kit.box(w, h, d, Math.min(0.003, h / 2.2)), kit.metal("#d7dadd", { roughness: 0.32, key: "brushed" }))))
	addFrameHook("measure:kscale", (obj, f) => {
		const sc = screenOf(obj, ownMaterial, THREE, 384, 160)
		const g = f.state.grams
		const txt = fin(f.state.over) && f.state.over > 0.5 ? "Err" : fin(g) ? String(Math.round(g)) : "0"
		if (sc.shown === txt) return
		sc.shown = txt
		const { g: c, W, H } = sc
		c.fillStyle = "#9fb3a4"
		c.fillRect(0, 0, W, H)
		sevenSeg(c, txt.padStart(5, " "), W * 0.04, H * 0.14, W * 0.72, H * 0.72, { on: "#18201b", off: "rgba(24,32,27,0.06)" })
		c.fillStyle = "#18201b"
		c.font = `700 ${Math.round(H * 0.3)}px ${SANS}`
		c.textAlign = "left"
		c.textBaseline = "alphabetic"
		c.fillText("g", W * 0.82, H * 0.82)
		sc.tex.needsUpdate = true
	})
	addFrameHook("measure:dial", (obj, f, args) => {
		const sc = screenOf(obj, ownMaterial, THREE, 512, 512)
		if (sc.shown) return
		sc.shown = "face"
		const { g: c, W } = sc
		const r = W / 2
		c.fillStyle = "#fbfbf6"
		c.fillRect(0, 0, W, W)
		c.translate(r, r)
		c.fillStyle = "#151515"
		const cap = args.cap
		const steps = Math.round(cap * 10)
		for (let i = 0; i <= steps; i++) {
			const a = -Math.PI * 0.75 + (i / steps) * Math.PI * 1.5
			const big = i % 10 === 0
			c.save()
			c.rotate(a)
			c.fillRect(-1.5, -r * 0.92, 3, big ? r * 0.14 : r * 0.07)
			c.restore()
		}
		c.font = `700 ${Math.round(r * 0.16)}px ${SANS}`
		c.textAlign = "center"
		c.textBaseline = "middle"
		for (let k = 0; k <= cap; k++) {
			const a = -Math.PI * 0.75 + (k / cap) * Math.PI * 1.5
			c.fillText(String(k), Math.sin(a) * r * 0.62, -Math.cos(a) * r * 0.62)
		}
		c.font = `600 ${Math.round(r * 0.12)}px ${SANS}`
		c.fillText("kg", 0, r * 0.4)
		c.setTransform(1, 0, 0, 1, 0, 0)
		sc.tex.needsUpdate = true
	})
	addFrameHook("measure:needle", (obj, f, args) => {
		const kg = fin(f.state.grams) ? f.state.grams / 1000 : 0
		obj.rotation.z = -(-Math.PI * 0.75 + Math.max(0, Math.min(1.02, kg / args.cap)) * Math.PI * 1.5)
	})

	// ============================================================== pan balance
	addModel("pan-balance", "base", ({ w, h, d }) => kit.group(kit.mesh(kit.box(w, h, d, 0.004), kit.wood("#7a4b2a", { roughness: 0.5, varnish: 0.8 }))))
	addModel("pan-balance", "post", ({ w, h }) => {
		const g = kit.group(kit.mesh(kit.cylinderY(w / 2, h, 24), steel))
		const plate = kit.mesh(planeZ(0.07, 0.04), kit.mat("measure|balplate", { map: kit.tex("measure-balplate", 256, 160, (c, W, H) => {
			c.fillStyle = "#f5f1e6"
			c.fillRect(0, 0, W, H)
			c.fillStyle = "#222"
			for (let i = -5; i <= 5; i++) c.fillRect(W / 2 + i * (W / 12) - 1, H * 0.15, 2, i === 0 ? H * 0.5 : H * 0.3)
		}), roughness: 0.6 }))
		at(plate, 0, h / 2 - 0.14, 0.012)
		g.add(plate)
		return g
	})
	addModel("pan-balance", "beam", ({ w, h, d }) => {
		const g = kit.group(kit.mesh(kit.box(w, h, d, 0.002), alu))
		g.add(at(kit.mesh(kit.cylinderZ(0.008, d + 0.008, 24), brass), 0, 0, 0))
		return g
	})
	addModel("pan-balance", "pointer", ({ w, h }) => kit.group(kit.mesh(kit.box(w, h, w, 0.001), kit.plastic("#d01818", { gloss: 0.4, key: "needle" }))))
	// the gravity bob: a knurled brass nut on the pointer (its weight under the pivot is what brings the beam back level)
	addModel("pan-balance", "bob", ({ w, h }) => kit.group(kit.mesh(kit.cylinderY(w / 2.6, h, 24), brass), at(kit.mesh(kit.torus(w / 2.6, 0.0012, 6, 24), brass), 0, 0, 0)))
	for (const side of ["left", "right"]) {
		// (the hanger's body is the top 2 cm of its bow: the bow is drawn down to its pan, 12 cm under the beam's end)
		addModel("pan-balance", `hanger-${side}`, ({ h }) => kit.group(at(kit.mesh(kit.cylinderY(0.0015, 0.12, 8), steel), 0, h / 2 - 0.06, 0), at(kit.mesh(kit.torus(0.004, 0.0012, 8, 20), steel), 0, h / 2, 0)))
		addModel("pan-balance", `pan-${side}`, ({ w }) =>
			kit.group(kit.mesh(kit.lathe([[0, -0.002], [w / 2 - 0.004, -0.002], [w / 2, 0.01], [w / 2 - 0.002, 0.011], [0, 0.0005]], 48, `balpan|${w.toFixed(3)}`), brass)))
		addModel("pan-balance", `lip-${side}-l`, null)
		addModel("pan-balance", `lip-${side}-r`, null)
	}

	// ============================================================== gram mass
	addModel("gram-mass", "mass", ({ w, h, props }) => {
		const r = w / 2
		const body = kit.lathe([[0, -h / 2], [r * 0.96, -h / 2], [r, -h / 2 + r * 0.06], [r, h / 2 - r * 0.1], [r * 0.9, h / 2], [r * 0.42, h / 2], [r * 0.38, h / 2 + r * 0.25], [r * 0.5, h / 2 + r * 0.55], [r * 0.4, h / 2 + r * 0.8], [0, h / 2 + r * 0.82]], 48, `gmass|${r.toFixed(4)}|${h.toFixed(4)}`)
		const g = kit.group(kit.mesh(body, brass))
		const label = kit.mesh(planeZ(w * 0.8, h * 0.28), kit.mat(`measure|gmlabel|${props?.grams}`, { map: kit.text("measure-gm", String(props?.grams ?? "100 g"), { bg: "#c9a24a", fg: "#5a4214", font: `700 92px ${SANS}`, w: 512, h: 160 }), roughness: 0.3, metalness: 0.9 }), { cast: false })
		at(label, 0, 0, r + 0.0004)
		g.add(label)
		return g
	})

	// ============================================================== protractor
	addModel("protractor", "face", ({ w, h }) => {
		const R = w / 2
		const tex = kit.tex(`measure-protractor|${Math.round(R * 1000)}`, 1024, 512, (c, W, H) => {
			c.clearRect(0, 0, W, H)
			c.fillStyle = "rgba(235,246,252,0.55)"
			c.beginPath()
			c.moveTo(0, H)
			c.arc(W / 2, H, W / 2, Math.PI, 0)
			c.closePath()
			c.fill()
			c.fillStyle = "#0e1a24"
			c.translate(W / 2, H)
			for (let a = 0; a <= 180; a++) {
				c.save()
				c.rotate(-Math.PI + (a * Math.PI) / 180)
				const len = a % 10 === 0 ? W * 0.07 : a % 5 === 0 ? W * 0.045 : W * 0.025
				c.fillRect(W / 2 - len - 2, -1.2, len, 2.4)
				c.restore()
			}
			c.font = `700 ${Math.round(W * 0.028)}px ${SANS}`
			c.textAlign = "center"
			c.textBaseline = "middle"
			for (let a = 0; a <= 180; a += 10) {
				const t = (a * Math.PI) / 180
				c.fillText(String(a), -Math.cos(t) * W * 0.39, -Math.sin(t) * W * 0.39)
			}
			c.fillRect(-W * 0.006, -H * 0.04, W * 0.012, H * 0.04)
			c.setTransform(1, 0, 0, 1, 0, 0)
		}, { wrap: false })
		const plate = kit.mesh(kit.geo(`measure|protr|${R.toFixed(4)}`, () => {
			const s = new THREE.Shape()
			s.moveTo(-R, 0)
			s.absarc(0, 0, R, Math.PI, 0, true)
			s.lineTo(-R, 0)
			const geo = new THREE.ShapeGeometry(s, 64)
			const uv = geo.attributes.uv
			const p = geo.attributes.position
			for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + R) / (2 * R), p.getY(i) / R)
			return geo.translate(0, -h / 2, 0)
		}), kit.mat(`measure|protractor|${Math.round(R * 1000)}`, { map: tex, transparent: true, roughness: 0.08, metalness: 0, side: THREE.DoubleSide, depthWrite: false }), { cast: false })
		plate.position.z = 0.07
		const arc = kit.mesh(kit.geo("measure|protr-arc", () => new THREE.RingGeometry(0.2, 0.23, 48, 1, 0, 1)), kit.mat("measure|protr-red", { color: "#e02424", roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }), { cast: false })
		arc.userData.frame = { hook: "measure:protractor", R, base: -h / 2 }
		arc.position.set(0, -h / 2, 0.072)
		return kit.group(plate, arc)
	})
	addFrameHook("measure:protractor", (obj, f, args) => {
		const a = fin(f.state.degrees) ? f.state.degrees : 0
		const R = args.R
		const key = a.toFixed(1)
		if (obj.userData._a === key) return
		obj.userData._a = key
		obj.geometry = new THREE.RingGeometry(R * 0.55, R * 0.62, 48, 1, 0, Math.max(0.001, (a * Math.PI) / 180))
	})

	// ============================================================== plumb line, metre stick, motion sensor
	addModel("plumb-line", "line", ({ h }) => {
		// the string runs from the clamp (the top: where it is tied) down into the bob, whose point is the line's bottom end (the spot it marks)
		const BOB = 0.048 // the bob's height, its point to its top
		const g = kit.group(at(kit.mesh(kit.cylinderY(0.0007, Math.max(0.001, h - BOB), 6), kit.fabric("#e8dcc0")), 0, BOB / 2, 0))
		const bob = kit.mesh(kit.lathe([[0, 0.04], [0.008, 0.035], [0.011, 0.02], [0.009, 0.008], [0, -0.008]], 24, "plumbbob"), brass)
		at(bob, 0, -h / 2 + 0.008, 0)
		g.add(bob, at(kit.mesh(kit.box(0.04, 0.012, 0.03, 0.002), black), 0, h / 2, 0))
		return g
	})
	addModel("metre-stick", "stick", ({ w, h, d }) => {
		const tex = kit.tex(`measure-metre|${w.toFixed(2)}`, Math.round(w * 2000), 64, (c, W, H) => {
			c.fillStyle = "#e9cf9a"
			c.fillRect(0, 0, W, H)
			c.fillStyle = "#1a1208"
			const px = W / w
			for (let mm = 0; mm <= Math.round(w * 1000); mm++) {
				const big = mm % 100 === 0
				const mid = mm % 10 === 0
				c.fillRect(mm * (px / 1000) - (big ? 1 : 0.5), 0, big ? 2 : 1, big ? H * 0.7 : mid ? H * 0.45 : H * 0.22)
			}
			c.font = `700 ${Math.round(H * 0.38)}px ${SANS}`
			c.textBaseline = "bottom"
			for (let cm = 10; cm < Math.round(w * 100); cm += 10) c.fillText(String(cm), cm * (px / 100) + 2, H - 2)
		}, { wrap: false })
		const wood = kit.wood("#e2c48c", { roughness: 0.5, varnish: 0.5 })
		const front = kit.mat(`measure|metre|${w.toFixed(2)}`, { map: tex, roughness: 0.5 })
		const top = kit.mat(`measure|metretop|${w.toFixed(2)}`, { map: tex, roughness: 0.5 })
		return kit.group(kit.mesh(kit.box(w, h, d, 0.0008), [wood, wood, top, wood, front, wood]))
	})
	addModel("motion-sensor", "box", ({ w, h, d }) => {
		const g = kit.group(kit.mesh(kit.box(w, h, d, 0.006), kit.plastic("#1f4fa8", { gloss: 0.5, key: "sensor" })))
		const disc = kit.mesh(kit.cylinderZ(h * 0.36, 0.006, 32), kit.metal("#b89a4a", { roughness: 0.6, key: "mesh" }))
		disc.rotation.y = Math.PI / 2
		at(disc, w / 2 + 0.003, 0, 0)
		g.add(disc)
		return g
	})

	// ============================================================== motion trail, boards (their pictures are the plug-ins')
	addModel("motion-trail", "tag", () => kit.group())
	// (the frame inside the board's own outline: its feet on what it stands on, never below it)
	const boardModel = ({ w, h }) => {
		const g = kit.group()
		g.add(kit.mesh(kit.box(w - 0.03, h - 0.03, 0.018, 0.004), kit.plastic("#fafaf8", { gloss: 0.35, key: "board" })))
		const frame = kit.metal("#b9bec4", { roughness: 0.35, key: "boardframe" })
		g.add(at(kit.mesh(kit.box(w, 0.02, 0.024, 0.004), frame), 0, h / 2 - 0.01, 0), at(kit.mesh(kit.box(w, 0.02, 0.024, 0.004), frame), 0, -h / 2 + 0.01, 0))
		g.add(at(kit.mesh(kit.box(0.02, h - 0.04, 0.024, 0.004), frame), w / 2 - 0.01, 0, 0), at(kit.mesh(kit.box(0.02, h - 0.04, 0.024, 0.004), frame), -w / 2 + 0.01, 0, 0))
		return g
	}
	addModel("graph-board", "board", boardModel)
	addModel("data-table", "board", boardModel)

	// ============================================================== plug-in: supports (legs under lanes, poles under floating displays)
	addViewPlugin({
		name: "measure:supports",
		load(ctx) {
			const lanes = ctx.itemsOfType("lane")
			const displays = [...ctx.itemsOfType("stopwatch"), ...ctx.itemsOfType("speedometer"), ...ctx.itemsOfType("graph-board"), ...ctx.itemsOfType("data-table")]
			const plumbs = ctx.itemsOfType("plumb-line")
			const nms = ctx.itemsOfType("spring-scale")
			if (!lanes.length && !displays.length && !plumbs.length && !nms.length) return null
			const table = ctx.doc.solids.find((s) => s.itemType === "table" && s.part === "top")
			const tx0 = table ? table.at.x - table.body.width / 2 : 0
			const tx1 = table ? table.at.x + table.body.width / 2 : -1
			const tTop = table ? table.at.y + table.body.height / 2 : ROOM_FLOOR
			const floors = ctx.doc.solids.filter((s) => s.itemType === "lane" && s.part === "floor")
			/** The top of what stands under (x, y) at the back (a lane below, the table, else the room's floor). */
			const groundAt = (x, y, z, self) => {
				let g = x >= tx0 && x <= tx1 ? tTop : ROOM_FLOOR
				for (const f of floors) {
					if (f === self) continue
					const top = f.at.y + f.body.height / 2
					const hw = f.body.width / 2
					if (top < y - 0.005 && top > g && x >= f.at.x - hw && x <= f.at.x + hw && Math.abs(z) <= f.body.depth / 2) g = top
				}
				return g
			}
			const legMat = kit.metal("#9aa1a8", { roughness: 0.4, key: "legs" })
			for (const f of floors) {
				const bottom = f.at.y - f.body.height / 2
				const hw = f.body.width / 2
				const zb = -f.body.depth / 2 + 0.03
				const n = Math.max(1, Math.ceil((2 * hw) / 2))
				for (let i = 0; i <= n; i++) {
					const x = f.at.x - hw + 0.15 + (i / n) * (2 * hw - 0.3)
					const g = groundAt(x, bottom, zb, f)
					const len = bottom - g
					if (len < 0.015) continue
					const leg = kit.mesh(kit.box(0.03, len, 0.03, 0.003), legMat)
					leg.position.set(x, g + len / 2, zb)
					const arm = kit.mesh(kit.box(0.03, 0.02, f.body.depth - 0.06, 0.003), legMat)
					arm.position.set(x, bottom - 0.01, 0)
					const foot = kit.mesh(kit.box(0.08, 0.008, 0.08, 0.002), legMat)
					foot.position.set(x, g + 0.004, zb)
					ctx.group.add(leg, arm, foot)
				}
			}
			for (const id of displays) {
				const s = ctx.solidsOf(id).find((q) => q.ghost)
				if (!s) continue
				const hh = (s.body.height ?? 0.1) / 2
				const zb = -0.42
				const bottom = s.at.y - hh
				const g = groundAt(s.at.x, bottom, zb, null)
				const len = bottom - g
				if (len < 0.02) continue
				const pole = kit.mesh(kit.cylinderY(0.012, len, 16), black)
				pole.position.set(s.at.x, g + len / 2, zb)
				const arm = kit.mesh(kit.box(0.025, 0.025, Math.abs(zb) - 0.02, 0.003), black)
				arm.position.set(s.at.x, s.at.y, zb / 2 - 0.01)
				const foot = kit.mesh(kit.cylinderY(0.09, 0.012, 32), black)
				foot.position.set(s.at.x, g + 0.006, zb)
				ctx.group.add(pole, arm, foot)
			}
			// a plumb line hangs from a retort stand's arm: a steel rod behind it (out of the motion plane) on a heavy cast foot on what is under
			// it, a boss head at the string's top, and an arm forward to the clamp the string is tied to (the model's black block)
			const darkMetal = kit.metal("#2b2f34", { roughness: 0.55, key: "standfoot" })
			/** A retort stand behind (x, top): a steel rod out of the motion plane on a heavy cast foot on what is under it, a boss head at `top`,
			 *  and an arm forward to what it holds (a plumb line's clamp, a spring scale's ring). */
			const retortStand = (x, top) => {
				const zb = -0.12
				const g = groundAt(x, top, zb, null)
				const len = top + 0.05 - g
				if (len < 0.03) return
				const rod = kit.mesh(kit.cylinderY(0.0065, len, 18), steel)
				rod.position.set(x, g + len / 2, zb)
				const cap = kit.mesh(kit.sphere(0.0067, 14, 10), steel)
				cap.position.set(x, g + len, zb)
				const foot = kit.mesh(kit.box(0.11, 0.02, 0.22, 0.005), darkMetal)
				foot.position.set(x, g + 0.01, zb - 0.08)
				const boss = kit.mesh(kit.box(0.028, 0.028, 0.028, 0.003), darkMetal)
				boss.position.set(x, top + 0.004, zb)
				const knob = kit.mesh(kit.cylinderY(0.0075, 0.012, 14), darkMetal)
				knob.rotation.z = Math.PI / 2
				knob.position.set(x + 0.022, top + 0.004, zb)
				const arm = kit.mesh(kit.cylinderY(0.005, Math.abs(zb) - 0.01, 16), steel)
				arm.rotation.x = Math.PI / 2
				arm.position.set(x, top + 0.004, zb / 2 - 0.005)
				ctx.group.add(rod, cap, foot, boss, knob, arm)
			}
			for (const id of plumbs) {
				const s = ctx.solidsOf(id).find((q) => q.ghost)
				if (s) retortStand(s.at.x, s.at.y + (s.body.height ?? 0.5) / 2)
			}
			// a spring scale hangs by its ring from a stand's arm (its ring is 1.4 cm over its tube's top: the model's)
			for (const id of nms) {
				const s = ctx.solidsOf(id).find((q) => q.part === "case")
				if (s) retortStand(s.at.x, s.at.y + (s.body.height ?? 0.25) / 2 + 0.026)
			}
			ctx.group.traverse((o) => {
				if (o.isMesh) {
					o.castShadow = true
					o.receiveShadow = true
				}
			})
			return { frame() {}, dispose() {} }
		}
	})

	// ============================================================== plug-in: motion trails
	addViewPlugin({
		name: "measure:trails",
		load(ctx) {
			const trails = []
			for (const id of ctx.itemsOfType("motion-trail")) {
				const P = ctx.resolved[id] ?? {}
				if (typeof P.watch === "string") trails.push({ watch: P.watch, color: TRAIL[P.color] ?? TRAIL.red, style: P.style ?? "line", every: Number(P.strobe_s) || 0.5, fade: Number(P.fade_s) || 0 })
			}
			for (const [id, P] of Object.entries(ctx.resolved ?? {})) if (P && (P.trail === true || Number(P.strobe_s) > 0) && !ctx.itemsOfType("motion-trail").includes(id) && ctx.solidsOf(id).some((s) => s.kind === "dynamic")) trails.push({ watch: id, color: TRAIL[P.trail_color] ?? TRAIL[P.color] ?? TRAIL.red, style: Number(P.strobe_s) > 0 ? "ghosts" : "line", every: Number(P.strobe_s) || 0.5, fade: Number(P.trail_s) || 0 })
			if (!trails.length) return null
			const fr = ctx.track?.frames ?? []
			if (!fr.length) return null
			const recs = []
			for (const tr of trails) {
				const sol = ctx.solidsOf(tr.watch).filter((s) => s.kind === "dynamic")
				if (!sol.length) continue
				// the item's middle at every frame, and its depth (the trail is drawn just in front of it)
				const pts = []
				let z = 0
				for (const s of sol) z = Math.max(z, (s.body.depth ?? 2 * (s.body.radius ?? 0.02)) / 2)
				for (const f of fr) {
					let x = 0
					let y = 0
					let n = 0
					for (const s of sol) {
						const p = f.placements[s.id] ?? fr[0].placements[s.id]
						if (!p) continue
						x += p.x
						y += p.y
						n++
					}
					if (n) pts.push({ t: f.t, x: x / n, y: y / n })
				}
				const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tr.color), transparent: true, opacity: 0.85, depthWrite: false })
				const rec = { tr, pts, z: z + 0.012, mat, line: null, dots: [], ghosts: [], shownUpTo: -1 }
				if (tr.style === "line") {
					const geo = new THREE.BufferGeometry()
					geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(2, pts.length) * 3 * 2), 3))
					const tube = new THREE.Mesh(geo, mat)
					tube.frustumCulled = false
					rec.line = tube
					ctx.group.add(tube)
				} else {
					const every = Math.max(0.02, tr.every)
					const t0 = pts.length ? pts[0].t : 0
					for (let t = t0; t <= (pts.at(-1)?.t ?? 0) + 1e-9; t += every) {
						const p = pts.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a), pts[0])
						if (tr.style === "dots") {
							const dot = new THREE.Mesh(kit.sphere(0.012, 16, 8), mat)
							dot.position.set(p.x, p.y, rec.z)
							dot.visible = false
							dot.userData.t = t
							rec.dots.push(dot)
							ctx.group.add(dot)
						} else {
							// a ghost copy: each solid's outline as a faint body at that moment
							const ghost = new THREE.Group()
							const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(tr.color), transparent: true, opacity: 0.22, depthWrite: false })
							const f = fr.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a), fr[0])
							for (const s of sol) {
								const q = f.placements[s.id] ?? fr[0].placements[s.id]
								if (!q) continue
								const b = s.body
								const geo = b.kind === "ball" ? kit.sphere(b.radius, 20, 12) : b.kind === "polygon" ? kit.extrude(b.points.map((v) => [v.x, v.y]), b.depth) : kit.box(b.width, b.height, b.depth, 0.001)
								const m = new THREE.Mesh(geo, gm)
								m.position.set(q.x, q.y, 0)
								m.rotation.z = q.angle ?? 0
								ghost.add(m)
							}
							ghost.visible = false
							ghost.userData.t = t
							rec.ghosts.push(ghost)
							ctx.group.add(ghost)
						}
					}
				}
				recs.push(rec)
			}
			if (!recs.length) return null
			const W = 0.012 // the line's half height (a ribbon facing the camera)
			return {
				frame(t) {
					for (const r of recs) {
						const from = r.tr.fade > 0 ? t - r.tr.fade : -Infinity
						if (r.line) {
							const pos = r.line.geometry.attributes.position
							let k = 0
							for (const p of r.pts) {
								if (p.t > t + 1e-9) break
								if (p.t < from) continue
								pos.setXYZ(k++, p.x, p.y - W, r.z)
								pos.setXYZ(k++, p.x, p.y + W, r.z)
							}
							const idx = []
							for (let i = 0; i + 3 < k; i += 2) idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3)
							r.line.geometry.setIndex(idx)
							pos.needsUpdate = true
						}
						for (const d of r.dots) d.visible = d.userData.t <= t + 1e-9 && d.userData.t >= from
						for (const gh of r.ghosts) gh.visible = gh.userData.t <= t + 1e-9 && gh.userData.t >= from
					}
				},
				dispose() {
					for (const r of recs) r.mat.dispose()
				}
			}
		}
	})

	// ============================================================== plug-in: graph boards and data tables
	addViewPlugin({
		name: "measure:boards",
		load(ctx) {
			const graphs = ctx.itemsOfType("graph-board")
			const tables = ctx.itemsOfType("data-table")
			if (!graphs.length && !tables.length) return null
			const fr = ctx.track?.frames ?? []
			const dur = fr.length ? fr[fr.length - 1].t : 1
			const boards = []
			const LINE = ["#d6312b", "#2563d4", "#2f9e44"]
			const nameOf = (id, owner) => ctx.resolved?.[owner]?.names?.[id] ?? ctx.sim?.summary?.stories?.find?.((s) => s.item === id)?.name ?? id
			const middleOf = (id) => {
				const sol = ctx.solidsOf(id).filter((s) => s.kind === "dynamic")
				if (!sol.length) return null
				return fr.map((f) => {
					let x = 0
					let y = 0
					for (const s of sol) {
						const p = f.placements[s.id] ?? fr[0].placements[s.id]
						x += p?.x ?? 0
						y += p?.y ?? 0
					}
					return { t: f.t, x: x / sol.length, y: y / sol.length }
				})
			}
			for (const id of graphs) {
				const s = ctx.solidsOf(id)[0]
				const P = ctx.resolved[id] ?? {}
				if (!s) continue
				const series = []
				for (const [k, key] of ["watch", "watch2", "watch3"].entries()) {
					const w = P[key]
					if (typeof w !== "string") continue
					let pts = null
					if (P.plot === "reading") {
						// (its main reading with its unit, as the builder picked it: a thermometer's reading in °C, a cup's water_temp, a scale's grams)
						const st = ctx.track?.state?.[w]
						const rd = P.reads?.[w] ?? null
						const rk = st ? (rd && Array.isArray(st[rd.key]) ? rd.key : Object.keys(st)[0]) : null
						if (rk) pts = fr.map((f, i) => ({ t: f.t, v: st[rk][i] ?? st[rk][st[rk].length - 1] }))
					} else {
						const m = middleOf(w)
						if (m) {
							if (P.plot === "speed") pts = m.map((p, i) => ({ t: p.t, v: i ? Math.hypot(p.x - m[Math.max(0, i - 2)].x, p.y - m[Math.max(0, i - 2)].y) / Math.max(1e-6, p.t - m[Math.max(0, i - 2)].t) : 0 }))
							else pts = m.map((p) => ({ t: p.t, v: Math.hypot(p.x - m[0].x, p.y - m[0].y) }))
						}
					}
					if (pts) series.push({ name: nameOf(w, id), color: LINE[k], pts, unit: P.plot === "reading" ? P.reads?.[w]?.unit ?? "" : null, label: P.plot === "reading" ? P.reads?.[w]?.label ?? "reading" : null })
				}
				const W = 1024
				const H = Math.round((1024 * (s.body.height ?? 0.8)) / (s.body.width ?? 1.2))
				const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H })
				const tex = new THREE.CanvasTexture(canvas)
				tex.colorSpace = THREE.SRGBColorSpace
				const plane = new THREE.Mesh(new THREE.PlaneGeometry((s.body.width ?? 1.2) - 0.05, (s.body.height ?? 0.8) - 0.05), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
				plane.position.set(s.at.x, s.at.y, 0.0105)
				ctx.group.add(plane)
				const tMax = Number(P.t_max) > 0 ? Number(P.t_max) : dur
				const vals = series.flatMap((q) => q.pts.map((p) => (Number.isFinite(p.v) ? p.v : 0)))
				const hi = vals.length ? Math.max(...vals) : 0
				const lo = vals.length ? Math.min(...vals) : 0
				// (from 0, or below it for readings that go under, a temperature under 0 °C; a little room over the highest)
				const vMin = lo < 0 ? lo * 1.08 : 0
				const vMax = Math.max(vMin + 1e-6, hi > 0 ? hi * 1.08 : 0)
				const units = [...new Set(series.map((q) => q.unit).filter((u) => typeof u === "string"))]
				const labels = [...new Set(series.map((q) => q.label).filter(Boolean))]
				const unit = P.plot === "speed" ? "speed (m/s)" : P.plot === "reading" ? `${labels.length === 1 ? labels[0] : "reading"}${units.length === 1 && units[0] ? ` (${units[0]})` : ""}` : "distance (m)"
				// the time axis in the lesson's time when the scene runs time-lapsed (a 15-minute heating curve in minutes, as a lesson stopwatch shows it)
				const lapse = Number(ctx.doc?.settings?.timeLapse) > 1 ? Number(ctx.doc.settings.timeLapse) : 1
				const minutes = lapse > 1 && tMax * lapse >= 120
				const tUnit = lapse > 1 ? (minutes ? "time (min)" : "time (s)") : "time (s)"
				const tScale = lapse > 1 ? (minutes ? lapse / 60 : lapse) : 1
				boards.push({ kind: "graph", canvas, tex, W, H, series, tMax, vMin, vMax, unit, tUnit, tScale, shown: -1 })
			}
			for (const id of tables) {
				const s = ctx.solidsOf(id)[0]
				const P = ctx.resolved[id] ?? {}
				if (!s) continue
				const rows = []
				for (const key of ["watch", "watch2", "watch3", "watch4"]) {
					const w = P[key]
					if (typeof w !== "string") continue
					rows.push({ id: w, name: nameOf(w, id) })
				}
				const W = 1024
				const H = Math.round((1024 * (s.body.height ?? 0.7)) / (s.body.width ?? 1.0))
				const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H })
				const tex = new THREE.CanvasTexture(canvas)
				tex.colorSpace = THREE.SRGBColorSpace
				const plane = new THREE.Mesh(new THREE.PlaneGeometry((s.body.width ?? 1) - 0.05, (s.body.height ?? 0.7) - 0.05), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
				plane.position.set(s.at.x, s.at.y, 0.0105)
				ctx.group.add(plane)
				// (shown: null, so a table with no rows still draws its title and its white face on the first frame)
				boards.push({ kind: "table", canvas, tex, W, H, rows, reads: P.reads ?? {}, title: P.title ?? "Results", shown: null })
			}
			const SANS2 = "'Helvetica Neue', Helvetica, Arial, sans-serif"
			const readingText = (id, t, reads = {}) => {
				const st = ctx.readings(id, t)
				const type = ctx.doc.solids.find((q) => q.item === id)?.itemType
				if (type === "stopwatch") return clockText(stopwatchShows(st, t).s) + " s"
				if (type === "measuring-tape" && fin(st.meters)) return `${st.meters.toFixed(2)} m`
				if (type === "speed-gate" && fin(st.speed) && fin(st.exit_s) && t >= st.exit_s) return `${st.speed.toFixed(2)} m/s`
				if (type === "speedometer" && fin(st.speed)) return `${st.speed.toFixed(2)} m/s`
				if (type === "spring-scale" && fin(st.newtons)) return `${st.newtons.toFixed(2)} N`
				if (type === "kitchen-scale" && fin(st.grams)) return `${Math.round(st.grams)} g`
				// (another module's instrument: its main reading with its unit, as the builder picked it)
				const rd = reads[id]
				if (rd && fin(st[rd.key])) return `${st[rd.key].toFixed(Math.max(0, Math.min(3, Number(rd.digits) || 0)))}${rd.unit ? ` ${rd.unit}` : ""}`
				const k = Object.keys(st)[0]
				return k && fin(st[k]) ? `${st[k].toFixed(2)}` : "—"
			}
			return {
				frame(t) {
					for (const b of boards) {
						const g = b.canvas.getContext("2d")
						if (b.kind === "graph") {
							const key = Math.round(t * 60)
							if (key === b.shown) continue
							b.shown = key
							const { W, H } = b
							g.fillStyle = "#ffffff"
							g.fillRect(0, 0, W, H)
							const L = W * 0.13
							const B = H * 0.84
							const R = W * 0.96
							const T = H * 0.08
							g.strokeStyle = "#e3e6ea"
							g.lineWidth = 2
							for (let i = 1; i <= 4; i++) {
								g.beginPath()
								g.moveTo(L, B - ((B - T) * i) / 4)
								g.lineTo(R, B - ((B - T) * i) / 4)
								g.stroke()
							}
							g.strokeStyle = "#222"
							g.lineWidth = 4
							g.beginPath()
							g.moveTo(L, T)
							g.lineTo(L, B)
							g.lineTo(R, B)
							g.stroke()
							g.fillStyle = "#222"
							g.font = `600 ${Math.round(H * 0.06)}px ${SANS2}`
							g.textAlign = "center"
							g.fillText(b.tUnit, (L + R) / 2, H * 0.97)
							for (let i = 0; i <= 4; i++) {
								const tv = ((b.tMax * i) / 4) * b.tScale
								g.fillText(tv >= 100 ? tv.toFixed(0) : tv.toFixed(1), L + ((R - L) * i) / 4, B + H * 0.065)
								// (no numbers up the side when nothing is linked: there is nothing to scale)
								if (!b.series.length) continue
								const vv = b.vMin + ((b.vMax - b.vMin) * i) / 4
								g.textAlign = "right"
								g.fillText(Math.abs(vv) >= 100 ? vv.toFixed(0) : vv.toFixed(1), L - 8, B - ((B - T) * i) / 4 + H * 0.02)
								g.textAlign = "center"
							}
							g.save()
							g.translate(W * 0.03, (T + B) / 2)
							g.rotate(-Math.PI / 2)
							g.fillText(b.unit, 0, 0)
							g.restore()
							for (const [k, s] of b.series.entries()) {
								g.strokeStyle = s.color
								g.lineWidth = 6
								g.beginPath()
								let first = true
								for (const p of s.pts) {
									if (p.t > t || p.t > b.tMax) break
									const x = L + ((R - L) * p.t) / b.tMax
									const y = B - ((B - T) * ((Number.isFinite(p.v) ? p.v : 0) - b.vMin)) / (b.vMax - b.vMin)
									if (first) g.moveTo(x, y)
									else g.lineTo(x, y)
									first = false
								}
								g.stroke()
								g.fillStyle = s.color
								g.textAlign = "left"
								g.fillText(s.name, L + 20, T + H * 0.07 * (k + 1))
							}
						} else {
							const lines = b.rows.map((r) => `${r.name}|${readingText(r.id, t, b.reads)}`)
							const key = lines.join("\n")
							if (key === b.shown) continue
							b.shown = key
							const { W, H } = b
							g.fillStyle = "#ffffff"
							g.fillRect(0, 0, W, H)
							g.fillStyle = "#16324f"
							g.font = `700 ${Math.round(H * 0.11)}px ${SANS2}`
							g.textAlign = "left"
							g.fillText(b.title, W * 0.05, H * 0.15)
							g.fillRect(W * 0.05, H * 0.19, W * 0.9, 4)
							g.font = `600 ${Math.round(H * 0.09)}px ${SANS2}`
							lines.forEach((l, i) => {
								const [n, v] = l.split("|")
								const y = H * (0.34 + 0.15 * i)
								g.fillStyle = "#222"
								g.textAlign = "left"
								g.fillText(n, W * 0.06, y)
								g.textAlign = "right"
								g.fillText(v, W * 0.94, y)
							})
						}
						b.tex.needsUpdate = true
					}
				},
				dispose() {
					for (const b of boards) b.tex.dispose()
				}
			}
		}
	})
}
