#!/usr/bin/env node

import * as esbuild from "esbuild";
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "side-note2-note-comments";

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
            "  comment:update  Update one stored SideNote2 comment body in a note",
            "  install-skill   Copy the SideNote2 Codex skill into the Codex skills directory",
            "",
            "Run `sidenote2 <command> --help` for command-specific usage.",
        ].join("\n") + "\n",
    );
}

function printCommentUpdateUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  sidenote2 comment:update --file <note.md> --id <comment-id> (--comment <text> | --comment-file <path> | --stdin)",
            "",
            "Examples:",
            "  sidenote2 comment:update --file ./note.md --id comment-1 --comment-file ./comment.md",
            "  printf 'Updated body\\n' | sidenote2 comment:update --file ./note.md --id comment-1 --stdin",
        ].join("\n") + "\n",
    );
}

function printSkillUsage(command, stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            `  sidenote2 ${command} [--dest <skills-root>]`,
            "",
            "Defaults:",
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

function parseSkillArgs(argv) {
    const options = {
        destRoot: getDefaultSkillsRoot(),
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
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

async function loadCommentBody(options) {
    if (options.comment !== null) {
        return options.comment;
    }

    if (options.commentFile) {
        return readFile(path.resolve(process.cwd(), options.commentFile), "utf8");
    }

    return readStdin();
}

async function loadStorageModule(repoRoot) {
    const entryPoint = path.resolve(repoRoot, "src/core/noteCommentStorage.ts");
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
    const notePath = path.resolve(process.cwd(), options.file);
    const nextCommentBody = await loadCommentBody(options);
    const noteContent = await readFile(notePath, "utf8");
    const storageModule = await loadStorageModule(repoRoot);
    const updated = storageModule.replaceNoteCommentBodyById(noteContent, notePath, options.id, nextCommentBody);

    if (typeof updated !== "string") {
        streamErr.write(`Comment id not found: ${options.id}\n`);
        return 1;
    }

    await writeFile(notePath, updated, "utf8");
    streamOut.write(`Updated comment ${options.id} in ${notePath}\n`);
    return 0;
}

async function getSkillDirectories() {
    const repoRoot = getRepoRoot(import.meta.url);
    const sourceDir = path.join(repoRoot, "skills", SKILL_NAME);
    if (!(await pathExists(sourceDir))) {
        throw new Error(`Skill source not found: ${sourceDir}`);
    }

    return { repoRoot, sourceDir };
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

    const { sourceDir } = await getSkillDirectories();

    const destinationRoot = options.destRoot;
    const destinationDir = path.join(destinationRoot, SKILL_NAME);
    await mkdir(destinationRoot, { recursive: true });
    await rm(destinationDir, { recursive: true, force: true });
    await copyDirectoryRecursive(sourceDir, destinationDir);
    streamOut.write(`Installed skill ${SKILL_NAME} to ${destinationDir}\n`);
    streamOut.write("Restart Codex to pick up new skills.\n");
    return 0;
}

export async function runCli(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
    const [command, ...rest] = argv;
    switch (command) {
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
