#!/usr/bin/env bash
# The engine's real-world validators: every tracked research/rw-validate*.ts (so a new one runs without a change here), except the
# historical records research/*-before-*.ts (the engine as it was before a repair) and the research/rw-validate-slop.ts variant.
# A validator that sets process.exitCode / calls process.exit is GATED (it fails on a check outside its tolerance); one that does not is
# a SMOKE run: it prints the engine's numbers next to theory and can fail only by crashing, and the log says so.
# They run the engine with the browser bundle's math (tools/engine-math-node.mjs), as the server's worker does: node's own Math.sin, cos
# and pow are the platform's (on Linux x64 not the fused multiply-add builds the bundle's functions reproduce), so without it the numbers
# here would not be the engine's. All of them run even when one fails; logs go to ci-logs/<name>.log.
set -uo pipefail
cd "$(dirname "$0")/../.."
mkdir -p ci-logs

files="$(git ls-files -- 'research/rw-validate*.ts' | grep -vE -- '-before-|^research/rw-validate-slop\.ts$' || true)"
[ -n "$files" ] || { echo "::error::no research/rw-validate*.ts validators are tracked"; exit 1; }
rc=0
report=()
for f in $files; do
	name="$(basename "$f" .ts)"
	if grep -qE 'process\.exit(Code)?\b' "$f"; then kind=gated; else kind="smoke (no pass/fail gate; fails only by crashing)"; fi
	echo "::group::$f: $kind"
	start=$(date +%s)
	node --no-warnings --import ./tools/engine-math-node.mjs "$f" 2>&1 | tee "ci-logs/$name.log"
	r=${PIPESTATUS[0]}
	echo "::endgroup::"
	pass=$(grep -cE '^[[:space:]]*PASS\b' "ci-logs/$name.log" || true)
	fail=$(grep -cE '^[[:space:]]*FAIL\b' "ci-logs/$name.log" || true)
	line="$f: exit $r, $kind, $pass PASS / $fail FAIL lines, $(($(date +%s) - start)) s; last line: $(tail -n 1 "ci-logs/$name.log" | cut -c1-120)"
	report+=("$line")
	if [ "$r" -ne 0 ]; then
		echo "::error title=Validator failed::$f exited $r (ci-logs/$name.log)"
		rc=1
	elif [ "$kind" != gated ]; then
		echo "::notice title=Smoke validator::$f has no pass/fail gate: it passes unless it crashes"
	fi
done
echo "validators:"
printf '  %s\n' "${report[@]}"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] || { echo "### Engine validators"; printf -- '- %s\n' "${report[@]}"; } >>"$GITHUB_STEP_SUMMARY"
exit $rc
