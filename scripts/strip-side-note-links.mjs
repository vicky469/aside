#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    createContentFingerprint,
    loadThreadsWithFallback,
    resolveVaultRootByPath,
    getVaultRelativePath,
    runScriptMain,
    stripLegacyBlockIfNeeded,
    writeSidecar,
    writeObservedNoteSafely,
} from "./lib/asideRepoScripts.mjs";

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

function stripWikiLinks(text) {
    return text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1");
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

    const targetFiles = [];
    for (const rawPath of options.paths) {
        await collectMarkdownFiles(path.resolve(process.cwd(), rawPath), targetFiles);
    }

    const uniqueFiles = Array.from(new Set(targetFiles)).sort((left, right) => left.localeCompare(right));
    let cleanedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const notePath of uniqueFiles) {
        let vaultRoot;
        let noteRelativePath;
        try {
            vaultRoot = await resolveVaultRootByPath(notePath);
            noteRelativePath = getVaultRelativePath(vaultRoot, notePath);
        } catch {
            skippedCount += 1;
            io.stderr.write(`Skipped ${notePath} — could not resolve vault root\n`);
            continue;
        }

        let threads;
        let noteContent;
        let hadLegacyBlock;
        try {
            ({ threads, noteContent, hadLegacyBlock } = await loadThreadsWithFallback(vaultRoot, notePath, noteRelativePath));
        } catch (error) {
            errorCount += 1;
            io.stderr.write(`Skipped ${notePath} — ${error instanceof Error ? error.message : String(error)}\n`);
            continue;
        }

        let modified = false;
        const updatedThreads = threads.map((thread) => {
            const updatedEntries = thread.entries.map((entry) => {
                const strippedBody = stripWikiLinks(entry.body);
                if (strippedBody !== entry.body) {
                    modified = true;
                    return { ...entry, body: strippedBody };
                }
                return entry;
            });
            if (updatedEntries.some((e, i) => e.body !== thread.entries[i].body)) {
                return { ...thread, entries: updatedEntries };
            }
            return thread;
        });

        if (!modified) {
            skippedCount += 1;
            continue;
        }

        await writeSidecar(vaultRoot, noteRelativePath, updatedThreads);

        const migrationResult = await stripLegacyBlockIfNeeded(vaultRoot, notePath, noteRelativePath, noteContent, hadLegacyBlock, options.settleMs);
        if (migrationResult.kind === "changed") {
            io.stderr.write(
                `Note content changed during sidecar migration; legacy block may still exist in ${notePath}. `
                + "Rerun after Obsidian Sync or other local edits settle.\n",
            );
        }

        cleanedCount += 1;
        io.stdout.write(`Stripped legacy side-note links from ${notePath}\n`);
    }

    io.stdout.write(
        `Done. cleaned=${cleanedCount} skipped=${skippedCount} error=${errorCount}\n`,
    );
    return errorCount > 0 ? 1 : 0;
}

await runScriptMain(runStripSideNoteLinks);
