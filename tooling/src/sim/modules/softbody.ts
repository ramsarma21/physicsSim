/**
 * The softbody module's process kind, "softbody" (tooling/src/sim/softbody.ts does the work: soft and clay balls' contacts, bending beams,
 * rubber bands, coil springs' readings). Every record of a document joins one run (`softbodyRun`, made at the start, once every body and
 * joint exists); the first record's process drives it at physics.ts's fixed places (plugins.ts: force before each (sub-)step after the
 * release, after once it is stepped, contact as contacts are solved, step for the readings), the others only bring their records.
 * The records and their roles: see tooling/src/sim/softbody.ts (made by machines/mod_softbody.py's builders and build hook, and their port
 * web/sim/modules/softbody.js).
 */
import { softbodyProblem, softbodyRun } from "#sim/softbody.ts"
import type { ProcessKind, ProcessRecord } from "#sim/plugins.ts"

const softbody: ProcessKind = {
	kind: "softbody",
	check: (record: ProcessRecord, solids: ReadonlySet<string>) => softbodyProblem(record, solids),
	create(record, ctx) {
		const mine = (ctx.scene.processes ?? []).filter((r) => r.kind === "softbody")
		// (one run for all the document's softbody records: the first record's process drives it)
		if (mine[0] !== record) return {}
		let run: ReturnType<typeof softbodyRun> | undefined
		return {
			start(c) {
				run = softbodyRun(mine, c, c.engine())
				run.readings()
			},
			step() {
				run?.readings()
			},
			force(_c, h) {
				run?.force(h)
			},
			after(_c, h) {
				run?.after(h)
			},
			contact(_c, touch, phase) {
				return run?.contact(touch as Parameters<NonNullable<typeof run>["contact"]>[0], phase) ?? false
			}
		}
	}
}

export default softbody
