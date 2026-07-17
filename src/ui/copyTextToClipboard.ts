export interface ClipboardWriter {
    writeText(text: string): Promise<void>;
}

export interface CopyTextTextarea {
    value: string;
    setAttribute(name: string, value: string): void;
    setCssProps(props: Record<string, string>): void;
    focus(): void;
    select(): void;
    setSelectionRange(start: number, end: number): void;
    remove(): void;
}

export interface CopyTextDocument {
    createAttachedTextarea(): CopyTextTextarea;
    execCommand(command: "copy"): boolean;
}

export interface CopyTextEnvironment {
    clipboard?: ClipboardWriter | null;
    activeDocument?: CopyTextDocument | null;
}

function getDefaultClipboard(): ClipboardWriter | null {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        return null;
    }

    return navigator.clipboard;
}

function getDefaultDocument(): CopyTextDocument | null {
    if (typeof window === "undefined") {
        return null;
    }

    const doc = window.activeDocument;
    const container = doc.body ?? doc.documentElement;
    const execCommand: unknown = Reflect.get(doc, "execCommand");
    if (!container || typeof execCommand !== "function") {
        return null;
    }
    return {
        createAttachedTextarea: () => {
            const textarea = createDetachedObsidianElement(doc, "textarea");
            container.appendChild(textarea);
            return textarea;
        },
        execCommand: (command) => Reflect.apply(execCommand, doc, [command]) === true,
    };
}

export async function copyTextToClipboard(
    text: string,
    environment: CopyTextEnvironment = {},
): Promise<boolean> {
    const clipboard = environment.clipboard === undefined ? getDefaultClipboard() : environment.clipboard;
    if (clipboard?.writeText) {
        try {
            await clipboard.writeText(text);
            return true;
        } catch {
            // Fall back to execCommand for contexts without async clipboard support.
        }
    }

    const doc = environment.activeDocument === undefined ? getDefaultDocument() : environment.activeDocument;
    if (!doc) {
        return false;
    }

    const textarea = doc.createAttachedTextarea();
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.setCssProps({
        left: "-9999px",
        opacity: "0",
        pointerEvents: "none",
        position: "fixed",
        top: "0",
    });

    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    try {
        return doc.execCommand("copy");
    } catch {
        return false;
    } finally {
        textarea.remove();
    }
}
import { createDetachedObsidianElement } from "./dom/createDetachedObsidianElement";
