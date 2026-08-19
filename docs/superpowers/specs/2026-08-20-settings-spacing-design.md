# Aside Settings Spacing Design

**Date:** 2026-08-20
**Status:** Approved design; implementation pending

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside owns its section headings through one shared settings catalog consumed by the legacy and declarative adapters.
- [x] The default-agent renderer already exposes one `aside-default-agent-setting` hook and native radio rows.
- [x] The user approved zero padding for every Aside section heading and a stacked, left-aligned Default agent setting.

### To Implement

- [ ] Add one Aside-specific class to the settings-tab root so layout overrides cannot affect Obsidian or other plugins.
- [ ] Remove all padding from every Aside `.setting-item.setting-item-heading` row through the scoped settings-tab selector.
- [ ] Stack the Default agent name and description above its radio group with a modest vertical gap.
- [ ] Keep the radio group and its radio/name/status columns compact and left aligned while preserving comfortable row height and narrow-width wrapping.
- [ ] Preserve default-agent selection, disabled states, availability text, fallback copy, persistence, and routing behavior.

### Verification

- [ ] Settings source and stylesheet tests prove the scope class, zero-padding heading rule, stacked Default agent layout, compact columns, and absence of an unscoped heading override.
- [ ] Existing agent radio presentation, interaction, fallback, and settings-catalog tests pass unchanged.
- [ ] The full automated suite, lint, typecheck, Obsidian compliance check, production bundle, and release artifact guard pass.
- [ ] The installed plugin is visually checked at normal and narrow settings widths for heading spacing, left alignment, vertical rhythm, and status wrapping.

## Context

Obsidian renders each Aside settings section as a `.setting-item.setting-item-heading` row with default padding. In the current Aside layout that padding makes the headings, especially the first **Agents** heading, look detached from their settings.

The Default agent setting also uses Obsidian's horizontal setting row: its information stays on the left while a fixed-width 19rem radio group sits on the right. Inside each row, a flexible middle column pushes availability status to the far edge. The result is visually spread out even though the setting contains only three compact choices.

## Approved Layout

Every visible Aside section heading—**Agents**, **Sidebar tabs**, **Publishing (experimental)**, and **Index note**—has zero padding. The override applies only inside the Aside settings tab.

The Default agent setting uses a vertical flow:

```text
Default agent
Preferred local agent for /create-script.

○ Codex       Available
○ Claude Code Available
○ Gemini      Unavailable
```

The information block remains first. The radio group follows below it with a modest theme-token gap and shares the same left edge. The group sizes to its content up to the available width instead of reserving 19rem. On ordinary widths, each radio, agent name, and availability label uses compact auto-sized columns. Rows retain a comfortable minimum height and vertical padding without horizontal inset, so the radios align with the setting copy.

At narrow widths, the status may wrap below the agent name while the radio stays aligned with the label. The layout never returns to a stretched full-width control.

## Architecture

`AsideSetting` adds one stable `aside-settings-tab` class to its existing `containerEl`. Because the class belongs to the tab instance rather than an individual legacy heading, it scopes both legacy rendering and Obsidian's declarative settings rendering.

`styles.css` owns both layout changes:

```css
.aside-settings-tab .setting-item.setting-item-heading {
    padding: 0;
}
```

The existing `.aside-default-agent-setting`, `.setting-item-control`, `.aside-default-agent-radio-group`, and `.aside-default-agent-option` selectors are refined rather than adding another renderer or changing markup. Runtime probing and selection code remain untouched.

## Accessibility and Responsive Behavior

- Native radio inputs, labels, checked states, and disabled states remain unchanged.
- Availability remains text, not color-only communication.
- Row height and vertical spacing preserve usable pointer targets.
- The group has a maximum width of 100% and status wrapping remains available at narrow widths.
- No global `.setting-item-heading` rule is introduced.

## Testing Strategy

A focused source-and-stylesheet regression test verifies that the tab root receives `aside-settings-tab`, the heading selector is scoped and declares `padding: 0`, and no unscoped heading rule exists. The same test verifies that the Default agent setting uses column flow, left alignment, content-sized control/group widths, compact ordinary-width columns, vertical-only row padding, and the existing narrow status wrap.

Existing behavioral tests continue to prove agent ordering, availability, disabled choices, preference persistence, and fallback selection. Full repository and release-artifact checks remain required because the production bundle is installed into the test vault.

## Error Handling

The change is CSS-only apart from attaching the tab scope class. If Obsidian changes the heading markup, the scoped rule simply stops matching rather than leaking elsewhere. Runtime diagnostic failures continue to render the existing unavailable state and do not affect layout ownership.

## Non-Goals

- Removing padding from settings headings outside Aside.
- Stacking every Aside setting.
- Changing section order, names, visibility, or search metadata.
- Changing agent selection, fallback order, diagnostics, persistence, or `/create-script` routing.
- Adding custom radio controls, cards, provider logos, or new settings sections.
