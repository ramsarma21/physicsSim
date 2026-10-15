#!/bin/zsh
# usage: send.sh <name> '<python>'   — runs the python inside the playground Blender, prints its log
D=${0:A:h}
print -r -- "$2" > "$D/inbox/$1.py"
for i in {1..120}; do [ -f "$D/done/$1.py.log" ] && { cat "$D/done/$1.py.log"; exit 0 }; sleep 0.5; done
echo "no answer from Blender (is the playground window open?)"; exit 1
