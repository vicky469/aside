import type { VaultScriptRegistration } from "../../shared/vaultScriptPolicy.js";
import type { SavedUserEntryEvent } from "../core/comments/savedUserEntry";
import {
    UPDATE_SCRIPT_USAGE,
    parseUpdateScriptDirective,
} from "../core/text/updateScriptDirective";
import type { VaultScriptRegistry } from "../vaultScripts/vaultScriptRegistry";

export interface UpdateScriptCommandHost {
    getRegistry(): VaultScriptRegistry;
    appendReply(event: SavedUserEntryEvent, body: string): Promise<void>;
    dispatchRequest(
        event: SavedUserEntryEvent,
        requestText: string,
        targetScript: VaultScriptRegistration,
    ): Promise<void>;
}

export class UpdateScriptCommandController {
    private readonly handledEntryIds = new Set<string>();

    constructor(private readonly host: UpdateScriptCommandHost) {}

    public initialize(): void {
        this.handledEntryIds.clear();
    }

    public dispose(): void {
        this.handledEntryIds.clear();
    }

    public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean> {
        const resolution = parseUpdateScriptDirective(event.body);
        if (resolution.kind === "none") {
            return false;
        }
        if (this.handledEntryIds.has(event.entryId)) {
            return true;
        }

        this.handledEntryIds.add(event.entryId);
        if (resolution.kind === "empty") {
            await this.host.appendReply(event, UPDATE_SCRIPT_USAGE);
            return true;
        }
        if (resolution.kind === "rejected") {
            await this.host.appendReply(event, resolution.message);
            return true;
        }

        const targetScript = this.host.getRegistry().resolve(resolution.targetMention);
        if (!targetScript) {
            await this.host.appendReply(
                event,
                `Script ${resolution.targetMention} is not available to update.`,
            );
            return true;
        }

        await this.host.dispatchRequest(event, resolution.requestText, targetScript);
        return true;
    }
}
