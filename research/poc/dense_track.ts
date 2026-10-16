// Read-only: runs the existing engine (unchanged) on a scene document, sampling placements at `rate` Hz
// instead of the editor's 24, so a renderer can key true-time subframes for motion blur.
// The engine runs with the browser bundle's math (tools/engine-math-node.mjs), as the server's worker does, so the tracks are the same
// on any machine; it is loaded after that, by dynamic import, relative to this file.
// node --no-warnings dense_track.ts <scene.json> <rate> <out.json>
import { writeFile } from "node:fs/promises"
import "../../tools/engine-math-node.mjs"

const { readDocument } = await import("../../tooling/src/sim/document-files.ts")
const { simulate } = await import("../../tooling/src/sim/physics.ts")

const [path, rate, out] = process.argv.slice(2)
const admitted = await readDocument(path)
const track = simulate(admitted.scene, Number(rate))
await writeFile(out, JSON.stringify(track))
console.log(`wrote ${out}: ${track.frames.length} samples at ${rate} Hz, last t=${track.frames.at(-1)?.t}`)
