import * as assert from "node:assert/strict";
import test from "node:test";
import {
    formatAgentProcessLogText,
    StreamedAgentReplyController,
} from "../src/ui/views/streamedAgentReplyController";

function createFakeNode(id: string) {
    return {
        id,
        cloneNode: () => createFakeNode(`${id}:clone`),
    };
}

class FakeTextValue {
    public textContent = "";
}

class FakeLabelElement extends FakeTextValue {
    public className = "";
    public hidden = false;
    public style = { display: "" };
}

class FakeContainerElement {
    public className = "";
    public childNodes: unknown[] = [];
    private readonly attributes = new Map<string, string>();

    public replaceChildren(...nodes: unknown[]): void {
        this.childNodes = nodes;
    }

    public setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    public removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    public getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }
}

test("streamed agent reply controller restores borrowed nodes without cloning away handlers", () => {
    const controller = new StreamedAgentReplyController("thread-1") as any;
    const metaValueEl = new FakeTextValue();
    const labelEl = new FakeLabelElement();
    const statusEl = new FakeContainerElement();
    const footerMetaEl = new FakeContainerElement();
    const contentEl = new FakeContainerElement();
    const actionsEl = new FakeContainerElement();
    const statusNode = createFakeNode("status");
    const contentNode = createFakeNode("content");
    const actionNode = createFakeNode("action");
    const footerActionNode = createFakeNode("footer-action");

    controller.ownsCard = false;
    controller.metaValueEl = metaValueEl;
    controller.labelEl = labelEl;
    controller.statusEl = statusEl;
    controller.footerMetaEl = footerMetaEl;
    controller.contentEl = contentEl;
    controller.actionsEl = actionsEl;
    controller.borrowedSnapshot = {
        metaText: "saved meta",
        labelClassName: "saved-label",
        labelText: "Codex",
        labelHidden: false,
        labelDisplay: "",
        statusClassName: "saved-status",
        statusNodes: [statusNode],
        statusAriaLabel: "saved status",
        statusTitle: null,
        footerMetaClassName: "saved-footer-meta",
        footerMetaNodes: [labelEl, statusEl, footerActionNode],
        contentNodes: [contentNode],
        actionsClassName: "saved-actions",
        actionsNodes: [actionNode],
    };

    controller.restoreBorrowedCard();

    assert.equal(metaValueEl.textContent, "saved meta");
    assert.equal(labelEl.className, "saved-label");
    assert.equal(labelEl.textContent, "Codex");
    assert.equal(statusEl.className, "saved-status");
    assert.equal(statusEl.getAttribute("aria-label"), "saved status");
    assert.equal(statusEl.childNodes[0], statusNode);
    assert.equal(footerMetaEl.className, "saved-footer-meta");
    assert.equal(footerMetaEl.childNodes[2], footerActionNode);
    assert.equal(contentEl.childNodes[0], contentNode);
    assert.equal(actionsEl.className, "saved-actions");
    assert.equal(actionsEl.childNodes[0], actionNode);
});

test("streamed agent reply controller hides borrowed footer actions while streaming", () => {
    const controller = new StreamedAgentReplyController("thread-1") as any;
    const labelEl = new FakeLabelElement();
    const statusEl = new FakeContainerElement();
    const footerMetaEl = new FakeContainerElement();
    const addToFileNode = createFakeNode("add-to-file");
    footerMetaEl.childNodes = [labelEl, statusEl, addToFileNode];

    controller.ownsCard = false;
    controller.labelEl = labelEl;
    controller.statusEl = statusEl;
    controller.footerMetaEl = footerMetaEl;

    controller.syncBorrowedFooterMeta();

    assert.deepEqual(footerMetaEl.childNodes, [labelEl, statusEl]);
});

test("streamed agent reply controller formats process log separately from reply text", () => {
    assert.equal(
        formatAgentProcessLogText({
            processLogLines: [
                "Reading thread context",
                "Running command: rg \"Codex\" src",
            ],
        }),
        "Reading thread context\nRunning command: rg \"Codex\" src",
    );
    assert.equal(formatAgentProcessLogText({ processLogLines: [] }), "");
});
