import { captureSidebarScrollAnchor } from "./sidebarScrollAnchor";

export interface SidebarItemRenderDescriptor {
    key: string;
    signature: string;
    threadId: string | null;
    render(): Promise<HTMLElement>;
}

export interface SidebarItemReconcilerOptions {
    isCurrent?(): boolean;
    onReplaceThread?(threadId: string, previous: HTMLElement, next: HTMLElement): boolean;
    onRemoveThread?(threadId: string): void;
}

export async function reconcileSidebarItems(
    container: HTMLElement,
    descriptors: readonly SidebarItemRenderDescriptor[],
    options: SidebarItemReconcilerOptions = {},
): Promise<boolean> {
    const isCurrent = (): boolean => options.isCurrent?.() ?? true;
    const existingByKey = new Map<string, HTMLElement>();
    for (const child of Array.from(container.children) as HTMLElement[]) {
        const key = child.dataset.asideRenderKey;
        if (key) {
            existingByKey.set(key, child);
        }
    }

    const desiredNodes: HTMLElement[] = [];
    const replacedThreads: Array<{
        threadId: string;
        previous: HTMLElement;
        next: HTMLElement;
    }> = [];
    for (const descriptor of descriptors) {
        if (!isCurrent()) {
            return false;
        }

        const existing = existingByKey.get(descriptor.key) ?? null;
        existingByKey.delete(descriptor.key);
        if (existing?.dataset.asideRenderSignature === descriptor.signature) {
            desiredNodes.push(existing);
            continue;
        }

        const nextNode = await descriptor.render();
        if (!isCurrent()) {
            return false;
        }

        nextNode.dataset.asideRenderKey = descriptor.key;
        nextNode.dataset.asideRenderSignature = descriptor.signature;
        desiredNodes.push(nextNode);
        if (descriptor.threadId && existing) {
            replacedThreads.push({
                threadId: descriptor.threadId,
                previous: existing,
                next: nextNode,
            });
        }
    }

    if (!isCurrent()) {
        return false;
    }

    const restoreScroll = captureSidebarScrollAnchor(container);
    try {
        for (const [key, element] of existingByKey) {
            if (key.startsWith("thread:")) {
                options.onRemoveThread?.(key.slice("thread:".length));
            }
            element.remove();
        }

        desiredNodes.forEach((node, index) => {
            const currentNode = container.children.item(index);
            if (currentNode !== node) {
                container.insertBefore(node, currentNode ?? null);
            }
        });

        for (const replacement of replacedThreads) {
            const retained = options.onReplaceThread?.(
                replacement.threadId,
                replacement.previous,
                replacement.next,
            ) ?? false;
            if (!retained) {
                options.onRemoveThread?.(replacement.threadId);
            }
        }

        const desiredNodeSet = new Set(desiredNodes);
        for (const child of Array.from(container.children) as HTMLElement[]) {
            if (!desiredNodeSet.has(child)) {
                child.remove();
            }
        }
    } finally {
        restoreScroll();
    }

    return true;
}
