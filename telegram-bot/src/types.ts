/** One tool call requested by the LLM */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Result of executing one tool (sent back to LLM) */
export interface ToolResult {
  id: string;
  content: string;
}

/** LLM response: either text or tool calls */
export interface LLMResponse {
  text?: string;
  toolCalls?: ToolCall[];
}

/** Message for LLM context */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Normalized tool definition for any provider */
export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}
