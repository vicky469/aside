import {
    App,
    Component,
    MarkdownRenderer,
    TFile,
    WorkspaceLeaf,
    loadMermaid,
    setTooltip,
} from "obsidian";
import type { Comment, CommentThread } from "../../commentManager";
import {
    buildTagRelatedFileSetModel,
    extractThoughtTrailMermaidSource,
    getThoughtTrailMermaidRenderConfig,
    type TagRelatedFileSetModel,
    type ThoughtTrailFileTagLookup,
} from "../../core/derived/thoughtTrail";
import { buildThoughtTrailNoteLinkLines } from "../../core/derived/thoughtTrailNoteLinkGraph";
import { resolveMermaidRuntime } from "./mermaidRuntime";
import {
    extractThoughtTrailClickTargets,
    parseThoughtTrailOpenFilePath,
    resolveThoughtTrailNodeFilePath,
    resolveThoughtTrailNodeId,
} from "./thoughtTrailNodeLinks";
import { parseTrustedMermaidSvg } from "./thoughtTrailSvg";
import type { SidebarThoughtTrailSource } from "./sidebarThoughtTrailSource";
import { nodeInstanceOf } from "../domGuards";
import { buildSidebarThoughtTrailNoteLinkGraph } from "./sidebarThoughtTrailGraph";

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
    candidateFilePaths: readonly string[];
    source: SidebarThoughtTrailSource;
    onSourceChange(source: SidebarThoughtTrailSource): void;
    getTagsForFilePath: ThoughtTrailFileTagLookup;
}

function cloneMermaidConfig<T>(config: T): T {
    if (config == null) {
        return config;
    }

    return JSON.parse(JSON.stringify(config)) as T;
}

function extractDirectRenderMermaidSource(lines: string[]): string {
    return extractThoughtTrailMermaidSource(lines)
        .split("\n")
        .filter((line) => !/^\s*click\s+\S+\s+href\s+/.test(line))
        .join("\n");
}

function renderThoughtTrailSourceControl(
    container: HTMLElement,
    options: {
        source: SidebarThoughtTrailSource;
        radioGroupName: string;
        tagsDisabled?: boolean;
        onSourceChange(source: SidebarThoughtTrailSource): void;
    },
): void {
    const controlEl = container.createDiv("aside-thought-trail-source-control");
    controlEl.createSpan({
        cls: "aside-thought-trail-source-label",
        text: "Related Files By",
    });
    const sourceOptionsEl = controlEl.createDiv("aside-thought-trail-source-options");
    for (const source of ["wikilinks", "tags"] as const) {
        const isDisabled = source === "tags" && options.tagsDisabled;
        const labelEl = sourceOptionsEl.createEl("label", {
            cls: `aside-thought-trail-source-option${isDisabled ? " is-disabled" : ""}`,
        });
        const inputEl = labelEl.createEl("input", {
            type: "radio",
            attr: {
                name: options.radioGroupName,
                value: source,
            },
        });
        inputEl.checked = options.source === source;
        inputEl.disabled = isDisabled ?? false;
        inputEl.addEventListener("change", () => {
            if (inputEl.checked) {
                options.onSourceChange(source);
            }
        });
        labelEl.createSpan({
            text: source === "wikilinks" ? "Wikilinks" : "Tags",
        });
    }
    controlEl.createSpan({
        cls: "aside-thought-trail-scope-note",
        text: "Scope: Vault",
    });
}

function renderTagRelatedFilesList(
    container: HTMLDivElement,
    model: TagRelatedFileSetModel,
    context: SidebarThoughtTrailRenderContext,
): void {
    if (model.currentFile) {
        const currentFileEl = container.createDiv({
            cls: "aside-tag-related-current-file",
            text: model.currentFile.label,
        });
        setTooltip(currentFileEl, model.currentFile.filePath);
    }

    const filterBarEl = container.createDiv({
        cls: "aside-tag-related-filter-bar",
        attr: {
            role: "group",
            "aria-label": "Filter related files by tag",
        },
    });
    const listEl = container.createEl("ul", { cls: "aside-tag-related-files" });
    const renderedRows = model.files.map((file) => {
        const rowEl = listEl.createEl("li", {
            cls: "aside-tag-related-file-row",
            attr: { "data-file-path": file.filePath },
        });
        renderTagRelatedFileLink(rowEl, file.filePath, file.label, context);
        const tagsEl = rowEl.createDiv("aside-tag-related-file-tags");
        for (const tag of file.tags) {
            tagsEl.createSpan({
                cls: "aside-tag-related-file-tag",
                text: `#${tag.tagDisplay}`,
                attr: { "data-tag-key": tag.tagKey },
            });
        }
        return { file, rowEl };
    });

    const filterDefinitions = [
        { tagKey: null, label: `All · ${model.files.length}` },
        ...model.tags.map((tag) => ({
            tagKey: tag.tagKey,
            label: `#${tag.tagDisplay} · ${tag.fileCount}`,
        })),
    ];
    const filterButtons: Array<{ tagKey: string | null; button: HTMLButtonElement }> = [];
    const applyFilter = (selectedTagKey: string | null): void => {
        for (const { tagKey, button } of filterButtons) {
            const isSelected = tagKey === selectedTagKey;
            button.setAttribute("aria-pressed", String(isSelected));
            button.classList.toggle("is-selected", isSelected);
        }
        for (const { file, rowEl } of renderedRows) {
            rowEl.hidden = selectedTagKey !== null
                && !file.tags.some((tag) => tag.tagKey === selectedTagKey);
        }
    };

    for (const definition of filterDefinitions) {
        const button = filterBarEl.createEl("button", {
            cls: "aside-tag-related-filter",
            text: definition.label,
            attr: {
                type: "button",
                "aria-pressed": String(definition.tagKey === null),
                "data-tag-key": definition.tagKey ?? "",
            },
        });
        button.addEventListener("click", () => {
            applyFilter(definition.tagKey);
        });
        filterButtons.push({ tagKey: definition.tagKey, button });
    }
    applyFilter(null);
}

function renderTagRelatedFileLink(
    container: HTMLElement,
    filePath: string,
    label: string,
    context: SidebarThoughtTrailRenderContext,
): void {
    const btn = container.createEl("button", {
        cls: "aside-tag-related-file-link",
        text: label,
    });
    setTooltip(btn, filePath);
    btn.addEventListener("click", () => {
        const url = `obsidian://open?vault=${encodeURIComponent(context.app.vault.getName())}&file=${encodeURIComponent(filePath)}`;
        void openThoughtTrailTarget(url, context);
    });
}


export async function renderSidebarThoughtTrail(
    container: HTMLDivElement,
    comments: Array<Comment | CommentThread>,
    file: TFile,
    options: SidebarThoughtTrailOptions,
    context: SidebarThoughtTrailRenderContext,
): Promise<void> {
    const thoughtTrailEl = container.createDiv("aside-thought-trail");
    if (!options.hasRootScope || !options.rootFilePath) {
        const emptyStateEl = thoughtTrailEl.createDiv("aside-empty-state aside-section-empty-state");
        if (options.surface === "note") {
            emptyStateEl.createEl("p", { text: "No thought trail is available for this file yet." });
            emptyStateEl.createEl("p", { text: "Add side notes in this note to create a rooted trail." });
        } else {
            emptyStateEl.createEl("p", { text: "Use files to choose a file and see its connected files." });
        }
        return;
    }

    const rootFilePath = options.rootFilePath;
    const tagRelatedFileSet = buildTagRelatedFileSetModel(
        rootFilePath,
        options.candidateFilePaths,
        options.getTagsForFilePath,
        { allCommentsNotePath: context.allCommentsNotePath },
    );
    renderThoughtTrailSourceControl(thoughtTrailEl, {
        source: options.source,
        radioGroupName: `aside-thought-trail-source-${context.renderVersion}-${options.surface}-${encodeURIComponent(rootFilePath)}`,
        tagsDisabled: tagRelatedFileSet.files.length === 0,
        onSourceChange: (source) => {
            options.onSourceChange(source);
        },
    });
    if (options.source === "tags") {
        const sectionEl = thoughtTrailEl.createDiv("aside-thought-trail-section");
        renderTagRelatedFilesList(sectionEl, tagRelatedFileSet, context);
        return;
    }

    const thoughtTrailGraph = buildSidebarThoughtTrailNoteLinkGraph(context.app, comments, {
        allCommentsNotePath: context.allCommentsNotePath,
        sourceMarkdownFilePaths: options.candidateFilePaths,
    });
    const relatedFileLines = buildThoughtTrailNoteLinkLines(
        context.app.vault.getName(),
        thoughtTrailGraph,
        rootFilePath,
    );
    await renderThoughtTrailSection(thoughtTrailEl, {
        emptyStateText: options.surface === "note"
            ? [
                "No related files for this file yet.",
                "Add wiki links in the source note or in side notes.",
            ]
            : [
                "No related files for the selected file.",
                "Add wiki links in that source note, related source notes, or side notes.",
            ],
        sourcePath: rootFilePath || file.path,
        thoughtTrailLines: relatedFileLines,
    }, context);
}

async function renderThoughtTrailSection(
    container: HTMLDivElement,
    options: {
        emptyStateText: string[];
        sourcePath: string;
        thoughtTrailLines: string[];
    },
    context: SidebarThoughtTrailRenderContext,
): Promise<void> {
    const sectionEl = container.createDiv("aside-thought-trail-section");
    if (!options.thoughtTrailLines.length) {
        const emptyStateEl = sectionEl.createDiv("aside-empty-state aside-section-empty-state");
        options.emptyStateText.forEach((text) => {
            emptyStateEl.createEl("p", { text });
        });
        return;
    }

    const graphEl = sectionEl.createDiv("aside-thought-trail-section-graph");
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
        if (nodeInstanceOf(fallbackMermaidEl, HTMLElement)) {
            fallbackMermaidEl.setAttribute("data-aside-thought-trail-renderer", "markdown");
        }
    };

    const loadedMermaid: unknown = await loadMermaid().catch((): undefined => undefined);
    const ownerWindow = (container.win ?? (typeof window === "undefined" ? null : window)) as (Window & { mermaid?: unknown }) | null;
    const mermaidRuntime = resolveMermaidRuntime(
        loadedMermaid,
        ownerWindow?.mermaid,
    );
    if (!mermaidRuntime) {
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

        const renderId = `aside-thought-trail-${context.renderVersion}-${Date.now()}`;
        const renderResult = await mermaidRuntime.render(
            renderId,
            extractDirectRenderMermaidSource(thoughtTrailLines),
        );
        const svg = typeof renderResult === "string" ? renderResult : renderResult?.svg;
        if (!svg) {
            await fallbackToMarkdownRenderer();
            return;
        }

        const mermaidEl = container.createDiv("mermaid");
        mermaidEl.setAttribute("data-aside-thought-trail-renderer", "direct");
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
        if (!nodeInstanceOf(element, Element)) {
            return;
        }

        const nodeId = resolveThoughtTrailNodeId(
            element.getAttribute("data-id"),
            element.getAttribute("id"),
        );
        if (!nodeId || !clickTargets.has(nodeId)) {
            return;
        }

        element.setAttribute("data-aside-thought-trail-node-link", "true");
        const filePath = resolveThoughtTrailNodeFilePath(
            element.getAttribute("data-id"),
            element.getAttribute("id"),
            clickTargets,
        );
        if (filePath) {
            setTooltip(element as HTMLElement, filePath);
        }
    });

    mermaidEl.addEventListener("click", (event: Event) => {
        const target = event.target;
        if (!nodeInstanceOf(target, Element)) {
            return;
        }

        const nodeEl = target.closest(".node, [data-id]");
        if (!nodeInstanceOf(nodeEl, Element)) {
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
