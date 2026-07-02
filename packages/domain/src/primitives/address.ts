import { ValidationError } from "@bot/errors";
import { z } from "zod";

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

/**
 * An EVM address. Validated for shape (0x + 20 bytes hex) and normalized to
 * lowercase so equality is a plain `===`. Full EIP-55 checksum verification
 * arrives with viem in the DEX layer (M3); here we only guarantee the format.
 *
 * `.brand` makes this a nominal type: a raw `string` is not assignable to
 * `Address` without going through `toAddress`, so an unvalidated address can't
 * silently flow into a trade.
 */
export const addressSchema = z
  .string()
  .regex(ADDRESS_REGEX, "must be a 0x-prefixed 20-byte hex address")
  .transform((value) => value.toLowerCase())
  .brand<"Address">();

export type Address = z.infer<typeof addressSchema>;

/** Parse a string into an `Address`, throwing {@link ValidationError} if malformed. */
export function toAddress(value: string): Address {
  const result = addressSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Invalid EVM address: "${value}"`, { context: { value } });
  }
  return result.data;
}

/** Type guard: true when `value` has the shape of an EVM address. */
export function isAddress(value: unknown): value is Address {
  return typeof value === "string" && ADDRESS_REGEX.test(value);
}
