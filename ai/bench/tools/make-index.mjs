// Writes ai/bench/images/index.json: every image case of the bench.
//  - photo-* / sketch-*: generated through the gateway (tools/gen-images.mjs, prompts in tools/image-prompts.mjs); one picked by eye out of
//    three candidates (gpt-image-2, gpt-image-2.5-sunburst, gemini-3-pro-image-preview) per prompt. The description says what the image
//    really shows (counts checked by eye), which is not always what the prompt asked for (e.g. the cradle has six balls, the rube-chain
//    photo five dominoes). Expectations use the text-case format (score.mjs scoreCase).
//  - gt-*: the app's own renders of a known scene (tools/render-gt.cjs); scored against the scene with score.mjs scoreAgainstGT, and with
//    the derived must_types / counts by scoreCase. `core: true` marks the 12 the quick benchmark uses.
//   node ai/bench/tools/make-index.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH = path.resolve(HERE, "..")
const { loadBench, geometry, familyOf } = await import(pathToFileURL(path.join(BENCH, "score.mjs")).href)
const { PROMPTS } = await import(pathToFileURL(path.join(HERE, "image-prompts.mjs")).href)
const bench = loadBench()
const promptOf = (id) => PROMPTS.find((p) => p.id === id)?.prompt ?? null

const SIDE_VIEW = { camera: "side view at table height; image x = the motion plane's x (left to right)" }
const GENERATED = [
	{
		id: "photo-ramp-dominoes", kind: "photo", model: "openai-group/gpt-image-2.5-sunburst", size: [1536, 1024], ...SIDE_VIEW,
		description: "Kitchen table, side view. At the left a stack of three hardcover books lying flat (red on top, green, navy at the bottom). A plain wooden plank rests on the top book at its left end and slopes down to the right onto the tabletop. A red ball (about 7 cm) sits on the plank's high left end. Five plain wooden dominoes (no pips) stand upright in an evenly spaced row on the table, starting just right of the plank's low end. Background (counter, plant, utensil jar, cutting board, bowl of lemons) is scenery, not part of the setup.",
		expect: {
			must_types: ["@book", "@ramp", "@ball", "@domino"],
			counts: [{ of: "@book", eq: 3 }, { of: "@domino", eq: 5 }, { of: "@ball", eq: 1 }],
			relations: [
				{ rel: "stack", a: "@book", min: 3 },
				{ rel: "over", a: "@ball", b: "@ramp" },
				{ rel: "angled", a: "@ramp", sign: "down_right", min_deg: 4, max_deg: 30 },
				{ rel: "on", a: "@ramp", b: "@book", soft: true },
				{ rel: "order_x", specs: ["@book", "@domino"] },
				{ rel: "right_of", a: "@domino", b: "@ramp", all: true },
			],
			outcomes: [{ kind: "hits", a: "@ball", b: "@domino", soft: true }, { kind: "topples", of: "@domino", min_fraction: 0.8, soft: true }],
			items: { max: 12 },
			rubric: "Rebuild the setup, not the kitchen: three books, a plank ramp from the top book down to the right, the ball at its top, five dominoes after its foot. The ball should roll down and topple the dominoes.",
		},
	},
	{
		id: "photo-pendulum-dominoes", kind: "photo", model: "openai-group/gpt-image-2.5-sunburst", size: [1536, 1024], ...SIDE_VIEW,
		description: "Light wooden table, side view. At the left a wooden gallows stand (flat base, upright post, an arm reaching left from its top); a polished steel ball on a thin dark string hangs from the arm's left end, pulled back to the left by about 40°. Right of the stand's base: seven plain wooden dominoes standing in a row, each taller than the one before (shortest at the left). As drawn, the ball's lowest point is left of the stand's post, so the swing could not reach the dominoes without moving the pendulum closer.",
		expect: {
			must_types: ["@pendulum", "@domino"],
			counts: [{ of: "@domino", eq: 7 }],
			relations: [{ rel: "left_of", a: "@pendulum", b: "@domino" }, { rel: "on_table", a: "@domino" }],
			outcomes: [{ kind: "hits", a: "@pendulum", b: "@domino", soft: true }, { kind: "topples", of: "@domino", min_fraction: 0.8, soft: true }],
			items: { max: 10 },
			rubric: "A pendulum (steel bob on a string or rod) pulled back to the left, and a growing row of seven dominoes to its right (a domino row with growth > 1, or seven dominoes of rising height). The photo's pendulum cannot reach the row; a good answer moves it so the swing does hit the first domino, and says so.",
		},
	},
	{
		id: "photo-seesaw-catapult", kind: "photo", model: "gemini-group/gemini-3-pro-image-preview", size: [1024, 1024], camera: "three-quarter view from the front left, slightly above; the seesaw runs left-right",
		description: "Rustic wooden table by a window. A seesaw: a weathered plank on a triangular wooden block; its left end is down on the table with a white ping-pong ball resting on it near the end; its right end is raised. A small dark cylindrical steel weight hangs on a twine string above the raised right end. A low woven wicker basket stands on the table at the far left (partly cut off by the frame).",
		expect: {
			must_types: ["@lever", "@ball", "basket", ["@weight", "@pendulum", "hanging-spring"]],
			counts: [{ of: "@ball", eq: 1 }],
			relations: [
				{ rel: "on", a: "@ball", b: "@lever" },
				{ rel: "left_of", a: "basket", b: "@lever" },
				{ rel: "over", a: ["@weight", "@pendulum"], b: "@lever", soft: true },
				{ rel: "opposite_sides", a: ["@weight", "@pendulum"], b: "@ball", c: "@lever", soft: true },
			],
			outcomes: [{ kind: "rises", of: "@ball", min_m: 0.1, soft: true }, { kind: "in", item: "@ball", container: "basket", soft: true }],
			items: { max: 8 },
			rubric: "Seesaw with the ball on its low left end, a weight above the raised right end (held, then dropped — or hung), a basket at the left where the ball should land. Ball should be a ping-pong ball (white, ~4 cm).",
		},
	},
	{
		id: "photo-car-ramp-blocks", kind: "photo", model: "openai-group/gpt-image-2", size: [1536, 1024], ...SIDE_VIEW,
		description: "Wooden table, side view. At the left a closed, taped cardboard shipping box. A long wooden plank leans from the box's top right edge down to the right onto the table. A small red die-cast toy car sits on top of the box at the plank's upper end, facing right (down the ramp). At the plank's lower end, touching it, a tower of three natural wooden cube blocks is stacked on the table.",
		expect: {
			must_types: ["cardboard-box", "@ramp", "@toy_car", "wooden-block"],
			counts: [{ of: "wooden-block", eq: 3 }, { of: "@toy_car", eq: 1 }],
			relations: [
				{ rel: "stack", a: "wooden-block", min: 3 },
				{ rel: "on", a: "@toy_car", b: ["cardboard-box", "@ramp"] },
				{ rel: "angled", a: "@ramp", sign: "down_right", min_deg: 8, max_deg: 45 },
				{ rel: "right_of", a: "wooden-block", b: "cardboard-box", all: true },
				{ rel: "on_table", a: "cardboard-box" },
			],
			outcomes: [{ kind: "hits", a: "@toy_car", b: "wooden-block", soft: true }],
			items: { max: 8 },
			rubric: "Box, ramp from its top down to the right, toy car at the top, three cube blocks stacked at the ramp's foot (wooden blocks sized as cubes). The car rolls down and hits the tower.",
		},
	},
	{
		id: "photo-books-can-ball", kind: "photo", model: "gemini-group/gemini-3-pro-image-preview", size: [1024, 1024], camera: "front view at desk height, slightly from the left",
		description: "Old wooden desk by a window. Left: a white ceramic coffee mug. Centre: a neat stack of four old hardcover books lying flat (a brown leather one at the bottom, three cloth-bound ones above). A red soda can stands upright on the top book, towards its right side. Right: a worn yellow tennis ball on the desk.",
		expect: {
			must_types: ["coffee-mug", "@book", "soda-can", "tennis-ball"],
			forbid_types: ["soda-can-side"],
			counts: [{ of: "@book", eq: 4 }, { of: "soda-can", eq: 1 }, { of: "tennis-ball", eq: 1 }],
			relations: [
				{ rel: "stack", a: "@book", min: 4 },
				{ rel: "on", a: "soda-can", b: "@book" },
				{ rel: "order_x", specs: ["coffee-mug", "@book", "tennis-ball"] },
				{ rel: "on_table", a: "coffee-mug" },
			],
			outcomes: [{ kind: "stays", of: ["soda-can", "@book", "coffee-mug"], max_m: 0.01, max_deg: 3 }],
			items: { max: 7 },
			rubric: "A still life: mug, four stacked books with a standing can on top, tennis ball — in that order left to right, all stable. Realistic sizes (books ~23 cm wide, can 12 cm tall).",
		},
	},
	{
		id: "photo-cradle-desk", kind: "photo", model: "openai-group/gpt-image-2", size: [1536, 1024], camera: "front view at desk height",
		description: "Office desk. A Newton's cradle with SIX polished steel balls (the prompt asked for five) on a black base with a steel frame; the leftmost ball is pulled out to the left, the other five hang at rest touching. To the right of the cradle's base a smartphone lies flat, screen up; further right a white ceramic coffee mug. Background (window, monitor, chair, plant) is blurred scenery.",
		expect: {
			must_types: ["newtons-cradle", "smartphone", "coffee-mug"],
			counts: [{ of: "newtons-cradle", eq: 6 }],
			prop_checks: [{ of: "newtons-cradle", prop: "start_angle", max: -10 }],
			relations: [{ rel: "order_x", specs: ["newtons-cradle", "smartphone", "coffee-mug"] }, { rel: "on_table", a: "smartphone" }],
			outcomes: [{ kind: "swings", of: "newtons-cradle", min_deg: 10 }],
			items: { max: 5 },
			rubric: "Count the balls: six. The cradle's first (left) ball pulled out to the left; phone flat to its right; mug further right. Nothing from the background.",
		},
	},
	{
		id: "photo-zigzag-marble", kind: "photo", model: "openai-group/gpt-image-2", size: [1536, 1024], ...SIDE_VIEW,
		description: "Light wooden table, side view. Two long wooden ramps (slats) form a zig-zag on upright wooden blocks: the upper ramp starts on top of a tall block at the left, with a blue glass marble at its left end, and slopes down to the right; its right end rests on the right end of the lower ramp, which sits on a block at the far right. The lower ramp slopes down to the LEFT, over a short block in the middle, and its left end overhangs a clear plastic cup standing on the table at the far left. Three upright blocks in all.",
		expect: {
			must_types: ["glass-marble", "@ramp", "@cup"],
			counts: [{ of: "@ramp", min: 2 }, { of: "glass-marble", eq: 1 }, { of: ["wooden-block", "brick", "cardboard-box"], eq: 3, soft: true }],
			relations: [
				{ rel: "angled", a: "@ramp", sign: "down_right", min_deg: 3 },
				{ rel: "angled", a: "@ramp", sign: "down_left", min_deg: 3 },
				{ rel: "over", a: "glass-marble", b: "@ramp" },
				{ rel: "left_of", a: "@cup", b: "@ramp", all: true },
			],
			outcomes: [{ kind: "in", item: "glass-marble", container: "@cup", soft: true }],
			items: { max: 9 },
			rubric: "Two ramps sloping opposite ways, the upper one carrying the marble to the right, the lower one bringing it back left into the plastic cup. Supports may be blocks or planks on legs.",
		},
	},
	{
		id: "photo-tower-wrecking", kind: "photo", model: "openai-group/gpt-image-2.5-sunburst", size: [1536, 1024], ...SIDE_VIEW,
		description: "Wooden table, side view. At the left a toy wooden crane (lattice jib on a mast, on a wooden base); a heavy steel ball on a short chain hangs from the mast's top, swung out to the left. At the right, a single tower of six natural wooden cube blocks stacked one on another.",
		expect: {
			must_types: [["wrecking-ball", "pendulum", "rope-pendulum"], "wooden-block"],
			counts: [{ of: "wooden-block", eq: 6 }],
			relations: [{ rel: "stack", a: "wooden-block", min: 6 }, { rel: "left_of", a: "@pendulum", b: "wooden-block", all: true }],
			outcomes: [{ kind: "hits", a: "@pendulum", b: "wooden-block", soft: true }, { kind: "displaced", of: "wooden-block", min_fraction: 0.5, soft: true }],
			items: { max: 9 },
			rubric: "Wrecking ball (crane, chain, heavy ball) pulled back to the left; a tower of six cube blocks to the right that the swing reaches.",
		},
	},
	{
		id: "photo-rube-chain", kind: "photo", model: "gemini-group/gemini-3-pro-image-preview", size: [1024, 1024], camera: "side view from slightly in front and above (table corner)",
		description: "Old wooden table corner. From left to right: a wooden wedge-shaped ramp (a block with a sloped top between two rails) with a polished steel ball at its high left end; a row of FIVE wooden dominoes (with pips) standing upright; a small red toy car (a classic round little car) facing left towards the dominoes; and a brown paper cup lying on its side, its open end facing right, crumpled.",
		expect: {
			must_types: ["@ball", "@ramp", "@domino", "@toy_car"],
			counts: [{ of: "@domino", eq: 5 }, { of: "@ball", eq: 1 }],
			may_missing: [{ what: "a paper cup lying on its side (cups are fixed upright containers)", match: ["cup", "paper cup", "on its side", "crumpled"] }],
			relations: [
				{ rel: "order_x", specs: ["@ramp", "@domino", "@toy_car"] },
				{ rel: "over", a: "@ball", b: "@ramp" },
			],
			outcomes: [{ kind: "hits", a: "@ball", b: "@domino", soft: true }, { kind: "hits", a: "@domino", b: "@toy_car", soft: true }],
			items: { max: 10 },
			rubric: "Ramp (a wedge or plank) with a steel ball at the top, five dominoes, a toy car, and something for the cup at the end — a cup lying on its side is not in the library (cups stand upright and fixed): say so, or use an upright cup/box. Five dominoes, not seven.",
		},
	},
	{
		id: "photo-board-bucket-34", kind: "photo", model: "openai-group/gpt-image-2.5-sunburst", size: [1536, 1024], camera: "three-quarter view from the front left and above; the board slopes from back-right (high) to front-left (low)",
		description: "Rustic dining table. A large wooden cutting board (with a juice groove) lies tilted: its far end is propped on a paperback book lying flat, its near end rests on the table. An ivory cue ball (billiard ball) and a white golf ball sit side by side at the board's high end. A small galvanised metal bucket with a wire handle stands on the table near the board's low end, at the front left. Background: chair, plant, shelves (scenery).",
		expect: {
			must_types: ["cutting-board", "@book", "billiard-ball", "golf-ball", "bucket"],
			counts: [{ of: "@ball", eq: 2 }, { of: "@book", eq: 1 }],
			relations: [
				{ rel: "angled", a: "cutting-board", min_deg: 3, max_deg: 45 },
				{ rel: "over", a: "billiard-ball", b: "cutting-board" },
				{ rel: "over", a: "golf-ball", b: "cutting-board" },
				{ rel: "on", a: "cutting-board", b: "@book", soft: true },
				{ rel: "near", a: "bucket", b: "cutting-board", max_m: 0.3, soft: true },
			],
			outcomes: [{ kind: "in", item: "@ball", container: "bucket", soft: true }],
			items: { max: 7 },
			rubric: "A three-quarter photo: the slope runs into the picture. Map it onto the side view: the book under the board's high end, the two balls at the top, the bucket where the board meets the table. Sizes: cutting board ~40 cm, paperback, small bucket (narrower than the default).",
		},
	},
	{
		id: "sketch-ramp-cup", kind: "sketch", model: "gemini-group/gemini-3-pro-image-preview", size: [1024, 1024], ...SIDE_VIEW,
		description: "Light pencil sketch on white paper: a square box at the left; a straight ramp (a plank) leaning from the box's top right corner down to the ground at the right; a ball drawn at the ramp's top end; a curved arrow showing the ball rolling down; a small cup on the ground at the right, a little past the ramp's foot. The ball is drawn larger than the cup (sketch scale, not real sizes).",
		expect: {
			must_types: ["@ball", "@ramp", "@container", ["cardboard-box", "wooden-block", "foam-block", "brick", "box", "tissue-box", "cereal-box", "@book"]],
			counts: [{ of: "@ball", eq: 1 }],
			relations: [
				{ rel: "over", a: "@ball", b: "@ramp" },
				{ rel: "angled", a: "@ramp", sign: "down_right", min_deg: 15, max_deg: 50 },
				{ rel: "right_of", a: "@container", b: "@ramp" },
			],
			outcomes: [{ kind: "in", item: "@ball", container: "@container", soft: true }],
			items: { max: 6 },
			rubric: "Read the sketch's intent: ball rolls down the ramp and lands in the cup. Pick sizes that work (a ball that fits the cup; the ramp steep as drawn, ~35°).",
		},
	},
	{
		id: "sketch-seesaw-catapult", kind: "sketch", model: "openai-group/gpt-image-2.5-sunburst", size: [1536, 1024], ...SIDE_VIEW,
		description: "Black ballpoint sketch on lined spiral-notebook paper: a seesaw (plank on a triangular pivot) with its left end down; a small ball labelled 'ball' on the left end; a heavy weight (kettlebell-style, labelled 'weight') above the raised right end with a downward arrow and motion lines; a dashed arc from the ball up and over to a basketball hoop (backboard, rim and net on a pole) at the far left.",
		expect: {
			must_types: ["@lever", "@weight", "@ball"],
			must_missing: [{ what: "a basketball hoop", match: ["hoop", "backboard", "basketball net", "net", "rim"] }],
			may_missing: [{ what: "a pole / stand for the target", match: ["pole", "stand", "post"] }],
			counts: [{ of: "@ball", eq: 1 }],
			relations: [
				{ rel: "on", a: "@ball", b: "@lever" },
				{ rel: "over", a: "@weight", b: "@lever" },
				{ rel: "opposite_sides", a: "@weight", b: "@ball", c: "@lever" },
				{ rel: "left_of", a: "@container", b: "@lever", soft: true },
			],
			outcomes: [{ kind: "hits", a: "@weight", b: "@lever" }, { kind: "rises", of: "@ball", min_m: 0.1, soft: true }],
			items: { max: 6 },
			rubric: "Seesaw catapult with labels to read. There is no basketball hoop in the library: report it and use a container (basket, bucket, box) as the target, at the left where the arc lands.",
		},
	},
	{
		id: "sketch-pendulum-dominoes", kind: "sketch", model: "openai-group/gpt-image-2", size: [1536, 1024], ...SIDE_VIEW,
		description: "Child's crayon drawing: a blue upright stand with a red arm at the top; a purple ball on a black string hangs from the arm and is swinging to the right (purple motion lines behind it); six dominoes (red, orange, yellow, green, blue, purple, with black dots) stand in a row on a brown table line to the right of the ball.",
		expect: {
			must_types: ["@pendulum", "@domino"],
			counts: [{ of: "@domino", eq: 6 }],
			relations: [{ rel: "left_of", a: "@pendulum", b: "@domino" }, { rel: "on_table", a: "@domino" }],
			outcomes: [{ kind: "hits", a: "@pendulum", b: "@domino" }, { kind: "topples", of: "@domino", min_fraction: 0.8, soft: true }],
			items: { max: 9 },
			rubric: "Pendulum swinging into a row of six dominoes. Colours are a child's drawing, not materials: plain dominoes are right.",
		},
	},
	{
		id: "sketch-rube-labelled", kind: "sketch", model: "openai-group/gpt-image-2.5-sunburst", size: [1536, 1024], ...SIDE_VIEW,
		description: "Blue-pen engineering sketch on grid paper, left to right: a ramp on a post, sloping down to the right, labelled 'ramp 30°' (with a 30° angle mark at its foot) and a ball at its top; five dominoes labelled 'dominoes x5' with arrows between them, the fifth tipping into a toy car labelled 'toy car'; an arrow from the car to an open box labelled 'box' at the right.",
		expect: {
			must_types: ["@ball", "@ramp", "@domino", "@toy_car", ["box", "cardboard-box"]],
			counts: [{ of: "@domino", eq: 5 }, { of: "@ball", eq: 1 }],
			relations: [
				{ rel: "angled", a: "@ramp", sign: "down_right", min_deg: 27, max_deg: 33 },
				{ rel: "order_x", specs: ["@ramp", "@domino", "@toy_car", ["box", "cardboard-box"]] },
				{ rel: "over", a: "@ball", b: "@ramp" },
			],
			outcomes: [
				{ kind: "hits", a: "@ball", b: "@domino" },
				{ kind: "hits", a: "@domino", b: "@toy_car", soft: true },
				{ kind: "hits", a: "@toy_car", b: ["box", "cardboard-box"], soft: true },
			],
			items: { max: 10 },
			rubric: "Read the labels: a 30° ramp, exactly five dominoes, a toy car, a box at the end. The chain should run: ball → dominoes → car → box.",
		},
	},
]

const CORE = new Set(["rube-goldberg", "car-ramp-dominoes", "pendulum-dominoes", "wrecking-ball", "spring-launch", "conveyor-delivery", "desk-objects", "book-ramp-ball", "stacks", "seesaw-catapult", "balls-lineup", "vehicles"])
const gtEntries = []
for (const f of fs.readdirSync(path.join(BENCH, "gt")).filter((f) => f.endsWith(".meta.json")).sort()) {
	const meta = JSON.parse(fs.readFileSync(path.join(BENCH, "gt", f), "utf8"))
	const scene = JSON.parse(fs.readFileSync(path.join(BENCH, meta.scene), "utf8"))
	// counted as scoreCase counts: visible non-scenery items, a domino row as its dominoes and a Newton's cradle as its balls
	const fam = new Map()
	for (const it of geometry(scene).items) {
		if (it.scenery || !it.visible) continue
		const k = familyOf(it.type, bench.groups, bench.families)
		fam.set(k, (fam.get(k) ?? 0) + it.units)
	}
	const expect = {
		must_types: [...fam.keys()],
		counts: [...fam.entries()].map(([k, n]) => ({ of: k, eq: n })),
		rubric: `Rebuild exactly this scene from the picture: ${meta.description} Score with scoreAgainstGT against ${meta.scene} (types, order along x, positions after aligning scale and offset, true sizes).`,
	}
	for (const [k, r] of meta.renders.entries()) {
		gtEntries.push({
			id: `gt-${meta.id}${k ? "-b" : ""}`, kind: "gt-render", file: r.file, gt: meta.scene, meta: `gt/${meta.id}.meta.json`, core: CORE.has(meta.id) && k === 0,
			source: meta.source, camera: r.camera, size: [r.width, r.height], description: meta.description, expect,
		})
	}
}
const images = [
	...GENERATED.map((g) => ({ ...g, file: `images/${g.id}.png`, prompt: promptOf(g.id) })),
	...gtEntries,
]
const out = {
	version: 1,
	about: "Image cases for the AI scene builder's benchmark. kind: photo | sketch (generated, see tools/gen-images.mjs; `prompt` is what the generator was asked, `description` what the picture really shows) | gt-render (the app's own Wide render of a known scene; `gt` is that scene, `meta` has its cameras and every item's box in metres and in the picture). Paths are relative to ai/bench/. `expect` uses the text-case format of cases/text.json (checked by score.mjs scoreCase); gt-render cases are also scored with score.mjs scoreAgainstGT. `core` marks the 12 ground-truth renders of the quick run.",
	counts: { photo: images.filter((i) => i.kind === "photo").length, sketch: images.filter((i) => i.kind === "sketch").length, "gt-render": gtEntries.length, gt_core: gtEntries.filter((g) => g.core).length },
	images,
}
fs.writeFileSync(path.join(BENCH, "images/index.json"), JSON.stringify(out, null, 1) + "\n")
console.log(JSON.stringify(out.counts))
