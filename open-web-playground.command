#!/bin/zsh
# Double-click: starts the Machine Playground web app (if it isn't running) and opens it in your browser.
# Local only (127.0.0.1); the edullm repo is never touched.
P="${0:A:h}"
if ! curl -s -o /dev/null http://localhost:8790/api/schema; then
  nohup python3 "$P/web/server.py" 8790 > "$P/web/server.log" 2>&1 &
  for i in {1..40}; do curl -s -o /dev/null http://localhost:8790/api/schema && break; sleep 0.25; done
fi
open http://localhost:8790/
