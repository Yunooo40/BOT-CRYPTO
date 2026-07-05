import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import type { Env } from "@bot/config";
import type { Logger } from "@bot/logger";
import { ENV, LOGGER, USER_REPOSITORY } from "../tokens";
import { hashPassword, verifyPassword } from "./password";
import type { UserRepository } from "./repositories";

/**
 * Upserts THE admin account from ADMIN_EMAIL / ADMIN_PASSWORD at boot. The env
 * is the source of truth for this one user: change the password in the env,
 * restart, and the hash follows. Other users (when user management lands)
 * are never touched by this.
 */
@Injectable()
export class AdminBootstrap implements OnApplicationBootstrap {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.env.ADMIN_EMAIL.toLowerCase();
    const existing = await this.users.findByEmail(email);
    if (existing === undefined) {
      await this.users.create({
        email,
        passwordHash: await hashPassword(this.env.ADMIN_PASSWORD),
        role: "admin",
      });
      this.logger.info({ email }, "bootstrap admin created");
      return;
    }
    if (!(await verifyPassword(this.env.ADMIN_PASSWORD, existing.passwordHash))) {
      await this.users.updatePasswordHash(existing.id, await hashPassword(this.env.ADMIN_PASSWORD));
      this.logger.info({ email }, "bootstrap admin password updated from env");
    }
  }
}
