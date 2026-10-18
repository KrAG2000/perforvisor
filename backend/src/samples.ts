import { SampleDataset, type SampleSummary } from "@perforvisor/core";
import spiceRouteKitchen from "../fixtures/samples/spice-route-kitchen.json" with { type: "json" };
import voltmaxPowerBank from "../fixtures/samples/voltmax-power-bank.json" with { type: "json" };

/** Built-in datasets, served until live connectors (SerpApi, backlog BL-1) are enabled. */
export const samples: SampleDataset[] = [
  spiceRouteKitchen,
  voltmaxPowerBank,
].map((sample) => SampleDataset.parse(sample));

export const sampleSummaries: SampleSummary[] = samples.map(
  ({ reviews, ...rest }) => ({ ...rest, reviewCount: reviews.length }),
);
