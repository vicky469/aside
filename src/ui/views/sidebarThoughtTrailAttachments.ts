import type { App, TFile } from "obsidian";

export interface ThoughtTrailAttachmentTarget {
    filePath: string;
    fileName: string;
    extension: string;
}

export interface ThoughtTrailAttachmentItem {
    filePath: string;
    label: string;
    typeLabel: string;
}

type ThoughtTrailAttachmentResolver = (
    embedLinkPath: string,
    sourceFilePath: string,
) => ThoughtTrailAttachmentTarget | null;

function normalizeVaultPath(filePath: string): string {
    return filePath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isFileLike(value: unknown): value is TFile {
    return !!value
        && typeof (value as { path?: unknown }).path === "string"
        && typeof (value as { name?: unknown }).name === "string"
        && typeof (value as { extension?: unknown }).extension === "string";
}

export function buildThoughtTrailAttachmentItems(
    sourceFilePath: string,
    embedLinkPaths: readonly string[],
    resolveTarget: ThoughtTrailAttachmentResolver,
): ThoughtTrailAttachmentItem[] {
    const items: ThoughtTrailAttachmentItem[] = [];
    const seenPaths = new Set<string>();

    for (const embedLinkPath of embedLinkPaths) {
        const trimmedLinkPath = embedLinkPath.trim();
        if (!trimmedLinkPath) {
            continue;
        }

        const target = resolveTarget(trimmedLinkPath, sourceFilePath);
        if (!target) {
            continue;
        }

        const filePath = normalizeVaultPath(target.filePath);
        if (!filePath) {
            continue;
        }

        const extension = target.extension.trim().replace(/^\./, "");
        if (extension.toLowerCase() === "md") {
            continue;
        }

        if (seenPaths.has(filePath)) {
            continue;
        }
        seenPaths.add(filePath);

        const label = target.fileName || filePath.split("/").pop() || filePath;
        items.push({
            filePath,
            label,
            typeLabel: extension ? extension.toUpperCase() : "FILE",
        });
    }

    return items.sort((left, right) => {
        const labelOrder = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
        return labelOrder !== 0 ? labelOrder : left.filePath.localeCompare(right.filePath);
    });
}

export function getDirectThoughtTrailAttachments(app: App, sourceFilePath: string): ThoughtTrailAttachmentItem[] {
    const sourceFile = app.vault.getAbstractFileByPath(sourceFilePath);
    if (!isFileLike(sourceFile) || sourceFile.extension.toLowerCase() !== "md") {
        return [];
    }

    const embeds = app.metadataCache.getFileCache(sourceFile)?.embeds ?? [];
    return buildThoughtTrailAttachmentItems(
        sourceFilePath,
        embeds.map((embed) => embed.link),
        (embedLinkPath, exactSourceFilePath) => {
            const target = app.metadataCache.getFirstLinkpathDest(embedLinkPath, exactSourceFilePath);
            if (!isFileLike(target)) {
                return null;
            }
            return {
                filePath: target.path,
                fileName: target.name,
                extension: target.extension,
            };
        },
    );
}
