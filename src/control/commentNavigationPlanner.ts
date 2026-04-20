export interface PreferredFileLeafCandidate<T> {
    value: T;
    filePath: string | null;
    eligible: boolean;
    active: boolean;
    recent: boolean;
}

export interface CommentRevealAnchorRange {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
}

export interface CommentRevealScrollTarget {
    from: {
        line: number;
        ch: number;
    };
    to: {
        line: number;
        ch: number;
    };
}

export function pickPinnedCommentableFile<T>(
    activeFile: T | null,
    activeSidebarFile: T | null,
    activeMarkdownFile: T | null,
    isCommentableFile: (file: T | null) => file is T,
): T | null {
    if (isCommentableFile(activeFile)) {
        return activeFile;
    }

    if (isCommentableFile(activeSidebarFile)) {
        return activeSidebarFile;
    }

    return activeMarkdownFile;
}

export function pickSidebarTargetFile<T>(
    activeFile: T | null,
    activeSidebarFile: T | null,
    isSidebarSupportedFile: (file: T | null) => file is T,
): T | null {
    if (isSidebarSupportedFile(activeFile)) {
        return activeFile;
    }

    if (activeFile) {
        return null;
    }

    return activeSidebarFile;
}

export function pickPreferredFileLeafCandidate<T>(
    candidates: PreferredFileLeafCandidate<T>[],
    filePath?: string,
): T | null {
    if (filePath) {
        const exactMatch = candidates.find((candidate) =>
            candidate.eligible && candidate.filePath === filePath,
        );
        if (exactMatch) {
            return exactMatch.value;
        }
    }

    const activeMatch = candidates.find((candidate) => candidate.eligible && candidate.active);
    if (activeMatch) {
        return activeMatch.value;
    }

    const recentMatch = candidates.find((candidate) => candidate.eligible && candidate.recent);
    if (recentMatch) {
        return recentMatch.value;
    }

    return candidates.find((candidate) => candidate.eligible)?.value ?? null;
}

export function shouldRevealSidebarLeaf(
    revealLeaf: boolean | undefined,
    createdLeaf: boolean,
): boolean {
    return createdLeaf || revealLeaf !== false;
}

export function resolveIndexSidebarScopeRootPath(
    sidebarFilePath: string | null,
    scopeRootFilePath: string | null,
    isAllCommentsNotePath: (filePath: string) => boolean,
): string | null {
    if (!sidebarFilePath || !scopeRootFilePath || !isAllCommentsNotePath(sidebarFilePath)) {
        return null;
    }

    return scopeRootFilePath;
}

export function buildCommentRevealScrollTarget(
    comment: CommentRevealAnchorRange,
    resolvedAnchor: CommentRevealAnchorRange | null = null,
): CommentRevealScrollTarget {
    const anchor = resolvedAnchor ?? comment;
    return {
        from: {
            line: anchor.startLine,
            ch: anchor.startChar,
        },
        to: {
            line: anchor.endLine,
            ch: anchor.endChar,
        },
    };
}
