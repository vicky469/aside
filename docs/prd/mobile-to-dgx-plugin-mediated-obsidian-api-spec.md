# Mobile To DGX Plugin-Mediated Obsidian API Spec

## Status

Draft implementation spec.

This spec supersedes
[mobile-to-dgx-vault-backed-codex-spec.md](mobile-to-dgx-vault-backed-codex-spec.md)
for the actual product direction.

Related docs:

- [agent-cross-platform-runtime-spec.md](agent-cross-platform-runtime-spec.md)
- [agent-dgx-spark-bridge-spec.md](agent-dgx-spark-bridge-spec.md)
- [mobile-to-dgx-codex-bridge-spec.md](mobile-to-dgx-codex-bridge-spec.md)

## Hard Requirement

The DGX host must not require:

- a synced copy of the user's Obsidian vault
- a mounted vault root
- direct filesystem ownership of the mobile vault
- direct access to the Obsidian API

The vault remains on the client device.
All vault reads and writes happen on the client through SideNote2 using
Obsidian APIs.

## Objective

Define a DGX-backed remote runtime path so that:

1. a user on Obsidian mobile can type `@codex`
2. SideNote2 routes the run to a DGX-hosted bridge
3. DGX provides remote compute and agent reasoning
4. DGX can request note reads and note writes through a plugin-mediated tool protocol
5. the plugin executes approved vault operations locally through Obsidian APIs
6. the user gets near-desktop behavior without exposing the vault filesystem to the DGX

## Product Model

The correct model is:

- remote decides
- plugin executes vault operations
- vault remains client-owned

Not:

- DGX mounts the vault
- DGX edits markdown files directly
- DGX depends on `SIDENOTE2_DGX_VAULT_ROOT`

## Architecture

### Roles

- `SideNote2 mobile plugin`
  - canonical vault owner
  - builds initial prompt context
  - executes vault reads and writes through Obsidian APIs
  - applies SideNote2 thread mutations through existing safe helpers
- `DGX bridge`
  - authenticates runs
  - hosts remote Codex execution
  - relays tool requests and tool results
  - never gets direct vault filesystem access
- `Codex on DGX`
  - reasons over note context
  - requests additional reads or writes through the bridge protocol
  - returns final thread reply text

### Transport Shape

The existing remote run flow is poll-based.
To support plugin-mediated tools, the bridge protocol must grow from:

- `progress`
- `output_delta`
- `completed`
- `failed`
- `cancelled`

to also support:

- `tool_call`
- `tool_result_ack`
- optionally `tool_call_cancelled`

The plugin polls the bridge, sees a pending tool call, executes it locally, then
POSTs the result back to the bridge so the remote run can continue.

## Run Lifecycle

1. User saves a SideNote2 entry in the active note.
2. Plugin builds initial prompt context from the active note and thread.
3. Plugin starts a remote run with:
   - prompt text
   - active note path
   - active note snapshot hash
   - thread identifiers
   - declared client tool capabilities
4. DGX starts Codex.
5. If Codex needs more vault access, the bridge emits a `tool_call`.
6. Plugin executes that tool locally through Obsidian APIs.
7. Plugin sends the tool result to the bridge.
8. DGX continues until it returns final reply text.
9. Plugin writes the final reply back into the SideNote2 thread locally.

## Client Tool Contract

Initial recommended tool surface:

- `obsidian.get_active_note`
  - returns active note path and full current content
- `obsidian.read_note`
  - input: `vaultRelativePath`
  - returns file content for a markdown note
- `obsidian.list_folder`
  - input: `vaultRelativeFolder`
  - returns child notes/folders for local context discovery
- `obsidian.replace_active_note`
  - input: full replacement text
  - replaces the active note body locally
- `obsidian.patch_active_note`
  - input: structured patch or targeted range replacement
  - applies local edits to the active note
- `obsidian.create_note`
  - input: target path and initial content
  - creates a note in the vault locally
- `sidenote2.append_thread_reply`
  - appends a reply entry using existing thread helpers
- `sidenote2.update_thread_entry`
  - updates an existing comment entry safely
- `sidenote2.resolve_thread`
  - resolves the active thread safely

## Rules For Writes

### General note writes

Allowed only through plugin-mediated tool calls.

The DGX may request:

- rewrite active note
- insert or replace a section
- create a sibling note

The plugin performs the actual write locally.

### SideNote2 thread writes

Must keep using safe helpers.

The DGX must not request free-form edits to the serialized
`<!-- SideNote2 comments -->` block.

## Request and Event Shapes

Recommended remote start metadata:

```ts
interface ClientMediatedDgxMetadata {
  vaultName: string;
  activeFilePath: string;
  contextScope: "anchor" | "section";
  pluginVersion: string;
  capability: "workspace-aware-plugin-tools";
  noteHash: string;
  noteHashAlgorithm: "sha256";
  triggerEntryId: string;
  clientToolApiVersion: 1;
}
```

Recommended bridge event shape for a tool call:

```ts
interface RemoteToolCallEvent {
  type: "tool_call";
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
}
```

Recommended client response:

```ts
interface RemoteToolResultSubmission {
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
```

## Security Constraints

- DGX must not receive direct vault-root filesystem access.
- Plugin must validate every tool call before executing it.
- Tool execution must stay scoped to the current vault.
- Dangerous or unsupported operations must fail closed.
- The bridge bearer token still protects remote run creation.
- Thread and note writes remain local-device actions.

## UX Expectations

- If mobile is backgrounded and cannot execute tool calls, the run may pause.
- If a tool call fails, the bridge should surface a user-safe failure message.
- Final thread replies should still feel like normal SideNote2 agent replies.
- Settings remain the same core pair:
  - remote bridge base URL
  - remote bridge token

## Non-Goals

Not part of this spec:

- DGX-side synced vault copies
- `SIDENOTE2_DGX_VAULT_ROOT`
- direct DGX filesystem edits to the vault
- exposing arbitrary Obsidian APIs remotely
- general-purpose remote shell access to the phone

## Implementation Phases

### Phase 1

- add `tool_call` and `tool_result` support to the remote bridge protocol
- support read-only tools first:
  - active note read
  - note read by path
  - folder listing

### Phase 2

- add plugin-mediated write tools for active note edits
- keep write scope narrow and explicit

### Phase 3

- add safe SideNote2 thread mutation tools
- improve resumability and cancellation around in-flight tool calls

## Immediate Engineering Direction

1. Keep the existing bridge foundation commit.
2. Do not reintroduce `SIDENOTE2_DGX_VAULT_ROOT`.
3. Treat the reverted vault-backed implementation as rejected.
4. Extend the run protocol for bridge-to-plugin tool calls.
5. Start with read tools before note-write tools.
