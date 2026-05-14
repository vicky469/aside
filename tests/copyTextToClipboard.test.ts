import * as assert from "node:assert/strict";
import test from "node:test";
import { copyTextToClipboard, type ClipboardWriter, type CopyTextDocument, type CopyTextTextarea } from "../src/ui/copyTextToClipboard";

class FakeTextarea implements CopyTextTextarea {
    value = "";
    public cssProps: Record<string, string> = {};
    public readonly attributes = new Map<string, string>();
    public focused = false;
    public selected = false;
    public selectionRange: [number, number] | null = null;
    public removed = false;

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    setCssProps(props: Record<string, string>): void {
        this.cssProps = { ...props };
    }

    focus(): void {
        this.focused = true;
    }

    select(): void {
        this.selected = true;
    }

    setSelectionRange(start: number, end: number): void {
        this.selectionRange = [start, end];
    }

    remove(): void {
        this.removed = true;
    }
}

function createFakeDocument(execCommandResult: boolean) {
    const appended: FakeTextarea[] = [];
    const body = {
        appendChild(node: FakeTextarea) {
            appended.push(node);
        },
    };

    const doc: CopyTextDocument = {
        body,
        documentElement: body,
        createElement(tagName: "textarea") {
            assert.equal(tagName, "textarea");
            return new FakeTextarea();
        },
        execCommand(command: "copy") {
            assert.equal(command, "copy");
            return execCommandResult;
        },
    };

    return { doc, appended };
}

test("copyTextToClipboard prefers async clipboard when available", async () => {
    const writes: string[] = [];
    const clipboard: ClipboardWriter = {
        async writeText(text: string) {
            writes.push(text);
        },
    };

    const copied = await copyTextToClipboard("Copied text", { clipboard });

    assert.equal(copied, true);
    assert.deepEqual(writes, ["Copied text"]);
});

test("copyTextToClipboard falls back to document.execCommand", async () => {
    const { doc, appended } = createFakeDocument(true);

    const copied = await copyTextToClipboard("Fallback text", {
        clipboard: null,
        activeDocument: doc,
    });

    assert.equal(copied, true);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].value, "Fallback text");
    assert.equal(appended[0].selectionRange?.[0], 0);
    assert.equal(appended[0].selectionRange?.[1], "Fallback text".length);
    assert.equal(appended[0].removed, true);
});

test("copyTextToClipboard returns false when no clipboard path works", async () => {
    const failingClipboard: ClipboardWriter = {
        async writeText() {
            throw new Error("no clipboard");
        },
    };

    const copied = await copyTextToClipboard("Nope", {
        clipboard: failingClipboard,
        activeDocument: null,
    });

    assert.equal(copied, false);
});
