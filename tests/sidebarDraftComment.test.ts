import * as assert from "node:assert/strict";
import test from "node:test";
import type { DraftComment } from "../src/domain/drafts";
import {
    buildDraftCommentPresentation,
    isDraftPreviewReady,
    isDraftSaveActionDisabled,
    renderDraftCommentCard,
    shouldAutoOpenDraftMentionSuggest,
    type SidebarDraftCommentHost,
} from "../src/ui/views/sidebarDraftComment";
import type { SidebarDraftEditorController } from "../src/ui/views/sidebarDraftEditor";

function createDraft(overrides: Partial<DraftComment> = {}): DraftComment {
    return {
        id: overrides.id ?? "draft-1",
        filePath: overrides.filePath ?? "docs/architecture.md",
        startLine: overrides.startLine ?? 9,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 9,
        endChar: overrides.endChar ?? 11,
        selectedText: overrides.selectedText ?? "draft",
        selectedTextHash: overrides.selectedTextHash ?? "hash:draft",
        comment: overrides.comment ?? "Draft body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        mode: overrides.mode ?? "new",
    };
}

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

function createDraftRenderHost(isSaving = true): SidebarDraftCommentHost {
    return {
        activeCommentId: null,
        shouldPinFocusedDraftToTop: false,
        isActionableMention: () => true,
        isSavingDraft: () => isSaving,
        updateDraftCommentText: () => {},
        setIcon: () => {},
        claimSidebarInteractionOwnership: () => {},
        saveDraft: () => {},
        cancelDraft: () => {},
    };
}

test("anchored draft cards render selected text before and during persistence", () => {
    const draft = createDraft({
        mode: "new",
        selectedText: "  Selected\n source   text  ",
    });
    assert.equal(buildDraftCommentPresentation(draft, null, false).metaPreviewText, "Selected source text");
    assert.equal(buildDraftCommentPresentation(draft, null, true).metaPreviewText, "Selected source text");

    const root = createFakeDraftRoot();
    renderDraftCommentCard(
        root as unknown as HTMLDivElement,
        draft,
        createDraftRenderHost(true),
        {} as SidebarDraftEditorController,
    );

    assert.equal(
        root.querySelector(".aside-comment-meta-preview")?.textContent,
        "Selected source text",
    );
});

test("page-note drafts omit the selected-text preview", () => {
    const root = createFakeDraftRoot();
    renderDraftCommentCard(
        root as unknown as HTMLDivElement,
        createDraft({
            mode: "new",
            anchorKind: "page",
            selectedText: "Page note label",
        }),
        createDraftRenderHost(true),
        {} as SidebarDraftEditorController,
    );

    assert.equal(root.querySelector(".aside-comment-meta-preview"), null);
});

test("buildDraftCommentPresentation includes draft state classes and add/save label", () => {
    const createPresentation = buildDraftCommentPresentation(createDraft({
        anchorKind: "page",
        mode: "new",
    }), "draft-1");
    const editPresentation = buildDraftCommentPresentation(createDraft({
        id: "draft-2",
        orphaned: true,
        mode: "edit",
    }), null);

    assert.deepEqual(createPresentation.classes, [
        "aside-comment-item",
        "aside-comment-draft",
        "is-new",
        "page-note",
        "active",
    ]);
    assert.equal(createPresentation.saveLabel, "Add");

    assert.deepEqual(editPresentation.classes, [
        "aside-comment-item",
        "aside-comment-draft",
        "is-edit",
        "orphaned",
    ]);
    assert.equal(editPresentation.saveLabel, "Save");
});

test("buildDraftCommentPresentation keeps append drafts distinct from new drafts", () => {
    const appendPresentation = buildDraftCommentPresentation(createDraft({
        mode: "append",
    }), null);

    assert.deepEqual(appendPresentation.classes, [
        "aside-comment-item",
        "aside-comment-draft",
        "is-append",
    ]);
    assert.equal(appendPresentation.saveLabel, "Add");
    assert.equal(appendPresentation.placeholder, "Add another entry to this thread.");
});

test("buildDraftCommentPresentation makes saving new and append drafts read-only pending cards", () => {
    const newPresentation = buildDraftCommentPresentation(createDraft({ mode: "new" }), null, true);
    const appendPresentation = buildDraftCommentPresentation(createDraft({ mode: "append" }), null, true);

    assert.equal(newPresentation.isPending, true);
    assert.equal(appendPresentation.isPending, true);
    assert.ok(newPresentation.classes.includes("is-saving"));
    assert.ok(appendPresentation.classes.includes("is-saving"));
});

test("buildDraftCommentPresentation leaves saving edit drafts on the editable path", () => {
    const presentation = buildDraftCommentPresentation(createDraft({ mode: "edit" }), null, true);

    assert.equal(presentation.isPending, false);
    assert.equal(presentation.classes.includes("is-saving"), false);
});

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

test("buildDraftCommentPresentation uses the concise new-comment placeholder", () => {
    const newPresentation = buildDraftCommentPresentation(createDraft({ mode: "new" }), null);
    const editPresentation = buildDraftCommentPresentation(createDraft({ mode: "edit" }), null);

    assert.equal(newPresentation.placeholder, "add a comment");
    assert.equal(editPresentation.placeholder, "add a comment");
});

test("draft mention suggestions auto-open from a bare / at the caret", () => {
    assert.equal(shouldAutoOpenDraftMentionSuggest("/", 1, 1, "insertText"), true);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please /", 8, 8, "insertText"), true);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please /", 8, 8, "insertCompositionText"), true);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please /", 8, 8, "insertFromComposition"), true);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please /c", 9, 9, "insertText"), false);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please /", 7, 8, "insertText"), false);
});

test("isDraftSaveActionDisabled allows empty new anchored notes but blocks other empty drafts", () => {
    assert.equal(isDraftSaveActionDisabled(createDraft({
        anchorKind: "selection",
        mode: "new",
    }), "   "), false);

    assert.equal(isDraftSaveActionDisabled(createDraft({
        anchorKind: undefined,
        mode: "new",
    }), "   "), false);

    assert.equal(isDraftSaveActionDisabled(createDraft({
        anchorKind: "page",
        mode: "new",
    }), "   "), true);

    assert.equal(isDraftSaveActionDisabled(createDraft({
        anchorKind: "selection",
        mode: "append",
    }), "   "), true);
});

test("isDraftSaveActionDisabled blocks over-limit saves", () => {
    assert.equal(isDraftSaveActionDisabled(createDraft(), `${"word ".repeat(301)}`), true);
});

test("draft preview readiness never hides nonempty textarea text behind an empty preview", () => {
    assert.equal(isDraftPreviewReady("draft text", "draft text"), true);
    assert.equal(isDraftPreviewReady("draft text", ""), false);
    assert.equal(isDraftPreviewReady("", "add a comment"), true);
});

test("draft mention suggestions auto-open from a bare @ at the caret", () => {
    assert.equal(shouldAutoOpenDraftMentionSuggest("@", 1, 1, "insertText"), true);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please @", 8, 8, "insertText"), true);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please @", 8, 8, "insertCompositionText"), true);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please @", 8, 8, "insertFromComposition"), true);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please @c", 9, 9, "insertText"), false);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please @", 7, 8, "insertText"), false);
});

test("draft mention suggestions stay closed for non-typing input that leaves a bare @", () => {
    assert.equal(shouldAutoOpenDraftMentionSuggest("please @", 8, 8, "deleteContentBackward"), false);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please @", 8, 8, "historyUndo"), false);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please @", 8, 8, "historyRedo"), false);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please @", 8, 8, "insertFromPaste"), false);
    assert.equal(shouldAutoOpenDraftMentionSuggest("please @", 8, 8, ""), false);
});
