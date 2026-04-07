#!/usr/bin/env node

import * as esbuild from "esbuild";
import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function getRepoRoot(metaUrl) {
    return path.resolve(path.dirname(fileURLToPath(metaUrl)), "..");
}

function printMainUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  sidenote2 <command> [options]",
            "",
            "Commands:",
            "  comment:migrate-legacy  Rewrite one note from legacy flat comments to threaded storage",
            "  comment:update  Update one stored SideNote2 comment body in a note",
            "  install-skill   Copy bundled SideNote2 Codex skill(s) into the Codex skills directory",
            "",
            "Run `sidenote2 <command> --help` for command-specific usage.",
        ].join("\n") + "\n",
    );
}

function printCommentUpdateUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  sidenote2 comment:update --file <note.md> --id <comment-id> (--comment <text> | --comment-file <path> | --stdin) [--settle-ms <milliseconds>]",
            "",
            "Examples:",
            "  sidenote2 comment:update --file ./note.md --id comment-1 --comment-file ./comment.md",
            "  sidenote2 comment:update --file ./note.md --id comment-1 --comment-file ./comment.md --settle-ms 2000",
            "  printf 'Updated body\\n' | sidenote2 comment:update --file ./note.md --id comment-1 --stdin",
        ].join("\n") + "\n",
    );
}

function printCommentMigrateLegacyUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  sidenote2 comment:migrate-legacy (--file <note.md> | --root <vault-dir>) [--dry-run] [--settle-ms <milliseconds>]",
            "",
            "Examples:",
            "  sidenote2 comment:migrate-legacy --file ./note.md --dry-run",
            "  sidenote2 comment:migrate-legacy --file ./note.md",
            "  sidenote2 comment:migrate-legacy --file ./note.md --settle-ms 2000",
            "  sidenote2 comment:migrate-legacy --root /path/to/vault --dry-run",
        ].join("\n") + "\n",
    );
}

function parseNonNegativeIntegerOption(rawValue, flagName) {
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`Expected ${flagName} to be a non-negative integer.`);
    }

    return parsed;
}

function printSkillUsage(command, stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            `  sidenote2 ${command} [--name <skill-name>]... [--dest <skills-root>]`,
            "",
            "Defaults:",
            "  installs all bundled skills when --name is omitted",
            "  --dest defaults to $CODEX_HOME/skills or ~/.codex/skills",
        ].join("\n") + "\n",
    );
}

function parseCommentUpdateArgs(argv) {
    const options = {
        file: "",
        id: "",
        comment: null,
        commentFile: "",
        stdin: false,
        settleMs: 0,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case "--file":
                options.file = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--id":
                options.id = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--comment":
                options.comment = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--comment-file":
                options.commentFile = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--stdin":
                options.stdin = true;
                break;
            case "--settle-ms":
                options.settleMs = parseNonNegativeIntegerOption(argv[index + 1] ?? "", "--settle-ms");
                index += 1;
                break;
            case "--help":
            case "-h":
                return null;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    const contentSources = [options.comment !== null, Boolean(options.commentFile), options.stdin].filter(Boolean).length;
    if (!options.file || !options.id || contentSources !== 1) {
        throw new Error("Expected --file, --id, and exactly one comment source.");
    }

    return options;
}

function parseCommentMigrateLegacyArgs(argv) {
    const options = {
        file: "",
        root: "",
        dryRun: false,
        settleMs: 0,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case "--file":
                options.file = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--dry-run":
                options.dryRun = true;
                break;
            case "--root":
                options.root = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--settle-ms":
                options.settleMs = parseNonNegativeIntegerOption(argv[index + 1] ?? "", "--settle-ms");
                index += 1;
                break;
            case "--help":
            case "-h":
                return null;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    const targetCount = [Boolean(options.file), Boolean(options.root)].filter(Boolean).length;
    if (targetCount !== 1) {
        throw new Error("Expected exactly one of --file or --root.");
    }

    return options;
}

function parseSkillArgs(argv) {
    const options = {
        destRoot: getDefaultSkillsRoot(),
        skillNames: [],
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case "--name": {
                const skillName = argv[index + 1] ?? "";
                if (!skillName) {
                    throw new Error("Expected a skill name after --name.");
                }
                options.skillNames.push(skillName);
                index += 1;
                break;
            }
            case "--dest":
                options.destRoot = path.resolve(process.cwd(), argv[index + 1] ?? "");
                index += 1;
                break;
            case "--help":
            case "-h":
                return null;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function getDefaultSkillsRoot() {
    const codexHome = process.env.CODEX_HOME?.trim();
    return codexHome
        ? path.join(codexHome, "skills")
        : path.join(homedir(), ".codex", "skills");
}

async function pathExists(targetPath) {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function copyDirectoryRecursive(sourceDir, destinationDir) {
    await mkdir(destinationDir, { recursive: true });
    const entries = await readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        const destinationPath = path.join(destinationDir, entry.name);
        if (entry.isDirectory()) {
            await copyDirectoryRecursive(sourcePath, destinationPath);
            continue;
        }

        if (entry.isFile()) {
            await copyFile(sourcePath, destinationPath);
            continue;
        }

        throw new Error(`Unsupported skill entry type: ${sourcePath}`);
    }
}

async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }

    return Buffer.concat(chunks).toString("utf8");
}

function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function createContentFingerprint(content) {
    return `${Buffer.byteLength(content, "utf8")}:${createHash("sha256").update(content).digest("hex")}`;
}

async function writeFileAtomically(targetPath, content) {
    const tempPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.sidenote2-${process.pid}-${randomUUID()}.tmp`,
    );
    await writeFile(tempPath, content, "utf8");
    try {
        await rename(tempPath, targetPath);
    } catch (error) {
        await rm(tempPath, { force: true });
        throw error;
    }
}

async function writeObservedNoteSafely(notePath, expectedFingerprint, nextContent, options = {}) {
    const settleMs = options.settleMs ?? 0;
    if (settleMs > 0) {
        await sleep(settleMs);
    }

    let currentContent;
    try {
        currentContent = await readFile(notePath, "utf8");
    } catch (error) {
        return {
            kind: "changed",
            reason: error instanceof Error ? error.message : String(error),
        };
    }

    if (createContentFingerprint(currentContent) !== expectedFingerprint) {
        return {
            kind: "changed",
            reason: "content changed after the script read it",
        };
    }

    await writeFileAtomically(notePath, nextContent);
    return { kind: "written" };
}

async function loadCommentBody(options) {
    if (options.comment !== null) {
        return options.comment;
    }

    if (options.commentFile) {
        return readFile(path.resolve(process.cwd(), options.commentFile), "utf8");
    }

    return readStdin();
}

async function getBundledSkills() {
    const repoRoot = getRepoRoot(import.meta.url);
    const skillsRoot = path.join(repoRoot, "skills");
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const skillNames = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

    if (skillNames.length === 0) {
        throw new Error(`No bundled skills found in ${skillsRoot}`);
    }

    const skillDirectories = new Map();
    for (const skillName of skillNames) {
        const sourceDir = path.join(skillsRoot, skillName);
        const skillFile = path.join(sourceDir, "SKILL.md");
        if (!(await pathExists(skillFile))) {
            continue;
        }
        skillDirectories.set(skillName, sourceDir);
    }

    if (skillDirectories.size === 0) {
        throw new Error(`No bundled skills with SKILL.md found in ${skillsRoot}`);
    }

    return { repoRoot, skillDirectories };
}

async function loadStorageModule(repoRoot) {
    const entryPoint = path.resolve(repoRoot, "src/core/storage/noteCommentStorage.ts");
    const result = await esbuild.build({
        entryPoints: [entryPoint],
        bundle: true,
        format: "esm",
        platform: "node",
        target: ["node18"],
        write: false,
        logLevel: "silent",
    });

    const output = result.outputFiles?.[0]?.text;
    if (!output) {
        throw new Error("Failed to bundle noteCommentStorage.ts");
    }

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
    return import(moduleUrl);
}

const HIDDEN_SECTION_OPEN = "<!-- SideNote2 comments";
const HIDDEN_SECTION_CLOSE = "-->";

function normalizeCommentBody(body) {
    return body.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

function parseManagedSectionJson(sectionContent) {
    if (!sectionContent.startsWith(HIDDEN_SECTION_OPEN)) {
        return null;
    }

    const closeMarker = `\n${HIDDEN_SECTION_CLOSE}`;
    if (!sectionContent.endsWith(closeMarker)) {
        return null;
    }

    const bodyWithPrefix = sectionContent.slice(HIDDEN_SECTION_OPEN.length, -closeMarker.length);
    const jsonText = bodyWithPrefix.replace(/^[ \t]*\n?/, "").trim();
    if (!jsonText.length) {
        return null;
    }

    try {
        const parsed = JSON.parse(jsonText);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function findJsonManagedSection(noteContent) {
    const normalized = noteContent.replace(/\r\n/g, "\n");
    const matches = Array.from(normalized.matchAll(/<!-- SideNote2 comments(?=$|[\s\[{])/g));
    for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        if (typeof match.index !== "number") {
            continue;
        }

        const sectionStart = match.index;
        const closeIndex = normalized.indexOf(`\n${HIDDEN_SECTION_CLOSE}`, sectionStart);
        if (closeIndex === -1) {
            continue;
        }

        const blockEnd = closeIndex + `\n${HIDDEN_SECTION_CLOSE}`.length;
        const sectionContent = normalized.slice(sectionStart, blockEnd).trim();
        const items = parseManagedSectionJson(sectionContent);
        if (items === null) {
            continue;
        }

        const mainPrefix = normalized.slice(0, sectionStart).trimEnd();
        const trailingContent = normalized.slice(blockEnd);
        const hasVisibleContentAfterSection = trailingContent.trim().length > 0;
        const mainContent = `${mainPrefix}${hasVisibleContentAfterSection ? trailingContent : ""}`.trimEnd();

        return {
            mainContent,
            items,
        };
    }

    return null;
}

function toLegacyThread(candidate, filePath) {
    if (!candidate || typeof candidate !== "object") {
        return null;
    }

    const item = candidate;
    if (
        typeof item.id !== "string"
        || typeof item.startLine !== "number"
        || typeof item.startChar !== "number"
        || typeof item.endLine !== "number"
        || typeof item.endChar !== "number"
        || typeof item.selectedText !== "string"
        || typeof item.selectedTextHash !== "string"
        || typeof item.comment !== "string"
        || typeof item.timestamp !== "number"
    ) {
        return null;
    }

    if (
        ("entries" in item && item.entries !== undefined)
        || ("createdAt" in item && item.createdAt !== undefined)
        || ("updatedAt" in item && item.updatedAt !== undefined)
    ) {
        return null;
    }

    if (
        (item.anchorKind !== undefined && item.anchorKind !== "selection" && item.anchorKind !== "page")
        || (item.orphaned !== undefined && typeof item.orphaned !== "boolean")
        || (item.resolved !== undefined && typeof item.resolved !== "boolean")
    ) {
        return null;
    }

    return {
        id: item.id,
        filePath,
        startLine: item.startLine,
        startChar: item.startChar,
        endLine: item.endLine,
        endChar: item.endChar,
        selectedText: item.selectedText,
        selectedTextHash: item.selectedTextHash,
        anchorKind: item.anchorKind === "page" ? "page" : "selection",
        orphaned: item.anchorKind === "page" ? false : item.orphaned === true,
        resolved: item.resolved === true,
        entries: [{
            id: item.id,
            body: normalizeCommentBody(item.comment),
            timestamp: item.timestamp,
        }],
        createdAt: item.timestamp,
        updatedAt: item.timestamp,
    };
}

function isThreadEntryCandidate(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return false;
    }

    const item = candidate;
    return (
        typeof item.id === "string"
        && typeof item.body === "string"
        && typeof item.timestamp === "number"
    );
}

function isThreadedStoredThread(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return false;
    }

    const item = candidate;
    if (
        typeof item.id !== "string"
        || typeof item.startLine !== "number"
        || typeof item.startChar !== "number"
        || typeof item.endLine !== "number"
        || typeof item.endChar !== "number"
        || typeof item.selectedText !== "string"
        || typeof item.selectedTextHash !== "string"
        || !Array.isArray(item.entries)
        || item.entries.length === 0
        || typeof item.createdAt !== "number"
        || typeof item.updatedAt !== "number"
    ) {
        return false;
    }

    if (
        (item.anchorKind !== undefined && item.anchorKind !== "selection" && item.anchorKind !== "page")
        || (item.orphaned !== undefined && typeof item.orphaned !== "boolean")
        || (item.resolved !== undefined && typeof item.resolved !== "boolean")
    ) {
        return false;
    }

    return item.entries.every((entry) => isThreadEntryCandidate(entry));
}

function classifyManagedSectionItems(items) {
    if (items.length === 0) {
        return "threaded";
    }

    const allLegacy = items.every((item) => toLegacyThread(item, "__probe__") !== null);
    if (allLegacy) {
        return "legacy";
    }

    const allThreaded = items.every((item) => isThreadedStoredThread(item));
    if (allThreaded) {
        return "threaded";
    }

    return "unsupported";
}

function countManagedSections(noteContent) {
    return (noteContent.match(/<!-- SideNote2 comments/g) || []).length;
}

function shouldSkipVaultScanDirectory(entryName) {
    return entryName === ".obsidian"
        || entryName === ".git"
        || entryName === "node_modules"
        || entryName === ".test-dist";
}

async function collectMarkdownFiles(rootDir) {
    const markdownFiles = [];

    async function walk(currentDir) {
        const entries = await readdir(currentDir, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                if (shouldSkipVaultScanDirectory(entry.name)) {
                    continue;
                }

                await walk(fullPath);
                continue;
            }

            if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
                markdownFiles.push(fullPath);
            }
        }
    }

    await walk(rootDir);
    return markdownFiles;
}

function formatPathRelativeToRoot(rootDir, filePath) {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, "/");
    return relativePath || path.basename(filePath);
}

function verifyMigratedNote(storageModule, noteContent, notePath, expectedThreadCount, expectedMainContent) {
    if (countManagedSections(noteContent) !== 1) {
        throw new Error("Migration would produce multiple managed comment blocks.");
    }

    if (storageModule.getManagedSectionRange(noteContent) === null) {
        throw new Error("Migration output does not contain a valid threaded managed block.");
    }

    const parsed = storageModule.parseNoteComments(noteContent, notePath);
    if (parsed.threads.length !== expectedThreadCount) {
        throw new Error(`Migration output parsed ${parsed.threads.length} threads, expected ${expectedThreadCount}.`);
    }

    if (parsed.mainContent !== expectedMainContent) {
        throw new Error("Migration output changed the visible note body unexpectedly.");
    }
}

function buildLegacyMigrationPlan(notePath, noteContent, storageModule) {
    const section = findJsonManagedSection(noteContent);
    if (!section) {
        return {
            kind: "no-managed-block",
            notePath,
        };
    }

    const sectionKind = classifyManagedSectionItems(section.items);
    if (sectionKind === "threaded") {
        return {
            kind: "threaded",
            notePath,
        };
    }

    if (sectionKind === "unsupported") {
        return {
            kind: "unsupported",
            notePath,
        };
    }

    const threads = section.items.map((item) => toLegacyThread(item, notePath));
    if (threads.some((thread) => thread === null)) {
        return {
            kind: "unsupported",
            notePath,
        };
    }

    const nextContent = storageModule.serializeNoteCommentThreads(section.mainContent, threads);
    verifyMigratedNote(storageModule, nextContent, notePath, threads.length, section.mainContent);

    return {
        kind: "legacy",
        notePath,
        nextContent,
        sourceFingerprint: createContentFingerprint(noteContent),
        threadCount: threads.length,
    };
}

async function runCommentUpdate(argv, streamOut, streamErr) {
    let options;
    try {
        options = parseCommentUpdateArgs(argv);
    } catch (error) {
        streamErr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printCommentUpdateUsage(streamErr);
        return 1;
    }

    if (options === null) {
        printCommentUpdateUsage(streamOut);
        return 0;
    }

    const repoRoot = getRepoRoot(import.meta.url);
    const notePath = path.resolve(process.cwd(), options.file);
    const nextCommentBody = await loadCommentBody(options);
    const noteContent = await readFile(notePath, "utf8");
    const storageModule = await loadStorageModule(repoRoot);
    const updated = storageModule.replaceNoteCommentBodyById(noteContent, notePath, options.id, nextCommentBody);

    if (typeof updated !== "string") {
        streamErr.write(`Comment id not found: ${options.id}\n`);
        return 1;
    }

    const writeResult = await writeObservedNoteSafely(notePath, createContentFingerprint(noteContent), updated, {
        settleMs: options.settleMs,
    });
    if (writeResult.kind === "changed") {
        streamErr.write(
            `Skipped updating ${notePath} because ${writeResult.reason}. `
            + "Rerun after Obsidian Sync or other local edits settle.\n",
        );
        return 1;
    }

    streamOut.write(`Updated comment ${options.id} in ${notePath}\n`);
    return 0;
}

async function runCommentMigrateLegacy(argv, streamOut, streamErr) {
    let options;
    try {
        options = parseCommentMigrateLegacyArgs(argv);
    } catch (error) {
        streamErr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printCommentMigrateLegacyUsage(streamErr);
        return 1;
    }

    if (options === null) {
        printCommentMigrateLegacyUsage(streamOut);
        return 0;
    }

    const repoRoot = getRepoRoot(import.meta.url);
    const storageModule = await loadStorageModule(repoRoot);
    if (options.file) {
        const notePath = path.resolve(process.cwd(), options.file);
        const noteContent = await readFile(notePath, "utf8");
        const plan = buildLegacyMigrationPlan(notePath, noteContent, storageModule);

        if (plan.kind === "no-managed-block") {
            streamOut.write(`No legacy SideNote2 comments block found in ${notePath}\n`);
            return 0;
        }

        if (plan.kind === "threaded") {
            streamOut.write(`Note already uses threaded SideNote2 comments: ${notePath}\n`);
            return 0;
        }

        if (plan.kind === "unsupported") {
            streamErr.write(
                `Found a SideNote2 comments block in ${notePath}, but it is not a supported legacy flat-comment payload.\n`,
            );
            return 1;
        }

        if (options.dryRun) {
            streamOut.write(`Dry run: would migrate ${plan.threadCount} legacy comments to threaded storage in ${notePath}\n`);
            return 0;
        }

        const writeResult = await writeObservedNoteSafely(notePath, plan.sourceFingerprint, plan.nextContent, {
            settleMs: options.settleMs,
        });
        if (writeResult.kind === "changed") {
            streamErr.write(
                `Skipped migrating ${notePath} because ${writeResult.reason}. `
                + "Rerun after Obsidian Sync or other local edits settle.\n",
            );
            return 1;
        }

        streamOut.write(`Migrated ${plan.threadCount} legacy comments to threaded storage in ${notePath}\n`);
        return 0;
    }

    const rootPath = path.resolve(process.cwd(), options.root);
    const markdownFiles = await collectMarkdownFiles(rootPath);
    const legacyPlans = [];
    const threadedPaths = [];
    const unsupportedPaths = [];

    for (const notePath of markdownFiles) {
        const noteContent = await readFile(notePath, "utf8");
        const plan = buildLegacyMigrationPlan(notePath, noteContent, storageModule);
        if (plan.kind === "legacy") {
            legacyPlans.push(plan);
            continue;
        }

        if (plan.kind === "threaded") {
            threadedPaths.push(notePath);
            continue;
        }

        if (plan.kind === "unsupported") {
            unsupportedPaths.push(notePath);
        }
    }

    if (unsupportedPaths.length > 0) {
        streamErr.write(`Found ${unsupportedPaths.length} unsupported SideNote2 comment block(s) under ${rootPath}:\n`);
        for (const notePath of unsupportedPaths) {
            streamErr.write(`${formatPathRelativeToRoot(rootPath, notePath)}\n`);
        }
        return 1;
    }

    if (legacyPlans.length === 0) {
        streamOut.write(
            `No legacy SideNote2 comment notes found under ${rootPath}. `
            + `${threadedPaths.length} threaded note(s) already use the current format.\n`,
        );
        return 0;
    }

    if (options.dryRun) {
        streamOut.write(`Dry run: found ${legacyPlans.length} legacy note(s) under ${rootPath}:\n`);
        for (const plan of legacyPlans) {
            streamOut.write(`${formatPathRelativeToRoot(rootPath, plan.notePath)}\n`);
        }
        return 0;
    }

    const changedPaths = [];
    let migratedCount = 0;
    for (const plan of legacyPlans) {
        const writeResult = await writeObservedNoteSafely(plan.notePath, plan.sourceFingerprint, plan.nextContent, {
            settleMs: options.settleMs,
        });
        if (writeResult.kind === "changed") {
            changedPaths.push({
                notePath: plan.notePath,
                reason: writeResult.reason,
            });
            continue;
        }

        migratedCount += 1;
    }

    streamOut.write(`Migrated ${migratedCount} legacy note(s) under ${rootPath}\n`);
    if (changedPaths.length === 0) {
        return 0;
    }

    streamErr.write(
        `Skipped ${changedPaths.length} note(s) that changed during the run. `
        + "Rerun after Obsidian Sync or other local edits settle:\n",
    );
    for (const skipped of changedPaths) {
        streamErr.write(`${formatPathRelativeToRoot(rootPath, skipped.notePath)} (${skipped.reason})\n`);
    }
    return 1;
}

async function runInstallSkill(argv, streamOut, streamErr) {
    let options;
    try {
        options = parseSkillArgs(argv);
    } catch (error) {
        streamErr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printSkillUsage("install-skill", streamErr);
        return 1;
    }

    if (options === null) {
        printSkillUsage("install-skill", streamOut);
        return 0;
    }

    const { skillDirectories } = await getBundledSkills();
    const requestedSkillNames = options.skillNames.length > 0
        ? [...new Set(options.skillNames)]
        : [...skillDirectories.keys()];

    const destinationRoot = options.destRoot;
    await mkdir(destinationRoot, { recursive: true });
    for (const skillName of requestedSkillNames) {
        const sourceDir = skillDirectories.get(skillName);
        if (!sourceDir) {
            throw new Error(`Bundled skill not found: ${skillName}`);
        }

        const destinationDir = path.join(destinationRoot, skillName);
        await rm(destinationDir, { recursive: true, force: true });
        await copyDirectoryRecursive(sourceDir, destinationDir);
        streamOut.write(`Installed skill ${skillName} to ${destinationDir}\n`);
    }
    streamOut.write("Restart Codex to pick up new skills.\n");
    return 0;
}

export {
    createContentFingerprint,
    writeObservedNoteSafely,
};

export async function runCli(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
    const [command, ...rest] = argv;
    switch (command) {
        case "comment:migrate-legacy":
            return runCommentMigrateLegacy(rest, io.stdout, io.stderr);
        case "comment:update":
            return runCommentUpdate(rest, io.stdout, io.stderr);
        case "install-skill":
            return runInstallSkill(rest, io.stdout, io.stderr);
        case "--help":
        case "-h":
        case undefined:
            printMainUsage(io.stdout);
            return 0;
        default:
            io.stderr.write(`Unknown command: ${command}\n`);
            printMainUsage(io.stderr);
            return 1;
    }
}

export async function main(argv = process.argv.slice(2)) {
    try {
        const exitCode = await runCli(argv);
        if (exitCode !== 0) {
            process.exit(exitCode);
        }
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

const isDirectExecution = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isDirectExecution) {
    void main();
}
