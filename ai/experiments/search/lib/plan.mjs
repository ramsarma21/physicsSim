// The plan step with a design direction: the app's own plan prompt (frozen ai/prompts/plan.md + the catalog: the same cacheable system prompt as
// the shipped plan call) and the request, plus, for variants B-D, one "design direction" paragraph in the user turn. Opus 5.5 takes no
// temperature, so diversity comes from the brief. Variant A is exactly the shipped plan call (frozen steps.mjs freshPlan, text only).
import { core, digest, fetchH1, modelCall, ROUTING, schemas, steps } from "./infra.mjs"

export const VARIANTS = {
	A: { id: "A", name: "as shipped", brief: null },
	B: {
		id: "B",
		name: "robust hand-offs",
		brief:
			"Make it work on the first run: design every hand-off with a wide margin of error. Prefer hand-offs that do not depend on exact speeds: a thing that drops straight down into a wide opening, a ball rolling down a ramp into the first of a row of dominoes, a pendulum swinging into what stands at the bottom of its arc, a row of dominoes ending against a ball at the top of a ramp. Avoid long free flights onto small targets; when a flight is unavoidable, keep it short, make the target wide (bigger width props, inside their ranges) and give tune knobs for where it lands. Give every stage a check and 1-3 knobs."
	},
	C: {
		id: "C",
		name: "alternative design",
		brief:
			"Where the request leaves the design free, choose a different design from the first one that comes to mind: other mechanisms from the catalog (springs and launchers, pulleys and Atwood machines, pendulums and wrecking balls, levers and seesaws, conveyors, trampolines and bounce pads, funnels, staircases, peg boards, fans, toy cars) or another arrangement. Keep every thing, number and event the request names exactly as asked."
	},
	D: {
		id: "D",
		name: "compact and guided",
		brief:
			"Keep it compact and guided: short distances between stages; guides that steer moving things to the next stage (a funnel or a ramp end right above a container, a backstop wall just behind a target, a ledge whose edge is exactly where the next thing must start); containers as wide as their props allow; and each stage's receiver placed exactly where the previous stage's moving thing will arrive. Work the numbers out (heights, speeds, flight distances) before writing them down, and give tune knobs on the receivers' places."
	},
	E: { id: "E", name: "as shipped, high effort", brief: null, params: { reasoning_effort: "high" } }
}

const f3 = (v) => Number(v).toFixed(3).replace(/\.?0+$/, "")
const fenced = (label, s) => `${label}:\n"""\n${s}\n"""`
/** The shipped stage line for an empty scene (frozen steps.mjs stageText with no scene). */
function stageText() {
	const s = digest.DEFAULT_STAGE
	const left = 1.3 - 3.7 / 2
	const right = 1.3 + 3.7 / 2
	return `The stage runs x ${f3(s.x0)}…${f3(s.x1)} and y ${f3(s.y0)}…${f3(s.y1)} m. The table top is y = 0 and runs from x ${f3(left)} to ${f3(right)} (${f3(3.7)} m long).`
}

/** One plan for a text request, with a variant's design direction. -> the call's output ({result: plan, ms, usage, model, ...}) */
export async function planVariant(L, text, variant) {
	const cat = await digest.getCatalog()
	const parts = [fenced("# The request", text), `# The stage\n${stageText()}`]
	if (variant.brief) parts.push(`# Design direction for this version\n${variant.brief}`)
	parts.push("Write the plan as one JSON object.")
	const system = steps.loadPrompt("plan.md").replace("{{CATALOG}}", cat.text)
	const ctx = { catalog: cat.index, stage: undefined, text }
	return modelCall(L, "plan", `plan ${variant.id}`, () =>
		core.callModel("plan", { system, content: parts.join("\n\n"), images: [], validate: (v) => schemas.VALIDATORS.plan(v, ctx), routing: ROUTING, fetch: fetchH1, ...(variant.params ? { params: variant.params } : {}) })
	)
}
