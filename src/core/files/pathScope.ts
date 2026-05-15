function normalizeVaultPath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function isPathInsideFolder(filePath: string, folderPath: string): boolean {
    const normalizedFolderPath = normalizeVaultPath(folderPath);
    if (!normalizedFolderPath) {
        return false;
    }

    return normalizeVaultPath(filePath).startsWith(`${normalizedFolderPath}/`);
}
