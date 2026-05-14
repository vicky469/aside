import type { AgentRunStreamState } from "../../core/agents/agentRuns";
import { getAgentActorLabel } from "../../core/agents/agentActorRegistry";
import { getAgentRunStatusPresentation } from "./sidebarPersistedComment";
import { formatSidebarCommentMeta } from "./sidebarCommentSections";
import { nodeInstanceOf } from "../domGuards";

function createElement<K extends keyof HTMLElementTagNameMap>(
    ownerDocument: Document,
    tagName: K,
    className?: string,
): HTMLElementTagNameMap[K] {
    const element = ownerDocument.createElement(tagName);
    if (className) {
        element.className = className;
    }
    return element;
}

type StreamedAgentReplyControllerOptions = {
    onCancelRun?: (runId: string) => void;
};

export class StreamedAgentReplyController {
    private cardEl: HTMLDivElement | null = null;
    private metaValueEl: HTMLSpanElement | null = null;
    private contentEl: HTMLDivElement | null = null;
    private labelEl: HTMLSpanElement | null = null;
    private statusEl: HTMLSpanElement | null = null;
    private actionsEl: HTMLDivElement | null = null;
    private runId: string | null = null;
    private ownsCard = false;
    private borrowedSnapshot: {
        metaText: string;
        labelClassName: string;
        labelText: string;
        labelHidden: boolean;
        labelDisplay: string;
        statusClassName: string;
        statusNodes: Node[];
        statusAriaLabel: string | null;
        statusTitle: string | null;
        contentNodes: Node[];
        actionsClassName: string;
        actionsNodes: Node[];
    } | null = null;

    constructor(
        private readonly threadId: string,
        private readonly options: StreamedAgentReplyControllerOptions = {},
    ) {}

    public sync(containerEl: HTMLElement, stream: AgentRunStreamState): void {
        const threadEl = this.findThreadElement(containerEl);
        if (!threadEl) {
            this.clear();
            return;
        }

        const repliesEl = this.ensureRepliesContainer(threadEl);
        const cardEl = this.ensureCard(threadEl, repliesEl, stream.outputEntryId ?? null);
        const metaValueEl = this.metaValueEl;
        const labelEl = this.labelEl;
        const statusEl = this.statusEl;
        const contentEl = this.contentEl;
        const actionsEl = this.actionsEl;
        if (
            !nodeInstanceOf(metaValueEl, HTMLSpanElement)
            || !nodeInstanceOf(labelEl, HTMLSpanElement)
            || !nodeInstanceOf(statusEl, HTMLSpanElement)
            || !nodeInstanceOf(contentEl, HTMLDivElement)
            || !nodeInstanceOf(actionsEl, HTMLDivElement)
        ) {
            return;
        }

        const metaText = formatSidebarCommentMeta({ timestamp: stream.startedAt });
        if (metaValueEl.textContent !== metaText) {
            metaValueEl.textContent = metaText;
        }

        const label = getAgentActorLabel(stream.requestedAgent);
        labelEl.className = `aside-comment-author-indicator aside-agent-stream-author is-${stream.requestedAgent}`;
        if (labelEl.textContent !== label) {
            labelEl.textContent = label;
        }
        const hideAgentLabel = stream.status === "queued" || stream.status === "running";
        labelEl.hidden = hideAgentLabel;
        labelEl.style.display = hideAgentLabel ? "none" : "";

        this.syncStatus(statusEl, label, stream);
        this.syncActions(actionsEl, stream);

        if (contentEl.textContent !== stream.partialText) {
            contentEl.textContent = stream.partialText;
        }
        cardEl.classList.toggle("is-empty", stream.partialText.trim().length === 0);

        this.runId = stream.runId;
        cardEl.setAttribute("data-agent-run-id", stream.runId);
        if (stream.outputEntryId) {
            cardEl.setAttribute("data-agent-output-entry-id", stream.outputEntryId);
        } else {
            cardEl.removeAttribute("data-agent-output-entry-id");
        }
    }

    public clear(): void {
        if (this.ownsCard) {
            this.cardEl?.remove();
        } else {
            this.restoreBorrowedCard();
            this.cardEl?.classList.remove("aside-agent-stream-active", "aside-agent-stream-item", "is-empty");
            this.cardEl?.removeAttribute("data-agent-run-id");
            this.cardEl?.removeAttribute("data-agent-output-entry-id");
        }

        this.cardEl = null;
        this.metaValueEl = null;
        this.contentEl = null;
        this.labelEl = null;
        this.statusEl = null;
        this.actionsEl = null;
        this.runId = null;
        this.ownsCard = false;
        this.borrowedSnapshot = null;
    }

    private syncStatus(statusEl: HTMLSpanElement, label: string, stream: AgentRunStreamState): void {
        const presentation = getAgentRunStatusPresentation(stream.status);
        const statusText = stream.statusText?.trim() || null;
        const statusHintText = stream.statusHintText?.trim() || null;
        const shouldShowStatusText = stream.status !== "running" && stream.status !== "queued";
        statusEl.className = `aside-agent-run-status is-${stream.status}`;
        statusEl.replaceChildren();
        const ownerDocument = statusEl.ownerDocument;

        const markEl = createElement(ownerDocument, "span", `aside-agent-run-status-mark is-${presentation.markerKind}`);
        if (presentation.marker) {
            markEl.textContent = presentation.marker;
        } else {
            markEl.setAttribute("aria-hidden", "true");
        }
        statusEl.appendChild(markEl);

        if (shouldShowStatusText && statusText) {
            const textEl = createElement(ownerDocument, "span", "aside-agent-run-status-text");
            textEl.textContent = statusText;
            statusEl.appendChild(textEl);
        }

        if (statusHintText) {
            const hintEl = createElement(ownerDocument, "span", "aside-agent-run-status-hint");
            hintEl.textContent = statusHintText;
            statusEl.appendChild(hintEl);
        }

        const accessibleStatus = [statusHintText, statusText ?? stream.status].filter(Boolean).join(". ");
        statusEl.setAttribute("aria-label", `${label} ${accessibleStatus}`);
        if (stream.error) {
            statusEl.setAttribute("title", stream.error);
            return;
        }

        statusEl.removeAttribute("title");
    }

    private syncActions(actionsEl: HTMLDivElement, stream: AgentRunStreamState): void {
        actionsEl.replaceChildren();
        if (
            !this.options.onCancelRun
            || (stream.status !== "queued" && stream.status !== "running")
        ) {
            return;
        }

        const cancelButton = actionsEl.createEl("button", {
            cls: "aside-agent-stream-cancel-button",
            text: "Cancel",
        });
        cancelButton.setAttribute("type", "button");
        cancelButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.options.onCancelRun?.(stream.runId);
        };
    }

    private findThreadElement(containerEl: HTMLElement): HTMLDivElement | null {
        const threadEl = containerEl.querySelector(`.aside-thread-stack[data-thread-id="${this.threadId}"]`);
        return nodeInstanceOf(threadEl, HTMLDivElement) ? threadEl : null;
    }

    private ensureRepliesContainer(threadEl: HTMLDivElement): HTMLDivElement {
        const existing = threadEl.querySelector(".aside-thread-replies");
        if (nodeInstanceOf(existing, HTMLDivElement)) {
            return existing;
        }

        const repliesEl = createElement(threadEl.ownerDocument, "div", "aside-thread-replies");
        threadEl.appendChild(repliesEl);
        return repliesEl;
    }

    private ensureCard(
        threadEl: HTMLDivElement,
        repliesEl: HTMLDivElement,
        outputEntryId: string | null,
    ): HTMLDivElement {
        const isCardConnected = this.cardEl?.isConnected
            && (
                this.cardEl.parentElement === repliesEl
                || this.cardEl.closest(`.aside-thread-stack[data-thread-id="${this.threadId}"]`) === threadEl
            );
        if (isCardConnected) {
            const cardCommentId = this.cardEl!.getAttribute("data-comment-id");
            const cardRunId = this.cardEl!.getAttribute("data-agent-run-id");
            const targetMatches = outputEntryId
                ? cardCommentId === outputEntryId
                : cardRunId === this.runId;
            if (targetMatches) {
                return this.cardEl!;
            }

            this.clear();
        }

        if (outputEntryId) {
            const persisted = threadEl.querySelector(`.aside-thread-entry-item[data-comment-id="${outputEntryId}"]`);
            if (nodeInstanceOf(persisted, HTMLDivElement)) {
                this.cardEl = persisted;
                this.ownsCard = false;
                const metaValueEl = persisted.querySelector(".aside-comment-meta-value");
                const labelEl = persisted.querySelector(".aside-comment-author-indicator");
                const statusEl = persisted.querySelector(".aside-agent-run-status");
                const contentEl = persisted.querySelector(".aside-comment-content");
                const actionsEl = persisted.querySelector(".aside-comment-actions");
                this.metaValueEl = nodeInstanceOf(metaValueEl, HTMLSpanElement) ? metaValueEl : null;
                this.labelEl = nodeInstanceOf(labelEl, HTMLSpanElement) ? labelEl : null;
                this.statusEl = nodeInstanceOf(statusEl, HTMLSpanElement) ? statusEl : null;
                this.contentEl = nodeInstanceOf(contentEl, HTMLDivElement) ? contentEl : null;
                this.actionsEl = nodeInstanceOf(actionsEl, HTMLDivElement) ? actionsEl : null;
                this.captureBorrowedCardSnapshot();
                persisted.classList.add("aside-agent-stream-active", "aside-agent-stream-item");
                return persisted;
            }
        }

        if (this.runId) {
            const existing = repliesEl.querySelector(`.aside-agent-stream-item[data-agent-run-id="${this.runId}"]`);
            if (nodeInstanceOf(existing, HTMLDivElement)) {
                this.cardEl = existing;
                this.ownsCard = true;
                const metaValueEl = existing.querySelector(".aside-agent-stream-meta-value");
                const labelEl = existing.querySelector(".aside-agent-stream-author");
                const statusEl = existing.querySelector(".aside-agent-run-status");
                const contentEl = existing.querySelector(".aside-agent-stream-content");
                const actionsEl = existing.querySelector(".aside-comment-actions");
                this.metaValueEl = nodeInstanceOf(metaValueEl, HTMLSpanElement) ? metaValueEl : null;
                this.labelEl = nodeInstanceOf(labelEl, HTMLSpanElement) ? labelEl : null;
                this.statusEl = nodeInstanceOf(statusEl, HTMLSpanElement) ? statusEl : null;
                this.contentEl = nodeInstanceOf(contentEl, HTMLDivElement) ? contentEl : null;
                this.actionsEl = nodeInstanceOf(actionsEl, HTMLDivElement) ? actionsEl : null;
                return existing;
            }
        }

        const ownerDocument = threadEl.ownerDocument;
        const cardEl = createElement(ownerDocument, "div", "aside-comment-item aside-thread-item aside-thread-entry-item aside-agent-stream-item");
        const headerEl = createElement(ownerDocument, "div", "aside-comment-header");
        const headerMainEl = createElement(ownerDocument, "div", "aside-comment-header-main");
        const metaEl = createElement(ownerDocument, "small", "aside-timestamp aside-comment-meta");
        const metaValueEl = createElement(ownerDocument, "span", "aside-comment-meta-value aside-agent-stream-meta-value");
        metaEl.appendChild(metaValueEl);
        headerMainEl.appendChild(metaEl);
        headerEl.appendChild(headerMainEl);
        const actionsEl = createElement(ownerDocument, "div", "aside-comment-actions aside-agent-stream-actions");
        headerEl.appendChild(actionsEl);
        const contentEl = createElement(ownerDocument, "div", "aside-comment-content aside-agent-stream-content");
        const footerEl = createElement(ownerDocument, "div", "aside-thread-footer");
        const footerMetaEl = createElement(ownerDocument, "div", "aside-thread-footer-meta");
        const labelEl = createElement(ownerDocument, "span", "aside-comment-author-indicator aside-agent-stream-author");
        const statusEl = createElement(ownerDocument, "span", "aside-agent-run-status is-running");
        const markEl = createElement(ownerDocument, "span", "aside-agent-run-status-mark is-spinner");
        markEl.setAttribute("aria-hidden", "true");
        statusEl.appendChild(markEl);

        footerMetaEl.appendChild(labelEl);
        footerMetaEl.appendChild(statusEl);
        footerEl.appendChild(footerMetaEl);
        cardEl.appendChild(headerEl);
        cardEl.appendChild(contentEl);
        cardEl.appendChild(footerEl);
        repliesEl.appendChild(cardEl);

        this.cardEl = cardEl;
        this.ownsCard = true;
        this.metaValueEl = metaValueEl;
        this.labelEl = labelEl;
        this.statusEl = statusEl;
        this.contentEl = contentEl;
        this.actionsEl = actionsEl;
        return cardEl;
    }

    private captureBorrowedCardSnapshot(): void {
        if (this.ownsCard) {
            this.borrowedSnapshot = null;
            return;
        }

        this.borrowedSnapshot = {
            metaText: this.metaValueEl?.textContent ?? "",
            labelClassName: this.labelEl?.className ?? "",
            labelText: this.labelEl?.textContent ?? "",
            labelHidden: this.labelEl?.hidden ?? false,
            labelDisplay: this.labelEl?.style.display ?? "",
            statusClassName: this.statusEl?.className ?? "",
            statusNodes: Array.from(this.statusEl?.childNodes ?? []),
            statusAriaLabel: this.statusEl?.getAttribute("aria-label") ?? null,
            statusTitle: this.statusEl?.getAttribute("title") ?? null,
            contentNodes: Array.from(this.contentEl?.childNodes ?? []),
            actionsClassName: this.actionsEl?.className ?? "",
            actionsNodes: Array.from(this.actionsEl?.childNodes ?? []),
        };
    }

    private restoreBorrowedCard(): void {
        if (this.ownsCard || !this.borrowedSnapshot) {
            return;
        }

        if (this.metaValueEl) {
            this.metaValueEl.textContent = this.borrowedSnapshot.metaText;
        }
        if (this.labelEl) {
            this.labelEl.className = this.borrowedSnapshot.labelClassName;
            this.labelEl.textContent = this.borrowedSnapshot.labelText;
            this.labelEl.hidden = this.borrowedSnapshot.labelHidden;
            this.labelEl.style.display = this.borrowedSnapshot.labelDisplay;
        }
        if (this.statusEl) {
            this.statusEl.className = this.borrowedSnapshot.statusClassName;
            this.statusEl.replaceChildren(...this.borrowedSnapshot.statusNodes);
            if (this.borrowedSnapshot.statusAriaLabel) {
                this.statusEl.setAttribute("aria-label", this.borrowedSnapshot.statusAriaLabel);
            } else {
                this.statusEl.removeAttribute("aria-label");
            }
            if (this.borrowedSnapshot.statusTitle) {
                this.statusEl.setAttribute("title", this.borrowedSnapshot.statusTitle);
            } else {
                this.statusEl.removeAttribute("title");
            }
        }
        if (this.contentEl) {
            this.contentEl.replaceChildren(...this.borrowedSnapshot.contentNodes);
        }
        if (this.actionsEl) {
            this.actionsEl.className = this.borrowedSnapshot.actionsClassName;
            this.actionsEl.replaceChildren(...this.borrowedSnapshot.actionsNodes);
        }
    }
}
