/**
 * Evaluation on the built-in samples.
 *  1. Ranking: recall@3 and MRR for keyword overlap vs cosine similarity, plus recall@K
 *     (K = ASK_TOP_K): how many relevant reviews reach the answer step.
 *  2. Answers: the real ask flow per question; precision and recall of its citations.
 * Run: pnpm --filter @perforvisor/backend eval:retrieval
 */
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.ts";
import { connectMongo } from "../src/db/mongo.ts";
import { connectPostgres } from "../src/db/postgres.ts";
import { indexReviews, vectorSearch } from "../src/retrieval/store.ts";
import { rankReviews } from "../src/ai/retrieve.ts";
import { buildAskGraph } from "../src/ai/graphs/ask.ts";
import { samples } from "../src/samples.ts";

const labels = JSON.parse(
  await readFile(
    new URL("../fixtures/eval/retrieval.json", import.meta.url),
    "utf8",
  ),
) as Record<string, { question: string; relevant: string[] }[]>;

const config = loadConfig();
const K = config.ASK_TOP_K;
const mongo = await connectMongo(config);
const pg = await connectPostgres(config);
const ask = buildAskGraph(config, { mongo, pg });

const recallAt = (ranked: string[], relevant: string[], k: number) =>
  relevant.filter((id) => ranked.slice(0, k).includes(id)).length /
  relevant.length;
const reciprocalRank = (ranked: string[], relevant: string[]) => {
  const i = ranked.findIndex((id) => relevant.includes(id));
  return i === -1 ? 0 : 1 / (i + 1);
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f2 = (x: number) => x.toFixed(2);

const ranking = {
  keyword: { r3: [] as number[], mrr: [] as number[], rk: [] as number[] },
  vector: { r3: [] as number[], mrr: [] as number[], rk: [] as number[] },
};
const answers: { precision: number; recall: number; ms: number }[] = [];
const rows: string[] = [];

for (const sample of samples) {
  const entityKey = `sample:${sample.id}`;
  await indexReviews(
    config,
    { mongo, pg },
    {
      _id: entityKey,
      source: "sample",
      externalId: sample.id,
      kind: sample.kind,
      name: sample.entityName,
      category: sample.category,
    },
    sample.reviews,
  );

  for (const { question, relevant } of labels[sample.id] ?? []) {
    const ranked = {
      keyword: rankReviews(question, sample.reviews, 30)
        .filter((r) => r.score > 0)
        .map((r) => r.review.id),
      vector: (await vectorSearch(config, pg, entityKey, question, 30)).map(
        (m) => m.id,
      ),
    };
    for (const m of ["keyword", "vector"] as const) {
      ranking[m].r3.push(recallAt(ranked[m], relevant, 3));
      ranking[m].mrr.push(reciprocalRank(ranked[m], relevant));
      ranking[m].rk.push(recallAt(ranked[m], relevant, K));
    }

    const t0 = performance.now();
    const state = await ask.invoke({
      question,
      entityName: sample.entityName,
      reviews: sample.reviews,
    });
    const ms = performance.now() - t0;
    const cited = state.result?.citations.map((c) => c.id) ?? [];
    const precision = cited.length
      ? cited.filter((id) => relevant.includes(id)).length / cited.length
      : 0;
    const recall =
      relevant.filter((id) => cited.includes(id)).length / relevant.length;
    answers.push({ precision, recall, ms });
    rows.push(
      `| ${question} | ${relevant.join(", ")} | ${cited.join(", ") || "none"} | ${f2(precision)} | ${f2(recall)} | ${(ms / 1000).toFixed(1)}s |`,
    );
  }
}

console.log(`\n## Ranking (${ranking.vector.r3.length} questions)\n`);
console.log(
  `| Method | Recall@3 | MRR | Recall@${K} (reaches the answer step) |\n|---|---|---|---|`,
);
for (const m of ["keyword", "vector"] as const)
  console.log(
    `| ${m === "vector" ? "cosine similarity" : m} | ${f2(mean(ranking[m].r3))} | ${f2(mean(ranking[m].mrr))} | ${f2(mean(ranking[m].rk))} |`,
  );

console.log(`\n## Answers: citations from qwen3-4b reading the top ${K}\n`);
console.log(
  `| Question | Relevant | Cited | Precision | Recall | Time |\n|---|---|---|---|---|---|`,
);
console.log(rows.join("\n"));
console.log(
  `\nCitation precision ${f2(mean(answers.map((a) => a.precision)))}, recall ${f2(mean(answers.map((a) => a.recall)))}, median time ${(answers.map((a) => a.ms).sort((a, b) => a - b)[Math.floor(answers.length / 2)]! / 1000).toFixed(1)}s`,
);

await mongo.client.close();
await pg.end();
