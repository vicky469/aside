export type CanonicalCommentStorageSource = "none" | "legacy-inline" | "sidecar";

export type CanonicalCommentStorageAction =
    | "use-sidecar"
    | "migrate-inline"
    | "check-renamed-source";

export interface CanonicalCommentStoragePlan {
    action: CanonicalCommentStorageAction;
    source: CanonicalCommentStorageSource;
    shouldRecoverRenamedSource: boolean;
    shouldStripInlineBlock: boolean;
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
        };
    }

    if (input.inlineThreadCount > 0) {
        return {
            action: "migrate-inline",
            source: "legacy-inline",
            shouldRecoverRenamedSource: false,
            shouldStripInlineBlock: true,
        };
    }

    return {
        action: "check-renamed-source",
        source: "none",
        shouldRecoverRenamedSource: true,
        shouldStripInlineBlock: input.hasThreadedInlineBlock,
    };
}
