import {
    buildIndexTagSearchWindow,
    type IndexTagSearchResult,
} from "./indexTagSearch";
import {
    renderSidebarTagFileRows,
    renderSidebarTagFilterBar,
} from "./sidebarTagFileList";

function renderEmptyState(container: HTMLElement, text: string): void {
    container.createDiv({
        cls: "aside-empty-state aside-section-empty-state aside-index-tag-search-empty",
        text,
    });
}

export function renderSidebarIndexTagSearch(
    container: HTMLDivElement,
    options: {
        result: IndexTagSearchResult | null;
        selectedTagKey: string | null;
        visibleLimit: number;
        onFilterChange(tagKey: string | null): void;
        onShowMore(): void;
        onOpenFile(filePath: string): void;
    },
): void {
    container.empty();
    const browserEl = container.createDiv("aside-index-tag-search");
    if (!options.result?.query) {
        renderEmptyState(browserEl, "Search tags across your vault");
        return;
    }
    if (options.result.tags.length === 0) {
        renderEmptyState(browserEl, "No matching tags");
        return;
    }

    renderSidebarTagFilterBar(browserEl, {
        filters: [
            {
                tagKey: null,
                label: "All matches",
                fileCount: options.result.files.length,
            },
            ...options.result.tags.map((tag) => ({
                tagKey: tag.tagKey,
                label: tag.tag,
                fileCount: tag.fileCount,
            })),
        ],
        selectedTagKey: options.selectedTagKey,
        ariaLabel: "Filter tag search results",
        onChange: (tagKey) => {
            options.onFilterChange(tagKey);
        },
    });

    const window = buildIndexTagSearchWindow(
        options.result,
        options.selectedTagKey,
        options.visibleLimit,
    );
    browserEl.createDiv({
        cls: "aside-index-tag-search-count",
        text: `${window.visibleCount} of ${window.totalCount} files`,
    });
    renderSidebarTagFileRows(browserEl, {
        files: window.files.map((file) => ({
            filePath: file.filePath,
            label: file.label,
            pathLabel: file.filePath,
            tags: file.matchedTags.map((tag) => ({
                tagKey: tag.tagKey,
                label: tag.tag,
            })),
        })),
        onOpenFile: (filePath) => {
            options.onOpenFile(filePath);
        },
    });

    if (window.hasMore) {
        const showMoreButton = browserEl.createEl("button", {
            cls: "aside-index-tag-search-show-more",
            text: `Show more · ${window.totalCount - window.visibleCount} remaining`,
            attr: { type: "button" },
        });
        showMoreButton.addEventListener("click", () => {
            options.onShowMore();
        });
    }
}
