export function parsePromptDeleteSetting(configContent: string): boolean | null {
    try {
        const parsed = JSON.parse(configContent) as { promptDelete?: unknown };
        return typeof parsed.promptDelete === "boolean" ? parsed.promptDelete : null;
    } catch {
        return null;
    }
}
