# Step-by-Step: Run WisePlan + eurbanizam-tracker on Same VPS

This guide restores access to both projects:
- **wiseplan.dk** → WisePlan (new project)
- **207.180.222.248** (raw IP) → eurbanizam-tracker Admin (Streamlit app)

---

## What You Have

| Project | Type | Access |
|---------|------|--------|
| **WisePlan** | Static web app (Expo export) | Domain: wiseplan.dk |
| **eurbanizam-tracker** | Streamlit app (port 8501) + Telegram bot | IP: 207.180.222.248 |

eurbanizam has:
- Admin UI (Streamlit on port 8501) – accessed via IP with HTTP Basic Auth
- Telegram bot (eurbanizam-bot.service) – runs in background
- Daily scraper/report (eurbanizam-daily.service)

---

## Step 1: SSH Into Your VPS

On your PC (PowerShell):

```powershell
ssh -i "%USERPROFILE%\.ssh\contabo_nikola" nikola@207.180.222.248
```

Or use `connect_vps.bat` from the eurbanizam project folder.

---

## Step 2: Check eurbanizam Services Are Running

```bash
sudo systemctl status eurbanizam-admin
sudo systemctl status eurbanizam-bot
```

- If **eurbanizam-admin** is inactive, start it: `sudo systemctl start eurbanizam-admin`
- If services don't exist, the eurbanizam project may not be fully deployed on this VPS. Tell me and we'll adjust.

---

## Step 3: Create Self-Signed Cert for IP (Fixes Chrome Forcing HTTPS)

When Chrome upgrades `http://207.180.222.248` to `https://`, nginx needs an HTTPS block that redirects back to HTTP. Run once on the VPS:

```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/ip-selfsigned.key \
  -out /etc/nginx/ssl/ip-selfsigned.crt \
  -subj "/CN=207.180.222.248"
```

---

## Step 4: Ensure Basic Auth File Exists

eurbanizam Admin requires a username/password. Create the htpasswd file if it doesn't exist:

```bash
# Install htpasswd tool if needed
sudo apt install -y apache2-utils

# Create password file (replace 'eurbanizam' with your desired username)
# Use -c only the first time; if file exists, omit -c to add/update users
sudo htpasswd -c /etc/nginx/.htpasswd_eurbanizam eurbanizam
```

Enter a password when prompted. You'll use this to log in when visiting the IP.  
If `/etc/nginx/.htpasswd_eurbanizam` already exists from before, use `sudo htpasswd /etc/nginx/.htpasswd_eurbanizam eurbanizam` (without `-c`).

---

## Step 5: Backup Current Nginx Config

```bash
sudo cp /etc/nginx/sites-available/wiseplan /etc/nginx/sites-available/wiseplan.backup.$(date +%Y%m%d)
```

If you had a separate eurbanizam config:
```bash
sudo ls /etc/nginx/sites-enabled/
# If you see eurbanizam, we'll replace it with our combined config
```

---

## Step 6: Copy New Nginx Config to VPS

**On your PC** – from the RouteCopilot2 folder:

```powershell
cd "c:\Users\Nikola Dimovski\RouteCopilot2"
scp -i "$env:USERPROFILE\.ssh\contabo_nikola" vps-landing\nginx-multi-project.conf nikola@207.180.222.248:~/
```

---

## Step 7: Apply New Config on VPS

**On the VPS**:

```bash
# Replace wiseplan config with the new combined config
sudo cp ~/nginx-multi-project.conf /etc/nginx/sites-available/wiseplan

# Remove old eurbanizam site link if it exists (we now have both in one file)
sudo rm -f /etc/nginx/sites-enabled/eurbanizam

# Ensure wiseplan is enabled
sudo ln -sf /etc/nginx/sites-available/wiseplan /etc/nginx/sites-enabled/wiseplan

# Remove default site if it conflicts
sudo rm -f /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t
```

If you see `syntax is ok` and `test is successful`:

```bash
sudo systemctl reload nginx
```

---

## Step 8: Add SSL for wiseplan.dk (If Not Already Done)

If wiseplan.dk should use HTTPS, run:

```bash
sudo certbot --nginx -d wiseplan.dk -d www.wiseplan.dk
```

Certbot will add SSL blocks for the domain. The IP (eurbanizam) stays HTTP.

---

## Step 9: Test

1. **WisePlan (domain):**  
   Open https://wiseplan.dk – should show WisePlan landing page.

2. **eurbanizam (IP):**  
   Open http://207.180.222.248 – should ask for username/password, then show the Admin UI.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Both show WisePlan | Ensure `default_server` is on the eurbanizam block. Check: `sudo nginx -t` and `sudo cat /etc/nginx/sites-available/wiseplan`. |
| 502 Bad Gateway on IP | eurbanizam-admin not running: `sudo systemctl start eurbanizam-admin` |
| Daily sync not running | `eurbanizam-daily.timer` may be inactive: `sudo systemctl status eurbanizam-daily.timer` and `sudo systemctl enable --now eurbanizam-daily.timer` |
| 403 or auth loop | htpasswd missing: run Step 4. Wrong path: use `/etc/nginx/.htpasswd_eurbanizam` (not `.htpasswd`). Wrong password: `sudo htpasswd /etc/nginx/.htpasswd_eurbanizam eurbanizam` to reset. |
| nginx -t fails | Config syntax error. Share the error message. |
| wiseplan.dk redirect loop | Cloudflare SSL = Full (not Flexible). See `docs/WORKING_CONFIG.md`. |
| Chrome main profile shows WisePlan instead of eurbanizam on IP | Chrome forces HTTPS; without an HTTPS block for the IP, nginx serves WisePlan. Ensure Step 3 (self-signed cert) and Block 3 in the nginx config are applied. |

---

## Summary

- One nginx config file serves both projects.
- **wiseplan.dk** → static files in `/var/www/wiseplan-test`
- **207.180.222.248** → proxy to Streamlit at `127.0.0.1:8501`
- eurbanizam-admin.service must be running for the IP to work.
