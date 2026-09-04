import * as assert from "node:assert/strict";
import test from "node:test";
import { isActionableMention } from "../src/core/text/actionableMentions";
import { decorateRenderedCommentMentions } from "../src/ui/editor/commentEditorStyling";

const NODE_FILTER = {
    SHOW_TEXT: 4,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
};

class FakeNode {
    public parentElement: FakeElement | null = null;
}

class FakeTextNode extends FakeNode {
    constructor(public nodeValue: string) {
        super();
    }

    public replaceWith(fragment: FakeFragment): void {
        const parent = this.parentElement;
        assert.ok(parent);
        const index = parent.children.indexOf(this);
        assert.notEqual(index, -1);
        for (const child of fragment.children) {
            child.parentElement = parent;
        }
        parent.children.splice(index, 1, ...fragment.children);
    }
}

class FakeElement extends FakeNode {
    public readonly children: FakeNode[] = [];
    public className = "";
    public textContent = "";

    constructor(public readonly ownerDocument: FakeDocument) {
        super();
    }

    public appendChild(child: FakeNode): FakeNode {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    public closest(): FakeElement | null {
        return null;
    }
}

class FakeFragment {
    public readonly children: FakeNode[] = [];

    constructor(private readonly ownerDocument: FakeDocument) {}

    public append(...values: Array<string | FakeNode>): void {
        for (const value of values) {
            this.children.push(typeof value === "string"
                ? this.ownerDocument.createTextNode(value)
                : value);
        }
    }

    public createEl(): FakeElement {
        return this.ownerDocument.createElement();
    }
}

class FakeDocument {
    public readonly defaultView = { NodeFilter: NODE_FILTER };

    public createElement(): FakeElement {
        return new FakeElement(this);
    }

    public createTextNode(value: string): FakeTextNode {
        return new FakeTextNode(value);
    }

    public createDocumentFragment(): FakeFragment {
        return new FakeFragment(this);
    }

    public createTreeWalker(
        root: FakeElement,
        _whatToShow: number,
        filter: { acceptNode(node: FakeNode): number },
    ): { nextNode(): FakeNode | null } {
        const textNodes: FakeTextNode[] = [];
        const visit = (node: FakeNode): void => {
            if (node instanceof FakeTextNode) {
                if (filter.acceptNode(node) === NODE_FILTER.FILTER_ACCEPT) {
                    textNodes.push(node);
                }
                return;
            }
            if (node instanceof FakeElement) {
                node.children.forEach(visit);
            }
        };
        visit(root);
        let index = 0;
        return {
            nextNode: () => textNodes[index++] ?? null,
        };
    }
}

test("persisted mention decoration styles only actionable mentions", () => {
    const previousText = globalThis.Text;
    (globalThis as { Text: typeof Text }).Text = FakeTextNode as unknown as typeof Text;
    try {
        const document = new FakeDocument();
        const container = document.createElement();
        container.appendChild(document.createTextNode(
            "@todo @codex @cursor @hi /update-script /pdf-to-markdown /clean /missing",
        ));
        const registeredScripts = new Set(["/clean"]);

        decorateRenderedCommentMentions(
            container as unknown as HTMLElement,
            (mention) => isActionableMention(mention, {
                isRunnableVaultScriptMention: (candidate) => (
                    registeredScripts.has(candidate.toLowerCase())
                ),
            }),
        );

        const decorated = container.children
            .filter((child): child is FakeElement => child instanceof FakeElement)
            .map((child) => child.textContent);
        assert.deepEqual(decorated, [
            "@todo",
            "@codex",
            "@cursor",
            "/update-script",
            "/pdf-to-markdown",
            "/clean",
        ]);
        assert.equal(
            container.children
                .filter((child): child is FakeTextNode => child instanceof FakeTextNode)
                .map((child) => child.nodeValue)
                .join(""),
            "   @hi    /missing",
        );
    } finally {
        (globalThis as { Text: typeof Text }).Text = previousText;
    }
});
