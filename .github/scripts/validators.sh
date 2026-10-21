#!/usr/bin/env bash
# The engine's real-world validators: every tracked research/rw-validate*.ts (so a new one runs without a change here), except the
# historical records research/*-before-*.ts (the engine as it was before a repair) and the research/rw-validate-slop.ts variant.
# A validator that sets process.exitCode / calls process.exit is GATED (it fails on a check outside its tolerance); one that does not is
# a SMOKE run: it prints the engine's numbers next to theory and can fail only by crashing, and the log says so.
# They run the engine with the browser bundle's math (tools/engine-math-node.mjs), as the server's worker does: node's own Math.sin, cos
# and pow are the platform's (on Linux x64 not the fused multiply-add builds the bundle's functions reproduce), so without it the numbers
# here would not be the engine's. All of them run even when one fails; logs go to ci-logs/<name>.log.
#   validators.sh               every validator
#   validators.sh p4|rest       CI's two parallel groups (ci.yml, job validators): research/rw-validate-p4.ts alone (its crash fuzz is most of
#                               the time), and every other one (so a new validator runs in "rest" with no change here); the two are the whole list
#   validators.sh --list [GROUP]   prints the files and runs nothing
# FUZZ_N and FUZZ_JOBS size p4's crash fuzz (CI: a smaller one on its 4-core runners) and reach rw-validate-p4.ts only: the module
# validators that read FUZZ_N for their own random scenes (fluids, granular, measure, optics, thermal, circuits) keep their default sizes
# here (30 to 3000), as a run by hand without it does. With CI's 1500 they ran 1500 each and took the Linux job past its 40 minutes.
set -uo pipefail
cd "$(dirname "$0")/../.."

list=0
if [ "${1:-}" = --list ]; then
	list=1
	shift
fi
group="${1:-all}"
P4='^research/rw-validate-p4\.ts$'
files="$(git ls-files -- 'research/rw-validate*.ts' | grep -vE -- '-before-|^research/rw-validate-slop\.ts$' || true)"
[ -n "$files" ] || { echo "::error::no research/rw-validate*.ts validators are tracked"; exit 1; }
case "$group" in
	all) ;;
	p4) files="$(grep -E "$P4" <<<"$files" || true)" ;;
	rest) files="$(grep -vE "$P4" <<<"$files" || true)" ;;
	*)
		echo "usage: validators.sh [--list] [all|p4|rest]" >&2
		exit 2
		;;
esac
[ -n "$files" ] || { echo "::error::validators.sh: no validator in group $group"; exit 1; }
if [ "$list" = 1 ]; then
	echo "$files"
	exit 0
fi
mkdir -p ci-logs
rc=0
report=()
for f in $files; do
	name="$(basename "$f" .ts)"
	if grep -qE 'process\.exit(Code)?\b' "$f"; then kind=gated; else kind="smoke (no pass/fail gate; fails only by crashing)"; fi
	if [ "$name" = rw-validate-p4 ]; then scope=(env); else scope=(env -u FUZZ_N -u FUZZ_JOBS); fi
	echo "::group::$f: $kind"
	start=$(date +%s)
	"${scope[@]}" node --no-warnings --import ./tools/engine-math-node.mjs "$f" 2>&1 | tee "ci-logs/$name.log"
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
echo "validators ($group):"
printf '  %s\n' "${report[@]}"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] || { echo "### Engine validators ($group)"; printf -- '- %s\n' "${report[@]}"; } >>"$GITHUB_STEP_SUMMARY"
exit $rc
