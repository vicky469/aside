export function shouldSkipAggregateViewRefresh(
    currentContent: string,
    nextContent: string,
    _hasOpenView: boolean,
): boolean {
    return currentContent === nextContent;
}
