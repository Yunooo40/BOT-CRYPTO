import { Body, Controller, HttpCode, Post, UnauthorizedException, Inject } from "@nestjs/common";
import { z } from "zod";
import { Public, RateLimitBucket } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type LoginBody = z.infer<typeof loginSchema>;

@Controller("v1/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @RateLimitBucket("login")
  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
  ): Promise<{ tokenType: "Bearer"; token: string; expiresInSeconds: number }> {
    const result = await this.auth.login(body.email, body.password);
    if (result === undefined) {
      // One message for both unknown email and wrong password — no oracle.
      throw new UnauthorizedException("Invalid credentials");
    }
    return { tokenType: "Bearer", token: result.token, expiresInSeconds: result.expiresInSeconds };
  }
}
