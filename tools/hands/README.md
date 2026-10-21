# tools/hands

- `build_hand.py` builds `web/models/hand.glb`, the child's left hand and short sleeved forearm that the view draws. It runs headless in
  Blender 5.1 and needs no downloads: `"/Applications/Blender.app/Contents/MacOS/Blender" -b --factory-startup -P tools/hands/build_hand.py`
  (add `-- --proof DIR` for the contact sheet, close-ups and weight maps). The shape is a signed distance field written in the script
  (oval phalanges, finger pads, soft knuckles, an arched palm with thenar and hypothenar pads, finger webs, a thumb set at its real angle,
  a tapering forearm), meshed by surface nets, then QuadriFlow (fixed seed), with every vertex put back on the field. The nails and the
  knit cuff sleeve are separate meshes. The skin has Blender's automatic weights, checked so that no finger carries another finger's
  bones. The same script always writes the same file (about 6.4k triangles, 190 KB).
- The rig is one left hand in metres: palm toward -Y, fingers along +X, thumb toward +Z, wrist joint at the origin. The bones are
  `forearm > wrist > palm > thumb_1..3, index_1..3, middle_1..3, ring_1..3, pinky_1..3`. In each joint's rest frame X runs along the bone,
  Y is the back of the hand (the nail side for the thumb), and Z = X x Y. To pose a bone, set `bone.quaternion = rest x Euler(twist,
  -spread, -flex, 'YZX')`: positive flex bends toward the palm, positive spread turns toward the thumb. The right hand is this one with
  z scaled by -1. The materials are `skin`, `nail` and `sleeve`. Each bone's `userData` holds its length, skin sections and fingertip and
  pad points; the root's `userData` holds the measures (14.5 cm long, 6.5 cm across the palm, cuff at 2.85 cm, sleeve end at 7.75 cm).
- `test.mjs` checks the hands module: catalog props, documents and tracks in Python and JS. `py_hands.py` is its Python side.
  `browser.mjs` checks the drawn hands (`web/hands.js`) in the app, headless. `scenes/` holds the proof scenes.
