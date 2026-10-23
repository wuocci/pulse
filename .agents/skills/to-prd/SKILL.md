---
name: to-prd
description: Turn the current conversation (usually a grilled feature idea) into a PRD and publish it as a GitHub issue in wuocci/pulse. Use when the user says "/to-prd", "write the PRD", "spec this", "turn this into an issue/spec", or has finished a grilling session and wants the result written down — even if they don't say "PRD".
---

Synthesize what this conversation and the codebase already establish into a PRD, then publish it. Do **not** re-interview the user — the interview was the grilling session. The one check-in is the test seams (step 2). If the conversation is too thin to fill a section honestly, say which section and ask, rather than inventing.

Repo conventions this skill relies on (read them if you haven't this session):

- `docs/agents/issue-tracker.md` — GitHub Issues hold PRDs and slices.
- `docs/agents/triage-labels.md` — label strings.
- `docs/agents/domain.md` — glossary and ADRs.

## Process

1. **Ground it in the code.** Explore the area you're touching if you haven't already. Use the `CONTEXT.md` terms exactly, and respect ADRs — if the PRD contradicts one, say so in Implementation Decisions instead of silently overriding it. Check `docs/PLAN.md` for which phase the work belongs to.

2. **Agree the test seams.** Sketch where the feature will be tested. Prefer existing seams and the highest one available (e.g. the `/v0` HTTP API rather than an Adapter's internal parser; a recorded-fixture replay rather than a live Source). Show the user the seams and wait for a yes before writing — this is the decision they most often want to change.

3. **Write the PRD** with the template below, in English.

4. **Publish** (see below), then reply with the issue URL and the natural next step (`/to-issues` if it's several pieces of work, otherwise implement).

## Publishing

Write the body to a file in your scratchpad, then:

```bash
gh issue create --title "PRD: <short title>" --label ready-for-agent --body-file <file>
```

`--body-file` rather than a heredoc: PRDs are full of backticks and `$`, which shells mangle. Afterwards confirm the issue really holds the whole body — `gh api repos/wuocci/pulse/issues/<n> --jq '.body|length'` should roughly match the file's character count. Shell wrappers in this setup have truncated `gh` output before, so never read a body back through the shell and re-post it; edit the local file and `gh issue edit <n> --body-file <file>`.

## Template

<prd-template>

## Problem Statement

The problem from the user's perspective — what they can't do today, concretely. List the use cases and say what happens today.

## Solution

The solution from the user's perspective. A small table is fine when it makes the shape obvious (endpoints, screens, Sources).

## User Stories

A long, numbered list covering every aspect of the feature, including errors, limits, security and operations:

1. As an <actor>, I want <feature>, so that <benefit>

Actors can be systems or roles, not only end users (e.g. "the ingest process", "a B2B client", "an operator").

## Implementation Decisions

The decisions made, as bullets with a bold lead-in — scope (which module: `core` or `app`; what is explicitly not touched), modules built or changed and their interfaces, schema changes, API contracts, config, error behaviour, security constraints.

Avoid file paths and code: they go stale. The exception is a contract that prose can't pin down precisely — request/response types, a schema, a state machine — which belongs inline as a short typed snippet. Trim it to the decision, not a working implementation.

## Testing Decisions

- The seam(s) agreed in step 2, and how a test drives them.
- What a good test asserts here — external behaviour only, with concrete examples.
- The behaviours to cover, as a list.
- Fixtures and where test data comes from (note if it contains personal data, e.g. home locations).
- Prior art: existing tests to copy the style of. File paths are fine here.

## Out of Scope

What this PRD does not do, with "→ follow-up issue" where it's real work someone will pick up.

## Further Notes

Anything else: **HITL checkpoints** (steps only a human can do — server access, API keys, Jev access), open questions, freshness or volume assumptions, which glossary terms were added.

</prd-template>

## After publishing

A PRD is a starting point, not a contract. If implementation later departs from it, the PR description should say so — don't silently edit the PRD to match.
