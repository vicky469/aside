export function isExternalSidecarStoragePath(candidatePath: unknown): boolean {
    if (typeof candidatePath !== "string") {
        return false;
    }

    const normalized = candidatePath
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/")
        .toLowerCase();
    return /(?:^|\/)sidenotes\/(?:by-note|by-source)\/.+\.json$/u.test(normalized);
}
