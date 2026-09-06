import { setTooltip } from "obsidian";

export interface SidebarTagFilterItem {
    tagKey: string | null;
    label: string;
    fileCount: number;
}

export interface SidebarTagFileItem {
    filePath: string;
    label: string;
    pathLabel?: string;
    tags: Array<{
        tagKey: string;
        label: string;
    }>;
}

export function renderSidebarTagFilterBar(
    container: HTMLElement,
    options: {
        filters: readonly SidebarTagFilterItem[];
        selectedTagKey: string | null;
        ariaLabel: string;
        onChange(tagKey: string | null): void;
    },
): HTMLDivElement {
    const filterBarEl = container.createDiv({
        cls: "aside-tag-related-filter-bar",
        attr: {
            role: "group",
            "aria-label": options.ariaLabel,
        },
    });

    for (const filter of options.filters) {
        const isSelected = filter.tagKey === options.selectedTagKey;
        const button = filterBarEl.createEl("button", {
            cls: `aside-tag-related-filter${isSelected ? " is-selected" : ""}`,
            text: `${filter.label} · ${filter.fileCount}`,
            attr: {
                type: "button",
                "aria-pressed": String(isSelected),
                "data-tag-key": filter.tagKey ?? "",
            },
        });
        button.classList.toggle("is-selected", isSelected);
        button.addEventListener("click", () => {
            options.onChange(filter.tagKey);
        });
    }

    return filterBarEl;
}

export function renderSidebarTagFileRows(
    container: HTMLElement,
    options: {
        files: readonly SidebarTagFileItem[];
        onOpenFile(filePath: string): void;
    },
): HTMLUListElement {
    const listEl = container.createEl("ul", { cls: "aside-tag-related-files" });
    for (const file of options.files) {
        const rowEl = listEl.createEl("li", {
            cls: "aside-tag-related-file-row",
            attr: { "data-file-path": file.filePath },
        });
        const buttonEl = rowEl.createEl("button", {
            cls: "aside-tag-related-file-link",
            text: file.label,
            attr: { type: "button" },
        });
        setTooltip(buttonEl, file.filePath);
        buttonEl.addEventListener("click", () => {
            options.onOpenFile(file.filePath);
        });

        if (file.pathLabel) {
            rowEl.createDiv({
                cls: "aside-tag-related-file-path",
                text: file.pathLabel,
            });
        }

        const tagsEl = rowEl.createDiv("aside-tag-related-file-tags");
        for (const tag of file.tags) {
            tagsEl.createSpan({
                cls: "aside-tag-related-file-tag",
                text: tag.label,
                attr: { "data-tag-key": tag.tagKey },
            });
        }
    }

    return listEl;
}
