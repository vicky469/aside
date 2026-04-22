import type { CommentThread } from "../../commentManager";
import { isPageComment } from "../anchors/commentAnchors";
import {
    extractSideNoteReferences,
    splitTrailingSideNoteReferenceSection,
    type ExtractedSideNoteReference,
} from "../text/commentReferences";
import { shortenBareUrlsInMarkdown, stripMarkdownLinksForPreview } from "../text/commentUrls";

export const DEFAULT_SIDE_NOTE_EXPORT_ROOT = "SideNote2/exports";
const THREAD_HEADING_MAX_LENGTH = 80;
const SIDE_NOTE_REFERENCE_URL_PATTERN = /obsidian:\/\/side-note2-comment\?/u;

export interface SideNoteMarkdownExportPath {
    exportRootPath: string;
    exportDirectoryPath: string;
    exportFilePath: string;
}

export interface SideNoteMarkdownExportOptions {
    filePath: string;
    threads: readonly CommentThread[];
    referenceThreads?: readonly CommentThread[];
    exportedAt?: number;
}

interface ExportedConnectedThread {
    entryBodies: string[];
    filePath: string;
}

interface ExportedEntry {
    connectedThreads: ExportedConnectedThread[];
    value: string;
}

function normalizeVaultPath(value: string): string {
    return value
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/")
        .replace(/^\/+|\/+$/g, "");
}

function normalizeInlineText(value: string): string {
    return stripMarkdownLinksForPreview(value)
        .replace(/\r\n/g, "\n")
        .replace(/\s+/g, " ")
        .trim();
}

function buildInlinePreview(value: string, maxLength: number = THREAD_HEADING_MAX_LENGTH): string {
    const normalized = normalizeInlineText(value);
    if (!normalized) {
        return "(blank note)";
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildFlatExportBaseName(filePath: string): string {
    const normalizedFilePath = normalizeVaultPath(filePath);
    const withoutExtension = normalizedFilePath.replace(/\.[^.]+$/u, "") || normalizedFilePath;
    const flattened = withoutExtension
        .split("/")
        .filter(Boolean)
        .join(" - ")
        .trim();

    return flattened || "Untitled";
}

function buildExportWikiLink(filePath: string): string {
    const normalizedFilePath = normalizeVaultPath(filePath);
    const fileName = normalizedFilePath.split("/").pop() ?? normalizedFilePath;
    if (!normalizedFilePath || normalizedFilePath === fileName) {
        return `[[${fileName}]]`;
    }

    return `[[${normalizedFilePath}|${fileName}]]`;
}

function getLeadingIndentWidth(line: string): number {
    return line.match(/^\s*/u)?.[0].length ?? 0;
}

function stripMentionedNoise(markdown: string): string {
    if (!markdown.trim()) {
        return markdown.trim();
    }

    const lines = markdown.split("\n");
    const kept: string[] = [];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const trimmed = line.trim();

        if (SIDE_NOTE_REFERENCE_URL_PATTERN.test(line)) {
            continue;
        }

        if (trimmed === "Mentioned:" || trimmed.startsWith("Mentioned: ")) {
            while (kept.length > 0 && !kept[kept.length - 1]?.trim()) {
                kept.pop();
            }

            index += 1;
            while (index < lines.length) {
                const nextLine = lines[index] ?? "";
                const nextTrimmed = nextLine.trim();
                if (!nextTrimmed || /^\s*-\s+/u.test(nextLine) || SIDE_NOTE_REFERENCE_URL_PATTERN.test(nextLine)) {
                    index += 1;
                    continue;
                }

                index -= 1;
                break;
            }
            continue;
        }

        if (trimmed.startsWith("- Mentioned:")) {
            while (kept.length > 0 && !kept[kept.length - 1]?.trim()) {
                kept.pop();
            }

            const headerIndentWidth = getLeadingIndentWidth(line);
            while (index + 1 < lines.length) {
                const nextLine = lines[index + 1] ?? "";
                const nextTrimmed = nextLine.trim();
                if (!nextTrimmed) {
                    index += 1;
                    continue;
                }

                if (getLeadingIndentWidth(nextLine) > headerIndentWidth) {
                    index += 1;
                    continue;
                }

                break;
            }
            continue;
        }

        kept.push(line);
    }

    return kept.join("\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}

function normalizeEntryMarkdown(body: string): string {
    const normalizedBody = stripMentionedNoise(
        splitTrailingSideNoteReferenceSection(body.replace(/\r\n/g, "\n")).body,
    );
    return shortenBareUrlsInMarkdown(normalizedBody).trim();
}

function collectThreadLookup(threads: readonly CommentThread[]): Map<string, CommentThread> {
    const lookup = new Map<string, CommentThread>();

    for (const thread of threads) {
        lookup.set(thread.id, thread);
        for (const entry of thread.entries) {
            lookup.set(entry.id, thread);
        }
    }

    return lookup;
}

function collectPlainExportedThreadEntries(thread: CommentThread): string[] {
    return thread.entries
        .map((entry) => normalizeEntryMarkdown(entry.body))
        .filter((entry) => Boolean(entry));
}

function collectConnectedThreads(
    references: readonly ExtractedSideNoteReference[],
    threadLookup: ReadonlyMap<string, CommentThread>,
    parentThreadId: string,
): ExportedConnectedThread[] {
    const connectedThreads: ExportedConnectedThread[] = [];
    const seenReferenceKeys = new Set<string>();

    for (const reference of references) {
        const resolvedThread = threadLookup.get(reference.target.commentId) ?? null;
        if (resolvedThread?.id === parentThreadId) {
            continue;
        }

        const filePath = normalizeVaultPath(reference.target.filePath ?? resolvedThread?.filePath ?? "");
        if (!filePath) {
            continue;
        }

        const referenceKey = resolvedThread?.id
            ? `thread:${resolvedThread.id}`
            : `target:${reference.target.commentId}:${filePath}`;
        if (seenReferenceKeys.has(referenceKey)) {
            continue;
        }
        seenReferenceKeys.add(referenceKey);

        connectedThreads.push({
            filePath,
            entryBodies: resolvedThread ? collectPlainExportedThreadEntries(resolvedThread) : [],
        });
    }

    return connectedThreads;
}

function collectExportedThreadEntries(
    thread: CommentThread,
    threadLookup: ReadonlyMap<string, CommentThread>,
): ExportedEntry[] {
    return thread.entries
        .map((entry) => {
            const normalizedBody = entry.body.replace(/\r\n/g, "\n");
            return {
                connectedThreads: collectConnectedThreads(
                    extractSideNoteReferences(normalizedBody),
                    threadLookup,
                    thread.id,
                ),
                value: normalizeEntryMarkdown(entry.body),
            };
        })
        .filter((entry) => Boolean(entry.value) || entry.connectedThreads.length > 0);
}

function buildThreadHeading(thread: CommentThread, exportedEntries: readonly ExportedEntry[]): string {
    if (!isPageComment(thread)) {
        const selectedText = normalizeInlineText(thread.selectedText ?? "");
        if (selectedText) {
            return selectedText;
        }
    }

    for (const entry of exportedEntries) {
        if (entry.value) {
            return buildInlinePreview(entry.value);
        }
    }

    for (const entry of exportedEntries) {
        const firstConnectedEntry = entry.connectedThreads.find((connectedThread) => connectedThread.entryBodies.length > 0)?.entryBodies[0];
        if (firstConnectedEntry) {
            return buildInlinePreview(firstConnectedEntry);
        }
    }

    for (const entry of exportedEntries) {
        const firstConnectedFilePath = entry.connectedThreads[0]?.filePath;
        if (firstConnectedFilePath) {
            return buildInlinePreview(firstConnectedFilePath);
        }
    }

    return buildInlinePreview("");
}

function buildNestedBulletItem(value: string, indent: string = "  "): string {
    const lines = value.split("\n");
    const firstLine = lines[0] || "_(empty note)_";
    const restLines = lines.slice(1);

    return [
        `${indent}- ${firstLine}`,
        ...restLines.map((line) => line ? `${indent}  ${line}` : ""),
    ].join("\n");
}

function buildConnectedThreadSection(connectedThread: ExportedConnectedThread, indent: string): string {
    const lines = [`${indent}- ${buildExportWikiLink(connectedThread.filePath)}`];
    for (const entryBody of connectedThread.entryBodies) {
        lines.push(buildNestedBulletItem(entryBody, `${indent}  `));
    }
    return lines.join("\n");
}

function buildExportedEntrySection(entry: ExportedEntry, indent: string): string {
    const lines = entry.value ? [buildNestedBulletItem(entry.value, indent)] : [];
    const connectedThreadIndent = entry.value ? `${indent}  ` : indent;

    for (const connectedThread of entry.connectedThreads) {
        lines.push(buildConnectedThreadSection(connectedThread, connectedThreadIndent));
    }

    return lines.join("\n");
}

function buildThreadSection(
    thread: CommentThread,
    threadLookup: ReadonlyMap<string, CommentThread>,
): string | null {
    const exportedEntries = collectExportedThreadEntries(thread, threadLookup);
    if (!exportedEntries.length) {
        return null;
    }

    return [
        `- ${buildThreadHeading(thread, exportedEntries)}`,
        ...exportedEntries.map((entry) => buildExportedEntrySection(entry, "  ")),
    ].join("\n");
}

export function buildSideNoteMarkdownExportPath(
    filePath: string,
    exportRootPath: string = DEFAULT_SIDE_NOTE_EXPORT_ROOT,
): SideNoteMarkdownExportPath {
    const normalizedExportRootPath = normalizeVaultPath(exportRootPath) || DEFAULT_SIDE_NOTE_EXPORT_ROOT;
    const exportDirectoryPath = normalizedExportRootPath;
    const baseName = buildFlatExportBaseName(filePath);

    return {
        exportRootPath: normalizedExportRootPath,
        exportDirectoryPath,
        exportFilePath: `${exportDirectoryPath}/${baseName} side notes.md`,
    };
}

export function buildSideNoteMarkdownExport(options: SideNoteMarkdownExportOptions): string {
    const threadLookup = collectThreadLookup([
        ...(options.referenceThreads ?? []),
        ...options.threads,
    ]);
    const threadSections = options.threads
        .map((thread) => buildThreadSection(thread, threadLookup))
        .filter((threadSection): threadSection is string => Boolean(threadSection));
    const sections = [
        `Source note: ${buildExportWikiLink(options.filePath)}`,
    ];

    if (threadSections.length === 0) {
        sections.push("_No side notes in this file._");
    } else {
        sections.push(...threadSections);
    }

    return `${sections.join("\n\n").trimEnd()}\n`;
}
