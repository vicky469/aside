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

function createFakeDocument(execCommandResult: boolean, execCommandError?: Error) {
    const appended: FakeTextarea[] = [];
    let createCount = 0;
    const doc: CopyTextDocument = {
        createAttachedTextarea() {
            createCount += 1;
            const textarea = new FakeTextarea();
            appended.push(textarea);
            return textarea;
        },
        execCommand(command: "copy") {
            assert.equal(command, "copy");
            if (execCommandError) {
                throw execCommandError;
            }
            return execCommandResult;
        },
    };

    return { doc, appended, getCreateCount: () => createCount };
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

test("copyTextToClipboard skips the fallback document after async success", async () => {
    const { doc, getCreateCount } = createFakeDocument(true);

    assert.equal(await copyTextToClipboard("Async text", {
        clipboard: { async writeText() {} },
        activeDocument: doc,
    }), true);
    assert.equal(getCreateCount(), 0);
});

test("copyTextToClipboard falls back after async clipboard rejection", async () => {
    const { doc, appended } = createFakeDocument(true);

    const copied = await copyTextToClipboard("Fallback text", {
        clipboard: { async writeText() { throw new Error("denied"); } },
        activeDocument: doc,
    });

    assert.equal(copied, true);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].removed, true);
});

test("copyTextToClipboard configures and removes the fallback textarea", async () => {
    const { doc, appended } = createFakeDocument(false);

    assert.equal(await copyTextToClipboard("Fallback text", {
        clipboard: null,
        activeDocument: doc,
    }), false);
    assert.equal(appended[0].attributes.get("readonly"), "true");
    assert.deepEqual(appended[0].cssProps, {
        left: "-9999px",
        opacity: "0",
        pointerEvents: "none",
        position: "fixed",
        top: "0",
    });
    assert.equal(appended[0].focused, true);
    assert.equal(appended[0].selected, true);
    assert.deepEqual(appended[0].selectionRange, [0, "Fallback text".length]);
    assert.equal(appended[0].removed, true);
});

test("copyTextToClipboard removes the textarea when execCommand throws", async () => {
    const { doc, appended } = createFakeDocument(false, new Error("copy failed"));

    assert.equal(await copyTextToClipboard("Fallback text", {
        clipboard: null,
        activeDocument: doc,
    }), false);
    assert.equal(appended[0].removed, true);
});
