// What the page needs of the engine's math, apart from the worker: x ** y exactly as node on macOS gives it (Python's float ** on the same
// machine is the same libm routine), the same bits in every browser. Bundled by tools/build-engine.mjs into web/sim/engine-math.js.
//   import { pow, cube } from "./engine-math.js"   // pymath.js's `cube = (x) => x ** 3` should be this `cube`: the browser's own ** differs between engines
import { pow } from "./fdlibm.ts"

export { pow }
export const cube = (x: number): number => pow(x, 3)
