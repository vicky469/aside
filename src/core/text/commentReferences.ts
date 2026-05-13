export const SIDE_NOTE_REFERENCE_PROTOCOL = "aside-comment";
export const LEGACY_SIDE_NOTE_REFERENCE_PROTOCOL = "side-note2-comment";

export interface SideNoteReferenceTarget {
    vaultName: string | null;
    filePath: string | null;
    commentId: string;
}

export interface ExtractedSideNoteReference {
    index: number;
    label: string;
    length: number;
    target: SideNoteReferenceTarget;
    url: string;
}

export interface RawSideNoteReferenceMatch {
    index: number;
    length: number;
    target: SideNoteReferenceTarget;
    url: string;
}

export interface TrailingSideNoteReferenceSection {
    body: string;
    references: ExtractedSideNoteReference[];
}

export interface SideNoteReferenceTextEdit {
    value: string;
    selectionStart: number;
    selectionEnd: number;
}

// Stored note content still uses the legacy header for backward compatibility.
export const SIDE_NOTE_REFERENCE_SECTION_HEADER = "Mentioned:";

const SIDE_NOTE_REFERENCE_PROTOCOL_PATTERN = `(?:${SIDE_NOTE_REFERENCE_PROTOCOL}|${LEGACY_SIDE_NOTE_REFERENCE_PROTOCOL})`;
const MARKDOWN_LINK_PATTERN = new RegExp(
    String.raw`\[([^\]]*)\]\((obsidian:\/\/${SIDE_NOTE_REFERENCE_PROTOCOL_PATTERN}\?[^)\s]+)\)`,
    "g",
);
const RAW_URL_PATTERN = new RegExp(
    String.raw`obsidian:\/\/${SIDE_NOTE_REFERENCE_PROTOCOL_PATTERN}\?[^)\]\s]+`,
    "g",
);

export function parseSideNoteReferenceUrl(url: string): SideNoteReferenceTarget | null {
    try {
        const parsed = new URL(url);
        if (
            parsed.protocol !== "obsidian:"
            || (
                parsed.hostname !== SIDE_NOTE_REFERENCE_PROTOCOL
                && parsed.hostname !== LEGACY_SIDE_NOTE_REFERENCE_PROTOCOL
            )
        ) {
            return null;
        }

        const commentId = parsed.searchParams.get("commentId")?.trim();
        if (!commentId) {
            return null;
        }

        const rawVaultName = parsed.searchParams.get("vault")?.trim();
        const rawFilePath = parsed.searchParams.get("file")?.trim();
        return {
            vaultName: rawVaultName || null,
            filePath: rawFilePath || null,
            commentId,
        };
    } catch {
        return null;
    }
}

export function isLocalSideNoteReferenceTarget(
    target: SideNoteReferenceTarget,
    localVaultName?: string | null,
): boolean {
    if (!localVaultName) {
        return true;
    }

    return !target.vaultName || target.vaultName === localVaultName;
}

export function buildSideNoteReferenceUrl(
    vaultName: string,
    target: Pick<SideNoteReferenceTarget, "commentId" | "filePath">,
): string {
    return `obsidian://${SIDE_NOTE_REFERENCE_PROTOCOL}?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(target.filePath ?? "")}&commentId=${encodeURIComponent(target.commentId)}`;
}

function normalizeSideNoteReferenceLabel(label: string): string {
    const normalized = label
        .replace(/\s+/g, " ")
        .replace(/\[/g, "(")
        .replace(/\]/g, ")")
        .trim();

    return normalized || "Side note";
}

export function buildSideNoteReferenceMarkdown(url: string, label: string): string {
    return `[${normalizeSideNoteReferenceLabel(label)}](${url})`;
}

export function appendSideNoteReference(
    value: string,
    markdown: string,
): SideNoteReferenceTextEdit {
    const bullet = `- ${markdown}`;
    const referenceHeaderIndex = value.indexOf(SIDE_NOTE_REFERENCE_SECTION_HEADER);
    if (referenceHeaderIndex !== -1) {
        const lines = value.split("\n");
        const headerLineIndex = lines.findIndex((line) => line.trim() === SIDE_NOTE_REFERENCE_SECTION_HEADER);
        if (headerLineIndex !== -1) {
            let insertLineIndex = headerLineIndex + 1;
            while (
                insertLineIndex < lines.length
                && (lines[insertLineIndex].trim() === "" || lines[insertLineIndex].startsWith("- "))
            ) {
                insertLineIndex += 1;
            }
            lines.splice(insertLineIndex, 0, bullet);
            const nextValue = lines.join("\n");
            const insertedPrefixLength = lines
                .slice(0, insertLineIndex + 1)
                .join("\n")
                .length;
            return {
                value: nextValue,
                selectionStart: insertedPrefixLength,
                selectionEnd: insertedPrefixLength,
            };
        }
    }

    const trimmedValue = value.replace(/\s+$/, "");
    const nextValue = trimmedValue
        ? `${trimmedValue}\n\n${SIDE_NOTE_REFERENCE_SECTION_HEADER}\n${bullet}`
        : `${SIDE_NOTE_REFERENCE_SECTION_HEADER}\n${bullet}`;
    return {
        value: nextValue,
        selectionStart: nextValue.length,
        selectionEnd: nextValue.length,
    };
}

export function extractSideNoteReferences(
    markdown: string,
    options: {
        localOnly?: boolean;
        localVaultName?: string | null;
    } = {},
): ExtractedSideNoteReference[] {
    const references: ExtractedSideNoteReference[] = [];
    const occupiedRanges: Array<{ start: number; end: number }> = [];

    for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
        const fullMatch = match[0];
        const label = match[1];
        const url = match[2];
        const index = match.index;
        if (!fullMatch || label == null || !url || index == null) {
            continue;
        }

        const target = parseSideNoteReferenceUrl(url);
        if (!target) {
            continue;
        }

        if (options.localOnly && !isLocalSideNoteReferenceTarget(target, options.localVaultName)) {
            continue;
        }

        references.push({
            index,
            label,
            length: fullMatch.length,
            target,
            url,
        });
        occupiedRanges.push({
            start: index,
            end: index + fullMatch.length,
        });
    }

    for (const match of markdown.matchAll(RAW_URL_PATTERN)) {
        const url = match[0];
        const index = match.index;
        if (!url || index == null) {
            continue;
        }

        const end = index + url.length;
        if (occupiedRanges.some((range) => index >= range.start && end <= range.end)) {
            continue;
        }

        const target = parseSideNoteReferenceUrl(url);
        if (!target) {
            continue;
        }

        if (options.localOnly && !isLocalSideNoteReferenceTarget(target, options.localVaultName)) {
            continue;
        }

        references.push({
            index,
            label: url,
            length: url.length,
            target,
            url,
        });
    }

    references.sort((left, right) => left.index - right.index);
    return references;
}

export function findRawSideNoteReferenceUrls(
    value: string,
    options: {
        localOnly?: boolean;
        localVaultName?: string | null;
    } = {},
): RawSideNoteReferenceMatch[] {
    const matches: RawSideNoteReferenceMatch[] = [];

    for (const match of value.matchAll(RAW_URL_PATTERN)) {
        const url = match[0];
        const index = match.index;
        if (!url || index == null) {
            continue;
        }

        const target = parseSideNoteReferenceUrl(url);
        if (!target) {
            continue;
        }

        if (options.localOnly && !isLocalSideNoteReferenceTarget(target, options.localVaultName)) {
            continue;
        }

        matches.push({
            index,
            length: url.length,
            target,
            url,
        });
    }

    return matches;
}

export function replaceRawSideNoteReferenceUrls(
    value: string,
    replacer: (match: RawSideNoteReferenceMatch) => string,
    options: {
        localOnly?: boolean;
        localVaultName?: string | null;
    } = {},
): string {
    const occupiedRanges: Array<{ start: number; end: number }> = [];
    for (const match of value.matchAll(MARKDOWN_LINK_PATTERN)) {
        const fullMatch = match[0];
        const index = match.index;
        if (!fullMatch || index == null) {
            continue;
        }

        occupiedRanges.push({
            start: index,
            end: index + fullMatch.length,
        });
    }

    const matches = findRawSideNoteReferenceUrls(value, options).filter((match) => {
        const end = match.index + match.length;
        return !occupiedRanges.some((range) => match.index >= range.start && end <= range.end);
    });
    if (!matches.length) {
        return value;
    }

    let result = "";
    let cursor = 0;
    for (const match of matches) {
        result += value.slice(cursor, match.index);
        result += replacer(match);
        cursor = match.index + match.length;
    }

    result += value.slice(cursor);
    return result;
}

export function splitTrailingSideNoteReferenceSection(
    markdown: string,
    options: {
        localOnly?: boolean;
        localVaultName?: string | null;
    } = {},
): TrailingSideNoteReferenceSection {
    if (!markdown) {
        return {
            body: markdown,
            references: [],
        };
    }

    const lines = markdown.split("\n");
    for (let headerLineIndex = lines.length - 1; headerLineIndex >= 0; headerLineIndex -= 1) {
        if (lines[headerLineIndex]?.trim() !== SIDE_NOTE_REFERENCE_SECTION_HEADER) {
            continue;
        }

        const references: ExtractedSideNoteReference[] = [];
        let validSection = true;
        for (const line of lines.slice(headerLineIndex + 1)) {
            if (!line.trim()) {
                continue;
            }

            const bulletMatch = line.match(/^\s*-\s+/);
            if (!bulletMatch) {
                validSection = false;
                break;
            }

            const bulletContent = line.slice(bulletMatch[0].length);
            const extractedReferences = extractSideNoteReferences(bulletContent, options);
            if (extractedReferences.length !== 1) {
                validSection = false;
                break;
            }

            const reference = extractedReferences[0];
            const prefix = bulletContent.slice(0, reference.index).trim();
            const suffix = bulletContent.slice(reference.index + reference.length).trim();
            if (prefix || suffix) {
                validSection = false;
                break;
            }

            references.push(reference);
        }

        if (!validSection || references.length === 0) {
            continue;
        }

        return {
            body: lines.slice(0, headerLineIndex).join("\n").replace(/\s+$/, ""),
            references,
        };
    }

    return {
        body: markdown,
        references: [],
    };
}
