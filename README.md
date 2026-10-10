# progress-kit

Agent-agnostic project progress tracking. One JSON file is the source of truth, a zero-dependency Node CLI edits it,
a git hook keeps it current from your commit messages, and a browser page shows it. It works the same for Claude,
Codex, Cursor, any other agent, or a human. Arabic: [README.ar.md](README.ar.md).

```
Overall: 36.5%  [###########...................]
Items:   41 done, 1 active, 53 todo (of 95)
You are here: Phase 3: Storefront - 12.0% (1/9 done)

Now:
  - B27 guest identity hardening [codex, since 01:33]
Next:
  1. B29 payment lifecycle
```

## Install (Node 20+)

```bash
cd your-repo
npx github:Sayedelmahdy/progress-kit init        # add --force to replace kit files
node scripts/progress.mjs
```

`init` adds the files below, appends a "Progress tracking" section to `AGENTS.md` and `CLAUDE.md` (creating them if
missing) so every agent follows the same rules, adds `.githooks/* text eol=lf` to `.gitattributes`, and sets
`core.hooksPath` to `.githooks`. It never overwrites `progress.json`, and other existing files only with `--force`.

| File in your repo | Purpose |
| --- | --- |
| `docs/status/progress.json` | The data: phases, items with ids and weights, now, next, log |
| `docs/status/progress.schema.json` | JSON Schema the CLI validates against |
| `docs/status/index.html` | Browser view (serve the folder; it polls the JSON) |
| `scripts/progress.mjs` | The CLI |
| `scripts/install-hooks.mjs`, `.githooks/post-commit` | Marks work packages done from commit messages |

Then ask your agent once: "read the project plan and add the phases and work packages with
`node scripts/progress.mjs add`". Everyone who clones the repo runs `node scripts/install-hooks.mjs` once.

## Daily use

```bash
node scripts/progress.mjs                                  # overall %, where you are, now, next, log
node scripts/progress.mjs start B27 --who codex            # item -> active
node scripts/progress.mjs progress B27 0.6                 # fraction on an active item
node scripts/progress.mjs done B27 --commit abc1234        # item -> done
node scripts/progress.mjs add p1 B40 "New thing" --w 2 --after B27
node scripts/progress.mjs next "B28 hardening" "B29 payments"
node scripts/progress.mjs log "Switched hosting"
node scripts/progress.mjs validate                         # schema, unique ids, weights
node scripts/progress.mjs --json                           # machine-readable summary
```

Never hand-edit the JSON. The file is found via `--file`, then `PROGRESS_FILE`, then the absolute path in
`.claude/progress-path.txt`, then `docs/status/progress.json` at the git root.

## Self-updating

End the commit subject with the work package id, `feat(api): guest identity (B27)`, or add a trailer
`Progress: done B27, P3.1`. The post-commit hook marks those items done with the commit sha. It only edits the file
and never creates commits, so the change rides along in your next commit. It never fails a commit and does nothing
if Node is missing. For CI, copy `kit/progress.workflow.yml` to `.github/workflows/progress.yml`.

## Optional: Claude Code extras

```bash
npx github:Sayedelmahdy/progress-kit install-claude
```

Installs a status bar above the prompt plus a `/progress` pane (`~/.claude/skills/project-progress/`) and a cheap
Haiku agent that edits the file (`~/.claude/agents/progress-updater.md`). Restart Claude Code afterwards. The bar
relies on Claude Code's local mod support and may not load on every version; the CLI, hook and browser view work
everywhere.

## License

MIT
