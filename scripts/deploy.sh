#!/usr/bin/env bash
# Build the site and publish it to chaiwala.
#
#   npm run deploy                 # build + rsync dist/ (and redirects if they changed)
#   npm run deploy -- --setup      # first time: also install the Nginx config on the server (asks for sudo)
#   npm run deploy -- --no-build   # publish the existing dist/ without rebuilding
#
# Override the target with SSH_HOST (default: chaiwala) and SITE_ROOT (default: /var/www/escaperoomreviews.ca).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST="${SSH_HOST:-chaiwala}"
SITE_ROOT="${SITE_ROOT:-/var/www/escaperoomreviews.ca}"
SETUP=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --setup) SETUP=1 ;;
    --no-build) BUILD=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

cd "$ROOT"

if [[ $SETUP -eq 1 ]]; then
  echo "==> Copying deploy files to $SSH_HOST:~/escaperoomreviews-deploy/"
  rsync -az --delete deploy/ "$SSH_HOST:~/escaperoomreviews-deploy/"
  echo "==> Running server setup (sudo password may be requested)"
  ssh -tt "$SSH_HOST" "sudo SITE_ROOT='$SITE_ROOT' bash ~/escaperoomreviews-deploy/server-setup.sh"
fi

if [[ $BUILD -eq 1 ]]; then
  echo "==> Building"
  npm run build
fi

if [[ ! -f dist/index.html ]]; then
  echo "dist/ is empty; run without --no-build." >&2
  exit 1
fi

echo "==> Publishing dist/ to $SSH_HOST:$SITE_ROOT/site/"
rsync -az --delete --exclude '.DS_Store' --chmod=D755,F644 dist/ "$SSH_HOST:$SITE_ROOT/site/"

if ! ssh "$SSH_HOST" "cmp -s - '$SITE_ROOT/nginx/redirects.conf'" < deploy/nginx/redirects.conf; then
  echo "==> Redirects changed; updating and reloading Nginx (sudo password may be requested)"
  rsync -az --chmod=F644 deploy/nginx/redirects.conf "$SSH_HOST:$SITE_ROOT/nginx/redirects.conf"
  ssh -tt "$SSH_HOST" "sudo nginx -t && sudo systemctl reload nginx"
fi

echo "==> Done: https://www.escaperoomreviews.ca/"
