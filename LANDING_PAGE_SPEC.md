# WisePlan – Landing Page Specification

**Domain:** wiseplan.dk  
**Purpose:** Convert visitors into users; explain product, benefits, and offer try-before-you-buy.

---

## 1. Overview

### Goal
A single-page landing that:
- Explains WisePlan clearly to field reps and logistics teams
- Highlights benefits (save time, reduce travel, fewer missed visits)
- Lets visitors **try the app instantly** (web playground)
- Drives installs via App Store and Play Store links

### Tone
Professional, confident, minimal. No hype. Clear value.

---

## 2. Sections (Top to Bottom)

### 2.1 Hero
- **Headline:** WisePlan — Your AI Logistics Assistant  
- **Subheadline:** See your Outlook calendar on a map. Find the best times for new visits. Mark them done.
- **Primary CTAs:** Two buttons side by side (or stacked on mobile):
  - [App Store badge] — Get on iPhone
  - [Google Play badge] — Get on Android
- **Secondary CTA:** [Try it in browser →] — Links to /app/ (test playground)
- **Visual:** Clean gradient or subtle illustration; optional mockup of phone showing map/schedule. No clutter.

### 2.2 Product – What It Does
**Title:** One place for your visits and routes

- **3 feature cards** (icon + title + 1 short line):
  1. **Map view** – Your day on a map. Numbered pins, directions, done at a glance.
  2. **Smart scheduling** – Best meeting times based on your calendar and travel.
  3. **Outlook sync** – Calendar and contacts in one place. Changes sync automatically.

- Each card: icon (simple line/SVG), title, one sentence.

### 2.3 Benefits – Why It Matters
**Title:** Built for people on the move

- **Bullet list** (with small icons):
  - Less back-and-forth – See your route before you start
  - Fewer missed visits – Schedule times that fit your day
  - One sign-in – Microsoft account, no new passwords
  - Works offline – Completed visits saved on your device

### 2.4 Test Playground
**Title:** Try it now — no download

- **Description:** Sign in with Microsoft and use WisePlan in your browser. Same features as the app.
- **CTA:** [Open WisePlan in browser →]
- **Visual:** Optional screenshot or iframe preview of the web app (e.g. login screen). Or a simple card with the CTA.
- **Link:** `/app/` (or full `https://wiseplan.dk/app/`)

### 2.5 Final CTA
- **Headline:** Ready for your routes?
- **Buttons:** App Store | Google Play (same badges as hero)
- **Footer:** © WisePlan · [Privacy](#) · [Terms](#) · Contact

---

## 3. Design Guidelines

### 3.1 Visual Style
- **Background:** Dark theme preferred (like current) — #0f172a or similar. Or light: #f8fafc with dark text.
- **Accent:** Blue (#3b82f6) for primary buttons and links.
- **Font:** Clean sans-serif — DM Sans, Inter, or Geist.
- **Spacing:** Generous padding; sections clearly separated.
- **Shadows / borders:** Subtle. Avoid heavy gradients.

### 3.2 Responsive
- **Desktop:** Hero with side-by-side buttons; 3-column feature grid.
- **Tablet:** 2-column grid; stacked hero buttons.
- **Mobile:** Single column; full-width buttons; tap-friendly targets (min 44px).

### 3.3 Store Badges
- Use official App Store and Google Play badge images.
- Host locally in `vps-landing/assets/` or use CDN:
  - App Store: https://developer.apple.com/app-store/marketing/guidelines/#images
  - Google Play: https://play.google.com/intl/en_us/badges/

---

## 4. Copy Reference

### Headlines
| Section   | Headline                                   |
|-----------|---------------------------------------------|
| Hero      | WisePlan — Your AI Logistics Assistant     |
| Product   | One place for your visits and routes       |
| Benefits  | Built for people on the move               |
| Playground| Try it now — no download                   |
| Final CTA | Ready for your routes?                     |

### Taglines
- Hero: *See your Outlook calendar on a map. Find the best times for new visits. Mark them done.*
- Playground: *Sign in with Microsoft and use WisePlan in your browser. Same features as the app.*

---

## 5. Test Playground Behavior

### Option A (Recommended)
- Prominent button: **Open WisePlan in browser**
- Links to `https://wiseplan.dk/app/`
- User signs in with Microsoft and uses the full web app.
- No iframe — full-page experience.

### Option B (With Preview)
- Small card or screenshot of the app (login or map).
- CTA below: **Try it now →** linking to /app/.

---

## 6. Technical Requirements

- **Static HTML/CSS** (or minimal JS for smooth scroll / animations).
- **Deployment:** Same as current — files in `vps-landing/`, served by nginx at `/`.
- **Paths:**
  - `/` → landing page
  - `/app/` → web app
- **Store links:** Placeholder `#` until real URLs exist; replace with:
  - iOS: TestFlight link, then App Store link
  - Android: Play Console internal-test link, then production link

---

## 7. Assets Needed

| Asset        | Purpose                         | Notes                                      |
|-------------|----------------------------------|--------------------------------------------|
| App icon    | Favicon, OG image               | Use existing from app                      |
| App Store badge | Hero, final CTA             | Download from Apple                         |
| Google Play badge | Hero, final CTA           | Download from Google                        |
| Phone mockup (optional) | Hero illustration    | Phone showing map/schedule                   |
| Icons       | Features, benefits              | Simple SVG or Lucide/Feather-style icons    |

---

## 8. SEO & Meta

```html
<title>WisePlan – Your AI Logistics Assistant</title>
<meta name="description" content="See your Outlook calendar on a map. Find best meeting times. Built for field reps and mobile workers.">
<meta property="og:title" content="WisePlan – Your AI Logistics Assistant">
<meta property="og:description" content="See your Outlook calendar on a map. Find best meeting times. Built for field reps.">
<meta property="og:url" content="https://wiseplan.dk/">
<meta property="og:type" content="website">
```

---

## 9. Accessibility

- Semantic HTML (`header`, `main`, `section`, `nav`).
- Alt text for images.
- Sufficient color contrast (WCAG AA).
- Focus states for keyboard users.
- Clear, descriptive link text (e.g. “Open WisePlan in browser” instead of “Click here”).

---

## 10. Implementation Checklist

- [ ] Create `vps-landing/index.html` with all sections
- [ ] Add CSS (variables, responsive breakpoints)
- [ ] Add App Store and Google Play badge images
- [ ] Wire store links (placeholders or real URLs)
- [ ] Wire “Try it” / “Open in browser” to `/app/`
- [ ] Add meta tags for SEO and OG
- [ ] Test on mobile, tablet, desktop
- [x] Create `vps-landing/index.html` with all sections
- [x] Add CSS (variables, responsive breakpoints)
- [x] Add store link placeholders (edit `STORE` in script when URLs ready)
- [ ] Wire store links (replace `#` in `STORE.ios` and `STORE.android`)
- [x] Wire "Try it" / "Open in browser" to `/app/`
- [x] Add meta tags for SEO and OG
- [ ] Deploy via `./setup-vps.sh`
