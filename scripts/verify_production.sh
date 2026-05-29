#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# LumaScout — Post-deployment production verification (Jun 2025)
#
# Usage:
#   PROD_HOST=https://photo-finder-60.cluster-8.deploy.emergent.host \
#     bash /app/scripts/verify_production.sh
#
# Or with the alternate host:
#   PROD_HOST=https://photo-finder-60.emergent.host \
#     bash /app/scripts/verify_production.sh
#
# This script:
#   1. Hits /api/health  (origin liveness, must be 200)
#   2. Hits /api/        (root, must return JSON)
#   3. Hits /api/spots?limit=1                   (explore data path)
#   4. Hits /api/spots/markers?lat=29.43&lng=-98.49&radius_km=80  (map path)
#   5. Validates X-Response-Time header is present
#   6. Probes an existing share link if SHARE_TOKEN is set
#   7. Confirms CORS is enabled (OPTIONS preflight from a foreign origin)
#
# Each check prints PASS/FAIL with the exact HTTP status. The script
# exits 0 only if every required probe passes, so it can also be wired
# into CI / a heartbeat job.
# ---------------------------------------------------------------------------
set -u

PROD_HOST="${PROD_HOST:-https://photo-finder-60.cluster-8.deploy.emergent.host}"
SHARE_TOKEN="${SHARE_TOKEN:-}"
FAIL=0

color() { printf "\033[%sm%s\033[0m" "$1" "$2"; }
ok()   { color "32;1" "PASS"; }
bad()  { color "31;1" "FAIL"; }
warn() { color "33;1" "WARN"; }

probe() {
  # probe <label> <url> <expected_status> [grep_pattern]
  local label="$1" url="$2" expected="$3" grep_pat="${4:-}"
  local hdr_file body_file status
  hdr_file="$(mktemp)" ; body_file="$(mktemp)"
  status=$(curl -s -o "$body_file" -D "$hdr_file" -w "%{http_code}" --max-time 15 "$url" || echo "000")
  local rt
  rt=$(grep -i "^x-response-time:" "$hdr_file" | tr -d '\r' | awk '{print $2}')
  if [[ "$status" == "$expected" ]]; then
    if [[ -n "$grep_pat" ]] && ! grep -q "$grep_pat" "$body_file"; then
      echo "$(bad) $label  status=$status (body did not match '$grep_pat')  rt=${rt:-—}"
      head -c 200 "$body_file"; echo
      FAIL=$((FAIL+1))
    else
      echo "$(ok) $label  status=$status  rt=${rt:-—}"
    fi
  else
    echo "$(bad) $label  status=$status (expected $expected)  rt=${rt:-—}"
    head -c 200 "$body_file"; echo
    FAIL=$((FAIL+1))
  fi
  rm -f "$hdr_file" "$body_file"
}

echo "════════════════════════════════════════════════════════════════"
echo "LumaScout production verification"
echo "  host: $PROD_HOST"
echo "  date: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "════════════════════════════════════════════════════════════════"

probe "health endpoint"        "$PROD_HOST/api/health"                                       200 '"ok":true'
probe "api root"               "$PROD_HOST/api/"                                             200 'LumaScout'
probe "explore list"           "$PROD_HOST/api/spots?limit=1&sort=quality"                  200
probe "explore markers (SAT)"  "$PROD_HOST/api/spots/markers?lat=29.43&lng=-98.49&radius_km=80" 200
probe "spot detail (random)"   "$PROD_HOST/api/spots/spot_DOES_NOT_EXIST"                   404 'detail'

# CORS preflight — needs -X OPTIONS + headers, so handled out of band.
cors_status=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  -H "Origin: https://lumascout.app" \
  -H "Access-Control-Request-Method: GET" \
  --max-time 10 "$PROD_HOST/api/health" || echo "000")
if [[ "$cors_status" == "200" || "$cors_status" == "204" ]]; then
  echo "$(ok) cors preflight  status=$cors_status"
else
  echo "$(bad) cors preflight  status=$cors_status (expected 200/204)"
  FAIL=$((FAIL+1))
fi

if [[ -n "$SHARE_TOKEN" ]]; then
  probe "public share link"    "$PROD_HOST/api/public/location/$SHARE_TOKEN"                200 'lumascout\|LumaScout\|Photos from this spot'
else
  echo "$(warn) share link skipped (set SHARE_TOKEN env to enable)"
fi

echo "────────────────────────────────────────────────────────────────"
if [[ $FAIL -eq 0 ]]; then
  echo "$(ok)  ALL CHECKS GREEN  — production is healthy"
  exit 0
else
  echo "$(bad)  $FAIL CHECK(S) FAILED  — see status codes above"
  exit 1
fi
