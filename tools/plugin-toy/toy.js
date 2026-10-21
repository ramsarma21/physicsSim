// The toy module's port (tools/plugin-toy/mod_toy.py, line for line) and its plug-ins: a test of the framework, never in the catalog.
// A module file takes everything from the framework object register_all gets (web/sim/items.js FRAMEWORK), so it imports nothing.
let F = null

export function register_all(f) {
	F = f
	const { register, ItemType, Prop, Link, Readout, MATERIALS, define_material } = f
	define_material("toy wax", { density: 900, bounce: 0.2, friction: 0.6, rolling: 0.02, side: 0.0, look: "clay", source: "Paraffin wax 900 kg/m³ (Engineering ToolBox)." }, ["density"])
	void MATERIALS
	register(new ItemType("toy-heater", "Toy heater pad", "Blocks & shapes", build_heater, {
		dynamic: false, module: "toy",
		props: [new Prop("width", "Width", 0.12, 0.04, 0.4, 0.01, "m"), new Prop("power", "Power", 20.0, 0.0, 200.0, 1.0, "W", "Heat it gives what touches it")],
		description: "A flat heating pad (toy module). It warms what rests on it.", anchor: "the middle of its top", material: "steel"
	}))
	register(new ItemType("toy-cube", "Toy wax cube", "Blocks & shapes", build_cube, {
		module: "toy",
		props: [new Prop("size", "Size", 0.03, 0.01, 0.1, 0.005, "m"), new Prop("lift", "Lift", 0.0, 0.0, 2.0, 0.05, "× weight", "A steady upward push")],
		links: [new Link("heater", "Heater", { types: ["toy-heater"], help: "The pad that heats it" })],
		readouts: [new Readout("temperature", "Temperature", { unit: "°C", digits: 1 }), new Readout("melted", "Melted", { unit: "", digits: 2 })],
		description: "A wax cube that melts on a heater pad (toy module).", material: "toy wax"
	}))
}

function build_heater(c, P) {
	const w = P.width
	c.slab("pad", w, 0.01, 0.1, 0.0, -0.005, { look: "steel" })
}

function build_cube(c, P) {
	const s = P.size
	const sid = c.slab("wax", s, s, s)
	const heater = c.link("heater")
	const power = heater ? F.props_of(c.sb.scene_items.get(heater)).power : 0.0
	c.process("toy-melt", "melt", {
		solid: sid, heater: heater ? `${heater}/pad` : null, power,
		mass: F.py.pyRound(900.0 * s * s * s, 6), start: c.settings.room_temp, melt: 58.0, heat: 2500.0, latent: 210000.0
	})
	if (P.lift > 0) c.process("toy-lift", "lift", { solid: sid, share: P.lift })
}

const trim = (v) => F.py.fmtF(v, 2).replace(/0+$/, "").replace(/\.$/, "")

export const plugin = {
	title: "Toy heat (framework test)",
	howto: "A toy-cube melts on the toy-heater it is LINKED to (props.heater = the pad's item id) while it rests on it: put the cube on the pad and link them.",
	prompt: { plan: "To melt a toy cube, set its heater link to the pad it sits on.", edit: "A toy cube's heater link names its pad." },
	goals: [
		{
			kind: "toy_melts",
			aliases: ["toy_melt", "melts_toy"],
			fields: { item: "item", before_s: "number?" },
			about: "toy_melts {item, before_s?}: the toy cube melts completely (by before_s if given)",
			label: (g, n) => `${n(g.item)} melts${Number.isFinite(g.before_s) ? ` by ${g.before_s} s` : ""}`,
			summarize(ctx, g) {
				if (!ctx.known(g.item)) return null
				const by = ctx.num(g.before_s)
				const t = ctx.first_time(g.item, "melted", (v) => v >= 1)
				const when = by === null ? "" : ` by ${trim(by)} s`
				return { label: F.py.truthy(g.label) ? g.label : `${ctx.name(g.item)} melts${when}`, ok: t !== null && (by === null || t <= by), kind: "toy_melts", item: g.item, t: t === null ? null : F.py.pyRound(t, 3) }
			},
			sample: (scene, pick) => {
				const cubes = scene.items.filter((i) => i.type === "toy-cube")
				return cubes.length ? { kind: "toy_melts", item: pick(cubes).id, ...(pick([true, false]) ? { before_s: 2.5 } : {}) } : null
			}
		}
	],
	knobs: [
		{ type: "toy-heater", key: "power", how: "rel", more: "turn {it} up", less: "turn {it} down", why: "more power melts the cube sooner" },
		{ type: "toy-cube", key: "heater", how: "link", more: "link {it} to another pad", less: "link {it} to another pad", why: "only its linked pad heats it" }
	],
	digest: (item, run) => (item.type === "toy-cube" && !item.props?.heater ? ["not linked to a heater: it never warms"] : null),
	words: { change: (type, key, a, b, nameOf) => (type === "toy-cube" && key === "heater" ? `heater ${a ? nameOf(a) : "none"} → ${b ? nameOf(b) : "none"}` : null) }
}
