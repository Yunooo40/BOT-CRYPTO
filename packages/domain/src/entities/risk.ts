import { z } from "zod";

/** Overall traffic-light verdict derived from the aggregate score. */
export const riskVerdictSchema = z.enum(["safe", "caution", "danger"]);
export type RiskVerdict = z.infer<typeof riskVerdictSchema>;

/**
 * One detector's contribution to the risk score (e.g. honeypot, LP-lock,
 * ownership). `score` is 0 (fine) → 100 (bad) for this factor; `weight` is its
 * share of the aggregate. The Rugpull Shield (M6) fills these in.
 */
export const riskFactorSchema = z.object({
  detector: z.string().min(1),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  detail: z.string(),
});
export type RiskFactor = z.infer<typeof riskFactorSchema>;

/** Aggregate risk for a token. `score` runs 0 (safe) → 100 (max danger). */
export const riskScoreSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: riskVerdictSchema,
  factors: z.array(riskFactorSchema),
});
export type RiskScore = z.infer<typeof riskScoreSchema>;
