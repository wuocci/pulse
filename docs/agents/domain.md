# Domain docs

Repo-specific rules for the `domain-modeling`, `grilling`, `to-prd`, `to-issues`, `triage`, `tdd` and `diagnosing-bugs` skills. Where a skill's generic instructions differ, this file wins.

## Layout

Single context: one glossary and one ADR log for the whole repo.

| What     | Where                    |
| -------- | ------------------------ |
| Glossary | `CONTEXT.md` (repo root) |
| ADRs     | `docs/adr/`              |
| Plan     | `docs/PLAN.md`           |

If the `app` module is ever split into its own service (ADR 0010), switch to a `CONTEXT-MAP.md` with one glossary per service.

## Before exploring

Read `CONTEXT.md` and the ADRs in `docs/adr/` that touch the area.

## ADRs

An ADR log is only useful while it is short enough to read in full. Every entry must be a decision a future developer would otherwise get wrong. When in doubt, don't write one.

### The bar — all four must be true

1. **Hard to reverse.** Undoing it means a data migration, a contract change with clients, or weeks of rework. A refactor-sized change is not hard to reverse.
2. **Surprising without context.** A competent developer reading the code would assume the opposite or try to "fix" it.
3. **A real trade-off.** At least one serious alternative was rejected for a reason that still holds.
4. **Not recorded elsewhere.** The reasoning can't live in a code comment, the glossary, the PRD, the plan, or `AGENTS.md`/a skill.

### Typically qualifies

- What the `core` module may know about users (nothing — ADR 0001).
- Integration shape with Sources, the Classifier, or clients (webhooks, `/v0` contract).
- Security/privacy boundaries (where locations and identities live).
- Technology with real lock-in (database, auth, hosting, client wrapper).

### Never an ADR — put it here instead

| Belongs elsewhere                                  | Where it goes           |
| -------------------------------------------------- | ----------------------- |
| What a feature does, scope, acceptance criteria    | PRD / GitHub issue      |
| Why one function or query is written a certain way | Code comment next to it |
| What a domain term means                           | `CONTEXT.md`            |
| Coding conventions, naming, styling, tooling       | `AGENTS.md` or a skill  |
| Thresholds, phases, Source details                 | `docs/PLAN.md`          |
| Library picks without lock-in, UI/layout choices   | PR description          |
| Bug fixes, refactors, performance tweaks           | Commit / PR             |
| Schema details                                     | The migration           |

### Process

- **Propose, never write unasked.** State which of the four tests it passes in one line each and wait for a yes.
- **Prefer updating an existing ADR** over adding a near-duplicate. A changed decision gets a new ADR that supersedes the old one.

### File naming

`docs/adr/NNNN-<slug>.md`: next number is the highest existing one plus one. Slug states the decision in a few kebab-case words.

### Format

```md
---
status: accepted # proposed | accepted | superseded by 0012
---

# <The decision, as a statement>

<Context, decision, and why — one short paragraph.>

## Considered options

- **<Alternative>** — rejected because …
```

- Title states the decision ("Postgres handles jobs and live fan-out"), not the topic ("Queues").
- `Considered options` is expected for new ADRs; 0001–0011 predate this rule and keep their alternatives in the body text.
- Aim for under 30 lines.

## Using the glossary

Name domain concepts exactly as `CONTEXT.md` defines them, in issues, PRDs, test names, and code. Keep apart the terms the glossary keeps apart — **Severity** vs **Impact**, **Trip** vs **Routine**, **Event** vs **Public event**, **Condition** vs **Anomaly**. If a concept you need isn't in the glossary, either you're inventing language (reconsider) or there is a gap (add it via `domain-modeling`).

## ADR conflicts

If your output contradicts an ADR, say so explicitly and name the file:

> _Contradicts `docs/adr/0001-stateless-api-with-identity-free-watches.md`, but worth reopening because…_
