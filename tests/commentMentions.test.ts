import * as assert from "node:assert/strict";
import test from "node:test";
import { buildDerivedCommentLinks, extractWikiLinkPaths, extractWikiLinks } from "../src/core/text/commentMentions";
import type { Comment, CommentThread } from "../src/commentManager";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: "comment-1",
        filePath: "tmp.md",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 0,
        selectedText: "tmp",
        selectedTextHash: "hash-1",
        comment: "",
        timestamp: 1710000000000,
        ...overrides,
    };
}

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "tmp.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 0,
        selectedText: overrides.selectedText ?? "tmp",
        selectedTextHash: overrides.selectedTextHash ?? "hash-1",
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        entries: overrides.entries ?? [],
        createdAt: overrides.createdAt ?? 1710000000000,
        updatedAt: overrides.updatedAt ?? 1710000001000,
    };
}

test("extractWikiLinkPaths returns wiki link targets in order", () => {
    assert.deepEqual(
        extractWikiLinkPaths("See [[Alpha]] then [[Folder/Beta|Beta alias]] and [[Gamma#Section]]."),
        ["Alpha", "Folder/Beta", "Gamma"],
    );
});

test("extractWikiLinks keeps original markup and alias text", () => {
    assert.deepEqual(
        extractWikiLinks("See [[Alpha]] then [[Folder/Beta|Beta alias]]."),
        [
            { linkPath: "Alpha", original: "[[Alpha]]" },
            { linkPath: "Folder/Beta", original: "[[Folder/Beta|Beta alias]]", displayText: "Beta alias" },
        ],
    );
});

test("extractWikiLinkPaths skips embeds, blank links, multiline links, and unfinished links", () => {
    assert.deepEqual(
        extractWikiLinkPaths("![[Embed]] [[ ]] [[Line\nBreak]] [[Open"),
        [],
    );
});

test("buildDerivedCommentLinks creates native link cache entries and counts", () => {
    const derivedLinks = buildDerivedCommentLinks(
        [
            createComment({
                startLine: 2,
                startChar: 1,
                comment: "See [[tmp3]] and [[tmp3|Alias]] plus [[Missing]].",
            }),
            createComment({
                id: "comment-2",
                startLine: 4,
                startChar: 0,
                comment: "Track [[tmp4]].",
            }),
        ],
        "line 0\nline 1\nline 2\nline 3\nline 4",
        (linkPath) => {
            if (linkPath === "tmp3") {
                return "tmp3.md";
            }

            if (linkPath === "tmp4") {
                return "tmp4.md";
            }

            return null;
        },
    );

    assert.deepEqual(derivedLinks.resolved, {
        "tmp3.md": 1,
        "tmp4.md": 1,
    });
    assert.deepEqual(derivedLinks.unresolved, {
        Missing: 1,
    });
    assert.deepEqual(
        derivedLinks.links.map((link) => ({
            link: link.link,
            original: link.original,
            displayText: link.displayText,
            line: link.position.start.line,
            col: link.position.start.col,
        })),
        [
            { link: "tmp3", original: "[[tmp3]]", displayText: undefined, line: 2, col: 1 },
            { link: "Missing", original: "[[Missing]]", displayText: undefined, line: 2, col: 1 },
            { link: "tmp4", original: "[[tmp4]]", displayText: undefined, line: 4, col: 0 },
        ],
    );
});

test("buildDerivedCommentLinks skips self-links", () => {
    const derivedLinks = buildDerivedCommentLinks(
        [
            createComment({
                comment: "[[tmp]] [[tmp5]]",
            }),
        ],
        "tmp",
        (linkPath) => `${linkPath}.md`,
    );

    assert.deepEqual(derivedLinks.resolved, {
        "tmp5.md": 1,
    });
    assert.deepEqual(derivedLinks.unresolved, {});
    assert.equal(derivedLinks.links.length, 1);
    assert.equal(derivedLinks.links[0]?.link, "tmp5");
});

test("buildDerivedCommentLinks scans all thread entries, not just the latest one", () => {
    const derivedLinks = buildDerivedCommentLinks(
        [
            createThread({
                filePath: "docs/source.md",
                startLine: 3,
                startChar: 2,
                entries: [
                    { id: "entry-1", body: "Older reply links [[Target]].", timestamp: 100 },
                    { id: "entry-2", body: "Newest reply has no wikilink.", timestamp: 200 },
                ],
            }),
        ],
        "line 0\nline 1\nline 2\nline 3",
        (linkPath) => linkPath === "Target" ? "docs/target.md" : null,
    );

    assert.deepEqual(derivedLinks.resolved, {
        "docs/target.md": 1,
    });
    assert.deepEqual(derivedLinks.unresolved, {});
    assert.equal(derivedLinks.links.length, 1);
    assert.equal(derivedLinks.links[0]?.link, "Target");
    assert.equal(derivedLinks.links[0]?.position.start.line, 3);
    assert.equal(derivedLinks.links[0]?.position.start.col, 2);
});
