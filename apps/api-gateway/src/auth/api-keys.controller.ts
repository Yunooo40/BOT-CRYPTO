import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ValidationError } from "@bot/errors";
import { z } from "zod";
import { RequireScopes } from "../common/decorators";
import type { GatewayRequest } from "../common/http";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { API_KEY_REPOSITORY, CLOCK } from "../tokens";
import { generateApiKey } from "./api-key";
import type { ApiKeyRecord, ApiKeyRepository } from "./repositories";
import { SCOPES } from "./scopes";

const createKeySchema = z.object({
  name: z.string().min(1).max(64),
  scopes: z
    .array(z.enum(SCOPES))
    .nonempty()
    .transform((scopes) => [...new Set(scopes)]),
  /** ISO 8601; omitted = never expires. */
  expiresAt: z.coerce.date().optional(),
});

type CreateKeyBody = z.infer<typeof createKeySchema>;

const idSchema = z.string().uuid();

/** The representation that leaves the API — no hash, no key material. */
function toPublic(record: ApiKeyRecord): Omit<ApiKeyRecord, "keyHash"> {
  const { keyHash: _keyHash, ...publicFields } = record;
  return publicFields;
}

@Controller("v1/api-keys")
@RequireScopes("admin")
export class ApiKeysController {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepository,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  /** Create a key. The response is the ONLY time the full key is visible. */
  @Post()
  async create(
    @Body(new ZodValidationPipe(createKeySchema)) body: CreateKeyBody,
    @Req() request: GatewayRequest,
  ): Promise<Omit<ApiKeyRecord, "keyHash"> & { key: string }> {
    if (body.expiresAt !== undefined && body.expiresAt.getTime() <= this.now()) {
      throw new ValidationError("expiresAt must be in the future", {
        context: { issues: [{ path: "expiresAt", message: "must be in the future" }] },
      });
    }
    const generated = generateApiKey();
    const record = await this.apiKeys.create({
      // The AuthGuard guarantees a principal on non-public routes.
      userId: request.principal!.userId,
      name: body.name,
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      scopes: body.scopes,
      expiresAt: body.expiresAt ?? null,
    });
    return { ...toPublic(record), key: generated.key };
  }

  @Get()
  async list(@Req() request: GatewayRequest): Promise<Array<Omit<ApiKeyRecord, "keyHash">>> {
    const records = await this.apiKeys.listByUser(request.principal!.userId);
    return records.map(toPublic);
  }

  /** Revoke (soft-delete): the key stops authenticating immediately. */
  @Delete(":id")
  @HttpCode(204)
  async revoke(
    @Param("id", new ZodValidationPipe(idSchema)) id: string,
    @Req() request: GatewayRequest,
  ): Promise<void> {
    const revoked = await this.apiKeys.revoke(id, request.principal!.userId);
    if (!revoked) {
      throw new NotFoundException("No such live API key");
    }
  }
}
