# Private Published Wiki Design

## Status

Approved for planning on 2026-07-26. This spec defines the next private publish direction for user-owned Cloudflare deployments.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside can publish Markdown, HTML, and PDF artifacts from the vault-relative `public/` folder through the user's local Wrangler login and Cloudflare Pages project.
- [x] Aside already renders published Markdown as generated HTML instead of uploading raw Markdown source.
- [x] Aside already keeps local comments in sidecar JSON and plugin-data sync events rather than writing comment blocks into source Markdown.
- [x] Aside already has sync-event operations for comment thread creation, replies, updates, deletion, pinning, movement, and source rename recovery.
- [x] Existing publish artifact guards block obvious secret-bearing files, Obsidian plugin data, source maps, local-only files, and unsafe paths from public release/publish surfaces.
- [x] Private publish core has deterministic `public/index.md` managed-section formatting for creating or replacing the owner-visible inventory content.
- [x] Private publish core has deterministic file, folder, and whole-root selection helpers for supported files under the configured publish root.
- [x] Private publish snapshot support generation can classify Cloudflare Pages `_routes.json`, Pages Functions stubs, and a non-route private permission manifest module so generated permission data is not treated as a static asset.
- [x] Wrangler Pages staging layout planning can keep static assets under an asset directory and Functions/private modules at the temporary Pages project root.
- [x] Server-side private publish manifest core includes a folder-first tree, file route metadata, permission rules, supported/unsupported providers, and single-entry version metadata for each file.

### To Implement

- [x] Add `public/auth.md` parsing for Google and WeChat identities, public-root-relative paths, and `view`, `comment`, and `full` permissions.
- [x] Add inherited permission resolution where folder rows apply downward and more specific rows override broader rows for the same identity.
- [x] Wire `public/index.md` creation into publish enablement or folder publish flows when the file does not exist.
- [x] Wire `public/index.md` updates into successful publish flows as the owner-visible publish inventory and status table.
- [x] Add file and folder publish actions under `public/`, including publishing the whole `public/` root.
- [x] Wire `public/index.md` status updates into unpublish flows.
- [x] Generate the server-side private published-site manifest core with folder tree, file metadata, routes, versions, and permission rules.
- [ ] Wire the private manifest into deployed Pages Functions and expose only permission-filtered manifest data to browser clients.
- [ ] Generate the approved three-pane published shell: folder tree, file viewer with version controls, and Aside sidebar.
- [x] Exclude root `public/auth.md` and root `public/index.md` from the enabled snapshot scanner even when stale publish frontmatter exists.
- [ ] Wire parsed `public/auth.md` rules into generated server-side permission data during deployment without exposing readable static permission assets.
- [ ] Stage Cloudflare Pages Functions, including site-wide middleware, auth routes, and comment API routes.
- [ ] Implement Google OAuth for V1 using user-owned Cloudflare environment variables/secrets, server-side token verification, and signed session cookies.
- [ ] Keep WeChat as a parsed provider and generated-provider slot, but report it as unsupported until its OAuth setup is implemented and tested.
- [ ] Add Cloudflare D1-backed comment event storage for published-site page comments.
- [ ] Add published-site APIs for reading comments, creating page-note threads, appending replies, and later editing/deleting own comments.
- [ ] Extend local comment entry metadata with optional author identity and preserve it through cloning, normalization, projection, sync events, sidecar storage, and sidebar rendering.
- [ ] Add local remote-comment sync that pulls Cloudflare D1 events and imports them through Aside's existing sync-event reducer into sidecar storage.
- [ ] Seed published pages with existing local Aside page-note comments as read-only initial state.
- [ ] Document required Cloudflare setup: Pages project, D1 binding, Google OAuth credentials, session signing secret, and Wrangler deployment path.

### Verification

- [x] Unit tests cover `auth.md` table parsing, validation errors, Google/WeChat provider handling, and path normalization.
- [x] Unit tests cover inherited permission resolution, specificity overrides, and permission ordering.
- [x] Unit tests cover `public/index.md` creation and status-table updates without overwriting unrelated user content.
- [x] Unit tests cover file, folder, and whole-`public/` publish selection helpers.
- [x] Unit tests cover controller integration for file publish, folder publish, whole-root publish, control-file exclusion, and generated Markdown HTML ownership.
- [x] Unit tests cover `public/index.md` status updates after Markdown, paired HTML, standalone HTML, and PDF unpublish.
- [x] Unit tests prove stale root `auth.md` and `index.md` publish frontmatter cannot leak root control Markdown into a deploy snapshot.
- [x] Snapshot support tests prove generated private data is classified as a non-route private module, not a static asset or Pages route file.
- [x] Staging-layout tests prove generated Functions and private modules are planned beside the static asset directory for Wrangler direct upload.
- [x] Manifest tests cover folder tree, file routes, permission rules, provider support, and minimal version history.
- [ ] Integration tests prove `publishSnapshotArtifacts` writes generated Functions and private modules beside the static asset directory before invoking Wrangler.
- [ ] Snapshot tests cover generated `site-manifest.json`, three-pane shell assets, comments seed data, and generated Pages Functions files.
- [ ] Generated Functions tests cover authenticated/unauthenticated view access, `view` versus `comment` enforcement, and path-specific permission inheritance.
- [ ] D1 API tests cover comment read/write, own-comment edit/delete policy, idempotent event writes, and malformed payload rejection.
- [ ] Sync import tests prove remote comment events become local Aside sidecar comments without modifying source Markdown.
- [ ] Author metadata tests prove Google identities render distinctly in the local Aside sidebar while current-user comments still hide the default "You" badge.
- [x] `npm run build` passes.
- [x] Release artifact inspection confirms no OAuth secret, session signing secret, D1 credentials, generated permission manifests, source maps, raw TypeScript, or local `.superpowers/` artifacts ship in `main.js`, `manifest.json`, or `styles.css`.
- [ ] Manual Cloudflare test confirms a user without permission cannot fetch protected static artifacts directly.
- [ ] Manual Cloudflare test confirms a permitted Google user can view, comment, and later see the comment imported into local Aside.

## Supersedes And Relates To

This design supersedes the access-code direction in `docs/superpowers/specs/2026-07-09-protected-publish-access-code-design.md` for the private publish feature. The user explicitly removed access codes and chose identity-based access through Google first and WeChat later.

It extends:

- `docs/superpowers/specs/2026-07-08-public-html-publish-workflow-design.md`
- `docs/superpowers/specs/2026-07-23-rendered-markdown-publish-design.md`
- `docs/superpowers/specs/2026-07-08-paid-hosted-publish-entitlement-design.md` only as background for identity concepts, not as hosted billing or hosted publishing.

Cloudflare references checked during design:

- Cloudflare Pages Direct Upload supports Wrangler deployment of an asset folder and uploading a `functions` folder with Wrangler direct upload.
- Cloudflare Pages middleware can run from `functions/_middleware.js` in front of static files.
- Cloudflare D1 is accessible from Workers and Pages Functions through bindings and prepared statements.

## Context

The current publish workflow is intentionally small: a user enables Publishing, puts publishable files under `public/`, and publishes individual Markdown, HTML, or PDF files through local Wrangler into a user-owned Cloudflare Pages project.

The new private feature changes the product shape:

- Users need to publish one file, one folder, or the whole `public/` tree.
- Published content should behave like a simplified Obsidian workspace.
- Access must be identity-based, not link-based or access-code-based.
- Different people need different permissions per file or folder.
- Signed-in viewers should be able to add comments into the published Aside sidebar.
- Those comments should later appear in local Aside without modifying original Markdown.

Because deployed visitors access the site in a browser outside Obsidian, the access and comment features must run server-side on Cloudflare. Client-side hiding is not acceptable: static files would remain directly fetchable.

## Goals

- Keep the feature user-owned: the user's Cloudflare Pages project, D1 database, OAuth credentials, and Wrangler login run the deployed site.
- Treat `public/` as the published root. Paths in user-authored publish metadata are relative to that root.
- Support publishing a single file, a folder, or the whole root.
- Use `public/index.md` as a human-readable owner inventory of published files, folders, and state.
- Use `public/auth.md` as the human-readable permission table.
- Build a three-pane published shell: folder tree, file content, Aside sidebar.
- Gate all published content with server-side identity and permission checks.
- Implement Google sign-in first.
- Keep WeChat as a first-class provider name in the data model, while deferring working WeChat OAuth.
- Let permitted viewers add page-level comments and replies.
- Import published-site comments into local Aside sidecars through the existing sync-event model.
- Preserve existing local Aside comments and seed them into the published site as read-only initial comments.

## Non-Goals

- Do not implement access codes.
- Do not build an Aside-hosted backend in this slice.
- Do not edit original Markdown from the published site.
- Do not support text-anchored comments in the published browser UI in V1.
- Do not implement working WeChat OAuth in V1.
- Do not make `full` mean source-editing access in V1.
- Do not expose `public/auth.md` or generated secret-bearing permission material as static public content.
- Do not auto-create Cloudflare D1 databases, OAuth apps, or Cloudflare secrets without an explicit later design.

## User-Owned Cloudflare Architecture

The current `wrangler pages deploy` snapshot remains the deployment mechanism. The snapshot grows from static artifacts only into a small generated full-stack Pages deployment:

```text
staging/
  _aside/
    app assets
    site-manifest.json
    comments-seed.json
  functions/
    _middleware.js
    _aside/api/auth/*
    _aside/api/comments/*
  public-facing rendered files
```

The generated Pages Functions own:

- OAuth redirects and callbacks.
- Signed session cookie creation and verification.
- Permission checks before static assets are served.
- Comment read/write APIs.
- D1 access through a configured binding.

Secrets and sensitive configuration belong in Cloudflare, not in the Obsidian plugin:

- Google OAuth client ID and client secret.
- Session signing secret.
- D1 binding configuration.
- Future WeChat OAuth configuration.

Aside should generate code and clear setup diagnostics, but it should not store Cloudflare API tokens or OAuth secrets in plugin settings.

## Auth Model

`public/auth.md` is the source of truth for published permissions. It uses a Markdown table:

```md
| provider | identity | path | permission |
| --- | --- | --- | --- |
| google | alice@example.com | / | view |
| google | bob@example.com | investors/ | comment |
| google | carol@example.com | roadmap.md | full |
| wechat | wx_openid_123 | / | view |
```

Field rules:

- `provider` is `google` or `wechat`.
- V1 enforces Google and parses WeChat as unsupported.
- `identity` is a normalized email for Google and a provider identifier for WeChat.
- `path` is relative to `public/`.
- `/` means the whole published root.
- Folder paths end in `/`.
- File paths name a file under the published root.
- `permission` is one of `view`, `comment`, or `full`.

Permission resolution:

- Folder rows inherit downward.
- More specific matching rows override broader rows for the same provider and identity.
- For equally specific rows, the strongest permission wins.
- Permission order is `view < comment < full`.
- No matching row means no access.

Permission meanings in V1:

- `view`: can read file content and existing comments.
- `comment`: can read and add or reply to page comments, and edit or delete own remote comments.
- `full`: same as `comment` for V1, with UI/data model reserved for later owner-level moderation or source-editing decisions.

The deployed middleware must check permissions server-side for static content and APIs. The browser UI can hide controls for convenience, but hidden controls are not a security boundary.

## Published Site Shell

The approved shell is the three-pane "simplified Obsidian" structure:

- Left pane: folder tree rooted at `/`, representing the selected published file or folder tree.
- Center pane: selected file content, including generated Markdown HTML, HTML artifacts, and PDFs where supported.
- Top or center chrome: file title, path breadcrumbs, current version, and version history controls.
- Right pane: Aside sidebar with page comments, replies, and add-comment controls when permitted.

This is a working app shell, not a marketing landing page. The first screen should open the highest-priority file from `public/index.md` or the first permitted file in the published tree.

`site-manifest.json` should include enough data to render the tree and choose routes without listing unauthorized content to an unauthorized user. The server remains responsible for filtering or denying by identity.

## `public/index.md`

Aside creates `public/index.md` if it is missing when publishing is enabled or a folder publish begins.

The file is owner-visible state, not the security source of truth. It should be human-readable and safe to edit around. Aside owns a marked section, for example:

```md
# Published Index

<!-- Aside publish index -->
| path | type | status | permission_source | last_published_at |
| --- | --- | --- | --- | --- |
| roadmap.md | file | published | auth.md | 2026-07-26T07:20:00.000Z |
| investors/ | folder | published | auth.md | 2026-07-26T07:20:00.000Z |
<!-- /Aside publish index -->
```

Rules:

- Create the file only when missing.
- Update only the managed section when present.
- Preserve user-authored content outside the managed section.
- Store paths relative to `public/`.
- Include folder and file publish records.
- Do not treat this file as permission data.

## File And Folder Publishing

Existing single-file publish remains available. Folder publish adds:

- publish this folder
- republish this folder
- unpublish this folder
- publish all `public/`

Publishing a folder:

1. Normalizes the target folder under `public/`.
2. Scans supported files under that folder.
3. Excludes `auth.md`, local-only state files, unsafe artifacts, and files blocked by existing artifact guards.
4. Renders Markdown to HTML.
5. Carries supported HTML and PDF artifacts.
6. Adds included files to the generated site manifest.
7. Updates `public/index.md`.
8. Deploys one complete snapshot.

Unpublishing a folder removes its files from the next deploy snapshot while preserving other published files outside the folder.

## Version Control

The user expects file version control in the published shell. V1 should expose a minimal version model that does not require remote source editing:

- Each successful publish snapshot records a version entry per included file.
- A version entry includes path, content hash, published timestamp, and deployment/version id when available.
- The shell can show current version and history metadata.
- Fetching old content is optional in the first implementation unless the snapshot generator stores versioned artifact copies.

The design should leave room for a stronger future model:

- storing versioned generated artifacts under internal immutable paths;
- showing diffs for Markdown-rendered pages;
- rolling back by republishing a previous artifact snapshot.

## Comment Model

Published comments reuse Aside's existing sync-event concept instead of modifying source Markdown.

Cloudflare D1 stores remote comment event rows. Conceptually:

```text
event_id
site_id or deployment_id
path
op
payload_json
author_provider
author_identity
author_display_name
created_at
```

Generated Pages Functions expose:

- `GET /_aside/api/comments?path=...`
- `POST /_aside/api/comments`
- later `PATCH` or `POST` operations for own-comment update/delete

Every write requires:

- authenticated session;
- matching `comment` or `full` permission for the target path;
- valid page-comment payload;
- idempotent event id or server-generated event id.

V1 published comments are page notes:

- `anchorKind: "page"`
- selected text is the page label
- no browser text-selection anchoring
- replies use `appendEntry`

The published shell should merge:

- seeded local page comments from the deploy snapshot;
- remote D1 comment events created after deploy.

Seeded local comments are read-only from the published site unless a later moderation model says otherwise.

## Local Sync Import

The plugin should add a user-owned Cloudflare comment sync path:

1. Read configured Cloudflare/D1 access settings or call an authenticated generated API endpoint.
2. Pull remote comment events since the last imported cursor.
3. Normalize remote records into Aside-compatible `SideNoteSyncEvent` values.
4. Replay them through `CommentPersistenceController.replaySyncedSideNoteEvents()`.
5. Write local sidecar JSON and update aggregate/sidebar indexes.
6. Mark imported events/cursors only after successful local persistence.

This keeps source Markdown unchanged. It also keeps the new feature aligned with existing multi-device comment sync semantics.

The import path needs clear conflict rules:

- duplicate event ids are idempotent;
- comment updates are latest-event based through existing sync reducer behavior;
- remote users can edit/delete only their own comments in the generated API;
- local owner actions can still delete or resolve imported threads later through normal Aside controls.

## Author Metadata

Current `CommentThreadEntry` stores no author. This feature needs optional author metadata:

```ts
interface CommentThreadEntryAuthor {
  provider: "local" | "google" | "wechat";
  identity: string;
  displayName?: string;
  avatarUrl?: string;
}
```

`CommentThreadEntry` should gain:

```ts
author?: CommentThreadEntryAuthor;
```

Requirements:

- preserve `author` through clone and normalization helpers;
- preserve `author` in sync-event payload normalization and reduction;
- preserve `author` in sidecar JSON;
- project `author` into sidebar presentation;
- keep local user-authored comments without `author` behaving as current-user comments;
- render remote Google comments with visible author labels;
- avoid exposing unnecessary identity data in logs.

## Cloudflare Setup And Diagnostics

Aside should not silently fail when required Cloudflare pieces are missing. Settings or publish notices should distinguish:

- Wrangler missing or not logged in.
- Pages project missing.
- D1 binding missing.
- D1 schema not initialized.
- Google OAuth client id/secret missing.
- session signing secret missing.
- unsupported WeChat provider rows present.

The first version can document manual Cloudflare setup instead of automating resource creation.

## Security Model

Important invariants:

- `auth.md` is configuration, not public content.
- Permission checks run in Cloudflare Functions before serving static files and before comment APIs.
- Static files must not bypass middleware.
- Generated server-side permission data must not be readable as static JSON.
- OAuth secrets and session signing secrets must never enter plugin settings, logs, shipped release assets, or static deployment assets.
- Published content is still readable/copyable by authorized users. This is access control, not DRM.
- Comment APIs must validate path permissions server-side on every request.
- The plugin release artifact must not contain generated site snapshots, generated secrets, or local brainstorm artifacts.

## Implementation Slices

1. Manifest and permission core.
   - Parse `auth.md`.
   - Resolve inherited permissions.
   - Create/update `index.md`.
   - Build folder publish selections.

2. Private snapshot generator.
   - Generate site manifest and shell assets.
   - Exclude `auth.md`.
   - Stage selected files/folders.
   - Preserve existing file publish behavior.

3. Generated Pages Functions auth gate.
   - Generate middleware and auth routes.
   - Implement Google session verification.
   - Enforce `view` permissions before content is served.

4. D1 comment API.
   - Generate comment routes.
   - Define D1 schema/migration guidance.
   - Enforce `comment` and `full`.

5. Local sync import and author metadata.
   - Extend comment entry author schema.
   - Pull remote events.
   - Import through sync reducer.
   - Render remote authors in Aside.

## Acceptance Criteria

- A user can publish one file, one folder, or all of `public/`.
- If `public/index.md` is missing, Aside creates it and records publish state.
- `auth.md` rows use paths relative to `public/`.
- Google identities can be granted `view`, `comment`, or `full` access to files or folders.
- Folder permissions inherit downward, and specific rows override broad rows.
- Unauthorized visitors cannot fetch protected file content directly.
- Authorized visitors see a three-pane published shell with folder tree, file content, versions, and Aside sidebar.
- Authorized commenters can add page-level comments.
- Remote comments are imported into local Aside sidecar storage without modifying source Markdown.
- Local Aside renders remote author labels.
- Existing public HTML/PDF/Markdown publish behavior remains intact for supported non-private flows.
- Release artifact inspection confirms no source maps, raw TypeScript, secrets, generated deployment secrets, or local-only files are shipped.
