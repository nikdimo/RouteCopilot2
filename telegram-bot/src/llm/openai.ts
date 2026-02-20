import OpenAI from "openai";
import type { ToolDef, ToolCall, ToolResult, LLMResponse } from "../types";

const MODEL = "gpt-4o-mini";

function toOpenAITool(def: ToolDef): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  };
}

export function createOpenAIClient(apiKey: string, toolDefs: ToolDef[]) {
  const client = new OpenAI({ apiKey });
  const tools = toolDefs.map(toOpenAITool);

  return {
    async chat(
      userMessage: string,
      toolResults?: { toolCalls: ToolCall[]; results: ToolResult[] }
    ): Promise<LLMResponse> {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content:
            "You are a coding assistant on a VPS. You can run shell commands, git, and EAS (Expo) build/submit. Be concise. When the user asks to build or publish, use the provided tools (bump_ios_build, eas_build_ios, eas_submit_ios_testflight, git_commit_push, etc.). After starting an iOS build (eas_build_ios), always tell the user the build link from the output and ask: when the build is done, do they want to submit to TestFlight or take any other actions (e.g. Apple login)?",
        },
      ];

      if (toolResults && toolResults.results.length > 0) {
        messages.push({ role: "user", content: userMessage });
        // OpenAI requires an assistant message with tool_calls before tool results
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: toolResults.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
        for (const r of toolResults.results) {
          messages.push({
            role: "tool",
            content: r.content,
            tool_call_id: r.id,
          });
        }
      } else {
        messages.push({ role: "user", content: userMessage });
      }

      const completion = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools: tools.length ? tools : undefined,
      });

      const choice = completion.choices[0];
      if (!choice) throw new Error("No completion choice");
      const msg = choice.message;
      const text = msg.content ?? undefined;
      const rawCalls = msg.tool_calls;

      if (rawCalls && rawCalls.length > 0) {
        const toolCalls: ToolCall[] = rawCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: (JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>),
        }));
        return { toolCalls, text };
      }
      return { text: text || undefined };
    },
  };
}
