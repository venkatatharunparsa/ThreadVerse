import { ApiError } from "./errors.js";

type AutoFillTone = "casual" | "professional" | "funny" | "serious" | "excited";
type AutoFillLength = "short" | "medium" | "long";

interface GeneratePostDraftArgs {
  prompt: string;
  tone?: AutoFillTone;
  length?: AutoFillLength;
}

const DEFAULT_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
const MODEL_FALLBACKS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash",
];
const REQUEST_TIMEOUT_MS = 20000;
const GEMINI_429_COOLDOWN_MS = Number(process.env.GEMINI_429_COOLDOWN_MS ?? 300000);
const GEMINI_DEBUG = ["1", "true", "yes", "on"].includes(
  (process.env.GEMINI_DEBUG ?? "").toLowerCase()
);
const GEMINI_LOG_RAW_RESPONSE = ["1", "true", "yes", "on"].includes(
  (process.env.GEMINI_LOG_RAW_RESPONSE ?? "").toLowerCase()
);
let geminiCooldownUntil = 0;

function logGemini(message: string, meta?: Record<string, unknown>) {
  if (!GEMINI_DEBUG) return;
  if (meta) {
    console.log(`[gemini] ${message}`, meta);
    return;
  }
  console.log(`[gemini] ${message}`);
}

function normalizeModelName(model: string): string {
  return model.replace(/^models\//i, "").trim();
}

function buildModelTryList(defaultModel: string): string[] {
  const seen = new Set<string>();
  const ordered = [normalizeModelName(defaultModel), ...MODEL_FALLBACKS.map(normalizeModelName)];
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

export async function generatePostDraftWithGemini({
  prompt,
  tone = "casual",
  length = "medium",
}: GeneratePostDraftArgs): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new ApiError(503, "AI service is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const now = Date.now();
  if (now < geminiCooldownUntil) {
    const retryAfterMs = geminiCooldownUntil - now;
    logGemini("skipping provider call due to active 429 cooldown", { retryAfterMs });
    throw new ApiError(
      429,
      `AI quota/rate limit cooldown active. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`
    );
  }

  const instruction = [
    "You are a social post formatter.",
    "Return only valid JSON (no markdown, no extra text).",
    "Use this exact JSON shape:",
    '{"title":"string","body":"string","tags":["string"],"isSpoiler":false,"isNsfw":false}',
    "Rules:",
    "- title max 300 chars, concise and clear",
    "- body max 5000 chars, organized with short paragraphs and optional bullet points",
    "- tags: 0 to 6 short lowercase tags without #",
    "- infer isSpoiler/isNsfw conservatively from content",
    `Tone: ${tone}`,
    `Length: ${length}`,
    `User prompt: ${prompt}`,
  ].join("\n");

  try {
    const modelTryList = buildModelTryList(DEFAULT_MODEL);
    let response: Response | null = null;
    let providerErrorText = "";
    const startedAt = Date.now();

    logGemini("auto-fill request started", {
      models: modelTryList,
      promptLength: prompt.length,
      tone,
      length,
    });

    for (let index = 0; index < modelTryList.length; index += 1) {
      const model = modelTryList[index];
      logGemini("calling generateContent", {
        attempt: index + 1,
        totalAttempts: modelTryList.length,
        model,
      });

      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: instruction }],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.6,
              maxOutputTokens: 1400,
            },
          }),
          signal: controller.signal,
        }
      );

      if (response.ok) {
        logGemini("model call succeeded", {
          model,
          status: response.status,
        });
        break;
      }

      providerErrorText = await response.text();
      logGemini("model call failed", {
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

      logGemini("auto-fill request failed", {
        status,
        providerMessage,
        durationMs: Date.now() - startedAt,
      });

      if (status === 429) {
        geminiCooldownUntil = Date.now() + GEMINI_429_COOLDOWN_MS;
        logGemini("429 cooldown activated", {
          cooldownMs: GEMINI_429_COOLDOWN_MS,
          cooldownUntil: new Date(geminiCooldownUntil).toISOString(),
        });
        throw new ApiError(
          429,
          "AI quota/rate limit exceeded. Please try again later or update Gemini API billing/quota settings."
        );
      }

      if (status === 401 || status === 403) {
        throw new ApiError(503, "AI service authentication failed. Please check Gemini API key access.");
      }

      if (status === 404) {
        throw new ApiError(503, "No compatible Gemini model is currently available for this request.");
      }

      throw new ApiError(502, `AI provider error (${status}): ${providerMessage}`);
    }

    const data = (await response.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text)
      .filter(Boolean)
      .join("\n") as string | undefined;

    if (!text) {
      throw new ApiError(502, "AI provider returned an empty response");
    }

    logGemini("auto-fill request completed", {
      durationMs: Date.now() - startedAt,
      responseTextLength: text.length,
    });

    if (GEMINI_LOG_RAW_RESPONSE) {
      logGemini("raw model text response", {
        text,
      });
    }

    const jsonText = extractJsonText(text);
    if (GEMINI_LOG_RAW_RESPONSE) {
      logGemini("parsed json text", {
        jsonText,
      });
    }
    return JSON.parse(jsonText);
  } catch (error: any) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new ApiError(504, "AI request timed out. Please try again.");
    }
    throw new ApiError(502, "Failed to generate AI post draft");
  } finally {
    clearTimeout(timer);
  }
}