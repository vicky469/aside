const INDEX_SIDEBAR_LIST_LOADING_LABEL = "Loading comments";
const INDEX_SIDEBAR_LIST_LOADING_DOT_COUNT = 5;

const INDEX_SIDEBAR_PRESERVED_CHROME_SELECTOR = [
    ".aside-sidebar-toolbar",
    ".aside-active-file-filters",
].join(", ");

function createIndexSidebarListLoadingElement(ownerDocument: Document): HTMLDivElement {
    const loadingEl = createDetachedObsidianElement(ownerDocument, "div");
    loadingEl.className = "aside-index-list-loading";
    loadingEl.setAttribute("aria-label", INDEX_SIDEBAR_LIST_LOADING_LABEL);

    for (let dotIndex = 0; dotIndex < INDEX_SIDEBAR_LIST_LOADING_DOT_COUNT; dotIndex += 1) {
        const dotEl = createDetachedObsidianElement(ownerDocument, "span");
        dotEl.className = "aside-index-list-loading-dot";
        dotEl.setAttribute("aria-hidden", "true");
        dotEl.textContent = ".";
        loadingEl.appendChild(dotEl);
    }

    return loadingEl;
}

export function showIndexSidebarListLoadingState(container: Pick<Element, "querySelector">): boolean {
    const existingListEl = container.querySelector(".aside-comments-list");
    if (existingListEl) {
        existingListEl.replaceChildren(createIndexSidebarListLoadingElement(existingListEl.ownerDocument));
        return true;
    }

    const commentsContainerEl = container.querySelector(".aside-comments-container");
    if (!commentsContainerEl) {
        return false;
    }

    const loadingListEl = createDetachedObsidianElement(commentsContainerEl.ownerDocument, "div");
    loadingListEl.className = "aside-comments-list";
    loadingListEl.replaceChildren(createIndexSidebarListLoadingElement(commentsContainerEl.ownerDocument));

    const preservedChrome = Array.from(commentsContainerEl.children)
        .filter((child) => child.matches(INDEX_SIDEBAR_PRESERVED_CHROME_SELECTOR));
    commentsContainerEl.replaceChildren(...preservedChrome, loadingListEl);
    return true;
}
import { createDetachedObsidianElement } from "../dom/createDetachedObsidianElement";
