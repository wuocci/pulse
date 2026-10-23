import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

const reachable = { ping: async () => true };
const unreachable = {
  ping: async () => {
    throw new Error("connection refused");
  },
};

describe("GET /v0/health", () => {
  it("reports ok when the database is reachable", async () => {
    const res = await createApp({ db: reachable }).request("/v0/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("reports degraded when the database is unreachable", async () => {
    const res = await createApp({ db: unreachable }).request("/v0/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "degraded", database: "unreachable" });
  });
});

describe("GET /v0/openapi.json", () => {
  it("serves an OpenAPI 3.1 document with the Event schema", async () => {
    const res = await createApp({ db: reachable }).request("/v0/openapi.json");
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, { required?: string[] }> };
    };

    expect(res.status).toBe(200);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths).toHaveProperty("/health");
    expect(doc.components.schemas).toHaveProperty("Event");
    expect(doc.components.schemas.Event?.required).toEqual(
      expect.arrayContaining(["id", "kind", "where", "when", "severity", "sources"]),
    );
  });
});
