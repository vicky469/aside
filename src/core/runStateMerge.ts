interface RunState {
    id: string;
    status: string;
}

function isPending(run: RunState): boolean {
    return run.status === "queued" || run.status === "running";
}

// Retries have their own run IDs. A terminal result for the same run must
// therefore survive an older pending copy, whichever device supplies it.
export function mergeRunStates<T extends RunState>(
    persistedRuns: readonly T[],
    localRuns: readonly T[],
    runIdsToPreserve: readonly string[],
): T[] {
    const preservedIds = new Set(runIdsToPreserve);
    const localById = new Map(localRuns.map((run) => [run.id, run]));
    const persistedIds = new Set(persistedRuns.map((run) => run.id));
    return [
        ...persistedRuns.map((persisted) => {
            const local = localById.get(persisted.id);
            if (!local) return persisted;
            if (isPending(local) !== isPending(persisted)) {
                return isPending(local) ? persisted : local;
            }
            return preservedIds.has(local.id) ? local : persisted;
        }),
        ...localRuns.filter((run) => preservedIds.has(run.id) && !persistedIds.has(run.id)),
    ];
}
