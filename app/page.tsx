"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useState } from "react";

function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"'()]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline dark:text-blue-400"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Bubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <div key={i} className="whitespace-pre-wrap">
                <Linkify text={part.text} />
              </div>
            );
          }
          if (part.type.startsWith("tool-")) {
            const state = (part as { state?: string }).state;
            const busy = state !== "output-available" && state !== "output-error";
            const label =
              part.type === "tool-web_search"
                ? busy
                  ? "Searching the web…"
                  : "Searched the web"
                : busy
                  ? "Checking memory…"
                  : "Recalled past conversations";
            return (
              <div key={i} className="text-xs italic text-zinc-500">
                {label}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

export default function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat();

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col gap-4 p-6">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-zinc-500">
            Ask me anything. I can search the web and remember our earlier
            conversations.
          </p>
        )}
        {messages.map((message) => (
          <Bubble key={message.id} message={message} />
        ))}
        {busy && <p className="text-center text-xs text-zinc-400">Thinking…</p>}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
          {error.message}
        </p>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = input.trim();
          if (!text || busy) return;
          sendMessage({ text });
          setInput("");
        }}
      >
        <input
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask me anything…"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Send
        </button>
      </form>
    </div>
  );
}
