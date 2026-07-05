import "reflect-metadata";
import type { Env } from "@bot/config";
import type { Logger } from "@bot/logger";
import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { PinoNestLogger } from "./common/nest-logger";
import { requestContext } from "./common/request-context";
import { ENV, LOGGER } from "./tokens";

async function bootstrap(): Promise<void> {
  // Env problems must kill the boot before Nest starts wiring providers.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);
  const logger = app.get<Logger>(LOGGER);
  app.useLogger(new PinoNestLogger(logger));

  app.use(helmet());
  const origins = env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length > 0) {
    app.enableCors({ origin: origins });
  }
  app.use(requestContext(logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  logger.info({ port: env.API_PORT }, "api-gateway listening");
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
