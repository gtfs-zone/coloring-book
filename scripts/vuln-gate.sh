#!/bin/sh
# Scans a lockfile (default pnpm-lock.yaml) with osv-scanner, prints every
# finding and fails when any vulnerability group has a CVSS max_severity of 9.0
# or higher (critical).
set -eu

LOCKFILE="${1:-pnpm-lock.yaml}"
REPORT="$(mktemp)"
trap 'rm -f "$REPORT"' EXIT

# osv-scanner exits 1 when it finds vulnerabilities; anything else is an error.
status=0
osv-scanner scan source --lockfile "$LOCKFILE" --format json >"$REPORT" || status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 1 ]; then
  echo "[vuln-gate] osv-scanner failed with exit code $status" >&2
  exit "$status"
fi

jq -r '
  [.results[]?.packages[]? | .package as $p | .groups[]
    | {sev: (.max_severity // ""), pkg: "\($p.name)@\($p.version)", ids: (.aliases // .ids | join(","))}]
  | sort_by(-(.sev | tonumber? // 0))
  | .[] | "\(if .sev == "" then "?" else .sev end)\t\(.pkg)\t\(.ids)"
' "$REPORT"

critical=$(jq '[.results[]?.packages[]?.groups[] | select((.max_severity // "" | tonumber? // 0) >= 9.0)] | length' "$REPORT")
total=$(jq '[.results[]?.packages[]?.groups[]] | length' "$REPORT")

echo "[vuln-gate] $total finding(s), $critical critical"
if [ "$critical" -gt 0 ]; then
  exit 1
fi
