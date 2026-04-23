export interface SidebarSearchHighlightRange {
    start: number;
    end: number;
}

const SIDEBAR_SEARCH_HIGHLIGHT_NAME_PREFIX = "sidenote2-search-match-";
const SIDEBAR_SEARCH_HIGHLIGHT_STYLE_ID_PREFIX = "sidenote2-search-highlight-style-";

let nextSidebarSearchHighlightId = 1;
const sidebarSearchHighlightNameByContainer = new WeakMap<HTMLElement, string>();

type HighlightRegistryLike = {
    delete(name: string): void;
    set(name: string, highlight: unknown): void;
};

type CssWithHighlights = typeof CSS & {
    highlights?: HighlightRegistryLike;
};

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

function getSidebarSearchHighlightName(container: HTMLElement): string {
    const existingName = sidebarSearchHighlightNameByContainer.get(container);
    if (existingName) {
        return existingName;
    }

    const nextName = `${SIDEBAR_SEARCH_HIGHLIGHT_NAME_PREFIX}${nextSidebarSearchHighlightId++}`;
    sidebarSearchHighlightNameByContainer.set(container, nextName);
    return nextName;
}

function getSidebarSearchHighlightStyleId(highlightName: string): string {
    return `${SIDEBAR_SEARCH_HIGHLIGHT_STYLE_ID_PREFIX}${highlightName}`;
}

function getSidebarSearchHighlightRegistry(ownerDocument: Document): HighlightRegistryLike | null {
    const view = ownerDocument.defaultView;
    const css = (view?.CSS ?? globalThis.CSS) as CssWithHighlights | undefined;
    const registry = css?.highlights;
    return registry
        && typeof registry.set === "function"
        && typeof registry.delete === "function"
        ? registry
        : null;
}

function getSidebarHighlightConstructor(ownerDocument: Document): (new (...initialRanges: Range[]) => unknown) | null {
    const candidate = ownerDocument.defaultView?.Highlight
        ?? globalThis.Highlight;
    return typeof candidate === "function"
        ? candidate as new (...initialRanges: Range[]) => unknown
        : null;
}

function ensureSidebarSearchHighlightStyle(ownerDocument: Document, highlightName: string): void {
    const styleId = getSidebarSearchHighlightStyleId(highlightName);
    if (ownerDocument.getElementById(styleId)) {
        return;
    }

    const styleEl = ownerDocument.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `::highlight(${highlightName}) {
    background-color: color-mix(in srgb, var(--text-highlight-bg, hsla(var(--interactive-accent-hsl), 0.18)) 88%, transparent);
    color: inherit;
}`;
    ownerDocument.head?.append(styleEl);
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
                if (!(node instanceof Text) || !node.nodeValue?.trim()) {
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
        if (currentNode instanceof Text) {
            textNodes.push(currentNode);
        }
        currentNode = walker.nextNode();
    }

    return textNodes;
}

function buildSidebarSearchHighlightRanges(
    container: HTMLElement,
    terms: readonly string[],
    options: {
        allowedSelectors?: readonly string[];
    } = {},
): Range[] {
    const textNodes = getSidebarSearchTextNodes(container, options);
    const ranges: Range[] = [];

    for (const textNode of textNodes) {
        const textContent = textNode.nodeValue ?? "";
        const matchRanges = getSidebarSearchHighlightRangesForTerms(textContent, terms);
        for (const matchRange of matchRanges) {
            const range = container.ownerDocument.createRange();
            range.setStart(textNode, matchRange.start);
            range.setEnd(textNode, matchRange.end);
            ranges.push(range);
        }
    }

    return ranges;
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

        const fragment = ownerDocument.createDocumentFragment();
        let cursor = 0;
        for (const range of ranges) {
            if (range.start > cursor) {
                fragment.append(textContent.slice(cursor, range.start));
            }

            const matchEl = ownerDocument.createElement("mark");
            matchEl.className = "sidenote2-search-match";
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

    const ownerDocument = container.ownerDocument;
    const registry = getSidebarSearchHighlightRegistry(ownerDocument);
    const HighlightCtor = getSidebarHighlightConstructor(ownerDocument);
    if (registry && HighlightCtor) {
        const highlightName = getSidebarSearchHighlightName(container);
        ensureSidebarSearchHighlightStyle(ownerDocument, highlightName);
        const ranges = buildSidebarSearchHighlightRanges(container, terms, options);
        if (ranges.length === 0) {
            registry.delete(highlightName);
            return;
        }

        registry.set(highlightName, new HighlightCtor(...ranges));
        return;
    }

    highlightSidebarSearchMatchesWithMarks(container, terms, options);
}

export function clearSidebarSearchHighlights(container: HTMLElement): void {
    const registry = getSidebarSearchHighlightRegistry(container.ownerDocument);
    if (registry) {
        registry.delete(getSidebarSearchHighlightName(container));
    }

    const marks = Array.from(container.querySelectorAll("mark.sidenote2-search-match"));
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
