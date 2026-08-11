export type IndexNoteRefreshContext = "creation" | "background";

export interface IndexNoteOpenHost<FocusTarget> {
    getIndexNotePath(): string;
    hasIndexNote(filePath: string): boolean;
    revealIndexNote(filePath: string): Promise<FocusTarget>;
    refreshAggregateNoteNow(): Promise<void>;
    activateIndexSidebar(): Promise<void>;
    restoreIndexFocus(focusTarget: FocusTarget, filePath: string): void;
    reportMissingIndex(filePath: string): void;
    handleRefreshError(error: unknown, context: IndexNoteRefreshContext): void;
}

export class IndexNoteOpenController<FocusTarget> {
    constructor(private readonly host: IndexNoteOpenHost<FocusTarget>) {}

    public async open(): Promise<void> {
        const indexFilePath = this.host.getIndexNotePath();
        const existedAtClick = this.host.hasIndexNote(indexFilePath);

        if (!existedAtClick) {
            try {
                await this.host.refreshAggregateNoteNow();
            } catch (error) {
                this.host.handleRefreshError(error, "creation");
            }

            if (!this.host.hasIndexNote(indexFilePath)) {
                this.host.reportMissingIndex(indexFilePath);
                return;
            }
        }

        const focusTarget = await this.host.revealIndexNote(indexFilePath);
        if (existedAtClick) {
            this.refreshExistingIndexInBackground();
        }
        await this.host.activateIndexSidebar();
        this.host.restoreIndexFocus(focusTarget, indexFilePath);
    }

    private refreshExistingIndexInBackground(): void {
        void this.host.refreshAggregateNoteNow().catch((error: unknown) => {
            this.host.handleRefreshError(error, "background");
        });
    }
}
