# Ghosty Bunny Float Design

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] The settings header renders the approved rabbit, relay, Aside box, and compact GEB-style graph.
- [x] The settings view removes the header DOM when the view closes.
- [x] Reduced-motion mode renders the completed composition without animation.

### To Implement

- [x] Replace the rabbit's one-pixel idle drift with the approved weightless float.
- [x] Start the float only after the five-second staged reveal completes.
- [x] Keep the rabbit art, header layout, graph motion, and application code unchanged.

### Verification

- [x] Prove the motion contract with a focused settings-header test.
- [x] Run the complete repository verification suite.
- [x] Inspect the final diff for unrelated files and generated artifacts.

## Goal

Give the settings rabbit the selected “A · Float” rhythm: quiet, weightless, and ambient like Ghostty's character motion, while preserving Aside's existing minimalist ASCII composition.

## Motion Design

The existing one-shot rabbit reveal remains unchanged. When that five-second sequence ends, the rabbit begins a continuous 3.2-second `ease-in-out` loop:

1. Rest at the reveal's final position.
2. Rise five pixels while rotating no more than half a degree.
3. Return to the same resting transform.

There is no squash, impact bounce, floor shadow, or horizontal travel. Matching the first and last transforms prevents a visible restart at the loop boundary.

## Implementation Boundary

This is a CSS-only change in `styles.css`. Rename the ambient rabbit keyframes from `aside-settings-hero-rabbit-idle` to `aside-settings-hero-rabbit-float`, set the animation duration to 3.2 seconds, and delay it by `--aside-settings-hero-intro-duration` so it cannot override the reveal early.

No markup, timers, event listeners, animation frames, settings, or persistent state are added. Closing the settings view removes the animated element, so the browser releases its animation resources with the existing lifecycle.

## Accessibility And Performance

The existing `prefers-reduced-motion: reduce` rule continues to disable every rabbit animation and show a static completed state. Normal mode animates only `transform`; it creates no recurring JavaScript work or per-frame allocation. The motion is deliberately slow and small to remain decorative rather than distracting.

## Testing

Update `tests/asideSettingsHeaderArt.test.mjs` first and confirm it fails against the current 3.8-second idle drift. The test must require the new keyframe name, 3.2-second timing, post-intro delay, five-pixel vertical peak, bounded rotation, and seamless matching endpoints. Then make the minimum stylesheet change and run the focused test followed by the repository's full verification commands.
