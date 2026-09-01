import "server-only";
import { env } from "../env";

/**
 * Optional analysis of a report's photo and text.
 *
 * AI is an enhancement here, never a dependency: `AI_PROVIDER=none` is the
 * default and the entire product works identically without it. Callers treat
 * a `null` result as normal — publishing a report must never fail because a
 * model was slow, rate-limited, or switched off.
 *
 * When a provider is configured, its output is stored on `Report.aiAnalysis`
 * and used only to *nudge* the rule-based matcher (see src/lib/matching.ts).
 * It never overrides a human-entered field and is never shown as a fact.
 */
export interface AIAnalysisInput {
  title: string;
  description?: string | null;
  categorySlug: string;
  image?: { buffer: Buffer; mime: string };
}

export interface AIAnalysisResult {
  /** Extra search keywords, already Arabic-normalised by the caller. */
  keywords: string[];
  /** Colour token from src/lib/attributes.ts, when the model is confident. */
  suggestedColor?: string;
  suggestedCategorySlug?: string;
  /** 0–1. Below 0.6 the matcher ignores the suggestion entirely. */
  confidence: number;
  provider: string;
}

export interface AIAnalysisProvider {
  readonly name: string;
  readonly enabled: boolean;
  analyze(input: AIAnalysisInput): Promise<AIAnalysisResult | null>;
}

/** The default. Reports are classified by what the user chose, and nothing else. */
class NoopAIProvider implements AIAnalysisProvider {
  readonly name = "none";
  readonly enabled = false;

  async analyze(): Promise<AIAnalysisResult | null> {
    return null;
  }
}

class AnthropicAIProvider implements AIAnalysisProvider {
  readonly name = "anthropic";
  readonly enabled = true;

  constructor(private readonly apiKey: string) {}

  async analyze(input: AIAnalysisInput): Promise<AIAnalysisResult | null> {
    const controller = new AbortController();
    // A report must publish in about a second. If analysis is not back by
    // then, we drop it rather than making the user wait.
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const content: unknown[] = [
        {
          type: "text",
          text:
            "استخرج كلمات مفتاحية عربية للبحث عن هذا الشيء المفقود، واللون إن كان واضحاً. " +
            "أجب بـ JSON فقط بالشكل {\"keywords\":[],\"suggestedColor\":null,\"confidence\":0.0}.\n" +
            `العنوان: ${input.title}\nالوصف: ${input.description ?? "—"}`,
        },
      ];

      if (input.image) {
        content.unshift({
          type: "image",
          source: {
            type: "base64",
            media_type: input.image.mime,
            data: input.image.buffer.toString("base64"),
          },
        });
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          messages: [{ role: "user", content }],
        }),
      });

      if (!response.ok) return null;

      const payload = (await response.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = payload.content?.find((part) => part.type === "text")?.text;
      if (!text) return null;

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as {
        keywords?: unknown;
        suggestedColor?: unknown;
        confidence?: unknown;
      };

      return {
        keywords: Array.isArray(parsed.keywords)
          ? parsed.keywords.filter((k): k is string => typeof k === "string").slice(0, 12)
          : [],
        suggestedColor:
          typeof parsed.suggestedColor === "string" ? parsed.suggestedColor : undefined,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
        provider: this.name,
      };
    } catch {
      // Timeouts, network errors, malformed JSON — all mean "no analysis".
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

let cached: AIAnalysisProvider | undefined;

export function ai(): AIAnalysisProvider {
  if (cached) return cached;
  cached =
    env.aiProvider === "anthropic" && env.anthropicApiKey
      ? new AnthropicAIProvider(env.anthropicApiKey)
      : new NoopAIProvider();
  return cached;
}

/**
 * Never lets an analysis failure reach the caller. Report creation calls this,
 * not `ai().analyze()` directly.
 */
export async function analyzeSafely(
  input: AIAnalysisInput,
): Promise<AIAnalysisResult | null> {
  const provider = ai();
  if (!provider.enabled) return null;
  try {
    return await provider.analyze(input);
  } catch {
    return null;
  }
}
