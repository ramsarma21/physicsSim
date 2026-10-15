# Patches (small changes to the plan; applied in order, then the scene is solved again)
Every patch is one JSON object with an `op`. Use exact ids of the scene's items. Fields not listed for an op are not allowed.
- `{"op": "move", "id": "ball", "dx": 0.1}` — along the table by dx m (+ right); or `"x": 1.2` (absolute anchor x). Items in the air also take `"dy"` / `"y_m"`. `"angle_deg": -20` sets its angle. An item that sits in the middle of another item has no x of its own: give it an x.
- `{"op": "set_props", "id": "ramp", "props": {"length": 1.2, "friction": 0.2}}` — props of its type, inside their ranges; `null` puts a prop back to its default.
- `{"op": "add", "item": {...a whole plan item: id, type, name, props, place, held, fixed, why...}}`
- `{"op": "remove", "id": "cup2"}` — also removes its goals and knobs. Move or remove what rests on it first.
- `{"op": "replace_type", "id": "ball", "type": "tennis-ball", "props": {}}` — same id, place and name; props the new type does not have are dropped.
- `{"op": "set_place", "id": "box", "place": {...a whole place, as in the plan}}` — put it somewhere else (on something else, in the air, leaning).
- `{"op": "set_item", "id": "ball", "held": true, "name": "Red ball"}` — name, held, fixed.
- `{"op": "set_scene", "seconds": 8, "release": 1.0, "title": "..."}` — any of seconds, release, title.
- `{"op": "set_goals", "goals": [...]}` and `{"op": "set_tune", "tune": [...]}` — replace the whole list.
Each patch may carry `"why"`.
