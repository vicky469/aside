import type { CommentManager, CommentThread } from "../../commentManager";
import { extractTagsFromText, isTagBoundaryChar, isTagCharacter, normalizeTagText } from "../../core/text/commentTags";

export interface BatchTagOperationFailure {
    threadId: string;
    reason: string;
    message: string;
}

export interface BatchTagOperationResult {
    failures: BatchTagOperationFailure[];
    successfulIds: string[];
    failedIds: string[];
    hasMutations: boolean;
}

type BatchTagMutationManager = Pick<CommentManager, "getThreadsForFile" | "replaceThreadsForFile">;

function hasTagText(value: string, targetTagKey: string): boolean {
    const targetKey = targetTagKey.toLowerCase();
    for (const rawTag of extractTagsFromText(value)) {
        if (rawTag.slice(1).toLowerCase() === targetKey) {
            return true;
        }
    }

    return false;
}

export function threadHasTag(thread: CommentThread, targetTagKey: string): boolean {
    return thread.entries.some((entry) => hasTagText(entry.body, targetTagKey));
}

function isHorizontalWhitespace(char: string): boolean {
    return char === " " || char === "\t";
}

function extractTagsFromTagOnlyLine(line: string): string[] | null {
    const tags: string[] = [];
    let index = 0;

    while (index < line.length) {
        while (index < line.length && isHorizontalWhitespace(line.charAt(index))) {
            index += 1;
        }

        if (index >= line.length) {
            break;
        }

        if (line.charAt(index) !== "#") {
            return null;
        }

        let end = index + 1;
        while (end < line.length && isTagCharacter(line.charAt(end))) {
            end += 1;
        }

        if (end === index + 1) {
            return null;
        }

        tags.push(normalizeTagText(line.slice(index, end)));
        index = end;

        if (index < line.length && !isHorizontalWhitespace(line.charAt(index))) {
            return null;
        }
    }

    return tags.length > 0 ? tags : null;
}

function extractLeadingTagLines(commentBody: string): { tags: string[]; remainder: string } | null {
    const lines = commentBody.split("\n");
    const tags: string[] = [];
    let consumedLines = 0;

    for (const line of lines) {
        const lineTags = extractTagsFromTagOnlyLine(line);
        if (!lineTags) {
            break;
        }

        tags.push(...lineTags);
        consumedLines += 1;
    }

    if (tags.length === 0) {
        return null;
    }

    return {
        tags,
        remainder: lines.slice(consumedLines).join("\n"),
    };
}

export function appendTagToCommentBody(commentBody: string, normalizedTagText: string): string {
    const normalizedTag = normalizeTagText(normalizedTagText);
    if (!normalizedTag) {
        return commentBody;
    }
    const targetKey = normalizedTag.slice(1).toLowerCase();

    if (hasTagText(commentBody, targetKey)) {
        return commentBody;
    }

    const trimmedBody = commentBody.trimEnd();
    if (!trimmedBody) {
        return normalizedTag;
    }

    const leadingTagLines = extractLeadingTagLines(trimmedBody);
    if (!leadingTagLines) {
        return `${normalizedTag}\n${trimmedBody}`;
    }

    const nextTagLine = [...leadingTagLines.tags, normalizedTag].join(" ");
    if (!leadingTagLines.remainder) {
        return nextTagLine;
    }

    return `${nextTagLine}\n${leadingTagLines.remainder}`;
}

export function removeTagFromCommentBody(commentBody: string, normalizedTagText: string): string {
    const normalizedTag = normalizeTagText(normalizedTagText);
    if (!normalizedTag) {
        return commentBody;
    }
    const targetKey = normalizedTag.slice(1).toLowerCase();
    if (!hasTagText(commentBody, targetKey)) {
        return commentBody;
    }

    const out: string[] = [];
    let index = 0;
    while (index < commentBody.length) {
        const char = commentBody.charAt(index);
        if (char !== "#" || !isTagBoundaryChar(commentBody.charAt(index - 1))) {
            out.push(char);
            index += 1;
            continue;
        }

        let end = index + 1;
        while (end < commentBody.length && isTagCharacter(commentBody.charAt(end))) {
            end += 1;
        }

        if (end === index + 1) {
            out.push(char);
            index += 1;
            continue;
        }

        const rawTag = commentBody.slice(index, end);
        const tagKey = normalizeTagText(rawTag).slice(1).toLowerCase();
        if (tagKey !== targetKey) {
            out.push(rawTag);
            index = end;
            continue;
        }

        const previousChar = out.length > 0 ? out[out.length - 1] : "";
        const nextChar = end < commentBody.length ? commentBody.charAt(end) : "";
        if (nextChar === " ") {
            if ((previousChar && previousChar !== " " && previousChar !== "\n" && previousChar !== "\t") || !previousChar) {
                end += 1;
            } else if ((previousChar === " " || previousChar === "\t") && (end + 1 >= commentBody.length || commentBody.charAt(end + 1) === "\n")) {
                out.pop();
            }
        } else if ((previousChar === "\n" || !previousChar) && nextChar === "\n") {
            if (previousChar === "\n" && out[out.length - 1] === "\n" && out[out.length - 2] === "\n") {
                end += 2;
            } else {
                end += 1;
            }
        } else if ((previousChar === " " || previousChar === "\t") && (nextChar === "\n" || nextChar === "")) {
            out.pop();
        }

        index = end;
    }

    return out.join("").replace(/^\n+/, "").trimEnd();
}

export function applyBatchTagToThreads(options: {
    filePath: string;
    selectedThreadIds: Iterable<string>;
    getThreadById: (threadId: string) => CommentThread | undefined;
    editComment: (commentId: string, nextBody: string) => void;
    normalizedTagText: string;
}): BatchTagOperationResult {
    const failures: BatchTagOperationFailure[] = [];
    const successfulIds: string[] = [];
    const failedIds: string[] = [];
    let hasMutations = false;
    const normalizedTagKey = normalizeTagText(options.normalizedTagText).slice(1).toLowerCase();

    for (const threadId of options.selectedThreadIds) {
        const thread = options.getThreadById(threadId);
        if (!thread || thread.filePath !== options.filePath) {
            failures.push({
                threadId,
                reason: "not-found",
                message: "Thread was not found in this file.",
            });
            failedIds.push(threadId);
            continue;
        }

        const parentEntry = thread.entries[0];
        if (!parentEntry) {
            failures.push({
                threadId,
                reason: "not-found",
                message: "Thread parent was not found.",
            });
            failedIds.push(threadId);
            continue;
        }

        if (threadHasTag(thread, normalizedTagKey)) {
            successfulIds.push(threadId);
            continue;
        }

        const parentBody = appendTagToCommentBody(parentEntry.body, options.normalizedTagText);
        options.editComment(parentEntry.id, parentBody);
        hasMutations = true;
        successfulIds.push(threadId);
    }

    return {
        failures,
        successfulIds,
        failedIds,
        hasMutations,
    };
}

export function removeBatchTagFromThreads(options: {
    filePath: string;
    selectedThreadIds: Iterable<string>;
    getThreadById: (threadId: string) => CommentThread | undefined;
    editComment: (commentId: string, nextBody: string) => void;
    normalizedTagText: string;
    targetTagTextForNotice: string;
}): BatchTagOperationResult {
    const failures: BatchTagOperationFailure[] = [];
    const successfulIds: string[] = [];
    const failedIds: string[] = [];
    let hasMutations = false;

    for (const threadId of options.selectedThreadIds) {
        const thread = options.getThreadById(threadId);
        if (!thread || thread.filePath !== options.filePath) {
            failures.push({
                threadId,
                reason: "not-found",
                message: "Thread was not found in this file.",
            });
            failedIds.push(threadId);
            continue;
        }

        const parentEntry = thread.entries[0];
        if (!parentEntry) {
            failures.push({
                threadId,
                reason: "not-found",
                message: "Thread parent was not found.",
            });
            failedIds.push(threadId);
            continue;
        }

        const entryBodiesAfterRemoval = thread.entries
            .map((entry) => {
                const nextBody = removeTagFromCommentBody(entry.body, options.normalizedTagText);
                return {
                    entry,
                    nextBody,
                    hasChanged: nextBody !== entry.body,
                };
            })
            .filter((item) => item.hasChanged);

        if (entryBodiesAfterRemoval.length === 0) {
            failures.push({
                threadId,
                reason: "not-found",
                message: `Tag ${options.targetTagTextForNotice} was not found on this thread.`,
            });
            failedIds.push(threadId);
            continue;
        }

        for (const { entry, nextBody } of entryBodiesAfterRemoval) {
            options.editComment(entry.id, nextBody);
            hasMutations = true;
        }

        successfulIds.push(threadId);
    }

    return {
        failures,
        successfulIds,
        failedIds,
        hasMutations,
    };
}

export async function persistBatchTagMutation(options: {
    filePath: string;
    selectedThreadIds: readonly string[];
    manager: BatchTagMutationManager;
    mutate: () => BatchTagOperationResult;
    persist: () => Promise<void>;
}): Promise<BatchTagOperationResult & { persistError: Error | null }> {
    const previousThreads = options.manager.getThreadsForFile(options.filePath, { includeDeleted: true });
    const result = options.mutate();
    if (!result.hasMutations) {
        return {
            ...result,
            persistError: null,
        };
    }

    try {
        await options.persist();
        return {
            ...result,
            persistError: null,
        };
    } catch (error) {
        options.manager.replaceThreadsForFile(options.filePath, previousThreads);
        return {
            failures: options.selectedThreadIds.map((threadId) => ({
                threadId,
                reason: "persist-failed",
                message: "Failed to save tag changes. Your comments were restored.",
            })),
            successfulIds: [],
            failedIds: options.selectedThreadIds.slice(),
            hasMutations: false,
            persistError: error instanceof Error ? error : new Error(String(error)),
        };
    }
}
