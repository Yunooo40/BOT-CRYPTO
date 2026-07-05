import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { bearerToken, type GatewayRequest } from "../common/http";
import { PUBLIC_KEY } from "../common/decorators";
import { AuthService } from "./auth.service";

/**
 * First global guard: turns the Authorization header into a
 * {@link Principal} on the request, or a 401. Routes marked @Public() pass
 * through untouched (they simply get no principal).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GatewayRequest>();
    const token = bearerToken(request.headers.authorization);
    if (token === undefined) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const principal = await this.auth.authenticate(token);
    if (principal === undefined) {
      throw new UnauthorizedException("Invalid or expired credentials");
    }
    request.principal = principal;
    return true;
  }
}
