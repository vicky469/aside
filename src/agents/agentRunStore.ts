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
import { retargetPathInFolder } from "../core/files/pathScope";
import {
    clonePersistedAgentRuns,
    mergePersistedAgentRunsPreservingActive,
    normalizePersistedAgentRuns,
} from "./agentRunStorePlanner";
import {
    isPluginEventExecutionActive,
    type PluginEventExecutionContext,
} from "../core/events/pluginEventExecutionContext";

export interface AgentRunStoreHost {
    readPersistedPluginData(): PersistedPluginData | null;
    updatePersistedPluginData(
        updater: PersistedPluginDataUpdater,
        context?: PluginEventExecutionContext,
    ): Promise<PersistedPluginData>;
}

export class AgentRunStore {
    private runs: AgentRunRecord[] = [];
    private mutationQueue: Promise<void> = Promise.resolve();

    constructor(private readonly host: AgentRunStoreHost) {}

    public load(): void {
        this.runs = this.readPersistedRuns();
    }

    public async reloadPreservingActiveRuns(
        runIdsToPreserve: readonly string[] = [],
        runIdsBeforeLoad?: readonly string[],
    ): Promise<void> {
        await this.enqueueMutation(() => {
            const runIdsBeforeLoadSet = runIdsBeforeLoad
                ? new Set(runIdsBeforeLoad)
                : null;
            const runIdsAddedDuringLoad = runIdsBeforeLoadSet
                ? this.runs
                    .filter((run) => !runIdsBeforeLoadSet.has(run.id))
                    .map((run) => run.id)
                : [];
            this.runs = mergePersistedAgentRunsPreservingActive(
                this.readPersistedRuns(),
                this.runs,
                [...runIdsToPreserve, ...runIdsAddedDuringLoad],
            );
            return Promise.resolve();
        });
    }

    public getActiveRunIds(): string[] {
        return this.runs
            .filter((run) => run.status === "queued" || run.status === "running")
            .map((run) => run.id);
    }

    private readPersistedRuns(): AgentRunRecord[] {
        const persistedData = this.host.readPersistedPluginData();
        return normalizePersistedAgentRuns(persistedData?.agentRuns).map((run) => ({
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

    public async renameFile(
        previousFilePath: string,
        nextFilePath: string,
        context: PluginEventExecutionContext,
    ): Promise<boolean> {
        if (previousFilePath === nextFilePath || !isPluginEventExecutionActive(context)) {
            return false;
        }

        try {
            return await this.enqueueMutation(async () => {
                if (!isPluginEventExecutionActive(context)) {
                    return false;
                }
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

                const persisted = await this.persistEventRuns(nextRuns, context);
                if (!persisted || !isPluginEventExecutionActive(context)) {
                    return false;
                }
                this.runs = nextRuns;
                return true;
            });
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                return false;
            }
            throw error;
        }
    }

    public async renameFolder(
        previousFolderPath: string,
        nextFolderPath: string,
        context: PluginEventExecutionContext,
    ): Promise<boolean> {
        if (previousFolderPath === nextFolderPath || !isPluginEventExecutionActive(context)) {
            return false;
        }

        try {
            return await this.enqueueMutation(async () => {
                if (!isPluginEventExecutionActive(context)) {
                    return false;
                }
                let changed = false;
                const nextRuns = this.runs.map((run) => {
                    const nextFilePath = retargetPathInFolder(
                        run.filePath,
                        previousFolderPath,
                        nextFolderPath,
                    );
                    if (!nextFilePath) {
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

                const persisted = await this.persistEventRuns(nextRuns, context);
                if (!persisted || !isPluginEventExecutionActive(context)) {
                    return false;
                }
                this.runs = nextRuns;
                return true;
            });
        } catch (error) {
            if (!isPluginEventExecutionActive(context)) {
                return false;
            }
            throw error;
        }
    }

    private async persistEventRuns(
        runs: AgentRunRecord[],
        context: PluginEventExecutionContext,
    ): Promise<boolean> {
        if (!isPluginEventExecutionActive(context)) {
            return false;
        }
        let applied = false;
        await this.host.updatePersistedPluginData((persistedData) => {
            if (!isPluginEventExecutionActive(context)) {
                return persistedData;
            }
            applied = true;
            return {
                ...persistedData,
                agentRuns: cloneAgentRunRecords(runs),
            };
        }, context);
        return applied && isPluginEventExecutionActive(context);
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
