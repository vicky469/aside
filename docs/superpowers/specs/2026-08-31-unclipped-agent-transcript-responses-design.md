# Unclipped Agent Transcript Responses Design

## Summary

Aside will include every retained agent-generated response in full when building context for a later agent run. User-authored thread entries will keep the existing 360-character cap, and the transcript will keep the existing eight-entry history window.

This prevents follow-up requests such as “translate the reply above” from receiving a silently truncated agent response while preserving the existing bound on thread depth.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Agent output entries are identifiable through agent-run records whose `outputEntryId` matches a thread entry ID.
- [x] All supported agent providers use the shared `buildAgentPromptContext` transcript builder.
- [x] Thread transcripts retain at most the latest eight entries.
- [x] The production failure was traced to the shared 360-character per-entry clipping rule.

### To Implement

- [ ] Make the transcript builder distinguish agent-generated entries from user-authored entries using existing run metadata.
- [ ] Include normalized agent-generated entry bodies without a per-entry character cap.
- [ ] Continue clipping user-authored entry bodies at 360 characters.
- [ ] Preserve author labels, current-entry labeling, empty-entry filtering, and the eight-entry transcript window.

### Verification

- [ ] A regression test proves an agent response longer than 360 characters is present in full in the generated prompt.
- [ ] A regression test proves a user-authored entry longer than 360 characters remains clipped.
- [ ] Tests prove the behavior applies uniformly to Codex, Claude, Gemini, and DeepSeek/OpenCode output entries.
- [ ] Tests prove only the latest eight entries remain in the generated transcript.
- [ ] The focused prompt-context tests and the full project build pass.

## Goals

- Give follow-up agents the complete content of retained agent response cards.
- Apply the behavior through one provider-neutral context-building path.
- Preserve the existing safeguards for user-authored entry size and transcript depth.

## Non-Goals

- Removing the eight-entry transcript-history limit.
- Removing the 360-character limit from user comments.
- Changing response-card rendering, storage, streaming, retry, or regeneration behavior.
- Adding semantic completeness detection to agent runtime success handling.
- Changing provider-specific CLI adapters or prompts.

## Behavior

For each of the latest eight thread entries, the prompt-context builder determines whether an agent-run record owns the entry through a matching `outputEntryId`.

- Agent-owned entry: normalize whitespace for the one-line transcript representation, but do not truncate the body.
- User-owned entry: normalize whitespace and retain the existing 360-character clipping behavior.
- Empty entry: continue omitting it from the transcript.

The current-entry suffix and provider label continue to come from the existing agent-run metadata. Because Codex, Claude, Gemini, and DeepSeek/OpenCode all persist output entry IDs through the same run model, no provider-specific branch is required.

## Architecture and Data Flow

The change remains inside `src/agents/agentPromptContextPlanner.ts`.

`buildThreadTranscript` already receives the thread’s agent-run records. It will resolve the matching run once per entry, use that result both for the author label and for the clipping decision, and produce the transcript line through a small entry-body formatter.

The data flow remains:

1. `CommentAgentController` loads the thread and its agent-run records.
2. `buildAgentPromptContext` selects the latest eight thread entries.
3. Each entry is classified as agent-generated or user-authored by `outputEntryId` ownership.
4. Agent bodies remain complete; user bodies remain capped.
5. The shared prompt is passed unchanged to the selected provider runtime.

No UI, persistence, or runtime-adapter interfaces change.

## Failure Handling

Missing or malformed run metadata falls back to user-entry behavior, so an unrecognized entry remains bounded rather than being treated as trusted agent output. Existing normalization continues to omit empty bodies and prevents multiline content from breaking the transcript’s bullet structure.

The transcript can grow when several large agent responses occur among the latest eight entries. This is intentional: the user explicitly prefers complete response-card context over a silent per-response cap. The eight-entry window remains the only transcript-depth boundary.

## Testing

Focused tests in `tests/agentPromptContextPlanner.test.ts` will construct long entries with distinctive suffixes beyond character 360.

- A matching agent run must preserve the suffix and contain no clipping marker.
- The same long body without a matching agent run must omit the suffix and end with the clipping marker.
- Parameterized provider cases must label and preserve complete replies for every supported agent identity.
- A thread longer than eight entries must still exclude older entries.

The implementation is complete only after the focused tests pass and `npm run build` succeeds.
