const COMMENT_MENTION_PATTERN = /(^|[^\w])(@[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_/-]+)*)/g;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderMentionHtml(value: string): string {
    let html = "";
    let lastIndex = 0;
    COMMENT_MENTION_PATTERN.lastIndex = 0;

    for (let match = COMMENT_MENTION_PATTERN.exec(value); match; match = COMMENT_MENTION_PATTERN.exec(value)) {
        const [fullMatch, prefix, mention] = match;
        html += escapeHtml(value.slice(lastIndex, match.index));
        html += escapeHtml(prefix);
        html += `<span class="sidenote2-editor-token-mention">${escapeHtml(mention)}</span>`;
        lastIndex = match.index + fullMatch.length;
    }

    html += escapeHtml(value.slice(lastIndex));
    return html;
}

export function renderStyledDraftCommentHtml(value: string): string {
    if (!value) {
        return "";
    }

    let html = "";
    let cursor = 0;

    while (cursor < value.length) {
        const boldStart = value.indexOf("**", cursor);
        if (boldStart === -1) {
            html += renderMentionHtml(value.slice(cursor));
            break;
        }

        const boldEnd = value.indexOf("**", boldStart + 2);
        if (boldEnd === -1) {
            html += renderMentionHtml(value.slice(cursor));
            break;
        }

        html += renderMentionHtml(value.slice(cursor, boldStart));
        html += escapeHtml(value.slice(boldStart, boldStart + 2));
        html += `<span class="sidenote2-editor-token-bold">${renderMentionHtml(value.slice(boldStart + 2, boldEnd))}</span>`;
        html += escapeHtml(value.slice(boldEnd, boldEnd + 2));
        cursor = boldEnd + 2;
    }

    return html;
}

function createMentionFragment(
    document: Document,
    value: string,
): DocumentFragment | null {
    COMMENT_MENTION_PATTERN.lastIndex = 0;
    let lastIndex = 0;
    let foundMention = false;
    const fragment = document.createDocumentFragment();

    for (let match = COMMENT_MENTION_PATTERN.exec(value); match; match = COMMENT_MENTION_PATTERN.exec(value)) {
        const [fullMatch, prefix, mention] = match;
        const prefixStart = match.index;
        const prefixEnd = prefixStart + prefix.length;
        const mentionEnd = match.index + fullMatch.length;

        if (prefixStart > lastIndex) {
            fragment.append(value.slice(lastIndex, prefixStart));
        }
        if (prefix.length > 0) {
            fragment.append(prefix);
        }

        const mentionEl = document.createElement("span");
        mentionEl.className = "sidenote2-comment-mention";
        mentionEl.textContent = mention;
        fragment.append(mentionEl);

        lastIndex = mentionEnd;
        foundMention = true;
        COMMENT_MENTION_PATTERN.lastIndex = mentionEnd;
    }

    if (!foundMention) {
        return null;
    }

    if (lastIndex < value.length) {
        fragment.append(value.slice(lastIndex));
    }

    return fragment;
}

export function decorateRenderedCommentMentions(container: HTMLElement): void {
    const document = container.ownerDocument;
    const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                if (!(node instanceof Text) || !node.nodeValue || !node.nodeValue.includes("@")) {
                    return NodeFilter.FILTER_REJECT;
                }

                const parent = node.parentElement;
                if (!parent || parent.closest("a, code, pre, .sidenote2-comment-mention")) {
                    return NodeFilter.FILTER_REJECT;
                }

                return NodeFilter.FILTER_ACCEPT;
            },
        },
    );

    const textNodes: Text[] = [];
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
        textNodes.push(current as Text);
    }

    for (const textNode of textNodes) {
        const fragment = createMentionFragment(document, textNode.nodeValue ?? "");
        if (!fragment) {
            continue;
        }

        textNode.replaceWith(fragment);
    }
}
