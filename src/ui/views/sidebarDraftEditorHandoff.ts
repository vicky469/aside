export function handoffSidebarDraftEditor(
    previousThreadEl: HTMLElement,
    nextThreadEl: HTMLElement,
): boolean {
    const previousDraft = previousThreadEl.querySelector<HTMLElement>("[data-draft-id]");
    const nextDraft = nextThreadEl.querySelector<HTMLElement>("[data-draft-id]");
    if (
        !previousDraft
        || !nextDraft
        || !previousDraft.isConnected
        || !nextDraft.isConnected
        || previousDraft.dataset.draftId !== nextDraft.dataset.draftId
    ) {
        return false;
    }

    const activeElement = previousDraft.ownerDocument.activeElement as HTMLElement | null;
    const focusTarget = activeElement
        && previousDraft.contains(activeElement)
        && typeof activeElement.focus === "function"
        ? activeElement
        : null;
    nextDraft.replaceWith(previousDraft);
    focusTarget?.focus({ preventScroll: true });
    return true;
}
