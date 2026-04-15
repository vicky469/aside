import type { CachedMetadata, Plugin, TFile } from "obsidian";
import type { Comment } from "../../commentManager";
import { buildDerivedCommentLinks, type DerivedCommentLinks } from "../text/commentMentions";
import {
    getDerivedCommentLinksSignature,
    hasDerivedCommentLinks,
    mergeDerivedLinkTargetCounts,
    mergeDerivedLinksIntoCache,
} from "./derivedCommentMetadataPlanner";

type MutableMetadataCache = {
    getCache(path: string): CachedMetadata | null;
    getFileCache(file: TFile): CachedMetadata | null;
    resolvedLinks: Record<string, Record<string, number>>;
    unresolvedLinks: Record<string, Record<string, number>>;
    trigger(name: string, ...data: unknown[]): void;
    getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;
};

export class DerivedCommentMetadataManager {
    private readonly derivedCommentLinksByFilePath = new Map<string, DerivedCommentLinks>();
    private readonly derivedCommentLinkSignaturesByFilePath = new Map<string, string>();
    private originalMetadataGetCache: ((path: string) => CachedMetadata | null) | null = null;
    private originalMetadataGetFileCache: ((file: TFile) => CachedMetadata | null) | null = null;

    constructor(private readonly app: Plugin["app"]) {}

    public installMetadataCacheAugmentation(): void {
        if (this.originalMetadataGetCache && this.originalMetadataGetFileCache) {
            return;
        }

        const metadataCache = this.getMutableMetadataCache();
        const originalGetCache = metadataCache.getCache.bind(metadataCache) as MutableMetadataCache["getCache"];
        const originalGetFileCache = metadataCache.getFileCache.bind(metadataCache) as MutableMetadataCache["getFileCache"];
        this.originalMetadataGetCache = (path) => originalGetCache(path);
        this.originalMetadataGetFileCache = (file) => originalGetFileCache(file);

        metadataCache.getCache = ((path: string) =>
            mergeDerivedLinksIntoCache(
                this.originalMetadataGetCache?.(path) ?? null,
                this.derivedCommentLinksByFilePath.get(path),
            )
        ) as MutableMetadataCache["getCache"];

        metadataCache.getFileCache = ((file: TFile) =>
            mergeDerivedLinksIntoCache(
                this.originalMetadataGetFileCache?.(file) ?? null,
                this.derivedCommentLinksByFilePath.get(file.path),
            )
        ) as MutableMetadataCache["getFileCache"];
    }

    public restoreMetadataCacheAugmentation(): void {
        const metadataCache = this.getMutableMetadataCache();
        if (this.originalMetadataGetCache) {
            metadataCache.getCache = this.originalMetadataGetCache as MutableMetadataCache["getCache"];
            this.originalMetadataGetCache = null;
        }

        if (this.originalMetadataGetFileCache) {
            metadataCache.getFileCache = this.originalMetadataGetFileCache as MutableMetadataCache["getFileCache"];
            this.originalMetadataGetFileCache = null;
        }
    }

    public clearAllDerivedCommentLinks(): void {
        const filePaths = Array.from(this.derivedCommentLinksByFilePath.keys());
        for (const filePath of filePaths) {
            this.clearDerivedCommentLinksForFile(filePath, false);
        }
    }

    public clearDerivedCommentLinksForFile(filePath: string, notify = true): void {
        const previous = this.derivedCommentLinksByFilePath.get(filePath);
        if (!previous) {
            return;
        }

        this.mergeDerivedLinkCounts(
            this.getMutableMetadataCache().resolvedLinks,
            filePath,
            previous.resolved,
            {},
        );
        this.mergeDerivedLinkCounts(
            this.getMutableMetadataCache().unresolvedLinks,
            filePath,
            previous.unresolved,
            {},
        );
        this.derivedCommentLinksByFilePath.delete(filePath);
        this.derivedCommentLinkSignaturesByFilePath.delete(filePath);

        if (notify) {
            this.notifyDerivedLinksChanged(filePath);
        }
    }

    public syncDerivedCommentLinksForFile(file: TFile, noteContent: string, comments: Comment[]): void {
        const nextDerivedLinks = buildDerivedCommentLinks(
            comments,
            noteContent,
            (linkPath, sourcePath) => {
                const linkedFile = this.getMutableMetadataCache().getFirstLinkpathDest(linkPath, sourcePath);
                return isTFileLike(linkedFile) ? linkedFile.path : null;
            },
        );
        const nextSignature = getDerivedCommentLinksSignature(nextDerivedLinks);
        const previousSignature = this.derivedCommentLinkSignaturesByFilePath.get(file.path) ?? "";
        if (nextSignature === previousSignature) {
            return;
        }

        const previousDerivedLinks = this.derivedCommentLinksByFilePath.get(file.path) ?? {
            links: [],
            resolved: {},
            unresolved: {},
        };

        this.mergeDerivedLinkCounts(
            this.getMutableMetadataCache().resolvedLinks,
            file.path,
            previousDerivedLinks.resolved,
            nextDerivedLinks.resolved,
        );
        this.mergeDerivedLinkCounts(
            this.getMutableMetadataCache().unresolvedLinks,
            file.path,
            previousDerivedLinks.unresolved,
            nextDerivedLinks.unresolved,
        );

        if (hasDerivedCommentLinks(nextDerivedLinks)) {
            this.derivedCommentLinksByFilePath.set(file.path, nextDerivedLinks);
            this.derivedCommentLinkSignaturesByFilePath.set(file.path, nextSignature);
        } else {
            this.derivedCommentLinksByFilePath.delete(file.path);
            this.derivedCommentLinkSignaturesByFilePath.delete(file.path);
        }

        this.notifyDerivedLinksChanged(file.path);
    }

    private getMutableMetadataCache(): MutableMetadataCache {
        return this.app.metadataCache as unknown as MutableMetadataCache;
    }

    private mergeDerivedLinkCounts(
        countsByFile: Record<string, Record<string, number>>,
        filePath: string,
        previousCounts: Record<string, number>,
        nextCounts: Record<string, number>,
    ): void {
        const mergedCounts = mergeDerivedLinkTargetCounts(
            countsByFile[filePath] ?? {},
            previousCounts,
            nextCounts,
        );

        if (Object.keys(mergedCounts).length === 0) {
            delete countsByFile[filePath];
            return;
        }

        countsByFile[filePath] = mergedCounts;
    }

    private notifyDerivedLinksChanged(filePath: string): void {
        const file = this.getMarkdownFileByPath(filePath);
        if (file) {
            this.app.metadataCache.trigger("resolve", file);
        }
        this.app.metadataCache.trigger("resolved");
    }

    private getMarkdownFileByPath(filePath: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        return isTFileLike(file) && file.extension === "md" ? file : null;
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object";
}

function isTFileLike(value: unknown): value is TFile {
    return isObject(value)
        && typeof value.path === "string"
        && typeof value.basename === "string"
        && typeof value.extension === "string";
}
