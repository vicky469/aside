import * as assert from "node:assert/strict";
import test from "node:test";
import { createDetachedObsidianElement } from "../src/ui/dom/createDetachedObsidianElement";

function createDocumentHarness(label: string): Document {
    const ownerDocument = { label };
    return {
        win: {
            createFragment: () => ({
                createEl: (tag: string, options?: { cls?: string; text?: string }) => ({
                    ownerDocument,
                    tagName: tag.toUpperCase(),
                    className: options?.cls ?? "",
                    textContent: options?.text ?? "",
                }),
            }),
        },
    } as unknown as Document;
}

test("detached Obsidian elements use the supplied owner document", () => {
    const firstDocument = createDocumentHarness("first");
    const secondDocument = createDocumentHarness("second");

    const first = createDetachedObsidianElement(firstDocument, "span", { cls: "first" });
    const second = createDetachedObsidianElement(secondDocument, "div", { text: "Second" });

    assert.notEqual(first.ownerDocument, second.ownerDocument);
    assert.equal(first.className, "first");
    assert.equal(second.textContent, "Second");
});
