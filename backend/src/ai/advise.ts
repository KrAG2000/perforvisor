import { AdvisorDraft, type AdvisorSummary, type AnalysisStats } from "@perforvisor/core";
import type { Config } from "../config.ts";
import { createChatModel } from "./model.ts";

const SUMMARY_PROMPT = `You are Perforvisor, an advisor for small business owners and sellers.
You get facts from customer reviews of one place or product: what customers praise and what they complain about.
- verdict: under 40 words, honest, based only on the facts given. Mention the main praise and the main complaint.
- Weigh topics by how many reviews mention them (the number in brackets): build the verdict and actions on the most-mentioned ones, not on a topic one review raised.
- actions: up to 3 concrete things the OWNER should change, most frequent complaint first (e.g. "Switch to sealed, spill-proof delivery containers").
  Write them for the business, never as tips for customers. Never suggest fixing something customers praise.
Do not invent facts. Respond with JSON only.`;

/**
 * Writes the owner-facing verdict and actions. Strengths and weaknesses come straight from
 * the classified claims (code), not the model: small models mix them up.
 */
export function createAdvisor(config: Config) {
  const model = createChatModel(config, { temperature: 0.3, maxTokens: 400 }).withStructuredOutput(AdvisorDraft, {
    name: "advisor_summary",
    method: "jsonSchema",
  });

  return async (entityName: string, stats: AnalysisStats, signal?: AbortSignal): Promise<AdvisorSummary | null> => {
    if (stats.analysedCount === 0) return null;
    const label = (aspects: typeof stats.aspects) => aspects.map((a) => `${a.aspect.replace("_", " ")} (${a.mentions} reviews)`);
    const facts = {
      name: entityName,
      reviews: stats.reviewCount,
      averageRating: stats.averageRating,
      praisedAspects: label(stats.aspects.filter((a) => a.score > 0)),
      criticisedAspects: label(stats.aspects.filter((a) => a.score < 0).sort((a, b) => a.score - b.score)),
      praise: stats.praise.map((c) => c.claim),
      complaints: stats.complaints.map((c) => c.claim),
    };
    const strengths = stats.praise.slice(0, 3).map((c) => c.claim);
    const weaknesses = stats.complaints.slice(0, 3).map((c) => c.claim);
    try {
      const draft = await model.invoke(
        [
          { role: "system", content: SUMMARY_PROMPT },
          { role: "user", content: JSON.stringify(facts) },
        ],
        { signal },
      );
      return { ...draft, strengths, weaknesses };
    } catch {
      return null;
    }
  };
}

export type Advisor = ReturnType<typeof createAdvisor>;
