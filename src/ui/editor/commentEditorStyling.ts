import { nodeInstanceOf } from "../domGuards";
import {
    createDetachedObsidianElement,
    createDetachedObsidianFragment,
} from "../dom/createDetachedObsidianElement";

export type ActionableMentionPredicate = (mention: string) => boolean;

const COMMENT_MENTION_PATTERN = /(^|[^\w<])(@[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_/-]+)*)|(^|[^\w</.~:\\-])(\/[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)*)(?![A-Za-z0-9_./-])/g;

interface CommentMentionMatch {
    index: number;
    end: number;
    prefix: string;
    mention: string;
}

function getCommentMentionMatches(
    value: string,
    isActionableMention?: ActionableMentionPredicate,
): CommentMentionMatch[] {
    const matches: CommentMentionMatch[] = [];
    COMMENT_MENTION_PATTERN.lastIndex = 0;

    for (let match = COMMENT_MENTION_PATTERN.exec(value); match; match = COMMENT_MENTION_PATTERN.exec(value)) {
        const prefix = match[1] ?? match[3] ?? "";
        const mention = match[2] ?? match[4] ?? "";
        if (!isActionableMention?.(mention)) {
            continue;
        }

        matches.push({
            index: match.index,
            end: match.index + match[0].length,
            prefix,
            mention,
        });
    }

    return matches;
}

function appendMentionNodes(
    document: Document,
    parent: Node,
    value: string,
    className: string,
    isActionableMention?: ActionableMentionPredicate,
): void {
    let lastIndex = 0;

    for (const match of getCommentMentionMatches(value, isActionableMention)) {
        const { prefix, mention } = match;
        if (match.index > lastIndex) {
            parent.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
        }
        if (prefix.length > 0) {
            parent.appendChild(document.createTextNode(prefix));
        }

        const mentionEl = createDetachedObsidianElement(document, "span");
        mentionEl.className = className;
        mentionEl.textContent = mention;
        parent.appendChild(mentionEl);
        lastIndex = match.end;
    }

    if (lastIndex < value.length) {
        parent.appendChild(document.createTextNode(value.slice(lastIndex)));
    }
}

export function renderStyledDraftCommentFragment(
    document: Document,
    value: string,
    isActionableMention?: ActionableMentionPredicate,
): DocumentFragment {
    const fragment = createDetachedObsidianFragment(document);
    if (!value) {
        return fragment;
    }

    let cursor = 0;
    while (cursor < value.length) {
        const boldStart = value.indexOf("**", cursor);
        if (boldStart === -1) {
            appendMentionNodes(
                document,
                fragment,
                value.slice(cursor),
                "aside-editor-token-mention",
                isActionableMention,
            );
            break;
        }

        const boldEnd = value.indexOf("**", boldStart + 2);
        if (boldEnd === -1) {
            appendMentionNodes(
                document,
                fragment,
                value.slice(cursor),
                "aside-editor-token-mention",
                isActionableMention,
            );
            break;
        }

        appendMentionNodes(
            document,
            fragment,
            value.slice(cursor, boldStart),
            "aside-editor-token-mention",
            isActionableMention,
        );
        fragment.append(document.createTextNode(value.slice(boldStart, boldStart + 2)));

        const boldEl = createDetachedObsidianElement(document, "span");
        boldEl.className = "aside-editor-token-bold";
        appendMentionNodes(
            document,
            boldEl,
            value.slice(boldStart + 2, boldEnd),
            "aside-editor-token-mention",
            isActionableMention,
        );
        fragment.appendChild(boldEl);

        fragment.append(document.createTextNode(value.slice(boldEnd, boldEnd + 2)));
        cursor = boldEnd + 2;
    }

    return fragment;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderMentionHtml(
    value: string,
    isActionableMention?: ActionableMentionPredicate,
): string {
    let html = "";
    let lastIndex = 0;

    for (const match of getCommentMentionMatches(value, isActionableMention)) {
        const { prefix, mention } = match;
        html += escapeHtml(value.slice(lastIndex, match.index));
        html += escapeHtml(prefix);
        html += `<span class="aside-editor-token-mention">${escapeHtml(mention)}</span>`;
        lastIndex = match.end;
    }

    html += escapeHtml(value.slice(lastIndex));
    return html;
}

export function renderStyledDraftCommentHtml(
    value: string,
    isActionableMention?: ActionableMentionPredicate,
): string {
    if (!value) {
        return "";
    }

    let html = "";
    let cursor = 0;

    while (cursor < value.length) {
        const boldStart = value.indexOf("**", cursor);
        if (boldStart === -1) {
            html += renderMentionHtml(value.slice(cursor), isActionableMention);
            break;
        }

        const boldEnd = value.indexOf("**", boldStart + 2);
        if (boldEnd === -1) {
            html += renderMentionHtml(value.slice(cursor), isActionableMention);
            break;
        }

        html += renderMentionHtml(value.slice(cursor, boldStart), isActionableMention);
        html += escapeHtml(value.slice(boldStart, boldStart + 2));
        html += `<span class="aside-editor-token-bold">${renderMentionHtml(
            value.slice(boldStart + 2, boldEnd),
            isActionableMention,
        )}</span>`;
        html += escapeHtml(value.slice(boldEnd, boldEnd + 2));
        cursor = boldEnd + 2;
    }

    return html;
}

function createMentionFragment(
    document: Document,
    value: string,
    isActionableMention?: ActionableMentionPredicate,
): DocumentFragment | null {
    let lastIndex = 0;
    let foundMention = false;
    const fragment = createDetachedObsidianFragment(document);

    for (const match of getCommentMentionMatches(value, isActionableMention)) {
        const { prefix, mention } = match;
        const prefixStart = match.index;
        const mentionEnd = match.end;

        if (prefixStart > lastIndex) {
            fragment.append(value.slice(lastIndex, prefixStart));
        }
        if (prefix.length > 0) {
            fragment.append(prefix);
        }

        const mentionEl = createDetachedObsidianElement(document, "span");
        mentionEl.className = "aside-comment-mention";
        mentionEl.textContent = mention;
        fragment.append(mentionEl);

        lastIndex = mentionEnd;
        foundMention = true;
    }

    if (!foundMention) {
        return null;
    }

    if (lastIndex < value.length) {
        fragment.append(value.slice(lastIndex));
    }

    return fragment;
}

export function decorateRenderedCommentMentions(
    container: HTMLElement,
    isActionableMention?: ActionableMentionPredicate,
): void {
    const document = container.ownerDocument;
    const nodeFilter = document.defaultView?.NodeFilter;
    if (!nodeFilter) {
        return;
    }

    const walker = document.createTreeWalker(
        container,
        nodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                if (
                    !nodeInstanceOf(node, Text)
                    || !node.nodeValue
                    || (!node.nodeValue.includes("@") && !node.nodeValue.includes("/"))
                ) {
                    return nodeFilter.FILTER_REJECT;
                }

                const parent = node.parentElement;
                if (!parent || parent.closest("a, code, pre, .aside-comment-mention")) {
                    return nodeFilter.FILTER_REJECT;
                }

                return nodeFilter.FILTER_ACCEPT;
            },
        },
    );

    const textNodes: Text[] = [];
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
        textNodes.push(current as Text);
    }

    for (const textNode of textNodes) {
        const fragment = createMentionFragment(
            document,
            textNode.nodeValue ?? "",
            isActionableMention,
        );
        if (!fragment) {
            continue;
        }

        textNode.replaceWith(fragment);
    }
}
