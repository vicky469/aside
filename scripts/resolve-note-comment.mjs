#!/usr/bin/env node

import {
    runResolveNoteComment,
    runScriptMain,
} from "./lib/asideRepoScripts.mjs";

await runScriptMain(runResolveNoteComment);
