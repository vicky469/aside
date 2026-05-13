import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildSideNoteReferenceMarkdown,
    extractSideNoteReferences,
    parseSideNoteReferenceUrl,
    replaceRawSideNoteReferenceUrls,
    splitTrailingSideNoteReferenceSection,
} from "../src/core/text/commentReferences";

test("parseSideNoteReferenceUrl extracts the vault, file, and comment id", () => {
    assert.deepEqual(
        parseSideNoteReferenceUrl("obsidian://aside-comment?vault=Dev%20Vault&file=docs%2Falpha.md&commentId=comment-1"),
        {
            vaultName: "Dev Vault",
            filePath: "docs/alpha.md",
            commentId: "comment-1",
        },
    );
    assert.equal(parseSideNoteReferenceUrl("obsidian://open?vault=Dev&file=docs%2Falpha.md"), null);
});

test("parseSideNoteReferenceUrl accepts legacy SideNote2 comment links", () => {
    assert.deepEqual(
        parseSideNoteReferenceUrl("obsidian://side-note2-comment?vault=Dev%20Vault&file=docs%2Falpha.md&commentId=comment-1"),
        {
            vaultName: "Dev Vault",
            filePath: "docs/alpha.md",
            commentId: "comment-1",
        },
    );
});

test("extractSideNoteReferences keeps only local-vault markdown links when requested", () => {
    const markdown = [
        "[Local](obsidian://aside-comment?vault=Dev%20Vault&file=docs%2Falpha.md&commentId=comment-1)",
        "[Remote](obsidian://aside-comment?vault=Other%20Vault&file=docs%2Fbeta.md&commentId=comment-2)",
    ].join(" ");

    const references = extractSideNoteReferences(markdown, {
        localOnly: true,
        localVaultName: "Dev Vault",
    });

    assert.deepEqual(references.map((reference) => ({
        label: reference.label,
        commentId: reference.target.commentId,
        filePath: reference.target.filePath,
    })), [{
        label: "Local",
        commentId: "comment-1",
        filePath: "docs/alpha.md",
    }]);
});

test("replaceRawSideNoteReferenceUrls normalizes pasted side note urls", () => {
    const value = "See obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1 next.";
    const normalized = replaceRawSideNoteReferenceUrls(value, (match) =>
        buildSideNoteReferenceMarkdown(match.url, "Alpha insight"),
    );

    assert.equal(
        normalized,
        "See [Alpha insight](obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1) next.",
    );
});

test("replaceRawSideNoteReferenceUrls leaves existing markdown links unchanged", () => {
    const value = "See [Alpha insight](obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1) next.";
    const normalized = replaceRawSideNoteReferenceUrls(value, (match) =>
        buildSideNoteReferenceMarkdown(match.url, "Replaced"),
    );

    assert.equal(
        normalized,
        value,
    );
});

test("buildSideNoteReferenceMarkdown normalizes labels into markdown-link-safe text", () => {
    assert.equal(
        buildSideNoteReferenceMarkdown(
            "obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1",
            "  Alpha [draft]\nplan  ",
        ),
        "[Alpha (draft) plan](obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1)",
    );
});

test("extractSideNoteReferences finds raw side note urls as references", () => {
    const references = extractSideNoteReferences(
        "See obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1 next.",
        {
            localOnly: true,
            localVaultName: "Dev",
        },
    );

    assert.equal(references.length, 1);
    assert.equal(references[0]?.target.commentId, "comment-1");
    assert.equal(references[0]?.url, "obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1");
});

test("splitTrailingSideNoteReferenceSection strips the generated trailing Mentioned appendix", () => {
    const markdown = [
        "Body copy",
        "",
        "Mentioned:",
        "- [Alpha](obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1)",
        "- obsidian://aside-comment?vault=Dev&file=docs%2Fbeta.md&commentId=comment-2",
        "",
    ].join("\n");

    const section = splitTrailingSideNoteReferenceSection(markdown);

    assert.equal(section.body, "Body copy");
    assert.deepEqual(
        section.references.map((reference) => reference.target.commentId),
        ["comment-1", "comment-2"],
    );
});

test("splitTrailingSideNoteReferenceSection keeps the body intact when content follows the section", () => {
    const markdown = [
        "Body copy",
        "",
        "Mentioned:",
        "- [Alpha](obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1)",
        "",
        "Follow-up paragraph",
    ].join("\n");

    const section = splitTrailingSideNoteReferenceSection(markdown);

    assert.equal(section.body, markdown);
    assert.equal(section.references.length, 0);
});

test("splitTrailingSideNoteReferenceSection does not strip mixed-content bullets", () => {
    const markdown = [
        "Body copy",
        "",
        "Mentioned:",
        "- see [Alpha](obsidian://aside-comment?vault=Dev&file=docs%2Falpha.md&commentId=comment-1)",
    ].join("\n");

    const section = splitTrailingSideNoteReferenceSection(markdown);

    assert.equal(section.body, markdown);
    assert.equal(section.references.length, 0);
});

test("splitTrailingSideNoteReferenceSection can ignore foreign-vault references when requested", () => {
    const markdown = [
        "Body copy",
        "",
        "Mentioned:",
        "- [Remote](obsidian://aside-comment?vault=Other%20Vault&file=docs%2Falpha.md&commentId=comment-1)",
    ].join("\n");

    const section = splitTrailingSideNoteReferenceSection(markdown, {
        localOnly: true,
        localVaultName: "Dev Vault",
    });

    assert.equal(section.body, markdown);
    assert.equal(section.references.length, 0);
});
