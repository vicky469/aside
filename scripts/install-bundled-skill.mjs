#!/usr/bin/env node

import {
    runInstallBundledSkill,
    runScriptMain,
} from "./lib/asideRepoScripts.mjs";

await runScriptMain(runInstallBundledSkill);
