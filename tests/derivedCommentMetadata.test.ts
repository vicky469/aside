import * as assert from "node:assert/strict";
import test from "node:test";
import type { CachedMetadata, LinkCache, TFile } from "obsidian";
import type { Comment } from "../src/commentManager";
import { DerivedCommentMetadataManager } from "../src/core/derived/derivedCommentMetadata";
import {
    getDerivedCommentLinksSignature,
    mergeDerivedLinkTargetCounts,
    mergeDerivedLinksIntoCache,
} from "../src/core/derived/derivedCommentMetadataPlanner";
import type { DerivedCommentLinks } from "../src/core/text/commentMentions";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "Folder/Note.md",
        startLine: overrides.startLine ?? 1,
        startChar: overrides.startChar ?? 2,
        endLine: overrides.endLine ?? 1,
        endChar: overrides.endChar ?? 6,
        selectedText: overrides.selectedText ?? "beta",
        selectedTextHash: overrides.selectedTextHash ?? "hash:beta",
        comment: overrides.comment ?? "See [[Target]] and [[Missing]].",
        timestamp: overrides.timestamp ?? 123,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,

    };
}

function createDerivedLinks(overrides: Partial<DerivedCommentLinks> = {}): DerivedCommentLinks {
    const syntheticLink: LinkCache = {
        link: "Target",
        original: "[[Target]]",
        position: {
            start: { line: 1, col: 2, offset: 10 },
            end: { line: 1, col: 10, offset: 18 },
        },
    };

    return {
        links: overrides.links ?? [syntheticLink],
        resolved: overrides.resolved ?? { "Target.md": 1 },
        unresolved: overrides.unresolved ?? { Missing: 1 },
    };
}

test("derived metadata planner merges links into cache once and marks the result", () => {
    const baseCache: CachedMetadata = {
        links: [{
            link: "Existing",
            original: "[[Existing]]",
            position: {
                start: { line: 0, col: 0, offset: 0 },
                end: { line: 0, col: 10, offset: 10 },
            },
        }],
    };
    const derivedLinks = createDerivedLinks();

    const merged = mergeDerivedLinksIntoCache(baseCache, derivedLinks);
    const mergedAgain = mergeDerivedLinksIntoCache(merged, derivedLinks);

    assert.ok(merged);
    assert.equal(merged?.links?.length, 2);
    assert.equal(mergedAgain, merged);
});

test("derived metadata planner signature is stable across resolved and unresolved key order", () => {
    const left = getDerivedCommentLinksSignature(createDerivedLinks({
        resolved: { "b.md": 2, "a.md": 1 },
        unresolved: { Zeta: 1, Alpha: 3 },
    }));
    const right = getDerivedCommentLinksSignature(createDerivedLinks({
        resolved: { "a.md": 1, "b.md": 2 },
        unresolved: { Alpha: 3, Zeta: 1 },
    }));

    assert.equal(left, right);
});

test("derived metadata planner merges target counts by subtracting previous and adding next", () => {
    const merged = mergeDerivedLinkTargetCounts(
        { "a.md": 3, "b.md": 1 },
        { "a.md": 2, "b.md": 1 },
        { "a.md": 1, "c.md": 4 },
    );

    assert.deepEqual(merged, {
        "a.md": 2,
        "c.md": 4,
    });
});

test("derived metadata manager augments metadata cache and keeps derived link counts in sync", () => {
    const file = createFile("Folder/Note.md");
    const targetFile = createFile("Target.md");
    const triggerCalls: Array<{ name: string; args: unknown[] }> = [];
    const baseCache: CachedMetadata = {
        links: [{
            link: "Existing",
            original: "[[Existing]]",
            position: {
                start: { line: 0, col: 0, offset: 0 },
                end: { line: 0, col: 10, offset: 10 },
            },
        }],
    };

    const metadataCache = {
        getCache: (_path: string) => baseCache,
        getFileCache: (_file: TFile) => baseCache,
        getFirstLinkpathDest: (linkPath: string) => (linkPath === "Target" ? targetFile : null),
        resolvedLinks: {} as Record<string, Record<string, number>>,
        unresolvedLinks: {} as Record<string, Record<string, number>>,
        trigger: (name: string, ...args: unknown[]) => {
            triggerCalls.push({ name, args });
        },
    };
    const app = {
        metadataCache,
        vault: {
            getAbstractFileByPath: (path: string) => {
                if (path === file.path) {
                    return file;
                }
                if (path === targetFile.path) {
                    return targetFile;
                }
                return null;
            },
        },
    } as unknown as ConstructorParameters<typeof DerivedCommentMetadataManager>[0];

    const manager = new DerivedCommentMetadataManager(app);
    manager.installMetadataCacheAugmentation();
    manager.syncDerivedCommentLinksForFile(file, "line 0\nline 1", [createComment()]);

    const mergedCache = metadataCache.getCache(file.path);
    assert.equal(mergedCache?.links?.length, 3);
    assert.deepEqual(metadataCache.resolvedLinks[file.path], { "Target.md": 1 });
    assert.deepEqual(metadataCache.unresolvedLinks[file.path], { Missing: 1 });

    manager.clearDerivedCommentLinksForFile(file.path);
    assert.equal(metadataCache.resolvedLinks[file.path], undefined);
    assert.equal(metadataCache.unresolvedLinks[file.path], undefined);

    manager.restoreMetadataCacheAugmentation();
    assert.equal(metadataCache.getCache(file.path), baseCache);
    assert.equal(triggerCalls.some((call) => call.name === "resolved"), true);
});
