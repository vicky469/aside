## Release Artifact Security

- Before any publish, release, or artifact upload, inspect the exact artifact that will ship.
- Treat shipped artifacts as public. Do not publish source maps, embedded sources, secrets, test fixtures, or local-only files unless the user explicitly wants them public.
- For SideNote2 releases, inspect the shipped assets: `main.js`, `manifest.json`, and `styles.css`.
- Refuse a release if the shipped output includes `main.js.map`, `sourceMappingURL`, `sourcesContent`, raw TypeScript/JSX-family source files, or obvious secret-bearing files such as `.env*`, `.npmrc`, private keys, or certificates.
- If the release is blocked, fix packaging first. Do not bypass the check unless the user explicitly instructs you to make that artifact public and the reason is documented in the response.
- When a release passes, state what artifact inspection was run and what source-exposure checks were performed.

# SideNote2 Agent Routing

When a user is working with real SideNote2 comments in an Obsidian vault, do not start from plugin internals.

Use the SideNote2 note workflow first.

## Use The `sidenote2` Skill

Switch to `skills/sidenote2/SKILL.md` when the user:

- pastes an `obsidian://side-note2-comment?...` URI
- says `reply to this`, `reply to this thread`, `answer this side note`, or `add to thread`
- says `update this side note`, `rewrite this side comment`, or `edit this stored side note`
- says `resolve this side note`, `mark this thread resolved`, or `archive this side note`
- provides a `commentId` plus a vault note path
- asks about the trailing `<!-- SideNote2 comments -->` block in a real markdown note

## Source Of Truth

- The markdown note is canonical.
- The trailing `<!-- SideNote2 comments -->` block is the canonical stored comment data.
- `SideNote2 index.md` is derived output. Use it for discovery only.

## Write Path

For SideNote2 thread writes, prefer the helper scripts over hand-editing JSON:

- `node scripts/create-note-comment-thread.mjs`
- `node scripts/append-note-comment-entry.mjs`
- `node scripts/resolve-note-comment.mjs`
- `node scripts/update-note-comment.mjs`

If the user already supplied an `obsidian://side-note2-comment?...` URI, prefer the URI-based CLI path:

- `--uri "obsidian://side-note2-comment?..."`

## Intent Mapping

- `create new thread`, `create a page note`, `create an anchored note`
  Treat as create-thread.
- `reply`, `continue`, `answer this`, `add another note under this`
  Treat as append-to-thread.
- `update`, `rewrite`, `replace this comment`
  Treat as replace-existing-entry.
- `resolve`, `mark resolved`, `archive this side note`
  Treat as resolve-thread.

Do not overwrite an existing SideNote2 thread when the user clearly asked to reply.

## Release Notes Requirement

- Every release must include `docs/releases/<version>.md`.
- Do not cut or push a release tag unless the matching versioned release-notes file exists and is filled in.
- Treat `docs/releases/_template.md` as the starting point for new release notes, not as shippable content.
