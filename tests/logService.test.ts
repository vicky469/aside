import * as assert from "node:assert/strict";
import test from "node:test";
import type { DataAdapter, Stat } from "obsidian";
import { AsideLogService } from "../src/logs/logService";

class FakeAdapter implements Pick<DataAdapter, "exists" | "mkdir" | "list" | "write" | "append" | "read" | "stat" | "remove"> {
    public readonly directories = new Set<string>();
    public readonly files = new Map<string, string>();
    public failWrites = false;

    async exists(normalizedPath: string): Promise<boolean> {
        return this.directories.has(normalizedPath) || this.files.has(normalizedPath);
    }

    async mkdir(normalizedPath: string): Promise<void> {
        this.directories.add(normalizedPath);
    }

    async list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }> {
        const prefix = normalizedPath ? `${normalizedPath}/` : "";
        const files = Array.from(this.files.keys()).filter((filePath) => filePath.startsWith(prefix));
        const folders = Array.from(this.directories).filter((dirPath) => dirPath.startsWith(prefix) && dirPath !== normalizedPath);
        return { files, folders };
    }

    async write(normalizedPath: string, data: string): Promise<void> {
        if (this.failWrites) {
            throw new Error("write failed");
        }
        this.files.set(normalizedPath, data);
    }

    async append(normalizedPath: string, data: string): Promise<void> {
        if (this.failWrites) {
            throw new Error("append failed");
        }
        this.files.set(normalizedPath, `${this.files.get(normalizedPath) ?? ""}${data}`);
    }

    async read(normalizedPath: string): Promise<string> {
        return this.files.get(normalizedPath) ?? "";
    }

    async stat(normalizedPath: string): Promise<Stat | null> {
        const file = this.files.get(normalizedPath);
        if (file === undefined) {
            return null;
        }

        return {
            ctime: 0,
            mtime: 1_712_966_400_000,
            size: new TextEncoder().encode(file).length,
            type: "file",
        } as Stat;
    }

    async remove(normalizedPath: string): Promise<void> {
        this.files.delete(normalizedPath);
    }
}

test("AsideLogService prunes expired daily files and appends deterministic jsonl entries", async () => {
    const adapter = new FakeAdapter();
    adapter.directories.add(".obsidian");
    adapter.directories.add(".obsidian/plugins");
    adapter.directories.add(".obsidian/plugins/aside");
    adapter.directories.add(".obsidian/plugins/aside/logs");
    adapter.files.set(".obsidian/plugins/aside/logs/2026-04-09.jsonl", "{\"old\":true}\n");

    const service = new AsideLogService({
        adapter: adapter as unknown as DataAdapter,
        pluginVersion: "2.0.10",
        pluginDirPath: ".obsidian/plugins/aside",
        pluginDirRelativePath: ".obsidian/plugins/aside",
        vaultRootPath: "/Users/tester/Vault",
        now: () => new Date("2026-04-13T13:30:00.000Z"),
        sessionId: "session-1",
    });

    await service.initialize();
    await service.log("info", "startup", "startup.load.begin", {
        filePath: "/Users/tester/Vault/Folder/Note.md",
    });
    await service.log("warn", "index", "index.refresh.begin", {
        noteContent: "# hidden",
        filePath: "/Users/tester/Vault/Folder/Note.md",
    });

    const logPath = ".obsidian/plugins/aside/logs/2026-04-13.jsonl";
    const content = adapter.files.get(logPath);
    assert.equal(adapter.files.has(".obsidian/plugins/aside/logs/2026-04-09.jsonl"), false);
    assert.ok(content);

    const lines = content!.trim().split("\n").map((line) => JSON.parse(line) as { event: string; payload?: Record<string, unknown> });
    assert.deepEqual(lines.map((line) => line.event), [
        "startup.load.begin",
        "index.refresh.begin",
    ]);
    assert.deepEqual(lines[0].payload, {
        filePath: "Folder/Note.md",
    });
    assert.deepEqual(lines[1].payload, {
        filePath: "Folder/Note.md",
    });
});

test("AsideLogService swallows write failures so user flows do not throw", async () => {
    const adapter = new FakeAdapter();
    adapter.directories.add(".obsidian");
    adapter.directories.add(".obsidian/plugins");
    adapter.directories.add(".obsidian/plugins/aside");
    adapter.failWrites = true;

    const service = new AsideLogService({
        adapter: adapter as unknown as DataAdapter,
        pluginVersion: "2.0.10",
        pluginDirPath: ".obsidian/plugins/aside",
        pluginDirRelativePath: ".obsidian/plugins/aside",
        now: () => new Date("2026-04-13T13:30:00.000Z"),
        sessionId: "session-2",
    });

    await assert.doesNotReject(async () => {
        await service.initialize();
        await service.log("error", "support", "support.submit.error", {
            message: "failure",
        });
    });
});

test("AsideLogService returns only the requested recent attachment window", async () => {
    const adapter = new FakeAdapter();
    adapter.directories.add(".obsidian");
    adapter.directories.add(".obsidian/plugins");
    adapter.directories.add(".obsidian/plugins/aside");
    adapter.directories.add(".obsidian/plugins/aside/logs");

    let now = new Date("2026-04-13T13:00:00.000Z");
    const service = new AsideLogService({
        adapter: adapter as unknown as DataAdapter,
        pluginVersion: "2.0.10",
        pluginDirPath: ".obsidian/plugins/aside",
        pluginDirRelativePath: ".obsidian/plugins/aside",
        now: () => now,
        sessionId: "session-3",
    });

    await service.initialize();
    await service.log("info", "startup", "startup.load.begin");

    now = new Date("2026-04-13T13:20:00.000Z");
    await service.log("info", "index", "index.filter.changed", {
        source: "view-state",
    });

    now = new Date("2026-04-13T13:31:00.000Z");
    await service.log("warn", "persistence", "storage.note.parse.unsupported", {
        filePath: "Example.md",
    });

    const attachment = await service.getCurrentLogAttachment({ recentMinutes: 10 });
    assert.ok(attachment);
    assert.equal(attachment.windowMinutes, 10);
    assert.equal(attachment.capturedAt, "2026-04-13T13:31:00.000Z");

    const events = attachment.content
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { event: string });
    assert.deepEqual(events.map((entry) => entry.event), [
        "storage.note.parse.unsupported",
    ]);
});
