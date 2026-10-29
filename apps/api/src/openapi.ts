import { createApp } from "./app.ts";
import { InMemoryEventStore } from "./core/events/store.ts";
import { regions } from "./core/regions/index.ts";

// The OpenAPI document the API serves, without running a server: what `@pulse/client` is generated from.
// The document depends only on the routes and schemas, so the dependencies are stubs.
export async function buildSpec(): Promise<unknown> {
  const app = createApp({ db: { ping: async () => true }, events: new InMemoryEventStore(), regions });
  return (await app.request("/v0/openapi.json")).json();
}
