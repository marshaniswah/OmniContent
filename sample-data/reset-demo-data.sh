#!/usr/bin/env bash
# Reset RADAR demo data (synthetic only).
# - regenerates tickets relative to the current time, so some are past their SLA again
# - deletes all CsTicket and CsRetentionCase records, then re-imports tickets
# Customers are not touched. Requires: uip login, python.
set -euo pipefail
export NODE_NO_WARNINGS=1
HERE="$(cd "$(dirname "$0")" && pwd)"

entity_id() { uip df entities list --native-only --output json --output-filter "[?Name=='$1'] | [0].Id" | python -c "import sys,json;print(json.loads(sys.stdin.read().lstrip('\ufeff'))['Data']['Value'])"; }
all_ids() { uip df records list "$1" --limit 1000 --output json | python -c "import sys,json;print(' '.join(r['Id'] for r in json.loads(sys.stdin.read().lstrip('\ufeff'))['Data']['Items']))"; }

TICKET=$(entity_id CsTicket); CASES=$(entity_id CsRetentionCase)
python "$HERE/generate_data.py" "$HERE"

for E in "$CASES" "$TICKET"; do
  IDS=$(all_ids "$E")
  if [ -n "$IDS" ]; then uip df records delete "$E" $IDS --yes --reason "RADAR demo reset" --output json >/dev/null; fi
done
uip df records import "$TICKET" --file "$HERE/tickets.csv" --output json
echo "Demo data reset."
