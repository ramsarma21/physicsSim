/**
 * Light in the machine plane (the optics module's core): a deterministic 2D ray tracer with real units.
 *
 * Model. Light travels in the machine plane (z = 0) as ray tubes. A source (laser pointer, flashlight, lamp, the sun) sends a fan of
 * rays; each ray carries a spectrum of 8 bands (7 visible colours and the near infrared), in watts. Rays go straight in a uniform medium,
 * meet the bodies of the scene (each body is a convex or CSG outline in the plane: an intersection of half-planes, discs and holes) and
 * are, by the body's optical role:
 *   - absorbed by an opaque body (its absorptance per band; the rest is scattered diffusely, which light sensors facing it can see),
 *   - reflected by a mirror face (reflectance per band; specular: angle in = angle out) [HEC ch. 4],
 *   - refracted and partly reflected at a dielectric (glass, water, ice, acrylic): Snell's law and the unpolarised Fresnel equations,
 *     total internal reflection past the critical angle; the index depends on the wavelength (Sellmeier / Cauchy fits below), so white
 *     light splits into its colours at the first refracting surface (a prism's rainbow; a lens's small colour fringes); light is absorbed
 *     inside a medium by Beer-Lambert (water and ice drink the infrared) [HEC ch. 4],
 *   - filtered by a colour filter (transmission per band), or diffused by a translucent sheet (part goes on, spread out).
 * The tracer is exact 2D geometry; to give real 3D powers it also follows each tube's out-of-plane height (z) with paraxial optics: a
 * point source's tube grows in z as it travels (so the power a small target catches falls as 1/d², the inverse-square law), a round lens
 * or round mirror focuses it in z as in the plane (Coddington's sagittal equation), a collimated beam keeps its height. A body of depth D
 * catches the part of a tube within |z| < D/2 (the rest is taken to pass beside it, out of the plane, and is not followed: the side
 * view's 2D world, where every body meets the light that reaches it in the plane).
 *
 * Outputs (per evaluation, for one set of poses): the beams (segments, for drawing), the power each body catches and absorbs (W, per
 * band; heat for the thermal module), each light sensor's illuminance (lux, from the CIE photopic curve) and irradiance (W/m²), each solar
 * panel's light and electric power, each screen's lit and shadowed stretches, and which source's light reaches which body.
 *
 * Determinism: only + − × ÷, Math.sqrt (exactly rounded in every engine), Math.abs/min/max/floor/round and this file's own sin, cos
 * and exp (Taylor series after exact range reduction): the same bits in node, in every browser and in the 3D view, which traces the same
 * beams from this file (web/sim/optics.js is its JavaScript build) without the engine's math substitution.
 *
 * Units: metres, radians (counter-clockwise), watts, seconds; wavelengths in nanometres.
 *
 * Sources (keys as cited in comments):
 *   [HEC] Hecht E., Optics, 5th ed., Pearson 2017. [SCHOTT] SCHOTT optical glass data sheets N-BK7 and F2 (Sellmeier coefficients).
 *   [CRC] CRC Handbook of Chemistry and Physics, "Index of refraction of water" (20 °C: nC 1.33110, nD 1.33299, nF 1.33712).
 *   [CIE] CIE 1924 photopic luminous efficiency V(λ) (CIE 018:2019; ISO/CIE 23539:2023), Km = 683 lm/W; CIE 015:2004 illuminant A.
 *   [ASTM] ASTM G173-03 reference solar spectra, AM1.5 global (1000 W/m²). [CIDDOR] Ciddor P.E., Appl. Opt. 35, 1566 (1996) (air).
 *   [PF] Pope R.M., Fry E.S., Appl. Opt. 36, 8710 (1997) (pure water absorption 380-700 nm). [HQ] Hale G.M., Querry M.R., Appl. Opt. 12,
 *   555 (1973) (water in the infrared). [WB] Warren S.G., Brandt R.E., J. Geophys. Res. 113, D14220 (2008) (ice). [HOBBS] Hobbs P.V.,
 *   Ice Physics (1974): ice Ih nD 1.3098. [IES] IES Lighting Handbook (a 100 W incandescent lamp: 10 % light, 72 % infrared, 18 %
 *   conduction/convection). [SCHUBERT] Schubert E.F., Light-Emitting Diodes, 2nd ed. (white LED spectra, luminous efficacy of
 *   radiation 300-350 lm/W). [BASS] Bass M. (ed.), Handbook of Optics vol. IV (metal mirror reflectance). [GREEN] Green M.A., Solar Cells
 *   (1982) (silicon spectral response). [IEC60825] IEC 60825-1 laser classes (class 2: ≤ 1 mW, class 3R: ≤ 5 mW visible).
 *   [QF] Quan X., Fry E.S., Appl. Opt. 34, 3477 (1995) (sea water's index: 1.3394 at 35 ‰, 20 °C, 589 nm). [CODEX] Codex Standard 210 (named
 *   vegetable oils: soybean nD 1.466-1.470 at 40 °C). [ICUMSA] ICUMSA refractive index tables of sucrose solutions (80 %: 1.4901 at 20 °C).
 *   [CHATAWAY] Chataway H.D., Can. J. Res. 6, 532 (1932) (honey's index by its water: 18 % → 1.4910). Liquids in containers: the liquids
 *   module's (machines/mod_fluids.py) layers, each a dielectric body whose surface follows the module's level readings (withLevels).
 */

// ------------------------------------------------------------------ deterministic elementary functions

const PIO2_HI = 1.5707963267341256 // the first 33 bits of π/2 (fdlibm's pio2_1): k·PIO2_HI is exact for |k| < 2^20
const PIO2_LO = 6.077100506506192e-11 // π/2 − PIO2_HI (fdlibm's pio2_1t)
const INV_PIO2 = 0.6366197723675814
export const PI = 3.141592653589793

/** sin and cos of a (radians) from + − × ÷ alone: a reduced by the nearest multiple of π/2 (Cody-Waite, two constants), then Taylor
 *  series on |r| ≤ π/4 (to r^15 and r^16: the next terms are below 5e-17). Within an ulp or two of the true values; the same bits everywhere. */
export const sincos = (a: number): [number, number] => {
	if (!Number.isFinite(a)) return [NaN, NaN]
	const k = Math.round(a * INV_PIO2)
	const r = a - k * PIO2_HI - k * PIO2_LO
	const r2 = r * r
	const s =
		r *
		(1 +
			r2 *
				(-1 / 6 +
					r2 *
						(1 / 120 +
							r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000))))))))
	const c =
		1 +
		r2 *
			(-1 / 2 +
				r2 *
					(1 / 24 +
						r2 *
							(-1 / 720 +
								r2 * (1 / 40320 + r2 * (-1 / 3628800 + r2 * (1 / 479001600 + r2 * (-1 / 87178291200 + r2 * (1 / 20922789888000))))))))
	const q = ((k % 4) + 4) % 4
	if (q === 0) return [s, c]
	if (q === 1) return [c, -s]
	if (q === 2) return [-s, -c]
	return [-c, s]
}

const LN2_HI = 6.93147180369123816490e-1
const LN2_LO = 1.90821492927058770002e-10
const INV_LN2 = 1.4426950408889634

/** e^x from + − × ÷ alone (x = k ln 2 + r, |r| ≤ ln2/2, Taylor to r^14, times 2^k by exact halvings/doublings). */
export const exp = (x: number): number => {
	if (Number.isNaN(x)) return NaN
	if (x < -745) return 0
	if (x > 709) return Infinity
	const k = Math.round(x * INV_LN2)
	const r = x - k * LN2_HI - k * LN2_LO
	let t = 1 / 87178291200 // 1/14!
	for (let n = 13; n >= 1; n--) t = 1 / factorial(n) + r * t
	let e = 1 + r * t
	let p = k < 0 ? -k : k
	let b = k < 0 ? 0.5 : 2
	while (p > 0) {
		if (p & 1) e *= b
		b *= b
		p >>= 1
	}
	return e
}
const FACT: number[] = [1]
for (let n = 1; n <= 20; n++) FACT.push((FACT[n - 1] as number) * n)
function factorial(n: number) {
	return FACT[n] as number
}

// ------------------------------------------------------------------ the spectrum: 8 bands

/** The bands every ray carries power in: 7 visible colours (nm ranges) and the near infrared. `nm`: the wavelength a band's own ray
 *  (white light split by a prism) is refracted at: the middle of its range (1000 nm for the infrared, where a lamp's and the sun's
 *  infrared is strongest). */
export const BANDS = [
	{ key: "violet", lo: 380, hi: 450, nm: 415 },
	{ key: "blue", lo: 450, hi: 495, nm: 472.5 },
	{ key: "cyan", lo: 495, hi: 520, nm: 507.5 },
	{ key: "green", lo: 520, hi: 565, nm: 542.5 },
	{ key: "yellow", lo: 565, hi: 590, nm: 577.5 },
	{ key: "orange", lo: 590, hi: 625, nm: 607.5 },
	{ key: "red", lo: 625, hi: 750, nm: 687.5 },
	{ key: "infrared", lo: 750, hi: 2500, nm: 1000 }
] as const
export const NB = 8
export const IR = 7
export type Spectrum = Float64Array

/** The band a wavelength falls in (below 380 nm: violet; past 750 nm: infrared). */
export const bandOf = (nm: number) => {
	for (let b = 0; b < IR; b++) if (nm < (BANDS[b] as { hi: number }).hi) return b
	return IR
}

/** CIE 1924 photopic V(λ) every 10 nm from 380 to 780 nm [CIE]. */
const V10 = [
	0.000039, 0.00012, 0.000396, 0.00121, 0.004, 0.0116, 0.023, 0.038, 0.06, 0.091, 0.139, 0.208, 0.323, 0.503, 0.71, 0.862, 0.954, 0.99495, 0.995, 0.952,
	0.87, 0.757, 0.631, 0.503, 0.381, 0.265, 0.175, 0.107, 0.061, 0.032, 0.017, 0.00821, 0.0041, 0.00209, 0.00105, 0.00052, 0.000249, 0.00012, 0.00006,
	0.00003, 0.000015
]
/** V(λ), linear between the 10 nm values; 0 outside 380-780 nm. */
export const luminousEfficiency = (nm: number) => {
	if (!(nm >= 380) || nm > 780) return 0
	const i = Math.floor((nm - 380) / 10)
	if (i >= 40) return V10[40] as number
	const u = (nm - 380 - 10 * i) / 10
	return (V10[i] as number) * (1 - u) + (V10[i + 1] as number) * u
}
/** Lumens per watt of radiation at the peak of V (555 nm) [CIE]. */
export const KM = 683

/** The mean of f over each band's range, from 1 nm steps (trapezoid; exact for V, which is linear between whole nanometres). */
const bandMeans = (f: (nm: number) => number, bands = IR) => {
	const out = new Float64Array(NB)
	for (let b = 0; b < bands; b++) {
		const { lo, hi } = BANDS[b] as { lo: number; hi: number }
		let s = 0
		for (let nm = lo; nm < hi; nm++) s += (f(nm) + f(nm + 1)) / 2
		out[b] = s / (hi - lo)
	}
	return out
}
/** Each band's mean V (a flat spectrum within the band); 0 for the infrared. */
export const BAND_V = bandMeans(luminousEfficiency)

/** Planck's spectral radiance shape at temperature T (arbitrary scale), λ in nm; c2 = 1.435e-2 m·K as CIE illuminant A defines it [CIE]. */
const planck = (T: number, c2 = 1.435e-2) => (nm: number) => {
	const l = nm * 1e-9
	return 1 / (l * l * l * l * l * (exp(c2 / (l * T)) - 1))
}
/** A Gaussian band (peak nm, full width at half maximum nm). */
const gauss = (peak: number, fwhm: number) => (nm: number) => {
	const s = fwhm / 2.3548200450309493
	const d = (nm - peak) / s
	return exp(-0.5 * d * d)
}

/** A spectrum's visible shape: weights over the 7 visible bands summing to 1 (power fractions), from a spectral density f(nm). */
const visibleShape = (f: (nm: number) => number) => {
	const m = bandMeans(f)
	let sum = 0
	for (let b = 0; b < IR; b++) sum += (m[b] as number) * ((BANDS[b] as { hi: number }).hi - (BANDS[b] as { lo: number }).lo)
	const w = new Float64Array(NB)
	for (let b = 0; b < IR; b++) w[b] = ((m[b] as number) * ((BANDS[b] as { hi: number }).hi - (BANDS[b] as { lo: number }).lo)) / sum
	return w
}

/**
 * The light kinds a source may give: a visible shape (fractions over the 7 visible bands) and the infrared it gives per watt of visible.
 *   white: equal energy per nm (a reference). sun: a 5778 K blackbody's shape over 380-750 nm, and at the ground (AM1.5 global) 0.465 W of
 *   infrared past 750 nm for 0.50 W in 380-750 nm (the ~3.5 % below 380 nm is left out) [ASTM]. incandescent: CIE illuminant A (2856 K),
 *   0.82 of the electric power radiated (IES's 100 W lamp: 10 % light + 72 % infrared) [IES]. halogen: a 3000 K blackbody, 0.85 radiated
 *   (provisional). led: a blue die at 450 nm (FWHM 20 nm) and a YAG phosphor at 560 nm (FWHM 120 nm), 4000 K-ish, no infrared to speak of
 *   [SCHUBERT].
 */
export const LIGHTS = {
	white: { shape: visibleShape(() => 1), irPerVisible: 0 },
	sun: { shape: visibleShape(planck(5778, 1.4388e-2)), irPerVisible: 0.465 / 0.5 },
	incandescent: { shape: visibleShape(planck(2856)), irPerVisible: 0 },
	halogen: { shape: visibleShape(planck(3000)), irPerVisible: 0 },
	led: { shape: visibleShape((nm) => gauss(450, 20)(nm) + 0.62 * gauss(560, 120)(nm)), irPerVisible: 0 },
	// one-colour LEDs (a coloured torch's, a circuit's indicator LED): a single emission band, peak and full width at half maximum, no
	// infrared [SCHUBERT] (AlGaInP red 640 nm 20 nm wide, amber 590 nm 15 nm; InGaN green 525 nm 35 nm, blue 465 nm 25 nm; typical)
	"led-red": { shape: visibleShape(gauss(640, 20)), irPerVisible: 0 },
	"led-yellow": { shape: visibleShape(gauss(590, 15)), irPerVisible: 0 },
	"led-green": { shape: visibleShape(gauss(525, 35)), irPerVisible: 0 },
	"led-blue": { shape: visibleShape(gauss(465, 25)), irPerVisible: 0 }
} as const
export type LightKind = keyof typeof LIGHTS

/** Luminous efficacy of a visible shape (lm per W of 380-750 nm radiation). */
export const efficacy = (shape: Spectrum) => {
	let s = 0
	for (let b = 0; b < IR; b++) s += (shape[b] as number) * (BAND_V[b] as number)
	return KM * s
}

/**
 * A source's radiant spectrum (W per band) from what a lesson states:
 *   lumens (a flashlight's or a lamp's rated light) + the light kind, or visible watts; `infrared` W (for a filament lamp: its radiated
 *   share of the electric power less the visible; for the sun, from the kind); or one wavelength (a laser: all its power in its band).
 */
export const sourceSpectrum = (o: { kind: LightKind; lumens?: number; visible?: number; infrared?: number }): Spectrum => {
	const L = LIGHTS[o.kind]
	const visible = o.visible ?? (o.lumens ?? 0) / efficacy(L.shape)
	const s = new Float64Array(NB)
	for (let b = 0; b < IR; b++) s[b] = (L.shape[b] as number) * visible
	s[IR] = o.infrared ?? visible * L.irPerVisible
	return s
}

// ------------------------------------------------------------------ media: refractive index and absorption

interface MediumData {
	readonly words: string
	/** n(λ in µm) */
	readonly n: (um: number) => number
	/** Absorption coefficient per band, 1/m (Beer-Lambert: power × e^(−αL)). */
	readonly alpha: readonly number[]
}
const sellmeier = (B: readonly number[], C: readonly number[]) => (um: number) => {
	const l2 = um * um
	let s = 1
	for (let i = 0; i < B.length; i++) s += ((B[i] as number) * l2) / (l2 - (C[i] as number))
	return Math.sqrt(s)
}
const cauchy = (A: number, Bc: number) => (um: number) => A + Bc / (um * um)
/** A liquid with nD at 589.3 nm and water's dispersion (its Cauchy fit below, shifted): oils and syrups spread colours a little more than
 *  water does (Abbe ≈ 40-55 against water's 56), left out here (provisional). */
const WATER_A = 1.32378
const WATER_B = 0.003151
const likeWater = (nD: number) => {
	const shift = nD - (WATER_A + WATER_B / (0.5893 * 0.5893))
	return (um: number) => WATER_A + WATER_B / (um * um) + shift
}

/** Air at 20 °C, 101.3 kPa: n = 1.00027 [CIDDOR]; its dispersion (3e-6 across the visible) is left out, so light in air does not split. */
export const N_AIR = 1.00027

export const MEDIA: Readonly<Record<string, MediumData>> = {
	/** SCHOTT N-BK7 (crown): nd 1.5168, Abbe 64.2 [SCHOTT]; internal transmittance ≥ 0.998 per 10 mm 400-1500 nm. */
	"crown glass": {
		words: "crown glass",
		n: sellmeier([1.03961212, 0.231792344, 1.01046945], [0.00600069867, 0.0200179144, 103.560653]),
		alpha: [0.3, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.5]
	},
	/** SCHOTT F2 (flint): nd 1.62004, Abbe 36.4: twice crown glass's spread of colours (the classic rainbow prism) [SCHOTT]. */
	"flint glass": {
		words: "flint glass",
		n: sellmeier([1.34533359, 0.209073176, 0.937357162], [0.00997743871, 0.0470450767, 111.886764]),
		alpha: [0.5, 0.3, 0.2, 0.2, 0.2, 0.2, 0.2, 0.5]
	},
	/** PMMA (acrylic): nd 1.4917, Abbe 57.4: Cauchy through those (provisional fit); it absorbs past 1.1 µm (infrared band 30/m, provisional). */
	acrylic: { words: "acrylic", n: cauchy(1.47871, 0.004484), alpha: [0.5, 0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 30] },
	/** PET (a bottle's plastic): nD 1.575, Abbe ~36 (provisional fit). */
	PET: { words: "PET plastic", n: cauchy(1.55059, 0.00842), alpha: [1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 30] },
	/** Water at 20 °C: Cauchy through nC 1.33110 and nF 1.33712 [CRC] (gives nD 1.33285, 1.33299 measured); absorption 380-750 nm from
	 *  Pope & Fry [PF] (band means), the infrared band 40/m (0.36/cm at 1 µm, 1/cm at 1.2 µm, 30/cm at 1.45 µm [HQ]: a band mean
	 *  for a lamp's and the sun's infrared, provisional). */
	water: { words: "water", n: cauchy(WATER_A, WATER_B), alpha: [0.006, 0.012, 0.035, 0.062, 0.08, 0.22, 0.9, 40] },
	/** Ice Ih: nD 1.3098 [HOBBS], dispersion taken as water's; absorption like water's (clearer in the visible) [WB] (provisional). */
	ice: { words: "ice", n: cauchy(1.30116, 0.003), alpha: [0.01, 0.01, 0.02, 0.04, 0.06, 0.15, 0.6, 40] },
	// the liquids module's liquids (machines/mod_fluids.py LIQUIDS, at 20 °C): their nD with water's dispersion (likeWater), absorption as
	// noted (the liquids are clear in a tank's few decimetres unless said)
	/** Salt water: nD by its salt (saltWaterND below: 1.3330 + 0.00176 per mass % NaCl, 1.3392 at 3.5 %, 1.3787 saturated) [CRC][QF]; a body
	 *  gives its own nD (BodyRecord.nd); water's absorption. */
	"salt water": { words: "salt water", n: likeWater(1.35057), alpha: [0.006, 0.012, 0.035, 0.062, 0.08, 0.22, 0.9, 40] },
	/** Sea water (35 g/kg, 20 °C): nD 1.3394 [QF]; water's absorption. */
	"sea water": { words: "sea water", n: likeWater(1.3394), alpha: [0.006, 0.012, 0.035, 0.062, 0.08, 0.22, 0.9, 40] },
	/** Soybean / canola oil: nD 1.4735 at 20 °C (Codex Stan 210: 1.466-1.470 at 40 °C, +0.00035/K below) [CODEX]; yellow: it drinks violet and
	 *  blue (provisional band coefficients), the infrared past 1.1 µm (C-H overtones, provisional). */
	"vegetable oil": { words: "vegetable oil", n: likeWater(1.4735), alpha: [40, 12, 3, 1, 0.5, 0.5, 0.5, 20] },
	/** Light corn syrup (about 80 % sugars): nD ≈ 1.49 (a sucrose solution of 80 % is 1.4901 [ICUMSA]) (approximate); clear (provisional). */
	"corn syrup": { words: "corn syrup", n: likeWater(1.49), alpha: [3, 1, 0.5, 0.3, 0.3, 0.3, 0.5, 40] },
	/** Honey with 18 % water: nD 1.4910 [CHATAWAY] (Chataway's table, AOAC 969.38); amber: it drinks violet and blue (provisional). */
	honey: { words: "honey", n: likeWater(1.491), alpha: [200, 80, 30, 10, 5, 3, 2, 40] },
	/** Liquid dish soap (mostly water with 20-30 % surfactants): nD ≈ 1.37 (provisional); green dye: violet, blue, red absorbed (provisional). */
	"dish soap": { words: "dish soap", n: likeWater(1.37), alpha: [30, 20, 5, 1, 5, 20, 40, 40] },
	/** Rubbing alcohol, 70 % isopropanol in water: nD ≈ 1.372 (isopropanol 1.3776, water 1.3330 [CRC]; approximate); clear. */
	"rubbing alcohol": { words: "rubbing alcohol", n: likeWater(1.372), alpha: [0.006, 0.012, 0.035, 0.062, 0.08, 0.22, 0.9, 30] }
}
export type MediumKey = keyof typeof MEDIA

/** n of a medium at a wavelength (nm); 0 or less: the band's own. */
const nAt = (m: MediumData | undefined, nm: number) => (m === undefined ? N_AIR : m.n(nm / 1000))

/** Salt water's nD at 20 °C by its salt (mass % NaCl, 0-26): 1.33299 + 0.001757·w (a straight line through water's 1.33299 [CRC], sea water's
 *  1.3394 at 3.5 % [QF] and saturated brine's ≈ 1.3787 at 26 % [CRC]), within about 0.001 of the CRC table. */
export const saltWaterND = (pct: number) => 1.33299 + 0.001757 * Math.min(26, Math.max(0, pct))

/** A body's medium: the record's (MEDIA), or with the body's own nD (a salt water's, by its salt), water-like dispersion kept. */
const OWN_ND = new WeakMap<OpticBody, MediumData>()
const mediumOfBody = (b: OpticBody): MediumData | undefined => {
	const m = MEDIA[b.medium ?? ""]
	if (m === undefined || b.nd === undefined || !Number.isFinite(b.nd)) return m
	let own = OWN_ND.get(b)
	if (own === undefined) {
		const shift = (b.nd as number) - m.n(0.5893)
		own = { words: m.words, n: (um: number) => m.n(um) + shift, alpha: m.alpha }
		OWN_ND.set(b, own)
	}
	return own
}

/**
 * The medium light is in, from the dielectrics it is inside (innermost last): the innermost SOLID one (glass, ice, acrylic) wins; inside
 * liquids alone, the liquid of the highest rank (a container's upper layer: its body reaches a hair into the one above it, so the two
 * meet at the upper's bottom face). A liquid reaches a hair into its container's walls and floor too, so light leaves a wall straight
 * into the water and stops on an opaque floor (the solid wins where they overlap). Lists without liquids: the innermost, as always.
 */
const mediumIndex = (inside: readonly number[], bodies: readonly WBody[]) => {
	let best = -1
	let rank = -Infinity
	for (let i = inside.length - 1; i >= 0; i--) {
		const k = inside[i] as number
		const r = (bodies[k] as WBody).src.liquid
		if (r === undefined) return k
		if (r > rank) {
			rank = r
			best = k
		}
	}
	return best
}
const mediumIn = (inside: readonly number[], bodies: readonly WBody[]) => {
	const k = mediumIndex(inside, bodies)
	return k < 0 ? undefined : mediumOfBody((bodies[k] as WBody).src)
}

// ------------------------------------------------------------------ surfaces and bodies

/** One piece of a body's outline in its own frame: a half-plane (inside where nx·x + ny·y ≤ d; (nx, ny) the unit outward normal), a
 *  disc (inside |p − c| ≤ r) or a hole (outside it). `sph`: a surface of revolution about the element's axis (a round lens's or a round
 *  mirror's face), which focuses out of the plane as in it. */
export type Prim =
	| { readonly k: "half"; readonly nx: number; readonly ny: number; readonly d: number }
	| { readonly k: "disk" | "hole"; readonly cx: number; readonly cy: number; readonly r: number; readonly sph?: boolean }

export type Role = "opaque" | "glass" | "mirror" | "filter" | "translucent" | "sensor" | "panel" | "screen"

/** A body as the light sees it (all in its solid's own frame; the pose moves it). */
export interface OpticBody {
	/** The solid it is (its pose comes from there) and its item. */
	readonly id: string
	readonly item: string
	readonly role: Role
	/** The outline: the intersection of these. */
	readonly prims: readonly Prim[]
	/** Half its out-of-plane depth, m: how much of a tube's height it catches. */
	readonly halfDepth: number
	/** A dielectric's medium (role "glass"). */
	readonly medium?: string
	/** The faces (prim indices) that do the role's work: a mirror's reflecting faces, a sensor's, a panel's or a screen's light-taking face;
	 *  the other faces are opaque (a mirror's painted back, a meter's housing). Every face when not given. */
	readonly faces?: readonly number[]
	/** Per band: a mirror's reflectance, a filter's transmittance, a panel's electric efficiency, an opaque surface's absorptance. */
	readonly reflect?: ArrayLike<number>
	readonly pass?: ArrayLike<number>
	readonly efficiency?: ArrayLike<number>
	readonly absorb: ArrayLike<number>
	/** A translucent sheet: the share of the light that goes on (spread out over ±blur rad). */
	readonly transmit?: number
	readonly blur?: number
	/** A round element (a lens or round mirror seen edge-on): its axis (point and direction, own frame) and its radius out of the plane. */
	readonly aperture?: { readonly cx: number; readonly cy: number; readonly ax: number; readonly ay: number; readonly r: number }
	/** A sensor's light-taking window: half its width along the face, about the face's middle (the rest of the face is housing); none: the
	 *  whole face. Its depth out of the plane is 2 × halfDepth. */
	readonly window?: number
	/** Its record's index in the optics record's bodies (a solid may have several bodies: a meter's window and its housing). */
	readonly tag?: number
	/** A dielectric's own nD (salt water by its salt): its medium's dispersion, shifted to this. */
	readonly nd?: number
	/** A liquid (a container's layer): its rank among liquids (an upper layer's is higher). See mediumIndex. */
	readonly liquid?: number
	/** A surface that follows another module's reading (a liquid's top: the liquids module's level): see withLevels. */
	readonly level?: LevelRule
}

/**
 * How a liquid's outline (a slab: prims right, top, left, bottom) follows the liquids module's readings of its container `item`: its top at
 * `floor` (own frame) + reading(`top`) mm + `up`, its bottom at `floor` + reading(`bottom`) mm (a layer resting on the one below); a
 * reading not there yet keeps the record's own outline.
 */
export interface LevelRule {
	readonly item: string
	readonly top?: string
	readonly bottom?: string
	readonly floor: number
	readonly up: number
}

/** The bodies with every liquid's surfaces where the readings put them now (the engine: ctx.get; the view: the track at a time). */
export const withLevels = (bodies: readonly OpticBody[], read: (item: string, key: string) => number | null | undefined): OpticBody[] =>
	bodies.map((b) => {
		const L = b.level
		if (L === undefined || b.prims.length < 4) return b
		const top = L.top === undefined ? undefined : read(L.item, L.top)
		const bot = L.bottom === undefined ? undefined : read(L.item, L.bottom)
		const hasTop = typeof top === "number" && Number.isFinite(top)
		const hasBot = typeof bot === "number" && Number.isFinite(bot)
		if (!hasTop && !hasBot) return b
		const prims = b.prims.slice()
		if (hasTop) prims[1] = { k: "half", nx: 0, ny: 1, d: L.floor + (top as number) / 1000 + L.up }
		if (hasBot) prims[3] = { k: "half", nx: 0, ny: -1, d: -(L.floor + (bot as number) / 1000) }
		return { ...b, prims }
	})

/** The readings the liquids' surfaces follow, now (one number each: top then bottom per liquid body), to tell when they move. */
export const levelReadings = (bodies: readonly OpticBody[], read: (item: string, key: string) => number | null | undefined): number[] => {
	const out: number[] = []
	for (const b of bodies) {
		const L = b.level
		if (L === undefined) continue
		for (const key of [L.top, L.bottom]) {
			const v = key === undefined ? undefined : read(L.item, key)
			out.push(typeof v === "number" && Number.isFinite(v) ? v : Number.NaN)
		}
	}
	return out
}

export type SourceKind = "laser" | "flashlight" | "lamp" | "sun"

/** A light source, attached to a solid (its housing) and moving with it. */
export interface OpticSource {
	readonly id: string
	readonly item: string
	/** The solid it is fixed to, or "" for the world. */
	readonly solid: string
	readonly kind: SourceKind
	/** Where the light leaves (own frame of the solid) and its direction (rad, own frame), or a direction vector (unit, own frame). */
	readonly x: number
	readonly y: number
	readonly dir: number
	readonly dirVec?: { readonly x: number; readonly y: number }
	/** In-plane half-angle of the fan (rad); 0 for a beam (laser, sun). */
	readonly spread: number
	/** Out-of-plane half-angle (rad): a round flashlight's = its spread; a bare bulb's π/2. */
	readonly outSpread: number
	/** A round cone (a flashlight, a lamp's round shade): its rays' out-of-plane spread narrows toward the fan's edges (a cone's chord, from
	 *  cos ψmax = cos θ / cos α) and their power with it, so the cone carries a uniform intensity; false: the same spread for every ray
	 *  (a bare bulb, which lights a sphere). */
	readonly round?: boolean
	/** The emitter's half-size (m): a reflector's radius, a laser beam's radius, half the width of a band of sunlight. */
	readonly size: number
	/** The angular radius of the source as seen by what it lights (rad): the sun's 4.65 mrad, a laser's divergence. */
	readonly blur: number
	/** W per band; for the sun, W per m² across the beam (irradiance). */
	readonly power: Spectrum
	/** One wavelength (nm) for a laser: its rays never split; 0 for broad light. */
	readonly nm: number
	/** sunlight: rays start this far behind the source point, up-sun (m) */
	readonly back?: number
	/** Base rays across the fan (more are added where neighbours part ways). */
	readonly rays: number
}

export interface Pose {
	readonly x: number
	readonly y: number
	readonly angle: number
}

// ------------------------------------------------------------------ world geometry (per evaluation)

const HALF = 0
const DISK = 1
const HOLE = 2
/** A prim placed in the world: kind, then (nx, ny, d) or (cx, cy, r), and whether it is a surface of revolution. */
interface WPrim {
	k: number
	a: number
	b: number
	c: number
	sph: boolean
}
interface WBody {
	readonly src: OpticBody
	readonly index: number
	readonly prims: WPrim[]
	/** bounding circle */
	bx: number
	by: number
	br: number
	/** pose and its rotation */
	ox: number
	oy: number
	ca: number
	sa: number
	faces: Uint8Array
	/** aperture in the world: axis point, unit axis */
	apx: number
	apy: number
	aax: number
	aay: number
}

const place = (b: OpticBody, index: number, pose: Pose): WBody => {
	const [sa, ca] = sincos(pose.angle)
	const prims: WPrim[] = []
	let bx = 0
	let by = 0
	let br = 0
	// bounding circle: from the discs and from the half-planes' polygon corners (found below)
	const halves: { nx: number; ny: number; d: number }[] = []
	for (const p of b.prims) {
		if (p.k === "half") {
			const nx = ca * p.nx - sa * p.ny
			const ny = sa * p.nx + ca * p.ny
			prims.push({ k: HALF, a: nx, b: ny, c: p.d + nx * pose.x + ny * pose.y, sph: false })
			halves.push(p)
		} else {
			const cx = pose.x + ca * p.cx - sa * p.cy
			const cy = pose.y + sa * p.cx + ca * p.cy
			prims.push({ k: p.k === "disk" ? DISK : HOLE, a: cx, b: cy, c: p.r, sph: p.sph === true })
		}
	}
	// local bound: a disc's own circle bounds the body when it has one (the intersection is inside it); else the half-planes' corners
	let lx = 0
	let ly = 0
	let lr = Infinity
	for (const p of b.prims) {
		if (p.k !== "disk") continue
		if (p.r < lr) {
			lr = p.r
			lx = p.cx
			ly = p.cy
		}
	}
	if (halves.length >= 3) {
		const pts = corners(halves)
		if (pts.length > 0) {
			let cx = 0
			let cy = 0
			for (const q of pts) {
				cx += q[0]
				cy += q[1]
			}
			cx /= pts.length
			cy /= pts.length
			let r = 0
			for (const q of pts) r = Math.max(r, Math.sqrt((q[0] - cx) * (q[0] - cx) + (q[1] - cy) * (q[1] - cy)))
			if (r < lr) {
				lr = r
				lx = cx
				ly = cy
			}
		}
	}
	if (!Number.isFinite(lr)) lr = 1e3
	bx = pose.x + ca * lx - sa * ly
	by = pose.y + sa * lx + ca * ly
	br = lr * (1 + 1e-9) + 1e-9
	const faces = new Uint8Array(b.prims.length)
	if (b.faces === undefined) faces.fill(1)
	else for (const f of b.faces) if (f >= 0 && f < faces.length) faces[f] = 1
	const ap = b.aperture
	return {
		src: b,
		index,
		prims,
		bx,
		by,
		br,
		ox: pose.x,
		oy: pose.y,
		ca,
		sa,
		faces,
		apx: ap === undefined ? 0 : pose.x + ca * ap.cx - sa * ap.cy,
		apy: ap === undefined ? 0 : pose.y + sa * ap.cx + ca * ap.cy,
		aax: ap === undefined ? 0 : ca * ap.ax - sa * ap.ay,
		aay: ap === undefined ? 0 : sa * ap.ax + ca * ap.ay
	}
}

/** The corners of the convex polygon the half-planes cut (each pair's crossing that every other half-plane keeps). */
const corners = (h: readonly { nx: number; ny: number; d: number }[]) => {
	const out: [number, number][] = []
	for (let i = 0; i < h.length; i++)
		for (let j = i + 1; j < h.length; j++) {
			const p = h[i] as { nx: number; ny: number; d: number }
			const q = h[j] as { nx: number; ny: number; d: number }
			const det = p.nx * q.ny - p.ny * q.nx
			if (Math.abs(det) < 1e-12) continue
			const x = (p.d * q.ny - p.ny * q.d) / det
			const y = (p.nx * q.d - p.d * q.nx) / det
			let inside = true
			for (const r of h) if (r.nx * x + r.ny * y > r.d + 1e-9) inside = false
			if (inside) out.push([x, y])
		}
	return out
}

// ------------------------------------------------------------------ ray against body (CSG intervals)

const EPS = 1e-9 // m: a crossing nearer than this to a ray's start is the one it starts on
const FAR = 1e3 // m: a ray that meets nothing ends this far away
// interval scratch (the intersection of the prims' inside-intervals along the ray): start t, end t, start prim, end prim
const IA = new Float64Array(64)
const IB = new Float64Array(64)
const IPA = new Int32Array(64)
const IPB = new Int32Array(64)
const JA = new Float64Array(64)
const JB = new Float64Array(64)
const JPA = new Int32Array(64)
const JPB = new Int32Array(64)

/** The first crossing of body w's outline along o + t·d with t > EPS (and t < best): t, the prim, and whether the ray enters there;
 *  or t = Infinity. Tangent grazes (an inside stretch shorter than EPS) are not crossings. */
const crossing = (w: WBody, ox: number, oy: number, dx: number, dy: number, best: number, out: Hit) => {
	// bounding circle first
	const qx = w.bx - ox
	const qy = w.by - oy
	const tc = qx * dx + qy * dy
	const d2 = qx * qx + qy * qy - tc * tc
	if (d2 > w.br * w.br) return false
	const half = Math.sqrt(Math.max(0, w.br * w.br - d2))
	if (tc + half < EPS || tc - half > best) return false
	let n = 1
	IA[0] = -Infinity
	IB[0] = Infinity
	IPA[0] = -1
	IPB[0] = -1
	const prims = w.prims
	for (let p = 0; p < prims.length && n > 0; p++) {
		const pr = prims[p] as WPrim
		if (pr.k === HALF) {
			const den = pr.a * dx + pr.b * dy
			const num = pr.c - (pr.a * ox + pr.b * oy)
			if (den === 0) {
				if (num < 0) n = 0
				continue
			}
			const t = num / den
			let m = 0
			for (let i = 0; i < n; i++) {
				let a = IA[i] as number
				let b = IB[i] as number
				let pa = IPA[i] as number
				let pb = IPB[i] as number
				if (den > 0) {
					if (t < b) {
						b = t
						pb = p
					}
				} else if (t > a) {
					a = t
					pa = p
				}
				if (a < b) {
					IA[m] = a
					IB[m] = b
					IPA[m] = pa
					IPB[m] = pb
					m++
				}
			}
			n = m
		} else {
			const fx = ox - pr.a
			const fy = oy - pr.b
			const B = fx * dx + fy * dy
			const C = fx * fx + fy * fy - pr.c * pr.c
			const disc = B * B - C
			if (pr.k === DISK) {
				if (disc <= 0) {
					n = 0
					continue
				}
				const s = Math.sqrt(disc)
				const t1 = -B - s
				const t2 = -B + s
				let m = 0
				for (let i = 0; i < n; i++) {
					let a = IA[i] as number
					let b = IB[i] as number
					let pa = IPA[i] as number
					let pb = IPB[i] as number
					if (t1 > a) {
						a = t1
						pa = p
					}
					if (t2 < b) {
						b = t2
						pb = p
					}
					if (a < b) {
						IA[m] = a
						IB[m] = b
						IPA[m] = pa
						IPB[m] = pb
						m++
					}
				}
				n = m
			} else {
				if (disc <= 0) continue
				const s = Math.sqrt(disc)
				const t1 = -B - s
				const t2 = -B + s
				let m = 0
				for (let i = 0; i < n; i++) {
					const a = IA[i] as number
					const b = IB[i] as number
					const pa = IPA[i] as number
					const pb = IPB[i] as number
					// (−∞, t1] ∪ [t2, ∞)
					if (a < Math.min(b, t1) && m < 63) {
						const e = Math.min(b, t1)
						JA[m] = a
						JB[m] = e
						JPA[m] = pa
						JPB[m] = e === t1 && t1 < b ? p : pb
						m++
					}
					if (Math.max(a, t2) < b && m < 63) {
						const s2 = Math.max(a, t2)
						JA[m] = s2
						JB[m] = b
						JPA[m] = s2 === t2 && t2 > a ? p : pa
						JPB[m] = pb
						m++
					}
				}
				for (let i = 0; i < m; i++) {
					IA[i] = JA[i] as number
					IB[i] = JB[i] as number
					IPA[i] = JPA[i] as number
					IPB[i] = JPB[i] as number
				}
				n = m
			}
		}
	}
	let found = false
	for (let i = 0; i < n; i++) {
		const a = IA[i] as number
		const b = IB[i] as number
		if (b - a < EPS) continue // a graze
		if (a > EPS && a < best) {
			best = a
			out.t = a
			out.prim = IPA[i] as number
			out.enter = true
			found = true
		} else if (a <= EPS && b > EPS && b < best) {
			best = b
			out.t = b
			out.prim = IPB[i] as number
			out.enter = false
			found = true
		}
	}
	if (found) out.body = w.index
	return found
}

interface Hit {
	t: number
	prim: number
	enter: boolean
	body: number
}

/** Whether a point is inside body w (every prim keeps it). */
const insideBody = (w: WBody, x: number, y: number) => {
	for (const p of w.prims) {
		if (p.k === HALF) {
			if (p.a * x + p.b * y > p.c) return false
		} else {
			const d2 = (x - p.a) * (x - p.a) + (y - p.b) * (y - p.b)
			if (p.k === DISK ? d2 > p.c * p.c : d2 < p.c * p.c) return false
		}
	}
	return true
}

/** The outward unit normal of body w's prim at a point on it. */
const normalAt = (w: WBody, prim: number, x: number, y: number): [number, number] => {
	const p = w.prims[prim] as WPrim
	if (p.k === HALF) return [p.a, p.b]
	const ux = x - p.a
	const uy = y - p.b
	const l = Math.sqrt(ux * ux + uy * uy) || 1
	return p.k === DISK ? [ux / l, uy / l] : [-ux / l, -uy / l]
}

// ------------------------------------------------------------------ the out-of-plane envelope

/**
 * A tube's height out of the plane, followed paraxially as two rays in the (s, z) plane, s along the ray:
 *   kind 0 (a point-like source, the fan of a flashlight or lamp): the marginal ray's z per unit tan ψ (ψ the out-of-plane angle of a
 *   ray of the tube, |tan ψ| ≤ tanΨ, its power weighted by cos ψ over ψ, as a round beam's or a bare bulb's): Y, G = dY/ds;
 *   kind 1 (a beam of finite height: a laser, or any tube a round lens or mirror has cut): the marginal ray's half-height Y and slope G;
 *   kind 2 (sunlight: a beam with no edge out of the plane; the tube's power is then W per metre of height until a round element cuts it).
 * The field ray (Yc, Gc) is what the source's own size adds: a reflector's half-width, the sun's or a laser's angular radius.
 */
interface Env {
	kind: number
	Y: number
	G: number
	Yc: number
	Gc: number
	tanPsi: number
	sinPsi: number
}

/** The share of a tube a body of half-depth a catches (W caught = W × share; for kind 2, W/m × share, the share then 2a in m). */
const caught = (e: Env, a: number) => {
	if (e.kind === 2) return 2 * a
	if (e.kind === 0) {
		// the share of a cos-weighted spread of out-of-plane angles (|ψ| ≤ Ψ, a round beam's or a bulb's) within |z| < a: sin(atan U)/sin Ψ,
		// U the tan ψ that reaches z = a; the source's own size (Yc) widens the tube near it (in quadrature)
		const H = quad(Math.abs(e.Y) * Math.min(e.tanPsi, 1e12), e.Yc)
		if (H <= a) return 1
		if (!(e.sinPsi > 1e-12)) return a / H
		const U = (a * Math.min(e.tanPsi, 1e12)) / H
		return Math.min(1, U / Math.sqrt(1 + U * U) / e.sinPsi)
	}
	const H = quad(e.Y, e.Yc)
	return H <= a ? 1 : a / H
}
/** The tube's height from its two rays: the marginal ray's and what the source's own size adds, in quadrature (an extended source still
 *  gives I/d² once it is far, and a beam is never thinner than its source near it). */
const quad = (a: number, b: number) => Math.sqrt(a * a + b * b)
const advance = (e: Env, L: number) => {
	e.Y += e.G * L
	e.Yc += e.Gc * L
}
/** A round element of half-chord h at this point cuts the tube to |z| ≤ h: returns the share that passes; the tube becomes kind 1. */
const clipTo = (e: Env, h: number, power: Spectrum) => {
	let share = 1
	if (e.kind === 2) {
		share = 2 * h // W/m → W
		e.kind = 1
		e.Y = h
		e.G = 0
		e.Yc = 0
	} else if (e.kind === 0) {
		share = caught(e, h)
		const ay = Math.max(Math.abs(e.Y), 1e-12)
		const U = Math.min(e.tanPsi, Math.max(0, h - Math.abs(e.Yc)) / ay)
		e.kind = 1
		e.Y *= U
		e.G *= U
	} else {
		const H = quad(e.Y, e.Yc)
		if (H > h) {
			const s = h / H
			share = s
			e.Y *= s
			e.G *= s
			e.Yc *= s
			e.Gc *= s
		}
	}
	for (let b = 0; b < NB; b++) power[b] = (power[b] as number) * share
}

// ------------------------------------------------------------------ rays

interface Ray {
	ox: number
	oy: number
	dx: number
	dy: number
	/** W per band (W/m for an uncut sunbeam) */
	p: Spectrum
	/** 0: broad light; else the one wavelength it is (nm) */
	nm: number
	env: Env
	/** the dielectric bodies it is inside (innermost last) */
	inside: number[]
	/** which branch of its root it is (a code for drawing sheets between neighbours) */
	key: number
	/** segments so far on this branch */
	depth: number
	/** a beam's ray (a laser's, the sun's): its weak reflections off glass are followed (a fan's are not) */
	beam: boolean
}

const cloneEnv = (e: Env): Env => ({ kind: e.kind, Y: e.Y, G: e.G, Yc: e.Yc, Gc: e.Gc, tanPsi: e.tanPsi, sinPsi: e.sinPsi })

/** One straight piece of light, for drawing (and for the sheets between neighbouring rays). */
export interface Segment {
	x0: number
	y0: number
	x1: number
	y1: number
	/** W per band arriving at its end... at its start (what a beam of it carries); W/m for sunlight not yet cut */
	p: Spectrum
	nm: number
	/** the source index, its root ray's index in the source's fan, and the branch key (equal keys at neighbouring roots: draw a sheet) */
	src: number
	root: number
	key: number
	/** its tube's half-height out of the plane at its start and end (m; Infinity for sunlight) */
	h0: number
	h1: number
	/** the body (index into the trace's bodies) it ends on, or −1 (it leaves the scene) */
	end: number
}

/** Light landing on a body (what it catches): where, how much, and on which face. */
export interface Deposit {
	body: number
	prim: number
	x: number
	y: number
	/** the ray's direction */
	dx: number
	dy: number
	/** the face's outward normal */
	nx: number
	ny: number
	/** W per band caught at the surface, and absorbed (by the surface or, inside a medium, along the way) */
	incident: Spectrum
	absorbed: Spectrum
	/** W per band the surface scatters diffusely (lit paper, a white screen) */
	scattered: Spectrum
	nm: number
	src: number
	root: number
	key: number
	/** "face": light landing on an outline; "volume": absorbed inside a medium */
	volume: boolean
}

// limits that keep any scene's tracing bounded
export const LIMITS = {
	/** segments one branch may have */
	branchSegments: 48,
	/** a branch weaker than this share of its root's power is not followed */
	cutoff: 2e-3,
	/** rays one source may send (with the adaptive ones) */
	rootsPerSource: 4096,
	/** segments in all */
	segments: 120000,
	/** levels of halving between neighbouring rays that part ways (an edge found to 1/256 of the fan's spacing) */
	refine: 8,
	/** a translucent sheet's spread: rays it sends on per ray */
	diffuseRays: 5
}

export interface TraceInput {
	readonly bodies: readonly OpticBody[]
	readonly sources: readonly OpticSource[]
	/** the poses of the solids (bodies and source housings) */
	pose(id: string): Pose | undefined
	/** a source's power now (1 = as stated; a switch, a dimmer, a lamp the circuit drives), default 1 */
	level?(source: OpticSource): number
	/** keep the segments (for drawing); the engine leaves them out */
	segments?: boolean
}

export interface SensorReading {
	readonly body: number
	readonly id: string
	readonly item: string
	/** W/m² and lux on its face (light landing on it plus light scattered toward it by lit surfaces) */
	readonly irradiance: number
	readonly lux: number
	/** the part of it that came straight from sources (by mirrors and lenses too) */
	readonly directLux: number
	/** W landing on its face */
	readonly watts: number
	/** lux by source index */
	readonly bySource: readonly number[]
}

export interface Result {
	readonly segments: Segment[]
	readonly deposits: Deposit[]
	/** per body: W caught (all bands), W absorbed (heat), visible W caught, lumens caught */
	readonly caught: Float64Array
	readonly absorbed: Float64Array
	/** per body and band: W absorbed */
	readonly absorbedBands: Float64Array
	/** per body: W caught from each source: [body * sources + source] */
	readonly bySource: Float64Array
	readonly sensors: SensorReading[]
	/** per panel body: W of light on its face and W of electricity (at its maximum power point) */
	readonly panels: { body: number; id: string; item: string; irradiance: number; light: number; electric: number }[]
	/** per screen face that light reaches: the lit stretches along it (m, from its middle) and the length of its shadows within the light */
	readonly screens: {
		body: number
		id: string
		item: string
		prim: number
		length: number
		lit: [number, number][]
		shadow: number
		litFraction: number
		/** the things whose shadows fall on this face: where (m along it) light they stop would have landed */
		casters: { item: string; from: number; to: number }[]
	}[]
	/** whether a limit stopped the tracing short somewhere */
	readonly truncated: boolean
	/** per body: how many rays were totally reflected inside it (at a face, past the critical angle) */
	readonly tir: Uint32Array
	/** per body: the visible lumens it scatters (lit paper, a lit book: what an eye can see) */
	readonly scatteredLm: Float64Array
	/** the bodies' placed geometry (for looks and shadow tests after the trace) */
	readonly placed: readonly unknown[]
}

// ------------------------------------------------------------------ tracing

/** The current trace's total-internal-reflection counts per body (set by trace, counted by refract). */
let TIR: Uint32Array | null = null

interface Fan {
	src: number
	s: number[]
	results: RootResult[]
}
interface RootResult {
	segs: Segment[]
	deps: Deposit[]
	hash: number
}

/**
 * Traces every source's light through the bodies at these poses.
 */
export const trace = (input: TraceInput): Result => {
	const bodies: WBody[] = []
	const bodyIndex = new Map<string, number>()
	input.bodies.forEach((b) => {
		const pose = input.pose(b.id)
		if (pose === undefined) return
		const w = place(b, bodies.length, pose)
		bodyIndex.set(b.id, bodies.length)
		bodies.push(w)
	})
	const nb = bodies.length
	const ns = input.sources.length
	const state = { segments: 0, truncated: false }
	TIR = new Uint32Array(Math.max(1, bodies.length))
	const keepSegs = input.segments === true
	const fans: Fan[] = []
	input.sources.forEach((src, si) => {
		const level = input.level?.(src) ?? 1
		if (!(level > 0)) return
		const pose = src.solid === "" ? { x: 0, y: 0, angle: 0 } : input.pose(src.solid)
		if (pose === undefined) return
		const [sa, ca] = sincos(pose.angle)
		const sx = pose.x + ca * src.x - sa * src.y
		const sy = pose.y + sa * src.x + ca * src.y
		// the beam's axis in the world: its own direction (an angle or a vector, in the housing's frame) turned with the housing
		let [ux, uy] = [1, 0]
		if (src.dirVec !== undefined) [ux, uy] = [src.dirVec.x, src.dirVec.y]
		else {
			const [s0, c0] = sincos(src.dir)
			;[ux, uy] = [c0, s0]
		}
		const ax = ca * ux - sa * uy
		const ay = sa * ux + ca * uy
		// the dielectrics the source sits in (a laser under water)
		const inside: number[] = []
		for (const w of bodies) if (w.src.role === "glass" && insideBody(w, sx, sy)) inside.push(w.index)
		const emit = (s: number): RootResult => {
			const ray = emitRay(src, sx, sy, ax, ay, s, level, inside)
			return traceRoot(ray, si, s, bodies, state, keepSegs)
		}
		const fan: Fan = { src: si, s: [], results: [] }
		if (src.kind === "laser" || src.rays <= 1) {
			fan.s = [0.5]
			fan.results = [emit(0.5)]
		} else {
			const n = Math.max(2, Math.round(src.rays))
			const grid: number[] = []
			for (let i = 0; i < n; i++) grid.push(i / (n - 1))
			// small light-takers (a meter's 1 cm window, a solar panel) are sampled on purpose: TARGETED rays across the part of the fan
			// that points straight at each, so one between two rays is never missed (light reaching them by mirrors is found by the halving)
			for (const w of bodies) {
				if (w.src.role !== "sensor" && w.src.role !== "panel") continue
				const span = fanSpan(src, sx, sy, ax, ay, w)
				if (span === undefined) continue
				const [lo, hi] = span
				for (let k = 0; k <= TARGETED; k++) grid.push(lo + ((hi - lo) * k) / TARGETED)
			}
			grid.sort((a, b) => a - b)
			const s: number[] = []
			const r: RootResult[] = []
			for (const v of grid) {
				if (s.length && v - (s[s.length - 1] as number) < 1e-12) continue
				s.push(v)
				r.push(emit(v))
			}
			// halve the gap between neighbours that part ways (one meets a body the other misses), depth-first left to right
			const outS: number[] = [s[0] as number]
			const outR: RootResult[] = [r[0] as RootResult]
			let roots = s.length
			for (let i = 0; i + 1 < s.length; i++) {
				const stack: { a: number; ra: RootResult; b: number; rb: RootResult; level: number }[] = [
					{ a: s[i] as number, ra: r[i] as RootResult, b: s[i + 1] as number, rb: r[i + 1] as RootResult, level: 0 }
				]
				while (stack.length > 0) {
					const g = stack.pop() as { a: number; ra: RootResult; b: number; rb: RootResult; level: number }
					const fine = src.kind === "sun" ? (g.b - g.a) * 2 * src.size < 2e-4 : (g.b - g.a) * 2 * src.spread < 2e-4
					if (g.ra.hash !== g.rb.hash && g.level < LIMITS.refine && !fine && roots < LIMITS.rootsPerSource && !state.truncated) {
						const m = (g.a + g.b) / 2
						const rm = emit(m)
						roots++
						// do [a, m] then [m, b]: push [m, b] first (stack), [a, m] last
						stack.push({ a: m, ra: rm, b: g.b, rb: g.rb, level: g.level + 1 })
						stack.push({ a: g.a, ra: g.ra, b: m, rb: rm, level: g.level + 1 })
					} else {
						outS.push(g.b)
						outR.push(g.rb)
					}
				}
			}
			fan.s = outS
			fan.results = outR
		}
		fans.push(fan)
	})

	// weights: each root ray stands for its cell of the fan (half-way to each neighbour); scale its powers by that
	const segments: Segment[] = []
	const deposits: Deposit[] = []
	for (const fan of fans) {
		const k = fan.s.length
		const src = input.sources[fan.src] as OpticSource
		// a round cone's rays carry power in proportion to the sine of their out-of-plane spread (uniform intensity over the cone)
		const shape = fan.s.map((s) => (src.round === true && k > 1 ? coneOut(src, s, sincos(src.spread * (2 * s - 1))[1])[0] : 1))
		let norm = 0
		const cell = fan.s.map((_, i) => (k === 1 ? 1 : ((fan.s[Math.min(k - 1, i + 1)] as number) - (fan.s[Math.max(0, i - 1)] as number)) / 2))
		for (let i = 0; i < k; i++) norm += (cell[i] as number) * (shape[i] as number)
		fan.results.forEach((res, i) => {
			const w = norm > 0 ? ((cell[i] as number) * (shape[i] as number)) / norm : 0
			for (const sg of res.segs) {
				scale(sg.p, w)
				sg.root = i
				segments.push(sg)
			}
			for (const d of res.deps) {
				const a = d.incident
				const b = d.absorbed
				const c = d.scattered
				for (let k = 0; k < NB; k++) {
					a[k] = (a[k] as number) * w
					b[k] = (b[k] as number) * w
					c[k] = (c[k] as number) * w
				}
				d.root = i
				deposits.push(d)
			}
		})
	}

	// what each body caught and absorbed
	const caughtW = new Float64Array(nb)
	const absorbedW = new Float64Array(nb)
	const absorbedBands = new Float64Array(nb * NB)
	const bySource = new Float64Array(nb * Math.max(1, ns))
	for (const d of deposits) {
		let c = 0
		let a = 0
		for (let b = 0; b < NB; b++) {
			c += d.incident[b] as number
			a += d.absorbed[b] as number
			absorbedBands[d.body * NB + b] = (absorbedBands[d.body * NB + b] as number) + (d.absorbed[b] as number)
		}
		if (!d.volume) {
			caughtW[d.body] = (caughtW[d.body] as number) + c
			bySource[d.body * ns + d.src] = (bySource[d.body * ns + d.src] as number) + c
		}
		absorbedW[d.body] = (absorbedW[d.body] as number) + a
	}

	// light sensors: what lands on their face, plus what lit surfaces scatter toward them (Lambertian)
	const sensors: SensorReading[] = []
	const panels: Result["panels"] = []
	const screens: Result["screens"] = []
	for (const w of bodies) {
		const role = w.src.role
		if (role !== "sensor" && role !== "panel") continue
		const face = faceOf(w)
		if (face < 0) continue
		const win = w.src.window
		const area = win === undefined ? faceArea(w, face) : Math.max(1e-8, 2 * win * 2 * w.src.halfDepth)
		const fmid = win === undefined ? 0 : faceLength(w, face) / 2
		let watts = 0
		let lm = 0
		const lmBy = new Array<number>(ns).fill(0)
		let elec = 0
		for (const d of deposits) {
			if (d.body !== w.index || d.volume || w.faces[d.prim] !== 1) continue
			if (win !== undefined && Math.abs(alongFace(w, d.prim, d.x, d.y) - fmid) > win) continue
			for (let b = 0; b < NB; b++) watts += d.incident[b] as number
			const l = lumens(d.incident, d.nm)
			lm += l
			lmBy[d.src] = (lmBy[d.src] as number) + l
			if (role === "panel") {
				const eff = w.src.efficiency
				for (let b = 0; b < NB; b++) elec += (d.incident[b] as number) * (eff === undefined ? 0.2 : (eff[b] as number))
			}
		}
		const directLm = lm
		let scatterW = 0
		let scatterLm = 0
		if (role === "sensor") {
			// light scattered by lit surfaces that the face can see
			const [fx, fy, fnx, fny] = faceFrame(w, face)
			for (const d of deposits) {
				if (d.volume || d.body === w.index) continue
				let sw = 0
				for (let b = 0; b < NB; b++) sw += d.scattered[b] as number
				if (sw <= 0) continue
				const vx = fx - d.x
				const vy = fy - d.y
				const r2 = vx * vx + vy * vy
				if (r2 < 1e-8) continue
				const r = Math.sqrt(r2)
				const cp = (d.nx * vx + d.ny * vy) / r
				const cs = -(fnx * vx + fny * vy) / r
				if (cp <= 0 || cs <= 0) continue
				if (blocked(bodies, d.x + d.nx * 1e-6, d.y + d.ny * 1e-6, vx / r, vy / r, r, d.body, w.index)) continue
				// Lambertian: radiant intensity normal to the patch P/π; the face (area A) at distance r receives (P/π)·cos θp · A·cos θs / r²
				const g = (cp * area * cs) / (PI * r2)
				scatterW += sw * g
				scatterLm += lumens(d.scattered, d.nm) * g
			}
		}
		if (role === "sensor") {
			const totalLm = directLm + scatterLm
			sensors.push({
				body: w.index,
				id: w.src.id,
				item: w.src.item,
				irradiance: (watts + scatterW) / area,
				lux: totalLm / area,
				directLux: directLm / area,
				watts,
				bySource: lmBy.map((v) => v / area)
			})
		} else panels.push({ body: w.index, id: w.src.id, item: w.src.item, irradiance: watts / area, light: watts, electric: elec })
	}
	// what each body scatters (visible lumens): what an eye can see of it
	const scatteredLm = new Float64Array(Math.max(1, nb))
	for (const d of deposits) if (!d.volume) scatteredLm[d.body] = (scatteredLm[d.body] as number) + lumens(d.scattered, d.nm)
	// shadow casters: each ray stopped by an opaque thing, carried on as if that thing were not there; where it would have landed on a
	// screen's face first, the thing's shadow is (by item, along the face)
	const casters = new Map<string, { body: number; item: string; prim: number; lo: number; hi: number }>()
	const anyScreen = bodies.some((w) => w.src.role === "screen")
	if (anyScreen) {
		const h: Hit = { t: Infinity, prim: -1, enter: false, body: -1 }
		for (const d of deposits) {
			if (d.volume) continue
			const ob = bodies[d.body] as WBody
			const role = ob.src.role
			if (role === "glass" || role === "filter" || role === "translucent" || role === "screen") continue
			if (role === "mirror" && ob.faces[d.prim] === 1) continue
			let best = FAR
			let hb = -1
			let hp = -1
			let he = false
			for (const w of bodies) {
				if (w.index === d.body) continue
				h.t = Infinity
				if (crossing(w, d.x, d.y, d.dx, d.dy, best, h)) {
					best = h.t
					hb = h.body
					hp = h.prim
					he = h.enter
				}
			}
			if (hb < 0 || !he) continue
			const sc = bodies[hb] as WBody
			if (sc.src.role !== "screen" || sc.faces[hp] !== 1 || (sc.prims[hp] as WPrim).k !== HALF) continue
			const u = alongFace(sc, hp, d.x + d.dx * best, d.y + d.dy * best)
			const key = `${ob.src.item}\u0000${hb}\u0000${hp}`
			const c = casters.get(key)
			if (c === undefined) casters.set(key, { body: hb, item: ob.src.item, prim: hp, lo: u, hi: u })
			else {
				c.lo = Math.min(c.lo, u)
				c.hi = Math.max(c.hi, u)
			}
		}
	}
	// screens: lit stretches along each face the light reaches, from the order of the fan's rays (neighbouring roots that land on the same
	// face on the same branch light the stretch between them)
	for (const w of bodies) {
		if (w.src.role !== "screen") continue
		for (let f = 0; f < w.prims.length; f++) {
			if (w.faces[f] !== 1 || (w.prims[f] as WPrim).k !== HALF) continue
			const len = faceLength(w, f)
			if (len <= 0) continue
			const lit: [number, number][] = []
			for (const fan of fans) {
				let prev: Map<number, number> | undefined
				fan.results.forEach((res) => {
					const here = new Map<number, number>()
					for (const d of res.deps) if (d.body === w.index && d.prim === f && !d.volume) here.set(d.key, alongFace(w, f, d.x, d.y))
					if (prev !== undefined)
						for (const [key, u] of here) {
							const v = prev.get(key)
							if (v !== undefined) lit.push([Math.min(u, v), Math.max(u, v)])
						}
					for (const u of here.values()) lit.push([u, u])
					prev = here
				})
			}
			if (lit.length === 0) continue
			const merged = mergeStretches(lit, len)
			let litLen = 0
			for (const [a, b] of merged) litLen += b - a
			// the shadow: the unlit length between the lit stretches' outer ends (light reaches both sides of it)
			let shadow = 0
			for (let i = 0; i + 1 < merged.length; i++) shadow += (merged[i + 1] as [number, number])[0] - (merged[i] as [number, number])[1]
			const by: { item: string; from: number; to: number }[] = []
			for (const c of casters.values()) if (c.body === w.index && c.prim === f) by.push({ item: c.item, from: c.lo, to: c.hi })
			screens.push({ body: w.index, id: w.src.id, item: w.src.item, prim: f, length: len, lit: merged, shadow, litFraction: litLen / len, casters: by })
		}
	}
	return {
		segments: keepSegs ? segments : [],
		deposits,
		caught: caughtW,
		absorbed: absorbedW,
		absorbedBands,
		bySource,
		sensors,
		panels,
		screens,
		truncated: state.truncated,
		tir: TIR,
		scatteredLm,
		placed: bodies
	}
}

const scale = (p: Spectrum, w: number) => {
	for (let b = 0; b < NB; b++) p[b] = (p[b] as number) * w
}

/** Lumens in a spectrum (a one-wavelength ray at its own V). */
export const lumens = (p: Spectrum, nm: number) => {
	if (nm > 0) {
		let s = 0
		for (let b = 0; b < NB; b++) s += p[b] as number
		return KM * luminousEfficiency(nm) * s
	}
	let s = 0
	for (let b = 0; b < IR; b++) s += (p[b] as number) * (BAND_V[b] as number)
	return KM * s
}

const faceOf = (w: WBody) => {
	for (let f = 0; f < w.faces.length; f++) if (w.faces[f] === 1) return f
	return -1
}
/** A half-plane face's length: the stretch of its line inside every other prim (a slab's or polygon's side). */
const faceLength = (w: WBody, f: number) => {
	const [a, b] = faceEnds(w, f)
	return b - a
}
/** The face's stretch along its tangent (−ny, nx), from the body's origin's foot on it: [start, end] (m). */
const faceEnds = (w: WBody, f: number): [number, number] => {
	const p = w.prims[f] as WPrim
	if (p.k !== HALF) return [-(p.c as number), p.c as number]
	// the foot of the body's origin on the line, and the line's tangent
	const off = p.c - (p.a * w.ox + p.b * w.oy)
	const px = w.ox + p.a * off
	const py = w.oy + p.b * off
	const tx = -p.b
	const ty = p.a
	let lo = -FAR
	let hi = FAR
	for (let q = 0; q < w.prims.length; q++) {
		if (q === f) continue
		const r = w.prims[q] as WPrim
		if (r.k !== HALF) continue
		const den = r.a * tx + r.b * ty
		const num = r.c - (r.a * px + r.b * py)
		if (Math.abs(den) < 1e-15) continue
		const t = num / den
		if (den > 0) hi = Math.min(hi, t)
		else lo = Math.max(lo, t)
	}
	return [lo, hi]
}
const alongFace = (w: WBody, f: number, x: number, y: number) => {
	const p = w.prims[f] as WPrim
	const off = p.c - (p.a * w.ox + p.b * w.oy)
	const px = w.ox + p.a * off
	const py = w.oy + p.b * off
	const [lo] = faceEnds(w, f)
	return -p.b * (x - px) + p.a * (y - py) - lo
}
/** The middle of a face and its outward normal. */
const faceFrame = (w: WBody, f: number): [number, number, number, number] => {
	const p = w.prims[f] as WPrim
	if (p.k !== HALF) {
		const ux = w.ox - p.a
		const uy = w.oy - p.b
		const l = Math.sqrt(ux * ux + uy * uy) || 1
		return [p.a + (ux / l) * p.c, p.b + (uy / l) * p.c, ux / l, uy / l]
	}
	const [lo, hi] = faceEnds(w, f)
	const off = p.c - (p.a * w.ox + p.b * w.oy)
	const mid = (lo + hi) / 2
	return [w.ox + p.a * off - p.b * mid, w.oy + p.b * off + p.a * mid, p.a, p.b]
}
/** A face's area: its length (a disc's diameter) × the body's depth. */
const faceArea = (w: WBody, f: number) => {
	const p = w.prims[f] as WPrim
	const len = p.k === HALF ? faceLength(w, f) : 2 * p.c
	return Math.max(1e-8, len * 2 * w.src.halfDepth)
}

const mergeStretches = (s: [number, number][], len: number): [number, number][] => {
	const sorted = s.map(([a, b]) => [Math.max(0, a), Math.min(len, b)] as [number, number]).filter(([a, b]) => b >= a)
	sorted.sort((p, q) => p[0] - q[0] || p[1] - q[1])
	const out: [number, number][] = []
	for (const [a, b] of sorted) {
		const last = out[out.length - 1]
		// stretches closer than 0.5 mm are one (two rays a hair apart on one face)
		if (last !== undefined && a <= last[1] + 5e-4) last[1] = Math.max(last[1], b)
		else out.push([a, b])
	}
	return out
}

/** Whether something opaque stands on the straight line from (x, y) along (dx, dy) within r (light passes dielectrics, filters and
 *  translucent sheets on this test). */
const blocked = (bodies: readonly WBody[], x: number, y: number, dx: number, dy: number, r: number, skipA: number, skipB: number) => {
	const h: Hit = { t: Infinity, prim: -1, enter: false, body: -1 }
	for (const w of bodies) {
		if (w.index === skipA || w.index === skipB) continue
		const role = w.src.role
		if (role === "glass" || role === "filter" || role === "translucent") continue
		h.t = Infinity
		if (crossing(w, x, y, dx, dy, r, h) && h.t < r) return true
	}
	return false
}

/** A round cone's out-of-plane spread for its ray at fan parameter s: the cone of half-angle θ (= the source's spread) holds the directions
 *  at in-plane angle α with cos ψ ≥ cos θ / cos α; returns [sin ψmax, tan ψmax] (0 at the fan's edges). */
const coneOut = (src: OpticSource, s: number, ca: number): [number, number] => {
	const ct = coneCos(src)
	const c = Math.min(1, ct / ca)
	const sp = Math.sqrt(Math.max(0, 1 - c * c))
	return [sp, c > 1e-12 ? sp / c : 1e12]
}

/** Rays aimed across each small light-taker (TARGETED + 1 of them). */
const TARGETED = 8

/** atan2 from + − × ÷ and sqrt alone (two half-angle steps, then the series): within an ulp or two. */
export const atan2 = (y: number, x: number): number => {
	if (Number.isNaN(x) || Number.isNaN(y)) return NaN
	if (x === 0 && y === 0) return 0
	const ax = Math.abs(x)
	const ay = Math.abs(y)
	const big = ay > ax
	let t = big ? ax / ay : ay / ax // 0..1
	// atan t = 2 atan(t / (1 + sqrt(1 + t²))): twice, so |t| ≤ tan(π/16) ≈ 0.2
	t = t / (1 + Math.sqrt(1 + t * t))
	t = t / (1 + Math.sqrt(1 + t * t))
	const t2 = t * t
	let sum = 0
	for (let k = 13; k >= 0; k--) sum = (k % 2 === 0 ? 1 : -1) / (2 * k + 1) + t2 * sum
	let a = 4 * t * sum
	if (big) a = PI / 2 - a
	if (x < 0) a = PI - a
	return y < 0 ? -a : a
}

/** The part of a fan (s from 0 to 1) that points at body w's bounding circle, or undefined when the fan does not reach it. */
const fanSpan = (src: OpticSource, sx: number, sy: number, ax: number, ay: number, w: WBody): [number, number] | undefined => {
	const vx = w.bx - sx
	const vy = w.by - sy
	if (src.kind === "sun") {
		// a band of parallel light: the body's offset across it
		const off = vx * -ay + vy * ax
		const half = src.size
		if (!(half > 0)) return undefined
		const lo = Math.max(0, (off - w.br) / (2 * half) + 0.5)
		const hi = Math.min(1, (off + w.br) / (2 * half) + 0.5)
		return hi > lo ? [lo, hi] : undefined
	}
	if (!(src.spread > 0)) return undefined
	const d = Math.sqrt(vx * vx + vy * vy)
	if (d <= w.br) return [0, 1]
	const c = atan2(vx * -ay + vy * ax, vx * ax + vy * ay) // the body's middle from the fan's axis
	const h = atan2(w.br, Math.sqrt(d * d - w.br * w.br)) // its half-width as seen from the source
	const lo = Math.max(0, (c - h) / (2 * src.spread) + 0.5)
	const hi = Math.min(1, (c + h) / (2 * src.spread) + 0.5)
	return hi > lo ? [lo, hi] : undefined
}

/** (rays outside every clear body share this list: a ray never changes its list in place) */
const NOWHERE: number[] = []
const CONE_COS = new WeakMap<OpticSource, number>()
/** cos of a round cone's half-angle (kept per source). */
const coneCos = (src: OpticSource) => {
	let c = CONE_COS.get(src)
	if (c === undefined) {
		c = sincos(src.spread)[1]
		CONE_COS.set(src, c)
	}
	return c
}

/** The first ray of a source at fan parameter s (0..1). */
const emitRay = (src: OpticSource, sx: number, sy: number, ax: number, ay: number, s: number, level: number, inside: number[]): Ray => {
	const p = new Float64Array(NB)
	for (let b = 0; b < NB; b++) p[b] = (src.power[b] as number) * level
	let ox = sx
	let oy = sy
	let dx = ax
	let dy = ay
	let env: Env
	if (src.kind === "sun") {
		// a band of parallel light `2·size` wide, centred on the source: W/m² × the band's width = W per m of height, shared by the fan
		const ds = ay
		const dc = ax
		const off = (s - 0.5) * 2 * src.size
		const back = src.back ?? 0
		ox = sx - ds * off - dc * back
		oy = sy + dc * off - ds * back
		for (let b = 0; b < NB; b++) p[b] = (p[b] as number) * 2 * src.size
		env = { kind: 2, Y: 0, G: 0, Yc: 0, Gc: src.blur, tanPsi: 0, sinPsi: 0 }
	} else if (src.kind === "laser") {
		env = { kind: 1, Y: src.size, G: 0, Yc: 0, Gc: src.blur, tanPsi: 0, sinPsi: 0 }
	} else {
		const [sa, ca] = sincos(src.spread * (2 * s - 1))
		dx = ax * ca - ay * sa
		dy = ax * sa + ay * ca
		let sp: number
		let tp: number
		if (src.round === true) [sp, tp] = coneOut(src, s, ca)
		else {
			const [s1, c1] = sincos(Math.min(src.outSpread, PI / 2))
			sp = s1
			tp = c1 > 1e-12 ? s1 / c1 : 1e12
		}
		env = { kind: 0, Y: 0, G: 1, Yc: src.size, Gc: 0, tanPsi: tp, sinPsi: sp }
	}
	return { ox, oy, dx, dy, p, nm: src.nm, env, inside: inside.length ? inside.slice() : NOWHERE, key: 1, depth: 0, beam: src.kind === "laser" || src.kind === "sun" }
}

const total = (p: Spectrum) => {
	let s = 0
	for (let b = 0; b < NB; b++) s += p[b] as number
	return s
}

/** The hash step for a root's signature. */
const mix = (h: number, v: number) => (Math.imul(h ^ v, 0x01000193) + 0x9e3779b9) | 0

/** Traces one root ray and everything it splits into. */
const traceRoot = (root: Ray, si: number, s: number, bodies: readonly WBody[], state: { segments: number; truncated: boolean }, keepSegs: boolean): RootResult => {
	void s
	const segs: Segment[] = []
	const deps: Deposit[] = []
	let hash = 0x811c9dc5 | 0
	const rootPower = Math.max(total(root.p), 1e-300)
	const stack: Ray[] = [root]
	const hit: Hit = { t: Infinity, prim: -1, enter: false, body: -1 }
	while (stack.length > 0) {
		const ray = stack.pop() as Ray
		for (;;) {
			if (ray.depth >= LIMITS.branchSegments) {
				state.truncated = true
				break
			}
			if (state.segments >= LIMITS.segments) {
				state.truncated = true
				break
			}
			// nearest crossing
			let best = FAR
			let hb = -1
			let hp = -1
			let he = false
			for (const w of bodies) {
				// (its bounding circle first, inline: most bodies are nowhere near the ray)
				const qx = w.bx - ray.ox
				const qy = w.by - ray.oy
				const tc = qx * ray.dx + qy * ray.dy
				const r2 = w.br * w.br
				if (tc < -w.br || tc - w.br > best || qx * qx + qy * qy - tc * tc > r2) continue
				if (crossing(w, ray.ox, ray.oy, ray.dx, ray.dy, best, hit)) {
					best = hit.t
					hb = hit.body
					hp = hit.prim
					he = hit.enter
				}
			}
			const L = best
			const x1 = ray.ox + ray.dx * L
			const y1 = ray.oy + ray.dy * L
			const h0 = keepSegs ? height(ray.env) : 0
			// absorption inside the medium along the way
			const med = ray.inside.length > 0 ? mediumIndex(ray.inside, bodies) : -1
			const startP = keepSegs ? ray.p.slice() : ray.p
			if (med >= 0) {
				const m = mediumOfBody((bodies[med] as WBody).src)
				if (m !== undefined) {
					const lost = new Float64Array(NB)
					let any = false
					for (let b = 0; b < NB; b++) {
						const pb = ray.p[b] as number
						if (pb === 0) continue
						const band = ray.nm > 0 ? bandOf(ray.nm) : b
						const keep = exp(-(m.alpha[band] as number) * L)
						lost[b] = pb * (1 - keep)
						ray.p[b] = pb * keep
						if (lost[b] as number > 0) any = true
					}
					if (any) {
						// (sunlight not yet cut by a round element is W per metre of height: the body's depth takes that much of it)
						if (ray.env.kind === 2) scale(lost, 2 * (bodies[med] as WBody).src.halfDepth)
						deps.push(volumeDeposit(med, lost, ray, si, x1, y1))
					}
				}
			}
			advance(ray.env, L)
			state.segments++
			if (keepSegs) segs.push({ x0: ray.ox, y0: ray.oy, x1, y1, p: startP, nm: ray.nm, src: si, root: 0, key: ray.key, h0, h1: height(ray.env), end: hb })
			if (hb < 0) break
			const w = bodies[hb] as WBody
			hash = mix(mix(hash, hb), hp * 2 + (he ? 1 : 0))
			const [nx, ny] = normalAt(w, hp, x1, y1)
			ray.ox = x1
			ray.oy = y1
			ray.depth++
			const role = w.src.role
			const active = w.faces[hp] === 1
			if (role === "glass") {
				// a dielectric: is this the body we are inside of (leaving), or one we enter?
				if (he && ray.inside.includes(hb)) continue
				if (!he && !ray.inside.includes(hb)) continue
				// (light arriving at a clear body from outside reaches it: what it catches, for "light reaches" and its readings)
				if (he) {
					// a clear body of depth D takes the part of a tube within |z| < D/2, as an opaque one does: the rest passes beside it out of the plane
					// and is not followed (a round lens cuts its own chord in refract; uncut sunlight is W per metre of height, taken below); engine6
					beside(ray, w)
					const arrived = ray.p.slice()
					if (ray.env.kind === 2) scale(arrived, 2 * w.src.halfDepth)
					deps.push(faceDeposit(hb, hp, x1, y1, ray, nx, ny, arrived, new Float64Array(NB), new Float64Array(NB), si, w))
				}
				if (refract(ray, w, hp, he, nx, ny, bodies, stack, rootPower, segs, keepSegs)) continue
				break
			}
			if (role === "filter") {
				if (he) {
					beside(ray, w)
					const lost = new Float64Array(NB)
					const arrived = ray.p.slice()
					const pass = w.src.pass ?? []
					for (let b = 0; b < NB; b++) {
						const band = ray.nm > 0 ? bandOf(ray.nm) : b
						const t = (pass[band] as number | undefined) ?? 1
						lost[b] = (ray.p[b] as number) * (1 - t)
						ray.p[b] = (ray.p[b] as number) * t
					}
					if (ray.env.kind === 2) {
						scale(lost, 2 * w.src.halfDepth)
						scale(arrived, 2 * w.src.halfDepth)
					}
					deps.push(faceDeposit(hb, hp, x1, y1, ray, nx, ny, arrived, lost, new Float64Array(NB), si, w))
					if (total(ray.p) < rootPower * LIMITS.cutoff) break
				}
				continue
			}
			if (role === "translucent") {
				if (!he) continue
				const tr = w.src.transmit ?? 0.5
				beside(ray, w)
				// sunlight not yet cut (W per metre of height) lights the sheet over its own depth: from here it is a finite source
				if (ray.env.kind === 2) scale(ray.p, 2 * w.src.halfDepth)
				const inc = ray.p.slice()
				const absorbed = new Float64Array(NB)
				const scattered = new Float64Array(NB)
				for (let b = 0; b < NB; b++) {
					const pb = inc[b] as number
					// what does not go on is half scattered back (lighting the sheet), half absorbed (provisional split)
					scattered[b] = pb * (1 - tr) * 0.5
					absorbed[b] = pb * (1 - tr) * 0.5
				}
				deps.push(faceDeposit(hb, hp, x1, y1, ray, nx, ny, inc, absorbed, scattered, si, w))
				// the light goes on diffused: a few rays over ±blur, each a new wide source at the sheet (Lambert-like out of the plane)
				const k = LIMITS.diffuseRays
				const blur = w.src.blur ?? 0.6
				for (let i = 0; i < k; i++) {
					const off = k === 1 ? 0 : blur * ((2 * i) / (k - 1) - 1)
					const [so, co] = sincos(off)
					const p = new Float64Array(NB)
					for (let b = 0; b < NB; b++) p[b] = ((ray.p[b] as number) * tr) / k
					if (total(p) < rootPower * LIMITS.cutoff) continue
					stack.push({
						ox: x1,
						oy: y1,
						dx: ray.dx * co - ray.dy * so,
						dy: ray.dx * so + ray.dy * co,
						p,
						nm: ray.nm,
						env: { kind: 0, Y: 0, G: 1, Yc: Math.max(Math.abs(ray.env.Yc), 0), Gc: 0, tanPsi: 1.7320508075688772, sinPsi: 0.8660254037844386 },
						inside: ray.inside.slice(),
						key: (ray.key * 8 + i + 1) | 0,
						depth: ray.depth,
						beam: false
					})
				}
				break
			}
			if (role === "mirror" && active && he) {
				// a round mirror cuts the tube to its own height out of the plane; a flat one to its depth (it turns back only the part of a tube it
				// catches, |z| < D/2, sunlight too: a band its own depth tall; the rest passes beside it and is not followed; engine6 crossmod)
				if (w.src.aperture !== undefined) clipTo(ray.env, chord(w, x1, y1), ray.p)
				else if (height(ray.env) > w.src.halfDepth) clipTo(ray.env, w.src.halfDepth, ray.p)
				const R = w.src.reflect ?? [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.92]
				const inc = ray.p.slice()
				const absorbed = new Float64Array(NB)
				const perM = ray.env.kind === 2 ? 2 * w.src.halfDepth : 1
				for (let b = 0; b < NB; b++) {
					const band = ray.nm > 0 ? bandOf(ray.nm) : b
					const r = R[band] as number
					inc[b] = (inc[b] as number) * perM
					absorbed[b] = (ray.p[b] as number) * (1 - r) * perM
					ray.p[b] = (ray.p[b] as number) * r
				}
				deps.push(faceDeposit(hb, hp, x1, y1, ray, nx, ny, inc, absorbed, new Float64Array(NB), si, w))
				const c = ray.dx * nx + ray.dy * ny // < 0
				ray.dx -= 2 * c * nx
				ray.dy -= 2 * c * ny
				// out of the plane: a curved round face focuses (sagittal focal length R/(2 cos θ)); a flat face keeps the tube's slope
				const prim = w.prims[hp] as WPrim
				if (prim.sph) {
					const R2 = curvatureToward(prim, x1, y1, ray.dx, ray.dy)
					const phi = (2 * -c) / R2
					ray.env.G -= ray.env.Y * phi
					ray.env.Gc -= ray.env.Yc * phi
				}
				ray.key = (ray.key * 3 + 1) | 0
				if (total(ray.p) < rootPower * LIMITS.cutoff) break
				continue
			}
			if (!he) continue // leaving an opaque body (a source inside it): nothing to meet
			// opaque (or a mirror's back, a meter's housing, a sensor's or panel's or screen's face): caught and absorbed here
			const share = caught(ray.env, w.src.halfDepth)
			// (one buffer for the three spectra)
			const buf = new Float64Array(3 * NB)
			const inc = buf.subarray(0, NB)
			const absorbed = buf.subarray(NB, 2 * NB)
			const scattered = buf.subarray(2 * NB)
			const A = w.src.absorb
			for (let b = 0; b < NB; b++) {
				const pb = (ray.p[b] as number) * share
				const band = ray.nm > 0 ? bandOf(ray.nm) : b
				const a = (A[band] as number | undefined) ?? 0.5
				inc[b] = pb
				absorbed[b] = pb * a
				scattered[b] = pb * (1 - a)
			}
			deps.push(faceDeposit(hb, hp, x1, y1, ray, nx, ny, inc, absorbed, scattered, si, w))
			break
		}
	}
	return { segs, deps, hash }
}

/** A tube's half-height out of the plane (m), Infinity for uncut sunlight. */
const height = (e: Env) => (e.kind === 2 ? Infinity : e.kind === 0 ? quad(Math.abs(e.Y) * Math.min(e.tanPsi, 1e6), e.Yc) : quad(e.Y, e.Yc))

/**
 * A clear, filtering or diffusing body without a round aperture (a glass block, a prism, water, ice, a filter, a sheet of wax paper) meets only
 * the part of a lamp's, a flashlight's or a laser's tube within |z| < D/2 (its depth D): a tube taller than that is cut to it, its power to the
 * share it catches (as an opaque body catches: `caught`), and the rest is taken to pass beside it out of the plane and is not followed. A tube
 * that fits within its depth is left exactly as it is. Uncut sunlight (W per metre of height) is left to the callers, which take its depth's
 * share of what lands and let it go on as sunlight (what passes beside a clear body is sunlight too). (engine6 crossmod: before, a 4 cm ice cube
 * 34 cm from a lamp took the whole height of its beam, about 12 times its share.)
 */
const beside = (ray: Ray, w: WBody) => {
	if (ray.env.kind === 2 || w.src.aperture !== undefined) return
	if (height(ray.env) > w.src.halfDepth) clipTo(ray.env, w.src.halfDepth, ray.p)
}

/** The half-chord out of the plane of a round element at this point: √(r² − x²), x the point's distance from its axis. */
const chord = (w: WBody, x: number, y: number) => {
	const ap = w.src.aperture
	if (ap === undefined) return Infinity
	const vx = x - w.apx
	const vy = y - w.apy
	const along = vx * w.aax + vy * w.aay
	const off2 = vx * vx + vy * vy - along * along
	return Math.sqrt(Math.max(0, ap.r * ap.r - off2))
}

/** A curved prim's radius, signed + when its centre of curvature lies ahead of the ray leaving (dx, dy) from the point. */
const curvatureToward = (p: WPrim, x: number, y: number, dx: number, dy: number) => {
	const toC = (p.a - x) * dx + (p.b - y) * dy
	return toC > 0 ? p.c : -p.c
}

const faceDeposit = (
	body: number,
	prim: number,
	x: number,
	y: number,
	ray: Ray,
	nx: number,
	ny: number,
	incident: Spectrum,
	absorbed: Spectrum,
	scattered: Spectrum,
	src: number,
	w: WBody
): Deposit => {
	void w
	return { body, prim, x, y, dx: ray.dx, dy: ray.dy, nx, ny, incident, absorbed, scattered, nm: ray.nm, src, root: 0, key: ray.key, volume: false }
}
const volumeDeposit = (body: number, lost: Spectrum, ray: Ray, src: number, x: number, y: number): Deposit => ({
	body,
	prim: -1,
	x,
	y,
	dx: ray.dx,
	dy: ray.dy,
	nx: 0,
	ny: 0,
	incident: new Float64Array(NB),
	absorbed: lost,
	scattered: new Float64Array(NB),
	nm: ray.nm,
	src,
	root: 0,
	key: ray.key,
	volume: true
})

/**
 * Refraction at a dielectric's face (entering `w`, or leaving it): white light first splits into its bands (each refracts at its own
 * index); then Snell's law, the unpolarised Fresnel reflectance (pushed as a reflected ray when it is worth following), total internal
 * reflection past the critical angle. Returns true when the ray goes on (it may have turned into a reflection).
 */
const refract = (
	ray: Ray,
	w: WBody,
	prim: number,
	enter: boolean,
	nxo: number,
	nyo: number,
	bodies: readonly WBody[],
	stack: Ray[],
	rootPower: number,
	segs: Segment[],
	keepSegs: boolean
): boolean => {
	void segs
	void keepSegs
	// the media on each side
	const here = ray.inside.length > 0 ? mediumIn(ray.inside, bodies) : undefined
	let afterInside: number[]
	if (enter) afterInside = [...ray.inside, w.index]
	else afterInside = ray.inside.filter((i) => i !== w.index)
	const there = afterInside.length > 0 ? mediumIn(afterInside, bodies) : undefined
	// white light splits into its bands at the first surface where the index depends on the wavelength
	if (ray.nm === 0 && (here !== undefined || there !== undefined)) {
		let first = -1
		for (let b = NB - 1; b >= 0; b--) {
			if ((ray.p[b] as number) <= 0) continue
			if (first < 0) {
				first = b
				continue
			}
			const p = new Float64Array(NB)
			p[b] = ray.p[b] as number
			if (total(p) < rootPower * LIMITS.cutoff * 0.05) continue
			const child: Ray = { ox: ray.ox, oy: ray.oy, dx: ray.dx, dy: ray.dy, p, nm: (BANDS[b] as { nm: number }).nm, env: cloneEnv(ray.env), inside: ray.inside.slice(), key: (ray.key * 16 + b + 1) | 0, depth: ray.depth, beam: ray.beam }
			if (refract(child, w, prim, enter, nxo, nyo, bodies, stack, rootPower, segs, keepSegs)) stack.push(child)
		}
		if (first < 0) return false
		for (let b = 0; b < NB; b++) if (b !== first) ray.p[b] = 0
		ray.nm = (BANDS[first] as { nm: number }).nm
		ray.key = (ray.key * 16 + first + 1) | 0
	}
	// a round lens's face cuts the tube to its height out of the plane
	if (w.src.aperture !== undefined && enter) clipTo(ray.env, chord(w, ray.ox, ray.oy), ray.p)
	const n1 = nAt(here, ray.nm)
	const n2 = nAt(there, ray.nm)
	// the normal against the ray
	let nx = nxo
	let ny = nyo
	let ci = -(ray.dx * nx + ray.dy * ny)
	if (ci < 0) {
		nx = -nx
		ny = -ny
		ci = -ci
	}
	const eta = n1 / n2
	const k = 1 - eta * eta * (1 - ci * ci)
	const prim0 = w.prims[prim] as WPrim
	if (k < 0) {
		// total internal reflection
		if (TIR !== null && w.index < TIR.length) TIR[w.index] = (TIR[w.index] as number) + 1
		ray.dx += 2 * ci * nx
		ray.dy += 2 * ci * ny
		if (prim0.sph) {
			const R = curvatureToward(prim0, ray.ox, ray.oy, ray.dx, ray.dy)
			const phi = (2 * ci) / R
			ray.env.G -= ray.env.Y * phi
			ray.env.Gc -= ray.env.Yc * phi
		}
		ray.key = (ray.key * 3 + 2) | 0
		return total(ray.p) >= rootPower * LIMITS.cutoff
	}
	const ct = Math.sqrt(k)
	const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct)
	const rp = (n1 * ct - n2 * ci) / (n1 * ct + n2 * ci)
	const R = (rs * rs + rp * rp) / 2
	// the reflected part, when it is worth following
	const pr = new Float64Array(NB)
	for (let b = 0; b < NB; b++) pr[b] = (ray.p[b] as number) * R
	// (followed for beams: a laser's or the sun's weak reflection off glass shows; a lamp's or a torch's 4 % reflections are not followed:
	// they only spread faint light about, and would double the rays)
	if (ray.beam && total(pr) >= rootPower * LIMITS.cutoff) {
		const env = cloneEnv(ray.env)
		const rdx = ray.dx + 2 * ci * nx
		const rdy = ray.dy + 2 * ci * ny
		if (prim0.sph) {
			const Rr = curvatureToward(prim0, ray.ox, ray.oy, rdx, rdy)
			const phi = (2 * ci) / Rr
			env.G -= env.Y * phi
			env.Gc -= env.Yc * phi
		}
		stack.push({ ox: ray.ox, oy: ray.oy, dx: rdx, dy: rdy, p: pr, nm: ray.nm, env, inside: ray.inside.slice(), key: (ray.key * 3 + 2) | 0, depth: ray.depth, beam: ray.beam })
	}
	for (let b = 0; b < NB; b++) ray.p[b] = (ray.p[b] as number) * (1 - R)
	const tdx = eta * ray.dx + (eta * ci - ct) * nx
	const tdy = eta * ray.dy + (eta * ci - ct) * ny
	const tl = Math.sqrt(tdx * tdx + tdy * tdy)
	ray.dx = tdx / tl
	ray.dy = tdy / tl
	// out of the plane: n2·G' = n1·G − Y·Φ, Φ = (n2 cos θt − n1 cos θi)/R on a round face (Coddington's sagittal equation), 0 on a flat one
	let phi = 0
	if (prim0.sph) phi = (n2 * ct - n1 * ci) / curvatureToward(prim0, ray.ox, ray.oy, ray.dx, ray.dy)
	ray.env.G = (n1 * ray.env.G - ray.env.Y * phi) / n2
	ray.env.Gc = (n1 * ray.env.Gc - ray.env.Yc * phi) / n2
	ray.inside = afterInside
	ray.key = (ray.key * 3) | 0
	return total(ray.p) >= rootPower * LIMITS.cutoff
}

// ------------------------------------------------------------------ helpers for builders and tests

/** A slab's outline (width w, height h, centred): right, top, left, bottom faces = prims 0..3. */
export const slabPrims = (w: number, h: number): Prim[] => [
	{ k: "half", nx: 1, ny: 0, d: w / 2 },
	{ k: "half", nx: 0, ny: 1, d: h / 2 },
	{ k: "half", nx: -1, ny: 0, d: w / 2 },
	{ k: "half", nx: 0, ny: -1, d: h / 2 }
]
/** A convex polygon's outline (points counter-clockwise): face i runs from point i to point i + 1. */
export const polygonPrims = (pts: readonly { x: number; y: number }[]): Prim[] =>
	pts.map((p, i) => {
		const q = pts[(i + 1) % pts.length] as { x: number; y: number }
		const ex = q.x - p.x
		const ey = q.y - p.y
		const l = Math.sqrt(ex * ex + ey * ey)
		const nx = ey / l
		const ny = -ex / l
		return { k: "half" as const, nx, ny, d: nx * p.x + ny * p.y }
	})

/**
 * A lens's radius of curvature for a focal length (thick symmetric lens, lensmaker's equation 1/f = (n−1)(2/R − (n−1)t/(nR²)) [HEC
 * eq. 6.2]) given its diameter and edge (convex) or centre (concave) thickness: by fixed-point iteration (the thickness follows R's sag).
 * Returns {R, t} (R > 0 for both faces bulging out: a converging lens; R < 0: a diverging one, faces hollowed in).
 */
export const lensShape = (f: number, n: number, diameter: number, minThickness: number) => {
	const h = diameter / 2
	let R = 2 * (n - 1) * f // thin-lens start
	let t = minThickness
	for (let i = 0; i < 60; i++) {
		const r = Math.abs(R)
		const sag = r > h ? r - Math.sqrt(r * r - h * h) : r
		t = f > 0 ? minThickness + 2 * sag : minThickness
		// solve 1/f = (n−1)(2/R − (n−1)t/(nR²)) for R: (1/f)R² − 2(n−1)R + (n−1)²t/n = 0
		const a = 1 / f
		const b = -2 * (n - 1)
		const c = ((n - 1) * (n - 1) * t) / n
		const disc = b * b - 4 * a * c
		const next = disc >= 0 ? (-b + Math.sqrt(disc)) / (2 * a) : R
		if (Math.abs(next - R) < 1e-15) {
			R = next
			break
		}
		R = next
	}
	return { R, t }
}

// ------------------------------------------------------------------ the document's optics record → bodies and sources

/** Natural logarithm from + − × ÷ alone (x = m·2^e, ln m = 2·atanh((m − 1)/(m + 1)) by its series). */
export const ln = (x: number): number => {
	if (Number.isNaN(x) || x < 0) return NaN
	if (x === 0) return -Infinity
	if (x === Infinity) return Infinity
	let m = x
	let e = 0
	while (m >= 4294967296) {
		m /= 4294967296
		e += 32
	}
	while (m < 2.3283064365386963e-10) {
		m *= 4294967296
		e -= 32
	}
	while (m >= 1.4142135623730951) {
		m /= 2
		e += 1
	}
	while (m < 0.7071067811865476) {
		m *= 2
		e -= 1
	}
	const s = (m - 1) / (m + 1)
	const s2 = s * s
	let sum = 1 / 27
	for (let k = 12; k >= 0; k--) sum = 1 / (2 * k + 1) + s2 * sum
	return e * LN2_HI + (2 * s * sum + e * LN2_LO)
}

/** An sRGB channel (0..1) in linear light (IEC 61966-2-1). */
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : exp(2.4 * ln((c + 0.055) / 1.055)))

/** A hex colour's linear-light RGB, or undefined. */
export const linearRGB = (hex: string | undefined): [number, number, number] | undefined => {
	if (typeof hex !== "string") return undefined
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
	if (m === null) return undefined
	const v = Number.parseInt(m[1] as string, 16)
	return [linear(((v >> 16) & 255) / 255), linear(((v >> 8) & 255) / 255), linear((v & 255) / 255)]
}

/** Looks whose surfaces are metal: little of the light they meet is absorbed (provisional: brushed steel and aluminium 0.3 in the visible,
 *  0.1 in the infrared; thermal's metals 0.1-0.3). */
const METAL_LOOKS = new Set(["steel", "aluminium", "chrome", "brass", "copper"])

/**
 * An opaque surface's absorptance per band from its colour: each band's reflectance from the linear-light channel that colour shows
 * (violet and blue: B; cyan: (G + B)/2; green: G; yellow: (R + G)/2; orange: (3R + G)/4; red: R), the infrared's from the luminance
 * Y = 0.2126 R + 0.7152 G + 0.0722 B (a grey-body guess, provisional); absorptance = 1 − reflectance, kept within 0.05-0.97, so white
 * paint absorbs about a quarter of sunlight and black paint nearly all [INC Table A.12] (thermal's α = 1 − Y is the same rule).
 */
export const absorptanceOf = (hex: string | undefined, look?: string): number[] => {
	if (look !== undefined && METAL_LOOKS.has(look)) return [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.1]
	const rgb = linearRGB(hex) ?? [0.5, 0.5, 0.5]
	const [R, G, B] = rgb
	const refl = [B, B, (G + B) / 2, G, (R + G) / 2, (3 * R + G) / 4, R, 0.2126 * R + 0.7152 * G + 0.0722 * B]
	return refl.map((r) => Math.min(0.97, Math.max(0.05, 1 - r)))
}

/** A solid as the optics record's reader needs it: its body and size (the engine's SolidPart and the document's solid both have these). */
export interface SolidShape {
	readonly id: string
	readonly item?: string
	readonly body:
		| { readonly kind: "ball"; readonly radius: number }
		| { readonly kind: "slab"; readonly width: number; readonly height: number; readonly depth: number; readonly taper?: number }
		| { readonly kind: "polygon"; readonly points: readonly { readonly x: number; readonly y: number }[]; readonly depth: number }
	readonly shape?: string
	readonly length?: number
}

/** One body of the record (see the module's CONTRACT section): which solid, its role, and what that role needs. */
export interface BodyRecord {
	readonly solid: string
	readonly item?: string
	readonly role: Role
	/** a custom outline: [kind, a, b, c, sph?] with kind "half" (nx, ny, d) | "disk" | "hole" (cx, cy, r), in the solid's own frame */
	readonly prims?: readonly (readonly [string, number, number, number, number?])[]
	readonly faces?: readonly number[]
	readonly medium?: string
	readonly color?: string
	readonly look?: string
	readonly absorb?: readonly number[]
	readonly reflect?: readonly number[]
	readonly pass?: readonly number[]
	readonly eff?: readonly number[]
	readonly transmit?: number
	readonly blur?: number
	/** half its depth out of the plane (m), when not its solid's own */
	readonly half?: number
	/** a sensor's window: half its width along its face (m) */
	readonly window?: number
	/** [cx, cy, ax, ay, r]: a round element's axis point, axis direction and radius */
	readonly aperture?: readonly [number, number, number, number, number]
	/** a dielectric's own nD (salt water by its salt) */
	readonly nd?: number
	/** a liquid's rank (a container's layers: 1 at the bottom, higher above) */
	readonly liquid?: number
	/** a liquid's live surfaces: {item, top?, bottom?, floor, up} (LevelRule) */
	readonly level?: { readonly item: string; readonly top?: string; readonly bottom?: string; readonly floor: number; readonly up?: number }
}

export interface SourceRecord {
	readonly id: string
	readonly item: string
	readonly solid: string
	readonly kind: SourceKind
	readonly x: number
	readonly y: number
	/** rad (own frame), or a direction vector {x, y} (the heat module's lamp gives one) */
	readonly dir: number | { readonly x: number; readonly y: number }
	readonly spread: number
	readonly out: number
	readonly round?: boolean
	readonly size: number
	readonly blur: number
	/** W per band (the sun: W/m² per band); else from light + lumens / watts, a laser's nm + mw, the sun's irradiance (powerOf) */
	readonly power?: readonly number[]
	/** sunlight: its rays start this far (m) behind the source's point, up-sun */
	readonly back?: number
	readonly nm?: number
	readonly rays?: number
	/** switched on at (s; default 0) and off at (s; default never); `on: false`: never on */
	readonly on?: boolean
	readonly on_at?: number
	readonly off_at?: number
	/** its light follows another module's reading of an item (a bulb's `light` against rated: circuits): level = reading × scale */
	readonly drive?: { readonly item: string; readonly key: string; readonly scale?: number }
	/** a blink pattern from on_at: on, off, on, off ... durations (s), played once or, with `repeat`, over and over (a torch's Morse) */
	readonly blink?: readonly number[]
	readonly repeat?: boolean
	/** a blink pattern's dot length (s): what a receiver reads its flashes back in */
	readonly dot?: number
}

export interface OpticsRecord {
	readonly kind: "optics"
	readonly id: string
	readonly sources: readonly SourceRecord[]
	readonly bodies: readonly BodyRecord[]
}

/** The outline of a solid's own body (slab, tapered slab, polygon, ball) as prims; a slab's faces are right, top, left, bottom (0..3). */
export const bodyPrims = (s: SolidShape): Prim[] => {
	const b = s.body
	if (b.kind === "ball") return [{ k: "disk", cx: 0, cy: 0, r: b.radius }]
	if (b.kind === "polygon") return polygonPrims(b.points)
	if (b.taper !== undefined && b.taper !== 1) {
		// taper = bottom width ÷ top width, centred: a trapezoid (right, top, left, bottom faces)
		const top = b.width
		const bot = b.width * b.taper
		const h = b.height
		return polygonPrims([
			{ x: -bot / 2, y: -h / 2 },
			{ x: bot / 2, y: -h / 2 },
			{ x: top / 2, y: h / 2 },
			{ x: -top / 2, y: h / 2 }
		]).map((p, i, all) => all[[1, 2, 3, 0][i] as number] as Prim)
	}
	return slabPrims(b.width, b.height)
}

/** Half a solid's depth out of the plane (m): a slab's or polygon's depth / 2, a ball's radius, a lying cylinder's length / 2. */
export const halfDepthOf = (s: SolidShape) => {
	const b = s.body
	if (b.kind === "ball") return s.shape === "cylinder" && s.length !== undefined ? s.length / 2 : b.radius
	return b.depth / 2
}

const unit = (v: { readonly x: number; readonly y: number }) => {
	const l = Math.sqrt(v.x * v.x + v.y * v.y)
	return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 }
}
const fill8 = (a: readonly number[] | undefined, d: number) => {
	const out = new Array<number>(NB).fill(d)
	if (a !== undefined) for (let i = 0; i < NB && i < a.length; i++) out[i] = a[i] as number
	return out
}

/** A record's level rule, checked: {level} or undefined. */
const levelRule = (L: BodyRecord["level"]): { level: LevelRule } | undefined => {
	if (L === undefined || L === null || typeof L !== "object" || typeof L.item !== "string" || !(typeof L.floor === "number" && Number.isFinite(L.floor))) return undefined
	const key = (k: unknown) => (typeof k === "string" && k.length > 0 ? k : undefined)
	const top = key(L.top)
	const bottom = key(L.bottom)
	const up = typeof L.up === "number" && Number.isFinite(L.up) ? L.up : 0
	return { level: { item: L.item, ...(top === undefined ? {} : { top }), ...(bottom === undefined ? {} : { bottom }), floor: L.floor, up } }
}

/** The record's bodies and sources, with each body's outline and depth taken from its solid (solids the record names but the scene
 *  lacks are left out). */
export const sceneFromRecord = (rec: OpticsRecord, solidOf: (id: string) => SolidShape | undefined): { bodies: OpticBody[]; sources: OpticSource[] } => {
	const bodies: OpticBody[] = []
	for (const [tag, b] of (rec.bodies ?? []).entries()) {
		const s = solidOf(b.solid)
		if (s === undefined) continue
		const prims: Prim[] =
			b.prims !== undefined
				? b.prims.map((p) =>
						p[0] === "half"
							? { k: "half" as const, nx: p[1], ny: p[2], d: p[3] }
							: { k: p[0] === "hole" ? ("hole" as const) : ("disk" as const), cx: p[1], cy: p[2], r: p[3], sph: p[4] === 1 }
					)
				: bodyPrims(s)
		const role = b.role
		bodies.push({
			id: b.solid,
			tag,
			item: b.item ?? s.item ?? b.solid.split("/")[0] ?? b.solid,
			role,
			prims,
			halfDepth: b.half ?? halfDepthOf(s),
			...(b.medium === undefined ? {} : { medium: b.medium }),
			...(b.faces === undefined ? {} : { faces: b.faces }),
			...(b.reflect === undefined ? {} : { reflect: fill8(b.reflect, 0.9) }),
			...(b.pass === undefined ? {} : { pass: fill8(b.pass, 1) }),
			...(b.eff === undefined ? {} : { efficiency: fill8(b.eff, 0) }),
			absorb: b.absorb !== undefined ? fill8(b.absorb, 0.5) : absorptanceOf(b.color, b.look),
			...(b.transmit === undefined ? {} : { transmit: b.transmit }),
			...(b.blur === undefined ? {} : { blur: b.blur }),
			...(b.window === undefined ? {} : { window: b.window }),
			...(b.aperture === undefined ? {} : { aperture: { cx: b.aperture[0], cy: b.aperture[1], ax: b.aperture[2], ay: b.aperture[3], r: b.aperture[4] } }),
			...(typeof b.nd === "number" && Number.isFinite(b.nd) ? { nd: b.nd } : {}),
			...(typeof b.liquid === "number" && Number.isFinite(b.liquid) ? { liquid: b.liquid } : {}),
			...(levelRule(b.level) ?? {})
		})
	}
	const sources: OpticSource[] = (rec.sources ?? []).map((r) => ({
		id: r.id,
		item: r.item,
		solid: r.solid,
		kind: r.kind,
		x: r.x,
		y: r.y,
		dir: typeof r.dir === "number" ? r.dir : 0,
		...(typeof r.dir === "object" && r.dir !== null ? { dirVec: unit(r.dir) } : {}),
		spread: r.spread,
		outSpread: r.out,
		round: r.round === true,
		size: r.size,
		blur: r.blur,
		power: powerOf(r),
		back: r.back ?? 0,
		nm: r.nm ?? 0,
		rays: r.rays ?? (r.kind === "laser" ? 1 : 64)
	}))
	return { bodies, sources }
}

/** A source's level at time t from its switch times and its blink pattern (the drive, another module's reading, is the caller's): 0 or 1. */
export const switchedOn = (r: SourceRecord, t: number) => {
	const on = r.on === false ? 0 : t + 1e-9 >= (r.on_at ?? 0) && (r.off_at === undefined || t < r.off_at) ? 1 : 0
	if (on === 0 || !Array.isArray(r.blink) || r.blink.length === 0) return on
	return blinkOn(r.blink, r.repeat === true, t - (r.on_at ?? 0))
}

/** Whether a blink pattern (on, off, on ... durations, s) is on at time tau into it (played once, or repeated). */
export const blinkOn = (blink: readonly number[], repeat: boolean, tau: number) => {
	let total = 0
	for (const d of blink) total += typeof d === "number" && d > 0 ? d : 0
	if (!(total > 0)) return 1
	let u = tau + 1e-9
	if (u < 0) return 0
	if (repeat) u -= total * Math.floor(u / total)
	else if (u >= total) return 0
	let acc = 0
	for (let i = 0; i < blink.length; i++) {
		const d = blink[i] as number
		acc += typeof d === "number" && d > 0 ? d : 0
		if (u < acc) return i % 2 === 0 ? 1 : 0
	}
	return 0
}

// ------------------------------------------------------------------ seeing: an eye's look, traced backwards

/**
 * What an eye sees (light travels both ways along a ray, so the eye's view is traced from the eye): rays from its pupil across its field
 * of view, refracting through glass and reflecting off mirrors as light would, each ending on the first thing that stops light. The eye
 * sees a thing when such a ray ends on it and it scatters visible light (it is lit), or when a source's light lands on the eye itself
 * (it looks at the light). Returns the items seen, each with the share of the eye's rays that end on it, and the mirrors on the way.
 */
export const look = (
	result: Result,
	eyeBody: number,
	opts: { readonly fovHalf: number; readonly pupil: number; readonly dir?: number; readonly rays?: number; readonly minLumens?: number; readonly sourceItems: readonly string[] }
): { item: string; share: number; via: string[] }[] => {
	const bodies = result.placed as WBody[]
	const eye = bodies[eyeBody]
	if (eye === undefined) return []
	const n = Math.max(3, opts.rays ?? 241)
	const minLm = opts.minLumens ?? 1e-4
	const seen = new Map<string, { item: string; count: number; via: Set<string> }>()
	const add = (item: string, via: string[], w: number) => {
		const e = seen.get(item) ?? { item, count: 0, via: new Set<string>() }
		e.count += w
		for (const v of via) e.via.add(v)
		seen.set(item, e)
	}
	// its own light: sources whose light lands on the eye
	for (const d of result.deposits) {
		if (d.body !== eyeBody || d.volume) continue
		let v = 0
		for (let b = 0; b < IR; b++) v += d.incident[b] as number
		const src = opts.sourceItems[d.src]
		if (v > 0 && src !== undefined) add(src, [], 0)
	}
	// the pupil: on the eye's outline, facing along its solid's angle turned by `dir`
	const [sd, cd] = sincos(opts.dir ?? 0)
	const fca = eye.ca * cd - eye.sa * sd
	const fsa = eye.sa * cd + eye.ca * sd
	const px = eye.ox + fca * opts.pupil
	const py = eye.oy + fsa * opts.pupil
	const h: Hit = { t: Infinity, prim: -1, enter: false, body: -1 }
	for (let i = 0; i < n; i++) {
		const off = opts.fovHalf * ((2 * i) / (n - 1) - 1)
		const [so, co] = sincos(off)
		let dx = fca * co - fsa * so
		let dy = fsa * co + fca * so
		let ox = px
		let oy = py
		const inside: number[] = []
		const via: string[] = []
		for (let seg = 0; seg < LIMITS.branchSegments; seg++) {
			let best = FAR
			let hb = -1
			let hp = -1
			let he = false
			for (const w of bodies) {
				if (w.index === eyeBody) continue
				if (crossing(w, ox, oy, dx, dy, best, h)) {
					best = h.t
					hb = h.body
					hp = h.prim
					he = h.enter
				}
			}
			if (hb < 0) break
			const w = bodies[hb] as WBody
			const x = ox + dx * best
			const y = oy + dy * best
			const [nx0, ny0] = normalAt(w, hp, x, y)
			ox = x
			oy = y
			const role = w.src.role
			if (role === "glass") {
				if (he === inside.includes(hb)) continue
				const here = inside.length > 0 ? mediumIn(inside, bodies) : undefined
				const after = he ? [...inside, hb] : inside.filter((k) => k !== hb)
				const there = after.length > 0 ? mediumIn(after, bodies) : undefined
				const n1 = nAt(here, 555)
				const n2 = nAt(there, 555)
				let nx = nx0
				let ny = ny0
				let ci = -(dx * nx + dy * ny)
				if (ci < 0) {
					nx = -nx
					ny = -ny
					ci = -ci
				}
				const eta = n1 / n2
				const k = 1 - eta * eta * (1 - ci * ci)
				if (k < 0) {
					dx += 2 * ci * nx
					dy += 2 * ci * ny
					continue
				}
				const ct = Math.sqrt(k)
				const tx = eta * dx + (eta * ci - ct) * nx
				const ty = eta * dy + (eta * ci - ct) * ny
				const tl = Math.sqrt(tx * tx + ty * ty)
				dx = tx / tl
				dy = ty / tl
				inside.length = 0
				inside.push(...after)
				continue
			}
			if (role === "filter" || (role === "translucent" && !he)) continue
			if (role === "mirror" && w.faces[hp] === 1 && he) {
				const c = dx * nx0 + dy * ny0
				dx -= 2 * c * nx0
				dy -= 2 * c * ny0
				if (!via.includes(w.src.item)) via.push(w.src.item)
				continue
			}
			if (!he) continue
			// it stops here: seen when it is lit (it scatters visible light)
			if ((result.scatteredLm[hb] as number) >= minLm) add(w.src.item, via, 1)
			break
		}
	}
	return [...seen.values()].map((e) => ({ item: e.item, share: e.count / n, via: [...e.via] }))
}

/** How a lamp's beam power splits into visible light: incandescent 10 of its 82 % radiated [IES], halogen 0.15 (provisional), LED all. */
export const VISIBLE_SHARE: Readonly<Record<string, number>> = { incandescent: 10 / 82, halogen: 0.15, led: 1, white: 1, sun: 1 }
/** Sunlight at the ground per W/m² stated (AM1.5 global): 0.50 in 380-750 nm, 0.465 past 750 nm (the ~3.5 % below 380 nm is left out) [ASTM]. */
export const SUN_VISIBLE = 0.5
export const SUN_INFRARED = 0.465

const numOr = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)

/**
 * A source record's power per band (W; the sun: W/m²) from what the record states: `power` (8 numbers), or a laser's `nm` and `mw`, or the
 * sun's `irradiance`, or a lamp's `watts` (its beam's radiant power, split by its light kind), or `lumens` of a light kind (+ `infrared` W).
 */
export const powerOf = (r: SourceRecord): Float64Array => {
	if (Array.isArray(r.power)) return Float64Array.from({ length: NB }, (_, b) => numOr(r.power[b], 0))
	const rr = r as SourceRecord & { light?: string; lumens?: number; watts?: number; irradiance?: number; mw?: number; infrared?: number }
	if (r.kind === "laser") {
		const p = new Float64Array(NB)
		p[bandOf(numOr(r.nm, 650))] = numOr(rr.mw, 1) / 1000
		return p
	}
	const kind = (typeof rr.light === "string" && rr.light in LIGHTS ? rr.light : "white") as LightKind
	if (r.kind === "sun") {
		const E = numOr(rr.irradiance, 1000)
		return sourceSpectrum({ kind: "sun", visible: E * SUN_VISIBLE, infrared: E * SUN_INFRARED })
	}
	if (typeof rr.watts === "number") {
		const share = VISIBLE_SHARE[kind] ?? 1
		const w = Math.max(0, rr.watts)
		return sourceSpectrum({ kind, visible: w * share, infrared: w * (1 - share) })
	}
	return sourceSpectrum({ kind, lumens: Math.max(0, numOr(rr.lumens, 0)), ...(typeof rr.infrared === "number" ? { infrared: rr.infrared } : {}) })
}
