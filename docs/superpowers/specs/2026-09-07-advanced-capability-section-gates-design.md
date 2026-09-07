# Advanced Capability Section Gates Design

**Date:** 2026-09-07
**Status:** Implemented and verified

## Implementation Tracking

- [x] Add a persisted, default-off `scriptsEnabled` capability setting.
- [x] Make Scripts and Publishing use shared section-level enable controls in both settings renderers.
- [x] Hide disabled-section details from rendering and settings search.
- [x] Gate every new script workflow, including retries, while leaving ordinary `@agent` replies available.
- [x] Preserve existing users through evidence-based Scripts migration.
- [x] Update current user documentation and focused regression coverage.
- [x] Run the complete build and exact release-artifact inspection.

## Context

Aside currently presents **Scripts (advanced)** as immediately configurable and actionable. **Publishing (advanced)** already has a persisted `publishEnabled` switch, but the switch is rendered as an ordinary setting inside an otherwise visible section. This makes the settings page denser than necessary for people who use Aside only for side notes, and it does not give Scripts an honest off state.

The current guides also describe agent-assisted scripts without an enable step. `README.md`, `SCRIPTS.md`, and `ADVANCED_FEATURES.md` therefore need to change with the product behavior.

This design intentionally evolves the 2026-09-06 Advanced Settings Graduation design. Advanced capabilities remain supported and free of hidden browser feature flags, but their explicit persisted capability controls move to the section level. Historical design documents and release notes remain unchanged.

## Goals

- Keep the default settings experience quiet for people who do not use agents, scripts, or publishing.
- Default both Scripts and Publishing to disabled for new users.
- Let users enable either capability independently from its section header area.
- Remove all disabled-section configuration details from the visible and searchable settings surface.
- Make the Scripts control operational: disabling it must prevent new script command discovery and execution.
- Preserve normal `@agent` side-note replies regardless of the Scripts setting.
- Avoid unexpectedly disabling established agent/script workflows during migration.
- Keep settings state, UI visibility, command discovery, and runtime routing governed by shared policy rather than duplicated conditions.

## Non-Goals

- Reintroducing hidden feature flags, browser-local-storage activation, or an Experimental section.
- Adding one global Advanced Features switch.
- Disabling ordinary `@agent` replies or hiding the separately controlled Agent sidebar tab.
- Deleting script files, agent/script history, publishing configuration, or already published pages when a capability is disabled.
- Cancelling an agent or script run that started before the setting changed.
- Changing vault-script eligibility, execution permissions, or sandboxing behavior.
- Editing historical release notes or historical design records.

## Considered Approaches

### 1. Independent section-level capability controls — selected

Scripts and Publishing each retain an always-visible heading and enable control. Their details exist in the settings UI only while enabled. Each persisted control also gates its runtime capability.

This is the clearest match for the user's mental model: an off section is visually quiet and operationally off, while the two advanced workflows remain independently selectable.

### 2. Disclosure-only collapse

Collapsing the settings would reduce visual noise, but script commands would still be discoverable and runnable. Calling that state disabled would be misleading, so this approach is rejected.

### 3. One Advanced Features master switch

A shared switch would make the page compact but would couple unrelated workflows. A user should be able to run local scripts without exposing publishing controls, or publish without enabling scripts, so this approach is rejected.

## Selected Experience

The section order remains:

1. **Sidebar tabs**
2. **Scripts (advanced)**
3. **Publishing (advanced)**
4. **Index note**

The advanced sections render as follows:

```text
Scripts (advanced)
Enable scripts                                      [off]

Publishing (advanced)
Enable publishing                                   [off]
```

The enable row is the first and only control in a disabled advanced section. It belongs to the section header area rather than appearing among capability details. This structure works consistently in Obsidian's declarative and legacy settings APIs without introducing a custom imitation of a native toggle.

When a section is enabled, its existing details appear directly below the enable row. No additional collapse state is introduced. Search may find the section and its enable control while disabled, but must not surface controls the user cannot currently see or use.

Suggested Scripts copy:

- Name: **Enable scripts**
- Description: **Create and run trusted local scripts with your local agent.**

The existing Publishing enable copy remains authoritative unless implementation review finds a small wording adjustment necessary for section-level placement.

## Capability State Model

`scriptsEnabled` becomes a persisted boolean in `AsideSettings`, defaulting to `false`. `publishEnabled` remains the persisted Publishing authority and already defaults to `false`.

These are capability settings, not feature flags:

- they are visible in the native settings UI;
- they express the user's current choice rather than product rollout state;
- they are stored in plugin settings, not browser storage; and
- production behavior reads them directly without a second hidden gate.

The shared settings-section catalog owns, for each gated section:

- its enabled state;
- its enable-control label and description;
- how a changed value is persisted; and
- whether its detail entries are eligible to render or participate in search.

Both the declarative and legacy adapters consume this metadata. They must not reimplement separate Scripts or Publishing rules. Entry-specific visibility, such as remote-purge fields depending on remote purge, remains nested beneath section visibility.

## Scripts Runtime Policy

With Scripts disabled, Aside prevents every new script-oriented workflow:

- `/create-script`
- `/update-script`
- `/pdf-to-markdown`
- each eligible registered `/script-name` command
- Generate/Regenerate actions for previous vault-script runs and agent runs whose request kind is create-script, update-script, or PDF-to-Markdown

The same shared capability predicate governs both discovery and dispatch:

1. The slash-command suggestion list omits all four categories while disabled.
2. Script directives and registered script mentions are not classified as actionable while disabled.
3. Saved-entry routing skips the create, update, PDF conversion, and vault-script controllers while disabled.
4. Historical script-oriented entries do not offer an enabled Generate/Regenerate action, and host retry methods reject stale or programmatic attempts while disabled.

Defense at both discovery and dispatch prevents directly typed text, stale UI state, or another call site from bypassing the setting. A disabled script directive remains ordinary side-note text; Aside does not advertise the feature with a warning card.

Ordinary supported `@agent` mentions remain actionable and continue through the existing agent controller. Their ordinary Generate/Regenerate path remains available because it is not a script capability. `@todo` also remains unchanged. Turning Scripts off does not hide historical replies, remove stored runs, delete `🛠️ scripts/`, or cancel work that has already begun; cancellation controls for already-running work remain available.

The shared policy should expose positive capabilities such as `canUseScripts()` or an equivalent typed value. Avoid scattered direct checks of `plugin.settings.scriptsEnabled` outside the settings owner and main runtime adapter.

## Publishing Runtime Policy

Publishing continues to use `publishEnabled` as its single authority. The existing top-level Publishing enable entry moves into the section-control metadata so it is not duplicated among detail entries.

While disabled:

- Publishing configuration details are absent from settings and settings search.
- Existing publish actions remain unavailable and publishing operations continue to fail closed.
- Existing configuration, tracked public artifacts, deployed pages, and local files are preserved.
- Disabling Publishing does not implicitly unpublish anything.

Enabling Publishing retains the current setup behavior, including any safe creation or initialization already performed by the existing setter, then reveals the details.

## Existing-User Migration

An explicit persisted `scriptsEnabled` boolean always wins. Missing or invalid state is resolved once and rewritten through the existing settings normalization path.

For a missing value, infer Scripts as enabled only when at least one of these evidence sources exists:

- persisted `agentRuns` is a non-empty array;
- persisted `scriptRuns` is a non-empty array; or
- the vault contains at least one script eligible under the existing shared vault-script registry policy.

Otherwise resolve it to disabled. This means:

- a new vault starts disabled;
- an existing side-note-only vault starts disabled;
- an established agent/script vault keeps its workflow available; and
- after migration, the persisted boolean prevents repeated inference or later surprise changes.

Script detection must reuse the registry's canonical folder, extension, and eligibility rules. The migration may receive this evidence from a vault scan during settings load, but it must not duplicate pathname logic in the settings planner or create `🛠️ scripts/` merely to inspect it.

Publishing requires no new inference: an existing valid `publishEnabled` value is preserved, and a missing or invalid value normalizes to its existing default of `false`.

## Error and Transition Behavior

- A failed capability-setting save restores the displayed toggle to the last persisted value and keeps runtime policy aligned with that value.
- Enabling Scripts requires no eager agent probe and starts no process. Runtime diagnostics remain lazy.
- Turning Scripts off blocks only new dispatches; already-running work follows existing completion and cancellation behavior.
- Turning Publishing off blocks new actions but does not destructively change remote or local content.
- Hidden nested Publishing values remain stored and reappear unchanged when Publishing is enabled again.
- An invalid persisted `scriptsEnabled` value follows the same migration inference as a missing value and is rewritten as a boolean.

## Documentation

Update current user-facing documents together with the behavior:

- `README.md`: describe Scripts and Publishing as optional advanced capabilities that are disabled by default, while keeping ordinary side notes and `@agent` replies understandable without either capability.
- `SCRIPTS.md`: add **Settings → Aside → Scripts (advanced) → Enable scripts** before all script command workflows; retain the prominent non-sandboxed local-execution warning.
- `ADVANCED_FEATURES.md`: describe both independent section controls, their default-off behavior, and the fact that disabling Publishing does not unpublish existing pages.

Documentation must distinguish ordinary `@agent` replies from script-oriented commands so users do not conclude that all agent interaction is disabled. Historical release notes and implemented historical specs remain untouched.

## Change-Surface Traceability

| User requirement | Policy owner | Consumers | Verification |
| --- | --- | --- | --- |
| Scripts and Publishing default off | settings defaults and normalization | settings page, runtime adapters | default and load tests |
| Section-level controls hide details | shared settings-section catalog | declarative and legacy adapters, search | catalog and adapter tests |
| Script commands are truly disabled | shared scripts capability policy | mention discovery, actionability, saved-entry routing, retry actions | discovery, routing, and retry tests |
| Ordinary `@agent` replies remain | actionable-mention and routing policy | editor suggestions and agent controller | focused mention/routing regression tests |
| Existing users retain established workflows | one migration resolver plus canonical script registry evidence | settings load/save | migration matrix tests |
| Guides match the product | current Markdown guides | users | documentation assertions and manual audit |

## Testing Strategy

Implementation follows test-first vertical slices:

1. Prove `scriptsEnabled` defaults to `false`, explicit booleans survive, and invalid or absent values follow the approved migration matrix.
2. Prove eligible vault-script evidence comes from the canonical registry policy and does not create files or folders.
3. Prove both settings adapters always show the section controls, show details only while enabled, and exclude disabled details from search.
4. Prove Publishing still fails closed and its dependent remote-purge controls retain their nested visibility behavior.
5. Prove Scripts-off suggestions omit built-in and registered slash commands while retaining `@agent` and `@todo` behavior.
6. Prove Scripts-off actionability and saved-entry dispatch cannot invoke any of the four script-oriented flows, including directly typed directives.
7. Prove Scripts-off Generate/Regenerate actions cannot retry vault scripts or script-oriented agent runs, while ordinary agent retries and active-run cancellation remain available.
8. Prove toggling off does not delete history, scripts, publishing configuration, or existing published state.
9. Prove current guides state the default, enable path, capability boundary, and local-script security warning.

Then run the repository's focused tests and complete build pipeline: compiled and direct tests, lint, typecheck, Obsidian compliance, production bundling, bundle-size guard, and exact shipped-artifact inspection. Any installation, publication, release, or push remains separately authorized.

## Acceptance Criteria

- New and side-note-only vaults show only the enable control under each disabled advanced section.
- Scripts and Publishing can be enabled or disabled independently.
- Disabled-section detail controls are neither rendered nor returned by settings search.
- Scripts disabled means no `/create-script`, `/update-script`, `/pdf-to-markdown`, eligible `/script-name`, or script-oriented retry can begin a new execution.
- Supported `@agent` replies and `@todo` remain unchanged when Scripts is disabled.
- Established vaults with persisted agent/script history or eligible registered scripts migrate to Scripts enabled; explicit user choices are always preserved.
- Publishing remains default-off and fail-closed without deleting configuration or deployed content.
- Declarative and legacy settings renderers consume the same section policy.
- `README.md`, `SCRIPTS.md`, and `ADVANCED_FEATURES.md` accurately describe the behavior.
- Full verification passes, including the exact release-artifact exposure checks required by `AGENTS.md`.

## Verification Evidence

Verified on 2026-09-07 without installing, publishing, releasing, or pushing:

- The worktree was clean before `npm run build`; the command exited 0 with 1,575/1,575 compiled tests and 171/171 direct-source tests passing, followed by clean ESLint, typecheck, Obsidian compliance, production bundle, bundle-size, and release-artifact checks.
- A focused capability run exited 0 with 307/307 compiled behavior tests and 13/13 direct wiring/documentation tests passing. It explicitly covered default-off migration, section order and disabled detail/search visibility, discovery and actionability, saved routing, script-oriented Generate and retry denial, ordinary agent retry and cancellation preservation, and documentation policy.
- `npm run release:artifacts:check` was run again after the build and exited 0 for the exact GitHub release set: `main.js`, `manifest.json`, and `styles.css`.
- Public artifact inspection found no `main.js.map` or other shipped map, `sourceMappingURL`, `sourcesContent`, raw TypeScript/TSX/JSX source, secret-bearing file or content, test fixture, or local-only file. The artifacts were `main.js` (705,354 bytes), `manifest.json` (349 bytes), and `styles.css` (97,579 bytes). The manifest identifies `aside` / `Aside` version `2.0.103`, minimum Obsidian `1.12.7`.
- `main.js` is an expected ignored build product; `manifest.json` and `styles.css` are tracked and the build left them unchanged. `git diff main...HEAD --check` and the post-build worktree check were clean before this verification record was added.
- A targeted audit of production source and current guides, excluding historical release notes and historical design records, found no contradictory current default-on or Experimental-settings language. The only production `featureFlags` references are intentional legacy-data detection and removal.
