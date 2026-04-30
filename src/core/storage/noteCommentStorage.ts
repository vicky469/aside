import type { Comment, CommentThread, CommentThreadEntry } from "../../commentManager";
import { cloneCommentThreads, threadToComment } from "../../commentManager";
import { splitTrailingSideNoteReferenceSection } from "../text/commentReferences";
import {
    normalizeDeletedAt,
    purgeExpiredDeletedThreads,
} from "../rules/deletedCommentVisibility";

const HIDDEN_SECTION_OPEN = "<!-- SideNote2 comments";
const HIDDEN_SECTION_CLOSE = "-->";

interface StoredNoteCommentThreadEntry {
    id: string;
    body: string;
    timestamp: number;
    deletedAt?: number;
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
    isPinned?: boolean;
    resolved?: boolean;
    deletedAt?: number;
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
export type ManagedSectionProblem = "multiple" | "invalid";

interface ManagedSectionAnalysis {
    normalizedContent: string;
    kind: ManagedSectionKind;
    problem: ManagedSectionProblem | null;
    section: FoundManagedSection | null;
}

function normalizeCommentBody(body: string): string {
    const normalized = body.replace(/\r\n/g, "\n").replace(/\n+$/, "");
    return splitTrailingSideNoteReferenceSection(normalized).body;
}

function cloneThreadEntry(entry: CommentThreadEntry): CommentThreadEntry {
    const deletedAt = normalizeDeletedAt(entry.deletedAt);
    return {
        id: entry.id,
        body: normalizeCommentBody(entry.body),
        timestamp: entry.timestamp,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
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
        isPinned: thread.isPinned === true,
        resolved: thread.resolved === true,
        deletedAt: normalizeDeletedAt(thread.deletedAt),
        entries,
        createdAt: thread.createdAt || firstEntry?.timestamp || 0,
        updatedAt: thread.updatedAt || latestEntry?.timestamp || thread.createdAt || 0,
    };
}

function splitManagedSection(noteContent: string): SplitManagedSectionResult {
    const analysis = analyzeManagedSection(noteContent);
    if (analysis.section) {
        return analysis.section;
    }

    return buildEmptyManagedSectionResult(analysis.normalizedContent);
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
    const deletedAt = normalizeDeletedAt(entry.deletedAt);
    return {
        id: entry.id,
        body: normalizeCommentBody(entry.body),
        timestamp: entry.timestamp,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
    };
}

function toStoredThread(thread: CommentThread): StoredNoteCommentThread {
    const normalized = normalizeThread(thread);
    const deletedAt = normalizeDeletedAt(normalized.deletedAt);
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
        isPinned: normalized.isPinned === true ? true : undefined,
        resolved: normalized.resolved === true ? true : undefined,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
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

    const deletedAt = normalizeDeletedAt(item.deletedAt);
    return {
        id: item.id,
        body: normalizeCommentBody(item.body),
        timestamp: item.timestamp,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
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
        isPinned: item.isPinned === true,
        resolved: item.resolved === true,
        deletedAt: normalizeDeletedAt(item.deletedAt),
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseManagedSectionJson(sectionContent: string): unknown[] | null {
    const jsonText = parseHiddenSectionJson(sectionContent.trim());
    if (jsonText === null) {
        return null;
    }

    try {
		const parsed: unknown = JSON.parse(jsonText);
		if (Array.isArray(parsed)) {
			const threads: unknown[] = parsed;
			return threads;
		}

		if (isRecord(parsed) && parsed.schemaVersion === 1 && Array.isArray(parsed.threads)) {
			const threads: unknown[] = parsed.threads;
			return threads;
		}

        return null;
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

function buildEmptyManagedSectionResult(normalizedContent: string): SplitManagedSectionResult {
    return {
        normalizedContent,
        mainContent: normalizedContent.trimEnd(),
        sectionContent: null,
        sectionFromOffset: normalizedContent.trimEnd().length,
        sectionToOffset: normalizedContent.length,
        hasVisibleContentAfterSection: false,
    };
}

function findManagedSectionStarts(normalized: string): number[] {
    const matches = Array.from(normalized.matchAll(/<!-- SideNote2 comments(?=$|[\s[{])/g));
    const fencedCodeBlockRanges = buildFencedCodeBlockRanges(normalized);
    const starts: number[] = [];
    for (const match of matches) {
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

        starts.push(sectionStart);
    }

    return starts;
}

function findLastManagedSection(normalized: string, sectionStarts: readonly number[]): FoundManagedSection | null {
    for (let index = sectionStarts.length - 1; index >= 0; index -= 1) {
        const sectionStart = sectionStarts[index];
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

function analyzeNormalizedManagedSection(normalized: string): ManagedSectionAnalysis {
    const sectionStarts = findManagedSectionStarts(normalized);
    if (sectionStarts.length > 1) {
        return {
            normalizedContent: normalized,
            kind: "unsupported",
            problem: "multiple",
            section: null,
        };
    }

    const section = findLastManagedSection(normalized, sectionStarts);
    if (!section) {
        return {
            normalizedContent: normalized,
            kind: "none",
            problem: null,
            section: null,
        };
    }

    if (parseJsonSection(section.sectionContent, "__probe__") === null) {
        return {
            normalizedContent: normalized,
            kind: "unsupported",
            problem: "invalid",
            section: null,
        };
    }

    return {
        normalizedContent: normalized,
        kind: "threaded",
        problem: null,
        section,
    };
}

function analyzeManagedSection(noteContent: string): ManagedSectionAnalysis {
    return analyzeNormalizedManagedSection(noteContent.replace(/\r\n/g, "\n"));
}

function getManagedSectionRangeFromAnalysis(analysis: ManagedSectionAnalysis): ManagedSectionRange | null {
    const section = analysis.section;
    if (!section) {
        return null;
    }

    const sectionText = analysis.normalizedContent.slice(section.sectionFromOffset, section.sectionToOffset);
    const leadingWhitespaceLength = sectionText.length - sectionText.trimStart().length;

    return {
        fromOffset: section.sectionFromOffset + leadingWhitespaceLength,
        toOffset: section.sectionToOffset,
    };
}

function getManagedSectionLineRangeFromAnalysis(analysis: ManagedSectionAnalysis): ManagedSectionLineRange | null {
    const range = getManagedSectionRangeFromAnalysis(analysis);
    if (!range) {
        return null;
    }

    const beforeSection = analysis.normalizedContent.slice(0, range.fromOffset);
    const sectionText = analysis.normalizedContent.slice(range.fromOffset, range.toOffset);
    const startLine = beforeSection.match(/\n/g)?.length ?? 0;
    const sectionLineCount = sectionText.match(/\n/g)?.length ?? 0;

    return {
        startLine,
        endLine: startLine + sectionLineCount,
    };
}

function getWritableManagedSectionAnalysis(noteContent: string, threadCount: number): ManagedSectionAnalysis {
    const analysis = analyzeManagedSection(noteContent);
    if (threadCount === 0) {
        return analysis;
    }

    if (analysis.problem === "multiple") {
        throw new Error(
            "Found multiple SideNote2 comments blocks in one markdown note. Collapse them to exactly one managed block before saving comments.",
        );
    }

    if (analysis.problem === "invalid") {
        throw new Error(
            "Found an unsupported SideNote2 comments block. Rewrite the note to the threaded `entries[]` format before saving comments.",
        );
    }

    return analysis;
}

export function parseNoteComments(noteContent: string, filePath: string): ParsedNoteComments {
    const { mainContent, sectionContent } = splitManagedSection(noteContent);
    const threads = sectionContent
        ? parseJsonSection(sectionContent, filePath) ?? []
        : [];
    const retainedThreads = purgeExpiredDeletedThreads(threads);

    return {
        mainContent,
        threads: retainedThreads,
        comments: retainedThreads.map((thread) => threadToComment(thread)),
    };
}

export function getManagedSectionKind(noteContent: string): ManagedSectionKind {
    return analyzeManagedSection(noteContent).kind;
}

export function getManagedSectionProblem(noteContent: string): ManagedSectionProblem | null {
    return analyzeManagedSection(noteContent).problem;
}

export function getManagedSectionRange(noteContent: string): ManagedSectionRange | null {
    return getManagedSectionRangeFromAnalysis(analyzeManagedSection(noteContent));
}

export function getManagedSectionStartLine(noteContent: string): number | null {
    return getManagedSectionLineRange(noteContent)?.startLine ?? null;
}

export function getVisibleNoteContent(noteContent: string): string {
    const analysis = analyzeManagedSection(noteContent);
    const range = getManagedSectionRangeFromAnalysis(analysis);
    if (!range) {
        return analysis.normalizedContent;
    }

    return analysis.normalizedContent.slice(0, range.fromOffset) + analysis.normalizedContent.slice(range.toOffset);
}

export function getManagedSectionLineRange(noteContent: string): ManagedSectionLineRange | null {
    return getManagedSectionLineRangeFromAnalysis(analyzeManagedSection(noteContent));
}

export function serializeNoteCommentThreads(noteContent: string, threads: CommentThread[]): string {
    const analysis = getWritableManagedSectionAnalysis(noteContent, threads.length);
    const normalizedMain = analysis.section
        ? analysis.section.mainContent.trimEnd()
        : analysis.normalizedContent.trimEnd();

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
        isPinned: comment.isPinned === true,
        resolved: comment.resolved === true,
        ...(normalizeDeletedAt(comment.deletedAt) !== undefined
            ? { deletedAt: normalizeDeletedAt(comment.deletedAt) }
            : {}),
        entries: [{
            id: comment.id,
            body: comment.comment,
            timestamp: comment.timestamp,
            ...(normalizeDeletedAt(comment.deletedAt) !== undefined
                ? { deletedAt: normalizeDeletedAt(comment.deletedAt) }
                : {}),
        }],
        createdAt: comment.timestamp,
        updatedAt: normalizeDeletedAt(comment.deletedAt) ?? comment.timestamp,
    }));

    return serializeNoteCommentThreads(noteContent, threads);
}

export function getManagedSectionEditForThreads(noteContent: string, threads: CommentThread[]): ManagedSectionEdit {
    const analysis = getWritableManagedSectionAnalysis(noteContent, threads.length);
    const {
        normalizedContent,
        sectionContent,
        sectionFromOffset,
        sectionToOffset,
        hasVisibleContentAfterSection,
    } = analysis.section ?? buildEmptyManagedSectionResult(analysis.normalizedContent);

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
