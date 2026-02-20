import Anthropic from "@anthropic-ai/sdk";
import type { ToolDef, ToolCall, ToolResult, LLMResponse } from "../types";

const MODEL = "claude-3-5-haiku-20241022";

function toAnthropicTool(def: ToolDef): Anthropic.Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: {
      type: "object" as const,
      properties: def.parameters.properties,
      required: def.parameters.required || [],
    },
  };
}

export function createAnthropicClient(apiKey: string, toolDefs: ToolDef[]) {
  const client = new Anthropic({ apiKey });
  const tools = toolDefs.map(toAnthropicTool);

  return {
    async chat(
      userMessage: string,
      toolResults?: { toolCalls: ToolCall[]; results: ToolResult[] }
    ): Promise<LLMResponse> {
      const system =
        "You are a coding assistant on a VPS. You can run shell commands, git, and EAS (Expo) build/submit. Be concise. When the user asks to build or publish, use the provided tools (bump_ios_build, eas_build_ios, eas_submit_ios_testflight, git_commit_push, etc.). After starting an iOS build (eas_build_ios), always tell the user the build link from the output and ask: when the build is done, do they want to submit to TestFlight or take any other actions (e.g. Apple login)?";

      let messages: Anthropic.MessageParam[] = [];
      if (toolResults && toolResults.results.length > 0) {
        const assistantContent: Anthropic.ToolUseBlock[] = toolResults.toolCalls.map((tc) => ({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        }));
        const userToolResults: Anthropic.ToolResultBlockParam[] = toolResults.results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.content,
        }));
        messages = [
          { role: "user", content: userMessage },
          { role: "assistant", content: assistantContent },
          { role: "user", content: userToolResults },
        ];
      } else {
        messages = [{ role: "user", content: userMessage }];
      }

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system,
        tools,
        messages,
      });

      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      const text = textBlock?.text;
      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUseBlocks.length > 0) {
        const toolCalls: ToolCall[] = toolUseBlocks.map((b) => ({
          id: b.id,
          name: b.name,
          arguments: b.input as Record<string, unknown>,
        }));
        return { toolCalls, text: text || undefined };
      }
      return { text: text || undefined };
    },
  };
}
