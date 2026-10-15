import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { mapWithConcurrency, type AdvisorSummary, type AnalysisReviewInput, type AnalysisStats, type ReviewAnalysis } from "@perforvisor/core";
import type { Config } from "../../config.ts";
import { createAdvisor } from "../advise.ts";
import { createExtractor } from "../extract.ts";
import { computeStats, toReviewAnalysis } from "../stats.ts";

/** Progress events emitted on LangGraph's "custom" stream. */
export type AnalyzeProgress =
  | { stage: "extract"; done: number; total: number; failed: number }
  | { stage: "aggregate" }
  | { stage: "summarize" };

const AnalyzeState = Annotation.Root({
  entityName: Annotation<string>,
  reviews: Annotation<AnalysisReviewInput[]>,
  analyses: Annotation<ReviewAnalysis[]>,
  stats: Annotation<AnalysisStats | null>,
  summary: Annotation<AdvisorSummary | null>,
});
export type AnalyzeStateValue = typeof AnalyzeState.State;
export type AnalyzeInput = Pick<AnalyzeStateValue, "entityName" | "reviews">;

export function buildAnalyzeGraph(config: Config) {
  const extract = createExtractor(config);
  const advise = createAdvisor(config);

  const extractNode = async (state: typeof AnalyzeState.State, runConfig: LangGraphRunnableConfig) => {
    let done = 0;
    let failed = 0;
    const results = await mapWithConcurrency(state.reviews, config.LLM_CONCURRENCY, async (review) => {
      const extraction = await extract(review, runConfig.signal);
      done++;
      if (!extraction) failed++;
      runConfig.writer?.({ stage: "extract", done, total: state.reviews.length, failed } satisfies AnalyzeProgress);
      return extraction ? toReviewAnalysis(review, extraction) : null;
    });
    return { analyses: results.filter((r): r is ReviewAnalysis => r !== null) };
  };

  const aggregate = (state: typeof AnalyzeState.State, runConfig: LangGraphRunnableConfig) => {
    runConfig.writer?.({ stage: "aggregate" } satisfies AnalyzeProgress);
    return { stats: computeStats(state.reviews, state.analyses) };
  };

  const summarize = async (state: typeof AnalyzeState.State, runConfig: LangGraphRunnableConfig) => {
    runConfig.writer?.({ stage: "summarize" } satisfies AnalyzeProgress);
    return { summary: await advise(state.entityName, state.stats!, runConfig.signal) };
  };

  return (
    new StateGraph(AnalyzeState)
      .addNode("extract", extractNode)
      .addNode("aggregate", aggregate)
      .addNode("summarize", summarize)
      .addEdge(START, "extract")
      .addEdge("extract", "aggregate")
      // Nothing to summarise when every extraction failed.
      .addConditionalEdges("aggregate", (state) => (state.analyses.length > 0 ? "summarize" : END), ["summarize", END])
      .addEdge("summarize", END)
      .compile()
  );
}

export type AnalyzeGraph = ReturnType<typeof buildAnalyzeGraph>;
