export function decodeSidebarLinkTarget(href: string): string {
    try {
        return decodeURIComponent(href);
    } catch {
        return href;
    }
}

export function getLocalHtmlFileLinkPath(href: string): string | null {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
        return null;
    }

    const pathPart = trimmed.split("#", 1)[0].split("?", 1)[0];
    const decodedPath = decodeSidebarLinkTarget(pathPart).trim();
    return /\.html?$/i.test(decodedPath) ? decodedPath : null;
}

export function isLocalHtmlFileLinkTarget(href: string): boolean {
    return getLocalHtmlFileLinkPath(href) !== null;
}
