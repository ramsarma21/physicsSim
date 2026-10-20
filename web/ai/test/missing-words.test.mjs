// The card's "not in the library" line (node --test web/ai/test/missing-words.test.mjs): the asked words said after "there's no" / "there
// are no" as a noun phrase (adv-wmm W2: "there's no someone shaking the end of the rope in the library" was the card), one or many read off the
// head noun, and the lines the card already said right kept as they were.
import test from "node:test"
import assert from "node:assert/strict"
import { missingLine, missingThing } from "../missing-words.js"

const NAMES = { wave_rope: ["Wave rope", "wave ropes"], plank: ["Plank", "planks"], tp_roll: ["Toilet paper roll", "toilet paper rolls"], box: ["Cardboard box", "cardboard boxes"], egg: ["Egg", "eggs"] }
const nameOf = (t, n) => NAMES[t]?.[n > 1 ? 1 : 0] ?? t
const line = (asked, sub = null, extra = {}) => missingLine({ asked, substitute_type: sub, ...extra }, { nameOf })

test("a person asked for by a pronoun is a person (adv-wmm W2)", () => {
	assert.equal(line("someone shaking the end of the rope", "wave_rope"), "there’s no person shaking the end of the rope in the library, so I used a wave rope")
	assert.equal(line("Somebody pushing the cart", "plank"), "there’s no person pushing the cart in the library, so I used a plank")
	assert.equal(line("you pushing the cart", "plank"), "there’s no person pushing the cart in the library, so I used a plank")
	assert.equal(line("her pushing the cart"), "there’s no person pushing the cart in the library, so I left it out")
	assert.equal(line("anyone"), "there’s no person in the library, so I left it out")
	assert.equal(line("someone’s hand"), "there’s no person’s hand in the library, so I left it out")
	for (const asked of ["someone shaking the end of the rope", "somebody", "anyone holding it", "everyone watching", "you pushing the cart"]) assert.doesNotMatch(line(asked), /\bno (some|any|every)(one|body|thing)\b|\bno (you|me|him|her|us|them)\b/i, asked)
})

test("something / anything is said as nothing", () => {
	assert.equal(line("something to hold the rope", "wave_rope"), "there’s nothing to hold the rope in the library, so I used a wave rope")
	assert.equal(line("anything sticky"), "there’s nothing sticky in the library, so I left it out")
})

test("one or many from the head noun, not the phrase's last word", () => {
	assert.equal(line("a person shaking the ropes", "wave_rope"), "there’s no person shaking the ropes in the library, so I used a wave rope")
	assert.equal(line("a box of marbles", "box"), "there’s no box of marbles in the library, so I used a cardboard box")
	assert.equal(line("a ball rolling down a ramp", "egg"), "there’s no ball rolling down a ramp in the library, so I used an egg")
	assert.equal(line("long strings tied to the post"), "there are no long strings tied to the post in the library, so I left it out")
	assert.equal(line("kids on a seesaw", "plank"), "there are no kids on a seesaw in the library, so I used planks")
	assert.equal(line("big rolling pins", "plank"), "there are no big rolling pins in the library, so I used planks")
	assert.equal(line("people"), "there are no people in the library, so I left it out")
	assert.equal(line("children"), "there are no children in the library, so I left it out")
	assert.equal(line("lens"), "there’s no lens in the library, so I left it out")
	assert.equal(line("a glass"), "there’s no glass in the library, so I left it out")
	assert.equal(line("a pair of scissors"), "there’s no pair of scissors in the library, so I left it out")
})

test("determiners and counts go; a measure stays", () => {
	assert.equal(line("your hand"), "there’s no hand in the library, so I left it out")
	assert.equal(line("these marbles", "egg"), "there are no marbles in the library, so I used eggs")
	assert.equal(line("some of the balls", "egg"), "there are no balls in the library, so I used eggs")
	assert.equal(line("two people pulling the rope", "wave_rope"), "there are no people pulling the rope in the library, so I used wave ropes")
	assert.equal(line("ten rolls", "box"), "there are no rolls in the library, so I used cardboard boxes")
	assert.equal(line("lots of sand"), "there’s no sand in the library, so I left it out")
	assert.equal(line("a lot of marbles", "egg"), "there are no marbles in the library, so I used eggs")
	assert.equal(line("a 6 m drop"), "there’s no 6 m drop in the library, so I left it out")
	assert.equal(line("2 m ramps", "plank"), "there are no 2 m ramps in the library, so I used planks")
})

test("the lines the card already said right stay as they were", () => {
	assert.equal(line("standing toilet paper rolls", "tp_roll"), "there are no standing toilet paper rolls in the library, so I used toilet paper rolls")
	assert.equal(line("a bowling lane", "plank"), "there’s no bowling lane in the library, so I used a plank")
	assert.equal(line("a dog"), "there’s no dog in the library, so I left it out")
	assert.equal(line("my dog (watching)"), "there’s no dog (watching) in the library, so I left it out")
	assert.equal(line("a basketball hoop", "box"), "there’s no basketball hoop in the library, so I used a cardboard box")
	assert.equal(line("eggs in place of apples", "egg"), "there are no eggs in place of apples in the library, so I used eggs")
	assert.equal(line("dominoes", "box"), "there are no dominoes in the library, so I used cardboard boxes")
	assert.equal(line("a cat", "egg", { noSub: true }), "there’s no cat in the library")
})

test("odd input never throws and never says undefined", () => {
	for (const asked of [null, undefined, "", "  ", "a", "the", "of", 42, "some of", "two"]) {
		const t = line(asked)
		assert.doesNotMatch(t, /undefined|null|NaN|\bno\s+in\b|\s{2}/, String(asked))
	}
	assert.equal(missingThing("").words, "such thing")
	for (const asked of ["the", "a", "some", "two", "of", "some of"]) assert.equal(missingThing(asked).words, "such thing", asked)
	assert.equal(missingLine({ asked: "a cat", substitute_type: "egg" }, { nameOf: () => { throw new Error("x") } }), "there’s no cat in the library, so I used an egg")
	assert.equal(missingLine({ asked: "a cat", substitute_type: "wave_rope" }), "there’s no cat in the library, so I used a wave rope")
})
