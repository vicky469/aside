import type { App, TFile } from "obsidian";
import type { Comment, CommentThread } from "../../commentManager";
import {
    buildThoughtTrailNoteLinkGraph,
    type ThoughtTrailNoteLinkGraph,
} from "../../core/derived/thoughtTrailNoteLinkGraph";

function isMarkdownTFile(value: unknown): value is TFile {
    return !!value
        && typeof (value as { path?: unknown }).path === "string"
        && (value as { extension?: unknown }).extension === "md";
}

export function getCachedSourceMarkdownLinks(app: App, sourceFilePath: string): string[] {
    const file = app.vault.getAbstractFileByPath(sourceFilePath);
    if (!isMarkdownTFile(file)) {
        return [];
    }

    const cache = app.metadataCache.getFileCache(file);
    return (cache?.links ?? [])
        .map((link) => link.link)
        .filter((linkPath): linkPath is string => !!linkPath);
}

export function getCachedSourceMarkdownEmbeds(app: App, sourceFilePath: string): string[] {
    const file = app.vault.getAbstractFileByPath(sourceFilePath);
    if (!isMarkdownTFile(file)) {
        return [];
    }

    const cache = app.metadataCache.getFileCache(file);
    return (cache?.embeds ?? [])
        .map((embed) => embed.link)
        .filter((linkPath): linkPath is string => !!linkPath);
}

export function resolveMarkdownNoteLinkPath(app: App, linkPath: string, sourceFilePath: string): string | null {
    const linkedFile = app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
    return isMarkdownTFile(linkedFile) ? linkedFile.path : null;
}

export function buildSidebarThoughtTrailNoteLinkGraph(
    app: App,
    comments: Array<Comment | CommentThread>,
    options: {
        allCommentsNotePath: string;
        sourceMarkdownFilePaths: readonly string[];
    },
): ThoughtTrailNoteLinkGraph {
    return buildThoughtTrailNoteLinkGraph(comments, {
        allCommentsNotePath: options.allCommentsNotePath,
        sourceMarkdownFilePaths: options.sourceMarkdownFilePaths,
        getSourceMarkdownLinks: (sourceFilePath) => getCachedSourceMarkdownLinks(app, sourceFilePath),
        getSourceMarkdownEmbeds: (sourceFilePath) => getCachedSourceMarkdownEmbeds(app, sourceFilePath),
        resolveSideNoteWikiLinkPath: (linkPath, sourceFilePath) =>
            resolveMarkdownNoteLinkPath(app, linkPath, sourceFilePath),
        resolveSourceMarkdownLinkPath: (linkPath, sourceFilePath) =>
            resolveMarkdownNoteLinkPath(app, linkPath, sourceFilePath),
    });
}
