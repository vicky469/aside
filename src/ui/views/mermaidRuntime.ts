export type MermaidRenderResult = string | {
    bindFunctions?: (element: HTMLElement) => void;
    svg?: string;
};

export type MermaidRuntimeLike = {
    getConfig?: () => unknown;
    initialize: (config: unknown) => void;
    mermaidAPI?: {
        getConfig?: () => unknown;
    };
    render: (id: string, source: string) => Promise<MermaidRenderResult>;
};

function isMermaidRuntimeLike(value: unknown): value is MermaidRuntimeLike {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as Partial<MermaidRuntimeLike>;
    return typeof candidate.initialize === "function"
        && typeof candidate.render === "function";
}

export function resolveMermaidRuntime(
    loadedMermaid: unknown,
    globalMermaid: unknown,
): MermaidRuntimeLike | null {
    if (isMermaidRuntimeLike(loadedMermaid)) {
        return loadedMermaid;
    }

    if (isMermaidRuntimeLike(globalMermaid)) {
        return globalMermaid;
    }

    return null;
}
