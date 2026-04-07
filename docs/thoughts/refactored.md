# SideNote2 Refactor Retrospective

This note explains the **order**, **rationale**, and **refactoring principles** behind the codebase refactor.

## Scope

- why the refactor order was chosen
- what each step extracted
- which files were affected
- what design and refactoring skills were being applied

## Refactor Game Board

Read this as a level map:

- `Start State / Bosses` shows the original mess.
- Each `Level` shows a cleanup stage and its main unlock.
- `Finish / Clean Board` shows the grouped end state and the stopping rule.

![[refactor-game.canvas]]

## Starting Point

The codebase had a few clear structural problems:

- `src/main.ts` was a very large mixed-responsibility file. During the refactor it started around **2207 lines**.
- `src/ui/views/SideNote2View.ts` also carried too many jobs. It started around **1014 lines**.
- `src/core/*` was a useful bucket, but it mixed unrelated concerns: anchors, storage, derived views, file rules, and text parsing.
- A lot of logic was testable in principle, but was trapped inside Obsidian-facing files.
- The plugin already had useful behavior, so the refactor had to be incremental and low-risk.
- The deeper issue was not just size. The same file often contained four different kinds of code at once:
  - framework bootstrapping
  - behavior orchestration
  - transient UI/session state
  - low-level helper policy

That combination suggests a specific strategy:

1. **Do not rewrite.**
2. **Extract one seam at a time.**
3. **Prefer behavior-preserving moves over redesign-first moves.**
4. **Make the composition root thin.**
5. **Move pure logic toward `planners/helpers`, side effects toward `controllers`, and volatile UI state toward stores.**

## Why This Order

### checklist/decision rubric
1. **How much responsibility density is in this cluster?**
   - If one area mixed unrelated reasons to change, it moved up the queue.
   - This is basically ==SRP / "reasons to change"== thinking. If one cluster changes for navigation, persistence, rendering, and transient UI state at the same time, it is probably carrying too much responsibility and is a better early extraction target.
2. **Is it on the read path or the write path?**
   - Read-only or derived flows were safer to extract before canonical write flows.
   - This is a ==risk-management== heuristic. If a read-path extraction goes wrong, it usually breaks rendering or derived output. If a write-path extraction goes wrong, it can corrupt the note-backed source of truth.
3. **Can it be given a narrow host interface?**
   - If a behavior could depend on 5-10 callbacks instead of the whole plugin object, it was a good extraction candidate.
   - This comes from seam carving and ==dependency inversion==. A behavior is easier to move, test, and reason about when it only needs a small callback surface instead of reaching into the whole plugin runtime.
4. **Does it own persistent state, transient state, or derived state?**
   - Those are different categories and should not be hidden in the same file.
   - This comes from ==source-of-truth and state-ownership thinking==. Persistent state, session state, and derived state have different lifecycles and failure modes, so mixing them makes ownership blurry and bugs harder to localize.
5. **Will this extraction unlock later ones?**
   - Some moves were not the biggest mess, but they created a landing zone for the next 2-3 steps.
   - This is ==dependency ordering==. Some refactor steps matter less because they clean up the current file and more because they create a stable destination or boundary for the next extractions.
6. **Will the result be more testable, or just more fragmented?**
   - If a split only created indirection, it was postponed.
   - This is ==abstraction-cost== discipline. A split was only worth doing if it improved tests, ownership, or seam clarity. If it only increased file count and indirection, it was not yet a net gain.

That produced a dependency ladder: see [[rubric-to-dependency-ladder.canvas|rubric -> dependency ladder]].

1. Give the repo better semantic buckets.
2. Extract coherent orchestration clusters out of `main.ts`.
3. Pull volatile session state into explicit stores.
4. Turn `main.ts` into a real composition root.
5. Refactor `SideNote2View.ts` only after the backend/control seams were stable.

### dependency ladder / move order
1. Start with naming and packaging

Before extracting lots of behavior, it helps to give the codebase better ==semantic buckets==. That reduces mental load and gives later extractions a place to land.

Create folders whose names already answer “what kind of thing is this?” That way later moves have an obvious landing place.
  - src/control -> orchestration/controllers
  - src/domain -> transient session state/stores
  - src/ui -> rendering and interaction
  - src/index -> the aggregate index
  - src/cache -> parsed-note caching

 2. Thin `main.ts` before touching the sidebar heavily

`main.ts` was the highest-responsibility file and the best place to carve stable seams:

- entry
- navigation
- persistence
- workspace context
- lifecycle
- registration

If those stay mixed together, the UI refactor has no stable backend boundary to lean on.

 3. Separate “what should happen” from “talk to Obsidian”

This is why several areas got a **planner/controller** split:

- planners hold pure decisions
- controllers hold side effects and integration code

That pattern made it possible to increase test coverage without needing the full Obsidian runtime.

 4. Extract state stores before UI session glue

Draft state and revealed-comment state were not just “data.” They were **transient UI session state**. Pulling them into stores made later controller extractions cleaner and prevented `main.ts` from remaining the hidden owner of every volatile flag.

This became:

src/domain/DraftSession**Store**.ts
src/domain/RevealedCommentSelection**Store**.ts

Why stores came before more UI glue:
transient values like current draft, draft host file, saving state, and revealed comment needed one owner, otherwise that state would have stayed split across main.ts, SideNote2View.ts, and controller fields.

After the extraction, files like commentSession**Controller**.ts and sidebarInteraction**Controller**.ts could coordinate through explicit stores instead of hidden duplicated flags

5. Refactor the sidebar after the app shell was stable

The sidebar had the most DOM/event complexity. If it were refactored too early, every change would still be coupled to unstable plugin-shell logic. It was safer to refactor the UI after the application/control layer had become clearer.

 6. Stop when the remaining code is cohesive

A refactor is done when the remaining files have clear responsibility, not when every file is “small.” Some glue is legitimate glue.

## Refactoring Vocabulary Used

These patterns show up repeatedly in the sequence below:

- **Composition root**: the top-level file that wires everything together. Here, `src/main.ts`.
- **Controller**: imperative orchestration around a behavior cluster.
- **Planner**: pure or mostly-pure decision logic extracted from a controller.
- **Store**: small object that owns ephemeral mutable state.
- **Seam carving**: extracting along a boundary that already exists in behavior, rather than inventing a new abstraction.
- **Strangler-fig refactor**: keep behavior running while moving one concern at a time out of the old file.
- **Node-safe boundary**: keep testable logic free of hard runtime imports from `obsidian` when possible.

## Chronological Refactor Log

### 0. Re-bucket `src/core/*`

Primary files:

- `src/core/anchorResolver.ts` -> `src/core/anchors/anchorResolver.ts`
- `src/core/commentAnchors.ts` -> `src/core/anchors/commentAnchors.ts`
- `src/core/appConfig.ts` -> `src/core/config/appConfig.ts`
- `src/core/allCommentsNote.ts` -> `src/core/derived/allCommentsNote.ts`
- `src/core/editorHighlightRanges.ts` -> `src/core/derived/editorHighlightRanges.ts`
- `src/core/commentSyncPolicy.ts` -> `src/core/rules/commentSyncPolicy.ts`
- `src/core/commentableFiles.ts` -> `src/core/rules/commentableFiles.ts`
- `src/core/attachmentCommentStorage.ts` -> `src/core/storage/attachmentCommentStorage.ts`
- `src/core/noteCommentStorage.ts` -> `src/core/storage/noteCommentStorage.ts`
- `src/core/commentMentions.ts` -> `src/core/text/commentMentions.ts`
- `src/core/commentTags.ts` -> `src/core/text/commentTags.ts`

What was being refactored:

- A generic “core” bucket into named subdomains.

Context at this step:

- The repo already had real conceptual domains, but the folder layout still said “misc internal stuff.”
- That mismatch matters because future extractions need a place to land. Without that, every move becomes two problems: “what should this code become?” and “where should it live?”
- The flat `src/core/*` layout also hid which modules were canonical rules, which were storage, and which were derived projections.

Why this came first:

- Later extractions needed a stable destination.
- It reduced mental friction before moving logic out of `main.ts`.

Principles used:

- semantic packaging
- naming as architecture
- reduce accidental coupling by folder structure

### 1. Extract comment entry flow

Primary files:

- `src/control/commentEntryController.ts`
- `tests/commentEntryController.test.ts`
- `src/main.ts`

What was being refactored:

- “Add comment to selection” and page-note draft entry paths.

Context at this step:

- The entry flow was still mixed into `src/main.ts` with command registration, draft creation, validation, notices, and sidebar activation.
- This was one of the cleanest seams because it starts with a user intent and ends with a draft, which is a tight behavioral unit.
- It also had a relatively narrow dependency surface compared with persistence or lifecycle code.

Why this step came early:

- It was a clear user-intent seam.
- It had limited dependencies.
- It created a template for later controller extractions.

Principles used:

- carve by user intent
- command orchestration extraction
- create a narrow host interface instead of passing the whole plugin

### 2. Extract highlight and preview decoration flow

Primary files:

- `src/control/commentHighlightController.ts`
- `src/control/commentHighlightPlanner.ts`
- `tests/commentHighlightController.test.ts`
- `src/main.ts`

What was being refactored:

- CodeMirror decorations
- preview highlights
- live preview managed blocks
- aggregate-note preview link handling

Context at this step:

- This subsystem was large, but most of it was projection logic rather than source-of-truth mutation.
- In practical terms, that made it safer: if the extraction went wrong, it would likely break highlighting rather than corrupt persisted comments.
- The code also already had a natural split between “figure out which ranges/wraps should exist” and “apply them to editor/preview surfaces.”

Why it came next:

- It was a large, self-contained subsystem.
- It was mostly read-only/derived behavior rather than persistence.
- It had a natural split between planning highlight ranges/wraps and talking to CodeMirror/preview DOM.

Principles used:

- separate rendering logic from composition root
- planner/controller split
- isolate UI projection from source-of-truth mutation

### 3. Extract navigation and reveal behavior

Primary files:

- `src/control/commentNavigationController.ts`
- `src/control/commentNavigationPlanner.ts`
- `tests/sidebarIndexContext.test.ts`
- `tests/sidebarLeafActivation.test.ts`
- `src/main.ts`

What was being refactored:

- sidebar activation
- comment reveal/open flow
- preferred file leaf selection

Context at this step:

- Reveal/open behavior was scattered across commands, sidebar actions, and workspace-driven flows.
- A lot of the complexity was not business logic so much as “which leaf should this open in?” and “which file should the sidebar target?”
- That made it a good candidate for a planner/controller split: policy on one side, execution on the other.

Why it came before persistence:

- reveal/open behavior was independent enough to isolate early
- it reduced a major cluster of workspace branching in `main.ts`

Principles used:

- separate navigation policy from execution
- preserve UX semantics while reducing leaf-selection duplication

### 4. Extract workspace context and active file policy

Primary files:

- `src/control/workspaceContextController.ts`
- `src/control/workspaceContextPlanner.ts`
- `tests/sidebarIndexContext.test.ts`
- `tests/sidebarLeafActivation.test.ts`
- `src/main.ts`

What was being refactored:

- file-open handling
- active-leaf-change handling
- active markdown/sidebar file tracking
- index-note mode sync

Context at this step:

- `main.ts` still owned too much implicit workspace state: what file is active, what file the sidebar should follow, and when the index note should behave differently.
- These are not the same thing as navigation, but they are adjacent, so extracting them back-to-back reduced overlap.
- This step also made later persistence and refresh code less ambiguous because the active-file policy had an explicit owner.

Why it came after navigation:

- navigation and workspace context touch the same Obsidian concepts
- extracting them in sequence reduced back-and-forth between overlapping responsibilities

Principles used:

- state synchronization boundaries
- explicit ownership of workspace-derived state

### 5. Extract persistence and refresh scheduling

Primary files:

- `src/control/commentPersistenceController.ts`
- `src/control/commentPersistencePlanner.ts`
- `src/main.ts`

What was being refactored:

- note-backed write flow
- load-from-note flow
- modify handling
- deferred aggregate refresh scheduling
- coordination with derived metadata and index refresh

Context at this step:

- This was one of the highest-risk zones because it sits on the canonical data path: loading comments from notes, writing them back, and deciding when to refresh derived views.
- Until this point, the refactor stayed mostly on read/projection/navigation territory. Moving persistence earlier would have increased regression risk too soon.
- Once workspace and view seams existed, persistence could be extracted with clearer boundaries around file lookup, note content, and refresh triggers.

Why it came here:

- persistence was high-risk and depended on stable workspace/view seams
- extracting it too early would have made the dependency graph messier
- the canonical note-backed storage path needed one concentrated owner before mutation code could become clean

Principles used:

- centralize writes to the canonical source of truth
- isolate async side-effect policy
- make refresh semantics explicit

### 6. Extract comment mutation flow

Primary files:

- `src/control/commentMutationController.ts`
- `tests/commentMutationController.test.ts`
- `src/main.ts`

What was being refactored:

- save draft
- add/edit/delete/resolve/unresolve comment behavior
- duplicate-add suppression

Context at this step:

- Before this extraction, the plugin effectively had one big mutation blob: draft save logic, comment CRUD, resolution state changes, and guardrails all intertwined.
- Mutation sits conceptually above persistence. It should decide what change should happen, then delegate the actual write path.
- That is why it was deferred until persistence had a clear owner.

Why it came after persistence:

- mutation is orchestration around `commentManager + persistence`
- once persistence existed as a seam, mutation could become a focused controller instead of a mixed blob

Principles used:

- single mutation path
- reduce write-path duplication
- transactional thinking around side effects

### 7. Extract derived metadata augmentation

Primary files:

- `src/core/derived/derivedCommentMetadata.ts`
- `src/core/derived/derivedCommentMetadataPlanner.ts`
- `tests/derivedCommentMetadata.test.ts`
- `src/main.ts`

What was being refactored:

- metadata cache augmentation
- derived wiki-link projection
- rename/delete/persistence hooks

Context at this step:

- This behavior is easy to miss because it is not the main storage path, but it is architecturally important: it projects comment-derived links into Obsidian’s metadata layer.
- It is both derived and framework-specific, which makes it brittle if it stays half-hidden inside the plugin shell.
- By this point the canonical write path was stable enough that this secondary projection layer could be isolated safely.

Why it came after persistence/mutation:

- this logic depends on comment writes and file changes
- it is derived state, not primary state, so it is safer to refactor after the primary write path is stable
- it also touches Obsidian metadata augmentation, which is a framework edge case and better isolated after the core write path is known-good

Principles used:

- isolate framework augmentation
- keep derived state secondary to canonical data

### 8. Extract draft session state

Primary files:

- `src/domain/DraftSessionStore.ts`
- `tests/draftSessionStore.test.ts`
- `src/main.ts`

What was being refactored:

- current draft
- host file path
- saving draft comment id

Context at this step:

- Once mutation logic moved out, these fields no longer looked like business rules. They looked like what they really were: ephemeral session state.
- Leaving them in `main.ts` would have kept the plugin shell as the hidden owner of draft lifecycle.
- Extracting a store here made later session/UI policy easier to reason about.

Why here:

- once mutation logic moved out, the remaining draft fields in `main.ts` were clearly just session state

Principles used:

- explicit ephemeral state
- separate session state from orchestration code

### 9. Extract revealed comment selection state

Primary files:

- `src/domain/RevealedCommentSelectionStore.ts`
- `tests/revealedCommentSelectionStore.test.ts`
- `src/main.ts`

What was being refactored:

- active revealed comment id per file

Context at this step:

- This state had the same smell as draft state: small, volatile, UI-scoped, and not a good fit for the plugin shell.
- It also affected highlight/navigation behavior, so making it explicit reduced hidden coupling between UI and reveal logic.

Why right after draft state:

- same category of problem: volatile UI/session state hidden inside the plugin shell

Principles used:

- small focused stores
- state locality

### 10. Extract index note settings logic

Primary files:

- `src/control/indexNoteSettingsController.ts`
- `src/control/indexNoteSettingsPlanner.ts`
- `tests/indexNoteSettingsController.test.ts`
- `src/main.ts`

What was being refactored:

- settings load/save
- index note path changes
- path normalization
- header image settings
- draft/sidebar retargeting after index note changes

Context at this step:

- Index note settings were not just persistence trivia. They changed routing, sidebar targeting, draft host state, and aggregate-note behavior.
- That meant settings could not be cleanly extracted until draft/session owners and workspace targeting were already explicit.
- The normalization logic also belonged at a boundary layer, not inside the plugin shell.

Why this came after stores:

- settings changes affected draft host path and sidebar target state
- those needed clean owners first

Principles used:

- normalize at system boundaries
- isolate configuration side effects

### 11. Extract workspace view helpers

Primary files:

- `src/control/workspaceViewController.ts`
- `tests/workspaceViewController.test.ts`
- `src/main.ts`

What was being refactored:

- file lookup
- markdown view lookup
- current note content reads
- preview rerendering
- sidebar rerendering
- markdown selection clearing

Context at this step:

- By now many controllers were working, but `main.ts` was still handing out lots of tiny helper callbacks for file/view/content access.
- Repetition is often a clue that an adapter abstraction already exists in practice, even if it has not been named yet.
- Pulling these helpers into one workspace-view gateway reduced duplication and simplified the remaining extractions.

Why here:

- many controllers were still receiving tiny duplicated view helper closures from `main.ts`
- consolidating them simplified later extractions
- repeated helpers such as “find file/view/content and rerender” were a signal that an adapter object was already present implicitly

Principles used:

- gateway pattern
- framework adapter extraction

### 12. Extract lifecycle routing

Primary files:

- `src/control/pluginLifecycleController.ts`
- `tests/pluginLifecycleController.test.ts`
- `src/main.ts`

What was being refactored:

- `onLayoutReady`
- vault rename/delete/modify handlers
- debounced editor-change refresh

Context at this step:

- Lifecycle code is a poor first extraction target because it tends to call into many unfinished destinations.
- By this stage, the real business logic already had homes, so lifecycle logic could collapse into event routing rather than event implementation.
- That is why it appears late in the sequence even though it sits near the top of the plugin shell.

Why late in the `main.ts` pass:

- once the business logic had destinations, lifecycle code became simple routing

Principles used:

- composition root should register handlers, not implement them
- event routing over event logic

### 13. Extract registration wiring

Primary files:

- `src/control/pluginRegistrationController.ts`
- `tests/pluginRegistrationController.test.ts`
- `src/main.ts`

What was being refactored:

- view registration
- protocol handler registration
- command wiring
- editor-menu wiring
- ribbon setup

Context at this step:

- Registration code looks simple, but it is only worth extracting once the registered behavior already has stable modules behind it.
- Otherwise the refactor just moves wiring around while the actual targets keep changing.
- At this point the targets were stable enough that registration could become declarative.

Why after lifecycle:

- same family of code: bootstrapping and framework wiring

Principles used:

- declarative registration
- thin shell, thick behavior modules

### 14. Extract session/UI glue

Primary files:

- `src/control/commentSessionController.ts`
- `tests/commentSessionController.test.ts`
- `src/main.ts`

What was being refactored:

- draft session refresh policy
- revealed-comment refresh policy
- resolved-comment visibility toggle

Context at this step:

- The raw state stores already existed, but the “when should the UI refresh?” logic was still scattered.
- That is an important distinction: state ownership and side-effect policy are related, but they are not the same thing.
- This controller became the place where session transitions and UI refresh consequences were intentionally paired.

Why this was not extracted earlier:

- it depended on both stores and view-refresh seams already existing

Principles used:

- co-locate state transitions with required refresh side effects
- remove “hidden UI policy” from the plugin shell

### 15. Refactor `main.ts` into a real composition root

Primary files:

- `src/main.ts`

What was being refactored:

- not one extraction, but the cumulative result of steps 1-14

Context at this step:

- This is the point where `main.ts` stopped being the place where behavior lived and became the place where behavior was wired together.
- That shift matters more than the line count drop, because it changes how future work lands in the repo.
- New behavior can now usually be added by extending a controller or helper rather than reopening the whole plugin shell.

Why this matters:

- the point was not “smaller file good”
- the point was “`main.ts` should wire, not think”

Result:

- `src/main.ts` ended at about **583 lines**
- its job became composition, lifecycle registration, and public plugin surface

Principles used:

- composition root
- strangler-fig refactor
- remove responsibility density

### 16. Extract sidebar draft-editor behavior

Primary files:

- `src/ui/views/sidebarDraftEditor.ts`
- `tests/sidebarDraftEditor.test.ts`
- `src/ui/views/SideNote2View.ts`

What was being refactored:

- draft list merge/sort helper
- textarea row sizing
- Enter-to-save logic
- link/tag suggest behavior

Context at this step:

- The first sidebar extraction targeted the area with the highest local complexity and highest likely churn.
- Draft editing is where keyboard behavior, text area ergonomics, suggestion modals, and save semantics all meet.
- It is also easier to test as a bounded interaction engine than the full sidebar shell.

Why this was the first UI extraction:

- it was the densest and most volatile sidebar cluster
- it was specific enough to extract cleanly
- it could be made Node-safe through host callbacks
- it also had the highest edit churn: textarea sizing, key handling, suggest flows, and draft ordering tend to change together

Principles used:

- extract volatile interaction logic first
- host-callback inversion
- keep testable code free of direct Obsidian runtime imports

### 17. Extract persisted comment cards

Primary files:

- `src/ui/views/sidebarPersistedComment.ts`
- `tests/sidebarPersistedComment.test.ts`
- `src/ui/views/SideNote2View.ts`

What was being refactored:

- persisted card presentation
- markdown content rendering wiring
- click-to-open behavior
- internal link interception
- resolve/edit/delete buttons

Context at this step:

- Persisted comment cards were acting like mini-applications inside `SideNote2View.ts`.
- They had their own presentation model, content rendering path, action buttons, and navigation behavior.
- Once the draft side was separated, the persisted-card seam became much easier to see clearly.

Why this followed the draft-editor split:

- it mirrored the next biggest card-local behavior cluster
- once draft behavior was separated, persisted-card behavior became much easier to isolate

Principles used:

- render one card type in one place
- event locality
- presentation model extraction

### 18. Extract draft comment cards

Primary files:

- `src/ui/views/sidebarDraftComment.ts`
- `tests/sidebarDraftComment.test.ts`
- `src/ui/views/SideNote2View.ts`

What was being refactored:

- draft card shell
- textarea/action row setup
- save/cancel button wiring

Context at this step:

- Draft behavior and draft rendering were still partially conflated.
- `sidebarDraftEditor.ts` answered “how editing works,” but the card shell still lived in the main view file.
- Pulling out the draft card brought symmetry with persisted cards and made `SideNote2View.ts` more clearly a shell.

Why this was separate from `sidebarDraftEditor.ts`:

- `sidebarDraftEditor.ts` owns editing behavior
- `sidebarDraftComment.ts` owns the draft card as a rendered unit

That separation is subtle but important:

- one file answers “how does draft editing behave?”
- the other answers “how is a draft card rendered and wired?”

Principles used:

- split markup shell from editing engine
- symmetry with persisted-card extraction

### 19. Extract sidebar interaction state and shell behavior

Primary files:

- `src/ui/views/sidebarInteractionController.ts`
- `tests/sidebarInteractionController.test.ts`
- `src/ui/views/SideNote2View.ts`

What was being refactored:

- active comment state
- draft focus scheduling
- copy/selection ownership
- background click behavior
- draft-dismiss behavior
- internal link focus handoff
- open-comment active-state handling

Context at this step:

- This was the most cross-cutting UI seam: it touched document-level behavior, focus timing, selection state, and interactions between cards and the outer container.
- Extracting it too early would have been painful because card rendering and draft handling were still moving.
- Extracting it last let the controller focus on shell interaction semantics instead of owning markup details too.

Why this came last:

- it was the most cross-cutting UI behavior
- it touched container DOM, document events, focus, render timing, and reveal flow
- extracting it earlier would have created too much moving target instability

Principles used:

- extract shell-state last
- protect UX behavior while moving code
- centralize cross-cutting interaction semantics

### 20. Stop refactoring when the remaining code became cohesive

Primary files:

- `src/ui/views/SideNote2View.ts`

What remained:

- view lifecycle
- render cycle orchestration
- toolbar/section shell rendering
- bridging helper modules together
- delete confirmation modal wiring

Context at this step:

- After the previous extractions, the remaining view file mostly contained the responsibilities that genuinely belong to a sidebar shell.
- At that point, additional splitting would likely have produced indirection rather than better ownership.
- This is the point where refactoring discipline means stopping, not just continuing because more splits are still technically possible.

Why this is a good stopping point:

- those responsibilities are actually related
- splitting them further would mostly create indirection, not clarity

Result:

- `src/ui/views/SideNote2View.ts` ended at about **389 lines**

Principles used:

- stop at cohesion
- do not refactor for symmetry alone

## Why These Steps Formed a Chain

The sequence was not arbitrary. Each step deliberately reduced one kind of ambiguity so the next step became obvious.

- **Re-bucketing `src/core/*`** gave later extractions a semantic destination. Without that, every move would have had a second argument about folder placement.
- **Entry, highlight, navigation, and workspace extraction** reduced `main.ts` from “everything shell” into identifiable orchestration lanes.
- **Persistence before mutation** prevented multiple write paths from surviving in parallel. That matters because write bugs are harder to notice and harder to repair.
- **Stores before session controller** separated state ownership from refresh policy. Only after that could session logic become a coherent controller.
- **Workspace view helper extraction** turned many repeated micro-dependencies into one adapter, which made later lifecycle and registration extraction simpler.
- **Lifecycle and registration late** was intentional. Those areas should route to stable modules, not be extracted while the destinations are still moving.
- **Sidebar refactor last** worked because the plugin shell had stopped shifting underneath it. At that point `SideNote2View.ts` could be thinned without constantly reopening backend decisions.

## Skills and Principles Used Repeatedly

### Structural triage

Before extracting anything, the code was being classified into four buckets:

- canonical state
- derived state
- transient session state
- framework shell

That classification is what made the order defensible. It is also why the refactor did not turn into random helper extraction.

### Responsibility-density analysis

The first question was not “what folder should this file be in?” It was:

- How many unrelated reasons does this file have to change?

That is the fastest way to spot where a refactor should begin.

### Refactor by behavior cluster, not by type

A bad refactor would have been:

- “extract helpers”
- “extract utils”
- “make more folders”

The actual refactor used behavior clusters:

- entry
- navigation
- persistence
- session
- interaction
- draft editing
- persisted card rendering

That is why the result is easier to reason about.

### Planner vs controller split

This pattern was used whenever a cluster had:

- a pure decision part
- an imperative side-effect part

That separation improved testability and made the code easier to read under pressure.

### State ownership extraction

When a large file contains many flags, ids, and “current X” variables, that usually means orchestration and state ownership have collapsed together.

The fix is not always “make a state library.” In this refactor the better move was:

- put small volatile state into stores
- keep refresh and side-effect policy in controllers

That is why `DraftSessionStore` and `RevealedCommentSelectionStore` were extracted before the session controller was finalized.

### Host interfaces instead of plugin leakage

Many extracted modules were given narrow host contracts instead of direct access to the whole plugin object.

Why:

- easier testing
- less accidental coupling
- clearer dependency surface

### Keep Obsidian runtime at the edge when possible

The Node test environment cannot freely import every runtime-backed Obsidian module. The refactor intentionally used:

- planners
- stores
- host callbacks

to keep logic testable without a live app process.

### Verify after each step

The refactor was done as a sequence of small moves with repeated:

- `npm test`
- `npm run build`

This matters because incremental refactoring is less about courage and more about feedback frequency.

## What This Refactor Was Not

It was not:

- a full architecture rewrite
- a conversion to a framework
- an attempt to make every file tiny
- a cosmetic directory reshuffle

It was a controlled reduction of responsibility density while preserving behavior.

## What Stayed Central on Purpose

Some things were intentionally **not** decomposed further.

- `src/commentManager.ts` stayed central because it is the in-memory owner of comment CRUD, lookup, and per-file grouping. Splitting that prematurely would risk creating multiple partial sources of truth.
- `src/main.ts` still exists as the plugin shell because Obsidian plugins naturally need one object that registers commands, views, events, settings, and lifecycle hooks.
- `src/ui/views/SideNote2View.ts` still owns the render shell because view lifecycle and section composition are genuinely related responsibilities once card rendering and interaction policy are split out.

That is an important refactoring skill by itself: **do not extract the last coherent center just to make the file graph look more uniform.**

## End State

The codebase now has a much clearer shape:

- `src/main.ts` is the plugin composition root.
- `src/control/*` contains application orchestration.
- `src/domain/*` contains volatile session state objects.
- `src/core/*` contains durable rules and storage logic.
- `src/ui/views/*` is no longer one giant mixed file; it is a small shell plus focused sidebar helpers.

The most important architectural gain is not “more files.” It is this:

- the canonical note-backed data path is clearer
- transient UI state has explicit owners
- side effects have concentrated homes
- pure logic has more test seams

That is why the refactor order looked the way it did.

At the end of the refactor pass:

- `src/main.ts` was down to **583 lines**
- `src/ui/views/SideNote2View.ts` was down to **389 lines**
- the test suite passed at **176/176**
- `npm run build` passed

<!-- SideNote2 comments
[
  {
    "id": "37cd7eb3-8cf6-440e-b328-1b96e7161172",
    "startLine": 42,
    "startChar": 87,
    "endLine": 42,
    "endChar": 118,
    "selectedText": "volatile UI state toward stores",
    "selectedTextHash": "367078ae7e24067a59e3ed9363a2fdfd1919fcf1dd8ac6cbf63d9564edce0a4b",
    "entries": [
      {
        "id": "37cd7eb3-8cf6-440e-b328-1b96e7161172",
        "body": "What does this mean:\n- Move temporary UI state into dedicated stores (state containers).\n- Centralize transient sidebar state in store objects.\n- Pull short-lived UI state out of views and into shared stores.\n\nWhy this helps:\n\n  - one source of truth for transient UI state\n  - less prop-drilling and fewer hidden couplings\n  - easier tests\n  - easier to restore/re-render UI consistently",
        "timestamp": 1774932445390
      }
    ],
    "createdAt": 1774932445390,
    "updatedAt": 1774932445390
  },
  {
    "id": "ecb8fd7d-68d8-445f-af20-74ef99670d30",
    "startLine": 47,
    "startChar": 5,
    "endLine": 47,
    "endChar": 56,
    "selectedText": "How much responsibility density is in this cluster?",
    "selectedTextHash": "403892403ab0da47f294db40968f6300b2f5f7fc289bdbbd32fa8208b618cd8e",
    "entries": [
      {
        "id": "ecb8fd7d-68d8-445f-af20-74ef99670d30",
        "body": "This means: how many different reasons would cause this area to change?\n\nA high-density cluster is not just a big file. It is a file that mixes unrelated jobs. Early in this refactor, `main.ts` mixed framework bootstrapping, command handling, persistence scheduling, workspace tracking, reveal/navigation behavior, and UI/session coordination. `SideNote2View.ts` also mixed rendering, edit interactions, card behavior, and session glue.\n\nThat is why those areas moved up the queue. If one file changes for five unrelated reasons, it is harder to read, harder to test, and every edit carries more regression risk.",
        "timestamp": 1774934181001
      }
    ],
    "createdAt": 1774934181001,
    "updatedAt": 1774934181001
  },
  {
    "id": "5fc13ee8-2cea-4f30-b83a-11165ae8134c",
    "startLine": 50,
    "startChar": 5,
    "endLine": 50,
    "endChar": 46,
    "selectedText": "Is it on the read path or the write path?",
    "selectedTextHash": "1f6015a570aaab062da037dbd1ab3aec2192ca960ca226d89b28ba2c26731929",
    "entries": [
      {
        "id": "5fc13ee8-2cea-4f30-b83a-11165ae8134c",
        "body": "This was a risk filter. Read-only or derived flows were safer to extract first because they usually do not mutate the canonical note-backed comment data.\n\nExample from this refactor:\n- highlight(editor highlight decorations in source/live preview) and preview behavior moved out early into `commentHighlightController.ts`\n- aggregate and derived logic like `allCommentsNote.ts` and derived metadata were also safer than canonical note writes\n- canonical write flow stayed concentrated until `commentPersistenceController.ts` was ready\n\nSo this question really meant: if we make a mistake here, do we break rendering, or do we corrupt the stored source of truth?",
        "timestamp": 1774934181002
      }
    ],
    "createdAt": 1774934181002,
    "updatedAt": 1774934181002
  },
  {
    "id": "a4c5a2db-b83f-4b0b-a261-b282d8fdf7b2",
    "startLine": 53,
    "startChar": 5,
    "endLine": 53,
    "endChar": 45,
    "selectedText": "Can it be given a narrow host interface?",
    "selectedTextHash": "1f8d4a66f224a1bc473908dd89eef4ec817b2c450f63d8ca513760ae9517031c",
    "entries": [
      {
        "id": "a4c5a2db-b83f-4b0b-a261-b282d8fdf7b2",
        "body": "This means: can we extract the behavior without handing the new module the whole plugin object?\n\nA good candidate only needs a small host surface, usually a handful of callbacks. For example, the extracted controllers depend on limited capabilities such as “get active file”, “persist comments”, “refresh editor decorations”, or “open a comment by id” rather than direct access to every field on `main.ts`.\n\nThat mattered because a narrow host interface keeps dependencies explicit. If extraction only works by passing the whole plugin everywhere, the move is mostly cosmetic and the coupling is still there.",
        "timestamp": 1774934181003
      }
    ],
    "createdAt": 1774934181003,
    "updatedAt": 1774934181003
  },
  {
    "id": "843d66f5-d316-48d7-b122-35caeb11b68e",
    "startLine": 56,
    "startChar": 5,
    "endLine": 56,
    "endChar": 69,
    "selectedText": "Does it own persistent state, transient state, or derived state?",
    "selectedTextHash": "07a83ae15156f8887e3300dca16021ea6830fa818867eb15e70012f75c06a7ee",
    "entries": [
      {
        "id": "843d66f5-d316-48d7-b122-35caeb11b68e",
        "body": "This asks what kind of state the code is really responsible for, because those categories should not be blurred together.\n\nIn this repo:\n- persistent state is the canonical note-backed comment data in storage files like `noteCommentStorage.ts`\n- transient state is session/UI state such as the current draft or revealed comment, later moved into `DraftSessionStore.ts` and `RevealedCommentSelectionStore.ts`\n- derived state is recomputed output such as `SideNote2 index.md`, highlight ranges, and derived metadata\n\nThe refactor kept separating these because persistent, transient, and derived state fail in different ways and should have different owners.",
        "timestamp": 1774934181004
      }
    ],
    "createdAt": 1774934181004,
    "updatedAt": 1774934181004
  },
  {
    "id": "6604d952-58c7-4d0f-a978-5aef52c49c4c",
    "startLine": 59,
    "startChar": 5,
    "endLine": 59,
    "endChar": 44,
    "selectedText": "Will this extraction unlock later ones?",
    "selectedTextHash": "d5f2deffb770cd558b5e9213e00446c50880b774a34eb55e3e171ca4e6f27ba7",
    "entries": [
      {
        "id": "6604d952-58c7-4d0f-a978-5aef52c49c4c",
        "body": "This means a move might be worth doing even if it is not the worst mess yet, because it creates a landing zone for the next few steps.\n\nExamples from this refactor:\n- re-bucketing `src/core/*` unlocked later controller and helper extractions because there were already semantic destinations\n- extracting stores unlocked cleaner session and sidebar interaction code\n- thinning `main.ts` unlocked the later split of `SideNote2View.ts` because the UI finally had stable backend seams to lean on\n\nSo the question was not only “is this bad now?” but also “does this make the next two or three moves safer?”",
        "timestamp": 1774934181005
      }
    ],
    "createdAt": 1774934181005,
    "updatedAt": 1774934181005
  },
  {
    "id": "56f8dcde-3f89-41da-a802-42d36d93aaf2",
    "startLine": 62,
    "startChar": 5,
    "endLine": 62,
    "endChar": 63,
    "selectedText": "Will the result be more testable, or just more fragmented?",
    "selectedTextHash": "b597605dbaea668f8865a9ccd5da2d51234d946ba3d3f383e673cd6f73532c11",
    "entries": [
      {
        "id": "56f8dcde-3f89-41da-a802-42d36d93aaf2",
        "body": "This was the anti-refactor-for-appearance check. A split was only worth it if it created real test seams or clearer ownership.\n\nGood splits in this refactor:\n- planner/controller pairs, because pure decision logic became testable without Obsidian\n- stores, because transient state gained explicit owners and straightforward tests\n\nMoves that were deliberately not pushed further:\n- `main.ts` remained the composition root\n- `SideNote2View.ts` remained the sidebar shell\n- `commentManager.ts` remained central\n\nIf a split would only create wrapper files and extra indirection, it was postponed or rejected.",
        "timestamp": 1774934181006
      }
    ],
    "createdAt": 1774934181006,
    "updatedAt": 1774934181006
  },
  {
    "id": "7437f21c-0eb8-477c-9658-1b62b189e9e1",
    "startLine": 75,
    "startChar": 0,
    "endLine": 75,
    "endChar": 34,
    "selectedText": "1. Start with naming and packaging",
    "selectedTextHash": "ecd7cf9b50baa5c37c5c28550e4faf5e1334bb036b4e86af9a2a15cde0f64902",
    "entries": [
      {
        "id": "7437f21c-0eb8-477c-9658-1b62b189e9e1",
        "body": "Example from this refactor:\n- `src/core/anchorResolver.ts` moved to `src/core/anchors/anchorResolver.ts`\n- `src/core/noteCommentStorage.ts` moved to `src/core/storage/noteCommentStorage.ts`\n- `src/core/allCommentsNote.ts` moved to `src/core/derived/allCommentsNote.ts`\n\nWhy this had to happen first:\n- later extractions from `main.ts` already had a semantic landing zone\n- highlight work could depend on `core/derived/editorHighlightRanges.ts` and `core/anchors/anchorResolver.ts` without inventing folder structure mid-refactor\n- it reduced accidental coupling before behavior changed, so anchors, storage, and derived views stopped reading like one subsystem",
        "timestamp": 1774933651001
      }
    ],
    "createdAt": 1774933651001,
    "updatedAt": 1774933651001
  },
  {
    "id": "6c48ac14-4575-4a53-86d1-cdbef3860680",
    "startLine": 86,
    "startChar": 1,
    "endLine": 86,
    "endChar": 54,
    "selectedText": "2. Thin `main.ts` before touching the sidebar heavily",
    "selectedTextHash": "1a274bfd0178346c9a7850fe1a657e362369606a8b898c77a3b39a96d470ee9f",
    "entries": [
      {
        "id": "6c48ac14-4575-4a53-86d1-cdbef3860680",
        "body": "Example from this refactor:\n- entry flow became `commentEntryController.ts`\n- reveal/navigation became `commentNavigationController.ts`\n- persistence became `commentPersistenceController.ts`\n- workspace, lifecycle, and registration each got their own controller\n\nWhy this came before the sidebar split:\n- `main.ts` was the unstable center, so it had to become a composition root first\n- once those seams existed, `SideNote2View.ts` could call stable control-layer entry points instead of reaching into one giant plugin file\n- later UI pieces like `sidebarDraftEditor.ts` and `sidebarInteractionController.ts` were cleaner because the backend policy already lived elsewhere",
        "timestamp": 1774933651002
      }
    ],
    "createdAt": 1774933651002,
    "updatedAt": 1774933651002
  },
  {
    "id": "0fe9360d-1133-4d16-9208-d3c352c3852d",
    "startLine": 99,
    "startChar": 1,
    "endLine": 99,
    "endChar": 57,
    "selectedText": "3. Separate “what should happen” from “talk to Obsidian”",
    "selectedTextHash": "9c35cea12c552841a6ff1b6c346d5eb300d6b5a7f70da5ed98c8d3e1637e9c6f",
    "entries": [
      {
        "id": "0fe9360d-1133-4d16-9208-d3c352c3852d",
        "body": "Concrete examples:\n- `commentNavigationPlanner.ts` decides leaf/reveal policy; `commentNavigationController.ts` opens files and focuses views\n- `workspaceContextPlanner.ts` decides target-file and mode policy; `workspaceContextController.ts` reacts to workspace events\n- `indexNoteSettingsPlanner.ts` validates rename/path changes; `indexNoteSettingsController.ts` performs vault operations\n\nWhy this ordering helped:\n- pure policy became testable in Node without booting Obsidian\n- side-effecting code stayed at the runtime edge\n- behavior could change with smaller tests and less risk than editing plugin integration code directly",
        "timestamp": 1774933651003
      }
    ],
    "createdAt": 1774933651003,
    "updatedAt": 1774933651003
  },
  {
    "id": "2b1ae3ff-b5af-4556-80f9-9a39fa7be9fd",
    "startLine": 108,
    "startChar": 1,
    "endLine": 108,
    "endChar": 47,
    "selectedText": "4. Extract state stores before UI session glue",
    "selectedTextHash": "3a10a5c33d8a9ebd4c43f89cb66f38186dc55a1a18ab66f26b062254388c5faa",
    "entries": [
      {
        "id": "2b1ae3ff-b5af-4556-80f9-9a39fa7be9fd",
        "body": "In SideNote2:\n\n  - the real saved work is the stored comment in the note\n  - the temporary “right now” stuff is:\n      - the current draft\n      - the currently revealed comment\n      - whether a draft is saving\n\n  The refactor says:\n\n  - don’t leave all that “right now” stuff inside one giant brain\n    (main.ts)\n  - give it small labeled boxes\n\n  So:\n\n  - one small box for draft state\n  - one small box for revealed comment state\n\n  Then later code can say:\n\n  - “ask the draft box what is being edited”\n  - “ask the reveal box what comment is active”\n\n  instead of:\n\n  - “go dig inside the giant main file and hope the right flag is\n    there”\n\n  So in very simple terms:\n\n  - store = a small labeled box for temporary app memory\n  - UI session glue = the code that reacts to those boxes and updates\n    the screen",
        "timestamp": 1774933651004
      }
    ],
    "createdAt": 1774933651004,
    "updatedAt": 1774933651004
  },
  {
    "id": "da6f3237-e1fe-48f2-9baf-0bf6166ebd5d",
    "startLine": 122,
    "startChar": 0,
    "endLine": 122,
    "endChar": 54,
    "selectedText": "5. Refactor the sidebar after the app shell was stable",
    "selectedTextHash": "fffd7bf0b800825117a6e570c9f285a8fc17d1d7b5cc6f99e050f4924fafe39f",
    "entries": [
      {
        "id": "da6f3237-e1fe-48f2-9baf-0bf6166ebd5d",
        "body": "Example from the actual sequence:\n- only after the control/state layer was in place did we extract `sidebarDraftEditor.ts`, `sidebarPersistedComment.ts`, `sidebarDraftComment.ts`, and `sidebarInteractionController.ts`\n\nWhy that order was safer:\n- the UI refactor could focus on rendering, edit interactions, focus behavior, and DOM events\n- persistence, navigation, workspace policy, and session ownership were already stabilized elsewhere\n- this avoided refactoring two unstable layers at once: sidebar DOM structure and plugin-shell behavior",
        "timestamp": 1774933651005
      }
    ],
    "createdAt": 1774933651005,
    "updatedAt": 1774933651005
  },
  {
    "id": "8da8a4f1-ee3e-4f5e-a48e-8c7f8ef763d9",
    "startLine": 126,
    "startChar": 1,
    "endLine": 126,
    "endChar": 44,
    "selectedText": "6. Stop when the remaining code is cohesive",
    "selectedTextHash": "6ffb9c0139bcd6f86d3211a6ae96e15ab96faf6286da00d4426e823dc8ffbb3b",
    "entries": [
      {
        "id": "8da8a4f1-ee3e-4f5e-a48e-8c7f8ef763d9",
        "body": "What this meant in our codebase:\n- we intentionally kept `main.ts` as the composition root\n- we intentionally kept `SideNote2View.ts` as the sidebar shell\n- `commentManager.ts` also stayed central as the in-memory owner of comment CRUD and grouping\n\nWhy stopping there was correct:\n- the remaining files already had stable roles: controller, planner, store, shell, helper\n- more splitting would mostly add indirection rather than clarity\n- the goal was lower responsibility density, not maximum file count",
        "timestamp": 1774933651006
      }
    ],
    "createdAt": 1774933651006,
    "updatedAt": 1774933651006
  }
]
-->
