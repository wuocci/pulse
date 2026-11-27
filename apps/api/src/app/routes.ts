import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { DeviceSchema, RoutineInputSchema, RoutineSchema } from "@pulse/schema";
import type { AppStore } from "./store.ts";

// The app module's routes (ADR 0010), under /app: a Device registers once with no login (ADR 0013) and sends its id
// with every other request. Portable HTTP layer (AGENTS.md): Web APIs only; the store is injected.

export const DEVICE_HEADER = "X-Pulse-Device";

const MessageSchema = z.object({ message: z.string() });
const device = z.object({ [DEVICE_HEADER.toLowerCase()]: z.string().optional() });
const params = z.object({ id: z.string() });
const unknownDevice = { 401: { description: "No Device, or one Pulse doesn't know", content: { "application/json": { schema: MessageSchema } } } };
const noRoutine = { 404: { description: "The Device has no such Routine", content: { "application/json": { schema: MessageSchema } } } };
const badRoutine = { 400: { description: "Not a Routine", content: { "application/json": { schema: MessageSchema } } } };
const body = { content: { "application/json": { schema: RoutineInputSchema } }, required: true };

const register = createRoute({
  method: "post",
  path: "/devices",
  responses: { 201: { description: "A new anonymous Device", content: { "application/json": { schema: DeviceSchema } } } },
});
const list = createRoute({
  method: "get",
  path: "/routines",
  request: { headers: device },
  responses: {
    200: { description: "The Device's Routines, oldest first", content: { "application/json": { schema: z.object({ routines: z.array(RoutineSchema) }) } } },
    ...unknownDevice,
  },
});
const create = createRoute({
  method: "post",
  path: "/routines",
  request: { headers: device, body },
  responses: { 201: { description: "The saved Routine", content: { "application/json": { schema: RoutineSchema } } }, ...badRoutine, ...unknownDevice },
});
const update = createRoute({
  method: "put",
  path: "/routines/{id}",
  request: { headers: device, params, body },
  responses: { 200: { description: "The changed Routine", content: { "application/json": { schema: RoutineSchema } } }, ...badRoutine, ...unknownDevice, ...noRoutine },
});
const remove = createRoute({
  method: "delete",
  path: "/routines/{id}",
  request: { headers: device, params },
  responses: { 204: { description: "Deleted" }, ...unknownDevice, ...noRoutine },
});
const renew = createRoute({
  method: "post",
  path: "/renew",
  request: { headers: device },
  responses: { 204: { description: "The Device and its Routines are in use: kept another 60 days" }, ...unknownDevice },
});

export function appRoutes(store: AppStore, clock: () => Date) {
  // A body that isn't a Routine: 400 with what's wrong, not zod's whole report.
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    },
  });
  // Every route but registering needs a Device Pulse knows.
  const deviceOf = async (header: string | undefined) => (header && (await store.hasDevice(header)) ? header : undefined);
  const unknown = { message: `Send a registered Device's id as ${DEVICE_HEADER}` };

  return app
    .openapi(register, async (c) => c.json({ id: await store.createDevice(clock()) }, 201))
    .openapi(list, async (c) => {
      const id = await deviceOf(c.req.header(DEVICE_HEADER));
      if (!id) return c.json(unknown, 401);
      return c.json({ routines: await store.listRoutines(id) }, 200);
    })
    .openapi(create, async (c) => {
      const id = await deviceOf(c.req.header(DEVICE_HEADER));
      if (!id) return c.json(unknown, 401);
      return c.json(await store.createRoutine(id, c.req.valid("json"), clock()), 201);
    })
    .openapi(update, async (c) => {
      const id = await deviceOf(c.req.header(DEVICE_HEADER));
      if (!id) return c.json(unknown, 401);
      const routine = await store.updateRoutine(id, c.req.valid("param").id, c.req.valid("json"), clock());
      return routine ? c.json(routine, 200) : c.json({ message: "No such Routine" }, 404);
    })
    .openapi(remove, async (c) => {
      const id = await deviceOf(c.req.header(DEVICE_HEADER));
      if (!id) return c.json(unknown, 401);
      return (await store.deleteRoutine(id, c.req.valid("param").id)) ? c.body(null, 204) : c.json({ message: "No such Routine" }, 404);
    })
    .openapi(renew, async (c) => {
      const id = await deviceOf(c.req.header(DEVICE_HEADER));
      if (!id) return c.json(unknown, 401);
      await store.renew(id, clock());
      return c.body(null, 204);
    });
}
