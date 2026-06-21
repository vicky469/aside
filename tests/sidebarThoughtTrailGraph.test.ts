import * as assert from "node:assert/strict";
import test from "node:test";
import type { App, CachedMetadata, TFile } from "obsidian";
import {
    buildSidebarThoughtTrailNoteLinkGraph,
    getCachedSourceMarkdownEmbeds,
    getCachedSourceMarkdownLinks,
    resolveMarkdownNoteLinkPath,
} from "../src/ui/views/sidebarThoughtTrailGraph";

function createFile(path: string, extension: string = "md"): TFile {
    return {
        path,
        extension,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/i, "") ?? path,
    } as TFile;
}

function createApp(files: TFile[], metadataByPath: Map<string, CachedMetadata>): App {
    return {
        vault: {
            getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
        },
        metadataCache: {
            getFileCache: (file: TFile) => metadataByPath.get(file.path) ?? null,
            getFirstLinkpathDest: (linkPath: string) => {
                const normalized = linkPath.toLowerCase();
                return files.find((file) =>
                    file.path.toLowerCase() === normalized
                    || file.path.toLowerCase() === `${normalized}.md`
                    || file.basename.toLowerCase() === normalized
                ) ?? null;
            },
        },
    } as unknown as App;
}

test("metadata-cache helpers return source markdown links and embeds without reading files", () => {
    const sourceFile = createFile("docs/source.md");
    const app = createApp([sourceFile], new Map([
        ["docs/source.md", {
            links: [
                { link: "Target", original: "[[Target]]", position: { start: { line: 1, col: 0, offset: 0 }, end: { line: 1, col: 10, offset: 10 } } },
            ],
            embeds: [
                { link: "Embedded", original: "![[Embedded]]", position: { start: { line: 2, col: 0, offset: 11 }, end: { line: 2, col: 13, offset: 24 } } },
            ],
        }],
    ]));

    assert.deepEqual(getCachedSourceMarkdownLinks(app, "docs/source.md"), ["Target"]);
    assert.deepEqual(getCachedSourceMarkdownEmbeds(app, "docs/source.md"), ["Embedded"]);
});

test("buildSidebarThoughtTrailNoteLinkGraph resolves only markdown source markdown targets", () => {
    const files = [
        createFile("docs/source.md"),
        createFile("docs/target.md"),
        createFile("assets/image.png", "png"),
    ];
    const app = createApp(files, new Map([
        ["docs/source.md", {
            links: [
                { link: "Target", original: "[[Target]]", position: { start: { line: 1, col: 0, offset: 0 }, end: { line: 1, col: 10, offset: 10 } } },
            ],
            embeds: [
                { link: "assets/image.png", original: "![[assets/image.png]]", position: { start: { line: 2, col: 0, offset: 11 }, end: { line: 2, col: 21, offset: 32 } } },
            ],
        }],
    ]));

    assert.equal(resolveMarkdownNoteLinkPath(app, "Target", "docs/source.md"), "docs/target.md");
    assert.equal(resolveMarkdownNoteLinkPath(app, "assets/image.png", "docs/source.md"), null);

    const graph = buildSidebarThoughtTrailNoteLinkGraph(app, [], {
        allCommentsNotePath: "Aside index.md",
        sourceMarkdownFilePaths: ["docs/source.md", "docs/target.md"],
    });

    assert.deepEqual(
        graph.edges.map((edge) => ({
            sourceFilePath: edge.sourceFilePath,
            targetFilePath: edge.targetFilePath,
            source: edge.source,
        })),
        [
            { sourceFilePath: "docs/source.md", targetFilePath: "docs/target.md", source: "source-markdown" },
        ],
    );
});
