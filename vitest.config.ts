import { defineConfig } from "vitest/config";

// Node tests for the API and packages; the web app brings its own project (jsdom, React) from its Vite config.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "node", include: ["apps/api/src/**/*.test.ts", "apps/cli/src/**/*.test.ts", "packages/*/src/**/*.test.ts"] } },
      "apps/web",
    ],
  },
});
