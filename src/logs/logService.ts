import type { DataAdapter, Stat } from "obsidian";
import {
    getDailyLogFileName,
    listExpiredLogFiles,
    LOG_RETENTION_DAYS,
} from "./logRetention";
import {
    sanitizeErrorForLog,
    sanitizeLogPayload,
    type LogSanitizerContext,
} from "./logSanitizer";
import { toUtcIsoString } from "../core/time/dateTime";

export type AsideLogLevel = "info" | "warn" | "error";

export interface AsideLogEntry {
    at: string;
    level: AsideLogLevel;
    area: string;
    event: string;
    pluginVersion: string;
    sessionId: string;
    payload?: Record<string, unknown>;
}

export interface AsideLogAttachment {
    fileName: string;
    relativePath: string;
    sizeBytes: number;
    modifiedAt: number | null;
    content: string;
    windowMinutes: number | null;
    capturedAt: string;
}

export const SUPPORT_LOG_ATTACHMENT_WINDOW_MINUTES = 30;

export interface AsideLogServiceOptions {
    adapter: DataAdapter;
    pluginVersion: string;
    pluginDirPath: string;
    pluginDirRelativePath: string;
    vaultRootPath?: string | null;
    now?: () => Date;
    sessionId?: string;
}

function createSessionId(): string {
    const randomUuid = typeof window === "undefined"
        ? undefined
        : window.crypto?.randomUUID?.();
    if (randomUuid) {
        return randomUuid;
    }

    return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeLogPath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function filterLogContentByRecentMinutes(
    content: string,
    recentMinutes: number,
    now: Date,
): string {
    const cutoffMs = now.getTime() - recentMinutes * 60 * 1000;
    const keptLines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => {
            try {
                const parsed = JSON.parse(line) as { at?: unknown };
                if (typeof parsed.at !== "string") {
                    return false;
                }

                const atMs = Date.parse(parsed.at);
                return Number.isFinite(atMs) && atMs >= cutoffMs;
            } catch {
                return false;
            }
        });

    return keptLines.length ? `${keptLines.join("\n")}\n` : "";
}

async function ensureDirectory(adapter: DataAdapter, targetPath: string): Promise<void> {
    const segments = normalizeLogPath(targetPath).split("/").filter(Boolean);
    let nextPath = "";
    for (const segment of segments) {
        nextPath = nextPath ? `${nextPath}/${segment}` : segment;
        if (await adapter.exists(nextPath)) {
            continue;
        }

        await adapter.mkdir(nextPath);
    }
}

export class AsideLogService {
    private readonly now: () => Date;
    private readonly sessionId: string;
    private readonly logsDirPath: string;
    private readonly sanitizerContext: LogSanitizerContext;
    private readonly recentBuffer: AsideLogEntry[] = [];
    private writeQueue: Promise<void> = Promise.resolve();
    private warnedAboutWriteFailure = false;

    constructor(private readonly options: AsideLogServiceOptions) {
        this.now = options.now ?? (() => new Date());
        this.sessionId = options.sessionId ?? createSessionId();
        this.logsDirPath = normalizeLogPath(`${options.pluginDirPath}/logs`);
        this.sanitizerContext = {
            vaultRootPath: options.vaultRootPath ?? null,
            pluginDirPath: options.pluginDirPath,
            pluginDirRelativePath: options.pluginDirRelativePath,
        };
    }

    public getSessionId(): string {
        return this.sessionId;
    }

    public getLogsDirPath(): string {
        return this.logsDirPath;
    }

    public async initialize(): Promise<void> {
        await this.enqueue(async () => {
            await ensureDirectory(this.options.adapter, this.logsDirPath);
            await this.pruneExpiredLogs();
        });
    }

    public async log(
        level: AsideLogLevel,
        area: string,
        event: string,
        payload?: Record<string, unknown>,
    ): Promise<void> {
        const entry: AsideLogEntry = {
            at: toUtcIsoString(this.now()),
            level,
            area,
            event,
            pluginVersion: this.options.pluginVersion,
            sessionId: this.sessionId,
            payload: sanitizeLogPayload(payload, this.sanitizerContext),
        };
        if (!entry.payload || !Object.keys(entry.payload).length) {
            delete entry.payload;
        }

        this.recentBuffer.push(entry);
        if (this.recentBuffer.length > 200) {
            this.recentBuffer.splice(0, this.recentBuffer.length - 200);
        }

        if (level === "error") {
            console.error("[Aside]", event, entry.payload ?? {});
        }

        await this.enqueue(async () => {
            await ensureDirectory(this.options.adapter, this.logsDirPath);
            await this.pruneExpiredLogs();

            const filePath = this.getCurrentLogFilePath();
            const serializedEntry = `${JSON.stringify(entry)}\n`;
            if (await this.options.adapter.exists(filePath)) {
                await this.options.adapter.append(filePath, serializedEntry);
                return;
            }

            await this.options.adapter.write(filePath, serializedEntry);
        });
    }

    public async flush(): Promise<void> {
        await this.writeQueue;
    }

    public async getCurrentLogAttachment(options: {
        recentMinutes?: number;
    } = {}): Promise<AsideLogAttachment | null> {
        await this.flush();
        const filePath = this.getCurrentLogFilePath();
        if (!(await this.options.adapter.exists(filePath))) {
            return null;
        }

        const [rawContent, stat] = await Promise.all([
            this.options.adapter.read(filePath),
            this.options.adapter.stat(filePath),
        ]);
        const recentMinutes = options.recentMinutes ?? null;
        const content = recentMinutes
            ? filterLogContentByRecentMinutes(rawContent, recentMinutes, this.now())
            : rawContent;

        return this.buildAttachment(filePath, content, stat, recentMinutes);
    }

    private async enqueue(task: () => Promise<void>): Promise<void> {
        this.writeQueue = this.writeQueue
            .then(task)
            .catch((error) => {
                if (!this.warnedAboutWriteFailure) {
                    this.warnedAboutWriteFailure = true;
                    console.error("[Aside] Failed to write persistent logs.", sanitizeErrorForLog(error, this.sanitizerContext));
                }
            });
        await this.writeQueue;
    }

    private getCurrentLogFilePath(): string {
        return normalizeLogPath(`${this.logsDirPath}/${getDailyLogFileName(this.now())}`);
    }

    private async pruneExpiredLogs(): Promise<void> {
        if (!(await this.options.adapter.exists(this.logsDirPath))) {
            return;
        }

        const listed = await this.options.adapter.list(this.logsDirPath);
        const expiredFiles = listExpiredLogFiles(listed.files, this.now(), LOG_RETENTION_DAYS);
        await Promise.all(expiredFiles.map((filePath) => this.options.adapter.remove(filePath)));
    }

    private buildAttachment(
        filePath: string,
        content: string,
        stat: Stat | null,
        windowMinutes: number | null,
    ): AsideLogAttachment {
        return {
            fileName: filePath.split("/").pop() ?? filePath,
            relativePath: filePath,
            sizeBytes: new TextEncoder().encode(content).length,
            modifiedAt: stat?.mtime ?? null,
            content,
            windowMinutes,
            capturedAt: toUtcIsoString(this.now()),
        };
    }
}
