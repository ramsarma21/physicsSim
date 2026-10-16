// The review's adversarial edit requests (2026-10-15 night, the n7 integration review): 59 requests on the starter, four built-in scenes and
// three AI-built ones (base "ai:<case>" = ai/bench/results/ab4/pipeline-new/app/<case>.json: its scene and the plan that made it).
// {id, base, text, history?, pre? (patches applied first, as the user's previous change), expect (what a right answer does)}
// Run by ai/bench/tools/edit-review.mjs (ai/DESIGN.md §14.4, ai/research/benchmark.md §15).
const U = (text) => ({ role: "user", text })
const A = (text) => ({ role: "assistant", text })
export const CASES = [
	// ---- starter (rube-goldberg, hand-made: no plan)
	{ id: "s1-swap-red-golf", base: "rube-goldberg", text: "swap the red ball for a golf ball", expect: "change: ball1 replace_type golf-ball (+name ok); nothing else" },
	{ id: "s2-box-wider-10cm", base: "rube-goldberg", text: "make the box 10 cm wider", expect: "change: box width 0.26→0.36 exactly; nothing else" },
	{ id: "s3-raise-ramp1-5cm", base: "rube-goldberg", text: "raise the first ramp by 5 cm", expect: "change: ramp1 dy +0.05 exactly; ball1 follows; nothing else" },
	{ id: "s4-ball-bigger-ambig", base: "rube-goldberg", text: "make the ball bigger", expect: "ask: red vs yellow; chips = readings; no patches" },
	{ id: "s5-why-question", base: "rube-goldberg", text: "why does the yellow ball end up in the box?", expect: "answer, no patches, from the run" },
	{ id: "s6-history-red-one", base: "rube-goldberg", history: [U("make the ball bigger"), A("Which ball: the red one at the top of the first ramp, or the yellow one on the seesaw?")], text: "the red one", expect: "change: ball1 diameter 0.06→0.09 (1.5x); nothing else" },
	{ id: "s7-dominoes-blue", base: "rube-goldberg", text: "make the dominoes blue", expect: "no paint: no change (or a kind with that look), reply says so plainly" },
	{ id: "s8-undo", base: "rube-goldberg", pre: [{ op: "set_props", id: "box", props: { width: 0.36 } }], history: [U("make the box 10 cm wider"), A("I made the box wider (26 cm → 36 cm).")], text: "undo that", expect: "undo: undo true, patches []" },
	{ id: "s9-start-over", base: "rube-goldberg", text: "start over: just a tennis ball rolling down a ramp into a cup", expect: "§14.2: kind new / mode new (drawer offers Build it as a new scene); or (PRESSED_EDIT) a patch that rebuilds" },
	{ id: "s10-seesaw-left", base: "rube-goldberg", text: "move the seesaw 10 cm to the left", expect: "change: seesaw dx -0.1; ball2 follows; box stays" },
	{ id: "s11-yellow-twice-heavy", base: "rube-goldberg", text: "make the yellow ball twice as heavy", expect: "change: ball2 mass 6.32 g → 12.64 g exactly" },
	{ id: "s12-spanish", base: "rube-goldberg", text: "haz la pelota roja un poco más grande", expect: "change: ball1 diameter a bit larger; reply in Spanish" },
	// ---- built-in: ball-drop
	{ id: "b1-bowling-50cm", base: "ball-drop", text: "drop the bowling ball from 50 cm instead", expect: "change: bowling dy so bottom is 0.5 m (dy -0.5); nothing else" },
	{ id: "b2-green-steel", base: "ball-drop", text: "swap the green ball for a steel ball", expect: "change: clay → steel-ball, rename; nothing else" },
	{ id: "b3-all-1p5m", base: "ball-drop", text: "raise all the balls to 1.5 m", expect: "change: all 6 balls dy +0.5; nothing else" },
	{ id: "b4-which-first", base: "ball-drop", text: "which ball hits the table first?", expect: "answer from the run (all ≈0.95 s; ping-pong last 0.97 s); no patches" },
	{ id: "b5-purple-missing", base: "ball-drop", text: "make the purple ball heavier", expect: "ask: no purple ball; names likely ones; no patches" },
	// ---- built-in: conveyor-delivery
	{ id: "c1-belt-50pct", base: "conveyor-delivery", text: "make the belt run 50% faster", expect: "change: belt speed 1 → 1.5; nothing else" },
	{ id: "c2-box-right-20", base: "conveyor-delivery", text: "move the box 20 cm to the right", expect: "change: box dx +0.2; belt and balls stay" },
	{ id: "c3-add-ball", base: "conveyor-delivery", text: "add another golf ball at the start of the belt", expect: "change: add golf-ball on belt at its left end with a gap; nothing else" },
	// ---- built-in: pendulum-dominoes
	{ id: "p1-pull-back", base: "pendulum-dominoes", text: "pull the pendulum back further before it swings", expect: "change: pendulum start_angle larger; nothing else" },
	{ id: "p2-double-dominoes", base: "pendulum-dominoes", text: "double the number of dominoes", expect: "change: count 7 → 14; nothing else" },
	{ id: "p3-hypothetical", base: "pendulum-dominoes", text: "what would happen if the pendulum bob were 10 times heavier?", expect: "answer; no patches" },
	// ---- built-in: wrecking-ball
	{ id: "w1-bricks-to-blocks", base: "wrecking-ball", text: "replace the bricks with wooden blocks", expect: "change: 5 replace_type brick→wooden-block; stack re-seated; crane stays" },
	{ id: "w2-remove-top", base: "wrecking-ball", text: "take the top brick off", expect: "change: remove brick5 only" },
	{ id: "w3-crane-left", base: "wrecking-ball", text: "move the wrecking ball 10 cm to the left", expect: "change: crane dx -0.1 only" },
	// ---- AI-built: photo-board-bucket-34 (plan)
	{ id: "x1-white-ball", base: "ai:photo-board-bucket-34", text: "remove the white ball", expect: "ask: the cue ball and the golf ball are both white; no patches" },
	{ id: "x2-bucket-bit-right", base: "ai:photo-board-bucket-34", text: "nudge the bucket a bit to the right", expect: "change: bucket dx +0.03..0.05; nothing else" },
	{ id: "x3-ramp-steeper", base: "ai:photo-board-bucket-34", text: "make the ramp steeper", expect: "change: board angle 5-10° steeper; balls follow; nothing else" },
	{ id: "x4-make-it-work-already", base: "ai:photo-board-bucket-34", text: "make it work", expect: "already works: no change, says both balls already land in the bucket" },
	{ id: "x5-fix-after-move", base: "ai:photo-board-bucket-34", pre: [{ op: "move", id: "bucket", dx: 0.3 }], history: [U("move the bucket 30 cm to the right"), A("I moved the bucket 30 cm to the right. Heads-up, in the new run: The cue ball lands in the bucket, The golf ball lands in the bucket. Say “make it work again” and I’ll adjust the machine around your change.")], text: "make it work again", expect: "fix: keep the bucket where the user put it; change the board/height etc.; few patches" },
	// ---- AI-built: photo-rube-chain (plan)
	{ id: "r1-car-to-truck", base: "ai:photo-rube-chain", text: "replace the red car with a truck", expect: "change: car replace_type truck; rename; neighbour moved least if needed" },
	{ id: "r2-steel-to-marble", base: "ai:photo-rube-chain", text: "make the steel ball a marble", expect: "change: ball replace_type glass-marble; rename" },
	{ id: "r3-two-more-dominoes", base: "ai:photo-rube-chain", text: "add two more dominoes", expect: "change: count 5 → 7; car moved least only if needed" },
	// ---- AI-built: gt-book-ramp-ball (plan)
	{ id: "g1-remove-blue-book", base: "ai:gt-book-ramp-ball", text: "remove the blue book", expect: "change: remove book3 only" },
	{ id: "g2-cup-further", base: "ai:gt-book-ramp-ball", text: "put the cup 10 cm further away", expect: "change: cup dx +0.1 exactly; nothing else" },
	{ id: "g3-false-premise", base: "ai:gt-book-ramp-ball", text: "why didn't the ball go in the cup?", expect: "answer: it does land in the cup (goal MET); no patches" },
	// ---- round 2 of the review
	{ id: "t01-ramp-longer-ambig", base: "rube-goldberg", text: "make the ramp longer", expect: "ask: two ramps" },
	{ id: "t02-first-ramp-longer", base: "rube-goldberg", text: "make the first ramp 20 cm longer", expect: "change: ramp1 length 0.62 → 0.82; ball1 follows if needed" },
	{ id: "t03-white-ball-bigger", base: "ball-drop", text: "make the white ball twice as big", expect: "change: ping-pong diameter 4 → 8 cm (the only white ball); lowest point kept" },
	{ id: "t04-brick-heavier-ambig", base: "wrecking-ball", text: "make the brick heavier", expect: "ask: 5 bricks, singular" },
	{ id: "t05-remove-golf-ambig", base: "conveyor-delivery", text: "remove the golf ball", expect: "ask: 3 golf balls" },
	{ id: "t06-bucket-closer", base: "ai:photo-board-bucket-34", text: "move the bucket closer to the ramp", expect: "change: bucket dx negative, keep a real gap (ramp low end at x 0.957, bucket left rim 1.015 → ≤ ~4 cm)" },
	{ id: "t07-add-two-bricks", base: "wrecking-ball", text: "add 2 more bricks on top of the stack", expect: "change: add brick6 on brick5, brick7 on brick6" },
	{ id: "t08-seesaw-steel", base: "rube-goldberg", text: "make the seesaw out of steel", expect: "change: seesaw material steel only" },
	{ id: "t09-yellow-glass", base: "rube-goldberg", text: "make the yellow ball out of glass", expect: "no glass for plastic-ball: say so plainly (or swap to glass-marble and say so); nothing else" },
	{ id: "t10-heavier-question", base: "rube-goldberg", text: "is the red ball heavier than the yellow one?", expect: "answer: yes 102 g vs 6.3 g; no patches" },
	{ id: "t11-it-pronoun", base: "rube-goldberg", pre: [{ op: "replace_type", id: "ball2", type: "tennis-ball" }, { op: "set_item", id: "ball2", name: "Tennis ball" }], history: [U("make the yellow ball a tennis ball"), A("I swapped the yellow ball for a tennis ball on the seesaw.")], text: "make it a bit heavier", expect: "change: ball2 (tennis) mass up a bit; nothing else" },
	{ id: "t12-swap-two-balls", base: "rube-goldberg", text: "swap the red ball and the yellow ball", expect: "change: exchange them (replace_type each, or exchange places); held/seats kept; nothing else" },
	{ id: "t13-box-twice-big", base: "rube-goldberg", text: "make the box twice as big", expect: "change: box width ×2 (and depth/wall ×2); overlap handled or said" },
	{ id: "t14-ball-in-box", base: "rube-goldberg", text: "put a golf ball in the box", expect: "change: add golf-ball inside box" },
	{ id: "t15-inches", base: "ai:gt-book-ramp-ball", text: "move the cup 4 inches to the left", expect: "change: cup dx -0.1016 exactly" },
	{ id: "t16-ramp-20pct-shorter", base: "ai:gt-book-ramp-ball", text: "make the ramp 20% shorter", expect: "change: ramp length 0.80 → 0.64 m (and it actually happens)" },
	{ id: "t17-release-now", base: "rube-goldberg", text: "let the ball go right away", expect: "change: release 0 (only one held ball: ball1)" },
	{ id: "t18-run-longer", base: "rube-goldberg", text: "make the run 2 seconds longer", expect: "change: seconds 4.5 → 6.5 only" },
	{ id: "t19-last-golf", base: "conveyor-delivery", text: "make the last golf ball a tennis ball", expect: "change or ask: 'last' is ball1 (back of the line) or ball3 (front); a reason given" },
	{ id: "t20-fix-dominoes", base: "pendulum-dominoes", pre: [{ op: "move", id: "dominoes", dx: 0.3 }], history: [U("move the dominoes 30 cm to the right"), A("I moved the dominoes 30 cm to the right.")], text: "now make the pendulum hit them again", expect: "fix: move the pendulum (not the dominoes back) the fewest changes" },
	{ id: "t21-red-car-heavier", base: "ai:photo-rube-chain", text: "make the red car heavier", expect: "change: car body_mass up (1.5×?); nothing else" },
	{ id: "t22-cue-to-8ball", base: "ai:photo-board-bucket-34", text: "make the cue ball the 8 ball", expect: "change: cue number 0 → 8 (black); name; nothing else" }
]
