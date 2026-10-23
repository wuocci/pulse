# Dev flow

The order of steps from an idea to merged code. Rules for each step live in `AGENTS.md` and the named skills — link to them, don't copy them here.

Scale it to the work: a clear issue skips step 2; a one-line fix goes straight to 4 → 6.

## 1. Pick it up

Read the issue (`gh issue view <n> --comments`, see `issue-tracker.md`) and the phase it belongs to in `docs/PLAN.md`. Branch off an up-to-date `main`: `feat/<n>-short-slug`.

## 2. Sharpen it — `/grilling` + `domain-modeling`

Interview that turns a rough idea into a concrete plan. Records new terms in `CONTEXT.md` and hard-to-reverse decisions as ADRs (`domain.md`).

## 3. Spec it — `/to-prd`

Publishes the PRD as a GitHub issue. Several pieces of work → `/to-issues`.

## 4. Build it

- `pnpm install` from the repo root (one shared lockfile).
- Keep `core` and `app` apart: `app` uses `core` only through its public interface (ADR 0010).
- Build only what the spec asks. Respect the review gate in `AGENTS.md`: at most 10 changed files, then stop for review.
- Before committing: `pnpm typecheck`, `pnpm test`.
- Commit with a conventional message (`feat:`, `fix:`, `docs:`, `chore:` …).

## 5. Review it — `/code-review`

Checks the diff against `main` for repo standards and for match with the spec. Run it before asking for human review.

## 6. Ship it

- Open the PR. Title and description reference the issue; features get a Test Plan.
- Before merging, check your local tip equals `origin/<branch>`.
- Merge to `main` after human review.

## Related skills

- `diagnosing-bugs` — find the root cause of a hard bug before fixing it.
- `tdd` — failing test first.
- `pr` — write the PR body.
