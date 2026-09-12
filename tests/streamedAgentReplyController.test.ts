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
    private readonly attributeValues = new Map<string, string>();

    public get attributes(): Array<{ name: string; value: string }> {
        return Array.from(this.attributeValues.entries()).map(([name, value]) => ({ name, value }));
    }

    public replaceChildren(...nodes: unknown[]): void {
        this.childNodes = nodes;
    }

    public setAttribute(name: string, value: string): void {
        this.attributeValues.set(name, value);
    }

    public removeAttribute(name: string): void {
        this.attributeValues.delete(name);
    }

    public getAttribute(name: string): string | null {
        return this.attributeValues.get(name) ?? null;
    }
}

class FakeActionButton extends FakeContainerElement {
    public textContent = "";
    public onclick: ((event: {
        preventDefault(): void;
        stopPropagation(): void;
    }) => void) | null = null;
}

class FakeActionContainer extends FakeContainerElement {
    public createEl(_tagName: "button", options: { cls: string; text: string }): FakeActionButton {
        const button = new FakeActionButton();
        button.className = options.cls;
        button.textContent = options.text;
        this.childNodes.push(button);
        return button;
    }
}

class FakeStreamElement extends FakeContainerElement {
    public textContent = "";
    public hidden = false;
    public style = { display: "" };
    public parentElement: FakeStreamElement | null = null;
    public isConnected = true;
    public readonly ownerDocument = {
        createElement: (tagName: string) => new FakeStreamElement(tagName),
    };
    public classList = {
        add: (...tokens: string[]) => {
            this.className = Array.from(new Set([
                ...this.className.split(/\s+/u).filter(Boolean),
                ...tokens,
            ])).join(" ");
        },
        remove: (...tokens: string[]) => {
            const removed = new Set(tokens);
            this.className = this.className
                .split(/\s+/u)
                .filter((token) => token && !removed.has(token))
                .join(" ");
        },
        contains: (token: string) => this.className.split(/\s+/u).includes(token),
        toggle: (token: string, force?: boolean) => {
            const enabled = force ?? !this.className.split(/\s+/u).includes(token);
            if (enabled) {
                this.classList.add(token);
            } else {
                this.classList.remove(token);
            }
            return enabled;
        },
    };

    constructor(public readonly tagName = "") {
        super();
    }

    public get nextSibling(): FakeStreamElement | null {
        const siblings = this.parentElement?.childNodes ?? [];
        const index = siblings.indexOf(this);
        const next = index >= 0 ? siblings[index + 1] : null;
        return next instanceof FakeStreamElement ? next : null;
    }

    public instanceOf(type: { name: string }): boolean {
        return (type.name === "HTMLSpanElement" && (this.tagName === "" || this.tagName === "span"))
            || (type.name === "HTMLDivElement" && (this.tagName === "" || this.tagName === "div"));
    }

    public appendChild(child: FakeStreamElement): FakeStreamElement {
        child.remove();
        child.parentElement = this;
        this.childNodes.push(child);
        return child;
    }

    public insertBefore(child: FakeStreamElement, reference: FakeStreamElement | null): FakeStreamElement {
        child.remove();
        child.parentElement = this;
        const index = reference ? this.childNodes.indexOf(reference) : -1;
        this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
        return child;
    }

    public override replaceChildren(...nodes: FakeStreamElement[]): void {
        for (const child of this.childNodes) {
            if (child instanceof FakeStreamElement) {
                child.parentElement = null;
            }
        }
        this.childNodes = [];
        for (const node of nodes) {
            this.appendChild(node);
        }
    }

    public remove(): void {
        if (!this.parentElement) {
            return;
        }
        this.parentElement.childNodes = this.parentElement.childNodes.filter((node) => node !== this);
        this.parentElement = null;
    }

    public replaceWith(replacement: FakeStreamElement): void {
        const parent = this.parentElement;
        if (!parent) {
            return;
        }
        parent.insertBefore(replacement, this);
        this.remove();
    }

    public createEl(_tagName: "button", options: { cls: string; text: string }): FakeActionButton {
        const button = new FakeActionButton();
        button.className = options.cls;
        button.textContent = options.text;
        this.childNodes.push(button);
        return button;
    }

    public querySelector(selector: string): FakeStreamElement | null {
        for (const child of this.childNodes) {
            if (!(child instanceof FakeStreamElement)) {
                continue;
            }
            if (child.matches(selector)) {
                return child;
            }
            const nested = child.querySelector(selector);
            if (nested) {
                return nested;
            }
        }
        return null;
    }

    public querySelectorAll(selector: string): FakeStreamElement[] {
        const matches: FakeStreamElement[] = [];
        for (const child of this.childNodes) {
            if (!(child instanceof FakeStreamElement)) {
                continue;
            }
            if (child.matches(selector)) {
                matches.push(child);
            }
            matches.push(...child.querySelectorAll(selector));
        }
        return matches;
    }

    public closest(selector: string): FakeStreamElement | null {
        if (this.matches(selector)) {
            return this;
        }
        let candidate = this.parentElement;
        while (candidate) {
            if (candidate.matches(selector)) {
                return candidate;
            }
            candidate = candidate.parentElement;
        }
        return null;
    }

    private matches(selector: string): boolean {
        const match = /^\.([\w-]+)(?:\[([\w-]+)="([^"]*)"\])?$/u.exec(selector);
        return !!match
            && this.classList.contains(match[1])
            && (!match[2] || this.getAttribute(match[2]) === match[3]);
    }
}

class FakeStatusChildElement extends FakeContainerElement {
    public textContent = "";
    public parentElement: FakeStatusElement | null = null;

    public remove(): void {
        if (!this.parentElement) {
            return;
        }
        this.parentElement.childNodes = this.parentElement.childNodes.filter((node) => node !== this);
        this.parentElement = null;
    }
}

class FakeStatusElement extends FakeContainerElement {
    public readonly ownerDocument = {
        createElement: () => new FakeStatusChildElement(),
    };
    public readonly parentElement = null;

    public appendChild(node: unknown): void {
        this.childNodes.push(node);
        if (node instanceof FakeStatusChildElement) {
            node.parentElement = this;
        }
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

test("streamed agent reply controller keeps only Cancel for a running script-oriented agent job", () => {
    const controller = new StreamedAgentReplyController("thread-1", {
        onCancelRun: () => {},
    }) as any;
    const labelEl = new FakeLabelElement();
    const statusEl = new FakeContainerElement();
    const footerMetaEl = new FakeContainerElement();
    const actionsEl = new FakeActionContainer();
    const addToFileNode = createFakeNode("add-to-file");
    actionsEl.childNodes = [createFakeNode("delete")];
    footerMetaEl.childNodes = [labelEl, statusEl, addToFileNode];

    controller.ownsCard = false;
    controller.labelEl = labelEl;
    controller.statusEl = statusEl;
    controller.footerMetaEl = footerMetaEl;

    controller.syncBorrowedFooterMeta({ runId: "run-1", status: "running", requestKind: "create-script" });
    controller.syncActions(actionsEl, { runId: "run-1", status: "running", requestKind: "create-script" });

    assert.deepEqual(footerMetaEl.childNodes, [labelEl, statusEl]);
    assert.equal(actionsEl.childNodes.length, 1);
    assert.equal((actionsEl.childNodes[0] as FakeActionButton).textContent, "Cancel");
});

test("streamed agent reply controller restores borrowed actions after cancellation", () => {
    const controller = new StreamedAgentReplyController("thread-1", {
        onCancelRun: () => {},
    }) as any;
    const labelEl = new FakeLabelElement();
    const statusEl = new FakeContainerElement();
    const footerMetaEl = new FakeContainerElement();
    const actionsEl = new FakeActionContainer();
    const editNode = createFakeNode("edit");
    const deleteNode = createFakeNode("delete");
    const footerActionNode = createFakeNode("footer-action");
    actionsEl.childNodes = [editNode, deleteNode];
    footerMetaEl.childNodes = [labelEl, statusEl, footerActionNode];

    controller.ownsCard = false;
    controller.labelEl = labelEl;
    controller.statusEl = statusEl;
    controller.footerMetaEl = footerMetaEl;
    controller.borrowedSnapshot = {
        metaText: "saved meta",
        labelClassName: "saved-label",
        labelText: "Gemini",
        labelHidden: false,
        labelDisplay: "",
        statusClassName: "saved-status",
        statusNodes: [],
        statusAriaLabel: null,
        statusTitle: null,
        footerMetaClassName: "aside-thread-footer-meta",
        footerMetaNodes: [labelEl, statusEl, footerActionNode],
        contentNodes: [],
        actionsClassName: "aside-comment-actions",
        actionsNodes: [editNode, deleteNode],
    };

    const stream = {
        runId: "run-1",
        status: "cancelled",
    };
    controller.syncBorrowedFooterMeta(stream);
    controller.syncActions(actionsEl, stream);

    assert.deepEqual(actionsEl.childNodes, [editNode, deleteNode]);
    assert.deepEqual(footerMetaEl.childNodes, [labelEl, statusEl, footerActionNode]);
});

test("streamed agent reply controller keeps borrowed actions hidden during optimistic success", () => {
    const controller = new StreamedAgentReplyController("thread-1", {
        onCancelRun: () => {},
    }) as any;
    const labelEl = new FakeLabelElement();
    const statusEl = new FakeContainerElement();
    const footerMetaEl = new FakeContainerElement();
    const actionsEl = new FakeActionContainer();
    const deleteNode = createFakeNode("delete");
    const footerActionNode = createFakeNode("add-to-file");
    actionsEl.childNodes = [deleteNode];
    footerMetaEl.childNodes = [labelEl, statusEl, footerActionNode];
    controller.ownsCard = false;
    controller.labelEl = labelEl;
    controller.statusEl = statusEl;
    controller.footerMetaEl = footerMetaEl;
    controller.borrowedSnapshot = {
        footerMetaNodes: [labelEl, statusEl, footerActionNode],
        actionsNodes: [deleteNode],
    };

    const stream = { runId: "run-1", status: "succeeded" };
    controller.syncBorrowedFooterMeta(stream);
    controller.syncActions(actionsEl, stream);

    assert.deepEqual(footerMetaEl.childNodes, [labelEl, statusEl]);
    assert.deepEqual(actionsEl.childNodes, []);
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

test("streamed agent reply controller shows only the latest process line as status hint", () => {
    const controller = new StreamedAgentReplyController("thread-1") as any;
    const statusEl = new FakeStatusElement();

    controller.syncStatus(statusEl, "Codex", {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "running",
        statusHintText: "Running command: rg \"Codex\" src",
        processLogLines: [
            "Reading   thread context",
            "Running command: rg \"Codex\" src",
        ],
        partialText: "",
        startedAt: 100,
        updatedAt: 101,
    });

    const hintEl = statusEl.childNodes.find((node) =>
        node instanceof FakeStatusChildElement
        && node.className === "aside-agent-run-status-hint"
    ) as FakeStatusChildElement | undefined;

    assert.equal(
        hintEl?.textContent,
        "Running command: rg \"Codex\" src",
    );
    assert.equal(
        statusEl.getAttribute("aria-label"),
        "Codex Running command: rg \"Codex\" src. running",
    );
});

test("streamed agent reply controller shows starting hint on one grey status line", () => {
    const controller = new StreamedAgentReplyController("thread-1") as any;
    const statusEl = new FakeStatusElement();

    controller.syncStatus(statusEl, "Codex", {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "queued",
        statusHintText: "Starting Codex…",
        partialText: "",
        startedAt: 100,
        updatedAt: 100,
    });

    assert.equal(statusEl.childNodes.length, 2);
    assert.equal(
        (statusEl.childNodes[1] as FakeStatusChildElement).textContent,
        "Starting Codex…",
    );
    assert.equal(statusEl.getAttribute("aria-label"), "Codex Starting Codex…. queued");
});

test("streamed agent reply controller reuses the spinner node across active updates", () => {
    const controller = new StreamedAgentReplyController("thread-1") as any;
    const statusEl = new FakeStatusElement();

    controller.syncStatus(statusEl, "Codex", {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "queued",
        statusHintText: "Starting Codex…",
        partialText: "",
        startedAt: 100,
        updatedAt: 100,
    });
    const queuedMark = statusEl.childNodes[0];

    controller.syncStatus(statusEl, "Codex", {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "running",
        statusHintText: "Reading note context",
        partialText: "",
        startedAt: 100,
        updatedAt: 101,
    });

    assert.equal(statusEl.childNodes[0], queuedMark);
    assert.equal(
        (statusEl.childNodes[1] as FakeStatusChildElement).textContent,
        "Reading note context",
    );
});

test("streamed agent reply controller keeps status identity through optimistic success and save failure", () => {
    const controller = new StreamedAgentReplyController("thread-1") as any;
    const statusEl = new FakeStatusElement();
    const baseStream = {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex" as const,
        runtime: "direct-cli" as const,
        partialText: "Second reply",
        startedAt: 100,
        updatedAt: 101,
    };

    controller.syncStatus(statusEl, "Codex", {
        ...baseStream,
        status: "running",
        statusHintText: "Writing answer",
    });
    const originalMark = statusEl.childNodes[0];

    controller.syncStatus(statusEl, "Codex", {
        ...baseStream,
        status: "succeeded",
        updatedAt: 102,
    });
    assert.equal(statusEl.childNodes[0], originalMark);
    assert.equal((statusEl.childNodes[0] as FakeStatusChildElement).textContent, "✅");
    assert.equal(statusEl.childNodes.length, 1);

    controller.syncStatus(statusEl, "Codex", {
        ...baseStream,
        status: "failed",
        statusHintText: "Couldn’t save reply",
        updatedAt: 103,
    });
    assert.equal(statusEl.childNodes[0], originalMark);
    assert.equal(
        (statusEl.childNodes[1] as FakeStatusChildElement).textContent,
        "Couldn’t save reply",
    );
});

test("streamed agent reply controller formats a completed response off-DOM in the existing content element", async () => {
    let finishRender: () => void = () => {
        throw new Error("Renderer did not start.");
    };
    let renderTarget: FakeStreamElement | null = null;
    const controller = new StreamedAgentReplyController("thread-1", {
        renderFinalMarkdown: async (_markdown, container) => {
            renderTarget = container as unknown as FakeStreamElement;
            await new Promise<void>((resolve) => {
                finishRender = resolve;
            });
        },
    }) as any;
    const contentEl = new FakeStreamElement("div");
    controller.contentEl = contentEl;

    controller.syncContent(contentEl, {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "succeeded",
        partialText: "**Done**",
        startedAt: 100,
        updatedAt: 101,
    });

    assert.equal(contentEl.textContent, "**Done**");
    assert.deepEqual(contentEl.childNodes, []);
    const renderedNode = new FakeStreamElement("strong");
    (renderTarget as unknown as FakeStreamElement).appendChild(renderedNode);
    finishRender();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(controller.contentEl, contentEl);
    assert.deepEqual(contentEl.childNodes, [renderedNode]);
});

test("streamed agent reply controller ignores a stale terminal render", async () => {
    const finishRenders: Array<() => void> = [];
    const renderTargets: FakeStreamElement[] = [];
    const controller = new StreamedAgentReplyController("thread-1", {
        renderFinalMarkdown: async (_markdown, container) => {
            renderTargets.push(container as unknown as FakeStreamElement);
            await new Promise<void>((resolve) => {
                finishRenders.push(resolve);
            });
        },
    }) as any;
    const contentEl = new FakeStreamElement("div");
    controller.contentEl = contentEl;
    const baseStream = {
        threadId: "thread-1",
        requestedAgent: "codex" as const,
        runtime: "direct-cli" as const,
        status: "succeeded" as const,
        startedAt: 100,
        updatedAt: 101,
    };

    controller.syncContent(contentEl, {
        ...baseStream,
        runId: "run-1",
        partialText: "Old reply",
    });
    controller.syncContent(contentEl, {
        ...baseStream,
        runId: "run-2",
        partialText: "New reply",
    });
    const oldNode = new FakeStreamElement("p");
    const newNode = new FakeStreamElement("strong");
    renderTargets[0].appendChild(oldNode);
    renderTargets[1].appendChild(newNode);

    finishRenders[1]();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(contentEl.childNodes, [newNode]);

    finishRenders[0]();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(contentEl.childNodes, [newNode]);
});

test("streamed agent reply controller renders the same terminal response once", () => {
    let renderCount = 0;
    const controller = new StreamedAgentReplyController("thread-1", {
        renderFinalMarkdown: async () => {
            renderCount += 1;
        },
    }) as any;
    const contentEl = new FakeStreamElement("div");
    controller.contentEl = contentEl;
    const stream = {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex" as const,
        runtime: "direct-cli" as const,
        status: "succeeded" as const,
        partialText: "Final reply",
        startedAt: 100,
        updatedAt: 101,
    };

    controller.syncContent(contentEl, stream);
    controller.syncContent(contentEl, stream);

    assert.equal(renderCount, 1);
});

test("streamed agent reply controller keeps plain text when final rendering throws", () => {
    const renderError = new Error("render failed");
    let reportedError: unknown = null;
    const controller = new StreamedAgentReplyController("thread-1", {
        renderFinalMarkdown: () => {
            throw renderError;
        },
        onFinalMarkdownRenderError: (error) => {
            reportedError = error;
        },
    }) as any;
    const contentEl = new FakeStreamElement("div");
    controller.contentEl = contentEl;

    assert.doesNotThrow(() => {
        controller.syncContent(contentEl, {
            runId: "run-1",
            threadId: "thread-1",
            requestedAgent: "codex",
            runtime: "direct-cli",
            status: "succeeded",
            partialText: "Complete reply",
            startedAt: 100,
            updatedAt: 101,
        });
    });
    assert.equal(contentEl.textContent, "Complete reply");
    assert.equal(reportedError, renderError);
});

test("streamed agent reply controller keeps plain text when final rendering rejects", async () => {
    const renderError = new Error("render rejected");
    let reportedError: unknown = null;
    const controller = new StreamedAgentReplyController("thread-1", {
        renderFinalMarkdown: async () => {
            throw renderError;
        },
        onFinalMarkdownRenderError: (error) => {
            reportedError = error;
        },
    }) as any;
    const contentEl = new FakeStreamElement("div");
    controller.contentEl = contentEl;

    controller.syncContent(contentEl, {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "succeeded",
        partialText: "Complete reply",
        startedAt: 100,
        updatedAt: 101,
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(contentEl.textContent, "Complete reply");
    assert.equal(reportedError, renderError);
});

test("streamed agent reply controller keeps plain text when final rendering produces no nodes", async () => {
    let reportedError: unknown = null;
    const controller = new StreamedAgentReplyController("thread-1", {
        renderFinalMarkdown: async () => {},
        onFinalMarkdownRenderError: (error) => {
            reportedError = error;
        },
    }) as any;
    const plainTextNode = createFakeNode("plain-text");
    const contentEl = new FakeStreamElement("div");
    contentEl.textContent = "Complete reply";
    contentEl.childNodes = [plainTextNode];
    controller.contentEl = contentEl;

    controller.syncContent(contentEl, {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "succeeded",
        partialText: "Complete reply",
        startedAt: 100,
        updatedAt: 101,
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(contentEl.childNodes, [plainTextNode]);
    assert.match(String(reportedError), /no content/u);
});

test("streamed agent reply controller preserves rendered content when saving later fails", async () => {
    let renderCount = 0;
    const renderedNode = new FakeStreamElement("strong");
    const controller = new StreamedAgentReplyController("thread-1", {
        renderFinalMarkdown: async (_markdown, container) => {
            renderCount += 1;
            (container as unknown as FakeStreamElement).appendChild(renderedNode);
        },
    }) as any;
    const contentEl = new FakeStreamElement("div");
    controller.contentEl = contentEl;
    const stream = {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex" as const,
        runtime: "direct-cli" as const,
        partialText: "**Complete reply**",
        startedAt: 100,
        updatedAt: 101,
    };

    controller.syncContent(contentEl, { ...stream, status: "succeeded" });
    await Promise.resolve();
    await Promise.resolve();
    controller.syncContent(contentEl, {
        ...stream,
        status: "failed",
        statusHintText: "Couldn’t save reply",
        updatedAt: 102,
    });

    assert.equal(renderCount, 1);
    assert.deepEqual(contentEl.childNodes, [renderedNode]);
});

test("streamed agent reply controller keeps one card through optimistic completion", () => {
    const previousSpan = Object.getOwnPropertyDescriptor(globalThis, "HTMLSpanElement");
    const previousDiv = Object.getOwnPropertyDescriptor(globalThis, "HTMLDivElement");
    Object.defineProperty(globalThis, "HTMLSpanElement", {
        configurable: true,
        value: class HTMLSpanElement {},
    });
    Object.defineProperty(globalThis, "HTMLDivElement", {
        configurable: true,
        value: class HTMLDivElement {},
    });

    const controller = new StreamedAgentReplyController("thread-1") as any;
    const containerEl = new FakeStreamElement();
    const threadEl = new FakeStreamElement();
    threadEl.className = "aside-thread-stack";
    threadEl.setAttribute("data-thread-id", "thread-1");
    containerEl.appendChild(threadEl);

    const baseStream = {
        runId: "run-1",
        threadId: "thread-1",
        requestedAgent: "codex" as const,
        runtime: "direct-cli" as const,
        partialText: "Second reply",
        startedAt: 100,
        updatedAt: 101,
        outputEntryId: "entry-1",
    };

    try {
        for (const status of ["running", "succeeded", "failed"] as const) {
            controller.sync(containerEl as any, {
                ...baseStream,
                status,
                ...(status === "failed" ? { statusHintText: "Couldn’t save reply" } : {}),
            });
            const cards = threadEl.querySelectorAll(".aside-agent-stream-item");
            assert.equal(cards.length, 1);
            assert.equal(controller.cardEl, cards[0]);
            assert.equal(controller.contentEl?.textContent, "Second reply");
        }
    } finally {
        if (previousSpan) {
            Object.defineProperty(globalThis, "HTMLSpanElement", previousSpan);
        } else {
            Reflect.deleteProperty(globalThis, "HTMLSpanElement");
        }
        if (previousDiv) {
            Object.defineProperty(globalThis, "HTMLDivElement", previousDiv);
        } else {
            Reflect.deleteProperty(globalThis, "HTMLDivElement");
        }
    }
});

test("streamed agent reply controller places a child-triggered card beside its trigger", () => {
    const previousSpan = Object.getOwnPropertyDescriptor(globalThis, "HTMLSpanElement");
    const previousDiv = Object.getOwnPropertyDescriptor(globalThis, "HTMLDivElement");
    Object.defineProperty(globalThis, "HTMLSpanElement", {
        configurable: true,
        value: class HTMLSpanElement {},
    });
    Object.defineProperty(globalThis, "HTMLDivElement", {
        configurable: true,
        value: class HTMLDivElement {},
    });
    const controller = new StreamedAgentReplyController("thread-1") as any;
    const containerEl = new FakeStreamElement("div");
    const threadEl = new FakeStreamElement("div");
    const repliesEl = new FakeStreamElement("div");
    const triggerEl = new FakeStreamElement("div");
    const laterEl = new FakeStreamElement("div");
    threadEl.className = "aside-thread-stack";
    threadEl.setAttribute("data-thread-id", "thread-1");
    repliesEl.className = "aside-thread-replies";
    triggerEl.className = "aside-thread-entry-item";
    triggerEl.setAttribute("data-comment-id", "entry-2");
    laterEl.className = "aside-thread-entry-item";
    laterEl.setAttribute("data-comment-id", "entry-3");
    repliesEl.appendChild(triggerEl);
    repliesEl.appendChild(laterEl);
    threadEl.appendChild(repliesEl);
    containerEl.appendChild(threadEl);

    try {
        controller.sync(containerEl as any, {
            runId: "run-1",
            threadId: "thread-1",
            triggerEntryId: "entry-2",
            requestedAgent: "codex",
            runtime: "direct-cli",
            status: "queued",
            statusHintText: "Starting Codex…",
            partialText: "",
            startedAt: 100,
            updatedAt: 100,
            outputEntryId: "reply-1",
        });

        const cardEl = repliesEl.querySelector('.aside-agent-stream-item[data-agent-run-id="run-1"]');
        assert.deepEqual(repliesEl.childNodes, [triggerEl, cardEl, laterEl]);
    } finally {
        if (previousSpan) {
            Object.defineProperty(globalThis, "HTMLSpanElement", previousSpan);
        } else {
            Reflect.deleteProperty(globalThis, "HTMLSpanElement");
        }
        if (previousDiv) {
            Object.defineProperty(globalThis, "HTMLDivElement", previousDiv);
        } else {
            Reflect.deleteProperty(globalThis, "HTMLDivElement");
        }
    }
});

test("streamed agent reply controller repeatedly migrates its live card and adopts persisted interactions", () => {
    const previousDiv = Object.getOwnPropertyDescriptor(globalThis, "HTMLDivElement");
    Object.defineProperty(globalThis, "HTMLDivElement", {
        configurable: true,
        value: class HTMLDivElement {},
    });
    const adoptedCards: Array<[unknown, unknown]> = [];
    let removedAdoptedInteractionCount = 0;
    const controller = new StreamedAgentReplyController("thread-1", {
        adoptPersistedCardInteractions: (persistedCardEl: unknown, retainedCardEl: unknown) => {
            adoptedCards.push([persistedCardEl, retainedCardEl]);
            return () => {
                removedAdoptedInteractionCount += 1;
            };
        },
    } as any) as any;
    const liveThreadEl = new FakeStreamElement("div");
    const liveRepliesEl = new FakeStreamElement("div");
    const liveCardEl = new FakeStreamElement("div");
    const liveNode = new FakeStreamElement("p");
    liveCardEl.className = "aside-comment-item aside-thread-entry-item aside-agent-stream-item";
    liveCardEl.setAttribute("data-agent-run-id", "run-1");
    liveCardEl.setAttribute("data-agent-output-entry-id", "entry-1");
    liveCardEl.appendChild(liveNode);
    liveRepliesEl.appendChild(liveCardEl);
    liveThreadEl.appendChild(liveRepliesEl);
    controller.cardEl = liveCardEl;
    controller.ownsCard = true;
    controller.runId = "run-1";

    const nextThreadEl = new FakeStreamElement("div");
    const nextRepliesEl = new FakeStreamElement("div");
    const persistedCardEl = new FakeStreamElement("div");
    const persistedNode = new FakeStreamElement("article");
    persistedCardEl.className = "aside-comment-item aside-thread-entry-item";
    persistedCardEl.setAttribute("data-comment-id", "entry-1");
    persistedCardEl.setAttribute("data-start-line", "12");
    persistedCardEl.appendChild(persistedNode);
    nextRepliesEl.appendChild(persistedCardEl);
    nextThreadEl.appendChild(nextRepliesEl);

    try {
        const retained = controller.handoffToPersistedThread(nextThreadEl, {
            runId: "run-1",
            threadId: "thread-1",
            requestedAgent: "codex",
            runtime: "direct-cli",
            status: "succeeded",
            partialText: "Complete reply",
            startedAt: 100,
            updatedAt: 101,
            outputEntryId: "entry-1",
        });

        assert.equal(retained, true);
        assert.equal(nextRepliesEl.childNodes[0], liveCardEl);
        assert.deepEqual(liveCardEl.childNodes, [liveNode]);
        assert.equal(controller.ownsCard, false);
        assert.deepEqual(adoptedCards, [[persistedCardEl, liveCardEl]]);

        const failedThreadEl = new FakeStreamElement("div");
        const failedRepliesEl = new FakeStreamElement("div");
        const failedPersistedCardEl = new FakeStreamElement("div");
        const failedPersistedNode = new FakeStreamElement("section");
        failedPersistedCardEl.className = "aside-comment-item aside-thread-entry-item is-agent-failed";
        failedPersistedCardEl.setAttribute("data-comment-id", "entry-1");
        failedPersistedCardEl.setAttribute("data-start-line", "13");
        failedPersistedCardEl.appendChild(failedPersistedNode);
        failedRepliesEl.appendChild(failedPersistedCardEl);
        failedThreadEl.appendChild(failedRepliesEl);

        const retainedAfterFailure = controller.handoffToPersistedThread(failedThreadEl, {
            runId: "run-1",
            threadId: "thread-1",
            requestedAgent: "codex",
            runtime: "direct-cli",
            status: "failed",
            partialText: "Complete reply",
            startedAt: 100,
            updatedAt: 102,
            outputEntryId: "entry-1",
        });

        assert.equal(retainedAfterFailure, true);
        assert.equal(failedRepliesEl.childNodes[0], liveCardEl);
        assert.deepEqual(liveCardEl.childNodes, [liveNode]);
        assert.deepEqual(adoptedCards, [
            [persistedCardEl, liveCardEl],
            [failedPersistedCardEl, liveCardEl],
        ]);
        assert.equal(removedAdoptedInteractionCount, 1);

        controller.clear();

        assert.equal(failedRepliesEl.childNodes[0], liveCardEl);
        assert.equal(liveCardEl.className, "aside-comment-item aside-thread-entry-item is-agent-failed");
        assert.equal(liveCardEl.getAttribute("data-comment-id"), "entry-1");
        assert.equal(liveCardEl.getAttribute("data-start-line"), "13");
        assert.equal(liveCardEl.getAttribute("data-agent-run-id"), null);
        assert.equal(liveCardEl.getAttribute("data-agent-output-entry-id"), null);
        assert.deepEqual(liveCardEl.childNodes, [failedPersistedNode]);
        assert.equal(removedAdoptedInteractionCount, 1);
    } finally {
        if (previousDiv) {
            Object.defineProperty(globalThis, "HTMLDivElement", previousDiv);
        } else {
            Reflect.deleteProperty(globalThis, "HTMLDivElement");
        }
    }
});

test("streamed agent reply controller adopts an output entry id without replacing its card", () => {
    const controller = new StreamedAgentReplyController("thread-1") as any;
    const repliesEl = new FakeContainerElement();
    const threadEl = new FakeContainerElement();
    const cardEl = new FakeContainerElement() as FakeContainerElement & {
        isConnected: boolean;
        parentElement: FakeContainerElement;
    };
    cardEl.isConnected = true;
    cardEl.parentElement = repliesEl;
    cardEl.setAttribute("data-agent-run-id", "run-1");
    controller.cardEl = cardEl;
    controller.ownsCard = true;
    controller.runId = "run-1";
    controller.clear = () => {
        throw new Error("The active card was replaced.");
    };

    const result = controller.ensureCard(threadEl, repliesEl, "entry-1");

    assert.equal(result, cardEl);
});

test("streamed agent reply controller identifies the fallback author", () => {
    const previousSpan = Object.getOwnPropertyDescriptor(globalThis, "HTMLSpanElement");
    const previousDiv = Object.getOwnPropertyDescriptor(globalThis, "HTMLDivElement");
    Object.defineProperty(globalThis, "HTMLSpanElement", {
        configurable: true,
        value: class HTMLSpanElement {},
    });
    Object.defineProperty(globalThis, "HTMLDivElement", {
        configurable: true,
        value: class HTMLDivElement {},
    });
    const controller = new StreamedAgentReplyController("thread-1") as any;
    const metaValueEl = new FakeStreamElement();
    const labelEl = new FakeStreamElement();
    const statusEl = new FakeStreamElement();
    const contentEl = new FakeStreamElement();
    const actionsEl = new FakeStreamElement();
    const cardEl = new FakeStreamElement();

    controller.findThreadElement = () => new FakeStreamElement();
    controller.ensureRepliesContainer = () => new FakeStreamElement();
    controller.ensureCard = () => {
        controller.metaValueEl = metaValueEl;
        controller.labelEl = labelEl;
        controller.statusEl = statusEl;
        controller.contentEl = contentEl;
        controller.actionsEl = actionsEl;
        return cardEl;
    };
    controller.syncBorrowedFooterMeta = () => undefined;
    controller.syncStatus = () => undefined;
    controller.syncActions = () => undefined;

    try {
        controller.sync(new FakeStreamElement(), {
            runId: "run-1",
            threadId: "thread-1",
            requestedAgent: "claude",
            preferredAgent: "gemini",
            requestKind: "create-script",
            runtime: "direct-cli",
            status: "succeeded",
            partialText: "Created.",
            startedAt: 100,
            updatedAt: 101,
        });

        assert.equal(labelEl.textContent, "Claude Code (fallback for Gemini)");
    } finally {
        if (previousSpan) {
            Object.defineProperty(globalThis, "HTMLSpanElement", previousSpan);
        } else {
            Reflect.deleteProperty(globalThis, "HTMLSpanElement");
        }
        if (previousDiv) {
            Object.defineProperty(globalThis, "HTMLDivElement", previousDiv);
        } else {
            Reflect.deleteProperty(globalThis, "HTMLDivElement");
        }
    }
});

function createScrollFixture() {
    let earlierHeight = 300;
    const viewport = {
        scrollTop: 750, scrollLeft: 0, clientHeight: 300, scrollHeight: 2000, parentElement: null,
        getBoundingClientRect: () => ({ top: 0 }),
        querySelectorAll: () => [card],
    };
    const card = {
        getAttribute: (name: string) => name === "data-comment-id" ? "reading-entry" : null,
        getBoundingClientRect: () => ({ top: 600 + earlierHeight - viewport.scrollTop, bottom: 700 + earlierHeight - viewport.scrollTop }),
    };
    return { viewport, card, shrink: () => { earlierHeight = 100; } };
}

test("final Markdown layout preserves the reading position chosen while rendering", async () => {
    const fixture = createScrollFixture();
    let finishRender = () => {};
    const controller = new StreamedAgentReplyController("thread-1", {
        renderFinalMarkdown: async (_markdown, container) => {
            (container as unknown as FakeStreamElement).appendChild(new FakeStreamElement("p"));
            await new Promise<void>((resolve) => { finishRender = resolve; });
        },
    }) as any;
    const content = new FakeStreamElement("div");
    const replace = content.replaceChildren.bind(content);
    content.replaceChildren = (...nodes) => { replace(...nodes); fixture.shrink(); };
    controller.contentEl = content;
    controller.scrollContainerEl = fixture.viewport;
    controller.syncContent(content, {
        runId: "run-1", threadId: "thread-1", requestedAgent: "codex", runtime: "direct-cli",
        status: "succeeded", partialText: "**Reply**", startedAt: 100, updatedAt: 101,
    });
    // The user's scroll during asynchronous formatting must not be undone.
    fixture.viewport.scrollTop = 650;
    const before = fixture.card.getBoundingClientRect().top;
    finishRender();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(fixture.card.getBoundingClientRect().top, before);
});

test("removing a streamed reply preserves the visible card below it", () => {
    const fixture = createScrollFixture();
    const controller = new StreamedAgentReplyController("thread-1") as any;
    controller.scrollContainerEl = fixture.viewport;
    controller.ownsCard = true;
    controller.cardEl = { remove: fixture.shrink };
    const before = fixture.card.getBoundingClientRect().top;
    controller.clear();
    assert.equal(fixture.card.getBoundingClientRect().top, before);
});
