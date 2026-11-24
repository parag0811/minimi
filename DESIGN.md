# Chat Agent with Web Search — Design

A conversational agent you talk to like a real user. It has one tool — **web search** — plus a
**persistent memory**, so it can answer questions about the live web, cite its sources, remember
earlier conversations, and re-check whether its old answers still hold.

Built with **Next.js + TypeScript**, the **Vercel AI SDK**, **Google Gemini** (free tier) for
reasoning, **Tavily** (free tier) for search, and **SQLite** for memory.

---

## The problem this solves

A plain "chatbot + search" is stateless — every question starts from scratch. The interesting cases
need more:

| You ask | What the agent actually has to do |
|---|---|
| "Has any of those 5 CRM tools changed pricing since Monday?" | Remember *which* tools, resolve "since Monday", re-search each, compare |
| "What did I ask on 3 November — is it still correct?" | Recall a past question by date, then re-verify it today |
| "Last Tuesday I asked about Postgres hosting. Has pricing changed?" | Topic + relative-date recall, then compare then-vs-now |

So the design centers on **memory + time**, not just search. Web search is the tool; memory is the
product.

## How it works

```
Browser (React chat UI, streams the answer)
        │  POST /api/chat
        ▼
Next.js route handler
        │
        ├──▶ Agent loop (AI SDK)
        │      tools: web_search (Tavily), recall_history (SQLite)
        │
        └──▶ SQLite (data/chat.db) — every turn saved with a timestamp
```

Every conversation is saved to a local SQLite file, with a timestamp on each message. Two features
make the agent feel like it actually knows you:

1. **Memory recall** — when you reference the past ("what did I ask", "last Tuesday"), the agent can
   look up earlier turns by date range and/or topic keywords, and it sees both the original
   question *and* the answer it gave.
2. **Re-verification** — when you ask "is that still true?", it recalls the old answer, re-searches
   with a freshness filter ("since then"), and reports what changed and what didn't.

### The agent loop

1. You send a message.
2. The model decides whether it needs `web_search` and/or `recall_history`, and can call them in
   parallel across several steps (capped at 10 so it can't loop forever).
3. The answer streams back as it's generated, with the sources listed.
4. The turn is saved to SQLite for next time.

**Time handling** is the subtle part. The model is told *today's date* in its prompt, so it can
resolve "last Tuesday" / "3 November" / "since Monday" correctly. And the search tool pushes a
freshness window ("last 7 days") down into the search API itself, rather than just asking the model
to "look for recent things".

## Stack

| Part | Choice | Why |
|---|---|---|
| Framework | Next.js 16 + TypeScript | One process for the UI and the API; `npm run dev` just works |
| Agent loop | Vercel AI SDK | Handles the tool-calling loop, streaming, and step limits — less code to get wrong |
| Model | Google Gemini (`gemini-3.8-flash`) | A genuinely free, agent-capable model |
| Search | Tavily | Free tier, purpose-built for LLM agents, supports date filtering |
| Memory | SQLite (`better-sqlite3`) | Zero-config, no server, survives restarts |
| UI | React + AI SDK `useChat` | Streaming chat UI with tool-status indicators |

Everything that could change (model, search provider) sits behind an interface + env var, so nothing
is hard-coded.

## Why these choices (and what I rejected)

**Chosen**

- **AI SDK over a hand-rolled loop** — streaming, tool-calling, and step caps are exactly what an
  agent needs; writing them by hand is more code *and* more bugs.
- **SQLite over Postgres** — memory must survive restarts, but the app must also run with zero setup
  (`npm install && npm run dev`, no database URL). SQLite gives both.
- **Tool-based recall over always-injecting history** — the model fetches memory only when it needs
  it, keeping the context lean. This mirrors how ChatGPT's memory actually works.
- **Date injected into the prompt + API-level freshness** — deterministic and cheap; no extra model
  calls to figure out what "last Tuesday" means.

**Rejected**

- **A stateless agent** — fails every memory/temporal case above.
- **LangChain / LangGraph** — too much abstraction for one tool + memory; harder to reason about.
- **Embeddings / a vector DB** — keyword + date recall already solves the target cases; embeddings
  are a later upgrade, not a day-one dependency.
- **Postgres / a hosted database** — more power, but the judge must be able to run it with just
  `npm install && npm run dev`.
- **Anthropic / OpenAI** — no free tier; would require a paid key the reviewer can't be expected to
  have.
- **Building my own web scraper** — fragile, slow, and legally murky; Tavily is built for this.

## What I'd do with another week

1. **Semantic recall** (embeddings) for fuzzy "find that thing we talked about" queries.
2. **Memory summaries** — compress old conversations so context stays cheap over long histories.
3. **Proactive change alerts** — a background job that re-checks past topics daily and flags changes.
4. **An evaluation harness** — a small dataset + scoring loop so changes are measured, not felt.
5. **Groundedness checks** — assert each claim maps to a retrieved source before answering.
6. **Multi-user support** — per-user memory and authentication.
