import type { CommentThreadRetargetOptions } from "./commentThreadRetarget";

export interface CommentFileRetarget {
    previousFilePath: string;
    nextFilePath: string;
    retargetOptions: CommentThreadRetargetOptions;
}

export interface CommentFileRetargetFailure {
    retarget: CommentFileRetarget;
    error: unknown;
}

export interface CommentFileRetargetResult {
    successfulRetargets: CommentFileRetarget[];
    failures: CommentFileRetargetFailure[];
}
