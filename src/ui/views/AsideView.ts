import {
    ItemView,
    MarkdownView,
    MarkdownRenderer,
    Notice,
    TFile,
    WorkspaceLeaf,
    Platform,
    setIcon,
    type ViewStateResult,
} from "obsidian";
import type { Comment, CommentThread, ReorderPlacement } from "../../commentManager";
import { buildCommentLocationUrl, parseIndexFileOpenUrl } from "../../core/derived/allCommentsNote";
import { buildThoughtTrailLines } from "../../core/derived/thoughtTrail";
import {
    getAgentRunsForCommentThread,
    type AgentRunRecord,
} from "../../core/agents/agentRuns";
import {
    buildIndexFileFilterGraph,
    type IndexFileFilterGraph,
} from "../../core/derived/indexFileFilterGraph";
import type { DraftComment } from "../../domain/drafts";
import type Aside from "../../main";
import type { AgentStreamUpdate } from "../../agents/commentAgentController";
import SideNoteFileFilterModal from "../modals/SideNoteFileFilterModal";
import SideNoteLinkSuggestModal from "../modals/SideNoteLinkSuggestModal";
import SideNoteOpenFileSuggestModal from "../modals/SideNoteOpenFileSuggestModal";
import SideNoteTagSuggestModal from "../modals/SideNoteTagSuggestModal";
import { extractTagsFromText, normalizeTagText } from "../../core/text/commentTags";
import { ASIDE_ICON_ID } from "../asideIcon";
import { copyTextToClipboard } from "../copyTextToClipboard";
import { SidebarDraftEditorController } from "./sidebarDraftEditor";
import {
    renderDraftCommentCard,
    renderInlineEditDraftContent,
} from "./sidebarDraftComment";
import {
    buildIndexFileFilterOptionsFromCounts,
    deriveIndexSidebarScopedFilePaths,
    resolveAutoIndexFileFilterRootPath,
    shouldLimitIndexSidebarList,
    type IndexFileFilterOption,
} from "./indexFileFilter";
import { INDEX_SIDEBAR_LIST_LIMIT, limitIndexSidebarListItems } from "./indexSidebarListLimit";
import { SidebarInteractionController } from "./sidebarInteractionController";
import {
    buildPageSidebarDraftRenderSignature,
    buildPageSidebarThreadRenderSignature,
} from "./sidebarPageRenderSignature";
import { nodeInstanceOf } from "../domGuards";
import {
    applyBatchTagToThreads,
    persistBatchTagMutation,
    removeBatchTagFromThreads,
    threadHasTag,
} from "./sidebarBatchTagOperations";
import {
    filterThreadsByPinnedSidebarViewState,
    filterThreadsBySidebarContentFilter,
    rankThreadsBySidebarSearchQuery,
    toggleDeletedSidebarViewState,
    unlockSidebarContentFilterForDraft,
    type SidebarContentFilter,
} from "./sidebarContentFilter";
import { renderPersistedCommentCard } from "./sidebarPersistedComment";
import {
    buildStoredOrderSidebarItems,
    getNestedThreadIdForEditDraft,
    getNestedThreadIdForAppendDraft,
    getReplacedThreadIdForEditDraft,
    matchesPinnedSidebarDraftVisibility,
    shouldRenderTopLevelDraftComment,
    sortSidebarRenderableItems,
    type SidebarRenderableItem,
} from "./sidebarRenderOrder";
import { buildRootedThoughtTrailScope } from "./sidebarThoughtTrailScope";
import { clearSidebarSearchHighlights, highlightSidebarSearchMatches } from "./sidebarSearchHighlight";
import {
    filterIndexThreadsByExistingSourceFiles,
    GENERIC_INDEX_EMPTY_STATE_TEXTS,
    scopeIndexThreadsByFilePaths,
    shouldShowActiveIndexEmptyState,
    shouldShowGenericIndexEmptyState,
    shouldShowIndexListToolbarChips,
    shouldShowNestedToolbarChip,
    shouldShowResolvedIndexEmptyState,
    shouldShowResolvedToolbarChip,
} from "./indexSidebarState";
import { StreamedAgentReplyController } from "./streamedAgentReplyController";
import {
    countDeletedComments,
    hasDeletedComments,
    isSoftDeleted,
} from "../../core/rules/deletedCommentVisibility";
import {
    normalizeIndexSidebarMode,
    normalizeSidebarPrimaryMode,
    normalizeIndexFileFilterRootPath,
    resolveIndexFileFilterRootPathFromState,
    resolvePinnedSidebarStateByFilePathFromState,
    type BatchTagFlowState,
    type FileTagIndex,
    type CustomViewState,
    type IndexSidebarMode,
    type PinnedSidebarFileState,
    type SidebarPrimaryMode,
} from "./viewState";
import { normalizeSidebarViewFile } from "./sidebarViewFileState";
import {
    buildSidebarFileInsertEdit,
    getSingleOpenFileInsertTarget,
} from "./sidebarFileInsertion";
import {
    renderSupportButton,
    renderSupportButtonIn,
} from "./sidebarSupportButton";
import {
    NOTE_SIDEBAR_EMPTY_CREATE_HINT_TEXT,
    renderNoSidebarFileEmptyState,
} from "./sidebarEmptyState";
import {
    renderSidebarThoughtTrail,
    type SidebarThoughtTrailOptions,
} from "./sidebarThoughtTrailRenderer";
import {
    mergeCurrentFileThreadsForThoughtTrail,
    resolveModeWithThoughtTrailAvailability,
} from "./sidebarThoughtTrailState";
import {
    renderActiveFileFilters,
    renderSidebarModeControl,
    renderSidebarSearchInput,
    renderToolbarChip,
    renderToolbarIconButton,
    type SidebarModeControlOptions,
    type SidebarSearchInputOptions,
    type ToolbarActionGuard,
    type ToolbarChipOptions,
    type ToolbarIconButtonOptions,
} from "./sidebarToolbarRenderer";

function matchesResolvedVisibility(resolved: boolean | undefined, showResolved: boolean): boolean {
    return showResolved ? resolved === true : resolved !== true;
}

const EMPTY_PINNED_SIDEBAR_THREAD_IDS: ReadonlySet<string> = new Set<string>();
const THOUGHT_TRAIL_LOG_PATH_SAMPLE_LIMIT = 8;
const DEFAULT_BATCH_TAG_FLOW_STATE: BatchTagFlowState = {
    isOpen: false,
    isApplying: false,
    query: "",
    selectedTagKey: null,
    selectedTagText: null,
    candidateTagTexts: [],
    failures: [],
};

function getThoughtTrailUnavailableReason(
    hasRootScope: boolean,
    lineCount: number,
): "no-root-scope" | "no-renderable-lines" | null {
    if (!hasRootScope) {
        return "no-root-scope";
    }

    return lineCount > 0 ? null : "no-renderable-lines";
}

function summarizeThoughtTrailPaths(paths: readonly string[]): {
    count: number;
    sample: string[];
    omittedCount: number;
} {
    return {
        count: paths.length,
        sample: paths.slice(0, THOUGHT_TRAIL_LOG_PATH_SAMPLE_LIMIT),
        omittedCount: Math.max(0, paths.length - THOUGHT_TRAIL_LOG_PATH_SAMPLE_LIMIT),
    };
}

function matchesPageSidebarVisibility(
    thread: CommentThread,
    options: {
        showResolved: boolean;
        showDeleted: boolean;
    },
): boolean {
    if (options.showDeleted) {
        return isSoftDeleted(thread) || hasDeletedComments(thread);
    }

    if (isSoftDeleted(thread)) {
        return false;
    }

    return matchesResolvedVisibility(thread.resolved, options.showResolved);
}

function parseSidebarPrimaryMode(value: unknown): SidebarPrimaryMode | null {
    return normalizeSidebarPrimaryMode(value);
}

type SidebarReorderDragState =
    | {
        kind: "thread";
        filePath: string;
        threadId: string;
    }
    | {
        kind: "thread-entry";
        entryId: string;
        filePath: string;
        sourceThreadId: string;
    };

type NoteSidebarShell = {
    filePath: string;
    commentsContainerEl: HTMLDivElement;
    toolbarSlotEl: HTMLDivElement;
    commentsBodyEl: HTMLDivElement;
    supportSlotEl: HTMLDivElement;
};

type NoteSidebarRenderDescriptor = {
    key: string;
    signature: string;
    threadId: string | null;
    render: () => Promise<HTMLElement>;
};

type OpenMarkdownFileInsertTarget = {
    file: TFile;
    leaf: WorkspaceLeaf;
    view: MarkdownView;
    active: boolean;
    recent: boolean;
    editable: boolean;
};

function shouldReplaceOpenMarkdownFileInsertTarget(
    current: OpenMarkdownFileInsertTarget,
    candidate: OpenMarkdownFileInsertTarget,
): boolean {
    if (current.editable !== candidate.editable) {
        return candidate.editable;
    }

    if (current.active !== candidate.active) {
        return candidate.active;
    }

    if (current.recent !== candidate.recent) {
        return candidate.recent;
    }

    return false;
}

function compareOpenMarkdownFileInsertTargets(
    left: OpenMarkdownFileInsertTarget,
    right: OpenMarkdownFileInsertTarget,
): number {
    if (left.active !== right.active) {
        return left.active ? -1 : 1;
    }

    if (left.recent !== right.recent) {
        return left.recent ? -1 : 1;
    }

    const fileNameComparison = left.file.basename.localeCompare(right.file.basename);
    return fileNameComparison !== 0
        ? fileNameComparison
        : left.file.path.localeCompare(right.file.path);
}

async function ensureEditableMarkdownLeafForInsert(leaf: WorkspaceLeaf): Promise<MarkdownView | null> {
    if (!(leaf.view instanceof MarkdownView)) {
        return null;
    }

    if (leaf.view.getMode() !== "preview") {
        return leaf.view;
    }

    const viewState = leaf.getViewState();
    if (viewState.type !== "markdown") {
        return null;
    }

    await leaf.setViewState({
        ...viewState,
        state: {
            ...(viewState.state ?? {}),
            mode: "source",
            source: false,
        },
    });

    return leaf.view instanceof MarkdownView ? leaf.view : null;
}

export default class AsideView extends ItemView {
    private static readonly NOTE_SIDEBAR_SEARCH_DEBOUNCE_MS = 120;
    private file: TFile | null = null;
    private plugin: Aside;
    private renderVersion = 0;
    private readonly draftEditorController: SidebarDraftEditorController;
    private readonly interactionController: SidebarInteractionController;
    private readonly toolbarActionGuard: ToolbarActionGuard = {
        beforeAction: () => this.saveVisibleDraftIfPresent(),
    };
    private indexSidebarMode: IndexSidebarMode = "list";
    private noteSidebarMode: SidebarPrimaryMode = "list";
    private noteSidebarContentFilter: SidebarContentFilter = "all";
    private noteSidebarSearchQuery = "";
    private noteSidebarSearchInputValue = "";
    private noteSidebarSearchDebounceTimer: number | null = null;
    private noteSidebarSearchRequestVersion = 0;
    private noteSidebarBatchTagSearchDebounceTimer: number | null = null;
    private noteSidebarBatchTagSearchRequestVersion = 0;
    private indexSidebarSearchQuery = "";
    private noteSidebarTagIndex: FileTagIndex | null = null;
    private noteSidebarSelectedTagIds: Set<string> = new Set<string>();
    private noteSidebarVisibleTagFilterKey: string | null = null;
    private noteSidebarBatchTagFlow: BatchTagFlowState = {
        ...DEFAULT_BATCH_TAG_FLOW_STATE,
        candidateTagTexts: [],
        failures: [],
    };
    private pinnedSidebarThreadIds = new Set<string>();
    private showPinnedSidebarThreadsOnly = false;
    private pinnedSidebarStateByFilePath: Record<string, PinnedSidebarFileState> = {};
    private selectedIndexFileFilterRootPath: string | null = null;
    private indexFileFilterAutoSelectSuppressed = false;
    private indexFileFilterGraph: IndexFileFilterGraph | null = null;
    private reorderDragState: SidebarReorderDragState | null = null;
    private reorderDragSourceEl: HTMLElement | null = null;
    private reorderDropIndicatorEl: HTMLElement | null = null;
    private reorderDropIndicatorPlacement: ReorderPlacement | null = null;
    private noteSidebarShell: NoteSidebarShell | null = null;
    private readonly streamedReplyControllers = new Map<string, StreamedAgentReplyController>();
    private unsubscribeFromAgentStreamUpdates: (() => void) | null = null;

    private isNonDesktopClient(): boolean {
        const electronRequire = typeof window !== "undefined"
            ? (window as Window & { require?: unknown }).require
            : undefined;
        return Platform.isMobile || Platform.isMobileApp || typeof electronRequire !== "function";
    }

    private syncViewContainerClasses(): void {
        this.containerEl.addClass("aside-view-container");
        this.containerEl.classList.toggle("is-non-desktop", this.isNonDesktopClient());
    }

    private getNormalizedPinnedSidebarStateFilePath(filePath: string | null | undefined): string | null {
        return normalizeIndexFileFilterRootPath(filePath);
    }

    private savePinnedSidebarStateForFilePath(filePath: string | null | undefined): void {
        const normalizedFilePath = this.getNormalizedPinnedSidebarStateFilePath(filePath);
        if (!normalizedFilePath) {
            return;
        }

        if (this.pinnedSidebarThreadIds.size === 0 && !this.showPinnedSidebarThreadsOnly) {
            delete this.pinnedSidebarStateByFilePath[normalizedFilePath];
            return;
        }

        this.pinnedSidebarStateByFilePath[normalizedFilePath] = {
            threadIds: Array.from(this.pinnedSidebarThreadIds),
            showPinnedThreadsOnly: this.showPinnedSidebarThreadsOnly,
        };
    }

    private restorePinnedSidebarStateForFilePath(filePath: string | null | undefined): void {
        const normalizedFilePath = this.getNormalizedPinnedSidebarStateFilePath(filePath);
        if (!normalizedFilePath) {
            this.pinnedSidebarThreadIds.clear();
            this.showPinnedSidebarThreadsOnly = false;
            return;
        }

        const fileState = this.pinnedSidebarStateByFilePath[normalizedFilePath];
        if (!fileState) {
            this.pinnedSidebarThreadIds.clear();
            this.showPinnedSidebarThreadsOnly = false;
            return;
        }

        this.pinnedSidebarThreadIds.clear();
        this.showPinnedSidebarThreadsOnly = fileState.showPinnedThreadsOnly;
    }

    private setCurrentFile(nextFile: TFile | null): void {
        const currentFilePath = this.file?.path ?? null;
        const nextFilePath = nextFile?.path ?? null;
        if (currentFilePath !== nextFilePath) {
            this.savePinnedSidebarStateForFilePath(currentFilePath);
            this.noteSidebarTagIndex = null;
            this.noteSidebarVisibleTagFilterKey = null;
            this.noteSidebarSelectedTagIds.clear();
            this.noteSidebarBatchTagFlow = {
                ...DEFAULT_BATCH_TAG_FLOW_STATE,
                candidateTagTexts: [],
                failures: [],
            };
            this.clearNoteSidebarSearchDebounceTimer();
            this.clearNoteSidebarBatchTagSearchDebounceTimer();
            this.noteSidebarSearchRequestVersion += 1;
            this.noteSidebarSearchQuery = "";
            this.noteSidebarSearchInputValue = "";
            this.indexSidebarSearchQuery = "";
        }
        this.file = nextFile;
        if (currentFilePath !== nextFilePath) {
            this.restorePinnedSidebarStateForFilePath(nextFilePath);
        }
    }

    private rebuildNoteSidebarTagIndex(
        filePath: string,
        threads: readonly CommentThread[],
    ): FileTagIndex {
        const index: FileTagIndex = {
            filePath,
            threadIdsByTag: new Map<string, Set<string>>(),
            tagsByThreadId: new Map<string, Set<string>>(),
            tagsByDisplay: new Map<string, string>(),
        };

        for (const thread of threads) {
            const threadTagKeys = new Set<string>();
            for (const entry of thread.entries) {
                for (const rawTag of extractTagsFromText(entry.body)) {
                    const normalized = rawTag.slice(1).toLowerCase();
                    if (!normalized) {
                        continue;
                    }

                    threadTagKeys.add(normalized);
                    if (!index.threadIdsByTag.has(normalized)) {
                        index.threadIdsByTag.set(normalized, new Set<string>());
                    }
                    index.threadIdsByTag.get(normalized)!.add(thread.id);
                    if (!index.tagsByDisplay.has(normalized)) {
                        index.tagsByDisplay.set(normalized, rawTag);
                    }
                }
            }

            if (threadTagKeys.size > 0) {
                index.tagsByThreadId.set(thread.id, threadTagKeys);
            }
        }

        return index;
    }

    private getTagDisplayForKey(tagKey: string): string | null {
        return this.noteSidebarTagIndex?.tagsByDisplay.get(tagKey.toLowerCase()) ?? null;
    }

    private getNormalizedTagKey(tagText: string): string {
        return normalizeTagText(tagText).slice(1).toLowerCase();
    }

    private getNoteSidebarTagCandidateTexts(query: string): readonly string[] {
        const normalized = this.getNormalizedTagKey(query);
        if (!normalized) {
            return [];
        }

        const index = this.noteSidebarTagIndex;
        if (!index) {
            return [];
        }

        const matches = Array.from(index.threadIdsByTag.keys())
            .filter((tagKey) => tagKey.includes(normalized))
            .sort((left, right) => {
                if (left === normalized) {
                    return -1;
                }
                if (right === normalized) {
                    return 1;
                }
                const leftStartsWith = left.startsWith(normalized);
                const rightStartsWith = right.startsWith(normalized);
                if (leftStartsWith !== rightStartsWith) {
                    return leftStartsWith ? -1 : 1;
                }
                return left.localeCompare(right);
            })
            .map((tagKey) => index.tagsByDisplay.get(tagKey))
            .filter((value): value is string => !!value);

        return matches.filter((tagText, index, self) => self.indexOf(tagText) === index).slice(0, 8);
    }

    private getBatchTagFlowHasExactMatch(normalizedTagKey: string): boolean {
        return !!(this.noteSidebarTagIndex?.threadIdsByTag.has(normalizedTagKey.toLowerCase()));
    }

    private getTagActionFromBatchPanel(): "add" | "remove" {
        return this.noteSidebarMode === "tags"
            && this.noteSidebarVisibleTagFilterKey !== null
            && !this.noteSidebarBatchTagFlow.query.trim()
            ? "remove"
            : "add";
    }

    private getBatchTagActionTagText(): string | null {
        if (this.getTagActionFromBatchPanel() !== "remove") {
            return this.getNoteSidebarBatchTagText();
        }

        const visibleTagFilterKey = this.noteSidebarVisibleTagFilterKey;
        if (!visibleTagFilterKey) {
            return null;
        }

        return normalizeTagText(
            this.getTagDisplayForKey(visibleTagFilterKey)
            ?? `#${visibleTagFilterKey}`,
        );
    }

    private hasBatchTagRemovalTargetOnSelection(targetTagKey: string): boolean {
        for (const threadId of this.noteSidebarSelectedTagIds) {
            const thread = this.plugin.getThreadById(threadId);
            if (!thread) {
                continue;
            }

            if (threadHasTag(thread, targetTagKey)) {
                return true;
            }
        }

        return false;
    }

    private updateNoteSidebarBatchTagCandidateTexts(query: string): void {
        query = this.normalizeTagSearchQuery(query);
        const normalizedTagKey = this.getNormalizedTagKey(query);
        const candidateTagTexts = this.getNoteSidebarTagCandidateTexts(query);
        const exactMatchTagKey = normalizedTagKey && this.getBatchTagFlowHasExactMatch(normalizedTagKey)
            ? normalizedTagKey
            : null;
        const isSingleCandidate = normalizedTagKey && !exactMatchTagKey && candidateTagTexts.length === 1;
        const selectedSingleCandidate = isSingleCandidate ? candidateTagTexts[0] : null;
        const normalizedSingleCandidate = selectedSingleCandidate
            ? this.getNormalizedTagKey(selectedSingleCandidate)
            : null;
        const selectedTagText = selectedSingleCandidate
            ? selectedSingleCandidate
            : normalizedTagKey
                ? (this.getTagDisplayForKey(normalizedTagKey) ?? normalizeTagText(query))
                : null;
        this.noteSidebarBatchTagFlow = {
            ...this.noteSidebarBatchTagFlow,
            query,
            selectedTagKey: exactMatchTagKey ?? normalizedSingleCandidate,
            selectedTagText,
            candidateTagTexts,
            failures: [],
            isOpen: true,
        };
    }

    private normalizeTagSearchQuery(query: string): string {
        const trimmedQuery = query.trim();
        return trimmedQuery.replace(/\s+/g, "-");
    }

    private setNoteSidebarBatchTagCandidate(tagText: string): void {
        const normalizedTagText = normalizeTagText(tagText);
        if (!normalizedTagText) {
            return;
        }

        const normalizedTagKey = this.getNormalizedTagKey(normalizedTagText);
        this.clearNoteSidebarBatchTagSearchDebounceTimer();
        this.noteSidebarBatchTagSearchRequestVersion += 1;
        this.noteSidebarBatchTagFlow = {
            ...this.noteSidebarBatchTagFlow,
            query: normalizedTagText,
            selectedTagKey: this.getBatchTagFlowHasExactMatch(normalizedTagKey)
                ? normalizedTagKey
                : null,
            selectedTagText: this.getTagDisplayForKey(normalizedTagKey) ?? normalizedTagText,
            candidateTagTexts: this.getNoteSidebarTagCandidateTexts(normalizedTagText),
            failures: [],
            isOpen: true,
        };
    }

    private clearNoteSidebarBatchTagFlowPanel(): void {
        this.clearNoteSidebarBatchTagSearchDebounceTimer();
        this.noteSidebarBatchTagSearchRequestVersion += 1;
        this.noteSidebarBatchTagFlow = {
            ...DEFAULT_BATCH_TAG_FLOW_STATE,
            candidateTagTexts: [],
            failures: [],
        };
    }

    private clearNoteSidebarBatchTagSearchInput(): void {
        this.clearNoteSidebarBatchTagSearchDebounceTimer();
        this.noteSidebarBatchTagSearchRequestVersion += 1;
        this.noteSidebarBatchTagFlow = {
            ...this.noteSidebarBatchTagFlow,
            query: "",
            selectedTagKey: null,
            selectedTagText: null,
            candidateTagTexts: [],
        };

        const shell = this.noteSidebarShell;
        if (!shell) {
            return;
        }

        const inputEl = shell.toolbarSlotEl.querySelector<HTMLInputElement>(
            ".aside-note-search-input.aside-note-tag-batch-search-input",
        );
        if (inputEl) {
            inputEl.value = "";
        }
    }

    private getNoteSidebarBatchTagText(): string | null {
        if (this.noteSidebarBatchTagFlow.selectedTagKey) {
            const display = this.getTagDisplayForKey(this.noteSidebarBatchTagFlow.selectedTagKey);
            if (display) {
                return normalizeTagText(display);
            }
        }
        if (this.noteSidebarBatchTagFlow.selectedTagText) {
            return normalizeTagText(this.noteSidebarBatchTagFlow.selectedTagText);
        }
        if (this.noteSidebarBatchTagFlow.query) {
            return normalizeTagText(this.noteSidebarBatchTagFlow.query);
        }

        return null;
    }

    private restoreNoteSidebarTagBatchSearchFocus(
        selectionStart: number | null = null,
        selectionEnd: number | null = null,
    ): void {
        const shell = this.noteSidebarShell;
        if (!shell) {
            return;
        }

        const searchInput = shell.toolbarSlotEl.querySelector(
            ".aside-note-search-input.aside-note-tag-batch-search-input",
        );
        if (!(searchInput instanceof HTMLInputElement)) {
            return;
        }

        const maxSelection = searchInput.value.length;
        const resolvedSelectionStart = Math.max(0, Math.min(selectionStart ?? maxSelection, maxSelection));
        const resolvedSelectionEnd = Math.max(0, Math.min(selectionEnd ?? resolvedSelectionStart, maxSelection));

        this.interactionController.claimSidebarInteractionOwnership(searchInput);
        searchInput.focus();
        searchInput.setSelectionRange(resolvedSelectionStart, resolvedSelectionEnd);
    }

    private syncPinnedSidebarThreadIds<T extends Pick<CommentThread, "id" | "isPinned">>(threads: readonly T[]): void {
        const nextPinnedThreadIds = new Set(
            threads
                .filter((thread) => thread.isPinned === true)
                .map((thread) => thread.id),
        );
        const hasChanged = nextPinnedThreadIds.size !== this.pinnedSidebarThreadIds.size
            || Array.from(nextPinnedThreadIds).some((threadId) => !this.pinnedSidebarThreadIds.has(threadId));
        if (!hasChanged) {
            return;
        }

        this.pinnedSidebarThreadIds = nextPinnedThreadIds;
        this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
    }

    private isPinnedSidebarThread(threadId: string): boolean {
        return this.pinnedSidebarThreadIds.has(threadId);
    }

    private getPinnedSidebarFilterThreadIds(): ReadonlySet<string> {
        return this.showPinnedSidebarThreadsOnly
            ? this.pinnedSidebarThreadIds
            : EMPTY_PINNED_SIDEBAR_THREAD_IDS;
    }

    private async setSidebarCommentPinnedState(threadId: string, isPinned: boolean): Promise<void> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        const updated = await this.plugin.setCommentPinnedState(
            threadId,
            isPinned,
            currentFilePath
                ? {
                    deferAggregateRefresh: true,
                    skipPersistedViewRefresh: true,
                    refreshEditorDecorations: false,
                    refreshMarkdownPreviews: false,
                }
                : undefined,
        );
        if (!updated) {
            return;
        }

        await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
    }

    private async togglePinnedSidebarThread(threadId: string): Promise<void> {
        await this.setSidebarCommentPinnedState(threadId, !this.pinnedSidebarThreadIds.has(threadId));
    }

    private getCurrentLocalNoteSidebarFilePath(): string | null {
        const currentFilePath = this.file?.path ?? null;
        if (!currentFilePath || this.plugin.isAllCommentsNotePath(currentFilePath)) {
            return null;
        }

        return currentFilePath;
    }

    private async rerenderLocalNoteSidebarIfStillShowing(filePath: string | null): Promise<void> {
        if (!filePath || this.file?.path !== filePath) {
            return;
        }

        await this.renderComments({
            skipDataRefresh: true,
        });
    }

    private async setSidebarCommentResolvedState(commentId: string, resolved: boolean): Promise<void> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        const updated = resolved
            ? await this.plugin.resolveComment(
                commentId,
                currentFilePath
                    ? {
                        deferAggregateRefresh: true,
                        skipPersistedViewRefresh: true,
                    }
                    : undefined,
            )
            : await this.plugin.unresolveComment(
                commentId,
                currentFilePath
                    ? {
                        deferAggregateRefresh: true,
                        skipPersistedViewRefresh: true,
                    }
                    : undefined,
            );
        if (!updated) {
            return;
        }

        await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
    }

    private async deleteSidebarComment(commentId: string): Promise<boolean> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        let exitedDeletedMode = false;
        if (currentFilePath && this.plugin.shouldShowDeletedComments()) {
            exitedDeletedMode = await this.plugin.setShowDeletedComments(false, {
                skipCommentViewRefresh: true,
            });
        } else if (!currentFilePath && this.plugin.shouldShowDeletedComments()) {
            await this.plugin.setShowDeletedComments(false);
        }

        const deleted = await this.plugin.deleteComment(
            commentId,
            currentFilePath
                ? {
                    deferAggregateRefresh: true,
                    skipPersistedViewRefresh: true,
                }
                : undefined,
        );
        if (!deleted) {
            if (exitedDeletedMode) {
                await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
            }
            return false;
        }

        await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
        return true;
    }

    private async clearDeletedSidebarComment(commentId: string): Promise<boolean> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        const cleared = await this.plugin.clearDeletedComment(commentId);
        if (!cleared) {
            return false;
        }

        if (currentFilePath) {
            const stillHasDeletedComments = this.plugin
                .getThreadsForFile(currentFilePath, { includeDeleted: true })
                .some((thread) => hasDeletedComments(thread));
            if (!stillHasDeletedComments && this.plugin.shouldShowDeletedComments()) {
                await this.plugin.setShowDeletedComments(false, {
                    skipCommentViewRefresh: true,
                });
            }
            await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
        }

        return true;
    }

    private async moveSidebarCommentThreadToFile(threadId: string, targetFilePath: string): Promise<boolean> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        const moved = await this.plugin.moveCommentThreadToFile(
            threadId,
            targetFilePath,
            currentFilePath
                ? {
                    deferAggregateRefresh: true,
                    skipPersistedViewRefresh: true,
                }
                : undefined,
        );
        if (!moved) {
            return false;
        }

        await this.rerenderLocalNoteSidebarIfStillShowing(currentFilePath);
        return true;
    }

    private async moveSidebarCommentEntryToThread(entryId: string, targetThreadId: string): Promise<boolean> {
        const currentFilePath = this.getCurrentLocalNoteSidebarFilePath();
        const moved = await this.plugin.moveCommentEntryToThread(
            entryId,
            targetThreadId,
            currentFilePath
                ? {
                    deferAggregateRefresh: true,
                    skipPersistedViewRefresh: true,
                    refreshEditorDecorations: false,
                    refreshMarkdownPreviews: false,
                }
                : undefined,
        );
        if (!moved) {
            return false;
        }

        await this.plugin.setShowNestedCommentsForThread(targetThreadId, true, currentFilePath
            ? {
                skipCommentViewRefresh: true,
            }
            : undefined);
        if (currentFilePath && this.file?.path === currentFilePath) {
            this.highlightComment(entryId, {
                skipDataRefresh: true,
            });
            return true;
        }

        this.highlightComment(entryId);
        return true;
    }

    private async togglePinnedSidebarMode(): Promise<void> {
        this.showPinnedSidebarThreadsOnly = !this.showPinnedSidebarThreadsOnly;
        this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
        await this.renderComments({
            skipDataRefresh: true,
        });
    }

    private clearNoteSidebarSearchDebounceTimer(): void {
        if (this.noteSidebarSearchDebounceTimer === null) {
            return;
        }

        window.clearTimeout(this.noteSidebarSearchDebounceTimer);
        this.noteSidebarSearchDebounceTimer = null;
    }

    private clearNoteSidebarBatchTagSearchDebounceTimer(): void {
        if (this.noteSidebarBatchTagSearchDebounceTimer === null) {
            return;
        }

        window.clearTimeout(this.noteSidebarBatchTagSearchDebounceTimer);
        this.noteSidebarBatchTagSearchDebounceTimer = null;
    }

    private scheduleNoteSidebarBatchTagSearchQuery(query: string): void {
        const activeElement = this.containerEl.ownerDocument.activeElement;
        const isBatchSearchInputFocused = nodeInstanceOf(activeElement, HTMLInputElement)
            && activeElement.matches(".aside-note-search-input.aside-note-tag-batch-search-input");
        const activeSelectionStart = isBatchSearchInputFocused ? activeElement.selectionStart : null;
        const activeSelectionEnd = isBatchSearchInputFocused ? activeElement.selectionEnd : null;
        const normalizedQuery = this.normalizeTagSearchQuery(query);
        const normalizedTagKey = this.getNormalizedTagKey(normalizedQuery);
        const exactTagKey = normalizedTagKey && this.getBatchTagFlowHasExactMatch(normalizedTagKey)
            ? normalizedTagKey
            : null;
        this.noteSidebarBatchTagFlow = {
            ...this.noteSidebarBatchTagFlow,
            query: normalizedQuery,
            selectedTagKey: exactTagKey,
            selectedTagText: exactTagKey
                ? (this.getTagDisplayForKey(exactTagKey) ?? normalizeTagText(normalizedQuery))
                : (normalizedQuery.trim() ? normalizeTagText(normalizedQuery) : null),
            candidateTagTexts: [],
            failures: [],
            isOpen: true,
        };
        this.clearNoteSidebarBatchTagSearchDebounceTimer();
        const requestVersion = ++this.noteSidebarBatchTagSearchRequestVersion;
        this.noteSidebarBatchTagSearchDebounceTimer = window.setTimeout(() => {
            this.noteSidebarBatchTagSearchDebounceTimer = null;
            (() => {
                if (requestVersion !== this.noteSidebarBatchTagSearchRequestVersion) {
                    return;
                }

                this.updateNoteSidebarBatchTagCandidateTexts(normalizedQuery);
                this.refreshNoteSidebarTagBatchPanel();
                if (
                    requestVersion !== this.noteSidebarBatchTagSearchRequestVersion
                    || !isBatchSearchInputFocused
                ) {
                    return;
                }

                this.restoreNoteSidebarTagBatchSearchFocus(activeSelectionStart, activeSelectionEnd);
            })();
        }, AsideView.NOTE_SIDEBAR_SEARCH_DEBOUNCE_MS);
    }

    private refreshNoteSidebarTagBatchPanel(): void {
        const shell = this.noteSidebarShell;
        if (!shell) {
            return;
        }

        const toolbarEl = shell.toolbarSlotEl.querySelector<HTMLElement>(".aside-sidebar-toolbar");
        if (!toolbarEl) {
            return;
        }

        const existingRow = toolbarEl.querySelector(".is-note-tag-batch-row");
        if (existingRow) {
            existingRow.remove();
        }

        if (!this.noteSidebarBatchTagFlow.isOpen) {
            return;
        }

        this.renderNoteSidebarTagBatchFlowPanel(toolbarEl);
    }

    private scheduleNoteSidebarSearchQuery(
        query: string,
        options: {
            selectionStart?: number | null;
            selectionEnd?: number | null;
        } = {},
    ): void {
        this.noteSidebarSearchInputValue = query;
        const requestVersion = ++this.noteSidebarSearchRequestVersion;
        this.clearNoteSidebarSearchDebounceTimer();
        if (this.noteSidebarSearchQuery === query) {
            return;
        }

        this.noteSidebarSearchDebounceTimer = window.setTimeout(() => {
            this.noteSidebarSearchDebounceTimer = null;
            void this.applyNoteSidebarSearchQuery(query, requestVersion, options);
        }, AsideView.NOTE_SIDEBAR_SEARCH_DEBOUNCE_MS);
    }

    private async applyNoteSidebarSearchQuery(
        query: string,
        requestVersion: number,
        options: {
            selectionStart?: number | null;
            selectionEnd?: number | null;
        } = {},
    ): Promise<void> {
        if (this.noteSidebarSearchQuery === query) {
            return;
        }

        this.noteSidebarSearchInputValue = query;
        const activeElement = this.containerEl.ownerDocument.activeElement;
        const shouldRestoreFocus = nodeInstanceOf(activeElement, HTMLInputElement)
            && activeElement.matches(".aside-note-search-input")
            && this.containerEl.contains(activeElement);
        if (query.trim() && this.noteSidebarMode === "thought-trail") {
            this.noteSidebarMode = "list";
            void this.plugin.logEvent("info", "note", "note.mode.changed", {
                mode: "list",
                source: "search",
            });
        }

        this.noteSidebarSearchQuery = query;
        const currentFilePath = this.file?.path ?? null;
        await this.renderComments({
            skipDataRefresh: true,
        });
        if (requestVersion !== this.noteSidebarSearchRequestVersion) {
            return;
        }

        if (
            !currentFilePath
            || this.file?.path !== currentFilePath
            || this.plugin.isAllCommentsNotePath(currentFilePath)
            || !shouldRestoreFocus
        ) {
            return;
        }

        const inputEl = this.containerEl.querySelector(".aside-note-search-input");
        if (!(inputEl instanceof HTMLInputElement)) {
            return;
        }

        const maxSelection = inputEl.value.length;
        const selectionStart = Math.max(0, Math.min(options.selectionStart ?? maxSelection, maxSelection));
        const selectionEnd = Math.max(0, Math.min(options.selectionEnd ?? selectionStart, maxSelection));
        this.interactionController.claimSidebarInteractionOwnership(inputEl);
        inputEl.setSelectionRange(selectionStart, selectionEnd);
    }

    constructor(leaf: WorkspaceLeaf, plugin: Aside, file: TFile | null = null) {
        super(leaf);
        this.plugin = plugin;
        this.file = file;
        this.interactionController = new SidebarInteractionController({
            app: this.app,
            leaf: this.leaf,
            containerEl: this.containerEl,
            getCurrentFile: () => this.file,
            getDraftForView: (filePath) => this.plugin.getDraftForView(filePath),
            renderComments: (options) => this.renderComments(options),
            saveDraft: (commentId) => this.plugin.saveDraft(commentId),
            cancelDraft: (commentId) => {
                void this.plugin.cancelDraft(commentId);
            },
            clearRevealedCommentSelection: () => {
                this.plugin.clearRevealedCommentSelection();
            },
            revealComment: (comment) => this.plugin.revealComment(comment),
            openCommentById: (filePath, commentId) => this.plugin.openCommentById(filePath, commentId),
            getPreferredFileLeaf: () => this.plugin.getPreferredFileLeaf(),
            openLinkText: (href, sourcePath) => this.app.workspace.openLinkText(href, sourcePath, false),
            shouldShowDeletedComments: () => this.plugin.shouldShowDeletedComments(),
            setShowDeletedComments: async (showDeleted) => {
                await this.plugin.setShowDeletedComments(showDeleted);
            },
            log: (level, area, event, payload) => this.plugin.logEvent(level, area, event, payload),
        });
        this.draftEditorController = new SidebarDraftEditorController({
            getAllIndexedComments: () => this.plugin.getAllIndexedComments(),
            updateDraftCommentText: (commentId, commentText) => {
                this.plugin.updateDraftCommentText(commentId, commentText);
            },
            renderComments: () => this.renderComments(),
            scheduleDraftFocus: (commentId) => this.interactionController.scheduleDraftFocus(commentId),
            openLinkSuggestModal: (options) => {
                new SideNoteLinkSuggestModal(this.app, options).open();
            },
            openTagSuggestModal: (options) => {
                new SideNoteTagSuggestModal(this.app, options).open();
            },
        });
    }

    getViewType() {
        return "aside-view";
    }

    getDisplayText() {
        return "Side notes";
    }

    getIcon() {
        return ASIDE_ICON_ID;
    }

    async onOpen() {
        this.interactionController.cancelPendingRevealedCommentSelectionClear();
        await Promise.resolve();
        if (!this.file) {
            this.file = this.plugin.getSidebarTargetFile();
        }
        this.unsubscribeFromAgentStreamUpdates = this.plugin.subscribeToAgentStreamUpdates((update) => {
            this.handleAgentStreamUpdate(update);
        });
        const doc = this.containerEl.ownerDocument;
        doc.addEventListener("keydown", this.interactionController.documentKeydownHandler, true);
        doc.addEventListener("mousedown", this.interactionController.documentMouseDownHandler, true);
        doc.addEventListener("copy", this.interactionController.documentCopyHandler, true);
        doc.addEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.addEventListener("click", this.interactionController.sidebarClickHandler);
        void this.renderComments().catch((error) => {
            void this.plugin.logEvent("error", "sidebar", "sidebar.render.open.error", { error });
        });
    }

    async onClose() {
        this.unsubscribeFromAgentStreamUpdates?.();
        this.unsubscribeFromAgentStreamUpdates = null;
        this.clearNoteSidebarSearchDebounceTimer();
        this.noteSidebarShell = null;
        this.resetStreamedReplyControllers();
        const doc = this.containerEl.ownerDocument;
        doc.removeEventListener("keydown", this.interactionController.documentKeydownHandler, true);
        doc.removeEventListener("mousedown", this.interactionController.documentMouseDownHandler, true);
        doc.removeEventListener("copy", this.interactionController.documentCopyHandler, true);
        doc.removeEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.removeEventListener("click", this.interactionController.sidebarClickHandler);
        this.interactionController.cancelPendingRevealedCommentSelectionClear();
        await Promise.resolve();
    }

    async setState(state: CustomViewState, result: ViewStateResult): Promise<void> {
        let shouldRender = false;
        const nextPinnedSidebarStateByFilePath = resolvePinnedSidebarStateByFilePathFromState(state);
        if (nextPinnedSidebarStateByFilePath !== undefined) {
            this.pinnedSidebarStateByFilePath = nextPinnedSidebarStateByFilePath;
            if (this.file) {
                this.restorePinnedSidebarStateForFilePath(this.file.path);
                shouldRender = true;
            }
        }

        const nextMode = normalizeIndexSidebarMode(state.indexSidebarMode);
        if (nextMode && nextMode !== this.indexSidebarMode) {
            this.indexSidebarMode = nextMode;
            void this.plugin.logEvent("info", "index", "index.mode.changed", {
                mode: nextMode,
                source: "view-state",
            });
            shouldRender = true;
        }

        const nextNoteMode = parseSidebarPrimaryMode(state.noteSidebarMode);
        if (nextNoteMode && nextNoteMode !== this.noteSidebarMode) {
            this.noteSidebarMode = nextNoteMode;
            void this.plugin.logEvent("info", "note", "note.mode.changed", {
                mode: nextNoteMode,
                source: "view-state",
            });
            shouldRender = true;
        }

        const nextRootPath = resolveIndexFileFilterRootPathFromState(state);
        if (nextRootPath !== undefined && nextRootPath !== this.selectedIndexFileFilterRootPath) {
            this.selectedIndexFileFilterRootPath = nextRootPath;
            void this.plugin.logEvent("info", "index", "index.filter.changed", {
                rootFilePath: nextRootPath,
                source: "view-state",
            });
            shouldRender = true;
        }

        if (state.filePath) {
            const file = this.app.vault.getAbstractFileByPath(state.filePath);
            const normalizedFile = file instanceof TFile
                ? normalizeSidebarViewFile(file, (candidate): candidate is TFile => this.plugin.isSidebarSupportedFile(candidate))
                : null;
            if (normalizedFile) {
                this.setCurrentFile(normalizedFile);
                shouldRender = true;
            } else if (this.file !== null) {
                this.setCurrentFile(null);
                shouldRender = true;
            }
        } else if (state.filePath === null && this.file) {
            this.setCurrentFile(null);
            shouldRender = true;
        }

        await super.setState(state, result);
        if (shouldRender) {
            void this.renderComments().catch((error) => {
                void this.plugin.logEvent("error", "sidebar", "sidebar.render.state.error", { error });
            });
        }
    }

    public async updateActiveFile(file: TFile | null, options: { skipDataRefresh?: boolean } = {}) {
        this.setCurrentFile(
            normalizeSidebarViewFile(file, (candidate): candidate is TFile => this.plugin.isSidebarSupportedFile(candidate)),
        );
        await this.renderComments(options);
    }

    public getCurrentFile(): TFile | null {
        return this.file;
    }

    public highlightComment(commentId: string, options: { skipDataRefresh?: boolean } = {}) {
        const previousMode = this.noteSidebarMode;
        this.ensureListModeForCommentFocus();
        this.interactionController.highlightComment(commentId, options);
        const currentFilePath = this.file?.path ?? null;
        if (currentFilePath && this.plugin.isAllCommentsNotePath(currentFilePath)) {
            void this.plugin.syncIndexCommentHighlightPair(commentId, currentFilePath);
        }
        if (previousMode === "tags" && this.noteSidebarMode !== "tags" && this.file
            && !this.plugin.isAllCommentsNotePath(this.file.path)) {
            this.noteSidebarMode = "tags";
        }
    }

    public async highlightAndFocusDraft(commentId: string) {
        const previousMode = this.noteSidebarMode;
        this.ensureListModeForCommentFocus();
        await this.interactionController.highlightAndFocusDraft(commentId);
        if (previousMode === "tags" && this.noteSidebarMode !== "tags" && this.file
            && !this.plugin.isAllCommentsNotePath(this.file.path)) {
            this.noteSidebarMode = "tags";
        }
    }

    public focusDraft(commentId: string): void {
        const previousMode = this.noteSidebarMode;
        this.ensureListModeForCommentFocus();
        this.interactionController.focusDraft(commentId);
        if (previousMode === "tags" && this.noteSidebarMode !== "tags" && this.file
            && !this.plugin.isAllCommentsNotePath(this.file.path)) {
            this.noteSidebarMode = "tags";
        }
    }

    public clearActiveState(): void {
        this.interactionController.clearActiveState();
    }

    public async renderComments(options: {
        skipDataRefresh?: boolean;
    } = {}) {
        const renderVersion = ++this.renderVersion;
        const normalizedFile = normalizeSidebarViewFile(
            this.file,
            (candidate): candidate is TFile => this.plugin.isSidebarSupportedFile(candidate),
        );
        if (normalizedFile !== this.file) {
            this.setCurrentFile(normalizedFile);
        }
        const file = normalizedFile;
        const isAllCommentsView = !!file && this.plugin.isAllCommentsNotePath(file.path);
        this.clearReorderDragState();
        if (file && !isAllCommentsView) {
            this.indexFileFilterGraph = null;
            if (!options.skipDataRefresh) {
                await this.plugin.loadCommentsForFile(file);
            }
            if (renderVersion !== this.renderVersion || this.file?.path !== file.path) {
                return;
            }

            await this.renderPageSidebar(file, renderVersion);
            return;
        }

        this.noteSidebarShell = null;
        this.resetStreamedReplyControllers();
        if (file) {
            const showDeleted = this.plugin.shouldShowDeletedComments();
            if (isAllCommentsView && !options.skipDataRefresh) {
                await this.plugin.ensureIndexedCommentsLoaded();
                if (renderVersion !== this.renderVersion || this.file?.path !== file.path) {
                    return;
                }
            }
            const indexFileFilterState = isAllCommentsView
                ? await this.buildIndexFileFilterStateFromIndexNote(file)
                : {
                    options: [] as IndexFileFilterOption[],
                    firstFilePath: null,
                };
            if (renderVersion !== this.renderVersion || this.file?.path !== file.path) {
                return;
            }
            let selectedIndexFileFilterRootPath = isAllCommentsView
                ? resolveAutoIndexFileFilterRootPath({
                    currentRootPath: this.selectedIndexFileFilterRootPath,
                    firstIndexFilePath: indexFileFilterState.firstFilePath,
                    autoSelectSuppressed: this.indexFileFilterAutoSelectSuppressed,
                })
                : null;
            let selectedIndexSourceFile: TFile | null = null;
            if (isAllCommentsView && selectedIndexFileFilterRootPath !== this.selectedIndexFileFilterRootPath) {
                this.selectedIndexFileFilterRootPath = selectedIndexFileFilterRootPath;
                this.plugin.syncIndexPreviewFileScope(file.path);
            }

            if (isAllCommentsView && selectedIndexFileFilterRootPath) {
                const sourceFile = this.app.vault.getAbstractFileByPath(selectedIndexFileFilterRootPath);
                if (sourceFile instanceof TFile) {
                    selectedIndexSourceFile = sourceFile;
                    if (!options.skipDataRefresh) {
                        await this.plugin.loadCommentsForFile(sourceFile);
                    }
                } else {
                    selectedIndexFileFilterRootPath = resolveAutoIndexFileFilterRootPath({
                        currentRootPath: null,
                        firstIndexFilePath: indexFileFilterState.firstFilePath,
                        autoSelectSuppressed: this.indexFileFilterAutoSelectSuppressed,
                    });
                    this.selectedIndexFileFilterRootPath = selectedIndexFileFilterRootPath;
                    this.plugin.syncIndexPreviewFileScope(file.path);
                    if (selectedIndexFileFilterRootPath) {
                        const fallbackSourceFile = this.app.vault.getAbstractFileByPath(selectedIndexFileFilterRootPath);
                        if (fallbackSourceFile instanceof TFile) {
                            selectedIndexSourceFile = fallbackSourceFile;
                            if (!options.skipDataRefresh) {
                                await this.plugin.loadCommentsForFile(fallbackSourceFile);
                            }
                        } else {
                            this.selectedIndexFileFilterRootPath = null;
                            selectedIndexFileFilterRootPath = null;
                            this.plugin.syncIndexPreviewFileScope(file.path);
                        }
                    }
                }
            }

            if (isAllCommentsView) {
                this.indexFileFilterGraph = null;
            } else {
                this.indexFileFilterGraph = null;
                await this.plugin.loadCommentsForFile(file);
            }
            if (renderVersion !== this.renderVersion || this.file?.path !== file.path) {
                return;
            }

            this.containerEl.empty();
            this.syncViewContainerClasses();
            const persistedThreads = isAllCommentsView
                ? this.plugin.getAllIndexedThreads()
                : this.plugin.getThreadsForFile(file.path, { includeDeleted: showDeleted });
            const pageThreadsWithDeleted = isAllCommentsView
                ? []
                : this.plugin.getThreadsForFile(file.path, { includeDeleted: true });
            const deletedCommentCount = isAllCommentsView
                ? 0
                : countDeletedComments(pageThreadsWithDeleted);
            const showResolved = this.plugin.shouldShowResolvedComments();
            const allAgentRuns = this.plugin.getAgentRuns();
            this.noteSidebarTagIndex = isAllCommentsView && selectedIndexSourceFile
                ? this.rebuildNoteSidebarTagIndex(selectedIndexSourceFile.path, persistedThreads)
                : isAllCommentsView
                    ? null
                    : this.noteSidebarTagIndex;
            if (
                isAllCommentsView
                && this.noteSidebarVisibleTagFilterKey
                && !this.noteSidebarTagIndex?.threadIdsByTag.has(this.noteSidebarVisibleTagFilterKey)
            ) {
                this.noteSidebarVisibleTagFilterKey = null;
            }
            const visiblePersistedThreads = persistedThreads.filter((thread) =>
                isAllCommentsView
                    ? matchesResolvedVisibility(thread.resolved, showResolved)
                    : matchesPageSidebarVisibility(thread, {
                        showResolved,
                        showDeleted,
                    }));
            const resolveWikiLinkPath = (linkPath: string, sourceFilePath: string): string | null =>
                this.resolveThoughtTrailWikiLinkPath(linkPath, sourceFilePath);
            const indexFileFilterGraph = isAllCommentsView
                ? selectedIndexFileFilterRootPath
                    ? buildIndexFileFilterGraph(persistedThreads, {
                    allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
                    resolveWikiLinkPath,
                    showResolved,
                })
                    : null
                : null;
            this.indexFileFilterGraph = indexFileFilterGraph;

            const filteredIndexFilePaths = isAllCommentsView
                ? deriveIndexSidebarScopedFilePaths(indexFileFilterGraph, selectedIndexFileFilterRootPath)
                : [];
            const indexFileFilterOptions = indexFileFilterState.options;
            this.syncPinnedSidebarThreadIds(persistedThreads);
            const pinnedSidebarThreadIds = isAllCommentsView ? EMPTY_PINNED_SIDEBAR_THREAD_IDS : this.pinnedSidebarThreadIds;
            const showPinnedThreadsOnly = !isAllCommentsView && this.showPinnedSidebarThreadsOnly;
            const {
                scopedVisibleThreads,
                scopedAllThreads,
            } = isAllCommentsView
                ? selectedIndexFileFilterRootPath
                    ? scopeIndexThreadsByFilePaths(visiblePersistedThreads, persistedThreads, filteredIndexFilePaths)
                    : {
                        scopedVisibleThreads: [],
                        scopedAllThreads: [],
                    }
                : {
                    scopedVisibleThreads: visiblePersistedThreads,
                    scopedAllThreads: persistedThreads,
                };
            const pinnedScopedVisibleThreads = filterThreadsByPinnedSidebarViewState(
                scopedVisibleThreads,
                pinnedSidebarThreadIds,
                showPinnedThreadsOnly,
            );
            const pinnedScopedAllThreads = filterThreadsByPinnedSidebarViewState(
                scopedAllThreads,
                pinnedSidebarThreadIds,
                showPinnedThreadsOnly,
            );
            const indexThoughtTrailLineCount = isAllCommentsView
                ? buildThoughtTrailLines(this.app.vault.getName(), pinnedScopedVisibleThreads, {
                    allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
                    resolveWikiLinkPath,
                }).length
                : 0;
            const indexThoughtTrailUnavailableReason = isAllCommentsView
                ? getThoughtTrailUnavailableReason(filteredIndexFilePaths.length > 0, indexThoughtTrailLineCount)
                : null;
            const isIndexThoughtTrailEnabled = isAllCommentsView && indexThoughtTrailUnavailableReason === null;
            if (isAllCommentsView) {
                const indexSidebarModeBeforeAvailability = this.indexSidebarMode;
                const filteredFileSummary = summarizeThoughtTrailPaths(filteredIndexFilePaths);
                void this.plugin.logEvent("info", "thoughttrail", "thoughttrail.index.availability", {
                    filePath: file.path,
                    selectedRootFilePath: selectedIndexFileFilterRootPath,
                    modeBefore: indexSidebarModeBeforeAvailability,
                    isEnabled: isIndexThoughtTrailEnabled,
                    unavailableReason: indexThoughtTrailUnavailableReason,
                    showResolved,
                    persistedThreadCount: persistedThreads.length,
                    visibleThreadCount: visiblePersistedThreads.length,
                    scopedVisibleThreadCount: pinnedScopedVisibleThreads.length,
                    scopedAllThreadCount: pinnedScopedAllThreads.length,
                    lineCount: indexThoughtTrailLineCount,
                    filteredFileCount: filteredFileSummary.count,
                    filteredFileSample: filteredFileSummary.sample,
                    filteredFileOmittedCount: filteredFileSummary.omittedCount,
                    graphAvailableFileCount: indexFileFilterGraph?.availableFiles.length ?? 0,
                    rootHasComments: selectedIndexFileFilterRootPath
                        ? indexFileFilterGraph?.fileCommentCounts.has(selectedIndexFileFilterRootPath) ?? false
                        : false,
                });
                this.indexSidebarMode = resolveModeWithThoughtTrailAvailability(
                    this.indexSidebarMode,
                    isIndexThoughtTrailEnabled,
                );
                if (indexSidebarModeBeforeAvailability === "thought-trail" && this.indexSidebarMode !== "thought-trail") {
                    void this.plugin.logEvent("warn", "thoughttrail", "thoughttrail.index.fallback", {
                        filePath: file.path,
                        selectedRootFilePath: selectedIndexFileFilterRootPath,
                        reason: indexThoughtTrailUnavailableReason,
                        lineCount: indexThoughtTrailLineCount,
                        filteredFileCount: filteredFileSummary.count,
                        scopedVisibleThreadCount: pinnedScopedVisibleThreads.length,
                    });
                }
            }
            const isIndexTagsMode = isAllCommentsView && this.indexSidebarMode === "tags";
            const indexTagThreadIds = isIndexTagsMode && this.noteSidebarVisibleTagFilterKey
                ? this.noteSidebarTagIndex?.threadIdsByTag.get(this.noteSidebarVisibleTagFilterKey) ?? null
                : null;
            const tagFilteredScopedVisibleThreads = isIndexTagsMode
                ? indexTagThreadIds
                    ? pinnedScopedVisibleThreads.filter((thread) => indexTagThreadIds.has(thread.id))
                    : []
                : pinnedScopedVisibleThreads;
            const tagFilteredScopedAllThreads = isIndexTagsMode
                ? indexTagThreadIds
                    ? pinnedScopedAllThreads.filter((thread) => indexTagThreadIds.has(thread.id))
                    : []
                : pinnedScopedAllThreads;
            const searchMatchedVisibleThreads = rankThreadsBySidebarSearchQuery(
                tagFilteredScopedVisibleThreads,
                this.indexSidebarSearchQuery,
            );
            const searchMatchedAllThreads = rankThreadsBySidebarSearchQuery(
                tagFilteredScopedAllThreads,
                this.indexSidebarSearchQuery,
            );
            const draftComment = this.plugin.getDraftForView(file.path);
            const visibleDraftComment = draftComment
                && matchesResolvedVisibility(draftComment.resolved, showResolved)
                && matchesPinnedSidebarDraftVisibility(
                    draftComment,
                    showPinnedThreadsOnly ? pinnedSidebarThreadIds : EMPTY_PINNED_SIDEBAR_THREAD_IDS,
                )
                && (!filteredIndexFilePaths.length || filteredIndexFilePaths.includes(draftComment.filePath))
                ? draftComment
                : null;
            const activeDraftHostThreadId = (visibleDraftComment?.mode === "edit" || visibleDraftComment?.mode === "append")
                ? visibleDraftComment.threadId ?? null
                : null;
            const searchScopedVisibleThreads = searchMatchedVisibleThreads.slice();
            if (
                activeDraftHostThreadId
                && !searchScopedVisibleThreads.some((thread) => thread.id === activeDraftHostThreadId)
            ) {
                const activeDraftHostThread = pinnedScopedVisibleThreads.find((thread) => thread.id === activeDraftHostThreadId);
                if (activeDraftHostThread) {
                    searchScopedVisibleThreads.push(activeDraftHostThread);
                }
            }
            const totalScopedCount = searchMatchedAllThreads.length;
            const resolvedCount = searchMatchedAllThreads.filter((thread) => thread.resolved).length;
            const hasResolvedComments = resolvedCount > 0;
            const hasNestedComments = searchScopedVisibleThreads.some((thread) => thread.entries.length > 1)
                || visibleDraftComment?.mode === "append";
            const nestedEditDraftThreadId = getNestedThreadIdForEditDraft(
                searchScopedVisibleThreads,
                visibleDraftComment,
            );
            const replacedThreadId = nestedEditDraftThreadId
                ? null
                : getReplacedThreadIdForEditDraft(
                searchScopedVisibleThreads,
                visibleDraftComment,
            );
            const nestedAppendDraftThreadId = getNestedThreadIdForAppendDraft(
                searchScopedVisibleThreads,
                visibleDraftComment,
            );
            const topLevelDraftComment = shouldRenderTopLevelDraftComment({
                draft: visibleDraftComment,
                nestedAppendDraftThreadId,
                nestedEditDraftThreadId,
                isAgentIndexMode: false,
                agentThreadIds: new Set<string>(),
            });
            const renderableItems = isAllCommentsView
                ? sortSidebarRenderableItems(
                    searchScopedVisibleThreads
                        .filter((thread) => thread.id !== replacedThreadId)
                        .map((thread) => ({ kind: "thread", thread } as SidebarRenderableItem))
                        .concat(topLevelDraftComment ? [{ kind: "draft", draft: topLevelDraftComment }] : []),
                )
                : buildStoredOrderSidebarItems(
                    pinnedScopedVisibleThreads,
                    topLevelDraftComment,
                    replacedThreadId,
                );
            const limitedComments = isAllCommentsView
                && (this.indexSidebarMode === "list" || this.indexSidebarMode === "tags")
                && shouldLimitIndexSidebarList(selectedIndexFileFilterRootPath, this.indexSidebarSearchQuery)
                ? limitIndexSidebarListItems(renderableItems)
                : {
                    visibleItems: renderableItems.slice(),
                    hiddenCount: 0,
                };
            const renderedItems = limitedComments.visibleItems;
            const commentsContainer = this.containerEl.createDiv("aside-comments-container");
            const supportThreadCount = isAllCommentsView
                ? persistedThreads.length
                : this.plugin.getThreadsForFile(file.path).length;

            this.renderSidebarToolbar(commentsContainer, {
                isAllCommentsView,
                resolvedCount,
                hasResolvedComments,
                hasDeletedComments: !isAllCommentsView && pageThreadsWithDeleted.some((thread) => hasDeletedComments(thread)),
                deletedCommentCount,
                showDeletedComments: showDeleted,
                hasNestedComments,
                isAgentMode: false,
                agentOutcomeCounts: {
                    succeeded: 0,
                    failed: 0,
                },
                isTagsEnabled: true,
                isThoughtTrailEnabled: isIndexThoughtTrailEnabled,
                noteSidebarContentFilter: "all",
                noteSidebarMode: this.noteSidebarMode,
                addPageCommentAction: !isAllCommentsView
                    ? {
                        icon: "plus",
                        ariaLabel: "Add page note",
                        onClick: () => {
                            void this.plugin.startPageCommentDraft(file);
                        },
                    }
                    : null,
                indexFileFilterOptions,
                selectedIndexFileFilterRootPath,
                filteredIndexFilePaths,
            });

            if (isAllCommentsView && selectedIndexFileFilterRootPath && filteredIndexFilePaths.length) {
                this.renderActiveFileFilters(
                    commentsContainer,
                    selectedIndexFileFilterRootPath,
                    filteredIndexFilePaths,
                );
            }

            if (isAllCommentsView && this.indexSidebarMode === "thought-trail") {
                const trailComments = pinnedScopedVisibleThreads;
                void this.plugin.logEvent("info", "thoughttrail", "thoughttrail.index.render", {
                    filePath: file.path,
                    selectedRootFilePath: selectedIndexFileFilterRootPath,
                    trailThreadCount: trailComments.length,
                    lineCount: indexThoughtTrailLineCount,
                    filteredFileCount: filteredIndexFilePaths.length,
                    filteredFileSample: filteredIndexFilePaths.slice(0, THOUGHT_TRAIL_LOG_PATH_SAMPLE_LIMIT),
                });
                await this.renderThoughtTrail(commentsContainer, trailComments, file, {
                    surface: "index",
                    hasRootScope: filteredIndexFilePaths.length > 0,
                    rootFilePath: selectedIndexFileFilterRootPath,
                });
                if (this.plugin.isLocalRuntime()) {
                    renderSupportButton(this.containerEl, this.plugin, {
                        filePath: file.path,
                        isAllCommentsView,
                        threadCount: supportThreadCount,
                    });
                }
                return;
            }

            const commentsBody = this.renderCommentsList(commentsContainer);
            this.setupPageThreadReorderInteractions(commentsBody, file.path);
            const renderPromises = renderedItems.map(async (item) => {
                if (item.kind === "draft") {
                    this.renderDraftComment(commentsBody, item.draft);
                    return;
                }

                const threadAgentRuns = getAgentRunsForCommentThread(allAgentRuns, item.thread);
                await this.renderPersistedComment(
                    commentsBody,
                    item.thread,
                    false,
                    threadAgentRuns[0] ?? null,
                    this.plugin.getActiveAgentStreamForThread(item.thread.id),
                    threadAgentRuns,
                    nestedEditDraftThreadId === item.thread.id && visibleDraftComment?.mode === "edit"
                        ? visibleDraftComment
                        : null,
                    nestedAppendDraftThreadId === item.thread.id && visibleDraftComment?.mode === "append"
                        ? visibleDraftComment
                        : null,
                );
            });
            await Promise.all(renderPromises);
            this.refreshSidebarSearchHighlights(
                commentsBody,
                isAllCommentsView ? this.indexSidebarSearchQuery : this.noteSidebarSearchQuery,
            );
            this.syncVisibleStreamedReplyControllers();

            if (limitedComments.hiddenCount > 0) {
                const limitNotice = commentsContainer.createDiv("aside-list-limit-notice");
                        limitNotice.createEl("p", {
                            text: `${INDEX_SIDEBAR_LIST_LIMIT} shown, ${limitedComments.hiddenCount} hidden.`,
                        });
                        limitNotice.createEl("p", {
                            text: "Use files to filter the index to see more.",
                        });
            }

            if (renderedItems.length === 0) {
                if (isAllCommentsView) {
                    this.renderIndexSidebarEmptyState(commentsBody, {
                        renderedItemCount: renderedItems.length,
                        showResolved,
                        totalScopedCount,
                        resolvedCount,
                        filteredIndexFilePaths,
                        searchQuery: this.indexSidebarSearchQuery,
                    });
                } else if (showResolved && totalScopedCount > 0) {
                    const emptyStateEl = commentsBody.createDiv("aside-empty-state aside-section-empty-state");
                    emptyStateEl.createEl("p", { text: "No resolved comments for this file." });
                    emptyStateEl.createEl("p", { text: "Turn off resolved to return to active comments." });
                } else if (hasResolvedComments && !showResolved) {
                    const emptyStateEl = commentsBody.createDiv("aside-empty-state aside-section-empty-state");
                    emptyStateEl.createEl("p", { text: "No active comments for this file." });
                    emptyStateEl.createEl("p", { text: "Turn on resolved to review archived comments only." });
                }
            }
        } else {
            this.resetStreamedReplyControllers();
            this.syncViewContainerClasses();
            renderNoSidebarFileEmptyState(this.containerEl);
        }

        if (this.plugin.isLocalRuntime()) {
            renderSupportButton(this.containerEl, this.plugin, {
                filePath: file?.path ?? null,
                isAllCommentsView,
                threadCount: file
                    ? (isAllCommentsView ? this.plugin.getAllIndexedThreads().length : this.plugin.getThreadsForFile(file.path).length)
                    : 0,
            });
        }
    }

    private async renderPageSidebar(file: TFile, renderVersion: number): Promise<void> {
        const shell = this.ensureNoteSidebarShell(file.path);
        const showDeleted = this.plugin.shouldShowDeletedComments();
        const showResolved = this.plugin.shouldShowResolvedComments();
        const draftComment = this.plugin.getDraftForView(file.path);
        if (draftComment && this.noteSidebarMode === "thought-trail") {
            this.noteSidebarMode = "list";
            void this.plugin.logEvent("info", "note", "note.mode.changed", {
                mode: "list",
                source: "draft-visible",
            });
        }
        this.noteSidebarContentFilter = unlockSidebarContentFilterForDraft(
            this.noteSidebarContentFilter,
            draftComment,
        );
        this.normalizeNoteSidebarContentFilter();
        const persistedThreads = this.plugin.getThreadsForFile(file.path, { includeDeleted: showDeleted });
        const pageThreadsWithDeleted = this.plugin.getThreadsForFile(file.path, { includeDeleted: true });
        const deletedCommentCount = countDeletedComments(pageThreadsWithDeleted);
        const hasResolvedThreadsInFile = persistedThreads.some((thread) => thread.resolved);
        const noteThoughtTrailAvailability = this.buildNoteThoughtTrailAvailabilityFromLoadedThreads(
            file,
            persistedThreads.filter((thread) => matchesResolvedVisibility(thread.resolved, showResolved)),
        );
        const isThoughtTrailEnabled = noteThoughtTrailAvailability.isEnabled;
        const noteSidebarModeBeforeAvailability = this.noteSidebarMode;
        const scopedFileSummary = summarizeThoughtTrailPaths(noteThoughtTrailAvailability.scopedFilePaths);
        void this.plugin.logEvent("info", "thoughttrail", "thoughttrail.note.availability", {
            filePath: file.path,
            modeBefore: noteSidebarModeBeforeAvailability,
            isEnabled: isThoughtTrailEnabled,
            unavailableReason: noteThoughtTrailAvailability.unavailableReason,
            showResolved,
            showDeleted,
            currentFileThreadCount: persistedThreads.length,
            currentVisibleThreadCount: noteThoughtTrailAvailability.currentVisibleThreadCount,
            indexedThreadCount: noteThoughtTrailAvailability.indexedThreadCount,
            mergedThreadCount: noteThoughtTrailAvailability.mergedThreadCount,
            scopedThreadCount: noteThoughtTrailAvailability.scopedThreads.length,
            lineCount: noteThoughtTrailAvailability.lineCount,
            scopedFileCount: scopedFileSummary.count,
            scopedFileSample: scopedFileSummary.sample,
            scopedFileOmittedCount: scopedFileSummary.omittedCount,
        });
        this.noteSidebarMode = resolveModeWithThoughtTrailAvailability(
            this.noteSidebarMode,
            isThoughtTrailEnabled,
        );
        if (noteSidebarModeBeforeAvailability === "thought-trail" && this.noteSidebarMode !== "thought-trail") {
            void this.plugin.logEvent("warn", "thoughttrail", "thoughttrail.note.fallback", {
                filePath: file.path,
                reason: noteThoughtTrailAvailability.unavailableReason,
                lineCount: noteThoughtTrailAvailability.lineCount,
                scopedFileCount: scopedFileSummary.count,
                scopedThreadCount: noteThoughtTrailAvailability.scopedThreads.length,
            });
        }
        if (this.noteSidebarMode === "thought-trail") {
            await this.renderNoteThoughtTrailSidebar(shell, file, renderVersion, {
                showDeleted,
            });
            return;
        }
        this.noteSidebarTagIndex = this.rebuildNoteSidebarTagIndex(file.path, persistedThreads);
        if (
            this.noteSidebarVisibleTagFilterKey
            && !this.noteSidebarTagIndex.threadIdsByTag.has(this.noteSidebarVisibleTagFilterKey)
        ) {
            this.noteSidebarVisibleTagFilterKey = null;
        }
        this.syncPinnedSidebarThreadIds(persistedThreads);
        const contentFilteredThreads = this.filterNoteSidebarThreadsByContentFilter(file.path, persistedThreads);
        const pinnedContentFilteredThreads = filterThreadsByPinnedSidebarViewState(
            contentFilteredThreads,
            this.pinnedSidebarThreadIds,
            this.showPinnedSidebarThreadsOnly,
        );
        const tagModeThreads = this.noteSidebarMode === "tags" && this.noteSidebarVisibleTagFilterKey
            ? pinnedContentFilteredThreads.filter((thread) =>
                this.noteSidebarTagIndex?.threadIdsByTag.get(this.noteSidebarVisibleTagFilterKey ?? "")?.has(thread.id) ?? false,
            )
            : pinnedContentFilteredThreads;
        const searchMatchedThreads = rankThreadsBySidebarSearchQuery(
            tagModeThreads,
            this.noteSidebarSearchQuery,
        );
        const allAgentRuns = this.plugin.getAgentRuns();
        const visibleDraftComment = draftComment
            && matchesResolvedVisibility(draftComment.resolved, showResolved)
            && matchesPinnedSidebarDraftVisibility(draftComment, this.getPinnedSidebarFilterThreadIds())
            ? draftComment
            : null;
        const activeDraftHostThreadId = (visibleDraftComment?.mode === "edit" || visibleDraftComment?.mode === "append")
            ? visibleDraftComment.threadId ?? null
            : null;
        const searchScopedThreads = searchMatchedThreads.slice();
        if (activeDraftHostThreadId && !searchScopedThreads.some((thread) => thread.id === activeDraftHostThreadId)) {
            const activeDraftHostThread = pinnedContentFilteredThreads.find((thread) => thread.id === activeDraftHostThreadId);
            if (activeDraftHostThread) {
                searchScopedThreads.push(activeDraftHostThread);
            }
        }
        const visiblePersistedThreads = searchScopedThreads.filter((thread) =>
            matchesPageSidebarVisibility(thread, {
                showResolved,
                showDeleted,
            }));
        const totalScopedCount = searchMatchedThreads.length;
        const resolvedCount = searchMatchedThreads.filter((thread) => thread.resolved).length;
        const hasResolvedComments = resolvedCount > 0;
        const hasNestedComments = searchScopedThreads.some((thread) => thread.entries.length > 1)
            || visibleDraftComment?.mode === "append";
        const nestedEditDraftThreadId = getNestedThreadIdForEditDraft(
            visiblePersistedThreads,
            visibleDraftComment,
        );
        const replacedThreadId = nestedEditDraftThreadId
            ? null
            : getReplacedThreadIdForEditDraft(
            visiblePersistedThreads,
            visibleDraftComment,
        );
        const nestedAppendDraftThreadId = getNestedThreadIdForAppendDraft(
            visiblePersistedThreads,
            visibleDraftComment,
        );
        const topLevelDraftComment = this.noteSidebarContentFilter === "all"
            && !!visibleDraftComment
            ? shouldRenderTopLevelDraftComment({
            draft: visibleDraftComment,
            nestedAppendDraftThreadId,
            nestedEditDraftThreadId,
            isAgentIndexMode: false,
            agentThreadIds: new Set<string>(),
        })
            : null;
        const renderableItems = buildStoredOrderSidebarItems(
            visiblePersistedThreads,
            topLevelDraftComment,
            replacedThreadId,
        );

        shell.toolbarSlotEl.empty();
        this.renderSidebarToolbar(shell.toolbarSlotEl, {
            isAllCommentsView: false,
            resolvedCount,
            hasResolvedComments: hasResolvedThreadsInFile,
            hasDeletedComments: pageThreadsWithDeleted.some((thread) => hasDeletedComments(thread)),
            deletedCommentCount,
            showDeletedComments: showDeleted,
            hasNestedComments,
            isAgentMode: false,
            agentOutcomeCounts: {
                succeeded: 0,
                failed: 0,
            },
            isTagsEnabled: true,
            isThoughtTrailEnabled,
            noteSidebarContentFilter: this.noteSidebarContentFilter,
            noteSidebarMode: this.noteSidebarMode,
            addPageCommentAction: {
                icon: "plus",
                ariaLabel: "Add page note",
                onClick: () => {
                    void this.plugin.startPageCommentDraft(file);
                },
            },
            indexFileFilterOptions: [],
            selectedIndexFileFilterRootPath: null,
            filteredIndexFilePaths: [],
        });

        const visiblePageThreadCount = renderableItems.filter((item) =>
            item.kind === "thread"
            && item.thread.anchorKind === "page"
            && !item.thread.deletedAt
        ).length;
        const renderDescriptors = this.buildNoteSidebarRenderDescriptors(renderableItems, {
            allAgentRuns,
            enablePageThreadReorder: visiblePageThreadCount > 1,
            nestedEditDraftThreadId,
            nestedAppendDraftThreadId,
            visibleDraftComment,
            enableTagSelection: this.noteSidebarMode === "tags",
        });
        await this.reconcileNoteSidebarItems(shell.commentsBodyEl, renderDescriptors);
        this.refreshSidebarSearchHighlights(shell.commentsBodyEl, this.noteSidebarSearchQuery);
        this.renderPageSidebarEmptyState(shell.commentsBodyEl, {
            renderedItemCount: renderableItems.length,
            showResolved,
            totalScopedCount,
            hasResolvedComments,
            noteSidebarMode: this.noteSidebarMode,
            visibleTagFilterKey: this.noteSidebarVisibleTagFilterKey,
            hasAnyTags: (this.noteSidebarTagIndex?.threadIdsByTag.size ?? 0) > 0,
            contentFilter: this.noteSidebarContentFilter,
            showPinnedThreadsOnly: this.showPinnedSidebarThreadsOnly,
            searchQuery: this.noteSidebarSearchQuery,
        });
        this.syncVisibleStreamedReplyControllers();

        shell.supportSlotEl.empty();
        if (this.plugin.isLocalRuntime()) {
            renderSupportButtonIn(shell.supportSlotEl, this.plugin, {
                filePath: file.path,
                isAllCommentsView: false,
                threadCount: this.plugin.getThreadsForFile(file.path).length,
            });
        }
    }

    private async renderNoteThoughtTrailSidebar(
        shell: NoteSidebarShell,
        file: TFile,
        renderVersion: number,
        options: {
            showDeleted: boolean;
        },
    ): Promise<void> {
        this.normalizeNoteSidebarContentFilter();
        const persistedThreads = this.plugin.getThreadsForFile(file.path, { includeDeleted: options.showDeleted });
        const pageThreadsWithDeleted = this.plugin.getThreadsForFile(file.path, { includeDeleted: true });
        const deletedCommentCount = countDeletedComments(pageThreadsWithDeleted);
        const showResolved = this.plugin.shouldShowResolvedComments();
        const hasResolvedThreadsInFile = persistedThreads.some((thread) => thread.resolved);

        const { scopedFilePaths, scopedThreads } = this.buildNoteThoughtTrailScope(file, showResolved);
        const thoughtTrailLineCount = buildThoughtTrailLines(this.app.vault.getName(), scopedThreads, {
            allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
            resolveWikiLinkPath: (linkPath, sourceFilePath) => this.resolveThoughtTrailWikiLinkPath(linkPath, sourceFilePath),
        }).length;
        const thoughtTrailUnavailableReason = getThoughtTrailUnavailableReason(
            scopedFilePaths.length > 0,
            thoughtTrailLineCount,
        );
        const isThoughtTrailEnabled = thoughtTrailUnavailableReason === null;
        const scopedFileSummary = summarizeThoughtTrailPaths(scopedFilePaths);
        void this.plugin.logEvent("info", "thoughttrail", "thoughttrail.note.render-check", {
            filePath: file.path,
            isEnabled: isThoughtTrailEnabled,
            unavailableReason: thoughtTrailUnavailableReason,
            showResolved,
            showDeleted: options.showDeleted,
            indexedThreadCount: this.plugin.getAllIndexedThreads().length,
            currentFileThreadCount: persistedThreads.length,
            scopedThreadCount: scopedThreads.length,
            lineCount: thoughtTrailLineCount,
            scopedFileCount: scopedFileSummary.count,
            scopedFileSample: scopedFileSummary.sample,
            scopedFileOmittedCount: scopedFileSummary.omittedCount,
        });
        if (!isThoughtTrailEnabled) {
            this.noteSidebarMode = "list";
            void this.plugin.logEvent("warn", "thoughttrail", "thoughttrail.note.fallback", {
                filePath: file.path,
                reason: thoughtTrailUnavailableReason,
                source: "render-check",
                lineCount: thoughtTrailLineCount,
                scopedFileCount: scopedFileSummary.count,
                scopedThreadCount: scopedThreads.length,
            });
            await this.renderPageSidebar(file, renderVersion);
            return;
        }

        shell.toolbarSlotEl.empty();
        this.renderSidebarToolbar(shell.toolbarSlotEl, {
            isAllCommentsView: false,
            resolvedCount: persistedThreads.filter((thread) => thread.resolved).length,
            hasResolvedComments: hasResolvedThreadsInFile,
            hasDeletedComments: pageThreadsWithDeleted.some((thread) => hasDeletedComments(thread)),
            deletedCommentCount,
            showDeletedComments: options.showDeleted,
            hasNestedComments: false,
            isAgentMode: false,
            agentOutcomeCounts: {
                succeeded: 0,
                failed: 0,
            },
            isTagsEnabled: true,
            isThoughtTrailEnabled,
            noteSidebarContentFilter: this.noteSidebarContentFilter,
            noteSidebarMode: this.noteSidebarMode,
            addPageCommentAction: {
                icon: "plus",
                ariaLabel: "Add page note",
                onClick: () => {
                    void this.plugin.startPageCommentDraft(file);
                },
            },
            indexFileFilterOptions: [],
            selectedIndexFileFilterRootPath: null,
            filteredIndexFilePaths: [],
        });

        shell.commentsBodyEl.empty();
        this.resetStreamedReplyControllers();
        void this.plugin.logEvent("info", "thoughttrail", "thoughttrail.note.render", {
            filePath: file.path,
            trailThreadCount: scopedThreads.length,
            lineCount: thoughtTrailLineCount,
            scopedFileCount: scopedFileSummary.count,
            scopedFileSample: scopedFileSummary.sample,
        });
        await this.renderThoughtTrail(shell.commentsBodyEl, scopedThreads, file, {
            surface: "note",
            hasRootScope: scopedFilePaths.length > 0,
            rootFilePath: file.path,
        });

        shell.supportSlotEl.empty();
        if (this.plugin.isLocalRuntime()) {
            renderSupportButtonIn(shell.supportSlotEl, this.plugin, {
                filePath: file.path,
                isAllCommentsView: false,
                threadCount: this.plugin.getThreadsForFile(file.path).length,
            });
        }
    }

    private buildNoteThoughtTrailScope(
        file: TFile,
        showResolved: boolean,
    ): {
        scopedFilePaths: string[];
        scopedThreads: CommentThread[];
    } {
        const hasExistingSourceFile = (filePath: string): boolean => {
            const sourceFile = this.app.vault.getAbstractFileByPath(filePath);
            return sourceFile instanceof TFile;
        };
        const visibleTrailThreads = filterIndexThreadsByExistingSourceFiles(
            this.plugin.getAllIndexedThreads(),
            hasExistingSourceFile,
        ).filter((thread) => matchesResolvedVisibility(thread.resolved, showResolved));

        return buildRootedThoughtTrailScope(visibleTrailThreads, {
            rootFilePath: file.path,
            allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
            resolveWikiLinkPath: (linkPath, sourceFilePath) => this.resolveThoughtTrailWikiLinkPath(linkPath, sourceFilePath),
        });
    }

    private buildNoteThoughtTrailAvailabilityFromLoadedThreads(
        file: TFile,
        currentFileThreads: CommentThread[],
    ): {
        currentVisibleThreadCount: number;
        indexedThreadCount: number;
        mergedThreadCount: number;
        scopedFilePaths: string[];
        scopedThreads: CommentThread[];
        lineCount: number;
        unavailableReason: "no-root-scope" | "no-renderable-lines" | null;
        isEnabled: boolean;
    } {
        const indexedThreads = this.plugin.getAllIndexedThreads();
        const mergedThreads = mergeCurrentFileThreadsForThoughtTrail(
            indexedThreads,
            file.path,
            currentFileThreads,
        );
        const scope = buildRootedThoughtTrailScope(mergedThreads, {
            rootFilePath: file.path,
            allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
            resolveWikiLinkPath: (linkPath, sourceFilePath) => this.resolveThoughtTrailWikiLinkPath(linkPath, sourceFilePath),
        });
        const lineCount = buildThoughtTrailLines(this.app.vault.getName(), scope.scopedThreads, {
            allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
            resolveWikiLinkPath: (linkPath, sourceFilePath) => this.resolveThoughtTrailWikiLinkPath(linkPath, sourceFilePath),
        }).length;
        const unavailableReason = getThoughtTrailUnavailableReason(scope.scopedFilePaths.length > 0, lineCount);

        return {
            currentVisibleThreadCount: currentFileThreads.length,
            indexedThreadCount: indexedThreads.length,
            mergedThreadCount: mergedThreads.length,
            scopedFilePaths: scope.scopedFilePaths,
            scopedThreads: scope.scopedThreads,
            lineCount,
            unavailableReason,
            isEnabled: unavailableReason === null,
        };
    }

    private resolveThoughtTrailWikiLinkPath(linkPath: string, sourceFilePath: string): string | null {
        const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
        return linkedFile instanceof TFile ? linkedFile.path : null;
    }

    private ensureNoteSidebarShell(filePath: string): NoteSidebarShell {
        if (
            this.noteSidebarShell?.filePath === filePath
            && this.noteSidebarShell.commentsContainerEl.isConnected
            && this.noteSidebarShell.supportSlotEl.isConnected
        ) {
            this.syncViewContainerClasses();
            return this.noteSidebarShell;
        }

        this.noteSidebarShell = null;
        this.resetStreamedReplyControllers();
        this.containerEl.empty();
        this.syncViewContainerClasses();

        const commentsContainerEl = this.containerEl.createDiv("aside-comments-container is-note-sidebar");
        const toolbarSlotEl = commentsContainerEl.createDiv("aside-note-sidebar-toolbar-slot");
        const commentsBodyEl = this.renderCommentsList(commentsContainerEl);
        this.setupPageThreadReorderInteractions(commentsBodyEl, filePath);
        const supportSlotEl = this.containerEl.createDiv("aside-support-button-slot");

        this.noteSidebarShell = {
            filePath,
            commentsContainerEl,
            toolbarSlotEl,
            commentsBodyEl,
            supportSlotEl,
        };
        return this.noteSidebarShell;
    }

    private buildNoteSidebarRenderDescriptors(
        renderableItems: SidebarRenderableItem[],
        options: {
            allAgentRuns: AgentRunRecord[];
            enablePageThreadReorder: boolean;
            nestedEditDraftThreadId: string | null;
            nestedAppendDraftThreadId: string | null;
            visibleDraftComment: DraftComment | null;
            enableTagSelection: boolean;
        },
    ): NoteSidebarRenderDescriptor[] {
        return renderableItems.map((item) => {
            if (item.kind === "draft") {
                return {
                    key: `draft:${item.draft.id}`,
                    signature: buildPageSidebarDraftRenderSignature(
                        item.draft,
                        this.interactionController.getActiveCommentId(),
                    ),
                    threadId: null,
                    render: () => {
                        const stagingEl = this.containerEl.ownerDocument.createElement("div");
                        this.renderDraftComment(stagingEl, item.draft);
                        const nextNode = stagingEl.firstElementChild;
                        if (!nodeInstanceOf(nextNode, HTMLElement)) {
                            throw new Error("Failed to render sidebar draft card.");
                        }
                        return Promise.resolve(nextNode);
                    },
                };
            }

            const appendDraftComment = options.nestedAppendDraftThreadId === item.thread.id && options.visibleDraftComment?.mode === "append"
                ? options.visibleDraftComment
                : null;
            const editDraftComment = options.nestedEditDraftThreadId === item.thread.id && options.visibleDraftComment?.mode === "edit"
                ? options.visibleDraftComment
                : null;
            const threadAgentRuns = getAgentRunsForCommentThread(options.allAgentRuns, item.thread);
            const showNestedComments = this.plugin.shouldShowNestedCommentsForThread(item.thread.id);
            return {
                key: `thread:${item.thread.id}`,
                signature: buildPageSidebarThreadRenderSignature({
                    thread: item.thread,
                    activeCommentId: this.interactionController.getActiveCommentId(),
                    isPinned: this.isPinnedSidebarThread(item.thread.id),
                    showNestedComments,
                    showNestedCommentsByDefault: this.plugin.shouldShowNestedComments(),
                    isSelectedForTagBatch: options.enableTagSelection && this.noteSidebarSelectedTagIds.has(item.thread.id),
                    enablePageThreadReorder: options.enablePageThreadReorder,
                    enableTagSelection: options.enableTagSelection,
                    editDraftComment,
                    appendDraftComment,
                    threadAgentRuns,
                }),
                threadId: item.thread.id,
                render: async () => {
                    const stagingEl = this.containerEl.ownerDocument.createElement("div");
                    await this.renderPersistedComment(
                        stagingEl,
                        item.thread,
                        options.enablePageThreadReorder,
                        threadAgentRuns[0] ?? null,
                        this.plugin.getActiveAgentStreamForThread(item.thread.id),
                        threadAgentRuns,
                        editDraftComment,
                        appendDraftComment,
                    );
                    const nextNode = stagingEl.firstElementChild;
                    if (!nodeInstanceOf(nextNode, HTMLElement)) {
                        throw new Error("Failed to render sidebar thread card.");
                    }
                    if (!options.enableTagSelection) {
                        return nextNode;
                    }

                    const wrapper = stagingEl.createDiv("aside-comment-thread-select-wrapper");
                    const checkRow = wrapper.createEl("label", {
                        cls: "aside-comment-thread-select-row",
                    });
                    const checkbox = checkRow.createEl("input", {
                        type: "checkbox",
                    });
                    checkbox.checked = this.noteSidebarSelectedTagIds.has(item.thread.id);
                    checkbox.addEventListener("change", (event: Event) => {
                        event.stopPropagation();
                        this.toggleNoteSidebarTagSelection(item.thread.id, checkbox.checked);
                    });
                    checkbox.addEventListener("click", (event: MouseEvent) => {
                        event.stopPropagation();
                    });
                    wrapper.append(nextNode);
                    return wrapper;
                },
            };
        });
    }

    private toggleNoteSidebarTagSelection(threadId: string, isSelected: boolean): void {
        const nextSelection = new Set(this.noteSidebarSelectedTagIds);
        if (isSelected) {
            nextSelection.add(threadId);
        } else {
            nextSelection.delete(threadId);
        }

        this.updateNoteSidebarTagSelection(nextSelection);
        void this.renderComments({
            skipDataRefresh: true,
        });
    }

    private updateNoteSidebarTagSelection(nextSelection: Set<string>): void {
        this.noteSidebarSelectedTagIds = nextSelection;
        if (nextSelection.size === 0) {
            this.clearNoteSidebarBatchTagFlowPanel();
            return;
        }

        this.noteSidebarBatchTagFlow = {
            ...this.noteSidebarBatchTagFlow,
            isOpen: true,
            failures: [],
        };
    }

    private toggleVisibleTagBatchThreadSelection(): void {
        const visibleThreadIds = this.getNoteSidebarTagBatchVisibleThreadIds();
        if (visibleThreadIds.length === 0) {
            return;
        }

        const areAllVisibleThreadsSelected = visibleThreadIds.every((threadId) => this.noteSidebarSelectedTagIds.has(threadId));
        const nextSelection = new Set(this.noteSidebarSelectedTagIds);

        if (areAllVisibleThreadsSelected) {
            for (const threadId of visibleThreadIds) {
                nextSelection.delete(threadId);
            }
        } else {
            for (const threadId of visibleThreadIds) {
                nextSelection.add(threadId);
            }
        }

        this.updateNoteSidebarTagSelection(nextSelection);
        void this.renderComments({
            skipDataRefresh: true,
        });
    }

    private getNoteSidebarTagBatchVisibleThreadIds(): string[] {
        const filePath = this.file?.path ?? null;
        if (!filePath || this.noteSidebarMode !== "tags") {
            return [];
        }

        const persistedThreads = this.plugin.getThreadsForFile(filePath, {
            includeDeleted: this.plugin.shouldShowDeletedComments(),
        });
        const showResolved = this.plugin.shouldShowResolvedComments();
        const contentFilteredThreads = this.filterNoteSidebarThreadsByContentFilter(filePath, persistedThreads);
        const pinnedContentFilteredThreads = filterThreadsByPinnedSidebarViewState(
            contentFilteredThreads,
            this.pinnedSidebarThreadIds,
            this.showPinnedSidebarThreadsOnly,
        );
        const tagModeThreads = this.noteSidebarVisibleTagFilterKey
            ? pinnedContentFilteredThreads.filter((thread) =>
                this.noteSidebarTagIndex?.threadIdsByTag.get(this.noteSidebarVisibleTagFilterKey ?? "")?.has(thread.id) ?? false,
            )
            : pinnedContentFilteredThreads;
        const searchMatchedThreads = rankThreadsBySidebarSearchQuery(
            tagModeThreads,
            this.noteSidebarSearchQuery,
        );
        return searchMatchedThreads
            .filter((thread) => matchesPageSidebarVisibility(thread, {
                showResolved,
                showDeleted: this.plugin.shouldShowDeletedComments(),
            }))
            .map((thread) => thread.id);
    }

    private clearNoteSidebarBatchTagPanelAndQuery(): void {
        this.clearNoteSidebarBatchTagSearchDebounceTimer();
        this.noteSidebarBatchTagSearchRequestVersion += 1;
        this.noteSidebarBatchTagFlow = {
            ...DEFAULT_BATCH_TAG_FLOW_STATE,
            candidateTagTexts: [],
            failures: [],
        };
    }

    private closeNoteSidebarBatchTagFlow(): void {
        this.clearNoteSidebarBatchTagSearchDebounceTimer();
        this.noteSidebarBatchTagSearchRequestVersion += 1;
        this.noteSidebarBatchTagFlow = {
            ...this.noteSidebarBatchTagFlow,
            isOpen: false,
            failures: [],
        };
    }

    private async selectOrCreateBatchTag(): Promise<void> {
        const filePath = this.file?.path ?? null;
        if (!filePath || this.plugin.isAllCommentsNotePath(filePath)) {
            return;
        }
        if (this.noteSidebarBatchTagFlow.isApplying || this.noteSidebarSelectedTagIds.size === 0) {
            return;
        }
        const selectedTagText = this.getNoteSidebarBatchTagText();
        const normalizedTagText = selectedTagText ? normalizeTagText(selectedTagText) : "";
        if (!normalizedTagText) {
            new Notice("Enter a valid tag before applying.");
            return;
        }
        const normalizedTagKey = normalizedTagText.slice(1).toLowerCase();
        this.noteSidebarBatchTagFlow = {
            ...this.noteSidebarBatchTagFlow,
            isApplying: true,
            failures: [],
        };
        this.refreshNoteSidebarTagBatchPanel();
        const selectedThreadIds = Array.from(this.noteSidebarSelectedTagIds);

        try {
            const result = await persistBatchTagMutation({
                filePath,
                selectedThreadIds,
                manager: this.plugin.getCommentManager(),
                mutate: () => applyBatchTagToThreads({
                    filePath,
                    selectedThreadIds,
                    getThreadById: (threadId) => this.plugin.getThreadById(threadId) ?? undefined,
                    editComment: (commentId, nextBody) => {
                        this.plugin.getCommentManager().editComment(commentId, nextBody);
                    },
                    normalizedTagText,
                }),
                persist: async () => {
                    if (this.file) {
                        await this.plugin.persistCommentsForFile(this.file, { immediateAggregateRefresh: true });
                    }
                },
            });

            this.noteSidebarBatchTagFlow = {
                ...this.noteSidebarBatchTagFlow,
                failures: result.failures,
                selectedTagText: normalizedTagText,
                selectedTagKey: result.persistError === null && this.getBatchTagFlowHasExactMatch(normalizedTagKey)
                    ? normalizedTagKey
                    : null,
                query: normalizedTagText,
                candidateTagTexts: this.getNoteSidebarTagCandidateTexts(normalizedTagText),
                isOpen: true,
            };
            if (result.failures.length === 0) {
                this.noteSidebarSelectedTagIds.clear();
            } else {
                this.noteSidebarSelectedTagIds = new Set(result.failedIds);
            }

            await this.renderComments({ skipDataRefresh: true });

            if (result.persistError !== null) {
                void new Notice("Failed to save tag changes. Your comments were restored.");
                return;
            }

            void new Notice(
                result.failures.length === 0
                    ? `Applied ${normalizedTagText} to ${result.successfulIds.length} thread${result.successfulIds.length === 1 ? "" : "s"}.`
                    : `Applied ${normalizedTagText} to ${result.successfulIds.length} thread${result.successfulIds.length === 1 ? "" : "s"} with ${result.failures.length} failure${result.failures.length === 1 ? "" : "s"}.`,
            );
        } finally {
            this.noteSidebarBatchTagFlow = {
                ...this.noteSidebarBatchTagFlow,
                isApplying: false,
            };
            if (this.noteSidebarSelectedTagIds.size === 0) {
                this.clearNoteSidebarBatchTagFlowPanel();
            } else {
                this.clearNoteSidebarBatchTagSearchInput();
            }
            this.refreshNoteSidebarTagBatchPanel();
        }
    }

    private async removeBatchTagFromSelectedThreads(): Promise<void> {
        const filePath = this.file?.path ?? null;
        if (!filePath || this.plugin.isAllCommentsNotePath(filePath)) {
            return;
        }
        if (this.noteSidebarBatchTagFlow.isApplying || this.noteSidebarSelectedTagIds.size === 0) {
            return;
        }

        const selectedTagText = this.getBatchTagActionTagText();
        const normalizedTagText = selectedTagText ? normalizeTagText(selectedTagText) : "";
        if (!normalizedTagText) {
            return;
        }
        const normalizedTagKey = normalizedTagText.slice(1).toLowerCase();

        this.noteSidebarBatchTagFlow = {
            ...this.noteSidebarBatchTagFlow,
            isApplying: true,
            failures: [],
        };
        this.refreshNoteSidebarTagBatchPanel();
        const selectedThreadIds = Array.from(this.noteSidebarSelectedTagIds);
        const targetTagTextForNotice = selectedTagText ?? "selected tag";
        try {
            const result = await persistBatchTagMutation({
                filePath,
                selectedThreadIds,
                manager: this.plugin.getCommentManager(),
                mutate: () => removeBatchTagFromThreads({
                    filePath,
                    selectedThreadIds,
                    getThreadById: (threadId) => this.plugin.getThreadById(threadId) ?? undefined,
                    editComment: (commentId, nextBody) => {
                        this.plugin.getCommentManager().editComment(commentId, nextBody);
                    },
                    normalizedTagText,
                    targetTagTextForNotice,
                }),
                persist: async () => {
                    if (this.file) {
                        await this.plugin.persistCommentsForFile(this.file, { immediateAggregateRefresh: true });
                    }
                },
            });

            this.noteSidebarBatchTagFlow = {
                ...this.noteSidebarBatchTagFlow,
                failures: result.failures,
                selectedTagText: normalizedTagText,
                selectedTagKey: result.persistError === null && this.getBatchTagFlowHasExactMatch(normalizedTagKey)
                    ? normalizedTagKey
                    : null,
                query: this.noteSidebarBatchTagFlow.query,
                candidateTagTexts: this.getNoteSidebarTagCandidateTexts(normalizedTagText),
                isOpen: true,
            };

            if (result.failures.length === 0) {
                this.noteSidebarSelectedTagIds.clear();
            } else {
                this.noteSidebarSelectedTagIds = new Set(result.failedIds);
            }

            await this.renderComments({
                skipDataRefresh: true,
            });

            if (result.persistError !== null) {
                void new Notice("Failed to save tag changes. Your comments were restored.");
                return;
            }

            void new Notice(
                result.failures.length === 0
                    ? `Removed ${normalizedTagText} from ${result.successfulIds.length} thread${result.successfulIds.length === 1 ? "" : "s"}.`
                    : `Removed ${normalizedTagText} from ${result.successfulIds.length} thread${result.successfulIds.length === 1 ? "" : "s"} with ${result.failures.length} failure${result.failures.length === 1 ? "" : "s"}.`,
            );
        } finally {
            this.noteSidebarBatchTagFlow = {
                ...this.noteSidebarBatchTagFlow,
                isApplying: false,
            };
            if (this.noteSidebarSelectedTagIds.size === 0) {
                this.clearNoteSidebarBatchTagFlowPanel();
            } else {
                this.clearNoteSidebarBatchTagSearchInput();
            }
            this.refreshNoteSidebarTagBatchPanel();
        }
    }


    private async reconcileNoteSidebarItems(
        commentsBody: HTMLDivElement,
        descriptors: readonly NoteSidebarRenderDescriptor[],
    ): Promise<void> {
        const existingByKey = new Map<string, HTMLElement>();
        for (const child of Array.from(commentsBody.children)) {
            if (!nodeInstanceOf(child, HTMLElement)) {
                continue;
            }

            const key = child.dataset.asideRenderKey;
            if (key) {
                existingByKey.set(key, child);
                continue;
            }

            if (child.classList.contains("aside-empty-state")) {
                child.remove();
            }
        }

        const desiredNodes: HTMLElement[] = [];
        for (const descriptor of descriptors) {
            const existing = existingByKey.get(descriptor.key) ?? null;
            existingByKey.delete(descriptor.key);
            if (existing && existing.dataset.asideRenderSignature === descriptor.signature) {
                desiredNodes.push(existing);
                continue;
            }

            if (descriptor.threadId) {
                this.removeStreamedReplyController(descriptor.threadId);
            }

            const nextNode = await descriptor.render();
            nextNode.dataset.asideRenderKey = descriptor.key;
            nextNode.dataset.asideRenderSignature = descriptor.signature;
            desiredNodes.push(nextNode);
        }

        for (const [key, element] of existingByKey) {
            if (key.startsWith("thread:")) {
                this.removeStreamedReplyController(key.slice("thread:".length));
            }
            element.remove();
        }

        desiredNodes.forEach((node, index) => {
            const currentNode = commentsBody.children.item(index);
            if (currentNode === node) {
                return;
            }

            commentsBody.insertBefore(node, currentNode ?? null);
        });

        const desiredNodeSet = new Set(desiredNodes);
        for (const child of Array.from(commentsBody.children)) {
            if (nodeInstanceOf(child, HTMLElement) && !desiredNodeSet.has(child)) {
                child.remove();
            }
        }
    }

    private renderPageSidebarEmptyState(
        commentsBody: HTMLDivElement,
        options: {
            renderedItemCount: number;
            showResolved: boolean;
            totalScopedCount: number;
            hasResolvedComments: boolean;
            contentFilter: SidebarContentFilter;
            showPinnedThreadsOnly: boolean;
            searchQuery: string;
            noteSidebarMode: SidebarPrimaryMode;
            visibleTagFilterKey: string | null;
            hasAnyTags: boolean;
        },
    ): void {
        for (const child of Array.from(commentsBody.children)) {
            if (nodeInstanceOf(child, HTMLDivElement) && child.classList.contains("aside-empty-state")) {
                child.remove();
            }
        }

        if (options.renderedItemCount !== 0) {
            return;
        }

        const filterLabel = options.showPinnedThreadsOnly
            ? options.contentFilter === "all"
                ? "pin filter"
                : `pin + ${this.getNoteSidebarContentFilterLabel(options.contentFilter)}`
            : this.getNoteSidebarContentFilterLabel(options.contentFilter);
        const pluralFilterLabel = options.showPinnedThreadsOnly
            ? options.contentFilter === "all"
                ? "pinned comments"
                : `pinned ${this.getNoteSidebarContentFilterPluralLabel(options.contentFilter)}`
            : this.getNoteSidebarContentFilterPluralLabel(options.contentFilter);
        const trimmedSearchQuery = options.searchQuery.trim();
        const hasSearchQuery = trimmedSearchQuery.length > 0;
        const searchSubjectLabel = options.showPinnedThreadsOnly
            ? options.contentFilter === "all"
                ? "pinned side notes"
                : pluralFilterLabel
            : options.contentFilter === "all"
                ? "side notes"
                : pluralFilterLabel;
        const selectedTagLabel = options.noteSidebarMode === "tags" && options.visibleTagFilterKey
            ? this.getTagDisplayForKey(options.visibleTagFilterKey) ?? `#${options.visibleTagFilterKey}`
            : null;

        if (options.noteSidebarMode === "tags" && !options.hasAnyTags) {
            const emptyStateEl = commentsBody.createDiv("aside-empty-state aside-section-empty-state");
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? `No tags match "${trimmedSearchQuery}" in this file.`
                    : "No tags exist in this file yet.",
            });
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? "Try a different search term."
                    : "Add tags in side note content to use local tag filtering.",
            });
            return;
        }

        if (options.noteSidebarMode === "tags" && options.visibleTagFilterKey && selectedTagLabel) {
            const emptyStateEl = commentsBody.createDiv("aside-empty-state aside-section-empty-state");
            const tagSubjectLabel = options.showResolved
                ? `resolved ${searchSubjectLabel}`
                : searchSubjectLabel;
            const baseLabel = hasSearchQuery
                ? `No ${tagSubjectLabel} tagged with ${selectedTagLabel} match "${trimmedSearchQuery}" in this file.`
                : `No ${tagSubjectLabel} tagged with ${selectedTagLabel} in this file.`;
            const suggestion = hasSearchQuery
                ? "Clear search or choose a different tag."
                : "Choose a different tag or clear the tag filter.";

            emptyStateEl.createEl("p", {
                text: baseLabel,
            });
            emptyStateEl.createEl("p", {
                text: suggestion,
            });
            return;
        }

        if (options.showResolved && options.totalScopedCount > 0) {
            const emptyStateEl = commentsBody.createDiv("aside-empty-state aside-section-empty-state");
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? `No resolved ${searchSubjectLabel} match "${trimmedSearchQuery}" in this file.`
                    : options.showPinnedThreadsOnly
                        ? `No resolved ${pluralFilterLabel} for this file.`
                        : options.contentFilter === "all"
                        ? "No resolved comments for this file."
                        : `No resolved ${pluralFilterLabel} for this file.`,
            });
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? "Turn off resolved or clear search to broaden the results."
                    : options.showPinnedThreadsOnly
                        ? `Turn off ${filterLabel} to return to the broader side note list.`
                        : options.contentFilter === "all"
                        ? "Turn off resolved to return to active comments."
                        : `Turn off resolved to return to active ${pluralFilterLabel}.`,
            });
            return;
        }

        if (!options.showResolved && options.hasResolvedComments) {
            const emptyStateEl = commentsBody.createDiv("aside-empty-state aside-section-empty-state");
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? `No active ${searchSubjectLabel} match "${trimmedSearchQuery}" in this file.`
                    : options.showPinnedThreadsOnly
                        ? `No active ${pluralFilterLabel} for this file.`
                        : options.contentFilter === "all"
                        ? "No active comments for this file."
                        : `No active ${pluralFilterLabel} for this file.`,
            });
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? "Turn on resolved or clear search to broaden the results."
                    : options.showPinnedThreadsOnly
                        ? "Turn on resolved to review archived pinned comments only."
                        : options.contentFilter === "all"
                        ? "Turn on resolved to review archived comments only."
                        : `Turn on resolved to review archived ${pluralFilterLabel} only.`,
            });
            return;
        }

        const emptyStateEl = commentsBody.createDiv("aside-empty-state");
        emptyStateEl.createEl("p", {
            text: hasSearchQuery
                ? `No ${searchSubjectLabel} match "${trimmedSearchQuery}" in this file.`
                : options.showPinnedThreadsOnly
                    ? `No ${pluralFilterLabel} for this file yet.`
                    : options.contentFilter === "all"
                    ? "No comments for this file yet."
                    : `No ${pluralFilterLabel} for this file yet.`,
        });
        emptyStateEl.createEl("p", {
            text: hasSearchQuery
                ? "Clear search or try different words."
                : options.showPinnedThreadsOnly
                    ? "Pin one or more side notes, or turn off the pin filter."
                    : options.contentFilter === "all"
                    ? NOTE_SIDEBAR_EMPTY_CREATE_HINT_TEXT
                    : `Turn off ${filterLabel} to return to all side notes.`,
        });
    }

    private renderIndexSidebarEmptyState(
        commentsBody: HTMLDivElement,
        options: {
            renderedItemCount: number;
            showResolved: boolean;
            totalScopedCount: number;
            resolvedCount: number;
            filteredIndexFilePaths: readonly string[];
            searchQuery: string;
        },
    ): void {
        for (const child of Array.from(commentsBody.children)) {
            if (nodeInstanceOf(child, HTMLDivElement) && child.classList.contains("aside-empty-state")) {
                child.remove();
            }
        }

        if (options.renderedItemCount !== 0) {
            return;
        }

        const trimmedSearchQuery = options.searchQuery.trim();
        const hasSearchQuery = trimmedSearchQuery.length > 0;
        const hasFileFilter = options.filteredIndexFilePaths.length > 0;
        const scopeLabel = hasFileFilter ? "the selected file filter" : "the current index view";
        const showResolvedEmptyState = shouldShowResolvedIndexEmptyState(
            options.showResolved,
            options.totalScopedCount,
            options.renderedItemCount,
        );
        const showActiveEmptyState = shouldShowActiveIndexEmptyState(
            options.showResolved,
            options.resolvedCount,
            options.renderedItemCount,
        );
        if (
            !showResolvedEmptyState
            && !showActiveEmptyState
            && !shouldShowGenericIndexEmptyState({
                hasFileFilter,
                hasSearchQuery,
                renderedItemCount: options.renderedItemCount,
            })
        ) {
            return;
        }
        const emptyStateEl = commentsBody.createDiv("aside-empty-state aside-section-empty-state");

        if (showResolvedEmptyState) {
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? `No resolved side notes match "${trimmedSearchQuery}" in ${scopeLabel}.`
                    : hasFileFilter
                        ? "No resolved side notes match the selected file filter."
                        : "No resolved side notes match the current index view.",
            });
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? hasFileFilter
                        ? "Turn off resolved, clear search, or choose a different root file."
                        : "Turn off resolved or clear search to broaden the index results."
                    : hasFileFilter
                        ? "Turn off resolved or choose a different root file."
                        : "Turn off resolved to return to active side notes.",
            });
            return;
        }

        if (showActiveEmptyState) {
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? `No active side notes match "${trimmedSearchQuery}" in ${scopeLabel}.`
                    : hasFileFilter
                        ? "No active side notes match the selected file filter."
                        : "No active side notes match the current index view.",
            });
            emptyStateEl.createEl("p", {
                text: hasSearchQuery
                    ? hasFileFilter
                        ? "Turn on resolved, clear search, or choose a different root file."
                        : "Turn on resolved or clear search to broaden the index results."
                    : hasFileFilter
                        ? "Turn on resolved or choose a different root file."
                        : "Turn on resolved to review archived side notes only.",
            });
            return;
        }

        if (hasSearchQuery) {
            emptyStateEl.createEl("p", {
                text: `No side notes match "${trimmedSearchQuery}" in ${scopeLabel}.`,
            });
            emptyStateEl.createEl("p", {
                text: hasFileFilter
                    ? "Clear search or choose a different root file."
                    : "Clear search or try different words.",
            });
            return;
        }

        for (const text of GENERIC_INDEX_EMPTY_STATE_TEXTS) {
            emptyStateEl.createEl("p", { text });
        }
    }

    private getNoteSidebarContentFilterLabel(filter: SidebarContentFilter): string {
        switch (filter) {
            case "agents":
                return "agent filter";
            case "all":
            default:
                return "all side notes";
        }
    }

    private getNoteSidebarContentFilterPluralLabel(filter: SidebarContentFilter): string {
        switch (filter) {
            case "agents":
                return "agent comments";
            case "all":
            default:
                return "comments";
        }
    }

    private handleAgentStreamUpdate(update: AgentStreamUpdate): void {
        if (!update.stream) {
            this.removeStreamedReplyController(update.threadId);
            return;
        }

        const threadEl = this.containerEl.querySelector(`.aside-thread-stack[data-thread-id="${update.threadId}"]`);
        if (!nodeInstanceOf(threadEl, HTMLDivElement)) {
            return;
        }

        this.getOrCreateStreamedReplyController(update.threadId).sync(this.containerEl, update.stream);
    }

    private syncVisibleStreamedReplyControllers(): void {
        const visibleThreadIds = new Set<string>();
        const threadEls = Array.from(this.containerEl.querySelectorAll(".aside-thread-stack[data-thread-id]"));
        for (const threadEl of threadEls) {
            if (!nodeInstanceOf(threadEl, HTMLDivElement)) {
                continue;
            }
            const threadId = threadEl.getAttribute("data-thread-id");
            if (!threadId) {
                continue;
            }

            visibleThreadIds.add(threadId);
            const stream = this.plugin.getActiveAgentStreamForThread(threadId);
            if (!stream) {
                this.removeStreamedReplyController(threadId);
                continue;
            }
            this.getOrCreateStreamedReplyController(threadId).sync(this.containerEl, stream);
        }

        for (const [threadId] of this.streamedReplyControllers) {
            if (!visibleThreadIds.has(threadId)) {
                this.removeStreamedReplyController(threadId);
            }
        }
    }

    private getOrCreateStreamedReplyController(threadId: string): StreamedAgentReplyController {
        let controller = this.streamedReplyControllers.get(threadId);
        if (!controller) {
            controller = new StreamedAgentReplyController(threadId, {
                onCancelRun: (runId) => {
                    void this.plugin.cancelAgentRun(runId);
                },
            });
            this.streamedReplyControllers.set(threadId, controller);
        }

        return controller;
    }

    private removeStreamedReplyController(threadId: string): void {
        const controller = this.streamedReplyControllers.get(threadId);
        if (!controller) {
            return;
        }

        controller.clear();
        this.streamedReplyControllers.delete(threadId);
    }

    private normalizeNoteSidebarContentFilter(): void {
        if (this.noteSidebarContentFilter === "agents") {
            this.noteSidebarContentFilter = "all";
        }
    }

    private filterNoteSidebarThreadsByContentFilter(
        _filePath: string,
        threads: readonly CommentThread[],
    ): CommentThread[] {
        return filterThreadsBySidebarContentFilter(threads, this.noteSidebarContentFilter);
    }

    private async toggleDeletedSidebarMode(options: {
        showDeleted: boolean;
        showResolved: boolean;
        contentFilter: SidebarContentFilter;
    }): Promise<void> {
        const nextState = toggleDeletedSidebarViewState({
            showDeleted: options.showDeleted,
            showResolved: options.showResolved,
            contentFilter: options.contentFilter,
            showPinnedThreadsOnly: this.showPinnedSidebarThreadsOnly,
            pinnedThreadIds: this.pinnedSidebarThreadIds,
            searchQuery: this.noteSidebarSearchQuery,
            searchInputValue: this.noteSidebarSearchInputValue,
        });
        this.noteSidebarContentFilter = nextState.contentFilter;
        this.showPinnedSidebarThreadsOnly = nextState.showPinnedThreadsOnly;
        this.pinnedSidebarThreadIds = nextState.pinnedThreadIds;
        this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
        this.clearNoteSidebarSearchDebounceTimer();
        this.noteSidebarSearchQuery = nextState.searchQuery;
        this.noteSidebarSearchInputValue = nextState.searchInputValue;
        if (nextState.showResolved !== options.showResolved) {
            await this.plugin.setShowResolvedComments(nextState.showResolved);
        }
        if (nextState.showDeleted !== options.showDeleted) {
            await this.plugin.setShowDeletedComments(nextState.showDeleted);
        }
    }

    private resetStreamedReplyControllers(): void {
        for (const controller of this.streamedReplyControllers.values()) {
            controller.clear();
        }
        this.streamedReplyControllers.clear();
    }

    private renderSidebarToolbar(
        container: HTMLElement,
        options: {
            isAllCommentsView: boolean;
            resolvedCount: number;
            hasResolvedComments: boolean;
            hasDeletedComments: boolean;
            deletedCommentCount: number;
            showDeletedComments: boolean;
            hasNestedComments: boolean;
            isAgentMode: boolean;
            agentOutcomeCounts: {
                succeeded: number;
                failed: number;
            };
            isTagsEnabled: boolean;
            isThoughtTrailEnabled: boolean;
            noteSidebarContentFilter: SidebarContentFilter;
            noteSidebarMode: SidebarPrimaryMode;
            addPageCommentAction: {
                icon: string;
                ariaLabel: string;
                onClick: () => void;
            } | null;
            indexFileFilterOptions: IndexFileFilterOption[];
            selectedIndexFileFilterRootPath: string | null;
            filteredIndexFilePaths: string[];
        },
    ) {
        const showResolved = this.plugin.shouldShowResolvedComments();
        const showNestedComments = this.plugin.shouldShowNestedComments();
        const showDeletedComments = options.showDeletedComments;
        const showPinnedThreadsOnly = this.showPinnedSidebarThreadsOnly;
        const hasPinnedThreads = this.pinnedSidebarThreadIds.size > 0;
        const activePrimaryMode = options.isAllCommentsView
            ? this.indexSidebarMode
            : options.noteSidebarMode;
        const showListOrTagToolbarChips = options.isAllCommentsView
            ? shouldShowIndexListToolbarChips(options.isAllCommentsView, this.indexSidebarMode)
            : activePrimaryMode === "list" || activePrimaryMode === "tags";
        const shouldShowNoteSearchInput = !options.isAllCommentsView
            && (activePrimaryMode === "list" || activePrimaryMode === "tags");
        const shouldShowAddPageCommentAction = !!options.addPageCommentAction
            && (options.isAllCommentsView || activePrimaryMode === "list" || activePrimaryMode === "tags");
        const shouldShowResolvedChip = showListOrTagToolbarChips
            && !options.isAgentMode
            && shouldShowResolvedToolbarChip(options.hasResolvedComments, showResolved);
        const shouldShowNestedChip = showListOrTagToolbarChips && shouldShowNestedToolbarChip({
            hasNestedComments: options.hasNestedComments,
            isAllCommentsView: options.isAllCommentsView,
            selectedIndexFileFilterRootPath: options.selectedIndexFileFilterRootPath,
            filteredIndexFileCount: options.filteredIndexFilePaths.length,
        });
        const isDeletedToolbarMode = !options.isAllCommentsView
            && showListOrTagToolbarChips
            && showDeletedComments;
        const shouldRenderToolbar = options.isAllCommentsView
            || (!options.isAllCommentsView && options.noteSidebarMode === "thought-trail")
            || shouldShowResolvedChip
            || shouldShowNestedChip
            || shouldShowAddPageCommentAction
            || options.noteSidebarMode === "tags";
        if (!shouldRenderToolbar) {
            return;
        }

        const toolbarEl = container.createDiv("aside-sidebar-toolbar");
        toolbarEl.classList.toggle("is-index-toolbar", options.isAllCommentsView);
        toolbarEl.classList.toggle("is-note-toolbar", !options.isAllCommentsView);
        toolbarEl.classList.toggle("is-deleted-toolbar-mode", isDeletedToolbarMode);
        let indexActionGroup: HTMLDivElement | null = null;
        let indexChipRow: HTMLDivElement | null = null;
        let noteFilterGroup: HTMLDivElement | null = null;
        let noteActionGroup: HTMLDivElement | null = null;
        if (options.isAllCommentsView) {
            const modeRow = toolbarEl.createDiv("aside-sidebar-toolbar-row");
            modeRow.addClass("is-note-primary-row");
            this.renderIndexModeControl(modeRow, {
                isTagsEnabled: options.isTagsEnabled,
                isThoughtTrailEnabled: options.isThoughtTrailEnabled,
            });

            indexChipRow = toolbarEl.createDiv("aside-sidebar-toolbar-row");
            indexChipRow.addClass("is-index-secondary-row");
            indexActionGroup = indexChipRow.createDiv("aside-sidebar-toolbar-group");
            this.renderToolbarIconButton(indexActionGroup, {
                icon: "list-filter",
                active: !!options.selectedIndexFileFilterRootPath,
                ariaLabel: options.indexFileFilterOptions.length
                    ? "Filter index by files"
                    : "No files with side notes yet",
                disabled: !options.indexFileFilterOptions.length,
                onClick: () => {
                    this.openIndexFileFilterModal(options.indexFileFilterOptions);
                },
            });
        } else {
            const modeRow = toolbarEl.createDiv("aside-sidebar-toolbar-row");
            modeRow.addClass("is-note-primary-row");
            this.renderNoteModeControl(modeRow, options.isThoughtTrailEnabled);

            if (shouldShowNoteSearchInput || showListOrTagToolbarChips || shouldShowAddPageCommentAction || options.noteSidebarMode === "tags") {
                const actionsRow = toolbarEl.createDiv("aside-sidebar-toolbar-row");
                if (shouldShowNoteSearchInput) {
                    actionsRow.addClass("is-note-search-row");
                }
                actionsRow.addClass("is-note-secondary-row");
                noteFilterGroup = actionsRow.createDiv("aside-sidebar-toolbar-group is-filter-group");
                noteActionGroup = actionsRow.createDiv("aside-sidebar-toolbar-group is-action-group");
            }
        }

        if (!showListOrTagToolbarChips && options.isAllCommentsView) {
            return;
        }

        const filterGroup = options.isAllCommentsView
            ? (indexActionGroup ?? (indexChipRow ?? toolbarEl).createDiv("aside-sidebar-toolbar-group"))
            : noteFilterGroup;
        const actionGroup = noteActionGroup ?? filterGroup;
        if (!filterGroup || !actionGroup) {
            return;
        }

        if (shouldShowNoteSearchInput) {
            this.renderNoteSearchInput(filterGroup);
        }
        if (!options.isAllCommentsView && showListOrTagToolbarChips) {
            this.renderToolbarIconButton(actionGroup, {
                icon: "pin",
                active: showPinnedThreadsOnly,
                ariaLabel: showPinnedThreadsOnly ? "Show all side notes" : "Show pinned side notes",
                disabled: !hasPinnedThreads && !showPinnedThreadsOnly,
                onClick: () => {
                    void this.togglePinnedSidebarMode();
                },
            });
        }
        if (shouldShowResolvedChip) {
            this.renderToolbarIconButton(actionGroup, {
                icon: "check",
                active: showResolved,
                ariaLabel: showResolved ? "Show active comments" : "Show resolved comments only",
                onClick: () => {
                    void this.plugin.setShowResolvedComments(!showResolved);
                },
            });
        }

        if (shouldShowNestedChip) {
            this.renderToolbarIconButton(actionGroup, {
                icon: showNestedComments ? "chevrons-up" : "chevrons-down",
                ariaLabel: showNestedComments ? "Hide nested comments" : "Show nested comments",
                active: showNestedComments,
                activeVisual: false,
                onClick: () => {
                    void this.plugin.setShowNestedComments(!showNestedComments);
                },
            });
        }

        if (!options.isAllCommentsView && showListOrTagToolbarChips) {
            this.renderToolbarIconButton(actionGroup, {
                icon: "trash-2",
                ariaLabel: showDeletedComments ? "Hide deleted notes" : "Show deleted notes",
                active: showDeletedComments,
                disabled: !options.hasDeletedComments && !showDeletedComments,
                onClick: () => {
                    void this.toggleDeletedSidebarMode({
                        showDeleted: showDeletedComments,
                        showResolved,
                        contentFilter: options.noteSidebarContentFilter,
                    });
                },
            });

        }

        if (shouldShowAddPageCommentAction && options.addPageCommentAction) {
            this.renderToolbarIconButton(actionGroup, {
                icon: options.addPageCommentAction.icon,
                ariaLabel: options.addPageCommentAction.ariaLabel,
                onClick: options.addPageCommentAction.onClick,
            });
        }

        if (activePrimaryMode === "tags") {
            this.renderNoteSidebarTagFilterRow(toolbarEl, options.isAllCommentsView ? "index" : "note");
        }

        if (!options.isAllCommentsView && options.noteSidebarMode === "tags") {
            this.renderNoteSidebarTagBatchFlowPanel(toolbarEl);
        }
    }

    private renderNoteSidebarTagFilterRow(toolbarEl: HTMLElement, surface: "note" | "index" = "note"): void {
        const index = this.noteSidebarTagIndex;
        if (!index || index.threadIdsByTag.size === 0) {
            return;
        }

        const row = toolbarEl.createDiv(`aside-sidebar-toolbar-row is-${surface}-tag-filter-row`);
        const tagFilterGroup = row.createDiv("aside-sidebar-toolbar-group is-filter-group");

        this.renderToolbarChip(tagFilterGroup, {
            label: "All",
            icon: "tag",
            chipClass: "is-tag-filter-chip",
            active: this.noteSidebarVisibleTagFilterKey === null,
            onClick: () => {
                if (this.noteSidebarVisibleTagFilterKey === null) {
                    return;
                }

                this.noteSidebarVisibleTagFilterKey = null;
                if (surface === "index") {
                    this.indexSidebarSearchQuery = "";
                } else {
                    this.noteSidebarSearchQuery = "";
                    this.noteSidebarSearchInputValue = "";
                }
                void this.renderComments({
                    skipDataRefresh: true,
                });
            },
        });

        for (const [tagKey, threadIds] of Array.from(index.threadIdsByTag.entries())) {
            const tagText = index.tagsByDisplay.get(tagKey) ?? `#${tagKey}`;
            const isActive = this.noteSidebarVisibleTagFilterKey === tagKey;
            this.renderToolbarChip(tagFilterGroup, {
                label: tagText,
                icon: "tag",
                chipClass: "is-tag-filter-chip",
                count: String(threadIds.size),
                active: isActive,
                onClick: () => {
                    this.noteSidebarVisibleTagFilterKey = isActive
                        ? null
                        : tagKey;
                    this.noteSidebarBatchTagFlow = {
                        ...this.noteSidebarBatchTagFlow,
                        isOpen: false,
                    };
                    if (surface === "index") {
                        this.indexSidebarSearchQuery = "";
                    } else {
                        this.noteSidebarSearchQuery = "";
                        this.noteSidebarSearchInputValue = "";
                    }
                    void this.renderComments({
                        skipDataRefresh: true,
                    });
                },
            });
        }
    }

    private renderNoteSidebarTagBatchFlowPanel(toolbarEl: HTMLElement): void {

        const row = toolbarEl.createDiv("aside-sidebar-toolbar-row is-note-tag-batch-row");
        const filterGroup = row.createDiv("aside-sidebar-toolbar-group is-filter-group");
        const inputRow = filterGroup.createDiv("aside-note-tag-batch-input-row");
        const visibleThreadIds = this.getNoteSidebarTagBatchVisibleThreadIds();
        const areAllVisibleThreadsSelected = visibleThreadIds.every((threadId) => this.noteSidebarSelectedTagIds.has(threadId));
        const hasSelectableVisibleThreads = visibleThreadIds.length > 0;
        const selectAllButtonLabel = "Select all";

        const summary = inputRow.createDiv("aside-note-tag-batch-summary");
        summary.createSpan({
            text: `${this.noteSidebarSelectedTagIds.size} selected`,
        });
        const selectAllButton = inputRow.createEl("button", {
            text: selectAllButtonLabel,
            cls: `aside-filter-chip aside-note-tag-batch-select-all-button${areAllVisibleThreadsSelected ? " is-active" : ""}`,
        });
        selectAllButton.setAttribute("type", "button");
        selectAllButton.disabled = !hasSelectableVisibleThreads;
        selectAllButton.onclick = () => {
            if (!hasSelectableVisibleThreads) {
                return;
            }

            this.toggleVisibleTagBatchThreadSelection();
        };

        const tagInputRow = inputRow.createDiv("aside-note-search-field is-tag-batch-input");
        const iconEl = tagInputRow.createSpan({
            cls: "aside-note-search-icon",
        });
        setIcon(iconEl, "search");
        const inputEl = tagInputRow.createEl("input", {
            cls: "aside-note-search-input aside-note-tag-batch-search-input",
        });
        inputEl.type = "search";
        inputEl.value = this.noteSidebarBatchTagFlow.query;
        inputEl.spellcheck = false;
        inputEl.placeholder = "Tag to apply";
        inputEl.addEventListener("focus", () => {
            this.interactionController.claimSidebarInteractionOwnership(inputEl);
        });
        inputEl.addEventListener("input", () => {
            this.scheduleNoteSidebarBatchTagSearchQuery(inputEl.value);
        });
        inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                void this.selectOrCreateBatchTag();
                return;
            }

            if (event.key === "Escape") {
                if (!inputEl.value) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                this.scheduleNoteSidebarBatchTagSearchQuery("");
                return;
            }
        });

        const hasValidAddTag = Boolean(this.getNormalizedTagKey(this.getNoteSidebarBatchTagText() || ""));
        const hasRemoveTargetTag = Boolean(this.getNormalizedTagKey(this.getBatchTagActionTagText() || ""));
        const isApplying = this.noteSidebarBatchTagFlow.isApplying;
        const isSelectionEmpty = this.noteSidebarSelectedTagIds.size === 0;

        this.renderToolbarIconButton(inputRow, {
            icon: "plus",
            active: false,
            disabled: isSelectionEmpty || !hasValidAddTag || isApplying,
            onClick: () => {
                void this.selectOrCreateBatchTag();
            },
        });
        this.renderToolbarIconButton(inputRow, {
            icon: "minus",
            active: false,
            disabled: isSelectionEmpty || !hasRemoveTargetTag || isApplying,
            onClick: () => {
                void this.removeBatchTagFromSelectedThreads();
            },
        });

        if (this.noteSidebarBatchTagFlow.failures.length > 0) {
            const failureList = filterGroup.createDiv("aside-note-tag-batch-failures");
            failureList.createDiv({
                text: `${this.noteSidebarBatchTagFlow.failures.length} failure${this.noteSidebarBatchTagFlow.failures.length === 1 ? "" : "s"}`,
                cls: "aside-note-tag-batch-failure-title",
            });
            for (const failure of this.noteSidebarBatchTagFlow.failures.slice(0, 5)) {
                failureList.createDiv({
                    text: `${failure.threadId}: ${failure.message}`,
                    cls: "aside-note-tag-batch-failure-item",
                });
            }
        }
    }

    private renderToolbarChip(
        container: HTMLElement,
        options: ToolbarChipOptions,
    ): void {
        renderToolbarChip(container, options, this.toolbarActionGuard);
    }

    private renderToolbarIconButton(
        container: HTMLElement,
        options: ToolbarIconButtonOptions,
    ): void {
        renderToolbarIconButton(container, options, this.toolbarActionGuard);
    }

    private refreshSidebarSearchHighlights(container: HTMLElement, query: string): void {
        clearSidebarSearchHighlights(container);

        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            return;
        }

        const selectors = [
            ".aside-comment-meta-preview",
            ".aside-comment-content",
            ".aside-comment-reference-section-list",
        ];
        highlightSidebarSearchMatches(container, trimmedQuery, {
            allowedSelectors: selectors,
        });
    }

    private renderSidebarSearchInput(
        container: HTMLElement,
        options: SidebarSearchInputOptions,
    ): void {
        renderSidebarSearchInput(container, {
            ...options,
            onFocus: (inputEl) => {
                this.interactionController.claimSidebarInteractionOwnership(inputEl);
                options.onFocus?.(inputEl);
            },
        });
    }

    private renderNoteSearchInput(container: HTMLElement): void {
        this.renderSidebarSearchInput(container, {
            value: this.noteSidebarSearchInputValue,
            placeholder: "Search side notes in this file",
            onClear: () => {
                this.clearNoteSidebarSearchDebounceTimer();
                const requestVersion = ++this.noteSidebarSearchRequestVersion;
                this.noteSidebarSearchInputValue = "";
                void this.applyNoteSidebarSearchQuery("", requestVersion, {
                    selectionStart: 0,
                    selectionEnd: 0,
                });
            },
            onInput: (value, selection) => {
                this.scheduleNoteSidebarSearchQuery(value, selection);
            },
        });
    }

    private renderIndexModeControl(
        container: HTMLElement,
        options: {
            isTagsEnabled: boolean;
            isThoughtTrailEnabled: boolean;
        },
    ): void {
        this.renderSidebarModeControl(container, {
            mode: this.indexSidebarMode,
            showTagsTab: true,
            isTagsEnabled: options.isTagsEnabled,
            isThoughtTrailEnabled: options.isThoughtTrailEnabled,
            onChange: (mode) => {
                if (mode === "tags" && !options.isTagsEnabled) {
                    return;
                }
                if (mode === "thought-trail" && !options.isThoughtTrailEnabled) {
                    return;
                }
                if (this.indexSidebarMode === mode) {
                    return;
                }

                this.indexSidebarMode = mode;
                if (mode !== "list") {
                    this.showPinnedSidebarThreadsOnly = false;
                    this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
                }
                void this.plugin.logEvent("info", "index", "index.mode.changed", {
                    mode,
                    source: "toolbar",
                });
                void this.renderComments({ skipDataRefresh: true });
            },
        });
    }

    private renderNoteModeControl(container: HTMLElement, isThoughtTrailEnabled: boolean): void {
        this.renderSidebarModeControl(container, {
            mode: this.noteSidebarMode,
            showTagsTab: true,
            isTagsEnabled: true,
            isThoughtTrailEnabled,
            onChange: (mode) => {
                if (mode === "thought-trail" && !isThoughtTrailEnabled) {
                    return;
                }
                if (this.noteSidebarMode === mode) {
                    return;
                }

                const previousMode = this.noteSidebarMode;
                this.noteSidebarMode = mode;
                if (previousMode === "tags" && mode !== "tags") {
                    this.noteSidebarSelectedTagIds.clear();
                    this.clearNoteSidebarBatchTagFlowPanel();
                }
                if (mode !== "list") {
                    this.showPinnedSidebarThreadsOnly = false;
                    this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
                }
                void this.plugin.logEvent("info", "note", "note.mode.changed", {
                    mode,
                    source: "toolbar",
                });
                void this.renderComments({ skipDataRefresh: true });
            },
        });
    }

    private renderSidebarModeControl(
        container: HTMLElement,
        options: SidebarModeControlOptions,
    ): void {
        renderSidebarModeControl(container, options, this.toolbarActionGuard);
    }

    private renderActiveFileFilters(
        container: HTMLElement,
        rootFilePath: string,
        filteredIndexFilePaths: string[],
    ): void {
        renderActiveFileFilters(container, {
            rootFilePath,
            filteredIndexFilePaths,
            onClear: () => {
                void this.setIndexFileFilterRootPath(null);
            },
        }, this.toolbarActionGuard);
    }

    private async buildIndexFileFilterStateFromIndexNote(file: TFile): Promise<{
        options: IndexFileFilterOption[];
        firstFilePath: string | null;
    }> {
        const commentCounts = new Map<string, number>();
        let firstFilePath: string | null = null;
        const decodeHtmlAttributeValue = (value: string): string => {
            return value
                .replace(/&quot;/g, "\"")
                .replace(/&#39;/g, "'")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&amp;/g, "&");
        };
        const addFilePath = (filePath: string | null): void => {
            const normalizedFilePath = filePath?.trim() ?? "";
            if (!normalizedFilePath) {
                return;
            }

            if (!firstFilePath && this.app.vault.getAbstractFileByPath(normalizedFilePath) instanceof TFile) {
                firstFilePath = normalizedFilePath;
            }
            const threadCount = this.plugin.getThreadsForFile(normalizedFilePath).length;
            commentCounts.set(normalizedFilePath, Math.max(1, threadCount));
        };

        try {
            const indexContent = await this.app.vault.cachedRead(file);
            const fileFilterLinkPattern = /\bdata-aside-file-path="([^"]+)"/g;
            for (const match of indexContent.matchAll(fileFilterLinkPattern)) {
                addFilePath(decodeHtmlAttributeValue(match[1]));
            }

            const linkPattern = /\]\((obsidian:\/\/(?:open|aside-index-file)[^)]+)\)/g;
            for (const match of indexContent.matchAll(linkPattern)) {
                addFilePath(parseIndexFileOpenUrl(match[1]));
            }
        } catch (error) {
            void this.plugin.logEvent("warn", "index", "index.filter-options.read.warn", {
                filePath: file.path,
                error,
            });
        }

        const selectedRootPath = this.selectedIndexFileFilterRootPath;
        if (selectedRootPath && !commentCounts.has(selectedRootPath)) {
            const threadCount = this.plugin.getThreadsForFile(selectedRootPath).length;
            commentCounts.set(selectedRootPath, Math.max(1, threadCount));
        }

        return {
            options: buildIndexFileFilterOptionsFromCounts(commentCounts),
            firstFilePath,
        };
    }

    private openIndexFileFilterModal(indexFileFilterOptions: IndexFileFilterOption[]): void {
        new SideNoteFileFilterModal(this.app, {
            availableOptions: indexFileFilterOptions,
            selectedRootFilePath: this.selectedIndexFileFilterRootPath,
            selectedFilePaths: deriveIndexSidebarScopedFilePaths(
                this.indexFileFilterGraph,
                this.selectedIndexFileFilterRootPath,
            ),
            onChooseRoot: async (rootFilePath) => {
                await this.setIndexFileFilterRootPath(rootFilePath);
            },
        }).open();
    }

    public getIndexFileFilterRootPath(): string | null {
        return this.selectedIndexFileFilterRootPath;
    }

	public async setIndexFileFilterRootPath(filePath: string | null): Promise<void> {
		const normalizedRootPath = normalizeIndexFileFilterRootPath(filePath);
        this.indexFileFilterAutoSelectSuppressed = normalizedRootPath === null;
		if (this.selectedIndexFileFilterRootPath === normalizedRootPath) {
			return;
		}

		const didChangeFilter = this.selectedIndexFileFilterRootPath !== normalizedRootPath;
		this.selectedIndexFileFilterRootPath = normalizedRootPath;
        if (this.file) {
            this.plugin.syncIndexPreviewFileScope(this.file.path);
        }
        if (didChangeFilter) {
            void this.plugin.logEvent("info", "index", "index.filter.changed", {
                rootFilePath: normalizedRootPath,
				source: "sidebar",
			});
		}
		this.interactionController.clearActiveState();
		await this.renderComments();
	}

    private ensureListModeForCommentFocus(): void {
        if (!this.file) {
            return;
        }

        if (this.plugin.isAllCommentsNotePath(this.file.path)) {
            if (this.indexSidebarMode === "list") {
                return;
            }

            this.indexSidebarMode = "list";
            void this.plugin.logEvent("info", "index", "index.mode.changed", {
                mode: "list",
                source: "comment-focus",
            });
            return;
        }

        if (this.noteSidebarMode === "tags" || this.noteSidebarMode === "list") {
            return;
        }

        this.noteSidebarMode = "list";
        void this.plugin.logEvent("info", "note", "note.mode.changed", {
            mode: "list",
            source: "comment-focus",
        });
    }

    private renderCommentsList(container: HTMLElement): HTMLDivElement {
        return container.createDiv("aside-comments-list");
    }

    private openMoveCommentThreadModal(threadId: string, sourceFilePath: string): void {
        const openTargets = this.getOpenMarkdownFileInsertTargets();
        const openTargetsByPath = new Map(openTargets.map((target) => [target.file.path, target]));
        const availableFiles = this.app.vault
            .getMarkdownFiles()
            .filter((file) =>
                file.path !== sourceFilePath
                && file.path !== this.plugin.getAllCommentsNotePath()
            )
            .map((file) => {
                const openTarget = openTargetsByPath.get(file.path);
                return {
                    fileName: file.basename,
                    filePath: file.path,
                    active: openTarget?.active ?? false,
                    recent: openTarget?.recent ?? false,
                };
            })
            .sort((left, right) => {
                if (left.active !== right.active) {
                    return left.active ? -1 : 1;
                }
                if (left.recent !== right.recent) {
                    return left.recent ? -1 : 1;
                }

                return left.filePath.localeCompare(right.filePath);
            });

        new SideNoteOpenFileSuggestModal(this.app, {
            availableFiles,
            detailLabel: "",
            emptyStateText: "No markdown files are available to move into.",
            onChooseFile: async (suggestion) => {
                await this.moveSidebarCommentThreadToFile(threadId, suggestion.filePath);
            },
            onCloseModal: () => {},
            placeholder: "Find a file to move into",
            title: "Move to another file",
        }).open();
    }

    private getOpenMarkdownFileInsertTargets(): OpenMarkdownFileInsertTarget[] {
        const workspace = this.app.workspace;
        const activeLeaf = workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null;
        const recentLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
        const targetsByPath = new Map<string, OpenMarkdownFileInsertTarget>();

        workspace.iterateAllLeaves((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) {
                return;
            }

            const file = leaf.view.file;
            if (!(file instanceof TFile) || file.extension !== "md") {
                return;
            }

            const target: OpenMarkdownFileInsertTarget = {
                file,
                leaf,
                view: leaf.view,
                active: leaf === activeLeaf,
                recent: leaf === recentLeaf,
                editable: leaf.view.getMode() !== "preview",
            };
            const current = targetsByPath.get(file.path);
            if (!current) {
                targetsByPath.set(file.path, target);
                return;
            }

            const preferredTarget = shouldReplaceOpenMarkdownFileInsertTarget(current, target)
                ? target
                : current;
            targetsByPath.set(file.path, {
                ...preferredTarget,
                active: current.active || target.active,
                recent: current.recent || target.recent,
                editable: current.editable || target.editable,
            });
        });

        return Array.from(targetsByPath.values()).sort(compareOpenMarkdownFileInsertTargets);
    }

    private async insertCommentMarkdownIntoOpenFile(
        target: OpenMarkdownFileInsertTarget,
        markdown: string,
    ): Promise<boolean> {
        const normalizedMarkdown = markdown.trim();
        if (!normalizedMarkdown) {
            new Notice("Unable to add that content.");
            return false;
        }

        this.app.workspace.setActiveLeaf(target.leaf, { focus: true });
        const cursorLine = target.editable ? target.view.editor.getCursor().line : null;

        const editableView = await ensureEditableMarkdownLeafForInsert(target.leaf);
        if (!editableView) {
            new Notice("Unable to open that file for editing.");
            return false;
        }

        const editor = editableView.editor;
        const insertEdit = buildSidebarFileInsertEdit(editor.getValue(), normalizedMarkdown, cursorLine);
        if (!insertEdit) {
            new Notice("Unable to add that content.");
            return false;
        }

        editor.replaceRange(insertEdit.text, insertEdit.position);
        const nextPosition = editor.offsetToPos(editor.posToOffset(insertEdit.position) + insertEdit.text.length);
        editor.setSelection(nextPosition, nextPosition);
        editableView.editor.focus();
        new Notice("Added to file.");
        return true;
    }

    private async insertCommentMarkdownIntoFile(markdown: string): Promise<boolean> {
        const availableTargets = this.getOpenMarkdownFileInsertTargets();
        if (!availableTargets.length) {
            new Notice("Open a markdown file first.");
            return false;
        }

        const directTarget = getSingleOpenFileInsertTarget(availableTargets);
        if (directTarget) {
            try {
                return await this.insertCommentMarkdownIntoOpenFile(directTarget, markdown);
            } catch (error) {
                console.error("Failed to add comment markdown to the open file", error);
                new Notice("Unable to add to that file.");
                return false;
            }
        }

        return new Promise<boolean>((resolve) => {
            let selectionStarted = false;
            let settled = false;
            const settle = (value: boolean) => {
                if (settled) {
                    return;
                }

                settled = true;
                resolve(value);
            };

            new SideNoteOpenFileSuggestModal(this.app, {
                availableFiles: availableTargets.map((target) => ({
                    fileName: target.file.basename,
                    filePath: target.file.path,
                    active: target.active,
                    recent: target.recent,
                })),
                onChooseFile: async (suggestion) => {
                    selectionStarted = true;
                    const latestTarget = this.getOpenMarkdownFileInsertTargets()
                        .find((target) => target.file.path === suggestion.filePath);
                    if (!latestTarget) {
                        new Notice("That file is no longer open.");
                        settle(false);
                        return;
                    }

                    try {
                        settle(await this.insertCommentMarkdownIntoOpenFile(latestTarget, markdown));
                    } catch (error) {
                        console.error("Failed to add comment markdown to file", error);
                        new Notice("Unable to add to that file.");
                        settle(false);
                    }
                },
                onCloseModal: () => {
                    if (!selectionStarted) {
                        settle(false);
                    }
                },
            }).open();
        });
    }

    private async renderPersistedComment(
        commentsContainer: HTMLDivElement,
        thread: CommentThread,
        enablePageThreadReorder: boolean,
        agentRun: ReturnType<Aside["getLatestAgentRunForThread"]>,
        agentStream: ReturnType<Aside["getActiveAgentStreamForThread"]>,
        threadAgentRuns: AgentRunRecord[],
        editDraftComment: DraftComment | null = null,
        appendDraftComment: DraftComment | null = null,
    ) {
        const currentFilePath = this.file?.path ?? null;
        const isIndexView = !!currentFilePath && this.plugin.isAllCommentsNotePath(currentFilePath);

        await renderPersistedCommentCard(commentsContainer, thread, {
            activeCommentId: this.interactionController.getActiveCommentId(),
            currentFilePath,
            currentUserLabel: "You",
            showSourceRedirectAction: isIndexView,
            showBookmarkAndPinControls: !isIndexView,
            showDeletedComments: this.plugin.shouldShowDeletedComments(),
            enablePageThreadReorder,
            enableChildEntryMove: true,
            enableSoftDeleteActions: true,
            showNestedComments: this.plugin.shouldShowNestedCommentsForThread(thread.id),
            showNestedCommentsByDefault: this.plugin.shouldShowNestedComments(),
            getKnownCommentById: (commentId) => this.plugin.getCommentById(commentId),
            editDraftComment,
            appendDraftComment,
            agentRun,
            agentStream,
            threadAgentRuns,
            getEventTargetElement: (target) => this.interactionController.getEventTargetElement(target),
            isSelectionInsideSidebarContent: (selection) => this.interactionController.isSelectionInsideSidebarContent(selection),
            claimSidebarInteractionOwnership: (focusTarget) => this.interactionController.claimSidebarInteractionOwnership(focusTarget),
            insertCommentMarkdownIntoFile: (markdown) => this.insertCommentMarkdownIntoFile(markdown),
            renderMarkdown: async (markdown, container, sourcePath) => {
                await MarkdownRenderer.render(this.app, markdown, container, sourcePath, this);
            },
            openSidebarInternalLink: (href, sourcePath, focusTarget) =>
                this.interactionController.openSidebarInternalLink(href, sourcePath, focusTarget),
            openCommentFromCard: async (persistedComment) => {
                if (isIndexView && currentFilePath) {
                    this.interactionController.setActiveComment(persistedComment.id);
                    await this.plugin.revealIndexCommentFromSidebar(persistedComment.id, currentFilePath);
                    return;
                }

                if (this.isNonDesktopClient()) {
                    this.interactionController.setActiveComment(persistedComment.id);
                    return;
                }

                const previousMode = this.noteSidebarMode;
                await this.interactionController.openCommentInEditor(persistedComment);
                if (
                    previousMode === "tags"
                    && this.noteSidebarMode !== "tags"
                    && this.file
                    && !this.plugin.isAllCommentsNotePath(this.file.path)
                ) {
                    this.noteSidebarMode = "tags";
                }
            },
            openCommentInEditor: (persistedComment) => this.interactionController.openCommentInEditor(persistedComment),
            shareComment: async (persistedComment) => {
                const commentUrl = buildCommentLocationUrl(this.app.vault.getName(), persistedComment);
                const copied = await copyTextToClipboard(commentUrl);
                new Notice(copied ? "Copied side note link." : "Failed to copy side note link.");
            },
            saveVisibleDraftIfPresent: () => this.saveVisibleDraftIfPresent(),
            setShowNestedCommentsForThread: (threadId, showNestedComments) => {
                void this.plugin.setShowNestedCommentsForThread(threadId, showNestedComments);
            },
            resolveComment: (commentId) => this.setSidebarCommentResolvedState(commentId, true),
            unresolveComment: (commentId) => this.setSidebarCommentResolvedState(commentId, false),
            moveCommentThread: (threadId, sourceFilePath) => {
                this.openMoveCommentThreadModal(threadId, sourceFilePath);
            },
            restoreComment: async (commentId) => {
                const thread = this.plugin.getThreadById(commentId);
                const restored = await this.plugin.restoreComment(commentId);
                if (!restored) {
                    return;
                }

                if (thread && thread.id !== commentId) {
                    await this.plugin.setShowNestedCommentsForThread(thread.id, true);
                }
                if (this.plugin.shouldShowDeletedComments()) {
                    await this.plugin.setShowDeletedComments(false);
                }
                this.highlightComment(commentId);
            },
            clearDeletedComment: (commentId) => this.clearDeletedSidebarComment(commentId),
            startEditDraft: (commentId, hostFilePath) => {
                void this.plugin.startEditDraft(commentId, hostFilePath);
            },
            isPinnedThread: (threadId) => this.isPinnedSidebarThread(threadId),
            togglePinnedThread: (threadId) => this.togglePinnedSidebarThread(threadId),
            startAppendEntryDraft: (commentId, hostFilePath) => {
                void this.plugin.startAppendEntryDraft(commentId, hostFilePath);
            },
            retryAgentRun: (runId) => this.plugin.retryAgentRun(runId),
            retryAgentPromptForComment: (commentId, filePath) => this.plugin.retryAgentPromptForComment(commentId, filePath),
            reanchorCommentThreadToCurrentSelection: (commentId) => {
                void this.plugin.reanchorCommentThreadToCurrentSelection(commentId);
            },
            deleteCommentWithConfirm: (commentId) => this.deleteCommentWithConfirm(commentId),
            renderAppendDraft: (container, comment) => {
                this.renderDraftComment(container, comment);
            },
            renderInlineEditDraft: (container, comment) => {
                this.renderInlineEditDraft(container, comment);
            },
            setIcon: (element, icon) => {
                setIcon(element, icon);
            },
        });
    }

    private setupPageThreadReorderInteractions(commentsBody: HTMLDivElement, filePath: string): void {
        commentsBody.addEventListener("dragstart", (event: DragEvent) => {
            const dragState = this.getSidebarDragStateFromEventTarget(event.target, filePath);
            if (!dragState) {
                return;
            }

            this.clearReorderDragState();
            this.reorderDragState = dragState;
            this.reorderDragSourceEl = this.getCommentItemFromEventTarget(event.target);
            this.reorderDragSourceEl?.addClass("is-drag-source");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                    "text/plain",
                    dragState.kind === "thread"
                        ? dragState.threadId
                        : dragState.entryId,
                );
            }
        });

        commentsBody.addEventListener("dragover", (event: DragEvent) => {
            const threadDropTarget = this.resolvePageThreadDropTarget(event);
            const entryDropTarget = this.resolveChildEntryMoveDropTarget(event);
            if (!threadDropTarget && !entryDropTarget) {
                this.clearReorderDropIndicator();
                return;
            }

            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }
            if (threadDropTarget) {
                this.setReorderDropIndicator(threadDropTarget.element, threadDropTarget.placement);
                return;
            }
            if (entryDropTarget) {
                this.setReorderDropIndicator(entryDropTarget.element, "after");
            }
        });

        commentsBody.addEventListener("drop", (event: DragEvent) => {
            const dragState = this.reorderDragState;
            const threadDropTarget = this.resolvePageThreadDropTarget(event);
            const entryDropTarget = this.resolveChildEntryMoveDropTarget(event);
            this.clearReorderDropIndicator();
            if (!dragState || (!threadDropTarget && !entryDropTarget)) {
                return;
            }

            event.preventDefault();
            this.clearReorderDragState();
            if (dragState.kind === "thread" && threadDropTarget) {
                void this.plugin.reorderThreadsForFile(
                    dragState.filePath,
                    dragState.threadId,
                    threadDropTarget.targetId,
                    threadDropTarget.placement,
                );
                return;
            }
            if (dragState.kind === "thread-entry" && entryDropTarget) {
                void this.moveSidebarCommentEntryToThread(dragState.entryId, entryDropTarget.targetThreadId);
            }
        });

        commentsBody.addEventListener("dragend", () => {
            this.clearReorderDragState();
        });
    }

    private getCommentItemFromEventTarget(target: EventTarget | null): HTMLElement | null {
        return nodeInstanceOf(target, Element)
            ? target.closest(".aside-comment-item")
            : null;
    }

    private getSidebarDragStateFromEventTarget(
        target: EventTarget | null,
        filePath: string,
    ): SidebarReorderDragState | null {
        if (!nodeInstanceOf(target, Element)) {
            return null;
        }

        const handleEl = target.closest("[data-aside-drag-kind]");
        if (!nodeInstanceOf(handleEl, HTMLElement)) {
            return null;
        }

        const dragKind = handleEl.getAttribute("data-aside-drag-kind");
        if (dragKind === "thread") {
            const threadId = handleEl.getAttribute("data-aside-thread-id");
            if (!threadId) {
                return null;
            }

            return {
                kind: "thread",
                filePath,
                threadId,
            };
        }

        if (dragKind !== "thread-entry") {
            return null;
        }

        const sourceThreadId = handleEl.getAttribute("data-aside-thread-id");
        const entryId = handleEl.getAttribute("data-aside-entry-id");
        if (!sourceThreadId || !entryId) {
            return null;
        }
        const sourceThread = this.plugin.getThreadById(sourceThreadId);
        if (!sourceThread) {
            return null;
        }

        return {
            kind: "thread-entry",
            entryId,
            filePath: sourceThread.filePath,
            sourceThreadId,
        };
    }

    private resolvePageThreadDropTarget(event: DragEvent): {
        element: HTMLElement;
        targetId: string;
        placement: ReorderPlacement;
    } | null {
        const dragState = this.reorderDragState;
        if (!dragState || dragState.kind !== "thread" || !nodeInstanceOf(event.target, Element)) {
            return null;
        }

        const threadStackEl = event.target.closest(".aside-thread-stack[data-aside-page-thread='true']");
        if (!nodeInstanceOf(threadStackEl, HTMLElement)) {
            return null;
        }

        const targetThreadId = threadStackEl.getAttribute("data-thread-id");
        const targetCommentEl = threadStackEl.firstElementChild;
        if (!targetThreadId || targetThreadId === dragState.threadId) {
            return null;
        }
        if (!nodeInstanceOf(targetCommentEl, HTMLElement)) {
            return null;
        }

        return {
            element: targetCommentEl,
            targetId: targetThreadId,
            placement: this.resolveReorderPlacement(threadStackEl, event.clientY),
        };
    }

    private resolveChildEntryMoveDropTarget(event: DragEvent): {
        element: HTMLElement;
        targetThreadId: string;
    } | null {
        const dragState = this.reorderDragState;
        if (!dragState || dragState.kind !== "thread-entry" || !nodeInstanceOf(event.target, Element)) {
            return null;
        }

        const threadStackEl = event.target.closest(".aside-thread-stack");
        if (!nodeInstanceOf(threadStackEl, HTMLElement)) {
            return null;
        }

        const targetThreadId = threadStackEl.getAttribute("data-thread-id");
        const targetCommentEl = threadStackEl.firstElementChild;
        if (!targetThreadId || targetThreadId === dragState.sourceThreadId) {
            return null;
        }
        const targetThread = this.plugin.getThreadById(targetThreadId);
        if (
            !targetThread
            || targetThread.deletedAt
            || targetThread.resolved
            || targetThread.filePath !== dragState.filePath
        ) {
            return null;
        }
        if (!nodeInstanceOf(targetCommentEl, HTMLElement)) {
            return null;
        }

        return {
            element: targetCommentEl,
            targetThreadId,
        };
    }

    private resolveReorderPlacement(element: HTMLElement, clientY: number): ReorderPlacement {
        const rect = element.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2 ? "before" : "after";
    }

    private setReorderDropIndicator(element: HTMLElement, placement: ReorderPlacement): void {
        if (this.reorderDropIndicatorEl === element && this.reorderDropIndicatorPlacement === placement) {
            return;
        }

        this.clearReorderDropIndicator();
        this.reorderDropIndicatorEl = element;
        this.reorderDropIndicatorPlacement = placement;
        element.addClass(placement === "before" ? "is-drop-before" : "is-drop-after");
    }

    private clearReorderDropIndicator(): void {
        if (!this.reorderDropIndicatorEl) {
            this.reorderDropIndicatorPlacement = null;
            return;
        }

        this.reorderDropIndicatorEl.removeClass("is-drop-before", "is-drop-after");
        this.reorderDropIndicatorEl = null;
        this.reorderDropIndicatorPlacement = null;
    }

    private clearReorderDragState(): void {
        this.clearReorderDropIndicator();
        this.reorderDragSourceEl?.removeClass("is-drag-source");
        this.reorderDragSourceEl = null;
        this.reorderDragState = null;
    }

    private renderDraftComment(commentsContainer: HTMLDivElement, comment: DraftComment) {
        renderDraftCommentCard(commentsContainer, comment, {
            activeCommentId: this.interactionController.getActiveCommentId(),
            shouldPinFocusedDraftToTop: this.isNonDesktopClient(),
            isSavingDraft: (commentId) => this.plugin.isSavingDraft(commentId),
            updateDraftCommentText: (commentId, commentText) => {
                this.plugin.updateDraftCommentText(commentId, commentText);
            },
            setIcon: (element, icon) => {
                setIcon(element, icon);
            },
            claimSidebarInteractionOwnership: (focusTarget) => this.interactionController.claimSidebarInteractionOwnership(focusTarget),
            saveDraft: async (commentId, options) => {
                await this.saveDraftAndClearActiveState(commentId, comment.filePath, options);
            },
            cancelDraft: (commentId) => {
                void this.plugin.cancelDraft(commentId);
            },
        }, this.draftEditorController);
    }

    private renderInlineEditDraft(commentsContainer: HTMLDivElement, comment: DraftComment) {
        renderInlineEditDraftContent(commentsContainer, comment, {
            activeCommentId: this.interactionController.getActiveCommentId(),
            shouldPinFocusedDraftToTop: this.isNonDesktopClient(),
            isSavingDraft: (commentId) => this.plugin.isSavingDraft(commentId),
            updateDraftCommentText: (commentId, commentText) => {
                this.plugin.updateDraftCommentText(commentId, commentText);
            },
            setIcon: (element, icon) => {
                setIcon(element, icon);
            },
            claimSidebarInteractionOwnership: (focusTarget) => this.interactionController.claimSidebarInteractionOwnership(focusTarget),
            saveDraft: async (commentId, options) => {
                await this.saveDraftAndClearActiveState(commentId, comment.filePath, options);
            },
            cancelDraft: (commentId) => {
                void this.plugin.cancelDraft(commentId);
            },
        }, this.draftEditorController);
    }

    private async saveDraftAndClearActiveState(
        commentId: string,
        draftFilePath: string,
        options?: {
            skipPreSaveRefresh?: boolean;
            skipAnchorRevalidation?: boolean;
            deferAggregateRefresh?: boolean;
            skipPersistedViewRefresh?: boolean;
        },
    ): Promise<void> {
        const currentViewPath = this.file?.path ?? null;
        await this.plugin.saveDraft(commentId, options);

        const remainingDraft = (currentViewPath
            ? this.plugin.getDraftForView(currentViewPath)
            : null)
            ?? this.plugin.getDraftForFile(draftFilePath);
        if (remainingDraft?.id === commentId) {
            return;
        }

        this.interactionController.clearActiveState();
    }

    private async saveVisibleDraftIfPresent(): Promise<boolean> {
        const currentViewPath = this.file?.path ?? null;
        if (!currentViewPath) {
            return true;
        }

        const draft = this.plugin.getDraftForView(currentViewPath);
        if (!draft) {
            return true;
        }

        await this.plugin.saveDraft(draft.id);
        const remainingDraft = this.plugin.getDraftForView(currentViewPath);
        return remainingDraft?.id !== draft.id;
    }

    private async renderThoughtTrail(
        commentsContainer: HTMLDivElement,
        comments: Array<Comment | CommentThread>,
        file: TFile,
        options: SidebarThoughtTrailOptions,
    ): Promise<void> {
        await renderSidebarThoughtTrail(commentsContainer, comments, file, options, {
            allCommentsNotePath: this.plugin.getAllCommentsNotePath(),
            app: this.app,
            component: this,
            getPreferredFileLeaf: (filePath) => this.plugin.getPreferredFileLeaf(filePath),
            renderVersion: this.renderVersion,
        });
    }

    getState(): CustomViewState {
        this.savePinnedSidebarStateForFilePath(this.file?.path ?? null);
        return {
            filePath: this.file ? this.file.path : null,
            indexSidebarMode: this.indexSidebarMode,
            noteSidebarMode: this.noteSidebarMode,
            indexFileFilterRootPath: this.selectedIndexFileFilterRootPath,
            pinnedSidebarStateByFilePath: {
                ...this.pinnedSidebarStateByFilePath,
            },
        };
    }

    onunload() {
        const doc = this.containerEl.ownerDocument;
        doc.removeEventListener("keydown", this.interactionController.documentKeydownHandler, true);
        doc.removeEventListener("copy", this.interactionController.documentCopyHandler, true);
        doc.removeEventListener("selectionchange", this.interactionController.documentSelectionChangeHandler);
        this.containerEl.removeEventListener("click", this.interactionController.sidebarClickHandler);
        this.interactionController.clearPendingFocus();
        this.interactionController.cancelPendingRevealedCommentSelectionClear();
    }

    private async deleteCommentWithConfirm(commentId: string): Promise<boolean> {
        return this.deleteSidebarComment(commentId);
    }
}
