// The cheap vision check: is a concept picture a BUILDABLE reference for the scene builder? It sees the picture, the request and the cast
// (the catalog items the picture should show, with counts and true sizes) and rates side view, backdrop, extras, counts, supports,
// readability of the story, plausibility of sizes and whether the layout would work. Used to pick the most buildable of several concepts
// generated in parallel, and as one measure of each prompt variant.
//   const r = await checkConcept({ dataUrl, request, prepass, model: "flash" })   // {ok, result: {score_0_10, ...}, ms, usage}
import { callConfig } from "../../../bench/lib/gateway.mjs"
import { catalogInfo } from "./catalog-info.mjs"
import { gated } from "./sem.mjs"

export const CHECK_CONFIGS = {
	flash: { id: "flash", model: "gemini-group/gemini-3.8-flash", params: { max_tokens: 4000, reasoning_effort: "low" } },
	haiku: { id: "haiku", model: "claude-group/claude-haiku-5-5", params: { max_tokens: 3000 } },
	mini: { id: "mini", model: "openai-group/gpt-5.4-mini", params: { max_tokens: 3000 } },
	"opus-low": { id: "opus-low", model: "claude-group/claude-opus-5-5", params: { max_tokens: 4000, reasoning_effort: "low" } }
}

const SYSTEM = `You check concept pictures for a physics-sandbox scene builder. The builder will rebuild the picture from a fixed catalog of real objects on a long table, with all motion in one vertical plane (left-right and up-down, seen from the side). A good concept picture is a BUILDABLE reference:
- side_view: 2 = straight side view of the tabletop (one flat plane, left to right); 1 = slightly angled but readable; 0 = top-down, steep perspective or depth arrangement that cannot be read as one plane.
- backdrop: 2 = plain backdrop, nothing but the setup on a tabletop; 1 = some background or props; 0 = cluttered.
- objects: for each listed object, the count you SEE (0 if absent).
- extras: objects in the picture that are NOT on the list (ignore the table, the backdrop, arrows, numbers and labels; thin pins/posts holding things are fine).
- supports: 2 = every object clearly rests on something or hangs from its stand (contacts visible); 1 = mostly; 0 = things float or intersect.
- story: 2 = what happens, in which order, is clear from the picture; 1 = partly; 0 = not readable.
- sizes: 2 = relative sizes look like the real objects listed; 1 = some off by more than 1.5x; 0 = badly off.
- works: 2 = the layout looks like it would really work in physics as the request says (e.g. a thing that must end in a container drops into its opening from above); 1 = doubtful; 0 = clearly would not work.
- score_0_10: how good a buildable reference this is overall, weighing all of the above (counts and supports most).
Answer with ONE JSON object only: {"side_view": 0-2, "backdrop": 0-2, "objects": [{"type": "<as listed>", "want": n, "seen": n}], "extras": ["..."], "supports": 0-2, "story": 0-2, "sizes": 0-2, "works": 0-2, "score_0_10": 0-10, "problems": ["short, most important first, at most 4"]}`

const n02 = (v) => Number.isFinite(v) && v >= 0 && v <= 2
function validate(v) {
	const errors = []
	for (const k of ["side_view", "backdrop", "supports", "story", "sizes", "works"]) if (!n02(v?.[k])) errors.push(`${k} must be 0, 1 or 2`)
	if (!(Number.isFinite(v?.score_0_10) && v.score_0_10 >= 0 && v.score_0_10 <= 10)) errors.push("score_0_10 must be a number 0-10")
	if (!Array.isArray(v?.objects)) errors.push("objects must be a list")
	return { ok: !errors.length, errors, warnings: [], value: { ...v, extras: Array.isArray(v?.extras) ? v.extras : [], problems: Array.isArray(v?.problems) ? v.problems : [] } }
}

/** A deterministic summary of a check: count accuracy over the cast and the extras. */
export function checkSummary(r, prepass) {
	if (!r) return null
	const want = new Map(prepass.cast.map((c) => [c.type, c.count]))
	const objs = Array.isArray(r.objects) ? r.objects : []
	let present = 0
	let exact = 0
	for (const [type, n] of want) {
		const o = objs.find((x) => x?.type === type) ?? objs.find((x) => String(x?.type ?? "").toLowerCase().includes(type.replace(/-/g, " ")))
		const seen = Number(o?.seen ?? 0)
		if (seen > 0) present++
		if (seen === n) exact++
	}
	return { present: want.size ? present / want.size : null, exact: want.size ? exact / want.size : null, extras: r.extras?.length ?? 0, score: r.score_0_10 }
}

export async function checkConcept({ dataUrl, request, prepass, model = "flash", signal }) {
	const info = await catalogInfo()
	const list = prepass.cast.map((c) => `- ${c.type} (${info.types.get(c.type)?.name ?? c.type}; ${c.size}): want ${c.count}${c.role ? ` — ${c.role}` : ""}`).join("\n")
	const content = [`# The request\n"""\n${request}\n"""`, `# The objects the picture should show (catalog items, true sizes)\n${list}`, prepass.story?.length ? `# What should happen\n${prepass.story.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "", "Check the picture (attached) and answer as one JSON object."].filter(Boolean).join("\n\n")
	const cfg = CHECK_CONFIGS[model] ?? CHECK_CONFIGS.flash
	return gated(() => callConfig("check", cfg, { system: SYSTEM, content, images: [dataUrl], validate, signal, timeoutMs: 60000, budgetMs: 120000 }))
}
