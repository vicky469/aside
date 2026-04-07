export interface VaultAgentsFileContext {
    vaultName: string;
    vaultRootPath: string | null;
    pluginVersion: string;
}

export interface VaultAgentsFileHost {
    getVaultAgentsFileContext(): VaultAgentsFileContext;
    vaultRootFileExists(relativePath: string): Promise<boolean>;
    readVaultRootFile(relativePath: string): Promise<string>;
    writeVaultRootFile(relativePath: string, content: string): Promise<void>;
    deleteVaultRootFile(relativePath: string): Promise<void>;
    showNotice(message: string): void;
    warn(message: string, error: unknown): void;
}

const VAULT_AGENTS_FILE_PATH = "AGENTS.md";
const MANAGED_BLOCK_START_PREFIX = "<!-- SideNote2 managed AGENTS start";
const MANAGED_BLOCK_END = "<!-- SideNote2 managed AGENTS end -->";

export type VaultAgentsSyncMode = "manual" | "startup";

export type VaultAgentsSyncPlan =
    | {
        kind: "write";
        nextContent: string;
        reason: "created" | "updated" | "inserted";
    }
    | {
        kind: "noop";
        reason: "already-current";
    };

type VaultAgentsWriteReason = Extract<VaultAgentsSyncPlan, { kind: "write" }>["reason"];

type VaultAgentsRemovalPlan =
    | {
        kind: "write";
        nextContent: string;
    }
    | {
        kind: "delete";
    }
    | {
        kind: "noop";
    };

function normalizeLineEndings(content: string): string {
    return content.replace(/\r\n/g, "\n");
}

function buildVaultAgentsInstructions(context: VaultAgentsFileContext): string {
    const lines = [
        "# SideNote2 Vault Agent Routing",
        "",
        `This Obsidian vault is \`${context.vaultName}\`.`,
    ];

    if (context.vaultRootPath) {
        lines.push(`Vault root path: \`${context.vaultRootPath}\`.`);
    }

    lines.push(
        "",
        "When a user is working with real SideNote2 comments in this vault:",
        "",
        "- Treat the markdown note as the source of truth.",
        "- Treat the trailing `<!-- SideNote2 comments -->` block as the canonical stored comment data.",
        "- Treat `SideNote2 index.md` as discovery output, not canonical storage.",
        "",
        "If the `sidenote2` skill is already installed in the current assistant, use it for:",
        "",
        "- `obsidian://side-note2-comment?...` URIs",
        "- `reply to this`",
        "- `add another note under this`",
        "- `update this side note`",
        "- `resolve this side note`",
        "- `edit this stored comment`",
        "",
        "Intent mapping:",
        "",
        "- `reply`, `continue`, `answer this`, `add another note under this`",
        "  append to the existing thread",
        "- `update`, `rewrite`, `replace this comment`",
        "  replace the targeted stored comment body",
        "- `resolve`, `mark resolved`, `archive this side note`",
        "  mark the targeted thread resolved",
        "",
        "Preferred write path when the local `sidenote2` CLI is available:",
        "",
        "```bash",
        "sidenote2 comment:append --uri \"obsidian://side-note2-comment?...\" --comment-file /abs/path/reply.md",
        "sidenote2 comment:resolve --uri \"obsidian://side-note2-comment?...\"",
        "sidenote2 comment:update --uri \"obsidian://side-note2-comment?...\" --comment-file /abs/path/comment.md",
        "```",
        "",
        "If the CLI is not available, edit the source markdown note carefully and preserve all existing thread entries unless the user explicitly asked to replace one.",
        "",
    );

    return `${lines.join("\n")}\n`;
}

export function buildVaultAgentsFileContent(context: VaultAgentsFileContext): string {
    return `${MANAGED_BLOCK_START_PREFIX} version="${context.pluginVersion}" -->\n${buildVaultAgentsInstructions(context)}${MANAGED_BLOCK_END}\n`;
}

function findManagedBlockRange(content: string): { start: number; end: number } | null {
    const normalizedContent = normalizeLineEndings(content);
    const start = normalizedContent.indexOf(MANAGED_BLOCK_START_PREFIX);
    if (start === -1) {
        return null;
    }

    const endMarkerStart = normalizedContent.indexOf(MANAGED_BLOCK_END, start);
    if (endMarkerStart === -1) {
        return null;
    }

    let end = endMarkerStart + MANAGED_BLOCK_END.length;
    if (normalizedContent.charAt(end) === "\n") {
        end += 1;
    }

    return { start, end };
}

function isLegacyManagedVaultAgentsFileContent(content: string): boolean {
    const normalizedContent = normalizeLineEndings(content).trim();
    return normalizedContent.startsWith("# SideNote2 Vault Agent Routing")
        && normalizedContent.includes("When a user is working with real SideNote2 comments in this vault:")
        && normalizedContent.includes("obsidian://side-note2-comment?...");
}

function appendManagedBlockToDocument(existingContent: string, managedBlock: string): string {
    const trimmedContent = normalizeLineEndings(existingContent).replace(/\s+$/u, "");
    if (!trimmedContent) {
        return managedBlock;
    }

    return `${trimmedContent}\n\n${managedBlock}`;
}

function removeManagedBlockFromDocument(existingContent: string, blockRange: { start: number; end: number }): string {
    const normalizedContent = normalizeLineEndings(existingContent);
    const before = normalizedContent.slice(0, blockRange.start).replace(/\s+$/u, "");
    const after = normalizedContent.slice(blockRange.end).replace(/^\s+/u, "");

    if (!before && !after) {
        return "";
    }

    if (!before) {
        return `${after}\n`;
    }

    if (!after) {
        return `${before}\n`;
    }

    return `${before}\n\n${after}\n`;
}

export function planVaultAgentsFileSync(
    existingContent: string | null,
    context: VaultAgentsFileContext,
    _mode: VaultAgentsSyncMode,
): VaultAgentsSyncPlan {
    const nextManagedContent = buildVaultAgentsFileContent(context);
    if (existingContent === null) {
        return {
            kind: "write",
            nextContent: nextManagedContent,
            reason: "created",
        };
    }

    const normalizedExistingContent = normalizeLineEndings(existingContent);
    const managedBlockRange = findManagedBlockRange(normalizedExistingContent);
    if (managedBlockRange) {
        const currentManagedBlock = normalizedExistingContent.slice(managedBlockRange.start, managedBlockRange.end);
        if (currentManagedBlock === nextManagedContent) {
            return {
                kind: "noop",
                reason: "already-current",
            };
        }

        return {
            kind: "write",
            nextContent: `${normalizedExistingContent.slice(0, managedBlockRange.start)}${nextManagedContent}${normalizedExistingContent.slice(managedBlockRange.end)}`,
            reason: "updated",
        };
    }

    if (isLegacyManagedVaultAgentsFileContent(normalizedExistingContent)) {
        return {
            kind: "write",
            nextContent: nextManagedContent,
            reason: "updated",
        };
    }

    return {
        kind: "write",
        nextContent: appendManagedBlockToDocument(normalizedExistingContent, nextManagedContent),
        reason: "inserted",
    };
}

export function planVaultAgentsFileRemoval(existingContent: string | null): VaultAgentsRemovalPlan {
    if (existingContent === null) {
        return { kind: "noop" };
    }

    const normalizedExistingContent = normalizeLineEndings(existingContent);
    const managedBlockRange = findManagedBlockRange(normalizedExistingContent);
    if (managedBlockRange) {
        const nextContent = removeManagedBlockFromDocument(normalizedExistingContent, managedBlockRange);
        return nextContent.trim().length > 0
            ? { kind: "write", nextContent }
            : { kind: "delete" };
    }

    if (isLegacyManagedVaultAgentsFileContent(normalizedExistingContent)) {
        return { kind: "delete" };
    }

    return { kind: "noop" };
}

export class VaultAgentsFileController {
    constructor(private readonly host: VaultAgentsFileHost) {}

    public async installVaultAgentsFile(): Promise<void> {
        await this.syncVaultAgentsFile("manual");
    }

    public async uninstallVaultAgentsFile(): Promise<void> {
        const context = this.host.getVaultAgentsFileContext();
        const location = this.describeLocation(context);
        let existingContent: string | null = null;

        try {
            if (await this.host.vaultRootFileExists(VAULT_AGENTS_FILE_PATH)) {
                existingContent = await this.host.readVaultRootFile(VAULT_AGENTS_FILE_PATH);
            }
        } catch (error) {
            this.host.warn("Failed to read AGENTS.md from the vault root.", error);
            this.host.showNotice("Failed to inspect AGENTS.md in the vault root.");
            return;
        }

        const plan = planVaultAgentsFileRemoval(existingContent);
        if (plan.kind === "noop") {
            this.host.showNotice(`No SideNote2 AGENTS instructions found in ${location}`);
            return;
        }

        try {
            if (plan.kind === "delete") {
                await this.host.deleteVaultRootFile(VAULT_AGENTS_FILE_PATH);
            } else {
                await this.host.writeVaultRootFile(VAULT_AGENTS_FILE_PATH, plan.nextContent);
            }
        } catch (error) {
            this.host.warn("Failed to remove SideNote2 AGENTS instructions from the vault root.", error);
            this.host.showNotice("Failed to remove SideNote2 AGENTS instructions from the vault root.");
            return;
        }

        this.host.showNotice(
            plan.kind === "delete"
                ? `Removed SideNote2 AGENTS.md from ${location}`
                : `Removed SideNote2 AGENTS instructions from ${location}`,
        );
    }

    public async syncVaultAgentsFileOnStartup(): Promise<void> {
        await this.syncVaultAgentsFile("startup");
    }

    private async syncVaultAgentsFile(mode: VaultAgentsSyncMode): Promise<void> {
        const context = this.host.getVaultAgentsFileContext();
        const location = this.describeLocation(context);
        let existingContent: string | null = null;

        try {
            if (await this.host.vaultRootFileExists(VAULT_AGENTS_FILE_PATH)) {
                existingContent = await this.host.readVaultRootFile(VAULT_AGENTS_FILE_PATH);
            }
        } catch (error) {
            this.host.warn("Failed to read AGENTS.md from the vault root.", error);
            if (mode === "manual") {
                this.host.showNotice("Failed to inspect AGENTS.md in the vault root.");
            }
            return;
        }

        const plan = planVaultAgentsFileSync(existingContent, context, mode);
        if (plan.kind === "noop") {
            if (mode === "manual") {
                this.host.showNotice(`SideNote2 AGENTS instructions are already up to date in ${location}`);
            }
            return;
        }

        try {
            await this.host.writeVaultRootFile(VAULT_AGENTS_FILE_PATH, plan.nextContent);
        } catch (error) {
            this.host.warn("Failed to write AGENTS.md into the vault root.", error);
            if (mode === "manual") {
                this.host.showNotice("Failed to install AGENTS.md in the vault root.");
            }
            return;
        }

        if (mode === "manual") {
            this.host.showNotice(this.buildManualSuccessNotice(plan.reason, location));
        }
    }

    private describeLocation(context: VaultAgentsFileContext): string {
        return context.vaultRootPath
            ? `${context.vaultRootPath}/AGENTS.md`
            : `the vault root for ${context.vaultName}`;
    }

    private buildManualSuccessNotice(reason: VaultAgentsWriteReason, location: string): string {
        switch (reason) {
            case "created":
                return `Installed AGENTS.md in ${location}`;
            case "updated":
                return `Updated SideNote2 AGENTS instructions in ${location}`;
            case "inserted":
                return `Inserted SideNote2 AGENTS instructions into existing ${location}`;
        }
    }
}
