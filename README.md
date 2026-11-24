# Chat Agent with Web Search

A conversational AI agent with live web search and persistent memory. Ask it anything; it searches
the web, cites its sources, and remembers your past conversations — including re-checking whether
its old answers are still correct.

Built with **Next.js**, the **Vercel AI SDK**, **Google Gemini** (free tier), **Tavily** (free
tier), and **SQLite**.

## Quick start

```bash
npm install

# copy the sample env file and add your two API keys
cp .env.example .env.local
```

Add your keys to `.env.local`:

```env
GOOGLE_GENERATIVE_AI_API_KEY=...   # from https://aistudio.google.com  (free tier)
TAVILY_API_KEY=...                 # from https://tavily.com          (free tier)
```

Then run:

```bash
npm run dev
```

Open http://localhost:3000 and chat.

> No database setup is needed — the agent stores its memory in a local SQLite file (`data/chat.db`)
> that's created automatically.

## How it works

- The agent has one tool, **web search** (via Tavily), plus a **persistent memory** stored in SQLite.
- Every message is saved with a timestamp, so the agent can recall *what you asked earlier* and
  *what it answered* — by date ("3 November") or by topic ("Postgres hosting").
- When you ask "is that still correct?", it recalls the old answer, re-searches with a freshness
  filter, and tells you what changed.
- Answers stream back as they're generated, with source links.

## Stack

- **Next.js 16** (App Router) + **TypeScript**
- **Vercel AI SDK** — agent loop, tool calling, streaming
- **Google Gemini** (`gemini-3.8-flash`) — free tier
- **Tavily** — web search, free tier
- **SQLite** (`better-sqlite3`) — memory
- **React** + `useChat` — UI

## Project structure

```
app/
  page.tsx              # chat UI
  api/chat/route.ts     # streaming endpoint
lib/
  agent.ts              # the agent loop (model + tools)
  prompt.ts             # system prompt (injects today's date)
  memory.ts             # SQLite schema + queries
  config.ts             # env vars
  dates.ts              # date helpers
  tools/
    search.ts           # web search (Tavily) + cache
    recall.ts           # past-conversation recall
```

See `DESIGN.md` for the full design rationale.
