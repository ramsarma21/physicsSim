#!/usr/bin/env bash
# A hang report for a long CI step. On 2026-10-21 both macOS jobs sat silent until their 60 min timeout (the unit tests 51 min after their
# last line, the parity suite 44 min on one step), each with a node process still waiting on a python3 child, and the log never said which
# test or step it was. Started in the background next to the step, this sleeps SECONDS; if the step is still running then, it prints this
# user's processes (state, elapsed and CPU time, memory, command line) and, for every python3 process older than MIN_AGE seconds that is not
# web/server.py, its open files, then sends it SIGABRT: with PYTHONFAULTHANDLER=1 (the step exports it) Python prints its stack on its
# stderr, which the node caller (execFileSync) puts in its error, so the step fails with where it hung instead of running into the timeout.
# It stops nothing before SECONDS, and nothing at all when no python3 process is that old.
#   hang-report.sh SECONDS LABEL [MIN_AGE]   (in the background; the step kills it when it ends)
# HANG_REPORT_MATCH (an extended regex, for trying it out on a machine with other work) limits it to python3 processes whose command matches.
set -u
secs="${1:?usage: hang-report.sh SECONDS LABEL [MIN_AGE]}"
label="${2:-step}"
min_age="${3:-600}"
# (the sleep in the background, so that the step's kill ends it too: no stray process outlives the step)
sleep "$secs" </dev/null >/dev/null 2>&1 &
nap=$!
trap 'kill "$nap" 2>/dev/null; exit 0' TERM INT
wait "$nap" || exit 0
trap - TERM INT
me="$(id -u)"
echo "::warning title=Still running after ${secs} s::${label}: this job's processes follow (.github/scripts/hang-report.sh)"
echo "::group::processes after ${secs} s (${label})"
ps -U "$me" -ww -o pid=,ppid=,stat=,etime=,time=,rss=,command= 2>/dev/null | head -n 400
echo "::endgroup::"
# ps's etime is [[dd-]hh:]mm:ss
seconds_of() { awk -v t="$1" 'BEGIN { d = 0; if (index(t, "-")) { split(t, a, "-"); d = a[1]; t = a[2] } n = split(t, p, ":"); s = 0; for (i = 1; i <= n; i++) s = s * 60 + p[i]; print d * 86400 + s }'; }
for pid in $(pgrep -U "$me" -i python 2>/dev/null); do
	cmd="$(ps -ww -o command= -p "$pid" 2>/dev/null || true)"
	case "$cmd" in "" | *web/server.py*) continue ;; esac
	[ -z "${HANG_REPORT_MATCH:-}" ] || printf %s "$cmd" | grep -qE -- "$HANG_REPORT_MATCH" || continue
	et="$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')"
	[ -n "$et" ] || continue
	[ "$(seconds_of "$et")" -ge "$min_age" ] || continue
	echo "::group::python3 pid $pid, running $et: $(printf %s "$cmd" | cut -c1-200)"
	ps -o pid=,ppid=,stat=,etime=,time=,rss= -p "$pid" 2>/dev/null
	ps -ww -o pid=,stat=,etime=,time=,command= -p "$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')" 2>/dev/null
	lsof -p "$pid" 2>/dev/null | head -n 40
	echo "::endgroup::"
	echo "::error title=A python3 process hung::pid $pid ran $et ($(printf %s "$cmd" | cut -c1-160)); SIGABRT sent, so it prints its Python stack (PYTHONFAULTHANDLER) to its caller"
	kill -ABRT "$pid" 2>/dev/null || true
done
