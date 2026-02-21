# Editing Code on the VPS via Telegram

This doc describes how we work on the repo from the VPS using the Telegram bot, how secrets are stored, and how to use it (with examples).

---

## Implementation notes (what we did)

- **LLM tool-calls fix:** When using OpenAI, the API requires an assistant message containing `tool_calls` before any `tool` result messages. The bot inserts that assistant message when sending tool results so the conversation shape is valid.
- **PM2 and .env:** On the VPS the bot is run with `telegram-bot/start.js`: it loads `.env` from the script directory then `require("./dist/index.js")`. Use `pm2 start start.js --name wiseplan-bot` from `telegram-bot/` (so `.env` is found next to `start.js`). The repo root is one level up; all tools (git, EAS, shell) run with the **repo root** as working directory.

---

## How we edit code on the VPS via Telegram

- **Bot location:** The Telegram bot lives in `telegram-bot/` in this repo. On the VPS we clone the same repo and run the bot from there (`cd telegram-bot && npm run build && pm2 start start.js --name wiseplan-bot`). The bot’s working directory is the **repo root**, so all tools (git, EAS, shell) run in the project that contains `app.json`, `eas.json`, and the app source.

- **What the bot can do:** You send a natural-language message to the bot in Telegram (e.g. “git status”, “commit and push with message: fix map”, “bump iOS build and start EAS iOS build”, “submit latest to TestFlight”). The bot uses an LLM (default: Gemini) to choose which tools to call, then runs them on the VPS and replies with the outcome. So from your phone you can trigger git operations, EAS builds, and TestFlight submits without sitting at the PC.

- **Editing code:** The bot does **not** edit source code by itself. It runs **shell commands**, **git**, and **EAS**. To “edit code on the VPS via Telegram” we rely on: (1) **git** – you can ask the bot to pull, commit, and push (e.g. after you edit in GitHub’s web UI or another machine and push); (2) **run_shell** – you can ask it to run a specific command (e.g. `npm run prepare:vps` or a one-liner). For actual file edits from Telegram, you’d have to describe the change in a message and have the LLM run a shell command that applies it (e.g. `sed` or a small script), or edit in GitHub and then “pull and build” via the bot. So the intended workflow is: **trigger builds, git pull/commit/push, and run scripts from Telegram**; heavier code edits are done locally or on GitHub, then the bot helps you build and publish from the VPS.

- **Flow when away:** You’re away from your PC. On the VPS the bot is running. You open Telegram, send e.g. “Pull latest and run prepare:vps” or “Bump iOS build, run EAS iOS production build, then submit to TestFlight”. The bot runs the right tools and reports back. So the VPS becomes the place where builds and deploys happen when you’re not at your desk.

- **iOS build on the server:** When you ask the bot to “bump iOS build and start EAS iOS production build”, it runs: (1) bump build number, (2) `eas build --platform ios --profile production --non-interactive --no-wait`. The build runs in Expo’s cloud; the bot returns immediately with the build URL. It then asks you: when the build is done, do you want to submit to TestFlight or do anything else (e.g. Apple login)? You can reply “Submit to TestFlight” when the build has finished. On the VPS you do **not** need to log in with Apple ID: EAS uses the credentials already stored for the project (from when you ran the build or `eas credentials` on your PC). The VPS only needs to be logged in to EAS (`eas login` once or `EXPO_TOKEN` in the environment).

---

## Example messages to the bot

You can send natural-language messages; the bot picks the right tools. Examples:

| You say | What the bot does |
|--------|--------------------|
| **Git status** | Runs `git status` and summarizes (branch, modified/untracked files). |
| **Pull latest** | Runs `git pull --rebase`. |
| **Commit and push with message: fix map** | `git add -A`, `git commit -m "fix map"`, `git push`. |
| **What can you do?** | Replies with a short list of capabilities (shell, git, EAS, read files). |
| **Run: df -h** | Runs that shell command on the VPS and returns the output. |
| **Run: pm2 list** | Shows PM2 processes (e.g. wiseplan-bot online). |
| **Bump iOS build and start EAS iOS production build** | Bumps build in `app.json`, starts EAS iOS build (returns build URL; submit to TestFlight later if you want). |
| **Submit latest to TestFlight** | Runs `eas submit --platform ios --profile production --latest --non-interactive`. |

### Switching the bot between LLMs (Gemini / OpenAI / Anthropic)

The bot uses **one** LLM at a time, chosen by `LLM_PROVIDER` in `telegram-bot/.env` (`gemini` | `openai` | `anthropic`). The matching API key must be set (and uncommented); the others can be commented with `#`.

You can switch providers **from Telegram** by asking the bot to run shell commands. The bot has no “write file” tool, so you use `sed` to edit `.env` and then restart PM2. Example: switch from OpenAI to Gemini.

1. Ensure `GEMINI_API_KEY` is in `.env` (with or without `#` in front).
2. Send the bot something like:

   *“Run these commands from the repo root:*
   1. *`sed -i 's/^LLM_PROVIDER=.*/LLM_PROVIDER=gemini/' telegram-bot/.env`*
   2. *`sed -i 's/^# *GEMINI_API_KEY=/GEMINI_API_KEY=/' telegram-bot/.env`*
   3. *`sed -i 's/^OPENAI_API_KEY=/# OPENAI_API_KEY=/' telegram-bot/.env`*
   4. *`pm2 restart wiseplan-bot`*
   *”*

   The bot will run each (or chain with `&&`). After the restart, the next message is handled by the new process using Gemini. To switch back to OpenAI, use the same idea with `LLM_PROVIDER=openai`, uncomment `OPENAI_API_KEY`, and comment `GEMINI_API_KEY`.

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

1. **Bot process:** `pm2 list` — **wiseplan-bot** should be **online**. If not: `cd ~/RouteCopilot2/telegram-bot && pm2 start start.js --name wiseplan-bot`
2. **Recent logs:** `pm2 logs wiseplan-bot --lines 80` — look for missing token, LLM 429/503, or tool errors.
3. **Env vars:** `cd ~/RouteCopilot2/telegram-bot && node -e "require('dotenv').config({path:'.env'}); console.log('TOKEN:', !!process.env.TELEGRAM_BOT_TOKEN); console.log('LLM:', !!process.env.GEMINI_API_KEY || !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY); console.log('APPLE:', !!process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD);"` — all should be true.
4. **Repo:** `cd ~/RouteCopilot2 && git status -sb` — confirms repo and branch state.
5. **Gemini 429/503:** Free tier often hits limits. Switch provider: in `telegram-bot/.env` set `LLM_PROVIDER=openai` (or `anthropic`) and the matching API key, then `pm2 restart wiseplan-bot`. Or ask the bot to run the sed + restart commands (see “Switching the bot between LLMs” above).
