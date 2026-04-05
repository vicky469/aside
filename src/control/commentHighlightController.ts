import { EditorSelection, Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { MarkdownView, Plugin, TFile } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import type { Comment as SideNoteComment } from "../commentManager";
import type { DraftComment } from "../domain/drafts";
import { isAnchoredComment } from "../core/anchors/commentAnchors";
import {
    COMMENT_LOCATION_PROTOCOL,
    findCommentLocationTargetInMarkdownLine,
    parseCommentLocationUrl,
} from "../core/derived/allCommentsNote";
import { buildEditorHighlightRanges } from "../core/derived/editorHighlightRanges";
import { matchesResolvedCommentVisibility } from "../core/rules/resolvedCommentVisibility";
import { chooseCommentStateForOpenEditor } from "../core/rules/commentSyncPolicy";
import { findClickedHighlightCommentId } from "./commentHighlightClickTarget";
import { buildPreviewHighlightWraps } from "./commentHighlightPlanner";
import {
    getManagedSectionRange,
    getManagedSectionStartLine,
    type ParsedNoteComments,
} from "../core/storage/noteCommentStorage";
import { clampOffsetBeforeManagedSection } from "../core/text/editOffsets";

const forceHighlightRefreshEffect = StateEffect.define<null>();
const setManagedBlockHiddenEffect = StateEffect.define<boolean>();

interface ManagedBlockDecorationState {
    hidden: boolean;
    decorations: DecorationSet;
}

function buildManagedBlockDecorations(noteContent: string, hidden: boolean): DecorationSet {
    if (!hidden) {
        return Decoration.none;
    }

    const range = getManagedSectionRange(noteContent);
    if (!range || range.toOffset <= range.fromOffset) {
        return Decoration.none;
    }

    return Decoration.set([
        Decoration.replace({}).range(range.fromOffset, range.toOffset),
    ], true);
}

function clampSelectionBeforeManagedSection(
    selection: EditorSelection,
    managedSectionStartOffset: number,
): EditorSelection | null {
    let changed = false;
    const ranges = selection.ranges.map((range) => {
        const anchor = clampOffsetBeforeManagedSection(range.anchor, managedSectionStartOffset);
        const head = clampOffsetBeforeManagedSection(range.head, managedSectionStartOffset);
        if (anchor === range.anchor && head === range.head) {
            return range;
        }

        changed = true;
        return EditorSelection.range(anchor, head);
    });

    return changed
        ? EditorSelection.create(ranges, selection.mainIndex)
        : null;
}

const managedBlockField = StateField.define<ManagedBlockDecorationState>({
    create(state) {
        return {
            hidden: false,
            decorations: buildManagedBlockDecorations(state.doc.toString(), false),
        };
    },
    update(value, transaction) {
        let hidden = value.hidden;

        for (const effect of transaction.effects) {
            if (effect.is(setManagedBlockHiddenEffect)) {
                hidden = effect.value;
            }
        }

        if (!transaction.docChanged && hidden === value.hidden) {
            return value;
        }

        return {
            hidden,
            decorations: buildManagedBlockDecorations(transaction.state.doc.toString(), hidden),
        };
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export interface CommentHighlightHost {
    app: Plugin["app"];
    getCommentsForFile(filePath: string): SideNoteComment[];
    getMarkdownViewForEditorView(editorView: EditorView): MarkdownView | null;
    getMarkdownViewForFile(file: TFile): MarkdownView | null;
    getMarkdownFileByPath(path: string): TFile | null;
    getCurrentNoteContent(file: TFile): Promise<string>;
    getParsedNoteComments(filePath: string, noteContent: string): ParsedNoteComments;
    isAllCommentsNotePath(path: string): boolean;
    shouldShowResolvedComments(): boolean;
    getDraftForFile(filePath: string): DraftComment | null;
    getRevealedCommentId(filePath: string): string | null;
    activateViewAndHighlightComment(commentId: string): Promise<void>;
    activateIndexComment(commentId: string, indexFilePath: string): Promise<void>;
}

export class CommentHighlightController {
    constructor(private readonly host: CommentHighlightHost) {}

    private readonly indexPreviewLinkSelector = "a.sidenote2-index-comment-link[data-sidenote2-comment-url]";

    private getIndexPreviewContext(indexFilePath: string): {
        previewRoot: HTMLElement;
    } | null {
        const file = this.host.getMarkdownFileByPath(indexFilePath);
        if (!file) {
            return null;
        }

        const markdownView = this.host.getMarkdownViewForFile(file);
        if (!(markdownView?.contentEl instanceof HTMLElement)) {
            return null;
        }

        const previewRoot = markdownView.contentEl.querySelector(".markdown-preview-view, .markdown-rendered");
        if (!(previewRoot instanceof HTMLElement)) {
            return null;
        }

        return {
            previewRoot,
        };
    }

    private findRenderedIndexCommentRow(
        previewRoot: HTMLElement,
        commentId: string,
    ): HTMLElement | null {
        let targetRow: HTMLElement | null = null;
        previewRoot.querySelectorAll(this.indexPreviewLinkSelector).forEach((link) => {
            if (!(link instanceof HTMLAnchorElement)) {
                return;
            }

            const target = parseCommentLocationUrl(link.dataset.sidenote2CommentUrl ?? "");
            if (!target || target.commentId !== commentId) {
                return;
            }

            const rowEl = link.closest("p, li");
            if (rowEl instanceof HTMLElement) {
                targetRow = rowEl;
            }
        });

        return targetRow;
    }

    private isPlainPrimaryClick(event: MouseEvent): boolean {
        return event.button === 0
            && !event.metaKey
            && !event.ctrlKey
            && !event.shiftKey
            && !event.altKey;
    }

    private prepareIndexPreviewLinks(element: HTMLElement): void {
        element.querySelectorAll(`a[href^="obsidian://${COMMENT_LOCATION_PROTOCOL}"], ${this.indexPreviewLinkSelector}`).forEach((link) => {
            if (!(link instanceof HTMLAnchorElement)) {
                return;
            }

            const nextUrl = link.dataset.sidenote2CommentUrl?.trim()
                || link.getAttribute("href")?.trim()
                || "";
            if (!nextUrl.startsWith(`obsidian://${COMMENT_LOCATION_PROTOCOL}`)) {
                return;
            }

            link.dataset.sidenote2CommentUrl = nextUrl;
            link.classList.remove("external-link");
            link.classList.add("sidenote2-index-comment-link");
            link.removeAttribute("href");
            link.removeAttribute("target");
            link.removeAttribute("rel");
            link.removeAttribute("aria-label");
            link.removeAttribute("data-tooltip-position");
            link.removeAttribute("tabindex");
        });
    }

    private syncIndexPreviewLinkStates(element: HTMLElement, sourcePath: string): void {
        const activeCommentId = this.host.getRevealedCommentId(sourcePath);

        element.querySelectorAll(this.indexPreviewLinkSelector).forEach((link) => {
            if (!(link instanceof HTMLAnchorElement)) {
                return;
            }

            const target = parseCommentLocationUrl(link.dataset.sidenote2CommentUrl ?? "");
            const isActive = !!target && target.commentId === activeCommentId;
            const rowEl = link.closest("p, li");

            link.classList.remove("sidenote2-highlight", "sidenote2-highlight-preview", "sidenote2-highlight-active");

            if (rowEl instanceof HTMLElement) {
                rowEl.classList.toggle("sidenote2-index-active-row", isActive);
            }
        });
    }

    private bindIndexPreviewLinkClicks(element: HTMLElement, sourcePath: string): void {
        element.querySelectorAll(this.indexPreviewLinkSelector).forEach((link) => {
            if (!(link instanceof HTMLAnchorElement) || link.dataset.sidenote2IndexBound === "true") {
                return;
            }

            link.dataset.sidenote2IndexBound = "true";
            const activateLink = () => {
                const target = parseCommentLocationUrl(link.dataset.sidenote2CommentUrl ?? "");
                if (!target) {
                    return;
                }

                void this.host.activateIndexComment(target.commentId, sourcePath);
                const previewRoot = element.closest(".markdown-preview-view, .markdown-rendered");
                if (previewRoot instanceof HTMLElement) {
                    queueMicrotask(() => {
                        this.syncIndexPreviewLinkStates(previewRoot, sourcePath);
                    });
                } else {
                    queueMicrotask(() => {
                        this.syncIndexPreviewLinkStates(element, sourcePath);
                    });
                }
            };

            link.addEventListener("mousedown", (event: MouseEvent) => {
                if (!this.isPlainPrimaryClick(event)) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
            });
            link.addEventListener("click", (event: MouseEvent) => {
                if (!this.isPlainPrimaryClick(event)) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                activateLink();
            });
            link.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                activateLink();
            });
        });
    }

    public async syncIndexPreviewSelection(
        indexFilePath: string,
        commentId: string,
    ): Promise<boolean> {
        const context = this.getIndexPreviewContext(indexFilePath);
        if (!context) {
            return false;
        }

        const { previewRoot } = context;
        this.prepareIndexPreviewLinks(previewRoot);
        this.syncIndexPreviewLinkStates(previewRoot, indexFilePath);

        return !!this.findRenderedIndexCommentRow(previewRoot, commentId);
    }

    public registerMarkdownPreviewHighlights(plugin: Plugin) {
        plugin.registerMarkdownPostProcessor(async (element, context) => {
            await this.applyPreviewHighlights(element, context);
        });
    }

    public createLivePreviewManagedBlockPlugin() {
        const host = this.host;

        return [
            managedBlockField,
            ViewPlugin.fromClass(class {
                private hidden = false;
                private destroyed = false;
                private syncScheduled = false;

                constructor(private readonly view: EditorView) {
                    this.scheduleManagedBlockSync();
                }

                destroy() {
                    this.destroyed = true;
                    this.syncScheduled = false;
                }

                update(_update: ViewUpdate) {
                    this.scheduleManagedBlockSync();
                }

                private scheduleManagedBlockSync() {
                    if (this.syncScheduled || this.destroyed) {
                        return;
                    }

                    this.syncScheduled = true;
                    queueMicrotask(() => {
                        this.syncScheduled = false;
                        if (this.destroyed) {
                            return;
                        }

                        this.syncManagedBlockVisibility();
                    });
                }

                private syncManagedBlockVisibility() {
                    const markdownView = host.getMarkdownViewForEditorView(this.view);
                    const nextHidden = !!markdownView
                        && markdownView.getMode() === "source"
                        && markdownView.getState().source !== true
                        && !!getManagedSectionRange(this.view.state.doc.toString());
                    const managedSectionRange = nextHidden
                        ? getManagedSectionRange(this.view.state.doc.toString())
                        : null;
                    const selection = managedSectionRange
                        ? clampSelectionBeforeManagedSection(this.view.state.selection, managedSectionRange.fromOffset)
                        : null;
                    const didHiddenChange = nextHidden !== this.hidden;

                    if (!didHiddenChange && !selection) {
                        return;
                    }

                    this.hidden = nextHidden;
                    this.view.dispatch({
                        effects: didHiddenChange ? [setManagedBlockHiddenEffect.of(nextHidden)] : [],
                        selection: selection ?? undefined,
                    });
                }
            }),
        ];
    }

    public createEditorHighlightPlugin() {
        const host = this.host;

        return [
            ViewPlugin.fromClass(class {
                decorations: DecorationSet;

                constructor(readonly view: EditorView) {
                    this.decorations = this.buildDecorations();
                }

                update(update: ViewUpdate) {
                    if (
                        update.docChanged ||
                        update.viewportChanged ||
                        update.transactions.some((tr) =>
                            tr.effects.some((effect) => effect.is(forceHighlightRefreshEffect))
                        )
                    ) {
                        this.decorations = this.buildDecorations();
                    }
                }

                private buildDecorations(): DecorationSet {
                    const markdownView = host.getMarkdownViewForEditorView(this.view);
                    const filePath = markdownView?.file?.path ?? null;
                    if (!filePath || host.isAllCommentsNotePath(filePath)) {
                        return Decoration.none;
                    }

                    const doc = this.view.state.doc;
                    const currentNoteText = doc.toString();
                    const parsed = host.getParsedNoteComments(filePath, currentNoteText);
                    const searchableText = parsed.mainContent;
                    const decorations: Range<Decoration>[] = [];
                    const storedComments = chooseCommentStateForOpenEditor(
                        host.getCommentsForFile(filePath),
                        parsed.comments,
                    );
                    const draftComment = host.getDraftForFile(filePath);
                    const showResolved = host.shouldShowResolvedComments();
                    const ranges = buildEditorHighlightRanges(
                        currentNoteText,
                        searchableText,
                        storedComments,
                        draftComment,
                        showResolved,
                        host.getRevealedCommentId(filePath),
                    );

                    ranges.forEach((range) => {
                        const classes = ["sidenote2-highlight"];
                        if (range.resolved) {
                            classes.push("sidenote2-highlight-resolved");
                        }
                        if (range.active) {
                            classes.push("sidenote2-highlight-active");
                        }

                        decorations.push(
                            Decoration.mark({
                                class: classes.join(" "),
                                attributes: {
                                    "data-comment-id": range.commentId,
                                },
                            }).range(range.from, range.to),
                        );
                    });

                    return Decoration.set(decorations, true);
                }
            }, {
                decorations: (value) => value.decorations,
            }),
            EditorView.domEventHandlers({
                click(event, view) {
                    if (
                        event.button !== 0
                        || event.metaKey
                        || event.ctrlKey
                        || event.shiftKey
                        || event.altKey
                    ) {
                        return false;
                    }

                    const markdownView = host.getMarkdownViewForEditorView(view);
                    const filePath = markdownView?.file?.path ?? null;
                    if (!filePath || host.isAllCommentsNotePath(filePath)) {
                        return false;
                    }

                    const commentId = findClickedHighlightCommentId(event.target);
                    if (!commentId) {
                        return false;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    void host.activateViewAndHighlightComment(commentId);
                    return true;
                },
            }),
        ];
    }

    public createAllCommentsLivePreviewLinkPlugin() {
        const host = this.host;

        return EditorView.domEventHandlers({
            click(event, view) {
                if (
                    event.button !== 0
                    || event.metaKey
                    || event.ctrlKey
                    || event.shiftKey
                    || event.altKey
                ) {
                    return false;
                }

                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                    return false;
                }

                const linkEl = target.closest(".cm-link");
                if (!(linkEl instanceof HTMLElement)) {
                    return false;
                }

                const markdownView = host.getMarkdownViewForEditorView(view);
                const filePath = markdownView?.file?.path ?? null;
                if (!filePath || !host.isAllCommentsNotePath(filePath)) {
                    return false;
                }

                const lineEl = linkEl.closest(".cm-line");
                if (!(lineEl instanceof HTMLElement)) {
                    return false;
                }

                let pos: number;
                try {
                    pos = view.posAtDOM(lineEl, 0);
                } catch {
                    return false;
                }

                const safePos = Math.max(0, Math.min(pos, view.state.doc.length));
                const lineText = view.state.doc.lineAt(safePos).text;
                const commentTarget = findCommentLocationTargetInMarkdownLine(lineText);
                if (!commentTarget) {
                    return false;
                }

                event.preventDefault();
                event.stopPropagation();
                void host.activateIndexComment(commentTarget.commentId, filePath);
                return true;
            },
        });
    }

    public refreshEditorDecorations() {
        this.host.app.workspace.iterateAllLeaves((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) {
                return;
            }

            const cm = (leaf.view.editor as { cm?: EditorView } | null)?.cm;
            if (!cm?.dispatch) {
                return;
            }

            cm.dispatch({
                effects: [forceHighlightRefreshEffect.of(null)],
            });
        });
    }

    private async applyPreviewHighlights(
        element: HTMLElement,
        context: MarkdownPostProcessorContext,
    ): Promise<void> {
        if (this.host.isAllCommentsNotePath(context.sourcePath)) {
            this.prepareIndexPreviewLinks(element);
            this.syncIndexPreviewLinkStates(element, context.sourcePath);
            this.bindIndexPreviewLinkClicks(element, context.sourcePath);
            return;
        }

        const previewContainer = element.closest(".markdown-preview-view");
        if (!previewContainer) {
            return;
        }

        const sectionInfo = context.getSectionInfo(element);
        if (!sectionInfo) {
            return;
        }

        const file = this.host.getMarkdownFileByPath(context.sourcePath);
        if (file) {
            const noteContent = await this.host.getCurrentNoteContent(file);
            const managedSectionStartLine = getManagedSectionStartLine(noteContent);
            if (managedSectionStartLine !== null && sectionInfo.lineStart >= managedSectionStartLine) {
                element.remove();
                return;
            }
        }

        const comments = this.host
            .getCommentsForFile(context.sourcePath)
            .filter((comment) =>
                isAnchoredComment(comment)
                && !!comment.selectedText
                && comment.startLine >= sectionInfo.lineStart
                && comment.endLine <= sectionInfo.lineEnd
                && matchesResolvedCommentVisibility(comment, this.host.shouldShowResolvedComments()),
            );
        if (!comments.length) {
            return;
        }

        const textNodes: Array<{ node: Text; start: number; end: number }> = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let offset = 0;

        while (walker.nextNode()) {
            const node = walker.currentNode as Text;
            const value = node.nodeValue || "";
            if (!value.length) {
                continue;
            }

            const start = offset;
            const end = start + value.length;
            textNodes.push({ node, start, end });
            offset = end;
        }

        const fullText = textNodes.map((entry) => entry.node.nodeValue || "").join("");
        if (!fullText.length) {
            return;
        }

        const wraps = buildPreviewHighlightWraps(
            sectionInfo.text,
            sectionInfo.lineStart,
            fullText,
            comments,
        );
        if (!wraps.length) {
            return;
        }

        const activeCommentId = this.host.getRevealedCommentId(context.sourcePath);
        const findPos = (absolute: number): { node: Text; offsetInNode: number } | null => {
            for (const entry of textNodes) {
                if (absolute >= entry.start && absolute <= entry.end) {
                    return {
                        node: entry.node,
                        offsetInNode: absolute - entry.start,
                    };
                }
            }

            return null;
        };

        wraps.sort((left, right) => right.start - left.start);

        for (const wrap of wraps) {
            const startPos = findPos(wrap.start);
            const endPos = findPos(wrap.end);
            if (!startPos || !endPos) {
                continue;
            }

            try {
                const range = document.createRange();
                range.setStart(startPos.node, startPos.offsetInNode);
                range.setEnd(endPos.node, endPos.offsetInNode);

                const span = document.createElement("span");
                span.classList.add("sidenote2-highlight", "sidenote2-highlight-preview");
                if (wrap.comment.resolved) {
                    span.classList.add("sidenote2-highlight-resolved");
                }
                if (wrap.comment.id === activeCommentId) {
                    span.classList.add("sidenote2-highlight-active");
                }
                span.dataset.commentId = wrap.comment.id;
                span.addEventListener("click", (event: MouseEvent) => {
                    if (event.button !== 0) {
                        return;
                    }

                    void this.host.activateViewAndHighlightComment(wrap.comment.id);
                });
                span.addEventListener("contextmenu", () => {
                    /* keep default behavior */
                });

                range.surroundContents(span);
            } catch (error) {
                console.warn("Failed to wrap preview highlight", error);
            }
        }
    }
}
