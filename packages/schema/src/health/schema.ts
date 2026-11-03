import { z } from "@hono/zod-openapi";

export const HealthSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    database: z.enum(["ok", "unreachable"]),
  })
  .openapi("Health");

// Whether a Source is keeping up, so a client never reads a stale Source's silence as all clear.
export const SourceStatusSchema = z
  .enum(["ok", "delayed", "down"])
  .openapi("SourceStatus", {
    description: "`delayed`: no successful fetch for longer than its refresh interval (or none yet); `down`: its last fetches all failed",
  });

export const SourceHealthSchema = z
  .object({
    id: z.string().openapi({ example: "hsl-service-alerts" }),
    region: z.string().openapi({ example: "fi-capital-region" }),
    publisher: z.string().openapi({ example: "HSL" }),
    status: SourceStatusSchema,
    refreshMinutes: z.number().int().openapi({ description: "How often it's expected to update" }),
    lastSuccessAt: z.iso.datetime({ offset: true }).optional(),
    lastError: z.object({ at: z.iso.datetime({ offset: true }), message: z.string() }).optional(),
  })
  .openapi("SourceHealth");
