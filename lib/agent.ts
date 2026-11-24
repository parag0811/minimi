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

export function createAgentStream(messages: ModelMessage[]) {
  return streamText({
    model: google(config.googleModel),
    system: buildSystemPrompt(),
    messages,
    tools,
    stopWhen: isStepCount(10),
  });
}
