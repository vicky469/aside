#!/usr/bin/env node

import * as esbuild from "esbuild";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    createContentFingerprint,
    runScriptMain,
    writeObservedNoteSafely,
} from "./lib/sideNote2RepoScripts.mjs";

function getRepoRoot(metaUrl) {
    return path.resolve(path.dirname(fileURLToPath(metaUrl)), "..");
}

function printUsage(stream = process.stderr) {
    stream.write(
        [
            "Usage:",
            "  node scripts/strip-side-note-links.mjs --path <note-or-folder> [--path <note-or-folder>] [--settle-ms <milliseconds>]",
        ].join("\n") + "\n",
    );
}

function parseArgs(argv) {
    const options = {
        paths: [],
        settleMs: 0,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case "--path":
                options.paths.push(argv[index + 1] ?? "");
                index += 1;
                break;
            case "--settle-ms": {
                const value = Number(argv[index + 1] ?? "");
                if (!Number.isInteger(value) || value < 0) {
                    throw new Error("Expected --settle-ms to be a non-negative integer.");
                }
                options.settleMs = value;
                index += 1;
                break;
            }
            case "--help":
            case "-h":
                return null;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (options.paths.length === 0) {
        throw new Error("Provide at least one --path target.");
    }

    return options;
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

async function collectMarkdownFiles(targetPath, files) {
    const stats = await stat(targetPath);
    if (stats.isDirectory()) {
        const entries = await readdir(targetPath, { withFileTypes: true });
        for (const entry of entries) {
            await collectMarkdownFiles(path.join(targetPath, entry.name), files);
        }
        return;
    }

    if (stats.isFile() && targetPath.toLowerCase().endsWith(".md")) {
        files.push(targetPath);
    }
}

export async function runStripSideNoteLinks(
    argv,
    io = { stdout: process.stdout, stderr: process.stderr },
) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        printUsage(io.stderr);
        return 1;
    }

    if (options === null) {
        printUsage(io.stdout);
        return 0;
    }

    const storageModule = await loadStorageModule();
    const targetFiles = [];
    for (const rawPath of options.paths) {
        await collectMarkdownFiles(path.resolve(process.cwd(), rawPath), targetFiles);
    }

    const uniqueFiles = Array.from(new Set(targetFiles)).sort((left, right) => left.localeCompare(right));
    let cleanedCount = 0;
    let skippedCount = 0;
    let unsupportedCount = 0;

    for (const notePath of uniqueFiles) {
        const noteContent = await readFile(notePath, "utf8");
        const managedSectionKind = storageModule.getManagedSectionKind(noteContent);
        if (managedSectionKind === "none") {
            skippedCount += 1;
            continue;
        }
        if (managedSectionKind === "unsupported") {
            unsupportedCount += 1;
            io.stderr.write(`Skipped unsupported SideNote2 block in ${notePath}\n`);
            continue;
        }

        const parsed = storageModule.parseNoteComments(noteContent, notePath);
        const updated = storageModule.serializeNoteCommentThreads(noteContent, parsed.threads);
        if (updated === noteContent) {
            skippedCount += 1;
            continue;
        }

        const writeResult = await writeObservedNoteSafely(
            notePath,
            createContentFingerprint(noteContent),
            updated,
            { settleMs: options.settleMs },
        );
        if (writeResult.kind === "changed") {
            io.stderr.write(
                `Skipped updating ${notePath} because ${writeResult.reason}. `
                + "Rerun after Obsidian Sync or other local edits settle.\n",
            );
            unsupportedCount += 1;
            continue;
        }

        cleanedCount += 1;
        io.stdout.write(`Stripped legacy side-note links from ${notePath}\n`);
    }

    io.stdout.write(
        `Done. cleaned=${cleanedCount} skipped=${skippedCount} unsupported=${unsupportedCount}\n`,
    );
    return unsupportedCount > 0 ? 1 : 0;
}

await runScriptMain(runStripSideNoteLinks);
