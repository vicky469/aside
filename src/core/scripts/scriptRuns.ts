export type ScriptRunStatus = "queued" | "running" | "succeeded" | "failed";

export interface ScriptRunRecord {
    id: string;
    threadId: string;
    triggerEntryId: string;
    filePath: string;
    scriptPath: string;
    mentionName: string;
    status: ScriptRunStatus;
    promptText: string;
    createdAt: number;
    startedAt?: number;
    endedAt?: number;
    retryOfRunId?: string;
    outputEntryId?: string;
    error?: string;
}

export function cloneScriptRunRecord(run: ScriptRunRecord): ScriptRunRecord {
    return { ...run };
}

export function cloneScriptRunRecords(runs: readonly ScriptRunRecord[]): ScriptRunRecord[] {
    return runs.map((run) => cloneScriptRunRecord(run));
}

export function getScriptRunById(
    runs: readonly ScriptRunRecord[],
    runId: string,
): ScriptRunRecord | null {
    return runs.find((run) => run.id === runId) ?? null;
}

export function getScriptRunByOutputEntryId(
    runs: readonly ScriptRunRecord[],
    entryId: string,
): ScriptRunRecord | null {
    for (let index = runs.length - 1; index >= 0; index -= 1) {
        const run = runs[index];
        if (run?.outputEntryId === entryId) {
            return run;
        }
    }
    return null;
}

export function getLatestScriptRunForTriggerEntry(
    runs: readonly ScriptRunRecord[],
    triggerEntryId: string,
): ScriptRunRecord | null {
    for (let index = runs.length - 1; index >= 0; index -= 1) {
        const run = runs[index];
        if (run?.triggerEntryId === triggerEntryId) {
            return run;
        }
    }
    return null;
}

export function getScriptRunsForThread(
    runs: readonly ScriptRunRecord[],
    thread: { id: string },
): ScriptRunRecord[] {
    return runs
        .filter((run) => run.threadId === thread.id)
        .map((run) => cloneScriptRunRecord(run));
}
