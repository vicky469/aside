const {
    VAULT_SCRIPT_FOLDER_PATH,
    VAULT_SCRIPT_TEST_FOLDER_PATH,
} = require("./vaultScriptPolicy.js");

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
    const targetScriptPath = normalizeRootPath(options?.targetScriptPath);
    const promptText = typeof options?.promptText === "string"
        ? options.promptText
        : "";

    const promptLines = [
        "You are responding to an Aside thread in Obsidian.",
        "Use the built-in Aside workflow for this request.",
        "Aside terminology: side note and side comment both mean an Aside thread or entry stored for the current note.",
        "A page note is scoped to the current markdown page, not the whole vault or unrelated files.",
        "An explicit in-note agent directive means the user is asking the selected local agent to answer in this Aside thread; in-note agent requests default to write mode.",
        "When the user asks to create, append, or update Aside side notes, make that change before replying.",
        "When the user asks to add annotations, comment on this article/note/text, add side comments to specific passages, or says 加批注, create selection-anchored Aside notes on the relevant source text spans.",
        "For annotation requests, return a fenced `aside-annotations` JSON block with an array of objects like {\"selectedText\":\"exact source text from the note\",\"comment\":\"anchored comment text\"}. Use only exact source text from the provided note context. Aside will create the anchored notes from that block.",
        "Do not satisfy annotation requests with only a summary, critique, or reply in the current page thread; create the anchored notes first, then return a concise status reply.",
        "If you cannot create those selection-anchored notes from this runtime, say that you could not create the anchored notes instead of providing the critique as a substitute.",
        "For non-annotation requests like \"one point a note/comment\", keep one parent thread and append each point as a child entry unless the user explicitly asks for separate page-note threads.",
        "Answer the user's request directly.",
        "Only inspect or modify the current markdown page unless the request explicitly asks for broader workspace context.",
        "If the request asks for file changes, make them directly in the workspace before replying.",
        `If the user asks for a reusable vault script, place it directly under the active vault's \`${VAULT_SCRIPT_FOLDER_PATH}/\`, not in the plugin repository's internal \`scripts/\`.`,
        `If you create tests for a vault script, place every test under the active vault's \`${VAULT_SCRIPT_TEST_FOLDER_PATH}/\`, create that folder if needed, and do not place \`.test.*\` or \`.spec.*\` files directly under \`${VAULT_SCRIPT_FOLDER_PATH}/\` beside runnable scripts.`,
        "Do not claim that side notes were added or updated unless you actually made the change.",
        "If you cannot make the requested Aside change from this runtime, say that plainly in the reply instead of saying Done.",
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
        "Do not narrate routine process, context-loading, prompts, or AGENTS instructions.",
        "If a tool, search, file operation, or capability fails and affects the answer, say so briefly.",
        "Do not include thinking steps or tool logs.",
        "Do not mention reading notes, locating threads, loading context, or using the workspace.",
    ];

    if (options?.requestKind === "create-script") {
        promptLines.push(
            "This is a /create-script request. Create the requested reusable vault script now.",
            `Create a collision-free direct child of the active vault's \`${VAULT_SCRIPT_FOLDER_PATH}/\` using .mjs, .js, or .cjs.`,
            "Do not use the reserved create-script name, raw TypeScript, JSX-family files, nested script folders, or a case-insensitive mention collision.",
            "The script receives the current Markdown note's absolute path as its first positional argument and runs with the vault root as its working directory.",
            "Write concise user-facing results to standard output and failures to standard error.",
            "In the Aside reply, report the created vault-relative path and its /script-name invocation.",
            "If a previous attempt already created matching work, inspect and finish that file instead of creating a duplicate.",
        );
    }

    if (options?.requestKind === "update-script" && targetScriptPath) {
        promptLines.push(
            `This is an /update-script request. Modify \`${targetScriptPath}\` in place now.`,
            "Inspect the existing script before editing it.",
            "Do not rename it, create a replacement, or edit unrelated vault files.",
            "Preserve the script's current-note positional argument and vault-root working-directory contract.",
            "In the Aside reply, report the updated vault-relative path and its /script-name invocation.",
            "If the target disappears or cannot be edited, state that plainly instead of creating a substitute.",
        );
    }

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
