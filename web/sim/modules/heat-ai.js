// The heat module's AI plug-ins (web/sim/plugins.js): how its items work together for the catalog digest, its prompt lines, its goal kinds
// (summarized by web/sim/modules/heat.js's goal functions, which machines/mod_heat.py matches number for number), the make-it-work search's
// knobs, the edit step's digest lines, the solver's placement rules and the change words. heat.js calls heatPlugin(api) once it has defined
// what this needs (no import cycle): api = {goals: {melts, melts_first, ...}, BULBS, CUPS, lamp_geometry, cone_radius, clock}.

const HOWTO = [
	"Heat runs in a scene that holds a heat item (salt-pile, plate, bowl, lamp, thermometer, hot-plate, saucepan, drink-cup, spoon, meltable, puddle) or sets settings.room_temp or settings.time_lapse; then every moving thing has a temperature: ice cubes (ice-cube, start_temp_c −18 °C from a freezer) melt and shrink, their melt water runs into a puddle; steel-rod (material copper, aluminium, steel, stainless steel or glass) and wooden-rod conduct along their length; a fluids container's water (water-tank, beaker, measuring-jug, graduated-cylinder) has the temperature of its water_temp_c, and its level (level_mm) follows heat's water: floating ice that melts leaves the level where it was, evaporation lowers it. The room is settings.room_temp (default 20 °C; a classroom 22).",
	"TIME-LAPSE: melting, cooling and evaporating take minutes to hours, so set settings.time_lapse (lesson seconds per run second) so that seconds × time_lapse covers the story; motion stays real-time. A 2.5 cm ice cube melts in about 50-60 min on a ceramic plate at 22 °C, a 4 cm cube in about 1 h 40 min, a 5 cm cube in about 2 h 30 min (from −18 °C a little longer); 1 L of water on a 600 W hot plate boils in about 15 min; a hot drink cools 80 → 50 °C in 20-60 min; a puddle (1.5 mm deep, whatever its size) dries in about 12 h at 22 °C, sooner under a lamp. E.g. seconds 12 with time_lapse 600 shows 2 hours. Goal times are minutes of LESSON time, the clock on screen (by_min, at_min: 2 h = 120), never run seconds.",
	"Ice and salt: put the ice cube ON a plate or IN a bowl (place {on: <plate id>} / {inside: <bowl id>, on: <bowl id>}), centred; a salt-pile goes ON the ice cube (place {on: <cube id>}): it dissolves into the melt water and makes salt water that melts ice below 0 °C, so the salted cube melts sooner (1 g on a 4-5 cm cube: a few % sooner; 6 g: 10-30 % sooner; in a bowl the brine stays longer). A bigger cube takes far longer (a 5 cm cube ≈ 3 × a 2.5 cm one), so a big salted cube still loses to a small plain one. What the cube stands on matters: aluminium plate ≫ ceramic > glass or plastic (melamine) > foam.",
	"Lamps: a lamp (desk lamp, static) shines a cone of light and heat: set props.target to the item it should heat (it then aims at it) and put the lamp 15-30 cm to one side of it (x), head_height 0.25-0.45 m. Its heat on a target falls as 1/distance² (60 W incandescent: about 240 W/m² at 25 cm, 600 at 15 cm; sunlight 1000): a lamp on one of two cubes makes it melt sooner (10-25 %). An LED bulb (bulb led) gives light but almost no heat. Only what its beam reaches warms; something in between shades it.",
	"Measuring: a thermometer reads what its bulb (its anchor, the bottom end) is in or touches, else the air; it lags (glass: 8 s in water, 60 s in air; digital: 3 s / 30 s) and reads high in a lamp's beam. To read a cup's water put it in the cup ({inside: <cup id>, on: <cup id>}) with fixed true (it stands upright); a cup's or pan's lid has a hole for it (a thermometer or spoon goes through the lid). `reads` and `reaches` goals use its reading (°C); a reading taken after its bulb left the water (in_water 0) does not meet `reaches`.",
	"Heating and cooling water: a hot-plate (static; 600 W, setpoint_c) heats what stands on it (place {on: <hot plate id>}): a saucepan (water_ml, water_temp_c, lid, salt_g) warms, boils at 100 °C (the temperature stops rising while it boils) and boils away (not with the lid on). A drink-cup (style foam, paper, plastic, glass, steel, mug or flask; water_ml, water_temp_c, lid) of hot water cools through its wall and from its surface (evaporation takes a third to a half of an open cup's heat): a flask or foam with a lid keep it hot longest; an open paper or plastic cup cools fastest (evaporation, and its dull side radiates); a mug's thick cold wall soaks up heat at first; a shiny steel cup radiates little (its outside gets hot to touch), so open it cools about as a foam cup does, and with lids foam keeps it hotter. Without air (settings.air false) nothing evaporates or convects: things cool and melt only by radiation and touch, far slower. An ice cube dropped into a cup melts fast and chills the water. A cold drink-cup (water_temp_c 2-5) in a humid room gets dew on it.",
	"Conduction: a spoon (material stainless steel, aluminium, copper, polypropylene (plastic) or varnished hardwood (wood); its bowl at its LEFT end) stood with its bowl end in hot water, or a rod with one end on a hot plate, warms along its length: copper > aluminium > steel > glass > plastic, wood (meltable dabs of butter on it melt where it gets past 33 °C). A meltable is butter (33 °C), chocolate (34 °C) or wax (58 °C).",
	"Readings each run (track.state): ice-cube temp, melted (0-1), puddle_g; plate/bowl temp, temp_min; salt-pile salt_g; thermometer reading; drink-cup and saucepan water_temp, water_g, boiling, temp (its wall); hot-plate temp, power; lamp on; spoon and rods temp0 (left end) … temp7 (right end); meltable temp, melted; puddle liquid_g. Fair tests: two identical setups side by side at least 30 cm apart, changing only the one thing compared.",
	"Rubbing and impacts warm things (friction's work and the energy an impact loses, half to each side: honest, SMALL sizes): a sanding-block (press_n 5 N, speed 0.5 m/s, rub_s 10 s) on the table warms about +0.1 °C (work_j about 8 J); a 1 kg steel weight dropped 1 m about +0.01 °C. Use goal warms_by {item, at_least_c: 0.05} with time_lapse 1 (the rubbing is real time); never promise a big rise.",
	"Candles: the everyday candle with props.lit true (lit_at s) has an 80 W flame 2.5 cm tall that burns 0.1 g of wax a minute (burned_g; it gets lighter, so a kitchen scale under it reads less), gives light (1 candela) and sends hot air up: a thing held 10-20 cm over it warms fast (a bimetal-strip curls, a thermometer reads 50-200 °C). A candle-jar (volume_ml 1000) stood over a SHORT candle (candle height 0.08, mass 0.027; both place {on: table} at the same x, the candle first: the jar is mouth down, not a container to put things inside) traps the air: the flame goes out when its oxygen falls to about 16 % (1 L about 12 s, 2 L about 25 s; goal burns_out {item: candle, jar, before_s?}); the same candle in the open keeps burning.",
	"Light that the optics module traces heats what absorbs it: sunlight (sunlight item), a lamp or a flashlight, through a convex-lens, off a mirror or an material-panel (sample aluminium foil), through clear glass (a candle-jar or a clear panel passes about 92 %). A magnifying glass: sunlight from above, a convex-lens (aim 90: its axis up and down) one focal_length above a paper-sheet on the table: its hottest spot (spot_temp) passes 233 °C (goal scorches {item: paper}). Foil reflectors beside an ice cube send it more light (it melts sooner).",
	"Liquids: a pitcher (flow module; temp_c, fill_ml) pours into a beaker, measuring-jug, water-tank or bowl: the liquids mix heat for heat (100 g at 80 °C into 100 g at 20 °C gives about 48-50 °C, a little lower for the beaker's own warming); put a thermometer (fixed) in the receiver; goal reaches {item: <receiver or thermometer>, at_least_c} (never at_most_c alone: it is true at the start). Oil, honey, corn syrup and rubbing alcohol in a fluids container warm by their own heat capacity (oil about twice as fast as water; their reading is liquid_temp). A bowl's contents (nothing, water or sand, contents_g, contents_temp_c): dry sand warms about 5 times faster than water under the same lamp (goal warmer {a: sand bowl, b: water bowl}).",
	"Solids expand when heated: a ball-and-ring (ball_temp_c 300 sits on the ring until it cools, a cold ball passes; goal passes_through {item, passes?}); a bimetal-strip (layers brass on steel; heated by a lit candle under its tip, a hot plate or start_temp_c, its tip moves about 4 mm a 100 °C for 10 cm; goal bends {item, at_least_mm}). A thermometer's red column rises as its liquid expands with the reading."
].join(" ")

const PROMPT = {
	plan: [
		"Heat: anything that melts, warms, cools, boils or evaporates needs settings.time_lapse so that seconds × time_lapse covers it (e.g. seconds 12, time_lapse 600 = 2 h; an ice cube 2.5 cm ≈ 1 h, 4 cm ≈ 1 h 40 min, 5 cm ≈ 2 h 30 min at 22 °C) and settings.room_temp when the request names one (a classroom 22). Ice cubes go ON plates or IN bowls; a salt pile goes ON its cube (place {on: <cube id>}); a lamp's props.target names the item it heats and it stands 15-30 cm beside it. For a comparison, build two identical lanes ≥ 30 cm apart and change only the one thing. Goals: melts {item, by_min?}, melts_first {a, b}, melt_fraction {item, at_least?, at_most?, at_min?}, reaches {item, at_least_c? | at_most_c?, by_min?}, warmer {a, b, at_min?}, warms_by {item, at_least_c} (the matter module's), boils, freezes, dries, dew, burns_out {item: candle, jar?}, scorches {item}, passes_through {item, passes?}, bends {item, at_least_mm?}. A lit candle: props.lit true; under a candle-jar it goes out. Rubbing (sanding-block) warms only about 0.1 °C: time_lapse 1. Their times are MINUTES of lesson time (the on-screen clock = run seconds × time_lapse ÷ 60), never run seconds: \"melts within 2 hours\" is by_min 120. Often a race (melts_first, warmer) needs no time at all. A thermometer (or spoon) in a cup or pan with a lid goes through the lid: place it inside the cup as usual ({inside: <cup id>, on: <cup id>}, fixed true), its bulb in the water."
	].join("\n"),
	edit: "Heat: change a melt race with the salt pile's mass_g, the cube's size (width = height = depth), the plate's or bowl's material, the lamp (target, bulb, power_w, its distance: move the lamp's x), the room (settings.room_temp) or the clock (settings.time_lapse only changes how fast lesson time runs, nothing physical). Never change a thermometer's reading; move its bulb into what it should measure. A thermometer or spoon in a cup or pan with a lid goes THROUGH the lid (it has a hole for it): putting a lid on leaves the thermometer where it is, its bulb in the water. When the request changes the very thing that decides an outcome (warm water instead of ice water: no dew; no salt on the cube; an LED instead of a hot bulb), the old outcome may no longer happen: rewrite that goal to what the change now shows (keep it as the lesson's prediction with expect false, or drop it), never keep a goal the change itself makes impossible, and never undo the person's change to make an old goal pass.",
	refine: "Heat: if nothing melted or changed, the clock is too short: raise settings.time_lapse (or seconds). A lamp must point at its target (props.target) with nothing between; salt must rest ON its ice cube; a thermometer's bulb (its bottom end) must be inside the water it should read. A candle-jar must stand over the candle's flame (the candle shorter than the jar); a candle heats what is ABOVE it (its plume); a lens's focus must fall on the paper."
}

/** Lesson time as a label from seconds. */
const clockText = (s) => {
	if (s < 59.5) return `${Math.round(s)} s`
	const m = Math.round(s / 60)
	return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`
}
const trim = (v, d = 1) => (Number.isFinite(v) ? Number(v.toFixed(d)).toString() : "?")

/** A heat goal's result in words for the AI's card and its next step (web/ai/goals.js, ai/goals.mjs `detail`): times on the lesson clock. */
const yes = (e) => (e.ok ? "yes" : "no")
const at = (t) => (Number.isFinite(t) ? clockText(t) : "never")
const DETAIL = {
	melts: (e) => `${yes(e)} (${Number.isFinite(e.t) ? `melted at ${at(e.t)} of lesson time` : `${trim((e.melted ?? 0) * 100, 0)} % melted by the end`})`,
	melts_first: (e) => {
		const one = (t, f) => (Number.isFinite(t) ? `melted at ${clockText(t)}` : `${trim((f ?? 0) * 100, 0)} % melted by the end`)
		return `${yes(e)} (${one(e.t_a, e.melted_a)} vs ${one(e.t_b, e.melted_b)}, lesson time)`
	},
	melt_fraction: (e) => `${yes(e)} (${trim((e.melted ?? 0) * 100, 0)} % melted)`,
	reaches: (e) =>
		e.left_water
			? `no (it read that at ${at(e.t)} of lesson time, but its bulb had left the water it was put in: it read the pan's floor or the air there; ${trim(e.end_c)} °C at the end)`
			: `${yes(e)} (${Number.isFinite(e.t) ? `at ${at(e.t)} of lesson time; ` : ""}${trim(e.end_c)} °C at the end)`,
	warmer: (e) => `${yes(e)} (${trim(e.a_c)} vs ${trim(e.b_c)} °C)`,
	boils: (e) => `${yes(e)}${Number.isFinite(e.t) ? ` (from ${at(e.t)} of lesson time)` : ""}`,
	freezes: (e) => `${yes(e)}${Number.isFinite(e.t) ? ` (frozen at ${at(e.t)} of lesson time)` : ""}`,
	dries: (e) => `${yes(e)} (${Number.isFinite(e.t) ? `dry at ${at(e.t)} of lesson time` : `${trim(e.left_g ?? 0, 2)} g left at the end`})`,
	dew: (e) => `${yes(e)} (${trim(e.most_g ?? 0, 3)} g of dew at most)`,
	burns_out: (e) => `${yes(e)} (${Number.isFinite(e.t) ? `out at ${at(e.t)} of lesson time` : "still burning at the end"}; ${trim(e.burned_g ?? 0, 2)} g of wax burned)`,
	scorches: (e) => `${yes(e)} (${Number.isFinite(e.t) ? `at ${at(e.t)} of lesson time; ` : ""}hottest spot ${Number.isFinite(e.hottest_c) ? `${trim(e.hottest_c, 0)} °C` : "none"}; paper scorches at 233 °C)`,
	passes_through: (e) => `${yes(e)} (${e.through ? "it went through" : "it stayed on the ring"}: ball ${trim(e.ball_mm, 3)} mm, hole ${trim(e.hole_mm, 3)} mm)`,
	bends: (e) => `${yes(e)} (its tip moved ${trim(e.most_mm ?? 0, 1)} mm at most)`
}

/** The reading of an item at the first and the last frame of a run, or null. */
function seriesOf(run, id, key) {
	const v = run?.track?.state?.[id]?.[key]
	return Array.isArray(v) && v.length ? v : null
}
const startOf = (run, id, key) => seriesOf(run, id, key)?.[0] ?? null
const endOf = (run, id, key) => {
	const v = seriesOf(run, id, key)
	return v ? v[v.length - 1] : null
}
const lapseOf = (run) => {
	const v = run?.doc?.settings?.timeLapse
	return typeof v === "number" && Number.isFinite(v) ? v : 1
}
/** The lesson time at which a reading first passes a test, or null. */
function whenOf(run, id, key, test) {
	const v = seriesOf(run, id, key)
	const fr = run?.track?.frames
	if (!v || !fr) return null
	for (let k = 0; k < Math.min(v.length, fr.length); k++) if (test(v[k])) return fr[k].t * lapseOf(run)
	return null
}

// ---------------------------------------------------------------- the make-it-work search's targeted tries (goal kinds' `aim`)
// A heat run takes seconds, so the search gets few of them: a missed heat goal first tries the one-setting changes that act on it (more salt
// on the cube that should win, the lamp turned onto it, the dish under it a better or worse conductor, a lid, the hot plate turned up), each
// checked by a run like any other; never what the person set (web/ai/fixer.js leaves those out).
const fin = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const itemOf = (scene, id) => (scene?.items ?? []).find((i) => i.id === id) ?? null
const xOf = (it) => fin(Number(it?.x), 0)
const yOf = (it) => fin(Number(it?.y), 0)
const DISH_D = { plate: 0.27, bowl: 0.15, saucepan: 0.18, "hot-plate": 0.18 }
/** The dish (plate, bowl) or pan a thing stands on or in: the nearest one whose middle it is over and that is below it. */
function standsOn(scene, id, types = ["plate", "bowl"]) {
	const it = itemOf(scene, id)
	if (!it) return null
	let best = null
	for (const o of scene.items ?? []) {
		if (o.id === id || !types.includes(o.type)) continue
		const half = fin(o.props?.diameter, DISH_D[o.type] ?? 0.2) / 2
		if (Math.abs(xOf(o) - xOf(it)) > half || yOf(o) > yOf(it) + 1e-6) continue
		if (!best || Math.abs(xOf(o) - xOf(it)) < Math.abs(xOf(best) - xOf(it))) best = o
	}
	return best
}
/** The salt piles resting on a cube (over its top, within its width). */
const saltOn = (scene, id) => {
	const c = itemOf(scene, id)
	const w = fin(c?.props?.width, 0.04)
	return c ? (scene.items ?? []).filter((o) => o.type === "salt-pile" && Math.abs(xOf(o) - xOf(c)) <= w / 2 + 0.005 && yOf(o) >= yOf(c)) : []
}
/** The cup, pan or bowl a thermometer stands in (its bulb, its anchor, inside it), else the item itself when it holds water. */
const vesselOf = (scene, id) => {
	const it = itemOf(scene, id)
	if (!it) return null
	if (["drink-cup", "saucepan", "bowl"].includes(it.type)) return it
	return standsOn(scene, id, ["drink-cup", "saucepan", "bowl"]) ?? (scene.items ?? []).find((o) => ["drink-cup", "saucepan"].includes(o.type) && Math.abs(xOf(o) - xOf(it)) < 0.05 && yOf(it) >= yOf(o) && yOf(it) < yOf(o) + 0.2) ?? null
}
const prop = (it, key, d) => (it?.props?.[key] !== undefined ? it.props[key] : d)
const set = (it, key, from, to, cost) => ({ changes: [{ kind: "prop", id: it.id, key, from, to }], cost })
/** Tries that make thing `fast` warm (or melt) sooner and thing `slow` later: more salt, the lamp onto it, a better or worse dish under it. */
function hastens(scene, fast, slow) {
	const out = []
	for (const s0 of saltOn(scene, fast)) {
		const m = fin(Number(prop(s0, "mass_g", 6)), 6)
		for (const k of [2, 3]) if (m * k <= 30) out.push(set(s0, "mass_g", m, Math.round(m * k * 10) / 10, 0.3 * k))
	}
	for (const L of (scene.items ?? []).filter((o) => o.type === "lamp")) {
		const tgt = prop(L, "target", null)
		if (tgt !== fast) out.push(set(L, "target", tgt, fast, 0.6))
		if (tgt === fast && prop(L, "bulb", "incandescent") === "led") out.push(set(L, "bulb", "led", "incandescent", 0.7))
		if (tgt === fast) {
			const w = fin(Number(prop(L, "power_w", 60)), 60)
			if (w < 150) out.push(set(L, "power_w", w, Math.min(150, Math.round(w * 1.6)), 0.8))
		}
	}
	const df = standsOn(scene, fast)
	const ds = standsOn(scene, slow)
	if (df && prop(df, "material", "ceramic") !== "aluminium") out.push(set(df, "material", prop(df, "material", "ceramic"), "aluminium", 1.2))
	if (ds && ds !== df && !["foam", "paperboard"].includes(prop(ds, "material", "ceramic"))) out.push(set(ds, "material", prop(ds, "material", "ceramic"), "foam", 1.5))
	return out
}
/** Tries that keep a cup's (or pan's) water hotter: a lid, a better cup. */
function keepsHot(cup) {
	if (!cup) return []
	const out = []
	if (!prop(cup, "lid", false)) out.push(set(cup, "lid", false, true, 0.5))
	if (cup.type === "drink-cup") for (const [st, c] of [["foam", 0.9], ["flask", 1.1]]) if (prop(cup, "style", "foam") !== st) out.push(set(cup, "style", prop(cup, "style", "foam"), st, c))
	return out
}
/** Tries that heat a pan's water faster or hotter: its hot plate turned up, a lid on, less water. */
function heatsUp(scene, pan) {
	if (!pan) return []
	const out = []
	const hp = standsOn(scene, pan.id, ["hot-plate"])
	if (hp) {
		const w = fin(Number(prop(hp, "power_w", 600)), 600)
		if (w < 1500) out.push(set(hp, "power_w", w, Math.min(1500, Math.round(w * 1.5 / 10) * 10), 0.6))
		const sp = fin(Number(prop(hp, "setpoint_c", 250)), 250)
		if (sp < 400) out.push(set(hp, "setpoint_c", sp, Math.min(550, sp + 150), 0.7))
	}
	if (pan.type === "saucepan" && !prop(pan, "lid", false)) out.push(set(pan, "lid", false, true, 0.8))
	const ml = fin(Number(prop(pan, "water_ml", 1000)), 1000)
	if (ml > 200) out.push(set(pan, "water_ml", ml, Math.round(ml * 0.6), 1.2))
	return out
}
const AIM = {
	melts_first: (g, e, scene) => (e?.ok === false ? hastens(scene, g.a, g.b) : []),
	melts: (g, e, scene) => (e?.ok === false ? hastens(scene, g.item, null) : []),
	melt_fraction: (g, e, scene) => (e?.ok === false && Number.isFinite(g.at_least) ? hastens(scene, g.item, null) : []),
	warmer: (g, e, scene) => {
		if (e?.ok !== false) return []
		const a = vesselOf(scene, g.a)
		const b = vesselOf(scene, g.b)
		// (two cups: the one that should stay warmer kept hotter; a thing under a lamp: the lamp onto it)
		if (a && b && a.id !== b.id && ["drink-cup", "saucepan"].includes(a.type)) return keepsHot(a)
		return hastens(scene, g.a, g.b)
	},
	reaches: (g, e, scene) => {
		if (e?.ok !== false || !Number.isFinite(g.at_least_c)) return []
		const v = vesselOf(scene, g.item)
		return v ? heatsUp(scene, v) : hastens(scene, g.item, null)
	},
	boils: (g, e, scene) => (e?.ok === false ? heatsUp(scene, itemOf(scene, g.item)) : [])
}
// (the words a request names a heat setting in, for what is the person's own choice: web/sim/plugins.js keyWords, web/ai/orchestrator.js
// choicesOf, so a fix never undoes "use a 4 watt LED", "twice as much salt" or "warm water instead")
const KEYS = {
	"lamp.bulb": "led|leds|halogen|incandescent|old[- ]style|bulbs?",
	"lamp.power_w": "watts?|\\d+\\s*w|power\\w*|bright\\w*|dimm?\\w*|strong\\w*|weak\\w*",
	"lamp.target": "aim\\w*|point\\w*|shin\\w*|target\\w*|on the \\w+ cube",
	"lamp.head_height": "rais\\w*|lower\\w*|higher|closer|nearer|further|farther|head",
	"lamp.beam_angle": "beam|wide\\w*|narrow\\w*|spot\\w*|flood\\w*",
	"salt-pile.mass_g": "salt\\w*|pinch\\w*|spoon\\w*|teaspoon\\w*|grams?|\\d+\\s*g",
	"salt-pile.grain": "coarse|fine|table salt|rock salt|grain\\w*",
	"drink-cup.style": "foam|styrofoam|polystyrene|paper|plastic|glass|steel|metal|tumbler|mug|ceramic|flask|thermos",
	"water_temp_c": "warm\\w*|hot\\w*|cold\\w*|cool\\w*|ice|iced|icy|boiling|degrees?|°",
	"water_ml": "water|mls?|millilit\\w*|full|fill\\w*|half",
	"lid": "lids?|cover\\w*|caps?|stopper",
	"salt_g": "salt\\w*|grams?",
	"ice-cube.start_temp_c": "freezer|frozen|degrees?|°|colder|warmer",
	"hot-plate.power_w": "watts?|power\\w*|stronger|weaker|turn\\w* (?:it )?up|turn\\w* (?:it )?down",
	"hot-plate.setpoint_c": "set\\w*|degrees?|°|hotter|cooler|thermostat",
	"meltable.start_temp_c": "degrees?|°|warm\\w*|cold\\w*|fridge|room",
	"puddle.water_ml": "water|mls?|millilit\\w*|bigger|smaller|size"
}
/** One word for a heat setting's change on the card ("brighter", "its beam wider"), where the plain words would mislead ("tilted less" for a
 *  narrower beam, "faster" for a stronger bulb): web/sim/plugins.js howWords. */
function howWord(type, key, a, b) {
	if (typeof a !== "number" || typeof b !== "number" || a === b) return null
	const up = b > a
	if (type === "lamp" && key === "power_w") return up ? "brighter" : "dimmer"
	if (type === "lamp" && key === "beam_angle") return up ? "its beam wider" : "its beam narrower"
	if (type === "lamp" && key === "head_height") return up ? "raised" : "lowered"
	if (type === "lamp" && key === "aim") return "aimed another way"
	if (type === "hot-plate" && key === "power_w") return up ? "more powerful" : "less powerful"
	if (type === "hot-plate" && key === "setpoint_c") return up ? "set hotter" : "set cooler"
	if (key === "water_temp_c" || key === "start_temp_c" || key === "contents_temp_c" || key === "temp_c") return up ? "warmer" : "colder"
	return null
}

export function heatPlugin(api) {
	const G = api.goals
	const pickOf = (scene, pick, types) => {
		const xs = (scene.items ?? []).filter((i) => types.includes(i.type))
		return xs.length ? pick(xs) : null
	}
	const melters = ["ice-cube", "meltable"]
	const lit = (scene) => (scene.items ?? []).filter((i) => i.type === "candle" && i.props?.lit === true)
	const hot = ["thermometer", "drink-cup", "saucepan", "ice-cube", "plate", "bowl", "spoon", "meltable", "hot-plate", "puddle"]
	return {
		title: "Heat and temperature: melting ice and salt, lamps, hot plates, thermometers, insulation, boiling and evaporation",
		howto: HOWTO,
		prompt: PROMPT,
		examples: [
			{
				ask: "Two ice cubes on white plates; sprinkle salt on one. Which melts first?",
				how: "two 4 cm ice-cubes each ON its own plate 40 cm apart, a salt-pile (mass_g 6) ON one cube; settings {room_temp 22, time_lapse 600}, seconds 15; goal melts_first {a: salted cube, b: plain cube}",
				plan: { title: "Salt on ice", seconds: 15, settings: { room_temp: 22, time_lapse: 600 }, items: [
					{ id: "plate1", type: "plate", place: { on: "table", x: 0.8 } }, { id: "plate2", type: "plate", place: { on: "table", x: 1.4 } },
					{ id: "salted", type: "ice-cube", name: "Salted cube", props: { width: 0.04, height: 0.04, depth: 0.04 }, place: { on: "plate1" } },
					{ id: "plain", type: "ice-cube", name: "Plain cube", props: { width: 0.04, height: 0.04, depth: 0.04 }, place: { on: "plate2" } },
					{ id: "salt", type: "salt-pile", props: { mass_g: 6 }, place: { on: "salted" } }],
				goals: [{ kind: "melts_first", a: "salted", b: "plain" }] }
			},
			{
				ask: "A big ice cube with salt and a small ice cube without salt, in blue bowls: which melts first?",
				how: "a 5 cm cube with a salt-pile (6 g) in one bowl (color blue) and a 2.5 cm plain cube in another, time_lapse 900, seconds 12; goal melts_first {a: small, b: big}: size beats salt (not a fair test)"
			},
			{
				ask: "Shine a desk lamp on one of two salted ice cubes.",
				how: "two identical cubes with the same salt on identical plates; a lamp (incandescent 60 W) 20 cm to the side of one with props.target = that cube, head_height 0.3; goal melts_first {a: lit cube, b: other}"
			},
			{
				ask: "An LED lamp versus an old-style bulb on two ice cubes.",
				how: "two lamps, bulb led and bulb incandescent, each targeting its own cube at the same distance; goal melts_first {a: under the incandescent, b: under the LED}"
			},
			{
				ask: "Ice cubes on an aluminium plate, a ceramic plate and a foam plate.",
				how: "three plates (material aluminium, ceramic, foam) 35 cm apart, a 4 cm cube on each, time_lapse 600; goals melts_first {a: aluminium's, b: ceramic's}, melts_first {a: ceramic's, b: foam's}"
			},
			{
				ask: "Which cup keeps hot cocoa warm longest: foam with a lid, paper, a mug or steel?",
				how: "four drink-cups (style foam lid true, paper, mug, steel) with 200 mL at 80 °C, a thermometer (fixed) inside each, time_lapse 120, seconds 12 (24 min); goals warmer {a: foam cup, b: steel cup}"
			},
			{
				ask: "Heat a pot of water on a hot plate until it boils, with a thermometer in it.",
				how: "hot-plate (600 W), saucepan (1000 mL at 20 °C) ON it, a thermometer (fixed) inside the pot; time_lapse 150, seconds 12 (30 min); goals reaches {item: thermometer, at_least_c: 99}, boils {item: pot}"
			},
			{
				ask: "Metal spoon or wooden spoon in hot tea: which handle gets warm?",
				how: "two drink-cups (mug, 90 °C), a spoon (stainless steel) and a spoon (varnished hardwood) each leaning in its mug with its bowl end (left) in the water (angle about 60°, fixed true); time_lapse 60; goal warmer {a: metal spoon, b: wooden spoon}"
			},
			{
				ask: "Melt butter in a hot pan.",
				how: "hot-plate (setpoint 150 °C), saucepan with water_ml 0 on it, a meltable (butter) inside the pan; time_lapse 60; goal melts {item: butter}"
			},
			{
				ask: "Watch a puddle evaporate under a lamp versus in the shade.",
				how: "two puddles (10 mL) 60 cm apart, a lamp (150 W, head_height 0.25, beam_angle 70) 30 cm to one side of one with props.target = it; time_lapse 3600, seconds 8 (8 h); goals dries {item: lit puddle}, warmer {a: lit puddle, b: other} (the lit one dries in about 5 h, the other keeps about a third of its water)"
			},
			{
				ask: "A cold drink sweats: water condenses on a glass of ice water.",
				how: "drink-cup (style glass, water_temp_c 3) in a room at 25 °C (settings.room_temp 25), time_lapse 60, seconds 10; goal dew {item: glass}"
			},
			{
				ask: "Read the temperature of water with a thermometer.",
				how: "a drink-cup (glass, 200 mL at 40 °C) and a thermometer (fixed, place inside the cup); seconds 4, time_lapse 30; goal reaches {item: thermometer, at_least_c: 39}"
			},
			{
				ask: "Does rubbing make things warmer?",
				how: "a sanding-block on the table (press_n 5, speed 0.5, rub_s 10), seconds 12, time_lapse 1 (real time); goal warms_by {item: block, at_least_c: 0.05}: it warms about 0.1 °C (honest: rubbing warms a little)"
			},
			{
				ask: "A candle under a jar goes out; one in the open keeps burning.",
				how: "two short candles (height 0.08, mass 0.027, lit true) 60 cm apart on the table, a candle-jar (volume_ml 1000) on the table at the SAME x as one of them (it stands over it, mouth down); seconds 20; goal burns_out {item: the jar's candle, jar: the jar, before_s: 20}",
				plan: { title: "Candle under a jar", seconds: 20, items: [
					{ id: "c1", type: "candle", name: "Covered candle", props: { height: 0.08, mass: 0.027, lit: true }, place: { on: "table", x: 0.9 } },
					{ id: "jar", type: "candle-jar", props: { volume_ml: 1000 }, place: { on: "table", x: 0.9 } },
					{ id: "c2", type: "candle", name: "Open candle", props: { height: 0.08, mass: 0.027, lit: true }, place: { on: "table", x: 1.5 } }],
				goals: [{ kind: "burns_out", item: "c1", jar: "jar", before_s: 20 }] }
			},
			{
				ask: "Burn paper with a magnifying glass in the sun.",
				how: "sunlight (elevation 90), a convex-lens (focal_length 0.1, diameter 0.05, aim 90, fixed) 10 cm above a paper-sheet lying on the table; seconds 8; goal scorches {item: paper}"
			},
			{
				ask: "Mix hot and cold water: what temperature do you get?",
				how: "a beaker with 200 mL of water at 20 °C and a thermometer (fixed) inside it; a pitcher (vessel cup, fill_ml 200, temp_c 80) with its lip over the beaker, pour_at 1; seconds 15, time_lapse 1; goals reaches {item: beaker, at_least_c: 45} (its water: about 48-50 °C) and reaches {item: thermometer, at_least_c: 40} (it lags)"
			},
			{
				ask: "Which warms faster in the sun, sand or water?",
				how: "two bowls (same material) 40 cm apart, contents sand and contents water (contents_g 200), a lamp (incandescent 100 W) 20 cm from each with props.target its bowl; time_lapse 60, seconds 10; goal warmer {a: sand bowl, b: water bowl}"
			},
			{
				ask: "Show that metal expands when heated (ball and ring).",
				how: "two ball-and-rings 40 cm apart, one with ball_temp_c 20 and one with ball_temp_c 300; seconds 6; goals passes_through {item: cold one}, passes_through {item: hot one, passes: false}"
			},
			{
				ask: "A bimetal strip bends over a candle flame.",
				how: "a bimetal-strip (length 0.1, height 0.12) and a lit candle (height 0.08, mass 0.027) on the table under its tip (candle x = strip x + 0.08); seconds 10, time_lapse 20 (the strip warms over minutes); goal bends {item: strip, at_least_mm: 1.5}"
			}
		],
		goals: [
			{
				kind: "melts", aliases: ["melt", "melted", "melts_completely", "melts_away"], fields: { item: "item", by_min: "number?", before_s: "number?" },
				about: "melts {item, by_min?}: the ice cube (or butter, chocolate, wax) melts completely, within by_min minutes of LESSON time (the clock on screen: run seconds × time_lapse ÷ 60; 2 h = 120) if given",
				label: (g, n) => `${n(g.item)} melts${Number.isFinite(g.by_min) ? ` within ${clockText(g.by_min * 60)}` : Number.isFinite(g.before_s) ? ` within ${clockText(g.before_s)}` : ""}`,
				summarize: G.melts,
				aim: AIM.melts,
				detail: DETAIL.melts,
				sample: (scene, pick) => {
					const it = pickOf(scene, pick, melters)
					return it ? { kind: "melts", item: it.id, ...pick([{}, { before_s: pick([600, 3600, 7200]) }, { by_min: pick([10, 60, 120]) }]) } : null
				}
			},
			{
				kind: "melts_first", aliases: ["melts_before", "melt_first", "melts_sooner", "melt_race"], fields: { a: "item", b: "item" }, subject: ["a"],
				about: "melts_first {a, b}: a melts completely before b (if neither finishes, a has melted more by the end)",
				label: (g, n) => `${n(g.a)} melts before ${n(g.b)}`,
				summarize: G.melts_first,
				aim: AIM.melts_first,
				detail: DETAIL.melts_first,
				sample: (scene, pick) => {
					const xs = (scene.items ?? []).filter((i) => melters.includes(i.type))
					return xs.length >= 2 ? { kind: "melts_first", a: xs[0].id, b: xs[1].id } : null
				}
			},
			{
				kind: "melt_fraction", aliases: ["melted_share", "melts_partly", "melt_share"], fields: { item: "item", at_least: "number?", at_most: "number?", at_min: "number?", at_s: "number?" },
				about: "melt_fraction {item, at_least?, at_most?, at_min?}: the share of it melted (0-1) at at_min minutes of lesson time (default the end) is within the bounds",
				label: (g, n) => `${n(g.item)} is ${Number.isFinite(g.at_least) ? `at least ${Math.round(g.at_least * 100)} % ` : ""}${Number.isFinite(g.at_most) ? `at most ${Math.round(g.at_most * 100)} % ` : ""}melted`,
				summarize: G.melt_fraction,
				aim: AIM.melt_fraction,
				detail: DETAIL.melt_fraction,
				sample: (scene, pick) => {
					const it = pickOf(scene, pick, melters)
					return it ? { kind: "melt_fraction", item: it.id, at_least: pick([0.1, 0.5, 0.9]), ...pick([{}, { at_s: 1800 }, { at_min: 30 }]) } : null
				}
			},
			{
				kind: "reaches", aliases: ["reaches_temperature", "heats_to", "cools_to", "temperature", "reads_temp", "warms_to"],
				fields: { item: "item", at_least_c: "number?", at_most_c: "number?", by_min: "number?", before_s: "number?" },
				about: "reaches {item, at_least_c? | at_most_c?, by_min?}: the item's temperature (a thermometer's reading, a cup's or pot's water, else its own) reaches at least at_least_c °C (or cools to at_most_c), within by_min minutes of lesson time if given",
				label: (g, n) => `${n(g.item)} ${Number.isFinite(g.at_least_c) ? `reaches ${g.at_least_c} °C` : `cools to ${g.at_most_c} °C`}`,
				summarize: G.reaches,
				aim: AIM.reaches,
				detail: DETAIL.reaches,
				sample: (scene, pick) => {
					const it = pickOf(scene, pick, hot)
					return it ? { kind: "reaches", item: it.id, ...(pick([true, false]) ? { at_least_c: pick([25, 50, 99]) } : { at_most_c: pick([0, 15, 40]) }) } : null
				}
			},
			{
				kind: "warmer", aliases: ["hotter", "warmer_than", "stays_warmer", "colder"], fields: { a: "item", b: "item", at_min: "number?", at_s: "number?" }, subject: ["a"],
				about: "warmer {a, b, at_min?}: a is at least 0.5 °C warmer than b at at_min minutes of lesson time (default the end): which cup kept its drink hotter, which spoon handle got warm",
				label: (g, n) => `${n(g.a)} is warmer than ${n(g.b)}`,
				summarize: G.warmer,
				aim: AIM.warmer,
				detail: DETAIL.warmer,
				sample: (scene, pick) => {
					const xs = (scene.items ?? []).filter((i) => hot.includes(i.type))
					return xs.length >= 2 ? { kind: "warmer", a: xs[0].id, b: xs[1].id } : null
				}
			},
			{
				kind: "boils", aliases: ["boil", "boiling", "comes_to_boil"], fields: { item: "item", by_min: "number?", before_s: "number?" },
				about: "boils {item, by_min?}: the water in the saucepan, cup or container boils (at 100 °C), within by_min minutes of lesson time if given",
				label: (g, n) => `the water in ${n(g.item)} boils`,
				summarize: G.boils,
				aim: AIM.boils,
				detail: DETAIL.boils,
				sample: (scene, pick) => {
					const it = pickOf(scene, pick, ["saucepan", "drink-cup"])
					return it ? { kind: "boils", item: it.id } : null
				}
			},
			{
				kind: "freezes", aliases: ["freeze", "frozen", "turns_to_ice"], fields: { item: "item", by_min: "number?", before_s: "number?" },
				about: "freezes {item, by_min?}: the water in it (a cup, a pot, a puddle) turns all to ice (a room below 0 °C: settings.room_temp −18 is a freezer)",
				label: (g, n) => `${n(g.item)} freezes`,
				summarize: G.freezes,
				detail: DETAIL.freezes,
				sample: (scene, pick) => {
					const it = pickOf(scene, pick, ["drink-cup", "saucepan", "puddle"])
					return it ? { kind: "freezes", item: it.id } : null
				}
			},
			{
				kind: "dries", aliases: ["evaporates", "dries_up", "evaporate"], fields: { item: "item", by_min: "number?", before_s: "number?" },
				about: "dries {item, by_min?}: a puddle (or a melted cube's puddle, or the water in a cup or pan) evaporates or boils away, within by_min minutes of lesson time if given (hours: time_lapse 3600)",
				label: (g, n) => `${n(g.item)} dries up`,
				summarize: G.dries,
				detail: DETAIL.dries,
				sample: (scene, pick) => {
					const it = pickOf(scene, pick, ["puddle", "ice-cube"])
					return it ? { kind: "dries", item: it.id } : null
				}
			},
			{
				kind: "dew", aliases: ["condenses", "condensation", "sweats", "dew_forms"], fields: { item: "item" },
				about: "dew {item}: water condenses on it (a cold glass or can sweats): it must be colder than the room's dew point (about 11 °C at 22 °C, 50 %)",
				label: (g, n) => `water condenses on ${n(g.item)}`,
				summarize: G.dew,
				detail: DETAIL.dew,
				sample: (scene, pick) => {
					const it = pickOf(scene, pick, ["drink-cup", "ice-cube"])
					return it ? { kind: "dew", item: it.id } : null
				}
			},
			{
				kind: "burns_out", aliases: ["goes_out", "candle_goes_out", "flame_goes_out", "extinguished", "puts_out", "runs_out_of_oxygen"],
				fields: { item: "item", jar: "item?", by_min: "number?", before_s: "number?" }, subject: ["item", "jar"],
				about: "burns_out {item, jar?, by_min?, before_s?}: a lit candle's flame goes out (under a candle-jar, named in jar, when its air's oxygen falls to about 16 %: 1 L about 12 s; or its wax is used up)",
				label: (g, n) => `${n(g.item)} goes out`,
				summarize: G.burns_out,
				detail: DETAIL.burns_out,
				sample: (scene, pick) => {
					const xs = lit(scene)
					const jar = (scene.items ?? []).find((i) => i.type === "candle-jar")
					return xs.length ? { kind: "burns_out", item: pick(xs).id, ...(jar ? { jar: jar.id } : {}), ...pick([{}, { before_s: pick([10, 30, 60]) }]) } : null
				}
			},
			{
				kind: "scorches", aliases: ["burns", "chars", "smokes", "catches_fire", "burns_paper", "lights_paper"], fields: { item: "item", by_min: "number?", before_s: "number?" },
				about: "scorches {item, by_min?}: focused light (sunlight through a convex-lens, a curved mirror) makes the item's hottest spot pass its scorch point (paper 233 °C, card 260, wood 300)",
				label: (g, n) => `${n(g.item)} scorches`,
				summarize: G.scorches,
				detail: DETAIL.scorches,
				sample: (scene, pick) => {
					const it = pickOf(scene, pick, ["paper-sheet"])
					return it ? { kind: "scorches", item: it.id } : null
				}
			},
			{
				kind: "passes_through", aliases: ["fits_through", "goes_through", "ball_passes", "ball_fits", "stays_stuck", "sticks"], fields: { item: "item", passes: "bool?" },
				about: "passes_through {item, passes?}: a ball-and-ring's ball goes through its ring by the end (passes false: it stays stuck on it); cold it passes, heated (ball_temp_c 300) it sticks until it cools",
				label: (g, n) => (g.passes === false ? `the ball of ${n(g.item)} stays stuck on the ring` : `the ball of ${n(g.item)} passes through the ring`),
				summarize: G.passes_through,
				detail: DETAIL.passes_through,
				sample: (scene, pick) => {
					const it = pickOf(scene, pick, ["ball-and-ring"])
					return it ? { kind: "passes_through", item: it.id, ...pick([{}, { passes: false }]) } : null
				}
			},
			{
				kind: "bends", aliases: ["curls", "bimetal_bends", "bends_when_heated", "strip_bends"], fields: { item: "item", at_least_mm: "number?" },
				about: "bends {item, at_least_mm?}: a bimetal-strip's tip moves at least at_least_mm (default 1) as it heats (about 4 mm a 100 °C for 10 cm)",
				label: (g, n) => `${n(g.item)} bends at least ${Number.isFinite(g.at_least_mm) ? g.at_least_mm : 1} mm`,
				summarize: G.bends,
				detail: DETAIL.bends,
				sample: (scene, pick) => {
					const it = pickOf(scene, pick, ["bimetal-strip"])
					return it ? { kind: "bends", item: it.id, at_least_mm: pick([1, 3, 5]) } : null
				}
			}
		],
		knobs: [
			{ type: "candle", key: "lit", how: "bool", cost: 2, more: "light {it}", less: "blow {it} out", why: "only a lit candle gives heat and light (80 W, 0.1 g of wax a minute)" },
			{ type: "candle-jar", key: "volume_ml", how: "rel", steps: [0.3, 0.5, 0.7], cost: 0.3, more: "use a bigger jar over the candle ({it})", less: "use a smaller jar ({it})", why: "a bigger jar holds more air (more oxygen), so the candle under it burns longer: about 12 s a litre" },
			{ type: "sanding-block", key: "press_n", how: "rel", steps: [0.5, 1, 2], cost: 0.5, more: "press {it} down harder", less: "press {it} more lightly", why: "friction's work grows with how hard it is pressed (μ·N·v): a little more warming" },
			{ type: "sanding-block", key: "speed", how: "rel", steps: [0.5, 1], cost: 0.5, more: "rub {it} faster", less: "rub {it} slower", why: "friction's work grows with the rubbing speed" },
			{ type: "sanding-block", key: "rub_s", how: "rel", steps: [0.5, 1, 2], cost: 0.5, more: "rub {it} for longer", less: "rub {it} for less time", why: "the longer it is rubbed, the more heat it takes in (it is still small: about 0.01 °C a second)" },
			{ type: "ball-and-ring", key: "ball_temp_c", how: "abs", steps: [100, 150, 200, 250], cost: 0.1, more: "heat {it}'s ball more", less: "heat {it}'s ball less", why: "a hotter ball is bigger (brass grows 19 millionths of its size a °C): past about 125 °C it no longer fits the ring" },
			{ type: "ball-and-ring", key: "ring_temp_c", how: "abs", steps: [100, 200, 300], cost: 0.2, more: "heat {it}'s ring", less: "cool {it}'s ring", why: "a hotter ring has a bigger hole: the hot ball passes again" },
			{ type: "bimetal-strip", key: "start_temp_c", how: "abs", steps: [30, 60, 100], cost: 0.2, more: "start {it} hotter", less: "start {it} cooler", why: "its bend grows with how much hotter it is than 20 °C (about 4 mm a 100 °C at the tip of 10 cm)" },
			{ type: "bimetal-strip", key: "length", how: "rel", steps: [0.3, 0.6], cost: 0.5, more: "make {it} longer", less: "make {it} shorter", why: "its tip moves as the length squared" },
			{ type: "bowl", key: "contents", how: "choice", cost: 2, more: "put something else in {it}", less: "put something else in {it}", why: "dry sand (830 J/(kg·K)) warms about 5 times faster than water (4184) under the same lamp" },
			{ type: "bowl", key: "contents_g", how: "rel", steps: [0.3, 0.5], cost: 0.5, more: "put more in {it}", less: "put less in {it}", why: "more water or sand takes longer to warm" },
			{ type: "pitcher", key: "temp_c", how: "abs", steps: [10, 20, 40], cost: 0.5, more: "make {it}'s liquid hotter", less: "make {it}'s liquid colder", why: "the mixture lands between the two temperatures, weighted by how much of each" },
			{ type: "salt-pile", key: "mass_g", how: "rel", cost: 0.5, more: "put more salt on the cube ({it})", less: "use less salt ({it})", why: "more salt keeps the melt water salty for longer, so the cube melts sooner; the effect is modest (6 g on a 4 cm cube: about 10-20 % sooner) and fades as melt water dilutes it" },
			{ type: "salt-pile", key: "grain", how: "choice", cost: 2, more: "switch {it} to table salt", less: "switch {it} to coarse salt", why: "fine table salt dissolves about 3 times faster than coarse salt" },
			{ type: "ice-cube", key: "width", how: "rel", more: "make {it} bigger", less: "make {it} smaller", why: "a smaller cube melts much sooner (its ice grows as size³, its surface as size²): change height and depth with it" },
			{ type: "ice-cube", key: "start_temp_c", how: "abs", steps: [3, 6, 10, 18], cost: 2, more: "start {it} warmer", less: "start {it} colder", why: "a colder cube needs more heat first (2 kJ/kg per °C against 334 kJ/kg to melt): a small effect" },
			{ type: "lamp", key: "target", how: "link", cost: 0.15, more: "aim {it} at another item", less: "aim {it} at another item", why: "only what the beam reaches warms: the lamp must point at the thing it should heat" },
			{ type: "lamp", key: "power_w", how: "rel", more: "use a stronger bulb in {it}", less: "use a weaker bulb in {it}", why: "the heat it gives grows with its power" },
			{ type: "lamp", key: "bulb", how: "choice", cost: 0.3, more: "change {it}'s bulb", less: "change {it}'s bulb", why: "an incandescent or halogen bulb gives off most of its power as light and heat; an LED gives about a third, almost no heat" },
			{ type: "lamp", key: "head_height", how: "m", cost: 0.5, more: "raise {it}'s head", less: "lower {it}'s head", why: "a nearer lamp heats much more (1/distance²)" },
			{ type: "plate", key: "material", how: "choice", cost: 0.15, more: "make {it} of another material", less: "make {it} of another material", why: "a metal plate feeds a cube heat far faster than ceramic; foam hardly at all" },
			{ type: "bowl", key: "material", how: "choice", cost: 0.15, more: "make {it} of another material", less: "make {it} of another material", why: "a metal bowl feeds a cube heat far faster than ceramic; foam hardly at all" },
			{ type: "hot-plate", key: "power_w", how: "rel", cost: 0.5, more: "turn {it} up", less: "turn {it} down", why: "more power heats what stands on it faster" },
			{ type: "hot-plate", key: "setpoint_c", how: "abs", steps: [20, 50, 100], cost: 2, more: "set {it} hotter", less: "set {it} cooler", why: "its thermostat holds its top near the setting: a pot boils only when the top is well above 100 °C" },
			{ type: "saucepan", key: "water_ml", how: "rel", more: "put more water in {it}", less: "put less water in {it}", why: "less water heats (and boils) sooner: it takes 4.2 kJ per kg per °C" },
			{ type: "saucepan", key: "lid", how: "bool", cost: 0.2, more: "put {it}'s lid on", less: "take {it}'s lid off", why: "a lid keeps steam in: it heats faster and no water boils away" },
			{ type: "drink-cup", key: "style", how: "choice", cost: 0.3, more: "use another cup for {it}", less: "use another cup for {it}", why: "a vacuum flask and foam insulate best; a mug's thick wall soaks up heat at first; an open paper or plastic cup loses most (evaporation and radiation); with no lid the cup matters less than the lid" },
			{ type: "drink-cup", key: "lid", how: "bool", cost: 0.2, more: "put a lid on {it}", less: "take {it}'s lid off", why: "a lid stops evaporation, a third to a half of an open hot drink's heat loss" },
			{ type: "drink-cup", key: "water_temp_c", how: "abs", steps: [5, 10, 20, 30], cost: 2, more: "start {it}'s water hotter", less: "start {it}'s water colder", why: "where the water starts" },
			{ type: "drink-cup", key: "water_ml", how: "rel", more: "put more water in {it}", less: "put less water in {it}", why: "more water keeps its temperature longer" },
			{ type: "spoon", key: "material", how: "choice", cost: 2, more: "make {it} of another material", less: "make {it} of another material", why: "copper and aluminium carry heat along fast, stainless steel slowly, plastic and wood hardly" },
			{ type: "steel-rod", key: "material", how: "choice", cost: 2, more: "make {it} of another material", less: "make {it} of another material", why: "copper > aluminium > steel > stainless > glass for carrying heat along" },
			{ type: "meltable", key: "material", how: "choice", cost: 2, more: "use another meltable for {it}", less: "use another meltable for {it}", why: "butter melts at about 33 °C, chocolate 34 °C, wax 58 °C" },
			{ type: "puddle", key: "water_ml", how: "rel", more: "make {it} bigger", less: "make {it} smaller", why: "a smaller puddle dries sooner" }
		],
		place: {
			containers: ["bowl", "drink-cup", "saucepan"],
			inside: { "ice-cube": ["bowl", "drink-cup", "saucepan"], thermometer: ["drink-cup", "saucepan", "bowl"], spoon: ["drink-cup", "saucepan", "bowl"], meltable: ["saucepan", "bowl"], "salt-pile": ["bowl"] },
			/** The inside of a bowl, cup or pan in its own frame (anchor: the middle of its base): between its walls, from its floor's top to its rim. */
			interior(type, props) {
				const P = props ?? {}
				if (type === "bowl") {
					const D = Number.isFinite(P.diameter) ? P.diameter : 0.15
					const H = Number.isFinite(P.height) ? P.height : 0.065
					const t = { ceramic: 0.005, glass: 0.005, melamine: 0.003, aluminium: 0.001, foam: 0.002, paperboard: 0.0012 }[P.material ?? "ceramic"] ?? 0.005
					return { x0: -0.275 * D, x1: 0.275 * D, floor: t, rim: H }
				}
				if (type === "drink-cup") {
					const c = api.CUPS[P.style ?? "foam"] ?? api.CUPS.foam
					return { x0: -c[1] / 2, x1: c[1] / 2, floor: c[3], rim: c[3] + c[2] }
				}
				if (type === "saucepan") {
					const D = Number.isFinite(P.diameter) ? P.diameter : 0.18
					const H = Number.isFinite(P.height) ? P.height : 0.1
					return { x0: -D / 2, x1: D / 2, floor: 0.003, rim: 0.003 + H }
				}
				return null
			}
		},
		digest(item, run, h) {
			const out = []
			const P = run?.resolved?.[item.id] ?? item.props ?? {}
			const lapse = lapseOf(run)
			const frames = run?.track?.frames
			const total = frames?.length ? frames[frames.length - 1].t * lapse : null
			if (total !== null && ["ice-cube", "meltable"].includes(item.type) && seriesOf(run, item.id, "melted")) {
				const f = endOf(run, item.id, "melted")
				const t = whenOf(run, item.id, "melted", (v) => v >= 0.995)
				out.push(t !== null ? `fully melted at ${clockText(t)} of lesson time (the run covers ${clockText(total)})` : `not melted: ${trim(f * 100, 0)} % melted by the end (${clockText(total)} of lesson time)`)
				const t0 = startOf(run, item.id, "temp")
				const lo = Math.min(...(seriesOf(run, item.id, "temp") ?? [0]))
				out.push(`its temperature ${trim(t0)} → ${trim(endOf(run, item.id, "temp"))} °C (lowest ${trim(lo)} °C${lo < -0.5 && (seriesOf(run, item.id, "brine_g") ?? []).some((v) => v > 0) ? ": salt water melting it below 0 °C" : ""}); puddle ${trim(endOf(run, item.id, "puddle_g") ?? 0)} g`)
				for (const at of [600, 1800, 3600]) {
					if (total < at) break
					const v = seriesOf(run, item.id, "melted")
					const k = frames.findIndex((fr) => fr.t * lapse >= at)
					if (k >= 0 && v[k] !== undefined) out.push(`  ${trim(v[k] * 100, 0)} % melted at ${clockText(at)}`)
				}
			}
			if (item.type === "salt-pile") {
				const left = endOf(run, item.id, "salt_g")
				if (left !== null) out.push(`salt ${trim(startOf(run, item.id, "salt_g"), 2)} → ${trim(left, 2)} g undissolved (it dissolves only where it touches ice or water: it must rest ON a cube)`)
			}
			if (item.type === "lamp") {
				const tgt = typeof P.target === "string" ? run?.doc?.solids?.find((s) => s.item === P.target) : null
				const rec = run?.doc?.processes?.find((p) => p.kind === "heat" && p.item === item.id && p.role === "lamp")
				if (rec) {
					const base = run.doc.solids.find((s) => s.id === rec.solid)
					const bx = (base?.at?.x ?? 0) + rec.at.x
					const by = (base?.at?.y ?? 0) + rec.at.y
					const I = rec.power / (2 * Math.PI * (1 - Math.cos(rec.spread)))
					out.push(`${P.bulb ?? "incandescent"} ${trim(P.power_w ?? 60, 0)} W: ${trim(rec.power, 1)} W of light and heat into a ${trim(P.beam_angle ?? 100, 0)}° beam (${trim(I, 1)} W per steradian)${P.bulb === "led" ? "; an LED gives almost no heat" : ""}`)
					if (tgt) {
						const d = Math.hypot(tgt.at.x - bx, tgt.at.y - by)
						out.push(`aimed at ${P.target}: ${trim(d * 100, 0)} cm from its bulb, about ${trim(I / (d * d), 0)} W/m² there (sunlight 1000)`)
					} else out.push("no target: set props.target to the item it should heat (it aims along `aim` otherwise)")
				}
			}
			if (item.type === "thermometer" && seriesOf(run, item.id, "reading")) {
				out.push(`reads ${trim(startOf(run, item.id, "reading"))} → ${trim(endOf(run, item.id, "reading"))} °C (what its bulb, the bottom end, is in or touches; it lags: 8 s in water, 60 s in air)`)
				const wet = seriesOf(run, item.id, "in_water")
				if (wet) {
					const out0 = whenOf(run, item.id, "in_water", (v) => v < 1)
					if (wet[0] >= 1 && out0 !== null) out.push(`its bulb left the water at ${clockText(out0)} of lesson time (after that it reads what it touches or the air)`)
					else if (wet[0] < 1 && !wet.some((v) => v >= 1)) out.push("its bulb is not in any water (it reads what it touches, else the air)")
				}
			}
			if (["drink-cup", "saucepan"].includes(item.type) && seriesOf(run, item.id, "water_temp")) {
				const b = whenOf(run, item.id, "boiling", (v) => v >= 1)
				out.push(`water ${trim(startOf(run, item.id, "water_temp"))} → ${trim(endOf(run, item.id, "water_temp"))} °C, ${trim(startOf(run, item.id, "water_g"), 0)} → ${trim(endOf(run, item.id, "water_g"), 0)} g${b !== null ? `; boils from ${clockText(b)}` : ""} over ${clockText(total ?? 0)} of lesson time`)
			}
			if (["plate", "bowl"].includes(item.type) && seriesOf(run, item.id, "temp_min")) out.push(`coldest spot ${trim(Math.min(...seriesOf(run, item.id, "temp_min")))} °C`)
			if (item.type === "hot-plate" && seriesOf(run, item.id, "temp")) out.push(`top ${trim(startOf(run, item.id, "temp"), 0)} → ${trim(endOf(run, item.id, "temp"), 0)} °C (set to ${trim(P.setpoint_c ?? 250, 0)} °C)`)
			if (["spoon", "steel-rod", "wooden-rod"].includes(item.type) && seriesOf(run, item.id, "temp0")) out.push(`left end ${trim(endOf(run, item.id, "temp0"))} °C, right end ${trim(endOf(run, item.id, "temp7"))} °C at the end`)
			if (item.type === "puddle" && seriesOf(run, item.id, "liquid_g")) out.push(`water ${trim(startOf(run, item.id, "liquid_g"))} → ${trim(endOf(run, item.id, "liquid_g"))} g over ${clockText(total ?? 0)}`)
			// rubbing and impacts: the work an item took in, and what it did to its temperature (honest small numbers)
			const work = endOf(run, item.id, "work_j")
			if (work !== null && work >= 0.01) {
				const t0 = startOf(run, item.id, "temp")
				const t1 = endOf(run, item.id, "temp")
				out.push(`friction and impacts gave it ${trim(work, 2)} J of heat${t0 !== null && t1 !== null ? ` (its temperature ${trim(t0, 2)} → ${trim(t1, 2)} °C)` : ""}: rubbing warms only a little`)
			}
			if (item.type === "sanding-block" && work === null) out.push("it was not rubbed (no friction's work): check rub_at and rub_s fall inside the run, and that it stands on something")
			if (item.type === "candle") {
				const fl = seriesOf(run, item.id, "flame")
				if (!fl) out.push(`not lit${P.lit === true ? "" : ": set props.lit true for a flame (80 W, 0.1 g of wax a minute)"}`)
				else {
					const litAt = whenOf(run, item.id, "flame", (v) => v >= 1)
					const v = fl
					const fr = run?.track?.frames ?? []
					let outAt = null
					let seen = false
					for (let k = 0; k < Math.min(v.length, fr.length); k++) {
						if (v[k] >= 1) seen = true
						else if (seen) {
							outAt = fr[k].t * lapse
							break
						}
					}
					out.push(`flame: ${litAt !== null ? `lit from ${clockText(litAt)}` : "never lit (lit_at past the run's end?)"}${outAt !== null ? `, went out at ${clockText(outAt)}` : litAt !== null ? ", still burning at the end" : ""}; ${trim(endOf(run, item.id, "burned_g") ?? 0, 3)} g of wax burned (a candle lights all round, 1 candela: it needs no aiming; its heat rises above it)`)
				}
			}
			if (item.type === "candle-jar" && seriesOf(run, item.id, "o2_pct")) out.push(`oxygen in its air ${trim(startOf(run, item.id, "o2_pct"), 1)} → ${trim(endOf(run, item.id, "o2_pct"), 1)} % (a flame goes out near 16 %; it must stand over a lit candle's flame)`)
			const spot = seriesOf(run, item.id, "spot_temp")
			if (spot) out.push(`hottest spot under focused light ${trim(Math.max(...spot), 0)} °C${(seriesOf(run, item.id, "scorched") ?? []).some((v) => v >= 1) ? ": it scorched" : " (paper scorches at 233 °C, wood 300 °C)"}`)
			if (item.type === "ball-and-ring" && seriesOf(run, item.id, "ball_mm")) {
				const went = whenOf(run, item.id, "through", (v) => v >= 1)
				out.push(`ball ${trim(startOf(run, item.id, "ball_mm"), 3)} → ${trim(endOf(run, item.id, "ball_mm"), 3)} mm, hole ${trim(endOf(run, item.id, "hole_mm"), 3)} mm: ${went !== null ? `the ball went through at ${clockText(went)}` : (endOf(run, item.id, "fits") ?? 0) >= 1 ? "it fits but has not gone through (is it over the ring?)" : "too big: it stays on the ring until it cools"}`)
			}
			if (item.type === "bimetal-strip" && seriesOf(run, item.id, "bend_mm")) out.push(`its tip moved ${trim(Math.max(...seriesOf(run, item.id, "bend_mm").map(Math.abs)), 1)} mm at most (temperature ${trim(startOf(run, item.id, "temp"), 0)} → ${trim(endOf(run, item.id, "temp"), 0)} °C)`)
			if (item.type === "bowl" && seriesOf(run, item.id, "sand:temp")) out.push(`its sand ${trim(startOf(run, item.id, "sand:temp"))} → ${trim(endOf(run, item.id, "sand:temp"))} °C`)
			if (item.type === "bowl" && seriesOf(run, item.id, "water_temp")) out.push(`its water ${trim(startOf(run, item.id, "water_temp"))} → ${trim(endOf(run, item.id, "water_temp"))} °C, ${trim(endOf(run, item.id, "water_g"), 0)} g`)
			if (seriesOf(run, item.id, "liquid_temp")) out.push(`its liquid ${trim(startOf(run, item.id, "liquid_temp"))} → ${trim(endOf(run, item.id, "liquid_temp"))} °C`)
			if (["beaker", "measuring-jug", "water-tank", "graduated-cylinder", "pitcher"].includes(item.type) && seriesOf(run, item.id, "water_temp"))
				out.push(`its water ${trim(startOf(run, item.id, "water_temp"))} → ${trim(endOf(run, item.id, "water_temp"))} °C (${trim(startOf(run, item.id, "water_g"), 0)} → ${trim(endOf(run, item.id, "water_g"), 0)} g)`)
			void h
			return out.length ? out : null
		},
		words: {
			keys: KEYS,
			how: howWord,
			// (a change whose real result changes what a goal must expect: warm water in the glass makes no dew, no salt no faster melt, an LED almost no
			// heat, a lamp or hot plate switched off none: an edit asking for one may rewrite that goal, web/sim/plugins.js moduleRegoals)
			regoals:
				"(?:warm|hot|cold|iced?|boiling) water|instead of (?:the )?(?:ice|hot|warm|cold)\\w*|no salt|without (?:the |any )?salt|(?:take|remov)\\w* (?:the |all the )?salt|an? led\\b|led bulb|(?:turn|switch)\\w* (?:the )?(?:lamp|light|bulb|hot plate|heater) off|(?:turn|switch)\\w* off (?:the )?(?:lamp|light|bulb|hot plate|heater)|unplug\\w*",
			/** What one added heat thing is called on the card: its amount and kind in real units. */
			added(item) {
				const P = item?.props ?? {}
				if (item?.type === "salt-pile") return `a ${trim(fin(P.mass_g, 6), 1)} g salt pile${P.grain === "coarse" ? " (coarse salt)" : ""}`
				if (item?.type === "drink-cup") {
					const st = P.style ?? "foam"
					const cup = { foam: "a foam cup", paper: "a paper cup", plastic: "a plastic cup", glass: "a drinking glass", steel: "a steel tumbler", mug: "a ceramic mug", flask: "a vacuum flask" }[st] ?? "a cup"
					return `${cup} of ${trim(fin(P.water_ml, 200), 0)} mL of water at ${trim(fin(P.water_temp_c, 80), 0)} °C${P.lid ? " with a lid" : ""}`
				}
				if (item?.type === "saucepan") return `a saucepan of ${trim(fin(P.water_ml, 1000), 0)} mL of water at ${trim(fin(P.water_temp_c, 20), 0)} °C${P.lid ? " with its lid on" : ""}`
				if (item?.type === "meltable") return `a piece of ${P.material ?? "butter"}`
				if (item?.type === "lamp") return `a desk lamp (${P.bulb ?? "incandescent"} ${trim(fin(P.power_w, 60), 0)} W)`
				if (item?.type === "hot-plate") return `a hot plate (${trim(fin(P.power_w, 600), 0)} W, set to ${trim(fin(P.setpoint_c, 250), 0)} °C)`
				if (item?.type === "puddle") return `a puddle of ${trim(fin(P.water_ml, 10), 0)} mL`
				return null
			},
			change(type, key, a, b, nameOf) {
				const n = (v, d = 1) => trim(Number(v), d)
				if (type === "lamp" && key === "beam_angle") return `beam ${n(a, 0)}° → ${n(b, 0)}° wide`
				if (type === "lamp" && key === "aim") return `pointed ${n(a, 0)}° → ${n(b, 0)}° (0 right, −90 straight down)`
				if (type === "salt-pile" && key === "mass_g") return `salt ${n(a)} → ${n(b)} g`
				// (an ice cube's sides are said one at a time by the catalog's own words, "width 4 → 8 cm": the amount of ice follows from all three,
				// which the card's weight says, "59 g → 470 g")
				if (type === "ice-cube" && key === "start_temp_c") return `starts at ${n(a, 0)} → ${n(b, 0)} °C`
				if (type === "lamp" && key === "target") return `lamp aimed at ${a ? nameOf(a) : "nothing"} → ${b ? nameOf(b) : "nothing"}`
				if (type === "lamp" && key === "bulb") return `${a} → ${b} bulb`
				if (type === "lamp" && key === "power_w") return `bulb ${n(a, 0)} → ${n(b, 0)} W`
				if (type === "lamp" && key === "head_height") return `lamp head ${n(a * 100, 0)} → ${n(b * 100, 0)} cm up`
				if (["plate", "bowl", "spoon", "steel-rod", "meltable"].includes(type) && key === "material") return `${a} → ${b}`
				if (type === "drink-cup" && key === "style") return `${a} → ${b} cup`
				if (key === "lid") return `lid ${a ? "on" : "off"} → ${b ? "on" : "off"}`
				if (key === "water_temp_c") return `water ${n(a, 0)} → ${n(b, 0)} °C`
				if (key === "water_ml") return `water ${n(a, 0)} → ${n(b, 0)} mL`
				if (type === "hot-plate" && key === "power_w") return `hot plate ${n(a, 0)} → ${n(b, 0)} W`
				if (type === "hot-plate" && key === "setpoint_c") return `hot plate set to ${n(a, 0)} → ${n(b, 0)} °C`
				if (type === "candle" && key === "lit") return `candle ${a ? "lit" : "not lit"} → ${b ? "lit" : "not lit"}`
				if (type === "candle" && key === "lit_at") return `lit at ${n(a)} → ${n(b)} s`
				if (type === "candle-jar" && key === "volume_ml") return `jar ${n(a / 1000, 2)} → ${n(b / 1000, 2)} L of air`
				if (type === "sanding-block" && key === "press_n") return `pressed with ${n(a)} → ${n(b)} N`
				if (type === "sanding-block" && key === "speed") return `rubbed at ${n(a, 2)} → ${n(b, 2)} m/s`
				if (type === "sanding-block" && key === "rub_s") return `rubbed for ${n(a)} → ${n(b)} s`
				if (type === "ball-and-ring" && key === "ball_temp_c") return `ball ${n(a, 0)} → ${n(b, 0)} °C`
				if (type === "ball-and-ring" && key === "ring_temp_c") return `ring ${n(a, 0)} → ${n(b, 0)} °C`
				if (type === "bimetal-strip" && key === "start_temp_c") return `strip starts at ${n(a, 0)} → ${n(b, 0)} °C`
				if (type === "bowl" && key === "contents") return `holds ${a} → ${b}`
				if (type === "bowl" && key === "contents_g") return `${n(a, 0)} → ${n(b, 0)} g in it`
				if (type === "pitcher" && key === "temp_c") return `liquid ${n(a, 0)} → ${n(b, 0)} °C`
				return null
			}
		},
		clock: api.clock
	}
}
