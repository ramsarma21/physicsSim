#!/usr/bin/env node
// Freeze the pipeline under test: copies ai/*.mjs, ai/models.json, ai/prompts/, ai/research/fetch-h1.mjs, web/ai/*.js and web/sim/ into
// <dir> (default $EDIT_FROZEN or lib/env.mjs's FROZEN), so every arm of the A/B runs the same code while the live files change.
//   node ai/experiments/edit/snapshot.mjs [dir]
import { cpSync, mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { ROOT, FROZEN } from "./lib/env.mjs"

const dir = process.argv[2] || FROZEN
mkdirSync(join(dir, "ai"), { recursive: true })
mkdirSync(join(dir, "web", "ai"), { recursive: true })
for (const f of readdirSync(join(ROOT, "ai"))) if (f.endsWith(".mjs") || f === "models.json") cpSync(join(ROOT, "ai", f), join(dir, "ai", f))
cpSync(join(ROOT, "ai", "prompts"), join(dir, "ai", "prompts"), { recursive: true })
cpSync(join(ROOT, "ai", "research", "fetch-h1.mjs"), join(dir, "ai", "fetch-h1.mjs"))
for (const f of readdirSync(join(ROOT, "web", "ai"))) if (f.endsWith(".js")) cpSync(join(ROOT, "web", "ai", f), join(dir, "web", "ai", f))
cpSync(join(ROOT, "web", "sim"), join(dir, "web", "sim"), { recursive: true, filter: (s) => !s.endsWith(".map") })
console.log(`frozen into ${dir}`)
