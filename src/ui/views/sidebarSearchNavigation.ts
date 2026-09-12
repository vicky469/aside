export interface SidebarSearchTarget {
    id: string;
    element: HTMLElement;
}

export interface SidebarSearchNavigationState {
    current: number;
    total: number;
}

export class SidebarSearchNavigation {
    private targets: SidebarSearchTarget[] = [];
    private index = -1;
    private activeId: string | null = null;
    private context = "";
    private query = "";
    private inputQuery: string | null = null;
    private listener: ((state: SidebarSearchNavigationState) => void) | null = null;

    getState(): SidebarSearchNavigationState {
        if (this.isPending()) return { current: 0, total: 0 };
        return { current: this.index + 1, total: this.targets.length };
    }

    setTargets(targets: SidebarSearchTarget[], context: string, query = context): void {
        this.clearActiveStyle();
        if (this.context !== context) this.activeId = null;
        this.context = context;
        this.query = query.trim();
        this.targets = targets;
        this.index = this.activeId === null ? -1 : targets.findIndex((target) => target.id === this.activeId);
        if (this.index === -1) this.activeId = null;
        if (!this.isPending()) this.targets[this.index]?.element.classList.add("is-active-search-match");
        this.notify();
    }

    invalidate(): void {
        this.clearActiveStyle();
        this.targets = [];
        this.index = -1;
        this.notify();
    }

    observe(listener: ((state: SidebarSearchNavigationState) => void) | null): void {
        this.listener = listener;
        this.notify();
    }

    setInputQuery(query: string): void {
        this.inputQuery = query.trim();
        if (this.isPending()) {
            this.clearActiveStyle();
        } else {
            this.targets[this.index]?.element.classList.add("is-active-search-match");
        }
        this.notify();
    }

    navigate(direction: -1 | 1): void {
        if (this.isPending()) return;
        const count = this.targets.length;
        if (!count) return;
        const nextIndex = this.index === -1
            ? (direction === 1 ? 0 : count - 1)
            : (this.index + direction + count) % count;
        const target = this.targets[nextIndex];
        if (!target.element.isConnected) {
            this.invalidate();
            return;
        }
        this.clearActiveStyle();
        this.index = nextIndex;
        this.activeId = target.id;
        target.element.classList.add("is-active-search-match");
        target.element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        this.notify();
    }

    private clearActiveStyle(): void {
        this.targets[this.index]?.element.classList.remove("is-active-search-match");
    }

    private notify(): void {
        this.listener?.(this.getState());
    }

    private isPending(): boolean {
        return this.inputQuery !== null && this.inputQuery !== this.query;
    }
}

export function collectSidebarSearchTargets(container: HTMLElement): SidebarSearchTarget[] {
    const counts = new Map<string, number>();
    return Array.from(container.querySelectorAll<HTMLElement>("mark.aside-search-match")).map((element) => {
        const card = element.closest<HTMLElement>("[data-comment-id]");
        const cardId = card?.getAttribute("data-comment-id") ?? "content";
        const occurrence = counts.get(cardId) ?? 0;
        counts.set(cardId, occurrence + 1);
        return { id: JSON.stringify([cardId, occurrence]), element };
    });
}

export function renderSidebarSearchNavigation(
    fieldEl: HTMLElement,
    inputEl: HTMLInputElement,
    navigation: SidebarSearchNavigation,
    renderIcon: (element: HTMLElement, icon: string) => void,
): void {
    const controls = fieldEl.createDiv("aside-search-navigation");
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Navigate search results");
    const counter = controls.createSpan("aside-search-navigation-count");
    counter.setAttribute("role", "status");
    counter.setAttribute("aria-live", "polite");
    counter.setAttribute("aria-atomic", "true");
    const buttons: HTMLButtonElement[] = [];
    navigation.setInputQuery(inputEl.value);
    for (const [direction, icon, label] of [
        [-1, "chevron-up", "Previous match (Shift+Enter)"],
        [1, "chevron-down", "Next match (Enter)"],
    ] as const) {
        const button = controls.createEl("button", { cls: "clickable-icon aside-search-navigation-button" });
        button.type = "button";
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        renderIcon(button, icon);
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!button.disabled) navigation.navigate(direction);
        });
        buttons.push(button);
    }
    navigation.observe(({ current, total }) => {
        counter.textContent = `${current}/${total}`;
        counter.setAttribute("aria-label", total ? `Match ${current} of ${total}` : "No matches");
        for (const button of buttons) button.disabled = inputEl.disabled || total === 0;
    });
    inputEl.addEventListener("input", () => navigation.setInputQuery(inputEl.value));
    inputEl.addEventListener("keydown", (event) => {
        if (inputEl.disabled || event.isComposing) return;
        if (event.key === "Escape") {
            navigation.setInputQuery("");
        } else if (event.key === "Enter" && inputEl.value.trim()) {
            event.preventDefault();
            event.stopPropagation();
            navigation.navigate(event.shiftKey ? -1 : 1);
        }
    });
}
