import { defineConfig } from "drizzle-kit";

// For `pnpm --filter @pulse/api db:generate`: every table the API and ingest processes own.
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/core/classifier/cache.ts", "./src/core/conditions/store.ts", "./src/app/store.ts"],
  out: "./drizzle",
});
