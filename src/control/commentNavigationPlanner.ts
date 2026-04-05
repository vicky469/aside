export interface PreferredFileLeafCandidate<T> {
    value: T;
    filePath: string | null;
    eligible: boolean;
    active: boolean;
    recent: boolean;
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
