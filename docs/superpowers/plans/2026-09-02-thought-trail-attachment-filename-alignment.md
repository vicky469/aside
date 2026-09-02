# Thought Trail Attachment Filename Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Left-align Thought Trail attachment filenames without changing the attachment type label or surrounding layout.

**Architecture:** Keep the renderer unchanged and correct the existing filename button's flex alignment in its scoped CSS rule. Extend the existing stylesheet contract test so Obsidian button defaults cannot silently re-center the label later.

**Tech Stack:** CSS, Node.js test runner, repository CSS-rule parser.

---

### Task 1: Left-align attachment filename flex content

**Files:**
- Modify: `tests/toolbarDisabledStyles.test.mjs:365`
- Modify: `styles.css:1166`
- Modify: `docs/superpowers/specs/2026-09-02-thought-trail-attachment-filename-alignment-design.md`

- [x] **Step 1: Write the failing regression assertion**

Add this assertion beside the existing `text-align: left` check:

```js
assert.match(linkRule.body, /justify-content:\s*flex-start\s*;/);
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/toolbarDisabledStyles.test.mjs`

Expected: FAIL because the attachment filename button rule does not contain `justify-content: flex-start`.

- [x] **Step 3: Add the narrowly scoped CSS rule**

In `.aside-thought-trail button.aside-thought-trail-attachment-link`, add:

```css
justify-content: flex-start;
```

Do not change the attachment row, type label, sizing, or truncation declarations.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `node --test tests/toolbarDisabledStyles.test.mjs`

Expected: all stylesheet tests pass.

- [x] **Step 5: Run production verification**

Run: `npm run build`

Expected: tests, lint, typecheck, Obsidian compliance, bundle, and release artifact inspection pass.

- [x] **Step 6: Complete spec tracking**

Mark every item under `### To Implement` and `### Verification` complete only after the focused test and production build pass.

- [x] **Step 7: Commit only this fix**

Stage `tests/toolbarDisabledStyles.test.mjs`, the spec and plan, plus only the `justify-content: flex-start` hunk from `styles.css`; leave all pre-existing working-tree changes unstaged.

```bash
git commit -m "fix(thought-trail): left-align attachment names"
```
