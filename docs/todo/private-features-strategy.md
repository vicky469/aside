# Private features strategy

## Situation

`aside` is a public Obsidian marketplace plugin. The core plugin stays public — that's the distribution channel and community trust. But some features are commercially sensitive (potential paid tier, power-user workflows, agent integrations) and should not be visible in the public repo until deliberately shipped.

## Three-remote model

```
origin  → github.com/vicky469/aside                           (public, Obsidian marketplace)
private → github.com/vicky469/aside-private                   (private GitHub repo)
icloud  → ~/iCloud Drive/git-repos/aside-private.git          (local iCloud backup)
```

All development still happens in the same local repo. `icloud` is a bare repo inside iCloud Drive — it syncs automatically to all your Apple devices and acts as an offline-capable backup independent of GitHub.

## Day-to-day workflow

**Starting a new private feature:**

```bash
git checkout main
git pull origin main
git checkout -b feat/my-feature
# work, commit freely — commit messages here are never public
git push private feat/my-feature
```

**Keeping the branch up to date as main advances:**

```bash
git fetch origin
git rebase origin/main   # while on feat/my-feature
git push private feat/my-feature --force-with-lease
```

**Shipping a feature publicly:**

Don't merge the branch directly — squash it into one clean commit on main so the development history (including rough messages, experiments, dead ends) stays out of the public log.

```bash
git checkout main
git pull origin main
git merge --squash feat/my-feature
git commit -m "feat(recruitment): add 6-step hiring workflow"
git push origin main        # triggers public release pipeline
```

The single squash commit is all that appears in public history.

## What lives where

| Location | What goes there |
|---|---|
| `origin/main` | Stable, released plugin code |
| `origin/feat/*` | Short-lived public bug fixes, minor features |
| `private/feat/*` | Anything you're not ready to expose: paid features, agent workflows, experimental UI |
| `~/.claude/skills/` | Agent skill templates (local only, never pushed anywhere) |

## Current private branch

`feat/recruitment-workflow` — 6-step hiring workflow with sourcing brief, candidate table, quintile scoring, and enrich flow. Stash needs to be committed and pushed.

```bash
git checkout feat/recruitment-workflow
git stash pop
git add .gitignore styles.css tests/recruitmentWorkflow.test.ts
git commit -m "wip: recruitment workflow step 5/6"
git push private feat/recruitment-workflow
```

## Longer-term: paid tier

When you're ready to monetize, the private features can become a separate plugin or a licensed extension of the public one. Common patterns:

- **Separate plugin** — publish a second plugin to the marketplace with a license key check. The free plugin stays open source; the paid one is closed source.
- **Feature flags via license** — the public plugin has hooks; a private package activates them with a valid license. The hooks are visible in public source but harmless without the license.
- **Self-hosted / direct distribution** — skip the marketplace for paid features, distribute a `.zip` directly to paying users. No Obsidian review process for the paid layer.

The two-remote model works for all of these — private features stay private until you decide the business model.

## Things to watch out for

- **Never push private branch to origin** — double-check `git push` always targets `private` for these branches.
- **Skills stay local** — `~/.claude/skills/recruitment/template.html` is on your machine only. It is not in either repo. Back it up separately if it matters.
- **Stashes are not backups** — always commit and push to `private` before closing the laptop for the day.
- **Rebasing regularly prevents pain** — a branch that drifts far from main becomes hard to squash-merge cleanly. Rebase against `origin/main` at least weekly on active branches.
