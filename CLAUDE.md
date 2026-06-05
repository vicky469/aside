# Aside — Claude Code rules

All rules in `AGENTS.md` apply here. Read that file first.

## Two-Remote Model (CRITICAL)

This repo has two remotes:

```
origin  → github.com/vicky469/aside          (public, Obsidian marketplace)
private → github.com/vicky469/aside-private   (private, unreleased features)
icloud  → ~/iCloud Drive/git-repos/aside-private.git  (local backup)
```

- Only `main` may be pushed to `origin`. The pre-push hook blocks everything else.
- Feature branches always go to `private`: `git push private <branch>`
- The hook auto-mirrors to `icloud` after every `private` push. No extra step needed.
- When shipping: squash-merge the private branch into `main`, one clean commit, then `git push origin main`.
- On a fresh clone:
  ```bash
  git config core.hooksPath scripts/hooks
  git remote add icloud ~/Library/Mobile\ Documents/com~apple~CloudDocs/git-repos/aside-private.git
  ```

Full details: `docs/todo/private-features-strategy.md`

## Build and test

```bash
npm run build    # runs tests + lint + tsc + esbuild
```

Always run before committing. The build must pass.

## Release

- Bump version in `package.json`, `manifest.json`, `versions.json`
- Write release notes to `docs/releases/<version>.md`
- Commit with `chore(release): <version>`, tag, push `origin main`
- Release pipeline triggers on tags matching `*.*.*`
