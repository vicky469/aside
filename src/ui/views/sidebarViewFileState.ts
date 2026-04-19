export function normalizeSidebarViewFile<T>(
    file: T | null,
    isSidebarSupportedFile: (candidate: T | null) => candidate is T,
): T | null {
    return isSidebarSupportedFile(file) ? file : null;
}
