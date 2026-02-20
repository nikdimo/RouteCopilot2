# WisePlan Telegram VPS Bot

Run on your VPS so you can trigger git, EAS builds, and TestFlight from Telegram when you’re away. Uses an LLM (default: **Gemini** for low cost) to interpret your messages and call tools.

## What it can do

- **Git**: `git status`, `git pull`, commit and push to GitHub
- **EAS**: bump iOS build number, start iOS production build, submit latest build to TestFlight
- **Shell**: run arbitrary commands in the repo (e.g. `npm run prepare:vps`)
- **Files**: read files and list dirs in the repo

## Setup on VPS

1. **Clone the repo** on the VPS (same repo as your app, so the bot runs from the project root’s `telegram-bot` folder).

2. **Create a Telegram bot** via [@BotFather](https://t.me/BotFather), get the token.

3. **Get an LLM API key** (use one; Gemini is cheapest):
   - **Gemini**: [Google AI Studio](https://aistudio.google.com/apikey) → `GEMINI_API_KEY`
   - **OpenAI**: [platform.openai.com](https://platform.openai.com) → `OPENAI_API_KEY`
   - **Anthropic**: [console.anthropic.com](https://console.anthropic.com) → `ANTHROPIC_API_KEY`

4. **Install and build** (from repo root or from `telegram-bot`):

   ```bash
   cd telegram-bot
   npm install
   npm run build
   ```

5. **Configure env** (copy and edit):

   ```bash
   cp .env.example .env
   # Edit .env: TELEGRAM_BOT_TOKEN, LLM_PROVIDER (e.g. gemini), and the matching API key
   ```

   Optional: set `TELEGRAM_ALLOWED_CHAT_IDS` to a comma-separated list of your Telegram chat IDs so only you can use the bot.

6. **EAS / Git on VPS** (so the bot can build and push):
   - `eas login` or set `EXPO_TOKEN`
   - Git: SSH key or token so `git push` works
   - For TestFlight submit: Apple ID and app-specific password in EAS (see your existing `docs/SUBMIT_SETUP.md`)

7. **Run the bot**:

   ```bash
   npm start
   ```

   For production, run under systemd or PM2 so it restarts on crash/reboot.

## Usage

- Start a chat with your bot in Telegram and send `/start` for a short help.
- Send natural-language requests, e.g.:
  - “Git status”
  - “Commit and push with message: fix map bug”
  - “Bump iOS build and start EAS iOS production build”
  - “Submit the latest build to TestFlight”

The bot will run the right tools and reply with the outcome (and truncate very long output for Telegram).

## Cost

- **Gemini (default)**: Very low cost; Gemini 1.5 Flash is one of the cheapest options.
- **OpenAI**: Use `gpt-4o-mini` for lower cost.
- **Anthropic**: Use Claude Haiku for lower cost.

Only the provider set in `LLM_PROVIDER` and its API key are used.
