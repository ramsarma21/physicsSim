// The catalog's look variants: a type that is another type in all but its look, for a lesson's picture that reads (bench2: the swirl marble,
// machines/catalog_items.py _readable). Its props and runs are its base type's, its document theirs but for its name, look and pattern
// (tools/staging/readable.test.mjs: the runs byte for byte), so the random scene makers (engine-fuzz.mjs, fuzz-live.mjs) draw the catalog
// without them: a variant gives a fuzz nothing new to run, and with it every draw after its place in the catalog moved, so a seed made other
// scenes than release 2's (CI's parity step then met a 29-item scene the engine was already slow on: web/CONTRACT.md bench2). Every variant
// is still checked as a type: its catalog entry against the server's (fuzz-live's `catalog` group), Python == JavaScript (catalog.mjs), and
// against its base (readable.test.mjs).
export const LOOK_VARIANTS = Object.freeze({ "swirl-marble": "glass-marble" })

/** The type keys a random scene draws from: the catalog's, in its order, without the look variants. */
export const fuzzKeys = (types) => types.map((t) => t.key).filter((k) => !Object.hasOwn(LOOK_VARIANTS, k))
