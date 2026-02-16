# Domain & Azure Setup – wiseplan.dk

**Domain:** wiseplan.dk  
**VPS IP:** 207.180.222.248  
**VPS provider:** Contabo  

---

## 1. DNS – Point domain to VPS

At your domain registrar (where you bought wiseplan.dk):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | 207.180.222.248 | 300 |
| A | www | 207.180.222.248 | 300 |

- **@** = root (wiseplan.dk)
- **www** = www.wiseplan.dk
- **TTL** = 300 (5 min) for quick propagation; can increase later

**Check propagation:** `nslookup wiseplan.dk` – should return 207.180.222.248

---

## 2. VPS – Install Certbot & get SSL

```bash
# SSH to VPS
ssh nikola@207.180.222.248

# Install certbot (if not already)
sudo apt update
sudo apt install -y certbot python3-certbot-nginx

# Get certificate (run AFTER DNS has propagated)
sudo certbot --nginx -d wiseplan.dk -d www.wiseplan.dk
```

- Certbot will modify nginx config for HTTPS
- Renewal is automatic via systemd timer

---

## 3. Nginx – Config for wiseplan.dk

From the repo, use `vps-landing/nginx-wiseplan-domain.conf`:

```bash
cd ~/RouteCopilot2
git pull
sudo cp vps-landing/nginx-wiseplan-domain.conf /etc/nginx/sites-available/wiseplan
```

Or create manually. **File:** `/etc/nginx/sites-available/wiseplan`

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name wiseplan.dk www.wiseplan.dk;
    root /var/www/wiseplan-test;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /app/ {
        root /var/www/wiseplan-test;
        try_files $uri $uri/ /app/index.html;
    }

    location /_expo/ {
        alias /var/www/wiseplan-test/app/_expo/;
    }

    location = /favicon.ico {
        alias /var/www/wiseplan-test/app/favicon.ico;
    }
}
```

**Enable and reload:**
```bash
sudo ln -sf /etc/nginx/sites-available/wiseplan /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Then run certbot** – it will add HTTPS (listen 443, ssl certificates).

---

## 4. Azure – Redirect URIs

**Portal:** https://portal.azure.com  
**App:** Route Copilot (Client ID: b0ca13d2-db5d-4fb6-b1e8-5e89bc631c86)

**Authentication** → **Single-page application** (web) → Add these:

| Redirect URI |
|--------------|
| https://wiseplan.dk |
| https://wiseplan.dk/ |
| https://wiseplan.dk/app |
| https://wiseplan.dk/app/ |
| https://www.wiseplan.dk |
| https://www.wiseplan.dk/app |

**For mobile apps** (iOS/Android via EAS) → **Mobile and desktop applications** → Add:
| Redirect URI |
|--------------|
| wiseplan://auth |

**Save** after adding.

---

## 5. Deploy app files (if not already)

Ensure `/var/www/wiseplan-test` has:
- `index.html` (landing)
- `app/` (web build: index.html, _expo/, favicon.ico)

From repo:
```bash
cd ~/RouteCopilot2
git pull
cd vps-landing
./setup-vps.sh
```

---

## 6. Stop Cloudflare tunnel (optional)

Once domain works:
```bash
sudo systemctl stop cloudflared-tunnel
sudo systemctl disable cloudflared-tunnel
```

---

## 7. Test

- **Landing:** https://wiseplan.dk/
- **Web app:** https://wiseplan.dk/app/
- **Login:** Sign in with Microsoft – should complete without redirect_uri error

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| DNS not resolving | Wait for propagation; check registrar DNS settings |
| certbot fails | Ensure port 80 is open; nginx running; DNS points to VPS |
| Mixed content | Ensure all assets served over HTTPS |
| redirect_uri invalid | Add exact URL (with/without trailing slash) to Azure |
