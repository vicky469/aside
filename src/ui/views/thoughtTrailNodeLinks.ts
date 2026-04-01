export function extractThoughtTrailClickTargets(lines: string[]): Map<string, string> {
    const targets = new Map<string, string>();

    for (const line of lines) {
        const match = line.match(/^\s*click\s+(\S+)\s+href\s+"([^"]+)"/);
        if (!match) {
            continue;
        }

        const nodeId = match[1]?.trim();
        const url = match[2]?.trim();
        if (!(nodeId && url)) {
            continue;
        }

        targets.set(nodeId, url);
    }

    return targets;
}

export function resolveThoughtTrailNodeId(dataId: string | null | undefined, elementId: string | null | undefined): string | null {
    const normalizedDataId = dataId?.trim();
    if (normalizedDataId) {
        return normalizedDataId;
    }

    const normalizedElementId = elementId?.trim();
    if (!normalizedElementId) {
        return null;
    }

    const match = normalizedElementId.match(/(?:^|[-_])(n\d+)(?:[-_]\d+)?$/);
    return match?.[1] ?? null;
}

export function parseThoughtTrailOpenFilePath(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "obsidian:" || parsed.hostname !== "open") {
            return null;
        }

        const filePath = parsed.searchParams.get("file")?.trim();
        return filePath || null;
    } catch {
        return null;
    }
}
