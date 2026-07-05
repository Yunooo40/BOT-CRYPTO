import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PUBLIC_KEY, SCOPES_KEY } from "../common/decorators";
import type { GatewayRequest } from "../common/http";
import type { Scope } from "./scopes";

/**
 * Second global guard: enforces @RequireScopes(...) against the principal set
 * by the AuthGuard. Fail closed — an authenticated route that forgot to
 * declare its scopes is a bug, and it answers 403 rather than defaulting open.
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GatewayRequest>();
    const principal = request.principal;
    if (principal === undefined) {
      // AuthGuard runs first; reaching here without a principal is a wiring bug.
      throw new UnauthorizedException("Missing bearer token");
    }

    const required = this.reflector.getAllAndOverride<Scope[] | undefined>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) {
      throw new ForbiddenException("Route declares no scopes");
    }
    const missing = required.filter((scope) => !principal.scopes.includes(scope));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing scope(s): ${missing.join(", ")}`);
    }
    return true;
  }
}
