import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";
import { buildSpec } from "../../../apps/api/src/openapi.ts";

// Regenerates the committed spec and types from the API's routes and schemas:
//   pnpm --filter @pulse/client generate
// generate.test.ts fails when either is stale.

export const SPEC_FILE = new URL("../openapi.json", import.meta.url);
export const TYPES_FILE = new URL("./openapi.ts", import.meta.url);

const BANNER = "// Generated from openapi.json by `pnpm --filter @pulse/client generate`. Don't edit by hand.\n\n";

export async function generate(): Promise<{ spec: string; types: string }> {
  const spec = (await buildSpec()) as OpenAPI3;
  return {
    spec: `${JSON.stringify(spec, null, 2)}\n`,
    types: BANNER + astToString(await openapiTS(spec)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { spec, types } = await generate();
  writeFileSync(SPEC_FILE, spec);
  writeFileSync(TYPES_FILE, types);
  console.log("Wrote openapi.json and src/openapi.ts");
}
