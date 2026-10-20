// The inspector's controls for what the physics modules add (web/inspector.js builds them; the styles are panels.css's own classes):
//   linkField(link, getScene, emit)   a link to another item of the scene (a stopwatch's watched car, a wire's end): a select of the items of
//                                     the link's types, and "none"; emit(id | undefined) stores the other item's id in the item's props
//   readoutsField(type)               the type's readings in the last run (track.state, as summary.readings has them at the run's end)
//   settingsRows(sceneRow, onScene)   the scene's settings: gravity (a preset or m/s²), air on/off, room temperature, time-lapse, and the camera
//                                     (Wide, or Fixed with its x0, x1, aim height, tilt and lens: settings.camera, the staging module)
// Plain ES module, no dependencies.
const h = (tag, cls, html) => {
	const e = document.createElement(tag)
	if (cls) e.className = cls
	if (html != null) e.innerHTML = html
	return e
}
const fmtNum = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—") // (a reading keeps its digits: "58.0 °C")

/** A link prop: {row, update(item, resolved, scene)}. */
export function linkField(link, getScene, emit) {
	const row = h("div", "field", `<div class="field-top"><label></label><select class="num insp-link"></select></div>`)
	row.querySelector("label").textContent = link.label ?? link.key
	if (link.help) row.title = link.help
	const sel = row.querySelector("select")
	sel.setAttribute("aria-label", link.label ?? link.key)
	sel.dataset.link = link.key
	let shown = ""
	sel.addEventListener("change", () => emit(sel.value === "" ? undefined : sel.value))
	const update = (it) => {
		const scene = getScene?.() ?? { items: [] }
		const options = (scene.items ?? []).filter((o) => o.id !== it.id && (!link.types?.length || link.types.includes(o.type)))
		const sig = JSON.stringify([options.map((o) => [o.id, o.name ?? ""]), it.props?.[link.key] ?? ""])
		if (sig === shown) return
		shown = sig
		const cur = typeof it.props?.[link.key] === "string" ? it.props[link.key] : ""
		const opts = [h("option", "", "none")]
		opts[0].value = ""
		for (const o of options) {
			const op = h("option")
			op.value = o.id
			op.textContent = o.name ? `${o.name} (${o.id})` : o.id
			opts.push(op)
		}
		// (a link to an item that is not there any more, or of another type: shown as such, so it can be seen and changed)
		if (cur && !options.some((o) => o.id === cur)) {
			const op = h("option")
			op.value = cur
			op.textContent = `${cur} (missing)`
			opts.push(op)
		}
		sel.replaceChildren(...opts)
		sel.value = cur
	}
	return { row, update }
}

/** The readings of a type's items in the last run: {row, update(item, readings)}; readings = summary.readings ({item: {key: value}}). */
export function readoutsField(type) {
	const row = h("div", "field insp-readouts", `<div class="field-top"><label>In the last run (at its end)</label></div><div class="insp-readout-list"></div>`)
	const list = row.querySelector(".insp-readout-list")
	const cells = (type.readouts ?? []).map((r) => {
		const line = h("div", "field-top")
		const lab = h("label")
		lab.textContent = r.label ?? r.key
		if (r.help) line.title = r.help
		const val = h("span", "unit")
		line.append(lab, val)
		list.append(line)
		return { r, val }
	})
	const update = (it, readings) => {
		const mine = readings?.[it.id] ?? null
		for (const { r, val } of cells) {
			const v = mine?.[r.key]
			// (a state code says its word, "in pieces", never "Broken 2": the readout's words, items.py Readout)
			const w = typeof v === "number" && r.words ? r.words[String(Math.round(v))] : undefined
			const t = v === undefined || v === null ? "—" : w ?? `${fmtNum(v, Number.isInteger(r.digits) ? r.digits : 2)}${r.unit ? ` ${r.unit}` : ""}`
			if (val.textContent !== t) val.textContent = t
		}
	}
	return { row, update }
}

// The places a scene can stand on (the space module: NASA NSSDCA planetary fact sheets): their surface gravity (a preset name or m/s²) and their
// air. Where they have none, choosing one sets air off too; where they have their own (AIR_OF, kg/m³: Mars's surface ~0.020, Venus's ~65, the
// giants' at the 1-bar level: Jupiter 0.16, Saturn 0.19, Neptune 0.45), the air stays on at that density (settings.air_density). Earth brings
// the room's air back (1.2 kg/m³).
const GRAVITY = [
	["", "Earth (9.81 m/s²)"],
	["moon", "the Moon (1.62 m/s², no air)"],
	["mars", "Mars (3.71 m/s², thin air 0.020 kg/m³)"],
	["jupiter", "Jupiter's cloud tops (24.79 m/s², air 0.16 kg/m³)"],
	["3.7", "Mercury (3.70 m/s², no air)"],
	["8.87", "Venus (8.87 m/s², thick air 65 kg/m³)"],
	["10.44", "Saturn's cloud tops (10.44 m/s², air 0.19 kg/m³)"],
	["11.15", "Neptune's cloud tops (11.15 m/s², air 0.45 kg/m³)"],
	["0.62", "Pluto (0.62 m/s², no air)"],
	["none", "No gravity (a space station, outer space)"]
]
const AIRLESS = new Set(["moon", "3.7", "0.62"])
const AIR_OF = { mars: 0.02, jupiter: 0.16, "8.87": 65, "10.44": 0.19, "11.15": 0.45 }

// A fixed camera's numbers (machines/mod_staging.py CAMERA_LIMITS, CAMERA_DEFAULTS, SPAN): [key, label, unit, lo, hi, step, default, help]
const CAMERA_FIELDS = [
	["x0", "Camera from", "m", -1000, 1000, 0.1, null, "The left edge of the picture: x on the machine's plane at the aim height"],
	["x1", "Camera to", "m", -1000, 1000, 0.1, null, "The right edge of the picture: x on the machine's plane at the aim height (0.1 to 300 m right of the left edge)"],
	["y", "Camera aim", "m", -10, 100, 0.05, 0.3, "The height the camera looks at: the picture's centre line"],
	["pitch", "Camera tilt", "° down", -20, 80, 0.5, 6.843, "How far it looks down (the Wide shot's own tilt: 6.8°)"],
	["hfov", "Camera lens", "° across", 5, 120, 1, 69.39, "Its field of view across the picture (69.4°: a phone's 26 mm lens; less is a longer lens, further away)"],
]
const CAMERA_SPAN = [0.1, 300]
/** A fixed camera to start from: what the scene's items stand over (their x, 0.75 m more each side, at least 2 m), the Wide shot's lens and tilt. */
function cameraFor(scene) {
	const xs = (scene?.items ?? []).map((i) => i?.x).filter((x) => typeof x === "number" && Number.isFinite(x))
	let x0 = xs.length ? Math.min(...xs) - 0.75 : -1.5
	let x1 = xs.length ? Math.max(...xs) + 0.75 : 4.5
	if (x1 - x0 < 2) [x0, x1] = [(x0 + x1) / 2 - 1, (x0 + x1) / 2 + 1]
	x0 = Math.max(-1000, Math.round(x0 * 10) / 10)
	x1 = Math.min(1000, Math.min(x0 + CAMERA_SPAN[1], Math.round(x1 * 10) / 10))
	return { x0, x1 }
}

/** The scene's settings rows (in the Scene group): {update(scene)}. onScene({settings}, commit) with only the non-standard keys kept. */
export function settingsRows(sceneRow, onScene) {
	let cur = {}
	const put = (key, value) => {
		const st = { ...cur }
		if (value === undefined) delete st[key]
		else st[key] = value
		onScene?.({ settings: Object.keys(st).length ? st : undefined }, true)
	}
	const gravity = h("select", "num insp-gravity")
	gravity.setAttribute("aria-label", "Gravity")
	for (const [v, t] of GRAVITY) {
		const o = h("option")
		o.value = v
		o.textContent = t
		gravity.append(o)
	}
	gravity.addEventListener("change", () => {
		// (a number of m/s² is stored as a number; a world with no air takes the air away with it, Earth brings it back: one step)
		const v = gravity.value
		const st = { ...cur }
		if (v === "") delete st.gravity
		else st.gravity = /^[0-9.]+$/.test(v) ? Number(v) : v
		if (AIRLESS.has(v)) {
			st.air = false
			delete st.air_density
		} else if (v in AIR_OF) {
			delete st.air
			st.air_density = AIR_OF[v]
		} else {
			if (v === "") delete st.air
			delete st.air_density // (Earth, or a space station's room air)
		}
		onScene?.({ settings: Object.keys(st).length ? st : undefined }, true)
	})
	const air = h("input", "insp-air")
	air.type = "checkbox"
	air.setAttribute("aria-label", "Air")
	air.addEventListener("change", () => put("air", air.checked ? undefined : false))
	const num = (label, lo, hi, step, def, key) => {
		const box = h("input", "num insp-setting")
		box.type = "number"
		box.min = String(lo)
		box.max = String(hi)
		box.step = String(step)
		box.setAttribute("aria-label", label)
		box.addEventListener("change", () => {
			const v = Number(box.value)
			if (!Number.isFinite(v)) return
			const c = Math.min(hi, Math.max(lo, v))
			put(key, c === def ? undefined : c)
		})
		return box
	}
	const room = num("Room temperature", -60, 60, 1, 20, "room_temp")
	const lapse = num("Time-lapse", 1, 100000, 1, 1, "time_lapse")
	const density = num("Air density", 0.001, 100, 0.001, 1.2, "air_density")
	density.title = "The air's density for drag and buoyancy: 1.2 kg/m³ a room's; Mars's thin air 0.020, Venus's 65 (NASA fact sheets)"
	sceneRow("Gravity", gravity)
	sceneRow("Air", air, "on")
	sceneRow("Air density", density, "kg/m³")
	sceneRow("Room temperature", room, "°C")
	sceneRow("Time-lapse", lapse, "×")
	// The camera (the staging module's settings.camera {x0, x1, y, pitch, hfov}: machines/mod_staging.py): Wide frames each run by itself; Fixed
	// films every run from the same place (lanes that line up, a long track), the canvas's Wide shot and the export's Wide and Fixed cameras.
	// Its numbers show while it is on; one left at its default is not stored (the doc fills it in).
	let scn = null
	const camMode = h("select", "num insp-camera")
	camMode.setAttribute("aria-label", "Camera")
	for (const [v, t, tip] of [["", "Wide", "Frames each run by itself"], ["fixed", "Fixed", "The same shot every run"]]) {
		const o = h("option")
		o.value = v
		o.textContent = t
		o.title = tip
		camMode.append(o)
	}
	camMode.title = "Wide frames each run by itself. Fixed: every run is filmed from the same place, so lanes run apart line up and a long track stays in the picture"
	camMode.addEventListener("change", () => put("camera", camMode.value === "fixed" ? cameraFor(scn) : undefined))
	sceneRow("Camera", camMode)
	const camBoxes = CAMERA_FIELDS.map(([key, label, unit, lo, hi, step, def, help]) => {
		const box = h("input", "num insp-setting insp-cam")
		box.type = "number"
		box.min = String(lo)
		box.max = String(hi)
		box.step = String(step)
		box.dataset.cam = key
		box.setAttribute("aria-label", label)
		box.title = help
		box.addEventListener("change", () => {
			const cam = { ...(cur.camera && typeof cur.camera === "object" ? cur.camera : {}) }
			const v = Number(box.value)
			if (box.value.trim() === "" || !Number.isFinite(v)) return update(scn) // (put back what it was)
			let c = Math.min(hi, Math.max(lo, v))
			// (x1 - x0 from 0.1 to 300 m: the other end stays, this one moves into that range)
			if (key === "x0" && Number.isFinite(cam.x1)) c = Math.min(cam.x1 - CAMERA_SPAN[0], Math.max(cam.x1 - CAMERA_SPAN[1], c))
			if (key === "x1" && Number.isFinite(cam.x0)) c = Math.max(cam.x0 + CAMERA_SPAN[0], Math.min(cam.x0 + CAMERA_SPAN[1], c))
			c = Math.round(Math.min(hi, Math.max(lo, c)) * 1000) / 1000
			// (in floats as the server checks it: 4.5 - 4.4 is 0.0999…, so an end at the limit moves a millimetre more; one that cannot is put back)
			const spanOk = (a, b) => !Number.isFinite(a) || !Number.isFinite(b) || (b - a >= CAMERA_SPAN[0] && b - a <= CAMERA_SPAN[1])
			const ends = () => (key === "x0" ? [c, cam.x1] : key === "x1" ? [cam.x0, c] : [NaN, NaN])
			for (let i = 0; i < 3 && !spanOk(...ends()); i++) {
				const [a, b] = ends()
				const wider = b - a < CAMERA_SPAN[0]
				c = Math.round((key === "x0" ? c + (wider ? -0.001 : 0.001) : c + (wider ? 0.001 : -0.001)) * 1000) / 1000
			}
			if ((key === "x0" || key === "x1") && (!spanOk(...ends()) || c < lo || c > hi)) return update(scn)
			if (def !== null && c === def) delete cam[key]
			else cam[key] = c
			put("camera", cam)
		})
		sceneRow(label, box, unit)
		return { key, box, def, row: box.closest(".field") }
	})
	const update = (scene) => {
		scn = scene ?? null
		cur = scene?.settings && typeof scene.settings === "object" ? { ...scene.settings } : {}
		const cam = cur.camera && typeof cur.camera === "object" ? cur.camera : null
		if (camMode.value !== (cam ? "fixed" : "")) camMode.value = cam ? "fixed" : ""
		for (const b of camBoxes) {
			if (b.row) b.row.hidden = !cam
			if (cam && document.activeElement !== b.box) b.box.value = String(cam[b.key] ?? b.def ?? "")
		}
		const g = typeof cur.gravity === "string" ? cur.gravity.toLowerCase() : typeof cur.gravity === "number" ? String(cur.gravity) : ""
		if (![...gravity.options].some((o) => o.value === g)) {
			const o = h("option")
			o.value = g
			o.textContent = `${g} m/s²`
			gravity.append(o)
		}
		if (gravity.value !== (g === "earth" ? "" : g)) gravity.value = g === "earth" ? "" : g
		air.checked = cur.air !== false
		// (orbit mode, the space module: a scene with a sun, planet, moon or satellite is in space, with no gravity and no air whatever these say)
		const orbit = (scene?.items ?? []).some((i) => i && ["sun", "planet", "moon", "satellite"].includes(i.type))
		gravity.disabled = air.disabled = orbit
		density.disabled = orbit || cur.air === false
		if (document.activeElement !== density) density.value = String(cur.air_density ?? 1.2)
		gravity.title = air.title = orbit ? "Orbit mode: the scene's sun, planets, moons or satellites put it in space (no gravity but theirs, no air)" : ""
		if (document.activeElement !== room) room.value = String(cur.room_temp ?? 20)
		if (document.activeElement !== lapse) lapse.value = String(cur.time_lapse ?? 1)
	}
	return { update }
}
