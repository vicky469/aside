export interface IndexReorderThreadIdentity {
    id: string;
    filePath: string;
}

export function canDropIndexThreadOnThread(
    source: IndexReorderThreadIdentity,
    target: IndexReorderThreadIdentity,
): boolean {
    return source.id !== target.id && source.filePath === target.filePath;
}
