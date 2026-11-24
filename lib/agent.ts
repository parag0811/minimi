import { streamText, isStepCount, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { config } from "./config";
import { buildSystemPrompt } from "./prompt";
import { webSearchTool } from "./tools/search";
import { recallHistoryTool } from "./tools/recall";

export const tools = {
  web_search: webSearchTool,
  recall_history: recallHistoryTool,
};

export interface AgentOptions {
  onFinish?: (text: string) => void;
}

export function createAgentStream(messages: ModelMessage[], opts: AgentOptions = {}) {
  return streamText({
    model: google(config.googleModel),
    system: buildSystemPrompt(),
    messages,
    tools,
    stopWhen: isStepCount(10),
    onFinish: opts.onFinish ? ({ text }) => opts.onFinish!(text) : undefined,
  });
}
