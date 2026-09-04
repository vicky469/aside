import type { SavedUserEntryEvent } from "../core/comments/savedUserEntry";
import {
    PDF_TO_MARKDOWN_SOURCE_REQUIRED,
    derivePdfToMarkdownDestinationPath,
    parsePdfToMarkdownDirective,
} from "../core/text/pdfToMarkdownDirective";

export interface PdfToMarkdownCommandHost {
    appendReply(event: SavedUserEntryEvent, body: string): Promise<void>;
    dispatchRequest(event: SavedUserEntryEvent): Promise<void>;
}

export class PdfToMarkdownCommandController {
    private readonly handledEntryIds = new Set<string>();

    constructor(private readonly host: PdfToMarkdownCommandHost) {}

    public initialize(): void {
        this.handledEntryIds.clear();
    }

    public dispose(): void {
        this.handledEntryIds.clear();
    }

    public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean> {
        const resolution = parsePdfToMarkdownDirective(event.body);
        if (resolution.kind === "none") {
            return false;
        }
        if (this.handledEntryIds.has(event.entryId)) {
            return true;
        }

        this.handledEntryIds.add(event.entryId);
        if (resolution.kind === "rejected") {
            await this.host.appendReply(event, resolution.message);
            return true;
        }
        if (!derivePdfToMarkdownDestinationPath(event.filePath)) {
            await this.host.appendReply(event, PDF_TO_MARKDOWN_SOURCE_REQUIRED);
            return true;
        }

        await this.host.dispatchRequest(event);
        return true;
    }
}
