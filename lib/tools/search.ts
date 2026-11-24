import { tool } from "ai";
import { z } from "zod";
import { createHash } from "node:crypto";
import { config } from "../config";
import { getCachedSearch, setCachedSearch } from "../memory";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

const TAVILY_URL = "https://api.tavily.com/search";
const CACHE_TTL_MS = 10 * 60 * 1000;

const FRESHNESS_DAYS: Record<"day" | "week" | "month" | "year", number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

function cacheKey(query: string, freshness?: string): string {
  return createHash("sha256").update(`${query}|${freshness ?? ""}`).digest("hex");
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

function mapResults(items: TavilyResult[]): SearchResult[] {
  return items
    .map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
      publishedDate: r.published_date,
    }))
    .filter((r) => r.url !== "");
}

export async function searchWeb(opts: {
  query: string;
  maxResults?: number;
  freshness?: "day" | "week" | "month" | "year";
}): Promise<SearchResult[]> {
  const { query, maxResults = 5, freshness } = opts;

  const key = cacheKey(query, freshness);
  const cached = getCachedSearch(key);
  if (Array.isArray(cached)) return cached as SearchResult[];

  if (!config.tavilyApiKey) {
    throw new Error("Missing TAVILY_API_KEY. Add it to .env.local (see .env.example).");
  }

  const days = freshness ? FRESHNESS_DAYS[freshness] : undefined;
  const results = await tavilySearch(query, maxResults, days);
  setCachedSearch(key, results, CACHE_TTL_MS);
  return results;
}

async function tavilySearch(query: string, maxResults: number, days?: number): Promise<SearchResult[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.tavilyApiKey,
        query,
        max_results: maxResults,
        ...(days ? { days } : {}),
      }),
    });

    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }

    if (!res.ok) {
      throw new Error(`Tavily request failed (${res.status})`);
    }

    const data = (await res.json()) as { results?: TavilyResult[] };
    return mapResults(data.results ?? []);
  }

  throw new Error("Tavily is rate-limiting requests; try again shortly.");
}

export const webSearchTool = tool({
  description:
    "Search the live web. Use for anything factual, time-sensitive, or about current events. Returns titles, URLs, and snippets.",
  inputSchema: z.object({
    query: z.string().describe("The search query."),
    maxResults: z.number().min(1).max(10).optional().describe("Number of results to return (default 5)."),
    freshness: z
      .enum(["day", "week", "month", "year"])
      .optional()
      .describe("Restrict results to this period (e.g. 'week' for the last 7 days)."),
  }),
  execute: async ({ query, maxResults, freshness }) => {
    const results = await searchWeb({ query, maxResults, freshness });
    return { query, results };
  },
});
