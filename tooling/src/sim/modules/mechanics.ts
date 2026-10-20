/**
 * The mechanics module's process kind, "mechanics" (tooling/src/sim/mechanics.ts does the work). Every record of a document joins one
 * mechanics run (`mechanicsRun`, made at the start, once every body and joint exists); the first record's process drives it at
 * physics.ts's fixed places (plugins.ts: force before each (sub-)step after the release, after once it is stepped, contact as contacts
 * begin and are solved, step for the readings), the others only bring their records. The records and their roles: see
 * tooling/src/sim/mechanics.ts (made by machines/mod_mechanics.py's builders and build hook, and their port web/sim/modules/mechanics.js).
 */
import { mechanicsProblem, mechanicsRun } from "#sim/mechanics.ts"
import type { ProcessKind, ProcessRecord } from "#sim/plugins.ts"

const mechanics: ProcessKind = {
	kind: "mechanics",
	check: (record: ProcessRecord, solids: ReadonlySet<string>) => mechanicsProblem(record, solids),
	create(record, ctx) {
		const mine = (ctx.scene.processes ?? []).filter((r) => r.kind === "mechanics")
		// (one run for all the document's mechanics records: the first record's process drives it)
		if (mine[0] !== record) return {}
		let run: ReturnType<typeof mechanicsRun> | undefined
		// (force arrows read the other processes' pushes: only a document with a forces record asks for them)
		const watchesForces = mine.some((r) => r.role === "forces")
		return {
			...(watchesForces ? { watchesForces: true } : {}),
			start(c) {
				const engine = c.engine()
				if (engine === undefined) return
				run = mechanicsRun(mine, {
					engine,
					gravity: c.settings.gravity,
					air: c.settings.air,
					release: c.scene.release.at,
					set: (item, key, value) => c.set(item, key, value),
					event: (text, items, kind) => c.event(text, items, kind),
					solidInfo: (id) => {
						const h = c.solid(id)
						if (h === undefined) return undefined
						const words = h.part.material.words
						const cut = words.indexOf(" [")
						return { material: cut < 0 ? words : words.slice(0, cut), body: h.part.body as never }
					},
					massOf: (id) => c.solid(id)?.mass() ?? 0,
					forces: () => c.forces(),
					nameOf: (item) => {
						const s = c.scene.solids.find((p) => p.id.startsWith(`${item}/`))
						return s === undefined ? item : (s.words.charAt(0).toUpperCase() + s.words.slice(1)).replace(/^An? /, "The ")
					}
				})
				run.readings()
			},
			step() {
				run?.readings()
			},
			force(c, h) {
				run?.force(c.time(), h)
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

export default mechanics
