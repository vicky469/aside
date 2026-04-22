import type { Plugin, TFile } from "obsidian";
import type { CommentThread } from "../commentManager";
import {
    buildSideNoteMarkdownExport,
    buildSideNoteMarkdownExportPath,
    type SideNoteMarkdownExportPath,
} from "../core/export/commentMarkdownExport";

export interface CommentExportHost {
    app: Plugin["app"];
    isCommentableFile(file: TFile | null): file is TFile;
    loadCommentsForFile(file: TFile): Promise<unknown>;
    getAllIndexedThreads(): CommentThread[];
    getThreadsForFile(filePath: string): CommentThread[];
    now(): number;
}

export interface CommentExportResult {
    filePath: string;
    exportFilePath: string;
    threadCount: number;
    entryCount: number;
    updatedExistingFile: boolean;
}

function isTFileLike(value: unknown): value is TFile {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as Partial<TFile>;
    return typeof candidate.path === "string"
        && typeof candidate.basename === "string"
        && typeof candidate.extension === "string";
}

export class CommentExportController {
    constructor(private readonly host: CommentExportHost) {}

    public async exportCommentsForFile(file: TFile | null): Promise<CommentExportResult> {
        if (!this.host.isCommentableFile(file)) {
            throw new Error("Cannot export side notes without an active markdown note.");
        }

        await this.host.loadCommentsForFile(file);
        const threads = this.host.getThreadsForFile(file.path);
        const referenceThreads = this.host.getAllIndexedThreads();
        const exportPath = buildSideNoteMarkdownExportPath(file.path);
        await this.ensureExportDirectories(exportPath);
        const content = buildSideNoteMarkdownExport({
            filePath: file.path,
            referenceThreads,
            threads,
            exportedAt: this.host.now(),
        });
        const existing = this.host.app.vault.getAbstractFileByPath(exportPath.exportFilePath);
        let updatedExistingFile = false;

        if (!existing) {
            await this.host.app.vault.create(exportPath.exportFilePath, content);
        } else if (isTFileLike(existing)) {
            updatedExistingFile = true;
            await this.host.app.vault.modify(existing, content);
        } else {
            throw new Error(`Cannot export side notes because ${exportPath.exportFilePath} is not a file.`);
        }

        return {
            filePath: file.path,
            exportFilePath: exportPath.exportFilePath,
            threadCount: threads.length,
            entryCount: threads.reduce((sum, thread) => sum + thread.entries.length, 0),
            updatedExistingFile,
        };
    }

    private async ensureExportDirectories(exportPath: SideNoteMarkdownExportPath): Promise<void> {
        const segments = exportPath.exportDirectoryPath.split("/").filter(Boolean);
        let currentPath = "";

        for (const segment of segments) {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            const existing = this.host.app.vault.getAbstractFileByPath(currentPath);
            if (!existing) {
                await this.host.app.vault.createFolder(currentPath);
                continue;
            }

            if (isTFileLike(existing)) {
                throw new Error(`Cannot export side notes because ${currentPath} is a file.`);
            }
        }
    }
}
