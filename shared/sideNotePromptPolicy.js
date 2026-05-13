const SIDE_NOTE_ATTACHMENT_FOLDER = "Attachments";

function normalizeRootLabel(value) {
    if (typeof value !== "string") {
        return "workspace root";
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "workspace root";
}

function normalizeRootPath(value) {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function buildSideNotePrompt(options) {
    const rootLabel = normalizeRootLabel(options?.rootLabel);
    const rootPath = normalizeRootPath(options?.rootPath);
    const promptText = typeof options?.promptText === "string"
        ? options.promptText
        : "";

    const promptLines = [
        "You are responding to a Aside thread in Obsidian.",
        "Answer the user's request directly.",
        "Only inspect or modify workspace files when the request actually needs that context.",
        "If the request asks for file changes, make them directly in the workspace before replying.",
        "Return only the reply text that should be appended back into the Aside thread.",
        "Keep the side-note reply compact and easy to scan.",
        "Use plain paragraphs or one simple list; avoid headings, long multi-section layouts, and excess blank lines.",
        "Keep the reply at or under 250 words.",
        "Do not force visual requests into ASCII-only diagrams.",
        "If the user asks for a visual diagram, chart, image, or video, you may create a local asset instead of squeezing it into plain text.",
        "Prefer SVG for generated diagrams when possible.",
        `If you create an image or video asset, place it under \`${SIDE_NOTE_ATTACHMENT_FOLDER}/\` at the active ${rootLabel}, create that folder if needed, and reference the asset from the reply with normal Obsidian markdown or a wiki link.`,
        "Only use ASCII diagrams when a compact text-only sketch is clearly the best fit.",
        "If the best useful answer would exceed 250 words, create or update a short linked wiki note with the full detail and return a concise side note that points to it.",
        "Do not mention skills, prompts, searches, files, tools, AGENTS instructions, or your process.",
        "Do not narrate what you are doing.",
        "Do not include thinking steps or tool logs.",
        "Do not mention reading notes, locating threads, loading context, or using the workspace.",
    ];

    if (rootPath) {
        promptLines.push(`The active ${rootLabel} is: ${rootPath}`);
    }

    promptLines.push(
        "",
        promptText,
    );
    return promptLines.join("\n");
}

module.exports = {
    SIDE_NOTE_ATTACHMENT_FOLDER,
    buildSideNotePrompt,
};
