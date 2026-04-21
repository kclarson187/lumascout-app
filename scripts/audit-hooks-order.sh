#!/usr/bin/env bash
#
# audit-hooks-order.sh
#
# Scans the Expo Router frontend for the "Rules of Hooks" violation that
# caused the Commit 5 P0: a `useX(...)` call placed AFTER a component-level
# early `return`. Between one render where the early return fires (e.g.
# `user === null`) and a later render where it doesn't (user hydrated),
# the hook count changes and React crashes with
#    "Rendered more hooks than during the previous render".
#
# This script is a pragmatic heuristic — it doesn't replace code review,
# but it catches the pattern quickly. Run it before shipping any new
# screen layout or auth-gated component.
#
# Usage:
#   bash scripts/audit-hooks-order.sh
#
# Exits 0 with a clean scan, 1 if any files are flagged.

set -e

ROOT="${1:-/app/frontend/app}"
cd "$(dirname "$0")/.."

python3 - <<'PYEOF'
import os, re, glob, sys

root = os.environ.get("ROOT", "/app/frontend/app")
files = sorted(set(
    glob.glob(f"{root}/**/_layout.tsx", recursive=True)
    + glob.glob(f"{root}/**/*.tsx",    recursive=True)
))
flagged = []
for f in files:
    try:
        lines = open(f).read().split("\n")
    except Exception:
        continue
    in_comp = False
    first_return = None
    hits = []
    for i, line in enumerate(lines):
        # Top-level component definition (CamelCase fn name)
        if re.match(r"^(export default )?function [A-Z]\w*\s*\(", line):
            in_comp = True
            first_return = None
            continue
        if not in_comp:
            continue
        # A component-body early return (2-4 space indent = top level of body)
        if re.match(r"^\s{2,4}return\s*[\(<;nN]", line) or re.match(r"^\s{2,4}return null", line):
            if first_return is None:
                first_return = i + 1
        # A hook declaration at the top level after an early return
        if first_return and re.search(r"^\s{2,4}(const|let|var)\s+\w+\s*=\s*use[A-Z]\w*\s*\(", line):
            hits.append((i + 1, first_return, line.strip()[:110]))
    if hits:
        flagged.append((f, hits))

for f, hits in flagged:
    print(f"=== {f} ===")
    for ln, early, txt in hits[:5]:
        print(f"  line {ln} (after early return at line {early}):\n    {txt}")

if flagged:
    print(f"\n[FAIL] {len(flagged)} file(s) flagged for hooks-order review.")
    print("Note: may include false positives when the flagged `return` is inside")
    print("a useEffect cleanup. Human review required for each hit.")
    sys.exit(1)
else:
    print("[OK] No hooks-below-early-return patterns detected.")
    sys.exit(0)
PYEOF
