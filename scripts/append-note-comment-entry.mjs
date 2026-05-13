#!/usr/bin/env node

import {
    runAppendNoteCommentEntry,
    runScriptMain,
} from "./lib/asideRepoScripts.mjs";

await runScriptMain(runAppendNoteCommentEntry);
