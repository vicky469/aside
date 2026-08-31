import * as assert from "node:assert/strict";
import test from "node:test";
import type { App, CachedMetadata, TFile } from "obsidian";
import {
    buildThoughtTrailAttachmentItems,
    getDirectThoughtTrailAttachments,
    type ThoughtTrailAttachmentTarget,
} from "../src/ui/views/sidebarThoughtTrailAttachments";

function createFile(path: string, extension: string = "md"): TFile {
    return {
        path,
        name: path.split("/").pop() ?? path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/i, "") ?? path,
        extension,
    } as TFile;
}

test("buildThoughtTrailAttachmentItems keeps unique non-Markdown embeds in display order", () => {
    const targets = new Map<string, ThoughtTrailAttachmentTarget | null>([
        ["Image", { filePath: "assets/Zebra.PNG", fileName: "Zebra.PNG", extension: "PNG" }],
        ["Pdf", { filePath: "docs/alpha.pdf", fileName: "alpha.pdf", extension: ".pdf" }],
        ["Image duplicate", { filePath: "assets/Zebra.PNG", fileName: "Zebra.PNG", extension: "PNG" }],
        ["Markdown", { filePath: "docs/note.md", fileName: "note.md", extension: "md" }],
        ["Missing", null],
    ]);

    assert.deepEqual(
        buildThoughtTrailAttachmentItems("notes/source.md", ["Image", "Pdf", "Image duplicate", "Markdown", "Missing"], (linkPath: string) => targets.get(linkPath) ?? null),
        [
            { filePath: "docs/alpha.pdf", label: "alpha.pdf", typeLabel: "PDF" },
            { filePath: "assets/Zebra.PNG", label: "Zebra.PNG", typeLabel: "PNG" },
        ],
    );
});

test("buildThoughtTrailAttachmentItems normalizes backslash paths and labels extensionless files as FILE", () => {
    const caseDistinctTargets = new Map<string, ThoughtTrailAttachmentTarget>([
        ["same", { filePath: "/assets/Zebra.PNG/", fileName: "Zebra.PNG", extension: "PNG" }],
        ["normalized-same", { filePath: "assets/Zebra.PNG", fileName: "Zebra.PNG", extension: "PNG" }],
        ["case-distinct", { filePath: "assets/zebra.png", fileName: "zebra.png", extension: "png" }],
        ["accent", { filePath: "assets/Éclair.png", fileName: "Éclair.png", extension: "png" }],
    ]);
    assert.deepEqual(
        buildThoughtTrailAttachmentItems(
            "notes/source.md",
            ["same", "normalized-same", "case-distinct", "accent"],
            (linkPath: string) => caseDistinctTargets.get(linkPath) ?? null,
        ),
        [
            { filePath: "assets/Zebra.PNG", label: "Zebra.PNG", typeLabel: "PNG" },
            { filePath: "assets/zebra.png", label: "zebra.png", typeLabel: "PNG" },
            { filePath: "assets/Éclair.png", label: "Éclair.png", typeLabel: "PNG" },
        ],
    );

    const targets = new Map<string, ThoughtTrailAttachmentTarget>([
        ["first", { filePath: "assets\\raw-data", fileName: "raw-data", extension: "" }],
        ["second", { filePath: "/assets/raw-data/", fileName: "raw-data", extension: "" }],
        ["markdown", { filePath: "docs/note.md", fileName: "note.md", extension: ".MD" }],
        ["empty-path", { filePath: "///", fileName: "empty-path", extension: "png" }],
        ["fallback", { filePath: "/assets/fallback.PNG/", fileName: "", extension: "png" }],
        ["whitespace", { filePath: " assets/space.png ", fileName: "space.png", extension: "png" }],
    ]);
    const resolverCalls: string[] = [];

    assert.deepEqual(
        buildThoughtTrailAttachmentItems(
            "notes/source.md",
            [" first ", "", "  ", " second ", " markdown ", " empty-path ", " fallback ", " whitespace "],
            (linkPath: string) => {
                resolverCalls.push(linkPath);
                return targets.get(linkPath) ?? null;
            },
        ),
        [
            { filePath: "assets/fallback.PNG", label: "fallback.PNG", typeLabel: "PNG" },
            { filePath: "assets/raw-data", label: "raw-data", typeLabel: "FILE" },
            { filePath: " assets/space.png ", label: "space.png", typeLabel: "PNG" },
        ],
    );
    assert.deepEqual(resolverCalls, ["first", "second", "markdown", "empty-path", "fallback", "whitespace"]);
});

test("getDirectThoughtTrailAttachments reads embeds from only the selected Markdown source", () => {
    const sourceFile = createFile("notes/source.md");
    const otherSourceFile = createFile("notes/other.md");
    const imageFile = createFile("assets/image.png", "png");
    const otherImageFile = createFile("assets/other.png", "png");
    const markdownFile = createFile("notes/embedded.md");
    const files = [sourceFile, otherSourceFile, imageFile, otherImageFile, markdownFile];
    const metadataByPath = new Map<string, CachedMetadata>([
        ["notes/source.md", {
            embeds: [
                { link: "assets/image.png", original: "![[assets/image.png]]" },
                { link: "notes/embedded.md", original: "![[notes/embedded.md]]" },
            ],
            links: [{ link: "notes/regular-link.md", original: "[[notes/regular-link.md]]" }],
        } as CachedMetadata],
        ["notes/other.md", {
            embeds: [{ link: "assets/other.png", original: "![[assets/other.png]]" }],
        } as CachedMetadata],
    ]);
    const resolutionCalls: Array<{ linkPath: string; sourcePath: string }> = [];
    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
        },
        metadataCache: {
            getFileCache: (file: TFile) => metadataByPath.get(file.path) ?? null,
            getFirstLinkpathDest: (linkPath: string, sourcePath: string) => {
                resolutionCalls.push({ linkPath, sourcePath });
                return files.find((file) => file.path === linkPath) ?? null;
            },
        },
    } as unknown as App;

    assert.deepEqual(getDirectThoughtTrailAttachments(app, sourceFile.path), [
        { filePath: "assets/image.png", label: "image.png", typeLabel: "PNG" },
    ]);
    assert.deepEqual(resolutionCalls, [
        { linkPath: "assets/image.png", sourcePath: "notes/source.md" },
        { linkPath: "notes/embedded.md", sourcePath: "notes/source.md" },
    ]);
    assert.deepEqual(getDirectThoughtTrailAttachments(app, otherSourceFile.path), [
        { filePath: "assets/other.png", label: "other.png", typeLabel: "PNG" },
    ]);
    assert.deepEqual(getDirectThoughtTrailAttachments(app, "notes/missing.md"), []);
    assert.deepEqual(getDirectThoughtTrailAttachments(app, "assets/image.png"), []);
});
