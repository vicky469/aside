import type { AgentRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import { getSupportedAgentActors } from "../../core/agents/agentActorRegistry";
import type { AsideAgentTarget } from "../../core/config/agentTargets";

export type DefaultAgentSetupGuideKind =
    | "hidden"
    | "checking"
    | "desktop-required"
    | "setup-needed";

export interface DefaultAgentSetupGuideState {
    kind: DefaultAgentSetupGuideKind;
    markdown: string;
}

const DESKTOP_REQUIRED_MARKDOWN = [
    "**Local agents need desktop Obsidian.**",
    "",
    "Install Aside on the same Mac or PC where your agent CLI is signed in.",
].join("\n");

const SETUP_NEEDED_MARKDOWN = [
    "**No local agent is available yet.**",
    "",
    "1. Open **Terminal** on this machine.",
    "2. Install and sign in to at least one CLI:",
    "   - **Codex** — `codex login`",
    "   - **Claude Code** — `claude login`",
    "   - **Gemini** — run `gemini` and finish its sign-in flow",
    "   - **DeepSeek** — install the [OpenCode CLI](https://opencode.ai/docs/cli/), then sign in there",
    "3. Return here and click **Recheck**.",
    "",
    "Aside finds the CLI on your login-shell PATH and handles `/create-script`, `/update-script`, and `/pdf-to-markdown` for you.",
    "",
    "[Get started guide](https://github.com/vicky469/aside#how-to-get-started)",
].join("\n");

export function resolveDefaultAgentSetupGuideState(
    diagnosticsByTarget: ReadonlyMap<AsideAgentTarget, AgentRuntimeDiagnostics>,
): DefaultAgentSetupGuideState {
    const actors = getSupportedAgentActors();
    if (actors.length === 0) {
        return { kind: "hidden", markdown: "" };
    }

    const diagnostics = actors.map((actor) => diagnosticsByTarget.get(actor.id));
    if (diagnostics.some((item) => !item || item.status === "checking")) {
        return { kind: "checking", markdown: "" };
    }

    if (diagnostics.some((item) => item?.status === "available")) {
        return { kind: "hidden", markdown: "" };
    }

    if (diagnostics.every((item) => item?.status === "unsupported")) {
        return {
            kind: "desktop-required",
            markdown: DESKTOP_REQUIRED_MARKDOWN,
        };
    }

    return {
        kind: "setup-needed",
        markdown: SETUP_NEEDED_MARKDOWN,
    };
}
