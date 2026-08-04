import {
    cloneAgentRunRecord,
    cloneAgentRunRecords,
    getAgentRunById,
    type AgentRunRecord,
} from "../core/agents/agentRuns";
import type {
    PersistedPluginData,
    PersistedPluginDataUpdater,
} from "../settings/indexNoteSettingsPlanner";
import { resolveSourceIdentityCurrentPath } from "../sync/sourceIdentityStore";
import { clonePersistedAgentRuns, normalizePersistedAgentRuns } from "./agentRunStorePlanner";

export interface AgentRunStoreHost {
    readPersistedPluginData(): PersistedPluginData | null;
    updatePersistedPluginData(updater: PersistedPluginDataUpdater): Promise<PersistedPluginData>;
}

export class AgentRunStore {
    private runs: AgentRunRecord[] = [];
    private mutationQueue: Promise<void> = Promise.resolve();

    constructor(private readonly host: AgentRunStoreHost) {}

    public load(): void {
        const persistedData = this.host.readPersistedPluginData();
        this.runs = normalizePersistedAgentRuns(persistedData?.agentRuns).map((run) => ({
            ...run,
            filePath: resolveSourceIdentityCurrentPath(
                persistedData?.sourceIdentityState,
                run.filePath,
            ) ?? run.filePath,
        }));
    }

    public getRuns(): AgentRunRecord[] {
        return clonePersistedAgentRuns(this.runs);
    }

    public getRunById(runId: string): AgentRunRecord | null {
        const run = getAgentRunById(this.runs, runId);
        return run ? cloneAgentRunRecord(run) : null;
    }

    public async addRun(run: AgentRunRecord): Promise<AgentRunRecord> {
        const runSnapshot = cloneAgentRunRecord(run);
        return this.enqueueMutation(async () => {
            const nextRuns = this.runs.concat(cloneAgentRunRecord(runSnapshot));
            await this.persist(nextRuns);
            this.runs = nextRuns;
            return cloneAgentRunRecord(runSnapshot);
        });
    }

    public async updateRun(
        runId: string,
        updater: (run: AgentRunRecord) => AgentRunRecord,
    ): Promise<AgentRunRecord | null> {
        return this.enqueueMutation(async () => {
            let updatedRun: AgentRunRecord | null = null;
            const nextRuns = this.runs.map((run) => {
                if (run.id !== runId) {
                    return run;
                }

                updatedRun = cloneAgentRunRecord(updater(cloneAgentRunRecord(run)));
                return cloneAgentRunRecord(updatedRun);
            });
            if (!updatedRun) {
                return null;
            }

            await this.persist(nextRuns);
            this.runs = nextRuns;
            return cloneAgentRunRecord(updatedRun);
        });
    }

    public async failPendingRuns(message: string, endedAt: number): Promise<boolean> {
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
                    error: run.error ?? message,
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

    private async persist(runs: AgentRunRecord[]): Promise<void> {
        await this.host.updatePersistedPluginData((persistedData) => ({
            ...persistedData,
            agentRuns: cloneAgentRunRecords(runs),
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
