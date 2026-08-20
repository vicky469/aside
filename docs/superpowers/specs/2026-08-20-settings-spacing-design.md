# Aside Settings Spacing Design

**Date:** 2026-08-20
**Status:** Implemented; frontend acceptance pending

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside owns its section headings through one shared settings catalog consumed by the legacy and declarative adapters.
- [x] The default-agent renderer exposes one `aside-default-agent-setting` hook and native radio rows in the fixed Codex, Claude Code, Gemini order.
- [x] Every Aside settings heading has a scoped zero-padding rule.
- [x] The Default agent information block and controls are stacked and share the same left edge.
- [x] The user selected visual option A on 2026-08-20: inline setting copy above one horizontal agent row.

### To Implement

- [x] Place the Default agent name and normal description on one wrapping line above the controls.
- [x] Change the radio group from a vertical grid to one compact, left-aligned horizontal row.
- [x] Keep each radio, agent name, and textual status together as one content-sized option; wrap only between options when width is constrained.
- [x] Preserve default-agent selection, disabled states, availability text, fallback copy, persistence, and routing behavior.

### Verification

- [x] A focused stylesheet regression test proves inline wrapping setting copy, horizontal flex controls, content-sized options, and option-boundary wrapping.
- [x] Existing agent radio presentation, interaction, fallback, and settings-catalog tests pass unchanged.
- [x] The full automated suite, lint, typecheck, Obsidian compliance check, production bundle, and release artifact guard pass.
- [ ] The installed plugin is visually checked at normal and narrow settings widths for heading spacing, left alignment, vertical rhythm, and whole-option wrapping.

## Context

Obsidian renders each Aside settings section as a `.setting-item.setting-item-heading` row with default padding. Aside now removes that padding through a settings-tab-scoped rule, and the user accepted that heading treatment.

The first Default agent revision stacked three full radio rows under the setting copy. It fixed the earlier stretched two-column layout, but frontend review found the result too tall. The three short choices should read as one compact group without losing textual availability or native radio behavior.

## Approved Layout

Every visible Aside section heading—**Agents**, **Sidebar tabs**, **Publishing (experimental)**, and **Index note**—continues to have zero padding. The override applies only inside the Aside settings tab.

The Default agent setting uses two compact, left-aligned lines:

```text
Default agent  Preferred local agent for /create-script.
○ Codex Available   ○ Claude Code Available   ○ Gemini Unavailable
```

The information block remains first. Its name and normal description share a baseline when space permits and wrap naturally when needed. The radio group follows with a modest theme-token gap and shares the same left edge. It is a wrapping flex row, not a full-width grid. Each option keeps its native radio, agent name, and status together using content-sized columns.

At narrow widths, the group wraps between complete agent options. A radio never becomes separated from its name or availability label, and the layout never returns to a stretched full-width control. A fallback message for a saved unavailable preference remains a supplemental line within the description block.

## Architecture

`AsideSetting` already adds one stable `aside-settings-tab` class to its existing `containerEl`. Because the class belongs to the tab instance rather than an individual legacy heading, it scopes both legacy rendering and Obsidian's declarative settings rendering.

`styles.css` owns both layout changes:

```css
.aside-settings-tab .setting-item.setting-item-heading {
    padding: 0;
}
```

The existing `.aside-default-agent-setting`, `.setting-item-info`, `.setting-item-control`, `.aside-default-agent-radio-group`, and `.aside-default-agent-option` selectors are refined rather than adding another renderer or changing markup. The setting stays a column so information remains above controls. CSS makes the information block an inline wrapping row, the radio group a wrapping flex row, and each option a content-sized three-column unit. Runtime probing and selection code remain untouched.

## Accessibility and Responsive Behavior

- Native radio inputs, labels, checked states, and disabled states remain unchanged.
- Availability remains text, not color-only communication.
- Option height and vertical spacing preserve usable pointer targets.
- The group has a maximum width of 100% and wraps only between complete options.
- The setting name and description can wrap onto separate lines when the pane is narrow.
- No global `.setting-item-heading` rule is introduced.

## Testing Strategy

A focused source-and-stylesheet regression test continues to verify that the tab root receives `aside-settings-tab`, the heading selector is scoped and declares `padding: 0`, and no unscoped heading rule exists. It is revised to verify column flow for the overall setting, inline wrapping flow for the information block, horizontal wrapping flex flow for the radio group, content-sized option columns, and the absence of the obsolete narrow status-under-name rule.

Existing behavioral tests continue to prove agent ordering, availability, disabled choices, preference persistence, and fallback selection. Full repository and release-artifact checks remain required because the production bundle is installed into the test vault.

## Error Handling

This revision is CSS-only. If Obsidian changes the heading markup, the scoped rule simply stops matching rather than leaking elsewhere. Runtime diagnostic failures continue to render the existing unavailable state and do not affect layout ownership.

## Non-Goals

- Removing padding from settings headings outside Aside.
- Stacking every Aside setting.
- Changing section order, names, visibility, or search metadata.
- Changing agent selection, fallback order, diagnostics, persistence, or `/create-script` routing.
- Adding custom radio controls, cards, provider logos, or new settings sections.
