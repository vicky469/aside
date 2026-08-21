# Vault Script Test Location Design

**Date:** 2026-08-21
**Status:** Approved; implementation pending

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the documented change is complete and its verification passes.

### Already Done

- [x] Runnable vault scripts are limited to direct JavaScript children of `🛠️ scripts/`.
- [x] The `lean-startup` vault has moved existing vault-script tests into `🛠️ scripts/tests/`.
- [x] Codex, Claude, and Gemini receive one shared side-note prompt policy.

### To Implement

- [ ] Define `🛠️ scripts/tests` as the shared location for agent-authored vault-script tests.
- [ ] Tell agents to create that directory when it is absent.
- [ ] Tell agents never to place `.test.*` or `.spec.*` files beside runnable scripts in `🛠️ scripts/`.
- [ ] Apply the rule once in the provider-neutral shared prompt rather than copying it into provider adapters or separate create/update blocks.

### Verification

- [ ] A red-green prompt-policy test proves the shared instruction names `🛠️ scripts/tests/`, directory creation, and the direct-root prohibition.
- [ ] Tests prove both `/create-script` and `/update-script` prompts receive the same rule exactly once.
- [ ] The full test suite, lint, typecheck, production bundle, and release-artifact guard pass.

## Context

Aside tells every supported agent to place reusable vault scripts directly under the active vault's `🛠️ scripts/` folder. Direct JavaScript children of that folder are registered as runnable slash commands. Test files should not live beside those runnable scripts.

The `lean-startup` vault already uses this layout:

```text
🛠️ scripts/
├── embed-image-urls.mjs
└── tests/
    └── embed-image-urls.test.mjs
```

Aside should preserve that convention whenever an agent creates or updates tests for a vault script.

## Goals

- Put every future agent-authored vault-script test under `🛠️ scripts/tests/`.
- Create the test directory when needed.
- Keep test files out of the direct runnable-script namespace.
- Give Codex, Claude, and Gemini identical instructions.

## Non-Goals

- Moving or rewriting existing test files.
- Automatically relocating files after an agent run.
- Registering files under `🛠️ scripts/tests/` as slash commands.
- Restricting the test framework, test-file basename, or JavaScript module extension.

## Design

The shared vault-script policy will expose a single test-folder path derived from the existing `VAULT_SCRIPT_FOLDER_PATH`. The provider-neutral side-note prompt will use it in one general vault-script instruction:

- If the agent creates tests for a vault script, it must place them under the active vault's `🛠️ scripts/tests/` directory.
- It must create that directory when it does not exist.
- It must not place `.test.*` or `.spec.*` files directly under `🛠️ scripts/` beside runnable scripts.

The instruction belongs beside the existing general reusable-script location rule, so it applies to ordinary agent requests as well as `/create-script` and `/update-script`. Provider adapters remain transport-only.

## Data Flow

1. Aside builds the shared side-note prompt for the selected agent.
2. The prompt includes the canonical runnable-script folder and test-folder rules.
3. The agent creates `🛠️ scripts/tests/` if a requested test needs it and the directory is absent.
4. Test files remain nested and therefore stay outside the live vault-script registry.

## Error Handling

If the directory cannot be created or a test cannot be written there, the existing shared failure policy applies: the agent states the failure plainly rather than claiming completion or placing the test in the runnable-script root as a fallback.

## Testing Strategy

Extend the shared prompt-policy tests first. The failing assertions will require the canonical test-folder path, create-if-needed language, and a prohibition against direct-root test/spec files. Exercise ordinary, create-script, and update-script prompt construction, and assert that each prompt contains the shared rule once.

No provider-specific tests are needed because all provider adapters already consume the same prompt builder and the existing adapter tests cover metadata forwarding.
