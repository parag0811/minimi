// Single source of truth for configuration.
//
// Next.js loads environment variables from `.env.local` (and `.env`) in the
// project root automatically — no extra dependency needed. Keep real keys out
// of `.env.example`, which is committed and only documents what is required.

export const config = {
  /** Google Gemini API key (free tier via aistudio.google.com). */
  googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "",

  /** Gemini model id. Configurable so you can swap models without code changes. */
  googleModel: process.env.GOOGLE_MODEL ?? "gemini-3.8-flash",

  /** Tavily search API key (free tier via tavily.com). */
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
};

/** True when the required API keys are present. The UI uses this to hint. */
export function hasApiKeys(): boolean {
  return config.googleApiKey !== "" && config.tavilyApiKey !== "";
}
