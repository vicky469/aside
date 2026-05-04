export function shouldSkipAggregateViewRefresh(
    currentContent: string,
    nextContent: string,
    hasOpenView: boolean,
): boolean {
    return currentContent === nextContent && !hasOpenView;
}
