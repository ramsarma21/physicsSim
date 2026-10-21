/**
 * Heat's water in the liquids module's containers (modules/fluids.ts): ONE water and ONE level. A heat water record with `frame: "world"`
 * (machines/mod_heat.py heat_hook: a water-tank's, a beaker's, a measuring jug's water) reads its surface from the liquids module (what
 * floats or stands in it raises it), and what heat adds to that water or takes from it goes to the container's liquid too: the melt water of
 * ice floating or standing in it (as the ice's body shrinks, so the level holds while floating ice melts), evaporation and boiling, dew
 * running in, salt dissolving. So level_mm, volume_ml, buoyancy and the view follow heat's water. The liquids module's state is changed
 * the way flow's pours change it (its RegionState volumes, worked into levels on its next step).
 */
import type { RegionState } from "#sim/fluids.ts"
import { liquidsIn } from "#sim/modules/fluids.ts"
import type { SimScene } from "#sim/part.ts"

/**
 * m³ that one kg of table salt adds to the water it dissolves in: the apparent molar volume of NaCl at infinite dilution, 16.6 cm³/mol at
 * 25 °C (Millero, Chem. Rev. 71, 147 (1971), Table: V̄°(NaCl) 16.61), over its molar mass 58.44 g/mol. (The crystal took 27.0 cm³/mol: a
 * pile that dissolves under water lowers the level a little, as it does.)
 */
export const SALT_VOLUME = 16.61e-6 / 0.05844

/** The liquids module's container of this item in this run, or undefined (no such container, or no liquids module in the scene). */
export const regionOf = (scene: object, item: string): RegionState | undefined =>
	liquidsIn(scene as SimScene<string>)?.regions.find((st) => st.region.item === item || st.region.id === item)

/** The container's surface now (world y): the top of its highest layer that holds liquid; its floor when it is empty. */
export const surfaceOf = (st: RegionState): number => {
	for (let i = st.volumes.length - 1; i >= 0; i--) if ((st.volumes[i] as number) > 0) return (st.tops[i] as number) ?? st.region.floor
	return st.region.floor
}

/**
 * Adds v m³ of liquid to a container (into its highest layer that holds any, else its bottom one); v < 0 takes it away from the top layer
 * down, never below empty. The liquids module works the new volumes into its levels (and spills what passes the rim) on its next step.
 */
export const changeLiquid = (st: RegionState, v: number) => {
	if (!(Math.abs(v) > 0) || !Number.isFinite(v) || st.volumes.length === 0) return
	if (v > 0) {
		let i = st.volumes.length - 1
		while (i > 0 && !((st.volumes[i] as number) > 0)) i--
		st.volumes[i] = (st.volumes[i] as number) + v
		return
	}
	let take = -v
	for (let i = st.volumes.length - 1; i >= 0 && take > 0; i--) {
		const t = Math.min(st.volumes[i] as number, take)
		st.volumes[i] = (st.volumes[i] as number) - t
		take -= t
	}
}
