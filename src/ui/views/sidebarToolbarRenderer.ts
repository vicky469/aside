import { setIcon } from "obsidian";
import { getIndexFileFilterLabel } from "./indexFileFilter";
import type { SidebarPrimaryMode } from "./viewState";

export interface ToolbarActionGuard {
    beforeAction(): Promise<boolean>;
}

export interface ToolbarChipOptions {
    label: string;
    active: boolean;
    pressed?: boolean;
    ariaLabel?: string;
    onClick: () => void;
    count?: string;
    showIndicator?: boolean;
    disabled?: boolean;
    icon?: string;
    hideLabel?: boolean;
    chipClass?: string;
}

export interface ToolbarIconButtonOptions {
    icon: string;
    ariaLabel?: string;
    active?: boolean;
    activeVisual?: boolean;
    disabled?: boolean;
    onClick: () => void;
}

export interface SidebarSearchInputOptions {
    value: string;
    ariaLabel?: string;
    placeholder: string;
    onClear: () => void;
    onFocus?(inputEl: HTMLInputElement): void;
    onInput(value: string, selection: { selectionStart: number | null; selectionEnd: number | null }): void;
}

export interface SidebarModeControlOptions {
    mode: SidebarPrimaryMode;
    showTagsTab: boolean;
    isTagsEnabled: boolean;
    isThoughtTrailEnabled: boolean;
    onChange(mode: SidebarPrimaryMode): void;
}

export interface ActiveFileFiltersOptions {
    rootFilePath: string;
    filteredIndexFilePaths: string[];
    onClear(): void;
}

export function renderToolbarChip(
    container: HTMLElement,
    options: ToolbarChipOptions,
    guard: ToolbarActionGuard,
): void {
    const isTagFilterChip = options.chipClass?.includes("is-tag-filter-chip") ?? false;
    const button = container.createEl("button", {
        cls: `aside-filter-chip${options.active ? " is-active" : ""}${options.chipClass ? ` ${options.chipClass}` : ""}`,
    });
    button.setAttribute("type", "button");
    button.setAttribute("aria-pressed", (options.pressed ?? options.active) ? "true" : "false");
    if (options.ariaLabel) {
        button.setAttribute("aria-label", options.ariaLabel);
    }
    button.disabled = options.disabled ?? false;

    if (options.showIndicator) {
        button.createSpan({
            cls: "aside-filter-chip-indicator",
        });
    }

    if (options.icon) {
        const iconEl = button.createSpan({
            cls: "aside-filter-chip-icon",
        });
        setIcon(iconEl, options.icon);
    }

    if (!options.hideLabel) {
        button.createSpan({
            text: options.label,
            cls: `aside-filter-chip-label${isTagFilterChip ? " is-visible" : ""}`,
        });
    }

    if (options.count !== undefined) {
        button.createSpan({
            text: options.count,
            cls: "aside-filter-chip-count",
        });
    }

    button.onclick = async () => {
        if (!(await guard.beforeAction())) {
            return;
        }
        options.onClick();
    };
}

export function renderToolbarIconButton(
    container: HTMLElement,
    options: ToolbarIconButtonOptions,
    guard: ToolbarActionGuard,
): void {
    const showActiveVisual = options.activeVisual ?? options.active ?? false;
    const button = container.createEl("button", {
        cls: `clickable-icon aside-comment-section-add-button aside-toolbar-icon-button${showActiveVisual ? " is-active" : ""}`,
    });
    button.setAttribute("type", "button");
    button.setAttribute("aria-pressed", options.active ? "true" : "false");
    if (options.ariaLabel) {
        button.setAttribute("aria-label", options.ariaLabel);
    }
    button.disabled = options.disabled ?? false;
    setIcon(button, options.icon);
    button.onclick = async () => {
        if (!(await guard.beforeAction())) {
            return;
        }
        options.onClick();
    };
}

export function renderSidebarSearchInput(
    container: HTMLElement,
    options: SidebarSearchInputOptions,
): void {
    const searchGroup = container.createDiv("aside-sidebar-toolbar-group is-search-group");
    const fieldEl = searchGroup.createDiv("aside-note-search-field");
    const iconEl = fieldEl.createSpan({
        cls: "aside-note-search-icon",
    });
    setIcon(iconEl, "search");
    const inputEl = fieldEl.createEl("input", {
        cls: "aside-note-search-input",
    });
    inputEl.type = "search";
    inputEl.value = options.value;
    inputEl.spellcheck = false;
    inputEl.placeholder = options.placeholder;
    if (options.ariaLabel) {
        inputEl.setAttribute("aria-label", options.ariaLabel);
    }
    inputEl.addEventListener("focus", () => {
        options.onFocus?.(inputEl);
    });
    inputEl.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !inputEl.value) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        options.onClear();
    });
    inputEl.addEventListener("input", () => {
        options.onInput(inputEl.value, {
            selectionStart: inputEl.selectionStart,
            selectionEnd: inputEl.selectionEnd,
        });
    });
}

export function renderSidebarModeControl(
    container: HTMLElement,
    options: SidebarModeControlOptions,
    guard: ToolbarActionGuard,
): void {
    const modeGroup = container.createDiv("aside-sidebar-toolbar-group is-mode-group");
    const tabList = modeGroup.createDiv(`aside-tablist is-${options.mode}`);
    tabList.setAttribute("role", "tablist");
    renderTabButton(tabList, {
        label: "List",
        active: options.mode === "list",
        onClick: () => {
            options.onChange("list");
        },
    }, guard);
    if (options.showTagsTab) {
        renderTabButton(tabList, {
            label: "Tags",
            active: options.mode === "tags",
            disabled: !options.isTagsEnabled,
            onClick: () => {
                options.onChange("tags");
            },
        }, guard);
    }
    renderTabButton(tabList, {
        label: "Thought Trail",
        active: options.mode === "thought-trail",
        disabled: !options.isThoughtTrailEnabled,
        onClick: () => {
            options.onChange("thought-trail");
        },
    }, guard);
}

export function renderActiveFileFilters(
    container: HTMLElement,
    options: ActiveFileFiltersOptions,
    guard: ToolbarActionGuard,
): void {
    const filterBar = container.createDiv("aside-active-file-filters");
    const rootChip = filterBar.createDiv("aside-active-file-filter");
    rootChip.addClass("is-root");

    rootChip.createSpan({
        text: getIndexFileFilterLabel(options.rootFilePath, options.filteredIndexFilePaths),
        cls: "aside-active-file-filter-label",
    });

    const clearButton = rootChip.createEl("button", {
        cls: "aside-active-file-filter-clear clickable-icon",
    });
    clearButton.setAttribute("type", "button");
    clearButton.setAttribute("aria-label", `Clear file filter for ${options.rootFilePath}`);
    setIcon(clearButton, "x");
    clearButton.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!(await guard.beforeAction())) {
            return;
        }
        options.onClear();
    };

    const linkedFileCount = Math.max(0, options.filteredIndexFilePaths.length - 1);
    const summaryEl = filterBar.createDiv("aside-active-file-filter-summary");
    summaryEl.setText(
        linkedFileCount > 0
            ? `+${linkedFileCount} linked file${linkedFileCount === 1 ? "" : "s"}`
            : "1 file",
    );
}

function renderTabButton(
    container: HTMLElement,
    options: {
        label: string;
        active: boolean;
        disabled?: boolean;
        onClick: () => void;
    },
    guard: ToolbarActionGuard,
): void {
    const button = container.createEl("button", {
        cls: `aside-tab-button${options.active ? " aside-tab-button--active" : ""}`,
        text: options.label,
    });
    button.setAttribute("type", "button");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", options.active ? "true" : "false");
    button.disabled = options.disabled ?? false;
    if (options.disabled) {
        button.setAttribute("aria-disabled", "true");
    }
    button.tabIndex = options.active && !options.disabled ? 0 : -1;
    button.onclick = async () => {
        if (options.disabled) {
            return;
        }
        if (!(await guard.beforeAction())) {
            return;
        }
        options.onClick();
    };
}
