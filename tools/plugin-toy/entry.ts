// A test bundle: the engine worker's own run (tools/engine-worker-entry.ts) with the toy module's processes registered (tools/plugin-toy/test.mjs).
import { registerProcess } from "../../tooling/src/sim/plugins.ts"
import toy from "./src/sim/toy.ts"
export { handle, run } from "../engine-worker-entry.ts"
registerProcess(...toy)
