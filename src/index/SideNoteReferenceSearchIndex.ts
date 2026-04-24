import { getFirstThreadEntry } from "../commentManager";
import type { CommentThread } from "../commentManager";
import { getCommentSelectionLabel, isPageComment } from "../core/anchors/commentAnchors";
import type { AggregateCommentIndex } from "./AggregateCommentIndex";

const MAX_BODY_PREVIEW_LENGTH = 96;
const MAX_INSERTION_LABEL_LENGTH = 64;
const PAGE_NOTE_INSERTION_WORD_LIMIT = 10;

export interface SideNoteReferenceSearchDocument {
    bodyPreview: string;
    commentId: string;
    fileName: string;
    filePath: string;
    fileTitle: string;
    insertionLabel: string;
    isPageNote: boolean;
    primaryLabel: string;
    resolved: boolean;
    selectedText: string;
    threadId: string;
    updatedAt: number;
}

export interface SideNoteReferenceSearchOptions {
    excludeThreadId?: string | null;
    includeSameFile?: boolean;
    limit?: number;
    sourceFilePath?: string | null;
}

function normalizeNotePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

function normalizeSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function stripMarkdownSyntax(value: string): string {
    return value
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/[*_~`>#=-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function truncateWords(value: string, maxWords: number): string {
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
        return value;
    }

    return `${words.slice(0, maxWords).join(" ")}...`;
}

function getFileName(filePath: string): string {
    return normalizeNotePath(filePath).split("/").pop() ?? filePath;
}

function getFileTitle(filePath: string): string {
    return getFileName(filePath).replace(/\.md$/i, "");
}

function buildSearchDocument(thread: CommentThread): SideNoteReferenceSearchDocument {
    const firstEntry = getFirstThreadEntry(thread);
    const selectedText = getCommentSelectionLabel(thread);
    const bodyPreview = truncate(stripMarkdownSyntax(firstEntry.body ?? ""), MAX_BODY_PREVIEW_LENGTH);
    const fileTitle = getFileTitle(thread.filePath);
    const pageNote = isPageComment(thread);
    const pagePrimaryLabel = truncateWords(bodyPreview, PAGE_NOTE_INSERTION_WORD_LIMIT) || fileTitle;
    const primaryLabel = pageNote
        ? pagePrimaryLabel
        : truncate(selectedText || fileTitle, MAX_INSERTION_LABEL_LENGTH);

    return {
        bodyPreview,
        commentId: thread.id,
        fileName: getFileName(thread.filePath),
        filePath: thread.filePath,
        fileTitle,
        insertionLabel: primaryLabel || fileTitle || "Side note",
        isPageNote: pageNote,
        primaryLabel: primaryLabel || fileTitle || "Side note",
        resolved: thread.resolved === true,
        selectedText,
        threadId: thread.id,
        updatedAt: thread.updatedAt,
    };
}

function isAllCommentsNotePath(filePath: string, currentPath: string): boolean {
    const normalizedPath = normalizeNotePath(filePath);
    const normalizedCurrentPath = normalizeNotePath(currentPath);
    return normalizedPath === normalizedCurrentPath || normalizedPath === "SideNote2 comments.md";
}

function getQueryMatchRank(query: string, document: SideNoteReferenceSearchDocument): number {
    if (!query) {
        return 0;
    }

    const selectedText = normalizeSearchText(document.selectedText);
    const fileTitle = normalizeSearchText(document.fileTitle);
    const bodyPreview = normalizeSearchText(document.bodyPreview);
    const filePath = normalizeSearchText(document.filePath);

    if (selectedText === query) {
        return 0;
    }

    if (fileTitle === query) {
        return 1;
    }

    if (selectedText.startsWith(query)) {
        return 2;
    }

    if (fileTitle.startsWith(query) || filePath.split("/").some((segment) => segment.startsWith(query))) {
        return 3;
    }

    if (selectedText.includes(query) || bodyPreview.includes(query) || filePath.includes(query)) {
        return 4;
    }

    return Number.POSITIVE_INFINITY;
}

export class SideNoteReferenceSearchIndex {
    constructor(
        private readonly documents: SideNoteReferenceSearchDocument[],
        private readonly documentByCommentId: Map<string, SideNoteReferenceSearchDocument>,
    ) {}

    public getDocument(commentId: string): SideNoteReferenceSearchDocument | null {
        return this.documentByCommentId.get(commentId) ?? null;
    }

    public search(query: string, options: SideNoteReferenceSearchOptions = {}): SideNoteReferenceSearchDocument[] {
        const normalizedQuery = normalizeSearchText(query);
        const normalizedSourceFilePath = options.sourceFilePath
            ? normalizeNotePath(options.sourceFilePath)
            : null;
        const includeSameFile = options.includeSameFile !== false;
        const limit = options.limit ?? 40;

        return this.documents
            .filter((document) => document.threadId !== options.excludeThreadId)
            .filter((document) => (
                includeSameFile
                || normalizedSourceFilePath === null
                || normalizeNotePath(document.filePath) !== normalizedSourceFilePath
            ))
            .map((document) => ({
                document,
                isSameFile: normalizedSourceFilePath !== null
                    && normalizeNotePath(document.filePath) === normalizedSourceFilePath,
                matchRank: getQueryMatchRank(normalizedQuery, document),
            }))
            .filter((candidate) => candidate.matchRank !== Number.POSITIVE_INFINITY)
            .sort((left, right) => {
                if (left.matchRank !== right.matchRank) {
                    return left.matchRank - right.matchRank;
                }

                if (left.isSameFile !== right.isSameFile) {
                    return left.isSameFile ? -1 : 1;
                }

                if (left.document.resolved !== right.document.resolved) {
                    return left.document.resolved ? 1 : -1;
                }

                if (left.document.updatedAt !== right.document.updatedAt) {
                    return right.document.updatedAt - left.document.updatedAt;
                }

                if (left.document.filePath !== right.document.filePath) {
                    return left.document.filePath.localeCompare(right.document.filePath);
                }

                return left.document.threadId.localeCompare(right.document.threadId);
            })
            .slice(0, limit)
            .map((candidate) => candidate.document);
    }
}

export function buildSideNoteReferenceSearchIndex(
    aggregateCommentIndex: Pick<AggregateCommentIndex, "getAllThreads">,
    options: {
        allCommentsNotePath: string;
    },
): SideNoteReferenceSearchIndex {
    const documents: SideNoteReferenceSearchDocument[] = [];
    const documentByCommentId = new Map<string, SideNoteReferenceSearchDocument>();

    for (const thread of aggregateCommentIndex.getAllThreads()) {
        if (isAllCommentsNotePath(thread.filePath, options.allCommentsNotePath)) {
            continue;
        }

        const document = buildSearchDocument(thread);
        documents.push(document);
        documentByCommentId.set(thread.id, document);
        for (const entry of thread.entries) {
            documentByCommentId.set(entry.id, document);
        }
    }

    documents.sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) {
            return right.updatedAt - left.updatedAt;
        }

        return left.threadId.localeCompare(right.threadId);
    });

    return new SideNoteReferenceSearchIndex(documents, documentByCommentId);
}
