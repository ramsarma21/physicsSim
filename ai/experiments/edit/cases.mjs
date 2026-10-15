// The edit eval set: 105 realistic follow-up requests on the starter Rube Goldberg machine (63), 5 built-in scenarios and 5 AI-built scenes,
// each with HARD checks (lib/check.mjs reads these specs):
//   t: {itemId: spec}   the asked change, item by item. spec: type (one of) · removed · props {k: {ratio|eq|min|max|delta|changed}} (on the
//                       built values: a ball's auto mass included) · dx / dy / da [lo, hi] (anchor and angle deltas, m and °) · x / y [lo, hi] ·
//                       held · rests ("same" | id | "table": what it rests on after, from the true outlines) · anyOf [spec...] · unchanged ·
//                       reply (a regex the reply must match, inside an anyOf branch: "or say plainly that it can't")
//   added: [{type | types, count | [min, max], near: [id, m], restsOn: id | "table", x: [lo, hi]}]   new items (and no others)
//   counts: {type: n}   how many of a type the scene has after (a replace-all)
//   scene: {seconds | release: [lo, hi]}
//   allow: [ids]        others that may change (what rests on a moved/removed thing, a neighbour pushed by a bigger one)
//   allowAny + maxChanged: "make it work again": any items may change, but at most n of them
//   noChange: a question (or a truly ambiguous request): the scene must stay byte-identical; ask: {candidates: [regex], min}: the reply asks
//                       which one, naming at least `min` of the candidates
//   answer: a regex the reply of a factual question must match
//   works: "keep" (default: every check that passed before still passes, or the reply says what no longer happens) | "fix" (the base's
//                       goals must pass after) | "none"
//   history: earlier chat turns. base: a base id (bases.mjs), or {from, mutate} (a broken variant for "make it work again").
const R = (s) => s // (regex sources stay strings: the results are JSON)

const STARTER = "rube-goldberg"
const red = ["red", "ball 1", "superball", "top", "first", "upper", "rubber"]
const yellow = ["yellow", "ball 2", "plastic", "seesaw", "second", "lower", "hollow"]
const CANT = R("(can.?t|cannot|isn.?t (possible|available|an option)|no (colou?r|paint|way)|not (available|possible|offered)|only comes? in|doesn.?t (have|offer|come)|library)")

export const CASES = [
	// ---------------------------------------------------------------- starter: swaps
	{ id: "s-swap-user", base: STARTER, cat: "swap", text: "replace the yellow ball with a tennis ball and the red ball with a basketball", t: { ball2: { type: "tennis-ball", rests: "same", dx: [-0.06, 0.06] }, ball1: { type: "basketball", held: true, dx: [-0.15, 0.15], dy: [-0.01, 0.35] } } },
	{ id: "s-swap-golf", base: STARTER, cat: "swap", text: "swap the red ball for a golf ball", t: { ball1: { type: "golf-ball", held: true, dx: [-0.05, 0.05], dy: [-0.03, 0.05] } } },
	{ id: "s-swap-pingpong", base: STARTER, cat: "swap", text: "make the yellow ball a ping-pong ball", t: { ball2: { type: "ping-pong-ball", rests: "same", dx: [-0.05, 0.05] } } },
	{ id: "s-swap-bucket", base: STARTER, cat: "swap", text: "replace the box with a bucket", t: { box: { type: "bucket", dx: [-0.15, 0.15], dy: [-0.2, 0.2] } }, added: [{ type: ["wooden-block", "brick", "hardcover-book", "paperback-book", "plank", "cardboard-box"], count: [0, 2] }], note: "a bucket cannot hang on cords: a post under it is allowed" },
	{ id: "s-swap-steel", base: STARTER, cat: "swap", text: "use a steel ball instead of the red one", t: { ball1: { type: "steel-ball", held: true, dx: [-0.05, 0.05], dy: [-0.03, 0.05] } } },
	// ---------------------------------------------------------------- starter: resize
	{ id: "s-box-wider", base: STARTER, cat: "resize", text: "make the box twice as wide", t: { box: { props: { width: { ratio: [1.9, 2.1] } }, dx: [-0.3, 0.3] } }, allow: ["seesaw", "ball2"] },
	{ id: "s-red-bigger", base: STARTER, cat: "resize", text: "make the red ball bigger", t: { ball1: { props: { diameter: { ratio: [1.2, 2.6] } }, held: true, dx: [-0.1, 0.1], dy: [-0.01, 0.2] } } },
	{ id: "s-seesaw-longer", base: STARTER, cat: "resize", text: "make the seesaw a bit longer", t: { seesaw: { props: { length: { ratio: [1.05, 1.7] } } } }, allow: ["ball2", "box", "dominoes"] },
	{ id: "s-dominoes-smaller", base: STARTER, cat: "resize", text: "make the dominoes smaller", t: { dominoes: { anyOf: [{ props: { first_height: { ratio: [0.3, 0.95] } } }, { props: { growth: { ratio: [0.5, 0.97] } } }] } } },
	{ id: "s-ramp2-shorter", base: STARTER, cat: "resize", text: "make ramp 2 shorter", t: { ramp2: { props: { length: { ratio: [0.4, 0.95] } } } } },
	// ---------------------------------------------------------------- starter: colour / material
	{ id: "s-box-steel", base: STARTER, cat: "material", text: "make the box out of steel", t: { box: { props: { material: { eq: "steel" } } } } },
	{ id: "s-ramp2-ice", base: STARTER, cat: "material", text: "make ramp 2 slippery like ice", t: { ramp2: { anyOf: [{ props: { friction: { ratio: [0, 0.6] } } }, { type: ["ice-sheet"] }] } } },
	{ id: "s-yellow-red", base: STARTER, cat: "material", text: "make the yellow ball red", t: { ball2: { anyOf: [{ type: ["superball", "plastic-cup"], rests: "same" }, { unchanged: true, reply: CANT }] } } },
	{ id: "s-dominoes-steel", base: STARTER, cat: "material", text: "make the dominoes out of steel", t: { dominoes: { anyOf: [{ unchanged: true, reply: R("steel") }] } }, note: "domino-row has no steel material: say so" },
	{ id: "s-box-blue", base: STARTER, cat: "material", text: "paint the box blue", t: { box: { anyOf: [{ unchanged: true, reply: CANT }] } }, note: "no colour props: say so" },
	// ---------------------------------------------------------------- starter: move relative
	{ id: "s-box-left10", base: STARTER, cat: "move", text: "move the box 10 cm to the left", t: { box: { dx: [-0.11, -0.09], dy: [-0.005, 0.005] } } },
	{ id: "s-seesaw-right3", base: STARTER, cat: "move", text: "move the seesaw 3 cm to the right", t: { seesaw: { dx: [0.025, 0.035] } }, allow: ["ball2"], note: "5 cm would push Ball 2 into the right safety wall" },
	{ id: "s-red-higher", base: STARTER, cat: "move", text: "raise the red ball a bit higher", t: { ball1: { dy: [0.04, 0.3], dx: [-0.01, 0.01], held: true } } },
	{ id: "s-dominoes-closer", base: STARTER, cat: "move", text: "move the dominoes closer to the seesaw", t: { dominoes: { dx: [0.01, 0.076] } } },
	{ id: "s-box-lower5", base: STARTER, cat: "move", text: "lower the box by 5 cm", t: { box: { dy: [-0.06, -0.04], dx: [-0.005, 0.005] } } },
	{ id: "s-ramp1-up10", base: STARTER, cat: "move", text: "move ramp 1 up 10 cm", t: { ramp1: { dy: [0.09, 0.11], dx: [-0.005, 0.005] } }, allow: ["ball1"] },
	// ---------------------------------------------------------------- starter: add N
	{ id: "s-add3-dominoes", base: STARTER, cat: "add", text: "add 3 more dominoes", t: { dominoes: { props: { count: { eq: 10 } } } }, allow: ["seesaw", "ball2", "box"] },
	{ id: "s-add2-tennis", base: STARTER, cat: "add", text: "add two tennis balls on the table near the left wall", added: [{ type: "tennis-ball", count: 2, restsOn: "table", x: [-0.55, 0.6] }] },
	{ id: "s-add-cup-under", base: STARTER, cat: "add", text: "put a cup on the table under ramp 1", added: [{ type: ["cup", "plastic-cup"], count: 1, restsOn: "table", x: [-0.13, 0.49] }] },
	{ id: "s-add-box2", base: STARTER, cat: "add", text: "add a second box like the first one, on the table near the left wall", added: [{ type: "box", count: 1, restsOn: "table", x: [-0.55, 0.7] }] },
	// ---------------------------------------------------------------- starter: remove
	{ id: "s-rm-seesaw", base: STARTER, cat: "remove", text: "remove the seesaw", t: { seesaw: { removed: true } }, allow: ["ball2"] },
	{ id: "s-rm-ramp1", base: STARTER, cat: "remove", text: "take away ramp 1", t: { ramp1: { removed: true } } },
	{ id: "s-rm-dominoes", base: STARTER, cat: "remove", text: "get rid of the dominoes", t: { dominoes: { removed: true } } },
	{ id: "s-rm-yellow", base: STARTER, cat: "remove", text: "delete the yellow ball", t: { ball2: { removed: true } } },
	// ---------------------------------------------------------------- starter: duplicate
	{ id: "s-dup-red", base: STARTER, cat: "duplicate", text: "duplicate the red ball", added: [{ type: "superball", count: 1, near: ["ball1", 0.45] }] },
	{ id: "s-dup-box-left", base: STARTER, cat: "duplicate", text: "copy the box and put the copy on the table near the left wall", added: [{ type: "box", count: 1, restsOn: "table", x: [-0.55, 0.7] }] },
	// ---------------------------------------------------------------- starter: rotate
	{ id: "s-ramp2-steeper", base: STARTER, cat: "rotate", text: "make ramp 2 steeper", t: { ramp2: { da: [-25, -2] } } },
	{ id: "s-ramp1-tilt5", base: STARTER, cat: "rotate", text: "tilt ramp 1 down 5 more degrees", t: { ramp1: { da: [-6, -4] } }, allow: ["ball1"] },
	{ id: "s-ramp1-flat", base: STARTER, cat: "rotate", text: "make ramp 1 flat", t: { ramp1: { a: [-0.6, 0.6] } }, allow: ["ball1"] },
	// ---------------------------------------------------------------- starter: retime / release
	{ id: "s-release-2s", base: STARTER, cat: "retime", text: "release the ball at 2 seconds", scene: { release: [1.95, 2.05] } },
	{ id: "s-seconds-8", base: STARTER, cat: "retime", text: "make the scene 8 seconds long", scene: { seconds: [7.9, 8.1] } },
	{ id: "s-red-now", base: STARTER, cat: "retime", text: "let the red ball go right away", anyOf: [{ scene: { release: [0, 0.05] } }, { t: { ball1: { held: false } } }] },
	{ id: "s-hold-1-5", base: STARTER, cat: "retime", text: "hold the red ball for 1.5 seconds before it drops", scene: { release: [1.45, 1.55] } },
	{ id: "s-seconds-3", base: STARTER, cat: "retime", text: "shorten the scene to 3 seconds", scene: { seconds: [2.9, 3.1] } },
	// ---------------------------------------------------------------- starter: make it work again (broken variants)
	{ id: "s-fix-box-moved", base: { from: STARTER, mutate: "box-up-30" }, cat: "fix", text: "make it work again", allowAny: true, maxChanged: 4, works: "fix" },
	{ id: "s-fix-tennis", base: { from: STARTER, mutate: "ball2-tennis" }, cat: "fix", text: "the ball doesn't land in the box anymore, fix it", allowAny: true, maxChanged: 4, works: "fix", t: { ball2: { type: "tennis-ball" } }, history: [{ role: "user", text: "replace the yellow ball with a tennis ball" }, { role: "assistant", text: "Swapped the yellow ball for a tennis ball on the seesaw." }] },
	{ id: "s-fix-user-swap", base: { from: STARTER, mutate: "user-swap" }, cat: "fix", text: "make it work again", allowAny: true, maxChanged: 4, works: "fix", t: { ball1: { type: "basketball" }, ball2: { type: "tennis-ball" } }, history: [{ role: "user", text: "replace the yellow ball with a tennis ball and the red ball with a basketball" }, { role: "assistant", text: "Swapped the yellow ball for a tennis ball on the seesaw and the red ball for a basketball held at the top of Ramp 1." }], note: "the user's real request, then the natural follow-up: keep both new balls" },
	{ id: "s-fix-box-right", base: { from: STARTER, mutate: "box-right-12" }, cat: "fix", text: "it stopped working, can you make it work again?", allowAny: true, maxChanged: 4, works: "fix" },
	// ---------------------------------------------------------------- starter: ambiguous references
	{ id: "s-amb-ball-bigger", base: STARTER, cat: "ambiguous", text: "make the ball bigger", noChange: true, ask: { candidates: [red, yellow].map((w) => w.join("|")), min: 2 } },
	{ id: "s-amb-ramp-left", base: STARTER, cat: "ambiguous", text: "move the ramp to the left", noChange: true, ask: { candidates: ["ramp 1|first ramp|top ramp|upper ramp|short", "ramp 2|second ramp|bottom ramp|lower ramp|long"], min: 2 } },
	{ id: "s-res-seesaw-ball", base: STARTER, cat: "resolve", text: "make the ball on the seesaw heavier", t: { ball2: { anyOf: [{ props: { mass: { ratio: [1.2, 1e6] } } }, { type: ["tennis-ball", "golf-ball", "baseball", "steel-ball", "wooden-ball", "clay-ball", "superball", "billiard-ball", "glass-marble", "bowling-ball", "soccer-ball", "basketball"] }] } } },
	{ id: "s-res-top-ramp", base: STARTER, cat: "resolve", text: "make the top ramp longer", t: { ramp1: { props: { length: { ratio: [1.05, 2.5] } } } }, allow: ["ball1"] },
	{ id: "s-res-history-it", base: STARTER, cat: "resolve", text: "make it a tennis ball", history: [{ role: "user", text: "what's the yellow ball for?" }, { role: "assistant", text: "The yellow ball sits on the right end of the seesaw: when the dominoes tip the seesaw, it is flung up and lands in the box." }], t: { ball2: { type: "tennis-ball", rests: "same" } } },
	{ id: "s-res-left-thing", base: STARTER, cat: "resolve", text: "move the thing the red ball rolls down first 5 cm to the right", t: { ramp1: { dx: [0.04, 0.06] } }, allow: ["ball1"] },
	// ---------------------------------------------------------------- starter: questions (must change nothing)
	{ id: "s-q-why-lands", base: STARTER, cat: "question", text: "why does ball 2 land in the box?", noChange: true },
	{ id: "s-q-mass-red", base: STARTER, cat: "question", text: "how heavy is the red ball?", noChange: true, answer: R("(10[0-9](\\.\\d)?\\s?(g|grams)|0\\.1\\d*\\s?kg|100 ?g)") },
	{ id: "s-q-what-if", base: STARTER, cat: "question", text: "what would happen if I made the red ball a bowling ball?", noChange: true },
	{ id: "s-q-heavier", base: STARTER, cat: "question", text: "which ball is heavier?", noChange: true, answer: R("(red|ball 1|superball)") },
	{ id: "s-q-why-miss", base: { from: STARTER, mutate: "box-up-30" }, cat: "question", text: "why does the ball miss the box?", noChange: true },
	{ id: "s-q-first", base: STARTER, cat: "question", text: "what happens first when it starts?", noChange: true },

	// ---------------------------------------------------------------- built-in: car, ramp and dominoes
	{ id: "c-swap-skateboard", base: "car-ramp-dominoes", cat: "swap", text: "replace the toy car with a skateboard", t: { car: { type: "skateboard", rests: "same", dx: [-0.05, 0.35] } }, note: "an 80 cm skateboard centred where the 20 cm car was would hang off the ramp's top end: it must slide down the ramp to fit" },
	{ id: "c-ramp-steeper", base: "car-ramp-dominoes", cat: "rotate", text: "make the ramp steeper", t: { ramp: { da: [-20, -2] } }, allow: ["car"] },
	{ id: "c-add5-dominoes", base: "car-ramp-dominoes", cat: "add", text: "add 5 more dominoes", t: { dominoes: { props: { count: { eq: 12 } } } } },
	{ id: "c-q-faster", base: "car-ramp-dominoes", cat: "question", text: "why doesn't the car go faster?", noChange: true },
	{ id: "c-dominoes-closer20", base: "car-ramp-dominoes", cat: "move", text: "move the dominoes 20 cm closer to the ramp", t: { dominoes: { dx: [-0.22, -0.18] } } },
	// ---------------------------------------------------------------- built-in: trampoline
	{ id: "t-swap-soccer", base: "trampoline", cat: "swap", text: "swap the basketball for a soccer ball", t: { basketball: { type: "soccer-ball", held: true, dx: [-0.05, 0.05], dy: [-0.05, 0.05] } } },
	{ id: "t-amb-higher", base: "trampoline", cat: "ambiguous", text: "drop the ball from higher up", noChange: true, ask: { candidates: ["basketball", "tennis", "superball|red|rubber"], min: 2 } },
	{ id: "t-rm-superball", base: "trampoline", cat: "remove", text: "remove the superball", t: { superball: { removed: true } } },
	{ id: "t-stiffer", base: "trampoline", cat: "resize", text: "make the trampoline twice as stiff", t: { trampoline: { props: { stiffness: { ratio: [1.9, 2.1] } } } } },
	{ id: "t-add-tennis-right", base: "trampoline", cat: "add", text: "add another tennis ball above the right end of the trampoline", added: [{ type: "tennis-ball", count: 1, x: [1.55, 2.05] }] },
	// ---------------------------------------------------------------- built-in: wrecking ball
	{ id: "w-bricks-blocks", base: "wrecking-ball", cat: "swap", text: "replace the bricks with wooden blocks", counts: { brick: 0, "wooden-block": 5 }, allowAny: true, maxChanged: 5, keep: ["crane"] },
	{ id: "w-heavier", base: "wrecking-ball", cat: "resize", text: "make the wrecking ball heavier", t: { crane: { props: { bob_mass: { ratio: [1.2, 4] } } } } },
	{ id: "w-add-brick-top", base: "wrecking-ball", cat: "add", text: "add one more brick on top of the stack", added: [{ type: "brick", count: 1, restsOn: "brick5" }] },
	{ id: "w-pull-back", base: "wrecking-ball", cat: "rotate", text: "pull the wrecking ball back further before it swings", t: { crane: { props: { start_angle: { delta: [-25, -3] } } } } },
	{ id: "w-q-lighter", base: "wrecking-ball", cat: "question", text: "what would happen if the bricks were lighter?", noChange: true },
	// ---------------------------------------------------------------- built-in: plinko
	{ id: "p-drop-left", base: "plinko", cat: "move", text: "drop the ball over the left side of the board", t: { ball: { x: [0.98, 1.2], dy: [-0.03, 0.03], held: true } } },
	{ id: "p-middle-cup-bigger", base: "plinko", cat: "resize", text: "make the cup in the middle wider", t: { cup5: { props: { width: { ratio: [1.1, 2.2] } } } }, allow: ["cup1", "cup2", "cup3", "cup4", "cup6", "cup7", "cup8", "cup9"], note: "the cups stand 6 mm apart: a wider middle cup pushes the others outward" },
	{ id: "p-rm-right-cup", base: "plinko", cat: "remove", text: "remove the cup on the far right", t: { cup9: { removed: true } } },
	{ id: "p-amb-cup", base: "plinko", cat: "ambiguous", text: "make the cup taller", noChange: true, ask: { candidates: ["cup|which", "middle|left|right|cup \\d|first|last|all"], min: 2 } },
	{ id: "p-swap-pingpong", base: "plinko", cat: "swap", text: "use a ping-pong ball instead of the golf ball", t: { ball: { type: "ping-pong-ball", held: true, dx: [-0.03, 0.03], dy: [-0.03, 0.03] } } },
	// ---------------------------------------------------------------- built-in: spring launcher
	{ id: "l-cup-further", base: "spring-launch", cat: "move", text: "move the cup 20 cm further away", t: { cup: { dx: [0.18, 0.22] } } },
	{ id: "l-compress", base: "spring-launch", cat: "resize", text: "compress the spring more", t: { launcher: { props: { compression: { ratio: [1.1, 9] } } } }, allow: ["ball"] },
	{ id: "l-swap-pingpong", base: "spring-launch", cat: "swap", text: "swap the golf ball for a ping-pong ball", t: { ball: { type: "ping-pong-ball", rests: "same" } } },
	{ id: "l-q-smaller-cup", base: "spring-launch", cat: "question", text: "will the ball still land in the cup if I make the cup smaller?", noChange: true },

	// ---------------------------------------------------------------- AI-built: c1 Rube cup (pendulum -> dominoes -> golf ball on a ledge -> funnel -> cup)
	{ id: "a-c1-marble", base: "ai-c1-rube-cup", cat: "swap", text: "swap the golf ball for a marble", t: { ball: { type: "glass-marble", rests: "same", dx: [-0.03, 0.03] } } },
	{ id: "a-c1-higher-swing", base: "ai-c1-rube-cup", cat: "rotate", text: "make the pendulum start from higher up", t: { pendulum: { props: { start_angle: { delta: [-45, -5] } } } } },
	{ id: "a-c1-cup-right10", base: "ai-c1-rube-cup", cat: "move", text: "move the cup 10 cm to the right", t: { cup: { dx: [0.09, 0.11] } } },
	{ id: "a-c1-rm-funnel", base: "ai-c1-rube-cup", cat: "remove", text: "remove the funnel", t: { funnel: { removed: true } }, allow: ["funnel-stand-left", "funnel-stand-right"] },
	// ---------------------------------------------------------------- AI-built: m2 seesaw catapult (weight drops on a seesaw, ping-pong ball into a basket)
	{ id: "a-m2-tennis", base: "ai-m2-seesaw-catapult", cat: "swap", text: "use a tennis ball instead of the ping-pong ball", t: { ball: { type: "tennis-ball", rests: "same" } } },
	{ id: "a-m2-weight-higher", base: "ai-m2-seesaw-catapult", cat: "move", text: "drop the weight from 20 cm higher", t: { weight: { dy: [0.18, 0.22], dx: [-0.005, 0.005] } } },
	{ id: "a-m2-basket-bigger", base: "ai-m2-seesaw-catapult", cat: "resize", text: "make the basket bigger", t: { basket: { props: { width: { ratio: [1.1, 2.5] } } } } },
	// ---------------------------------------------------------------- AI-built: m4 conveyor oranges
	{ id: "a-m4-add-orange", base: "ai-m4-conveyor-oranges", cat: "add", text: "add one more orange on the belt", added: [{ type: "orange", count: 1, restsOn: "belt" }] },
	{ id: "a-m4-faster", base: "ai-m4-conveyor-oranges", cat: "resize", text: "make the belt faster", t: { belt: { props: { speed: { ratio: [1.1, 3.4] } } } } },
	{ id: "a-m4-apples", base: "ai-m4-conveyor-oranges", cat: "swap", text: "replace the oranges with apples", counts: { orange: 0, apple: 3 }, allowAny: true, maxChanged: 3, keep: ["belt", "basket"] },
	{ id: "a-m4-q-speed", base: "ai-m4-conveyor-oranges", cat: "question", text: "how fast is the belt going?", noChange: true, answer: R("1\\.5") },
	// ---------------------------------------------------------------- AI-built: z2 three balls on an ice ramp
	{ id: "a-z2-amb-bigger", base: "ai-z2-materials-ice-ramp", cat: "ambiguous", text: "make the ball bigger", noChange: true, ask: { candidates: ["marble|glass", "wood", "rubber|superball|red"], min: 2 } },
	{ id: "a-z2-wood-bigger", base: "ai-z2-materials-ice-ramp", cat: "resize", text: "make the wooden ball bigger", t: { "wood-ball": { props: { diameter: { ratio: [1.2, 2.6] } }, dx: [-0.1, 0.1] } } },
	{ id: "a-z2-less-steep", base: "ai-z2-materials-ice-ramp", cat: "rotate", text: "make the ramp less steep", t: { ramp: { da: [2, 18] } }, allow: ["marble", "wood-ball", "rubber-ball"] },
	// ---------------------------------------------------------------- AI-built: k2 tower and wrecking ball
	{ id: "a-k2-add2", base: "ai-k2-tower-wrecking", cat: "add", text: "add two more blocks to the top of the tower", added: [{ type: "wooden-block", count: 2 }], stackOn: "b6" },
	{ id: "a-k2-tower-left", base: "ai-k2-tower-wrecking", cat: "move", text: "move the tower 10 cm to the left", t: Object.fromEntries(["b1", "b2", "b3", "b4", "b5", "b6"].map((b) => [b, { dx: [-0.11, -0.09] }])) },
	{ id: "a-k2-heavier", base: "ai-k2-tower-wrecking", cat: "material", text: "make the blocks heavier", t: Object.fromEntries(["b1", "b2", "b3", "b4", "b5", "b6"].map((b) => [b, { anyOf: [{ props: { mass: { ratio: [1.15, 1e6] } } }, { props: { material: { changed: true } } }, { props: { depth: { ratio: [1.15, 30] } } }, { type: ["brick", "steel-weight-1kg", "steel-weight-5kg"] }] }])) },
	{ id: "a-k2-q-blocks", base: "ai-k2-tower-wrecking", cat: "question", text: "how many blocks are in the tower?", noChange: true, answer: R("(6|six)") },

	// ---------------------------------------------------------------- more starter cases (the user's own scene gets the most)
	{ id: "s-swap-both-history", base: STARTER, cat: "swap", text: "now do the same for the other ball: make it a golf ball", history: [{ role: "user", text: "make the red ball a tennis ball" }, { role: "assistant", text: "Swapped the red ball (Ball 1) for a tennis ball at the top of ramp 1." }], t: { ball2: { type: "golf-ball", rests: "same" } } },
	{ id: "s-swap-box-cup", base: STARTER, cat: "swap", text: "swap the box for a cup", t: { box: { type: ["cup", "plastic-cup"], dx: [-0.15, 0.15], dy: [-0.2, 0.2] } }, added: [{ type: ["wooden-block", "brick", "hardcover-book", "paperback-book", "plank", "cardboard-box"], count: [0, 2] }], note: "a cup cannot hang on cords: a post under it is allowed" },
	{ id: "s-resize-red-small", base: STARTER, cat: "resize", text: "make the red ball half the size", t: { ball1: { props: { diameter: { ratio: [0.45, 0.55] } }, held: true, dx: [-0.05, 0.05] } } },
	{ id: "s-move-red-closer", base: STARTER, cat: "move", text: "move the red ball 3 cm to the right", t: { ball1: { dx: [0.025, 0.035], dy: [-0.005, 0.03], held: true } } },
	{ id: "s-rm-both-balls", base: STARTER, cat: "remove", text: "remove both balls", t: { ball1: { removed: true }, ball2: { removed: true } } },
	{ id: "s-dup-seesaw", base: STARTER, cat: "duplicate", text: "duplicate the seesaw and put the copy on the table near the left wall", added: [{ type: "seesaw", count: 1, restsOn: "table", x: [-0.55, 0.8] }] },
	{ id: "s-ramp2-less-steep", base: STARTER, cat: "rotate", text: "make ramp 2 a little less steep", t: { ramp2: { da: [1, 10] } } },
	{ id: "s-release-later", base: STARTER, cat: "retime", text: "wait one more second before releasing the ball", scene: { release: [1.45, 1.55] } }
]

/** Broken variants of a base scene, for "make it work again". */
export const MUTATIONS = {
	// (each breaks "Ball 2 lands in the box" without any overlap at the start; checked on the engine)
	"box-up-30": (s) => {
		const b = s.items.find((i) => i.id === "box")
		b.y = Math.round((b.y + 0.3) * 1e5) / 1e5
	},
	"box-right-12": (s) => {
		const b = s.items.find((i) => i.id === "box")
		b.x = Math.round((b.x + 0.12) * 1e5) / 1e5
	},
	// the user's real request (yellow -> tennis ball, red -> basketball), applied as the new edit path applies it: each re-seated
	"user-swap": (s) => {
		const b1 = s.items.find((i) => i.id === "ball1")
		b1.type = "basketball"
		b1.name = "Basketball"
		b1.y = Math.round((0.719 + 0.1199) * 1e5) / 1e5 // (its lowest point where the superball's was: 0.719 m)
		const b2 = s.items.find((i) => i.id === "ball2")
		b2.type = "tennis-ball"
		b2.name = "Tennis ball"
		b2.y = Math.round((b2.y + 0.0035) * 1e5) / 1e5
	},
	"ball2-tennis": (s) => {
		const b = s.items.find((i) => i.id === "ball2")
		b.type = "tennis-ball"
		b.name = "Tennis ball"
		b.y = Math.round((b.y + 0.0035) * 1e5) / 1e5 // (re-seated on the seesaw's end: the tennis ball is 3.5 mm larger in radius)
	}
}
