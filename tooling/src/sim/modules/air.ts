/**
 * The air module's process kind, "air" (tooling/src/sim/air.ts does the work): one process per record, by its `role` (balloon, hotair,
 * glider, kite, smoke, anemometer, jar, card, cup, can). The records are made by machines/mod_air.py's builders and build hook (and their
 * exact port web/sim/modules/air.js). A document without air records never reaches this file.
 */
import { airProblem, airProcess } from "#sim/air.ts"
import type { ProcessKind } from "#sim/plugins.ts"

const air: ProcessKind = {
	kind: "air",
	check: (record, solids) => airProblem(record, solids),
	create: (record, ctx) => airProcess(record, ctx)
}

export default air
