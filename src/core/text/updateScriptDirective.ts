export const UPDATE_SCRIPT_DIRECTIVE = "/update-script";
export const UPDATE_SCRIPT_USAGE = "Use /update-script /script-name followed by the change you want.";
export const UPDATE_SCRIPT_NO_AGENT = "No agent is available to update the script.";

export type UpdateScriptDirectiveResolution =
    | { kind: "none" }
    | { kind: "empty" }
    | { kind: "request"; targetMention: string; requestText: string }
    | { kind: "rejected"; message: string };

const UPDATE_SCRIPT_PATTERN = /(^|[^\w/])\/update-script(?=$|\s)/iu;
const LEADING_UPDATE_SCRIPT_PATTERN = /^\s*\/update-script(?=$|\s)/iu;
const TARGET_AND_REQUEST_PATTERN = /^(\/[A-Za-z0-9_.-]+)(?:\s+([\s\S]+))?$/u;

export function parseUpdateScriptDirective(value: string): UpdateScriptDirectiveResolution {
    const leadingMatch = LEADING_UPDATE_SCRIPT_PATTERN.exec(value);
    if (!leadingMatch && !UPDATE_SCRIPT_PATTERN.test(value)) {
        return { kind: "none" };
    }
    if (!leadingMatch) {
        return { kind: "rejected", message: UPDATE_SCRIPT_USAGE };
    }

    const remainder = value.slice(leadingMatch[0].length).trim();
    const targetAndRequest = TARGET_AND_REQUEST_PATTERN.exec(remainder);
    if (!targetAndRequest) {
        return remainder
            ? { kind: "rejected", message: UPDATE_SCRIPT_USAGE }
            : { kind: "empty" };
    }

    const requestText = (targetAndRequest[2] ?? "").trim();
    return requestText
        ? {
            kind: "request",
            targetMention: targetAndRequest[1] ?? "",
            requestText,
        }
        : { kind: "empty" };
}
