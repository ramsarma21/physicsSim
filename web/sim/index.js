// The browser-side scene builder in one import: what web/server.py did with machines/items.py, without a server.
//   import { layout, catalog, prepare, finish, BadScene } from "./sim/index.js"
//   const { doc, resolved, warnings } = layout(scene)            // POST /api/layout
//   const { scene: s, doc, resolved } = prepare(scene)           // POST /api/simulate, before the engine: cleaned scene + document
//   const meta = finish(s, doc, resolved, track)                 //   ... after it: {doc, summary, warnings, resolved}
//   catalog()                                                    // GET /api/catalog
// The catalog files (catalog_items, catalog_everyday, catalog_mechanisms) register their types with use_catalog_module().
export { BadScene, MAX_ITEMS, clean, prop_specs } from "./clean.js"
export { build, catalog, inside, overlaps, preview, summarize, use_catalog_module, TYPES, CATEGORIES, LOOKS, MATERIALS } from "./items.js"
export { finish, layout, prepare, with_statics } from "./layout.js"

// The catalog files register their types in the order of items.py's CATALOG_MODULES (catalog_items, catalog_everyday, catalog_mechanisms).
import { use_catalog_module as use_catalog_module_items } from "./items.js"
import { register_all as register_catalog_items } from "./catalog-items.js"
use_catalog_module_items("catalog_items", register_catalog_items)

// catalog_everyday comes after catalog_items (it needs its cardboard, foam and glass materials, by name) and before catalog_mechanisms
import { use_catalog_module as use_catalog_module_everyday } from "./items.js"
import { register_all as register_catalog_everyday } from "./catalog-everyday.js"
use_catalog_module_everyday("catalog_everyday", register_catalog_everyday)

// catalog_mechanisms comes last, after catalog_everyday (its materials, "steel weight" and "aluminium" among them, decide which choices its types offer)
import { use_catalog_module as use_catalog_module_mechanisms } from "./items.js"
import { register_all as register_catalog_mechanisms } from "./catalog-mechanisms.js"
use_catalog_module_mechanisms("catalog_mechanisms", register_catalog_mechanisms)

// the physics modules (web/sim/modules/<name>.js, machines/mod_<name>.py), after the catalog files, in name order: web/sim/modules/index.js
// (written by tools/gen-modules.mjs) registers their types, goal kinds and plug-ins (./plugins.js)
// (imported here, after the catalog registrations above have run: a static import would be evaluated before this module's body, so the
// modules' types, looks and materials would come before the catalog files' ones, unlike machines/items.py)
const modulesIndex = await import("./modules/index.js")
export const MODULES = modulesIndex.MODULES
export const MODULE_ERRORS = modulesIndex.MODULE_ERRORS
export * as plugins from "./plugins.js"
export { settings_of, doc_settings, STANDARD_SETTINGS, GRAVITY_PRESETS, GOAL_KINDS, GoalCtx, Link, Readout } from "./items.js"
