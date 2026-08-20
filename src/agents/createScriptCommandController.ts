import type { SavedUserEntryEvent } from "../core/comments/savedUserEntry";
import { AGENTS_EXPERIMENT_DISABLED_NOTICE } from "../core/agents/agentsFeaturePolicy";
import { parseAgentDirectives } from "../core/text/agentDirectives";
import {
    CREATE_SCRIPT_MIXED_AGENT,
    CREATE_SCRIPT_MIXED_SCRIPT,
    CREATE_SCRIPT_USAGE,
    parseCreateScriptDirective,
} from "../core/text/createScriptDirective";
import { resolveScriptDirective } from "../vaultScripts/scriptDirectives";
import type { VaultScriptRegistry } from "../vaultScripts/vaultScriptRegistry";

export interface CreateScriptCommandHost {
    getRegistry(): VaultScriptRegistry;
    isAgentsFeatureAvailable(): boolean;
    showNotice(message: string): void;
    appendReply(event: SavedUserEntryEvent, body: string): Promise<void>;
    dispatchRequest(event: SavedUserEntryEvent, requestText: string): Promise<void>;
}

export class CreateScriptCommandController {
    private readonly handledEntryIds = new Set<string>();

    constructor(private readonly host: CreateScriptCommandHost) {}

    public initialize(): void {
        this.handledEntryIds.clear();
    }

    public dispose(): void {
        this.handledEntryIds.clear();
    }

    public async handleSavedUserEntry(event: SavedUserEntryEvent): Promise<boolean> {
        const resolution = parseCreateScriptDirective(event.body);
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
        if (resolution.kind === "empty") {
            await this.host.appendReply(event, CREATE_SCRIPT_USAGE);
            return true;
        }
        if (resolution.kind === "rejected") {
            await this.host.appendReply(event, resolution.message);
            return true;
        }

        if (resolveScriptDirective(resolution.requestText, this.host.getRegistry()).kind !== "none") {
            await this.host.appendReply(event, CREATE_SCRIPT_MIXED_SCRIPT);
            return true;
        }

        const agentResolution = parseAgentDirectives(resolution.requestText);
        if (agentResolution.matchedTargets.length > 0 || agentResolution.unsupportedTargets.length > 0) {
            await this.host.appendReply(event, CREATE_SCRIPT_MIXED_AGENT);
            return true;
        }

        await this.host.dispatchRequest(event, resolution.requestText);
        return true;
    }
}
