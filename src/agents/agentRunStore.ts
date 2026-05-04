import {
    cloneAgentRunRecord,
    cloneAgentRunRecords,
    getAgentRunById,
    type AgentRunRecord,
} from "../core/agents/agentRuns";
import type { PersistedPluginData } from "../settings/indexNoteSettingsPlanner";
import { clonePersistedAgentRuns, normalizePersistedAgentRuns } from "./agentRunStorePlanner";

export interface AgentRunStoreHost {
    readPersistedPluginData(): PersistedPluginData | null;
    writePersistedPluginData(data: PersistedPluginData): Promise<void>;
}

export class AgentRunStore {
    private runs: AgentRunRecord[] = [];

    constructor(private readonly host: AgentRunStoreHost) {}

    public load(): void {
        const persistedData = this.host.readPersistedPluginData();
        this.runs = normalizePersistedAgentRuns(persistedData?.agentRuns);
    }

    public getRuns(): AgentRunRecord[] {
        return clonePersistedAgentRuns(this.runs);
    }

    public getRunById(runId: string): AgentRunRecord | null {
        const run = getAgentRunById(this.runs, runId);
        return run ? cloneAgentRunRecord(run) : null;
    }

    public async addRun(run: AgentRunRecord): Promise<AgentRunRecord> {
        this.runs = this.runs.concat(cloneAgentRunRecord(run));
        await this.persist();
        return cloneAgentRunRecord(run);
    }

    public async updateRun(
        runId: string,
        updater: (run: AgentRunRecord) => AgentRunRecord,
    ): Promise<AgentRunRecord | null> {
        let updatedRun: AgentRunRecord | null = null;
        this.runs = this.runs.map((run) => {
            if (run.id !== runId) {
                return run;
            }

            updatedRun = cloneAgentRunRecord(updater(cloneAgentRunRecord(run)));
            return cloneAgentRunRecord(updatedRun);
        });
        if (!updatedRun) {
            return null;
        }

        await this.persist();
        return cloneAgentRunRecord(updatedRun);
    }

    public async failPendingRuns(message: string, endedAt: number): Promise<boolean> {
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
                error: run.error ?? message,
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
            agentRuns: cloneAgentRunRecords(this.runs),
        });
    }
}
