"""Light and optics (the optics module): light sources, mirrors, lenses, prisms, glass blocks, filters, material panels, screens, light
meters, light targets, an eye and the sun. web/sim/modules/optics.js is the exact port (the same document, number for number).

The builders here only describe: each item's solids carry an `optics` dict (its optical role: a mirror's silvered face, a lens's two
spherical faces, a sensor's face...) and its light sources a `light` dict; the build hook (after every item is built) gathers them, and
every other solid the light can meet (a ball, a book, the table: opaque, absorbing by its colour; glass, PET and ice: refracting), into ONE
process record {kind: "optics", id: "optics", sources, bodies, names} that tooling/src/sim/modules/optics.ts traces (tooling/src/sim/optics.ts,
the 2D ray tracer) and the 3D view draws (web/models/mod-optics.js). A scene without any light item gets nothing (its document is as before).
The desk lamp of the heat module (its `heat` record of role "lamp") is the same item: its light is added here as a source.

Values and sources (keys as in tooling/src/sim/optics.ts):
  flashlight: 2 × AA LED torch, 15 cm × Ø 3 cm, 150 lm, 20° beam (typical; ANSI/PLATO FL1 ratings); white LED light.
  laser pointer: 650 nm red (or 532 green, 405 violet), 1 mW (class 2 ≤ 1 mW visible [IEC60825]), beam Ø 1.5 mm, divergence 1 mrad full.
  mirror: back-silvered glass, reflectance 0.9 in the visible ("aluminium ≈ 0.9 visible" [HEC]; silver 0.95, provisional 0.92 infrared).
  lenses: N-BK7 nd 1.5168, F2 nd 1.62004 [SCHOTT], acrylic 1.4917; radii by the thick-lens lensmaker's equation [HEC eq. 6.2].
  prism: 60° equilateral; semicircular block (total internal reflection past asin(1/n) = 41.2° in BK7).
  screen: white card (diffuse reflectance ≈ 0.8: colour #e8e6df is 0.8 in linear light).
  material panels: clear glass (n 1.52, two 4 % reflections [HEC §4.6]), clear acrylic, frosted glass (≈ 0.8 diffuse, provisional), wax paper
  (≈ 0.5), tissue paper (≈ 0.4) (spec range 0.3-0.7, approximate), cardboard and black cloth (opaque), aluminium foil (specular ≈ 0.8).
  colour filters: dye gels, ≈ 0.85-0.9 in their band, ≈ 0.02 outside (typical theatrical gel curves, Rosco/Lee; provisional).
  light meter: a lux meter, 1 cm sensor face, 0 … 100 000 lx (CIE photopic [CIE]); the sun: 1000 W/m² at the ground [ASTM-G173].
  coloured torches: one-colour LEDs (red 640 nm, green 525 nm, blue 465 nm [SCHUBERT]); blink patterns in Morse code (ITU-R M.1677-1:
  a dash is 3 dots, 1 dot between a letter's signs, 3 between letters, 7 between words) or 1s and 0s of one dot each.
  liquids (the liquids module's containers): each layer refracts with its own index (water nD 1.333 [CRC], salt water by its salt, sea
  water 1.3394 [QF], oil 1.4735 [CODEX], corn syrup ≈ 1.49, honey 1.491 [CHATAWAY], soap ≈ 1.37, rubbing alcohol ≈ 1.372; tooling/src/sim/optics.ts).
  circuit bulbs and LEDs (the circuits module's): light ∝ the circuit's `light` reading (against rated); a torch bulb ≈ 8.4 lm/W at its
  rating (a PR2 2.38 V 0.5 A bulb is rated 0.8 MSCP ≈ 10 lm), ≈ 77 % of its power as infrared (82 % radiated [IES], provisional); a 5 mm LED
  at 20 mA: red 0.5 lm, yellow 0.5, green 1.5, blue 0.4, white 4 lm in a 30° cone (typical data sheets, e.g. Kingbright WP7113; provisional).
"""
import math

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "register_goal_kind", "register_build_hook", "MATERIALS", "add_look",
          "LOOK_FILL", "props_of", "TYPES", "CATEGORIES", "D2R")
HEAT_KINDS = set()
CAT = "Light & optics"

# the module's own constants (tooling/src/sim/optics.ts reads the record; these are what the builders write into it)
GLASS_ND = {"crown glass": 1.5168, "flint glass": 1.62004, "acrylic": 1.4917}      # [SCHOTT] N-BK7, F2; PMMA
GLASS_DENSITY = {"crown glass": 2510, "flint glass": 3610, "acrylic": 1190, "water": 998}      # kg/m³ [SCHOTT]; PMMA 1190; water 998 [IAPWS-95]
BLOCK_MEDIA = ["crown glass", "flint glass", "acrylic", "water"]   # a glass block's choices (water: a thin clear cell of water)
# a torch's light: its white LED, or a one-colour LED (tooling/src/sim/optics.ts LIGHTS)
TORCH_LIGHT = {"white": "led", "red": "led-red", "green": "led-green", "blue": "led-blue"}
# a coloured torch's light until its lumens are set: red, green and blue that mix to white (D65) as the ITU-R BT.2020 primaries do
# (630, 532, 467 nm: luminance shares 0.2627, 0.6780, 0.0593 [BT2020]), so red + green look yellow and all three white
TORCH_LUMENS = {"white": 150.0, "red": 40.0, "green": 100.0, "blue": 10.0}
# Morse code (ITU-R M.1677-1): letters and digits
MORSE = {"A": ".-", "B": "-...", "C": "-.-.", "D": "-..", "E": ".", "F": "..-.", "G": "--.", "H": "....", "I": "..", "J": ".---", "K": "-.-",
         "L": ".-..", "M": "--", "N": "-.", "O": "---", "P": ".--.", "Q": "--.-", "R": ".-.", "S": "...", "T": "-", "U": "..-", "V": "...-",
         "W": ".--", "X": "-..-", "Y": "-.--", "Z": "--..", "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
         "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----."}
MORSE_TEXT = {v: k for k, v in MORSE.items()}
REPEAT_GAP = 10     # dots of darkness between repeats of a pattern (more than a word's 7, so a receiver tells the message's end)
# the liquids module's liquids as media (tooling/src/sim/optics.ts MEDIA); a liquid not listed refracts as water
LIQUID_MEDIUM = {"water": "water", "salt water": "salt water", "sea water": "sea water", "vegetable oil": "vegetable oil",
                 "corn syrup": "corn syrup", "honey": "honey", "dish soap": "dish soap", "rubbing alcohol": "rubbing alcohol"}
LIQUID_OVER = 1e-5   # m: a liquid reaches this far into its container's walls and floor and into the layer above (where they meet)
# circuit bulbs and LEDs as light sources (see the header)
BULB_LM_PER_W = 8.4
BULB_IR_PER_W = 0.77
LED_LUMENS = {"red": 0.5, "yellow": 0.5, "green": 1.5, "blue": 0.4, "white": 4.0}
LED_LIGHT = {"red": "led-red", "yellow": "led-yellow", "green": "led-green", "blue": "led-blue", "white": "led"}
LED_HALF = 0.261799   # rad: 15°, half a 30° viewing angle
LASER_NM = {"red": 650.0, "green": 532.0, "violet": 405.0}
# colour filters: transmittance per band (violet, blue, cyan, green, yellow, orange, red, infrared), provisional dye-gel curves
FILTERS = {
    "red": [0.02, 0.02, 0.02, 0.02, 0.05, 0.45, 0.88, 0.9],
    "orange": [0.02, 0.02, 0.02, 0.05, 0.4, 0.85, 0.88, 0.9],
    "yellow": [0.02, 0.03, 0.1, 0.8, 0.88, 0.88, 0.88, 0.9],
    "green": [0.02, 0.1, 0.6, 0.85, 0.4, 0.05, 0.02, 0.6],
    "cyan": [0.3, 0.85, 0.88, 0.8, 0.2, 0.03, 0.02, 0.6],
    "blue": [0.7, 0.85, 0.4, 0.05, 0.02, 0.02, 0.02, 0.6],
    "violet": [0.85, 0.5, 0.05, 0.02, 0.02, 0.02, 0.1, 0.6],
    "magenta": [0.8, 0.7, 0.1, 0.02, 0.05, 0.4, 0.88, 0.9],
}
FILTER_COLOR = {"red": "#d81e1e", "orange": "#f07818", "yellow": "#f2d21b", "green": "#1fa83a", "cyan": "#1cb8c8", "blue": "#2348d8",
                "violet": "#7a2bd0", "magenta": "#d42aa8"}
# material panels: thickness (m), role and its numbers, colour
PANELS = {
    "clear glass": dict(t=0.003, role="glass", medium="crown glass", color="#cfe6ec", material="optical glass"),
    "clear plastic": dict(t=0.003, role="glass", medium="acrylic", color="#e2eef0", material="optical glass"),
    "frosted glass": dict(t=0.003, role="translucent", transmit=0.8, blur=0.6, color="#e6eef0", material="optical glass"),
    "wax paper": dict(t=0.001, role="translucent", transmit=0.5, blur=0.8, color="#f1ead2", material="card"),
    "tissue paper": dict(t=0.001, role="translucent", transmit=0.4, blur=1.0, color="#f6f4ee", material="card"),
    "white card": dict(t=0.002, role="opaque", color="#ecebe4", material="card"),
    "cardboard": dict(t=0.004, role="opaque", color="#c9a26b", material="card"),
    "aluminium foil": dict(t=0.001, role="mirror", reflect=0.8, color="#d0d4d8", material="aluminium"),
    "black cloth": dict(t=0.002, role="opaque", color="#151515", material="card"),
    "wood": dict(t=0.006, role="opaque", color="#c8955a", material="card"),
}
# the bulbs of the heat module's lamp: how its beam's radiant power splits (visible share; the tracer's light kinds)
LAMP_LIGHT = {"incandescent": "incandescent", "halogen": "halogen", "led": "led"}
# materials the light refracts in (by the solid's material) and looks (by its look) of things built by other catalogs
MEDIUM_OF_MATERIAL = {"glass": "crown glass", "PET": "PET", "ice": "ice", "glass marble": "crown glass", "optical glass": "crown glass",
                      "flint glass": "flint glass", "acrylic": "acrylic", "water": "water"}
MEDIUM_OF_LOOK = {"glass": "crown glass", "ice": "ice", "marble": "crown glass", "water": "water", "lens glass": "crown glass"}
TRANSLUCENT_MATERIAL = {"tissue paper": (0.4, 1.0)}


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    HEAT_KINDS.clear()
    if "lamp" in TYPES and TYPES["lamp"].module == "heat":     # (the heat module is loaded: it comes before this one, in name order)
        HEAT_KINDS.add("heat")
    if CAT not in CATEGORIES:
        CATEGORIES.append(CAT)
    _looks()
    _materials()
    _types()
    register_build_hook(build_hook)
    for kind, fn in (("hits_target", goal_hits_target), ("lit", goal_lit), ("dark", goal_dark), ("shadow_on", goal_shadow_on),
                     ("sees", goal_sees), ("brighter", goal_brighter), ("focused", goal_focused), ("rainbow", goal_rainbow),
                     ("receives", goal_receives)):
        register_goal_kind(kind, fn)


def _looks():
    def look(key, **kw):
        if key not in LOOK_FILL:
            add_look(key, **kw)
    look("mirror", fill="#d9dee3", shade="#9aa3ab", roughness=0.03, metalness=1.0, clearcoat=1.0)
    look("lens glass", fill="#d8eef4", shade="#9cc7d4", roughness=0.02, metalness=0.0, clearcoat=1.0, transmission=0.95, ior=1.52, thickness=0.01)
    look("dark plastic", fill="#2b2f36", shade="#16181c", roughness=0.4, metalness=0.0, clearcoat=0.3)
    look("white card", fill="#e8e6df", shade="#bdbab0", roughness=0.9, metalness=0.0, clearcoat=0.0)
    look("gel", fill="#d81e1e", shade="#9a1414", roughness=0.1, metalness=0.0, clearcoat=0.6, transmission=0.6, ior=1.45, thickness=0.001)
    look("sun", fill="#ffd34d", shade="#f0a020", roughness=0.5, metalness=0.0, clearcoat=0.0)


def _materials():
    def mat(name, **kw):
        MATERIALS.setdefault(name, {"rolling": 0.0, "side": 0.0, **kw})
    mat("optical glass", density=2510, bounce=0.9, friction=0.4, rolling=0.001, side=0.1, look="lens glass",
        source="N-BK7 crown glass 2510 kg/m³ (SCHOTT data sheet); glass on glass friction about 0.4 (Engineering ToolBox); bounce provisional.")
    mat("mirror glass", density=2500, bounce=0.9, friction=0.4, rolling=0.001, side=0.1, look="mirror",
        source="Soda-lime glass 2500 kg/m³, back-silvered; friction and bounce as glass (provisional).")
    mat("ABS housing", density=1050, bounce=0.5, friction=0.35, rolling=0.004, look="dark plastic",
        source="ABS plastic 1040-1060 kg/m³ (a torch's or meter's housing; friction and bounce provisional).")
    mat("card", density=700, bounce=0.3, friction=0.5, rolling=0.01, look="white card",
        source="Card stock about 700 kg/m³ (300 g/m², 0.4 mm); provisional.")


def _f(name, P):
    return float(P[name])


# Each type's sources and its one-line facts (the catalog's cards)
INFO = {
    "flashlight": ("2 × AA LED torch; 150 lm, 20° beam typical.",
        "150 lm · 20° beam · 15 cm long"),
    "laser-pointer": ("Class 2 laser pointer, 1 mW, beam Ø 1.5 mm, 1 mrad [IEC60825].",
        "1 mW · red 650 nm · beam Ø 1.5 mm"),
    "mirror": ("Back-silvered glass mirror, about 90 % of visible light reflected; angle of incidence = angle of reflection (Hecht, Optics, §4.3).",
        "20 cm · 90 % reflected · one shiny face"),
    "curved-mirror": ("Spherical mirror: f = R/2 for rays near its axis (Hecht, Optics, §5.4).",
        "Concave · f 15 cm · Ø 10 cm"),
    "convex-lens": ("Thick-lens lensmaker's equation (Hecht, Optics, §5.2); N-BK7 nd 1.5168, F2 1.62004 (SCHOTT data sheets).",
        "f 10 cm · Ø 5 cm · crown glass"),
    "concave-lens": ("Thick-lens lensmaker's equation (Hecht, Optics, §5.2); N-BK7 nd 1.5168, F2 1.62004 (SCHOTT data sheets).",
        "f −10 cm · Ø 5 cm · crown glass"),
    "prism": ("60° prism, minimum deviation (Hecht, Optics, §5.5); N-BK7 and F2 Sellmeier coefficients (SCHOTT data sheets).",
        "60° · 5 cm edges · crown glass"),
    "glass-block": ("Snell's law and the Fresnel equations (Hecht, Optics, §4.4-4.6); N-BK7 (SCHOTT data sheet).",
        "10 × 6 cm · 2 cm deep · n 1.52"),
    "semicircle-block": ("Critical angle asin(1/n) = 41.2° for N-BK7 at 589 nm (Hecht, Optics, §4.7; SCHOTT data sheet).",
        "Radius 5 cm · critical angle 41°"),
    "color-filter": ("Lighting gel: about 85-90 % of its own colour through, about 2 % of the others (typical gel transmission curves; provisional).",
        "Red · 88 % of red through · 2 % of green"),
    "material-panel": ("Clear glass ≈ 92 % through (two 4 % reflections, Hecht, Optics, §4.6); wax paper, tissue and frosted glass provisional; black cloth absorbs ≈ 0.97, white card ≈ 0.2 (Incropera, Table A.12).",
        "10 × 10 cm · clear glass lets 92 % through"),
    "screen": ("White card: a diffuse (Lambertian) surface reflecting about 80 % of visible light (provisional).",
        "30 cm tall · white card · both faces"),
    "light-meter": ("Lux: lumens per m², 683 lm/W at 555 nm weighted by the CIE 1924 V(λ) curve (CIE); clear noon sun about 100 000 lx, a room 300 lx.",
        "Reads lux · 1 cm sensor · lit above 10 lx"),
    "light-sensor": ("A target board that counts the light power reaching either face, in mW (a photodiode's reading; provisional size).",
        "Ø 10 cm · either face counts"),
    "eye": ("We see a thing when light from it enters the eye's pupil, 2-8 mm across (Hecht, Optics, §5.7).",
        "Ø 2.4 cm · sees 120° wide"),
    "sunlight": ("Clear-sky noon sunlight 1000 W/m² (ASTM G173, AM1.5), about 100 000 lx; the sun's disc 0.53° across.",
        "1000 W/m² · 45° high · parallel rays"),
    "lit-arrow": ("An optics-bench object: a lit arrow whose every point sends light on (provisional brightness).",
        "5 cm arrow · 40 lm"),
}


def _types():
    def T(key, name, build, props, description, readouts=(), links=(), tags=(), anchor="its centre", dynamic=False, edit=({"kind": "rotate"},),
          source="", facts=""):
        register(ItemType(key, name, CAT, build, props=props, readouts=list(readouts), links=list(links), tags=list(tags), description=description,
                          anchor=anchor, dynamic=dynamic, edit=list(edit), source=source or INFO[key][0], facts=facts or INFO[key][1], module="optics"))

    def aim(d, what):
        return Prop("aim", "Aim", d, -360.0, 360.0, 0.5, "°", what)
    on_props = [Prop("on", "On", True, kind="bool", help="Whether it shines"),
                Prop("on_at", "On at", 0.0, 0.0, 20.0, 0.1, "s", "When it is switched on (seconds into the run)")]
    T("flashlight", "Flashlight", build_flashlight,
      [Prop("lumens", "Brightness", 150.0, 5.0, 1000.0, 5.0, "lm", "Its rated light output (a pocket torch 50-200 lm); a coloured one follows its colour "
            "until set (red 40, green 100, blue 10 lm: together they make white)", auto=("color",)),
       Prop("beam_angle", "Beam spread", 20.0, 5.0, 60.0, 1.0, "°", "The full width of its cone of light"),
       aim(0.0, "Which way it shines: 0 = right, 90 = up, 180 = left, -90 = down")] + on_props +
      [Prop("color", "Light colour", "white", kind="choice", choices=list(TORCH_LIGHT),
            help="White LED, or a one-colour red, green or blue LED (mix them on a white screen; each casts its own coloured shadow)"),
       Prop("pattern", "Blink", "steady", kind="choice", choices=["steady", "SOS", "HI", "101", "1100"], open=True,
            help="steady; a word sent in Morse code (letters and digits: a dash is 3 dots); or 1s and 0s, one dot-length each (1 on, 0 off)"),
       Prop("dot_s", "Dot length", 0.2, 0.05, 2.0, 0.05, "s", "How long one Morse dot (one 1 or 0) lasts"),
       Prop("repeat", "Repeat", True, kind="bool", help="Send the pattern again and again (10 dot-lengths of dark between)")],
      "An LED flashlight (torch), 15 cm long, on a stand. Its beam leaves its lens end in the direction `aim` (degrees: 0 = to the right, "
      "90 = straight up, 180 = left). A cone of white light that spreads and dims with distance (1/d²). `color` red, green or blue makes a "
      "one-colour torch: on a white screen red + green look yellow, red + blue magenta, green + blue cyan, all three white, and an object "
      "lit by two of them casts two coloured shadows. `pattern` makes it blink a message (Morse code of a word such as SOS, or 1s and 0s of "
      "dot_s each): a light-sensor (or light-meter) it shines on counts the flashes (`pulses`) and the goal receives {sensor, light} reads "
      "the message back.",
      readouts=[Readout("on", "On", "", 0)], tags=["torch", "light", "beam", "lamp", "coloured light", "blink", "signal", "morse code"],
      source="2 × AA LED torch; 150 lm, 20° beam typical.")
    T("laser-pointer", "Laser pointer", build_laser,
      [Prop("color", "Colour", "red", kind="choice", choices=["red", "green", "violet"], help="Red 650 nm, green 532 nm, violet 405 nm"),
       Prop("power_mw", "Brightness", 1.0, 0.1, 5.0, 0.1, "mW", "Class 2 pointers are at most 1 mW"),
       aim(0.0, "Which way it shines: 0 = right, 90 = up, 180 = left, -90 = down")] + on_props,
      "A laser pointer (14 cm pen) on a stand: ONE thin beam in the direction `aim` (degrees, 0 = right). Ideal for mirrors, refraction and hitting targets: "
      "the beam is drawn as a bright line, as if through a little mist.",
      readouts=[Readout("on", "On", "", 0)], tags=["laser", "beam", "light ray"], source="Class 2 laser pointer, 1 mW, beam Ø 1.5 mm, 1 mrad [IEC60825].")
    T("mirror", "Flat mirror", build_mirror,
      [Prop("width", "Size", 0.2, 0.05, 0.6, 0.01, "m", "The mirror's length as seen from the side"),
       Prop("reflectance", "Reflectance", 0.9, 0.5, 0.99, 0.01, "", "The share of the light its silvered face sends back"),
       aim(180.0, "Which way its shiny face points: 0 = right, 90 = up, 180 = left")],
      "A flat glass mirror on a stand, silvered on ONE side: its shiny face points in the direction `aim` (degrees: 0 = facing right, 90 = facing "
      "up, 180 = facing left); its back is opaque. Angle in = angle out: turning it by 10° turns the reflected beam by 20°. To send a beam "
      "that arrives travelling in direction A on in direction B, set aim = (A + 180 + B) / 2 (the face points half way between back along "
      "the incoming beam and along the outgoing one).",
      tags=["reflect", "reflection", "periscope"])
    T("curved-mirror", "Curved mirror", build_curved_mirror,
      [Prop("curve", "Shape", "concave", kind="choice", choices=["concave", "convex"], help="Concave (a shaving mirror) focuses; convex (a car's side mirror) spreads"),
       Prop("focal_length", "Focal distance", 0.15, 0.05, 1.0, 0.01, "m", "f = R/2"),
       Prop("diameter", "Diameter", 0.1, 0.03, 0.3, 0.01, "m"), aim(180.0, "Which way its shiny face points: 0 = right, 180 = left")],
      "A round spherical mirror on a stand. Its shiny face points in the direction `aim`. Concave: parallel light meets at its focus, f in front; "
      "convex: light spreads as if from a point f behind it.", tags=["concave", "convex", "focus", "reflect"])
    T("convex-lens", "Convex lens", build_convex_lens,
      [Prop("focal_length", "Focal distance", 0.1, 0.03, 0.5, 0.01, "m", "Where parallel light comes to a point"),
       Prop("diameter", "Diameter", 0.05, 0.02, 0.15, 0.005, "m"),
       Prop("glass", "Glass", "crown glass", kind="choice", choices=["crown glass", "flint glass", "acrylic"]),
       aim(0.0, "The direction of its axis: 0 = light passes left ↔ right, 90 = up ↔ down")],
      "A converging (magnifying) lens on a stand, its axis in the direction `aim` (0: light passes left ↔ right). Parallel light (the sun) meets at "
      "its focus, focal_length behind it; an object beyond 2f makes a smaller, upside-down image on a screen at d_i (1/f = 1/d_o + 1/d_i).",
      tags=["magnifying glass", "lens", "focus", "burning glass"])
    T("concave-lens", "Concave lens", build_concave_lens,
      [Prop("focal_length", "Focal distance", 0.1, 0.03, 0.5, 0.01, "m", "How far behind it parallel light seems to spread from"),
       Prop("diameter", "Diameter", 0.05, 0.02, 0.15, 0.005, "m"),
       Prop("glass", "Glass", "crown glass", kind="choice", choices=["crown glass", "flint glass", "acrylic"]),
       aim(0.0, "The direction of its axis: 0 = light passes left ↔ right")],
      "A diverging lens on a stand, its axis in the direction `aim`: parallel light spreads out as if from a point focal_length in front of it.",
      tags=["lens", "diverging", "spread"])
    T("prism", "Prism", build_prism,
      [Prop("edge", "Edge", 0.05, 0.02, 0.15, 0.005, "m", "Each side of the triangle"),
       Prop("glass", "Glass", "crown glass", kind="choice", choices=["crown glass", "flint glass", "acrylic"], help="Flint glass spreads the colours twice as much"),
       aim(0.0, "How far it is turned (0 = apex up)")],
      "A 60° triangular glass prism on a stand (centred on its middle; apex up at aim 0). White light through it bends and splits into a "
      "rainbow (violet bends most). Aim the beam at one slanted face.", tags=["rainbow", "spectrum", "colours", "dispersion"])
    T("glass-block", "Glass block", build_glass_block,
      [Prop("width", "Width", 0.1, 0.02, 0.3, 0.005, "m"), Prop("height", "Height", 0.06, 0.02, 0.2, 0.005, "m"),
       Prop("glass", "Glass", "crown glass", kind="choice", choices=BLOCK_MEDIA, help="Crown glass n 1.52, flint 1.62, acrylic 1.49, or water 1.333 (a thin clear cell of water)"),
       aim(0.0, "How far it is turned")],
      "A rectangular clear block (2 cm deep): a beam entering at a slant bends toward the normal inside and leaves parallel to how it came, "
      "shifted sideways. Glass `water`: a block of water (bends light less than glass). For light into a real tank of water use the liquids "
      "module's water tank or beaker: its water bends light too.", tags=["refraction", "bend light", "block", "water"])
    T("semicircle-block", "Semicircular block", build_semicircle,
      [Prop("radius", "Radius", 0.05, 0.02, 0.15, 0.005, "m"),
       Prop("glass", "Glass", "crown glass", kind="choice", choices=["crown glass", "flint glass", "acrylic"]),
       aim(0.0, "Which way its flat face points")],
      "A D-shaped clear block: its flat face points in the direction `aim`, the round side behind. A beam aimed through the round side at the "
      "flat face's middle meets the flat face at any angle: past the critical angle (41° for crown glass) it is totally reflected.",
      tags=["total internal reflection", "critical angle"])
    T("color-filter", "Colour filter", build_filter,
      [Prop("color", "Colour", "red", kind="choice", choices=list(FILTERS), help="The colour it lets through"),
       Prop("size", "Size", 0.1, 0.03, 0.3, 0.01, "m"), aim(0.0, "Which way it faces (0: it stands upright across a level beam)")],
      "A coloured gel in a card frame, on a stand: it lets its own colour through and stops the others (a red filter turns white light red "
      "and stops green light).", tags=["filter", "gel", "colour"])
    T("material-panel", "Material panel", build_panel,
      [Prop("sample", "Material", "clear glass", kind="choice", choices=list(PANELS),
            help="Transparent (glass, plastic), translucent (frosted glass, wax paper, tissue) or opaque (card, cardboard, foil, cloth, wood)"),
       Prop("size", "Size", 0.1, 0.05, 0.4, 0.01, "m"), aim(0.0, "Which way it faces (0: it stands upright across a level beam)")],
      "A 10 × 10 cm sample sheet on a stand, for sorting materials: transparent ones let light straight through (glass ≈ 92 %), translucent "
      "ones let some through, scattered, opaque ones none (foil reflects it, black cloth absorbs it).",
      tags=["transparent", "translucent", "opaque", "materials"])
    T("screen", "Screen", build_screen,
      [Prop("height", "Height", 0.3, 0.1, 1.0, 0.01, "m"), Prop("width", "Width", 0.2, 0.1, 1.0, 0.01, "m", "Its size front to back"),
       Prop("color", "Colour", "#e8e6df", kind="choice", choices=["#e8e6df", "#f5f5f0", "#202020"], help="White card (default), bright white, black"),
       aim(0.0, "Which way it faces (0: it stands upright, catching a level beam on either side)")],
      "A white card screen on a stand, standing upright (aim 0; both sides catch light): it shows light spots, colours and SHADOWS "
      "(put an opaque thing between a light and the screen). Readings: the shadow's size on it.",
      readouts=[Readout("shadow_cm", "Shadow", "cm", 1), Readout("lit_pct", "Lit", "%", 0), Readout("image_cm", "Image size", "cm", 1, "Of a lit object, upside down when negative"),
                Readout("blur_mm", "Image blur", "mm", 1), Readout("colors", "Colours", "", 0, "Bands of split light (a rainbow) landing on it")],
      tags=["shadow", "screen", "projection", "card"])
    T("light-meter", "Light meter", build_meter,
      [Prop("threshold", "Lit above", 10.0, 0.1, 10000.0, 0.1, "lx", "It counts as lit from this illuminance"),
       aim(180.0, "Which way its sensor faces: 180 = toward a light on its left, 0 = right, 90 = up")],
      "A digital lux meter on a stand: its sensor (4 cm head) faces the direction `aim` (180 = facing left) and its display shows the light "
      "falling on it in lux (sunlight ≈ 100 000 lx, a room 300 lx). Twice as far from a small light → a quarter of the reading.",
      readouts=[Readout("lux", "Illuminance", "lx", 0), Readout("wm2", "Light power", "W/m²", 2), Readout("lit", "Lit", "", 0),
                Readout("pulses", "Flashes", "", 0, "Times its light came on (a blinking light's flashes)")],
      tags=["lux", "brightness", "meter", "sensor", "instrument"])
    T("light-sensor", "Light target", build_target,
      [Prop("size", "Size", 0.1, 0.03, 0.3, 0.01, "m"), aim(0.0, "Which way it faces (either face counts)")],
      "A round target board on a stand that registers light reaching it (either face): the goal hits_target {light, target} says a source's "
      "light gets there, straight or by mirrors and lenses. It counts the flashes of a blinking light (`pulses`): the goal receives {sensor, "
      "light} reads a flashlight's Morse message back from them.",
      readouts=[Readout("hit", "Light on it", "", 0), Readout("mw", "Light power", "mW", 3),
                Readout("pulses", "Flashes", "", 0, "Times light came on (a blinking light's flashes)")],
      tags=["target", "sensor", "bullseye", "receiver", "photodiode"])
    T("eye", "Eye", build_eye,
      [Prop("fov", "Field of view", 120.0, 20.0, 180.0, 5.0, "°", "How wide it looks"), aim(180.0, "Which way it looks: 180 = left, 0 = right, -90 = down")],
      "An eyeball on a stand, looking in the direction `aim` (180 = left). It sees a thing only when light from it enters the eye: a light "
      "source, or something lit that it can see (straight, or by mirrors). In the dark it sees nothing.",
      readouts=[Readout("sees", "Things seen", "", 0)], tags=["eye", "see", "seeing", "vision"])
    T("sunlight", "Sunlight", build_sun,
      [Prop("elevation", "Elevation", 45.0, 5.0, 90.0, 1.0, "°", "How high the sun stands above the horizon"),
       Prop("comes_from", "Comes from", "left", kind="choice", choices=["left", "right"], help="Which side the sun is on"),
       Prop("irradiance", "Sunlight", 1000.0, 50.0, 1400.0, 10.0, "W/m²", "Clear noon ≈ 1000 W/m² (≈ 100 000 lx)"),
       Prop("width", "Band width", 6.0, 0.005, 12.0, 0.005, "m", "How wide a band of parallel light it sends, centred on this marker (5 mm: sunlight through a slit)")] + on_props,
      "Sunlight: parallel rays from far away at the elevation angle, in a band `width` wide centred on this marker (put it above the middle "
      "of what it lights). Clear noon sun ≈ 1000 W/m², ≈ 100 000 lx [ASTM-G173].",
      readouts=[Readout("on", "On", "", 0)], tags=["sun", "sunlight", "daylight", "shadow", "solar"])
    T("lit-arrow", "Lit arrow", build_arrow,
      [Prop("height", "Height", 0.05, 0.02, 0.2, 0.005, "m", "The arrow's length (the object a lens images)"),
       Prop("lumens", "Brightness", 40.0, 5.0, 400.0, 5.0, "lm"), Prop("spread", "Spread", 12.0, 3.0, 40.0, 1.0, "°", "Half-angle of the light each point sends"),
       aim(0.0, "Which way it shines: 0 = right")] + on_props,
      "A light box with an upward arrow cut out of its front, the object for lens demos: light leaves every point of the arrow in the direction "
      "`aim`; a convex lens forms its upside-down image on a screen.", readouts=[Readout("on", "On", "", 0)], tags=["object", "image", "lens demo"])


# ---------------------------------------------------------------- builders
def _optics(role, **kw):
    d = {"role": role}
    d.update({k: v for k, v in kw.items() if v is not None})
    return d


def _light(c, P, kind, solid, x, y, dir_, spread, out, size, blur, rays, round_cone=None, **power):
    """A source's dict on its housing solid (the hook gathers it): where and which way it shines (solid frame), how wide, its light."""
    d = {"id": c.sid("light") if kind != "object" else None, "item": c.item["id"], "solid": solid, "kind": kind, "x": round(x, 5), "y": round(y, 5),
         "dir": round(dir_, 6), "spread": round(spread, 6), "out": round(out, 6)}
    if round_cone is not None:
        d["round"] = round_cone
    d.update({"size": size, "blur": blur, "rays": rays})
    d.update(power)
    if not P.get("on", True):
        d["on"] = False
    if P.get("on_at", 0.0) > 0:
        d["on_at"] = float(P["on_at"])
    return d


def blink_of(pattern, dot, repeat):
    """A blink pattern's on, off, on ... durations (s), starting on: Morse code of its letters and digits (dot 1, dash 3, 1 between a
    letter's signs, 3 between letters, 7 between words), or, with only 0s and 1s, one dot-length a digit (1 on, 0 off); repeated ones
    end with REPEAT_GAP dots of dark. [] for steady (or nothing it can send)."""
    text = pattern.strip(" ") if isinstance(pattern, str) else ""
    if text == "" or _ascii_upper(text) == "STEADY":
        return []
    runs = []

    def add(on, n):
        if runs and runs[-1][0] == on:
            runs[-1][1] += n
        else:
            runs.append([on, n])
    if all(ch in "01 " for ch in text):
        for ch in text:
            if ch in "01":
                add(ch == "1", 1)
    else:
        first = True
        for word in [w for w in _ascii_upper(text).split(" ") if w]:
            letters = [ch for ch in word if ch in MORSE]
            if not letters:
                continue
            if not first:
                add(False, 7)
            first = False
            for li, ch in enumerate(letters):
                if li > 0:
                    add(False, 3)
                for si, sign in enumerate(MORSE[ch]):
                    if si > 0:
                        add(False, 1)
                    add(True, 1 if sign == "." else 3)
    while runs and not runs[0][0]:
        runs.pop(0)
    if not runs:
        return []
    if repeat:
        add(False, REPEAT_GAP)
    elif not runs[-1][0]:
        runs.pop()
    return [round(n * dot, 6) for _, n in runs]


def message_of(pattern):
    """What a blink pattern sends, as a receiver reads it back: Morse letters and digits (words one space apart), or the 1s and 0s from its
    first 1 to its last 1; "" for steady."""
    text = pattern.strip(" ") if isinstance(pattern, str) else ""
    if text == "" or _ascii_upper(text) == "STEADY":
        return ""
    if all(ch in "01 " for ch in text):
        return "".join(ch for ch in text if ch in "01").strip("0")
    words = ["".join(ch for ch in w if ch in MORSE) for w in _ascii_upper(text).split(" ") if w]
    return " ".join(w for w in words if w)


def _ascii_upper(text):
    """a-z to A-Z, nothing else changed (the same in web/sim's port whatever the text)."""
    return "".join(chr(ord(ch) - 32) if "a" <= ch <= "z" else ch for ch in text)


def build_flashlight(c, P):
    L, D = 0.15, 0.03
    half = _f("beam_angle", P) * D2R / 2
    sid = c.sid("body")
    light = TORCH_LIGHT.get(P.get("color"), "led")
    given = c.item.get("props") or {}
    if "lumens" not in given:
        P["lumens"] = TORCH_LUMENS.get(P.get("color"), 150.0)
    src = _light(c, P, "flashlight", sid, L / 2 + 0.001, 0.0, 0.0, half, half, 0.012, 0.0, 96, round_cone=True, light=light, lumens=_f("lumens", P))
    blink = blink_of(P.get("pattern"), _f("dot_s", P), bool(P.get("repeat", True)))
    if blink:
        src["blink"] = blink
        src["dot"] = _f("dot_s", P)
        src["message"] = message_of(P.get("pattern"))
        if P.get("repeat", True):
            src["repeat"] = True
    c.slab("body", L, D, D, 0.0, 0.0, _f("aim", P), material=c.mat(base="aluminium", overrides={}), words="an LED flashlight", optics=_optics("opaque", color="#2b2f36"), light=src, stand="post")


def build_laser(c, P):
    L, D = 0.14, 0.014
    sid = c.sid("body")
    src = _light(c, P, "laser", sid, L / 2 + 0.001, 0.0, 0.0, 0.0, 0.0, 0.00075, 0.0005, 1, nm=LASER_NM[P["color"]], mw=_f("power_mw", P))
    c.slab("body", L, D, D, 0.0, 0.0, _f("aim", P), material=c.mat(base="aluminium", overrides={}), words="a laser pointer", optics=_optics("opaque", color="#30343a"), light=src, stand="post")


def build_mirror(c, P):
    w = _f("width", P)
    R = _f("reflectance", P)
    c.slab("glass", 0.006, w, 0.1, 0.0, 0.0, _f("aim", P), material=c.mat(base="mirror glass", overrides={}), words="a flat mirror", optics=_optics("mirror", faces=[0], aim=_f("aim", P), reflect=[R, R, R, R, R, R, R, round(min(0.99, R + 0.02), 4)],
                                                                          color="#30343a"), stand="post")


def build_curved_mirror(c, P):
    f = _f("focal_length", P)
    R = 2 * f
    h = min(_f("diameter", P) / 2, 0.9 * R)
    th = 0.004
    sag = R - math.sqrt(R * R - h * h)
    if P["curve"] == "concave":
        xo = R - math.sqrt((R + th) * (R + th) - h * h)
        pts = [(-th, 0.0), (xo, -h), (sag, -h), (sag, h), (xo, h)]
        prims = [["hole", R, 0.0, R, 1], ["disk", R, 0.0, R + th, 1], ["half", 0.0, 1.0, h], ["half", 0.0, -1.0, h], ["half", 1.0, 0.0, R]]
    else:
        xb = -R + math.sqrt((R - th) * (R - th) - h * h)
        pts = [(xb, -h), (-sag, -h), (0.0, 0.0), (-sag, h), (xb, h)]
        prims = [["disk", -R, 0.0, R, 1], ["hole", -R, 0.0, R - th, 1], ["half", 0.0, 1.0, h], ["half", 0.0, -1.0, h], ["half", -1.0, 0.0, R]]
    prims = [[p[0]] + [round(v, 6) for v in p[1:4]] + p[4:] for p in prims]
    c.poly("mirror", pts, 2 * h, 0.0, 0.0, _f("aim", P), material=c.mat(base="mirror glass", overrides={}), words=f"a {P['curve']} mirror",
           optics=_optics("mirror", prims=prims, faces=[0], reflect=[0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.92], half=round(h, 6),
                          aperture=[0.0, 0.0, 1.0, 0.0, round(h, 6)], color="#30343a"), stand="post")


def lens_shape(f, n, diameter, minimum):
    """The radius of a symmetric lens's faces for focal length f (thick-lens lensmaker's equation, 1/f = (n−1)(2/R − (n−1)t/(nR²)) [HEC eq. 6.2]),
    by fixed-point iteration (its thickness follows R's sag): (R, t). R > 0 bulges out (converging), R < 0 hollows in (diverging); t = minimum
    plus both sags for a converging lens (its edge is `minimum` thick), else `minimum` (its middle). tooling/src/sim/optics.ts lensShape is the same."""
    h = diameter / 2
    R = 2 * (n - 1) * f
    t = minimum
    for _ in range(60):
        r = abs(R)
        sag = r - math.sqrt(r * r - h * h) if r > h else r
        t = minimum + 2 * sag if f > 0 else minimum
        a = 1 / f
        b = -2 * (n - 1)
        cc = (n - 1) * (n - 1) * t / n
        disc = b * b - 4 * a * cc
        nxt = (-b + math.sqrt(disc)) / (2 * a) if disc >= 0 else R
        if abs(nxt - R) < 1e-15:
            R = nxt
            break
        R = nxt
    return R, t


def _lens_n(P):
    return GLASS_ND[P["glass"]]


def build_convex_lens(c, P):
    f = _f("focal_length", P)
    n = _lens_n(P)
    D = min(_f("diameter", P), 3 * (n - 1) * f)   # (a spherical lens's faces must be wider than it: R ≈ 2(n−1)f > its radius)
    h = D / 2
    e = 0.0015
    R, t = lens_shape(f, n, D, e)
    x3 = t / 2 - (R - math.sqrt(R * R - h * h / 9))
    pts = [(e / 2, -h), (x3, -h / 3), (x3, h / 3), (e / 2, h), (-e / 2, h), (-x3, h / 3), (-x3, -h / 3), (-e / 2, -h)]
    prims = [["disk", round(R - t / 2, 6), 0.0, round(R, 6), 1], ["disk", round(-(R - t / 2), 6), 0.0, round(R, 6), 1],
             ["half", 0.0, 1.0, round(h, 6)], ["half", 0.0, -1.0, round(h, 6)]]
    c.poly("lens", pts, D, 0.0, 0.0, _f("aim", P), material=c.mat(base="optical glass", density=GLASS_DENSITY[P["glass"]], overrides={}), words="a convex lens",
           optics=_optics("glass", medium=P["glass"], prims=prims, half=round(h, 6), aperture=[0.0, 0.0, 1.0, 0.0, round(h, 6)]), stand="post")


def build_concave_lens(c, P):
    f = _f("focal_length", P)
    n = _lens_n(P)
    D = min(_f("diameter", P), 3 * (n - 1) * f)
    h = D / 2
    t = 0.002
    R, _ = lens_shape(-f, n, D, t)
    r = abs(R)
    e = t + 2 * (r - math.sqrt(r * r - h * h))
    prims = [["half", 1.0, 0.0, round(e / 2, 6)], ["half", -1.0, 0.0, round(e / 2, 6)], ["half", 0.0, 1.0, round(h, 6)], ["half", 0.0, -1.0, round(h, 6)],
             ["hole", round(t / 2 + r, 6), 0.0, round(r, 6), 1], ["hole", round(-(t / 2 + r), 6), 0.0, round(r, 6), 1]]
    c.slab("lens", e, D, D, 0.0, 0.0, _f("aim", P), material=c.mat(base="optical glass", density=GLASS_DENSITY[P["glass"]], overrides={}), words="a concave lens",
           optics=_optics("glass", medium=P["glass"], prims=prims, half=round(h, 6), aperture=[0.0, 0.0, 1.0, 0.0, round(h, 6)]), stand="post")


SQRT3 = math.sqrt(3)


def build_prism(c, P):
    s = _f("edge", P)
    pts = [(-s / 2, -s * SQRT3 / 6), (s / 2, -s * SQRT3 / 6), (0.0, s * SQRT3 / 3)]
    c.poly("glass", pts, 0.05, 0.0, 0.0, _f("aim", P), material=c.mat(base="optical glass", density=GLASS_DENSITY[P["glass"]], overrides={}), words="a glass prism", optics=_optics("glass", medium=P["glass"]), stand="post")


def build_glass_block(c, P):
    water = P["glass"] == "water"
    look = {"look": "water"} if water and "water" in LOOK_FILL else {}
    c.slab("glass", _f("width", P), _f("height", P), 0.02, 0.0, 0.0, _f("aim", P), material=c.mat(base="optical glass", density=GLASS_DENSITY[P["glass"]], overrides={}),
           words="a block of water" if water else "a glass block", optics=_optics("glass", medium=P["glass"]), stand="post", **look)


def build_semicircle(c, P):
    r = _f("radius", P)
    q = r * SQRT3 / 2
    pts = [(0.0, -r), (0.0, r), (-r / 2, q), (-q, r / 2), (-r, 0.0), (-q, -r / 2), (-r / 2, -q)]
    prims = [["disk", 0.0, 0.0, round(r, 6)], ["half", 1.0, 0.0, 0.0]]
    c.poly("glass", pts, 0.02, 0.0, 0.0, _f("aim", P), material=c.mat(base="optical glass", density=GLASS_DENSITY[P["glass"]], overrides={}), words="a semicircular glass block",
           optics=_optics("glass", medium=P["glass"], prims=prims), stand="post")


def build_filter(c, P):
    s = _f("size", P)
    c.slab("gel", 0.002, s, s, 0.0, 0.0, _f("aim", P), material=c.mat(base="card", overrides={}), words=f"a {P['color']} filter", color=FILTER_COLOR[P["color"]], look="gel",
           optics=_optics("filter", passes=list(FILTERS[P["color"]])), stand="post")


def build_panel(c, P):
    s = _f("size", P)
    k = PANELS[P["sample"]]
    o = {"color": k["color"]}
    if k["role"] == "glass":
        o["medium"] = k["medium"]
    if k["role"] == "translucent":
        o["transmit"] = k["transmit"]
        o["blur"] = k["blur"]
    if k["role"] == "mirror":
        r = k["reflect"]
        o["reflect"] = [r, r, r, r, r, r, r, r]
        o["faces"] = [0, 2]
    c.slab("panel", k["t"], s, s, 0.0, 0.0, _f("aim", P), material=c.mat(base=k["material"], overrides={}), words=f"a panel of {P['sample']}", color=k["color"], optics=_optics(k["role"], **o), stand="post")


def build_screen(c, P):
    c.slab("card", 0.005, _f("height", P), _f("width", P), 0.0, 0.0, _f("aim", P), material=c.mat(base="card", overrides={}), words="a white screen", color=P["color"],
           optics=_optics("screen", faces=[0, 2], color=P["color"]), stand="post")


def build_meter(c, P):
    c.slab("head", 0.03, 0.04, 0.04, 0.0, 0.0, _f("aim", P), material=c.mat(base="ABS housing", overrides={}), words="a light meter",
           optics=[_optics("sensor", prims=[["half", 1.0, 0.0, 0.015], ["half", -1.0, 0.0, -0.013], ["half", 0.0, 1.0, 0.005], ["half", 0.0, -1.0, 0.005]],
                           faces=[0], color="#f2f2f2", threshold=_f("threshold", P), half=0.005),
                   _optics("opaque", color="#2b2f36")], stand="post")


def build_target(c, P):
    s = _f("size", P)
    c.slab("board", 0.01, s, s, 0.0, 0.0, _f("aim", P), material=c.mat(base="card", overrides={}), words="a light target", color="#f2efe6", optics=_optics("sensor", color="#f2efe6", target=True), stand="post")


def build_eye(c, P):
    r = 0.012
    c.ball("eye", r, 0.0, 0.0, material=c.mat(base="ABS housing", overrides={}), words="an eye", color="#f4f1ea", optics=_optics("opaque", color="#f4f1ea", eye=round(_f("fov", P) * D2R / 2, 6), pupil=r + 0.001,
                                                                                                                     look=round(_f("aim", P) * D2R, 6)), stand="post")


def build_sun(c, P):
    e = _f("elevation", P) * D2R
    d = -e if P["comes_from"] == "left" else math.pi + e
    sid = c.sid("disc")
    x, y = c.world(0.0, 0.0)
    src = _light(c, P, "sun", "", x, y, d, 0.0, 0.0, round(_f("width", P) / 2, 5), 0.00465, 240, light="sun", irradiance=_f("irradiance", P), back=3.0)
    c.ball("disc", 0.03, 0.0, 0.0, material=c.mat(base="card", overrides={}), words="the sun", look="sun", optics=_optics("clear"), light=src, hidden_3d=True)
    # (the heat module's sun: what the sunlight falls on warms, when the heat module is there; its own rays decide what is shaded)
    if "heat" in HEAT_KINDS:
        c.process("heat", "sun", role="sun", irradiance=_f("irradiance", P), direction=round(d, 6),
                  **({"from": float(P["on_at"])} if P["on"] else {"from": 1e9}))
    return sid


def build_arrow(c, P):
    h = _f("height", P)
    half = _f("spread", P) * D2R
    sid = c.sid("box")
    pts = []
    n = 5
    for k in range(n):
        y = -h / 2 + h * k / (n - 1)
        s = _light(c, P, "object", sid, 0.016, y, 0.0, half, half, 0.002, 0.0, 48, round_cone=False, light="led", lumens=round(_f("lumens", P) / n, 6))
        s["id"] = c.sid(f"p{k}")
        pts.append(s)
    c.slab("box", 0.03, h + 0.02, 0.05, 0.0, 0.0, _f("aim", P), material=c.mat(base="ABS housing", overrides={}), words="a lit arrow", optics=_optics("opaque", color="#2b2f36"), light=pts, stand="post")


# ---------------------------------------------------------------- the build hook: one optics record for the scene
def _name(scene_items, iid):
    it = scene_items.get(iid) or {}
    t = TYPES.get(it.get("type"))
    return it.get("name") or (t.name if t is not None else iid)


def build_hook(sb, scene):
    """Gathers every light source and every solid light can meet into one record {kind: "optics", id: "optics", sources, bodies, names}
    (only when the scene has a light item or an optics item: else the document is as it was)."""
    sources = []
    have = False
    for s in sb.solids:
        if "light" in s:
            have = True
            got = s.pop("light")
            sources.extend(got if isinstance(got, list) else [got])
        if "optics" in s:
            have = True
    # the heat module's desk lamps: the same item's light (their `heat` record of role "lamp")
    for r in sb.processes:
        if r.get("kind") == "heat" and r.get("role") == "lamp":
            item = r.get("item")
            P = props_of(sb.scene_items[item]) if item in sb.scene_items else {}
            spread = r.get("spread", 0.6)
            src = {"id": f"{item}/light", "item": item, "solid": r.get("solid") or r["id"], "kind": "lamp", "x": r["at"]["x"], "y": r["at"]["y"],
                   "dir": r.get("dir", r.get("direction", -1.5707963267948966)), "spread": spread, "out": spread, "round": True, "size": 0.03, "blur": 0.0,
                   "rays": 180, "light": LAMP_LIGHT.get(P.get("bulb"), "incandescent"), "watts": r.get("power", 0.0)}
            if "from" in r:
                src["on_at"] = r["from"]
            if "until" in r:
                src["off_at"] = r["until"]
            sources.append(src)
            have = True
    if not have:
        return
    lamps, clear = _circuit_lights(sb)
    sources.extend(lamps)
    bodies = []
    for s in sb.solids:
        o = s.pop("optics", None)
        if s.get("hidden_3d") or s["id"] in clear:
            continue
        if o is not None:
            # (a solid may carry several: a light meter's 1 cm sensor window, then its housing)
            for oo in (o if isinstance(o, list) else [o]):
                if oo.get("role") == "clear":
                    continue
                b = {"solid": s["id"], "item": s["item"]}
                b.update(oo)
                if "passes" in b:
                    b["pass"] = b.pop("passes")
                bodies.append(b)
            continue
        base = sb.base_of(s["material"])
        look = s.get("look")
        medium = MEDIUM_OF_MATERIAL.get(base) or MEDIUM_OF_LOOK.get(look)
        if medium is not None:
            bodies.append({"solid": s["id"], "item": s["item"], "role": "glass", "medium": medium})
        elif base in TRANSLUCENT_MATERIAL:
            tr, bl = TRANSLUCENT_MATERIAL[base]
            bodies.append({"solid": s["id"], "item": s["item"], "role": "translucent", "transmit": tr, "blur": bl,
                           "color": s.get("color") or LOOK_FILL.get(look) or s["placeholder"]["fill"]})
        else:
            bodies.append({"solid": s["id"], "item": s["item"], "role": "opaque", "color": s.get("color") or LOOK_FILL.get(look) or s["placeholder"]["fill"],
                           "look": look})
    bodies.extend(_liquid_bodies(sb))
    for k, src in enumerate(sources):
        if src.get("id") is None:
            src["id"] = f"{src['item']}/light{k}"
    names, seen = [], set()
    for iid in [b["item"] for b in bodies] + [src["item"] for src in sources]:
        if iid not in seen:
            seen.add(iid)
            names.append([iid, _name(sb.scene_items, iid)])
    sb.processes.append({"kind": "optics", "id": "optics", "sources": sources, "bodies": bodies, "names": names})


def _circuit_lights(sb):
    """The circuits module's bulbs and LEDs as light sources at their glow point (its `<item>/glow` terminal), their light following the
    circuit's `light` reading (1 = as bright as at their rating): a bulb lights all round, an LED a 30° cone up out of its dome.
    Returns (sources, the solids light passes: a bulb's thin glass globe round its filament, which does not bend the light from inside it)."""
    out = []
    clear = set()
    for r in sb.processes:
        if r.get("kind") != "circuit":
            continue
        terminals = r.get("terminals") or {}
        for p in r.get("parts") or []:
            kind = p.get("kind")
            if kind not in ("bulb", "led"):
                continue
            item = p.get("item")
            t = terminals.get(f"{item}/glow")
            if not isinstance(t, dict) or not any(s["id"] == t.get("solid") for s in sb.solids):
                continue
            src = {"id": f"{item}/glow-light", "item": item, "solid": t["solid"], "kind": "lamp", "x": t["at"]["x"], "y": t["at"]["y"], "dir": 1.570796}
            if kind == "bulb":
                clear.add(f"{item}/glass")
                watts = float(p.get("v_rated", 2.5)) * float(p.get("i_rated", 0.3))
                src.update({"spread": 3.141593, "out": 1.570796, "round": False, "size": 0.0055, "blur": 0.0, "rays": 180, "light": "incandescent",
                            "lumens": round(BULB_LM_PER_W * watts, 6), "infrared": round(BULB_IR_PER_W * watts, 6)})
            else:
                P = props_of(sb.scene_items[item]) if item in sb.scene_items else {}
                color = P.get("color") if P.get("color") in LED_LUMENS else "red"
                src.update({"spread": LED_HALF, "out": LED_HALF, "round": True, "size": 0.0025, "blur": 0.0, "rays": 48, "light": LED_LIGHT[color],
                            "lumens": LED_LUMENS[color]})
            src["drive"] = {"item": item, "key": "light", "scale": 1.0}
            out.append(src)
    return out, clear


def _liquid_bodies(sb):
    """The liquids module's containers: each layer of liquid a refracting body (its own index), a slab from wall to wall whose top is the
    live surface (the level readings: LevelRule in tooling/src/sim/optics.ts). It sits on the container's floor solid (fixed, upright) and
    reaches LIQUID_OVER into the walls, the floor and the layer above, so light goes from a wall straight into the water."""
    out = []
    for r in sb.processes:
        if r.get("kind") != "liquid" or not r.get("layers"):
            continue
        item = r.get("item")
        floor = next((s for s in sb.solids if s["id"] == f"{item}/floor"), None)
        if floor is None or floor.get("parent") or abs(floor.get("angle", 0.0)) > 1e-12:
            continue
        fx, fy = floor["at"]["x"], floor["at"]["y"]
        x0, x1 = r["x0"] - LIQUID_OVER, r["x1"] + LIQUID_OVER
        half = round(r["area"] / (r["x1"] - r["x0"]) / 2, 6)
        P = props_of(sb.scene_items[item]) if item in sb.scene_items else {}
        layers = r["layers"]
        n = len(layers)
        bottom = r["floor"] - LIQUID_OVER
        top = r["floor"]
        for i, layer in enumerate(layers):
            top = top + layer["height"]
            words = str(layer.get("words", ""))
            name = "salt water" if words.startswith("salt water") else words
            medium = LIQUID_MEDIUM.get(name, "water")
            up = LIQUID_OVER if i < n - 1 else 0.0
            b = {"solid": floor["id"], "item": item, "role": "glass", "medium": medium}
            if medium == "salt water":
                pct = P.get("salt_pct", 10.0)
                pct = float(pct) if isinstance(pct, (int, float)) and not isinstance(pct, bool) else 10.0
                b["nd"] = round(1.33299 + 0.001757 * min(26.0, max(0.0, pct)), 6)
            b["liquid"] = i + 1
            b["prims"] = [["half", 1.0, 0.0, round(x1 - fx, 6)], ["half", 0.0, 1.0, round(top + up - fy, 6)],
                          ["half", -1.0, 0.0, round(-(x0 - fx), 6)], ["half", 0.0, -1.0, round(-(bottom - fy), 6)]]
            b["half"] = half
            level = {"item": item}
            if n == 1:
                level["top"] = "level_mm"
            else:
                level["top"] = f"layer{i + 1}_mm"
                if i > 0:
                    level["bottom"] = f"layer{i}_mm"
            level["floor"] = round(r["floor"] - fy, 6)
            level["up"] = up
            b["level"] = level
            out.append(b)
            bottom = top
    return out


# ---------------------------------------------------------------- goal kinds (web/sim/modules/optics.js: the same, number for number)
def _fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def _events(ctx, kind, a, b):
    """The first time an engine event of this kind names items a then b, or None."""
    for e in ctx.track.get("events") or []:
        it = e.get("items") or []
        if e.get("kind") == kind and len(it) >= 2 and it[0] == a and it[1] == b:
            return e["t"]
    return None


def _end(ctx, iid, key):
    v = ctx.state(iid, key)
    if not v:
        return None
    x = v[-1]
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def goal_hits_target(ctx, g):
    """{kind: "hits_target", light, target, before_s?}: some of that source's light reaches the target (straight or by mirrors, lenses,
    glass), by before_s if given."""
    a, b = g.get("light"), g.get("target")
    if not ctx.known(a) or not ctx.known(b):
        return None
    t = _events(ctx, "light", a, b)
    by = ctx.num(g.get("before_s"))
    when = "" if by is None else f" by {_fmt(by)} s"
    return {"label": g.get("label") or f"{ctx.name(a)}'s light reaches {ctx.name(b)}{when}", "ok": t is not None and (by is None or t <= by),
            "kind": "hits_target", "light": a, "target": b, "t": None if t is None else round(t, 3)}


def _brightness(ctx, iid):
    """An item's light at the run's end: (lux, "lux") for a light meter, (mW landing, "mw") for a light target, else (W absorbed, "light_w")."""
    v = _end(ctx, iid, "lux")
    if v is not None:
        return v, "lux"
    v = _end(ctx, iid, "mw")
    if v is not None:
        return v, "mw"
    v = _end(ctx, iid, "light_w")
    return (0.0 if v is None else v), "light_w"


def goal_lit(ctx, g):
    """{kind: "lit", item, at_least_lux?}: at the run's end light falls on it: a light meter reads at least at_least_lux (default 1 lx), anything
    else absorbs some light."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    v, key = _brightness(ctx, iid)
    least = ctx.num(g.get("at_least_lux"))
    if key == "lux":
        need = 1.0 if least is None else least
        ok = v >= need
        label = g.get("label") or (f"{ctx.name(iid)} reads at least {_fmt(need)} lx" if least is not None else f"{ctx.name(iid)} is lit")
        return {"label": label, "ok": ok, "kind": "lit", "item": iid, "lux": round(v, 1)}
    if key == "mw":
        return {"label": g.get("label") or f"{ctx.name(iid)} is lit", "ok": v > 1e-5, "kind": "lit", "item": iid, "mw": round(v, 5)}
    return {"label": g.get("label") or f"{ctx.name(iid)} is lit", "ok": v > 1e-6, "kind": "lit", "item": iid, "light_w": round(v, 6)}


def goal_dark(ctx, g):
    """{kind: "dark", item, at_most_lux?}: at the run's end (almost) no light falls on it: a light meter reads at most at_most_lux (default
    1 lx), anything else absorbs none."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    v, key = _brightness(ctx, iid)
    most = ctx.num(g.get("at_most_lux"))
    if key == "lux":
        cap = 1.0 if most is None else most
        return {"label": g.get("label") or f"{ctx.name(iid)} is dark", "ok": v <= cap, "kind": "dark", "item": iid, "lux": round(v, 1)}
    if key == "mw":
        return {"label": g.get("label") or f"{ctx.name(iid)} is dark", "ok": v <= 1e-5, "kind": "dark", "item": iid, "mw": round(v, 5)}
    return {"label": g.get("label") or f"{ctx.name(iid)} is dark", "ok": v <= 1e-6, "kind": "dark", "item": iid, "light_w": round(v, 6)}


def goal_shadow_on(ctx, g):
    """{kind: "shadow_on", occluder, screen}: the occluder's shadow falls on the screen (light that would reach the screen stops on it)."""
    a, b = g.get("occluder"), g.get("screen")
    if not ctx.known(a) or not ctx.known(b):
        return None
    t = _events(ctx, "shadow", a, b)
    return {"label": g.get("label") or f"{ctx.name(a)} casts a shadow on {ctx.name(b)}", "ok": t is not None, "kind": "shadow_on", "occluder": a,
            "screen": b, "t": None if t is None else round(t, 3)}


def goal_sees(ctx, g):
    """{kind: "sees", eye, item}: light from the item (its own, or light it scatters) enters the eye."""
    a, b = g.get("eye"), g.get("item")
    if not ctx.known(a) or not ctx.known(b):
        return None
    t = _events(ctx, "sees", a, b)
    return {"label": g.get("label") or f"{ctx.name(a)} sees {ctx.name(b)}", "ok": t is not None, "kind": "sees", "eye": a, "item": b,
            "t": None if t is None else round(t, 3)}


def goal_brighter(ctx, g):
    """{kind: "brighter", a, b}: at the run's end more light falls on a than on b (two light meters: lux); for other items, a takes in (absorbs)
    more light than b."""
    a, b = g.get("a"), g.get("b")
    if not ctx.known(a) or not ctx.known(b):
        return None
    va, ka = _brightness(ctx, a)
    vb, kb = _brightness(ctx, b)
    verb = "gets more light than" if ka == "lux" else "takes in more light than"
    return {"label": g.get("label") or f"{ctx.name(a)} {verb} {ctx.name(b)}", "ok": ka == kb and va > vb, "kind": "brighter",
            "a": a, "b": b}


def goal_focused(ctx, g):
    """{kind: "focused", screen}: a lit object's image on the screen is sharp at the run's end (its points' light lands within 2 mm, or a
    tenth of the image's size)."""
    iid = g.get("screen")
    if not ctx.known(iid):
        return None
    size = _end(ctx, iid, "image_cm")
    blur = _end(ctx, iid, "blur_mm")
    ok = size is not None and blur is not None and abs(size) > 0.05 and blur <= max(2.0, abs(size) * 1.0)
    return {"label": g.get("label") or f"A sharp image forms on {ctx.name(iid)}", "ok": ok, "kind": "focused", "screen": iid,
            "image_cm": None if size is None else round(size, 2), "blur_mm": None if blur is None else round(blur, 2)}


def goal_rainbow(ctx, g):
    """{kind: "rainbow", screen}: white light split into its colours lands on the screen at the run's end (at least 6 of the 7 bands, violet
    and red at least 2 mm apart)."""
    iid = g.get("screen")
    if not ctx.known(iid):
        return None
    n = _end(ctx, iid, "colors")
    spread = _end(ctx, iid, "spread_mm")
    ok = n is not None and n >= 6 and spread is not None and spread >= 2.0
    return {"label": g.get("label") or f"A rainbow falls on {ctx.name(iid)}", "ok": ok, "kind": "rainbow", "screen": iid,
            "colors": None if n is None else round(n), "spread_mm": None if spread is None else round(spread, 1)}


def read_flashes(values, times, dot):
    """What a light-sensor saw of a blinking light, read back (the receiver's side of blink_of): its on/off record per frame cut into runs,
    each run's length in dot-lengths: on under 2 dots a dot, else a dash; off under 2 dots between a letter's signs, under 5 between
    letters, under 9 between words, longer the end of the message. Returns (Morse text of the first message, its 1s and 0s), ("", "")
    when it saw no flash. The 1s and 0s: each run is round(length / dot) digits."""
    if not values or not times or not (dot > 0):
        return "", ""
    runs = []
    prev = None
    start = 0.0
    for t, v in zip(times, values):
        on = 1 if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0.5 else 0
        if prev is None:
            prev, start = on, t
        elif on != prev:
            runs.append((prev, t - start))
            prev, start = on, t
    if prev == 1:
        runs.append((1, times[-1] - start + (times[1] - times[0] if len(times) > 1 else 0.0)))
    while runs and runs[0][0] == 0:
        runs.pop(0)
    letters, words, sign, bits = [], [], "", ""
    for on, d in runs:
        u = d / dot
        if on:
            sign += "." if u < 2 else "-"
            bits += "1" * max(1, int(u + 0.5))
            continue
        if u >= 9:
            break
        bits += "0" * max(1, int(u + 0.5))
        if u >= 2:
            letters.append(MORSE_TEXT.get(sign, "?"))
            sign = ""
            if u >= 5:
                words.append("".join(letters))
                letters = []
    if sign:
        letters.append(MORSE_TEXT.get(sign, "?"))
    if letters:
        words.append("".join(letters))
    return " ".join(w for w in words if w), bits.strip("0")


def goal_receives(ctx, g):
    """{kind: "receives", sensor, light, message?}: the light's blink pattern reaches the sensor (a light-sensor or a light-meter) and reads
    back as what the light sends (its Morse word or 1s and 0s; or `message` when given): the sensor's own record of light on / off."""
    a, b = g.get("sensor"), g.get("light")
    if not ctx.known(a) or not ctx.known(b):
        return None
    # what it sends: its source record's message and dot (the document carries them, as every check has the document), else its props
    src = None
    for r in ctx.doc.get("processes") or []:
        if r.get("kind") == "optics":
            src = next((x for x in r.get("sources") or [] if x.get("item") == b and isinstance(x.get("message"), str)), None)
    if src is not None:
        sent, dot = src["message"], src.get("dot")
    else:
        P = props_of(ctx.items[b])
        sent, dot = message_of(P.get("pattern")), P.get("dot_s")
    dot = float(dot) if isinstance(dot, (int, float)) and not isinstance(dot, bool) and dot > 0 else 0.2
    key = "hit" if ctx.state(a, "hit") else "lit"
    text, bits = read_flashes(ctx.state(a, key) or [], ctx.times, dot)
    morse = sent != "" and not all(ch in "01" for ch in sent)
    got = text if morse else bits
    asked = message_of(g.get("message"))
    want = asked if asked != "" else sent
    ok = want != "" and got == want
    label = g.get("label") or f"{ctx.name(a)} reads {ctx.name(b)}'s message \"{want}\""
    return {"label": label, "ok": ok, "kind": "receives", "sensor": a, "light": b, "sent": want, "got": got}
