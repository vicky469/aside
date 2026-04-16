#!/usr/bin/env node

import * as esbuild from "esbuild";
import { createHash, randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
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
            "  comment:create  Create one new SideNote2 comment thread in a note",
            "  comment:append  Append one entry to an existing SideNote2 comment thread in a note",
            "  comment:update  Update one stored SideNote2 comment body in a note",
            "  comment:resolve  Mark one SideNote2 comment thread as resolved in a note",
            "  install-skill   Copy bundled SideNote2 Codex skill(s) into the Codex skills directory",
            "",
            "Run `sidenote2 <command> --help` for command-specific usage.",
        ].join("\n") + "\n",
    );
}

function printCommentCreateUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  sidenote2 comment:create --file <note.md> --page (--comment <text> | --comment-file <path> | --stdin) [--settle-ms <milliseconds>]",
            "  sidenote2 comment:create --file <note.md> --selected-text <text> --start-line <number> --start-char <number> --end-line <number> --end-char <number> (--comment <text> | --comment-file <path> | --stdin) [--settle-ms <milliseconds>]",
            "",
            "Examples:",
            "  sidenote2 comment:create --file ./note.md --page --comment-file ./comment.md",
            "  sidenote2 comment:create --file ./note.md --selected-text \"Priority conflicts\" --start-line 335 --start-char 3 --end-line 335 --end-char 21 --comment-file ./comment.md",
            "  printf 'New page note\\n' | sidenote2 comment:create --file ./note.md --page --stdin",
        ].join("\n") + "\n",
    );
}

function printCommentUpdateUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  sidenote2 comment:update (--file <note.md> --id <comment-id> | --uri <obsidian://side-note2-comment?...>) (--comment <text> | --comment-file <path> | --stdin) [--settle-ms <milliseconds>]",
            "",
            "Examples:",
            "  sidenote2 comment:update --file ./note.md --id comment-1 --comment-file ./comment.md",
            "  sidenote2 comment:update --uri \"obsidian://side-note2-comment?...\" --comment-file ./comment.md",
            "  sidenote2 comment:update --file ./note.md --id comment-1 --comment-file ./comment.md --settle-ms 2000",
            "  printf 'Updated body\\n' | sidenote2 comment:update --file ./note.md --id comment-1 --stdin",
        ].join("\n") + "\n",
    );
}

function printCommentAppendUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  sidenote2 comment:append (--file <note.md> --id <comment-id> | --uri <obsidian://side-note2-comment?...>) (--comment <text> | --comment-file <path> | --stdin) [--settle-ms <milliseconds>]",
            "",
            "Examples:",
            "  sidenote2 comment:append --file ./note.md --id comment-1 --comment-file ./reply.md",
            "  sidenote2 comment:append --uri \"obsidian://side-note2-comment?...\" --comment-file ./reply.md",
            "  sidenote2 comment:append --file ./note.md --id comment-1 --comment-file ./reply.md --settle-ms 2000",
            "  printf 'Reply body\\n' | sidenote2 comment:append --file ./note.md --id comment-1 --stdin",
        ].join("\n") + "\n",
    );
}

function printCommentResolveUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  sidenote2 comment:resolve (--file <note.md> --id <comment-id> | --uri <obsidian://side-note2-comment?...>) [--settle-ms <milliseconds>]",
            "",
            "Examples:",
            "  sidenote2 comment:resolve --file ./note.md --id comment-1",
            "  sidenote2 comment:resolve --uri \"obsidian://side-note2-comment?...\"",
            "  sidenote2 comment:resolve --file ./note.md --id comment-1 --settle-ms 2000",
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
        uri: "",
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
            case "--uri":
                options.uri = argv[index + 1] ?? "";
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
    const hasFileOrIdTarget = Boolean(options.file || options.id);
    const hasFileAndIdTarget = Boolean(options.file && options.id);
    const hasUriTarget = Boolean(options.uri);
    if (contentSources !== 1 || (hasFileOrIdTarget ? 1 : 0) + (hasUriTarget ? 1 : 0) !== 1 || (hasFileOrIdTarget && !hasFileAndIdTarget)) {
        throw new Error("Expected exactly one target form: either --file with --id, or --uri, plus exactly one comment source.");
    }

    return options;
}

function parseCommentCreateArgs(argv) {
    const options = {
        file: "",
        page: false,
        selectedText: "",
        startLine: null,
        startChar: null,
        endLine: null,
        endChar: null,
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
            case "--page":
                options.page = true;
                break;
            case "--selected-text":
                options.selectedText = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--start-line":
                options.startLine = parseNonNegativeIntegerOption(argv[index + 1] ?? "", "--start-line");
                index += 1;
                break;
            case "--start-char":
                options.startChar = parseNonNegativeIntegerOption(argv[index + 1] ?? "", "--start-char");
                index += 1;
                break;
            case "--end-line":
                options.endLine = parseNonNegativeIntegerOption(argv[index + 1] ?? "", "--end-line");
                index += 1;
                break;
            case "--end-char":
                options.endChar = parseNonNegativeIntegerOption(argv[index + 1] ?? "", "--end-char");
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
    if (!options.file || contentSources !== 1) {
        throw new Error("Expected --file plus exactly one comment source.");
    }

    const hasSelectionTarget = options.selectedText.length > 0
        || options.startLine !== null
        || options.startChar !== null
        || options.endLine !== null
        || options.endChar !== null;

    if (options.page && hasSelectionTarget) {
        throw new Error("Expected either --page or a selection target, not both.");
    }

    if (!options.page) {
        if (
            !options.selectedText
            || options.startLine === null
            || options.startChar === null
            || options.endLine === null
            || options.endChar === null
        ) {
            throw new Error(
                "Expected --page, or --selected-text with --start-line/--start-char/--end-line/--end-char.",
            );
        }

        if (
            options.endLine < options.startLine
            || (options.endLine === options.startLine && options.endChar < options.startChar)
        ) {
            throw new Error("Expected the end position to be at or after the start position.");
        }
    }

    return options;
}

function parseCommentAppendArgs(argv) {
    return parseCommentUpdateArgs(argv);
}

function parseCommentResolveArgs(argv) {
    const options = {
        file: "",
        id: "",
        uri: "",
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
            case "--uri":
                options.uri = argv[index + 1] ?? "";
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

    const hasFileOrIdTarget = Boolean(options.file || options.id);
    const hasFileAndIdTarget = Boolean(options.file && options.id);
    const hasUriTarget = Boolean(options.uri);
    if ((hasFileOrIdTarget ? 1 : 0) + (hasUriTarget ? 1 : 0) !== 1 || (hasFileOrIdTarget && !hasFileAndIdTarget)) {
        throw new Error("Expected exactly one target form: either --file with --id, or --uri.");
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

function createBufferedIo() {
    const stdoutChunks = [];
    const stderrChunks = [];

    return {
        io: {
            stdout: {
                write(chunk) {
                    stdoutChunks.push(String(chunk));
                    return true;
                },
            },
            stderr: {
                write(chunk) {
                    stderrChunks.push(String(chunk));
                    return true;
                },
            },
        },
        flush() {
            const stdout = stdoutChunks.join("");
            const stderr = stderrChunks.join("");
            if (stdout) {
                writeSync(process.stdout.fd, stdout);
            }
            if (stderr) {
                writeSync(process.stderr.fd, stderr);
            }
        },
    };
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

function getPageCommentLabelForPath(filePath) {
    return path.basename(filePath).replace(/\.[^.]+$/i, "") || filePath;
}

function hashCommentSelection(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

const COMMENT_LOCATION_PROTOCOL = "side-note2-comment";

function parseCommentProtocolUri(uri) {
    try {
        const parsed = new URL(uri);
        if (parsed.protocol !== "obsidian:" || parsed.hostname !== COMMENT_LOCATION_PROTOCOL) {
            return null;
        }

        const vaultName = parsed.searchParams.get("vault");
        const filePath = parsed.searchParams.get("file");
        const commentId = parsed.searchParams.get("commentId");
        if (!(vaultName && filePath && commentId)) {
            return null;
        }

        return {
            vaultName,
            filePath,
            commentId,
        };
    } catch {
        return null;
    }
}

function getObsidianConfigPath() {
    const explicitConfigPath = process.env.OBSIDIAN_CONFIG_PATH?.trim();
    return explicitConfigPath
        ? path.resolve(process.cwd(), explicitConfigPath)
        : path.join(homedir(), ".config", "obsidian", "obsidian.json");
}

async function resolveVaultRootByName(vaultName) {
    const configPath = getObsidianConfigPath();
    let config;
    try {
        config = JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not read Obsidian vault config at ${configPath}: ${reason}`);
    }

    const configuredVaults = config?.vaults;
    if (!configuredVaults || typeof configuredVaults !== "object") {
        throw new Error(`Obsidian vault config at ${configPath} does not contain a valid vault list.`);
    }

    const matchingVaultRoots = [];
    for (const value of Object.values(configuredVaults)) {
        if (!value || typeof value !== "object") {
            continue;
        }

        const vaultPath = typeof value.path === "string" ? value.path : "";
        if (!vaultPath) {
            continue;
        }

        const resolvedVaultPath = path.resolve(vaultPath);
        if (path.basename(resolvedVaultPath) === vaultName) {
            matchingVaultRoots.push(resolvedVaultPath);
        }
    }

    if (matchingVaultRoots.length === 0) {
        throw new Error(`Could not resolve Obsidian vault "${vaultName}" from ${configPath}.`);
    }

    if (matchingVaultRoots.length > 1) {
        throw new Error(`Found multiple Obsidian vaults named "${vaultName}" in ${configPath}.`);
    }

    return matchingVaultRoots[0];
}

function resolveVaultRelativeNotePath(vaultRoot, filePath) {
    const resolvedNotePath = path.resolve(vaultRoot, filePath);
    const relativePath = path.relative(vaultRoot, resolvedNotePath);
    if (
        relativePath.startsWith("..")
        || path.isAbsolute(relativePath)
        || relativePath === ""
        || relativePath === "."
    ) {
        throw new Error(`Comment URI file path escapes the resolved vault root: ${filePath}`);
    }

    return resolvedNotePath;
}

async function resolveCommentWriteTarget(options) {
    if (options.uri) {
        const uriTarget = parseCommentProtocolUri(options.uri);
        if (!uriTarget) {
            throw new Error("Expected --uri to be an obsidian://side-note2-comment link with vault, file, and commentId.");
        }

        const vaultRoot = await resolveVaultRootByName(uriTarget.vaultName);
        return {
            notePath: resolveVaultRelativeNotePath(vaultRoot, uriTarget.filePath),
            commentId: uriTarget.commentId,
        };
    }

    return {
        notePath: path.resolve(process.cwd(), options.file),
        commentId: options.id,
    };
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
    let writeTarget;
    try {
        writeTarget = await resolveCommentWriteTarget(options);
    } catch (error) {
        streamErr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    const notePath = writeTarget.notePath;
    const commentId = writeTarget.commentId;
    const nextCommentBody = await loadCommentBody(options);
    const noteContent = await readFile(notePath, "utf8");
    const storageModule = await loadStorageModule(repoRoot);
    const updated = storageModule.replaceNoteCommentBodyById(noteContent, notePath, commentId, nextCommentBody);

    if (typeof updated !== "string") {
        if (storageModule.getManagedSectionKind(noteContent) === "unsupported") {
            streamErr.write(
                `Found a SideNote2 comments block in ${notePath}, but it is not a supported threaded entries[] payload.\n`,
            );
            return 1;
        }

        streamErr.write(`Comment id not found: ${commentId}\n`);
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

    streamOut.write(`Updated comment ${commentId} in ${notePath}\n`);
    return 0;
}

async function runCommentCreate(argv, streamOut, streamErr) {
    let options;
    try {
        options = parseCommentCreateArgs(argv);
    } catch (error) {
        streamErr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printCommentCreateUsage(streamErr);
        return 1;
    }

    if (options === null) {
        printCommentCreateUsage(streamOut);
        return 0;
    }

    const repoRoot = getRepoRoot(import.meta.url);
    const notePath = path.resolve(process.cwd(), options.file);
    const nextCommentBody = await loadCommentBody(options);
    const noteContent = await readFile(notePath, "utf8");
    const storageModule = await loadStorageModule(repoRoot);
    const managedSectionKind = storageModule.getManagedSectionKind(noteContent);
    if (managedSectionKind === "unsupported") {
        streamErr.write(
            `Found a SideNote2 comments block in ${notePath}, but it is not a supported threaded entries[] payload.\n`,
        );
        return 1;
    }

    const parsed = storageModule.parseNoteComments(noteContent, notePath);
    const timestamp = Date.now();
    const threadId = randomUUID();
    const selectedText = options.page
        ? getPageCommentLabelForPath(notePath)
        : options.selectedText;
    const nextThread = {
        id: threadId,
        filePath: notePath,
        startLine: options.page ? 0 : options.startLine,
        startChar: options.page ? 0 : options.startChar,
        endLine: options.page ? 0 : options.endLine,
        endChar: options.page ? 0 : options.endChar,
        selectedText,
        selectedTextHash: hashCommentSelection(selectedText),
        anchorKind: options.page ? "page" : "selection",
        orphaned: false,
        resolved: false,
        entries: [{
            id: threadId,
            body: nextCommentBody,
            timestamp,
        }],
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const updated = storageModule.serializeNoteCommentThreads(noteContent, [...parsed.threads, nextThread]);

    const writeResult = await writeObservedNoteSafely(notePath, createContentFingerprint(noteContent), updated, {
        settleMs: options.settleMs,
    });
    if (writeResult.kind === "changed") {
        streamErr.write(
            `Skipped creating a comment in ${notePath} because ${writeResult.reason}. `
            + "Rerun after Obsidian Sync or other local edits settle.\n",
        );
        return 1;
    }

    const anchorLabel = options.page ? "page note" : "anchored note";
    streamOut.write(`Created ${anchorLabel} thread ${threadId} in ${notePath}\n`);
    return 0;
}

async function runCommentAppend(argv, streamOut, streamErr) {
    let options;
    try {
        options = parseCommentAppendArgs(argv);
    } catch (error) {
        streamErr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printCommentAppendUsage(streamErr);
        return 1;
    }

    if (options === null) {
        printCommentAppendUsage(streamOut);
        return 0;
    }

    const repoRoot = getRepoRoot(import.meta.url);
    let writeTarget;
    try {
        writeTarget = await resolveCommentWriteTarget(options);
    } catch (error) {
        streamErr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    const notePath = writeTarget.notePath;
    const commentId = writeTarget.commentId;
    const nextCommentBody = await loadCommentBody(options);
    const noteContent = await readFile(notePath, "utf8");
    const storageModule = await loadStorageModule(repoRoot);
    const updated = storageModule.appendNoteCommentEntryById(noteContent, notePath, commentId, {
        id: randomUUID(),
        body: nextCommentBody,
        timestamp: Date.now(),
    });

    if (typeof updated !== "string") {
        const managedSectionKind = storageModule.getManagedSectionKind(noteContent);
        if (managedSectionKind === "unsupported") {
            streamErr.write(
                `Found a SideNote2 comments block in ${notePath}, but it is not a supported threaded entries[] payload.\n`,
            );
            return 1;
        }

        if (managedSectionKind === "none") {
            streamErr.write(`No SideNote2 comments block found in ${notePath}\n`);
            return 1;
        }

        streamErr.write(`Comment id not found: ${commentId}\n`);
        return 1;
    }

    const writeResult = await writeObservedNoteSafely(notePath, createContentFingerprint(noteContent), updated, {
        settleMs: options.settleMs,
    });
    if (writeResult.kind === "changed") {
        streamErr.write(
            `Skipped appending to ${notePath} because ${writeResult.reason}. `
            + "Rerun after Obsidian Sync or other local edits settle.\n",
        );
        return 1;
    }

    streamOut.write(`Appended a new entry to comment ${commentId} in ${notePath}\n`);
    return 0;
}

async function runCommentResolve(argv, streamOut, streamErr) {
    let options;
    try {
        options = parseCommentResolveArgs(argv);
    } catch (error) {
        streamErr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printCommentResolveUsage(streamErr);
        return 1;
    }

    if (options === null) {
        printCommentResolveUsage(streamOut);
        return 0;
    }

    const repoRoot = getRepoRoot(import.meta.url);
    let writeTarget;
    try {
        writeTarget = await resolveCommentWriteTarget(options);
    } catch (error) {
        streamErr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    const notePath = writeTarget.notePath;
    const commentId = writeTarget.commentId;
    const noteContent = await readFile(notePath, "utf8");
    const storageModule = await loadStorageModule(repoRoot);
    const updated = storageModule.resolveNoteCommentById(noteContent, notePath, commentId);

    if (typeof updated !== "string") {
        const managedSectionKind = storageModule.getManagedSectionKind(noteContent);
        if (managedSectionKind === "unsupported") {
            streamErr.write(
                `Found a SideNote2 comments block in ${notePath}, but it is not a supported threaded entries[] payload.\n`,
            );
            return 1;
        }

        if (managedSectionKind === "none") {
            streamErr.write(`No SideNote2 comments block found in ${notePath}\n`);
            return 1;
        }

        streamErr.write(`Comment id not found: ${commentId}\n`);
        return 1;
    }

    const writeResult = await writeObservedNoteSafely(notePath, createContentFingerprint(noteContent), updated, {
        settleMs: options.settleMs,
    });
    if (writeResult.kind === "changed") {
        streamErr.write(
            `Skipped resolving ${notePath} because ${writeResult.reason}. `
            + "Rerun after Obsidian Sync or other local edits settle.\n",
        );
        return 1;
    }

    streamOut.write(`Resolved comment ${commentId} in ${notePath}\n`);
    return 0;
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
        case "comment:create":
            return runCommentCreate(rest, io.stdout, io.stderr);
        case "comment:append":
            return runCommentAppend(rest, io.stdout, io.stderr);
        case "comment:update":
            return runCommentUpdate(rest, io.stdout, io.stderr);
        case "comment:resolve":
            return runCommentResolve(rest, io.stdout, io.stderr);
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
    const bufferedIo = createBufferedIo();
    try {
        const exitCode = await runCli(argv, bufferedIo.io);
        bufferedIo.flush();
        if (exitCode !== 0) {
            process.exit(exitCode);
        }
    } catch (error) {
        bufferedIo.flush();
        writeSync(process.stderr.fd, `${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

const isDirectExecution = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isDirectExecution) {
    await main();
}
