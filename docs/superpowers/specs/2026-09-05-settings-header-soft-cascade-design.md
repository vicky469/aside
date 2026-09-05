# Settings Header Soft-Cascade Reveal Design

**Date:** 2026-09-05
**Status:** Approved design; pending implementation plan

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] The Settings header uses one stable DOM composition: Rabbit, Thought card, signal, Aside card, action line, and Thought Trail graph.
- [x] Opening or rebuilding the Settings tab creates a fresh header, while closing it removes the animated DOM.
- [x] The existing header provides a static completed composition under `prefers-reduced-motion: reduce`.
- [x] Three animation directions were reviewed visually: strict sequence, soft cascade, and two-act reveal.
- [x] The user selected the soft cascade and confirmed it should replay every time the Settings screen opens.

### To Implement

- [ ] Hide every downstream relay element at the beginning instead of rendering the complete relay immediately.
- [ ] Reveal the Rabbit, Thought card, signal, Aside card, action line, and Thought Trail graph in that order with short overlaps between adjacent transitions.
- [ ] Preserve the existing header DOM, layout dimensions, copy, colors, graph geometry, and scoped CSS architecture.
- [ ] Start the existing Rabbit idle motion, graph turn, and edge-runner motion only after the staged story is legible.
- [ ] Preserve the immediate completed static state for reduced-motion users.
- [ ] Update focused animation tests and run full repository verification.

### Verification

- [ ] Focused tests prove hidden initial states, ordered soft-cascade timing, finite entrance animations, delayed continuous ambient motion, and the reduced-motion final state.
- [ ] Manual inspection confirms the header has no layout jump, reveals one conceptual element at a time, and replays on every Settings open.
- [ ] Full tests, lint, typecheck, Obsidian compliance, production bundle, bundle-size guard, and release-artifact inspection pass.

## Context

The current Settings header animates movement and emphasis, but the Rabbit, Thought card, and Aside card are already visible on the first frame. The result reads as a completed illustration receiving effects rather than a story assembling over time. The intended experience is progressive: first the Rabbit, then the Thought card, then the rest of the workflow.

The user chose a soft cascade over a strict sequence. Each new element still has a distinct entrance, but adjacent transitions overlap briefly so the animation remains fluid and does not feel slow.

## Selected Experience

The entrance is a single five-second CSS timeline. Its visible story is:

1. The Rabbit fades and lifts into place.
2. The Thought card begins sliding in as the Rabbit settles.
3. The signal appears and travels toward Aside.
4. The Aside card fades in with its existing accent glow.
5. The action line settles beneath the Aside card.
6. The Thought Trail graph reveals and its nodes finish assembling.
7. The existing subtle Rabbit idle motion, graph turn, and contained edge runners continue.

Adjacent entrances overlap by roughly 150–250 milliseconds. No two conceptual elements begin at exactly the same time. The complete relay becomes legible before continuous motion takes over.

The animation replays whenever the Settings screen opens because the existing lifecycle creates a new header DOM tree. Aside stores no replay preference or session state.

## Timing Model

The implementation uses one shared five-second introduction duration with these target windows:

| Element | Entrance window |
| --- | --- |
| Rabbit | 0.00–0.40 seconds |
| Thought card | 0.45–0.85 seconds |
| Signal | 0.75–1.15 seconds |
| Aside card | 1.05–1.50 seconds |
| Action line | 1.40–1.85 seconds |
| Thought Trail graph | 1.75–3.20 seconds |
| Ambient motion handoff | begins around 3.35 seconds |

These windows are targets rather than a new runtime data model. CSS keyframes remain the source of truth. Small adjustments are acceptable during visual verification when they preserve the selected order, soft overlap, and five-second overall cadence.

## Architecture

Keep `asideSettingsHeaderArt.ts` unchanged unless a stable class hook is genuinely missing. The existing semantic and decorative DOM is already sufficient. `styles.css`, scoped beneath `.aside-settings-tab .aside-settings-hero`, owns the entire change.

Each relay element receives an initial hidden state and a finite entrance keyframe that retains its completed state. Opacity and small transforms provide the reveal while every element occupies its final layout position from the first frame. This avoids reflow and layout jumps.

The existing infinite animations remain limited to the Rabbit, graph scene, and edge runners. Their delays move to the post-assembly handoff so they do not override an entrance transform or distract from the staged sequence. No JavaScript timer, animation event handler, persisted setting, dependency, asset, or additional DOM wrapper is introduced.

## Accessibility and Motion

The existing semantic label and `aria-hidden` decorative art remain unchanged. Meaning does not depend on watching the sequence.

Under `prefers-reduced-motion: reduce`, all entrance and ambient animations remain disabled. Every hidden initial state is explicitly overridden so the Rabbit, cards, signal, action, and graph appear immediately in their completed static form. Replaying the Settings screen does not animate for these users.

## Responsive and Visual Stability

The current grid, narrow-pane breakpoint, graph dimensions, monospace typography, and theme-derived colors remain unchanged. Hidden elements continue occupying their final grid cells. Entrance transforms are small and do not alter document flow, container size, or scroll position.

The change must not add a card surface around the header, change the existing ASCII art, or modify any settings control below it.

## Testing Strategy

Extend `tests/asideSettingsHeaderArt.test.mjs` to verify:

- Rabbit, Thought card, signal glyphs, Aside card, action line, and graph stage have finite one-shot entrance animations;
- their keyframes begin from hidden states and reveal in the approved order;
- the shared introduction lasts five seconds;
- Rabbit idle, graph turn, and edge runners begin only at the ambient handoff and remain the only infinite animations;
- reduced-motion rules remove all animations and expose the complete static composition; and
- all new selectors remain scoped to the Aside Settings tab.

Run the focused test first, then the full build pipeline. Manual acceptance should open, close, and reopen Settings to confirm replay behavior and inspect normal and narrow widths for visual jumps.

## Alternatives Considered

- **Strict sequence:** clearest ordering, but the pauses made the story feel slower than necessary.
- **Soft cascade:** selected; preserves distinct entrances while short overlaps make the animation feel continuous.
- **Two-act reveal:** faster, but grouping the signal and Aside card weakened the requested one-at-a-time progression.

## Non-Goals

- Changing header copy, art, graph geometry, color palette, sizing, or settings layout.
- Adding a replay button, animation preference, onboarding state, or once-per-session behavior.
- Animating any non-Settings surface.
- Adding JavaScript-driven animation, external assets, or third-party dependencies.
- Changing the Agent tab, agent execution, script workflows, or other recently graduated agent behavior.
