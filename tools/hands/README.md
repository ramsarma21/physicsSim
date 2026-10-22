# tools/hands

- `build_hand.py` builds `web/models/hand.glb`, the child's left hand and sleeved forearm that the view draws. It runs headless in
  Blender 5.1 and needs no downloads: `"/Applications/Blender.app/Contents/MacOS/Blender" -b --factory-startup -P tools/hands/build_hand.py`
  (add `-- --proof DIR` for the contact sheet, close-ups and weight maps). The shape is a signed distance field written in the script
  (oval phalanges, finger pads, soft knuckles, an arched palm with thenar and hypothenar pads, finger webs, a thumb set at its real angle,
  a tapering forearm), meshed by surface nets, then QuadriFlow (fixed seed), with every vertex put back on the field. The nails and the
  knit cuff and the start of the sleeve are separate meshes; the sleeve piece is an open tube whose last 7.5 mm keep one section, so the
  view carries the sleeve on from its end ring up the arm, out of the picture, with no seam (`setArm`, `sleeveOn` in `web/hands.js`). The skin has Blender's automatic weights, checked so that no finger carries another finger's
  bones. The same script always writes the same file (about 6.1k triangles, 186 KB).
- The rig is one left hand in metres: palm toward -Y, fingers along +X, thumb toward +Z, wrist joint at the origin. The bones are
  `forearm > wrist > palm > thumb_1..3, index_1..3, middle_1..3, ring_1..3, pinky_1..3`. In each joint's rest frame X runs along the bone,
  Y is the back of the hand (the nail side for the thumb), and Z = X x Y. To pose a bone, set `bone.quaternion = rest x Euler(twist,
  -spread, -flex, 'YZX')`: positive flex bends toward the palm, positive spread turns toward the thumb. The right hand is this one with
  z scaled by -1. The materials are `skin`, `nail` and `sleeve`. Each bone's `userData` holds its length, skin sections and fingertip and
  pad points; the root's `userData` holds the measures (14.5 cm long, 6.5 cm across the palm, cuff at 2.85 cm, the sleeve piece's open end at 7.75 cm and
  the ring of that end, `sleeve.ring`: [y, z] round it in order, which the view's sleeve starts on).
- The view loads the file once (`web/hand-model.js`, waited for by `web/hands.js`) and gives each hand a clone of it. `web/hands.js` fits its
  collision spheres to this skin when it loads (`meshProxies`), and fits where a hand finally touches on the skin itself, skinned on the CPU as
  the GPU skins it (`skinClearance`, `seatOnSkin`, `closeOnSkin`, `closePinch`). If the file does not load, the old procedural capsule hand
  is drawn. After rebuilding the file, run `node --test tools/hands/rules.test.mjs`: it checks the spheres against the skin in every pose,
  that no digit's skin lies in another's, and every hold and push on the drawn skin.
- `test.mjs` checks the hands module: catalog props, documents and tracks in Python and JS. `py_hands.py` is its Python side.
  `rules.test.mjs` checks the hands' rules on boxes on the drawn mesh (and that the capsule hand still works).
  `browser.mjs` checks the drawn hands (`web/hands.js`) in the app, headless, including the capsule hand when hand.glb is blocked.
  `scenes/` holds the proof scenes.
