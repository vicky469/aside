#!/usr/bin/env node

import {
    runCreateNoteCommentThread,
    runScriptMain,
} from "./lib/asideRepoScripts.mjs";

await runScriptMain(runCreateNoteCommentThread);
