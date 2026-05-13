#!/usr/bin/env node

import {
    runScriptMain,
    runUpdateNoteComment,
} from "./lib/asideRepoScripts.mjs";

await runScriptMain(runUpdateNoteComment);
