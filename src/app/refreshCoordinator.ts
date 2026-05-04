export type SideNoteRefreshReason =
    | "startup"
    | "file-open"
    | "active-leaf-change"
    | "vault-modify"
    | "vault-rename"
    | "vault-delete"
    | "comment-mutation"
    | "external-plugin-data"
    | "index-open"
    | "settings-change";

export interface RefreshCoordinatorHost {
    replaySyncedSideNoteEvents(targetNotePath?: string): Promise<number>;
    refreshCommentViews(options?: { skipDataRefresh?: boolean }): Promise<void>;
    scheduleAggregateNoteRefresh(): void;
}

export class RefreshCoordinator {
    constructor(private readonly host: RefreshCoordinatorHost) {}

    public async replaySyncedSideNoteEvents(
        _reason: SideNoteRefreshReason,
        targetNotePath?: string,
    ): Promise<number> {
        return this.host.replaySyncedSideNoteEvents(targetNotePath);
    }

    public async handleExternalPluginDataChange(): Promise<number> {
        const appliedEventCount = await this.replaySyncedSideNoteEvents("external-plugin-data");
        if (appliedEventCount <= 0) {
            return appliedEventCount;
        }

        await this.host.refreshCommentViews({ skipDataRefresh: true });
        this.host.scheduleAggregateNoteRefresh();
        return appliedEventCount;
    }
}
