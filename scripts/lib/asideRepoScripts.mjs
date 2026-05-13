import * as esbuild from "esbuild";
import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function getRepoRoot(metaUrl) {
    return path.resolve(path.dirname(fileURLToPath(metaUrl)), "../..");
}

function parseNonNegativeIntegerOption(rawValue, flagName) {
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`Expected ${flagName} to be a non-negative integer.`);
    }

    return parsed;
}

function printCreateNoteCommentThreadUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  node scripts/create-note-comment-thread.mjs --file <note.md> --page (--comment <text> | --comment-file <path> | --stdin) [--settle-ms <milliseconds>]",
            "  node scripts/create-note-comment-thread.mjs --file <note.md> --selected-text <text> --start-line <number> --start-char <number> --end-line <number> --end-char <number> (--comment <text> | --comment-file <path> | --stdin) [--settle-ms <milliseconds>]",
        ].join("\n") + "\n",
    );
}

function printCreateNoteCommentThreadWithChildrenUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  node scripts/create-note-comment-thread-with-children.mjs --file <note.md> --page --root-comment-file <path> (--children-dir <dir> | --children-file <path>) [--child-separator <text>] [--replace-existing] [--settle-ms <milliseconds>]",
            "  node scripts/create-note-comment-thread-with-children.mjs --file <note.md> --selected-text <text> --start-line <number> --start-char <number> --end-line <number> --end-char <number> --root-comment-file <path> (--children-dir <dir> | --children-file <path>) [--child-separator <text>] [--replace-existing] [--settle-ms <milliseconds>]",
        ].join("\n") + "\n",
    );
}

function printAppendNoteCommentEntryUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  node scripts/append-note-comment-entry.mjs (--file <note.md> --id <comment-id> | --uri <obsidian://aside-comment?...>) (--comment <text> | --comment-file <path> | --stdin) [--settle-ms <milliseconds>]",
        ].join("\n") + "\n",
    );
}

function printUpdateNoteCommentUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  node scripts/update-note-comment.mjs (--file <note.md> --id <comment-id> | --uri <obsidian://aside-comment?...>) (--comment <text> | --comment-file <path> | --stdin) [--settle-ms <milliseconds>]",
        ].join("\n") + "\n",
    );
}

function printResolveNoteCommentUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  node scripts/resolve-note-comment.mjs (--file <note.md> --id <comment-id> | --uri <obsidian://aside-comment?...>) [--settle-ms <milliseconds>]",
        ].join("\n") + "\n",
    );
}

function printInstallBundledSkillUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  node scripts/install-bundled-skill.mjs [--name <skill-name>]... [--dest <skills-root>]",
            "",
            "Defaults:",
            "  installs all bundled skills when --name is omitted",
            "  --dest defaults to $CODEX_HOME/skills or ~/.codex/skills",
        ].join("\n") + "\n",
    );
}

function parseCommentTargetArgs(argv, options) {
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
                return arg;
        }
    }

    return undefined;
}

function parseCreateNoteCommentThreadArgs(argv) {
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

function parseCreateNoteCommentThreadWithChildrenArgs(argv) {
    const options = {
        file: "",
        page: false,
        selectedText: "",
        startLine: null,
        startChar: null,
        endLine: null,
        endChar: null,
        rootCommentFile: "",
        childrenDir: "",
        childrenFile: "",
        childSeparator: "\n---\n",
        replaceExisting: false,
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
            case "--root-comment-file":
                options.rootCommentFile = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--children-dir":
                options.childrenDir = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--children-file":
                options.childrenFile = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--child-separator":
                options.childSeparator = argv[index + 1] ?? "";
                index += 1;
                break;
            case "--replace-existing":
                options.replaceExisting = true;
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

    const childSources = [Boolean(options.childrenDir), Boolean(options.childrenFile)].filter(Boolean).length;
    if (!options.file || !options.rootCommentFile || childSources !== 1) {
        throw new Error("Expected --file, --root-comment-file, and exactly one of --children-dir or --children-file.");
    }
    if (options.childrenFile && !options.childSeparator) {
        throw new Error("Expected --child-separator to be non-empty when --children-file is used.");
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

function parseAppendOrUpdateArgs(argv) {
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

function parseResolveArgs(argv) {
    const options = {
        file: "",
        id: "",
        uri: "",
        settleMs: 0,
    };

    const result = parseCommentTargetArgs(argv, options);
    if (result === null) {
        return null;
    }
    if (typeof result === "string") {
        throw new Error(`Unknown argument: ${result}`);
    }

    const hasFileOrIdTarget = Boolean(options.file || options.id);
    const hasFileAndIdTarget = Boolean(options.file && options.id);
    const hasUriTarget = Boolean(options.uri);
    if ((hasFileOrIdTarget ? 1 : 0) + (hasUriTarget ? 1 : 0) !== 1 || (hasFileOrIdTarget && !hasFileAndIdTarget)) {
        throw new Error("Expected exactly one target form: either --file with --id, or --uri.");
    }

    return options;
}

function getDefaultSkillsRoot() {
    const codexHome = process.env.CODEX_HOME?.trim();
    return codexHome
        ? path.join(codexHome, "skills")
        : path.join(homedir(), ".codex", "skills");
}

function parseInstallBundledSkillArgs(argv) {
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

export function createContentFingerprint(content) {
    return `${Buffer.byteLength(content, "utf8")}:${createHash("sha256").update(content).digest("hex")}`;
}

async function writeFileAtomically(targetPath, content) {
    const tempPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.aside-${process.pid}-${randomUUID()}.tmp`,
    );
    await writeFile(tempPath, content, "utf8");
    try {
        await rename(tempPath, targetPath);
    } catch (error) {
        await rm(tempPath, { force: true });
        throw error;
    }
}

export async function writeObservedNoteSafely(notePath, expectedFingerprint, nextContent, options = {}) {
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

function normalizeCommentBody(body) {
    return body.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

export function hashText(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeStoragePath(targetPath) {
    return targetPath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export function getSidecarPath(vaultRoot, noteRelativePath) {
    const normalized = normalizeStoragePath(noteRelativePath);
    const noteHash = hashText(normalized);
    const shard = noteHash.slice(0, 2) || "00";
    return path.join(vaultRoot, ".obsidian", "plugins", "aside", "sidenotes", "by-note", shard, `${noteHash}.json`);
}

function getLegacySidecarPath(vaultRoot, noteRelativePath) {
    const normalized = normalizeStoragePath(noteRelativePath);
    const noteHash = hashText(normalized);
    const shard = noteHash.slice(0, 2) || "00";
    return path.join(vaultRoot, ".obsidian", "plugins", "side-note2", "sidenotes", "by-note", shard, `${noteHash}.json`);
}

export function getSourceSidecarPath(vaultRoot, sourceId) {
    const sourceHash = hashText(sourceId);
    const shard = sourceHash.slice(0, 2) || "00";
    return path.join(vaultRoot, ".obsidian", "plugins", "aside", "sidenotes", "by-source", shard, `${sourceHash}.json`);
}

function getLegacySourceSidecarPath(vaultRoot, sourceId) {
    const sourceHash = hashText(sourceId);
    const shard = sourceHash.slice(0, 2) || "00";
    return path.join(vaultRoot, ".obsidian", "plugins", "side-note2", "sidenotes", "by-source", shard, `${sourceHash}.json`);
}

async function readSourceIdForPath(vaultRoot, noteRelativePath) {
    const dataPaths = [
        path.join(vaultRoot, ".obsidian", "plugins", "aside", "data.json"),
        path.join(vaultRoot, ".obsidian", "plugins", "side-note2", "data.json"),
    ];
    let parsed;
    for (const dataPath of dataPaths) {
        try {
            parsed = JSON.parse(await readFile(dataPath, "utf8"));
            break;
        } catch (error) {
            if (error && error.code === "ENOENT") {
                continue;
            }
            throw error;
        }
    }
    if (!parsed) {
        return null;
    }

    const state = parsed?.sourceIdentityState;
    const pathToSourceId = state?.pathToSourceId;
    if (pathToSourceId && typeof pathToSourceId[noteRelativePath] === "string") {
        return pathToSourceId[noteRelativePath];
    }

    const sources = state?.sources && typeof state.sources === "object" ? state.sources : {};
    for (const record of Object.values(sources)) {
        if (!record || typeof record !== "object") {
            continue;
        }
        if (record.currentPath === noteRelativePath) {
            return record.sourceId ?? null;
        }
        if (Array.isArray(record.aliases) && record.aliases.includes(noteRelativePath)) {
            return record.sourceId ?? null;
        }
    }

    return null;
}

async function writeSidecarPayload(sidecarPath, payload) {
    const serialized = `${JSON.stringify(payload)}\n`;
    const tempPath = `${sidecarPath}.tmp-${process.pid}-${randomUUID()}`;
    await mkdir(path.dirname(sidecarPath), { recursive: true });
    await writeFile(tempPath, serialized, "utf8");
    try {
        await rename(tempPath, sidecarPath);
    } catch (error) {
        await rm(tempPath, { force: true });
        throw error;
    }
}

export async function resolveVaultRootByPath(notePath) {
    let current = path.resolve(notePath);
    while (true) {
        const parent = path.dirname(current);
        if (parent === current) {
            throw new Error(`Could not find an Obsidian vault (.obsidian directory) for ${notePath}`);
        }
        const obsidianDir = path.join(parent, ".obsidian");
        if (await pathExists(obsidianDir)) {
            return parent;
        }
        current = parent;
    }
}

export function getVaultRelativePath(vaultRoot, absolutePath) {
    const relative = path.relative(vaultRoot, path.resolve(absolutePath));
    return relative.split(path.sep).join("/");
}

export async function readSidecar(vaultRoot, noteRelativePath) {
    const sidecarPaths = [
        getSidecarPath(vaultRoot, noteRelativePath),
        getLegacySidecarPath(vaultRoot, noteRelativePath),
    ];
    for (const sidecarPath of sidecarPaths) {
        try {
            const raw = await readFile(sidecarPath, "utf8");
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || !Array.isArray(parsed.threads)) {
                return null;
            }
            return parsed.threads.map((thread) => ({
                ...thread,
                filePath: noteRelativePath,
                entries: Array.isArray(thread.entries) ? thread.entries.map((entry) => ({ ...entry })) : [],
            }));
        } catch (error) {
            if (error && error.code === "ENOENT") {
                continue;
            }
            throw error;
        }
    }
    return null;
}

export async function writeSidecar(vaultRoot, noteRelativePath, threads) {
    const sidecarPath = getSidecarPath(vaultRoot, noteRelativePath);
    const legacySidecarPath = getLegacySidecarPath(vaultRoot, noteRelativePath);
    const sourceId = await readSourceIdForPath(vaultRoot, noteRelativePath);
    const sourceSidecarPath = sourceId ? getSourceSidecarPath(vaultRoot, sourceId) : null;
    const legacySourceSidecarPath = sourceId ? getLegacySourceSidecarPath(vaultRoot, sourceId) : null;
    if (threads.length === 0) {
        for (const targetPath of [sidecarPath, legacySidecarPath, sourceSidecarPath, legacySourceSidecarPath].filter(Boolean)) {
            if (await pathExists(targetPath)) {
                await rm(targetPath, { force: true });
            }
        }
        return;
    }
    const payload = {
        version: 1,
        notePath: noteRelativePath,
        threads: threads.map((thread) => ({
            ...thread,
            filePath: noteRelativePath,
        })),
    };
    await writeSidecarPayload(sidecarPath, payload);
    if (sourceId && sourceSidecarPath) {
        await writeSidecarPayload(sourceSidecarPath, {
            ...payload,
            sourceId,
        });
    }
    for (const stalePath of [legacySidecarPath, legacySourceSidecarPath].filter(Boolean)) {
        if (await pathExists(stalePath)) {
            await rm(stalePath, { force: true });
        }
    }
}

async function loadChildCommentBodies(options) {
    if (options.childrenDir) {
        const dirPath = path.resolve(process.cwd(), options.childrenDir);
        const entries = await readdir(dirPath, { withFileTypes: true });
        const fileNames = entries
            .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
            .map((entry) => entry.name)
            .sort((left, right) => left.localeCompare(right));
        if (fileNames.length === 0) {
            throw new Error(`No child comment files found in ${dirPath}`);
        }

        return Promise.all(fileNames.map(async (fileName) =>
            normalizeCommentBody(await readFile(path.join(dirPath, fileName), "utf8"))
        ));
    }

    const raw = await readFile(path.resolve(process.cwd(), options.childrenFile), "utf8");
    const bodies = raw
        .split(options.childSeparator)
        .map((body) => normalizeCommentBody(body.trim()))
        .filter((body) => body.length > 0);
    if (bodies.length === 0) {
        throw new Error(`No child comments found in ${options.childrenFile}`);
    }
    return bodies;
}

function removeExistingThreadsForTarget(threads, target) {
    return threads.filter((thread) => {
        if (thread.filePath !== target.filePath) {
            return true;
        }
        if (target.anchorKind === "page") {
            return thread.anchorKind !== "page";
        }
        return !(
            thread.anchorKind !== "page"
            && thread.startLine === target.startLine
            && thread.startChar === target.startChar
            && thread.endLine === target.endLine
            && thread.endChar === target.endChar
            && thread.selectedTextHash === target.selectedTextHash
        );
    });
}

export async function loadThreadsWithFallback(vaultRoot, notePath, noteRelativePath) {
    const sidecarThreads = await readSidecar(vaultRoot, noteRelativePath);
    if (sidecarThreads) {
        const noteContent = await readFile(notePath, "utf8");
        const storageModule = await loadStorageModule();
        const managedSectionKind = storageModule.getManagedSectionKind(noteContent);
        return {
            threads: sidecarThreads,
            noteContent,
            hadLegacyBlock: managedSectionKind === "threaded",
        };
    }
    const noteContent = await readFile(notePath, "utf8");
    const storageModule = await loadStorageModule();
    const managedSectionKind = storageModule.getManagedSectionKind(noteContent);
    if (managedSectionKind === "unsupported") {
        throw new Error(getManagedSectionErrorMessage(storageModule, noteContent, notePath));
    }
    const parsed = storageModule.parseNoteComments(noteContent, notePath);
    return { threads: parsed.threads, noteContent, hadLegacyBlock: managedSectionKind === "threaded" };
}

export async function stripLegacyBlockIfNeeded(vaultRoot, notePath, noteRelativePath, noteContent, hadLegacyBlock, settleMs) {
    if (!hadLegacyBlock || !noteContent) {
        return { kind: "written" };
    }
    const storageModule = await loadStorageModule();
    const stripped = storageModule.serializeNoteCommentThreads(noteContent, []);
    return writeObservedNoteSafely(notePath, createContentFingerprint(noteContent), stripped, { settleMs });
}

const COMMENT_LOCATION_PROTOCOL = "aside-comment";
const LEGACY_COMMENT_LOCATION_PROTOCOL = "side-note2-comment";

function parseCommentProtocolUri(uri) {
    try {
        const parsed = new URL(uri);
        if (
            parsed.protocol !== "obsidian:"
            || (parsed.hostname !== COMMENT_LOCATION_PROTOCOL && parsed.hostname !== LEGACY_COMMENT_LOCATION_PROTOCOL)
        ) {
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
            throw new Error("Expected --uri to be an obsidian://aside-comment link with vault, file, and commentId.");
        }

        const vaultRoot = await resolveVaultRootByName(uriTarget.vaultName);
        const notePath = resolveVaultRelativeNotePath(vaultRoot, uriTarget.filePath);
        return {
            notePath,
            commentId: uriTarget.commentId,
            vaultRoot,
            noteRelativePath: uriTarget.filePath,
        };
    }

    const notePath = path.resolve(process.cwd(), options.file);
    const vaultRoot = await resolveVaultRootByPath(notePath);
    return {
        notePath,
        commentId: options.id,
        vaultRoot,
        noteRelativePath: getVaultRelativePath(vaultRoot, notePath),
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

    return { skillDirectories };
}

async function loadStorageModule() {
    const repoRoot = getRepoRoot(import.meta.url);
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

function getManagedSectionErrorMessage(storageModule, noteContent, notePath) {
    const problem = typeof storageModule.getManagedSectionProblem === "function"
        ? storageModule.getManagedSectionProblem(noteContent)
        : null;

    if (problem === "multiple") {
        return `Found multiple Aside or legacy SideNote2 comments blocks in ${notePath}. Collapse them to exactly one managed block before writing.\n`;
    }

    return `Found an Aside or legacy SideNote2 comments block in ${notePath}, but it is not a supported threaded entries[] payload.\n`;
}

export async function runCreateNoteCommentThread(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
    let options;
    try {
        options = parseCreateNoteCommentThreadArgs(argv);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printCreateNoteCommentThreadUsage(io.stderr);
        return 1;
    }

    if (options === null) {
        printCreateNoteCommentThreadUsage(io.stdout);
        return 0;
    }

    const notePath = path.resolve(process.cwd(), options.file);
    let vaultRoot;
    let noteRelativePath;
    try {
        vaultRoot = await resolveVaultRootByPath(notePath);
        noteRelativePath = getVaultRelativePath(vaultRoot, notePath);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    const nextCommentBody = await loadCommentBody(options);
    let threads;
    let noteContent;
    let hadLegacyBlock;
    try {
        ({ threads, noteContent, hadLegacyBlock } = await loadThreadsWithFallback(vaultRoot, notePath, noteRelativePath));
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    const timestamp = Date.now();
    const threadId = randomUUID();
    const selectedText = options.page
        ? getPageCommentLabelForPath(noteRelativePath)
        : options.selectedText;
    const nextThread = {
        id: threadId,
        filePath: noteRelativePath,
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
            body: normalizeCommentBody(nextCommentBody),
            timestamp,
        }],
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    threads.push(nextThread);

    await writeSidecar(vaultRoot, noteRelativePath, threads);

    const migrationResult = await stripLegacyBlockIfNeeded(vaultRoot, notePath, noteRelativePath, noteContent, hadLegacyBlock, options.settleMs);
    if (migrationResult.kind === "changed") {
        io.stderr.write(
            `Note content changed during sidecar migration; legacy block may still exist in ${notePath}. `
            + "Rerun after Obsidian Sync or other local edits settle.\n",
        );
    }

    const anchorLabel = options.page ? "page note" : "anchored note";
    io.stdout.write(`Created ${anchorLabel} thread ${threadId} in ${notePath}\n`);
    return 0;
}

export async function runCreateNoteCommentThreadWithChildren(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
    let options;
    try {
        options = parseCreateNoteCommentThreadWithChildrenArgs(argv);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printCreateNoteCommentThreadWithChildrenUsage(io.stderr);
        return 1;
    }

    if (options === null) {
        printCreateNoteCommentThreadWithChildrenUsage(io.stdout);
        return 0;
    }

    const notePath = path.resolve(process.cwd(), options.file);
    let vaultRoot;
    let noteRelativePath;
    try {
        vaultRoot = await resolveVaultRootByPath(notePath);
        noteRelativePath = getVaultRelativePath(vaultRoot, notePath);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    let rootBody;
    let childBodies;
    try {
        rootBody = normalizeCommentBody(await readFile(path.resolve(process.cwd(), options.rootCommentFile), "utf8"));
        childBodies = await loadChildCommentBodies(options);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    if (!rootBody) {
        io.stderr.write("Root comment body is empty.\n");
        return 1;
    }

    let threads;
    let noteContent;
    let hadLegacyBlock;
    try {
        ({ threads, noteContent, hadLegacyBlock } = await loadThreadsWithFallback(vaultRoot, notePath, noteRelativePath));
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    const timestamp = Date.now();
    const threadId = randomUUID();
    const selectedText = options.page
        ? getPageCommentLabelForPath(noteRelativePath)
        : options.selectedText;
    const selectedTextHash = hashCommentSelection(selectedText);
    const target = {
        filePath: noteRelativePath,
        anchorKind: options.page ? "page" : "selection",
        startLine: options.page ? 0 : options.startLine,
        startChar: options.page ? 0 : options.startChar,
        endLine: options.page ? 0 : options.endLine,
        endChar: options.page ? 0 : options.endChar,
        selectedTextHash,
    };
    const entries = [
        {
            id: threadId,
            body: rootBody,
            timestamp,
        },
        ...childBodies.map((body, index) => ({
            id: randomUUID(),
            body,
            timestamp: timestamp + index + 1,
        })),
    ];
    const nextThread = {
        id: threadId,
        filePath: noteRelativePath,
        startLine: target.startLine,
        startChar: target.startChar,
        endLine: target.endLine,
        endChar: target.endChar,
        selectedText,
        selectedTextHash,
        anchorKind: options.page ? "page" : "selection",
        orphaned: false,
        resolved: false,
        entries,
        createdAt: timestamp,
        updatedAt: entries[entries.length - 1]?.timestamp ?? timestamp,
    };

    const nextThreads = [
        ...(options.replaceExisting ? removeExistingThreadsForTarget(threads, target) : threads),
        nextThread,
    ];
    await writeSidecar(vaultRoot, noteRelativePath, nextThreads);

    const migrationResult = await stripLegacyBlockIfNeeded(vaultRoot, notePath, noteRelativePath, noteContent, hadLegacyBlock, options.settleMs);
    if (migrationResult.kind === "changed") {
        io.stderr.write(
            `Note content changed during sidecar migration; legacy block may still exist in ${notePath}. `
            + "Rerun after Obsidian Sync or other local edits settle.\n",
        );
    }

    const anchorLabel = options.page ? "page note" : "anchored note";
    io.stdout.write(
        `Created ${anchorLabel} thread ${threadId} with ${childBodies.length} child `
        + `comment${childBodies.length === 1 ? "" : "s"} in ${notePath}\n`,
    );
    return 0;
}

export async function runAppendNoteCommentEntry(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
    let options;
    try {
        options = parseAppendOrUpdateArgs(argv);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printAppendNoteCommentEntryUsage(io.stderr);
        return 1;
    }

    if (options === null) {
        printAppendNoteCommentEntryUsage(io.stdout);
        return 0;
    }

    let writeTarget;
    try {
        writeTarget = await resolveCommentWriteTarget(options);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    const { notePath, commentId, vaultRoot, noteRelativePath } = writeTarget;
    const nextCommentBody = await loadCommentBody(options);

    let threads;
    let noteContent;
    let hadLegacyBlock;
    try {
        ({ threads, noteContent, hadLegacyBlock } = await loadThreadsWithFallback(vaultRoot, notePath, noteRelativePath));
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    let found = false;
    const timestamp = Date.now();
    const updatedThreads = threads.map((thread) => {
        const matchesThread = thread.id === commentId || thread.entries.some((entry) => entry.id === commentId);
        if (!matchesThread) {
            return thread;
        }
        found = true;
        return {
            ...thread,
            entries: [...thread.entries, { id: randomUUID(), body: normalizeCommentBody(nextCommentBody), timestamp }],
            updatedAt: Math.max(thread.updatedAt || 0, timestamp),
        };
    });

    if (!found) {
        io.stderr.write(`Comment id not found: ${commentId}\n`);
        return 1;
    }

    await writeSidecar(vaultRoot, noteRelativePath, updatedThreads);

    const migrationResult = await stripLegacyBlockIfNeeded(vaultRoot, notePath, noteRelativePath, noteContent, hadLegacyBlock, options.settleMs);
    if (migrationResult.kind === "changed") {
        io.stderr.write(
            `Note content changed during sidecar migration; legacy block may still exist in ${notePath}. `
            + "Rerun after Obsidian Sync or other local edits settle.\n",
        );
    }

    io.stdout.write(`Appended a new entry to comment ${commentId} in ${notePath}\n`);
    return 0;
}

export async function runUpdateNoteComment(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
    let options;
    try {
        options = parseAppendOrUpdateArgs(argv);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printUpdateNoteCommentUsage(io.stderr);
        return 1;
    }

    if (options === null) {
        printUpdateNoteCommentUsage(io.stdout);
        return 0;
    }

    let writeTarget;
    try {
        writeTarget = await resolveCommentWriteTarget(options);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    const { notePath, commentId, vaultRoot, noteRelativePath } = writeTarget;
    const nextCommentBody = await loadCommentBody(options);
    const normalizedBody = normalizeCommentBody(nextCommentBody);

    let threads;
    let noteContent;
    let hadLegacyBlock;
    try {
        ({ threads, noteContent, hadLegacyBlock } = await loadThreadsWithFallback(vaultRoot, notePath, noteRelativePath));
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    let found = false;
    const updatedThreads = threads.map((thread) => {
        if (thread.id === commentId) {
            found = true;
            const entries = thread.entries.slice();
            const latestEntry = entries[entries.length - 1];
            if (latestEntry) {
                latestEntry.body = normalizedBody;
            }
            return { ...thread, entries };
        }
        const matchingEntryIndex = thread.entries.findIndex((entry) => entry.id === commentId);
        if (matchingEntryIndex === -1) {
            return thread;
        }
        found = true;
        const entries = thread.entries.slice();
        entries[matchingEntryIndex] = { ...entries[matchingEntryIndex], body: normalizedBody };
        return { ...thread, entries };
    });

    if (!found) {
        io.stderr.write(`Comment id not found: ${commentId}\n`);
        return 1;
    }

    await writeSidecar(vaultRoot, noteRelativePath, updatedThreads);

    const migrationResult = await stripLegacyBlockIfNeeded(vaultRoot, notePath, noteRelativePath, noteContent, hadLegacyBlock, options.settleMs);
    if (migrationResult.kind === "changed") {
        io.stderr.write(
            `Note content changed during sidecar migration; legacy block may still exist in ${notePath}. `
            + "Rerun after Obsidian Sync or other local edits settle.\n",
        );
    }

    io.stdout.write(`Updated comment ${commentId} in ${notePath}\n`);
    return 0;
}

export async function runResolveNoteComment(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
    let options;
    try {
        options = parseResolveArgs(argv);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printResolveNoteCommentUsage(io.stderr);
        return 1;
    }

    if (options === null) {
        printResolveNoteCommentUsage(io.stdout);
        return 0;
    }

    let writeTarget;
    try {
        writeTarget = await resolveCommentWriteTarget(options);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    const { notePath, commentId, vaultRoot, noteRelativePath } = writeTarget;

    let threads;
    let noteContent;
    let hadLegacyBlock;
    try {
        ({ threads, noteContent, hadLegacyBlock } = await loadThreadsWithFallback(vaultRoot, notePath, noteRelativePath));
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    let found = false;
    const updatedThreads = threads.map((thread) => {
        const matchesThread = thread.id === commentId || thread.entries.some((entry) => entry.id === commentId);
        if (!matchesThread) {
            return thread;
        }
        found = true;
        return { ...thread, resolved: true };
    });

    if (!found) {
        io.stderr.write(`Comment id not found: ${commentId}\n`);
        return 1;
    }

    await writeSidecar(vaultRoot, noteRelativePath, updatedThreads);

    const migrationResult = await stripLegacyBlockIfNeeded(vaultRoot, notePath, noteRelativePath, noteContent, hadLegacyBlock, options.settleMs);
    if (migrationResult.kind === "changed") {
        io.stderr.write(
            `Note content changed during sidecar migration; legacy block may still exist in ${notePath}. `
            + "Rerun after Obsidian Sync or other local edits settle.\n",
        );
    }

    io.stdout.write(`Resolved comment ${commentId} in ${notePath}\n`);
    return 0;
}

export async function runInstallBundledSkill(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
    let options;
    try {
        options = parseInstallBundledSkillArgs(argv);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printInstallBundledSkillUsage(io.stderr);
        return 1;
    }

    if (options === null) {
        printInstallBundledSkillUsage(io.stdout);
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
        io.stdout.write(`Installed skill ${skillName} to ${destinationDir}\n`);
    }
    io.stdout.write("Restart Codex to pick up new skills.\n");
    return 0;
}

export async function runScriptMain(run, argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
    try {
        const exitCode = await run(argv, io);
        if (exitCode !== 0) {
            process.exitCode = exitCode;
        }
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
