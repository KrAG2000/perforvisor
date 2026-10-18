import "./trace-hints.ts";
import { ChatOpenAI } from "@langchain/openai";
import { chatEndpoint, type Config, type ModelRole } from "../config.ts";

/**
 * Chat model served by vLLM through its OpenAI-compatible API.
 * Qwen3's thinking mode is switched off: every call here is schema-constrained,
 * and thinking would multiply latency for little gain.
 */
export function createChatModel(
  config: Config,
  options: { role?: ModelRole; temperature?: number; maxTokens?: number } = {},
) {
  const { baseUrl, model } = chatEndpoint(config, options.role ?? "chat");
  return new ChatOpenAI({
    model,
    apiKey: config.MODEL_API_KEY,
    configuration: { baseURL: baseUrl },
    temperature: options.temperature ?? 0.2,
    maxTokens: options.maxTokens ?? 512,
    maxRetries: 2,
    modelKwargs: { chat_template_kwargs: { enable_thinking: false } },
  });
}

export type ModelStatus =
  { ok: true; models: string[] } | { ok: false; error: string };

export async function checkModelServer(
  baseUrl: string,
  apiKey: string,
): Promise<ModelStatus> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { data?: { id: string }[] };
    return { ok: true, models: (body.data ?? []).map((m) => m.id) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Status of every model role, for /v1/ai/health. */
export async function checkModelRoles(config: Config) {
  const roles = {
    chat: { baseUrl: config.CHAT_BASE_URL, model: config.CHAT_MODEL },
    embed: { baseUrl: config.EMBED_BASE_URL, model: config.EMBED_MODEL },
  };
  const entries = await Promise.all(
    Object.entries(roles).map(
      async ([role, info]) =>
        [
          role,
          {
            ...info,
            ...(await checkModelServer(info.baseUrl, config.MODEL_API_KEY)),
          },
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}
