# AGENTS.md

Rules for AI coding agents in this repo. `CLAUDE.md` points here; new rules go here. Product and architecture: `docs/PLAN.md`. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`.

## Review gate: at most 10 changes before review

Never make more than **10 changed files** (created, edited, deleted or renamed) since the last human review. When the next step would cross 10, stop, list what changed and why, and wait for the user's review before continuing.

- Lockfiles and generated output (`pnpm-lock.yaml`, `dist/`, generated OpenAPI or client code) don't count, but mention them.
- A review is the user explicitly looking at the batch and saying to continue. Silence or an unrelated reply is not a review.
- Plan bigger work as a sequence of reviewable batches up front.

## Before writing code

- Read `CONTEXT.md`, the ADRs touching the area, and the existing implementation in the same area.
- Plan any task with 3+ steps or an architectural decision first. If the plan stops matching reality, stop and re-plan.

## Prefer the CLI over hand-rolling

When a tool owns a file format (pnpm, drizzle-kit, capacitor, …), run its CLI instead of writing the file by hand.

## Keep the HTTP layer portable

The API runs on Node on Hetzner (ADR 0004), but the Hono HTTP layer must stay movable to Cloudflare Workers. Route handlers use only standard `Request`/`Response`, `fetch` and Web APIs. Node-only code (`fs`, `net`, MQTT, pg-boss, `process`) lives behind interfaces outside the HTTP layer and is injected at startup.

## Migrations

Append-only once committed: never delete, recreate, or edit a committed migration — add a new one. If a rewrite would be much cleaner (committed but never deployed), ask first.

## Types

- Never use `any` — find or create the right type.
- Request and response shapes come from the zod schemas in `@pulse/schema`; don't duplicate them as hand-written types.
- `pnpm typecheck` must pass before you finish.

## Testing

- Changing covered behaviour → update those tests and run them.
- Area has tests → add one for the new behaviour or fix. Area has none → say which behaviour should get a test.
- Prefer TDD: failing test first, confirm it fails for the right reason, then make it pass.
- Use vitest. Adapters are tested against recorded Source records in fixtures, never live Sources.
- Run `pnpm test` (repo root) before reporting done.

## Done means proven

- Show it works: tests, logs, or a diff of behaviour against `main`.
- After a user correction, add the pattern to `tasks/lessons.md`. Read it at session start.

## Workflow

Idea → merged PR. Full sequence: `docs/agents/dev-flow.md`. Pick the smallest path that fits.

When asked "what next?", suggest the smallest forward move:

- No issue → check `docs/PLAN.md` for the current phase and propose one.
- Fuzzy scope or terms → `/grilling` with `domain-modeling`.
- Clear scope, no PRD → `/to-prd`.
- PRD not split → `/to-issues`.
- Issues not `ready-for-agent` → `/triage`.
- `ready-for-agent` issue waiting → take the smallest unblocked one.

A `ready-for-agent` issue has testable acceptance criteria, uses the terms from `CONTEXT.md`, and names the ADRs it depends on (or says "decide during impl"). If you can't start without asking questions, it isn't ready: move it back to `needs-triage` with a comment saying what's missing.

## Agent skills

These files override the generic defaults in the installed skills. When a skill and these files disagree, these files win.

### Issue tracker

GitHub Issues in `wuocci/pulse` hold PRDs and slices. See `docs/agents/issue-tracker.md`.

### Triage labels

Seven labels; most may not exist yet. See `docs/agents/triage-labels.md`.

### Domain docs

One glossary and one ADR log (`CONTEXT.md`, `docs/adr/`). **Before proposing or writing any ADR, read `docs/agents/domain.md`** — its bar, location and format replace those in the `domain-modeling` skill. Most issues need no ADR; never write one without the user's yes.
