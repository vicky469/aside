# Same-Note Persistence Serialization Design

**Objective:** Preserve every concurrently generated reply by serializing only the canonical persistence transaction for one note, without reducing agent or cross-note concurrency.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Reproduce the live failure from agent run `675eb783-a32d-45a4-87bd-fb05bde2cce9`.
- [x] Recover the generated reply from sync mutation history and confirm its canonical sidecar entry stayed empty.
- [x] Confirm two persistence operations for the same note began in the same millisecond.
- [x] Trace `Destination file already exists!` to concurrent temp-file replacement of the same sidecar path.

### To Implement

- [ ] Serialize canonical comment persistence by note path in `CommentPersistenceController`.
- [ ] Read the latest `CommentManager` thread state only after a queued persistence operation begins.
- [ ] Clean completed queue entries without allowing one completion to delete a newer queued tail.
- [ ] Keep different note paths and all agent runtimes concurrent.
- [ ] Keep sidecar encoding and the source/path sidecar format unchanged.

### Verification

- [ ] A deterministic regression test reproduces overlapping same-note saves before the fix.
- [ ] Two overlapping same-note saves complete without a rename collision and persist the newest thread state.
- [ ] Different-note saves can enter persistence concurrently.
- [ ] Existing sidecar, comment persistence, agent controller, and sync tests pass.
- [ ] Typecheck, lint, complete build, and release artifact inspection pass.
- [ ] The verified build is installed in `lean-startup`, reloaded, and its three shipped assets match byte-for-byte.

## Confirmed Problem

The Parallels agent run completed normally and produced a valid answer. At `2026-09-03T13:03:26.796Z`, the live log recorded two `storage.note.write.begin` events for the same Markdown note. Both persistence operations used the same source and path sidecar destinations. The sidecar writer creates a unique temporary file, removes the current destination, and renames the temporary file into place. Interleaving two replacements lets one operation recreate the destination after the other removes it, so the second rename fails with `Destination file already exists!`.

The mutation history retained both the successful UTM reply update and the attempted Parallels reply update, but the canonical Parallels sidecar entry remained empty. The visible `Couldn't save reply` state was therefore accurate: generation succeeded and durable canonical persistence failed.

The current `FakeAdapter.rename` in sidecar tests silently overwrites an existing destination, unlike the live Obsidian adapter. Existing tests cannot reproduce this failure.

## Chosen Design

`CommentPersistenceController` owns one promise tail per note path. Every call to `persistCommentsForFile` joins that note's tail and executes the complete canonical persistence transaction in arrival order. The transaction includes reading current note and thread state, generating sync events, updating source and path sidecars, compacting snapshots, and refreshing derived views.

The queue key is the canonical file path. It is not global, thread-level, agent-level, or provider-level. Agent runtimes continue in parallel. Multiple agent replies for one note may finish together; only their short durable commit sections wait for one another. Writes for different notes remain parallel.

The queued callback reads `CommentManager` only when it starts. It must not capture a thread snapshot before waiting, because an older queued snapshot could overwrite a reply that completed later. Since the manager state is cumulative, an earlier queued callback may already persist all current replies; the next callback then produces either a no-op sync diff or repeats the newest canonical state safely.

Queue cleanup uses identity comparison: a finishing promise deletes the path entry only when it is still the registered tail. This prevents an earlier completion from exposing the path while a newer operation remains queued. A rejected operation does not poison the queue; the next operation starts after the rejection is contained, while the original caller still receives its error.

`SidecarCommentStorage` remains the shared atomic file adapter for runtime, sync replay, migrations, and helper-backed writes. Its format and source/path dual-write behavior do not change. The controller-level queue is preferred over a storage-only mutex because it orders the entire canonical transaction and refreshes state after waiting, rather than merely preventing two rename calls from overlapping.

## Alternatives Considered

### Serialize only `SidecarCommentStorage.writeStoragePath`

This prevents the exact rename collision, but callers may already have captured stale thread lists and sync-event diffs. A later lock holder could overwrite newer canonical data. Rejected as incomplete.

### Retry `remove` plus `rename` when the destination exists

A blind retry can make the error disappear by overwriting the winning file with stale data. It also does not order sync events, snapshots, or derived refreshes. Rejected as the primary fix. A future guarded recovery may reload and merge canonical state, but it is unnecessary for the confirmed in-process race.

### Use one global persistence queue

This is simple but makes unrelated notes block each other, increasing save latency across the vault. Rejected because the collision domain is one note/storage identity.

## Data Flow

1. Agent A and agent B continue generating concurrently.
2. Agent A completes and requests persistence for note N; N's queue begins the canonical transaction.
3. Agent B completes and requests persistence for N; its transaction waits behind A without blocking rendering or either runtime.
4. A writes the latest manager state available when A begins and completes its source/path sidecars and sync snapshot.
5. B begins, rereads the now-current manager state, and persists the cumulative state.
6. Both callers complete without overlapping sidecar replacement. The final sidecars contain both replies.
7. A save for note M may execute alongside either N transaction.

## Failure Handling

- A persistence failure rejects only its caller and is logged through the existing failure path.
- The per-note tail absorbs the prior rejection for scheduling purposes so later saves are not permanently blocked.
- The optimistic agent card continues to retain the generated answer and display `Couldn't save reply` when its own canonical mutation fails.
- No filesystem error text is promoted into normal user-facing status copy.
- Disposal stops accepting meaningful work through existing controller guards; settled queue entries release their references.

## Testing

Add a deterministic concurrency adapter at the controller test seam. It should reject rename when the destination exists and hold the first same-note replacement until a second persistence request is queued. Before implementation, the test must reproduce `Destination file already exists!`. After implementation, both promises must resolve and reloaded sidecars must contain the newest cumulative thread state.

Add a separate concurrency probe using two note paths. Hold note A inside its transaction and assert note B reaches its write boundary before A is released. This prevents a later refactor from turning the keyed queue into a global lock.

Keep direct sidecar tests focused on atomic encoding, missing-file cleanup, source/path locations, and adapter behavior. The real bug requires multiple canonical callers and belongs at the controller seam.

## Scope

Included: per-note canonical persistence serialization, latest-state capture after queue acquisition, rejection recovery, queue cleanup, same-note regression coverage, and cross-note concurrency coverage.

Excluded: limiting concurrent agents, changing agent status UX, changing sidecar or sync schemas, adding visible retry UI, recovering historical failed replies automatically, and coordinating multiple Obsidian processes or devices writing the same vault simultaneously.
