# Aside Settings ASCII Thought Trail Header Design

**Date:** 2026-09-04
**Status:** Approved; implementation pending

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside has one settings-tab renderer and an `aside-settings-tab` scope class.
- [x] The settings header concept was reviewed as live motion mockups.
- [x] The user approved the Rabbit relay, instructional copy, brain-shaped Thought Trail graph, one-shot reveal, and contained idle edge motion.
- [x] Diagon's upstream repository and MIT license were reviewed; the approved design uses original art and no Diagon code, generated output, package, or asset.

### To Implement

- [ ] Add a focused settings-header renderer with original ASCII/Unicode art and accessible text.
- [ ] Render the header above the first Aside settings section without changing the settings catalog or control behavior.
- [ ] Implement the approved staged entrance and the settled, contained blue-dot edge motion with scoped CSS.
- [ ] Make the header theme-aware, responsive at narrow settings widths, and static under reduced-motion preferences.
- [ ] Add focused renderer and stylesheet regression coverage.

### Verification

- [ ] Focused tests prove the approved copy, semantic labeling, animation phases, contained runners, and reduced-motion behavior.
- [ ] Full tests, lint, typecheck, Obsidian compliance, production bundle, and release-artifact guard pass.
- [ ] The installed plugin is visually checked in light and dark themes at normal, narrow, and mobile-like settings widths.
- [ ] The completed entrance and idle motion are checked to ensure every moving dot remains inside its assigned edge.

## Context

Aside's settings page is functional but visually anonymous. A compact animated header can teach the plugin's core interaction model while giving the settings page a recognizable identity.

The header must communicate two ideas without becoming a product tour:

1. A rabbit relays a thought into Aside, followed by the instruction `save highlight, add comment, ask @agent`.
2. The result expands into an abstract brain-shaped graph labeled `thought trail`.

The animation should feel alive but not demand continuous attention. The entrance is a one-shot sequence. After it completes, only a few blue dots continue moving slowly within selected graph edges.

## Approved Experience

The header appears at the top of the Aside settings tab, before the first settings heading. It is one cohesive canvas with no divider between its two visual beats.

### Beat 1: Rabbit Relay

The first beat preserves the approved composition:

```text
 /)/)  ┌─────────┐  ·──▶  ┌─────────┐
( . .) │ thought │        │  ASIDE  │
 /づ   └─────────┘        └────┬────┘
                                ╰─ save highlight, add comment, ask @agent
```

The rabbit gives Aside a light personality while the action line teaches all three anchored-note paths:

- Saving an empty anchored note preserves a highlight.
- Saving words adds a comment.
- Mentioning `@agent` requests an agent reply.

The wording remains lowercase and comma-separated exactly as approved.

### Beat 2: Thought Trail

After the relay completes, an original rounded brain-shaped network grows beneath it. The graph is abstract: curved box-drawing edges and dot nodes imply a mind without drawing a literal face, tree, or set of wiki-link labels.

The caption `thought trail` appears below the completed graph. The graph communicates connected thinking visually; the caption supplies the product term.

### Settled Motion

The entrance animations run once and hold their final state. After the full composition is visible, a small set of accent-colored dot runners moves continuously along selected horizontal graph edges.

Each runner belongs to a dedicated edge-track element. That track clips overflow, and the runner reverses at its endpoints. A runner cannot leave its assigned line, cross empty space, or move over the settings controls. Durations and start offsets vary slightly so the motion feels organic rather than synchronized.

## Architecture

Add a focused `asideSettingsHeaderArt` UI module responsible only for constructing the header DOM. `AsideSetting` calls it immediately after clearing the settings container and before `renderLegacyAsideSettings` adds headings and controls.

The renderer uses Obsidian's DOM helpers and text nodes. It does not use `innerHTML`, a canvas, SVG, image assets, network requests, timers, or a third-party animation library. The graph line segments, node dots, and moving runners are explicit elements with stable Aside-scoped class names.

`styles.css` owns presentation and timing under `.aside-settings-tab .aside-settings-hero`. CSS keyframes provide:

- the one-shot relay entrance;
- the one-shot graph reveal and node settling;
- delayed, infinite runner motion after the reveal;
- the final held state through `animation-fill-mode: forwards`;
- a static final composition for reduced-motion users.

The feature stores no settings and reads no vault data. The displayed graph is illustrative, not a rendering of a user's current Thought Trail.

## Rendering and Animation Lifecycle

Opening or rebuilding the settings tab creates a new header DOM tree and begins the entrance sequence. Each entrance animation has one iteration and retains its completed frame. Edge runners have delays at least as long as the entrance sequence, so idle motion cannot begin before the graph is fully visible.

After their delay, runners alternate direction forever within their tracks. The plugin does not add a custom animation loop or lifecycle timer; the browser remains free to throttle CSS animation when the settings UI is not visible.

If Obsidian rebuilds the settings DOM, replaying the short entrance is acceptable. No persistent "already played" state is introduced.

## Responsive Design

The header remains within the settings content width and uses Obsidian theme variables for its border, surface, text, muted text, and accent color.

The two art beats are separate layout rows within the same undivided visual flow. Their monospace font size scales within a bounded range. The instructional text is a separate monospace element rather than one unbreakable preformatted line, so narrow layouts can wrap at the commas without shrinking below a readable minimum.

The abstract graph is compact enough for a narrow pane. Its edge tracks have fixed character widths, preventing runner bounds from changing independently of the visible line. No horizontal page overflow is introduced.

## Accessibility

- The decorative glyph grid is hidden from the accessibility tree.
- The header has a concise semantic description covering the three actions and the Thought Trail concept.
- The visible instructional line remains real text, not an image.
- Meaning does not depend on accent color or motion.
- Under `prefers-reduced-motion: reduce`, the completed relay, graph, nodes, and label render immediately; runners remain stationary inside their tracks.
- The header is not interactive and does not enter the keyboard tab order.

## Performance and Failure Behavior

The header is static DOM plus scoped CSS. A small fixed number of runner spans animate, and each is clipped by a short edge-track parent. There is no `requestAnimationFrame` loop, interval, event subscription, or data fetch.

If a theme lacks an optional visual variable, the CSS falls back to standard Obsidian surface and text variables. If animation support is limited, the content remains readable in its final layout. A rendering failure cannot affect settings persistence or any plugin feature because the header has no connection to settings state.

## Attribution and Licensing

The linked [Diagon project](https://github.com/ArthurSonzogni/Diagon) was reviewed as inspiration. Its [MIT license](https://github.com/ArthurSonzogni/Diagon/blob/main/LICENSE) identifies Arthur Sonzogni as the copyright holder. The approved Aside header does not incorporate Diagon source, generated diagrams, package code, or other substantial material, so the shipped implementation does not require Diagon's copyright and permission notice.

All art and animation code for this feature must remain original. If implementation later introduces any Diagon material, work stops until the MIT notice is included in an appropriate third-party notices location and the visible project credit is agreed with the user.

## Testing Strategy

Focused tests should verify:

- the header is rendered before the first settings heading;
- the exact visible copy is `save highlight, add comment, ask @agent`;
- the visible graph caption is `thought trail`;
- the decorative art is hidden from assistive technology and the header has a useful semantic label;
- entrance animation rules are one-shot and hold their final frame;
- idle runners start only after the entrance, alternate direction, and are clipped by their edge tracks;
- reduced-motion rules remove both entrance and idle movement while preserving the final content;
- all selectors remain scoped to the Aside settings tab.

Repository-level verification runs the full test, lint, typecheck, Obsidian compliance, bundle, and release-artifact checks. Manual acceptance covers both themes, normal and narrow panes, mobile-like width, entrance ordering, instruction wrapping, runner containment, reopening behavior, and reduced motion.

## Non-Goals

- Rendering live vault data or the current note's real Thought Trail.
- Adding settings to customize, replay, pause, or hide the header.
- Using Diagon, a diagram generator, canvas, SVG, images, or external animation dependencies.
- Adding a literal human face, tree, wiki-link labels, or a large mascot illustration.
- Changing any existing setting, setting heading, feature flag, sidebar behavior, agent behavior, or persisted data.
