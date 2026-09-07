# Public Publish Failure Recovery Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Reproduced the current Pigeon republish failure in Obsidian.
- [x] Confirmed the failure occurs during JavaScript dependency scanning before staging or Wrangler starts.
- [x] Identified `hasOwnProperty` as the first prototype-named token that triggers the delimiter-indexing crash.
- [x] Confirmed the rejected publish promise leaves the action button's loading state active.

### To Implement

- [x] Make delimiter indexing accept only the three actual opening delimiters without consulting inherited object properties.
- [x] Make publish-action loading state cleanup unconditional when an action succeeds or rejects.
- [x] Surface rejected publish actions through the existing user-facing notice and sanitized diagnostic paths.

### Verification

- [x] Add direct lexer regressions for `hasOwnProperty`, `constructor`, and `toString` tokens.
- [x] Add publish dependency facade coverage for prototype-named JavaScript tokens.
- [x] Add UI action coverage proving a rejected publish action clears its loading state and reports the failure.
- [x] Run the focused lexer, dependency-reference, and publish-action tests.
- [x] Run the complete build and release artifact guard.
- [x] Install the verified build into the `lean-startup` vault and confirm Pigeon republish reaches Wrangler and completes.
- [x] Confirm the hosted Pigeon HTML and dependency hashes match the current local artifact.

### Verification Evidence — 2026-09-07

- Both new prototype-name regressions failed before implementation with `TypeError: stacks[value].push is not a function`, then passed after delimiter storage moved to explicit maps.
- The rejected-action regression failed with the uncaught `dependency scan failed` error, then passed after adding the typed error boundary and `finally` cleanup.
- The combined publish suites passed 133 tests with zero failures.
- Review found that the central notice policy initially suppressed the new failure notice. A new regression failed with `false !== true`, then passed after narrowly allowing only `publish.html.action.error` in the publish area.
- The final complete build passed 1,531 compiled tests and 160 `.mjs` tests, for 1,691 total tests with zero failures. Lint, typecheck, Obsidian compliance, bundle size, and production bundling also passed.
- The final release guard inspected exactly `main.js`, `manifest.json`, and `styles.css`. No source maps, embedded `sourcesContent`, raw TypeScript/JSX-family source, secret-bearing files, private keys, certificates, or personal paths were present. The inspected `main.js` SHA-256 was `140c4cc338ff2ef5d3e8fb009699882a951d4edd34b014a048414bdf13f53359`.
- The final installed `lean-startup` plugin artifacts matched the inspected build byte-for-byte. After reload, captured developer errors contained only the original pre-fix failures from 02:26–02:30 and no new error.
- A no-deploy controller run produced and runtime-inspected the exact 16-file snapshot before the live action. Pigeon entries included HTML SHA-256 `56d47e0684974f6580aec33a73b2c10a9ad67cf473a9681a74dc7558b04c31ca`, both current v7 stylesheets, the v6 stylesheet dependency, and the logo.
- The real action emitted `publish.html.updated` at `2026-09-07T00:32:33.762Z`; its loading class cleared and Cloudflare recorded production deployment `5144dc91-c934-4122-82a2-9821ff2b2709`.
- Hosted CSS and SVG files matched local bytes exactly. Cloudflare injected a 938-byte challenge script into the HTML response; after removing only that downstream injection, hosted HTML matched local bytes and SHA-256 exactly. The response contains `clickedInsidePanel` and the current `7def22cf` and `4ebb930d` stylesheet keys.

## Context

Republishing `public/pigeon-plan/index.html` appears to run indefinitely, but the operation actually rejects before Cloudflare Pages deployment begins. Aside's JavaScript dependency scanner builds delimiter stacks with a normal object and checks tokens with the prototype-inclusive `in` operator. When the scanner reaches `Object.prototype.hasOwnProperty`, it mistakes `hasOwnProperty` for a delimiter stack because that name is inherited from `Object.prototype`, then calls `.push()` on the inherited function.

The publish action UI adds its loading class before awaiting the action and removes it only after success. The rejection therefore leaves the action permanently spinning. Because the exception escapes the structured publish result path, users receive no useful explanation and the sanitized publish event is not emitted.

Wrangler configuration and authentication are not involved in this failure. No staging directory or Wrangler process is created.

## Goals

- Make JavaScript dependency scanning safe for every valid identifier, including names inherited from `Object.prototype`.
- Ensure publish actions always leave their loading state.
- Give users a concise failure notice while retaining useful sanitized diagnostics.
- Preserve recursive dependency discovery, fail-closed artifact inspection, and the existing Cloudflare Pages deployment path.
- Keep the normal post-setup experience to one Publish or Republish action with no terminal use.

## Non-Goals

- Do not bypass dependency scanning or publish an entire directory.
- Do not change Wrangler installation, authentication, Pages project selection, or deployment commands.
- Do not change which artifacts or dependencies are allowed to ship.
- Do not automatically retry failed deployments in this change.

## Approaches Considered

### Harden the parser and action lifecycle — selected

Represent delimiter stacks with a `Map` or an explicit delimiter-only branch, then contain action rejection at the UI boundary with guaranteed cleanup and existing notification/logging mechanisms. This fixes both the root cause and the misleading infinite-loading symptom while preserving the current publisher architecture.

### Parser-only repair

Changing only delimiter lookup restores this specific deployment, but any later unexpected rejection would still leave the button spinning with no actionable feedback.

### Skip JavaScript dependency scanning

This avoids the failing code but can silently omit local JavaScript dependencies and produce incomplete published sites. It weakens the recursive dependency guarantee and is not acceptable.

## Design

### Delimiter indexing

`indexClosingDelimiters` will recognize only `(`, `[`, and `{` as openings. The data structure must not inherit arbitrary string keys. A small `Map` is preferred because membership and value lookup are explicit, and its type directly expresses a fixed mapping from delimiter to token-index stack.

Prototype-named identifiers remain ordinary tokens. They must pass through indexing without mutation or error and must not affect dependency reference extraction.

### Publish action lifecycle

The public-file publish action handler will own the complete loading lifecycle:

1. Add the loading class.
2. Await the requested publish action.
3. Refresh the view after success.
4. On rejection, report a concise user-facing failure and write sanitized diagnostic context through the plugin's existing error path.
5. Remove the loading class in `finally`, regardless of outcome.

The controller's structured `{ ok: false }` results remain unchanged. This boundary handles exceptional rejections that escape that normal result channel.

Duplicate notices must be avoided. If the controller already returned a handled failure, the UI should not report it again; the exception path applies only to rejected promises.

### User experience

After Wrangler has been installed and authenticated and a Pages project configured, publishing remains a single-button operation. A successful action completes and refreshes the available actions. A failure stops visibly and presents a short reason instead of looking like an indefinitely running deployment.

## Error Handling

- Parser input must never select delimiter state through inherited properties.
- Unexpected publish exceptions are caught at the action boundary.
- Loading cleanup is unconditional.
- Error messages shown to users must not include secrets, command environments, or raw sensitive file contents.
- Existing detailed logging conventions remain responsible for developer diagnostics.
- No publish state is persisted when snapshot construction or deployment fails.

## Testing

Add a compact lexer fixture containing `hasOwnProperty`, `constructor`, and `toString` alongside a valid static dependency. It must complete without throwing and return only the valid dependency. Add matching facade coverage so the HTML/JavaScript dependency extraction integration is locked down.

At the action layer, use a rejected host action to verify that the loading class is removed, a failure is reported once, and a refresh is not treated as a successful publish. Preserve current success-path expectations.

Run focused tests first, then the complete repository build. Before installing or releasing any build, inspect the exact `main.js`, `manifest.json`, and `styles.css` artifacts and run the repository release artifact guard. A real Pigeon republish is the final integration check because it exercises inline JavaScript scanning, snapshot construction, Wrangler Pages upload, and hosted freshness.

## Acceptance Criteria

- Pigeon content containing `Object.prototype.hasOwnProperty` no longer crashes dependency scanning.
- Other prototype-named identifiers cannot reproduce the delimiter-stack failure.
- Every successful or failed publish action removes its loading state.
- Unexpected failures produce one useful notice and sanitized diagnostic output.
- A failed action does not start Wrangler or change persisted publish state.
- With valid Wrangler setup, Republish completes without terminal intervention.
- The hosted Pigeon artifact matches the current local entry and dependencies after a successful republish.

## Relationship to Existing Publish Design

This design is a reliability correction to `2026-08-25-recursive-html-publish-dependencies-design.md`. It does not change dependency semantics or Cloudflare deployment architecture. It also extends the completed lexer repair work in `2026-09-06-publish-lexer-review-fixes.md` with the newly reproduced prototype-key regression and action-lifecycle containment.
