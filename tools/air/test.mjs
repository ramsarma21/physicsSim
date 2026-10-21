// The air module end to end (machines/mod_air.py, web/sim/modules/air.js, tooling/src/sim/modules/air.ts), as its builder's fuzz checked it
// (120 scenes, 0 problems, 20 Oct), now in the repo and in the release gate (tools/parity/run.sh):
//   catalog   its types' entries: items.py == web/sim (props, links, readouts and their words, module)
//   build     random scenes of air items (every number within its range, at its ends, every choice), alone, with each other and with a fan or a
//             breeze, in a vacuum, a cold or hot room, on the Moon, in a time-lapse: items.py == web/sim (document, resolved, warnings, refusals)
//   engine    the server's engine (node, the bundle's math) == the browser bundle, byte for byte; every placement and reading finite
//   summary   items.py summarize == web/sim finish, with goals of every air kind sampled (pops, lifts_off, crushes, glides, kite_flies, ...)
//   node --no-warnings tools/air/test.mjs [--n 12] [--mix 120] [--per 2] [--seed 7]
import { runModuleParity } from "../parity/module.mjs"

const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i >= 0 ? Number(process.argv[i + 1]) : d
}
// (a fan and a breeze push the air module's balloons, kites, planes and smoke: research/rw-validate-air.ts)
const partners = [
	{ type: "fan", x: 0.2, y: 0.3, props: { speed: 4 } },
	{ type: "breeze", x: -0.45, y: 0, props: { speed: 5 } }
]
const r = await runModuleParity({ module: "air", n: arg("--n", 12), mix: arg("--mix", 120), per: arg("--per", 2), seed: arg("--seed", 7), engine: true, partners })
process.exit(r.failed ? 1 : 0)
