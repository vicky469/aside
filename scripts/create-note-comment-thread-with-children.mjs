#!/usr/bin/env node

import {
    runCreateNoteCommentThreadWithChildren,
    runScriptMain,
} from "./lib/asideRepoScripts.mjs";

await runScriptMain(runCreateNoteCommentThreadWithChildren);
