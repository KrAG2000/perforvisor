import { z } from "zod";
import type { Config } from "../config.ts";

// EmbeddingGemma 2 is trained with task prefixes; vLLM's embeddings API doesn't add them.
const queryPrompt = (question: string) =>
  `task: question answering | query: ${question}`;
const documentPrompt = (title: string, text: string) =>
  `title: ${title || "none"} | text: ${text}`;

const EmbeddingResponse = z.object({
  data: z.array(
    z.object({ index: z.number(), embedding: z.array(z.number()) }),
  ),
});

const BATCH = 32;

/**
 * Shortens a Matryoshka-trained vector (EmbeddingGemma 2: 768 → 512/256/128) and
 * re-normalises it. Done here because vLLM rejects the `dimensions` parameter for
 * models whose config doesn't declare Matryoshka support.
 */
function truncate(vector: number[], dimensions: number): number[] {
  if (vector.length <= dimensions) return vector;
  const cut = vector.slice(0, dimensions);
  const norm = Math.hypot(...cut) || 1;
  return cut.map((x) => x / norm);
}

async function embed(
  config: Config,
  inputs: string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH) {
    const res = await fetch(`${config.EMBED_BASE_URL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.MODEL_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.EMBED_MODEL,
        input: inputs.slice(i, i + BATCH),
      }),
      signal,
    });
    if (!res.ok)
      throw new Error(
        `Embedding request failed (${res.status}): ${await res.text()}`,
      );
    const { data } = EmbeddingResponse.parse(await res.json());
    out.push(
      ...data
        .sort((a, b) => a.index - b.index)
        .map((d) => truncate(d.embedding, config.EMBED_DIMENSIONS)),
    );
  }
  return out;
}

export const embedQuery = async (
  config: Config,
  question: string,
  signal?: AbortSignal,
) => (await embed(config, [queryPrompt(question)], signal))[0]!;

/** Claims are compared with each other (symmetric), so they use the similarity prompt. */
export const embedClaims = (
  config: Config,
  claims: string[],
  signal?: AbortSignal,
) =>
  embed(
    config,
    claims.map((claim) => `task: sentence similarity | query: ${claim}`),
    signal,
  );

export const embedDocuments = (
  config: Config,
  title: string,
  texts: string[],
  signal?: AbortSignal,
) =>
  embed(
    config,
    texts.map((text) => documentPrompt(title, text)),
    signal,
  );
