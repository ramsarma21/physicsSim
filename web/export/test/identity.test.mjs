// The directed cameras are view-only. (1) Filming a run (the world, the automatic plan, a compile, the safety net, the digest) never changes it: its
// document and summary stay as they were, its track only gains the static placements every view reader fills in (track.js completeTrack), and the
// engine gives the very same run again afterwards. (2) The 12 built-in scenarios' and 10 gallery scenes' runs are byte for byte what the engine made
// before the directed cameras (identity-tracks.json: integrate/engine-waves 19947da), checked while web/sim is the one those hashes were made with;
// once the engine changes (another engine wave) that half is skipped and says so: regenerate with `node web/export/test/identity.test.mjs --write`.
//   node --test web/export/test/identity.test.mjs
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { completeTrack } from "../../track.js"
import * as X from "../shots.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..", "..")
const FIXTURE = join(HERE, "identity-tracks.json")
const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex")
const files = [...JSON.parse(readFileSync(join(ROOT, "web", "scenario-list.json"), "utf8")).map((s) => `web/scenarios/${s.id}.json`), ...JSON.parse(readFileSync(join(ROOT, "web", "gallery", "index.json"), "utf8")).map((g) => `web/${g.scene}`)]
/** sha256 over every .js/.mjs/.json under web/sim (sorted paths, each path and its bytes): the engine and the scene builder */
function engineFingerprint() {
	const list = []
	const walk = (d) => {
		for (const n of readdirSync(d).sort()) {
			const p = join(d, n)
			if (statSync(p).isDirectory()) walk(p)
			else if (/\.(js|mjs|json)$/.test(n)) list.push(p)
		}
	}
	walk(join(ROOT, "web", "sim"))
	const h = createHash("sha256")
	for (const f of list) h.update(relative(ROOT, f)).update("\0").update(readFileSync(f)).update("\0")
	return h.digest("hex")
}

test("filming a run never changes it, and the engine gives the same run again after", async () => {
	const { simulate, catalog, plugins } = await import("./sim-node.mjs")
	const { registryOf } = await import("../subjects.js")
	const cat = catalog()
	const reg = registryOf(plugins())
	assert.equal(files.length, 22)
	for (const f of files) {
		const scene = JSON.parse(readFileSync(join(ROOT, f), "utf8"))
		const run = simulate(scene)
		const before = { doc: sha(run.doc), summary: sha(run.summary), track: sha(completeTrack(structuredClone(run.track))) }
		const world = X.makeWorld({ run, scene, catalog: cat, registry: reg })
		const film = X.compile(X.autoPlan(world, { width: 1280, height: 720, fps: 30 }), world, { width: 1280, height: 720, fps: 30, kind: "focus" })
		X.measure(film)
		X.digestText(X.digest(world))
		assert.equal(sha(run.doc), before.doc, `${f}: the document`)
		assert.equal(sha(run.summary), before.summary, `${f}: the summary`)
		assert.equal(sha(run.track), before.track, `${f}: the track (only completeTrack's fill)`)
		const again = simulate(scene)
		assert.equal(sha(again.doc), before.doc, `${f}: the engine's document again`)
		assert.equal(sha(completeTrack(again.track)), before.track, `${f}: the engine's track again`)
	}
})

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"))
const sameEngine = engineFingerprint() === fixture.engine
test("the 22 identity scenes run byte for byte as before the directed cameras (integrate/engine-waves 19947da)", { skip: sameEngine ? false : "web/sim has changed since identity-tracks.json was made (another engine wave): regenerate it with --write" }, async () => {
	const { simulate } = await import("./sim-node.mjs")
	assert.deepEqual(files.slice().sort(), Object.keys(fixture.scenes).sort())
	for (const f of files) {
		const r = simulate(JSON.parse(readFileSync(join(ROOT, f), "utf8")))
		assert.equal(sha(r.track), fixture.scenes[f].track, `${f}: track`)
		assert.equal(sha(r.doc), fixture.scenes[f].doc, `${f}: document`)
		assert.equal(sha(r.summary), fixture.scenes[f].summary, `${f}: summary`)
	}
})

if (process.argv.includes("--write")) {
	const { simulate } = await import("./sim-node.mjs")
	const scenes = {}
	for (const f of files) {
		const r = simulate(JSON.parse(readFileSync(join(ROOT, f), "utf8")))
		scenes[f] = { track: sha(r.track), doc: sha(r.doc), summary: sha(r.summary), frames: r.track.frames.length }
	}
	writeFileSync(FIXTURE, JSON.stringify({ ...fixture, base: "regenerated", engine: engineFingerprint(), scenes }, null, 1))
	console.log(`wrote ${FIXTURE}`)
}
