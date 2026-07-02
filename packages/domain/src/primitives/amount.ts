import { ValidationError } from "@bot/errors";
import { z } from "zod";

const MAX_DECIMALS = 36;

/**
 * A raw base-unit amount. Accepts a `bigint` (in-memory) or a decimal-integer
 * string (the JSON wire form, since bigint isn't JSON-serializable) and always
 * yields a non-negative `bigint`. This is the serialization boundary for money:
 * on-chain amounts travel as strings, but every calculation uses bigint.
 */
const rawAmountSchema = z
  .union([z.bigint(), z.string().regex(/^\d+$/, "raw amount must be a non-negative integer")])
  .transform((value) => (typeof value === "bigint" ? value : BigInt(value)))
  .refine((value) => value >= 0n, "raw amount must be non-negative");

export const tokenAmountSchema = z.object({
  raw: rawAmountSchema,
  decimals: z.number().int().min(0).max(MAX_DECIMALS),
});

/** A precise on-chain amount: an integer number of base units plus its scale. */
export type TokenAmount = z.infer<typeof tokenAmountSchema>;

/** Construct a {@link TokenAmount}, validating the invariants. */
export function tokenAmount(raw: bigint, decimals: number): TokenAmount {
  if (raw < 0n) {
    throw new ValidationError("TokenAmount.raw must be non-negative", {
      context: { raw: raw.toString() },
    });
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new ValidationError(`TokenAmount.decimals must be an integer in [0, ${MAX_DECIMALS}]`, {
      context: { decimals },
    });
  }
  return { raw, decimals };
}

/** Parse a human decimal string (e.g. "1.5") into a {@link TokenAmount}. */
export function parseTokenAmount(value: string, decimals: number): TokenAmount {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new ValidationError(`Invalid decimal amount: "${value}"`, { context: { value } });
  }
  const parts = value.split(".");
  const intPart = parts[0] ?? "0";
  const fracPart = parts[1] ?? "";
  if (fracPart.length > decimals) {
    throw new ValidationError(
      `"${value}" has more fractional digits than ${decimals} decimals allow`,
      {
        context: { value, decimals },
      },
    );
  }
  const combined = intPart + fracPart.padEnd(decimals, "0");
  return tokenAmount(BigInt(combined), decimals);
}

/** Render a {@link TokenAmount} as a human decimal string, trimming trailing zeros. */
export function formatTokenAmount(amount: TokenAmount): string {
  const { raw, decimals } = amount;
  if (decimals === 0) {
    return raw.toString();
  }
  const digits = raw.toString().padStart(decimals + 1, "0");
  const cut = digits.length - decimals;
  const intPart = digits.slice(0, cut);
  const fracPart = digits.slice(cut).replace(/0+$/, "");
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
}
