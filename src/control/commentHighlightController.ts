import { EditorSelection, Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { MarkdownView, Plugin, TFile } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import type { Comment as SideNoteComment } from "../commentManager";
import type { DraftComment } from "../domain/drafts";
import { isAnchoredComment } from "../core/anchors/commentAnchors";
import {
    buildCommentLocationLineNumberMap,
    buildIndexNoteNavigationMap,
    COMMENT_LOCATION_PROTOCOL,
    findIndexMarkdownLineTarget,
    parseCommentLocationUrl,
} from "../core/derived/allCommentsNote";
import { buildEditorHighlightRanges } from "../core/derived/editorHighlightRanges";
import { matchesResolvedCommentVisibility } from "../core/rules/resolvedCommentVisibility";
import { chooseCommentStateForOpenEditor } from "../core/rules/commentSyncPolicy";
import { findClickedHighlightCommentId } from "./commentHighlightClickTarget";
import { findClickedIndexLivePreviewTarget } from "./commentIndexClickTarget";
import { buildPreviewHighlightWraps } from "./commentHighlightPlanner";
import {
    estimateIndexPreviewScrollTop,
    type IndexPreviewRenderedLineSample,
} from "./indexPreviewScrollPlanner";
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
    activateIndexComment(commentId: string, indexFilePath: string, sourceFilePath?: string): Promise<void>;
    activateIndexFileScope(indexFilePath: string, sourceFilePath: string): Promise<void>;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

export class CommentHighlightController {
    constructor(private readonly host: CommentHighlightHost) {}

    private readonly indexPreviewLinkSelector = "a.sidenote2-index-comment-link[data-sidenote2-comment-url]";
    private readonly indexPreviewFileHeadingSelector = ".sidenote2-index-heading-label[title]";

    private findIndexMarkdownViewForEventTarget(target: EventTarget | null): MarkdownView | null {
        if (!(target instanceof Node)) {
            return null;
        }

        let matchedView: MarkdownView | null = null;
        this.host.app.workspace.iterateAllLeaves((leaf) => {
            if (matchedView || !(leaf.view instanceof MarkdownView)) {
                return;
            }

            if (!leaf.view.contentEl.contains(target)) {
                return;
            }

            const sourcePath = leaf.view.file?.path ?? "";
            if (!this.host.isAllCommentsNotePath(sourcePath)) {
                return;
            }

            matchedView = leaf.view;
        });

        return matchedView;
    }

    private resolveIndexInteractionContext(target: EventTarget | null): {
        clickedTarget: ReturnType<typeof findClickedIndexLivePreviewTarget>;
        indexFilePath: string;
    } | null {
        const clickedTarget = findClickedIndexLivePreviewTarget(
            target instanceof Element ? target : null,
        );
        if (!clickedTarget) {
            return null;
        }

        const markdownView = this.findIndexMarkdownViewForEventTarget(target);
        const indexFilePath = markdownView?.file?.path ?? null;
        if (!indexFilePath || !this.host.isAllCommentsNotePath(indexFilePath)) {
            return null;
        }

        return {
            clickedTarget,
            indexFilePath,
        };
    }

    private activateIndexInteraction(context: {
        clickedTarget: ReturnType<typeof findClickedIndexLivePreviewTarget>;
        indexFilePath: string;
    }): void {
        if (!context.clickedTarget) {
            return;
        }

        if (context.clickedTarget.kind === "comment") {
            void this.host.activateIndexComment(
                context.clickedTarget.commentId,
                context.indexFilePath,
                context.clickedTarget.filePath,
            );
            return;
        }

        void this.host.activateIndexFileScope(
            context.indexFilePath,
            context.clickedTarget.filePath,
        );
    }

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

    private collectRenderedIndexRowSamples(
        previewRoot: HTMLElement,
        lineNumbersByCommentId: ReadonlyMap<string, number>,
    ): IndexPreviewRenderedLineSample[] {
        const previewTop = previewRoot.getBoundingClientRect().top;
        const samples: IndexPreviewRenderedLineSample[] = [];

        previewRoot.querySelectorAll(this.indexPreviewLinkSelector).forEach((link) => {
            if (!(link instanceof HTMLAnchorElement)) {
                return;
            }

            const target = parseCommentLocationUrl(link.dataset.sidenote2CommentUrl ?? "");
            if (!target) {
                return;
            }

            const line = lineNumbersByCommentId.get(target.commentId);
            if (line === undefined) {
                return;
            }

            const rowEl = link.closest("p, li");
            if (!(rowEl instanceof HTMLElement)) {
                return;
            }

            const rowTop = rowEl.getBoundingClientRect().top - previewTop + previewRoot.scrollTop;
            samples.push({
                line,
                top: rowTop,
            });
        });

        return samples;
    }

    private collectRenderedIndexFileSamples(
        previewRoot: HTMLElement,
        fileLineByFilePath: ReadonlyMap<string, number>,
    ): IndexPreviewRenderedLineSample[] {
        const previewTop = previewRoot.getBoundingClientRect().top;
        const samples: IndexPreviewRenderedLineSample[] = [];

        previewRoot.querySelectorAll(this.indexPreviewFileHeadingSelector).forEach((heading) => {
            if (!(heading instanceof HTMLElement)) {
                return;
            }

            const filePath = heading.getAttribute("title")?.trim();
            if (!filePath) {
                return;
            }

            const line = fileLineByFilePath.get(filePath);
            if (line === undefined) {
                return;
            }

            const rowEl = heading.closest("p, li") ?? heading;
            const rowTop = rowEl.getBoundingClientRect().top - previewTop + previewRoot.scrollTop;
            samples.push({
                line,
                top: rowTop,
            });
        });

        return samples;
    }

    private centerRenderedIndexCommentRow(
        previewRoot: HTMLElement,
        rowEl: HTMLElement,
    ): void {
        const previewRect = previewRoot.getBoundingClientRect();
        const rowRect = rowEl.getBoundingClientRect();
        const delta = (rowRect.top - previewRect.top) - ((previewRect.height - rowRect.height) / 2);
        previewRoot.scrollTop = previewRoot.scrollTop + delta;
    }

    private getIndexFolderPath(filePath: string): string {
        const normalizedPath = filePath.replace(/\\/g, "/");
        const pathSegments = normalizedPath.split("/").filter(Boolean);
        pathSegments.pop();
        return pathSegments.join("/");
    }

    private expandCollapsedIndexFolderChunk(
        previewRoot: HTMLElement,
        filePath: string,
    ): boolean {
        const folderPath = this.getIndexFolderPath(filePath);
        if (!folderPath) {
            return false;
        }

        let expanded = false;
        previewRoot.querySelectorAll("h3[data-heading]").forEach((heading) => {
            if (!(heading instanceof HTMLHeadingElement)) {
                return;
            }

            if ((heading.dataset.heading ?? "").trim() !== folderPath) {
                return;
            }

            const headingContainer = heading.closest(".el-h3");
            if (!(headingContainer instanceof HTMLElement) || !headingContainer.classList.contains("is-collapsed")) {
                return;
            }

            const collapseToggle = heading.querySelector(".heading-collapse-indicator, .collapse-indicator, .collapse-icon");
            if (collapseToggle instanceof HTMLElement) {
                collapseToggle.click();
            } else {
                heading.click();
            }

            expanded = true;
        });

        return expanded;
    }

    private waitForPreviewFrame(): Promise<void> {
        return new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    }

    private setPreviewScrollTop(previewRoot: HTMLElement, top: number): void {
        previewRoot.scrollTop = top;
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

            const activateLink = () => {
                const target = parseCommentLocationUrl(link.dataset.sidenote2CommentUrl ?? "");
                if (!target) {
                    return;
                }

                void this.host.activateIndexComment(target.commentId, sourcePath, target.filePath);
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

            const bindActivator = (targetEl: HTMLElement) => {
                if (targetEl.dataset.sidenote2IndexBound === "true") {
                    return;
                }

                targetEl.dataset.sidenote2IndexBound = "true";
                targetEl.addEventListener("mousedown", (event: MouseEvent) => {
                    if (!this.isPlainPrimaryClick(event)) {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                });
                targetEl.addEventListener("click", (event: MouseEvent) => {
                    if (!this.isPlainPrimaryClick(event)) {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    activateLink();
                });
                targetEl.addEventListener("keydown", (event: KeyboardEvent) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    activateLink();
                });
            };

            bindActivator(link);
            const rowEl = link.closest("p, li");
            if (rowEl instanceof HTMLElement) {
                bindActivator(rowEl);
            }
        });
    }

    private bindIndexPreviewHeadingClicks(element: HTMLElement, sourcePath: string): void {
        element.querySelectorAll(this.indexPreviewFileHeadingSelector).forEach((heading) => {
            if (!(heading instanceof HTMLElement) || heading.dataset.sidenote2IndexBound === "true") {
                return;
            }

            const filePath = heading.getAttribute("title")?.trim();
            if (!filePath) {
                return;
            }

            const activateHeading = () => {
                void this.host.activateIndexFileScope(sourcePath, filePath);
            };

            const bindActivator = (targetEl: HTMLElement) => {
                if (targetEl.dataset.sidenote2IndexBound === "true") {
                    return;
                }

                targetEl.dataset.sidenote2IndexBound = "true";
                targetEl.addEventListener("mousedown", (event: MouseEvent) => {
                    if (!this.isPlainPrimaryClick(event)) {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                });
                targetEl.addEventListener("click", (event: MouseEvent) => {
                    if (!this.isPlainPrimaryClick(event)) {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    activateHeading();
                });
                targetEl.addEventListener("keydown", (event: KeyboardEvent) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    activateHeading();
                });
            };

            bindActivator(heading);
            const rowEl = heading.closest("p, li");
            if (rowEl instanceof HTMLElement) {
                bindActivator(rowEl);
            }
        });
    }

    public syncIndexPreviewSelection(
        indexFilePath: string,
        commentId: string,
    ): boolean {
        const context = this.getIndexPreviewContext(indexFilePath);
        if (!context) {
            return false;
        }

        const { previewRoot } = context;
        this.prepareIndexPreviewLinks(previewRoot);
        this.syncIndexPreviewLinkStates(previewRoot, indexFilePath);

        return !!this.findRenderedIndexCommentRow(previewRoot, commentId);
    }

    public async revealIndexPreviewSelection(
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

        const renderedRow = this.findRenderedIndexCommentRow(previewRoot, commentId);
        if (renderedRow) {
            this.centerRenderedIndexCommentRow(previewRoot, renderedRow);
            return true;
        }

        const file = this.host.getMarkdownFileByPath(indexFilePath);
        if (!file) {
            return false;
        }

        const noteContent = await this.host.getCurrentNoteContent(file);
        const navigationMap = buildIndexNoteNavigationMap(noteContent);
        const lineNumbersByCommentId = buildCommentLocationLineNumberMap(noteContent);
        const navigationTarget = navigationMap.targetsByCommentId.get(commentId);
        if (!navigationTarget) {
            return false;
        }

        const totalLineCount = noteContent.split("\n").length;
        const targetLines = [
            navigationTarget.fileLine ?? navigationTarget.commentLine,
            navigationTarget.commentLine,
            navigationTarget.commentLine,
            navigationTarget.commentLine,
        ];

        for (const targetLine of targetLines) {
            const samples = [
                ...this.collectRenderedIndexFileSamples(previewRoot, navigationMap.fileLineByFilePath),
                ...this.collectRenderedIndexRowSamples(previewRoot, lineNumbersByCommentId),
            ];
            const nextScrollTop = estimateIndexPreviewScrollTop(
                targetLine,
                totalLineCount,
                samples,
                previewRoot.scrollHeight,
                previewRoot.clientHeight,
            );

            this.setPreviewScrollTop(previewRoot, nextScrollTop);
            await this.waitForPreviewFrame();
            await this.waitForPreviewFrame();

            if (this.expandCollapsedIndexFolderChunk(previewRoot, navigationTarget.filePath)) {
                await this.waitForPreviewFrame();
                await this.waitForPreviewFrame();
            }

            this.prepareIndexPreviewLinks(previewRoot);
            this.syncIndexPreviewLinkStates(previewRoot, indexFilePath);
            const nextRenderedRow = this.findRenderedIndexCommentRow(previewRoot, commentId);
            if (nextRenderedRow) {
                this.centerRenderedIndexCommentRow(previewRoot, nextRenderedRow);
                return true;
            }
        }

        return false;
    }

    public registerMarkdownPreviewHighlights(plugin: Plugin) {
        plugin.registerMarkdownPostProcessor(async (element, context) => {
            await this.applyPreviewHighlights(element, context);
        });
        plugin.registerDomEvent(document, "mousedown", (event) => {
            if (!this.isPlainPrimaryClick(event)) {
                return;
            }

            const context = this.resolveIndexInteractionContext(event.target);
            if (!context) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this.activateIndexInteraction(context);
        }, true);
        plugin.registerDomEvent(document, "click", (event) => {
            const context = this.resolveIndexInteractionContext(event.target);
            if (!context) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }, true);
        plugin.registerDomEvent(document, "keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }

            const context = this.resolveIndexInteractionContext(event.target);
            if (!context) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this.activateIndexInteraction(context);
        }, true);
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

        const activateClickedTarget = (
            clickedTarget: ReturnType<typeof findClickedIndexLivePreviewTarget>,
            indexFilePath: string,
        ): void => {
            if (!clickedTarget) {
                return;
            }

            if (clickedTarget.kind === "comment") {
                void host.activateIndexComment(clickedTarget.commentId, indexFilePath, clickedTarget.filePath);
            } else {
                void host.activateIndexFileScope(indexFilePath, clickedTarget.filePath);
            }
        };

        return EditorView.domEventHandlers({
            mousedown(event, view) {
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

                const markdownView = host.getMarkdownViewForEditorView(view);
                const filePath = markdownView?.file?.path ?? null;
                if (!filePath || !host.isAllCommentsNotePath(filePath)) {
                    return false;
                }

                const clickedTarget = findClickedIndexLivePreviewTarget(target);
                if (!clickedTarget) {
                    return false;
                }

                event.preventDefault();
                event.stopPropagation();
                activateClickedTarget(clickedTarget, filePath);
                return true;
            },
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

                const markdownView = host.getMarkdownViewForEditorView(view);
                const filePath = markdownView?.file?.path ?? null;
                if (!filePath || !host.isAllCommentsNotePath(filePath)) {
                    return false;
                }

                const clickedTarget = findClickedIndexLivePreviewTarget(target);
                if (clickedTarget) {
                    event.preventDefault();
                    event.stopPropagation();
                    return true;
                }

                const lineEl = target.closest(".cm-line");
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
                const lineTarget = findIndexMarkdownLineTarget(lineText);
                if (!lineTarget) {
                    return false;
                }

                event.preventDefault();
                event.stopPropagation();
                if (lineTarget.kind === "comment") {
                    void host.activateIndexComment(lineTarget.commentId, filePath, lineTarget.filePath);
                } else {
                    void host.activateIndexFileScope(filePath, lineTarget.filePath);
                }
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
            this.bindIndexPreviewHeadingClicks(element, context.sourcePath);
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
                void this.host.log?.("warn", "highlight", "highlight.preview.wrap.error", {
                    commentId: wrap.comment.id,
                    error,
                });
            }
        }
    }
}
