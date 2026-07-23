import type { AgentRunSkillMetadata } from "./agentRuns";

export const REQUESTED_AGENT_RUN_SKILL_SOURCE = "requested";

function includesExcalidrawFile(filePath: string): boolean {
    return /\.excalidraw(?:\.md)?$/iu.test(filePath);
}

function includesCanvasFile(filePath: string): boolean {
    return /\.canvas$/iu.test(filePath);
}

function mentionsExcalidrawSkill(promptText: string): boolean {
    return /\b(?:excalidraw|excalidrawautomate|sketch-your-mind)\b/iu.test(promptText);
}

function mentionsCanvasDesignSkill(promptText: string): boolean {
    return /(?:\.canvas\b|\bobsidian\s+canvas\b|\bcanvas\s+(?:board|map|file|view)\b)/iu.test(promptText);
}

function requestedSkill(name: string): AgentRunSkillMetadata {
    return {
        name,
        source: REQUESTED_AGENT_RUN_SKILL_SOURCE,
    };
}

export function resolveRequestedAgentRunSkills(options: {
    filePath: string;
    promptText: string;
}): AgentRunSkillMetadata[] {
    const skills: AgentRunSkillMetadata[] = [];

    if (includesExcalidrawFile(options.filePath) || mentionsExcalidrawSkill(options.promptText)) {
        skills.push(requestedSkill("obsidian-excalidraw"));
    }

    if (includesCanvasFile(options.filePath) || mentionsCanvasDesignSkill(options.promptText)) {
        skills.push(requestedSkill("canvas-design"));
    }

    return skills;
}
