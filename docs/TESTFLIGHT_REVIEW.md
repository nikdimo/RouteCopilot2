# TestFlight / App Review – Sign-in Instructions

Apple reviewers sign in via **Microsoft OAuth**: they tap "Sign in with Microsoft", then enter the demo credentials **on the Microsoft sign-in page** (not in the app). If that isn’t clear, reviews get rejected for "unable to sign in".

## 1. Demo account (Microsoft)

- Use a **dedicated demo account** (e.g. `wise.plan@outlook.com`).
- **Turn off MFA** for this account (Microsoft 365 / Security / sign-in options, or account.microsoft.com).
- Use a **simple password** for review: avoid `&`, `$`, `%`, `^` etc. so copy-paste from App Store Connect doesn’t break it (e.g. `DemoWisePlan2026!`).
- Test yourself: sign out in the app, then sign in again with that email/password on the Microsoft page.

## 2. App Store Connect – Beta App Review Information

- **TestFlight** → your app → **Test Information** → **Beta App Review Information**.
- Check **"Sign-in required"**.
- **User name:** demo account email (e.g. `wise.plan@outlook.com`).
- **Password:** the demo account password.
- **Notes** (important – paste something like this):

```
Sign-in uses Microsoft. Please:
1. Tap "Sign in with Microsoft" in the app.
2. When the Microsoft sign-in page opens (in-app browser or Safari), enter the User name and Password above.
3. Complete any one-time Microsoft prompts (e.g. "Stay signed in?" – choose Yes).
4. You will then be returned to the app with your calendar loaded.

If the Microsoft page does not open, check that the device has internet and try again.
```

- Save.

## 3. Reply to Apple’s rejection (Resolution Center)

In App Store Connect, open the rejection message and reply with the same instructions, for example:

```
Our app uses Microsoft sign-in. The demo credentials are used on the Microsoft sign-in page, not in the app itself.

Please tap "Sign in with Microsoft" in the app. When the Microsoft page opens, enter the email and password from the Beta App Review Information. We have disabled MFA for the demo account and use a password that is easy to copy. If you still cannot sign in, please tell us the exact message or screen you see so we can fix it.
```

## 4. In the app

The login screen now shows a short note: *"Sign in with Microsoft: tap the button below, then on the Microsoft sign-in page enter the demo account email and password from App Store Connect."* so reviewers know where to enter the credentials.

## 5. Why not email/password in the app?

WisePlan uses **Microsoft 365 / Outlook** for calendar and contacts. Sign-in is done via **OAuth** (Microsoft’s login page). The app never sees or stores your Microsoft password. Adding a separate email/password form would require either:

- **Resource Owner Password (ROPC)** – Microsoft discourages it, often disabled for personal/Outlook accounts and doesn’t work with MFA, or  
- A custom backend storing passwords – which we do not want.

So the correct approach is: **one demo account, no MFA, simple password, clear instructions** so reviewers enter the credentials on the **Microsoft** page after tapping "Sign in with Microsoft".
