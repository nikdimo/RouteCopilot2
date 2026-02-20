import type { ToolDef } from "../types";
import { createGeminiClient } from "./gemini";
import { createOpenAIClient } from "./openai";
import { createAnthropicClient } from "./anthropic";

export type LLMClient = {
  chat(
    userMessage: string,
    toolResults?: { toolCalls: import("../types").ToolCall[]; results: import("../types").ToolResult[] }
  ): Promise<import("../types").LLMResponse>;
};

export function createLLMClient(provider: string, apiKey: string, toolDefs: ToolDef[]): LLMClient {
  switch (provider) {
    case "gemini":
      return createGeminiClient(apiKey, toolDefs);
    case "openai":
      return createOpenAIClient(apiKey, toolDefs);
    case "anthropic":
      return createAnthropicClient(apiKey, toolDefs);
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider}. Use gemini, openai, or anthropic.`);
  }
}
