# Quality Model Reflection

## Why this note exists

We keep fixing visible bugs late, after behavior has already drifted.
The recurring problem is not only implementation quality. It is model quality.

We do not yet have a stable map of:

- what the system is at each granularity
- what state is allowed
- what events move that state
- what invariants must remain true before we ship

That makes the plugin feel correct locally, then fail on:

- a new machine
- a fresh vault layout
- a missing sidebar leaf
- a stale derived note
- a release packaging edge case

The fix is not “more ad hoc testing”.
The fix is a clearer system model and a cleaner event discipline.

This note proposes using a lightweight B-Method / Event-B style process for Aside.

## Core idea

For each important subsystem, define:

1. Context
   What external objects and assumptions exist.
2. Variables
   What state this subsystem owns.
3. Invariants
   What must always remain true.
4. Events
   What transitions are allowed.
5. Observations
   What we can inspect in tests or live Obsidian to prove the invariants still hold.

This gives us a map at multiple levels, instead of one giant informal understanding.

## Main diagnosis

Recent bugs were mostly failures of missing or weak invariants:

- `aside-view` disappeared on a fresh machine because we had no invariant saying the plugin must maintain one usable sidebar entry surface.
- Ribbon behavior drifted because the action no longer had a stable contract.
- Index reverse navigation kept regressing because we modeled target identity and rendered presence inconsistently.
- Index list limit felt broken because the sampled list had no invariant connecting active selection and visibility.
- Release tags drifted from manifest versions because release state was not modeled as a strict machine.

These are not random bugs.
They are model holes.

## The model map we need

We should keep explicit models at five granularities.

### 1. Product model

This is the user-visible contract.

State:

- plugin enabled or disabled
- sidebar usable or not usable
- index note available or not available
- release track and shipped version

Key invariants:

- If the plugin is enabled, the user has a discoverable entry point.
- If the plugin is enabled, the user can reach `Aside index.md`.
- If the plugin is enabled, the user can reach a working `aside-view`.
- Latest shipped GitHub release must correspond to the intended fix.

Key events:

- plugin enabled
- plugin disabled
- ribbon click
- sidebar reveal
- release tagged

### 2. Workspace model

This is the Obsidian leaf/layout model.

State:

- active markdown leaf
- active sidebar leaf
- existing `aside-view` leaves
- existing index markdown leaves
- workspace layout ready or not

Key invariants:

- At most one canonical `aside-view` should be managed by the plugin.
- If no `aside-view` exists and the plugin is enabled, one can be recreated.
- Ribbon action must not create unbounded duplicate leaves.
- Opening index note must target a markdown tab, not the sidebar leaf.

Key events:

- layout ready
- file open
- active leaf change
- sidebar leaf detached
- plugin reload

### 3. Comment domain model

This is the canonical data model.

State:

- draft comments
- persisted comments
- resolved comments
- orphaned comments
- aggregate comment index

Key invariants:

- canonical note-backed comment data is the source of truth
- aggregate index must agree with current source files
- deleted files must not survive in the aggregate note
- derived views must not invent comment identity

Key events:

- create draft
- save draft
- resolve
- unresolve
- edit
- delete file
- rename file

### 4. Derived view model

This covers `Aside index.md`, index sidebar list, and thought trail.

State:

- generated index note content
- revealed comment id
- list mode or thought-trail mode
- root file filter
- rendered preview sections

Key invariants:

- index note rows preserve exact comment identity
- list and thought trail use the same file-scope semantics
- active comment must be representable in the current visible scope
- index highlight owner must be singular
- derived views must never silently point to missing source files

Key events:

- regenerate index note
- click index ref
- click sidebar card
- set file filter root
- clear file filter root
- switch list/thought-trail mode

### 5. Release model

This is the shipping machine.

State:

- working tree clean or dirty
- package version
- manifest version
- tag version
- remote release status

Key invariants:

- `package.json.version == manifest.json.version == tag`
- release artifact contains only intended public files
- no `sourceMappingURL`
- no `sourcesContent`
- no raw `.ts`, `.tsx`, or `.map` files in shipped root artifacts
- GitHub latest must point to the intended normal release

Key events:

- version bump
- release check
- commit release
- tag release
- push tag
- GitHub workflow publish

## Why B-Method / Event-B helps here

The value is not academic notation for its own sake.
The value is forcing ourselves to separate:

- state
- invariants
- transitions
- proof obligations

For Aside, that means:

- stop mixing workspace state with product expectations
- stop mixing derived-view bugs with canonical-data bugs
- stop treating release drift as an afterthought

In practice, our Event-B style question for every change should be:

1. What machine is changing?
2. What variables does it own?
3. Which invariant is at risk?
4. Which event is being introduced or modified?
5. What observable check proves the invariant still holds?

## Practical template for future work

Every meaningful feature or bugfix should answer this checklist before code is considered done.

### A. Machine

- Which model level is affected:
  - product
  - workspace
  - comment domain
  - derived view
  - release

### B. Variables

- What exact state changed?
- Which file or controller owns it?

### C. Invariants

- What must remain true after the change?
- Which old bug would reappear if this invariant breaks?

### D. Events

- What user/system event triggers the transition?
- Is the event idempotent?
- Can repeated firing create duplicates?

### E. Observations

- Which unit test proves it?
- Which live Obsidian CLI check proves it?
- Which release artifact check proves it?

## Recommended verification map

We should maintain one verification table per subsystem.

### Workspace and sidebar

Checks:

- `getLeavesOfType("aside-view").length`
- right-sidebar leaf state
- active file after ribbon click
- no duplicate index tabs after repeated clicks

### Index derived views

Checks:

- generated row identity by `commentId`
- sidebar list scope count
- highlighted row count in preview DOM
- file filter root and connected-file count

### Comment lifecycle

Checks:

- saved comment still exists after rename
- deleted file disappears from aggregate note
- resolved-only mode flips correctly on reopen

### Release

Checks:

- release tag matches manifest version
- `npm run release:check`
- direct shipped-file inspection
- GitHub latest release API

## What should change in our process

### 1. Every bugfix should name the broken invariant

Bad:

- “fixed sidebar bug”

Better:

- “restored invariant: enabled plugin always has one usable `aside-view` entry surface”

### 2. Every feature spec should include event/state sections

We already write plans and specs.
They should consistently include:

- machine
- variables
- invariants
- events
- observations

### 3. We should keep a map, not just prose

We already have useful diagrams:

- [architecture.md](architecture.md)
- [comment-route-map.canvas](comment-route-map.canvas)
- [comment-lifecycle.canvas](comment-lifecycle.canvas)

The next missing map is a quality map:

- subsystem
- invariant
- owning code
- proof test
- live check

### 4. Release should be treated as a machine, not a script

The release pipeline has already shown this clearly.
Version drift is a state-machine bug.
It should be modeled and checked like any other subsystem.

## Immediate next step

Create a follow-up note or canvas for:

- `Machine -> Variables -> Invariants -> Events -> Observations`

for these first machines:

1. Sidebar workspace machine
2. Index derived-view machine
3. Release machine

Those three cover most of the regressions we have been seeing.

## Sidebar Toolbar State

This concern now lives in its own note:

- [button-state.md](button-state.md)

That split is intentional.

- `quality-model-reflection.md` stays about the cross-cutting modeling approach
- `button-state.md` is the concrete toolbar-state reference

## Bottom line

We do not only need better implementation.
We need better control of correctness at multiple levels.

The practical rule going forward is:

- no feature is “done” until its machine is named
- its invariants are written
- its events are clear
- and we can observe proof of those invariants in tests or live Obsidian

That is how we get more confident to ship.
