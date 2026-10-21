// Unit tests of the heat module's numbers and geometry (tooling/src/sim/heat-data.ts, heat.ts) and of a few whole runs (built by web/sim, run by
// the engine in node): node --test --import ./tools/engine-math-node.mjs tooling/src/sim/heat.test.ts
// (research/rw-validate-thermal.ts holds the long checks against reference values; these are the quick ones.)
import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import * as D from "./heat-data.ts"
import { gapOf, pointIn, segmentHits, touchOf } from "./heat.ts"

const near = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (±${tol})`)
const box = (x0: number, y0: number, x1: number, y1: number) => ({ points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] })

test("water and ice: CRC latent heats, heat capacities, the steam tables", () => {
	assert.equal(D.ICE.fusion, 333550)
	assert.equal(D.WATER.heatCapacity, 4184)
	near(D.vaporization(100), 2257e3, 2e3, "L_v at 100 °C")
	near(D.vaporization(0), 2501e3, 1, "L_v at 0 °C")
	near(D.vaporPressure(20), 2339, 12, "p_sat at 20 °C")
	near(D.vaporPressure(100), 101325, 3000, "p_sat at 100 °C")
	assert.ok(D.vaporPressure(-20) < D.vaporPressure(0) && D.vaporPressure(0) < D.vaporPressure(20), "rising with temperature")
	near(D.dewPoint(22, 0.5), 11.1, 0.2, "dew point of 22 °C, 50 %")
	near(D.dewPoint(22, 1), 22, 0.05, "saturated air: its own temperature")
})

test("salt water: CRC freezing points down to the eutectic, solubility, boiling point raised by K_b·i·b", () => {
	assert.equal(D.brineFreezing(0), 0)
	near(D.brineFreezing(0.05), -3.05, 0.1, "5 %")
	near(D.brineFreezing(0.2), -16.46, 0.1, "20 %")
	assert.equal(D.EUTECTIC, -21.1)
	near(D.brineFreezing(0.3), D.EUTECTIC, 1e-9, "past the eutectic: no lower")
	for (let w = 0; w < 0.23; w += 0.01) assert.ok(D.brineFreezing(w + 0.01) <= D.brineFreezing(w), `falling at ${w}`)
	assert.equal(D.SALT_SOLUBILITY, 0.359)
	assert.equal(D.boilingPoint(0, 1), 100)
	near(D.boilingPoint(0.1, 1), 101.752, 0.01, "100 g in 1 kg")
	near(D.boilingPoint(0.05, 1), 100.876, 0.01, "50 g in 1 kg")
})

test("air: Holman's natural convection grows as the quarter power, forced as the square root; mixing keeps the larger", () => {
	const h1 = D.naturalAir(10, 0.05, "side")
	const h16 = D.naturalAir(160, 0.05, "side")
	near(h16 / h1, 2, 1e-9, "16 × ΔT: 2 × h")
	assert.ok(D.naturalAir(10, 0.05, "rising") > D.naturalAir(10, 0.05, "sinking"), "a hot face up loses more than one down")
	near(D.forcedAir(4, 0.1) / D.forcedAir(1, 0.1), 2, 1e-9, "4 × speed: 2 × h")
	assert.equal(D.mixedAir(5, 0), 5)
	assert.ok(D.mixedAir(5, 3) >= 5 && D.mixedAir(5, 3) < 8, "between the larger and the sum")
	assert.ok(D.STILL_AIR_MASS > 5 && D.STILL_AIR_MASS < 6, "Carrier's still-air floor")
})

test("materials: every catalog material has heat numbers; colours absorb by their lightness", () => {
	for (const name of ["varnished hardwood", "steel", "aluminium", "glass", "solid rubber", "polypropylene", "ceramic", "foam", "copper", "stainless steel", "vacuum flask", "chocolate", "butter", "wax", "puddle water", "table salt"])
		assert.ok(D.HEAT_MATERIALS[name], name)
	for (const [name, m] of Object.entries(D.HEAT_MATERIALS)) {
		assert.ok(m.conductivity > 0 && m.heatCapacity > 0, name)
		assert.ok(m.emissivity > 0 && m.emissivity <= 1, `${name} emissivity`)
	}
	assert.ok(D.HEAT_MATERIALS.copper.conductivity > D.HEAT_MATERIALS.aluminium.conductivity, "copper over aluminium")
	assert.ok(D.HEAT_MATERIALS.aluminium.conductivity > 100 * D.HEAT_MATERIALS["varnished hardwood"].conductivity, "metal vs wood: two orders")
	assert.ok(D.HEAT_MATERIALS.foam.conductivity < D.HEAT_MATERIALS.ceramic.conductivity / 10, "foam insulates")
	near(D.colourAbsorptivity("#ffffff") as number, 0.2, 1e-9, "white")
	near(D.colourAbsorptivity("#000000") as number, 0.97, 1e-9, "black")
	assert.equal(D.colourAbsorptivity("not a colour"), undefined)
	const unknown = D.heatMaterialOf("moon rock", 3000)
	assert.ok(unknown.conductivity > 0 && unknown.heatCapacity > 0, "a fallback for any name")
	near(D.LAMP_RADIANT.led, 0.35, 1e-12, "an LED is mostly cool")
})

test("geometry: touching outlines, gaps, a segment through a box, a point in a box", () => {
	const a = box(0, 0, 1, 0.1)
	const b = box(0.2, 0.1, 0.6, 0.3)
	const t = touchOf(a, b)
	assert.ok(t, "touching")
	near(t.length, 0.4, 1e-9, "the shared length")
	near(t.ny, 1, 1e-9, "the normal points up from a to b")
	near(gapOf(a, box(0, 0.15, 1, 0.2)), 0.05, 1e-12, "a 5 cm gap")
	assert.ok(gapOf(a, box(0.5, 0.05, 0.7, 0.2)) < 0, "overlapping: negative")
	near(gapOf({ circle: { x: 0, y: 0, r: 0.1 } }, { circle: { x: 0.3, y: 0, r: 0.1 } }), 0.1, 1e-12, "two circles")
	assert.ok(segmentHits(box(0.4, -1, 0.6, 1), { x: 0, y: 0 }, { x: 1, y: 0 }), "a ray through a wall")
	assert.ok(!segmentHits(box(0.4, 0.5, 0.6, 1), { x: 0, y: 0 }, { x: 1, y: 0 }), "a ray under it")
	assert.ok(pointIn(a, { x: 0.5, y: 0.05 }, 0))
	assert.ok(!pointIn(a, { x: 0.5, y: 0.2 }, 0))
	assert.ok(pointIn(a, { x: 0.5, y: 0.105 }, 0.01), "within the grow margin")
})

// ---- whole runs: web/sim builds the document, the engine runs it as the server does
const PG = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..")
const { admitDocument } = await import("./document.ts")
const { simulate } = await import("./physics.ts")
await import("./modules/index.ts")
const { heatWorldOf } = await import("./heat.ts")
const sim = await import(pathToFileURL(`${PG}/web/sim/index.js`).href)
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const TABLE = { id: "table", type: "table", x: 1.3, y: 0, props: {} }
// biome-ignore lint/suspicious/noExplicitAny: test scenes
const runScene = (items: any[], settings: Record<string, number>, seconds = 10) => {
	const scene = { version: 2, id: "u", name: "u", seconds, release: 0.2, stage: STAGE, settings, items: [TABLE, ...items], goals: [] }
	const { doc } = sim.prepare(scene)
	const { scene: s } = admitDocument(doc)
	const track = simulate(s, 24)
	return { track, doc, world: heatWorldOf(s) }
}
// biome-ignore lint/suspicious/noExplicitAny: tracks
const last = (track: any, id: string, key: string) => {
	const v = track.state?.[id]?.[key] ?? []
	return v[v.length - 1]
}

test("a scene without heat keeps no heat process and no settings (existing scenes stay byte-identical)", () => {
	const { doc, world } = runScene([{ id: "ball", type: "ball", x: 1, y: 0.3, props: {} }], {}, 1)
	assert.equal(doc.processes, undefined)
	assert.equal(doc.settings, undefined)
	assert.equal(world, undefined)
})

test("an ice cube on a plate in a 22 °C room melts in about an hour and a half, leaves a puddle, and the books close", () => {
	const cube = { id: "ice", type: "ice-cube", x: 1, y: 0.0045 + 0.0125 + 0.0005, props: { width: 0.025, height: 0.025, depth: 0.025, start_temp_c: 0 } }
	const { track, world } = runScene([{ id: "plate", type: "plate", x: 1, y: 0, props: {} }, cube], { room_temp: 22, time_lapse: 900 }, 10)
	const melted = last(track, "ice", "melted")
	assert.ok(melted > 0.95, `melted ${melted}`)
	const frames = track.frames.length
	const v = track.state.ice.melted
	const k = v.findIndex((m: number) => m >= 0.995)
	const minutes = ((track.frames[k]?.t ?? track.frames[frames - 1].t) * 900) / 60
	assert.ok(minutes > 20 && minutes < 120, `melts in ${minutes} min`)
	assert.ok(last(track, "ice", "puddle_g") > 5, "its meltwater is a puddle")
	assert.ok(world)
	const scale = Math.abs(world.ledger.room) + Math.abs(world.ledger.sources) + Math.abs(world.ledger.vapor)
	assert.ok(Math.abs(world.imbalance()) / Math.max(1, scale) < 1e-9, `imbalance ${world.imbalance()}`)
	for (const [id, keys] of Object.entries(track.state ?? {}))
		for (const [key, vals] of Object.entries(keys as Record<string, number[]>)) for (const x of vals) assert.ok(Number.isFinite(x), `${id}.${key} finite`)
})

test("the same scene twice gives the same track (deterministic)", () => {
	const items = [{ id: "cup", type: "drink-cup", x: 1, y: 0, props: { style: "mug", water_temp_c: 80 } }, { id: "t", type: "thermometer", x: 1, y: 0.05, props: {} }]
	const a = runScene(items, { time_lapse: 60 }, 3)
	const b = runScene(items, { time_lapse: 60 }, 3)
	assert.equal(JSON.stringify(a.track), JSON.stringify(b.track))
	assert.ok(last(a.track, "cup", "water_temp") < 80, "the coffee cools")
})

test("a drying puddle keeps its edge (constant area) and dries in hours, not forever; its event uses its name", () => {
	const { track } = runScene([{ id: "p", type: "puddle", name: "Spilled milk", x: 1, y: 0, props: { water_ml: 10 } }], { room_temp: 22, time_lapse: 3600 }, 20)
	const v = track.state.p.liquid_g
	const k = v.findIndex((g: number) => g <= 0.05)
	assert.ok(k > 0, `dries within 20 h (left ${v[v.length - 1]} g)`)
	const hours = (track.frames[k].t * 3600) / 3600
	assert.ok(hours > 8 && hours < 20, `dries in ${hours} h (a 1.5 mm puddle at 22 °C, 50 %: Carrier's rate, about 0.1 mm an hour)`)
	// half of it goes in well under half the time it takes to dry (an exponential decay would take as long for each half)
	const h = v.findIndex((g: number) => g <= v[0] / 2)
	assert.ok(track.frames[h].t / track.frames[k].t < 0.6, "steady drying while pinned")
	assert.ok((track.events ?? []).some((e: { text: string }) => e.text === "Spilled milk dried up"), JSON.stringify(track.events))
})
