import { createCompactClipboardPayloadText } from "../../core/text/commentPayloads";
import type { TextEditResult } from "./commentEditorFormatting";

export interface ClipboardDataReader {
    getData(type: string): string;
}

export type HtmlToMarkdownConverter = (html: string) => string;

function normalizeClipboardMarkdown(value: string): string {
    const normalized = value
        .replace(/\r\n?/g, "\n")
        .replace(/\u00a0/g, " ");

    return normalized
        .replace(/^(?:[ \t]*\n)+/, "")
        .replace(/(?:\n[ \t]*)+$/, "");
}

function normalizeForComparison(value: string): string {
    return normalizeClipboardMarkdown(value).trim();
}

function clampSelection(value: string, selectionStart: number, selectionEnd: number): [number, number] {
    const start = Math.max(0, Math.min(selectionStart, value.length));
    const end = Math.max(0, Math.min(selectionEnd, value.length));
    return start <= end ? [start, end] : [end, start];
}

export function createDraftPasteEdit(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    clipboardData: ClipboardDataReader | null,
    htmlToMarkdown: HtmlToMarkdownConverter,
): TextEditResult | null {
    const plainText = clipboardData?.getData("text/plain") ?? "";
    const compactPlainText = plainText ? createCompactClipboardPayloadText(plainText) : null;
    if (compactPlainText) {
        const [start, end] = clampSelection(value, selectionStart, selectionEnd);
        const nextValue = `${value.slice(0, start)}${compactPlainText}${value.slice(end)}`;
        const nextSelection = start + compactPlainText.length;
        return {
            value: nextValue,
            selectionStart: nextSelection,
            selectionEnd: nextSelection,
        };
    }

    const html = clipboardData?.getData("text/html") ?? "";
    if (!html.trim()) {
        return null;
    }

    let markdown: string;
    try {
        markdown = normalizeClipboardMarkdown(htmlToMarkdown(html));
    } catch {
        return null;
    }

    if (!markdown.trim()) {
        return null;
    }

    if (plainText && normalizeForComparison(markdown) === normalizeForComparison(plainText)) {
        return null;
    }

    const [start, end] = clampSelection(value, selectionStart, selectionEnd);
    const nextValue = `${value.slice(0, start)}${markdown}${value.slice(end)}`;
    const nextSelection = start + markdown.length;
    return {
        value: nextValue,
        selectionStart: nextSelection,
        selectionEnd: nextSelection,
    };
}

export function applyDraftPasteEditToTextarea(
    textarea: HTMLTextAreaElement,
    event: ClipboardEvent,
    htmlToMarkdown: HtmlToMarkdownConverter,
): boolean {
    const edit = createDraftPasteEdit(
        textarea.value,
        textarea.selectionStart,
        textarea.selectionEnd,
        event.clipboardData,
        htmlToMarkdown,
    );
    if (!edit) {
        return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    textarea.value = edit.value;
    textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    textarea.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: null,
        inputType: "insertFromPaste",
    }));
    return true;
}
