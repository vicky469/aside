# Agent Radio Settings Design

**Date:** 2026-08-19
**Status:** Implemented; frontend acceptance pending

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside persists one preferred default agent and resolves an available agent in Codex → Claude Code → Gemini order.
- [x] The Agents settings section probes every supported local runtime and shows the effective fallback without changing the saved preference.
- [x] The user approved visible disabled choices for unavailable agents instead of hiding them.

### To Implement

- [x] Replace the default-agent dropdown with a compact native radio group ordered Codex, Claude Code, Gemini.
- [x] Render each agent as one aligned row with its radio, name, and text availability status.
- [x] Disable unavailable and checking choices while keeping every supported agent visible.
- [x] Preserve a checked but disabled saved preference when that agent becomes unavailable, with the effective fallback below the group.
- [x] Use Obsidian theme variables and responsive wrapping without changing persistence or agent-selection policy.

### Verification

- [x] Presentation tests cover order, selected preference, checking, available, and unavailable radio states.
- [x] Interaction tests prove only available rows can change and persist the default agent.
- [x] Settings and CSS regression tests pass alongside the existing agent fallback tests.
- [x] The full automated suite, production bundle, Obsidian compliance check, and release artifact guard pass.
- [ ] The installed plugin is visually checked in Obsidian at normal and narrow settings widths.

## Context

The first implementation presents the preferred agent in a dropdown and compresses all runtime statuses into one description line. The interaction is functional but visually dense: the selected provider is separated from the status of each provider, unavailable choices are discoverable only after opening the dropdown, and emoji status marks do not align with Obsidian's settings layout.

This refinement changes only the Agents settings presentation. Default-agent persistence, availability probing, fallback ordering, `/create-script`, and explicit `@agent` behavior remain unchanged.

## Approved Interaction

The **Default agent** setting renders a vertical native radio group:

```text
◉ Codex        Available
○ Claude Code  Available
○ Gemini       Unavailable
```

Each supported actor remains visible in registry order. An available row is clickable across its label and persists that actor as the preference. An unavailable or checking row remains visible but is non-interactive and its radio is disabled. Status uses text—**Checking…**, **Available**, or **Unavailable**—rather than emoji.

If the saved preference becomes unavailable, its disabled radio remains checked. Aside continues using the existing fallback policy and shows the existing sentence below the group, such as `Using Codex while Gemini is unavailable.` The fallback does not overwrite the preference.

## Presentation

The radio, actor label, and status share one compact row. The label receives the primary text treatment; status is smaller and muted, with semantic state classes available for accessible theme-aware styling. Rows use native radio inputs and Obsidian CSS variables rather than custom-drawn controls or hard-coded colors.

At narrow widths, the status may wrap below the agent name while the radio remains aligned with the label. The design does not hide unavailable actors, add cards, add provider logos, or introduce a second settings page.

## Accessibility

- The options form one labeled radio group.
- Every input has a native label, checked state, and disabled state.
- Availability is communicated with text, not color alone.
- Keyboard selection follows native radio behavior for enabled choices.
- Disabled choices remain readable and explain why they cannot be selected.

## Architecture

`AsideSetting` remains the imperative renderer used by both the legacy and declarative settings adapters. The renderer consumes the existing ordered actor registry, diagnostics map, default-agent option presentation, and fallback formatter.

The dropdown-specific DOM mutation is replaced by a small radio-group renderer. Pure presentation data owns each row's target, label, selected state, availability state, and status text. Runtime probes continue concurrently and reuse the existing stale-refresh token. No settings schema, migration, runtime, or routing changes are required.

## Error Handling

- A probe failure is presented as **Unavailable** and disables that actor's radio.
- While probes are pending, every radio is disabled and reports **Checking…**.
- A failed settings write restores the persisted checked value when the row re-renders.
- If no agent is available, all choices remain visible and disabled; `/create-script` retains its existing immediate no-agent response.

## Non-Goals

- Changing default-agent fallback order or persistence.
- Hiding unavailable agents.
- Adding agent installation or authentication actions.
- Changing `/create-script`, explicit agent mentions, or vault-script execution.
- Redesigning unrelated Aside settings.
