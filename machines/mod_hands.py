"""The hands module: a person's hand where a person acts in a scene. Render only: nothing here changes a body, a contact or a track.

  hand        (a common prop of every dynamic type but the pusher) while the item is held (held: true, until the scene's release) or fixed,
              a hand holds it, in place of the pull pin on its post (or a starting gate, or a fixed thing's stand): "auto" picks the grip from
              its size, whether it is in a liquid and which way it goes when let go; "pinch" (thumb and finger), "palm" (it rests on an open
              palm), "press" (a fingertip holds it down from above: a cork on a tank's floor), "grip" (the whole hand round it; a fist round a
              fixed bar). At the release the fingers open (0.08 s) and the hand goes out of the picture; it never passes through the thing.
  hand_from   where the arm comes from: auto | left | right | above.
  hand        (the pusher) none | finger | hand | two hands | fist: a person's push. The housing, rod and paddle are not drawn; the hand is at
              the paddle's face and moves with it (the push is the pusher's own force and time: the hand is real size whatever it is).
  hand        (the pitcher) none | hand: a hand holds the pitcher, jug or measuring cup by its handle (a cup round its body) and tips it.

Nothing is built: the props are listed in the catalog and kept in the item's resolved props, which the 3D view reads (web/hands.js), so every
scene builds the very document it did before, with them or without them. web/sim/modules/hands.js is its port, line for line.
"""

NEEDED = ("register_common_prop", "Prop")

HOLD_GRIPS = ["none", "auto", "pinch", "palm", "press", "grip"]
HAND_FROM = ["auto", "left", "right", "above"]
PUSH_SKINS = ["none", "finger", "hand", "two hands", "fist"]
POUR_HANDS = ["none", "hand"]


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    holdable = lambda t: bool(t.dynamic) and t.key != "pusher"     # noqa: E731
    register_common_prop(Prop("hand", "Hand", "none", kind="choice", choices=HOLD_GRIPS,
                              help="While it is held (or fixed): a hand holds it instead of the pull pin. auto picks the grip; pinch, palm (it sits "
                                   "on the open palm), press (a fingertip holds it down), grip (the whole hand round it). Let go, the hand opens "
                                   "and moves out of the picture (only the look)"), holdable)
    register_common_prop(Prop("hand_from", "Hand comes from", "auto", kind="choice", choices=HAND_FROM,
                              help="Where the holding hand's arm comes from (auto: from above for a press or a grip, else the side it does not go to)"),
                         holdable)
    register_common_prop(Prop("hand", "Pushed by", "none", kind="choice", choices=PUSH_SKINS,
                              help="A person's push instead of the machine: a finger, a hand, two hands or a fist at the paddle's face (only the look: "
                                   "the push is its force and time, never the hand's size)"), lambda t: t.key == "pusher")
    register_common_prop(Prop("hand", "Hand", "none", kind="choice", choices=POUR_HANDS,
                              help="A hand holds it by its handle (a cup round its body) and tips it (only the look)"), lambda t: t.key == "pitcher")
