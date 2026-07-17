import type { Comment } from "../commentManager";
import { buildCommentLocationUrl } from "../core/derived/allCommentsNote";

export type ClipboardTextWriter = (text: string) => Promise<boolean>;

export function copyCommentLocationToClipboard(
    vaultName: string,
    comment: Pick<Comment, "filePath" | "id">,
    writeText: ClipboardTextWriter,
): Promise<boolean> {
    return writeText(buildCommentLocationUrl(vaultName, comment));
}
