import { ValidationError } from "@bot/errors";
import type { PipeTransform } from "@nestjs/common";
import type { ZodType, ZodTypeDef } from "zod";

/**
 * Zod-first request validation: `@Body(new ZodValidationPipe(schema))`.
 * The platform's contract language is Zod (config, events, domain) — no
 * class-validator DTOs. Failures throw the shared ValidationError, which the
 * exception filter renders as a 400 with per-field details.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  // Input type `unknown`: schemas with transforms (branding, string → bigint)
  // have different input and output shapes, and we always feed them raw JSON.
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError("Invalid request", {
        context: {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
    }
    return result.data;
  }
}
