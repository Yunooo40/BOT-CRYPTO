import { z } from "zod";

/** Chains the platform supports. Base is the launch chain; more are added here. */
export const SUPPORTED_CHAINS = {
  base: 8453,
} as const;

export type SupportedChainName = keyof typeof SUPPORTED_CHAINS;

/**
 * A supported chain id. Currently a single literal (8453); when a second chain
 * lands this becomes a `z.union([...])` and `ChainId` widens automatically.
 */
export const chainIdSchema = z.literal(SUPPORTED_CHAINS.base);
export type ChainId = z.infer<typeof chainIdSchema>;

/** Type guard: true when `value` is a chain the platform supports. */
export function isSupportedChainId(value: number): value is ChainId {
  return (Object.values(SUPPORTED_CHAINS) as number[]).includes(value);
}
