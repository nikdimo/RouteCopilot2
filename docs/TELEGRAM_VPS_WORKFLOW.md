# Editing Code on the VPS via Telegram

This doc describes how we plan to work on the repo from the VPS using the Telegram bot, and how secrets are stored.

---

## How we edit code on the VPS via Telegram

- **Bot location:** The Telegram bot lives in `telegram-bot/` in this repo. On the VPS we clone the same repo and run the bot from there (`cd telegram-bot && npm start`). The bot’s working directory is the **repo root**, so all tools (git, EAS, shell) run in the project that contains `app.json`, `eas.json`, and the app source.

- **What the bot can do:** You send a natural-language message to the bot in Telegram (e.g. “git status”, “commit and push with message: fix map”, “bump iOS build and start EAS iOS build”, “submit latest to TestFlight”). The bot uses an LLM (default: Gemini) to choose which tools to call, then runs them on the VPS and replies with the outcome. So from your phone you can trigger git operations, EAS builds, and TestFlight submits without sitting at the PC.

- **Editing code:** The bot does **not** edit source code by itself. It runs **shell commands**, **git**, and **EAS**. To “edit code on the VPS via Telegram” we rely on: (1) **git** – you can ask the bot to pull, commit, and push (e.g. after you edit in GitHub’s web UI or another machine and push); (2) **run_shell** – you can ask it to run a specific command (e.g. `npm run prepare:vps` or a one-liner). For actual file edits from Telegram, you’d have to describe the change in a message and have the LLM run a shell command that applies it (e.g. `sed` or a small script), or edit in GitHub and then “pull and build” via the bot. So the intended workflow is: **trigger builds, git pull/commit/push, and run scripts from Telegram**; heavier code edits are done locally or on GitHub, then the bot helps you build and publish from the VPS.

- **Flow when away:** You’re away from your PC. On the VPS the bot is running. You open Telegram, send e.g. “Pull latest and run prepare:vps” or “Bump iOS build, run EAS iOS production build, then submit to TestFlight”. The bot runs the right tools and reports back. So the VPS becomes the place where builds and deploys happen when you’re not at your desk.

- **iOS build on the server:** When you ask the bot to “bump iOS build and start EAS iOS production build”, it runs: (1) bump build number, (2) `eas build --platform ios --profile production --non-interactive --no-wait`. The build runs in Expo’s cloud; the bot returns immediately with the build URL. It then asks you: when the build is done, do you want to submit to TestFlight or do anything else (e.g. Apple login)? You can reply “Submit to TestFlight” when the build has finished. On the VPS you do **not** need to log in with Apple ID: EAS uses the credentials already stored for the project (from when you ran the build or `eas credentials` on your PC). The VPS only needs to be logged in to EAS (`eas login` once or `EXPO_TOKEN` in the environment).

---

## How secrets are stored

- **Bot and LLM:** All secrets for the Telegram bot and the LLM are in a **`.env`** file in `telegram-bot/`. That file is **not** committed (it’s in `.gitignore`). On the VPS you create `telegram-bot/.env` once and keep it only on the server.

  - **TELEGRAM_BOT_TOKEN** – From [@BotFather](https://t.me/BotFather). Required for the bot to receive your messages.
  - **TELEGRAM_ALLOWED_CHAT_IDS** – Optional; comma-separated Telegram chat IDs. If set, only those chats can use the bot (so only you).
  - **LLM_PROVIDER** – `gemini` | `openai` | `anthropic`. Only one is used.
  - **GEMINI_API_KEY** | **OPENAI_API_KEY** | **ANTHROPIC_API_KEY** – The key for the chosen provider. Only the one matching `LLM_PROVIDER` is needed.

  No API keys or the Telegram token are ever in the repo; they exist only in `telegram-bot/.env` on the machine where the bot runs (e.g. the VPS).

- **Git (GitHub):** On the VPS, git needs to push/pull. That’s done with either:
  - An **SSH key** (e.g. `~/.ssh/id_ed25519`) that’s added to the GitHub account (no secret in the repo), or
  - A **GitHub personal access token** used as HTTPS password (again, not in the repo; you set it once on the VPS, e.g. in `git config credential.helper` or an env var used by your workflow).

  So GitHub credentials are stored only on the VPS (SSH key or token), not in the codebase.

- **EAS / Expo / Apple:** For `eas build` and `eas submit` to work on the VPS:
  - **Expo:** You run `eas login` once on the VPS (or set **EXPO_TOKEN** in the environment). That token is stored by the EAS CLI (e.g. in `~/.eas.json` or env), not in the repo.
  - **Apple (TestFlight):** Apple ID and app-specific password are configured in EAS (e.g. `eas credentials` or in `eas.json` with `appleId` / `ascAppId`; the password can be in env **EXPO_APPLE_APP_SPECIFIC_PASSWORD**). Those values stay on the VPS (env or EAS-stored credentials), not in the repo.

So in short: **secrets are stored only on the VPS** (and in EAS/Expo’s own storage where applicable): `.env` for the bot and LLM, SSH key or GitHub token for git, and EAS/Apple credentials for builds and TestFlight. Nothing secret is committed to the repo.

---

## VPS bot checklist (is everything good?)

Run these on the VPS (SSH) when the bot misbehaves or to verify setup.

1. **Bot process:** `pm2 list` — wiseplan-bot should be **online**. If not: `pm2 start ~/RouteCopilot2/telegram-bot/dist/index.js --name wiseplan-bot`
2. **Recent logs:** `pm2 logs wiseplan-bot --lines 80` — look for missing token, LLM 429/503, or tool errors.
3. **Env vars:** `cd ~/RouteCopilot2/telegram-bot && node -e "require('dotenv').config(); console.log('TOKEN:', !!process.env.TELEGRAM_BOT_TOKEN); console.log('LLM:', !!process.env.GEMINI_API_KEY || !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY); console.log('APPLE:', !!process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD);"` — all should be true.
4. **Repo:** `cd ~/RouteCopilot2 && git status -sb` — confirms repo and branch state.
5. **Gemini 429/503:** Free tier often hits limits. In `telegram-bot/.env` set `LLM_PROVIDER=openai` (or `anthropic`) and the matching API key, then `pm2 restart wiseplan-bot`.
