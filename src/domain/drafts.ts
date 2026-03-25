import type { TFile } from "obsidian";
import type { Comment } from "../commentManager";

export interface DraftComment extends Comment {
    mode: "new" | "edit";
}

export interface DraftSelection {
    file: TFile;
    selectedText: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
}
