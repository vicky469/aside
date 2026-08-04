import {
    cloneScriptRunRecord,
    cloneScriptRunRecords,
    getScriptRunById,
    type ScriptRunRecord,
} from "../core/scripts/scriptRuns";
import type { PersistedPluginData } from "../settings/indexNoteSettingsPlanner";
import { normalizePersistedScriptRuns } from "./scriptRunStorePlanner";

export interface ScriptRunStoreHost {
    readPersistedPluginData(): PersistedPluginData | null;
    writePersistedPluginData(data: PersistedPluginData): Promise<void>;
}

export class ScriptRunStore {
    private runs: ScriptRunRecord[] = [];

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
        this.runs = this.runs.concat(cloneScriptRunRecord(run));
        await this.persist();
        return cloneScriptRunRecord(run);
    }

    public async updateRun(
        runId: string,
        updater: (run: ScriptRunRecord) => ScriptRunRecord,
    ): Promise<ScriptRunRecord | null> {
        let updatedRun: ScriptRunRecord | null = null;
        this.runs = this.runs.map((run) => {
            if (run.id !== runId) {
                return run;
            }

            updatedRun = cloneScriptRunRecord(updater(cloneScriptRunRecord(run)));
            return cloneScriptRunRecord(updatedRun);
        });
        if (!updatedRun) {
            return null;
        }

        await this.persist();
        return cloneScriptRunRecord(updatedRun);
    }

    public async failPendingRuns(error: string, endedAt: number): Promise<boolean> {
        let changed = false;
        this.runs = this.runs.map((run) => {
            if (run.status !== "queued" && run.status !== "running") {
                return run;
            }

            changed = true;
            return {
                ...run,
                status: "failed",
                endedAt,
                error,
            };
        });

        if (!changed) {
            return false;
        }

        await this.persist();
        return true;
    }

    public async renameFile(previousFilePath: string, nextFilePath: string): Promise<boolean> {
        if (previousFilePath === nextFilePath) {
            return false;
        }

        let changed = false;
        this.runs = this.runs.map((run) => {
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

        await this.persist();
        return true;
    }

    private async persist(): Promise<void> {
        const persistedData = this.host.readPersistedPluginData() ?? {};
        await this.host.writePersistedPluginData({
            ...persistedData,
            scriptRuns: cloneScriptRunRecords(this.runs),
        });
    }
}
