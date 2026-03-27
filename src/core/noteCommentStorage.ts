import type { Comment } from "../commentManager";

const HIDDEN_SECTION_OPEN = "<!-- SideNote2 comments";
const HIDDEN_SECTION_CLOSE = "-->";

interface StoredNoteComment {
    id: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    selectedTextHash: string;
    comment: string;
    timestamp: number;
    anchorKind?: "selection" | "page";
    orphaned?: boolean;
    resolved?: boolean;
}

export interface ParsedNoteComments {
    mainContent: string;
    comments: Comment[];
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

function normalizeCommentBody(body: string): string {
    return body.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

interface SplitManagedSectionResult {
    normalizedContent: string;
    mainContent: string;
    sectionContent: string | null;
    sectionFromOffset: number;
    sectionToOffset: number;
}

function splitManagedSection(noteContent: string): SplitManagedSectionResult {
    const normalized = noteContent.replace(/\r\n/g, "\n");
    const section = findTrailingManagedSection(normalized);
    if (section) {
        return section;
    }

    return {
        normalizedContent: normalized,
        mainContent: normalized.trimEnd(),
        sectionContent: null,
        sectionFromOffset: normalized.trimEnd().length,
        sectionToOffset: normalized.length,
    };
}

function buildManagedSection(comments: Comment[]): string {
    const storedComments = sortCommentsByPosition(comments).map((comment) => toStoredNoteComment(comment));
    const json = JSON.stringify(storedComments, null, 2)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e");

    return [
        HIDDEN_SECTION_OPEN,
        json,
        HIDDEN_SECTION_CLOSE,
    ].join("\n");
}

export function sortCommentsByPosition(comments: Comment[]): Comment[] {
    return comments.slice().sort((a, b) => {
        if (a.startLine !== b.startLine) {
            return a.startLine - b.startLine;
        }
        if (a.startChar !== b.startChar) {
            return a.startChar - b.startChar;
        }
        return a.timestamp - b.timestamp;
    });
}

function toStoredNoteComment(comment: Comment): StoredNoteComment {
    return {
        id: comment.id,
        startLine: comment.startLine,
        startChar: comment.startChar,
        endLine: comment.endLine,
        endChar: comment.endChar,
        selectedText: comment.selectedText,
        selectedTextHash: comment.selectedTextHash,
        comment: comment.comment,
        timestamp: comment.timestamp,
        anchorKind: comment.anchorKind === "page" ? "page" : undefined,
        orphaned: comment.orphaned === true ? true : undefined,
        resolved: comment.resolved === true ? true : undefined,
    };
}

function fromStoredNoteComment(candidate: unknown, filePath: string): Comment | null {
    if (!candidate || typeof candidate !== "object") {
        return null;
    }

    const item = candidate as Partial<StoredNoteComment>;
    if (
        typeof item.id !== "string" ||
        typeof item.startLine !== "number" ||
        typeof item.startChar !== "number" ||
        typeof item.endLine !== "number" ||
        typeof item.endChar !== "number" ||
        typeof item.selectedText !== "string" ||
        typeof item.selectedTextHash !== "string" ||
        typeof item.comment !== "string" ||
        typeof item.timestamp !== "number"
    ) {
        return null;
    }

    return {
        id: item.id,
        filePath,
        startLine: item.startLine,
        startChar: item.startChar,
        endLine: item.endLine,
        endChar: item.endChar,
        selectedText: item.selectedText,
        selectedTextHash: item.selectedTextHash,
        comment: normalizeCommentBody(item.comment),
        timestamp: item.timestamp,
        anchorKind: item.anchorKind === "page" ? "page" : undefined,
        orphaned: item.orphaned === true,
        resolved: item.resolved === true,
    };
}

function parseJsonSection(sectionContent: string, filePath: string): Comment[] | null {
    const normalized = sectionContent.trim();
    const jsonText = parseHiddenSectionJson(normalized);
    if (jsonText === null) {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return null;
    }

    const items = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { comments?: unknown[] }).comments)
            ? (parsed as { comments: unknown[] }).comments
            : null;

    if (!items) {
        return null;
    }

    const comments = items
        .map((item) => fromStoredNoteComment(item, filePath))
        .filter((comment): comment is Comment => comment !== null);

    return sortCommentsByPosition(comments);
}

function findTrailingManagedSection(normalized: string): SplitManagedSectionResult | null {
    const matches = Array.from(normalized.matchAll(/^<!-- SideNote2 comments(?=$|[ \t]|\[|\{)/gm));
    for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        if (typeof match.index !== "number") {
            continue;
        }

        const sectionStart = match.index;
        const mainContent = normalized.slice(0, sectionStart).trimEnd();
        const sectionContent = normalized.slice(sectionStart).trim();
        if (parseJsonSection(sectionContent, "__probe__") === null) {
            continue;
        }

        return {
            normalizedContent: normalized,
            mainContent,
            sectionContent,
            sectionFromOffset: mainContent.length,
            sectionToOffset: normalized.length,
        };
    }

    return null;
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

export function parseNoteComments(noteContent: string, filePath: string): ParsedNoteComments {
    const { mainContent, sectionContent } = splitManagedSection(noteContent);
    if (!sectionContent) {
        return {
            mainContent,
            comments: [],
        };
    }

    const comments = parseJsonSection(sectionContent, filePath) ?? [];

    return {
        mainContent,
        comments,
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

export function serializeNoteComments(noteContent: string, comments: Comment[]): string {
    const { mainContent } = splitManagedSection(noteContent);
    const normalizedMain = mainContent.trimEnd();

    if (!comments.length) {
        return normalizedMain.length ? `${normalizedMain}\n` : "";
    }

    const section = buildManagedSection(comments);

    return normalizedMain.length ? `${normalizedMain}\n\n${section}\n` : `${section}\n`;
}

export function getManagedSectionEdit(noteContent: string, comments: Comment[]): ManagedSectionEdit {
    const { sectionFromOffset, sectionToOffset } = splitManagedSection(noteContent);

    if (!comments.length) {
        return {
            fromOffset: sectionFromOffset,
            toOffset: sectionToOffset,
            replacement: sectionFromOffset > 0 ? "\n" : "",
        };
    }

    const section = buildManagedSection(comments);
    return {
        fromOffset: sectionFromOffset,
        toOffset: sectionToOffset,
        replacement: sectionFromOffset > 0 ? `\n\n${section}\n` : `${section}\n`,
    };
}

export function replaceNoteCommentBodyById(
    noteContent: string,
    filePath: string,
    commentId: string,
    nextCommentBody: string,
): string | null {
    const { comments } = parseNoteComments(noteContent, filePath);
    let found = false;

    const updatedComments = comments.map((comment) => {
        if (comment.id !== commentId) {
            return comment;
        }

        found = true;
        return {
            ...comment,
            comment: normalizeCommentBody(nextCommentBody),
        };
    });

    if (!found) {
        return null;
    }

    return serializeNoteComments(noteContent, updatedComments);
}
