import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { createAgentStream } from "@/lib/agent";
import { appendMessage, type Citation } from "@/lib/memory";
import { hasApiKeys } from "@/lib/config";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const messages: UIMessage[] = body.messages ?? [];
  const conversationId: string = body.conversationId ?? "default";

  if (!hasApiKeys()) {
    return Response.json(
      {
        error:
          "Missing API keys. Copy .env.example to .env.local and set GOOGLE_GENERATIVE_AI_API_KEY and TAVILY_API_KEY.",
      },
      { status: 500 },
    );
  }

  // Persist the incoming user message (latest user message in the list).
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userText = lastUser?.parts.find((p) => p.type === "text")?.text ?? "";
  if (userText) {
    appendMessage({ conversationId, role: "user", content: userText });
  }

  const modelMessages = await convertToModelMessages(messages);

  const result = createAgentStream(modelMessages, {
    onFinish: (text) => {
      if (!text) return;
      appendMessage({
        conversationId,
        role: "assistant",
        content: text,
        citations: extractUrls(text),
      });
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}

function extractUrls(text: string): Citation[] {
  const urls = text.match(/https?:\/\/[^\s)\]]+/g) ?? [];
  const cleaned = [...new Set(urls.map((u) => u.replace(/[.,;:!?]+$/, "")))];
  return cleaned.map((url) => ({ url, title: url }));
}
