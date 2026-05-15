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
    parseIndexFileOpenUrl,
    INDEX_FILE_FILTER_PROTOCOL,
} from "../core/derived/allCommentsNote";
import { isIndexFileFilterPathSelected } from "../ui/views/indexFileFilter";
import { buildEditorHighlightRanges } from "../core/derived/editorHighlightRanges";
import { matchesResolvedCommentVisibility } from "../core/rules/resolvedCommentVisibility";
import { chooseCommentStateForOpenEditor } from "../core/rules/commentSyncPolicy";
import { findClickedHighlightCommentId } from "./commentHighlightClickTarget";
import {
    findClickedIndexLivePreviewTarget,
    isIndexNativeCollapseControlTarget,
    shouldBlockIndexPreviewBackgroundTarget,
    shouldUseIndexPreviewRowActivator,
    shouldUseIndexLivePreviewLineFallback,
} from "./commentIndexClickTarget";
import { buildPreviewHighlightWraps } from "./commentHighlightPlanner";
import { nodeInstanceOf } from "../ui/domGuards";
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

function getActiveDocument(): Document {
    return (window as Window & { activeDocument: Document }).activeDocument;
}

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
    getIndexFileScopeRootPath(indexFilePath: string): string | null;
    activateViewAndHighlightComment(commentId: string): Promise<void>;
    activateIndexComment(commentId: string, indexFilePath: string, sourceFilePath?: string): Promise<void>;
    activateIndexFileScope(indexFilePath: string, sourceFilePath: string): Promise<void>;
    log?(level: "info" | "warn" | "error", area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
}

interface PreviewManagedSectionStartLineCacheEntry {
    fileMtime: number;
    value: number | null;
    pending: Promise<number | null> | null;
}

export class CommentHighlightController {
    constructor(private readonly host: CommentHighlightHost) {}

    private readonly indexPreviewLinkSelector = "a.aside-index-comment-link[data-aside-comment-url]";
    private readonly indexPreviewFileHeadingSelector = ".aside-index-heading-label[title], a[data-aside-file-path], a[href^=\"obsidian://open\"], a[href^=\"obsidian://aside-index-file\"]";
    private readonly previewManagedSectionStartLineCache =
        new Map<string, PreviewManagedSectionStartLineCacheEntry>();

    private async getPreviewManagedSectionStartLine(file: TFile): Promise<number | null> {
        const cached = this.previewManagedSectionStartLineCache.get(file.path);
        const fileMtime = file.stat.mtime;
        if (cached?.fileMtime === fileMtime) {
            return cached.pending ?? cached.value;
        }

        const pending = this.host.getCurrentNoteContent(file)
            .then((noteContent) => getManagedSectionStartLine(noteContent))
            .then((value) => {
                const current = this.previewManagedSectionStartLineCache.get(file.path);
                if (current?.pending === pending) {
                    this.previewManagedSectionStartLineCache.set(file.path, {
                        fileMtime,
                        value,
                        pending: null,
                    });
                }
                return value;
            })
            .catch((error) => {
                const current = this.previewManagedSectionStartLineCache.get(file.path);
                if (current?.pending === pending) {
                    this.previewManagedSectionStartLineCache.delete(file.path);
                }
                throw error;
            });

        this.previewManagedSectionStartLineCache.set(file.path, {
            fileMtime,
            value: null,
            pending,
        });
        return pending;
    }

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
            nodeInstanceOf(target, Element) ? target : null,
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
        if (!nodeInstanceOf(markdownView?.contentEl, HTMLElement)) {
            return null;
        }

        const previewRoot = markdownView.contentEl.querySelector(".markdown-preview-view, .markdown-rendered");
        if (!nodeInstanceOf(previewRoot, HTMLElement)) {
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
            if (!nodeInstanceOf(link, HTMLAnchorElement)) {
                return;
            }

            const target = parseCommentLocationUrl(link.dataset.asideCommentUrl ?? "");
            if (!target || target.commentId !== commentId) {
                return;
            }

            const rowEl = link.closest("p, li");
            if (nodeInstanceOf(rowEl, HTMLElement)) {
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
            if (!nodeInstanceOf(link, HTMLAnchorElement)) {
                return;
            }

            const target = parseCommentLocationUrl(link.dataset.asideCommentUrl ?? "");
            if (!target) {
                return;
            }

            const line = lineNumbersByCommentId.get(target.commentId);
            if (line === undefined) {
                return;
            }

            const rowEl = link.closest("p, li");
            if (!nodeInstanceOf(rowEl, HTMLElement)) {
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
            if (!nodeInstanceOf(heading, HTMLElement)) {
                return;
            }

            const filePath = this.getIndexPreviewFilePathFromElement(heading);
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

        return this.expandCollapsedIndexHeading(previewRoot, "h3", "el-h3", folderPath);
    }

    private expandCollapsedIndexFileChunk(
        previewRoot: HTMLElement,
        filePath: string,
    ): boolean {
        let expanded = false;
        previewRoot.querySelectorAll(this.indexPreviewFileHeadingSelector).forEach((headingLabel) => {
            if (!nodeInstanceOf(headingLabel, HTMLElement)) {
                return;
            }

            if (this.getIndexPreviewFilePathFromElement(headingLabel) !== filePath) {
                return;
            }

            const heading = headingLabel.closest("h5") ?? headingLabel.closest("h4");
            if (!nodeInstanceOf(heading, HTMLHeadingElement)) {
                return;
            }

            const headingContainer = heading.closest(heading.tagName.toLowerCase() === "h5" ? ".el-h5" : ".el-h4");
            if (!nodeInstanceOf(headingContainer, HTMLElement) || !headingContainer.classList.contains("is-collapsed")) {
                return;
            }

            const collapseToggle = heading.querySelector(".heading-collapse-indicator, .collapse-indicator, .collapse-icon");
            if (nodeInstanceOf(collapseToggle, HTMLElement)) {
                collapseToggle.click();
            } else {
                heading.click();
            }

            expanded = true;
        });

        return expanded;
    }

    private expandCollapsedIndexHeading(
        previewRoot: HTMLElement,
        headingSelector: string,
        containerClass: string,
        headingText: string,
    ): boolean {
        let expanded = false;
        previewRoot.querySelectorAll(`${headingSelector}[data-heading]`).forEach((heading) => {
            if (!nodeInstanceOf(heading, HTMLHeadingElement)) {
                return;
            }

            if ((heading.dataset.heading ?? "").trim() !== headingText) {
                return;
            }

            const headingContainer = heading.closest(`.${containerClass}`);
            if (!nodeInstanceOf(headingContainer, HTMLElement) || !headingContainer.classList.contains("is-collapsed")) {
                return;
            }

            const collapseToggle = heading.querySelector(".heading-collapse-indicator, .collapse-indicator, .collapse-icon");
            if (nodeInstanceOf(collapseToggle, HTMLElement)) {
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
            window.requestAnimationFrame(() => resolve());
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

    private getIndexPreviewFilePathFromElement(element: HTMLElement): string | null {
        const dataPath = element.dataset.asideFilePath?.trim();
        if (dataPath) {
            return dataPath;
        }

        const titlePath = element.getAttribute("title")?.trim();
        if (titlePath) {
            return titlePath;
        }

        if (nodeInstanceOf(element, HTMLAnchorElement)) {
            return parseIndexFileOpenUrl(element.getAttribute("href")?.trim() ?? "");
        }

        return null;
    }

    private prepareIndexPreviewLinks(element: HTMLElement): void {
        element.querySelectorAll(`a[href^="obsidian://${COMMENT_LOCATION_PROTOCOL}"], ${this.indexPreviewLinkSelector}`).forEach((link) => {
            if (!nodeInstanceOf(link, HTMLAnchorElement)) {
                return;
            }

            const nextUrl = link.dataset.asideCommentUrl?.trim()
                || link.getAttribute("href")?.trim()
                || "";
            if (!nextUrl.startsWith(`obsidian://${COMMENT_LOCATION_PROTOCOL}`)) {
                return;
            }

            link.dataset.asideCommentUrl = nextUrl;
            link.classList.remove("external-link");
            link.classList.add("aside-index-comment-link");
            link.removeAttribute("href");
            link.removeAttribute("target");
            link.removeAttribute("rel");
            link.removeAttribute("aria-label");
            link.removeAttribute("data-tooltip-position");
            link.removeAttribute("tabindex");
        });

        element.querySelectorAll(`a[href^="obsidian://open"], a[href^="obsidian://${INDEX_FILE_FILTER_PROTOCOL}"], a[data-aside-file-path]`).forEach((link) => {
            if (!nodeInstanceOf(link, HTMLAnchorElement)) {
                return;
            }

            const filePath = link.dataset.asideFilePath?.trim()
                || parseIndexFileOpenUrl(link.getAttribute("href")?.trim() ?? "")
                || "";
            if (!filePath) {
                return;
            }

            link.dataset.asideFilePath = filePath;
            link.classList.remove("external-link");
            link.classList.add("aside-index-file-filter-link", "aside-index-heading-label");
            link.setAttribute("title", filePath);
            link.setAttribute("href", "#");
            link.removeAttribute("target");
            link.removeAttribute("rel");
            link.removeAttribute("aria-label");
            link.removeAttribute("data-tooltip-position");
            link.removeAttribute("tabindex");
        });
    }

    private syncIndexPreviewLinkStates(element: HTMLElement, sourcePath: string): void {
        const activeCommentId = this.host.getRevealedCommentId(sourcePath);
        const selectedIndexFileScopeRootPath = this.host.getIndexFileScopeRootPath(sourcePath);

        element.querySelectorAll(this.indexPreviewLinkSelector).forEach((link) => {
            if (!nodeInstanceOf(link, HTMLAnchorElement)) {
                return;
            }

            const target = parseCommentLocationUrl(link.dataset.asideCommentUrl ?? "");
            const isActive = !!target && target.commentId === activeCommentId;
            const rowEl = link.closest("p, li");

            link.classList.remove("aside-highlight", "aside-highlight-preview", "aside-highlight-active");

            if (nodeInstanceOf(rowEl, HTMLElement)) {
                rowEl.classList.toggle("aside-index-active-row", isActive);
            }
        });

        element.querySelectorAll(this.indexPreviewFileHeadingSelector).forEach((link) => {
            if (!nodeInstanceOf(link, HTMLElement)) {
                return;
            }

            const filePath = this.getIndexPreviewFilePathFromElement(link);
            const isSelected = !!filePath
                && isIndexFileFilterPathSelected(filePath, selectedIndexFileScopeRootPath);
            const rowEl = link.closest("p, li");

            link.classList.toggle("aside-index-selected-file", isSelected);
            if (nodeInstanceOf(rowEl, HTMLElement)) {
                rowEl.classList.toggle("aside-index-selected-file-row", isSelected);
            }
        });
    }

    private bindIndexPreviewLinkClicks(element: HTMLElement, sourcePath: string): void {
        const bindActivator = (
            targetEl: HTMLElement,
            activate: () => void,
            shouldHandleTarget: (target: EventTarget | null) => boolean = () => true,
        ) => {
            if (targetEl.dataset.asideIndexBound === "true") {
                return;
            }

            targetEl.dataset.asideIndexBound = "true";
            targetEl.addEventListener("mousedown", (event: MouseEvent) => {
                if (!this.isPlainPrimaryClick(event)) {
                    return;
                }
                if (!shouldHandleTarget(event.target)) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
            });
            targetEl.addEventListener("click", (event: MouseEvent) => {
                if (!this.isPlainPrimaryClick(event)) {
                    return;
                }
                if (!shouldHandleTarget(event.target)) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                activate();
            });
            targetEl.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                if (!shouldHandleTarget(event.target)) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                activate();
            });
        };

        element.querySelectorAll(this.indexPreviewLinkSelector).forEach((link) => {
            if (!nodeInstanceOf(link, HTMLAnchorElement) || link.dataset.asideIndexBound === "true") {
                return;
            }

            const activateLink = () => {
                const target = parseCommentLocationUrl(link.dataset.asideCommentUrl ?? "");
                if (!target) {
                    return;
                }

                void this.host.activateIndexComment(target.commentId, sourcePath, target.filePath);
                const previewRoot = element.closest(".markdown-preview-view, .markdown-rendered");
                if (nodeInstanceOf(previewRoot, HTMLElement)) {
                    queueMicrotask(() => {
                        this.syncIndexPreviewLinkStates(previewRoot, sourcePath);
                    });
                } else {
                    queueMicrotask(() => {
                        this.syncIndexPreviewLinkStates(element, sourcePath);
                    });
                }
            };

            bindActivator(link, activateLink);
            const rowEl = link.closest("p, li");
            if (nodeInstanceOf(rowEl, HTMLElement)) {
                bindActivator(
                    rowEl,
                    activateLink,
                    (target) => shouldUseIndexPreviewRowActivator(target, rowEl),
                );
            }
        });

        element.querySelectorAll(this.indexPreviewFileHeadingSelector).forEach((link) => {
            if (!nodeInstanceOf(link, HTMLElement) || link.dataset.asideIndexBound === "true") {
                return;
            }

            const filePath = this.getIndexPreviewFilePathFromElement(link);
            if (!filePath) {
                return;
            }

            const activateFile = () => {
                void (async () => {
                    await this.host.activateIndexFileScope(sourcePath, filePath);
                    const previewRoot = element.closest(".markdown-preview-view, .markdown-rendered");
                    if (nodeInstanceOf(previewRoot, HTMLElement)) {
                        this.syncIndexPreviewLinkStates(previewRoot, sourcePath);
                    } else {
                        this.syncIndexPreviewLinkStates(element, sourcePath);
                    }
                })();
            };

            bindActivator(link, activateFile);
            const rowEl = link.closest("p, li");
            if (nodeInstanceOf(rowEl, HTMLElement)) {
                bindActivator(
                    rowEl,
                    activateFile,
                    (target) => shouldUseIndexPreviewRowActivator(target, rowEl),
                );
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

    public syncIndexPreviewFileScope(indexFilePath: string): boolean {
        const context = this.getIndexPreviewContext(indexFilePath);
        if (!context) {
            return false;
        }

        const { previewRoot } = context;
        this.prepareIndexPreviewLinks(previewRoot);
        this.syncIndexPreviewLinkStates(previewRoot, indexFilePath);
        return true;
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

            if (this.expandCollapsedIndexFileChunk(previewRoot, navigationTarget.filePath)) {
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
        const eventDocument = getActiveDocument();
        plugin.registerDomEvent(eventDocument, "mousedown", (event) => {
            if (!this.isPlainPrimaryClick(event)) {
                return;
            }

            const context = this.resolveIndexInteractionContext(event.target);
            if (!context) {
                if (shouldBlockIndexPreviewBackgroundTarget(
                    nodeInstanceOf(event.target, Element) ? event.target : null,
                )) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                }
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }, true);
        plugin.registerDomEvent(eventDocument, "click", (event) => {
            if (!this.isPlainPrimaryClick(event)) {
                return;
            }

            const context = this.resolveIndexInteractionContext(event.target);
            if (!context) {
                if (shouldBlockIndexPreviewBackgroundTarget(
                    nodeInstanceOf(event.target, Element) ? event.target : null,
                )) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                }
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this.activateIndexInteraction(context);
        }, true);
        plugin.registerDomEvent(eventDocument, "keydown", (event) => {
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

                update(update: ViewUpdate) {
                    if (
                        !update.docChanged
                        && !update.selectionSet
                        && update.transactions.length === 0
                    ) {
                        return;
                    }

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
                        const classes = ["aside-highlight"];
                        if (range.resolved) {
                            classes.push("aside-highlight-resolved");
                        }
                        if (range.active) {
                            classes.push("aside-highlight-active");
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
                return;
            }

            void host.activateIndexFileScope(indexFilePath, clickedTarget.filePath);
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
                if (!nodeInstanceOf(target, HTMLElement)) {
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

                if (isIndexNativeCollapseControlTarget(target)) {
                    return false;
                }

                const lineEl = target.closest(".cm-line");
                if (!nodeInstanceOf(lineEl, HTMLElement)) {
                    return false;
                }
                if (!shouldUseIndexLivePreviewLineFallback(target, lineEl)) {
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
                if (!nodeInstanceOf(target, HTMLElement)) {
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
                    activateClickedTarget(clickedTarget, filePath);
                    return true;
                }

                if (isIndexNativeCollapseControlTarget(target)) {
                    return false;
                }

                const lineEl = target.closest(".cm-line");
                if (!nodeInstanceOf(lineEl, HTMLElement)) {
                    return false;
                }
                if (!shouldUseIndexLivePreviewLineFallback(target, lineEl)) {
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
            const managedSectionStartLine = await this.getPreviewManagedSectionStartLine(file);
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
        const ownerDocument = element.ownerDocument;
        const nodeFilter = ownerDocument.defaultView?.NodeFilter;
        if (!nodeFilter) {
            return;
        }

        const walker = ownerDocument.createTreeWalker(element, nodeFilter.SHOW_TEXT);
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
                const range = ownerDocument.createRange();
                range.setStart(startPos.node, startPos.offsetInNode);
                range.setEnd(endPos.node, endPos.offsetInNode);

                const span = ownerDocument.createElement("span");
                span.classList.add("aside-highlight", "aside-highlight-preview");
                if (wrap.comment.resolved) {
                    span.classList.add("aside-highlight-resolved");
                }
                if (wrap.comment.id === activeCommentId) {
                    span.classList.add("aside-highlight-active");
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
