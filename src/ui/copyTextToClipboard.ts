export interface ClipboardWriter {
    writeText(text: string): Promise<void>;
}

export interface CopyTextContainer {
    appendChild(node: CopyTextTextarea): void;
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
    body?: CopyTextContainer | null;
    documentElement?: CopyTextContainer | null;
    createElement(tagName: "textarea"): CopyTextTextarea;
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

    const doc = (window as Window & { activeDocument?: Document }).activeDocument;
    return doc ? doc as unknown as CopyTextDocument : null;
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

    const container = doc.body ?? doc.documentElement;
    if (!container) {
        return false;
    }

    const textarea = doc.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.setCssProps({
        left: "-9999px",
        opacity: "0",
        pointerEvents: "none",
        position: "fixed",
        top: "0",
    });

    container.appendChild(textarea);
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
