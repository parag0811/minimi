"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationSummary, Message } from "@/lib/memory";

type Part = UIMessage["parts"][number];

const EXAMPLES = [
  { label: "What's new in AI this week?", icon: "search" },
  { label: "Compare managed Postgres hosting and pricing", icon: "db" },
  { label: "What did I ask you earlier?", icon: "clock" },
];

function ExampleIcon({ name }: { name: string }) {
  if (name === "db") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <ellipse cx="12" cy="5" rx="8" ry="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "clock") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Sparkle({ className = "h-4 w-4 text-white" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-emerald-500" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.6 7.7 9.3a1 1 0 1 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function getToolInfo(part: Part): { done: boolean; label: string } | null {
  if (!part.type.startsWith("tool-")) return null;
  const state = (part as { state?: string }).state;
  const done = state === "output-available" || state === "output-error";
  if (part.type === "tool-web_search") {
    return { done, label: done ? "Searched the web" : "Searching the web…" };
  }
  return { done, label: done ? "Recalled past conversations" : "Recalling your history…" };
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm prose-slate max-w-none [&_a]:font-medium [&_a]:text-indigo-600 [&_a]:no-underline [&_a]:underline-offset-2 hover:[&_a]:underline [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_code]:before:content-none [&_code]:after:content-none [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:text-slate-100">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-md shadow-indigo-500/25">
      <Sparkle />
    </div>
  );
}

function Bubble({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    const text = message.parts.find((p) => p.type === "text");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-600 to-violet-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-md shadow-indigo-600/20">
          {text?.type === "text" ? text.text : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-md border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
          {message.parts.map((part, i) => {
            if (part.type === "text") {
              return (
                <div key={i} className="text-[15px] leading-relaxed text-slate-700">
                  <Markdown>{part.text}</Markdown>
                </div>
              );
            }
            const tool = getToolInfo(part);
            if (tool && tool.done) {
              return (
                <div
                  key={i}
                  className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 last:mb-0"
                >
                  <CheckIcon />
                  {tool.label}
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

function WorkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
        <Spinner />
        <span className="text-sm text-slate-500">{label}</span>
      </div>
    </div>
  );
}

function relativeTime(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function toUIMessage(m: Message): UIMessage {
  return { id: m.id, role: m.role, parts: [{ type: "text", text: m.content }] };
}

export default function Chat() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const { messages, sendMessage, setMessages, status, error } = useChat({
    onFinish: refreshConversations,
  });

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (input === "" && inputRef.current) inputRef.current.style.height = "auto";
  }, [input]);

  const busy = status === "submitted" || status === "streaming";

  const last = messages[messages.length - 1];
  const isAssistant = last?.role === "assistant";
  const activeToolPart = isAssistant
    ? last.parts.find((p) => { const t = getToolInfo(p); return !!t && !t.done; })
    : undefined;
  const hasText = isAssistant && last.parts.some((p) => p.type === "text");

  let activity: string | null = null;
  if (busy) {
    if (activeToolPart) {
      activity =
        activeToolPart.type === "tool-web_search" ? "Searching the web…" : "Recalling your history…";
    } else if (!hasText) {
      activity = "Thinking…";
    }
  }

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const id = activeId ?? crypto.randomUUID();
    if (!activeId) setActiveId(id);
    sendMessage({ text: trimmed }, { body: { conversationId: id } });
  };

  const newChat = () => {
    setActiveId(null);
    setMessages([]);
  };

  const loadConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        setActiveId(id);
        setMessages(data.messages.map(toUIMessage));
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex h-dvh">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200/70 bg-white/70 md:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-md shadow-indigo-500/25">
            <Sparkle />
          </div>
          <span className="text-[17px] font-semibold tracking-tight text-slate-800">minimi</span>
        </div>
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={newChat}
            className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <p className="px-1 pb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Chats
          </p>
          {conversations.length === 0 ? (
            <p className="px-1 text-sm text-slate-400">No chats yet.</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => loadConversation(c.id)}
                className={`mb-1 flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors ${
                  activeId === c.id ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span className="w-full truncate text-sm font-medium">{c.title || "New conversation"}</span>
                <span className="text-xs text-slate-400">{relativeTime(c.updatedAt)}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-xl shadow-indigo-500/30">
                <Sparkle className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-800 sm:text-4xl">
                Ask me anything
              </h1>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-slate-500">
                I search the live web, cite my sources, and remember our earlier conversations.
              </p>
              <div className="mt-10 grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
                {EXAMPLES.map((example) => (
                  <button
                    key={example.label}
                    type="button"
                    onClick={() => send(example.label)}
                    className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-500/5"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 transition-colors group-hover:bg-indigo-100">
                      <ExampleIcon name={example.icon} />
                    </span>
                    <span className="text-sm font-medium leading-snug text-slate-600 group-hover:text-slate-800">
                      {example.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
              {messages.map((message) => (
                <Bubble key={message.id} message={message} />
              ))}
              {activity && <WorkingIndicator label={activity} />}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-2">
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error.message}
            </p>
          </div>
        )}

        <div className="px-4 pb-4 pt-2 sm:px-6">
          <form
            className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-lg shadow-slate-900/5 transition-all focus-within:border-indigo-300 focus-within:shadow-indigo-500/10 focus-within:ring-4 focus-within:ring-indigo-500/10"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
              setInput("");
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                  setInput("");
                }
              }}
              placeholder="Ask me anything…"
              disabled={busy}
              className="max-h-40 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-[15px] text-slate-700 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25 transition-all hover:shadow-lg hover:shadow-indigo-500/30 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
                <path d="M12 19V5m0 0l-6 6m6-6l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
          <p className="mx-auto mt-2.5 w-full max-w-3xl text-center text-xs text-slate-400">
            minimi searches the live web and remembers your past questions.
          </p>
        </div>
      </div>
    </div>
  );
}
