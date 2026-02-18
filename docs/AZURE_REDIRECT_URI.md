# Azure AD Redirect URI Setup (Fix login.live.com error)

If you see: **"The provided value for the input parameter 'redirect_uri' is not valid"**, add the redirect URIs in Azure AD.

## Steps

1. Go to [Azure Portal](https://portal.azure.com) → **Azure Active Directory** → **App registrations**
2. Open your app: **WisePlan** (client ID: `b0ca13d2-db5d-4fb6-b1e8-5e89bc631c86`)
3. Go to **Authentication**
4. Under **Platform configurations**, click **Add a platform**
5. Choose **Mobile and desktop applications**
6. Add these **Redirect URIs**:

   | URI | Used for |
   |-----|----------|
   | `wiseplan://auth` | iOS/Android (TestFlight, production) |
   | `exp://localhost:8081` | Expo Go (when dev server on same machine) |
   | `exp://192.168.x.x:8081` | Expo Go (replace `x.x` with your computer’s LAN IP) |
   | `https://wiseplan.dk/app/` | Web (wiseplan.dk) |
   | `http://localhost:8081/app/` | Web (local dev) |

7. Click **Configure**

## Expo Go (development)

When testing in **Expo Go**, the app uses `makeRedirectUri()` which returns `exp://<your-ip>:8081` (varies with your network). In dev mode, the Login screen shows the exact URI to add—copy it and add it to Azure. The URI changes when you switch networks (e.g. home vs office), so you may need to add multiple or update when you move.

## Cloudflare (SSL mode)

If you changed Cloudflare from **Flexible** to **Full (Strict)**:
- **Full** requires your origin server to have a valid HTTPS certificate. If the origin only had HTTP or a self-signed cert, redirects (e.g. from Microsoft back to wiseplan.dk) can fail. Ensure the origin serves valid HTTPS before using Full.
- **Flexible** (CF→origin over HTTP) can work but is less secure. Use Full when your origin is correctly configured for HTTPS.

## Important

- URIs must match **exactly** (no trailing slash mismatch unless you add both)
- For web, if you use `https://wiseplan.dk/app/`, ensure there is no redirect to `https://wiseplan.dk/app` (without trailing slash) – add both if needed
- After saving, wait 1–2 minutes for changes to propagate
