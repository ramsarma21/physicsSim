// Read-only: runs the existing engine (unchanged) on a scene document, sampling placements at `rate` Hz
// instead of the editor's 24, so a renderer can key true-time subframes for motion blur.
// node --no-warnings dense_track.ts <scene.json> <rate> <out.json>
import { writeFile } from "node:fs/promises"
import { readDocument } from "/Users/ramsarma/Downloads/science-map-share/blender-playground/tooling/src/sim/document-files.ts"
import { simulate } from "/Users/ramsarma/Downloads/science-map-share/blender-playground/tooling/src/sim/physics.ts"

const [path, rate, out] = process.argv.slice(2)
const admitted = await readDocument(path)
const track = simulate(admitted.scene, Number(rate))
await writeFile(out, JSON.stringify(track))
console.log(`wrote ${out}: ${track.frames.length} samples at ${rate} Hz, last t=${track.frames.at(-1)?.t}`)
