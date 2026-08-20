export const SIDE_NOTE_ATTACHMENT_FOLDER: string;

export function buildSideNotePrompt(options: {
    promptText: string;
    rootLabel?: string | null;
    rootPath?: string | null;
    requestKind?: "create-script";
}): string;
