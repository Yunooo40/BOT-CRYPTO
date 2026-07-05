import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit is only used to *generate* SQL migrations from `src/db/schema.ts`
 * (`pnpm db:generate`). Applying them is the app's job (`pnpm db:migrate`), so
 * no database credentials are needed here.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
