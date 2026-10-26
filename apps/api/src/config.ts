import pg from "pg";

// Process config for the server entrypoint. Node-only: never imported by the HTTP layer.

type Env = Record<string, string | undefined>;

// The Postgres pool. Errors on idle clients (e.g. the database restarting) are logged, not thrown:
// without a listener they would crash the process. The pool replaces broken clients on the next query.
export function createPool(env: Env = process.env): pg.Pool {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL ?? "postgres://pulse:pulse@localhost:5432/pulse",
    connectionTimeoutMillis: 2_000,
  });
  pool.on("error", (error) => console.error("Postgres client error:", error.message));
  return pool;
}
