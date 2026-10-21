// The hands module's port (machines/mod_hands.py, line for line: the same catalog entries) and its plug-ins for the AI.
// Render only: a person's hand where a person acts (a held thing, a pusher, a pitcher), drawn by the 3D view from the item's resolved props
// (web/hands.js); nothing is built, so every document is the one it was. A module file takes everything from the framework object
// register_all gets (web/sim/items.js FRAMEWORK), so it imports nothing.
const HOLD_GRIPS = ["none", "auto", "pinch", "palm", "press", "grip"]
const HAND_FROM = ["auto", "left", "right", "above"]
const PUSH_SKINS = ["none", "finger", "hand", "two hands", "fist"]
const POUR_HANDS = ["none", "hand"]

export function register_all(f) {
	const { Prop, register_common_prop } = f
	const holdable = (t) => !!t.dynamic && t.key !== "pusher"
	register_common_prop(
		new Prop("hand", "Hand", "none", {
			kind: "choice",
			choices: HOLD_GRIPS,
			help:
				"While it is held (or fixed): a hand holds it instead of the pull pin. auto picks the grip; pinch, palm (it sits " +
				"on the open palm), press (a fingertip holds it down), grip (the whole hand round it). Let go, the hand opens " +
				"and moves out of the picture (only the look)"
		}),
		holdable
	)
	register_common_prop(
		new Prop("hand_from", "Hand comes from", "auto", {
			kind: "choice",
			choices: HAND_FROM,
			help: "Where the holding hand's arm comes from (auto: from above for a press or a grip, else the side it does not go to)"
		}),
		holdable
	)
	register_common_prop(
		new Prop("hand", "Pushed by", "none", {
			kind: "choice",
			choices: PUSH_SKINS,
			help: "A person's push instead of the machine: a finger, a hand, two hands or a fist at the paddle's face (only the look: " + "the push is its force and time, never the hand's size)"
		}),
		(t) => t.key === "pusher"
	)
	register_common_prop(
		new Prop("hand", "Hand", "none", { kind: "choice", choices: POUR_HANDS, help: "A hand holds it by its handle (a cup round its body) and tips it (only the look)" }),
		(t) => t.key === "pitcher"
	)
}

const GRIP_WORDS = { auto: "a hand holds it", pinch: "a hand pinches it", palm: "it sits on a hand's open palm", press: "a fingertip holds it down", grip: "a hand grips it" }
const PUSH_WORDS = { finger: "a finger pushes it", hand: "a hand pushes it", "two hands": "two hands push it", fist: "a fist pushes it" }

export const plugin = {
	title: "Hands (a person holds, lets go, pushes, pours)",
	howto:
		"Render only (the physics is untouched): a person's hand where a person acts, real size, the arm running out of the picture. " +
		"props.hand on a HELD thing (held: true; it lets go at the scene's release): auto | pinch | palm | press | grip — a hand holds it instead of the pull pin; " +
		"at the release the fingers open and the hand moves out of the picture (a thing with start_speed is thrown: the hand follows through first). " +
		"auto picks: a fingertip pressing a floater down in water (press), thumb and finger round a small thing (pinch), the open palm under a ball or block in the air (palm), " +
		"the whole hand from above round a thing that rests on something (grip). props.hand_from: auto | left | right | above (where the arm comes from). " +
		"On a FIXED thing (fixed: true) props.hand holds it the whole run instead of its stand (a magnet held in a fist: grip). " +
		"A pusher's props.hand: finger | hand | two hands | fist draws the push as a person's at the paddle's face (its housing, rod and paddle not drawn); " +
		"the push's strength is its force and push_time, never the hand: a harder push is more force, and the skin says only finger, hand or two hands. " +
		"A pitcher's props.hand: hand — a hand holds it by its handle (a cup round its body) and tips it.",
	prompt: {
		plan: "A person holds, drops, throws, pushes or pours: held: true + props.hand (auto, or pinch | palm | press | grip) on the held thing (props.hand_from left | right | above if it matters); a finger, hand or two hands pushing: a pusher with props.hand (finger | hand | two hands | fist), its force says how hard; a hand tipping a cup: a pitcher with props.hand \"hand\".",
		edit: "props.hand puts a person's hand on a held or fixed thing (auto | pinch | palm | press | grip | none), on a pusher (finger | hand | two hands | fist | none) or a pitcher (hand | none); props.hand_from picks the arm's side."
	},
	words: {
		change(type, key, a, b, nameOf) {
			void nameOf
			if (key === "hand_from") return b && b !== "auto" ? `the hand comes from ${b === "above" ? "above" : `the ${b}`}` : null
			if (key !== "hand") return null
			const off = b === undefined || b === null || b === "none"
			if (type === "pusher") return off ? (a && a !== "none" ? "the pusher is a machine again (no hand)" : null) : (PUSH_WORDS[b] ?? null)
			if (type === "pitcher") return off ? (a === "hand" ? "no hand on it (it tips by itself)" : null) : "a hand holds and tips it"
			return off ? (a && a !== "none" ? "no hand (the pull pin holds it)" : null) : (GRIP_WORDS[b] ?? null)
		}
	}
}
