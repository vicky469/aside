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

export function retargetPathInFolder(
    filePath: string,
    previousFolderPath: string,
    nextFolderPath: string,
): string | null {
    const normalizedFilePath = normalizeVaultPath(filePath);
    const normalizedPreviousFolderPath = normalizeVaultPath(previousFolderPath);
    const normalizedNextFolderPath = normalizeVaultPath(nextFolderPath);
    if (
        !normalizedPreviousFolderPath
        || !normalizedNextFolderPath
        || !isPathInsideFolder(normalizedFilePath, normalizedPreviousFolderPath)
    ) {
        return null;
    }

    return `${normalizedNextFolderPath}/${normalizedFilePath.slice(normalizedPreviousFolderPath.length + 1)}`;
}
