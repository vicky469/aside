# Mobile To macOS Codex Bridge Spec

## Status

Draft implementation spec.

Related docs:

- [agent-cross-platform-runtime-spec.md](agent-cross-platform-runtime-spec.md)
- [../todo/todo-codex-desktop-vs-mobile-support.md](../todo/todo-codex-desktop-vs-mobile-support.md)

## Objective

Define a concrete remote runtime path so that:

1. a user on Obsidian mobile can type `@codex`
2. SideNote2 routes that run to a specific macOS machine
3. that macOS machine launches the same local `codex` CLI family that desktop SideNote2 uses today
4. the remote macOS machine returns reply text only
5. SideNote2 on the user's device writes that reply back into the original markdown thread

This is a user-facing mobile spec.
That means the route must stay simple, safe, and non-destructive.

## Final Product Rule

User-facing mobile access must be reply-only.

The remote macOS machine must not:

- inspect the user's repo or vault files
- modify markdown note bodies directly
- modify project files directly
- resolve or rely on a repo working directory

The remote macOS machine may:

- receive the final prompt text and SideNote2 context
- generate reply text
- stream progress and partial output
- return final reply text to the plugin

SideNote2 on the client remains responsible for:

- canonical note writes
- appending the reply into the original SideNote2 thread
- preserving the source markdown as the source of truth

## Core Question

The original architectural question was:

> How does a mobile-triggered run know which working directory to use if mobile does not have the local filesystem path?

For the user-facing mobile route, the answer is:

- it does not need a working directory at all

Why:

- this route is reply-only
- the remote Mac is compute, not workspace ownership
- the plugin sends enough context for the reply
- the plugin itself writes the reply back into the note

So:

- no remote `cwd`
- no remote vault-path mapping
- no remote repo access

## Why This Spec Exists

The generic cross-platform runtime spec already defines a reply-only remote bridge.

This macOS-specific spec exists to answer:

- how to use one specific Mac as the remote execution owner
- what the remote Mac is allowed to do
- what context the plugin must send
- how the reply gets back into the original markdown note safely

## Relationship To Desktop Local Codex

Desktop-local `@codex` today is workspace-aware.

It can resolve a local working directory and use the actual repo or vault context on the desktop machine.

The user-facing mobile-to-macOS route should not try to reproduce that behavior.

Instead:

- desktop local = workspace-aware local execution
- mobile to Mac = reply-only remote execution

This is intentional.
It is the safer user-facing boundary.

## Recommended Architecture

Preferred deployment:

```text
Obsidian mobile
  -> SideNote2 remote bridge client
  -> HTTPS bridge running on the target Mac
  -> local codex CLI on that same Mac
  -> streamed progress + final reply text
  -> SideNote2 appends the reply into the original thread
```

Why this is preferred:

- simple deployment model
- no second transport layer
- the Mac acts only as compute
- no need to mirror the vault onto the Mac

Optional deployment:

```text
Obsidian mobile
  -> SideNote2 remote bridge client
  -> HTTPS bridge / relay
  -> SSH target session on the Mac
  -> local codex CLI on the Mac
```

Use the SSH deployment only if:

- the bridge cannot run on the Mac directly
- or the user wants one central relay that can target multiple hosts

## What Context The Client Sends

The mobile client can safely send:

- vault name
- note path relative to the vault root
- selected text or section context already included in the final prompt
- thread transcript already included in the final prompt
- final prompt text built by SideNote2
- plugin metadata needed for run display and debugging

The remote Mac must not need:

- the Mac's absolute vault path
- the user's repo path
- local file reads from the vault
- a writable working directory for project edits

## Bridge Request Contract

The existing remote runtime contract is already close to what this route needs.

The important rule is:

- the payload should carry final prompt text and lightweight metadata
- the bridge should not treat `notePath` as permission to open files

Recommended metadata shape:

```ts
interface MobileMacBridgeMetadata {
  vaultName: string;
  notePath: string;
  contextScope: "anchor" | "section";
  pluginVersion: string;
  capability: "reply-only";
}
```

## Capability Model

This route is reply-only.

That means:

- it can answer
- it can summarize
- it can explain
- it can suggest edits

That also means:

- it cannot safely inspect neighboring repo files
- it cannot safely make project changes
- it cannot safely patch the original note body outside the SideNote2 thread

The right user-facing capability label is:

- `reply-only on your Mac`

## Runtime Ownership

The Mac owns:

- local `codex` installation
- local `codex` authentication or sign-in
- runtime process execution

The phone and plugin own:

- UI
- canonical save trigger
- prompt construction
- run display
- canonical thread write-back into the markdown note

## Prompt Construction

SideNote2 should keep building the final prompt locally on the client.

That prompt should already contain enough context for a high-quality reply:

- selected text or section excerpt
- nearby headings where relevant
- thread transcript
- current request text

The remote Mac should receive that final prompt and generate a reply from it.

## How The Reply Gets Into The Original Markdown

This is the key behavior:

1. user types `@codex` on mobile
2. SideNote2 saves the user entry into the canonical note
3. SideNote2 sends final prompt text to the remote Mac
4. remote Mac returns reply text only
5. SideNote2 appends that reply as a normal thread entry in the original markdown note

So the remote machine does not edit the note directly.
The plugin does.

This is why the remote host does not need repo or vault access for the user-facing mobile path.

## Failure Modes

The macOS bridge must return explicit user-safe errors for these cases.

### Missing Codex runtime

Example:

- bridge is healthy
- but `codex` is not installed or not signed in on the Mac

Return:

- a concise runtime notice derived from the same style as desktop diagnostics

### Bridge unavailable

Example:

- the phone cannot reach the Mac bridge

Return:

- a concise network or availability notice

### Invalid token

Example:

- the bridge token is missing or rejected

Return:

- a concise auth notice

## Detailed Setup Steps

### Phase 1: Prepare the target Mac

1. Install and verify the local `codex` CLI on the Mac.
2. Verify:

```bash
codex --help
```

3. Make sure the Mac can stay reachable over LAN, VPN, or Tailscale.

### Phase 2: Run the bridge on the Mac

1. Start a small HTTPS service on the Mac.
2. Implement the existing SideNote2 remote endpoints:
   - `POST /v1/sidenote2/runs`
   - `GET /v1/sidenote2/runs/{runId}?after=<cursor>`
   - `POST /v1/sidenote2/runs/{runId}/cancel`
3. Make the bridge launch `codex` locally on the Mac.
4. Protect the bridge with a dedicated bearer token.

### Phase 3: Configure mobile SideNote2

1. In SideNote2 settings on mobile, open `Advanced Remote Bridge`.
2. Enter the Mac bridge HTTPS URL.
3. Enter the bridge token.
4. Trigger a new `@codex` thread.

### Phase 4: Validate behavior

Use these tests:

1. new `@codex` thread on mobile
   Expected:
   - remote run starts
   - progress can stream
   - final reply is appended into the original SideNote2 thread

2. bridge unreachable
   Expected:
   - clear failure notice

3. invalid token
   Expected:
   - clear auth failure notice

4. no Codex on the Mac
   Expected:
   - clear runtime failure notice

## Security Rules

- never let the remote Mac edit the repo or vault for this user-facing mobile path
- never store the bridge token in synced notes
- never expose the bridge publicly without auth
- prefer Tailscale, LAN, or another private-network path over public exposure

## What This Spec Does Not Solve

This spec does not solve:

- OpenAI account entitlement discovery on mobile
- official subscription reuse
- workspace-aware repo editing from mobile
- cross-device background run migration

It solves:

- mobile-triggered `@codex` replies through a specific Mac
- safe canonical write-back into the original markdown thread
- a user-facing mobile path that does not require repo access

## Recommendation

Keep the mobile-to-macOS route reply-only.

If a future advanced power-user mode wants workspace-aware remote editing on a Mac, that should be a separate non-default spec with stronger safety and mapping rules, not part of the normal mobile user-facing path.
