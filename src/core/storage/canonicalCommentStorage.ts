export type CanonicalCommentStorageSource = "none" | "inline" | "sidecar";

export type CanonicalCommentStorageAction =
    | "use-sidecar"
    | "migrate-inline"
    | "check-renamed-source";

export interface CanonicalCommentStoragePlan {
    action: CanonicalCommentStorageAction;
    source: CanonicalCommentStorageSource;
    shouldRecoverRenamedSource: boolean;
    shouldStripInlineBlock: boolean;
    shouldWriteInlineThreadsToSidecar: boolean;
}

export interface CanonicalCommentStorageInput {
    sidecarRecordFound: boolean;
    inlineThreadCount: number;
    hasThreadedInlineBlock: boolean;
}

export function planCanonicalCommentStorage(input: CanonicalCommentStorageInput): CanonicalCommentStoragePlan {
    if (input.sidecarRecordFound) {
        return {
            action: "use-sidecar",
            source: "sidecar",
            shouldRecoverRenamedSource: false,
            shouldStripInlineBlock: input.hasThreadedInlineBlock,
            shouldWriteInlineThreadsToSidecar: false,
        };
    }

    if (input.inlineThreadCount > 0) {
        return {
            action: "migrate-inline",
            source: "inline",
            shouldRecoverRenamedSource: false,
            shouldStripInlineBlock: true,
            shouldWriteInlineThreadsToSidecar: true,
        };
    }

    return {
        action: "check-renamed-source",
        source: "none",
        shouldRecoverRenamedSource: true,
        shouldStripInlineBlock: input.hasThreadedInlineBlock,
        shouldWriteInlineThreadsToSidecar: false,
    };
}
