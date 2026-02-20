/**
 * Wrapper: load .env from this directory first, then run the bot.
 * Use this for PM2 so the bot always finds .env (e.g. pm2 start start.js --name wiseplan-bot --cwd /path/to/telegram-bot).
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("./dist/index.js");
