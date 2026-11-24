import { tool } from "ai";
import { z } from "zod";
import { searchHistory, type RecalledTurn } from "../memory";
import { parseDateMs } from "../dates";

function formatTurns(turns: RecalledTurn[]) {
  return turns.map((turn) => ({
    date: new Date(turn.startedAt).toLocaleString("en-US"),
    messages: turn.messages.map((m) => `${m.role}: ${m.content}`),
  }));
}

export function recall(opts: {
  query?: string;
  startMs?: number;
  endMs?: number;
  limit?: number;
}) {
  return formatTurns(searchHistory(opts));
}

export const recallHistoryTool = tool({
  description:
    "Recall earlier conversations with this user (past questions and the answers given). Use it when the user refers to something asked before, e.g. 'what did I ask', 'last Tuesday', or 'since then'.",
  inputSchema: z.object({
    query: z.string().optional().describe("Keywords or topic to find in past messages."),
    startDate: z.string().optional().describe("Earliest date, e.g. '2026-11-03'."),
    endDate: z.string().optional().describe("Latest date, e.g. '2026-11-05'."),
    limit: z.number().min(1).max(20).optional().describe("Max turns to return (default 5)."),
  }),
  execute: async ({ query, startDate, endDate, limit }) => {
    return recall({
      query,
      startMs: parseDateMs(startDate) ?? undefined,
      endMs: parseDateMs(endDate) ?? undefined,
      limit,
    });
  },
});
