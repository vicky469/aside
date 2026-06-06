export interface TransientNoticeContext {
    message: string;
    area: string;
    event: string;
}

const NAVIGATION_FALLBACK_MESSAGES = new Set([
    "Unable to find that file.",
    "Failed to open that file.",
    "Failed to jump to Markdown view.",
    "Unable to find that side comment.",
]);

export function shouldShowTransientNotice(context: TransientNoticeContext): boolean {
    if (context.event === "index.file.open.error" || context.event === "index.open.error") {
        return true;
    }

    if (context.area === "navigation" && context.event === "navigation.notice") {
        return NAVIGATION_FALLBACK_MESSAGES.has(context.message);
    }

    return false;
}
