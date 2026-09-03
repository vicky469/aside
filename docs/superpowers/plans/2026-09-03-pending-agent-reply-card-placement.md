# Pending Agent Reply Card Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the saving prompt card free of agent activity, then show the existing separate turning reply immediately after the prompt save succeeds.

**Architecture:** Remove the provisional agent reply from `sidebarDraftComment`, leaving the optimistic saving card responsible only for the user prompt. Keep the existing post-save path unchanged: `CommentAgentController.handleSavedUserEntry` emits a queued stream with an output entry id, and `StreamedAgentReplyController` places that stream in the canonical thread's reply container.

**Tech Stack:** TypeScript, Node test runner, Obsidian plugin DOM helpers, existing comment-save and agent-stream controllers.

---

### Task 1: Keep agent activity out of the saving prompt

**Files:**
- Modify: `tests/sidebarDraftComment.test.ts`
- Modify: `src/ui/views/sidebarDraftComment.ts:1-45,167-200`
- Modify: `styles.css:1807-1818`

- [x] **Step 1: Add the failing renderer regression test**

Extend the import from `sidebarDraftComment` and import the controller type:

```ts
import {
    buildDraftCommentPresentation,
    isDraftSaveActionDisabled,
    renderDraftCommentCard,
    shouldAutoOpenDraftMentionSuggest,
    type SidebarDraftCommentHost,
} from "../src/ui/views/sidebarDraftComment";
import type { SidebarDraftEditorController } from "../src/ui/views/sidebarDraftEditor";
```

Replace the old `getDraftPendingAgentStart` policy test with a renderer-level regression. Add a small fake DOM that supports only the saving-card path:

```ts
class FakeDraftElement {
    public readonly children: FakeDraftElement[] = [];
    public textContent = "";
    public parentElement: FakeDraftElement | null = null;
    private readonly attributes = new Map<string, string>();

    constructor(
        public readonly tagName: string,
        public className: string,
        public readonly ownerDocument: FakeDraftDocument,
    ) {}

    public createDiv(className = ""): FakeDraftElement {
        return this.appendChild(new FakeDraftElement("div", className, this.ownerDocument));
    }

    public createEl(tagName: string, options: { cls?: string; text?: string } = {}): FakeDraftElement {
        const child = new FakeDraftElement(tagName, options.cls ?? "", this.ownerDocument);
        child.textContent = options.text ?? "";
        return this.appendChild(child);
    }

    public createSpan(options: { cls?: string; text?: string } = {}): FakeDraftElement {
        return this.createEl("span", options);
    }

    public appendChild(child: FakeDraftElement): FakeDraftElement {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    public append(...children: FakeDraftElement[]): void {
        children.forEach((child) => this.appendChild(child));
    }

    public setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    public querySelector(selector: string): FakeDraftElement | null {
        const className = selector.startsWith(".") ? selector.slice(1) : "";
        for (const child of this.children) {
            if (className && child.className.split(/\s+/u).includes(className)) {
                return child;
            }
            const nested = child.querySelector(selector);
            if (nested) {
                return nested;
            }
        }
        return null;
    }
}

type FakeDraftDocument = {
    win: { createFragment(): FakeDraftElement };
    createTextNode(text: string): FakeDraftElement;
};

function createFakeDraftRoot(): FakeDraftElement {
    const document = {} as FakeDraftDocument;
    document.win = {
        createFragment: () => new FakeDraftElement("fragment", "", document),
    };
    document.createTextNode = (text) => {
        const node = new FakeDraftElement("text", "", document);
        node.textContent = text;
        return node;
    };
    return new FakeDraftElement("div", "", document);
}

function createDraftRenderHost(): SidebarDraftCommentHost {
    return {
        activeCommentId: null,
        shouldPinFocusedDraftToTop: false,
        isActionableMention: () => true,
        isAgentsFeatureAvailable: () => true,
        isSavingDraft: () => true,
        updateDraftCommentText: () => {},
        setIcon: () => {},
        claimSidebarInteractionOwnership: () => {},
        saveDraft: () => {},
        cancelDraft: () => {},
    };
}

test("saving an agent prompt card contains no agent activity", () => {
    const root = createFakeDraftRoot();
    renderDraftCommentCard(
        root as unknown as HTMLDivElement,
        createDraft({ mode: "new", comment: "@codex answer this" }),
        createDraftRenderHost(),
        {} as SidebarDraftEditorController,
    );

    const promptCard = root.querySelector(".aside-comment-draft");
    assert.ok(promptCard);
    assert.equal(promptCard.querySelector(".aside-thread-replies"), null);
    assert.equal(promptCard.querySelector(".aside-agent-stream-item"), null);
    assert.equal(promptCard.querySelector(".aside-agent-run-status-mark"), null);
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test --test-name-pattern "saving an agent prompt card contains no agent activity" .test-dist/tests/sidebarDraftComment.test.js
```

Expected: FAIL because the saving prompt currently contains `.aside-thread-replies`, `.aside-agent-stream-item`, and the spinner.

- [x] **Step 3: Remove the provisional agent reply from the draft renderer**

In `src/ui/views/sidebarDraftComment.ts`, reduce the registry import and remove the agent-target and directive-parser imports:

```ts
import { formatSupportedAgentDirectives } from "../../core/agents/agentActorRegistry";
```

Delete `DraftPendingAgentStart` and `getDraftPendingAgentStart`. In the `presentation.isPending` branch, keep only the prompt rendering:

```ts
if (presentation.isPending) {
    const contentEl = commentEl.createDiv("aside-comment-content aside-draft-pending-content");
    contentEl.appendChild(renderStyledDraftCommentFragment(
        contentEl.ownerDocument,
        comment.comment,
        host.isActionableMention,
    ));
    return;
}
```

Do not change `CommentAgentController`, `StreamedAgentReplyController`, or persistence ordering.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-dist/tests/sidebarDraftComment.test.js .test-dist/tests/commentAgentController.test.js .test-dist/tests/streamedAgentReplyController.test.js
```

Expected: PASS. The draft renderer contains no agent activity; the existing controller test `comment agent controller shows starting status and launches while refresh is blocked` still proves the separate queued stream is emitted immediately after saved-entry routing.

- [x] **Step 5: Commit the code correction**

```bash
git add src/ui/views/sidebarDraftComment.ts tests/sidebarDraftComment.test.ts
git commit -m "fix(agents): keep status off prompt card"
```

### Task 2: Verify, track, build, and sync

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-pending-agent-reply-card-placement-design.md`
- Modify: `docs/superpowers/plans/2026-09-03-pending-agent-reply-card-placement.md`
- Inspect: `main.js`
- Inspect: `manifest.json`
- Inspect: `styles.css`

- [x] **Step 1: Run the complete repository verification**

Run:

```bash
npm run build
```

Expected: all TypeScript tests, repository checks, lint, typecheck, Obsidian compliance, production bundle, and release-artifact inspection pass.

- [x] **Step 2: Inspect the exact shipped assets**

Run:

```bash
ls -lh main.js manifest.json styles.css
rg -n "sourceMappingURL|sourcesContent" main.js manifest.json styles.css
```

Expected: the three files exist; `rg` returns no matches. Confirm the artifact guard reports no source maps, raw TypeScript/JSX-family files, or secret-bearing files in the shipped artifact set.

- [x] **Step 3: Sync and reload `lean-startup`**

Run:

```bash
npm run dev:install-built -- --vault /path/to/vault
obsidian plugin:reload id=aside vault=lean-startup
cmp -s main.js "/path/to/vault/.obsidian/plugins/aside/main.js"
cmp -s manifest.json "/path/to/vault/.obsidian/plugins/aside/manifest.json"
cmp -s styles.css "/path/to/vault/.obsidian/plugins/aside/styles.css"
```

Expected: installation and reload succeed; all three `cmp` commands exit 0.

- [x] **Step 4: Complete tracking and commit**

Mark every verified checklist item in the associated spec and this plan `[x]`, then run:

```bash
git add -f docs/superpowers/specs/2026-09-03-pending-agent-reply-card-placement-design.md docs/superpowers/plans/2026-09-03-pending-agent-reply-card-placement.md
git commit -m "docs(agents): complete reply placement"
```

- [x] **Step 5: Confirm the final state**

Run:

```bash
git status --short
git log --oneline -4
```

Expected: clean working tree with the design, implementation, and completed tracking commits at `HEAD`; no push is performed.
