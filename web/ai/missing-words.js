// The card's "not in the library" line (ai, 20 Oct). The plan's `missing[].asked` is what the person asked for, in the AI's words; the card
// says it after "there's no" / "there are no". Those words are not always a noun with its article: "someone shaking the end of the rope" read
// "there's no someone shaking the end of the rope in the library" (adv-wmm W2), "a person shaking the ropes" read "there are no person ...",
// "a box of marbles" read "there are no box of marbles". Here the asked words become a noun phrase that "no" can stand before:
//   someone / somebody / anyone / everyone (and "you pushing ...")  -> "person" ("there's no person shaking the end of the rope")
//   something / anything / everything                             -> "nothing ..." ("there's nothing to hold the rope")
//   a / an / the / some / any / this / that / these / those / my / your / his / her / their / our / its  -> dropped
//   a count ("two people", "ten rolls", "some of the") -> dropped, and they are many; a measure stays ("a 6 m drop", "2 m ramps")
// and one or many is read off the head noun (the words before "of", "on", "for", "that", a "shaking the ..." participle and so on), never off
// the phrase's last word. Pure, no imports.
//   missingThing(asked) -> {words, many, nothing}
//   missingLine(miss, {nameOf}) -> "there’s no person shaking the end of the rope in the library, so I used a wave rope" (no "Heads-up: ", no full stop)

const DETERMINER = /^(?:a|an|the|some|any|this|that|these|those|my|your|his|their|our|its|her(?!\s+\S+ing\b))\s+/i
// (a count goes: "two people pulling the rope" -> "there are no people pulling the rope"; a measure stays: "a 6 m drop", "2 m ramps")
const COUNT = /^(?:\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|fifty|a hundred|hundreds of|dozens of|several|many|both|few|a few|a couple of|a pair of)\s+(?!(?:m|cm|mm|km|kg|g|n|s|v|w|l|ml|hz|°c?|degrees?|met(?:re|er)s?|centimet(?:re|er)s?|millimet(?:re|er)s?|inch(?:es)?|feet|foot|seconds?|volts?|watts?|newtons?|grams?|kilograms?|lit(?:re|er)s?|percent|%)\b)/i
const QUANTITY = /^(?:lots of|a lot of|lot of|plenty of|loads of|load of)\s+/i
const PERSON = /^(?:some|any|every)(?:one|body)\b|^(?:no one|nobody)\b|^(?:me|you|him|her|us|them)(?=\s+\S+ing\b|$)/i
const THING = /^(?:some|any|every)thing\b/i
// (where the head noun ends: a preposition, a relative word, or a participle that takes words after it ("shaking the end", "rolling down",
// "tied to the post"))
const CUT = /^(?:in|on|of|with|for|from|at|by|to|under|over|inside|onto|into|near|beside|behind|that|who|which|whose|where|instead|like|without|against|across|along|around|through|between|above|below|so|and|or|but)$/i
const AFTER_ING = /^(?:the|a|an|his|her|its|their|my|your|our|this|that|these|those|some|it|them|him|me|us|down|up|off|on|in|into|onto|over|across|along|around|through|from|to|at|back|forward|forwards|out|away|towards?|round|past)$/i
const IRREGULAR_MANY = /^(?:people|persons|children|men|women|feet|teeth|mice|geese|dice|oxen|cattle|sheep)$/i
// (words that end in s and are one thing: "there's no lens", never "there are no lens")
const ONE_WITH_S = /(?:ss|us|is|ics)$|^(?:lens|gas|canvas|news|series|species|atlas|chaos|bias|asbestos|bellows)$/i

/** The words before which "no" stands, and whether they are many: "someone shaking the end of the rope" -> {words: "person shaking the end
 *  of the rope", many: false}; "something to hold the rope" -> {words: "nothing to hold the rope", nothing: true}. */
export function missingThing(asked) {
	let w = String(asked ?? "").trim().replace(/\s+/g, " ")
	let many = false
	// (what comes before the thing itself: "some of the", "the two", "a lot of", "two of the")
	for (let k = 0; k < 4; k++) {
		const m = DETERMINER.exec(w) ?? COUNT.exec(w) ?? QUANTITY.exec(w) ?? (k ? /^of\s+/i.exec(w) : null)
		if (!m || m[0].length >= w.length) break
		if (/^(?:these|those)\b/i.test(m[0]) || COUNT.test(m[0] + "x")) many = true
		w = w.slice(m[0].length)
	}
	if (!w || DETERMINER.test(`${w} x`) || COUNT.test(`${w} x`) || /^of$/i.test(w)) return { words: "such thing", many: false, nothing: false }
	if (THING.test(w)) return { words: w.replace(THING, "nothing"), many: false, nothing: true }
	const p = PERSON.exec(w)
	if (p) {
		const poss = /^['’]s\b/.exec(w.slice(p[0].length))
		w = `person${w.slice(p[0].length)}`
		if (!poss) return { words: w, many: false, nothing: false }
	}
	const parts = w.split(" ")
	let end = parts.length
	for (let i = 1; i < parts.length; i++) {
		if (CUT.test(parts[i]) || (/\w{2,}(?:ing|ed)$/i.test(parts[i]) && i + 1 < parts.length && AFTER_ING.test(parts[i + 1]))) {
			end = i
			break
		}
	}
	// (one or many from the head noun's own ending; a possessive's owner is not the head: "a dog's bowl" is one)
	const last = String(parts[end - 1] ?? "").replace(/[^a-z'’]+$/i, "")
	if (!many) many = IRREGULAR_MANY.test(last) || (/s$/i.test(last) && !/['’]s$/.test(last) && !ONE_WITH_S.test(last))
	return { words: w, many, nothing: false }
}

/** The card's line for one thing not in the library. nameOf(type, n) -> the stand-in's name for n of them (the catalog's, lower case is applied
 *  here); miss.noSub: no stand-in is said (one that isn't on the table: V8820 c04). */
export function missingLine(miss, { nameOf = (type) => String(type ?? "").replace(/[_-]+/g, " ") } = {}) {
	const t = missingThing(miss?.asked)
	const lead = t.nothing ? `there’s ${t.words}` : `${t.many ? "there are no" : "there’s no"} ${t.words}`
	let used = "I left it out"
	const sub = miss?.substitute_type
	if (sub) {
		let subW = String(sub)
		try {
			subW = String(nameOf(sub, t.many ? 2 : 1) ?? sub)
		} catch {}
		subW = subW.toLowerCase()
		used = `I used ${t.many ? "" : /^[aeiou]/i.test(subW) ? "an " : "a "}${subW}`
	}
	return `${lead} in the library${miss?.noSub ? "" : `, so ${used}`}`
}
