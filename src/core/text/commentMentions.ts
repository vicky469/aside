import type { LinkCache, Pos } from "obsidian";
import type { Comment, CommentThread } from "../../commentManager";

export interface ExtractedWikiLink {
    linkPath: string;
    original: string;
    displayText?: string;
}

export interface DerivedCommentLinks {
    links: LinkCache[];
    resolved: Record<string, number>;
    unresolved: Record<string, number>;
}

function isThreadLike(value: Comment | CommentThread): value is CommentThread {
    return Array.isArray((value as CommentThread).entries);
}

function getCommentBodies(value: Comment | CommentThread): string[] {
    if (isThreadLike(value)) {
        return value.entries.map((entry) => entry.body ?? "");
    }

    return [value.comment ?? ""];
}

export function extractWikiLinks(value: string): ExtractedWikiLink[] {
    const matches: ExtractedWikiLink[] = [];

    for (let index = 0; index < value.length - 1; index += 1) {
        if (value[index] !== "[" || value[index + 1] !== "[") {
            continue;
        }

        if (index > 0 && value[index - 1] === "!") {
            continue;
        }

        const closeIndex = value.indexOf("]]", index + 2);
        if (closeIndex === -1) {
            break;
        }

        const original = value.slice(index, closeIndex + 2);
        const rawTarget = value.slice(index + 2, closeIndex);
        if (!rawTarget.includes("\n")) {
            const [targetPart, displayPart] = rawTarget.split("|");
            const linkPath = targetPart?.split("#")[0]?.trim() ?? "";
            if (linkPath) {
                const displayText = displayPart?.trim();
                matches.push(displayText
                    ? { linkPath, original, displayText }
                    : { linkPath, original });
            }
        }

        index = closeIndex + 1;
    }

    return matches;
}

export function extractWikiLinkPaths(value: string): string[] {
    return extractWikiLinks(value).map((match) => match.linkPath);
}

export function buildDerivedCommentLinks(
    comments: Array<Comment | CommentThread>,
    noteContent: string,
    resolveLinkPath: (linkPath: string, sourcePath: string) => string | null,
): DerivedCommentLinks {
    const lineStartOffsets = buildLineStartOffsets(noteContent);
    const lineLengths = getLineLengths(noteContent);
    const links: LinkCache[] = [];
    const resolved: Record<string, number> = {};
    const unresolved: Record<string, number> = {};

    for (const comment of comments) {
        const seenTargets = new Set<string>();
        for (const body of getCommentBodies(comment)) {
            for (const match of extractWikiLinks(body)) {
                const resolvedPath = resolveLinkPath(match.linkPath, comment.filePath);
                if (resolvedPath === comment.filePath) {
                    continue;
                }

                const dedupeKey = resolvedPath ?? `unresolved:${match.linkPath}`;
                if (seenTargets.has(dedupeKey)) {
                    continue;
                }

                seenTargets.add(dedupeKey);
                links.push(createSyntheticLinkCache(comment, match, lineStartOffsets, lineLengths));

                if (resolvedPath) {
                    resolved[resolvedPath] = (resolved[resolvedPath] ?? 0) + 1;
                } else {
                    unresolved[match.linkPath] = (unresolved[match.linkPath] ?? 0) + 1;
                }
            }
        }
    }

    return { links, resolved, unresolved };
}

function buildLineStartOffsets(noteContent: string): number[] {
    const offsets = [0];

    for (let index = 0; index < noteContent.length; index += 1) {
        if (noteContent[index] === "\n") {
            offsets.push(index + 1);
        }
    }

    return offsets;
}

function getLineLengths(noteContent: string): number[] {
    const lines = noteContent.split("\n");
    return lines.length > 0 ? lines.map((line) => line.length) : [0];
}

function createSyntheticLinkCache(
    comment: Pick<Comment, "startLine" | "startChar">,
    match: ExtractedWikiLink,
    lineStartOffsets: number[],
    lineLengths: number[],
): LinkCache {
    const position = buildSyntheticPosition(comment, match.original.length, lineStartOffsets, lineLengths);
    return match.displayText
        ? {
            position,
            link: match.linkPath,
            original: match.original,
            displayText: match.displayText,
        }
        : {
            position,
            link: match.linkPath,
            original: match.original,
        };
}

function buildSyntheticPosition(
    comment: Pick<Comment, "startLine" | "startChar">,
    originalLength: number,
    lineStartOffsets: number[],
    lineLengths: number[],
): Pos {
    const lastLineIndex = Math.max(lineLengths.length - 1, 0);
    const line = clamp(comment.startLine, 0, lastLineIndex);
    const lineLength = lineLengths[line] ?? 0;
    const startCol = clamp(comment.startChar, 0, lineLength);
    const maxSpan = Math.max(lineLength - startCol, 1);
    const span = clamp(originalLength, 1, maxSpan);
    const lineStartOffset = lineStartOffsets[line] ?? 0;

    return {
        start: {
            line,
            col: startCol,
            offset: lineStartOffset + startCol,
        },
        end: {
            line,
            col: startCol + span,
            offset: lineStartOffset + startCol + span,
        },
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
