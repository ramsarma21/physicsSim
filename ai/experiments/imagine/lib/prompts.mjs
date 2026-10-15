// Concept-image prompt templates. Each takes the user's request and the pre-pass (lib/cast.mjs: catalog cast with true sizes, the start
// layout, the story) and returns the text sent to the image model.
//   naive          the request alone (the control: what "just draw it" gives)
//   photo          a buildable reference: exact side view (the motion plane), plain backdrop, a light-wood tabletop, ONLY the cast items at
//                  their true relative sizes and looks, clear supports and contacts, the start moment, nothing else
//   photo_arrows   photo + thin dashed motion arrows with stage numbers (the motion story readable)
//   render_labels  the same scene as a clean matte 3D render with a small name label beside each object, plus the arrows
import { catalogInfo } from "./catalog-info.mjs"

export const TEMPLATES = ["naive", "photo", "photo_arrows", "render_labels"]

function castLines(prepass, info) {
	return prepass.cast.map((c) => {
		const t = info.types.get(c.type)
		const what = t ? t.name.replace(/\s*\(.*\)$/, "").toLowerCase() : c.type
		const looks = t?.looks ? `; ${t.looks.replace(/\.$/, "")}` : ""
		const size = c.size ? ` (${c.size}${looks})` : looks ? ` (${looks.slice(2)})` : ""
		return `- ${c.count} × ${what}${size}${c.role ? ` — ${c.role}` : ""}`
	})
}

const SIDE = "seen exactly from the side: the camera is level with the tabletop and looks straight at it, so the whole setup lies in one flat plane, left to right (no perspective tilt, no top-down or angled view)"
const ONLY = "Exactly these objects and nothing else, at their true real-world sizes relative to each other"
const SUPPORT = "Every object visibly rests on the table or on another object, or hangs from its own stand; a thing that waits in the air or on a slope at the start is held by a thin wooden pin on a thin post. Show clearly where each thing touches what holds it up."
const NOTHING = "No people, no hands, no other furniture, no clutter, no shelves or walls behind the table."

export async function imagePrompt(template, request, prepass) {
	if (template === "naive") return request
	const info = await catalogInfo()
	const lines = castLines(prepass, info).join("\n")
	const story = prepass.story?.length ? prepass.story.map((s, i) => `${i + 1}. ${s}`).join(" ") : ""
	const common = [
		`${ONLY}:\n${lines}`,
		`Layout at the start, left to right: ${prepass.layout}`,
		SUPPORT
	]
	if (template === "photo" || template === "photo_arrows") {
		const parts = [
			`A photograph of a tabletop physics demonstration, ${SIDE}. A long plain light-wood tabletop runs across the whole picture in front of a plain light-grey studio backdrop; soft even light; everything in sharp focus. It shows the moment just before it starts: ${request}`,
			...common,
			template === "photo_arrows"
				? `Thin black dashed arrows show where things will move, in order, with a small number at each stage (${story || "the order of events"}). Apart from those arrows and numbers: ${NOTHING.toLowerCase()} No text.`
				: `${NOTHING} No text, no arrows, no labels.`
		]
		return parts.join("\n\n")
	}
	if (template === "render_labels") {
		return [
			`A clean 3D render of a physics sandbox scene, ${SIDE}, orthographic camera. Matte materials, soft shadows, a long light-wood tabletop on a plain very light grey background. It shows the moment just before it starts: ${request}`,
			...common,
			`Beside each object a small, neat label with its name in plain lowercase text (e.g. "tennis ball", "plank ramp"). Thin black dashed arrows show where things will move, in order, with a small number at each stage (${story || "the order of events"}). ${NOTHING}`
		].join("\n\n")
	}
	throw new Error(`unknown template ${template}`)
}
