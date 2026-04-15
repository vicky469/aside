import type { Comment, CommentThread, CommentThreadEntry } from "../../commentManager";
import { cloneCommentThreads, threadToComment } from "../../commentManager";

const HIDDEN_SECTION_OPEN = "<!-- SideNote2 comments";
const HIDDEN_SECTION_CLOSE = "-->";

interface StoredNoteCommentThreadEntry {
    id: string;
    body: string;
    timestamp: number;
}

interface StoredNoteCommentThread {
    id: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    selectedTextHash: string;
    anchorKind?: "selection" | "page";
    orphaned?: boolean;
    resolved?: boolean;
    entries: StoredNoteCommentThreadEntry[];
    createdAt: number;
    updatedAt: number;
}

export interface ParsedNoteComments {
    mainContent: string;
    comments: Comment[];
    threads: CommentThread[];
}

export interface ManagedSectionEdit {
    fromOffset: number;
    toOffset: number;
    replacement: string;
}

export interface ManagedSectionRange {
    fromOffset: number;
    toOffset: number;
}

export interface ManagedSectionLineRange {
    startLine: number;
    endLine: number;
}

interface SplitManagedSectionResult {
    normalizedContent: string;
    mainContent: string;
    sectionContent: string | null;
    sectionFromOffset: number;
    sectionToOffset: number;
    hasVisibleContentAfterSection: boolean;
}

interface FoundManagedSection {
    normalizedContent: string;
    mainContent: string;
    sectionContent: string;
    sectionFromOffset: number;
    sectionToOffset: number;
    hasVisibleContentAfterSection: boolean;
}

interface OffsetRange {
    fromOffset: number;
    toOffset: number;
}

export type ManagedSectionKind = "none" | "threaded" | "unsupported";

function normalizeCommentBody(body: string): string {
    return body.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

function cloneThreadEntry(entry: CommentThreadEntry): CommentThreadEntry {
    return {
        id: entry.id,
        body: normalizeCommentBody(entry.body),
        timestamp: entry.timestamp,
    };
}

function normalizeThread(thread: CommentThread): CommentThread {
    const entries = thread.entries.map((entry) => cloneThreadEntry(entry));
    const firstEntry = entries[0];
    const latestEntry = entries[entries.length - 1];

    return {
        ...thread,
        anchorKind: thread.anchorKind === "page" ? "page" : "selection",
        orphaned: thread.anchorKind === "page" ? false : thread.orphaned === true,
        resolved: thread.resolved === true,
        entries,
        createdAt: thread.createdAt || firstEntry?.timestamp || 0,
        updatedAt: thread.updatedAt || latestEntry?.timestamp || thread.createdAt || 0,
    };
}

function splitManagedSection(noteContent: string): SplitManagedSectionResult {
    const normalized = noteContent.replace(/\r\n/g, "\n");
    const section = findManagedSection(normalized);
    if (section) {
        return section;
    }

    return {
        normalizedContent: normalized,
        mainContent: normalized.trimEnd(),
        sectionContent: null,
        sectionFromOffset: normalized.trimEnd().length,
        sectionToOffset: normalized.length,
        hasVisibleContentAfterSection: false,
    };
}

export function sortCommentsByPosition(comments: Comment[]): Comment[] {
    return comments
        .map((comment) => ({ ...comment }))
        .sort((left, right) => {
            if (left.startLine !== right.startLine) {
                return left.startLine - right.startLine;
            }
            if (left.startChar !== right.startChar) {
                return left.startChar - right.startChar;
            }
            return left.timestamp - right.timestamp;
        });
}

function toStoredThreadEntry(entry: CommentThreadEntry): StoredNoteCommentThreadEntry {
    return {
        id: entry.id,
        body: normalizeCommentBody(entry.body),
        timestamp: entry.timestamp,
    };
}

function toStoredThread(thread: CommentThread): StoredNoteCommentThread {
    const normalized = normalizeThread(thread);
    return {
        id: normalized.id,
        startLine: normalized.startLine,
        startChar: normalized.startChar,
        endLine: normalized.endLine,
        endChar: normalized.endChar,
        selectedText: normalized.selectedText,
        selectedTextHash: normalized.selectedTextHash,
        anchorKind: normalized.anchorKind === "page" ? "page" : undefined,
        orphaned: normalized.orphaned === true ? true : undefined,
        resolved: normalized.resolved === true ? true : undefined,
        entries: normalized.entries.map((entry) => toStoredThreadEntry(entry)),
        createdAt: normalized.createdAt,
        updatedAt: normalized.updatedAt,
    };
}

function buildManagedSection(threads: CommentThread[]): string {
    const storedThreads = cloneCommentThreads(threads).map((thread) => toStoredThread(thread));
    const json = JSON.stringify(storedThreads, null, 2)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e");

    return [
        HIDDEN_SECTION_OPEN,
        json,
        HIDDEN_SECTION_CLOSE,
    ].join("\n");
}

function fromStoredThreadEntry(candidate: unknown): CommentThreadEntry | null {
    if (!candidate || typeof candidate !== "object") {
        return null;
    }

    const item = candidate as Partial<StoredNoteCommentThreadEntry>;
    if (
        typeof item.id !== "string"
        || typeof item.body !== "string"
        || typeof item.timestamp !== "number"
    ) {
        return null;
    }

    return {
        id: item.id,
        body: normalizeCommentBody(item.body),
        timestamp: item.timestamp,
    };
}

function fromStoredThread(candidate: unknown, filePath: string): CommentThread | null {
    if (!candidate || typeof candidate !== "object") {
        return null;
    }

    const item = candidate as Partial<StoredNoteCommentThread>;
    if (
        typeof item.id !== "string"
        || typeof item.startLine !== "number"
        || typeof item.startChar !== "number"
        || typeof item.endLine !== "number"
        || typeof item.endChar !== "number"
        || typeof item.selectedText !== "string"
        || typeof item.selectedTextHash !== "string"
        || !Array.isArray(item.entries)
        || item.entries.length === 0
        || typeof item.createdAt !== "number"
        || typeof item.updatedAt !== "number"
    ) {
        return null;
    }

    const entries = item.entries
        .map((entry) => fromStoredThreadEntry(entry))
        .filter((entry): entry is CommentThreadEntry => entry !== null);
    if (entries.length === 0) {
        return null;
    }

    return normalizeThread({
        id: item.id,
        filePath,
        startLine: item.startLine,
        startChar: item.startChar,
        endLine: item.endLine,
        endChar: item.endChar,
        selectedText: item.selectedText,
        selectedTextHash: item.selectedTextHash,
        anchorKind: item.anchorKind === "page" ? "page" : "selection",
        orphaned: item.orphaned === true,
        resolved: item.resolved === true,
        entries,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    });
}

function parseHiddenSectionJson(sectionContent: string): string | null {
    if (!sectionContent.startsWith(HIDDEN_SECTION_OPEN)) {
        return null;
    }

    const closeMarker = `\n${HIDDEN_SECTION_CLOSE}`;
    if (!sectionContent.endsWith(closeMarker)) {
        return null;
    }

    const bodyWithPrefix = sectionContent.slice(HIDDEN_SECTION_OPEN.length, -closeMarker.length);
    const jsonText = bodyWithPrefix.replace(/^[ \t]*\n?/, "").trim();
    return jsonText.length ? jsonText : null;
}

function parseManagedSectionJson(sectionContent: string): unknown[] | null {
    const jsonText = parseHiddenSectionJson(sectionContent.trim());
    if (jsonText === null) {
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(jsonText);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function parseJsonSection(sectionContent: string, filePath: string): CommentThread[] | null {
    const parsed = parseManagedSectionJson(sectionContent);
    if (parsed === null) {
        return null;
    }

    const threads: CommentThread[] = [];
    for (const item of parsed) {
        const thread = fromStoredThread(item, filePath);
        if (!thread) {
            return null;
        }

        threads.push(thread);
    }

    return cloneCommentThreads(threads);
}

function buildFencedCodeBlockRanges(normalized: string): OffsetRange[] {
    const ranges: OffsetRange[] = [];
    const lines = normalized.split("\n");
    let currentOffset = 0;
    let openFence: { char: string; length: number; fromOffset: number } | null = null;

    for (const line of lines) {
        const fenceMatch = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
        if (fenceMatch) {
            const fenceToken = fenceMatch[1];
            const fenceChar = fenceToken[0];

            if (!openFence) {
                openFence = {
                    char: fenceChar,
                    length: fenceToken.length,
                    fromOffset: currentOffset,
                };
            } else if (openFence.char === fenceChar && fenceToken.length >= openFence.length) {
                ranges.push({
                    fromOffset: openFence.fromOffset,
                    toOffset: currentOffset + line.length,
                });
                openFence = null;
            }
        }

        currentOffset += line.length + 1;
    }

    if (openFence) {
        ranges.push({
            fromOffset: openFence.fromOffset,
            toOffset: normalized.length,
        });
    }

    return ranges;
}

function isOffsetInsideRanges(offset: number, ranges: readonly OffsetRange[]): boolean {
    return ranges.some((range) => offset >= range.fromOffset && offset <= range.toOffset);
}

function hasInlineCloseMarkerOnSameLine(normalized: string, sectionStart: number): boolean {
    const lineEnd = normalized.indexOf("\n", sectionStart);
    const openerLine = lineEnd === -1
        ? normalized.slice(sectionStart)
        : normalized.slice(sectionStart, lineEnd);
    return openerLine.includes(HIDDEN_SECTION_CLOSE);
}

function findLastManagedSection(normalized: string): FoundManagedSection | null {
    const matches = Array.from(normalized.matchAll(/<!-- SideNote2 comments(?=$|[\s[{])/g));
    const fencedCodeBlockRanges = buildFencedCodeBlockRanges(normalized);
    for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        if (typeof match.index !== "number") {
            continue;
        }

        const sectionStart = match.index;
        if (isOffsetInsideRanges(sectionStart, fencedCodeBlockRanges)) {
            continue;
        }
        if (hasInlineCloseMarkerOnSameLine(normalized, sectionStart)) {
            continue;
        }
        const closeIndex = normalized.indexOf(`\n${HIDDEN_SECTION_CLOSE}`, sectionStart);
        if (closeIndex === -1) {
            continue;
        }

        const blockEnd = closeIndex + `\n${HIDDEN_SECTION_CLOSE}`.length;
        const sectionContent = normalized.slice(sectionStart, blockEnd).trim();
        const mainPrefix = normalized.slice(0, sectionStart).trimEnd();
        const trailingContent = normalized.slice(blockEnd);
        const hasVisibleContentAfterSection = trailingContent.trim().length > 0;
        const mainContent = `${mainPrefix}${hasVisibleContentAfterSection ? trailingContent : ""}`.trimEnd();

        return {
            normalizedContent: normalized,
            mainContent,
            sectionContent,
            sectionFromOffset: mainPrefix.length,
            sectionToOffset: hasVisibleContentAfterSection ? blockEnd : normalized.length,
            hasVisibleContentAfterSection,
        };
    }

    return null;
}

function findManagedSection(normalized: string): SplitManagedSectionResult | null {
    const section = findLastManagedSection(normalized);
    if (!section) {
        return null;
    }

    if (parseJsonSection(section.sectionContent, "__probe__") === null) {
        return null;
    }

    return section;
}

export function parseNoteComments(noteContent: string, filePath: string): ParsedNoteComments {
    const { mainContent, sectionContent } = splitManagedSection(noteContent);
    const threads = sectionContent
        ? parseJsonSection(sectionContent, filePath) ?? []
        : [];

    return {
        mainContent,
        threads,
        comments: threads.map((thread) => threadToComment(thread)),
    };
}

export function getManagedSectionKind(noteContent: string): ManagedSectionKind {
    const normalized = noteContent.replace(/\r\n/g, "\n");
    const section = findLastManagedSection(normalized);
    if (!section) {
        return "none";
    }

    return parseJsonSection(section.sectionContent, "__probe__") === null
        ? "unsupported"
        : "threaded";
}

function assertWritableManagedSection(noteContent: string, threadCount: number): void {
    if (threadCount === 0) {
        return;
    }

    if (getManagedSectionKind(noteContent) === "unsupported") {
        throw new Error(
            "Found an unsupported SideNote2 comments block. Rewrite the note to the threaded `entries[]` format before saving comments.",
        );
    }
}

export function getManagedSectionRange(noteContent: string): ManagedSectionRange | null {
    const { normalizedContent, sectionContent, sectionFromOffset, sectionToOffset } = splitManagedSection(noteContent);
    if (!sectionContent) {
        return null;
    }

    const sectionText = normalizedContent.slice(sectionFromOffset, sectionToOffset);
    const leadingWhitespaceLength = sectionText.length - sectionText.trimStart().length;

    return {
        fromOffset: sectionFromOffset + leadingWhitespaceLength,
        toOffset: sectionToOffset,
    };
}

export function getManagedSectionStartLine(noteContent: string): number | null {
    return getManagedSectionLineRange(noteContent)?.startLine ?? null;
}

export function getVisibleNoteContent(noteContent: string): string {
    const normalized = noteContent.replace(/\r\n/g, "\n");
    const range = getManagedSectionRange(normalized);
    if (!range) {
        return normalized;
    }

    return normalized.slice(0, range.fromOffset) + normalized.slice(range.toOffset);
}

export function getManagedSectionLineRange(noteContent: string): ManagedSectionLineRange | null {
    const normalized = noteContent.replace(/\r\n/g, "\n");
    const range = getManagedSectionRange(normalized);
    if (!range) {
        return null;
    }

    const beforeSection = normalized.slice(0, range.fromOffset);
    const sectionText = normalized.slice(range.fromOffset, range.toOffset);
    const startLine = beforeSection.match(/\n/g)?.length ?? 0;
    const sectionLineCount = sectionText.match(/\n/g)?.length ?? 0;

    return {
        startLine,
        endLine: startLine + sectionLineCount,
    };
}

export function serializeNoteCommentThreads(noteContent: string, threads: CommentThread[]): string {
    assertWritableManagedSection(noteContent, threads.length);
    const { mainContent } = splitManagedSection(noteContent);
    const normalizedMain = mainContent.trimEnd();

    if (!threads.length) {
        return normalizedMain.length ? `${normalizedMain}\n` : "";
    }

    const section = buildManagedSection(threads);
    return normalizedMain.length ? `${normalizedMain}\n\n${section}\n` : `\n${section}\n`;
}

export function serializeNoteComments(noteContent: string, comments: Comment[]): string {
    const threads: CommentThread[] = comments.map((comment) => ({
        id: comment.id,
        filePath: comment.filePath,
        startLine: comment.startLine,
        startChar: comment.startChar,
        endLine: comment.endLine,
        endChar: comment.endChar,
        selectedText: comment.selectedText,
        selectedTextHash: comment.selectedTextHash,
        anchorKind: comment.anchorKind === "page" ? "page" : "selection",
        orphaned: comment.orphaned === true,
        resolved: comment.resolved === true,
        entries: [{
            id: comment.id,
            body: comment.comment,
            timestamp: comment.timestamp,
        }],
        createdAt: comment.timestamp,
        updatedAt: comment.timestamp,
    }));

    return serializeNoteCommentThreads(noteContent, threads);
}

export function getManagedSectionEditForThreads(noteContent: string, threads: CommentThread[]): ManagedSectionEdit {
    assertWritableManagedSection(noteContent, threads.length);
    const {
        normalizedContent,
        sectionContent,
        sectionFromOffset,
        sectionToOffset,
        hasVisibleContentAfterSection,
    } = splitManagedSection(noteContent);

    if (sectionContent && hasVisibleContentAfterSection) {
        const nextContent = serializeNoteCommentThreads(noteContent, threads);
        return {
            fromOffset: sectionFromOffset,
            toOffset: normalizedContent.length,
            replacement: nextContent.slice(sectionFromOffset),
        };
    }

    if (!threads.length) {
        return {
            fromOffset: sectionFromOffset,
            toOffset: sectionToOffset,
            replacement: sectionFromOffset > 0 ? "\n" : "",
        };
    }

    const section = buildManagedSection(threads);
    return {
        fromOffset: sectionFromOffset,
        toOffset: sectionToOffset,
        replacement: sectionFromOffset > 0 ? `\n\n${section}\n` : `\n${section}\n`,
    };
}

export function getManagedSectionEdit(noteContent: string, comments: Comment[]): ManagedSectionEdit {
    const threads: CommentThread[] = comments.map((comment) => ({
        id: comment.id,
        filePath: comment.filePath,
        startLine: comment.startLine,
        startChar: comment.startChar,
        endLine: comment.endLine,
        endChar: comment.endChar,
        selectedText: comment.selectedText,
        selectedTextHash: comment.selectedTextHash,
        anchorKind: comment.anchorKind === "page" ? "page" : "selection",
        orphaned: comment.orphaned === true,
        resolved: comment.resolved === true,
        entries: [{
            id: comment.id,
            body: comment.comment,
            timestamp: comment.timestamp,
        }],
        createdAt: comment.timestamp,
        updatedAt: comment.timestamp,
    }));

    return getManagedSectionEditForThreads(noteContent, threads);
}

export function replaceNoteCommentBodyById(
    noteContent: string,
    filePath: string,
    commentId: string,
    nextCommentBody: string,
): string | null {
    const parsed = parseNoteComments(noteContent, filePath);
    let found = false;
    const normalizedBody = normalizeCommentBody(nextCommentBody);

    const updatedThreads = parsed.threads.map((thread) => {
        if (thread.id === commentId) {
            found = true;
            const entries = thread.entries.slice();
            const latestEntry = entries[entries.length - 1];
            if (latestEntry) {
                latestEntry.body = normalizedBody;
            }
            return {
                ...thread,
                entries,
            };
        }

        const matchingEntryIndex = thread.entries.findIndex((entry) => entry.id === commentId);
        if (matchingEntryIndex === -1) {
            return thread;
        }

        found = true;
        const entries = thread.entries.slice();
        entries[matchingEntryIndex] = {
            ...entries[matchingEntryIndex],
            body: normalizedBody,
        };

        return {
            ...thread,
            entries,
        };
    });

    if (!found) {
        return null;
    }

    return serializeNoteCommentThreads(noteContent, updatedThreads);
}

export function appendNoteCommentEntryById(
    noteContent: string,
    filePath: string,
    commentId: string,
    nextEntry: CommentThreadEntry,
): string | null {
    const parsed = parseNoteComments(noteContent, filePath);
    let found = false;
    const normalizedEntry = cloneThreadEntry(nextEntry);

    const updatedThreads = parsed.threads.map((thread) => {
        const matchesThread = thread.id === commentId
            || thread.entries.some((entry) => entry.id === commentId);
        if (!matchesThread) {
            return thread;
        }

        found = true;
        const entries = thread.entries.slice();
        entries.push(normalizedEntry);

        return {
            ...thread,
            entries,
            updatedAt: Math.max(thread.updatedAt, normalizedEntry.timestamp),
        };
    });

    if (!found) {
        return null;
    }

    return serializeNoteCommentThreads(noteContent, updatedThreads);
}

export function setNoteCommentResolvedById(
    noteContent: string,
    filePath: string,
    commentId: string,
    nextResolved: boolean,
): string | null {
    const parsed = parseNoteComments(noteContent, filePath);
    let found = false;

    const updatedThreads = parsed.threads.map((thread) => {
        const matchesThread = thread.id === commentId
            || thread.entries.some((entry) => entry.id === commentId);
        if (!matchesThread) {
            return thread;
        }

        found = true;
        return {
            ...thread,
            resolved: nextResolved,
        };
    });

    if (!found) {
        return null;
    }

    return serializeNoteCommentThreads(noteContent, updatedThreads);
}

export function resolveNoteCommentById(
    noteContent: string,
    filePath: string,
    commentId: string,
): string | null {
    return setNoteCommentResolvedById(noteContent, filePath, commentId, true);
}
