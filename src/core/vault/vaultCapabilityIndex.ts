import type { TAbstractFile, TFile, TFolder } from "obsidian";
import { normalizeTagText } from "../text/commentTags";

export interface VaultTagUsage {
    tag: string;
    usageCount: number;
}

function isMarkdownFile(value: TAbstractFile): value is TFile {
    return "extension" in value
        && typeof value.extension === "string"
        && value.extension.toLowerCase() === "md";
}

function isFolder(value: TAbstractFile): value is TFolder {
    return "children" in value && Array.isArray(value.children);
}

function normalizeFileTags(tags: readonly string[]): string[] {
    const normalizedByKey = new Map<string, string>();
    for (const rawTag of tags) {
        const tag = normalizeTagText(rawTag);
        if (tag) {
            normalizedByKey.set(tag.toLowerCase(), tag);
        }
    }
    return Array.from(normalizedByKey.values()).sort((left, right) => left.localeCompare(right));
}

export class VaultCapabilityIndex {
    private readonly markdownFilesByPath = new Map<string, TFile>();
    private readonly tagsByFilePath = new Map<string, string[]>();

    public seed(
        files: readonly TFile[],
        getTags: (file: TFile) => readonly string[],
    ): void {
        this.markdownFilesByPath.clear();
        this.tagsByFilePath.clear();
        for (const file of files) {
            this.upsert(file, getTags(file));
        }
    }

    public upsert(file: TFile, tags: readonly string[]): void {
        if (file.extension.toLowerCase() !== "md") {
            this.remove(file.path);
            return;
        }
        this.markdownFilesByPath.set(file.path, file);
        this.tagsByFilePath.set(file.path, normalizeFileTags(tags));
    }

    public rename(file: TFile, oldPath: string, tags: readonly string[]): void {
        this.remove(oldPath);
        this.upsert(file, tags);
    }

    public remove(path: string): void {
        const prefix = `${path.replace(/\/+$/u, "")}/`;
        for (const filePath of Array.from(this.markdownFilesByPath.keys())) {
            if (filePath === path || filePath.startsWith(prefix)) {
                this.markdownFilesByPath.delete(filePath);
                this.tagsByFilePath.delete(filePath);
            }
        }
    }

    public listMarkdownFiles(): TFile[] {
        return Array.from(this.markdownFilesByPath.values())
            .sort((left, right) => left.path.localeCompare(right.path));
    }

    public listMarkdownFilePaths(excludedPath?: string): string[] {
        return this.listMarkdownFiles()
            .map((file) => file.path)
            .filter((path) => path !== excludedPath);
    }

    public listTagUsage(): VaultTagUsage[] {
        const usageByKey = new Map<string, VaultTagUsage>();
        for (const tags of this.tagsByFilePath.values()) {
            for (const tag of tags) {
                const key = tag.toLowerCase();
                const existing = usageByKey.get(key);
                if (existing) {
                    existing.usageCount += 1;
                } else {
                    usageByKey.set(key, { tag, usageCount: 1 });
                }
            }
        }
        return Array.from(usageByKey.values())
            .sort((left, right) => left.tag.localeCompare(right.tag));
    }

    public listMarkdownFilesInFolder(folder: TFolder): TFile[] {
        const results: TFile[] = [];
        const visit = (candidate: TAbstractFile): void => {
            if (isMarkdownFile(candidate)) {
                results.push(candidate);
                return;
            }
            if (isFolder(candidate)) {
                for (const child of candidate.children) {
                    visit(child);
                }
            }
        };
        visit(folder);
        return results.sort((left, right) => left.path.localeCompare(right.path));
    }
}
