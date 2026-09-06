export const CREATE_SCRIPT_DIRECTIVE = "/create-script";
export const CREATE_SCRIPT_USAGE = "Use /create-script followed by the script you want to create.";
export const CREATE_SCRIPT_NO_AGENT = "No agent is available to create the script.";
export const CREATE_SCRIPT_MIXED_SCRIPT = "Use /create-script or a vault script, not both.";
export const CREATE_SCRIPT_MIXED_AGENT = "Use /create-script without an agent mention; choose the default under Settings → Aside → Scripts (advanced).";

export type CreateScriptDirectiveResolution =
    | { kind: "none" }
    | { kind: "empty" }
    | { kind: "request"; requestText: string }
    | { kind: "rejected"; message: string };

const CREATE_SCRIPT_PATTERN = /(^|[^\w/])(\/create-script)(?=$|\s)/giu;

export function parseCreateScriptDirective(value: string): CreateScriptDirectiveResolution {
    const matches = Array.from(value.matchAll(CREATE_SCRIPT_PATTERN));
    if (matches.length === 0) {
        return { kind: "none" };
    }
    if (matches.length > 1) {
        return {
            kind: "rejected",
            message: "Use /create-script only once per side note.",
        };
    }

    const match = matches[0];
    const commandStart = (match?.index ?? 0) + (match?.[1]?.length ?? 0);
    const commandEnd = commandStart + CREATE_SCRIPT_DIRECTIVE.length;
    const requestText = `${value.slice(0, commandStart)} ${value.slice(commandEnd)}`
        .replace(/\s+/gu, " ")
        .trim();
    return requestText
        ? { kind: "request", requestText }
        : { kind: "empty" };
}
