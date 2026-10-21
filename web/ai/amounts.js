// Amounts in a person's words, with their units ("5 cm", "200 mL", "20 mL/s", "80 °C", "9 V", "440 Hz", "300 rpm", "5 s", "2 L", "twice"), and
// the words that name a setting no module word names (its own label, its choices, an on/off's usual verbs): what the edit's reading of the
// person's own choices (./orchestrator.js choicesOf) holds, so a fix never offers back an amount the person gave ("fill the pitcher with 200 mL"
// is the person's 200 mL) nor flips a switch they named ("light the candle", "close the switch"). Pure, no imports.

/** Units, each as a regex source, with what it measures. The longer spellings of a family first; every unit is matched whole (no letter after it). */
const UNIT_TABLE = [
	// (compound units before their parts: "20 mL/s" is a flow, never "20 mL" and a stray "/s")
	["speed", String.raw`(?:m|cm|mm)\s*\/\s*s|met(?:re|er)s?\s+(?:per|a)\s+second|centimet(?:re|er)s?\s+(?:per|a)\s+second|km\s*\/\s*h|kph|mph`],
	["flow", String.raw`ml\s*\/\s*s|ml\s*\/\s*min|l\s*\/\s*s|l\s*\/\s*min|(?:ml|millilit(?:re|er)s?|lit(?:re|er)s?|l)\s+(?:per|a)\s+(?:second|minute)`],
	["massflow", String.raw`g\s*\/\s*s|grams?\s+(?:per|a)\s+second`],
	["rotation", String.raw`turns?\s*\/\s*min|turns?\s*\/\s*s|turns?\s+(?:per|a)\s+(?:minute|second)|revs?\s+(?:per|a)\s+minute|revolutions?\s+(?:per|a)\s+minute|rpm|rps`],
	["turns", String.raw`turns?|revolutions?|revs?|winds?`],
	["stiffness", String.raw`n\s*\/\s*m`],
	["irradiance", String.raw`w\s*\/\s*m(?:²|2)`],
	["torque", String.raw`n\s*·\s*m|n\s*m|newton[- ]met(?:re|er)s?`],
	["temperature", String.raw`[°º]\s*[cf]|deg(?:rees?)?\s+(?:c|f|celsius|centigrade|fahrenheit)|celsius|centigrade|fahrenheit`],
	["angle", String.raw`[°º]|deg(?:rees?)?`],
	["volume", String.raw`ml|millilit(?:re|er)s?|cl|lit(?:re|er)s?|l|cc|cm³|cm3`],
	["length", String.raw`mm|millimet(?:re|er)s?|cm|centimet(?:re|er)s?|km|kilomet(?:re|er)s?|m|met(?:re|er)s?|inch(?:es)?|in|ft|feet|foot`],
	["mass", String.raw`mg|milligrams?|kg|kilograms?|kilos?|g|grams?|lbs?|pounds?|oz|ounces?`],
	["time", String.raw`ms|milliseconds?|secs?|seconds?|s|mins?|minutes?|hrs?|hours?|h`],
	["power", String.raw`mw|milliwatts?|kw|kilowatts?|w|watts?`],
	["voltage", String.raw`mv|kv|v|volts?`],
	["current", String.raw`ma|milliamps?|amps?|amperes?`],
	["resistance", String.raw`kω|ω|kilohms?|ohms?`],
	["frequency", String.raw`khz|hz|hertz`],
	["force", String.raw`kn|n|newtons?`],
	["pressure", String.raw`kpa|pa|pascals?|bar|psi|atm|atmospheres?`],
	["energy", String.raw`kj|j|joules?`],
	["light", String.raw`lx|lux|lm|lumens?`],
	["sound", String.raw`db|decibels?`],
	["percent", String.raw`%|percent|per\s+cent`],
	["ratio", String.raw`x|×|times`]
]
const UNIT_SRC = UNIT_TABLE.map(([, s]) => s).join("|")
/**
 * An amount said in words or numbers, a regex source for "i" patterns: "5 cm", "30°", "200 mL", "20 mL/s", "80 °C", "9 V", "twice", "five times",
 * "double" (a unit is matched whole: "5 small balls" is no "5 s", "200 mL" no "200 m"). Built into ./orchestrator.js AMT.
 */
export const AMOUNT = String.raw`(?:\d+(?:\.\d+)?\s*(?:${UNIT_SRC})(?![a-z])|twice|double|triple|half|(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+times)`
/** A number with a unit (a request that gives one: what it set is exactly what was asked): ./orchestrator.js EXPLICIT_RE. ("in" is left out:
 *  "put all 5 in the box" gives no amount; nor a count of turns, nor a time, which says when as often as how long: "land in the cup within 3 s".) */
export const EXPLICIT = new RegExp(String.raw`\d+(?:\.\d+)?\s*(?:${UNIT_TABLE.filter(([f]) => f !== "turns" && f !== "time").map(([, s]) => s.replace(/\|in\|/, "|")).join("|")})(?![a-z])`, "i")

const FAMILY_RES = UNIT_TABLE.map(([f, s]) => [f, new RegExp(`^(?:${s})$`, "i")])
/** What a unit measures ("mL" -> "volume", "°C" -> "temperature", "turns/min" -> "rotation"), or null for one this file doesn't know. */
export function unitFamily(unit) {
	const u = String(unit ?? "").trim().replace(/\s+/g, " ")
	if (!u) return null
	for (const [f, re] of FAMILY_RES) if (re.test(u)) return f
	return null
}
/** The families of the amounts in a text, in order: [{family, at, text}] ("fill it with 200 mL at 2 s" -> volume, time). */
export function amountsIn(text) {
	const out = []
	const re = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(${UNIT_SRC})(?![a-z])`, "gi")
	for (const m of String(text ?? "").matchAll(re)) out.push({ family: unitFamily(m[2]), value: Number(m[1]), unit: m[2], at: m.index, text: m[0] })
	return out
}
/** Families a setting shares with a thing's place (a length, an angle): an amount in them is said for a move as often as for a size, so it holds a
 *  setting only with that setting's own words beside it (./orchestrator.js keyAmount); "x", "times" and percents say how much more, not a value. */
const PLACE_FAMILIES = new Set(["length", "angle", "ratio"])
/**
 * Does a clause give this setting its own amount by the unit alone: an amount in the setting's unit family ("200 mL" for a prop in mL, "20 mL/s"
 * for one in mL/s, "80 °C" for one in °C), where no other setting of the keys the edit set shares that family? (A length or an angle never: a
 * place is said in them too.) spec: the prop's catalog spec; others: the specs of the other keys the edit set on the same thing.
 */
export function unitAmount(clause, spec, others = []) {
	const fam = unitFamily(spec?.unit)
	if (!fam || PLACE_FAMILIES.has(fam)) return false
	if (others.some((o) => o && o !== spec && unitFamily(o.unit) === fam)) return false
	// ("heat it to 80 degrees": degrees with no C or F are a temperature's where nothing in the clause turns or tilts)
	if (fam === "temperature" && /\b\d+(?:\.\d+)?\s*deg(?:rees?)?\b/i.test(clause) && !/\b(tilt|turn|rotat|angle|lean|steep|incline|slope|aim|point|swing)/i.test(clause)) return true
	return amountsIn(clause).some((a) => a.family === fam)
}
/** A bare number said for a setting that has no unit ("set the friction to 0.5", "bounciness 0.8", "use 3 cells"): words is the setting's regex
 *  alternation. */
export function bareAmount(clause, words, spec) {
	if (!words || String(spec?.unit ?? "") !== "" || spec?.kind === "bool" || spec?.kind === "choice") return false
	const after = new RegExp(String.raw`\b(?:${words})\s+(?:(?:of|to|at|is|=)\s*)?(?:about\s+|exactly\s+)?\d+(?:\.\d+)?(?![\d.]*\s*(?:[a-z%°º×]))`, "i")
	const before = new RegExp(String.raw`(?:^|[^\d.])\d+\s+(?:${words})\b`, "i")
	return after.test(clause) || before.test(clause)
}

// (and the generic words a label may hold that name nothing of its own: "North on the other side", "Current the other way", "Can", "Add")
const STOP = new Set(["the", "a", "an", "of", "at", "in", "on", "to", "by", "for", "and", "or", "with", "it", "its", "is", "start", "made", "held", "kind", "set", "shows", "from", "when", "how", "much", "many", "one", "two", "per", "each", "end", "side", "top", "none", "default", "auto", "off", "other", "another", "way", "like", "add", "can", "far", "same", "new", "first", "last", "left", "right", "front", "back", "bottom", "away", "more", "less"])
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** A word's own stem, as a regex: "bounciness" -> "bounc\\w*", "padding" -> "pad\\w*", "closed" -> "clos\\w*", "lit" -> "lit". */
function stemOf(w) {
	let s = w.toLowerCase()
	if (s.length <= 3) return esc(s)
	for (const suf of ["iness", "ness", "ing", "ed", "es", "ity", "y", "s"]) if (s.endsWith(suf) && s.length - suf.length >= 3) {
		s = s.slice(0, -suf.length)
		break
	}
	// (a doubled consonant the suffix left: "padd" -> "pad")
	if (/([b-df-hj-np-tv-z])\1$/.test(s) && s.length >= 4) s = s.slice(0, -1)
	return `${esc(s)}\\w*`
}
/** An on/off's words beyond its own label: the verbs a person uses for it either way ("blow out the candle" switches its `lit`). */
const BOOL_WORDS = {
	lit: String.raw`light\w*|unlit|blow\w* (?:\w+ ){0,2}out|put (?:\w+ ){0,2}out|snuff\w*|extinguish\w*|burn\w*`,
	closed: String.raw`clos\w*|open\w*|shut\w*`,
	on: String.raw`switch\w* (?:\w+ ){0,3}(?:on|off)|turn\w* (?:\w+ ){0,3}(?:on|off)|power\w*`,
	tare: String.raw`tare\w*|zero\w*`,
	tied: String.raw`tie|ties|tied|tying|untie\w*|knot\w*`,
	hollow: String.raw`hollow\w*|solid\w*`,
	hung: String.raw`hang\w*|hung`,
	legs: String.raw`legs?`,
	glow: String.raw`glow\w*`
}
/**
 * The words that name a setting in a request when no module word does (./orchestrator.js choicesOf), as a regex alternation, or null: the
 * words of its label ("Lit", "Closed at the start", "Design"), its key's, its choices for a pick-from-list ("dart", "glider", "bubble wrap")
 * and an on/off's usual verbs either way ("light", "blow out"; "close", "open"). spec: the prop's catalog spec; key: its key; own: the words of the
 * thing's own name and kind, which name the thing, not the setting.
 */
export function propWords(spec, key, own = []) {
	if (!spec) return null
	const words = new Set()
	// (a label word that is the thing's own name is no word for the setting: a drink cup's "Cup", a charged rod's "Rod" name the thing itself)
	const mine = new Set((Array.isArray(own) ? own : []).map((w) => stemOf(String(w).toLowerCase())))
	const add = (w) => {
		const t = String(w ?? "").toLowerCase().trim()
		if (t.length < 3 || STOP.has(t) || !/^[\p{L}][\p{L}'’-]*$/u.test(t) || mine.has(stemOf(t))) return
		words.add(stemOf(t))
	}
	for (const w of String(spec.label ?? "").split(/[^\p{L}'’-]+/u)) add(w)
	for (const w of String(key ?? spec.key ?? "").split(/[_\s]+/)) if (!/^\d/.test(w)) add(w)
	if (spec.kind === "bool") {
		const extra = BOOL_WORDS[String(key ?? spec.key)]
		if (extra) words.add(extra)
	}
	if (spec.kind === "choice")
		for (const c of spec.choices ?? []) {
			const t = String(c ?? "").toLowerCase().trim()
			if (t.length < 3 || STOP.has(t) || /^\d/.test(t)) continue
			words.add(esc(t).replace(/\s+/g, "\\s+"))
		}
	return words.size ? [...words].sort((a, b) => b.length - a.length).join("|") : null
}
