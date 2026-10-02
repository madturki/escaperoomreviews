#!/usr/bin/env bash
# One-time (and re-runnable) Nginx setup for the static escaperoomreviews.ca site on chaiwala.
#
#   sudo bash ~/escaperoomreviews-deploy/server-setup.sh              # install/refresh config
#   sudo ISSUE_CERT=1 LETSENCRYPT_EMAIL=you@example.com bash ...      # also request a certificate
#
# - Creates /var/www/escaperoomreviews.ca/{site,nginx}, owned by the deploy user so rsync works without sudo.
# - Backs up the existing (WordPress) Nginx site config before replacing it.
# - Uses HTTPS if a certificate covering escaperoomreviews.ca + www already exists, otherwise HTTP only.
# - Never touches other Nginx sites, PHP-FPM, MariaDB, or the old WordPress files.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_ROOT="${SITE_ROOT:-/var/www/escaperoomreviews.ca}"
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-root}}"
SITE_CONF=/etc/nginx/sites-available/escaperoomreviews.ca
DOMAINS=(escaperoomreviews.ca www.escaperoomreviews.ca)

echo "[1/5] Directories under $SITE_ROOT (owner: $DEPLOY_USER)"
install -d -o "$DEPLOY_USER" -g www-data -m 0755 "$SITE_ROOT/site" "$SITE_ROOT/nginx"
install -o "$DEPLOY_USER" -g www-data -m 0644 "$HERE/nginx/site-common.conf" "$SITE_ROOT/nginx/site-common.conf"
sed -i "s#__SITE_ROOT__#$SITE_ROOT#g" "$SITE_ROOT/nginx/site-common.conf"
install -o "$DEPLOY_USER" -g www-data -m 0644 "$HERE/nginx/redirects.conf" "$SITE_ROOT/nginx/redirects.conf"
if [[ ! -f "$SITE_ROOT/site/index.html" ]]; then
  echo '<!doctype html><title>Escape Room Reviews</title><p>Deploy pending.</p>' > "$SITE_ROOT/site/index.html"
  echo '<!doctype html><title>Not found</title><p>Not found.</p>' > "$SITE_ROOT/site/404.html"
  chown "$DEPLOY_USER":www-data "$SITE_ROOT/site/index.html" "$SITE_ROOT/site/404.html"
fi

find_cert_dir() {
  local dir
  for dir in /etc/letsencrypt/live/*/; do
    [[ -f "$dir/cert.pem" ]] || continue
    local sans
    sans=$(openssl x509 -in "$dir/cert.pem" -noout -ext subjectAltName 2>/dev/null || true)
    if grep -q "DNS:escaperoomreviews.ca\b" <<<"$sans" && grep -q "DNS:www.escaperoomreviews.ca" <<<"$sans"; then
      echo "${dir%/}"
      return 0
    fi
  done
  return 1
}

render_config() {
  local template="$1" cert_dir="${2:-}"
  sed -e "s#__SITE_ROOT__#$SITE_ROOT#g" -e "s#__CERT_DIR__#$cert_dir#g" "$HERE/nginx/$template" > "$SITE_CONF"
}

apply_config() {
  ln -sf "$SITE_CONF" /etc/nginx/sites-enabled/escaperoomreviews.ca
  if ! nginx -t; then
    echo "nginx -t failed; restoring previous config." >&2
    if [[ -n "${BACKUP:-}" && -f "$BACKUP" ]]; then cp "$BACKUP" "$SITE_CONF"; fi
    nginx -t && systemctl reload nginx
    exit 1
  fi
  systemctl reload nginx
}

echo "[2/5] Backing up current site config"
BACKUP=""
if [[ -f "$SITE_CONF" ]]; then
  BACKUP="$SITE_CONF.backup-$(date +%Y%m%d-%H%M%S)"
  cp "$SITE_CONF" "$BACKUP"
  echo "  saved $BACKUP"
fi

echo "[3/5] Looking for an existing certificate"
CERT_DIR="$(find_cert_dir || true)"

if [[ -z "$CERT_DIR" ]]; then
  echo "  none found; installing HTTP-only config"
  render_config escaperoomreviews.ca.http.conf
  apply_config
  if [[ "${ISSUE_CERT:-0}" == "1" ]]; then
    echo "[4/5] Requesting certificate (DNS must already point here)"
    certbot certonly --webroot -w "$SITE_ROOT/site" -d "${DOMAINS[0]}" -d "${DOMAINS[1]}" \
      --non-interactive --agree-tos --email "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL}" --keep-until-expiring
    CERT_DIR="$(find_cert_dir)"
  else
    echo "[4/5] Skipping certificate (re-run with ISSUE_CERT=1 after DNS points here)"
  fi
fi

if [[ -n "$CERT_DIR" ]]; then
  echo "[5/5] Installing HTTPS config using $CERT_DIR"
  render_config escaperoomreviews.ca.https.conf "$CERT_DIR"
  apply_config
  # Renewals use the webroot so they keep working with this static config.
  RENEWAL="/etc/letsencrypt/renewal/$(basename "$CERT_DIR").conf"
  if [[ -f "$RENEWAL" ]] && grep -q "authenticator = nginx" "$RENEWAL"; then
    echo "  note: $RENEWAL uses the nginx authenticator, which also covers other domains; leaving it unchanged."
  fi
else
  echo "[5/5] Serving over HTTP only for now."
fi

echo
echo "Done. Site root: $SITE_ROOT/site"
echo "Test from the LAN:  curl -I -H 'Host: www.escaperoomreviews.ca' http://$(hostname -I | awk '{print $1}')/"
