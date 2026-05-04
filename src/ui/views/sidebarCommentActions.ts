import type { Comment } from "../../commentManager";
import type { SidebarPersistedCommentHost } from "./sidebarPersistedComment";

export interface PersistedCommentPinActionPresentation {
    active: boolean;
    ariaLabel: string;
}

export function buildPersistedCommentPinActionPresentation(isPinned: boolean): PersistedCommentPinActionPresentation {
    return {
        active: isPinned,
        ariaLabel: isPinned ? "Unpin this side note" : "Pin this side note",
    };
}

export function renderSourceRedirectButton(
    actionsEl: HTMLDivElement,
    comment: Comment,
    ariaLabel: string,
    icon: string,
    host: SidebarPersistedCommentHost,
): void {
    const redirectButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-redirect",
    });
    attachSidebarActionButtonInteractions(redirectButton, host);
    redirectButton.setAttribute("type", "button");
    redirectButton.setAttribute("aria-label", ariaLabel);
    if (icon === "obsidian-external-link") {
        renderObsidianExternalLinkIcon(redirectButton);
    } else {
        host.setIcon(redirectButton, icon);
    }
    redirectButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        void host.openCommentInEditor(comment);
    };
}

export function renderEditButton(
    actionsEl: HTMLDivElement,
    commentId: string,
    host: SidebarPersistedCommentHost,
    ariaLabel: string,
): void {
    const editButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-edit",
    });
    attachSidebarActionButtonInteractions(editButton, host);
    editButton.setAttribute("type", "button");
    editButton.setAttribute("aria-label", ariaLabel);
    host.setIcon(editButton, "pencil");
    editButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        host.startEditDraft(commentId, host.currentFilePath);
    };
}

export function renderDeleteButton(
    actionsEl: HTMLDivElement,
    commentId: string,
    host: SidebarPersistedCommentHost,
    ariaLabel: string,
): void {
    const deleteButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-delete",
    });
    attachSidebarActionButtonInteractions(deleteButton, host);
    deleteButton.setAttribute("type", "button");
    deleteButton.setAttribute("aria-label", ariaLabel);
    host.setIcon(deleteButton, "trash-2");
    deleteButton.onclick = async (event) => {
        await runSidebarPendingButtonAction(deleteButton, host, event, async () => {
            await host.deleteCommentWithConfirm(commentId);
        });
    };
}

export function renderMoveActionButton(
    actionsEl: HTMLDivElement,
    host: SidebarPersistedCommentHost,
    options: {
        ariaLabel: string;
        icon: string;
        onMove: () => Promise<void> | void;
    },
): void {
    const moveButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-move",
    });
    attachSidebarActionButtonInteractions(moveButton, host);
    moveButton.setAttribute("type", "button");
    moveButton.setAttribute("aria-label", options.ariaLabel);
    host.setIcon(moveButton, options.icon);
    moveButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        await options.onMove();
    };
}

export function renderPinActionButton(
    actionsEl: HTMLDivElement,
    threadId: string,
    isPinned: boolean,
    host: SidebarPersistedCommentHost,
): void {
    const pinAction = buildPersistedCommentPinActionPresentation(isPinned);
    const pinButton = actionsEl.createEl("button", {
        cls: [
            "clickable-icon",
            "sidenote2-comment-action-button",
            "sidenote2-comment-action-pin",
            pinAction.active ? "is-active" : "",
        ].filter(Boolean).join(" "),
    });
    attachSidebarActionButtonInteractions(pinButton, host);
    pinButton.setAttribute("type", "button");
    pinButton.setAttribute("aria-label", pinAction.ariaLabel);
    pinButton.setAttribute("aria-pressed", pinAction.active ? "true" : "false");
    host.setIcon(pinButton, "pin");
    pinButton.onclick = async (event) => {
        await runSidebarPendingButtonAction(pinButton, host, event, async () => {
            await host.togglePinnedThread(threadId);
        });
    };
}

export function renderRestoreButton(
    actionsEl: HTMLDivElement,
    commentId: string,
    host: SidebarPersistedCommentHost,
    ariaLabel: string,
): void {
    const restoreButton = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-action-restore",
    });
    attachSidebarActionButtonInteractions(restoreButton, host);
    restoreButton.setAttribute("type", "button");
    restoreButton.setAttribute("aria-label", ariaLabel);
    host.setIcon(restoreButton, "rotate-ccw");
    restoreButton.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        await host.restoreComment(commentId);
    };
}

export function renderAddEntryButton(
    actionsEl: HTMLDivElement,
    commentId: string,
    host: SidebarPersistedCommentHost,
    options: {
        ariaLabel: string;
        extraClasses?: string[];
        icon?: string;
    },
): void {
    const addEntryButton = actionsEl.createEl("button", {
        cls: [
            "clickable-icon",
            "sidenote2-comment-action-button",
            "sidenote2-comment-action-add-entry",
            ...(options.extraClasses ?? []),
        ].join(" "),
    });
    attachSidebarActionButtonInteractions(addEntryButton, host);
    addEntryButton.setAttribute("type", "button");
    addEntryButton.setAttribute("aria-label", options.ariaLabel);
    host.setIcon(addEntryButton, options.icon ?? "plus");
    addEntryButton.onclick = async (event) => {
        event.stopPropagation();
        if (!(await host.saveVisibleDraftIfPresent())) {
            return;
        }
        host.startAppendEntryDraft(commentId, host.currentFilePath);
    };
}

export function renderReorderHandle(
    actionsEl: HTMLDivElement,
    threadId: string,
    host: SidebarPersistedCommentHost,
): void {
    const handleEl = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-drag-handle",
    });
    attachSidebarActionButtonInteractions(handleEl, host);
    handleEl.setAttribute("type", "button");
    handleEl.setAttribute("draggable", "true");
    handleEl.setAttribute("aria-label", "Drag to reorder");
    handleEl.setAttribute("data-sidenote2-drag-kind", "thread");
    handleEl.setAttribute("data-sidenote2-thread-id", threadId);

    const blockClick = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    handleEl.addEventListener("click", blockClick);
    host.setIcon(handleEl, "grip-vertical");
}

export function renderEntryMoveHandle(
    actionsEl: HTMLDivElement,
    entryId: string,
    sourceThreadId: string,
    host: SidebarPersistedCommentHost,
): void {
    const handleEl = actionsEl.createEl("button", {
        cls: "clickable-icon sidenote2-comment-action-button sidenote2-comment-drag-handle",
    });
    attachSidebarActionButtonInteractions(handleEl, host);
    handleEl.setAttribute("type", "button");
    handleEl.setAttribute("draggable", "true");
    handleEl.setAttribute("aria-label", "Drag to reorder");
    handleEl.setAttribute("data-sidenote2-drag-kind", "thread-entry");
    handleEl.setAttribute("data-sidenote2-thread-id", sourceThreadId);
    handleEl.setAttribute("data-sidenote2-entry-id", entryId);

    const blockClick = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    handleEl.addEventListener("click", blockClick);
    host.setIcon(handleEl, "grip-vertical");
}

export function attachSidebarActionButtonInteractions(
    buttonEl: HTMLElement,
    host: SidebarPersistedCommentHost,
): void {
    buttonEl.addEventListener("mousedown", (event: MouseEvent) => {
        host.claimSidebarInteractionOwnership();
        event.stopPropagation();
    });
}

export async function runSidebarPendingButtonAction(
    buttonEl: HTMLButtonElement,
    host: SidebarPersistedCommentHost,
    event: MouseEvent,
    action: () => Promise<void>,
): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (buttonEl.disabled) {
        return;
    }
    if (!(await host.saveVisibleDraftIfPresent())) {
        return;
    }

    buttonEl.disabled = true;
    buttonEl.classList.add("is-pending");
    try {
        await action();
    } finally {
        buttonEl.classList.remove("is-pending");
        buttonEl.disabled = false;
    }
}

function renderObsidianExternalLinkIcon(container: HTMLElement): void {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(svgNamespace, "svg");
    svgEl.setAttribute("xmlns", svgNamespace);
    svgEl.setAttribute("class", "svg-icon sidenote2-obsidian-external-link-icon");
    svgEl.setAttribute("viewBox", "0 0 32 32");
    svgEl.setAttribute("fill", "none");
    svgEl.setAttribute("stroke", "currentColor");
    svgEl.setAttribute("stroke-width", "3");
    svgEl.setAttribute("stroke-linecap", "round");
    svgEl.setAttribute("stroke-linejoin", "round");
    svgEl.setAttribute("aria-hidden", "true");

    const paths = [
        "M14 9H3v20h20V18",
        "M18 4h10v10",
        "M28 4 14 18",
    ];
    for (const d of paths) {
        const pathEl = document.createElementNS(svgNamespace, "path");
        pathEl.setAttribute("d", d);
        svgEl.appendChild(pathEl);
    }

    container.replaceChildren(svgEl);
}
