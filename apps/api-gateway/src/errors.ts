import { DomainError } from "@bot/errors";

/** Registering a user with an email that already exists. */
export class DuplicateEmailError extends DomainError {
  override readonly code: string = "DUPLICATE_EMAIL";
}

/** Extremely unlikely (SHA-256 collision on 256-bit keys) but fail loud. */
export class DuplicateApiKeyError extends DomainError {
  override readonly code: string = "DUPLICATE_API_KEY";
}
