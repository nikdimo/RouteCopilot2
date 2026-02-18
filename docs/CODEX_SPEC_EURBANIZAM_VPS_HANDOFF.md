# Codex Specification: eurbanizam-tracker VPS Multi-Project Setup

**Purpose:** This document is a handoff spec for Codex when working on the eurbanizam-tracker project. It explains the VPS setup, what changed when WisePlan was deployed, and what (if any) modifications the eurbanizam project needs to support both projects on the same server.

---

## 1. Context: Two Projects on One VPS

The VPS at **207.180.222.248** (Contabo) hosts two separate applications:

| Project | Type | Access | Purpose |
|---------|------|--------|---------|
| **WisePlan** (RouteCopilot2) | Expo/React web app (static export) | `https://wiseplan.dk` | Outlook calendar, route planning, field logistics |
| **eurbanizam-tracker** | Streamlit Admin + Telegram bot + scrapers | `http://207.180.222.248` | e-Urbanizam case tracking, Admin UI, bot, daily sync |

**Problem that occurred:** When WisePlan was deployed, its nginx config became the default. Requests to the raw IP (207.180.222.248) started serving WisePlan instead of eurbanizam. Users who bookmarked the IP lost access to the eurbanizam Admin UI.

**Solution implemented:** A combined nginx config that routes by host:
- `wiseplan.dk` / `www.wiseplan.dk` → WisePlan (static files in `/var/www/wiseplan-test`)
- `207.180.222.248` → eurbanizam Admin (proxy to Streamlit on `127.0.0.1:8501`)

---

## 2. Current eurbanizam-tracker VPS Setup (As Originally Built)

From the eurbanizam project docs (RECAP, HELP):

### Paths on VPS
- **Repo:** `/home/nikola/eurbanizam-tracker`
- **Runtime:** `/home/nikola/.eurbanizam` (db, json, logs, snapshots, secrets)
- **Secrets:** `/home/nikola/.eurbanizam/secrets/.eurbanizam_secrets.env` (chmod 600)

### Services (systemd)
- `eurbanizam-admin.service` – Streamlit Admin UI, binds to `127.0.0.1:8501`
- `eurbanizam-bot.service` – Telegram bot
- `eurbanizam-daily.service` – Daily Smart Sync + Report (timer: `eurbanizam-daily.timer`)

### Nginx (Before WisePlan)
- Config: `/etc/nginx/sites-available/eurbanizam`
- Symlink: `/etc/nginx/sites-enabled/eurbanizam`
- Default site removed so eurbanizam caught all requests (including IP)
- **Proxy:** nginx proxied public HTTP to `127.0.0.1:8501` (Streamlit)
- **Auth:** HTTP Basic Auth via `/etc/nginx/.htpasswd_eurbanizam`

### SSH Access
- Key: `~/.ssh/contabo_nikola` (or `%USERPROFILE%\.ssh\contabo_nikola` on Windows)
- Host: `nikola@207.180.222.248`
- Bat files: `connect_vps.bat` (SSH), `connect_vps_tunnel.bat` (tunnel for localhost:8501)

---

## 3. What Was Done in WisePlan (RouteCopilot2) Project

### Files created
1. **`vps-landing/nginx-multi-project.conf`** – Single nginx config with two `server` blocks:
   - Block 1: `wiseplan.dk` → static root `/var/www/wiseplan-test`
   - Block 2: `207.180.222.248` (default_server) → `proxy_pass http://127.0.0.1:8501` with Basic Auth

2. **`docs/MULTI_PROJECT_VPS_SETUP.md`** – Step-by-step deploy guide for the combined setup

3. **`docs/CODEX_SPEC_EURBANIZAM_VPS_HANDOFF.md`** – This spec for Codex

### Deploy workflow
- Combined config is deployed as `/etc/nginx/sites-available/wiseplan`
- Old `/etc/nginx/sites-enabled/eurbanizam` symlink is removed (both projects now in one file)
- `wiseplan` config is the only enabled site (contains both blocks)
- **Note:** If both `eurbanizam` and `wiseplan` nginx configs are enabled, you may see `conflicting server name "_"` warning. Disable the standalone eurbanizam site when using the combined config.

---

## 4. What eurbanizam-tracker May Need (If Anything)

The eurbanizam project **does not need code changes** for the multi-project setup to work. The nginx config lives in the WisePlan repo and is applied from there. The eurbanizam services (`eurbanizam-admin`, `eurbanizam-bot`, `eurbanizam-daily`) continue to run as before; only nginx routing changed.

### Optional improvements (Codex can implement if useful)

#### A. Update eurbanizam docs to reflect multi-project setup
- **File:** `docs/HELP.md` (VPS section) and/or `docs/RECAP.md`
- **Change:** Note that the VPS now hosts two projects. Nginx config is managed from the WisePlan repo (`RouteCopilot2/vps-landing/nginx-multi-project.conf`). eurbanizam is accessed via IP only; WisePlan via domain.
- **Benefit:** Future you (or Codex) won’t wonder why there’s no `/etc/nginx/sites-available/eurbanizam` or why the config differs.

#### B. Add reference nginx config to eurbanizam repo (optional)
- **Purpose:** Documentation only; the active config lives in WisePlan.
- **Action:** Add `vps-landing/nginx-eurbanizam-block.conf` (or similar) containing just the eurbanizam `server` block, with a comment: “This block is merged into the combined config in RouteCopilot2. Do not deploy this file alone.”
- **Benefit:** eurbanizam repo has a local reference for its nginx block in case WisePlan is reorganized.

#### C. One-shot setup / deploy script
- If eurbanizam has a `setup-vps.sh` or similar, ensure it does **not** overwrite or reinstall nginx config in a way that breaks the combined setup. It should either:
  - Skip nginx config entirely (config is managed from WisePlan), or
  - Document that nginx is shared and point to the WisePlan repo for the combined config.

#### D. Basic Auth credentials
- The htpasswd file `/etc/nginx/.htpasswd_eurbanizam` is used for eurbanizam. If eurbanizam docs mention creating `.htpasswd`, update to `.htpasswd_eurbanizam`. No change needed unless you want separate credentials per project (not typical).

---

## 5. Exact nginx Blocks for eurbanizam (Reference)

The combined config in `vps-landing/nginx-multi-project.conf` has three blocks:
- **Block 1:** wiseplan.dk → static files
- **Block 2:** `207.180.222.248` over HTTP → proxy to Streamlit
- **Block 3:** `207.180.222.248` over HTTPS → proxy to Streamlit (fixes Chrome forcing HTTPS; uses self-signed cert)

For Codex reference, these are the eurbanizam blocks (Block 2 + Block 3):

**Block 2 (HTTP):**
```nginx
# --- eurbanizam-tracker (IP address) — Streamlit Admin ---
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 207.180.222.248;

    auth_basic "eurbanizam Admin";
    auth_basic_user_file /etc/nginx/.htpasswd_eurbanizam;

    location / {
        proxy_pass http://127.0.0.1:8501;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

**Block 3 (HTTPS for IP – Chrome forcing HTTPS):** Same auth and proxy, but `listen 443 ssl`, uses `/etc/nginx/ssl/ip-selfsigned.crt` and `ip-selfsigned.key`. See `nginx-multi-project.conf` for full block.

- `default_server` ensures Block 2 handles HTTP requests to the raw IP when no other `server_name` matches.
- No `_` in `server_name` (avoids conflicts if both wiseplan and eurbanizam configs are enabled).
- **Important:** The VPS uses `/etc/nginx/.htpasswd_eurbanizam`, not `.htpasswd`.
- WebSocket headers (`Upgrade`, `Connection`) are required for Streamlit.
- Basic Auth is required for the Admin UI.

---

## 6. What Codex Should Do (Summary)

1. **No required code changes** – eurbanizam works as-is with the new nginx setup.
2. **Optional:** Update `docs/HELP.md` (and/or `docs/RECAP.md`) with a short VPS multi-project section (Section 4A above).
3. **Optional:** Add a reference nginx block file (Section 4B) for documentation.
4. **Check:** If eurbanizam has deploy/setup scripts that touch nginx, ensure they don’t overwrite the combined config (Section 4C).
5. **Do not:** Create or deploy a standalone eurbanizam nginx config that would conflict with the combined config in WisePlan.

---

## 7. Prompt for Codex (Copy-Paste)

### Option A: Full context (paste the entire doc)
Copy the full content of this file into Codex when you start a session on eurbanizam-tracker. Then add:

```
I'm working on eurbanizam-tracker. The VPS now hosts two projects (eurbanizam + WisePlan). Please:
1. Review any nginx/deploy scripts for conflicts with the combined config.
2. Update HELP.md and RECAP.md with a multi-project VPS section.
3. Optionally add a reference nginx block file (docs only).
4. Do not create a standalone nginx config that overwrites the combined setup.
```

### Option B: Short prompt (if Codex has project context)
```
The eurbanizam-tracker VPS (207.180.222.248) now runs two projects. WisePlan (wiseplan.dk) was added and replaced eurbanizam on the IP. A combined nginx config was created in the RouteCopilot2 repo: wiseplan.dk → static WisePlan; 207.180.222.248 → proxy to eurbanizam Streamlit on 8501. eurbanizam-admin, eurbanizam-bot, eurbanizam-daily services are unchanged. Nginx config is at RouteCopilot2/vps-landing/nginx-multi-project.conf and deployed as /etc/nginx/sites-available/wiseplan.

Tasks: (1) Update eurbanizam docs (HELP.md, RECAP.md) to document this multi-project setup. (2) Check deploy/setup scripts – they must not overwrite nginx with a standalone eurbanizam config. (3) Optionally add a reference nginx block file (documentation only) in this repo. No code changes required for eurbanizam to work; only documentation and script hygiene.
```

---

## 8. File Locations Summary

| Item | Location |
|------|----------|
| Combined nginx config (source of truth) | `RouteCopilot2/vps-landing/nginx-multi-project.conf` |
| Deploy guide | `RouteCopilot2/docs/MULTI_PROJECT_VPS_SETUP.md` |
| Active nginx config on VPS | `/etc/nginx/sites-available/wiseplan` |
| eurbanizam services | `eurbanizam-admin.service`, `eurbanizam-bot.service`, `eurbanizam-daily.service` |
| eurbanizam runtime | `/home/nikola/.eurbanizam` |
| Basic Auth | `/etc/nginx/.htpasswd_eurbanizam` |
