# Mobile To DGX Vault-Backed Codex Spec

## Status

Superseded. Do not implement this model.

This document assumes a synced vault copy on the DGX host. That is now a hard
non-starter. The active replacement is
[mobile-to-dgx-plugin-mediated-obsidian-api-spec.md](mobile-to-dgx-plugin-mediated-obsidian-api-spec.md),
which keeps the vault on the client device and routes reads and writes through
the plugin's Obsidian API surface instead of a DGX-side vault root.

This spec captures the intended product direction for the DGX-backed mobile path.
It supersedes the reply-only assumption in
[mobile-to-dgx-codex-bridge-spec.md](mobile-to-dgx-codex-bridge-spec.md)
for this deployment model.

Related docs:

- [agent-cross-platform-runtime-spec.md](agent-cross-platform-runtime-spec.md)
- [agent-dgx-spark-bridge-spec.md](agent-dgx-spark-bridge-spec.md)
- [mobile-to-dgx-codex-bridge-spec.md](mobile-to-dgx-codex-bridge-spec.md)
- [agent-mentions-spec.md](agent-mentions-spec.md)

## Objective

Define a DGX-backed remote runtime path so that:

1. a user on Obsidian mobile can type `@codex`
2. SideNote2 routes that run to a DGX-hosted bridge
3. the DGX runs the same `codex` CLI family desktop local uses today
4. the DGX operates against a real synced copy of the user's Obsidian vault
5. the remote runtime can inspect and edit the active vault markdown file directly
6. SideNote2 keeps the same thread UX and still records the run reply in the thread

The intended behavior is close to desktop local, not reply-only.
The important difference is that the filesystem lives on the DGX-hosted synced vault copy instead of on the phone.

## Product Intent Correction

The earlier mobile-to-DGX spec assumed:

- reply-only remote execution
- no vault-path mapping
- no remote vault access

That is not the intended product for this deployment.

The intended product is:

- workspace-aware remote execution against a synced vault copy
- remote file inspection and file edits under that vault root
- active-note targeting based on the mobile client's current note
- remote compute on the DGX, with the vault copy acting as the working filesystem

## Final Decisions

- The DGX deployment gets a real vault root:
  - `SIDENOTE2_DGX_VAULT_ROOT=/path/to/synced-vault`
- Mobile sends the vault-relative note path plus note revision metadata.
- The bridge resolves that path under the configured vault root and rejects traversal outside it.
- The DGX runtime resolves its working directory using the same policy as desktop local:
  - nearest git repo within the vault root
  - else the note folder
  - else the vault root
- Remote Codex may inspect and edit files under the configured vault root.
- The bridge must not allow arbitrary access outside the configured vault root.
- SideNote2 still owns run UI, polling, token storage, and the persisted thread reply entry.
- SideNote2 thread mutations are special:
  - they must use safe thread-aware helpers
  - they must not raw-edit the `<!-- SideNote2 comments -->` block ad hoc
- This mode is advanced and intentionally more powerful than the earlier reply-only concept.

## Non-Goals

Not part of this spec:

- arbitrary filesystem access outside the configured vault root
- editing unrelated server files
- public multi-tenant bridge hosting
- zero-conflict concurrent editing across unsynced devices
- automatic reconciliation of conflicting mobile-vs-DGX note writes
- general repo editing outside the synced vault

## Deployment Model

Required deployment shape:

```text
Obsidian mobile
  -> SideNote2 remote bridge client
  -> HTTPS bridge on DGX
  -> local codex app-server process on DGX
  -> synced writable vault copy on DGX
  -> remote file reads and writes under that vault root
  -> final reply text back to SideNote2 thread
```

Assumption:

- the DGX has a writable, reasonably up-to-date copy of the same Obsidian vault the phone is using

Examples:

- Obsidian Sync
- Syncthing
- another explicit file-sync mechanism

Without a synced vault copy on the DGX, this mode is unavailable.

## Runtime Ownership

The phone and plugin own:

- current note identity
- current note save trigger
- prompt construction
- run UI
- polling and cancel
- persisted thread reply entry
- device-local bridge token storage

The DGX owns:

- `codex` installation and auth
- process execution
- server-side file inspection and editing under the synced vault root
- working-directory resolution
- bridge-side safety checks

## Vault Root Configuration

Add a dedicated DGX vault-root setting:

```bash
SIDENOTE2_DGX_VAULT_ROOT=/srv/sidenote2/vault
```

Keep the existing bridge runtime root separate:

```bash
SIDENOTE2_DGX_WORKSPACE_ROOT=/srv/sidenote2/bridge-runtime
```

Recommended interpretation:

- `SIDENOTE2_DGX_WORKSPACE_ROOT`
  - bridge process files
  - temporary runtime state
  - bridge-side logs or caches
- `SIDENOTE2_DGX_VAULT_ROOT`
  - the writable synced Obsidian vault copy that Codex may inspect and edit

## Client To Bridge Metadata

The mobile client should send enough metadata for the DGX to target the correct note and verify freshness.

Recommended metadata shape:

```ts
interface VaultBackedDgxMetadata {
  vaultName: string;
  vaultRelativePath: string;
  contextScope: "anchor" | "section";
  pluginVersion: string;
  capability: "workspace-aware-vault";
  noteHash: string;
  noteHashAlgorithm: "sha256";
  triggerEntryId: string;
}
```

Notes:

- `vaultRelativePath` identifies the active source markdown file relative to `SIDENOTE2_DGX_VAULT_ROOT`
- `noteHash` is computed from the saved note content on the mobile client after the triggering entry is persisted
- the bridge must treat metadata as targeting input, not as direct filesystem permission

## Path Resolution Rules

The bridge resolves the note like this:

1. normalize `vaultRelativePath`
2. reject absolute paths
3. reject `..` traversal that escapes the vault root
4. join the normalized relative path onto `SIDENOTE2_DGX_VAULT_ROOT`
5. verify the final absolute path still sits under the vault root

If any step fails, the bridge returns a user-safe error and does not start Codex.

## Sync And Revision Rules

Because the DGX is editing a synced vault copy, revision checks are required.

Pre-run rule:

1. SideNote2 saves the triggering entry into the canonical mobile note.
2. SideNote2 reads the saved note content and computes `noteHash`.
3. The bridge reads the corresponding DGX note file and computes the same hash.
4. If the hashes do not match, the bridge fails the run before Codex starts.

Recommended error meaning:

- `The DGX vault copy is not yet in sync with this note on this device.`

This is safer than letting Codex edit a stale file and creating a sync conflict later.

## Working Directory Resolution

Working-directory selection should mirror desktop local behavior.

For the resolved absolute note path:

1. walk upward until the vault root
2. if a `.git` directory is found, use that repo root
3. otherwise use the note's containing folder
4. if that cannot be resolved safely, use the vault root

This keeps remote Codex scoped to the active note's actual neighborhood rather than forcing every run to start at the whole vault or an unrelated bridge directory.

## Capability Model

This mode is workspace-aware within the synced vault.

That means the DGX runtime may:

- read the active note directly
- read neighboring notes under the vault root
- edit the active note directly
- create or modify related vault files under the vault root
- use the active note's nearest repo root if one exists inside the vault

That does not mean:

- arbitrary host access outside the vault root
- arbitrary edits outside the configured root
- automatic permission to mutate SideNote2 thread storage ad hoc

## Note And Thread Write Rules

There are two classes of write:

### 1. General vault markdown edits

Allowed:

- direct file edits under `SIDENOTE2_DGX_VAULT_ROOT`
- including edits to the active markdown note body

Examples:

- rewrite the active note
- insert a section
- reorganize headings
- create a sibling note

### 2. SideNote2 thread mutations

Special handling required.

Rules:

- do not patch the serialized SideNote2 comments block by free-form text editing
- use safe thread-aware helpers for create, append, update, resolve, or other comment-thread mutations
- preserve the markdown note as the canonical source of truth

Practical implication:

- normal note-body editing can use direct file tools
- SideNote2 thread operations should go through dedicated helpers or bridge-owned wrappers

## Bridge Behavior

Start-run behavior:

1. authenticate bearer token
2. require configured DGX vault root
3. resolve and validate the target note path
4. compare client `noteHash` with the DGX copy
5. resolve runtime working directory from the target note path
6. launch `codex app-server --listen stdio://`
7. run against the resolved vault-backed working directory
8. stream progress and output deltas back to the client
9. return final reply text for SideNote2 thread persistence

The bridge should expose the active note context to Codex via environment or wrapper metadata as needed, for example:

```text
SIDENOTE2_ACTIVE_VAULT_ROOT=/srv/sidenote2/vault
SIDENOTE2_ACTIVE_NOTE_PATH=/srv/sidenote2/vault/Folder/Note.md
SIDENOTE2_ACTIVE_NOTE_RELATIVE_PATH=Folder/Note.md
```

## Prompt And Tooling Model

Prompt construction still starts on the client.

The client should continue sending:

- current SideNote2 prompt text
- thread transcript context
- nearby note context already assembled by the plugin

But unlike the reply-only design, the DGX runtime may also inspect files directly under the synced vault root.

So this mode combines:

- client-built thread context
- server-side vault-backed file access

This is intentionally closer to desktop local behavior.

## Remote Reply Contract

Even when the DGX edits vault files directly, it should still return a final reply text string for the SideNote2 thread.

Reason:

- keep the current thread UX
- make remote changes auditable in the thread
- preserve existing run lifecycle and retry behavior

Recommended reply content:

- what changed
- which note or files changed
- any follow-up or conflict warning

## Security Rules

- the bridge must reject any target path outside `SIDENOTE2_DGX_VAULT_ROOT`
- the Codex sandbox should restrict file writes to the configured vault root and any minimal bridge-runtime directory it truly needs
- the bridge token remains device-local on the client
- the bridge must not expose the vault root over unauthenticated public transport
- raw note content, thread content, and bearer tokens must not be logged

## Failure Modes

The bridge must return explicit, user-safe failures for:

### DGX vault root missing

- bridge deployment is incomplete
- no writable synced vault root is configured

### Note path invalid

- target path is malformed
- target path escapes the vault root

### Note not present on DGX

- the mobile note exists
- but the DGX vault copy does not yet contain it

### Vault out of sync

- the DGX note hash does not match the mobile-saved hash

### Codex unavailable

- `codex` is missing
- `codex` is not signed in
- runtime launch fails

### Thread helper violation

- a requested thread mutation would require raw editing of the serialized SideNote2 comments block without using safe helpers

## Plugin Requirements

The mobile plugin should do the following before dispatch:

1. save the triggering entry into the canonical note
2. read the saved note content
3. compute `noteHash`
4. send `vaultRelativePath`, `noteHash`, and prompt/context metadata
5. keep the existing run UI, polling, cancel, and persisted thread-reply flow

The plugin does not need direct access to the DGX filesystem.
It only needs stable note identity and revision metadata.

## DGX Bridge Requirements

The DGX bridge should add:

1. configured `SIDENOTE2_DGX_VAULT_ROOT`
2. secure path resolution under that root
3. note-hash verification before runtime start
4. working-directory resolution based on the resolved note path
5. guardrails for vault-root-only file access
6. safe helper routing for SideNote2 thread mutations

## Acceptance Criteria

This spec is satisfied when:

1. a mobile user can trigger `@codex` on a vault note
2. the DGX resolves that note inside its synced vault copy
3. Codex can inspect and edit the active note directly on the DGX vault copy
4. the runtime working directory matches desktop-local resolution semantics
5. the final reply is still appended into the SideNote2 thread
6. a stale or unsynced DGX note copy is detected and blocked before Codex starts
7. writes cannot escape the configured vault root
8. SideNote2 thread-specific mutations do not rely on ad hoc raw text patching

## Recommendation

Treat this as the intended advanced DGX-backed mobile mode for users who want desktop-local-style power against a synced vault.

Keep the older reply-only concept only as a simpler alternative mode, not as the defining assumption for the DGX deployment this repo is targeting.
