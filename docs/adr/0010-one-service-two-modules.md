# One Pulse API service with two modules: core and app

The system has two responsibilities. **core** ingests Sources, maintains Events, matches Watches and sends webhooks, and knows nothing about users. **app** handles users, login, Places, Routines, push policy and pushes. Both run in one Node service (`apps/api`) with two route groups: `/v0/*` with API-key auth (the public Pulse API, the CLI and B2B clients) and `/app/*` with user login (the Pulse app). `app` uses `core` only through the same interface B2B clients get, in-process instead of over HTTP. Core tables never reference users. Ingest workers run as a separate process from the same codebase.

We considered two services (a core API plus a separate app backend). Nothing required separate deployments: key secrecy, identity-free Watches and B2B independence are all enforced by the module boundary. Splitting `app` out later is mechanical, because it already talks to `core` only through its public interface.

We also rejected Next.js for the app side. The backend is a plain HTTP API (Hono), so any client can use it equally: a web UI, a wrapped mobile app or a CLI.
