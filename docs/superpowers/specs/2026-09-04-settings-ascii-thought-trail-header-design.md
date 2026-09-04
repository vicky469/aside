# Aside Settings ASCII Thought Trail Header Design

**Date:** 2026-09-04
**Status:** Implemented and verified

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside has one settings-tab renderer and an `aside-settings-tab` scope class.
- [x] The settings header concept was reviewed as live motion mockups.
- [x] The user approved the Rabbit relay and concise instructional copy.
- [x] The user selected the original three-plane impossible-junction direction after reviewing animated 3D options and approved continuous graph motion limited to the settings window lifetime.
- [x] The accessible settings-header renderer and legacy settings mount point were implemented and verified in `e9409ed` without changing the settings catalog.
- [x] Diagon's upstream repository and MIT license were reviewed; the approved design uses original art and no Diagon code, generated output, package, or asset.

### To Implement

- [x] Refine the renderer's flat graph scaffold into the approved original three-plane impossible-junction Thought Trail.
- [x] Prepend the header through the Obsidian 1.13 declarative settings path while retaining the Obsidian 1.12.7 legacy fallback.
- [x] Implement the finite Rabbit relay entrance, subtle idle sway, continuous 3D graph turning, and contained blue-dot edge motion with scoped CSS.
- [x] Remove the settings-header DOM on `hide()` so no animated element or related resource survives the settings window.
- [x] Make the header theme-aware, responsive at narrow settings widths, and static under reduced-motion preferences.
- [x] Extend focused renderer, lifecycle, and stylesheet regression coverage for the revised design.

### Verification

- [x] Focused tests prove the approved copy, semantic labeling, three-plane structure, split animation lifecycle, contained runners, `hide()` cleanup, and reduced-motion behavior.
- [x] Full tests, lint, typecheck, Obsidian compliance, production bundle, and release-artifact guard pass.
- [x] The installed plugin is visually checked in light and dark themes at normal, narrow, and mobile-like settings widths.
- [x] The completed entrance and continuous motion are checked to ensure every moving dot remains inside its assigned edge and only the Rabbit idle loop and 3D graph remain animated.
- [x] Closing the settings window is checked to confirm the header DOM is removed and no animation resource remains active.

Verification used Obsidian 1.13.7 in the `dev` vault. The final full build passed 1,628 tests, produced a 691,008-byte bundle within the 750,000-byte policy, and passed the exact three-file source-exposure guard. Live DOM acceptance covers the entrance/cleanup lifecycle, continuous Rabbit idle motion, bounded scene turn, six clipped runners, static reduced-motion state, both themes, and no overflow at the settings window's 600px minimum width.

## Context

Aside's settings page is functional but visually anonymous. A compact animated header can teach the plugin's core interaction model while giving the settings page a recognizable identity.

The header must communicate two ideas without becoming a product tour:

1. A rabbit relays a thought into Aside, followed by the instruction `add comment, @agent reply`.
2. The result expands into a compact brass-lit three-dimensional impossible-junction graph.

The Rabbit relay plays once, then settles into a subtle one-pixel idle sway. The Thought Trail remains alive: its spatial graph turns continuously while a few blue dots move within selected edges. This persistent motion exists only in the settings tab, never in the Index or note sidebar.

## Approved Experience

The header appears at the top of the Aside settings tab, before the first settings heading. It is a compact, cardless composition with no divider, grey surface, or added bottom margin around its two visual beats.

### Beat 1: Rabbit Relay

The first beat preserves the approved composition:

```text
 /)/)  ┌─────────┐  ·──▶  ┌─────────┐
( . .) │ thought │        │  ASIDE  │
 /づ   └─────────┘        └────┬────┘
                                ╰─ add comment, @agent reply
```

The rabbit gives Aside a light personality. The comment card already makes anchored-note and highlight capture legible, so the action line names only the two behaviors that benefit from explicit copy: adding a comment and mentioning `@agent` for a reply. The wording remains lowercase and comma-separated exactly as approved.

### Beat 2: Thought Trail

After the relay begins, an original three-plane impossible-junction network assembles beneath it. The compact 160-by-112-pixel stage uses sparse box-drawing edges and dot nodes, with uninterrupted edges at the center rather than a heavy core marker. Perspective makes the same object read differently as it turns. Layered brass tones and a faint amber halo echo the illuminated projection mood the user likes in *Gödel, Escher, Bach* without copying its cover, letterforms, or geometry. The graph has no visible caption or square-frame nodes.

### Continuous Thought Trail Motion

The thought box, signal, Aside box, and instruction line animate once and hold their final state. The Rabbit's initial gesture hands off to a slow 3.8-second idle sway after 1.4 seconds. The graph scene begins its gentle bounded 3D perspective loop at 5.8 seconds, overlapping the tail of the seven-second reveal so there is no stop-and-restart handoff.

Each accent-colored runner belongs to a dedicated edge-track element on one graph plane. That track clips overflow, and the runner reverses at its endpoints. A runner turns with its plane but cannot leave its assigned line, cross empty space, or move over the settings controls. Durations and start offsets vary slightly so the motion feels organic rather than synchronized.

## Architecture

Keep the focused `asideSettingsHeaderArt` UI module responsible only for constructing the header DOM. On Obsidian 1.13+, `AsideSetting.getSettingDefinitions()` prepends one unsearchable custom-render definition that clears its empty setting-row chrome and mounts the header before the existing groups. The legacy `display()` fallback for the declared minimum Obsidian 1.12.7 calls the same renderer immediately after clearing the settings container and before `renderLegacyAsideSettings` adds headings and controls.

The renderer uses Obsidian's DOM helpers and text nodes. It does not use `innerHTML`, a canvas, SVG, image assets, network requests, timers, or a third-party animation library. A perspective stage contains one transform-preserving scene with three graph-plane elements. Graph edges, junction nodes, and moving runners are explicit elements with stable Aside-scoped class names.

`styles.css` owns presentation and timing under `.aside-settings-tab .aside-settings-hero`. CSS keyframes provide:

- the one-shot relay entrance and continuous subtle Rabbit idle motion;
- the one-shot graph assembly and reveal;
- delayed, infinite 3D scene turning that overlaps the reveal tail;
- delayed, infinite runner motion within plane-local edges that overlaps the reveal tail;
- the final held state through `animation-fill-mode: forwards`;
- a static final composition for reduced-motion users.

The feature stores no settings and reads no vault data. The displayed graph is illustrative, not a rendering of a user's current Thought Trail.

## Rendering and Animation Lifecycle

Opening or rebuilding the settings tab creates a new header DOM tree and begins the entrance sequence. The thought, signal, Aside box, action line, graph reveal, and node entrance each run once and retain their completed frame. The Rabbit idle animation, scene turn, and edge runners are the only infinite animations. Continuous graph motion begins once the graph is revealed but before the finite seven-second entrance timeline ends, avoiding a visible pause.

After their delay, the scene rocks continuously between shallow perspective angles and runners alternate direction within their tracks. The plugin does not add a custom animation loop, lifecycle timer, observer, or event subscription.

`AsideSetting.hide()` unloads its existing settings-only component and empties the settings container. This explicitly removes the animated DOM when the settings window closes or the user changes tabs, releasing the scene and its CSS animations. Reopening creates a new tree and replays the entrance; no persistent "already played" state is introduced.

## Responsive Design

The header remains within the settings content width, removes Obsidian's declarative card surface, and uses Obsidian theme variables for text, muted text, and accent color.

The two art beats are separate compact layout rows within the same undivided visual flow. Their monospace font size scales within a bounded range. The shortened instructional text remains one connected line at normal and standard narrow settings widths.

The compact three-plane graph remains safe in a narrow pane. Its stage is 160 by 112 pixels normally and steps down to 145 by 102 pixels at the narrow breakpoint. Edge tracks keep fixed character widths, preventing runner bounds from changing independently of the visible line. No horizontal page overflow is introduced.

## Accessibility

- The decorative glyph grid is hidden from the accessibility tree.
- The header has a concise semantic description covering comments, agent replies, and the Thought Trail concept.
- The visible instructional line remains real text, not an image.
- Meaning does not depend on accent color or motion.
- Under `prefers-reduced-motion: reduce`, the completed relay and three-plane graph render immediately; the Rabbit remains still, the scene does not turn, and runners remain stationary inside their tracks.
- The header is not interactive and does not enter the keyboard tab order.

## Performance and Failure Behavior

The header is static DOM plus scoped CSS. The Rabbit idle transform, one small scene transform, and six runner transforms animate, and each runner is clipped by a short edge-track parent. There is no `requestAnimationFrame` loop, interval, event subscription, worker, image, or data fetch. Removing the header DOM in `hide()` is the complete active-resource cleanup path; only the already-loaded renderer code and stylesheet rules remain with the enabled plugin.

If a theme lacks an optional visual variable, the CSS falls back to standard Obsidian text and accent variables. If animation support is limited, the content remains readable in its final layout. A rendering failure cannot affect settings persistence or any plugin feature because the header has no connection to settings state.

## Attribution and Licensing

The linked [Diagon project](https://github.com/ArthurSonzogni/Diagon) was reviewed as inspiration. Its [MIT license](https://github.com/ArthurSonzogni/Diagon/blob/main/LICENSE) identifies Arthur Sonzogni as the copyright holder. The approved Aside header does not incorporate Diagon source, generated diagrams, package code, or other substantial material, so the shipped implementation does not require Diagon's copyright and permission notice.

The GEB reference is conceptual inspiration for dimensional ambiguity only; no cover art, lettering, or reproduced geometry is incorporated. All art and animation code for this feature must remain original. If implementation later introduces any Diagon material, work stops until the MIT notice is included in an appropriate third-party notices location and the visible project credit is agreed with the user.

## Testing Strategy

Focused tests should verify:

- the header is rendered before the first settings heading;
- both the declarative Obsidian 1.13 path and legacy Obsidian 1.12.7 fallback render the same header before the settings catalog;
- the exact visible copy is `add comment, @agent reply`;
- no visible graph label, square-frame node, or solid center marker is rendered;
- the decorative art is hidden from assistive technology and the header has a useful semantic label;
- the finite relay entrance hands off to only the Rabbit's subtle continuous idle motion;
- the graph scene has three explicit planes and starts its infinite, alternating 3D turn during the reveal tail;
- the three planes use cover-inspired brass depth tones without bundling the reference image;
- runners begin during the reveal tail, alternate direction, remain blue, and are clipped by their plane-local edge tracks;
- `AsideSetting.hide()` removes the header DOM and unloads existing settings-only component state;
- reduced-motion rules remove the entrance and all continuous movement while preserving the final content;
- all selectors remain scoped to the Aside settings tab.

Repository-level verification runs the full test, lint, typecheck, Obsidian compliance, bundle, and release-artifact checks. Manual acceptance covers both themes, normal and narrow panes, mobile-like width, entrance ordering, instruction wrapping, the continuous spatial turn, runner containment, closing and reopening behavior, and reduced motion.

## Non-Goals

- Rendering live vault data or the current note's real Thought Trail.
- Rendering this animation in the Index, note sidebar, or any non-settings surface.
- Adding settings to customize, replay, pause, or hide the header.
- Using Diagon, copied GEB cover art or geometry, a diagram generator, canvas, SVG, images, or external animation dependencies.
- Adding a literal human face, brain outline, tree, wiki-link labels, or a large mascot illustration.
- Changing any existing setting, setting heading, feature flag, sidebar behavior, agent behavior, or persisted data.
