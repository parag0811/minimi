# Chat Agent with Web Search — Architecture

A conversational agent you talk to like a real user. It has one tool — **web search** — plus a
**persistent memory**, so it can answer factual questions, cite sources, remember earlier
conversations, and re-check whether its old answers still hold ("has anything changed since then?").

Built with **Next.js (App Router) + TypeScript**, the **Vercel AI SDK**, **Google Gemini** (free
tier) for reasoning, **Tavily** (free tier) for search, and **SQLite** for memory — so it runs with
**zero setup** beyond two API keys.

---

## 1. The core insight

The hard cases are not about search — they are about **memory + temporal re-verification**:

| Example | What it actually requires |
|---|---|
| "Has any of *them* changed pricing since Monday?" | Remember *which 5 tools*, resolve "since Monday", re-search each, diff |
| "What did I ask on 3 November? Still correct today?" | Recall a past turn by date, re-verify the old answer |
| "Last Tuesday I asked about Postgres hosting. Pricing changed since?" | Topic + relative-date recall, then compare then-vs-now |

A stateless "LLM + search tool" fails all three. So the design centers on:

1. **Durable, queryable memory** (SQLite) — every turn is stored with a timestamp.
2. **Temporal reasoning** — the model always knows today's date/weekday, and search freshness
   filters are pushed into the search API itself.
3. **A re-search / verify loop** — the agent can pull its own past answer and re-check it.

Web search is the *tool*; memory is the *product*.

---

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript | Familiar, one server+UI process, `npm run dev` just works |
| Agent loop | **Vercel AI SDK v5** (`streamText`) | Handles tool-calling loop, streaming, step limits, provider swap |
| Model | **Google Gemini — `gemini-3.8-flash`** (free tier) | Genuinely free, agent-optimized; configurable via env |
| Search | **Tavily** (free tier) | Purpose-built for LLM agents; Gemini's own search grounding is *not* free |
| Memory | **SQLite** (`better-sqlite3`) | Zero-config, no server, no connection string — survives restarts |
| Frontend | React + AI SDK `useChat` | Streaming chat UI in ~100 lines, tool-state indicators for free |

Anything that can vary (model name, search provider) sits behind an **interface + env var**, so
nothing is hard-coded and the code stays readable.

---

## 3. Architecture

```
┌───────────────────────────────────────────────┐
│                 Browser                        │
│         React chat UI (app/page.tsx)           │
│         useChat() → streams tokens + sources   │
└──────────────────────┬────────────────────────┘
                       │ POST /api/chat (streamed)
┌──────────────────────▼────────────────────────┐
│        Next.js route handler                   │
│        app/api/chat/route.ts                   │
│        streamText(...) → toDataStreamResponse  │
└────────┬──────────────────────────┬────────────┘
         │                          │
┌────────▼────────┐        ┌────────▼─────────────┐
│   Agent loop    │        │  Memory (SQLite)     │
│   lib/agent.ts  │        │  lib/memory.ts       │
│   system prompt │        │  data/chat.db        │
│   tools:        │        │  conversations       │
│   • web_search  │        │  messages (+citations)│
│   • recall_hist │        │  search_cache        │
└────────┬────────┘        └──────────────────────┘
         │  REST
┌────────▼────────┐
│  Tavily search  │
│  lib/tools/     │
│  search.ts      │
└─────────────────┘
```

---

## 4. How a single turn works

1. **Client** sends `{ messages, conversationId }` via `useChat`.
2. **Route handler** loads that conversation's history from SQLite, appends the new user message,
   and calls `streamText`.
3. **Agent loop** runs: the model decides whether to call `web_search` and/or `recall_history`,
   possibly across several steps (bounded by `stopWhen: stepCountIs(10)`). Tool calls can run in
   **parallel**, so "search all 5 CRM tools" fires concurrently.
4. **Stream** of text tokens flows straight back to the browser (fast first word), with tool states
   surfaced ("Searching the web…").
5. **On finish**, the assistant message + citations are persisted to SQLite for next time.

```ts
// app/api/chat/route.ts (shape, not final code)
export const runtime = "nodejs";            // needed for better-sqlite3
export async function POST(req: Request) {
  const { messages, conversationId } = await req.json();
  const result = streamText({
    model: google("gemini-3.8-flash"),      // free tier, configurable via GOOGLE_MODEL
    system: buildSystemPrompt(),            // injects today's date + weekday
    messages,
    tools: { web_search, recall_history },
    stopWhen: stepCountIs(10),
  });
  return result.toDataStreamResponse();
}
```

---

## 5. The agent loop (AI SDK)

- `streamText` manages the tool-calling loop, streaming, and provider abstraction for us — far less
  code to get wrong than a hand-rolled loop.
- `stopWhen: stepCountIs(10)` is a hard cap so the loop can never run away or burn tokens.
- Tools are plain, typed functions with JSON-schema arguments. The model sees the schema, calls the
  tool, we execute it, and the result is fed back as a tool result message.
- **Rate limits:** the free tier has RPM/RPD limits, so the search tool and the loop both include a
  short retry/backoff on `429 RESOURCE_EXHAUSTED` rather than failing mid-answer.

### Tool schemas

```
web_search({ query, maxResults = 5, freshness? })   // freshness: 'day'|'week'|'month'|'year'
  → [{ title, url, snippet, publishedDate? }]

recall_history({ query?, startDate?, endDate?, limit = 20 })
  → past messages with timestamps and their sources
```

---

## 6. Temporal reasoning

- **Today's date + weekday are injected into the system prompt** at generation time, so the model
  resolves "last Tuesday", "3 November", and "since Monday" reliably. Models with the date in
  context are good at this.
- `lib/dates.ts` provides deterministic helpers (`parseRelative`) used by `recall_history` as a
  safety net (and for unit tests).
- **Freshness is pushed into the search API** (Tavily `days` param, mapped from `freshness`), so a
  "since Monday" query actually only returns recent pages — not just a prose instruction.

---

## 7. Memory model (SQLite)

The database is a single file, `data/chat.db`, auto-created on first run. **No server, no
connection string, nothing for the reviewer to configure** — this is the whole reason SQLite wins
here over PostgreSQL.

```sql
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,          -- 'user' | 'assistant'
  content         TEXT NOT NULL,
  citations       TEXT,                   -- JSON string [{url, title}]
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);
CREATE INDEX idx_messages_created      ON messages (created_at);

CREATE TABLE search_cache (
  cache_key  TEXT PRIMARY KEY,           -- hash(query + freshness + provider)
  results    TEXT,                       -- JSON string
  expires_at INTEGER NOT NULL
);
```

**Two recall paths** (both behind `recall_history`):

1. **Date-based** — filter `messages.created_at` into a range. Handles "on 3 November" / "last Tuesday".
2. **Topic-based** — token-overlap scoring of the query against past user messages, then returns the
   matched turn **with its surrounding context** so the model recovers the full list (e.g. the 5 CRM
   tools) rather than a single isolated line.

**Session continuity** — the current conversation's recent turns are always injected; cross-session
memory is fetched on demand by the tool. This mirrors how ChatGPT memory actually works and avoids
context bloat.

---

## 8. Search + caching

- **Why Tavily and not Gemini's built-in search:** Gemini's "Grounding with Google Search" is only
  available on the *paid* tier (5,000 free requests/mo on paid). Tavily's free tier (~1,000
  credits/mo) is genuinely free and purpose-built for agents, with cleaner result extraction and
  date filtering.
- `SearchProvider` interface with a Tavily implementation; normalizes results to
  `{ title, url, snippet, publishedDate }` so the agent never depends on a vendor's shape.
- **Cache** in SQLite (`search_cache`) keyed by `hash(query + freshness + provider)`, TTL ~5–10 min.
  Follow-up questions ("and the others?") stay fast and cheap, and it absorbs free-tier rate limits.
- Time-sensitive verification uses fresh queries (bypasses cache).

---

## 9. Re-verification flow (the differentiator)

When the user asks "is your answer still correct / has X changed since then":

1. `recall_history` pulls the prior question **and the prior answer + its sources**.
2. `web_search` re-queries the same intent, constrained to "since then" freshness.
3. The model answers the delta explicitly: *what you asked → what I said then → what I found now →
   what changed.*

This is the exact behaviour the evaluation examples probe, so it is a first-class path, not an
afterthought.

---

## 10. Frontend

- `app/page.tsx` uses `useChat` from `@ai-sdk/react`; streaming, input, and loading states come free.
- Tool activity is surfaced as a subtle "Searching the web…" indicator (good-to-talk-to — the user
  never stares at a blank box).
- Assistant output is rendered as markdown; sources are listed as clickable links under each answer.

---

## 11. Project structure

```
minimi/
  package.json
  tsconfig.json
  next.config.ts          # serverExternalPackages: ['better-sqlite3']
  .env.local              # secrets (gitignored)
  .env.example            # documented keys
  .gitignore              # ignores node_modules, .next, .env.local, data/
  README.md
  DESIGN.md               # this file
  app/
    page.tsx              # chat UI (useChat)
    layout.tsx
    api/
      chat/
        route.ts          # streamText → data stream
  lib/
    config.ts             # env parsing (single source of truth)
    agent.ts              # agent loop (model, tools, stopWhen)
    prompt.ts             # system prompt builder (injects date)
    memory.ts             # SQLite schema + queries (single file)
    dates.ts              # date/relative-date helpers
    tools/
      search.ts           # web_search + Tavily + cache
      recall.ts           # recall_history
```

---

## 12. `.env.example`

```
# Model — Google Gemini, FREE tier (get a key at aistudio.google.com)
GOOGLE_GENERATIVE_AI_API_KEY=
GOOGLE_MODEL=gemini-3.8-flash

# Web search — Tavily, FREE tier (~1,000 credits/mo at tavily.com)
TAVILY_API_KEY=
```

No database URL, no other config. SQLite creates `data/chat.db` automatically.

**Free-tier reality check (verified against current Google docs):**

- Gemini's free tier gives free input/output tokens on Flash models — genuinely $0. Models:
  `gemini-3.8-flash` (agent-focused, our default), `gemini-3.6-flash`, `gemini-4-hydrogen`.
- It is **rate-limited** (requests/min + requests/day), so the agent retries on 429.
- Free-tier prompts **may be used to improve Google's products** — fine for a demo, worth knowing.
- Gemini's **search grounding is paid-only**, which is exactly why Tavily stays in the stack.

---

## 13. Why these choices / considered & rejected

**Chosen**
- **AI SDK over hand-rolled loop** — streaming + tool loop + step caps + provider abstraction are
  exactly what we need; writing them by hand is more code *and* more bugs.
- **Gemini free tier** — the only major provider with a genuinely free, agent-capable model tier.
  Provider sits behind a one-line switch, so it's not a lock-in.
- **Tavily free tier for search** — because Gemini's own grounding isn't free, and Tavily is built
  for agents.
- **SQLite for memory** — durable (survives restarts, so the memory tests pass on day two) with
  **zero setup**: no server, no `DATABASE_URL`, no reviewer friction. Synchronous API keeps
  `memory.ts` a few dozen clean lines.
- **Tool-based recall over always-injecting history** — the model fetches memory only when it needs
  it, keeping context lean and the behaviour legible.
- **Date injected into the prompt + API-level freshness** — deterministic and cheap, no extra model
  calls.

**Rejected**
- **PostgreSQL** — real and production-grade, but requires the reviewer to set `DATABASE_URL` (or
  run Docker/Neon). The brief says it must run with just `npm install && npm run dev`, so SQLite's
  zero-config wins. `memory.ts` is one small module, so moving to Postgres later is a contained
  change.
- **Stateless agent** — fails every memory/temporal case.
- **LangChain / LangGraph** — too much abstraction for a single tool + memory; harder to reason
  about and explain.
- **Embeddings/vector DB first** — keyword + date recall already solves the target cases; embeddings
  are a "next week" upgrade, not a day-one dependency.
- **Building our own scraper** — fragile, slow, and legally murky; Tavily is purpose-built for this.
- **Prisma/Drizzle ORM** — the queries are ~6 small SQL statements; raw `better-sqlite3` is more
  transparent and removes a codegen step and a dependency. Easy to add later if the schema grows.
- **WebSockets** — SSE-style streaming via the AI SDK is simpler and sufficient.
- **Anthropic/OpenAI** — no free tier; would require a paid key the reviewer can't be expected to have.

---

## 14. What I'd do with another week

1. **Vector recall** (embeddings) for fuzzy "find that thing we talked about" queries.
2. **Memory summaries** — compress old conversations into rolling summaries for cheaper context.
3. **Proactive change alerts** — a cron that re-checks prior topics daily and pings you.
4. **Evaluation harness** — a small dataset + scoring loop so changes are measured, not felt.
5. **Groundedness checks** — assert each claim maps to a retrieved source before answering.
6. **Multi-user auth + per-user memory**, richer citation UI, model fallback across providers
   (e.g. auto-switch to `gemini-2.5-flash` if `gemini-3.8-flash` is unavailable).
7. **Swap SQLite → Postgres** behind the same `memory.ts` interface if the app ever needs concurrency.

---

## 15. Build order

1. Scaffold Next.js + TS; `package.json`, `next.config.ts`, `.env.example`, `.gitignore`, `README`.
2. `lib/memory.ts` (SQLite schema + queries) and `lib/dates.ts`.
3. `lib/tools/search.ts` (Tavily + cache + 429 retry) and `lib/tools/recall.ts`.
4. `lib/prompt.ts` + `lib/agent.ts` + `lib/config.ts`.
5. `app/api/chat/route.ts` (streaming endpoint).
6. `app/page.tsx` (chat UI).
7. Test the three example scenarios end-to-end.
