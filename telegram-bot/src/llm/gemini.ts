import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { ToolDef, ToolCall, ToolResult, LLMResponse } from "../types";

// Use a model with free-tier quota (2.0-flash often has limit 0)
const MODEL = "gemini-2.5-flash-lite";

import type { FunctionDeclaration } from "@google/generative-ai";

function toGeminiTool(def: ToolDef): FunctionDeclaration {
  const props: Record<string, { type: SchemaType; description: string }> = {};
  for (const [k, v] of Object.entries(def.parameters.properties)) {
    props[k] = {
      type: SchemaType.STRING,
      description: v.description,
    };
  }
  return {
    name: def.name,
    description: def.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: props,
      required: def.parameters.required || [],
    },
  };
}

export function createGeminiClient(apiKey: string, toolDefs: ToolDef[]) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const tools = [{ functionDeclarations: toolDefs.map(toGeminiTool) }];

  return {
    async chat(
      userMessage: string,
      toolResults?: { toolCalls: ToolCall[]; results: ToolResult[] }
    ): Promise<LLMResponse> {
      const model = genAI.getGenerativeModel({
        model: MODEL,
        tools,
      });

      const chat = model.startChat({
        history: [],
        tools,
      });

      let content = userMessage;
      if (toolResults && toolResults.results.length > 0) {
        content =
          "The user asked: " +
          userMessage +
          "\n\nResults from the tools you called:\n" +
          toolResults.results
            .map((r) => `Tool result (id ${r.id}): ${r.content}`)
            .join("\n\n") +
          "\n\nReply to the user concisely with the outcome and any next steps.";
      }

      const result = await chat.sendMessage(content);
      const response = result.response;
      const text = response.text();
      const fnCalls = response.functionCalls();

      if (fnCalls && fnCalls.length > 0) {
        const toolCalls: ToolCall[] = fnCalls.map((fc, i) => ({
          id: `gemini-${i}`,
          name: fc.name,
          arguments: (fc.args as Record<string, unknown>) || {},
        }));
        return { toolCalls, text: text || undefined };
      }
      return { text: text || undefined };
    },
  };
}
