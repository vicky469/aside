import { nodeInstanceOf } from "../domGuards";
import {
    createDetachedObsidianElement,
    createDetachedObsidianFragment,
} from "../dom/createDetachedObsidianElement";

export interface SidebarSearchHighlightRange {
    start: number;
    end: number;
}

function normalizeSidebarSearchTerms(query: string): string[] {
    const terms = query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term.length > 0);

    return Array.from(new Set(terms)).sort((left, right) => right.length - left.length);
}

function getSidebarSearchHighlightRangesForTerms(
    text: string,
    terms: readonly string[],
): SidebarSearchHighlightRange[] {
    if (!text || terms.length === 0) {
        return [];
    }

    const ranges: SidebarSearchHighlightRange[] = [];
    const occupied = new Uint8Array(text.length);
    const lowercaseText = text.toLowerCase();

    for (const term of terms) {
        let searchFrom = 0;
        while (searchFrom < lowercaseText.length) {
            const matchIndex = lowercaseText.indexOf(term, searchFrom);
            if (matchIndex < 0) {
                break;
            }

            const matchEnd = matchIndex + term.length;
            let hasOverlap = false;
            for (let offset = matchIndex; offset < matchEnd; offset += 1) {
                if (occupied[offset] === 1) {
                    hasOverlap = true;
                    break;
                }
            }
            if (!hasOverlap) {
                ranges.push({
                    start: matchIndex,
                    end: matchEnd,
                });
                occupied.fill(1, matchIndex, matchEnd);
            }

            searchFrom = matchIndex + term.length;
        }
    }

    return ranges.sort((left, right) => left.start - right.start);
}

export function getSidebarSearchHighlightRanges(
    text: string,
    query: string,
): SidebarSearchHighlightRange[] {
    const terms = normalizeSidebarSearchTerms(query);
    return getSidebarSearchHighlightRangesForTerms(text, terms);
}

function getSidebarSearchTextNodes(
    container: HTMLElement,
    options: {
        allowedSelectors?: readonly string[];
    } = {},
): Text[] {
    const ownerDocument = container.ownerDocument;
    const nodeFilter = ownerDocument.defaultView?.NodeFilter;
    if (!nodeFilter) {
        return [];
    }

    const allowedSelectorList = options.allowedSelectors?.join(", ") ?? "";
    const textNodes: Text[] = [];
    const walker = ownerDocument.createTreeWalker(
        container,
        nodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                if (!nodeInstanceOf(node, Text) || !node.nodeValue?.trim()) {
                    return nodeFilter.FILTER_SKIP;
                }

                const parentEl = node.parentElement;
                if (
                    !parentEl
                    || ["SCRIPT", "STYLE", "TEXTAREA"].includes(parentEl.tagName)
                    || (allowedSelectorList && !parentEl.closest(allowedSelectorList))
                ) {
                    return nodeFilter.FILTER_SKIP;
                }

                return nodeFilter.FILTER_ACCEPT;
            },
        },
    );

    let currentNode = walker.nextNode();
    while (currentNode) {
        if (nodeInstanceOf(currentNode, Text)) {
            textNodes.push(currentNode);
        }
        currentNode = walker.nextNode();
    }

    return textNodes;
}

function highlightSidebarSearchMatchesWithMarks(
    container: HTMLElement,
    terms: readonly string[],
    options: {
        allowedSelectors?: readonly string[];
    } = {},
): void {
    const textNodes = getSidebarSearchTextNodes(container, options);
    const ownerDocument = container.ownerDocument;

    for (const textNode of textNodes) {
        const textContent = textNode.nodeValue ?? "";
        const ranges = getSidebarSearchHighlightRangesForTerms(textContent, terms);
        if (ranges.length === 0) {
            continue;
        }

        const fragment = createDetachedObsidianFragment(ownerDocument);
        let cursor = 0;
        for (const range of ranges) {
            if (range.start > cursor) {
                fragment.append(textContent.slice(cursor, range.start));
            }

            const matchEl = createDetachedObsidianElement(ownerDocument, "mark");
            matchEl.className = "aside-search-match";
            matchEl.textContent = textContent.slice(range.start, range.end);
            fragment.append(matchEl);
            cursor = range.end;
        }

        if (cursor < textContent.length) {
            fragment.append(textContent.slice(cursor));
        }

        textNode.parentNode?.replaceChild(fragment, textNode);
    }
}

export function highlightSidebarSearchMatches(
    container: HTMLElement,
    query: string,
    options: {
        allowedSelectors?: readonly string[];
    } = {},
): void {
    const terms = normalizeSidebarSearchTerms(query);
    if (terms.length === 0) {
        return;
    }

    highlightSidebarSearchMatchesWithMarks(container, terms, options);
}

export function clearSidebarSearchHighlights(container: HTMLElement): void {
    const marks = Array.from(container.querySelectorAll("mark.aside-search-match"));
    if (marks.length === 0) {
        return;
    }

    const parents = new Set<Node>();
    for (const mark of marks) {
        const parent = mark.parentNode;
        if (!parent) {
            continue;
        }

        parent.replaceChild(container.ownerDocument.createTextNode(mark.textContent ?? ""), mark);
        parents.add(parent);
    }

    for (const parent of parents) {
        if ("normalize" in parent && typeof parent.normalize === "function") {
            parent.normalize();
        }
    }
}
