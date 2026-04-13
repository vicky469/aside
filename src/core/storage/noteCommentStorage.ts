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

interface StoredLegacyNoteComment {
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
    comment: string;
    timestamp: number;
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

interface JsonManagedSectionResult {
    mainContent: string;
    items: unknown[];
}

type ManagedSectionItemKind = "legacy" | "threaded" | "unsupported";

export type LegacyNoteCommentMigrationPlan =
    | { kind: "no-managed-block"; filePath: string }
    | { kind: "threaded"; filePath: string }
    | { kind: "unsupported"; filePath: string }
    | {
        kind: "legacy";
        filePath: string;
        mainContent: string;
        nextContent: string;
        threadCount: number;
        threads: CommentThread[];
    };

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

function sortThreadsByPosition(threads: CommentThread[]): CommentThread[] {
    return cloneCommentThreads(threads).sort((left, right) => {
        if (left.startLine !== right.startLine) {
            return left.startLine - right.startLine;
        }
        if (left.startChar !== right.startChar) {
            return left.startChar - right.startChar;
        }
        return left.createdAt - right.createdAt;
    });
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
        const parsed = JSON.parse(jsonText);
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

    const threads = parsed
        .map((item) => fromStoredThread(item, filePath))
        .filter((thread): thread is CommentThread => thread !== null);

    return cloneCommentThreads(threads);
}

function findJsonManagedSection(noteContent: string): JsonManagedSectionResult | null {
    const normalized = noteContent.replace(/\r\n/g, "\n");
    const matches = Array.from(normalized.matchAll(/<!-- SideNote2 comments(?=$|[\s\[{])/g));
    for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        if (typeof match.index !== "number") {
            continue;
        }

        const sectionStart = match.index;
        const closeIndex = normalized.indexOf(`\n${HIDDEN_SECTION_CLOSE}`, sectionStart);
        if (closeIndex === -1) {
            continue;
        }

        const blockEnd = closeIndex + `\n${HIDDEN_SECTION_CLOSE}`.length;
        const sectionContent = normalized.slice(sectionStart, blockEnd).trim();
        const items = parseManagedSectionJson(sectionContent);
        if (items === null) {
            continue;
        }

        const mainPrefix = normalized.slice(0, sectionStart).trimEnd();
        const trailingContent = normalized.slice(blockEnd);
        const hasVisibleContentAfterSection = trailingContent.trim().length > 0;
        const mainContent = `${mainPrefix}${hasVisibleContentAfterSection ? trailingContent : ""}`.trimEnd();

        return {
            mainContent,
            items,
        };
    }

    return null;
}

function findManagedSection(normalized: string): SplitManagedSectionResult | null {
    const matches = Array.from(normalized.matchAll(/<!-- SideNote2 comments(?=$|[\s\[{])/g));
    for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        if (typeof match.index !== "number") {
            continue;
        }

        const sectionStart = match.index;
        const closeIndex = normalized.indexOf(`\n${HIDDEN_SECTION_CLOSE}`, sectionStart);
        if (closeIndex === -1) {
            continue;
        }

        const blockEnd = closeIndex + `\n${HIDDEN_SECTION_CLOSE}`.length;
        const sectionContent = normalized.slice(sectionStart, blockEnd).trim();
        if (parseJsonSection(sectionContent, "__probe__") === null) {
            continue;
        }

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

function fromLegacyStoredComment(candidate: unknown, filePath: string): CommentThread | null {
    if (!candidate || typeof candidate !== "object") {
        return null;
    }

    const item = candidate as Partial<StoredLegacyNoteComment> & {
        entries?: unknown;
        createdAt?: unknown;
        updatedAt?: unknown;
    };
    if (
        typeof item.id !== "string"
        || typeof item.startLine !== "number"
        || typeof item.startChar !== "number"
        || typeof item.endLine !== "number"
        || typeof item.endChar !== "number"
        || typeof item.selectedText !== "string"
        || typeof item.selectedTextHash !== "string"
        || typeof item.comment !== "string"
        || typeof item.timestamp !== "number"
    ) {
        return null;
    }

    if (
        item.entries !== undefined
        || item.createdAt !== undefined
        || item.updatedAt !== undefined
    ) {
        return null;
    }

    if (
        (item.anchorKind !== undefined && item.anchorKind !== "selection" && item.anchorKind !== "page")
        || (item.orphaned !== undefined && typeof item.orphaned !== "boolean")
        || (item.resolved !== undefined && typeof item.resolved !== "boolean")
    ) {
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
        orphaned: item.anchorKind === "page" ? false : item.orphaned === true,
        resolved: item.resolved === true,
        entries: [{
            id: item.id,
            body: normalizeCommentBody(item.comment),
            timestamp: item.timestamp,
        }],
        createdAt: item.timestamp,
        updatedAt: item.timestamp,
    });
}

function isStoredThreadEntryCandidate(candidate: unknown): boolean {
    if (!candidate || typeof candidate !== "object") {
        return false;
    }

    const item = candidate as Partial<StoredNoteCommentThreadEntry>;
    return (
        typeof item.id === "string"
        && typeof item.body === "string"
        && typeof item.timestamp === "number"
    );
}

function isThreadedStoredThreadCandidate(candidate: unknown): boolean {
    if (!candidate || typeof candidate !== "object") {
        return false;
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
        return false;
    }

    if (
        (item.anchorKind !== undefined && item.anchorKind !== "selection" && item.anchorKind !== "page")
        || (item.orphaned !== undefined && typeof item.orphaned !== "boolean")
        || (item.resolved !== undefined && typeof item.resolved !== "boolean")
    ) {
        return false;
    }

    return item.entries.every((entry) => isStoredThreadEntryCandidate(entry));
}

function classifyManagedSectionItems(items: unknown[]): ManagedSectionItemKind {
    if (items.length === 0) {
        return "threaded";
    }

    if (items.every((item) => fromLegacyStoredComment(item, "__probe__") !== null)) {
        return "legacy";
    }

    if (items.every((item) => isThreadedStoredThreadCandidate(item))) {
        return "threaded";
    }

    return "unsupported";
}

export function countManagedSections(noteContent: string): number {
    return (noteContent.match(/<!-- SideNote2 comments/g) || []).length;
}

function verifyMigratedNote(
    noteContent: string,
    filePath: string,
    expectedThreadCount: number,
    expectedMainContent: string,
): void {
    if (countManagedSections(noteContent) !== 1) {
        throw new Error("Migration would produce multiple managed comment blocks.");
    }

    if (getManagedSectionRange(noteContent) === null) {
        throw new Error("Migration output does not contain a valid threaded managed block.");
    }

    const parsed = parseNoteComments(noteContent, filePath);
    if (parsed.threads.length !== expectedThreadCount) {
        throw new Error(`Migration output parsed ${parsed.threads.length} threads, expected ${expectedThreadCount}.`);
    }

    if (parsed.mainContent !== expectedMainContent) {
        throw new Error("Migration output changed the visible note body unexpectedly.");
    }
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

export function buildLegacyNoteCommentMigrationPlan(
    noteContent: string,
    filePath: string,
): LegacyNoteCommentMigrationPlan {
    const section = findJsonManagedSection(noteContent);
    if (!section) {
        return {
            kind: "no-managed-block",
            filePath,
        };
    }

    const sectionKind = classifyManagedSectionItems(section.items);
    if (sectionKind === "threaded") {
        return {
            kind: "threaded",
            filePath,
        };
    }

    if (sectionKind === "unsupported") {
        return {
            kind: "unsupported",
            filePath,
        };
    }

    const threads = section.items
        .map((item) => fromLegacyStoredComment(item, filePath))
        .filter((thread): thread is CommentThread => thread !== null);
    const nextContent = serializeNoteCommentThreads(section.mainContent, threads);
    verifyMigratedNote(nextContent, filePath, threads.length, section.mainContent);

    return {
        kind: "legacy",
        filePath,
        mainContent: section.mainContent,
        nextContent,
        threadCount: threads.length,
        threads,
    };
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
