import type { SyncedSideNoteReplayOptions } from "../comments/commentPersistenceController";

export function runReportedAsyncRefresh(
    refresh: () => Promise<void>,
    reportError: (error: unknown) => void,
): void {
    const reportSafely = (error: unknown): void => {
        try {
            reportError(error);
        } catch {
            return;
        }
    };
    try {
        void refresh().catch(reportSafely);
    } catch (error) {
        reportSafely(error);
    }
}

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
    replaySyncedSideNoteEvents(
        targetNotePath?: string,
        options?: SyncedSideNoteReplayOptions,
    ): Promise<number>;
    refreshCommentViews(options?: { skipDataRefresh?: boolean }): Promise<void>;
    scheduleAggregateNoteRefresh(): void;
    syncPublicFilePublishActions(): Promise<void>;
}

export class RefreshCoordinator {
    private externalRefreshPromise: Promise<number> | null = null;
    private externalRefreshRerunRequested = false;

    constructor(private readonly host: RefreshCoordinatorHost) {}

    public async replaySyncedSideNoteEvents(
        _reason: SideNoteRefreshReason,
        targetNotePath?: string,
        options?: SyncedSideNoteReplayOptions,
    ): Promise<number> {
        return this.host.replaySyncedSideNoteEvents(targetNotePath, options);
    }

    public handleExternalPluginDataChange(): Promise<number> {
        if (this.externalRefreshPromise) {
            this.externalRefreshRerunRequested = true;
            return this.externalRefreshPromise;
        }

        const operation = this.runExternalPluginDataRefreshes();
        const trackedOperation = operation.finally(() => {
            if (this.externalRefreshPromise === trackedOperation) {
                this.externalRefreshPromise = null;
            }
        });
        this.externalRefreshPromise = trackedOperation;
        return trackedOperation;
    }

    private async runExternalPluginDataRefreshes(): Promise<number> {
        let appliedEventCount = 0;
        let firstError: unknown;
        let hasError = false;
        do {
            this.externalRefreshRerunRequested = false;
            try {
                appliedEventCount += await this.runExternalPluginDataRefresh();
            } catch (error) {
                if (!hasError) {
                    firstError = error;
                    hasError = true;
                }
            }
        } while (this.externalRefreshRerunRequested);

        if (hasError) {
            throw firstError;
        }
        return appliedEventCount;
    }

    private async runExternalPluginDataRefresh(): Promise<number> {
        let appliedEventCount = 0;
        let firstError: unknown;
        let hasError = false;
        const runPhase = async (phase: () => void | Promise<void>): Promise<void> => {
            try {
                await phase();
            } catch (error) {
                if (!hasError) {
                    firstError = error;
                    hasError = true;
                }
            }
        };

        await runPhase(async () => {
            appliedEventCount = await this.replaySyncedSideNoteEvents(
                "external-plugin-data",
                undefined,
                { deferSurfaceRefresh: true },
            );
        });
        await runPhase(() => this.host.refreshCommentViews({ skipDataRefresh: true }));
        await runPhase(() => this.host.scheduleAggregateNoteRefresh());
        await runPhase(() => this.host.syncPublicFilePublishActions());

        if (hasError) {
            throw firstError;
        }
        return appliedEventCount;
    }
}
