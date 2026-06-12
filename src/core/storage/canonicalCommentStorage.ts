export type CanonicalCommentStorageSource = "none" | "sidecar";

export type CanonicalCommentStorageAction =
    | "use-sidecar"
    | "check-renamed-source";

export interface CanonicalCommentStoragePlan {
    action: CanonicalCommentStorageAction;
    source: CanonicalCommentStorageSource;
    shouldRecoverRenamedSource: boolean;
}

export interface CanonicalCommentStorageInput {
    sidecarRecordFound: boolean;
}

export function planCanonicalCommentStorage(input: CanonicalCommentStorageInput): CanonicalCommentStoragePlan {
    if (input.sidecarRecordFound) {
        return {
            action: "use-sidecar",
            source: "sidecar",
            shouldRecoverRenamedSource: false,
        };
    }

    return {
        action: "check-renamed-source",
        source: "none",
        shouldRecoverRenamedSource: true,
    };
}
