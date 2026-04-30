export interface SidebarFileInsertPosition {
    line: number;
    ch: number;
}

export interface SidebarFileInsertEdit {
    position: SidebarFileInsertPosition;
    text: string;
}

export function buildAppendToFileEndText(
    noteContent: string,
    blockMarkdown: string,
): string {
    const normalizedBlock = blockMarkdown.trim();
    if (!normalizedBlock) {
        return "";
    }

    if (!noteContent) {
        return normalizedBlock;
    }

    if (noteContent.endsWith("\n\n")) {
        return normalizedBlock;
    }

    return noteContent.endsWith("\n")
        ? `\n${normalizedBlock}`
        : `\n\n${normalizedBlock}`;
}

export function buildSidebarFileInsertEdit(
    noteContent: string,
    blockMarkdown: string,
    cursorLine: number | null,
): SidebarFileInsertEdit | null {
    const normalizedBlock = blockMarkdown.trim();
    if (!normalizedBlock) {
        return null;
    }

    const lines = noteContent.split("\n");
    if (cursorLine !== null && Number.isInteger(cursorLine) && cursorLine >= 0 && cursorLine < lines.length) {
        return {
            position: {
                line: cursorLine,
                ch: lines[cursorLine].length,
            },
            text: `\n${normalizedBlock}`,
        };
    }

    const lastLine = lines.length - 1;
    return {
        position: {
            line: lastLine,
            ch: lines[lastLine].length,
        },
        text: buildAppendToFileEndText(noteContent, normalizedBlock),
    };
}

export function getSingleOpenFileInsertTarget<T>(targets: readonly T[]): T | null {
    return targets.length === 1 ? targets[0] : null;
}
