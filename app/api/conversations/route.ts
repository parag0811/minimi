import { connection } from "next/server";
import { listConversations } from "@/lib/memory";

export async function GET() {
  await connection(); // reads live SQLite data, so never prerender
  return Response.json({ conversations: listConversations() });
}
