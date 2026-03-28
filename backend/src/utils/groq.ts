import { ApiError } from "./errors.js";

type AutoFillTone = "casual" | "professional" | "funny" | "serious" | "excited";
type AutoFillLength = "short" | "medium" | "long";

interface GeneratePostDraftArgs {
  prompt: string;
  tone?: AutoFillTone;
  length?: AutoFillLength;
}

const DEFAULT_MODEL = process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant";
const MODEL_FALLBACKS = [
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
  "llama-2-70b-chat",
];
const REQUEST_TIMEOUT_MS = 20000;
const GROQ_429_COOLDOWN_MS = Number(process.env.GROQ_429_COOLDOWN_MS ?? 300000);
const GROQ_DEBUG = ["1", "true", "yes", "on"].includes(
  (process.env.GROQ_DEBUG ?? "").toLowerCase()
);
const GROQ_LOG_RAW_RESPONSE = ["1", "true", "yes", "on"].includes(
  (process.env.GROQ_LOG_RAW_RESPONSE ?? "").toLowerCase()
);
let groqCooldownUntil = 0;

function logGroq(message: string, meta?: Record<string, unknown>) {
  if (!GROQ_DEBUG) return;
  if (meta) {
    console.log(`[groq] ${message}`, meta);
    return;
  }
  console.log(`[groq] ${message}`);
}

function buildModelTryList(defaultModel: string): string[] {
  const seen = new Set<string>();
  const ordered = [defaultModel.trim(), ...MODEL_FALLBACKS.map((m) => m.trim())];
  const list: string[] = [];
  for (const model of ordered) {
    if (model && !seen.has(model)) {
      seen.add(model);
      list.push(model);
    }
  }
  return list;
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return trimmed;
}

function extractProviderErrorMessage(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return "Unknown AI provider error";
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
    const message = parsed?.error?.message?.trim();
    if (message) {
      return message;
    }
  } catch {
    // Fall back to plain text when the provider does not return JSON.
  }

  return trimmed;
}

export async function generatePostDraftWithGroq({
  prompt,
  tone = "casual",
  length = "medium",
}: GeneratePostDraftArgs): Promise<unknown> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new ApiError(503, "AI service is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const now = Date.now();
  if (now < groqCooldownUntil) {
    const retryAfterMs = groqCooldownUntil - now;
    logGroq("skipping provider call due to active 429 cooldown", { retryAfterMs });
    throw new ApiError(
      429,
      `AI quota/rate limit cooldown active. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`
    );
  }

  const systemPrompt = [
    "You are a social post formatter.",
    "Return only valid JSON (no markdown, no extra text).",
    "Use this exact JSON shape:",
    '{"title":"string","body":"string","tags":["string"],"isSpoiler":false,"isNsfw":false}',
    "Rules:",
    "- title max 300 chars, concise and clear",
    "- body max 5000 chars, organized with short paragraphs and optional bullet points",
    "- tags: 0 to 6 short lowercase tags without #",
    "- infer isSpoiler/isNsfw conservatively from content",
  ].join("\n");

  const userMessage = [
    `Tone: ${tone}`,
    `Length: ${length}`,
    `User prompt: ${prompt}`,
  ].join("\n");

  try {
    const modelTryList = buildModelTryList(DEFAULT_MODEL);
    let response: Response | null = null;
    let providerErrorText = "";
    const startedAt = Date.now();

    logGroq("auto-fill request started", {
      models: modelTryList,
      promptLength: prompt.length,
      tone,
      length,
    });

    for (let index = 0; index < modelTryList.length; index += 1) {
      const model = modelTryList[index];
      logGroq("calling Groq API", {
        attempt: index + 1,
        totalAttempts: modelTryList.length,
        model,
      });

      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          temperature: 0.6,
          max_tokens: 1400,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        logGroq("model call succeeded", {
          model,
          status: response.status,
        });
        break;
      }

      providerErrorText = await response.text();
      logGroq("model call failed", {
        model,
        status: response.status,
        message: extractProviderErrorMessage(providerErrorText).slice(0, 180),
      });

      const isNotFound = response.status === 404;
      const hasMoreModels = index < modelTryList.length - 1;
      if (!(isNotFound && hasMoreModels)) {
        break;
      }
    }

    if (!response || !response.ok) {
      const status = response?.status ?? 502;
      const providerMessage = extractProviderErrorMessage(providerErrorText).slice(0, 300);

      logGroq("auto-fill request failed", {
        status,
        providerMessage,
        durationMs: Date.now() - startedAt,
      });

      if (status === 429) {
        groqCooldownUntil = Date.now() + GROQ_429_COOLDOWN_MS;
        logGroq("429 cooldown activated", {
          cooldownMs: GROQ_429_COOLDOWN_MS,
          cooldownUntil: new Date(groqCooldownUntil).toISOString(),
        });
        throw new ApiError(
          429,
          "AI quota/rate limit exceeded. Please try again later."
        );
      }

      if (status === 401 || status === 403) {
        throw new ApiError(503, "AI service authentication failed. Please check Groq API key access.");
      }

      if (status === 404) {
        throw new ApiError(503, "No compatible model is currently available for this request.");
      }

      throw new ApiError(502, `AI provider error (${status}): ${providerMessage}`);
    }

    const data = (await response.json()) as any;
    const text = data?.choices?.[0]?.message?.content as string | undefined;

    if (!text) {
      logGroq("empty response from provider", {
        data,
      });
      throw new ApiError(502, "AI provider returned an empty response");
    }

    logGroq("auto-fill request completed", {
      durationMs: Date.now() - startedAt,
      responseTextLength: text.length,
      tokensUsed: {
        prompt: data?.usage?.prompt_tokens,
        completion: data?.usage?.completion_tokens,
        total: data?.usage?.total_tokens,
      },
    });

    if (GROQ_LOG_RAW_RESPONSE) {
      logGroq("raw model text response", {
        text,
      });
    }

    const jsonText = extractJsonText(text);
    if (GROQ_LOG_RAW_RESPONSE) {
      logGroq("parsed json text", {
        jsonText,
      });
    }
    
    const parsedJson = JSON.parse(jsonText);
    logGroq("successfully parsed final response json", {
      keys: Object.keys(parsedJson),
    });
    return parsedJson;
  } catch (error: any) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new ApiError(504, "AI request timed out. Please try again.");
    }
    if (error instanceof SyntaxError) {
      console.error("[groq] JSON parse error:", error.message);
      throw new ApiError(502, `Invalid JSON response from AI provider: ${error.message}`);
    }
    console.error("[groq] Unexpected error in generatePostDraftWithGroq:", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });
    throw new ApiError(502, "Failed to generate AI post draft");
  } finally {
    clearTimeout(timer);
  }
}
