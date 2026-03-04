#!/usr/bin/env bash
# Deploy built app + landing + nginx config to a new VPS (no repo on server).
# Usage: from repo root, run:
#   ./vps-landing/deploy-to-new-vps.sh USER@NEW_VPS_IP [/var/www/wiseplan]
# Requires: rsync, npm. Run from Git Bash, WSL, or Linux.

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

DEST="${1:?Usage: $0 USER@NEW_VPS_IP [/var/www/wiseplan]}"
REMOTE_PATH="${2:-/var/www/wiseplan}"

echo "Building web app..."
npm run prepare:vps

DEPLOY_DIR="$(cd "$REPO_ROOT/../wiseplan-release" && pwd)"
echo "Deploying $DEPLOY_DIR/ to $DEST:$REMOTE_PATH"
rsync -avz --delete "$DEPLOY_DIR/" "$DEST:$REMOTE_PATH/"

echo "Done. On the VPS run:"
echo "  sudo cp $REMOTE_PATH/nginx-wiseplan-domain.conf /etc/nginx/sites-available/wiseplan"
echo "  sudo sed -i 's|/var/www/wiseplan-test|$REMOTE_PATH|g' /etc/nginx/sites-available/wiseplan"
echo "  sudo ln -sf /etc/nginx/sites-available/wiseplan /etc/nginx/sites-enabled/"
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo "Then point DNS to this server and run certbot if using HTTPS."
echo
echo "Backend deploy/migrate is separate from static deploy."
echo "Recommended backend steps on VPS:"
echo "  1) Snapshot DB before migrations."
echo "  2) Deploy backend source/build and env."
echo "  3) Run: npm ci && npm run build && npm run migrate"
echo "  4) Restart backend service (pm2/systemd) and verify /healthz + /api/health"
