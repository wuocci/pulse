# Issue tracker: GitHub Issues

GitHub Issues in `wuocci/pulse` hold PRDs and the slices that implement them. Agents write here. Use the `wuocci` account (`gh auth status`; switch with `gh auth switch -u wuocci`).

## Commands

`gh` CLI; the repo comes from `git remote`.

| Action  | Command                                                             |
| ------- | ------------------------------------------------------------------- |
| Create  | `gh issue create --title "…" --body-file <file>`                    |
| Read    | `gh issue view <n> --comments`                                      |
| List    | `gh issue list --state open --label <l> --json number,title,labels` |
| Comment | `gh issue comment <n> --body-file <file>`                           |
| Labels  | `gh issue edit <n> --add-label "…"` / `--remove-label "…"`          |
| Close   | `gh issue close <n> --comment "…"`                                  |

- Write bodies to a scratchpad file and pass `--body-file`. Heredocs mangle backticks and `$`.
- Shell wrappers here have truncated `gh` output. Never read a body back through the shell and re-post it; edit the local file instead.

## Skill phrases

- "Publish to the issue tracker" → create a GitHub issue as above.
- "Fetch the relevant ticket" → a `#123` number goes to `gh issue view 123 --comments`.
