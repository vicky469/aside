import {
    App,
    Component,
    MarkdownRenderer,
    TFile,
    WorkspaceLeaf,
    loadMermaid,
} from "obsidian";
import type { Comment, CommentThread } from "../../commentManager";
import {
    buildThoughtTrailLines,
    extractThoughtTrailMermaidSource,
    getThoughtTrailMermaidRenderConfig,
} from "../../core/derived/thoughtTrail";
import { extractThoughtTrailClickTargets, parseThoughtTrailOpenFilePath, resolveThoughtTrailNodeId } from "./thoughtTrailNodeLinks";
import { parseTrustedMermaidSvg } from "./thoughtTrailSvg";

type MermaidRenderResult = string | {
    bindFunctions?: (element: HTMLElement) => void;
    svg?: string;
};

type MermaidRuntimeLike = {
    getConfig?: () => unknown;
    initialize: (config: unknown) => void;
    mermaidAPI?: {
        getConfig?: () => unknown;
    };
    render: (id: string, source: string) => Promise<MermaidRenderResult>;
};

export interface SidebarThoughtTrailRenderContext {
    app: App;
    allCommentsNotePath: string;
    component: Component;
    getPreferredFileLeaf(filePath?: string): WorkspaceLeaf | null;
    renderVersion: number;
}

export interface SidebarThoughtTrailOptions {
    surface: "index" | "note";
    hasRootScope: boolean;
    rootFilePath: string | null;
}

function isMermaidRuntimeLike(value: unknown): value is MermaidRuntimeLike {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as Partial<MermaidRuntimeLike>;
    return typeof candidate.initialize === "function"
        && typeof candidate.render === "function";
}

function cloneMermaidConfig<T>(config: T): T {
    if (config == null) {
        return config;
    }

    return JSON.parse(JSON.stringify(config)) as T;
}

export async function renderSidebarThoughtTrail(
    container: HTMLDivElement,
    comments: Array<Comment | CommentThread>,
    file: TFile,
    options: SidebarThoughtTrailOptions,
    context: SidebarThoughtTrailRenderContext,
): Promise<void> {
    const thoughtTrailEl = container.createDiv("sidenote2-thought-trail");
    if (!options.hasRootScope || !options.rootFilePath) {
        const emptyStateEl = thoughtTrailEl.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
        if (options.surface === "note") {
            emptyStateEl.createEl("p", { text: "No thought trail is available for this file yet." });
            emptyStateEl.createEl("p", { text: "Add side notes in this note to create a rooted trail." });
        } else {
            emptyStateEl.createEl("p", { text: "Use files to choose a file and see its connected files." });
        }
        return;
    }

    const rootFilePath = options.rootFilePath;
    const relatedFileLines = buildThoughtTrailLines(context.app.vault.getName(), comments, {
        allCommentsNotePath: context.allCommentsNotePath,
        resolveWikiLinkPath: (linkPath, sourceFilePath) => {
            const linkedFile = context.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
            return linkedFile instanceof TFile ? linkedFile.path : null;
        },
    });
    await renderThoughtTrailSection(thoughtTrailEl, {
        emptyStateText: options.surface === "note"
            ? [
                "No related files for this file yet.",
                "Add wiki links in side notes for this file.",
            ]
            : [
                "No related files for the selected file.",
                "Add links in those notes or choose a different file.",
            ],
        sourcePath: rootFilePath || file.path,
        thoughtTrailLines: relatedFileLines,
        title: "Related Files",
    }, context);
}

async function renderThoughtTrailSection(
    container: HTMLDivElement,
    options: {
        emptyStateText: string[];
        sourcePath: string;
        thoughtTrailLines: string[];
        title: string;
    },
    context: SidebarThoughtTrailRenderContext,
): Promise<void> {
    const sectionEl = container.createDiv("sidenote2-thought-trail-section");
    sectionEl.createEl("h4", {
        cls: "sidenote2-thought-trail-section-title",
        text: options.title,
    });
    if (!options.thoughtTrailLines.length) {
        const emptyStateEl = sectionEl.createDiv("sidenote2-empty-state sidenote2-section-empty-state");
        options.emptyStateText.forEach((text) => {
            emptyStateEl.createEl("p", { text });
        });
        return;
    }

    const graphEl = sectionEl.createDiv("sidenote2-thought-trail-section-graph");
    await renderThoughtTrailMermaid(graphEl, options.thoughtTrailLines, options.sourcePath, context);
    bindThoughtTrailNodeLinks(graphEl, options.thoughtTrailLines, context);
}

async function renderThoughtTrailMermaid(
    container: HTMLElement,
    thoughtTrailLines: string[],
    sourcePath: string,
    context: SidebarThoughtTrailRenderContext,
): Promise<void> {
    const fallbackToMarkdownRenderer = async (): Promise<void> => {
        await MarkdownRenderer.render(
            context.app,
            thoughtTrailLines.join("\n"),
            container,
            sourcePath,
            context.component,
        );

        const fallbackMermaidEl = container.querySelector(".mermaid");
        if (fallbackMermaidEl instanceof HTMLElement) {
            fallbackMermaidEl.setAttribute("data-sidenote2-thought-trail-renderer", "markdown");
        }
    };

    await loadMermaid().catch(() => undefined);
    const mermaidRuntime = (globalThis as typeof globalThis & { mermaid?: unknown }).mermaid;
    if (!isMermaidRuntimeLike(mermaidRuntime)) {
        await fallbackToMarkdownRenderer();
        return;
    }

    const previousConfig = cloneMermaidConfig(
        mermaidRuntime.getConfig?.() ?? mermaidRuntime.mermaidAPI?.getConfig?.() ?? null,
    );

    try {
        mermaidRuntime.initialize({
            startOnLoad: false,
            ...getThoughtTrailMermaidRenderConfig(),
        });

        const renderId = `sidenote2-thought-trail-${context.renderVersion}-${Date.now()}`;
        const renderResult = await mermaidRuntime.render(
            renderId,
            extractThoughtTrailMermaidSource(thoughtTrailLines),
        );
        const svg = typeof renderResult === "string" ? renderResult : renderResult?.svg;
        if (!svg) {
            await fallbackToMarkdownRenderer();
            return;
        }

        const mermaidEl = container.createDiv("mermaid");
        mermaidEl.setAttribute("data-sidenote2-thought-trail-renderer", "direct");
        const renderedSvg = parseTrustedMermaidSvg(svg);
        if (!renderedSvg) {
            mermaidEl.remove();
            await fallbackToMarkdownRenderer();
            return;
        }

        mermaidEl.replaceChildren(renderedSvg);
        const bindFunctions = typeof renderResult === "object" && renderResult !== null
            ? renderResult.bindFunctions
            : undefined;
        if (typeof bindFunctions === "function") {
            bindFunctions(mermaidEl);
        }
    } catch {
        container.querySelectorAll(".mermaid").forEach((element) => element.remove());
        await fallbackToMarkdownRenderer();
    } finally {
        if (previousConfig) {
            mermaidRuntime.initialize(previousConfig);
        }
    }
}

function bindThoughtTrailNodeLinks(
    container: HTMLElement,
    thoughtTrailLines: string[],
    context: SidebarThoughtTrailRenderContext,
): void {
    const clickTargets = extractThoughtTrailClickTargets(thoughtTrailLines);
    if (!clickTargets.size) {
        return;
    }

    const mermaidEl = container.querySelector(".mermaid");
    if (!mermaidEl) {
        return;
    }

    mermaidEl.querySelectorAll(".node, [data-id]").forEach((element) => {
        if (!(element instanceof Element)) {
            return;
        }

        const nodeId = resolveThoughtTrailNodeId(
            element.getAttribute("data-id"),
            element.getAttribute("id"),
        );
        if (!nodeId || !clickTargets.has(nodeId)) {
            return;
        }

        element.setAttribute("data-sidenote2-thought-trail-node-link", "true");
    });

    mermaidEl.addEventListener("click", (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const nodeEl = target.closest(".node, [data-id]");
        if (!(nodeEl instanceof Element)) {
            return;
        }

        const nodeId = resolveThoughtTrailNodeId(
            nodeEl.getAttribute("data-id"),
            nodeEl.getAttribute("id"),
        );
        if (!nodeId) {
            return;
        }

        const targetUrl = clickTargets.get(nodeId);
        if (!targetUrl) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        void openThoughtTrailTarget(targetUrl, context);
    });
}

async function openThoughtTrailTarget(
    targetUrl: string,
    context: SidebarThoughtTrailRenderContext,
): Promise<void> {
    const filePath = parseThoughtTrailOpenFilePath(targetUrl);
    if (!filePath) {
        return;
    }

    const targetFile = context.app.vault.getAbstractFileByPath(filePath);
    if (!(targetFile instanceof TFile)) {
        return;
    }

    const targetLeaf = context.getPreferredFileLeaf(filePath) ?? context.app.workspace.getLeaf(false);
    if (!targetLeaf) {
        return;
    }

    await targetLeaf.openFile(targetFile);
    context.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
}
