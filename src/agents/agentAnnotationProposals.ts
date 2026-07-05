import type { Comment } from "../commentManager";
import {
    offsetToLineCh,
    pickExactTextMatch,
    pickWhitespaceCollapsedTextMatch,
} from "../core/anchors/anchorResolver";
import { getVisibleNoteContent } from "../core/storage/noteCommentStorage";

export interface AgentAnnotationProposal {
    selectedText: string;
    comment: string;
    occurrenceIndex?: number;
}

export interface ExtractedAgentAnnotationProposals {
    replyText: string;
    proposals: AgentAnnotationProposal[];
}

export interface ResolvedAgentAnnotationProposal {
    proposal: AgentAnnotationProposal;
    comment: Omit<Comment, "id" | "timestamp" | "selectedTextHash">;
}

const ANNOTATION_BLOCK_PATTERN = /```aside-annotations\s*\n([\s\S]*?)```/giu;
const MAX_ANNOTATION_PROPOSALS = 12;
const MAX_SELECTED_TEXT_CHARS = 1_200;
const MAX_COMMENT_CHARS = 1_500;

function normalizeTextField(value: unknown, maxChars: number): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.replace(/\r\n?/gu, "\n").trim();
    if (!normalized) {
        return null;
    }

    return normalized.length > maxChars
        ? normalized.slice(0, maxChars).trimEnd()
        : normalized;
}

function normalizeOccurrenceIndex(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
        ? value
        : undefined;
}

function normalizeProposal(value: unknown): AgentAnnotationProposal | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    const record = value as Record<string, unknown>;
    const selectedText = normalizeTextField(record.selectedText, MAX_SELECTED_TEXT_CHARS);
    const comment = normalizeTextField(record.comment ?? record.body, MAX_COMMENT_CHARS);
    if (!selectedText || !comment) {
        return null;
    }

    const occurrenceIndex = normalizeOccurrenceIndex(record.occurrenceIndex);
    return {
        selectedText,
        comment,
        ...(occurrenceIndex !== undefined ? { occurrenceIndex } : {}),
    };
}

function parseAnnotationBlock(blockJson: string): AgentAnnotationProposal[] {
    try {
        const parsed = JSON.parse(blockJson) as unknown;
        const candidates = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === "object" && Array.isArray((parsed as { annotations?: unknown }).annotations)
                ? (parsed as { annotations: unknown[] }).annotations
                : [];
        return candidates
            .map((candidate) => normalizeProposal(candidate))
            .filter((candidate): candidate is AgentAnnotationProposal => candidate !== null)
            .slice(0, MAX_ANNOTATION_PROPOSALS);
    } catch {
        return [];
    }
}

export function extractAgentAnnotationProposals(replyText: string): ExtractedAgentAnnotationProposals {
    const proposals: AgentAnnotationProposal[] = [];
    const withoutBlocks = replyText.replace(ANNOTATION_BLOCK_PATTERN, (_match, blockJson: string) => {
        proposals.push(...parseAnnotationBlock(blockJson));
        return "";
    });

    return {
        replyText: withoutBlocks.replace(/\n{3,}/gu, "\n\n").trim(),
        proposals: proposals.slice(0, MAX_ANNOTATION_PROPOSALS),
    };
}

export function resolveAgentAnnotationProposal(
    filePath: string,
    noteContent: string,
    proposal: AgentAnnotationProposal,
): ResolvedAgentAnnotationProposal | null {
    const visibleNoteContent = getVisibleNoteContent(noteContent);
    const match = pickExactTextMatch(visibleNoteContent, proposal.selectedText, {
        occurrenceIndex: proposal.occurrenceIndex,
    }) ?? pickWhitespaceCollapsedTextMatch(visibleNoteContent, proposal.selectedText, {
        occurrenceIndex: proposal.occurrenceIndex,
    });
    if (!match) {
        return null;
    }

    const start = offsetToLineCh(visibleNoteContent, match.startOffset);
    const end = offsetToLineCh(visibleNoteContent, match.endOffset);
    const selectedText = visibleNoteContent.slice(match.startOffset, match.endOffset);
    return {
        proposal,
        comment: {
            filePath,
            startLine: start.line,
            startChar: start.ch,
            endLine: end.line,
            endChar: end.ch,
            selectedText,
            comment: proposal.comment,
            anchorKind: "selection",
            orphaned: false,
        },
    };
}
