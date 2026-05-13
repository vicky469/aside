import type { CachedMetadata } from "obsidian";
import type { DerivedCommentLinks } from "../text/commentMentions";

const derivedMetadataCacheMarker = Symbol("asideDerivedMetadata");

type DerivedMetadataCache = CachedMetadata & {
    [derivedMetadataCacheMarker]?: true;
};

export function mergeDerivedLinksIntoCache(
    baseCache: CachedMetadata | null,
    derivedLinks: DerivedCommentLinks | undefined,
): CachedMetadata | null {
    const derivedCache = baseCache as DerivedMetadataCache | null;
    if (!derivedLinks || derivedLinks.links.length === 0 || derivedCache?.[derivedMetadataCacheMarker]) {
        return baseCache;
    }

    const mergedCache: DerivedMetadataCache = {
        ...(baseCache ?? {}),
        links: [...(baseCache?.links ?? []), ...derivedLinks.links],
    };
    Object.defineProperty(mergedCache, derivedMetadataCacheMarker, {
        configurable: false,
        enumerable: false,
        value: true,
    });
    return mergedCache;
}

export function hasDerivedCommentLinks(derivedLinks: DerivedCommentLinks): boolean {
    return (
        derivedLinks.links.length > 0
        || Object.keys(derivedLinks.resolved).length > 0
        || Object.keys(derivedLinks.unresolved).length > 0
    );
}

export function getDerivedCommentLinksSignature(derivedLinks: DerivedCommentLinks): string {
    const sortedResolved = Object.entries(derivedLinks.resolved).sort(([left], [right]) => left.localeCompare(right));
    const sortedUnresolved = Object.entries(derivedLinks.unresolved).sort(([left], [right]) => left.localeCompare(right));
    const linkEntries = derivedLinks.links.map((link) => ({
        link: link.link,
        original: link.original,
        displayText: link.displayText ?? "",
        line: link.position.start.line,
        col: link.position.start.col,
    }));

    return JSON.stringify({
        links: linkEntries,
        resolved: sortedResolved,
        unresolved: sortedUnresolved,
    });
}

export function mergeDerivedLinkTargetCounts(
    currentCounts: Record<string, number>,
    previousCounts: Record<string, number>,
    nextCounts: Record<string, number>,
): Record<string, number> {
    const mergedCounts = { ...currentCounts };

    for (const [targetPath, count] of Object.entries(previousCounts)) {
        if (!(targetPath in mergedCounts)) {
            continue;
        }

        const nextCount = (mergedCounts[targetPath] ?? 0) - count;
        if (nextCount > 0) {
            mergedCounts[targetPath] = nextCount;
        } else {
            delete mergedCounts[targetPath];
        }
    }

    for (const [targetPath, count] of Object.entries(nextCounts)) {
        mergedCounts[targetPath] = (mergedCounts[targetPath] ?? 0) + count;
    }

    return mergedCounts;
}
