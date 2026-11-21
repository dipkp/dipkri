#!/usr/bin/env bash
# Applies a Firebase service-account JSON to the running dipkri server.
#
#   bash scripts/set-firebase-admin.sh /path/to/serviceAccount.json
#
# The key is copied to /home/ubuntu/secrets (chmod 600, outside the repo) and
# exported to PM2 as a single-line JSON string, which is what
# FIREBASE_ADMIN_SDK_CONFIG expects.

set -euo pipefail

SRC="${1:-}"
APP_DIR="/home/ubuntu/watchparty"
SECRET_DIR="/home/ubuntu/secrets"

if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "usage: bash scripts/set-firebase-admin.sh /path/to/serviceAccount.json" >&2
  exit 1
fi

python3 - "$SRC" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
missing = [k for k in ("project_id", "client_email", "private_key") if k not in data]
if missing:
    sys.exit("not a service account key, missing: " + ", ".join(missing))
print("project:", data["project_id"])
print("account:", data["client_email"])
PY

mkdir -p "$SECRET_DIR"
install -m 600 "$SRC" "$SECRET_DIR/firebase-admin.json"
echo "stored: $SECRET_DIR/firebase-admin.json (600)"

cd "$APP_DIR"
CONFIG=$(python3 -c 'import json;print(json.dumps(json.load(open("/home/ubuntu/secrets/firebase-admin.json"))))')

FIREBASE_ADMIN_SDK_CONFIG="$CONFIG" HOST=127.0.0.1 \
  ./node_modules/.bin/pm2 restart watchparty --update-env >/dev/null

sleep 6
echo "--- checks ---"
echo "site:      $(curl -s -o /dev/null -w '%{http_code}' https://dipkri.duckdns.org/ --max-time 10)"
echo "streamKey: $(curl -s -X POST http://127.0.0.1:8080/streamKey -H 'Content-Type: application/json' -d '{}' --max-time 10)"
echo "no key:    $(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:8080/stream?torrent=magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10' --max-time 10)"
echo
echo "Expect: streamKey configured:true, required:false (enforcement is opt-in)."
echo "Turn enforcement on:  SEC_STREAM_AUTH=on HOST=127.0.0.1 ./node_modules/.bin/pm2 restart watchparty --update-env"
echo "Expect then: streamKey required:true and /stream without a key 401."
echo "Roll back: restart without FIREBASE_ADMIN_SDK_CONFIG."
