// The optics module's port (machines/mod_optics.py, line for line: the same document, number for number) and its plug-ins (goal kinds, the
// AI's digest, prompts, knobs and words). A module file takes everything from the framework object register_all gets (web/sim/items.js
// FRAMEWORK), so it imports nothing. Values and their sources: see machines/mod_optics.py.
let F = null

const CAT = "Light & optics"
const GLASS_ND = { "crown glass": 1.5168, "flint glass": 1.62004, acrylic: 1.4917 }
const GLASS_DENSITY = { "crown glass": 2510, "flint glass": 3610, acrylic: 1190, water: 998 }
const BLOCK_MEDIA = ["crown glass", "flint glass", "acrylic", "water"]
const TORCH_LIGHT = { white: "led", red: "led-red", green: "led-green", blue: "led-blue" }
const TORCH_LUMENS = { white: 150.0, red: 40.0, green: 100.0, blue: 10.0 }
const MORSE = {
	A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---",
	P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..", 0: "-----", 1: ".----", 2: "..---",
	3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----."
}
const MORSE_TEXT = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]))
const REPEAT_GAP = 10
const LIQUID_MEDIUM = { water: "water", "salt water": "salt water", "sea water": "sea water", "vegetable oil": "vegetable oil", "corn syrup": "corn syrup", honey: "honey", "dish soap": "dish soap", "rubbing alcohol": "rubbing alcohol" }
const LIQUID_OVER = 1e-5
const BULB_LM_PER_W = 8.4
const BULB_IR_PER_W = 0.77
const LED_LUMENS = { red: 0.5, yellow: 0.5, green: 1.5, blue: 0.4, white: 4.0 }
const LED_LIGHT = { red: "led-red", yellow: "led-yellow", green: "led-green", blue: "led-blue", white: "led" }
const LED_HALF = 0.261799
const LASER_NM = { red: 650.0, green: 532.0, violet: 405.0 }
const FILTERS = {
	red: [0.02, 0.02, 0.02, 0.02, 0.05, 0.45, 0.88, 0.9],
	orange: [0.02, 0.02, 0.02, 0.05, 0.4, 0.85, 0.88, 0.9],
	yellow: [0.02, 0.03, 0.1, 0.8, 0.88, 0.88, 0.88, 0.9],
	green: [0.02, 0.1, 0.6, 0.85, 0.4, 0.05, 0.02, 0.6],
	cyan: [0.3, 0.85, 0.88, 0.8, 0.2, 0.03, 0.02, 0.6],
	blue: [0.7, 0.85, 0.4, 0.05, 0.02, 0.02, 0.02, 0.6],
	violet: [0.85, 0.5, 0.05, 0.02, 0.02, 0.02, 0.1, 0.6],
	magenta: [0.8, 0.7, 0.1, 0.02, 0.05, 0.4, 0.88, 0.9]
}
const FILTER_COLOR = { red: "#d81e1e", orange: "#f07818", yellow: "#f2d21b", green: "#1fa83a", cyan: "#1cb8c8", blue: "#2348d8", violet: "#7a2bd0", magenta: "#d42aa8" }
const PANELS = {
	"clear glass": { t: 0.003, role: "glass", medium: "crown glass", color: "#cfe6ec", material: "optical glass" },
	"clear plastic": { t: 0.003, role: "glass", medium: "acrylic", color: "#e2eef0", material: "optical glass" },
	"frosted glass": { t: 0.003, role: "translucent", transmit: 0.8, blur: 0.6, color: "#e6eef0", material: "optical glass" },
	"wax paper": { t: 0.001, role: "translucent", transmit: 0.5, blur: 0.8, color: "#f1ead2", material: "card" },
	"tissue paper": { t: 0.001, role: "translucent", transmit: 0.4, blur: 1.0, color: "#f6f4ee", material: "card" },
	"white card": { t: 0.002, role: "opaque", color: "#ecebe4", material: "card" },
	cardboard: { t: 0.004, role: "opaque", color: "#c9a26b", material: "card" },
	"aluminium foil": { t: 0.001, role: "mirror", reflect: 0.8, color: "#d0d4d8", material: "aluminium" },
	"black cloth": { t: 0.002, role: "opaque", color: "#151515", material: "card" },
	wood: { t: 0.006, role: "opaque", color: "#c8955a", material: "card" }
}
const LAMP_LIGHT = { incandescent: "incandescent", halogen: "halogen", led: "led" }
const MEDIUM_OF_MATERIAL = { glass: "crown glass", PET: "PET", ice: "ice", "glass marble": "crown glass", "optical glass": "crown glass", "flint glass": "flint glass", acrylic: "acrylic", water: "water" }
const MEDIUM_OF_LOOK = { glass: "crown glass", ice: "ice", marble: "crown glass", water: "water", "lens glass": "crown glass" }
const TRANSLUCENT_MATERIAL = { "tissue paper": [0.4, 1.0] }
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

const HEAT_KINDS = new Set()

export function register_all(f) {
	F = f
	HEAT_KINDS.clear()
	if (F.TYPES.lamp !== undefined && F.TYPES.lamp.module === "heat") HEAT_KINDS.add("heat")
	if (!F.CATEGORIES.includes(CAT)) F.CATEGORIES.push(CAT)
	_looks()
	_materials()
	_types()
	F.register_build_hook(build_hook)
}

function _looks() {
	const look = (key, kw) => {
		if (!(key in F.LOOK_FILL)) F.add_look(key, kw)
	}
	look("mirror", { fill: "#d9dee3", shade: "#9aa3ab", roughness: 0.03, metalness: 1.0, clearcoat: 1.0 })
	look("lens glass", { fill: "#d8eef4", shade: "#9cc7d4", roughness: 0.02, metalness: 0.0, clearcoat: 1.0, transmission: 0.95, ior: 1.52, thickness: 0.01 })
	look("dark plastic", { fill: "#2b2f36", shade: "#16181c", roughness: 0.4, metalness: 0.0, clearcoat: 0.3 })
	look("white card", { fill: "#e8e6df", shade: "#bdbab0", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 })
	look("gel", { fill: "#d81e1e", shade: "#9a1414", roughness: 0.1, metalness: 0.0, clearcoat: 0.6, transmission: 0.6, ior: 1.45, thickness: 0.001 })
	look("sun", { fill: "#ffd34d", shade: "#f0a020", roughness: 0.5, metalness: 0.0, clearcoat: 0.0 })
}

function _materials() {
	const mat = (name, kw, ints = ["density"]) => {
		if (!(name in F.MATERIALS)) F.define_material(name, { rolling: 0.0, side: 0.0, ...kw }, ints)
	}
	mat("optical glass", { density: 2510, bounce: 0.9, friction: 0.4, rolling: 0.001, side: 0.1, look: "lens glass", source: "N-BK7 crown glass 2510 kg/m³ (SCHOTT data sheet); glass on glass friction about 0.4 (Engineering ToolBox); bounce provisional." })
	mat("mirror glass", { density: 2500, bounce: 0.9, friction: 0.4, rolling: 0.001, side: 0.1, look: "mirror", source: "Soda-lime glass 2500 kg/m³, back-silvered; friction and bounce as glass (provisional)." })
	mat("ABS housing", { density: 1050, bounce: 0.5, friction: 0.35, rolling: 0.004, look: "dark plastic", source: "ABS plastic 1040-1060 kg/m³ (a torch's or meter's housing; friction and bounce provisional)." })
	mat("card", { density: 700, bounce: 0.3, friction: 0.5, rolling: 0.01, look: "white card", source: "Card stock about 700 kg/m³ (300 g/m², 0.4 mm); provisional." })
}

const _f = (name, P) => Number(P[name])

// Each type's sources and its one-line facts (the catalog's cards): machines/mod_optics.py INFO
const INFO = {
	"flashlight": ["2 × AA LED torch; 150 lm, 20° beam typical.",
		"150 lm · 20° beam · 15 cm long"],
	"laser-pointer": ["Class 2 laser pointer, 1 mW, beam Ø 1.5 mm, 1 mrad [IEC60825].",
		"1 mW · red 650 nm · beam Ø 1.5 mm"],
	"mirror": ["Back-silvered glass mirror, about 90 % of visible light reflected; angle of incidence = angle of reflection (Hecht, Optics, §4.3).",
		"20 cm · 90 % reflected · one shiny face"],
	"curved-mirror": ["Spherical mirror: f = R/2 for rays near its axis (Hecht, Optics, §5.4).",
		"Concave · f 15 cm · Ø 10 cm"],
	"convex-lens": ["Thick-lens lensmaker's equation (Hecht, Optics, §5.2); N-BK7 nd 1.5168, F2 1.62004 (SCHOTT data sheets).",
		"f 10 cm · Ø 5 cm · crown glass"],
	"concave-lens": ["Thick-lens lensmaker's equation (Hecht, Optics, §5.2); N-BK7 nd 1.5168, F2 1.62004 (SCHOTT data sheets).",
		"f −10 cm · Ø 5 cm · crown glass"],
	"prism": ["60° prism, minimum deviation (Hecht, Optics, §5.5); N-BK7 and F2 Sellmeier coefficients (SCHOTT data sheets).",
		"60° · 5 cm edges · crown glass"],
	"glass-block": ["Snell's law and the Fresnel equations (Hecht, Optics, §4.4-4.6); N-BK7 (SCHOTT data sheet).",
		"10 × 6 cm · 2 cm deep · n 1.52"],
	"semicircle-block": ["Critical angle asin(1/n) = 41.2° for N-BK7 at 589 nm (Hecht, Optics, §4.7; SCHOTT data sheet).",
		"Radius 5 cm · critical angle 41°"],
	"color-filter": ["Lighting gel: about 85-90 % of its own colour through, about 2 % of the others (typical gel transmission curves; provisional).",
		"Red · 88 % of red through · 2 % of green"],
	"material-panel": ["Clear glass ≈ 92 % through (two 4 % reflections, Hecht, Optics, §4.6); wax paper, tissue and frosted glass provisional; black cloth absorbs ≈ 0.97, white card ≈ 0.2 (Incropera, Table A.12).",
		"10 × 10 cm · clear glass lets 92 % through"],
	"screen": ["White card: a diffuse (Lambertian) surface reflecting about 80 % of visible light (provisional).",
		"30 cm tall · white card · both faces"],
	"light-meter": ["Lux: lumens per m², 683 lm/W at 555 nm weighted by the CIE 1924 V(λ) curve (CIE); clear noon sun about 100 000 lx, a room 300 lx.",
		"Reads lux · 1 cm sensor · lit above 10 lx"],
	"light-sensor": ["A target board that counts the light power reaching either face, in mW (a photodiode's reading; provisional size).",
		"Ø 10 cm · either face counts"],
	"eye": ["We see a thing when light from it enters the eye's pupil, 2-8 mm across (Hecht, Optics, §5.7).",
		"Ø 2.4 cm · sees 120° wide"],
	"sunlight": ["Clear-sky noon sunlight 1000 W/m² (ASTM G173, AM1.5), about 100 000 lx; the sun's disc 0.53° across.",
		"1000 W/m² · 45° high · parallel rays"],
	"lit-arrow": ["An optics-bench object: a lit arrow whose every point sends light on (provisional brightness).",
		"5 cm arrow · 40 lm"],
}

function _types() {
	const { register, ItemType, Prop, Readout } = F
	const T = (key, name, build, props, description, o = {}) =>
		register(
			new ItemType(key, name, CAT, build, {
				props, readouts: o.readouts ?? [], links: o.links ?? [], tags: o.tags ?? [], description, anchor: o.anchor ?? "its centre", dynamic: false,
				edit: [{ kind: "rotate" }], source: o.source || INFO[key][0], facts: INFO[key][1], module: "optics"
			})
		)
	const aim = (d, what) => new Prop("aim", "Aim", d, -360.0, 360.0, 0.5, "°", what)
	const on_props = () => [new Prop("on", "On", true, { kind: "bool", help: "Whether it shines" }), new Prop("on_at", "On at", 0.0, 0.0, 20.0, 0.1, "s", "When it is switched on (seconds into the run)")]
	T("flashlight", "Flashlight", build_flashlight,
		[new Prop("lumens", "Brightness", 150.0, 5.0, 1000.0, 5.0, "lm", "Its rated light output (a pocket torch 50-200 lm); a coloured one follows its colour " +
				"until set (red 40, green 100, blue 10 lm: together they make white)", { auto: ["color"] }),
			new Prop("beam_angle", "Beam spread", 20.0, 5.0, 60.0, 1.0, "°", "The full width of its cone of light"),
			aim(0.0, "Which way it shines: 0 = right, 90 = up, 180 = left, -90 = down"), ...on_props(),
			new Prop("color", "Light colour", "white", { kind: "choice", choices: Object.keys(TORCH_LIGHT), help: "White LED, or a one-colour red, green or blue LED (mix them on a white screen; each casts its own coloured shadow)" }),
			new Prop("pattern", "Blink", "steady", { kind: "choice", choices: ["steady", "SOS", "HI", "101", "1100"], open: true, help: "steady; a word sent in Morse code (letters and digits: a dash is 3 dots); or 1s and 0s, one dot-length each (1 on, 0 off)" }),
			new Prop("dot_s", "Dot length", 0.2, 0.05, 2.0, 0.05, "s", "How long one Morse dot (one 1 or 0) lasts"),
			new Prop("repeat", "Repeat", true, { kind: "bool", help: "Send the pattern again and again (10 dot-lengths of dark between)" })],
		"An LED flashlight (torch), 15 cm long, on a stand. Its beam leaves its lens end in the direction `aim` (degrees: 0 = to the right, " +
			"90 = straight up, 180 = left). A cone of white light that spreads and dims with distance (1/d²). `color` red, green or blue makes a " +
			"one-colour torch: on a white screen red + green look yellow, red + blue magenta, green + blue cyan, all three white, and an object " +
			"lit by two of them casts two coloured shadows. `pattern` makes it blink a message (Morse code of a word such as SOS, or 1s and 0s of " +
			"dot_s each): a light-sensor (or light-meter) it shines on counts the flashes (`pulses`) and the goal receives {sensor, light} reads " +
			"the message back.",
		{ readouts: [new Readout("on", "On", { unit: "", digits: 0 })], tags: ["torch", "light", "beam", "lamp", "coloured light", "blink", "signal", "morse code"], source: "2 × AA LED torch; 150 lm, 20° beam typical." })
	T("laser-pointer", "Laser pointer", build_laser,
		[new Prop("color", "Colour", "red", { kind: "choice", choices: ["red", "green", "violet"], help: "Red 650 nm, green 532 nm, violet 405 nm" }),
			new Prop("power_mw", "Brightness", 1.0, 0.1, 5.0, 0.1, "mW", "Class 2 pointers are at most 1 mW"),
			aim(0.0, "Which way it shines: 0 = right, 90 = up, 180 = left, -90 = down"), ...on_props()],
		"A laser pointer (14 cm pen) on a stand: ONE thin beam in the direction `aim` (degrees, 0 = right). Ideal for mirrors, refraction and hitting targets: " +
			"the beam is drawn as a bright line, as if through a little mist.",
		{ readouts: [new Readout("on", "On", { unit: "", digits: 0 })], tags: ["laser", "beam", "light ray"], source: "Class 2 laser pointer, 1 mW, beam Ø 1.5 mm, 1 mrad [IEC60825]." })
	T("mirror", "Flat mirror", build_mirror,
		[new Prop("width", "Size", 0.2, 0.05, 0.6, 0.01, "m", "The mirror's length as seen from the side"),
			new Prop("reflectance", "Reflectance", 0.9, 0.5, 0.99, 0.01, "", "The share of the light its silvered face sends back"),
			aim(180.0, "Which way its shiny face points: 0 = right, 90 = up, 180 = left")],
		"A flat glass mirror on a stand, silvered on ONE side: its shiny face points in the direction `aim` (degrees: 0 = facing right, 90 = facing " +
			"up, 180 = facing left); its back is opaque. Angle in = angle out: turning it by 10° turns the reflected beam by 20°. To send a beam " +
			"that arrives travelling in direction A on in direction B, set aim = (A + 180 + B) / 2 (the face points half way between back along " +
			"the incoming beam and along the outgoing one).",
		{ tags: ["reflect", "reflection", "periscope"] })
	T("curved-mirror", "Curved mirror", build_curved_mirror,
		[new Prop("curve", "Shape", "concave", { kind: "choice", choices: ["concave", "convex"], help: "Concave (a shaving mirror) focuses; convex (a car's side mirror) spreads" }),
			new Prop("focal_length", "Focal distance", 0.15, 0.05, 1.0, 0.01, "m", "f = R/2"),
			new Prop("diameter", "Diameter", 0.1, 0.03, 0.3, 0.01, "m"), aim(180.0, "Which way its shiny face points: 0 = right, 180 = left")],
		"A round spherical mirror on a stand. Its shiny face points in the direction `aim`. Concave: parallel light meets at its focus, f in front; " +
			"convex: light spreads as if from a point f behind it.",
		{ tags: ["concave", "convex", "focus", "reflect"] })
	T("convex-lens", "Convex lens", build_convex_lens,
		[new Prop("focal_length", "Focal distance", 0.1, 0.03, 0.5, 0.01, "m", "Where parallel light comes to a point"),
			new Prop("diameter", "Diameter", 0.05, 0.02, 0.15, 0.005, "m"),
			new Prop("glass", "Glass", "crown glass", { kind: "choice", choices: ["crown glass", "flint glass", "acrylic"] }),
			aim(0.0, "The direction of its axis: 0 = light passes left ↔ right, 90 = up ↔ down")],
		"A converging (magnifying) lens on a stand, its axis in the direction `aim` (0: light passes left ↔ right). Parallel light (the sun) meets at " +
			"its focus, focal_length behind it; an object beyond 2f makes a smaller, upside-down image on a screen at d_i (1/f = 1/d_o + 1/d_i).",
		{ tags: ["magnifying glass", "lens", "focus", "burning glass"] })
	T("concave-lens", "Concave lens", build_concave_lens,
		[new Prop("focal_length", "Focal distance", 0.1, 0.03, 0.5, 0.01, "m", "How far behind it parallel light seems to spread from"),
			new Prop("diameter", "Diameter", 0.05, 0.02, 0.15, 0.005, "m"),
			new Prop("glass", "Glass", "crown glass", { kind: "choice", choices: ["crown glass", "flint glass", "acrylic"] }),
			aim(0.0, "The direction of its axis: 0 = light passes left ↔ right")],
		"A diverging lens on a stand, its axis in the direction `aim`: parallel light spreads out as if from a point focal_length in front of it.",
		{ tags: ["lens", "diverging", "spread"] })
	T("prism", "Prism", build_prism,
		[new Prop("edge", "Edge", 0.05, 0.02, 0.15, 0.005, "m", "Each side of the triangle"),
			new Prop("glass", "Glass", "crown glass", { kind: "choice", choices: ["crown glass", "flint glass", "acrylic"], help: "Flint glass spreads the colours twice as much" }),
			aim(0.0, "How far it is turned (0 = apex up)")],
		"A 60° triangular glass prism on a stand (centred on its middle; apex up at aim 0). White light through it bends and splits into a " +
			"rainbow (violet bends most). Aim the beam at one slanted face.",
		{ tags: ["rainbow", "spectrum", "colours", "dispersion"] })
	T("glass-block", "Glass block", build_glass_block,
		[new Prop("width", "Width", 0.1, 0.02, 0.3, 0.005, "m"), new Prop("height", "Height", 0.06, 0.02, 0.2, 0.005, "m"),
			new Prop("glass", "Glass", "crown glass", { kind: "choice", choices: BLOCK_MEDIA, help: "Crown glass n 1.52, flint 1.62, acrylic 1.49, or water 1.333 (a thin clear cell of water)" }),
			aim(0.0, "How far it is turned")],
		"A rectangular clear block (2 cm deep): a beam entering at a slant bends toward the normal inside and leaves parallel to how it came, " +
			"shifted sideways. Glass `water`: a block of water (bends light less than glass). For light into a real tank of water use the liquids " +
			"module's water tank or beaker: its water bends light too.",
		{ tags: ["refraction", "bend light", "block", "water"] })
	T("semicircle-block", "Semicircular block", build_semicircle,
		[new Prop("radius", "Radius", 0.05, 0.02, 0.15, 0.005, "m"),
			new Prop("glass", "Glass", "crown glass", { kind: "choice", choices: ["crown glass", "flint glass", "acrylic"] }),
			aim(0.0, "Which way its flat face points")],
		"A D-shaped clear block: its flat face points in the direction `aim`, the round side behind. A beam aimed through the round side at the " +
			"flat face's middle meets the flat face at any angle: past the critical angle (41° for crown glass) it is totally reflected.",
		{ tags: ["total internal reflection", "critical angle"] })
	T("color-filter", "Colour filter", build_filter,
		[new Prop("color", "Colour", "red", { kind: "choice", choices: Object.keys(FILTERS), help: "The colour it lets through" }),
			new Prop("size", "Size", 0.1, 0.03, 0.3, 0.01, "m"), aim(0.0, "Which way it faces (0: it stands upright across a level beam)")],
		"A coloured gel in a card frame, on a stand: it lets its own colour through and stops the others (a red filter turns white light red " +
			"and stops green light).",
		{ tags: ["filter", "gel", "colour"] })
	T("material-panel", "Material panel", build_panel,
		[new Prop("sample", "Material", "clear glass", { kind: "choice", choices: Object.keys(PANELS), help: "Transparent (glass, plastic), translucent (frosted glass, wax paper, tissue) or opaque (card, cardboard, foil, cloth, wood)" }),
			new Prop("size", "Size", 0.1, 0.05, 0.4, 0.01, "m"), aim(0.0, "Which way it faces (0: it stands upright across a level beam)")],
		"A 10 × 10 cm sample sheet on a stand, for sorting materials: transparent ones let light straight through (glass ≈ 92 %), translucent " +
			"ones let some through, scattered, opaque ones none (foil reflects it, black cloth absorbs it).",
		{ tags: ["transparent", "translucent", "opaque", "materials"] })
	T("screen", "Screen", build_screen,
		[new Prop("height", "Height", 0.3, 0.1, 1.0, 0.01, "m"), new Prop("width", "Width", 0.2, 0.1, 1.0, 0.01, "m", "Its size front to back"),
			new Prop("color", "Colour", "#e8e6df", { kind: "choice", choices: ["#e8e6df", "#f5f5f0", "#202020"], help: "White card (default), bright white, black" }),
			aim(0.0, "Which way it faces (0: it stands upright, catching a level beam on either side)")],
		"A white card screen on a stand, standing upright (aim 0; both sides catch light): it shows light spots, colours and SHADOWS " +
			"(put an opaque thing between a light and the screen). Readings: the shadow's size on it.",
		{ readouts: [new Readout("shadow_cm", "Shadow", { unit: "cm", digits: 1 }), new Readout("lit_pct", "Lit", { unit: "%", digits: 0 }), new Readout("image_cm", "Image size", { unit: "cm", digits: 1, help: "Of a lit object, upside down when negative" }),
			new Readout("blur_mm", "Image blur", { unit: "mm", digits: 1 }), new Readout("colors", "Colours", { unit: "", digits: 0, help: "Bands of split light (a rainbow) landing on it" })], tags: ["shadow", "screen", "projection", "card"] })
	T("light-meter", "Light meter", build_meter,
		[new Prop("threshold", "Lit above", 10.0, 0.1, 10000.0, 0.1, "lx", "It counts as lit from this illuminance"),
			aim(180.0, "Which way its sensor faces: 180 = toward a light on its left, 0 = right, 90 = up")],
		"A digital lux meter on a stand: its sensor (4 cm head) faces the direction `aim` (180 = facing left) and its display shows the light " +
			"falling on it in lux (sunlight ≈ 100 000 lx, a room 300 lx). Twice as far from a small light → a quarter of the reading.",
		{ readouts: [new Readout("lux", "Illuminance", { unit: "lx", digits: 0 }), new Readout("wm2", "Light power", { unit: "W/m²", digits: 2 }), new Readout("lit", "Lit", { unit: "", digits: 0 }),
			new Readout("pulses", "Flashes", { unit: "", digits: 0, help: "Times its light came on (a blinking light's flashes)" })], tags: ["lux", "brightness", "meter", "sensor", "instrument"] })
	T("light-sensor", "Light target", build_target,
		[new Prop("size", "Size", 0.1, 0.03, 0.3, 0.01, "m"), aim(0.0, "Which way it faces (either face counts)")],
		"A round target board on a stand that registers light reaching it (either face): the goal hits_target {light, target} says a source's " +
			"light gets there, straight or by mirrors and lenses. It counts the flashes of a blinking light (`pulses`): the goal receives {sensor, " +
			"light} reads a flashlight's Morse message back from them.",
		{ readouts: [new Readout("hit", "Light on it", { unit: "", digits: 0 }), new Readout("mw", "Light power", { unit: "mW", digits: 3 }),
			new Readout("pulses", "Flashes", { unit: "", digits: 0, help: "Times light came on (a blinking light's flashes)" })], tags: ["target", "sensor", "bullseye", "receiver", "photodiode"] })
	T("eye", "Eye", build_eye,
		[new Prop("fov", "Field of view", 120.0, 20.0, 180.0, 5.0, "°", "How wide it looks"), aim(180.0, "Which way it looks: 180 = left, 0 = right, -90 = down")],
		"An eyeball on a stand, looking in the direction `aim` (180 = left). It sees a thing only when light from it enters the eye: a light " +
			"source, or something lit that it can see (straight, or by mirrors). In the dark it sees nothing.",
		{ readouts: [new Readout("sees", "Things seen", { unit: "", digits: 0 })], tags: ["eye", "see", "seeing", "vision"] })
	T("sunlight", "Sunlight", build_sun,
		[new Prop("elevation", "Elevation", 45.0, 5.0, 90.0, 1.0, "°", "How high the sun stands above the horizon"),
			new Prop("comes_from", "Comes from", "left", { kind: "choice", choices: ["left", "right"], help: "Which side the sun is on" }),
			new Prop("irradiance", "Sunlight", 1000.0, 50.0, 1400.0, 10.0, "W/m²", "Clear noon ≈ 1000 W/m² (≈ 100 000 lx)"),
			new Prop("width", "Band width", 6.0, 0.005, 12.0, 0.005, "m", "How wide a band of parallel light it sends, centred on this marker (5 mm: sunlight through a slit)"), ...on_props()],
		"Sunlight: parallel rays from far away at the elevation angle, in a band `width` wide centred on this marker (put it above the middle " +
			"of what it lights). Clear noon sun ≈ 1000 W/m², ≈ 100 000 lx [ASTM-G173].",
		{ readouts: [new Readout("on", "On", { unit: "", digits: 0 })], tags: ["sun", "sunlight", "daylight", "shadow", "solar"] })
	T("lit-arrow", "Lit arrow", build_arrow,
		[new Prop("height", "Height", 0.05, 0.02, 0.2, 0.005, "m", "The arrow's length (the object a lens images)"),
			new Prop("lumens", "Brightness", 40.0, 5.0, 400.0, 5.0, "lm"), new Prop("spread", "Spread", 12.0, 3.0, 40.0, 1.0, "°", "Half-angle of the light each point sends"),
			aim(0.0, "Which way it shines: 0 = right"), ...on_props()],
		"A light box with an upward arrow cut out of its front, the object for lens demos: light leaves every point of the arrow in the direction " +
			"`aim`; a convex lens forms its upside-down image on a screen.",
		{ readouts: [new Readout("on", "On", { unit: "", digits: 0 })], tags: ["object", "image", "lens demo"] })
}

// ---------------------------------------------------------------- builders
function _optics(role, kw = {}) {
	const d = { role }
	for (const [k, v] of Object.entries(kw)) if (v !== null && v !== undefined) d[k] = v
	return d
}

function _light(c, P, kind, solid, x, y, dir_, spread, out, size, blur, rays, round_cone, power) {
	const r = F.py.pyRound
	const d = { id: kind !== "object" ? c.sid("light") : null, item: c.item.id, solid, kind, x: r(x, 5), y: r(y, 5), dir: r(dir_, 6), spread: r(spread, 6), out: r(out, 6) }
	if (round_cone !== null) d.round = round_cone
	Object.assign(d, { size, blur, rays })
	Object.assign(d, power)
	if (!F.py.truthy(own(P, "on") ? P.on : true)) d.on = false
	if ((own(P, "on_at") ? P.on_at : 0.0) > 0) d.on_at = Number(P.on_at)
	return d
}

/** machines/mod_optics.py blink_of, step for step. */
const asciiUpper = (t) => t.replace(/[a-z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 32))
const spaceTrim = (p) => (typeof p === "string" ? p.replace(/^ +| +$/g, "") : "")

export function blink_of(pattern, dot, repeat) {
	const text = spaceTrim(pattern)
	if (text === "" || asciiUpper(text) === "STEADY") return []
	const runs = []
	const add = (on, n) => {
		if (runs.length && runs[runs.length - 1][0] === on) runs[runs.length - 1][1] += n
		else runs.push([on, n])
	}
	if ([...text].every((ch) => "01 ".includes(ch))) {
		for (const ch of text) if (ch === "0" || ch === "1") add(ch === "1", 1)
	} else {
		let first = true
		for (const word of asciiUpper(text).split(" ").filter((w) => w)) {
			const letters = [...word].filter((ch) => own(MORSE, ch))
			if (!letters.length) continue
			if (!first) add(false, 7)
			first = false
			letters.forEach((ch, li) => {
				if (li > 0) add(false, 3)
				;[...MORSE[ch]].forEach((sign, si) => {
					if (si > 0) add(false, 1)
					add(true, sign === "." ? 1 : 3)
				})
			})
		}
	}
	while (runs.length && !runs[0][0]) runs.shift()
	if (!runs.length) return []
	if (repeat) add(false, REPEAT_GAP)
	else if (!runs[runs.length - 1][0]) runs.pop()
	return runs.map(([, n]) => F.py.pyRound(n * dot, 6))
}

/** machines/mod_optics.py message_of. */
export function message_of(pattern) {
	const text = spaceTrim(pattern)
	if (text === "" || asciiUpper(text) === "STEADY") return ""
	if ([...text].every((ch) => "01 ".includes(ch))) return [...text].filter((ch) => ch === "0" || ch === "1").join("").replace(/^0+|0+$/g, "")
	const words = asciiUpper(text).split(" ").filter((w) => w).map((w) => [...w].filter((ch) => own(MORSE, ch)).join(""))
	return words.filter((w) => w).join(" ")
}

function build_flashlight(c, P) {
	const L = 0.15
	const D = 0.03
	const half = (_f("beam_angle", P) * F.D2R) / 2
	const sid = c.sid("body")
	const light = own(TORCH_LIGHT, P.color) ? TORCH_LIGHT[P.color] : "led"
	const given = c.item.props ?? {}
	if (!own(given, "lumens")) P.lumens = own(TORCH_LUMENS, P.color) ? TORCH_LUMENS[P.color] : 150.0
	const src = _light(c, P, "flashlight", sid, L / 2 + 0.001, 0.0, 0.0, half, half, 0.012, 0.0, 96, true, { light, lumens: _f("lumens", P) })
	const rep = F.py.truthy(own(P, "repeat") ? P.repeat : true)
	const blink = blink_of(own(P, "pattern") ? P.pattern : null, _f("dot_s", P), rep)
	if (blink.length) {
		src.blink = blink
		src.dot = _f("dot_s", P)
		src.message = message_of(own(P, "pattern") ? P.pattern : null)
		if (rep) src.repeat = true
	}
	c.slab("body", L, D, D, 0.0, 0.0, _f("aim", P), { material: c.mat({ base: "aluminium", overrides: {} }), words: "an LED flashlight", optics: _optics("opaque", { color: "#2b2f36" }), light: src, stand: "post" })
}

function build_laser(c, P) {
	const L = 0.14
	const D = 0.014
	const sid = c.sid("body")
	const src = _light(c, P, "laser", sid, L / 2 + 0.001, 0.0, 0.0, 0.0, 0.0, 0.00075, 0.0005, 1, null, { nm: LASER_NM[P.color], mw: _f("power_mw", P) })
	c.slab("body", L, D, D, 0.0, 0.0, _f("aim", P), { material: c.mat({ base: "aluminium", overrides: {} }), words: "a laser pointer", optics: _optics("opaque", { color: "#30343a" }), light: src, stand: "post" })
}

function build_mirror(c, P) {
	const w = _f("width", P)
	const R = _f("reflectance", P)
	c.slab("glass", 0.006, w, 0.1, 0.0, 0.0, _f("aim", P), {
		material: c.mat({ base: "mirror glass", overrides: {} }), words: "a flat mirror",
		optics: _optics("mirror", { faces: [0], aim: _f("aim", P), reflect: [R, R, R, R, R, R, R, F.py.pyRound(Math.min(0.99, R + 0.02), 4)], color: "#30343a" }), stand: "post" })
}

function build_curved_mirror(c, P) {
	const f = _f("focal_length", P)
	const R = 2 * f
	const h = Math.min(_f("diameter", P) / 2, 0.9 * R)
	const th = 0.004
	const sag = R - Math.sqrt(R * R - h * h)
	let pts
	let prims
	if (P.curve === "concave") {
		const xo = R - Math.sqrt((R + th) * (R + th) - h * h)
		pts = [[-th, 0.0], [xo, -h], [sag, -h], [sag, h], [xo, h]]
		prims = [["hole", R, 0.0, R, 1], ["disk", R, 0.0, R + th, 1], ["half", 0.0, 1.0, h], ["half", 0.0, -1.0, h], ["half", 1.0, 0.0, R]]
	} else {
		const xb = -R + Math.sqrt((R - th) * (R - th) - h * h)
		pts = [[xb, -h], [-sag, -h], [0.0, 0.0], [-sag, h], [xb, h]]
		prims = [["disk", -R, 0.0, R, 1], ["hole", -R, 0.0, R - th, 1], ["half", 0.0, 1.0, h], ["half", 0.0, -1.0, h], ["half", -1.0, 0.0, R]]
	}
	prims = prims.map((p) => [p[0], ...p.slice(1, 4).map((v) => F.py.pyRound(v, 6)), ...p.slice(4)])
	c.poly("mirror", pts, 2 * h, 0.0, 0.0, _f("aim", P), {
		material: c.mat({ base: "mirror glass", overrides: {} }), words: `a ${P.curve} mirror`,
		optics: _optics("mirror", { prims, faces: [0], reflect: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.92], half: F.py.pyRound(h, 6), aperture: [0.0, 0.0, 1.0, 0.0, F.py.pyRound(h, 6)], color: "#30343a" }), stand: "post" })
}

/** machines/mod_optics.py lens_shape, step for step. */
export function lens_shape(f, n, diameter, minimum) {
	const h = diameter / 2
	let R = 2 * (n - 1) * f
	let t = minimum
	for (let i = 0; i < 60; i++) {
		const r = Math.abs(R)
		const sag = r > h ? r - Math.sqrt(r * r - h * h) : r
		t = f > 0 ? minimum + 2 * sag : minimum
		const a = 1 / f
		const b = -2 * (n - 1)
		const cc = ((n - 1) * (n - 1) * t) / n
		const disc = b * b - 4 * a * cc
		const nxt = disc >= 0 ? (-b + Math.sqrt(disc)) / (2 * a) : R
		if (Math.abs(nxt - R) < 1e-15) {
			R = nxt
			break
		}
		R = nxt
	}
	return [R, t]
}

const _lens_n = (P) => GLASS_ND[P.glass]

function build_convex_lens(c, P) {
	const r6 = (v) => F.py.pyRound(v, 6)
	const f = _f("focal_length", P)
	const n = _lens_n(P)
	const D = Math.min(_f("diameter", P), 3 * (n - 1) * f)
	const h = D / 2
	const e = 0.0015
	const [R, t] = lens_shape(f, n, D, e)
	const x3 = t / 2 - (R - Math.sqrt(R * R - (h * h) / 9))
	const pts = [[e / 2, -h], [x3, -h / 3], [x3, h / 3], [e / 2, h], [-e / 2, h], [-x3, h / 3], [-x3, -h / 3], [-e / 2, -h]]
	const prims = [["disk", r6(R - t / 2), 0.0, r6(R), 1], ["disk", r6(-(R - t / 2)), 0.0, r6(R), 1], ["half", 0.0, 1.0, r6(h)], ["half", 0.0, -1.0, r6(h)]]
	c.poly("lens", pts, D, 0.0, 0.0, _f("aim", P), {
		material: c.mat({ base: "optical glass", density: new F.py.PyInt(GLASS_DENSITY[P.glass]), overrides: {} }), words: "a convex lens",
		optics: _optics("glass", { medium: P.glass, prims, half: r6(h), aperture: [0.0, 0.0, 1.0, 0.0, r6(h)] }), stand: "post" })
}

function build_concave_lens(c, P) {
	const r6 = (v) => F.py.pyRound(v, 6)
	const f = _f("focal_length", P)
	const n = _lens_n(P)
	const D = Math.min(_f("diameter", P), 3 * (n - 1) * f)
	const h = D / 2
	const t = 0.002
	const [R] = lens_shape(-f, n, D, t)
	const r = Math.abs(R)
	const e = t + 2 * (r - Math.sqrt(r * r - h * h))
	const prims = [["half", 1.0, 0.0, r6(e / 2)], ["half", -1.0, 0.0, r6(e / 2)], ["half", 0.0, 1.0, r6(h)], ["half", 0.0, -1.0, r6(h)],
		["hole", r6(t / 2 + r), 0.0, r6(r), 1], ["hole", r6(-(t / 2 + r)), 0.0, r6(r), 1]]
	c.slab("lens", e, D, D, 0.0, 0.0, _f("aim", P), {
		material: c.mat({ base: "optical glass", density: new F.py.PyInt(GLASS_DENSITY[P.glass]), overrides: {} }), words: "a concave lens",
		optics: _optics("glass", { medium: P.glass, prims, half: r6(h), aperture: [0.0, 0.0, 1.0, 0.0, r6(h)] }), stand: "post" })
}

const SQRT3 = Math.sqrt(3)

function build_prism(c, P) {
	const s = _f("edge", P)
	const pts = [[-s / 2, (-s * SQRT3) / 6], [s / 2, (-s * SQRT3) / 6], [0.0, (s * SQRT3) / 3]]
	c.poly("glass", pts, 0.05, 0.0, 0.0, _f("aim", P), { material: c.mat({ base: "optical glass", density: new F.py.PyInt(GLASS_DENSITY[P.glass]), overrides: {} }), words: "a glass prism", optics: _optics("glass", { medium: P.glass }), stand: "post" })
}

function build_glass_block(c, P) {
	const water = P.glass === "water"
	const look = water && own(F.LOOK_FILL, "water") ? { look: "water" } : {}
	c.slab("glass", _f("width", P), _f("height", P), 0.02, 0.0, 0.0, _f("aim", P), {
		material: c.mat({ base: "optical glass", density: new F.py.PyInt(GLASS_DENSITY[P.glass]), overrides: {} }),
		words: water ? "a block of water" : "a glass block", optics: _optics("glass", { medium: P.glass }), stand: "post", ...look })
}

function build_semicircle(c, P) {
	const r = _f("radius", P)
	const q = (r * SQRT3) / 2
	const pts = [[0.0, -r], [0.0, r], [-r / 2, q], [-q, r / 2], [-r, 0.0], [-q, -r / 2], [-r / 2, -q]]
	const prims = [["disk", 0.0, 0.0, F.py.pyRound(r, 6)], ["half", 1.0, 0.0, 0.0]]
	c.poly("glass", pts, 0.02, 0.0, 0.0, _f("aim", P), { material: c.mat({ base: "optical glass", density: new F.py.PyInt(GLASS_DENSITY[P.glass]), overrides: {} }), words: "a semicircular glass block", optics: _optics("glass", { medium: P.glass, prims }), stand: "post" })
}

function build_filter(c, P) {
	const s = _f("size", P)
	c.slab("gel", 0.002, s, s, 0.0, 0.0, _f("aim", P), { material: c.mat({ base: "card", overrides: {} }), words: `a ${P.color} filter`, color: FILTER_COLOR[P.color], look: "gel", optics: _optics("filter", { passes: [...FILTERS[P.color]] }), stand: "post" })
}

function build_panel(c, P) {
	const s = _f("size", P)
	const k = PANELS[P.sample]
	const o = { color: k.color }
	if (k.role === "glass") o.medium = k.medium
	if (k.role === "translucent") {
		o.transmit = k.transmit
		o.blur = k.blur
	}
	if (k.role === "mirror") {
		const r = k.reflect
		o.reflect = [r, r, r, r, r, r, r, r]
		o.faces = [0, 2]
	}
	c.slab("panel", k.t, s, s, 0.0, 0.0, _f("aim", P), { material: c.mat({ base: k.material, overrides: {} }), words: `a panel of ${P.sample}`, color: k.color, optics: _optics(k.role, o), stand: "post" })
}

function build_screen(c, P) {
	c.slab("card", 0.005, _f("height", P), _f("width", P), 0.0, 0.0, _f("aim", P), { material: c.mat({ base: "card", overrides: {} }), words: "a white screen", color: P.color, optics: _optics("screen", { faces: [0, 2], color: P.color }), stand: "post" })
}

function build_meter(c, P) {
	c.slab("head", 0.03, 0.04, 0.04, 0.0, 0.0, _f("aim", P), { material: c.mat({ base: "ABS housing", overrides: {} }), words: "a light meter", optics: [_optics("sensor", { prims: [["half", 1.0, 0.0, 0.015], ["half", -1.0, 0.0, -0.013], ["half", 0.0, 1.0, 0.005], ["half", 0.0, -1.0, 0.005]], faces: [0], color: "#f2f2f2", threshold: _f("threshold", P), half: 0.005 }), _optics("opaque", { color: "#2b2f36" })], stand: "post" })
}

function build_target(c, P) {
	const s = _f("size", P)
	c.slab("board", 0.01, s, s, 0.0, 0.0, _f("aim", P), { material: c.mat({ base: "card", overrides: {} }), words: "a light target", color: "#f2efe6", optics: _optics("sensor", { color: "#f2efe6", target: true }), stand: "post" })
}

function build_eye(c, P) {
	const r = 0.012
	c.ball("eye", r, 0.0, 0.0, { material: c.mat({ base: "ABS housing", overrides: {} }), words: "an eye", color: "#f4f1ea", optics: _optics("opaque", { color: "#f4f1ea", eye: F.py.pyRound((_f("fov", P) * F.D2R) / 2, 6), pupil: r + 0.001, look: F.py.pyRound(_f("aim", P) * F.D2R, 6) }), stand: "post" })
}

function build_sun(c, P) {
	const e = _f("elevation", P) * F.D2R
	const d = P.comes_from === "left" ? -e : Math.PI + e
	const sid = c.sid("disc")
	const [x, y] = c.world(0.0, 0.0)
	const src = _light(c, P, "sun", "", x, y, d, 0.0, 0.0, F.py.pyRound(_f("width", P) / 2, 5), 0.00465, 240, null, { light: "sun", irradiance: _f("irradiance", P), back: 3.0 })
	c.ball("disc", 0.03, 0.0, 0.0, { material: c.mat({ base: "card", overrides: {} }), words: "the sun", look: "sun", optics: _optics("clear"), light: src, hidden_3d: true })
	if (HEAT_KINDS.has("heat")) c.process("heat", "sun", { role: "sun", irradiance: _f("irradiance", P), direction: F.py.pyRound(d, 6), ...(F.py.truthy(P.on) ? { from: Number(P.on_at) } : { from: 1e9 }) })
	return sid
}

function build_arrow(c, P) {
	const h = _f("height", P)
	const half = _f("spread", P) * F.D2R
	const sid = c.sid("box")
	const pts = []
	const n = 5
	for (let k = 0; k < n; k++) {
		const y = -h / 2 + (h * k) / (n - 1)
		const s = _light(c, P, "object", sid, 0.016, y, 0.0, half, half, 0.002, 0.0, 48, false, { light: "led", lumens: F.py.pyRound(_f("lumens", P) / n, 6) })
		s.id = c.sid(`p${k}`)
		pts.push(s)
	}
	c.slab("box", 0.03, h + 0.02, 0.05, 0.0, 0.0, _f("aim", P), { material: c.mat({ base: "ABS housing", overrides: {} }), words: "a lit arrow", optics: _optics("opaque", { color: "#2b2f36" }), light: pts, stand: "post" })
}

// ---------------------------------------------------------------- the build hook
function _name(scene_items, iid) {
	const it = scene_items.get(iid) ?? {}
	const t = F.TYPES[it.type]
	return F.py.truthy(it.name) ? it.name : t !== undefined ? t.name : iid
}

function build_hook(sb, scene) {
	void scene
	const sources = []
	let have = false
	for (const s of sb.solids) {
		if (own(s, "light")) {
			have = true
			const got = s.light
			delete s.light
			if (Array.isArray(got)) sources.push(...got)
			else sources.push(got)
		}
		if (own(s, "optics")) have = true
	}
	for (const r of sb.processes) {
		if (r.kind === "heat" && r.role === "lamp") {
			const item = r.item
			const P = sb.scene_items.has(item) ? F.props_of(sb.scene_items.get(item)) : {}
			const spread = own(r, "spread") ? r.spread : 0.6
			const src = {
				id: `${item}/light`, item, solid: F.py.truthy(r.solid) ? r.solid : r.id, kind: "lamp", x: r.at.x, y: r.at.y,
				dir: own(r, "dir") ? r.dir : own(r, "direction") ? r.direction : -1.5707963267948966, spread, out: spread, round: true, size: 0.03, blur: 0.0,
				rays: 180, light: LAMP_LIGHT[P.bulb] ?? "incandescent", watts: own(r, "power") ? r.power : 0.0
			}
			if (own(r, "from")) src.on_at = r.from
			if (own(r, "until")) src.off_at = r.until
			sources.push(src)
			have = true
		}
	}
	if (!have) return
	const [lamps, clear] = _circuit_lights(sb)
	sources.push(...lamps)
	const bodies = []
	for (const s of sb.solids) {
		const o = own(s, "optics") ? s.optics : null
		delete s.optics
		if (F.py.truthy(s.hidden_3d) || clear.has(s.id)) continue
		if (o !== null) {
			// (a solid may carry several: a light meter's 1 cm sensor window, then its housing)
			for (const oo of Array.isArray(o) ? o : [o]) {
				if (oo.role === "clear") continue
				const b = { solid: s.id, item: s.item, ...oo }
				if (own(b, "passes")) {
					const p = b.passes
					delete b.passes
					b.pass = p
				}
				bodies.push(b)
			}
			continue
		}
		const base = sb.base_of(s.material)
		const look = s.look
		const medium = MEDIUM_OF_MATERIAL[base] ?? MEDIUM_OF_LOOK[look] ?? null
		const colour = F.py.truthy(s.color) ? s.color : F.py.truthy(F.LOOK_FILL[look]) ? F.LOOK_FILL[look] : s.placeholder.fill
		if (medium !== null) bodies.push({ solid: s.id, item: s.item, role: "glass", medium })
		else if (own(TRANSLUCENT_MATERIAL, base)) {
			const [tr, bl] = TRANSLUCENT_MATERIAL[base]
			bodies.push({ solid: s.id, item: s.item, role: "translucent", transmit: tr, blur: bl, color: colour })
		} else bodies.push({ solid: s.id, item: s.item, role: "opaque", color: colour, look })
	}
	bodies.push(..._liquid_bodies(sb))
	sources.forEach((src, k) => {
		if (src.id === null || src.id === undefined) src.id = `${src.item}/light${k}`
	})
	const names = []
	const seen = new Set()
	for (const iid of [...bodies.map((b) => b.item), ...sources.map((s) => s.item)]) {
		if (!seen.has(iid)) {
			seen.add(iid)
			names.push([iid, _name(sb.scene_items, iid)])
		}
	}
	sb.processes.push({ kind: "optics", id: "optics", sources, bodies, names })
}

/** machines/mod_optics.py _circuit_lights: the circuits module's bulbs and LEDs as light sources. */
function _circuit_lights(sb) {
	const out = []
	const clear = new Set()
	for (const r of sb.processes) {
		if (r.kind !== "circuit") continue
		const terminals = r.terminals ?? {}
		for (const p of r.parts ?? []) {
			const kind = p.kind
			if (kind !== "bulb" && kind !== "led") continue
			const item = p.item
			const t = own(terminals, `${item}/glow`) ? terminals[`${item}/glow`] : null
			if (t === null || typeof t !== "object" || !sb.solids.some((s) => s.id === t.solid)) continue
			const src = { id: `${item}/glow-light`, item, solid: t.solid, kind: "lamp", x: t.at.x, y: t.at.y, dir: 1.570796 }
			if (kind === "bulb") {
				clear.add(`${item}/glass`)
				const watts = Number(own(p, "v_rated") ? p.v_rated : 2.5) * Number(own(p, "i_rated") ? p.i_rated : 0.3)
				Object.assign(src, { spread: 3.141593, out: 1.570796, round: false, size: 0.0055, blur: 0.0, rays: 180, light: "incandescent",
					lumens: F.py.pyRound(BULB_LM_PER_W * watts, 6), infrared: F.py.pyRound(BULB_IR_PER_W * watts, 6) })
			} else {
				const P = sb.scene_items.has(item) ? F.props_of(sb.scene_items.get(item)) : {}
				const color = typeof P.color === "string" && own(LED_LUMENS, P.color) ? P.color : "red"
				Object.assign(src, { spread: LED_HALF, out: LED_HALF, round: true, size: 0.0025, blur: 0.0, rays: 48, light: LED_LIGHT[color], lumens: LED_LUMENS[color] })
			}
			src.drive = { item, key: "light", scale: 1.0 }
			out.push(src)
		}
	}
	return [out, clear]
}

/** machines/mod_optics.py _liquid_bodies: each layer of a liquids-module container's liquid as a refracting body with a live surface. */
function _liquid_bodies(sb) {
	const r6 = (v) => F.py.pyRound(v, 6)
	const out = []
	for (const r of sb.processes) {
		if (r.kind !== "liquid" || !Array.isArray(r.layers) || !r.layers.length) continue
		const item = r.item
		const floor = sb.solids.find((s) => s.id === `${item}/floor`)
		if (floor === undefined || F.py.truthy(floor.parent) || Math.abs(own(floor, "angle") ? floor.angle : 0.0) > 1e-12) continue
		const fx = floor.at.x
		const fy = floor.at.y
		const x0 = r.x0 - LIQUID_OVER
		const x1 = r.x1 + LIQUID_OVER
		const half = r6(r.area / (r.x1 - r.x0) / 2)
		const P = sb.scene_items.has(item) ? F.props_of(sb.scene_items.get(item)) : {}
		const layers = r.layers
		const n = layers.length
		let bottom = r.floor - LIQUID_OVER
		let top = r.floor
		layers.forEach((layer, i) => {
			top = top + layer.height
			const words = String(layer.words ?? "")
			const name = words.startsWith("salt water") ? "salt water" : words
			const medium = own(LIQUID_MEDIUM, name) ? LIQUID_MEDIUM[name] : "water"
			const up = i < n - 1 ? LIQUID_OVER : 0.0
			const b = { solid: floor.id, item, role: "glass", medium }
			if (medium === "salt water") {
				let pct = own(P, "salt_pct") ? P.salt_pct : 10.0
				pct = typeof pct === "number" ? Number(pct) : 10.0
				b.nd = r6(1.33299 + 0.001757 * Math.min(26.0, Math.max(0.0, pct)))
			}
			b.liquid = i + 1
			b.prims = [["half", 1.0, 0.0, r6(x1 - fx)], ["half", 0.0, 1.0, r6(top + up - fy)], ["half", -1.0, 0.0, r6(-(x0 - fx))], ["half", 0.0, -1.0, r6(-(bottom - fy))]]
			b.half = half
			const level = { item }
			if (n === 1) level.top = "level_mm"
			else {
				level.top = `layer${i + 1}_mm`
				if (i > 0) level.bottom = `layer${i}_mm`
			}
			level.floor = r6(r.floor - fy)
			level.up = up
			b.level = level
			out.push(b)
			bottom = top
		})
	}
	return out
}

// ---------------------------------------------------------------- goal kinds (machines/mod_optics.py: the same, number for number)
const _fmt = (v) => F.py.fmtF(v, 2).replace(/0+$/, "").replace(/\.$/, "")

function _events(ctx, kind, a, b) {
	for (const e of ctx.track.events ?? []) {
		const it = e.items ?? []
		if (e.kind === kind && it.length >= 2 && it[0] === a && it[1] === b) return e.t
	}
	return null
}

function _end(ctx, iid, key) {
	const v = ctx.state(iid, key)
	if (!v || !v.length) return null
	const x = v[v.length - 1]
	return typeof x === "number" ? x : null
}

function goal_hits_target(ctx, g) {
	const a = g.light
	const b = g.target
	if (!ctx.known(a) || !ctx.known(b)) return null
	const t = _events(ctx, "light", a, b)
	const by = ctx.num(g.before_s)
	const when = by === null ? "" : ` by ${_fmt(by)} s`
	return {
		label: F.py.truthy(g.label) ? g.label : `${ctx.name(a)}'s light reaches ${ctx.name(b)}${when}`, ok: t !== null && (by === null || t <= by),
		kind: "hits_target", light: a, target: b, t: t === null ? null : F.py.pyRound(t, 3)
	}
}

function _brightness(ctx, iid) {
	let v = _end(ctx, iid, "lux")
	if (v !== null) return [v, "lux"]
	v = _end(ctx, iid, "mw")
	if (v !== null) return [v, "mw"]
	v = _end(ctx, iid, "light_w")
	return [v === null ? 0.0 : v, "light_w"]
}

function goal_lit(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const [v, key] = _brightness(ctx, iid)
	const least = ctx.num(g.at_least_lux)
	if (key === "lux") {
		const need = least === null ? 1.0 : least
		const ok = v >= need
		const label = F.py.truthy(g.label) ? g.label : least !== null ? `${ctx.name(iid)} reads at least ${_fmt(need)} lx` : `${ctx.name(iid)} is lit`
		return { label, ok, kind: "lit", item: iid, lux: F.py.pyRound(v, 1) }
	}
	if (key === "mw") return { label: F.py.truthy(g.label) ? g.label : `${ctx.name(iid)} is lit`, ok: v > 1e-5, kind: "lit", item: iid, mw: F.py.pyRound(v, 5) }
	return { label: F.py.truthy(g.label) ? g.label : `${ctx.name(iid)} is lit`, ok: v > 1e-6, kind: "lit", item: iid, light_w: F.py.pyRound(v, 6) }
}

function goal_dark(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const [v, key] = _brightness(ctx, iid)
	const most = ctx.num(g.at_most_lux)
	if (key === "lux") {
		const cap = most === null ? 1.0 : most
		return { label: F.py.truthy(g.label) ? g.label : `${ctx.name(iid)} is dark`, ok: v <= cap, kind: "dark", item: iid, lux: F.py.pyRound(v, 1) }
	}
	if (key === "mw") return { label: F.py.truthy(g.label) ? g.label : `${ctx.name(iid)} is dark`, ok: v <= 1e-5, kind: "dark", item: iid, mw: F.py.pyRound(v, 5) }
	return { label: F.py.truthy(g.label) ? g.label : `${ctx.name(iid)} is dark`, ok: v <= 1e-6, kind: "dark", item: iid, light_w: F.py.pyRound(v, 6) }
}

function goal_shadow_on(ctx, g) {
	const a = g.occluder
	const b = g.screen
	if (!ctx.known(a) || !ctx.known(b)) return null
	const t = _events(ctx, "shadow", a, b)
	return { label: F.py.truthy(g.label) ? g.label : `${ctx.name(a)} casts a shadow on ${ctx.name(b)}`, ok: t !== null, kind: "shadow_on", occluder: a, screen: b, t: t === null ? null : F.py.pyRound(t, 3) }
}

function goal_sees(ctx, g) {
	const a = g.eye
	const b = g.item
	if (!ctx.known(a) || !ctx.known(b)) return null
	const t = _events(ctx, "sees", a, b)
	return { label: F.py.truthy(g.label) ? g.label : `${ctx.name(a)} sees ${ctx.name(b)}`, ok: t !== null, kind: "sees", eye: a, item: b, t: t === null ? null : F.py.pyRound(t, 3) }
}

function goal_brighter(ctx, g) {
	const a = g.a
	const b = g.b
	if (!ctx.known(a) || !ctx.known(b)) return null
	const [va, ka] = _brightness(ctx, a)
	const [vb, kb] = _brightness(ctx, b)
	const verb = ka === "lux" ? "gets more light than" : "takes in more light than"
	return { label: F.py.truthy(g.label) ? g.label : `${ctx.name(a)} ${verb} ${ctx.name(b)}`, ok: ka === kb && va > vb, kind: "brighter", a, b }
}

function goal_focused(ctx, g) {
	const iid = g.screen
	if (!ctx.known(iid)) return null
	const size = _end(ctx, iid, "image_cm")
	const blur = _end(ctx, iid, "blur_mm")
	const ok = size !== null && blur !== null && Math.abs(size) > 0.05 && blur <= Math.max(2.0, Math.abs(size) * 1.0)
	return {
		label: F.py.truthy(g.label) ? g.label : `A sharp image forms on ${ctx.name(iid)}`, ok, kind: "focused", screen: iid,
		image_cm: size === null ? null : F.py.pyRound(size, 2), blur_mm: blur === null ? null : F.py.pyRound(blur, 2)
	}
}

function goal_rainbow(ctx, g) {
	const iid = g.screen
	if (!ctx.known(iid)) return null
	const n = _end(ctx, iid, "colors")
	const spread = _end(ctx, iid, "spread_mm")
	const ok = n !== null && n >= 6 && spread !== null && spread >= 2.0
	return {
		label: F.py.truthy(g.label) ? g.label : `A rainbow falls on ${ctx.name(iid)}`, ok, kind: "rainbow", screen: iid,
		colors: n === null ? null : F.py.pyRoundInt(n), spread_mm: spread === null ? null : F.py.pyRound(spread, 1)
	}
}

/** machines/mod_optics.py read_flashes: a sensor's on/off record read back as Morse text and as 1s and 0s. */
export function read_flashes(values, times, dot) {
	if (!values || !values.length || !times || !times.length || !(dot > 0)) return ["", ""]
	const runs = []
	let prev = null
	let start = 0.0
	const m = Math.min(values.length, times.length)
	for (let k = 0; k < m; k++) {
		const t = times[k]
		const v = values[k]
		const on = typeof v === "number" && v > 0.5 ? 1 : 0
		if (prev === null) {
			prev = on
			start = t
		} else if (on !== prev) {
			runs.push([prev, t - start])
			prev = on
			start = t
		}
	}
	if (prev === 1) runs.push([1, times[times.length - 1] - start + (times.length > 1 ? times[1] - times[0] : 0.0)])
	while (runs.length && runs[0][0] === 0) runs.shift()
	let letters = []
	const words = []
	let sign = ""
	let bits = ""
	for (const [on, d] of runs) {
		const u = d / dot
		if (on) {
			sign += u < 2 ? "." : "-"
			bits += "1".repeat(Math.max(1, Math.floor(u + 0.5)))
			continue
		}
		if (u >= 9) break
		bits += "0".repeat(Math.max(1, Math.floor(u + 0.5)))
		if (u >= 2) {
			letters.push(own(MORSE_TEXT, sign) ? MORSE_TEXT[sign] : "?")
			sign = ""
			if (u >= 5) {
				words.push(letters.join(""))
				letters = []
			}
		}
	}
	if (sign) letters.push(own(MORSE_TEXT, sign) ? MORSE_TEXT[sign] : "?")
	if (letters.length) words.push(letters.join(""))
	return [words.filter((w) => w).join(" "), bits.replace(/^0+|0+$/g, "")]
}

function goal_receives(ctx, g) {
	const a = g.sensor
	const b = g.light
	if (!ctx.known(a) || !ctx.known(b)) return null
	let src = null
	for (const r of ctx.doc?.processes ?? []) if (r.kind === "optics") src = (r.sources ?? []).find((x) => x.item === b && typeof x.message === "string") ?? null
	let sent
	let dot
	if (src !== null) {
		sent = src.message
		dot = own(src, "dot") ? src.dot : null
	} else {
		const P = F.props_of(ctx.items.get(b))
		sent = message_of(own(P, "pattern") ? P.pattern : null)
		dot = own(P, "dot_s") ? P.dot_s : null
	}
	dot = typeof dot === "number" && dot > 0 ? Number(dot) : 0.2
	const h = ctx.state(a, "hit")
	const key = h && h.length ? "hit" : "lit"
	const [text, bits] = read_flashes(ctx.state(a, key) ?? [], ctx.times, dot)
	const morse = sent !== "" && ![...sent].every((ch) => ch === "0" || ch === "1")
	const got = morse ? text : bits
	const asked = message_of(g.message)
	const want = asked !== "" ? asked : sent
	const ok = want !== "" && got === want
	const label = F.py.truthy(g.label) ? g.label : `${ctx.name(a)} reads ${ctx.name(b)}'s message "${want}"`
	return { label, ok, kind: "receives", sensor: a, light: b, sent: want, got }
}

export const GOALS = { goal_hits_target, goal_lit, goal_dark, goal_shadow_on, goal_sees, goal_brighter, goal_focused, goal_rainbow, goal_receives }

// ================================================================ the AI's plug-ins (web/sim/plugins.js)
import * as O from "../optics.js"

const TRACES = new WeakMap()
const deg = (rad) => {
	let d = (rad * 180) / Math.PI
	while (d > 180) d -= 360
	while (d <= -180) d += 360
	return Math.round(d * 10) / 10
}
const cmOf = (m) => `${Math.round(m * 1000) / 10} cm`
const at = (x, y) => `x ${x.toFixed(2)} m, y ${y.toFixed(2)} m`

/** The run's light traced at its last moment (the engine's own tracer, web/sim/optics.js), or null for a run without light. */
function traced(run) {
	if (!run || typeof run !== "object" || !run.doc?.solids) return null
	if (TRACES.has(run)) return TRACES.get(run)
	let out = null
	try {
		const rec = (run.doc.processes ?? []).find((p) => p && p.kind === "optics")
		if (rec) {
			const fr = run.track?.frames ?? []
			const first = fr[0]?.placements ?? {}
			const last = fr[fr.length - 1]?.placements ?? {}
			const solids = new Map(run.doc.solids.map((s) => [s.id, s]))
			const pose = (id) => {
				const p = last[id] ?? first[id]
				if (p) return { x: p.x, y: p.y, angle: p.angle }
				const s = solids.get(id)
				return s ? { x: s.at.x, y: s.at.y, angle: s.angle ?? 0 } : undefined
			}
			const sc = O.sceneFromRecord(rec, (id) => solids.get(id))
			const state = run.track?.state ?? {}
			const tEnd = fr.length ? fr[fr.length - 1].t : 0
			const endOf = (item, key) => {
				const v = state[item]?.[key]
				return Array.isArray(v) && v.length && typeof v[v.length - 1] === "number" ? v[v.length - 1] : undefined
			}
			const levels = sc.sources.map((s, i) => lightLevel(rec.sources[i], endOf, tEnd))
			// (a liquid's surface where the liquids module's level reading leaves it at the end)
			const bodies = O.withLevels(sc.bodies, endOf)
			const res = O.trace({ bodies, sources: sc.sources, pose, level: (s) => levels[sc.sources.indexOf(s)] ?? 0, segments: true })
			out = { rec, sc: { ...sc, bodies }, res, levels, names: new Map(rec.names ?? []) }
		}
	} catch {
		out = null
	}
	TRACES.set(run, out)
	return out
}

/** A source's level at a moment from the readings (read(item, key) → number | undefined): its `on` reading (0/1) when the run has one,
 *  else its switch times and blink pattern; times its drive (a circuit bulb's `light` reading against rated). The 3D view does the same. */
export function lightLevel(r, read, t) {
	const on = read(r.item, "on")
	let v = typeof on === "number" ? (on > 0.5 ? 1 : 0) : O.switchedOn(r, t)
	if (v > 0 && r.drive && typeof r.drive.item === "string") {
		const d = read(r.drive.item, r.drive.key)
		v *= Math.max(0, typeof d === "number" ? d : 0) * (typeof r.drive.scale === "number" ? r.drive.scale : 1)
	}
	return v
}

/** The CIE 1931 colour matching functions' means over the tracer's 7 visible bands (Wyman, Sloan & Shirley, JCGT 2(2), 2013: the
 *  multi-lobe fit of x̄, ȳ, z̄), for naming the colour light on a surface looks. */
const CMF_BANDS = (() => {
	const g = (l, mu, s1, s2) => {
		const t = (l - mu) / (l < mu ? s1 : s2)
		return Math.exp(-0.5 * t * t)
	}
	const xb = (l) => 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2)
	const yb = (l) => 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1)
	const zb = (l) => 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8)
	return O.BANDS.slice(0, 7).map((b) => {
		let x = 0
		let y = 0
		let z = 0
		for (let l = b.lo; l < b.hi; l++) {
			x += xb(l + 0.5)
			y += yb(l + 0.5)
			z += zb(l + 0.5)
		}
		const n = b.hi - b.lo
		return [x / n, y / n, z / n]
	})
})()
// the Planckian locus (CIE 1931 x, y) from 2500 K to 10 000 K: light near it looks white
const PLANCK_XY = [[2500, 0.477, 0.4137], [2856, 0.4476, 0.4074], [3500, 0.4053, 0.3907], [4000, 0.3805, 0.3768], [5000, 0.3451, 0.3516], [6500, 0.3135, 0.3236], [10000, 0.2807, 0.2884]]
// hue (degrees about D65's 0.3127, 0.3290) where each name begins, going round: from the spectral locus (dominant 610, 590, 565, 495, 480, 450 nm)
const HUES = [[10, "orange"], [28, "yellow"], [70, "green"], [150, "cyan"], [205, "blue"], [245, "violet"], [262, "magenta"], [345, "red"]]

/** The colour light on a surface looks, in words, from its 7 visible bands (W): white near the Planckian locus (warm white below 3300 K),
 *  else the name of its hue (red + green light of balanced brightness: yellow; red + blue: magenta; green + blue: cyan). */
export function colourWord(bands) {
	let X = 0
	let Y = 0
	let Z = 0
	for (let k = 0; k < 7; k++) {
		const w = bands[k] > 0 ? bands[k] : 0
		X += w * CMF_BANDS[k][0]
		Y += w * CMF_BANDS[k][1]
		Z += w * CMF_BANDS[k][2]
	}
	const S = X + Y + Z
	if (!(S > 0)) return null
	const x = X / S
	const y = Y / S
	let best = Infinity
	let T = 6500
	for (let i = 0; i + 1 < PLANCK_XY.length; i++) {
		const [ta, xa, ya] = PLANCK_XY[i]
		const [tb, xb, yb] = PLANCK_XY[i + 1]
		const dx = xb - xa
		const dy = yb - ya
		const u = Math.max(0, Math.min(1, ((x - xa) * dx + (y - ya) * dy) / (dx * dx + dy * dy)))
		const d = Math.hypot(x - xa - u * dx, y - ya - u * dy)
		if (d < best) {
			best = d
			T = ta + u * (tb - ta)
		}
	}
	// (0.08: the tracer's 7 bands blur a narrow peak, a white LED's blue one most: its band colour sits ≈ 0.06 off the locus)
	if (best < 0.08) return T < 3300 ? "warm white" : "white"
	let h = (Math.atan2(y - 0.329, x - 0.3127) * 180) / Math.PI
	if (h < 0) h += 360
	let name = "red"
	for (const [from, word] of HUES) if (h >= from) name = word
	return name
}

/** A source's strongest path in words: the items its beam meets, in order (from the segments that carry most of its power). */
function pathOf(T, si, nameOf) {
	const segs = T.res.segments.filter((g) => g.src === si)
	if (!segs.length) return null
	const pw = (g) => g.p.reduce((a, b) => a + b, 0)
	let cur = segs.filter((g) => g.root === segs[0].root || segs.length < 40).sort((a, b) => pw(b) - pw(a))[0]
	// (a fan: the ray down its middle)
	const roots = [...new Set(segs.map((g) => g.root))]
	if (roots.length > 1) {
		const mid = roots[Math.floor(roots.length / 2)]
		const first = segs.filter((g) => g.root === mid)
		cur = first[0]
	}
	const steps = []
	const seen = new Set()
	for (let n = 0; cur && n < 12; n++) {
		const b = cur.end >= 0 ? T.sc.bodies[cur.end] : null
		const heading = deg(Math.atan2(cur.y1 - cur.y0, cur.x1 - cur.x0))
		if (!b) {
			steps.push(`heads off at ${heading}° (meets nothing)`)
			break
		}
		const nm = nameOf(b.item)
		steps.push(`${nm} at ${at(cur.x1, cur.y1)} (arriving at ${heading}°)`)
		const key = `${cur.x1.toFixed(6)},${cur.y1.toFixed(6)}`
		if (seen.has(key)) break
		seen.add(key)
		const next = segs.filter((g) => Math.abs(g.x0 - cur.x1) < 1e-9 && Math.abs(g.y0 - cur.y1) < 1e-9 && g.root === cur.root).sort((a, c) => pw(c) - pw(a))[0]
		cur = next
	}
	return steps
}

/** The edit step's lines for an item (the readings at the run's end and what happened, from the summary; with the whole run at hand also
 *  each beam's path in words, from the tracer). */
function digest(item, run, h) {
	void h
	const id = item?.id
	const type = item?.type
	if (!id) return null
	const R = run?.summary?.readings?.[id] ?? {}
	const hap = Array.isArray(run?.summary?.happenings) ? run.summary.happenings : Array.isArray(run?.track?.events) ? run.track.events : []
	const lines = []
	const T = traced(run)
	const nameOf = (x) => T?.names?.get(x) ?? x
	const f = (v, d = 1) => (typeof v === "number" ? (Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Math.round(v * 10 ** d) / 10 ** d)) : "?")
	const recSrc = T ? T.rec.sources.filter((s) => s.item === id) : []
	const isSource = ["flashlight", "laser-pointer", "sunlight", "lit-arrow", "lamp"].includes(type) || recSrc.length > 0
	if (isSource) {
		if (R.on === 0) lines.push("light: off at the run's end")
		const reach = hap.filter((e) => e.kind === "light" && e.items?.[0] === id).map((e) => e.items[1])
		if (reach.length) lines.push(`its light reaches: ${reach.map(nameOf).join(", ")}`)
		else if (R.on !== 0) lines.push("its light reaches nothing (aim it at what it should light)")
	}
	if (type === "mirror") {
		if (typeof R.beam_in_deg === "number") {
			lines.push(`the strongest beam arrives at its face travelling at ${f(R.beam_in_deg)}° (its aim now ${f(item.props?.aim ?? 180)}°)`)
			const aims = Object.entries(R).filter(([k, v]) => k.startsWith("aim_for:") && typeof v === "number").map(([k, v]) => `aim ${f(v)}° sends it to ${nameOf(k.slice(8))}`)
			if (aims.length) lines.push(`to steer the beam: ${aims.slice(0, 6).join("; ")}`)
		} else lines.push("no beam meets its shiny face: aim the light at it, or turn it to face the light")
	}
	if (type === "light-meter" && typeof R.lux === "number") lines.push(`reads ${f(R.lux, 0)} lx (${f(R.wm2, 2)} W/m²) at the run's end${R.lit === 1 ? ": lit" : ": below its threshold"}`)
	if (type === "light-sensor") lines.push(R.hit === 1 ? `light reaches it (${f(R.mw, 3)} mW)` : "no light reaches it")
	if (type === "screen") {
		if (typeof R.shadow_cm === "number") lines.push(`shadow on it: ${f(R.shadow_cm)} cm; lit ${f(R.lit_pct, 0)} % of its face`)
		const cast = hap.filter((e) => e.kind === "shadow" && e.items?.[1] === id).map((e) => e.text)
		if (cast.length) lines.push(cast.join("; "))
		if (typeof R.image_cm === "number") lines.push(`image of the lit object: ${f(R.image_cm, 2)} cm (negative = upside down), blur ${f(R.blur_mm)} mm`)
		if (typeof R.colors === "number" && R.colors > 0) lines.push(`colours of split light on it: ${R.colors} (violet to red ${f(R.spread_mm)} mm apart)`)
	}
	if (type === "eye") {
		const seen = hap.filter((e) => e.kind === "sees" && e.items?.[0] === id).map((e) => e.text)
		lines.push(seen.length ? seen.join("; ") : "it sees nothing (nothing lit in front of it)")
	}
	// a blinking light's flashes, read back by a sensor (the receives goal's reading)
	if ((type === "light-sensor" || type === "light-meter") && typeof R.pulses === "number" && T) {
		const st = run?.track?.state?.[id] ?? {}
		const seq = Array.isArray(st.hit) && st.hit.length ? st.hit : st.lit
		const times = (run?.track?.frames ?? []).map((f) => f.t)
		for (const src of T.rec.sources) {
			if (!Array.isArray(src.blink) || !src.blink.length || !hap.some((e) => e.kind === "light" && e.items?.[0] === src.item && e.items?.[1] === id)) continue
			const dot = typeof src.dot === "number" && src.dot > 0 ? src.dot : 0.2
			const [text, bits] = read_flashes(seq ?? [], times, dot)
			lines.push(`it saw ${R.pulses} flashes from ${nameOf(src.item)}: read back as Morse "${text || "?"}", as on/off ${bits || "nothing"} (between flashes it is dark: its end reading can be 0)`)
		}
	}
	// the colour of the light on a screen (mixed coloured torches)
	if (type === "screen" && T) {
		const bands = [0, 0, 0, 0, 0, 0, 0]
		T.res.deposits.forEach((d) => {
			if (d.volume || T.sc.bodies[d.body]?.item !== id) return
			for (let k = 0; k < 7; k++) bands[k] += d.incident[k]
		})
		const w = colourWord(bands)
		if (w) lines.push(`the light on it looks ${w}`)
	}
	// a container's liquid as the light sees it
	if (T) {
		const liq = T.sc.bodies.filter((b) => b.item === id && b.liquid !== undefined)
		if (liq.length) {
			const n = (b) => {
				const m = O.MEDIA[b.medium]
				const v = m ? m.n(0.5893) + (typeof b.nd === "number" ? b.nd - m.n(0.5893) : 0) : 1.333
				return Math.round(v * 1000) / 1000
			}
			lines.push(`its liquid bends light: ${liq.map((b) => `${b.medium} n ${n(b)}`).join(", ")} (surface where the liquid stands; a beam going in slants toward the vertical)`)
		}
	}
	if (typeof R.light_w === "number" && R.light_w > 0 && !isSource) lines.push(`takes in ${f(R.light_w, 4)} W of light`)
	if (hap.some((e) => e.kind === "tir" && e.items?.[0] === id)) lines.push("light is totally reflected inside it")
	// the whole run at hand (the page, the make-it-work search): each beam's path from the tracer
	if (T && isSource) {
		T.sc.sources.forEach((s, i) => {
			if (s.item !== id || !(T.levels[i] > 0) || !(s.kind === "laser" || s.kind === "sun")) return
			const p = pathOf(T, i, nameOf)
			if (p) lines.push(`its beam: ${p.join(" → ")}`)
		})
	}
	return lines.length ? lines : null
}

const num2 = (v) => (typeof v === "number" ? (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100)) : String(v))
function change(type, key, a, b, nameOf) {
	void nameOf
	const T = F?.TYPES?.[type]
	if (!T || T.module !== "optics") return null
	if (key === "aim") {
		const d = Math.round((Number(b) - Number(a)) * 10) / 10
		const turn = `turned ${Math.abs(d)}° ${d > 0 ? "anticlockwise" : "clockwise"} (aim ${num2(a)}° → ${num2(b)}°)`
		return type === "mirror" ? `${turn}: the reflected beam turns ${Math.abs(2 * d)}°` : turn
	}
	if (key === "lumens") return `brightness ${num2(a)} → ${num2(b)} lm`
	if (key === "beam_angle") return `beam ${num2(a)}° → ${num2(b)}° wide`
	if (key === "power_mw") return `power ${num2(a)} → ${num2(b)} mW`
	if (key === "focal_length") return `focal length ${cmOf(a)} → ${cmOf(b)}`
	if (key === "elevation") return `the sun ${num2(a)}° → ${num2(b)}° high`
	if (key === "irradiance") return `sunlight ${num2(a)} → ${num2(b)} W/m²`
	if (key === "reflectance") return `reflects ${Math.round(a * 100)} % → ${Math.round(b * 100)} %`
	if (key === "sample") return `${a} → ${b}`
	if (key === "color") return `${a} → ${b}`
	if (key === "on") return b ? "switched on" : "switched off"
	if (key === "on_at") return `switched on at ${num2(a)} s → ${num2(b)} s`
	if (key === "pattern") return `blinks ${a ?? "steady"} → ${b ?? "steady"}`
	if (key === "dot_s") return `Morse dot ${num2(a)} s → ${num2(b)} s`
	if (key === "repeat") return b ? "repeats its message" : "sends its message once"
	if (key === "glass" && type === "glass-block") return `${a} → ${b}`
	return null
}

const pickIds = (scene, types) => (scene?.items ?? []).filter((i) => types.includes(i.type)).map((i) => i.id)
const anyIds = (scene) => (scene?.items ?? []).filter((i) => i.type !== "table").map((i) => i.id)
const LIGHTS_T = ["flashlight", "laser-pointer", "sunlight", "lit-arrow", "lamp"]

export const plugin = {
	title: "Light and optics",
	howto:
		"Light items shine in the scene's plane: a flashlight (a cone, lumens, beam_angle), a laser pointer (one thin beam), sunlight (parallel light at an elevation, " +
		"in a band centred on its marker) and the heat module's desk lamp; a lit arrow is a lit object for lens images. Every optics item points where its `aim` prop " +
		"says (degrees: 0 = right, 90 = up, 180 = left, -90 = down; leave the item's own angle at 0): a light shines along its aim; a mirror's shiny face, a light " +
		"meter's sensor and an eye's look face along their aim (mirrors and meters default to 180, facing a light on their left); a lens's axis runs along its aim. " +
		"Optics items stand on stands (they never fall): place them on \"air\" with y_m = the height of the beam (or on the table). Light goes straight until it " +
		"meets something: opaque things (most items: balls, blocks, books, the table) stop it and cast shadows, mirrors reflect it (angle in = angle out; a mirror " +
		"turned x° turns its beam 2x°; to send a beam arriving in direction A on in direction B, set the mirror's aim to (A + 180 + B) / 2), glass, water, ice and " +
		"clear plastic bend it (a prism splits white light into a rainbow; a convex lens brings parallel light to a point focal_length behind it; a semicircular " +
		"block totally reflects past 41°), material panels sort materials (transparent / translucent / opaque), colour filters pass their colour. Measuring: a " +
		"light-meter reads lux on its sensor (sunlight ≈ 100 000 lx; a 150 lm flashlight at 1 m ≈ 1 600 lx in its beam; twice as far → a quarter), a light-sensor " +
		"(target) registers whether a light reaches it, a screen shows shadows (its reading: the shadow's size; a point light makes the shadow grow as the " +
		"object nears the light), an eye sees things that are lit (or lights) in front of it, also by mirrors. Light absorbed heats (each lit item's `light_w`). " +
		"Liquids bend light too: the water (salt water, oil, syrup, honey, alcohol) in the liquids module's water-tank, beaker, graduated-cylinder, " +
		"measuring-jug and density-column refracts with its own index (water 1.333, oil 1.47), its surface where the liquid stands now: a laser into " +
		"an aquarium at 45° goes on at 32° in the water; a coin on the bottom of an opaque jug hidden behind its rim from an eye shows once there is " +
		"water in it (sees {eye, coin}); a pencil standing in a beaker of water looks broken at the surface. The circuits module's bulbs and LEDs " +
		"shine as lights too (as bright as their `light` reading: a bulb on 2 cells reads more lux on a light-meter than on 1; they cast shadows " +
		"on a screen). A flashlight's `color` (white, red, green, blue) mixes on a white screen (red + green = yellow, all three white; two " +
		"coloured torches make two coloured shadows); its `pattern` blinks a message (SOS in Morse code, or 1s and 0s, dot_s each) that a " +
		"light-sensor or light-meter it reaches reads back: receives {sensor, light}.",
	prompt: {
		plan:
			"Optics: set every optics item's `aim` (0 right, 90 up, 180 left, -90 down) and leave its angle 0; give lights and what they light the same height (or aim the " +
			"light at it); put mirrors, lenses, prisms and panels where the beam passes, their centre on the beam; for a shadow, line up light → opaque thing → screen; " +
			"a flat mirror reflects only on the face its aim points to (aim = (A + 180 + B)/2 turns a beam travelling at A into one travelling at B); light meters and eyes " +
			"face the light or what they look at. Check light with goals: hits_target {light, target}, lit {item, at_least_lux?}, dark {item}, shadow_on {occluder, " +
			"screen}, sees {eye, item}, brighter {a, b}, receives {sensor, light, message?} (a blinking flashlight's message read back by a light-sensor); a " +
			"meter's number: reads {item, value, tol}. A run of 1-2 s is enough for light that does not move; a blinking message needs its whole pattern " +
			"(SOS at dot_s 0.2 s takes 5.4 s): set seconds long enough. Light into water: a laser aimed through an aquarium's glass wall, or down " +
			"through the surface (its y above the water's top). Circuit bulbs light the scene when their circuit is closed.",
		edit:
			"Optics: turning a mirror by x° turns its reflected beam by 2x° (its `aim`); moving a small light twice as far makes it a quarter as bright (1/d²); a shadow " +
			"grows as the object nears the light; a wider beam_angle spreads the same lumens over more; read each light's beam path and each mirror's suggested aims in " +
			"the digest lines before changing an aim. A changed liquid (salt water, oil) bends the beam a little differently, a changed colour or blink pattern " +
			"sends different light: change only what was asked (never resize or move a target, a sensor or a light to keep a goal); the card says if a goal now fails.",
		refine:
			"Optics: when light misses its target, change the aim of the light or of the mirror the digest names (its line says the aim that would send the beam to each " +
			"receiver); move a meter nearer to read more; keep the lesson's compared materials and colours as they are."
	},
	examples: [
		{ ask: "Show that light travels in straight lines", how: "a laser-pointer (aim 0) and a light-sensor at the same height 1 m to its right (hits_target); a second laser with a cardboard material-panel between it and its own target: that target stays dark (dark {target})" },
		{ ask: "Make a shadow on a screen with a ball and a flashlight; nearer the light, a bigger shadow", how: "flashlight aim 0 at y 0.3, a fixed tennis-ball 0.4 m to its right at the same height, a screen 1.2 m to its right (height 0.6): shadow_on {occluder: ball, screen}; its shadow_cm reading grows as the ball nears the light (5 cm card 20 cm from the light, screen at 60 cm: 15 cm)" },
		{ ask: "Bounce a laser off a mirror onto a target", how: "laser-pointer aim 0; a mirror where the beam passes, aim (0 + 180 + 90)/2 = 135 to send it straight up; a light-sensor above the mirror: hits_target {light: laser, target}" },
		{ ask: "Show that light bends when it goes into glass (or water)", how: "laser-pointer aimed down at aim -45 onto a glass-block on a stand; it bends to 28° inside and leaves parallel, shifted; a light-sensor on the exit path: hits_target" },
		{ ask: "Total internal reflection in a glass block", how: "semicircle-block (aim 0: flat face right); a laser aimed through the round side at the middle of the flat face: 40° from the face's normal gets out, 43° is totally reflected back (a tir happening); light-sensors on both paths" },
		{ ask: "Which materials let light through? glass, wax paper, cardboard, foil", how: "one lane each: flashlight (beam_angle 10) → material-panel → light-meter 5 cm behind it (aim 180); brighter {glass meter, wax meter}, lit {wax meter}, dark {cardboard meter}, dark {foil meter} (glass passes ≈ 92 %)" },
		{ ask: "A light meter near and far from a lamp: nearer is brighter", how: "the desk lamp (aim 45, beam_angle 60, head_height 0.6) with two light-meters on its beam, 0.5 m and 1 m from the bulb, each aimed back at it: brighter {near, far} (about 4 : 1, 1/d²)" },
		{ ask: "We see a book because light bounces off it into our eye", how: "a flashlight lighting a hardcover-book, an eye aimed at the book: sees {eye, book}; with the flashlight off (on false) the eye sees nothing (its sees reading 0)" },
		{ ask: "A convex lens makes an upside-down image", how: "lit-arrow, a convex-lens (f 0.10) 0.30 m to its right, a screen 0.15 m behind the lens (1/f = 1/d_o + 1/d_i): focused {screen}; the screen's image_cm reading is −½ the arrow's height" },
		{ ask: "Split white light into a rainbow with a prism", how: "sunlight through a slit (width 0.005) at elevation ≈ 24° from the left onto a flint prism turned apex down (aim 180), a screen beyond it: rainbow {screen}" },
		{ ask: "A magnifying glass focuses sunlight", how: "sunlight at elevation 90, a convex-lens with aim 90 (axis vertical), a light-meter facing up (aim 90) focal_length below it: lit {meter, at_least_lux: 1000000}" },
		{ ask: "Black takes in more of the sun's light than white", how: "sunlight on a white card and a black cloth material-panel lying flat (aim 90): brighter {black, white} (black absorbs ≈ 0.97, white ≈ 0.2)" },
		{ ask: "Colour filters: a red filter lets red light through and stops green", how: "a flashlight (beam_angle 10) through a color-filter (color red) onto a screen, and a green laser-pointer through a second red color-filter onto a light-sensor: hits_target {torch, screen} (the red part passes, ≈ 0.88 of it), lit {sensor} labelled as a little green getting through (≈ 2 %)" },
		{ ask: "A lamp's light warms the ice cube it shines on", how: "the heat module's lamp (target: the ice-cube it points at) and two ice-cubes on the table, one in its beam and one well away from it: hits_target {lamp, lit cube}, brighter {lit cube, other cube} (light taken in, W; with the heat module the lit cube melts first)" },
		{ ask: "See over a wall with a periscope", how: "an eye low behind a wall (aim 180), a mirror in front of it at aim 45 and one above it at aim 225, a lit book on the far side above the wall: sees {eye, book}" },
		{ ask: "Light bends when it goes into water: a laser into an aquarium", how: "a water-tank (aquarium, fill 0.2) on the table, a laser-pointer above its left half aimed down at aim -45 so the beam meets the water's surface: it goes on at 32° from the vertical in the water (n 1.333); a light-sensor on the tank's floor where the bent beam lands: hits_target {laser, sensor}" },
		{ ask: "The disappearing coin: a coin in a cup shows when water is poured in", how: "a measuring-jug (opaque plastic) with a penny on its bottom, a flashlight above shining down into it, an eye beside it just below the rim's sight line looking at the bottom (aim about -60): with fill_ml 0 sees {eye, penny} fails, with fill_ml 500 it holds (the light from the coin bends over the rim)" },
		{ ask: "A pencil in a glass of water looks bent", how: "a beaker of water with a chopstick or pencil leaning in it, lit by a flashlight, and an eye looking at it from the side and above: sees {eye, pencil}; the part under the water is seen at a steeper angle than the part above (the digest's beam path through the water shows the bend)" },
		{ ask: "Mix red, green and blue light; coloured shadows", how: "three flashlights (color red, green, blue, beam_angle 30) a little apart aimed at one white screen, a ball between them and the screen: shadow_on {ball, screen}; where red and green overlap the screen looks yellow, all three white; the ball casts a coloured shadow for each torch" },
		{ ask: "Send a message with a flashlight (Morse code)", how: "a flashlight with pattern SOS (dot_s 0.2, beam_angle 10) aimed at a light-sensor 1 m away, seconds 6: receives {sensor, light: flashlight} (it reads back SOS; the sensor's pulses reading counts the flashes)" },
		{ ask: "A bulb with 2 batteries is brighter than with 1", how: "two circuits side by side (each a battery (1 or 2 cells) wired to a bulb), a light-meter 10 cm above each bulb facing down (aim -90): brighter {meter over the 2-cell bulb, meter over the 1-cell bulb}" }
	],
	goals: [
		{
			kind: "hits_target", aliases: ["light_hits", "lights_target", "reaches", "light_reaches", "hits_light"], fields: { light: "item", target: "item", before_s: "number?" }, subject: ["light"],
			about: "hits_target {light, target, before_s?}: some of that light source's light reaches the target (straight, or by mirrors, lenses, glass)",
			label: (g, n) => `${n(g.light)}'s light reaches ${n(g.target)}`,
			summarize: (ctx, g) => goal_hits_target(ctx, g),
			sample: (scene, pick) => {
				const l = pickIds(scene, LIGHTS_T)
				const o = anyIds(scene)
				return l.length && o.length ? { kind: "hits_target", light: pick(l), target: pick(o), ...(pick([true, false]) ? { before_s: 0.5 } : {}) } : null
			}
		},
		{
			kind: "lit", aliases: ["is_lit", "lights_up", "bright"], fields: { item: "item", at_least_lux: "number?" },
			about: "lit {item, at_least_lux?}: at the run's end light falls on it (a light meter: it reads at least at_least_lux, default 1 lx)",
			label: (g, n) => `${n(g.item)} is lit`,
			summarize: (ctx, g) => goal_lit(ctx, g),
			sample: (scene, pick) => {
				const o = anyIds(scene)
				return o.length ? { kind: "lit", item: pick(o), ...(pick([true, false]) ? { at_least_lux: pick([1, 100, 5000]) } : {}) } : null
			}
		},
		{
			kind: "dark", aliases: ["in_the_dark", "unlit", "no_light"], fields: { item: "item", at_most_lux: "number?" },
			about: "dark {item, at_most_lux?}: at the run's end (almost) no light falls on it (a light meter: at most at_most_lux, default 1 lx)",
			label: (g, n) => `${n(g.item)} is dark`,
			summarize: (ctx, g) => goal_dark(ctx, g),
			sample: (scene, pick) => {
				const o = anyIds(scene)
				return o.length ? { kind: "dark", item: pick(o) } : null
			}
		},
		{
			kind: "shadow_on", aliases: ["shadow", "casts_shadow", "shadow_falls"], fields: { occluder: "item", screen: "item" }, subject: ["occluder"],
			about: "shadow_on {occluder, screen}: the occluder's shadow falls on the screen (light that would reach the screen stops on it)",
			label: (g, n) => `${n(g.occluder)} casts a shadow on ${n(g.screen)}`,
			summarize: (ctx, g) => goal_shadow_on(ctx, g),
			sample: (scene, pick) => {
				const s = pickIds(scene, ["screen"])
				const o = anyIds(scene)
				return s.length && o.length ? { kind: "shadow_on", occluder: pick(o), screen: pick(s) } : null
			}
		},
		{
			kind: "sees", aliases: ["can_see", "see", "eye_sees"], fields: { eye: "item", item: "item" }, subject: ["eye"],
			about: "sees {eye, item}: light from the item (its own, or light it scatters) enters the eye, straight or by mirrors",
			label: (g, n) => `${n(g.eye)} sees ${n(g.item)}`,
			summarize: (ctx, g) => goal_sees(ctx, g),
			sample: (scene, pick) => {
				const e = pickIds(scene, ["eye"])
				const o = anyIds(scene)
				return e.length && o.length ? { kind: "sees", eye: pick(e), item: pick(o) } : null
			}
		},
		{
			kind: "brighter", aliases: ["more_light", "brighter_than"], fields: { a: "item", b: "item" }, subject: ["a"],
			about: "brighter {a, b}: at the run's end light meter a reads more than b (other items: a takes in more light than b)",
			label: (g, n) => `${n(g.a)} gets more light than ${n(g.b)}`,
			summarize: (ctx, g) => goal_brighter(ctx, g),
			sample: (scene, pick) => {
				const o = anyIds(scene)
				return o.length > 1 ? { kind: "brighter", a: pick(o), b: pick(o) } : null
			}
		},
		{
			kind: "focused", aliases: ["sharp_image", "image_sharp", "in_focus", "image"], fields: { screen: "item" },
			about: "focused {screen}: a lit object's image on the screen is sharp (a convex lens between them at the right distances: 1/f = 1/d_o + 1/d_i)",
			label: (g, n) => `A sharp image forms on ${n(g.screen)}`,
			summarize: (ctx, g) => goal_focused(ctx, g),
			sample: (scene, pick) => {
				const s = pickIds(scene, ["screen"])
				return s.length ? { kind: "focused", screen: pick(s) } : null
			}
		},
		{
			kind: "receives", aliases: ["reads_message", "decodes", "gets_message", "receives_message", "morse"], fields: { sensor: "item", light: "item", message: "string?" }, subject: ["light"],
			about: "receives {sensor, light, message?}: a blinking flashlight's message (its pattern: a Morse word such as SOS, or 1s and 0s) reaches the light-sensor or light-meter and reads back right (or reads `message`)",
			label: (g, n) => `${n(g.sensor)} reads ${n(g.light)}'s message`,
			summarize: (ctx, g) => goal_receives(ctx, g),
			sample: (scene, pick) => {
				const l = pickIds(scene, ["flashlight"])
				const s = pickIds(scene, ["light-sensor", "light-meter"])
				return l.length && s.length ? { kind: "receives", sensor: pick(s), light: pick(l) } : null
			}
		},
		{
			kind: "rainbow", aliases: ["spectrum", "colors_on", "colours_on", "splits"], fields: { screen: "item" },
			about: "rainbow {screen}: white light split into its colours (a prism) lands on the screen, violet and red apart",
			label: (g, n) => `A rainbow falls on ${n(g.screen)}`,
			summarize: (ctx, g) => goal_rainbow(ctx, g),
			sample: (scene, pick) => {
				const s = pickIds(scene, ["screen"])
				return s.length ? { kind: "rainbow", screen: pick(s) } : null
			}
		}
	],
	knobs: [
		{ type: "flashlight", key: "aim", how: "deg", more: "turn {it} up", less: "turn {it} down", why: "points its beam (degrees: 0 right, 90 up)" },
		{ type: "flashlight", key: "lumens", how: "rel", more: "make {it} brighter", less: "make {it} dimmer", why: "the light everywhere in its beam grows with its lumens" },
		{ type: "flashlight", key: "beam_angle", how: "deg", steps: [2, 4, 6, 10], more: "widen {it}'s beam", less: "narrow {it}'s beam", why: "a wider cone reaches more, each place dimmer" },
		{ type: "flashlight", key: "dot_s", how: "rel", cost: 2, more: "blink {it} slower", less: "blink {it} faster", why: "a longer dot sends the same message more slowly (the run must last the whole message)" },
		{ type: "measuring-jug", key: "fill_ml", how: "rel", cost: 2, more: "pour more water into {it}", less: "pour some water out of {it}", why: "a higher water surface bends the light from what lies on the bottom further over the rim (the coin appears)" },
		{ type: "beaker", key: "fill_ml", how: "rel", cost: 2, more: "pour more water into {it}", less: "pour some water out of {it}", why: "the water's surface is where light bends: more water covers more of what stands in it" },
		{ type: "laser-pointer", key: "aim", how: "deg", steps: [0.5, 1, 2, 3, 5, 8, 12, 20], more: "turn {it} up", less: "turn {it} down", why: "points its beam (degrees)" },
		{ type: "laser-pointer", key: "power_mw", how: "rel", more: "make {it} stronger", less: "make {it} weaker", why: "more power, a brighter spot (same path)" },
		{ type: "mirror", key: "aim", how: "deg", steps: [0.5, 1, 2, 3, 5, 8, 12, 20, 30], more: "turn {it} anticlockwise", less: "turn {it} clockwise", why: "turning a mirror by x° turns its reflected beam by 2x°" },
		{ type: "curved-mirror", key: "aim", how: "deg", more: "turn {it} anticlockwise", less: "turn {it} clockwise", why: "points its face (and its focus)" },
		{ type: "curved-mirror", key: "focal_length", how: "rel", more: "flatten {it}", less: "curve {it} more", why: "its focus is focal_length in front of it" },
		{ type: "convex-lens", key: "focal_length", how: "rel", more: "use a weaker lens in {it}'s place", less: "use a stronger lens in {it}'s place", why: "parallel light meets focal_length behind it; an image forms where 1/f = 1/d_o + 1/d_i" },
		{ type: "convex-lens", key: "aim", how: "deg", more: "tilt {it} up", less: "tilt {it} down", why: "its axis should run along the light" },
		{ type: "concave-lens", key: "aim", how: "deg", more: "tilt {it} up", less: "tilt {it} down", why: "its axis should run along the light" },
		{ type: "prism", key: "aim", how: "deg", more: "turn {it} anticlockwise", less: "turn {it} clockwise", why: "how the beam meets its faces sets how much it bends and spreads" },
		{ type: "glass-block", key: "aim", how: "deg", more: "turn {it} anticlockwise", less: "turn {it} clockwise", why: "a steeper slant bends the beam more" },
		{ type: "semicircle-block", key: "aim", how: "deg", more: "turn {it} anticlockwise", less: "turn {it} clockwise", why: "past the critical angle the light is totally reflected" },
		{ type: "light-meter", key: "aim", how: "deg", more: "turn {it} anticlockwise", less: "turn {it} clockwise", why: "a sensor facing the light reads the most" },
		{ type: "light-sensor", key: "size", how: "rel", cost: 2, more: "make {it} bigger", less: "make {it} smaller", why: "a bigger target catches more of a spread beam" },
		{ type: "screen", key: "height", how: "rel", cost: 2, more: "make {it} taller", less: "make {it} shorter", why: "a taller screen catches more of the light and the whole shadow" },
		{ type: "eye", key: "aim", how: "deg", more: "turn {it} anticlockwise", less: "turn {it} clockwise", why: "it sees only what is in front of it" },
		{ type: "sunlight", key: "elevation", how: "deg", more: "raise {it}", less: "lower {it}", why: "a higher sun casts shorter shadows and puts more light on flat ground (∝ sin of its height)" },
		{ type: "sunlight", key: "irradiance", how: "rel", more: "make {it} stronger", less: "make {it} weaker", why: "how bright the sunlight is (clear noon ≈ 1000 W/m²)" },
		{ type: "lit-arrow", key: "aim", how: "deg", more: "turn {it} up", less: "turn {it} down", why: "points its light at the lens" }
	],
	digest,
	words: { change }
}
