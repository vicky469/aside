# Async Vault Script Feedback Design

## Summary

Aside will make vault-script execution feel immediate by appending an empty script reply as soon as a registered script directive is accepted. The existing queued/running spinner will appear on that reply while execution continues in the background, and the same reply will be replaced in place with the final result or failure.

The `english-to-chinese` vault script will reduce total translation time by splitting work into bounded batches and running up to four Codex processes concurrently. It will preserve source order and write each Simplified Chinese translation directly beneath its English paragraph without a blank line between the two languages.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Script-run records already distinguish queued, running, succeeded, and failed states.
- [x] The sidebar already renders the existing turning icon for queued and running script results when a run has an output entry.
- [x] Agent runs already establish the intended interaction pattern by appending an empty output entry before starting background execution.
- [x] Script execution already runs outside the saved-comment call site, so the saved user entry does not synchronously block the Obsidian UI.
- [x] `english-to-chinese.mjs` already validates the source note before applying all translations in one atomic write.

### To Implement

- [ ] Append an empty script output entry immediately after persisting an accepted queued run.
- [ ] Associate the queued run with that output entry, refresh the sidebar, and return from saved-entry routing without awaiting script completion.
- [ ] Execute queued scripts in the background and replace their existing output entry in place on success or failure.
- [ ] Keep rejected directives synchronous and final because they do not launch a script.
- [ ] Split `english-to-chinese` translation work into batches of at most six paragraphs or 3,000 source characters.
- [ ] Run at most four translation batches concurrently while preserving original paragraph order.
- [ ] Replace the synchronous Codex subprocess call with an asynchronous, shell-free child-process adapter.
- [ ] Render each English paragraph followed immediately by its Simplified Chinese translation, with no blank line inside the bilingual pair and normal paragraph spacing between pairs.
- [ ] Preserve the translation script's source-change check and single atomic note write after every batch succeeds.

### Verification

- [ ] Controller tests prove the pending script reply is appended and rendered before a deferred runtime completes.
- [ ] Controller tests prove success and failure edit the pending reply instead of appending a second result.
- [ ] Controller tests prove saved-entry routing returns while execution is still pending and continues to bypass agent routing.
- [ ] Translation-script tests under the vault's `🛠️ scripts/tests/` folder prove bounded concurrency, ordered results, and bilingual paragraph adjacency.
- [ ] Existing script-controller, sidebar, routing, runtime, and translation-script tests pass.
- [ ] The Aside build and full automated test suite pass.
- [ ] A built-plugin smoke test confirms a pending reply appears on the first sidebar refresh after save, targeting approximately 0.2 seconds under normal local conditions.

## Goals

- Give immediate visible acknowledgement that a vault script was accepted.
- Reuse the same turning-icon interaction users already see for agent replies.
- Reduce `english-to-chinese` wall-clock translation time without exposing partial note updates.
- Keep English and Chinese visually paired.
- Preserve deterministic ordering, failure reporting, and atomic note updates.

## Non-Goals

- Guaranteeing that AI translation itself completes within 0.2 seconds.
- Streaming partial translation text into the note.
- Writing each completed batch to the note independently.
- Launching an unbounded process per paragraph.
- Changing mention recognition, script discovery, or actionable-mention policy.
- Changing the global serial queue policy for separate vault-script invocations.

## Aside Run Lifecycle

When a saved entry resolves to a registered vault script, the controller will persist the queued run, append an empty thread entry directly after the trigger entry, save that entry id as `outputEntryId`, and refresh the comment views. The existing sidebar association between `outputEntryId` and a queued/running script run will provide the `Script` author label and turning icon without introducing a second loading component.

After this durable pending state exists, the controller will enqueue execution and return `true` to saved-entry routing without awaiting the runtime. This preserves script ownership of the directive, prevents agent fallback, and makes the pending reply visible independently of execution duration. The controller's queue will continue to serialize distinct vault-script invocations as it does today.

Execution will read the current stored run so it uses the persisted `outputEntryId`. When the child process finishes, the controller will edit that entry with the formatted result and terminalize the run. A failure follows the same path: edit the pending entry with the concise failure body, mark the run failed, and refresh once. No second result entry is appended.

Rejected directives remain unchanged: because no background runtime starts, Aside can append their final failure response immediately without a transient spinner.

## Translation Execution

`english-to-chinese.mjs` will keep its paragraph extraction and response validation boundaries. Its batching limit will change from one large request of up to 24 paragraphs or 12,000 characters to batches of at most six paragraphs or 3,000 characters. A bounded concurrency helper will start at most four batch workers and return results in input order regardless of completion order.

The Codex invocation will remain shell-free and ephemeral but will use an asynchronous child-process API instead of `spawnSync`. Standard input, output, standard error, exit errors, and missing-executable errors will retain the current behavior. If any batch fails or returns an invalid response, the script will fail without modifying the note.

After all batches succeed, their ordered translations will be flattened. The script will re-read the note, reject a concurrent source change, and perform one atomic replacement exactly as it does today.

## Bilingual Formatting

Each source paragraph and translation will form one bilingual pair:

```markdown
English paragraph.
Simplified Chinese paragraph.

Next English paragraph.
Next Simplified Chinese paragraph.
```

There is no empty line between an English paragraph and its Chinese translation. Existing paragraph separation remains between bilingual pairs so adjacent source paragraphs do not collapse into one block.

## Error Handling

- Failure to append or associate the pending reply will fail the run and prevent execution, because execution without visible durable state would violate the immediate-feedback contract.
- Runtime success and failure will both replace the pending entry in place.
- A translation batch failure will cancel the overall result, leave the note unchanged, and surface the existing concise script failure reply.
- A source note changed during translation will remain unchanged by the script and produce the existing retryable error.
- The four-worker limit bounds local CPU, memory, subprocess, and API pressure.

## Testing Strategy

Aside controller tests will use a deferred runtime promise to prove that the output entry, run association, and refresh happen before execution resolves. They will also assert that saved-entry routing returns promptly, that only one output entry exists, and that terminal success or failure edits it in place.

Translation tests will remain under the active vault's `🛠️ scripts/tests/` directory. Pure injected-worker tests will prove the concurrency ceiling and input-order result assembly without launching Codex. Formatting tests will assert no blank line inside each bilingual pair and one normal separator between pairs. Existing parsing and atomic-application tests will continue to guard response shape and note integrity.

The final verification will run focused tests first, then the Aside full test suite and build, followed by a built-plugin smoke test against the real vault-script directive.
