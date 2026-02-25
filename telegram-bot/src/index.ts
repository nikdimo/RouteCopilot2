import path from "path";
import { config as loadEnv } from "dotenv";
// Load .env from telegram-bot folder so it works when PM2 starts from any cwd
loadEnv({ path: path.join(__dirname, "..", ".env") });
import { Bot } from "grammy";
import { createLLMClient } from "./llm";
import { TOOL_DEFS, executeTool } from "./tools";
import type { ToolCall, ToolResult, LLMResponse } from "./types";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

function getApiKey(): string {
  switch (LLM_PROVIDER) {
    case "gemini":
      return process.env.GEMINI_API_KEY || "";
    case "openai":
      return process.env.OPENAI_API_KEY || "";
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY || "";
    default:
      return "";
  }
}

const MAX_MESSAGE_LENGTH = 4000;

function truncate(msg: string): string {
  if (msg.length <= MAX_MESSAGE_LENGTH) return msg;
  return msg.slice(0, MAX_MESSAGE_LENGTH - 50) + "\n\n… (truncated)";
}

async function runToolLoop(
  client: ReturnType<typeof createLLMClient>,
  userMessage: string
): Promise<string> {
  let response: LLMResponse = await client.chat(userMessage);
  let round = 0;
  const maxRounds = 5;

  while (response.toolCalls && response.toolCalls.length > 0 && round < maxRounds) {
    round++;
    const results: ToolResult[] = [];
    for (const tc of response.toolCalls) {
      try {
        const out = executeTool(tc.name, tc.arguments);
        const content = typeof out === "string" && out.length > 0
          ? (out.length > 2000 ? out.slice(0, 2000) + "\n… (truncated)" : out)
          : "(command completed with no output)";
        results.push({ id: tc.id, content });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ id: tc.id, content: `Error: ${msg}` });
      }
    }
    response = await client.chat(userMessage, {
      toolCalls: response.toolCalls,
      results,
    });
  }

  return response.text || "(No reply)";
}

async function main() {
  if (!TELEGRAM_TOKEN) {
    console.error("Missing TELEGRAM_BOT_TOKEN. Set it in .env");
    process.exit(1);
  }
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(`Missing API key for ${LLM_PROVIDER}. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env`);
    process.exit(1);
  }

  const llm = createLLMClient(LLM_PROVIDER, apiKey, TOOL_DEFS);
  const bot = new Bot(TELEGRAM_TOKEN);

  bot.command("start", (ctx) => {
    return ctx.reply(
      "WisePlan VPS bot. Send me a message to run git, EAS build/submit, or shell commands. Examples:\n" +
        "• “Git status”\n• “Commit and push with message: fix map”\n• “Bump iOS build and start EAS iOS production build”\n• “Submit latest build to TestFlight”"
    );
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    if (ALLOWED_CHAT_IDS.length > 0 && !ALLOWED_CHAT_IDS.includes(String(chatId))) {
      await ctx.reply("Not allowed.");
      return;
    }

    const text = ctx.message.text.trim();
    if (!text) return;

    const statusMsg = await ctx.reply("Thinking…");
    try {
      const reply = await runToolLoop(llm, text);
      await ctx.api.editMessageText(chatId, statusMsg.message_id, truncate(reply));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.api.editMessageText(chatId, statusMsg.message_id, `Error: ${truncate(msg)}`);
    }
  });

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  await bot.start();
  console.log(`WisePlan Telegram bot running (LLM: ${LLM_PROVIDER}). Send a message to the bot to start.`);
}

main();
