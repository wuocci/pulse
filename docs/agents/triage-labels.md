# Triage labels

When a skill names a triage role, apply this GitHub label.

| Role              | GitHub label      | Meaning                                   |
| ----------------- | ----------------- | ----------------------------------------- |
| `needs-triage`    | `needs-triage`    | Maintainer needs to evaluate              |
| `needs-info`      | `needs-info`      | Waiting on the reporter                   |
| `ready-for-agent` | `ready-for-agent` | Fully specified, an agent can do it alone |
| `ready-for-human` | `ready-for-human` | Needs a person to implement               |
| `wontfix`         | `wontfix`         | Will not be done                          |
| `bug`             | `bug`             | Category: something is broken             |
| `enhancement`     | `enhancement`     | Category: new feature or improvement      |

`needs-triage`, `needs-info` and `ready-for-human` may not exist yet. If `gh issue edit --add-label` fails with "not found", create it with `gh label create <name>` and retry.
