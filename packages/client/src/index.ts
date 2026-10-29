import createFetchClient from "openapi-fetch";
import type { components, paths } from "./openapi.ts";

// The typed client for the Pulse API (/v0), generated from its OpenAPI spec. Framework-free, so the web app,
// the CLI and outside users share it.

export type { paths };
// A named schema from the spec: Schema<"Severity">, Schema<"Geometry">, …
export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];
export type Event = Schema<"Event">;
export type Region = Schema<"Region">;

export interface ClientOptions {
  // The API's origin, e.g. "https://pulse.example". Absolute: a wrapped native app isn't served from the API's origin.
  baseUrl: string;
  // Defaults to the global fetch; tests pass one that calls the app directly.
  fetch?: (request: Request) => Promise<Response>;
}

export function createClient({ baseUrl, fetch }: ClientOptions) {
  return createFetchClient<paths>({ baseUrl: `${baseUrl.replace(/\/+$/, "")}/v0`, ...(fetch ? { fetch } : {}) });
}

export type PulseClient = ReturnType<typeof createClient>;
