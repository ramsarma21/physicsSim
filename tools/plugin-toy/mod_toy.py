"""The plug-in framework's toy module (a test, never in the catalog: tools/plugin-toy/test.mjs registers it by hand). It exercises every
extension point once: a heater pad and a wax cube LINKED to it, a slow process (heat, melting) that sets READINGS, RESIZES the cube as it
melts and says an EVENT, a FORCE (a lift, a fraction of the cube's weight), a GOAL KIND (toy_melts) and the scene's settings.

Real values: paraffin wax melts at 46-68 °C (58 °C here), specific heat 2.14-2.9 kJ/(kg·K) (2.5), latent heat of fusion 200-220 kJ/kg (210),
density 900 kg/m³ (Engineering ToolBox, "Paraffin wax", and CRC Handbook of Chemistry and Physics, 97th ed.). The pad's heat reaches the cube
only while they touch, all of it (a toy: no losses)."""
import math

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "register_goal_kind", "MATERIALS", "props_of")


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    MATERIALS["toy wax"] = dict(density=900, bounce=0.2, friction=0.6, rolling=0.02, side=0.0, look="clay", source="Paraffin wax 900 kg/m³ (Engineering ToolBox).")
    register(ItemType("toy-heater", "Toy heater pad", "Blocks & shapes", build_heater, dynamic=False, module="toy",
                      props=[Prop("width", "Width", 0.12, 0.04, 0.4, 0.01, "m"), Prop("power", "Power", 20.0, 0.0, 200.0, 1.0, "W", "Heat it gives what touches it")],
                      description="A flat heating pad (toy module). It warms what rests on it.", anchor="the middle of its top", material="steel"))
    register(ItemType("toy-cube", "Toy wax cube", "Blocks & shapes", build_cube, module="toy",
                      props=[Prop("size", "Size", 0.03, 0.01, 0.1, 0.005, "m"), Prop("lift", "Lift", 0.0, 0.0, 2.0, 0.05, "× weight", "A steady upward push")],
                      links=[Link("heater", "Heater", types=["toy-heater"], help="The pad that heats it")],
                      readouts=[Readout("temperature", "Temperature", "°C", 1), Readout("melted", "Melted", "", 2)],
                      description="A wax cube that melts on a heater pad (toy module).", material="toy wax"))
    register_goal_kind("toy_melts", goal_melts)


def build_heater(c, P):
    w = P["width"]
    c.slab("pad", w, 0.01, 0.1, 0.0, -0.005, look="steel")


def build_cube(c, P):
    s = P["size"]
    sid = c.slab("wax", s, s, s)
    heater = c.link("heater")
    power = props_of(c.sb.scene_items[heater])["power"] if heater else 0.0
    c.process("toy-melt", "melt", solid=sid, heater=(f"{heater}/pad" if heater else None), power=power,
              mass=round(900.0 * s * s * s, 6), start=c.settings["room_temp"], melt=58.0, heat=2500.0, latent=210000.0)
    if P["lift"] > 0:
        c.process("toy-lift", "lift", solid=sid, share=P["lift"])


def goal_melts(ctx, g):
    """{kind: "toy_melts", item, before_s?}: the cube melts completely (its melted reading reaches 1), by before_s if given."""
    if not ctx.known(g.get("item")):
        return None
    by = ctx.num(g.get("before_s"))
    t = ctx.first_time(g["item"], "melted", lambda v: v >= 1)
    when = "" if by is None else f" by {f'{by:.2f}'.rstrip('0').rstrip('.')} s"
    return {"label": g.get("label") or f"{ctx.name(g['item'])} melts{when}", "ok": t is not None and (by is None or t <= by), "kind": "toy_melts",
            "item": g["item"], "t": None if t is None else round(t, 3)}
