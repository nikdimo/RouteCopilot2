# Editing Code on the VPS via Telegram

This doc describes how we plan to work on the repo from the VPS using the Telegram bot, and how secrets are stored.

---

## How we edit code on the VPS via Telegram

- **Bot location:** The Telegram bot lives in `telegram-bot/` in this repo. On the VPS we clone the same repo and run the bot from there (`cd telegram-bot && npm start`). The bot’s working directory is the **repo root**, so all tools (git, EAS, shell) run in the project that contains `app.json`, `eas.json`, and the app source.

- **What the bot can do:** You send a natural-language message to the bot in Telegram (e.g. “git status”, “commit and push with message: fix map”, “bump iOS build and start EAS iOS build”, “submit latest to TestFlight”). The bot uses an LLM (default: Gemini) to choose which tools to call, then runs them on the VPS and replies with the outcome. So from your phone you can trigger git operations, EAS builds, and TestFlight submits without sitting at the PC.

- **Editing code:** The bot does **not** edit source code by itself. It runs **shell commands**, **git**, and **EAS**. To “edit code on the VPS via Telegram” we rely on: (1) **git** – you can ask the bot to pull, commit, and push (e.g. after you edit in GitHub’s web UI or another machine and push); (2) **run_shell** – you can ask it to run a specific command (e.g. `npm run prepare:vps` or a one-liner). For actual file edits from Telegram, you’d have to describe the change in a message and have the LLM run a shell command that applies it (e.g. `sed` or a small script), or edit in GitHub and then “pull and build” via the bot. So the intended workflow is: **trigger builds, git pull/commit/push, and run scripts from Telegram**; heavier code edits are done locally or on GitHub, then the bot helps you build and publish from the VPS.

- **Flow when away:** You’re away from your PC. On the VPS the bot is running. You open Telegram, send e.g. “Pull latest and run prepare:vps” or “Bump iOS build, run EAS iOS production build, then submit to TestFlight”. The bot runs the right tools and reports back. So the VPS becomes the place where builds and deploys happen when you’re not at your desk.

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
