import type { EventRef, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import type { PluginEventExecutionContext } from "./pluginEventExecutionContext";

type WorkspaceEventName = "file-open" | "active-leaf-change" | "editor-change";
type VaultEventName = "create" | "rename" | "delete" | "modify";
type AsyncPluginEventName =
    | `vault:${VaultEventName}`
    | "workspace:layout-ready"
    | "metadata-cache:resolved";

interface WorkspaceEventSource {
    layoutReady: boolean;
    on(eventName: "file-open", handler: (file: TFile | null) => void): EventRef;
    on(eventName: "active-leaf-change", handler: (leaf: WorkspaceLeaf | null) => void): EventRef;
    on(eventName: "editor-change", handler: (editor: unknown, info?: { file?: TFile | null }) => void): EventRef;
    on(eventName: WorkspaceEventName, handler: (...args: unknown[]) => void): EventRef;
    onLayoutReady(handler: () => void | Promise<void>): void;
}

interface VaultEventSource {
    on(eventName: "create", handler: (file: unknown) => void | Promise<void>): EventRef;
    on(eventName: "rename", handler: (file: unknown, oldPath: string) => void | Promise<void>): EventRef;
    on(eventName: "delete", handler: (file: unknown) => void | Promise<void>): EventRef;
    on(eventName: "modify", handler: (file: unknown) => void | Promise<void>): EventRef;
    on(eventName: VaultEventName, handler: (...args: unknown[]) => void): EventRef;
}

interface MetadataCacheEventSource {
    on(eventName: "resolved", handler: () => void | Promise<void>): EventRef;
}

export interface PluginEventRouterHost {
    app: {
        workspace: WorkspaceEventSource;
        vault: VaultEventSource;
        metadataCache: MetadataCacheEventSource;
    };
    registerEvent(eventRef: EventRef): void;
    isTFile(value: unknown): value is TFile;
    handleFileCreateMaintenance(file: TAbstractFile | null): void;
    handleFileRenameMaintenance(file: TAbstractFile | null, oldPath: string): void;
    handleFileDeleteMaintenance(file: TAbstractFile | null): void;
    handleLayoutReady(context: PluginEventExecutionContext): void | Promise<void>;
    handleFileOpen(file: TFile | null): void;
    handleActiveLeafChange(leaf: WorkspaceLeaf | null): void;
    handleFileCreate(file: TFile | null, context: PluginEventExecutionContext): Promise<void>;
    handleFileRename(
        file: TAbstractFile | null,
        oldPath: string,
        context: PluginEventExecutionContext,
    ): Promise<void>;
    handleFileDelete(file: TAbstractFile | null, context: PluginEventExecutionContext): Promise<void>;
    handleFileModify(file: TFile | null, context: PluginEventExecutionContext): Promise<void>;
    handleMetadataResolved(context: PluginEventExecutionContext): Promise<void>;
    handleEditorChange(filePath: string | null | undefined): void;
    reportAsyncEventError(eventName: AsyncPluginEventName, error: unknown): void;
}

function isTAbstractFile(value: unknown): value is TAbstractFile {
    return !!value && typeof (value as TAbstractFile).path === "string";
}

function snapshotEventFile<T extends TAbstractFile>(file: T): T {
    const prototype = Reflect.getPrototypeOf(file);
    const snapshot = Object.assign(
        Object.create(prototype) as object,
        file,
    ) as T & { children?: TAbstractFile[] };
    snapshot.path = file.path;
    const children = (file as TAbstractFile & { children?: unknown }).children;
    if (Array.isArray(children)) {
        snapshot.children = children
            .filter(isTAbstractFile)
            .map((child) => snapshotEventFile(child));
    }
    return snapshot;
}

const enum VaultEventRoutingPhase {
    Buffering = "buffering",
    Replaying = "replaying",
    Live = "live",
}

type RoutedVaultEvent =
    | { kind: "create"; file: TAbstractFile | null }
    | { kind: "rename"; file: TAbstractFile | null; oldPath: string }
    | { kind: "delete"; file: TAbstractFile | null };

interface VaultEventQueue {
    readonly epoch: number;
    readonly abortController: AbortController;
    phase: VaultEventRoutingPhase;
    readonly pending: RoutedVaultEvent[];
    drain: Promise<void> | null;
}

export class PluginEventRouter {
    private vaultMaintenanceEventsRegistered = false;
    private vaultEventEpoch = 0;
    private vaultEventQueue = this.createVaultEventQueue();

    constructor(private readonly host: PluginEventRouterHost) {}

    public async register(): Promise<void> {
        const epoch = this.vaultEventEpoch;
        this.registerVaultMaintenanceEvents();
        await this.activateVaultEventQueue(this.vaultEventQueue);
        if (!this.isCurrentEpoch(epoch)) {
            return;
        }
        await this.registerLayoutReady(epoch);
        if (!this.isCurrentEpoch(epoch)) {
            return;
        }
        this.registerWorkspaceEvents(epoch);
        this.registerVaultModifyEvent(epoch);
        this.registerMetadataCacheEvents(epoch);
    }

    public resetForReload(): void {
        this.vaultEventQueue.abortController.abort();
        this.vaultEventQueue.pending.length = 0;
        this.vaultEventEpoch += 1;
        this.vaultMaintenanceEventsRegistered = false;
        this.vaultEventQueue = this.createVaultEventQueue();
    }

    public registerVaultMaintenanceEvents(): void {
        if (this.vaultMaintenanceEventsRegistered) {
            return;
        }

        this.vaultMaintenanceEventsRegistered = true;
        const epoch = this.vaultEventEpoch;
        this.host.registerEvent(
            this.host.app.vault.on("create", (file) => {
                if (!this.isCurrentEpoch(epoch)) {
                    return;
                }
                const createdFile = isTAbstractFile(file) ? file : null;
                this.host.handleFileCreateMaintenance(createdFile);
                this.routeVaultEvent({
                    kind: "create",
                    file: createdFile ? snapshotEventFile(createdFile) : null,
                }, epoch);
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("rename", (file, oldPath) => {
                if (!this.isCurrentEpoch(epoch)) {
                    return;
                }
                const renamedFile = isTAbstractFile(file) ? file : null;
                this.host.handleFileRenameMaintenance(renamedFile, oldPath);
                this.routeVaultEvent({
                    kind: "rename",
                    file: renamedFile ? snapshotEventFile(renamedFile) : null,
                    oldPath,
                }, epoch);
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("delete", (file) => {
                if (!this.isCurrentEpoch(epoch)) {
                    return;
                }
                const deletedFile = isTAbstractFile(file) ? file : null;
                this.host.handleFileDeleteMaintenance(deletedFile);
                this.routeVaultEvent({
                    kind: "delete",
                    file: deletedFile ? snapshotEventFile(deletedFile) : null,
                }, epoch);
            }),
        );
    }

    private createVaultEventQueue(): VaultEventQueue {
        return {
            epoch: this.vaultEventEpoch,
            abortController: new AbortController(),
            phase: VaultEventRoutingPhase.Buffering,
            pending: [],
            drain: null,
        };
    }

    private activateVaultEventQueue(queue: VaultEventQueue): Promise<void> {
        if (queue !== this.vaultEventQueue || queue.phase === VaultEventRoutingPhase.Live) {
            return Promise.resolve();
        }
        if (queue.phase === VaultEventRoutingPhase.Replaying) {
            return queue.drain ?? Promise.resolve();
        }

        queue.phase = VaultEventRoutingPhase.Replaying;
        return this.startVaultEventDrain(queue);
    }

    private startVaultEventDrain(queue: VaultEventQueue): Promise<void> {
        if (queue.drain) {
            return queue.drain;
        }

        const drain = Promise.resolve().then(() => this.drainVaultEvents(queue));
        queue.drain = drain;
        return drain;
    }

    private async drainVaultEvents(queue: VaultEventQueue): Promise<void> {
        while (queue === this.vaultEventQueue) {
            const event = queue.pending.shift();
            if (!event) {
                queue.drain = null;
                queue.phase = VaultEventRoutingPhase.Live;
                return;
            }

            await this.runVaultEvent(event, queue);
        }
    }

    private routeVaultEvent(event: RoutedVaultEvent, epoch: number): void {
        const queue = this.vaultEventQueue;
        if (queue.epoch !== epoch) {
            return;
        }

        queue.pending.push(event);
        if (queue.phase === VaultEventRoutingPhase.Live) {
            void this.startVaultEventDrain(queue);
        }
    }

    private async runVaultEvent(event: RoutedVaultEvent, queue: VaultEventQueue): Promise<void> {
        const context = this.createExecutionContext(queue.epoch, queue.abortController.signal);
        await this.runAsyncEvent(
            `vault:${event.kind}`,
            () => this.handleVaultEvent(event, context),
            () => queue === this.vaultEventQueue,
        );
    }

    private handleVaultEvent(
        event: RoutedVaultEvent,
        context: PluginEventExecutionContext,
    ): Promise<void> {
        switch (event.kind) {
            case "create":
                return this.host.handleFileCreate(
                    this.host.isTFile(event.file) ? event.file : null,
                    context,
                );
            case "rename":
                return this.host.handleFileRename(event.file, event.oldPath, context);
            case "delete":
                return this.host.handleFileDelete(event.file, context);
        }
    }

    private createExecutionContext(epoch: number, signal: AbortSignal): PluginEventExecutionContext {
        return {
            signal,
            isActive: () => !signal.aborted && this.isCurrentEpoch(epoch),
        };
    }

    private isCurrentEpoch(epoch: number): boolean {
        return epoch === this.vaultEventEpoch;
    }

    private dispatchAsyncEvent(
        eventName: AsyncPluginEventName,
        handler: () => void | Promise<void>,
        epoch: number,
    ): void {
        if (!this.isCurrentEpoch(epoch)) {
            return;
        }
        void this.runAsyncEvent(eventName, handler, () => this.isCurrentEpoch(epoch));
    }

    private async runAsyncEvent(
        eventName: AsyncPluginEventName,
        handler: () => void | Promise<void>,
        shouldReportError: () => boolean = () => true,
    ): Promise<void> {
        try {
            await handler();
        } catch (error) {
            if (!shouldReportError()) {
                return;
            }
            try {
                this.host.reportAsyncEventError(eventName, error);
            } catch {
                return;
            }
        }
    }

    private async registerLayoutReady(epoch: number): Promise<void> {
        const signal = this.vaultEventQueue.abortController.signal;
        const context = this.createExecutionContext(epoch, signal);
        if (this.host.app.workspace.layoutReady) {
            await this.runAsyncEvent(
                "workspace:layout-ready",
                () => this.host.handleLayoutReady(context),
                () => this.isCurrentEpoch(epoch),
            );
            return;
        }

        this.host.app.workspace.onLayoutReady(() => {
            this.dispatchAsyncEvent("workspace:layout-ready", () => this.host.handleLayoutReady(context), epoch);
        });
    }

    private registerWorkspaceEvents(epoch: number): void {
        this.host.registerEvent(
            this.host.app.workspace.on("file-open", (file) => {
                if (!this.isCurrentEpoch(epoch)) {
                    return;
                }
                this.host.handleFileOpen(file);
            }),
        );

        this.host.registerEvent(
            this.host.app.workspace.on("active-leaf-change", (leaf) => {
                if (!this.isCurrentEpoch(epoch)) {
                    return;
                }
                this.host.handleActiveLeafChange(leaf);
            }),
        );

        this.host.registerEvent(
            this.host.app.workspace.on("editor-change", (_editor, info) => {
                if (!this.isCurrentEpoch(epoch)) {
                    return;
                }
                this.host.handleEditorChange(info?.file?.path);
            }),
        );
    }

    private registerVaultModifyEvent(epoch: number): void {
        const context = this.createExecutionContext(epoch, this.vaultEventQueue.abortController.signal);
        this.host.registerEvent(
            this.host.app.vault.on("modify", (file) => {
                this.dispatchAsyncEvent(
                    "vault:modify",
                    () => this.host.handleFileModify(this.host.isTFile(file) ? file : null, context),
                    epoch,
                );
            }),
        );
    }

    private registerMetadataCacheEvents(epoch: number): void {
        const context = this.createExecutionContext(epoch, this.vaultEventQueue.abortController.signal);
        this.host.registerEvent(
            this.host.app.metadataCache.on("resolved", () => {
                this.dispatchAsyncEvent(
                    "metadata-cache:resolved",
                    () => this.host.handleMetadataResolved(context),
                    epoch,
                );
            }),
        );
    }
}
