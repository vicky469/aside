import { AGENTS_EXPERIMENT_DISABLED_NOTICE } from "../core/agents/agentsFeaturePolicy";
import type { SavedUserEntryEvent } from "../core/comments/savedUserEntry";
import {
    PDF_TO_MARKDOWN_SOURCE_REQUIRED,
    parsePdfToMarkdownDirective,
} from "../core/text/pdfToMarkdownDirective";

export interface PdfToMarkdownCommandHost {
    isAgentsFeatureAvailable(): boolean;
    showNotice(message: string): void;
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
        if (!this.host.isAgentsFeatureAvailable()) {
            this.host.showNotice(AGENTS_EXPERIMENT_DISABLED_NOTICE);
            return true;
        }
        if (resolution.kind === "rejected") {
            await this.host.appendReply(event, resolution.message);
            return true;
        }
        if (!/\.pdf$/iu.test(event.filePath)) {
            await this.host.appendReply(event, PDF_TO_MARKDOWN_SOURCE_REQUIRED);
            return true;
        }

        await this.host.dispatchRequest(event);
        return true;
    }
}
