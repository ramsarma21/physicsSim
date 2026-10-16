// What the page needs of the engine's math, apart from the worker: x ** y correctly rounded (tools/crpow.ts), the same bits in every
// browser, in node on the server, and in Python's builders (machines/crmath.py: cr_pow, cube). Bundled by tools/build-engine.mjs into
// web/sim/engine-math.js.
//   import { pow, cube } from "./engine-math.js"   // the browser's own ** differs between engines; these do not
export { cube, pow } from "./crpow.ts"
