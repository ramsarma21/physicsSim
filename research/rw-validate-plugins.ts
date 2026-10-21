// The plug-in framework's engine side against theory (tooling/src/sim/plugins.ts, physics.ts's settings, 2026-10-19):
//   gravity  a ball let fall in a vacuum under each preset (earth 9.81, moon 1.62, mars 3.71, jupiter 24.79, none) follows the 480 Hz step's own
//            free fall exactly: y_n = y0 − g·h²·n(n+1)/2 (semi-implicit Euler), to 1e-9 m; in air it falls less (drag)
//   hooks    a probe process: step() every step from t = 0, slow() on its beat with dt summing to time × timeLapse, force() only after the release
//   force    a push of the ball's weight up holds it still in a vacuum (to 1e-9 m over 1 s)
//   geometry submerged(): a sphere half under the line is 2/3·π·r³, a slab wholly under it w·h·d; resize(k) scales a ball's mass by k³
// Run: node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-plugins.ts
const PG = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const { simulate } = (await import(`${PG}/tooling/src/sim/physics.ts`)) as { simulate: (s: unknown, fps: number) => { frames: { t: number; placements: Record<string, { x: number; y: number; angle: number }> }[] } }
const { admitDocument } = (await import(`${PG}/tooling/src/sim/document.ts`)) as { admitDocument: (d: unknown) => { scene: unknown } }
const plugins = (await import(`${PG}/tooling/src/sim/plugins.ts`)) as typeof import("../tooling/src/sim/plugins.ts")
process.env.PLAYGROUND_MODULES = ""
const sim = (await import(`${PG}/web/sim/index.js`)) as { prepare: (s: unknown) => { doc: Record<string, unknown> & { solids: { id: string; body: { kind: string; radius?: number } }[] } } }

let failed = 0
const check = (ok: boolean, what: string, detail: string) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${what}  (${detail})`)
	if (!ok) failed++
}
const H = 1 / 480
const scene = (settings: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) => ({
	version: 2, id: "v", seconds: 1, release: 0, ...(settings ? { settings } : {}), ...extra,
	items: [{ id: "b", type: "steel-ball", x: 1.0, y: 1.5, props: {} }, { id: "s", type: "wooden-block", x: 2.0, y: 1.5, props: {} }]
})
const docOf = (s: unknown) => sim.prepare(s).doc
const run = (doc: unknown, fps = 480) => simulate(admitDocument(doc).scene, fps)

// ---- gravity presets in a vacuum, and air
for (const [name, g] of [["earth", 9.81], ["moon", 1.62], ["mars", 3.71], ["jupiter", 24.79], ["none", 0]] as const) {
	const doc = docOf(scene({ gravity: name, air: false }))
	const tr = run(doc)
	const id = doc.solids.find((s) => s.id.startsWith("b/"))?.id as string
	const y0 = tr.frames[0]?.placements[id]?.y as number
	let worst = 0
	for (const f of tr.frames) {
		const n = Math.round(f.t / H)
		if (n > 240) break // (0.5 s: before it lands anywhere)
		const want = y0 - (g * H * H * n * (n + 1)) / 2
		worst = Math.max(worst, Math.abs((f.placements[id]?.y as number) - want))
	}
	check(worst < 1e-9, `free fall in a vacuum, ${name} (${g} m/s²)`, `worst ${worst.toExponential(2)} m over 0.5 s`)
}
{
	const a = run(docOf(scene(undefined)))
	const v = run(docOf(scene({ air: false })))
	const id = Object.keys(a.frames[0]?.placements ?? {}).find((k) => k.startsWith("s/")) as string
	const at = (tr: typeof a) => tr.frames.find((f) => f.t >= 0.5)?.placements[id]?.y as number
	check(at(a) > at(v) + 1e-6, "the air slows a falling block; a vacuum does not", `in air ${at(a).toFixed(6)} m, in a vacuum ${at(v).toFixed(6)} m at 0.5 s`)
}

// ---- hooks: step, slow (time-lapse), force (after the release)
const seen = { steps: 0, slowCalls: 0, slowSum: 0, forceBefore: 0, forceAfter: 0, submergedBall: 0, submergedSlab: 0, mass1: 0, mass2: 0 }
plugins.registerProcess({
	kind: "v-probe",
	create(r) {
		const ball = r.ball as string
		const slab = r.slab as string
		return {
			coarse: 24,
			start(ctx) {
				const b = ctx.solid(ball)
				const o = b?.outline().circle
				if (o) seen.submergedBall = ctx.submerged(ball, o.y).volume / ((2 / 3) * Math.PI * o.r ** 3)
				const s = ctx.solid(slab)
				const p = s?.part.body
				if (p && p.kind === "slab") seen.submergedSlab = ctx.submerged(slab, 100).volume / (p.width * p.height * p.depth)
				seen.mass1 = b?.mass() ?? 0
				b?.resize(0.5)
				seen.mass2 = ctx.solid(ball)?.mass() ?? 0
				b?.resize(1)
			},
			step() {
				seen.steps++
			},
			slow(_ctx, dt) {
				seen.slowCalls++
				seen.slowSum += dt
			},
			force(ctx) {
				if (ctx.released()) seen.forceAfter++
				else seen.forceBefore++
				const b = ctx.solid(ball)
				if (b) b.push(0, b.mass() * ctx.settings.gravity)
			}
		}
	}
})
{
	const doc = docOf(scene({ air: false, time_lapse: 60 }, { release: 0.25 }))
	const ball = doc.solids.find((s) => s.id.startsWith("b/"))?.id as string
	const slab = doc.solids.find((s) => s.id.startsWith("s/"))?.id as string
	;(doc as Record<string, unknown>).processes = [{ kind: "v-probe", id: "probe", ball, slab }]
	const tr = run(doc)
	const steps = Math.round(1 / H) + 1
	const beats = Math.floor((steps - 1) / 24) + 1
	check(seen.steps === steps, "step() at every step from t = 0", `${seen.steps} of ${steps}`)
	check(seen.slowCalls === beats && Math.abs(seen.slowSum - beats * 24 * H * 60) < 1e-9, "slow() on its beat, dt scaled by the time-lapse (60×)", `${seen.slowCalls} calls, ${seen.slowSum.toFixed(6)} s of slow time`)
	check(seen.forceBefore === 0 && seen.forceAfter > 0, "force() only after the release", `${seen.forceBefore} before, ${seen.forceAfter} after`)
	const ys = tr.frames.map((f) => f.placements[ball]?.y as number)
	const drift = Math.max(...ys.map((y) => Math.abs(y - (ys[0] as number))))
	check(drift < 1e-9, "a push of its weight up holds a ball still in a vacuum", `moved ${drift.toExponential(2)} m in 1 s`)
	check(Math.abs(seen.submergedBall - 1) < 1e-12 && Math.abs(seen.submergedSlab - 1) < 1e-12, "submerged(): half a sphere, a whole slab", `${seen.submergedBall}, ${seen.submergedSlab}`)
	check(Math.abs(seen.mass2 / seen.mass1 - 0.125) < 1e-12, "resize(0.5) makes a ball weigh an eighth", `${seen.mass1} kg → ${seen.mass2} kg`)
}

// ---- admission: settings out of range and unknown kinds are refused with the reason
for (const [doc, want] of [
	[{ ...docOf(scene(undefined)), settings: { gravity: 31 } }, /settings\.gravity must be a number from 0 to 30/],
	[{ ...docOf(scene(undefined)), settings: { timeLapse: 0.5 } }, /settings\.timeLapse must be a number from 1 to 100000/],
	[{ ...docOf(scene(undefined)), processes: [{ kind: "nope", id: "x" }] }, /no process kind "nope"/],
	[{ ...docOf(scene(undefined)), processes: [{ kind: "v-probe", id: "x" }, { kind: "v-probe", id: "x" }] }, /two processes are called x/]
] as const) {
	let msg = ""
	try {
		admitDocument(doc)
	} catch (e) {
		msg = e instanceof Error ? e.message : String(e)
	}
	check(want.test(msg), "a document the engine cannot run is refused with the reason", msg)
}
console.log(failed ? `${failed} FAILED` : "ALL PASS")
process.exitCode = failed ? 1 : 0
