import { getIndexFileFilterLabel } from "./indexFileFilter";

export interface ActiveFileFilterPresentationOptions {
    rootFilePath: string;
    filteredIndexFilePaths: string[];
}

export function getActiveFileFilterPresentation(options: ActiveFileFilterPresentationOptions): {
    label: string;
    summary: string;
    clearAriaLabel: string;
} {
    const linkedFileCount = Math.max(0, options.filteredIndexFilePaths.length - 1);
    return {
        label: getIndexFileFilterLabel(options.rootFilePath, options.filteredIndexFilePaths),
        summary: linkedFileCount > 0
            ? `+${linkedFileCount} linked file${linkedFileCount === 1 ? "" : "s"}`
            : "1 file",
        clearAriaLabel: `Clear file filter for ${options.rootFilePath}`,
    };
}

export function updateRenderedActiveFileFilters(
    container: Pick<HTMLElement, "querySelector">,
    options: ActiveFileFilterPresentationOptions,
): boolean {
    const labelEl = container.querySelector(".aside-active-file-filter-label");
    if (!labelEl) {
        return false;
    }

    const presentation = getActiveFileFilterPresentation(options);
    labelEl.textContent = presentation.label;

    const summaryEl = container.querySelector(".aside-active-file-filter-summary");
    if (summaryEl) {
        summaryEl.textContent = presentation.summary;
    }

    container.querySelector(".aside-active-file-filter-clear")?.setAttribute(
        "aria-label",
        presentation.clearAriaLabel,
    );
    return true;
}
