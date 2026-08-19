# Agent Radio Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default-agent dropdown with compact, theme-aware radio rows that keep unavailable agents visible and disabled.

**Architecture:** Keep agent order, diagnostics, persistence, and fallback policy in their current shared owners. Extend the pure settings presentation model with radio state and render one native radio group from `AsideSetting`; CSS owns only alignment, semantic state color, and narrow-width wrapping.

**Tech Stack:** TypeScript, Obsidian `Setting` API and DOM helpers, native HTML radio inputs, CSS using Obsidian theme variables, Node test runner, ESLint, esbuild.

---

## File Structure

- `src/ui/settings/agentRuntimeSettings.ts` — pure option status and enabled-selection policy for the radio renderer.
- `src/ui/settings/AsideSetting.ts` — imperative radio-group DOM rendering, persistence callback, concurrent diagnostic refresh, and fallback description.
- `styles.css` — compact radio rows and responsive settings layout using Obsidian variables.
- `tests/agentRuntimeSettings.test.ts` — pure order, status, selected, disabled, and selection-gate coverage.
- `tests/agentRadioSettingsStyles.test.mjs` — CSS contract for radio-row alignment, disabled presentation, and narrow layout.
- `docs/superpowers/specs/2026-08-19-agent-radio-settings-design.md` — evidence-backed implementation and acceptance tracking.

## Task 1: Model radio option states

**Files:**
- Modify: `src/ui/settings/agentRuntimeSettings.ts`
- Modify: `tests/agentRuntimeSettings.test.ts`

- [ ] **Step 1: Write failing presentation tests**

Replace the dropdown-only assertions with explicit radio-state coverage:

```ts
test("default agent radio options preserve order and expose status", () => {
    const diagnostics = new Map<AsideAgentTarget, AgentRuntimeDiagnostics>([
        ["gemini", { status: "missing", message: "missing" }],
        ["codex", { status: "available", message: "ready" }],
        ["claude", { status: "checking", message: "checking" }],
    ]);

    assert.deepEqual(buildDefaultAgentOptions("gemini", diagnostics), [
        {
            target: "codex",
            label: "Codex",
            status: "available",
            statusLabel: "Available",
            available: true,
            disabled: false,
            selected: false,
        },
        {
            target: "claude",
            label: "Claude Code",
            status: "checking",
            statusLabel: "Checking…",
            available: false,
            disabled: true,
            selected: false,
        },
        {
            target: "gemini",
            label: "Gemini",
            status: "unavailable",
            statusLabel: "Unavailable",
            available: false,
            disabled: true,
            selected: true,
        },
    ]);
});

test("resolveDefaultAgentRadioSelection accepts only available choices", () => {
    const options = buildDefaultAgentOptions("gemini", new Map([
        ["codex", { status: "available", message: "ready" }],
        ["claude", { status: "checking", message: "checking" }],
        ["gemini", { status: "missing", message: "missing" }],
    ]));

    assert.equal(resolveDefaultAgentRadioSelection(options, "codex"), "codex");
    assert.equal(resolveDefaultAgentRadioSelection(options, "claude"), null);
    assert.equal(resolveDefaultAgentRadioSelection(options, "gemini"), null);
});
```

- [ ] **Step 2: Run the focused test to verify failure**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeSettings.test.js
```

Expected: compilation or assertions fail because status fields and `resolveDefaultAgentRadioSelection` do not exist.

- [ ] **Step 3: Implement the pure radio presentation model**

Update `agentRuntimeSettings.ts`:

```ts
export type DefaultAgentOptionStatus = "checking" | "available" | "unavailable";

export interface DefaultAgentOptionPresentation {
    target: AsideAgentTarget;
    label: string;
    status: DefaultAgentOptionStatus;
    statusLabel: "Checking…" | "Available" | "Unavailable";
    available: boolean;
    disabled: boolean;
    selected: boolean;
}

function resolveDefaultAgentOptionStatus(
    diagnostics: AgentRuntimeDiagnostics | undefined,
): Pick<DefaultAgentOptionPresentation, "status" | "statusLabel" | "available" | "disabled"> {
    if (diagnostics?.status === "available") {
        return {
            status: "available",
            statusLabel: "Available",
            available: true,
            disabled: false,
        };
    }
    if (!diagnostics || diagnostics.status === "checking") {
        return {
            status: "checking",
            statusLabel: "Checking…",
            available: false,
            disabled: true,
        };
    }
    return {
        status: "unavailable",
        statusLabel: "Unavailable",
        available: false,
        disabled: true,
    };
}

export function buildDefaultAgentOptions(
    preferredAgent: AsideAgentTarget,
    diagnosticsByTarget: ReadonlyMap<AsideAgentTarget, AgentRuntimeDiagnostics>,
): DefaultAgentOptionPresentation[] {
    return getSupportedAgentActors().map((actor) => ({
        target: actor.id,
        label: actor.label,
        ...resolveDefaultAgentOptionStatus(diagnosticsByTarget.get(actor.id)),
        selected: actor.id === preferredAgent,
    }));
}

export function resolveDefaultAgentRadioSelection(
    options: readonly DefaultAgentOptionPresentation[],
    target: AsideAgentTarget,
): AsideAgentTarget | null {
    return options.find((option) => option.target === target && !option.disabled)?.target ?? null;
}
```

Remove `AgentRuntimeStatusLineInput`, `AGENT_RUNTIME_STATUS_SEPARATOR`, and `formatAgentRuntimeStatusLines`; the new rows own runtime status presentation.

- [ ] **Step 4: Run focused tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeSettings.test.js .test-dist/tests/defaultAgentSelection.test.js
npx eslint src/ui/settings/agentRuntimeSettings.ts tests/agentRuntimeSettings.test.ts
```

Expected: all focused tests pass and ESLint exits 0.

- [ ] **Step 5: Commit the policy slice**

```bash
git add src/ui/settings/agentRuntimeSettings.ts tests/agentRuntimeSettings.test.ts
git commit -m "refactor(settings): model agent radio states"
```

## Task 2: Render the native radio group

**Files:**
- Modify: `src/ui/settings/AsideSetting.ts`
- Modify: `styles.css`
- Create: `tests/agentRadioSettingsStyles.test.mjs`

- [ ] **Step 1: Write the failing CSS contract test**

Create `tests/agentRadioSettingsStyles.test.mjs`:

```js
import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

test("agent settings radio rows use compact native controls and theme states", () => {
    const group = styles.match(
        /\.aside-default-agent-radio-group\s*\{(?<body>[\s\S]*?)\}/,
    );
    const option = styles.match(
        /\.aside-default-agent-option\s*\{(?<body>[\s\S]*?)\}/,
    );
    const radio = styles.match(
        /\.aside-default-agent-option input\[type="radio"\]\s*\{(?<body>[\s\S]*?)\}/,
    );

    assert.match(group?.groups?.body ?? "", /display:\s*grid/);
    assert.match(option?.groups?.body ?? "", /grid-template-columns/);
    assert.match(radio?.groups?.body ?? "", /margin:\s*0/);
    assert.match(styles, /\.aside-default-agent-option\.is-disabled/);
    assert.match(styles, /var\(--text-muted\)/);
    assert.match(styles, /@media\s*\(max-width:\s*600px\)/);
});
```

- [ ] **Step 2: Run the style test to verify failure**

Run:

```bash
node --test tests/agentRadioSettingsStyles.test.mjs
```

Expected: FAIL because the radio selectors do not exist.

- [ ] **Step 3: Replace dropdown rendering with radio rows**

In `AsideSetting.ts`:

1. Import `resolveDefaultAgentRadioSelection` and stop importing `formatAgentRuntimeStatusLines`.
2. Remove dropdown creation and emoji status formatting.
3. Add `aside-default-agent-setting` to `agentSetting.settingEl`.
4. Create one `role="radiogroup"` container in `agentSetting.controlEl` with `aria-label="Default agent"`.
5. Create one label/input/name/status row per supported actor and retain element references by target.
6. On `change`, resolve the target through the pure enabled-selection gate, persist it, then render the stored value on either promise outcome.
7. On every diagnostics refresh, update checked, disabled, status text, and semantic classes from `buildDefaultAgentOptions`.
8. Keep only the base description and optional fallback sentence below the setting name.

The core rendering shape is:

```ts
agentSetting.settingEl.addClass("aside-default-agent-setting");
const groupEl = agentSetting.controlEl.createDiv({
    cls: "aside-default-agent-radio-group",
    attr: {
        role: "radiogroup",
        "aria-label": "Default agent",
    },
});
const radioRows = new Map<AsideAgentTarget, {
    rowEl: HTMLLabelElement;
    inputEl: HTMLInputElement;
    statusEl: HTMLSpanElement;
}>();

for (const actor of supportedActors) {
    const rowEl = groupEl.createEl("label", {
        cls: "aside-default-agent-option",
    });
    const inputEl = rowEl.createEl("input", {
        type: "radio",
        attr: {
            name: "aside-default-agent",
            value: actor.id,
        },
    });
    rowEl.createSpan({
        cls: "aside-default-agent-option-name",
        text: actor.label,
    });
    const statusEl = rowEl.createSpan({
        cls: "aside-default-agent-option-status",
    });
    inputEl.addEventListener("change", () => {
        const options = buildDefaultAgentOptions(
            this.plugin.settings.defaultAgent,
            localDiagnosticsByTarget,
        );
        const target = resolveDefaultAgentRadioSelection(options, actor.id);
        if (!inputEl.checked || !target) {
            renderRuntimeSetting();
            return;
        }
        void this.plugin.setDefaultAgent(target).then(
            renderRuntimeSetting,
            renderRuntimeSetting,
        );
    });
    radioRows.set(actor.id, { rowEl, inputEl, statusEl });
}
```

During `renderRuntimeSetting`, update each row:

```ts
for (const option of options) {
    const row = radioRows.get(option.target);
    if (!row) continue;
    row.inputEl.checked = option.selected;
    row.inputEl.disabled = option.disabled;
    row.rowEl.toggleClass("is-selected", option.selected);
    row.rowEl.toggleClass("is-disabled", option.disabled);
    row.rowEl.toggleClass("is-checking", option.status === "checking");
    row.rowEl.toggleClass("is-available", option.status === "available");
    row.rowEl.toggleClass("is-unavailable", option.status === "unavailable");
    row.statusEl.textContent = option.statusLabel;
}
```

- [ ] **Step 4: Add compact theme-aware CSS**

Replace the obsolete `.aside-agent-runtime-status-line` rule with:

```css
.aside-default-agent-setting {
    align-items: flex-start;
}

.aside-default-agent-setting .setting-item-control {
    flex: 0 1 19rem;
    width: min(19rem, 100%);
}

.aside-default-agent-radio-group {
    display: grid;
    gap: var(--size-2-1);
    width: 100%;
}

.aside-default-agent-option {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--size-4-2);
    min-height: var(--input-height);
    padding: 0 var(--size-4-2);
    border-radius: var(--radius-s);
    cursor: pointer;
}

.aside-default-agent-option:hover:not(.is-disabled) {
    background: var(--background-modifier-hover);
}

.aside-default-agent-option input[type="radio"] {
    margin: 0;
}

.aside-default-agent-option-name {
    min-width: 0;
    color: var(--text-normal);
}

.aside-default-agent-option-status {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    white-space: nowrap;
}

.aside-default-agent-option.is-available .aside-default-agent-option-status {
    color: var(--text-success);
}

.aside-default-agent-option.is-disabled {
    cursor: default;
}

@media (max-width: 600px) {
    .aside-default-agent-setting {
        flex-direction: column;
        align-items: stretch;
    }

    .aside-default-agent-setting .setting-item-control {
        width: 100%;
        margin-top: var(--size-4-2);
    }

    .aside-default-agent-option {
        grid-template-columns: auto minmax(0, 1fr);
    }

    .aside-default-agent-option-status {
        grid-column: 2;
        white-space: normal;
    }
}
```

- [ ] **Step 5: Run focused settings, type, lint, and CSS tests**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/agentRuntimeSettings.test.js .test-dist/tests/asideSettingCatalog.test.js tests/agentRadioSettingsStyles.test.mjs
npx eslint src/ui/settings/AsideSetting.ts src/ui/settings/agentRuntimeSettings.ts tests/agentRuntimeSettings.test.ts tests/agentRadioSettingsStyles.test.mjs
npm run typecheck
```

Expected: all tests and checks exit 0; source contains no `addDropdown` in the default-agent renderer and no emoji status formatter.

- [ ] **Step 6: Commit the renderer slice**

```bash
git add src/ui/settings/AsideSetting.ts src/ui/settings/agentRuntimeSettings.ts styles.css tests/agentRuntimeSettings.test.ts tests/agentRadioSettingsStyles.test.mjs
git commit -m "feat(settings): use agent radio rows"
```

## Task 3: Verify, install, and track acceptance

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-agent-radio-settings-design.md`
- Verify: `main.js`
- Verify: `manifest.json`
- Verify: `styles.css`

- [ ] **Step 1: Run the change-surface audit**

Run:

```bash
rg -n "addDropdown|aside-agent-runtime-status-line|Checking…|Available|Unavailable|aside-default-agent" src styles.css tests docs/superpowers/specs/2026-08-19-agent-radio-settings-design.md
```

Expected: the default-agent dropdown and emoji status line are absent from production settings code; radio labels and state copy have one shared presentation owner plus intentional renderer, styles, tests, and documentation.

- [ ] **Step 2: Run complete automated verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run check:obsidian
npm run bundle
npm run release:artifacts:check
```

Expected: every command exits 0. The artifact guard confirms that the shipped set remains `main.js`, `manifest.json`, and `styles.css`, with no `main.js.map`, source-map content, raw TypeScript/JSX-family files, or secret-bearing files.

- [ ] **Step 3: Install the verified build**

Run:

```bash
npm run dev:install-built -- --vault /Users/example/Obsidian/lean-startup
```

Expected: only `main.js`, `manifest.json`, and `styles.css` are copied, and each installed file matches the local verified artifact byte-for-byte.

- [ ] **Step 4: Update evidence-backed tracking**

In `docs/superpowers/specs/2026-08-19-agent-radio-settings-design.md`:

- mark implemented radio-row and automated-verification items `[x]` only after their checks pass;
- change status to `Implemented; frontend acceptance pending`;
- leave the installed normal/narrow visual check `[ ]` until the user reports the result.

- [ ] **Step 5: Commit tracking**

```bash
git add -f docs/superpowers/specs/2026-08-19-agent-radio-settings-design.md
git commit -m "docs(settings): track agent radio verification"
```

- [ ] **Step 6: Hand off frontend acceptance**

Ask the user to reload Aside and verify:

1. Codex, Claude Code, and Gemini appear in fixed order.
2. Every row shows text status with no dropdown or emoji line.
3. Available rows select and persist when clicking anywhere on the row.
4. Checking and unavailable rows remain visible but disabled.
5. A saved unavailable preference stays checked while the fallback sentence identifies the effective agent.
6. The layout remains aligned at normal width and wraps cleanly in a narrow settings pane.

Expected: the user reports the visual result before the final manual tracking item is marked complete.

## Completion Criteria

- The dropdown is gone.
- Each supported agent is a visible native radio row in registry order.
- Only available agents can be selected.
- Status is textual and aligned beside the actor name.
- A saved unavailable preference remains visible, checked, and disabled.
- Existing persistence, fallback selection, routing, and runtime behavior are unchanged.
- Full verification and artifact exposure checks pass.
- The installed build is ready for the user's normal/narrow frontend acceptance.
