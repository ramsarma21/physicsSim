// GRAVITY + SPACE: the exact JavaScript port of machines/mod_space.py (line for line: the parity tools compare the two number for number),
// and the module's plug-ins for the AI (goal kinds, knobs, digest lines, prompt snippets, change words). See mod_space.py for the physics.
// A module file takes everything from the framework object register_all gets (web/sim/items.js FRAMEWORK), so it imports nothing.
let F = null

const CAT = "Space"
const G = 6.6743e-11 // m^3/(kg s^2) [CODATA18]
const ENGINE_KG = 1e-21 // engine kilograms per real kilogram of a space body
const AU_KM = 149597870.7 // km [IAU 2012 B2]

// key: [name, kind, mass kg, mean radius km, smallest drawn diameter m, colour, usual primary, a km round it, sidereal period days] [NASA-PFS]
export const BODIES = {
	sun: ["the Sun", "star", 1.9885e30, 695700.0, 0.3, "#ffcc4d", null, 0.0, 0.0],
	mercury: ["Mercury", "planet", 3.301e23, 2439.7, 0.05, "#9e9a94", "sun", 57909000.0, 87.969],
	venus: ["Venus", "planet", 4.8673e24, 6051.8, 0.1, "#e3c48a", "sun", 108210000.0, 224.701],
	earth: ["Earth", "planet", 5.9722e24, 6371.0, 0.11, "#3f73c4", "sun", 149598000.0, 365.256],
	mars: ["Mars", "planet", 6.4169e23, 3389.5, 0.06, "#c1502e", "sun", 227956000.0, 686.98],
	jupiter: ["Jupiter", "planet", 1.89813e27, 69911.0, 0.22, "#d2b48c", "sun", 778479000.0, 4332.589],
	saturn: ["Saturn", "planet", 5.6832e26, 58232.0, 0.19, "#e0c88f", "sun", 1432041000.0, 10759.22],
	uranus: ["Uranus", "planet", 8.6811e25, 25362.0, 0.12, "#9fd8e0", "sun", 2867043000.0, 30685.4],
	neptune: ["Neptune", "planet", 1.02409e26, 24622.0, 0.12, "#4166d5", "sun", 4514953000.0, 60189.0],
	pluto: ["Pluto", "planet", 1.303e22, 1188.3, 0.025, "#c9b49a", "sun", 5869656000.0, 90560.0],
	moon: ["the Moon", "moon", 7.346e22, 1737.4, 0.03, "#b9b5ae", "earth", 384400.0, 27.3217],
	io: ["Io", "moon", 8.932e22, 1821.6, 0.03, "#e8d36a", "jupiter", 421800.0, 1.769],
	europa: ["Europa", "moon", 4.8e22, 1560.8, 0.027, "#d8cbb3", "jupiter", 671100.0, 3.551],
	ganymede: ["Ganymede", "moon", 1.4819e23, 2631.2, 0.04, "#a99f92", "jupiter", 1070400.0, 7.155],
	callisto: ["Callisto", "moon", 1.0759e23, 2410.3, 0.037, "#6f665d", "jupiter", 1882700.0, 16.689],
	titan: ["Titan", "moon", 1.3455e23, 2574.73, 0.04, "#d9a54a", "saturn", 1221870.0, 15.945],
	phobos: ["Phobos", "moon", 1.0659e16, 11.08, 0.015, "#7d6f62", "mars", 9378.0, 0.319],
	deimos: ["Deimos", "moon", 1.4762e15, 6.2, 0.012, "#8f8274", "mars", 23459.0, 1.262]
}
const PLANETS = ["earth", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]
const MOONS = ["moon", "io", "europa", "ganymede", "callisto", "titan", "phobos", "deimos"]

// the scene's scale: name -> [km per metre, real seconds per scene second, words]
export const SCALES = {
	"inner-planets": [149597870.7, 3456000.0, "1 m = 1 au (149.6 million km), 1 s = 40 days: Earth circles the Sun in 9.1 s, Mercury in 2.2 s"],
	"earth-moon": [300000.0, 172800.0, "1 m = 300,000 km, 1 s = 2 days: the Moon (1.28 m out) circles the Earth in 13.7 s"],
	"low-orbit": [10000.0, 600.0, "1 m = 10,000 km, 1 s = 10 minutes: the Earth is 1.27 m across, the ISS (420 km up) circles it in 9.3 s"],
	"jupiter-moons": [1000000.0, 43200.0, "1 m = 1 million km, 1 s = 12 hours: Io (0.42 m out) circles Jupiter in 3.5 s, Ganymede (1.07 m) in 14.3 s"],
	"mars-moons": [20000.0, 7200.0, "1 m = 20,000 km, 1 s = 2 hours: Phobos (0.47 m out) circles Mars in 3.8 s, Deimos (1.17 m) in 15.1 s"]
}
const SCALE_CHOICES = ["auto", "inner-planets", "earth-moon", "low-orbit", "jupiter-moons", "mars-moons", "custom"]
const AUTO_SCALE = { sun: "inner-planets", earth: "earth-moon", jupiter: "jupiter-moons", saturn: "jupiter-moons", mars: "mars-moons" }
const BODY_TYPES = ["sun", "planet", "moon"]
const SPACE_TYPES = ["sun", "planet", "moon", "satellite"]
const DIRECTIONS = ["counter-clockwise", "clockwise"]
// satellites: kind -> [name, slab width, height, depth (m), mass kg, look]; a model's weight changes nothing of its orbit
const CRAFT = {
	satellite: ["a small satellite", 0.09, 0.026, 0.03, 0.2, "foil"],
	"space-station": ["a space station", 0.12, 0.034, 0.05, 0.4, "foil"],
	cannonball: ["an iron cannonball", null, null, null, 0.111, "iron"],
	probe: ["a space probe", 0.05, 0.03, 0.03, 0.15, "foil"]
}
// a moon's orbit's tilt to its planet's orbit round the Sun (degrees): the Moon's 5.145 [NASA lunar fact sheet]; the others orbit close to their
// planet's equator, so their tilt is the planet's axial tilt (Jupiter 3.13, Saturn 26.73, Mars 25.19 [NASA-PFS]) (mod_space.py MOON_TILT)
export const MOON_TILT = { moon: 5.145, io: 3.13, europa: 3.13, ganymede: 3.13, callisto: 3.13, titan: 26.73, phobos: 25.19, deimos: 25.19 }
// a planet's axial tilt (obliquity to its orbit, degrees) [NASA-PFS]
export const OBLIQUITY = { mercury: 0.034, venus: 177.36, earth: 23.44, mars: 25.19, jupiter: 3.13, saturn: 26.73, uranus: 97.77, neptune: 28.32, pluto: 122.53 }
const DATES = ["march equinox", "june solstice", "september equinox", "december solstice"]

export function register_all(f) {
	F = f
	if (!F.CATEGORIES.includes(CAT)) F.CATEGORIES.push(CAT)
	_looks()
	_materials()
	_bodies()
	_craft()
	_hammer()
	_gnomon()
	_globe()
	_moon_ball()
	F.register_build_hook(_orbit_mode)
	F.register_build_hook(_lights)
	F.register_warning_hook(_space_warnings)
}

function _looks() {
	for (const [key, kw] of [
		["star", { fill: "#ffcc4d", shade: "#e09a1a", roughness: 1.0, metalness: 0.0, clearcoat: 0.0 }],
		["planet", { fill: "#3f73c4", shade: "#2a4f8a", roughness: 0.85, metalness: 0.0, clearcoat: 0.0 }],
		["moon rock", { fill: "#b9b5ae", shade: "#85817a", roughness: 0.95, metalness: 0.0, clearcoat: 0.0 }],
		["foil", { fill: "#d4a63a", shade: "#9c7420", roughness: 0.3, metalness: 0.9, clearcoat: 0.0 }],
		["iron", { fill: "#3a3a3c", shade: "#1f1f21", roughness: 0.55, metalness: 0.7, clearcoat: 0.0 }]
	]) {
		if (!(key in F.LOOK_FILL)) F.add_look(key, kw)
	}
}

function _materials() {
	// (a space body's density is whatever makes it weigh ENGINE_KG x its real mass; its bounce and friction are a rocky surface's, provisional)
	const def = (name, v) => {
		if (!(name in F.MATERIALS)) F.define_material(name, v, [])
	}
	def("planet rock", { density: 3000.0, bounce: 0.3, friction: 0.7, rolling: 0.02, side: 0.0, look: "planet", source: "A rocky surface (provisional); the density follows the body's real mass (engine scale)." })
	def("spacecraft aluminium", { density: 2700.0, bounce: 0.4, friction: 0.3, rolling: 0.01, side: 0.0, look: "foil", source: "Aluminium 2700 kg/m3 (CRC); a model's density follows its stated weight." })
	def("cast iron", { density: 7870.0, bounce: 0.5, friction: 0.4, rolling: 0.005, side: 0.0, look: "iron", source: "Iron 7870 kg/m3 (CRC)." })
	def("craft foam", { density: 25.0, bounce: 0.3, friction: 0.6, rolling: 0.02, side: 0.0, look: "foam", source: "A white craft-foam (expanded polystyrene) ball, about 25 kg/m3 (EPS 15-35 kg/m3, EN 13163; provisional)." })
}

// ---------------------------------------------------------------- the scene's scale and a body's size
export const body_key = (item, P) => (item.type === "sun" ? "sun" : P.body)

/** [km per metre, real seconds per scene second, name] that this body's own scale says. */
export function scale_of(item, P) {
	let name = P.scale
	if (name === "auto") name = AUTO_SCALE[body_key(item, P)] ?? "low-orbit"
	if (name === "custom") return [P.km_per_m, P.hours_per_s * 3600.0, name]
	const [k, s] = SCALES[name]
	return [k, s, name]
}

/** The scene's heaviest space body ([item, props]) or null: it sets the scene's scale (the first of equals). items: a Map or a list. */
export function heaviest(scene_items) {
	let best = null
	let bm = -1.0
	for (const it of scene_items instanceof Map ? scene_items.values() : scene_items) {
		if (!it || !BODY_TYPES.includes(it.type)) continue
		const P = F.props_of(it)
		const b = BODIES[body_key(it, P)]
		if (b === undefined || P.pulls === false) continue
		const m = b[2] * P.mass_scale
		if (m > bm) {
			best = [it, P]
			bm = m
		}
	}
	return best
}

function scene_scale(c) {
	const h = heaviest(c.sb.scene_items)
	if (h === null) {
		const [k, s] = SCALES["earth-moon"]
		return [k, s, "earth-moon", null]
	}
	const [k, s, name] = scale_of(h[0], h[1])
	return [k, s, name, h[0].id]
}

const _mu = (mass, k, s) => {
	const m = k * 1000.0
	return (G * mass * (s * s)) / (m * m * m)
}

function _launch(c, P) {
	const f = P.orbit_factor
	if (f <= 0) return null
	return { factor: f, direction: P.direction === "clockwise" ? "cw" : "ccw" }
}

function _primary(c) {
	const p = c.link("primary")
	return F.py.truthy(p) ? `${p}/body` : null
}

// ---------------------------------------------------------------- the Sun, planets and moons
function build_body(c, P) {
	const item = c.item
	const key = body_key(item, P)
	const [name, kind, mass, radius_km, show, color] = BODIES[key]
	const [k, s, scale] = scene_scale(c)
	const given = item.props ?? {}
	const far = item.type === "sun" && P.pulls === false // a far-away Sun that only shines: no pull, parallel light (at infinity), held still
	// (true size at the scale, or the visible size; a far Sun is drawn at its visible size: it is not where it is drawn)
	if (!("diameter" in given)) P.diameter = far ? F.py.pyRound(show, 5) : F.py.pyRound(Math.max((2.0 * radius_km) / k, show), 5)
	const r = F.py.pyRound(P.diameter / 2.0, 5)
	const m = mass * P.mass_scale
	const vol = (4.0 / 3.0) * Math.PI * (r * r * r)
	const x = (m * ENGINE_KG) / vol
	const density = x >= 1 ? F.py.pyRound(x, 6) : Number(F.py.fmtG(x, 6))
	const look = kind === "star" ? "star" : kind === "moon" ? "moon rock" : "planet"
	const sid = c.ball("body", r, 0.0, 0.0, { material: c.mat({ base: "planet rock", density, overrides: {} }), look, words: name.replace("the ", ""), color, kind: far ? "static" : null, stand: "none" })
	const rec = { solid: sid, mu: far ? 0.0 : _mu(m, k, s), radius: r, radius_km, fixed: far || c.kind === "static", star: kind === "star", km_per_m: k, s_per_s: s, scale }
	if (far) rec.far = true
	if (item.type !== "sun") {
		const launch = _launch(c, P)
		if (launch !== null) rec.launch = launch
		rec.primary = _primary(c)
		if (kind === "moon") {
			rec.phase = true
			// its orbit's tilt and line of nodes (the eclipses), and how far its planet is from the Sun (a far Sun's distance), real km
			if (!("orbit_tilt" in given)) P.orbit_tilt = MOON_TILT[key] ?? 0.0
			rec.tilt = P.orbit_tilt
			rec.node = P.node_deg
			const pid = c.link("primary")
			const pit = pid !== null ? c.sb.scene_items.get(pid) : null
			const planet = pit !== null ? BODIES[body_key(pit, F.props_of(pit))] : BODIES[BODIES[key][6] || ""]
			if (planet !== undefined && planet[1] === "planet") {
				rec.sun_km = planet[7]
				// (the 3D view lifts the drawn Moon off the plane by its height above it times the factor its planet is drawn larger than true)
				if (pit !== null) {
					const PP = F.props_of(pit)
					const pk = body_key(pit, PP)
					const pd = "diameter" in (pit.props ?? {}) ? PP.diameter : Math.max((2.0 * BODIES[pk][3]) / k, BODIES[pk][4])
					P.lift_per_km = F.py.pyRound(pd / 2.0 / BODIES[pk][3], 9)
				}
			}
		}
		if (kind === "planet") {
			if (!("axis_tilt" in given)) P.axis_tilt = OBLIQUITY[key] ?? 0.0
			if (P.seasons === true) {
				rec.seasons = { tilt: P.axis_tilt, date: P.start_date, lat: P.town_lat }
				P.season_axis = _season_axis(c, P)
			}
		}
	}
	c.process("space-body", "gravity", rec)
	P.real_mass_kg = m
	P.s_per_s = s // (the scene's real seconds per scene second: the 3D view turns the globe at its real rate when that can be seen)
}

/** For the 3D view: the planet's north axis at the start (mod_space.py _season_axis). */
function _season_axis(c, P) {
	const suns = [...c.sb.scene_items.values()].filter((i) => i !== null && typeof i === "object" && !Array.isArray(i) && i.type === "sun" && i.id !== c.item.id)
	const sun = suns.find((i) => F.props_of(i).pulls !== false) ?? (suns.length ? suns[0] : null)
	if (sun === null) return null
	const dx = Number(sun.x ?? 0.0) - Number(c.item.x ?? 0.0)
	const dy = Number(sun.y ?? 0.0) - Number(c.item.y ?? 0.0)
	const d = Math.sqrt(dx * dx + dy * dy)
	if (!(d > 0)) return null
	const sx = dx / d
	const sy = dy / d
	const sense = P.direction === "clockwise" ? -1.0 : 1.0
	const date = P.start_date
	let bx
	let by
	if (date === "june solstice") [bx, by] = [sx, sy]
	else if (date === "december solstice") [bx, by] = [-sx, -sy]
	else {
		;[bx, by] = [-sy * sense, sx * sense]
		if (date === "september equinox") [bx, by] = [-bx, -by]
	}
	const e = P.axis_tilt * F.D2R
	return [F.py.pyRound(F.py.sin(e) * bx, 6) + 0.0, F.py.pyRound(F.py.sin(e) * by, 6) + 0.0, F.py.pyRound(F.py.cos(e) * sense, 6) + 0.0]
}

function _scale_props(default_scale = "auto") {
	const { Prop } = F
	return [
		new Prop("scale", "Scene scale", default_scale, {
			kind: "choice", choices: SCALE_CHOICES,
			help: "How big and how fast the scene is (set by its heaviest body): auto = the body's own (the Sun: 1 m = 1 au, 1 s = 40 days; " +
				"Earth: 1 m = 300,000 km, 1 s = 2 days; Jupiter: 1 m = 1 million km, 1 s = 12 h; Mars: 1 m = 20,000 km, 1 s = 2 h; " +
				"low-orbit: 1 m = 10,000 km, 1 s = 10 min); custom uses the two numbers below"
		}),
		new Prop("km_per_m", "Custom scale: km per metre", 300000.0, 100.0, 1e10, 100.0, "km", "Used when the scale is custom"),
		new Prop("hours_per_s", "Custom scale: hours per second", 48.0, 0.01, 100000.0, 0.01, "h", "Real hours that pass in each second of the run (custom scale)")
	]
}

function _launch_props(def) {
	const { Prop } = F
	return [
		new Prop("orbit_factor", "Launch speed", def, 0.0, 3.0, 0.01, "× orbit speed",
			"At the release it is sent sideways at this many times the speed of a circle round what it circles: 1 a circle, " +
			"under 1 it falls in (an ellipse that meets it), between 1 and 1.41 an ellipse, 1.41 (the square root of 2) or more it escapes; 0 = let go at rest"),
		new Prop("direction", "Goes round", "counter-clockwise", { kind: "choice", choices: DIRECTIONS, help: "As seen from the front" })
	]
}

function _readouts() {
	const { Readout } = F
	const base = [
		new Readout("distance", "Distance to what it circles", { unit: "m", digits: 3, help: "Centre to centre, in the scene" }),
		new Readout("distance_km", "Real distance", { unit: "km", digits: 0, help: "The same at the scene's scale" }),
		new Readout("speed", "Speed round it", { unit: "m/s", digits: 3, help: "Relative to what it circles, in the scene" }),
		new Readout("speed_kms", "Real speed", { unit: "km/s", digits: 2, help: "The same at the scene's scale" }),
		new Readout("turns", "Orbits completed", { unit: "", digits: 2, help: "Turns round what it circles, in its own direction" }),
		new Readout("fell", "Fell in", { unit: "", digits: 0, help: "1 once it has hit what it circles" }),
		new Readout("escaped", "Escaping", { unit: "", digits: 0, help: "1 while it moves away faster than escape speed" })
	]
	const phase = [
		new Readout("lit", "Lit fraction seen from its planet", { unit: "", digits: 3, help: "(1 + cos i)/2, i the Sun-moon-planet angle (Meeus ch. 48)" }),
		new Readout("elongation", "Angle from the Sun", { unit: "°", digits: 1, help: "Seen from its planet, counter-clockwise from the Sun: 0 new, 90 first quarter, 180 full, 270 last quarter" }),
		new Readout("height_km", "Height above its planet's orbit plane", { unit: "km", digits: 0, help: "Its tilted orbit takes it above (+) and below (-) the plane its planet circles the Sun in" }),
		new Readout("latitude", "Angle above that plane", { unit: "°", digits: 2, help: "Seen from its planet (the Moon: up to 5.1)" }),
		new Readout("lunar_eclipse", "Lunar eclipse", { unit: "", digits: 0, help: "Its planet's shadow on it: 0 none, 1 penumbral, 2 partial, 3 total (real sizes and distances)" }),
		new Readout("solar_eclipse", "Solar eclipse", { unit: "", digits: 0, help: "Its shadow on its planet: 0 none, 1 partial, 2 annular, 3 total (real sizes and distances)" })
	]
	return [base, phase]
}

function _season_props() {
	const { Prop } = F
	return [
		new Prop("seasons", "Seasons", false, {
			kind: "bool",
			help: "Read the seasons as it goes round its Sun: its axis tilted (below) and kept pointing one way in space, the Sun's noon height and the " +
				"day's length at a town (needs a sun in the scene)"
		}),
		new Prop("axis_tilt", "Axis tilt", 23.44, 0.0, 180.0, 0.01, "°", "From its orbit's pole: automatic = its real one (Earth 23.44, Mars 25.19, Uranus 97.77)", { auto: ["body"] }),
		new Prop("start_date", "Date at the start", "march equinox", { kind: "choice", choices: DATES, help: "Where it is in its year at the start (for its northern half): which way its pole leans from the Sun then" }),
		new Prop("town_lat", "Town's latitude", 30.27, -90.0, 90.0, 0.01, "°", "Where the seasons are read: + north (Austin 30.27, London 51.5), - south")
	]
}

function _season_readouts() {
	const { Readout } = F
	return [
		new Readout("sun_lat", "Latitude the Sun is overhead", { unit: "°", digits: 2, help: "+ north of the equator (+23.44 at Earth's June solstice), - south" }),
		new Readout("noon_elevation", "Noon Sun's height at the town", { unit: "°", digits: 2, help: "90 - |latitude - where the Sun is overhead| (Meeus)" }),
		new Readout("day_length_h", "Day length at the town", { unit: "h", digits: 2, help: "Sunrise to sunset (cos H0 = -tan(lat) tan(dec))" }),
		new Readout("night_lon", "Midnight sky's ecliptic longitude", { unit: "°", digits: 1, help: "Opposite the Sun: the constellation on the ecliptic highest at midnight (90: Gemini, with Orion near; 270: Sagittarius)" })
	]
}

function _bodies() {
	const { register, ItemType, Prop, Link } = F
	const [READOUTS, PHASE_READOUTS] = _readouts()
	const common_tags = ["space", "orbit", "gravity", "solar system", "astronomy"]
	register(new ItemType("sun", "Sun", CAT, build_body, {
		module: "space",
		props: [
			new Prop("diameter", "Drawn diameter", 0.3, 0.005, 3.0, 0.001, "m",
				"Its size in the scene (it collides at this size): automatic = its true size at the scale, or 30 cm where that is too small to see",
				{ auto: ["scale", "km_per_m"] }),
			new Prop("mass_scale", "Mass", 1.0, 0.01, 100.0, 0.01, "× real", "Times the Sun's real mass (1.99e30 kg): heavier pulls harder"),
			new Prop("pulls", "Pulls (gravity)", true, {
				kind: "bool",
				help: "Off: a far-away Sun that only lights the scene, its light parallel (for the Moon's phases beside an Earth and Moon: the real Sun " +
					"is 390 times farther away than the Moon, so its pull here would tear them apart)"
			})
		].concat(_scale_props()),
		readouts: [],
		tags: common_tags.concat(["star", "solar", "sunlight"]),
		description: "The Sun in an orbit scene (seen from above the plane of the orbits): it pulls everything with its real gravity at the scene's scale " +
			"and lights the planets and moons (their phases). A scene with a space body is in space: no uniform gravity, no air.",
		source: "Mass 1.9885e30 kg, radius 695,700 km [NASA-PFS, IAU 2015 B3]; mu = G*M (G 6.67430e-11, CODATA 2018) at the scene's scale.",
		anchor: "its centre", facts: "1.99e30 kg · 1 m = 1 au, 1 s = 40 days"
	}))
	register(new ItemType("planet", "Planet", CAT, build_body, {
		module: "space",
		props: [
			new Prop("body", "Planet", "earth", { kind: "choice", choices: PLANETS, help: "Its real mass, size and colours" }),
			new Prop("diameter", "Drawn diameter", 0.11, 0.005, 3.0, 0.001, "m",
				"Its size in the scene (it collides at this size): automatic = its true size at the scene's scale, or a visible size where that is too small",
				{ auto: ["body", "scale", "km_per_m"] }),
			new Prop("mass_scale", "Mass", 1.0, 0.01, 100.0, 0.01, "× real", "Times the planet's real mass: heavier pulls harder (its moons circle faster)")
		].concat(_launch_props(1.0), _scale_props(), _season_props()),
		links: [new Link("primary", "Circles", { types: ["sun", "planet"], help: "What it is launched round (none: the body that dominates it, the Sun)" })],
		readouts: READOUTS.concat(_season_readouts()),
		tags: common_tags.concat(["earth", "mars", "jupiter", "saturn", "venus", "mercury", "neptune", "uranus", "pluto", "world", "globe", "seasons",
			"axis", "tilt", "axial tilt", "solstice", "equinox", "year"]),
		description: "A planet with its real mass (Earth, Mars, Jupiter ...): it pulls with its real gravity at the scene's scale and, at the release, is " +
			"launched round what it circles (the Sun) at its Launch speed (1 = a circle). Moons and satellites circle it. With Seasons on, its " +
			"tilted axis keeps pointing one way all round its orbit: the noon Sun at a town climbs to the June solstice and sinks to December's.",
		source: "Masses, radii, distances, periods and axial tilts (Earth 23.44°): NASA NSSDCA planetary fact sheets [NASA-PFS]; mu = G*M [CODATA18]; " +
			"noon height 90° − |φ − δ|, sin δ = sin ε cos(angle from the solstice) (Meeus).",
		anchor: "its centre", facts: "Earth 5.97e24 kg · launched at 1× orbit speed"
	}))
	register(new ItemType("moon", "Moon", CAT, build_body, {
		module: "space",
		props: [
			new Prop("body", "Moon", "moon", { kind: "choice", choices: MOONS, help: "Earth's Moon, or a moon of Jupiter, Saturn or Mars" }),
			new Prop("diameter", "Drawn diameter", 0.03, 0.005, 3.0, 0.001, "m",
				"Its size in the scene: automatic = its true size at the scene's scale, or a visible size where that is too small",
				{ auto: ["body", "scale", "km_per_m"] }),
			new Prop("mass_scale", "Mass", 1.0, 0.01, 100.0, 0.01, "× real", "Times its real mass"),
			new Prop("orbit_tilt", "Orbit tilt", 5.145, 0.0, 90.0, 0.01, "°",
				"Its orbit's tilt to its planet's orbit round the Sun: automatic = the real one (the Moon 5.145): it passes above or below the " +
				"Sun's line at most new and full moons, so eclipses come only near the nodes; 0 = an eclipse every new and full moon", { auto: ["body"] }),
			new Prop("node_deg", "Nodes from the Sun", 90.0, 0.0, 360.0, 1.0, "°",
				"Where its tilted orbit crosses its planet's (the ascending node), counted from the Sun's direction at the start the way it goes " +
				"round: 0 or 180 = eclipses at this new and full moon; 90 = high at full, low at new: no eclipses (most months)")
		].concat(_launch_props(1.0), _scale_props()),
		links: [new Link("primary", "Circles", { types: ["planet", "sun", "moon"], help: "What it is launched round (none: the body that dominates it)" })],
		readouts: READOUTS.concat(PHASE_READOUTS),
		tags: common_tags.concat(["moon", "lunar", "satellite", "phases", "io", "europa", "ganymede", "callisto", "titan", "phobos", "deimos", "eclipse",
			"solar eclipse", "lunar eclipse", "nodes", "tilted orbit"]),
		description: "A moon with its real mass (Earth's Moon, Io, Titan ...): at the release it is launched round its planet at its Launch speed " +
			"(1 = a circle). With a Sun in the scene its phase as its planet sees it is read every moment (new, first quarter, full ...), and " +
			"its eclipses: its orbit is tilted (the Moon's 5.145°), so its shadow (a solar eclipse) or its planet's (a lunar one) falls only " +
			"near the nodes, where the tilted orbit crosses the planet's.",
		source: "Moon 7.346e22 kg, 1737.4 km, 384,400 km, 27.32 d, orbit tilted 5.145° to the ecliptic; Jovian, Saturnian and Martian satellite fact " +
			"sheets [NASA-PFS]; phase (1 + cos i)/2 [MEEUS ch. 48]; eclipses from the real Sun's, planet's and moon's sizes (shadow cones).",
		anchor: "its centre", facts: "7.35e22 kg · circles the Earth in 27.3 days"
	}))
}

// ---------------------------------------------------------------- satellites (test bodies: they pull nothing)
function build_craft(c, P) {
	let [name, w, h, d, mass, look] = CRAFT[P.kind]
	const size = P.size
	let sid
	if (w === null) {
		// a cannonball: an iron ball `size` across, weighing what iron that size weighs
		const r = F.py.pyRound(size / 2.0, 5)
		sid = c.ball("body", r, 0.0, 0.0, { material: c.mat({ base: "cast iron", overrides: {} }), look, words: name, stand: "none" })
		mass = F.MATERIALS["cast iron"].density * (4.0 / 3.0) * Math.PI * (r * r * r)
	} else {
		const f = size / w
		const ww = F.py.pyRound(w * f, 5)
		const hh = F.py.pyRound(h * f, 5)
		const dd = F.py.pyRound(d * f, 5)
		const x = mass / (ww * hh * dd)
		sid = c.slab("body", ww, hh, dd, 0.0, 0.0, { material: c.mat({ base: "spacecraft aluminium", density: F.py.pyRound(x, 4), overrides: {} }), look, words: name, stand: "none" })
	}
	const rec = { solid: sid, mu: 0.0, radius: 0.0, radius_km: 0.0, fixed: c.kind === "static", star: false }
	const launch = _launch(c, P)
	if (launch !== null) rec.launch = launch
	rec.primary = _primary(c)
	const [k, s, scale] = scene_scale(c)
	rec.km_per_m = k
	rec.s_per_s = s
	rec.scale = scale
	c.process("space-body", "gravity", rec)
	P.model_mass_kg = F.py.pyRound(mass, 6)
}

function _craft() {
	const { register, ItemType, Prop, Link, Readout } = F
	const [READOUTS] = _readouts()
	register(new ItemType("satellite", "Satellite", CAT, build_craft, {
		module: "space",
		props: [
			new Prop("kind", "Kind", "satellite", { kind: "choice", choices: Object.keys(CRAFT), help: "Only the look (and the model's weight, which changes nothing of its orbit): a satellite, a space station, Newton's cannonball, a probe" }),
			new Prop("size", "Size", 0.09, 0.01, 0.5, 0.005, "m", "Its width in the scene (drawn far larger than true: the ISS is 109 m across)")
		].concat(_launch_props(1.0)),
		links: [new Link("primary", "Circles", { types: ["planet", "moon", "sun"], help: "What it is launched round (none: the body that dominates it)" })],
		readouts: READOUTS.slice(0, 2).concat([new Readout("altitude_km", "Real height above the surface", { unit: "km", digits: 0, help: "Distance less the real radius of what it circles" })], READOUTS.slice(2)),
		tags: ["space", "orbit", "satellite", "iss", "space station", "spacecraft", "newton's cannon", "cannonball", "probe", "rocket", "launch", "escape"],
		description: "A satellite (or a space station, a probe, Newton's cannonball) launched sideways at the release round a planet or moon at its " +
			"Launch speed: 1 = a circular orbit, slower falls in, 1.41 or more escapes. Its own weight does not change its orbit.",
		source: "Circular speed sqrt(G*M/r), escape speed sqrt(2*G*M/r) (Newton); the ISS: about 420 km up, 92.9 min, 7.66 km/s [ISS].",
		anchor: "its centre", facts: "launched at 1× orbit speed · pulls nothing"
	}))
}

// ---------------------------------------------------------------- a geologist's hammer (Apollo 15)
const HAMMER_SPLIT = 0.62 // the share of its weight in the steel head (Estwing E3-22P: about 0.62 of 1.0 kg; provisional)

function _hammer() {
	const { register, ItemType, Prop } = F
	register(new ItemType("rock-hammer", "Geologist's hammer", "Blocks & shapes", _hammer_build, {
		module: "space",
		props: [new Prop("mass", "Weight", 1.32, 0.3, 3.0, 0.01, "kg", "Apollo 15's hammer weighed 1.32 kg"), new Prop("length", "Length", 0.33, 0.2, 0.5, 0.01, "m")],
		tags: ["hammer", "apollo", "moon", "drop", "gravity", "vacuum", "feather", "falling", "galileo", "tool"],
		description: "A geologist's hammer lying on its side (its head upright at the right end). Dropped with a feather where there is no air " +
			"(the Moon), both land together, as David Scott showed on Apollo 15.",
		source: "1.32 kg geologic hammer [APOLLO15]; a rock hammer's head carries about 0.62 of its weight (provisional).",
		anchor: "the middle of its length, on the handle's axis", facts: "1.32 kg · 33 cm"
	}))
}

function _hammer_build(c, P) {
	const m = P.mass
	const L = P.length
	const hw = 0.03
	const hh = 0.17
	const hd = 0.028
	const th = 0.03
	const td = 0.025
	const lw = L - hw
	const head = c.mat({ base: "steel", density: F.py.pyRound((HAMMER_SPLIT * m) / (hw * hh * hd), 4), overrides: {} })
	const handle = c.mat({ base: "varnished hardwood", density: F.py.pyRound(((1 - HAMMER_SPLIT) * m) / (lw * th * td), 4), overrides: {} })
	const root = c.slab("handle", lw, th, td, -hw / 2.0, 0.0, { material: handle, look: "wood", words: "a hammer's handle" })
	const sid = c.slab("head", hw, hh, hd, (L - hw) / 2.0, 0.0, { material: head, look: "steel", words: "a hammer's steel head" })
	// (welded: its place in the handle's frame, as catalog_mechanisms.py's _child does)
	const s = c.sb.solids[c.sb.solids.length - 1]
	s.parent = root
	s.at = { x: F.py.pyRound(L / 2.0, 5), y: 0.0 }
	delete s.angle
	return sid
}

// ---------------------------------------------------------------- a shadow stick (gnomon): the Sun's height and the shadow through the day
const SEASONS = ["march equinox", "june solstice", "september equinox", "december solstice", "day of year"]
export const TILT_DEG = 23.44 // Earth's axial tilt (obliquity), degrees [NASA-PFS]

function build_gnomon(c, P) {
	const h = P.height
	const w = F.py.pyRound(Math.max(0.008, Math.min(0.04, h * 0.03)), 5)
	const sid = c.slab("stick", w, h, w, 0.0, h / 2.0, { material: c.mat({ base: "varnished hardwood", overrides: {} }), look: "wood", words: "a shadow stick" })
	c.process("sun-clock", "sun", { solid: sid, height: h, latitude: P.latitude, season: P.season, day: P.day_of_year, hour: P.hour, lapse: c.settings.time_lapse })
}

function _gnomon() {
	const { register, ItemType, Prop, Readout } = F
	register(new ItemType("gnomon", "Shadow stick (gnomon)", CAT, build_gnomon, {
		dynamic: false, module: "space",
		props: [
			new Prop("height", "Height", 1.0, 0.05, 3.0, 0.01, "m", "Of the stick (a flagpole in a model is a stick)"),
			new Prop("latitude", "Latitude", 30.27, -66.0, 66.0, 0.01, "°", "Where on Earth: + north (Austin 30.27, London 51.5, the equator 0), - south"),
			new Prop("season", "Date", "march equinox", { kind: "choice", choices: SEASONS, help: "The equinoxes: the Sun over the equator; the June solstice: the longest day in the north; or the day of the year below" }),
			new Prop("day_of_year", "Day of the year", 80, 1, 365, 1, "", "Used with Date = day of year (1 = 1 January)", { kind: "int" }),
			new Prop("hour", "Solar time at the start", 9.0, 0.0, 24.0, 0.25, "h",
				"Hours after midnight by the Sun (12 = solar noon, the Sun highest); it runs on at the scene's time-lapse (3600 = an hour a second)")
		],
		readouts: [
			new Readout("hour", "Solar time", { unit: "h", digits: 2, help: "Hours after midnight by the Sun" }),
			new Readout("sun_elevation", "Sun's height", { unit: "°", digits: 1, help: "Above the horizon (below 0: night)" }),
			new Readout("sun_azimuth", "Sun's bearing", { unit: "°", digits: 0, help: "From north, clockwise (90 east, 180 south, 270 west)" }),
			new Readout("shadow_m", "Shadow length", { unit: "m", digits: 3, help: "The stick's shadow on level ground (0 at night)" }),
			new Readout("shadow_dir", "Shadow points to", { unit: "°", digits: 0, help: "Its bearing from north, clockwise: away from the Sun" }),
			new Readout("day_length_h", "Day length", { unit: "h", digits: 2, help: "Sunrise to sunset that day" })
		],
		tags: ["shadow", "sun", "gnomon", "sundial", "flagpole", "stick", "day", "night", "seasons", "noon", "time of day", "latitude", "solstice", "equinox"],
		description: "A stick standing on level ground in the Sun: its shadow is long in the morning and evening, shortest at solar noon, and points away " +
			"from the Sun (west in the morning, east in the afternoon, north at noon north of the tropics). Set the place (latitude), the date and " +
			"the time; with the scene's time-lapse (3600: an hour a second) the shadow sweeps round through the day. The machine plane runs east-west.",
		source: "sin(elevation) = sin(lat)·sin(dec) + cos(lat)·cos(dec)·cos(H), H = 15°·(time − 12), dec = 23.44°·sin(360°·(284 + day)/365) " +
			"(Cooper 1969; 0 at the equinoxes, ±23.44° at the solstices) [MEEUS]; shadow = height / tan(elevation).",
		anchor: "the foot of the stick, on the ground", facts: "1 m stick · Austin, March equinox, 9:00"
	}))
}

// ---------------------------------------------------------------- the classroom Sun-Earth-Moon models: a globe under a lamp, a moon ball on a stick
// (mod_space.py has the same, number for number: what plays the Sun, how the globe and the ball are built, the build hook that finds the light)
export const LIGHT_TYPES = ["lamp", "flashlight", "sunlight", "sun"]
const LEANS = ["toward the camera", "away from the camera", "right", "left", "toward the light", "away from the light"]
const BULB_RADIUS = 0.03 // m: a 60 W A19 bulb is 60 mm across (ANSI C78.20)
const LENS_RADIUS = 0.012 // m: a 2 x AA flashlight's reflector

function build_globe(c, P) {
	const R = F.py.pyRound(P.diameter / 2.0, 5)
	const sh = P.stand_height
	const plastic = c.mat({ base: "ABS plastic", overrides: {} })
	c.slab("base", 0.2, 0.025, 0.2, 0.0, 0.0125, { material: plastic, look: "plastic", words: "a globe's round base", color: "#2b2b2e", stand: "none" })
	const post_h = F.py.pyRound(Math.max(0.005, sh - 0.025 + 0.01), 5)
	c.slab("post", 0.014, post_h, 0.014, 0.0, F.py.pyRound(0.025 + post_h / 2.0 - 0.005, 5), { material: plastic, look: "plastic", words: "a globe's post", stand: "none", hidden_3d: true })
	const sid = c.ball("ball", R, 0.0, F.py.pyRound(sh + R, 5), { material: c.mat({ base: "hollow plastic", overrides: {} }), look: "plastic", words: "a classroom globe", color: "#2f6fb5", stand: "none" })
	c.process("globe", "globe", { solid: sid, radius: R, tilt: P.tilt_deg, lean: P.lean, rpm: P.spin_rpm, hour: P.start_hour, lat: P.town_lat, light: null, lit_by: c.link("lit_by") })
	c.sb.processes[c.sb.processes.length - 1]._P = P // (the build hook _lights writes where the light is into the resolved props, for the 3D view, and drops this)
}

function _globe() {
	const { register, ItemType, Prop, Link, Readout } = F
	register(new ItemType("globe", "Classroom globe", CAT, build_globe, {
		dynamic: false, module: "space",
		props: [
			new Prop("diameter", "Diameter", 0.3, 0.1, 0.6, 0.01, "m", "A classroom globe is 30 cm (12 in) across"),
			new Prop("stand_height", "Stand height", 0.25, 0.03, 1.0, 0.01, "m", "From the table to the ball's bottom: 0.25 puts a 30 cm globe's middle 40 cm up, level with a desk lamp's bulb"),
			new Prop("tilt_deg", "Axis tilt", 23.44, 0.0, 90.0, 0.01, "°", "From the vertical: the Earth's is 23.44 (0: no seasons)"),
			new Prop("lean", "North pole leans", "toward the camera", {
				kind: "choice", choices: LEANS,
				help: "Which way its tilted axis points, kept so: toward the light = the June solstice (the north's summer), away = December's, " +
					"toward or away from the camera with the light to one side = an equinox"
			}),
			new Prop("spin_rpm", "Spin", 6.0, 0.0, 60.0, 0.1, "turns/min", "Turns a minute, west to east as the Earth (one turn is one day here: 6 = a day every 10 s)"),
			new Prop("start_hour", "Town's time at the start", 6.0, 0.0, 24.0, 0.25, "h", "Its solar time when the run starts (12 = noon, the light highest)"),
			new Prop("town_lat", "Town's latitude", 30.27, -90.0, 90.0, 0.01, "°", "Where the red pin is: + north (Austin 30.27, London 51.5, the equator 0), - south")
		],
		links: [new Link("lit_by", "Lit by", { types: [...LIGHT_TYPES], help: "The light that plays the Sun (none: the first lamp, flashlight, sunlight or sun in the scene)" })],
		readouts: [
			new Readout("day", "Day at the town", { unit: "", digits: 0, help: "1 while the light is above the town's horizon (and on), 0 at night" }),
			new Readout("local_time", "Town's solar time", { unit: "h", digits: 2, help: "From where the light is: 12 when it is highest" }),
			new Readout("sun_elevation", "Light's height at the town", { unit: "°", digits: 1, help: "Above its horizon (below 0: night)" }),
			new Readout("noon_elevation", "Noon height of the light", { unit: "°", digits: 1, help: "90 - |latitude - where the light is overhead| (Meeus)" }),
			new Readout("sun_lat", "Latitude the light is overhead", { unit: "°", digits: 2, help: "+ north: the axis leaning toward the light makes it +tilt (June)" }),
			new Readout("day_length_h", "Day length at the town", { unit: "h", digits: 2, help: "Hours of light in one turn (cos H0 = -tan(lat) tan(dec))" }),
			new Readout("turns", "Turns", { unit: "", digits: 2, help: "Since the start (one turn = one day)" })
		],
		tags: ["globe", "earth", "day", "night", "day and night", "spin", "rotation", "rotate", "turns", "axis", "tilt", "seasons", "sunrise", "sunset",
			"time zones", "model", "sun-earth-moon", "lamp", "classroom globe", "terminator", "hemisphere"],
		description: "A 30 cm classroom globe on its stand, its axis tilted 23.44° (kept pointing one way), turning west to east, a red pin at a town. " +
			"A lamp (or flashlight, or sunlight) plays the Sun: the half facing it is day, the other half night; the town passes from night to " +
			"day once a turn. With its pole leaning toward the light it is the north's summer (the noon light high, long days), away from it winter.",
		source: "Earth's axial tilt 23.44° [NASA-PFS]; the light's height sin e = n·(L − P)/|L − P| at the town (P), its noon height 90° − |φ − δ| and " +
			"day length cos H0 = −tan φ tan δ (Meeus, Astronomical Algorithms ch. 13, 15).",
		anchor: "the middle of its base, on the table", facts: "Ø 30 cm · tilted 23.44° · 6 turns a minute"
	}))
}

function build_moon_ball(c, P) {
	const r = F.py.pyRound(P.diameter / 2.0, 5)
	const sid = c.ball("ball", r, 0.0, 0.0, { material: c.mat({ base: "craft foam", overrides: {} }), look: "foam", words: "a white foam ball on a stick", color: "#f2f0ea", kind: "static", ghost: true, stand: "none", optics: { role: "clear" } })
	const g = c.link("around")
	c.process("moon-ball", "carry", { solid: sid, ball: r, radius: P.radius, period: P.period_s, start: P.start_deg, tilt: P.tilt_deg, node: P.node_deg, around: F.py.truthy(g) ? `${g}/ball` : null, light: null, lit_by: c.link("lit_by") })
	c.sb.processes[c.sb.processes.length - 1]._P = P
}

function _moon_ball() {
	const { register, ItemType, Prop, Link, Readout } = F
	register(new ItemType("moon-ball", "Moon ball on a stick", CAT, build_moon_ball, {
		dynamic: false, module: "space",
		props: [
			new Prop("diameter", "Ball diameter", 0.075, 0.02, 0.2, 0.005, "m", "A white craft-foam ball (polystyrene), 7.5 cm (3 in)"),
			new Prop("radius", "Carried this far out", 0.6, 0.1, 2.0, 0.01, "m", "From the globe's middle (or the viewer's eye) to the ball"),
			new Prop("period_s", "Time for one trip round", 12.0, 0.0, 120.0, 0.5, "s", "Seconds to carry it once round (one month of the model; 0 = held still)"),
			new Prop("start_deg", "Starts at", 0.0, 0.0, 360.0, 1.0, "°",
				"How far round from the light's side at the start, counter-clockwise seen from above: 0 between the light and the globe (new moon), " +
				"90 first quarter, 180 behind the globe (full), 270 last quarter"),
			new Prop("tilt_deg", "Circle tilt", 30.0, 0.0, 60.0, 1.0, "°",
				"How tilted the circle is carried: a near lamp and a big globe cast a wide shadow, so at 30° the ball passes above it at full " +
				"moon and its own shadow misses the globe at new moon; 0 = level: an eclipse every full and new moon"),
			new Prop("node_deg", "Tilt's low and high points", 90.0, 0.0, 360.0, 1.0, "°",
				"Where the tilted circle crosses the level one (its ascending node), from the light's side: 90 = highest at full, lowest at new " +
				"(no eclipses); 0 or 180 = level at new and full (eclipses)")
		],
		links: [
			new Link("around", "Carried round", { types: ["globe"], help: "The globe it goes round (none: round the item's own place, a viewer's eye)" }),
			new Link("lit_by", "Lit by", { types: [...LIGHT_TYPES], help: "The light that plays the Sun (none: the first lamp, flashlight, sunlight or sun in the scene)" })
		],
		readouts: [
			new Readout("elongation", "Angle from the light", { unit: "°", digits: 1, help: "Seen from the middle it goes round: 0 new, 90 first quarter, 180 full, 270 last quarter" }),
			new Readout("lit", "Lit fraction seen from the middle", { unit: "", digits: 3, help: "(1 + cos i)/2, i the light-ball-middle angle (Meeus ch. 48)" }),
			new Readout("height", "Height above the middle", { unit: "m", digits: 3, help: "Its tilted circle takes it above and below" }),
			new Readout("lunar_eclipse", "In the globe's shadow", { unit: "", digits: 0, help: "0 none, 1 penumbral, 2 partial, 3 total (a lunar eclipse)" }),
			new Readout("solar_eclipse", "Its shadow on the globe", { unit: "", digits: 0, help: "0 none, 1 partial, 2 annular, 3 total (a solar eclipse)" })
		],
		tags: ["moon", "moon ball", "phases", "moon phases", "ball on a stick", "foam ball", "styrofoam", "eclipse", "lunar eclipse", "solar eclipse",
			"new moon", "full moon", "quarter moon", "crescent", "gibbous", "model", "sun-earth-moon"],
		description: "A white foam ball on a stick carried round a globe (or round a viewer's eye) under a lamp, as the Moon goes round the Earth: " +
			"seen from the middle it shows its phases in order (new, crescent, first quarter, gibbous, full ...). Carried level, it is eclipsed at " +
			"full and shades the globe at new; carried on a tilted circle (as the real Moon's is tilted 5°) it misses the shadows most of the time.",
		source: "Phase: lit fraction (1 + cos i)/2 (Meeus, Astronomical Algorithms ch. 48); shadows: umbra and penumbra cones of the lamp's bulb " +
			"(60 mm across) and the balls (similar triangles); the real Moon's orbit is tilted 5.145° [NASA lunar fact sheet].",
		anchor: "the middle of the circle it is carried round (a globe's middle when it goes round one)", facts: "Ø 7.5 cm · 0.6 m out · 12 s a trip"
	}))
}

/** Where the light of item iid is, for the engine (mod_space.py _light_of): a point on a solid, parallel sunlight, or a far Sun; null if none. */
function _light_of(sb, iid) {
	const it = sb.scene_items.has(iid) ? sb.scene_items.get(iid) : null
	const t = it !== null && typeof it === "object" && !Array.isArray(it) ? it.type : null
	if (t === "lamp") {
		const rec = sb.processes.find((r) => r.kind === "heat" && r.item === iid && r.role === "lamp") ?? null
		if (rec === null) return null
		return { kind: "point", solid: rec.solid, x: rec.at.x, y: rec.at.y, frame: "world", radius: BULB_RADIUS, from: rec.from ?? 0.0 }
	}
	if (t === "flashlight" || t === "sunlight") {
		// (the optics module's build hook, which runs before this one, has gathered its source into its record; without it, it is on the solid)
		const optics = sb.processes.find((r) => r.kind === "optics") ?? null
		let src = (optics?.sources ?? []).find((x) => x !== null && typeof x === "object" && !Array.isArray(x) && x.item === iid && (x.kind === "flashlight" || x.kind === "sun")) ?? null
		if (src === null) {
			const x = sb.solids.find((q) => q.item === iid && q.light !== null && typeof q.light === "object" && !Array.isArray(q.light))
			src = x === undefined ? null : x.light
		}
		if (src === null) return null
		const on = src.on === false ? 1e9 : src.on_at ?? 0.0
		if (t === "sunlight") return { kind: "parallel", dir: src.dir, from: on }
		return { kind: "point", solid: src.solid, x: src.x, y: src.y, frame: "solid", radius: LENS_RADIUS, from: on }
	}
	if (t === "sun") {
		const rec = sb.processes.find((r) => r.kind === "space-body" && r.item === iid) ?? null
		if (rec === null) return null
		if (rec.far === true) return { kind: "far", solid: rec.solid, from: 0.0 }
		return { kind: "point", solid: rec.solid, x: 0.0, y: 0.0, frame: "world", radius: rec.radius, from: 0.0 }
	}
	return null
}

function _lights(sb, scene) {
	const recs = sb.processes.filter((r) => r.kind === "globe" || r.kind === "moon-ball")
	if (!recs.length) return
	let first = null
	for (const [iid, it] of sb.scene_items) {
		if (it !== null && typeof it === "object" && !Array.isArray(it) && LIGHT_TYPES.includes(it.type) && it.type in F.TYPES) {
			first = _light_of(sb, iid)
			if (first !== null) break
		}
	}
	const at = new Map(sb.solids.map((x) => [x.id, x]))
	for (const r of recs) {
		const want = r.lit_by ?? null
		delete r.lit_by
		const P = r._P ?? null
		delete r._P
		const light = want !== null ? _light_of(sb, want) : null
		r.light = light !== null ? light : first
		if (P === null) continue
		// for the 3D view (resolved props): where the circle's centre is, and the light at the start
		const own = at.get(r.solid)
		const cs = F.py.truthy(r.around) ? at.get(r.around) : own
		const c = cs !== undefined ? { ...cs.at } : { x: 0.0, y: 0.0 }
		const lv = _light_view(r.light, at, c)
		if (r.kind === "moon-ball") {
			P.centre = { x: c.x, y: c.y }
			r.centre = { x: c.x, y: c.y }
			// (its ghost solid where the hand has it at the start, in the machine plane: there it is picked and dragged, not inside the globe)
			if (own !== undefined) own.at = _ball_start(r, lv, c)
		}
		P.light = lv
	}
}

/** Where a moon ball starts, seen in the machine plane (mod_space.py _ball_start). */
function _ball_start(r, lv, c) {
	const hx = lv === null ? -1.0 : lv.parallel ? (lv.dx > 0 ? 1.0 : -1.0) : lv.x > c.x ? 1.0 : -1.0
	const a = (r.start - r.node) * F.D2R
	const o = r.node * F.D2R
	const t = r.tilt * F.D2R
	const R = r.radius
	return { x: F.py.pyRound(c.x + R * hx * (F.py.cos(a) * F.py.cos(o) - F.py.sin(a) * F.py.cos(t) * F.py.sin(o)), 5), y: F.py.pyRound(c.y + R * F.py.sin(a) * F.py.sin(t), 5) }
}

/** The light of a record where the 3D view draws it at the start (mod_space.py _light_view). */
function _light_view(L, at, c) {
	if (L === null) return null
	if (L.kind === "parallel") return { dx: F.py.pyRound(-F.py.cos(L.dir), 6), dy: F.py.pyRound(-F.py.sin(L.dir), 6), parallel: true }
	const s = at.get(L.solid)
	if (s === undefined) return null
	if (L.kind === "far") {
		const dx = s.at.x - c.x
		const dy = s.at.y - c.y
		const d = Math.sqrt(dx * dx + dy * dy)
		return d > 0 ? { dx: F.py.pyRound(dx / d, 6), dy: F.py.pyRound(dy / d, 6), parallel: true } : null
	}
	let x = L.x
	let y = L.y
	if (L.frame === "solid" && F.py.truthy(s.angle)) {
		const a = s.angle
		;[x, y] = [x * F.py.cos(a) - y * F.py.sin(a), x * F.py.sin(a) + y * F.py.cos(a)]
	}
	return { x: F.py.pyRound(s.at.x + x, 5), y: F.py.pyRound(s.at.y + y, 5) }
}

// ---------------------------------------------------------------- orbit mode (the build hook)
function _orbit_mode(sb, scene) {
	if ((scene.items ?? []).some((i) => i !== null && typeof i === "object" && !Array.isArray(i) && SPACE_TYPES.includes(i.type) && i.type in F.TYPES)) {
		sb.settings.gravity = 0.0
		sb.settings.air = false
	}
}

/** A space scene's ordinary moving things float and drift toward the heaviest body: one warning each (mod_space.py _space_warnings). */
function _space_warnings(scene, doc) {
	const items = (scene.items ?? []).filter((i) => i !== null && typeof i === "object" && !Array.isArray(i))
	if (!items.some((i) => SPACE_TYPES.includes(i.type) && i.type in F.TYPES)) return []
	const byId = new Map()
	for (const i of items) if (typeof i.id === "string") byId.set(i.id, i)
	const h = heaviest(byId)
	const toward = h === null ? null : F.py.truthy(h[0].name) ? h[0].name : BODIES[body_key(h[0], h[1])][0]
	const out = []
	const seen = new Set()
	for (const sd of doc.solids ?? []) {
		const iid = sd.item
		const it = byId.get(iid)
		if (sd.kind !== "dynamic" || sd.ghost === true || it === undefined || seen.has(iid) || SPACE_TYPES.includes(it.type) || !(it.type in F.TYPES)) continue
		seen.add(iid)
		const name = F.py.truthy(it.name) ? it.name : F.TYPES[it.type].name
		const fall = F.py.truthy(toward) ? `floats and drifts toward ${toward}` : "floats where it is let go"
		out.push({ items: [iid], text: `no gravity in a space scene: ${name} ${fall} (a sun, planet, moon or satellite puts the scene in space; for a drop on a world, set the place's gravity without them)` })
	}
	return out
}

// ---------------------------------------------------------------- goal kinds (machines/mod_space.py has the same, number for number)
export const PHASE_NAMES = ["new moon", "waxing crescent", "first quarter", "waxing gibbous", "full moon", "waning gibbous", "last quarter", "waning crescent"]
const PHASE_ALIASES = {
	new: "new moon", full: "full moon", "third quarter": "last quarter", last: "last quarter", first: "first quarter",
	half: "first quarter", quarter: "first quarter", crescent: "waxing crescent", gibbous: "waxing gibbous"
}
const PHASE_EDGES = [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5]

/** The phase for an elongation (degrees): eight 45-degree bins centred on new (0), first quarter (90), full (180), last quarter (270). */
export function phase_name(elongation) {
	let e = elongation % 360.0
	if (e < 0) e += 360.0
	let k = 0
	for (const edge of PHASE_EDGES) if (e >= edge) k += 1
	return PHASE_NAMES[k % 8]
}

export function phase_of(text) {
	const t = F.py.pyLower(String(text ?? "").trim()).replaceAll("-", " ").split(/\s+/).filter(Boolean).join(" ")
	return PHASE_NAMES.includes(t) ? t : (Object.hasOwn(PHASE_ALIASES, t) ? PHASE_ALIASES[t] : null)
}

const _record = (ctx, iid) => (ctx.doc.processes ?? []).find((r) => r.kind === "space-body" && r.item === iid) ?? null

function _primary_item(ctx, iid) {
	const r = _record(ctx, iid)
	const p = r?.primary
	return typeof p === "string" ? p.split("/")[0] : null
}

function _first_landing(ctx, iid, other = null) {
	const mine = new Set(ctx.solids(iid).map((s) => s.id))
	const item_of = new Map(ctx.doc.solids.map((s) => [s.id, s.item]))
	for (const h of ctx.track.impacts ?? []) {
		let o
		if (mine.has(h.a) && !mine.has(h.b)) o = item_of.get(h.b)
		else if (mine.has(h.b) && !mine.has(h.a)) o = item_of.get(h.a)
		else continue
		if (other !== null && o === other) continue
		return h.t
	}
	return null
}

/** What a goal's label calls an item: its own name, else a space body's real name (Earth, the Moon), else its type's name. */
function _nm(ctx, iid) {
	const it = typeof iid === "string" && ctx.items.has(iid) ? ctx.items.get(iid) : null
	if (it !== null && !F.py.truthy(it.name) && it.type === "gnomon") return "the shadow stick"
	if (it !== null && !F.py.truthy(it.name) && (it.type === "globe" || it.type === "moon-ball")) return it.type === "globe" ? "the globe" : "the moon ball"
	if (it !== null && !F.py.truthy(it.name) && BODY_TYPES.includes(it.type)) {
		const b = BODIES[body_key(it, F.props_of(it))]
		if (b !== undefined) return b[0]
	}
	return ctx.name(iid)
}
const _fmt_s = (t) => F.py.fmtF(t, 2).replace(/0+$/, "").replace(/\.$/, "")
/** A made label starts with a capital ("The Moon circles Earth once"). */
const _cap = (t) => (t.startsWith("the ") ? "T" + t.slice(1) : t)
const _label = (g, made) => (F.py.truthy(g.label) ? g.label : _cap(made))

function goal_orbits(ctx, g) {
	if (!ctx.known(g.item)) return null
	const iid = g.item
	let want = ctx.num(g.turns)
	want = want === null || want <= 0 ? 1.0 : want
	const around = ctx.known(g.around) ? g.around : null
	const prim = _primary_item(ctx, iid)
	const turns = ctx.state(iid, "turns")
	const fell = ctx.state(iid, "fell")
	const done = turns && turns.length ? Math.max(...turns) : 0.0
	const ok = !!(turns && turns.length) && done >= want - 1e-9 && !(fell && fell.length && Math.max(...fell) >= 1) && (around === null || prim === null || around === prim)
	const who = around || prim ? _nm(ctx, around || prim) : "what it circles"
	const n = F.py.fmtG(want, 6)
	const label = _label(g, `${_nm(ctx, iid)} circles ${who} ${want === 1 ? "once" : `${n} times`}`)
	return { label, ok, kind: "orbits", item: iid, turns: F.py.pyRound(done, 3) }
}

function goal_falls_in(ctx, g) {
	if (!ctx.known(g.item)) return null
	const iid = g.item
	const prim = _primary_item(ctx, iid)
	const into = ctx.known(g.into) ? g.into : prim
	// (falling in on an orbit grazes the surface, too slowly for an impact: the engine's `fell` reading says when it touched its primary)
	let t = into !== null && into === prim ? ctx.first_time(iid, "fell", (v) => v >= 1) : null
	if (t === null && into !== null) {
		const mine = new Set(ctx.solids(iid).map((s) => s.id))
		const theirs = new Set(ctx.solids(into).map((s) => s.id))
		for (const h of ctx.track.impacts ?? []) {
			if ((mine.has(h.a) && theirs.has(h.b)) || (mine.has(h.b) && theirs.has(h.a))) {
				t = h.t
				break
			}
		}
	}
	const label = _label(g, `${_nm(ctx, iid)} falls onto ${into ? _nm(ctx, into) : "what it circles"}`)
	return { label, ok: t !== null, kind: "falls_in", item: iid, t: t === null ? null : F.py.pyRound(t, 3) }
}

function goal_escapes(ctx, g) {
	if (!ctx.known(g.item)) return null
	const iid = g.item
	const esc = ctx.state(iid, "escaped")
	const ok = !!(esc && esc.length) && esc[esc.length - 1] >= 1
	return { label: _label(g, `${_nm(ctx, iid)} escapes`), ok, kind: "escapes", item: iid }
}

function goal_lands_together(ctx, g) {
	if (!(ctx.known(g.a) && ctx.known(g.b))) return null
	const a = g.a
	const b = g.b
	let tol = ctx.num(g.tol_s)
	tol = tol === null || tol < 0 ? 0.02 : tol
	const ta = _first_landing(ctx, a, b)
	const tb = _first_landing(ctx, b, a)
	const ok = ta !== null && tb !== null && Math.abs(ta - tb) <= tol + 1e-9
	return {
		label: _label(g, `${_nm(ctx, a)} and ${_nm(ctx, b)} land together`), ok, kind: "lands_together", a, b, item: a,
		ta: ta === null ? null : F.py.pyRound(ta, 3), tb: tb === null ? null : F.py.pyRound(tb, 3)
	}
}

function goal_lands_first(ctx, g) {
	if (!(ctx.known(g.a) && ctx.known(g.b))) return null
	const a = g.a
	const b = g.b
	const ta = _first_landing(ctx, a, b)
	const tb = _first_landing(ctx, b, a)
	const ok = ta !== null && (tb === null || tb - ta >= 0.02)
	return {
		label: _label(g, `${_nm(ctx, a)} lands before ${_nm(ctx, b)}`), ok, kind: "lands_first", a, b, item: a,
		ta: ta === null ? null : F.py.pyRound(ta, 3), tb: tb === null ? null : F.py.pyRound(tb, 3)
	}
}

function goal_phase(ctx, g) {
	if (!ctx.known(g.item)) return null
	const iid = g.item
	const want = phase_of(g.name ?? "")
	const el = ctx.state(iid, "elongation")
	let seen
	let ok
	if (want === null || !(el && el.length)) {
		seen = null
		ok = false
	} else {
		const at = ctx.num(g.at_s)
		if (g.any === true) {
			ok = el.some((v) => phase_name(v) === want)
			seen = ok ? want : phase_name(el[el.length - 1])
		} else {
			let k = el.length - 1
			if (at !== null && ctx.times.length) {
				k = 0
				for (let j = 1; j < el.length; j++) if (Math.abs(ctx.times[j] - at) < Math.abs(ctx.times[k] - at)) k = j
			}
			seen = phase_name(el[k])
			ok = seen === want
		}
	}
	const at_s = ctx.num(g.at_s)
	const when = at_s === null ? "" : ` at ${_fmt_s(at_s)} s`
	const what = want || String(F.py.truthy(g.name) ? g.name : "a phase")
	const label = _label(g, g.any === true ? `${_nm(ctx, iid)} shows a ${what} at some moment` : `${_nm(ctx, iid)} shows a ${what}${when || " at the end"}`)
	return { label, ok, kind: "phase", item: iid, seen }
}

function goal_shadow_length(ctx, g) {
	if (!ctx.known(g.item)) return null
	const iid = g.item
	const want = ctx.num(g.m)
	let tol = ctx.num(g.tol)
	tol = tol === null || tol < 0 ? 0.02 : tol
	const sh = ctx.state(iid, "shadow_m")
	let seen = null
	if (want !== null && sh && sh.length) {
		const at = ctx.num(g.at_s)
		let k = sh.length - 1
		if (at !== null && ctx.times.length) {
			k = 0
			for (let j = 1; j < sh.length; j++) if (Math.abs(ctx.times[j] - at) < Math.abs(ctx.times[k] - at)) k = j
		}
		seen = sh[k]
	}
	const ok = seen !== null && Math.abs(seen - want) <= tol + 1e-9
	const at_s = ctx.num(g.at_s)
	const when = at_s === null ? "" : ` at ${_fmt_s(at_s)} s`
	const label = _label(g, `${_nm(ctx, iid)}'s shadow is ${want !== null ? _fmt_s(want) : "?"} m long${when || " at the end"}`)
	return { label, ok, kind: "shadow_length", item: iid, seen: seen === null ? null : F.py.pyRound(seen, 3) }
}

/** The frame nearest to at_s (the last frame without one): the first of equals. */
function _nearest(ctx, n, at) {
	let k = n - 1
	if (at !== null && ctx.times.length) {
		k = 0
		for (let j = 1; j < n; j++) if (Math.abs(ctx.times[j] - at) < Math.abs(ctx.times[k] - at)) k = j
	}
	return k
}

function goal_day_night(ctx, g) {
	if (!ctx.known(g.item)) return null
	const iid = g.item
	const day = ctx.state(iid, "day") ?? []
	const want = ["night", "dark", "night time", "nighttime"].includes(F.py.pyLower(String(F.py.truthy(g.is) ? g.is : "day").trim())) ? "night" : "day"
	const n = ctx.num(g.days)
	const at = ctx.num(g.at_s)
	let rises = 0
	let sets = 0
	for (let j = 1; j < day.length; j++) {
		if (day[j] >= 0.5 && day[j - 1] < 0.5) rises += 1
		else if (day[j] < 0.5 && day[j - 1] >= 0.5) sets += 1
	}
	let seen = null
	let ok
	let made
	if (n !== null && n > 0) {
		ok = day.length > 0 && rises >= n - 1e-9 && sets >= n - 1e-9
		made = `${_nm(ctx, iid)}'s town goes through ${F.py.fmtG(n, 6)} day${n === 1 ? "" : "s"} and night${n === 1 ? "" : "s"}`
	} else {
		if (day.length) seen = day[_nearest(ctx, day.length, at)] >= 0.5 ? "day" : "night"
		ok = seen === want
		made = `It is ${want} at ${_nm(ctx, iid)}'s town ${at === null ? "at the end" : `at ${_fmt_s(at)} s`}`
	}
	return { label: _label(g, made), ok, kind: "day_night", item: iid, seen, sunrises: rises, sunsets: sets }
}

const ECLIPSE_WORDS = { lunar: ["none", "penumbral", "partial", "total"], solar: ["none", "partial", "annular", "total"] }

function _eclipse(ctx, g, typ, kind) {
	const key = `${typ}_eclipse`
	if (g.item !== undefined && g.item !== null && !ctx.known(g.item)) return null
	const ids = g.item !== undefined && g.item !== null ? [g.item] : (ctx.scene.items ?? []).filter((i) => i !== null && typeof i === "object" && !Array.isArray(i) && (i.type === "moon" || i.type === "moon-ball") && typeof i.id === "string").map((i) => i.id)
	const total = g.total === true
	const central = g.central === true && typ === "solar"
	const none = g.none === true
	const need = total ? 3 : central ? 2 : 1
	const at = ctx.num(g.at_s)
	let best = 0
	let best_id = null
	let when = null
	let when_id = null
	for (const iid of ids) {
		const v = ctx.state(iid, key)
		if (!(v && v.length)) continue
		const x = at !== null ? v[_nearest(ctx, v.length, at)] : Math.max(...v)
		if (x > best) {
			best = x
			best_id = iid
		}
		if (at === null) {
			const t = ctx.first_time(iid, key, (y) => y >= need)
			if (t !== null && (when === null || t < when)) {
				when = t
				when_id = iid
			}
		}
	}
	const ok = none ? best < need : best >= need
	const adj = total ? "total " : central ? "central (total or annular) " : ""
	const made = `${none ? "No" : "A"} ${adj}${typ} eclipse happens${at === null ? "" : ` at ${_fmt_s(at)} s`}`
	const label = F.py.truthy(g.label) ? g.label : made
	const who = when_id !== null ? when_id : best_id !== null ? best_id : ids.length ? ids[0] : null
	return { label, ok, kind, item: who, type: typ, seen: ECLIPSE_WORDS[typ][Math.trunc(best)], t: when === null ? null : F.py.pyRound(when, 3) }
}

function goal_eclipse(ctx, g) {
	const t = F.py.pyLower(String(F.py.truthy(g.type) ? g.type : "").trim())
	const typ = t === "solar" || t === "sun" ? "solar" : t === "lunar" || t === "moon" ? "lunar" : null
	if (typ === null) return null
	return _eclipse(ctx, g, typ, "eclipse")
}
const goal_solar_eclipse = (ctx, g) => _eclipse(ctx, g, "solar", "solar_eclipse")
const goal_lunar_eclipse = (ctx, g) => _eclipse(ctx, g, "lunar", "lunar_eclipse")

function goal_noon_sun(ctx, g) {
	if (!ctx.known(g.item)) return null
	const iid = g.item
	const want = ctx.num(g.deg)
	let tol = ctx.num(g.tol)
	tol = tol === null || tol < 0 ? 1.0 : tol
	const v = ctx.state(iid, "noon_elevation")
	const at = ctx.num(g.at_s)
	const seen = v && v.length && want !== null ? v[_nearest(ctx, v.length, at)] : null
	const ok = seen !== null && Math.abs(seen - want) <= tol + 1e-9
	const made = `The noon Sun at ${_nm(ctx, iid)}'s town is ${want !== null ? _fmt_s(want) : "?"}° up ${at === null ? "at the end" : `at ${_fmt_s(at)} s`}`
	return { label: F.py.truthy(g.label) ? g.label : made, ok, kind: "noon_sun", item: iid, seen: seen === null ? null : F.py.pyRound(seen, 2) }
}

// the constellations along the ecliptic (mod_space.py ZODIAC: IAU boundaries, J2000 ecliptic longitudes), and Orion
export const ZODIAC = [["pisces", 351.6, 29.1], ["aries", 29.1, 53.5], ["taurus", 53.5, 90.4], ["gemini", 90.4, 118.3], ["cancer", 118.3, 138.2], ["leo", 138.2, 174.2],
	["virgo", 174.2, 218.0], ["libra", 218.0, 241.0], ["scorpius", 241.0, 247.7], ["ophiuchus", 247.7, 266.3], ["sagittarius", 266.3, 299.7],
	["capricornus", 299.7, 327.7], ["aquarius", 327.7, 351.6], ["orion", 70.0, 100.0]]
const SKY_ALIASES = { scorpio: "scorpius", capricorn: "capricornus", "the hunter": "orion", twins: "gemini", lion: "leo", bull: "taurus" }
const _in_arc = (lon, a, b) => (a < b ? a <= lon && lon < b : lon >= a || lon < b)
export function constellation_at(lon) {
	for (const [name, a, b] of ZODIAC.slice(0, -1)) if (_in_arc(lon, a, b)) return name
	return null
}

function goal_night_sky(ctx, g) {
	if (!ctx.known(g.item)) return null
	const iid = g.item
	let name = F.py.pyLower(String(F.py.truthy(g.constellation) ? g.constellation : "").trim()).split(/\s+/).filter(Boolean).join(" ")
	name = Object.hasOwn(SKY_ALIASES, name) ? SKY_ALIASES[name] : name
	const arc = ZODIAC.find(([n]) => n === name) ?? null
	const v = ctx.state(iid, "night_lon") ?? []
	const at = ctx.num(g.at_s)
	let seen = null
	let ok
	if (arc !== null && v.length) {
		if (g.any === true) ok = v.some((x) => _in_arc(x, arc[1], arc[2]))
		else {
			const x = v[_nearest(ctx, v.length, at)]
			seen = constellation_at(x)
			ok = _in_arc(x, arc[1], arc[2])
		}
	} else ok = false
	const what = name ? name.slice(0, 1).toUpperCase() + name.slice(1) : "a constellation"
	const when = g.any === true ? " at some moment" : at === null ? " at the end" : ` at ${_fmt_s(at)} s`
	return { label: _label(g, `${what} is high in ${_nm(ctx, iid)}'s midnight sky${when}`), ok, kind: "night_sky", item: iid, seen }
}

// ---------------------------------------------------------------- the AI's plug-ins (web/sim/plugins.js)
const fmtNum = (v, d = 2) => (Number.isFinite(v) ? String(Number(v.toFixed(d))) : "?")
const comma = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "?")
const days = (s) => (s >= 172800 ? `${fmtNum(s / 86400, 1)} days` : s >= 7200 ? `${fmtNum(s / 3600, 1)} h` : `${fmtNum(s / 60, 1)} min`)
/** What a launch factor does, in words. */
export function launchWords(f) {
	if (!(f > 0)) return "let go at rest (it falls straight in)"
	if (f < 0.999) return "slower than a circle: it falls in toward what it circles"
	if (f <= 1.001) return "a circle"
	if (f < Math.SQRT2 - 0.001) return "an ellipse that swings out farther"
	return "faster than escape speed: it leaves for good"
}
/** The places the scene's settings can be, with their real gravity and air [NASA-PFS]. */
export const PLACES = [
	["Earth", "earth", 9.81, true],
	["the Moon", "moon", 1.62, false],
	["Mars", "mars", 3.71, false],
	["Jupiter (cloud tops)", "jupiter", 24.79, true],
	["Mercury", 3.7, 3.7, false],
	["Venus", 8.87, 8.87, true],
	["Saturn (cloud tops)", 10.44, 10.44, true],
	["Uranus (cloud tops)", 8.87, 8.87, true],
	["Neptune (cloud tops)", 11.15, 11.15, true],
	["Pluto", 0.62, 0.62, false],
	["a space station (weightless)", "none", 0, true],
	["outer space", "none", 0, false]
]
/** A scene's gravity setting in words ("the Moon (1.62 m/s²)"). */
export function placeWords(gravity, air) {
	const g = gravity === undefined || gravity === null ? 9.81 : typeof gravity === "string" ? ({ earth: 9.81, moon: 1.62, mars: 3.71, jupiter: 24.79, none: 0 })[gravity.toLowerCase()] : gravity
	const hit = PLACES.find(([, , gv, a]) => gv === g && (air === undefined || air === null || a === air)) ?? PLACES.find(([, , gv]) => gv === g)
	const where = hit ? hit[0] : `${g} m/s²`
	return `${where} (g ${g} m/s²${air === false ? ", no air" : ""})`
}

/** The scale a run's space records say: {k, s, name} or null. */
const scaleOf = (doc) => {
	const r = (doc?.processes ?? []).find((p) => p.kind === "space-body")
	return r ? { k: r.km_per_m, s: r.s_per_s, name: r.scale } : null
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
const fmtClock = (h) => {
	if (!Number.isFinite(h)) return "?"
	const m = Math.round(h * 60) % 1440
	return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`
}
const ECLIPSE_LUNAR = ["none", "penumbral", "partial", "total"]
const ECLIPSE_SOLAR = ["none", "partial", "annular", "total"]
/** The eclipses a run's readings show: "a total lunar eclipse 6.10-6.90 s; a partial solar eclipse 0.00-0.30 s" or "none". */
function eclipseWords(st, frames) {
	const bits = []
	for (const [key, words, what] of [["lunar_eclipse", ECLIPSE_LUNAR, "lunar"], ["solar_eclipse", ECLIPSE_SOLAR, "solar"]]) {
		const v = st?.[key]
		if (!v?.length) continue
		let k = 0
		while (k < v.length) {
			if (!(v[k] >= 1)) {
				k++
				continue
			}
			let j = k
			let top = 0
			while (j < v.length && v[j] >= 1) top = Math.max(top, v[j++])
			const t0 = frames?.[k]?.t
			const t1 = frames?.[j - 1]?.t
			bits.push(`a ${words[Math.trunc(top)] ?? "?"} ${what} eclipse${Number.isFinite(t0) ? ` ${fmtNum(t0, 2)}-${fmtNum(t1, 2)} s` : ""}`)
			k = j
		}
	}
	return bits.length ? bits.join("; ") : "none"
}
/** What plays the Sun for a globe or a moon ball, in words, from its record (and where it is from the centre c, when known). */
function lightWords(doc, rec, c) {
	const L = rec?.light
	if (!L) return "NO LIGHT in the scene (add a lamp, a flashlight or sunlight to play the Sun)"
	if (L.kind === "parallel") {
		const toward = -Math.cos(L.dir) // (x of the direction toward the light)
		return `sunlight from the ${toward < 0 ? "left" : "right"} (parallel, ${fmtNum(Math.abs((Math.asin(Math.max(-1, Math.min(1, -Math.sin(L.dir)))) * 180) / Math.PI), 0)}° up)`
	}
	const sol = (doc?.solids ?? []).find((q) => q.id === L.solid)
	const who = sol?.item ?? "the light"
	if (L.kind === "far") return `the far Sun "${who}" (parallel light)`
	if (!sol || !c) return `"${who}"`
	const x = sol.at.x + L.x
	const y = sol.at.y + L.y
	return `"${who}" ${fmtNum(Math.hypot(x - c.x, y - c.y), 2)} m away, its light ${fmtNum(y - c.y, 2)} m ${y >= c.y ? "above" : "below"} the middle`
}
const seasonOf = (dec, tilt) =>
	Math.abs(dec) < 1 ? "an equinox (the light over the equator)" : tilt > 0 && dec >= tilt - 0.5 ? "the June solstice (the north's summer)" : tilt > 0 && dec <= -tilt + 0.5 ? "the December solstice (the north's winter)" : dec > 0 ? "between an equinox and June" : "between an equinox and December"
function classroomLines(item, sim) {
	const doc = sim?.doc
	const st = sim?.track?.state?.[item.id]
	const frames = sim?.track?.frames ?? []
	if (item.type === "globe") {
		const rec = (doc?.processes ?? []).find((p) => p.kind === "globe" && p.item === item.id)
		if (!rec) return null
		const ball = (doc?.solids ?? []).find((q) => q.id === rec.solid)
		const out = [`globe: lit by ${lightWords(doc, rec, ball?.at)}; axis tilted ${fmtNum(rec.tilt)}°, north pole leaning ${rec.lean}; spins ${fmtNum(rec.rpm, 1)} turns a minute${rec.rpm > 0 ? ` (a day every ${fmtNum(60 / rec.rpm, 1)} s)` : " (still)"}`]
		if (!st?.day?.length) return out
		const n = st.day.length - 1
		let rises = 0
		let sets = 0
		for (let k = 1; k <= n; k++) {
			if (st.day[k] >= 0.5 && st.day[k - 1] < 0.5) rises++
			else if (st.day[k] < 0.5 && st.day[k - 1] >= 0.5) sets++
		}
		if (st.local_time?.length) {
			out.push(`town at ${fmtNum(rec.lat)}°: ${fmtClock(st.local_time[0])} (${st.day[0] >= 0.5 ? "day" : "night"}) → ${fmtClock(st.local_time[n])} (${st.day[n] >= 0.5 ? "day" : "night"}); ${rises} sunrise${rises === 1 ? "" : "s"}, ${sets} sunset${sets === 1 ? "" : "s"} in the run; ${fmtNum(st.turns?.[n] ?? 0, 2)} turns`)
			out.push(`the light is overhead at ${fmtNum(st.sun_lat[n], 1)}° (${seasonOf(st.sun_lat[n], rec.tilt)}): at the town its noon height ${fmtNum(st.noon_elevation[n], 1)}°, ${fmtNum(st.day_length_h[n], 1)} h of light a turn`)
		} else out.push("no light: the town is dark all the time")
		return out
	}
	if (item.type === "moon-ball") {
		const rec = (doc?.processes ?? []).find((p) => p.kind === "moon-ball" && p.item === item.id)
		if (!rec) return null
		const around = rec.around ? rec.around.split("/")[0] : null
		const cs = (doc?.solids ?? []).find((q) => q.id === (rec.around ?? rec.solid))
		const out = [`moon ball: carried round ${around ? `the globe "${around}"` : "its own place (a viewer's eye)"} ${fmtNum(rec.radius * 100, 0)} cm out, ${rec.period > 0 ? `once every ${fmtNum(rec.period, 1)} s` : "held still"}, from ${fmtNum(rec.start, 0)}° (${phase_name(rec.start)}); circle tilted ${fmtNum(rec.tilt, 0)}°, its high point ${fmtNum((rec.node + 90) % 360, 0)}° round from the light; lit by ${lightWords(doc, rec, cs?.at)}`]
		if (st?.elongation?.length) {
			const n = st.elongation.length - 1
			const names = []
			for (const v of st.elongation) {
				const nm = phase_name(v)
				if (names[names.length - 1] !== nm) names.push(nm)
			}
			out.push(`phase seen from the middle: ${phase_name(st.elongation[n])} (${Math.round((st.lit?.[n] ?? 0) * 100)} % lit) at the end; in order: ${names.slice(0, 10).join(" → ")}`)
			if (around) out.push(`eclipses: ${eclipseWords(st, frames)}`)
		}
		return out
	}
	return null
}

/** An ordinary moving thing in a space scene (orbit mode): it floats and drifts (the layout's warning says it too: _space_warnings). */
function floatingLines(item, sim) {
	const doc = sim?.doc
	if (!item || !(doc?.processes ?? []).some((p) => p.kind === "space-body")) return null
	const solid = (doc.solids ?? []).find((s) => s.item === item.id && s.kind === "dynamic")
	if (!solid) return null
	const fr = sim?.track?.frames ?? []
	const p0 = fr[0]?.placements?.[solid.id]
	const p1 = fr.at(-1)?.placements?.[solid.id]
	const moved = p0 && p1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : null
	// (toward the body with the strongest pull: the record with the largest mu, by its item's name where the run has the scene, else by its id)
	const recs = doc.processes.filter((p) => p.kind === "space-body" && p.mu > 0)
	const top = recs.reduce((b, p) => (b === null || p.mu > b.mu ? p : b), null)
	const it = top === null ? null : (sim?.scene?.items ?? []).find((i) => i?.id === top.item)
	const words = top === null ? null : (doc.solids ?? []).find((x) => x.id === top.solid)?.words
	const toward = top === null ? "where it is let go" : `toward ${F.py.truthy(it?.name) ? it.name : F.py.truthy(words) ? words : top.item}`
	return [`floats: a space scene has no gravity but the space bodies' pull and no air, so it drifts ${toward}${Number.isFinite(moved) ? ` (${fmtNum(moved, 2)} m during the run)` : ""}; for a drop on a world, use settings.gravity with no sun, planet, moon or satellite`]
}

function digestLines(item, sim) {
	if (item?.type === "globe" || item?.type === "moon-ball") return classroomLines(item, sim)
	if (item?.type === "gnomon") {
		const st = sim?.track?.state?.[item.id]
		if (!st?.hour?.length) return null
		const n = st.hour.length - 1
		const at = (k) => `${clock(st.hour[k])}: Sun ${fmtNum(st.sun_elevation[k], 1)}° up, shadow ${st.shadow_m[k] > 0 ? `${fmtNum(st.shadow_m[k], 2)} m toward ${compass(st.shadow_dir[k])} (${Math.round(st.shadow_dir[k])}°)` : "none (night)"}`
		let kmin = 0
		for (let k = 1; k <= n; k++) if (st.shadow_m[k] > 0 && (st.shadow_m[kmin] <= 0 || st.shadow_m[k] < st.shadow_m[kmin])) kmin = k
		return [`sun clock: ${at(0)} → ${at(n)}; shortest shadow ${at(kmin)}; day length ${fmtNum(st.day_length_h[0], 1)} h`]
	}
	if (!SPACE_TYPES.includes(item?.type)) return floatingLines(item, sim)
	const doc = sim?.doc
	const out = []
	const recs = (doc?.processes ?? []).filter((p) => p.kind === "space-body")
	const rec = recs.find((p) => p.item === item.id)
	const sc = scaleOf(doc)
	if (sc && recs[0]?.item === item.id) {
		out.push(`orbit mode: no uniform gravity and no air (a space body is in the scene); scale ${sc.name}: 1 m = ${comma(sc.k)} km, 1 s of the run = ${days(sc.s)}`)
	}
	if (!rec) return out
	if (rec.launch) out.push(`launched at the release at ${fmtNum(rec.launch.factor)}× orbit speed (${launchWords(rec.launch.factor)}), ${rec.launch.direction === "cw" ? "clockwise" : "counter-clockwise"}`)
	else if (item.type !== "sun") out.push("not launched: let go at rest (orbit_factor 0)")
	const st = sim?.track?.state?.[item.id]
	if (st?.distance?.length) {
		const n = st.distance.length - 1
		const prim = rec.primary ? rec.primary.split("/")[0] : null
		const pr = recs.find((p) => p.solid === rec.primary) ?? null
		const r0 = st.distance[0]
		const r1 = st.distance[n]
		const v1 = st.speed?.[n]
		let period = ""
		if (pr && Number.isFinite(v1) && r1 > 0) {
			const mu = pr.mu + rec.mu
			const inv = 2 / r1 - (v1 * v1) / mu
			if (inv > 0) {
				const a = 1 / inv
				const T = 2 * Math.PI * Math.sqrt((a * a * a) / mu)
				period = `; an orbit takes ${fmtNum(T, 1)} s here (${days(T * rec.s_per_s)} real)`
			} else period = "; it is on an escape path"
		}
		out.push(`circles ${prim ?? "what dominates it"}: ${fmtNum(r0, 3)} → ${fmtNum(r1, 3)} m out (${comma(r1 * rec.km_per_m)} km real), speed ${fmtNum(v1, 3)} m/s (${fmtNum((v1 * rec.km_per_m) / rec.s_per_s, 2)} km/s real)${period}`)
		const turns = st.turns?.[n]
		const fell = (st.fell ?? []).some((v) => v >= 1)
		out.push(`${fmtNum(turns, 2)} turns in the run${fell ? "; it FELL onto what it circles" : ""}${st.escaped?.[n] >= 1 ? "; it is ESCAPING" : ""}`)
		if (st.elongation?.length) {
			const e = st.elongation
			const names = []
			for (const v of e) {
				const nm = phase_name(v)
				if (names[names.length - 1] !== nm) names.push(nm)
			}
			out.push(`phase as its planet sees it: ${phase_name(e[n])} (${Math.round((st.lit?.[n] ?? 0) * 100)} % lit) at the end; in order: ${names.slice(0, 9).join(" → ")}`)
		}
		if (st.lunar_eclipse?.length) {
			let hi = 0
			for (const v of st.latitude ?? []) hi = Math.max(hi, Math.abs(v))
			out.push(`orbit tilted ${fmtNum(rec.tilt ?? 0, 3)}° (nodes ${fmtNum(rec.node ?? 0, 0)}° from the Sun at the start; up to ${fmtNum(hi, 2)}° above or below the plane in the run); eclipses (real sizes): ${eclipseWords(st, sim?.track?.frames)}`)
		}
	}
	if (rec.seasons && st?.noon_elevation?.length) {
		const v = st.noon_elevation
		const n = v.length - 1
		let lo = 0
		let hi = 0
		for (let k = 1; k <= n; k++) {
			if (v[k] < v[lo]) lo = k
			if (v[k] > v[hi]) hi = k
		}
		const t = (k) => (Number.isFinite(sim?.track?.frames?.[k]?.t) ? ` at ${fmtNum(sim.track.frames[k].t, 2)} s` : "")
		out.push(`seasons (axis tilted ${fmtNum(rec.seasons.tilt)}°, ${rec.seasons.date} at the start): noon Sun at ${fmtNum(rec.seasons.lat)}° ${fmtNum(v[0], 1)}° → ${fmtNum(v[n], 1)}° (highest ${fmtNum(v[hi], 1)}°${t(hi)}, lowest ${fmtNum(v[lo], 1)}°${t(lo)}); day ${fmtNum(st.day_length_h[0], 1)} → ${fmtNum(st.day_length_h[n], 1)} h; the Sun overhead at ${fmtNum(st.sun_lat[n], 1)}° at the end`)
		if (st.night_lon?.length) {
			const sky = []
			for (const x of st.night_lon) {
				const c = constellation_at(x)
				if (sky[sky.length - 1] !== c) sky.push(c)
			}
			out.push(`the midnight sky (opposite the Sun along the ecliptic): ${sky.slice(0, 14).join(" → ")}${st.night_lon.some((x) => x >= 70 && x < 100) ? "; Orion high at midnight while it is at 70-100°" : ""}`)
		}
	}
	return out
}

const KNOB_ORBIT = (type) => ({
	type, key: "orbit_factor", how: "abs", steps: [0.02, 0.05, 0.1, 0.2, 0.4], cost: 1,
	more: "launch {it} faster", less: "launch {it} slower",
	why: "1 = a circle; slower falls in toward what it circles, faster swings out on an ellipse, 1.41× (√2) escapes"
})
const KNOB_MASS = (type) => ({
	type, key: "mass_scale", how: "rel", steps: [0.1, 0.25, 0.5, 1, 2], cost: 6, more: "make {it} heavier", less: "make {it} lighter",
	why: "a heavier body pulls harder: what circles it at the same speed falls in, at the same launch factor it circles faster"
})

const clock = (h) => (Number.isFinite(h) ? `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, "0")}` : "?")
function changeWords(type, key, a, b, nameOf) {
	if (type === "gnomon") {
		if (key === "hour") return `clock ${clock(a ?? 9)} → ${clock(b ?? 9)} (solar time)`
		if (key === "latitude") return `latitude ${fmtNum(a ?? 30.27)}° → ${fmtNum(b ?? 30.27)}°`
		if (key === "season") return `date ${a ?? "march equinox"} → ${b ?? "march equinox"}`
		if (key === "height") return `height ${fmtNum((a ?? 1) * 100, 0)} → ${fmtNum((b ?? 1) * 100, 0)} cm`
		return null
	}
	if (type === "globe") {
		if (key === "start_hour") return `town's clock at the start ${fmtClock(a ?? 6)} → ${fmtClock(b ?? 6)} (solar time)`
		if (key === "spin_rpm") return `spins ${fmtNum(a ?? 6, 1)} → ${fmtNum(b ?? 6, 1)} turns a minute (a day every ${(a ?? 6) > 0 ? fmtNum(60 / (a ?? 6), 1) : "∞"} → ${(b ?? 6) > 0 ? fmtNum(60 / (b ?? 6), 1) : "∞"} s)`
		if (key === "lean") return `north pole leans ${a ?? "toward the camera"} → ${b ?? "toward the camera"}`
		if (key === "town_lat") return `town's latitude ${fmtNum(a ?? 30.27)}° → ${fmtNum(b ?? 30.27)}°`
		if (key === "tilt_deg") return `axis tilt ${fmtNum(a ?? 23.44)}° → ${fmtNum(b ?? 23.44)}°`
		if (key === "lit_by") return `lit by ${a ? nameOf(a) : "the first light"} → ${b ? nameOf(b) : "the first light"}`
		if (key === "diameter") return `${fmtNum((a ?? 0.3) * 100, 0)} → ${fmtNum((b ?? 0.3) * 100, 0)} cm across`
		if (key === "stand_height") return `stand ${fmtNum((a ?? 0.25) * 100, 0)} → ${fmtNum((b ?? 0.25) * 100, 0)} cm tall`
		return null
	}
	if (type === "moon-ball") {
		if (key === "start_deg") return `starts ${fmtNum(a ?? 0, 0)}° → ${fmtNum(b ?? 0, 0)}° round from the light (${phase_name(a ?? 0)} → ${phase_name(b ?? 0)})`
		if (key === "period_s") return `a trip round every ${fmtNum(a ?? 12, 1)} → ${fmtNum(b ?? 12, 1)} s`
		if (key === "tilt_deg") return `circle tilt ${fmtNum(a ?? 30, 0)}° → ${fmtNum(b ?? 30, 0)}°${(b ?? 30) === 0 ? " (level: eclipses at full and new)" : ""}`
		if (key === "node_deg") return `its circle's low and high points ${fmtNum(a ?? 90, 0)}° → ${fmtNum(b ?? 90, 0)}° from the light`
		if (key === "radius") return `carried ${fmtNum((a ?? 0.5) * 100, 0)} → ${fmtNum((b ?? 0.5) * 100, 0)} cm out`
		if (key === "around") return `carried round ${a ? nameOf(a) : "its own place"} → ${b ? nameOf(b) : "its own place"}`
		if (key === "lit_by") return `lit by ${a ? nameOf(a) : "the first light"} → ${b ? nameOf(b) : "the first light"}`
		if (key === "diameter") return `ball ${fmtNum((a ?? 0.075) * 100, 1)} → ${fmtNum((b ?? 0.075) * 100, 1)} cm across`
		return null
	}
	if (!SPACE_TYPES.includes(type) && type !== "rock-hammer") return null
	if (key === "orbit_tilt") return `orbit tilt ${fmtNum(a ?? 5.145, 3)}° → ${fmtNum(b ?? 5.145, 3)}°${b === 0 ? " (in the plane: an eclipse every new and full moon)" : ""}`
	if (key === "node_deg") return `nodes ${fmtNum(a ?? 90, 0)}° → ${fmtNum(b ?? 90, 0)}° from the Sun (${[0, 180].includes(Math.round(b ?? 90) % 360) ? "eclipses this month" : Math.abs(((b ?? 90) % 180) - 90) < 45 ? "no eclipses this month" : "eclipses only partly lined up"})`
	if (key === "seasons") return `seasons ${a ? "on" : "off"} → ${b ? "on" : "off"}`
	if (key === "start_date") return `date at the start ${a ?? "march equinox"} → ${b ?? "march equinox"}`
	if (key === "town_lat") return `town's latitude ${fmtNum(a ?? 30.27)}° → ${fmtNum(b ?? 30.27)}°`
	if (key === "axis_tilt") return `axis tilt ${fmtNum(a ?? 23.44)}° → ${fmtNum(b ?? 23.44)}°`
	if (key === "orbit_factor") return `launch speed ${fmtNum(a ?? 1)} → ${fmtNum(b ?? 1)}× orbit speed (${launchWords(b ?? 1)})`
	if (key === "body") return `${BODIES[a]?.[0] ?? a} → ${BODIES[b]?.[0] ?? b}`
	if (key === "mass_scale") return `mass ${fmtNum(a ?? 1)} → ${fmtNum(b ?? 1)}× its real mass`
	if (key === "primary") return `circles ${a ? nameOf(a) : "what dominates it"} → ${b ? nameOf(b) : "what dominates it"}`
	if (key === "scale") return `scene scale ${a ?? "auto"} → ${b ?? "auto"}`
	if (key === "direction") return `goes round ${a ?? "counter-clockwise"} → ${b ?? "counter-clockwise"}`
	return null
}

const HOWTO = [
	"PLACES (gravity of other worlds): the scene's settings say where it is. settings.gravity: \"earth\" (9.81 m/s², the standard), \"moon\" (1.62), \"mars\" (3.71), \"jupiter\" (24.79), \"none\" (0: weightless), or a number of m/s² for other worlds [NASA fact sheets]: Mercury 3.7, Venus 8.87, Saturn 10.44, Uranus 8.87, Neptune 11.15, Pluto 0.62. settings.air false = a vacuum (no drag, no buoyancy: a feather and a hammer fall together). settings.air_density (kg/m³, with air on; left out: a room's 1.2) is a world's own air for drag and buoyancy [NASA fact sheets]: Mars 0.020 (thin: a 1 g craft feather from 2 m lands 1.06 s after the drop, a golf ball 1.03 s; in a vacuum both 1.04 s), Venus 65 (thick: anything lighter than 65 kg/m³, a craft feather or foam, floats up), Jupiter 0.16, Saturn 0.19, Neptune 0.45 (their 1-bar levels). Real places: the Moon, Mercury, Pluto: air false; Mars {gravity: \"mars\", air_density: 0.02}; Venus {gravity: 8.87, air_density: 65}; Jupiter {gravity: \"jupiter\", air_density: 0.16}; a space station: gravity \"none\", air true; outer space: \"none\", false. (A module's own air processes, balloons and jars, use a room's air.) Same drop on different worlds: fall time √(2h/g) (1 m: Earth 0.452 s, Moon 1.111 s, Mars 0.734 s, Jupiter 0.284 s). Weight W = m·g changes with the place (a spring scale reads it), mass does not (a pan balance reads the same).",
	"ORBIT MODE (sun, planet, moon, satellite): a scene with any of them is in space: NO uniform gravity and NO air, automatically (the machine plane is the plane of the orbits, seen from above). Bodies pull every moving thing with their real gravity at the scene's SCALE, which the heaviest body sets (its `scale`: auto = the Sun's \"inner-planets\" 1 m = 1 au, 1 s = 40 days; Earth's \"earth-moon\" 1 m = 300,000 km, 1 s = 2 days; Jupiter's \"jupiter-moons\" 1 m = 1 million km, 1 s = 12 h; Mars's \"mars-moons\" 1 m = 20,000 km, 1 s = 2 h; \"low-orbit\" 1 m = 10,000 km, 1 s = 10 min (the Earth drawn true size, 1.27 m across: satellites, Newton's cannon); \"custom\" km_per_m + hours_per_s). Real distances in scene metres = km ÷ km per metre: the Moon 384,400 km = 1.28 m (earth-moon); Mercury 0.387 m, Venus 0.723, Earth 1.0, Mars 1.524 (inner-planets); the ISS 6,791 km from Earth's centre = 0.679 m (low-orbit: only 4.2 cm above the 1.274 m Earth, so keep a satellite small there, size ≤ 0.05 m, or it grazes the ground); Io 0.422, Europa 0.671, Ganymede 1.070 (jupiter-moons). Newton's cannon: the Earth (low-orbit, fixed) with cannonballs (satellite kind cannonball, size 0.03-0.04) stacked straight above its top 6 cm apart, the lowest at 0.68 m from its centre: orbit_factor 0.7 falls back, 1.0 circles, 1.45 escapes.",
	"Placing an orbit scene: the central body on \"air\" (place {on: \"air\", x, y_m}) at the middle, high enough that every orbit clears the table top (y = 0): centre y ≥ radius + 0.15 m; each orbiting body to its right at its distance (x = centre x + distance, same y), place on \"air\"; its `primary` link = the body it circles; orbit_factor 1 = a circle (counter-clockwise), 0.7 falls in, 1.2 an ellipse (it swings out to r·f²/(2 − f²)), 1.42 escapes. Set the stage (x0 x1 y0 y1) to hold every orbit with 0.2 m to spare, and seconds ≥ the periods you want to show (≤ 20). Real periods at the scale: Moon 13.7 s (earth-moon); Mercury 2.2 s, Venus 5.6 s, Earth 9.1 s, Mars 17.2 s (inner-planets); ISS 9.3 s (low-orbit); Io 3.5 s, Europa 7.1 s, Ganymede 14.3 s (jupiter-moons). MOON PHASES: the earth-moon scale (Earth at the middle, the Moon 1.28 m out, primary earth, orbit_factor 1) with a sun that only shines (props {pulls: false}) at one side of the stage: its light is parallel, as the real far Sun's, and the moon's phase as Earth sees it is read every moment (new when the Moon is between Earth and the Sun, full when Earth is between); never a pulling Sun near an Earth-Moon pair (the real Sun is 390 times farther away than the Moon: at a visible distance its pull tears them apart). The run shows the sidereal month (27.3 days), the phases in order. Sizes are automatic (true size at the scale, else a visible size, larger than true: say so); `fixed` holds a body still.",
	"SHADOWS (gnomon, a shadow stick standing on the table or floor, its foot its anchor): latitude (Austin 30.27, + north), date (season: an equinox, a solstice, or day_of_year), solar time `hour` (12 = noon). The clock runs at the scene's settings.time_lapse: 3600 sweeps an hour a second (hour 8, seconds 8.5: 8:00 → 16:00). The shadow is drawn on the ground (the machine plane runs east-west: east to the right, north into the picture), shortest at solar noon pointing north (north of the tropics), toward the west in the morning and the east in the afternoon; the noon shadow is short in June, long in December (north). Readings: sun_elevation, sun_azimuth, shadow_m, shadow_dir, day_length_h; goal shadow_length {item, m, at_s?}. Austin, equinox: noon 0.58 m for a 1 m stick (Sun 59.7° up), 9:00 1.30 m; June solstice noon 0.12 m, December 1.36 m.",
	"A geologist's hammer (rock-hammer, Apollo 15's 1.32 kg) for drop races: held (held: true) side by side with a feather, a ball or a paper at the same height, settings Moon + air false: they land together (goal lands_together).",
	"CLASSROOM SUN-EARTH-MOON MODELS (globe, moon-ball: side view on the table, ordinary gravity; NOT orbit mode, so no sun item: a lamp plays the Sun). The light: the desk lamp (heat module) at one end of the table, head_height 0.4, target the globe (or a flashlight, or sunlight); a globe's or ball's lit_by link names it (none: the first light of the scene). globe = a 30 cm classroom globe on a stand, its foot on the table (y 0), its middle 0.40 m up (stand_height 0.25: level with the lamp's bulb), 0.8-1.5 m from the lamp: spin_rpm (6 = one turn, one day, every 10 s), tilt_deg 23.44, lean = where its north pole leans, kept so (\"toward the camera\" or \"away from the camera\" with the lamp to one side = an equinox; \"toward the light\" = the June solstice; \"away from the light\" = December's; right/left fixed in the room), start_hour (the town's solar time at the start: 6 sunrise, 12 noon, 18 sunset), town_lat (a red pin; Austin 30.27). The half facing the light is day; readings day (1/0), local_time, sun_elevation, noon_elevation, sun_lat (where the light is overhead), day_length_h, turns; events sunrise/sunset. Goals day_night {item: globe, is: \"day\"|\"night\", at_s?} or {item, days: n} (n sunrises and sunsets), noon_sun {item, deg, tol?}. Seasons on the table: one globe a run (a globe in line with another shades it: the readings do not see that shadow, the picture does), its middle level with the light: leaning toward the light = June (noon 83.2° at Austin, 13.9 h of day), away from it = December (36.3°, 10.1 h), to the side = an equinox (59.7°, 12.0 h); a light above the globe's middle raises where it is overhead (sunlight comes from 5° up at least). One run with the whole year: the Earth round the Sun in orbit mode with seasons on (below).",
	"moon-ball = a white foam ball (Ø 7.5 cm) on a stick carried round a globe: its anchor is the circle's centre, so give it the globe's x and y (with around = the globe the centre IS the globe's middle); radius 0.6 m, period_s 12 (one trip = one month), start_deg 0 new moon (between the lamp and the globe), 90 first quarter, 180 full (behind the globe), 270 last quarter; it goes counter-clockwise seen from above (first quarter comes toward the camera when the lamp is on the left). tilt_deg 30 with node_deg 90 (the default) carries it above the globe's shadow at full and below the lamp's line at new: no eclipses; tilt_deg 0 (level) or node_deg 0: a lunar eclipse at full (the globe's shadow on the ball) and a solar one at new (the ball's shadow on the globe). Without a globe it goes round its own place (a viewer's eye: the head model). Readings elongation, lit, height, lunar_eclipse (0 none, 1 penumbral, 2 partial, 3 total), solar_eclipse (0, 1 partial, 2 annular, 3 total). Goals phase {item: the ball, name, any?, at_s?}, eclipse {type: \"lunar\"|\"solar\", item: the ball, total?, none?}.",
	"ECLIPSES and SEASONS in orbit mode. The Moon's orbit is tilted 5.145° (moon orbit_tilt, automatic by body) and node_deg says where it crosses the Earth's orbit plane, from the Sun's direction at the start (default 90: high at full, low at new: NO eclipse this month, as most months; 0: the nodes line up with the Sun: a solar eclipse at the new moon and a lunar one at the full). Readings height_km, latitude (° above the plane), lunar_eclipse, solar_eclipse from the REAL sizes and distances (the bodies are drawn larger than true; the view lifts the Moon by the same factor so its drawn shadow matches). At the Moon's mean distance (the circle at 384,400 km) a central solar eclipse is annular: a total one needs it nearer (start it at perigee, 363,300 km = 1.211 m at the earth-moon scale, orbit_factor 1.027). Goals eclipse {type, item: the moon, total?, central? (solar: annular or total), none?, at_s?}, solar_eclipse {item, ...}, lunar_eclipse {item, ...}. SEASONS: a planet with seasons true (axis_tilt automatic: Earth 23.44), start_date (the date at the start: where its pole leans from the Sun), town_lat: its axis keeps pointing one way all round its orbit, so the Sun at noon climbs and sinks through the year: readings sun_lat, noon_elevation, day_length_h; goal noon_sun {item: the planet, deg, tol?, at_s?}; and night_lon, the midnight sky's ecliptic longitude (opposite the Sun: the stars change with the seasons): goal night_sky {item: the planet, constellation (the zodiac's 13 or Orion), at_s?, any?}: Orion high at midnight in December-January (night_lon 70-100°), Scorpius and Sagittarius in June-July. Sun at the middle (inner-planets: a year is 9.13 s), Earth 1 m out, start_date march equinox: noon at Austin 59.7° → 83.2° (June, a quarter year: 2.28 s) → 59.7° → 36.3° (December)."
].join("\n")

const PROMPT_PLAN = [
	"- \"On the Moon\" / \"on Mars\" / \"on Jupiter\" / \"in space\": set plan.settings.gravity (\"moon\", \"mars\", \"jupiter\", \"none\", or m/s² for Mercury 3.7, Venus 8.87, Saturn 10.44, Pluto 0.62) and the air: settings.air false on the Moon, Mercury, Pluto and in outer space; a world's own air as settings.air_density (air stays on): Mars 0.02 (thin), Venus 65 (thick), Jupiter 0.16, Saturn 0.19, Neptune 0.45; nothing for Earth or a space station. Never change the place the request names.",
	"- \"in a vacuum\" / \"no air\": settings.air false (gravity unchanged unless a world is named).",
	"- Orbits, planets, moons, satellites, Newton's cannon: orbit mode (automatic: no gravity, no air). Put the central body on \"air\" at the stage's middle, orbiting bodies at their scaled distance to its right on \"air\" with primary = that body and orbit_factor 1 (a circle), 0.7 (falls in), 1.2 (an ellipse), 1.45 (escapes). Pick the scale by the lesson (Earth+Moon: earth-moon; satellites: low-orbit on the Earth; planets round the Sun: inner-planets). Enlarge the stage to hold the orbits, keep them above the table (y > 0.1), seconds ≥ the period. Moon phases: a sun with pulls false at one side (parallel light), never a pulling Sun beside an Earth-Moon pair.",
	"- Shadows through the day / seasons: a gnomon (shadow stick) with latitude, season, hour; settings.time_lapse 3600 makes the clock run an hour a second (the shadow sweeps). Goal shadow_length {item, m, at_s?}.",
	"- Day and night, the Earth turning, sunrise/sunset, time zones: a lamp at one end of the table (head_height 0.4, target the globe) and a globe (stand_height 0.25: its middle level with the bulb) 1 m away, spin_rpm 6, start_hour 6; seconds 12-20; goal day_night {item: globe, days: 1} or {item, is: \"day\", at_s}. NOT orbit mode: no sun item on a table.",
	"- Seasons on the table: one globe a run (never two in line with the light: one shades the other), its middle level with the bulb: lean \"toward the light\" (June) in one run, \"away from the light\" (December) in another, town_lat 30.27; goals noon_sun 83.17 / 36.29 (tol 1). The whole year in one run: orbit mode, a sun, planet earth with seasons true and start_date; goals noon_sun at at_s.",
	"- Moon phases with a model: a lamp, a globe and a moon-ball (around: the globe, at the globe's x, y) period_s 12, seconds 12.5; goals phase {item: ball, name: \"full moon\", any: true}. Eclipses with the model: the ball's tilt_deg 0. Real eclipses: orbit mode (sun pulls false, earth, moon) with the moon's node_deg 0 (eclipses this month) or 90 (none); goals eclipse {type: lunar|solar, item: the moon or ball, total?, none?}.",
	"- Goals: orbits {item, around?, turns?}, falls_in {item, into?}, escapes {item}, lands_together {a, b, tol_s?}, lands_first {a, b}, phase {item, name, at_s?, any?} (names: new moon, waxing crescent, first quarter, waxing gibbous, full moon, waning gibbous, last quarter, waning crescent), day_night {item: globe, is?, at_s?, days?}, eclipse {type: solar|lunar, item: the moon or moon-ball, total?, central?, none?, at_s?}, noon_sun {item: globe|planet, deg, tol?, at_s?}, night_sky {item: planet with seasons, constellation, at_s?, any?}."
].join("\n")
const PROMPT_EDIT = [
	"- \"on the Moon instead\": set_scene {settings: {gravity: \"moon\", air: false, air_density: null}}; \"on Mars instead\": {gravity: \"mars\", air: null, air_density: 0.02}; \"back on Earth\": {gravity: null, air: null, air_density: null}. Say the change with g (\"Earth → the Moon, g 9.81 → 1.62 m/s², no air\").",
	"- Orbits: a speed change for an orbiting body (\"make the Moon go 1.5 times faster\", \"slower\") is THAT body's orbit_factor, times the factor asked (1 → 1.5), never its primary's mass_scale; then rewrite its goal to what the new speed does: below 1 it swings in on an ellipse, closest at r·f²/(2 − f²) (under its primary's radius it hits it: goal falls_in), 1 to 1.41 it swings out on a bigger ellipse to r·f²/(2 − f²) (goal orbits still), 1.42 or more it escapes (goal escapes, and say so). Only when the person says to keep the same orbit (\"same circle, but faster\") make the primary heavier instead: mass_scale × factor² (1.5× faster on the same circle = 2.25× the mass). \"heavier planet\" = mass_scale; \"farther out\" = move it along the line from its primary (x) and keep orbit_factor; a planet's moons and satellites follow it only if they are launched round it (primary). Name the bodies as proper nouns: the Earth, the Moon, the Sun, Mars.",
	"- Globe: \"spin faster/slower\" = spin_rpm; \"start at noon / at night\" = start_hour (12 / 0); \"make it summer / winter\" = lean toward / away from the light; \"a town farther north\" = town_lat; \"no tilt\" = tilt_deg 0 (no seasons). Moon ball: \"start at full moon\" = start_deg 180; \"show an eclipse\" = tilt_deg 0 (level circle); \"no eclipses\" = tilt_deg 30, node_deg 90; \"slower\" = period_s up. Real Moon: \"make an eclipse happen\" = node_deg 0; \"no eclipse\" = node_deg 90; never change orbit_tilt (the real 5.145°) unless asked."
].join("\n")
const PROMPT_REFINE = "- Orbit scenes: a body that fell in was launched too slowly (orbit_factor up toward 1) or too close; one that escaped too fast (down toward 1); a missing phase needs a longer run or the moon started at another angle (new moon: between the planet and the Sun; full: on the far side). A missing eclipse: the line of nodes must point at the Sun (node_deg 0 or 180; the model ball: tilt_deg 0); a total solar one needs the Moon near perigee. A globe whose town never sees day: no light in the scene, or the light is off, or the run is shorter than a turn (60 / spin_rpm s)."

export const EXAMPLES = [
	{ ask: "Drop a hammer and a feather together on the Moon from 1.6 m", how: "settings {gravity: \"moon\", air: false}; rock-hammer and a feather held at y 1.6; goal lands_together" },
	{ ask: "Drop a golf ball from 1 m on Earth, the Moon, Mars and Jupiter", how: "four runs, settings.gravity earth / moon / mars / jupiter with air false (the pure √(2h/g) times; a golf ball barely feels Mars's or Jupiter's air over 1 m); fall times 0.452 / 1.111 / 0.734 / 0.284 s" },
	{ ask: "Drop a feather and a ball on Mars", how: "settings {gravity: \"mars\", air_density: 0.02} (Mars's thin air); a craft feather (kind craft) and a golf ball held side by side at y 2.0; the feather lands a little later (1.06 s vs 1.03 s): goal lands_first {a: ball, b: feather}; on the Moon (air false) they land together" },
	{ ask: "Jump with the same push on Earth and on the Moon", how: "two steel balls held on the table with start_speed 3 and start_dir 90 (straight up), one scene with settings gravity earth, one with moon, air false: peaks v²/2g = 0.46 m and 2.78 m" },
	{ ask: "Show the ISS going around the Earth", how: "planet earth scale low-orbit, fixed, on air at (1.3, 1.5); satellite kind space-station size 0.04 at (1.979, 1.5) (420 km up), primary earth, orbit_factor 1; seconds 10; goal orbits (92.9 minutes = 9.3 s)" },
	{ ask: "Show the Moon circling the Earth", how: "planet earth on air at (0.9, 1.45), moon at (2.18, 1.45) primary earth, orbit_factor 1, seconds 14, stage x0 -0.6 x1 3.4 y0 -0.2 y1 3.0; goal orbits {item: moon, around: earth}" },
	{ ask: "Newton's cannon: one ball falls back, one orbits, one escapes", how: "planet earth scale low-orbit (1.27 m across), fixed, on air at (1.3, 1.0); three satellites kind cannonball size 0.03 stacked above its top at y 1.68, 1.74, 1.80 with orbit_factor 1.0, 0.7, 1.45 and primary earth; seconds 11; goals orbits, falls_in, escapes" },
	{ ask: "Mercury goes round the Sun faster than Earth", how: "sun (inner-planets) at the middle, mercury 0.387 m and earth 1.0 m out, orbit_factor 1; goals orbits for both (Mercury 4 turns in 9.1 s)" },
	{ ask: "Show the phases of the Moon", how: "sun {pulls: false} on air at the stage's left (x -0.35, y 1.45), earth at (1.6, 1.45), moon 1.28 m from it toward the Sun (x 0.32) with primary earth, orbit_factor 1, seconds 14.5; goals phase {item: moon, name: full moon, any: true} and orbits {item: moon}" },
	{ ask: "Things float in a space station", how: "settings {gravity: \"none\", air: true}; items stay where they are let go" },
	{ ask: "Show how a flagpole's shadow changes from 8 in the morning to 4 in the afternoon in Austin", how: "gnomon height 1 on the table, latitude 30.27, season march equinox, hour 8; settings {time_lapse: 3600}; seconds 8.5; goal shadow_length {item, m: 0.58, at_s: 4} (noon)" },
	{ ask: "Compare the noon shadow in June and December", how: "two gnomons side by side, hour 12, season june solstice and december solstice: 0.12 m vs 1.36 m at Austin" },
	{ ask: "Show day and night on a spinning globe lit by a lamp", how: "lamp at (0.25, 0) head_height 0.4, target globe; globe at (1.3, 0) spin_rpm 6, start_hour 6, town_lat 30.27; seconds 20; goal day_night {item: globe, days: 1}" },
	{ ask: "Why do we have seasons? Compare the noon Sun in June and December", how: "two runs of one scene (a globe in line with another would sit in its shadow): lamp at (0.25, 0) head_height 0.4 target globe; globe at (1.3, 0) town_lat 30.27, spin_rpm 6, seconds 10; run 1 lean \"toward the light\" (June: goal noon_sun {item: globe, deg: 83.17}), run 2 lean \"away from the light\" (December: noon_sun 36.29); or the whole year in one run: Earth round the Sun with seasons on" },
	{ ask: "Moon phases with a ball on a stick around a globe", how: "lamp at (0.2, 0) target globe; globe at (1.3, 0) spin_rpm 0; moon-ball at the globe's (1.3, 0.4) with around globe, radius 0.6, period_s 12, start_deg 0; seconds 12.5; goals phase {item: ball, name: full moon, any: true}, phase {item: ball, name: first quarter, any: true}" },
	{ ask: "Show a lunar eclipse with the classroom model", how: "as the phases model but the moon-ball tilt_deg 0 (level), start_deg 150, period_s 12, seconds 3; goal eclipse {type: lunar, item: ball, total: true}" },
	{ ask: "Show a total lunar eclipse with the real Sun, Earth and Moon", how: "sun {pulls: false} on air at (-0.45, 1.45), earth at (1.6, 1.45), moon at (2.88, 1.45) primary earth (the full side), node_deg 0, seconds 3 (the Moon's 1.28 m circle must clear the drawn Sun); goal eclipse {type: lunar, item: moon, total: true}" },
	{ ask: "Why isn't there an eclipse every month?", how: "sun {pulls: false} at (-0.45, 1.45), earth at (1.6, 1.45), moon at (2.88, 1.45) primary earth with its real tilt (5.145°, automatic) and node_deg 90; seconds 14.5 (a month); goals phase full moon any, phase new moon any, eclipse {type: lunar, item: moon, none: true}, eclipse {type: solar, item: moon, none: true}" },
	{ ask: "Why do we see different stars in winter and summer?", how: "the seasons scene below (sun at the middle, earth 1 m out with seasons true, start_date december solstice), seconds 9.7; goals night_sky {item: earth, constellation: Orion, at_s: 0} and night_sky {item: earth, constellation: Sagittarius, any: true}" },
	{ ask: "Show Earth's seasons as it goes around the Sun", how: "sun at (1.4, 1.45) (inner-planets scale), planet earth at (2.4, 1.45) primary sun with seasons true, start_date march equinox, town_lat 30.27; stage x0 0 x1 2.9 y0 0.2 y1 2.7 (Earth's 1 m orbit); seconds 9.7 (a year); goals noon_sun {item: earth, deg: 83.17, tol: 1, at_s: 2.78} (June) and orbits {item: earth}" }
]

// ---------------------------------------------------------------- the make-it-work search's aims (web/ai/fixer.js): the settings that put a missed
// classroom goal right, worked out from the run (tried first, checked like any other, never on what the person set)
const PHASE_AT = { "new moon": 0, "waxing crescent": 45, "first quarter": 90, "waxing gibbous": 135, "full moon": 180, "waning gibbous": 225, "last quarter": 270, "waning crescent": 315 }
const propOf = (scene, id, key, def) => {
	const it = (scene?.items ?? []).find((i) => i.id === id)
	const v = it?.props?.[key]
	return typeof v === "number" && Number.isFinite(v) ? v : def
}
const wrap360 = (x) => Math.round((((x % 360) + 360) % 360) * 10) / 10
const wrap24 = (x) => Math.round((((x % 24) + 24) % 24) * 4) / 4
/** A moon ball's start angle that shows the wanted phase at at_s (or, any: true, at the run's middle): its angle goes 360° a trip from start_deg. */
function aimPhase(g, entry, scene) {
	const it = (scene?.items ?? []).find((i) => i.id === g.item)
	if (it?.type !== "moon-ball") return []
	const want = PHASE_AT[phase_of(g.name ?? "") ?? ""]
	const period = propOf(scene, it.id, "period_s", 12)
	if (want === undefined || !(period > 0)) return []
	const at = Number.isFinite(g.at_s) ? g.at_s : (Number(scene?.seconds) || 4) / 2
	const from = propOf(scene, it.id, "start_deg", 0)
	const to = wrap360(want - (360 * at) / period)
	return Math.abs(to - from) < 0.05 ? [] : [{ changes: [{ kind: "prop", id: it.id, key: "start_deg", from, to }], cost: 0.5 }]
}
/** A globe's start time that puts its town at noon (day) or midnight (night) at at_s, or starts it at midnight so the run holds n days. */
function aimDayNight(g, entry, scene) {
	const it = (scene?.items ?? []).find((i) => i.id === g.item)
	if (it?.type !== "globe") return []
	const rpm = propOf(scene, it.id, "spin_rpm", 6)
	const from = propOf(scene, it.id, "start_hour", 6)
	const T = Number(scene?.seconds) || 4
	let to
	if (Number.isFinite(g.days) && g.days > 0) {
		// (from midnight the first sunrise comes about a quarter turn in, the n-th sunset n − ¼ turns in: the run must hold that many turns)
		if ((rpm * T) / 60 < g.days - 0.2) return []
		to = 0
	} else {
		const night = ["night", "dark", "night time", "nighttime"].includes(String(g.is ?? "day").trim().toLowerCase())
		const at = Number.isFinite(g.at_s) ? g.at_s : T
		to = wrap24((night ? 0 : 12) - (24 * rpm * at) / 60)
	}
	return Math.abs(to - from) < 0.01 ? [] : [{ changes: [{ kind: "prop", id: it.id, key: "start_hour", from, to }], cost: 0.5 }]
}
/** The town's latitude where the noon Sun stands deg high, from where the run had the light overhead (90° − |φ − δ| = deg). */
function aimNoonSun(g, entry, scene, sim) {
	const it = (scene?.items ?? []).find((i) => i.id === g.item)
	if (!(it?.type === "globe" || it?.type === "planet") || !Number.isFinite(g.deg)) return []
	const dec = sim?.track?.state?.[it.id]?.sun_lat
	if (!dec?.length) return []
	const k = Number.isFinite(g.at_s) && sim.track.frames?.length ? sim.track.frames.findIndex((f) => f.t >= g.at_s - 1e-9) : dec.length - 1
	const d = dec[k < 0 ? dec.length - 1 : k]
	const from = propOf(scene, it.id, "town_lat", 30.27)
	const cands = [d + (90 - g.deg), d - (90 - g.deg)].filter((x) => x >= -90 && x <= 90).sort((a, b) => Math.abs(a - from) - Math.abs(b - from))
	if (!cands.length) return []
	const to = Math.round(cands[0] * 100) / 100
	return Math.abs(to - from) < 0.01 ? [] : [{ changes: [{ kind: "prop", id: it.id, key: "town_lat", from, to }], cost: 1 }]
}

export const plugin = {
	title: "Gravity and space (other worlds, orbits, the Moon's phases, eclipses, seasons, day and night on a globe)",
	howto: HOWTO,
	prompt: { plan: PROMPT_PLAN, edit: PROMPT_EDIT, refine: PROMPT_REFINE },
	examples: EXAMPLES,
	goals: [
		{
			kind: "shadow_length", aliases: ["shadow", "shadow_is", "shadow_length_m"], fields: { item: "item", m: "number", tol: "number?", at_s: "number?" },
			about: "shadow_length {item: gnomon, m, tol?, at_s?}: the shadow stick's shadow is m metres long (within tol, default 2 cm) at the end or at at_s (the clock runs at the scene's time_lapse)",
			label: (g, n) => `${n(g.item)}'s shadow is ${g.m} m long${Number.isFinite(g.at_s) ? ` at ${g.at_s} s` : " at the end"}`,
			summarize: (ctx, g) => goal_shadow_length(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "gnomon")
				return xs.length ? { kind: "shadow_length", item: pick(xs).id, m: pick([0.58, 1.3, 0.12, 2]), ...(pick([true, false]) ? { at_s: pick([0, 1, 4]) } : {}), ...(pick([true, false]) ? { tol: 0.05 } : {}) } : null
			}
		},
		{
			kind: "orbits", aliases: ["orbit", "circles", "goes_around", "revolves"], fields: { item: "item", around: "item?", turns: "number?" },
			about: "orbits {item, around?, turns?}: it completes `turns` (default 1) turns round what it circles without falling in (orbit mode)",
			label: (g, n) => `${n(g.item)} circles ${g.around ? n(g.around) : "what it circles"}${Number.isFinite(g.turns) && g.turns !== 1 ? ` ${g.turns} times` : " once"}`,
			summarize: (ctx, g) => goal_orbits(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => ["planet", "moon", "satellite"].includes(i.type))
				return xs.length ? { kind: "orbits", item: pick(xs).id, ...(pick([true, false]) ? { turns: pick([0.5, 1, 2]) } : {}) } : null
			}
		},
		{
			kind: "falls_in", aliases: ["falls_into", "crashes", "falls_onto", "falls_back"], fields: { item: "item", into: "item?" },
			about: "falls_in {item, into?}: it falls onto `into` (default: what it circles), e.g. a satellite launched too slowly",
			label: (g, n) => `${n(g.item)} falls onto ${g.into ? n(g.into) : "what it circles"}`,
			summarize: (ctx, g) => goal_falls_in(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => ["planet", "moon", "satellite"].includes(i.type))
				return xs.length ? { kind: "falls_in", item: pick(xs).id } : null
			}
		},
		{
			kind: "escapes", aliases: ["escape", "flies_away", "leaves_orbit"], fields: { item: "item" },
			about: "escapes {item}: at the end it is leaving what it circled for good (faster than escape speed, moving away)",
			label: (g, n) => `${n(g.item)} escapes`,
			summarize: (ctx, g) => goal_escapes(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => ["planet", "moon", "satellite"].includes(i.type))
				return xs.length ? { kind: "escapes", item: pick(xs).id } : null
			}
		},
		{
			kind: "lands_together", aliases: ["land_together", "fall_together", "falls_together", "same_time"], fields: { a: "item", b: "item", tol_s: "number?" },
			subject: ["a", "b"],
			about: "lands_together {a, b, tol_s?}: the two first land (strike anything but each other) within tol_s (default 0.02 s) of each other (a vacuum drop)",
			label: (g, n) => `${n(g.a)} and ${n(g.b)} land together`,
			summarize: (ctx, g) => goal_lands_together(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => F.TYPES[i.type]?.dynamic)
				return xs.length > 1 ? { kind: "lands_together", a: xs[0].id, b: pick(xs.slice(1)).id, ...(pick([true, false]) ? { tol_s: 0.05 } : {}) } : null
			}
		},
		{
			kind: "lands_first", aliases: ["lands_before", "falls_faster", "first_to_land"], fields: { a: "item", b: "item" },
			subject: ["a"],
			about: "lands_first {a, b}: a lands (strikes anything but b) at least 0.02 s before b (air slows the light, broad one)",
			label: (g, n) => `${n(g.a)} lands before ${n(g.b)}`,
			summarize: (ctx, g) => goal_lands_first(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => F.TYPES[i.type]?.dynamic)
				return xs.length > 1 ? { kind: "lands_first", a: xs[0].id, b: pick(xs.slice(1)).id } : null
			}
		},
		{
			kind: "phase", aliases: ["moon_phase", "shows_phase"], fields: { item: "item", name: "string", at_s: "number?", any: "bool?" },
			about: "phase {item: moon, name, at_s?, any?}: the moon shows that phase as its planet sees it (needs a sun in the scene), at the end, at at_s, or any: true at some moment",
			label: (g, n) => `${n(g.item)} shows a ${g.name}${g.any === true ? " at some moment" : Number.isFinite(g.at_s) ? ` at ${g.at_s} s` : " at the end"}`,
			summarize: (ctx, g) => goal_phase(ctx, g),
			aim: (g, entry, scene) => aimPhase(g, entry, scene),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "moon")
				return xs.length ? { kind: "phase", item: pick(xs).id, name: pick(PHASE_NAMES.concat(["full", "new", "bogus"])), ...(pick([true, false]) ? { any: true } : {}), ...(pick([true, false]) ? { at_s: pick([1, 2.5, 4]) } : {}) } : null
			}
		},
		{
			kind: "day_night", aliases: ["daytime", "is_day", "day_and_night", "sunrise", "night"], fields: { item: "item", is: "string?", at_s: "number?", days: "number?" },
			about: "day_night {item: globe, is?: \"day\"|\"night\", at_s?, days?}: it is day (or night) at the globe's town at at_s (default the end); with days n: the town sees n sunrises and n sunsets",
			label: (g, n) => (Number.isFinite(g.days) ? `${n(g.item)}'s town goes through ${g.days} days and nights` : `It is ${g.is === "night" ? "night" : "day"} at ${n(g.item)}'s town${Number.isFinite(g.at_s) ? ` at ${g.at_s} s` : " at the end"}`),
			summarize: (ctx, g) => goal_day_night(ctx, g),
			aim: (g, entry, scene) => aimDayNight(g, entry, scene),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "globe")
				return xs.length ? { kind: "day_night", item: pick(xs).id, ...(pick([true, false]) ? { is: pick(["day", "night", "dark", "noon"]) } : {}), ...(pick([true, false]) ? { at_s: pick([0, 1, 2.5]) } : {}), ...(pick([true, false, false]) ? { days: pick([1, 2, 0.5]) } : {}) } : null
			}
		},
		{
			kind: "eclipse", aliases: ["eclipses", "an_eclipse"], fields: { type: "string", item: "item", total: "bool?", central: "bool?", none: "bool?", at_s: "number?" },
			subject: ["item"],
			about: "eclipse {type: \"solar\"|\"lunar\", item: the moon or moon-ball, total?, central? (solar: annular or total), none? (it never happens), at_s?}: that eclipse happens during the run (or at at_s): the moon's shadow on its planet or globe (solar), the planet's or globe's shadow on the moon (lunar)",
			label: (g) => `${g.none === true ? "No" : "A"} ${g.total === true ? "total " : ""}${g.type} eclipse happens`,
			summarize: (ctx, g) => goal_eclipse(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "moon" || i.type === "moon-ball")
				return xs.length ? { kind: "eclipse", type: pick(["solar", "lunar", "sun", "bogus"]), ...(pick([true, true, false]) ? { item: pick(xs).id } : {}), ...(pick([true, false]) ? { total: true } : {}), ...(pick([true, false, false]) ? { central: true } : {}), ...(pick([true, false, false]) ? { none: true } : {}), ...(pick([true, false, false]) ? { at_s: pick([0.5, 2]) } : {}) } : null
			}
		},
		{
			kind: "solar_eclipse", aliases: ["eclipse_of_the_sun", "moon_shadow_on_earth"], fields: { item: "item", total: "bool?", central: "bool?", none: "bool?", at_s: "number?" },
			about: "solar_eclipse {item: the moon or moon-ball, total?, central?, none?, at_s?}: its shadow falls on its planet (the globe) during the run",
			label: (g) => `${g.none === true ? "No" : "A"} ${g.total === true ? "total " : ""}solar eclipse happens`,
			summarize: (ctx, g) => goal_solar_eclipse(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "moon" || i.type === "moon-ball")
				return xs.length ? { kind: "solar_eclipse", ...(pick([true, false]) ? { item: pick(xs).id } : {}), ...(pick([true, false]) ? { total: true } : {}), ...(pick([true, false]) ? { none: true } : {}) } : null
			}
		},
		{
			kind: "lunar_eclipse", aliases: ["eclipse_of_the_moon", "blood_moon"], fields: { item: "item", total: "bool?", none: "bool?", at_s: "number?" },
			about: "lunar_eclipse {item: the moon or moon-ball, total?, none?, at_s?}: its planet's (the globe's) shadow falls on it during the run",
			label: (g) => `${g.none === true ? "No" : "A"} ${g.total === true ? "total " : ""}lunar eclipse happens`,
			summarize: (ctx, g) => goal_lunar_eclipse(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "moon" || i.type === "moon-ball")
				return xs.length ? { kind: "lunar_eclipse", ...(pick([true, false]) ? { item: pick(xs).id } : {}), ...(pick([true, false]) ? { total: true } : {}), ...(pick([true, false]) ? { none: true } : {}), ...(pick([true, false]) ? { at_s: pick([0, 1.5]) } : {}) } : null
			}
		},
		{
			kind: "noon_sun", aliases: ["noon_elevation", "sun_height", "noon_sun_height"], fields: { item: "item", deg: "number", tol: "number?", at_s: "number?" },
			about: "noon_sun {item: globe | planet with seasons, deg, tol? (default 1), at_s?}: the noon Sun's height at its town is deg degrees (at the end or at at_s)",
			label: (g, n) => `The noon Sun at ${n(g.item)}'s town is ${g.deg}° up${Number.isFinite(g.at_s) ? ` at ${g.at_s} s` : " at the end"}`,
			summarize: (ctx, g) => goal_noon_sun(ctx, g),
			aim: (g, entry, scene, sim) => aimNoonSun(g, entry, scene, sim),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "globe" || i.type === "planet")
				return xs.length ? { kind: "noon_sun", item: pick(xs).id, deg: pick([59.73, 83.17, 36.29, 90]), ...(pick([true, false]) ? { tol: pick([0.5, 3]) } : {}), ...(pick([true, false]) ? { at_s: pick([0, 1, 3]) } : {}) } : null
			}
		},
		{
			kind: "night_sky", aliases: ["midnight_sky", "constellation", "stars_at_night", "seen_at_night"], fields: { item: "item", constellation: "string", at_s: "number?", any: "bool?" },
			about: "night_sky {item: a planet with seasons, constellation, at_s?, any?}: that constellation stands highest at midnight (opposite the Sun along the ecliptic: the zodiac's 13, and Orion) at the end, at at_s, or any: true at some moment: the stars change with the seasons",
			label: (g, n) => `${String(g.constellation ?? "a constellation")} is high in ${n(g.item)}'s midnight sky${g.any === true ? " at some moment" : Number.isFinite(g.at_s) ? ` at ${g.at_s} s` : " at the end"}`,
			summarize: (ctx, g) => goal_night_sky(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "planet")
				return xs.length ? { kind: "night_sky", item: pick(xs).id, constellation: pick(["Orion", "gemini", "Sagittarius", "virgo", "scorpio", "pisces", "bogus"]), ...(pick([true, false]) ? { any: true } : {}), ...(pick([true, false]) ? { at_s: pick([0, 2, 5]) } : {}) } : null
			}
		}
	],
	knobs: [
		{ type: "gnomon", key: "hour", how: "abs", steps: [0.25, 0.5, 1, 2, 3], cost: 1, more: "set {it}'s clock later", less: "set {it}'s clock earlier", why: "the shadow is shortest at solar noon (12) and longer earlier and later; it points west in the morning, east in the afternoon" },
		{ type: "gnomon", key: "height", how: "rel", cost: 2, more: "make {it} taller", less: "make {it} shorter", why: "the shadow grows in proportion to the stick's height (shadow = height / tan(sun's height))" },
		{ type: "gnomon", key: "season", how: "choice", cost: 3, more: "set {it} on another date", less: "set {it} on another date", why: "the noon Sun is highest at the June solstice in the north (shortest noon shadow), lowest in December" },
		KNOB_ORBIT("satellite"), KNOB_ORBIT("moon"), KNOB_ORBIT("planet"), KNOB_MASS("planet"), KNOB_MASS("sun"), KNOB_MASS("moon"),
		{ type: "moon", key: "primary", how: "link", cost: 3, more: "launch {it} round another body", less: "launch {it} round another body", why: "a body is launched round its primary only" },
		{ type: "satellite", key: "primary", how: "link", cost: 3, more: "launch {it} round another body", less: "launch {it} round another body", why: "a body is launched round its primary only" },
		{ type: "moon", key: "node_deg", how: "abs", steps: [5, 10, 30, 60, 90], cost: 2, more: "turn {it}'s line of nodes further round from the Sun", less: "turn {it}'s line of nodes back toward the Sun", why: "eclipses come only when the Moon's tilted orbit crosses the Earth's near the Sun line: nodes at 0 or 180° from the Sun give eclipses at this new and full moon, 90° none" },
		{ type: "moon", key: "orbit_tilt", how: "abs", steps: [1, 2, 5.145], cost: 8, more: "tilt {it}'s orbit more", less: "tilt {it}'s orbit less", why: "the real Moon's orbit is tilted 5.145°: flatter, it is eclipsed every month (change it only when asked)" },
		{ type: "planet", key: "start_date", how: "choice", cost: 2, more: "start {it} on another date", less: "start {it} on another date", why: "where it is in its year at the start: the June solstice leans its north pole toward the Sun (the noon Sun highest), December's away" },
		{ type: "planet", key: "town_lat", how: "abs", steps: [5, 10, 20, 30], cost: 3, more: "move {it}'s town north", less: "move {it}'s town south", why: "the noon Sun is 90° − |latitude − where the Sun is overhead| high" },
		{ type: "globe", key: "start_hour", how: "abs", steps: [0.5, 1, 2, 3, 6], cost: 1, more: "set {it}'s town later in its day", less: "set {it}'s town earlier in its day", why: "the town's solar time at the start: 6 sunrise, 12 noon (the light highest), 18 sunset, 0 midnight" },
		{ type: "globe", key: "spin_rpm", how: "rel", cost: 2, more: "spin {it} faster", less: "spin {it} slower", why: "one turn is one day and one night: faster turns pass more days in the run" },
		{ type: "globe", key: "lean", how: "choice", cost: 3, more: "lean {it}'s north pole another way", less: "lean {it}'s north pole another way", why: "toward the light: the north's summer (the noon light high, long days); away: its winter; to the side: an equinox" },
		{ type: "globe", key: "town_lat", how: "abs", steps: [5, 10, 20, 30], cost: 3, more: "move {it}'s town north", less: "move {it}'s town south", why: "nearer the pole leaning toward the light the days are longer and the noon light higher" },
		{ type: "globe", key: "tilt_deg", how: "abs", steps: [5, 10, 23.44], cost: 5, more: "tilt {it}'s axis more", less: "tilt {it}'s axis less", why: "the Earth's is 23.44°: with none there are no seasons (the light overhead at the equator all year)" },
		{ type: "moon-ball", key: "start_deg", how: "abs", steps: [15, 45, 90, 180], cost: 1, more: "start {it} further round", less: "start {it} less far round", why: "0 between the light and the globe (new moon), 90 first quarter, 180 behind the globe (full), 270 last quarter" },
		{ type: "moon-ball", key: "period_s", how: "rel", cost: 2, more: "carry {it} round more slowly", less: "carry {it} round faster", why: "one trip round is one month of phases: a longer trip shows each phase longer" },
		{ type: "moon-ball", key: "tilt_deg", how: "abs", steps: [5, 10, 20, 30], cost: 2, more: "carry {it} on a steeper circle", less: "carry {it} on a flatter circle", why: "a level circle puts the ball in the globe's shadow at full (a lunar eclipse) and its shadow on the globe at new (a solar one); tilted 30° it misses both" },
		{ type: "moon-ball", key: "node_deg", how: "abs", steps: [15, 45, 90], cost: 2, more: "turn {it}'s tilted circle further round", less: "turn {it}'s tilted circle back", why: "where the tilted circle crosses the level one: 90° from the light keeps it out of the shadows, 0 or 180 lines the crossings up with the light (eclipses)" },
		{ type: "moon-ball", key: "radius", how: "rel", cost: 3, more: "carry {it} further out", less: "carry {it} nearer", why: "further from the globe the globe's shadow and the ball's matter less" }],
	digest: (item, sim) => digestLines(item, sim),
	// (a moon ball is carried in the air on its stick round the globe's middle: the solver must not call it floating)
	place: { held: (type) => type === "moon-ball" },
	words: {
		change: changeWords,
		// (the bodies' names as proper nouns in a sentence: "made the Earth heavier", "Mars", never "the earth" or "the mars")
		proper: {
			Earth: "the Earth", "the Earth": "the Earth", Moon: "the Moon", "the Moon": "the Moon", Sun: "the Sun", "the Sun": "the Sun",
			Mercury: "Mercury", Venus: "Venus", Mars: "Mars", Jupiter: "Jupiter", Saturn: "Saturn", Uranus: "Uranus", Neptune: "Neptune", Pluto: "Pluto",
			Io: "Io", Europa: "Europa", Ganymede: "Ganymede", Callisto: "Callisto", Titan: "Titan", Phobos: "Phobos", Deimos: "Deimos"
		},
		// (the scene's gravity in real terms: "gravity Earth → the Moon (g 9.81 → 1.62 m/s²)")
		setting: (key, a, b) => {
			if (key === "air_density") {
				// (a world's own air: "air density 1.2 → 0.02 kg/m³ (Mars's thin air)")
				const AIRS = [[0.02, "Mars's thin air"], [65, "Venus's thick air"], [0.16, "Jupiter's air"], [0.19, "Saturn's air"], [0.45, "Neptune's air"], [1.2, "a room's air"]]
				const d = (x) => (typeof x === "number" ? x : 1.2)
				const what = AIRS.find(([v]) => v === d(b))?.[1]
				return `air density ${fmtNum(d(a))} → ${fmtNum(d(b))} kg/m³${what ? ` (${what})` : ""}`
			}
			if (key !== "gravity") return null
			const gOf = (x) => (x === undefined || x === null ? 9.81 : typeof x === "string" ? ({ earth: 9.81, moon: 1.62, mars: 3.71, jupiter: 24.79, none: 0 })[x.toLowerCase()] ?? null : x)
			const nameOf = (g) => (g === null ? "?" : (PLACES.find(([, , gv]) => gv === g)?.[0] ?? `${g} m/s²`).replace(/ \(.*\)$/, ""))
			const ga = gOf(a)
			const gb = gOf(b)
			return `gravity ${nameOf(ga)} → ${nameOf(gb)} (g ${ga ?? "?"} → ${gb ?? "?"} m/s²)`
		},
		// (what names each setting in a request: "make the Earth half as heavy" is the person's own choice of mass_scale, kept by every fix)
		keys: {
			mass_scale: "heav\\w*|light(?:er)?|weigh\\w*|mass(?:ive)?|pull\\w*",
			orbit_factor: "fast\\w*|slow\\w*|speed|launch\\w*|fire[sd]?|throw\\w*|orbit speed",
			direction: "other way|clockwise|counter-?clockwise|direction|backwards?|revers\\w*",
			primary: "around|round|circl\\w*|orbit\\w*",
			body: "planet|world",
			diameter: "big|bigger|small|smaller|size|diameter|across|large|larger|tiny|huge",
			"globe.spin_rpm": "spin\\w*|turn\\w*|rotat\\w*|fast\\w*|slow\\w*",
			"globe.start_hour": "time|clock|o'?clock|morning|noon|evening|midnight|hour|dawn|dusk|sunrise|sunset",
			"globe.lean": "lean\\w*|tip\\w*|toward|away|summer|winter|solstice|equinox|june|december|season\\w*",
			"globe.town_lat": "latitude|town|city|north\\w*|south\\w*|equator|pole",
			"globe.tilt_deg": "tilt\\w*|axis|upright|straight",
			"moon-ball.start_deg": "start\\w*|phase|new moon|full moon|quarter|crescent|gibbous",
			"moon-ball.period_s": "slow\\w*|fast\\w*|month|trip|speed|quick\\w*",
			"moon-ball.tilt_deg": "tilt\\w*|level|flat\\w*|steep\\w*|higher|lower|above|below",
			"moon-ball.node_deg": "node\\w*",
			"moon-ball.radius": "far\\w*|near\\w*|closer|distance",
			"moon.orbit_tilt": "tilt\\w*|inclin\\w*|flat\\w*|level",
			"moon.node_deg": "node\\w*",
			"planet.seasons": "season\\w*",
			"planet.start_date": "date|solstice|equinox|june|december|march|september|summer|winter|spring|autumn|fall",
			"planet.town_lat": "latitude|town|city|north\\w*|south\\w*|equator"
		}
	}
}
