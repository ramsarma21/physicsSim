#!/usr/bin/env bash
# The Python <-> JS parity suite (tools/parity/run.sh) as CI runs it, on macOS: web/sim matches CPython built on the platform libm down to
# rounding ties, and that libm is macOS's. Needs the engine bundle (.github/scripts/engine-bundle.sh build).
#  - The steps are run.sh's own `node ...` lines (so a step added there runs here too), PARITY_JOBS (default 3, the runner's cores) at a
#    time: they are independent (each writes its own temp folder and only reads the server), and one after another they take ~14 min.
#  - The browser steps get the playwright-core version the tools name (the development machine's ~/.bun cache) and its headless
#    Chromium, through PLAYWRIGHT_CORE.
#  - The steps that compare against the running server (core.mjs's live rows, catalog.mjs, mechanisms.mjs, browser-mechanisms.mjs,
#    fuzz-live.mjs) get web/server.py on localhost:8790, started here from this checkout.
# Logs: ci-logs/parity/NN.log (one per step), ci-logs/server.log.
#   parity-macos.sh            set up, then run every step
#   parity-macos.sh --one F    (internal) run the step in F (NN.cmd), log to NN.log, mark NN.failed on failure
set -euo pipefail
cd "$(dirname "$0")/../.."
self="$PWD/.github/scripts/parity-macos.sh"

if [ "${1:-}" = "--one" ]; then
	f="$2"
	start=$(date +%s)
	if bash "$f" >"${f%.cmd}.log" 2>&1; then
		echo "parity: ok      $(($(date +%s) - start))s  $(tail -n 1 "$f")"
	else
		rc=$?
		echo "$rc" >"${f%.cmd}.failed"
		echo "parity: FAILED  $(($(date +%s) - start))s  $(tail -n 1 "$f")  (exit $rc)"
	fi
	exit 0
fi

mkdir -p ci-logs/parity
rm -f ci-logs/parity/*
tmp="${RUNNER_TEMP:-$(mktemp -d)}"

pw_version="$(grep -ohE 'playwright-core@[0-9]+\.[0-9]+\.[0-9]+' tools/parity/*.mjs | sort -u | head -n 1 | cut -d@ -f2)"
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
curl -fsS -o /dev/null http://localhost:8790/api/catalog || {
	cat ci-logs/server.log
	echo "::error::web/server.py did not answer in 90 s"
	exit 1
}
echo "server up (pid $server)"
echo "::endgroup::"

# run.sh's steps: every line that starts with `node` (its "$@" is empty here; a trailing comment is a comment to bash too)
n=0
while IFS= read -r line; do
	n=$((n + 1))
	printf 'cd %q\n%s\n' "$PWD" "$line" >"ci-logs/parity/$(printf %02d $n).cmd"
done < <(grep -E '^node ' tools/parity/run.sh)
[ "$n" -gt 0 ] || { echo "::error::no steps found in tools/parity/run.sh"; exit 1; }
echo "parity: $n steps from tools/parity/run.sh, ${PARITY_JOBS:-3} at a time"
ls ci-logs/parity/*.cmd | xargs -P "${PARITY_JOBS:-3}" -n 1 "$self" --one

failed=0
for f in ci-logs/parity/*.cmd; do
	b="${f%.cmd}"
	if [ -f "$b.failed" ]; then
		failed=$((failed + 1))
		echo "::error title=Parity step failed::$(tail -n 1 "$f" | cut -c1-160)"
		echo "::group::FAILED: $(tail -n 1 "$f" | cut -c1-160)"
	else
		echo "::group::ok: $(tail -n 1 "$f" | cut -c1-160)"
	fi
	cat "$b.log"
	echo "::endgroup::"
	grep -E '^total ' "$b.log" | tail -n 1 || true
done
if [ "$failed" -gt 0 ]; then
	echo "parity: $failed of $n steps failed"
	exit 1
fi
echo "parity: all $n steps passed"
