#!/bin/bash
# Run this on the VPS (from RouteCopilot2 root) after git pull + setup-vps.sh

set -e
echo "=== VPS Deployment Verification ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
TARGET="/var/www/wiseplan-test"

echo ""
echo "1. Git status:"
(cd "$SCRIPT_DIR/.." && git log -1 --oneline) 2>/dev/null || echo "   (run from repo root)"

echo ""
echo "2. Web app files:"
for f in app/index.html "app/_expo/static/js/web/index-68de487172005904df100da8a645ba23.js"; do
  if [ -f "$TARGET/$f" ]; then
    echo "   [OK] $TARGET/$f"
  elif [ -f "$f" ]; then
    echo "   [OK] $f (local, run setup-vps.sh to deploy)"
  else
    echo "   [MISSING] $f"
  fi
done

echo ""
echo "3. index.html bundle reference:"
grep -o 'index-[a-f0-9]*\.js' "$TARGET/app/index.html" 2>/dev/null || grep -o 'index-[a-f0-9]*\.js' app/index.html 2>/dev/null || echo "   (could not read)"

echo ""
echo "4. Nginx:"
nginx -t 2>&1 | head -2

echo ""
echo "5. curl https://wiseplan.dk/app/:"
curl -sI https://wiseplan.dk/app/ 2>/dev/null | head -3 || echo "   (HTTPS may fail if cert not set up)"

echo ""
echo "6. Azure SPA redirect URIs must include both:"
echo "   https://wiseplan.dk/app/"
echo "   https://wiseplan.dk/app"
echo ""
echo "=== Done ==="
