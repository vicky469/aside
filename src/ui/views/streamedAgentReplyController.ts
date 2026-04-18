import type { AgentRunStreamState } from "../../core/agents/agentRuns";
import { getAgentActorLabel } from "../../core/agents/agentActorRegistry";
import { getAgentRunStatusPresentation } from "./sidebarPersistedComment";
import { formatSidebarCommentMeta } from "./sidebarCommentSections";

function createElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    className?: string,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    return element;
}

export class StreamedAgentReplyController {
    private cardEl: HTMLDivElement | null = null;
    private metaValueEl: HTMLSpanElement | null = null;
    private contentEl: HTMLDivElement | null = null;
    private labelEl: HTMLSpanElement | null = null;
    private statusEl: HTMLSpanElement | null = null;
    private runId: string | null = null;

    constructor(private readonly threadId: string) {}

    public sync(containerEl: HTMLElement, stream: AgentRunStreamState): void {
        const threadEl = this.findThreadElement(containerEl);
        if (!threadEl) {
            this.clear();
            return;
        }

        const repliesEl = this.ensureRepliesContainer(threadEl);
        const cardEl = this.ensureCard(repliesEl);
        const metaValueEl = this.metaValueEl;
        const labelEl = this.labelEl;
        const statusEl = this.statusEl;
        const contentEl = this.contentEl;
        if (
            !(metaValueEl instanceof HTMLSpanElement)
            || !(labelEl instanceof HTMLSpanElement)
            || !(statusEl instanceof HTMLSpanElement)
            || !(contentEl instanceof HTMLDivElement)
        ) {
            return;
        }
        const metaText = formatSidebarCommentMeta({ timestamp: stream.startedAt });
        if (metaValueEl.textContent !== metaText) {
            metaValueEl.textContent = metaText;
        }
        const label = getAgentActorLabel(stream.requestedAgent);
        labelEl.className = `sidenote2-comment-author-indicator sidenote2-agent-stream-author is-${stream.requestedAgent}`;
        if (labelEl.textContent !== label) {
            labelEl.textContent = label;
        }
        this.syncStatus(statusEl, label, stream);

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
        this.cardEl?.remove();
        this.cardEl = null;
        this.metaValueEl = null;
        this.contentEl = null;
        this.labelEl = null;
        this.statusEl = null;
        this.runId = null;
    }

    private syncStatus(statusEl: HTMLSpanElement, label: string, stream: AgentRunStreamState): void {
        const presentation = getAgentRunStatusPresentation(stream.status);
        statusEl.className = `sidenote2-agent-run-status is-${stream.status}`;
        statusEl.replaceChildren();

        const markEl = createElement("span", `sidenote2-agent-run-status-mark is-${presentation.markerKind}`);
        if (presentation.marker) {
            markEl.textContent = presentation.marker;
        } else {
            markEl.setAttribute("aria-hidden", "true");
        }
        statusEl.appendChild(markEl);
        statusEl.setAttribute("aria-label", `${label} ${stream.status}`);
        if (stream.error) {
            statusEl.setAttribute("title", stream.error);
            return;
        }

        statusEl.removeAttribute("title");
    }

    private findThreadElement(containerEl: HTMLElement): HTMLDivElement | null {
        const threadEl = containerEl.querySelector(`.sidenote2-thread-stack[data-thread-id="${this.threadId}"]`);
        return threadEl instanceof HTMLDivElement ? threadEl : null;
    }

    private ensureRepliesContainer(threadEl: HTMLDivElement): HTMLDivElement {
        const existing = threadEl.querySelector(".sidenote2-thread-replies");
        if (existing instanceof HTMLDivElement) {
            return existing;
        }

        const repliesEl = createElement("div", "sidenote2-thread-replies");
        threadEl.appendChild(repliesEl);
        return repliesEl;
    }

    private ensureCard(repliesEl: HTMLDivElement): HTMLDivElement {
        if (
            this.cardEl?.isConnected
            && this.cardEl.parentElement === repliesEl
        ) {
            return this.cardEl;
        }

        if (this.runId) {
            const existing = repliesEl.querySelector(`.sidenote2-agent-stream-item[data-agent-run-id="${this.runId}"]`);
            if (existing instanceof HTMLDivElement) {
                this.cardEl = existing;
                const metaValueEl = existing.querySelector(".sidenote2-agent-stream-meta-value");
                const labelEl = existing.querySelector(".sidenote2-agent-stream-author");
                const statusEl = existing.querySelector(".sidenote2-agent-run-status");
                const contentEl = existing.querySelector(".sidenote2-agent-stream-content");
                this.metaValueEl = metaValueEl instanceof HTMLSpanElement ? metaValueEl : null;
                this.labelEl = labelEl instanceof HTMLSpanElement ? labelEl : null;
                this.statusEl = statusEl instanceof HTMLSpanElement ? statusEl : null;
                this.contentEl = contentEl instanceof HTMLDivElement ? contentEl : null;
                return existing;
            }
        }

        const cardEl = createElement("div", "sidenote2-comment-item sidenote2-thread-item sidenote2-thread-entry-item sidenote2-agent-stream-item");
        const headerEl = createElement("div", "sidenote2-comment-header");
        const headerMainEl = createElement("div", "sidenote2-comment-header-main");
        const metaEl = createElement("small", "sidenote2-timestamp sidenote2-comment-meta");
        const metaValueEl = createElement("span", "sidenote2-comment-meta-value sidenote2-agent-stream-meta-value");
        metaEl.appendChild(metaValueEl);
        headerMainEl.appendChild(metaEl);
        headerEl.appendChild(headerMainEl);
        headerEl.appendChild(createElement("div", "sidenote2-comment-actions sidenote2-agent-stream-actions"));
        const contentEl = createElement("div", "sidenote2-comment-content sidenote2-agent-stream-content");
        const footerEl = createElement("div", "sidenote2-thread-footer");
        const footerMetaEl = createElement("div", "sidenote2-thread-footer-meta");
        const labelEl = createElement("span", "sidenote2-comment-author-indicator sidenote2-agent-stream-author");
        const statusEl = createElement("span", "sidenote2-agent-run-status is-running");
        const markEl = createElement("span", "sidenote2-agent-run-status-mark is-spinner");
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
        this.metaValueEl = metaValueEl;
        this.labelEl = labelEl;
        this.statusEl = statusEl;
        this.contentEl = contentEl;
        return cardEl;
    }
}
