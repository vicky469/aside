const CARD_ATTRIBUTES = ["data-comment-id", "data-draft-id", "data-agent-output-entry-id"] as const;
const CARD_SELECTOR = CARD_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(", ");

interface VisibleCard {
    attribute: string;
    id: string;
    offset: number;
}

// Capture immediately before a DOM change, including after asynchronous
// rendering finishes, so scrolling during that work remains user-controlled.
export function captureSidebarScrollAnchor(container: HTMLElement): () => void {
    const positions: Array<{
        element: HTMLElement;
        top: number;
        left: number;
        cards: VisibleCard[];
    }> = [];
    const candidates = Array.from(container.querySelectorAll?.<HTMLElement>(CARD_SELECTOR) ?? []);
    for (let element: HTMLElement | null = container; element; element = element.parentElement) {
        if (typeof element.scrollTop !== "number") continue;
        const cards: VisibleCard[] = [];
        if (element.clientHeight > 0 && element.scrollHeight > element.clientHeight) {
            const viewportTop = element.getBoundingClientRect().top;
            for (const card of candidates) {
                const rect = card.getBoundingClientRect();
                if (rect.bottom <= viewportTop || rect.top >= viewportTop + element.clientHeight) continue;
                const attribute = CARD_ATTRIBUTES.find((attribute) => card.getAttribute(attribute));
                if (attribute) {
                    cards.push({ attribute, id: card.getAttribute(attribute)!, offset: rect.top - viewportTop });
                }
            }
        }
        positions.push({ element, top: element.scrollTop, left: element.scrollLeft, cards });
    }
    return () => {
        for (const position of positions) {
            position.element.scrollTop = position.top;
            position.element.scrollLeft = position.left;
        }
        const currentCards = positions.some((position) => position.cards.length > 0)
            ? Array.from(container.querySelectorAll<HTMLElement>(CARD_SELECTOR))
            : [];
        for (const { element, cards } of positions) {
            for (const saved of cards) {
                const card = currentCards.find((card) => card.getAttribute(saved.attribute) === saved.id);
                if (!card) continue;
                const offset = card.getBoundingClientRect().top - element.getBoundingClientRect().top;
                element.scrollTop += offset - saved.offset;
                break;
            }
        }
    };
}
