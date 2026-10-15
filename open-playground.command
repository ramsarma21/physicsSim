#!/bin/zsh
# Double-click to open the ramp playground in Blender (copy only; the edullm repo is never touched).
P="/Users/ramsarma/Downloads/science-map-share/blender-playground"
SIM_TS="$P/tooling/sim.ts" exec /Applications/Blender.app/Contents/MacOS/Blender --enable-autoexec "$P/scenes/${1:-ramp-bounce}.blend" --python "$P/control/bridge.py" > "$P/control/blender.log" 2>&1
