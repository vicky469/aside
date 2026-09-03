# Optimistic Agent Markdown Rendering Design

**Objective:** Format a completed agent response immediately in its existing live reply card while canonical persistence continues in the background.

## Implementation Tracking

### To Implement

- [ ] Extract the persisted comment Markdown pipeline into one reusable renderer.
- [ ] Supply the shared renderer to live agent cards through `AsideView`.
- [ ] Render terminal agent responses off-DOM and atomically swap them into the existing card.
- [ ] Ignore duplicate and stale asynchronous render completions.
- [ ] Preserve complete plain text when Markdown rendering fails.
- [ ] Keep formatting independent from background reply persistence for every supported agent.

### Verification

- [ ] Focused tests prove immediate formatting, stable card identity, stale-render rejection, and plain-text fallback.
- [ ] Existing persisted-comment and optimistic-completion regression suites pass.
- [ ] The complete build and release artifact inspection pass.
- [ ] The verified build is installed in `lean-startup` and all shipped assets match byte-for-byte.

## Confirmed Problem

The live agent card renders streamed text as plain text. Full Obsidian Markdown rendering happens only after the response is saved and the persisted comment card refreshes. When persistence is slow, the user sees an apparently unfinished preview even though the runtime has already returned the complete response.

Waiting for persistence also creates an avoidable visual transition: the live card can hold plain text until the persisted card replaces or refreshes it. The reply should instead become its final formatted form at runtime completion, without changing card identity or briefly becoming blank.

## Chosen Experience

- While the runtime is active, keep rendering the latest streaming text as plain text for fast, stable updates.
- When the runtime returns a valid final response, immediately show `✅ <agent>` and begin formatting that response in the same card.
- Keep the existing plain-text response visible while formatting runs.
- Render Markdown into a detached container and atomically swap the completed result into the live card, preventing a blank frame or layout jump caused by clearing first.
- Begin reply persistence independently. Formatting must not wait for persistence, and persistence must not wait for formatting.
- When persistence succeeds, the persisted-card handoff must preserve the already-visible content and card identity.
- When persistence fails, keep the formatted response visible and change the same card to `❌ <agent> · Couldn’t save reply`.

This behavior applies to every supported agent through shared rendering and controller boundaries, not provider-specific branches.

## Architecture

The persisted comment renderer remains the source of truth for how reply Markdown is normalized and rendered. Its reusable Markdown-rendering path will be exposed as a focused helper so live and persisted cards cannot drift in formatting, mention decoration, or Aside-link behavior.

`AsideView` supplies the live reply controller with an asynchronous final-response renderer. The view resolves the thread's note path and invokes the shared renderer with Obsidian's Markdown API and the same host capabilities used by persisted comments.

`StreamedAgentReplyController` owns only presentation timing and DOM reconciliation:

- queued and running states continue to use direct text updates;
- a terminal response starts one asynchronous render for the current run and text;
- the render target is detached from the visible card;
- a completed render replaces the visible content only if the same run, response, and card are still current;
- clearing, retrying, replacing, or disposing a card invalidates pending render work.

`CommentAgentController` keeps its existing optimistic-completion and background-persistence responsibilities. No storage mutation is added to the renderer.

## Data Flow

1. The runtime publishes the valid final response and optimistic `succeeded` state.
2. The existing card immediately changes its status to `✅ <agent>` and retains its complete plain-text body.
3. The streamed-card controller starts asynchronous Markdown rendering into a detached container.
4. In parallel, the agent controller continues canonical output preparation and reply persistence.
5. If rendering succeeds and its generation is still current, the controller atomically moves the rendered nodes into the existing content element.
6. If rendering fails, the plain-text response remains visible.
7. If persistence succeeds, the normal persisted-card handoff completes without a duplicate card or identity change.
8. If persistence fails, the same card retains its response and changes to `❌ <agent> · Couldn’t save reply`.

## Race And Failure Handling

Each render attempt receives a monotonically increasing generation or equivalent current-render key. The completion callback checks the run id, final text, card identity, and generation before touching visible DOM. This prevents a late render from an old retry or disposed view from overwriting a newer response.

Repeated sync calls for the same terminal run and response reuse the in-flight or completed result rather than launching duplicate Markdown renders.

A Markdown-rendering exception is presentation-only: log it for diagnosis, retain the complete plain-text response, and allow persistence to continue. A persistence exception is storage-related: retain whichever complete presentation is visible and use the established save-failure status. Neither failure may create an empty card.

## Verification

- A controller test blocks persistence and proves formatted Markdown appears before persistence resolves.
- A rendering test proves the visible plain-text body remains until the detached render completes, then swaps without replacing the card.
- A stale-render test proves an older completion cannot overwrite a retry, replacement, or cleared card.
- A rendering-failure test proves the complete plain-text response remains visible.
- Existing optimistic-completion tests continue to prove one-card identity and `❌ <agent> · Couldn’t save reply` behavior.
- Representative shared-path coverage proves the behavior is provider-neutral.
- Focused suites and the complete build pass.
- The exact shipped `main.js`, `manifest.json`, and `styles.css` pass artifact inspection, then the verified build is installed in `lean-startup` and compared byte-for-byte.

## Alternatives Considered

### Wait for persistence, then render the persisted card

This preserves a single rendering path but makes formatting latency depend on storage and sync latency. Rejected because the completed response should feel complete immediately.

### Render Markdown continuously while tokens stream

This provides rich formatting earlier but repeatedly reparses incomplete Markdown and can cause unstable lists, code blocks, and layout. Rejected in favor of one terminal render.

### Clear the live body before rendering

This simplifies replacement but produces the empty white card and jump the user reported. Rejected; detached rendering keeps the current body visible until the replacement is ready.

## Scope

Included: immediate terminal Markdown formatting, shared live/persisted normalization, detached atomic replacement, stale-render protection, plain-text fallback, provider-neutral behavior, and background persistence independence.

Excluded: continuous Markdown rendering during token streaming, changes to sidecar storage, a visible saving phase, provider-specific rendering, or broader persisted-comment redesign.
