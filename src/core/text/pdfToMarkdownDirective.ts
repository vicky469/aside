export const PDF_TO_MARKDOWN_DIRECTIVE = "/pdf-to-markdown";
export const PDF_TO_MARKDOWN_USAGE = "Use /pdf-to-markdown by itself on a PDF.";
export const PDF_TO_MARKDOWN_SOURCE_REQUIRED = "Open a PDF and use /pdf-to-markdown.";
export const PDF_TO_MARKDOWN_NO_AGENT = "No agent is available to convert this PDF.";

export type PdfToMarkdownDirectiveResolution =
    | { kind: "none" }
    | { kind: "request" }
    | { kind: "rejected"; message: string };

const PDF_TO_MARKDOWN_PATTERN = /(^|[^\w/])(\/pdf-to-markdown)(?=$|\s)/giu;

export function parsePdfToMarkdownDirective(value: string): PdfToMarkdownDirectiveResolution {
    const matches = Array.from(value.matchAll(PDF_TO_MARKDOWN_PATTERN));
    if (matches.length === 0) return { kind: "none" };
    if (matches.length > 1) {
        return {
            kind: "rejected",
            message: "Use /pdf-to-markdown only once per side note.",
        };
    }

    const match = matches[0];
    const commandStart = (match?.index ?? 0) + (match?.[1]?.length ?? 0);
    const commandEnd = commandStart + PDF_TO_MARKDOWN_DIRECTIVE.length;
    const remainder = `${value.slice(0, commandStart)} ${value.slice(commandEnd)}`.trim();
    return remainder
        ? { kind: "rejected", message: PDF_TO_MARKDOWN_USAGE }
        : { kind: "request" };
}
