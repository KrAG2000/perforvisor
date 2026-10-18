import { z } from "zod";

/** Events sent over SSE from the backend to both frontends. */
export const StreamEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("progress"),
    stage: z.string(),
    message: z.string(),
    percent: z.number().min(0).max(100).optional(),
  }),
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({ type: z.literal("result"), data: z.unknown() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;
