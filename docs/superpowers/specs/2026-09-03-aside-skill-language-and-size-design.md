# Aside Skill Language and Size Design

**Date:** 2026-09-03
**Status:** Implemented

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Aside has one bundled `skills/aside/SKILL.md` source that is packaged with the plugin and synced to an installed Codex skill.
- [x] Every supported local provider receives the shared prompt built by `shared/sideNotePromptPolicy.js`.
- [x] Real Aside comment `46dfaf50-3c4b-4309-8f1c-7c83a95417c0` demonstrates that note or thread context can incorrectly influence response language.

### To Implement

- [x] Make the newest user request the only implicit source of reply language.
- [x] Honor an explicit response-language instruction in that newest request over its written language.
- [x] Put the language contract in the shared provider-neutral runtime prompt rather than duplicating it in provider adapters or the bundled skill.
- [x] Reduce `skills/aside/SKILL.md` from 973 words to at most 500 without losing its routing, storage, mutation-safety, annotation, or concise-reply contracts.
- [x] Keep the existing stored example thread unchanged.

### Verification

- [x] A shared-prompt regression test covers English, Chinese, prior-thread-language isolation, and explicit language override wording.
- [x] A skill contract test enforces the 500-word ceiling and required safety concepts.
- [x] Bundled-skill installation and synchronization tests remain green.
- [x] A final change-surface search finds one active language-policy owner and no provider-specific copies.
- [x] Full tests, lint, typecheck, Obsidian compliance, production bundle, and release-artifact inspection pass.

## Problem

The bundled Aside skill is 973 words and repeats concepts already carried by the provider-neutral runtime prompt. At the same time, that runtime prompt does not explicitly say how to choose the response language. In the observed thread, an English request received a Chinese answer because the agent inferred a preference from surrounding vault context.

The fix should improve reliability without adding another large instruction block or language-detection subsystem.

## Language Contract

`shared/sideNotePromptPolicy.js` is the single active owner because its output reaches Codex, Claude Code, Cursor, Gemini, and DeepSeek/OpenCode runs.

The prompt will state one compact rule with this precedence:

1. If the newest user request explicitly asks for a response language, use it.
2. Otherwise, reply in the language of the newest user request.
3. Do not infer reply language from the note, vault, or earlier thread entries.

The plugin will not classify language in code. This avoids brittle heuristics for mixed-language text and leaves the selected agent to follow a direct natural-language instruction.

## Skill Reduction

`skills/aside/SKILL.md` remains the user-facing workflow for real Aside comments. It will retain:

- trigger phrases and URI/comment-id routing;
- canonical storage and hidden-directory search guidance;
- create, append, update, annotation, and ambiguous-edit intent mapping;
- preservation and helper-entrypoint safety rules;
- the 250-word reply limit and related-skill routing.

It will remove repeated explanations, duplicated tables, and verbose command examples where a compact entrypoint list or `--help` instruction is sufficient. The language policy will not be copied into the skill because the shared runtime prompt owns it for all providers.

The target is at most 500 words, enforced mechanically by a repository test.

## Compatibility and Scope

- Existing stored comments and replies are not rewritten.
- Aside storage formats and helper-script behavior do not change.
- Provider selection and runtime execution do not change.
- Annotation proposal syntax remains compatible.
- This work does not broadly rewrite or shrink the provider-neutral runtime prompt beyond adding the language contract.

## Testing Strategy

Before implementation, add tests that fail against the current files:

- prompt output must contain the precedence and context-isolation language exactly once;
- the bundled skill must remain at or below 500 words;
- compact required-concept assertions must protect canonical storage, exact URI targeting, non-destructive entry handling, helper-based writes, annotation proposals, and concise replies.

Then make the smallest prompt addition and skill reduction required to pass. Existing installation, skill-sync, prompt-policy, and full build checks provide integration coverage.

## Change-Surface Completion Check

Search `shared/`, `src/`, `skills/`, `scripts/`, and `tests/` for the language-policy wording. The shared prompt should be the only production owner; tests may assert it, and provider adapters should only consume the shared prompt.
