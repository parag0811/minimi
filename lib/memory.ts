// Persistent memory for the agent: conversations and messages stored in a
// single SQLite file. Zero configuration — the file is created on first use.
//
// Design notes:
// - A single shared connection is kept on `globalThis` so Next.js dev (which
//   hot-reloads modules) does not open many connections to the same file.
// - WAL mode lets reads and writes happen without blocking each other.
// - `citations` and cache `results` are stored as JSON strings (SQLite has no
//   native JSON type here); the helpers below parse them back into objects.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type Role = "user" | "assistant";

export interface Citation {
  url: string;
  title: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  citations: Citation[];
  createdAt: number;
}

/** A user question plus the assistant answers that followed it. */
export interface RecalledTurn {
  conversationId: string;
  startedAt: number;
  messages: Message[];
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  citations: string | null;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Connection (single shared instance)
// ---------------------------------------------------------------------------

const globalForDb = globalThis as unknown as { __chatDb?: Database.Database };

function openDb(): Database.Database {
  const file = join(process.cwd(), "data", "chat.db");
  mkdirSync(dirname(file), { recursive: true });

  const database = new Database(file);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      title      TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      citations       TEXT,
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_created      ON messages (created_at);

    CREATE TABLE IF NOT EXISTS search_cache (
      cache_key  TEXT PRIMARY KEY,
      results    TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  return database;
}

function getDb(): Database.Database {
  if (!globalForDb.__chatDb) {
    globalForDb.__chatDb = openDb();
  }
  return globalForDb.__chatDb;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

function mapRow(row: MessageRow): Message {
  let citations: Citation[] = [];
  if (row.citations) {
    try {
      citations = JSON.parse(row.citations) as Citation[];
    } catch {
      citations = [];
    }
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    citations,
    createdAt: row.created_at,
  };
}

function ensureConversation(conversationId: string, firstUserMessage?: string): void {
  const exists = getDb().prepare("SELECT id FROM conversations WHERE id = ?").get(conversationId);
  if (exists) return;

  const title = firstUserMessage ? firstUserMessage.slice(0, 60) : "New conversation";
  const now = Date.now();
  getDb()
    .prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(conversationId, title, now, now);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Insert a message, creating the conversation on first use. */
export function appendMessage(input: {
  conversationId: string;
  role: Role;
  content: string;
  citations?: Citation[];
}): Message {
  ensureConversation(input.conversationId, input.role === "user" ? input.content : undefined);

  const message: Message = {
    id: randomUUID(),
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    citations: input.citations ?? [],
    createdAt: Date.now(),
  };

  getDb()
    .prepare(
      "INSERT INTO messages (id, conversation_id, role, content, citations, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(
      message.id,
      message.conversationId,
      message.role,
      message.content,
      JSON.stringify(message.citations),
      message.createdAt
    );
  getDb()
    .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .run(message.createdAt, message.conversationId);

  return message;
}

/** The most recent messages in a conversation (oldest first). */
export function getMessages(conversationId: string, limit = 50): Message[] {
  const rows = getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(conversationId, limit) as MessageRow[];
  return rows.reverse().map(mapRow);
}

/** Every message in a conversation, in order. */
export function allMessages(conversationId: string): Message[] {
  const rows = getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(conversationId) as MessageRow[];
  return rows.map(mapRow);
}

/**
 * Search past turns by date range and/or keywords. Returns each match as a
 * "turn": the user question plus the assistant answers that followed, so the
 * agent can see both the original question and the old answer.
 */
export function searchHistory(opts: {
  query?: string;
  startMs?: number;
  endMs?: number;
  limit?: number;
}): RecalledTurn[] {
  const limit = opts.limit ?? 5;
  const queryTokens = opts.query ? tokenize(opts.query) : null;

  // Fetch candidate user messages (optionally within a date window).
  let rows: MessageRow[];
  if (opts.startMs !== undefined || opts.endMs !== undefined) {
    const where: string[] = ["role = 'user'"];
    const params: unknown[] = [];
    if (opts.startMs !== undefined) {
      where.push("created_at >= ?");
      params.push(opts.startMs);
    }
    if (opts.endMs !== undefined) {
      where.push("created_at <= ?");
      params.push(opts.endMs);
    }
    rows = getDb()
      .prepare(`SELECT * FROM messages WHERE ${where.join(" AND ")} ORDER BY created_at DESC`)
      .all(...params) as MessageRow[];
  } else {
    rows = getDb()
      .prepare("SELECT * FROM messages WHERE role = 'user' ORDER BY created_at DESC")
      .all() as MessageRow[];
  }

  // Score by keyword overlap when a query is given; otherwise newest first.
  const scored = rows
    .map((row) => ({
      message: mapRow(row),
      score: queryTokens ? overlap(queryTokens, tokenize(row.content)) : 1,
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.message.createdAt - a.message.createdAt);

  const top = scored.slice(0, limit);

  return top.map(({ message }) => {
    const messages = allMessages(message.conversationId);
    const start = messages.findIndex((m) => m.id === message.id);
    const turn = messages.slice(start);

    // Keep the question plus its assistant replies, up to the next user message.
    const nextUser = turn.slice(1).findIndex((m) => m.role === "user");
    const stop = nextUser === -1 ? turn.length : nextUser + 1;

    return {
      conversationId: message.conversationId,
      startedAt: message.createdAt,
      messages: turn.slice(0, stop),
    };
  });
}

// ---------------------------------------------------------------------------
// Search-result cache (used by the web_search tool)
// ---------------------------------------------------------------------------

export function getCachedSearch(key: string): unknown | null {
  const row = getDb()
    .prepare("SELECT results, expires_at FROM search_cache WHERE cache_key = ?")
    .get(key) as { results: string; expires_at: number } | undefined;
  if (!row) return null;

  if (row.expires_at < Date.now()) {
    getDb().prepare("DELETE FROM search_cache WHERE cache_key = ?").run(key);
    return null;
  }

  try {
    return JSON.parse(row.results);
  } catch {
    return null;
  }
}

export function setCachedSearch(key: string, value: unknown, ttlMs: number): void {
  getDb()
    .prepare(
      "INSERT INTO search_cache (cache_key, results, expires_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(cache_key) DO UPDATE SET results = excluded.results, expires_at = excluded.expires_at"
    )
    .run(key, JSON.stringify(value), Date.now() + ttlMs);
}

// ---------------------------------------------------------------------------
// Keyword scoring (simple, dependency-free token overlap)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "about", "what", "which", "who", "when", "where", "how", "is", "are", "was",
  "were", "be", "been", "do", "did", "does", "have", "has", "had", "you", "your",
  "my", "me", "i", "we", "us", "it", "this", "that", "since", "then", "still",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

function overlap(query: Set<string>, doc: Set<string>): number {
  let score = 0;
  for (const token of query) {
    if (doc.has(token)) score += 1;
  }
  return score;
}
