import {
    cloneScriptRunRecord,
    cloneScriptRunRecords,
    getScriptRunById,
    type ScriptRunRecord,
} from "../core/scripts/scriptRuns";
import type {
    PersistedPluginData,
    PersistedPluginDataUpdater,
} from "../settings/indexNoteSettingsPlanner";
import { normalizePersistedScriptRuns } from "./scriptRunStorePlanner";

export interface ScriptRunStoreHost {
    readPersistedPluginData(): PersistedPluginData | null;
    updatePersistedPluginData(updater: PersistedPluginDataUpdater): Promise<PersistedPluginData>;
}

export class ScriptRunStore {
    private runs: ScriptRunRecord[] = [];
    private mutationQueue: Promise<void> = Promise.resolve();

    constructor(private readonly host: ScriptRunStoreHost) {}

    public load(): void {
        this.runs = normalizePersistedScriptRuns(
            this.host.readPersistedPluginData()?.scriptRuns,
        );
    }

    public getRuns(): ScriptRunRecord[] {
        return cloneScriptRunRecords(this.runs);
    }

    public getRunById(runId: string): ScriptRunRecord | null {
        const run = getScriptRunById(this.runs, runId);
        return run ? cloneScriptRunRecord(run) : null;
    }

    public async addRun(run: ScriptRunRecord): Promise<ScriptRunRecord> {
        const runSnapshot = cloneScriptRunRecord(run);
        return this.enqueueMutation(async () => {
            const nextRuns = this.runs.concat(cloneScriptRunRecord(runSnapshot));
            await this.persist(nextRuns);
            this.runs = nextRuns;
            return cloneScriptRunRecord(runSnapshot);
        });
    }

    public async updateRun(
        runId: string,
        updater: (run: ScriptRunRecord) => ScriptRunRecord,
    ): Promise<ScriptRunRecord | null> {
        return this.enqueueMutation(async () => {
            let updatedRun: ScriptRunRecord | null = null;
            const nextRuns = this.runs.map((run) => {
                if (run.id !== runId) {
                    return run;
                }

                updatedRun = cloneScriptRunRecord(updater(cloneScriptRunRecord(run)));
                return cloneScriptRunRecord(updatedRun);
            });
            if (!updatedRun) {
                return null;
            }

            await this.persist(nextRuns);
            this.runs = nextRuns;
            return cloneScriptRunRecord(updatedRun);
        });
    }

    public async failPendingRuns(error: string, endedAt: number): Promise<boolean> {
        return this.enqueueMutation(async () => {
            let changed = false;
            const nextRuns = this.runs.map((run) => {
                if (run.status !== "queued" && run.status !== "running") {
                    return run;
                }

                changed = true;
                return {
                    ...run,
                    status: "failed" as const,
                    endedAt,
                    error,
                };
            });

            if (!changed) {
                return false;
            }

            await this.persist(nextRuns);
            this.runs = nextRuns;
            return true;
        });
    }

    public async renameFile(previousFilePath: string, nextFilePath: string): Promise<boolean> {
        if (previousFilePath === nextFilePath) {
            return false;
        }


        return this.enqueueMutation(async () => {
            let changed = false;
            const nextRuns = this.runs.map((run) => {
                if (run.filePath !== previousFilePath) {
                    return run;
                }

                changed = true;
                return {
                    ...run,
                    filePath: nextFilePath,
                };
            });

            if (!changed) {
                return false;
            }

            await this.persist(nextRuns);
            this.runs = nextRuns;
            return true;
        });
    }

    private async persist(runs: readonly ScriptRunRecord[]): Promise<void> {
        await this.host.updatePersistedPluginData((persistedData) => ({
            ...persistedData,
            scriptRuns: cloneScriptRunRecords(runs),
        }));
    }

    private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.mutationQueue.then(operation);
        this.mutationQueue = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}
