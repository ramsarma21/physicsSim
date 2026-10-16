# Prompt variants measured by the benchmark (2026-10-15)

Each folder is a complete copy of `ai/prompts/` that `ai/bench/run.mjs --prompts <folder>` runs instead (AI_PROMPTS_DIR). The rounds, their scores and
what each change was for are in `ai/research/benchmark.md` ("Prompt optimisation").

| folder | what changed (against the folder before it) | used for |
|---|---|---|
| `r0` | nothing: the original `ai/prompts/` (also in `research/prompt-*-before-ai.md`) | baseline of every round |
| `r1` | plan.md: parts of a catalog item and part-missing things are not "missing"; "fewest items"; nothing waits on a slope unless held; same-kind supports stacked; how a thing gets INTO a container | plan round 1 |
| `r2` | plan.md: "fewest items" narrowed to "keep the request's own events" (it made open requests too thin); N stages means N distinct mechanisms; open requests lively; a seesaw throws back over its pivot (checked in the engine) | plan round 2 |
| `r3` | plan.md: landing ON something, a toppling domino only nudges a ball (ball within 1 cm of the edge to drop it), a ball dropped off-centre on a trampoline is thrown outwards (all three checked in the engine); _world.md: the solver's safety walls (cannot be removed; nothing falls off the table) | plan round 3: shipped |
| `obs-r1` | observe.md (plan prompt = r0): name things by their role (dominoes without pips, ramp, pendulum, seesaw), a mechanism as ONE object, same-kind groups regardless of colour, `held` for things that cannot stay put, the sandbox's own render to scale | observe round 1 |
| `obs-r2` | observe.md: round 1 without "a mechanism as ONE object" and without the sandbox scale cue (both hurt box matching and sizes); size of the thing itself, without its stand | observe round 2: shipped |
| `obs-r3` | observe.md: a likely kind for each ball; which way tilted / aimed things point, in `notes` | observe round 3 (not better on train) |
| `final` | r3 + obs-r2's observe.md: what `ai/prompts/` held until round 2 | the shipped prompts (morning) |
| `ai2-full` | round 2 (2026-10-15 evening, benchmark §13): _world.md + _place.md: nothing floats, supports for static things in the air (posts, stacks, legs on), a pendulum swings from its start_angle; _plan_format.md + plan.md: `stages` for chains of 4+ stages (expectation, check, knobs); plan.md: keep a picture's kinds, colours and sizes (or say why in differences), and "check each hand-off once with rough numbers; give a close one a knob" instead of "think through each step with the numbers"; refine.md: never take away what holds a static thing up, fix the first failing stage first, be brief; edit.md: assumptions kept and extended; _patches.md: set_stages | round 2, rejected: the hand-off sentence was no faster and lost plan-only pass |
| `ai2-nohandoff` | `ai2-full` with plan.md's original "think through each step with the numbers" sentence | round 2: the plan prompt shipped |
| `ai2-final2` | the prompts after the edits-stay-edits and chat work (§13.8, §13.9: edit.md patch-vs-new, kind swaps, `reply`/`suggestions`, a goal at risk is said) + a "make it work" rule in edit.md and an exception for it in refine.md | round 2 edit A/B (`ai2ed4`): the edit.md rule kept, the refine.md exception dropped (it let the critic change items the request does not name) |
| `ai2-shipped` | what `ai/prompts/` holds at the end of round 2 (ai2-final2's edit.md rule, refine.md without the exception, chat fields capped: chip prompts under 20 words, `why` under 15) | shipped |
