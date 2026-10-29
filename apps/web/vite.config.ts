/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  // The local API: `pnpm dev` at the repo root, or the compose `api` service (API_PROXY_TARGET=http://api:3000).
  server: { proxy: { "/v0": process.env.API_PROXY_TARGET ?? "http://localhost:3000" } },
  test: { name: "web", environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
});
