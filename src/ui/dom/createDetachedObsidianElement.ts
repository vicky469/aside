type ObsidianWindow = Window & {
    createFragment(): DocumentFragment;
};

function hasObsidianFragmentHelper(value: unknown): value is ObsidianWindow {
    return value !== null
        && typeof value === "object"
        && "createFragment" in value
        && typeof value.createFragment === "function";
}

function isDocumentFragment(value: unknown): value is DocumentFragment {
    return value !== null
        && typeof value === "object"
        && "createEl" in value
        && typeof value.createEl === "function";
}

function isHtmlElement<K extends keyof HTMLElementTagNameMap>(
    value: unknown,
    _tagName: K,
): value is HTMLElementTagNameMap[K] {
    return value !== null && typeof value === "object";
}

export function createDetachedObsidianFragment(ownerDocument: Document): DocumentFragment {
    const ownerWindow: unknown = Reflect.get(ownerDocument, "win");
    if (hasObsidianFragmentHelper(ownerWindow)) {
        return ownerWindow.createFragment();
    }

    const createDocumentFragment: unknown = Reflect.get(ownerDocument, "createDocumentFragment");
    if (typeof createDocumentFragment === "function") {
        const fragment: unknown = Reflect.apply(createDocumentFragment, ownerDocument, []);
        if (isDocumentFragment(fragment)) {
            return fragment;
        }
    }
    throw new Error("Obsidian DOM helpers are unavailable for this document.");
}

export function createDetachedObsidianElement<K extends keyof HTMLElementTagNameMap>(
    ownerDocument: Document,
    tagName: K,
    options?: DomElementInfo,
): HTMLElementTagNameMap[K] {
    const ownerWindow: unknown = Reflect.get(ownerDocument, "win");
    if (hasObsidianFragmentHelper(ownerWindow)) {
        return ownerWindow.createFragment().createEl(tagName, options);
    }

    const createElement: unknown = Reflect.get(ownerDocument, "createElement");
    if (typeof createElement === "function") {
        const element: unknown = Reflect.apply(createElement, ownerDocument, [tagName]);
        if (isHtmlElement(element, tagName)) {
            if (typeof options === "object" && options !== null) {
                if (options.cls) {
                    element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
                }
                if (typeof options.text === "string") {
                    element.textContent = options.text;
                }
            }
            return element;
        }
    }
    throw new Error("Obsidian DOM helpers are unavailable for this document.");
}
