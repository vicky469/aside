import type { AgentRunStreamState } from "../../core/agents/agentRuns";
import { getAgentRunStatusPresentation } from "./sidebarPersistedComment";
import { getAgentRunAuthorLabel } from "./agentRunAuthor";
import { formatSidebarCommentMeta } from "./sidebarCommentSections";
import { nodeInstanceOf } from "../domGuards";
import { createDetachedObsidianElement } from "../dom/createDetachedObsidianElement";

function createElement<K extends keyof HTMLElementTagNameMap>(
    ownerDocument: Document,
    tagName: K,
    className?: string,
): HTMLElementTagNameMap[K] {
    const element = createDetachedObsidianElement(ownerDocument, tagName);
    if (className) {
        element.className = className;
    }
    return element;
}

type StreamedAgentReplyControllerOptions = {
    onCancelRun?: (runId: string) => void;
    renderFinalMarkdown?: (markdown: string, container: HTMLElement) => Promise<void>;
    onFinalMarkdownRenderError?: (error: unknown) => void;
    adoptPersistedCardInteractions?: (
        persistedCardEl: HTMLDivElement,
        retainedCardEl: HTMLDivElement,
    ) => (() => void) | null;
};

function isAgentStreamBusy(stream: Pick<AgentRunStreamState, "status">): boolean {
    return stream.status === "queued" || stream.status === "running";
}

function shouldKeepAgentStreamCardExclusive(stream: Pick<AgentRunStreamState, "status">): boolean {
    return isAgentStreamBusy(stream) || stream.status === "succeeded";
}

export function formatAgentProcessLogText(
    stream: Pick<AgentRunStreamState, "processLogLines">,
): string {
    return (stream.processLogLines ?? [])
        .map((line) => line.replace(/\s+/gu, " ").trim())
        .filter((line) => line.length > 0)
        .join("\n");
}

function formatAgentStatusHintText(stream: AgentRunStreamState): string | null {
    const processLogText = stream.status === "queued" || stream.status === "running"
        ? formatAgentProcessLogText(stream)
        : "";
    const latestProcessLogLine = processLogText.split("\n").filter((line) => line.length > 0).at(-1) ?? "";
    return latestProcessLogLine || stream.statusHintText?.trim() || null;
}

export class StreamedAgentReplyController {
    private cardEl: HTMLDivElement | null = null;
    private metaValueEl: HTMLSpanElement | null = null;
    private processLogEl: HTMLDivElement | null = null;
    private contentEl: HTMLDivElement | null = null;
    private labelEl: HTMLSpanElement | null = null;
    private statusEl: HTMLSpanElement | null = null;
    private statusMarkEl: HTMLSpanElement | null = null;
    private statusTextEl: HTMLSpanElement | null = null;
    private statusHintEl: HTMLSpanElement | null = null;
    private footerMetaEl: HTMLDivElement | null = null;
    private actionsEl: HTMLDivElement | null = null;
    private runId: string | null = null;
    private finalRenderGeneration = 0;
    private finalRenderKey: string | null = null;
    private finalRenderContentEl: HTMLDivElement | null = null;
    private ownsCard = false;
    private persistedHandoffSnapshot: {
        className: string;
        attributes: Array<{ name: string; value: string }>;
        childNodes: Node[];
    } | null = null;
    private persistedCardInteractionCleanup: (() => void) | null = null;
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
        footerMetaClassName: string;
        footerMetaNodes: Node[];
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

        const label = getAgentRunAuthorLabel(stream);
        labelEl.className = `aside-comment-author-indicator aside-agent-stream-author is-${stream.requestedAgent}`;
        if (labelEl.textContent !== label) {
            labelEl.textContent = label;
        }
        const hideAgentLabel = stream.status === "queued" || stream.status === "running";
        labelEl.hidden = hideAgentLabel;
        labelEl.style.display = hideAgentLabel ? "none" : "";

        this.syncBorrowedFooterMeta(stream);
        this.syncStatus(statusEl, label, stream);
        this.syncActions(actionsEl, stream);

        const processLogText = formatAgentProcessLogText(stream);
        this.processLogEl?.remove();
        this.processLogEl = null;

        this.syncContent(contentEl, stream);
        cardEl.classList.toggle(
            "is-empty",
            stream.partialText.trim().length === 0 && processLogText.length === 0,
        );

        this.runId = stream.runId;
        cardEl.setAttribute("data-agent-run-id", stream.runId);
        if (stream.outputEntryId) {
            cardEl.setAttribute("data-agent-output-entry-id", stream.outputEntryId);
        } else {
            cardEl.removeAttribute("data-agent-output-entry-id");
        }
    }

    public handoffToPersistedThread(
        nextThreadEl: HTMLElement,
        stream: AgentRunStreamState,
    ): boolean {
        const cardEl = this.cardEl;
        const outputEntryId = stream.outputEntryId
            ?? cardEl?.getAttribute("data-agent-output-entry-id")
            ?? null;
        const canRetainCard = this.ownsCard || this.persistedHandoffSnapshot !== null;
        if (!canRetainCard || !cardEl || stream.runId !== this.runId || !outputEntryId) {
            return false;
        }

        const persistedCardEl = nextThreadEl.querySelector(
            `.aside-thread-entry-item[data-comment-id="${outputEntryId}"]`,
        );
        if (!nodeInstanceOf(persistedCardEl, HTMLDivElement)) {
            return false;
        }

        this.persistedHandoffSnapshot = {
            className: persistedCardEl.className,
            attributes: Array.from(persistedCardEl.attributes).map((attribute) => ({
                name: attribute.name,
                value: attribute.value,
            })),
            childNodes: Array.from(persistedCardEl.childNodes),
        };
        persistedCardEl.replaceWith(cardEl);
        this.persistedCardInteractionCleanup?.();
        this.persistedCardInteractionCleanup = this.options.adoptPersistedCardInteractions?.(
            persistedCardEl,
            cardEl,
        ) ?? null;
        cardEl.setAttribute("data-comment-id", outputEntryId);
        this.ownsCard = false;
        return true;
    }

    public clear(): void {
        this.invalidateFinalRender();
        if (this.ownsCard) {
            this.cardEl?.remove();
        } else {
            this.restoreBorrowedCard();
            this.cardEl?.classList.remove("aside-agent-stream-active", "aside-agent-stream-item", "is-empty");
            this.cardEl?.removeAttribute("data-agent-run-id");
            this.cardEl?.removeAttribute("data-agent-output-entry-id");
            this.processLogEl?.remove();
        }

        this.cardEl = null;
        this.metaValueEl = null;
        this.processLogEl = null;
        this.contentEl = null;
        this.labelEl = null;
        this.statusEl = null;
        this.statusMarkEl = null;
        this.statusTextEl = null;
        this.statusHintEl = null;
        this.footerMetaEl = null;
        this.actionsEl = null;
        this.runId = null;
        this.ownsCard = false;
        this.persistedHandoffSnapshot = null;
        this.persistedCardInteractionCleanup = null;
        this.borrowedSnapshot = null;
    }

    private syncStatus(statusEl: HTMLSpanElement, label: string, stream: AgentRunStreamState): void {
        const presentation = getAgentRunStatusPresentation(stream.status);
        const statusText = stream.statusText?.trim() || null;
        const statusHintText = formatAgentStatusHintText(stream);
        const shouldShowStatusText = stream.status !== "running" && stream.status !== "queued";
        statusEl.className = `aside-agent-run-status is-${stream.status}`;
        const ownerDocument = statusEl.ownerDocument;

        const markEl = this.statusMarkEl
            ?? createElement(ownerDocument, "span", `aside-agent-run-status-mark is-${presentation.markerKind}`);
        if (!this.statusMarkEl) {
            statusEl.appendChild(markEl);
            this.statusMarkEl = markEl;
        }
        markEl.className = `aside-agent-run-status-mark is-${presentation.markerKind}`;
        if (presentation.marker) {
            markEl.textContent = presentation.marker;
            markEl.removeAttribute("aria-hidden");
        } else {
            markEl.textContent = "";
            markEl.setAttribute("aria-hidden", "true");
        }

        if (shouldShowStatusText && statusText) {
            const textEl = this.statusTextEl
                ?? createElement(ownerDocument, "span", "aside-agent-run-status-text");
            if (!this.statusTextEl) {
                statusEl.insertBefore(textEl, this.statusHintEl);
                this.statusTextEl = textEl;
            }
            textEl.textContent = statusText;
        } else {
            this.statusTextEl?.remove();
            this.statusTextEl = null;
        }

        if (statusHintText) {
            const hintEl = this.statusHintEl
                ?? createElement(ownerDocument, "span", "aside-agent-run-status-hint");
            if (!this.statusHintEl) {
                statusEl.appendChild(hintEl);
                this.statusHintEl = hintEl;
            }
            hintEl.textContent = statusHintText;
        } else {
            this.statusHintEl?.remove();
            this.statusHintEl = null;
        }

        const accessibleStatus = [statusHintText, statusText ?? stream.status].filter(Boolean).join(". ");
        statusEl.setAttribute("aria-label", `${label} ${accessibleStatus}`);
        if (stream.error) {
            statusEl.setAttribute("title", stream.error);
            return;
        }

        statusEl.removeAttribute("title");
    }

    private syncContent(contentEl: HTMLDivElement, stream: AgentRunStreamState): void {
        const renderFinalMarkdown = this.options.renderFinalMarkdown;
        const shouldRenderFinalMarkdown = (stream.status === "succeeded" || stream.status === "failed")
            && !!stream.partialText.trim()
            && !!renderFinalMarkdown;
        if (!shouldRenderFinalMarkdown) {
            this.invalidateFinalRender();
            if (contentEl.textContent !== stream.partialText) {
                contentEl.textContent = stream.partialText;
            }
            return;
        }

        const renderKey = `${stream.runId}\u0000${stream.partialText}`;
        if (this.finalRenderKey === renderKey && this.finalRenderContentEl === contentEl) {
            return;
        }

        this.invalidateFinalRender();
        if (contentEl.textContent !== stream.partialText) {
            contentEl.textContent = stream.partialText;
        }
        this.finalRenderKey = renderKey;
        this.finalRenderContentEl = contentEl;
        const renderGeneration = this.finalRenderGeneration;
        const detached = createElement(contentEl.ownerDocument, "div", contentEl.className);
        let renderPromise: Promise<void>;
        try {
            renderPromise = renderFinalMarkdown(stream.partialText, detached);
        } catch (error) {
            this.options.onFinalMarkdownRenderError?.(error);
            return;
        }

        void renderPromise.then(() => {
            if (
                this.finalRenderGeneration !== renderGeneration
                || this.finalRenderKey !== renderKey
                || this.finalRenderContentEl !== contentEl
                || this.contentEl !== contentEl
            ) {
                return;
            }
            const renderedNodes = Array.from(detached.childNodes);
            if (!renderedNodes.length) {
                this.options.onFinalMarkdownRenderError?.(
                    new Error("Final Markdown renderer produced no content."),
                );
                return;
            }
            contentEl.replaceChildren(...renderedNodes);
        }).catch((error) => {
            this.options.onFinalMarkdownRenderError?.(error);
        });
    }

    private invalidateFinalRender(): void {
        this.finalRenderGeneration += 1;
        this.finalRenderKey = null;
        this.finalRenderContentEl = null;
    }

    private syncActions(actionsEl: HTMLDivElement, stream: AgentRunStreamState): void {
        actionsEl.replaceChildren();
        if (!shouldKeepAgentStreamCardExclusive(stream)) {
            if (!this.ownsCard && this.borrowedSnapshot) {
                actionsEl.replaceChildren(...this.borrowedSnapshot.actionsNodes);
            }
            return;
        }

        if (!isAgentStreamBusy(stream) || !this.options.onCancelRun) {
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
            const ownsMatchingRunCard = this.ownsCard
                && cardRunId !== null
                && cardRunId === this.runId;
            const targetMatches = outputEntryId
                ? cardCommentId === outputEntryId || ownsMatchingRunCard
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
                const footerMetaEl = persisted.querySelector(".aside-thread-footer-meta");
                const processLogEl = persisted.querySelector(".aside-agent-process-log");
                processLogEl?.remove();
                const contentEl = persisted.querySelector(".aside-comment-content");
                const actionsEl = persisted.querySelector(".aside-comment-actions");
                this.metaValueEl = nodeInstanceOf(metaValueEl, HTMLSpanElement) ? metaValueEl : null;
                this.labelEl = nodeInstanceOf(labelEl, HTMLSpanElement) ? labelEl : null;
                this.statusEl = nodeInstanceOf(statusEl, HTMLSpanElement) ? statusEl : null;
                this.captureStatusElements();
                this.footerMetaEl = nodeInstanceOf(footerMetaEl, HTMLDivElement) ? footerMetaEl : null;
                this.processLogEl = null;
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
                const footerMetaEl = existing.querySelector(".aside-thread-footer-meta");
                const processLogEl = existing.querySelector(".aside-agent-process-log");
                processLogEl?.remove();
                const contentEl = existing.querySelector(".aside-agent-stream-content");
                const actionsEl = existing.querySelector(".aside-comment-actions");
                this.metaValueEl = nodeInstanceOf(metaValueEl, HTMLSpanElement) ? metaValueEl : null;
                this.labelEl = nodeInstanceOf(labelEl, HTMLSpanElement) ? labelEl : null;
                this.statusEl = nodeInstanceOf(statusEl, HTMLSpanElement) ? statusEl : null;
                this.captureStatusElements();
                this.footerMetaEl = nodeInstanceOf(footerMetaEl, HTMLDivElement) ? footerMetaEl : null;
                this.processLogEl = null;
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
        this.statusMarkEl = markEl;
        this.statusTextEl = null;
        this.statusHintEl = null;
        this.processLogEl = null;
        this.contentEl = contentEl;
        this.actionsEl = actionsEl;
        this.footerMetaEl = footerMetaEl;
        return cardEl;
    }

    private captureStatusElements(): void {
        const statusEl = this.statusEl;
        if (!statusEl) {
            this.statusMarkEl = null;
            this.statusTextEl = null;
            this.statusHintEl = null;
            return;
        }

        const markEl = statusEl.querySelector(".aside-agent-run-status-mark");
        const textEl = statusEl.querySelector(".aside-agent-run-status-text");
        const hintEl = statusEl.querySelector(".aside-agent-run-status-hint");
        this.statusMarkEl = nodeInstanceOf(markEl, HTMLSpanElement) ? markEl : null;
        this.statusTextEl = nodeInstanceOf(textEl, HTMLSpanElement) ? textEl : null;
        this.statusHintEl = nodeInstanceOf(hintEl, HTMLSpanElement) ? hintEl : null;
    }

    private captureBorrowedCardSnapshot(): void {
        if (this.ownsCard) {
            this.borrowedSnapshot = null;
            return;
        }

        this.persistedHandoffSnapshot = null;
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
            footerMetaClassName: this.footerMetaEl?.className ?? "",
            footerMetaNodes: Array.from(this.footerMetaEl?.childNodes ?? []),
            contentNodes: Array.from(this.contentEl?.childNodes ?? []),
            actionsClassName: this.actionsEl?.className ?? "",
            actionsNodes: Array.from(this.actionsEl?.childNodes ?? []),
        };
    }

    private syncBorrowedFooterMeta(stream: AgentRunStreamState): void {
        if (this.ownsCard || !this.footerMetaEl || !this.labelEl || !this.statusEl) {
            return;
        }

        if (!shouldKeepAgentStreamCardExclusive(stream) && this.borrowedSnapshot) {
            this.footerMetaEl.replaceChildren(...this.borrowedSnapshot.footerMetaNodes);
            return;
        }

        this.footerMetaEl.replaceChildren(this.labelEl, this.statusEl);
    }

    private restoreBorrowedCard(): void {
        if (this.ownsCard) {
            return;
        }

        if (this.cardEl && this.persistedHandoffSnapshot) {
            for (const attribute of Array.from(this.cardEl.attributes)) {
                this.cardEl.removeAttribute(attribute.name);
            }
            for (const attribute of this.persistedHandoffSnapshot.attributes) {
                this.cardEl.setAttribute(attribute.name, attribute.value);
            }
            this.cardEl.className = this.persistedHandoffSnapshot.className;
            this.cardEl.replaceChildren(...this.persistedHandoffSnapshot.childNodes);
            return;
        }

        if (!this.borrowedSnapshot) {
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
        if (this.footerMetaEl) {
            this.footerMetaEl.className = this.borrowedSnapshot.footerMetaClassName;
            this.footerMetaEl.replaceChildren(...this.borrowedSnapshot.footerMetaNodes);
        }
        if (this.contentEl) {
            this.contentEl.replaceChildren(...this.borrowedSnapshot.contentNodes);
        }
        this.processLogEl?.remove();
        this.processLogEl = null;
        if (this.actionsEl) {
            this.actionsEl.className = this.borrowedSnapshot.actionsClassName;
            this.actionsEl.replaceChildren(...this.borrowedSnapshot.actionsNodes);
        }
    }
}
