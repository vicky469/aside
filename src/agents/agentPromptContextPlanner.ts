import type { CommentThread, CommentThreadEntry } from "../commentManager";
import type { AgentRunRecord } from "../core/agents/agentRuns";
import { getAgentActorLabel } from "../core/agents/agentActorRegistry";
import { getVisibleNoteContent } from "../core/storage/noteCommentStorage";

export type AgentPromptContextScope = "anchor" | "section";

export interface AgentPromptContext {
    scope: AgentPromptContextScope;
    promptText: string;
    byteLength: number;
}

interface AgentPromptHeading {
    level: number;
    text: string;
    line: number;
}

const MAX_ANCHOR_CHARS = 1_200;
const MAX_SECTION_CHARS = 1_800;
const MAX_REQUEST_CHARS = 1_200;
const MAX_TRANSCRIPT_ENTRY_CHARS = 360;
const MAX_TRANSCRIPT_ENTRIES = 8;
const MAX_NEARBY_HEADINGS = 4;

function normalizeText(value: string): string {
    return value.replace(/\r\n/g, "\n").trim();
}

function compactText(value: string): string {
    return normalizeText(value).replace(/\s+/g, " ");
}

function clipText(value: string, maxChars: number): string {
    const normalized = normalizeText(value);
    if (!normalized) {
        return "";
    }

    if (normalized.length <= maxChars) {
        return normalized;
    }

    return `${normalized.slice(0, maxChars).trimEnd()}\n...`;
}

function clipCompactText(value: string, maxChars: number): string {
    const compact = compactText(value);
    if (!compact) {
        return "";
    }

    if (compact.length <= maxChars) {
        return compact;
    }

    return `${compact.slice(0, maxChars).trimEnd()}...`;
}

function formatMultilineBlock(label: string, value: string): string | null {
    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }

    return [
        `${label}:`,
        "<<<",
        normalized,
        ">>>",
    ].join("\n");
}

function formatBulletList(label: string, values: string[]): string | null {
    if (values.length === 0) {
        return null;
    }

    return `${label}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

function formatInlineList(label: string, values: string[]): string | null {
    if (values.length === 0) {
        return null;
    }

    return `${label}: ${values.join(" | ")}`;
}

function countUtf8Bytes(value: string): number {
    return new TextEncoder().encode(value).length;
}

function parseMarkdownHeadings(noteContent: string): AgentPromptHeading[] {
    const headings: AgentPromptHeading[] = [];
    const lines = noteContent.replace(/\r\n/g, "\n").split("\n");
    let openFence: { char: string; length: number } | null = null;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const fenceMatch = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
        if (fenceMatch) {
            const fenceToken = fenceMatch[1];
            const fenceChar = fenceToken[0];
            if (!openFence) {
                openFence = {
                    char: fenceChar,
                    length: fenceToken.length,
                };
            } else if (openFence.char === fenceChar && fenceToken.length >= openFence.length) {
                openFence = null;
            }
            continue;
        }

        if (openFence) {
            continue;
        }

        const headingMatch = /^(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
        if (!headingMatch) {
            continue;
        }

        const text = headingMatch[2].replace(/[ \t]+#+\s*$/u, "").trim();
        if (!text) {
            continue;
        }

        headings.push({
            level: headingMatch[1].length,
            text,
            line: index,
        });
    }

    return headings;
}

function formatHeading(heading: AgentPromptHeading): string {
    return `${"#".repeat(heading.level)} ${heading.text}`;
}

function resolveNearbyHeadings(
    headings: AgentPromptHeading[],
    referenceLine: number,
): string[] {
    if (headings.length === 0) {
        return [];
    }

    const activeIndex = headings.findLastIndex((heading) => heading.line <= referenceLine);
    if (activeIndex === -1) {
        return headings
            .slice(0, MAX_NEARBY_HEADINGS)
            .map((heading) => formatHeading(heading));
    }

    let fromIndex = Math.max(0, activeIndex - 1);
    let toIndex = Math.min(headings.length, fromIndex + MAX_NEARBY_HEADINGS);
    if (toIndex - fromIndex < MAX_NEARBY_HEADINGS) {
        fromIndex = Math.max(0, toIndex - MAX_NEARBY_HEADINGS);
    }

    return headings
        .slice(fromIndex, toIndex)
        .map((heading) => formatHeading(heading));
}

function resolveSectionText(
    noteContent: string,
    referenceLine: number,
): string | null {
    const normalized = normalizeText(noteContent);
    if (!normalized) {
        return null;
    }

    const lines = normalized.split("\n");
    const headings = parseMarkdownHeadings(normalized);
    if (headings.length === 0) {
        return clipText(normalized, MAX_SECTION_CHARS);
    }

    let activeIndex = headings.findLastIndex((heading) => heading.line <= referenceLine);
    let fromLine = 0;
    let toLine = lines.length;
    if (activeIndex >= 0) {
        fromLine = headings[activeIndex].line;
        toLine = headings[activeIndex + 1]?.line ?? lines.length;
    } else {
        fromLine = 0;
        toLine = headings[0].line;
    }

    let sectionText = normalizeText(lines.slice(fromLine, toLine).join("\n"));
    if (!sectionText && headings.length > 0) {
        activeIndex = 0;
        fromLine = headings[0].line;
        toLine = headings[1]?.line ?? lines.length;
        sectionText = normalizeText(lines.slice(fromLine, toLine).join("\n"));
    }

    return sectionText
        ? clipText(sectionText, MAX_SECTION_CHARS)
        : null;
}

function resolveTranscriptAuthorLabel(
    entry: CommentThreadEntry,
    threadAgentRuns: readonly Pick<AgentRunRecord, "requestedAgent" | "outputEntryId">[],
): string {
    const matchingRun = threadAgentRuns.find((run) => run.outputEntryId === entry.id);
    return matchingRun
        ? getAgentActorLabel(matchingRun.requestedAgent)
        : "You";
}

function buildThreadTranscript(
    thread: CommentThread,
    triggerEntryId: string,
    threadAgentRuns: readonly Pick<AgentRunRecord, "requestedAgent" | "outputEntryId">[],
): string[] {
    return thread.entries
        .slice(-MAX_TRANSCRIPT_ENTRIES)
        .map((entry) => {
            const label = resolveTranscriptAuthorLabel(entry, threadAgentRuns);
            const currentSuffix = entry.id === triggerEntryId ? " (current)" : "";
            return `${label}${currentSuffix}: ${clipCompactText(entry.body, MAX_TRANSCRIPT_ENTRY_CHARS)}`;
        })
        .filter((line) => !line.endsWith(": "));
}

function resolveTriggerEntryText(
    thread: CommentThread,
    triggerEntryId: string,
    fallbackPromptText: string,
): string {
    const entry = thread.entries.find((candidate) => candidate.id === triggerEntryId);
    return entry?.body?.trim()
        ? entry.body
        : fallbackPromptText;
}

function resolveVisibleMarkdownContext(noteContent: string | null): string | null {
    if (!noteContent || !noteContent.trim()) {
        return null;
    }

    const visibleContent = getVisibleNoteContent(noteContent);
    return normalizeText(visibleContent) || null;
}

export function buildAgentPromptContext(options: {
    filePath: string;
    noteContent: string | null;
    thread: CommentThread;
    triggerEntryId: string;
    fallbackPromptText: string;
    threadAgentRuns?: readonly Pick<AgentRunRecord, "requestedAgent" | "outputEntryId">[];
}): AgentPromptContext {
    const scope: AgentPromptContextScope = options.thread.anchorKind === "page" ? "section" : "anchor";
    const visibleNoteContent = resolveVisibleMarkdownContext(options.noteContent);
    const nearbyHeadings = visibleNoteContent
        ? resolveNearbyHeadings(parseMarkdownHeadings(visibleNoteContent), options.thread.startLine)
        : [];
    const transcriptLines = buildThreadTranscript(
        options.thread,
        options.triggerEntryId,
        options.threadAgentRuns ?? [],
    );
    const currentRequestText = clipText(
        resolveTriggerEntryText(options.thread, options.triggerEntryId, options.fallbackPromptText),
        MAX_REQUEST_CHARS,
    );

    const sections = [
        `Note path: ${options.filePath}`,
        `Scope: ${scope}`,
    ];

    if (scope === "anchor") {
        const anchorBlock = formatMultilineBlock(
            "Anchor",
            clipText(options.thread.selectedText, MAX_ANCHOR_CHARS),
        );
        if (anchorBlock) {
            sections.push(anchorBlock);
        }
    } else {
        const sectionBlock = formatMultilineBlock(
            "Section",
            resolveSectionText(visibleNoteContent ?? "", options.thread.startLine) ?? "",
        );
        if (sectionBlock) {
            sections.push(sectionBlock);
        }
    }

    const headingsBlock = formatInlineList("Headings", nearbyHeadings);
    if (headingsBlock) {
        sections.push(headingsBlock);
    }

    const transcriptBlock = formatBulletList("Thread", transcriptLines);
    if (transcriptBlock) {
        sections.push(transcriptBlock);
    }

    const requestBlock = formatMultilineBlock("Request", currentRequestText);
    if (requestBlock) {
        sections.push(requestBlock);
    }

    const promptText = sections.join("\n\n");

    return {
        scope,
        promptText,
        byteLength: countUtf8Bytes(promptText),
    };
}
