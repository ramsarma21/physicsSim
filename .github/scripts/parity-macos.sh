#!/usr/bin/env bash
# The Python <-> JS parity suite (tools/parity/run.sh) as CI runs it, on macOS: web/sim matches CPython built on the platform libm down to
# rounding ties, and that libm is macOS's. Needs the engine bundle (.github/scripts/engine-bundle.sh build) and runs every step of run.sh:
#  - the browser steps get the playwright-core version run.sh's tools name (the development machine's ~/.bun cache) and its headless
#    Chromium, through PLAYWRIGHT_CORE;
#  - the steps that compare against the running server (core.mjs --mode server's live rows, catalog.mjs, mechanisms.mjs,
#    browser-mechanisms.mjs, fuzz-live.mjs) get web/server.py on localhost:8790, started here from this checkout.
# Logs go to ci-logs/ (parity.log, server.log).
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p ci-logs
tmp="${RUNNER_TEMP:-$(mktemp -d)}"

pw_version="$(grep -ohE 'playwright-core@[0-9]+\.[0-9]+\.[0-9]+' tools/parity/*.mjs | sort -u | head -1 | cut -d@ -f2)"
pw_version="${pw_version:-1.60.0}"
echo "::group::playwright-core $pw_version and its headless Chromium"
npm install --prefix "$tmp/pw" --no-save --no-package-lock --no-audit --no-fund "playwright-core@$pw_version"
pw="$tmp/pw/node_modules/playwright-core"
node "$pw/cli.js" install --only-shell chromium || node "$pw/cli.js" install chromium
echo "::endgroup::"
export PLAYWRIGHT_CORE="$pw"

echo "::group::web/server.py on localhost:8790"
python3 web/server.py 8790 >ci-logs/server.log 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do
	if curl -fsS -o /dev/null http://localhost:8790/api/catalog; then break; fi
	if ! kill -0 $server 2>/dev/null; then
		cat ci-logs/server.log
		echo "::error::web/server.py exited before answering"
		exit 1
	fi
	sleep 1
done
curl -fsS -o /dev/null http://localhost:8790/api/catalog || { cat ci-logs/server.log; echo "::error::web/server.py did not answer in 90 s"; exit 1; }
echo "server up (pid $server)"
echo "::endgroup::"

bash tools/parity/run.sh 2>&1 | tee ci-logs/parity.log
