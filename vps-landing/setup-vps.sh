#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="/var/www/wiseplan-test"
NGINX_SITES="/etc/nginx/sites-available"

echo "=== WisePlan VPS Setup ==="
if ! command -v nginx &> /dev/null; then
    sudo apt-get update && sudo apt-get install -y nginx
fi

sudo mkdir -p "$TARGET" "$TARGET/app"
sudo cp "$SCRIPT_DIR/index.html" "$TARGET/"
[ -d "$SCRIPT_DIR/app" ] && sudo cp -r "$SCRIPT_DIR/app"/* "$TARGET/app/"
sudo chown -R www-data:www-data "$TARGET"

NGINX_CONF="$NGINX_SITES/wiseplan-test"
sudo cp "$SCRIPT_DIR/nginx-wiseplan.conf" "$NGINX_CONF"
sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/wiseplan-test 2>/dev/null || true
sudo nginx -t && sudo systemctl reload nginx
echo "Done. Access: http://YOUR_VPS_IP/ and http://YOUR_VPS_IP/app/"
